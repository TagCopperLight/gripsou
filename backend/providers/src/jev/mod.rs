//! Jev (TypeSafe) adapter for the categorisation port:
//! one `choice` question per transaction, since the API evaluates a single
//! `state` per request. Up to eight requests run at once. The first failure
//! stops the batch: nothing more is sent, the requests already in flight are
//! awaited, and every answer received is returned with the failure so none
//! is paid for twice.

mod map;

use std::sync::Arc;
use std::time::Duration;

use async_trait::async_trait;
use gripsou_core::categorize::{
    CategorizeError, CategorizeOutput, CategorizeRequest, Categorizer, Usage,
};
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

    /// `JEV_API_KEY`, or `None` when it is absent or blank (the provider is
    /// then off).
    pub fn api_key_from_env() -> Option<String> {
        std::env::var("JEV_API_KEY")
            .ok()
            .filter(|k| !k.trim().is_empty())
    }

    pub fn from_env(model: &str) -> Option<Self> {
        Some(Self::new(Self::api_key_from_env()?, model.to_string()))
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
                // Closed after a failure: this item is not sent.
                let Ok(_permit) = gate.clone().acquire_owned().await else {
                    return Ok(None);
                };
                let answer = ask(&http, &url, &key, &body).await;
                if answer.is_err() {
                    // Before the permit is released, so no waiting item
                    // slips through.
                    gate.close();
                }
                answer.map(|json| Some((idx, json)))
            });
        }

        let mut answers = Vec::with_capacity(req.items.len());
        let mut interrupted = None;
        while let Some(joined) = set.join_next().await {
            let failure = match joined {
                Ok(Ok(Some(a))) => {
                    answers.push(a);
                    continue;
                }
                Ok(Ok(None)) => continue,
                Ok(Err(e)) => e,
                Err(e) => CategorizeError::Other(format!(
                    "jev task failed: {}",
                    gripsou_core::logs::error_chain(&e)
                )),
            };
            gate.close();
            interrupted.get_or_insert(failure);
        }
        answers.sort_by_key(|(idx, _)| *idx);

        let mut usage = Usage::known(0, 0);
        let mut guesses = Vec::with_capacity(answers.len());
        for (idx, json) in &answers {
            let (guess, u) = match json {
                Some(json) => map::parse_answer(&req.items[*idx], json),
                None => (None, Usage::default()),
            };
            usage = usage.plus(u);
            guesses.extend(guess);
        }
        Ok(CategorizeOutput {
            guesses,
            usage,
            interrupted,
        })
    }

    async fn models(&self) -> Result<Vec<String>, CategorizeError> {
        let resp = self
            .http
            .get(format!("{}/v1/models", self.base_url))
            .bearer_auth(&self.api_key)
            .send()
            .await
            .map_err(|e| {
                CategorizeError::Other(format!(
                    "jev request failed: {}",
                    gripsou_core::logs::error_chain(&e)
                ))
            })?;
        let status = resp.status();
        if !status.is_success() {
            let text = resp.text().await.unwrap_or_default();
            let text: String = text.chars().take(300).collect();
            return Err(CategorizeError::Other(format!("jev {status}: {text}")));
        }
        let body: serde_json::Value = resp.json().await.unwrap_or(serde_json::Value::Null);
        let mut models = map::parse_models(&body);
        models.sort();
        models.dedup();
        Ok(models)
    }
}

/// One item's request. `Ok(None)` is a body that could not be read: the item
/// is left unanswered (sent again by a later run) and the batch goes on.
async fn ask(
    http: &reqwest::Client,
    url: &str,
    key: &str,
    body: &serde_json::Value,
) -> Result<Option<serde_json::Value>, CategorizeError> {
    let resp = http
        .post(url)
        .bearer_auth(key)
        .json(body)
        .send()
        .await
        .map_err(|e| {
            CategorizeError::Other(format!(
                "jev request failed: {}",
                gripsou_core::logs::error_chain(&e)
            ))
        })?;
    let status = resp.status();
    if status.as_u16() == 429 {
        return Err(CategorizeError::RateLimited);
    }
    if !status.is_success() {
        let text = resp.text().await.unwrap_or_default();
        // Bounded: the body can echo the prompt, and this text reaches the run row.
        let text: String = text.chars().take(300).collect();
        return Err(CategorizeError::Other(format!("jev {status}: {text}")));
    }
    match resp.json().await {
        Ok(v) => Ok(Some(v)),
        Err(e) => {
            // Left unanswered on purpose: a later run sends the item again.
            tracing::warn!(error = %gripsou_core::logs::error_chain(&e), "jev answer unreadable");
            Ok(None)
        }
    }
}
