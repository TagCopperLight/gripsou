import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { SyncConnection } from "../api/types";

const syncSpy = vi.fn();
const manageSpy = vi.fn();
vi.mock("../api/hooks", () => ({
  useManageConnection: () => ({ mutateAsync: manageSpy, isPending: false }),
  useSyncConnection: () => ({ mutate: syncSpy }),
}));

import { ConnectionRow } from "./ConnectionRow";

const conn: SyncConnection = {
  id: "c1",
  displayName: "Caisse d'Épargne",
  status: "ok",
  lastSyncAt: null,
  lastError: null,
  logo: null,
  accounts: [
    { id: "a1", name: "LIVRET A", typeKey: "savings", value: "6.87", color: "#4dd0b1", lastSyncAt: null },
  ],
};

const expand = () => fireEvent.click(screen.getByRole("button", { name: /caisse/i }));

beforeEach(() => { syncSpy.mockReset(); manageSpy.mockReset(); vi.restoreAllMocks(); });

describe("ConnectionRow", () => {


  it("keeps the actions hidden until the row is expanded", () => {
    render(<ConnectionRow conn={conn} onDelete={() => {}} />);
    // Only the (desktop) icon buttons exist while collapsed.
    expect(screen.queryByText("LIVRET A")).toBeNull();
    expand();
    expect(screen.getByText("LIVRET A")).toBeInTheDocument();
  });

  it("syncs and deletes from the expanded panel", () => {
    const onDelete = vi.fn();
    render(<ConnectionRow conn={conn} onDelete={onDelete} />);
    expand();
    // Icon button + panel button share the label; the panel one is last.
    const syncButtons = screen.getAllByRole("button", { name: /sync now/i });
    fireEvent.click(syncButtons[syncButtons.length - 1]);
    expect(syncSpy).toHaveBeenCalledWith("c1");

    const deleteButtons = screen.getAllByRole("button", { name: /delete connection/i });
    fireEvent.click(deleteButtons[deleteButtons.length - 1]);
    expect(onDelete).toHaveBeenCalled();
  });

  it("still opens a panel for a connection with no accounts", () => {
    render(<ConnectionRow conn={{ ...conn, accounts: [] }} onDelete={() => {}} />);
    expand();
    expect(
      screen.getAllByRole("button", { name: /sync now/i }).length,
    ).toBeGreaterThan(1);
  });
});

it("keeps the problem's message for the open row, under the accounts", () => {
  const health = { verified: true, lastUpdatedOn: "2026-10-08", state: "bug", errorMessage: "403 Client Error: Forbidden", nextRetryOn: "2026-10-11" };
  render(<ConnectionRow conn={{...conn, lastSyncAt:Date.now(), accounts:[{...conn.accounts[0],health},{...conn.accounts[0],id:"a2",name:"Checking",health:{...health,lastUpdatedOn:"2099-10-10",state:null,errorMessage:null,nextRetryOn:null}}]}} />);
  // The problem takes the sync time's place, and the logo carries an amber dot.
  expect(screen.getByText("Partial update")).toBeInTheDocument();
  expect(screen.queryByText(/403 Client Error: Forbidden/)).toBeNull();
  expect(screen.queryByText(/Synced/)).toBeNull();
  expect(screen.getByTestId("connection-warning-dot")).toBeInTheDocument();
  expand();
  // Named after the account it concerns, the retry date under it.
  expect(screen.getByText(/403 Client Error: Forbidden/).parentElement?.textContent).toMatch(/^LIVRET A:\s403/);
  expect(screen.getByText(/scheduled a retry/)).toBeInTheDocument();
  const date = screen.getAllByTitle("Last bank update")[0];
  expect(date.parentElement?.textContent).toContain("Savings");
});

it("says a failed sync in words with a red dot, and a healthy one's sync time with no dot", () => {
  const { rerender } = render(<ConnectionRow conn={{ ...conn, status: "error", lastError: "sync took too long" }} />);
  expect(screen.getByText("Sync failed")).toHaveAttribute("title", "sync took too long");
  expect(screen.getByTestId("connection-error-dot")).toBeInTheDocument();
  expand();
  expect(screen.getByText("sync took too long")).toBeInTheDocument();
  rerender(<ConnectionRow conn={{ ...conn, lastSyncAt: Date.now() }} />);
  expect(screen.getByText(/Synced/)).toBeInTheDocument();
  expect(screen.queryByTestId(/dot$/)).toBeNull();
});

it("opens Manage with a temporary link and syncs once when returning", async () => {
  const tab = {opener:window,location:{href:"about:blank"},close:vi.fn()};
  vi.spyOn(window,"open").mockReturnValue(tab as unknown as Window);
  manageSpy.mockResolvedValue({redirectUrl:"https://webview.powens.com/en/manage?code=temporary"});
  render(<ConnectionRow conn={{...conn,canManage:true}} />);
  fireEvent.click(screen.getByRole("button",{name:"Manage"}));
  await waitFor(()=>expect(tab.location.href).toContain("code=temporary"));
  expect(manageSpy).toHaveBeenCalledWith("c1");
  expect(tab.opener).toBeNull();
  fireEvent.focus(window);
  fireEvent.focus(window);
  expect(syncSpy).toHaveBeenCalledTimes(1);
});

it("handles blocked tabs and failed Manage requests", async () => {
  vi.spyOn(window,"open").mockReturnValue(null);
  const {unmount}=render(<ConnectionRow conn={{...conn,canManage:true}} />);
  fireEvent.click(screen.getByRole("button",{name:"Manage"}));
  expect(screen.getByRole("alert")).toHaveTextContent("Allow pop-ups");
  expect(manageSpy).not.toHaveBeenCalled();
  unmount();
  const close=vi.fn();
  vi.mocked(window.open).mockReturnValue({opener:null,location:{href:""},close} as unknown as Window);
  manageSpy.mockRejectedValue(new Error("provider failed"));
  render(<ConnectionRow conn={{...conn,canManage:true}} />);
  fireEvent.click(screen.getByRole("button",{name:"Manage"}));
  await waitFor(()=>expect(screen.getByRole("alert")).toHaveTextContent("Unable to open Powens"));
  expect(close).toHaveBeenCalled();
  expect(syncSpy).not.toHaveBeenCalled();
});

it("discards a delayed Manage response after leaving the page", async () => {
  const close=vi.fn();
  const tab={opener:null,location:{href:"about:blank"},close};
  vi.spyOn(window,"open").mockReturnValue(tab as unknown as Window);
  let resolve!: (value:{redirectUrl:string}) => void;
  manageSpy.mockReturnValue(new Promise((done)=>{resolve=done;}));
  const {unmount}=render(<ConnectionRow conn={{...conn,canManage:true}} />);
  fireEvent.click(screen.getByRole("button",{name:"Manage"}));
  unmount();
  resolve({redirectUrl:"https://webview.powens.com/en/manage?code=temporary"});
  await waitFor(()=>expect(close).toHaveBeenCalled());
  expect(tab.location.href).toBe("about:blank");
  fireEvent.focus(window);
  expect(syncSpy).not.toHaveBeenCalled();
});
