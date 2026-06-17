import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { SettingsAccount } from "./Account";

function withClient(children: ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

function fillPasswords() {
  fireEvent.change(screen.getByLabelText("Current password"), { target: { value: "old" } });
  fireEvent.change(screen.getByLabelText("New password"), { target: { value: "newpass" } });
  fireEvent.change(screen.getByLabelText("Confirm new password"), { target: { value: "newpass" } });
}

describe("SettingsAccount password update", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("posts to /auth/change-password and shows success", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    render(withClient(<SettingsAccount />));
    fillPasswords();
    fireEvent.click(screen.getByRole("button", { name: "Update password" }));
    expect(await screen.findByText("Password updated")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/auth/change-password",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("shows an error when the current password is wrong", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("bad", { status: 400 })));
    render(withClient(<SettingsAccount />));
    fillPasswords();
    fireEvent.click(screen.getByRole("button", { name: "Update password" }));
    expect(await screen.findByText("Current password is incorrect")).toBeInTheDocument();
  });
});
