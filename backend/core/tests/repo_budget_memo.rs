mod common;

use common::{checking_account, seed_user_and_connection, txn};
use gripsou_core::budget::ai::Decision;
use gripsou_core::categorize::Merchant;
use gripsou_core::repo::account::upsert_account;
use gripsou_core::repo::budget::memo::{MerchantWrite, record_ai_merchants, set_user_merchant};
use gripsou_core::repo::transaction::upsert_transaction;
use rust_decimal::Decimal;
use sqlx::PgPool;
use uuid::Uuid;

async fn rows(pool: &PgPool, descs: &[&str]) -> anyhow::Result<(Uuid, Vec<Uuid>)> {
    let (user_id, conn_id) = seed_user_and_connection(pool).await;
    let mut conn = pool.acquire().await?;
    let acct = upsert_account(&mut conn, conn_id, &checking_account("a")).await?;
    let mut ids = vec![];
    for (i, d) in descs.iter().enumerate() {
        upsert_transaction(
            &mut conn,
            acct,
            &txn(
                "a",
                &format!("t{i}"),
                "withdrawal",
                Decimal::new(-100, 2),
                Some(d),
            ),
        )
        .await?;
        ids.push(
            sqlx::query_scalar("select id from transaction where external_id = $1")
                .bind(format!("t{i}"))
                .fetch_one(pool)
                .await?,
        );
    }
    Ok((user_id, ids))
}

fn decision(id: Uuid, name: &str, domain: &str) -> Decision {
    Decision {
        txn_id: id,
        category_id: None,
        confidence: None,
        merchant: Some(Merchant {
            name: Some(name.into()),
            domain: Some(domain.into()),
        }),
    }
}

async fn memo(pool: &PgPool, user: Uuid) -> Vec<(String, Option<String>, Option<String>, String)> {
    sqlx::query_as(
        "select norm_description, merchant_name, merchant_domain, origin from budget_memo where user_id = $1 order by 1",
    )
    .bind(user)
    .fetch_all(pool)
    .await
    .unwrap()
}

/// The AI never writes a name any more: `merchant_name` stays null even
/// though `record_ai_merchants` runs, and a stale name from before this
/// change is nulled out on the next AI write to the same description.
#[sqlx::test(migrations = "../migrations")]
async fn ai_merchants_never_carry_a_name(pool: PgPool) -> anyhow::Result<()> {
    let (user, ids) = rows(&pool, &["CB LECLERC 0412"]).await?;
    record_ai_merchants(
        &pool,
        user,
        &[decision(ids[0], "Leclerc", "https://www.leclerc.fr/")],
    )
    .await?;
    let m = memo(&pool, user).await;
    assert_eq!(m[0].1, None, "no name is ever written");

    // Simulate a stale name left over from before this change, then prove
    // the next AI write clears it.
    sqlx::query("update budget_memo set merchant_name = 'Leclerc' where user_id = $1")
        .bind(user)
        .execute(&pool)
        .await?;
    record_ai_merchants(
        &pool,
        user,
        &[decision(ids[0], "Leclerc", "https://www.leclerc.fr/")],
    )
    .await?;
    let m = memo(&pool, user).await;
    assert_eq!(m[0].1, None, "a later AI write nulls a stale name");
    Ok(())
}

#[sqlx::test(migrations = "../migrations")]
async fn an_ai_merchant_is_recorded_per_normalised_description(pool: PgPool) -> anyhow::Result<()> {
    let (user, ids) = rows(&pool, &["CB LECLERC 0412", "CB LECLERC 0999"]).await?;
    record_ai_merchants(
        &pool,
        user,
        &[decision(ids[0], "Leclerc", "https://www.leclerc.fr/")],
    )
    .await?;
    let m = memo(&pool, user).await;
    assert_eq!(m.len(), 1);
    assert_eq!(m[0].2.as_deref(), Some("leclerc.fr"));
    assert_eq!(m[0].3, "ai");
    Ok(())
}

#[sqlx::test(migrations = "../migrations")]
async fn an_ai_answer_never_overwrites_a_users_merchant(pool: PgPool) -> anyhow::Result<()> {
    let (user, ids) = rows(&pool, &["PAYPAL *XYZ"]).await?;
    assert_eq!(
        set_user_merchant(&pool, user, ids[0], Some("xyz.com")).await?,
        MerchantWrite::Saved
    );
    record_ai_merchants(&pool, user, &[decision(ids[0], "PayPal", "paypal.com")]).await?;
    let m = memo(&pool, user).await;
    assert_eq!(m[0].2.as_deref(), Some("xyz.com"));
    assert_eq!(m[0].3, "user");
    Ok(())
}

#[sqlx::test(migrations = "../migrations")]
async fn a_later_ai_answer_replaces_an_earlier_one(pool: PgPool) -> anyhow::Result<()> {
    let (user, ids) = rows(&pool, &["SNCF"]).await?;
    record_ai_merchants(&pool, user, &[decision(ids[0], "SNCF", "sncf.fr")]).await?;
    record_ai_merchants(
        &pool,
        user,
        &[decision(ids[0], "SNCF Connect", "sncf-connect.com")],
    )
    .await?;
    assert_eq!(
        memo(&pool, user).await[0].2.as_deref(),
        Some("sncf-connect.com")
    );
    Ok(())
}

#[sqlx::test(migrations = "../migrations")]
async fn no_domain_or_no_identity_records_nothing(pool: PgPool) -> anyhow::Result<()> {
    let (user, ids) = rows(&pool, &["12345", "LECLERC"]).await?;
    record_ai_merchants(
        &pool,
        user,
        &[
            decision(ids[0], "X", "x.fr"),
            decision(ids[1], "Leclerc", "Leclerc"),
        ],
    )
    .await?;
    assert!(
        memo(&pool, user).await.is_empty(),
        "digit-only description, and an invalid domain"
    );
    assert_eq!(
        set_user_merchant(&pool, user, ids[0], Some("x.fr")).await?,
        MerchantWrite::NoIdentity
    );
    Ok(())
}

#[sqlx::test(migrations = "../migrations")]
async fn clearing_both_fields_deletes_the_entry(pool: PgPool) -> anyhow::Result<()> {
    let (user, ids) = rows(&pool, &["LECLERC"]).await?;
    set_user_merchant(&pool, user, ids[0], Some("leclerc.fr")).await?;
    assert_eq!(
        set_user_merchant(&pool, user, ids[0], None).await?,
        MerchantWrite::Cleared
    );
    assert!(memo(&pool, user).await.is_empty());
    Ok(())
}

#[sqlx::test(migrations = "../migrations")]
async fn another_users_row_is_not_found(pool: PgPool) -> anyhow::Result<()> {
    let (_, ids) = rows(&pool, &["LECLERC"]).await?;
    let (stranger, _) = seed_user_and_connection(&pool).await;
    assert_eq!(
        set_user_merchant(&pool, stranger, ids[0], Some("x.fr")).await?,
        MerchantWrite::NotFound
    );
    Ok(())
}
