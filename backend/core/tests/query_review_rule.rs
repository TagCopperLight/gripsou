mod common;

use common::{checking_account, seed_user_and_connection, txn};
use gripsou_core::repo::account::upsert_account;
use gripsou_core::repo::budget::category::list_categories;
use gripsou_core::repo::query::{
    TransactionFilters, matching_transaction_ids, transaction_counts, transactions,
};
use gripsou_core::repo::transaction::upsert_transaction;
use rust_decimal::Decimal;
use sqlx::PgPool;
use uuid::Uuid;

/// Seeds four AI-guessed rows and returns (user, ids by label).
async fn seed(pool: &PgPool) -> anyhow::Result<(Uuid, Vec<(&'static str, Uuid)>)> {
    let (user_id, conn_id) = seed_user_and_connection(pool).await;
    let mut conn = pool.acquire().await?;
    let acct = upsert_account(&mut conn, conn_id, &checking_account("a")).await?;
    let cats = list_categories(pool, user_id).await?;
    let by_key = |k: &str| {
        cats.iter()
            .find(|c| c.default_key.as_deref() == Some(k))
            .unwrap()
            .id
    };
    let groceries = by_key("groceries");
    let savings = by_key("savings");

    // (label, category, confidence, reviewed)
    let rows: [(&str, Option<Uuid>, Option<Decimal>, bool); 5] = [
        ("low", Some(groceries), Some(Decimal::new(50, 2)), false),
        ("high", Some(groceries), Some(Decimal::new(95, 2)), false),
        (
            "internal_high",
            Some(savings),
            Some(Decimal::new(99, 2)),
            false,
        ),
        ("no_guess", None, None, false),
        (
            "reviewed_low",
            Some(groceries),
            Some(Decimal::new(10, 2)),
            true,
        ),
    ];
    let mut out = vec![];
    for (i, (label, cat, conf, reviewed)) in rows.into_iter().enumerate() {
        upsert_transaction(
            &mut conn,
            acct,
            &txn(
                "a",
                &format!("t{i}"),
                "withdrawal",
                Decimal::new(-1000, 2),
                Some(label),
            ),
        )
        .await?;
        let id: Uuid = sqlx::query_scalar("select id from transaction where external_id = $1")
            .bind(format!("t{i}"))
            .fetch_one(pool)
            .await?;
        sqlx::query(
            "update transaction set budget_category_id = $2, category_source = 'ai', \
             category_confidence = $3, category_reviewed_at = case when $4 then now() end where id = $1",
        )
        .bind(id).bind(cat).bind(conf).bind(reviewed)
        .execute(pool)
        .await?;
        out.push((label, id));
    }
    Ok((user_id, out))
}

fn review_filter(threshold: Decimal) -> TransactionFilters {
    TransactionFilters {
        needs_review: true,
        include_transfers: true,
        review_threshold: threshold,
        ..TransactionFilters::unfiltered()
    }
}

#[sqlx::test(migrations = "../migrations")]
async fn the_queue_is_low_confidence_no_guess_and_internal_whatever_its_confidence(
    pool: PgPool,
) -> anyhow::Result<()> {
    let (user_id, ids) = seed(&pool).await?;
    let id = |l: &str| ids.iter().find(|(x, _)| *x == l).unwrap().1;

    let listed: Vec<Uuid> = transactions(&pool, user_id, &review_filter(Decimal::new(80, 2)))
        .await?
        .into_iter()
        .map(|r| r.id)
        .collect();
    let mut expected = vec![id("low"), id("internal_high"), id("no_guess")];
    let mut got = listed.clone();
    expected.sort();
    got.sort();
    assert_eq!(got, expected);

    // The three sites agree.
    let mut bulk =
        matching_transaction_ids(&pool, user_id, &review_filter(Decimal::new(80, 2))).await?;
    bulk.sort();
    assert_eq!(bulk, expected);
    let counts = transaction_counts(&pool, user_id, &review_filter(Decimal::new(80, 2))).await?;
    assert_eq!(counts.matching, 3);
    Ok(())
}

#[sqlx::test(migrations = "../migrations")]
async fn moving_the_threshold_reshapes_the_queue(pool: PgPool) -> anyhow::Result<()> {
    let (user_id, _) = seed(&pool).await?;
    let n = transactions(&pool, user_id, &review_filter(Decimal::new(99, 2)))
        .await?
        .len();
    assert_eq!(n, 4, "high (0.95) now falls under 0.99");
    Ok(())
}
