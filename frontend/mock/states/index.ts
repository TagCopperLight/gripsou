// States for the review panel, added as each piece of the UI is reviewed.
// Each one tweaks the base data (or makes requests fail); several can be on
// at once, unless they share a `group`, and Reset re-applies the active ones
// on fresh data. The panel lists the states of the piece under review
// (`FOCUS`).

import * as budget from "./budget.ts";
import { errors } from "./errors.ts";
import type { MockState, Piece } from "./pieces.ts";
import * as portfolio from "./portfolio.ts";
import * as settings from "./settings.ts";
import { sync } from "./sync.ts";

/** The piece under review: the panel lists its states. */
export const FOCUS: Piece = "Sign-in pages";

/** Active states apply in this order, which matters when two touch the same
 *  data: one that empties the household wipes what an earlier one added. */
export const STATES: MockState[] = [
  ...settings.apiKeys,
  ...portfolio.distribution,
  ...portfolio.assetWindow,
  ...portfolio.recordPurchases,
  ...portfolio.investments,
  ...budget.overview,
  ...budget.review,
  ...budget.transactions,
  ...settings.general,
  ...portfolio.holdings,
  ...portfolio.dashboard,
  ...errors,
  ...settings.account,
  ...settings.connections,
  ...settings.users,
  ...settings.server,
  ...settings.signIn,
  ...portfolio.editAccount,
  ...sync,
];
