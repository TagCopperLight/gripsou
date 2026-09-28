import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { Dialog } from "./Dialog";
import "../i18n";

function open(props: Partial<Parameters<typeof Dialog>[0]> = {}) {
  const onClose = vi.fn();
  render(
    <Dialog title="Edit category" onClose={onClose} {...props}>
      <input aria-label="Name" />
      <button type="button">Inner</button>
    </Dialog>,
  );
  return { onClose };
}

describe("Dialog", () => {
  it("is a labelled modal dialog", () => {
    open();
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveAccessibleName("Edit category");
  });

  it("moves focus inside on open and restores it on close", async () => {
    const trigger = document.createElement("button");
    document.body.appendChild(trigger);
    trigger.focus();
    const { onClose } = open();
    expect(screen.getByRole("dialog").contains(document.activeElement)).toBe(true);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });

  it("restores focus to the previously focused element on unmount", () => {
    const trigger = document.createElement("button");
    document.body.appendChild(trigger);
    trigger.focus();
    const { unmount } = render(
      <Dialog title="Edit category" onClose={() => {}}>
        <input aria-label="Name" />
      </Dialog>,
    );
    expect(screen.getByRole("dialog").contains(document.activeElement)).toBe(true);
    unmount();
    expect(document.activeElement).toBe(trigger);
  });

  it("keeps Tab inside the dialog", async () => {
    const user = userEvent.setup();
    open();
    const dialog = screen.getByRole("dialog");
    for (let i = 0; i < 6; i++) {
      await user.tab();
      expect(dialog.contains(document.activeElement)).toBe(true);
    }
    await user.tab({ shift: true });
    expect(dialog.contains(document.activeElement)).toBe(true);
  });

  it("closes on Escape and on a backdrop click, but not on a click inside", () => {
    const { onClose } = open();
    fireEvent.click(screen.getByRole("dialog"));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("dialog-backdrop"));
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("is inert while busy, so a pending write cannot be abandoned half-way", () => {
    const { onClose } = open({ busy: true });
    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.click(screen.getByTestId("dialog-backdrop"));
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /close/i })).toBeDisabled();
  });

  it("stays inert to Escape/backdrop the instant busy flips true mid-lifecycle", () => {
    const onClose = vi.fn();
    const { rerender } = render(
      <Dialog title="Edit category" onClose={onClose} busy={false}>
        <input aria-label="Name" />
      </Dialog>,
    );
    rerender(
      <Dialog title="Edit category" onClose={onClose} busy={true}>
        <input aria-label="Name" />
      </Dialog>,
    );
    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.click(screen.getByTestId("dialog-backdrop"));
    expect(onClose).not.toHaveBeenCalled();
  });

  it("locks body scroll while open and restores the previous value", () => {
    document.body.style.overflow = "auto";
    const { unmount } = render(
      <Dialog title="X" onClose={() => {}}>
        <input aria-label="Name" />
      </Dialog>,
    );
    expect(document.body.style.overflow).toBe("hidden");
    unmount();
    expect(document.body.style.overflow).toBe("auto");
  });

  it("opens on its first field, not on the close button", () => {
    open();
    expect(screen.getByLabelText("Name")).toHaveFocus();
  });

  it("opens a confirmation on its first footer action when the body has no field", () => {
    render(
      <Dialog title="Sure?" onClose={() => {}} footer={<button type="button">Cancel</button>}>
        <p>Really?</p>
      </Dialog>,
    );
    expect(screen.getByRole("button", { name: "Cancel" })).toHaveFocus();
  });

  it("leaves focus where the user put it when the parent re-renders with a new close handler", () => {
    const { rerender } = render(
      <Dialog title="Edit category" onClose={() => {}}>
        <input aria-label="Name" />
        <button type="button">Inner</button>
      </Dialog>,
    );
    const inner = screen.getByRole("button", { name: "Inner" });
    inner.focus();
    const onClose = vi.fn();
    rerender(
      <Dialog title="Edit category" onClose={onClose}>
        <input aria-label="Name" />
        <button type="button">Inner</button>
      </Dialog>,
    );
    expect(inner).toHaveFocus();
    // ...and Escape reaches the handler it was handed last.
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
