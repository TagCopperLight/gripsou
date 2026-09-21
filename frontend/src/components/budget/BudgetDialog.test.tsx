import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { BudgetDialog } from "./BudgetDialog";
import "../../i18n";

function open(props: Partial<Parameters<typeof BudgetDialog>[0]> = {}) {
  const onClose = vi.fn();
  render(
    <BudgetDialog title="Edit category" onClose={onClose} {...props}>
      <input aria-label="Name" />
      <button type="button">Inner</button>
    </BudgetDialog>,
  );
  return { onClose };
}

describe("BudgetDialog", () => {
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
      <BudgetDialog title="Edit category" onClose={() => {}}>
        <input aria-label="Name" />
      </BudgetDialog>,
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
      <BudgetDialog title="Edit category" onClose={onClose} busy={false}>
        <input aria-label="Name" />
      </BudgetDialog>,
    );
    rerender(
      <BudgetDialog title="Edit category" onClose={onClose} busy={true}>
        <input aria-label="Name" />
      </BudgetDialog>,
    );
    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.click(screen.getByTestId("dialog-backdrop"));
    expect(onClose).not.toHaveBeenCalled();
  });

  it("locks body scroll while open and restores the previous value", () => {
    document.body.style.overflow = "auto";
    const { unmount } = render(
      <BudgetDialog title="X" onClose={() => {}}>
        <input aria-label="Name" />
      </BudgetDialog>,
    );
    expect(document.body.style.overflow).toBe("hidden");
    unmount();
    expect(document.body.style.overflow).toBe("auto");
  });
});
