mod common;

use std::collections::BTreeMap;

use common::seed_user_and_connection;
use gripsou_core::budget::ai_cost::usage_report;
use gripsou_core::repo::budget::ai::{RunRecord, insert_run, usage_by_model};
use gripsou_core::repo::settings::{ModelPrice, budget_ai_prices, set_budget_ai_prices};
use rust_decimal::Decimal;
use sqlx::PgPool;
use std::str::FromStr;

fn run(model: &str, tokens_in: Option<i32>, tokens_out: Option<i32>) -> RunRecord {
    RunRecord {
        model: model.into(),
        batches: 1,
        items: 1,
        tokens_in,
        tokens_out,
        outcome: "ok".into(),
        error: None,
    }
}

fn d(s: &str) -> Decimal {
    Decimal::from_str(s).unwrap()
}

#[sqlx::test(migrations = "../migrations")]
async fn prices_round_trip_and_default_to_empty(pool: PgPool) -> anyhow::Result<()> {
    assert!(budget_ai_prices(&pool).await?.is_empty());

    let prices = BTreeMap::from([(
        "jev:jev-latest".to_string(),
        ModelPrice {
            input: d("0.042"),
            output: d("0"),
        },
    )]);
    set_budget_ai_prices(&pool, &prices).await?;
    assert_eq!(budget_ai_prices(&pool).await?, prices);

    // Stored as decimal strings, never JSON numbers.
    let raw: serde_json::Value =
        sqlx::query_scalar("select budget_ai_prices from app_settings where id = 1")
            .fetch_one(&pool)
            .await?;
    assert_eq!(
        raw,
        serde_json::json!({"jev:jev-latest": {"in": "0.042", "out": "0"}})
    );

    set_budget_ai_prices(&pool, &BTreeMap::new()).await?;
    assert!(budget_ai_prices(&pool).await?.is_empty());
    Ok(())
}

#[sqlx::test(migrations = "../migrations")]
async fn usage_sums_every_user_per_model(pool: PgPool) -> anyhow::Result<()> {
    let (alice, _) = seed_user_and_connection(&pool).await;
    let (bob, _) = seed_user_and_connection(&pool).await;
    insert_run(
        &pool,
        alice,
        &run("jev:jev-latest", Some(2_000_000_000), Some(10)),
    )
    .await?;
    insert_run(
        &pool,
        bob,
        &run("jev:jev-latest", Some(2_000_000_000), Some(20)),
    )
    .await?;
    insert_run(&pool, bob, &run("jev:jev-latest", None, Some(5))).await?;
    insert_run(&pool, alice, &run("gemini:flash", Some(1), None)).await?;

    let rows = usage_by_model(&pool).await?;
    assert_eq!(rows.len(), 2);
    assert_eq!(rows[0].model, "gemini:flash");
    assert_eq!(rows[0].runs, 1);
    assert_eq!(rows[0].runs_without_usage, 1);
    assert_eq!(rows[0].tokens_in, 1);
    assert_eq!(rows[0].tokens_out, 0);
    assert_eq!(rows[1].model, "jev:jev-latest");
    assert_eq!(rows[1].runs, 3);
    assert_eq!(rows[1].runs_without_usage, 1);
    assert_eq!(rows[1].tokens_in, 4_000_000_000, "sums past i32::MAX");
    assert_eq!(rows[1].tokens_out, 35);
    Ok(())
}

#[sqlx::test(migrations = "../migrations")]
async fn report_prices_known_models_only(pool: PgPool) -> anyhow::Result<()> {
    let (user, _) = seed_user_and_connection(&pool).await;
    insert_run(
        &pool,
        user,
        &run("jev:jev-latest", Some(9_000_000), Some(4_000_000)),
    )
    .await?;
    insert_run(
        &pool,
        user,
        &run("jev:jev-latest", Some(495_459), Some(484_808)),
    )
    .await?;
    insert_run(&pool, user, &run("jev:jev-latest", None, None)).await?;
    insert_run(
        &pool,
        user,
        &run("gemini:flash", Some(1_000_000), Some(1_000_000)),
    )
    .await?;
    set_budget_ai_prices(
        &pool,
        &BTreeMap::from([
            (
                "jev:jev-latest".to_string(),
                ModelPrice {
                    input: d("0.042"),
                    output: d("0.1"),
                },
            ),
            (
                "unused:model".to_string(),
                ModelPrice {
                    input: d("1"),
                    output: d("1"),
                },
            ),
        ]),
    )
    .await?;

    let report = usage_report(&pool).await?;

    assert_eq!(
        report.models.len(),
        2,
        "priced-but-unused models are omitted"
    );
    let gemini = &report.models[0];
    assert_eq!(gemini.model, "gemini:flash");
    assert_eq!(gemini.price, None);
    assert_eq!(gemini.cost, None);
    let jev = &report.models[1];
    assert_eq!(jev.runs, 3);
    assert_eq!(jev.runs_without_usage, 1);
    assert_eq!(jev.tokens_in, 9_495_459);
    assert_eq!(jev.tokens_out, 4_484_808);
    // 9.495459 * 0.042 + 4.484808 * 0.1 = 0.398809278 + 0.4484808 = 0.847290078
    assert_eq!(jev.cost, Some(d("0.847290078")));
    assert_eq!(report.total_cost, d("0.847290078"));
    Ok(())
}
