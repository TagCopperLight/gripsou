import { useEffect, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useSearch } from "@tanstack/react-router";
import { Check, Landmark, Lock } from "lucide-react";
import { Button } from "../components/Button";
import { Select } from "../components/Select";
import { SegmentedControl } from "../components/SegmentedControl";
import { Toggle } from "../components/Toggle";
import { AddConnectionModal } from "../components/AddConnectionModal";
import { useAuth } from "../auth/context";
import { postJson } from "../api/client";
import { useConnections, useEnabledProviders, useInitConnection } from "../api/hooks";
import { useAiStatus } from "../api/budget";
import { flattenConnections, type SyncConnection } from "../api/types";
import { CURRENCIES } from "../lib/currency";
import { TIME_ZONES } from "../lib/timeZoneList";
import { goTo } from "../lib/navigate";
import { prefillFromBrowser } from "../lib/welcome";

type Step = 1 | 2 | 3;

/** After an invite: preferences, a first bank, the AI opt-in. Shown until the
 *  user finishes or skips it (`welcomeDone`); the router sends them here. */
export function Welcome() {
  const { t } = useTranslation();
  const { user, prefs, updatePrefs, updateUser } = useAuth();
  const search = useSearch({ strict: false }) as { step?: "bank" };
  const backFromBank = search.step === "bank";

  // A failed save is rolled back by AuthProvider; like Settings > General, the
  // user can simply try again, so the rejection is swallowed.
  const save = (next: typeof prefs) => {
    updatePrefs(next).catch(() => {});
  };

  const connections = flattenConnections(useConnections().data);
  const providers = useEnabledProviders().data;
  const aiStatus = useAiStatus();
  const aiConfigured = aiStatus.data?.configured ?? false;
  // Until the status is known (or failed), whether step 3 exists is undecided.
  const aiKnown = aiStatus.data !== undefined || aiStatus.isError;
  const initConnection = useInitConnection();

  const [step, setStep] = useState<Step>(backFromBank ? 2 : 1);
  const [done, setDone] = useState<Record<Step, boolean>>({ 1: backFromBank, 2: false, 3: false });
  const [bankSkipped, setBankSkipped] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [finishError, setFinishError] = useState(false);

  // Fill language and time zone from the browser once, when step 1 is the
  // starting point (not when coming back from the bank's page).
  const prefilled = useRef(false);
  useEffect(() => {
    if (prefilled.current || backFromBank) return;
    prefilled.current = true;
    const filled = prefillFromBrowser(prefs);
    if (filled.uiLanguage !== prefs.uiLanguage || filled.timeZone !== prefs.timeZone) {
      // The user can still set these in step 1 / Settings; AuthProvider rolls back.
      updatePrefs(filled).catch(() => {});
    }
  }, [backFromBank, prefs, updatePrefs]);

  const complete = (n: Step, next: Step) => {
    setDone((d) => ({ ...d, [n]: true }));
    setStep(next);
  };

  const finish = async () => {
    if (!user || finishing) return;
    setFinishing(true);
    setFinishError(false);
    try {
      await postJson<void>("/auth/welcome", {});
      // The router guard re-runs on this change and leaves /welcome.
      updateUser({ ...user, welcomeDone: true });
    } catch {
      setFinishError(true);
    } finally {
      setFinishing(false);
    }
  };

  const connectBank = () => {
    if (providers?.length === 1) {
      initConnection.mutate(providers[0].key, {
        onSuccess: ({ redirectUrl }) => {
          goTo(redirectUrl ?? "/welcome?step=bank");
        },
      });
    } else {
      setPickerOpen(true);
    }
  };

  const skipBank = () => {
    setBankSkipped(true);
    if (aiConfigured) complete(2, 3);
    else void finish();
  };

  const currencyLabel = CURRENCIES.find((c) => c.code === prefs.currency)?.label ?? prefs.currency;
  const hasBank = connections.length > 0;

  return (
    <div className="flex min-h-screen justify-center bg-bg px-4 py-16">
      <div className="flex w-120 max-w-full flex-col items-center gap-10">
        <div className="font-wordmark text-[56px] font-semibold tracking-tight text-fg">gripsou</div>
        <div className="flex w-full flex-col gap-5 rounded-3xl bg-surface p-4 md:p-6">
          <h1 className="px-1 text-xl font-semibold text-fg">{t("welcome.title", { name: user?.name ?? "" })}</h1>
          <div className="flex gap-3 rounded-2xl bg-blue-soft px-4 py-3 text-[13px] leading-relaxed text-blue-light">
            <Lock className="mt-0.5 size-4 shrink-0" />
            <p>{t("welcome.privacy")}</p>
          </div>

          <div className="flex flex-col gap-1">
            <WelcomeStep
              n={1}
              title={t("welcome.prefs.title")}
              active={step === 1}
              done={done[1]}
              summary={`${prefs.uiLanguage === "fr" ? "Français" : "English"} · ${currencyLabel} · ${prefs.timeZone}`}
              onEdit={() => setStep(1)}
            >
              <div className="flex items-center justify-between gap-4">
                <span className="text-sm text-fg-dim">{t("welcome.prefs.language")}</span>
                <SegmentedControl
                  value={prefs.uiLanguage}
                  onChange={(lng) => save({ ...prefs, uiLanguage: lng as typeof prefs.uiLanguage })}
                  options={[
                    { value: "en", label: "English" },
                    { value: "fr", label: "Français" },
                  ]}
                />
              </div>
              <div className="flex flex-col gap-2">
                <span className="text-sm text-fg-dim">{t("welcome.prefs.currency")}</span>
                <Select
                  value={prefs.currency}
                  onChange={(currency) => save({ ...prefs, currency })}
                  options={CURRENCIES.map((c) => ({ value: c.code, label: c.label }))}
                />
              </div>
              <label className="flex flex-col gap-2">
                <span className="text-sm text-fg-dim">{t("welcome.prefs.timeZone")}</span>
                <select
                  value={prefs.timeZone}
                  onChange={(e) => save({ ...prefs, timeZone: e.target.value })}
                  className="w-full rounded-xl bg-surface-2 px-3.5 py-2.25 text-sm text-fg"
                >
                  {[...new Set([...TIME_ZONES, prefs.timeZone])].map((zone) => (
                    <option key={zone} value={zone}>{zone}</option>
                  ))}
                </select>
              </label>
              <div className="flex justify-end pt-1">
                <Button onClick={() => complete(1, 2)}>{t("welcome.continue")}</Button>
              </div>
            </WelcomeStep>

            <WelcomeStep
              n={2}
              title={t("welcome.bank.title")}
              active={step === 2}
              done={done[2]}
              summary={bankSkipped ? t("welcome.bank.skipped") : t("welcome.bank.connected", { count: connections.length })}
              onEdit={() => setStep(2)}
            >
              <p className="text-sm text-fg-dim">{t("welcome.bank.body")}</p>
              {hasBank && (
                <div className="flex flex-col gap-2">
                  {connections.map((c) => <BankRow key={c.id} connection={c} />)}
                </div>
              )}
              {initConnection.isError && <p className="text-sm text-red">{t("welcome.bank.connectError")}</p>}
              <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                {hasBank ? (
                  <Button variant="ghostStrong" padded={false} onClick={connectBank} disabled={initConnection.isPending || providers === undefined}>
                    {t("welcome.bank.addAnother")}
                  </Button>
                ) : (
                  <Button variant="ghost" padded={false} onClick={skipBank} disabled={!aiKnown}>
                    {t("welcome.bank.skip")}
                  </Button>
                )}
                {hasBank ? (
                  aiConfigured ? (
                    <Button onClick={() => complete(2, 3)} disabled={!aiKnown}>{t("welcome.continue")}</Button>
                  ) : (
                    <Button onClick={() => void finish()} disabled={finishing || !aiKnown}>{t("welcome.finish")}</Button>
                  )
                ) : (
                  <Button onClick={connectBank} disabled={initConnection.isPending || providers === undefined}>{t("welcome.bank.connect")}</Button>
                )}
              </div>
            </WelcomeStep>

            {aiConfigured && (
              <WelcomeStep
                n={3}
                title={t("welcome.ai.title")}
                active={step === 3}
                done={done[3]}
                summary={prefs.budgetAiEnabled ? t("welcome.ai.on") : t("welcome.ai.off")}
                onEdit={() => setStep(3)}
              >
                <div className="flex items-center justify-between gap-4 rounded-xl bg-surface-2 px-4 py-3">
                  <span className="text-sm font-medium text-fg">{t("welcome.ai.toggle")}</span>
                  <Toggle
                    checked={prefs.budgetAiEnabled}
                    onChange={(on) => save({ ...prefs, budgetAiEnabled: on })}
                    aria-label={t("welcome.ai.toggle")}
                  />
                </div>
                <div className="flex flex-col gap-2 text-sm text-fg-dim">
                  <p>{t("welcome.ai.body")}</p>
                  <p>{t("welcome.ai.suggestions")}</p>
                  <p className="text-xs text-fg-faint">{t("welcome.ai.later")}</p>
                </div>
                <div className="flex justify-end pt-1">
                  <Button onClick={() => void finish()} disabled={finishing}>{t("welcome.finish")}</Button>
                </div>
              </WelcomeStep>
            )}
          </div>
        </div>
        {finishError && <p className="-mt-4 text-sm text-red">{t("welcome.finishError")}</p>}
        <button
          type="button"
          onClick={() => void finish()}
          className="-mt-4 cursor-pointer text-sm text-fg-faint transition-colors duration-140 hover:text-fg-dim"
        >
          {t("welcome.skipAll")}
        </button>
      </div>
      {pickerOpen && <AddConnectionModal onClose={() => setPickerOpen(false)} returnTo="/welcome?step=bank" />}
    </div>
  );
}

function WelcomeStep({
  n, title, active, done, summary, onEdit, children,
}: {
  n: Step;
  title: string;
  active: boolean;
  done: boolean;
  summary: string;
  onEdit: () => void;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <section className={`rounded-2xl ${active ? "bg-surface-2/50 ring-1 ring-surface-3" : ""}`}>
      <div className="flex items-center gap-3 px-4 py-3.5">
        {done && !active ? (
          <span className="flex size-7 items-center justify-center rounded-full bg-green-soft text-green">
            <Check className="size-3.5" strokeWidth={3} />
          </span>
        ) : (
          <span
            className={`flex size-7 items-center justify-center rounded-full font-mono text-[13px] font-semibold ${
              active ? "bg-green text-black" : "bg-surface-2 text-fg-faint"
            }`}
          >
            {n}
          </span>
        )}
        <div className="flex min-w-0 flex-1 flex-col">
          <h2 className={`text-[15px] font-semibold ${active || done ? "text-fg" : "text-fg-faint"}`}>{title}</h2>
          {done && !active && <span className="truncate text-xs text-fg-faint">{summary}</span>}
        </div>
        {done && !active && (
          <Button variant="ghost" padded={false} className="px-2 py-1" onClick={onEdit}>
            {t("welcome.edit")}
          </Button>
        )}
      </div>
      {active && <div className="flex flex-col gap-4 px-4 pb-4 pl-14">{children}</div>}
    </section>
  );
}

function BankRow({ connection }: { connection: SyncConnection }) {
  const { t } = useTranslation();
  const state = connection.status === "ok" ? "ok" : connection.status === "error" ? "error" : "syncing";
  const tone = { ok: "text-green", error: "text-red", syncing: "text-amber" }[state];
  return (
    <div className="flex items-center gap-3 rounded-xl bg-surface-2 px-3.5 py-2.5">
      <Landmark className="size-4 text-fg-faint" />
      <span className="flex-1 truncate text-sm text-fg">{connection.displayName}</span>
      <span className={`flex items-center gap-1.5 text-xs ${tone}`}>
        {state === "ok" ? <Check className="size-3" /> : <span className="size-1.5 rounded-full bg-current" />}
        {t(`welcome.bank.status.${state}`)}
      </span>
    </div>
  );
}
