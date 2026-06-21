import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { LinkModal } from "./LinkModal";

describe("LinkModal", () => {
  it("copies the link to the clipboard", () => {
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
    expect(writeText).toHaveBeenCalledWith("https://x.test/invite/abc");
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
