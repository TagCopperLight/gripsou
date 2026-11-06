import type { Store } from "../store.ts";

/** The pieces of the UI a state can show something on. */
export const PIECES = [
  "Investments",
  "Net worth chart",
  "Distribution",
  "Holdings",
  "Asset window",
  "Record purchases",
  "Accounts chart",
  "Accounts list",
  "Edit account",
  "Sync",
  "Exchange rates",
  "Budget overview",
  "Budget review",
  "Budget transactions",
  "Settings · General",
  "Settings · Account",
  "Settings · Connections",
  "Settings · Users",
  "Settings · Server",
  "API keys",
  "Sign-in pages",
  "Errors",
] as const;

export type Piece = (typeof PIECES)[number];

export type MockState = {
  id: string;
  label: string;
  pieces: Piece[];
  /** States that can't be on together share a group; the panel shows the
   *  group as one segmented control, each state as its `option`. */
  group?: string;
  option?: string;
  apply(store: Store): void;
};
