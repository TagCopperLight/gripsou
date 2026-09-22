import { describe, it, expect } from "vitest";

import {
  EMPTY_FILTERS,
  activeFilters,
  clearFilter,
  isFiltered,
  toQuery,
  withTimeFrame,
} from "./budgetFilters";

describe("budgetFilters", () => {
  it("starts unfiltered", () => {
    expect(isFiltered(EMPTY_FILTERS)).toBe(false);
    expect(activeFilters(EMPTY_FILTERS)).toEqual([]);
    expect(toQuery(EMPTY_FILTERS)).toEqual({});
  });

  it("drops the pagination-free query fields that are empty", () => {
    const f = { ...EMPTY_FILTERS, search: "aldi", categoryIds: ["c1"], uncategorized: true };
    expect(toQuery(f)).toEqual({ search: "aldi", categoryIds: ["c1"], uncategorized: true });
  });

  it("turns a preset into a concrete from/to pair", () => {
    const today = new Date(2026, 8, 21); // 21 September 2026, local time
    expect(withTimeFrame(EMPTY_FILTERS, "thisMonth", today)).toMatchObject({
      timeFrame: "thisMonth",
      from: "2026-09-01",
      to: "2026-09-30",
    });
    expect(withTimeFrame(EMPTY_FILTERS, "last12Months", today)).toMatchObject({
      from: "2025-09-21",
      to: "2026-09-21",
    });
    expect(withTimeFrame(EMPTY_FILTERS, "thisYear", today)).toMatchObject({
      from: "2026-01-01",
      to: "2026-12-31",
    });
  });

  it("clamps the day instead of rolling over when the target month is shorter", () => {
    // 2027 is not a leap year: naive arithmetic would land on 2027-03-01.
    expect(withTimeFrame(EMPTY_FILTERS, "last12Months", new Date(2028, 1, 29))).toMatchObject({
      from: "2027-02-28",
      to: "2028-02-29",
    });
  });

  it("clears the dates for `all` and keeps whatever the user typed for `custom`", () => {
    const dated = withTimeFrame(EMPTY_FILTERS, "thisMonth", new Date(2026, 8, 21));
    expect(withTimeFrame(dated, "all")).toMatchObject({ from: "", to: "" });
    expect(withTimeFrame(dated, "custom")).toMatchObject({
      timeFrame: "custom",
      from: "2026-09-01",
      to: "2026-09-30",
    });
  });

  it("lists one chip per active filter, including account and time frame", () => {
    const f = {
      ...withTimeFrame(EMPTY_FILTERS, "thisYear", new Date(2026, 8, 21)),
      search: "aldi",
      accountId: "acc-1",
      bucket: "out" as const,
      categoryIds: ["c1", "c2"],
      tagIds: ["t1"],
      needsReview: true,
    };
    expect(activeFilters(f)).toEqual([
      { kind: "search", value: "aldi" },
      { kind: "account", id: "acc-1" },
      { kind: "timeFrame" },
      { kind: "bucket", value: "out" },
      { kind: "category", id: "c1" },
      { kind: "category", id: "c2" },
      { kind: "tag", id: "t1" },
      { kind: "needsReview" },
    ]);
  });

  it("asks for internal transfers only when the OTHERS flag is on", () => {
    // Off is the default and sends nothing: the server hides them already.
    expect(toQuery(EMPTY_FILTERS).includeTransfers).toBeUndefined();
    const on = { ...EMPTY_FILTERS, transfers: true };
    expect(toQuery(on)).toEqual({ includeTransfers: true });
    expect(activeFilters(on)).toEqual([{ kind: "transfers" }]);
    expect(clearFilter(on, { kind: "transfers" }).transfers).toBe(false);
  });

  it("removes exactly the chip that was clicked", () => {
    const f = { ...EMPTY_FILTERS, categoryIds: ["c1", "c2"], tagIds: ["t1"] };
    expect(clearFilter(f, { kind: "category", id: "c1" }).categoryIds).toEqual(["c2"]);
    expect(clearFilter(f, { kind: "tag", id: "t1" }).tagIds).toEqual([]);
  });

  it("clearing the time frame returns to `all` with no dates", () => {
    const f = withTimeFrame(EMPTY_FILTERS, "thisMonth", new Date(2026, 8, 21));
    expect(clearFilter(f, { kind: "timeFrame" })).toMatchObject({
      timeFrame: "all",
      from: "",
      to: "",
    });
  });

  it("clears a stale `periodLabel` when a new time frame is picked (I2)", () => {
    // Without this, `activeFilters` hides the time-frame chip (it only shows
    // when `periodLabel` is unset) while the picked range silently applies —
    // the "Selected period" chip keeps showing the OLD Overview period.
    const withLabel = { ...EMPTY_FILTERS, periodLabel: "September 2026" };
    const next = withTimeFrame(withLabel, "thisMonth", new Date(2026, 8, 21));
    expect(next.periodLabel).toBeUndefined();
  });

  it("clearing the period chip drops phase 4's label with its dates", () => {
    const f = { ...EMPTY_FILTERS, periodLabel: "September 2026", from: "2026-09-01", to: "2026-09-30" };
    expect(activeFilters(f)[0]).toEqual({ kind: "period" });
    expect(clearFilter(f, { kind: "period" })).toMatchObject({
      periodLabel: undefined,
      from: "",
      to: "",
    });
  });
});
