use gripsou_providers::powens::{
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
    let mut result = map::map_sync(&accounts, &[], &[]);
    map::apply_health(&mut result, &accounts, &connections);
    assert_eq!(result.accounts[0].meta["sync_health"]["state"], json!(null));
    assert_eq!(result.provider_meta["sync_health"]["state"], "bug");
    let savings = &result.accounts[1].meta["sync_health"];
    assert_eq!(savings["lastUpdatedOn"], "2026-10-08");
    assert_eq!(savings["state"], "bug");
    assert_eq!(savings["nextRetryOn"], "2026-10-11");
    assert_eq!(savings["errorMessage"], "403 Client Error: Forbidden");
}

#[test]
fn failed_lookup_is_unknown_and_disabled_source_errors_are_ignored() {
    let accounts: Vec<BankAccount> = serde_json::from_value(json!([
        {"id":1,"type":"checking","id_connection":6,"id_source":8,"last_update":"malformed"}
    ]))
    .unwrap();
    let mut result = map::map_sync(&accounts, &[], &[]);
    map::apply_health(&mut result, &accounts, &[]);
    assert_eq!(result.accounts[0].meta["sync_health"]["verified"], false);
    assert_eq!(
        result.accounts[0].meta["sync_health"]["lastUpdatedOn"],
        json!(null)
    );
    let connections: Vec<Connection> = serde_json::from_value(json!([
        {"id":6,"sources":[{"id":8,"disabled":"2026-10-01","state":"bug"}]}
    ]))
    .unwrap();
    map::apply_health(&mut result, &accounts, &connections);
    assert_eq!(result.accounts[0].meta["sync_health"]["state"], json!(null));
}
