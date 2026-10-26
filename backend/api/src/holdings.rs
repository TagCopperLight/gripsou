//! Holdings, their prices and returns, and the lots recorded against them.

use axum::Json;
use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use rust_decimal::Decimal;
use sqlx::PgPool;
use uuid::Uuid;

use crate::accounts::{RangeParams, range_window};
use crate::auth::AuthUser;
use crate::dto;
use crate::error::ApiError;

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
                source: dto::source_name(acc),
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

/// Today's price of one share in the holding's account currency — the domain
/// lots and their basis are in. `None` when the price or a rate is unknown.
async fn current_price(
    pool: &PgPool,
    user_id: Uuid,
    holding_id: Uuid,
) -> Result<Option<Decimal>, gripsou_core::error::CoreError> {
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
    Ok(price.flatten())
}

/// How many units of the reader's currency one unit of the holding's account
/// currency is worth today; `None` when either rate is unknown.
async fn account_to_reader_rate(
    pool: &PgPool,
    user_id: Uuid,
    holding_id: Uuid,
) -> Result<Option<Decimal>, gripsou_core::error::CoreError> {
    let rate = sqlx::query_scalar!(
        r#"
        select fx_asof(a.currency, user_today($2))
               / nullif(fx_asof(u.currency, user_today($2)), 0)
        from holding h
        join account a on a.id = h.account_id
        join users u on u.id = $2
        where h.id = $1
        "#,
        holding_id,
        user_id,
    )
    .fetch_optional(pool)
    .await?;
    Ok(rate.flatten())
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
    // An unknown price is no figure, not a total loss.
    let unrealised = price.map(|p| f.explained_qty * p - f.basis);
    let rate = account_to_reader_rate(&pool, user_id, holding_id).await?;
    let reporting = rate.map(|r| dto::BasisFigures {
        mean_price: (f.mean_price * r).to_string(),
        invested: (f.basis * r).to_string(),
        realised: (f.realised * r).to_string(),
        unrealised: unrealised.map(|u| (u * r).to_string()),
    });
    Ok(Json(dto::BasisPreview {
        mean_price: f.mean_price.to_string(),
        invested: f.basis.to_string(),
        realised: f.realised.to_string(),
        unrealised: unrealised.map(|u| u.to_string()),
        reporting,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::auth;
    use crate::testkit::*;
    use chrono::{Datelike, Duration, NaiveDate};
    use sqlx::PgPool;

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
        let unrealised: Decimal = preview.unrealised.unwrap().parse().unwrap();
        assert_eq!(invested + unrealised, Decimal::new(150, 0));
    }

    /// Before the listing's rate is known the preview has no unrealised
    /// figure, rather than valuing the shares at zero (a total loss).
    #[sqlx::test(migrations = "../migrations")]
    async fn preview_lots_leaves_unrealised_unknown_without_a_rate(pool: PgPool) {
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
        assert_eq!(preview.unrealised, None);
    }

    /// The figures also come in the reader's currency, converted from the
    /// account's, and are absent while that rate is unknown.
    #[sqlx::test(migrations = "../migrations")]
    async fn preview_lots_also_gives_the_figures_in_the_readers_currency(pool: PgPool) {
        use gripsou_core::testkit::{rate_on, seed_cash_instrument};
        let (user_id, holding_id) = seed_holding(&pool, "owner@t.local").await;
        sqlx::query("update account set currency = 'USD' where id = (select account_id from holding where id = $1)")
            .bind(holding_id)
            .execute(&pool)
            .await
            .unwrap();
        let today = gripsou_core::repo::prefs::today(&pool, user_id)
            .await
            .unwrap();
        let usd = seed_cash_instrument(&pool, "USD").await;
        rate_on(&pool, usd, today, Decimal::new(5, 1)).await;

        let p = preview_lots(
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
        let r = p.reporting.expect("a rate exists today");
        let half = |s: &str| s.parse::<Decimal>().unwrap() * Decimal::new(5, 1);
        assert_eq!(r.invested.parse::<Decimal>().unwrap(), half(&p.invested));
        assert_eq!(
            r.mean_price.parse::<Decimal>().unwrap(),
            half(&p.mean_price)
        );
        assert_eq!(r.realised.parse::<Decimal>().unwrap(), half(&p.realised));
    }

    #[sqlx::test(migrations = "../migrations")]
    async fn preview_lots_has_no_reporting_figures_without_a_rate(pool: PgPool) {
        let (user_id, holding_id) = seed_holding(&pool, "owner@t.local").await;
        sqlx::query("update account set currency = 'USD' where id = (select account_id from holding where id = $1)")
            .bind(holding_id)
            .execute(&pool)
            .await
            .unwrap();
        let p = preview_lots(
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
        assert!(p.reporting.is_none());
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
}
