import { describe, expect, it } from "vitest";
import { connectionIssues, healthIssue } from "./connectionHealth";
import type { SyncConnection, SyncHealth } from "../api/types";
const health: SyncHealth = { verified: true, lastUpdatedOn: "2026-10-10", state: null, errorMessage: null, nextRetryOn: null };
const conn: SyncConnection = {id:"c",displayName:"Bank",status:"ok",lastSyncAt:Date.now(),lastError:null,logo:null,accounts:[]};
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
    const accounts = ["Livret A","Livret Jeune"].map((name,id) => ({id:String(id),name,typeLabel:"Savings",value:"0",color:null,lastSyncAt:null,health:failed}));
    const issues = connectionIssues({...conn,health,accounts},"2026-10-10");
    expect(issues).toEqual([{kind:"error",health:failed,accounts:["Livret A","Livret Jeune"]}]);
    expect(connectionIssues({...conn,health,accounts:accounts.map((a)=>({...a,health}))},"2026-10-10")).toEqual([]);
  });
});
