// What the review panel drives: the live store, the active per-screen states,
// and per-path overrides that keep a request loading or make it fail.

import { reply, type Reply } from "./router.ts";
import { router } from "./routes/index.ts";
import type { MockState } from "./states.ts";
import { createStore } from "./store.ts";

/** Signing in and out keep working when every write fails. */
const SESSION = new Set(["/auth/login", "/auth/logout"]);

export type OverrideMode = "loading" | "error";

/** The panel's own App settings: kept across state changes, Reset and restarts. */
export type AppSettings = { role: "admin" | "user"; uiLanguage: string; currency: string };

/** What survives a dev-server restart. */
export type Saved = { active: string[]; app: AppSettings | null };

export type ControlInfo = {
  /** The piece under review (`FOCUS` in states.ts). */
  focus: string;
  states: { id: string; label: string; pieces: string[]; group?: string; option?: string; active: boolean }[];
  overrides: Record<string, OverrideMode>;
  /** GET paths the app asked for, for the override list. */
  seen: string[];
  unhandled: string[];
  user: { role: string; uiLanguage: string; currency: string };
};

/** `saved`: what was on before a restart; `onChange` sees every change to it. */
export function createControl(
  states: MockState[],
  { focus = "", saved = { active: [], app: null }, onChange }: { focus?: string; saved?: Saved; onChange?: (saved: Saved) => void } = {},
) {
  const active = new Set(saved.active.filter((id) => states.some((s) => s.id === id)));
  let app = saved.app;
  const overrides = new Map<string, OverrideMode>();
  const seen = new Set<string>();
  const unhandled = new Set<string>();
  let store = createStore();

  const save = () => onChange?.({ active: [...active], app });

  function applyApp(): void {
    if (!app) return;
    store.user.role = app.role;
    store.user.prefs = { ...store.user.prefs, uiLanguage: app.uiLanguage as typeof store.user.prefs.uiLanguage, currency: app.currency };
  }

  /** Read back after the panel (or the app's own settings page) changed them. */
  function captureApp(): void {
    app = { role: store.user.role, uiLanguage: store.user.prefs.uiLanguage, currency: store.user.prefs.currency };
    save();
  }

  function reset(): void {
    store = createStore();
    applyApp();
    for (const s of states) if (active.has(s.id)) s.apply(store);
  }

  /** States sharing a `group` exclude each other: turning one on turns the rest off. */
  function setState(id: string, on: boolean): void {
    const group = states.find((s) => s.id === id)?.group;
    if (on && group) for (const s of states) if (s.group === group) active.delete(s.id);
    if (on) active.add(id);
    else active.delete(id);
    reset();
    save();
  }

  function setRole(role: AppSettings["role"]): void {
    store.user.role = role;
    captureApp();
  }

  function setOverride(path: string, mode: OverrideMode | null): void {
    if (mode) overrides.set(path, mode);
    else overrides.delete(path);
  }

  /** The answer, or "hold" while the path is kept loading. */
  function handle(method: string, path: string, query: URLSearchParams, body: unknown): Reply | "hold" {
    if (method === "GET") seen.add(path);
    const mode = overrides.get(path);
    if (mode === "loading") return "hold";
    if (mode === "error") return reply(500, { error: "forced by the review panel" });
    if (method === "GET" ? store.readsFail && path !== "/auth/me" : store.writesFail && !SESSION.has(path)) {
      return reply(500, { error: "forced by the review panel" });
    }
    // A number where a list belongs: the pages reading it throw.
    if (store.accountsBroken && method === "GET" && path === "/accounts") return reply(200, 42);
    const out = router.dispatch(store, method, path, query, body);
    if (out.status === 501) unhandled.add(`${method} ${path}`);
    if (method === "PATCH" && path === "/auth/prefs" && out.status === 200) captureApp();
    return out;
  }

  function info(): ControlInfo {
    return {
      focus,
      states: states.map(({ id, label, pieces, group, option }) => ({ id, label, pieces, group, option, active: active.has(id) })),
      overrides: Object.fromEntries(overrides),
      seen: [...seen].sort(),
      unhandled: [...unhandled],
      user: { role: store.user.role, uiLanguage: store.user.prefs.uiLanguage, currency: store.user.prefs.currency },
    };
  }

  reset();

  return { reset, setState, setRole, setOverride, handle, info, store: () => store };
}

export type Control = ReturnType<typeof createControl>;
