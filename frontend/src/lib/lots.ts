import type { Lot, LotEntry, LotSide, LotSuggestion } from "../api/wire";
import { calendarDay } from "./date";
import { canonicalDecimal, compareDecimals, negateDecimal, normaliseDecimal, sumDecimals } from "./decimal";
import { validateLot } from "./lotRules";

export type FoundLot = LotSuggestion & { key: string };

type LotFields = { type: LotSide; date: string; quantity: string; unitPrice: string; fee: string };

export type LotRow = LotFields & {
  key: string;
  id?: string;
  /** A provider's lot: shown and counted, never edited, deleted or sent. */
  locked?: boolean;
  pristine?: LotFields;
  fromSuggestion?: FoundLot;
};

export function rowFromLot(l: Lot): LotRow {
  const fields: LotFields = { type: l.side, date: calendarDay(l.t), quantity: l.qty, unitPrice: l.price, fee: l.fee };
  return { ...fields, key: l.id, id: l.id, locked: !l.manual, pristine: fields };
}

export function rowFromSuggestion(f: FoundLot, key: string): LotRow {
  return { key, type: f.type, date: f.date, quantity: f.quantity, unitPrice: f.unitPrice, fee: f.fee, fromSuggestion: f };
}

export const byDate = <T extends { date: string }>(rows: T[]): T[] =>
  [...rows].sort((a, b) => a.date.localeCompare(b.date));

/** The server sends "16.030" while the user retypes "16.03": equal, or it would save as a no-op delete + re-add. Unreadable counts as changed (the row is invalid anyway). Empty is zero. */
function sameAmount(a: string, b: string, language: string): boolean {
  const read = (s: string) => canonicalDecimal(normaliseDecimal(s.trim() === "" ? "0" : s, language));
  const x = read(a);
  const y = read(b);
  return x !== null && y !== null ? compareDecimals(x, y) === 0 : a.trim() === b.trim();
}

function isRowChanged(r: LotRow, language: string): boolean {
  const p = r.pristine;
  return (
    p !== undefined &&
    (r.type !== p.type ||
      r.date.trim() !== p.date.trim() ||
      !sameAmount(r.quantity, p.quantity, language) ||
      !sameAmount(r.unitPrice, p.unitPrice, language) ||
      !sameAmount(r.fee, p.fee, language))
  );
}

export function badQuantity(raw: string, language: string): boolean {
  return raw !== "" && validateLot(normaliseDecimal(raw, language), "1") !== null;
}

export function badUnitPrice(raw: string, language: string): boolean {
  return raw !== "" && validateLot("1", normaliseDecimal(raw, language)) !== null;
}

export function badFee(raw: string, language: string): boolean {
  return raw.trim() !== "" && validateLot("1", "1", normaliseDecimal(raw, language)) !== null;
}

/** Null while invalid, so a half-typed number never makes the bar jump. Empty fee is zero. */
export function lotEntry(r: LotRow, language: string): LotEntry | null {
  if (r.date === "") return null;
  const quantity = canonicalDecimal(normaliseDecimal(r.quantity, language));
  const unitPrice = canonicalDecimal(normaliseDecimal(r.unitPrice, language));
  const fee = r.fee.trim() === "" ? undefined : canonicalDecimal(normaliseDecimal(r.fee, language));
  if (quantity === null || unitPrice === null || fee === null) return null;
  if (validateLot(quantity, unitPrice, fee) !== null) return null;
  return { type: r.type, date: r.date, quantity, unitPrice, ...(fee !== undefined ? { fee } : {}) };
}

/** A changed saved row is a delete + re-add in one atomic batch, but one entry in `pending`. */
export function lotChanges(rows: LotRow[], queuedDeletes: string[], language: string) {
  const editable = rows.filter((r) => !r.locked);
  const newRows = editable.filter((r) => r.id === undefined);
  const changedSaved = editable.filter((r) => r.id !== undefined && isRowChanged(r, language));
  return {
    adds: [...newRows, ...changedSaved].map((r) => lotEntry(r, language)).filter((p) => p !== null),
    deletes: [...queuedDeletes, ...changedSaved.map((r) => r.id!)],
    pending: newRows.length + changedSaved.length + queuedDeletes.length,
    anyInvalid: editable.some((r) => lotEntry(r, language) === null),
  };
}

export function recordedQuantity(rows: LotRow[], language: string): string {
  return sumDecimals(
    rows
      .map((r) => lotEntry(r, language))
      .filter((p) => p !== null)
      .map((p) => (p.type === "sell" ? negateDecimal(p.quantity) : p.quantity)),
  );
}

export function accounted(recorded: string, held: string): { state: "short" | "exact" | "over"; fill: number } {
  const c = compareDecimals(recorded, held);
  const state = c < 0 ? "short" : c > 0 ? "over" : "exact";
  const total = Number(held);
  const fill = state === "over" || total <= 0 ? 1 : Math.max(0, Math.min(1, Number(recorded) / total));
  return { state, fill };
}
