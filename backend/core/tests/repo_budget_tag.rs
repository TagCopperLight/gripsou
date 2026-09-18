mod common;

use common::seed_user_and_connection;
use gripsou_core::repo::budget::tag::{create_tag, delete_tag, list_tags, update_tag};
use sqlx::PgPool;

#[sqlx::test(migrations = "../migrations")]
async fn creates_lists_renames_and_deletes(pool: PgPool) -> anyhow::Result<()> {
    let (user_id, _conn) = seed_user_and_connection(&pool).await;
    assert!(
        list_tags(&pool, user_id).await?.is_empty(),
        "nothing is seeded"
    );

    let holiday = create_tag(&pool, user_id, "Holiday", Some("#5b9bf0")).await?;
    let work = create_tag(&pool, user_id, "Work", None).await?;
    assert_eq!(work.color, None);

    let names: Vec<String> = list_tags(&pool, user_id)
        .await?
        .into_iter()
        .map(|t| t.name)
        .collect();
    assert_eq!(names, vec!["Holiday", "Work"], "alphabetical");

    let renamed = update_tag(&pool, user_id, holiday.id, "Vacances", Some("#4dd0b1"))
        .await?
        .expect("owned");
    assert_eq!(renamed.name, "Vacances");
    assert_eq!(renamed.color.as_deref(), Some("#4dd0b1"));

    assert!(delete_tag(&pool, user_id, work.id).await?);
    assert_eq!(list_tags(&pool, user_id).await?.len(), 1);
    Ok(())
}

#[sqlx::test(migrations = "../migrations")]
async fn tags_are_scoped_to_their_owner(pool: PgPool) -> anyhow::Result<()> {
    let (owner, _c1) = seed_user_and_connection(&pool).await;
    let (stranger, _c2) = seed_user_and_connection(&pool).await;
    let mine = create_tag(&pool, owner, "Holiday", None).await?;

    assert!(
        update_tag(&pool, stranger, mine.id, "Stolen", None)
            .await?
            .is_none()
    );
    assert!(!delete_tag(&pool, stranger, mine.id).await?);
    assert!(list_tags(&pool, stranger).await?.is_empty());
    // Both users may hold a tag of the same name.
    create_tag(&pool, stranger, "Holiday", None).await?;
    Ok(())
}

#[sqlx::test(migrations = "../migrations")]
async fn a_duplicate_name_is_an_error(pool: PgPool) -> anyhow::Result<()> {
    let (user_id, _conn) = seed_user_and_connection(&pool).await;
    create_tag(&pool, user_id, "Holiday", None).await?;
    assert!(create_tag(&pool, user_id, "Holiday", None).await.is_err());
    Ok(())
}
