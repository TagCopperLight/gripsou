import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import ReactECharts from "../EChart";
import type { EChartsOption } from "echarts";

import { Surface } from "../Surface";
import { MaskedMoney, PrivacyEye } from "../PrivateMoney";
import { FxAsterisk, FxFootnote } from "../FxNote";
import { GRID, SURFACE } from "../../lib/chartTheme";
import { formatShare } from "../../lib/distribution";
import { formatMoney } from "../../lib/money";
import type { Privacy } from "../../auth/usePrivacy";
import { STRIPE_CSS, stripePattern, type DonutItem } from "./exposureColors";

type ExposureDonutProps = {
  title: string;
  items: DonutItem[];
  /** Value the shares are of: shown in the middle when nothing is hovered,
   *  and the base of each legend row's amount. */
  total: number;
  /** Full-width card: the legend spreads over two columns on desktop. */
  wide?: boolean;
  /** What the middle says over the total; "Value" by default. */
  centerLabel?: string;
  /** Shown under the title instead of the chart (loading, error). */
  placeholder?: ReactNode;
  /** Why holdings are left out of `total` for want of an exchange rate:
   *  an asterisk on the total, and this under the card. */
  fxFootnote?: ReactNode;
  /** Private mode: the amounts are masked (the shares stay), and an eye by
   *  the title reveals them. */
  privacy?: Privacy;
  /** False when a heading above several donuts carries their shared eye. */
  eye?: boolean;
  /** Slices up to this share stay out of the ring (still in the legend). */
  minSlice?: number;
  className?: string;
};

// Hover keys: a top-level item is its own key; a child is "parent/child".
const childKey = (parent: string, child: string) => `${parent}/${child}`;
const parentOf = (key: string) => key.split("/")[0];

// Hover dims the rest by opacity, not colour, so a faded slice keeps its hue
// (and the striped leftover its stripes).
const DONUT_DIM = 0.3;
const LEGEND_DIM = 0.45;

/** A donut and its legend, the legend always showing every row so nothing
 *  moves under the pointer. Items with children (regions and their
 *  countries) get a thin outer ring in shades of their colour. */
export function ExposureDonut({
  title,
  items,
  total,
  wide = false,
  centerLabel,
  placeholder,
  fxFootnote,
  privacy,
  eye = true,
  minSlice = 0,
  className = "",
}: ExposureDonutProps) {
  const { t } = useTranslation();
  const [active, setActive] = useState<string | null>(null);
  const nested = items.some((i) => i.children && i.children.length > 0);
  const masked = privacy?.masked ?? false;
  // The hole's diameter, as a share of the chart's width.
  const hole = nested ? 0.5 : 0.62;
  // Nothing has a share (every account at zero or below): a plain grey ring,
  // so no slice pretends to be data.
  const blank = !items.some((i) => (i.share ?? 0) > 0);

  // Hovering a child also lights its parent, whose row is highlighted
  // alongside the child's; its siblings fade with everything else.
  const activeParent = active === null ? null : parentOf(active);
  const isLit = (key: string) => {
    if (active === null) return true;
    // A hovered child: itself and its parent. A hovered parent: its whole family.
    if (active.includes("/")) return key === active || key === activeParent;
    return parentOf(key) === active;
  };
  const isHighlighted = (key: string) => key === active || (key === activeParent && active !== key);
  const fill = (item: { color: string; other?: boolean }) => (item.other ? stripePattern() : item.color);
  const swatch = (item: { color: string; other?: boolean }) => ({
    background: item.other ? STRIPE_CSS : item.color,
  });

  // The outer ring follows the inner one slice for slice: an item without
  // children fills its stretch with itself.
  const outer = items.flatMap((i) =>
    i.children && i.children.length > 0 ? i.children.map((c) => ({ ...c, key: childKey(i.key, c.key) })) : [i],
  );

  const base = {
    type: "pie" as const,
    center: ["50%", "50%"],
    avoidLabelOverlap: false,
    label: { show: false },
    labelLine: { show: false },
    emphasis: { disabled: true },
    startAngle: 90,
  };
  const option: EChartsOption = {
    backgroundColor: "transparent",
    animation: false,
    tooltip: { show: false },
    series: [
      {
        ...base,
        radius: [`${hole * 100}%`, nested ? "80%" : "92%"],
        itemStyle: { borderColor: SURFACE, borderWidth: 2, borderRadius: 4 },
        silent: blank,
        data: blank
          ? [{ name: "", value: 1, itemStyle: { color: GRID } }]
          : items
              .filter((i) => (i.share ?? 0) > minSlice)
              .map((i) => ({ name: i.key, value: i.share, itemStyle: { color: fill(i), opacity: isLit(i.key) ? 1 : DONUT_DIM } })),
      },
      ...(nested
        ? [
            {
              ...base,
              radius: ["84%", "94%"],
              itemStyle: { borderColor: SURFACE, borderWidth: 1.5, borderRadius: 2 },
              data: outer.map((o) => ({ name: o.key, value: o.share, itemStyle: { color: fill(o), opacity: isLit(o.key) ? 1 : DONUT_DIM } })),
            },
          ]
        : []),
    ],
  } as EChartsOption;
  const onEvents = {
    mouseover: (p: { name: string }) => setActive(p.name),
    mouseout: () => setActive(null),
  };

  const hovered = (() => {
    if (active === null) return null;
    const [parent, child] = active.split("/");
    const item = items.find((i) => i.key === parent);
    if (!item) return null;
    return child === undefined ? item : (item.children?.find((c) => c.key === child) ?? null);
  })();

  const amount = (item: DonutItem) => item.value ?? (item.share ?? 0) * total;

  // Every row gets the same column widths, so the shares and amounts
  // line up down the legend: each column is as wide as its longest entry (in
  // `ch` of the mono font they are set in).
  const all = items.flatMap((i) => [i, ...(i.children ?? [])]);
  const amountCh = Math.max(...all.map((i) => formatMoney(amount(i), { fractionDigits: 0 }).length));

  const row = (key: string, item: DonutItem, child: boolean) => (
    <div
      key={key}
      onMouseEnter={() => setActive(key)}
      onMouseLeave={() => setActive(null)}
      style={{ opacity: isLit(key) ? 1 : LEGEND_DIM }}
      className={`grid cursor-pointer grid-cols-[auto_minmax(0,1fr)_auto_auto] items-center gap-x-2 rounded-lg px-2 transition-[background-color,opacity] duration-140 ${
        child ? "py-1 pl-7" : "py-1.5"
      } ${isHighlighted(key) ? "bg-surface-2" : "bg-transparent"}`}
    >
      <span
        className={`shrink-0 rounded-sm ${child ? "size-2" : "size-3"}`}
        style={swatch(item)}
      />
      <span className={`min-w-0 truncate ${child ? "text-xs text-fg-dim" : "text-sm text-fg"}`} title={item.label}>
        {item.label}
      </span>
      {/* No share (overdrawn, or nothing owned): the amount alone. */}
      <span className="text-right font-mono text-sm" style={{ width: "6ch" }}>
        {item.share !== null && <span className={`text-fg ${child ? "text-xs" : ""}`}>{formatShare(item.share, 1)}</span>}
      </span>
      <span className="relative ml-3 text-right font-mono text-xs whitespace-nowrap" style={{ width: `${amountCh}ch` }}>
        <MaskedMoney
          masked={masked}
          value={amount(item)}
          fractionDigits={0}
          className={`${Number(amount(item)) < 0 ? "text-red" : "text-fg-faint"} ${child ? "text-[11px]" : ""}`}
        />
        {item.fxMissing && <FxAsterisk />}
      </span>
    </div>
  );

  return (
    <Surface className={`w-full ${className}`}>
      <div className="flex h-full flex-col p-4 md:p-5">
        <p className="text-fg font-semibold text-sm">
          {title}
          {eye && privacy?.enabled && !placeholder && (
            <span className="ml-3 inline-flex align-middle">
              <PrivacyEye size="sm" masked={masked} toggle={privacy.toggle} />
            </span>
          )}
        </p>
        {placeholder ?? (
        <div className={`mt-3 flex flex-col items-center gap-4 ${wide ? "md:flex-row md:items-start md:gap-8" : "lg:flex-row lg:items-start lg:gap-4"}`}>
          <div className={`relative shrink-0 ${wide ? "size-64" : "size-50"}`}>
            <ReactECharts option={option} onEvents={onEvents} style={{ height: "100%", width: "100%" }} />
            {/* Kept inside the hole: a long name wraps, then is cut, rather
                than running over the ring. */}
            <div
              className="pointer-events-none absolute top-1/2 left-1/2 flex -translate-x-1/2 -translate-y-1/2 flex-col items-center text-center"
              style={{ width: `${hole * 72}%` }}
            >
              {hovered ? (
                <>
                  <span className="line-clamp-2 break-words text-fg-faint text-xs" style={{ hyphens: "auto" }}>{hovered.label}</span>
                  {hovered.share !== null ? (
                    <span className="font-mono text-fg text-xl font-semibold tracking-tight">{formatShare(hovered.share, 1)}</span>
                  ) : (
                    <MaskedMoney masked={masked} value={amount(hovered)} fractionDigits={0} className="whitespace-nowrap text-fg text-lg font-semibold tracking-tight" />
                  )}
                </>
              ) : (
                <>
                  <span className="text-fg-faint text-xs">{centerLabel ?? t("investments.exposure.center")}</span>
                  <span className="relative whitespace-nowrap">
                    <MaskedMoney masked={masked} value={total} fractionDigits={0} className="text-fg text-lg font-semibold tracking-tight" />
                    {fxFootnote && <FxAsterisk size="md" />}
                  </span>
                </>
              )}
            </div>
          </div>

          <div className={`w-full flex-1 ${wide ? "md:columns-2 md:gap-6" : ""}`}>
            {items.map((i) => (
              <div key={i.key} className="break-inside-avoid">
                {row(i.key, i, false)}
                {i.children?.map((c) => row(childKey(i.key, c.key), c, true))}
              </div>
            ))}
          </div>
        </div>
        )}
        {!placeholder && fxFootnote && <FxFootnote className="mt-4">{fxFootnote}</FxFootnote>}
      </div>
    </Surface>
  );
}
