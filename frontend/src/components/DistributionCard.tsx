import { useState } from "react";
import { useTranslation } from "react-i18next";
import ReactECharts from "echarts-for-react";
import type { EChartsOption } from "echarts";

import { Surface } from "./Surface";
import { Money } from "./Money";
import { Percent } from "./Percent";
import { CardState } from "./CardState";
import { desaturate } from "../lib/color";
import { accountTypeLabel, type DistributionAccount } from "../api/types";
import { useDistribution } from "../api/hooks";

const SURFACE = "#13110f";

type DistributionCardProps = {
  className?: string;
};

export function DistributionCard({ className = "" }: DistributionCardProps) {
  const { t } = useTranslation();
  const { data, isError, refetch } = useDistribution();
  const ready = data !== undefined;
  const accounts = data ?? [];
  // The id of the hovered account, driven by both the legend and the donut.
  const [activeId, setActiveId] = useState<string | null>(null);
  const total = accounts.reduce((sum, a) => sum + Number(a.value), 0);
  // Largest proportion first, in both the donut and the legend.
  const ordered = [...accounts].sort((a, b) => Number(b.value) - Number(a.value));

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
          value: Number(a.value),
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
        <p className="text-fg font-semibold text-sm">{t("dashboard.distribution.title")}</p>
        {!ready ? (
          <CardState
            variant={isError ? "error" : "loading"}
            onRetry={() => refetch()}
            className="mt-2 h-55"
          />
        ) : (
        <div className="mt-2 flex flex-col items-center gap-4 md:flex-row md:gap-8">
          <div className="relative size-55 shrink-0">
            <ReactECharts
              option={option}
              onEvents={onEvents}
              style={{ height: "100%", width: "100%" }}
            />
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-fg-faint text-xs">{t("common.total")}</span>
              <Money
                value={total}
                fractionDigits={0}
                className="text-fg text-xl font-semibold tracking-tight"
              />
            </div>
          </div>

          <div className="w-full flex-1 flex flex-col gap-0.5">
            {ordered.map((a) => {
              const isActive = activeId === a.id;
              const isDimmed = activeId !== null && !isActive;
              return (
                <div
                  key={a.id}
                  onMouseEnter={() => setActiveId(a.id)}
                  onMouseLeave={() => setActiveId(null)}
                  className={`flex items-center gap-2 rounded-lg px-2 py-2 transition-colors duration-140 md:gap-3 md:px-3 ${
                    isActive ? "bg-surface-2" : "bg-transparent"
                  }`}
                >
                  <span
                    className="size-3 rounded-sm shrink-0 transition-colors duration-140"
                    style={{ background: isDimmed ? desaturate(a.color) : a.color }}
                  />
                  <span className="min-w-0 truncate text-sm text-fg">{a.name}</span>
                  <span className="hidden md:inline font-mono text-[11px] text-fg-faint bg-surface-3 rounded px-1.5 py-0.5 shrink-0">
                    {accountTypeLabel(t, a.accountType, a.accountTypeLabel)}
                  </span>
                  <Percent
                    value={Number(a.value) / total}
                    fractionDigits={1}
                    className="hidden md:block ml-auto shrink-0 text-fg text-sm w-14 text-right"
                  />
                  <span className="ml-auto flex shrink-0 items-center justify-end gap-1.5 pl-4 md:ml-0 md:w-28 md:pl-0">
                    {a.fxMissing && (
                      <span
                        title={t("dashboard.fxMissing")}
                        className="text-fg-faint text-xs leading-none"
                        aria-label={t("dashboard.fxMissing")}
                      >
                        ⚠
                      </span>
                    )}
                    <Money value={a.value} className="text-sm text-fg md:text-fg-faint" />
                  </span>
                </div>
              );
            })}
          </div>
        </div>
        )}
      </div>
    </Surface>
  );
}
