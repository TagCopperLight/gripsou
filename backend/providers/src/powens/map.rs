//! Pure mapping: Powens wire models -> gripsou canonical DTOs.

use gripsou_core::dto::CanonicalAccount;
use serde_json::json;

use crate::powens::model::BankAccount;

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
