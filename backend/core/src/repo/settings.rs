//! The instance's settings, set by the admin: the one `app_settings` row.
//! Provider keys live in the same row but are encrypted, so they have their
//! own module (`repo::provider_config`).

use crate::error::CoreError;

/// The pivot currency FX rates are stored against. Never displayed; the Yahoo
/// provider needs it to build `{currency}{pivot}=X` symbols.
pub async fn base_currency(pool: &sqlx::PgPool) -> Result<String, CoreError> {
    let row = sqlx::query!(
        r#"
        select base_currency as "base_currency!"
        from app_settings
        where id = 1
        "#,
    )
    .fetch_one(pool)
    .await?;
    Ok(row.base_currency)
}

/// The server-wide AI choice. `provider: None` means the AI is off for the
/// instance. The API key is saved in `provider_config`, never here.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct BudgetAiSettings {
    pub provider: Option<String>,
    pub model: Option<String>,
}

pub async fn budget_ai(pool: &sqlx::PgPool) -> Result<BudgetAiSettings, CoreError> {
    let row =
        sqlx::query!("select budget_ai_provider, budget_ai_model from app_settings where id = 1")
            .fetch_one(pool)
            .await?;
    Ok(BudgetAiSettings {
        provider: row.budget_ai_provider,
        model: row.budget_ai_model,
    })
}

pub async fn set_budget_ai(
    pool: &sqlx::PgPool,
    provider: Option<&str>,
    model: Option<&str>,
) -> Result<(), CoreError> {
    sqlx::query!(
        "update app_settings set budget_ai_provider = $1, budget_ai_model = $2 where id = 1",
        provider,
        model,
    )
    .execute(pool)
    .await?;
    Ok(())
}

/// An admin-entered AI price, USD per million tokens. Stored in
/// `app_settings.budget_ai_prices` as decimal strings under `in` / `out`.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct ModelPrice {
    #[serde(rename = "in", with = "rust_decimal::serde::str")]
    pub input: rust_decimal::Decimal,
    #[serde(rename = "out", with = "rust_decimal::serde::str")]
    pub output: rust_decimal::Decimal,
}

/// Prices keyed by the run log's model key (`<provider>:<model>`).
pub type ModelPrices = std::collections::BTreeMap<String, ModelPrice>;

pub async fn budget_ai_prices(pool: &sqlx::PgPool) -> Result<ModelPrices, CoreError> {
    let row = sqlx::query!(
        r#"select budget_ai_prices as "prices: sqlx::types::Json<ModelPrices>" from app_settings where id = 1"#
    )
    .fetch_one(pool)
    .await?;
    Ok(row.prices.0)
}

/// Replaces the whole price map.
pub async fn set_budget_ai_prices(
    pool: &sqlx::PgPool,
    prices: &ModelPrices,
) -> Result<(), CoreError> {
    sqlx::query!(
        "update app_settings set budget_ai_prices = $1 where id = 1",
        sqlx::types::Json(prices) as _,
    )
    .execute(pool)
    .await?;
    Ok(())
}

/// The account providers the admin turned on. The catalog itself (names,
/// adapters) is in code (`gripsou_providers::registry::ACCOUNTS`).
pub async fn enabled_providers(pool: &sqlx::PgPool) -> Result<Vec<String>, CoreError> {
    let keys = sqlx::query_scalar!(
        r#"select enabled_providers as "enabled_providers!" from app_settings where id = 1"#
    )
    .fetch_one(pool)
    .await?;
    Ok(keys)
}

/// Turns an account provider on or off. Idempotent.
pub async fn set_provider_enabled(
    pool: &sqlx::PgPool,
    key: &str,
    enabled: bool,
) -> Result<(), CoreError> {
    if enabled {
        sqlx::query!(
            r#"
            update app_settings
            set enabled_providers = case
                when $1 = any(enabled_providers) then enabled_providers
                else array_append(enabled_providers, $1)
            end
            where id = 1
            "#,
            key,
        )
        .execute(pool)
        .await?;
    } else {
        sqlx::query!(
            r#"
            update app_settings
            set enabled_providers = array_remove(enabled_providers, $1)
            where id = 1
            "#,
            key,
        )
        .execute(pool)
        .await?;
    }
    Ok(())
}
