import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { User } from "../api/types";
import { UserDetailModal } from "./UserDetailModal";

const user: User = {
  id: "u2",
  name: "Aurélien BOURDET",
  email: "test@gmail.com",
  role: "user",
  joinedAt: Date.UTC(2026, 5, 20),
  isSelf: false,
};

describe("UserDetailModal", () => {
  it("shows the email and joined date the summary row omits", () => {
    render(
      <UserDetailModal user={user} role="user" onToggleRole={() => {}} onClose={() => {}} />,
    );
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("test@gmail.com")).toBeInTheDocument();
    expect(screen.getByText(/2026/)).toBeInTheDocument();
  });

  it("toggles the role from the badge", () => {
    const onToggleRole = vi.fn();
    render(
      <UserDetailModal
        user={user}
        role="user"
        onToggleRole={onToggleRole}
        onClose={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Member" }));
    expect(onToggleRole).toHaveBeenCalled();
  });

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
