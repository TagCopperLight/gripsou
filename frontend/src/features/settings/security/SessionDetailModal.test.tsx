import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import type { Session } from "../../../api/wire";
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
