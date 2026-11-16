// Several states can be on at once unless they share a `group`; Reset re-applies them on fresh data.

import * as budget from "./budget.ts";
import { errors } from "./errors.ts";
import type { MockState, Piece } from "./pieces.ts";
import * as portfolio from "./portfolio.ts";
import * as settings from "./settings.ts";
import { sync } from "./sync.ts";

export const FOCUS: Piece = "Sign-in pages";

/** Applied in this order: a state that empties the household wipes what an earlier one added. */
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
