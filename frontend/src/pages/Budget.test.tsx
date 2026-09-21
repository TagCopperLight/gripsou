import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import { Budget } from "./Budget";

const navigate = vi.fn();

vi.mock("@tanstack/react-router", () => ({
  Outlet: () => <div data-testid="outlet" />,
  useNavigate: () => navigate,
  useRouterState: () => ({ location: { pathname: "/budget/transactions" } }),
}));

describe("Budget shell", () => {
  it("names the page and renders the active mode", () => {
    render(<Budget />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Budget");
    expect(screen.getByTestId("outlet")).toBeVisible();
  });

  it("offers Overview and Transactions, with Transactions active", () => {
    render(<Budget />);
    const radios = screen.getAllByRole("radio");
    expect(radios).toHaveLength(2);
    expect(radios[1]).toHaveAttribute("aria-checked", "true");
  });

  it("has no Review segment in this phase", () => {
    render(<Budget />);
    expect(screen.queryByText(/review/i)).toBeNull();
  });

  it("navigates when the mode changes", () => {
    render(<Budget />);
    fireEvent.click(screen.getAllByRole("radio")[0]);
    expect(navigate).toHaveBeenCalledWith({ to: "/budget/overview" });
  });
});
