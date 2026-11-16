import { describe, it, expect } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { HoldingBadge } from "./HoldingBadge";

describe("HoldingBadge", () => {
  it("falls back to the initials when the logo fails to load", () => {
    const { container } = render(<HoldingBadge logo="https://cdn.example/missing" ticker="BNP Paribas" />);
    fireEvent.error(container.querySelector("img")!);
    expect(screen.getByText("BN")).toBeInTheDocument();
    expect(container.querySelector("img")).toBeNull();
  });
});
