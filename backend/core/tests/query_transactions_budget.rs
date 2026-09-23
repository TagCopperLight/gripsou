mod common;

use common::{checking_account, seed_user_and_connection, txn};
use gripsou_core::repo::account::upsert_account;
use gripsou_core::repo::budget::assign::{set_category, set_tags};
use gripsou_core::repo::budget::category::list_categories;
use gripsou_core::repo::budget::tag::create_tag;
use gripsou_core::repo::query::{
    TransactionFilters, TypeBucket, matching_transaction_ids, tags_for_transactions,
    transaction_counts, transactions,
};
use gripsou_core::repo::transaction::upsert_transaction;
use rust_decimal::Decimal;
use sqlx::PgPool;
use uuid::Uuid;

fn filters() -> TransactionFilters {
    TransactionFilters {
        search: None,
        account_id: None,
        kind: None,
        bucket: TypeBucket::All,
        from: None,
        to: None,
        category_ids: vec![],
        tag_ids: vec![],
        uncategorized: false,
        needs_review: false,
        include_transfers: true,
        review_threshold: Decimal::new(80, 2),
        limit: 200,
        offset: 0,
    }
}

/// One salary in, two spends out.
async fn fixture(pool: &PgPool) -> anyhow::Result<(Uuid, Vec<Uuid>)> {
    let (user_id, conn_id) = seed_user_and_connection(pool).await;
    let mut conn = pool.acquire().await?;
    let account_id = upsert_account(&mut conn, conn_id, &checking_account("acct-1")).await?;
    for (ext, kind, amount, desc) in [
        ("t1", "deposit", Decimal::new(250000, 2), "VIR SALAIRE"),
        ("t2", "withdrawal", Decimal::new(-1200, 2), "LECLERC"),
        ("t3", "withdrawal", Decimal::new(-999, 2), "SPOTIFY"),
    ] {
        upsert_transaction(
            &mut conn,
            account_id,
            &txn("acct-1", ext, kind, amount, Some(desc)),
        )
        .await?;
    }
    let ids: Vec<Uuid> = sqlx::query_scalar("select id from transaction order by external_id")
        .fetch_all(pool)
        .await?;
    Ok((user_id, ids))
}

#[sqlx::test(migrations = "../migrations")]
async fn rows_carry_their_category(pool: PgPool) -> anyhow::Result<()> {
    let (user_id, ids) = fixture(&pool).await?;
    let groceries = list_categories(&pool, user_id)
        .await?
        .into_iter()
        .find(|c| c.default_key.as_deref() == Some("groceries"))
        .unwrap();
    set_category(&pool, user_id, ids[1], Some(groceries.id)).await?;

    let rows = transactions(&pool, user_id, &filters()).await?;
    let leclerc = rows.iter().find(|r| r.id == ids[1]).unwrap();
    assert_eq!(leclerc.category_id, Some(groceries.id));
    assert_eq!(leclerc.category_name.as_deref(), Some("Groceries"));
    assert_eq!(leclerc.category_default_key.as_deref(), Some("groceries"));
    assert_eq!(
        leclerc.category_color.as_deref(),
        Some(groceries.color.as_str())
    );
    assert_eq!(leclerc.category_kind.as_deref(), Some("expense"));
    assert_eq!(leclerc.category_source.as_deref(), Some("user"));
    assert!(!leclerc.needs_review);
    assert!(!leclerc.checked);
    assert!(!leclerc.is_transfer);

    let spotify = rows.iter().find(|r| r.id == ids[2]).unwrap();
    assert_eq!(spotify.category_id, None);
    Ok(())
}

#[sqlx::test(migrations = "../migrations")]
async fn buckets_split_money_in_from_money_out(pool: PgPool) -> anyhow::Result<()> {
    let (user_id, _ids) = fixture(&pool).await?;

    let money_in = transactions(
        &pool,
        user_id,
        &TransactionFilters {
            bucket: TypeBucket::MoneyIn,
            ..filters()
        },
    )
    .await?;
    assert_eq!(money_in.len(), 1);
    assert!(money_in[0].amount > Decimal::ZERO);

    let money_out = transactions(
        &pool,
        user_id,
        &TransactionFilters {
            bucket: TypeBucket::MoneyOut,
            ..filters()
        },
    )
    .await?;
    assert_eq!(money_out.len(), 2);

    let lots = transactions(
        &pool,
        user_id,
        &TransactionFilters {
            bucket: TypeBucket::Lots,
            ..filters()
        },
    )
    .await?;
    assert!(lots.is_empty(), "no lots in this fixture");
    Ok(())
}

#[sqlx::test(migrations = "../migrations")]
async fn category_filter_is_or_and_tag_filter_is_and(pool: PgPool) -> anyhow::Result<()> {
    let (user_id, ids) = fixture(&pool).await?;
    let cats = list_categories(&pool, user_id).await?;
    let groceries = cats
        .iter()
        .find(|c| c.default_key.as_deref() == Some("groceries"))
        .unwrap()
        .id;
    let subs = cats
        .iter()
        .find(|c| c.default_key.as_deref() == Some("subscriptions"))
        .unwrap()
        .id;
    set_category(&pool, user_id, ids[1], Some(groceries)).await?;
    set_category(&pool, user_id, ids[2], Some(subs)).await?;

    let either = transactions(
        &pool,
        user_id,
        &TransactionFilters {
            category_ids: vec![groceries, subs],
            ..filters()
        },
    )
    .await?;
    assert_eq!(either.len(), 2, "two categories mean either, not both");

    let holiday = create_tag(&pool, user_id, "Holiday", None).await?.id;
    let work = create_tag(&pool, user_id, "Work", None).await?.id;
    set_tags(&pool, user_id, ids[1], &[holiday, work]).await?;
    set_tags(&pool, user_id, ids[2], &[holiday]).await?;

    let both = transactions(
        &pool,
        user_id,
        &TransactionFilters {
            tag_ids: vec![holiday, work],
            ..filters()
        },
    )
    .await?;
    assert_eq!(both.len(), 1, "two tags mean both");
    assert_eq!(both[0].id, ids[1]);
    Ok(())
}

#[sqlx::test(migrations = "../migrations")]
async fn uncategorized_and_needs_review_filters(pool: PgPool) -> anyhow::Result<()> {
    let (user_id, ids) = fixture(&pool).await?;
    let groceries = list_categories(&pool, user_id)
        .await?
        .into_iter()
        .find(|c| c.default_key.as_deref() == Some("groceries"))
        .unwrap()
        .id;
    // One row categorised by the user, one guessed by the AI at 0.40.
    set_category(&pool, user_id, ids[1], Some(groceries)).await?;
    sqlx::query(
        "update transaction set budget_category_id = $1, category_source = 'ai', \
         category_confidence = 0.40 where id = $2",
    )
    .bind(groceries)
    .bind(ids[2])
    .execute(&pool)
    .await?;

    let uncategorized = transactions(
        &pool,
        user_id,
        &TransactionFilters {
            uncategorized: true,
            ..filters()
        },
    )
    .await?;
    assert_eq!(uncategorized.len(), 1);
    assert_eq!(uncategorized[0].id, ids[0]);

    let review = transactions(
        &pool,
        user_id,
        &TransactionFilters {
            needs_review: true,
            ..filters()
        },
    )
    .await?;
    assert_eq!(review.len(), 1);
    assert_eq!(review[0].id, ids[2]);
    assert!(review[0].needs_review);

    // A confident guess is not in the queue.
    let confident = transactions(
        &pool,
        user_id,
        &TransactionFilters {
            needs_review: true,
            review_threshold: Decimal::new(20, 2),
            ..filters()
        },
    )
    .await?;
    assert!(
        confident.is_empty(),
        "moving the threshold reshapes the queue"
    );
    Ok(())
}

#[sqlx::test(migrations = "../migrations")]
async fn counts_report_matching_total_and_uncategorized(pool: PgPool) -> anyhow::Result<()> {
    let (user_id, ids) = fixture(&pool).await?;
    let groceries = list_categories(&pool, user_id)
        .await?
        .into_iter()
        .find(|c| c.default_key.as_deref() == Some("groceries"))
        .unwrap()
        .id;
    set_category(&pool, user_id, ids[1], Some(groceries)).await?;

    let counts = transaction_counts(
        &pool,
        user_id,
        &TransactionFilters {
            bucket: TypeBucket::MoneyOut,
            ..filters()
        },
    )
    .await?;
    assert_eq!(counts.matching, 2);
    assert_eq!(counts.total, 3, "total ignores the filters");
    assert_eq!(counts.uncategorized, 2, "so does the uncategorised count");
    Ok(())
}

/// `matching` is the header pair the list's search surface shows, and the list
/// includes lot rows under `All`/`Lots` — so the header must too, or the two
/// numbers visibly disagree even with no filter applied at all. Bulk actions
/// stay a separate, lot-free contract (`matching_transaction_ids`), checked
/// here too so the two never get confused for each other again.
#[sqlx::test(migrations = "../migrations")]
async fn counts_include_lot_rows_the_list_actually_shows(pool: PgPool) -> anyhow::Result<()> {
    let (user_id, ids) = fixture(&pool).await?;
    let account_id: Uuid = sqlx::query_scalar("select account_id from transaction where id = $1")
        .bind(ids[0])
        .fetch_one(&pool)
        .await?;
    let holding_id =
        common::seed_equity_holding(&pool, account_id, "PUST", Decimal::new(2, 0)).await;
    sqlx::query(
        "insert into lot (holding_id, side, acquired_on, quantity, unit_price, fee, source) \
         values ($1, 'buy', date '2026-06-01', 2, 98.37, 1.05, 'manual')",
    )
    .bind(holding_id)
    .execute(&pool)
    .await?;

    let all_rows = transactions(&pool, user_id, &filters()).await?;
    assert_eq!(all_rows.len(), 4, "3 cash rows plus the 1 lot row");

    let counts = transaction_counts(&pool, user_id, &filters()).await?;
    assert_eq!(
        counts.matching,
        all_rows.len() as i64,
        "matching mirrors exactly what the unfiltered list shows, lot row included"
    );
    assert_eq!(
        counts.matching, counts.total,
        "no filters: matching equals total"
    );

    let lots_filters = TransactionFilters {
        bucket: TypeBucket::Lots,
        ..filters()
    };
    let lots_only = transactions(&pool, user_id, &lots_filters).await?;
    let lots_counts = transaction_counts(&pool, user_id, &lots_filters).await?;
    assert_eq!(lots_counts.matching, lots_only.len() as i64);
    assert_eq!(lots_counts.matching, 1, "the one lot row, not zero");

    // Bulk actions are a different contract: they must never reach a lot row,
    // even while the header above correctly counts it.
    let bulk_ids = matching_transaction_ids(&pool, user_id, &filters()).await?;
    assert_eq!(
        bulk_ids.len(),
        3,
        "bulk-action ids stay lot-free even though the header counts the lot"
    );
    Ok(())
}

fn pea_account(external_id: &str) -> gripsou_core::dto::CanonicalAccount {
    gripsou_core::dto::CanonicalAccount {
        type_key: "pea".to_string(),
        ..checking_account(external_id)
    }
}

/// `transactions()` hides a PEA's provider `buy`/`sell` rows (the lot branch
/// already lists them). The counts must agree with it, unfiltered: if
/// `total`/`uncategorized` reverted to counting raw `transaction` rows with no
/// PEA exclusion, `matching` (which does exclude them) could never equal
/// `total`, and `uncategorized` would count rows the list can never show, so
/// this would fail on both assertions.
#[sqlx::test(migrations = "../migrations")]
async fn counts_hide_pea_trades_like_the_list(pool: PgPool) -> anyhow::Result<()> {
    let (user_id, _ids) = fixture(&pool).await?;
    let conn_id: Uuid = sqlx::query_scalar("select connection_id from account limit 1")
        .fetch_one(&pool)
        .await?;
    let mut conn = pool.acquire().await?;
    let pea_id = upsert_account(&mut conn, conn_id, &pea_account("pea-1")).await?;
    for (id, kind, amount, desc) in [
        ("p1", "transfer", "50.00", "Virement depuis Livret"),
        ("p2", "buy", "-197.79", "ACHAT COMPTANT"),
        ("p3", "sell", "40.00", "VENTE COMPTANT"),
        ("p4", "dividend", "7.10", "COUPONS"),
    ] {
        upsert_transaction(
            &mut conn,
            pea_id,
            &txn("pea-1", id, kind, amount.parse().unwrap(), Some(desc)),
        )
        .await?;
    }

    let all_rows = transactions(&pool, user_id, &filters()).await?;
    let counts = transaction_counts(&pool, user_id, &filters()).await?;

    assert_eq!(
        counts.total,
        all_rows.len() as i64,
        "total must match the list, which hides the PEA buy/sell rows"
    );
    assert_eq!(
        counts.matching, counts.total,
        "unfiltered: matching (already PEA-excluded) must equal total"
    );
    // 3 checking rows + the PEA transfer and dividend visible; the PEA
    // buy/sell are hidden, so uncategorized (all of these are uncategorized)
    // must match.
    assert_eq!(counts.uncategorized, 5);
    Ok(())
}

#[sqlx::test(migrations = "../migrations")]
async fn matching_ids_drive_bulk_actions_and_exclude_lots(pool: PgPool) -> anyhow::Result<()> {
    let (user_id, ids) = fixture(&pool).await?;

    let all = matching_transaction_ids(&pool, user_id, &filters()).await?;
    assert_eq!(all.len(), 3);

    let out = matching_transaction_ids(
        &pool,
        user_id,
        &TransactionFilters {
            bucket: TypeBucket::MoneyOut,
            ..filters()
        },
    )
    .await?;
    assert_eq!(out.len(), 2);
    assert!(!out.contains(&ids[0]));

    let lots = matching_transaction_ids(
        &pool,
        user_id,
        &TransactionFilters {
            bucket: TypeBucket::Lots,
            ..filters()
        },
    )
    .await?;
    assert!(lots.is_empty(), "a bulk action can never reach a lot row");
    Ok(())
}

#[sqlx::test(migrations = "../migrations")]
async fn tags_come_back_grouped_by_transaction(pool: PgPool) -> anyhow::Result<()> {
    let (user_id, ids) = fixture(&pool).await?;
    let holiday = create_tag(&pool, user_id, "Holiday", Some("#5b9bf0"))
        .await?
        .id;
    set_tags(&pool, user_id, ids[1], &[holiday]).await?;

    let map = tags_for_transactions(&pool, user_id, &ids).await?;
    assert_eq!(map.get(&ids[1]).map(|v| v.len()), Some(1));
    assert_eq!(map[&ids[1]][0].name, "Holiday");
    assert_eq!(map[&ids[1]][0].color.as_deref(), Some("#5b9bf0"));
    assert!(
        !map.contains_key(&ids[0]),
        "untagged rows are simply absent"
    );
    Ok(())
}

/// A row the pairing pass categorised whose link has since been dissolved (by
/// a user correcting one half, spec §4) still carries `Internal transfer` but
/// nets against nothing. The list flags it so the reader can see the
/// consequence rather than having to hunt for it.
#[sqlx::test(migrations = "../migrations")]
async fn a_pair_categorised_row_with_no_pair_left_is_an_orphan(pool: PgPool) -> anyhow::Result<()> {
    let (user_id, ids) = fixture(&pool).await?;
    sqlx::query("update transaction set category_source = 'pair' where id = $1")
        .bind(ids[1])
        .execute(&pool)
        .await?;

    let rows = transactions(&pool, user_id, &filters()).await?;
    let orphan = rows.iter().find(|r| r.id == ids[1]).unwrap();
    assert!(!orphan.is_transfer);
    assert!(orphan.is_orphan_transfer);
    Ok(())
}

/// A cross-currency transfer the user categorised by hand never had a pair to
/// lose (spec §5.2's stated limit). Matching on the category would flag it
/// forever; matching on `category_source = 'pair'` — which only the pairing
/// pass writes, and which always comes with a link — does not.
#[sqlx::test(migrations = "../migrations")]
async fn a_hand_categorised_unpaired_row_is_not_an_orphan(pool: PgPool) -> anyhow::Result<()> {
    let (user_id, ids) = fixture(&pool).await?;
    let internal = list_categories(&pool, user_id)
        .await?
        .into_iter()
        .find(|c| c.system_key.as_deref() == Some("internal_transfer"))
        .unwrap();
    set_category(&pool, user_id, ids[1], Some(internal.id)).await?;

    let rows = transactions(&pool, user_id, &filters()).await?;
    let row = rows.iter().find(|r| r.id == ids[1]).unwrap();
    assert!(!row.is_orphan_transfer);
    Ok(())
}

/// A live pair is not an orphan: the two states are mutually exclusive, so the
/// reader never sees both notes at once.
#[sqlx::test(migrations = "../migrations")]
async fn a_still_linked_pair_is_not_an_orphan(pool: PgPool) -> anyhow::Result<()> {
    let (user_id, ids) = fixture(&pool).await?;
    sqlx::query(
        "update transaction set category_source = 'pair', transfer_pair_id = $2 where id = $1",
    )
    .bind(ids[1])
    .bind(ids[2])
    .execute(&pool)
    .await?;

    let rows = transactions(&pool, user_id, &filters()).await?;
    let row = rows.iter().find(|r| r.id == ids[1]).unwrap();
    assert!(row.is_transfer);
    assert!(!row.is_orphan_transfer);
    Ok(())
}

/// Internal transfers are noise in a list about spending, so the list hides
/// them unless asked. The header's `matching` count and "select all shown"
/// hide them too — all three read the same filter, so the count can never
/// promise rows the list does not show, and a bulk action can never touch a
/// row the user cannot see.
#[sqlx::test(migrations = "../migrations")]
async fn internal_transfers_are_hidden_unless_asked_for(pool: PgPool) -> anyhow::Result<()> {
    let (user_id, ids) = fixture(&pool).await?;
    let internal = list_categories(&pool, user_id)
        .await?
        .into_iter()
        .find(|c| c.system_key.as_deref() == Some("internal_transfer"))
        .unwrap();
    set_category(&pool, user_id, ids[1], Some(internal.id)).await?;

    let hidden = TransactionFilters {
        include_transfers: false,
        ..filters()
    };

    let rows = transactions(&pool, user_id, &hidden).await?;
    assert_eq!(rows.len(), 2);
    assert!(rows.iter().all(|r| r.id != ids[1]));
    assert_eq!(
        transaction_counts(&pool, user_id, &hidden).await?.matching,
        2
    );
    let bulk_ids = matching_transaction_ids(&pool, user_id, &hidden).await?;
    assert_eq!(bulk_ids.len(), 2);
    assert!(!bulk_ids.contains(&ids[1]));

    // Asked for, it comes back — and is filtered like any other row.
    let shown = transactions(&pool, user_id, &filters()).await?;
    assert_eq!(shown.len(), 3);
    let out_only = transactions(
        &pool,
        user_id,
        &TransactionFilters {
            bucket: TypeBucket::MoneyIn,
            ..filters()
        },
    )
    .await?;
    assert!(
        out_only.iter().all(|r| r.id != ids[1]),
        "still bucket-filtered"
    );
    Ok(())
}
