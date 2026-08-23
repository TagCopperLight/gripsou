import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Trash2, X } from "lucide-react";

import { Button } from "./Button";
import { CardState } from "./CardState";
import { HoldingModalHeader } from "./HoldingModalHeader";
import { Money } from "./Money";
import { useHoldingTransactions, useSaveLots, type SaveLotAdd } from "../api/hooks";
import { formatMoney, formatQuantity, normaliseDecimal, validateRow } from "../lib/money";
import { resultingFigures, type LotRow } from "../lib/lots";
import type { Holding } from "../api/types";

// Every figure on this screen is AMOUNT domain (`holding.accountCurrency`):
// quantities, unit prices, and everything `resultingFigures` derives from them.
// The one exception is `holding.price`, which is PRICE domain and feeds the
// unrealised figure — the same approximation `AssetModal` documents for its
// purchases chart, exact whenever the account and the listing share a currency.
// Never label anything here with `holding.currency` (the instrument's quote
// currency): it names the asset's identity, not any amount on this screen.

/** Quantities compare through a tolerance, not `===`: these are decimal strings
 *  parsed into IEEE doubles, and 0.1 + 0.2 must still count as 0.3. */
const EPS = 1e-8;

const today = () => new Date().toISOString().slice(0, 10);

type Row = {
  /** Present on a row already saved; absent on one the user just added. */
  id?: string;
  type: "buy" | "sell";
  date: string;
  quantity: string;
  unitPrice: string;
  /** Present only on rows seeded from the server: the values as loaded, so an
   *  edit can be detected later. A saved row is "changed" when its date differs
   *  as a string, or either amount differs NUMERICALLY — see `isRowChanged`. */
  pristine?: { date: string; quantity: string; unitPrice: string };
};

const ADD_ROW_BUTTON =
  "rounded-xl border border-surface-3 hover:border-fg-faint hover:bg-surface-2 transition-colors duration-140";

/** True for a saved row whose date/quantity/unitPrice no longer match what it
 *  was seeded with. Always false for a row the user just added (no pristine).
 *
 *  The amounts compare as NUMBERS, not as strings: the server sends a decimal
 *  it chose the scale of, so a PEA lot arrives as "16.030" while the user
 *  retypes the same price as "16.03". String-comparing those calls it an edit
 *  and saves a delete + re-add that changes nothing — burning the row's id and
 *  counting a phantom entry on the Save button. A non-numeric intermediate
 *  ("16.") yields NaN, which compares unequal and so reads as changed; that is
 *  harmless, because such a row is invalid and already blocks Save.
 *
 *  The date stays a string comparison: it is an exact `YYYY-MM-DD` from the
 *  date input, with no equivalent-but-differently-written forms. */
const sameAmount = (a: string, b: string): boolean =>
  a.trim() === b.trim() || Number(a) === Number(b);

const isRowChanged = (r: Row): boolean =>
  r.pristine !== undefined &&
  (r.date.trim() !== r.pristine.date.trim() ||
    !sameAmount(r.quantity, r.pristine.quantity) ||
    !sameAmount(r.unitPrice, r.pristine.unitPrice));

export function RecordLotsModal({
  holding,
  onClose,
}: {
  holding: Holding;
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation();
  const { data, isError, refetch } = useHoldingTransactions(holding.id);
  const saveLots = useSaveLots(holding.id);

  const [rows, setRows] = useState<Row[] | null>(null);
  // Ids the user explicitly binned via the delete button. A changed-but-not-
  // binned saved row is NOT in here — its delete half is derived at save time
  // (see `deletes` below), so a row that is both edited and then binned only
  // contributes one delete, not two.
  const [queuedDeletes, setQueuedDeletes] = useState<string[]>([]);
  const [failed, setFailed] = useState(false);
  // Flips true on the first user edit (typing, adding, deleting a row). Until
  // then the table just mirrors the server, so a refetch before the user has
  // touched anything is free to reseed it — only a refetch mid-edit must not
  // throw away what the user is typing.
  const [dirty, setDirty] = useState(false);
  // The last `data` reference the table was seeded from — lets a render tell
  // a genuine refetch apart from a re-render with the same data.
  const [seededFrom, setSeededFrom] = useState<typeof data>(undefined);

  // Adjusting state during render (not in an effect) is the pattern React
  // recommends for "mirror this prop into state until the user diverges from
  // it" — it avoids an extra render pass and the effect only exists to call
  // setState synchronously anyway.
  if (data !== undefined && data !== seededFrom && !(rows !== null && dirty)) {
    setSeededFrom(data);
    setRows(
      data
        .filter((p) => p.manual)
        .map((p) => {
          const date = new Date(p.t).toISOString().slice(0, 10);
          const quantity = p.qty;
          const unitPrice = p.price;
          return { id: p.id, type: p.type, date, quantity, unitPrice, pristine: { date, quantity, unitPrice } };
        }),
    );
  }

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

  const list = rows ?? [];
  const set = (i: number, patch: Partial<Row>) => {
    setDirty(true);
    setRows((rs) => (rs ?? []).map((r, j) => (j === i ? { ...r, ...patch } : r)));
  };

  const remove = (i: number) => {
    setDirty(true);
    const row = list[i];
    if (row.id) setQueuedDeletes((ds) => [...ds, row.id!]);
    setRows((rs) => (rs ?? []).filter((_, j) => j !== i));
  };

  /** A row is invalid when its date is empty, or its numbers fail the same
   *  rules the server applies. Invalid rows contribute nothing to the bar or
   *  the figures — a half-typed number, or a missing date, must not make
   *  either jump. The server rejects an empty date at deserialization, so
   *  gating here keeps Save from ever offering a batch the server would
   *  refuse. */
  const parse = (r: Row): LotRow | null => {
    if (r.date === "") return null;
    const quantity = normaliseDecimal(r.quantity, i18n.language);
    const unitPrice = normaliseDecimal(r.unitPrice, i18n.language);
    if (validateRow(quantity, unitPrice) !== null) return null;
    return { type: r.type, quantity: Number(quantity), unitPrice: Number(unitPrice) };
  };

  const parsed = useMemo(
    () => list.map(parse).filter((p): p is LotRow => p !== null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [list, i18n.language],
  );
  const anyInvalid = list.some((r) => parse(r) === null);

  const total = Number(holding.qty);
  const figures = resultingFigures(parsed, Number(holding.price));
  const recorded = figures.netQty;
  const short = recorded < total - EPS;
  const over = recorded > total + EPS;
  const barColor = over ? "bg-red" : short ? "bg-amber" : "bg-green";
  const barWidth = over || total <= 0 ? 1 : Math.max(0, Math.min(1, recorded / total));

  // A changed saved row is saved as a delete + re-add in the same atomic
  // batch — the backend applies both halves in one DB transaction, so the
  // row picking up a new id is harmless (manual lots aren't referenced by id).
  const newRows = list.filter((r) => r.id === undefined);
  const changedSaved = list.filter((r) => r.id !== undefined && isRowChanged(r));

  const adds: SaveLotAdd[] = [...newRows, ...changedSaved].map((r) => ({
    type: r.type,
    date: r.date,
    quantity: normaliseDecimal(r.quantity, i18n.language),
    unitPrice: normaliseDecimal(r.unitPrice, i18n.language),
  }));
  const deletes = [...queuedDeletes, ...changedSaved.map((r) => r.id!)];
  // One user-visible edit = one entry, even though a changed row contributes
  // to both `adds` and `deletes` above.
  const pending = newRows.length + changedSaved.length + queuedDeletes.length;
  // A red bar does NOT disable Save: a user entering a sale before the buy it
  // came from is mid-task, not wrong.
  const canSave = pending > 0 && !anyInvalid && !saveLots.isPending;

  const save = async () => {
    setFailed(false);
    try {
      await saveLots.mutateAsync({ adds, deletes });
      onClose();
    } catch {
      // The whole batch is one DB transaction, so a failure means nothing was
      // written — say exactly that, and keep the user's work on screen.
      setFailed(true);
    }
  };

  const currency = holding.accountCurrency;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t("dashboard.holdings.gap.title")}
        onClick={(e) => e.stopPropagation()}
        className="relative w-208 max-w-[90vw] max-h-[85vh] bg-surface rounded-3xl flex flex-col"
      >
        <HoldingModalHeader holding={holding}>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("common.close")}
            className="p-1.5 rounded-lg text-fg-faint hover:bg-surface-2 hover:text-fg transition-colors duration-140 cursor-pointer"
          >
            <X className="size-5" />
          </button>
        </HoldingModalHeader>

        <div className="flex-1 overflow-y-auto px-6 pb-2 flex flex-col gap-4">
          {/* Accounted bar */}
          <div className="bg-surface-2 rounded-2xl p-5 flex flex-col gap-3">
            <span className="text-fg-dim text-sm">
              {t("dashboard.holdings.gap.accounted", {
                recorded: formatQuantity(String(recorded)),
                total: formatQuantity(holding.qty),
              })}
            </span>
            <div className="h-2 w-full rounded-full bg-surface-3 overflow-hidden">
              <div
                data-testid="accounted-bar"
                className={`h-full rounded-full transition-all duration-140 ${barColor}`}
                style={{ width: `${barWidth * 100}%` }}
              />
            </div>
          </div>

          {/* Table — no surface, deliberately: it is the working area, not a card. */}
          {rows === null ? (
            <CardState
              variant={isError ? "error" : "loading"}
              onRetry={() => refetch()}
              className="h-32"
            />
          ) : list.length === 0 ? (
            <p className="text-fg-faint text-sm py-4">{t("dashboard.holdings.gap.empty")}</p>
          ) : (
            <table className="w-full border-separate border-spacing-0">
              <thead>
                <tr className="text-[11px] font-mono text-fg-faint">
                  <th className="text-left font-medium pb-2">{t("dashboard.holdings.gap.columns.type")}</th>
                  <th className="text-left font-medium pb-2">{t("dashboard.holdings.gap.columns.date")}</th>
                  <th className="text-left font-medium pb-2">{t("dashboard.holdings.gap.columns.quantity")}</th>
                  <th className="text-left font-medium pb-2">{t("dashboard.holdings.gap.columns.unitPrice")}</th>
                  <th className="text-left font-medium pb-2">{t("dashboard.holdings.gap.columns.total")}</th>
                  <th className="pb-2" />
                </tr>
              </thead>
              <tbody>
                {list.map((r, i) => {
                  const p = parse(r);
                  const badQty =
                    r.quantity !== "" &&
                    validateRow(normaliseDecimal(r.quantity, i18n.language), "1") !== null;
                  const badPrice =
                    r.unitPrice !== "" &&
                    validateRow("1", normaliseDecimal(r.unitPrice, i18n.language)) !== null;
                  const ring = "ring-1 ring-red";
                  const input =
                    "w-full bg-surface-2 rounded-xl px-3 py-2 text-fg text-sm outline-none focus:ring-1 focus:ring-green";
                  return (
                    <tr key={r.id ?? `new-${i}`} data-testid="lot-row" className="text-sm">
                      <td className="py-1.5 pr-2 border-t border-surface-2">
                        <span className={r.type === "sell" ? "text-fg-dim" : "text-fg"}>
                          {t(`dashboard.holdings.gap.${r.type}`)}
                        </span>
                      </td>
                      <td className="py-1.5 pr-2 border-t border-surface-2">
                        <input
                          type="date"
                          data-testid="lot-date"
                          value={r.date}
                          onChange={(e) => set(i, { date: e.target.value })}
                          className={`${input} ${r.date === "" ? ring : ""}`}
                        />
                      </td>
                      <td className="py-1.5 pr-2 border-t border-surface-2">
                        <input
                          inputMode="decimal"
                          data-testid="lot-quantity"
                          value={r.quantity}
                          onChange={(e) => set(i, { quantity: e.target.value })}
                          className={`${input} text-right ${badQty ? ring : ""}`}
                        />
                      </td>
                      <td className="py-1.5 pr-2 border-t border-surface-2">
                        <input
                          inputMode="decimal"
                          data-testid="lot-unitPrice"
                          value={r.unitPrice}
                          onChange={(e) => set(i, { unitPrice: e.target.value })}
                          className={`${input} text-right ${badPrice ? ring : ""}`}
                        />
                      </td>
                      <td className="py-1.5 pr-2 border-t border-surface-2 text-right font-mono text-fg-dim whitespace-nowrap">
                        {p === null
                          ? "—"
                          : formatMoney(
                              (p.type === "sell" ? 1 : -1) * p.quantity * p.unitPrice,
                              { currency },
                            )}
                      </td>
                      <td className="py-1.5 border-t border-surface-2 text-right">
                        <button
                          type="button"
                          onClick={() => remove(i)}
                          aria-label={t("dashboard.holdings.gap.delete")}
                          className="p-1.5 rounded-lg text-fg-faint hover:bg-surface-2 hover:text-red transition-colors duration-140 cursor-pointer"
                        >
                          <Trash2 className="size-4" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}

          <div className="flex items-center gap-2">
            {/* Bordered, not bare text: these sit under a table of inputs, where
                an unboxed label reads as a column heading rather than a control. */}
            <Button
              variant="ghost"
              className={ADD_ROW_BUTTON}
              onClick={() => {
                setDirty(true);
                setRows((rs) => [...(rs ?? []), { type: "buy", date: today(), quantity: "", unitPrice: "" }]);
              }}
            >
              {t("dashboard.holdings.gap.addBuy")}
            </Button>
            <Button
              variant="ghost"
              className={ADD_ROW_BUTTON}
              onClick={() => {
                setDirty(true);
                setRows((rs) => [...(rs ?? []), { type: "sell", date: today(), quantity: "", unitPrice: "" }]);
              }}
            >
              {t("dashboard.holdings.gap.addSell")}
            </Button>
          </div>

          {/* Resulting figures */}
          <div className="bg-surface-2 rounded-2xl p-5">
            <span className="text-fg text-sm font-semibold">
              {t("dashboard.holdings.gap.figures")}
              {(short || over) && (
                <span className="text-fg-faint font-normal">
                  {" · "}
                  {t("dashboard.holdings.gap.figuresProvisional")}
                </span>
              )}
            </span>
            <div className="grid grid-cols-2 gap-y-4 gap-x-6 mt-4">
              <Figure
                testId="figure-invested"
                label={t("dashboard.holdings.gap.capitalInvested")}
                value={formatMoney(figures.invested, { currency })}
              />
              <Figure
                testId="figure-meanPrice"
                label={t("dashboard.holdings.gap.meanPricePerShare")}
                value={formatMoney(figures.meanPrice, { currency })}
              />
              <SignedFigure
                testId="figure-realised"
                label={t("dashboard.holdings.gap.realisedPnl")}
                value={figures.realised}
                currency={currency}
              />
              <SignedFigure
                testId="figure-unrealised"
                label={t("dashboard.holdings.gap.unrealisedPnl")}
                value={figures.unrealised}
                currency={currency}
              />
            </div>
          </div>

          {failed && <p className="text-red text-sm">{t("dashboard.holdings.gap.saveError")}</p>}
        </div>

        <div className="flex items-center justify-end gap-2 px-6 pb-6 pt-2">
          <Button variant="ghost" onClick={onClose}>
            {t("dashboard.holdings.gap.cancel")}
          </Button>
          <Button variant="primary" onClick={save} disabled={!canSave}>
            {pending === 0
              ? t("dashboard.holdings.gap.saveNone")
              : t("dashboard.holdings.gap.save", { count: pending })}
          </Button>
        </div>
      </div>
    </div>
  );
}

function Figure({ testId, label, value }: { testId: string; label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-fg-faint text-xs">{label}</span>
      <span data-testid={testId} className="text-fg font-mono font-semibold text-sm">
        {value}
      </span>
    </div>
  );
}

function SignedFigure({
  testId,
  label,
  value,
  currency,
}: {
  testId: string;
  label: string;
  value: number;
  currency: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-fg-faint text-xs">{label}</span>
      {/* `Money` renders only its own span and does not forward arbitrary
          props, so the test hook goes on a wrapper. */}
      <span data-testid={testId}>
        <Money
          value={value}
          currency={currency}
          signed
          className={`font-semibold text-sm ${value >= 0 ? "text-green" : "text-red"}`}
        />
      </span>
    </div>
  );
}
