import { describe, expect, it } from "vitest";
import { anySyncing, connectionIssues, flattenConnections, healthIssue, overallAlert } from "./connectionState";
import type { ProviderGroup, SyncConnection, SyncHealth, ConnectionStatus } from "../api/wire";
const health: SyncHealth = { verified: true, lastUpdatedOn: "2026-10-10", state: null, errorMessage: null, nextRetryOn: null };
const conn: SyncConnection = {id:"c",displayName:"Bank",canManage:false,health:null,status:"ok",lastSyncAt:Date.now(),lastError:null,logo:null,accounts:[]};
describe("provider health", () => {
  it("uses calendar days with a weekend grace period, rather than local import time", () => {
    expect(healthIssue({...health,lastUpdatedOn:"2026-10-07"},"2026-10-10")).toBeNull();
    expect(healthIssue({...health,lastUpdatedOn:"2026-10-06"},"2026-10-10")).toBe("stale");
    expect(healthIssue({...health,lastUpdatedOn:"2026-09-30"},"2026-10-10")).toBe("stale");
    expect(healthIssue({...health,verified:false},"2026-10-10")).toBe("unknown");
    expect(healthIssue({...health,lastUpdatedOn:null},"2026-10-10")).toBe("unknown");
  });
  it("reports source errors even when the parent is healthy and deduplicates affected accounts", () => {
    const failed = {...health,state:"bug",errorMessage:"403 Client Error: Forbidden",nextRetryOn:"2026-10-11"};
    const accounts = ["Livret A","Livret Jeune"].map((name,id) => ({id:String(id),name,typeKey:"savings",value:"0",color:"#4dd0b1",lastSyncAt:null,health:failed}));
    const issues = connectionIssues({...conn,health,accounts},"2026-10-10");
    expect(issues).toEqual([{kind:"error",health:failed,accounts:["Livret A","Livret Jeune"]}]);
    expect(connectionIssues({...conn,health,accounts:accounts.map((a)=>({...a,health}))},"2026-10-10")).toEqual([]);
  });
});

function groups(...statuses: ConnectionStatus[]): ProviderGroup[] {
  return [{
    providerKey: "p",
    providerName: "P",
    connections: statuses.map((status, i) => ({ ...conn, id: String(i), status, lastSyncAt: null })),
  }];
}

describe("connection state across providers", () => {
  it("flattens connections across provider groups", () => {
    expect(flattenConnections(groups("ok", "error"))).toHaveLength(2);
    expect(flattenConnections(undefined)).toEqual([]);
  });

  it("detects syncing and error states", () => {
    expect(anySyncing(groups("ok", "syncing"))).toBe(true);
    expect(anySyncing(groups("ok", "error"))).toBe(false);
    expect(overallAlert(groups("ok", "error"))).toBe("error");
    expect(overallAlert(groups("ok", "syncing"))).toBeNull();
  });

  it("shows no global warning for a connection whose own dot is hidden while it syncs", () => {
    const stale = { ...health, lastUpdatedOn: "2026-09-01" };
    const [group] = groups("syncing");
    group.connections[0].health = stale;
    expect(overallAlert([group], "2026-10-10")).toBeNull();
    group.connections[0].status = "ok";
    expect(overallAlert([group], "2026-10-10")).toBe("warning");
  });
});
