import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useErrorToast } from "../../../lib/errorToasts";

import { SettingsSurface } from "../../../ui/SettingsSurface";
import { CardError } from "../../../ui/CardError";
import { Bone, Skeleton, TextBone } from "../../../ui/Skeleton";
import { useBudgetAiUsage, useSetBudgetAiPrices, type BudgetAiPrices } from "../../../api/budget";
import type { BudgetAiModelUsage } from "../../../api/wire";
import { formatMoney } from "../../../lib/money";
import { canonicalDecimal, compareDecimals, normaliseDecimal } from "../../../lib/decimal";
import { TextInput } from "../../../ui/TextInput";
import { usePhone } from "../../../ui/usePhone";

type Side = "in" | "out";

const current = (m: BudgetAiModelUsage, side: Side) => (side === "in" ? m.priceIn : m.priceOut);

const TOTAL = "mt-4 flex items-baseline justify-between border-t border-surface-2 pt-4";

/** The admin types each model's price per million tokens; the server multiplies it through the recorded token counts. */
export function AiCostSurface() {
  const { t, i18n } = useTranslation();
  const query = useBudgetAiUsage();
  const usage = query.data;
  const phone = usePhone();
  const save = useSetBudgetAiPrices();
  // Uncommitted edits, keyed "<model>\u0000<side>"; absent = show the server value.
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  useErrorToast(save.isError && t("settings.server.budgetAiPriceSaveError"));
  const th = "pb-2 font-medium text-fg-faint";
  const head = (
    <thead>
      <tr className="text-left text-xs">
        <th className={th}>{t("settings.server.budgetAiCostModel")}</th>
        <th className={`${th} text-right`}>{t("settings.server.budgetAiCostRuns")}</th>
        <th className={`${th} text-right`}>{t("settings.server.budgetAiCostTokensIn")}</th>
        <th className={`${th} text-right`}>{t("settings.server.budgetAiCostTokensOut")}</th>
        <th className={`${th} text-right`}>{t("settings.server.budgetAiCostPriceIn")}</th>
        <th className={`${th} text-right`}>{t("settings.server.budgetAiCostPriceOut")}</th>
        <th className={`${th} text-right`}>{t("settings.server.budgetAiCostCost")}</th>
      </tr>
    </thead>
  );
  const totalLabel = <span className="text-sm font-medium text-fg">{t("settings.server.budgetAiCostTotal")}</span>;

  if (!usage) {
    return (
      <SettingsSurface title={t("settings.server.budgetAiCost")} hint={t("settings.server.budgetAiCostHint")}>
        {query.isError ? (
          <CardError onRetry={() => void query.refetch()} className="h-24" />
        ) : (
          <Skeleton>
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-fg">
                {head}
                <tbody className="divide-y divide-surface-2">
                  {["w-24", "w-32"].map((width) => (
                    <tr key={width}>
                      <td className="py-2.5 pr-4">
                        <TextBone text="text-sm" className={width} />
                      </td>
                      {["w-6", "w-10", "w-10"].map((width, i) => (
                        <td key={i} className="py-2.5 pl-3">
                          <TextBone text="text-sm" className={`ml-auto ${width}`} />
                        </td>
                      ))}
                      {[0, 1].map((i) => (
                        <td key={i} className="py-1.5 pl-3">
                          <Bone className="ml-auto h-9.5 w-24 rounded-xl" />
                        </td>
                      ))}
                      <td className="py-2.5 pl-3">
                        <TextBone text="text-sm" className="ml-auto w-12" />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className={TOTAL}>
              {totalLabel}
              <TextBone text="text-xl" className="w-20" />
            </div>
          </Skeleton>
        )}
      </SettingsSurface>
    );
  }

  const tokens = new Intl.NumberFormat(i18n.language, { notation: "compact", maximumFractionDigits: 1 });
  // Under one cent shows 4 decimals, so a nonzero cost never reads $0.00.
  const money = (v: string) => {
    const n = Math.abs(Number(v));
    return formatMoney(v, { currency: usage.currency, fractionDigits: n > 0 && n < 0.01 ? 4 : 2 });
  };
  const draftKey = (model: string, side: Side) => `${model}\u0000${side}`;

  const dropDraft = (key: string) =>
    setDrafts((d) => {
      const next = { ...d };
      delete next[key];
      return next;
    });

  const commit = (m: BudgetAiModelUsage, side: Side) => {
    const key = draftKey(m.model, side);
    const raw = drafts[key];
    if (raw === undefined) return;
    const value = canonicalDecimal(normaliseDecimal(raw, i18n.language));
    if (value === null || compareDecimals(value, "0") < 0 || value === current(m, side)) {
      dropDraft(key);
      return;
    }
    // The endpoint replaces the whole map: resend every model's prices with this side changed. A model with neither price is left out; with one side set, the other sends "0".
    const prices: BudgetAiPrices = {};
    for (const row of usage.models) {
      const pin = row.model === m.model && side === "in" ? value : row.priceIn;
      const pout = row.model === m.model && side === "out" ? value : row.priceOut;
      if (pin === null && pout === null) continue;
      prices[row.model] = { in: pin ?? "0", out: pout ?? "0" };
    }
    save.mutate(prices, { onSettled: () => dropDraft(key) });
  };

  const priceInput = (m: BudgetAiModelUsage, side: Side, className = "max-w-24") => {
    const key = draftKey(m.model, side);
    return (
      <TextInput
        inputMode="decimal"
        aria-label={t(side === "in" ? "settings.server.budgetAiCostPriceInFor" : "settings.server.budgetAiCostPriceOutFor", { model: m.model })}
        value={drafts[key] ?? current(m, side) ?? ""}
        onChange={(e) => setDrafts((d) => ({ ...d, [key]: e.target.value }))}
        onBlur={() => commit(m, side)}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
        }}
        className={`${className} text-right tabular-nums`}
      />
    );
  };

  const modelName = (m: BudgetAiModelUsage) => (
    <>
      <div className="font-mono">{m.model}</div>
      {m.runsWithoutUsage > 0 && (
        <div className="text-xs text-fg-faint">
          {t("settings.server.budgetAiCostNoUsage", { count: m.runsWithoutUsage })}
        </div>
      )}
    </>
  );

  const cost = (m: BudgetAiModelUsage) =>
    m.cost === null ? (
      <span className="text-xs text-fg-faint">{t("settings.server.budgetAiCostNoPrice")}</span>
    ) : (
      money(m.cost)
    );

  const figures: [string, (m: BudgetAiModelUsage) => string][] = [
    ["settings.server.budgetAiCostRuns", (m) => String(m.runs)],
    ["settings.server.budgetAiCostTokensIn", (m) => tokens.format(m.tokensIn)],
    ["settings.server.budgetAiCostTokensOut", (m) => tokens.format(m.tokensOut)],
  ];

  return (
    <SettingsSurface title={t("settings.server.budgetAiCost")} hint={t("settings.server.budgetAiCostHint")}>
      {usage.models.length === 0 ? (
        <p className="text-sm text-fg-faint">{t("settings.server.budgetAiCostEmpty")}</p>
      ) : (
        <>
          {phone ? (
            // Seven columns don't fit a phone: each model is a block, its prices as labelled full-width fields.
            <div className="flex flex-col divide-y divide-surface-2 text-sm text-fg">
              {usage.models.map((m) => (
                <div key={m.model} className="flex flex-col gap-3 py-3 first:pt-0">
                  <div className="flex items-start justify-between gap-3">
                    <div>{modelName(m)}</div>
                    <span className="tabular-nums whitespace-nowrap">{cost(m)}</span>
                  </div>
                  <dl className="grid grid-cols-3 gap-2">
                    {figures.map(([labelKey, value]) => (
                      <div key={labelKey}>
                        <dt className="text-xs text-fg-faint">{t(labelKey)}</dt>
                        <dd className="tabular-nums">{value(m)}</dd>
                      </div>
                    ))}
                  </dl>
                  <div className="grid grid-cols-2 gap-3">
                    {(["in", "out"] as const).map((side) => (
                      <div key={side} className="flex flex-col gap-1.5">
                        <span aria-hidden className="text-xs text-fg-faint">
                          {t(side === "in" ? "settings.server.budgetAiCostPriceIn" : "settings.server.budgetAiCostPriceOut")}
                        </span>
                        {priceInput(m, side, "w-full")}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-fg">
              {head}
              <tbody className="divide-y divide-surface-2">
                {usage.models.map((m) => (
                  <tr key={m.model}>
                    <td className="py-2.5 pr-4 align-top">{modelName(m)}</td>
                    {figures.map(([labelKey, value]) => (
                      <td key={labelKey} className="py-2.5 pl-3 text-right tabular-nums">{value(m)}</td>
                    ))}
                    <td className="py-1.5 pl-3 text-right">{priceInput(m, "in")}</td>
                    <td className="py-1.5 pl-3 text-right">{priceInput(m, "out")}</td>
                    <td className="py-2.5 pl-3 text-right tabular-nums whitespace-nowrap">{cost(m)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          )}
          <div className={TOTAL}>
            {totalLabel}
            <span data-testid="ai-cost-total" className="text-xl font-semibold tabular-nums text-fg">
              {money(usage.totalCost)}
            </span>
          </div>
        </>
      )}
    </SettingsSurface>
  );
}
