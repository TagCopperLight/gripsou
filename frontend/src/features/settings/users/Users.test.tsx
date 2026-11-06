import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { SettingsUsers } from "./Users";
import type { User } from "../../../api/types";
import { renderWithApp, jsonResponse, stubFetch } from "../../../test/kit";

const USERS: User[] = [
  { id: "u1", name: "Jules Bernard", email: "jules@gripsou.local", role: "admin", joinedAt: 1_700_000_000_000, isSelf: true },
  { id: "u2", name: "Marie Laurent", email: "marie@gripsou.local", role: "user", joinedAt: 1_710_000_000_000, isSelf: false },
  { id: "u3", name: "Thomas Caron", email: "thomas@gripsou.local", role: "user", joinedAt: 1_720_000_000_000, isSelf: false },
];

describe("SettingsUsers", () => {
  beforeEach(() => {
    stubFetch(async () => jsonResponse(USERS));
  });

  it("renders a row per user", async () => {
    renderWithApp(<SettingsUsers />);
    // Phone and desktop layouts are both in the DOM (CSS picks one).
    expect(await screen.findAllByText("Marie Laurent")).not.toHaveLength(0);
    expect(screen.getAllByText("Thomas Caron")).not.toHaveLength(0);
  });

  it("shows reset and delete only for other users, not the self row", async () => {
    renderWithApp(<SettingsUsers />);
    await screen.findAllByText("Marie Laurent");
    // The self row has no actions: its password lives in the Account tab.
    expect(screen.getAllByLabelText("Reset password")).toHaveLength(2);
    expect(screen.getAllByLabelText("Delete user")).toHaveLength(2);
  });

  it("locks the self row's role (a non-button badge)", async () => {
    renderWithApp(<SettingsUsers />);
    await screen.findAllByText("Jules Bernard");
    // Only the self row is Admin; it must not be a clickable button.
    expect(screen.queryByRole("button", { name: "Admin" })).toBeNull();
  });

  it("saves a member's new role on the server", async () => {
    renderWithApp(<SettingsUsers />);
    await screen.findAllByText("Marie Laurent");
    fireEvent.click(screen.getAllByRole("button", { name: "Member" })[0]);
    await waitFor(() =>
      expect(vi.mocked(fetch)).toHaveBeenCalledWith(
        "/api/users/u2",
        expect.objectContaining({ method: "PATCH", body: JSON.stringify({ role: "admin" }) }),
      ),
    );
  });


});
