import { describe, expect, it } from "vitest";
import { createControl } from "../control.ts";
import { STATES } from "./index.ts";

describe("review states", () => {
  it("give every row its own id, with every state that adds rows on at once", () => {
    // The option kept on in groups whose other options empty what the rest add to.
    const kept: Record<string, string> = { Data: "dashboard-loss", Started: "investments-months", Connections: "sync-every-status" };
    const emptying = new Set(["transactions-none", "welcome-new"]);
    const c = createControl(STATES);
    for (const s of STATES) {
      if (emptying.has(s.id) || (s.group && kept[s.group] && kept[s.group] !== s.id)) continue;
      c.setState(s.id, true);
    }
    const store = c.store();
    const ids = [
      ...store.users, ...store.sessions, ...store.mfa.passkeys, ...store.connections, ...store.accounts,
      ...store.securities, ...Object.values(store.manualLots).flat(), ...store.txns, ...store.categories, ...store.tags,
    ].map((x) => x.id);
    expect(ids.length).toBeGreaterThan(100);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
