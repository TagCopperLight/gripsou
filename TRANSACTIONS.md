# gripsou — Transactions

> Specification for the transactions feature. Read alongside `ARCHITECTURE.md`
> (§3.2 schema, §3.4 modeling decisions, §4 provider ACL, §5 sync flow); this
> document covers only the transaction-specific deltas.
>
> Transactions exist in gripsou for **two** reasons, and the design serves both:
>
> 1. **Budgeting** — a searchable history now, a full category/budget feature later.
> 2. **Correct charts in the past** — reconstructing net worth back to 2023 from
>    transactions, instead of the ~10 real data points the app has today.
>
> Written against **real production data** (see §2). Supersedes the earlier
> backend-ingestion-only draft, whose central caveat — that this was a Powens
> *sandbox* connector serving demo data — was wrong. The connection is real.
>
> **Updated 2026-09-15** for the lot-table refactor (migrations 0021-0024):
> purchases and sales moved out of `transaction` into a new `lot` table, cost
> basis is now derived at read time by the single `lot_basis` SQL function, and
> `transaction` became a pure cash ledger. The passages this touches are
> corrected in place; section numbers are unchanged so existing citations by
> section still land on the right place.

---

## 1. Scope

### Phase 1 — this document, specified to implementation depth

- Fetch and ingest Powens bank transactions.
- Transactions page: history list, text search, filtering.
- Backfill engine: derive past holding values from transactions.
- Manual lots: gap detection, badge, fill-in modal.

### Phase 2 — sketched only (§13), designed after Phase 1 has been used

Categories, AI category detection with learning, merchant icons, the
Transactions→Budget tab rename, budget charts.

### Out of scope, permanently

- **Market orders / provider-supplied lots.** No aggregator exposes them — not
  Powens, not Bridge, and PSD2 providers cannot see a PEA at all. Lots come from
  the user or not at all.
- Pending rows (`coming = true`) — excluded from ingest, and not shown on the
  page. Not because they are rare (they are: **0 of 2,652 today**, 3 at an earlier
  measurement) but because they *cannot* join the ledger — see §6.1.
- Incremental sync (Powens `last_update` cannot backfill; full-fetch + dedup is
  the only safe strategy).

---

## 2. Evidence

### 2.1 What the Powens payload actually contains

Measured across 4 connections (2,652 transactions at the time of writing; the
figure grows as the accounts are used).

| Finding | Consequence |
|---|---|
| `rdate`, `date`, `application_date` 100% filled; `datetime` 4% | `ts = rdate ?? date` |
| `value`, `wording`, `simplified_wording`, `original_wording` 100% | `amount = value`, `description = wording` |
| `wording` carries a ` CB*NNNN` card mask on 1,620/2,111 rows | strip it — pure noise |
| Powens truncates the merchant name to a **hard 17 chars** (0 rows longer, 19.8% clipped at exactly 17) | accepted; matters for Phase 2 categorisation, not Phase 1 |
| `id_category = 9998` on 100% | no provider categories, ever — Phase 2 is ours to build |
| `market_order` / `profit` rows exist but carry no ISIN, no `id_security`, `informations = {}` | investment activity arrives as cash lines; instrument filled by the user (§9) |
| `market_fee` rows are `"INTERETS 2025"` with **positive** values | the Powens `type` lies about direction — map by sign (§6.2) |
| `coming = true` on **0 of 2,652** today (3 at an earlier measurement); `deleted` 0; `active = false` 0 | settled-only, and see §6.1 for why it is required rather than merely convenient |
| `gross_value`, `commission`, `country`, `details`, `comment`, `counterparty` ~0%; `card` = "Not loaded" | noise — none become columns |

### 2.2 The gap this feature has to close

```
holding_snapshot today : 2026-06-19 → 2026-08-17, 119 rows, 10 distinct days
Powens transactions    : 2023-01-25 → today, 3.5 years
price history          : ESE.PA 3,296 points back to 2013; FX back to 2003
```

Ten data points, against 3.5 years of transactions and a decade of prices. The
backfill is the single largest visible improvement available to this project.

The PEA is the hard case:

```
cost basis (quantity × Powens unitprice)     1302.15
explained by ACHAT COMPTANT cash rows         320.58   (2 rows)
UNEXPLAINED                                   981.57   ← 75.4%
```

Its transaction history starts 2026-01-14; three quarters of the position predates
it. **Manual entry is the main path for securities, not the fallback.**

---

## 3. The value model

The core of the feature. For a holding on day `t`, resolve in priority order:

1. **Real snapshot** — synced truth always wins.
2. **Derived from transactions** — walk back from the nearest *later* known point.
3. **Before the earliest transaction** — hold constant, flat backward.

Rule 3 is the deliberate simplification: with no evidence of change, assume none.
Cash plausibly sat still; a chart with no transactions therefore looks exactly as
it does today.

**Securities are the exception in spirit, not in mechanism.** Shares were bought at
*some* point, so holding them flat backward is knowably wrong. gripsou detects this
(§9.1), badges it, and lets the user supply the truth. Until they do, rule 3 still
applies — the chart stays approximately right and the badge explains why. Truncating
the line instead would be more honest but would make the chart jump, which is worse
for the thing the chart is for.

**Anchoring.** Each gap is walked backward from the nearest *later* snapshot, never
from today. Drift stays bounded inside one segment rather than accumulating across
3.5 years. Where a walk doesn't quite meet the older snapshot, the snapshot wins
silently — transactions are the best evidence available for the days between, and a
discrepancy tells the user nothing actionable.

---

## 4. Schema delta

```sql
-- migrations/0014_transactions.sql
create extension if not exists "pg_trgm";  -- description search; not yet installed

alter table transaction add column description text;

create index transaction_account_ts_idx on transaction (account_id, ts desc);
create index transaction_description_trgm_idx
    on transaction using gin (description gin_trgm_ops);

create table holding_backfill (
    holding_id uuid    not null references holding (id) on delete cascade,
    as_of      date    not null,
    quantity   numeric not null,
    value      numeric not null,
    cost_basis numeric not null,
    primary key (holding_id, as_of)
);
```

> **`cost_basis` here was dropped by migration 0023.** Storing a basis per day
> alongside `lot`, the source of truth `lot_basis` derives from, was the same
> "known to be wrong, routed around at read time" problem the lot table was
> built to end. `holding_backfill` now carries only `quantity` and `value`;
> basis for a backfilled day comes from `lot_basis` like any other day.

- `description` is a **column, not JSONB** — the list renders it and search matches
  it. `provider_meta` keeps the raw payload for forensics only; nothing the app
  reads lives there.
- `holding_backfill` deliberately **mirrors `holding_snapshot`'s columns**, so chart
  queries become a `union all` rather than new logic.
- **Invariant: no backfill row may exist for a day that has a snapshot.** The
  snapshot upsert deletes the matching backfill row. One line, and the union stays
  unambiguous forever.
- ~~**No table for manual lots.** A manual lot *is* a `transaction` row~~ — this
  was reversed by migration 0021. A `transaction` row doing double duty as both
  the cash movement and the investment record could not carry a fee, and the
  cost-basis rule ended up reimplemented four times over three languages with
  two copies disagreeing on screen (AUDIT.md D-1, Z-1, C-7). Purchases and sales
  now live in their own `lot` table, keyed on `holding_id`, with a `fee` column
  and a `source` (`manual` / `provider`) that is the delete path's whole
  security model. `transaction` is a pure cash ledger (0024).

---

## 5. DTO

```rust
pub struct CanonicalTransaction {
    pub account_external_id: String,
    pub external_id: String,
    pub kind: String,                       // maps to `type`
    pub ts: DateTime<Utc>,
    pub instrument: Option<InstrumentRef>,  // always None from Powens
    pub quantity: Option<Decimal>,
    pub unit_price: Option<Decimal>,
    pub amount: Decimal,
    pub fee: Option<Decimal>,
    pub description: Option<String>,
}
```

Everything optional stays optional: a cash-only provider fills the cash subset, the
user fills the rest.

---

## 6. Powens fetch & mapping

### 6.1 Fetch

`GET /users/me/transactions`, `limit` required (max 1000), follow `_links.next` to
exhaustion. **Full-fetch every sync** — `last_update` returns only edited rows and
cannot backfill, so incremental is unsafe; full-fetch + `external_id` dedup is
idempotent.

**Keep only `coming == false`.** This is required by §3, not a tidiness choice.
Powens exposes `balance` (settled) and `coming_balance` (settled + pending); the
sync writes `holding.quantity` from `balance`, and the backfill walks transactions
backward from that anchor. A pending row in the ledger is a movement the anchor
does not contain, so **every derived value for the whole history would shift by the
pending amount**.

Secondary reason: the docs define `coming` ("not yet posted") and `deleted`
("removed from the bank") but never state whether a pending row keeps its `id` when
it settles. If Powens deletes and re-creates it, ingesting both double-counts.
Unverifiable at present — there are no pending rows to observe — and filtering makes
the question moot.

`// ponytail: full history fetch; add a min_date window if payloads get large`
(largest connection observed: 2,111 rows).

### 6.2 Mapping

- `ts` = `rdate` if present, else `date`.
- `amount` = `value`.
- `description` = `wording`, with a trailing ` CB*NNNN` card mask stripped.
- `instrument`, `quantity`, `unit_price`, `fee` = `None`.
- `provider_meta` = the raw transaction JSON.
- `type` is **sign-led, not type-led** — direction comes from the sign of `value`;
  the Powens `type` only picks a semantic label the sign can't express. This is
  deliberate: `market_fee` rows were observed to be positive `"INTERETS"`, and
  Powens warns new types may appear.

  | Powens `type` | gripsou `type` |
  |---|---|
  | `transfer`, `order` | `transfer` |
  | `profit` | `dividend` |
  | `market_fee` | `interest` if `value ≥ 0` else `fee` |
  | `bank`, `fee` | `fee` |
  | `market_order` | `buy` if `value < 0` else `sell` (instrument null) |
  | anything else, *including future types* | sign of `value`: `< 0` → `withdrawal`, else `deposit` |

---

## 7. Ingest

`core/repo/transaction.rs` moves from insert-on-conflict-do-nothing to **upsert**,
so provider corrections propagate.

```sql
insert into transaction
    (account_id, ts, type, amount, fee, description, external_id, provider_meta)
values (...)
on conflict (account_id, external_id) where external_id is not null
do update set
    -- provider wins on what the provider knows; there is nothing else here to
    -- protect any more
    ts            = excluded.ts,
    type          = excluded.type,
    amount        = excluded.amount,
    fee           = excluded.fee,
    description   = excluded.description,
    provider_meta = excluded.provider_meta
returning (xmax = 0) as inserted;
```

**The `instrument_id`/`quantity`/`unit_price` coalesce described here in earlier
revisions of this document is gone.** Migration 0024 dropped those three columns
from `transaction` entirely — a purchase or sale is a `lot` row now, and
`transaction` is a pure cash ledger, so there is nothing left on this row for a
provider update to coalesce against.

`IngestSummary` gains `transactions_inserted` / `transactions_updated`.

---

## 8. Backfill engine

Fills any `(holding, day)` with **no snapshot**, walking backward from the nearest
later anchor. Incremental and idempotent — inserts missing days only, never
recomputes what is already there.

This one rule covers three situations that look different but aren't: the years
before gripsou existed, a server outage, and the ~50 empty days already sitting
between today's 10 sparse snapshots.

### 8.1 Cash holdings

```
quantity(d)   = quantity(d+1) − Σ amount of counted transactions on day d+1
value(d)      = quantity(d) × unit_value_asof(d)
cost_basis(d) = quantity(d)                     -- matches the sync's convention
```

Exact wherever transactions exist; flat before the earliest one.

**Not every transaction is counted.** On an account whose `account_type.key` is
`pea`, rows of type `transfer`, `buy` and `sell` are **excluded from the cash
walk**. Every other account counts every type (`deposit`, `withdrawal`,
`dividend`, `fee`, `interest`, and any future one).

**Why the PEA specifically.** Its connector exposes only the current year — the
history starts 2026-01-14 while the position itself predates it. Its buys
therefore have no matching transfer-in anywhere in the ledger, so a cash walk
that counted them would drift by the whole unexplained cost basis (981.57 €,
75.4% of the position, §2.2). Freezing those three types holds the PEA's cash
line flat and leaves dividends and fees as the only things that move it.

On every other account the history is complete, so counting a `buy` is
*correct*, not a double-count: walking backward, cash rises by the amount while
the security walk drops the shares, and net worth is conserved across the pair.

The rule is stated as an exclusion of three types rather than an allow-list so a
type nobody has thought of yet defaults to counting.

`// ponytail: pea-only, hardcoded key; widen when a second invest account with a
// truncated history appears`

A `dividend` on the PEA still counts, and must: it is new money arriving from
outside with no counterpart anywhere in the ledger. Same for a fee leaving.

**What this costs.** The PEA's cash line no longer tracks its real balance; it
holds flat and is corrected only by dividends and fees. Measured against the eight
months where the real rows do exist: **±47.61 € mean, ±100.00 € worst** against a
real range of 0.45 – 160.98 € — about 2.2% of net worth at its worst point.

That is the deliberate trade: a uniform, single-rule derivation across the whole
history, in exchange for ~2% on the fraction of it where the provider happened to
give us more. It also removes the alternative's seam, where the chart would be
exact after 2026-01-14 and approximate before it for no visible reason.

### 8.2 Security holdings

```
quantity(d)   = quantity(d+1) − Σ buy qty(d+1) + Σ sell qty(d+1)
value(d)      = quantity(d) × price(d)          -- from `price`, deep history exists
```

Cost basis is no longer stored per backfill day — it is derived at read time by
the single `lot_basis` SQL function (migration 0022), the same one every other
consumer calls. The rule is PRMP, fee-inclusive weighted average over the `lot`
table:

```
μ           = Σ(qty × unit_price + fee) / Σ qty        -- over all buy lots, any date
explained(d) = Σ buy qty − Σ sell qty, over lots up to d
basis(d)     = μ × explained(d) + unexplained_cost(d)
```

where `unexplained_cost` is **0** when the lots explain the position exactly
(`Σ lot quantity = holding.quantity`), and otherwise
`holding.cost_basis − μ × explained(today)`, carried flat backward alongside the
unexplained quantity until the user fills the gap (§9). This replaces the
earlier, fee-exclusive formula published in prior revisions of this document —
that version undercounted every purchase that carried a fee.

### 8.3 When it runs, and when it re-runs

Runs at the end of ingest. The normal path does approximately nothing.

History *can* move — Powens corrects rows after the fact, which is why we upsert at
all — so a bounded invalidation is needed:

```
if any transaction was inserted-or-updated with ts < newest_backfill_day:
    delete backfill rows for the affected holdings from that ts forward
    refill
```

On a normal sync the condition is false. When it fires, the refill is bounded to
one holding from one date.

`// ponytail: backfill runs inline in ingest; move to its own job if sync latency
// becomes visible`

---

## 9. Manual lots

### 9.1 Gap detection

```
unexplained_quantity = holding.quantity − Σ buys + Σ sells
```

If `> 0`, the holding is incomplete. Surfaced as a **badge on the asset in the
Holdings list**, opening a fill-in modal. No separate list, no wizard, no
notification centre — the badge is where the user already looks, and it never nags.

### 9.2 One flow, and why it needs no special casing

The user records a purchase as a `lot` row (migration 0021), not a `transaction`
row:

- `source = 'manual'`, `external_id = null` — marks it user-entered; `source`
  is what the delete path checks before letting the user remove it,
- `holding_id`, `side = 'buy'`, `quantity`, `unit_price`, `fee` — what was
  bought, including the fee a `transaction` row could never carry,
- no `amount` to compute — a `lot` row is not a cash movement at all.

Because the lot lives outside `transaction` entirely, it needs no exclusion
rule to stay out of the cash walk — there is no cash-ledger row for it to
exclude. (Historically, before 0021, a manual purchase *was* a `transaction`
row, and the cash-walk exclusion in §8.1 covering `ACHAT COMPTANT` also had to
cover it. That special case is gone along with the row it protected against.)

**Not built, deliberately:** filling the instrument onto an existing `ACHAT
COMPTANT` row instead of creating a lot. It needs a second write path, a second
modal flow and a transaction-picker UI, and the entire payoff is one fewer row on
a page. A lot explains the quantity either way.

**Known limit.** Before the PEA's own history begins (its connector exposes only
the current year), money that left the checking account has nothing to arrive into,
so between the checking outflow and the lot that consumes it the money is in no
account at all and net worth dips. The dip is bounded by *what has left checking
since the most recent recorded lot*, so recording lots at their real dates keeps it
small; recording one lot for everything makes it large. Not fixable from the
available data — the PEA inflows simply do not exist before 2026.

### 9.3 Modal contents

Per lot: date, quantity, unit price. Repeatable, since a position may be several
lots. The instrument is not searched — it is already in the DB from the sync, so the
modal is scoped to the holding the badge was on.

`amount` is not asked for: it is derived as `−(quantity × unit_price)`.

---

## 10. Transactions page

A list over `transaction`: date, description, amount, account. Text search on
`description` (trigram index, §4), filters for account / date range / type.

Deliberately plain. The interesting version of this page is Phase 2, and it should
be designed after the plain one has been lived with.

---

## 11. Testing

- **Mapping tests** against a recorded `/transactions` fixture built from the real
  dump (anonymised): `card`, `transfer`, `profit`, `market_order`, `market_fee` with
  a positive value, and an unknown/novel type for the sign fallback.
- **Upsert clobber test** — ingest a `market_order` row, set `instrument_id` and
  `quantity` on it as the user would, re-ingest the same `external_id`, assert the
  enrichment **survives** and provider fields still update. This pins §7.
- **Backfill tests** on a synthetic ledger: known transactions plus a known end
  balance ⇒ assert the derived series; assert re-running inserts nothing; assert a
  changed historical amount triggers a bounded refill.
- **Gap detection test** — a holding with partial lots reports the right
  `unexplained_quantity`; a fully-explained one reports zero.
- Existing `core/tests/repo_transaction.rs::inserts_once_and_dedups` rewritten:
  it currently asserts on-conflict-do-nothing, and must assert update-in-place.

---

## 12. Implementation order

1. Migration: `description`, indexes, `holding_backfill`.
2. `CanonicalTransaction` fields; `insert_transaction` → upsert with `coalesce`;
   ingest counts; rewrite the existing test.
3. Powens fetch + wire model + mapping + mapping tests.
4. Backfill engine + tests; wire into ingest; snapshot upsert deletes the matching
   backfill row.
5. Transactions page (list, search, filters).
6. Gap detection + Holdings badge + fill-in modal (both flows).
7. Regenerate `.sqlx` offline data (`cargo sqlx prepare --workspace -- --all-targets`).

---

## 13. Phase 2 sketch — budgeting

Not designed yet, deliberately. Recorded here only to show the Phase 1 schema does
not block it.

- **Categories** are ours to build: no provider supplies them (§2.1), so a
  `category_id` on `transaction` plus a user-owned rules/learning layer. Adding a
  nullable column and a reference table is a migration with no backfill — Phase 1
  neither helps nor hinders it.
- **Auto-detection** works on `description`. The strings are messy but rich —
  `SNCF-VOYAGEURS`, `BURGER KING`, `LECLERC`, `AMAZON EU SARL` — and Powens' 17-char
  truncation (§2.1) is the known ceiling on merchant identification.
- **Icons** key off the same extracted merchant name.
- **Budget tab** renames Transactions once there is more on it than a list.

The one thing Phase 2 must not do is re-litigate providers. That research is
closed: no aggregator exposes lots, and the only provider with better
categorisation (Bridge) is sales-gated B2B.
