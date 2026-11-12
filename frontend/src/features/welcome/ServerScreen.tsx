import type { ReactNode } from "react";
import { Trans, useTranslation } from "react-i18next";

import { CopyField } from "../../ui/CopyField";
import { Tag } from "../../ui/Tag";
import { Toggle } from "../../ui/Toggle";
import { useSetProviderEnabled } from "../../api/admin";
import type { ApiKeyProvider, KeyGroup, Provider } from "../../api/wire";
import { KeyFieldList } from "../settings/server/KeyFields";
import { AiProviderFields } from "../settings/server/AiProviderFields";
import { useSaveKey } from "../settings/server/useSaveKey";
import { groupState, KEY_GUIDES, realtimeField, type GroupState, type ServerPart } from "./serverSetup";

/** One screen of a group of the server's keys (what they enable): how to get
 *  them and their fields, or real-time sync. The same fields as Settings →
 *  Server, saved as they are typed, so going back and forth loses nothing. */
export function ServerScreen({
  group,
  part,
  keys,
  providers,
}: {
  group: KeyGroup;
  part: ServerPart;
  keys: ApiKeyProvider[];
  providers: Provider[];
}) {
  const { t } = useTranslation();
  const members = keys.filter((k) => k.group === group);
  if (part === "realtime") {
    return members.map((k) => <ProviderRealtime key={k.key} provider={k} />);
  }
  // Several providers in a group: each says its name.
  const named = members.length > 1;
  return (
    <>
      <p className="text-sm leading-relaxed text-fg-dim">{t(`welcome.server.${group}.what`)}</p>
      {members.map((k) => <ProviderKeys key={k.key} provider={k} named={named} providers={providers} />)}
      {/* A provider is offered only once its key is saved. */}
      {group === "categorize" && groupState(group, keys, providers) === "ready" && <AiProviderFields />}
    </>
  );
}

const TAGS: Record<GroupState, { tone: "green" | "neutral"; label: string }> = {
  ready: { tone: "green", label: "welcome.server.state.ready" },
  notSetUp: { tone: "neutral", label: "welcome.server.state.notSetUp" },
  off: { tone: "neutral", label: "welcome.server.state.off" },
};

/** Whether a group's keys work, beside its title. */
export function ServerTag({ state }: { state: GroupState }) {
  const { t } = useTranslation();
  return <Tag tone={TAGS[state].tone}>{t(TAGS[state].label)}</Tag>;
}

/** A provider's on/off switch (bank providers), how to get its keys, and
 *  its fields. */
function ProviderKeys({ provider, named, providers }: { provider: ApiKeyProvider; named: boolean; providers: Provider[] }) {
  const { t } = useTranslation();
  const setEnabled = useSetProviderEnabled();
  const save = useSaveKey()(provider.key);
  const guide = KEY_GUIDES[provider.key];
  const switchable = providers.find((p) => p.key === provider.key && provider.group === "bank");
  const realtime = realtimeField(provider);
  return (
    <div className="flex flex-col gap-4">
      {named && <span className="text-sm font-medium text-fg">{provider.displayName}</span>}
      {switchable && (
        <div className="flex items-center justify-between gap-4 rounded-xl bg-surface-2 px-4 py-3">
          <span className="text-sm font-medium text-fg">{t("welcome.server.useProvider", { name: provider.displayName })}</span>
          <Toggle
            aria-label={t("welcome.server.useProvider", { name: provider.displayName })}
            checked={switchable.enabled}
            disabled={setEnabled.isPending}
            offClassName="bg-surface-3"
            onChange={(enabled) => setEnabled.mutate({ key: provider.key, enabled })}
          />
        </div>
      )}
      {guide && (
        <div className="flex flex-col gap-3">
          <ol className="flex list-decimal flex-col gap-1.5 pl-5 text-sm leading-relaxed text-fg-dim marker:text-fg-faint">
            {guide.steps.map((step) => (
              <li key={step}>
                <Trans i18nKey={step} components={{ a: <GuideLink href={guide.link} /> }} />
              </li>
            ))}
          </ol>
          {provider.returnAddress && (
            <CopyField value={provider.returnAddress} label={t("welcome.server.copyAddress")} />
          )}
        </div>
      )}
      <KeyFieldList fields={provider.fields.filter((f) => f !== realtime)} save={save} />
    </div>
  );
}

/** A provider's real-time sync: what it does, and its field. */
function ProviderRealtime({ provider }: { provider: ApiKeyProvider }) {
  const save = useSaveKey()(provider.key);
  const guide = KEY_GUIDES[provider.key]?.realtime;
  const field = realtimeField(provider);
  if (!guide || !field) return null;
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm leading-relaxed text-fg-dim">
        <Trans i18nKey={guide.body} components={{ a: <GuideLink href={guide.link} /> }} />
      </p>
      <KeyFieldList fields={[field]} save={save} />
    </div>
  );
}

function GuideLink({ href, children }: { href?: string; children?: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className="font-medium text-green transition-colors duration-140 hover:text-green-light">
      {children}
    </a>
  );
}
