import type { LucideIcon } from "lucide-react";
import { KeyRound, Landmark } from "lucide-react";
import { POWENS_KEY } from "../../lib/powens";

export type GuidePoint = { icon: LucideIcon; title: string; body: string };

export const PROVIDER_GUIDE: Record<string, GuidePoint[]> = {
  // Powens may ask for bank credentials after the PSD2 consent, to reach accounts PSD2 doesn't cover (often a PEA or life insurance).
  [POWENS_KEY]: [
    { icon: Landmark, title: "powens.guide.psd2.title", body: "powens.guide.psd2.body" },
    { icon: KeyRound, title: "powens.guide.login.title", body: "powens.guide.login.body" },
  ],
};
