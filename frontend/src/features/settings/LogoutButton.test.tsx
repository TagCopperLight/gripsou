import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent } from "@testing-library/react";
import { LogoutButton } from "./LogoutButton";
import { authValue, renderWithApp } from "../../test/kit";

const logout = vi.fn();
const navigate = vi.fn();
vi.mock("@tanstack/react-router", () => ({ useNavigate: () => navigate }));

describe("LogoutButton", () => {
  beforeEach(() => {
    logout.mockReset();
    navigate.mockReset();
  });

  it("opens a confirm modal and cancels without logging out", () => {
    renderWithApp(<LogoutButton />, { auth: authValue({ logout }) });
    fireEvent.click(screen.getByRole("button", { name: "Log out" }));
    expect(screen.getByText("Log out?")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByText("Log out?")).toBeNull();
    expect(logout).not.toHaveBeenCalled();
  });

  it("logs out and redirects on confirm", () => {
    renderWithApp(<LogoutButton />, { auth: authValue({ logout }) });
    fireEvent.click(screen.getByRole("button", { name: "Log out" }));
    // Confirm button inside the modal (the second "Log out" button).
    const confirm = screen.getAllByRole("button", { name: "Log out" })[1];
    fireEvent.click(confirm);
    expect(logout).toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith({ to: "/login" });
  });
});
