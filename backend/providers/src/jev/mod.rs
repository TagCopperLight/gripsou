//! Jev (TypeSafe) adapter for the categorisation port (phase 5 spec §3.3):
//! one `choice` question per transaction, since the API evaluates a single
//! `state` per request. Up to eight requests run at once; any failure fails
//! the whole batch so a batch is never half-written.

mod map;

use std::sync::Arc;
use std::time::Duration;

use async_trait::async_trait;
use gripsou_core::categorize::{CategorizeError, CategorizeOutput, CategorizeRequest, Categorizer};
use tokio::sync::Semaphore;
use tokio::task::JoinSet;

const IN_FLIGHT: usize = 8;

pub struct JevCategorizer {
    api_key: String,
    model: String,
    base_url: String,
    http: reqwest::Client,
}

impl JevCategorizer {
    pub const DEFAULT_MODEL: &'static str = "jev-latest";

    pub fn new(api_key: String, model: String) -> Self {
        Self {
            api_key,
            model,
            base_url: "https://api.typesafe.ai".to_string(),
            http: reqwest::Client::builder()
                .timeout(Duration::from_secs(30))
                .build()
                .unwrap_or_default(),
        }
    }

    pub fn with_base_url(mut self, url: String) -> Self {
        self.base_url = url.trim_end_matches('/').to_string();
        self
    }

    pub fn from_env(model: &str) -> Option<Self> {
        let key = std::env::var("JEV_API_KEY")
            .ok()
            .filter(|k| !k.trim().is_empty())?;
        Some(Self::new(key, model.to_string()))
    }
}

#[async_trait]
impl Categorizer for JevCategorizer {
    fn key(&self) -> &str {
        "jev"
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
        let url = format!("{}/v1/systemone", self.base_url);
        let gate = Arc::new(Semaphore::new(IN_FLIGHT));
        let mut set = JoinSet::new();
        for (idx, item) in req.items.iter().enumerate() {
            let body = map::build_body(req, item, &self.model);
            let (http, url, key, gate) = (
                self.http.clone(),
                url.clone(),
                self.api_key.clone(),
                gate.clone(),
            );
            set.spawn(async move {
                let _permit = gate.acquire_owned().await.expect("semaphore never closes");
                let resp = http
                    .post(&url)
                    .bearer_auth(&key)
                    .json(&body)
                    .send()
                    .await
                    .map_err(|e| CategorizeError::Other(format!("jev request failed: {e}")))?;
                let status = resp.status();
                if status.as_u16() == 429 {
                    return Err(CategorizeError::RateLimited);
                }
                if !status.is_success() {
                    let text = resp.text().await.unwrap_or_default();
                    return Err(CategorizeError::Other(format!("jev {status}: {text}")));
                }
                let json: serde_json::Value = resp
                    .json()
                    .await
                    .map_err(|e| CategorizeError::Other(format!("jev answer unreadable: {e}")))?;
                Ok((idx, json))
            });
        }

        let mut answers = Vec::with_capacity(req.items.len());
        while let Some(joined) = set.join_next().await {
            match joined {
                Ok(Ok(a)) => answers.push(a),
                Ok(Err(e)) => {
                    set.abort_all();
                    return Err(e);
                }
                Err(e) => {
                    set.abort_all();
                    return Err(CategorizeError::Other(format!("jev task failed: {e}")));
                }
            }
        }
        answers.sort_by_key(|(idx, _)| *idx);

        let (mut tin, mut tout) = (0, 0);
        let guesses = answers
            .iter()
            .map(|(idx, json)| {
                let (g, i, o) = map::parse_answer(&req.items[*idx], json);
                tin += i;
                tout += o;
                g
            })
            .collect();
        Ok(CategorizeOutput {
            guesses,
            tokens_in: Some(tin),
            tokens_out: Some(tout),
        })
    }
}
