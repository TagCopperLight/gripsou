// Per-screen states for the review panel, added as each screen is reviewed.
// Each one tweaks the base data (or forces an answer) for one route; several
// can be on at once, and Reset re-applies the active ones on fresh data.

import type { Store } from "./store";

export type MockState = {
  id: string;
  label: string;
  /** The app path the state belongs to; the panel lists it there. */
  route: string;
  apply(store: Store): void;
};

export const STATES: MockState[] = [];
