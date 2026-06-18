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
            { id: "a1", name: "Checking", typeLabel: "Current account", value: "10", lastSyncAt: null },
          ],
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

  it("renders the provider/connection/account tree", () => {
    render(<SyncModal onClose={() => {}} />);
    expect(screen.getByText("Powens")).toBeInTheDocument();
    expect(screen.getByText("My bank")).toBeInTheDocument();
    expect(screen.getByText("Checking")).toBeInTheDocument();
    expect(screen.getByText("Current account")).toBeInTheDocument();
  });

  it("syncs one connection and syncs all", () => {
    render(<SyncModal onClose={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Sync" }));
    expect(syncOne.mutate).toHaveBeenCalledWith("c1");
    fireEvent.click(screen.getByRole("button", { name: "Sync all" }));
    expect(syncAll.mutate).toHaveBeenCalled();
  });
});
