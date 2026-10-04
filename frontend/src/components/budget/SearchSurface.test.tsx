import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { SearchSurface } from "./SearchSurface";
import { BudgetProvider } from "./BudgetProvider";
import { useBudget } from "./budgetContext";

const ACCOUNTS = [{ id: "acc-1", name: "Current", color: "#5b9bf0" }];
const CATEGORIES = [
  {
    id: "gro", name: "Groceries", defaultKey: null, color: "#9bb06b", icon: "shopping-cart",
    hint: null, kind: "expense", systemKey: null, archived: false, txCount: 3,
  },
];
const TAGS = [{ id: "t1", name: "holiday", color: "#f0b952", txCount: 2 }];

function json(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

/** Surfaces the context so assertions can read what the controls wrote, and
 *  exposes a handler that fires two derived `patchFilters` updater calls back
 *  to back — the same shape as two chooser toggles or two chip-clears landing
 *  in one React batch — to prove neither write clobbers the other. */
function Probe() {
  const { filters, patchFilters } = useBudget();
  return (
    <>
      <pre data-testid="filters">{JSON.stringify(filters)}</pre>
      <button
        type="button"
        data-testid="batch-toggle-categories"
        onClick={() => {
          patchFilters((prev) => ({ categoryIds: [...prev.categoryIds, "gro"] }));
          patchFilters((prev) => ({ categoryIds: [...prev.categoryIds, "other"] }));
        }}
      >
        batch
      </button>
    </>
  );
}

function renderSurface() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  }
  render(
    <BudgetProvider>
      <SearchSurface counts={{ matching: 12, total: 400, uncategorized: 300, matchingTotal: "0", fxMissing: false, reportingFxMissing: false }} />
      <Probe />
    </BudgetProvider>,
    { wrapper: Wrapper },
  );
}

function filters(): Record<string, unknown> {
  return JSON.parse(screen.getByTestId("filters").textContent ?? "{}");
}

/** `Select` is a custom dropdown (trigger button + option buttons), not a
 *  native <select> — click the trigger, then click the option by its label. */
function pickTimeFrame(label: string) {
  const control = within(screen.getByTestId("time-frame"));
  fireEvent.click(control.getByRole("button"));
  // The menu is portalled to the body, outside the control.
  fireEvent.click(screen.getByRole("button", { name: label }));
}

describe("SearchSurface", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (String(url).includes("/budget/categories")) return json(CATEGORIES);
        if (String(url).includes("/budget/tags")) return json(TAGS);
        return json(ACCOUNTS);
      }),
    );
  });

  it("shows part 1 only, until a filter exists", () => {
    renderSurface();
    expect(screen.getByRole("searchbox")).toBeVisible();
    expect(screen.queryByTestId("filter-panel")).toBeNull();
    expect(screen.queryByTestId("active-filters")).toBeNull();
  });

  it("reveals the four-column panel from the Filters button", () => {
    renderSurface();
    fireEvent.click(screen.getByTestId("filters-toggle"));
    const panel = screen.getByTestId("filter-panel");
    expect(panel).toBeVisible();
    expect(screen.getByTestId("column-type")).toBeVisible();
    expect(screen.getByTestId("column-categories")).toBeVisible();
    expect(screen.getByTestId("column-tags")).toBeVisible();
    expect(screen.getByTestId("column-others")).toBeVisible();
  });

  it("keeps exactly one type bucket active", () => {
    renderSurface();
    fireEvent.click(screen.getByTestId("filters-toggle"));
    fireEvent.click(screen.getByTestId("bucket-out"));
    expect(filters().bucket).toBe("out");
    fireEvent.click(screen.getByTestId("bucket-lots"));
    expect(filters().bucket).toBe("lots");
  });

  /** Colour is a fixed property of a bucket, not a selection state: the icon
   *  is always tinted — green for money arriving, red for leaving, blue for
   *  securities, neutral for `all` — and selection is drawn in the panel's own
   *  greys. A row must never announce itself by turning green. */
  it("tints the bucket icons and draws selection in grey", () => {
    renderSurface();
    fireEvent.click(screen.getByTestId("filters-toggle"));

    const iconClass = (b: string) =>
      screen.getByTestId(`bucket-${b}`).querySelector("svg")?.getAttribute("class") ?? "";

    expect(iconClass("in")).toContain("text-green");
    expect(iconClass("out")).toContain("text-red");
    expect(iconClass("lots")).toContain("text-blue");
    expect(iconClass("all")).toContain("text-fg-faint");

    // Unselected now, and still its own colour.
    expect(screen.getByTestId("bucket-in")).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(screen.getByTestId("bucket-in"));
    expect(screen.getByTestId("bucket-in")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("bucket-in").className).not.toContain("green");
    expect(iconClass("in")).toContain("text-green");
    expect(screen.getByTestId("bucket-all")).toHaveAttribute("aria-pressed", "false");
  });

  it("gives a bucket chip the same tinted icon as its row", () => {
    renderSurface();
    fireEvent.click(screen.getByTestId("filters-toggle"));
    fireEvent.click(screen.getByTestId("bucket-out"));

    const chip = screen.getByTestId("chip-clear-bucket");
    // The X is a child too, so match the leading icon specifically.
    expect(chip.querySelector("svg")?.getAttribute("class")).toContain("text-red");
  });

  it("writes the two other toggles", () => {
    renderSurface();
    fireEvent.click(screen.getByTestId("filters-toggle"));
    fireEvent.click(screen.getByTestId("toggle-uncategorized"));
    fireEvent.click(screen.getByTestId("toggle-needs-review"));
    expect(filters().uncategorized).toBe(true);
    expect(filters().needsReview).toBe(true);
  });

  it("turns a time-frame preset into concrete dates", () => {
    renderSurface();
    pickTimeFrame("This year");
    expect(String(filters().from)).toMatch(/^\d{4}-01-01$/);
  });

  it("shows part 3 with one chip per filter and the matching/total readout", () => {
    renderSurface();
    fireEvent.click(screen.getByTestId("filters-toggle"));
    fireEvent.click(screen.getByTestId("toggle-uncategorized"));
    const active = screen.getByTestId("active-filters");
    expect(active).toBeVisible();
    expect(screen.getByTestId("counts-readout")).toHaveTextContent("12");
    expect(screen.getByTestId("counts-readout")).toHaveTextContent("400");
    fireEvent.click(screen.getByTestId("chip-clear-uncategorized"));
    expect(filters().uncategorized).toBe(false);
  });

  it("keeps both derived writes when two patchFilters calls land in one batch", () => {
    renderSurface();
    fireEvent.click(screen.getByTestId("batch-toggle-categories"));
    expect(filters().categoryIds).toEqual(["gro", "other"]);
  });

  it("clears every filter at once", () => {
    renderSurface();
    fireEvent.click(screen.getByTestId("filters-toggle"));
    fireEvent.click(screen.getByTestId("toggle-uncategorized"));
    fireEvent.click(screen.getByTestId("toggle-needs-review"));
    fireEvent.click(screen.getByTestId("clear-all"));
    expect(filters().uncategorized).toBe(false);
    expect(filters().needsReview).toBe(false);
    expect(screen.queryByTestId("active-filters")).toBeNull();
  });
});
