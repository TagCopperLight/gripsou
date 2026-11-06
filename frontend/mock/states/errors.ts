import type { MockState } from "./pieces.ts";

export const errors: MockState[] = [
  {
    id: "errors-reads-fail",
    label: "Nothing loads (every card's error)",
    pieces: ["Budget transactions", "Budget review", "Budget overview", "Investments", "Errors"],
    apply(store) {
      store.faults.push({ method: "GET", except: ["/auth/me"], mode: "error" });
    },
  },
  {
    id: "errors-writes-fail",
    label: "Every save fails (the error in the corner)",
    pieces: ["Settings · General", "Budget transactions", "Budget review", "Errors"],
    apply(store) {
      store.faults.push({ method: "write", except: ["/auth/login", "/auth/logout"], mode: "error" });
    },
  },
  {
    id: "errors-page-crash",
    label: "The pages showing accounts break",
    pieces: ["Errors"],
    apply(store) {
      store.faults.push({ method: "GET", path: "/accounts", mode: "malformed" });
    },
  },
];
