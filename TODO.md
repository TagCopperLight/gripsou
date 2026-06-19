# TODO

- [ ] Currency conversion
- [ ] Not implemented transaction page
- [ ] Users page funcions
- [x] Settings server page
- [ ] ETF categories and origin stats
- [x] Sync button
- [x] Powens integration
- [ ] Yahoo integration
  - When adding it, change `ingest` to value snapshots from the price table (`snapshot.value = qty × price`), Powens valuation only as fallback. Otherwise the Holdings page (qty × price) and net worth/accounts/distribution (Powens snapshot value) use two different sources and drift.
  - Needs ISIN → Yahoo ticker mapping (ISIN-path instruments store `symbol = null`) + currency handling.
- [x] Fix capital invested