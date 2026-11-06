import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { EditAccountModal } from "./EditAccountModal";
import type { Account } from "../../api/wire";
import { renderWithApp, jsonResponse, stubFetch } from "../../test/kit";

const ACCOUNT: Account = {
  id: "a1",
  name: "Compte Courant",
  color: "#5b9bf0",
  connectionId: "c1",
  typeKey: "checking",
  value: "12480.30",
  currency: "EUR",
  valueNative: null,
  lastSyncAt: null,
  sourceName: "Bank",
  sourceLogo: null,
  fxMissing: false,
};

function renderModal(onClose = () => {}) {
  return renderWithApp(<EditAccountModal account={ACCOUNT} onClose={onClose} />);
}

describe("EditAccountModal", () => {
  beforeEach(() => {
    stubFetch(async (url: string, init?: RequestInit) => {
        if (typeof url === "string" && url.endsWith("/api/account-types")) {
          return jsonResponse(["checking", "savings"]);
        }
        // PATCH
        return new Response(JSON.stringify({ id: "a1" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
          ...init,
        });
      });
  });

  it("does nothing when a field's name is clicked", async () => {
    renderModal();
    (document.activeElement as HTMLElement | null)?.blur();
    fireEvent.click(screen.getByText("Type"));
    fireEvent.click(screen.getByText("Account name"));
    expect(screen.getByRole("button", { name: "Type" })).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByLabelText("Account name")).not.toHaveFocus();
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
