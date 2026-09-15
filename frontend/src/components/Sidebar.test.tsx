import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { Sidebar } from "./Sidebar";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children: ReactNode }) => <a>{children}</a>,
}));
let role = "admin";
vi.mock("../auth/context", () => ({
  useAuth: () => ({ user: { name: "Tag", role, prefs: {} } }),
}));

const mockUseHealth = vi.fn();
vi.mock("../api/hooks", () => ({ useHealth: () => mockUseHealth() }));

describe("Sidebar", () => {
  beforeEach(() => {
    role = "admin";
  });

  // Regression: the member label used to be read from `settings.roleMember`,
  // a key that does not exist, so every member saw the raw key string.
  it.each([
    ["admin", "Admin"],
    ["member", "Member"],
  ])("renders the %s role label", (userRole, label) => {
    role = userRole;
    mockUseHealth.mockReturnValue({ data: undefined });
    render(<Sidebar />);
    expect(screen.getByText(label)).toBeInTheDocument();
  });

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
