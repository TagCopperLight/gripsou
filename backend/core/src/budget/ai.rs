//! Stage 4 of the pipeline (phase 5 spec §4): send what pairing left
//! uncategorised to the configured model, validate every answer, and write it
//! back without ever overwriting something a person set.

use std::collections::HashMap;

use rust_decimal::Decimal;
use uuid::Uuid;

use crate::categorize::{CategorizeError, CategorizeRequest, Categorizer};
use crate::categorize::{CategorizeItem, CategoryOption, Guess};
use crate::error::CoreError;
use crate::repo::budget::ai as repo;

/// What gets written for one transaction. `category_id: None` is an
/// abstention, which lands in the review queue as "no guess" (spec §2.5).
#[derive(Debug, Clone, PartialEq)]
pub struct Decision {
    pub txn_id: Uuid,
    pub category_id: Option<Uuid>,
    pub confidence: Option<Decimal>,
}

/// The ids an item may be given, by the sign of its amount (spec §4.2).
/// `categories` is already the non-archived list. A zero amount gets none.
pub fn candidates_for(amount: Decimal, categories: &[CategoryOption]) -> Vec<Uuid> {
    let side = if amount < Decimal::ZERO {
        "expense"
    } else if amount > Decimal::ZERO {
        "income"
    } else {
        return vec![];
    };
    categories
        .iter()
        .filter(|c| c.kind == side || c.kind == "internal" || c.kind == "excluded")
        .map(|c| c.id)
        .collect()
}

/// One decision per item, in item order, whatever the adapter returned:
/// exactly one guess whose id is among the item's candidates is kept;
/// anything else — no guess, two guesses, an id it was not offered — is an
/// abstention. Guesses for keys that are not items are dropped.
pub fn decide(items: &[CategorizeItem], guesses: Vec<Guess>) -> Vec<Decision> {
    let mut by_key: HashMap<Uuid, Vec<Guess>> = HashMap::new();
    for g in guesses {
        by_key.entry(g.key).or_default().push(g);
    }
    items
        .iter()
        .map(|item| {
            let mut found = by_key.remove(&item.key).unwrap_or_default();
            let only = if found.len() == 1 { found.pop() } else { None };
            let valid = only.and_then(|g| {
                g.category_id
                    .filter(|c| item.candidates.contains(c))
                    .map(|c| (c, g.confidence))
            });
            match valid {
                Some((category, confidence)) => Decision {
                    txn_id: item.key,
                    category_id: Some(category),
                    confidence: confidence.map(clamp_unit),
                },
                None => Decision {
                    txn_id: item.key,
                    category_id: None,
                    confidence: None,
                },
            }
        })
        .collect()
}

fn clamp_unit(d: Decimal) -> Decimal {
    d.max(Decimal::ZERO).min(Decimal::ONE)
}

/// The most recent corrections every request carries (spec §4.3).
const SHARED_EXAMPLES: i64 = 10;

#[derive(Debug)]
pub enum RunOutcome {
    /// Another run holds this user.
    Busy,
    /// Nothing was uncategorised; no run row written.
    Nothing,
    /// `outcome` is `ok` | `partial` | `error`, as written to `budget_ai_run`.
    Finished {
        outcome: String,
        items: i32,
        batches: i32,
    },
}

/// Categorise everything the user still has uncategorised, chunk by chunk,
/// until the work set is empty or the model stops answering. Resumable by
/// construction: the work set is re-read every chunk, so a quota or a crash
/// only leaves rows for the next run.
pub async fn run_for_user(
    pool: &sqlx::PgPool,
    user_id: Uuid,
    categorizer: &dyn Categorizer,
) -> Result<RunOutcome, CoreError> {
    if !repo::try_lock(pool, user_id).await? {
        return Ok(RunOutcome::Busy);
    }
    let result = run_locked(pool, user_id, categorizer).await;
    if let Err(e) = repo::unlock(pool, user_id).await {
        tracing::warn!("budget AI lock for {user_id} not released: {e}");
    }
    result
}

fn add(a: Option<i32>, b: Option<i32>) -> Option<i32> {
    match (a, b) {
        (None, None) => None,
        (a, b) => Some(a.unwrap_or(0).saturating_add(b.unwrap_or(0))),
    }
}

async fn run_locked(
    pool: &sqlx::PgPool,
    user_id: Uuid,
    categorizer: &dyn Categorizer,
) -> Result<RunOutcome, CoreError> {
    let categories = repo::active_categories(pool, user_id).await?;
    let shared = repo::recent_corrections(pool, user_id, SHARED_EXAMPLES).await?;
    let mut rec = repo::RunRecord {
        model: format!("{}:{}", categorizer.key(), categorizer.model()),
        batches: 0,
        items: 0,
        tokens_in: None,
        tokens_out: None,
        outcome: "ok".to_string(),
        error: None,
    };
    let batch = categorizer.batch_size().max(1) as i64;

    loop {
        let rows = repo::work_chunk(pool, user_id, batch).await?;
        if rows.is_empty() {
            break;
        }
        let ids: Vec<Uuid> = rows.iter().map(|r| r.id).collect();
        let mut examples = repo::examples_for(pool, user_id, &ids).await?;
        let items = rows
            .into_iter()
            .map(|r| crate::categorize::CategorizeItem {
                key: r.id,
                description: r.description.unwrap_or_default(),
                candidates: candidates_for(r.amount, &categories),
                examples: examples.remove(&r.id).unwrap_or_default(),
                amount: r.amount,
                currency: r.currency,
                account_type: r.account_type,
                date: r.day,
            })
            .collect();
        let req = CategorizeRequest {
            categories: categories.clone(),
            shared_examples: shared.clone(),
            items,
        };

        match categorizer.categorize(&req).await {
            Ok(out) => {
                rec.batches += 1;
                rec.tokens_in = add(rec.tokens_in, out.tokens_in);
                rec.tokens_out = add(rec.tokens_out, out.tokens_out);
                let decisions = decide(&req.items, out.guesses);
                let written = repo::write_decisions(pool, &decisions).await?;
                rec.items += written as i32;
                // Every row of a chunk is either written or was taken by
                // someone else meanwhile; neither comes back. Zero written
                // means something is wrong with the guard — stop rather
                // than loop.
                if written == 0 {
                    break;
                }
            }
            Err(CategorizeError::RateLimited) => {
                rec.outcome = "partial".to_string();
                rec.error = Some("rate limited".to_string());
                break;
            }
            Err(CategorizeError::Other(msg)) => {
                rec.outcome = "error".to_string();
                rec.error = Some(msg);
                break;
            }
        }
    }

    if rec.batches == 0 && rec.outcome == "ok" {
        return Ok(RunOutcome::Nothing);
    }
    repo::insert_run(pool, user_id, &rec).await?;
    Ok(RunOutcome::Finished {
        outcome: rec.outcome,
        items: rec.items,
        batches: rec.batches,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::categorize::{CategorizeItem, CategoryOption, Guess};
    use chrono::NaiveDate;
    use rust_decimal::Decimal;
    use uuid::Uuid;

    fn cat(kind: &str) -> CategoryOption {
        CategoryOption {
            id: Uuid::new_v4(),
            name: kind.into(),
            kind: kind.into(),
            hint: None,
        }
    }

    fn item(candidates: Vec<Uuid>) -> CategorizeItem {
        CategorizeItem {
            key: Uuid::new_v4(),
            description: "LECLERC".into(),
            amount: Decimal::new(-1200, 2),
            currency: "EUR".into(),
            account_type: "checking".into(),
            date: NaiveDate::from_ymd_opt(2026, 9, 1).unwrap(),
            candidates,
            examples: vec![],
        }
    }

    fn guess(key: Uuid, cat: Option<Uuid>, conf: Option<Decimal>) -> Guess {
        Guess {
            key,
            category_id: cat,
            confidence: conf,
        }
    }

    #[test]
    fn money_out_sees_expense_internal_excluded() {
        let cats = [
            cat("expense"),
            cat("income"),
            cat("internal"),
            cat("excluded"),
        ];
        let ids = candidates_for(Decimal::new(-500, 2), &cats);
        assert_eq!(ids, vec![cats[0].id, cats[2].id, cats[3].id]);
    }

    #[test]
    fn money_in_sees_income_internal_excluded() {
        let cats = [
            cat("expense"),
            cat("income"),
            cat("internal"),
            cat("excluded"),
        ];
        let ids = candidates_for(Decimal::new(500, 2), &cats);
        assert_eq!(ids, vec![cats[1].id, cats[2].id, cats[3].id]);
    }

    #[test]
    fn zero_amount_has_no_candidates() {
        let cats = [cat("expense"), cat("income")];
        assert!(candidates_for(Decimal::ZERO, &cats).is_empty());
    }

    #[test]
    fn a_valid_guess_passes_through() {
        let c = Uuid::new_v4();
        let it = item(vec![c]);
        let d = decide(
            std::slice::from_ref(&it),
            vec![guess(it.key, Some(c), Some(Decimal::new(82, 2)))],
        );
        assert_eq!(d.len(), 1);
        assert_eq!(d[0].txn_id, it.key);
        assert_eq!(d[0].category_id, Some(c));
        assert_eq!(d[0].confidence, Some(Decimal::new(82, 2)));
    }

    #[test]
    fn an_id_outside_the_candidates_is_an_abstention() {
        let it = item(vec![Uuid::new_v4()]);
        let d = decide(
            std::slice::from_ref(&it),
            vec![guess(it.key, Some(Uuid::new_v4()), Some(Decimal::ONE))],
        );
        assert_eq!(d[0].category_id, None);
        assert_eq!(d[0].confidence, None);
    }

    #[test]
    fn a_missing_guess_is_an_abstention() {
        let it = item(vec![Uuid::new_v4()]);
        let d = decide(std::slice::from_ref(&it), vec![]);
        assert_eq!(d.len(), 1);
        assert_eq!(d[0].category_id, None);
    }

    #[test]
    fn two_guesses_for_one_item_are_an_abstention() {
        let c = Uuid::new_v4();
        let it = item(vec![c]);
        let d = decide(
            std::slice::from_ref(&it),
            vec![guess(it.key, Some(c), None), guess(it.key, Some(c), None)],
        );
        assert_eq!(d[0].category_id, None);
    }

    #[test]
    fn a_guess_for_an_unknown_key_is_ignored() {
        let c = Uuid::new_v4();
        let it = item(vec![c]);
        let d = decide(
            std::slice::from_ref(&it),
            vec![
                guess(Uuid::new_v4(), Some(c), None),
                guess(it.key, Some(c), None),
            ],
        );
        assert_eq!(d.len(), 1);
        assert_eq!(d[0].category_id, Some(c));
    }

    #[test]
    fn confidence_is_clamped_to_the_unit_interval() {
        let c = Uuid::new_v4();
        let (a, b) = (item(vec![c]), item(vec![c]));
        let d = decide(
            &[a.clone(), b.clone()],
            vec![
                guess(a.key, Some(c), Some(Decimal::new(17, 1))),
                guess(b.key, Some(c), Some(Decimal::new(-2, 1))),
            ],
        );
        assert_eq!(d[0].confidence, Some(Decimal::ONE));
        assert_eq!(d[1].confidence, Some(Decimal::ZERO));
    }
}
