import { calendarDay, formatDate, zonedDay } from "../lib/date";
import { useEffect, useMemo, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { Lock, Trash2, X } from "lucide-react";

import { Button } from "./Button";
import { CardState } from "./CardState";
import { HoldingModalHeader } from "./HoldingModalHeader";
import { Modal } from "./Modal";
import { Money } from "./Money";
import { MoneyHint } from "./MoneyHint";
import { SegmentedControl } from "./SegmentedControl";
import { getPrefs } from "../lib/prefs";
import type { ReactNode } from "react";
import { useHoldingLots, useLotsPreview, useLotSuggestions, useSaveLots, type SaveLotAdd } from "../api/hooks";
import { formatMoney, formatQuantity, lotCashAmount, normaliseDecimal, validateRow } from "../lib/money";
import type { BasisPreview, Holding, LotSuggestion } from "../api/types";

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
// This file must never grow a `buyCost / buyQty` of its own: a second copy of
// the rule is how two figures for the same holding ended up disagreeing.

/** How long to wait after the last edit before asking the server for updated
 *  figures — avoids firing a request per keystroke. */
const PREVIEW_DEBOUNCE_MS = 300;

/** Quantities compare through a tolerance, not `===`: these are decimal strings
 *  parsed into IEEE doubles, and 0.1 + 0.2 must still count as 0.3. */
const EPS = 1e-8;

const today = () => zonedDay();

type Row = {
  /** Stable React key: rows move when they are put back in date order. */
  key: string;
  /** Present on a row already saved; absent on one the user just added. */
  id?: string;
  /** A provider's lot: shown and counted, never edited, deleted or sent. The
   *  preview keeps the provider's lots on its own, as saving does. */
  locked?: boolean;
  type: "buy" | "sell";
  date: string;
  quantity: string;
  unitPrice: string;
  /** Optional; an empty string means zero. */
  fee: string;
  /** Present only on rows seeded from the server: the values as loaded, so an
   *  edit can be detected later. A saved row is "changed" when its date differs
   *  as a string, or any amount differs NUMERICALLY — see `isRowChanged`. */
  pristine?: { type: "buy" | "sell"; date: string; quantity: string; unitPrice: string; fee: string };
  /** The suggestion this row was added from: binning the row puts it back in
   *  the "found in your transactions" panel. */
  fromSuggestion?: Found;
};

/** A suggestion waiting in the panel, until the user adds or dismisses it. */
type Found = LotSuggestion & { key: string };

const ADD_ROW_BUTTON =
  "rounded-xl border border-surface-3 hover:border-fg-faint hover:bg-surface-2 transition-colors duration-140";

let nextKey = 0;
const newKey = () => `row-${nextKey++}`;

/** Oldest first; `sort` is stable, so rows on the same day keep their order. */
const byDate = <T extends { date: string }>(rows: T[]): T[] => [...rows].sort((a, b) => a.date.localeCompare(b.date));

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
  (r.type !== r.pristine.type ||
    r.date.trim() !== r.pristine.date.trim() ||
    !sameAmount(r.quantity, r.pristine.quantity) ||
    !sameAmount(r.unitPrice, r.pristine.unitPrice) ||
    !sameAmount(r.fee, r.pristine.fee));

export function RecordLotsModal({
  holding,
  onClose,
}: {
  holding: Holding;
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation();
  const { data, isError, refetch } = useHoldingLots(holding.id);
  const saveLots = useSaveLots(holding.id);
  const preview = useLotsPreview(holding.id);
  const suggestions = useLotSuggestions(holding.id);

  const [rows, setRows] = useState<Row[] | null>(null);
  // Suggestions stay out of the table until the user adds them.
  const [found, setFound] = useState<Found[]>([]);
  const [dismissed, setDismissed] = useState(false);
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
  // The last pair of server responses the table was seeded from — lets a
  // render tell a genuine refetch apart from a re-render with the same data.
  const [seededFrom, setSeededFrom] = useState<{ lots: typeof data; suggested: typeof suggestions.data }>({
    lots: undefined,
    suggested: undefined,
  });

  // Adjusting state during render (not in an effect) is the pattern React
  // recommends for "mirror this prop into state until the user diverges from
  // it" — it avoids an extra render pass and the effect only exists to call
  // setState synchronously anyway.
  //
  // Seed once the suggestions have settled too (loaded or failed), so the
  // pre-filled rows don't pop in after the table has rendered. A failed
  // request seeds without them: the form works exactly as before.
  const suggestionsSettled = !suggestions.isPending;
  if (
    data !== undefined &&
    suggestionsSettled &&
    (data !== seededFrom.lots || suggestions.data !== seededFrom.suggested) &&
    !(rows !== null && dirty)
  ) {
    setSeededFrom({ lots: data, suggested: suggestions.data });
    setFound(byDate((suggestions.data ?? []).map((sg) => ({ ...sg, key: newKey() }))));
    setRows(byDate([
      ...data.map((l) => {
        const date = calendarDay(l.t);
        const quantity = l.qty;
        const unitPrice = l.price;
        const fee = l.fee;
        return {
          key: l.id,
          id: l.id,
          locked: !l.manual,
          type: l.side,
          date,
          quantity,
          unitPrice,
          fee,
          pristine: { type: l.side, date, quantity, unitPrice, fee },
        };
      }),
    ]));

  }

  const list = rows ?? [];
  const set = (i: number, patch: Partial<Row>) => {
    setDirty(true);
    setRows((rs) => (rs ?? []).map((r, j) => (j === i ? { ...r, ...patch } : r)));
  };

  /** Back in date order once a date is settled, not on every keystroke, so a
   *  row never jumps away from the field being typed in. */
  const sortRows = () => setRows((rs) => (rs === null ? rs : byDate(rs)));

  const addRow = () => {
    setDirty(true);
    setRows((rs) => byDate([...(rs ?? []), { key: newKey(), type: "buy", date: today(), quantity: "", unitPrice: "", fee: "" }]));
  };

  const addFound = (adding: Found[]) => {
    setDirty(true);
    const keys = new Set(adding.map((f) => f.key));
    setFound((fs) => fs.filter((f) => !keys.has(f.key)));
    setRows((rs) => byDate([
      ...(rs ?? []),
      ...adding.map((f) => ({
        key: newKey(), type: f.type, date: f.date, quantity: f.quantity, unitPrice: f.unitPrice, fee: f.fee, fromSuggestion: f,
      })),
    ]));
  };

  const remove = (i: number) => {
    setDirty(true);
    const row = list[i];
    const back = row.fromSuggestion;
    if (back) setFound((fs) => byDate([...fs, back]));
    if (row.id) setQueuedDeletes((ds) => [...ds, row.id!]);
    setRows((rs) => (rs ?? []).filter((_, j) => j !== i));
  };

  /** A row is invalid when its date is empty, or its numbers fail the same
   *  rules the server applies. Invalid rows contribute nothing to the bar or
   *  the figures — a half-typed number, or a missing date, must not make
   *  either jump. The server rejects an empty date at deserialization, so
   *  gating here keeps Save from ever offering a batch the server would
   *  refuse. */
  const toLotEntry = (r: Row): SaveLotAdd | null => {
    if (r.date === "") return null;
    const quantity = normaliseDecimal(r.quantity, i18n.language);
    const unitPrice = normaliseDecimal(r.unitPrice, i18n.language);
    if (validateRow(quantity, unitPrice) !== null) return null;
    const fee = r.fee.trim() === "" ? undefined : normaliseDecimal(r.fee, i18n.language);
    return { type: r.type, date: r.date, quantity, unitPrice, ...(fee !== undefined ? { fee } : {}) };
  };

  const editable = list.filter((r) => !r.locked);
  const parsed = useMemo(
    () => editable.map(toLotEntry).filter((p): p is SaveLotAdd => p !== null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [list, i18n.language],
  );
  const anyInvalid = editable.some((r) => toLotEntry(r) === null);

  // Net quantity is a plain count, not a money figure — safe to derive locally
  // (unlike mean price / invested / realised, which only ever come from the
  // preview endpoint).
  const recorded = [...parsed, ...list.filter((r) => r.locked).map(toLotEntry).filter((p) => p !== null)].reduce(
    (acc, p) => acc + (p.type === "sell" ? -Number(p.quantity) : Number(p.quantity)),
    0,
  );
  const total = Number(holding.qty);
  const short = recorded < total - EPS;
  const over = recorded > total + EPS;
  const barColor = over ? "bg-red" : short ? "bg-amber" : "bg-green";
  const barWidth = over || total <= 0 ? 1 : Math.max(0, Math.min(1, recorded / total));

  // Preview loaded rows immediately; debounce only user edits. TanStack
  // Query's mutation state resets `data` to `undefined`
  // the instant a mutation goes pending — `preview.data` alone would blank
  // the panel to zero on every request, not just the first. So the last
  // successful result is held here explicitly, and THAT is what renders;
  // `preview.data` is read only inside `onSuccess`, never for display.
  // Null until the first answer: no figure rather than a wrong "0,00 €".
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
  const figures = list.some((r) => toLotEntry(r) !== null) ? lastPreview : null;

  // A changed saved row is saved as a delete + re-add in the same atomic
  // batch — the backend applies both halves in one DB transaction, so the
  // row picking up a new id is harmless (manual lots aren't referenced by id).
  const newRows = editable.filter((r) => r.id === undefined);
  const changedSaved = editable.filter((r) => r.id !== undefined && isRowChanged(r));

  const adds: SaveLotAdd[] = [...newRows, ...changedSaved]
    .map(toLotEntry)
    .filter((p): p is SaveLotAdd => p !== null);
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
  // The same figure in the reader's currency, only when it differs from the account's.
  const reportingHint = (v: string | null | undefined, signed = false): ReactNode | null =>
    v != null && currency !== getPrefs().currency ? <Money value={v} signed={signed} /> : null;

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

      <div data-modal-body className="min-h-0 flex-1 overflow-y-auto px-6 pb-2 flex flex-col gap-4">
        {/* Accounted bar */}
        <div className="bg-surface-2 rounded-2xl p-5 flex flex-col gap-3">
          <span className="text-fg-dim text-sm">
            <Trans
              i18nKey="dashboard.holdings.gap.accounted"
              values={{
                recorded: formatQuantity(String(recorded)),
                total: formatQuantity(holding.qty),
              }}
              components={{ num: <span className="font-mono" /> }}
            />
          </span>
          <div className="h-2 w-full rounded-full bg-surface-3 overflow-hidden">
            <div
              data-testid="accounted-bar"
              className={`h-full rounded-full transition-all duration-140 ${barColor}`}
              style={{ width: `${barWidth * 100}%` }}
            />
          </div>
        </div>

        {found.length > 0 && !dismissed && (
          <FoundPanel found={found} currency={currency} onAdd={addFound} onDismiss={() => setDismissed(true)} />
        )}

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
                <th className="text-left font-medium pb-2">{t("dashboard.holdings.gap.columns.fee")}</th>
                <th className="text-left font-medium pb-2">{t("dashboard.holdings.gap.columns.total")}</th>
                <th className="pb-2" />
              </tr>
            </thead>
            <tbody>
              {list.map((r, i) => {
                const p = toLotEntry(r);
                const badQty =
                  r.quantity !== "" &&
                  validateRow(normaliseDecimal(r.quantity, i18n.language), "1") !== null;
                const badPrice =
                  r.unitPrice !== "" &&
                  validateRow("1", normaliseDecimal(r.unitPrice, i18n.language)) !== null;
                const ring = "ring-1 ring-red";
                const input =
                  "w-full bg-surface-2 rounded-xl px-3 py-2 text-fg text-sm outline-none focus:ring-1 focus:ring-green";
                const cell = "py-1.5 pr-2 border-t border-surface-2";
                if (r.locked) {
                  // A provider's lot: the same columns, as text, and a lock where the bin goes.
                  return (
                    <tr key={r.key} data-testid="lot-row" className="text-sm text-fg-dim">
                      <td className={`${cell} px-3`}>{t(`dashboard.holdings.gap.${r.type}`)}</td>
                      <td className={`${cell} px-3 font-mono`}>{formatDate(r.date)}</td>
                      <td className={`${cell} px-3 text-right font-mono`}>{formatQuantity(r.quantity)}</td>
                      <td className={`${cell} px-3 text-right font-mono`}>{formatMoney(r.unitPrice, { currency })}</td>
                      <td className={`${cell} px-3 text-right font-mono`}>{formatMoney(r.fee, { currency })}</td>
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
                    <td className="py-1.5 pr-2 border-t border-surface-2">
                      <input
                        inputMode="decimal"
                        data-testid="lot-fee"
                        value={r.fee}
                        onChange={(e) => set(i, { fee: e.target.value })}
                        className={`${input} text-right`}
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

        {/* Resulting figures */}
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

        {failed && <p className="text-red text-sm">{t("dashboard.holdings.gap.saveError")}</p>}
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

/** Purchases and sales found in the user's transactions, offered before they
 *  touch the table: added one by one or all at once, or dismissed for now. */
function FoundPanel({ found, currency, onAdd, onDismiss }: {
  found: Found[];
  currency: string;
  onAdd: (f: Found[]) => void;
  onDismiss: () => void;
}) {
  const { t } = useTranslation();
  const buys = found.filter((f) => f.type === "buy").length;
  const title =
    buys === found.length ? t("dashboard.holdings.gap.found.buys", { count: buys })
    : buys === 0 ? t("dashboard.holdings.gap.found.sells", { count: found.length })
    : t("dashboard.holdings.gap.found.mixed", { count: found.length });
  return (
    <section aria-label={title} className="rounded-2xl border border-blue/30 bg-blue-soft px-5 py-4">
      <div className="mb-1.5 flex items-center justify-between gap-4">
        <h3 className="text-sm font-semibold text-fg">{title}</h3>
        <div className="flex items-center gap-2">
          <Button variant="ghost" onClick={onDismiss}>{t("dashboard.holdings.gap.found.dismiss")}</Button>
          <Button variant="outline" onClick={() => onAdd(found)}>{t("dashboard.holdings.gap.found.addAll")}</Button>
        </div>
      </div>
      <ul>
        {found.map((f, i) => (
          <li key={f.key} className={`flex items-center gap-4 py-2.5 ${i > 0 ? "border-t border-surface-3" : ""}`}>
            <span className="w-24 shrink-0 font-mono text-[13px] text-fg-dim">{formatDate(f.date)}</span>
            <span className="flex-1 text-sm text-fg">
              <Trans
                i18nKey="dashboard.holdings.gap.found.line"
                count={Number(f.quantity)}
                values={{
                  type: t(`dashboard.holdings.gap.${f.type}`),
                  quantity: formatQuantity(f.quantity),
                  price: formatMoney(f.unitPrice, { currency }),
                }}
                components={{ num: <span className="font-mono" /> }}
              />
              {Number(f.fee) > 0 && (
                <span className="text-fg-faint">
                  {" · "}
                  <Trans
                    i18nKey="dashboard.holdings.gap.found.fee"
                    values={{ fee: formatMoney(f.fee, { currency }) }}
                    components={{ num: <span className="font-mono" /> }}
                  />
                </span>
              )}
            </span>
            <Button variant="outline" onClick={() => onAdd([f])}>{t("dashboard.holdings.gap.found.add")}</Button>
          </li>
        ))}
      </ul>
    </section>
  );
}
