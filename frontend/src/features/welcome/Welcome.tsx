import { useEffect, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useErrorToast } from "../../lib/errorToasts";
import { getRouteApi } from "@tanstack/react-router";
import { Lock } from "lucide-react";
import { Button } from "../../ui/Button";
import { CardState } from "../../ui/CardState";
import { Select } from "../../ui/Select";
import { SegmentedControl } from "../../ui/SegmentedControl";
import { StepDots } from "../../ui/StepDots";
import { Toggle } from "../../ui/Toggle";
import { useAuth } from "../../auth/context";
import { useCurrencyChange } from "../../auth/useCurrencyChange";
import { CurrencyChangeHint } from "../../auth/CurrencyChangeHint";
import { authApi } from "../../api/auth";
import { useApiKeys, useProviders } from "../../api/admin";
import { useAiStatus } from "../../api/budget";
import type { ApiKeyProvider, KeyGroup, Provider } from "../../api/wire";
import { CURRENCIES } from "../../lib/currency";
import { timeZoneOptions } from "../../lib/timeZoneList";
import { prefillFromBrowser } from "../../lib/welcome";
import type { PrefsPatch } from "../../lib/prefsPatch";
import { ServerScreen, ServerTag } from "./ServerScreen";
import { SecurityScreen } from "./SecurityScreen";
import { BankScreen } from "./BankScreen";
import { WelcomeFooter, WelcomeSkip } from "./WelcomeFooter";
import { groupState, realtimeSet, serverGroups, serverParts, type ServerPart } from "./serverSetup";

/** The flow's parts, one step dot each: a part can take several screens. */
type Section = "profile" | "security" | "server" | "bank" | "ai";

type Screen = { section: "server"; group: KeyGroup; part: ServerPart } | { section: Exclude<Section, "server"> };

/** The server's keys, for an admin's server screens. */
type Server = { keys: ApiKeyProvider[]; providers: Provider[] };

/** After an invite or the first admin's setup: one screen at a time, shown
 *  until the user finishes or skips it (`welcomeDone`); the router sends them
 *  here. An admin (in practice the first account) also sets up the server's
 *  keys, before their own bank. */
export function Welcome() {
  const { user } = useAuth();
  return user?.role === "admin" ? <AdminWelcome /> : <WelcomeFlow server={null} />;
}

function AdminWelcome() {
  const keys = useApiKeys();
  const providers = useProviders();
  if (keys.data && providers.data) return <WelcomeFlow server={{ keys: keys.data, providers: providers.data }} />;
  return (
    <WelcomeShell>
      <CardState
        variant={keys.isError || providers.isError ? "error" : "loading"}
        onRetry={() => {
          void keys.refetch();
          void providers.refetch();
        }}
        className="h-64"
      />
    </WelcomeShell>
  );
}

function WelcomeShell({ children, below }: { children: ReactNode; below?: ReactNode }) {
  return (
    <div className="flex min-h-screen justify-center bg-bg px-4 py-16">
      <div className="flex w-140 max-w-full flex-col items-center gap-6 md:gap-10">
        <div className="font-wordmark text-[40px] font-semibold tracking-tight text-fg md:text-[56px]">gripsou</div>
        <div className="flex w-full flex-col gap-5 rounded-3xl bg-surface p-4 md:p-6">{children}</div>
        {below}
      </div>
    </div>
  );
}

const route = getRouteApi("/signedIn/welcome");

function WelcomeFlow({ server }: { server: Server | null }) {
  const { t } = useTranslation();
  const { user, updateUser } = useAuth();
  const search = route.useSearch();
  const aiStatus = useAiStatus();
  usePrefillFromBrowser(search.step !== "bank");
  // Until the status is known (or failed), whether the AI screen exists is undecided.
  const aiKnown = aiStatus.data !== undefined || aiStatus.isError;

  const screens: Screen[] = [
    { section: "profile" },
    { section: "security" },
    ...(server
      ? serverGroups(server.keys).flatMap((group) =>
          serverParts(group, server.keys).map((part) => ({ section: "server" as const, group, part })),
        )
      : []),
    { section: "bank" },
    ...(aiStatus.data?.configured ? [{ section: "ai" as const }] : []),
  ];
  const bankIndex = screens.findIndex((s) => s.section === "bank");
  const [index, setIndex] = useState(search.step === "bank" ? bankIndex : 0);
  const screen = screens[index];
  const back = () => setIndex(index - 1);
  const next = () => setIndex(index + 1);

  const [finishing, setFinishing] = useState(false);
  const [finishError, setFinishError] = useState(false);
  useErrorToast(finishError && t("welcome.finishError"));
  const finish = async () => {
    if (!user || finishing) return;
    setFinishing(true);
    setFinishError(false);
    try {
      await authApi.finishWelcome();
      // The router guard re-runs on this change and leaves /welcome.
      updateUser({ ...user, welcomeDone: true });
    } catch {
      setFinishError(true);
    } finally {
      setFinishing(false);
    }
  };
  const last = index === screens.length - 1;
  // Past the bank, the flow either finishes or goes on to the AI screen.
  const afterBank = !aiKnown || finishing ? undefined : last ? () => void finish() : next;

  let title;
  let tag;
  let body;
  if (screen.section === "server" && server) {
    const { group, part } = screen;
    const state = groupState(group, server.keys, server.providers);
    // Past this group's screens.
    const skipGroup = () => {
      const after = screens.findIndex((s, i) => i > index && !(s.section === "server" && s.group === group));
      setIndex(after);
    };
    if (part === "keys") {
      title = t(`welcome.server.${group}.title`);
      tag = <ServerTag state={state} />;
    } else {
      title = t("welcome.server.realtime");
    }
    body = (
      <>
        <ServerScreen group={group} part={part} keys={server.keys} providers={server.providers} />
        <WelcomeFooter onBack={back}>
          {part === "keys" ? (
            <>
              {state === "notSetUp" && (
                <WelcomeSkip onClick={skipGroup} />
              )}
              {/* A bank provider turned off has nothing more to set up. */}
              <Button onClick={state === "off" ? skipGroup : next} disabled={state === "notSetUp"}>
                {t("common.next")}
              </Button>
            </>
          ) : (
            <>
              {!realtimeSet(group, server.keys) && (
                <WelcomeSkip onClick={next} />
              )}
              <Button onClick={next} disabled={!realtimeSet(group, server.keys)}>{t("common.next")}</Button>
            </>
          )}
        </WelcomeFooter>
      </>
    );
  } else if (screen.section === "profile") {
    title = t("welcome.title", { name: user?.name ?? "" });
    body = <PrefsScreen onNext={next} />;
  } else if (screen.section === "security") {
    title = t("welcome.twoFactor.title");
    body = <SecurityScreen confirmSkip={server !== null} onBack={back} onNext={next} />;
  } else if (screen.section === "bank") {
    title = t("welcome.bank.title");
    body = (
      <BankScreen
        keysMissing={server !== null && groupState("bank", server.keys, server.providers) !== "ready"}
        last={last}
        onBack={back}
        onNext={afterBank}
        onSetUpKeys={() => setIndex(screens.findIndex((s) => s.section === "server" && s.group === "bank"))}
      />
    );
  } else {
    title = t("welcome.ai.title");
    body = <AiScreen onBack={back} onFinish={() => void finish()} finishing={finishing} />;
  }

  const sections = [...new Set(screens.map((s) => s.section))];
  return (
    <WelcomeShell
      below={
        // An admin goes through every step: they are the one setting the server up.
        server === null && (
          <button
            type="button"
            onClick={() => void finish()}
            className="-mt-4 cursor-pointer text-sm text-fg-faint transition-colors duration-140 hover:text-fg-dim"
          >
            {t("welcome.skipAll")}
          </button>
        )
      }
    >
      <div className="flex flex-col gap-3">
        <StepDots current={sections.indexOf(screen.section)} total={sections.length} />
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-xl font-semibold text-fg">{title}</h1>
          {tag}
        </div>
      </div>
      {body}
    </WelcomeShell>
  );
}

/** A failed save is rolled back by AuthProvider (the control shows the old
 *  value again), and the user can retry here or later in Settings, so the
 *  rejection is swallowed. */
function useSavePrefs() {
  const { updatePrefs } = useAuth();
  return (patch: PrefsPatch) => {
    updatePrefs(patch).catch(() => {});
  };
}

/** Fills language and time zone from the browser once, when the flow starts
 *  (not when coming back from the bank's page): a value the user picks
 *  afterwards stays, even back on the profile screen. */
function usePrefillFromBrowser(starting: boolean) {
  const { prefs } = useAuth();
  const save = useSavePrefs();
  const prefilled = useRef(false);
  useEffect(() => {
    if (prefilled.current || !starting) return;
    prefilled.current = true;
    const filled = prefillFromBrowser(prefs);
    if (filled.uiLanguage !== prefs.uiLanguage || filled.timeZone !== prefs.timeZone) {
      save({ uiLanguage: filled.uiLanguage, timeZone: filled.timeZone });
    }
  }, [starting, prefs, save]);
}

function PrefsScreen({ onNext }: { onNext: () => void }) {
  const { t, i18n } = useTranslation();
  const { user, prefs } = useAuth();
  const currency = useCurrencyChange();
  const save = useSavePrefs();

  return (
    <>
      {/* Only invitees are told the owner can see their data: an admin
          reaching this page is the one who installed the server. */}
      {user?.role !== "admin" && (
        <div className="flex items-center gap-3 rounded-2xl bg-blue-soft px-4 py-3 text-[13px] leading-relaxed text-blue-light">
          <Lock className="size-4 shrink-0" />
          <p>{t("welcome.privacy")}</p>
        </div>
      )}
      <div className="flex items-center justify-between gap-4">
        <span className="text-sm text-fg-dim">{t("welcome.prefs.language")}</span>
        <SegmentedControl
          value={prefs.uiLanguage}
          onChange={(lng) => save({ uiLanguage: lng as typeof prefs.uiLanguage })}
          options={[
            { value: "en", label: "English" },
            { value: "fr", label: "Français" },
          ]}
        />
      </div>
      <div className="flex flex-col gap-2">
        <span className="text-sm text-fg-dim">{t("welcome.prefs.currency")}</span>
        <Select
          value={currency.value}
          onChange={currency.change}
          options={CURRENCIES.map((c) => ({ value: c.code, label: c.label }))}
        />
        {currency.pick && (
          <span className="text-xs text-fg-faint"><CurrencyChangeHint pick={currency.pick} /></span>
        )}
      </div>
      <div className="flex flex-col gap-2">
        <span className="text-sm text-fg-dim">{t("welcome.prefs.timeZone")}</span>
        <Select
          value={prefs.timeZone}
          onChange={(timeZone) => save({ timeZone })}
          options={timeZoneOptions(prefs.timeZone, i18n.language)}
        />
      </div>
      <WelcomeFooter>
        <Button onClick={onNext}>{t("common.next")}</Button>
      </WelcomeFooter>
    </>
  );
}

function AiScreen({ onBack, onFinish, finishing }: { onBack: () => void; onFinish: () => void; finishing: boolean }) {
  const { t } = useTranslation();
  const { prefs } = useAuth();
  const save = useSavePrefs();
  return (
    <>
      <div className="flex items-center justify-between gap-4 rounded-xl bg-surface-2 px-4 py-3">
        <span className="text-sm font-medium text-fg">{t("welcome.ai.toggle")}</span>
        <Toggle
          checked={prefs.budgetAiEnabled}
          onChange={(on) => save({ budgetAiEnabled: on })}
          aria-label={t("welcome.ai.toggle")}
        />
      </div>
      <p className="-mt-3 text-xs text-fg-faint">{t("welcome.ai.later")}</p>
      <div className="flex flex-col gap-2 text-sm text-fg-dim">
        <p>{t("welcome.ai.body")}</p>
        <p>{t("welcome.ai.suggestions")}</p>
      </div>
      <WelcomeFooter onBack={onBack}>
        <Button onClick={onFinish} disabled={finishing}>{t("welcome.finish")}</Button>
      </WelcomeFooter>
    </>
  );
}
