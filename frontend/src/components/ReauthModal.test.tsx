import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReauthModal } from "./ReauthModal";

function renderModal(onConfirmed = vi.fn(), onClose = vi.fn()) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <ReauthModal onConfirmed={onConfirmed} onClose={onClose} />
    </QueryClientProvider>,
  );
  return { onConfirmed, onClose };
}

function submit(password = "hunter2hunter2") {
  fireEvent.change(screen.getByLabelText("Password"), { target: { value: password } });
  fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
}

describe("ReauthModal", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("hands the reauth token to onConfirmed", async () => {
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ reauth: "tok-1" }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const { onConfirmed } = renderModal();
    expect(screen.getByRole("dialog", { name: "Confirm it's you" })).toBeInTheDocument();
    submit();
    await waitFor(() => expect(onConfirmed).toHaveBeenCalledWith("tok-1"));
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/auth/reauth",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ password: "hunter2hunter2" }) }),
    );
  });

  it("says so when the password is wrong", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("bad", { status: 400 })));
    const { onConfirmed } = renderModal();
    submit("nope");
    expect(await screen.findByText("Incorrect password.")).toBeInTheDocument();
    expect(onConfirmed).not.toHaveBeenCalled();
  });

  it("shows the wait in minutes when throttled", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("slow", { status: 429, headers: { "Retry-After": "90" } })),
    );
    renderModal();
    submit();
    expect(await screen.findByText("Too many attempts. Try again in 2 minutes.")).toBeInTheDocument();
  });

  it("keeps Confirm disabled until a password is typed", () => {
    renderModal();
    expect(screen.getByRole("button", { name: "Confirm" })).toBeDisabled();
  });
});
