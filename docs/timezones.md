# Calendar dates and timezones

Each user chooses an IANA timezone in Settings → General. It defaults to
`Europe/Paris`. It stays fixed when the user travels or uses another browser.
PostgreSQL and the browser apply the zone's daylight-saving rules.

The current calendar day comes from `user_today(user_id)` on the server
(`repo::prefs::today` in Rust) and `zonedDay()` in the browser. Every day
taken from the clock in the user's timezone goes through one of them, so
searching for those names finds them all. The server function accepts an optional instant for
deterministic boundary tests. The API validates timezone names before saving
preferences; changing the setting refreshes cached reports.

Date ranges (`Range::window` on the server, `lib/period.ts` in the browser) are
inclusive calendar-day windows, and their calendar arithmetic is separate from
instant-to-day conversion. Real timestamps (sessions, syncs, account creation)
display in the saved timezone (`lib/date.ts`); relative elapsed times remain
elapsed times.

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
