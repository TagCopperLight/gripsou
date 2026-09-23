//! What AI categorisation has cost: the run log's token totals priced with
//! the admin-entered per-model rates (USD per million tokens).

use rust_decimal::Decimal;

use crate::error::CoreError;
use crate::repo::budget::ai::usage_by_model;
use crate::repo::settings::{ModelPrice, budget_ai_prices};

const PER: Decimal = Decimal::from_parts(1_000_000, 0, 0, false, 0);

/// Cost of the given token counts at `price`. Full precision; callers round.
pub fn cost_of(tokens_in: i64, tokens_out: i64, price: &ModelPrice) -> Decimal {
    Decimal::from(tokens_in) / PER * price.input + Decimal::from(tokens_out) / PER * price.output
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ModelCost {
    pub model: String,
    pub runs: i64,
    pub runs_without_usage: i64,
    pub tokens_in: i64,
    pub tokens_out: i64,
    /// `None` when no price was entered for this model.
    pub price: Option<ModelPrice>,
    pub cost: Option<Decimal>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UsageReport {
    /// Only models that have runs, ordered by model key.
    pub models: Vec<ModelCost>,
    /// Sum of the priced models' costs.
    pub total_cost: Decimal,
}

pub async fn usage_report(pool: &sqlx::PgPool) -> Result<UsageReport, CoreError> {
    let prices = budget_ai_prices(pool).await?;
    let models: Vec<ModelCost> = usage_by_model(pool)
        .await?
        .into_iter()
        .map(|u| {
            let price = prices.get(&u.model).cloned();
            let cost = price
                .as_ref()
                .map(|p| cost_of(u.tokens_in, u.tokens_out, p));
            ModelCost {
                model: u.model,
                runs: u.runs,
                runs_without_usage: u.runs_without_usage,
                tokens_in: u.tokens_in,
                tokens_out: u.tokens_out,
                price,
                cost,
            }
        })
        .collect();
    let total_cost = models.iter().filter_map(|m| m.cost).sum();
    Ok(UsageReport { models, total_cost })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cost_is_per_million_tokens() {
        let p = ModelPrice {
            input: Decimal::new(10, 2),
            output: Decimal::new(40, 2),
        };
        assert_eq!(cost_of(1_000_000, 500_000, &p), Decimal::new(30, 2));
        assert_eq!(cost_of(0, 0, &p), Decimal::ZERO);
        assert_eq!(cost_of(1, 0, &p), Decimal::new(1, 7));
    }
}
