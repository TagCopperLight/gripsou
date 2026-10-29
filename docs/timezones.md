# Calendar dates and timezones

Each user chooses an IANA timezone in Settings → General. It defaults to
`Europe/Paris` when the preferences have no `timeZone`. It stays fixed when the user travels or uses another browser.
PostgreSQL and the browser apply the zone's daylight-saving rules.

The current calendar day comes from `user_today(user_id)` on the server and
`zonedDay()` in the browser. The server function accepts an optional instant
for deterministic boundary tests. The API validates timezone names before
saving preferences; changing the setting refreshes cached reports.

## Clock-derived dates

- `core/src/ingest.rs`: daily snapshots, including closed holdings.
- `core/src/backfill.rs`: horizon fallback and end of the derived day axis.
- `core/src/repo/query.rs`: holdings and accounts valuations;
  the displayed holding price uses the same day cutoff as its value.
- `core/src/repo/lot.rs`: current-day lot basis previews.
- `api/src/accounts.rs` (`range_window`): dashboard, account and
  holding-price range bounds, including the year for YTD. These are inclusive calendar-day windows.
- `frontend/src/lib/period.ts`: current month and preset date ranges;
  calendar arithmetic is separate from instant-to-day conversion.
- `frontend/src/components/RecordLotsModal.tsx`: new-lot date defaults.
- `frontend/src/components/PageHeader.tsx` and settings date preview: today.
- `frontend/src/lib/date.ts`: real timestamps (sessions, syncs, account creation)
  display in the saved timezone. Relative elapsed times remain elapsed times.

Global market data uses UTC days: Yahoo daily bars are
normalized to UTC midnight, price-sync freshness uses the UTC day, and
composition metadata records a UTC day. These are shared across users and do
not acquire the timezone of whichever user triggered the fetch. Valuation SQL
seeks prices by the requested calendar day's UTC encoding. The
30-day holding sparkline and composition refresh checks are elapsed-time
freshness windows. Session expiry, sync throttles, locks and job schedules
work on instants and durations.

## Provider dates and historical data

Powens supplies date-only values. The adapter uses `rdate` for the spend date
(falling back to `date`) and `date` for the booking date (falling back to
`rdate`). They keep the provider's calendar date. Spend dates are encoded as
UTC midnight in the canonical timestamp column; booking dates are SQL dates.
Budget filtering and backfill extract those calendar dates without shifting
into the user's timezone. Manual lots likewise have SQL calendar dates.

The API encodes daily chart points, lots and transaction dates as epoch
milliseconds. The frontend uses `calendarDay()` / `formatDay()` for these
labels, so midnight does not appear as the previous day west of UTC. Actual
session and sync timestamps use `formatDate()` instead.

A snapshot is dated in the timezone in force when it was taken, and keeps
that date: snapshots store no capture instant, so they can't be redated.
Changing timezone leaves past snapshots, provider transaction dates and global
prices as they are. The derived backfill is rebuilt by the next sync or lot
save.
