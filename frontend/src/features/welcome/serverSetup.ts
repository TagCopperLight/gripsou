import type { ApiKeyProvider, KeyGroup, Provider } from "../../api/wire";
import { POWENS_KEY } from "../../lib/powens";

/** The server setup's sections, in the order they are shown. */
const KEY_GROUPS: readonly KeyGroup[] = ["bank", "categorize", "logos"];

/** A group's screens: its keys, then real-time sync when one of its
 *  providers offers it (a webhook, too long to sit beside the keys). */
export type ServerPart = "keys" | "realtime";

export function serverParts(group: KeyGroup, keys: ApiKeyProvider[]): ServerPart[] {
  const realtime = keys.some((k) => k.group === group && realtimeField(k) !== undefined);
  return realtime ? ["keys", "realtime"] : ["keys"];
}

/** Whether a group's real-time sync field is filled in. */
export function realtimeSet(group: KeyGroup, keys: ApiKeyProvider[]): boolean {
  return keys.some((k) => {
    const f = k.group === group ? realtimeField(k) : undefined;
    return f !== undefined && (f.secret ? f.set : f.value !== null);
  });
}

/** The provider's field that only real-time sync needs, if it has one. */
export function realtimeField(provider: ApiKeyProvider) {
  const field = KEY_GUIDES[provider.key]?.realtime?.field;
  return provider.fields.find((f) => f.key === field);
}

/** The groups that have a provider. */
export function serverGroups(keys: ApiKeyProvider[]): KeyGroup[] {
  return KEY_GROUPS.filter((group) => keys.some((k) => k.group === group));
}

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
 *  sync needs, on its own screen. A provider without an entry just shows its
 *  fields. */
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
