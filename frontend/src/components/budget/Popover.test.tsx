import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import { Popover } from "./Popover";

/** jsdom gives every element a zero rect, so the assertions here are about
 *  *which* anchor drives the position and about the close behaviour — not
 *  about pixel values, which only a real layout could produce. */
function renderAt(rect: Partial<DOMRect>, onClose = vi.fn()) {
  const anchor = document.createElement("button");
  document.body.appendChild(anchor);
  anchor.getBoundingClientRect = () => ({ top: 0, left: 0, bottom: 0, right: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => ({}), ...rect }) as DOMRect;
  const result = render(
    <Popover title="Pick one" anchor={anchor} onClose={onClose}>
      <button type="button">inside</button>
    </Popover>,
  );
  return { anchor, onClose, ...result };
}

describe("Popover", () => {
  it("hangs under its anchor, left-aligned with it", () => {
    renderAt({ top: 100, bottom: 130, left: 40, right: 140, width: 100, height: 30 });
    const panel = screen.getByTestId("popover");
    expect(panel.style.top).toBe("136px");
    expect(panel.style.left).toBe("40px");
  });

  it("dims nothing — there is no backdrop", () => {
    renderAt({ top: 10, bottom: 40, left: 10 });
    expect(screen.queryByTestId("dialog-backdrop")).toBeNull();
  });

  it("closes on Escape and on a click outside, but not on one inside", () => {
    const { onClose } = renderAt({ top: 10, bottom: 40, left: 10 });

    fireEvent.pointerDown(screen.getByText("inside"));
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.pointerDown(document.body);
    expect(onClose).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("does not count a click on the anchor as a click outside — the trigger owns its own toggle", () => {
    const { anchor, onClose } = renderAt({ top: 10, bottom: 40, left: 10 });
    fireEvent.pointerDown(anchor);
    expect(onClose).not.toHaveBeenCalled();
  });
});
