//! The categorisation port: the budget AI's third provider port. `core` defines it; adapters in
//! `providers` implement it. No vendor type crosses into `core` — the same
//! anti-corruption discipline as `provider.rs`.
//!
//! The port is item-shaped, not prompt-shaped: how items become a request
//! (one prompt of fifty, or fifty single-choice calls) is each adapter's own
//! business. Everything an adapter returns is validated by the core
//! (`budget::ai::decide`), so an adapter never has to be trusted.

use async_trait::async_trait;
use chrono::NaiveDate;
use rust_decimal::Decimal;
use uuid::Uuid;

/// One of the user's categories, as the model sees it.
#[derive(Debug, Clone)]
pub struct CategoryOption {
    pub id: Uuid,
    pub name: String,
    /// `expense` | `income` | `neutral`.
    pub kind: String,
    /// The user's steering text (Settings → Budget → "Hint for the AI").
    pub hint: Option<String>,
}

/// A transaction the user confirmed, shown to the model as evidence.
#[derive(Debug, Clone)]
pub struct Example {
    pub description: String,
    pub amount: Decimal,
    pub currency: String,
    pub account_type: String,
    pub date: NaiveDate,
    pub category_id: Uuid,
}

/// One transaction to categorise.
#[derive(Debug, Clone)]
pub struct CategorizeItem {
    /// The transaction id. Adapters use it to match answers back; it is never
    /// sent to the model.
    pub key: Uuid,
    pub description: String,
    /// Signed, in `currency`. Negative is money out.
    pub amount: Decimal,
    pub currency: String,
    pub account_type: String,
    pub date: NaiveDate,
    /// The category ids this item may be given: by the amount's sign, plus
    /// the neutral ones (`budget::ai::candidates_for`).
    pub candidates: Vec<Uuid>,
    /// Confirmed rows with the same description, then the nearest others.
    pub examples: Vec<Example>,
}

#[derive(Debug, Clone, Default)]
pub struct CategorizeRequest {
    /// Every non-archived category of the user.
    pub categories: Vec<CategoryOption>,
    /// The most recent corrections, sent once per request.
    pub shared_examples: Vec<Example>,
    pub items: Vec<CategorizeItem>,
}

impl CategorizeRequest {
    /// The name of a category, so an example's answer can be rendered as words.
    pub fn category_name(&self, id: Uuid) -> Option<&str> {
        self.categories
            .iter()
            .find(|c| c.id == id)
            .map(|c| c.name.as_str())
    }
}

/// An adapter's answer for one item. `category_id: None` is the model saying
/// nothing fits: a final answer, unlike an item left without any guess.
#[derive(Debug, Clone, PartialEq)]
pub struct Guess {
    pub key: Uuid,
    pub category_id: Option<Uuid>,
    pub confidence: Option<Decimal>,
}

/// Tokens billed for a call. `complete: false` when the provider did not
/// report every count: the numbers are then a floor, never a confident total.
/// The default is "nothing known".
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct Usage {
    pub tokens_in: i64,
    pub tokens_out: i64,
    pub complete: bool,
}

impl Usage {
    pub fn known(tokens_in: i64, tokens_out: i64) -> Self {
        Self {
            tokens_in,
            tokens_out,
            complete: true,
        }
    }

    /// Both calls' tokens; complete only when both were.
    pub fn plus(self, other: Usage) -> Self {
        Self {
            tokens_in: self.tokens_in.saturating_add(other.tokens_in),
            tokens_out: self.tokens_out.saturating_add(other.tokens_out),
            complete: self.complete && other.complete,
        }
    }
}

#[derive(Debug, Clone, Default)]
pub struct CategorizeOutput {
    /// At most one per item that got an answer. An item with no guess at all
    /// was not answered and stays in the work set for a later run.
    pub guesses: Vec<Guess>,
    pub usage: Usage,
    /// The call stopped before every item was answered. `guesses` still holds
    /// the answers received (and `usage` their tokens), so they are written
    /// and paid for once; the run then stops as it would on an `Err`.
    pub interrupted: Option<CategorizeError>,
}

#[derive(Debug, Clone, thiserror::Error)]
pub enum CategorizeError {
    /// Quota or rate limit. The run stops cleanly as `partial`; the next run
    /// resumes from whatever is still uncategorised.
    #[error("rate limited")]
    RateLimited,
    #[error("{0}")]
    Other(String),
}

#[async_trait]
pub trait Categorizer: Send + Sync {
    /// `"gemini"` | `"jev"` — recorded on every run.
    fn key(&self) -> &str;
    fn model(&self) -> &str;
    /// How many items one `categorize` call takes. Also the run's checkpoint size.
    fn batch_size(&self) -> usize;
    async fn categorize(
        &self,
        req: &CategorizeRequest,
    ) -> Result<CategorizeOutput, CategorizeError>;
}
