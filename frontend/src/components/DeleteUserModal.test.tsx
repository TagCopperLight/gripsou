import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { DeleteUserModal } from "./DeleteUserModal";
import type { User } from "../api/types";

const USER: User = {
  id: "u2",
  name: "Marie Laurent",
  email: "marie@gripsou.local",
  role: "user",
  joinedAt: 1_710_000_000_000,
  isSelf: false,
};

function withClient(children: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe("DeleteUserModal", () => {
  it("enables Delete only once the typed email matches", () => {
    render(withClient(<DeleteUserModal user={USER} onClose={() => {}} onDeleted={() => {}} />));
    const btn = screen.getByRole("button", { name: "Delete user" });
    expect(btn).toBeDisabled();
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "marie@gripsou.local" },
    });
    expect(btn).toBeEnabled();
  });
});
