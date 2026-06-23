import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { ProviderGroup } from "../api/types";

const syncOne = { mutate: vi.fn(), isPending: false, variables: undefined };
const syncAll = { mutate: vi.fn(), isPending: false };
const connectionsData: { data: ProviderGroup[]; isLoading: boolean } = {
  data: [
    {
      providerKey: "powens",
      providerName: "Powens",
      connections: [
        {
          id: "c1",
          displayName: "My bank",
          status: "ok",
          lastSyncAt: null,
          lastError: null,
          accounts: [
            { id: "a1", name: "Checking", typeLabel: "Current account", value: "10", lastSyncAt: null, color: null },
          ],
          logo: null,
        },
      ],
    },
  ],
  isLoading: false,
};

vi.mock("../api/hooks", () => ({
  useConnections: () => connectionsData,
  useSyncConnection: () => syncOne,
  useSyncAll: () => syncAll,
}));

import { SyncModal } from "./SyncModal";

describe("SyncModal", () => {
  beforeEach(() => {
    syncOne.mutate.mockReset();
    syncAll.mutate.mockReset();
  });

  it("renders the provider/connection tree with a summary subtext", () => {
    render(<SyncModal onClose={() => {}} />);
    expect(screen.getByText("Powens")).toBeInTheDocument();
    expect(screen.getByText("My bank")).toBeInTheDocument();
    expect(
      screen.getByText((_, el) => el?.textContent === "1 connection·1 provider"),
    ).toBeInTheDocument();
    // Accounts are collapsed until the row is expanded.
    expect(screen.queryByText("Checking")).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("My bank"));
    expect(screen.getByText("Checking")).toBeInTheDocument();
    expect(screen.getByText("Current account")).toBeInTheDocument();
  });

  it("syncs one connection and syncs all", () => {
    render(<SyncModal onClose={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Sync now" }));
    expect(syncOne.mutate).toHaveBeenCalledWith("c1");
    fireEvent.click(screen.getByRole("button", { name: "Sync all" }));
    expect(syncAll.mutate).toHaveBeenCalled();
  });
});
