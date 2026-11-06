import { describe, it, expect } from "vitest";
import { screen, fireEvent } from "@testing-library/react";
import { DeleteUserModal } from "./DeleteUserModal";
import type { User } from "../../../api/types";
import { renderWithApp } from "../../../test/kit";

const USER: User = {
  id: "u2",
  name: "Marie Laurent",
  email: "marie@gripsou.local",
  role: "user",
  joinedAt: 1_710_000_000_000,
  isSelf: false,
};

describe("DeleteUserModal", () => {
  it("enables Delete only once the typed email matches", () => {
    renderWithApp(<DeleteUserModal user={USER} onClose={() => {}} onDeleted={() => {}} />);
    const btn = screen.getByRole("button", { name: "Delete user" });
    expect(btn).toBeDisabled();
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "marie@gripsou.local" },
    });
    expect(btn).toBeEnabled();
  });
});
