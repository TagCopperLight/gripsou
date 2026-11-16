import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { Trash2 } from "lucide-react";

import { Button } from "../../../ui/Button";
import { Field } from "../../../ui/Field";
import { TextInput } from "../../../ui/TextInput";
import { showDone } from "../../../lib/errorToasts";
import type { ApiKeyField } from "../../../api/wire";
import type { SaveKey } from "./useSaveKey";

// A text field drawn as dots, not a password field: password managers offer to save anything typed in one and draw its placeholder in another font.
const MASKED = "[-webkit-text-security:disc] text-base tracking-[0.2em]";
// Asks the usual password managers to leave a field alone.
const NO_PASSWORD_MANAGER = {
  autoComplete: "off",
  "data-1p-ignore": "",
  "data-lpignore": "true",
  "data-bwignore": "",
  "data-form-type": "other",
};

type Save = (value: string | null, onSaved?: () => void) => Promise<void>;

export function KeyFieldList({ fields, save }: { fields: ApiKeyField[]; save: SaveKey }) {
  const plain = fields.filter((f) => !f.secret);
  const secrets = fields.filter((f) => f.secret);
  return (
    <>
      {plain.length > 0 && (
        <div className={`grid gap-4 ${plain.length > 1 ? "md:grid-cols-2" : ""}`}>
          {plain.map((f) => (
            <PlainField key={f.key} label={f.label} value={f.value} save={(v, done) => save(f.key, v, done)} />
          ))}
        </div>
      )}
      {secrets.map((f) => (
        <SecretField key={f.key} label={f.label} isSet={f.set} save={(v, done) => save(f.key, v, done)} />
      ))}
    </>
  );
}

function PlainField({ label, value, save }: { label: string; value: string | null; save: Save }) {
  const id = useId();
  // Draft tied to the saved value it started from: once a save moves the value, the field shows the server again.
  const [draft, setDraft] = useState<{ base: string | null; text: string } | null>(null);
  const typed = draft && draft.base === value ? draft.text : null;

  const commit = () => {
    if (typed === null) return;
    const next = typed.trim() || null;
    if (next === value) setDraft(null);
    else void save(next);
  };

  return (
    <Field label={label} htmlFor={id}>
      <TextInput
        id={id}
        value={typed ?? value ?? ""}
        spellCheck={false}
        {...NO_PASSWORD_MANAGER}
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

function SecretField({ label, isSet, save }: { label: string; isSet: boolean; save: Save }) {
  const { t } = useTranslation();
  const id = useId();
  const [replacing, setReplacing] = useState(false);
  const [text, setText] = useState("");
  // Two fields' saves share one mutation, so its `isPending` can't tell their buttons apart.
  const [running, setRunning] = useState<"save" | "remove" | null>(null);
  const run = (kind: "save" | "remove", value: string | null, onSaved: () => void) => {
    setRunning(kind);
    void save(value, onSaved).finally(() => setRunning(null));
  };

  const close = () => {
    setReplacing(false);
    setText("");
  };
  const submit = () => {
    const next = text.trim();
    if (!next || running) return;
    run("save", next, () => {
      showDone(t("settings.server.apiKeys.savedToast"));
      close();
    });
  };
  const remove = () => run("remove", null, () => showDone(t("settings.server.apiKeys.removedToast")));

  if (isSet && !replacing) {
    return (
      // Keyed apart from the editing field: React would reuse its input for the dots and focus would stay on it.
      <Field key="saved" label={label}>
        <div className="flex items-center gap-1">
          <TextInput
            readOnly
            tabIndex={-1}
            value="saved-key"
            aria-label={`${label}: ${t("settings.server.apiKeys.saved")}`}
            {...NO_PASSWORD_MANAGER}
            className={`pointer-events-none select-none text-fg-dim ${MASKED}`}
          />
          <Button variant="ghost" onClick={() => setReplacing(true)}>
            {t("settings.server.apiKeys.replace")}
          </Button>
          <button
            type="button"
            aria-label={t("settings.server.apiKeys.remove", { name: label })}
            onClick={remove}
            disabled={running === "remove"}
            className="cursor-pointer rounded-lg p-1.5 text-fg-dim transition-colors duration-140 enabled:hover:bg-surface-3 enabled:hover:text-red"
          >
            <Trash2 className="size-4.5" />
          </button>
        </div>
      </Field>
    );
  }

  return (
    <Field key="editing" label={label} htmlFor={id}>
      <div className="relative">
        <TextInput
          id={id}
          value={text}
          placeholder={replacing ? undefined : t("settings.server.apiKeys.notSet")}
          autoFocus={replacing}
          {...NO_PASSWORD_MANAGER}
          spellCheck={false}
          // Dots only once something is typed, so the placeholder reads.
          className={`pr-20 ${text ? MASKED : ""}`}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.currentTarget.blur();
              submit();
            }
            if (e.key === "Escape") close();
          }}
        />
        {(replacing || text) && (
          <Button
            variant="ghostStrong"
            padded={false}
            disabled={!text.trim()}
            busy={running === "save"}
            busyLabel={t("common.busy.saving")}
            onClick={submit}
            className="absolute top-1/2 right-1.5 -translate-y-1/2 rounded-lg! bg-surface-3 px-2.5 py-1 text-xs"
          >
            {t("common.save")}
          </Button>
        )}
      </div>
    </Field>
  );
}
