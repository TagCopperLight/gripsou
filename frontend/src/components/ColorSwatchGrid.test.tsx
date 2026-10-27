import { describe, it, expect, vi, beforeAll } from "vitest";
import { useState } from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ColorSwatchGrid } from "./ColorSwatchGrid";

beforeAll(() => {
  // jsdom draws nothing; the colour area just has no picture.
  HTMLCanvasElement.prototype.getContext = (() => null) as never;
});

function Harness({ onChange }: { onChange: (c: string) => void }) {
  const [color, setColor] = useState("#5b9bf0");
  return (
    <div role="dialog">
      <ColorSwatchGrid
        value={color}
        onChange={(c) => {
          setColor(c);
          onChange(c);
        }}
        swatchLabel={(c) => `Colour ${c}`}
        customLabel="Custom colour"
      />
    </div>
  );
}

describe("ColorSwatchGrid's custom colour", () => {
  it("takes a typed hex code once it is complete", async () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    await userEvent.click(screen.getByRole("button", { name: "Custom colour" }));
    const hex = screen.getByRole("textbox", { name: "Hex code" });
    await userEvent.clear(hex);
    await userEvent.type(hex, "12ab3");
    expect(onChange).not.toHaveBeenCalled();
    await userEvent.type(hex, "c");
    expect(onChange).toHaveBeenLastCalledWith("#12ab3c");
    expect(screen.getByRole("button", { name: "Custom colour" })).toHaveStyle({ background: "#12ab3c" });
  });

  it("closes on Escape without closing the window it is in", async () => {
    const windowEscape = vi.fn();
    document.addEventListener("keydown", windowEscape);
    render(<Harness onChange={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: "Custom colour" }));
    expect(screen.getByRole("slider", { name: "Hue" })).toBeInTheDocument();

    fireEvent.keyDown(screen.getByRole("slider", { name: "Hue" }), { key: "Escape" });
    expect(screen.queryByRole("slider", { name: "Hue" })).not.toBeInTheDocument();
    expect(windowEscape).not.toHaveBeenCalled();
    document.removeEventListener("keydown", windowEscape);
  });

  it("closes on a click outside", async () => {
    render(<Harness onChange={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: "Custom colour" }));
    await userEvent.click(screen.getByRole("button", { name: "Colour #e0605f" }));
    expect(screen.queryByRole("slider", { name: "Hue" })).not.toBeInTheDocument();
  });
});
