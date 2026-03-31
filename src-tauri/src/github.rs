use reqwest::Client;
use serde::{Deserialize, Serialize};

const GITHUB_API: &str = "https://api.github.com";

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct GitHubUser {
    pub login: String,
    pub avatar_url: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PullRequest {
    pub number: i64,
    pub title: String,
    pub state: String,
    pub html_url: String,
    pub head: PrHead,
    pub user: GitHubUser,
    pub created_at: String,
    pub updated_at: String,
    pub merged_at: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PrHead {
    pub sha: String,
    #[serde(rename = "ref")]
    pub ref_name: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct RateLimit {
    pub resources: RateLimitResources,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct RateLimitResources {
    pub core: RateLimitEntry,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct RateLimitEntry {
    pub limit: i64,
    pub remaining: i64,
    pub reset: i64,
}

pub struct GitHubClient {
    client: Client,
    token: String,
}

impl GitHubClient {
    pub fn new(token: &str) -> Self {
        Self {
            client: Client::new(),
            token: token.to_string(),
        }
    }

    fn auth_headers(&self) -> Vec<(&str, String)> {
        vec![
            ("Authorization", format!("Bearer {}", self.token)),
            ("Accept", "application/vnd.github.v3+json".to_string()),
            (
                "User-Agent",
                "AI-Review/0.1.0 (Local Code Reviewer)".to_string(),
            ),
        ]
    }

    pub async fn validate_token(&self) -> Result<GitHubUser, String> {
        let mut req = self.client.get(format!("{}/user", GITHUB_API));
        for (key, value) in self.auth_headers() {
            req = req.header(key, value);
        }
        let resp = req.send().await.map_err(|e| e.to_string())?;
        if !resp.status().is_success() {
            return Err(format!("Invalid token: HTTP {}", resp.status()));
        }
        resp.json::<GitHubUser>()
            .await
            .map_err(|e| e.to_string())
    }

    pub async fn get_open_prs(&self, repo: &str) -> Result<Vec<PullRequest>, String> {
        let mut req = self
            .client
            .get(format!("{}/repos/{}/pulls?state=open", GITHUB_API, repo));
        for (key, value) in self.auth_headers() {
            req = req.header(key, value);
        }
        let resp = req.send().await.map_err(|e| e.to_string())?;
        if !resp.status().is_success() {
            return Err(format!(
                "Failed to fetch PRs for {}: HTTP {}",
                repo,
                resp.status()
            ));
        }
        resp.json::<Vec<PullRequest>>()
            .await
            .map_err(|e| e.to_string())
    }

    pub async fn get_pr(&self, repo: &str, pr_number: i64) -> Result<PullRequest, String> {
        let mut req = self
            .client
            .get(format!("{}/repos/{}/pulls/{}", GITHUB_API, repo, pr_number));
        for (key, value) in self.auth_headers() {
            req = req.header(key, value);
        }
        let resp = req.send().await.map_err(|e| e.to_string())?;
        if !resp.status().is_success() {
            return Err(format!(
                "Failed to fetch PR {}#{}: HTTP {}",
                repo, pr_number, resp.status()
            ));
        }
        resp.json::<PullRequest>()
            .await
            .map_err(|e| e.to_string())
    }

    pub async fn get_pr_diff(&self, repo: &str, pr_number: i64) -> Result<String, String> {
        let mut req = self
            .client
            .get(format!(
                "{}/repos/{}/pulls/{}",
                GITHUB_API, repo, pr_number
            ))
            .header("Accept", "application/vnd.github.v3.diff");
        req = req
            .header("Authorization", format!("Bearer {}", self.token))
            .header(
                "User-Agent",
                "AI-Review/0.1.0 (Local Code Reviewer)",
            );
        let resp = req.send().await.map_err(|e| e.to_string())?;
        if !resp.status().is_success() {
            return Err(format!(
                "Failed to fetch diff for {}#{}: HTTP {}",
                repo,
                pr_number,
                resp.status()
            ));
        }
        resp.text().await.map_err(|e| e.to_string())
    }

    pub async fn post_review_comment(
        &self,
        repo: &str,
        pr_number: i64,
        body: &str,
    ) -> Result<(), String> {
        let payload = serde_json::json!({
            "body": body,
            "event": "COMMENT"
        });
        let mut req = self
            .client
            .post(format!(
                "{}/repos/{}/pulls/{}/reviews",
                GITHUB_API, repo, pr_number
            ))
            .json(&payload);
        for (key, value) in self.auth_headers() {
            req = req.header(key, value);
        }
        let resp = req.send().await.map_err(|e| e.to_string())?;
        if !resp.status().is_success() {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            return Err(format!(
                "Failed to post review on {}#{}: HTTP {} - {}",
                repo, pr_number, status, text
            ));
        }
        Ok(())
    }

    pub async fn get_rate_limit(&self) -> Result<RateLimit, String> {
        let mut req = self.client.get(format!("{}/rate_limit", GITHUB_API));
        for (key, value) in self.auth_headers() {
            req = req.header(key, value);
        }
        let resp = req.send().await.map_err(|e| e.to_string())?;
        resp.json::<RateLimit>().await.map_err(|e| e.to_string())
    }
}
