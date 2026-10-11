/** DOM observation for consumers that must wait for the real chart animation. */
type Chart = { getDom(): HTMLElement };
export const chartReadinessEvents = {
  rendered: (_: unknown, chart: Chart) => { chart.getDom().dataset.chartReady = "false"; },
  finished: (_: unknown, chart: Chart) => { chart.getDom().dataset.chartReady = "true"; },
};

/** A zero-data chart can finish synchronously before event listeners attach. */
export function chartReady(chart: Chart & {getZr(): {animation: {isFinished(): boolean}}}) {
  requestAnimationFrame(() => { if (chart.getZr().animation.isFinished()) chart.getDom().dataset.chartReady = "true"; });
}
