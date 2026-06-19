//! Resolve a canonical `InstrumentRef` to a global `instrument` row id,
//! creating it if absent. Instruments are shared across all users.

use uuid::Uuid;

use crate::dto::InstrumentRef;
use crate::error::CoreError;

/// On conflict, the provider-supplied `name` is written (provider-authoritative;
/// instrument names are not user-editable, unlike `account.name`).
///
/// Known limitation (deferred): the same real security reported with an ISIN in
/// one sync and symbol-only in another resolves via two different natural keys
/// and can produce two `instrument` rows. Cross-key dedup is intentionally left
/// for when real provider payloads inform the rule.

fn brandfetch_logo_url(ins: &InstrumentRef) -> Option<String> {
    let base_url = match ins.kind.as_str() {
        "crypto" => ins.symbol.as_ref().map(|s| format!("https://cdn.brandfetch.io/crypto/{}", s)),
        _ => ins.isin.as_ref().map(|s| format!("https://cdn.brandfetch.io/isin/{}", s))
            .or_else(|| ins.symbol.as_ref().map(|s| format!("https://cdn.brandfetch.io/ticker/{}", s))),
    }?;

    let client_id = std::env::var("BRANDFETCH_CLIENT_ID").ok();
    
    let mut url = format!("{}/fallback/lettermark/theme/light", base_url);
    if let Some(c) = client_id {
        url.push_str(&format!("?c={}", c));
    }
    Some(url)
}

pub async fn resolve_instrument(
    conn: &mut sqlx::PgConnection,
    ins: &InstrumentRef,
) -> Result<Uuid, CoreError> {
    let logo_url = brandfetch_logo_url(ins);
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
            insert into instrument (kind, symbol, isin, name, currency, logo_url)
            values ($1, null, $2, $3, $4, $5)
            on conflict (isin) where isin is not null
            do update set name = excluded.name, logo_url = coalesce(instrument.logo_url, excluded.logo_url)
            returning id
            "#,
            ins.kind,
            isin,
            ins.name,
            ins.currency,
            logo_url,
        )
        .fetch_one(&mut *conn)
        .await?;
        return Ok(id);
    }

    if let Some(symbol) = &ins.symbol {
        let id = sqlx::query_scalar!(
            r#"
            insert into instrument (kind, symbol, isin, name, currency, logo_url)
            values ($1, $2, null, $3, $4, $5)
            on conflict (kind, symbol) where symbol is not null
            do update set name = excluded.name, logo_url = coalesce(instrument.logo_url, excluded.logo_url)
            returning id
            "#,
            ins.kind,
            symbol,
            ins.name,
            ins.currency,
            logo_url,
        )
        .fetch_one(&mut *conn)
        .await?;
        return Ok(id);
    }

    Err(CoreError::MissingInstrumentId {
        name: ins.name.clone(),
    })
}

pub async fn set_resolved_symbol(
    conn: &mut sqlx::PgConnection,
    instrument_id: Uuid,
    yahoo_symbol: &str,
) -> Result<(), CoreError> {
    let res = sqlx::query!(
        r#"
        update instrument
        set symbol = $2,
            meta = jsonb_set(
                jsonb_set(coalesce(meta, '{}'::jsonb), '{yahoo_symbol}', to_jsonb($2::text)),
                '{yahoo_resolved_at}', to_jsonb(now())
            )
        where id = $1
        "#,
        instrument_id,
        yahoo_symbol,
    )
    .execute(&mut *conn)
    .await;

    match &res {
        // A unique-index clash on the display `symbol` column (two instruments
        // resolving to the same Yahoo ticker): keep meta.yahoo_symbol so the
        // price pass still works, and leave `symbol` as it was.
        Err(sqlx::Error::Database(db_err)) if db_err.code().as_deref() == Some("23505") => {
            sqlx::query!(
                r#"
                update instrument
                set meta = jsonb_set(
                        jsonb_set(coalesce(meta, '{}'::jsonb), '{yahoo_symbol}', to_jsonb($2::text)),
                        '{yahoo_resolved_at}', to_jsonb(now())
                    )
                where id = $1
                "#,
                instrument_id,
                yahoo_symbol,
            )
            .execute(&mut *conn)
            .await?;
            Ok(())
        }
        _ => {
            res?;
            Ok(())
        }
    }
}

pub async fn mark_symbol_unresolved(
    conn: &mut sqlx::PgConnection,
    instrument_id: Uuid,
) -> Result<(), CoreError> {
    sqlx::query!(
        r#"
        update instrument
        set meta = jsonb_set(
            jsonb_set(coalesce(meta, '{}'::jsonb), '{yahoo_resolution}', '"unresolved"'),
            '{yahoo_resolved_at}', to_jsonb(now())
        )
        where id = $1
        "#,
        instrument_id,
    )
    .execute(&mut *conn)
    .await?;
    Ok(())
}
