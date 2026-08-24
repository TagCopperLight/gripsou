//! One-off repair: re-request every instrument's full price history from the
//! provider, for every connection.
//!
//! The routine sync only heals the last `REFETCH_DAYS` days, so this exists for
//! gaps older than that — the ones an instance accumulated back when it resumed
//! fetching from `max(ts)` and could never ask for a dropped bar again.
//!
//! Repairs in place: every point is upserted and nothing is deleted first, so
//! it is safe to interrupt and safe to re-run. Manual by design, and slow —
//! one full-history response per instrument.
//!
//!     DATABASE_URL=postgres://... cargo run -p gripsou-jobs --example pricefix
use gripsou_core::price_sync::refresh_all_prices_for_connection;
use gripsou_providers::yahoo::YahooPriceProvider;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let url = std::env::var("DATABASE_URL")?;
    let pool = sqlx::PgPool::connect(&url).await?;
    let pivot: String = sqlx::query_scalar("select base_currency from app_settings where id = 1")
        .fetch_one(&pool)
        .await?;
    let providers: Vec<Box<dyn gripsou_core::provider::PriceProvider>> =
        vec![Box::new(YahooPriceProvider::new(pivot)?)];
    let ids: Vec<uuid::Uuid> = sqlx::query_scalar("select id from connection")
        .fetch_all(&pool)
        .await?;

    let mut total = 0usize;
    for id in ids {
        let s = refresh_all_prices_for_connection(&pool, id, &providers).await?;
        println!("{id}: {s:?}");
        total += s.prices_inserted;
    }
    println!("{total} price rows written");
    Ok(())
}
