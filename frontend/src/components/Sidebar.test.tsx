import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { Sidebar } from "./Sidebar";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children: ReactNode }) => <a>{children}</a>,
}));
vi.mock("../auth/context", () => ({
  useAuth: () => ({ user: { name: "Tag", role: "admin", prefs: {} } }),
}));

const mockUseHealth = vi.fn();
vi.mock("../api/hooks", () => ({ useHealth: () => mockUseHealth() }));

describe("Sidebar", () => {
  it("renders the version once it has loaded", () => {
    mockUseHealth.mockReturnValue({ data: { status: "ok", version: "v1.3.0-9-gd5fd32d" } });
    render(<Sidebar />);
    expect(screen.getByText("v1.3.0-9-gd5fd32d")).toBeInTheDocument();
  });

  it("renders nothing in place of the version while it is pending", () => {
    mockUseHealth.mockReturnValue({ data: undefined });
    const { container } = render(<Sidebar />);
    expect(
      container.querySelector("span.hidden.px-3.pb-1.text-\\[11px\\].text-fg-faint.md\\:block"),
    ).toBeNull();
  });
});
