//! Resolve a canonical `InstrumentRef` to a global `instrument` row id,
//! creating it if absent, and record what the market-data passes learn about
//! it. Instruments are shared across all users.

use uuid::Uuid;

use crate::dto::{Composition, InstrumentRef};
use crate::error::CoreError;

/// An instrument a market-data pass works on.
pub struct InstrumentRow {
    pub id: Uuid,
    pub kind: String,
    pub symbol: Option<String>,
    pub isin: Option<String>,
    pub name: String,
    pub currency: String,
    pub meta: serde_json::Value,
}

/// What a market-data provider learns of an instrument is kept in its `meta`
/// under the provider's key: `{key}_symbol` for the symbol it resolved,
/// `{key}_resolution = "unresolved"` when it found none.
impl InstrumentRow {
    /// The symbol `provider_key` resolved this instrument to.
    pub fn provider_symbol(&self, provider_key: &str) -> Option<&str> {
        self.meta
            .get(format!("{provider_key}_symbol"))
            .and_then(|v| v.as_str())
    }

    /// Whether `provider_key` found no symbol for it.
    pub fn unresolved_by(&self, provider_key: &str) -> bool {
        self.meta
            .get(format!("{provider_key}_resolution"))
            .and_then(|v| v.as_str())
            == Some("unresolved")
    }

    pub fn instrument_ref(&self) -> InstrumentRef {
        InstrumentRef {
            kind: self.kind.clone(),
            symbol: self.symbol.clone(),
            isin: self.isin.clone(),
            name: self.name.clone(),
            currency: self.currency.clone(),
        }
    }
}

/// On conflict, the provider-supplied `name` is written (provider-authoritative;
/// instrument names are not user-editable, unlike `account.name`).
///
/// Known limitation (deferred): the same real security reported with an ISIN in
/// one sync and symbol-only in another resolves via two different natural keys
/// and can produce two `instrument` rows. Cross-key dedup is intentionally left
/// for when real provider payloads inform the rule.
pub async fn resolve_instrument(
    conn: &mut sqlx::PgConnection,
    ins: &InstrumentRef,
) -> Result<Uuid, CoreError> {
    // The provider's name for the currency replaces the one stored.
    if ins.kind == "cash" {
        let id = sqlx::query_scalar!(
            r#"
            insert into instrument (kind, symbol, isin, name, currency)
            values ('cash', null, null, $1, $2)
            on conflict (currency) where kind = 'cash'
            do update set name = excluded.name
            returning id
            "#,
            ins.name,
            ins.currency,
        )
        .fetch_one(&mut *conn)
        .await?;
        return Ok(id);
    }

    if let Some(isin) = &ins.isin {
        // ISIN is the identity for this path, so `symbol` is deliberately stored
        // as null. Ticker symbols are not globally unique (the same ticker maps to
        // different ISINs across exchanges), so persisting it here would collide on
        // the `(kind, symbol)` partial unique index. `symbol` is populated only on
        // the symbol-only path below, where no ISIN is available to identify the row.
        let id = sqlx::query_scalar!(
            r#"
            insert into instrument (kind, symbol, isin, name, currency)
            values ($1, null, $2, $3, $4)
            on conflict (isin) where isin is not null
            do update set name = excluded.name
            returning id
            "#,
            ins.kind,
            isin,
            ins.name,
            ins.currency,
        )
        .fetch_one(&mut *conn)
        .await?;
        return Ok(id);
    }

    if let Some(symbol) = &ins.symbol {
        let id = sqlx::query_scalar!(
            r#"
            insert into instrument (kind, symbol, isin, name, currency)
            values ($1, $2, null, $3, $4)
            on conflict (kind, symbol) where symbol is not null
            do update set name = excluded.name
            returning id
            "#,
            ins.kind,
            symbol,
            ins.name,
            ins.currency,
        )
        .fetch_one(&mut *conn)
        .await?;
        return Ok(id);
    }

    Err(CoreError::MissingInstrumentId {
        name: ins.name.clone(),
    })
}

/// The cash instrument of `currency` (an FX rate is its price), created
/// named after the currency when absent.
pub async fn ensure_cash(
    conn: &mut sqlx::PgConnection,
    currency: &str,
) -> Result<InstrumentRow, CoreError> {
    let row = sqlx::query_as!(
        InstrumentRow,
        r#"
        with ins as (
            insert into instrument (kind, symbol, isin, name, currency)
            values ('cash', null, null, $1, $1)
            on conflict (currency) where kind = 'cash' do nothing
            returning id, kind, symbol, isin, name, currency, meta
        )
        select id as "id!", kind as "kind!", symbol, isin, name as "name!",
               currency as "currency!", meta as "meta!"
        from ins
        union all
        select id, kind, symbol, isin, name, currency, meta
        from instrument where kind = 'cash' and currency = $1
        "#,
        currency,
    )
    .fetch_one(&mut *conn)
    .await?;
    Ok(row)
}

/// Caches the symbol `provider_key` resolved the instrument to.
///
/// Writes to `meta` only. `symbol` and `kind` are half of the natural key the
/// next sync re-resolves this row by (`instrument_kind_symbol_uq`), so nothing
/// after the initial insert may touch them: rewriting `symbol` to a provider's
/// ticker makes the next `resolve_instrument` miss, insert a duplicate
/// instrument and a duplicate holding, and lets ingest's close loop zero the
/// original, losing that position's history.
pub async fn set_symbol(
    conn: &mut sqlx::PgConnection,
    instrument_id: Uuid,
    provider_key: &str,
    symbol: &str,
) -> Result<(), CoreError> {
    sqlx::query!(
        r#"
        update instrument
        set meta = coalesce(meta, '{}'::jsonb) || jsonb_build_object($3::text || '_symbol', $2::text)
        where id = $1
        "#,
        instrument_id,
        symbol,
        provider_key,
    )
    .execute(&mut *conn)
    .await?;
    Ok(())
}

/// Records that `provider_key` has no symbol for the instrument, so it is
/// not asked again.
pub async fn mark_unresolved(
    conn: &mut sqlx::PgConnection,
    instrument_id: Uuid,
    provider_key: &str,
) -> Result<(), CoreError> {
    sqlx::query!(
        r#"
        update instrument
        set meta = coalesce(meta, '{}'::jsonb)
                   || jsonb_build_object($2::text || '_resolution', 'unresolved')
        where id = $1
        "#,
        instrument_id,
        provider_key,
    )
    .execute(&mut *conn)
    .await?;
    Ok(())
}

pub async fn mark_composition_none(
    conn: &mut sqlx::PgConnection,
    instrument_id: Uuid,
) -> Result<(), CoreError> {
    sqlx::query!(
        r#"
        update instrument
        set meta = jsonb_set(coalesce(meta, '{}'::jsonb), '{composition_status}', '"none"')
        where id = $1
        "#,
        instrument_id,
    )
    .execute(&mut *conn)
    .await?;
    Ok(())
}

pub async fn set_composition(
    conn: &mut sqlx::PgConnection,
    instrument_id: Uuid,
    composition: &Composition,
) -> Result<(), CoreError> {
    let mut value = serde_json::to_value(composition)?;
    value["as_of"] = serde_json::json!(crate::repo::price::market_today().to_string());
    sqlx::query!(
        r#"
        update instrument
        set meta = jsonb_set(coalesce(meta, '{}'::jsonb), '{composition}', $2)
        where id = $1
        "#,
        instrument_id,
        value,
    )
    .execute(&mut *conn)
    .await?;
    Ok(())
}
