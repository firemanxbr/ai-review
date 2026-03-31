use crate::github::GitHubClient;
use crate::lmstudio::LmStudioClient;
use crate::state::AppState;
use log::{error, info};
use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use tauri::{AppHandle, Emitter};
use tokio::time::{sleep, Duration};

pub async fn start_polling_loop(app: AppHandle, state: Arc<AppState>) {
    info!("PR polling loop started");

    let mut lm_studio_warned = false;
    let mut failed_prs: HashSet<String> = HashSet::new();
    let mut in_progress: HashSet<String> = HashSet::new();
    // Track PR states: key = "repo:pr_number", value = "open" | "closed" | "merged"
    let mut tracked_states: HashMap<String, String> = HashMap::new();

    loop {
        let interval = {
            let config = state.config.lock().unwrap();
            config.poll_interval_secs
        };

        let is_active = {
            let config = state.config.lock().unwrap();
            config.is_polling_active
        };

        if !is_active {
            sleep(Duration::from_secs(2)).await;
            continue;
        }

        let (token, repos, model) = {
            let config = state.config.lock().unwrap();
            (
                config.github_pat.clone(),
                config.watched_repos.clone(),
                config.selected_model.clone(),
            )
        };

        if token.is_empty() || repos.is_empty() || model.is_empty() {
            sleep(Duration::from_secs(interval)).await;
            continue;
        }

        let github = GitHubClient::new(&token);
        let lmstudio = LmStudioClient::new(None);

        // Check state changes on all reviewed PRs (runs regardless of LM Studio)
        let reviewed_prs = state.db.get_reviewed_prs();
        for (repo, pr_number) in &reviewed_prs {
            let track_key = format!("{}:{}", repo, pr_number);
            let last_state = tracked_states.get(&track_key).cloned().unwrap_or_else(|| "open".to_string());

            match github.get_pr(repo, *pr_number).await {
                Ok(pr) => {
                    let current_state = if pr.merged_at.is_some() {
                        "merged"
                    } else if pr.state == "closed" {
                        "closed"
                    } else {
                        "open"
                    };

                    if current_state != last_state {
                        match current_state {
                            "merged" => {
                                emit_activity_full(&app, "pr_merged", repo, Some(*pr_number),
                                    &format!("PR #{} has been merged", pr_number),
                                    Some(&pr.html_url), Some("merged"));
                            }
                            "closed" => {
                                emit_activity_full(&app, "pr_closed", repo, Some(*pr_number),
                                    &format!("PR #{} has been closed", pr_number),
                                    Some(&pr.html_url), Some("closed"));
                            }
                            "open" if last_state == "closed" || last_state == "merged" => {
                                emit_activity_full(&app, "pr_reopened", repo, Some(*pr_number),
                                    &format!("PR #{} has been reopened", pr_number),
                                    Some(&pr.html_url), Some("reopened"));
                            }
                            _ => {}
                        }
                        tracked_states.insert(track_key, current_state.to_string());
                    }
                }
                Err(e) => {
                    error!("Failed to check state for {}#{}: {}", repo, pr_number, e);
                }
            }
        }

        // Check LM Studio health
        match lmstudio.health_check().await {
            Ok(true) => {
                lm_studio_warned = false;
            }
            _ => {
                if !lm_studio_warned {
                    emit_activity(&app, "warning", "", None, "LM Studio is not running");
                    lm_studio_warned = true;
                }
                sleep(Duration::from_secs(interval)).await;
                continue;
            }
        }

        for repo in &repos {
            match github.get_open_prs(repo).await {
                Ok(prs) => {
                    for pr in prs {
                        let dedup_key = format!("{}:{}:{}", repo, pr.number, pr.head.sha);
                        let already_reviewed =
                            state.db.has_review(repo, pr.number, &pr.head.sha);
                        if already_reviewed || failed_prs.contains(&dedup_key) || in_progress.contains(&dedup_key) {
                            continue;
                        }

                        in_progress.insert(dedup_key.clone());

                        // Track this PR as open
                        let track_key = format!("{}:{}", repo, pr.number);
                        tracked_states.insert(track_key, "open".to_string());

                        info!("New/updated PR found: {}#{} - {}", repo, pr.number, pr.title);
                        emit_activity_full(
                            &app,
                            "pr_found",
                            repo,
                            Some(pr.number),
                            &format!("Found PR #{}: {}", pr.number, pr.title),
                            Some(&pr.html_url),
                            None,
                        );

                        // Fetch the diff
                        let diff = match github.get_pr_diff(repo, pr.number).await {
                            Ok(d) => d,
                            Err(e) => {
                                error!("Failed to get diff for {}#{}: {}", repo, pr.number, e);
                                in_progress.remove(&dedup_key);
                                failed_prs.insert(dedup_key.clone());
                                emit_activity(
                                    &app,
                                    "error",
                                    repo,
                                    Some(pr.number),
                                    &format!("Failed to fetch diff: {}", e),
                                );
                                continue;
                            }
                        };

                        emit_activity(
                            &app,
                            "reviewing",
                            repo,
                            Some(pr.number),
                            &format!("Reviewing PR #{} with model {}...", pr.number, model),
                        );

                        // Send to LM Studio for review
                        let review = match lmstudio.review_diff(&model, &pr.title, &diff).await {
                            Ok(r) => r,
                            Err(e) => {
                                error!("LM Studio review failed for {}#{}: {}", repo, pr.number, e);
                                in_progress.remove(&dedup_key);
                                failed_prs.insert(dedup_key.clone());
                                emit_activity(
                                    &app,
                                    "error",
                                    repo,
                                    Some(pr.number),
                                    &format!("Review failed: {}", e),
                                );
                                continue;
                            }
                        };

                        // Post review back to GitHub
                        let review_body = format!(
                            "## 🤖 AI Review (Local — powered by LM Studio)\n\n{}\n\n---\n*Reviewed by [AI Review](https://github.com/firemanxbr/ai-review) using model `{}`*",
                            review, model
                        );

                        match github
                            .post_review_comment(repo, pr.number, &review_body)
                            .await
                        {
                            Ok(_) => {
                                info!("Review posted for {}#{}", repo, pr.number);
                                in_progress.remove(&dedup_key);
                                if let Err(e) =
                                    state.db.insert_review(repo, pr.number, &pr.head.sha)
                                {
                                    error!("Failed to record review in DB: {}", e);
                                }
                                if let Err(e) = state.db.log_activity(
                                    "review_posted",
                                    repo,
                                    Some(pr.number),
                                    &format!("Review posted for PR #{}", pr.number),
                                ) {
                                    error!("Failed to log activity: {}", e);
                                }
                                emit_activity_full(
                                    &app,
                                    "review_posted",
                                    repo,
                                    Some(pr.number),
                                    &format!("Review posted for PR #{}", pr.number),
                                    Some(&pr.html_url),
                                    None,
                                );
                            }
                            Err(e) => {
                                error!("Failed to post review for {}#{}: {}", repo, pr.number, e);
                                in_progress.remove(&dedup_key);
                                failed_prs.insert(dedup_key.clone());
                                emit_activity(
                                    &app,
                                    "error",
                                    repo,
                                    Some(pr.number),
                                    &format!("Failed to post review: {}", e),
                                );
                            }
                        }
                    }
                }
                Err(e) => {
                    error!("Failed to fetch PRs for {}: {}", repo, e);
                    emit_activity(
                        &app,
                        "error",
                        repo,
                        None,
                        &format!("Failed to fetch PRs: {}", e),
                    );
                }
            }
        }

        sleep(Duration::from_secs(interval)).await;
    }
}

fn emit_activity(
    app: &AppHandle,
    event_type: &str,
    repo: &str,
    pr_number: Option<i64>,
    message: &str,
) {
    emit_activity_full(app, event_type, repo, pr_number, message, None, None);
}

fn emit_activity_full(
    app: &AppHandle,
    event_type: &str,
    repo: &str,
    pr_number: Option<i64>,
    message: &str,
    html_url: Option<&str>,
    pr_state: Option<&str>,
) {
    let payload = serde_json::json!({
        "event_type": event_type,
        "repo": repo,
        "pr_number": pr_number,
        "message": message,
        "timestamp": chrono::Utc::now().to_rfc3339(),
        "html_url": html_url,
        "pr_state": pr_state,
    });
    let _ = app.emit("activity", payload);
}
