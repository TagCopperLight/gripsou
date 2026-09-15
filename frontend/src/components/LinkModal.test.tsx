import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { LinkModal } from "./LinkModal";

describe("LinkModal", () => {
  it("copies the link to the clipboard", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    render(
      <LinkModal
        title="Invite a new user"
        subtitle="Share this one-time link"
        body="Body"
        link="https://x.test/invite/abc"
        error={false}
        onClose={() => {}}
      />,
    );
    fireEvent.click(screen.getByLabelText("Copy link"));
    // The handler awaits `writeText` before flipping to the tick icon, so the
    // state update lands a microtask after the click — waiting for the icon
    // keeps that update inside act(...).
    expect(writeText).toHaveBeenCalledWith("https://x.test/invite/abc");
    await waitFor(() =>
      expect(screen.getByLabelText("Copy link").querySelector(".lucide-check")).not.toBeNull(),
    );
  });

  it("disables copy while the link is loading", () => {
    render(
      <LinkModal
        title="T"
        subtitle="S"
        body="B"
        link={null}
        error={false}
        onClose={() => {}}
      />,
    );
    expect(screen.getByLabelText("Copy link")).toBeDisabled();
  });
});
