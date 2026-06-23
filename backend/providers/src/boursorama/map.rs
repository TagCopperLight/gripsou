//! Pure parsers for Boursorama tracker data. Kept separate from the HTTP
//! adapter so they unit-test against recorded fixtures without a network.
//!
//! Boursorama embeds the composition breakdowns as JSON for its pie charts, e.g.
//! `"brs":{...,"valueField":"value","id":"regional"}, ... "amChartData":[{"name":..,"value":..}]`
//! where `value` is already a percentage. `id` is `"regional"` (country) or
//! `"sector"`. We extract those arrays directly — far more stable than scraping
//! the visible markup.
//!
//! ponytail: the `id` anchors ("regional"/"sector") and the search→`/cours/<sym>/`
//! redirect shape are what to recheck if Boursorama changes its pages.

use gripsou_core::dto::Allocation;
use serde::Deserialize;

/// `"PUST.PA" -> "PUST"`. Boursorama search wants the bare ticker.
pub(crate) fn bare_ticker(symbol: &str) -> String {
    symbol.split('.').next().unwrap_or(symbol).to_string()
}

/// The search 302-redirects an exact ticker to `/cours/<symbol>/`. Pull the last
/// path segment as the Boursorama symbol (e.g. `/cours/1rTPUST/` -> `1rTPUST`).
pub(crate) fn symbol_from_location(location: &str) -> Option<String> {
    location
        .trim_end_matches('/')
        .rsplit('/')
        .next()
        .filter(|s| !s.is_empty())
        .map(str::to_string)
}

#[derive(Deserialize)]
struct AmPoint {
    name: String,
    value: f64,
}

/// Extract one embedded chart dataset by its `brs.id` ("regional" | "sector").
/// Returns weights as ratios in 0..1. Empty when the id or its data is absent
/// (e.g. the page is not a tracker, or has no breakdown).
pub(crate) fn parse_amchart_data(html: &str, id: &str) -> Vec<Allocation> {
    // Anchor on the full `valueField`+`id` pair so a stray `"id":"sector"`
    // elsewhere on the page can't match.
    let anchor = format!("\"valueField\":\"value\",\"id\":\"{id}\"");
    let Some(start) = html.find(&anchor) else {
        return Vec::new();
    };
    let Some(rel) = html[start..].find("\"amChartData\":") else {
        return Vec::new();
    };
    let after = start + rel + "\"amChartData\":".len();
    let Some(open_off) = html[after..].find('[') else {
        return Vec::new();
    };
    let open = after + open_off;

    // Find the matching `]` (names contain no brackets, so a depth count is safe).
    let bytes = html.as_bytes();
    let mut depth = 0i32;
    let mut end = None;
    for (i, &b) in bytes[open..].iter().enumerate() {
        match b {
            b'[' => depth += 1,
            b']' => {
                depth -= 1;
                if depth == 0 {
                    end = Some(open + i + 1);
                    break;
                }
            }
            _ => {}
        }
    }
    let Some(end) = end else {
        return Vec::new();
    };

    let points: Vec<AmPoint> = serde_json::from_str(&html[open..end]).unwrap_or_default();
    points
        .into_iter()
        .map(|p| Allocation {
            name: p.name,
            weight: p.value / 100.0,
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    // A compact excerpt mirroring Boursorama's real embedded JSON shape, including
    // a \u escape (decoded by serde) and the unrelated "portfolio" chart.
    const SAMPLE: &str = r#"
      {"amChartConfig":{"brs":{"categoryField":"name","valueField":"value","id":"regional"}},"amChartData":[{"name":"Etats-Unis","value":97.55},{"name":"Pays-Bas","value":0.84}]}
      {"amChartConfig":{"brs":{"categoryField":"name","valueField":"value","id":"portfolio"}},"amChartData":[{"name":"Actions","value":100}]}
      {"amChartConfig":{"brs":{"categoryField":"name","valueField":"value","id":"sector"}},"amChartData":[{"name":"Technologie","value":58.53},{"name":"Biens de consommation défensive","value":4.2}]}
    "#;

    #[test]
    fn bare_ticker_strips_exchange_suffix() {
        assert_eq!(bare_ticker("PUST.PA"), "PUST");
        assert_eq!(bare_ticker("CW8"), "CW8");
    }

    #[test]
    fn symbol_from_location_takes_last_segment() {
        assert_eq!(
            symbol_from_location("/cours/1rTPUST/").as_deref(),
            Some("1rTPUST")
        );
        assert_eq!(
            symbol_from_location("/bourse/trackers/cours/1rTCW8").as_deref(),
            Some("1rTCW8")
        );
        assert_eq!(symbol_from_location("/"), None);
        assert_eq!(symbol_from_location(""), None);
    }

    #[test]
    fn parse_amchart_data_reads_regional_with_ratio_weights() {
        let a = parse_amchart_data(SAMPLE, "regional");
        assert_eq!(a.len(), 2);
        assert_eq!(a[0].name, "Etats-Unis");
        assert!((a[0].weight - 0.9755).abs() < 1e-9);
        assert!((a[1].weight - 0.0084).abs() < 1e-9);
    }

    #[test]
    fn parse_amchart_data_reads_sector_and_decodes_unicode() {
        let a = parse_amchart_data(SAMPLE, "sector");
        assert_eq!(a.len(), 2);
        assert_eq!(a[0].name, "Technologie");
        assert!((a[0].weight - 0.5853).abs() < 1e-9);
        // é decoded to é by serde.
        assert_eq!(a[1].name, "Biens de consommation défensive");
    }

    #[test]
    fn parse_amchart_data_empty_for_missing_id() {
        assert!(parse_amchart_data(SAMPLE, "nope").is_empty());
        assert!(parse_amchart_data("<html>no charts</html>", "regional").is_empty());
    }
}
