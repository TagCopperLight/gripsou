import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { TransactionModal } from "./TransactionModal";
import type { Transaction } from "../../api/types";

const TX = {
  id: "t1", description: "CB LECLERC 0412", merchantDomain: "leclerc.fr",
  merchantLogoUrl: "https://cdn.brandfetch.io/leclerc.fr/x",
  note: "Split with Alex",
  // TransactionAvatar's no-logo fallback path reads these when the preview
  // has no logo (the empty-domain case below), so they must be real values.
  amount: "-12.40", source: "cash", isTransfer: false, categoryId: null, categoryIcon: null, categoryColor: null,
} as Transaction;

/** Answers every request the modal makes: GET .../merchants/logo?domain=...
 *  (the preview), PUT .../merchants (the website save) and PATCH
 *  /transactions/:id (the note save). `putStatus`/`patchStatus` control each
 *  save's outcome; the preview always succeeds, echoing back a Brandfetch-
 *  decorated URL for whatever domain it was asked about. */
function renderModal({ putStatus = 204, patchStatus = 200 }: { putStatus?: number; patchStatus?: number } = {}) {
  const puts: unknown[] = [];
  const patches: unknown[] = [];
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
    if (method === "PUT") {
      puts.push(JSON.parse(String(init?.body)));
      return new Response(putStatus === 204 ? null : "err", { status: putStatus });
    }
    // PATCH
    patches.push(JSON.parse(String(init?.body)));
    return new Response(
      patchStatus === 200 ? JSON.stringify({ sameDescriptionCount: 0 }) : "err",
      { status: patchStatus, headers: { "Content-Type": "application/json" } },
    );
  }));
  const onClose = vi.fn();
  const qc = new QueryClient();
  render(<QueryClientProvider client={qc}><TransactionModal tx={TX} onClose={onClose} /></QueryClientProvider>);
  return { puts, patches, onClose };
}

afterEach(() => vi.unstubAllGlobals());

describe("TransactionModal", () => {
  it("pre-fills the domain and the note", () => {
    renderModal();
    expect(screen.getByLabelText("Website — all transactions with this description")).toHaveValue("leclerc.fr");
    expect(screen.getByLabelText("Note — this transaction only")).toHaveValue("Split with Alex");
  });

  it("changing only the note sends only the PATCH {note} and not the PUT", async () => {
    const { puts, patches, onClose } = renderModal();
    fireEvent.change(screen.getByLabelText("Note — this transaction only"), { target: { value: "New note" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(patches).toEqual([{ note: "New note" }]);
    expect(puts).toEqual([]);
  });

  it("changing only the domain sends only the PUT {transactionId, domain}", async () => {
    const { puts, patches, onClose } = renderModal();
    fireEvent.change(screen.getByLabelText("Website — all transactions with this description"), {
      target: { value: "e.leclerc" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(puts).toEqual([{ transactionId: "t1", domain: "e.leclerc" }]);
    expect(patches).toEqual([]);
  });

  it("clearing the note sends {note: \"\"}", async () => {
    const { patches, onClose } = renderModal();
    fireEvent.change(screen.getByLabelText("Note — this transaction only"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(patches).toEqual([{ note: "" }]);
  });

  it("a PUT failure with a successful PATCH stays open, shows the website error, and on a second Save does not re-send the note", async () => {
    const { puts, patches, onClose } = renderModal({ putStatus: 400 });
    fireEvent.change(screen.getByLabelText("Website — all transactions with this description"), {
      target: { value: "nope" },
    });
    fireEvent.change(screen.getByLabelText("Note — this transaction only"), { target: { value: "New note" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("That is not a web domain.")).toBeVisible();
    expect(onClose).not.toHaveBeenCalled();
    expect(puts).toEqual([{ transactionId: "t1", domain: "nope" }]);
    expect(patches).toEqual([{ note: "New note" }]);

    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(puts).toEqual([
      { transactionId: "t1", domain: "nope" },
      { transactionId: "t1", domain: "nope" },
    ]));
    expect(patches).toEqual([{ note: "New note" }]);
  });

  it("says so when the server rejects the domain", async () => {
    const { onClose } = renderModal({ putStatus: 400 });
    fireEvent.change(screen.getByLabelText("Website — all transactions with this description"), {
      target: { value: "nope" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("That is not a web domain.")).toBeVisible();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("says so when the description identifies no merchant (422)", async () => {
    const { onClose } = renderModal({ putStatus: 422 });
    fireEvent.change(screen.getByLabelText("Website — all transactions with this description"), {
      target: { value: "e.leclerc" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("This description can't identify a merchant.")).toBeVisible();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("shows a generic message on any other failure", async () => {
    const { onClose } = renderModal({ putStatus: 500 });
    fireEvent.change(screen.getByLabelText("Website — all transactions with this description"), {
      target: { value: "e.leclerc" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Could not save the merchant.")).toBeVisible();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("previews the logo URL the endpoint returns for a newly typed domain", async () => {
    renderModal();
    fireEvent.change(screen.getByLabelText("Website — all transactions with this description"), {
      target: { value: "burgerking.fr" },
    });
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
    fireEvent.change(screen.getByLabelText("Website — all transactions with this description"), {
      target: { value: "" },
    });
    expect(screen.getByTestId("tx-avatar")).toHaveAttribute("data-variant", "generic");
  });
});
