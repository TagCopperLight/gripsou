import type { ApiKeyProvider, KeyGroup, Provider } from "../../api/wire";
import { POWENS_KEY } from "../../lib/powens";

/** The server setup's sections, in the order they are shown. */
export const KEY_GROUPS: readonly KeyGroup[] = ["bank", "categorize", "logos"];

/** A section's chip: some provider in it works, none is set up, or every
 *  bank provider is turned off. */
export type GroupState = "ready" | "notSetUp" | "off";

/** Only bank providers can be turned off (Settings → Server → Data providers). */
function turnedOn(key: ApiKeyProvider, providers: Provider[]): boolean {
  return key.group !== "bank" || providers.some((p) => p.key === key.key && p.enabled);
}

export function groupState(group: KeyGroup, keys: ApiKeyProvider[], providers: Provider[]): GroupState {
  const members = keys.filter((k) => k.group === group);
  if (members.some((k) => k.ready && turnedOn(k, providers))) return "ready";
  return members.every((k) => !turnedOn(k, providers)) ? "off" : "notSetUp";
}

/** How to get a provider's keys, by provider key: the i18n keys of its steps
 *  (an `<a>` in a step goes to `link`), and the field that only real-time
 *  sync needs, folded away under its own guide. A provider without an entry
 *  just shows its fields. */
export type KeyGuide = {
  steps: string[];
  link?: string;
  realtime?: { field: string; body: string; link: string };
};

export const KEY_GUIDES: Record<string, KeyGuide> = {
  [POWENS_KEY]: {
    steps: ["welcome.server.guide.powens.app", "welcome.server.guide.powens.keys", "welcome.server.guide.powens.address"],
    // Its steps include a call to Powens' API: they stay in one place.
    realtime: {
      field: "webhook_secret",
      body: "welcome.server.guide.powens.realtime",
      link: "https://github.com/TagCopperLight/gripsou#powens-webhooks-optional",
    },
  },
  jev: {
    steps: ["welcome.server.guide.jev.account", "welcome.server.guide.jev.paste"],
    link: "https://console.typesafe.ai/keys",
  },
  brandfetch: {
    steps: ["welcome.server.guide.brandfetch.account", "welcome.server.guide.brandfetch.paste"],
    link: "https://developers.brandfetch.com/register",
  },
};
