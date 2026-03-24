use crate::github::GitHubClient;
use crate::lmstudio::LmStudioClient;
use crate::state::AppState;
use log::{error, info};
use std::sync::Arc;
use tauri::{AppHandle, Emitter};
use tokio::time::{sleep, Duration};

pub async fn start_polling_loop(app: AppHandle, state: Arc<AppState>) {
    info!("PR polling loop started");

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

        // Check LM Studio health
        match lmstudio.health_check().await {
            Ok(true) => {}
            _ => {
                emit_activity(&app, "warning", "", None, "LM Studio is not running");
                sleep(Duration::from_secs(interval)).await;
                continue;
            }
        }

        for repo in &repos {
            match github.get_open_prs(repo).await {
                Ok(prs) => {
                    for pr in prs {
                        let already_reviewed =
                            state.db.has_review(repo, pr.number, &pr.head.sha);
                        if already_reviewed {
                            continue;
                        }

                        info!("New/updated PR found: {}#{} - {}", repo, pr.number, pr.title);
                        emit_activity(
                            &app,
                            "pr_found",
                            repo,
                            Some(pr.number),
                            &format!("Found PR #{}: {}", pr.number, pr.title),
                        );

                        // Fetch the diff
                        let diff = match github.get_pr_diff(repo, pr.number).await {
                            Ok(d) => d,
                            Err(e) => {
                                error!("Failed to get diff for {}#{}: {}", repo, pr.number, e);
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
                                emit_activity(
                                    &app,
                                    "review_posted",
                                    repo,
                                    Some(pr.number),
                                    &format!("Review posted for PR #{}", pr.number),
                                );
                            }
                            Err(e) => {
                                error!("Failed to post review for {}#{}: {}", repo, pr.number, e);
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
    let payload = serde_json::json!({
        "event_type": event_type,
        "repo": repo,
        "pr_number": pr_number,
        "message": message,
        "timestamp": chrono::Utc::now().to_rfc3339(),
    });
    let _ = app.emit("activity", payload);
}
