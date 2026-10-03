mod common;

use chrono::NaiveDate;
use common::{checking_account, seed_connection, txn, txn_on};
use gripsou_core::repo::account::upsert_account;
use gripsou_core::repo::query::{TransactionFilters, transactions};
use gripsou_core::repo::transaction::upsert_transaction;
use rust_decimal::Decimal;
use sqlx::PgPool;
use uuid::Uuid;

fn dec(s: &str) -> Decimal {
    s.parse().unwrap()
}

fn all() -> TransactionFilters {
    TransactionFilters {
        limit: 100,
        offset: 0,
        ..TransactionFilters::unfiltered()
    }
}

async fn seed(pool: &PgPool) -> (Uuid, Uuid) {
    let conn_id = seed_connection(pool).await;
    let user_id: Uuid = sqlx::query_scalar("select user_id from connection where id = $1")
        .bind(conn_id)
        .fetch_one(pool)
        .await
        .unwrap();
    let mut conn = pool.acquire().await.unwrap();
    let account_id = upsert_account(&mut conn, conn_id, &checking_account("acct-1"))
        .await
        .unwrap();
    for t in [
        txn("acct-1", "t1", "withdrawal", dec("-42.50"), Some("LECLERC")),
        txn("acct-1", "t2", "deposit", dec("1800"), Some("SALAIRE MARS")),
        txn_on(
            "acct-1",
            "t3",
            "fee",
            dec("-2"),
            NaiveDate::from_ymd_opt(2025, 6, 1).unwrap(),
        ),
    ] {
        upsert_transaction(&mut conn, account_id, &t).await.unwrap();
    }
    (user_id, account_id)
}

#[sqlx::test(migrations = "../migrations")]
async fn lists_newest_first_with_the_account_joined(pool: PgPool) -> anyhow::Result<()> {
    let (user_id, account_id) = seed(&pool).await;
    let rows = transactions(&pool, user_id, &all()).await?;
    assert_eq!(rows.len(), 3);
    assert!(rows[0].ts >= rows[1].ts, "newest first");
    assert_eq!(rows[0].account_id, account_id);
    assert_eq!(rows[0].account_name, "Current account");
    assert_eq!(rows[0].account_currency, "EUR");
    Ok(())
}

#[sqlx::test(migrations = "../migrations")]
async fn searches_descriptions_case_insensitively_on_a_substring(
    pool: PgPool,
) -> anyhow::Result<()> {
    let (user_id, _) = seed(&pool).await;
    let rows = transactions(
        &pool,
        user_id,
        &TransactionFilters {
            search: Some("leclerc".into()),
            ..all()
        },
    )
    .await?;
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].description.as_deref(), Some("LECLERC"));
    Ok(())
}

#[sqlx::test(migrations = "../migrations")]
async fn filters_by_date_range(pool: PgPool) -> anyhow::Result<()> {
    let (user_id, _) = seed(&pool).await;

    let old = transactions(
        &pool,
        user_id,
        &TransactionFilters {
            to: Some(NaiveDate::from_ymd_opt(2025, 12, 31).unwrap()),
            ..all()
        },
    )
    .await?;
    assert_eq!(old.len(), 1, "only the 2025 row");
    Ok(())
}

/// Strengthened from the brief: a stranger UUID against a table containing
/// only one user's data proves nothing (an empty table would pass the same
/// assertion). Seed a *second* real user with their own connection, account
/// and transactions, then confirm querying as the first user returns only
/// the first user's rows -- the second user's transactions must never leak.
#[sqlx::test(migrations = "../migrations")]
async fn never_returns_another_users_rows(pool: PgPool) -> anyhow::Result<()> {
    let (user_id, _) = seed(&pool).await;

    // A second, unrelated user with their own connection/account/transactions.
    let other_conn_id = seed_connection(&pool).await;
    let other_user_id: Uuid = sqlx::query_scalar("select user_id from connection where id = $1")
        .bind(other_conn_id)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_ne!(user_id, other_user_id);
    let mut conn = pool.acquire().await.unwrap();
    let other_account_id = upsert_account(&mut conn, other_conn_id, &checking_account("acct-2"))
        .await
        .unwrap();
    upsert_transaction(
        &mut conn,
        other_account_id,
        &txn(
            "acct-2",
            "other-t1",
            "withdrawal",
            dec("-99.00"),
            Some("OTHER USER PURCHASE"),
        ),
    )
    .await
    .unwrap();

    // Sanity: the other user's data actually exists in the table.
    let other_rows = transactions(&pool, other_user_id, &all()).await?;
    assert_eq!(other_rows.len(), 1);

    // The first user's query must not see the other user's rows.
    let rows = transactions(&pool, user_id, &all()).await?;
    assert_eq!(rows.len(), 3);
    assert!(rows.iter().all(|r| r.account_id != other_account_id));
    assert!(
        rows.iter()
            .all(|r| r.description.as_deref() != Some("OTHER USER PURCHASE"))
    );

    // A totally unknown user id sees nothing at all.
    let stranger = Uuid::new_v4();
    let stranger_rows = transactions(&pool, stranger, &all()).await?;
    assert!(stranger_rows.is_empty());
    Ok(())
}

fn pea_account(external_id: &str) -> gripsou_core::dto::CanonicalAccount {
    gripsou_core::dto::CanonicalAccount {
        type_key: "pea".to_string(),
        ..checking_account(external_id)
    }
}

/// A buy/sell is the cash leg of an investment; the lot is the record of it.
/// Hidden on ANY account — TR's trades land on a checking account — while the
/// PEA's transfers, dividends and fees, real cash movements, still show.
#[sqlx::test(migrations = "../migrations")]
async fn hides_buy_and_sell_on_every_account_but_shows_other_cash(
    pool: PgPool,
) -> anyhow::Result<()> {
    let conn_id = seed_connection(&pool).await;
    let user_id: Uuid = sqlx::query_scalar("select user_id from connection where id = $1")
        .bind(conn_id)
        .fetch_one(&pool)
        .await?;
    let mut conn = pool.acquire().await?;
    let checking_id = upsert_account(&mut conn, conn_id, &checking_account("acct-1")).await?;
    let pea_id = upsert_account(&mut conn, conn_id, &pea_account("pea-1")).await?;

    for (id, kind, amount, desc) in [
        ("c1", "transfer", "-50.00", "Virement vers PEA"),
        ("c2", "buy", "-50.00", "SpaceX Ordre d'achat"),
        ("c3", "sell", "55.63", "Micron Technology Ordre de vente"),
    ] {
        upsert_transaction(
            &mut conn,
            checking_id,
            &txn("acct-1", id, kind, dec(amount), Some(desc)),
        )
        .await?;
    }
    for (id, kind, amount, desc) in [
        ("p1", "transfer", "50.00", "Virement depuis Livret"),
        ("p2", "buy", "-197.79", "ACHAT COMPTANT"),
        ("p3", "sell", "40.00", "VENTE COMPTANT"),
        ("p4", "dividend", "7.10", "COUPONS"),
        ("p5", "fee", "-1.20", "FRAIS"),
    ] {
        upsert_transaction(
            &mut conn,
            pea_id,
            &txn("pea-1", id, kind, dec(amount), Some(desc)),
        )
        .await?;
    }

    let rows = transactions(&pool, user_id, &all()).await?;
    let kinds: Vec<&str> = rows.iter().map(|r| r.kind.as_str()).collect();

    assert!(
        !rows
            .iter()
            .any(|r| matches!(r.kind.as_str(), "buy" | "sell")),
        "no buy/sell on any account, got {kinds:?}"
    );
    assert!(
        rows.iter()
            .any(|r| r.account_id == checking_id && r.kind == "transfer"),
        "the checking transfer still shows"
    );
    for kind in ["transfer", "dividend", "fee"] {
        assert!(
            rows.iter()
                .any(|r| r.account_id == pea_id && r.kind == kind),
            "a PEA {kind} is real cash and must still show, got {kinds:?}"
        );
    }
    Ok(())
}

/// Unreachable, not merely hidden: searching must not resurrect a buy.
#[sqlx::test(migrations = "../migrations")]
async fn a_search_does_not_resurrect_buys(pool: PgPool) -> anyhow::Result<()> {
    let conn_id = seed_connection(&pool).await;
    let user_id: Uuid = sqlx::query_scalar("select user_id from connection where id = $1")
        .bind(conn_id)
        .fetch_one(&pool)
        .await?;
    let mut conn = pool.acquire().await?;
    let checking_id = upsert_account(&mut conn, conn_id, &checking_account("acct-1")).await?;
    upsert_transaction(
        &mut conn,
        checking_id,
        &txn(
            "acct-1",
            "c1",
            "buy",
            dec("-50.00"),
            Some("SpaceX Ordre d'achat"),
        ),
    )
    .await?;

    let rows = transactions(
        &pool,
        user_id,
        &TransactionFilters {
            search: Some("SpaceX".into()),
            ..all()
        },
    )
    .await?;
    assert!(
        rows.is_empty(),
        "the rule is unconditional, not a default view"
    );
    Ok(())
}

/// A hand-entered lot must still appear on the transactions page after moving
/// out of `transaction` — the lots entered by hand predate the PEA connector's
/// history and have no provider row behind them, so losing them here would
/// erase real entries.
#[sqlx::test(migrations = "../migrations")]
async fn lots_appear_on_the_transactions_list(pool: PgPool) {
    let conn_id = seed_connection(&pool).await;
    let user_id: Uuid = sqlx::query_scalar("select user_id from connection where id = $1")
        .bind(conn_id)
        .fetch_one(&pool)
        .await
        .unwrap();
    let mut conn = pool.acquire().await.unwrap();
    let account_id = upsert_account(&mut conn, conn_id, &checking_account("acct-1"))
        .await
        .unwrap();
    let holding_id = common::seed_equity_holding(&pool, account_id, "PUST", dec("2")).await;
    sqlx::query(
        "insert into lot (holding_id, side, acquired_on, quantity, unit_price, fee, source) \
         values ($1, 'buy', date '2026-06-01', 2, 98.37, 1.05, 'manual')",
    )
    .bind(holding_id)
    .execute(&pool)
    .await
    .unwrap();

    let rows = transactions(&pool, user_id, &all()).await.unwrap();
    let lot = rows
        .iter()
        .find(|r| r.source == "lot")
        .expect("the lot must be listed");
    assert_eq!(lot.ticker.as_deref(), Some("PUST"));
    assert_eq!(lot.quantity, Some(dec("2")));
    assert_eq!(lot.fee, Some(dec("1.05")));
    assert_eq!(
        lot.amount,
        dec("-197.79"),
        "a buy's amount is -(qty x price + fee): the real cash impact"
    );
}
