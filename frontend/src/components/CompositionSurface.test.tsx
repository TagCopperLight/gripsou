import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { CompositionSurface } from "./CompositionSurface";
import type { Composition } from "../api/types";

const COMP: Composition = {
  countries: [
    { name: "United States", weight: 0.62 },
    { name: "Japan", weight: 0.14 },
  ],
  sectors: [{ name: "Technology", weight: 0.31 }],
};

describe("CompositionSurface", () => {
  it("renders both distributions with legends and percentages", () => {
    render(<CompositionSurface composition={COMP} />);
    expect(screen.getByText("United States")).toBeInTheDocument();
    expect(screen.getByText("Japan")).toBeInTheDocument();
    expect(screen.getByText("Technology")).toBeInTheDocument();
    // 0.62 formatted as a percentage somewhere in the legend.
    expect(screen.getByText(/62/)).toBeInTheDocument();
  });

  it("sets segment widths from weights", () => {
    const { container } = render(<CompositionSurface composition={COMP} />);
    const seg = container.querySelector('[data-testid="seg-United States"]') as HTMLElement;
    expect(seg.style.width).toBe("62%");
  });

  it("adds an Other slice for the remainder up to 100%", () => {
    // countries sum to 76% → Other is 24% (one Other per bar shown).
    const { container } = render(<CompositionSurface composition={COMP} />);
    expect(screen.getAllByText("Other").length).toBe(2);
    const other = container.querySelector('[data-testid="seg-Other"]') as HTMLElement;
    expect(other.style.width).toBe("24%");
  });

  it("puts the rounding leftover into Other so percents total 100", () => {
    // Three 33.3% slices display as 33+33+33 = 99 → Other absorbs the last 1%.
    const thirds: Composition = {
      countries: [
        { name: "A", weight: 0.333 },
        { name: "B", weight: 0.333 },
        { name: "C", weight: 0.333 },
      ],
      sectors: [],
    };
    const { container } = render(<CompositionSurface composition={thirds} />);
    const other = container.querySelector('[data-testid="seg-Other"]') as HTMLElement;
    expect(other.style.width).toBe("1%");
    expect(screen.getByText("Other")).toBeInTheDocument();
  });

  it("omits Other when weights already sum to ~100%", () => {
    const full: Composition = {
      countries: [{ name: "United States", weight: 1 }],
      sectors: [{ name: "Technology", weight: 0.997 }],
    };
    render(<CompositionSurface composition={full} />);
    // 100% → no remainder; 99.7% rounds to 0% → no Other.
    expect(screen.queryByText("Other")).not.toBeInTheDocument();
  });
});
