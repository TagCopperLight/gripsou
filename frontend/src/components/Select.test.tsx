import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Select } from "./Select";

const OPTIONS = [
  { value: "checking", label: "Checking" },
  { value: "savings", label: "Savings account" },
];

describe("Select", () => {
  it("shows the selected label and opens to reveal options", () => {
    render(<Select value="checking" onChange={() => {}} options={OPTIONS} />);
    expect(screen.getByText("Checking")).toBeInTheDocument();
    // List is closed: the other option is not rendered yet.
    expect(screen.queryByText("Savings account")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button"));
    expect(screen.getByText("Savings account")).toBeInTheDocument();
  });

  it("calls onChange with the chosen value and closes", () => {
    const onChange = vi.fn();
    render(<Select value="checking" onChange={onChange} options={OPTIONS} />);
    fireEvent.click(screen.getByRole("button"));
    fireEvent.click(screen.getByText("Savings account"));
    expect(onChange).toHaveBeenCalledWith("savings");
    expect(screen.queryByText("Savings account")).not.toBeInTheDocument();
  });
});
