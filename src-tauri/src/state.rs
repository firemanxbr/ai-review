use crate::db::Database;
use serde::{Deserialize, Serialize};
use std::sync::Mutex;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AppConfig {
    pub github_pat: String,
    pub watched_repos: Vec<String>,
    pub selected_model: String,
    pub poll_interval_secs: u64,
    pub is_polling_active: bool,
    pub lm_studio_url: String,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            github_pat: String::new(),
            watched_repos: Vec::new(),
            selected_model: String::new(),
            poll_interval_secs: 10,
            is_polling_active: false,
            lm_studio_url: "http://localhost:1234".to_string(),
        }
    }
}

pub struct AppState {
    pub config: Mutex<AppConfig>,
    pub db: Database,
}

impl AppState {
    pub fn new() -> Self {
        let db = Database::new().expect("Failed to initialize database");

        // Load persisted config from DB
        let mut config = AppConfig::default();
        if let Some(pat) = db.get_config("github_pat") {
            config.github_pat = pat;
        }
        if let Some(repos_json) = db.get_config("watched_repos") {
            if let Ok(repos) = serde_json::from_str::<Vec<String>>(&repos_json) {
                config.watched_repos = repos;
            }
        }
        if let Some(model) = db.get_config("selected_model") {
            config.selected_model = model;
        }
        if let Some(interval) = db.get_config("poll_interval_secs") {
            if let Ok(secs) = interval.parse::<u64>() {
                config.poll_interval_secs = secs;
            }
        }
        if let Some(url) = db.get_config("lm_studio_url") {
            config.lm_studio_url = url;
        }

        Self {
            config: Mutex::new(config),
            db,
        }
    }

    pub fn save_config(&self) {
        let config = self.config.lock().unwrap();
        let _ = self.db.set_config("github_pat", &config.github_pat);
        let _ = self.db.set_config(
            "watched_repos",
            &serde_json::to_string(&config.watched_repos).unwrap_or_default(),
        );
        let _ = self.db.set_config("selected_model", &config.selected_model);
        let _ = self.db.set_config(
            "poll_interval_secs",
            &config.poll_interval_secs.to_string(),
        );
        let _ = self
            .db
            .set_config("lm_studio_url", &config.lm_studio_url);
    }
}
