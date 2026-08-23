import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { X } from "lucide-react";

import { Button } from "./Button";
import { useAddLot } from "../api/hooks";
import type { Holding } from "../api/types";

type Row = { date: string; quantity: string; unitPrice: string; saved: boolean };
const EMPTY_ROW: Row = { date: "", quantity: "", unitPrice: "", saved: false };

type AddLotModalProps = {
  holding: Holding;
  onClose: () => void;
};

/** An FR keyboard under `inputMode="decimal"` produces `16,03`, so a comma has
 *  to be readable as a decimal separator. But `16,029` (three decimals, like
 *  the PEA's real unit price) and `1,234` (en-US grouping) are indistinguishable
 *  from the string alone, and guessing wrong posts a value 1000x off in silence.
 *
 *  So the reader is locale-led: under `fr` a comma is the decimal separator,
 *  which is what the French keyboard produces and what French formatting means.
 *  Under any other language a comma is grouping, and a decimal comma is not
 *  expected — so anything containing one is left alone for `DECIMAL_RE` to
 *  reject, and the user is told rather than silently misread. Mixed or repeated
 *  separators are always ambiguous and always refused. */
function normaliseDecimal(raw: string, language: string): string {
  const s = raw.trim();
  // Both separators, or more than one comma: grouped, never unambiguous.
  if (s.includes(".") && s.includes(",")) return s;
  if ((s.match(/,/g) ?? []).length > 1) return s;
  if (!language.toLowerCase().startsWith("fr")) return s;
  return s.replace(",", ".");
}

const DECIMAL_RE = /^-?\d+(\.\d+)?$/;

type ValidationError = "invalidNumber" | "nonPositiveQuantity" | "negativeUnitPrice";

/** Mirrors the server's validation rules so a malformed row is caught with a
 *  specific, translated message instead of a generic "row N failed" once it
 *  round-trips to the API and back as a 400. */
function validateRow(quantity: string, unitPrice: string): ValidationError | null {
  if (!DECIMAL_RE.test(quantity) || !DECIMAL_RE.test(unitPrice)) return "invalidNumber";
  if (Number(quantity) <= 0) return "nonPositiveQuantity";
  if (Number(unitPrice) < 0) return "negativeUnitPrice";
  return null;
}

export function AddLotModal({ holding, onClose }: AddLotModalProps) {
  const { t, i18n } = useTranslation();
  const [rows, setRows] = useState<Row[]>([{ ...EMPTY_ROW }]);
  // The row that failed on the last save attempt, or null. Kept with an
  // index (not a boolean) so the error message can name the row, and a key
  // so a client-side validation failure gets its own specific message
  // instead of the generic server one.
  const [error, setError] = useState<{ row: number; key: ValidationError | "server" } | null>(
    null,
  );
  const addLot = useAddLot(holding.id);

  // Close on Escape; lock background scroll while open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  const set = (i: number, patch: Partial<Row>) =>
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  const complete = (r: Row) => r.date !== "" && r.quantity !== "" && r.unitPrice !== "";
  const canSave = rows.some((r) => complete(r) && !r.saved) && !addLot.isPending;

  const save = async () => {
    setError(null);
    // Sequential, not Promise.all: each lot changes the derived history, and a
    // partial failure should leave the earlier ones saved rather than left in
    // an unknown, possibly-duplicated state. On failure we stop, keep the
    // modal open, and surface the error so the user knows which lots (if any)
    // made it and can retry the rest — we never silently close on error.
    //
    // Each row is marked `saved` the moment its own request resolves. A retry
    // after a partial failure must never resubmit a row already marked saved:
    // manual lots have `external_id = null` (that is what keeps provider
    // syncs from touching them), which also means the server has no dedup for
    // them — resubmitting a saved row would silently double the quantity and
    // cost basis this feature exists to fix.
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      if (r.saved || !complete(r)) continue;
      const quantity = normaliseDecimal(r.quantity, i18n.language);
      const unitPrice = normaliseDecimal(r.unitPrice, i18n.language);
      const invalid = validateRow(quantity, unitPrice);
      if (invalid) {
        setError({ row: i, key: invalid });
        return;
      }
      try {
        await addLot.mutateAsync({ date: r.date, quantity, unitPrice });
        setRows((rs) => rs.map((row, j) => (j === i ? { ...row, saved: true } : row)));
      } catch {
        setError({ row: i, key: "server" });
        return;
      }
    }
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t("dashboard.holdings.gap.title")}
        onClick={(e) => e.stopPropagation()}
        className="relative w-120 max-w-[90vw] bg-surface rounded-3xl flex flex-col"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-6 pb-2">
          <h2 className="text-xl font-semibold text-fg">{t("dashboard.holdings.gap.title")}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("common.close")}
            className="p-1.5 rounded-lg text-fg-faint hover:bg-surface-2 hover:text-fg transition-colors duration-140 cursor-pointer"
          >
            <X className="size-5" />
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-4 flex flex-col gap-4">
          <p className="text-fg-faint text-sm">{holding.name}</p>

          {rows.map((r, i) => (
            <div key={i} className="flex items-end gap-2">
              <label className="flex-1 flex flex-col gap-1.5 text-fg-faint text-xs">
                {t("dashboard.holdings.gap.date")}
                <input
                  type="date"
                  value={r.date}
                  disabled={r.saved}
                  onChange={(e) => set(i, { date: e.target.value })}
                  className="w-full bg-surface-2 rounded-xl px-3 py-2 text-fg text-sm outline-none focus:ring-1 focus:ring-green disabled:opacity-50"
                />
              </label>
              <label className="flex-1 flex flex-col gap-1.5 text-fg-faint text-xs">
                {t("dashboard.holdings.gap.quantity")}
                <input
                  inputMode="decimal"
                  value={r.quantity}
                  disabled={r.saved}
                  onChange={(e) => set(i, { quantity: e.target.value })}
                  className="w-full bg-surface-2 rounded-xl px-3 py-2 text-fg text-sm outline-none focus:ring-1 focus:ring-green disabled:opacity-50"
                />
              </label>
              <label className="flex-1 flex flex-col gap-1.5 text-fg-faint text-xs">
                {t("dashboard.holdings.gap.unitPrice")}
                <input
                  inputMode="decimal"
                  value={r.unitPrice}
                  disabled={r.saved}
                  onChange={(e) => set(i, { unitPrice: e.target.value })}
                  className="w-full bg-surface-2 rounded-xl px-3 py-2 text-fg text-sm outline-none focus:ring-1 focus:ring-green disabled:opacity-50"
                />
              </label>
              {r.saved && (
                <span className="mb-2 shrink-0 text-[10px] px-1.5 py-0.5 rounded-full bg-green-soft text-green">
                  {t("dashboard.holdings.gap.saved")}
                </span>
              )}
            </div>
          ))}

          <Button
            variant="ghost"
            padded={false}
            className="self-start"
            onClick={() => setRows((rs) => [...rs, { ...EMPTY_ROW }])}
          >
            {t("dashboard.holdings.gap.add")}
          </Button>

          {error !== null && (
            <p className="text-red text-sm">
              {t(`dashboard.holdings.gap.${error.key === "server" ? "saveError" : error.key}`, {
                row: error.row + 1,
              })}
            </p>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-6 pb-6 pt-2">
          <Button variant="ghost" onClick={onClose}>
            {t("dashboard.holdings.gap.cancel")}
          </Button>
          <Button variant="primary" onClick={save} disabled={!canSave}>
            {t("dashboard.holdings.gap.save")}
          </Button>
        </div>
      </div>
    </div>
  );
}
