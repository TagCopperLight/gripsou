import { describe, expect, it } from "vitest";

import type { ProviderGroup, SyncConnection, SyncStatus } from "../api/types";
import { netWorthEmptyKind } from "./netWorthEmpty";

function groups(...statuses: SyncStatus[]): ProviderGroup[] {
  const connections: SyncConnection[] = statuses.map((status, i) => ({
    id: `c${i}`, displayName: "Bank", status, lastSyncAt: null, lastError: null, accounts: [], logo: null,
  }));
  return [{ providerKey: "powens", providerName: "Powens", connections }];
}

describe("netWorthEmptyKind", () => {
  it("asks to connect a bank when there is no connection", () => {
    expect(netWorthEmptyKind([])).toBe("noConnection");
    expect(netWorthEmptyKind(groups())).toBe("noConnection");
  });

  it("waits while any connection is still bringing its accounts in", () => {
    for (const s of ["syncing", "awaiting", "pending"] as const) {
      expect(netWorthEmptyKind(groups("error", s))).toBe("syncing");
    }
  });

  it("says nothing came in once every connection has settled", () => {
    expect(netWorthEmptyKind(groups("ok"))).toBe("nothingCameIn");
    expect(netWorthEmptyKind(groups("ok", "error"))).toBe("nothingCameIn");
  });
});
