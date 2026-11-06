import { describe, it, expect, vi } from "vitest";
import { act, screen, waitFor } from "@testing-library/react";
import type { ProviderGroup, ConnectionStatus } from "../../api/wire";

vi.mock("./SyncModal", () => ({ SyncModal: () => <div>modal</div> }));

import { SyncButton } from "./SyncButton";
import { renderWithApp, jsonResponse, stubFetch } from "../../test/kit";

function groups(status: ConnectionStatus): ProviderGroup[] {
  return [
    {
      providerKey: "p",
      providerName: "P",
      connections: [
        {
          id: "1",
          displayName: "c",
          canManage: false,
          health: null,
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

async function renderButton(data: ProviderGroup[]) {
  const fetchMock = stubFetch(async () => jsonResponse(data));
  const view = renderWithApp(<SyncButton />);
  await waitFor(() => expect(fetchMock).toHaveBeenCalled());
  await waitFor(() => expect(view.client.isFetching()).toBe(0));
  return view;
}

const spinning = () => screen.getByRole("button").querySelector(".animate-spin");

describe("SyncButton", () => {
  it("shows the error dot when a connection is in error", async () => {
    await renderButton(groups("error"));
    expect(await screen.findByTestId("sync-error-dot")).toBeInTheDocument();
  });

  it("spins and shows no error dot while syncing", async () => {
    await renderButton(groups("syncing"));
    await waitFor(() => expect(spinning()).toBeTruthy());
    expect(screen.queryByTestId("sync-error-dot")).toBeNull();
  });

  it("shows neither dot nor spin when idle (all ok)", async () => {
    await renderButton(groups("ok"));
    expect(screen.queryByTestId("sync-error-dot")).toBeNull();
    expect(spinning()).toBeNull();
  });
});

it("shows a warning for provider problems even after a successful local sync", async () => {
  const data = groups("ok");
  data[0].connections[0].health = { verified: true, lastUpdatedOn: "2099-10-10", state: "bug", errorMessage: "Forbidden", nextRetryOn: null };
  const { client } = await renderButton(data);
  expect(await screen.findByTestId("sync-warning-dot")).toBeInTheDocument();
  const healed = groups("ok");
  healed[0].connections[0].health = { ...data[0].connections[0].health!, state: null, errorMessage: null };
  stubFetch(async () => jsonResponse(healed));
  await act(() => client.refetchQueries());
  await waitFor(() => expect(screen.queryByTestId("sync-warning-dot")).toBeNull());
});
