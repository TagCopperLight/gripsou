import { useState, type ReactNode } from "react";
import { Trans, useTranslation } from "react-i18next";
import { ChevronDown } from "lucide-react";

import { Button } from "../../ui/Button";
import { CardState } from "../../ui/CardState";
import { CopyField } from "../../ui/CopyField";
import { Tag } from "../../ui/Tag";
import { StepDots } from "../../ui/StepDots";
import { Toggle } from "../../ui/Toggle";
import { useApiKeys, useProviders, useSetProviderEnabled } from "../../api/admin";
import type { ApiKeyProvider, KeyGroup, Provider } from "../../api/wire";
import { KeyFieldList } from "../settings/server/KeyFields";
import { AiProviderFields } from "../settings/server/AiProviderFields";
import { useSaveKey, type SaveKey } from "../settings/server/useSaveKey";
import { groupState, KEY_GROUPS, KEY_GUIDES, type GroupState } from "./serverSetup";

/** For the first admin, before the welcome steps: the keys of the outside
 *  services, one screen per group of what they enable, each with how to get
 *  them. The same fields as Settings → Server, saved as they are typed, so
 *  going back and forth loses nothing. */
export function ServerSetup({ onContinue }: { onContinue: () => void }) {
  const { t } = useTranslation();
  const keys = useApiKeys();
  const providers = useProviders();
  const saveKey = useSaveKey();
  const [index, setIndex] = useState(0);

  const title = (aside?: ReactNode) => (
    <div className="flex items-center justify-between gap-3 px-1">
      <h1 className="text-xl font-semibold text-fg">{t("welcome.server.title")}</h1>
      {aside}
    </div>
  );
  const intro = <p className="px-1 text-sm leading-relaxed text-fg-dim">{t("welcome.server.intro")}</p>;

  if (!keys.data || !providers.data) {
    return (
      <>
        {title()}
        {intro}
        <CardState
          variant={keys.isError || providers.isError ? "error" : "loading"}
          onRetry={() => {
            void keys.refetch();
            void providers.refetch();
          }}
          className="h-64"
        />
      </>
    );
  }

  const groups = KEY_GROUPS.map((group) => ({
    group,
    members: keys.data.filter((k) => k.group === group),
    state: groupState(group, keys.data, providers.data),
  })).filter((g) => g.members.length > 0);
  const { group, members, state } = groups[index];
  const last = index === groups.length - 1;

  return (
    <>
      {title(<StepDots current={index} total={groups.length} />)}
      {index === 0 && intro}
      <GroupSection key={group} group={group} state={state}>
        {members.map((k) => (
          <ProviderPart key={k.key} provider={k} named={members.length > 1} providers={providers.data} save={saveKey(k.key)} />
        ))}
        {/* A provider is offered only once its key is saved. */}
        {group === "categorize" && state === "ready" && <AiProviderFields />}
      </GroupSection>
      <div className="flex items-center justify-between gap-2 pt-1">
        {index > 0 ? (
          <Button variant="ghost" padded={false} onClick={() => setIndex(index - 1)}>
            {t("common.back")}
          </Button>
        ) : (
          <span />
        )}
        <Button onClick={last ? onContinue : () => setIndex(index + 1)}>
          {state !== "ready" ? t("welcome.server.skip") : last ? t("welcome.continue") : t("common.next")}
        </Button>
      </div>
    </>
  );
}

const TAGS: Record<GroupState, { tone: "green" | "neutral"; label: string }> = {
  ready: { tone: "green", label: "welcome.server.state.ready" },
  notSetUp: { tone: "neutral", label: "welcome.server.state.notSetUp" },
  off: { tone: "neutral", label: "welcome.server.state.off" },
};

function GroupSection({ group, state, children }: { group: KeyGroup; state: GroupState; children: ReactNode }) {
  const { t } = useTranslation();
  const tag = TAGS[state];
  return (
    <section className="flex flex-col gap-4 rounded-2xl bg-surface-2/50 p-4 ring-1 ring-inset ring-surface-3">
      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-[15px] font-semibold text-fg">{t(`welcome.server.${group}.title`)}</h2>
          <Tag tone={tag.tone}>{t(tag.label)}</Tag>
        </div>
        <p className="text-[13px] leading-relaxed text-fg-dim">{t(`welcome.server.${group}.what`)}</p>
      </div>
      {children}
    </section>
  );
}

/** One provider of a section: its on/off switch (bank providers), how to get
 *  its keys, then its fields. */
function ProviderPart({
  provider,
  named,
  providers,
  save,
}: {
  provider: ApiKeyProvider;
  /** Several providers share the section: each says its name. */
  named: boolean;
  providers: Provider[];
  save: SaveKey;
}) {
  const { t } = useTranslation();
  const setEnabled = useSetProviderEnabled();
  const guide = KEY_GUIDES[provider.key];
  const switchable = providers.find((p) => p.key === provider.key && provider.group === "bank");
  const realtime = guide?.realtime;
  const fields = provider.fields.filter((f) => f.key !== realtime?.field);
  const realtimeField = provider.fields.filter((f) => f.key === realtime?.field);

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
        <div className="flex flex-col gap-2">
          <span className="text-xs font-medium text-fg-faint">{t("welcome.server.howTo")}</span>
          <ol className="flex list-decimal flex-col gap-1 pl-5 text-[13px] leading-relaxed text-fg-dim marker:text-fg-faint">
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
      <KeyFieldList fields={fields} save={save} />
      {realtime && realtimeField.length > 0 && (
        <Realtime body={realtime.body} link={realtime.link}>
          <KeyFieldList fields={realtimeField} save={save} />
        </Realtime>
      )}
    </div>
  );
}

/** The optional part of a bank provider, folded until asked for. */
function Realtime({ body, link, children }: { body: string; link: string; children: ReactNode }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return (
    <div className="flex flex-col gap-3">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex cursor-pointer items-center gap-1.5 self-start text-sm font-medium text-fg-dim transition-colors duration-140 hover:text-fg"
      >
        <ChevronDown className={`size-4 transition-transform duration-140 ${open ? "" : "-rotate-90"}`} />
        {t("welcome.server.realtime")}
      </button>
      {open && (
        <>
          <p className="text-[13px] leading-relaxed text-fg-dim">
            <Trans i18nKey={body} components={{ a: <GuideLink href={link} /> }} />
          </p>
          {children}
        </>
      )}
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
