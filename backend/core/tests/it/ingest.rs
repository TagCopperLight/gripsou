use gripsou_core::dto::SyncResult;
use gripsou_core::error::CoreError;
use gripsou_core::ingest::ingest;
use gripsou_core::testkit::{
    self, cash_holding, checking_account, deposit_txn, equity_holding, seed_connection,
};
use rust_decimal::Decimal;
use sqlx::PgPool;

fn sample_sync() -> SyncResult {
    SyncResult {
        accounts: vec![checking_account("acct-1")],
        holdings: vec![
            cash_holding("acct-1", Decimal::new(100, 0)),
            equity_holding(
                "acct-1",
                "US0378331005",
                Decimal::new(3, 0),
                Decimal::new(450, 0),
                Some(Decimal::new(600, 0)),
            ),
        ],
        transactions: vec![deposit_txn("acct-1", "txn-1", Decimal::new(100, 0))],
        ..Default::default()
    }
}

#[sqlx::test(migrations = "../migrations")]
async fn ingest_then_reingest_is_idempotent(pool: PgPool) -> anyhow::Result<()> {
    let conn_id = seed_connection(&pool).await;
    let sync = sample_sync();

    let s1 = ingest(&pool, conn_id, &sync).await?;
    assert_eq!(s1.accounts, 1);
    assert_eq!(s1.holdings, 2);
    assert_eq!(s1.transactions_inserted, 1);
    assert_eq!(s1.snapshots, 2);

    let s2 = ingest(&pool, conn_id, &sync).await?;
    assert_eq!(s2.transactions_inserted, 0, "duplicate txn not re-inserted");
    assert_eq!(s2.accounts, 1);
    assert_eq!(s2.holdings, 2);
    assert_eq!(s2.snapshots, 2);

    let accounts: i64 = sqlx::query_scalar("select count(*) from account")
        .fetch_one(&pool)
        .await?;
    let holdings: i64 = sqlx::query_scalar("select count(*) from holding")
        .fetch_one(&pool)
        .await?;
    let txns: i64 = sqlx::query_scalar("select count(*) from transaction")
        .fetch_one(&pool)
        .await?;
    let snaps: i64 = sqlx::query_scalar("select count(*) from holding_snapshot")
        .fetch_one(&pool)
        .await?;
    assert_eq!(
        (accounts, holdings, txns, snaps),
        (1, 2, 1, 2),
        "no duplicates after re-ingest"
    );
    Ok(())
}

#[sqlx::test(migrations = "../migrations")]
async fn cash_instrument_is_shared_across_accounts(pool: PgPool) -> anyhow::Result<()> {
    let conn_id = seed_connection(&pool).await;
    let sync = SyncResult {
        accounts: vec![checking_account("acct-1"), checking_account("acct-2")],
        holdings: vec![
            cash_holding("acct-1", Decimal::new(100, 0)),
            cash_holding("acct-2", Decimal::new(200, 0)),
        ],
        ..Default::default()
    };
    ingest(&pool, conn_id, &sync).await?;

    let cash_instruments: i64 =
        sqlx::query_scalar("select count(*) from instrument where kind = 'cash'")
            .fetch_one(&pool)
            .await?;
    assert_eq!(
        cash_instruments, 1,
        "one EUR cash instrument shared by both accounts"
    );
    Ok(())
}

#[sqlx::test(migrations = "../migrations")]
async fn snapshot_value_matrix(pool: PgPool) -> anyhow::Result<()> {
    let conn_id = seed_connection(&pool).await;
    let sync = SyncResult {
        accounts: vec![checking_account("acct-1")],
        holdings: vec![
            cash_holding("acct-1", Decimal::new(100, 0)), // cash -> value = qty = 100
            equity_holding(
                "acct-1",
                "US0378331005",
                Decimal::new(3, 0),
                Decimal::new(450, 0),
                Some(Decimal::new(600, 0)),
            ), // valued -> 600
            equity_holding(
                "acct-1",
                "US5949181045",
                Decimal::new(2, 0),
                Decimal::new(300, 0),
                None,
            ), // unpriced -> 0
        ],
        ..Default::default()
    };
    ingest(&pool, conn_id, &sync).await?;

    let values: Vec<Decimal> =
        sqlx::query_scalar("select value from holding_snapshot order by value")
            .fetch_all(&pool)
            .await?;
    assert_eq!(
        values,
        vec![
            Decimal::new(0, 0),
            Decimal::new(100, 0),
            Decimal::new(600, 0)
        ]
    );
    Ok(())
}

#[sqlx::test(migrations = "../migrations")]
async fn holding_absent_from_resync_is_closed(pool: PgPool) -> anyhow::Result<()> {
    let conn_id = seed_connection(&pool).await;

    // First sync: a cash holding alongside an equity.
    let sync1 = SyncResult {
        accounts: vec![checking_account("acct-1")],
        holdings: vec![
            cash_holding("acct-1", Decimal::new(1000, 0)),
            equity_holding(
                "acct-1",
                "US0378331005",
                Decimal::new(3, 0),
                Decimal::new(450, 0),
                Some(Decimal::new(600, 0)),
            ),
        ],
        ..Default::default()
    };
    ingest(&pool, conn_id, &sync1).await?;

    // Second sync: the cash holding is gone (e.g. the invest residual went to
    // zero). The equity remains.
    let sync2 = SyncResult {
        accounts: vec![checking_account("acct-1")],
        holdings: vec![equity_holding(
            "acct-1",
            "US0378331005",
            Decimal::new(3, 0),
            Decimal::new(450, 0),
            Some(Decimal::new(600, 0)),
        )],
        ..Default::default()
    };
    let summary = ingest(&pool, conn_id, &sync2).await?;
    assert_eq!(
        summary.holdings_closed, 1,
        "the vanished cash holding is closed"
    );

    // The cash holding's position is zeroed in place (row kept for history).
    let cash_qty: Decimal = sqlx::query_scalar(
        "select h.quantity from holding h \
         join instrument i on i.id = h.instrument_id where i.kind = 'cash'",
    )
    .fetch_one(&pool)
    .await?;
    assert_eq!(cash_qty, Decimal::ZERO, "cash holding quantity zeroed");

    // Its latest snapshot value is zero — no stale value left to double-count.
    let cash_val: Decimal = sqlx::query_scalar(
        "select hs.value from holding_snapshot hs \
         join holding h on h.id = hs.holding_id \
         join instrument i on i.id = h.instrument_id \
         where i.kind = 'cash' order by hs.as_of desc limit 1",
    )
    .fetch_one(&pool)
    .await?;
    assert_eq!(cash_val, Decimal::ZERO, "cash snapshot zeroed");

    // The surviving equity is untouched.
    let eq_val: Decimal = sqlx::query_scalar(
        "select hs.value from holding_snapshot hs \
         join holding h on h.id = hs.holding_id \
         join instrument i on i.id = h.instrument_id \
         where i.kind = 'equity' order by hs.as_of desc limit 1",
    )
    .fetch_one(&pool)
    .await?;
    assert_eq!(eq_val, Decimal::new(600, 0), "equity snapshot intact");
    Ok(())
}

#[sqlx::test(migrations = "../migrations")]
async fn unknown_account_ref_errors_and_rolls_back(pool: PgPool) -> anyhow::Result<()> {
    let conn_id = seed_connection(&pool).await;
    let sync = SyncResult {
        accounts: vec![checking_account("acct-1")],
        holdings: vec![cash_holding("ghost", Decimal::new(100, 0))], // references missing account
        ..Default::default()
    };
    let err = ingest(&pool, conn_id, &sync).await.unwrap_err();
    assert!(matches!(err, CoreError::UnknownAccountRef { .. }));

    // Atomicity: the account that *was* valid must not have been committed.
    let accounts: i64 = sqlx::query_scalar("select count(*) from account")
        .fetch_one(&pool)
        .await?;
    assert_eq!(accounts, 0, "failed ingest rolls back entirely");
    Ok(())
}

#[sqlx::test(migrations = "../migrations")]
async fn cash_instrument_is_shared_across_connections(pool: PgPool) -> anyhow::Result<()> {
    // `instrument` is global; the same EUR cash row must serve holdings under
    // two different connections.
    let conn_a = seed_connection(&pool).await;
    let conn_b = seed_connection(&pool).await;

    let sync_a = SyncResult {
        accounts: vec![checking_account("a-1")],
        holdings: vec![cash_holding("a-1", Decimal::new(100, 0))],
        ..Default::default()
    };
    let sync_b = SyncResult {
        accounts: vec![checking_account("b-1")],
        holdings: vec![cash_holding("b-1", Decimal::new(200, 0))],
        ..Default::default()
    };
    ingest(&pool, conn_a, &sync_a).await?;
    ingest(&pool, conn_b, &sync_b).await?;

    let cash_instruments: i64 =
        sqlx::query_scalar("select count(*) from instrument where kind = 'cash'")
            .fetch_one(&pool)
            .await?;
    assert_eq!(
        cash_instruments, 1,
        "EUR cash instrument is shared across connections"
    );
    Ok(())
}

#[sqlx::test(migrations = "../migrations")]
async fn ingest_stamps_institution_on_connection(pool: PgPool) -> anyhow::Result<()> {
    let conn_id = seed_connection(&pool).await;
    let sync = SyncResult {
        institution: gripsou_core::dto::Institution {
            key: "abc-uuid".into(),
            name: "BNP Paribas".into(),
        },
        accounts: vec![checking_account("acct-1")],
        holdings: vec![cash_holding("acct-1", Decimal::new(100, 0))],
        ..Default::default()
    };
    ingest(&pool, conn_id, &sync).await?;

    let row: (Option<String>, Option<String>) =
        sqlx::query_as("select institution_key, institution_name from connection where id = $1")
            .bind(conn_id)
            .fetch_one(&pool)
            .await?;
    assert_eq!(row, (Some("abc-uuid".into()), Some("BNP Paribas".into())));
    Ok(())
}

/// A transaction on an account the sync never emitted must not destroy an
/// otherwise good sync. Powens' transactions endpoint is user-scoped, so it can
/// name a liability or deleted account that the mapper skipped on purpose.
/// Failing on it would fail every later sync too, since the row never goes
/// away.
#[sqlx::test(migrations = "../migrations")]
async fn unknown_account_ref_in_transaction_is_skipped(pool: PgPool) -> anyhow::Result<()> {
    let conn_id = seed_connection(&pool).await;
    let sync = SyncResult {
        accounts: vec![checking_account("acct-1")],
        holdings: vec![cash_holding("acct-1", Decimal::new(100, 0))],
        transactions: vec![
            deposit_txn("acct-1", "txn-1", Decimal::new(100, 0)),
            deposit_txn("ghost", "txn-2", Decimal::new(50, 0)), // unknown account
        ],
        ..Default::default()
    };
    let summary = ingest(&pool, conn_id, &sync).await?;

    // Everything else committed, and the summary counts only what was written.
    assert_eq!(summary.accounts, 1);
    assert_eq!(summary.holdings, 1);
    assert_eq!(summary.snapshots, 1);
    assert_eq!(
        summary.transactions_inserted, 1,
        "the dangling row is skipped"
    );
    assert_eq!(summary.transactions_updated, 0);
    assert_eq!(summary.transactions_skipped, 1);

    let accounts: i64 = sqlx::query_scalar("select count(*) from account")
        .fetch_one(&pool)
        .await?;
    assert_eq!(
        accounts, 1,
        "a dangling transaction must not roll back the sync"
    );
    let txns: Vec<String> = sqlx::query_scalar("select external_id from transaction")
        .fetch_all(&pool)
        .await?;
    assert_eq!(txns, vec!["txn-1".to_string()]);
    Ok(())
}

/// A dangling *holding* reference stays fatal: `map_sync` guarantees every
/// holding belongs to an emitted account, so a violation is a real bug.
#[sqlx::test(migrations = "../migrations")]
async fn unknown_account_ref_in_holding_still_rolls_back(pool: PgPool) -> anyhow::Result<()> {
    let conn_id = seed_connection(&pool).await;
    let sync = SyncResult {
        accounts: vec![checking_account("acct-1")],
        holdings: vec![cash_holding("ghost", Decimal::new(100, 0))],
        ..Default::default()
    };
    let err = ingest(&pool, conn_id, &sync).await.unwrap_err();
    assert!(matches!(err, CoreError::UnknownAccountRef { .. }));
    let accounts: i64 = sqlx::query_scalar("select count(*) from account")
        .fetch_one(&pool)
        .await?;
    assert_eq!(accounts, 0, "failed ingest rolls back entirely");
    Ok(())
}

/// The backfill runs as part of ingest, so a sync that reports a balance and a
/// history of transactions leaves a usable series behind it.
#[sqlx::test(migrations = "../migrations")]
async fn ingest_derives_history_from_transactions(pool: PgPool) -> anyhow::Result<()> {
    let conn_id = seed_connection(&pool).await;
    let day = chrono::Utc::now().date_naive() - chrono::Duration::days(3);
    let sync = SyncResult {
        accounts: vec![checking_account("acct-1")],
        holdings: vec![cash_holding("acct-1", Decimal::new(10000, 2))],
        transactions: vec![testkit::txn_on(
            "acct-1",
            "t1",
            "deposit",
            Decimal::new(2500, 2),
            day,
        )],
        ..Default::default()
    };
    let summary = gripsou_core::ingest::ingest(&pool, conn_id, &sync).await?;
    assert_eq!(summary.transactions_inserted, 1);
    assert!(summary.backfill_rows > 0, "ingest derives history");

    let before: Option<Decimal> =
        sqlx::query_scalar("select hb.quantity from holding_backfill hb where hb.as_of = $1")
            .bind(day - chrono::Duration::days(1))
            .fetch_optional(&pool)
            .await?;
    assert_eq!(
        before,
        Some(Decimal::new(7500, 2)),
        "100.00 - 25.00 deposit"
    );
    Ok(())
}

#[sqlx::test(migrations = "../migrations")]
async fn health_observations_persist_without_replacing_native_ids(
    pool: PgPool,
) -> anyhow::Result<()> {
    let id = seed_connection(&pool).await;
    sqlx::query("update connection set provider_meta = $2 where id = $1")
        .bind(id)
        .bind(serde_json::json!({"external_connection_id":"6"}))
        .execute(&pool)
        .await?;
    let mut sync = sample_sync();
    sync.provider_meta = serde_json::json!({"sync_health":{"verified":true,"state":null}});
    sync.accounts[0].meta["sync_health"] =
        serde_json::json!({"verified":true,"state":"bug","lastUpdatedOn":"2026-10-08"});
    ingest(&pool, id, &sync).await?;
    let conns = gripsou_core::repo::connection::list_connections(
        &pool,
        gripsou_core::repo::connection::user_id(&pool, id)
            .await?
            .unwrap(),
    )
    .await?;
    assert_eq!(conns[0].provider_meta["external_connection_id"], "6");
    assert_eq!(conns[0].provider_meta["sync_health"]["verified"], true);
    let accounts = gripsou_core::repo::connection::list_connection_accounts(
        &pool,
        gripsou_core::repo::connection::user_id(&pool, id)
            .await?
            .unwrap(),
    )
    .await?;
    assert_eq!(accounts[0].provider_meta["sync_health"]["state"], "bug");
    sync.accounts[0].meta["sync_health"]["state"] = serde_json::Value::Null;
    ingest(&pool, id, &sync).await?;
    let accounts = gripsou_core::repo::connection::list_connection_accounts(
        &pool,
        gripsou_core::repo::connection::user_id(&pool, id)
            .await?
            .unwrap(),
    )
    .await?;
    assert!(accounts[0].provider_meta["sync_health"]["state"].is_null());
    Ok(())
}

async fn user_today(pool: &PgPool, conn_id: uuid::Uuid) -> chrono::NaiveDate {
    sqlx::query_scalar("select user_today(user_id) from connection where id = $1")
        .bind(conn_id)
        .fetch_one(pool)
        .await
        .unwrap()
}

/// (day, quantity) of the cash holding's snapshots.
async fn cash_snapshots(pool: &PgPool) -> Vec<(chrono::NaiveDate, Decimal)> {
    sqlx::query_as(
        "select hs.as_of, hs.quantity from holding_snapshot hs \
         join holding h on h.id = hs.holding_id \
         join instrument i on i.id = h.instrument_id \
         where i.kind = 'cash' order by hs.as_of",
    )
    .fetch_all(pool)
    .await
    .unwrap()
}

/// A provider that last read the bank days ago returns that day's balances:
/// they are stamped on that day, and a holding closed by that sync closes then.
#[sqlx::test(migrations = "../migrations")]
async fn snapshots_are_dated_when_the_bank_was_last_read(pool: PgPool) -> anyhow::Result<()> {
    let conn_id = seed_connection(&pool).await;
    let today = user_today(&pool, conn_id).await;
    let read_on = today - chrono::Duration::days(3);
    let account = gripsou_core::dto::CanonicalAccount {
        balance_as_of: Some(read_on),
        ..checking_account("acct-1")
    };
    let equity = || {
        equity_holding(
            "acct-1",
            "US0378331005",
            Decimal::new(3, 0),
            Decimal::new(450, 0),
            Some(Decimal::new(600, 0)),
        )
    };
    let sync = SyncResult {
        accounts: vec![account.clone()],
        holdings: vec![cash_holding("acct-1", Decimal::new(100, 0)), equity()],
        ..Default::default()
    };
    ingest(&pool, conn_id, &sync).await?;
    assert_eq!(
        cash_snapshots(&pool).await,
        vec![(read_on, Decimal::new(100, 0))]
    );

    let sync = SyncResult {
        accounts: vec![account],
        holdings: vec![cash_holding("acct-1", Decimal::new(100, 0))],
        ..Default::default()
    };
    ingest(&pool, conn_id, &sync).await?;
    let equity_days: Vec<(chrono::NaiveDate, Decimal)> = sqlx::query_as(
        "select hs.as_of, hs.quantity from holding_snapshot hs \
         join holding h on h.id = hs.holding_id \
         join instrument i on i.id = h.instrument_id \
         where i.kind = 'equity' order by hs.as_of",
    )
    .fetch_all(&pool)
    .await?;
    assert_eq!(
        equity_days,
        vec![(read_on, Decimal::ZERO)],
        "closed on the read day"
    );
    Ok(())
}

#[sqlx::test(migrations = "../migrations")]
async fn a_read_day_in_the_future_is_today(pool: PgPool) -> anyhow::Result<()> {
    let conn_id = seed_connection(&pool).await;
    let today = user_today(&pool, conn_id).await;
    let sync = SyncResult {
        accounts: vec![gripsou_core::dto::CanonicalAccount {
            balance_as_of: Some(today + chrono::Duration::days(1)),
            ..checking_account("acct-1")
        }],
        holdings: vec![cash_holding("acct-1", Decimal::new(100, 0))],
        ..Default::default()
    };
    ingest(&pool, conn_id, &sync).await?;
    assert_eq!(
        cash_snapshots(&pool).await,
        vec![(today, Decimal::new(100, 0))]
    );
    Ok(())
}

/// #58: the bank can't be reached for a few days and the provider keeps
/// returning its last balance. Nothing false is saved, and once it's repaired
/// the stretch is rebuilt from the transactions it catches up on.
#[sqlx::test(migrations = "../migrations")]
async fn an_outage_is_rebuilt_from_transactions_once_repaired(pool: PgPool) -> anyhow::Result<()> {
    let conn_id = seed_connection(&pool).await;
    let today = user_today(&pool, conn_id).await;
    let day = |n| today - chrono::Duration::days(n);
    let stale = SyncResult {
        accounts: vec![gripsou_core::dto::CanonicalAccount {
            balance_as_of: Some(day(6)),
            ..checking_account("acct-1")
        }],
        holdings: vec![cash_holding("acct-1", Decimal::new(10000, 2))],
        ..Default::default()
    };
    // The last good read, then daily syncs while the bank is unreachable.
    for _ in 0..3 {
        ingest(&pool, conn_id, &stale).await?;
    }
    assert_eq!(
        cash_snapshots(&pool).await,
        vec![(day(6), Decimal::new(10000, 2))]
    );

    let repaired = SyncResult {
        accounts: vec![checking_account("acct-1")],
        holdings: vec![cash_holding("acct-1", Decimal::new(40000, 2))],
        transactions: vec![
            testkit::txn_on("acct-1", "t1", "deposit", Decimal::new(50000, 2), day(5)),
            testkit::txn_on("acct-1", "t2", "transfer", Decimal::new(-20000, 2), day(3)),
        ],
        ..Default::default()
    };
    ingest(&pool, conn_id, &repaired).await?;
    let points: Vec<(chrono::NaiveDate, Decimal)> = sqlx::query_as(
        "select as_of, quantity from ( \
           select hs.as_of, hs.quantity from holding_snapshot hs \
           union all select hb.as_of, hb.quantity from holding_backfill hb \
         ) p where as_of between $1 and $2 order by as_of",
    )
    .bind(day(6))
    .bind(today)
    .fetch_all(&pool)
    .await?;
    let q = |cents| Decimal::new(cents, 2);
    assert_eq!(
        points,
        vec![
            (day(6), q(10000)),
            (day(5), q(60000)),
            (day(4), q(60000)),
            (day(3), q(40000)),
            (day(2), q(40000)),
            (day(1), q(40000)),
            (today, q(40000)),
        ]
    );
    Ok(())
}
