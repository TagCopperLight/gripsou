import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { SyncConnection } from "../api/types";

const syncSpy = vi.fn();
vi.mock("../api/hooks", () => ({
  useSyncConnection: () => ({ mutate: syncSpy }),
}));

import { ConnectionRow } from "./ConnectionRow";

const conn: SyncConnection & { providerName: string } = {
  id: "c1",
  displayName: "Caisse d'Épargne",
  providerName: "Powens",
  status: "ok",
  lastSyncAt: null,
  lastError: null,
  logo: null,
  accounts: [
    { id: "a1", name: "LIVRET A", typeLabel: "Savings", value: "6.87", color: null, lastSyncAt: null },
  ],
};

const expand = () => fireEvent.click(screen.getByRole("button", { name: /caisse/i }));

beforeEach(() => { syncSpy.mockReset(); vi.restoreAllMocks(); });

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

it("shows source errors while collapsed and bank dates inline when expanded", () => {
  const health = { verified: true, lastUpdatedOn: "2026-10-08", state: "bug", errorMessage: "403 Client Error: Forbidden", nextRetryOn: "2026-10-11" };
  render(<ConnectionRow conn={{...conn, lastSyncAt:Date.now(), accounts:[{...conn.accounts[0],health},{...conn.accounts[0],id:"a2",name:"Checking",health:{...health,lastUpdatedOn:"2099-10-10",state:null,errorMessage:null,nextRetryOn:null}}]}} />);
  expect(screen.getByText("Partial update")).toBeInTheDocument();
  expect(screen.getByText(/403 Client Error: Forbidden/)).toBeInTheDocument();
  expect(screen.queryByText("Connected")).toBeNull();
  expect(screen.getByText(/Synced/)).toBeInTheDocument();
  expand();
  const date = screen.getAllByTitle("Bank updated")[0];
  expect(date.parentElement?.textContent).toContain("Savings");
  expect(date.querySelector("span")).toHaveClass("mr-3");
});
