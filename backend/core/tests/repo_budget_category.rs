mod common;

use common::{checking_account, seed_user_and_connection, txn};
use gripsou_core::repo::account::upsert_account;
use gripsou_core::repo::budget::category::{
    CategoryPatch, NewCategory, create_category, delete_category, list_categories, update_category,
};
use gripsou_core::repo::transaction::upsert_transaction;
use rust_decimal::Decimal;
use sqlx::PgPool;
use uuid::Uuid;

#[sqlx::test(migrations = "../migrations")]
async fn lists_seeded_categories_grouped_by_kind(pool: PgPool) -> anyhow::Result<()> {
    let (user_id, _conn) = seed_user_and_connection(&pool).await;

    let rows = list_categories(&pool, user_id).await?;
    assert_eq!(rows.len(), 25);
    // expense first, then income, internal, excluded — the order the settings
    // table renders in.
    let kinds: Vec<&str> = rows.iter().map(|r| r.kind.as_str()).collect();
    assert_eq!(kinds[0], "expense");
    assert_eq!(kinds[24], "excluded");
    assert!(rows.iter().all(|r| r.tx_count == 0));
    Ok(())
}

#[sqlx::test(migrations = "../migrations")]
async fn counts_transactions_per_category(pool: PgPool) -> anyhow::Result<()> {
    let (user_id, conn_id) = seed_user_and_connection(&pool).await;
    let mut conn = pool.acquire().await?;
    let account_id = upsert_account(&mut conn, conn_id, &checking_account("acct-1")).await?;
    upsert_transaction(
        &mut conn,
        account_id,
        &txn(
            "acct-1",
            "t1",
            "withdrawal",
            Decimal::new(-1200, 2),
            Some("LECLERC"),
        ),
    )
    .await?;

    let groceries = list_categories(&pool, user_id)
        .await?
        .into_iter()
        .find(|c| c.default_key.as_deref() == Some("groceries"))
        .expect("seeded");
    sqlx::query("update transaction set budget_category_id = $1")
        .bind(groceries.id)
        .execute(&pool)
        .await?;

    let after = list_categories(&pool, user_id).await?;
    let counted = after.iter().find(|c| c.id == groceries.id).unwrap();
    assert_eq!(counted.tx_count, 1);
    Ok(())
}

#[sqlx::test(migrations = "../migrations")]
async fn creates_updates_and_archives(pool: PgPool) -> anyhow::Result<()> {
    let (user_id, _conn) = seed_user_and_connection(&pool).await;

    let created = create_category(
        &pool,
        user_id,
        &NewCategory {
            name: "Cat food",
            color: "#5b9bf0",
            icon: Some("cat"),
            hint: Some("kibble"),
            kind: "expense",
        },
    )
    .await?;
    assert_eq!(created.name, "Cat food");
    assert!(
        created.default_key.is_none(),
        "user categories carry no translation key"
    );
    assert!(!created.archived);

    let patched = update_category(
        &pool,
        user_id,
        created.id,
        &CategoryPatch {
            name: "Pets",
            color: "#4dd0b1",
            icon: Some("cat"),
            hint: None,
            kind: "expense",
            archived: true,
        },
    )
    .await?
    .expect("owned by this user");
    assert_eq!(patched.name, "Pets");
    assert!(patched.archived);
    assert!(patched.hint.is_none());

    Ok(())
}

/// Renaming a seeded category drops its translation key: from then on the
/// user's own wording is shown verbatim in every language.
#[sqlx::test(migrations = "../migrations")]
async fn renaming_a_seeded_category_clears_its_default_key(pool: PgPool) -> anyhow::Result<()> {
    let (user_id, _conn) = seed_user_and_connection(&pool).await;
    let groceries = list_categories(&pool, user_id)
        .await?
        .into_iter()
        .find(|c| c.default_key.as_deref() == Some("groceries"))
        .unwrap();

    // A patch that does not touch the name keeps the key.
    let recoloured = update_category(
        &pool,
        user_id,
        groceries.id,
        &CategoryPatch {
            name: "Groceries",
            color: "#f0b952",
            icon: groceries.icon.as_deref(),
            hint: None,
            kind: "expense",
            archived: false,
        },
    )
    .await?
    .unwrap();
    assert_eq!(recoloured.default_key.as_deref(), Some("groceries"));

    let renamed = update_category(
        &pool,
        user_id,
        groceries.id,
        &CategoryPatch {
            name: "Courses",
            color: "#f0b952",
            icon: groceries.icon.as_deref(),
            hint: None,
            kind: "expense",
            archived: false,
        },
    )
    .await?
    .unwrap();
    assert!(renamed.default_key.is_none());
    Ok(())
}

/// The pairing pass writes to the system row, so it cannot be deleted and its
/// kind cannot move. Everything else about it is editable.
#[sqlx::test(migrations = "../migrations")]
async fn the_system_category_is_renamable_but_not_deletable(pool: PgPool) -> anyhow::Result<()> {
    let (user_id, _conn) = seed_user_and_connection(&pool).await;
    let system = list_categories(&pool, user_id)
        .await?
        .into_iter()
        .find(|c| c.system_key.as_deref() == Some("internal_transfer"))
        .unwrap();

    let renamed = update_category(
        &pool,
        user_id,
        system.id,
        &CategoryPatch {
            name: "Virement interne",
            color: "#5b9bf0",
            icon: Some("arrow-left-right"),
            hint: None,
            kind: "expense",
            archived: true,
        },
    )
    .await?
    .unwrap();
    assert_eq!(renamed.name, "Virement interne");
    assert_eq!(renamed.kind, "internal", "kind is locked on a system row");
    assert!(!renamed.archived, "a system row cannot be archived either");

    assert!(!delete_category(&pool, user_id, system.id).await?);
    assert_eq!(list_categories(&pool, user_id).await?.len(), 25);
    Ok(())
}

/// Deleting returns the transactions to uncategorised rather than deleting them.
#[sqlx::test(migrations = "../migrations")]
async fn deleting_a_category_leaves_its_transactions(pool: PgPool) -> anyhow::Result<()> {
    let (user_id, conn_id) = seed_user_and_connection(&pool).await;
    let mut conn = pool.acquire().await?;
    let account_id = upsert_account(&mut conn, conn_id, &checking_account("acct-1")).await?;
    upsert_transaction(
        &mut conn,
        account_id,
        &txn(
            "acct-1",
            "t1",
            "withdrawal",
            Decimal::new(-1200, 2),
            Some("LECLERC"),
        ),
    )
    .await?;
    let created = create_category(
        &pool,
        user_id,
        &NewCategory {
            name: "Cat food",
            color: "#5b9bf0",
            icon: None,
            hint: None,
            kind: "expense",
        },
    )
    .await?;
    sqlx::query("update transaction set budget_category_id = $1, category_source = 'user'")
        .bind(created.id)
        .execute(&pool)
        .await?;

    assert!(delete_category(&pool, user_id, created.id).await?);

    let (left, categorised): (i64, i64) =
        sqlx::query_as("select count(*), count(budget_category_id) from transaction")
            .fetch_one(&pool)
            .await?;
    assert_eq!(left, 1, "the transaction survives");
    assert_eq!(categorised, 0, "it is uncategorised again");
    Ok(())
}

/// Another user's category is invisible and untouchable.
#[sqlx::test(migrations = "../migrations")]
async fn categories_are_scoped_to_their_owner(pool: PgPool) -> anyhow::Result<()> {
    let (owner, _c1) = seed_user_and_connection(&pool).await;
    let (stranger, _c2) = seed_user_and_connection(&pool).await;
    let mine = create_category(
        &pool,
        owner,
        &NewCategory {
            name: "Cat food",
            color: "#5b9bf0",
            icon: None,
            hint: None,
            kind: "expense",
        },
    )
    .await?;

    assert!(
        update_category(
            &pool,
            stranger,
            mine.id,
            &CategoryPatch {
                name: "Stolen",
                color: "#000000",
                icon: None,
                hint: None,
                kind: "expense",
                archived: false
            },
        )
        .await?
        .is_none()
    );
    assert!(!delete_category(&pool, stranger, mine.id).await?);
    let uuid_nowhere = Uuid::new_v4();
    assert!(!delete_category(&pool, owner, uuid_nowhere).await?);
    Ok(())
}
