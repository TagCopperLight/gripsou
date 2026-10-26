import type { LucideIcon } from "lucide-react";
import { KeyRound, Landmark } from "lucide-react";

/** One point of a provider's own part of the connection guide: an icon, and
 *  the i18n keys of its title and body. */
export type GuidePoint = { icon: LucideIcon; title: string; body: string };

/** What each provider adds after the general "read-only" point, by provider
 *  key. A provider without an entry gets the general point only. */
export const PROVIDER_GUIDE: Record<string, GuidePoint[]> = {
  powens: [
    { icon: Landmark, title: "connectionGuide.powens.psd2.title", body: "connectionGuide.powens.psd2.body" },
    { icon: KeyRound, title: "connectionGuide.powens.login.title", body: "connectionGuide.powens.login.body" },
  ],
};
