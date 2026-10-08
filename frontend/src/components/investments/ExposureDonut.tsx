import { useState } from "react";
import { useTranslation } from "react-i18next";
import ReactECharts from "echarts-for-react";
import type { EChartsOption } from "echarts";

import { Surface } from "../Surface";
import { Money } from "../Money";
import { Percent } from "../Percent";
import { SURFACE } from "../../lib/chartTheme";
import { STRIPE_CSS, stripePattern, type DonutItem } from "./exposureColors";

type ExposureDonutProps = {
  title: string;
  items: DonutItem[];
  /** Value the shares are of: shown in the middle when nothing is hovered,
   *  and the base of each legend row's amount. */
  total: number;
  /** Full-width card: the legend spreads over two columns on desktop. */
  wide?: boolean;
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
export function ExposureDonut({ title, items, total, wide = false, className = "" }: ExposureDonutProps) {
  const { t } = useTranslation();
  const [active, setActive] = useState<string | null>(null);
  const nested = items.some((i) => i.children && i.children.length > 0);

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
    tooltip: { show: false },
    series: [
      {
        ...base,
        radius: nested ? ["50%", "80%"] : ["62%", "92%"],
        itemStyle: { borderColor: SURFACE, borderWidth: 2, borderRadius: 4 },
        data: items.map((i) => ({ name: i.key, value: i.share, itemStyle: { color: fill(i), opacity: isLit(i.key) ? 1 : DONUT_DIM } })),
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

  const row = (key: string, item: DonutItem, child: boolean) => (
    <div
      key={key}
      onMouseEnter={() => setActive(key)}
      onMouseLeave={() => setActive(null)}
      style={{ opacity: isLit(key) ? 1 : LEGEND_DIM }}
      className={`grid grid-cols-[auto_1fr_auto_auto] items-center gap-x-2.5 rounded-lg px-2 transition-[background-color,opacity] duration-140 ${
        child ? "py-1 pl-7" : "py-1.5"
      } ${isHighlighted(key) ? "bg-surface-2" : "bg-transparent"}`}
    >
      <span
        className={`shrink-0 rounded-sm ${child ? "size-2" : "size-3"}`}
        style={swatch(item)}
      />
      <span className={`min-w-0 truncate ${child ? "text-xs text-fg-dim" : "text-sm text-fg"}`}>{item.label}</span>
      <Percent value={item.share} fractionDigits={1} className={`text-right text-fg ${child ? "text-xs" : "text-sm"}`} />
      <Money
        value={item.share * total}
        fractionDigits={0}
        className={`min-w-14 text-right text-fg-faint ${child ? "text-[11px]" : "text-xs"}`}
      />
    </div>
  );

  return (
    <Surface className={`w-full ${className}`}>
      <div className="flex h-full flex-col p-4 md:p-5">
        <p className="text-fg font-semibold text-sm">{title}</p>
        <div className={`mt-3 flex flex-col items-center gap-4 ${wide ? "md:flex-row md:items-start md:gap-8" : "lg:flex-row lg:items-start lg:gap-6"}`}>
          <div className={`relative shrink-0 ${wide ? "size-64" : "size-44"}`}>
            <ReactECharts option={option} onEvents={onEvents} style={{ height: "100%", width: "100%" }} />
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center px-8 text-center">
              {hovered ? (
                <>
                  <span className="line-clamp-2 text-fg-faint text-xs">{hovered.label}</span>
                  <Percent value={hovered.share} fractionDigits={1} className="text-fg text-xl font-semibold tracking-tight" />
                </>
              ) : (
                <>
                  <span className="text-fg-faint text-xs">{t("investments.exposure.center")}</span>
                  <Money value={total} fractionDigits={0} className="whitespace-nowrap text-fg text-lg font-semibold tracking-tight" />
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
      </div>
    </Surface>
  );
}
