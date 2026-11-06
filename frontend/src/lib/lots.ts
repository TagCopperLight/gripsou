import type { Lot, LotEntry, LotSide, LotSuggestion } from "../api/wire";
import { calendarDay } from "./date";
import { canonicalDecimal, compareDecimals, negateDecimal, normaliseDecimal, sumDecimals } from "./decimal";
import { validateLot } from "./lotRules";

/** A suggestion waiting in the panel, until the user adds or dismisses it. */
export type FoundLot = LotSuggestion & { key: string };

type LotFields = { type: LotSide; date: string; quantity: string; unitPrice: string; fee: string };

/** One line of the record-lots table, as typed. */
export type LotRow = LotFields & {
  /** Stable React key: rows move when they are put back in date order. */
  key: string;
  /** Present on a row already saved; absent on one the user just added. */
  id?: string;
  /** A provider's lot: shown and counted, never edited, deleted or sent. The
   *  preview keeps the provider's lots on its own, as saving does. */
  locked?: boolean;
  /** On a saved row: the values as loaded, to tell an edit apart. */
  pristine?: LotFields;
  /** The suggestion this row was added from: binning the row puts it back in
   *  the "found in your transactions" panel. */
  fromSuggestion?: FoundLot;
};

export function rowFromLot(l: Lot): LotRow {
  const fields: LotFields = { type: l.side, date: calendarDay(l.t), quantity: l.qty, unitPrice: l.price, fee: l.fee };
  return { ...fields, key: l.id, id: l.id, locked: !l.manual, pristine: fields };
}

export function rowFromSuggestion(f: FoundLot, key: string): LotRow {
  return { key, type: f.type, date: f.date, quantity: f.quantity, unitPrice: f.unitPrice, fee: f.fee, fromSuggestion: f };
}

/** Oldest first; `sort` is stable, so rows on the same day keep their order. */
export const byDate = <T extends { date: string }>(rows: T[]): T[] =>
  [...rows].sort((a, b) => a.date.localeCompare(b.date));

/** The server sends a decimal at a scale it chose, so a PEA lot arrives as
 *  "16.030" while the user retypes the same price as "16.03" (or "16,03" in
 *  French): equal, or the retyped row would be saved as a delete + re-add that
 *  changes nothing. An unreadable number reads as changed, which is harmless:
 *  that row is invalid and already blocks Save. An empty field is zero. */
function sameAmount(a: string, b: string, language: string): boolean {
  const read = (s: string) => canonicalDecimal(normaliseDecimal(s.trim() === "" ? "0" : s, language));
  const x = read(a);
  const y = read(b);
  return x !== null && y !== null ? compareDecimals(x, y) === 0 : a.trim() === b.trim();
}

/** A saved row whose values no longer match what it was loaded with. */
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

/** The quantity field fails the server's rules (an empty field is not flagged). */
export function badQuantity(raw: string, language: string): boolean {
  return raw !== "" && validateLot(normaliseDecimal(raw, language), "1") !== null;
}

export function badUnitPrice(raw: string, language: string): boolean {
  return raw !== "" && validateLot("1", normaliseDecimal(raw, language)) !== null;
}

export function badFee(raw: string, language: string): boolean {
  return raw.trim() !== "" && validateLot("1", "1", normaliseDecimal(raw, language)) !== null;
}

/** The row as the save and preview endpoints take it, or null while it is
 *  invalid: an empty date (refused by the server at deserialisation), or
 *  numbers failing `validateLot`. An invalid row counts nowhere, so a
 *  half-typed number never makes the bar or the figures jump. An empty fee
 *  means zero. */
export function lotEntry(r: LotRow, language: string): LotEntry | null {
  if (r.date === "") return null;
  const quantity = canonicalDecimal(normaliseDecimal(r.quantity, language));
  const unitPrice = canonicalDecimal(normaliseDecimal(r.unitPrice, language));
  const fee = r.fee.trim() === "" ? undefined : canonicalDecimal(normaliseDecimal(r.fee, language));
  if (quantity === null || unitPrice === null || fee === null) return null;
  if (validateLot(quantity, unitPrice, fee) !== null) return null;
  return { type: r.type, date: r.date, quantity, unitPrice, ...(fee !== undefined ? { fee } : {}) };
}

/** What Save sends. A changed saved row is a delete + re-add in the same
 *  atomic batch (manual lots are not referenced by id, so its new id is
 *  harmless), yet one entry in `pending`, the count the user sees. */
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

/** The net quantity the valid rows explain, provider lots included. */
export function recordedQuantity(rows: LotRow[], language: string): string {
  return sumDecimals(
    rows
      .map((r) => lotEntry(r, language))
      .filter((p) => p !== null)
      .map((p) => (p.type === "sell" ? negateDecimal(p.quantity) : p.quantity)),
  );
}

/** How the recorded quantity stands against the quantity held, and how much
 *  of the bar it fills. */
export function accounted(recorded: string, held: string): { state: "short" | "exact" | "over"; fill: number } {
  const c = compareDecimals(recorded, held);
  const state = c < 0 ? "short" : c > 0 ? "over" : "exact";
  const total = Number(held);
  const fill = state === "over" || total <= 0 ? 1 : Math.max(0, Math.min(1, Number(recorded) / total));
  return { state, fill };
}
