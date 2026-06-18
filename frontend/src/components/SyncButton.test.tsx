import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ProviderGroup, SyncStatus } from "../api/types";

vi.mock("../api/hooks", () => ({ useConnections: vi.fn() }));
vi.mock("./SyncModal", () => ({ SyncModal: () => <div>modal</div> }));

import { SyncButton } from "./SyncButton";
import { useConnections } from "../api/hooks";

function groups(status: SyncStatus): ProviderGroup[] {
  return [
    {
      providerKey: "p",
      providerName: "P",
      connections: [
        {
          id: "1",
          displayName: "c",
          status,
          lastSyncAt: null,
          lastError: status === "error" ? "boom" : null,
          accounts: [],
        },
      ],
    },
  ];
}

const mockUseConnections = vi.mocked(useConnections);

function renderButton(client = new QueryClient()) {
  return render(
    <QueryClientProvider client={client}>
      <SyncButton />
    </QueryClientProvider>,
  );
}

describe("SyncButton", () => {
  it("shows the error dot when a connection is in error", () => {
    mockUseConnections.mockReturnValue({ data: groups("error") } as ReturnType<
      typeof useConnections
    >);
    renderButton();
    expect(screen.getByTestId("sync-error-dot")).toBeInTheDocument();
  });

  it("spins and shows no error dot while syncing", () => {
    mockUseConnections.mockReturnValue({ data: groups("syncing") } as ReturnType<
      typeof useConnections
    >);
    renderButton();
    expect(screen.queryByTestId("sync-error-dot")).toBeNull();
    expect(
      screen.getByRole("button").querySelector(".animate-spin"),
    ).toBeTruthy();
  });

  it("shows neither dot nor spin when idle (all ok)", () => {
    mockUseConnections.mockReturnValue({ data: groups("ok") } as ReturnType<
      typeof useConnections
    >);
    renderButton();
    expect(screen.queryByTestId("sync-error-dot")).toBeNull();
    expect(
      screen.getByRole("button").querySelector(".animate-spin"),
    ).toBeNull();
  });

  it("invalidates dashboard/accounts/holdings when a sync finishes", () => {
    const client = new QueryClient();
    const spy = vi.spyOn(client, "invalidateQueries");
    mockUseConnections.mockReturnValue({ data: groups("syncing") } as ReturnType<
      typeof useConnections
    >);
    const { rerender } = renderButton(client);
    spy.mockClear(); // ignore any mount-time calls
    mockUseConnections.mockReturnValue({ data: groups("ok") } as ReturnType<
      typeof useConnections
    >);
    rerender(
      <QueryClientProvider client={client}>
        <SyncButton />
      </QueryClientProvider>,
    );
    const invalidatedKeys = spy.mock.calls.map(
      (c) => (c[0] as { queryKey: string[] }).queryKey[0],
    );
    expect(invalidatedKeys).toEqual(
      expect.arrayContaining([
        "net-worth",
        "distribution",
        "accounts",
        "account-series",
        "holdings",
      ]),
    );
  });
});
