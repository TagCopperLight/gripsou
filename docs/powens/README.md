# Powens documentation (local mirror)

Offline markdown mirror of the Powens docs, kept for building the `powens`
provider adapter. Reference only — not part of the build.

- **Source:** <https://docs.powens.com/documentation> and
  <https://docs.powens.com/api-reference>
- **Exported:** 2026-06-10
- **Method:** the docs are a GitBook site; every page has a `.md` twin. The
  `documentation/` tree comes from `https://docs.powens.com/llms.txt`; the
  `api-reference/` tree from the site nav. A trailing "Agent Instructions"
  boilerplate section was stripped from each page.

## Layout

- `documentation/` — integration guides (bank, wealth, pay, …), SDK, glossary.
- `api-reference/` — endpoint + data-model reference. Most relevant to the
  adapter:
  - `products/data-aggregation/bank-accounts.md`, `bank-transactions.md`,
    `balances.md`
  - `products/wealth-aggregation/investments.md`, `pockets.md`,
    `market-orders.md`
  - `user-connections/connections.md`, `connectors.md`, `users.md`
  - `overview/authentication.md`, `overview/webview.md`

## Refreshing

Re-run the export by fetching each page's `.md` URL (see the lists in
`llms.txt` and the `/api-reference/*` nav). Pages also support a dynamic
`?ask=<question>` query parameter against the `.md` URL.
