import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Toggle } from "./Toggle";

describe("Toggle", () => {
  it("exposes switch role and reflects checked state", () => {
    render(<Toggle checked onChange={() => {}} aria-label="Powens" />);
    const sw = screen.getByRole("switch", { name: "Powens" });
    expect(sw).toHaveAttribute("aria-checked", "true");
  });

  it("calls onChange with the negated value", () => {
    const onChange = vi.fn();
    render(<Toggle checked={false} onChange={onChange} />);
    fireEvent.click(screen.getByRole("switch"));
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it("does not fire onChange when disabled", () => {
    const onChange = vi.fn();
    render(<Toggle checked={false} onChange={onChange} disabled />);
    fireEvent.click(screen.getByRole("switch"));
    expect(onChange).not.toHaveBeenCalled();
  });
});
