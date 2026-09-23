import { useState } from "react";
import { useTranslation } from "react-i18next";

import { Surface } from "./Surface";
import { useBudgetAiUsage, useSetBudgetAiPrices } from "../api/hooks";
import type { BudgetAiModelUsage, BudgetAiPrices } from "../api/budget";
import { DECIMAL_RE, formatMoney, normaliseDecimal } from "../lib/money";

type Side = "in" | "out";

const current = (m: BudgetAiModelUsage, side: Side) => (side === "in" ? m.priceIn : m.priceOut);

/** Settings → Server: what AI categorisation has cost so far, per model. The
 *  admin types each model's price (per million tokens) from the provider's
 *  pricing page; the server multiplies it through the recorded token counts. */
export function BudgetAiCostSurface() {
  const { t, i18n } = useTranslation();
  const usage = useBudgetAiUsage().data;
  const save = useSetBudgetAiPrices();
  // Uncommitted edits, keyed "<model>\u0000<side>"; absent = show the server value.
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  if (!usage) return null;

  const tokens = new Intl.NumberFormat(i18n.language, { notation: "compact", maximumFractionDigits: 1 });
  const money = (v: string, fractionDigits: number) =>
    formatMoney(v, { currency: usage.currency, fractionDigits });
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
    const value = normaliseDecimal(raw, i18n.language);
    const valid = DECIMAL_RE.test(value) && !value.startsWith("-");
    if (!valid || value === current(m, side)) {
      dropDraft(key);
      return;
    }
    // The endpoint replaces the whole map: resend every model's prices, with
    // this one side changed. A model with neither price set is left out; a
    // model with one side set sends "0" for the other.
    const prices: BudgetAiPrices = {};
    for (const row of usage.models) {
      const pin = row.model === m.model && side === "in" ? value : row.priceIn;
      const pout = row.model === m.model && side === "out" ? value : row.priceOut;
      if (pin === null && pout === null) continue;
      prices[row.model] = { in: pin ?? "0", out: pout ?? "0" };
    }
    save.mutate(prices, { onSettled: () => dropDraft(key) });
  };

  const priceInput = (m: BudgetAiModelUsage, side: Side) => {
    const key = draftKey(m.model, side);
    return (
      <input
        inputMode="decimal"
        aria-label={t(side === "in" ? "settings.server.budgetAiCostPriceInFor" : "settings.server.budgetAiCostPriceOutFor", { model: m.model })}
        value={drafts[key] ?? current(m, side) ?? ""}
        onChange={(e) => setDrafts((d) => ({ ...d, [key]: e.target.value }))}
        onBlur={() => commit(m, side)}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
        }}
        className="w-24 bg-surface-2 rounded-xl px-3 py-1.5 text-fg text-sm text-right tabular-nums outline-none focus:ring-1 focus:ring-green"
      />
    );
  };

  const th = "pb-2 font-medium text-fg-faint";

  return (
    <Surface className="p-6">
      <h2 className="mb-1 text-lg font-semibold text-fg">{t("settings.server.budgetAiCost")}</h2>
      <p className="mb-5 text-xs text-fg-faint">{t("settings.server.budgetAiCostHint")}</p>
      {usage.models.length === 0 ? (
        <p className="text-sm text-fg-faint">{t("settings.server.budgetAiCostEmpty")}</p>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-fg">
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
              <tbody className="divide-y divide-surface-2">
                {usage.models.map((m) => (
                  <tr key={m.model}>
                    <td className="py-2.5 pr-4 align-top">
                      <div className="font-mono">{m.model}</div>
                      {m.runsWithoutUsage > 0 && (
                        <div className="text-xs text-fg-faint">
                          {t("settings.server.budgetAiCostNoUsage", { count: m.runsWithoutUsage })}
                        </div>
                      )}
                    </td>
                    <td className="py-2.5 pl-3 text-right tabular-nums">{m.runs}</td>
                    <td className="py-2.5 pl-3 text-right tabular-nums">{tokens.format(m.tokensIn)}</td>
                    <td className="py-2.5 pl-3 text-right tabular-nums">{tokens.format(m.tokensOut)}</td>
                    <td className="py-1.5 pl-3 text-right">{priceInput(m, "in")}</td>
                    <td className="py-1.5 pl-3 text-right">{priceInput(m, "out")}</td>
                    <td className="py-2.5 pl-3 text-right tabular-nums whitespace-nowrap">
                      {m.cost === null ? (
                        <span className="text-xs text-fg-faint">{t("settings.server.budgetAiCostNoPrice")}</span>
                      ) : (
                        money(m.cost, 4)
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-4 flex items-baseline justify-between border-t border-surface-2 pt-4">
            <span className="text-sm font-medium text-fg">{t("settings.server.budgetAiCostTotal")}</span>
            <span data-testid="ai-cost-total" className="text-xl font-semibold tabular-nums text-fg">
              {money(usage.totalCost, 2)}
            </span>
          </div>
        </>
      )}
    </Surface>
  );
}
