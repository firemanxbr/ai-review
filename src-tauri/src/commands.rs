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

// --- Activity commands ---

#[tauri::command]
pub fn get_activity(state: State<'_, Arc<AppState>>, limit: Option<i64>) -> Vec<ActivityEntry> {
    state
        .db
        .get_recent_activity(limit.unwrap_or(50))
        .unwrap_or_default()
}
