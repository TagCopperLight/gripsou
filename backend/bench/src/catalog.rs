use crate::config::RunConfig;
use serde::Serialize;
#[derive(Clone, Serialize)]
pub struct Case {
    pub id: String,
    pub suite: String,
    pub boundary: String,
    pub reset: String,
}
pub fn catalog() -> Vec<Case> {
    let reads = [
        "portfolio.net-worth",
        "portfolio.account-series",
        "portfolio.distribution",
        "portfolio.holdings",
        "portfolio.accounts",
        "prices.history.short",
        "prices.history.full",
        "returns.inputs",
        "returns.xirr.valid",
        "returns.xirr.no-solution",
        "lots.list",
        "lots.preview",
        "lots.basis",
        "lots.suggestions",
        "transactions.page.first",
        "transactions.page.deep",
        "transactions.search.common",
        "transactions.search.rare",
        "transactions.search.absent",
        "transactions.filters.combined",
        "transactions.counts",
        "transactions.tags",
        "transactions.matching-ids",
        "budget.day-totals",
        "budget.overview.projection",
        "budget.trend.projection",
    ];
    reads
        .into_iter()
        .map(|id| Case {
            id: id.into(),
            suite: "backend".into(),
            boundary: if id.contains("projection") {
                "preloaded pure projection"
            } else if id.contains("xirr") {
                "100 pure calls"
            } else {
                "repository call including acquisition"
            }
            .into(),
            reset: "read".into(),
        })
        .chain(
            [
                "portfolio.backfill",
                "transactions.bulk.category",
                "transactions.bulk.tags",
                "transactions.bulk.checked",
                "transactions.apply-description",
                "sync.ingest.first",
                "sync.ingest.unchanged",
                "sync.ingest.corrected",
                "transfers.pair.first",
                "transfers.pair.unchanged",
                "transfers.pair.ambiguous",
                "ai.prepare",
                "ai.persist",
                "prices.insert.first",
                "prices.insert.duplicate",
                "prices.refresh.fresh",
            ]
            .into_iter()
            .map(|id| Case {
                id: id.into(),
                suite: "backend".into(),
                boundary: "application call including acquisition and commit".into(),
                reset: "clone".into(),
            }),
        )
        .collect()
}
pub fn select(config: &RunConfig) -> anyhow::Result<Vec<Case>> {
    use anyhow::ensure;
    let all = catalog();
    for id in &config.only {
        ensure!(
            all.iter().any(|c| &c.id == id && c.suite == config.suite),
            "unknown/unsupported target {id} for {}",
            config.suite
        );
    }
    let cases: Vec<_> = all
        .into_iter()
        .filter(|c| {
            c.suite == config.suite
                && (config.only.is_empty()
                    && (c.id != "transactions.page.deep" || config.fixture.transactions > 10200)
                    || config.only.contains(&c.id))
        })
        .collect();
    ensure!(
        !cases.is_empty(),
        "no implemented targets for {}",
        config.suite
    );
    for c in &cases {
        if c.id == "transactions.page.deep" {
            ensure!(
                config.fixture.transactions > 10200,
                "deep-page target requires more than 10200 transactions; use large-ledger or --transactions"
            );
        }
    }
    Ok(cases)
}
