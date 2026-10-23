import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { ManageTwoFactorModal } from "./ManageTwoFactorModal";

type Reply = { status: number; body?: unknown };

function stubApi(routes: Record<string, Reply>) {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const key = `${init?.method ?? "GET"} ${url.replace(/^\/api/, "")}`;
    const reply = routes[key] ?? { status: 200, body: {} };
    return new Response(reply.body === undefined ? null : JSON.stringify(reply.body), {
      status: reply.status,
      headers: { "Content-Type": "application/json" },
    });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const calls = (fetchMock: ReturnType<typeof stubApi>, method: string, path: string) =>
  fetchMock.mock.calls.filter(([url, init]) => url === `/api${path}` && (init?.method ?? "GET") === method);

const OK: Record<string, Reply> = {
  "GET /auth/mfa/status": { status: 200, body: { totp: true, recoveryRemaining: 7 } },
  "POST /auth/reauth": { status: 200, body: { reauth: "tok-1" } },
  "POST /auth/mfa/recovery/regenerate": { status: 200, body: { recoveryCodes: ["aaaa-1111", "bbbb-2222"] } },
  "DELETE /auth/mfa/totp": { status: 204 },
};

function renderModal(start?: "menu" | "turnOff") {
  const onClose = vi.fn();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ManageTwoFactorModal onClose={onClose} start={start} />
    </QueryClientProvider>,
  );
  return { onClose, user: userEvent.setup() };
}

describe("ManageTwoFactorModal", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it("shows how many backup codes are left", async () => {
    stubApi(OK);
    renderModal();
    expect(screen.getByRole("dialog", { name: "Two-factor authentication" })).toBeInTheDocument();
    expect(await screen.findByText("7 of 10 left")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "New codes" })).toBeInTheDocument();
  });

  it("issues new codes after the password, then closes on Done", async () => {
    const fetchMock = stubApi(OK);
    const { onClose, user } = renderModal();
    await user.click(screen.getByRole("button", { name: "New codes" }));
    expect(screen.getByRole("dialog", { name: "New backup codes" })).toBeInTheDocument();
    const password = screen.getByLabelText("Current password");
    expect(password).toHaveFocus();
    await user.type(password, "hunter2");
    await user.click(screen.getByRole("button", { name: "Continue" }));

    expect(await screen.findByText("aaaa-1111")).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Save your backup codes" })).toBeInTheDocument();
    const [, init] = calls(fetchMock, "POST", "/auth/mfa/recovery/regenerate")[0];
    expect(JSON.parse(init!.body as string)).toEqual({ reauth: "tok-1" });
    await user.click(screen.getByRole("button", { name: "Done" }));
    expect(onClose).toHaveBeenCalled();
  });

  it("goes back to the menu when New codes is cancelled", async () => {
    stubApi(OK);
    const { onClose, user } = renderModal();
    await user.click(screen.getByRole("button", { name: "New codes" }));
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByRole("dialog", { name: "Two-factor authentication" })).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("opens straight on turning off, and Cancel closes without turning it off", async () => {
    const fetchMock = stubApi(OK);
    const { onClose, user } = renderModal("turnOff");
    expect(screen.getByRole("dialog", { name: "Turn off two-factor?" })).toBeInTheDocument();
    expect(screen.getByText("You'll sign in with your password only.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Turn off" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalled();
    expect(calls(fetchMock, "DELETE", "/auth/mfa/totp")).toHaveLength(0);
  });

  it("turns two-factor off with the reauth token and closes", async () => {
    const fetchMock = stubApi(OK);
    const { onClose, user } = renderModal("turnOff");
    await user.type(screen.getByLabelText("Current password"), "hunter2");
    await user.click(screen.getByRole("button", { name: "Turn off" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    const deletes = calls(fetchMock, "DELETE", "/auth/mfa/totp");
    expect(deletes).toHaveLength(1);
    expect(JSON.parse(deletes[0][1]!.body as string)).toEqual({ reauth: "tok-1" });
  });

  it("says when the password is wrong and stays open", async () => {
    const fetchMock = stubApi({ ...OK, "POST /auth/reauth": { status: 400 } });
    const { onClose, user } = renderModal("turnOff");
    await user.type(screen.getByLabelText("Current password"), "nope");
    await user.click(screen.getByRole("button", { name: "Turn off" }));
    expect(await screen.findByText("Wrong password.")).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    expect(calls(fetchMock, "DELETE", "/auth/mfa/totp")).toHaveLength(0);
  });
});
