mod common;

use chrono::{DateTime, Utc};
use common::{checking_account, seed_user_and_connection, txn};
use gripsou_core::repo::account::upsert_account;
use gripsou_core::repo::budget::assign::{
    BulkChanges, apply_category_to_same_description, bulk_add_tags, bulk_apply, bulk_set_category,
    bulk_set_checked, count_paired_same_description, count_same_description, set_category,
    set_checked, set_tags,
};
use gripsou_core::repo::budget::category::list_categories;
use gripsou_core::repo::budget::tag::create_tag;
use gripsou_core::repo::transaction::upsert_transaction;
use rust_decimal::Decimal;
use sqlx::PgPool;
use uuid::Uuid;

/// Seeds one account with `n` withdrawals, returning (user, category id of
/// Groceries, transaction ids in insertion order).
async fn fixture(pool: &PgPool, descriptions: &[&str]) -> anyhow::Result<(Uuid, Uuid, Vec<Uuid>)> {
    let (user_id, conn_id) = seed_user_and_connection(pool).await;
    let mut conn = pool.acquire().await?;
    let account_id = upsert_account(&mut conn, conn_id, &checking_account("acct-1")).await?;
    for (i, d) in descriptions.iter().enumerate() {
        upsert_transaction(
            &mut conn,
            account_id,
            &txn(
                "acct-1",
                &format!("t{i}"),
                "withdrawal",
                Decimal::new(-1200, 2),
                Some(d),
            ),
        )
        .await?;
    }
    let ids: Vec<Uuid> = sqlx::query_scalar("select id from transaction order by external_id")
        .fetch_all(pool)
        .await?;
    let groceries = list_categories(pool, user_id)
        .await?
        .into_iter()
        .find(|c| c.default_key.as_deref() == Some("groceries"))
        .unwrap()
        .id;
    Ok((user_id, groceries, ids))
}

#[sqlx::test(migrations = "../migrations")]
async fn assigning_a_category_marks_it_as_the_users_own(pool: PgPool) -> anyhow::Result<()> {
    let (user_id, groceries, ids) = fixture(&pool, &["LECLERC"]).await?;

    assert!(set_category(&pool, user_id, ids[0], Some(groceries)).await?);

    let (cat, source, reviewed): (Option<Uuid>, Option<String>, Option<chrono::DateTime<chrono::Utc>>) =
        sqlx::query_as("select budget_category_id, category_source, category_reviewed_at from transaction where id = $1")
            .bind(ids[0])
            .fetch_one(&pool)
            .await?;
    assert_eq!(cat, Some(groceries));
    assert_eq!(source.as_deref(), Some("user"));
    assert!(
        reviewed.is_some(),
        "a user assignment is reviewed by definition"
    );
    Ok(())
}

#[sqlx::test(migrations = "../migrations")]
async fn clearing_a_category_returns_the_row_to_the_pipeline(pool: PgPool) -> anyhow::Result<()> {
    let (user_id, groceries, ids) = fixture(&pool, &["LECLERC"]).await?;
    set_category(&pool, user_id, ids[0], Some(groceries)).await?;

    assert!(set_category(&pool, user_id, ids[0], None).await?);

    let (cat, source): (Option<Uuid>, Option<String>) =
        sqlx::query_as("select budget_category_id, category_source from transaction where id = $1")
            .bind(ids[0])
            .fetch_one(&pool)
            .await?;
    assert_eq!(cat, None);
    assert_eq!(source, None);
    Ok(())
}

#[sqlx::test(migrations = "../migrations")]
async fn a_foreign_category_or_transaction_is_refused(pool: PgPool) -> anyhow::Result<()> {
    let (user_id, groceries, ids) = fixture(&pool, &["LECLERC"]).await?;
    let (stranger, _c) = seed_user_and_connection(&pool).await;
    let stranger_category = list_categories(&pool, stranger).await?[0].id;

    assert!(
        !set_category(&pool, stranger, ids[0], None).await?,
        "not their transaction"
    );
    assert!(
        !set_category(&pool, user_id, ids[0], Some(stranger_category)).await?,
        "not their category"
    );
    // The good pair still works, proving the refusals were specific.
    assert!(set_category(&pool, user_id, ids[0], Some(groceries)).await?);
    Ok(())
}

#[sqlx::test(migrations = "../migrations")]
async fn set_tags_replaces_the_whole_set(pool: PgPool) -> anyhow::Result<()> {
    let (user_id, _groceries, ids) = fixture(&pool, &["LECLERC"]).await?;
    let holiday = create_tag(&pool, user_id, "Holiday", None).await?.id;
    let work = create_tag(&pool, user_id, "Work", None).await?.id;

    assert!(set_tags(&pool, user_id, ids[0], &[holiday, work]).await?);
    assert!(set_tags(&pool, user_id, ids[0], &[work]).await?);

    let left: Vec<Uuid> =
        sqlx::query_scalar("select tag_id from budget_transaction_tag where transaction_id = $1")
            .bind(ids[0])
            .fetch_all(&pool)
            .await?;
    assert_eq!(left, vec![work]);

    assert!(
        set_tags(&pool, user_id, ids[0], &[]).await?,
        "clearing is allowed"
    );
    let none: i64 =
        sqlx::query_scalar("select count(*) from budget_transaction_tag where transaction_id = $1")
            .bind(ids[0])
            .fetch_one(&pool)
            .await?;
    assert_eq!(none, 0);
    Ok(())
}

#[sqlx::test(migrations = "../migrations")]
async fn checked_is_a_timestamp_the_engine_never_reads(pool: PgPool) -> anyhow::Result<()> {
    let (user_id, _groceries, ids) = fixture(&pool, &["LECLERC"]).await?;

    assert!(set_checked(&pool, user_id, ids[0], true).await?);
    let stamped: Option<chrono::DateTime<chrono::Utc>> =
        sqlx::query_scalar("select checked_at from transaction where id = $1")
            .bind(ids[0])
            .fetch_one(&pool)
            .await?;
    assert!(stamped.is_some());

    assert!(set_checked(&pool, user_id, ids[0], false).await?);
    let cleared: Option<chrono::DateTime<chrono::Utc>> =
        sqlx::query_scalar("select checked_at from transaction where id = $1")
            .bind(ids[0])
            .fetch_one(&pool)
            .await?;
    assert!(cleared.is_none());
    Ok(())
}

#[sqlx::test(migrations = "../migrations")]
async fn bulk_operations_touch_only_the_users_rows(pool: PgPool) -> anyhow::Result<()> {
    let (user_id, groceries, ids) = fixture(&pool, &["A", "B", "C"]).await?;
    let holiday = create_tag(&pool, user_id, "Holiday", None).await?.id;
    let (stranger, _c) = seed_user_and_connection(&pool).await;

    assert_eq!(
        bulk_set_category(&pool, user_id, &ids, Some(groceries)).await?,
        3
    );
    assert_eq!(bulk_add_tags(&pool, user_id, &ids, &[holiday]).await?, 3);
    assert_eq!(bulk_set_checked(&pool, user_id, &ids, true).await?, 3);
    // Re-adding the same tag is idempotent, not an error.
    assert_eq!(bulk_add_tags(&pool, user_id, &ids, &[holiday]).await?, 3);

    assert_eq!(
        bulk_set_category(&pool, stranger, &ids, None).await?,
        0,
        "a stranger's bulk write hits nothing"
    );
    let still: i64 =
        sqlx::query_scalar("select count(*) from transaction where budget_category_id = $1")
            .bind(groceries)
            .fetch_one(&pool)
            .await?;
    assert_eq!(still, 3);
    Ok(())
}

/// The "N other transactions have this description" prompt: the count ignores
/// the row being corrected, and matching is on the normalised string, so a card
/// mask or a date in the wording does not split a merchant in two.
#[sqlx::test(migrations = "../migrations")]
async fn same_description_counts_and_applies_across_wordings(pool: PgPool) -> anyhow::Result<()> {
    let (user_id, groceries, ids) = fixture(
        &pool,
        &[
            "CARTE 12/03/26 CB*4242 LECLERC",
            "CARTE 04/04/26 CB*4242 LECLERC",
            "SPOTIFY",
        ],
    )
    .await?;

    assert_eq!(count_same_description(&pool, user_id, ids[0]).await?, 1);
    assert_eq!(count_same_description(&pool, user_id, ids[2]).await?, 0);

    let mut written =
        apply_category_to_same_description(&pool, user_id, ids[0], Some(groceries)).await?;
    written.sort();
    let mut twins = vec![ids[0], ids[1]];
    twins.sort();
    assert_eq!(written, twins, "the row itself and its twin, by id");
    let categorised: i64 =
        sqlx::query_scalar("select count(*) from transaction where budget_category_id = $1")
            .bind(groceries)
            .fetch_one(&pool)
            .await?;
    assert_eq!(categorised, 2);
    Ok(())
}

/// Regression for review finding 1: no tags to add means no transaction was
/// touched by any definition, even though every id in `txn_ids` is this
/// user's own and would otherwise count as "matched".
#[sqlx::test(migrations = "../migrations")]
async fn bulk_add_tags_with_no_tags_touches_nothing(pool: PgPool) -> anyhow::Result<()> {
    let (user_id, _groceries, ids) = fixture(&pool, &["A", "B"]).await?;

    assert_eq!(bulk_add_tags(&pool, user_id, &ids, &[]).await?, 0);

    let none: i64 = sqlx::query_scalar("select count(*) from budget_transaction_tag")
        .fetch_one(&pool)
        .await?;
    assert_eq!(none, 0);
    Ok(())
}

/// Regression for review finding 2: `apply_category_to_same_description` must
/// agree with `count_same_description` on which rows count as "the same
/// merchant" — a blank (null) description never clusters with other blank
/// descriptions, and an anchor whose own description is blank applies to
/// nothing at all, not to every other blank-description row.
#[sqlx::test(migrations = "../migrations")]
async fn applying_to_same_description_refuses_a_blank_anchor(pool: PgPool) -> anyhow::Result<()> {
    let (user_id, conn_id) = seed_user_and_connection(&pool).await;
    let mut conn = pool.acquire().await?;
    let account_id = upsert_account(&mut conn, conn_id, &checking_account("acct-1")).await?;
    for (i, d) in [None, None, Some("SPOTIFY")].into_iter().enumerate() {
        upsert_transaction(
            &mut conn,
            account_id,
            &txn(
                "acct-1",
                &format!("t{i}"),
                "withdrawal",
                Decimal::new(-1200, 2),
                d,
            ),
        )
        .await?;
    }
    let ids: Vec<Uuid> = sqlx::query_scalar("select id from transaction order by external_id")
        .fetch_all(&pool)
        .await?;
    let groceries = list_categories(&pool, user_id)
        .await?
        .into_iter()
        .find(|c| c.default_key.as_deref() == Some("groceries"))
        .unwrap()
        .id;

    assert_eq!(
        apply_category_to_same_description(&pool, user_id, ids[0], Some(groceries))
            .await?
            .len(),
        0,
        "a blank-description anchor applies to nothing, including its blank-description sibling"
    );
    let categorised: i64 =
        sqlx::query_scalar("select count(*) from transaction where budget_category_id = $1")
            .bind(groceries)
            .fetch_one(&pool)
            .await?;
    assert_eq!(categorised, 0);
    Ok(())
}

/// Regression for review finding 2 (round 2): `count_same_description` and
/// `apply_category_to_same_description` must agree in both directions, not
/// just on a blank/null anchor. `budget_norm_description` collapses any run
/// of 2+ digits, so two *unrelated* digit-only descriptions ("12345",
/// "98765") both normalise to `''` and must not cluster as the same
/// merchant — a normalised-empty description carries no merchant identity.
#[sqlx::test(migrations = "../migrations")]
async fn digit_only_descriptions_never_cluster_and_the_pair_agrees(
    pool: PgPool,
) -> anyhow::Result<()> {
    let (user_id, groceries, ids) = fixture(&pool, &["12345", "98765", "SPOTIFY"]).await?;

    let count = count_same_description(&pool, user_id, ids[0]).await?;
    let applied = apply_category_to_same_description(&pool, user_id, ids[0], Some(groceries))
        .await?
        .len();

    assert_eq!(
        count, 0,
        "a digit-only description has no merchant identity"
    );
    assert_eq!(
        applied, 0,
        "the preview and the apply must agree: nothing to apply either"
    );
    Ok(())
}

/// Regression for review finding 2 (round 2): the specific divergence the
/// re-review caught — a blank (null) anchor with a digit-only sibling
/// present. Before this fix, `count_same_description`'s anchor subquery had
/// no normalised-value guard, so it would report the digit-only sibling as
/// "the same description" (both normalise to `''`) while
/// `apply_category_to_same_description` correctly refused to touch anything.
/// The preview and the apply must show the same number: zero.
#[sqlx::test(migrations = "../migrations")]
async fn blank_anchor_with_digit_only_sibling_agrees_on_nothing(
    pool: PgPool,
) -> anyhow::Result<()> {
    let (user_id, conn_id) = seed_user_and_connection(&pool).await;
    let mut conn = pool.acquire().await?;
    let account_id = upsert_account(&mut conn, conn_id, &checking_account("acct-1")).await?;
    for (i, d) in [None, Some("12345"), Some("SPOTIFY")]
        .into_iter()
        .enumerate()
    {
        upsert_transaction(
            &mut conn,
            account_id,
            &txn(
                "acct-1",
                &format!("t{i}"),
                "withdrawal",
                Decimal::new(-1200, 2),
                d,
            ),
        )
        .await?;
    }
    let ids: Vec<Uuid> = sqlx::query_scalar("select id from transaction order by external_id")
        .fetch_all(&pool)
        .await?;
    let groceries = list_categories(&pool, user_id)
        .await?
        .into_iter()
        .find(|c| c.default_key.as_deref() == Some("groceries"))
        .unwrap()
        .id;

    let count = count_same_description(&pool, user_id, ids[0]).await?;
    let applied = apply_category_to_same_description(&pool, user_id, ids[0], Some(groceries))
        .await?
        .len();

    assert_eq!(
        count, 0,
        "the preview must not count the digit-only sibling"
    );
    assert_eq!(applied, 0, "and the apply must agree: nothing was touched");
    Ok(())
}

// ---------------------------------------------------------------------------
// Bulk writes and the pair-break guard
//
// A category write dissolves any internal-transfer pair it touches, and "select
// all shown" can sweep up pairs the client has never loaded and so cannot
// count. The caller therefore confirms: an unconfirmed call that would break
// pairs writes *nothing* and reports the count instead.
// ---------------------------------------------------------------------------

/// Seeds a paired internal transfer across two accounts and returns
/// `(user_id, groceries, outgoing, incoming)`.
async fn paired_fixture(pool: &PgPool) -> anyhow::Result<(Uuid, Uuid, Uuid, Uuid)> {
    let (user_id, groceries, ids) = fixture(pool, &["VIREMENT A", "VIREMENT B"]).await?;
    sqlx::query("update transaction set transfer_pair_id = $2 where id = $1")
        .bind(ids[0])
        .bind(ids[1])
        .execute(pool)
        .await?;
    sqlx::query("update transaction set transfer_pair_id = $2 where id = $1")
        .bind(ids[1])
        .bind(ids[0])
        .execute(pool)
        .await?;
    Ok((user_id, groceries, ids[0], ids[1]))
}

#[sqlx::test(migrations = "../migrations")]
async fn an_unconfirmed_bulk_reports_the_pairs_it_would_break(pool: PgPool) -> anyhow::Result<()> {
    let (user_id, groceries, out, _inn) = paired_fixture(&pool).await?;

    let outcome = bulk_apply(
        &pool,
        user_id,
        &[out],
        BulkChanges {
            category_id: Some(Some(groceries)),
            ..BulkChanges::default()
        },
        false,
    )
    .await?;

    assert_eq!(outcome.pending_pair_breaks, Some(1));
    assert_eq!(outcome.updated, 0);
    Ok(())
}

/// The guard runs before *any* write, so a call carrying tags alongside the
/// category cannot half-apply while waiting for confirmation.
#[sqlx::test(migrations = "../migrations")]
async fn an_unconfirmed_bulk_writes_nothing_at_all(pool: PgPool) -> anyhow::Result<()> {
    let (user_id, groceries, out, _inn) = paired_fixture(&pool).await?;
    let tag = create_tag(&pool, user_id, "Holiday", None).await?;

    bulk_apply(
        &pool,
        user_id,
        &[out],
        BulkChanges {
            category_id: Some(Some(groceries)),
            add_tag_ids: Some(&[tag.id]),
            checked: Some(true),
        },
        false,
    )
    .await?;

    let (category, checked, tags): (Option<Uuid>, Option<DateTime<Utc>>, i64) = sqlx::query_as(
        "select t.budget_category_id, t.checked_at,
                (select count(*) from budget_transaction_tag g where g.transaction_id = t.id)
           from transaction t where t.id = $1",
    )
    .bind(out)
    .fetch_one(&pool)
    .await?;
    assert_eq!(category, None, "no category written");
    assert_eq!(checked, None, "not checked");
    assert_eq!(tags, 0, "no tag written");
    Ok(())
}

#[sqlx::test(migrations = "../migrations")]
async fn a_confirmed_bulk_writes_and_unlinks(pool: PgPool) -> anyhow::Result<()> {
    let (user_id, groceries, out, inn) = paired_fixture(&pool).await?;

    let outcome = bulk_apply(
        &pool,
        user_id,
        &[out],
        BulkChanges {
            category_id: Some(Some(groceries)),
            ..BulkChanges::default()
        },
        true,
    )
    .await?;

    assert_eq!(outcome.pending_pair_breaks, None);
    assert_eq!(outcome.updated, 1);
    let links: Vec<(Uuid, Option<Uuid>)> =
        sqlx::query_as("select id, transfer_pair_id from transaction where id = any($1)")
            .bind(vec![out, inn])
            .fetch_all(&pool)
            .await?;
    assert!(links.iter().all(|(_, pair)| pair.is_none()));
    Ok(())
}

/// Nothing to confirm when no pair is involved: the common case stays one
/// round trip, with no modal in front of it.
#[sqlx::test(migrations = "../migrations")]
async fn an_unpaired_bulk_needs_no_confirmation(pool: PgPool) -> anyhow::Result<()> {
    let (user_id, groceries, ids) = fixture(&pool, &["LECLERC", "SPOTIFY"]).await?;

    let outcome = bulk_apply(
        &pool,
        user_id,
        &ids,
        BulkChanges {
            category_id: Some(Some(groceries)),
            ..BulkChanges::default()
        },
        false,
    )
    .await?;

    assert_eq!(outcome.pending_pair_breaks, None);
    assert_eq!(outcome.updated, 2);
    Ok(())
}

/// Tags and the checked flag never break a pair, so they are never gated —
/// even on a row that is half of one.
#[sqlx::test(migrations = "../migrations")]
async fn a_bulk_without_a_category_is_never_gated(pool: PgPool) -> anyhow::Result<()> {
    let (user_id, _groceries, out, _inn) = paired_fixture(&pool).await?;

    let outcome = bulk_apply(
        &pool,
        user_id,
        &[out],
        BulkChanges {
            checked: Some(true),
            ..BulkChanges::default()
        },
        false,
    )
    .await?;

    assert_eq!(outcome.pending_pair_breaks, None);
    assert_eq!(outcome.updated, 1);
    Ok(())
}

#[sqlx::test(migrations = "../migrations")]
async fn counts_the_pairs_an_apply_to_description_would_break(pool: PgPool) -> anyhow::Result<()> {
    // Both rows share a description, and one of them is half of a pair — so
    // widening the correction to the description sweeps the pair up too.
    let (user_id, _groceries, ids) = fixture(&pool, &["VIREMENT", "VIREMENT"]).await?;
    sqlx::query("update transaction set transfer_pair_id = $2 where id = $1")
        .bind(ids[1])
        .bind(ids[0])
        .execute(&pool)
        .await?;

    assert_eq!(
        count_paired_same_description(&pool, user_id, ids[0]).await?,
        1
    );
    Ok(())
}

#[sqlx::test(migrations = "../migrations")]
async fn an_unpaired_description_counts_nothing(pool: PgPool) -> anyhow::Result<()> {
    let (user_id, _groceries, ids) = fixture(&pool, &["LECLERC", "LECLERC"]).await?;

    assert_eq!(
        count_paired_same_description(&pool, user_id, ids[0]).await?,
        0
    );
    Ok(())
}
