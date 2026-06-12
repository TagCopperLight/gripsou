import { useState } from "react";
import ReactECharts from "echarts-for-react";
import type { EChartsOption } from "echarts";

import { Surface } from "./Surface";
import { Money } from "./Money";
import { Percent } from "./Percent";
import { desaturate } from "../lib/color";
import {
  FAKE_DISTRIBUTION,
  distributionTotal,
  type DistributionAccount,
} from "../lib/fakeDistribution";

const SURFACE = "#13110f";

type DistributionCardProps = {
  accounts?: DistributionAccount[];
  className?: string;
};

export function DistributionCard({
  accounts = FAKE_DISTRIBUTION,
  className = "",
}: DistributionCardProps) {
  // The id of the hovered account, driven by both the legend and the donut, so
  // the two stay in sync. null = nothing hovered.
  const [activeId, setActiveId] = useState<string | null>(null);
  const total = distributionTotal(accounts);
  // Largest proportion first, in both the donut and the legend.
  const ordered = [...accounts].sort((a, b) => b.value - a.value);

  // When something is hovered, every *other* slice/marker is greyed out.
  const colorFor = (a: DistributionAccount) =>
    activeId !== null && activeId !== a.id ? desaturate(a.color, 0.65) : a.color;

  const option: EChartsOption = {
    backgroundColor: "transparent",
    tooltip: { show: false },
    series: [
      {
        type: "pie",
        radius: ["62%", "92%"],
        center: ["50%", "50%"],
        avoidLabelOverlap: false,
        label: { show: false },
        labelLine: { show: false },
        emphasis: { disabled: true },
        itemStyle: { borderColor: SURFACE, borderWidth: 2, borderRadius: 4 },
        data: ordered.map((a) => ({
          name: a.name,
          value: a.value,
          itemStyle: { color: colorFor(a) },
        })),
      },
    ],
  };

  const onEvents = {
    mouseover: (params: { dataIndex: number }) =>
      setActiveId(ordered[params.dataIndex].id),
    mouseout: () => setActiveId(null),
  };

  return (
    <Surface className={`w-full ${className}`}>
      <div className="flex flex-col p-5">
        <p className="text-fg font-semibold text-sm">Account distribution</p>
        <div className="flex items-center gap-8 mt-2">
          <div className="relative size-55 shrink-0">
            <ReactECharts
              option={option}
              onEvents={onEvents}
              style={{ height: "100%", width: "100%" }}
            />
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-fg-faint text-xs">Total</span>
              <Money
                value={total}
                fractionDigits={0}
                className="text-fg text-xl font-semibold tracking-tight"
              />
            </div>
          </div>

          <div className="flex-1 flex flex-col gap-0.5">
            {ordered.map((a) => {
              const isActive = activeId === a.id;
              const isDimmed = activeId !== null && !isActive;
              return (
                <div
                  key={a.id}
                  onMouseEnter={() => setActiveId(a.id)}
                  onMouseLeave={() => setActiveId(null)}
                  className={`flex items-center gap-3 rounded-lg px-3 py-2 transition-colors duration-140 ${
                    isActive ? "bg-surface-2" : "bg-transparent"
                  }`}
                >
                  <span
                    className="size-3 rounded-sm shrink-0 transition-colors duration-140"
                    style={{ background: isDimmed ? desaturate(a.color) : a.color }}
                  />
                  <span className="text-sm text-fg">{a.name}</span>
                  <span className="font-mono text-[11px] text-fg-faint bg-surface-3 rounded px-1.5 py-0.5">
                    {a.category}
                  </span>
                  <Percent
                    value={a.value / total}
                    fractionDigits={1}
                    className="ml-auto text-fg text-sm w-14 text-right"
                  />
                  <Money
                    value={a.value}
                    className="text-fg-faint text-sm w-28 text-right"
                  />
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </Surface>
  );
}
