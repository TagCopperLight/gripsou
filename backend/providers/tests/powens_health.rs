use gripsou_core::dto::SyncHealth;
use gripsou_providers::powens::testing::{
    map,
    model::{BankAccount, Connection},
};
use serde_json::json;

#[test]
fn source_failure_does_not_poison_checking_or_refresh_savings_date() {
    let accounts: Vec<BankAccount> = serde_json::from_value(json!([
        {"id":1,"type":"checking","id_connection":6,"id_source":8,"last_update":"2026-10-10 08:04:51"},
        {"id":2,"type":"savings","id_connection":6,"id_source":9,"last_update":"2026-10-08 12:00:00"}
    ])).unwrap();
    let connections: Vec<Connection> = serde_json::from_value(json!([
        {"id":6,"state":null,"last_update":"2026-10-10 08:04:51","sources":[
            {"id":8,"state":null},
            {"id":9,"state":"bug","error_message":"403 Client Error: Forbidden","next_try":"2026-10-11 08:09:26"}
        ]}
    ])).unwrap();
    let result = map::map_sync(&accounts, &[], &[], &connections);
    let day = |s| chrono::NaiveDate::parse_from_str(s, "%Y-%m-%d").ok();
    let health = |i: usize| result.accounts[i].health.clone().unwrap();
    assert_eq!(health(0).state, None);
    assert_eq!(result.health.unwrap().state.as_deref(), Some("bug"));
    assert_eq!(
        health(1),
        SyncHealth {
            verified: true,
            last_updated_on: day("2026-10-08"),
            state: Some("bug".into()),
            error_message: Some("403 Client Error: Forbidden".into()),
            next_retry_on: day("2026-10-11"),
        }
    );
    // The blocked savings account's balances are dated when Powens last read it.
    assert_eq!(result.accounts[0].balance_as_of, day("2026-10-10"));
    assert_eq!(result.accounts[1].balance_as_of, day("2026-10-08"));
}

#[test]
fn failed_lookup_is_unknown_and_disabled_source_errors_are_ignored() {
    let accounts: Vec<BankAccount> = serde_json::from_value(json!([
        {"id":1,"type":"checking","id_connection":6,"id_source":8,"last_update":"malformed"}
    ]))
    .unwrap();
    let result = map::map_sync(&accounts, &[], &[], &[]);
    let health = result.accounts[0].health.clone().unwrap();
    assert!(!health.verified);
    assert_eq!(health.last_updated_on, None);
    assert_eq!(result.accounts[0].balance_as_of, None);
    let connections: Vec<Connection> = serde_json::from_value(json!([
        {"id":6,"sources":[{"id":8,"disabled":"2026-10-01","state":"bug"}]}
    ]))
    .unwrap();
    let result = map::map_sync(&accounts, &[], &[], &connections);
    assert_eq!(result.accounts[0].health.clone().unwrap().state, None);
}
