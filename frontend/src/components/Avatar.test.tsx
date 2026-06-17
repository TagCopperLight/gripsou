import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Avatar } from "./Avatar";

describe("Avatar", () => {
  it("shows two-letter initials from the first two words", () => {
    render(<Avatar name="Julien Bourdet" />);
    expect(screen.getByText("JB")).toBeInTheDocument();
  });

  it("falls back to the first two letters of a single name", () => {
    render(<Avatar name="Dev" />);
    expect(screen.getByText("DE")).toBeInTheDocument();
  });
});
