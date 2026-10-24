import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Avatar } from "./Avatar";

describe("Avatar", () => {
  it("shows two-letter initials from the first two words", () => {
    render(<Avatar name="Jules Bernard" />);
    expect(screen.getByText("JB")).toBeInTheDocument();
  });

  it("falls back to the first two letters of a single name", () => {
    render(<Avatar name="Dev" />);
    expect(screen.getByText("DE")).toBeInTheDocument();
  });

  it("sizes the initials from the circle, whatever size the caller gives it", () => {
    render(<Avatar name="Jules Bernard" className="size-24" />);
    const initials = screen.getByText("JB");
    expect(initials).toHaveClass("font-wordmark", "text-[32cqw]");
    expect(initials.closest(".\\@container")).toHaveClass("size-24");
  });

  it("tints the initials with the given color", () => {
    render(<Avatar name="Jules Bernard" color="#5b9bf0" />);
    expect(screen.getByText("JB").parentElement).toHaveStyle({ color: "#5b9bf0" });
  });

  it("renders an image when src is provided", () => {
    render(<Avatar name="Jules Bernard" src="data:image/webp;base64,UklGRg==" />);
    // alt="" makes the img decorative (role="presentation"); query by tag instead.
    const img = document.querySelector("img");
    expect(img).not.toBeNull();
    expect(img).toHaveAttribute("src", "data:image/webp;base64,UklGRg==");
    expect(screen.queryByText("JB")).not.toBeInTheDocument();
  });
});
