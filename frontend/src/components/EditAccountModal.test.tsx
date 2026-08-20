import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { EditAccountModal } from "./EditAccountModal";
import type { Account } from "../api/types";

const ACCOUNT: Account = {
  id: "a1",
  name: "Compte Courant",
  color: "#5b9bf0",
  typeKey: "checking",
  typeLabel: "Checking",
  value: "12480.30",
  lastSyncAt: null,
  sourceName: null,
  sourceLogo: null,
  fxMissing: false,
};

function renderModal(onClose = () => {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <EditAccountModal account={ACCOUNT} onClose={onClose} />
    </QueryClientProvider>,
  );
}

describe("EditAccountModal", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (typeof url === "string" && url.endsWith("/api/account-types")) {
          return new Response(
            JSON.stringify([
              { key: "checking", label: "Checking" },
              { key: "savings", label: "Savings" },
            ]),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }
        // PATCH
        return new Response(JSON.stringify({ id: "a1" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
          ...init,
        });
      }),
    );
  });

  it("disables Save until something changes", () => {
    renderModal();
    expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled();
  });

  it("disables Save when the name is emptied", () => {
    renderModal();
    fireEvent.change(screen.getByDisplayValue("Compte Courant"), {
      target: { value: "" },
    });
    expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled();
  });

  it("saves the edited name with the right payload and closes", async () => {
    const onClose = vi.fn();
    renderModal(onClose);
    fireEvent.change(screen.getByDisplayValue("Compte Courant"), {
      target: { value: "Renamed" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(fetch).toHaveBeenCalledWith(
      "/api/accounts/a1",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({
          name: "Renamed",
          typeKey: "checking",
          color: "#5b9bf0",
        }),
      }),
    );
  });
});
