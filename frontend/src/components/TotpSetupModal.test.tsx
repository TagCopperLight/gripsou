import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { TotpSetupModal } from "./TotpSetupModal";

type Reply = { status: number; body?: unknown; headers?: Record<string, string> };

const json = ({ status, body, headers }: Reply) =>
  new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });

/** Answers per path; a path given a list answers its items in turn. */
function stubApi(routes: Record<string, Reply | Reply[]>) {
  // Typed with `init` so the tests can read the sent body.
  const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(async (url) => {
    const path = url.replace(/^\/api/, "");
    const route = routes[path];
    if (!route) return json({ status: 200, body: {} });
    const reply = Array.isArray(route) ? (route.length > 1 ? route.shift()! : route[0]) : route;
    return json(reply);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const calls = (fetchMock: ReturnType<typeof stubApi>, path: string) =>
  fetchMock.mock.calls.filter(([url]) => url === `/api${path}`);

/** The JSON body of the first call to `path`. */
const sent = (fetchMock: ReturnType<typeof stubApi>, path: string) =>
  JSON.parse(calls(fetchMock, path)[0][1]!.body as string);

const SETUP = { secret: "JBSWY3DPEHPK3PXPABCD", qrSvg: "<svg/>" };
const OK = {
  "/auth/reauth": { status: 200, body: { reauth: "tok-1" } },
  "/auth/mfa/totp/setup": { status: 200, body: SETUP },
  "/auth/mfa/totp/confirm": { status: 200, body: { recoveryCodes: ["aaaa-1111", "bbbb-2222"] } },
};

function renderModal(onClose = vi.fn()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <TotpSetupModal onClose={onClose} />
    </QueryClientProvider>,
  );
  return { onClose, user: userEvent.setup() };
}

async function passPassword(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText("Current password"), "hunter2");
  await user.click(screen.getByRole("button", { name: "Continue" }));
  await screen.findByRole("img", { name: /QR code/ });
}

describe("TotpSetupModal", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it("walks password, QR, code and backup codes, then closes on Done", async () => {
    const fetchMock = stubApi({ ...OK });
    const writeText = vi.fn().mockResolvedValue(undefined);
    const { onClose, user } = renderModal();
    // userEvent.setup() installs its own clipboard; replace it after.
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });

    expect(screen.getByRole("img", { name: "Step 1 of 4" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();
    await passPassword(user);
    expect(sent(fetchMock, "/auth/reauth")).toEqual({ password: "hunter2" });
    expect(sent(fetchMock, "/auth/mfa/totp/setup")).toEqual({ reauth: "tok-1" });

    expect(screen.getByRole("img", { name: "Step 2 of 4" })).toBeInTheDocument();
    expect(screen.getByText("JBSW Y3DP EHPK 3PXP ABCD")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Copy the key" }));
    expect(writeText).toHaveBeenCalledWith(SETUP.secret);

    await user.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByRole("img", { name: "Step 3 of 4" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /turn on/i })).not.toBeInTheDocument();
    const field = screen.getByRole("textbox", { name: "6-digit code" });
    expect(field).toHaveFocus();
    await user.type(field, "123456");

    expect(await screen.findByText("aaaa-1111")).toBeInTheDocument();
    expect(sent(fetchMock, "/auth/mfa/totp/confirm")).toEqual({ code: "123456" });
    expect(calls(fetchMock, "/auth/mfa/totp/confirm")).toHaveLength(1);
    expect(screen.getByRole("dialog", { name: "Save your backup codes" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Step 4 of 4" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Done" }));
    expect(onClose).toHaveBeenCalled();
  });

  it("says when the password is wrong", async () => {
    const fetchMock = stubApi({ ...OK, "/auth/reauth": { status: 400 } });
    const { user } = renderModal();
    await user.type(screen.getByLabelText("Current password"), "nope");
    await user.click(screen.getByRole("button", { name: "Continue" }));
    expect(await screen.findByText("Wrong password.")).toBeInTheDocument();
    expect(calls(fetchMock, "/auth/mfa/totp/setup")).toHaveLength(0);
  });

  it("shows the wait in minutes when the password check is throttled", async () => {
    stubApi({ ...OK, "/auth/reauth": { status: 429, headers: { "Retry-After": "150" } } });
    const { user } = renderModal();
    await user.type(screen.getByLabelText("Current password"), "nope");
    await user.click(screen.getByRole("button", { name: "Continue" }));
    expect(await screen.findByText("Too many attempts. Try again in 3 minutes.")).toBeInTheDocument();
  });

  it("empties the boxes and says so when the code is wrong", async () => {
    stubApi({ ...OK, "/auth/mfa/totp/confirm": { status: 400 } });
    const { user } = renderModal();
    await passPassword(user);
    await user.click(screen.getByRole("button", { name: "Next" }));
    const field = screen.getByRole("textbox", { name: "6-digit code" });
    await user.type(field, "000000");
    expect(await screen.findByText("That code didn't work. Try again.")).toBeInTheDocument();
    expect(field).toHaveValue("");
    // Typing again clears the message.
    await user.type(field, "1");
    expect(screen.queryByText("That code didn't work. Try again.")).not.toBeInTheDocument();
  });

  it("goes back to the password with the expired message on 409", async () => {
    stubApi({ ...OK, "/auth/mfa/totp/confirm": { status: 409 } });
    const { user } = renderModal();
    await passPassword(user);
    await user.click(screen.getByRole("button", { name: "Next" }));
    await user.type(screen.getByRole("textbox", { name: "6-digit code" }), "123456");
    expect(
      await screen.findByText("This setup took too long and expired. Enter your password to start again."),
    ).toBeInTheDocument();
    const password = screen.getByLabelText("Current password");
    expect(password).toHaveValue("");
    expect(password).toHaveFocus();
    expect(screen.getByRole("img", { name: "Step 1 of 4" })).toBeInTheDocument();
  });

  it("returns from the code step to the QR step with Back", async () => {
    stubApi({ ...OK });
    const { user } = renderModal();
    await passPassword(user);
    await user.click(screen.getByRole("button", { name: "Next" }));
    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByRole("img", { name: /QR code/ })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Step 2 of 4" })).toBeInTheDocument();
  });

  it("cancels from the password step", async () => {
    stubApi({ ...OK });
    const { onClose, user } = renderModal();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });
});
