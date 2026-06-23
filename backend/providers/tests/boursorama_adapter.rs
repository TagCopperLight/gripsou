use gripsou_core::dto::InstrumentRef;
use gripsou_core::provider::CompositionProvider;
use gripsou_providers::boursorama::BoursoramaCompositionProvider;
use wiremock::matchers::{method, path, query_param};
use wiremock::{Mock, MockServer, ResponseTemplate};

// A trimmed, recorded excerpt of a real Boursorama composition page.
const COMPOSITION_FIXTURE: &str = include_str!("fixtures/boursorama/composition_pust.html");

fn iref(symbol: &str) -> InstrumentRef {
    InstrumentRef {
        kind: "equity".into(),
        symbol: Some(symbol.into()),
        isin: None,
        name: "Amundi PEA Nasdaq-100".into(),
        currency: "EUR".into(),
    }
}

#[tokio::test]
async fn resolve_symbol_reads_search_redirect_location() {
    let server = MockServer::start().await;
    // The search 302-redirects an exact ticker to /cours/<symbol>/.
    Mock::given(method("GET"))
        .and(path("/recherche/"))
        .and(query_param("query", "PUST"))
        .respond_with(ResponseTemplate::new(302).insert_header("location", "/cours/1rTPUST/"))
        .mount(&server)
        .await;

    let p = BoursoramaCompositionProvider::new(server.uri());
    let got = p.resolve_symbol(&iref("PUST.PA")).await.unwrap();
    assert_eq!(got, Some("1rTPUST".to_string()));
}

#[tokio::test]
async fn resolve_symbol_none_when_search_does_not_redirect() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/recherche/"))
        .respond_with(ResponseTemplate::new(200).set_body_string("<html>results list</html>"))
        .mount(&server)
        .await;

    let p = BoursoramaCompositionProvider::new(server.uri());
    let got = p.resolve_symbol(&iref("NOPE")).await.unwrap();
    assert_eq!(got, None);
}

#[tokio::test]
async fn fetch_composition_extracts_country_and_sector_from_real_page() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/bourse/trackers/cours/composition/1rTPUST/"))
        .respond_with(ResponseTemplate::new(200).set_body_string(COMPOSITION_FIXTURE))
        .mount(&server)
        .await;

    let p = BoursoramaCompositionProvider::new(server.uri());
    let comp = p.fetch_composition("1rTPUST").await.unwrap();

    // Country (regional) breakdown — values are percentages in the page.
    assert_eq!(comp.countries[0].name, "Etats-Unis");
    assert!((comp.countries[0].weight - 0.9755).abs() < 1e-9);
    // Sector breakdown.
    assert_eq!(comp.sectors[0].name, "Technologie");
    assert!((comp.sectors[0].weight - 0.5853).abs() < 1e-9);
    // The "portfolio" (asset-allocation) chart must NOT leak into either field.
    assert!(comp.countries.iter().all(|a| a.name != "Actions"));
    assert!(comp.sectors.iter().all(|a| a.name != "Actions"));
}
