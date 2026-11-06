import { formatDate, zonedDay } from "../../../lib/date";
import { useEffect, useMemo, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { useErrorToast } from "../../../lib/errorToasts";
import { Lock, Trash2, X } from "lucide-react";

import { Button } from "../../../ui/Button";
import { CardState } from "../../../ui/CardState";
import { HoldingModalHeader } from "./HoldingModalHeader";
import { Modal } from "../../../ui/Modal";
import { Money } from "../../../ui/Money";
import { MoneyHint } from "../../../ui/MoneyHint";
import { SegmentedControl } from "../../../ui/SegmentedControl";
import { usePrefs } from "../../../auth/context";
import type { ReactNode } from "react";
import { useHoldingLots, useLotsPreview, useLotSuggestions, useSaveLots } from "../../../api/hooks";
import { formatMoney, formatQuantity } from "../../../lib/money";
import {
  accounted, badFee, badQuantity, badUnitPrice, byDate, lotCashAmount, lotChanges, lotEntry,
  recordedQuantity, rowFromLot, rowFromSuggestion, type FoundLot, type LotRow,
} from "../../../lib/lots";
import type { BasisPreview, Holding } from "../../../api/types";

// Every figure on this screen is AMOUNT domain (`holding.accountCurrency`):
// quantities, unit prices, and everything the preview endpoint derives from
// them (the server converts today's price into the account's currency for the
// unrealised figure). Never label anything here with
// `holding.currency` (the instrument's quote currency): it names the asset's
// identity, not any amount on this screen.
//
// The resulting figures (mean price, invested, realised, unrealised) are never
// computed here — they come verbatim from `POST /holdings/:id/lots/preview`,
// which runs the same `lot_basis` function the save path and the chart use.

/** How long to wait after the last edit before asking the server for updated
 *  figures — avoids firing a request per keystroke. */
const PREVIEW_DEBOUNCE_MS = 300;

const ADD_ROW_BUTTON =
  "rounded-xl border border-surface-3 hover:border-fg-faint hover:bg-surface-2 transition-colors duration-140";

/** Column titles stay pinned while the rows scroll under them. */
const TH = "sticky top-0 z-10 bg-surface pt-4 pb-2 font-medium";

const BAR_COLOR = { short: "bg-amber", exact: "bg-green", over: "bg-red" } as const;

let nextKey = 0;
const newKey = () => `row-${nextKey++}`;

export function RecordLotsModal({
  holding,
  onClose,
}: {
  holding: Holding;
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation();
  const readerCurrency = usePrefs().currency;
  const { data, isError, refetch } = useHoldingLots(holding.id);
  const saveLots = useSaveLots(holding.id);
  const preview = useLotsPreview(holding.id);
  const suggestions = useLotSuggestions(holding.id);

  const [rows, setRows] = useState<LotRow[] | null>(null);
  // Suggestions stay out of the table until the user adds them.
  const [found, setFound] = useState<FoundLot[]>([]);
  const [dismissed, setDismissed] = useState(false);
  // Ids the user binned. An edited saved row's delete half is derived at save
  // time instead, so a row both edited and binned is deleted once.
  const [queuedDeletes, setQueuedDeletes] = useState<string[]>([]);
  const [failed, setFailed] = useState(false);
  // Until the first edit the table mirrors the server, so a refetch may
  // reseed it; mid-edit it must not throw away what the user is typing.
  const [dirty, setDirty] = useState(false);
  const [seededFrom, setSeededFrom] = useState<{ lots: typeof data; suggested: typeof suggestions.data }>({
    lots: undefined,
    suggested: undefined,
  });

  // Mirrors the server into state during render, as React recommends for
  // "copy this prop until the user diverges from it". Seeding waits for the
  // suggestions to settle (loaded or failed) so pre-filled rows don't pop in
  // after the table has rendered.
  const suggestionsSettled = !suggestions.isPending;
  if (
    data !== undefined &&
    suggestionsSettled &&
    (data !== seededFrom.lots || suggestions.data !== seededFrom.suggested) &&
    !(rows !== null && dirty)
  ) {
    setSeededFrom({ lots: data, suggested: suggestions.data });
    setFound(byDate((suggestions.data ?? []).map((sg) => ({ ...sg, key: newKey() }))));
    setRows(byDate(data.map(rowFromLot)));
  }

  const list = rows ?? [];
  const set = (i: number, patch: Partial<LotRow>) => {
    setDirty(true);
    setRows((rs) => (rs ?? []).map((r, j) => (j === i ? { ...r, ...patch } : r)));
  };

  /** Back in date order once a date is settled, not on every keystroke, so a
   *  row never jumps away from the field being typed in. */
  const sortRows = () => setRows((rs) => (rs === null ? rs : byDate(rs)));

  const addRow = () => {
    setDirty(true);
    setRows((rs) => byDate([...(rs ?? []), { key: newKey(), type: "buy", date: zonedDay(), quantity: "", unitPrice: "", fee: "" }]));
  };

  const addFound = (adding: FoundLot[]) => {
    setDirty(true);
    const keys = new Set(adding.map((f) => f.key));
    setFound((fs) => fs.filter((f) => !keys.has(f.key)));
    setRows((rs) => byDate([...(rs ?? []), ...adding.map((f) => rowFromSuggestion(f, newKey()))]));
  };

  const remove = (i: number) => {
    setDirty(true);
    const row = list[i];
    const back = row.fromSuggestion;
    if (back) setFound((fs) => byDate([...fs, back]));
    if (row.id) setQueuedDeletes((ds) => [...ds, row.id!]);
    setRows((rs) => (rs ?? []).filter((_, j) => j !== i));
  };

  const language = i18n.language;
  const parsed = useMemo(
    () => (rows ?? []).filter((r) => !r.locked).map((r) => lotEntry(r, language)).filter((p) => p !== null),
    [rows, language],
  );

  const recorded = recordedQuantity(list, language);
  const bar = accounted(recorded, holding.qty);

  // Loaded rows are previewed at once; only user edits are debounced. A
  // mutation's `data` resets to undefined whenever it goes pending, so the
  // last answer is held here and is what renders. Null until the first
  // answer: no figure rather than a wrong "0,00 €".
  const [lastPreview, setLastPreview] = useState<BasisPreview | null>(null);
  useEffect(() => {
    if (rows === null) return;
    let current = true;
    const request = () => preview.mutate(parsed, {
      // A slower response for an earlier edit must not replace newer figures.
      onSuccess: (result) => { if (current) setLastPreview(result); },
    });
    const id = dirty ? setTimeout(request, PREVIEW_DEBOUNCE_MS) : undefined;
    if (!dirty) request();
    return () => {
      current = false;
      clearTimeout(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(parsed), holding.id, dirty, rows === null]);

  // Nothing to compute from: no figure, rather than the server's all-zero answer.
  const figures = list.some((r) => lotEntry(r, language) !== null) ? lastPreview : null;

  const { adds, deletes, pending, anyInvalid } = lotChanges(list, queuedDeletes, language);
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
  // The same figure in the reader's currency, only when it differs from the account's.
  const reportingHint = (v: string | null | undefined, signed = false): ReactNode | null =>
    v != null && currency !== readerCurrency ? <Money value={v} signed={signed} /> : null;

  useErrorToast(failed && t("dashboard.holdings.gap.saveError"), t("dashboard.holdings.gap.saveErrorDetail"));

  return (
    <Modal
      label={t("dashboard.holdings.gap.title")}
      onClose={onClose}
      busy={saveLots.isPending}
      className="relative w-208 max-w-[90vw] max-h-[85vh] bg-surface rounded-3xl flex flex-col"
    >
      <HoldingModalHeader holding={holding}>
        <button
          type="button"
          onClick={onClose}
          disabled={saveLots.isPending}
          aria-label={t("common.close")}
          className="p-1.5 rounded-lg text-fg-faint hover:bg-surface-2 hover:text-fg transition-colors duration-140 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <X className="size-5" />
        </button>
      </HoldingModalHeader>

      {/* Fixed above the scrolling table: the shares bar, then the found band
          when there is one. Its bottom rule, or this one, separates them from the table. */}
      <div className={`shrink-0 px-6 pb-4 ${found.length > 0 && !dismissed ? "" : "border-b border-surface-2"}`}>
        {/* Accounted bar */}
        <div className="bg-surface-2 rounded-2xl p-5 flex flex-col gap-3">
          <span className="text-fg-dim text-sm">
            <Trans
              i18nKey="dashboard.holdings.gap.accounted"
              values={{
                recorded: formatQuantity(recorded),
                total: formatQuantity(holding.qty),
              }}
              components={{ num: <span className="font-mono" /> }}
            />
          </span>
          <div className="h-2 w-full rounded-full bg-surface-3 overflow-hidden">
            <div
              data-testid="accounted-bar"
              className={`h-full rounded-full transition-all duration-140 ${BAR_COLOR[bar.state]}`}
              style={{ width: `${bar.fill * 100}%` }}
            />
          </div>
        </div>
      </div>
      {found.length > 0 && !dismissed && (
        <FoundPanel found={found} currency={currency} onAdd={addFound} onDismiss={() => setDismissed(true)} />
      )}

      <div data-modal-body className="min-h-0 flex-1 overflow-y-auto px-6 pb-4 flex flex-col gap-4">
        {/* Table — no surface, deliberately: it is the working area, not a card. */}
        {rows === null ? (
          <CardState
            variant={isError ? "error" : "loading"}
            onRetry={() => refetch()}
            className="mt-4 h-32"
          />
        ) : list.length === 0 ? (
          <p className="text-fg-faint text-sm py-4">{t("dashboard.holdings.gap.empty")}</p>
        ) : (
          <table className="w-full table-fixed border-separate border-spacing-0">
            <LotColumns />
            <thead>
              <tr className="text-[11px] font-mono text-fg-faint">
                <th className={`${TH} text-left pl-3`}>{t("dashboard.holdings.gap.columns.type")}</th>
                <th className={`${TH} text-left pl-3`}>{t("dashboard.holdings.gap.columns.date")}</th>
                <th className={`${TH} text-right pr-5`}>{t("dashboard.holdings.gap.columns.quantity")}</th>
                <th className={`${TH} text-right pr-5`}>{t("dashboard.holdings.gap.columns.unitPrice")}</th>
                <th className={`${TH} text-right pr-5`}>{t("dashboard.holdings.gap.columns.fee")}</th>
                <th className={`${TH} text-right pr-2`}>{t("dashboard.holdings.gap.columns.total")}</th>
                <th className={TH} />
              </tr>
            </thead>
            <tbody>
              {list.map((r, i) => {
                const p = lotEntry(r, language);
                const ring = "ring-1 ring-red";
                const input =
                  "w-full bg-surface-2 rounded-xl px-3 py-2 text-fg text-sm outline-none ring-inset focus:ring-1 focus:ring-green";
                const cell = "py-1.5 pr-2 border-t border-surface-2";
                // Text cells line their text up with the inputs' text (input padding + cell gap).
                const lockedCell = "py-1.5 border-t border-surface-2";
                if (r.locked) {
                  // A provider's lot: the same columns, as text, and a lock where the bin goes.
                  return (
                    <tr key={r.key} data-testid="lot-row" className="text-sm text-fg-dim">
                      <td className={`${lockedCell} pl-3`}>{t(`dashboard.holdings.gap.${r.type}`)}</td>
                      <td className={`${lockedCell} pl-3 font-mono`}>{formatDate(r.date)}</td>
                      <td className={`${lockedCell} pr-5 text-right font-mono`}>{formatQuantity(r.quantity)}</td>
                      <td className={`${lockedCell} pr-5 text-right font-mono`}>{formatMoney(r.unitPrice, { currency })}</td>
                      <td className={`${lockedCell} pr-5 text-right font-mono`}>{formatMoney(r.fee, { currency })}</td>
                      <td className={`${cell} text-right font-mono whitespace-nowrap`}>
                        {p === null ? "—" : formatMoney(lotCashAmount(p.type, p.quantity, p.unitPrice, p.fee), { currency })}
                      </td>
                      <td className="py-1.5 border-t border-surface-2 text-right">
                        <span title={t("dashboard.holdings.gap.locked")} aria-label={t("dashboard.holdings.gap.locked")} className="inline-flex p-1.5 text-fg-faint">
                          <Lock className="size-4" />
                        </span>
                      </td>
                    </tr>
                  );
                }
                return (
                  <tr key={r.key} data-testid="lot-row" className="text-sm">
                    <td className={cell}>
                      <SegmentedControl
                        value={r.type}
                        onChange={(v) => set(i, { type: v })}
                        options={[
                          { value: "buy", label: t("dashboard.holdings.gap.buy") },
                          { value: "sell", label: t("dashboard.holdings.gap.sell") },
                        ]}
                      />
                    </td>
                    <td className="py-1.5 pr-2 border-t border-surface-2">
                      <input
                        type="date"
                        data-testid="lot-date"
                        value={r.date}
                        onChange={(e) => set(i, { date: e.target.value })}
                        onBlur={sortRows}
                        className={`${input} ${r.date === "" ? ring : ""}`}
                      />
                    </td>
                    <td className="py-1.5 pr-2 border-t border-surface-2">
                      <input
                        inputMode="decimal"
                        data-testid="lot-quantity"
                        value={r.quantity}
                        onChange={(e) => set(i, { quantity: e.target.value })}
                        className={`${input} text-right ${badQuantity(r.quantity, language) ? ring : ""}`}
                      />
                    </td>
                    <td className="py-1.5 pr-2 border-t border-surface-2">
                      <input
                        inputMode="decimal"
                        data-testid="lot-unitPrice"
                        value={r.unitPrice}
                        onChange={(e) => set(i, { unitPrice: e.target.value })}
                        className={`${input} text-right ${badUnitPrice(r.unitPrice, language) ? ring : ""}`}
                      />
                    </td>
                    <td className="py-1.5 pr-2 border-t border-surface-2">
                      <input
                        inputMode="decimal"
                        data-testid="lot-fee"
                        value={r.fee}
                        onChange={(e) => set(i, { fee: e.target.value })}
                        className={`${input} text-right ${badFee(r.fee, language) ? ring : ""}`}
                      />
                    </td>
                    <td className="py-1.5 pr-2 border-t border-surface-2 text-right font-mono text-fg-dim whitespace-nowrap">
                      {p === null
                        ? "—"
                        : formatMoney(lotCashAmount(p.type, p.quantity, p.unitPrice, p.fee), {
                            currency,
                          })}
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
          {/* Bordered, not bare text: it sits under a table of inputs, where an
              unboxed label reads as a column heading rather than a control. */}
          <Button variant="ghost" className={ADD_ROW_BUTTON} onClick={addRow}>
            {t("dashboard.holdings.gap.add")}
          </Button>
        </div>

      </div>

      {/* The figures stay in view while the table scrolls above them. */}
      <div className="shrink-0 border-t border-surface-2 px-6 pt-4">
        <div className="bg-surface-2 rounded-2xl p-5">
          <span className="text-fg text-sm font-semibold">
            {t("dashboard.holdings.gap.figures")}
          </span>
          <div className="grid grid-cols-2 gap-y-4 gap-x-6 mt-4">
            <Figure
              hint={reportingHint(figures?.reporting?.invested)}
              testId="figure-invested"
              label={t("dashboard.holdings.gap.capitalInvested")}
              value={figures ? formatMoney(figures.invested, { currency }) : "—"}
            />
            <Figure
              hint={reportingHint(figures?.reporting?.meanPrice)}
              testId="figure-meanPrice"
              label={t("dashboard.holdings.gap.meanPricePerShare")}
              value={figures ? formatMoney(figures.meanPrice, { currency }) : "—"}
            />
            <SignedFigure
              hint={reportingHint(figures?.reporting?.realised, true)}
              testId="figure-realised"
              label={t("dashboard.holdings.gap.realisedPnl")}
              value={figures ? Number(figures.realised) : null}
              currency={currency}
            />
            <SignedFigure
              hint={reportingHint(figures?.reporting?.unrealised, true)}
              testId="figure-unrealised"
              label={t("dashboard.holdings.gap.unrealisedPnl")}
              value={figures?.unrealised == null ? null : Number(figures.unrealised)}
              currency={currency}
            />
          </div>
        </div>
      </div>

      <div data-modal-footer className="relative z-10 flex shrink-0 items-center justify-end gap-2 rounded-b-3xl bg-surface px-6 pb-6 pt-2">
        <Button variant="ghost" onClick={onClose} disabled={saveLots.isPending}>
          {t("dashboard.holdings.gap.cancel")}
        </Button>
        <Button variant="primary" onClick={save} disabled={!canSave}>
          {pending === 0
            ? t("dashboard.holdings.gap.saveNone")
            : t("dashboard.holdings.gap.save", { count: pending })}
        </Button>
      </div>
    </Modal>
  );
}

function Figure({ testId, label, value, hint }: { testId: string; label: string; value: string; hint: ReactNode | null }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-fg-faint text-xs">{label}</span>
      <span className="self-start">
        <MoneyHint side="right" hint={hint}>
          <span data-testid={testId} className="text-fg font-mono font-semibold text-sm">
            {value}
          </span>
        </MoneyHint>
      </span>
    </div>
  );
}

function SignedFigure({
  testId,
  label,
  value,
  currency,
  hint,
}: {
  hint: ReactNode | null;
  testId: string;
  label: string;
  value: number | null;
  currency: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-fg-faint text-xs">{label}</span>
      {/* `Money` renders only its own span and does not forward arbitrary
          props, so the test hook goes on a wrapper. */}
      <span className="self-start">
        <MoneyHint side="right" hint={hint}>
          <span data-testid={testId}>
            {value === null ? (
              <span className="text-fg-faint font-mono font-semibold text-sm">—</span>
            ) : (
              <Money
                value={value}
                currency={currency}
                signed
                className={`font-semibold text-sm ${value >= 0 ? "text-green" : "text-red"}`}
              />
            )}
          </span>
        </MoneyHint>
      </span>
    </div>
  );
}

/** One set of column widths for the table and the "found" panel above it, so
 *  a suggestion sits exactly over the row it will become. */
function LotColumns() {
  return (
    <colgroup>
      <col className="w-38" />
      <col className="w-42" />
      <col />
      <col />
      <col />
      <col className="w-30" />
      <col className="w-12" />
    </colgroup>
  );
}

/** Purchases and sales found in the user's transactions, offered before they
 *  touch the table: a row each, in the table's own columns, added one by one
 *  or all at once, or dismissed for now. */
function FoundPanel({ found, currency, onAdd, onDismiss }: {
  found: FoundLot[];
  currency: string;
  onAdd: (f: FoundLot[]) => void;
  onDismiss: () => void;
}) {
  const { t } = useTranslation();
  const buys = found.filter((f) => f.type === "buy").length;
  const title =
    buys === found.length ? t("dashboard.holdings.gap.found.buys", { count: buys })
    : buys === 0 ? t("dashboard.holdings.gap.found.sells", { count: found.length })
    : t("dashboard.holdings.gap.found.mixed", { count: found.length });
  // Cells line their text up with the inputs' text below (input padding + cell gap).
  const cell = "border-t border-blue/20 py-2.5 font-mono text-sm";
  return (
    // A band across the whole window, not a card: the blue runs edge to edge
    // between two rules, and the window's own margin keeps the columns over the table's.
    // It stays put above the scrolling table.
    <section aria-label={title} className="shrink-0 border-y border-blue/25 bg-blue-soft px-6 pt-3.5 pb-1.5">
      <div className="flex items-center justify-between gap-4 pb-2">
        <h3 className="text-sm font-semibold text-fg">{title}</h3>
        <div className="flex items-center gap-4">
          <button type="button" onClick={onDismiss} className="cursor-pointer text-[13px] font-medium text-fg-dim transition-colors duration-140 hover:text-fg">
            {t("dashboard.holdings.gap.found.dismiss")}
          </button>
          <button
            type="button"
            onClick={() => onAdd(found)}
            className="cursor-pointer rounded-[10px] bg-blue/20 px-3 py-1.25 text-[13px] font-medium text-blue-light transition-colors duration-140 hover:bg-blue/30"
          >
            {t("dashboard.holdings.gap.found.addAll")}
          </button>
        </div>
      </div>
      <table className="w-full table-fixed border-separate border-spacing-0">
        <LotColumns />
        <tbody>
          {found.map((f) => (
            <tr key={f.key}>
              <td className={`${cell} pl-3 font-sans text-fg`}>{t(`dashboard.holdings.gap.${f.type}`)}</td>
              <td className={`${cell} pl-3 text-fg-dim`}>{formatDate(f.date)}</td>
              <td className={`${cell} pr-5 text-right text-fg`}>{formatQuantity(f.quantity)}</td>
              <td className={`${cell} pr-5 text-right text-fg`}>{formatMoney(f.unitPrice, { currency })}</td>
              <td className={`${cell} pr-5 text-right text-fg-dim`}>{formatMoney(f.fee, { currency })}</td>
              <td className={`${cell} pr-2 text-right text-fg-dim whitespace-nowrap`}>
                {formatMoney(lotCashAmount(f.type, f.quantity, f.unitPrice, f.fee), { currency })}
              </td>
              <td className={`${cell} text-right`}>
                <button
                  type="button"
                  onClick={() => onAdd([f])}
                  className="cursor-pointer font-sans text-[13px] font-medium text-blue-light transition-opacity duration-140 hover:opacity-70"
                >
                  {t("dashboard.holdings.gap.found.add")}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
