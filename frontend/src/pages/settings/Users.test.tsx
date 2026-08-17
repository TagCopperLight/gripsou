import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { SettingsUsers } from "./Users";
import type { User } from "../../api/types";

const USERS: User[] = [
  { id: "u1", name: "Julien Bourdet", email: "julien@gripsou.local", role: "admin", joinedAt: 1_700_000_000_000, isSelf: true },
  { id: "u2", name: "Marie Laurent", email: "marie@gripsou.local", role: "user", joinedAt: 1_710_000_000_000, isSelf: false },
  { id: "u3", name: "Thomas Caron", email: "thomas@gripsou.local", role: "user", joinedAt: 1_720_000_000_000, isSelf: false },
];

function withClient(children: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe("SettingsUsers", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response(JSON.stringify(USERS), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    ));
  });

  it("renders a row per user with the member count", async () => {
    render(withClient(<SettingsUsers />));
    // Phone and desktop layouts are both in the DOM (CSS picks one).
    expect(await screen.findAllByText("Marie Laurent")).not.toHaveLength(0);
    expect(screen.getByText(/3 members/)).toBeInTheDocument();
  });

  it("shows reset and delete only for other users, not the self row", async () => {
    render(withClient(<SettingsUsers />));
    await screen.findAllByText("Marie Laurent");
    // The self row has no actions: its password lives in the Account tab.
    expect(screen.getAllByLabelText("Reset password")).toHaveLength(2);
    expect(screen.getAllByLabelText("Delete user")).toHaveLength(2);
  });

  it("locks the self row's role (a non-button badge)", async () => {
    render(withClient(<SettingsUsers />));
    await screen.findAllByText("Julien Bourdet");
    // Only the self row is Admin; it must not be a clickable button.
    expect(screen.queryByRole("button", { name: "Admin" })).toBeNull();
  });

  it("toggles a member's role locally on click", async () => {
    render(withClient(<SettingsUsers />));
    await screen.findAllByText("Marie Laurent");
    const memberTags = screen.getAllByRole("button", { name: "Member" });
    expect(memberTags).toHaveLength(2);
    fireEvent.click(memberTags[0]);
    expect(screen.getByRole("button", { name: "Admin" })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Member" })).toHaveLength(1);
  });

  it("renders the Invite user button", async () => {
    render(withClient(<SettingsUsers />));
    await screen.findAllByText("Marie Laurent");
    expect(screen.getByRole("button", { name: "Invite user" })).toBeInTheDocument();
  });
});
