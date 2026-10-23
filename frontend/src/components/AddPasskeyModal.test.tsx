import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { startRegistration, WebAuthnAbortService } from "@simplewebauthn/browser";

import { AddPasskeyModal } from "./AddPasskeyModal";
import { keys } from "../api/keys";

vi.mock("@simplewebauthn/browser", () => ({
  startRegistration: vi.fn(),
  WebAuthnAbortService: { cancelCeremony: vi.fn() },
}));

type Reply = { status: number; body?: unknown; headers?: Record<string, string> };

const json = ({ status, body, headers }: Reply) =>
  new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });

/** Answers per path; a path given a list answers its items in turn. */
function stubApi(routes: Record<string, Reply | Reply[]>) {
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

const sent = (fetchMock: ReturnType<typeof stubApi>, path: string, n = 0) =>
  JSON.parse(calls(fetchMock, path)[n][1]!.body as string);

const OPTIONS = { challenge: "chal-1", options: { challenge: "abc", rp: { name: "gripsou" } } };
const CREDENTIAL = { id: "cred-1", type: "public-key" };
const PASSKEY = { id: "pk-1", name: "Pixel 9", createdAt: 1, lastUsedAt: null };
const OK = {
  "/auth/reauth": { status: 200, body: { reauth: "tok-1" } },
  "/auth/mfa/passkeys/register/options": { status: 200, body: OPTIONS },
  "/auth/mfa/passkeys/register": { status: 200, body: PASSKEY },
};

const mockedStart = vi.mocked(startRegistration);
const domError = (name: string) => new DOMException("nope", name);

function renderModal(onClose = vi.fn()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidate = vi.spyOn(client, "invalidateQueries");
  render(
    <QueryClientProvider client={client}>
      <AddPasskeyModal onClose={onClose} />
    </QueryClientProvider>,
  );
  return { onClose, invalidate, user: userEvent.setup() };
}

async function submitPassword(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText("Current password"), "hunter2");
  await user.click(screen.getByRole("button", { name: "Continue" }));
}

describe("AddPasskeyModal", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    mockedStart.mockReset();
    vi.mocked(WebAuthnAbortService.cancelCeremony).mockReset();
  });

  it("asks for the password first, with Continue disabled while empty", () => {
    stubApi({ ...OK });
    renderModal();
    expect(screen.getByText("Add a passkey")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();
  });

  it("checks the password, runs the browser step, registers and shows the new name", async () => {
    const fetchMock = stubApi({ ...OK });
    mockedStart.mockResolvedValue(CREDENTIAL as never);
    const { onClose, invalidate, user } = renderModal();

    await submitPassword(user);
    expect(await screen.findByText("Passkey added")).toBeInTheDocument();
    expect(screen.getByText("Pixel 9")).toBeInTheDocument();

    expect(sent(fetchMock, "/auth/reauth")).toEqual({ password: "hunter2" });
    expect(sent(fetchMock, "/auth/mfa/passkeys/register/options")).toEqual({ reauth: "tok-1" });
    expect(mockedStart).toHaveBeenCalledWith({ optionsJSON: OPTIONS.options });
    expect(sent(fetchMock, "/auth/mfa/passkeys/register")).toEqual({
      reauth: "tok-1",
      challenge: "chal-1",
      credential: CREDENTIAL,
    });
    expect(invalidate).toHaveBeenCalledWith(expect.objectContaining({ queryKey: keys.mfaStatus() }));

    await user.click(screen.getByRole("button", { name: "Done" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("shows the waiting state, and Cancel aborts the browser ceremony and closes", async () => {
    stubApi({ ...OK });
    mockedStart.mockReturnValue(new Promise(() => {}));
    const { onClose, user } = renderModal();

    await submitPassword(user);
    expect(await screen.findByText("Waiting for your browser…")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(WebAuthnAbortService.cancelCeremony).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("opens no browser window when closed before the options arrived", async () => {
    let release!: () => void;
    const held = new Promise<void>((r) => { release = r; });
    const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(async (url) => {
      const path = url.replace(/^\/api/, "");
      if (path === "/auth/mfa/passkeys/register/options") await held;
      const reply = OK[path as keyof typeof OK];
      return json(reply ?? { status: 200, body: {} });
    });
    vi.stubGlobal("fetch", fetchMock);
    const { onClose, user } = renderModal();

    await submitPassword(user);
    expect(await screen.findByText("Waiting for your browser…")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    await act(async () => release());
    await waitFor(() => expect(calls(fetchMock, "/auth/mfa/passkeys/register/options")).toHaveLength(1));
    expect(mockedStart).not.toHaveBeenCalled();
  });

  it("registers nothing when the browser answers after the window closed", async () => {
    const fetchMock = stubApi({ ...OK });
    let answer!: (v: unknown) => void;
    mockedStart.mockReturnValue(new Promise((r) => { answer = r; }) as never);
    const { user } = renderModal();

    await submitPassword(user);
    await waitFor(() => expect(mockedStart).toHaveBeenCalled());
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await act(async () => answer(CREDENTIAL));
    expect(calls(fetchMock, "/auth/mfa/passkeys/register")).toHaveLength(0);
  });

  it("says the password is wrong on a 400", async () => {
    const fetchMock = stubApi({ ...OK, "/auth/reauth": { status: 400 } });
    const { user } = renderModal();
    await submitPassword(user);
    expect(await screen.findByText("Wrong password.")).toBeInTheDocument();
    expect(calls(fetchMock, "/auth/mfa/passkeys/register/options")).toHaveLength(0);
    expect(mockedStart).not.toHaveBeenCalled();
  });

  it("tells how long to wait on a 429", async () => {
    stubApi({ ...OK, "/auth/reauth": { status: 429, headers: { "Retry-After": "150" } } });
    const { user } = renderModal();
    await submitPassword(user);
    expect(await screen.findByText("Too many attempts. Try again in 3 minutes.")).toBeInTheDocument();
  });

  it("offers Try again after the browser is cancelled, without checking the password again", async () => {
    const fetchMock = stubApi({ ...OK });
    mockedStart.mockRejectedValueOnce(domError("NotAllowedError")).mockResolvedValueOnce(CREDENTIAL as never);
    const { user } = renderModal();

    await submitPassword(user);
    expect(await screen.findByText("No passkey was added")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Passkey added")).toBeInTheDocument();
    expect(calls(fetchMock, "/auth/reauth")).toHaveLength(1);
    expect(calls(fetchMock, "/auth/mfa/passkeys/register/options")).toHaveLength(2);
    expect(sent(fetchMock, "/auth/mfa/passkeys/register/options", 1)).toEqual({ reauth: "tok-1" });
    expect(mockedStart).toHaveBeenCalledTimes(2);
    expect(calls(fetchMock, "/auth/mfa/passkeys/register")).toHaveLength(1);
  });

  it("closes from the failed state with Cancel", async () => {
    stubApi({ ...OK });
    mockedStart.mockRejectedValue(domError("NotAllowedError"));
    const { onClose, user } = renderModal();
    await submitPassword(user);
    await screen.findByText("No passkey was added");
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("reports a device that already has a passkey when the browser refuses, with no Try again", async () => {
    const fetchMock = stubApi({ ...OK });
    mockedStart.mockRejectedValue(domError("InvalidStateError"));
    const { user } = renderModal();
    await submitPassword(user);
    expect(await screen.findByText("This device already has a passkey for gripsou")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Try again" })).not.toBeInTheDocument();
    expect(calls(fetchMock, "/auth/mfa/passkeys/register")).toHaveLength(0);
  });

  it("reports a device that already has a passkey when the server answers 409", async () => {
    stubApi({ ...OK, "/auth/mfa/passkeys/register": { status: 409 } });
    mockedStart.mockResolvedValue(CREDENTIAL as never);
    const { user } = renderModal();
    await submitPassword(user);
    expect(await screen.findByText("This device already has a passkey for gripsou")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Try again" })).not.toBeInTheDocument();
  });

  it.each([
    ["options", { ...OK, "/auth/mfa/passkeys/register/options": { status: 401 } }],
    ["register", { ...OK, "/auth/mfa/passkeys/register": { status: 401 } }],
  ])("goes back to an empty password step on a 401 from %s", async (_name, routes) => {
    const fetchMock = stubApi(routes);
    mockedStart.mockResolvedValue(CREDENTIAL as never);
    const { user } = renderModal();
    await submitPassword(user);

    expect(await screen.findByText("That took too long. Enter your password again.")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByLabelText("Current password")).toHaveValue(""));
    expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();
    expect(calls(fetchMock, "/auth/reauth")).toHaveLength(1);
  });
});
