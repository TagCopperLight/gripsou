import type { Role, UserPrefs } from "../src/api/wire.ts";
import { injected, requestKey, type OverrideMode } from "./faults.ts";
import type { Sent } from "./router.ts";
import { router } from "./routes/index.ts";
import type { MockState, Piece } from "./states/pieces.ts";
import { createStore } from "./store.ts";

export type AppSettings = { role: Role; uiLanguage: UserPrefs["uiLanguage"]; currency: string };

export type Saved = { active: string[]; app: AppSettings | null };

/** A real server's round trip, to see how a screen loads. */
const SLOW_MS = 900;

export type ControlInfo = {
  focus: Piece | null;
  states: { id: string; label: string; pieces: Piece[]; group?: string; option?: string; active: boolean }[];
  overrides: Record<string, OverrideMode>;
  slow: { on: boolean; ms: number };
  seen: string[];
  unhandled: string[];
  user: { role: string; uiLanguage: UserPrefs["uiLanguage"]; currency: string };
};

export function createControl(
  states: MockState[],
  { focus = null, saved = { active: [], app: null }, onChange }: { focus?: Piece | null; saved?: Saved; onChange?: (saved: Saved) => void } = {},
) {
  const active = new Set(saved.active.filter((id) => states.some((s) => s.id === id)));
  let app = saved.app;
  const overrides = new Map<string, OverrideMode>();
  let slow = false;
  const seen = new Set<string>();
  const unhandled = new Set<string>();
  let store = createStore();

  const save = () => onChange?.({ active: [...active], app });

  function applyApp(): void {
    if (!app) return;
    store.user.role = app.role;
    store.user.prefs = { ...store.user.prefs, uiLanguage: app.uiLanguage, currency: app.currency };
  }

  function captureApp(): void {
    app = { role: store.user.role, uiLanguage: store.user.prefs.uiLanguage, currency: store.user.prefs.currency };
    save();
  }

  function reset(): void {
    store = createStore();
    applyApp();
    for (const s of states) if (active.has(s.id)) s.apply(store);
  }

  /** States sharing a `group` exclude each other. */
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

  function setOverride(request: string, mode: OverrideMode | null): void {
    if (mode) overrides.set(request, mode);
    else overrides.delete(request);
  }

  function setSlow(on: boolean): void {
    slow = on;
  }

  function delay(): number {
    return slow ? SLOW_MS : 0;
  }

  /** The answer, or "hold" while the request is kept loading. */
  function handle(method: string, path: string, query: URLSearchParams, body: unknown): Sent | "hold" {
    seen.add(requestKey(method, path));
    const forced = injected(store.faults, overrides, method, path);
    if (forced) return forced;
    const out = router.dispatch(store, method, path, query, body);
    if (!out) {
      unhandled.add(requestKey(method, path));
      return { status: 404, text: `no route for ${requestKey(method, path)}` };
    }
    if (method === "PATCH" && path === "/auth/prefs" && out.status === 200) captureApp();
    return out;
  }

  function info(): ControlInfo {
    return {
      focus,
      states: states.map(({ id, label, pieces, group, option }) => ({ id, label, pieces, group, option, active: active.has(id) })),
      overrides: Object.fromEntries(overrides),
      slow: { on: slow, ms: SLOW_MS },
      seen: [...seen].sort(),
      unhandled: [...unhandled],
      user: { role: store.user.role, uiLanguage: store.user.prefs.uiLanguage, currency: store.user.prefs.currency },
    };
  }

  reset();

  return { reset, setState, setRole, setOverride, setSlow, delay, handle, info, store: () => store };
}

export type Control = ReturnType<typeof createControl>;
