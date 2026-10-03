mod common;

use std::sync::Mutex;

use async_trait::async_trait;
use chrono::{Duration, Utc};
use common::{checking_account, seed_user_and_connection, txn};
use gripsou_core::budget::ai::{RunOutcome, run_for_user};
use gripsou_core::categorize::{
    CategorizeError, CategorizeOutput, CategorizeRequest, Categorizer, Guess, Usage,
};
use gripsou_core::repo::account::upsert_account;
use gripsou_core::repo::budget::ai::{last_run, remaining, work_chunk};
use gripsou_core::repo::budget::assign::set_category;
use gripsou_core::repo::budget::category::list_categories;
use gripsou_core::repo::transaction::upsert_transaction;
use rust_decimal::Decimal;
use sqlx::PgPool;
use uuid::Uuid;

type Script =
    Box<dyn Fn(&CategorizeRequest) -> Result<CategorizeOutput, CategorizeError> + Send + Sync>;

/// Records every request. Call n answers with `scripts[n]`, the last script
/// repeating. `edit_during_call` categorises one row by hand inside the call,
/// to simulate a user acting while the model is thinking. `sql_on_call` runs a
/// statement during call n, to break the database under the run.
struct Mock {
    batch: usize,
    seen: Mutex<Vec<CategorizeRequest>>,
    scripts: Vec<Script>,
    edit_during_call: Option<(PgPool, Uuid, Uuid, Uuid)>, // (pool, user, txn, category)
    sql_on_call: Option<(PgPool, usize, &'static str)>,
}

impl Mock {
    fn new(batch: usize, scripts: Vec<Script>) -> Self {
        Self {
            batch,
            seen: Mutex::new(vec![]),
            scripts,
            edit_during_call: None,
            sql_on_call: None,
        }
    }
    fn requests(&self) -> Vec<CategorizeRequest> {
        self.seen.lock().unwrap().clone()
    }
}

#[async_trait]
impl Categorizer for Mock {
    fn key(&self) -> &str {
        "mock"
    }
    fn model(&self) -> &str {
        "m1"
    }
    fn batch_size(&self) -> usize {
        self.batch
    }
    async fn categorize(
        &self,
        req: &CategorizeRequest,
    ) -> Result<CategorizeOutput, CategorizeError> {
        if let Some((pool, user, txn, cat)) = &self.edit_during_call {
            set_category(pool, *user, *txn, Some(*cat)).await.unwrap();
        }
        let n = {
            let mut seen = self.seen.lock().unwrap();
            seen.push(req.clone());
            seen.len() - 1
        };
        if let Some((pool, at, sql)) = &self.sql_on_call
            && *at == n
        {
            sqlx::query(*sql).execute(pool).await.unwrap();
        }
        (self.scripts[n.min(self.scripts.len() - 1)])(req)
    }
}

/// Answers every item with its first candidate at `conf`.
fn first_candidate(conf: Decimal) -> Script {
    Box::new(move |req| {
        Ok(CategorizeOutput {
            guesses: req
                .items
                .iter()
                .map(|it| Guess {
                    key: it.key,
                    category_id: it.candidates.first().copied(),
                    confidence: Some(conf),
                })
                .collect(),
            usage: Usage::known(10, 2),
            ..Default::default()
        })
    })
}

fn abstain_all() -> Script {
    Box::new(|req| {
        Ok(CategorizeOutput {
            guesses: req
                .items
                .iter()
                .map(|it| Guess {
                    key: it.key,
                    category_id: None,
                    confidence: None,
                })
                .collect(),
            ..Default::default()
        })
    })
}

/// `n` withdrawals of `amount`, one day apart, newest = t0. Returns (user, ids newest first).
async fn ledger(pool: &PgPool, rows: &[(&str, i64)]) -> anyhow::Result<(Uuid, Vec<Uuid>)> {
    let (user_id, conn_id) = seed_user_and_connection(pool).await;
    let mut conn = pool.acquire().await?;
    let acct = upsert_account(&mut conn, conn_id, &checking_account("a")).await?;
    let mut ids = vec![];
    for (i, (desc, cents)) in rows.iter().enumerate() {
        let mut t = txn(
            "a",
            &format!("t{i}"),
            "withdrawal",
            Decimal::new(*cents, 2),
            Some(desc),
        );
        t.ts = Utc::now() - Duration::days(i as i64);
        upsert_transaction(&mut conn, acct, &t).await?;
        ids.push(
            sqlx::query_scalar("select id from transaction where external_id = $1")
                .bind(format!("t{i}"))
                .fetch_one(pool)
                .await?,
        );
    }
    Ok((user_id, ids))
}

async fn row(pool: &PgPool, id: Uuid) -> (Option<Uuid>, Option<String>, Option<Decimal>) {
    sqlx::query_as("select budget_category_id, category_source, category_confidence from transaction where id = $1")
        .bind(id).fetch_one(pool).await.unwrap()
}

#[sqlx::test(migrations = "../migrations")]
async fn guesses_are_written_as_ai_with_their_confidence(pool: PgPool) -> anyhow::Result<()> {
    let (user_id, ids) = ledger(&pool, &[("LECLERC", -1200), ("SNCF", -4500)]).await?;
    let mock = Mock::new(50, vec![first_candidate(Decimal::new(91, 2))]);

    let out = run_for_user(&pool, user_id, &mock).await?;

    assert!(
        matches!(out, RunOutcome::Finished { ref outcome, items: 2, batches: 1 } if outcome == "ok")
    );
    let (cat, source, conf) = row(&pool, ids[0]).await;
    assert!(cat.is_some());
    assert_eq!(source.as_deref(), Some("ai"));
    assert_eq!(conf, Some(Decimal::new(91, 2)));
    let run = last_run(&pool, user_id).await?.unwrap();
    assert_eq!(run.outcome, "ok");
    let (model, tin, tout, complete): (String, i64, i64, bool) = sqlx::query_as(
        "select model, tokens_in, tokens_out, usage_complete from budget_ai_run where user_id = $1",
    )
    .bind(user_id)
    .fetch_one(&pool)
    .await?;
    assert_eq!(model, "mock:m1");
    assert_eq!((tin, tout, complete), (10, 2, true));
    Ok(())
}

#[sqlx::test(migrations = "../migrations")]
async fn an_abstention_is_written_as_a_review_row(pool: PgPool) -> anyhow::Result<()> {
    let (user_id, ids) = ledger(&pool, &[("???", -1200)]).await?;
    run_for_user(&pool, user_id, &Mock::new(50, vec![abstain_all()])).await?;
    assert_eq!(
        row(&pool, ids[0]).await,
        (None, Some("ai".to_string()), None)
    );
    assert_eq!(remaining(&pool, user_id).await?, 0, "never re-sent");
    Ok(())
}

#[sqlx::test(migrations = "../migrations")]
async fn candidates_follow_the_sign_and_skip_archived(pool: PgPool) -> anyhow::Result<()> {
    let (user_id, _) = ledger(&pool, &[("OUT", -1200), ("IN", 5000)]).await?;
    let cats = list_categories(&pool, user_id).await?;
    let groceries = cats
        .iter()
        .find(|c| c.default_key.as_deref() == Some("groceries"))
        .unwrap()
        .id;
    sqlx::query("update budget_category set archived_at = now() where id = $1")
        .bind(groceries)
        .execute(&pool)
        .await?;
    let mock = Mock::new(50, vec![abstain_all()]);

    run_for_user(&pool, user_id, &mock).await?;

    let req = &mock.requests()[0];
    let kind = |id: &Uuid| cats.iter().find(|c| c.id == *id).unwrap().kind.clone();
    let out = req.items.iter().find(|i| i.description == "OUT").unwrap();
    let inn = req.items.iter().find(|i| i.description == "IN").unwrap();
    assert!(
        out.candidates
            .iter()
            .all(|c| ["expense", "neutral"].contains(&kind(c).as_str()))
    );
    assert!(
        inn.candidates
            .iter()
            .all(|c| ["income", "neutral"].contains(&kind(c).as_str()))
    );
    assert!(!out.candidates.contains(&groceries));
    assert!(req.categories.iter().all(|c| c.id != groceries));
    Ok(())
}

#[sqlx::test(migrations = "../migrations")]
async fn confirmed_rows_with_the_same_description_are_evidence(pool: PgPool) -> anyhow::Result<()> {
    let (user_id, ids) = ledger(
        &pool,
        &[
            ("PAYPAL *XYZ 1234", -999),
            ("PAYPAL *XYZ 5678", -999),
            ("PAYPAL *XYZ 9012", -4200),
        ],
    )
    .await?;
    let subscriptions = list_categories(&pool, user_id)
        .await?
        .into_iter()
        .find(|c| c.default_key.as_deref() == Some("subscriptions"))
        .unwrap()
        .id;
    // The two older rows are the user's own decisions.
    set_category(&pool, user_id, ids[1], Some(subscriptions)).await?;
    set_category(&pool, user_id, ids[2], Some(subscriptions)).await?;
    let mock = Mock::new(50, vec![abstain_all()]);

    run_for_user(&pool, user_id, &mock).await?;

    let req = &mock.requests()[0];
    assert_eq!(req.items.len(), 1, "only the uncategorised row is sent");
    let ex = &req.items[0].examples;
    assert_eq!(ex.len(), 2);
    assert!(
        ex.iter().any(|e| e.amount == Decimal::new(-4200, 2)),
        "amounts travel with the evidence"
    );
    assert!(
        req.shared_examples.len() >= 2,
        "recent corrections are shared"
    );
    Ok(())
}

#[sqlx::test(migrations = "../migrations")]
async fn a_similar_confirmed_description_is_a_neighbour(pool: PgPool) -> anyhow::Result<()> {
    let (user_id, ids) = ledger(
        &pool,
        &[
            ("CARREFOUR CITY PARIS", -1200),
            ("CARREFOUR CITY LYON", -3000),
        ],
    )
    .await?;
    let groceries = list_categories(&pool, user_id)
        .await?
        .into_iter()
        .find(|c| c.default_key.as_deref() == Some("groceries"))
        .unwrap()
        .id;
    set_category(&pool, user_id, ids[1], Some(groceries)).await?;
    let mock = Mock::new(50, vec![abstain_all()]);
    run_for_user(&pool, user_id, &mock).await?;
    let ex = &mock.requests()[0].items[0].examples;
    assert_eq!(ex.len(), 1);
    assert_eq!(ex[0].description, "CARREFOUR CITY LYON");
    Ok(())
}

#[sqlx::test(migrations = "../migrations")]
async fn a_row_set_by_hand_during_the_call_is_not_overwritten(pool: PgPool) -> anyhow::Result<()> {
    let (user_id, ids) = ledger(&pool, &[("LECLERC", -1200)]).await?;
    let groceries = list_categories(&pool, user_id)
        .await?
        .into_iter()
        .find(|c| c.default_key.as_deref() == Some("groceries"))
        .unwrap()
        .id;
    let mut mock = Mock::new(50, vec![abstain_all()]);
    mock.edit_during_call = Some((pool.clone(), user_id, ids[0], groceries));

    run_for_user(&pool, user_id, &mock).await?;

    let (cat, source, _) = row(&pool, ids[0]).await;
    assert_eq!(cat, Some(groceries));
    assert_eq!(source.as_deref(), Some("user"));
    Ok(())
}

#[sqlx::test(migrations = "../migrations")]
async fn a_rate_limit_stops_as_partial_and_the_next_run_resumes(
    pool: PgPool,
) -> anyhow::Result<()> {
    let (user_id, ids) = ledger(&pool, &[("A", -100), ("B", -200), ("C", -300)]).await?;
    let limited: Script = Box::new(|_| Err(CategorizeError::RateLimited));
    let mock = Mock::new(2, vec![first_candidate(Decimal::new(9, 1)), limited]);

    let out = run_for_user(&pool, user_id, &mock).await?;
    assert!(
        matches!(out, RunOutcome::Finished { ref outcome, items: 2, .. } if outcome == "partial")
    );
    // Newest first: A and B were in the first chunk.
    assert_eq!(row(&pool, ids[0]).await.1.as_deref(), Some("ai"));
    assert_eq!(row(&pool, ids[2]).await.1, None);
    assert_eq!(remaining(&pool, user_id).await?, 1);

    run_for_user(
        &pool,
        user_id,
        &Mock::new(2, vec![first_candidate(Decimal::new(9, 1))]),
    )
    .await?;
    assert_eq!(remaining(&pool, user_id).await?, 0);
    Ok(())
}

#[sqlx::test(migrations = "../migrations")]
async fn a_failed_call_records_its_message_and_writes_nothing(pool: PgPool) -> anyhow::Result<()> {
    let (user_id, ids) = ledger(&pool, &[("A", -100)]).await?;
    let boom: Script = Box::new(|_| Err(CategorizeError::Other("API key not valid".into())));
    run_for_user(&pool, user_id, &Mock::new(50, vec![boom])).await?;
    assert_eq!(row(&pool, ids[0]).await.1, None);
    let run = last_run(&pool, user_id).await?.unwrap();
    assert_eq!(run.outcome, "error");
    assert_eq!(run.error.as_deref(), Some("API key not valid"));
    Ok(())
}

#[sqlx::test(migrations = "../migrations")]
async fn nothing_to_do_writes_no_run_row(pool: PgPool) -> anyhow::Result<()> {
    let (user_id, _) = ledger(&pool, &[]).await?;
    let out = run_for_user(&pool, user_id, &Mock::new(50, vec![abstain_all()])).await?;
    assert!(matches!(out, RunOutcome::Nothing));
    assert!(last_run(&pool, user_id).await?.is_none());
    Ok(())
}

#[sqlx::test(migrations = "../migrations")]
async fn a_held_lock_makes_the_call_a_no_op(pool: PgPool) -> anyhow::Result<()> {
    let (user_id, _) = ledger(&pool, &[("A", -100)]).await?;
    sqlx::query("insert into budget_ai_lock (user_id) values ($1)")
        .bind(user_id)
        .execute(&pool)
        .await?;
    let mock = Mock::new(50, vec![abstain_all()]);
    assert!(matches!(
        run_for_user(&pool, user_id, &mock).await?,
        RunOutcome::Busy
    ));
    assert!(mock.requests().is_empty());

    assert_eq!(
        gripsou_core::repo::budget::ai::clear_all_locks(&pool).await?,
        1
    );
    assert!(!gripsou_core::repo::budget::ai::is_locked(&pool, user_id).await?);
    Ok(())
}

/// Answers only the first item of each request.
fn first_item_only() -> Script {
    Box::new(|req| {
        Ok(CategorizeOutput {
            guesses: vec![Guess {
                key: req.items[0].key,
                category_id: req.items[0].candidates.first().copied(),
                confidence: Some(Decimal::ONE),
            }],
            usage: Usage::known(10, 2),
            ..Default::default()
        })
    })
}

#[sqlx::test(migrations = "../migrations")]
async fn an_item_the_model_skipped_is_sent_again_by_the_next_run(
    pool: PgPool,
) -> anyhow::Result<()> {
    let (user_id, ids) = ledger(&pool, &[("A", -100), ("B", -200), ("C", -300)]).await?;
    let mock = Mock::new(50, vec![first_item_only()]);

    let out = run_for_user(&pool, user_id, &mock).await?;

    assert!(
        matches!(out, RunOutcome::Finished { ref outcome, items: 1, batches: 1 } if outcome == "ok")
    );
    assert_eq!(mock.requests().len(), 1, "not re-sent within the run");
    assert_eq!(row(&pool, ids[0]).await.1.as_deref(), Some("ai"));
    assert_eq!(
        row(&pool, ids[1]).await,
        (None, None, None),
        "still pending"
    );
    assert_eq!(remaining(&pool, user_id).await?, 2);

    let next = Mock::new(50, vec![abstain_all()]);
    run_for_user(&pool, user_id, &next).await?;
    let sent: Vec<Uuid> = next.requests()[0].items.iter().map(|i| i.key).collect();
    assert_eq!(sent, vec![ids[1], ids[2]]);
    Ok(())
}

#[sqlx::test(migrations = "../migrations")]
async fn answers_received_before_an_interruption_are_kept(pool: PgPool) -> anyhow::Result<()> {
    let (user_id, ids) = ledger(&pool, &[("A", -100), ("B", -200), ("C", -300)]).await?;
    let cut: Script = Box::new(|req| {
        let mut out = (first_item_only())(req)?;
        out.interrupted = Some(CategorizeError::RateLimited);
        Ok(out)
    });
    let mock = Mock::new(50, vec![cut]);

    let out = run_for_user(&pool, user_id, &mock).await?;

    assert!(
        matches!(out, RunOutcome::Finished { ref outcome, items: 1, .. } if outcome == "partial")
    );
    assert_eq!(row(&pool, ids[0]).await.1.as_deref(), Some("ai"));
    assert_eq!(remaining(&pool, user_id).await?, 2);
    let (tin, outcome): (i64, String) =
        sqlx::query_as("select tokens_in, outcome from budget_ai_run where user_id = $1")
            .bind(user_id)
            .fetch_one(&pool)
            .await?;
    assert_eq!((tin, outcome.as_str()), (10, "partial"));
    Ok(())
}

#[sqlx::test(migrations = "../migrations")]
async fn a_database_failure_mid_run_keeps_the_spend_and_says_so(
    pool: PgPool,
) -> anyhow::Result<()> {
    let (user_id, ids) = ledger(&pool, &[("A", -100), ("B", -200), ("C", -300)]).await?;
    let mut mock = Mock::new(2, vec![first_candidate(Decimal::new(9, 1))]);
    // From the second call on, writing an AI answer is refused.
    mock.sql_on_call = Some((
        pool.clone(),
        1,
        "alter table transaction add constraint no_ai check (category_source is distinct from 'ai') not valid",
    ));

    let before = Utc::now();
    assert!(run_for_user(&pool, user_id, &mock).await.is_err());

    assert_eq!(row(&pool, ids[0]).await.1.as_deref(), Some("ai"));
    assert_eq!(row(&pool, ids[2]).await.1, None);
    let (tin, tout, started): (i64, i64, chrono::DateTime<Utc>) = sqlx::query_as(
        "select tokens_in, tokens_out, started_at from budget_ai_run where user_id = $1",
    )
    .bind(user_id)
    .fetch_one(&pool)
    .await?;
    assert_eq!((tin, tout), (20, 4), "both paid calls are logged");
    assert!(started <= before + Duration::seconds(1));
    let run = last_run(&pool, user_id).await?.unwrap();
    assert_eq!(run.outcome, "error");
    assert!(run.error.unwrap().contains("no_ai"));
    assert!(!gripsou_core::repo::budget::ai::is_locked(&pool, user_id).await?);
    Ok(())
}

#[sqlx::test(migrations = "../migrations")]
async fn a_run_left_running_is_closed_by_the_next_one(pool: PgPool) -> anyhow::Result<()> {
    let (user_id, _) = ledger(&pool, &[("A", -100)]).await?;
    let dead = gripsou_core::repo::budget::ai::start_run(&pool, user_id, "mock:m1").await?;
    assert!(
        last_run(&pool, user_id).await?.is_none(),
        "a live run is not the last result"
    );

    run_for_user(&pool, user_id, &Mock::new(50, vec![abstain_all()])).await?;

    let outcome: String = sqlx::query_scalar("select outcome from budget_ai_run where id = $1")
        .bind(dead)
        .fetch_one(&pool)
        .await?;
    assert_eq!(outcome, "error");
    assert_eq!(last_run(&pool, user_id).await?.unwrap().outcome, "ok");
    Ok(())
}

#[sqlx::test(migrations = "../migrations")]
async fn a_stale_lock_is_taken_over(pool: PgPool) -> anyhow::Result<()> {
    let (user_id, _) = ledger(&pool, &[("A", -100)]).await?;
    sqlx::query(
        "insert into budget_ai_lock (user_id, heartbeat_at) values ($1, now() - interval '2 hours')",
    )
    .bind(user_id)
    .execute(&pool)
    .await?;
    let mock = Mock::new(50, vec![abstain_all()]);
    assert!(matches!(
        run_for_user(&pool, user_id, &mock).await?,
        RunOutcome::Finished { .. }
    ));
    assert!(!gripsou_core::repo::budget::ai::is_locked(&pool, user_id).await?);
    Ok(())
}

#[sqlx::test(migrations = "../migrations")]
async fn another_users_rows_are_never_written(pool: PgPool) -> anyhow::Result<()> {
    let (alice, ids) = ledger(&pool, &[("A", -100)]).await?;
    let (bob, _) = ledger(&pool, &[]).await?;
    let written = gripsou_core::repo::budget::ai::write_decisions(
        &pool,
        bob,
        &[gripsou_core::budget::ai::Decision {
            txn_id: ids[0],
            category_id: None,
            confidence: None,
        }],
    )
    .await?;
    assert_eq!(written, 0);
    assert_eq!(row(&pool, ids[0]).await.1, None);
    let _ = alice;
    Ok(())
}

/// The AI never sees a buy/sell: the list hides them, so a guess on one could
/// never be reviewed. Same rule for the chunk and the "N left" count.
#[sqlx::test(migrations = "../migrations")]
async fn the_work_set_skips_buy_and_sell(pool: PgPool) -> anyhow::Result<()> {
    let (user_id, conn_id) = common::seed_user_and_connection(&pool).await;
    let mut conn = pool.acquire().await?;
    let acct = gripsou_core::repo::account::upsert_account(
        &mut conn,
        conn_id,
        &common::checking_account("acct-1"),
    )
    .await?;
    for (ext, kind, amount, desc) in [
        ("t1", "withdrawal", "-12.00", "BOULANGERIE"),
        ("t2", "buy", "-50.00", "SpaceX Ordre d'achat"),
        ("t3", "sell", "55.63", "Micron Ordre de vente"),
    ] {
        gripsou_core::repo::transaction::upsert_transaction(
            &mut conn,
            acct,
            &common::txn("acct-1", ext, kind, amount.parse().unwrap(), Some(desc)),
        )
        .await?;
    }
    drop(conn);

    let chunk = work_chunk(&pool, user_id, &[], 50).await?;
    assert_eq!(
        chunk
            .iter()
            .map(|r| r.description.as_deref())
            .collect::<Vec<_>>(),
        vec![Some("BOULANGERIE")]
    );
    assert_eq!(remaining(&pool, user_id).await?, 1);
    Ok(())
}
