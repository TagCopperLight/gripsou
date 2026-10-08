import { useState } from "react";
import { useTranslation } from "react-i18next";
import ReactECharts from "echarts-for-react";
import type { EChartsOption } from "echarts";

import { Surface } from "../Surface";
import { Money } from "../Money";
import { Percent } from "../Percent";
import { desaturate } from "../../lib/color";
import { SURFACE } from "../../lib/chartTheme";
import type { DonutItem } from "./exposureColors";

type ExposureDonutProps = {
  title: string;
  items: DonutItem[];
  /** Value the shares are of, shown in the middle when nothing is hovered. */
  total: number;
  /** Full-width card: the legend spreads over two columns on desktop. */
  wide?: boolean;
  className?: string;
};

// Hover keys: a top-level item is its own key; a child is "parent/child".
const childKey = (parent: string, child: string) => `${parent}/${child}`;

/** A donut and its legend, the legend always showing every row so nothing
 *  moves under the pointer. Items with children (regions and their
 *  countries) get a thin outer ring in shades of their colour. */
export function ExposureDonut({ title, items, total, wide = false, className = "" }: ExposureDonutProps) {
  const { t } = useTranslation();
  const [active, setActive] = useState<string | null>(null);
  const nested = items.some((i) => i.children && i.children.length > 0);

  const activeParent = active?.split("/")[0] ?? null;
  const isLit = (key: string) => {
    if (active === null) return true;
    if (key === active) return true;
    const [parent, child] = key.split("/");
    // A hovered parent lights its children; a hovered child lights its parent.
    if (child === undefined) return parent === activeParent;
    return !active.includes("/") && parent === active;
  };
  const paint = (key: string, color: string) => (isLit(key) ? color : desaturate(color, 0.65));

  // The outer ring follows the inner one slice for slice: an item without
  // children fills its stretch with its own colour.
  const outer = items.flatMap((i) =>
    i.children && i.children.length > 0
      ? i.children.map((c) => ({ key: childKey(i.key, c.key), share: c.share, color: c.color }))
      : [{ key: i.key, share: i.share, color: i.color }],
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
        data: items.map((i) => ({ name: i.key, value: i.share, itemStyle: { color: paint(i.key, i.color) } })),
      },
      ...(nested
        ? [
            {
              ...base,
              radius: ["84%", "94%"],
              itemStyle: { borderColor: SURFACE, borderWidth: 1.5, borderRadius: 2 },
              data: outer.map((o) => ({ name: o.key, value: o.share, itemStyle: { color: paint(o.key, o.color) } })),
            },
          ]
        : []),
    ],
  };
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

  const row = (key: string, label: string, share: number, color: string, child: boolean) => (
    <div
      key={key}
      onMouseEnter={() => setActive(key)}
      onMouseLeave={() => setActive(null)}
      className={`flex items-center gap-2 rounded-lg px-2 transition-colors duration-140 ${
        child ? "py-1 pl-7" : "py-1.5"
      } ${active === key ? "bg-surface-2" : "bg-transparent"}`}
    >
      <span
        className={`shrink-0 rounded-sm transition-colors duration-140 ${child ? "size-2" : "size-3"}`}
        style={{ background: paint(key, color) }}
      />
      <span className={`min-w-0 truncate ${child ? "text-xs text-fg-dim" : "text-sm text-fg"}`}>{label}</span>
      <Percent
        value={share}
        fractionDigits={1}
        className={`ml-auto shrink-0 text-right ${child ? "text-xs text-fg-faint" : "text-sm text-fg-dim"}`}
      />
    </div>
  );

  return (
    <Surface className={`w-full ${className}`}>
      <div className="flex h-full flex-col p-4 md:p-5">
        <p className="text-fg font-semibold text-sm">{title}</p>
        <div className={`mt-3 flex flex-col items-center gap-4 ${wide ? "md:flex-row md:items-start md:gap-8" : "lg:flex-row lg:items-start lg:gap-6"}`}>
          <div className={`relative shrink-0 ${wide ? "size-64" : "size-52"}`}>
            <ReactECharts option={option} onEvents={onEvents} style={{ height: "100%", width: "100%" }} />
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center px-12 text-center">
              {hovered ? (
                <>
                  <span className="line-clamp-2 text-fg-faint text-xs">{hovered.label}</span>
                  <Percent value={hovered.share} fractionDigits={1} className="text-fg text-xl font-semibold tracking-tight" />
                </>
              ) : (
                <>
                  <span className="text-fg-faint text-xs">{t("investments.exposure.center")}</span>
                  <Money value={total} fractionDigits={0} className="text-fg text-lg font-semibold tracking-tight" />
                </>
              )}
            </div>
          </div>

          <div className={`w-full flex-1 ${wide ? "md:columns-2 md:gap-6" : ""}`}>
            {items.map((i) => (
              <div key={i.key} className="break-inside-avoid">
                {row(i.key, i.label, i.share, i.color, false)}
                {i.children?.map((c) => row(childKey(i.key, c.key), c.label, c.share, c.color, true))}
              </div>
            ))}
          </div>
        </div>
      </div>
    </Surface>
  );
}
