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
        search: None,
        account_id: None,
        kind: None,
        from: None,
        to: None,
        limit: 100,
        offset: 0,
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
async fn filters_by_type_and_date_range(pool: PgPool) -> anyhow::Result<()> {
    let (user_id, _) = seed(&pool).await;

    let fees = transactions(
        &pool,
        user_id,
        &TransactionFilters {
            kind: Some("fee".into()),
            ..all()
        },
    )
    .await?;
    assert_eq!(fees.len(), 1);

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

/// §8.1 already excludes these three types on a PEA from the cash walk: a
/// transfer into the PEA is the mirror of an outflow from the checking account,
/// and a buy converts cash into an asset already counted as a holding. The list
/// showed both sides of the same movement.
#[sqlx::test(migrations = "../migrations")]
async fn hides_provider_pea_transfers_and_trades(pool: PgPool) -> anyhow::Result<()> {
    let conn_id = seed_connection(&pool).await;
    let user_id: Uuid = sqlx::query_scalar("select user_id from connection where id = $1")
        .bind(conn_id)
        .fetch_one(&pool)
        .await?;
    let mut conn = pool.acquire().await?;
    let checking_id = upsert_account(&mut conn, conn_id, &checking_account("acct-1")).await?;
    let pea_id = upsert_account(&mut conn, conn_id, &pea_account("pea-1")).await?;

    upsert_transaction(
        &mut conn,
        checking_id,
        &txn(
            "acct-1",
            "c1",
            "transfer",
            dec("-50.00"),
            Some("Virement vers PEA"),
        ),
    )
    .await?;
    for (id, kind, amount, desc) in [
        ("p1", "transfer", "50.00", "Virement depuis BoursoBank"),
        ("p2", "buy", "-210.53", "ACHAT COMPTANT"),
        ("p3", "sell", "40.00", "VENTE COMPTANT"),
        ("p4", "dividend", "6.63", "COUPONS"),
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
    let ids: Vec<&str> = rows.iter().map(|r| r.kind.as_str()).collect();

    assert!(
        rows.iter().any(|r| r.account_id == checking_id),
        "the checking-account side of the transfer is still shown"
    );
    assert!(
        !rows
            .iter()
            .any(|r| r.account_id == pea_id
                && matches!(r.kind.as_str(), "transfer" | "buy" | "sell")),
        "PEA transfer/buy/sell are hidden, got {ids:?}"
    );
    assert!(
        rows.iter()
            .any(|r| r.account_id == pea_id && r.kind == "dividend"),
        "a PEA dividend is real money arriving and must still show"
    );
    assert!(
        rows.iter()
            .any(|r| r.account_id == pea_id && r.kind == "fee"),
        "a PEA fee is real money leaving and must still show"
    );
    Ok(())
}

/// Unreachable, not merely hidden: an explicit type filter must not resurrect
/// a provider-supplied PEA transfer.
#[sqlx::test(migrations = "../migrations")]
async fn an_explicit_type_filter_does_not_resurrect_pea_transfers(
    pool: PgPool,
) -> anyhow::Result<()> {
    let conn_id = seed_connection(&pool).await;
    let user_id: Uuid = sqlx::query_scalar("select user_id from connection where id = $1")
        .bind(conn_id)
        .fetch_one(&pool)
        .await?;
    let mut conn = pool.acquire().await?;
    let pea_id = upsert_account(&mut conn, conn_id, &pea_account("pea-1")).await?;
    upsert_transaction(
        &mut conn,
        pea_id,
        &txn("pea-1", "p1", "transfer", dec("50.00"), Some("Virement")),
    )
    .await?;

    let rows = transactions(
        &pool,
        user_id,
        &TransactionFilters {
            kind: Some("transfer".into()),
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

/// A manual lot is a `buy` on the PEA too, but the user entered it themselves —
/// it carries `external_id = null` (§9.2, which is what keeps it outside the
/// provider dedup index) and must stay visible.
#[sqlx::test(migrations = "../migrations")]
async fn a_manual_lot_on_the_pea_is_still_listed(pool: PgPool) -> anyhow::Result<()> {
    let conn_id = seed_connection(&pool).await;
    let user_id: Uuid = sqlx::query_scalar("select user_id from connection where id = $1")
        .bind(conn_id)
        .fetch_one(&pool)
        .await?;
    let mut conn = pool.acquire().await?;
    let pea_id = upsert_account(&mut conn, conn_id, &pea_account("pea-1")).await?;

    // Provider buy: hidden. Manual buy (no external_id): shown.
    upsert_transaction(
        &mut conn,
        pea_id,
        &txn("pea-1", "p1", "buy", dec("-210.53"), Some("ACHAT COMPTANT")),
    )
    .await?;
    sqlx::query(
        "insert into transaction (account_id, ts, type, amount, quantity, unit_price, description) \
         values ($1, now(), 'buy', -320.58, 20, 16.029, 'Manual lot')",
    )
    .bind(pea_id)
    .execute(&pool)
    .await?;

    let rows = transactions(&pool, user_id, &all()).await?;
    assert_eq!(
        rows.len(),
        1,
        "exactly the manual lot, not the provider buy"
    );
    assert_eq!(rows[0].description.as_deref(), Some("Manual lot"));
    Ok(())
}
