//! Read-only dashboard handlers. State is the PgPool; the user is resolved
//! per request via `current_user` (single seeded user for now).

use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::Json;
use chrono::{DateTime, Datelike, Duration, NaiveDate, Utc};
use serde::Deserialize;
use sqlx::PgPool;
use uuid::Uuid;

use crate::dto;
use crate::user::current_user;

/// Map a range key to an inclusive [from, to=now] window.
fn range_window(range: &str) -> (DateTime<Utc>, DateTime<Utc>) {
    let now = Utc::now();
    let from = match range {
        "24h" => now - Duration::days(1),
        "7d" => now - Duration::days(7),
        "1mo" => now - Duration::days(30),
        "6mo" => now - Duration::days(182),
        "1y" => now - Duration::days(365),
        "ytd" => NaiveDate::from_ymd_opt(now.year(), 1, 1).unwrap().and_hms_opt(0, 0, 0).unwrap().and_utc(),
        _ => now - Duration::days(4000), // "max"
    };
    (from, now)
}

#[derive(Deserialize)]
pub struct RangeParams {
    #[serde(default = "default_range")]
    range: String,
}
fn default_range() -> String { "6mo".to_string() }

fn internal(e: impl std::fmt::Display) -> (StatusCode, String) {
    (StatusCode::INTERNAL_SERVER_ERROR, e.to_string())
}

pub async fn net_worth(
    State(pool): State<PgPool>,
    Query(p): Query<RangeParams>,
) -> Result<Json<dto::NetWorthResponse>, (StatusCode, String)> {
    let user_id = current_user(&pool).await.map_err(internal)?;
    let (from, to) = range_window(&p.range);
    let rows = gripsou_core::repo::query::net_worth_series(&pool, user_id, from.date_naive(), to.date_naive())
        .await
        .map_err(internal)?;
    Ok(Json(dto::NetWorthResponse::from_rows(&rows)))
}

pub async fn distribution(
    State(pool): State<PgPool>,
) -> Result<Json<Vec<dto::DistributionAccount>>, (StatusCode, String)> {
    let user_id = current_user(&pool).await.map_err(internal)?;
    let rows = gripsou_core::repo::query::distribution(&pool, user_id).await.map_err(internal)?;
    Ok(Json(rows.into_iter().map(dto::DistributionAccount::from_row).collect()))
}

pub async fn holdings(
    State(pool): State<PgPool>,
) -> Result<Json<Vec<dto::Holding>>, (StatusCode, String)> {
    let user_id = current_user(&pool).await.map_err(internal)?;
    let rows = gripsou_core::repo::query::holdings(&pool, user_id).await.map_err(internal)?;
    Ok(Json(rows.into_iter().map(dto::Holding::from_row).collect()))
}

pub async fn holding_prices(
    State(pool): State<PgPool>,
    Path(id): Path<Uuid>,
    Query(p): Query<RangeParams>,
) -> Result<Json<Vec<dto::PricePoint>>, (StatusCode, String)> {
    let user_id = current_user(&pool).await.map_err(internal)?;
    let (from, to) = range_window(&p.range);
    let rows = gripsou_core::repo::query::holding_prices(&pool, user_id, id, from, to).await.map_err(internal)?;
    Ok(Json(rows.into_iter().map(dto::PricePoint::from_row).collect()))
}

pub async fn holding_transactions(
    State(pool): State<PgPool>,
    Path(id): Path<Uuid>,
) -> Result<Json<Vec<dto::Purchase>>, (StatusCode, String)> {
    let user_id = current_user(&pool).await.map_err(internal)?;
    let rows = gripsou_core::repo::query::holding_transactions(&pool, user_id, id).await.map_err(internal)?;
    Ok(Json(rows.into_iter().map(dto::Purchase::from_row).collect()))
}
