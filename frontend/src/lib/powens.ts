import type { TFunction } from "i18next";

export const POWENS_KEY = "powens";

export function powensStateText(t: TFunction, state: string | null | undefined): string {
  return t(`powens.states.${state}`, { defaultValue: t("powens.issue", { state }) });
}
