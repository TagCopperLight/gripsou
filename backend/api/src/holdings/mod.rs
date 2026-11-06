//! Holdings, their prices and returns, and the lots recorded against them.

pub mod dto;

use crate::error::Json;
use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use gripsou_core::repo::lot::{self, LotChanges, NewLot};
use rust_decimal::Decimal;
use sqlx::PgPool;
use uuid::Uuid;

use crate::auth::AuthUser;
use crate::error::ApiError;
use crate::routes::Routes;
use crate::wire::RangeParams;

pub async fn holdings(
    State(pool): State<PgPool>,
    State(jobs): State<std::sync::Arc<gripsou_jobs::Deps>>,
    AuthUser { user_id, .. }: AuthUser,
) -> Result<Json<Vec<dto::Holding>>, ApiError> {
    let rows = gripsou_core::repo::valuation::holdings(&pool, user_id).await?;
    let providers = jobs.providers();
    Ok(Json(
        rows.into_iter()
            .map(|r| dto::Holding::from_row(r, providers.logos()))
            .collect(),
    ))
}

pub async fn investment_returns(
    State(pool): State<PgPool>,
    AuthUser { user_id, .. }: AuthUser,
) -> Result<Json<dto::InvestmentReturns>, ApiError> {
    let inputs = gripsou_core::repo::returns::load(&pool, user_id).await?;
    let accounts = gripsou_core::repo::valuation::accounts(&pool, user_id).await?;
    let r = gripsou_core::returns::returns(&inputs.positions, &inputs.flows, inputs.today);

    // `valuation::accounts` lists every account it can value from snapshots, which
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
                source: crate::accounts::dto::source_name(acc),
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
    let (from, to) = p.window(&pool, user_id).await?;
    let rows = gripsou_core::repo::valuation::holding_prices(
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

/// Parse a batch of lot adds, shared by `save_lots` and `preview_lots` so the
/// number shown while editing and the number accepted on save reject the same
/// inputs.
fn parse_lot_adds(adds: &[dto::LotEntry]) -> Result<Vec<NewLot>, ApiError> {
    let bad = ApiError::bad_request;
    adds.iter()
        .map(|a| {
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
            NewLot::new(a.kind, a.date, quantity, unit_price, fee).map_err(bad)
        })
        .collect()
}

/// Apply a batch of manual lot adds and deletes atomically.
pub async fn save_lots(
    State(pool): State<PgPool>,
    AuthUser { user_id, .. }: AuthUser,
    Path(holding_id): Path<Uuid>,
    Json(req): Json<dto::SaveLotsReq>,
) -> Result<StatusCode, ApiError> {
    let changes = LotChanges::edit(parse_lot_adds(&req.adds)?, req.deletes);
    lot::save(&pool, user_id, holding_id, &changes).await?;
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
    let rows = gripsou_core::repo::lot_suggest::suggest_lots(&pool, user_id, holding_id).await?;
    Ok(Json(
        rows.into_iter()
            .map(dto::LotSuggestion::from_suggestion)
            .collect(),
    ))
}

/// What the figures would be if `rows` were the holding's manual lots.
pub async fn preview_lots(
    State(pool): State<PgPool>,
    AuthUser { user_id, .. }: AuthUser,
    Path(holding_id): Path<Uuid>,
    Json(req): Json<dto::PreviewLotsReq>,
) -> Result<Json<dto::BasisPreview>, ApiError> {
    let changes = LotChanges::replace_manual(parse_lot_adds(&req.rows)?);
    let preview = lot::basis_preview(&pool, user_id, holding_id, &changes).await?;
    Ok(Json(dto::BasisPreview::from_core(preview)))
}

pub(crate) fn routes() -> Routes {
    Routes::default()
        .get("/holdings", holdings)
        .get("/investments/returns", investment_returns)
        .get("/holdings/{id}/prices", holding_prices)
        .get("/holdings/{id}/lots", holding_lots)
        .put("/holdings/{id}/lots", save_lots)
        .post("/holdings/{id}/lots/preview", preview_lots)
        .get("/holdings/{id}/lots/suggestions", lot_suggestions)
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
        let user_id = seed_admin(&pool, "a@t.local").await;
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
        let year_ago = chrono::Utc::now().date_naive() - Duration::days(365);
        gripsou_core::testkit::seed_lot(
            &pool,
            holding_id,
            gripsou_core::testkit::Lot::buy(year_ago, Decimal::from(2), Decimal::from(100)),
        )
        .await;

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
        let figure = |f: &Option<String>| f.as_deref().map(|s| s.parse::<Decimal>().unwrap());
        assert_eq!(figure(&a.figures.invested), Some(Decimal::from(200)));
        assert_eq!(figure(&a.figures.received), Some(Decimal::ZERO));
        assert!(a.figures.since.is_some());
    }

    fn add(kind: &str, day: (i32, u32, u32), quantity: &str, unit_price: &str) -> dto::LotEntry {
        dto::LotEntry {
            kind: gripsou_core::repo::lot::LotSide::parse(kind).unwrap(),
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
            health: None,
            balance_as_of: None,
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

    /// The caller owns BOTH holdings: the row belongs to holding A, and the
    /// delete is aimed at holding B. It must be refused, or a user could delete
    /// their own manual lot through the wrong holding's endpoint and silently
    /// corrupt that holding's cost basis.
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
                range: crate::wire::Range::Month,
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
            preview.account.mean_price.parse::<Decimal>().unwrap(),
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
        let invested: Decimal = preview.account.invested.parse().unwrap();
        let unrealised: Decimal = preview.account.unrealised.unwrap().parse().unwrap();
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
        assert_eq!(preview.account.unrealised, None);
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
        assert_eq!(
            r.invested.parse::<Decimal>().unwrap(),
            half(&p.account.invested)
        );
        assert_eq!(
            r.mean_price.parse::<Decimal>().unwrap(),
            half(&p.account.mean_price)
        );
        assert_eq!(
            r.realised.parse::<Decimal>().unwrap(),
            half(&p.account.realised)
        );
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

        let list = holdings(State(pool.clone()), State(deps()), auth(alice.user))
            .await
            .expect("list ok")
            .0;
        let ids: Vec<String> = list.into_iter().map(|h| h.id).collect();
        assert_eq!(ids, vec![alice.holding.to_string()]);
    }
}
