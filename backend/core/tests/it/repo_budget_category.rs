use gripsou_core::budget::vocab::CategoryKind;
use gripsou_core::repo::account::upsert_account;
use gripsou_core::repo::budget::ai;
use gripsou_core::repo::budget::category::{
    CategoryPatch, DeleteCategory, NewCategory, category_refs, create_category, delete_category,
    list_categories, reorder_categories, update_category,
};
use gripsou_core::repo::transaction::upsert_transaction;
use gripsou_core::testkit::{checking_account, seed_user_and_connection, txn};
use rust_decimal::Decimal;
use sqlx::PgPool;
use uuid::Uuid;

#[gripsou_core::testkit::db_test]
async fn lists_seeded_categories_grouped_by_kind(pool: PgPool) -> anyhow::Result<()> {
    let (user_id, _conn) = seed_user_and_connection(&pool).await;

    let rows = list_categories(&pool, user_id).await?;
    assert_eq!(rows.len(), 32);
    // expense first, then income, then neutral — the order the settings
    // table renders in.
    let kinds: Vec<&str> = rows.iter().map(|r| r.kind.as_str()).collect();
    assert_eq!(kinds[0], "expense");
    assert_eq!(kinds[31], "neutral");
    assert!(rows.iter().all(|r| r.tx_count == 0));
    Ok(())
}

#[gripsou_core::testkit::db_test]
async fn counts_transactions_per_category(pool: PgPool) -> anyhow::Result<()> {
    let (user_id, conn_id) = seed_user_and_connection(&pool).await;
    let mut conn = pool.acquire().await?;
    let account_id = upsert_account(&mut conn, conn_id, &checking_account("acct-1")).await?;
    upsert_transaction(
        &mut conn,
        account_id,
        &txn("acct-1", "t1", "withdrawal", Decimal::new(-1200, 2)).described("LECLERC"),
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

#[gripsou_core::testkit::db_test]
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
            kind: CategoryKind::Expense,
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
            name: "Cat supplies",
            color: "#4dd0b1",
            icon: Some("cat"),
            hint: None,
            kind: CategoryKind::Expense,
            archived: true,
        },
    )
    .await?
    .expect("owned by this user");
    assert_eq!(patched.name, "Cat supplies");
    assert!(patched.archived);
    assert!(patched.hint.is_none());

    Ok(())
}

/// Renaming a seeded category drops its translation key: from then on the
/// user's own wording is shown verbatim in every language.
#[gripsou_core::testkit::db_test]
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
            kind: CategoryKind::Expense,
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
            kind: CategoryKind::Expense,
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
#[gripsou_core::testkit::db_test]
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
            kind: CategoryKind::Expense,
            archived: true,
        },
    )
    .await?
    .unwrap();
    assert_eq!(renamed.name, "Virement interne");
    assert_eq!(
        renamed.kind,
        CategoryKind::Neutral,
        "kind is locked on a system row"
    );
    assert!(!renamed.archived, "a system row cannot be archived either");

    assert_eq!(
        delete_category(&pool, user_id, system.id).await?,
        DeleteCategory::System
    );
    assert_eq!(list_categories(&pool, user_id).await?.len(), 32);
    Ok(())
}

/// Deleting returns the transactions to uncategorised rather than deleting
/// them, and to nobody's choice: the AI has them to look at again.
#[gripsou_core::testkit::db_test]
async fn deleting_a_category_leaves_its_transactions(pool: PgPool) -> anyhow::Result<()> {
    let (user_id, conn_id) = seed_user_and_connection(&pool).await;
    let mut conn = pool.acquire().await?;
    let account_id = upsert_account(&mut conn, conn_id, &checking_account("acct-1")).await?;
    for (ext, description) in [("t1", "LECLERC"), ("t2", "LIDL")] {
        upsert_transaction(
            &mut conn,
            account_id,
            &txn("acct-1", ext, "withdrawal", Decimal::new(-1200, 2)).described(description),
        )
        .await?;
    }
    let created = create_category(
        &pool,
        user_id,
        &NewCategory {
            name: "Cat food",
            color: "#5b9bf0",
            icon: None,
            hint: None,
            kind: CategoryKind::Expense,
        },
    )
    .await?;
    sqlx::query(
        "update transaction set budget_category_id = $1, category_source = 'user', \
         category_reviewed_at = now() where external_id = 't1'",
    )
    .bind(created.id)
    .execute(&pool)
    .await?;
    sqlx::query(
        "update transaction set budget_category_id = $1, category_source = 'ai', \
         category_confidence = 0.9, category_reviewed_at = now() where external_id = 't2'",
    )
    .bind(created.id)
    .execute(&pool)
    .await?;
    assert_eq!(ai::remaining(&pool, user_id).await?, 0);

    assert_eq!(
        delete_category(&pool, user_id, created.id).await?,
        DeleteCategory::Deleted
    );

    let (left, settled): (i64, i64) = sqlx::query_as(
        "select count(*), count(*) filter (where budget_category_id is not null \
         or category_source is not null or category_confidence is not null \
         or category_reviewed_at is not null) from transaction",
    )
    .fetch_one(&pool)
    .await?;
    assert_eq!(left, 2, "the transactions survive");
    assert_eq!(settled, 0, "uncategorised and nobody's choice");
    assert_eq!(ai::remaining(&pool, user_id).await?, 2);
    Ok(())
}

/// Another user's category is invisible and untouchable.
#[gripsou_core::testkit::db_test]
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
            kind: CategoryKind::Expense,
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
                kind: CategoryKind::Expense,
                archived: false
            },
        )
        .await?
        .is_none()
    );
    assert_eq!(
        delete_category(&pool, stranger, mine.id).await?,
        DeleteCategory::NotFound
    );
    let uuid_nowhere = Uuid::new_v4();
    assert_eq!(
        delete_category(&pool, owner, uuid_nowhere).await?,
        DeleteCategory::NotFound
    );
    Ok(())
}

/// The ids come in the order the user dragged them to; each kind is numbered
/// `1..n` in that order, and another user's id is skipped so the caller can
/// refuse the partial write.
#[gripsou_core::testkit::db_test]
async fn reordering_numbers_each_kind_in_the_order_given(pool: PgPool) -> anyhow::Result<()> {
    let (user_id, _conn) = seed_user_and_connection(&pool).await;
    let rows = list_categories(&pool, user_id).await?;
    let expenses: Vec<Uuid> = rows
        .iter()
        .filter(|r| r.kind == CategoryKind::Expense)
        .map(|r| r.id)
        .collect();
    let incomes: Vec<Uuid> = rows
        .iter()
        .filter(|r| r.kind == CategoryKind::Income)
        .map(|r| r.id)
        .collect();

    // Last expense first, kinds interleaved.
    let mut order = vec![*expenses.last().unwrap(), incomes[1], incomes[0]];
    order.extend(&expenses[..expenses.len() - 1]);
    assert!(reorder_categories(&pool, user_id, &order).await?);

    let after = list_categories(&pool, user_id).await?;
    assert_eq!(after[0].id, *expenses.last().unwrap(), "moved to the top");
    let income_order: Vec<Uuid> = after
        .iter()
        .filter(|r| r.kind == CategoryKind::Income)
        .map(|r| r.id)
        .take(2)
        .collect();
    assert_eq!(income_order, vec![incomes[1], incomes[0]]);

    // A list naming a row that is not the user's is refused whole: their own
    // rows keep the order they had.
    let (stranger, _c) = seed_user_and_connection(&pool).await;
    let theirs = list_categories(&pool, stranger).await?[0].id;
    let before = list_categories(&pool, user_id).await?;
    let reversed: Vec<Uuid> = before.iter().rev().map(|r| r.id).chain([theirs]).collect();
    assert!(!reorder_categories(&pool, user_id, &reversed).await?);
    let ids = |rows: &[gripsou_core::repo::budget::category::BudgetCategoryRow]| {
        rows.iter().map(|r| r.id).collect::<Vec<_>>()
    };
    assert_eq!(
        ids(&list_categories(&pool, user_id).await?),
        ids(&before),
        "nothing was written"
    );
    assert_eq!(
        list_categories(&pool, stranger).await?[0].id,
        theirs,
        "the stranger's row is not touched"
    );
    Ok(())
}

/// Created together, two categories still get distinct positions.
#[gripsou_core::testkit::db_test]
async fn concurrent_creates_get_distinct_positions(pool: PgPool) -> anyhow::Result<()> {
    let (user_id, _conn) = seed_user_and_connection(&pool).await;
    let mut set = tokio::task::JoinSet::new();
    for i in 0..6 {
        let pool = pool.clone();
        set.spawn(async move {
            create_category(
                &pool,
                user_id,
                &NewCategory {
                    name: &format!("New {i}"),
                    color: "#000000",
                    icon: None,
                    hint: None,
                    kind: CategoryKind::Expense,
                },
            )
            .await
        });
    }
    while let Some(r) = set.join_next().await {
        r??;
    }
    let positions: Vec<i32> = sqlx::query_scalar(
        "select sort_order from budget_category where user_id = $1 and kind = 'expense'",
    )
    .bind(user_id)
    .fetch_all(&pool)
    .await?;
    let mut distinct = positions.clone();
    distinct.sort();
    distinct.dedup();
    assert_eq!(distinct.len(), positions.len());
    Ok(())
}

#[gripsou_core::testkit::db_test]
async fn chip_refs_cover_every_category(pool: PgPool) -> anyhow::Result<()> {
    let (user_id, _conn) = seed_user_and_connection(&pool).await;
    let (stranger, _c) = seed_user_and_connection(&pool).await;
    let mut listed: Vec<Uuid> = list_categories(&pool, user_id)
        .await?
        .into_iter()
        .map(|r| r.id)
        .collect();
    let mut refs: Vec<Uuid> = category_refs(&pool, user_id)
        .await?
        .into_iter()
        .map(|r| r.id)
        .collect();
    listed.sort();
    refs.sort();
    assert_eq!(refs, listed);
    assert!(
        !category_refs(&pool, stranger)
            .await?
            .iter()
            .any(|r| refs.contains(&r.id))
    );
    Ok(())
}
