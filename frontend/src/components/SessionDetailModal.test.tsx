import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { Session } from "../api/types";
import { SessionDetailModal } from "./SessionDetailModal";

const session: Session = {
  id: "s1",
  device: "Firefox on Android",
  ip: "127.0.0.1",
  createdAt: 0,
  lastActiveAt: 0,
  remembered: true,
  current: false,
};

describe("SessionDetailModal", () => {
  it("shows the device, IP and remembered badge", () => {
    render(<SessionDetailModal session={session} onClose={() => {}} />);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Firefox on Android" })).toBeInTheDocument();
    expect(screen.getByText("127.0.0.1")).toBeInTheDocument();
    expect(screen.getByText(/remembered · 30 days/i)).toBeInTheDocument();
  });

  it("calls onRevoke when Log out is clicked", () => {
    const onRevoke = vi.fn();
    render(
      <SessionDetailModal session={session} onRevoke={onRevoke} onClose={() => {}} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Log out" }));
    expect(onRevoke).toHaveBeenCalled();
  });

  it("offers no Log out for the current session", () => {
    render(
      <SessionDetailModal
        session={{ ...session, current: true }}
        onClose={() => {}}
      />,
    );
    expect(screen.getByText(/this device/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Log out" })).toBeNull();
  });
});
