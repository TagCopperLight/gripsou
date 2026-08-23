mod common;

use common::{checking_account, deposit_txn, seed_connection, txn};
use gripsou_core::repo::account::upsert_account;
use gripsou_core::repo::transaction::{TxnWrite, upsert_transaction};
use rust_decimal::Decimal;
use sqlx::PgPool;

#[sqlx::test(migrations = "../migrations")]
async fn inserts_once_then_updates_in_place(pool: PgPool) -> anyhow::Result<()> {
    let conn_id = seed_connection(&pool).await;
    let mut conn = pool.acquire().await?;
    let account_id = upsert_account(&mut conn, conn_id, &checking_account("acct-1")).await?;

    let first = upsert_transaction(
        &mut conn,
        account_id,
        &txn(
            "acct-1",
            "txn-1",
            "deposit",
            Decimal::new(5000, 2),
            Some("SALAIRE"),
        ),
    )
    .await?;
    assert_eq!(first, TxnWrite::Inserted);

    // Powens corrects the row after the fact: same external_id, new amount.
    let second = upsert_transaction(
        &mut conn,
        account_id,
        &txn(
            "acct-1",
            "txn-1",
            "deposit",
            Decimal::new(7500, 2),
            Some("SALAIRE MARS"),
        ),
    )
    .await?;
    assert_eq!(
        second,
        TxnWrite::Updated,
        "same external_id must update, not skip"
    );

    let (count, amount, description): (i64, Decimal, Option<String>) = sqlx::query_as(
        "select count(*), max(amount), max(description) from transaction where account_id = $1",
    )
    .bind(account_id)
    .fetch_one(&pool)
    .await?;
    assert_eq!(count, 1, "no duplicate row");
    assert_eq!(amount, Decimal::new(7500, 2), "provider wins on amount");
    assert_eq!(description.as_deref(), Some("SALAIRE MARS"));
    Ok(())
}

/// Pins TRANSACTIONS.md §7: the provider always sends null for the enrichment
/// columns, so a re-ingest must not erase what the user put there.
#[sqlx::test(migrations = "../migrations")]
async fn reingest_preserves_user_enrichment(pool: PgPool) -> anyhow::Result<()> {
    let conn_id = seed_connection(&pool).await;
    let mut conn = pool.acquire().await?;
    let account_id = upsert_account(&mut conn, conn_id, &checking_account("acct-1")).await?;

    let market_order = txn(
        "acct-1",
        "txn-mo",
        "buy",
        Decimal::new(-32058, 2),
        Some("ACHAT COMPTANT"),
    );
    upsert_transaction(&mut conn, account_id, &market_order).await?;

    // The user identifies what was bought.
    let instrument_id: uuid::Uuid = sqlx::query_scalar(
        "insert into instrument (kind, symbol, name, currency) \
         values ('etf', 'ESE.PA', 'BNP Paribas Easy S&P 500', 'EUR') returning id",
    )
    .fetch_one(&pool)
    .await?;
    sqlx::query(
        "update transaction set instrument_id = $1, quantity = 20, unit_price = 16.029 \
         where account_id = $2 and external_id = 'txn-mo'",
    )
    .bind(instrument_id)
    .bind(account_id)
    .execute(&pool)
    .await?;

    // Sync runs again with the same row, plus a provider correction.
    let corrected = txn(
        "acct-1",
        "txn-mo",
        "buy",
        Decimal::new(-32100, 2),
        Some("ACHAT COMPTANT ESE"),
    );
    assert_eq!(
        upsert_transaction(&mut conn, account_id, &corrected).await?,
        TxnWrite::Updated
    );

    let (iid, qty, price, amount): (
        Option<uuid::Uuid>,
        Option<Decimal>,
        Option<Decimal>,
        Decimal,
    ) = sqlx::query_as(
        "select instrument_id, quantity, unit_price, amount from transaction \
             where account_id = $1 and external_id = 'txn-mo'",
    )
    .bind(account_id)
    .fetch_one(&pool)
    .await?;
    assert_eq!(
        iid,
        Some(instrument_id),
        "user enrichment survives re-ingest"
    );
    assert_eq!(qty, Some(Decimal::new(20, 0)));
    assert_eq!(price, Some(Decimal::new(16029, 3)));
    assert_eq!(
        amount,
        Decimal::new(-32100, 2),
        "provider fields still update"
    );
    Ok(())
}

/// A manual lot carries no external_id, so the provider dedup index never
/// matches it and repeated syncs cannot touch it.
#[sqlx::test(migrations = "../migrations")]
async fn manual_rows_are_untouched_by_provider_upserts(pool: PgPool) -> anyhow::Result<()> {
    let conn_id = seed_connection(&pool).await;
    let mut conn = pool.acquire().await?;
    let account_id = upsert_account(&mut conn, conn_id, &checking_account("acct-1")).await?;

    sqlx::query(
        "insert into transaction (account_id, ts, type, amount, quantity, unit_price) \
         values ($1, now(), 'buy', -100, 10, 10)",
    )
    .bind(account_id)
    .execute(&pool)
    .await?;

    upsert_transaction(
        &mut conn,
        account_id,
        &deposit_txn("acct-1", "txn-1", Decimal::ONE),
    )
    .await?;

    let manual: i64 = sqlx::query_scalar(
        "select count(*) from transaction where account_id = $1 and external_id is null and quantity = 10",
    )
    .bind(account_id)
    .fetch_one(&pool)
    .await?;
    assert_eq!(manual, 1);
    Ok(())
}

/// §9.2: a manual lot is an ordinary transaction row — no flag, no side table.
/// `amount` is the real cash impact so the Transactions page and Phase 2
/// budgeting both see the true figure.
#[sqlx::test(migrations = "../migrations")]
async fn manual_lot_records_an_honest_buy(pool: PgPool) -> anyhow::Result<()> {
    let conn_id = seed_connection(&pool).await;
    let user_id: uuid::Uuid = sqlx::query_scalar("select user_id from connection where id = $1")
        .bind(conn_id)
        .fetch_one(&pool)
        .await?;
    let mut conn = pool.acquire().await?;
    let account_id =
        upsert_account(&mut conn, conn_id, &common::checking_account("acct-1")).await?;
    let h = common::equity_holding(
        "acct-1",
        "IE0003",
        Decimal::new(20, 0),
        Decimal::new(320, 0),
        None,
    );
    let instrument_id =
        gripsou_core::repo::instrument::resolve_instrument(&mut conn, &h.instrument).await?;
    let holding_id =
        gripsou_core::repo::holding::upsert_holding(&mut conn, account_id, instrument_id, &h)
            .await?;

    let id = gripsou_core::repo::transaction::insert_manual_lot(
        &mut conn,
        holding_id,
        user_id,
        chrono::NaiveDate::from_ymd_opt(2024, 5, 2)
            .unwrap()
            .and_hms_opt(0, 0, 0)
            .unwrap()
            .and_utc(),
        "buy",
        Decimal::new(20, 0),
        Decimal::new(16029, 3),
        -Decimal::new(20, 0) * Decimal::new(16029, 3),
    )
    .await?
    .expect("owning user's write must succeed");

    let (kind, amount, external_id, iid): (String, Decimal, Option<String>, Option<uuid::Uuid>) =
        sqlx::query_as(
            "select type, amount, external_id, instrument_id from transaction where id = $1",
        )
        .bind(id)
        .fetch_one(&pool)
        .await?;
    assert_eq!(kind, "buy");
    assert_eq!(amount, Decimal::new(-32058, 2), "-(20 × 16.029)");
    assert_eq!(external_id, None, "outside the provider dedup index");
    assert_eq!(iid, Some(instrument_id));
    Ok(())
}

/// Fix 1: `insert_manual_lot` must enforce ownership itself, not merely trust
/// a caller's prior check — a non-owning `user_id` must write nothing and
/// report not-found, not just return a value the caller happens to ignore.
#[sqlx::test(migrations = "../migrations")]
async fn insert_manual_lot_rejects_a_non_owning_user(pool: PgPool) -> anyhow::Result<()> {
    let conn_id = seed_connection(&pool).await;
    let attacker_conn_id = seed_connection(&pool).await;
    let attacker_id: uuid::Uuid =
        sqlx::query_scalar("select user_id from connection where id = $1")
            .bind(attacker_conn_id)
            .fetch_one(&pool)
            .await?;

    let mut conn = pool.acquire().await?;
    let account_id =
        upsert_account(&mut conn, conn_id, &common::checking_account("acct-1")).await?;
    let h = common::equity_holding(
        "acct-1",
        "IE0005",
        Decimal::new(20, 0),
        Decimal::new(320, 0),
        None,
    );
    let instrument_id =
        gripsou_core::repo::instrument::resolve_instrument(&mut conn, &h.instrument).await?;
    let holding_id =
        gripsou_core::repo::holding::upsert_holding(&mut conn, account_id, instrument_id, &h)
            .await?;

    let result = gripsou_core::repo::transaction::insert_manual_lot(
        &mut conn,
        holding_id,
        attacker_id,
        chrono::NaiveDate::from_ymd_opt(2024, 5, 2)
            .unwrap()
            .and_hms_opt(0, 0, 0)
            .unwrap()
            .and_utc(),
        "buy",
        Decimal::new(20, 0),
        Decimal::new(16029, 3),
        -Decimal::new(20, 0) * Decimal::new(16029, 3),
    )
    .await?;
    assert!(
        result.is_none(),
        "a non-owning user_id must not be able to write a lot"
    );

    let count: i64 = sqlx::query_scalar("select count(*) from transaction")
        .fetch_one(&pool)
        .await?;
    assert_eq!(
        count, 0,
        "the whole transaction table must be untouched, not merely the return value"
    );
    Ok(())
}
