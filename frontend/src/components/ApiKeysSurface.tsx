import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { Trash2 } from "lucide-react";

import { Surface } from "./Surface";
import { CardState } from "./CardState";
import { Button } from "./Button";
import { Field } from "./Field";
import { useErrorToast } from "../lib/errorToasts";
import { useApiKeys, useSetApiKey } from "../api/hooks";
import type { ApiKeyField, ApiKeyProvider } from "../api/types";

const INPUT = "w-full rounded-xl bg-surface-2 px-3.5 py-2 font-mono text-sm text-fg placeholder:text-fg-faint";

type Save = (value: string | null) => void;

/** Settings → Server: the values each provider needs (Powens, the AI, logos).
 *  Each field saves on its own, on Enter or when it loses focus. A saved
 *  secret never comes back from the server, so it shows as dots until it is
 *  replaced or removed. */
export function ApiKeysSurface() {
  const { t } = useTranslation();
  const query = useApiKeys();
  const save = useSetApiKey();
  useErrorToast(save.isError && t("settings.server.apiKeys.saveError"));

  return (
    <Surface className="p-6">
      <h2 className="mb-5 text-lg font-semibold text-fg">{t("settings.server.apiKeys.title")}</h2>
      {!query.data ? (
        <CardState
          variant={query.isError ? "error" : "loading"}
          onRetry={() => void query.refetch()}
          className="h-64"
        />
      ) : (
        <div className="flex flex-col divide-y divide-surface-2">
          {query.data.map((p) => (
            <ProviderKeys
              key={p.key}
              provider={p}
              save={(field, value) => save.mutate({ provider: p.key, field, value })}
            />
          ))}
        </div>
      )}
    </Surface>
  );
}

function ProviderKeys({
  provider,
  save,
}: {
  provider: ApiKeyProvider;
  save: (field: string, value: string | null) => void;
}) {
  const { t } = useTranslation();
  const label = (f: ApiKeyField) => t(`settings.server.apiKeys.fields.${provider.key}.${f.key}`, { defaultValue: f.key });
  const plain = provider.fields.filter((f) => !f.secret);
  const secrets = provider.fields.filter((f) => f.secret);

  return (
    <div className="flex flex-col gap-4 py-5 first:pt-0 last:pb-0">
      <span className="text-sm font-medium text-fg">{provider.displayName}</span>
      {plain.length > 0 && (
        <div className="grid gap-4 md:grid-cols-2">
          {plain.map((f) => (
            <PlainField key={f.key} label={label(f)} value={f.value} save={(v) => save(f.key, v)} />
          ))}
        </div>
      )}
      {secrets.map((f) => (
        <SecretField key={f.key} label={label(f)} isSet={f.set} save={(v) => save(f.key, v)} />
      ))}
      {provider.redirectUri && (
        <Field label={t("settings.server.apiKeys.redirectUri")}>
          <span className="select-all font-mono text-sm text-fg-dim">{provider.redirectUri}</span>
        </Field>
      )}
    </div>
  );
}

/** A value shown as it is: typing edits it, Enter or leaving saves it,
 *  Escape puts the saved one back, emptying it removes it. */
function PlainField({ label, value, save }: { label: string; value: string | null; save: Save }) {
  const id = useId();
  // The draft is tied to the saved value it started from: once a save lands
  // and the value moves, the field shows the server again.
  const [draft, setDraft] = useState<{ base: string | null; text: string } | null>(null);
  const typed = draft && draft.base === value ? draft.text : null;

  const commit = () => {
    if (typed === null) return;
    const next = typed.trim() || null;
    if (next === value) setDraft(null);
    else save(next);
  };

  return (
    <Field label={label} htmlFor={id}>
      <input
        id={id}
        className={INPUT}
        value={typed ?? value ?? ""}
        spellCheck={false}
        autoComplete="off"
        onChange={(e) => setDraft({ base: value, text: e.target.value })}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") {
            setDraft(null);
            // Blurs after the reset lands, so nothing is committed.
            requestAnimationFrame(() => (e.target as HTMLInputElement).blur());
          }
        }}
      />
    </Field>
  );
}

/** A secret: dots once saved, with Replace and a bin. Replacing opens an
 *  empty field; Enter or leaving with something typed saves it, Escape or
 *  leaving it empty keeps the saved one. */
function SecretField({ label, isSet, save }: { label: string; isSet: boolean; save: Save }) {
  const { t } = useTranslation();
  const id = useId();
  const [replacing, setReplacing] = useState(false);
  const [text, setText] = useState("");

  const close = () => {
    setReplacing(false);
    setText("");
  };
  const commit = () => {
    const next = text.trim();
    if (next) save(next);
    close();
  };

  if (isSet && !replacing) {
    return (
      <Field label={label}>
        <div className="flex items-center gap-1">
          <span className={`${INPUT} select-none tracking-widest text-fg-dim`} aria-label={t("settings.server.apiKeys.saved")}>
            ••••••••
          </span>
          <Button variant="ghost" onClick={() => setReplacing(true)}>
            {t("settings.server.apiKeys.replace")}
          </Button>
          <button
            type="button"
            aria-label={t("settings.server.apiKeys.remove", { name: label })}
            onClick={() => save(null)}
            className="cursor-pointer rounded-lg p-1.5 text-fg-dim transition-colors duration-140 hover:bg-surface-3 hover:text-fg"
          >
            <Trash2 className="size-4.5" />
          </button>
        </div>
      </Field>
    );
  }

  return (
    <Field label={label} htmlFor={id}>
      <input
        id={id}
        type="password"
        className={INPUT}
        value={text}
        placeholder={replacing ? undefined : t("settings.server.apiKeys.notSet")}
        autoFocus={replacing}
        autoComplete="new-password"
        spellCheck={false}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") {
            setText("");
            requestAnimationFrame(() => (e.target as HTMLInputElement).blur());
          }
        }}
      />
    </Field>
  );
}
