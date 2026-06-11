use gripsou_providers::powens::map;
use gripsou_providers::powens::model::{BankAccount, Investment};
use rust_decimal::Decimal;
use serde::Deserialize;

#[derive(Deserialize, Default)]
struct Fixture {
    #[serde(default)]
    accounts: Vec<BankAccount>,
    #[serde(default)]
    investments: Vec<Investment>,
}

fn load(name: &str) -> Fixture {
    let path = format!("{}/tests/fixtures/powens/{name}", env!("CARGO_MANIFEST_DIR"));
    let raw = std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("read {path}: {e}"));
    serde_json::from_str(&raw).unwrap_or_else(|e| panic!("parse {path}: {e}"))
}

fn dec(s: &str) -> Decimal {
    s.parse().unwrap()
}

fn account(fx: &Fixture, id: i64) -> &BankAccount {
    fx.accounts.iter().find(|a| a.id == id).expect("account in fixture")
}

fn investment(fx: &Fixture, id: i64) -> &Investment {
    fx.investments.iter().find(|i| i.id == id).expect("investment in fixture")
}

#[test]
fn maps_account_types_onto_seeded_keys() {
    assert_eq!(map::map_type_key("checking"), "checking");
    for t in ["savings", "livret_a", "livret_b", "ldds", "cel", "csl", "cat", "pel", "deposit"] {
        assert_eq!(map::map_type_key(t), "savings", "{t}");
    }
    assert_eq!(map::map_type_key("pea"), "pea");
    assert_eq!(map::map_type_key("market"), "brokerage");
    // Everything else falls back to brokerage, including future/unknown values.
    for t in ["lifeinsurance", "per", "perco", "perp", "pee", "loan", "unknown", "totally_new"] {
        assert_eq!(map::map_type_key(t), "brokerage", "{t}");
    }
}

#[test]
fn parses_bank_account_decimals_exactly() {
    let fx = load("accounts.json");
    let acct = account(&fx, 1001);
    assert_eq!(acct.balance, Some(dec("1234.56")));
    assert_eq!(acct.currency.as_ref().unwrap().id, "EUR");
    assert_eq!(acct.r#type.as_ref().unwrap().name.as_deref(), Some("checking"));
    assert!(!acct.r#type.as_ref().unwrap().is_invest);
}

#[test]
fn parses_investment_decimals_exactly() {
    let fx = load("investments.json");
    let inv = investment(&fx, 2001);
    assert_eq!(inv.quantity, Some(dec("10")));
    assert_eq!(inv.unitprice, Some(dec("150.00")));
    assert_eq!(inv.valuation, Some(dec("1600.00")));
    assert_eq!(inv.code_type.as_deref(), Some("ISIN"));
}

#[test]
fn maps_account_identity_and_meta() {
    let fx = load("accounts.json");
    let dto = map::map_account(account(&fx, 1001));
    assert_eq!(dto.external_id, "1001");
    assert_eq!(dto.name, "Compte Courant");
    assert_eq!(dto.type_key, "checking");
    assert_eq!(dto.currency, "EUR");
    assert_eq!(dto.meta["powens_type"], "checking");
    assert_eq!(dto.meta["is_invest"], false);
    assert_eq!(dto.meta["iban"], "FR7612345678901234567890123");
    assert_eq!(dto.meta["id_connection"], 42);
}

#[test]
fn maps_invest_account_type_to_fallback() {
    let fx = load("accounts.json");
    let dto = map::map_account(account(&fx, 1003));
    assert_eq!(dto.type_key, "brokerage");
    assert_eq!(dto.meta["is_invest"], true);
}

#[test]
fn falls_back_to_synthetic_name_when_unnamed() {
    let fx = load("accounts.json");
    let dto = map::map_account(account(&fx, 1004));
    assert_eq!(dto.name, "Account 1004");
}
