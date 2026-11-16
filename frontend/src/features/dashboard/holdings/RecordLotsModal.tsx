import { formatDate, zonedDay } from "../../../lib/date";
import { useEffect, useMemo, useRef, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { useErrorToast } from "../../../lib/errorToasts";
import { Lock, Trash2, X } from "lucide-react";

import { Button } from "../../../ui/Button";
import { CardError } from "../../../ui/CardError";
import { LoadingFrame } from "../../../ui/LoadingFrame";
import { Bone, Skeleton, TextBone } from "../../../ui/Skeleton";
import { staleClass } from "../../../ui/stale";
import { HoldingModalHeader } from "./HoldingModalHeader";
import { PHONE_SHEET } from "../../../ui/sheet";
import { Modal } from "../../../ui/Modal";
import { Money } from "../../../ui/Money";
import { MoneyHint } from "../../../ui/MoneyHint";
import { SegmentedControl } from "../../../ui/SegmentedControl";
import { useHoldingLots, useLotsPreview, useLotSuggestions, useSaveLots } from "../../../api/holdings";
import { formatMoney, formatQuantity } from "../../../lib/money";
import {
  accounted, badFee, badQuantity, badUnitPrice, byDate, lotChanges, lotEntry,
  recordedQuantity, rowFromLot, rowFromSuggestion, type FoundLot, type LotRow,
} from "../../../lib/lots";
import { lotCashAmount } from "../../../lib/lotRules";
import type { BasisPreview, Holding } from "../../../api/wire";
import { TextInput } from "../../../ui/TextInput";
import { DateInput } from "../../../ui/DateInput";
import { HEAD_TEXT } from "../../../ui/gridTable";

// Amounts here are in `holding.accountCurrency`, never `holding.currency` (the instrument's quote currency).
// Derived figures come from the preview endpoint, never computed here.

const PREVIEW_DEBOUNCE_MS = 300;

const ADD_ROW_BUTTON =
  "rounded-xl border border-surface-3 hover:border-fg-faint hover:bg-surface-2 transition-colors duration-140";

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
  const { data, isError, refetch } = useHoldingLots(holding.id);
  const saveLots = useSaveLots(holding.id);
  const body = useRef<HTMLDivElement>(null);
  const actions = useRef<HTMLDivElement>(null);
  const preview = useLotsPreview(holding.id);
  const suggestions = useLotSuggestions(holding.id);

  const [rows, setRows] = useState<LotRow[] | null>(null);
  const [found, setFound] = useState<FoundLot[]>([]);
  const [dismissed, setDismissed] = useState(false);
  // Edited saved rows get their delete half at save time, so a row both edited and binned is deleted once.
  const [queuedDeletes, setQueuedDeletes] = useState<string[]>([]);
  const [failed, setFailed] = useState(false);
  // Until the first edit the table mirrors the server; mid-edit a refetch must not reseed it.
  const [dirty, setDirty] = useState(false);
  const [seededFrom, setSeededFrom] = useState<{ lots: typeof data; suggested: typeof suggestions.data }>({
    lots: undefined,
    suggested: undefined,
  });

  // Seeds from the server during render. Waits for the suggestions to settle so pre-filled rows don't pop in;
  // the first seed always happens so rows added after a failed load join the retried lots.
  const suggestionsSettled = !suggestions.isPending;
  const seeded = seededFrom.lots !== undefined;
  if (
    data !== undefined &&
    suggestionsSettled &&
    (data !== seededFrom.lots || suggestions.data !== seededFrom.suggested) &&
    !(seeded && dirty)
  ) {
    setSeededFrom({ lots: data, suggested: suggestions.data });
    setFound(byDate((suggestions.data ?? []).map((sg) => ({ ...sg, key: newKey() }))));
    setRows(byDate([...data.map(rowFromLot), ...(seeded ? [] : rows ?? [])]));
  }

  const list = rows ?? [];
  const loading = rows === null && !isError;
  const set = (i: number, patch: Partial<LotRow>) => {
    setDirty(true);
    setRows((rs) => (rs ?? []).map((r, j) => (j === i ? { ...r, ...patch } : r)));
  };

  /** Called once a date is settled, so a row never jumps away from the field being typed in. */
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

  // A mutation's `data` resets to undefined while pending, so the last answer is held here.
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
  const computable = list.some((r) => lotEntry(r, language) !== null);
  const figures = computable ? lastPreview : null;
  const figuresLoading = loading || (computable && lastPreview === null && !preview.isError);
  const figuresStale = staleClass(computable && lastPreview !== null && preview.isPending);

  const { adds, deletes, pending, anyInvalid } = lotChanges(list, queuedDeletes, language);
  // Over-recording (red bar) doesn't block Save: a sale may be entered before its buy.
  const canSave = pending > 0 && !anyInvalid;

  const save = async () => {
    setFailed(false);
    try {
      await saveLots.mutateAsync({ adds, deletes });
      onClose();
    } catch {
      // One DB transaction: a failure means nothing was written.
      setFailed(true);
    }
  };

  const currency = holding.accountCurrency;

  useErrorToast(failed && t("dashboard.holdings.gap.saveError"), t("dashboard.holdings.gap.saveErrorDetail"));

  return (
    <Modal
      label={t("dashboard.holdings.gap.title")}
      onClose={onClose}
      busy={saveLots.isPending}
      focusWithin={[body, actions]}
      className={`relative w-208 max-w-[90vw] max-h-[85vh] bg-surface rounded-3xl flex flex-col ${PHONE_SHEET}`}
    >
      <HoldingModalHeader holding={holding}>
        <button
          type="button"
          onClick={onClose}
          disabled={saveLots.isPending}
          aria-label={t("common.close")}
          className="p-1.5 rounded-lg text-fg-faint hover:bg-surface-2 hover:text-fg transition-colors duration-140 cursor-pointer"
        >
          <X className="size-5" />
        </button>
      </HoldingModalHeader>

      <div className={`shrink-0 px-6 pb-4 ${found.length > 0 && !dismissed ? "" : "border-b border-surface-2"}`}>
        <div className="bg-surface-2 rounded-2xl p-5 flex flex-col gap-3">
          {loading ? (
            <Skeleton>
              <TextBone text="text-sm" className="w-56" />
            </Skeleton>
          ) : (
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
          )}
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

      <LoadingFrame loading={loading} className="flex min-h-0 flex-1 flex-col">
      <div ref={body} className="min-h-0 flex-1 overflow-y-auto px-6 pb-4 flex flex-col gap-4">
        {rows === null && !loading ? (
          <CardError
            onRetry={() => refetch()}
            className="mt-4 h-32"
          />
        ) : !loading && list.length === 0 ? (
          <p className="text-fg-faint text-sm py-4">{t("dashboard.holdings.gap.empty")}</p>
        ) : (
          <table className="w-full table-fixed border-separate border-spacing-0">
            <LotColumns />
            <thead>
              <tr className={HEAD_TEXT}>
                <th className={`${TH} text-left pl-3`}>{t("dashboard.holdings.gap.columns.type")}</th>
                <th className={`${TH} text-left pl-3.5`}>{t("dashboard.holdings.gap.columns.date")}</th>
                <th className={`${TH} text-right pr-5.5`}>{t("dashboard.holdings.gap.columns.quantity")}</th>
                <th className={`${TH} text-right pr-5.5`}>{t("dashboard.holdings.gap.columns.unitPrice")}</th>
                <th className={`${TH} text-right pr-5.5`}>{t("dashboard.holdings.gap.columns.fee")}</th>
                <th className={`${TH} text-right pr-2`}>{t("dashboard.holdings.gap.columns.total")}</th>
                <th className={TH} />
              </tr>
            </thead>
            <tbody>
              {loading && <LotRowsSkeleton />}
              {list.map((r, i) => {
                const p = lotEntry(r, language);
                const cell = "py-1.5 pr-2 border-t border-surface-2";
                const lockedCell = "py-1.5 border-t border-surface-2";
                if (r.locked) {
                  return (
                    <tr key={r.key} data-testid="lot-row" className="text-sm text-fg-dim">
                      <td className={`${lockedCell} pl-3`}>{t(`dashboard.holdings.gap.${r.type}`)}</td>
                      <td className={`${lockedCell} pl-3.5 font-mono`}>{formatDate(r.date)}</td>
                      <td className={`${lockedCell} pr-5.5 text-right font-mono`}>{formatQuantity(r.quantity)}</td>
                      <td className={`${lockedCell} pr-5.5 text-right font-mono`}>{formatMoney(r.unitPrice, { currency })}</td>
                      <td className={`${lockedCell} pr-5.5 text-right font-mono`}>{formatMoney(r.fee, { currency })}</td>
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
                      <DateInput
                        data-testid="lot-date"
                        value={r.date}
                        onChange={(date) => set(i, { date })}
                        onBlur={sortRows}
                        invalid={r.date === ""}
                      />
                    </td>
                    <td className="py-1.5 pr-2 border-t border-surface-2">
                      <TextInput
                        inputMode="decimal"
                        data-testid="lot-quantity"
                        value={r.quantity}
                        onChange={(e) => set(i, { quantity: e.target.value })}
                        invalid={badQuantity(r.quantity, language)}
                        className="text-right"
                      />
                    </td>
                    <td className="py-1.5 pr-2 border-t border-surface-2">
                      <TextInput
                        inputMode="decimal"
                        data-testid="lot-unitPrice"
                        value={r.unitPrice}
                        onChange={(e) => set(i, { unitPrice: e.target.value })}
                        invalid={badUnitPrice(r.unitPrice, language)}
                        className="text-right"
                      />
                    </td>
                    <td className="py-1.5 pr-2 border-t border-surface-2">
                      <TextInput
                        inputMode="decimal"
                        data-testid="lot-fee"
                        value={r.fee}
                        onChange={(e) => set(i, { fee: e.target.value })}
                        invalid={badFee(r.fee, language)}
                        className="text-right"
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
          <Button variant="ghost" className={ADD_ROW_BUTTON} onClick={addRow}>
            {t("dashboard.holdings.gap.add")}
          </Button>
        </div>

      </div>

      <div className="shrink-0 border-t border-surface-2 px-6 pt-4">
        <div className="bg-surface-2 rounded-2xl p-5">
          <span className="text-fg text-sm font-semibold">
            {t("dashboard.holdings.gap.figures")}
          </span>
          <div className={`grid grid-cols-2 gap-y-4 gap-x-6 mt-4 ${figuresStale}`}>
            <Figure
              loading={figuresLoading}
              currency={currency}
              converted={figures?.reporting?.invested}
              testId="figure-invested"
              label={t("dashboard.holdings.gap.capitalInvested")}
              value={figures ? formatMoney(figures.invested, { currency }) : "—"}
            />
            <Figure
              loading={figuresLoading}
              currency={currency}
              converted={figures?.reporting?.meanPrice}
              testId="figure-meanPrice"
              label={t("dashboard.holdings.gap.meanPricePerShare")}
              value={figures ? formatMoney(figures.meanPrice, { currency }) : "—"}
            />
            <SignedFigure
              loading={figuresLoading}
              converted={figures?.reporting?.realised}
              testId="figure-realised"
              label={t("dashboard.holdings.gap.realisedPnl")}
              value={figures ? Number(figures.realised) : null}
              currency={currency}
            />
            <SignedFigure
              loading={figuresLoading}
              converted={figures?.reporting?.unrealised}
              testId="figure-unrealised"
              label={t("dashboard.holdings.gap.unrealisedPnl")}
              value={figures?.unrealised == null ? null : Number(figures.unrealised)}
              currency={currency}
            />
          </div>
        </div>
      </div>

      </LoadingFrame>

      <div ref={actions} className="relative z-10 flex shrink-0 items-center justify-end gap-2 rounded-b-3xl bg-surface px-6 pb-6 pt-2">
        <Button variant="ghost" onClick={onClose} disabled={saveLots.isPending}>
          {t("dashboard.holdings.gap.cancel")}
        </Button>
        <LoadingFrame loading={loading}>
          <Button variant="primary" onClick={save} disabled={!canSave} busy={saveLots.isPending} busyLabel={t("common.busy.saving")}>
            {pending === 0
              ? t("dashboard.holdings.gap.saveNone")
              : t("dashboard.holdings.gap.save", { count: pending })}
          </Button>
        </LoadingFrame>
      </div>
    </Modal>
  );
}

function FigureSlot({ label, loading, children }: { label: string; loading: boolean; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-fg-faint text-xs">{label}</span>
      {loading ? (
        <Skeleton>
          <TextBone text="text-base" className="w-24" />
        </Skeleton>
      ) : (
        <span className="self-start">{children}</span>
      )}
    </div>
  );
}

function Figure({ testId, label, value, currency, converted, loading }: {
  testId: string;
  label: string;
  value: string;
  currency: string;
  converted: string | null | undefined;
  loading: boolean;
}) {
  return (
    <FigureSlot label={label} loading={loading}>
      <MoneyHint side="right" currency={currency} converted={converted}>
        <span data-testid={testId} className="text-fg font-mono font-semibold text-sm">
          {value}
        </span>
      </MoneyHint>
    </FigureSlot>
  );
}

function SignedFigure({
  testId,
  label,
  value,
  currency,
  converted,
  loading,
}: {
  converted: string | null | undefined;
  testId: string;
  label: string;
  value: number | null;
  currency: string;
  loading: boolean;
}) {
  return (
    <FigureSlot label={label} loading={loading}>
      {/* `Money` doesn't forward props, so the test hook goes on a wrapper. */}
      <MoneyHint side="right" currency={currency} converted={converted} signed>
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
    </FigureSlot>
  );
}

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
  const cell = "border-t border-blue/20 py-2.5 font-mono text-sm";
  return (
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

/** The table body can't hold a `Skeleton`, so each row pulses on its own, hidden from screen readers. */
function LotRowsSkeleton() {
  const cell = "py-1.5 pr-2 border-t border-surface-2";
  const field = <Bone className="h-9.5 rounded-xl" />;
  return Array.from({ length: 3 }, (_, i) => (
    <tr key={i} aria-hidden className="motion-safe:animate-pulse">
      <td className={cell}><Bone className="h-8.5 w-24 rounded-xl" /></td>
      <td className={cell}>{field}</td>
      <td className={cell}>{field}</td>
      <td className={cell}>{field}</td>
      <td className={cell}>{field}</td>
      <td className={cell}><Bone className="ml-auto h-3 w-16" /></td>
      <td className="py-1.5 border-t border-surface-2"><Bone className="ml-auto mr-1.5 size-4 rounded" /></td>
    </tr>
  ));
}
