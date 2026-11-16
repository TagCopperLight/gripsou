# Design decisions

How gripsou behaves for its users, and why. Code comments say how; this file says what the product does on purpose. CLAUDE.md holds the architecture and its invariants.

## Removed on purpose

- No merchant logos, merchant notes or clickable descriptions: they were built and removed on purpose.

## Sign-in and accounts

- **First run.** While nobody has an account, the server prints a one-time code at startup. Whoever types it in the browser creates the first account, as admin. Once any user exists, setup is closed for good.
- **Login throttle.** It never locks an account for good, but someone who keeps sending wrong passwords for an email keeps that account's password login waiting for as long as they go on. Passkey sign-in is counted per IP only, so it still works during such a wait. The counters live in memory: gripsou runs as one instance and an attacker can't trigger a restart.
- **Second-step codes** have their own per-account limiter, with a day of memory and longer waits, so someone who knows the password can't keep guessing codes at the password limiter's pace.
- **Passkeys are a way to sign in, not a second step.** They never turn two-factor on. Two-factor is on only when a confirmed authenticator exists.
- **Adding a second factor needs a fresh reauth** (except in the welcome flow), so a stolen session can't enrol its own authenticator and lock the owner out. A pending setup expires after 10 minutes and wrong codes are throttled, so a stolen session can't guess its way into an abandoned setup and its backup codes.
- **Reset links.** Redeeming one clears the user's second factors: an admin vouched for whoever holds it. So creating one needs a fresh reauth, and an admin can never make one for themselves (Settings changes one's own password). A link follows the user, not the email: it still works after an email change, and never resets a later account on the old address.
- **An admin can't change their own role.** Demoting themselves would lose the admin page mid-action, and another admin can do it.
- **Welcome.** Only invited users are told the server owner can see their data. The admin goes through every welcome step, since they set the server up.
- **Security headers are set by the app,** not the reverse proxy, so they hold whatever sits in front. The login token lives in browser storage, and `script-src 'self'` keeps an injected script from reading it.

## History and valuation

- **One start day per user.** Every connection's history starts the day before the user's earliest evidence, so no bank pops into the chart on its own day and steps net worth up. A lot dated earlier moves that start for all the user's connections.
- **Spend date over booking date.** When an account has rows booked before they were spent (a bank stamping a statement period on one day), the backfill walks the whole account on the spend date.
- **No negative derived cash.** A derived stretch that dips below zero is lifted by its shortfall: a balance can't be negative, and a reconciliation gap on a snapshot is a constant error.
- **Lots beat the provider's cost basis** once they explain a position exactly. This happens at read time only, so the next sync can't overwrite it.
- **Lot suggestions are never written automatically.** A false match would silently corrupt the cost basis, so the user confirms every one, and only unambiguous matches are offered.
- **Recording lots can over-record.** A shares bar past the holding's quantity turns red but doesn't disable Save, because a sale can be entered before its buy.
- **Returns.** Every return figure of a scope covers the same positions: those whose lots explain what is held and that can be valued today. The others are left out of all figures and listed so the page can say so. Counting them in invested and value but not in the return would make the figures disagree, and a position valued at zero against its full cost would show a loss that doesn't exist. The return covers the counted positions' lots, the dividends of accounts whose positions in scope are all counted (from the account's first recorded purchase), and today's value. A missing rate among those flows leaves the return unknown rather than wrong.

## Budget

- **Internal transfers are hidden** from the transactions list until the user turns them on (the "Internal transfers" toggle): they are money moving between the user's own accounts, not spending. The list, its `matching` count and "select all shown" read one filter, so the count never promises rows the list doesn't show.
- **Pairing respects the user.** A transfer half the user filed in a neutral category still pairs and keeps that category. An AI guess the user accepted in review is the user's choice, and pairing leaves it alone.
- **Renaming a seeded category** drops its translation key, so the user's wording shows verbatim in every language.
- **Deleting a category** sends its transactions back to uncategorised with no source, so the AI can look at them again.
- **A rate-limited AI run shows as partial,** not failed, since it resumes at the next sync. A running AI run hides the previous run's failure.
- **Overview is the budget page's landing mode** (analysis first). The Transactions list is where the user acts on what it shows.
- **Diagram sides.** A side keeps slices of at least 2 % of the period's expenses, up to 8, and rolls the rest into Other. A category's net over the period decides its side: refunds that exceed its spending make it neither income nor expense.
- **The cash-flow diagram** links every source to one hub and the hub to every destination, never source to destination: nothing in the data says which euro of salary paid which expense. A period whose rows only net out draws nothing.
- **Baseline month.** The mean month excludes the selected month (a spike must not inflate the average it's judged against) and counts a month with no rows as a month.
- **Trend legend.** The trend picks its top eight categories once for the whole window, never per month, so the legend stays true: the selected month's largest first, then the window's biggest. A user's own "Other" category folds into the rollup, so the legend never shows two.
- **Breakdown tables** sort the Other rollup last, so the table reads as "and everything else".

## Display

- **Cash of one currency** held in several accounts shows as one line in the holdings table; the split per account is on the Accounts tab. The account-type filter applies before merging, so a filtered list's cash line is that type's cash only.
- **Distribution.** An account at or below zero has no share and is left out; the shares of the others add to 100 %. Shares too thin to draw are left out of rings and bars but still named in lists.
- **Sparklines** take their colour from the month's own direction, never the holding's all-time gain: the chart is about the month.
- **Comparisons.** A move under half a cent counts as no move. Against a zero baseline, only the amount shows, not a percentage.
