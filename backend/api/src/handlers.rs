//! Dashboard + auth handlers. State is the PgPool; the authenticated user is
//! resolved per request via the `AuthUser` extractor (bearer token).

use axum::Json;
use axum::extract::{ConnectInfo, Path, Query, State};
use axum::http::{HeaderMap, StatusCode};
use chrono::{Datelike, Duration, NaiveDate, Utc};
use rust_decimal::Decimal;
use serde::Deserialize;
use sqlx::PgPool;
use std::net::SocketAddr;
use uuid::Uuid;

use crate::auth::{self, AdminUser, AuthUser};
use crate::dto;
use crate::error::ApiError;

/// Inclusive calendar-day windows, anchored to the caller's saved timezone.
fn range_window(range: &str, today: NaiveDate) -> (NaiveDate, NaiveDate) {
    let from = match range {
        "24h" => today - Duration::days(1),
        "7d" => today - Duration::days(7),
        "1mo" => today - Duration::days(30),
        "6mo" => today - Duration::days(182),
        "1y" => today - Duration::days(365),
        "ytd" => NaiveDate::from_ymd_opt(today.year(), 1, 1).unwrap(),
        _ => today - Duration::days(4000),
    };
    (from, today)
}

#[derive(Deserialize)]
pub struct RangeParams {
    #[serde(default = "default_range")]
    range: String,
}
fn default_range() -> String {
    "6mo".to_string()
}

/// Client IP: the last X-Forwarded-For hop, which the nearest proxy wrote
/// (earlier hops come from the client), else the direct peer address.
/// The per-IP login limit relies on it, so the backend must sit behind a
/// proxy that sets the header; Caddy replaces it, others append to it.
pub(crate) fn user_agent(headers: &HeaderMap) -> &str {
    headers
        .get(axum::http::header::USER_AGENT)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
}

pub(crate) fn client_ip(headers: &HeaderMap, peer: SocketAddr) -> String {
    headers
        .get("x-forwarded-for")
        .and_then(|v| v.to_str().ok())
        .and_then(|xff| xff.rsplit(',').next())
        .map(str::trim)
        .filter(|ip| !ip.is_empty())
        .map_or_else(|| peer.ip().to_string(), str::to_string)
}

pub async fn net_worth(
    State(pool): State<PgPool>,
    AuthUser { user_id, .. }: AuthUser,
    Query(p): Query<RangeParams>,
) -> Result<Json<dto::NetWorthResponse>, ApiError> {
    let today = gripsou_core::repo::prefs::today(&pool, user_id).await?;
    let (from, to) = range_window(&p.range, today);
    let rows = gripsou_core::repo::query::net_worth_series(&pool, user_id, from, to).await?;
    Ok(Json(dto::NetWorthResponse::from_rows(&rows)))
}

pub async fn holdings(
    State(pool): State<PgPool>,
    AuthUser { user_id, .. }: AuthUser,
) -> Result<Json<Vec<dto::Holding>>, ApiError> {
    let rows = gripsou_core::repo::query::holdings(&pool, user_id).await?;
    Ok(Json(rows.into_iter().map(dto::Holding::from_row).collect()))
}

pub async fn investment_returns(
    State(pool): State<PgPool>,
    AuthUser { user_id, .. }: AuthUser,
) -> Result<Json<dto::InvestmentReturns>, ApiError> {
    let inputs = gripsou_core::repo::returns::load(&pool, user_id).await?;
    let accounts = gripsou_core::repo::query::accounts(&pool, user_id).await?;
    let r = gripsou_core::returns::returns(&inputs.positions, &inputs.flows, inputs.today);

    // `query::accounts` lists every account it can value from snapshots, which
    // every synced account has, so the lookup only fails for an account never
    // synced.
    let rows = r
        .accounts
        .iter()
        .filter_map(|a| {
            let acc = accounts.iter().find(|x| x.account_id == a.account_id)?;
            Some(dto::ReturnAccount {
                id: a.account_id.to_string(),
                name: acc.name.clone(),
                color: acc.color.clone(),
                source: acc.source_name.clone().unwrap_or_default(),
                missing: a
                    .figures
                    .missing
                    .iter()
                    .map(|m| dto::MissingHolding {
                        id: m.holding_id.to_string(),
                        name: m.name.clone(),
                    })
                    .collect(),
                figures: dto::ReturnFigures::from_scope(&a.figures),
            })
        })
        .collect();

    Ok(Json(dto::InvestmentReturns {
        today: inputs.today.to_string(),
        total: dto::ReturnFigures::from_scope(&r.total),
        accounts: rows,
    }))
}

pub async fn holding_prices(
    State(pool): State<PgPool>,
    AuthUser { user_id, .. }: AuthUser,
    Path(id): Path<Uuid>,
    Query(p): Query<RangeParams>,
) -> Result<Json<Vec<dto::PricePoint>>, ApiError> {
    let today = gripsou_core::repo::prefs::today(&pool, user_id).await?;
    let (from, to) = range_window(&p.range, today);
    let rows = gripsou_core::repo::query::holding_prices(
        &pool,
        user_id,
        id,
        from.and_hms_opt(0, 0, 0).unwrap().and_utc(),
        to.and_hms_opt(23, 59, 59).unwrap().and_utc(),
    )
    .await?;
    Ok(Json(
        rows.into_iter().map(dto::PricePoint::from_row).collect(),
    ))
}

/// Validate a batch of lot adds shared by `save_lots` and `preview_lots` —
/// the buy/sell check, the decimal parses, the positivity checks, and the
/// `MAX_SCALE` / `10^12` magnitude bounds all live here exactly once, so the
/// number shown while editing and the number accepted on save reject the same
/// inputs.
fn parse_lot_adds(
    adds: &[dto::LotEntry],
) -> Result<Vec<gripsou_core::repo::lot::PreviewLot>, ApiError> {
    let bad = ApiError::bad_request;

    let mut parsed = Vec::with_capacity(adds.len());
    for a in adds {
        let side = match a.kind.as_str() {
            "buy" => "buy",
            "sell" => "sell",
            _ => return Err(bad("type must be buy or sell")),
        };
        let quantity: Decimal = a
            .quantity
            .parse()
            .map_err(|_| bad("quantity is not a decimal"))?;
        let unit_price: Decimal = a
            .unit_price
            .parse()
            .map_err(|_| bad("unitPrice is not a decimal"))?;
        let fee: Decimal = match &a.fee {
            Some(f) => f.parse().map_err(|_| bad("fee is not a decimal"))?,
            None => Decimal::ZERO,
        };
        if quantity <= Decimal::ZERO || unit_price < Decimal::ZERO {
            return Err(bad(
                "quantity must be positive and unitPrice must not be negative",
            ));
        }
        if fee < Decimal::ZERO {
            return Err(bad("fee must not be negative"));
        }
        // A lot that doesn't fit a `Decimal` would make every read of its holding fail.
        const MAX_SCALE: u32 = 8;
        let max_magnitude = Decimal::from(1_000_000_000_000i64); // 10^12
        if quantity.scale() > MAX_SCALE || unit_price.scale() > MAX_SCALE || fee.scale() > MAX_SCALE
        {
            return Err(bad(
                "quantity, unitPrice and fee support at most 8 decimal places",
            ));
        }
        if quantity.abs() >= max_magnitude
            || unit_price.abs() >= max_magnitude
            || fee.abs() >= max_magnitude
        {
            return Err(bad("quantity, unitPrice and fee must be below 10^12"));
        }
        let gross = quantity
            .checked_mul(unit_price)
            .ok_or_else(|| bad("quantity * unitPrice does not fit in a decimal"))?;
        if gross.scale() > 28 {
            return Err(bad("quantity * unitPrice does not fit in a decimal"));
        }
        parsed.push(gripsou_core::repo::lot::PreviewLot {
            side: side.to_string(),
            acquired_on: a.date,
            quantity,
            unit_price,
            fee,
        });
    }
    Ok(parsed)
}

/// Apply a batch of manual lot adds and deletes atomically.
///
/// One DB transaction and ONE backfill run for the whole batch: the previous
/// per-row endpoint re-derived the entire connection's history once per lot,
/// and a partial failure left the user looking at a half-applied edit with no
/// way to tell which half.
pub async fn save_lots(
    State(pool): State<PgPool>,
    AuthUser { user_id, .. }: AuthUser,
    Path(holding_id): Path<Uuid>,
    Json(req): Json<dto::SaveLotsReq>,
) -> Result<StatusCode, ApiError> {
    // Validate EVERY add before writing anything, so a rejected batch leaves no
    // trace — the transaction would roll back anyway, but failing early keeps
    // the error attributable to a row rather than to the batch.
    let parsed = parse_lot_adds(&req.adds)?;

    // A repeated id would make the delete count fall short of the requested
    // count and reject a request that is merely redundant.
    let mut deletes = req.deletes.clone();
    deletes.sort();
    deletes.dedup();

    let mut tx = pool.begin().await?;

    // Ownership check and the connection the backfill must rebuild, in one
    // query: the connection is *derived* from the holding, never taken from the
    // request, so a caller cannot aim the rebuild at someone else's connection.
    let connection_id = sqlx::query_scalar!(
        r#"
        select a.connection_id as "connection_id!"
        from holding h
        join account a    on a.id = h.account_id
        join connection c on c.id = a.connection_id
        where h.id = $1 and c.user_id = $2
        "#,
        holding_id,
        user_id,
    )
    .fetch_optional(&mut *tx)
    .await?;
    // A holding the caller does not own reads as 404, so the endpoint does not
    // confirm the existence of ids the caller cannot see.
    let Some(connection_id) = connection_id else {
        return Err(ApiError::NotFound("unknown holding"));
    };

    if !deletes.is_empty() {
        let deleted =
            gripsou_core::repo::lot::delete_lots(&mut tx, holding_id, user_id, &deletes).await?;
        // Anything the predicate refused — another user's row, a provider row,
        // another holding's row, an id that never existed — lands here as the
        // same 404, and takes the adds down with it.
        if deleted != deletes.len() as u64 {
            return Err(ApiError::NotFound("unknown entry"));
        }
    }

    for p in &parsed {
        let inserted = gripsou_core::repo::lot::insert_lot(
            &mut tx,
            holding_id,
            user_id,
            &p.side,
            p.acquired_on,
            p.quantity,
            p.unit_price,
            p.fee,
        )
        .await?;
        if inserted.is_none() {
            // The check above already gated on ownership; the write's own
            // predicate is belt and braces — 404, never a 500 from an empty row.
            return Err(ApiError::NotFound("unknown holding"));
        }
    }

    // Manual entry is the main path for securities, so the derived history
    // must move now — not at the next daily sync, a day later. Once, after all
    // the writes, not per row.
    if !parsed.is_empty() || !deletes.is_empty() {
        gripsou_core::backfill::backfill_connection(&mut tx, connection_id).await?;
    }

    tx.commit().await?;
    Ok(StatusCode::NO_CONTENT)
}

pub async fn holding_lots(
    State(pool): State<PgPool>,
    AuthUser { user_id, .. }: AuthUser,
    Path(holding_id): Path<Uuid>,
) -> Result<Json<Vec<dto::Lot>>, ApiError> {
    let rows = gripsou_core::repo::lot::list_lots(&pool, user_id, holding_id).await?;
    Ok(Json(rows.into_iter().map(dto::Lot::from_row).collect()))
}

/// Lots the form can pre-fill: quantity changes matched to their one
/// transaction. Read-only; the user saves them through `save_lots`.
pub async fn lot_suggestions(
    State(pool): State<PgPool>,
    AuthUser { user_id, .. }: AuthUser,
    Path(holding_id): Path<Uuid>,
) -> Result<Json<Vec<dto::LotSuggestion>>, ApiError> {
    let rows = gripsou_core::repo::lot_suggest::suggest_lots(&pool, user_id, holding_id)
        .await?
        .ok_or(ApiError::NotFound("unknown holding"))?;
    Ok(Json(
        rows.into_iter()
            .map(dto::LotSuggestion::from_suggestion)
            .collect(),
    ))
}

/// Latest known unit price for a holding's instrument, in whatever currency
/// that price row carries. No helper for this already existed outside the
/// full `holdings()` listing query, so this is a new, narrow lookup rather
/// than a reuse. Zero when no price row exists yet, mirroring `Holding`'s own
/// fallback for the same case.
/// Today's price of one share in the holding's account currency — the domain
/// lots and their basis are in. Zero when the price or a rate is unknown.
async fn current_price(
    pool: &PgPool,
    user_id: Uuid,
    holding_id: Uuid,
) -> Result<Decimal, gripsou_core::error::CoreError> {
    let price = sqlx::query_scalar!(
        r#"
        select unit_value_asof(h.instrument_id, user_today($2))
               / nullif(fx_asof(a.currency, user_today($2)), 0)
        from holding h
        join account a on a.id = h.account_id
        where h.id = $1
        "#,
        holding_id,
        user_id,
    )
    .fetch_optional(pool)
    .await?;
    Ok(price.flatten().unwrap_or(Decimal::ZERO))
}

/// What the figures would be for a set of unsaved rows.
///
/// The math is not duplicated here: `basis_preview` writes the rows, calls
/// `lot_basis`, and rolls back. That is what guarantees the number shown while
/// editing is the number obtained after saving.
pub async fn preview_lots(
    State(pool): State<PgPool>,
    AuthUser { user_id, .. }: AuthUser,
    Path(holding_id): Path<Uuid>,
    Json(req): Json<dto::PreviewLotsReq>,
) -> Result<Json<dto::BasisPreview>, ApiError> {
    let rows = parse_lot_adds(&req.rows)?;
    // `None` is an unowned or unknown holding. It must read as 404, exactly as
    // `save_lots` does — that handler's comment states the reason: the endpoint
    // must not confirm the existence of ids the caller cannot see. Letting this
    // fall through as a 500 would diverge from the sibling endpoint on the same
    // resource.
    let f = gripsou_core::repo::lot::basis_preview(&pool, user_id, holding_id, &rows)
        .await?
        .ok_or(ApiError::NotFound("unknown holding"))?;
    let price = current_price(&pool, user_id, holding_id).await?;
    let unrealised = f.explained_qty * price - f.basis;
    Ok(Json(dto::BasisPreview {
        mean_price: f.mean_price.to_string(),
        invested: f.basis.to_string(),
        realised: f.realised.to_string(),
        unrealised: unrealised.to_string(),
    }))
}

pub async fn accounts(
    State(pool): State<PgPool>,
    AuthUser { user_id, .. }: AuthUser,
) -> Result<Json<Vec<dto::Account>>, ApiError> {
    let rows = gripsou_core::repo::query::accounts(&pool, user_id).await?;
    Ok(Json(rows.into_iter().map(dto::Account::from_row).collect()))
}

pub async fn account_series(
    State(pool): State<PgPool>,
    AuthUser { user_id, .. }: AuthUser,
    Query(p): Query<RangeParams>,
) -> Result<Json<dto::AccountSeriesResponse>, ApiError> {
    let today = gripsou_core::repo::prefs::today(&pool, user_id).await?;
    let (from, to) = range_window(&p.range, today);
    let rows = gripsou_core::repo::query::account_series(&pool, user_id, from, to).await?;
    Ok(Json(dto::AccountSeriesResponse::from_rows(rows)))
}

#[derive(Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TransactionParams {
    pub search: Option<String>,
    pub account_id: Option<Uuid>,
    /// `all` | `in` | `out` | `lots` — the TYPE control on the filter panel.
    pub bucket: Option<String>,
    pub from: Option<NaiveDate>,
    pub to: Option<NaiveDate>,
    /// Comma-separated uuids. Several categories mean *either*.
    pub category_ids: Option<String>,
    /// Comma-separated uuids. Several tags mean *all*.
    pub tag_ids: Option<String>,
    pub uncategorized: Option<bool>,
    pub needs_review: Option<bool>,
    /// Absent means hide internal transfers — the list's default.
    pub include_transfers: Option<bool>,
    pub limit: Option<i64>,
    pub offset: Option<i64>,
}

/// A filter the server cannot fully honour must never be silently narrowed to
/// a wider one, so an unparseable `categoryIds`/`tagIds` component or an
/// unrecognised `bucket` is a 400 here, not a dropped id or a fall-through to
/// `all` — see `budget::parse_ids`/`parse_bucket`.
pub fn filters_from_params(
    p: TransactionParams,
    review_threshold: rust_decimal::Decimal,
) -> Result<gripsou_core::repo::query::TransactionFilters, ApiError> {
    use gripsou_core::repo::query::TransactionFilters;
    Ok(TransactionFilters {
        search: p.search.filter(|s| !s.trim().is_empty()),
        account_id: p.account_id,
        bucket: crate::budget::parse_bucket(p.bucket.as_deref())?,
        from: p.from,
        to: p.to,
        category_ids: crate::budget::parse_ids(p.category_ids.as_deref())?,
        tag_ids: crate::budget::parse_ids(p.tag_ids.as_deref())?,
        uncategorized: p.uncategorized.unwrap_or(false),
        needs_review: p.needs_review.unwrap_or(false),
        // Hidden unless asked for: unlike every other filter here, the
        // default is *not* "everything".
        include_transfers: p.include_transfers.unwrap_or(false),
        review_threshold,
        // Capped so a crafted `limit` cannot ask for the whole ledger at once.
        limit: p.limit.unwrap_or(200).clamp(1, 500),
        offset: p.offset.unwrap_or(0).max(0),
    })
}

pub async fn transactions(
    State(pool): State<PgPool>,
    AuthUser { user_id, .. }: AuthUser,
    Query(p): Query<TransactionParams>,
) -> Result<Json<Vec<dto::Transaction>>, ApiError> {
    let threshold = gripsou_core::repo::prefs::review_threshold(&pool, user_id).await?;
    let filters = filters_from_params(p, threshold)?;
    let rows = gripsou_core::repo::query::transactions(&pool, user_id, &filters).await?;
    let ids: Vec<Uuid> = rows.iter().map(|r| r.id).collect();
    let mut tags = gripsou_core::repo::query::tags_for_transactions(&pool, user_id, &ids).await?;
    Ok(Json(
        rows.into_iter()
            .map(|r| {
                let row_tags = tags.remove(&r.id).unwrap_or_default();
                dto::Transaction::from_row(r, row_tags)
            })
            .collect(),
    ))
}

pub async fn connections(
    State(pool): State<PgPool>,
    AuthUser { user_id, .. }: AuthUser,
) -> Result<Json<Vec<dto::ProviderGroup>>, ApiError> {
    let conns = gripsou_core::repo::connection::list_connections(&pool, user_id).await?;
    let accounts = gripsou_core::repo::connection::list_connection_accounts(&pool, user_id).await?;
    Ok(Json(dto::ProviderGroup::tree(conns, accounts)))
}

pub async fn sync_connection(
    State(pool): State<PgPool>,
    State(key): State<crate::EncryptionKey>,
    AuthUser { user_id, .. }: AuthUser,
    Path(id): Path<Uuid>,
) -> Result<(StatusCode, Json<dto::ConnectionState>), ApiError> {
    use gripsou_core::repo::connection::BeginSync;
    match gripsou_jobs::request_sync(
        pool.clone(),
        &key,
        user_id,
        id,
        gripsou_jobs::Trigger::Manual,
    )
    .await?
    {
        BeginSync::Started(state) => {
            tracing::info!(connection_id = %id, "sync requested");
            Ok((
                StatusCode::ACCEPTED,
                Json(dto::ConnectionState::from_row(state)),
            ))
        }
        BeginSync::AlreadySyncing => Err(ApiError::Conflict("connection is already syncing")),
        BeginSync::NotFound => Err(ApiError::NotFound("connection not found")),
    }
}

pub async fn sync_all(
    State(pool): State<PgPool>,
    State(key): State<crate::EncryptionKey>,
    AuthUser { user_id, .. }: AuthUser,
) -> Result<(StatusCode, Json<serde_json::Value>), ApiError> {
    use gripsou_core::repo::connection::BeginSync;
    let ids = gripsou_core::repo::connection::ids_for_user(&pool, user_id).await?;
    let mut started = 0u32;
    for id in ids {
        if let BeginSync::Started(_) = gripsou_jobs::request_sync(
            pool.clone(),
            &key,
            user_id,
            id,
            gripsou_jobs::Trigger::Manual,
        )
        .await?
        {
            started += 1;
        }
    }
    tracing::info!(started, "sync requested");
    Ok((
        StatusCode::ACCEPTED,
        Json(serde_json::json!({ "started": started })),
    ))
}

pub async fn account_types(
    State(pool): State<PgPool>,
) -> Result<Json<Vec<dto::AccountType>>, ApiError> {
    let rows = gripsou_core::repo::query::account_types(&pool).await?;
    Ok(Json(
        rows.into_iter().map(dto::AccountType::from_row).collect(),
    ))
}

pub async fn update_account(
    State(pool): State<PgPool>,
    AuthUser { user_id, .. }: AuthUser,
    Path(id): Path<Uuid>,
    Json(body): Json<dto::UpdateAccountReq>,
) -> Result<Json<dto::UpdatedAccount>, ApiError> {
    let updated = gripsou_core::repo::account::update_account(
        &pool,
        user_id,
        id,
        &body.name,
        &body.type_key,
        &body.color,
    )
    .await?
    .ok_or(ApiError::NotFound("account not found"))?;
    Ok(Json(dto::UpdatedAccount::from_row(updated)))
}

pub async fn providers(
    State(pool): State<PgPool>,
    _: AdminUser,
) -> Result<Json<Vec<dto::Provider>>, ApiError> {
    let rows = gripsou_core::repo::provider::account_providers(&pool).await?;
    Ok(Json(
        rows.into_iter().map(dto::Provider::from_row).collect(),
    ))
}

pub async fn budget_ai_settings(
    State(pool): State<PgPool>,
    _: AdminUser,
) -> Result<Json<dto::BudgetAiSettingsDto>, ApiError> {
    let s = gripsou_core::repo::settings::budget_ai(&pool).await?;
    let defaults = gripsou_jobs::categorizer_keys()
        .into_iter()
        .filter_map(|k| gripsou_jobs::default_model(k).map(|m| (k, m)))
        .collect();
    Ok(Json(dto::BudgetAiSettingsDto {
        provider: s.provider,
        model: s.model,
        available: gripsou_jobs::available_categorizers(),
        defaults,
    }))
}

pub async fn set_budget_ai_settings(
    State(pool): State<PgPool>,
    AdminUser { user_id }: AdminUser,
    Json(body): Json<dto::SetBudgetAiSettingsReq>,
) -> Result<StatusCode, ApiError> {
    let provider = body
        .provider
        .as_deref()
        .map(str::trim)
        .filter(|p| !p.is_empty());
    if provider.is_some_and(|p| !gripsou_jobs::categorizer_keys().contains(&p)) {
        return Err(ApiError::bad_request("unknown provider"));
    }
    let model = body
        .model
        .as_deref()
        .map(str::trim)
        .filter(|m| !m.is_empty());
    gripsou_core::repo::settings::set_budget_ai(&pool, provider, model).await?;
    tracing::info!(
        by = %user_id,
        provider = provider.unwrap_or(""),
        model = model.unwrap_or(""),
        "ai settings changed"
    );
    Ok(StatusCode::NO_CONTENT)
}

/// The models the provider offers, for the admin's model dropdown. Asked of
/// the provider on every call: the list is short and only read by an admin.
pub async fn budget_ai_models(
    _: AdminUser,
    Path(provider): Path<String>,
) -> Result<Json<Vec<String>>, ApiError> {
    if !gripsou_jobs::categorizer_keys().contains(&provider.as_str()) {
        return Err(ApiError::NotFound("unknown provider"));
    }
    match gripsou_jobs::categorizer_models(&provider).await {
        Some(Ok(models)) => Ok(Json(models)),
        Some(Err(e)) => {
            tracing::warn!(provider = %provider, error = %gripsou_core::logs::error_chain(&e), "ai model list failed");
            Err(ApiError::BadGateway(e.to_string()))
        }
        None => Err(ApiError::Conflict("provider has no API key on this server")),
    }
}

pub async fn budget_ai_usage(
    State(pool): State<PgPool>,
    _: AdminUser,
) -> Result<Json<dto::BudgetAiUsageDto>, ApiError> {
    let report = gripsou_core::budget::ai_cost::usage_report(&pool).await?;
    let money = |d: Decimal| d.round_dp(4).normalize().to_string();
    Ok(Json(dto::BudgetAiUsageDto {
        currency: "USD",
        models: report
            .models
            .into_iter()
            .map(|m| dto::BudgetAiModelUsageDto {
                model: m.model,
                runs: m.runs,
                runs_without_usage: m.runs_without_usage,
                tokens_in: m.tokens_in,
                tokens_out: m.tokens_out,
                price_in: m.price.as_ref().map(|p| p.input.to_string()),
                price_out: m.price.as_ref().map(|p| p.output.to_string()),
                cost: m.cost.map(money),
            })
            .collect(),
        total_cost: money(report.total_cost),
    }))
}

/// Replaces the whole price map. Every value must be a non-negative decimal
/// string (USD per million tokens); anything else is a 400 and saves nothing.
pub async fn set_budget_ai_prices(
    State(pool): State<PgPool>,
    AdminUser { user_id }: AdminUser,
    Json(body): Json<std::collections::BTreeMap<String, dto::BudgetAiPriceReq>>,
) -> Result<StatusCode, ApiError> {
    let parse = |model: &str, v: &str| {
        v.trim()
            .parse::<Decimal>()
            .ok()
            .filter(|d| *d >= Decimal::ZERO)
            .map(|d| if d.is_zero() { Decimal::ZERO } else { d })
            .ok_or_else(|| ApiError::BadRequest(format!("invalid price for {model}: {v:?}")))
    };
    let mut prices = gripsou_core::repo::settings::ModelPrices::new();
    for (model, p) in &body {
        let model = model.trim();
        if model.is_empty() {
            return Err(ApiError::bad_request("empty model key"));
        }
        prices.insert(
            model.to_string(),
            gripsou_core::repo::settings::ModelPrice {
                input: parse(model, &p.input)?,
                output: parse(model, &p.output)?,
            },
        );
    }
    gripsou_core::repo::settings::set_budget_ai_prices(&pool, &prices).await?;
    tracing::info!(by = %user_id, models = prices.len() as u64, "ai prices changed");
    Ok(StatusCode::NO_CONTENT)
}

pub async fn set_provider(
    State(pool): State<PgPool>,
    AdminUser { user_id }: AdminUser,
    Path(key): Path<String>,
    Json(body): Json<dto::SetProviderReq>,
) -> Result<Json<dto::Provider>, ApiError> {
    // Reject unknown / non-account providers before mutating.
    let row = gripsou_core::repo::provider::account_provider(&pool, &key)
        .await?
        .ok_or(ApiError::NotFound("provider not found"))?;
    gripsou_core::repo::provider::set_enabled(&pool, &key, body.enabled).await?;
    tracing::info!(by = %user_id, provider = %key, enabled = body.enabled, "provider enabled changed");
    Ok(Json(dto::Provider {
        key: row.key,
        display_name: row.display_name,
        description: row.description,
        enabled: body.enabled,
    }))
}

pub async fn users(
    State(pool): State<PgPool>,
    AdminUser { user_id }: AdminUser,
) -> Result<Json<Vec<dto::User>>, ApiError> {
    // Listing every account (names/emails/roles) is admin-only.
    let rows = gripsou_core::repo::query::users(&pool).await?;
    Ok(Json(
        rows.into_iter()
            .map(|r| dto::User::from_row(r, user_id))
            .collect(),
    ))
}

const MAX_EMAIL_LEN: usize = 254;

pub async fn login(
    State(pool): State<PgPool>,
    State(throttle): State<std::sync::Arc<crate::throttle::LoginThrottle>>,
    headers: HeaderMap,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    Json(body): Json<dto::LoginReq>,
) -> Result<Json<dto::LoginOutcome>, ApiError> {
    let unauthorized = || ApiError::InvalidCredentials;
    let user_agent = user_agent(&headers);
    // No real address is longer (RFC 5321). Refused before the email can
    // become a throttle key or a log field.
    if body.email.len() > MAX_EMAIL_LEN {
        return Err(unauthorized());
    }
    let ip = client_ip(&headers, peer);
    let now = std::time::Instant::now();
    // Counts the attempt as a failure until the password proves right.
    if let Err(blocked) = throttle.try_attempt(&body.email, &ip, now) {
        if blocked.first_refusal {
            tracing::warn!(email = %body.email, ip = %ip, reason = blocked.reason.as_str(), "login throttled");
        }
        return Err(blocked.into());
    }
    let creds = gripsou_core::repo::user::credentials_by_email(&pool, &body.email).await?;
    let ok = auth::verify_password_or_dummy(
        &body.password,
        creds.as_ref().map(|c| c.password_hash.as_str()),
    );
    let Some(creds) = creds.filter(|_| ok) else {
        tracing::warn!(email = %body.email, ip = %ip, user_agent, "login failed");
        return Err(unauthorized());
    };
    let status = gripsou_core::repo::mfa::status(&pool, creds.id).await?;
    if gripsou_core::repo::mfa::has_second_factor(&status) {
        // The password alone proves nothing yet: the attempt stays counted
        // until the second factor is right (see `login_verify`).
        let token = auth::generate_token();
        gripsou_core::repo::login_challenge::create(
            &pool,
            &auth::hash_token(&token),
            Some(creds.id),
            "mfa",
            serde_json::json!({ "remember": body.remember }),
        )
        .await?;
        tracing::info!(user_id = %creds.id, ip = %ip, "mfa challenge issued");
        return Ok(Json(dto::LoginOutcome::Mfa(dto::MfaRequired {
            mfa_required: true,
            challenge: token,
        })));
    }
    throttle.record_success(&body.email, &ip);

    let resp = issue_session(&pool, &headers, peer, creds.id, body.remember).await?;
    tracing::info!(user_id = %creds.id, ip = %ip, user_agent, method = "password", "login succeeded");
    Ok(Json(dto::LoginOutcome::Session(resp)))
}

/// Second login step: a challenge from `login` plus a TOTP or recovery code
/// becomes a session. Wrong codes count on the second-factor throttle (per
/// account, long memory) and on the IP.
pub async fn login_verify(
    State(pool): State<PgPool>,
    State(throttle): State<std::sync::Arc<crate::throttle::LoginThrottle>>,
    State(sf_throttle): State<std::sync::Arc<crate::throttle::SecondFactorThrottle>>,
    State(key): State<crate::EncryptionKey>,
    headers: HeaderMap,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    Json(body): Json<dto::LoginVerifyReq>,
) -> Result<Json<dto::LoginResponse>, ApiError> {
    use gripsou_core::repo::{login_challenge, mfa};
    let expired = || ApiError::ChallengeExpired;
    let user_agent = user_agent(&headers);
    let ip = client_ip(&headers, peer);
    let challenge_hash = auth::hash_token(&body.challenge);
    let challenge = login_challenge::find_valid(&pool, &challenge_hash, "mfa")
        .await?
        .ok_or_else(expired)?;
    let user_id = challenge.user_id.ok_or_else(expired)?;
    let profile = gripsou_core::repo::user::profile_by_id(&pool, user_id)
        .await?
        .ok_or_else(expired)?;
    if let Err(blocked) =
        sf_throttle.try_login(&throttle, &profile.email, &ip, std::time::Instant::now())
    {
        if blocked.first_refusal {
            tracing::warn!(email = %profile.email, ip = %ip, reason = blocked.reason.as_str(), "login throttled");
        }
        return Err(blocked.into());
    }

    // The TOTP step is worked out before the transaction (no DB write).
    let totp_step = match (&body.totp, &body.recovery_code) {
        (Some(code), None) => {
            let row = mfa::totp(&pool, user_id).await?.filter(|r| r.confirmed);
            match row {
                Some(row) => crate::factors::check_totp(&key, &row.secret_enc, code)?,
                None => None,
            }
        }
        (None, Some(_)) => None,
        _ => {
            return Err(ApiError::bad_request("code required"));
        }
    };

    // Spending the challenge and the code is one transaction: a request that
    // loses the race for the challenge (a parallel one won) rolls back and
    // leaves its code unspent, and a wrong code leaves the challenge usable.
    let mut tx = pool.begin().await?;
    let challenge = login_challenge::consume(&mut *tx, &challenge_hash, "mfa")
        .await?
        .ok_or_else(expired)?;
    let method = match (totp_step, &body.recovery_code) {
        (Some(step), _) => mfa::use_totp_step(&mut *tx, user_id, step as i64)
            .await?
            .then_some(("totp", None)),
        (None, Some(code)) => {
            let hash = crate::factors::hash_recovery_code(code);
            mfa::use_recovery_code(&mut tx, user_id, &hash)
                .await?
                .map(|remaining| ("recovery", Some(remaining)))
        }
        (None, None) => None,
    };
    let Some((method, remaining)) = method else {
        drop(tx);
        tracing::warn!(email = %profile.email, ip = %ip, user_agent, step = "second_factor", "login failed");
        return Err(ApiError::bad_request("invalid code"));
    };
    tx.commit().await?;
    if let Some(remaining) = remaining {
        tracing::info!(user_id = %user_id, remaining, "recovery code used");
    }
    sf_throttle.record_login_success(&throttle, &profile.email, &ip);
    let remember = challenge
        .state
        .get("remember")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    let resp = issue_session(&pool, &headers, peer, user_id, remember).await?;
    tracing::info!(user_id = %user_id, ip = %ip, user_agent, method, "login succeeded");
    Ok(Json(resp))
}

pub async fn me(
    State(pool): State<PgPool>,
    AuthUser { user_id, .. }: AuthUser,
) -> Result<Json<dto::SessionUser>, ApiError> {
    let profile = gripsou_core::repo::user::profile_by_id(&pool, user_id)
        .await?
        .ok_or(ApiError::Unauthorized)?;
    Ok(Json(dto::SessionUser::from_profile(&profile)))
}

/// Mark the post-invite welcome screen finished (or skipped). Idempotent.
pub async fn finish_welcome(
    State(pool): State<PgPool>,
    AuthUser { user_id, .. }: AuthUser,
) -> Result<StatusCode, ApiError> {
    if !gripsou_core::repo::user::finish_welcome(&pool, user_id).await? {
        return Err(ApiError::Unauthorized);
    }
    tracing::info!(user_id = %user_id, "welcome finished");
    Ok(StatusCode::NO_CONTENT)
}

/// Saves only the settings in the body (see `prefs::patch_prefs`), so two
/// settings changed at once never overwrite each other.
pub async fn update_prefs(
    State(pool): State<PgPool>,
    AuthUser { user_id, .. }: AuthUser,
    Json(patch): Json<serde_json::Map<String, serde_json::Value>>,
) -> Result<Json<dto::SessionUser>, ApiError> {
    use gripsou_core::repo::prefs::{PrefsError, patch_prefs};
    let was_enabled = match patch_prefs(&pool, user_id, &patch).await {
        Ok(Some(was)) => was,
        Ok(None) => return Err(ApiError::Unauthorized),
        Err(PrefsError::Invalid(msg)) => return Err(ApiError::BadRequest(msg)),
        Err(PrefsError::Core(e)) => return Err(ApiError::internal(e)),
    };
    let profile = gripsou_core::repo::user::profile_by_id(&pool, user_id)
        .await?
        .ok_or(ApiError::Unauthorized)?;
    let enabled = profile.prefs.budget_ai_enabled;
    if enabled != was_enabled {
        tracing::info!(user_id = %user_id, enabled, "ai opt-in changed");
    }
    if enabled && !was_enabled {
        gripsou_jobs::request_categorize(pool.clone(), user_id);
    }
    Ok(Json(dto::SessionUser::from_profile(&profile)))
}

pub async fn update_profile(
    State(pool): State<PgPool>,
    AuthUser { user_id, .. }: AuthUser,
    Json(body): Json<dto::UpdateProfileReq>,
) -> Result<Json<dto::SessionUser>, ApiError> {
    let name = body.name.trim();
    let email = body.email.trim();
    if name.is_empty() || email.is_empty() {
        return Err(ApiError::bad_request("name and email are required"));
    }
    let profile = gripsou_core::repo::user::update_profile(&pool, user_id, name, email)
        .await
        .map_err(ApiError::conflict_on_unique("email is already in use"))?
        .ok_or(ApiError::Unauthorized)?;
    tracing::info!(user_id = %user_id, "profile changed");
    Ok(Json(dto::SessionUser::from_profile(&profile)))
}

pub async fn logout(
    State(pool): State<PgPool>,
    AuthUser {
        user_id,
        session_id,
    }: AuthUser,
) -> Result<StatusCode, ApiError> {
    gripsou_core::repo::session::delete(&pool, user_id, session_id).await?;
    tracing::info!(user_id = %user_id, "logout");
    Ok(StatusCode::NO_CONTENT)
}

pub async fn list_sessions(
    State(pool): State<PgPool>,
    AuthUser {
        user_id,
        session_id,
    }: AuthUser,
) -> Result<Json<Vec<dto::SessionDto>>, ApiError> {
    let rows = gripsou_core::repo::session::list_for_user(&pool, user_id).await?;
    Ok(Json(
        rows.into_iter()
            .map(|s| dto::SessionDto::from_row(s, session_id))
            .collect(),
    ))
}

pub async fn revoke_session(
    State(pool): State<PgPool>,
    AuthUser { user_id, .. }: AuthUser,
    Path(id): Path<Uuid>,
) -> Result<StatusCode, ApiError> {
    let deleted = gripsou_core::repo::session::delete(&pool, user_id, id).await?;
    if deleted {
        tracing::info!(user_id = %user_id, session_id = %id, "session revoked");
        Ok(StatusCode::NO_CONTENT)
    } else {
        Err(ApiError::NotFound("session not found"))
    }
}

pub async fn revoke_other_sessions(
    State(pool): State<PgPool>,
    AuthUser {
        user_id,
        session_id,
    }: AuthUser,
) -> Result<StatusCode, ApiError> {
    gripsou_core::repo::session::delete_others(&pool, user_id, session_id).await?;
    tracing::info!(user_id = %user_id, "other sessions revoked");
    Ok(StatusCode::NO_CONTENT)
}

pub async fn change_password(
    State(pool): State<PgPool>,
    State(throttle): State<std::sync::Arc<crate::throttle::LoginThrottle>>,
    headers: HeaderMap,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    AuthUser {
        user_id,
        session_id,
    }: AuthUser,
    Json(body): Json<dto::ChangePasswordReq>,
) -> Result<StatusCode, ApiError> {
    auth::validate_new_password(&body.new_password)?;
    crate::mfa::check_password(
        &pool,
        &throttle,
        &headers,
        peer,
        user_id,
        &body.current_password,
    )
    .await?;
    let new_hash = auth::hash_password(&body.new_password)?;
    gripsou_core::repo::user::update_password(&pool, user_id, &new_hash).await?;
    gripsou_core::repo::session::delete_others(&pool, user_id, session_id).await?;
    tracing::info!(user_id = %user_id, "password changed");
    Ok(StatusCode::NO_CONTENT)
}

pub async fn delete_account(
    State(pool): State<PgPool>,
    State(throttle): State<std::sync::Arc<crate::throttle::LoginThrottle>>,
    headers: HeaderMap,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    AuthUser { user_id, .. }: AuthUser,
    Json(body): Json<dto::DeleteAccountReq>,
) -> Result<StatusCode, ApiError> {
    crate::mfa::check_password(&pool, &throttle, &headers, peer, user_id, &body.password).await?;
    let profile = gripsou_core::repo::user::profile_by_id(&pool, user_id)
        .await?
        .ok_or(ApiError::Unauthorized)?;
    // Refuse to delete the last admin: doing so would lock everyone out of the
    // admin-only settings (user management, server config) for good.
    if profile.role == "admin" && gripsou_core::repo::user::count_admins(&pool).await? <= 1 {
        return Err(ApiError::Conflict("cannot delete the last admin"));
    }
    gripsou_core::repo::user::delete_user(&pool, user_id).await?;
    tracing::info!(user_id = %user_id, "account deleted");
    Ok(StatusCode::NO_CONTENT)
}

pub async fn create_invite(
    State(pool): State<PgPool>,
    AdminUser { user_id }: AdminUser,
) -> Result<(StatusCode, Json<dto::InviteLinkResp>), ApiError> {
    let raw = auth::generate_token();
    let stored = auth::hash_token_str(&raw);
    let expires_at = Utc::now() + Duration::hours(24);
    gripsou_core::repo::invite_token::create(&pool, "invite", None, user_id, &stored, expires_at)
        .await?;
    tracing::info!(by = %user_id, "invite created");
    Ok((
        StatusCode::CREATED,
        Json(dto::InviteLinkResp { token: raw }),
    ))
}

/// Redeeming a reset link clears the target's second factors, so creating one
/// needs a fresh reauth token, and never for oneself (Settings changes one's
/// own password): a stolen admin session must not get past two-factor.
pub async fn create_reset_link(
    State(pool): State<PgPool>,
    AdminUser { user_id }: AdminUser,
    Path(id): Path<Uuid>,
    Json(body): Json<dto::ReauthTokenReq>,
) -> Result<(StatusCode, Json<dto::InviteLinkResp>), ApiError> {
    if id == user_id {
        return Err(ApiError::bad_request(
            "cannot create a reset link for yourself",
        ));
    }
    let target = gripsou_core::repo::user::profile_by_id(&pool, id)
        .await?
        .ok_or(ApiError::NotFound("user not found"))?;
    crate::mfa::require_reauth(&pool, user_id, &body.reauth).await?;
    let raw = auth::generate_token();
    let stored = auth::hash_token_str(&raw);
    let expires_at = Utc::now() + Duration::hours(24);
    gripsou_core::repo::invite_token::create(
        &pool,
        "reset",
        Some(&target.email),
        user_id,
        &stored,
        expires_at,
    )
    .await?;
    tracing::info!(by = %user_id, target_user_id = %id, "reset link created");
    Ok((
        StatusCode::CREATED,
        Json(dto::InviteLinkResp { token: raw }),
    ))
}

pub async fn delete_user(
    State(pool): State<PgPool>,
    AdminUser { user_id }: AdminUser,
    Path(id): Path<Uuid>,
    Json(body): Json<dto::DeleteUserReq>,
) -> Result<StatusCode, ApiError> {
    let target = gripsou_core::repo::user::profile_by_id(&pool, id)
        .await?
        .ok_or(ApiError::NotFound("user not found"))?;
    // Confirm the typed email matches the user being deleted (case-insensitive).
    if body.email.trim().to_lowercase() != target.email.to_lowercase() {
        return Err(ApiError::bad_request("email does not match user"));
    }
    // Refuse to delete the last admin: it would lock everyone out of admin-only settings.
    if target.role == "admin" && gripsou_core::repo::user::count_admins(&pool).await? <= 1 {
        return Err(ApiError::Conflict("cannot delete the last admin"));
    }
    gripsou_core::repo::user::delete_user(&pool, id).await?;
    tracing::info!(by = %user_id, target_user_id = %id, "user deleted");
    Ok(StatusCode::NO_CONTENT)
}

pub async fn enabled_providers(
    State(pool): State<PgPool>,
    _auth: AuthUser,
) -> Result<Json<Vec<dto::EnabledProvider>>, ApiError> {
    let rows = gripsou_core::repo::provider::enabled_account_providers(&pool).await?;
    Ok(Json(
        rows.into_iter()
            .map(dto::EnabledProvider::from_row)
            .collect(),
    ))
}

pub async fn manage_connection(
    State(pool): State<PgPool>,
    State(key): State<crate::EncryptionKey>,
    AuthUser { user_id, .. }: AuthUser,
    Path(id): Path<Uuid>,
) -> Result<(HeaderMap, Json<serde_json::Value>), ApiError> {
    let conn = gripsou_core::repo::connection::connection_for_sync(&pool, user_id, id)
        .await?
        .ok_or(ApiError::NotFound("connection not found"))?;
    if !gripsou_jobs::supports_manage(&conn.provider_key) {
        return Err(ApiError::bad_request("connection management unavailable"));
    }
    let init = gripsou_jobs::manage_connection(&key, &conn)
        .await
        .map_err(|_| {
            // The temporary access URL and provider response must never enter logs.
            tracing::warn!(connection_id = %id, "connection management failed");
            ApiError::BadGateway("Unable to open connection management. Please try again.".into())
        })?;
    let mut headers = HeaderMap::new();
    headers.insert(
        axum::http::header::CACHE_CONTROL,
        "no-store".parse().unwrap(),
    );
    Ok((
        headers,
        Json(serde_json::json!({"redirectUrl": init.redirect_url})),
    ))
}

pub async fn init_connection(
    State(pool): State<PgPool>,
    AuthUser { user_id, .. }: AuthUser,
    Json(body): Json<dto::InitConnectionReq>,
) -> Result<(StatusCode, Json<dto::InitConnectionResp>), ApiError> {
    // Validate provider is enabled (also fetches display_name for the row).
    let enabled = gripsou_core::repo::provider::enabled_account_providers(&pool).await?;
    let provider = enabled
        .iter()
        .find(|p| p.key == body.provider_key)
        .ok_or_else(|| {
            ApiError::BadRequest(format!("provider '{}' is not enabled", body.provider_key))
        })?;

    match gripsou_jobs::init_connection(pool, user_id, &body.provider_key, &provider.display_name)
        .await
    {
        Ok((connection_id, init)) => Ok((
            StatusCode::CREATED,
            Json(dto::InitConnectionResp {
                connection_id: connection_id.to_string(),
                redirect_url: init.redirect_url,
            }),
        )),
        Err(e) => {
            tracing::warn!(provider = %body.provider_key, step = "init", error = %gripsou_core::logs::error_chain(&e), "connect failed");
            Err(ApiError::Internal)
        }
    }
}

pub async fn complete_connection(
    State(pool): State<PgPool>,
    State(key): State<crate::EncryptionKey>,
    AuthUser { user_id, .. }: AuthUser,
    Json(body): Json<dto::CompleteConnectionReq>,
) -> Result<StatusCode, ApiError> {
    let connection_id = body
        .connection_id
        .parse::<Uuid>()
        .map_err(|_| ApiError::bad_request("invalid connection_id"))?;

    use gripsou_jobs::CompleteError;
    match gripsou_jobs::complete_connection(pool, &key, user_id, connection_id, &body.params).await
    {
        Ok(()) => Ok(StatusCode::NO_CONTENT),
        Err(CompleteError::NotFound) => Err(ApiError::NotFound("connection not found")),
        Err(CompleteError::Provider(e)) => {
            tracing::warn!(connection_id = %connection_id, step = "complete", error = %gripsou_core::logs::error_chain(&e), "connect failed");
            Err(ApiError::BadRequest(e.to_string()))
        }
        Err(CompleteError::Internal(e)) => Err(ApiError::internal(e)),
    }
}

pub async fn webhook(
    State(pool): State<PgPool>,
    State(key): State<crate::EncryptionKey>,
    Path(provider): Path<String>,
    axum::extract::OriginalUri(uri): axum::extract::OriginalUri,
    headers: HeaderMap,
    body: axum::body::Bytes,
) -> StatusCode {
    use gripsou_jobs::WebhookOutcome;
    let hmap: std::collections::HashMap<String, String> = headers
        .iter()
        .filter_map(|(k, v)| {
            v.to_str()
                .ok()
                .map(|s| (k.as_str().to_lowercase(), s.to_string()))
        })
        .collect();
    match gripsou_jobs::handle_webhook(pool, &key, &provider, uri.path(), hmap, body.to_vec()).await
    {
        WebhookOutcome::Accepted => StatusCode::OK,
        WebhookOutcome::Unauthorized => StatusCode::UNAUTHORIZED,
        WebhookOutcome::NotFound => StatusCode::NOT_FOUND,
    }
}

/// Issue a session for `user_id` (30 days when remembered, else 1 day) and
/// build the login-shaped response. Shared by login, its second step, the
/// passkey sign-ins and the invite/reset redeem handlers. Logs nothing: each
/// caller words its own line.
pub(crate) async fn issue_session(
    pool: &PgPool,
    headers: &HeaderMap,
    peer: SocketAddr,
    user_id: Uuid,
    remember: bool,
) -> Result<dto::LoginResponse, ApiError> {
    let profile = gripsou_core::repo::user::profile_by_id(pool, user_id)
        .await?
        .ok_or_else(|| ApiError::internal("user vanished"))?;
    let token = auth::generate_token();
    let hash = auth::hash_token(&token);
    let user_agent = Some(user_agent(headers)).filter(|ua| !ua.is_empty());
    let ip = client_ip(headers, peer);
    let ttl = if remember {
        Duration::days(30)
    } else {
        Duration::days(1)
    };
    let expires_at = Utc::now() + ttl;
    gripsou_core::repo::session::create(
        pool,
        user_id,
        &hash,
        user_agent,
        Some(ip.as_str()),
        remember,
        expires_at,
    )
    .await?;
    Ok(dto::LoginResponse {
        token,
        user: dto::SessionUser::from_profile(&profile),
    })
}

/// Public: validate a token on page load so the frontend can redirect away from
/// `/invite` or `/reset` when it's invalid. 404 = unknown/expired/used.
pub async fn token_info(
    State(pool): State<PgPool>,
    Path(token): Path<String>,
) -> Result<Json<dto::TokenInfoResp>, ApiError> {
    let hash = auth::hash_token_str(&token);
    let info = gripsou_core::repo::invite_token::find_valid(&pool, &hash)
        .await?
        .ok_or(ApiError::NotFound("invalid token"))?;
    Ok(Json(dto::TokenInfoResp {
        token_type: info.token_type,
        email: info.email,
    }))
}

/// Public: redeem an invite — create the account and auto-log-in.
pub async fn redeem_invite(
    State(pool): State<PgPool>,
    headers: HeaderMap,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    Path(token): Path<String>,
    Json(body): Json<dto::RedeemInviteReq>,
) -> Result<Json<dto::LoginResponse>, ApiError> {
    let email = body.email.trim();
    let name = body.name.trim();
    if email.is_empty() || name.is_empty() {
        return Err(ApiError::bad_request("email and name are required"));
    }
    auth::validate_new_password(&body.password)?;
    let hash = auth::hash_token_str(&token);
    let pw_hash = auth::hash_password(&body.password)?;
    let user_id =
        gripsou_core::repo::invite_token::redeem_invite(&pool, &hash, email, name, &pw_hash)
            .await
            .map_err(ApiError::conflict_on_unique(
                "an account with this email already exists",
            ))?
            .ok_or(ApiError::NotFound("invalid token"))?;
    let resp = issue_session(&pool, &headers, peer, user_id, true).await?;
    tracing::info!(user_id = %user_id, "invite redeemed");
    Ok(Json(resp))
}

/// Public: redeem a reset — set the new password, revoke old sessions, auto-log-in.
pub async fn redeem_reset(
    State(pool): State<PgPool>,
    headers: HeaderMap,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    Path(token): Path<String>,
    Json(body): Json<dto::RedeemResetReq>,
) -> Result<Json<dto::LoginResponse>, ApiError> {
    auth::validate_new_password(&body.password)?;
    let hash = auth::hash_token_str(&token);
    let pw_hash = auth::hash_password(&body.password)?;
    let (user_id, cleared) = gripsou_core::repo::invite_token::redeem_reset(&pool, &hash, &pw_hash)
        .await?
        .ok_or(ApiError::NotFound("invalid token"))?;
    if cleared.any() {
        tracing::info!(user_id = %user_id, reason = "reset", "second factors cleared");
    }
    let resp = issue_session(&pool, &headers, peer, user_id, true).await?;
    tracing::info!(user_id = %user_id, "reset link redeemed");
    Ok(Json(resp))
}

pub async fn delete_connection(
    State(pool): State<PgPool>,
    AuthUser { user_id, .. }: AuthUser,
    Path(id): Path<Uuid>,
) -> Result<StatusCode, ApiError> {
    let deleted = gripsou_core::repo::connection::delete_connection(&pool, user_id, id).await?;
    if deleted {
        tracing::info!(user_id = %user_id, connection_id = %id, "connection deleted");
        Ok(StatusCode::NO_CONTENT)
    } else {
        Err(ApiError::NotFound("connection not found"))
    }
}

#[cfg(test)]
pub(crate) mod auth_tests {
    use super::*;
    use crate::auth;
    use crate::dto::{ChangePasswordReq, LoginReq};
    use crate::testkit::seed_user_with_password;
    use crate::throttle::LoginThrottle;
    use axum::response::IntoResponse;
    use gripsou_core::testkit::encryption_key as test_key;
    use serde_json::json;
    use sqlx::PgPool;
    use std::sync::Arc;

    #[test]
    fn client_ip_takes_the_hop_the_nearest_proxy_wrote() {
        let peer: SocketAddr = "10.0.0.9:443".parse().unwrap();
        let mut h = HeaderMap::new();
        assert_eq!(client_ip(&h, peer), "10.0.0.9");
        h.insert("x-real-ip", "6.6.6.6".parse().unwrap());
        assert_eq!(client_ip(&h, peer), "10.0.0.9");
        h.insert("x-forwarded-for", "6.6.6.6, 203.0.113.7".parse().unwrap());
        assert_eq!(client_ip(&h, peer), "203.0.113.7");
    }

    fn no_throttle() -> State<Arc<LoginThrottle>> {
        State(Arc::new(LoginThrottle::default()))
    }

    async fn try_login(
        pool: &PgPool,
        throttle: &Arc<LoginThrottle>,
        email: &str,
        pw: &str,
    ) -> Result<Json<dto::LoginOutcome>, ApiError> {
        login(
            State(pool.clone()),
            State(throttle.clone()),
            axum::http::HeaderMap::new(),
            axum::extract::ConnectInfo("127.0.0.1:0".parse().unwrap()),
            Json(LoginReq {
                email: email.into(),
                password: pw.into(),
                remember: false,
            }),
        )
        .await
    }

    #[sqlx::test(migrations = "../migrations")]
    async fn sixth_attempt_after_five_failures_is_refused_with_retry_after(pool: PgPool) {
        seed_admin(&pool, "a@t.local", "hunter22").await;
        let throttle = Arc::new(LoginThrottle::default());
        for _ in 0..5 {
            let err = try_login(&pool, &throttle, "a@t.local", "wrong")
                .await
                .unwrap_err();
            assert_eq!(err.status(), StatusCode::UNAUTHORIZED);
        }
        // Even the right password waits: the check happens before any verify.
        let err = try_login(&pool, &throttle, "a@t.local", "hunter22")
            .await
            .unwrap_err();
        assert_eq!(err.status(), StatusCode::TOO_MANY_REQUESTS);
        assert!(
            matches!(err, ApiError::TooMany { retry_after } if (1..=60).contains(&retry_after))
        );
        let resp = err.into_response();
        assert!(resp.headers().contains_key(axum::http::header::RETRY_AFTER));
    }

    #[sqlx::test(migrations = "../migrations")]
    async fn a_successful_login_clears_earlier_failures(pool: PgPool) {
        seed_admin(&pool, "a@t.local", "hunter22").await;
        let throttle = Arc::new(LoginThrottle::default());
        for _ in 0..4 {
            try_login(&pool, &throttle, "a@t.local", "wrong")
                .await
                .unwrap_err();
        }
        let _ = try_login(&pool, &throttle, "a@t.local", "hunter22")
            .await
            .expect("login ok");
        for _ in 0..4 {
            let err = try_login(&pool, &throttle, "a@t.local", "wrong")
                .await
                .unwrap_err();
            assert_eq!(err.status(), StatusCode::UNAUTHORIZED);
        }
    }

    #[sqlx::test(migrations = "../migrations")]
    async fn unknown_emails_are_throttled_like_real_ones(pool: PgPool) {
        let throttle = Arc::new(LoginThrottle::default());
        for _ in 0..5 {
            try_login(&pool, &throttle, "nobody@t.local", "x")
                .await
                .unwrap_err();
        }
        let err = try_login(&pool, &throttle, "nobody@t.local", "x")
            .await
            .unwrap_err();
        assert_eq!(err.status(), StatusCode::TOO_MANY_REQUESTS);
    }

    /// A burst sent all at once gets no more guesses than the same requests
    /// sent one by one: each attempt is counted before the password is checked.
    #[sqlx::test(migrations = "../migrations")]
    async fn a_concurrent_burst_gets_only_the_free_attempts(pool: PgPool) {
        seed_admin(&pool, "a@t.local", "hunter22").await;
        let throttle = Arc::new(LoginThrottle::default());
        let mut set = tokio::task::JoinSet::new();
        for _ in 0..10 {
            let (pool, throttle) = (pool.clone(), throttle.clone());
            set.spawn(async move {
                try_login(&pool, &throttle, "a@t.local", "wrong")
                    .await
                    .unwrap_err()
                    .status()
            });
        }
        let statuses = set.join_all().await;
        let count = |s| statuses.iter().filter(|&&x| x == s).count();
        assert_eq!(count(StatusCode::UNAUTHORIZED), 5, "{statuses:?}");
        assert_eq!(count(StatusCode::TOO_MANY_REQUESTS), 5, "{statuses:?}");
    }

    /// An oversized email is refused like a wrong one, before it can become a
    /// throttle key (or a log field).
    #[sqlx::test(migrations = "../migrations")]
    async fn an_oversized_email_is_refused_without_counting(pool: PgPool) {
        let throttle = Arc::new(LoginThrottle::default());
        let email = format!("{}@t.local", "a".repeat(292));
        assert_eq!(email.len(), 300);
        for _ in 0..6 {
            let err = try_login(&pool, &throttle, &email, "x").await.unwrap_err();
            assert_eq!(err.status(), StatusCode::UNAUTHORIZED);
            assert_eq!(err.message(), "invalid email or password");
        }
        assert_eq!(throttle.tracked_keys(), (0, 0));
    }

    /// Enrol TOTP for `user_id` with a secret encrypted under the test key and
    /// ten recovery codes; returns the secret and the plain recovery codes.
    pub(crate) async fn enable_totp(pool: &PgPool, user_id: Uuid) -> (Vec<u8>, Vec<String>) {
        use gripsou_core::repo::mfa;
        let secret = crate::factors::new_totp_secret();
        let enc = test_key().encrypt(&secret).unwrap();
        assert!(
            mfa::upsert_unconfirmed_totp(pool, user_id, &enc)
                .await
                .unwrap()
        );
        let codes = crate::factors::new_recovery_codes();
        let hashes: Vec<Vec<u8>> = codes
            .iter()
            .map(|c| crate::factors::hash_recovery_code(c))
            .collect();
        assert!(
            mfa::confirm_totp(pool, user_id, &enc, 0, &hashes)
                .await
                .unwrap()
        );
        (secret, codes)
    }

    fn now_code(secret: &[u8]) -> String {
        let now = Utc::now().timestamp() as u64;
        crate::factors::totp_code(secret, crate::factors::current_step(now))
    }

    /// The two limiters a login goes through, shared across a test's calls.
    #[derive(Default)]
    pub(crate) struct Throttles {
        pub(crate) pw: Arc<LoginThrottle>,
        pub(crate) sf: Arc<crate::throttle::SecondFactorThrottle>,
    }

    pub(crate) async fn login_outcome(
        pool: &PgPool,
        throttle: &Throttles,
        email: &str,
        pw: &str,
        remember: bool,
    ) -> dto::LoginOutcome {
        login(
            State(pool.clone()),
            State(throttle.pw.clone()),
            axum::http::HeaderMap::new(),
            axum::extract::ConnectInfo("127.0.0.1:0".parse().unwrap()),
            Json(LoginReq {
                email: email.into(),
                password: pw.into(),
                remember,
            }),
        )
        .await
        .expect("login ok")
        .0
    }

    async fn mfa_challenge(pool: &PgPool, throttle: &Throttles, remember: bool) -> String {
        match login_outcome(pool, throttle, "a@t.local", "hunter22", remember).await {
            dto::LoginOutcome::Mfa(m) => m.challenge,
            other => panic!("expected mfa, got {other:?}"),
        }
    }

    async fn verify(
        pool: &PgPool,
        throttle: &Throttles,
        challenge: &str,
        totp: Option<String>,
        recovery: Option<String>,
    ) -> Result<Json<dto::LoginResponse>, ApiError> {
        login_verify(
            State(pool.clone()),
            State(throttle.pw.clone()),
            State(throttle.sf.clone()),
            State(test_key()),
            axum::http::HeaderMap::new(),
            axum::extract::ConnectInfo("127.0.0.1:0".parse().unwrap()),
            Json(dto::LoginVerifyReq {
                challenge: challenge.into(),
                totp,
                recovery_code: recovery,
            }),
        )
        .await
    }

    async fn session_count(pool: &PgPool, user_id: Uuid) -> i64 {
        sqlx::query_scalar("select count(*) from session where user_id = $1")
            .bind(user_id)
            .fetch_one(pool)
            .await
            .unwrap()
    }

    #[sqlx::test(migrations = "../migrations")]
    async fn login_without_second_factor_gives_a_session(pool: PgPool) {
        let uid = seed_admin(&pool, "a@t.local", "hunter22").await;
        let throttle = Throttles::default();
        let out = login_outcome(&pool, &throttle, "a@t.local", "hunter22", false).await;
        assert!(matches!(out, dto::LoginOutcome::Session(_)));
        assert_eq!(session_count(&pool, uid).await, 1);
    }

    #[sqlx::test(migrations = "../migrations")]
    async fn login_with_totp_asks_for_a_code_and_makes_no_session(pool: PgPool) {
        let uid = seed_admin(&pool, "a@t.local", "hunter22").await;
        enable_totp(&pool, uid).await;
        let throttle = Throttles::default();
        match login_outcome(&pool, &throttle, "a@t.local", "hunter22", false).await {
            dto::LoginOutcome::Mfa(m) => {
                assert!(m.mfa_required);
                assert!(!m.challenge.is_empty());
            }
            other => panic!("expected mfa, got {other:?}"),
        }
        assert_eq!(session_count(&pool, uid).await, 0);
    }

    #[sqlx::test(migrations = "../migrations")]
    async fn correct_totp_gives_a_session_that_keeps_remember(pool: PgPool) {
        let uid = seed_admin(&pool, "a@t.local", "hunter22").await;
        let (secret, _) = enable_totp(&pool, uid).await;
        let throttle = Throttles::default();
        let ch = mfa_challenge(&pool, &throttle, true).await;
        let resp = verify(&pool, &throttle, &ch, Some(now_code(&secret)), None)
            .await
            .expect("verify ok");
        assert_eq!(resp.0.user.email, "a@t.local");
        let remembered: bool =
            sqlx::query_scalar("select remembered from session where user_id = $1")
                .bind(uid)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert!(remembered);
        assert_eq!(session_count(&pool, uid).await, 1);
    }

    #[sqlx::test(migrations = "../migrations")]
    async fn a_totp_code_works_once(pool: PgPool) {
        let uid = seed_admin(&pool, "a@t.local", "hunter22").await;
        let (secret, _) = enable_totp(&pool, uid).await;
        let throttle = Throttles::default();
        let code = now_code(&secret);
        let ch = mfa_challenge(&pool, &throttle, false).await;
        let _ = verify(&pool, &throttle, &ch, Some(code.clone()), None)
            .await
            .expect("first use");
        let ch = mfa_challenge(&pool, &throttle, false).await;
        let err = verify(&pool, &throttle, &ch, Some(code), None)
            .await
            .unwrap_err();
        assert_eq!(err.status(), StatusCode::BAD_REQUEST);
    }

    #[sqlx::test(migrations = "../migrations")]
    async fn a_wrong_code_keeps_the_challenge(pool: PgPool) {
        let uid = seed_admin(&pool, "a@t.local", "hunter22").await;
        let (secret, _) = enable_totp(&pool, uid).await;
        let throttle = Throttles::default();
        let ch = mfa_challenge(&pool, &throttle, false).await;
        let wrong = if now_code(&secret) == "000000" {
            "000001"
        } else {
            "000000"
        };
        let err = verify(&pool, &throttle, &ch, Some(wrong.into()), None)
            .await
            .unwrap_err();
        assert_eq!(
            (err.status(), err.message()),
            (StatusCode::BAD_REQUEST, "invalid code")
        );
        let _ = verify(&pool, &throttle, &ch, Some(now_code(&secret)), None)
            .await
            .expect("right code on the same challenge");
    }

    #[sqlx::test(migrations = "../migrations")]
    async fn exactly_one_code_kind_is_required(pool: PgPool) {
        let uid = seed_admin(&pool, "a@t.local", "hunter22").await;
        enable_totp(&pool, uid).await;
        let throttle = Throttles::default();
        let ch = mfa_challenge(&pool, &throttle, false).await;
        let none = verify(&pool, &throttle, &ch, None, None).await.unwrap_err();
        assert_eq!(
            (none.status(), none.message()),
            (StatusCode::BAD_REQUEST, "code required")
        );
        let both = verify(&pool, &throttle, &ch, Some("1".into()), Some("x".into()))
            .await
            .unwrap_err();
        assert_eq!(both.message(), "code required");
    }

    #[sqlx::test(migrations = "../migrations")]
    async fn a_recovery_code_works_once(pool: PgPool) {
        let uid = seed_admin(&pool, "a@t.local", "hunter22").await;
        let (_, codes) = enable_totp(&pool, uid).await;
        let throttle = Throttles::default();
        let ch = mfa_challenge(&pool, &throttle, false).await;
        let _ = verify(&pool, &throttle, &ch, None, Some(codes[0].clone()))
            .await
            .expect("recovery ok");
        let status = gripsou_core::repo::mfa::status(&pool, uid).await.unwrap();
        assert_eq!(status.recovery_remaining, 9);
        let ch = mfa_challenge(&pool, &throttle, false).await;
        let err = verify(&pool, &throttle, &ch, None, Some(codes[0].clone()))
            .await
            .unwrap_err();
        assert_eq!(err.status(), StatusCode::BAD_REQUEST);
    }

    #[sqlx::test(migrations = "../migrations")]
    async fn unusable_challenges_are_refused(pool: PgPool) {
        use gripsou_core::repo::login_challenge;
        let uid = seed_admin(&pool, "a@t.local", "hunter22").await;
        let (secret, _) = enable_totp(&pool, uid).await;
        let throttle = Throttles::default();
        let code = now_code(&secret);

        let err = verify(&pool, &throttle, "nope", Some(code.clone()), None)
            .await
            .unwrap_err();
        assert_eq!(
            (err.status(), err.message()),
            (StatusCode::GONE, "challenge expired")
        );

        login_challenge::create(
            &pool,
            &auth::hash_token("re"),
            Some(uid),
            "reauth",
            serde_json::json!({}),
        )
        .await
        .unwrap();
        let err = verify(&pool, &throttle, "re", Some(code.clone()), None)
            .await
            .unwrap_err();
        assert_eq!(err.status(), StatusCode::GONE);

        let ch = mfa_challenge(&pool, &throttle, false).await;
        sqlx::query("update login_challenge set expires_at = now() - interval '1 minute' where token_hash = $1")
            .bind(auth::hash_token(&ch))
            .execute(&pool)
            .await
            .unwrap();
        let err = verify(&pool, &throttle, &ch, Some(code.clone()), None)
            .await
            .unwrap_err();
        assert_eq!(err.status(), StatusCode::GONE);

        let ch = mfa_challenge(&pool, &throttle, false).await;
        let _ = verify(&pool, &throttle, &ch, Some(code), None)
            .await
            .expect("first use");
        let err = verify(&pool, &throttle, &ch, Some("123456".into()), None)
            .await
            .unwrap_err();
        assert_eq!(err.status(), StatusCode::GONE);
    }

    #[sqlx::test(migrations = "../migrations")]
    async fn wrong_codes_are_throttled(pool: PgPool) {
        use gripsou_core::repo::login_challenge;
        let uid = seed_admin(&pool, "a@t.local", "hunter22").await;
        enable_totp(&pool, uid).await;
        let throttle = Throttles::default();
        // Issued directly: `login` itself counts one attempt.
        login_challenge::create(
            &pool,
            &auth::hash_token("ch"),
            Some(uid),
            "mfa",
            serde_json::json!({}),
        )
        .await
        .unwrap();
        for _ in 0..5 {
            let err = verify(&pool, &throttle, "ch", Some("000000".into()), None)
                .await
                .unwrap_err();
            assert_eq!(err.status(), StatusCode::BAD_REQUEST);
        }
        let err = verify(&pool, &throttle, "ch", Some("000000".into()), None)
            .await
            .unwrap_err();
        assert_eq!(err.status(), StatusCode::TOO_MANY_REQUESTS);
        assert!(
            err.into_response()
                .headers()
                .contains_key(axum::http::header::RETRY_AFTER)
        );
    }

    /// Wrong codes wait on the second-factor limiter (logged once with that
    /// reason), while the password step of the same account is not slowed.
    #[sqlx::test(migrations = "../migrations")]
    async fn wrong_codes_wait_on_the_second_factor_limiter(pool: PgPool) {
        let (_g, mut writer) = gripsou_core::logs::capture(1000);
        let uid = seed_admin(&pool, "a@t.local", "hunter22").await;
        let (secret, _) = enable_totp(&pool, uid).await;
        let throttle = Throttles::default();
        let ch = mfa_challenge(&pool, &throttle, false).await;
        let wrong = if now_code(&secret) == "000000" {
            "000001"
        } else {
            "000000"
        };
        for _ in 0..5 {
            let err = verify(&pool, &throttle, &ch, Some(wrong.into()), None)
                .await
                .unwrap_err();
            assert_eq!(err.status(), StatusCode::BAD_REQUEST);
        }
        for _ in 0..3 {
            let err = verify(&pool, &throttle, &ch, Some(now_code(&secret)), None)
                .await
                .unwrap_err();
            assert_eq!(err.status(), StatusCode::TOO_MANY_REQUESTS);
            assert_eq!(err, ApiError::TooMany { retry_after: 60 });
        }
        // The password step still answers (a fresh challenge), not 429.
        let _ = mfa_challenge(&pool, &throttle, false).await;
        writer.flush(&pool).await;
        let reasons: Vec<String> = sqlx::query_scalar(
            "select fields->>'reason' from log where message = 'login throttled'",
        )
        .fetch_all(&pool)
        .await
        .unwrap();
        assert_eq!(reasons, vec!["second_factor".to_string()]);
    }

    /// A request that loses the challenge to a parallel one keeps its backup
    /// code unspent.
    #[sqlx::test(migrations = "../migrations")]
    async fn a_lost_challenge_does_not_burn_a_backup_code(pool: PgPool) {
        use gripsou_core::repo::login_challenge;
        let uid = seed_admin(&pool, "a@t.local", "hunter22").await;
        let (_, codes) = enable_totp(&pool, uid).await;
        let throttle = Throttles::default();
        let ch = mfa_challenge(&pool, &throttle, false).await;
        // A parallel request holds the challenge, not yet committed.
        let mut winner = pool.begin().await.unwrap();
        assert!(
            login_challenge::consume(&mut *winner, &auth::hash_token(&ch), "mfa")
                .await
                .unwrap()
                .is_some()
        );
        let loser = {
            let (pool, ch, code) = (pool.clone(), ch.clone(), codes[0].clone());
            tokio::spawn(async move {
                verify(&pool, &Throttles::default(), &ch, None, Some(code)).await
            })
        };
        tokio::time::sleep(std::time::Duration::from_millis(300)).await;
        winner.commit().await.unwrap();
        let err = loser.await.unwrap().unwrap_err();
        assert_eq!(err.status(), StatusCode::GONE);
        let status = gripsou_core::repo::mfa::status(&pool, uid).await.unwrap();
        assert_eq!(status.recovery_remaining, 10);
    }

    /// A wrong backup code leaves the challenge usable.
    #[sqlx::test(migrations = "../migrations")]
    async fn a_wrong_backup_code_keeps_the_challenge(pool: PgPool) {
        let uid = seed_admin(&pool, "a@t.local", "hunter22").await;
        let (_, codes) = enable_totp(&pool, uid).await;
        let throttle = Throttles::default();
        let ch = mfa_challenge(&pool, &throttle, false).await;
        let err = verify(&pool, &throttle, &ch, None, Some("nope-nope".into()))
            .await
            .unwrap_err();
        assert_eq!(err.status(), StatusCode::BAD_REQUEST);
        let _ = verify(&pool, &throttle, &ch, None, Some(codes[1].clone()))
            .await
            .expect("right code on the same challenge");
    }

    /// Seed an admin user and return their id — mirrors what `seed_user` does for
    /// the existing tests (role "admin", email "a@t.local").
    async fn seed_admin_user(pool: &PgPool) -> Uuid {
        seed_admin(pool, "a@t.local", "hunter2").await
    }

    async fn seed_admin(pool: &PgPool, email: &str, password: &str) -> Uuid {
        seed_user_with_password(pool, email, password, "admin").await
    }

    async fn login_token(pool: &PgPool, email: &str, pw: &str) -> String {
        let outcome = login(
            State(pool.clone()),
            no_throttle(),
            axum::http::HeaderMap::new(),
            axum::extract::ConnectInfo("127.0.0.1:0".parse().unwrap()),
            Json(LoginReq {
                email: email.into(),
                password: pw.into(),
                remember: false,
            }),
        )
        .await
        .expect("login ok");
        session_of(outcome).token
    }

    fn session_of(outcome: Json<dto::LoginOutcome>) -> dto::LoginResponse {
        match outcome.0 {
            dto::LoginOutcome::Session(r) => r,
            other => panic!("expected a session, got {other:?}"),
        }
    }

    #[sqlx::test(migrations = "../migrations")]
    async fn investment_returns_lists_accounts_with_securities(pool: PgPool) {
        let user_id = seed_admin(&pool, "a@t.local", "hunter2").await;
        let conn_id = Uuid::new_v4();
        sqlx::query(
            "insert into connection (id, user_id, provider_key, display_name) \
             values ($1, $2, 'powens', 'Test')",
        )
        .bind(conn_id)
        .bind(user_id)
        .execute(&pool)
        .await
        .unwrap();
        let account_id: Uuid = sqlx::query_scalar(
            "insert into account (connection_id, external_id, name, type_key, currency, color) \
             values ($1, 'a1', 'PEA', 'pea', 'EUR', '#4dd0b1') returning id",
        )
        .bind(conn_id)
        .fetch_one(&pool)
        .await
        .unwrap();
        let instrument_id: Uuid = sqlx::query_scalar(
            "insert into instrument (kind, symbol, name, currency) \
             values ('equity', 'WLDX', 'World ETF', 'EUR') returning id",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        let holding_id: Uuid = sqlx::query_scalar(
            "insert into holding (account_id, instrument_id, quantity, cost_basis) \
             values ($1, $2, 2, 200) returning id",
        )
        .bind(account_id)
        .bind(instrument_id)
        .fetch_one(&pool)
        .await
        .unwrap();
        sqlx::query(
            "insert into lot (holding_id, side, acquired_on, quantity, unit_price, fee, source) \
             values ($1, 'buy', current_date - 365, 2, 100, 0, 'manual')",
        )
        .bind(holding_id)
        .execute(&pool)
        .await
        .unwrap();

        // `accounts` values from snapshots, as after any real sync.
        sqlx::query(
            "insert into holding_snapshot (holding_id, as_of, quantity, value) \
             values ($1, current_date, 2, 220)",
        )
        .bind(holding_id)
        .execute(&pool)
        .await
        .unwrap();

        let resp = investment_returns(
            State(pool.clone()),
            auth::AuthUser {
                user_id,
                session_id: Uuid::new_v4(),
            },
        )
        .await
        .expect("returns ok");

        assert_eq!(resp.0.accounts.len(), 1);
        let a = &resp.0.accounts[0];
        assert_eq!(a.name, "PEA");
        assert!(a.missing.is_empty());
        // Compared as numbers: numeric division can widen the string's scale.
        assert_eq!(
            a.figures.invested.parse::<Decimal>().unwrap(),
            Decimal::from(200)
        );
        assert!(a.figures.since.is_some());
    }

    /// Login (ok and failed) and invite creation are logged, and no saved line
    /// carries the password, the attempted password or the invite token.
    #[sqlx::test(migrations = "../migrations")]
    async fn account_lines_are_saved_without_secrets(pool: PgPool) {
        let (_g, mut writer) = gripsou_core::logs::capture(1000);

        let password = "correct horse battery staple";
        let admin = seed_admin(&pool, "log@t.local", password).await;
        login_token(&pool, "log@t.local", password).await;
        let mut ua = axum::http::HeaderMap::new();
        ua.insert(
            axum::http::header::USER_AGENT,
            "test-agent/1".parse().unwrap(),
        );
        let failed = login(
            State(pool.clone()),
            no_throttle(),
            ua,
            axum::extract::ConnectInfo("127.0.0.1:0".parse().unwrap()),
            Json(LoginReq {
                email: "log@t.local".into(),
                password: "wrong-pass".into(),
                remember: false,
            }),
        )
        .await;
        assert!(failed.is_err());
        let (_, Json(invite)) = create_invite(State(pool.clone()), AdminUser { user_id: admin })
            .await
            .unwrap();
        writer.flush(&pool).await;

        let rows: Vec<(String, serde_json::Value)> =
            sqlx::query_as("select message, fields from log")
                .fetch_all(&pool)
                .await
                .unwrap();
        let messages: Vec<&str> = rows.iter().map(|(m, _)| m.as_str()).collect();
        assert!(messages.contains(&"login succeeded"));
        let (_, failed_line) = rows.iter().find(|(m, _)| m == "login failed").unwrap();
        assert_eq!(failed_line["user_agent"], "test-agent/1");
        assert!(messages.contains(&"invite created"));
        let all = serde_json::to_string(&rows).unwrap();
        assert!(!all.contains(password), "password leaked into the log");
        assert!(
            !all.contains("wrong-pass"),
            "attempted password leaked into the log"
        );
        assert!(
            !all.contains(&invite.token),
            "invite token leaked into the log"
        );
    }

    #[sqlx::test(migrations = "../migrations")]
    async fn login_succeeds_with_good_credentials(pool: PgPool) {
        seed_admin(&pool, "a@t.local", "hunter2").await;

        let resp = login(
            State(pool.clone()),
            no_throttle(),
            axum::http::HeaderMap::new(),
            axum::extract::ConnectInfo("127.0.0.1:0".parse().unwrap()),
            Json(LoginReq {
                email: "a@t.local".into(),
                password: "hunter2".into(),
                remember: true,
            }),
        )
        .await
        .expect("login ok");
        let resp = session_of(resp);
        assert!(!resp.token.is_empty());
        assert_eq!(resp.user.email, "a@t.local");
    }

    #[sqlx::test(migrations = "../migrations")]
    async fn login_rejects_bad_password(pool: PgPool) {
        seed_admin(&pool, "a@t.local", "hunter2").await;

        let err = login(
            State(pool.clone()),
            no_throttle(),
            axum::http::HeaderMap::new(),
            axum::extract::ConnectInfo("127.0.0.1:0".parse().unwrap()),
            Json(LoginReq {
                email: "a@t.local".into(),
                password: "wrong".into(),
                remember: false,
            }),
        )
        .await
        .unwrap_err();
        assert_eq!(err.status(), StatusCode::UNAUTHORIZED);
    }

    #[sqlx::test(migrations = "../migrations")]
    async fn login_creates_findable_session(pool: PgPool) {
        seed_admin(&pool, "a@t.local", "hunter2").await;
        let resp = login(
            State(pool.clone()),
            no_throttle(),
            axum::http::HeaderMap::new(),
            axum::extract::ConnectInfo("127.0.0.1:0".parse().unwrap()),
            Json(LoginReq {
                email: "a@t.local".into(),
                password: "hunter2".into(),
                remember: false,
            }),
        )
        .await
        .expect("login ok");

        let hash = auth::hash_token(&session_of(resp).token);
        let session = gripsou_core::repo::session::find_valid_by_hash(&pool, &hash)
            .await
            .unwrap();
        assert!(session.is_some());
    }

    #[sqlx::test(migrations = "../migrations")]
    async fn me_returns_profile_and_logout_revokes(pool: PgPool) {
        seed_admin(&pool, "a@t.local", "hunter2").await;
        let token = login_token(&pool, "a@t.local", "hunter2").await;
        let session =
            gripsou_core::repo::session::find_valid_by_hash(&pool, &auth::hash_token(&token))
                .await
                .unwrap()
                .unwrap();
        let principal = auth::AuthUser {
            user_id: session.user_id,
            session_id: session.id,
        };

        let me_resp = me(
            State(pool.clone()),
            auth::AuthUser {
                user_id: principal.user_id,
                session_id: principal.session_id,
            },
        )
        .await
        .expect("me ok");
        assert_eq!(me_resp.0.email, "a@t.local");

        logout(
            State(pool.clone()),
            auth::AuthUser {
                user_id: principal.user_id,
                session_id: principal.session_id,
            },
        )
        .await
        .expect("logout ok");
        assert!(
            gripsou_core::repo::session::find_valid_by_hash(&pool, &auth::hash_token(&token))
                .await
                .unwrap()
                .is_none()
        );
    }

    #[sqlx::test(migrations = "../migrations")]
    async fn lists_marks_current_and_revokes(pool: PgPool) {
        seed_admin(&pool, "a@t.local", "hunter2").await;
        let t1 = login_token(&pool, "a@t.local", "hunter2").await;
        let t2 = login_token(&pool, "a@t.local", "hunter2").await;
        let s1 = gripsou_core::repo::session::find_valid_by_hash(&pool, &auth::hash_token(&t1))
            .await
            .unwrap()
            .unwrap();
        let s2 = gripsou_core::repo::session::find_valid_by_hash(&pool, &auth::hash_token(&t2))
            .await
            .unwrap()
            .unwrap();
        let principal = auth::AuthUser {
            user_id: s1.user_id,
            session_id: s1.id,
        };

        let list = list_sessions(
            State(pool.clone()),
            auth::AuthUser {
                user_id: principal.user_id,
                session_id: principal.session_id,
            },
        )
        .await
        .unwrap()
        .0;
        assert_eq!(list.len(), 2);
        assert!(
            list.iter()
                .find(|d| d.id == s1.id.to_string())
                .unwrap()
                .current
        );
        assert!(
            !list
                .iter()
                .find(|d| d.id == s2.id.to_string())
                .unwrap()
                .current
        );

        // revoke the other one
        revoke_session(
            State(pool.clone()),
            auth::AuthUser {
                user_id: principal.user_id,
                session_id: principal.session_id,
            },
            axum::extract::Path(s2.id),
        )
        .await
        .unwrap();
        assert_eq!(
            list_sessions(
                State(pool.clone()),
                auth::AuthUser {
                    user_id: principal.user_id,
                    session_id: principal.session_id
                }
            )
            .await
            .unwrap()
            .0
            .len(),
            1
        );
    }

    #[sqlx::test(migrations = "../migrations")]
    async fn change_password_revokes_other_sessions(pool: PgPool) {
        seed_admin(&pool, "a@t.local", "old-pass").await;
        let current = login_token(&pool, "a@t.local", "old-pass").await;
        let other = login_token(&pool, "a@t.local", "old-pass").await;
        let cur =
            gripsou_core::repo::session::find_valid_by_hash(&pool, &auth::hash_token(&current))
                .await
                .unwrap()
                .unwrap();

        change_password(
            State(pool.clone()),
            no_throttle(),
            axum::http::HeaderMap::new(),
            axum::extract::ConnectInfo("127.0.0.1:0".parse().unwrap()),
            auth::AuthUser {
                user_id: cur.user_id,
                session_id: cur.id,
            },
            Json(ChangePasswordReq {
                current_password: "old-pass".into(),
                new_password: "new-pass".into(),
            }),
        )
        .await
        .expect("change ok");

        // other session gone, current still valid
        assert!(
            gripsou_core::repo::session::find_valid_by_hash(&pool, &auth::hash_token(&other))
                .await
                .unwrap()
                .is_none()
        );
        assert!(
            gripsou_core::repo::session::find_valid_by_hash(&pool, &auth::hash_token(&current))
                .await
                .unwrap()
                .is_some()
        );

        let hash = gripsou_core::repo::user::password_hash(&pool, cur.user_id)
            .await
            .unwrap()
            .unwrap();
        assert!(auth::verify_password("new-pass", &hash));
    }

    #[sqlx::test(migrations = "../migrations")]
    async fn delete_account_requires_the_password(pool: PgPool) {
        // A non-admin user, so the last-admin guard is not in play here.
        seed_user_with_password(&pool, "a@t.local", "hunter2", "user").await;
        let token = login_token(&pool, "a@t.local", "hunter2").await;
        let session =
            gripsou_core::repo::session::find_valid_by_hash(&pool, &auth::hash_token(&token))
                .await
                .unwrap()
                .unwrap();
        let principal = auth::AuthUser {
            user_id: session.user_id,
            session_id: session.id,
        };

        // A wrong password is rejected and the user/session survive.
        let bad = delete_account(
            State(pool.clone()),
            no_throttle(),
            axum::http::HeaderMap::new(),
            axum::extract::ConnectInfo("127.0.0.1:0".parse().unwrap()),
            auth::AuthUser {
                user_id: principal.user_id,
                session_id: principal.session_id,
            },
            Json(dto::DeleteAccountReq {
                password: "wrong".into(),
            }),
        )
        .await
        .unwrap_err();
        assert_eq!(bad.status(), StatusCode::BAD_REQUEST);
        assert!(
            gripsou_core::repo::session::find_valid_by_hash(&pool, &auth::hash_token(&token))
                .await
                .unwrap()
                .is_some()
        );

        // The right password deletes the user; the session is gone via FK cascade.
        delete_account(
            State(pool.clone()),
            no_throttle(),
            axum::http::HeaderMap::new(),
            axum::extract::ConnectInfo("127.0.0.1:0".parse().unwrap()),
            auth::AuthUser {
                user_id: principal.user_id,
                session_id: principal.session_id,
            },
            Json(dto::DeleteAccountReq {
                password: "hunter2".into(),
            }),
        )
        .await
        .expect("delete ok");
        assert!(
            gripsou_core::repo::session::find_valid_by_hash(&pool, &auth::hash_token(&token))
                .await
                .unwrap()
                .is_none()
        );
        assert!(
            gripsou_core::repo::user::profile_by_id(&pool, principal.user_id)
                .await
                .unwrap()
                .is_none()
        );
    }

    #[sqlx::test(migrations = "../migrations")]
    async fn delete_account_refuses_last_admin(pool: PgPool) {
        seed_user_with_password(&pool, "boss@t.local", "pw", "admin").await;
        let token = login_token(&pool, "boss@t.local", "pw").await;
        let session =
            gripsou_core::repo::session::find_valid_by_hash(&pool, &auth::hash_token(&token))
                .await
                .unwrap()
                .unwrap();
        let principal = auth::AuthUser {
            user_id: session.user_id,
            session_id: session.id,
        };

        // Sole admin: deletion is refused even with the right password.
        let err = delete_account(
            State(pool.clone()),
            no_throttle(),
            axum::http::HeaderMap::new(),
            axum::extract::ConnectInfo("127.0.0.1:0".parse().unwrap()),
            auth::AuthUser {
                user_id: principal.user_id,
                session_id: principal.session_id,
            },
            Json(dto::DeleteAccountReq {
                password: "pw".into(),
            }),
        )
        .await
        .unwrap_err();
        assert_eq!(err.status(), StatusCode::CONFLICT);
        assert!(
            gripsou_core::repo::user::profile_by_id(&pool, principal.user_id)
                .await
                .unwrap()
                .is_some()
        );

        // With a second admin present, the first admin can delete itself.
        seed_user_with_password(&pool, "boss2@t.local", "pw", "admin").await;
        delete_account(
            State(pool.clone()),
            no_throttle(),
            axum::http::HeaderMap::new(),
            axum::extract::ConnectInfo("127.0.0.1:0".parse().unwrap()),
            auth::AuthUser {
                user_id: principal.user_id,
                session_id: principal.session_id,
            },
            Json(dto::DeleteAccountReq {
                password: "pw".into(),
            }),
        )
        .await
        .expect("delete ok once another admin exists");
        assert!(
            gripsou_core::repo::user::profile_by_id(&pool, principal.user_id)
                .await
                .unwrap()
                .is_none()
        );
    }

    #[sqlx::test(migrations = "../migrations")]
    async fn update_profile_persists_and_rejects_duplicate_email(pool: PgPool) {
        seed_user_with_password(&pool, "a@t.local", "pw", "user").await;
        seed_user_with_password(&pool, "taken@t.local", "pw", "user").await;
        let token = login_token(&pool, "a@t.local", "pw").await;
        let session =
            gripsou_core::repo::session::find_valid_by_hash(&pool, &auth::hash_token(&token))
                .await
                .unwrap()
                .unwrap();
        let principal = auth::AuthUser {
            user_id: session.user_id,
            session_id: session.id,
        };

        // A successful edit returns the refreshed profile and persists.
        let updated = update_profile(
            State(pool.clone()),
            auth::AuthUser {
                user_id: principal.user_id,
                session_id: principal.session_id,
            },
            Json(dto::UpdateProfileReq {
                name: "  New Name  ".into(),
                email: " new@t.local ".into(),
            }),
        )
        .await
        .expect("update ok");
        assert_eq!(updated.0.name, "New Name");
        assert_eq!(updated.0.email, "new@t.local");
        let me_resp = me(
            State(pool.clone()),
            auth::AuthUser {
                user_id: principal.user_id,
                session_id: principal.session_id,
            },
        )
        .await
        .unwrap();
        assert_eq!(me_resp.0.email, "new@t.local");

        // Empty fields are rejected.
        let bad = update_profile(
            State(pool.clone()),
            auth::AuthUser {
                user_id: principal.user_id,
                session_id: principal.session_id,
            },
            Json(dto::UpdateProfileReq {
                name: "   ".into(),
                email: "x@t.local".into(),
            }),
        )
        .await
        .unwrap_err();
        assert_eq!(bad.status(), StatusCode::BAD_REQUEST);

        // Colliding with another user's email returns 409.
        let conflict = update_profile(
            State(pool.clone()),
            auth::AuthUser {
                user_id: principal.user_id,
                session_id: principal.session_id,
            },
            Json(dto::UpdateProfileReq {
                name: "New Name".into(),
                email: "taken@t.local".into(),
            }),
        )
        .await
        .unwrap_err();
        assert_eq!(conflict.status(), StatusCode::CONFLICT);
    }

    #[sqlx::test(migrations = "../migrations")]
    async fn manage_connection_checks_ownership_before_provider_access(pool: PgPool) {
        let owner = seed_user_with_password(&pool, "owner@t.local", "pw", "user").await;
        let other = seed_user_with_password(&pool, "other@t.local", "pw", "user").await;
        let id = gripsou_core::repo::connection::insert_pending(&pool, owner, "powens", "Bank")
            .await
            .unwrap();
        let principal = || auth::AuthUser {
            user_id: other,
            session_id: Uuid::new_v4(),
        };
        for target in [id, Uuid::new_v4()] {
            let error = manage_connection(
                State(pool.clone()),
                State(gripsou_core::testkit::encryption_key()),
                principal(),
                Path(target),
            )
            .await
            .unwrap_err();
            assert_eq!(error.status(), StatusCode::NOT_FOUND);
        }
        let stored = gripsou_core::repo::connection::connection_for_sync(&pool, owner, id)
            .await
            .unwrap();
        assert!(
            stored.is_some(),
            "Manage must not delete the existing connection"
        );
    }

    #[sqlx::test(migrations = "../migrations")]
    async fn sync_connection_guards_and_orchestrator_errors(pool: PgPool) {
        let user = seed_user_with_password(&pool, "a@t.local", "pw", "user").await;
        // `powens` provider is seeded by migration 0002 (the FK requires it).
        let conn = Uuid::new_v4();
        sqlx::query(
            "insert into connection (id, user_id, provider_key, display_name) \
             values ($1,$2,'powens','c')",
        )
        .bind(conn)
        .bind(user)
        .execute(&pool)
        .await
        .unwrap();

        let principal = || auth::AuthUser {
            user_id: user,
            session_id: Uuid::new_v4(),
        };

        // Unknown connection → 404.
        let nf = sync_connection(
            State(pool.clone()),
            State(gripsou_core::testkit::encryption_key()),
            principal(),
            Path(Uuid::new_v4()),
        )
        .await
        .unwrap_err();
        assert_eq!(nf.status(), StatusCode::NOT_FOUND);

        // Force a 'syncing' claim, then a trigger → 409.
        sqlx::query("update connection set status='syncing' where id=$1")
            .bind(conn)
            .execute(&pool)
            .await
            .unwrap();
        let busy = sync_connection(
            State(pool.clone()),
            State(gripsou_core::testkit::encryption_key()),
            principal(),
            Path(conn),
        )
        .await
        .unwrap_err();
        assert_eq!(busy.status(), StatusCode::CONFLICT);

        // Reset, then run the orchestrator directly (deterministic — no spawn):
        // the stub adapter returns NotImplemented, so status becomes 'error'.
        sqlx::query("update connection set status='ok' where id=$1")
            .bind(conn)
            .execute(&pool)
            .await
            .unwrap();
        gripsou_jobs::sync_connection(pool.clone(), gripsou_core::testkit::encryption_key(), conn)
            .await;
        let (status, err): (String, Option<String>) =
            sqlx::query_as("select status, last_error from connection where id=$1")
                .bind(conn)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(status, "error");
        assert!(err.is_some(), "expected a last_error message");
    }

    #[sqlx::test(migrations = "../migrations")]
    async fn connections_returns_provider_tree(pool: PgPool) {
        let user = seed_user_with_password(&pool, "a@t.local", "pw", "user").await;
        sqlx::query(
            "insert into provider (key, display_name, kind, enabled) \
             values ('powens','Powens','account',true) on conflict (key) do nothing",
        )
        .execute(&pool)
        .await
        .unwrap();
        let conn = Uuid::new_v4();
        sqlx::query(
            "insert into connection (id, user_id, provider_key, display_name) \
             values ($1,$2,'powens','My bank')",
        )
        .bind(conn)
        .bind(user)
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query(
            "insert into account (connection_id, name, currency, type_key, color) \
             values ($1,'Checking','EUR','checking','#4dd0b1')",
        )
        .bind(conn)
        .execute(&pool)
        .await
        .unwrap();

        let groups = connections(
            State(pool.clone()),
            auth::AuthUser {
                user_id: user,
                session_id: Uuid::new_v4(),
            },
        )
        .await
        .expect("connections ok")
        .0;

        assert_eq!(groups.len(), 1);
        assert_eq!(groups[0].provider_name, "Powens");
        assert_eq!(groups[0].connections.len(), 1);
        assert_eq!(groups[0].connections[0].display_name, "My bank");
        // Account with no snapshots still appears, valued "0".
        assert_eq!(groups[0].connections[0].accounts.len(), 1);
        assert_eq!(groups[0].connections[0].accounts[0].value, "0");
    }

    #[sqlx::test(migrations = "../migrations")]
    async fn change_password_requires_correct_current(pool: PgPool) {
        let id = seed_admin(&pool, "a@t.local", "old-pass").await;
        // Need a real session_id for change_password
        let token = login_token(&pool, "a@t.local", "old-pass").await;
        let session =
            gripsou_core::repo::session::find_valid_by_hash(&pool, &auth::hash_token(&token))
                .await
                .unwrap()
                .unwrap();
        assert_eq!(session.user_id, id);

        let bad = change_password(
            State(pool.clone()),
            no_throttle(),
            axum::http::HeaderMap::new(),
            axum::extract::ConnectInfo("127.0.0.1:0".parse().unwrap()),
            auth::AuthUser {
                user_id: id,
                session_id: session.id,
            },
            Json(ChangePasswordReq {
                current_password: "nope".into(),
                new_password: "new-pass".into(),
            }),
        )
        .await
        .unwrap_err();
        assert_eq!(bad.status(), StatusCode::BAD_REQUEST);
    }

    #[sqlx::test(migrations = "../migrations")]
    async fn providers_lists_account_providers_with_enabled_flag(pool: PgPool) {
        // yahoo is kind='price' and must be excluded; powens is enabled via seed.
        let admin = seed_user_with_password(&pool, "admin@t.local", "pw", "admin").await;
        let principal = AdminUser { user_id: admin };

        let list = providers(State(pool.clone()), principal)
            .await
            .expect("ok")
            .0;

        assert_eq!(list.len(), 1, "only account-kind providers are listed");
        assert_eq!(list[0].key, "powens");
        assert_eq!(list[0].display_name, "Powens");
        assert!(list[0].enabled, "powens is in the seeded enabled_providers");
        assert!(list[0].description.is_some());
    }

    #[sqlx::test(migrations = "../migrations")]
    async fn set_provider_toggles_enabled_idempotently(pool: PgPool) {
        let admin = seed_user_with_password(&pool, "admin@t.local", "pw", "admin").await;
        let principal = || AdminUser { user_id: admin };

        // Disable powens (seeded enabled).
        let off = set_provider(
            State(pool.clone()),
            principal(),
            Path("powens".to_string()),
            Json(dto::SetProviderReq { enabled: false }),
        )
        .await
        .expect("disable ok")
        .0;
        assert!(!off.enabled);

        // Idempotent: disabling again still reports disabled and does not error.
        let _ = set_provider(
            State(pool.clone()),
            principal(),
            Path("powens".to_string()),
            Json(dto::SetProviderReq { enabled: false }),
        )
        .await
        .expect("second disable ok");

        // Re-enable.
        let on = set_provider(
            State(pool.clone()),
            principal(),
            Path("powens".to_string()),
            Json(dto::SetProviderReq { enabled: true }),
        )
        .await
        .expect("enable ok")
        .0;
        assert!(on.enabled);

        // Persisted: a fresh list reflects the enabled flag.
        let list = providers(State(pool.clone()), principal()).await.unwrap().0;
        assert!(list.iter().find(|p| p.key == "powens").unwrap().enabled);
    }

    #[sqlx::test(migrations = "../migrations")]
    async fn set_provider_unknown_key_is_404(pool: PgPool) {
        let admin = seed_user_with_password(&pool, "admin@t.local", "pw", "admin").await;
        // 'yahoo' is a price provider, not an account provider → treated as not found.
        for key in ["nope", "yahoo"] {
            let err = set_provider(
                State(pool.clone()),
                AdminUser { user_id: admin },
                Path(key.to_string()),
                Json(dto::SetProviderReq { enabled: true }),
            )
            .await
            .unwrap_err();
            assert_eq!(err.status(), StatusCode::NOT_FOUND, "key {key}");
        }
    }

    #[sqlx::test(migrations = "../migrations")]
    async fn enabled_providers_returns_only_enabled(pool: PgPool) {
        // Seed: powens is enabled via migration 0002; yahoo is price kind.
        let user = seed_user_with_password(&pool, "u@t.local", "pw", "user").await;
        let rows = enabled_providers(
            State(pool.clone()),
            auth::AuthUser {
                user_id: user,
                session_id: Uuid::new_v4(),
            },
        )
        .await
        .expect("ok")
        .0;

        // Only account-kind AND in enabled_providers list.
        assert!(
            rows.iter().all(|p| p.key != "yahoo"),
            "price providers must be excluded"
        );
        // Powens is in enabled_providers per seed — it should appear.
        assert!(
            rows.iter().any(|p| p.key == "powens"),
            "powens should be in enabled list"
        );
    }

    #[sqlx::test(migrations = "../migrations")]
    async fn init_connection_rejects_unknown_provider(pool: PgPool) {
        let user = seed_user_with_password(&pool, "u@t.local", "pw", "user").await;
        let err = init_connection(
            State(pool.clone()),
            auth::AuthUser {
                user_id: user,
                session_id: Uuid::new_v4(),
            },
            Json(dto::InitConnectionReq {
                provider_key: "nope".to_string(),
            }),
        )
        .await
        .unwrap_err();
        assert_eq!(err.status(), StatusCode::BAD_REQUEST);
    }

    #[sqlx::test(migrations = "../migrations")]
    async fn init_connection_returns_redirect_url(pool: PgPool) {
        let user = seed_user_with_password(&pool, "u@t.local", "pw", "user").await;
        let resp = init_connection(
            State(pool.clone()),
            auth::AuthUser {
                user_id: user,
                session_id: Uuid::new_v4(),
            },
            Json(dto::InitConnectionReq {
                provider_key: "powens".to_string(),
            }),
        )
        .await
        .unwrap();

        assert_eq!(resp.0, StatusCode::CREATED);
        assert!(
            resp.1
                .redirect_url
                .as_ref()
                .unwrap()
                .starts_with("https://webview.powens.com/en/connect")
        );
    }

    #[sqlx::test(migrations = "../migrations")]
    async fn delete_connection_guards_ownership(pool: PgPool) {
        let owner = seed_user_with_password(&pool, "owner@t.local", "pw", "user").await;
        let other = seed_user_with_password(&pool, "other@t.local", "pw", "user").await;

        let conn_id = Uuid::new_v4();
        sqlx::query(
            "insert into connection (id, user_id, provider_key, display_name) \
             values ($1, $2, 'powens', 'c')",
        )
        .bind(conn_id)
        .bind(owner)
        .execute(&pool)
        .await
        .unwrap();

        // Wrong user → 404.
        let err = delete_connection(
            State(pool.clone()),
            auth::AuthUser {
                user_id: other,
                session_id: Uuid::new_v4(),
            },
            axum::extract::Path(conn_id),
        )
        .await
        .unwrap_err();
        assert_eq!(err.status(), StatusCode::NOT_FOUND);

        // Correct user → 204.
        let ok = delete_connection(
            State(pool.clone()),
            auth::AuthUser {
                user_id: owner,
                session_id: Uuid::new_v4(),
            },
            axum::extract::Path(conn_id),
        )
        .await
        .expect("delete ok");
        assert_eq!(ok, StatusCode::NO_CONTENT);

        // Connection is gone.
        let count: i64 = sqlx::query_scalar("select count(*) from connection where id=$1")
            .bind(conn_id)
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(count, 0);
    }

    #[sqlx::test(migrations = "../migrations")]
    async fn complete_connection_unknown_id_is_not_found(pool: PgPool) {
        let user = seed_user_with_password(&pool, "u@t.local", "pw", "user").await;
        let err = complete_connection(
            State(pool.clone()),
            State(gripsou_core::testkit::encryption_key()),
            auth::AuthUser {
                user_id: user,
                session_id: Uuid::new_v4(),
            },
            Json(dto::CompleteConnectionReq {
                connection_id: Uuid::new_v4().to_string(),
                params: std::collections::HashMap::new(),
            }),
        )
        .await
        .unwrap_err();
        assert_eq!(err, ApiError::NotFound("connection not found"));
    }

    #[sqlx::test(migrations = "../migrations")]
    async fn a_failed_complete_deletes_the_pending_connection_only(pool: PgPool) {
        use gripsou_core::repo::connection;
        let user = seed_user_with_password(&pool, "u@t.local", "pw", "user").await;
        let pending = connection::insert_pending(&pool, user, "powens", "Bank")
            .await
            .unwrap();
        let active = connection::insert_pending(&pool, user, "powens", "Bank")
            .await
            .unwrap();
        sqlx::query("update connection set status = 'ok' where id = $1")
            .bind(active)
            .execute(&pool)
            .await
            .unwrap();

        for id in [pending, active] {
            complete_connection(
                State(pool.clone()),
                State(gripsou_core::testkit::encryption_key()),
                auth::AuthUser {
                    user_id: user,
                    session_id: Uuid::new_v4(),
                },
                Json(dto::CompleteConnectionReq {
                    connection_id: id.to_string(),
                    params: [("error".to_string(), "access_denied".to_string())].into(),
                }),
            )
            .await
            .unwrap_err();
        }

        let left: Vec<Uuid> = sqlx::query_scalar("select id from connection where user_id = $1")
            .bind(user)
            .fetch_all(&pool)
            .await
            .unwrap();
        assert_eq!(left, vec![active]);
    }

    async fn principal_for(pool: &PgPool, email: &str, pw: &str) -> auth::AuthUser {
        let token = login_token(pool, email, pw).await;
        let session =
            gripsou_core::repo::session::find_valid_by_hash(pool, &auth::hash_token(&token))
                .await
                .unwrap()
                .unwrap();
        auth::AuthUser {
            user_id: session.user_id,
            session_id: session.id,
        }
    }

    #[sqlx::test(migrations = "../migrations")]
    async fn create_invite_writes_invite_row(pool: PgPool) {
        let admin = seed_user_with_password(&pool, "a@t.local", "pw", "admin").await;
        let who = principal_for(&pool, "a@t.local", "pw").await;
        let resp = create_invite(
            State(pool.clone()),
            AdminUser {
                user_id: who.user_id,
            },
        )
        .await
        .expect("ok");
        assert_eq!(resp.0, StatusCode::CREATED);
        assert!(!resp.1.0.token.is_empty());

        let (kind, email): (String, Option<String>) =
            sqlx::query_as("select type, email from invite_token where created_by = $1")
                .bind(admin)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(kind, "invite");
        assert_eq!(email, None);

        let stored_token: String =
            sqlx::query_scalar("select token from invite_token where created_by = $1")
                .bind(admin)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_ne!(stored_token, resp.1.0.token, "raw token must not be stored");
    }

    #[sqlx::test(migrations = "../migrations")]
    async fn create_reset_link_stores_target_email(pool: PgPool) {
        seed_user_with_password(&pool, "a@t.local", "pw", "admin").await;
        let target = seed_user_with_password(&pool, "target@t.local", "pw", "user").await;
        let who = principal_for(&pool, "a@t.local", "pw").await;

        let reauth = crate::mfa::tests::reauth_token(&pool, &who, "pw").await;
        let resp = create_reset_link(
            State(pool.clone()),
            AdminUser {
                user_id: who.user_id,
            },
            Path(target),
            Json(dto::ReauthTokenReq { reauth }),
        )
        .await
        .expect("ok");
        assert_eq!(resp.0, StatusCode::CREATED);

        let (kind, email): (String, Option<String>) =
            sqlx::query_as("select type, email from invite_token where type = 'reset'")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(kind, "reset");
        assert_eq!(email.as_deref(), Some("target@t.local"));

        let stored_token: String =
            sqlx::query_scalar("select token from invite_token where type = 'reset'")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_ne!(stored_token, resp.1.0.token, "raw token must not be stored");
    }

    #[sqlx::test(migrations = "../migrations")]
    async fn create_reset_link_needs_a_reauth_and_another_user(pool: PgPool) {
        let admin = seed_user_with_password(&pool, "a@t.local", "pw", "admin").await;
        let target = seed_user_with_password(&pool, "target@t.local", "pw", "user").await;
        let who = principal_for(&pool, "a@t.local", "pw").await;
        let create = |id, reauth: &str| {
            create_reset_link(
                State(pool.clone()),
                AdminUser {
                    user_id: who.user_id,
                },
                Path(id),
                Json(dto::ReauthTokenReq {
                    reauth: reauth.into(),
                }),
            )
        };

        let err = create(target, "forged").await.unwrap_err();
        assert_eq!(err.status(), StatusCode::FORBIDDEN);
        let reauth = crate::mfa::tests::reauth_token(&pool, &who, "pw").await;
        let err = create(admin, &reauth).await.unwrap_err();
        assert_eq!(err.status(), StatusCode::BAD_REQUEST);
        // Refusing oneself did not spend the token.
        let (status, _) = create(target, &reauth).await.expect("ok");
        assert_eq!(status, StatusCode::CREATED);
        // Single use.
        let err = create(target, &reauth).await.unwrap_err();
        assert_eq!(err.status(), StatusCode::FORBIDDEN);
    }

    #[sqlx::test(migrations = "../migrations")]
    async fn change_password_is_throttled_like_login(pool: PgPool) {
        seed_user_with_password(&pool, "c@t.local", "old-password", "user").await;
        let who = principal_for(&pool, "c@t.local", "old-password").await;
        let throttle = Arc::new(LoginThrottle::default());
        let attempt = |current: &str| {
            change_password(
                State(pool.clone()),
                State(throttle.clone()),
                axum::http::HeaderMap::new(),
                axum::extract::ConnectInfo("127.0.0.1:0".parse().unwrap()),
                AuthUser {
                    user_id: who.user_id,
                    session_id: who.session_id,
                },
                Json(dto::ChangePasswordReq {
                    current_password: current.into(),
                    new_password: "new-password".into(),
                }),
            )
        };
        for _ in 0..5 {
            assert_eq!(
                attempt("wrong").await.unwrap_err().status(),
                StatusCode::BAD_REQUEST
            );
        }
        let err = attempt("old-password").await.unwrap_err();
        assert_eq!(err.status(), StatusCode::TOO_MANY_REQUESTS);
        assert!(can_login(&pool, "c@t.local", "old-password").await);
    }

    #[sqlx::test(migrations = "../migrations")]
    async fn delete_user_rejects_mismatched_email(pool: PgPool) {
        seed_user_with_password(&pool, "a@t.local", "pw", "admin").await;
        let target = seed_user_with_password(&pool, "target@t.local", "pw", "user").await;
        let who = principal_for(&pool, "a@t.local", "pw").await;

        let err = delete_user(
            State(pool.clone()),
            AdminUser {
                user_id: who.user_id,
            },
            Path(target),
            Json(dto::DeleteUserReq {
                email: "wrong@t.local".into(),
            }),
        )
        .await
        .unwrap_err();
        assert_eq!(err.status(), StatusCode::BAD_REQUEST);
        assert!(
            gripsou_core::repo::user::profile_by_id(&pool, target)
                .await
                .unwrap()
                .is_some()
        );
    }

    #[sqlx::test(migrations = "../migrations")]
    async fn delete_user_refuses_last_admin(pool: PgPool) {
        let admin = seed_user_with_password(&pool, "boss@t.local", "pw", "admin").await;
        let who = principal_for(&pool, "boss@t.local", "pw").await;

        let err = delete_user(
            State(pool.clone()),
            AdminUser {
                user_id: who.user_id,
            },
            Path(admin),
            Json(dto::DeleteUserReq {
                email: "boss@t.local".into(),
            }),
        )
        .await
        .unwrap_err();
        assert_eq!(err.status(), StatusCode::CONFLICT);
    }

    #[sqlx::test(migrations = "../migrations")]
    async fn delete_user_removes_target(pool: PgPool) {
        seed_user_with_password(&pool, "a@t.local", "pw", "admin").await;
        let target = seed_user_with_password(&pool, "target@t.local", "pw", "user").await;
        let who = principal_for(&pool, "a@t.local", "pw").await;

        // Case-insensitive email match succeeds.
        let ok = delete_user(
            State(pool.clone()),
            AdminUser {
                user_id: who.user_id,
            },
            Path(target),
            Json(dto::DeleteUserReq {
                email: "TARGET@t.local".into(),
            }),
        )
        .await
        .expect("ok");
        assert_eq!(ok, StatusCode::NO_CONTENT);
        assert!(
            gripsou_core::repo::user::profile_by_id(&pool, target)
                .await
                .unwrap()
                .is_none()
        );
    }

    // ── invite/reset redemption endpoint tests ──────────────────────────────

    #[sqlx::test(migrations = "../migrations")]
    async fn redeem_invite_endpoint_creates_account(pool: PgPool) {
        let admin = seed_admin_user(&pool).await;
        gripsou_core::repo::invite_token::create(
            &pool,
            "invite",
            None,
            admin,
            &auth::hash_token_str("raw-invite"),
            Utc::now() + Duration::hours(1),
        )
        .await
        .unwrap();

        let resp = redeem_invite(
            State(pool.clone()),
            axum::http::HeaderMap::new(),
            axum::extract::ConnectInfo("127.0.0.1:0".parse().unwrap()),
            Path("raw-invite".to_string()),
            Json(dto::RedeemInviteReq {
                email: "new@t.local".into(),
                name: "New".into(),
                password: "hunter2-long".into(),
            }),
        )
        .await
        .expect("redeem ok");
        assert!(!resp.0.token.is_empty());
        assert_eq!(resp.0.user.email, "new@t.local");
        assert_eq!(resp.0.user.role, "user");
    }

    #[sqlx::test(migrations = "../migrations")]
    async fn redeemed_account_needs_welcome_until_finished(pool: PgPool) {
        let admin = seed_admin_user(&pool).await;
        gripsou_core::repo::invite_token::create(
            &pool,
            "invite",
            None,
            admin,
            &auth::hash_token_str("raw-invite"),
            Utc::now() + Duration::hours(1),
        )
        .await
        .unwrap();
        let resp = redeem_invite(
            State(pool.clone()),
            axum::http::HeaderMap::new(),
            axum::extract::ConnectInfo("127.0.0.1:0".parse().unwrap()),
            Path("raw-invite".to_string()),
            Json(dto::RedeemInviteReq {
                email: "new@t.local".into(),
                name: "New".into(),
                password: "hunter2-long".into(),
            }),
        )
        .await
        .expect("redeem ok");
        assert!(!resp.0.user.welcome_done);

        let session = gripsou_core::repo::session::find_valid_by_hash(
            &pool,
            &auth::hash_token(&resp.0.token),
        )
        .await
        .unwrap()
        .unwrap();
        let principal = || auth::AuthUser {
            user_id: session.user_id,
            session_id: session.id,
        };
        let status = finish_welcome(State(pool.clone()), principal())
            .await
            .expect("finish ok");
        assert_eq!(status, StatusCode::NO_CONTENT);

        let me_resp = me(State(pool.clone()), principal()).await.expect("me ok");
        assert!(me_resp.0.welcome_done);
    }

    #[sqlx::test(migrations = "../migrations")]
    async fn redeem_invite_endpoint_conflicts_on_existing_email(pool: PgPool) {
        let admin = seed_admin_user(&pool).await; // creates a@t.local
        gripsou_core::repo::invite_token::create(
            &pool,
            "invite",
            None,
            admin,
            &auth::hash_token_str("raw-invite"),
            Utc::now() + Duration::hours(1),
        )
        .await
        .unwrap();

        let err = redeem_invite(
            State(pool.clone()),
            axum::http::HeaderMap::new(),
            axum::extract::ConnectInfo("127.0.0.1:0".parse().unwrap()),
            Path("raw-invite".to_string()),
            Json(dto::RedeemInviteReq {
                email: "a@t.local".into(),
                name: "Dup".into(),
                password: "hunter2-long".into(),
            }),
        )
        .await
        .unwrap_err();
        assert_eq!(err.status(), StatusCode::CONFLICT);
        // Token left unconsumed.
        assert!(
            gripsou_core::repo::invite_token::find_valid(
                &pool,
                &auth::hash_token_str("raw-invite")
            )
            .await
            .unwrap()
            .is_some()
        );
    }

    #[sqlx::test(migrations = "../migrations")]
    async fn token_info_404_for_unknown(pool: PgPool) {
        let err = token_info(State(pool.clone()), Path("does-not-exist".to_string()))
            .await
            .unwrap_err();
        assert_eq!(err.status(), StatusCode::NOT_FOUND);
    }

    async fn patch_prefs(
        pool: &PgPool,
        user_id: Uuid,
        patch: serde_json::Value,
    ) -> Result<dto::SessionUser, ApiError> {
        let serde_json::Value::Object(patch) = patch else {
            panic!("a patch is an object")
        };
        update_prefs(
            State(pool.clone()),
            auth::AuthUser {
                user_id,
                session_id: Uuid::new_v4(),
            },
            Json(patch),
        )
        .await
        .map(|Json(user)| user)
    }

    #[sqlx::test(migrations = "../migrations")]
    async fn update_prefs_saves_only_the_settings_sent(pool: PgPool) {
        let user_id = seed_user_with_password(&pool, "a@t.local", "pw", "user").await;
        let updated = patch_prefs(
            &pool,
            user_id,
            json!({ "uiLanguage": "fr", "currency": "USD" }),
        )
        .await
        .unwrap();
        assert_eq!(updated.prefs.display.ui_language, "fr");
        assert_eq!(updated.prefs.currency, "USD");

        patch_prefs(&pool, user_id, json!({ "timeZone": "America/Los_Angeles" }))
            .await
            .unwrap();
        let after = prefs_of(&pool, user_id).await;
        assert_eq!(
            (after.display.ui_language.as_str(), after.currency.as_str()),
            ("fr", "USD")
        );
        assert_eq!(after.time_zone, "America/Los_Angeles");
    }

    #[sqlx::test(migrations = "../migrations")]
    async fn two_settings_saved_at_once_both_stick(pool: PgPool) {
        let user_id = seed_user_with_password(&pool, "a@t.local", "pw", "user").await;
        let (a, b) = tokio::join!(
            patch_prefs(&pool, user_id, json!({ "currency": "USD" })),
            patch_prefs(&pool, user_id, json!({ "numberDecimals": 0 })),
        );
        a.unwrap();
        b.unwrap();
        let after = prefs_of(&pool, user_id).await;
        assert_eq!(
            (after.currency.as_str(), after.display.number_decimals),
            ("USD", 0)
        );
    }

    #[sqlx::test(migrations = "../migrations")]
    async fn update_prefs_rejects_bad_values_without_writing(pool: PgPool) {
        let user_id = seed_user_with_password(&pool, "tz@example.com", "pw", "user").await;
        let before = prefs_of(&pool, user_id).await;
        let big = format!("data:image/webp;base64,{}", "A".repeat(200 * 1024));
        let bad = [
            json!({ "timeZone": "" }),
            json!({ "timeZone": "Europe/NotAPlace" }),
            json!({ "timeZone": "+02:00" }),
            json!({ "timeZone": "posix/Europe/Paris" }),
            json!({ "currency": "usd" }),
            json!({ "currency": "EURO" }),
            json!({ "currency": null }),
            json!({ "budgetAiThreshold": 40 }),
            json!({ "numberDecimals": "two" }),
            json!({ "avatar": "data:text/html,<script>" }),
            json!({ "avatar": big }),
            json!({ "uiLanguage": "fr", "noSuchPref": true }),
        ];
        for patch in bad {
            let label = patch.to_string();
            let result = patch_prefs(&pool, user_id, patch).await;
            assert!(matches!(result, Err(ApiError::BadRequest(_))), "{label}");
        }
        let after = prefs_of(&pool, user_id).await;
        assert_eq!(
            serde_json::to_value(&after).unwrap(),
            serde_json::to_value(&before).unwrap()
        );
    }

    #[sqlx::test(migrations = "../migrations")]
    async fn a_null_removes_the_avatar(pool: PgPool) {
        let user_id = seed_user_with_password(&pool, "av@example.com", "pw", "user").await;
        patch_prefs(
            &pool,
            user_id,
            json!({ "avatar": "data:image/webp;base64,UklGRg==" }),
        )
        .await
        .unwrap();
        assert!(prefs_of(&pool, user_id).await.display.avatar.is_some());
        patch_prefs(&pool, user_id, json!({ "avatar": null }))
            .await
            .unwrap();
        assert!(prefs_of(&pool, user_id).await.display.avatar.is_none());
    }

    async fn prefs_of(pool: &PgPool, user_id: Uuid) -> gripsou_core::repo::prefs::UserPrefs {
        gripsou_core::repo::user::profile_by_id(pool, user_id)
            .await
            .unwrap()
            .unwrap()
            .prefs
    }

    #[test]
    fn calendar_range_uses_the_supplied_local_day() {
        let today = NaiveDate::from_ymd_opt(2027, 1, 1).unwrap();
        assert_eq!(range_window("ytd", today), (today, today));
        assert_eq!(
            range_window("7d", today),
            (NaiveDate::from_ymd_opt(2026, 12, 25).unwrap(), today)
        );
    }

    /// Insert a user + connection, returning the connection id (mirrors
    /// core's `common::seed_connection`, but this crate can't import that
    /// test-only module across crates).
    async fn seed_connection(pool: &PgPool, email: &str) -> Uuid {
        let user_id = seed_user_with_password(pool, email, "hunter2", "user").await;
        let conn_id = Uuid::new_v4();
        sqlx::query(
            "insert into connection (id, user_id, provider_key, display_name) \
             values ($1, $2, 'powens', 'Test connection')",
        )
        .bind(conn_id)
        .bind(user_id)
        .execute(pool)
        .await
        .unwrap();
        conn_id
    }

    /// Seed a holding for a freshly created user/connection/account/instrument,
    /// returning (user_id, holding_id).
    async fn seed_holding(pool: &PgPool, email: &str) -> (Uuid, Uuid) {
        use gripsou_core::dto::{CanonicalAccount, CanonicalHolding, InstrumentRef};
        use gripsou_core::repo::account::upsert_account;
        use gripsou_core::repo::holding::upsert_holding;
        use gripsou_core::repo::instrument::resolve_instrument;

        let conn_id = seed_connection(pool, email).await;
        let user_id: Uuid = sqlx::query_scalar("select user_id from connection where id = $1")
            .bind(conn_id)
            .fetch_one(pool)
            .await
            .unwrap();

        let mut conn = pool.acquire().await.unwrap();
        let account = CanonicalAccount {
            external_id: "acct-1".into(),
            name: "PEA".into(),
            type_key: "pea".into(),
            currency: "EUR".into(),
            meta: serde_json::json!({}),
        };
        let account_id = upsert_account(&mut conn, conn_id, &account).await.unwrap();
        let instrument = InstrumentRef {
            kind: "equity".into(),
            symbol: Some("PAEEM".into()),
            isin: Some("IE00B5BMR087".into()),
            name: "S&P 500".into(),
            currency: "USD".into(),
        };
        let instrument_id = resolve_instrument(&mut conn, &instrument).await.unwrap();
        let holding = CanonicalHolding {
            account_external_id: "acct-1".into(),
            instrument,
            quantity: Decimal::new(100, 0),
            cost_basis: Decimal::new(1000, 0),
            valuation: Some(Decimal::new(1200, 0)),
        };
        let holding_id = upsert_holding(&mut conn, account_id, instrument_id, &holding)
            .await
            .unwrap();
        (user_id, holding_id)
    }

    fn auth(user_id: Uuid) -> auth::AuthUser {
        auth::AuthUser {
            user_id,
            session_id: Uuid::new_v4(),
        }
    }

    fn add(kind: &str, day: (i32, u32, u32), quantity: &str, unit_price: &str) -> dto::LotEntry {
        dto::LotEntry {
            kind: kind.into(),
            date: NaiveDate::from_ymd_opt(day.0, day.1, day.2).unwrap(),
            quantity: quantity.into(),
            unit_price: unit_price.into(),
            fee: None,
        }
    }

    #[sqlx::test(migrations = "../migrations")]
    async fn save_lots_writes_signed_amounts(pool: PgPool) {
        let (user_id, holding_id) = seed_holding(&pool, "owner@t.local").await;

        let status = save_lots(
            State(pool.clone()),
            auth(user_id),
            Path(holding_id),
            Json(dto::SaveLotsReq {
                adds: vec![
                    add("buy", (2024, 5, 2), "20", "15.617"),
                    add("sell", (2024, 6, 2), "5", "18"),
                ],
                deletes: vec![],
            }),
        )
        .await
        .expect("save_lots ok");
        assert_eq!(status, StatusCode::NO_CONTENT);

        let rows: Vec<(String, Decimal, Decimal, Option<String>)> = sqlx::query_as(
            "select side, quantity, unit_price, external_id from lot \
             where holding_id = $1 order by acquired_on",
        )
        .bind(holding_id)
        .fetch_all(&pool)
        .await
        .unwrap();
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0].0, "buy");
        assert_eq!(rows[0].1, Decimal::new(20, 0));
        assert_eq!(rows[0].2, Decimal::new(15617, 3));
        assert_eq!(rows[0].3, None, "a manual lot carries no external_id");
        assert_eq!(rows[1].0, "sell");
        assert_eq!(rows[1].1, Decimal::new(5, 0));
        assert_eq!(rows[1].2, Decimal::new(18, 0));
        assert_eq!(rows[1].3, None);
    }

    #[sqlx::test(migrations = "../migrations")]
    async fn save_lots_deletes_a_manual_row(pool: PgPool) {
        let (user_id, holding_id) = seed_holding(&pool, "owner@t.local").await;
        save_lots(
            State(pool.clone()),
            auth(user_id),
            Path(holding_id),
            Json(dto::SaveLotsReq {
                adds: vec![add("buy", (2024, 5, 2), "20", "10")],
                deletes: vec![],
            }),
        )
        .await
        .unwrap();
        let id: Uuid = sqlx::query_scalar("select id from lot where holding_id = $1")
            .bind(holding_id)
            .fetch_one(&pool)
            .await
            .unwrap();

        let status = save_lots(
            State(pool.clone()),
            auth(user_id),
            Path(holding_id),
            Json(dto::SaveLotsReq {
                adds: vec![],
                deletes: vec![id],
            }),
        )
        .await
        .expect("delete ok");
        assert_eq!(status, StatusCode::NO_CONTENT);

        let left: i64 = sqlx::query_scalar("select count(*) from lot where holding_id = $1")
            .bind(holding_id)
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(left, 0);
    }

    /// The whole point of the batch: a delete that cannot be honoured must take
    /// the adds down with it, or the user sees "saved" over a half-applied edit.
    #[sqlx::test(migrations = "../migrations")]
    async fn a_bad_delete_rolls_back_the_adds(pool: PgPool) {
        let (user_id, holding_id) = seed_holding(&pool, "owner@t.local").await;

        let err = save_lots(
            State(pool.clone()),
            auth(user_id),
            Path(holding_id),
            Json(dto::SaveLotsReq {
                adds: vec![add("buy", (2024, 5, 2), "20", "10")],
                deletes: vec![Uuid::new_v4()],
            }),
        )
        .await
        .expect_err("unknown delete id must fail");
        assert_eq!(err.status(), StatusCode::NOT_FOUND);

        let written: i64 = sqlx::query_scalar("select count(*) from lot where holding_id = $1")
            .bind(holding_id)
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(written, 0, "the add must not survive the failed delete");
    }

    /// A provider row resyncs, so deleting it is meaningless — and letting the
    /// request through would report success for a change that silently reverts.
    #[sqlx::test(migrations = "../migrations")]
    async fn a_provider_row_cannot_be_deleted(pool: PgPool) {
        let (user_id, holding_id) = seed_holding(&pool, "owner@t.local").await;
        let id: Uuid = sqlx::query_scalar(
            "insert into lot (holding_id, side, acquired_on, quantity, unit_price, source, external_id) \
             values ($1, 'buy', current_date, 5, 10, 'provider', 'powens-1') returning id",
        )
        .bind(holding_id)
        .fetch_one(&pool)
        .await
        .unwrap();

        let err = save_lots(
            State(pool.clone()),
            auth(user_id),
            Path(holding_id),
            Json(dto::SaveLotsReq {
                adds: vec![],
                deletes: vec![id],
            }),
        )
        .await
        .expect_err("provider row must not delete");
        assert_eq!(err.status(), StatusCode::NOT_FOUND);

        let alive: i64 = sqlx::query_scalar("select count(*) from lot where id = $1")
            .bind(id)
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(alive, 1);
    }

    /// Seed a SECOND holding under the SAME connection/user as `seed_holding`
    /// produced, so a test can prove that a row's own-holding correlation is
    /// enforced even when the caller legitimately owns both holdings.
    async fn seed_second_holding(pool: &PgPool, user_id: Uuid) -> Uuid {
        use gripsou_core::dto::{CanonicalAccount, CanonicalHolding, InstrumentRef};
        use gripsou_core::repo::account::upsert_account;
        use gripsou_core::repo::holding::upsert_holding;
        use gripsou_core::repo::instrument::resolve_instrument;

        let conn_id: Uuid = sqlx::query_scalar("select id from connection where user_id = $1")
            .bind(user_id)
            .fetch_one(pool)
            .await
            .unwrap();

        let mut conn = pool.acquire().await.unwrap();
        let account = CanonicalAccount {
            external_id: "acct-2".into(),
            name: "Livret".into(),
            type_key: "pea".into(),
            currency: "EUR".into(),
            meta: serde_json::json!({}),
        };
        let account_id = upsert_account(&mut conn, conn_id, &account).await.unwrap();
        let instrument = InstrumentRef {
            kind: "equity".into(),
            symbol: Some("PAEEM".into()),
            isin: Some("IE00B5BMR087".into()),
            name: "S&P 500".into(),
            currency: "USD".into(),
        };
        let instrument_id = resolve_instrument(&mut conn, &instrument).await.unwrap();
        let holding = CanonicalHolding {
            account_external_id: "acct-2".into(),
            instrument,
            quantity: Decimal::new(100, 0),
            cost_basis: Decimal::new(1000, 0),
            valuation: Some(Decimal::new(1200, 0)),
        };
        upsert_holding(&mut conn, account_id, instrument_id, &holding)
            .await
            .unwrap()
    }

    /// Pins the `l.holding_id = h.id` correlation in `lot::delete_lots`. Every
    /// other refusal test is settled before that predicate ever runs — by the
    /// handler's own ownership lookup, or by `source = 'manual'` — so none of
    /// them exercises this clause. This is the only test where the caller
    /// legitimately owns BOTH holdings: the row belongs to holding A, and the
    /// delete is aimed at holding B. If that clause were ever dropped, a user
    /// could delete their OWN manual lot through the WRONG holding's endpoint —
    /// silently corrupting that other holding's cost basis while the rest of
    /// the suite stayed green.
    #[sqlx::test(migrations = "../migrations")]
    async fn a_row_from_another_holding_of_the_same_user_cannot_be_deleted(pool: PgPool) {
        let (user_id, holding_a) = seed_holding(&pool, "owner@t.local").await;
        let holding_b = seed_second_holding(&pool, user_id).await;

        save_lots(
            State(pool.clone()),
            auth(user_id),
            Path(holding_a),
            Json(dto::SaveLotsReq {
                adds: vec![add("buy", (2024, 5, 2), "20", "10")],
                deletes: vec![],
            }),
        )
        .await
        .unwrap();
        let lot_on_a: Uuid = sqlx::query_scalar("select id from lot where holding_id = $1")
            .bind(holding_a)
            .fetch_one(&pool)
            .await
            .unwrap();

        let err = save_lots(
            State(pool.clone()),
            auth(user_id),
            Path(holding_b),
            Json(dto::SaveLotsReq {
                adds: vec![add("buy", (2024, 5, 3), "5", "10")],
                deletes: vec![lot_on_a],
            }),
        )
        .await
        .expect_err("a row from a different holding of the same user must not delete");
        assert_eq!(err.status(), StatusCode::NOT_FOUND);

        let alive: i64 = sqlx::query_scalar("select count(*) from lot where id = $1")
            .bind(lot_on_a)
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(alive, 1, "holding A's row must survive the refused delete");

        let written_on_b: i64 =
            sqlx::query_scalar("select count(*) from lot where holding_id = $1")
                .bind(holding_b)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(
            written_on_b, 0,
            "the add on B must not survive the failed delete"
        );
    }

    #[sqlx::test(migrations = "../migrations")]
    async fn another_users_row_cannot_be_deleted(pool: PgPool) {
        let (owner, owner_holding) = seed_holding(&pool, "owner@t.local").await;
        let (attacker, _) = seed_holding(&pool, "attacker@t.local").await;
        save_lots(
            State(pool.clone()),
            auth(owner),
            Path(owner_holding),
            Json(dto::SaveLotsReq {
                adds: vec![add("buy", (2024, 5, 2), "20", "10")],
                deletes: vec![],
            }),
        )
        .await
        .unwrap();
        let victim: Uuid = sqlx::query_scalar("select id from lot where holding_id = $1")
            .bind(owner_holding)
            .fetch_one(&pool)
            .await
            .unwrap();

        let err = save_lots(
            State(pool.clone()),
            auth(attacker),
            Path(owner_holding),
            Json(dto::SaveLotsReq {
                adds: vec![],
                deletes: vec![victim],
            }),
        )
        .await
        .expect_err("cross-user delete must fail");
        // 404, not 403: the endpoint must not confirm that this holding exists.
        assert_eq!(err.status(), StatusCode::NOT_FOUND);

        let alive: i64 = sqlx::query_scalar("select count(*) from lot where id = $1")
            .bind(victim)
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(alive, 1);
    }

    /// A malformed row must be caught BEFORE anything is written, so a rejected
    /// batch leaves no trace at all.
    #[sqlx::test(migrations = "../migrations")]
    async fn a_malformed_add_writes_nothing(pool: PgPool) {
        let (user_id, holding_id) = seed_holding(&pool, "owner@t.local").await;

        let err = save_lots(
            State(pool.clone()),
            auth(user_id),
            Path(holding_id),
            Json(dto::SaveLotsReq {
                adds: vec![
                    add("buy", (2024, 5, 2), "20", "10"),
                    add("buy", (2024, 5, 3), "0", "10"),
                ],
                deletes: vec![],
            }),
        )
        .await
        .expect_err("zero quantity must fail");
        assert_eq!(err.status(), StatusCode::BAD_REQUEST);

        let written: i64 = sqlx::query_scalar("select count(*) from lot where holding_id = $1")
            .bind(holding_id)
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(written, 0);
    }

    #[sqlx::test(migrations = "../migrations")]
    async fn an_unknown_lot_type_is_rejected(pool: PgPool) {
        let (user_id, holding_id) = seed_holding(&pool, "owner@t.local").await;
        let err = save_lots(
            State(pool.clone()),
            auth(user_id),
            Path(holding_id),
            Json(dto::SaveLotsReq {
                adds: vec![add("dividend", (2024, 5, 2), "20", "10")],
                deletes: vec![],
            }),
        )
        .await
        .expect_err("only buy and sell are writable here");
        assert_eq!(err.status(), StatusCode::BAD_REQUEST);
    }

    /// Manual entry is the main path for securities, so the derived history
    /// must move now — and ONCE, not per row.
    #[sqlx::test(migrations = "../migrations")]
    async fn save_lots_rebuilds_the_derived_history(pool: PgPool) {
        let (user_id, holding_id) = seed_holding(&pool, "owner@t.local").await;
        let today = chrono::Utc::now().date_naive();
        gripsou_core::repo::snapshot::stamp_snapshot(
            &mut pool.acquire().await.unwrap(),
            holding_id,
            today,
            Decimal::new(100, 0),
            Decimal::new(1200, 0),
        )
        .await
        .unwrap();

        let derived_before: i64 =
            sqlx::query_scalar("select count(*) from holding_backfill where holding_id = $1")
                .bind(holding_id)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(derived_before, 0, "nothing derived yet");

        let lot_day = today - Duration::days(3);
        save_lots(
            State(pool.clone()),
            auth(user_id),
            Path(holding_id),
            Json(dto::SaveLotsReq {
                adds: vec![add(
                    "buy",
                    (lot_day.year(), lot_day.month(), lot_day.day()),
                    "20",
                    "10",
                )],
                deletes: vec![],
            }),
        )
        .await
        .unwrap();

        let derived_after: i64 =
            sqlx::query_scalar("select count(*) from holding_backfill where holding_id = $1")
                .bind(holding_id)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert!(derived_after > 0, "the lot must rebuild the history now");
    }

    /// The frontend disables Save in this state; rejecting it too would be a
    /// second rule for the same thing.
    #[sqlx::test(migrations = "../migrations")]
    async fn an_empty_batch_is_a_no_op(pool: PgPool) {
        let (user_id, holding_id) = seed_holding(&pool, "owner@t.local").await;
        let status = save_lots(
            State(pool.clone()),
            auth(user_id),
            Path(holding_id),
            Json(dto::SaveLotsReq {
                adds: vec![],
                deletes: vec![],
            }),
        )
        .await
        .expect("empty batch ok");
        assert_eq!(status, StatusCode::NO_CONTENT);
    }

    // ── admin-only server settings ──────────────────────────────────────────

    #[sqlx::test(migrations = "../migrations")]
    async fn budget_ai_models_rejects_unknown_provider(pool: PgPool) {
        let admin = seed_user_with_password(&pool, "a@t.local", "pw", "admin").await;
        let err = budget_ai_models(AdminUser { user_id: admin }, Path("nope".into()))
            .await
            .expect_err("not found");
        assert_eq!(err.status(), StatusCode::NOT_FOUND);
    }

    /// An admin's budget AI choice persists (trimmed) and reads back as written.
    #[sqlx::test(migrations = "../migrations")]
    async fn set_budget_ai_settings_persists(pool: PgPool) {
        let admin = seed_user_with_password(&pool, "a@t.local", "pw", "admin").await;
        let key = gripsou_jobs::categorizer_keys()[0];

        let status = set_budget_ai_settings(
            State(pool.clone()),
            AdminUser { user_id: admin },
            Json(dto::SetBudgetAiSettingsReq {
                provider: Some(format!("  {key} ")),
                model: Some(" some-model ".into()),
            }),
        )
        .await
        .expect("admin may set");
        assert_eq!(status, StatusCode::NO_CONTENT);

        let read = budget_ai_settings(State(pool.clone()), AdminUser { user_id: admin })
            .await
            .expect("admin may read")
            .0;
        assert_eq!(read.provider.as_deref(), Some(key));
        assert_eq!(read.model.as_deref(), Some("some-model"));
    }

    /// Blank strings switch the AI off (stored as null), rather than storing a
    /// provider named "" that the scheduler would then try to look up.
    #[sqlx::test(migrations = "../migrations")]
    async fn set_budget_ai_settings_blank_clears(pool: PgPool) {
        let admin = seed_user_with_password(&pool, "a@t.local", "pw", "admin").await;
        let key = gripsou_jobs::categorizer_keys()[0];
        gripsou_core::repo::settings::set_budget_ai(&pool, Some(key), Some("m"))
            .await
            .unwrap();

        set_budget_ai_settings(
            State(pool.clone()),
            AdminUser { user_id: admin },
            Json(dto::SetBudgetAiSettingsReq {
                provider: Some("   ".into()),
                model: Some("".into()),
            }),
        )
        .await
        .expect("admin may clear");
        let s = gripsou_core::repo::settings::budget_ai(&pool)
            .await
            .unwrap();
        assert_eq!((s.provider, s.model), (None, None));
    }

    /// A provider key outside the registry is a 400 and leaves the previous
    /// choice in place, so a typo cannot silently disable categorisation.
    #[sqlx::test(migrations = "../migrations")]
    async fn set_budget_ai_settings_rejects_unknown_provider(pool: PgPool) {
        let admin = seed_user_with_password(&pool, "a@t.local", "pw", "admin").await;
        let key = gripsou_jobs::categorizer_keys()[0];
        gripsou_core::repo::settings::set_budget_ai(&pool, Some(key), Some("m"))
            .await
            .unwrap();

        let err = set_budget_ai_settings(
            State(pool.clone()),
            AdminUser { user_id: admin },
            Json(dto::SetBudgetAiSettingsReq {
                provider: Some("no-such-provider".into()),
                model: Some("other".into()),
            }),
        )
        .await
        .unwrap_err();
        assert_eq!(err.status(), StatusCode::BAD_REQUEST);
        let s = gripsou_core::repo::settings::budget_ai(&pool)
            .await
            .unwrap();
        assert_eq!(s.provider.as_deref(), Some(key));
        assert_eq!(s.model.as_deref(), Some("m"));
    }

    // ── cross-user isolation ────────────────────────────────────────────────

    /// One user's data: their account, their holding (snapshotted today, so it
    /// shows in account lists) and one cash transaction described as `label`.
    struct Owned {
        user: Uuid,
        account: Uuid,
        holding: Uuid,
    }

    async fn seed_owned(pool: &PgPool, email: &str, label: &str) -> Owned {
        let (user, holding) = seed_holding(pool, email).await;
        let account: Uuid = sqlx::query_scalar("select account_id from holding where id = $1")
            .bind(holding)
            .fetch_one(pool)
            .await
            .unwrap();
        sqlx::query(
            "insert into holding_snapshot (holding_id, as_of, quantity, value) \
             values ($1, current_date, 100, 1200)",
        )
        .bind(holding)
        .execute(pool)
        .await
        .unwrap();
        sqlx::query(
            "insert into transaction (account_id, ts, type, amount, description) \
             values ($1, now(), 'deposit', 10, $2)",
        )
        .bind(account)
        .bind(label)
        .execute(pool)
        .await
        .unwrap();
        Owned {
            user,
            account,
            holding,
        }
    }

    fn no_txn_filters() -> TransactionParams {
        TransactionParams {
            search: None,
            account_id: None,
            bucket: None,
            from: None,
            to: None,
            category_ids: None,
            tag_ids: None,
            uncategorized: None,
            needs_review: None,
            include_transfers: None,
            limit: None,
            offset: None,
        }
    }

    /// Renaming another user's account by id must 404 and leave it untouched.
    #[sqlx::test(migrations = "../migrations")]
    async fn update_account_refuses_another_users_account(pool: PgPool) {
        let alice = seed_owned(&pool, "alice@t.local", "alice-txn").await;
        let bob = seed_owned(&pool, "bob@t.local", "bob-txn").await;

        let err = update_account(
            State(pool.clone()),
            auth(bob.user),
            Path(alice.account),
            Json(dto::UpdateAccountReq {
                name: "Hijacked".into(),
                type_key: "pea".into(),
                color: "#000000".into(),
            }),
        )
        .await
        .err()
        .expect("cross-user update must fail");
        assert_eq!(err.status(), StatusCode::NOT_FOUND);

        let name: String = sqlx::query_scalar("select name from account where id = $1")
            .bind(alice.account)
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(name, "PEA");
    }

    /// The owner's update persists and echoes the type's label.
    #[sqlx::test(migrations = "../migrations")]
    async fn update_account_persists_for_owner(pool: PgPool) {
        let alice = seed_owned(&pool, "alice@t.local", "alice-txn").await;

        let updated = update_account(
            State(pool.clone()),
            auth(alice.user),
            Path(alice.account),
            Json(dto::UpdateAccountReq {
                name: "Renamed".into(),
                type_key: "pea".into(),
                color: "#123456".into(),
            }),
        )
        .await
        .expect("owner may update")
        .0;
        assert_eq!(updated.name, "Renamed");
        assert_eq!(updated.type_label, "PEA");

        let (name, color): (String, Option<String>) =
            sqlx::query_as("select name, color from account where id = $1")
                .bind(alice.account)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(name, "Renamed");
        assert_eq!(color.as_deref(), Some("#123456"));
    }

    /// An account type that does not exist is refused (404) and writes nothing,
    /// so an account can never point at a type the UI cannot label.
    #[sqlx::test(migrations = "../migrations")]
    async fn update_account_rejects_unknown_type(pool: PgPool) {
        let alice = seed_owned(&pool, "alice@t.local", "alice-txn").await;

        let err = update_account(
            State(pool.clone()),
            auth(alice.user),
            Path(alice.account),
            Json(dto::UpdateAccountReq {
                name: "Renamed".into(),
                type_key: "no-such-type".into(),
                color: "#123456".into(),
            }),
        )
        .await
        .err()
        .expect("unknown type must fail");
        assert_eq!(err.status(), StatusCode::NOT_FOUND);

        let (name, type_key): (String, String) =
            sqlx::query_as("select name, type_key from account where id = $1")
                .bind(alice.account)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!((name.as_str(), type_key.as_str()), ("PEA", "pea"));
    }

    /// Another user's lots are not listed through their holding id.
    #[sqlx::test(migrations = "../migrations")]
    async fn holding_lots_hides_another_users_lots(pool: PgPool) {
        let alice = seed_owned(&pool, "alice@t.local", "alice-txn").await;
        let bob = seed_owned(&pool, "bob@t.local", "bob-txn").await;
        save_lots(
            State(pool.clone()),
            auth(alice.user),
            Path(alice.holding),
            Json(dto::SaveLotsReq {
                adds: vec![add("buy", (2024, 5, 2), "20", "10")],
                deletes: vec![],
            }),
        )
        .await
        .unwrap();

        let own = holding_lots(State(pool.clone()), auth(alice.user), Path(alice.holding))
            .await
            .expect("owner may list")
            .0;
        assert_eq!(own.len(), 1, "the seeded lot is visible to its owner");

        let theirs = holding_lots(State(pool.clone()), auth(bob.user), Path(alice.holding))
            .await
            .expect("an unowned holding lists as empty")
            .0;
        assert!(theirs.is_empty());
    }

    /// Suggestions on another user's holding are a 404, never an empty list:
    /// the endpoint must not confirm the existence of ids the caller can't see.
    #[sqlx::test(migrations = "../migrations")]
    async fn lot_suggestions_refuse_another_users_holding(pool: PgPool) {
        let alice = seed_owned(&pool, "alice@t.local", "alice-txn").await;
        let bob = seed_owned(&pool, "bob@t.local", "bob-txn").await;

        let own = lot_suggestions(State(pool.clone()), auth(alice.user), Path(alice.holding))
            .await
            .expect("owner may read")
            .0;
        assert!(own.is_empty(), "one snapshot, no jump, nothing to suggest");

        let err = lot_suggestions(State(pool.clone()), auth(bob.user), Path(alice.holding))
            .await
            .err()
            .expect("cross-user read must fail");
        assert_eq!(err.status(), StatusCode::NOT_FOUND);
    }

    /// Another user's price history is not served through their holding id.
    #[sqlx::test(migrations = "../migrations")]
    async fn holding_prices_hides_another_users_holding(pool: PgPool) {
        let alice = seed_owned(&pool, "alice@t.local", "alice-txn").await;
        let bob = seed_owned(&pool, "bob@t.local", "bob-txn").await;
        sqlx::query(
            "insert into price (instrument_id, ts, unit_price, currency) \
             select instrument_id, (current_date - 1)::timestamp at time zone 'UTC', 12, 'USD' \
             from holding where id = $1",
        )
        .bind(alice.holding)
        .execute(&pool)
        .await
        .unwrap();
        let range = || {
            Query(RangeParams {
                range: "1mo".into(),
            })
        };

        let own = holding_prices(
            State(pool.clone()),
            auth(alice.user),
            Path(alice.holding),
            range(),
        )
        .await
        .expect("owner may read")
        .0;
        assert_eq!(own.len(), 1, "the seeded price is visible to its owner");

        let theirs = holding_prices(
            State(pool.clone()),
            auth(bob.user),
            Path(alice.holding),
            range(),
        )
        .await
        .expect("an unowned holding reads as empty")
        .0;
        assert!(theirs.is_empty());
    }

    /// Previewing lots on another user's holding is a 404 (the preview writes
    /// and rolls back on that holding, so it must never get that far) and
    /// leaves the owner's lots intact.
    #[sqlx::test(migrations = "../migrations")]
    async fn preview_lots_refuses_another_users_holding(pool: PgPool) {
        let alice = seed_owned(&pool, "alice@t.local", "alice-txn").await;
        let bob = seed_owned(&pool, "bob@t.local", "bob-txn").await;
        save_lots(
            State(pool.clone()),
            auth(alice.user),
            Path(alice.holding),
            Json(dto::SaveLotsReq {
                adds: vec![add("buy", (2024, 5, 2), "20", "10")],
                deletes: vec![],
            }),
        )
        .await
        .unwrap();

        let err = preview_lots(
            State(pool.clone()),
            auth(bob.user),
            Path(alice.holding),
            Json(dto::PreviewLotsReq {
                rows: vec![add("buy", (2024, 5, 2), "1", "1")],
            }),
        )
        .await
        .err()
        .expect("cross-user preview must fail");
        assert_eq!(err.status(), StatusCode::NOT_FOUND);

        let lots: i64 = sqlx::query_scalar("select count(*) from lot where holding_id = $1")
            .bind(alice.holding)
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(lots, 1);
    }

    /// The owner's preview computes the basis of the given rows without saving them.
    #[sqlx::test(migrations = "../migrations")]
    async fn preview_lots_computes_without_writing(pool: PgPool) {
        let alice = seed_owned(&pool, "alice@t.local", "alice-txn").await;

        let preview = preview_lots(
            State(pool.clone()),
            auth(alice.user),
            Path(alice.holding),
            Json(dto::PreviewLotsReq {
                rows: vec![add("buy", (2024, 5, 2), "10", "15")],
            }),
        )
        .await
        .expect("owner may preview")
        .0;
        // The mean price is the given rows' own; `invested` would also carry
        // the part of the 100-unit position the 10 previewed units leave
        // unexplained, which is `lot_basis`'s business, not this endpoint's.
        assert_eq!(
            preview.mean_price.parse::<Decimal>().unwrap(),
            Decimal::new(15, 0)
        );

        let lots: i64 = sqlx::query_scalar("select count(*) from lot where holding_id = $1")
            .bind(alice.holding)
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(lots, 0, "a preview must not persist its rows");
    }

    /// A USD listing in a EUR account: the preview values the shares in euros
    /// before comparing them with what was paid, or the exchange rate reads as
    /// gain.
    #[sqlx::test(migrations = "../migrations")]
    async fn preview_lots_values_a_foreign_listing_in_the_account_currency(pool: PgPool) {
        use gripsou_core::testkit::{rate_on, seed_cash_instrument};
        let (user_id, holding_id) = seed_holding(&pool, "owner@t.local").await;
        let instrument: Uuid =
            sqlx::query_scalar("select instrument_id from holding where id = $1")
                .bind(holding_id)
                .fetch_one(&pool)
                .await
                .unwrap();
        let today = gripsou_core::repo::prefs::today(&pool, user_id)
            .await
            .unwrap();
        let usd = seed_cash_instrument(&pool, "USD").await;
        rate_on(&pool, usd, today, Decimal::new(5, 1)).await;
        let mut conn = pool.acquire().await.unwrap();
        gripsou_core::testkit::insert_price(
            &mut conn,
            instrument,
            today.and_hms_opt(0, 0, 0).unwrap().and_utc(),
            Decimal::new(30, 0),
            "USD",
        )
        .await
        .unwrap();
        drop(conn);

        let preview = preview_lots(
            State(pool.clone()),
            auth(user_id),
            Path(holding_id),
            Json(dto::PreviewLotsReq {
                rows: vec![add("buy", (2024, 5, 2), "10", "10")],
            }),
        )
        .await
        .unwrap()
        .0;
        // 10 shares x 30 USD x 0.5 EUR per USD = 150 EUR, whatever the basis.
        let invested: Decimal = preview.invested.parse().unwrap();
        let unrealised: Decimal = preview.unrealised.parse().unwrap();
        assert_eq!(invested + unrealised, Decimal::new(150, 0));
    }

    /// The accounts list shows only the caller's accounts.
    #[sqlx::test(migrations = "../migrations")]
    async fn accounts_lists_only_own(pool: PgPool) {
        let alice = seed_owned(&pool, "alice@t.local", "alice-txn").await;
        seed_owned(&pool, "bob@t.local", "bob-txn").await;

        let list = accounts(State(pool.clone()), auth(alice.user))
            .await
            .expect("list ok")
            .0;
        let ids: Vec<String> = list.into_iter().map(|a| a.id).collect();
        assert_eq!(ids, vec![alice.account.to_string()]);
    }

    /// The holdings list shows only the caller's holdings.
    #[sqlx::test(migrations = "../migrations")]
    async fn holdings_lists_only_own(pool: PgPool) {
        let alice = seed_owned(&pool, "alice@t.local", "alice-txn").await;
        seed_owned(&pool, "bob@t.local", "bob-txn").await;

        let list = holdings(State(pool.clone()), auth(alice.user))
            .await
            .expect("list ok")
            .0;
        let ids: Vec<String> = list.into_iter().map(|h| h.id).collect();
        assert_eq!(ids, vec![alice.holding.to_string()]);
    }

    /// The transactions list shows only the caller's transactions.
    #[sqlx::test(migrations = "../migrations")]
    async fn transactions_lists_only_own(pool: PgPool) {
        let alice = seed_owned(&pool, "alice@t.local", "alice-txn").await;
        seed_owned(&pool, "bob@t.local", "bob-txn").await;

        let list = transactions(
            State(pool.clone()),
            auth(alice.user),
            Query(no_txn_filters()),
        )
        .await
        .expect("list ok")
        .0;
        let descriptions: Vec<Option<String>> = list.into_iter().map(|t| t.description).collect();
        assert_eq!(descriptions, vec![Some("alice-txn".to_string())]);
    }

    /// Filtering on another user's account id returns nothing rather than
    /// that account's rows.
    #[sqlx::test(migrations = "../migrations")]
    async fn transactions_account_filter_cannot_reach_another_user(pool: PgPool) {
        let alice = seed_owned(&pool, "alice@t.local", "alice-txn").await;
        let bob = seed_owned(&pool, "bob@t.local", "bob-txn").await;

        let list = transactions(
            State(pool.clone()),
            auth(bob.user),
            Query(TransactionParams {
                account_id: Some(alice.account),
                ..no_txn_filters()
            }),
        )
        .await
        .expect("list ok")
        .0;
        assert!(list.is_empty());
    }

    /// The account-type picker is served from the reference table, with labels.
    #[sqlx::test(migrations = "../migrations")]
    async fn account_types_lists_reference_types(pool: PgPool) {
        let list = account_types(State(pool.clone())).await.expect("ok").0;
        let pea = list
            .iter()
            .find(|t| t.key == "pea")
            .expect("pea is a seeded type");
        assert_eq!(pea.label, "PEA");
    }

    // ── sessions and password reset ────────────────────────────────────────

    async fn session_alive(pool: &PgPool, id: Uuid) -> bool {
        sqlx::query_scalar::<_, i64>("select count(*) from session where id = $1")
            .bind(id)
            .fetch_one(pool)
            .await
            .unwrap()
            == 1
    }

    /// "Sign out everywhere else" keeps the caller's own session alive.
    #[sqlx::test(migrations = "../migrations")]
    async fn revoke_other_sessions_keeps_current(pool: PgPool) {
        seed_user_with_password(&pool, "a@t.local", "pw", "user").await;
        let current = principal_for(&pool, "a@t.local", "pw").await;
        principal_for(&pool, "a@t.local", "pw").await;
        let session_id = current.session_id;

        let status = revoke_other_sessions(State(pool.clone()), current)
            .await
            .expect("revoke ok");
        assert_eq!(status, StatusCode::NO_CONTENT);
        assert!(session_alive(&pool, session_id).await);
    }

    /// "Sign out everywhere else" revokes the caller's other sessions.
    #[sqlx::test(migrations = "../migrations")]
    async fn revoke_other_sessions_revokes_the_others(pool: PgPool) {
        seed_user_with_password(&pool, "a@t.local", "pw", "user").await;
        let current = principal_for(&pool, "a@t.local", "pw").await;
        let other = principal_for(&pool, "a@t.local", "pw").await;

        revoke_other_sessions(State(pool.clone()), current)
            .await
            .expect("revoke ok");
        assert!(!session_alive(&pool, other.session_id).await);
    }

    /// "Sign out everywhere else" never touches another user's sessions.
    #[sqlx::test(migrations = "../migrations")]
    async fn revoke_other_sessions_spares_other_users(pool: PgPool) {
        seed_user_with_password(&pool, "a@t.local", "pw", "user").await;
        seed_user_with_password(&pool, "b@t.local", "pw", "user").await;
        let a = principal_for(&pool, "a@t.local", "pw").await;
        let b = principal_for(&pool, "b@t.local", "pw").await;

        revoke_other_sessions(State(pool.clone()), a)
            .await
            .expect("revoke ok");
        assert!(session_alive(&pool, b.session_id).await);
    }

    async fn can_login(pool: &PgPool, email: &str, pw: &str) -> bool {
        login(
            State(pool.clone()),
            no_throttle(),
            axum::http::HeaderMap::new(),
            axum::extract::ConnectInfo("127.0.0.1:0".parse().unwrap()),
            Json(LoginReq {
                email: email.into(),
                password: pw.into(),
                remember: false,
            }),
        )
        .await
        .is_ok()
    }

    /// Store a reset link for `email`, issued by a fresh admin whose unique
    /// address can't collide with a test's own users.
    async fn mint_reset(pool: &PgPool, raw: &str, email: &str, expires_in: Duration) {
        let issuer = format!("issuer-{}@t.local", Uuid::new_v4());
        let admin = seed_user_with_password(pool, &issuer, "pw", "admin").await;
        gripsou_core::repo::invite_token::create(
            pool,
            "reset",
            Some(email),
            admin,
            &auth::hash_token_str(raw),
            Utc::now() + expires_in,
        )
        .await
        .unwrap();
    }

    async fn call_redeem_reset(
        pool: &PgPool,
        raw: &str,
        password: &str,
    ) -> Result<Json<dto::LoginResponse>, ApiError> {
        redeem_reset(
            State(pool.clone()),
            axum::http::HeaderMap::new(),
            axum::extract::ConnectInfo("127.0.0.1:0".parse().unwrap()),
            Path(raw.to_string()),
            Json(dto::RedeemResetReq {
                password: password.into(),
            }),
        )
        .await
    }

    /// A valid reset link sets the new password, kills the old one, signs out
    /// every old session and logs the user in.
    #[sqlx::test(migrations = "../migrations")]
    async fn redeem_reset_sets_password_and_revokes_sessions(pool: PgPool) {
        seed_user_with_password(&pool, "t@t.local", "old-pw", "user").await;
        let old_session = principal_for(&pool, "t@t.local", "old-pw").await;
        mint_reset(&pool, "raw-reset", "t@t.local", Duration::hours(1)).await;

        let resp = call_redeem_reset(&pool, "raw-reset", "new-password")
            .await
            .expect("redeem ok")
            .0;
        assert_eq!(resp.user.email, "t@t.local");
        assert!(
            gripsou_core::repo::session::find_valid_by_hash(&pool, &auth::hash_token(&resp.token))
                .await
                .unwrap()
                .is_some(),
            "the response logs the user in"
        );
        assert!(can_login(&pool, "t@t.local", "new-password").await);
        assert!(!can_login(&pool, "t@t.local", "old-pw").await);
        assert!(!session_alive(&pool, old_session.session_id).await);
    }

    /// A reset link works once: replaying it is a 404 and cannot overwrite the
    /// password chosen with it.
    #[sqlx::test(migrations = "../migrations")]
    async fn redeem_reset_token_is_single_use(pool: PgPool) {
        seed_user_with_password(&pool, "t@t.local", "old-pw", "user").await;
        mint_reset(&pool, "raw-reset", "t@t.local", Duration::hours(1)).await;
        assert!(
            call_redeem_reset(&pool, "raw-reset", "first-pw")
                .await
                .is_ok(),
            "first redeem ok"
        );

        let err = call_redeem_reset(&pool, "raw-reset", "second-pw")
            .await
            .expect_err("replay must fail");
        assert_eq!(err.status(), StatusCode::NOT_FOUND);
        assert!(can_login(&pool, "t@t.local", "first-pw").await);
        assert!(!can_login(&pool, "t@t.local", "second-pw").await);
    }

    /// An unknown reset token is a 404 and changes no password.
    #[sqlx::test(migrations = "../migrations")]
    async fn redeem_reset_unknown_token_is_404(pool: PgPool) {
        seed_user_with_password(&pool, "t@t.local", "old-pw", "user").await;
        let err = call_redeem_reset(&pool, "never-minted", "new-password")
            .await
            .expect_err("unknown token must fail");
        assert_eq!(err.status(), StatusCode::NOT_FOUND);
        assert!(can_login(&pool, "t@t.local", "old-pw").await);
    }

    /// An expired reset link is a 404 and changes no password.
    #[sqlx::test(migrations = "../migrations")]
    async fn redeem_reset_expired_token_is_404(pool: PgPool) {
        seed_user_with_password(&pool, "t@t.local", "old-pw", "user").await;
        mint_reset(&pool, "raw-reset", "t@t.local", Duration::hours(-1)).await;

        let err = call_redeem_reset(&pool, "raw-reset", "new-password")
            .await
            .expect_err("expired token must fail");
        assert_eq!(err.status(), StatusCode::NOT_FOUND);
        assert!(can_login(&pool, "t@t.local", "old-pw").await);
    }

    #[sqlx::test(migrations = "../migrations")]
    async fn reset_refuses_a_short_password(pool: PgPool) {
        seed_user_with_password(&pool, "t@t.local", "old-password", "user").await;
        mint_reset(&pool, "raw-short", "t@t.local", Duration::hours(1)).await;
        let err = call_redeem_reset(&pool, "raw-short", "1234567")
            .await
            .unwrap_err();
        assert_eq!(err.status(), StatusCode::BAD_REQUEST);
        // The link was not spent: a valid password still works with it.
        assert!(
            call_redeem_reset(&pool, "raw-short", "12345678")
                .await
                .is_ok()
        );
    }

    #[sqlx::test(migrations = "../migrations")]
    async fn change_password_refuses_a_short_password(pool: PgPool) {
        seed_user_with_password(&pool, "c@t.local", "old-password", "user").await;
        let who = principal_for(&pool, "c@t.local", "old-password").await;
        let err = change_password(
            State(pool.clone()),
            no_throttle(),
            axum::http::HeaderMap::new(),
            axum::extract::ConnectInfo("127.0.0.1:0".parse().unwrap()),
            who,
            Json(dto::ChangePasswordReq {
                current_password: "old-password".into(),
                new_password: "short".into(),
            }),
        )
        .await
        .unwrap_err();
        assert_eq!(err.status(), StatusCode::BAD_REQUEST);
        assert!(can_login(&pool, "c@t.local", "old-password").await);
    }

    #[sqlx::test(migrations = "../migrations")]
    async fn invite_refuses_a_short_password(pool: PgPool) {
        let admin = seed_admin_user(&pool).await;
        gripsou_core::repo::invite_token::create(
            &pool,
            "invite",
            None,
            admin,
            &auth::hash_token_str("raw-invite"),
            Utc::now() + Duration::hours(1),
        )
        .await
        .unwrap();
        let err = redeem_invite(
            State(pool.clone()),
            axum::http::HeaderMap::new(),
            axum::extract::ConnectInfo("127.0.0.1:0".parse().unwrap()),
            Path("raw-invite".to_string()),
            Json(dto::RedeemInviteReq {
                email: "new@t.local".into(),
                name: "New".into(),
                password: "1234567".into(),
            }),
        )
        .await
        .unwrap_err();
        assert_eq!(err.status(), StatusCode::BAD_REQUEST);
    }

    /// An empty new password is a 400 and does not burn the link, so the user
    /// can retry with a real one.
    #[sqlx::test(migrations = "../migrations")]
    async fn redeem_reset_rejects_empty_password(pool: PgPool) {
        seed_user_with_password(&pool, "t@t.local", "old-pw", "user").await;
        mint_reset(&pool, "raw-reset", "t@t.local", Duration::hours(1)).await;

        let err = call_redeem_reset(&pool, "raw-reset", "")
            .await
            .expect_err("empty password must fail");
        assert_eq!(err.status(), StatusCode::BAD_REQUEST);
        assert!(can_login(&pool, "t@t.local", "old-pw").await);
        assert!(
            gripsou_core::repo::invite_token::find_valid(&pool, &auth::hash_token_str("raw-reset"))
                .await
                .unwrap()
                .is_some()
        );
    }
}

#[cfg(test)]
mod budget_ai_usage_tests {
    use super::*;
    use std::collections::BTreeMap;

    async fn seed(pool: &PgPool, role: &str) -> Uuid {
        let email = format!("{}@t.local", Uuid::new_v4());
        gripsou_core::testkit::seed_user_as(pool, &email, role, "x").await
    }

    fn who(user_id: Uuid) -> AdminUser {
        AdminUser { user_id }
    }

    fn price(i: &str, o: &str) -> dto::BudgetAiPriceReq {
        dto::BudgetAiPriceReq {
            input: i.into(),
            output: o.into(),
        }
    }

    #[sqlx::test(migrations = "../migrations")]
    async fn prices_then_usage(pool: PgPool) {
        let admin = seed(&pool, "admin").await;
        for (tin, tout, complete) in [(9_495_459_i64, 4_484_808_i64, true), (0, 0, false)] {
            sqlx::query(
                "insert into budget_ai_run \
                 (user_id, model, tokens_in, tokens_out, usage_complete, outcome) \
                 values ($1, 'jev:jev-latest', $2, $3, $4, 'ok')",
            )
            .bind(admin)
            .bind(tin)
            .bind(tout)
            .bind(complete)
            .execute(&pool)
            .await
            .unwrap();
        }
        sqlx::query(
            "insert into budget_ai_run (user_id, model, tokens_in, tokens_out, outcome) \
             values ($1, 'alpha:x', 10, 10, 'ok')",
        )
        .bind(admin)
        .execute(&pool)
        .await
        .unwrap();

        let status = set_budget_ai_prices(
            State(pool.clone()),
            who(admin),
            Json(BTreeMap::from([
                ("jev:jev-latest".to_string(), price("0.042", "0")),
                ("unused:m".to_string(), price("1", "1")),
            ])),
        )
        .await
        .expect("prices saved");
        assert_eq!(status, StatusCode::NO_CONTENT);

        let v = serde_json::to_value(
            budget_ai_usage(State(pool.clone()), who(admin))
                .await
                .expect("usage")
                .0,
        )
        .unwrap();
        // 9.495459 * 0.042 = 0.398809278 → 0.3988
        assert_eq!(
            v,
            serde_json::json!({
                "currency": "USD",
                "models": [
                    {"model": "alpha:x", "runs": 1, "runsWithoutUsage": 0,
                     "tokensIn": 10, "tokensOut": 10,
                     "priceIn": null, "priceOut": null, "cost": null},
                    {"model": "jev:jev-latest", "runs": 2, "runsWithoutUsage": 1,
                     "tokensIn": 9495459, "tokensOut": 4484808,
                     "priceIn": "0.042", "priceOut": "0", "cost": "0.3988"}
                ],
                "totalCost": "0.3988"
            })
        );
    }

    #[sqlx::test(migrations = "../migrations")]
    async fn usage_with_no_runs_totals_zero(pool: PgPool) {
        let admin = seed(&pool, "admin").await;
        let v = serde_json::to_value(
            budget_ai_usage(State(pool.clone()), who(admin))
                .await
                .expect("usage")
                .0,
        )
        .unwrap();
        assert_eq!(
            v,
            serde_json::json!({"currency": "USD", "models": [], "totalCost": "0"})
        );
    }

    #[sqlx::test(migrations = "../migrations")]
    async fn bad_prices_are_a_400_and_change_nothing(pool: PgPool) {
        let admin = seed(&pool, "admin").await;
        for (i, o) in [
            ("-1", "0"),
            ("0", "-0.1"),
            ("abc", "0"),
            ("", "0"),
            ("0", "1e3x"),
        ] {
            let err = set_budget_ai_prices(
                State(pool.clone()),
                who(admin),
                Json(BTreeMap::from([("m:x".to_string(), price(i, o))])),
            )
            .await
            .expect_err("rejected");
            assert_eq!(err.status(), StatusCode::BAD_REQUEST, "{i} / {o}");
        }
        assert!(
            gripsou_core::repo::settings::budget_ai_prices(&pool)
                .await
                .unwrap()
                .is_empty()
        );
    }
}
