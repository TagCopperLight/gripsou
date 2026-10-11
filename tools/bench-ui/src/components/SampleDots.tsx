import ReactECharts from 'echarts-for-react'
import { formatMs } from '../lib/runs'
import { summarize } from '../lib/stats'

interface Lane { name: string; samples: number[]; color: string }

export function SampleDots({ lanes }: { lanes: Lane[] }) {
  const stats = lanes.map((l) => summarize(l.samples))
  const option = {
    animation: false,
    grid: { left: 110, right: 24, top: 10, bottom: 30 },
    xAxis: { type: 'value', name: 'ms', nameLocation: 'end', min: 0 },
    yAxis: { type: 'category', data: lanes.map((l) => l.name), inverse: true },
    tooltip: {
      trigger: 'item',
      formatter: (p: { seriesIndex: number; value: [number, string] }) => {
        const s = stats[p.seriesIndex]
        return `${lanes[p.seriesIndex].name}: ${formatMs(p.value[0])}<br/>median ${formatMs(s?.median ?? null)} · p95 ${formatMs(s?.p95 ?? null)}`
      },
    },
    series: lanes.map((l, i) => ({
      type: 'scatter',
      name: l.name,
      symbolSize: 7,
      itemStyle: { color: l.color, opacity: 0.55 },
      data: l.samples.map((v) => [v, l.name]),
      markPoint: stats[i]
        ? { symbol: 'pin', symbolSize: 26, label: { show: false }, data: [{ name: 'median', coord: [stats[i]!.median, l.name] }] }
        : undefined,
    })),
  }
  return <ReactECharts option={option} notMerge style={{ height: 50 + lanes.length * 40 }} />
}
