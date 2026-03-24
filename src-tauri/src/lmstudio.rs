use reqwest::Client;
use serde::{Deserialize, Serialize};

const DEFAULT_URL: &str = "http://localhost:1234";
const MAX_DIFF_CHARS: usize = 12000;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct LmModel {
    pub id: String,
    pub object: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct LmModelList {
    pub data: Vec<LmModel>,
}

#[derive(Debug, Serialize)]
struct ChatMessage {
    role: String,
    content: String,
}

#[derive(Debug, Serialize)]
struct ChatCompletionRequest {
    model: String,
    messages: Vec<ChatMessage>,
    temperature: f32,
    max_tokens: i32,
}

#[derive(Debug, Deserialize)]
struct ChatCompletionResponse {
    choices: Vec<ChatChoice>,
}

#[derive(Debug, Deserialize)]
struct ChatChoice {
    message: ChatMessageResponse,
}

#[derive(Debug, Deserialize)]
struct ChatMessageResponse {
    content: String,
}

pub struct LmStudioClient {
    client: Client,
    base_url: String,
}

impl LmStudioClient {
    pub fn new(base_url: Option<&str>) -> Self {
        Self {
            client: Client::new(),
            base_url: base_url.unwrap_or(DEFAULT_URL).to_string(),
        }
    }

    pub async fn health_check(&self) -> Result<bool, String> {
        let resp = self
            .client
            .get(format!("{}/v1/models", self.base_url))
            .send()
            .await;
        match resp {
            Ok(r) => Ok(r.status().is_success()),
            Err(_) => Ok(false),
        }
    }

    pub async fn list_models(&self) -> Result<Vec<LmModel>, String> {
        let resp = self
            .client
            .get(format!("{}/v1/models", self.base_url))
            .send()
            .await
            .map_err(|e| format!("LM Studio not reachable: {}", e))?;
        if !resp.status().is_success() {
            return Err(format!("LM Studio returned HTTP {}", resp.status()));
        }
        let list: LmModelList = resp.json().await.map_err(|e| e.to_string())?;
        Ok(list.data)
    }

    pub async fn review_diff(
        &self,
        model: &str,
        pr_title: &str,
        diff: &str,
    ) -> Result<String, String> {
        let truncated_diff = if diff.len() > MAX_DIFF_CHARS {
            format!(
                "{}\n\n... (diff truncated at {} chars, {} total)",
                &diff[..MAX_DIFF_CHARS],
                MAX_DIFF_CHARS,
                diff.len()
            )
        } else {
            diff.to_string()
        };

        let system_prompt = r#"You are a senior code reviewer. Analyze the PR diff provided and give a thorough review covering:

1. **Code Quality & Best Practices** — naming, structure, readability, DRY principle
2. **Logic & Bug Detection** — potential bugs, edge cases, off-by-one errors
3. **Security Issues** — injection risks, auth problems, data exposure
4. **Style & Formatting** — consistency, conventions

Format your review as markdown with severity ratings:
- 🔴 Critical — must fix before merge
- 🟡 Warning — should address
- 🟢 Suggestion — nice to have

End with a brief summary and an overall recommendation (approve / request changes / comment only).

Keep the review concise and actionable. Focus on the most impactful findings."#;

        let user_prompt = format!("PR Title: {}\n\nDiff:\n```\n{}\n```", pr_title, truncated_diff);

        let payload = ChatCompletionRequest {
            model: model.to_string(),
            messages: vec![
                ChatMessage {
                    role: "system".to_string(),
                    content: system_prompt.to_string(),
                },
                ChatMessage {
                    role: "user".to_string(),
                    content: user_prompt,
                },
            ],
            temperature: 0.3,
            max_tokens: 4096,
        };

        let resp = self
            .client
            .post(format!("{}/v1/chat/completions", self.base_url))
            .json(&payload)
            .send()
            .await
            .map_err(|e| format!("LM Studio request failed: {}", e))?;

        if !resp.status().is_success() {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            return Err(format!("LM Studio returned HTTP {} - {}", status, text));
        }

        let completion: ChatCompletionResponse = resp.json().await.map_err(|e| e.to_string())?;
        completion
            .choices
            .first()
            .map(|c| c.message.content.clone())
            .ok_or_else(|| "No response from model".to_string())
    }
}
