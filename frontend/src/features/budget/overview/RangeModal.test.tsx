import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import { RangeModal } from "./RangeModal";

function renderModal() {
  const onApply = vi.fn();
  const onClose = vi.fn();
  render(<RangeModal onApply={onApply} onClose={onClose} />);
  return { onApply, onClose };
}

describe("RangeModal", () => {
  beforeEach(() => {
    // Only `Date` is faked: the dialog's own timers must keep running.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 8, 21, 12)); // 21 September 2026, local
  });
  afterEach(() => vi.useRealTimers());

  it("resolves 'Last 12 months' to the rolling window ending today", () => {
    const { onApply } = renderModal();
    fireEvent.click(screen.getByText("Last 12 months"));
    expect(onApply).toHaveBeenCalledWith({ from: "2025-09-21", to: "2026-09-21" });
  });

  it("stops 'This year' at today rather than 31 December", () => {
    const { onApply } = renderModal();
    fireEvent.click(screen.getByText("This year"));
    expect(onApply).toHaveBeenCalledWith({ from: "2026-01-01", to: "2026-09-21" });
  });

  it("resolves 'Last year' to the whole previous calendar year", () => {
    const { onApply } = renderModal();
    fireEvent.click(screen.getByText("Last year"));
    expect(onApply).toHaveBeenCalledWith({ from: "2025-01-01", to: "2025-12-31" });
  });

  it("applies typed dates only once both are set and in order", () => {
    const { onApply } = renderModal();
    const apply = screen.getByRole("button", { name: "Apply" });
    expect(apply).toBeDisabled();

    const [from, to] = document.querySelectorAll<HTMLInputElement>('input[type="date"]');
    fireEvent.change(from, { target: { value: "2026-03-10" } });
    fireEvent.change(to, { target: { value: "2026-03-01" } });
    expect(apply).toBeDisabled();

    fireEvent.change(to, { target: { value: "2026-04-02" } });
    expect(apply).toBeEnabled();
    fireEvent.click(apply);
    expect(onApply).toHaveBeenCalledWith({ from: "2026-03-10", to: "2026-04-02" });
  });
});
