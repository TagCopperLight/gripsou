import type { TFunction } from "i18next";
import type { LucideIcon } from "lucide-react";
import { KeyRound, Landmark } from "lucide-react";

/** What the SPA knows about Powens, the bank aggregator behind the "powens"
 *  provider: its part of the connection guide, its connection-state codes, and
 *  its manage page. Its texts live under the `powens` i18n key. */
export const POWENS_KEY = "powens";

/** One point of a provider's own part of the connection guide: an icon, and
 *  the i18n keys of its title and body. */
export type GuidePoint = { icon: LucideIcon; title: string; body: string };

/** Powens may ask for bank credentials after the PSD2 consent, to reach
 *  accounts PSD2 doesn't cover (often a PEA or life insurance). */
export const POWENS_GUIDE: GuidePoint[] = [
  { icon: Landmark, title: "powens.guide.psd2.title", body: "powens.guide.psd2.body" },
  { icon: KeyRound, title: "powens.guide.login.title", body: "powens.guide.login.body" },
];

/** A connection-state code Powens reports (`bug`, `wrongpass`, `SCARequired`…),
 *  in words; a code without its own text is named in a generic one. */
export function powensStateText(t: TFunction, state: string | null | undefined): string {
  return t(`powens.states.${state}`, { defaultValue: t("powens.issue", { state }) });
}

export const POWENS_MANAGE_BLOCKED = "powens.manageBlocked";
export const POWENS_MANAGE_FAILED = "powens.manageFailed";
