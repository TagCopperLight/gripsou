import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Select } from "./Select";

const OPTIONS = [
  { value: "checking", label: "Checking" },
  { value: "savings", label: "Savings" },
];

describe("Select", () => {
  it("shows the selected label and opens to reveal options", () => {
    render(<Select value="checking" onChange={() => {}} options={OPTIONS} />);
    expect(screen.getByText("Checking")).toBeInTheDocument();
    // List is closed: the other option is not rendered yet.
    expect(screen.queryByText("Savings")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button"));
    expect(screen.getByText("Savings")).toBeInTheDocument();
  });

  it("calls onChange with the chosen value and closes", () => {
    const onChange = vi.fn();
    render(<Select value="checking" onChange={onChange} options={OPTIONS} />);
    fireEvent.click(screen.getByRole("button"));
    fireEvent.click(screen.getByText("Savings"));
    expect(onChange).toHaveBeenCalledWith("savings");
    expect(screen.queryByText("Savings")).not.toBeInTheDocument();
  });

  it("opens its menu outside a clipping container, and closes on a click outside", () => {
    const { container } = render(
      <div className="overflow-y-auto">
        <Select value="checking" onChange={() => {}} options={OPTIONS} />
      </div>,
    );
    fireEvent.click(screen.getByRole("button"));
    const option = screen.getByText("Savings");
    // Portalled to the body, so a scrolling dialog cannot clip it.
    expect(container.contains(option)).toBe(false);
    // A click on the menu itself is not "outside".
    fireEvent.mouseDown(option);
    expect(screen.getByText("Savings")).toBeInTheDocument();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByText("Savings")).not.toBeInTheDocument();
  });
});
