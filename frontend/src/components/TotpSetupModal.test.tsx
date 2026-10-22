import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TotpSetupModal } from "./TotpSetupModal";
import { keys } from "../api/keys";

const SVG = '<svg xmlns="http://www.w3.org/2000/svg"><rect width="1" height="1"/></svg>';
const SECRET = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP";

type Routes = Record<string, () => Response>;

function stubApi(routes: Routes) {
  const fetchMock = vi.fn(async (url: string) => {
    const route = routes[url];
    if (!route) throw new Error(`unexpected ${url}`);
    return route();
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

function renderModal(props: { onClose?: () => void; onReauthExpired?: () => void } = {}) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const onClose = props.onClose ?? vi.fn();
  const onReauthExpired = props.onReauthExpired ?? vi.fn();
  const invalidate = vi.spyOn(client, "invalidateQueries");
  render(
    <QueryClientProvider client={client}>
      <TotpSetupModal reauth="tok-1" onClose={onClose} onReauthExpired={onReauthExpired} />
    </QueryClientProvider>,
  );
  return { onClose, onReauthExpired, invalidate };
}

const setupOk = () => json({ secret: SECRET, qrSvg: SVG });

describe("TotpSetupModal", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("calls setup once on open with the reauth token and shows the QR and key", async () => {
    const fetchMock = stubApi({ "/api/auth/mfa/totp/setup": setupOk });
    renderModal();
    const img = await screen.findByRole("img");
    expect(img).toHaveAttribute(
      "src",
      "data:image/svg+xml;charset=utf-8," + encodeURIComponent(SVG),
    );
    expect(screen.getByText("JBSW Y3DP EHPK 3PXP JBSW Y3DP EHPK 3PXP")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/auth/mfa/totp/setup",
      expect.objectContaining({ body: JSON.stringify({ reauth: "tok-1" }) }),
    );
  });

  it("tells the card when the reauth token is rejected", async () => {
    stubApi({ "/api/auth/mfa/totp/setup": () => new Response("no", { status: 401 }) });
    const { onReauthExpired } = renderModal();
    await waitFor(() => expect(onReauthExpired).toHaveBeenCalled());
  });

  it("shows an error when setup cannot start", async () => {
    stubApi({ "/api/auth/mfa/totp/setup": () => new Response("x", { status: 409 }) });
    renderModal();
    expect(await screen.findByText("Something went wrong. Please try again.")).toBeInTheDocument();
  });

  it("walks through code entry to the backup codes, then closes and refreshes the status", async () => {
    stubApi({
      "/api/auth/mfa/totp/setup": setupOk,
      "/api/auth/mfa/totp/confirm": () => json({ recoveryCodes: ["aaaa-bbbb", "cccc-dddd"] }),
    });
    const { onClose, invalidate } = renderModal();
    await screen.findByRole("img");
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByText("Enter the code shown in the app.")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Authentication code"), { target: { value: "123 456" } });
    expect(await screen.findByText("aaaa-bbbb")).toBeInTheDocument();
    expect(screen.getByText("cccc-dddd")).toBeInTheDocument();
    expect(invalidate).toHaveBeenCalledWith(expect.objectContaining({ queryKey: keys.mfaStatus() }));
    // Only the button closes this step.
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "I've saved them" }));
    expect(onClose).toHaveBeenCalled();
  });

  it("says when the code is wrong and lets the user retry", async () => {
    stubApi({
      "/api/auth/mfa/totp/setup": setupOk,
      "/api/auth/mfa/totp/confirm": () => new Response("bad", { status: 400 }),
    });
    renderModal();
    await screen.findByRole("img");
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.change(screen.getByLabelText("Authentication code"), { target: { value: "000000" } });
    expect(await screen.findByText("That code didn't work. Try again.")).toBeInTheDocument();
    expect(screen.getByLabelText("Authentication code")).toHaveValue("");
  });

  it("shows the wait when confirming is throttled", async () => {
    stubApi({
      "/api/auth/mfa/totp/setup": setupOk,
      "/api/auth/mfa/totp/confirm": () =>
        new Response("slow", { status: 429, headers: { "Retry-After": "30" } }),
    });
    renderModal();
    await screen.findByRole("img");
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.change(screen.getByLabelText("Authentication code"), { target: { value: "000000" } });
    expect(await screen.findByText("Too many attempts. Try again in 1 minute.")).toBeInTheDocument();
  });
});
