//! Gemini adapter for the categorisation port: the
//! native `generateContent` API, fifty items per request, with a
//! `responseSchema` whose enum is the batch's allowed category ids.

mod map;

use std::time::Duration;

use async_trait::async_trait;
use gripsou_core::categorize::{CategorizeError, CategorizeOutput, CategorizeRequest, Categorizer};

pub struct GeminiCategorizer {
    api_key: String,
    model: String,
    base_url: String,
    http: reqwest::Client,
}

impl GeminiCategorizer {
    /// Flash-Lite's free tier allows far more requests per day than Flash's.
    pub const DEFAULT_MODEL: &'static str = "gemini-3.5-flash-lite";

    pub fn new(api_key: String, model: String) -> Self {
        Self {
            api_key,
            model,
            base_url: "https://generativelanguage.googleapis.com".to_string(),
            http: reqwest::Client::builder()
                .timeout(Duration::from_secs(120))
                .build()
                .unwrap_or_default(),
        }
    }

    /// Tests point this at a mock server.
    pub fn with_base_url(mut self, url: String) -> Self {
        self.base_url = url.trim_end_matches('/').to_string();
        self
    }

    /// `GEMINI_API_KEY`, or `None` when it is absent or blank (the provider
    /// is then off).
    pub fn api_key_from_env() -> Option<String> {
        std::env::var("GEMINI_API_KEY")
            .ok()
            .filter(|k| !k.trim().is_empty())
    }

    pub fn from_env(model: &str) -> Option<Self> {
        Some(Self::new(Self::api_key_from_env()?, model.to_string()))
    }
}

#[async_trait]
impl Categorizer for GeminiCategorizer {
    fn key(&self) -> &str {
        "gemini"
    }
    fn model(&self) -> &str {
        &self.model
    }
    fn batch_size(&self) -> usize {
        50
    }

    async fn categorize(
        &self,
        req: &CategorizeRequest,
    ) -> Result<CategorizeOutput, CategorizeError> {
        let url = format!(
            "{}/v1beta/models/{}:generateContent",
            self.base_url, self.model
        );
        let resp = self
            .http
            .post(&url)
            .header("x-goog-api-key", &self.api_key)
            .json(&map::build_body(req))
            .send()
            .await
            .map_err(|e| CategorizeError::Other(format!("gemini request failed: {e}")))?;
        let status = resp.status();
        let body: serde_json::Value = resp.json().await.unwrap_or(serde_json::Value::Null);
        if status.as_u16() == 429 || body["error"]["status"] == "RESOURCE_EXHAUSTED" {
            return Err(CategorizeError::RateLimited);
        }
        if !status.is_success() {
            let msg = body["error"]["message"].as_str().unwrap_or("no message");
            return Err(CategorizeError::Other(format!("gemini {status}: {msg}")));
        }
        map::parse_response(req, &body)
    }

    async fn models(&self) -> Result<Vec<String>, CategorizeError> {
        let url = format!("{}/v1beta/models", self.base_url);
        let mut models = Vec::new();
        let mut page: Option<String> = None;
        loop {
            let mut query = vec![("pageSize", "1000")];
            if let Some(token) = &page {
                query.push(("pageToken", token));
            }
            let resp = self
                .http
                .get(&url)
                .header("x-goog-api-key", &self.api_key)
                .query(&query)
                .send()
                .await
                .map_err(|e| CategorizeError::Other(format!("gemini request failed: {e}")))?;
            let status = resp.status();
            let body: serde_json::Value = resp.json().await.unwrap_or(serde_json::Value::Null);
            if !status.is_success() {
                let msg = body["error"]["message"].as_str().unwrap_or("no message");
                return Err(CategorizeError::Other(format!("gemini {status}: {msg}")));
            }
            let (names, next) = map::parse_models(&body);
            models.extend(names);
            // A token equal to the one just sent would loop forever.
            if next.is_none() || next == page {
                break;
            }
            page = next;
        }
        models.sort();
        models.dedup();
        Ok(models)
    }
}
