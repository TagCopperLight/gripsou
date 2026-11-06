import { describe, it, expect, vi, afterEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";

import { Budget } from "./Budget";
import { renderWithApp, stubFetch } from "../../test/kit";

const navigate = vi.fn();
let pathname = "/budget/transactions";

vi.mock("@tanstack/react-router", () => ({
  Outlet: () => <div data-testid="outlet" />,
  useNavigate: () => navigate,
  useMatchRoute: () => ({ to }: { to: string }) => to === pathname,
}));

function status(reviewCount: number) {
  stubFetch(async () =>
      new Response(
        JSON.stringify({ configured: true, running: false, remaining: 0, reviewCount, lastRun: null }),
        { status: 200, headers: { "content-type": "application/json" } },
      ));
}

function renderShell() {
  return renderWithApp(<Budget />);
}

afterEach(() => {
  vi.unstubAllGlobals();
  pathname = "/budget/transactions";
});

describe("Budget shell", () => {
  it("reads a bare /budget as Overview, where the router sends it", async () => {
    pathname = "/budget";
    status(0);
    renderShell();
    await waitFor(() => expect(screen.getAllByRole("radio")).toHaveLength(2));
    expect(screen.getByRole("radio", { name: "Overview" })).toHaveAttribute("aria-checked", "true");
  });

  it("has no Review segment when the queue is empty", async () => {
    status(0);
    renderShell();
    await waitFor(() => expect(screen.getAllByRole("radio")).toHaveLength(2));
  });

  it("shows the count in amber when rows need review", async () => {
    status(4);
    renderShell();
    const seg = await screen.findByTestId("review-segment");
    expect(seg).toHaveTextContent("4");
    expect(seg.closest("button")).toHaveClass("bg-amber-soft");
  });

  it("reads Review while in Review mode", async () => {
    pathname = "/budget/review";
    status(4);
    renderShell();
    await waitFor(() => expect(screen.getAllByRole("radio")[2]).toHaveTextContent("Review"));
    expect(screen.getAllByRole("radio")[2]).toHaveAttribute("aria-checked", "true");
  });

  it("keeps the segment in Review mode after the queue drains", async () => {
    pathname = "/budget/review";
    status(0);
    renderShell();
    await waitFor(() => expect(screen.getAllByRole("radio")).toHaveLength(3));
  });

  it("navigates when the mode changes", async () => {
    status(0);
    renderShell();
    fireEvent.click(screen.getAllByRole("radio")[0]);
    expect(navigate).toHaveBeenCalledWith({ to: "/budget/overview" });
  });
});
