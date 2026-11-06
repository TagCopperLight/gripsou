import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";

import { CodeInput } from "./CodeInput";

/** CodeInput is controlled: hold its value like the real callers do. */
function Harness({ initial = "", onChange }: { initial?: string; onChange?: (d: string) => void }) {
  const [value, setValue] = useState(initial);
  return (
    <CodeInput
      ariaLabel="6-digit code"
      value={value}
      onChange={(d) => {
        setValue(d);
        onChange?.(d);
      }}
    />
  );
}

const boxes = (container: HTMLElement) =>
  Array.from(container.querySelectorAll<HTMLElement>("[aria-hidden='true'] > span"));

describe("CodeInput", () => {
  it("is one real, labelled input for the six boxes", () => {
    const { container } = render(<Harness />);
    expect(screen.getAllByRole("textbox")).toHaveLength(1);
    const input = screen.getByRole("textbox", { name: "6-digit code" });
    expect(input).toHaveAttribute("inputmode", "numeric");
    expect(input).toHaveAttribute("autocomplete", "one-time-code");
    expect(boxes(container)).toHaveLength(6);
  });

  it("keeps digits only and shows one per box", async () => {
    const user = userEvent.setup();
    const { container } = render(<Harness />);
    await user.type(screen.getByRole("textbox"), "1a2-3 b");
    expect(screen.getByRole("textbox")).toHaveValue("123");
    expect(boxes(container).map((b) => b.textContent)).toEqual(["1", "2", "3", "", "", ""]);
  });

  it("stops at six digits", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.type(screen.getByRole("textbox"), "123456789");
    expect(screen.getByRole("textbox")).toHaveValue("123456");
  });

  it("takes a pasted code written with a space", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    await user.click(screen.getByRole("textbox"));
    await user.paste("123 456");
    expect(screen.getByRole("textbox")).toHaveValue("123456");
    expect(onChange).toHaveBeenLastCalledWith("123456");
  });

  it("replaces what was typed when a whole code is pasted", async () => {
    const user = userEvent.setup();
    render(<Harness initial="98" />);
    await user.click(screen.getByRole("textbox"));
    await user.paste("123 456");
    expect(screen.getByRole("textbox")).toHaveValue("123456");
  });

  it("rings the box the next digit goes into, only while focused", async () => {
    const user = userEvent.setup();
    const { container } = render(<Harness initial="12" />);
    const ringed = () => boxes(container).map((b) => b.className.includes("ring-1"));
    expect(ringed()).toEqual([false, false, false, false, false, false]);
    await user.click(screen.getByRole("textbox"));
    expect(ringed()).toEqual([false, false, true, false, false, false]);
    await user.type(screen.getByRole("textbox"), "3456");
    // All six typed: the last box keeps the ring.
    expect(ringed()).toEqual([false, false, false, false, false, true]);
    await user.tab();
    expect(ringed()).toEqual([false, false, false, false, false, false]);
  });
});
