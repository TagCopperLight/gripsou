export type Target = { id: string; boundary: string; reset: string };
export type Handshake = {
  origin: string; token: string; anchor: string; samples: number; warmups: number;
  target: Target; expected: { netWorth: number; holding: string; holdingCount: number; accountCount: number };
};
export type Measurement = {
 id: string; parameters: Record<string, unknown>; boundary: string; reset: string;
 first_ms: number | null; samples_ms: number[]; batch_size: number; reset_ms: number;
 rows: number; outcome: Record<string, unknown>; correct: boolean; errors: string[];
 diagnostics: Record<string, unknown>;
};
