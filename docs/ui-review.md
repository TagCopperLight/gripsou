# UI review (#61)

Every screen of gripsou, every state it can be in, and what the review found. Built from the code (each branch a component renders), not from use: many states only show when something goes wrong.

## How to use

Run the review mode: `cd frontend && bun run dev:mock` (no backend, no database). The app runs on an in-memory fake API (`frontend/mock/`) holding one healthy household. The panel at the bottom left:

- **States · <piece>**: the states of the piece under review (`FOCUS` in `mock/states.ts`). States that can't be on together share a `group` and show as one segmented control ("Base" turns the group off); the others are checkboxes. Changing one rebuilds the data and reloads.
- **Reset data**: back to the base household (keeps the active states and the App settings).
- **Sign out / Sign in**: to reach the login, invite and reset screens.
- **EN / FR**, **EUR / USD / GBP**: saved through the app's own prefs endpoint.
- **admin / user**: the signed-in user's role.
- **Queries**: keep any request loading forever, or make it fail with a 500. A failing query shows its error only after React Query's three retries (about 7 s), as in production.
- A ⚠ count in the header lists API calls the fake API does not answer yet (501).

"How to reach" below says **base** (the default data), **query** (a Queries override), **state** (a panel state, added when the screen is reviewed) or **action** (something to click).

Findings are tagged by who raised them, and get an outcome: **fixed**, **deferred** (with where it went) or **won't fix** (with why).

## Shared pieces

Used on many screens; a change here changes them all.

| Piece | Where | States |
|---|---|---|
| `RootLayout`, `Sidebar` | every signed-in page | admin / member label under the name; version line (from `/health`) |
| `SyncButton` + `SyncModal` | top right of every signed-in page | idle; spinning (a connection `syncing`/`awaiting`); red dot (a connection in `error`); amber dot (a health warning: stale, unknown, provider error) · modal: loading, no connections, per-connection rows (`ConnectionRow`) |
| `ConnectionRow` | sync modal, Settings · Connections | status tag: connected / syncing / waiting / pending / error (shows `lastError` as the tag text) / stale / partial / needs attention; amber health box per issue; expanded account list; "manage" popup blocked; manage failed |
| `PageHeader` | Dashboard, Accounts, Investments, Budget | today's date + title |
| `CardState` | most cards | loading (spinner + "Loading…"); error ("Can't reach the server" + Retry) |
| `Dialog` / `Modal` / `ConfirmDialog` | every modal | busy, error line |
| `PrivateMoney` | net-worth headline | private mode on: masked, eye to reveal |
| `HoldingBadge` | holdings, connections | logo image, or coloured initials |

## Screens

### Dashboard `/`

Components: `PageHeader`, `NetWorthCard` (`NetWorthChart`, `ChartLegend`, `SegmentedControl`), `DistributionCard` (`ExposureDonut`), `HoldingsCard` → `AssetModal` (`HoldingModalHeader`, `IncompleteHistoryStrip`, `CompositionSurface`) and `RecordLotsModal`.

| State | How to reach |
|---|---|
| Net worth: loading / error | query `/dashboard/net-worth` |
| Net worth: gain up / down over the range | base (up); state for down |
| Net worth: a holding has no exchange rate, left out (`fxMissing`): asterisk + footnote, one holding named / several counted | state "No rate" (1 ETF / 2 ETFs) |
| Net worth: no accounts: nothing connected / first sync running / connected but nothing came in | state |
| Net worth: private mode, masked / revealed | Settings · General → private mode |
| Value / % unit; ranges 7D…Max | action |
| Distribution: loading / error / no accounts | query `/accounts`; state for empty |
| Distribution: asterisk on the total and the account (`fxMissing`) | state "No rate" |
| Holdings: loading / error | query `/holdings` |
| Holdings: no holdings at all | state |
| Holdings: search with no match | action |
| Holdings: account-type filter chips | base |
| Holdings: amber dot, lots don't explain the quantity (short / excess) | state |
| Holdings: no rate, value shown in its own currency with an asterisk, no gain/loss | state "No rate" |
| Holdings: cash aggregated over several accounts ("Multiple accounts") | base |
| Asset modal: asset / purchases tabs, prices loading / error, no purchases, composition | action; query `/holdings/:id/prices`, `/transactions` |
| Asset modal: incomplete-history strip (short / excess) | state |
| Record lots modal: loading / error, empty, suggested rows, provisional figures, save error, invalid row | action; state; query |

Findings:

| # | Finding | By | Outcome |
|---|---|---|---|
| D1 | The range labels are raw codes in both languages ("over 6mo", "sur 6mo"; buttons "1mo", "ytd", "max"). | Claude | fixed: one list of ranges (`lib/ranges.ts`), labels in i18n ("7D…Max", "over 6 months" / "sur 6 mois", "since January 1") |
| D5 | The 24h range is useless (daily data: two points). | User | fixed: removed from every range picker and from the API |
| D6 | The legend stays green when the line turns red on a loss, in value and % mode (also the tooltip swatch, and the asset modal's legend). | User | fixed: legend and tooltip read their colour off the plotted series (`lib/valueChart.ts`) |
| D2 | `DistributionCard` with no accounts shows an empty ring and "Total 0 €" with no message; with every account at zero it divides by a zero total (NaN shares). | Claude (code) | |
| D3 | `HoldingsCard` has no empty state: no holdings, or a search with no match, leaves a bare table header. | Claude (code) | |
| D7 | With no accounts the net worth card shows a big "0 €", a green "+0 € (+0 %)" pill, a flat line at zero and range / unit switches that do nothing. Reached by skipping the bank step in Welcome, deleting the last connection, or right after connecting. | User | fixed: the card keeps its title and height; headline, pill, legend and switches go; the chart area says why it is empty (`NetWorthEmpty`, same look as `InvestmentsEmpty`). Picked from three layouts (full height / compact strip / ghost line): full height, so the dashboard doesn't jump when accounts arrive, and no made-up line that could read as data. |
| D8 | "Connect a bank" is wrong right after connecting: the first sync is still running. | User | fixed: three cases read off the connections (`lib/netWorthEmpty.ts`): none → "No accounts yet" + Connect a bank; one syncing / awaiting / pending → "Syncing in progress", spinner, no button; all settled with still no account (failed first sync, or a bank with only loans and cards, which are skipped) → "No accounts found" + Manage connections. Both buttons go to Settings · Connections. French reworded by the user's review (first draft read badly). |
| D9 | The fake API sent a zero point per day with no accounts; the server sends no points at all (`NetWorthResponse::from_rows` on no rows). The card keys its empty state on that. | Claude (code) | fixed in `mock/views/portfolio.ts` |
| D10 | Distribution and Holdings are empty for the same reason (D2, D3): an empty ring and a bare table header under the net worth message. | User | fixed: with no accounts (`/accounts` answers `[]`) the dashboard shows only the net worth card, which becomes the dashboard's get-started message. While accounts load or fail, both cards stay and show their own state. D2 / D3 still matter for their other cases (every account at zero, a search with no match). |
| D11 | The green primary button pulls harder than the message in an empty state. | User | fixed: new `outline` variant of `Button` (thin border, transparent, hover fill), picked from four (small grey, text link, outline, solid grey). Use it for empty-state actions. |
| D12 | Private mode masked the net worth but left the gain amount in the pill readable, which gives most of it away. | User | fixed: the gain is masked too, the % stays; one eye per card reveals both (`usePrivacy`, `MaskedMoney`) |
| D13 | The exchange-rate warnings look bad and are inconsistent: a ⚠ with a long tooltip on some figures, an amber box elsewhere, long sentences. | User | fixed: one treatment everywhere (`FxNote.tsx`): a small amber asterisk on each figure something is missing from (hover gives the reason) and a short footnote in the same card, right under the figure it explains. Picked over a line under the figure and a chip. See the cross-screen row. |
| D14 | Changing the display currency did not fetch its rate: until the next sync every figure stayed in euros while wearing the new symbol (`reportingFxMissing`). | User | fixed at the source: saving a new currency fetches its rate first (`price_sync::ensure_fx_rate`, at most 10 s); if none can be had the change is refused and the old currency stays. The "shown in the base currency" notice and `reportingFxMissing` are removed everywhere (API, queries, UI). |
| D15 | A holding with no rate showed "0,00 €" with a ⚠: true for the totals, useless to read. | Claude | fixed: it shows its value in its own currency (`valueNative`, e.g. "4 812,30 $*"), dimmed, with no gain/loss; the footnote says it isn't counted. The net worth footnote names it: "Excludes ESE (4 812,30 $): no USD rate yet." |

### Accounts `/accounts`

Components: `PageHeader`, `AccountsChartCard` (`StackedAreaChart`), `AccountsList` → `AccountsSummaryCard`, `ConnectionAccountsCard` → `EditAccountModal`.

| State | How to reach |
|---|---|
| Chart: loading / error (net worth or series) | query `/dashboard/net-worth`, `/accounts/series` |
| List: loading / error | query `/accounts` |
| List: no accounts | state |
| Connection card: never synced / synced x ago; unknown source name | state |
| Account: asterisk on an account a holding with no rate is left out of, footnote under the connection card | state "No rate" |
| Account: foreign currency with native value shown | state |
| Edit account modal: saving, save error | action; query (PATCH) |

Findings:

| # | Finding | By | Outcome |
|---|---|---|---|
| A1 | Same raw range labels as D1 (`AccountsChartCard` keeps its own copy of `RANGE_LABEL`). | Claude (code) | fixed with D1 |

### Investments `/investments`

Components: `PageHeader`, `AnnualisedReturnCard`, `ReturnsCard` (`ReturnSpan`), `ExposureDonut` ×3 (regions, sectors, indices), `InvestmentsEmpty`.

| State | How to reach |
|---|---|
| Loading skeleton cards / error | query `/investments/returns`, `/holdings` |
| No investments (empty) | state |
| Annualised return unknown (null) | state |
| Account with missing purchases (dot, "no return") | state |
| Span: days / months / years | base + state |
| Exposure donuts: asterisk on the total, footnote, when a security has no rate | state "No rate" |

### Budget · Overview `/budget/overview`

Components: `Budget` (mode switch, review badge), `PeriodLine` (+ `RangeModal`), `AiBanner`, `FiguresSurface` (`Comparison`), `SankeySurface`, `BreakdownSurface`, `TrendSurface`, `EmptyPeriodSurface`.

| State | How to reach |
|---|---|
| Loading / error (summary, trend) | query `/budget/summary`, `/budget/trend` |
| Month vs custom range; step back / forward disabled at the ends | action |
| Comparisons shown / absent (under 3 months of history) | base / state |
| Empty period, with or without "earlier" | action (step back past the data) |
| Some rows have no rate: asterisk on income / expenses / net, footnote in the figures card | state "Budget: a transaction has no rate" |
| Sankey: not spent / drawn from savings / exactly zero | base / state |
| AI banner: running, review needed, last run failed | base (review); state |
| Review tab badge (count) | base |

### Budget · Transactions `/budget/transactions`

Components: `SearchSurface`, `FilterPanel`, `ActiveFilterChips`, `TransactionsTable` (`TransactionRow`, `TransactionAvatar`, `CategoryChip`, `TagCell`), `SelectionBar`, `CategoryChooser`, `TagChooser`, `EntityChooser`, `Popover`, `BreakPairModal`, apply-to-all dialog.

| State | How to reach |
|---|---|
| Loading / error | query `/transactions` |
| Nothing at all / no match (clear filters) | state / action |
| Paging: load more, loading more | base (271 rows) |
| Row kinds: cash, lot (buy), auto-paired transfer (dimmed), orphan transfer | base / state |
| Category chip: user / AI / pair / needs review / none | base |
| ✓ column on (pref) | Settings · Budget |
| Selection bar: n selected, bulk category, tags, mark checked | action |
| Select all shown disabled on the lots bucket | action |
| Pair break confirmation | action (recategorise a paired row) |
| "Apply to all with this description" offer | action |
| Bulk updated toast | action |

### Budget · Review `/budget/review`

Components: `ReviewProgress`, `ReviewLine`, `ResolvedLine`, `CategoryChooser`, `BreakPairModal`.

| State | How to reach |
|---|---|
| Queue with lines; "hides money" warning on a neutral guess | base / state |
| Resolved line: undo, apply to others, applied to n | action |
| Empty queue | action (resolve all) / state |
| Load more | state (many) |

### Settings · General `/settings/general`

Language and region, number/date/currency formats, private mode. States: saving, save failure (prefs restored from server). Currency: "Getting the USD rate…" while saving; refused when no rate can be had (red line, old currency kept): state "Currency change can't get its rate".

### Settings · Account `/settings/account`

Components: `Avatar`, `EditProfileModal`, `ChangePasswordModal`, `TotpSetupModal`, `ManageTwoFactorModal`, `BackupCodes`, `PasskeysModal`, `AddPasskeyModal`, `SessionDetailModal`, `DeleteAccountModal`, `useReauthStep`.

| State | How to reach |
|---|---|
| Two-factor off / on (recovery codes left) | base / state |
| Passkeys none / some | base / state |
| Sessions: current only / others (revoke one, revoke all) | base |
| Re-authentication step, wrong password, throttled | action |
| Delete account: pending, wrong password, too many attempts | action |

Findings:

| # | Finding | By | Outcome |
|---|---|---|---|
| AC1 | Sessions and two-factor status have no loading or error state: the list is just empty while loading or when the request fails. | Claude (code) | |

### Settings · Connections `/settings/connections`

Components: `ConnectionRow`, `AddConnectionModal`, `ConnectionGuide`, `DeleteConnectionModal`.

| State | How to reach |
|---|---|
| Loading / error / no connections | query `/connections`; state |
| Every `ConnectionRow` status (see shared pieces) | state |
| Add connection: providers loading, init error | query |
| Delete connection confirmation | action |

### Settings · Budget `/settings/budget`

Components: `AiSurface`, `CategoriesSurface` (`CategoryModal`, `DeleteCategoryModal`, `CategoryIcon`, `ColorSwatchGrid`), `TagsSurface` (`TagRow`, `DeleteTagModal`), `ListPrefsSurface`.

| State | How to reach |
|---|---|
| AI not configured by the admin (disabled toggle) | state |
| Categories: loading / error / empty; archived; system row locked; reorder | query; base |
| Tags: loading / error / empty; create error | query; state |

### Settings · Users `/settings/users` (admin)

Components: `Avatar`, `UserDetailModal`, `LinkModal` (invite), `ResetLinkModal`, `DeleteUserModal`.

| State | How to reach |
|---|---|
| Loading / error | query `/users` |
| Self row (no actions), other rows, role toggle | base |
| Invite link, reset link, delete user | action |
| Seen as a member (route still reachable?) | panel role "user" |

### Settings · Server `/settings/server` (admin)

Components: providers list (`Toggle`), `AiServerSurface`, `AiCostSurface`.

| State | How to reach |
|---|---|
| Providers loading / error | query `/providers` |
| AI provider unset / set; models loading / error / none | base / state / query |
| Cost: no usage; unpriced model | state |

### Login `/login`

Steps: password → code (TOTP) / backup code / passwordless (passkey). Errors: invalid credentials, too many attempts, wrong code, challenge expired, passkey refused.

### Invite `/invite/:token`, Reset `/reset/:token`

Form, password too short, passwords differ, email exists (invite), invalid or expired link.

### Welcome `/welcome`

Three steps: profile, bank (connect, connection status ok / error / connecting / syncing), AI. Back from the bank callback (`?step=bank`). Finish error.

### Connection callback `/connections/callback`

Success redirect; failure (missing id or provider error).

## Cross-screen fixes

Issues met on one screen and fixed everywhere at once, so later screens reuse them.

| Fix | Screens touched |
|---|---|
| One range list with localized labels, no 24h (D1, D5) | Dashboard net worth, Accounts chart, asset modal |
| Chart legend and tooltip coloured like the line (D6) | Dashboard net worth, asset modal |
| Private mode masks the gain amount with the headline, one eye per card (D12) | Dashboard net worth, Accounts chart |
| No-accounts empty state that tells "nothing connected", "first sync running" and "nothing came in" apart (D7, D8; `lib/netWorthEmpty.ts`). Reuse for the Accounts page, whose chart still shows "0 €" and a green "+0 €" pill with no accounts. | Dashboard (Accounts to do) |
| `Button variant="outline"` for an empty state's action (D11) | Dashboard net worth; to use on other empty states |
| Missing exchange rate: `FxAsterisk` on the figure + `FxFootnote` in the same card (`ExcludedNote` names one holding or counts several; `lib/fxNote.ts`). A currency change fetches its rate or is refused, so "figures in the wrong currency" no longer exists (D13–D15). | Dashboard net worth, distribution, holdings; Accounts; Investments donuts; Budget overview figures; Settings · General |
