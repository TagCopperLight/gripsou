use chrono::NaiveDate;
use gripsou_core::repo::account::upsert_account;
use gripsou_core::testkit::{self, Lot, seed_connection};
use rust_decimal::Decimal;
use sqlx::PgPool;

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

    testkit::seed_lot(
        &pool,
        holding_id,
        Lot::buy(
            NaiveDate::from_ymd_opt(2026, 6, 1).unwrap(),
            Decimal::from(2),
            dec("98.37"),
        )
        .fee(dec("1.05")),
    )
    .await;

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

use gripsou_core::error::CoreError;
use gripsou_core::repo::lot::{LotChanges, NewLot, basis_preview, list_lots, save};

fn buy(day: &str, quantity: &str, unit_price: &str, fee: &str) -> NewLot {
    NewLot::new(
        gripsou_core::repo::lot::LotSide::Buy,
        day.parse().unwrap(),
        dec(quantity),
        dec(unit_price),
        dec(fee),
    )
    .unwrap()
}

async fn lot_count(pool: &PgPool, holding_id: uuid::Uuid) -> i64 {
    sqlx::query_scalar("select count(*) from lot where holding_id = $1")
        .bind(holding_id)
        .fetch_one(pool)
        .await
        .unwrap()
}

#[sqlx::test(migrations = "../migrations")]
async fn save_then_list_round_trips_the_fee(pool: PgPool) {
    let conn_id = seed_connection(&pool).await;
    let user_id = testkit::owner(&pool, conn_id).await;
    let mut conn = pool.acquire().await.unwrap();
    let account_id = upsert_account(&mut conn, conn_id, &testkit::checking_account("acct-1"))
        .await
        .unwrap();
    let holding_id = testkit::seed_equity_holding(&pool, account_id, "PUST", dec("2")).await;

    let changes = LotChanges::edit(vec![buy("2026-06-01", "2", "98.37", "1.05")], []);
    save(&pool, user_id, holding_id, &changes).await.unwrap();

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
    let user_id = testkit::owner(&pool, conn_id).await;
    let mut conn = pool.acquire().await.unwrap();
    let account_id = upsert_account(&mut conn, conn_id, &testkit::checking_account("acct-1"))
        .await
        .unwrap();
    let holding_id = testkit::seed_equity_holding(&pool, account_id, "PUST", dec("2")).await;

    let lot_id = testkit::seed_lot(
        &pool,
        holding_id,
        Lot::buy(
            chrono::NaiveDate::from_ymd_opt(2026, 6, 1).unwrap(),
            dec("2"),
            dec("98.37"),
        )
        .from_provider(),
    )
    .await;

    let err = save(
        &pool,
        user_id,
        holding_id,
        &LotChanges::edit(vec![], [lot_id]),
    )
    .await
    .unwrap_err();
    assert!(matches!(err, CoreError::NotFound(_)));
    assert_eq!(
        lot_count(&pool, holding_id).await,
        1,
        "a provider lot is not the user's to delete"
    );
}

/// The same id twice is one delete, not a shortfall that rejects the batch.
#[sqlx::test(migrations = "../migrations")]
async fn a_repeated_delete_id_is_one_delete(pool: PgPool) {
    let conn_id = seed_connection(&pool).await;
    let user_id = testkit::owner(&pool, conn_id).await;
    let mut conn = pool.acquire().await.unwrap();
    let account_id = upsert_account(&mut conn, conn_id, &testkit::checking_account("acct-1"))
        .await
        .unwrap();
    let holding_id = testkit::seed_equity_holding(&pool, account_id, "PUST", dec("2")).await;
    let changes = LotChanges::edit(vec![buy("2026-06-01", "2", "98.37", "0")], []);
    save(&pool, user_id, holding_id, &changes).await.unwrap();
    let id = list_lots(&pool, user_id, holding_id).await.unwrap()[0].id;

    save(
        &pool,
        user_id,
        holding_id,
        &LotChanges::edit(vec![], [id, id]),
    )
    .await
    .unwrap();
    assert_eq!(lot_count(&pool, holding_id).await, 0);
}

/// Every connection of a user starts its history on the same day, the day
/// before the user's earliest evidence. A lot dated before it moves that day
/// for the user's other connections too.
#[sqlx::test(migrations = "../migrations")]
async fn saving_a_lot_rebuilds_every_connection_of_the_user(pool: PgPool) {
    let (user_id, conn_a) = testkit::seed_user_and_connection(&pool).await;
    let conn_b = testkit::seed_connection_for(&pool, user_id).await;
    let today = gripsou_core::repo::prefs::today(&pool, user_id)
        .await
        .unwrap();
    let mut conn = pool.acquire().await.unwrap();
    let account_a = upsert_account(&mut conn, conn_a, &testkit::checking_account("acct-a"))
        .await
        .unwrap();
    let account_b = upsert_account(&mut conn, conn_b, &testkit::checking_account("acct-b"))
        .await
        .unwrap();
    let holding_a = testkit::seed_equity_holding(&pool, account_a, "PUST", dec("2")).await;
    let holding_b = testkit::seed_equity_holding(&pool, account_b, "WLDX", dec("5")).await;
    testkit::stamp_on(&pool, holding_a, today, dec("2"), dec("200")).await;
    testkit::stamp_on(&pool, holding_b, today, dec("5"), dec("500")).await;
    let mut tx = gripsou_core::db::begin_user_writes(&pool, user_id)
        .await
        .unwrap();
    gripsou_core::backfill::backfill_user(&mut tx)
        .await
        .unwrap();
    tx.commit().await.unwrap();

    let lot_day = today - chrono::Duration::days(30);
    let changes = LotChanges::edit(vec![buy(&lot_day.to_string(), "2", "100", "0")], []);
    save(&pool, user_id, holding_a, &changes).await.unwrap();

    let first_b: Option<chrono::NaiveDate> =
        sqlx::query_scalar("select min(as_of) from holding_backfill where holding_id = $1")
            .bind(holding_b)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(first_b, Some(lot_day - chrono::Duration::days(1)));
}

/// The preview must leave nothing behind: it computes inside a rolled-back
/// transaction so it cannot possibly diverge from the saved figure.
#[sqlx::test(migrations = "../migrations")]
async fn preview_computes_without_writing(pool: PgPool) {
    let conn_id = seed_connection(&pool).await;
    let user_id = testkit::owner(&pool, conn_id).await;
    let mut conn = pool.acquire().await.unwrap();
    let account_id = upsert_account(&mut conn, conn_id, &testkit::checking_account("acct-1"))
        .await
        .unwrap();
    let holding_id = testkit::seed_equity_holding(&pool, account_id, "PUST", dec("2")).await;

    let changes = LotChanges::replace_manual(vec![buy("2026-06-01", "2", "98.37", "1.05")]);
    let preview = basis_preview(&pool, user_id, holding_id, &changes)
        .await
        .unwrap();
    assert_eq!(preview.account.invested, dec("197.79"));
    assert_eq!(
        lot_count(&pool, holding_id).await,
        0,
        "the preview must have rolled back"
    );
}

/// A provider's lots are not the user's to replace: the preview keeps them, as
/// saving does, so the figures while editing are the figures after saving.
#[sqlx::test(migrations = "../migrations")]
async fn preview_keeps_the_provider_lots(pool: PgPool) {
    let conn_id = seed_connection(&pool).await;
    let user_id = testkit::owner(&pool, conn_id).await;
    let mut conn = pool.acquire().await.unwrap();
    let account_id = upsert_account(&mut conn, conn_id, &testkit::checking_account("acct-1"))
        .await
        .unwrap();
    let holding_id = testkit::seed_equity_holding(&pool, account_id, "PUST", dec("3")).await;
    testkit::seed_lot(
        &pool,
        holding_id,
        Lot::buy(
            NaiveDate::from_ymd_opt(2026, 5, 1).unwrap(),
            Decimal::from(2),
            Decimal::from(100),
        )
        .from_provider(),
    )
    .await;

    let changes = LotChanges::replace_manual(vec![buy("2026-06-01", "1", "130", "0")]);
    let preview = basis_preview(&pool, user_id, holding_id, &changes)
        .await
        .unwrap();
    assert_eq!(preview.explained_qty, dec("3"));
    assert_eq!(preview.account.invested, dec("330"));
}

/// A holding that belongs to a different user reads as unknown, and nothing
/// is written: neither the preview's rows nor a save's.
#[sqlx::test(migrations = "../migrations")]
async fn a_foreign_holding_is_not_found(pool: PgPool) {
    let conn_id = seed_connection(&pool).await;
    let mut conn = pool.acquire().await.unwrap();
    let account_id = upsert_account(&mut conn, conn_id, &testkit::checking_account("acct-1"))
        .await
        .unwrap();
    let holding_id = testkit::seed_equity_holding(&pool, account_id, "PUST", dec("2")).await;

    let other_user_id = testkit::seed_user(&pool).await;
    let rows = || vec![buy("2026-06-01", "2", "98.37", "1.05")];

    let preview = basis_preview(
        &pool,
        other_user_id,
        holding_id,
        &LotChanges::replace_manual(rows()),
    )
    .await;
    assert!(matches!(preview, Err(CoreError::NotFound(_))));
    let saved = save(
        &pool,
        other_user_id,
        holding_id,
        &LotChanges::edit(rows(), []),
    )
    .await;
    assert!(matches!(saved, Err(CoreError::NotFound(_))));

    assert_eq!(lot_count(&pool, holding_id).await, 0);
}
