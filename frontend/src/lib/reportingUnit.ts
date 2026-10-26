import type { PricePoint } from "../api/types";

/** The chart switch offers the reader's currency only when the chart is in
 *  another one and at least one day could be converted. */
export function reportingOffered(chartCurrency: string, readerCurrency: string, prices: PricePoint[]): boolean {
  return chartCurrency !== readerCurrency && prices.some((p) => p.reportingPrice !== null);
}
