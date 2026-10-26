import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { PasskeysModal } from "./PasskeysModal";
import { formatDate, formatRelative } from "../lib/date";

type Pk = { id: string; name: string; createdAt: number; lastUsedAt: number | null };

const CREATED = 1_760_000_000_000;
const USED = Date.now() - 3 * 3_600_000;
const MAC: Pk = { id: "p1", name: "MacBook", createdAt: CREATED, lastUsedAt: USED };
const PHONE: Pk = { id: "p2", name: "Phone", createdAt: CREATED, lastUsedAt: null };

/** A fetch backed by a mutable passkey list, so refetches see renames/deletes.
 *  `fail` makes PATCH/DELETE answer 500. */
function stubApi(initial: Pk[], fail = false) {
  let list = [...initial];
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    const path = url.replace(/^\/api/, "");
    if (path === "/auth/mfa/status") {
      return new Response(
        JSON.stringify({ totp: false, recoveryRemaining: 0, passkeys: list }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }
    if (fail) return new Response("boom", { status: 500 });
    const id = path.replace("/auth/mfa/passkeys/", "");
    if (method === "PATCH") {
      const { name } = JSON.parse(init!.body as string);
      list = list.map((p) => (p.id === id ? { ...p, name } : p));
    } else if (method === "DELETE") {
      list = list.filter((p) => p.id !== id);
    }
    return new Response(null, { status: 204 });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const writes = (f: ReturnType<typeof stubApi>) =>
  f.mock.calls.filter(([, init]) => (init?.method ?? "GET") !== "GET");

async function renderModal() {
  const onClose = vi.fn();
  const onAdd = vi.fn();
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <PasskeysModal onClose={onClose} onAdd={onAdd} />
    </QueryClientProvider>,
  );
  return { onClose, onAdd, user: userEvent.setup() };
}

afterEach(() => vi.unstubAllGlobals());

describe("PasskeysModal list", () => {
  it("lists each passkey with its added date and, when known, last use", async () => {
    stubApi([MAC, PHONE]);
    await renderModal();
    expect(screen.getByRole("dialog", { name: "Passkeys" })).toBeInTheDocument();
    expect(await screen.findByText("MacBook")).toBeInTheDocument();
    expect(
      screen.getByText(`Added ${formatDate(CREATED)} · Last used ${formatRelative(USED)}`),
    ).toBeInTheDocument();
    expect(screen.getByText("Phone")).toBeInTheDocument();
    expect(screen.getByText(`Added ${formatDate(CREATED)}`)).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Rename" })).toHaveLength(2);
    expect(screen.getAllByRole("button", { name: "Delete" })).toHaveLength(2);
  });

});

describe("PasskeysModal rename", () => {
  it("saves the trimmed name on Enter", async () => {
    const f = stubApi([MAC, PHONE]);
    const { user } = await renderModal();
    await screen.findByText("MacBook");
    await user.click(screen.getAllByRole("button", { name: "Rename" })[0]);
    const input = screen.getByRole("textbox", { name: "Passkey name" });
    expect(input).toHaveValue("MacBook");
    await user.clear(input);
    await user.type(input, "  Work laptop  {Enter}");
    expect(await screen.findByText("Work laptop")).toBeInTheDocument();
    const [url, init] = writes(f)[0];
    expect(url).toBe("/api/auth/mfa/passkeys/p1");
    expect(init?.method).toBe("PATCH");
    expect(JSON.parse(init!.body as string)).toEqual({ name: "Work laptop" });
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("saves on blur", async () => {
    const f = stubApi([MAC]);
    const { user } = await renderModal();
    await screen.findByText("MacBook");
    await user.click(screen.getByRole("button", { name: "Rename" }));
    const input = screen.getByRole("textbox", { name: "Passkey name" });
    await user.clear(input);
    await user.type(input, "Laptop");
    await user.tab();
    expect(await screen.findByText("Laptop")).toBeInTheDocument();
    expect(writes(f)).toHaveLength(1);
  });

  it("does not call the server when the name is unchanged or empty", async () => {
    const f = stubApi([MAC]);
    const { user } = await renderModal();
    await screen.findByText("MacBook");
    await user.click(screen.getByRole("button", { name: "Rename" }));
    await user.type(screen.getByRole("textbox"), "{Enter}");
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Rename" }));
    await user.clear(screen.getByRole("textbox"));
    await user.type(screen.getByRole("textbox"), "   {Enter}");
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.getByText("MacBook")).toBeInTheDocument();
    expect(writes(f)).toHaveLength(0);
  });

  it("cancels on Escape without closing the window", async () => {
    const f = stubApi([MAC]);
    const { onClose, user } = await renderModal();
    await screen.findByText("MacBook");
    await user.click(screen.getByRole("button", { name: "Rename" }));
    const input = screen.getByRole("textbox");
    await user.clear(input);
    await user.type(input, "Nope");
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.getByText("MacBook")).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Passkeys" })).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    expect(writes(f)).toHaveLength(0);
  });

  it("shows an error when the rename fails", async () => {
    stubApi([MAC], true);
    const { user } = await renderModal();
    await screen.findByText("MacBook");
    await user.click(screen.getByRole("button", { name: "Rename" }));
    await user.clear(screen.getByRole("textbox"));
    await user.type(screen.getByRole("textbox"), "Other{Enter}");
    expect(await screen.findByText("Something went wrong. Try again.")).toBeInTheDocument();
    expect(screen.getByText("MacBook")).toBeInTheDocument();
  });
});

describe("PasskeysModal delete", () => {
  async function askDelete(user: ReturnType<typeof userEvent.setup>, index: number) {
    await screen.findByText("MacBook");
    await user.click(screen.getAllByRole("button", { name: "Delete" })[index]);
  }

  it("asks for confirmation and Cancel goes back to the list", async () => {
    const f = stubApi([MAC, PHONE]);
    const { user } = await renderModal();
    await askDelete(user, 0);
    const dialog = screen.getByRole("dialog", { name: "Delete MacBook?" });
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.getByRole("dialog", { name: "Passkeys" })).toBeInTheDocument();
    expect(screen.getByText("MacBook")).toBeInTheDocument();
    expect(writes(f)).toHaveLength(0);
  });

  it("deletes and returns to the list when other passkeys remain", async () => {
    const f = stubApi([MAC, PHONE]);
    const { onClose, user } = await renderModal();
    await askDelete(user, 0);
    const dialog = screen.getByRole("dialog", { name: "Delete MacBook?" });
    await user.click(within(dialog).getByRole("button", { name: "Delete" }));
    expect(await screen.findByRole("dialog", { name: "Passkeys" })).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText("MacBook")).not.toBeInTheDocument());
    expect(screen.getByText("Phone")).toBeInTheDocument();
    const [url, init] = writes(f)[0];
    expect(url).toBe("/api/auth/mfa/passkeys/p1");
    expect(init?.method).toBe("DELETE");
    expect(onClose).not.toHaveBeenCalled();
  });

  it("closes the window when the last passkey is deleted", async () => {
    stubApi([MAC]);
    const { onClose, user } = await renderModal();
    await askDelete(user, 0);
    const dialog = screen.getByRole("dialog", { name: "Delete MacBook?" });
    await user.click(within(dialog).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it("shows an error and stays on the confirmation when the delete fails", async () => {
    stubApi([MAC, PHONE], true);
    const { onClose, user } = await renderModal();
    await askDelete(user, 0);
    const dialog = screen.getByRole("dialog", { name: "Delete MacBook?" });
    await user.click(within(dialog).getByRole("button", { name: "Delete" }));
    expect(await screen.findByText("Something went wrong. Try again.")).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Delete MacBook?" })).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });
});
