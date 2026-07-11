# gripsou — Transactions (backend ingestion)

> Plan for syncing bank transactions from Powens into the canonical
> `transaction` table. **Backend ingestion only** — no Transactions-page UI in
> this pass. Read alongside `ARCHITECTURE.md` (§3.2 schema, §4 provider ACL, §5
> sync flow); this document only covers the transaction-specific deltas.
>
> The design is **general (provider-agnostic), validated against real Powens
> data** (2,227 transactions across 3 connections — see §2). Powens populates the
> cash subset; the table keeps the unified-model columns a future broker/manual
> entry would fill, with no further migration.

---

## 1. Scope

In:

- Fetch and ingest **bank transactions** — `GET /users/me/transactions`.
- **Settled-only, upsert-on-change** (see §4).

Out (YAGNI / not supported by the data — see §2):

- `/marketorders` and investment buy/sell lots. The endpoint returns **0 rows**
  for every connection, and the `market_order`/`profit` rows that do appear in
  `/transactions` carry **no instrument link** (wording is just
  `"ACHAT COMPTANT <date>"` / `"COUPONS <date>"`). So instrument-linked lots and
  the asset-modal "purchases staircase" are **not achievable from Powens**; the
  staircase stays on the degraded `holding.cost_basis` path (ARCHITECTURE §3.4).
  The table still *supports* lots (see §3) for a future provider that reports
  them — Powens just leaves those columns null.
- A `category` column / PFM taxonomy. Powens returns `id_category = 9998`
  (uncategorized) for 100% of rows; categorization isn't enabled. Deferred to the
  proper category design (ARCHITECTURE leaves it out on purpose).
- Any Transactions-page UI; pending-row reconciliation; custom name-scrubbing;
  incremental sync; transaction logos; multi-currency.

---

## 2. What the real data showed

Dumped via a throwaway explorer (`providers/examples/dump_transactions.rs`,
deleted before implementation — see §8). ~2,230 transactions.

> **Caveat:** this is the Powens **sandbox** connector (`gripsou-sandbox.biapi.pro`,
> demo user). A production connector *might* populate `/marketorders`. The design
> deliberately doesn't depend on it — the table keeps the general lot columns
> ready (§3), so if a real connector ever returns market orders we can map them
> with no migration. But for the current setup, instrument-linked lots are simply
> absent.


| Finding | Consequence |
|---|---|
| `/marketorders` = 0 rows on all 3 connections (user/account/connection routes), and unchanged after a fresh sync | Drop market orders; no instrument-linked lots. |
| `market_order`/`market_fee`/`profit` exist in `/transactions` but with no ISIN/name; `/transactions/{id}?expand=…` adds no instrument field either | Investment activity ingests as plain cash lines (instrument null). |
| `market_fee` rows are actually `"INTERETS 2024/2025"` with **positive** values | The Powens `type` lies about direction — map by sign of `value`, not by trusting `type` (see §6.2). |
| `id_category` = 9998 for 100% of rows | No `category` column. |
| `rdate`, `date`, `application_date` 100% filled; `datetime` only 4% | `ts = rdate ?? date` is solid; ignore the datetime variants. |
| `value`, `wording`, `simplified_wording`, `original_wording` 100% | `amount = value`, `description = wording`. |
| `coming = true` on 3/2,227; `deleted` 0 | Settled-only is trivially safe; pending is negligible. |
| `gross_value`, `original_*`, `commission`, `country`, `details`, `comment`, `id_cluster` 0%; `card` = "Not loaded"; `counterparty` 1% | All noise — none become columns; raw payload kept in `provider_meta` for forensics only. |

---

## 3. Schema delta

The existing `transaction` table is already general and correct (unified-model
lot columns `instrument_id`/`quantity`/`unit_price`/`fee` stay for future
providers). The **only** missing field is a queryable display name:

```sql
-- migrations/0010_transaction_description.sql
alter table transaction add column description text;  -- cleaned wording
```

`description` is what the list renders and what search matches — a column, not
JSONB. `provider_meta` holds the **raw** Powens transaction for debugging only;
nothing the app reads lives there.

**Deliberately deferred** (pure migrations, no backfill — add when the access
pattern is real):

- Indexes `(account_id, ts)` and a trigram index on `description` — with the
  list/search query when the UI lands.
- `updated_at` — possible now that we upsert, but no feature needs it.
- `category` and any PFM taxonomy — see §1.

---

## 4. Ingest: insert → upsert

`core/repo/transaction.rs` changes from immutable insert (on-conflict-**do-
nothing**) to **upsert**, so provider-side corrections propagate:

```sql
insert into transaction
    (account_id, instrument_id, ts, type, quantity, unit_price, amount, fee,
     description, external_id, provider_meta)
values (...)
on conflict (account_id, external_id) where external_id is not null
do update set
    instrument_id = excluded.instrument_id,
    ts            = excluded.ts,
    type          = excluded.type,
    quantity      = excluded.quantity,
    unit_price    = excluded.unit_price,
    amount        = excluded.amount,
    fee           = excluded.fee,
    description   = excluded.description,
    provider_meta = excluded.provider_meta
returning (xmax = 0) as inserted;  -- distinguish insert from update for counts
```

- `account_id` + `external_id` are the stable conflict key.
- `ingest()` resolves `txn.instrument` to an `instrument_id` via the existing
  `resolve_instrument` **when present** (general path); Powens always passes
  `None`, leaving it null.
- `IngestSummary` gains `transactions_updated` alongside `transactions_inserted`.
- The existing "immutable / do-nothing" test in `core/tests/repo_transaction.rs`
  is rewritten to assert the row **updates** on re-ingest.

---

## 5. DTO change

`core/dto.rs` — `CanonicalTransaction` gains two fields (`instrument` for the
general lot path, `description` for the display name). Everything stays `Option`
so a cash-only provider like Powens fills only the cash subset:

```rust
pub struct CanonicalTransaction {
    pub account_external_id: String,
    pub external_id: String,
    pub kind: String,                       // maps to `type`
    pub ts: DateTime<Utc>,
    pub instrument: Option<InstrumentRef>,  // None for Powens; Some for a lot-reporting provider
    pub quantity: Option<Decimal>,
    pub unit_price: Option<Decimal>,
    pub amount: Decimal,
    pub fee: Option<Decimal>,
    pub description: Option<String>,        // cleaned wording
    // provider_meta (raw payload) is assembled in the adapter, passed through ingest
}
```

---

## 6. Powens fetch & mapping

### 6.1 Fetch — `GET /users/me/transactions`

- **Relational pagination**: `limit` required (max 1000); follow `_links.next`
  to exhaustion. **Full-fetch every sync** — `last_update` returns only edited
  rows and cannot backfill, so incremental is unsafe; full-fetch + dedup is
  idempotent. `// ponytail: full history fetch; add a min_date window if payloads
  get large` (largest connection observed: 1,916 rows).
- Keep only `coming == false` (the default list already excludes `deleted`).
- New wire model in `model.rs`; pure mapping in `map.rs`.

### 6.2 Mapping rules

- **`ts`** = `rdate` if present, else `date`.
- **`description`** = `wording` (fallback `simplified_wording`).
- **`amount`** = `value`.
- **`type`** = **sign-led, not type-led.** Direction comes from the sign of
  `value` (`< 0` → out, `≥ 0` → in); the Powens `type` is only consulted to pick
  a *semantic category* that the sign can't express. This is deliberate: the
  Powens `type` is unreliable for direction (observed: `market_fee` rows are
  positive `"INTERETS"`, i.e. interest, not a fee), and Powens warns new types
  may appear. Rules, in order:

  | Powens `type` | gripsou `type` |
  |---|---|
  | `transfer`, `order` | `transfer` |
  | `profit` | `dividend` |
  | `market_fee` | `interest` if `value ≥ 0` else `fee` |
  | `bank`, `fee` | `fee` |
  | `market_order` | `buy` if `value < 0` else `sell` (instrument null) |
  | everything else (`card`, `check`, `payback`, `payment`, `withdrawal`, `deposit`, `unknown`, *any future type*) | sign of `value`: `< 0` → `withdrawal`, else `deposit` |

- **`instrument`, `quantity`, `unit_price`, `fee`** = `None` (Powens reports no
  per-line instrument or fee; `market_fee` is its own row mapped to `type = fee`).
- **`provider_meta`** = the raw Powens transaction JSON (debug only).
- `map_sync` now populates the `transactions` vec (currently always empty).

---

## 7. Testing

- **Mapping test** against a recorded `/transactions` fixture built from the real
  dump (anonymised), covering `card`, `transfer`, `profit`, `market_order`, and an
  `unknown`/novel type for the sign fallback → canonical DTOs. Proves JSON→DTO
  without a live account.
- **Ingest integration test** (throwaway Postgres): ingest a transaction, then
  re-ingest the same `external_id` with a changed `amount`/`description` → assert
  one row, updated in place, and `transactions_updated` counted.
- Existing `repo_transaction.rs` immutability test rewritten for upsert.

---

## 8. Implementation order

1. Migration `add column description`.
2. `CanonicalTransaction` DTO fields + `insert_transaction` → upsert; `ingest()`
   instrument resolution and updated-count; rewrite the existing test.
3. Powens fetch + wire model + mapping + mapping test (fixture from the real dump).
4. Delete the throwaway explorer and revert its dev-deps:
   `providers/examples/dump_transactions.rs` and the `sqlx`/`dotenvy` lines in
   `providers/Cargo.toml`.
5. Regenerate `.sqlx` offline data after the query changes.
