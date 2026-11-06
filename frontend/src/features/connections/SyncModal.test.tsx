import { describe, it, expect, beforeEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import type { ProviderGroup } from "../../api/types";

const CONNECTIONS: ProviderGroup[] = [
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
];

import { SyncModal } from "./SyncModal";
import { renderWithApp, jsonResponse, stubFetch, requestsTo } from "../../test/kit";

describe("SyncModal", () => {
  let fetchMock: ReturnType<typeof stubFetch>;
  beforeEach(() => {
    fetchMock = stubFetch(async (_url, init) =>
      init?.method === "POST" ? new Response(null, { status: 204 }) : jsonResponse(CONNECTIONS),
    );
  });

  it("lists the connections without naming their provider", async () => {
    renderWithApp(<SyncModal onClose={() => {}} />);
    expect(await screen.findByText("My bank")).toBeInTheDocument();
    expect(screen.queryByText(/powens/i)).not.toBeInTheDocument();
    // Accounts are collapsed until the row is expanded.
    expect(screen.queryByText("Checking")).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("My bank"));
    expect(screen.getByText("Checking")).toBeInTheDocument();
    // No account type: the Accounts page shows it.
    expect(screen.queryByText("Savings")).not.toBeInTheDocument();
  });

  it("syncs one connection and syncs all", async () => {
    renderWithApp(<SyncModal onClose={() => {}} />);
    await screen.findByText("My bank");
    fireEvent.click(screen.getByRole("button", { name: "Sync now" }));
    await waitFor(() => expect(requestsTo(fetchMock, "/connections/c1/sync")).toHaveLength(1));
    expect(requestsTo(fetchMock, "/connections/c1/sync")[0].method).toBe("POST");
    fireEvent.click(screen.getByRole("button", { name: "Sync all" }));
    await waitFor(() => expect(requestsTo(fetchMock, "/api/sync")).toEqual([{ method: "POST", body: {} }]));
  });
});
