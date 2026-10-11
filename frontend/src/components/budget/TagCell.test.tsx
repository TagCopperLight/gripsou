import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";

import { TagCell } from "./TagCell";

const TAGS = [
  { id: "1", name: "Holiday", color: "#9bb06b" },
  { id: "2", name: "Work", color: "#5b9bf0" },
  { id: "3", name: "Shared", color: "#d08a5a" },
];

/** jsdom reports every box as 0×0, so the cell has to be told how wide things
 *  are before it can decide anything: a fixed width per node, a fixed line. */
function stubLayout(itemWidth: number, lineWidth: number) {
  const offset = vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(itemWidth);
  const client = vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(lineWidth);
  return () => {
    offset.mockRestore();
    client.mockRestore();
  };
}

afterEach(cleanup);

describe("TagCell", () => {
  it.each([{ tags: [] }, { tags: TAGS.slice(0, 1) }])("avoids synchronous layout reads when all tags must stay visible: $tags", ({ tags }) => {
    const offset = vi.spyOn(HTMLElement.prototype, "offsetWidth", "get");
    const client = vi.spyOn(HTMLElement.prototype, "clientWidth", "get");
    try {
      render(<TagCell tags={tags} label="Add tags" onOpen={vi.fn()} />);
      expect(screen.queryAllByTestId("tag-chip")).toHaveLength(tags.length);
      expect(screen.getByRole("button", { name: "Add tags" })).toBeInTheDocument();
      expect(offset).not.toHaveBeenCalled();
      expect(client).not.toHaveBeenCalled();
    } finally {
      offset.mockRestore();
      client.mockRestore();
    }
  });

  it("remeasures when a second tag is added and shows a new single tag immediately", () => {
    const restore = stubLayout(40, 130);
    try {
      const { rerender } = render(<TagCell tags={[]} label="Add tags" onOpen={vi.fn()} />);
      rerender(<TagCell tags={TAGS} label="Add tags" onOpen={vi.fn()} />);
      expect(screen.getByTestId("tx-tags-overflow")).toHaveTextContent("+2");
      rerender(<TagCell tags={[TAGS[2]]} label="Add tags" onOpen={vi.fn()} />);
      expect(screen.queryByTestId("tx-tags-overflow")).toBeNull();
      expect(screen.getByTestId("tag-chip")).toHaveTextContent("Shared");
    } finally {
      restore();
    }
  });

  it("shows every tag and no counter when the line is wide enough", () => {
    const restore = stubLayout(40, 1000);
    render(<TagCell tags={TAGS} label="Add tags" onOpen={vi.fn()} />);
    expect(screen.getAllByTestId("tag-chip")).toHaveLength(TAGS.length * 2); // + the measuring twin
    expect(screen.queryByTestId("tx-tags-overflow")).toBeNull();
    restore();
  });

  it("counts the tags it had to drop, between the last chip and the add button", () => {
    // 130px of line, less the 40px button and its gap, leaves 86px: one 40px
    // chip plus the gap and the counter (84px) — the other two become "+2".
    const restore = stubLayout(40, 130);
    render(<TagCell tags={TAGS} label="Add tags" onOpen={vi.fn()} />);
    const counter = screen.getByTestId("tx-tags-overflow");
    expect(counter).toHaveTextContent("+2");
    expect(counter).toHaveAttribute("title", "Work, Shared");
    // Order on the visible line: chip, counter, button.
    const line = counter.parentElement!;
    const order = Array.from(line.children).slice(0, 3);
    expect(order[0]).toHaveAttribute("data-testid", "tag-chip");
    expect(order[1]).toBe(counter);
    expect(order[2]).toHaveAttribute("data-testid", "tx-add-tag");
    restore();
  });

  it("keeps one chip on the line even when nothing fits", () => {
    const restore = stubLayout(40, 50);
    render(<TagCell tags={TAGS} label="Add tags" onOpen={vi.fn()} />);
    expect(screen.getByTestId("tx-tags-overflow")).toHaveTextContent("+2");
    restore();
  });

  it("opens the chooser anchored to the add button", () => {
    const onOpen = vi.fn();
    render(<TagCell tags={TAGS} label="Add tags" onOpen={onOpen} />);
    const button = screen.getByTestId("tx-add-tag");
    fireEvent.click(button);
    expect(onOpen).toHaveBeenCalledWith(button);
  });
});
