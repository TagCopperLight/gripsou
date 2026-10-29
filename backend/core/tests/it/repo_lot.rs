use gripsou_core::repo::account::upsert_account;
use gripsou_core::testkit::{self, seed_connection};
use rust_decimal::Decimal;
use sqlx::PgPool;
use uuid::Uuid;

fn dec(s: &str) -> Decimal {
    s.parse().unwrap()
}

#[sqlx::test(migrations = "../migrations")]
async fn lot_table_accepts_a_manual_buy(pool: PgPool) {
    let conn_id = seed_connection(&pool).await;
    let mut conn = pool.acquire().await.unwrap();
    let account_id = upsert_account(&mut conn, conn_id, &testkit::checking_account("acct-1"))
        .await
        .unwrap();
    let holding_id = testkit::seed_equity_holding(&pool, account_id, "PUST", dec("2")).await;

    sqlx::query(
        "insert into lot (holding_id, side, acquired_on, quantity, unit_price, fee, source) \
         values ($1, 'buy', date '2026-06-01', 2, 98.37, 1.05, 'manual')",
    )
    .bind(holding_id)
    .execute(&pool)
    .await
    .unwrap();

    let (qty, fee): (Decimal, Decimal) =
        sqlx::query_as("select quantity, fee from lot where holding_id = $1")
            .bind(holding_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(qty, dec("2"));
    assert_eq!(fee, dec("1.05"));
}

#[sqlx::test(migrations = "../migrations")]
async fn lot_rejects_a_negative_quantity(pool: PgPool) {
    let conn_id = seed_connection(&pool).await;
    let mut conn = pool.acquire().await.unwrap();
    let account_id = upsert_account(&mut conn, conn_id, &testkit::checking_account("acct-1"))
        .await
        .unwrap();
    let holding_id = testkit::seed_equity_holding(&pool, account_id, "PUST", dec("2")).await;

    let err = sqlx::query(
        "insert into lot (holding_id, side, acquired_on, quantity, unit_price, source) \
         values ($1, 'buy', date '2026-06-01', -2, 98.37, 'manual')",
    )
    .bind(holding_id)
    .execute(&pool)
    .await;
    assert!(
        err.is_err(),
        "a negative quantity must violate the check constraint"
    );
}

#[sqlx::test(migrations = "../migrations")]
async fn lot_rejects_an_unknown_source(pool: PgPool) {
    let conn_id = seed_connection(&pool).await;
    let mut conn = pool.acquire().await.unwrap();
    let account_id = upsert_account(&mut conn, conn_id, &testkit::checking_account("acct-1"))
        .await
        .unwrap();
    let holding_id = testkit::seed_equity_holding(&pool, account_id, "PUST", dec("2")).await;

    let err = sqlx::query(
        "insert into lot (holding_id, side, acquired_on, quantity, unit_price, source) \
         values ($1, 'buy', date '2026-06-01', 2, 98.37, 'inferred')",
    )
    .bind(holding_id)
    .execute(&pool)
    .await;
    assert!(
        err.is_err(),
        "'inferred' is deliberately not an allowed source yet"
    );
}

use gripsou_core::repo::lot::{PreviewLot, basis_preview, delete_lots, insert_lot, list_lots};

#[sqlx::test(migrations = "../migrations")]
async fn insert_then_list_round_trips_the_fee(pool: PgPool) {
    let conn_id = seed_connection(&pool).await;
    let user_id: Uuid = sqlx::query_scalar("select user_id from connection where id = $1")
        .bind(conn_id)
        .fetch_one(&pool)
        .await
        .unwrap();
    let mut conn = pool.acquire().await.unwrap();
    let account_id = upsert_account(&mut conn, conn_id, &testkit::checking_account("acct-1"))
        .await
        .unwrap();
    let holding_id = testkit::seed_equity_holding(&pool, account_id, "PUST", dec("2")).await;

    let id = insert_lot(
        &mut conn,
        holding_id,
        user_id,
        "buy",
        "2026-06-01".parse().unwrap(),
        dec("2"),
        dec("98.37"),
        dec("1.05"),
    )
    .await
    .unwrap();
    assert!(id.is_some());

    let rows = list_lots(&pool, user_id, holding_id).await.unwrap();
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].fee, dec("1.05"));
    assert!(rows[0].manual);
}

/// The delete path's whole security model. A provider-owned lot must survive a
/// delete request naming its id, even one without a stable `external_id`.
#[sqlx::test(migrations = "../migrations")]
async fn delete_refuses_a_provider_lot(pool: PgPool) {
    let conn_id = seed_connection(&pool).await;
    let user_id: Uuid = sqlx::query_scalar("select user_id from connection where id = $1")
        .bind(conn_id)
        .fetch_one(&pool)
        .await
        .unwrap();
    let mut conn = pool.acquire().await.unwrap();
    let account_id = upsert_account(&mut conn, conn_id, &testkit::checking_account("acct-1"))
        .await
        .unwrap();
    let holding_id = testkit::seed_equity_holding(&pool, account_id, "PUST", dec("2")).await;

    let lot_id: Uuid = sqlx::query_scalar(
        "insert into lot (holding_id, side, acquired_on, quantity, unit_price, source) \
         values ($1, 'buy', date '2026-06-01', 2, 98.37, 'provider') returning id",
    )
    .bind(holding_id)
    .fetch_one(&pool)
    .await
    .unwrap();

    let deleted = delete_lots(&mut conn, holding_id, user_id, &[lot_id])
        .await
        .unwrap();
    assert_eq!(deleted, 0, "a provider lot is not the user's to delete");
}

/// The preview must leave nothing behind: it computes inside a rolled-back
/// transaction so it cannot possibly diverge from the saved figure.
#[sqlx::test(migrations = "../migrations")]
async fn preview_computes_without_writing(pool: PgPool) {
    let conn_id = seed_connection(&pool).await;
    let user_id: Uuid = sqlx::query_scalar("select user_id from connection where id = $1")
        .bind(conn_id)
        .fetch_one(&pool)
        .await
        .unwrap();
    let mut conn = pool.acquire().await.unwrap();
    let account_id = upsert_account(&mut conn, conn_id, &testkit::checking_account("acct-1"))
        .await
        .unwrap();
    let holding_id = testkit::seed_equity_holding(&pool, account_id, "PUST", dec("2")).await;

    let figures = basis_preview(
        &pool,
        user_id,
        holding_id,
        &[PreviewLot {
            side: "buy".into(),
            acquired_on: "2026-06-01".parse().unwrap(),
            quantity: dec("2"),
            unit_price: dec("98.37"),
            fee: dec("1.05"),
        }],
    )
    .await
    .unwrap()
    .expect("holding is owned by user_id");
    assert_eq!(figures.basis, dec("197.79"));

    let remaining: i64 = sqlx::query_scalar("select count(*) from lot where holding_id = $1")
        .bind(holding_id)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(remaining, 0, "the preview must have rolled back");
}

/// A provider's lots are not the user's to replace: the preview keeps them, as
/// saving does, so the figures while editing are the figures after saving.
#[sqlx::test(migrations = "../migrations")]
async fn preview_keeps_the_provider_lots(pool: PgPool) {
    let conn_id = seed_connection(&pool).await;
    let user_id: Uuid = sqlx::query_scalar("select user_id from connection where id = $1")
        .bind(conn_id)
        .fetch_one(&pool)
        .await
        .unwrap();
    let mut conn = pool.acquire().await.unwrap();
    let account_id = upsert_account(&mut conn, conn_id, &testkit::checking_account("acct-1"))
        .await
        .unwrap();
    let holding_id = testkit::seed_equity_holding(&pool, account_id, "PUST", dec("3")).await;
    sqlx::query(
        "insert into lot (holding_id, side, acquired_on, quantity, unit_price, source) \
         values ($1, 'buy', date '2026-05-01', 2, 100, 'provider')",
    )
    .bind(holding_id)
    .execute(&pool)
    .await
    .unwrap();

    let figures = basis_preview(
        &pool,
        user_id,
        holding_id,
        &[PreviewLot {
            side: "buy".into(),
            acquired_on: "2026-06-01".parse().unwrap(),
            quantity: dec("1"),
            unit_price: dec("130"),
            fee: dec("0"),
        }],
    )
    .await
    .unwrap()
    .expect("holding is owned by user_id");
    assert_eq!(figures.explained_qty, dec("3"));
    assert_eq!(figures.basis, dec("330"));
}

/// The trespass path: a holding that belongs to a different user must read as
/// "unknown" (`Ok(None)`), the same as `save_lots` treats it, so the endpoint
/// never confirms the existence of ids the caller cannot see. Must also write
/// nothing — the rollback must fire on this early-exit path too.
#[sqlx::test(migrations = "../migrations")]
async fn preview_refuses_a_foreign_holding(pool: PgPool) {
    let conn_id = seed_connection(&pool).await;
    let mut conn = pool.acquire().await.unwrap();
    let account_id = upsert_account(&mut conn, conn_id, &testkit::checking_account("acct-1"))
        .await
        .unwrap();
    let holding_id = testkit::seed_equity_holding(&pool, account_id, "PUST", dec("2")).await;

    let other_user_id = testkit::seed_user(&pool).await;

    let figures = basis_preview(
        &pool,
        other_user_id,
        holding_id,
        &[PreviewLot {
            side: "buy".into(),
            acquired_on: "2026-06-01".parse().unwrap(),
            quantity: dec("2"),
            unit_price: dec("98.37"),
            fee: dec("1.05"),
        }],
    )
    .await
    .unwrap();
    assert!(
        figures.is_none(),
        "a foreign holding must read as unknown, not error"
    );

    let remaining: i64 = sqlx::query_scalar("select count(*) from lot where holding_id = $1")
        .bind(holding_id)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(remaining, 0, "the refusal path must not write anything");
}

/// The insert path must enforce ownership itself, not merely trust a caller's
/// prior check — a non-owning `user_id` must write nothing and report
/// not-found, not just return a value the caller happens to ignore.
#[sqlx::test(migrations = "../migrations")]
async fn insert_lot_rejects_a_non_owning_user(pool: PgPool) {
    let conn_id = seed_connection(&pool).await;
    let mut conn = pool.acquire().await.unwrap();
    let account_id = upsert_account(&mut conn, conn_id, &testkit::checking_account("acct-1"))
        .await
        .unwrap();
    let holding_id = testkit::seed_equity_holding(&pool, account_id, "PUST", dec("2")).await;

    let other_user_id = testkit::seed_user(&pool).await;

    let result = insert_lot(
        &mut conn,
        holding_id,
        other_user_id,
        "buy",
        "2026-06-01".parse().unwrap(),
        dec("20"),
        dec("15.617"),
        dec("0"),
    )
    .await
    .unwrap();
    assert!(
        result.is_none(),
        "a non-owning user_id must not be able to write a lot"
    );

    let remaining: i64 = sqlx::query_scalar("select count(*) from lot where holding_id = $1")
        .bind(holding_id)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(
        remaining, 0,
        "the refusal path must not write anything, not merely return None"
    );
}
