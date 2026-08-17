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

describe("ConnectionRow", () => {
  beforeEach(() => syncSpy.mockReset());

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
