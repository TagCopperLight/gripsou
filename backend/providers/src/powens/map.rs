//! Pure mapping: Powens wire models -> gripsou canonical DTOs.

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
