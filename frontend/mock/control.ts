// What the review panel drives: the live store, the active per-screen states,
// and per-path overrides that keep a request loading or make it fail.

import { reply, type Reply } from "./router";
import { router } from "./routes";
import type { MockState } from "./states";
import { createStore } from "./store";

export type OverrideMode = "loading" | "error";

export type ControlInfo = {
  states: { id: string; label: string; route: string; active: boolean }[];
  overrides: Record<string, OverrideMode>;
  /** GET paths the app asked for, for the override list. */
  seen: string[];
  unhandled: string[];
  user: { role: string; uiLanguage: string; currency: string };
};

/** `initial`: the states active before a restart; `onChange` sees every change. */
export function createControl(states: MockState[], initial: string[] = [], onChange?: (active: string[]) => void) {
  const active = new Set(initial.filter((id) => states.some((s) => s.id === id)));
  const overrides = new Map<string, OverrideMode>();
  const seen = new Set<string>();
  const unhandled = new Set<string>();
  let store = createStore();

  function reset(): void {
    store = createStore();
    for (const s of states) if (active.has(s.id)) s.apply(store);
  }

  function setState(id: string, on: boolean): void {
    if (on) active.add(id);
    else active.delete(id);
    reset();
    onChange?.([...active]);
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
    const out = router.dispatch(store, method, path, query, body);
    if (out.status === 501) unhandled.add(`${method} ${path}`);
    return out;
  }

  function info(): ControlInfo {
    return {
      states: states.map(({ id, label, route }) => ({ id, label, route, active: active.has(id) })),
      overrides: Object.fromEntries(overrides),
      seen: [...seen].sort(),
      unhandled: [...unhandled],
      user: { role: store.user.role, uiLanguage: store.user.prefs.uiLanguage, currency: store.user.prefs.currency },
    };
  }

  reset();

  return { reset, setState, setOverride, handle, info, store: () => store };
}

export type Control = ReturnType<typeof createControl>;
