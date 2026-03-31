use crate::db::ActivityEntry;
use crate::github::GitHubClient;
use crate::lmstudio::LmStudioClient;
use crate::state::{AppConfig, AppState};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tauri::State;

#[derive(Debug, Serialize, Deserialize)]
pub struct StatusResponse {
    pub lm_studio_online: bool,
    pub github_connected: bool,
    pub github_user: Option<String>,
    pub polling_active: bool,
    pub watched_repos_count: usize,
    pub rate_limit_remaining: Option<i64>,
    pub rate_limit_total: Option<i64>,
    pub rate_limit_reset: Option<i64>,
}

// --- Config commands ---

#[tauri::command]
pub fn get_config(state: State<'_, Arc<AppState>>) -> AppConfig {
    state.config.lock().unwrap().clone()
}

#[tauri::command]
pub fn save_github_pat(state: State<'_, Arc<AppState>>, pat: String) -> Result<(), String> {
    {
        let mut config = state.config.lock().unwrap();
        config.github_pat = pat;
    }
    state.save_config();
    Ok(())
}

#[tauri::command]
pub fn set_watched_repos(
    state: State<'_, Arc<AppState>>,
    repos: Vec<String>,
) -> Result<(), String> {
    {
        let mut config = state.config.lock().unwrap();
        config.watched_repos = repos;
    }
    state.save_config();
    Ok(())
}

#[tauri::command]
pub fn add_watched_repo(state: State<'_, Arc<AppState>>, repo: String) -> Result<(), String> {
    {
        let mut config = state.config.lock().unwrap();
        if !config.watched_repos.contains(&repo) {
            config.watched_repos.push(repo);
        }
    }
    state.save_config();
    Ok(())
}

#[tauri::command]
pub fn remove_watched_repo(state: State<'_, Arc<AppState>>, repo: String) -> Result<(), String> {
    {
        let mut config = state.config.lock().unwrap();
        config.watched_repos.retain(|r| r != &repo);
    }
    state.save_config();
    Ok(())
}

#[tauri::command]
pub fn set_selected_model(state: State<'_, Arc<AppState>>, model: String) -> Result<(), String> {
    {
        let mut config = state.config.lock().unwrap();
        config.selected_model = model;
    }
    state.save_config();
    Ok(())
}

#[tauri::command]
pub fn set_poll_interval(state: State<'_, Arc<AppState>>, seconds: u64) -> Result<(), String> {
    {
        let mut config = state.config.lock().unwrap();
        config.poll_interval_secs = seconds;
    }
    state.save_config();
    Ok(())
}

#[tauri::command]
pub fn toggle_polling(state: State<'_, Arc<AppState>>, active: bool) -> Result<(), String> {
    {
        let mut config = state.config.lock().unwrap();
        config.is_polling_active = active;
    }
    Ok(())
}

// --- Status commands ---

#[tauri::command]
pub async fn get_status(state: State<'_, Arc<AppState>>) -> Result<StatusResponse, String> {
    let (pat, repos_count, polling) = {
        let config = state.config.lock().unwrap();
        (
            config.github_pat.clone(),
            config.watched_repos.len(),
            config.is_polling_active,
        )
    };

    let lmstudio = LmStudioClient::new(None);
    let lm_online = lmstudio.health_check().await.unwrap_or(false);

    let (gh_connected, gh_user, rate_remaining, rate_total, rate_reset) = if !pat.is_empty() {
        let gh = GitHubClient::new(&pat);
        let user = gh.validate_token().await.ok().map(|u| u.login);
        let rate_info = gh.get_rate_limit().await.ok();
        let remaining = rate_info.as_ref().map(|r| r.resources.core.remaining);
        let total = rate_info.as_ref().map(|r| r.resources.core.limit);
        let reset = rate_info.as_ref().map(|r| r.resources.core.reset);
        (user.is_some(), user, remaining, total, reset)
    } else {
        (false, None, None, None, None)
    };

    Ok(StatusResponse {
        lm_studio_online: lm_online,
        github_connected: gh_connected,
        github_user: gh_user,
        polling_active: polling,
        watched_repos_count: repos_count,
        rate_limit_remaining: rate_remaining,
        rate_limit_total: rate_total,
        rate_limit_reset: rate_reset,
    })
}

#[tauri::command]
pub async fn validate_github_pat(pat: String) -> Result<String, String> {
    let gh = GitHubClient::new(&pat);
    let user = gh.validate_token().await?;
    Ok(user.login)
}

// --- LM Studio commands ---

#[tauri::command]
pub async fn check_lmstudio() -> Result<bool, String> {
    let client = LmStudioClient::new(None);
    client.health_check().await
}

#[tauri::command]
pub async fn list_models() -> Result<Vec<String>, String> {
    let client = LmStudioClient::new(None);
    let models = client.list_models().await?;
    Ok(models.into_iter().map(|m| m.id).collect())
}

// --- Database commands ---

#[derive(Debug, Serialize, Deserialize)]
pub struct DbInfo {
    pub path: String,
    pub size_bytes: u64,
}

#[tauri::command]
pub fn get_db_info(state: State<'_, Arc<AppState>>) -> DbInfo {
    let (path, size_bytes) = state.db.get_db_info();
    DbInfo { path, size_bytes }
}

#[tauri::command]
pub fn reset_database(state: State<'_, Arc<AppState>>) -> Result<(), String> {
    state.db.reset_data().map_err(|e| e.to_string())
}

// --- Startup commands ---

#[tauri::command]
pub fn set_polling_on_startup(state: State<'_, Arc<AppState>>, enabled: bool) -> Result<(), String> {
    {
        let mut config = state.config.lock().unwrap();
        config.polling_on_startup = enabled;
    }
    state.save_config();
    Ok(())
}

// --- Review commands ---

#[tauri::command]
pub async fn re_review_pr(
    app: tauri::AppHandle,
    state: State<'_, Arc<AppState>>,
    repo: String,
    pr_number: i64,
) -> Result<String, String> {
    let (pat, model) = {
        let config = state.config.lock().unwrap();
        (config.github_pat.clone(), config.selected_model.clone())
    };

    if pat.is_empty() || model.is_empty() {
        return Err("GitHub PAT and model must be configured".to_string());
    }

    let github = GitHubClient::new(&pat);
    let lmstudio = LmStudioClient::new(None);

    // Get PR info first — don't touch DB until we know the PR is valid
    let pr = github.get_pr(&repo, pr_number).await?;

    emit_activity_event(&app, "reviewing", &repo, Some(pr_number),
        &format!("Re-reviewing PR #{} with model {}...", pr_number, model),
        Some(&pr.html_url), None);

    // Fetch diff
    let diff = github.get_pr_diff(&repo, pr_number).await?;

    // Review with LM Studio
    let review = lmstudio.review_diff(&model, &pr.title, &diff).await?;

    // Post review to GitHub
    let review_body = format!(
        "## 🤖 AI Review (Local — powered by LM Studio)\n\n{}\n\n---\n*Reviewed by [AI Review](https://github.com/firemanxbr/ai-review) using model `{}`*",
        review, model
    );
    github.post_review_comment(&repo, pr_number, &review_body).await?;

    // Only clear and re-record in DB after successful review
    state.db.delete_review(&repo, pr_number).map_err(|e| e.to_string())?;
    state.db.insert_review(&repo, pr_number, &pr.head.sha).map_err(|e| e.to_string())?;
    state.db.log_activity(
        "review_posted", &repo, Some(pr_number),
        &format!("Review posted for PR #{}", pr_number),
    ).map_err(|e| e.to_string())?;

    emit_activity_event(&app, "review_posted", &repo, Some(pr_number),
        &format!("Review posted for PR #{}", pr_number),
        Some(&pr.html_url), None);

    Ok("Review posted".to_string())
}

fn emit_activity_event(
    app: &tauri::AppHandle,
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
    let _ = tauri::Emitter::emit(app, "activity", payload);
}

// --- Activity commands ---

#[tauri::command]
pub fn get_activity(state: State<'_, Arc<AppState>>, limit: Option<i64>) -> Vec<ActivityEntry> {
    state
        .db
        .get_recent_activity(limit.unwrap_or(50))
        .unwrap_or_default()
}
