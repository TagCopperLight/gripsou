import { useMemo, useState } from "react";
import { ChevronDown, ChevronUp, Search } from "lucide-react";

import { Surface } from "./Surface";
import { Money } from "./Money";
import { Percent } from "./Percent";
import { Sparkline } from "./Sparkline";
import { formatQuantity } from "../lib/money";
import {
  FAKE_HOLDINGS,
  KIND_LABEL,
  holdingCategories,
  type Holding,
} from "../lib/fakeHoldings";

type SortKey = "asset" | "qty" | "value" | "pnl";
type SortDir = "asc" | "desc";
type Sort = { key: SortKey; dir: SortDir };

type Column = {
  label: string;
  align: "left" | "right";
  sort?: SortKey;
};

const COLUMNS: Column[] = [
  { label: "ASSET", align: "left", sort: "asset" },
  { label: "QUANTITY", align: "right", sort: "qty" },
  { label: "ACCOUNT", align: "left" },
  { label: "CATEGORY", align: "left" },
  { label: "VALUE", align: "right", sort: "value" },
  { label: "UNREALIZED P/L", align: "right", sort: "pnl" },
  { label: "30D", align: "right" },
];

const GREEN = "var(--color-green)";
const RED = "var(--color-red)";

// Cash has no meaningful quantity or P/L; those rows always sort to the bottom.
function qtyOf(h: Holding): number | null {
  return h.kind === "cash" ? null : h.qty;
}

function pnlOf(h: Holding): number | null {
  return h.kind === "cash" ? null : h.gl;
}

function compareNullable(a: number | null, b: number | null, mul: number): number {
  if (a === null) return b === null ? 0 : 1;
  if (b === null) return -1;
  return (a - b) * mul;
}

function compare(a: Holding, b: Holding, sort: Sort): number {
  const mul = sort.dir === "asc" ? 1 : -1;
  switch (sort.key) {
    case "asset":
      return a.name.localeCompare(b.name) * mul;
    case "qty":
      return compareNullable(qtyOf(a), qtyOf(b), mul);
    case "value":
      return (a.value - b.value) * mul;
    case "pnl":
      return compareNullable(pnlOf(a), pnlOf(b), mul);
  }
}

type HoldingsCardProps = {
  holdings?: Holding[];
  className?: string;
};

export function HoldingsCard({
  holdings = FAKE_HOLDINGS,
  className = "",
}: HoldingsCardProps) {
  const [sort, setSort] = useState<Sort | null>({ key: "value", dir: "desc" });
  const [category, setCategory] = useState("All");
  const [query, setQuery] = useState("");

  const categories = useMemo(
    () => ["All", ...holdingCategories(holdings)],
    [holdings],
  );

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = holdings.filter(
      (h) =>
        (category === "All" || h.category === category) &&
        (q === "" ||
          h.name.toLowerCase().includes(q) ||
          h.ticker.toLowerCase().includes(q)),
    );
    return sort ? [...filtered].sort((a, b) => compare(a, b, sort)) : filtered;
  }, [holdings, category, query, sort]);

  const toggleSort = (key: SortKey) =>
    setSort((prev) =>
      prev?.key === key
        ? { key, dir: prev.dir === "asc" ? "desc" : "asc" }
        : { key, dir: key === "asset" ? "asc" : "desc" },
    );

  return (
    <Surface className={`w-full ${className}`}>
      <div className="flex flex-col p-5">
        <div className="flex items-start justify-between">
          <h2 className="text-fg font-semibold text-sm">
            Holdings
            <span className="text-fg-faint font-normal ml-3">
              {holdings.length} assets
            </span>
          </h2>
          <label className="flex items-center gap-2 rounded-lg bg-surface-2 px-3 py-1.5 w-64">
            <Search className="size-4 text-fg-faint shrink-0" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search assets ..."
              className="bg-transparent text-sm text-fg placeholder:text-fg-faint outline-none w-full"
            />
          </label>
        </div>

        <div className="flex items-center gap-1.5 mt-4">
          {categories.map((c) => {
            const selected = c === category;
            return (
              <button
                key={c}
                type="button"
                onClick={() => setCategory(c)}
                className={`rounded-lg px-3 py-1 text-xs font-medium cursor-pointer transition-colors duration-140 ${
                  selected
                    ? "bg-fg text-bg"
                    : "bg-surface-2 text-fg-dim hover:text-fg"
                }`}
              >
                {c}
              </button>
            );
          })}
        </div>

        <table className="w-full mt-4 border-separate border-spacing-0">
          <thead>
            <tr>
              {COLUMNS.map((col) => {
                const active = col.sort && sort?.key === col.sort;
                return (
                  <th
                    key={col.label}
                    className={`pb-2 px-3 text-[11px] font-medium tracking-wide font-mono ${
                      col.align === "right" ? "text-right" : "text-left"
                    }`}
                  >
                    {col.sort ? (
                      <button
                        type="button"
                        onClick={() => toggleSort(col.sort!)}
                        className={`inline-flex items-center gap-1 cursor-pointer transition-colors duration-140 ${
                          col.align === "right" ? "flex-row-reverse" : ""
                        } ${active ? "text-fg" : "text-fg-dim hover:text-fg"}`}
                      >
                        {col.label}
                        {active &&
                          (sort.dir === "asc" ? (
                            <ChevronUp className="size-3.5" />
                          ) : (
                            <ChevronDown className="size-3.5" />
                          ))}
                      </button>
                    ) : (
                      <span className="text-fg-faint">{col.label}</span>
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {rows.map((h) => {
              const up = h.gl >= 0;
              const hasPnl = h.kind !== "cash";
              return (
                <tr
                  key={`${h.accountId}-${h.ticker}`}
                  className="hover:bg-hover transition-colors duration-140"
                >
                  {/* ASSET */}
                  <td className="py-3 px-3 border-t border-surface-2">
                    <div className="flex items-center gap-3">
                      <span
                        className="size-8 rounded-lg shrink-0 flex items-center justify-center text-[11px] font-mono font-semibold text-fg"
                        style={{ background: h.logo }}
                      >
                        {h.ticker.slice(0, 2)}
                      </span>
                      <div className="flex flex-col">
                        <span className="text-sm text-fg leading-tight">
                          {h.name}
                        </span>
                        <span className="text-xs text-fg-faint font-mono">
                          {h.ticker} · {KIND_LABEL[h.kind]}
                        </span>
                      </div>
                    </div>
                  </td>
                  {/* QUANTITY */}
                  <td className="py-3 px-3 border-t border-surface-2 text-right">
                    {hasPnl ? (
                      <span className="text-sm text-fg-dim font-mono">
                        {formatQuantity(h.qty)}
                      </span>
                    ) : (
                      <span className="text-sm text-fg-faint">-</span>
                    )}
                  </td>
                  {/* ACCOUNT */}
                  <td className="py-3 px-3 border-t border-surface-2">
                    <div className="flex items-center gap-2">
                      <span
                        className="size-2.5 rounded-sm shrink-0"
                        style={{ background: h.accountColor }}
                      />
                      <span className="text-sm text-fg-dim">
                        {h.accountName}
                      </span>
                    </div>
                  </td>
                  {/* CATEGORY */}
                  <td className="py-3 px-3 border-t border-surface-2">
                    <span className="font-mono text-[11px] text-fg-faint bg-surface-3 rounded px-1.5 py-0.5">
                      {h.category}
                    </span>
                  </td>
                  {/* VALUE */}
                  <td className="py-3 px-3 border-t border-surface-2 text-right">
                    <Money value={h.value} className="text-sm text-fg" />
                  </td>
                  {/* UNREALIZED P/L */}
                  <td className="py-3 px-3 border-t border-surface-2 text-right">
                    {hasPnl ? (
                      <div className="flex flex-col items-end">
                        <Money
                          value={h.gl}
                          signed
                          className={`text-sm ${up ? "text-green" : "text-red"}`}
                        />
                        <Percent
                          value={h.glPct}
                          signed
                          fractionDigits={1}
                          className={`text-xs ${up ? "text-green" : "text-red"}`}
                        />
                      </div>
                    ) : (
                      <span className="text-sm text-fg-faint">-</span>
                    )}
                  </td>
                  {/* 30D */}
                  <td className="py-3 px-3 border-t border-surface-2">
                    <div className="flex justify-end">
                      {h.spark ? (
                        <Sparkline data={h.spark} color={up ? GREEN : RED} />
                      ) : (
                        <span className="text-sm text-fg-faint">-</span>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Surface>
  );
}
