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
| `RootLayout`, `Sidebar` | every signed-in page | admin / member label under the name; version line (from `/health`). Reviewed: validated as is. |
| `SyncButton` + `SyncModal` | top right of every signed-in page (reviewed: D50–D59) | idle; spinning (a connection `syncing`/`awaiting`); red dot (a connection in `error`); amber dot (a health warning: stale, unknown, provider error) · modal: loading, no connections, per-connection rows (`ConnectionRow`). States "Sync · Connections": every status at once, one syncing, one failed, outdated data, none; Sync all and each row's sync spin for 4 s then come back healthy. |
| `ConnectionRow` | sync modal, Settings · Connections | line under the name: synced x ago / syncing / waiting / connecting / sync failed (red, `lastError` on hover) / outdated / partial / needs attention (amber); red or amber dot on the logo; open: one line per problem under the accounts; expanded account list; "manage" popup blocked; manage failed |
| `PageHeader` | Dashboard, Accounts, Investments, Budget | title, centred above the first surface (Budget: with its mode switch) |
| `CardState` | most cards | loading (spinner + "Loading…"); error (`ErrorState`: red icon, "Couldn't load this", Retry; E1) |
| `ErrorToasts` (`showError`, `useErrorToast`) | bottom-right corner of every page | a failed action, for 5 s or until closed (E1). Mock states "Errors": nothing loads, every save fails, the pages showing accounts break |
| `Dialog` / `Modal` / `ConfirmDialog` | every modal | busy; an error line for what the user typed (a server failure goes to the corner, E1) |
| `PrivateMoney` | net-worth headline | private mode on: masked, eye to reveal |
| `HoldingBadge` | holdings, connections | logo image, or coloured initials |

## Screens

### Dashboard `/`

Components: `PageHeader`, `NetWorthCard` (`NetWorthChart`, `ChartLegend`, `SegmentedControl`), `DistributionCard` (`ExposureDonut`), `HoldingsCard` → `AssetModal` (`HoldingModalHeader`, `IncompleteHistoryStrip`, `CompositionSurface`) and `RecordLotsModal`.

| State | How to reach |
|---|---|
| Net worth: loading / error | query `/dashboard/net-worth` |
| Net worth: gain up / down over the range | base (up); state for down |
| Net worth: a holding has no exchange rate, left out (`fxMissing`): asterisk + footnote counting the holdings left out | state "Two dollar ETFs have no rate" |
| Net worth: no accounts: nothing connected / first sync running / connected but nothing came in | state |
| Net worth: private mode, masked / revealed | Settings · General → private mode |
| Value / % unit; ranges 7D…Max | action |
| Distribution: loading / error / no accounts | query `/accounts`; state for empty |
| Distribution: asterisk on the total and the account (`fxMissing`) | state "Two dollar ETFs have no rate" |
| Distribution: an overdrawn account (no slice, no %, amount in red) | state "Checking account overdrawn" |
| Distribution: an account at 0 € (listed, no %); a tiny one ("<0,1 %"); many accounts, long names | states "An account at 0 €", "12 accounts" |
| Distribution: every account at 0 € (grey ring, no %) | state Data → Zero |
| Distribution: private mode, amounts masked, % kept, eye by the title | state "Private mode on" |
| Holdings: loading / error | query `/holdings` |
| Holdings: no holdings at all | state |
| Holdings: search with no match | action |
| Holdings: account-type filter chips; under a filter the cash line is that type's cash | base |
| Holdings: many holdings in a second account, long names, fractional quantities | state "Life insurance with 7 funds" |
| Holdings: private mode, values and gains masked, % kept | state "Private mode on" |
| Holdings: amber dot, lots don't explain the quantity (short / excess) | state |
| Holdings: no rate, value shown in its own currency with an asterisk, no gain/loss | state "Two dollar ETFs have no rate" |
| Holdings: cash aggregated over several accounts ("Multiple accounts") | base |
| Asset modal: asset / purchases tabs, prices loading / error, no purchases, composition | action; query `/holdings/:id/prices`, `/transactions` |
| Asset modal: incomplete-history strip (short / excess) | state |
| Asset modal: a sale in the history (Sell tag, positive amount) | state "CW8: 2 shares sold last month" |
| Asset modal: no composition (no bars) | state "ESE has no composition" |
| Asset modal: no rate (native value with asterisk, no P/L, no share of net worth) | state "Two dollar ETFs have no rate" |
| Asset modal: private mode (amounts masked, purchases chart in % only) | state "Private mode on" |
| Asset modal: below `xl` the chart stacks over the stats; full screen on a phone | resize |
| Record lots modal: loading / error, empty, suggested rows, provider (locked) rows, provisional figures, save error, invalid row | action; state (`FOCUS = "Record purchases"`); query |

Findings:

| # | Finding | By | Outcome |
|---|---|---|---|
| D1 | The range labels are raw codes in both languages ("over 6mo", "sur 6mo"; buttons "1mo", "ytd", "max"). | Claude | fixed: one list of ranges (`lib/ranges.ts`), labels in i18n ("7D…Max", "over 6 months" / "sur 6 mois", "since January 1") |
| D5 | The 24h range is useless (daily data: two points). | User | fixed: removed from every range picker and from the API |
| D6 | The legend stays green when the line turns red on a loss, in value and % mode (also the tooltip swatch, and the asset modal's legend). | User | fixed: legend and tooltip read their colour off the plotted series (`lib/valueChart.ts`) |
| D2 | `DistributionCard` with no accounts shows an empty ring and "Total 0 €" with no message; with every account at zero it divides by a zero total (NaN shares). | Claude (code) | fixed: no accounts by D10, every account at zero by D17 |
| D3 | `HoldingsCard` has no empty state: no holdings, or a search with no match, leaves a bare table header. | Claude (code) | fixed: no holdings by D10; a search with no match says "No asset matches "xyz"." (D24) |
| D7 | With no accounts the net worth card shows a big "0 €", a green "+0 € (+0 %)" pill, a flat line at zero and range / unit switches that do nothing. Reached by skipping the bank step in Welcome, deleting the last connection, or right after connecting. | User | fixed: the card keeps its title and height; headline, pill, legend and switches go; the chart area says why it is empty (`NetWorthEmpty`, same look as `InvestmentsEmpty`). Picked from three layouts (full height / compact strip / ghost line): full height, so the dashboard doesn't jump when accounts arrive, and no made-up line that could read as data. |
| D8 | "Connect a bank" is wrong right after connecting: the first sync is still running. | User | fixed: three cases read off the connections (`lib/netWorthEmpty.ts`): none → "No accounts yet" + Connect a bank; one syncing / awaiting / pending → "Syncing in progress", spinner, no button; all settled with still no account (failed first sync, or a bank with only loans and cards, which are skipped) → "No accounts found" + Manage connections. Both buttons go to Settings · Connections. French reworded by the user's review (first draft read badly). |
| D9 | The fake API sent a zero point per day with no accounts; the server sends no points at all (`NetWorthResponse::from_rows` on no rows). The card keys its empty state on that. | Claude (code) | fixed in `mock/views/portfolio.ts` |
| D10 | Distribution and Holdings are empty for the same reason (D2, D3): an empty ring and a bare table header under the net worth message. | User | fixed: with no accounts (`/accounts` answers `[]`) the dashboard shows only the net worth card, which becomes the dashboard's get-started message. While accounts load or fail, both cards stay and show their own state. D2 / D3 still matter for their other cases (every account at zero, a search with no match). |
| D11 | The green primary button pulls harder than the message in an empty state. | User | fixed: new `outline` variant of `Button` (thin border, transparent, hover fill), picked from four (small grey, text link, outline, solid grey). Use it for empty-state actions. |
| D12 | Private mode masked the net worth but left the gain amount in the pill readable, which gives most of it away. | User | fixed: the gain is masked too, the % stays; one eye per card reveals both (`usePrivacy`, `MaskedMoney`) |
| D13 | The exchange-rate warnings look bad and are inconsistent: a ⚠ with a long tooltip on some figures, an amber box elsewhere, long sentences. | User | fixed: one treatment everywhere (`FxNote.tsx`): a small amber asterisk on each figure something is missing from and a short footnote in the same card (net worth: under the chart). No tooltip on the asterisk. The asterisk hangs past the figure's right edge, so a marked figure stays aligned with the unmarked ones. Picked over a line under the figure and a chip. See the cross-screen row. |
| D14 | Changing the display currency did not fetch its rate: until the next sync every figure stayed in euros while wearing the new symbol (`reportingFxMissing`). | User | fixed at the source: saving a new currency fetches its rate first (`price_sync::ensure_fx_rate`, at most 10 s); if none can be had the change is refused and the old currency stays. The "shown in the base currency" notice and `reportingFxMissing` are removed everywhere (API, queries, UI). |
| D16 | Distribution with an overdrawn account: it vanished from the ring, the legend said "−6,8 %", and the other shares added to more than 100 %. | Claude | fixed: shares are of what the accounts own (`lib/distribution.ts`), so they add to 100 %; an account at or below zero has no slice and no %, its amount in red. The middle still shows the net worth, overdrafts included, so it matches the net worth card. |
| D17 | Every account at 0 € showed "NaN%" on each row (D2's second case). | Claude | fixed: a plain grey ring, "Total 0 €", rows with their amount and no %. |
| D18 | Private mode masked the net worth but the distribution showed the same figure in the middle, in clear, with every account's amount. | Claude | fixed: amounts and the middle masked, % kept, one eye right after the title (as on Holdings) (`PrivacyEye`, shared with `PrivateMoney`). Same rule as D12. |
| D19 | A small account read "0 %". | Claude | fixed: "<0,1 %" below what one decimal shows (`formatShare`, also on the Investments donuts). Accounts at 0 € stay listed (user's choice). |
| D60 | Distribution ring: accounts of 1 % or less drew slivers too thin to see or hover. | User | fixed: left out of the ring (`MIN_DRAWN_SHARE`, `isDrawn`, `ExposureDonut` `minSlice`); the other slices fill the space by themselves, as the ring draws proportions of what's in it. The legend still lists them with their real share. Same on the Accounts page (A20). |
| D61 | Asset window: the "Purchase history" title is too long for a list that holds sales too. | Claude | fixed: "History" / "Historique". |
| D21 | "PEA PEA" when an account is named after its type. | Claude | won't fix: the user keeps the type tag on every row. |
| D22 | The legend's tags followed each name, so they zigzagged; the share and the amount sat close together. | User | fixed: every row has the same column widths (each as wide as its longest entry), so tags, shares and amounts line up; more room before the amount; long names cut with "…" (full name on hover). Also applies to the Investments donuts. |
| D23 | A long name hovered in the donut ran over the ring. | User | fixed: the middle text is kept to the hole's width (from the ring's inner radius), wraps, and is cut with "…" after two lines. |
| D20 | With every account at 0 € the net worth chart's axis reads "1 €, 1 €, 1 €, 0 €, 0 €", with a "+0,00 € (0 %)" pill. | Claude | won't fix: only the labels are off, in a state that almost never happens (accounts present, every one at exactly 0 €) |
| D24 | Holdings: a search with no match left only the column headers. | Claude | fixed: a line under the headers, "No asset matches "xyz"." |
| D25 | Holdings: all cash was one "Euro · Multiple accounts" line, so a "Multiple" chip existed that only ever showed it, and filtering "PEA" hid the PEA's own cash. | Claude | fixed (user's pick of three): the cash is merged after filtering, so "All" shows one Euro line and a filter shows that type's cash only; the chips come from the accounts, so no "Multiple" chip. One cash line per account and leaving cash out were the other options. |
| D26 | Holdings: private mode left every value and gain readable. | Claude | fixed: values and gains masked, gain % and quantities kept, an eye right after the title. The "N assets" count by the title is removed (user). (same rule as D12, D18) |
| D27 | Holdings: "Life insurance" wrapped onto two lines in its tag; a fractional quantity was cut to two decimals (0,0421 → "0,04"). | Claude | fixed: the tag never wraps; quantities show the decimals they have (up to 8) |
| D28 | Holdings: long fund names wrap onto two lines on desktop, so rows have uneven heights. | Claude | fixed by D30 |
| D30 | Holdings' table recalculated its widths from what was shown, wrapped long names, had square hovers and full-width lines, and hid columns on a phone. | User | fixed: built on the transactions table's layout, now one shared piece (`GridTable`, `gridTable.ts`) that Transactions also uses (no visible change there). Fixed column tracks (only the asset column grows; account names and type tags cut with "…"), one-line names with the full name on hover, rounded row hover, inset lines, every row the same height; on a phone every column stays and the table scrolls sideways (user's choice). No match: icon, "No asset matches "xyz".", and a "Clear search" button that also resets the type filter. |
| D29 | The net worth eye sat next to the big figure, while the distribution's and the holdings' sit after the card title. | User | fixed: after the title on the net worth card and on the Accounts page chart too, which shares the headline |
| D31 | Asset window, Purchases tab: the gain pill was the position value's change, so money put in counted as gain (+473 € over a month on a holding down 56 €, because of a 534 € purchase). | Claude | fixed: value change minus what was bought or sold meanwhile; the % is the chart's own window return (`windowReturn`). Test pins it. |
| D32 | Asset window with no exchange rate: "Current value 0,00 €", "P/L +0,00 € (0 %)", "Share of net worth 0 %". | Claude | fixed: its value in its own currency with the asterisk, no P/L, no share, the holdings footnote (same as D15) |
| D33 | Asset window: private mode left every amount in clear. | Claude | fixed: mean price, invested, value, P/L, history prices and amounts masked; the purchases tab's chart (which plots the position's value) shows in % only; the asset tab's unit price stays (public). Eye after the name. |
| D34 | Purchase history: the "Invested" column showed −554 € for a buy and +1 105 € for a sale, nothing else telling them apart. | Claude | fixed (user's pick): a Buy / Sell tag with an up / down arrow after the date, column renamed "Amount" (signs kept: cash out / in); the table is a `GridTable` |
| D35 | Asset window: a fixed 512 px right column that never wraps squeezed the chart on a laptop and made the window unusable on a phone. | Claude | fixed (user's pick): side by side from `xl` (1 280 px; at `lg` the chart shrank to ~340 px, too small), stacked below (chart first); full screen on a phone. Not checked in a browser at small sizes (the preview can't resize). |
| D36 | Composition bars: the computed "Other" remainder was plain grey; the Investments donuts stripe theirs. | Claude | fixed: striped (`STRIPE_CSS`). The mock's funds had their own blue "Other" line, which real Boursorama data never has; removed. |
| D37 | Boursorama now sends two different sectors under one name ("Biens de consommation cycliques" twice, "Finance" twice) on every fund, so the window showed two same-name slices and the Investments page merged them silently. | Claude | fixed in the adapter (user's pick): same-name lines are added together and a `composition names repeated` warning is logged. Stored compositions fix themselves at their 30-day refresh. |
| D38 | Composition half French, half English: Boursorama relabelled its sectors (October 2026: "Finance", "Produits industriels", "Télécommunications", "Biens de consommation cycliques", "Matières non énergétiques"), and the translation table only knew the old labels, so those stayed French in English. The mock's funds used English names production never receives, which hid it (and broke the Investments regions). | User | fixed: the new labels translate to the same names as the old ones in both languages (old kept for older data); the mock's funds use Boursorama's French names; bars sorted largest first, "Other" last (a merged D37 line no longer sits out of order). |
| D39 | Asset window: the chart legend only showed on the Purchases tab. | User | fixed: the Asset tab shows its legend too, in the line's colour: "Unit price", and "Return" in % (the line is then the change since the range's start, as on every chart in %) |
| D40 | The asset window's identity header (badge, provider name in capitals, "ticker · type tag · account"). | User | won't fix: options and tunings drawn on the companion (quiet, ticker first, breadcrumb, account by the tabs; balanced / prominent / compact spacing), kept as is. |
| D41 | Record purchases: private mode left the Summary readable. | Claude | won't fix: the user is typing these amounts; masking them here is useless. |
| D42 | Record purchases: the Summary showed "0,00 €" everywhere until the first preview answered. | Claude | fixed: "—" until the first answer. |
| D43 | Record purchases: a row's type was fixed text, so a purchase entered as a sale meant deleting and re-adding it; two add buttons. | Claude | fixed: one "Add entry" button, a Purchase / Sale switch on each row (a saved row switched counts as a change). |
| D44 | Record purchases: a new row stayed at the bottom whatever its date. | Claude | fixed: rows in date order, re-sorted when a date field is left (never while typing). |
| D45 | "Realised / Unrealised P/L" reads as jargon. | Claude | won't fix: the term is used across the app and the user likes it. |
| D46 | Record purchases: lots a provider sends would be hidden and left out of the bar, and the live preview replaced them too, so the figures while editing would disagree with the saved ones. No provider sends lots yet, but the schema plans for one. | Claude (code) | fixed: provider lots listed locked and counted in the bar; the preview (`basis_preview`) replaces only the user's own lots, as saving does (backend test `preview_keeps_the_provider_lots`). |
| D47 | Record purchases: rows pre-filled from the transactions were slipped into the table, flagged only by a small grey note under it ("3 rows pre-filled…"), hard to read and unclear. | User | fixed: the suggestions wait in a blue "3 purchases found in your transactions" panel above the table (Add, Add all, Dismiss for this opening); an added one joins the table in date order, and binning it puts it back in the panel. Options drawn on the companion: marked rows, dashed until kept, found-then-added (chosen); then three styles of it (the blue one kept), three finishes, and finally a table: the suggestions are read-only rows in the same fixed columns as the table below (shared `LotColumns`), with a light blue Add. The Summary stays pinned at the bottom under a separator while the table scrolls. |
| D48 | Asset window: the incomplete-history strip broke its layout in French (a 50-character button squeezed the text into a narrow column); its texts were long in both languages and always plural. | User | fixed: short texts ("Historique incomplet", "3 titres détenus n'ont aucun achat enregistré.", button "Compléter l'historique"; "Incomplete history" in English), singular and plural. |
| D49 | Every page (Dashboard, Accounts, Investments, Budget) showed today's date above its title: noise, and it pushed the title down. | User | fixed: the date is gone; the title line (and the sync button on it) is centred in the band above the first surface, 24px above and below (PageHeader owns that band, Budget's mode switch included); the button is also level with the Settings title (it was 12px below it). |
| D50 | Sync window: the "2 connections · 1 provider" subtitle and the "POWENS" heading over each provider's connections say nothing useful; the user connects banks, not providers. | User | fixed: no subtitle, one list of every connection whatever its provider. |
| D51 | Connection rows (closed): a green "Connected" tag, then a grey line "Provider · 2 accounts · Synced 2 h ago"; a failed sync showed the raw server error as its tag text, in English, often a whole URL. Too much text, too many tags and dots. | User | fixed after options on the companion (plain words, status on the logo, name alone; the first two merged): one line under the name says "Synced 2 h ago" when all is well, or the problem in colour ("Sync failed" red, the raw error on hover; "Outdated data", "Partial update", "Needs attention" amber; "Syncing…", "Connecting…" grey); a red or amber dot on the logo's corner. No tag, no provider, no account count. The open state is unchanged for now. |
| D52 | Connection rows (open): the lines between accounts were the dialog's background colour, not the vertical bar's; extra space above the first account and below the last; each account's bank date trailed its type tag after a "·", so the dates sat at a different place on every line. | User | fixed: separators in `surface-3` like the bar; less space above the first and below the last account; the bank dates form their own column just left of the amounts, aligned across every bank (the amount column has a fixed width). |
| D53 | Connection rows (open): the accounts read as loose lines; the type tag followed the name, so tags sat at a different place on every line. | User | fixed: a table without a header: colour and name on the left, the type tag right after the name (a column of tags was tried, the user preferred them by the name); the bank date and the amount packed together on the right, the dates lined up from one bank to the next (the amount column is at least 6.5rem, room for 999 999,99 €; a larger amount widens it and moves that bank's dates left by up to ~20px; fixed full-width columns left far too much space). The sync window is a bit wider (680px, new `Dialog wide`; 720px was too wide). |
| D54 | Connection rows (open): hovering the header lights a box running down to the top of the accounts' vertical bar. | User | won't fix, after trying: a box stopping halfway between the logo and the bar (rounded corners, then square), then twice the room under the logo with the box stopping halfway; none looked right, and taking the extra room out again is the original: 16px above the logo, 16px below, the bar right after. |
| D55 | Connection rows: an amber box under the row explained each problem, open or closed, and repeated what the line under the name already says. | User | fixed after options on the companion (under the account, one line on top, a footer with a fix button; the user took the second, placed at the bottom without a separator): closed, only the line and the dot; open, one line per problem under the accounts, a red or amber icon, grey text naming the account first, details (Powens' retry date, the technical error of a failed sync) in faint text under it; the technical error, in English and sometimes several causes long, stays on one line ending in "…", whole on hover. The problem's first line never wraps: a long account name is cut (as in the table above it), the message never is; the icon is centred on the message and its detail line. A failed sync now says "The last sync failed. Try again in a few minutes." Texts still to rework. |
| D56 | Connection rows: a connection still connecting, or with no account and no problem, opened onto an empty panel. | User | fixed: on a computer such a row doesn't open (faded caret, no hover, no hand cursor). A phone still opens it: its open panel holds the actions (sync, manage, delete) the header has no room for. |
| D57 | Connection rows: while a connection syncs, its Manage and Sync buttons are rightly disabled, but looked half-on (40% faded) and still lit up on hover. | User | fixed: a disabled icon button is faded like the caret of a row that can't open (30%), has no hover and doesn't change the cursor (the pointer goes through to the row: a click there opens or closes it); the Sync icon keeps turning. |
| D58 | Sync window, French: stiff or vague texts ("À vérifier", "Données non actualisées", "Dernière mise à jour bancaire", "Le fournisseur a rencontré un problème de synchronisation", "Powens ne signale aucune erreur"), and "Synchronisée il y a 2 h" next to "Jamais synchronisé". Several English texts had the same faults. | User | first pass (both languages where the English was as weak): "Action requise", "Données pas à jour", "Synchronisation en cours…", "Aucune nouvelle donnée de la banque depuis le …", "Nouvel essai automatique le …", "Dernière mise à jour par la banque", "Jamais synchronisée" (its own key, feminine like "Synchronisée"), clearer pop-up and empty-window texts. The unused "Connected" text is removed. Second pass, still too long: "pour continuer", "pour vous reconnecter" and "Relancez une synchronisation" dropped in French only ("… Cliquez sur Gérer."; the English fits and stays whole). A cut account name lost the ": " after it (no space before the message): the separator is now outside the cut, " : " in French, ": " in English. |
| D59 | Connection rows: the problem icons (warning triangle, circle) were drawn at 14px and looked like a different, thinner icon set. | User | fixed: 16px, the size of the app's other icons (20px, as in the banners, was too big). |
| D15 | A holding with no rate showed "0,00 €" with a ⚠: true for the totals, useless to read. | Claude | fixed: it shows its value in its own currency (`valueNative`, e.g. "4 812,30 $*"), dimmed, with no gain/loss; the footnote says it isn't counted. The footnotes only count what is left out ("Excludes 2 holdings: no exchange rate yet."): naming a single holding with its value was dropped as a special case not worth having. |

### Accounts `/accounts`

Components: `PageHeader`, `AccountsChartCard` (`StackedAreaChart`), `AccountsList` → `AccountsSummaryCard`, `ConnectionAccountsCard` → `EditAccountModal`.

| State | How to reach |
|---|---|
| Chart: loading / error (net worth or series) | query `/dashboard/net-worth`, `/accounts/series` |
| List: loading / error | query `/accounts` |
| List: no accounts (hidden, A3) | states "Accounts chart · Data": New, Syncing, Empty |
| Connection card: never synced / synced x ago; unknown source name | state |
| Account: asterisk on an account a holding with no rate is left out of, footnote under the connection card | state "Two dollar ETFs have no rate" |
| Account: foreign currency with native value shown | state |
| Edit account modal: saving, save error | action; query (PATCH) |

Findings:

| # | Finding | By | Outcome |
|---|---|---|---|
| A1 | Same raw range labels as D1 (`AccountsChartCard` keeps its own copy of `RANGE_LABEL`). | Claude (code) | fixed with D1 |
| A2 | Chart with no accounts: a "0,00 €" headline, a green "0,00 € (0 %)" pill, the ranges and an empty legend, as on the dashboard before D7. | Claude (code) | fixed: the dashboard's empty state (`NetWorthEmpty`: nothing connected, first sync running, nothing came in), no figure, pill, ranges or legend. States "Accounts chart · Data": New, Syncing, Empty. |
| A3 | List with no accounts: an "All accounts 0,00 €" card under the chart's empty state. | User | fixed: the list is hidden while there are no accounts; the chart above says why and what to do. |
| A4 | Order of the accounts in the bar and the list: looked random. | User | the server sends them biggest first (`order by sum(value) desc`); only the mock didn't sort. Mock fixed; biggest first kept. |
| A5 | Bar tooltip on the first and last segments: centred on the pointer, so it ran off the card and under the sidebar or past the page. | User | fixed: it slides with the pointer, left-aligned at the bar's left end and right-aligned at its right end, so it stays inside the card. |
| A6 | Private mode left every amount of the list visible: the total, the bar's tooltip, each bank's subtotal and each account. | User | fixed: all masked; one eye, after "All accounts", reveals the whole list (an eye on every bank card would repeat it); shares stay. |
| A7 | An overdrawn account read "−2,9 %", and the other shares were of the net worth, overdrafts included. | Claude | fixed as on the dashboard (D16): shares are of what the accounts own; an account at or below zero has no share or bar, its amount in red. The summary bar already left out accounts at zero or below. |
| A8 | A tiny account read "0 %". | Claude | fixed: "<0,1 %" (`formatShare`, D19). |
| A9 | A bank card looked healthy while its sync failed or its data was outdated: only the sync window showed it. | Claude | fixed: the sync window's red or amber dot on the bank's logo (`AlertDot`, `connectionAlert`, shared with `ConnectionRow`). |
| A10 | "synced 2 h ago" next to the bank's name: lowercase, masculine in French, unlike the sync window. | Claude | removed: the sync window says it. |
| A11 | Account type next to the name as plain grey text. | User | the sync window's tag style (rounded, `surface-3`), in a column of their own before the share bar, as wide as the page's longest tag: they start at the same place on every row and every card, about 30px from the bar. Hiding it when it repeats the name ("PEA · PEA") was declined. The type is now shown on the Accounts page only: removed from the dashboard's distribution legend (and the donut's tag column with it) and from the sync window. |
| A12 | Sync window: account names dimmer and bigger than on the Accounts page. | User | fixed: same colour (`text-fg`) and size (13px); the bar and the lines moved 5px left, so each account's square ends where the bank's logo ends. |
| A13 | Edit account: the custom colour opened the system's picker, a separate window the page can't close; it stayed open after the Edit window closed. | User | fixed (option A of three shown in the companion): our own picker in a small panel under the pencil swatch (above it when there's no room below): a colour area (drawn on a canvas; CSS gradients left a line of the hue at the rounded corners), a hue slider, the hex code. Closes on Escape (not the window), a click outside, or with the window. Shared by the budget category window. |
| A14 | Chart legend with many accounts: one name per account, on two or three lines, squeezing the figure so "over 6 months" fell under the pill. | User | fixed: the 5 biggest accounts, then "+N others" (the names on hover; a sixth is named rather than "+1 other"); long names cut, whole on hover; the figure's side no longer shrinks. Hovering an account in the legend, the bar or the list brings its band forward in the chart. The bands are stacked biggest first (at the bottom), so the tooltip and the legend read in the same order. An account at zero over the whole range is left out of the chart, its tooltip and its legend; one emptied during the range keeps its history. |
| A15 | Edit account: the name field (46px) taller than the Type dropdown (38px). | User | fixed app-wide: `TextInput` is as tall as a `Select` (38px, 14px text), and this window and the budget category window use it instead of their own field. Login, Profile and Password fields shrink with it (to check when reviewed). |
| A16 | Clicking a field's name ("Account name", "Type") focused the field or opened the dropdown. | User | fixed: a shared `Field` whose name does nothing on click (it still names the field for screen readers); used by this window and the budget category window, and the AI model's label in Settings. |
| A17 | Edit account: nothing said which bank the account is at (two "Compte courant" open identical windows). | Claude | fixed: the bank's name under the title. |
| A18 | Focused text field: the green 1px ring looked jagged in the rounded corners. | User | fixed: the ring is drawn inside the field (`ring-inset`). |
| A19 | Colour picker: the handles had a hard black outline that looked dirty at the edges. | User | fixed: a smaller hollow white ring with a soft shadow in the colour area, a white pill on the hue slider. |
| A20 | "All accounts" bar: accounts of 1 % or less drew slivers. | User | fixed as on the dashboard (D60): left out of the bar, the others filling it; the list below and its shares unchanged. |

### Investments `/investments`

Components: `PageHeader`, `AnnualisedReturnCard`, `ReturnsCard` (`ReturnSpan`), `ExposureDonut` ×3 (regions, sectors, indices), `InvestmentsEmpty`.

| State | How to reach |
|---|---|
| Loading skeleton cards / error | query `/investments/returns`, `/holdings` |
| No investments (empty) | state |
| Annualised return unknown (null) | state "Every security has purchases missing", or "Two dollar ETFs have no rate" |
| Account with missing purchases (dot, "no return") | state |
| Span: days / months / years | base (years); states Started → Months, Days |
| Exposure donuts: asterisk on the total, footnote, when a security has no rate | state "Two dollar ETFs have no rate" |
| Private mode: one eye by each card's title | state "Private mode on" |

Findings:

| # | Finding | By | Outcome |
|---|---|---|---|
| I1 | Private mode: the return card had an eye on each of its two amounts (invested, value), each revealing only its own, and left the gain in euros visible; the per-account table and the three exposure rings showed every amount. | User | fixed as on the Dashboard: one eye after the return card's title, one after the table's, and one after the "Exposure" heading for its three rings (one eye per ring was too many); each reveals its own amounts, percentages stay. |
| I2 | The return card and the per-account table mixed two rules: the yearly % left out the holdings it couldn't trust, the euros (invested, value, gain) counted all of them. A holding with no exchange rate was worth 0 € against its full cost, a loss that didn't exist (both mock ETFs: −7 332 €, −100 %); a holding whose purchases and sales don't match what is held moved the euros but not the %. | Claude | fixed (server): every figure covers the same holdings, those whose history is complete and that have a rate; the others are counted by reason (`excludedHistory`, `excludedRate`). An amber asterisk on the % and a note per reason under the card ("Excludes 1 holding: its purchase and sale history is incomplete.", "Excludes 2 holdings: no exchange rate yet."); "—" instead of 0 € when every holding is left out. |
| I3 | "no purchases recorded" under an account whose purchases are recorded but incomplete; the dot's hover said purchases were missing even for an unrecorded sale. | Claude | fixed: "history incomplete"; the hover says the recorded purchases and sales don't match what is held. |
| I4 | Under a year the yearly % can look far bigger than it is (10 days at +2.7 % reads +161 %/yr). | Claude | won't fix: kept, with its span in amber. |
| I5 | Mock: shares no purchase explains added nothing to the invested, so the gain looked larger than it is. | Claude | fixed: the bank's cost stands in, as in `lot_basis`. |

### Budget · Overview `/budget/overview`

Components: `Budget` (mode switch, review badge), `PeriodLine` (+ `RangeModal`), `AiBanner`, `FiguresSurface` (`Comparison`), `SankeySurface`, `BreakdownSurface`, `TrendSurface`, `EmptyPeriodSurface`.

| State | How to reach |
|---|---|
| Loading / error (summary, trend) | query `/budget/summary`, `/budget/trend` |
| Month vs custom range; step forward disabled on the latest month with data | action |
| Comparisons shown / absent (under 3 months of history) | base / state "Only 2 months of history" |
| Empty period | action (step back past the data) |
| Some rows have no rate: asterisk on income / expenses / net, footnote in the figures card | state "Budget: a transaction has no rate" |
| Sankey: not spent / drawn from savings / exactly zero | base / states Month → Overspent, Zero |
| AI banner: none, running, review needed, last run failed | base (none); state "To review"; states AI → Running, Failed |
| Review tab badge (count) | state "To review" |
| Private mode: one eye in the period line, every amount masked, shares and % kept | state "Private mode on" |

Findings:

| # | Finding | By | Outcome |
|---|---|---|---|
| B1 | Private mode: an eye on each of the three figures, each revealing only its own; the net's change against last month, the money flow's and the trend's tooltips and axis, and the breakdown's amounts stayed readable. | User | fixed: the period line's "N transactions" is gone (user) and the eye takes its place, revealing every amount of the page; everything in money is masked (the trend's bars keep their shape), shares and % changes stay. |
| B2 | AI notice: the failed run had its own look (a triangle, a text button), unlike every other error; the running state was a grey line with a spinner straight on the page, pushing everything down while it lasted. | User | fixed after options on the companion: failed in the error look (red tile, "Couldn't sort your new transactions", the server's error cut with "…", whole on hover, small outlined Retry; F-A); running as a small blue pill at the end of the month line, a pulsing sparkle and "AI sorting · 42 left" (R-C, more room around the sparkle, a thicker one; French « Catégorisation IA · encore 42 »). A failure is no longer shown once a new run is under way. |
| B3 | An empty month: "View earlier periods" stepped back one month only (the ‹ caret already does), often onto another empty one; the sentence under the title repeated it. | User | fixed: both removed; the card only says "No transactions in this period", the month line's ‹ is the way back. |
| B4 | The ‹ caret was disabled on the first month of the data. | User | fixed: always enabled; a month before the first transaction is an empty month like any other. The › caret still stops at the latest month with data. |
| B5 | Categories table: a square, full-width hover and full-width lines, unlike the other tables. | User | fixed: moved onto the shared grid table (`GridTable`, as Holdings and Transactions, D30): rounded hover, separators inset to the text, columns on fixed tracks. |
| B6 | French: the month line's month started lower-case ("octobre 2026"); "Flux de trésorerie" too long; "Période" on the range button. | User | fixed: "Octobre 2026" (the trend's tooltip too); "Flux"; "Choisir des dates", and "Dates choisies" on the chip of a picked range. |

### Budget · Transactions `/budget/transactions`

Components: `SearchSurface`, `FilterPanel`, `ActiveFilterChips`, `TransactionsTable` (`TransactionRow`, `TransactionAvatar`, `CategoryChip`, `TagCell`), `SelectionBar`, `CategoryChooser`, `TagChooser`, `EntityChooser`, `Popover`, `BreakPairModal`, apply-to-all dialog.

| State | How to reach |
|---|---|
| Loading (spinner); couldn't load (Retry) | override `/transactions`: hold / fail |
| Nothing at all | state "No transactions at all" |
| No match (Clear all) | action (search, filters) |
| Paging: next page as you scroll | base (277 rows, 200 a page) |
| Row kinds: cash, buy, sale, paired transfer (dimmed, filter "Internal transfers"), unpaired transfer | base; states "A sale of ESE shares", "A transfer whose other half was filed elsewhere" |
| Foreign currency: amount in $, € on hover; no rate | states "A dollar account", "Budget: a transaction has no rate" |
| Long description; tags past the cell's width (+N) | state "A long description and 6 tags on one row" |
| Category chip: user / AI / pair / to review (dashed) / none | base; state "The AI filed 9 transactions…" |
| ✓ column on | state "The ✓ column on" |
| Selection bar: n selected and their total, bulk category, tags, mark checked | action |
| Select all shown disabled on the Investments type | action |
| Pair break confirmation | action (recategorise a paired row) |
| "Apply to all with this description" offer | action |
| Bulk updated line | action |
| Private mode; reads / saves failing | states "Private mode on", "Nothing loads", "Every save fails" |


Findings:

| # | Finding | By | Outcome |
|---|---|---|---|
| T1 | Private mode left every amount of the list, and the selection's total, readable. | Claude | fixed: masked; one eye after the "Transactions" title reveals them (user). |
| T2 | Descriptions cut with "…" (83 of the first 200 rows at 1280 px), with no way to read them. | Claude | fixed: the whole text on hover. |
| T3 | The unpaired transfer's note, "Transfer unpaired: this transaction's amount is no longer offset in totals": jargon, and four lines tall in the narrow column. | Claude | fixed: "Unpaired transfer" / « Virement dissocié » on one line; on hover, "Its other half was filed in another category, so this amount now counts in your totals." |
| T4 | Buy and sale rows: the ticker twice ("ESE", then "ESE · 5 @ 28.40"), the price unformatted, and a sale kept the rising arrow. | Claude | fixed: "Sale · 5 × 28,40 €" / « Vente · … » (masked in private mode); a sale's icon points down. Mock: lot rows have no category, as on the server. |
| T5 | "N rows updated" after a bulk change: a small grey line under the whole list, often off-screen. | Claude | fixed: in the corner, as the errors are, in green with a tick (`showDone`). |
| T6 | The selection's total left out a row with no exchange rate without saying so. | Claude | fixed: the amber asterisk, and on hover "Excludes transactions in a currency with no exchange rate yet." |
| T7 | An empty ledger said to connect an account, with no way there. | Claude | fixed: a small outlined "Connect a bank" to Settings · Connections. |
| T8 | Filter labels cut at 1280 px ("Investme…", "Needs rev…"); loading a spinner where Review has placeholder lines; "Personnalisé…" in the period menu. | Claude | won't fix (user): fine as they are. |

### Budget · Review `/budget/review`

Components: `ReviewProgress`, `ReviewLine`, `ResolvedLine`, `CategoryChooser`, `BreakPairModal`.

| State | How to reach |
|---|---|
| Queue with lines | state "To review" |
| A guess into a neutral category (no warning, R5) | state "A guess into Savings" |
| A line with no guess (Correct only) | state "Two rows the AI couldn't guess" |
| Resolved line: undo; apply to others, applied to n | action; state "A guess whose description 5 other rows share" |
| Correcting a paired transfer asks before breaking the pair | state "A guess on a paired transfer" |
| Empty queue ("All caught up") | base, or resolve all |
| Loading (placeholder lines); couldn't load (Retry) | override `/transactions`: hold / fail |
| Infinite scroll (next page as you scroll) | state "260 rows to review" |
| Private mode; reads / saves failing | states "Private mode on", "Nothing loads", "Every save fails" |


Findings:

| # | Finding | By | Outcome |
|---|---|---|---|
| R1 | "below 70% confidence" next to the title. | User | fixed: removed; the rest validated as is. |
| R2 | Nothing to review: a large party popper, a sentence and a big green button, unlike every other empty or error state. | User | fixed after options on the companion (C-A): the error look's shape in green, a tick in a soft green tile, "All caught up", "The AI's unsure guesses will show up here.", a small outlined "Back to overview". |
| R3 | No loading look: the empty queue frame ("0 / 0 resolved") showed until the rows came; a queue that couldn't load stayed that blank frame. | User | fixed (L-B, E): four pulsing placeholder lines cut like review lines; a queue that can't load says so with Retry, like every card. |
| R4 | The queue's title, "Uncertain category suggestions" / "Suggestions incertaines". | User | fixed: "To review" / "À vérifier", the Overview banner's words. |
| R5 | A guess into a neutral category (Savings, Investments, Internal transfer, Ignore) said "excludes the amount from totals" on its line: meaningless, and it looked bad. | User | fixed: removed; four ways to say it (plain words, a tag, an icon, the consequence with the amount) were shown on the companion and none kept: the category's name says where the money goes. |
| R6 | A long queue ended on a "Load more" button. | User | fixed: the next page loads by itself as you scroll, two screens ahead, as on Transactions (shared `useLoadOnScroll`); no button. |

### Settings · General `/settings/general`

Components: `SegmentedControl`, `Select`, the time zone's native `select`, `Toggle`, the numbers preview.

| State | How to reach |
|---|---|
| Every setting saves on change, applied app-wide | base |
| Currency: "Getting the USD rate…" while the server fetches it | query: hold `/auth/prefs`, then pick a currency |
| Currency refused (no rate to be had): red line, old currency kept | state "Currency change can't get its rate" |
| A save fails: the setting goes back, "Couldn't save the setting" in the corner | state "Every save fails" |
| Other formats (dates, separators, symbol before, a US time zone) | state "US formats" |
| Private mode on | state "Private mode on" |

Findings:

| # | Finding | By | Outcome |
|---|---|---|---|
| G1 | Time zone: the browser's own list (another arrow, another height) of 419 raw names ("America/Argentina/La_Rioja"), no search. | Claude | fixed: the app's dropdown, holding the main zones only (the big cities, about one per offset, and France's overseas ones), read "Paris (UTC+1)", by offset; a saved zone not in it stays listed (`timeZoneOptions`). The Welcome screen's field too. |
| G2 | The same mark can separate thousands and decimals ("1.234.567.89"). | Claude | won't fix (user). |
| G3 | "Base reporting currency": jargon. | Claude | fixed: "Every amount is shown in this currency" / « Tous les montants sont affichés dans cette devise ». |
| G4 | "Number format" had a line repeating the three labels just under it. | Claude | fixed: removed. |
| G5 | Private mode's hint doesn't say the eyes show the amounts. | Claude | won't fix (user). |
| G6 | French: date formats read "DD/MM/YYYY", city names stayed English (London, Brussels, Moscow, Reunion), "taux USD" without "de change", "Séparateur de milliers / décimal" much longer than the English, a stiff time zone hint. | User | fixed: "JJ/MM/AAAA", French city names (Londres, Bruxelles, Moscou, La Réunion…; in English São Paulo, Réunion, Nouméa get their accents), "taux de change USD", "Milliers" / "Décimales", « Sert à déterminer la date du jour, utilisée par les synchronisations, les rapports et les périodes », « Cache les montants sous des astérisques ». |

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
| AC1 | Sessions and two-factor status have no loading or error state: the list is just empty while loading or when the request fails. | Claude (code) | fixed: the sessions card shows the app's loading and error states (with Retry); the two-factor and passkey rows show a spinner, then "Couldn't load this" and a Retry button. |
| AC2 | The security rows don't say their state (codes left, passkeys saved). | Claude | won't fix (user). |
| AC3 | Sessions, French: "Firefox on Linux" stays English (the server writes it), "Connecté le" assumes a gender, "Dernière activité 03/10/2026" lacks "le". | Claude | later (user). |
| AC4 | "Connexion mémorisée · 30 jours" / "non mémorisée" don't say what they mean for the user. | Claude | dropped on a computer with AC7 (not worth showing, user); the phone's detail window keeps the old words, later. |
| AC5 | French danger zone: "Actions irréversibles", then "Cette action est irréversible." | Claude | fixed: the sentence is dropped, « Supprime définitivement votre compte et toutes ses données. » |
| AC6 | Passkeys window: one heavy card per passkey, pencil and bin always showing, renaming swapped the name for a box that moved the row, and deleting replaced the whole window by a title-only one. | User | redesigned (option A of three in the companion): one card with a line between passkeys, as in the sync window; pencil and bin on hover or keyboard focus (always on a phone), not on the focus the window gives its first row when it opens; wider window (640px); rename edits over the name without moving anything; delete asks "Delete? Cancel / Delete" in the row (Escape cancels, not the window). |
| AC7 | Active sessions: one heavy card per session, three tags on the first line ("This device", "Remembered · 30 days"), "Log out" always showing, "Log out all other sessions" alone at the bottom. | User | redesigned (option A of three in the companion): one card with a line between sessions, this device first then the most recently active; a computer or phone icon; the name, then "Last active … · address · Signed in …" (the "remembered" tags dropped: the user doesn't care how long a session lasts); "Log out" on hover; "Log out all other sessions" in the card's header. Phone layout unchanged.  |
| AC8 | Danger zone: its red outline looked jagged in the rounded corners (same cause as A18). | User | fixed: drawn inside the card; the other rounded outlines still drawn outside (tag and category fields, the purchases window's cells, the AI cost field, the colour picker's focus, the Welcome steps) moved inside too. |

### Settings · Connections `/settings/connections`

Components: `ConnectionRow`, `AddConnectionModal`, `ConnectionGuide`, `DeleteConnectionModal`.

| State | How to reach |
|---|---|
| Loading / error / no connections | query `/connections`; state |
| Every `ConnectionRow` status (see shared pieces) | state |
| Add connection: providers loading, init error | query |
| Delete connection confirmation | action |

Findings:

| # | Finding | By | Outcome |
|---|---|---|---|
| CO1 | Header: "Connections · 10 connections · 10 accounts", repeating itself (the sync window's counts were dropped as useless). | Claude | fixed: just "Connections". |
| CO2 | Delete confirmation: "Delete connection?" without the bank's name, and jargon ("synced … snapshots"). | Claude | fixed: "Delete Crédit Mutuel?", "Its accounts, holdings and transactions, and their history, are deleted too. This can't be undone." (« Ses comptes, positions et opérations, et leur historique, sont supprimés aussi. Cette action est irréversible. ») |
| CO3 | While deleting, the red button read "Loading…". | Claude | fixed: "Deleting…" / « Suppression… ». |
| CO4 | "How does it work?" window looked off: a narrow column of long lines, tiny grey icons so the points didn't read as separate, no button at the end. | User | redesigned (option B of three in the companion): the large window (640px), each icon in a square as on the Security rows, more space between the points, "Got it" / « Compris » to close. The squares show wherever the guide does (Connections' empty state, Welcome). |
| CO5 | No connection: a centred "No bank connected yet." over the guide squeezed into a 448px column in the middle of the card. | User | redesigned (option A of three in the companion): an empty state as on the dashboard (bank icon, "Connect your first bank", one line, the Add button, which leaves the header), then "How it works" under a line and the guide at full width. The sync window keeps its "No bank connected yet." |

### Settings · Budget `/settings/budget`

Components: `AiSurface`, `CategoriesSurface` (`CategoryModal`, `DeleteCategoryModal`, `CategoryIcon`, `ColorSwatchGrid`), `TagsSurface` (`TagRow`, `DeleteTagModal`), `ListPrefsSurface`.

| State | How to reach |
|---|---|
| AI not configured by the admin (disabled toggle) | state |
| Categories: loading / error / empty; archived; system row locked; reorder | query; base |
| Tags: loading / error / empty; create error | query; state |

Findings:

| # | Finding | By | Outcome |
|---|---|---|---|
| BS1 | "Categories · 32 categories", "Tags · 3 tags": the headers repeat themselves (as CO1). | Claude | fixed: just the titles. |
| BS2 | The categories table (about 1,770px) pushed the short cards far down the page. | Claude | fixed (user's order): AI categorisation, List preferences, Categories, Tags. |
| BS3 | Tags: the custom colour still opened the system's picker (A13 fixed only the swatch grid). | User | fixed: the app's colour picker, the tag's colour previewed while it moves and saved once when it closes. |
| BS4 | The settings menu scrolled away with a long page (Budget). | User | fixed, every settings page: it stays in view where it starts. |

### Settings · Users `/settings/users` (admin)

Components: `Avatar`, `UserDetailModal`, `LinkModal` (invite), `ResetLinkModal`, `DeleteUserModal`.

| State | How to reach |
|---|---|
| Loading / error | query `/users` |
| Self row (no actions), other rows, role toggle | base |
| Invite link, reset link, delete user | action |
| Seen as a member (route still reachable?) | panel role "user" |

Findings:

| # | Finding | By | Outcome |
|---|---|---|---|
| US1 | Clicking a member's role badge flipped it on screen only: nothing was saved (no endpoint), and a reload put it back. | Claude | fixed: `PATCH /api/users/{id}` (`admin::set_role`) saves it; it refuses your own role and never leaves no admin (one statement checks and writes, so two admins demoting each other can't both win). The badge waits while saving; a refusal says "Couldn't change the role". |
| US2 | "Users · 5 members": the header repeats itself (as CO1). | Claude | fixed: just "Users". |
| US3 | A hand-made `<table>` with an "ACTIONS" title over a column of icons. | Claude | fixed: the shared `GridTable` (D30), the actions column untitled (named for screen readers only). |
| US4 | Key and bin as grey squares, always filled. | Claude | fixed: plain icons that light up on hover, as on a connection row. |
| US5 | "YOU" tag, uppercase with a border. | Claude | fixed: a small green "You" tag, like "This device" on the sessions list. |
| US6 | Delete a member: with a long name and email the title wrapped and the email didn't fit; the button read "Loading…" while deleting. | User | fixed: the large window (`ConfirmDialog large`), "Deleting…" / « Suppression… », and the email field's focus ring drawn inside (AC8). |

### Settings · Server `/settings/server` (admin)

Components: providers list (`Toggle`), `AiServerSurface`, `AiCostSurface`.

| State | How to reach |
|---|---|
| Providers loading / error | query `/providers` |
| AI provider unset / set; models loading / error / none | base / state / query |
| Cost: no usage; unpriced model | state |

Findings:

| # | Finding | By | Outcome |
|---|---|---|---|
| SV1 | The same feature had three names: "Budget AI" here, "AI categorisation cost" in the next card, "AI categorisation" in Budget settings. | Claude | fixed: "AI categorisation" / « Catégorisation par IA » everywhere. |
| SV2 | Each model's cost had 4 decimals and the total 2, so a total under a cent read "$0.00" over models that cost something. | Claude | fixed: 2 decimals, 4 when the amount is under a cent, for both. Costs stay in US dollars, unconverted, as providers price in dollars (the hint says so). |
| SV3 | The AI switch read "off \| jev", raw lowercase codes. | Claude | left as is (user's call). |
| SV4 | A whole "About" card for one line, the version. | Claude | left as is (user's call). |

### Login `/login`

Steps: password → code (TOTP) / backup code / passwordless (passkey). Errors: invalid credentials, too many attempts, wrong code, challenge expired, passkey refused.

### Invite `/invite/:token`, Reset `/reset/:token`

Form, password too short, passwords differ, email exists (invite), invalid or expired link.

### Welcome `/welcome`

Three steps: profile, bank (connect, connection status ok / error / connecting / syncing), AI. Back from the bank callback (`?step=bank`). Finish error.

### Connection callback `/connections/callback`

Success redirect; failure (missing id or provider error).

### Errors (every screen)

Findings:

| # | Finding | By | Outcome |
|---|---|---|---|
| E1 | Errors looked different everywhere: a grey cloud and "Can't reach the server" in cards, a bare red sentence in windows, a small red line with a "×" on the Budget pages, and the routing library's raw "Something went wrong!" page (with the code's error) when a page broke. | User | one design (option C of three shown in the companion). Something that couldn't be shown (a card that couldn't load, the invite or reset link, a page that broke) shows in its place a red icon on a soft red tile, what went wrong, "Try again in a moment." (no "Your data is safe", user's call) and a small outline button with less rounded corners (Retry; Reload for a broken page, which keeps the sidebar). A failed action (a save, a delete, a category change, a connection that couldn't start) rises into the bottom-right corner of the screen, above any window, and goes after 5 s or when closed; its look (option B of five shown in the companion; E, the same with a red line shrinking over the 5 s, was built then dropped): the app's card colour with a thin outline, the red icon on a soft red tile as in the card error, centred on the lines; trying again closes it, and it outlives the window that failed; the same message twice shows once. What the user typed (wrong password, too many attempts, a name or email already used, passwords that don't match, a blocked pop-up) stays next to the field, in red. The sync window, which showed nothing when the connections couldn't load, shows the card error (and "Sync all" waits for them); a sync that couldn't start (one row or Sync all) used to fail silently and now says so in the corner. Texts reworked in both languages: in the corner, what couldn't be done ("Couldn't save the account" / "Impossible d'enregistrer le compte") over "Try again in a moment." ("Refresh the page." for something deleted elsewhere; "Check the rows, then try again." for the buy/sell history); a message shared by several actions was split so each names its own (the passkey's rename and delete, two-factor's setup, new codes and removal, the AI settings and prices, the password check before a sensitive change). Next to the field: full sentences with a period ("Wrong email or password.", "The passwords don't match.", "Another account already uses this email."). The welcome screen's last step and two-factor setup still showed a server failure in red: moved to the corner. |
| E2 | Errors about what the user typed were a bare red sentence wherever the form had room, often far from the field, and the field didn't change. | User | fixed (option A of three shown in the companion): the field gets a thin red ring (`TextInput`/`CodeInput` `invalid`), and the message sits right under it, small, red, with an icon (`FieldError`; `LabeledField`, `Field`'s and `PasswordField`'s `error`). A mistake about two fields (email and password, the two new passwords) rings both, the message under the last. Typing again clears it. Used by sign-in, invite, reset, change password, profile email, every password check, two-factor setup, category and tag names; the currency refused and the blocked Powens window use the same line without a field. Found on the way: sign-in said "Wrong email or password." for any failure, the invite page too; now only for a refused password, the rest says it couldn't sign you in / goes to the corner. Mock: the password "wrong" is refused everywhere, an email ending in "@taken.example" is in use, a category or tag name already used is refused. |
| E3 | A setting that failed to save (language, date format, private mode, the budget's switches, the picture…) went back to the stored value without a word. | User | fixed for every setting at once, where they are all saved: "Couldn't save the setting" in the corner, once the stored value is back (so in the language shown again). A currency with no rate keeps its message next to the field. |

## Cross-screen fixes

Issues met on one screen and fixed everywhere at once, so later screens reuse them.

| Fix | Screens touched |
|---|---|
| One range list with localized labels, no 24h (D1, D5) | Dashboard net worth, Accounts chart, asset modal |
| Chart legend and tooltip coloured like the line (D6) | Dashboard net worth, asset modal |
| Private mode masks the gain amount with the headline, one eye per card (D12) | Dashboard net worth, Accounts chart |
| No-accounts empty state that tells "nothing connected", "first sync running" and "nothing came in" apart (D7, D8; `lib/netWorthEmpty.ts`). | Dashboard net worth, Accounts chart (A2; the list is hidden, A3) |
| `Button variant="outline"` for an empty state's action (D11) | Dashboard net worth; to use on other empty states |
| Private mode: amounts masked, shares and % kept, one `PrivacyEye` right after the card's title, never next to a figure (D18, D26, D29) | Dashboard net worth, distribution, holdings; Accounts chart. To apply: Accounts list, Investments, Budget figures, the asset modal |
| Shares under one decimal read "<0,1 %", not "0 %" (`formatShare`, D19) | Dashboard distribution, Investments donuts |
| Tables are `GridTable` (CSS grid on fixed tracks, `ROW_CELLS` rows, `HEAD_CELL` headers, `TableEmpty`), D30 | Budget transactions, Dashboard holdings, Budget categories. To move onto it: the asset window's purchases, Accounts list (users: done, US3) |
| Errors (E1): `ErrorState` for what couldn't be shown (`CardState`, `CrashPage` as the router's `defaultErrorComponent`), the corner `ErrorToasts` for a failed action (`showError`, `useErrorToast`), red text by the field only for what the user typed | every card, window and page with a server error |
| Missing exchange rate: `FxAsterisk` on the figure + `FxFootnote` in the same card (`ExcludedNote` counts the holdings left out). A currency change fetches its rate or is refused, so "figures in the wrong currency" no longer exists (D13–D15). | Dashboard net worth, distribution, holdings; Accounts; Investments donuts; Budget overview figures; Settings · General |
