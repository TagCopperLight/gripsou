# AUDIT-FIXES — working method

Companion to `AUDIT.md` (105 findings, audited at commit `4c55dba`). This file exists so the work can
be picked up in a fresh session without re-deriving the protocol. **Read `AUDIT.md`'s "Fix log" table
first** — that is the authoritative record of what is done; this file is the *how*.

Neither `AUDIT.md` nor this file is committed. Both are untracked and follow you across branches.

---

## Where the work lives

- **Branch**: `audit-fixes`, cut from `main` at `3f5ed1c`.
- **Never commit.** The user commits, always. Do not run `git commit` for any reason, including when a
  skill or plan tells you to.
- `TODO.md` has a `- [ ] Audit fixes` entry under v1.4.2 (the user added it; leave it alone).

---

## The protocol

The user drives. One issue at a time, in this loop:

1. **Pick the next issue** from the queue below. Group findings that the six audit lenses reported
   separately but that are the same underlying bug — the audit's own cross-cutting table (in
   `AUDIT.md`, under "The cross-cutting theme") tells you which ones collapse together.
2. **Verify before presenting.** Read the cited code. Do not trust the audit's line numbers or its
   claims — they were written against `4c55dba` and the tree has moved. Where the finding is about
   data (duplicate rows, missing rates, stale snapshots), **query the live database** and say what is
   actually there. The user's standing rule: measure before asserting. Several confident assertions in
   past sessions turned out wrong.
3. **Present it**: what the code does, how it fails, where the user actually stands (is it live or
   dormant?), and the proposed fix as a concrete table of file → change. Flag consequences the audit
   missed.
4. **The user decides**: fix / skip / defer.
5. **Ask clarifying questions** with the `AskUserQuestion` tool if the fix has a real fork in it. Give
   a recommendation, don't just enumerate. The user may reject the tool call to clarify the question
   first — that is normal, ask them what they want to clarify and reformulate.
6. **Implement**, verify (see below), then **mark `AUDIT.md`**.
7. Report what changed, what the tests prove, and anything noticed-but-not-fixed.

Explain in plain language throughout. No SQL dumps or jargon at the user — plain words, concrete
numbers, tradeoffs expressed as visible outcomes.

---

## Marking `AUDIT.md`

Two places, both required:

1. **The Fix log table** at the top of `AUDIT.md` — one row per issue worked:
   `| C-1, C-2, D-7 (part) | <short title> | ✅ Fixed |`
   Legend: ✅ fixed · 🟡 partially fixed · ⏭️ deliberately skipped · ⏳ deferred.
   Skipped and deferred decisions go in the table too — it is the record of what was chosen *not* to
   do, which matters as much as what was.
2. **A `**Status**` line inline** at the finding's own `###` heading, inserted directly above
   `**Severity**:`. Say specifically what was done and name the regression test. For a partial fix,
   say which half is resolved and which half is still open.

Do not renumber or retitle findings — the document cross-references them heavily.

---

## Verification loop

The backend needs a reachable Postgres for sqlx's compile-time checking. **The compose Postgres is not
published to a host port**, so `localhost:5432` will not work — derive the container IP:

```fish
set IP (docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' \
    (docker compose -f docker/docker-compose.yml ps -q postgres))
# was 172.18.0.2 — re-derive it, it changes when the container is recreated
```

Then, from `backend/`, with `DATABASE_URL=postgres://gripsou:gripsou@$IP:5432/gripsou`:

```
cargo fmt
cargo build
cargo test            # ~23 test binaries, ~250 tests
cargo clippy --workspace --all-targets    # must be silent
```

**Any change to a `query!`/`query_as!` macro — in src *or* tests — requires regenerating the offline
data**, or CI's offline build breaks:

```fish
# sqlx-cli is installed but not on PATH; it lives in ~/.cargo/bin.
# It must be invoked as `cargo sqlx`, not `cargo-sqlx sqlx` — the latter errors on $CARGO.
PATH=$HOME/.cargo/bin:$PATH cargo sqlx prepare --workspace -- --all-targets
```

Then confirm the committed data actually works, touching a file first so the check isn't cached:

```
touch core/src/repo/query.rs
env -u DATABASE_URL SQLX_OFFLINE=true cargo check --workspace --all-targets
```

Frontend, from `frontend/`: `bun run lint` **and** `bun run test` and `bun run build`. Lint is not
optional — eslint's `react-refresh` rule forbids non-component exports from a component file, and
`bun run build` will not catch it.

`cargo fmt` reformatting files you did not touch is expected and fine; do not revert it.

The golden tests (`core/tests/golden.rs`) compare whole outputs against committed fixtures. A drift is
"a conversation about which answer is correct", never a reflex regeneration — but when the new answer
*is* the correct one, regenerate deliberately with
`UPDATE_GOLDEN=1 cargo test -p gripsou-core --test golden` and check `git diff` on the fixture.

---

## Conventions that bit during issue 1

- Money is `rust_decimal::Decimal` ↔ Postgres `NUMERIC`, never floats. The API ships decimals as
  **strings**.
- New account types are **data inserts** into `account_type`, not migrations.
- `instrument.kind` and `instrument.symbol` are now **write-once at insert**, from whatever the
  provider said. Nothing may mutate them afterwards — they are the natural key the next sync
  re-resolves the row by. Anything derived (display ticker, tracker-vs-share label) is computed at
  read time, from `meta` or in the DTO layer.
- Before removing a write, check who *reads* that column. Issue 1's near-miss: `set_resolved_symbol`
  was the only thing that ever populated `instrument.symbol` on the ISIN path, and `Holding.ticker` is
  `symbol.unwrap_or(currency)` — dropping the write silently would have shown "EUR" as every new
  instrument's ticker. The test suite caught it; don't rely on that next time.

---

## Queue

Severity order, with the same-bug groupings already applied. `AUDIT.md` holds the detail for each.

### Critical

| Findings | Issue | Status |
|---|---|---|
| C-1, C-2, D-7 (part) | Instrument identity built from mutable columns | ✅ Fixed |
| D-1, Z-1, C-7 | Cost basis moved to a `lot` table with one SQL definition | ✅ Fixed |
| C-9 (part) | Transactions list date filters no longer use the session timezone | ✅ Fixed |
| C-7 (follow-up) | Chart's invested line back-dated today's cash balance | ✅ Fixed |
| D-2 | "Net worth" is gross assets; liabilities dropped at the adapter | ⏭️ Skipped |

**The Critical tier is closed.** D-2 was skipped by the user's decision: no loan, card or negative
holding exists in the live database, so nothing is being dropped today and the headline number is a
true net worth for this install. Revisit it the day an account with a negative value appears. The
`**Status**` line on D-2 in `AUDIT.md` records what was measured and what the fix would cost then.

### High ← the work is here now

| Findings | Issue | Status |
|---|---|---|
| C-3, C-6 | A missing FX rate absorbed silently, twice: the reporting divisor and the cost basis | ✅ Fixed |
| C-4 | Powens account and investment lists are paginated to exhaustion | ✅ Fixed |
| C-5 | Cancelled transactions are never removed from the ledger | ⏳ Deferred |
| D-4, Q-4 | A wedged `syncing` connection is recoverable; the silent lock writes now log | ✅ Fixed |
| Z-4 | One `roles.admin` / `roles.member` pair, five call sites repointed | ✅ Fixed |
| S-1, S-2, S-3 | Login hardening: rate limiting, password floor, timing oracle | ⏳ Deferred |
| C-11, D-12 | Headline badge vs. the chart's % mode — two metrics, by design | ⏭️ Skipped |
| C-17, C-18, Z-6 | Query-key factory + named invalidation groups; three stale screens closed | ✅ Fixed |

**C-5 is deferred on purpose**, not skipped: it is the same work as the "Transactions reconciliation"
item the user added under the Budget page in `TODO.md`, and it needs C-4's guarantee that a fetch is
complete before anything may be deleted for being absent from it. Pick it up there, not here.

**S-1 / S-2 / S-3 are deferred**, not skipped. They are one code path — the login and
password-setting handlers — and the user chose to take them in a later session. They are the only
*live, internet-reachable* High left: the instance is proxied to `gripsou.bourdet.be` by the central
Caddy, login has no rate limit, `change_password` validates nothing at all, and an unknown email
returns before Argon2 runs so account existence is a one-request timing oracle. When picking this up,
the two open decisions are the minimum password length and how the per-IP limiter learns the real
client IP through Caddy.

Remaining:

Correctness: (none — C-4 closed the tier, C-5 moved to the reconciliation work)
Design: D-3 · D-5 · D-6 · D-8 · D-9 · D-7 (remainder: no exchange/MIC column, shared mutable row)
Quality: Q-1 · Q-2 · Q-3
Centralization: Z-2 · Z-3 · Z-5
Security: S-1 · S-2 (both High) deferred above; S-3…S-17 are Medium/Low

**Measured and found dormant, so not yet worth doing**: Z-3's four "% of net worth" denominators
(accounts list, distribution pie, holdings table, headline) are all still computed separately, but on
2026-09-15 all four came to 4 916,29 € exactly. It is a drift risk, not a live wrong number.

Pairs that should be fixed together because they are one bug seen twice:
- **Z-5 + Q-17** — chart colours hardcoded as hex, diverged from the CSS tokens.
- **Z-14 + Q-24** — the `#888888` fallback, twice.

### Medium / Low

See the severity listing in `AUDIT.md`. The audit's own "Recommended order of work" section covers
the comments lens (M-1…M-5 plus the deletion batches) and is a reasonable script for that chunk —
M-1 first, since the `§4.x` citations guard the very money formula D-1 is about.

---

## Issue 1, for reference

**C-1 / C-2 / D-7(part) — instrument identity built from two columns that later get rewritten.**

`(kind, symbol)` was the dedup key for ISIN-less instruments, but `set_resolved_symbol` overwrote
`symbol` with the Yahoo ticker and `set_composition` flipped `kind` to `'etf'`. The next sync missed
the key, inserted a duplicate instrument and holding, and ingest's close loop zeroed the original —
destroying that position's history, every sync, forever.

Live data check: all 5 of the user's ETFs carry an ISIN and so dedup on `(isin)`, which nothing
rewrites; the only symbol-only row is `XX-liquidity`, which Yahoo never resolves. **The bug was real
but dormant** — it would fire on the first holding with a ticker and no ISIN.

Changes:

| File | Change |
|---|---|
| `core/src/repo/instrument.rs` | `set_resolved_symbol` writes `meta` only; its 23505-clash fallback deleted as unreachable. `set_composition` no longer sets `kind`. |
| `core/src/repo/query.rs:239` | Display ticker = `coalesce(i.symbol, meta->>'yahoo_symbol')`, cash excluded so it keeps falling back to the ISO code rather than showing `CNYEUR=X`. |
| `api/src/dto.rs` | New `display_kind(kind, has_composition)` — an `equity` with a scraped composition renders as `etf`. |

Decision taken: **keep Powens' `kind` as-is** (it reports everything as `equity`) rather than
populating it from Yahoo's `quoteType`, and infer the ETF label from the presence of a scraped
composition instead. This avoided a migration, an index change and a `PriceProvider` trait change.
Accepted tradeoff: an ETF whose Boursorama scrape has not landed yet displays as "Equity".

Existing rows were **not** normalized — the five ETFs still carry their old mutated `kind='etf'` and
`.PA` symbols. Harmless, since nothing mutates them now and they dedup on ISIN. A normalization
migration remains available if tidiness is wanted.

Noticed, not fixed, not in the audit: `resolve_instrument`'s own doc comment admits cross-key dedup is
deferred — the same security reported with an ISIN one sync and symbol-only the next still produces
two rows.

---

## Issue 7, for reference

**D-4 / Q-4 — a wedged `syncing` connection, plus the discarded writes that hid it. And Z-4.**

The per-connection lock was `status='syncing'` with nothing to release it when the process holding it
died. New column `sync_started_at` (migration `0027`) makes the claim's age answerable, so `begin_sync`
takes over a claim older than 30 minutes, the minute reaper moves such rows to `'error'` with an
"interrupted" message, and `run_scheduler` sweeps leftovers at boot. Dormant when fixed — all four live
connections read `ok`.

Two conventions this surfaced:

- **A raw `update connection set status='syncing'` in a test is now a *stale* claim**, because it leaves
  `sync_started_at` null. One api handler test had to stamp `now()` to keep asserting a 409.
- `mark_synced_ok` / `mark_synced_error` null the stamp; without that, the next sweep would judge
  staleness from a claim nobody holds.

Deviation from the audit on Z-4: `settings.adminBadge` was kept. It labels a nav item as admin-only,
not a person as an admin — same word, different statement.

---

## Issue 9, for reference

**C-17 / C-18 / Z-6 — every mutation hand-wrote its own list of what to refresh.**

`frontend/src/api/keys.ts` is now the single definition of every query key, and
`frontend/src/api/invalidate.ts` names one group per domain event. All 42 sites go through them.

The key-factory convention worth knowing: **a parameterised key called with no argument returns its
family prefix** — `keys.netWorth("1y")` is `["net-worth", "1y"]`, `keys.netWorth()` is
`["net-worth"]`. Read sites pass the parameter, invalidation sites omit it, and react-query's prefix
matching does the rest. `api/keys.test.ts` pins that property, because if a parameterised key ever
stops starting with its own prefix the invalidation misses silently.

Three real stale screens closed: transactions after a sync, holdings + transactions after an account
rename, everything after deleting a connection.

**Two of Z-6's five claimed sites were wrong**, and verifying that was the whole value of step 2 of
the protocol. `useSyncConnection` / `useSyncAll` / `useCompleteConnection` invalidating only
`connections` is *correct*: the sync endpoints answer `202 Accepted` and work in a detached task, so
the connections poll landing on `ok` — handled once, in `SyncButton` — is the completion signal for
every screen. Had the audit been implemented as written, three mutations would have grown pointless
invalidations that fire before any new data exists.

Test convention this set: **invalidation groups are asserted against their exact key set, never with
`arrayContaining`.** All three bugs were a key *missing* from a list, and a containment assertion
cannot catch that. `SyncButton.test.tsx`'s existing check was loosened in exactly that way and was
tightened as part of this.
