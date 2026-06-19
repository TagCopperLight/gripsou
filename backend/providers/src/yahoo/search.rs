//! ISIN → Yahoo symbol selection. Yahoo's search ranks the primary/home-market
//! listing first; for v1 we take the top EQUITY/ETF candidate. (Currency-aware
//! candidate selection is a deferred refinement — see the plan's notes.)

/// One result row distilled from Yahoo's search response.
pub(crate) struct Candidate {
    pub symbol: String,
    pub quote_type: String,
}

/// Pick the first equity/ETF candidate, preserving Yahoo's ranking.
pub(crate) fn select_symbol(candidates: &[Candidate]) -> Option<String> {
    candidates
        .iter()
        .find(|c| c.quote_type == "EQUITY" || c.quote_type == "ETF")
        .map(|c| c.symbol.clone())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn c(symbol: &str, quote_type: &str) -> Candidate {
        Candidate { symbol: symbol.into(), quote_type: quote_type.into() }
    }

    #[test]
    fn picks_first_equity_or_etf_preserving_rank() {
        let cands = vec![c("CURRENCY", "CURRENCY"), c("MC.PA", "EQUITY"), c("MC.DE", "EQUITY")];
        assert_eq!(select_symbol(&cands), Some("MC.PA".to_string()));
    }

    #[test]
    fn picks_etf_when_no_equity() {
        let cands = vec![c("IDX", "INDEX"), c("CSPX.L", "ETF")];
        assert_eq!(select_symbol(&cands), Some("CSPX.L".to_string()));
    }

    #[test]
    fn none_when_no_security_candidate() {
        let cands = vec![c("BTC", "CRYPTOCURRENCY"), c("IDX", "INDEX")];
        assert_eq!(select_symbol(&cands), None);
    }

    #[test]
    fn none_when_empty() {
        assert_eq!(select_symbol(&[]), None);
    }
}
