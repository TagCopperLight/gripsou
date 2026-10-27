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
            { id: "a1", name: "Checking", typeKey: "savings", value: "10", lastSyncAt: null, color: "#4dd0b1" },
          ],
          logo: null,
        },
      ],
    },
  ],
  isLoading: false,
};

const manageSpy = vi.fn();
vi.mock("../api/hooks", () => ({
  useConnections: () => connectionsData,
  useManageConnection: () => ({ mutateAsync: manageSpy, isPending: false }),
  useSyncConnection: () => syncOne,
  useSyncAll: () => syncAll,
}));

import { SyncModal } from "./SyncModal";

describe("SyncModal", () => {
  beforeEach(() => {
    syncOne.mutate.mockReset();
    syncAll.mutate.mockReset();
  });

  it("lists the connections without naming their provider", () => {
    render(<SyncModal onClose={() => {}} />);
    expect(screen.getByText("My bank")).toBeInTheDocument();
    expect(screen.queryByText(/powens/i)).not.toBeInTheDocument();
    // Accounts are collapsed until the row is expanded.
    expect(screen.queryByText("Checking")).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("My bank"));
    expect(screen.getByText("Checking")).toBeInTheDocument();
    // No account type: the Accounts page shows it.
    expect(screen.queryByText("Savings")).not.toBeInTheDocument();
  });

  it("syncs one connection and syncs all", () => {
    render(<SyncModal onClose={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Sync now" }));
    expect(syncOne.mutate).toHaveBeenCalledWith("c1");
    fireEvent.click(screen.getByRole("button", { name: "Sync all" }));
    expect(syncAll.mutate).toHaveBeenCalled();
  });
});
