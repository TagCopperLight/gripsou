use chrono::NaiveDate;
use gripsou_core::categorize::{
    CategorizeError, CategorizeItem, CategorizeRequest, Categorizer, CategoryOption, Example,
};
use gripsou_providers::gemini::GeminiCategorizer;
use rust_decimal::Decimal;
use uuid::Uuid;
use wiremock::matchers::{header, method, path};
use wiremock::{Mock, MockServer, Request, ResponseTemplate};

const GROCERIES: &str = "11111111-1111-1111-1111-111111111111";
const IGNORE: &str = "22222222-2222-2222-2222-222222222222";

fn request() -> CategorizeRequest {
    let groceries = Uuid::parse_str(GROCERIES).unwrap();
    let ignore = Uuid::parse_str(IGNORE).unwrap();
    let item = |n: u128, desc: &str| CategorizeItem {
        key: Uuid::from_u128(n),
        description: desc.into(),
        amount: Decimal::new(-1250, 2),
        currency: "EUR".into(),
        account_type: "checking".into(),
        date: NaiveDate::from_ymd_opt(2026, 9, 1).unwrap(),
        candidates: vec![groceries, ignore],
        examples: vec![Example {
            description: "LECLERC 0412".into(),
            amount: Decimal::new(-3000, 2),
            currency: "EUR".into(),
            account_type: "checking".into(),
            date: NaiveDate::from_ymd_opt(2026, 8, 1).unwrap(),
            category_id: groceries,
        }],
    };
    CategorizeRequest {
        categories: vec![
            CategoryOption {
                id: groceries,
                name: "Groceries".into(),
                kind: "expense".into(),
                hint: Some("supermarkets".into()),
            },
            CategoryOption {
                id: ignore,
                name: "Ignore".into(),
                kind: "excluded".into(),
                hint: None,
            },
        ],
        shared_examples: vec![],
        items: vec![item(1, "LECLERC 0999"), item(2, "PAYPAL *XYZ")],
    }
}

fn fixture() -> serde_json::Value {
    serde_json::from_str(include_str!("fixtures/gemini/generate_content.json")).unwrap()
}

#[tokio::test]
async fn maps_the_answer_array_back_onto_items() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/v1beta/models/test-model:generateContent"))
        .and(header("x-goog-api-key", "k"))
        .respond_with(ResponseTemplate::new(200).set_body_json(fixture()))
        .mount(&server)
        .await;
    let g = GeminiCategorizer::new("k".into(), "test-model".into()).with_base_url(server.uri());

    let out = g.categorize(&request()).await.unwrap();

    assert_eq!(out.tokens_in, Some(1234));
    assert_eq!(out.tokens_out, Some(56));
    assert_eq!(out.guesses.len(), 2, "the out-of-range index 7 is dropped");
    let first = &out.guesses[0];
    assert_eq!(first.key, Uuid::from_u128(1));
    assert_eq!(first.category_id, Some(Uuid::parse_str(GROCERIES).unwrap()));
    assert_eq!(first.confidence, Some(Decimal::new(91, 2)));
    assert_eq!(out.guesses[1].key, Uuid::from_u128(2));
    assert_eq!(out.guesses[1].category_id, None);
}

/// Thinking tokens are billed as output, so they count toward `tokens_out`.
#[tokio::test]
async fn thinking_tokens_count_as_output() {
    let server = MockServer::start().await;
    let mut body = fixture();
    body["usageMetadata"]["thoughtsTokenCount"] = serde_json::json!(100);
    Mock::given(method("POST"))
        .respond_with(ResponseTemplate::new(200).set_body_json(body))
        .mount(&server)
        .await;
    let g = GeminiCategorizer::new("k".into(), "test-model".into()).with_base_url(server.uri());

    let out = g.categorize(&request()).await.unwrap();

    assert_eq!(out.tokens_in, Some(1234));
    assert_eq!(out.tokens_out, Some(156));
}

/// No usage at all stays unknown rather than becoming zero.
#[tokio::test]
async fn missing_usage_stays_unknown() {
    let server = MockServer::start().await;
    let mut body = fixture();
    body.as_object_mut().unwrap().remove("usageMetadata");
    Mock::given(method("POST"))
        .respond_with(ResponseTemplate::new(200).set_body_json(body))
        .mount(&server)
        .await;
    let g = GeminiCategorizer::new("k".into(), "test-model".into()).with_base_url(server.uri());

    let out = g.categorize(&request()).await.unwrap();

    assert_eq!(out.tokens_in, None);
    assert_eq!(out.tokens_out, None);
}

#[tokio::test]
async fn the_schema_restricts_category_ids_to_the_candidates() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .respond_with(ResponseTemplate::new(200).set_body_json(fixture()))
        .mount(&server)
        .await;
    let g = GeminiCategorizer::new("k".into(), "m".into()).with_base_url(server.uri());
    g.categorize(&request()).await.unwrap();

    let received: Vec<Request> = server.received_requests().await.unwrap();
    let body: serde_json::Value = serde_json::from_slice(&received[0].body).unwrap();
    let schema = &body["generationConfig"]["responseSchema"];
    assert_eq!(
        body["generationConfig"]["responseMimeType"],
        "application/json"
    );
    let mut ids: Vec<String> = schema["items"]["properties"]["category_id"]["enum"]
        .as_array()
        .unwrap()
        .iter()
        .map(|v| v.as_str().unwrap().to_string())
        .collect();
    ids.sort();
    assert_eq!(ids, vec![GROCERIES.to_string(), IGNORE.to_string()]);
    // The transaction id never reaches the model.
    let text = body["contents"][0]["parts"][0]["text"].as_str().unwrap();
    assert!(!text.contains(&Uuid::from_u128(1).to_string()));
    assert!(text.contains("LECLERC 0999"));
    assert!(text.contains("supermarkets"), "the hint steers the model");
}

#[tokio::test]
async fn http_429_is_rate_limited() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .respond_with(ResponseTemplate::new(429).set_body_json(serde_json::json!({
            "error": { "code": 429, "status": "RESOURCE_EXHAUSTED", "message": "quota" }
        })))
        .mount(&server)
        .await;
    let g = GeminiCategorizer::new("k".into(), "m".into()).with_base_url(server.uri());
    assert!(matches!(
        g.categorize(&request()).await,
        Err(CategorizeError::RateLimited)
    ));
}

#[tokio::test]
async fn other_failures_carry_the_message() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .respond_with(ResponseTemplate::new(400).set_body_json(serde_json::json!({
            "error": { "code": 400, "status": "INVALID_ARGUMENT", "message": "API key not valid" }
        })))
        .mount(&server)
        .await;
    let g = GeminiCategorizer::new("k".into(), "m".into()).with_base_url(server.uri());
    match g.categorize(&request()).await {
        Err(CategorizeError::Other(m)) => assert!(m.contains("API key not valid"), "{m}"),
        other => panic!("expected Other, got {other:?}"),
    }
}

#[tokio::test]
async fn an_unparseable_answer_is_an_error_not_a_panic() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "candidates": [{ "content": { "parts": [{ "text": "not json" }] } }]
        })))
        .mount(&server)
        .await;
    let g = GeminiCategorizer::new("k".into(), "m".into()).with_base_url(server.uri());
    assert!(matches!(
        g.categorize(&request()).await,
        Err(CategorizeError::Other(_))
    ));
}
