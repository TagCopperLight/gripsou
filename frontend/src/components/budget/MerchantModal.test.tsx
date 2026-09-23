import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { MerchantModal } from "./MerchantModal";
import type { Transaction } from "../../api/types";

const TX = {
  id: "t1", description: "CB LECLERC 0412", merchantName: "Leclerc", merchantDomain: "leclerc.fr",
  merchantLogoUrl: "https://cdn.brandfetch.io/leclerc.fr/x",
  // TransactionAvatar's no-logo fallback path reads these when the preview
  // has no logo (the empty-domain case below), so they must be real values.
  amount: "-12.40", source: "cash", isTransfer: false, categoryId: null, categoryIcon: null, categoryColor: null,
} as Transaction;

/** Answers both requests the modal makes: GET .../merchants/logo?domain=...
 *  (the preview) and PUT .../merchants (the save). `putStatus` controls the
 *  save's outcome; the preview always succeeds, echoing back a Brandfetch-
 *  decorated URL for whatever domain it was asked about. */
function renderModal(putStatus = 204) {
  const bodies: unknown[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    if (method === "GET") {
      const domain = new URL(url, "http://localhost").searchParams.get("domain") ?? "";
      if (!domain) return new Response("not a web domain", { status: 400 });
      return new Response(
        JSON.stringify({ domain, logoUrl: `https://cdn.brandfetch.io/${domain}/fallback/404/theme/light?c=abc` }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }
    bodies.push(JSON.parse(String(init?.body)));
    return new Response(putStatus === 204 ? null : "err", { status: putStatus });
  }));
  const onClose = vi.fn();
  const qc = new QueryClient();
  render(<QueryClientProvider client={qc}><MerchantModal tx={TX} onClose={onClose} /></QueryClientProvider>);
  return { bodies, onClose };
}

afterEach(() => vi.unstubAllGlobals());

describe("MerchantModal", () => {
  it("starts from the current merchant and saves the correction", async () => {
    const { bodies, onClose } = renderModal();
    const domain = screen.getByLabelText("Website");
    expect(domain).toHaveValue("leclerc.fr");
    fireEvent.change(domain, { target: { value: "e.leclerc" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(bodies[0]).toEqual({ transactionId: "t1", name: "Leclerc", domain: "e.leclerc" });
  });

  it("says so when the server rejects the domain", async () => {
    const { onClose } = renderModal(400);
    fireEvent.change(screen.getByLabelText("Website"), { target: { value: "nope" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("That is not a web domain.")).toBeVisible();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("says so when the description identifies no merchant (422)", async () => {
    const { onClose } = renderModal(422);
    fireEvent.change(screen.getByLabelText("Website"), { target: { value: "e.leclerc" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("This description can't identify a merchant.")).toBeVisible();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("shows a generic message on any other failure", async () => {
    const { onClose } = renderModal(500);
    fireEvent.change(screen.getByLabelText("Website"), { target: { value: "e.leclerc" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Could not save the merchant.")).toBeVisible();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("previews the logo URL the endpoint returns for a newly typed domain", async () => {
    renderModal();
    fireEvent.change(screen.getByLabelText("Website"), { target: { value: "burgerking.fr" } });
    await waitFor(
      () => {
        const img = screen.getByTestId("tx-avatar").querySelector("img");
        expect(img?.getAttribute("src")).toBe(
          "https://cdn.brandfetch.io/burgerking.fr/fallback/404/theme/light?c=abc",
        );
      },
      { timeout: 2000 },
    );
  });

  it("keeps the row's own logo URL (with its query string) when the domain is unchanged", () => {
    renderModal();
    const avatar = screen.getByTestId("tx-avatar");
    expect(avatar.querySelector("img")?.getAttribute("src")).toBe("https://cdn.brandfetch.io/leclerc.fr/x");
  });

  it("shows no logo for an empty domain", () => {
    renderModal();
    fireEvent.change(screen.getByLabelText("Website"), { target: { value: "" } });
    expect(screen.getByTestId("tx-avatar")).toHaveAttribute("data-variant", "generic");
  });
});
