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
          logo: null,
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
});


it("shows a warning for provider problems even after a successful local sync", () => {
  const data = groups("ok");
  data[0].connections[0].health = {verified:true,lastUpdatedOn:"2099-10-10",state:"bug",errorMessage:"Forbidden",nextRetryOn:null};
  mockUseConnections.mockReturnValue({data} as ReturnType<typeof useConnections>);
  const {rerender} = renderButton();
  expect(screen.getByTestId("sync-warning-dot")).toBeInTheDocument();
  data[0].connections[0].health.state = null;
  data[0].connections[0].health.errorMessage = null;
  rerender(<SyncButton />);
  expect(screen.queryByTestId("sync-warning-dot")).toBeNull();
});
