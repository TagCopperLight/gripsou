//! Pure mapping: Powens wire models -> gripsou canonical DTOs.

use gripsou_core::dto::{CanonicalAccount, CanonicalHolding, InstrumentRef};
use rust_decimal::Decimal;
use serde_json::json;

use crate::powens::model::{BankAccount, Investment};

/// Collapse a Powens `AccountTypeName` onto one of gripsou's seeded
/// `account_type` keys. Total: any unrecognized value falls back to `brokerage`.
pub fn map_type_key(name: &str) -> &'static str {
    match name {
        "checking" => "checking",
        "savings" | "livret_a" | "livret_b" | "ldds" | "cel" | "csl" | "cat" | "pel"
        | "deposit" => "savings",
        "pea" => "pea",
        _ => "brokerage",
    }
}

/// Map a Powens bank account onto a canonical account. The provider-supplied
/// `original_name` seeds the display name (gripsou later preserves user edits);
/// `meta` stashes provider specifics for debugging and the escape hatch.
pub fn map_account(acct: &BankAccount) -> CanonicalAccount {
    let type_name = acct
        .r#type
        .as_ref()
        .and_then(|t| t.name.as_deref())
        .unwrap_or("unknown");
    let is_invest = acct.r#type.as_ref().is_some_and(|t| t.is_invest);
    let currency = acct
        .currency
        .as_ref()
        .map(|c| c.id.clone())
        .unwrap_or_default();
    let name = acct
        .original_name
        .clone()
        .or_else(|| acct.name.clone())
        .unwrap_or_else(|| format!("Account {}", acct.id));

    CanonicalAccount {
        external_id: acct.id.to_string(),
        name,
        type_key: map_type_key(type_name).to_string(),
        currency,
        meta: json!({
            "powens_type": type_name,
            "is_invest": is_invest,
            "iban": acct.iban,
            "number": acct.number,
            "id_connection": acct.id_connection,
        }),
    }
}

fn instrument_currency(inv: &Investment, account_currency: &str) -> String {
    inv.original_currency
        .as_ref()
        .map(|c| c.id.clone())
        .unwrap_or_else(|| account_currency.to_string())
}

/// Map a single Powens investment to a canonical security holding. Returns
/// `None` when the investment is deleted or carries no usable instrument
/// identity (no ISIN, ticker, or code). `kind` is a generic `equity` because
/// Powens does not reliably distinguish equities from ETFs/funds; the core
/// dedups securities by ISIN, so this is harmless on the common path.
pub fn map_investment(inv: &Investment, account_currency: &str) -> Option<CanonicalHolding> {
    if inv.deleted.is_some() {
        return None;
    }

    let (isin, symbol) = match (inv.code_type.as_deref(), inv.code.as_deref()) {
        (Some("ISIN"), Some(code)) => (Some(code.to_string()), None),
        _ => (None, inv.stock_symbol.clone().or_else(|| inv.code.clone())),
    };
    if isin.is_none() && symbol.is_none() {
        return None;
    }

    let quantity = inv.quantity.unwrap_or(Decimal::ZERO);
    let unitprice = inv.unitprice.unwrap_or(Decimal::ZERO);

    Some(CanonicalHolding {
        account_external_id: inv.id_account.to_string(),
        instrument: InstrumentRef {
            kind: "equity".to_string(),
            symbol,
            isin,
            name: inv
                .label
                .clone()
                .unwrap_or_else(|| format!("Investment {}", inv.id)),
            currency: instrument_currency(inv, account_currency),
        },
        quantity,
        cost_basis: quantity * unitprice,
        valuation: inv.valuation,
    })
}
