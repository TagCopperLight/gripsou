//! The budget AI run: sends what pairing left uncategorised to the model, validates every answer and
//! never overwrites something a person set.

use std::collections::HashMap;

use rust_decimal::Decimal;
use uuid::Uuid;

use crate::budget::vocab::{AiRunOutcome, CategoryKind};
use crate::categorize::{CategorizeError, CategorizeItem, CategorizeRequest, Categorizer};
use crate::categorize::{CategoryOption, Guess};
use crate::error::CoreError;
use crate::repo::budget::ai as repo;
use crate::repo::budget::ai::Decision;

/// A zero amount gets no candidates.
pub fn candidates_for(amount: Decimal, categories: &[CategoryOption]) -> Vec<Uuid> {
    let side = if amount < Decimal::ZERO {
        CategoryKind::Expense
    } else if amount > Decimal::ZERO {
        CategoryKind::Income
    } else {
        return vec![];
    };
    categories
        .iter()
        .filter(|c| c.kind == side || c.kind == CategoryKind::Neutral)
        .map(|c| c.id)
        .collect()
}

/// A guess saying nothing fits, two guesses, or an id that was not offered is an abstention. An item with
/// no guess at all gets no decision and stays in the work set.
pub fn decide(items: &[CategorizeItem], guesses: Vec<Guess>) -> Vec<Decision> {
    let mut by_key: HashMap<Uuid, Vec<Guess>> = HashMap::new();
    for g in guesses {
        by_key.entry(g.key).or_default().push(g);
    }
    items
        .iter()
        .filter_map(|item| {
            let mut found = by_key.remove(&item.key)?;
            let only = if found.len() == 1 { found.pop() } else { None };
            let valid = only.and_then(|g| {
                g.category_id
                    .filter(|c| item.candidates.contains(c))
                    .map(|c| (c, g.confidence))
            });
            Some(match valid {
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
            })
        })
        .collect()
}

fn clamp_unit(d: Decimal) -> Decimal {
    d.max(Decimal::ZERO).min(Decimal::ONE)
}

const SHARED_EXAMPLES: i64 = 10;

#[derive(Debug)]
pub enum RunOutcome {
    Nothing,
    Finished {
        outcome: AiRunOutcome,
        items: i32,
        batches: i32,
    },
}

pub fn run_span(user_id: Uuid) -> tracing::Span {
    tracing::info_span!(
        "ai_run",
        user_id = %user_id,
        run_id = tracing::field::Empty,
        model = tracing::field::Empty,
    )
}

struct Tally {
    run_id: Uuid,
    batches: i32,
    items: i32,
}

/// Resumable: the work set is re-read every chunk, so a quota or a crash only leaves rows for the next run.
/// The run row is written before the first call, so spend survives a failed run. A row left `running`
/// is closed by the caller with [`repo::close_abandoned_runs`]. Run it inside [`run_span`].
pub async fn run_for_user(
    pool: &sqlx::PgPool,
    user_id: Uuid,
    categorizer: &dyn Categorizer,
) -> Result<RunOutcome, CoreError> {
    let batch = categorizer.batch_size().max(1) as i64;
    let first = repo::work_chunk(pool, user_id, &[], batch).await?;
    if first.is_empty() {
        return Ok(RunOutcome::Nothing);
    }
    let model = format!("{}:{}", categorizer.key(), categorizer.model());
    let mut tally = Tally {
        run_id: repo::start_run(pool, user_id, &model).await?,
        batches: 0,
        items: 0,
    };
    let span = tracing::Span::current();
    span.record("run_id", tracing::field::display(tally.run_id));
    span.record("model", model.as_str());
    tracing::info!("ai run started");
    let result = run_chunks(pool, user_id, categorizer, first, batch, &mut tally).await;
    let (outcome, error) = match &result {
        Ok(None) => (AiRunOutcome::Ok, None),
        Ok(Some(CategorizeError::RateLimited)) => {
            (AiRunOutcome::Partial, Some("rate limited".to_string()))
        }
        Ok(Some(CategorizeError::Other(msg))) => (AiRunOutcome::Error, Some(msg.clone())),
        Err(e) => (AiRunOutcome::Error, Some(e.to_string())),
    };
    let closed = repo::finish_run(pool, tally.run_id, outcome, error.as_deref()).await;
    match (result, closed) {
        (Err(e), closed) => {
            if let Err(e2) = closed {
                tracing::error!(run_id = %tally.run_id, error = %crate::logs::error_chain(&e2), "ai run not closed");
            }
            Err(e)
        }
        (Ok(_), Err(e)) => {
            tracing::error!(run_id = %tally.run_id, error = %crate::logs::error_chain(&e), "ai run not closed");
            Err(e)
        }
        (Ok(_), Ok(())) => Ok(RunOutcome::Finished {
            outcome,
            items: tally.items,
            batches: tally.batches,
        }),
    }
}

/// `Ok(Some(e))` is the model stopping the run; `Err` is a database failure.
async fn run_chunks(
    pool: &sqlx::PgPool,
    user_id: Uuid,
    categorizer: &dyn Categorizer,
    first: Vec<repo::WorkRow>,
    batch: i64,
    tally: &mut Tally,
) -> Result<Option<CategorizeError>, CoreError> {
    // An unanswered row must not be picked again by this run.
    let mut attempted: Vec<Uuid> = vec![];
    let categories = repo::active_categories(pool, user_id).await?;
    let shared = repo::recent_corrections(pool, user_id, SHARED_EXAMPLES).await?;
    let mut rows = first;
    while !rows.is_empty() {
        let ids: Vec<Uuid> = rows.iter().map(|r| r.id).collect();
        let mut examples = repo::examples_for(pool, user_id, &ids).await?;
        let items = rows
            .into_iter()
            .map(|r| CategorizeItem {
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

        let out = match categorizer.categorize(&req).await {
            Ok(out) => out,
            Err(e) => return Ok(Some(e)),
        };
        tally.batches += 1;
        // Record spend first: the call was paid for whatever fails next.
        repo::record_usage(pool, tally.run_id, out.usage).await?;
        let decisions = decide(&req.items, out.guesses);
        let written = repo::write_decisions(pool, user_id, &decisions).await?;
        tally.items = tally
            .items
            .saturating_add(i32::try_from(written).unwrap_or(i32::MAX));
        if out.interrupted.is_some() {
            return Ok(out.interrupted);
        }
        attempted.extend(ids);
        rows = repo::work_chunk(pool, user_id, &attempted, batch).await?;
    }
    Ok(None)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::categorize::{CategorizeItem, CategoryOption, Guess};
    use chrono::NaiveDate;
    use rust_decimal::Decimal;
    use uuid::Uuid;

    fn cat(kind: CategoryKind) -> CategoryOption {
        CategoryOption {
            id: Uuid::new_v4(),
            name: kind.to_string(),
            kind,
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
    fn money_out_sees_expense_and_neutral() {
        let cats = [
            cat(CategoryKind::Expense),
            cat(CategoryKind::Income),
            cat(CategoryKind::Neutral),
        ];
        let ids = candidates_for(Decimal::new(-500, 2), &cats);
        assert_eq!(ids, vec![cats[0].id, cats[2].id]);
    }

    #[test]
    fn money_in_sees_income_and_neutral() {
        let cats = [
            cat(CategoryKind::Expense),
            cat(CategoryKind::Income),
            cat(CategoryKind::Neutral),
        ];
        let ids = candidates_for(Decimal::new(500, 2), &cats);
        assert_eq!(ids, vec![cats[1].id, cats[2].id]);
    }

    #[test]
    fn zero_amount_has_no_candidates() {
        let cats = [cat(CategoryKind::Expense), cat(CategoryKind::Income)];
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
    fn an_item_without_a_guess_gets_no_decision() {
        let c = Uuid::new_v4();
        let (a, b) = (item(vec![c]), item(vec![c]));
        let d = decide(&[a.clone(), b], vec![guess(a.key, Some(c), None)]);
        assert_eq!(d.len(), 1, "the unanswered item stays pending");
        assert_eq!(d[0].txn_id, a.key);
    }

    #[test]
    fn a_guess_saying_nothing_fits_is_an_abstention() {
        let it = item(vec![Uuid::new_v4()]);
        let d = decide(std::slice::from_ref(&it), vec![guess(it.key, None, None)]);
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
