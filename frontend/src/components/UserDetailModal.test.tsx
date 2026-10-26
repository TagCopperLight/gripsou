import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import type { User } from "../api/types";
import { UserDetailModal } from "./UserDetailModal";

const user: User = {
  id: "u2",
  name: "Aurore BERNARD",
  email: "test@gmail.com",
  role: "user",
  joinedAt: Date.UTC(2026, 5, 20),
  isSelf: false,
};

describe("UserDetailModal", () => {
  it("offers no reset, delete or role change for yourself", () => {
    render(
      <UserDetailModal
        user={{ ...user, isSelf: true }}
        role="admin"
        onToggleRole={() => {}}
        onClose={() => {}}
      />,
    );
    expect(screen.queryByRole("button", { name: /reset password/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /delete user/i })).toBeNull();
    expect(screen.queryByRole("button", { name: "Admin" })).toBeNull();
  });
});
