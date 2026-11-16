import type { PricePoint } from "../api/wire";

export function reportingOffered(chartCurrency: string, readerCurrency: string, prices: PricePoint[]): boolean {
  return chartCurrency !== readerCurrency && prices.some((p) => p.reportingPrice !== null);
}
