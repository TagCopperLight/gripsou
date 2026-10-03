mod common;

use sqlx::PgPool;
use uuid::Uuid;

async fn insert_user(pool: &PgPool) -> Uuid {
    let id = Uuid::new_v4();
    sqlx::query("insert into users (id, email, name, password_hash) values ($1, $2, 'Test', 'x')")
        .bind(id)
        .bind(format!("u-{id}@test.local"))
        .execute(pool)
        .await
        .unwrap();
    id
}

/// Inserting a user must seed their category set — via the trigger, not via
/// application code, so every creation path is covered including this one.
#[sqlx::test(migrations = "../migrations")]
async fn a_new_user_gets_seeded_categories(pool: PgPool) -> anyhow::Result<()> {
    let user_id = insert_user(&pool).await;

    let total: i64 = sqlx::query_scalar("select count(*) from budget_category where user_id = $1")
        .bind(user_id)
        .fetch_one(&pool)
        .await?;
    assert_eq!(
        total, 32,
        "seeded taxonomy is 23 expense + 5 income + 4 neutral"
    );

    let per_kind: Vec<(String, i64)> = sqlx::query_as(
        "select kind, count(*) from budget_category where user_id = $1 group by kind order by 1",
    )
    .bind(user_id)
    .fetch_all(&pool)
    .await?;
    assert_eq!(
        per_kind,
        vec![
            ("expense".to_string(), 23),
            ("income".to_string(), 5),
            ("neutral".to_string(), 4),
        ]
    );

    // Numbering is dense within a kind: 1..n, no gaps, no duplicates.
    let gaps: i64 = sqlx::query_scalar(
        "select count(*) from (
             select kind, sort_order,
                    row_number() over (partition by kind order by sort_order) as ord
               from budget_category where user_id = $1
         ) t where t.sort_order <> t.ord",
    )
    .bind(user_id)
    .fetch_one(&pool)
    .await?;
    assert_eq!(gaps, 0, "sort_order is 1..n within each kind");

    // Nothing ships archived: the taxonomy arrives fully in play.
    let archived: i64 = sqlx::query_scalar(
        "select count(*) from budget_category where user_id = $1 and archived_at is not null",
    )
    .bind(user_id)
    .fetch_one(&pool)
    .await?;
    assert_eq!(archived, 0);

    let kinds: Vec<String> = sqlx::query_scalar(
        "select distinct kind from budget_category where user_id = $1 order by 1",
    )
    .bind(user_id)
    .fetch_all(&pool)
    .await?;
    assert_eq!(kinds, vec!["expense", "income", "neutral"]);

    // Every seeded row carries a stable key so the frontend can translate it.
    let without_key: i64 = sqlx::query_scalar(
        "select count(*) from budget_category where user_id = $1 and default_key is null",
    )
    .bind(user_id)
    .fetch_one(&pool)
    .await?;
    assert_eq!(without_key, 0);

    Ok(())
}

/// Exactly one system row, and it is the one the pairing pass writes to.
#[sqlx::test(migrations = "../migrations")]
async fn internal_transfer_is_the_only_system_category(pool: PgPool) -> anyhow::Result<()> {
    let user_id = insert_user(&pool).await;

    let systems: Vec<(String, String)> = sqlx::query_as(
        "select system_key, kind from budget_category \
         where user_id = $1 and system_key is not null",
    )
    .bind(user_id)
    .fetch_all(&pool)
    .await?;
    assert_eq!(
        systems,
        vec![("internal_transfer".to_string(), "neutral".to_string())]
    );

    Ok(())
}

/// Two users own two independent taxonomies; names collide across users.
#[sqlx::test(migrations = "../migrations")]
async fn categories_are_per_user(pool: PgPool) -> anyhow::Result<()> {
    let a = insert_user(&pool).await;
    let b = insert_user(&pool).await;

    let shared: i64 = sqlx::query_scalar(
        "select count(*) from budget_category c1 join budget_category c2 \
         on c1.name = c2.name where c1.user_id = $1 and c2.user_id = $2",
    )
    .bind(a)
    .bind(b)
    .fetch_one(&pool)
    .await?;
    assert_eq!(shared, 32, "same names, different rows");

    Ok(())
}

/// Deleting a user must still work even though they own system categories —
/// the protection lives in the repository, not in a delete trigger.
#[sqlx::test(migrations = "../migrations")]
async fn deleting_a_user_cascades_through_categories(pool: PgPool) -> anyhow::Result<()> {
    let user_id = insert_user(&pool).await;
    sqlx::query("delete from users where id = $1")
        .bind(user_id)
        .execute(&pool)
        .await?;

    let left: i64 = sqlx::query_scalar("select count(*) from budget_category where user_id = $1")
        .bind(user_id)
        .fetch_one(&pool)
        .await?;
    assert_eq!(left, 0);

    Ok(())
}

/// The normalisation the "apply to all" prompt keys on: dates and digit
/// runs removed. A card mask is the adapter's to strip; one left in the
/// wording keeps its letters but loses its digits, so the card number never
/// splits a merchant in two.
#[sqlx::test(migrations = "../migrations")]
async fn norm_description_strips_dates_and_digits(pool: PgPool) -> anyhow::Result<()> {
    let cases = [
        (
            "CARTE 12/03/26 CB*4242 LECLERC PARIS",
            "carte cb* leclerc paris",
        ),
        ("VIR SEPA SALAIRE 202603", "vir sepa salaire"),
        ("  Spotify   AB  ", "spotify ab"),
    ];
    for (input, expected) in cases {
        let got: String = sqlx::query_scalar("select budget_norm_description($1)")
            .bind(input)
            .fetch_one(&pool)
            .await?;
        assert_eq!(got, expected, "input: {input}");
    }
    Ok(())
}

/// 0033 on an existing user: former internal/excluded rows are neutral,
/// numbered 1..n with the former internal ones first, and keep their
/// transactions.
#[sqlx::test(migrations = "../migrations")]
async fn neutral_ordering_puts_ignore_last(pool: PgPool) -> anyhow::Result<()> {
    let user_id = insert_user(&pool).await;
    let neutral: Vec<(String, i32)> = sqlx::query_as(
        "select default_key, sort_order from budget_category \
         where user_id = $1 and kind = 'neutral' order by sort_order",
    )
    .bind(user_id)
    .fetch_all(&pool)
    .await?;
    assert_eq!(
        neutral,
        vec![
            ("internal".to_string(), 1),
            ("savings".to_string(), 2),
            ("investments".to_string(), 3),
            ("ignore".to_string(), 4),
        ]
    );
    Ok(())
}
