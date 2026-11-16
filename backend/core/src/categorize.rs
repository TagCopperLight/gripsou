//! The categorisation port: the budget AI's provider port. `core` defines it, adapters in `providers`
//! implement it, and no vendor type crosses into `core`.
//!
//! The port is item-shaped, not prompt-shaped: how items become requests is each adapter's business.
//! The core validates everything an adapter returns (`budget::ai::decide`).

use async_trait::async_trait;
use chrono::NaiveDate;
use rust_decimal::Decimal;
use uuid::Uuid;

#[derive(Debug, Clone)]
pub struct CategoryOption {
    pub id: Uuid,
    pub name: String,
    pub kind: crate::budget::vocab::CategoryKind,
    pub hint: Option<String>,
}

#[derive(Debug, Clone)]
pub struct Example {
    pub description: String,
    pub amount: Decimal,
    pub currency: String,
    pub account_type: String,
    pub date: NaiveDate,
    pub category_id: Uuid,
}

#[derive(Debug, Clone)]
pub struct CategorizeItem {
    /// Adapters use it to match answers back; it is never sent to the model.
    pub key: Uuid,
    pub description: String,
    pub amount: Decimal,
    pub currency: String,
    pub account_type: String,
    pub date: NaiveDate,
    pub candidates: Vec<Uuid>,
    pub examples: Vec<Example>,
}

#[derive(Debug, Clone, Default)]
pub struct CategorizeRequest {
    pub categories: Vec<CategoryOption>,
    pub shared_examples: Vec<Example>,
    pub items: Vec<CategorizeItem>,
}

impl CategorizeRequest {
    pub fn category_name(&self, id: Uuid) -> Option<&str> {
        self.categories
            .iter()
            .find(|c| c.id == id)
            .map(|c| c.name.as_str())
    }
}

/// `category_id: None` is a final "nothing fits", unlike an item left without a guess.
#[derive(Debug, Clone, PartialEq)]
pub struct Guess {
    pub key: Uuid,
    pub category_id: Option<Uuid>,
    pub confidence: Option<Decimal>,
}

/// `complete: false` when the provider did not report every count: the numbers are then a floor.
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
    /// An item with no guess was not answered and stays in the work set.
    pub guesses: Vec<Guess>,
    pub usage: Usage,
    /// The call stopped before every item was answered. `guesses` and `usage` still hold what was received.
    pub interrupted: Option<CategorizeError>,
}

#[derive(Debug, Clone, thiserror::Error)]
pub enum CategorizeError {
    /// Quota or rate limit: the run stops as `partial`.
    #[error("rate limited")]
    RateLimited,
    #[error("{0}")]
    Other(String),
}

#[async_trait]
pub trait Categorizer: Send + Sync {
    fn key(&self) -> &str;
    fn model(&self) -> &str;
    /// How many items one `categorize` call takes. Also the run's checkpoint size.
    fn batch_size(&self) -> usize;
    async fn categorize(
        &self,
        req: &CategorizeRequest,
    ) -> Result<CategorizeOutput, CategorizeError>;
    /// Only models the adapter can drive; fills the admin's model dropdown.
    async fn models(&self) -> Result<Vec<String>, CategorizeError>;
}
