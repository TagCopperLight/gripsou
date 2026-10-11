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
        .chain(
            [
                "http.net-worth",
                "http.distribution",
                "http.accounts",
                "http.holdings",
                "http.returns",
                "http.prices",
                "http.transactions",
                "http.transaction-counts",
                "http.budget-summary",
                "http.budget-trend",
                "http.lot-preview",
                "http.lot-suggestions",
            ]
            .into_iter()
            .map(|id| Case {
                id: id.into(),
                suite: "http".into(),
                boundary:
                    "authenticated loopback request through full body receipt, reused client/server"
                        .into(),
                reset: "read".into(),
            }),
        )
        .chain(["browser.dashboard.ready","browser.accounts.ready","browser.investments.ready","browser.budget.ready","browser.transactions.ready","browser.dashboard.return-cached","browser.transactions.search","browser.transactions.filter","browser.transactions.next-page","browser.lots.open","browser.chart.range","browser.navigation.repeat"].into_iter().map(|id|Case{id:id.into(),suite:"browser".into(),boundary:"production browser action through semantic DOM, required responses and finished charts".into(),reset:"read".into()}))
        .chain(["load.dashboard-during-backfill","load.transactions-during-ingest","load.ingest.same-user","load.ingest.different-users","load.mixed-reads.fixed-work","load.mixed-reads.fixed-duration","load.pool-saturation","load.bulk-during-ingest"].into_iter().map(|id|Case{id:id.into(),suite:"load".into(),boundary:"scheduled-to-completed requests including queueing, full receipt and verification".into(),reset:"clone".into()}))
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
    for c in &cases {
        if c.id == "load.ingest.same-user" {
            ensure!(
                config.fixture.connections >= 2,
                "same-user load requires two connections"
            );
        }
        if c.id == "load.ingest.different-users" {
            ensure!(
                config.fixture.users >= 2,
                "different-user load requires two users"
            );
        }
    }
    Ok(cases)
}
