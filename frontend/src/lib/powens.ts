import type { TFunction } from "i18next";

/** What the SPA knows about Powens, the bank aggregator behind the "powens"
 *  provider: its key and its connection-state codes. Its texts live under the
 *  `powens` i18n key. */
export const POWENS_KEY = "powens";

/** A connection-state code Powens reports (`bug`, `wrongpass`, `SCARequired`…),
 *  in words; a code without its own text is named in a generic one. */
export function powensStateText(t: TFunction, state: string | null | undefined): string {
  return t(`powens.states.${state}`, { defaultValue: t("powens.issue", { state }) });
}
