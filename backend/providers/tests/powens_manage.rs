use gripsou_core::provider::AccountProvider;
use gripsou_providers::powens::PowensProvider;
use serde_json::json;
use wiremock::{
    Mock, MockServer, ResponseTemplate,
    matchers::{header, method, path, query_param},
};

#[tokio::test]
async fn manages_existing_connection_with_single_use_code_and_no_connect_callback() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/2.0/users/me/connections"))
        .and(header("Authorization", "Bearer private-token"))
        .respond_with(
            ResponseTemplate::new(200).set_body_json(json!({"connections":[{"id":6},{"id":13}]})),
        )
        .expect(1)
        .mount(&server)
        .await;
    Mock::given(method("GET"))
        .and(path("/2.0/auth/token/code"))
        .and(query_param("type", "singleAccess"))
        .and(header("Authorization", "Bearer private-token"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({"code":"single-code"})))
        .expect(1)
        .mount(&server)
        .await;
    let provider = PowensProvider::for_test(&server.uri());
    let url = provider
        .manage(
            &json!({"auth_token":"private-token"}),
            &json!({"external_connection_id":"13"}),
        )
        .await
        .unwrap()
        .redirect_url
        .unwrap();
    assert!(url.starts_with("https://webview.powens.com/en/manage?"));
    assert!(url.contains("connection_id=13"));
    assert!(url.contains("code=single-code"));
    assert!(!url.contains("private-token"));
    assert!(!url.contains("redirect_uri"));
    assert_eq!(server.received_requests().await.unwrap().len(), 2);
}

#[tokio::test]
async fn legacy_ids_resolve_only_for_a_single_connection() {
    for ids in [vec![6], vec![6, 13], vec![]] {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/2.0/users/me/connections"))
            .respond_with(ResponseTemplate::new(200).set_body_json(
                json!({"connections":ids.iter().map(|id|json!({"id":id})).collect::<Vec<_>>()}),
            ))
            .mount(&server)
            .await;
        Mock::given(method("GET"))
            .and(path("/2.0/auth/token/code"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({"code":"c"})))
            .expect(if ids.len() == 1 { 1 } else { 0 })
            .mount(&server)
            .await;
        let result = PowensProvider::for_test(&server.uri())
            .manage(&json!({"auth_token":"t"}), &json!({}))
            .await;
        assert_eq!(result.is_ok(), ids.len() == 1);
    }
}

#[tokio::test]
async fn wrong_stored_id_and_provider_failures_do_not_issue_a_manage_link() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/2.0/users/me/connections"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({"connections":[{"id":6}]})))
        .mount(&server)
        .await;
    let p = PowensProvider::for_test(&server.uri());
    assert!(
        p.manage(
            &json!({"auth_token":"t"}),
            &json!({"external_connection_id":"13"})
        )
        .await
        .is_err()
    );
    assert!(
        p.manage(&json!({"auth_token":"t"}), &json!({}))
            .await
            .is_err()
    ); // no code endpoint
    assert!(p.manage(&json!({}), &json!({})).await.is_err());
}
