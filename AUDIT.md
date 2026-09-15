# gripsou — full codebase audit

**Date**: 2026-08-25 · **Commit**: `4c55dba` · **Scope**: all of `backend/` and `frontend/` (~32k lines of source)

Prompt : I'd like for you to do a thorough audit of the entire codebase, but not a simple one. I'd like to "attack" the codebase via different aspects, bugs obviously, but also code quality, "centralization" (and I mean by that that generalized bits of code need to be used everywhere, not reimplemented somewhere else, for instance there's the possibility for the user to chose the date format, it should be used everywhere), security (mainly to protect the data of users), code comments (I've used lower agents than you that seem to love adding huge unnecessary comments), and finally design (I've thought the app myself, it's very possible there are very dumb design decisions taken) To do this task, I'd like for you to use agents, and I don't really want to pararellize this (all the agent should see the same code) because I think that when you have a specific goal in mind, you don't see the same code. Please tell the agents to not modify code, at the end I'd like a markdown document that document every finds (if it's huge, it means that the agents found many things, and it's for the better).

Six independent audits were run over the same tree, each with a single lens and no knowledge of the
others' findings. Nothing in the repository was modified. Every finding cites `file:line`.

| # | Lens | Findings | Critical | High | Medium | Low |
|---|------|----------|----------|------|--------|-----|
| 1 | Correctness & bugs | 22 | 2 | 4 | 9 | 7 |
| 2 | Security | 17 | 0 | 2 | 5 | 10 |
| 3 | Centralization / DRY | 20 | — | 6 | 7 | 7 |
| 4 | Code quality | 24 | — | 4 | 15 | 5 |
| 5 | Comments | 8 high-impact + ~55 removable lines | — | — | — | — |
| 6 | Design & architecture | 22 | 2 | 7 | 9 | 4 |
| | **Total** | **105** | **4** | **23** | **45** | **33** |

---

## Fix log

Work happens on the `audit-fixes` branch. **`AUDIT-FIXES.md` holds the working method** — the
protocol, the verification loop, and the queue — so the work can resume in a fresh session.
Findings are addressed in severity order, grouping the ones
the six lenses reported separately but that are the same underlying bug. Each entry below is also
marked inline at its own heading with a `**Status**` line.

| Findings | Issue | Status |
|---|---|---|
| C-1, C-2, D-7 (part) | Instrument identity built from two columns that later get rewritten | ✅ Fixed |
| D-1, Z-1, C-7 | Cost basis moved to a `lot` table with one SQL definition | ✅ Fixed |
| C-9 (part) | Transactions list date filters no longer use the session timezone | ✅ Fixed |
| C-7 (follow-up) | Chart's invested line back-dated today's cash balance across all history | ✅ Fixed |
| D-2 | "Net worth" is gross assets; liabilities dropped at the adapter | ⏭️ Skipped |
| C-3, C-6 | A missing FX rate is absorbed silently — reporting currency and cost basis | ✅ Fixed |
| C-4 | Powens account and investment lists are paginated to exhaustion | ✅ Fixed |
| C-5 | Cancelled transactions are never removed from the ledger | ⏳ Deferred |
| D-4, Q-4 | A wedged `syncing` connection is now recoverable, and the silent lock writes speak | ✅ Fixed |
| Z-4 | One `roles.admin` / `roles.member` pair; the sidebar no longer renders a raw key | ✅ Fixed |
| S-1, S-2, S-3 | Login hardening: rate limiting, password floor, timing oracle | ⏳ Deferred |
| C-11, D-12 | Headline badge vs. the chart's % mode — two metrics, by design | ⏭️ Skipped |
| C-17, C-18, Z-6 | Query-key factory + named invalidation groups; three stale screens closed | ✅ Fixed |

Legend: ✅ fixed · 🟡 partially fixed · ⏭️ deliberately skipped · ⏳ deferred.

---

## Read this first

### The good news, so you know what not to touch

Three things came back clean, and each was checked rather than assumed:

- **Authorization.** All 42 routes were walked. **No IDOR.** Every user-scoped query joins back to
  `connection.user_id` / `users.id` / `session.user_id`. All SQL is compile-time-checked with bind
  parameters — no dynamic SQL anywhere. Admin gating via `require_admin` is consistent, and there is no
  role-mutation endpoint at all, so there is no privilege-escalation surface. `save_lots` derives
  `connection_id` from the holding rather than trusting the request body, which is exactly right.
- **The unified holding model.** The central design bet — cash and securities are both holdings, FX is
  just a price of a cash instrument — pays off repeatedly and should be protected. So should the
  three-currency-domain discipline, core-owned snapshots, and `valuation_grid`'s per-instrument-day shape.
- **Comment hygiene.** Your worry about AI comment slop is largely unfounded. 3,340 comment lines were
  read in context; the overwhelming majority explain *why* (measured before/after timings, provider
  quirks with observed row counts, currency rules). Only ~55 lines are worth deleting. Rust lint hygiene
  is genuinely good too: clippy is silent on a clean target dir, and there are 4 suppression comments in
  the whole repo.

### The four critical findings

1. **D-1 / Z-1 — cost basis and PnL are computed four times, in three languages, and two of them already
   disagree.** The backend computes invested as `qty × μ`; `frontend/src/lib/assetSeries.ts:38` subtracts
   *sale proceeds*, folding realised P/L into the basis — which `backfill.rs:164-169` explicitly refuses
   to do. Buy 10 @ 100, sell 5 @ 200: backend says invested = 500, the AssetModal says 0. Same holding,
   same screen, same session. The code comments themselves say "if one changes, all three change" — that
   is a written admission the invariant is unenforceable.
2. **D-2 — "net worth" is gross assets.** The model has no sign dimension and liabilities are dropped at
   the adapter. A mortgage, a credit card balance, an RSU grant, a property valuation and a staking
   reward do not fit `quantity × price`.
3. **C-1 / C-2 / D-7 — instrument identity is built from two mutable columns.** `(kind, symbol)` is the
   identity, but Yahoo resolution later rewrites `symbol` and `set_composition` later flips `kind` to
   `'etf'`. Next sync inserts a duplicate instrument and a duplicate holding, and ingest's close loop
   zeroes the original — destroying that position's history.

### The cross-cutting theme

Independent agents converged on the same root cause from six directions: **the same formula is written
several times in several languages, and the copies have drifted.** This is not a style complaint — it is
where three of the four critical findings live.

| Duplicated thing | Copies | Already drifted? | Findings |
|---|---|---|---|
| Mean-buy-price μ / cost basis | 4 (3 languages) | **Yes** | D-1, Z-1, C-7, M-1 |
| Valuation + FX expression | 5 | Not yet | Z-2, D-11, C-6 |
| "Net worth" % denominator | 4 | **Yes** | Z-3, C-11, D-12 |
| Timeframe range definitions | 5 | No | Z-8, Q-8 |
| Chart colours vs. CSS tokens | 3 files | **Yes** | Z-5, Q-17 |
| `#888888` fallback colour | 2 | No | Z-14, Q-24 |
| The user-scoping join chain | 14 queries | No | Z-18 |

Two more places where lenses agreed independently: the **stuck-`syncing` connection** (D-4 saw the
design gap, Q-4 found the silent `let _ =` that causes it) and **cache staleness after a sync** (C-17,
C-18, Z-6 — a sync invalidates only `["connections"]`, leaving the whole dashboard stale).

### One live user-visible bug, cheap to fix

`frontend/src/components/Sidebar.tsx:33` calls `t("settings.roleMember")`. That key does not exist — it
is `settings.users.roleMember`. Every member-role user currently sees the raw key string under their
name, in both languages.

---


---

# 1. Correctness & bugs


Lens: money/valuation math, time/date handling, SQL, concurrency, error handling,
provider adapters, frontend data assembly. Findings ordered by severity.
Line numbers are from the working tree at `main` (4c55dba).

---

### C-1 — A symbol-only instrument is duplicated on the next sync once Yahoo resolution rewrites its `symbol`


**Status**: ✅ **Fixed** — `set_resolved_symbol` now writes `meta.yahoo_symbol` only and never
rewrites the identity column `symbol`; the holdings query derives the *display* ticker with
`coalesce(i.symbol, meta->>'yahoo_symbol')` (cash excluded). Regression test:
`core/tests/repo_instrument_resolution.rs::symbol_only_instrument_survives_resolution_and_composition`.
**Severity**: Critical
**Confidence**: Certain
**Location**: `backend/core/src/repo/instrument.rs:88`, `backend/core/src/repo/instrument.rs:118`

**What's wrong**: `resolve_instrument`'s symbol-only path dedups on the partial unique index
`(kind, symbol) where symbol is not null`. `set_resolved_symbol` then *overwrites* that same
`symbol` column with the Yahoo ticker (`set symbol = case when kind = 'cash' then symbol else $2 end`).
The natural key the next sync will look the row up by no longer exists.

**How it fails**: Powens reports an investment with `code_type != "ISIN"` and
`stock_symbol = "PUST"`. Sync 1 inserts `instrument(kind='equity', symbol='PUST')`, creates
`holding(account, that instrument)`, stamps a snapshot. The price pass resolves Yahoo's ticker
`PUST.PA` and rewrites `instrument.symbol = 'PUST.PA'`. Sync 2 calls `resolve_instrument` with
`kind='equity', symbol='PUST'` again → `on conflict (kind, symbol)` matches nothing → a **second**
instrument row is inserted, `upsert_holding` creates a **second** holding (the unique key is
`(account_id, instrument_id)`), and the ingest's close loop (`ingest.rs:88-103`) sees the old
holding absent from `present`, zeroes it and stamps a zero snapshot. The position's whole price
history and snapshot history are orphaned, the chart steps down and back up, and the cycle repeats
every sync (the new row gets resolved and renamed again). Instruments carrying an ISIN are safe —
their conflict target is `(isin)`, which nothing rewrites.

**Fix**: Stop writing the resolved Yahoo ticker into the identity column `symbol`; it already lives
in `meta.yahoo_symbol`, which is what `price_sync` reads. Alternatively key the symbol-only path on
a stored `provider_symbol` that is never mutated.

---

### C-2 — `set_composition` flips `kind` to `'etf'`, breaking the same `(kind, symbol)` identity


**Status**: ✅ **Fixed** — `set_composition` writes `meta.composition` only and no longer touches
`kind`. The tracker/share distinction is now derived at read time in `api/src/dto.rs`
(`display_kind`: an `equity` carrying a scraped composition renders as `etf`), so `kind` stays the
provider's value and the natural key is immutable.
**Severity**: Critical
**Confidence**: Certain
**Location**: `backend/core/src/repo/instrument.rs:225`

**What's wrong**: `set_composition` unconditionally does `set kind = 'etf'`. `kind` is half the
conflict target of the symbol-only dedup path (`instrument.rs:88`), so mutating it has the exact
same effect as C-1 — and it applies even to instruments whose `symbol` was never rewritten.

**How it fails**: An instrument stored as `(kind='equity', symbol='CW8')` gets a Boursorama
composition and is relabelled `(kind='etf', symbol='CW8')`. The next sync's
`insert … values ('equity','CW8',…) on conflict (kind, symbol)` finds no `(equity,'CW8')` row and
inserts a duplicate; the old holding is zeroed by the close loop. Secondary risk: if a *different*
instrument already occupies `(etf, symbol)`, the `update` raises 23505, which propagates out of
`fetch_composition_for_connection` and aborts the whole composition pass for that connection.

**Fix**: Do not change `kind` as a side effect of a composition scrape (or make the instrument
natural key independent of `kind`, e.g. drop `kind` from the partial unique index).

---

### C-3 — Reporting currency silently degrades to the pivot with no flag

**Status**: ✅ **Fixed.** Two halves. (1) The reporting preference is now a rate-eligible currency:
`ensure_cash_instruments_for_held_currencies` and `price_eligible_instruments_for_connection` both
union the owning user's `prefs.currency`, so its cash instrument is created and its pair fetched on
the next price pass even though nothing is held or quoted in it. (2) The fallback is announced:
migration `0026` adds `reporting_fx_degraded(user, day)`, mirroring `reporting_fx_asof`'s own
currency resolution and `nullif(…, 0)` guard so the two cannot disagree; `net_worth_series` returns it
as `reporting_fx_missing`, the API ships it on the net-worth summary, and `NetWorthCard` renders an
amber strip (not the ⚠ tooltip the holding warnings use — a tooltip nobody hovers would leave the
user reading euros as dollars). The fallback to the pivot itself is kept: it beats collapsing every
figure to NULL. Verified live before fixing — the install is EUR/CNY, CNY has 5,915 rates back to
2003, so picking USD, GBP, CHF or JPY in Settings was a two-click reproduction of the bug.
Regression tests: `core/tests/query.rs::reporting_in_a_currency_with_no_rate_is_flagged`,
`core/tests/query_price_eligible.rs::the_reporting_currency_is_price_eligible_even_when_nothing_is_held_in_it`,
`core/tests/fx.rs::reporting_fx_degraded_is_false_when_the_conversion_really_happened` plus an added
assertion on the pre-existing fallback test, and `FxMissingWarning.test.tsx` (two cases).

**Severity**: High
**Confidence**: Certain
**Location**: `backend/migrations/0011_reporting_fx_zero_guard.sql:11`, `backend/core/src/repo/query.rs:97`, `backend/core/src/price_sync.rs:63`

**What's wrong**: `reporting_fx_asof` falls back to `1` when the user's `prefs.currency` has no
stored rate, i.e. "report in the pivot". But nothing ever creates a cash instrument or fetches a
rate *for the reporting-currency preference*: `ensure_cash_instruments_for_held_currencies` and
`price_eligible_instruments_for_connection` only cover `instrument.currency`, `price.currency` and
`account.currency`. The `fx_missing` flag is computed from *holdings*, not from the reporting
divisor, so nothing tells the UI.

**How it fails**: A EUR-only user (pivot EUR, all accounts EUR) opens Settings → General and picks
`USD`. No USD cash instrument exists, so no `USDEUR=X` is ever fetched. `reporting_fx_asof` returns
1 for every day. A net worth of 100 000 EUR is rendered as `$100,000.00` — a ~15% error presented
with full confidence, on the dashboard headline, the accounts grid, the pie and both charts.
`backend/core/tests/fx.rs:215-225` asserts exactly this fallback, so the test suite locks the
behaviour in rather than catching it.

**Fix**: Make the reporting-currency preference a rate-eligible currency (create its cash instrument
and include it in the price pass), and raise a distinct flag when the divisor falls back to 1 so the
UI can say "shown in EUR".

---

### C-4 — `/users/me/accounts` and `/users/me/investments` are fetched unpaginated

**Status**: ✅ **Fixed.** All three Powens list fetches now go through one `fetch_all` helper
(`providers/src/powens/mod.rs`) that walks the endpoint to exhaustion: it requests `limit=1000`,
follows `_links.next` when the page carries a cursor, and falls back to `offset` paging when a *full*
page arrives without one — which is the case that matters, since Powens documents no cursor for
`/accounts` or `/investments`, only `limit`/`offset`. `AccountsResponse` and `InvestmentsResponse`
gained the `_links` block they previously discarded. Truncation is now an **error, not a short
list**: reaching the 100-page bound fails the sync rather than handing the ingest a partial view, so
the close loop can keep trusting "absent means sold". That was chosen over the audit's suggested
`truncated` flag on `SyncResult` — at 100 × 1000 rows the bound is only reachable via a provider bug,
where failing loudly beats half-ingesting, and it keeps the change inside the Powens crate. Dormant
on this install when fixed: 8 accounts, 13 holdings. Regression tests in
`providers/tests/powens_fetch.rs`: `a_full_account_page_without_a_cursor_is_followed_by_offset`
(1000-row first page plus an `offset=1000` second page), `investments_follow_the_next_link`, and
`a_cursor_that_never_ends_fails_the_sync`.

**Severity**: High
**Confidence**: Likely
**Location**: `backend/providers/src/powens/mod.rs:225`, `backend/providers/src/powens/mod.rs:259`

**What's wrong**: Both endpoints are fetched with a single GET, no `limit=` and no `links.next`
loop — unlike `fetch_transactions` (`mod.rs:78-107`), which does paginate. Powens paginates list
endpoints; a response past the default page size is silently truncated.

**How it fails**: A user with more investments than one page gets a partial `investments` array.
`map_sync` therefore emits holdings only for the page it saw; `ingest`'s close loop
(`ingest.rs:88-103`) treats every holding absent from that sync as sold — `zero_holding` plus a
**zero snapshot for today**. Net worth drops by the value of the truncated positions, and because the
snapshot is written, `accounts()`/`distribution()`/`holdings()` all agree on the wrong number.
The same truncation on `/accounts` drops whole accounts, and `map_sync` then also discards every
transaction belonging to them (`map.rs:289-297`).

**Fix**: Paginate both endpoints the way `fetch_transactions` does (follow `links.next`), and make
the ingest's close loop refuse to zero holdings when the fetch reported truncation.

---

### C-5 — Powens transactions that are deleted or revert to pending are never removed from the ledger

**Status**: ⏳ **Deferred** to the transactions-reconciliation work (`TODO.md`, under the Budget
page). Confirmed still live, and worse than written: Powens' docs state that `/users/me/transactions`
returns only active rows by default, so the `t.deleted.is_some()` guard in `map_transaction` is
effectively dead code — a cancelled transaction does not arrive flagged, it simply stops arriving.
Any fix therefore needs either the `all` query flag plus tombstone deletes, or full reconciliation of
the connection's stored `external_id` set against the fetched one; the latter is the direction chosen,
and it is only safe now that C-4 guarantees the fetch is complete. Not measurable from the database:
a row deleted at the bank is indistinguishable from a live one in our copy. A scan of the 2,803 stored
transactions for bank-reissue signatures (same account, day, amount and wording) found 84 groups, all
of which sample as genuine repeats with consecutive Powens ids.

**Severity**: High
**Confidence**: Certain
**Location**: `backend/providers/src/powens/map.rs:348`, `backend/core/src/ingest.rs:109`

**What's wrong**: `map_transaction` returns `None` for `t.coming || t.deleted.is_some()`, so such
rows never reach `SyncResult.transactions`. `ingest` only ever upserts; the only delete of a
`transaction` row anywhere in the codebase is `delete_manual_lots`
(`core/src/repo/transaction.rs:124`), which is restricted to `external_id is null`. So a row that
was booked once and later deleted/reversed by the bank stays in gripsou forever.

**How it fails**: A -250,00 € card payment is booked, ingested, then charged back and marked
`deleted` by Powens. gripsou keeps it. `backfill.rs`'s `moves` CTE still subtracts it on the walk
backward, so every derived cash day before that date is 250,00 € too high — permanently, and
re-derived identically on every sync. The Transactions page also keeps listing a transaction that
no longer exists at the bank.

**Fix**: Have the adapter report deleted/uncoming rows as tombstones (or have the ingest reconcile
the connection's provider rows against the fetched `external_id` set) and delete them inside the
sync transaction before the backfill runs.

---

### C-6 — `invested` on the chart silently drops any holding whose account currency has no rate

**Status**: ✅ **Fixed.** `net_worth_series` now coalesces per row (`sum(coalesce(lb.basis * afx, 0))`)
instead of around the sum, and `fx_missing` gained a second disjunct (`lb.basis <> 0 and afx.unit_value is null`) because the existing condition requires the *value* branch to have failed,
which is false precisely when the position is priceable. `holdings()` had the coalesce already but the
same blind spot in its flag, and got the same disjunct. `account_series` needed nothing: it carries no
invested line and its value expression already coalesces per row. Dormant on this install when fixed
(the only foreign account is CNY, whose rates predate its history by 20 years); it fires on the first
sync of an account in a new currency, where the account lands before the rate does. Regression test:
`core/tests/query.rs::invested_flags_a_basis_it_could_not_convert`, which holds a pivot-priced equity
in a CNY account so only the account-currency rate is missing.

**Severity**: High
**Confidence**: Certain
**Location**: `backend/core/src/repo/query.rs:107-113`

**What's wrong**: `invested` is `coalesce(sum(snap.cost_basis * afx.unit_value), 0)`. There is no
per-row `coalesce`, so when `afx` (the account-currency rate) is NULL the term is NULL and `sum()`
skips it. The `fx_missing` flag next to it only fires when **both** value branches fail
(`uv.unit_value is null and coalesce(snap.value * afx.unit_value, 0) = 0`), which is false whenever
the holding *is* priceable.

**How it fails**: A user holds a EUR-quoted ETF inside a CHF account, and no `CHF` rate exists yet
(first sync, or the FX fetch failed). `net_worth` counts the position fine via
`snap.quantity * uv.unit_value`; `invested` counts nothing for it. The dashboard shows net worth
100 000 against invested 20 000 — a fabricated +400% — with **no warning**, because `fx_missing`
stays false.

**Fix**: Either raise `fx_missing` when `afx` is NULL for a holding with a non-zero `cost_basis`, or
value the term at zero explicitly and flag it. The same applies to `account_series` (`query.rs:243`,
which has no flag at all).

---

### C-7 — "Invested" means two different things on two screens

**Status**: ✅ Fixed. Both the Holdings table and the net-worth chart's "Capital invested" line now
read the same `lot_basis` SQL function (`0022`) — `core/src/repo/query.rs:104` (chart series) and
`:298` (holdings). Verified live: `select sum(b.basis) from holding h join instrument i ... cross
join lateral lot_basis(...)` returns `1296.6594` (1 296,66 €), matching what both endpoints
compute. Regression tests: `core/tests/query.rs::chart_invested_matches_the_holdings_table`.

**Follow-up (2026-09-15)**: the 0022 fix left one half wrong. `lot_basis` answered
`holding.cost_basis` for every *cash* holding regardless of the day asked for, so each of the
chart's ~200 sampled days carried the balance the account holds *now*. The holdings table only ever
asks for today and so never showed it; the chart did. Measured live before the fix: 2026-01-15 read
invested 5 684,26 € against a net worth of 4 349,24 € — the dashed line 1 335 € *above* the green
area, because January's real 3 273,42 € of cash had been replaced by September's 4 700,09 €. Fixed
in `migrations/0025_cash_basis_per_day.sql`: cash now reads the same `holding_point` the net-worth
side reads, with the same "last point at or before this day" rule, so the two cancel by
construction. After: 2026-01-15 reads invested 4 260,83 € against 4 349,24 €, a gap of 88,41 € —
exactly the ETFs' unrealised gain that day. Regression tests:
`core/tests/lot_basis.rs::cash_basis_is_the_balance_on_that_day` and
`core/tests/query.rs::cash_invested_follows_the_balance_held_that_day`.

**Severity**: Medium
**Confidence**: Certain
**Location**: `backend/core/src/repo/query.rs:268` vs `backend/core/src/repo/query.rs:107`, `backend/core/src/backfill.rs:363`

**What's wrong**: `holdings()` resolves the basis in the `lot` lateral: when the recorded lots
explain the position exactly it uses `μ × quantity`, otherwise `h.cost_basis` (§4.3). The chart's
`invested` series reads `holding_point.cost_basis`, which is written from `holding.cost_basis`
(ingest) and `s.total_cost - Σ lots.cost` (backfill) — the μ override is nowhere in that path.

**How it fails**: A PEA position where Powens reports `cost_basis = 8 000` but the user's recorded
lots exactly explain the shares at μ giving `9 214,50`. The Holdings table's "Invested" column says
9 214,50 €; the dashed "Capital invested" line on the net-worth chart, on the same screen, ends at
8 000 €. Sum of the Holdings column will never equal the chart's endpoint.

**Fix**: Apply §4.3's rule in one place. Either write the resolved basis into the snapshot/backfill
at sync time, or make the series query read the same `lot` lateral the holdings query does.

---

### C-8 — `sync all` claims `pending` connections and burns them to `error`

**Severity**: Medium
**Confidence**: Certain
**Location**: `backend/api/src/handlers.rs:415-432`, `backend/core/src/repo/connection.rs:128`

**What's wrong**: `sync_all` iterates `ids_for_user`, which returns every connection regardless of
status. `begin_sync`'s predicate is `status <> 'syncing'`, so a `pending` row (webview flow in
flight, `credentials = '{}'`) is claimed. `sync_connection` then fails at `decrypt_credentials`
("missing 'ct'") and `fail_sync` sets `status = 'error'`.

**How it fails**: The user opens the Powens webview to add a bank, and while it is open clicks the
global sync button (`useSyncAll`). The half-created connection flips `pending → error`.
`delete_stale_pending` only reaps `status='pending'`, so the row is now immortal; and
`connections_needing_sync` includes `'error'`, so the hourly job retries and re-fails it forever.
If the user *does* finish the webview, `finish_connect` writes credentials and status `'ok'` — but
if `begin_sync` grabbed the row in between, `sync_connection`'s later `mark_synced_error` can
overwrite that `'ok'` back to `'error'`.

**Fix**: Scope `ids_for_user` (or `begin_sync`) to `status in ('ok','error')`, and make
`mark_synced_ok`/`mark_synced_error` conditional on the connection still being `'syncing'`.

---

### C-9 — Transaction date filters are evaluated in the server's session timezone

**Status**: 🟡 Partially fixed. The transactions list's two date filters (`core/src/repo/query.rs:
860-861`) now cast with `(ts at time zone 'utc')::date` instead of the bare `t.ts::date` cited
above, matching the rest of the schema. Regression test:
`core/tests/query_transactions.rs::lots_appear_on_the_transactions_list`. Scope note: this fix only
touched the location this finding cites; grepping the rest of `backend/` for other `::date` casts
on a `timestamptz` (migrations included) found every remaining one already wrapped in
`at time zone 'utc'`, so no further instance of this specific bug was found — but the finding is
logged as partial per the fix-log convention rather than claiming a codebase-wide audit.

**Severity**: Medium
**Confidence**: Certain
**Location**: `backend/core/src/repo/query.rs:841-842`

**What's wrong**: `t.ts::date >= $5` casts a `timestamptz` to `date` using the session `TimeZone`
GUC. Nothing in the codebase sets it (`core/src/db.rs` uses a bare `PgPoolOptions::connect`; no
`options=-c TimeZone=UTC`, no `PGTZ`), so it is whatever `postgresql.conf` says. Every other
day-boundary in the schema is deliberately explicit (`(ts at time zone 'utc')::date`,
`(p_day + 1)::timestamp at time zone 'UTC'` — see the comments in `0007`, `0017`, `0020`).

**How it fails**: On a server whose Postgres `TimeZone` is `America/New_York`, a transaction stored
at `2026-08-25T00:00:00Z` (which is how `map_transaction` stamps every Powens row —
`map.rs:360`, midnight UTC) casts to `2026-08-24`. Filtering `from=2026-08-25` silently omits it,
and the row count in the Transactions list disagrees with the date the same row displays.

**Fix**: Use `(t.ts at time zone 'utc')::date` (or `txn_day`) in the filter, matching the rest of
the schema.

---

### C-10 — `gainPct` is wrong-signed when the range starts negative, and reads "0 %" when it starts at zero

**Severity**: Medium
**Confidence**: Certain
**Location**: `backend/api/src/dto.rs:53-57`, and the same shape at `backend/api/src/dto.rs:165-169`

**What's wrong**: `gain_pct = gain_abs / first` with no guard on the sign of `first`, and
`first.is_zero() → Decimal::ZERO` (i.e. "unknown" is rendered as "0 %").

**How it fails**: Overdraft case — net worth on the first day of the range is `-100`, on the last
day `-50`. `gain_abs = +50`, `gain_pct = 50 / -100 = -0.5`. The card renders a green up-arrow with
`+50,00 €` next to `(-50,00 %)`. Near-zero case — `first = 0,01 €` (a freshly opened account) gives
`gain_pct = 999 900 %`. Zero case — a user whose first sampled day is 0 sees `+12 340,00 € (0,00 %)`.

**Fix**: Divide by `first.abs()`, and return an absent/`null` percentage (rendered as "—") when
`first` is zero or implausibly small, rather than `0`.

---

### C-11 — The headline "% over range" and the chart's "%" mode compute different quantities

**Status**: ⏭️ Skipped (2026-09-15). The split is deliberate and the user confirmed it: **the badge is raw movement of the balance over the period; the deposit-adjusted return is what the `%` toggle is for.** The audit's framing — "two numbers labelled the same thing" — does not hold on inspection: in percent mode the chart's legend and series are labelled `common.return` ("Return" / "Rendement", set at `NetWorthChart.tsx:29`), while the badge carries no metric word at all, only `dashboard.netWorth.over` ("over 3 months"). The two are distinguishable in the UI.

Measured on live data before the decision (2026-09-15, history clamped to its 2026-06-19 start): net worth 3 928,84 € → 4 916,29 €, invested 3 740,97 € → 4 727,96 €. The badge therefore reads about **+987 € / +25,1 %** while the chart's percent mode ends at about **+0,01 %** — a genuinely large gap, and the right one to show in two different places. Roughly 987 € was deposited over the window and it earned about 46 cents.

Not done, and cheap if it is ever wanted: the badge has no label of its own. A word there ("change" / "évolution") would remove the last of the ambiguity without touching either metric.

**Severity**: Medium
**Confidence**: Certain
**Location**: `frontend/src/components/NetWorthCard.tsx:100` vs `frontend/src/lib/assetSeries.ts:211-224`

**What's wrong**: The badge shows `summary.gainPct` — the server's raw `(last − first)/first` on
net worth, which counts deposits as growth. Switching the same card's unit toggle to `%` re-plots
via `windowReturn`, a simple-Dietz return that explicitly subtracts contributions. Two numbers
labelled the same thing, side by side, that disagree by the amount deposited during the window.

**How it fails**: Range = 6mo, net worth 10 000 → 25 000, of which 14 000 was deposited. The badge
says `+150,00 %`. The chart's final point says `+4,2 %`.

**Fix**: Have the summary badge report the same measure the chart plots (deposit-adjusted return),
or label them distinctly ("change" vs "return").

---

### C-12 — Dates render in the browser's local timezone, so a day can shift back by one

**Severity**: Medium
**Confidence**: Certain
**Location**: `frontend/src/lib/date.ts:298-312`

**What's wrong**: `formatDate` builds the string from `d.getFullYear()/getMonth()/getDate()` —
local-time accessors. Every timestamp the API sends is an epoch-ms of **UTC midnight**:
`day_to_millis` for chart points (`api/src/dto.rs:8`), and `ts.timestamp_millis()` for transactions,
whose `ts` was stamped `spent_on.and_hms_opt(0,0,0).and_utc()` (`powens/map.rs:360`).

**How it fails**: A user in `America/Los_Angeles` (UTC−7) opens the Transactions page. A row the
bank dated 2026-08-25 arrives as `1787616000000` and renders as `24/08/2026`. The same shift applies
to the chart tooltip and the ECharts time axis (`ValueChart.tsx:145,160`), which also formats in
local time. It happens to be invisible for a user in Europe/Paris (UTC+1/+2).

**Fix**: Format these day-valued timestamps with UTC accessors (`getUTCFullYear` etc.), and set the
ECharts `useUTC` option, since the API's convention is "a date, encoded as UTC midnight".

---

### C-13 — Truncated transaction history is treated as complete and rewrites the derived past

**Severity**: Medium
**Confidence**: Certain
**Location**: `backend/providers/src/powens/mod.rs:81-106`, `backend/core/src/ingest.rs:147`

**What's wrong**: `fetch_transactions` caps at 100 pages, logs a warning, and returns the partial
list as if it were a normal success. `ingest` then runs `backfill_connection`, which **deletes all
derived rows for the connection** (`backfill.rs:30-40`) and re-derives them from whatever
transactions are in the DB.

**How it fails**: The upsert on `external_id` means old rows survive in the DB, so this is not
immediately fatal — but the same non-fatal-partial-result pattern applies to any provider-side
truncation or filter change. More concretely, the warning is the only signal: nothing marks the
connection degraded, nothing prevents the backfill from running, and nothing surfaces it to the
user. The re-derivation is unconditional and full-range, so any systematic gap in the fetched set
becomes a systematic distortion in the whole 3.5-year chart on the very next sync.

**Fix**: Return a distinguishable "truncated" outcome from the adapter and either fail the sync or
skip the backfill rewrite when the transaction fetch was incomplete.

---

### C-14 — Distribution pie divides by a total that can be zero or contain negative slices

**Severity**: Medium
**Confidence**: Certain
**Location**: `frontend/src/components/DistributionCard.tsx:27`, `:113`

**What's wrong**: `total = Σ Number(a.value)` and each row shows `Number(a.value) / total`. No guard
for `total === 0`, and no handling of negative account values, which `accounts`/`distribution` can
legitimately return (a checking account with an overdraft maps to a negative cash holding —
`powens/map.rs:186-194` returns `balance` verbatim for non-invest accounts).

**How it fails**: One checking account at −500 € and one savings at +500 € → `total = 0` → every
share is `0/0 = NaN` → `formatPercent(NaN)` renders `NaN %`, and the ECharts pie drops or mangles
the negative slice. A milder version: with a −500 overdraft against 500 savings and 1 000 in a PEA,
the shares are −100 %, 100 % and 200 %.

**Fix**: Use `Σ|value|` (or exclude non-positive slices from the pie and list them separately), and
short-circuit to "—" when the denominator is zero.

---

### C-15 — Yahoo's day-collapse only dedups adjacent points, so an out-of-order repeat aborts the whole price batch

**Severity**: Medium
**Confidence**: Likely
**Location**: `backend/providers/src/yahoo/map.rs:33`

**What's wrong**: `map_points` snaps every bar to UTC midnight and drops a duplicate day only by
comparing against `out.last()`. It relies on the undocumented assumption "Yahoo emits ascending".
`insert_prices` (`core/src/repo/price.rs:254`) then unnests the whole batch into one
`INSERT … ON CONFLICT DO UPDATE`.

**How it fails**: If any two bars for the same day are not adjacent in the response (an
out-of-order row, or a pre/post-market row interleaved), the batch contains the same
`(instrument_id, ts)` twice and Postgres raises *"ON CONFLICT DO UPDATE command cannot affect row a
second time"*. That error is a `CoreError` propagated by `?` out of
`fetch_prices_for_connection_inner`, so **every remaining instrument in the pass is skipped**, not
just the offending one — the whole connection's price refresh is lost for that sync.
`never_emits_the_same_day_twice` (`yahoo/map.rs:299`) only tests the adjacent case, so it would not
catch this.

**Fix**: Dedup by day with a map keyed on the snapped timestamp rather than by comparing the tail,
and make a per-instrument `insert_prices` failure non-fatal to the pass (it is already logged-and-
continue for fetch errors).

---

### C-16 — Cash-row aggregation sums decimal strings as IEEE doubles

**Severity**: Low
**Confidence**: Certain
**Location**: `frontend/src/lib/holdings.ts:191-192`, `:212`

**What's wrong**: `aggregateCash` merges per-account cash rows with
`items.reduce((sum, h) => sum + Number(h.value), 0)` and writes the result back as
`String(value)` — a float round-trip in a money path, on values the backend deliberately sent as
exact decimal strings. The same pattern is used for `qty` and `investedNative`.

**How it fails**: Three EUR cash rows of `"0.1"`, `"0.2"` and `"1234.56"` merge to
`"1234.8599999999999"`. `formatMoney` rounds to 2 decimals so the display survives, but the string
is now the merged row's `value` and feeds `netWorth` in `HoldingsCard.tsx:103`, which is the
denominator of AssetModal's "weight of net worth". Also note `investedNative` is summed across
accounts that may have different `accountCurrency`, while the merged row keeps only
`first.accountCurrency` as its label.

**Fix**: Sum with a decimal library (or on the server), and guard the `investedNative` merge on all
members sharing an `accountCurrency`.

---

### C-17 — A finished sync does not invalidate the transactions cache

**Status**: ✅ Fixed (2026-09-15). Fixed as one issue with C-17 and C-18, since all three are the same cause: the invalidation set for a mutation was hand-written per call site. New `frontend/src/api/keys.ts` is the single definition of every query key (a parameterised key called with no argument yields its family prefix, so read sites pass the range and invalidation sites don't), and new `frontend/src/api/invalidate.ts` names one group per domain event — `afterSyncFinished`, `afterSyncRequested`, `afterAccountEdit`, `afterConnectionDeleted`, `afterLotsSaved`, `afterSessionChange`, `afterUserChange`. All 20 read sites and all 22 invalidation sites in `hooks.ts` plus `SyncButton.tsx` now go through them; no string key literal remains outside `keys.ts`.

Three real stale screens closed: transactions after a sync (C-17), holdings + transactions after an account rename (C-18), and everything after deleting a connection (Z-6's fourth site).

**Two of Z-6's five claimed sites were wrong and were deliberately left as they are.** `useSyncConnection` / `useSyncAll` invalidating only `connections` is correct, not a bug: the backend answers `202 Accepted` and runs the sync in a detached task, so there is nothing fresh to fetch at mutation-success time. The connections query polls every 2s while syncing and `SyncButton`'s syncing→idle effect is the completion signal for every screen — that path is now `afterSyncFinished`. `useCompleteConnection` is the same case, because `complete_connection` kicks an initial sync server-side (`jobs/src/lib.rs`). Both now call `afterSyncRequested`, which documents the intent instead of leaving a bare one-key list that reads like an omission.

Regression tests: `api/invalidate.test.ts` pins each group to its **exact** key set (containment assertions cannot catch a missing key, which is what all three bugs were); `api/keys.test.ts` asserts the prefix property the scheme rests on; `api/hooks.test.tsx` adds `useUpdateAccount invalidation` and `useDeleteConnection`; `components/SyncButton.test.tsx` now asserts the exact list including `transactions`. Frontend suite 221 passed (was 211), `bun run lint` silent, `bun run build` clean. No backend change.

**Severity**: Low
**Confidence**: Certain
**Location**: `frontend/src/components/SyncButton.tsx:11-17`

**What's wrong**: `SYNC_DEPENDENT_KEYS` lists `net-worth`, `distribution`, `accounts`,
`account-series` and `holdings` — but not `transactions`, even though ingesting transactions is the
main thing a sync does.

**How it fails**: The user is on the Transactions page, clicks sync, watches it complete, and the
list still shows yesterday's rows until a manual reload or a filter change (which changes the
query key). `useSaveLots` gets this right (`hooks.ts:83`), which shows the omission is an oversight
rather than a decision.

**Fix**: Add `["transactions"]` to the list.

---

### C-18 — Renaming or recoloring an account leaves the Holdings table stale

**Status**: ✅ Fixed (2026-09-15). Fixed as one issue with C-17 and C-18, since all three are the same cause: the invalidation set for a mutation was hand-written per call site. New `frontend/src/api/keys.ts` is the single definition of every query key (a parameterised key called with no argument yields its family prefix, so read sites pass the range and invalidation sites don't), and new `frontend/src/api/invalidate.ts` names one group per domain event — `afterSyncFinished`, `afterSyncRequested`, `afterAccountEdit`, `afterConnectionDeleted`, `afterLotsSaved`, `afterSessionChange`, `afterUserChange`. All 20 read sites and all 22 invalidation sites in `hooks.ts` plus `SyncButton.tsx` now go through them; no string key literal remains outside `keys.ts`.

Three real stale screens closed: transactions after a sync (C-17), holdings + transactions after an account rename (C-18), and everything after deleting a connection (Z-6's fourth site).

**Two of Z-6's five claimed sites were wrong and were deliberately left as they are.** `useSyncConnection` / `useSyncAll` invalidating only `connections` is correct, not a bug: the backend answers `202 Accepted` and runs the sync in a detached task, so there is nothing fresh to fetch at mutation-success time. The connections query polls every 2s while syncing and `SyncButton`'s syncing→idle effect is the completion signal for every screen — that path is now `afterSyncFinished`. `useCompleteConnection` is the same case, because `complete_connection` kicks an initial sync server-side (`jobs/src/lib.rs`). Both now call `afterSyncRequested`, which documents the intent instead of leaving a bare one-key list that reads like an omission.

Regression tests: `api/invalidate.test.ts` pins each group to its **exact** key set (containment assertions cannot catch a missing key, which is what all three bugs were); `api/keys.test.ts` asserts the prefix property the scheme rests on; `api/hooks.test.tsx` adds `useUpdateAccount invalidation` and `useDeleteConnection`; `components/SyncButton.test.tsx` now asserts the exact list including `transactions`. Frontend suite 221 passed (was 211), `bun run lint` silent, `bun run build` clean. No backend change.

**Severity**: Low
**Confidence**: Certain
**Location**: `frontend/src/api/hooks.ts:182-188`

**What's wrong**: `useUpdateAccount.onSuccess` invalidates `accounts`, `distribution` and
`account-series`, but not `holdings`. The `/holdings` payload carries `accountName`,
`accountColor`, `accountType` and `accountTypeLabel` (`api/src/dto.rs:107-118`).

**How it fails**: The user renames "CPT COURANT" to "Current account" in the edit-account modal.
The Accounts tab updates; the dashboard's Holdings table keeps showing "CPT COURANT" (and the old
color chip and the old account-type filter chip) until the query is refetched for some other
reason.

**Fix**: Add `qc.invalidateQueries({ queryKey: ["holdings"] })`.

---

### C-19 — A Powens `market_order` with a zero value is classified as a sell

**Severity**: Low
**Confidence**: Certain
**Location**: `backend/providers/src/powens/map.rs:333-339`

**What's wrong**: `map_txn_type` derives direction purely from `value < 0`, so `value == 0` falls
into the non-negative branch: `market_order` → `"sell"`, `market_fee` → `"interest"`, and the
catch-all `_ => "deposit"`.

**How it fails**: A zero-value corporate action or a fully-rebated order booked as
`type = "market_order", value = 0` becomes a `sell`. On a PEA it is then excluded from the cash walk
(`backfill.rs:134`) and, if it ever carried a quantity, would subtract shares in `moves`
(`backfill.rs:129`). More visibly, it appears in the ledger labelled "Sell" with amount 0.

**Fix**: Treat `value == 0` as an explicit unknown/neutral case rather than folding it into the
positive branch.

---

### C-20 — An account with no `external_id` is re-inserted on every sync

**Severity**: Low
**Confidence**: Likely
**Location**: `backend/core/src/repo/account.rs:152`

**What's wrong**: `upsert_account`'s conflict target is
`(connection_id, external_id) where external_id is not null`. If `acct.external_id` is empty/absent
the `ON CONFLICT` arbiter cannot match (NULL never conflicts in a partial unique index over a
nullable column), so the insert always creates a new row.

**How it fails**: Powens' `BankAccount.id` is an `i64` so today this cannot be null — but the
canonical DTO takes a `String` and no adapter contract enforces non-emptiness. A future provider
(or a Powens payload with `id: 0` colliding across connections) would create a fresh `account` row
per sync, each with its own holdings, each of them zeroed by the close loop on the following sync.

**Fix**: Reject an empty `external_id` in `upsert_account` (or in the adapter contract) rather than
letting it fall through to an unconstrained insert.

---

### C-21 — `mark_symbol_unresolved` is permanent

**Severity**: Low
**Confidence**: Certain
**Location**: `backend/core/src/price_sync.rs:172-185`, `backend/core/src/repo/instrument.rs:159`

**What's wrong**: Once `meta.yahoo_resolution = "unresolved"` is written, `fetch_prices_for_connection_inner`
`continue`s past that instrument forever. Nothing clears the marker — not a re-listing, not a manual
refresh, not `refresh_all_prices_for_connection` (which only bypasses the *freshness* guard and
`REFETCH_DAYS`, not this one).

**How it fails**: A newly-listed ETF whose ISIN Yahoo's search does not know yet on the day of the
first sync is marked unresolved. It is never priced again, so its holding is valued only by the
provider-valuation fallback branch, and permanently shows a flat sparkline-less row — with no way
to retry short of editing `instrument.meta` by hand.

**Fix**: Store `yahoo_resolved_at` (it already is) and re-attempt after a backoff, e.g. 30 days,
mirroring the composition pass's 30-day eligibility rule.

---

### C-22 — `accounts()` and `distribution()` value from the latest snapshot regardless of how stale it is, with no staleness signal in the number

**Severity**: Low
**Confidence**: Certain
**Location**: `backend/core/src/repo/query.rs:498-512`, `:731-751`

**What's wrong**: Both use `distinct on (hs.holding_id) … order by hs.as_of desc` with no upper or
lower bound on `as_of`. The quantity anchor can be arbitrarily old; only the *price* is as-of today.

**How it fails**: A connection that has been in `error` for three months still contributes its
three-month-old quantities to today's accounts grid and pie, revalued at today's prices. The only
hint is `last_sync_at` on the card. This is consistent with `net_worth_series` (which reads the same
last point) so nothing disagrees — but the figure is presented as current.

**Fix**: Not a computation change — surface staleness on the number itself (the row already carries
`last_sync_at`), or bound the anchor and flag when it is exceeded.

---

### Notes on things checked and found correct

- `valuation_grid` (0018/0019): the `fx`/`lp` split cannot multiply rows —
  `instrument_cash_currency_uq` guarantees one cash instrument per currency, and the `union all`
  branches are disjoint by `kind`. Cash and securities are never both emitted for one instrument-day.
- `sample_days` / `valuation_grid(uuid, date[])`: the caller and the grid unnest the same array, so
  the `as_of` equality join cannot silently miss (this was the explicit point of migration 0019).
- `moves_after`'s `groups between unbounded preceding and 1 preceding` is genuinely "strictly
  greater day" and is robust to duplicate day rows, unlike `rows`.
- `begin_sync` / `begin_await` are correct per-connection locks: the `UPDATE … where status <> …`
  takes a row lock, so a webhook and the awaiting-reaper cannot both start a sync.
- `save_lots` bounds-checks scale and magnitude before multiplying, signs `amount` correctly
  (negative for a buy), derives `connection_id` from the holding rather than the request, and runs
  deletes + adds + backfill in one transaction.
- Money stays `Decimal` end-to-end on the backend. The only float boundary is
  `Decimal::from_f64_retain(close).round_dp(6)` in `yahoo/map.rs:27`, which is documented and
  correctly drops NaN/inf.
- `holdings()`'s `invested_native` cannot decode-fail: `holding.cost_basis` is `not null default 0`,
  so `lot.basis` always resolves.
- The μ formula is genuinely identical in all three places it exists (`backfill.rs:147`,
  `query.rs:288`, `frontend/src/lib/lots.ts:258`).

---

# 2. Security


Scope: `backend/api`, `backend/core`, `backend/jobs`, `backend/providers`, `frontend/src`, `docker/`, git history.
Method: read every route in `backend/api/src/main.rs`, every handler in `backend/api/src/handlers.rs`, and traced each into `core/src/repo/*.rs` to check the SQL predicate. All SQL is `sqlx::query!`/`query_as!` macros with bind parameters.

**Headline:** the authorization layer is genuinely good. Every user-scoped read and write joins back to `connection.user_id` or filters `users.id`/`session.user_id`, and I found **no IDOR**. Admin gating is consistent, and there is no role-mutation endpoint at all, so there is no privilege-escalation surface via the API. The real weaknesses are in the *perimeter*: no rate limiting anywhere, no password policy, no security headers, a bearer token in `localStorage`, and no webhook replay protection.

---

### Endpoint authorization matrix

All routes are under `/api`. "User-scoped in query?" = does the SQL constrain rows to the caller.

| Method | Path | Auth? | Admin? | User-scoped in query? | Verdict |
|---|---|---|---|---|---|
| GET | `/health` | no | no | N/A | OK — leaks git version string (S-13) |
| POST | `/auth/login` | no | no | N/A | OK, but unthrottled + enumerable (S-1, S-3) |
| GET | `/auth/me` | yes | no | yes (`users.id = $1`) | OK |
| PATCH | `/auth/me` | yes | no | yes (`update users … where id=$1`) | OK |
| POST | `/auth/logout` | yes | no | yes (`session.user_id`+`id`) | OK |
| GET | `/auth/token/{token}` | no | no | N/A | OK — token is the capability; unthrottled (S-7) |
| POST | `/auth/invite/{token}/redeem` | no | no | N/A | OK (single-use, `FOR UPDATE`); no password policy (S-2) |
| POST | `/auth/reset/{token}/redeem` | no | no | N/A | OK (single-use, revokes all sessions); no password policy (S-2) |
| PATCH | `/auth/prefs` | yes | no | yes (`where id=$1`) | OK; avatar loosely validated (S-11) |
| POST | `/auth/change-password` | yes | no | yes | OK — verifies current pw, revokes other sessions |
| DELETE | `/auth/account` | yes | no | yes | OK — email confirm + last-admin guard |
| GET | `/auth/sessions` | yes | no | yes (`session.user_id=$1`) | OK |
| DELETE | `/auth/sessions` | yes | no | yes (`user_id=$1 and id<>$2`) | OK |
| DELETE | `/auth/sessions/{id}` | yes | no | yes (`id=$1 and user_id=$2`) | OK |
| GET | `/dashboard/net-worth` | yes | no | yes (`c.user_id=$1`) | OK |
| GET | `/dashboard/distribution` | yes | no | yes (`c.user_id=$1`) | OK |
| GET | `/accounts` | yes | no | yes (`c.user_id=$1`) | OK |
| GET | `/accounts/series` | yes | no | yes (`c.user_id=$1`) | OK |
| PATCH | `/accounts/{id}` | yes | no | yes (`a.id=$1 and c.user_id=$2`) | OK; no field validation (S-12) |
| GET | `/transactions` | yes | no | yes (`c.user_id=$1`) | OK — limit clamped 1..500 |
| GET | `/account-types` | **no** | no | N/A (global reference) | Minor — unauthenticated (S-14) |
| GET | `/connections` | yes | no | yes (`c.user_id=$1`) | OK; surfaces `last_error` (S-13) |
| POST | `/connections/{id}/sync` | yes | no | yes (`id=$1 and user_id=$2`) | OK; unthrottled (S-6) |
| POST | `/sync` | yes | no | yes (`ids_for_user`) | OK; unthrottled (S-6) |
| GET | `/users` | yes | **yes** | N/A (all users, by design) | OK — `require_admin` verified |
| POST | `/invites` | yes | **yes** | N/A | OK — always mints role `user` |
| POST | `/users/{id}/reset-link` | yes | **yes** | N/A | OK; token returned in body (S-9) |
| DELETE | `/users/{id}` | yes | **yes** | N/A | OK — email confirm + last-admin guard |
| GET | `/providers` | yes | **yes** | N/A (global) | OK |
| PATCH | `/providers/{key}` | yes | **yes** | N/A (global) | OK |
| GET | `/providers/enabled` | yes | no | N/A (global) | OK |
| GET | `/settings/cors` | yes | **yes** | N/A (global) | OK |
| PATCH | `/settings/cors` | yes | **yes** | N/A (global) | OK; no origin validation (S-10) |
| POST | `/connections/init` | yes | no | yes (`insert_pending … user_id`) | OK; unbounded creation (S-6) |
| POST | `/connections/complete` | yes | no | yes (`finish_connect … user_id=$2`) | OK; pre-check unscoped (S-15) |
| DELETE | `/connections/{id}` | yes | no | yes (`id=$1 and user_id=$2`) | OK |
| POST | `/webhooks/{provider}` | **no** (HMAC) | no | N/A (correlates by `external_connection_id`) | HMAC verified, fail-closed; **no replay protection** (S-4) |
| GET | `/holdings` | yes | no | yes (`c.user_id=$1`) | OK |
| GET | `/holdings/{id}/prices` | yes | no | yes (`h.id=$1 and c.user_id=$2`) | OK |
| GET | `/holdings/{id}/transactions` | yes | no | yes (`h.id=$1 and c.user_id=$2`) | OK |
| PUT | `/holdings/{id}/lots` | yes | no | yes (ownership join + per-write predicate) | OK — exemplary; derives `connection_id`, never trusts it |
| * | `/*` (SPA fallback) | no | no | N/A | `ServeDir` + `ServeFile` — no traversal; no security headers (S-5) |

---

### S-1 — No rate limiting on login (or anywhere else)

**Status**: ⏳ Deferred (2026-09-15). Verified still true in the working tree — no limiter crate in any `Cargo.toml`, and the only layers wrapped around the API router in `api/src/main.rs` are `CorsLayer` and `TraceLayer`. **This one is live, not dormant**: `docker/docker-compose.yml` joins the external `web` network and the central Caddy reverse-proxies `gripsou.bourdet.be` to it, so the login endpoint is on the public internet with two accounts behind it. Deferred by the user's decision to a later session, together with S-2 and S-3 — they are one code path and should be fixed as one change. The open design question when it is picked up: the per-IP limiter is meaningless behind Caddy unless the forwarded-IP header is explicitly trusted, and forging-dangerous if trusted loosely.

- **Severity**: High
- **Confidence**: Certain
- **Location**: `backend/api/src/main.rs:67-115` (router — no throttling layer), `backend/api/src/handlers.rs:545`
- **What's wrong**: There is no rate-limit, lockout, or backoff middleware in the stack. `grep` for `governor`/`tower_governor`/any limiter across `backend/*/Cargo.toml` returns nothing; the only tower layers are `CorsLayer`, `TraceLayer` and `DefaultBodyLimit`. `POST /api/auth/login` accepts unlimited attempts from one IP against one account.
- **Attack**: An unauthenticated attacker discovers a valid email (see S-3), then scripts `POST /api/auth/login` with a password list. Argon2 default params (~50ms) are the only brake — roughly 20 guesses/s/connection, trivially parallelised across hundreds of concurrent connections. Combined with S-2 (a 1-character password is accepted), a weak password falls in minutes, and the attacker gets the victim's full transaction history, balances, IBANs and net-worth series.
- **Fix**: Add a per-IP and per-account limiter (e.g. `tower_governor`) in front of `/auth/login`, `/auth/*/redeem`, `/auth/token/*` and `/auth/change-password`, plus exponential lockout keyed on the account after N failures. Set `X-Forwarded-For` trust explicitly since `client_ip` already parses it.

### S-2 — No password strength requirements anywhere

**Status**: ⏳ Deferred (2026-09-15). Verified: `redeem_invite` (`handlers.rs:1093`) and `redeem_reset` (`handlers.rs:1120`) check only `is_empty()`; `change_password` (`handlers.rs:789-808`) checks the *current* password and then hashes `new_password` with no validation whatsoever, so an empty password can be set and would then be accepted at login. Deferred with S-1 and S-3. Undecided when deferred: the minimum length (the audit says 12) and whether to mirror the rule in the three frontend forms.

- **Severity**: High
- **Confidence**: Certain
- **Location**: `backend/api/src/handlers.rs:1024-1030` (redeem_invite), `handlers.rs:1052-1054` (redeem_reset), `handlers.rs:721-747` (change_password)
- **What's wrong**: The only check on a new password is `body.password.is_empty()`. `change_password` performs **no** check on `new_password` at all — not even non-empty. There is no minimum length, no breach-list check, no entropy floor.
- **Attack**: A user (or anyone redeeming an invite link) sets their password to `"a"`. `POST /api/auth/change-password` with `{"currentPassword":"…","newPassword":""}` sets an empty password hash that `verify_password("")` will accept. Any subsequent attacker guesses it on the first try via the unthrottled login (S-1) and takes over the account and all its financial data.
- **Fix**: Enforce a minimum length (12+ chars for a self-hosted finance app) and reject empty/whitespace in all three paths, ideally with a common-password denylist. Mirror the validation on the frontend but enforce it server-side.

### S-3 — Login is a user-enumeration oracle via timing

**Status**: ⏳ Deferred (2026-09-15). Verified at `handlers.rs:625-631`: an unknown email short-circuits on `ok_or_else(unauthorized)` before `verify_password` runs, so the Argon2 cost is paid only for real accounts. Not high-severity on its own, but it is three lines in the same handler S-1 and S-2 touch, so it was grouped with them and deferred with them.

- **Severity**: Medium
- **Confidence**: Certain
- **Location**: `backend/api/src/handlers.rs:556-563`
- **What's wrong**: `credentials_by_email` returns `None` for an unknown email and the handler returns 401 immediately, *skipping* `verify_password`. For a known email, Argon2 verification runs first. The error string is identical, but the latency difference is the full Argon2 cost (~50ms vs ~1ms) — an unambiguous, single-request oracle.
- **Attack**: An unauthenticated attacker POSTs `{"email":"victim@example.com","password":"x"}` to `/api/auth/login` and times the response. Under ~5ms → no such account; ~50ms → the account exists. With no rate limiting (S-1) they enumerate an email list in seconds, confirming who banks on this instance, then focus the brute force from S-1 on real accounts.
- **Fix**: On a missing user, verify the supplied password against a fixed dummy Argon2 hash so both branches do the same work before returning the same 401.

### S-4 — Webhook signature has no replay or freshness check

- **Severity**: Medium
- **Confidence**: Certain
- **Location**: `backend/providers/src/powens/mod.rs:376-393`; `backend/jobs/src/lib.rs:handle_webhook`
- **What's wrong**: `verify_webhook` HMACs `POST.{path}.{date}.{body}` and compares — correctly, fail-closed when `POWENS_WEBHOOK_SECRET` is unset. But `bi-signature-date` is only fed into the MAC; its value is never checked against the clock, and there is no nonce/seen-signature store. A valid `(body, date, signature)` triple stays valid forever.
- **Attack**: An attacker who observes one legitimate Powens webhook (a TLS-terminating proxy, a log, a misconfigured egress) replays that exact request to `POST /api/webhooks/powens` indefinitely. Each accepted replay calls `connection::begin_sync` and spawns a full sync, hammering the Powens API with the victim's credentials — plausibly enough to get the instance's Powens client rate-limited or banned, and to churn the victim's data. Note the route also carries a 32 MB body limit (`main.rs:110`), so an unauthenticated attacker can force the server to buffer 32 MB per request before the signature is even checked.
- **Fix**: Reject signatures whose `bi-signature-date` is outside a small window (e.g. ±5 min) and keep a short-lived seen-signature set. Drop the webhook body limit to a few hundred KB.

### S-5 — No security response headers (CSP, X-Frame-Options, nosniff, HSTS)

- **Severity**: Medium
- **Confidence**: Certain
- **Location**: `backend/api/src/main.rs:169-171` (SPA `fallback_service`), `docker/Caddyfile:1-3`
- **What's wrong**: Grepping the whole repo for `content-security-policy`, `x-frame-options`, `strict-transport-security`, `x-content-type-options` returns nothing. The Caddyfile is a bare `reverse_proxy backend:8080` with no header directives, and axum adds no `SetResponseHeader` layer.
- **Attack**: The session token lives in `localStorage` (`frontend/src/api/client.ts:5-13`), so any script execution on the origin exfiltrates it. With no CSP there is no second line of defence: an XSS anywhere in the React tree, a compromised npm dependency shipped in the bundle, or an injected inline script reads `localStorage["gripsou.token"]` and POSTs it out to an attacker host. With no `X-Frame-Options`/`frame-ancestors`, the dashboard can also be framed for clickjacking against destructive actions (delete connection, revoke sessions). Missing HSTS leaves a first-visit downgrade window.
- **Fix**: Add a `SetResponseHeaderLayer` (or Caddy `header` block) setting a strict `Content-Security-Policy` (`default-src 'self'; frame-ancestors 'none'; connect-src 'self'`, with `img-src 'self' data: https://cdn.brandfetch.io` for the avatars/logos), `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, and HSTS at the Caddy layer.

### S-6 — Any authenticated user can hammer provider syncs and create unbounded connections

- **Severity**: Medium
- **Confidence**: Likely
- **Location**: `backend/api/src/handlers.rs:396-433` (`sync_connection`, `sync_all`), `handlers.rs:880-912` (`init_connection`)
- **What's wrong**: `begin_sync` prevents *concurrent* syncs of one connection, but nothing prevents a user from re-triggering the moment each finishes, and `sync_all` fans out over every connection at once. `init_connection` has no cap on pending rows — each call makes a live Powens `connect()` and inserts a row (reaped only after 10 minutes).
- **Attack**: A logged-in user loops `POST /api/sync` and `POST /api/connections/init`. Each sync spawns a detached tokio task that full-fetches every transaction page (up to 100 pages × 1000 rows, `powens/mod.rs:412`) plus Yahoo price fetches and Boursorama scrapes. This burns the *shared, instance-wide* Powens quota and outbound bandwidth, degrading or breaking sync for every other user on the box, and can exhaust the DB pool with concurrent ingest transactions.
- **Fix**: Rate-limit user-initiated sync (a per-connection cooldown, e.g. one manual sync per 5–15 min), and cap concurrent/pending connections per user.

### S-7 — Invite and reset tokens are enumerable-by-brute-force with no throttle

- **Severity**: Medium
- **Confidence**: Likely
- **Location**: `backend/api/src/handlers.rs:1000-1013` (`token_info`), `core/src/repo/invite_token.rs:17-31`
- **What's wrong**: The tokens themselves are strong — 256 bits of `OsRng`, SHA-256-hashed at rest, single-use via `used_at`, 24h expiry, `FOR UPDATE`-locked on redeem. That is all correct. The problem is the surrounding envelope: `GET /api/auth/token/{token}` is fully public, returns 404 vs 200 as a clean oracle, and has no rate limit, and the same is true of the redeem endpoints.
- **Attack**: Practically, 256 bits is unguessable, so this is not an exploitable token-guessing path today — I flag it because the *endpoint* is an unthrottled public probe surface an attacker can use for DoS, and because a 200 response for a reset token discloses the target user's **email address** (`TokenInfoResp.email`) to anyone holding the raw token, including anyone it leaks to (browser history, referrer, chat logs). See also S-9.
- **Fix**: Rate-limit `/auth/token/{token}` and both redeem routes per IP; consider not echoing the email back and instead having the reset page ask the user to confirm it.

### S-8 — AES-GCM ciphertexts are not bound to the row they belong to (no AAD)

- **Severity**: Low
- **Confidence**: Certain
- **Location**: `backend/core/src/crypto.rs:34-46`
- **What's wrong**: The primitive itself is correct — AES-256-GCM, a fresh 96-bit `OsRng` nonce per encryption prepended to the ciphertext, key length strictly validated at 64 hex chars, and a single opaque `DecryptionFailed` error with no padding/format distinction, so there is no decryption oracle. What's missing is associated data: nothing ties a ciphertext to the `connection.id`/`user_id` it was stored under.
- **Attack**: Requires prior DB write access (a SQL-injection foothold — none found — or a stolen backup plus write path), so it is a defence-in-depth gap rather than a live path. Given that access, an attacker copies the `credentials` JSONB from user A's `connection` row into user B's row; it decrypts cleanly under the single global `ENCRYPTION_KEY`, and the next sync runs A's bank token under B's connection, writing A's accounts and balances into B's dashboard.
- **Fix**: Pass the `connection_id` (and a version tag) as AAD to `encrypt`/`decrypt` so a relocated ciphertext fails authentication.

### S-9 — Reset links are minted by admins and returned in-band; reset token binds to email, not user id

- **Severity**: Low
- **Confidence**: Certain
- **Location**: `backend/api/src/handlers.rs:801-829`, `core/src/repo/invite_token.rs:79-116`
- **What's wrong**: Two things. (a) `create_reset_link` returns the raw token to the admin in the response body, so an admin can silently take over any account — inherent to the "self-hosted, admin hands you a link" design, but it means an admin session compromise is an instant takeover of every account. (b) `redeem_reset` resolves its target with `update users set password_hash = $2 where email = $1`, keying on the email captured when the token was minted rather than the user id.
- **Attack**: For (b): admin mints a reset for `bob@x.com`. Bob then changes his email via `PATCH /api/auth/me` to `bob2@x.com`, freeing `bob@x.com`. A different user (or a new invitee) claims `bob@x.com`. The still-valid 24h token now resets *that* account's password. Narrow and requires the email to be recycled inside the window, but it is a real mis-binding.
- **Fix**: Store `user_id` on the reset token and key `redeem_reset` on it. Consider logging admin-initiated reset-link creation to an audit trail.

### S-10 — CORS origins are admin-settable with no validation, and credentials are allowed

- **Severity**: Low
- **Confidence**: Certain
- **Location**: `backend/api/src/main.rs:117-142`, `backend/api/src/handlers.rs:490-505`
- **What's wrong**: `set_cors_origins` writes whatever strings the admin sends into `app_settings` and into the in-process cache; the predicate then does an exact string match against the `Origin` header with `allow_credentials(true)`. No scheme/host validation, no rejection of `null` or `*`.
- **Attack**: Impact is limited because auth is a bearer header, not a cookie — a cross-origin page has no token to send, so `allow_credentials` buys an attacker nothing here. The real risk is an admin fat-fingering a broad or attacker-controlled origin (or adding `null`, which matches sandboxed iframes and `data:` documents) and thereby permitting a hostile page to script the API on behalf of a token it later obtains. Note the predicate returns `false` on a poisoned `RwLock`, which fails closed — good.
- **Fix**: Validate each entry parses as an absolute `scheme://host[:port]` origin, reject `*` and `null`, and drop `allow_credentials` since no credentials are cookie-borne.

### S-11 — Avatar validation is prefix-only; prefs blob is otherwise unbounded

- **Severity**: Low
- **Confidence**: Certain
- **Location**: `backend/api/src/handlers.rs:606-628`, `backend/core/src/repo/prefs.rs:8-30`
- **What's wrong**: The avatar check is `starts_with("data:image/")` plus a 200 KB cap. `data:image/svg+xml;base64,…` passes. No other `UserPrefs` field (`ui_language`, `date_format`, `number_group_sep`, `currency`, …) has any length or content validation before it is written to the JSONB column.
- **Attack**: A user uploads an SVG avatar containing `<script>`. Rendered through `<img src>` in `frontend/src/components/Avatar.tsx` this does **not** execute — img context neuters SVG script — so it is not live XSS today. It becomes one the moment any code path renders the avatar as an `<object>`, `<embed>`, inline SVG, or opens it in a new tab; and an admin viewing `/settings/users` loads every user's avatar. Separately, a user can store ~2 MB of junk per prefs field (bounded only by axum's default body limit) and, via `number_group_sep`/`date_format`, feed arbitrary strings into the frontend's `Intl` formatting path.
- **Fix**: Allowlist the concrete image MIME types (`png`, `jpeg`, `webp`, `gif`) and reject `svg+xml`; add length caps and value allowlists to the other prefs fields.

### S-12 — `PATCH /accounts/{id}` accepts unvalidated name/color

- **Severity**: Low
- **Confidence**: Certain
- **Location**: `backend/api/src/handlers.rs:446-465`, `backend/core/src/repo/account.rs:70-93`
- **What's wrong**: Ownership is correctly enforced (`a.id = $1 and c.user_id = $2`), but `name` and `color` are written verbatim with no length limit and no format check on `color` — it is a free-form `text` column, not a validated hex triplet. `type_key` is protected only by the FK to `account_type`.
- **Attack**: A user sets `color` to an arbitrary string; the frontend interpolates account colors into chart/badge styling, so a crafted value is a CSS-injection primitive against that user's own view (and, for `distribution`/`transactions` responses, only their own). Low impact because accounts are strictly single-user, but a multi-KB `name` also bloats every dashboard response.
- **Fix**: Validate `color` against `^#[0-9a-fA-F]{6}$` and cap `name` at a sane length server-side.

### S-13 — Internal detail leaks: provider error strings, git version

- **Severity**: Low
- **Confidence**: Likely
- **Location**: `backend/api/src/handlers.rs:906-910` (`init_connection` 500 path), `handlers.rs:913-935` (`complete_connection`), `backend/jobs/src/lib.rs:fail_sync` → `connection.last_error` surfaced by `GET /connections`, `backend/api/src/main.rs:184`
- **What's wrong**: `internal()` is exemplary — it logs the real error and returns a fixed string, with an explicit comment about sqlx leaking statements. But three paths bypass it: `init_connection` returns `e.to_string()` straight to the client with a 500; `complete_connection` returns `e.to_string()` as a 400/404; and `fail_sync` persists raw provider error strings into `connection.last_error`, which `GET /api/connections` returns to the user. `/api/health` returns `GRIPSOU_VERSION`, a git-derived string, unauthenticated.
- **Attack**: A logged-in user triggers a failing connect and reads back reqwest/Powens error text — typically the request URL and status, disclosing `POWENS_DOMAIN` and internal endpoint shapes. I traced the credential paths and found **no** case where the client secret or bank auth token reaches these strings (the secret travels in a POST body, and `decrypt_credentials` errors are the fixed `CryptoError` messages), so this is reconnaissance, not credential disclosure. `/api/health` hands an unauthenticated scanner the exact commit, making CVE-matching easy.
- **Fix**: Route these three paths through `internal()`/a sanitised message, store a user-facing category alongside the raw `last_error` and only return the category, and gate the version field behind auth.

### S-14 — `GET /account-types` is unauthenticated

- **Severity**: Low
- **Confidence**: Certain
- **Location**: `backend/api/src/handlers.rs:435-444`, `backend/api/src/main.rs:92`
- **What's wrong**: `account_types` takes only `State(pool)` — no `AuthUser` extractor, unlike every other data route. It is the sole authenticated-by-omission gap I found.
- **Attack**: An unauthenticated attacker GETs `/api/account-types` and receives the reference table. The data is static seed content (`migrations/0002_seed_reference.sql`) with no user data in it, so the real cost is an unauthenticated DB query per request — a free amplification target — plus confirmation that the host runs gripsou.
- **Fix**: Add the `AuthUser` extractor, as every sibling route does.

### S-15 — `complete_connection` looks up the provider key before checking ownership

- **Severity**: Low
- **Confidence**: Certain
- **Location**: `backend/jobs/src/lib.rs:complete_connection`, `backend/core/src/repo/connection.rs:179-186`
- **What's wrong**: `connection::provider_key(&db, connection_id)` has no `user_id` predicate. Ownership is enforced later, correctly, by `finish_connect (… where id = $1 and user_id = $2)`, so **no cross-user write is possible** — but the unscoped read happens first and drives an outbound provider call. Separately, `params` are concatenated into a query string with `format!("{k}={v}")` and no URL-encoding.
- **Attack**: A logged-in user submits another user's `connectionId` (a UUID, so it must be guessed or observed) and watches the response: an unknown id yields "connection not found" from the provider_key lookup, while a *valid* id belonging to someone else proceeds to call `adapter.complete_connect()` and only then fails at `finish_connect` — a distinguishable timing/error oracle that confirms the id exists and forces an outbound Powens token-exchange attempt. The unencoded `format!` also lets a caller inject `&`-separated parameters into their own provider callback query.
- **Fix**: Scope `provider_key` (or add an explicit ownership check) before any provider call, and percent-encode `params` when building the query string.

### S-16 — Container runs as root; default database credentials in compose

- **Severity**: Low
- **Confidence**: Certain
- **Location**: `docker/Dockerfile:23-33`, `docker/docker-compose.yml:5-9`
- **What's wrong**: The runtime stage has no `USER` directive, so `gripsou` runs as uid 0 inside the container. Postgres uses the hardcoded `gripsou`/`gripsou` credentials from compose (and `DATABASE_URL` repeats them), with the same defaults in `.env.example`.
- **Attack**: The DB is not port-published and sits on an internal network, so the weak password is not remotely reachable — the exposure is lateral: anything that gains code execution in the backend container (a dependency compromise, an RCE) is immediately root there, and can reach Postgres with guessable credentials on the internal network. Root also means a container-escape primitive lands as host root.
- **Fix**: Add a non-root `USER` to the runtime stage, generate the Postgres password into `.env` rather than hardcoding it, and drop capabilities / set `read_only` on the backend service.

### S-17 — Vulnerable npm dependencies (dev-only) and no dependency scanning in CI

- **Severity**: Low
- **Confidence**: Certain
- **Location**: `frontend/bun.lock:465,629` (`jsdom → undici@7.27.2`), `frontend/package.json` (eslint → brace-expansion)
- **What's wrong**: `bun audit` reports 15 vulnerabilities (7 high). I traced every one: they resolve through `jsdom` (vitest's DOM environment) and `eslint`, both `devDependencies`, so **none ship in the production bundle**. There is no `cargo audit`/`bun audit` step in the repo's CI script.
- **Attack**: No production attack path. The realistic risk is developer-machine compromise — `undici`'s SOCKS5 TLS-bypass and request-routing issues fire during test runs — and the absence of scanning means a future *production* dependency CVE goes unnoticed.
- **Fix**: Run `bun update` to clear the dev advisories and add `bun audit` + `cargo audit`/`cargo deny` to the CI script so production-path CVEs surface automatically.

---

### Verified as correct (checked, no finding)

Recording these so the next reviewer does not re-derive them:

- **No IDOR anywhere.** Every id-taking endpoint constrains on `connection.user_id`, `users.id`, or `session.user_id`. `save_lots` is the standout: it *derives* `connection_id` from the holding inside the ownership query rather than trusting the request, returns 404 (not 403) for unowned ids so it never confirms their existence, and re-checks ownership in each write predicate.
- **No SQL injection.** Every query is a compile-time-checked `sqlx::query!`/`query_as!` with bind parameters. The only `format!`s touching a query-ish string are the two Powens HMAC payloads. The `transactions` search filter is bound as `$2` and wrapped with `'%' || $2 || '%'` inside the statement.
- **No privilege escalation.** There is no endpoint that mutates `users.role`. Invites hardcode `values (…, 'user')`. Admin is grantable only by direct SQL.
- **Session handling.** 256-bit `OsRng` tokens, SHA-256-hashed at rest (raw token never stored), unique index on `token_hash`, expiry enforced in the lookup predicate, throttled sliding-window touch, `on delete cascade` from `users`, hourly pruning of expired rows. Password change and reset both revoke all other sessions.
- **Password hashing.** Argon2 (default params) with a per-password `SaltString::generate(&mut OsRng)`; verification via the constant-time `PasswordVerifier`; malformed hashes fail closed.
- **CSRF is a non-issue.** Auth is a bearer `Authorization` header, never a cookie — there are no cookies in the codebase at all — so no ambient-credential CSRF exists.
- **Invite/reset token lifecycle.** Single-use (`used_at`), 24h expiry, `SELECT … FOR UPDATE` prevents concurrent double-redemption, and a duplicate-email failure rolls back leaving the token unconsumed for retry.
- **Crypto primitive.** See S-8 — nonce generation, key validation and error opacity are all correct; only AAD binding is missing.
- **Webhook auth fails closed.** An unset `POWENS_WEBHOOK_SECRET` makes `verify_webhook` return `Err` → 401, rather than accepting unsigned calls.
- **No SSRF.** `logo.rs` builds URLs from a hardcoded `INSTITUTION_DOMAINS` allowlist and returns them to the client rather than fetching them. Yahoo and Boursorama URLs are built from a fixed base plus a URL-encoded symbol.
- **No path traversal.** Static serving is `ServeDir` + `ServeFile` (both traversal-safe); there is no user-controlled filesystem path anywhere.
- **No secrets in git history.** `.env` has been gitignored since the initial commit. `git log -S` on `POWENS_CLIENT_SECRET` finds only the empty `.env.example` placeholder and a `test-secret` literal in a CI script. Committed Powens fixtures are synthetic (round balances, `FR76123456…`, sequential ids 1001–1004).
- **No secrets in logs or `Debug` impls.** No credential/token value reaches a `tracing::` macro; `CompleteConnect`'s `Debug` carries only the provider meta shape.
- **Decimal handling.** `save_lots` validates scale (≤8) and magnitude (<10^12), uses `checked_mul`, and rejects anything that would write a `NUMERIC` unreadable as a `Decimal` — closing a self-inflicted permanent-500 DoS.

---

# 3. Centralization / DRY


Lens: shared mechanisms exist; are they used *everywhere*, or bypassed with local
reimplementations, hardcoded values, or subtly different variants?

Canonical formatters live in `frontend/src/lib/`:
`date.ts` (`formatDate`, `formatRelative`), `money.ts` (`formatMoney`,
`formatQuantity`, `formatPercent`), `currency.ts` (`currencySymbol`, `CURRENCIES`),
`prefs.ts` (`UserPrefs` singleton, mirrors `backend/core/src/repo/prefs.rs`),
plus the `<Money>` / `<Percent>` components.

---

### Formatting coverage table

Every site in the frontend that renders a date, a number, a currency amount, or a
percentage. "Compliant" = routes through the shared prefs-aware formatter.

#### Dates

| Site | Uses | Compliant |
|---|---|---|
| `components/PageHeader.tsx:13` | `new Date().toLocaleDateString(i18n.language, {weekday,year,month,day})` | **NO** |
| `components/TransactionsTable.tsx:9` (used at `:29`) | `new Intl.DateTimeFormat(locale, {dateStyle:"medium"})` | **NO** |
| `components/RecordLotsModal.tsx:26` (`today()`) | `new Date().toISOString().slice(0,10)` | **NO** (also UTC-shifts) |
| `components/RecordLotsModal.tsx:103` | `new Date(p.t).toISOString().slice(0,10)` | **NO** (also UTC-shifts) |
| `components/RecordLotsModal.tsx:282` | `<input type="date">` — browser/OS locale, ignores `prefs.dateFormat` | **NO** (platform limit) |
| `components/TransactionFilters.tsx:58` | `<input type="date">` | **NO** (platform limit) |
| `components/TransactionFilters.tsx:65` | `<input type="date">` | **NO** (platform limit) |
| `components/UserDetailModal.tsx:106` | `formatDate` | yes |
| `components/SessionDetailModal.tsx:88` | `formatDate` | yes |
| `components/SessionDetailModal.tsx:84` | `formatRelative` | yes |
| `pages/settings/Users.tsx:161` | `formatDate` | yes |
| `pages/settings/Account.tsx:268` | `formatDate` | yes |
| `pages/settings/Account.tsx:239`, `:266` | `formatRelative` | yes |
| `pages/settings/General.tsx:71` | `formatDate` (explicit pattern, preview) | yes |
| `components/ConnectionRow.tsx:76` | `formatRelative` | yes |
| `components/AccountCard.tsx:84` | `formatRelative` | yes |
| `components/AssetModal.tsx:459` | `formatDate` | yes |
| `components/ValueChart.tsx:145` (tooltip), `:160` (x-axis) | `formatDate` | yes |
| `components/StackedAreaChart.tsx:77` (tooltip), `:93` (x-axis) | `formatDate` | yes |

**7 of 19 date render sites bypass `formatDate`.** Three are `<input type="date">`
(platform-constrained); four are avoidable.

#### Currency amounts

| Site | Uses | Compliant |
|---|---|---|
| `components/HoldingsCard.tsx:267` | hardcoded `"€"` as badge fallback text when `ticker === "EUR"` | **NO** |
| `components/AccountCard.tsx:50` | `<Money>` | yes |
| `components/AccountsChartCard.tsx:56`, `:60` | `<Money>` | yes |
| `components/NetWorthCard.tsx:85`, `:99` | `<Money>` | yes |
| `components/NetWorthCard.tsx:46` | `currencySymbol(getPrefs().currency)` as a control label | yes |
| `components/DistributionCard.tsx:83`, `:127` | `<Money>` | yes |
| `components/HoldingsCard.tsx:321`, `:328` | `<Money>` | yes |
| `components/TransactionsTable.tsx:40` | `<Money currency={r.currency}>` | yes |
| `components/AssetModal.tsx:213`, `:228`, `:355` | `<Money>` | yes |
| `components/AssetModal.tsx:346`, `:348`, `:349`, `:465`, `:470` | `formatMoney` | yes |
| `components/RecordLotsModal.tsx:310`, `:372`, `:377`, `:440` | `formatMoney` / `<Money>` | yes |
| `components/ConnectionRow.tsx:127` | `formatMoney` | yes |
| `components/ValueChart.tsx:85` (tooltip + y-axis via `fmt`) | `formatMoney` | yes |
| `components/StackedAreaChart.tsx:71`, `:74`, `:107` | `formatMoney` | yes |
| `pages/settings/General.tsx:146`, `:149` | `formatMoney` (explicit opts, preview) | yes |
| `lib/currency.ts:7-12` | literal `€ $ £ ¥` inside `CURRENCIES` picker labels | yes (canonical) |

**1 of ~30 money render sites bypasses the formatter.**

#### Percentages

| Site | Uses | Compliant |
|---|---|---|
| `components/AccountCard.tsx:62` | `<Percent>` | yes |
| `components/AccountsChartCard.tsx:61` | `<Percent>` | yes |
| `components/NetWorthCard.tsx:100` | `<Percent>` | yes |
| `components/DistributionCard.tsx:112` | `<Percent>` | yes |
| `components/HoldingsCard.tsx:333` | `<Percent>` | yes |
| `components/AssetModal.tsx:234`, `:361`, `:407` | `<Percent>` | yes |
| `components/ValueChart.tsx:85` | `formatPercent` | yes |
| `components/CompositionSurface.tsx:49` | `` `${s.percent}%` `` — CSS width only, not rendered text | n/a |
| `components/RecordLotsModal.tsx:235` | `` `${barWidth * 100}%` `` — CSS width only | n/a |

**Percent formatting is 100% compliant.** Note the denominators are not (see Z-3).

#### Quantities

All sites use `formatQuantity` (`HoldingsCard.tsx:285`, `AssetModal.tsx:343`/`:462`,
`RecordLotsModal.tsx:227`/`:228`, `IncompleteHistoryStrip.tsx:31`,
`HoldingsCard.tsx:247`) — but `formatQuantity` hardcodes `maxFrac: 2`
(`lib/money.ts:107`) and ignores `prefs.numberDecimals`. See Z-11.

---

### Z-1 — The mean-price / cost-basis formula is implemented three times in three languages

**Status**: ✅ Fixed. The rule lives only in `lot_basis` (`0022`), a SQL function over the new
`lot` table (`0021`). `backfill.rs`'s `mean_buy` and `lots` CTEs are deleted, and
`frontend/src/lib/lots.ts` is deleted outright. The Record-Lots modal's live preview no longer
reimplements the math client-side — it calls `POST /holdings/:id/lots/preview`, which runs
`lot_basis` inside a rolled-back transaction, so the preview and the saved result can never
diverge. Regression tests: `core/tests/lot_basis.rs::a_sale_removes_cost_not_proceeds`,
`core/tests/lot_basis.rs::fee_is_part_of_the_basis`.

**Severity**: High

**The shared thing**: None exists. The spec §4.1 rule (μ = Σ(buy qty × price) / Σ(buy qty),
invested = μ × netQty) has no single home; the code comments openly admit it is
replicated and must be kept in sync by hand.

**Offending sites**:
- `backend/core/src/backfill.rs:148-155` — `mean_buy` CTE: `sum(t.quantity * t.unit_price) / nullif(sum(t.quantity), 0)`, filtered `where t.type = 'buy' and t.quantity is not null and t.unit_price is not null`.
- `backend/core/src/repo/query.rs:325-331` — `lot` lateral: same μ but expressed with `filter (where t.type = 'buy' and t.unit_price is not null)` and the null-quantity guard moved to the outer `where`, plus a §4.3 "lots explain the position exactly" override that `backfill.rs` does not have.
- `frontend/src/lib/lots.ts:34-64` (`resultingFigures`) — a third, TypeScript/IEEE-double implementation, computing `meanPrice`, `invested`, `realised`, `unrealised`.
- `backend/core/src/backfill.rs:164-176` (`lots` CTE) — consumes μ to build the per-day basis walk, a fourth place the rule is embedded.

The comments confirm the coupling: `lots.ts:27-28` — *"This must stay identical to the SQL in `backfill.rs` and `query.rs` — if one changes, all three change, or the modal and the chart disagree."* `backfill.rs:145-146` — *"Upgrade path if it ever matters: a recursive CTE … AND the same change in `query.rs` and `lib/lots.ts`."*

**Why it matters**: The Record-Lots modal's live "resulting figures" preview
(`RecordLotsModal.tsx:160`) is computed by `lots.ts`, while the "Capital invested"
the user sees after saving comes from `query.rs`, and the invested *line on the
chart* comes from `backfill.rs`. Any drift means the number the user is shown while
editing differs from the number they get after saving, with no error anywhere.

**Fix**: Make `query.rs`'s `lot` lateral the single definition — extract it into a
SQL function or view (`holding_basis(holding_id)`) that `backfill.rs` also calls, and
have the modal preview call a `POST /holdings/:id/lots/preview` endpoint instead of
reimplementing the math client-side. Delete `lib/lots.ts`.

---

### Z-2 — The valuation + FX expression is written five times in five slightly different forms

**Severity**: High

**The shared thing**: `backend/migrations/0010_currency_fx.sql` defines the canonical
scalars `fx_asof`, `unit_value_asof`, `reporting_fx_asof`;
`migrations/0019_valuation_grid_days.sql` defines the set-returning `valuation_grid`.
Every read query then re-assembles the same "quantity × unit value, else provider
value × account FX, else 0, all divided into the reporting currency" rule by hand.

**Offending sites** (the value expression):
- `backend/core/src/repo/query.rs:101-113` (`net_worth_series`) — grid form: `coalesce(snap.quantity*uv.unit_value, snap.value*afx.unit_value, 0)` divided by `coalesce(nullif(rep.unit_value,0),1)`.
- `backend/core/src/repo/query.rs:255-259` (`holdings`) — scalar form: `coalesce(h.quantity*unit_value_asof(...), snap.value*fx_asof(a.currency,...), 0) / reporting_fx_asof($1,...)`.
- `backend/core/src/repo/query.rs:503-509` (`accounts`) — scalar form again, but reading `hs.quantity` from `holding_snapshot` (not `holding_point`), so it silently ignores backfilled days that the two chart queries include.
- `backend/core/src/repo/query.rs:606-612` (`account_series`) — grid form, identical to the net-worth one but with `fx_missing` dropped entirely.
- `backend/core/src/repo/query.rs:725+` (`distribution`) — a fifth variant, valued through `valuation_grid` over a single-element date array.

**Offending sites** (the reporting-currency divisor — `reporting_fx_asof` exists as a
SQL function, yet is re-inlined three times):
- `backend/core/src/repo/query.rs:97-100` — `rep as materialized (… where currency = coalesce((select prefs->>'currency' from users where id = $1), 'EUR'))`
- `backend/core/src/repo/query.rs:598-601` — byte-identical copy
- `backend/core/src/repo/query.rs:728-731` — byte-identical copy
- vs. the canonical `migrations/0011_reporting_fx_zero_guard.sql:11-19`

**Offending sites** (the `fx_missing` predicate — four different spellings of the same test):
- `backend/core/src/repo/query.rs:107-112` — `bool_or(... is null and ... is null and h.quantity <> 0)` inside the aggregate
- `backend/core/src/repo/query.rs:271-273` — `(unit_value_asof(...) is null and coalesce(snap.value*fx_asof(...),0) = 0)`, with `h.quantity <> 0` pushed into the outer `where`
- `backend/core/src/repo/query.rs:509-511` — `h.quantity <> 0 and unit_value_asof(...) is null and coalesce(hs.value*fx_asof(...),0) = 0`
- `backend/core/src/repo/query.rs:591-593` — `account_series` computes **no** flag at all, so the stacked-area chart silently understates without warning

**Why it matters**: These five queries feed the *same dashboard screen* — the
net-worth headline, the accounts grid, the pie, the stacked area, and the holdings
table. They are supposed to sum to each other. The `accounts` variant already
diverges (`holding_snapshot` vs `holding_point`), and each new currency edge case
has to be fixed five times or the numbers on one screen stop agreeing.

**Fix**: Collapse the value expression into one SQL function
(`holding_value_asof(holding_id, day, user_id)` returning value + fx_missing) and
have all five call it; replace the three inlined `rep` CTEs with
`reporting_fx_asof`, or delete the SQL function if the CTE is genuinely faster
(currently you maintain both).

---

### Z-3 — "Net worth" (the percentage denominator) is computed four different ways

**Severity**: High

**The shared thing**: The backend already returns an authoritative
`summary.netWorth` (`backend/api/src/dto.rs:64`, consumed at
`NetWorthCard.tsx:85`). Three components ignore it and re-derive a total by
float-summing whatever list they happen to hold.

**Offending sites**:
- `frontend/src/components/HoldingsCard.tsx:103-106` — `holdings.reduce((s,h) => s + Number(h.value), 0)`. This total is then passed to `AssetModal` as `netWorth` (`AssetModal.tsx:408`) to render "weight of net worth". The backend's `holdings()` query filters `h.quantity <> 0` (`query.rs:336`), so any zero-quantity position is excluded from this denominator but included in the real net worth.
- `frontend/src/components/AccountsList.tsx:15` — `accounts.reduce((s,a) => s + Number(a.value), 0)`, used at `:32` as the denominator for each `AccountCard`'s "% of net worth".
- `frontend/src/components/DistributionCard.tsx:27` — `accounts.reduce((s,a) => s + Number(a.value), 0)`, used at `:113` for each slice's percentage.
- `frontend/src/components/AccountsChartCard.tsx:56` — uses the backend `summary.netWorth`, i.e. a *fourth* value on the same page as the stacked series it labels.

**Why it matters**: A user reads "% of net worth" on the Accounts page and on an
asset in the Dashboard's holdings table and gets two percentages computed against
two different totals — with a third total printed as the headline right above them.
Float summation of decimal strings adds a second, smaller source of drift.

**Fix**: Have the components read `useNetWorth().data.summary.netWorth` for the
denominator (a single shared hook already exists), or better, have the backend send
the weight per row so no client-side division happens at all.

---

### Z-4 — `settings.roleMember` does not exist: the sidebar renders a raw i18n key for non-admins

**Status**: ✅ Fixed. One top-level `roles.admin` / `roles.member` pair now serves all four role-label
call sites (`Sidebar.tsx`, `UserDetailModal.tsx`, `Users.tsx` ×2); `sidebar.administrator` and
`settings.users.roleAdmin` / `roleMember` are deleted from `en.json` and `fr.json`. The sidebar
therefore says "Admin" where it used to say "Administrator" — the same word every other screen uses.
`settings.adminBadge` was **kept**: it marks a nav item as admin-only, which is a different statement
from "this person is an admin", and merging the two would have tied unrelated strings together.
Regression test: `Sidebar.test.tsx` — "renders the %s role label", which fails against the old keys.

**Severity**: High

**The shared thing**: `frontend/src/i18n/en.json` / `fr.json`. The role label is
defined **three times** under three different namespaces.

**Offending sites**:
- `frontend/src/components/Sidebar.tsx:33` — `t(self.role === "admin" ? "sidebar.administrator" : "settings.roleMember")`. **`settings.roleMember` is not a key.** `en.json`'s `settings` object contains only `adminBadge, general, account, users, server, connections` — the member label lives at `settings.users.roleMember`. A non-admin user sees the literal string `settings.roleMember` under their name in the sidebar, in both languages.
- `frontend/src/i18n/en.json:221` — `settings.adminBadge = "Admin"` (used by `SettingsSidebar.tsx:31`)
- `frontend/src/i18n/en.json:297-298` — `settings.users.roleAdmin = "Admin"`, `settings.users.roleMember = "Member"` (used by `Users.tsx:105`, `Users.tsx:131`, `UserDetailModal.tsx:50`)
- `frontend/src/i18n/en.json:191` — `sidebar.administrator = "Administrator"` (used only by `Sidebar.tsx:33`)

**Why it matters**: A live, visible defect for every member-role user, caused
directly by having four keys for two labels — nobody could tell which namespace was
the right one.

**Fix**: One `roles.admin` / `roles.member` pair; delete `sidebar.administrator`,
`settings.adminBadge`, `settings.users.roleAdmin`, `settings.users.roleMember` and
point all five call sites at it.

---

### Z-5 — Chart theme colours are hardcoded hex, duplicating the CSS design tokens

**Severity**: High

**The shared thing**: `frontend/src/index.css:6-31` (`@theme` block) is the single
source of design tokens. Some components use `var(--color-…)`; the ECharts
components copy the hex values into module constants, with a comment naming the
token they duplicate.

**Offending sites**:
- `frontend/src/components/ValueChart.tsx:20-26` — `GRID="#262321" // surface-3`, `FAINT="#777471" // fg-faint`, `DIM="#aeaaa7" // fg-dim`, `WHITE="#f4f1ef" // fg`, `RED="#f87171" // color-red`, `SURFACE_2="#1c1916"`, and `MONO='"Geist Mono Variable", ui-monospace, monospace'` duplicating `--font-mono`.
- `frontend/src/components/StackedAreaChart.tsx:14-18` — byte-identical copies of `GRID`, `FAINT`, `DIM`, `WHITE`, `MONO`.
- `frontend/src/components/NetWorthChart.tsx:4-6` — `GREEN="#34d399"`, `GRAY="#777471"`, `SURFACE="#13110f"`.
- `frontend/src/components/DistributionCard.tsx:14` — `SURFACE = "#13110f"` (third copy of `--color-surface`).
- `frontend/src/components/AssetModal.tsx:155-156` — series colours as inline literals `"#777471"` and `"#34d399"` — while the *legend of the very same chart* uses `var(--color-green)` / `var(--color-fg-faint)` at `AssetModal.tsx:59-60`.
- `frontend/src/components/NetWorthCard.tsx:51-54` — legend uses `var(--color-green)` / `var(--color-fg-faint)` while `NetWorthChart.tsx:22-23` draws the same two series from its own hex constants.

**Why it matters**: The legend swatch and the line it labels are painted from two
independent colour sources. Any token change in `index.css` repaints the legend but
not the chart, and the app has no theme switch to catch it in review.

**Fix**: One `lib/theme.ts` that reads the tokens via
`getComputedStyle(document.documentElement).getPropertyValue('--color-green')` (or a
generated constants file), and have every chart and legend import from it.

---

### Z-6 — Cache invalidation is hand-written per mutation and is incomplete in four places

**Status**: ✅ Fixed (2026-09-15). Fixed as one issue with C-17 and C-18, since all three are the same cause: the invalidation set for a mutation was hand-written per call site. New `frontend/src/api/keys.ts` is the single definition of every query key (a parameterised key called with no argument yields its family prefix, so read sites pass the range and invalidation sites don't), and new `frontend/src/api/invalidate.ts` names one group per domain event — `afterSyncFinished`, `afterSyncRequested`, `afterAccountEdit`, `afterConnectionDeleted`, `afterLotsSaved`, `afterSessionChange`, `afterUserChange`. All 20 read sites and all 22 invalidation sites in `hooks.ts` plus `SyncButton.tsx` now go through them; no string key literal remains outside `keys.ts`.

Three real stale screens closed: transactions after a sync (C-17), holdings + transactions after an account rename (C-18), and everything after deleting a connection (Z-6's fourth site).

**Two of Z-6's five claimed sites were wrong and were deliberately left as they are.** `useSyncConnection` / `useSyncAll` invalidating only `connections` is correct, not a bug: the backend answers `202 Accepted` and runs the sync in a detached task, so there is nothing fresh to fetch at mutation-success time. The connections query polls every 2s while syncing and `SyncButton`'s syncing→idle effect is the completion signal for every screen — that path is now `afterSyncFinished`. `useCompleteConnection` is the same case, because `complete_connection` kicks an initial sync server-side (`jobs/src/lib.rs`). Both now call `afterSyncRequested`, which documents the intent instead of leaving a bare one-key list that reads like an omission.

Regression tests: `api/invalidate.test.ts` pins each group to its **exact** key set (containment assertions cannot catch a missing key, which is what all three bugs were); `api/keys.test.ts` asserts the prefix property the scheme rests on; `api/hooks.test.tsx` adds `useUpdateAccount invalidation` and `useDeleteConnection`; `components/SyncButton.test.tsx` now asserts the exact list including `transactions`. Frontend suite 221 passed (was 211), `bun run lint` silent, `bun run build` clean. No backend change.

**Severity**: High

**The shared thing**: No query-key factory exists. Keys are bare string literals
constructed at 20 `useQuery` sites and re-typed at 22 `invalidateQueries` sites in
`frontend/src/api/hooks.ts`.

**Offending sites** (stale-data bugs, verified against what each screen renders):
- `frontend/src/api/hooks.ts:181-189` (`useUpdateAccount`) — invalidates `accounts`, `distribution`, `account-series`. Does **not** invalidate `holdings`, whose table renders `h.accountName`, `h.accountColor` and `h.accountTypeLabel` (`HoldingsCard.tsx:292-307`), nor `transactions`, which renders `r.accountName` (`TransactionsTable.tsx:36`). Renaming or recolouring an account leaves both tables showing the old value.
- `frontend/src/api/hooks.ts:272-274` (`useSyncConnection`) — invalidates only `connections`. After a sync completes, `net-worth`, `holdings`, `accounts`, `distribution`, `account-series` and `transactions` all keep serving pre-sync data.
- `frontend/src/api/hooks.ts:280-282` (`useSyncAll`) — same, only `connections`.
- `frontend/src/api/hooks.ts:363-364` (`useDeleteConnection`) — only `connections`. Every dashboard figure still includes the deleted connection's accounts.
- `frontend/src/api/hooks.ts:355-356` (`useCompleteConnection`) — only `connections`. A freshly linked bank does not appear anywhere until a manual refresh.

**Offending sites** (the duplication itself): keys repeated as literals at
`hooks.ts:31, 41, 50, 57, 82-87, 94, 102, 109, 116, 132, 158, 165, 185-187, 205, 223, 238, 247, 255, 261, 274, 282, 288, 300-310, 316, 323, 332, 356, 364, 385`.

**Why it matters**: Four concrete stale-screen bugs, and the pattern guarantees more:
the correct invalidation set for a mutation is knowledge that lives only in a code
comment next to each one.

**Fix**: A `queryKeys` factory module (`keys.holdings()`, `keys.holdingPrices(id)`, …)
plus a named invalidation group per domain event (`invalidateAfterSync(qc)`,
`invalidateAfterAccountEdit(qc)`) so the set is defined once.

---

### Z-7 — Eleven modals each reimplement the same dialog scaffold

**Severity**: Medium

**The shared thing**: None. There is no `<Modal>` primitive. `Button`, `Surface`,
`CardState`, `Select`, `Toggle` exist as primitives; the dialog shell does not.

**Offending sites** — each contains a byte-identical Escape-key + `body.style.overflow`
effect and a near-identical backdrop/panel tree:
- `frontend/src/components/AssetModal.tsx:85-97`, panel at `:172-180`
- `frontend/src/components/EditAccountModal.tsx:25-37`, panel at `:64-72`
- `frontend/src/components/RecordLotsModal.tsx:111-123`, panel at `:202-208`
- `frontend/src/components/UserDetailModal.tsx:33-45`, panel at `:55-63`
- `frontend/src/components/SessionDetailModal.tsx:27-39`, panel at `:43-51`
- `frontend/src/components/DeleteAccountModal.tsx:25-37`, panel at `:49-57`
- `frontend/src/components/DeleteConnectionModal.tsx:22-33`, panel at `:39-50`
- `frontend/src/components/DeleteUserModal.tsx:20-31`, panel at `:39-46`
- `frontend/src/components/AddConnectionModal.tsx:22-30`, panel at `:48-56`
- `frontend/src/components/LinkModal.tsx:21-29`, panel at `:40-46`
- `frontend/src/components/SyncModal.tsx:19-30`, panel at `:39-47`

Divergences already present:
- `AssetModal.tsx:177-180` is the **only** dialog with no `aria-label` — the other ten all have one.
- `DeleteConnectionModal.tsx` (90 lines) and `DeleteUserModal.tsx` (100 lines) are the same component up to the confirm-input; their header/footer/close-button markup is character-for-character identical (`:52-65` vs `:48-64`, `:72-86` vs `:84-96`).
- `DeleteAccountModal.tsx` is a third copy of that confirm-by-typing-your-email flow (114 lines).

**Why it matters**: An accessibility or focus-trap fix has to land eleven times, and
one already didn't (AssetModal). None of the eleven traps focus.

**Fix**: A `<Modal title icon onClose>` primitive owning the effect, backdrop, panel,
header and close button; plus a `<ConfirmDestructiveModal>` for the three
delete-with-typed-confirmation copies.

---

### Z-8 — Timeframe range options duplicated three times on the client and once on the server

**Severity**: Medium

**The shared thing**: `backend/api/src/handlers.rs:17-33` (`range_window` +
`default_range`) is the authority for what the range keys mean. Nothing exports them.

**Offending sites**:
- `frontend/src/components/NetWorthCard.tsx:17-29` — `RANGE_OPTIONS` array **and** a redundant `RANGE_LABEL` map with identical key/value pairs.
- `frontend/src/components/AccountsChartCard.tsx:13-25` — byte-identical copy of both.
- `frontend/src/components/AssetModal.tsx:49-57` (`RANGES`) + `:65` (`RANGE_OPTIONS` derived) — same seven keys, third shape (`{key,label}` instead of `{value,label}`).
- Default range `"6mo"` is hardcoded at `NetWorthCard.tsx:31`, `AccountsChartCard.tsx:30`, and again at `handlers.rs:41`.

**Why it matters**: Adding or renaming a range means editing four files; the backend
silently falls through to `"max"` (`handlers.rs:31`) for any key the frontend sends
that it does not know, so a typo produces a wrong chart rather than an error.

**Fix**: One `lib/ranges.ts` exporting `RANGES` and `DEFAULT_RANGE`; ideally have the
backend serve them alongside `/account-types` so the two can't diverge.

---

### Z-9 — `rgba(hex, alpha)` implemented three times, twice as an exact copy

**Severity**: Medium

**The shared thing**: `frontend/src/lib/color.ts:69-72` (`withAlpha`) — the canonical
hex→rgba converter, used by `AccountCard.tsx:35`.

**Offending sites**:
- `frontend/src/components/ValueChart.tsx:69-72` — private `rgba()`: `parseInt(hex.replace("#",""),16)` then bit-shifts. Functionally identical to `withAlpha`, but breaks on 3-digit hex (which `lib/color.ts:6` handles).
- `frontend/src/components/StackedAreaChart.tsx:20-23` — byte-identical copy of the above.

**Why it matters**: Low user impact today, but `withAlpha` is the one that handles
`#abc`, and the two chart copies would silently render `rgba(NaN, NaN, NaN, α)`
(transparent) if ever fed a short hex — e.g. from a user-chosen account colour.

**Fix**: Delete both private copies; import `withAlpha` from `lib/color.ts`.

---

### Z-10 — Reference-data lists hardcoded in the frontend that the backend owns

**Severity**: Medium

**The shared thing**: `backend/migrations/0002_seed_reference.sql` seeds
`account_type`; `backend/core/src/repo/query.rs:645` serves it via `/account-types`,
and `frontend/src/api/types.ts:20` (`accountTypeLabel`) consumes it correctly — the
right pattern. Two other lists do not follow it.

**Offending sites**:
- `frontend/src/components/TransactionFilters.tsx:7-9` — `TYPES = ["deposit","withdrawal","buy","sell","dividend","fee","interest","transfer"]`, a verbatim copy of the DB check constraint at `backend/migrations/0001_initial_schema.sql:139-141`. Not served by any endpoint.
- `frontend/src/api/types.ts:7-14` — `HoldingKind = "cash"|"etf"|"equity"|"crypto"` and `KIND_LABEL_KEY`. The DB column is free-text with only a comment as documentation (`migrations/0001_initial_schema.sql:87`: `kind text not null, -- cash | equity | etf | crypto | …`) — the "…" means a provider can legitimately produce a kind the frontend has no label for, and `AssetModal.tsx:396` (`t(KIND_LABEL_KEY[holding.kind])`) will render `undefined`. Unlike `accountTypeLabel`, there is no fallback.
- `frontend/src/lib/currency.ts:6-22` — `CURRENCIES` (six codes) and `SYMBOLS`. The backend accepts any ISO code in `users.prefs.currency` (`backend/core/src/repo/prefs.rs:23`) and `app_settings.base_currency`; the picker silently limits the user to six.
- `frontend/src/pages/settings/General.tsx:13` — `DATE_FORMATS = ["DD/MM/YYYY","MM/DD/YYYY","YYYY/MM/DD","YYYY-MM-DD"]`, while `lib/date.ts:22` accepts any pattern over `YYYY|YY|MM|DD` — the `YY` token is supported but unreachable from the UI.

**Why it matters**: `KIND_LABEL_KEY` is the live risk — a new instrument kind from a
provider renders as `undefined` in the asset modal's "Type" row.

**Fix**: Give `HoldingKind` the same `t(key, {defaultValue: fallback})` treatment
`accountTypeLabel` already has, and serve transaction types from the same reference
endpoint as account types.

---

### Z-11 — `formatQuantity` ignores the user's decimal preference and hardcodes 2 digits

**Severity**: Medium

**The shared thing**: `frontend/src/lib/money.ts:97-111`. It correctly reads
`prefs.numberGroupSep` / `prefs.numberDecimalSep`, but sets `maxFrac:
options.fractionDigits ?? 2` — `prefs.numberDecimals` is never consulted, and no
caller passes `fractionDigits`.

**Offending sites** (all callers, none overriding):
- `frontend/src/components/HoldingsCard.tsx:285` — the Quantity column
- `frontend/src/components/HoldingsCard.tsx:247` — unexplained-shares warning
- `frontend/src/components/AssetModal.tsx:343` — "Quantity owned" stat
- `frontend/src/components/AssetModal.tsx:462` — purchase-history quantity cell
- `frontend/src/components/RecordLotsModal.tsx:227`, `:228` — recorded/total progress labels
- `frontend/src/components/IncompleteHistoryStrip.tsx:31` — gap quantity

**Why it matters**: A crypto holding of 0.00042 BTC renders as `0` in the holdings
table, in the asset modal, and in the record-lots progress bar. The DB stores
`NUMERIC` and the API sends the full decimal string; the precision is thrown away in
the last 3 characters of the formatter.

**Fix**: Give `formatQuantity` a significant-digits mode (or per-instrument-kind
precision) rather than a fixed 2, and surface `numberDecimals` /
`percentDecimals` in the General settings page — see Z-15.

---

### Z-12 — Text-input styling copy-pasted across 14 sites in 6 mutually inconsistent variants

**Severity**: Medium

**The shared thing**: None. `Button`, `Select`, `Toggle`, `Surface` are primitives; there
is no `Input`.

**Offending sites**:
- `frontend/src/pages/Login.tsx:55` — `w-full rounded-xl bg-surface-2 px-4 py-3 text-[15px] text-fg outline-none focus:ring-1 focus:ring-green h-10.25`
- `frontend/src/pages/Login.tsx:64` — same minus `text-[15px]`
- `frontend/src/pages/Invite.tsx:73`, `:82` — copy of the `text-[15px]` variant
- `frontend/src/pages/Invite.tsx:91`, `:100` — copy of the no-`text-[15px]` variant
- `frontend/src/pages/Reset.tsx:70`, `:79` — copy of the no-`text-[15px]` variant
- `frontend/src/pages/settings/Account.tsx:365` — class order shuffled: `w-full bg-surface-2 rounded-xl px-4 py-3 text-fg text-[15px] outline-none focus:ring-1 focus:ring-green h-10.25`
- `frontend/src/components/EditAccountModal.tsx:95` — same shuffle, `h-10.25` dropped
- `frontend/src/components/DeleteAccountModal.tsx:91` — same, `focus:ring-red` instead of green
- `frontend/src/components/DeleteUserModal.tsx:79` — a fifth variant: `px-3 py-2.5 text-sm font-mono focus:ring-2 focus:ring-red/40`
- `frontend/src/components/RecordLotsModal.tsx:272` — a sixth: `px-3 py-2 text-sm focus:ring-1 focus:ring-green`
- `frontend/src/pages/settings/Server.tsx:75` — a seventh: `px-3.5 py-2.25 text-sm`
- `frontend/src/components/TransactionFilters.tsx:33`, `:60`, `:67` — no focus ring at all
- `frontend/src/components/HoldingsCard.tsx:145` — bare/transparent search input

Note the two confirm-by-typing inputs disagree on their own danger style:
`DeleteAccountModal.tsx:91` uses `ring-1 ring-red`, `DeleteUserModal.tsx:79` uses
`ring-2 ring-red/40`.

**Why it matters**: Visible inconsistency — the three date/search filters on the
Transactions page have no focus ring while every other input does, which is also a
keyboard-accessibility gap.

**Fix**: An `<Input variant="default|danger" size="sm|md">` primitive alongside `Button`.

---

### Z-13 — Duplicate i18n keys for identical strings (34 pairs)

**Severity**: Medium

**The shared thing**: `frontend/src/i18n/en.json` + `fr.json`. Parity is perfect (308
keys each, zero missing on either side — good), but 34 distinct strings are defined
under two or more keys.

**Offending sites** (`en.json`, all confirmed identical values):
- `"Capital invested"` — `dashboard.netWorth.capitalInvested`, `dashboard.holdings.gap.capitalInvested`, `dashboard.assetModal.capitalInvested`
- `"Account"` — `transactions.columns.account`, `dashboard.holdings.columns.account`, `dashboard.assetModal.account`, `settings.account.title`
- `"Date"` — `transactions.columns.date`, `dashboard.holdings.gap.columns.date`, `dashboard.assetModal.columns.date`
- `"Type"` — `account.edit.type`, `dashboard.holdings.gap.columns.type`, `dashboard.assetModal.type`
- `"Admin"` / `"Member"` — see Z-4
- `"Mean price / share"` — `dashboard.holdings.gap.meanPricePerShare`, `dashboard.assetModal.meanPricePerShare`
- `"Unit price"` — `dashboard.holdings.gap.columns.unitPrice`, `dashboard.assetModal.unitPrice`
- `"Sync failed"` — `sync.error`, `settings.connections.status.error`
- `"Syncing…"` — `sync.syncing`, `settings.connections.status.syncing`
- `"Waiting for bank sync…"` — `sync.awaiting`, `settings.connections.status.awaiting`
- `"Type {{email}} to confirm"` — `settings.account.deleteAccountConfirmLabel`, `settings.users.removeUser.confirm`
- `"Passwords don't match"` — `auth.passwordsDontMatch`, `settings.account.passwordsDoNotMatch`
- `"Share this one-time link"` — `settings.users.invite.heading`, `settings.users.reset.heading`
- `"Save changes"` — `account.edit.save`, `settings.account.saveChanges`
- `"Update password"` — `auth.updatePasswordButton`, `settings.account.updatePassword`
- `"Reset password"` — `settings.users.resetPassword`, `settings.users.reset.title`
- `"Record buy/sell history"` — `dashboard.holdings.gap.open`, `dashboard.holdings.gap.title`
- `"All accounts"` — `account.allAccounts`, `transactions.allAccounts`
- `"Net worth"` — `dashboard.netWorth.title`, `dashboard.netWorth.netWorth`
- `"Sync"` — `sync.title`, `sync.sync`
- `"Total"` — `common.total`, `dashboard.holdings.gap.columns.total`
- `"Value"` — `common.value`, `dashboard.holdings.columns.value`
- `"Quantity"` — `dashboard.holdings.columns.quantity`, `dashboard.holdings.gap.columns.quantity`
- `"Asset"`, `"About"`, `"Crypto"`, `"Email"`, `"Name"`, `"Password"`, `"New password"`, `"Invested"`, `"Cancel"`, `"Loading…"` — each 2×

Pluralization is correctly done via i18next `_one`/`_other`
(`settings.connections.accountsCount_*`, `transactions.shown_*`, etc.) — no hand-rolled
plurals found. Hardcoded user-visible English is limited to
`General.tsx:60-61` (`"English"`/`"Français"`, correct — language names stay untranslated).

**Why it matters**: Retranslating "Capital invested" in French requires finding all
three keys; missing one makes the same label read two ways on the same screen.

**Fix**: Promote the repeats into `common.*` and point all call sites there.

---

### Z-14 — `#888888` fallback colour and "Unknown device" hardcoded in the backend DTO layer

**Severity**: Low

**The shared thing**: `shared/account-palette.json` is documented
(`frontend/src/lib/palette.ts:1-5`) as the single source of truth for account
colours, used by the backend to assign a colour on import. The null-fallback is not
in it.

**Offending sites**:
- `backend/api/src/dto.rs:96` (`DistributionAccount::from_row`)
- `backend/api/src/dto.rs:184` (`Holding::from_row`, `account_color`)
- `backend/api/src/dto.rs:325` (`Account::from_row`)
- `backend/api/src/dto.rs:381` (`AccountSeriesResponse::from_rows`)
- `backend/api/src/dto.rs:550` (`UpdatedAccount::from_row`)
- `backend/api/src/dto.rs:650` — `"Unknown device"`, a **user-visible English string** shipped from the backend into the sessions list, bypassing i18n entirely (a French user sees "Unknown device").

Also duplicated: the gain-percentage rounding `round_dp(4)` at `dto.rs:56`
(`NetWorthResponse`) and `dto.rs:168` (`Holding`), with different zero-guards.

**Why it matters**: The device string is a real i18n hole; the colour is cosmetic but
means a colourless account renders grey via a constant that exists in five places and
in none of the palette files.

**Fix**: One `const FALLBACK_COLOR` in `dto.rs` (or better, `not null default` in the
schema); send `device: null` and let the frontend render `t("settings.account.unknownDevice")`.

---

### Z-15 — Two prefs fields exist end-to-end but have no UI control

**Severity**: Low

**The shared thing**: `backend/core/src/repo/prefs.rs:18-27` defines
`number_decimals` and `percent_decimals`; `frontend/src/lib/prefs.ts:14,17` mirrors
them; `formatMoney` (`money.ts:80`) and `formatPercent` (`money.ts:159`) both honour
them.

**Offending site**:
- `frontend/src/pages/settings/General.tsx:103-140` — the "Numbers & currency" section exposes group separator, decimal separator and symbol position, but no control for `numberDecimals` or `percentDecimals`. Every user is stuck on the serde default of 2.

Related: several call sites override the pref rather than letting it apply —
`AccountCard.tsx:62`, `HoldingsCard.tsx:333`, `AssetModal.tsx:409` all pass
`fractionDigits={1}` for percentages, so `prefs.percentDecimals` governs only
`AccountsChartCard.tsx:61`, `NetWorthCard.tsx:100`, `AssetModal.tsx:234` and `:361`.
The same preference produces 1 decimal in one column and 2 in the next.

**Why it matters**: A preference the user cannot set, and where it *is* honoured it is
inconsistently overridden — the P/L percentage in the holdings table shows 1 decimal
while the P/L percentage in the asset modal for the same holding shows 2.

**Fix**: Add the two controls; drop the ad-hoc `fractionDigits={1}` overrides or make
"compact percent" an explicit named variant rather than a per-site literal.

---

### Z-16 — `toISOString().slice(0,10)` for date-input values shifts the date in eastern timezones

**Severity**: Low

**The shared thing**: None — `lib/date.ts` has no ISO-wire-format helper, only the
display formatter.

**Offending sites**:
- `frontend/src/components/RecordLotsModal.tsx:26` — `const today = () => new Date().toISOString().slice(0,10)`, the default date for a newly added lot row.
- `frontend/src/components/RecordLotsModal.tsx:103` — `new Date(p.t).toISOString().slice(0,10)`, seeding an existing lot's date input.

`toISOString()` renders UTC. For a user in UTC+2 adding a lot at 01:00 local, `today()`
returns yesterday; for an existing lot stored at local midnight, line 103 renders the
previous day, and `isRowChanged` (`RecordLotsModal.tsx:60-64`) compares dates as
strings — so re-saving an untouched row can silently move the lot back a day.

**Why it matters**: Off-by-one lot dates that the user never typed, in the one screen
where dates are load-bearing for the cost-basis walk.

**Fix**: Add `toISODate(d)` to `lib/date.ts` using local `getFullYear/getMonth/getDate`
(the same components `formatDate` already uses) and call it from both sites.

---

### Z-17 — Direct `postJson` in pages instead of the typed hook layer

**Severity**: Low

**The shared thing**: `frontend/src/api/hooks.ts` — 20 typed query hooks and 18 typed
mutation hooks. The client (`api/client.ts`) is properly centralized: **zero** raw
`fetch()` calls exist outside it, which is good.

**Offending sites**:
- `frontend/src/pages/Invite.tsx:38-41` — inline `postJson<RedeemResp>("/auth/invite/${token}/redeem", …)` with a locally declared `RedeemResp` type, hand-rolled loading/error state.
- `frontend/src/pages/Reset.tsx:35-38` — the same call shape against `/auth/reset/${token}/redeem`, its own copy of `RedeemResp`.
- `frontend/src/auth/useTokenGuard.ts:20` — inline `getJson<TokenInfo>` (arguably correct: it must bypass the global 401 handler).

`pages/Invite.tsx` and `pages/Reset.tsx` are otherwise near-identical forms
(73-100 vs 70-79: same four/two password inputs, same class strings — see Z-12).

**Why it matters**: Minor. These two flows are outside the query cache, so a
successful redeem doesn't populate anything — they navigate to `/` and let the whole
tree refetch, which works but is inconsistent with every other mutation.

**Fix**: `useRedeemInvite()` / `useRedeemReset()` hooks in `api/hooks.ts`.

---

### Z-18 — The user-scoping join chain is retyped in 14 queries

**Severity**: Low

**The shared thing**: None. `holding → account → connection → connection.user_id = $1`
is the security boundary and is spelled out in full each time.

**Offending sites**:
- `backend/core/src/repo/query.rs:133`, `:336`, `:420`, `:461`, `:517`, `:625`, `:751`, `:824`
- `backend/core/src/repo/series.rs:71`
- `backend/core/src/repo/connection.rs:41`, `:87`
- `backend/core/src/repo/account.rs:84`
- `backend/core/src/repo/transaction.rs:94`, `:129`
- `backend/core/src/backfill.rs:80-96` — a fourth spelling, via an `owner` CTE

Every one is currently **correct** — I checked all fourteen. Error→HTTP mapping is
properly centralized (`handlers.rs:49` `internal()`, `handlers.rs:57` `require_admin()`),
and DTO mapping is uniformly `from_row`/`from_rows` per type. This is noted only
because it is the highest-consequence expression in the codebase to get wrong once
(the `backfill.rs:78-79` comment records that a cross-user scoping bug was already
found and fixed here).

**Why it matters**: No live bug. A new query that forgets the chain leaks another
user's data, and nothing structurally prevents it.

**Fix**: A `user_holdings(user_id)` SQL view or a Rust helper that emits the join
fragment, so the predicate exists once.

---

### Z-19 — Mutation error rendering repeated inline instead of a shared component

**Severity**: Low

**The shared thing**: `frontend/src/components/CardState.tsx` centralizes *query*
loading/error and is used correctly at all 10 sites (`AccountsList.tsx:22`,
`HoldingsCard.tsx:152`, `NetWorthCard.tsx:123`, `DistributionCard.tsx:69`,
`AccountsChartCard.tsx:84`, `RecordLotsModal.tsx:243`, `AssetModal.tsx:439`,
`Transactions.tsx:53`, `Users.tsx:74`, `Server.tsx:91`). *Mutation* errors have no
equivalent.

**Offending sites** (each an inline `{x.isError && <p className="…text-red">{t(…)}</p>}`):
- `frontend/src/components/DeleteAccountModal.tsx:95`
- `frontend/src/components/DeleteConnectionModal.tsx:68`
- `frontend/src/components/DeleteUserModal.tsx:82`
- `frontend/src/components/EditAccountModal.tsx:137`
- `frontend/src/components/AddConnectionModal.tsx:84`
- `frontend/src/pages/settings/Account.tsx:149`, `:199`
- `frontend/src/pages/settings/Users.tsx:231`, `:244`

Also duplicated in the same modals: the pending-button pattern
`{x.isPending ? t("common.loading") : t("…")}` at `DeleteConnectionModal.tsx:82-84`,
`DeleteUserModal.tsx:94`, `DeleteAccountModal.tsx:106`, `EditAccountModal.tsx:150`.

**Why it matters**: Cosmetic drift only — `EditAccountModal` uses its own
`account.edit.saving` string where the other three use `common.loading`.

**Fix**: Fold both into the `<Modal>` footer primitive proposed in Z-7.

---

### Z-20 — Route paths as scattered string literals

**Severity**: Low

**The shared thing**: `frontend/src/router.tsx` defines every path
(`:32, 59, 65, 71, 77, 83, 91, 97, 103, 109, 115, 121, 127, 133`). TanStack Router's
typed `to` prop does give compile-time checking, which limits the damage.

**Offending sites** (path strings retyped outside the router):
- `frontend/src/App.tsx:26` — `"/login"`
- `frontend/src/components/LogoutButton.tsx:16` — `"/login"`
- `frontend/src/pages/settings/Account.tsx:103` — `"/login"`
- `frontend/src/auth/useTokenGuard.ts:25`, `pages/Invite.tsx:44`, `pages/Reset.tsx:41` — `"/"`
- `frontend/src/pages/ConnectionCallback.tsx:42`, `:56` — `"/settings/connections"`
- `frontend/src/components/AddConnectionModal.tsx:40` — `window.location.href = "/settings/connections"` (a full page reload where the other two navigate)
- `frontend/src/components/settingsNav.ts:18-22` — the five settings paths listed a second time, independent of the router's child routes
- `frontend/src/components/Sidebar.tsx:19-23` — the three top-level paths listed a second time

**Why it matters**: `AddConnectionModal.tsx:40` doing a hard reload where
`ConnectionCallback.tsx:42` does a client navigation is a visible behavioural
difference for the same destination.

**Fix**: Low priority. At minimum make `AddConnectionModal` use `navigate()`, and
derive `settingsNav`/`Sidebar` items from the route tree.

---

# 4. Code quality


Lens: *would a senior engineer be annoyed reading this, and why.*
Scope excludes bugs, security, duplication-for-its-own-sake, comments, and architecture — those are other agents'.

Baseline facts established while auditing (so later readers don't re-derive them):

- `cargo clippy --workspace --all-targets` on a **clean** target dir emits **zero warnings**. Lint hygiene on the Rust side is genuinely good.
- `bun run lint` config is stock `tseslint.configs.recommended` + react-hooks + react-refresh; TS is `strict` with `noUnusedLocals`/`noUnusedParameters`/`noFallthroughCasesInSwitch`. No weakened rules found.
- Only **4** suppression comments exist in the whole repo (2 Rust, 2 eslint). Each is judged below.
- No dead `pub fn` in any Rust crate; no dead React component or hook. The dead-code surface is small and is inventoried at the end.

The findings below are therefore mostly about *shape* — error types, function size, stringly-typed seams — not about rot.

---

### Q-1 — Cross-crate errors are strings, and the API maps them to HTTP by substring match

**Severity**: High

**Location**:
- `backend/api/src/handlers.rs:913-935` (`complete_connection`), specifically `:927` — `if msg.contains("not found")`
- `backend/api/src/handlers.rs:909` — `Err(e) => Err((StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))`
- `backend/api/src/handlers.rs` — `(StatusCode, String)` is the error type on **43** handler signatures
- `backend/jobs/src/lib.rs:118-131` — `encrypt_credentials` / `decrypt_credentials` return `Result<_, String>`

**What's wrong**: `gripsou_jobs::complete_connection` returns `ProviderError`, whose only carrier for "the connection row wasn't found" is `ProviderError::Other("connection not found")`. The handler recovers that fact by string-searching the formatted message. Two unrelated `Other` variants already contain the substring (`"no adapter for provider '…'"` does not, but `"connection not found"` at `jobs/src/lib.rs:441` and `:456` both do), and any future message containing those words silently becomes a 404. Meanwhile `init_connection` at `:909` breaks the file's own `internal()` convention (documented at `handlers.rs:44-54` as "the real error goes to the log; the client gets a fixed message") and returns the raw provider message in a 500 body.

**Why it matters**: The HTTP contract is decided by prose. Rewording a log-facing message in `jobs` changes an API status code with no compile error and no failing test. The `(StatusCode, String)` tuple also means there is no single place to add a JSON error body, an error code, or a request id later — 43 signatures have to change.

**Fix**: Give `jobs` a small typed error enum (`NotFound` / `BadRequest(..)` / `Provider(ProviderError)` / `Db(..)`) and match on the variant; introduce an `ApiError` type in `api` with an `IntoResponse` impl and `From` conversions, replacing the tuple.

---

### Q-2 — `ProviderError::Other(String)` is the catch-all for every provider failure class

**Severity**: High

**Location**: `backend/core/src/provider.rs:26-33` (definition); **51** construction sites — `backend/providers/src/powens/mod.rs` (31), `backend/jobs/src/lib.rs` (9), `backend/providers/src/yahoo/mod.rs` (6), `backend/providers/src/boursorama/mod.rs` (5)

**What's wrong**: The enum has exactly three variants, two of which (`NotImplemented`, `Conflict`) are narrow special cases carved out because a caller needed to branch on them. Everything else — transport failure, non-2xx status, JSON decode failure, missing config, missing credential field, DB error smuggled through `jobs`, missing `external_connection_id` — collapses into one `String`. In `powens/mod.rs` alone, `Other` is used for HTTP transport errors (`:203`, `:227`), status errors (`:210`, `:234`), decode errors (`:245`, `:283`) and validation (`:216`, `:319`).

**Why it matters**: `sync_connection` (`jobs/src/lib.rs:135-252`) treats every one of them identically — `fail_sync`, connection goes to `error`, user sees a red dot. There is no way to add "retry on transport error but not on a 401" or "surface config errors to the admin, not the user" without re-parsing strings. `ProviderError::Conflict` demonstrates the pattern: it only exists because someone needed exactly one branch and had to add a variant to get it, and the next such need will do the same.

**Fix**: Split into `Transport`, `Status(u16)`, `Decode`, `Config`, `Auth`, `Conflict`, `NotImplemented`, keeping `#[from]` conversions so the call sites shrink rather than grow.

---

### Q-3 — `backfill_connection` is one 404-line function wrapping one ~350-line SQL statement

**Severity**: High

**Location**: `backend/core/src/backfill.rs:26-430`

**What's wrong**: A single `sqlx::query!` with roughly a dozen chained CTEs (`scope`, `owner`, `horizon`, `moves`, `mean_buy`, `lots`, `days`, `axis`, `moves_after`, …), interleaved with ~150 lines of prose explaining PEA transfer exclusions, `booked_on` trust heuristics, `materialized` performance decisions and JIT behaviour. There is no seam: no piece of it can be exercised, explained, or changed independently.

**Why it matters**: This is the single most valuable and least approachable function in the codebase — it derives the entire net-worth history. The 23 tests in `core/tests/backfill.rs` plus the golden files in `core/tests/golden.rs` are the *only* thing standing between a small edit and a silently wrong history, and they can only test the whole thing end-to-end. The `trust_booked_on` heuristic (`:46-59`) and the μ mean-buy aggregate (`:145-159`) are independently interesting predicates that nobody can query, log, or unit-test on their own. The file even carries its own deferred-work marker (`// ponytail:` at `:141`) about the recursive-CTE upgrade this shape makes expensive.

**Fix**: Promote the stable sub-derivations (`trust_booked_on` per account, `mean_buy` per holding, the horizon date) to SQL views or small named functions in a migration, so the Rust function composes named pieces and each piece is separately assertable.

---

### Q-4 — Silent `let _ =` on the writes that clear a connection's sync state

**Status**: ✅ Fixed. The lock-release write logs a `tracing::warn!` naming the connection when it
fails (the stale-lock sweep from D-4 is what then frees the row), and the post-connect
`request_sync` call now matches on its `BeginSync` outcome — `NotFound` warns, `AlreadySyncing`
logs at info, so "the connection we just created is unreadable" is no longer indistinguishable from
success. The other two sites are unchanged, as the finding itself recommends: `fail_sync`'s own
`mark_synced_error` is already the failure path, and `auth.rs`'s session touch is documented as
must-not-fail-the-request.

**Severity**: High

**Location**:
- `backend/jobs/src/lib.rs:247` — `let _ = connection::mark_synced_ok(&db, connection_id).await;`
- `backend/jobs/src/lib.rs:460` — `let _ = request_sync(db.clone(), user_id, connection_id).await;`
- `backend/jobs/src/lib.rs:18` — `let _ = connection::mark_synced_error(db, id, &msg).await;`
- `backend/api/src/auth.rs:127` — `let _ = gripsou_core::repo::session::touch(...)`

**What's wrong**: `:247` is the write that flips a connection out of `syncing`. If it fails, the sync *succeeded*, the data is committed, and the connection is stuck showing a spinner forever — with the frontend polling it every 2s (`frontend/src/api/hooks.ts:263-266`) and no log line anywhere. `:460` discards the `BeginSync` outcome of the initial post-connect sync, so `NotFound` (the connection the caller just created can't be read back) is indistinguishable from success.

Verdicts on the other two: `:18` is deliberate and documented (it's the failure path already, there is nowhere left to report to) — acceptable. `auth.rs:127` is explicitly justified in the comment above it ("failures here must not fail the request") — acceptable, though a `tracing::debug!` would cost nothing.

**Why it matters**: A stuck-spinning connection is a support case with zero diagnostic trail, and the code is written so that no log line can ever exist for it.

**Fix**: `:247` and `:460` should at minimum go through the same `tracing::warn!` treatment `fail_sync` gives its own failure; `:247` deserves a real retry or an error-status fallback.

---

### Q-5 — `handlers.rs` is 43 handlers plus a 1,748-line inline test module in one file

**Severity**: Medium

**Location**: `backend/api/src/handlers.rs` — production code `:1-1078`, `#[cfg(test)] mod auth_tests` `:1080-2828`

**What's wrong**: The 2,828-line figure is misleading in one direction and revealing in another. The *handlers* are 1,078 lines and individually thin and consistent (extract → one repo call → `map_err(internal)` → map to DTO); only `save_lots` is oversized (Q-6). But 62% of the file is an inline test module named `auth_tests` that has long since stopped being about auth — it tests providers (`:1768-1913`), connections (`:1915-2028`), invites and users (`:2043-2192`), prefs (`:2273`) and lots (`:2407-2828`).

Separately, the file mixes five unrelated resources — dashboard reads, holdings/lots, account management, auth/sessions, admin/server settings — with no internal grouping and no module boundary.

**Why it matters**: Every change to any endpoint touches the same file, guaranteeing merge conflicts and making `git log` on it useless. The test module's name actively lies about its contents, so nobody knows where a new test belongs, and it will keep growing by accretion. Splitting later is a large mechanical diff that nobody will schedule.

**Fix**: Split by resource into `handlers/{dashboard,holdings,accounts,auth,admin}.rs`, and move the tests to `api/tests/` (or at minimum to per-module `#[cfg(test)]` blocks) so each lands next to what it covers.

---

### Q-6 — `save_lots` is a 155-line handler that parses, validates, authorizes, writes and rebuilds history

**Severity**: Medium

**Location**: `backend/api/src/handlers.rs:163-318`

**What's wrong**: One function contains: a locally-declared `struct Parsed` (`:167-173`), decimal parsing, a domain-rule validation block with `MAX_SCALE`/`max_magnitude` constants and a checked-multiply overflow guard (`:194-224`), sign derivation for `amount` (`:226`), delete-list dedup, an ownership query written inline as raw SQL (`:242-256`) rather than in `repo/`, the delete loop, the insert loop, and the backfill invocation — all inside the transaction.

**Why it matters**: It is the only handler that writes user-authored financial data, and it is also the only handler that bypasses the `repo/` layer with its own `sqlx::query_scalar!`. The seams are obvious and unused: `Parsed`/validation is a pure function over `SaveLotsReq` (testable with no DB), the ownership lookup belongs in `repo::holding`, and the apply loop belongs in `repo::transaction`. As written, testing the numeric guard rails requires a Postgres instance — which is presumably why they have no test at all (Q-16).

**Fix**: Extract `fn parse_lot_batch(&SaveLotsReq) -> Result<Vec<Parsed>, String>` as a pure function, move the ownership query to `repo::holding::connection_for_owned_holding`, leave the handler as orchestration.

---

### Q-7 — Provider adapters are reconstructed from env on every call, at six sites

**Severity**: Medium

**Location**: `backend/jobs/src/lib.rs:96-101` (`account_providers`), called at `:179`, `:271`, `:309`, `:359`, `:394`, `:432`. Same shape: `price_providers` `:106-113`, `composition_provider` `:115-117`.

**What's wrong**: Each call reads four `POWENS_*` env vars, allocates a `reqwest::Client` (which owns a connection pool), boxes it, and drops the whole thing at the end of the function. Every sync builds three of these. `composition_provider()` additionally returns a **concrete** type while the other two return `Box<dyn …>` — three registry functions, three different shapes.

**Why it matters**: A fresh `reqwest::Client` per call throws away connection reuse and TLS session caching on the hot path (`sync_connection` runs it, then `price_providers`, then `composition_provider`). More importantly, "which providers exist" is recomputed six times from ambient global state, so there is no single place to see or test the registry, and `PowensProvider::from_env()` returning `Option` means a typo'd env var manifests as "no adapter for provider 'powens'" at six unrelated call sites.

**Fix**: Build the registry once at startup and pass it through (`Arc<Registry>` alongside the pool), or memoize with `OnceLock`. Make all three registry functions return the same shape.

---

### Q-8 — Chart ranges are strings with a silent fallback, redefined four times on the frontend and once on the backend

**Severity**: Medium

**Location**:
- `backend/api/src/handlers.rs:18-33` (`range_window`), `:36-42` (`RangeParams` / `default_range`)
- `frontend/src/components/NetWorthCard.tsx:17-28` (`RANGE_OPTIONS` + `RANGE_LABEL`)
- `frontend/src/components/AccountsChartCard.tsx:14-25` (byte-identical pair)
- `frontend/src/components/AssetModal.tsx:49-64` (`RANGES` **and** `RANGE_OPTIONS` derived from it)
- `frontend/src/api/hooks.ts:29`, `:92`, `:114` — `range: string`

**What's wrong**: Seven range keys exist as bare strings on both sides of the wire. The backend's `match` (`:20-31`) has `_ => now - Duration::days(4000), // "max"` — an unknown range silently becomes the max range rather than a 400. `AssetModal` declares `RANGES` with `{key, label}` where key and label are always equal, then immediately maps it to `{value, label}` for the only consumer; the intermediate array exists for nothing. `NetWorthCard` and `AccountsChartCard` hold identical `RANGE_OPTIONS`/`RANGE_LABEL` pairs.

**Why it matters**: Adding an "3y" range means editing five places, and forgetting the backend gives you a max-range chart with no error. `range_window` has no test (Q-16), so the `4000`-day magic number and the `ytd` branch are unverified.

**Fix**: A `Range` enum on the backend (`#[derive(Deserialize)]` with `#[serde(rename_all)]`, so an unknown value is a deserialization 400) and one exported `RANGES` constant + `type Range` on the frontend, imported by all three cards.

---

### Q-9 — The entire API contract is hand-transcribed into TypeScript

**Severity**: Medium

**Location**: `frontend/src/api/types.ts:1-227` mirroring `backend/api/src/dto.rs:1-845`

**What's wrong**: 20+ response shapes are maintained twice by hand — `Holding` (`types.ts:46-78` ↔ `dto.rs:100-138`), `Transaction`, `Account`, `Session`, `SyncConnection`, etc. — right down to re-typed doc comments. The `client.ts` helpers cast blindly (`return res.json() as Promise<T>` at `client.ts:61`, `:73`, `:85`, `:95`, `:109`), so a drift between the two is invisible at compile time *and* at runtime; it surfaces as `undefined` in a chart.

The transcription is also already inconsistent about how much type safety it keeps: `Purchase.type` is `"buy" | "sell"` but `Transaction.type` is `string` (`types.ts:82` vs `:196`); `SyncStatus` is a union but `Holding.accountType` and `Account.typeKey` are `string`; `currency` is `string` everywhere on both sides.

**Why it matters**: Renaming a field in `dto.rs` compiles cleanly, ships, and breaks the UI silently. There is no contract test anywhere — `frontend/src/api/*.test.tsx` mock the fetch layer with locally-authored fixtures, so they would pass unchanged if the backend renamed every field.

**Fix**: Either generate `types.ts` from the Rust DTOs (`ts-rs` / `specta` derive on the `dto` structs, checked in and diffed by CI), or add one backend test that serializes each DTO and compares against a committed JSON fixture the frontend also imports.

---

### Q-10 — `repo/` splits writes per entity but funnels all reads through a 994-line `query.rs`

**Severity**: Medium

**Location**: `backend/core/src/repo/query.rs` (994 lines); notably `holdings` `:196-397` (202 lines), `net_worth_series_with_target` `:39-142` (104), `distribution` `:697-772` (76), `price_eligible_instruments_for_connection` `:926-993` (68). Contrast with `repo/account.rs` (101), `repo/holding.rs`, `repo/price.rs`, `repo/snapshot.rs`.

**What's wrong**: `repo/mod.rs:1-3` states the convention — "one focused function per entity, each taking a `&mut PgConnection`". `query.rs` follows neither half: it holds reads for holdings, accounts, transactions, distribution, net worth, users, account types, and price/composition eligibility, and takes `&PgPool` throughout. `holdings()` at `:196` additionally declares a local `struct Base` and does a second pass in Rust, so the function is SQL + mapping + assembly in one body.

**Why it matters**: Any read-side change lands in the same 994-line file regardless of which entity it concerns, and the file's growth rate is the sum of every feature's. The naming convention makes it worse: a newcomer looking for "how do I read holdings" reasonably opens `repo/holding.rs` and finds only writes.

**Fix**: Move each read next to its entity's writes (`repo::holding::list_for_user`, `repo::account::series`, …), or at least split `query.rs` into `query/{holdings,series,transactions,reference}.rs`.

---

### Q-11 — `PowensProvider::sync` is 95 lines of three copy-pasted HTTP blocks; connect params round-trip through an unencoded query string

**Severity**: Medium

**Location**:
- `backend/providers/src/powens/mod.rs:214-311` (`sync`) — the fetch/status-check/decode block repeats near-verbatim at `:219-250`, `:252-284`, `:288-303`
- `backend/jobs/src/lib.rs:445-449` — `params.iter().map(|(k, v)| format!("{k}={v}")).join("&")`
- `backend/providers/src/powens/mod.rs:145-152`, `:198-201` — the adapter re-parses that string with `split_once('=')`

**What's wrong**: `sync` has no `fetch_json<T>(path, token)` helper, so the error-logging-and-decode ceremony (including the `.chars().take(500)` body truncation) is written three times with only the endpoint name varying. Separately, the API receives connect callback params as a structured `HashMap<String, String>` (`handlers.rs:913`), `jobs` flattens it back into a query string with no percent-encoding, and the adapter re-parses it. A structured value is deliberately destroyed and reconstructed across a crate boundary.

**Why it matters**: The three-way copy means a change to error handling (say, logging status + body together) has to be made three times or it drifts — and a fourth endpoint will be a fourth copy. The string round-trip means any callback value containing `&` or `=` cannot survive the trip, and the type system offers no warning because both sides agree on `String`.

**Fix**: A private `async fn get_json<T: DeserializeOwned>(&self, path: &str, token: &str) -> Result<T, ProviderError>`; change `AccountProvider::complete_connect` to take `&HashMap<String, String>` instead of `&str`.

---

### Q-12 — Both eslint suppressions silence a real dependency problem rather than fix it

**Severity**: Medium

**Location**:
- `frontend/src/pages/ConnectionCallback.tsx:44` — `}, []); // eslint-disable-line react-hooks/exhaustive-deps`
- `frontend/src/components/RecordLotsModal.tsx:154` — `// eslint-disable-next-line react-hooks/exhaustive-deps`

**Verdicts**:

`ConnectionCallback.tsx:30-44` — the effect closes over `connectionId`, `rest`, `complete`, `deleteConnection` and `navigate`, and declares `[]`. It is guarded by a `called` ref (`:28`, `:31-32`), so the run-once intent is genuine, but the real cause of the lint error is that `parseCallbackParams()` is called *during render* (`:24`), producing a fresh `rest` object every time. Moving the parse into a `useState(() => parseCallbackParams())` initializer or a module-level call makes the deps stable and the disable unnecessary. **Not justified as written.**

`RecordLotsModal.tsx:152-156` — `parsed` memoizes `list.map(parse)` but omits `parse`, which is redeclared every render (`:143-150`). The memo is therefore pretending to a stability it does not have. Worse, it buys nothing: `parse` is also called un-memoized at `:157` (`anyInvalid`) and again at `:263` for every rendered row, so each row is parsed three times per render anyway. **Not justified**; hoist `parse` out of the component (it only needs `i18n.language`) and the disable and the memo both disappear.

**Fix**: As above. Neither needs the escape hatch.

---

### Q-13 — `.expect("reqwest client builds")` in a constructor called on every sync

**Severity**: Medium

**Location**: `backend/providers/src/boursorama/mod.rs:28`, `:33`

**What's wrong**: `BoursoramaCompositionProvider::new` panics if either `reqwest::ClientBuilder::build()` fails. It is reached via `jobs::composition_provider()` (`jobs/src/lib.rs:115-117`), which is called from `sync_connection` (`:227`) — inside a `tokio::spawn`ed task, on every single sync.

**Verdict on provable safety**: **not provably safe.** `ClientBuilder::build()` fails on TLS backend initialization failure and on invalid default headers; the rustls backend can fail to load a crypto provider. A panic here aborts the spawned sync task, leaving the connection permanently in `syncing` (compare Q-4) with a panic message in the log and nothing user-visible.

Other non-test `unwrap`/`expect` in production code, all checked:
- `backend/api/src/dto.rs:9`, `backend/api/src/handlers.rs:27`, `:29`, `backend/providers/src/yahoo/map.rs:47` — all `and_hms_opt(0,0,0).unwrap()` / `from_ymd_opt(y,1,1).unwrap()` on constant arguments. **Provably safe.**
- `backend/core/src/repo/account.rs:19` — `.expect("shared/account-palette.json must be a JSON array of strings")` on an `include_str!`ed file, inside a `OnceLock`. Input is compile-time-embedded and the shape is enforced by the message; a malformed palette is a build-time authoring error. **Effectively safe**, and correctly a panic rather than an error path.

**Fix**: `new()` should return `Result`, or use `reqwest::Client::builder().build().unwrap_or_default()`-style degradation; combined with Q-7, build it once at startup where a failure can be reported cleanly.

---

### Q-14 — Type safety left on the table in `HoldingsCard` and `RecordLotsModal`

**Severity**: Medium

**Location**:
- `frontend/src/components/HoldingsCard.tsx:86` — `useState<Sort | null>({ key: "value", dir: "desc" })`
- `frontend/src/components/HoldingsCard.tsx:87`, `:95`, `:112`, `:172` — the `"All"` sentinel
- `frontend/src/components/HoldingsCard.tsx:195` — `onClick={() => toggleSort(col.sort!)}`
- `frontend/src/components/RecordLotsModal.tsx:134`, `:179` — `row.id!`, `r.id!`

**What's wrong**:

`sort` is typed `Sort | null` but is initialized non-null and `toggleSort` (`:118-124`) always returns a `Sort` — nothing in the file can ever set it to `null`. The `null` exists only so `rows` (`:114`) can have a `sort ? … : filtered` branch that is dead. That nullability then propagates into every read (`sort?.key` at `:181`).

`"All"` is a magic string living in the same value space as backend account-type keys (`:95` builds `["All", ...new Set(holdings.map(h => h.accountType))]`). Account types are explicitly data-driven inserts into `account_type` (per `CLAUDE.md`), so a row keyed `all` would collide with the sentinel and become unselectable. A `null` state or a discriminated `{kind:"all"} | {kind:"type", key:string}` costs nothing.

`col.sort!` at `:195` is inside a `col.sort ? … : …` ternary that TS cannot narrow through the JSX boundary; destructuring `const sortKey = col.sort` before the ternary removes the assertion. `r.id!` in `RecordLotsModal` is preceded by a filter/guard in both cases, so both are provably safe — but they are exactly the assertions that stop being safe when someone edits the filter.

**Fix**: Drop the `| null` from `Sort`; make the type filter `string | null`; hoist the guarded values into locals so the `!` disappears.

---

### Q-15 — Nine dead i18n keys, and a near-duplicate status block

**Severity**: Medium

**Location**: `frontend/src/i18n/en.json` and `frontend/src/i18n/fr.json` (308 keys each, perfectly in sync — good)

Confirmed unreferenced by grepping every `.ts`/`.tsx` for both the literal key and every dynamic-template parent prefix:

| key | en.json line |
|---|---|
| `sync.syncing` | 24 |
| `sync.awaiting` | 25 |
| `sync.lastSync` | 27 |
| `sync.error` | 29 |
| `auth.resetForEmail` | 214 |
| `settings.account.passwordUpdateFailed` | 258 |
| `settings.account.sessionDetails` | 267 |
| `settings.account.avatar` | 281 |
| `settings.connections.status.ok` | 351 |

**What's wrong**: The four dead `sync.*` keys are byte-identical in value to `settings.connections.status.{syncing,awaiting,error}` (`:352-354`), which *are* used (`ConnectionRow.tsx:168`, `:176`, `:183`). So one of the two blocks was abandoned mid-refactor and the other kept. `settings.connections.status.ok` is the one member of its own block nobody reads.

**Why it matters**: A translator maintaining `fr.json` is asked to translate strings that render nowhere, and the next person adding a sync-status string has two equally plausible homes to put it in and no way to tell which is live.

**Fix**: Delete the nine keys from both files; keep the `settings.connections.status.*` block as the single home for sync status text.

---

### Q-16 — Targeted test gaps on the trickiest pure logic, plus a placeholder test

**Severity**: Medium

**Location**:
- `frontend/src/smoke.test.ts:1-8` — `expect(1 + 1).toBe(2)`
- `backend/api/src/handlers.rs:205-224` — the `MAX_SCALE` / `max_magnitude` / `checked_mul` / `gross.scale() > 28` guards
- `backend/api/src/handlers.rs:18-33` — `range_window`
- `backend/api/src/handlers.rs:72-85` — `client_ip`

**What's wrong**: The test suite is otherwise strong (23 backfill tests, 8 golden whole-output regressions with a documented `UPDATE_GOLDEN` policy, 37 query tests, 45 handler tests, wiremock-backed adapter tests). These four are the specific holes.

The `save_lots` decimal guards are the most notable: `handlers.rs:198-209` carries a 12-line comment explaining that a value outside these bounds "writes fine but can never be read back as a `Decimal` — every later read of this user's transactions would 500 forever." That reasoning is load-bearing and completely untested. `a_malformed_add_writes_nothing` (`:2711-2739`) only covers `quantity == 0`; nothing exercises 9 decimal places, `10^12`, or the multiply-overflow branch. Extracting the validator per Q-6 makes these four cheap unit tests instead of four `sqlx::test` fixtures.

`range_window` is called by three endpoints, has a magic `4000` and a silent `_` catch-all, and is never asserted. `client_ip` parses attacker-controlled `X-Forwarded-For` and is never asserted (contrast `parse_user_agent` right next to it, which *is* tested at `auth.rs:250-262`).

`smoke.test.ts` is scaffolding from project setup that proves only that vitest runs — which every other test file also proves.

**Fix**: Delete `smoke.test.ts`; add unit tests for the extracted lot validator, `range_window` (each key + unknown key) and `client_ip` (XFF list, empty XFF, X-Real-IP, peer fallback).

---

### Q-17 — Design tokens hard-coded as hex in three chart files, diverging from `index.css`

**Severity**: Medium

**Location**:
- `frontend/src/components/ValueChart.tsx:20-26` — `GRID`, `FAINT`, `DIM`, `WHITE`, `RED`, `SURFACE_2`
- `frontend/src/components/StackedAreaChart.tsx:14-17` — the same four again
- `frontend/src/components/NetWorthChart.tsx:4-5` — `GREEN`, `GRAY`
- `frontend/src/components/AssetModal.tsx:155-156` — `color: "#777471"` and `color: "#34d399"` inline in a series literal
- vs. `frontend/src/index.css:10-26` — the actual token definitions

**What's wrong**: Every one of these is a copy of a `--color-*` value from `index.css`. `AssetModal` is internally inconsistent about it: `:60-61` correctly uses `var(--color-green)` / `var(--color-fg-faint)` for the legend, then `:155-156` hard-codes the same two colors as hex for the series that legend describes.

**Why it matters**: A theme change updates `index.css` and the charts silently keep the old palette — and the legend and the line it labels would drift apart *within the same component*. ECharts genuinely can't read CSS variables directly, which is why the literals exist, but the fix is one shared module, not four copies.

**Fix**: One `lib/chartTheme.ts` exporting the resolved token values (via `getComputedStyle(document.documentElement).getPropertyValue(...)` once, or a generated constant), imported by all three charts and by `AssetModal`.

---

### Q-18 — `RecordLotsModal` is a 449-line component holding seven pieces of state and re-parsing every row three times per render

**Severity**: Medium

**Location**: `frontend/src/components/RecordLotsModal.tsx:66-395`

**What's wrong**: One component body contains: seven `useState` hooks (`:75-91`) including a hand-rolled render-phase mirror-server-state-until-dirty pattern (`:96-109`) with its own `seededFrom` bookkeeping; the Escape/scroll-lock effect (`:112-121`); per-row validation (`:143-157`); the change-detection predicates `sameAmount`/`isRowChanged` (`:59-64`); the adds/deletes/pending derivation (`:170-183`); the save orchestration (`:185-195`); a progress bar with tolerance math (`:159-167`); and ~200 lines of table JSX with six inline `onChange` closures per row.

`parse(r)` is invoked at `:153` (inside the memo), `:157` (`anyInvalid`), and `:263` (once per rendered row) — three full parses per row per render, each running `normaliseDecimal` twice and `validateRow` once.

**Why it matters**: The state machine (`rows` / `queuedDeletes` / `dirty` / `seededFrom`) is the genuinely subtle part and it is buried in the middle of layout. Changing the "an edited row saves as delete + re-add" rule (`:170-181`) means reading past 200 lines of `<td>` to find it. The heavy comment coverage is doing the work a smaller unit would do structurally.

**Fix**: Extract `useLotRows(holdingId)` returning `{rows, set, add, remove, adds, deletes, pending, anyInvalid}`, and lift `parse` to module scope. The component then renders.

---

### Q-19 — `AssetModal`: index keys on a list that has ids, a dead intermediate constant, and a per-render options array

**Severity**: Medium

**Location**:
- `frontend/src/components/AssetModal.tsx:457` — `<tr key={i} …>` over `purchases.map((p, i) => …)`
- `frontend/src/components/AssetModal.tsx:49-64` — `RANGES` declared, then mapped to `RANGE_OPTIONS`; `RANGES` has no other reader and its `key` always equals its `label`
- `frontend/src/components/AssetModal.tsx:79-82` — `UNIT_OPTIONS` rebuilt on every render inside the component body
- `frontend/src/components/AssetModal.tsx:128-166` — `useMemo` depends on the whole `holding` object

**What's wrong**: `Purchase` carries a stable `id` (`api/types.ts:80`) and the same list is rendered with `key={p.id}` nowhere — `AssetModal` uses the array index while `RecordLotsModal` (`:255`) correctly uses `r.id ?? \`new-${i}\``. Purchases are re-fetched and re-ordered whenever a lot batch is saved (`hooks.ts:78-84` invalidates `holding-transactions`), so index keys will mis-associate rows.

`UNIT_OPTIONS` is a fresh array every render passed to `SegmentedControl`, in a component that also renders an ECharts instance — a new prop identity per render is exactly the thing to avoid here. The `useMemo` at `:128` lists `holding` wholesale though it reads only `.ticker`, `.price` and (via closure) nothing else, so any change to any holding field rebuilds both chart series.

**Why it matters**: These are small individually, but this is the app's chart-heaviest screen and the index key is a correctness hazard, not just a perf one.

**Fix**: `key={p.id}`; delete `RANGES` and declare `RANGE_OPTIONS` directly; hoist `UNIT_OPTIONS` out (it only needs `t`, so `useMemo(..., [t])`); narrow the memo deps.

---

### Q-20 — A `#[doc(hidden)]` test seam with no test

**Severity**: Low

**Location**: `backend/core/src/repo/query.rs:571-580` (`account_series` wrapper) and `:574-618` (`account_series_with_target`)

**What's wrong**: `account_series_with_target` exists solely so tests can pass a small `target`; its doc comment says so explicitly ("see `net_worth_series_with_target` for why this seam exists. Not part of the public API"). Grepping the whole repo, its only caller is the wrapper directly above it — no test ever passes a custom target. The sibling `net_worth_series_with_target` *is* used, once, by `core/tests/golden.rs:523`, so that one earns its keep.

**Why it matters**: A public, `#[doc(hidden)]`, deliberately-widened API surface that exists for a consumer that was never written. It reads as if it's covered when it isn't.

**Fix**: Either add the golden sampling test for account series (the stated motivation), or inline the function and delete the seam.

---

### Q-21 — A credential-envelope version field that nothing ever reads

**Severity**: Low

**Location**: `backend/jobs/src/lib.rs:125` — `Ok(serde_json::json!({ "v": 1, "ct": ct }))`; read side at `:130` reads only `blob["ct"]`

**What's wrong**: Every stored credential blob carries `"v": 1`. `decrypt_credentials` never inspects it; no migration, test, or handler references it. The only other occurrences are two test fixtures constructing the same literal (`jobs/tests/webhook.rs:62`, `jobs/tests/request_sync.rs:24`).

**Why it matters**: Textbook speculative generality. It is *nearly* harmless — but it creates a false sense that the format is versioned and migratable, when in fact a v2 would have to be introduced with no existing dispatch point and the v1 rows would need a backfill anyway.

**Fix**: Either branch on it in `decrypt_credentials` (`match blob["v"].as_u64() { Some(1) => …, other => Err(…) }`), which makes it real for one line of code, or drop it.

---

### Q-22 — `IngestSummary` fields that only tests read

**Severity**: Low

**Location**: `backend/core/src/ingest.rs:19-32`

**What's wrong**: `IngestSummary` has seven fields. `jobs/src/lib.rs:220-226` logs four of them (`accounts`, `holdings`, `transactions_inserted`, `holdings_closed`). The other three — `transactions_updated` (`:25`), `snapshots` (`:28`), `backfill_rows` (`:31`) — are read *only* by assertions in `core/tests/ingest.rs` (`:305`, `:310`, `:366`) and nowhere in production.

**Why it matters**: This is the acceptable end of the spectrum — they are cheap, and asserting on them is legitimate test value. Worth noting only because `backfill_rows` in particular costs an `as usize` cast on a counter the caller then discards, and because the doc comment on the struct ("handy for logging and tests") is honest that two of the three motivations don't apply.

**Fix**: Log all seven in `sync_connection` — one format-string change and the fields become genuinely load-bearing.

---

### Q-23 — `CLAUDE.md` documents a `seed` command that does not exist

**Severity**: Low

**Location**: `CLAUDE.md:46` — "dotenvy only runs at `cargo run`/`seed`"

**What's wrong**: `backend/api/Cargo.toml` declares exactly one `[[bin]]` (`gripsou`, `default-run = "gripsou"`). No `seed` binary, example, or alias exists anywhere in the workspace; the only `seed` symbols are test helper functions (`seed_user`, `seed_connection`, …). The two real `examples/` (`core/examples/perf.rs`, `jobs/examples/pricefix.rs`) are undocumented in `CLAUDE.md` (`perf` is covered in `README.md:78`, `pricefix` nowhere).

**Why it matters**: The one document an agent or a new contributor is told to read first names a command that fails immediately, and omits the two that exist.

**Fix**: Drop the `/seed` reference; add a line for `cargo run -p gripsou-jobs --example pricefix`.

---

### Q-24 — `#888888` as a fallback for a column that is never null in practice

**Severity**: Low

**Location**: `backend/api/src/dto.rs:96`, `:184`, `:325`, `:381`, `:550`

**What's wrong**: `account.color` is `text` (nullable) in `migrations/0001_initial_schema.sql:75`, but the only insert path (`repo/account.rs:31-33`) always assigns a random entry from `shared/account-palette.json`, and `update_account` requires a color. So the `Option<String>` and its five `unwrap_or_else(|| "#888888".to_string())` fallbacks encode a state the application cannot produce — and if it ever did, five independent copies of a grey hex would have to agree.

**Why it matters**: Minor, but it's five chances to typo a default, and the `Option` forces every downstream reader to handle a case that doesn't exist. The frontend correspondingly types it `color: string` (`api/types.ts:37`, `:53`) — so the two layers already disagree about whether it can be absent.

**Fix**: `alter table account alter column color set not null` (backfilling any stragglers), drop the `Option` and the five fallbacks; or if nullability must stay, one `const DEFAULT_ACCOUNT_COLOR`.

---

### Dead code inventory

Everything below was confirmed unreferenced by grepping the **entire** repo — Rust `src`, `tests`, `examples`, migrations, frontend `src` including `.test.tsx`, and `i18n` JSON — not just the module it lives in.

| Symbol / artifact | Location | Checked how |
|---|---|---|
| `sync.syncing` | `frontend/src/i18n/en.json:24`, `fr.json` | `rg` for literal key + every dynamic-template parent prefix across all `.ts`/`.tsx` |
| `sync.awaiting` | `frontend/src/i18n/en.json:25`, `fr.json` | same |
| `sync.lastSync` | `frontend/src/i18n/en.json:27`, `fr.json` | same (note: `sync.neverSynced` **is** used, `lib/date.ts:33`) |
| `sync.error` | `frontend/src/i18n/en.json:29`, `fr.json` | same |
| `auth.resetForEmail` | `frontend/src/i18n/en.json:214`, `fr.json` | same |
| `settings.account.passwordUpdateFailed` | `frontend/src/i18n/en.json:258`, `fr.json` | same |
| `settings.account.sessionDetails` | `frontend/src/i18n/en.json:267`, `fr.json` | same |
| `settings.account.avatar` | `frontend/src/i18n/en.json:281`, `fr.json` | same |
| `settings.connections.status.ok` | `frontend/src/i18n/en.json:351`, `fr.json` | same; siblings `.syncing/.awaiting/.error/.pending` are used at `ConnectionRow.tsx:168,176,183` |
| `RANGES` (intermediate array) | `frontend/src/components/AssetModal.tsx:49-62` | only reader is `RANGE_OPTIONS` on the next line (`:64`) |
| `account_series_with_target` (as a test seam) | `backend/core/src/repo/query.rs:574` | `rg` across `core/tests`, `core/examples`, `jobs`, `api` — only caller is its own wrapper at `:562` |
| `"v": 1` envelope field | `backend/jobs/src/lib.rs:125` | `rg '"v"'` repo-wide — three hits, all *writes* (`:125` + two test fixtures) |
| `IngestSummary::transactions_updated` | `backend/core/src/ingest.rs:25` | read only at `core/tests/ingest.rs:310` |
| `IngestSummary::snapshots` | `backend/core/src/ingest.rs:28` | read only at `core/tests/ingest.rs:305` |
| `IngestSummary::backfill_rows` | `backend/core/src/ingest.rs:31` | read only at `core/tests/ingest.rs:366` (the other `backfill_rows` hits are an unrelated local helper `fn backfill_rows_on` in `core/tests/backfill.rs`) |
| `frontend/src/smoke.test.ts` (whole file) | `frontend/src/smoke.test.ts:1-8` | asserts `1 + 1 === 2`; tests no product code |
| `frontend/public/favicon.svg.bak` | tracked in git | `rg 'favicon.svg'` across `index.html`, `vite.config.ts`, `src/` — zero references; `.bak` extension |

**Verified NOT dead** (checked because they looked it):

- Every `pub fn` in `gripsou-core`, `gripsou-providers`, `gripsou-jobs`, `gripsou-api` — swept programmatically; **zero** unreferenced.
- `AccountProvider::{webhooks_enabled, request_refresh, verify_webhook}` default-bodied methods — all three overridden by `PowensProvider` and called from `jobs/src/lib.rs:317`, `:364`, `:275`.
- `CoreError::{MissingInstrumentId, UnknownAccountRef}` — constructed at `repo/instrument.rs:103` and `ingest.rs:55`, matched in tests.
- `auth::parse_user_agent` — used at `api/src/dto.rs:649`.
- `logo::institution_logo_url` — used at `api/src/dto.rs:331`, `:485`.
- `lib/avatar.ts:coverCrop` — used by `fileToAvatarDataUrl` in the same file (`:16`).
- `router.tsx:routeTree` — used by `router.test.tsx:9`.
- `hooks.ts` exported input types (`SaveLotsInput`, `UpdateAccountInput`, …) and `types.ts` unions (`HoldingKind`, `SyncStatus`, `NetWorthPoint`, …) — all referenced within their own file; exporting them is over-broad but harmless.
- `CoreError::Json` — never *matched*, but reachable via `#[from] serde_json::Error` and used by `?`. Not dead.

**The three provider traits each have exactly one implementation** (`AccountProvider`→Powens, `PriceProvider`→Yahoo, `CompositionProvider`→Boursorama). I am deliberately **not** filing this as over-abstraction: the traits live in `core` specifically to enforce the provider→core dependency direction at compile time, which `CLAUDE.md` and `ARCHITECTURE.md` name as the project's central invariant, and a second `AccountProvider` (Bridge) is discussed in the project memory. That is a justified single-implementation trait, and whether it stays justified is the architecture agent's call, not mine.

---

# 5. Comments


**Scope:** every `.rs`, `.ts`, `.tsx`, `.sql`, `.toml`, `.yml`, `.css` and the `Dockerfile` under `backend/`, `frontend/src/`, `backend/migrations/`, `docker/`. Excluded: `node_modules`, `target`, `.git`, `.sqlx`, `frontend/dist`, `docs/`, provider HTML/JSON fixtures.

**Method:** comment lines counted with `python3` matching `^\s*(//|/\*|\*[^/]|--|#)` per file (so JSDoc continuation lines and SQL `--` count); every match was then read in context against the code it sits above before being classified. Nothing below is classified from the regex alone.

---

### Headline

This codebase does **not** have the AI-comment-slop problem the request anticipated. The comment density is high (10.3% overall, ~19% in `core/src`, ~27% in migrations), but the overwhelming majority explains **why** — measured performance numbers with before/after milliseconds, provider quirks with observed row counts, currency-domain rules, and deliberate deviations. That is the good kind, and it is the dominant kind here.

There is **zero** commented-out code and **zero** `TODO`/`FIXME`/`HACK`/`XXX` in the entire tree.

The real problem is a different one, and it is the highest-value category: **eight code comments cite spec sections in a document that is not in the repository**, and three more cite a review artifact by a name that exists nowhere. Those pointers govern the money formula.

#### Comment lines by area

| area | comment lines | total lines | ratio |
|---|---:|---:|---:|
| backend/core/src | 944 | 4,892 | 19.3% |
| backend/core/tests | 667 | 6,977 | 9.6% |
| backend/core/examples | 74 | 525 | 14.1% |
| backend/api | 363 | 4,202 | 8.6% |
| backend/providers/src | 285 | 1,858 | 15.3% |
| backend/providers/tests | 95 | 663 | 14.3% |
| backend/jobs | 152 | 965 | 15.8% |
| backend/migrations | 201 | 743 | 27.1% |
| frontend/src (ts/tsx) | 529 | 11,513 | 4.6% |
| frontend/src (css) | 22 | 51 | 43.1% |
| docker | 8 | 84 | 9.5% |
| backend `*.toml` | 0 | 88 | 0% |
| **TOTAL** | **3,340** | **32,561** | **10.3%** |

Worst files by ratio (all verified as substantive, not slop, except where noted below):
`backfill.rs` 50%, `0015_transaction_booked_on.sql` 93%, `0020_price_ts_day_aligned.sql` 55%, `0016_fx_asof_seek.sql` 46%, `powens/model.rs` 34%, `price_sync.rs` 29%, `series.rs` 29%.

#### Summary table

| # | Category | Instances | Lines removable |
|---|---|---:|---:|
| 1 | Redundant — restates the code | 16 | ~19 |
| 2 | Narration / section-header banners | 13 | 13 |
| 3 | Oversized relative to the code | 4 blocks | ~25 (trim, not delete) |
| 4 | **Stale / wrong / dangling** | **16 sites (8 findings)** | ~6 (mostly **rewrite**) |
| 5 | Commented-out code | **0** | 0 |
| 6 | `TODO`/`FIXME`/`HACK`/`XXX` markers | **0** | 0 |
| 6b | `ponytail:` markers | 13 | 0 (all valid) |
| 7 | Missing where genuinely needed | 3 | — (additions) |
| 8 | Doc-comment convention breaks | 5 sites + 4 crates | ~8 (rewrite) |
| | **Total deletable** | | **~55 lines** |

~55 of 3,340 comment lines are worth deleting — 1.6%. The remediation value in this audit is almost entirely in category 4, not in deletion.

---

### High-impact

#### M-1 — Eight comments cite spec sections in a document that is not in the repository

**Severity: high.** **Locations:** `backend/core/src/backfill.rs:139`, `backend/core/src/repo/query.rs:260`, `:306`, `:314`, `frontend/src/lib/lots.ts:17`, `frontend/src/lib/lots.test.ts:8`, `backend/core/tests/query.rs:2047`, `backend/core/tests/backfill.rs:961`.

Across the repo, a bare `§n` means a section of `TRANSACTIONS.md`. That is true for all 9 uses of `§4`, and for `§2.1`, `§2.2`, `§3`, `§6.1`, `§6.2`, `§7`, `§8`, `§8.1`, `§8.2`, `§8.3`, `§9`, `§9.1`, `§9.2`, `§10` — I checked each against the file's section list, and every one resolves.

`§4.1`, `§4.3` and `§4.5` do not. They resolve to `docs/superpowers/specs/2026-08-23-record-lots-modal-design.md` (`### 4.1 The cost-basis formula`, `### 4.3 invested override when the history is complete`, `### 4.5 Sells in the backfill`). Verified with `git ls-files docs/superpowers` → **0 tracked files**. That directory is deliberately never committed (it is a standing rule in the project's own working notes). So for anyone who clones this repository, those eight pointers go nowhere — and following the notation's own convention lands them on `TRANSACTIONS.md` §4 "Schema delta", which says nothing about μ or about cost-basis overrides.

Why this is the top finding rather than a nit: `frontend/src/lib/lots.ts:27` states the invariant out loud — *"This must stay identical to the SQL in `backfill.rs` and `query.rs` — if one changes, all three change, or the modal and the chart disagree."* The single authority that keeps three implementations of the mean-buy-price formula in step is `§4.1`, and `§4.1` is unreachable. Someone asked to change the formula has three copies, a warning that they must agree, and a citation to nothing.

**Fix:** promote §4.1/§4.3/§4.5 into `TRANSACTIONS.md` (it is the tracked spec these belong to) and renumber the citations; or, at minimum, replace the bare `§4.1` with a self-contained statement of the formula at one of the three sites and have the other two point at *that file and function*. Do not leave a bare `§4.x` in tracked code.

#### M-2 — `series.rs` cites "Finding 4" three times; no such artifact exists

**Severity: medium.** **Locations:** `backend/core/src/repo/series.rs:105`, `:113`, `:171`.

> `// Finding 4's prepended `from`, needed when the backward walk from `to` doesn't already land exactly on `from`.`
> `// `from` is always exactly the first point (Finding 4).`
> `// prepended per Finding 4, same as any other target.`

`rg 'Finding [0-9]'` across the tree returns only these three lines. There is no numbered-findings document anywhere in the repo. The comments are load-bearing — they justify why `sample_days` caps at `target + 1` instead of `target`, which is a correctness property the tests around them assert — but the justification is delegated to a name a reader cannot look up. The doc comment at `series.rs:24-28` actually contains the full reasoning; these three then point away from it to a phantom.

**Fix:** replace "Finding 4" with a pointer to the doc comment that already explains it (`see the module doc on `sample_days``), or inline the one-clause reason.

#### M-3 — `perf.rs` cites a line range in `backfill.rs` that moved

**Severity: medium.** **Location:** `backend/core/examples/perf.rs:420-421`.

> `// becomes a zero-quantity position — see the snapshot loop below, which stamps its later snapshots at quantity 0. That exercises the `uv` lateral in backfill.rs (~209-215), which filters `hs.quantity <> 0` ...`

`backfill.rs:209-215` is the `axis` CTE's union with `holding_snapshot` — nothing to do with `uv`. The `uv` lateral and its two `hs.quantity <> 0` filters are at `backfill.rs:317-339` (verified: the only `quantity <> 0` occurrences are lines 325 and 334; `) uv on true` is line 339). The reference is ~110 lines off.

This matters more than a typo because `perf.rs` is the performance harness: someone tuning `backfill.rs` reads this to learn *which branch the synthetic portfolio was built to exercise*, follows the line number into the wrong CTE, and concludes the harness covers something it does not.

Note the sibling reference at `perf.rs:143` (`backfill.rs ~120-123`, the JIT/`materialized` comment) is **correct** — so the file is not systematically rotten, just this one.

**Fix:** cite the CTE by name (`the `uv` lateral inside `gaps``), never by line number. Same for `:143`.

#### M-4 — `request_sync.rs` module doc points at `task-5-report.md`, which is inside `.git/`

**Severity: low-medium.** **Location:** `backend/jobs/tests/request_sync.rs:15`.

> `//! guaranteed. If this test ever flips to 'error', that is the documented race — see task-5-report.md.`

`find` locates exactly one match: `./.git/sdd/task-5-report.md`. It is not a repository file; it is agent scratch inside the git directory. A maintainer hitting the flaky test — which this comment explicitly predicts will happen — is sent to a file they will never find, and the module doc's own lines 3-14 already contain the full explanation.

**Fix:** delete the clause `— see task-5-report.md`. Lines 3-14 stand alone.

#### M-5 — `i18n/index.ts` describes a future that already arrived

**Severity: low.** **Location:** `frontend/src/i18n/index.ts:6`.

> `// en/fr strings; per-user locale comes from prefs once settings land.`

Settings landed. `frontend/src/auth/AuthProvider.tsx:18` calls `i18n.changeLanguage(u.prefs.uiLanguage)` on load, `:97` on a prefs save, `:107-108` on rollback; `pages/settings/General.tsx:55` renders the language control. The wiring described as pending is complete and has been for some time. A reader takes "once settings land" as "this is still hardcoded to `en`" — and `lng: "en"` two lines below reinforces the misreading, when in fact that is only the pre-auth default.

**Fix:** `// en/fr strings. lng is the pre-auth default; AuthProvider switches it to the user's uiLanguage pref.`

---

### 1. Redundant — restates the code

| file:LINE | comment (truncated) | verdict |
|---|---|---|
| `frontend/src/components/EditAccountModal.tsx:25` | `// Close on Escape; lock background scroll while open.` | delete |
| `frontend/src/components/DeleteAccountModal.tsx:25` | `// Close on Escape; lock background scroll while open.` | delete |
| `frontend/src/components/UserDetailModal.tsx:33` | `// Close on Escape; lock background scroll while open.` | delete |
| `frontend/src/components/SessionDetailModal.tsx:27` | `// Close on Escape; lock background scroll while open.` | delete |
| `frontend/src/components/RecordLotsModal.tsx:111` | `// Close on Escape; lock background scroll while open.` | delete |
| `frontend/src/components/AssetModal.tsx:85` | `// Close on Escape; lock background scroll while open.` | delete |
| `frontend/src/components/SyncModal.tsx:19` | `// Close on Escape; lock background scroll while open.` | delete |
| `frontend/src/components/Select.tsx:20` | `// Close when clicking outside the control.` | delete |
| `frontend/src/components/DistributionCard.tsx:28` | `// Largest proportion first, in both the donut and the legend.` | delete — the line below is a `.sort()` by proportion |
| `frontend/src/components/DistributionCard.tsx:31` | `// When something is hovered, every *other* slice/marker is greyed out.` | delete |
| `backend/core/tests/common/mod.rs:154` | `/// Insert one price point for an instrument.` | delete — fn is `insert_price_on(pool, instrument_id, ts, unit_price)` |
| `backend/core/tests/common/mod.rs:167` | `/// Stamp a snapshot for a holding on a specific day.` | delete — fn is `stamp_on(pool, holding_id, day, …)` |
| `backend/core/tests/common/mod.rs:33` | `/// Insert another connection belonging to an existing user.` | delete — fn is `seed_connection_for(pool, user_id)` |
| `backend/core/tests/fx.rs:9` | `/// Insert a cash instrument for a currency and return its id.` | delete — fn is `cash_instrument(pool, currency) -> Uuid` |
| `backend/core/tests/query.rs:1664` | `/// A fully explained position reports zero, not a negative shortfall.` | delete — test is `a_fully_explained_holding_reports_zero` |
| `backend/providers/src/yahoo/mod.rs:60-61` | `// NOTE: field names … are the crate's; if they differ in 4.1.x the compiler will say so — adjust here.` | delete — "the compiler will say so" is the definition of not needing a comment; the crate is pinned at 4.1.1 |

The seven identical `Close on Escape` lines sit above seven byte-identical `useEffect` blocks. Deleting the comments is the small half of that finding; the blocks themselves want to be one `useModalChrome(onClose)` hook, which would make the comment moot rather than merely redundant.

**Notably absent:** I found no `// Increment the counter`-class comments, no doc comment that is the function name with spaces in it in *shipping* code (the four above are all in test helpers), and no JSDoc that merely re-types a TypeScript signature. The JSDoc in `api/types.ts`, `lib/money.ts` and `components/*.tsx` consistently carries currency-domain or units information the type cannot express (`/** Ratio as sent by the API (0.025 → "2,5 %") */`, `/** [epoch-ms, value] points. */`, `/** Decimal string, denominated in the ACCOUNT's own currency … do not relabel it. */`). Those are the good kind and are listed under *Comments worth keeping*.

### 2. Narration / section-header banners

| file:LINE | comment | verdict |
|---|---|---|
| `docker/Dockerfile:3` | `# --- Stage 1: build the SPA ---` | delete — `FROM oven/bun:1 AS frontend` says it |
| `docker/Dockerfile:12` | `# --- Stage 2: build the Rust binary ---` | delete — `FROM rust:1-bookworm AS backend` |
| `docker/Dockerfile:24` | `# --- Stage 3: runtime ---` | delete — `FROM debian:bookworm-slim AS runtime` |
| `backend/api/src/handlers.rs:2190` | `// ── invite/reset redemption endpoint tests ────────` | delete — the `#[sqlx::test]` fn names below carry it |
| `backend/jobs/tests/webhook.rs:90` | `// ── valid signature + known connection ────────` | delete — duplicates the `///` doc on the very next test fn |
| `backend/jobs/tests/webhook.rs:147` | `// ── bad signature → Unauthorized ────────` | delete — same |
| `backend/jobs/tests/webhook.rs:201` | `// ── valid signature, unknown connection → Accepted ──` | delete — same |
| `backend/jobs/tests/request_sync.rs:76` | `// ── direct path ────────` | delete — same |
| `backend/jobs/tests/request_sync.rs:112` | `// ── webhook path ────────` | delete — same |
| `backend/jobs/tests/request_sync.rs:165` | `// ── webhook-enabled adapter but no external_connection_id ──` | delete — same |
| `frontend/src/index.css:7,14,19,24` | `/* Surfaces */` `/* Text */` `/* Accents */` `/* Semi transparents */` | keep (low priority) — grouping labels in a design-token block are conventional; "Semi transparents" reads oddly, consider `/* Translucent */` |

The six banners in `jobs/tests/` are the clearest waste: each is immediately followed by a `///` doc comment on the test function saying the same thing in better English.

| file:LINE | comment | verdict |
|---|---|---|
| `backend/migrations/0001_initial_schema.sql:7,43,56,83,132` | `-- ── Identity & access ──`, etc. | **keep** — five section markers in a 160-line schema file with no other structure; these earn their place |
| `backend/jobs/src/lib.rs:322` | `// Direct path (today's behavior).` | rewrite — drop "(today's behavior)"; undated hedging that will never be revisited |

### 3. Oversized relative to the code

These are the only blocks where I would trim, and in every case the content is real — the objection is length, not substance. **None should be deleted.**

| file:LINE | span | what it explains | verdict |
|---|---|---:|---|
| `backend/core/src/backfill.rs:224-234` | 11 comment lines / 1 SQL clause | why `groups between` rather than `rows between` in one window frame | trim to ~4 — the measured-cost paragraph ("~155-168ms either way against the 152ms reference") is the disposable half; the invariant argument is the point |
| `backend/core/src/backfill.rs:306-316` | 11 lines / 2 `coalesce`s | why the two column-wise `coalesce`s cannot mix `nxt` and `prv` | trim to ~4 — "`holding_snapshot.quantity` and `.value` are both `not null`, so a matching row supplies both" is the whole argument |
| `backend/core/examples/perf.rs:107-116` | 10 lines / 1 `tokio::spawn` | why `run()` is spawned instead of awaited (panic-safe cleanup) | trim to ~4 |
| `backend/core/src/price_sync.rs:16-32` | 17 doc lines / 1 `const` | why `REFETCH_DAYS = 30` rather than resume-from-`max(ts)` | **keep in full** — this documents a real, previously-shipped data-corruption bug (permanently unfetchable price gaps) and its three-part rationale. Long, and worth every line. |

`backfill.rs` at a 50% comment ratio looks alarming from `rg` alone and is not: it is a single 380-line SQL statement in which every CTE's comment states either a measured optimisation (`764 ms became over five minutes`, `2.4 s of a 3.1 s statement`), a financial rule, or an invariant. Read it before touching the ratio.

### 4. Stale / wrong / dangling

The five headline items are M-1 … M-5 above. Three more, all lower severity:

| file:LINE | comment | verdict | how it contradicts reality |
|---|---|---|---|
| `backend/providers/src/yahoo/search.rs:2-3` | `for v1 we take the top EQUITY/ETF candidate. (Currency-aware candidate selection is a deferred refinement — see the plan's notes.)` | rewrite | "the plan's notes" names no file that exists. The deferral itself is still true (`select_symbol` really does take the first EQUITY/ETF), but "for v1" is now stale phrasing — the app ships at v1.4.1 — and the pointer is dead. Drop the parenthetical or point at the real reason: currency is handled downstream by storing the price row's own currency (`yahoo/mod.rs:90-93`), not by picking the listing. |
| `backend/migrations/0018_valuation_grid.sql:17-18` | `-- The scalar functions stay: distribution() and friends value a single day, where a grid is pure overhead.` | leave (migrations are history) — but be aware | Contradicted by current code: `core/src/repo/query.rs:707-718` explicitly moved `distribution()` **onto** `valuation_grid` ("Valued through `valuation_grid` rather than the scalar unit_value_asof/fx_asof … That was 33 ms of a 35 ms statement"). A migration is an immutable historical record so I do not recommend editing it, but anyone consulting 0018 for current design will be misled. `query.rs` is the authority. |
| `TODO.md:63` | `- [ ] Budget page (@TRANSACTION.md phase 2)` | rewrite | The file is `TRANSACTIONS.md` (plural). Included because the audit brief asked for a cross-check against `TODO.md`; the referenced §13 "Phase 2 sketch — budgeting" does exist. |

**Verified NOT stale** (checked, claims hold — do not "fix" these):

- `frontend/src/pages/settings/Users.tsx:43` `// Local optimistic role overrides; not persisted (no PATCH endpoint yet).` — confirmed, `handlers.rs` has no role-update endpoint.
- `backend/providers/src/powens/map.rs:246` `// institution is filled by sync() after fetching connections; placeholder here.` — confirmed at `powens/mod.rs:315`.
- `backend/core/src/repo/snapshot.rs:40` `// Invariant (TRANSACTIONS.md §4) …` — confirmed, `TRANSACTIONS.md:143-145`.
- Every `§3 rule 3` reference in `backfill.rs` — confirmed, `TRANSACTIONS.md:89-95` numbers exactly three rules and calls out rule 3 by name.
- `backend/core/examples/perf.rs:143` `backfill.rs ~120-123` — confirmed correct.
- All `-- ARCHITECTURE §3.2` refs in migrations 0001/0002 — correct and explicitly named.

### 5. Commented-out code

**None.** The only block that pattern-matches is `backend/core/src/logo.rs:4-8`:

```
// To add a bank, find its connector uuid + name with:
//   select distinct institution_key, institution_name
//     from connection where institution_key is not null;
```

That is a maintenance recipe for a hand-maintained lookup table, not dead code. **Keep.**

### 6. `TODO` / `FIXME` / `HACK` / `XXX` markers

**None.** (The single `rg` hit for "Hack" is the string literal `"Hacked"` used as a test account name at `backend/core/tests/repo_account.rs:148`.)

The full marker register is under *TODO/FIXME register* below — it is entirely `ponytail:` entries.

### 7. Missing where genuinely needed

Three. Deliberately short.

1. **`backend/providers/src/lib.rs:1`** — no crate-level `//!`. This crate is the anti-corruption layer; `CLAUDE.md` states the rule that makes the whole schema design work ("Depends on `core` only, never the reverse — that direction is what keeps the schema gripsou-shaped. Never import a provider's native types into `core`"), and *nothing in the code says so*. The rule is enforced by convention plus a Cargo dependency edge, both of which a contributor can violate without ever reading `CLAUDE.md`. Add: `//! Provider adapters. Depends on `core` only — never the reverse. Native provider types must not cross into `core`; they are translated to canonical DTOs here.` (`backend/core/src/lib.rs`, `backend/jobs/src/lib.rs` and `backend/api/src/main.rs` are also bare, but their purpose is self-evident from the crate name; only `providers` carries a non-obvious rule.)

2. **`backend/core/src/repo/transaction.rs:22-23`** — the `xmax = 0` trick is explained ("true only for a freshly inserted tuple, so one round trip distinguishes an insert from an update"). What is *not* said is that this reads a Postgres system column and is therefore Postgres-specific and unspecified across major versions. One clause would earn its place: it is exactly the sort of thing that survives a database upgrade silently returning the wrong count.

3. **`frontend/src/lib/lots.ts:17` / `backend/core/src/backfill.rs:139` / `backend/core/src/repo/query.rs:306`** — see M-1. The three-way-must-agree invariant is stated once, in `lots.ts:27`, and the other two sites do not mention it. Each of the other two should carry a one-line back-reference naming the other two files, so a change made from the SQL side (the likelier direction) surfaces the constraint.

### 8. Doc-comment conventions

| issue | locations | verdict |
|---|---|---|
| Rust `///` used in TypeScript, where the doc convention is `/** … */` | `frontend/src/lib/composition-i18n.ts:48-49`, `:56-57`; `frontend/src/components/CompositionSurface.tsx:12-14`; `frontend/src/components/AssetModal.tsx:418-419` | rewrite to `/** */` (8 lines) — in TS, `///` is an ordinary line comment, so these four doc blocks produce **no editor hover and no IntelliSense**. The same files use `/** */` correctly elsewhere, so this is Rust habit bleeding across the stack. (`vite-env.d.ts:1` `/// <reference types="vite/client" />` is a legitimate TS triple-slash directive — leave it.) |
| No crate-level `//!` on any of the four crate roots, while ~20 *modules* have one | `core/src/lib.rs`, `providers/src/lib.rs`, `jobs/src/lib.rs`, `api/src/main.rs` | add one, to `providers` only — see *Missing* #1 |
| Public API in `core` (the domain boundary) documented vs private helpers | — | **no finding.** I checked this specifically: `core/src/dto.rs`, `core/src/provider.rs` and `core/src/error.rs` — the actual boundary — are the best-documented files in the crate, with per-field currency-domain notes. The inverse problem does not exist here. |
| `///` vs `//` used consistently in Rust | — | **no finding.** Item docs use `///`, in-body explanation uses `//`, module headers use `//!`. Consistent throughout, including tests. |

---

### Comments worth keeping

Do not let a cleanup pass near these. Each explains something a reader would be surprised without.

**Money, FX and currency domains** — the strongest cluster in the codebase:
- `backend/core/src/repo/query.rs:66-76` — the three currency domains (price / amount / reporting) and why `instrument.currency` is none of them. This is the single most valuable comment in the repo.
- `frontend/src/components/AssetModal.tsx:21-46` — the same three domains restated for the screen that shows all three at once, including the deliberate, labelled approximation and *why splitting it needs data the provider does not give*.
- `frontend/src/components/RecordLotsModal.tsx:14-20` — ditto for the lots modal.
- `backend/core/src/repo/query.rs:181-183`, `api/src/dto.rs:119-127`, `frontend/src/api/types.ts:60-67` — per-field "denominated in X, NOT in Y, do not relabel it" notes.
- `backend/migrations/0010_currency_fx.sql:1-6` — an FX rate *is* a price row on a cash instrument. The keystone of the schema.
- `backend/migrations/0011_reporting_fx_zero_guard.sql:3-10` — why a zero rate must degrade rather than 500 the whole dashboard.
- `frontend/src/lib/money.ts:113-123` — why decimal-separator parsing is locale-led, and that guessing wrong "posts a value 1000x off in silence".

**Provider quirks** (the ones that cost real debugging):
- `backend/providers/src/powens/map.rs:160-176` — invest-account `balance` lags; the `XX-liquidity` sleeve is the real cash.
- `backend/providers/src/powens/mod.rs:68-70` — why `last_update` cannot backfill and full-fetch + `external_id` dedup is the only safe shape.
- `backend/providers/src/powens/map.rs:316-319` — `market_fee` rows observed carrying positive "INTERETS" values, so direction comes from the sign.
- `backend/providers/src/yahoo/map.rs:15-21` and `backend/migrations/0020_price_ts_day_aligned.sql:1-13` — the in-progress candle dragging `max(ts)` into the afternoon.
- `backend/core/src/price_sync.rs:16-32` — the REFETCH_DAYS rationale.
- `backend/core/src/price_sync.rs:46-62` — why every currency a connection *converts through* needs a backfilled cash instrument, per domain.
- `backend/providers/src/boursorama/mod.rs:10` — "Boursorama serves 403 to the default reqwest UA." Nine words, saves an hour.

**Measured performance decisions** (delete these and the next person re-introduces the regression):
- `backend/core/src/backfill.rs:120-123`, `:213-217`, `:245-256`, `:299-304`.
- `backend/migrations/0016_fx_asof_seek.sql:1-19` — including the before/after table.
- `backend/migrations/0018_valuation_grid.sql:1-26` and `0019_valuation_grid_days.sql:1-10`.
- `backend/core/src/repo/query.rs:706-722` — why `distribution()` moved onto the grid.
- `backend/core/src/repo/series.rs:10-31` — why the walk is backward and why the cap is `target + 1`.

**Deliberate, non-obvious behaviour:**
- `backend/core/src/backfill.rs:51-57` — the `trust_booked_on` heuristic (a row booked before it was spent cannot happen; LIVRET A does it on 123 of 167 rows).
- `backend/core/src/backfill.rs:372-392` — the negative-quantity lift, with the 2,435-day and 1,221-day evidence.
- `backend/core/src/ingest.rs:110-117` — why a dangling transaction is skipped but a dangling holding is fatal.
- `backend/api/src/handlers.rs:201-209` — the `Decimal` 29-digit ceiling and why unbounded `numeric` would 500 every future read.
- `backend/api/src/handlers.rs:45-48` — why sqlx error strings must not reach the client.
- `frontend/src/components/RecordLotsModal.tsx:44-56` — why saved-row comparison is numeric for amounts and string for dates.
- `frontend/src/components/Button.tsx:11-14` — Tailwind specificity resolving by stylesheet order, not class-attribute order.
- `frontend/src/components/Sparkline.tsx:17-20` — the colour is the window's direction, deliberately not all-time gain.
- `backend/core/src/repo/instrument.rs:59-63` — why `symbol` is stored null on the ISIN path.
- `backend/core/src/logo.rs:4-8` — the how-to-add-a-bank recipe.

### Missing where needed

See section 7. Three items: the `providers` crate-level rule, the `xmax = 0` Postgres-specificity note, and the three-way μ back-references.

### TODO/FIXME register

No `TODO`, `FIXME`, `HACK` or `XXX` exists anywhere in the swept tree. The project's deferral marker is `ponytail:`, and all 13 are well-formed: each states the shortcut, the condition that would justify revisiting, and (usually) the measurement that makes it safe today.

| file:LINE | text (truncated) | verdict |
|---|---|---|
| `backend/core/src/backfill.rs:13-16` | whole connection deleted and refilled every sync (~13k rows); §8.3 describes bounded invalidation | **valid, unowned.** Names the revisit trigger ("hundreds of holdings"). Cites §8.3, which **does** exist in `TRANSACTIONS.md`. |
| `backend/core/src/backfill.rs:17-18` | runs inline in ingest; move to its own job if sync latency becomes visible | valid, unowned. Vaguest trigger of the set ("visible" to whom?), but harmless. |
| `backend/core/src/backfill.rs:143-146` | a buy recorded AFTER a sell shifts μ for that earlier sale | **valid and the most consequential.** Names the exact three-file upgrade path. Cites `§4.1`'s neighbourhood — see **M-1**; this entry inherits the dangling-reference problem. |
| `backend/core/src/backfill.rs:359-362` | lot cost left as a correlated subquery; measured 9 ms of 764 ms | valid. Measured, with an explicit revisit trigger. Model entry. |
| `backend/core/src/backfill.rs:390-392` | shortfall treated as unknown opening balance, spread flat | valid. Explains why the exact alternative is impossible ("nothing in the ledger says which one"). Arguably not a deferral at all — closer to a permanent design note. |
| `backend/core/src/repo/query.rs:353-354` | no cap on the sparkline row count; ~30 rows on a daily feed | valid. Names the fix (`repo::series`) and the trigger (an intraday feed). |
| `backend/core/src/composition_sync.rs:73-75` | cached symbol that errors on fetch is re-tried forever | valid. Proposes the concrete fix (`meta.composition_attempted_at` backoff). **Closest thing in the repo to a latent bug** — one wasted request per sync, forever, per broken symbol. Not urgent at this scale, but it is the entry most likely to become one. |
| `backend/providers/src/powens/mod.rs:72-73` | fetches whole history; add a min_date window if payloads grow | valid, measured ("largest observed: 2,111"). |
| `backend/providers/src/powens/map.rs:62-63` | takes the first connector | valid. Precondition stated ("one connection per token") and matches the doc comment above it. |
| `backend/providers/src/boursorama/map.rs:10-11` | the `id` anchors and redirect shape are what to recheck | valid. This is a *maintenance hint*, not a deferral — arguably mis-tagged, but useful where it is. |
| `frontend/src/lib/assetSeries.ts:45-47` | simple-Dietz denominator, not time-weighted | valid. States the exact distortion ("a big deposit late in the window still flatters it slightly") and the swap ("TWR"). |
| `frontend/src/lib/composition-i18n.ts:6-7` | hand-maintained common set + raw fallback | valid. Growth condition stated. |
| `frontend/src/components/ValueChart.tsx:131-132` | callers pass the dashed invested line first for z-order | valid, and the smallest — a tooltip-ordering nicety. |

**Cross-check against `TODO.md`, `tasks/todo.md`, `TRANSACTIONS.md`:**

- **No duplication and no contradiction.** None of the 13 `ponytail:` entries restates a `TODO.md` line, and none contradicts one. `TODO.md`'s "Future" list is product-level (by-account view, budget page, README screenshot); the code markers are implementation-level. Clean separation — this is unusually well-kept.
- `TODO.md:63` `Budget page (@TRANSACTION.md phase 2)` — typo for `TRANSACTIONS.md`; the target (§13 "Phase 2 sketch — budgeting") exists.
- `tasks/todo.md` is a stale one-off checklist for tagging `v1.2.1` (the repo is now at v1.4.1). It is `.gitignore`d (`tasks/`), so it is local scratch, not repo content — no code references it. Delete it locally at will; nothing depends on it.
- `TRANSACTIONS.md` §8.3 and §13 are both cited from code and both resolve correctly.

---

### Recommended order of work

1. **M-1** — resolve the eight `§4.x` citations. Everything else on this list is cosmetic by comparison; this one guards a money formula that exists in triplicate.
2. **M-2, M-3, M-4** — three dangling pointers, ~10 minutes total, all mechanical.
3. **M-5** and the `yahoo/search.rs` "the plan's notes" clause — two stale sentences.
4. Delete the 13 banner lines (category 2) and the 16 redundant lines (category 1). Consider extracting `useModalChrome` while removing the seven identical `Close on Escape` comments.
5. Rewrite the four TS `///` doc blocks as `/** */` so they actually surface in editors.
6. Add the `providers` crate-level `//!`.
7. Optional: trim the three oversized blocks in category 3. Low value — the content is correct and the cost of over-explaining a measured optimisation is much lower than the cost of losing it.

---

# 6. Design & architecture


Read: all 20 migrations, `core/src/{dto,provider,ingest,backfill,price_sync,composition_sync,crypto}.rs`,
`core/src/repo/{query,series,snapshot,connection,instrument,transaction}.rs`, `jobs/src/lib.rs`,
`api/src/{main,handlers,dto}.rs`, the three provider adapters, the frontend router/hooks/charts/lots,
`ARCHITECTURE.md`, `REQUIREMENTS.md`, `TRANSACTIONS.md`, `TODO.md`, deployment files.

---

### What the design gets right

- **The unified holding model is correct for the asset half of the problem, and it pays off repeatedly.**
  One `holding_point` union feeds the net-worth series, the stacked area, the pie, and the holdings list
  (`core/src/repo/query.rs`); adding a currency needs no migration; a cash line and an ETF line render from
  the same row shape. Do not undo this.
- **FX-as-a-price-of-a-cash-instrument is genuinely elegant** and the three-currency-domain discipline
  (price / amount / reporting) is documented at every call site that could confuse them
  (`query.rs:57-88`, `components/AssetModal.tsx:21-46`). Most personal-finance code gets this wrong
  by conflating "the instrument's currency" with "the currency of the number on screen". This one doesn't.
- **Snapshots written by the core, not the provider** (`ingest.rs:71`) is the right call, and the
  gap-filling read (`join lateral … as_of <= d.as_of order by as_of desc limit 1`) means a week of
  downtime degrades to a flat line rather than a hole. Sync-gap handling is better than most.
- **`valuation_grid` keyed per instrument-day rather than per holding-day** (`0018`/`0019`) is the right
  shape, and taking the day array from the caller instead of regenerating it (`0019`'s header comment)
  removes a whole class of silent-zero bug. The performance work is well-reasoned and well-measured.
- **`crate` split core / providers / jobs / api** actually enforces the ACL direction, and the recorded-fixture
  adapter tests (`providers/tests/powens_map.rs`, 505 lines) mean the mapping layer is the best-tested
  part of the codebase.
- **The `holding_point` invariant** ("no day carries both a snapshot and a backfill row", enforced on write in
  `repo/snapshot.rs`) is a real invariant with a real enforcement point, not a convention. Good.

---

### D-1 — Cost basis and PnL are computed four times, in three languages, from a source that cannot supply lots

**Status**: ✅ Fixed. Lots are a first-class `lot` table (`0021`) with a per-lot fee; the basis rule
lives only in `lot_basis` (`0022`) and every consumer calls it. `backfill.rs`'s `mean_buy`/`lots`
CTEs and `frontend/src/lib/lots.ts` are deleted; `assetSeries.ts` is reduced to a multiplication
that reads no cash amount. Stored per-day basis is dropped from `holding_snapshot`/
`holding_backfill` (`0023`), and `transaction` is now cash-only with `instrument_id`/`quantity`/
`unit_price` dropped (`0024`), so point 3 (basis stored in three tables) no longer applies — it is
stored in zero tables and derived in one function. Regression tests:
`core/tests/lot_basis.rs::a_sale_removes_cost_not_proceeds`,
`core/tests/query.rs::chart_invested_matches_the_holdings_table`,
`core/tests/query_transactions.rs::lots_appear_on_the_transactions_list`,
`frontend/src/lib/assetSeries.test.ts` "a sale removes cost, not proceeds". Point 4 (mean-cost is
not the right accounting method) is answered rather than fixed: PRMP is the method French tax law
requires for a PEA, so it is deliberate. Lot matching remains unbuilt, by decision.

**Severity**: Critical
**Confidence**: Certain
**Location**: `backend/core/src/backfill.rs:139-177` (`mean_buy`, `lots`), `backend/core/src/repo/query.rs:305-335`
(the `lot` lateral), `frontend/src/lib/lots.ts:29-64` (`resultingFigures`),
`frontend/src/lib/assetSeries.ts:19-46` (`positionSeries`), `backend/migrations/0001_initial_schema.sql:103-121`
(`holding.cost_basis`, `holding_snapshot.cost_basis`), `0014` (`holding_backfill.cost_basis`).

**The decision**: `transaction` rows with `type in ('buy','sell')` double as lots. Cost basis is a lifetime
mean buy price μ, recomputed at read time; when the recorded lots exactly explain the position, μ×qty wins
over the provider's `holding.cost_basis`, otherwise the provider's number is used. A `RecordLotsModal`
lets the user enter lots by hand.

**Why it's a problem**:

1. **μ is implemented four separate times and two of them disagree.** `backfill.rs` and `query.rs` and
   `lib/lots.ts` all compute `Σ(qty×price)/Σ(qty)` over buys — the code comments themselves say "if one
   changes, all three change, or the modal and the chart disagree" (`backfill.rs:143-146`, `lots.ts:24-27`).
   That is a design admission that the invariant is unenforceable. The fourth, `assetSeries.ts:38-41`,
   does something *different*: `invested -= Number(lot.invested)` where `lot.invested` is the raw
   `transaction.amount`, so a sale reduces "invested" by its **proceeds**, folding realised P/L into the
   basis. `backfill.rs:164-169` explicitly refuses to do exactly that ("Never its proceeds: that would fold
   realised P/L into the basis"). So the AssetModal's purchases chart and the dashboard's invested line
   are computing two different quantities from the same rows. Concrete break: buy 10 @ 100 (basis 1000),
   sell 5 @ 200. Backend invested = 500. AssetModal invested = 1000 − 1000 = 0. Same holding, same screen session.
2. **The data source structurally cannot supply lots.** Your own memory notes say Powens exposes no
   `/marketorders`, no instrument link on transactions, and PSD2 cannot see a PEA at all. So the *only*
   path to a correct basis is manual entry — which means the app's headline "unrealised gain/loss" column
   is, for every unedited holding, `qty × price − qty × Powens' unitprice`, where Powens' `unitprice`
   (`providers/src/powens/model.rs:57`) is a field of unknown provenance that your notes elsewhere call
   unreliable for invest accounts. The app renders a precise 2-decimal number with a green/red arrow for a
   quantity it does not know.
3. **`cost_basis` is stored in three tables and derived in a fourth place.** `holding.cost_basis`,
   `holding_snapshot.cost_basis`, `holding_backfill.cost_basis`, and the read-time `lot.basis` override.
   `query.rs:263-267` notes the override is "read-time only — nothing is written", i.e. the stored
   columns are *known to be wrong* and are being routed around at read time. That is not an escape hatch,
   it's four copies of one number with no reconciliation.
4. **Mean-cost is not the right accounting method** for a French PEA (PRMP) or for tax anywhere;
   there is no realised/unrealised split persisted, so a sale's realised P/L exists only as a transient
   frontend computation (`lots.ts:57`).

**Alternative**: Make lots first-class. A `lot` table (`holding_id`, `acquired_on`, `quantity`,
`unit_cost`, `currency`, `source` ∈ {provider, manual, inferred}, `closed_by_lot_id`), with the basis
computed **once** — in SQL, in a function like `unit_value_asof`'s sibling — and every consumer reading
that one function. Persist realised P/L on the sale row. Keep `transaction` for cash flow only.
Then delete the μ implementations in `lots.ts` and `assetSeries.ts` and have the modal preview call the
backend. Separately: when `unexplained_quantity ≠ 0`, the holdings list should show a dash, not a number
with a badge — a wrong number with a warning icon is still a wrong number.
**Migration cost**: moderate (new table + a backfill from existing buy/sell rows; the read path changes in
three queries, the frontend loses two files). Do it before the lot data grows.

---

### D-2 — "Net worth" is gross assets: the model has no sign, and liabilities are dropped at the adapter

**Status**: ⏭️ **Skipped, deliberately** — revisit when an account with a negative value actually
exists. Verified against the live database at the time of the decision: 8 accounts (5 checking, 2
savings, 1 PEA), 13 holdings, **no negative quantity and no loan/card row anywhere**, so nothing is
being dropped today and the headline number is a true net worth for this install. The bug is real but
dormant; it fires the first time a connected bank exposes a `loan` or `card` account, which vanishes
silently. Noted for that day: the unified model makes this cheaper than the finding suggests — a debt
is a negative-quantity cash holding, and every total in `query.rs` is a plain `sum()`, so the net-worth
number, the chart and the account series need **no query change**. Only the display side breaks
(`distribution()`'s negative slice and its `order by sum(...) desc`, the Holdings table, the account
cards). Also confirmed: a negative *checking* balance already passes straight through `cash_holding`
as a negative cash holding, so overdrafts already subtract while cards and loans do not — the two
liabilities behave inconsistently, as the finding says. Powens' sign convention for loan balances
could not be verified (no such account to observe); storing liability balances as `-abs(balance)`
would sidestep it. No code changed, no test.

**Severity**: Critical
**Confidence**: Certain
**Location**: `providers/src/powens/map.rs:18-30` (`map_type_key` returns `None` for `loan`/`card`),
`map.rs:259-261` (account skipped entirely), `ARCHITECTURE.md:205-210`, `migrations/0001` (`holding`,
`holding_snapshot` — quantity × price, no sign or side column), `REQUIREMENTS.md` ("total net worth").

**The decision**: liabilities are not modelled. Powens `loan` and `card` accounts are skipped in the adapter
so their balances never reach the DB. ARCHITECTURE frames this as "they get their own account types if and
when net worth becomes assets − liabilities."

**Why it's a problem**: the framing understates the cost by a lot, and the number on the dashboard is
mislabelled today. Walk the owner's own list against `quantity × price`:

| Thing | Fits? |
|---|---|
| Checking, savings, listed equity, ETF, crypto, FX | Yes — this is what the model is for |
| Credit card with a negative balance | Only by accident: a non-invest account passes `balance` straight through (`map.rs:192`), so a negative overdraft *does* become a negative cash holding — but a `card` account is skipped before that, so the two liabilities behave inconsistently |
| Mortgage / loan | No. Needs a sign, an amortisation schedule, and an interest rate; "quantity 1 × price −180 000" is a lie that breaks the pie chart (negative slice), the stacked area (negative band), and `distribution()`'s `order by sum desc` |
| Real estate | Poorly. Powens' `real_estate` falls through to `brokerage` (documented at `ARCHITECTURE.md:202`); there is no manual revaluation path, and `price` is provider-fed only |
| Assurance-vie / PER wrapper | Half. `0013` added the account types, but the *fonds euros* inside has no price feed and no instrument identity, so it lands as a cash holding valued at book value with a permanently zero gain |
| Unvested RSU | No. Needs a vesting schedule and a "not yet mine" flag — `holding.quantity` has no probability or vesting dimension |
| Crypto staking reward | No. It arrives as a quantity increase with no transaction, so the backfill's backward walk (`backfill.rs:124-138`) attributes it to nothing and `unexplained_quantity` grows monotonically, permanently badging the holding as incomplete |

The single biggest number on the app says "net worth" and is Σ assets. For anyone with a mortgage that is
off by six figures in the wrong direction.

**Alternative**: add the sign dimension now, while the schema is small. Either (a) `account_type.side ∈
{'asset','liability'}` plus a `sign` fold in the four valuation queries, which is the cheap version and
covers loans/cards/mortgages as negative-quantity holdings of a cash instrument; or (b) accept the scope
and **rename the headline** to "Total assets" until (a) ships. What you must not do is keep calling it net
worth. Also add `instrument.kind = 'manual'` with a user-entered `price` row so real estate and
fonds-euros have a home — that costs one row type and no schema change, and it is the single highest-value
addition the unified model already supports.
**Migration cost**: (a) moderate — one reference-table column, a `case` in four queries, a negative-slice
decision in the pie. (b) cheap.

---

### D-3 — `account.connection_id` nullable "= manual accounts" is dead by construction

**Severity**: High
**Confidence**: Certain
**Location**: `migrations/0001_initial_schema.sql:73`, `ARCHITECTURE.md:130` and `§11` ("Manual
accounts/transactions — accommodated by `account.connection_id` nullable"), vs.
`core/src/repo/query.rs:116-117, 287-288, 613-614, 745-747`, `series.rs:70-72`, `backfill.rs:63-66`.

**The decision**: `account.connection_id` is nullable, documented as the future manual-account hook.

**Why it's a problem**: every user-scoped read reaches the user through
`join connection c on c.id = a.connection_id` — an **inner** join, because `connection.user_id` is the
only ownership column in the schema. An account with `connection_id is null` therefore has no owner and
appears in exactly zero queries: not net worth, not the pie, not the accounts list, not holdings, not the
backfill scope. `list_connection_accounts` even filters `a.connection_id is not null` explicitly
(`repo/connection.rs:87`), which is the shape of a workaround for a hole nobody has fallen into yet.

The escape hatch that ARCHITECTURE §11 lists as "already accommodated" would, on the day someone tries to
use it, require touching every read query in `query.rs` plus `series.rs` plus `backfill.rs`.

**Alternative**: put `user_id` on `account` (nullable `connection_id` stays, ownership moves down a level),
or introduce a real `connection` row per user of `provider_key = 'manual'` and drop the nullable column
entirely. The second is cheaper and keeps every existing query untouched: a manual account is just a
connection that never syncs. Prefer it, and delete the "nullable = manual" claim from ARCHITECTURE.
**Migration cost**: cheap (a seeded `manual` provider row + one `alter table … set not null`).

---

### D-4 — A crashed or restarted process wedges a connection in `syncing` forever

**Status**: ✅ Fixed (the lock; the column split and the staleness surface were not done). Migration
`0027_connection_sync_started_at.sql` adds `sync_started_at`, stamped by `begin_sync` and cleared by
`mark_synced_ok` / `mark_synced_error`. Three things now free a wedged lock: `begin_sync` takes over a
claim older than `SYNC_LOCK_STALE_MINS` (30) or one with no stamp; the minute reaper calls
`clear_stale_syncing`, which moves such rows to `'error'` with "sync interrupted" as `last_error` so
the user sees a failure instead of an eternal spinner; and `run_scheduler` sweeps every `syncing` row
at boot, which is safe because the scheduler is in-process and the app is single-instance. Live data
at the time of the fix: all four connections `ok`, none wedged — the bug was real but dormant.
Regression tests: `core/tests/repo_connection.rs` — `begin_sync_takes_over_a_stale_claim`,
`clear_stale_syncing_only_releases_old_claims`, `finishing_a_sync_clears_the_claim_stamp`,
`begin_await_takes_over_a_stale_claim` — the webhook path claims through `begin_await`, so it
honours the same takeover, which is what makes the fix reach this install's Powens connections.
**Still open from this finding**: `status` still conflates lock state, health and lifecycle, and the
dashboard still shows no "last successful sync" (that overlaps C-22).

**Severity**: High
**Confidence**: Certain
**Location**: `core/src/repo/connection.rs:118-130` (`begin_sync`: `where … status <> 'syncing'`),
`connection.rs:215-229` (`connections_needing_sync`: `where status in ('ok','error')`),
`jobs/src/lib.rs:28-56` (`reap_awaiting` reaps `awaiting` and `pending` — **not** `syncing`),
`api/src/main.rs:52` (scheduler spawned in-process).

**The decision**: the per-connection lock is a `status = 'syncing'` flag on the row, released by
`mark_synced_ok` / `mark_synced_error` at the end of `sync_connection`.

**Why it's a problem**: `sync_connection` is a detached `tokio::spawn` in the same process that serves HTTP.
A `docker compose up --build` during a sync, an OOM kill, a panic in the spawned task, or a lost DB
connection mid-ingest leaves `status = 'syncing'` with nothing to reset it. `begin_sync` then refuses
forever, `connections_needing_sync` never selects the row again, the reaper doesn't look at it, and the UI
shows a spinner that polls every 2s indefinitely (`api/hooks.ts` `useConnections` `refetchInterval`).
Recovery is a manual `UPDATE`. Given deploys are `restart: always` on a single box, this is not a rare path.

Two secondary issues in the same place: `connection.status` conflates *lock state* (`syncing`, `awaiting`)
with *health* (`ok`, `error`) with *lifecycle* (`pending`), so you cannot express "currently syncing, and
last night's sync failed"; and there is **no observability into "did last night's sync work"** other than
`last_error` on the Connections settings page — the dashboard happily renders yesterday's numbers with no
staleness indication at all.

**Alternative**: add `sync_started_at timestamptz` and make `begin_sync`'s predicate
`status <> 'syncing' or sync_started_at < now() - interval '30 minutes'`, plus a startup sweep that clears
`syncing` rows on boot (single-instance, so this is safe and correct). Split the column into
`lock_state` and `last_sync_status`. Surface "last successful sync" on the dashboard shell, not only in
settings — a stale number shown as fresh is the failure mode that matters for a finance app.
**Migration cost**: cheap.

---

### D-5 — `pea` is hardcoded in three SQL bodies, which contradicts the "new account types are data inserts" rule

**Severity**: High
**Confidence**: Certain
**Location**: `core/src/backfill.rs:51` (`a.type_key = 'pea' as is_pea`), `backfill.rs:134`,
`core/src/repo/query.rs:838-840` (`not (a.type_key = 'pea' and …)`), `CLAUDE.md` / `ARCHITECTURE.md:196`.

**The decision**: `account_type` is a reference table and new types are data inserts, never migrations. But
one specific key, `pea`, carries hard business logic: its `transfer`/`buy`/`sell` rows are excluded from
the cash walk and are unconditionally hidden from the Transactions page.

**Why it's a problem**: the rule as stated is now false. Adding `life_insurance` and `retirement` in `0013`
was a data insert that changed *nothing*, because those types have no behaviour. Adding a type that needs
behaviour — a second wrapper whose provider also reports buys against the cash line, which is the *common*
case for a PER or an assurance-vie multisupport — requires editing two SQL bodies in Rust source and a
`cargo sqlx prepare`. The rule is being used to justify *not* thinking about type semantics, while the
semantics have quietly leaked into the queries anyway.

Worse, the two hardcodes encode two different rules ("don't walk cash on these" and "don't list these") that
happen to coincide on PEA today. Nothing keeps them in step.

**Alternative**: make the behaviour data. Two boolean columns on `account_type` — `cash_walk_excludes_trades`
and `hide_internal_trades` — read by the queries. Then the rule becomes true again and a new wrapper really
is one insert. Rewrite the CLAUDE.md/ARCHITECTURE claim to say what it actually means: *"new types are data
inserts; type **behaviour** is data too, on `account_type` columns"*.
**Migration cost**: cheap (two columns + two predicates).

---

### D-6 — The derived past is rewritten from scratch every sync, and is not reproducible

**Severity**: High
**Confidence**: Certain
**Location**: `core/src/backfill.rs:30-40` (delete all), `:42+` (reinsert all), `ingest.rs:147-148`
(inside the ingest transaction), `backfill.rs:53-62` (`trust_booked_on` decided per run),
`backfill.rs:393-399` (the `lift` heuristic), `api/src/handlers.rs:307-311` (also on every lot save).

**The decision**: `holding_backfill` is a full rebuild per connection per sync: delete everything, re-derive
from the current transaction set, inside the same transaction as the ingest.

**Why it's a problem**: three distinct issues stacked on one decision.

1. **History is not a record of anything.** The values for 2023 change every night, because they are
   recomputed from today's transaction set with today's heuristics. Two of those heuristics are themselves
   run-dependent: `trust_booked_on` is decided per-account per-run from whether *any* row is booked before
   it was spent, so one new provider row can flip an account's entire derived history by up to five days
   overnight; and `lift` (`greatest(0, -min(quantity) over (partition by holding_id, anchor_day))`) shifts
   a whole anchored stretch by whatever the worst day in it happened to be. Nothing records that the line
   moved, or why. For a finance app the distinction between *"what I owned then"* and *"what I currently
   believe I owned then"* is exactly the distinction the user needs, and the model erases it.
2. **The `lift` heuristic is silently editing the user's history.** Its own comment says it treats a
   reconciliation shortfall as an unknown opening balance and spreads it flat, "because nothing in the
   ledger says which one" went missing. That is a defensible display choice — but it is applied
   invisibly, with no flag reaching the UI, unlike `fx_missing` which *does* get surfaced. A user looking
   at their 2023 cash line has no way to know that a stretch of it was raised by €10 to keep it positive.
3. **Sync latency scales with total history**, because the rebuild runs inside the ingest transaction —
   holding a write transaction open across ~13k row deletes and reinserts. The `ponytail:` comment at
   `backfill.rs:14-18` acknowledges both. It's right that this is cheap at family scale; it is not right
   that it should stay inside the ingest transaction (an ingest that succeeds and a backfill that fails
   should not lose the ingest).

**Alternative**: keep the full rebuild (it *is* the simple correct thing at this size) but (a) move it out
of the ingest transaction into a second, retryable step; (b) surface a `derived` / `lifted` flag on
`holding_backfill` and render derived stretches differently on the chart (dashed, or a lighter fill) —
the user should be able to see where the data stops being observation; (c) persist `trust_booked_on` per
account rather than re-deciding it, with an explicit "provider started sending real dates" transition.
**Migration cost**: cheap for (a) and (c), cheap-to-moderate for (b) (one column + a chart change).

---

### D-7 — `instrument` is globally unique on `(kind, symbol)` and on `isin`, shared across users, and the resolver writes into it


**Status**: 🟡 **Partially fixed** — the *mutable-identity* half is resolved with C-1/C-2: nothing
writes `kind` or `symbol` after insert any more. Still open: tickers are not globally unique across
exchanges (no `exchange`/MIC column), and `instrument` remains a shared mutable row with a
cross-user blast radius. Decision taken: keep Powens' `kind` as-is rather than populating it from
Yahoo's `quoteType`, and infer the label instead.
**Severity**: High
**Confidence**: Likely
**Location**: `migrations/0001_initial_schema.sql:96-101`, `providers/src/powens/map.rs:117-119`
(everything is `kind = "equity"`), `core/src/price_sync.rs:169-192` (`yahoo_symbol` cached onto the shared row),
`core/src/composition_sync.rs` (Boursorama scrape written to shared `instrument.meta`).

**The decision**: `instrument` and `price` are global/shared. Uniqueness is `isin` where non-null, and
`(kind, symbol)` where symbol non-null.

**Why it's a problem**:

- **Tickers are not globally unique.** `(kind, symbol)` collides across exchanges: `CSPX.L` vs `CSPX.MI`
  differ only because Yahoo suffixes them; a bare Powens `stock_symbol` like `CW8` or `ESE` does not carry
  an exchange, and two listings of the same fund in different currencies would merge into one row with one
  price series. `map_investment` only produces an ISIN when `code_type == "ISIN"` — for an AMF code or a
  bare ticker it falls to the symbol path, which is exactly the collision-prone one.
- **Powens can't tell equities from ETFs, so everything is `kind = 'equity'`** (`map.rs:117-119`, honest
  about it). `(kind, symbol)` therefore degenerates to `(symbol)`, and `instrument.kind` — a column that
  `valuation_grid`, `price_eligible_instruments…`, `composition_eligible_instruments…` and the frontend
  `KIND_LABEL_KEY` all branch on — is a constant for every non-cash, non-manual row in the database.
- **A shared mutable row is a cross-user blast radius.** If Yahoo resolves the wrong listing for one
  user's instrument, `set_resolved_symbol` writes it onto the global row and every other user holding that
  ISIN is now valued off the wrong listing, with no per-user override. Same for the Boursorama composition
  scrape. Your own note "measure before asserting" applies here: this is the one place where a bad datum
  can't be contained to one account.

**Alternative**: (a) make the natural key `(isin, exchange_mic)` / `(symbol, exchange_mic)` — add a
nullable `exchange` column now, before there is data to reconcile; (b) split the resolution cache out of
the shared row into `instrument_provider_symbol(instrument_id, provider_key, symbol, confirmed_by_user)`,
so a bad resolution is per-provider and overridable; (c) either populate `kind` honestly (ISIN prefix +
Yahoo `quoteType` gives you etf/equity for free) or delete the branches that pretend it's meaningful.
**Migration cost**: (a) cheap now, rewrite later. (b) cheap. (c) cheap.

---

### D-8 — There is no first-admin bootstrap; a fresh install cannot be used

**Severity**: High
**Confidence**: Certain
**Location**: `api/src/main.rs` (no bootstrap), `migrations/0002_seed_reference.sql` (no user row),
`api/src/handlers.rs:784` (`create_invite` behind `require_admin`), `ARCHITECTURE.md:262` ("At least one
admin, bootstrapped on first run"), `TODO.md` ("First admin configuration" — unchecked).

**The decision**: users are created only by redeeming an invite; invites are created only by an admin.

**Why it's a problem**: it is a closed loop with no entry point. `docker compose up` on a clean volume
produces a working server with zero users and no supported way to create one — the documented flow
requires an admin that cannot exist. The only route is `psql` and a hand-built argon2 hash. ARCHITECTURE
asserts this works; it doesn't. For a project whose stated goal is "self-hostable by non-experts"
(`ARCHITECTURE.md:20`) this is the single most important missing piece of the deployment story.

**Alternative**: on startup, if `select count(*) from users = 0`, either (a) create an admin from
`ADMIN_EMAIL` / `ADMIN_PASSWORD` env, or (b) mint a one-time invite token and print the URL to the log.
(b) is better — no password in env, and it matches the invite flow you already have.
**Migration cost**: cheap (~30 lines in `main.rs`).

---

### D-9 — No backup story, no key rotation, and a failed migration is a boot loop

**Severity**: High
**Confidence**: Certain
**Location**: `docker/docker-compose.yml` (a `pgdata` volume and nothing else), `README.md` (no backup
section), `api/src/main.rs:50-51` (`sqlx::migrate!().run(&db).await?` — `?` on `main`),
`jobs/src/lib.rs:119-137` (`{"v": 1, "ct": …}` — `v` is written and never read).

**The decision**: single binary, migrate-on-startup, Docker volume for Postgres, AES-GCM credentials keyed
by a single `ENCRYPTION_KEY`.

**Why it's a problem**:

- **The database holds irreplaceable data and nothing backs it up.** Provider history is not
  re-fetchable — your own notes say Powens' `last_update` cannot backfill and the PEA connector exposes
  only ~8 months. A `docker volume rm` or a disk failure loses years of net-worth history permanently, and
  no amount of re-syncing recovers it. There is a `gripsou.dump` in the repo root, which suggests the
  backup procedure currently is "remember to run `pg_dump`". That isn't one.
- **`ENCRYPTION_KEY` has no rotation path.** `decrypt_credentials` reads only `ct` and ignores the `v`
  field the writer stamps, so there is no envelope version to hang a re-encryption on. Losing or rotating
  the key means every connection's credentials are unreadable, and the failure surfaces as
  `fail_sync(… "decryption failed")` per connection — recoverable only by re-doing every OAuth flow.
- **A failed migration on startup is a crash loop** with `restart: always`: the binary exits, Docker
  restarts it, it fails the same migration, forever, and the SPA is down too because the same binary serves
  it. There is no "start read-only / serve a maintenance page" path, and no pre-upgrade dump.

**Alternative**: a `pg_dump` sidecar (or a documented host cron) writing dated dumps to a bind mount, plus
a `RESTORE.md` you have actually run once; read `v` in `decrypt_credentials` and add a
`rotate-encryption-key` example binary next to `pricefix.rs`; take a dump before migrating on startup when
`sqlx` reports pending migrations, and log a loud, single-line "migration failed, refusing to start" rather
than an anyhow backtrace.
**Migration cost**: cheap. This is the highest value-per-hour item in the report.

---

### D-10 — `transaction` has no currency, so multi-currency accounts silently lose their movements

**Severity**: Medium
**Confidence**: Certain
**Location**: `migrations/0001_initial_schema.sql:134-148`, `core/src/backfill.rs:114-119` (the comment
admits it), `backfill.rs:136` (`and (not s.is_cash or s.is_account_currency)`).

**The decision**: `transaction.amount` is implicitly denominated in `account.currency`.

**Why it's a problem**: the schema went to real trouble to keep three currency domains distinct everywhere
else, then left the ledger single-currency by omission. The consequence is coded as a filter: a second cash
holding on the same account in another currency is excluded from the cash walk and "held flat by §3 rule 3
until `transaction` grows a currency column". So a Revolut-style multi-currency account — the exact case
multi-currency support was built for — gets a derived history that is a flat line for every currency except
the account's own. Same hole blocks an FX conversion ever being representable as a transaction pair.

**Alternative**: add `transaction.currency text not null default` (backfilled from `account.currency`) and
drop the `is_account_currency` guard. It is a one-line migration and one predicate.
**Migration cost**: cheap.

---

### D-11 — A missing FX rate values a holding at zero rather than carrying the last known rate

**Severity**: Medium
**Confidence**: Certain
**Location**: `migrations/0010_currency_fx.sql:29-52` (`fx_asof` returns NULL), `query.rs:101-113`
(`sum()` skips NULL ⇒ contributes zero, `fx_missing` raised), `0011` (the zero-divisor guard).

**The decision**: no rate ⇒ NULL ⇒ the holding contributes nothing, and a `⚠` appears next to the headline.

**Why it's a problem**: `fx_asof` seeks the last price *on or before* the day, so this only bites at the
**left edge** of history — which is precisely where the backfill has just generated years of derived days.
A user who adds a CHF account today gets FX history from Yahoo going back as far as Yahoo goes, but any
derived day before the first stored rate values that entire account at **zero**, and the max-range chart
shows a step change that looks like a real event. The `⚠` is a tooltip on one number; it does not label the
affected days on the chart, and `account_series` deliberately drops the flag entirely
(`query.rs:591-592`: "No fx_missing flag: the accounts grid already surfaces it" — on a different card).

Zero is the worst of the three available answers. Carrying the earliest known rate backward is defensible;
omitting the day from the series is defensible; silently valuing a real position at nothing is not.

**Alternative**: in `valuation_grid`'s `fx` CTE, fall back to the *earliest* rate for the currency when no
rate on-or-before exists, and mark those days. Then `fx_missing` means "never had a rate at all", which is
a genuine error rather than a normal left-edge condition.
**Migration cost**: cheap (one `coalesce` with a first-rate lateral in `0019`'s body).

---

### D-12 — The headline gain% and the chart's % mode are two different metrics on the same card

**Status**: ⏭️ Skipped (2026-09-15). The split is deliberate and the user confirmed it: **the badge is raw movement of the balance over the period; the deposit-adjusted return is what the `%` toggle is for.** The audit's framing — "two numbers labelled the same thing" — does not hold on inspection: in percent mode the chart's legend and series are labelled `common.return` ("Return" / "Rendement", set at `NetWorthChart.tsx:29`), while the badge carries no metric word at all, only `dashboard.netWorth.over` ("over 3 months"). The two are distinguishable in the UI.

Measured on live data before the decision (2026-09-15, history clamped to its 2026-06-19 start): net worth 3 928,84 € → 4 916,29 €, invested 3 740,97 € → 4 727,96 €. The badge therefore reads about **+987 € / +25,1 %** while the chart's percent mode ends at about **+0,01 %** — a genuinely large gap, and the right one to show in two different places. Roughly 987 € was deposited over the window and it earned about 46 cents.

Not done, and cheap if it is ever wanted: the badge has no label of its own. A word there ("change" / "évolution") would remove the last of the ambiguity without touching either metric.

**Severity**: Medium
**Confidence**: Certain
**Location**: `api/src/dto.rs:52-57` (`gain_pct = (last − first) / first` on **net worth**),
`frontend/src/lib/assetSeries.ts:50-64` (`windowReturn` — simple-Dietz, deposit-adjusted),
`components/ValueChart.tsx:85-106`, `components/NetWorthCard.tsx:98-103`.

**The decision**: the % toggle plots deposit-adjusted return over the window; the badge next to the big
number shows raw net-worth change over the same window.

**Why it's a problem**: they are different numbers with the same label on the same card. Deposit €10 000
into savings during a flat month: the badge says +12%, the chart says +0%. The recent commits
("charts show the % in the timeframe", "Fix % charts") fixed the chart and left the badge — the coherent
model was found and then applied to only one of the two places that need it.

There is a second, quieter inconsistency: `invested` includes cash at 1:1 (`powens/map.rs:217`
`cost_basis: quantity` for cash holdings), so the "capital invested" line moves with every salary payment.
That is defensible as "money I put in", but it means the gap between the two lines is securities-only
unrealised P/L while the label implies whole-portfolio.

**Alternative**: compute the summary in the backend from the same formula `windowReturn` uses, return
`return_pct` alongside `gain_abs`, and label the badge "return" not "gain". Delete `windowReturn` from the
frontend once the backend owns it — the metric definition should live in exactly one place, and that place
should not be a chart component.
**Migration cost**: cheap.

---

### D-13 — `CompositionProvider` is a third port that exists outside the provider system entirely

**Severity**: Medium
**Confidence**: Certain
**Location**: `core/src/provider.rs:100-115`, `providers/src/boursorama/mod.rs`,
`jobs/src/lib.rs:115-117` (`composition_provider()` — hardcoded, no registry, no env, no key check),
`migrations/0001:36-41` (`provider.kind check (kind in ('account','price'))`), `0002` (no `boursorama` row).

**The decision**: ETF composition is a third trait with one scraper implementation, called unconditionally
after every sync.

**Why it's a problem**: the `provider` table's `kind` CHECK constraint physically cannot hold a
`composition` row, so Boursorama is not in the registry, not in `enabled_providers`, not visible in the
admin Server settings page, and not disableable. It is a web scraper of a third-party site with a spoofed
User-Agent (`boursorama/mod.rs:11`) that runs on a schedule against someone else's servers, whose output is
written to a **globally shared** `instrument.meta` row (D-7), and whose failure mode is a silent
`tracing::warn!`. The one place a self-hoster would look to turn it off doesn't list it.

This is the clearest sign the provider abstraction isn't quite the right seam: three traits, three
registration mechanisms (env-constructed map, always-on vec, hardcoded constructor), one registry table
that models two of them.

**Alternative**: drop the `kind` CHECK (or add `'composition'`), seed the `boursorama` row, register it
through the same path as the others, and gate it on `enabled_providers`. While you're there — see D-14 —
consider whether `kind` should be a set of capabilities rather than a single value.
**Migration cost**: cheap.

---

### D-14 — `enabled_providers` gates connection *creation* but not syncing

**Severity**: Medium
**Confidence**: Certain
**Location**: `api/src/handlers.rs:886-897` (the only enforcement point), `jobs/src/lib.rs:96-102`
(`account_providers()` builds from env, never consults the DB), `jobs/src/lib.rs:58-80` (`sync_all_daily`).

**The decision**: `app_settings.enabled_providers` is the admin's "choose data providers" switch.

**Why it's a problem**: the switch only blocks `POST /connections/init`. Existing connections of a disabled
provider keep syncing every night, keep hitting the provider's API with stored credentials, and keep
accepting its webhooks (`handle_webhook` doesn't check either). An admin who disables Powens because of a
provider incident, a billing issue, or a privacy concern gets no behaviour change at all. The setting reads
as a kill switch and is a UI filter.

**Alternative**: check enablement in `sync_connection` and `handle_webhook`, and decide explicitly what a
disabled provider's existing connections should show (a "paused" status is probably right, and reuses the
status column D-4 wants split anyway).
**Migration cost**: cheap.

---

### D-15 — The provider ports don't fit a fourth provider, and the parameter-less traits hide it

**Severity**: Medium
**Confidence**: Likely
**Location**: `core/src/provider.rs:36-98`, `jobs/src/lib.rs:141-253`.

**The decision**: `AccountProvider { connect, complete_connect, sync(credentials), request_refresh,
verify_webhook }` and `PriceProvider { supports, resolve_symbol, fetch_prices }`.

**Why it's a problem**: the trait is Powens' shape with the serial numbers filed off. Test it against the
two providers you'd plausibly add next:

- **A crypto exchange (Kraken/Binance) with staking.** `connect`/`complete_connect` are an OAuth
  round-trip; an exchange is an API-key paste, which has no redirect and no callback — you'd have to
  return `ConnectInit { redirect_url: None }` and then invent a second, out-of-band path to get the key
  into `credentials`, because nothing in the trait accepts user input. Staking rewards arrive as quantity
  increases with no transaction, which D-2 already showed the backfill mishandles.
- **A CSV importer.** Same problem, harder: the payload is a file upload. `sync(&self, credentials)` has
  nowhere to put it.

Two smaller signals that the seam is off: `sync` takes only `credentials`, so an adapter cannot know which
connection it is syncing, cannot store a cursor, and cannot do anything incremental — fine for Powens
(your note says incremental is impossible there) but baked into the *port*, not into the adapter.
And `request_refresh`/`verify_webhook` are default-`NotImplemented` methods on the main trait rather than a
separate `WebhookProvider` capability, so `jobs` has to probe with `webhooks_enabled() && has_external_id`
(`jobs/src/lib.rs:310-319`) — a capability check done by string-inspecting `provider_meta`.

The **"never a schema migration to add a provider" rule does hold** — that part of the bet paid off, and
adding Yahoo and Boursorama took none. It's the *trait* that doesn't generalise, not the schema.

**Alternative**: `async fn sync(&self, ctx: &SyncContext) -> SyncResult` where `SyncContext` carries
`connection_id`, `credentials`, `provider_meta`, and `cursor`; and split auth into an enum
(`AuthFlow::Redirect{..} | AuthFlow::Secrets{fields: Vec<FieldSpec>} | AuthFlow::Upload`) that the frontend
renders generically. Move webhooks to their own trait. Do this when the second `AccountProvider` actually
lands — not before — but do not add a second Powens-shaped adapter and call it validation.
**Migration cost**: moderate, and cheap today (one adapter).

---

### D-16 — `holdings()` is an N+1, and the dashboard is four uncoordinated round trips

**Severity**: Medium
**Confidence**: Certain
**Location**: `core/src/repo/query.rs:344-370` (one sparkline query per holding),
`frontend/src/api/hooks.ts` (`useNetWorth`, `useDistribution`, `useHoldings`, `useAccounts` all independent),
`frontend/src/queryClient.ts` (`new QueryClient()` — no defaults at all).

**The decision**: `/holdings` returns a `spark: Vec<Decimal>` per row, built by looping the base rows and
issuing one query each.

**Why it's a problem**: the loop is a straightforward N+1 that a single
`where instrument_id = any($1) and ts >= now() - interval '30 days'` plus a group-by in Rust replaces
exactly. At 13 holdings it's invisible; the point is that it's in the read path of the most-loaded
endpoint and there is no reason for it. Separately, `queryClient.ts` sets no `staleTime`, so every route
change refetches all four dashboard queries against a dataset that changes at most once a day — the
server-state boundary is right (TanStack Query owns it, no duplication into client state) but it is
configured as if the data were live.

**Alternative**: batch the sparkline query; set `staleTime` to something on the order of the sync cadence
(5 min is plenty) with an explicit invalidate after a sync completes — which `useSyncConnection` almost does
already, it just doesn't invalidate the dashboard queries.
**Migration cost**: cheap.

---

### D-17 — Transactions pagination is offset-based with no total, and the date filters can't use the index

**Severity**: Medium
**Confidence**: Certain
**Location**: `core/src/repo/query.rs:804-858`, `frontend/src/api/hooks.ts` (`useTransactions`,
`TRANSACTIONS_PAGE_SIZE = 200`), `migrations/0014` (`transaction_account_ts_idx (account_id, ts desc)`).

**The decision**: `limit/offset` paging, "a short page means the end", no count returned.

**Why it's a problem**: three things. (1) `offset` over `order by t.ts desc, t.id` drifts when a sync
inserts rows between page fetches — the user silently skips or repeats rows, and a full-fetch-every-sync
provider (which yours is) makes that likely. (2) `t.ts::date >= $5` casts the indexed column, so the date
filter can't use `transaction_account_ts_idx`; `t.ts >= $5::timestamptz` would. (3) The index is
`(account_id, ts desc)` but the unfiltered query has no account predicate — it filters by
`connection.user_id`, so the common case is a full scan + sort. A `(ts desc)` index, or better, denormalising
`user_id` onto `transaction`, is what this query actually wants.

**Alternative**: keyset pagination on `(ts, id)`, which the existing `order by` already sets up; fix the
date cast; add the index the unfiltered path needs.
**Migration cost**: cheap.

---

### D-18 — Snapshot days are UTC-only, and only "today" is ever stamped

**Severity**: Medium
**Confidence**: Certain
**Location**: `core/src/ingest.rs:40` (`let today = Utc::now().date_naive()`),
`repo/snapshot.rs` (upsert on `(holding_id, as_of)`), `query.rs` (`(now() at time zone 'utc')::date`).

**The decision**: one snapshot per holding per UTC day, always stamped for the current UTC date.

**Why it's a problem**: two consequences.
- A sync running between 23:00 and 24:00 Paris time in winter (22:00–24:00 in summer) stamps *yesterday*,
  overwriting yesterday's genuine snapshot with today's balances. There is no per-user timezone anywhere
  in the schema, and the daily scheduler fires on a 1-hour tick from process start, so which hour it lands
  on is a function of when you last deployed.
- **A retroactive provider correction can never be recorded.** The core only ever stamps `today`; a
  snapshot day, once written, is immutable in practice, and the backfill explicitly refuses days that have
  one (`backfill.rs:340-343`). So if Powens corrects last Tuesday's balance, gripsou keeps the wrong value
  for that day forever. This is the flip side of D-6: derived history is too mutable, observed history is
  not mutable at all, and neither is what you want.

**Alternative**: take the day from a configured `app_settings.timezone` rather than UTC; and let a sync
re-stamp the last N days when the provider reports balances for them (Powens doesn't, but the *core* should
not be the thing that prevents it).
**Migration cost**: cheap.

---

### D-19 — `holding_snapshot.value` is a fallback that four queries carry and almost nothing reads

**Severity**: Low
**Confidence**: Certain
**Location**: `migrations/0001:113-121`, `ingest.rs:62-70`, `query.rs:102-106, 255-259, 503-507, 735-739`.

**The decision**: `holding_snapshot` stores `quantity`, `value` (the provider's valuation) and `cost_basis`;
the read path prefers `quantity × unit_value_asof` and falls back to `value × fx`.

**Why it's a problem**: it isn't wrong, it's just carrying weight. `value` is only reachable for an
instrument with no price row at all, and for cash it is definitionally `quantity`
(`ingest.rs:66-70`). The cost is that every one of the four valuation queries has to spell out a
three-branch `coalesce` and a second FX join (`afx`) for a branch that fires almost never, and the
`fx_missing` predicate has to test both branches. That complexity is duplicated four times and is the
main reason those queries are hard to read.

**Alternative**: write a `price` row for a provider-valued instrument at ingest time (that *is* what the
provider is telling you: a unit price) and delete the fallback branch. One valuation path, not two, which
was the stated goal of the unified model in the first place.
**Migration cost**: moderate (touches the four queries and the backfill's `value` column, but simplifies all five).

---

### D-20 — `base_currency` is a one-way door and `'EUR'` is hardcoded as its fallback in four places

**Severity**: Low
**Confidence**: Certain
**Location**: `migrations/0010:9-11`, `query.rs:99, 600, 730` (`coalesce(prefs->>'currency', 'EUR')`),
`jobs/src/lib.rs:210-213`, `repo/prefs.rs:48`, `handlers.rs` test seeds.

**The decision**: one pivot currency in `app_settings.base_currency`, never displayed, rates stored against it.

**Why it's a problem**: the *design* is right — a pivot is the correct model and read-time conversion is the
correct call (storing converted values would freeze a rate into history and make correcting a bad rate
impossible, which is far worse). Two smaller issues sit on top of it: (a) changing `base_currency` after any
price exists silently reinterprets every stored FX rate, with no guard, no migration, and no UI — it is a
one-way door that isn't labelled as one; (b) the pivot's own value is duplicated as a literal `'EUR'`
fallback in three SQL bodies and one Rust default, so a non-EUR install has four places where the wrong
answer is baked in if `prefs.currency` is unset.

**Alternative**: a `check` or a trigger refusing an update to `base_currency` when `price` is non-empty
(with a documented re-pivot procedure), and replace the `'EUR'` literals with
`(select base_currency from app_settings where id = 1)`.
**Migration cost**: cheap.

---

### D-21 — Reset tokens key on email, not user id

**Severity**: Low
**Confidence**: Certain
**Location**: `migrations/0001:19-27` (`invite_token.email` nullable),
`core/src/repo/invite_token.rs:88-103` (`update users set password_hash = $2 where email = $1`).

**The decision**: one `invite_token` table serves invites (email null — the invitee picks one) and resets
(email = the target user's).

**Why it's a problem**: this is the "nullable column encoding two meanings" pattern the brief asked about,
and it has a live consequence: a reset link resolves its target by email at redemption time. If the user
changes their email between link issue and redemption, the update matches zero rows and the flow fails
opaquely; if a *different* user later takes that email (the old one having been deleted), the link resets
the wrong account.

**Alternative**: `target_user_id uuid references users(id) on delete cascade`, null for invites. Same
nullability, but the null now means one thing ("no target yet") and the non-null is a stable key.
**Migration cost**: cheap.

---

### D-22 — Assorted smaller model/API notes

**Severity**: Low
**Confidence**: Certain

- **No API versioning.** `/api/*` is flat and the SPA is served from the same binary, so version skew is
  bounded — this is genuinely fine, and I'd leave it. Worth a line in ARCHITECTURE saying so deliberately.
- **`core::dto` vs `api::dto` earns its keep, but not for the reason documented.** `core::dto` is the
  *provider*-facing canonical model; the *read* model is the bespoke row structs in `query.rs`. `api::dto`
  is then mostly `Decimal → String` + camelCase over those rows. That's a real job (the money-as-string
  rule lives there and only there) but it means "the DTO layer" refers to two unrelated things and
  ARCHITECTURE §4 only describes one.
- **`range_window("max") = now − 4000 days`** (`handlers.rs:31`) is a magic number that `history_start`
  then clamps away — the clamp made the constant dead weight; delete it and pass `None`.
- **`connection.credentials`/`provider_meta` default `'{}'`** and `provider_meta` is string-probed for
  `external_connection_id` in `jobs` (`lib.rs:311-314`). That's a `*_meta` JSONB doing load-bearing control
  flow, which is exactly the "dumping ground" case — `external_connection_id` should be a column.
- **`instrument.meta` holds four different things** (`yahoo_symbol`, `yahoo_resolution`, `composition`,
  `composition_status`), two of which are queried with `->>'…'` in `WHERE` clauses
  (`query.rs:895-899`) with no index. At this size it doesn't matter; the pattern does.
- **No index on `holding(instrument_id)` or `account(connection_id)`** — both are join keys in
  `valuation_grid` and the backfill scope. `(account_id, instrument_id)` covers the first column only.

---

### Docs vs. reality

| Doc claim | Reality |
|---|---|
| `ARCHITECTURE.md:262` "At least one admin, **bootstrapped on first run**" | No bootstrap exists anywhere in the code (D-8). A fresh install has no users and no way to make one. |
| `ARCHITECTURE.md:130` + §11 "Manual accounts — accommodated by `account.connection_id` nullable" | Not accommodated. Every read query inner-joins `connection` for user scoping, so such a row is invisible and unowned (D-3). |
| `ARCHITECTURE.md:196` / `CLAUDE.md` "New account types are data inserts, never migrations" | True for the type *row*; false for type *behaviour* — `'pea'` is hardcoded in `backfill.rs` and `query.rs` (D-5). |
| `ARCHITECTURE.md:63` "AccountProvider: Powens (banks, PEA, brokerage), **Manual (future)**" | The trait's `connect`/`complete_connect` shape cannot express a manual or key-paste provider (D-15). |
| `ARCHITECTURE.md:236-241` trait sketch: `sync(&self, ctx)`, `supports(&self, …) -> bool` async, `fetch_prices(instrument, range)` | Actual: `sync(&self, credentials)` (no ctx — the note "provider ports param-less" is still live), `supports` is sync, `fetch_prices(symbol, since)`. Also omits `CompositionProvider`, `request_refresh`, `verify_webhook`, `webhooks_enabled`. |
| `ARCHITECTURE.md:151` `connection.status (ok \| syncing \| error)` | Five states since `0005`/`0008`: `+ pending, awaiting`, plus `sync_requested_at`, `institution_key`, `institution_name` (`0009`) — none documented. |
| `ARCHITECTURE.md:170-186` `transaction` table listing | Missing `description` (`0014`), `booked_on` (`0015`). §3.2 has no `holding_backfill`, no `holding_point` view, no `txn_day()`, no `valuation_grid()` — the entire derived-history subsystem, which is now the largest single piece of logic in the app, appears nowhere in the "source-of-truth design". It lives only in `TRANSACTIONS.md`. |
| `ARCHITECTURE.md:186-190` §3.3 "Net-worth chart … × `price(t)` **intraday**" | There is nothing intraday. `price.ts` is snapped to UTC midnight by `0020`, the series is daily and then *sampled* to ~400 points (`series.rs`). The `24h` range therefore returns one or two points. |
| `ARCHITECTURE.md:107` `users.prefs` lists `currency_symbol` | Renamed to `currency` (an ISO code) by `0010:17-27`. |
| `ARCHITECTURE.md:110-113` `app_settings` | Correct, but doesn't mention `base_currency` is effectively immutable once prices exist (D-20). |
| `ARCHITECTURE.md:302` "Splitting core/providers enforces the ACL" + §9 layout | Layout omits `backend/core/examples/perf.rs`, `backend/jobs/examples/pricefix.rs`, `shared/account-palette.json` — the last is a build-time input to both frontend and Docker. |
| `ARCHITECTURE.md:224` "Adding a provider = implement a trait + register it" | True for `AccountProvider`/`PriceProvider`; `CompositionProvider` cannot be registered at all — `provider.kind` has a CHECK constraint that excludes it (D-13). |
| `REQUIREMENTS.md` "Total **net worth**" | It is total *assets*. Liabilities are dropped in the adapter (D-2). |
| `REQUIREMENTS.md` "Accounts types are: Checking (Cash), Savings (Cash), PEA (PEA), Brokerage (Brokerage)" — a type/category hierarchy | The `category` table was dropped in `0013` as carrying no information. The requirement's parenthesised categories no longer exist. |
| `REQUIREMENTS.md` "Features to implement in future: Transactions page, multiple currencies, ETF country/sector" | All three shipped (v1.3.0/v1.4.0). The section is stale and reads as a roadmap. |
| `REQUIREMENTS.md` asset modal mode 2: "capital invested will be a **staircase** graph" | Implemented, but from a different formula than the backend's (`assetSeries.ts` uses proceeds, `backfill.rs` uses qty×μ) — the two disagree after any sale (D-1). |
| `ARCHITECTURE.md:288-291` "Chart y-axis: **resolved open question** — range = min − 10% of span … max + 10% of span" | Not implemented. `ValueChart.tsx:163-166` sets `type: "value", scale: true, splitNumber: 4` and no `min`/`max`, so ECharts' default nice-scale picks the range. The documented resolution was never built. |
