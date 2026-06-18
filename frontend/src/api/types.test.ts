import { describe, it, expect } from "vitest";
import { flattenConnections, hasError, hasSyncing } from "./types";
import type { ProviderGroup, SyncStatus } from "./types";

function groups(...statuses: SyncStatus[]): ProviderGroup[] {
  return [
    {
      providerKey: "p",
      providerName: "P",
      connections: statuses.map((status, i) => ({
        id: String(i),
        displayName: `c${i}`,
        status,
        lastSyncAt: null,
        lastError: status === "error" ? "boom" : null,
        accounts: [],
      })),
    },
  ];
}

describe("connection helpers", () => {
  it("flattens connections across provider groups", () => {
    expect(flattenConnections(groups("ok", "error"))).toHaveLength(2);
    expect(flattenConnections(undefined)).toEqual([]);
  });

  it("detects syncing and error states", () => {
    expect(hasSyncing(groups("ok", "syncing"))).toBe(true);
    expect(hasSyncing(groups("ok", "error"))).toBe(false);
    expect(hasError(groups("ok", "error"))).toBe(true);
    expect(hasError(groups("ok", "syncing"))).toBe(false);
  });
});
