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

  it("renders an image when src is provided", () => {
    render(<Avatar name="Julien Bourdet" src="data:image/webp;base64,UklGRg==" />);
    // alt="" makes the img decorative (role="presentation"); query by tag instead.
    const img = document.querySelector("img");
    expect(img).not.toBeNull();
    expect(img).toHaveAttribute("src", "data:image/webp;base64,UklGRg==");
    expect(screen.queryByText("JB")).not.toBeInTheDocument();
  });
});
