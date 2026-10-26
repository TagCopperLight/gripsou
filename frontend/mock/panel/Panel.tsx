// The review panel: bottom-left, collapsible. A dev tool, so English only and
// styled on its own (inline styles), apart from the app's design.

import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import type { ControlInfo, OverrideMode } from "../control";

const TOKEN_KEY = "gripsou.token";
const OPEN_KEY = "gripsou.mock.open";

async function control(path: string, body?: unknown): Promise<void> {
  await fetch(`/__mock${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
}

async function patchPrefs(patch: Record<string, unknown>): Promise<void> {
  await fetch("/api/auth/prefs", {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Authorization: "Bearer mock" },
    body: JSON.stringify(patch),
  });
}

function signedIn(): boolean {
  return localStorage.getItem(TOKEN_KEY) !== null || sessionStorage.getItem(TOKEN_KEY) !== null;
}

function setSignedIn(on: boolean): void {
  localStorage.removeItem(TOKEN_KEY);
  sessionStorage.removeItem(TOKEN_KEY);
  if (on) localStorage.setItem(TOKEN_KEY, "mock");
}

/** Every change goes through a reload: React Query's cache would otherwise
 *  keep showing the data from before. */
const reload = () => location.reload();

const s = {
  pill: {
    position: "fixed", left: 12, bottom: 12, zIndex: 2147483647, font: "12px/1.4 ui-monospace, monospace",
    background: "#18181b", color: "#fafafa", border: "1px solid #3f3f46", borderRadius: 8,
    boxShadow: "0 8px 24px rgba(0,0,0,.35)",
  },
  body: { width: 320, maxHeight: "70vh", overflowY: "auto", padding: "0 10px 10px", borderTop: "1px solid #3f3f46" },
  head: { display: "flex", alignItems: "center", gap: 8, padding: "6px 10px", cursor: "pointer", userSelect: "none", fontSize: 12 },
  section: { borderTop: "1px solid #3f3f46", paddingTop: 8, marginTop: 8 },
  title: { color: "#a1a1aa", textTransform: "uppercase", fontSize: 10, letterSpacing: ".08em", marginBottom: 4 },
  row: { display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" },
  btn: { background: "#27272a", color: "#fafafa", border: "1px solid #3f3f46", borderRadius: 5, padding: "3px 8px", cursor: "pointer", font: "inherit" },
  on: { background: "#4338ca", borderColor: "#6366f1" },
  muted: { color: "#71717a" },
  warn: { color: "#fbbf24" },
  grid: { display: "grid", gridTemplateColumns: "64px 1fr", alignItems: "center", rowGap: 6, columnGap: 8 },
  label: { color: "#a1a1aa" },
  segmented: { display: "flex", border: "1px solid #3f3f46", borderRadius: 5, overflow: "hidden" },
  segment: { flex: 1, background: "#27272a", color: "#fafafa", border: 0, padding: "3px 0", cursor: "pointer", font: "inherit" },
} satisfies Record<string, CSSProperties>;

function Btn({ on, onClick, children }: { on?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" style={{ ...s.btn, ...(on ? s.on : {}) }} onClick={onClick}>
      {children}
    </button>
  );
}

function Segmented({ options, value, onChange }: { options: [string, string][]; value: string; onChange: (v: string) => void }) {
  return (
    <div style={s.segmented}>
      {options.map(([v, label], i) => (
        <button
          key={v}
          type="button"
          style={{ ...s.segment, ...(v === value ? s.on : {}), ...(i > 0 ? { borderLeft: "1px solid #3f3f46" } : {}) }}
          onClick={() => v !== value && onChange(v)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function Section({ title, first = false, children }: { title: string; first?: boolean; children: ReactNode }) {
  return (
    <div style={first ? { paddingTop: 8 } : s.section}>
      <div style={s.title}>{title}</div>
      {children}
    </div>
  );
}

export function Panel() {
  const [open, setOpen] = useState(() => localStorage.getItem(OPEN_KEY) !== "0");
  const [info, setInfo] = useState<ControlInfo | null>(null);
  const [path, setPath] = useState(location.pathname);

  useEffect(() => {
    const refresh = async () => {
      setPath(location.pathname);
      setInfo((await (await fetch("/__mock/info")).json()) as ControlInfo);
    };
    void refresh();
    const timer = setInterval(() => void refresh(), 1500);
    return () => clearInterval(timer);
  }, []);

  const toggleOpen = () => {
    localStorage.setItem(OPEN_KEY, open ? "0" : "1");
    setOpen(!open);
  };

  const here = info?.states.filter((st) => st.route === path) ?? [];
  const elsewhere = info?.states.filter((st) => st.route !== path && st.active) ?? [];
  const overridden = Object.entries(info?.overrides ?? {});
  const unhandled = info?.unhandled ?? [];
  const user = info?.user;

  return (
    <div style={s.pill}>
      <div style={s.head} onClick={toggleOpen}>
        <strong>Review</strong>
        <span style={s.muted}>{path}</span>
        {unhandled.length > 0 && <span style={s.warn}>⚠ {unhandled.length}</span>}
        <span style={{ marginLeft: "auto" }}>{open ? "▾" : "▸"}</span>
      </div>
      {open && (
        <div style={s.body}>
          <Section title="States on this screen" first>
            {here.length === 0 && <div style={s.muted}>None yet: the base data.</div>}
            {here.map((st) => (
              <label key={st.id} style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <input type="checkbox" checked={st.active} onChange={() => void control("/state", { id: st.id, on: !st.active }).then(reload)} />
                {st.label}
              </label>
            ))}
            {elsewhere.length > 0 && (
              <div style={{ ...s.muted, marginTop: 4 }}>
                Also on: {elsewhere.map((st) => st.label).join(", ")}
              </div>
            )}
          </Section>

          <Section title="App">
            <div style={s.grid}>
              {user && (
                <>
                  <span style={s.label}>Language</span>
                  <Segmented
                    options={[["en", "EN"], ["fr", "FR"]]}
                    value={user.uiLanguage}
                    onChange={(v) => void patchPrefs({ uiLanguage: v }).then(reload)}
                  />
                  <span style={s.label}>Currency</span>
                  <Segmented
                    options={[["EUR", "EUR"], ["USD", "USD"], ["GBP", "GBP"]]}
                    value={user.currency}
                    onChange={(v) => void patchPrefs({ currency: v }).then(reload)}
                  />
                  <span style={s.label}>Role</span>
                  <Segmented
                    options={[["admin", "Admin"], ["user", "Member"]]}
                    value={user.role}
                    onChange={(v) => void control("/role", { role: v }).then(reload)}
                  />
                </>
              )}
              <span style={s.label}>Data</span>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
                <Btn onClick={() => void control("/reset").then(reload)}>Reset</Btn>
                {signedIn() ? (
                  <Btn onClick={() => { setSignedIn(false); location.assign("/login"); }}>Sign out</Btn>
                ) : (
                  <Btn onClick={() => { setSignedIn(true); location.assign("/"); }}>Sign in</Btn>
                )}
              </div>
            </div>
          </Section>

          <Section title="Queries">
            {overridden.map(([p, mode]) => (
              <div key={p} style={s.row}>
                <span style={{ flex: 1, overflowWrap: "anywhere" }}>{p}</span>
                <span style={s.warn}>{mode}</span>
                <Btn onClick={() => void control("/override", { path: p, mode: null }).then(reload)}>clear</Btn>
              </div>
            ))}
            <details>
              <summary style={{ cursor: "pointer", ...s.muted }}>Keep a request loading, or make it fail</summary>
              {(info?.seen ?? []).filter((p) => !info?.overrides[p]).map((p) => (
                <div key={p} style={{ ...s.row, marginTop: 2 }}>
                  <span style={{ flex: 1, overflowWrap: "anywhere" }}>{p}</span>
                  {(["loading", "error"] as OverrideMode[]).map((mode) => (
                    <Btn key={mode} onClick={() => void control("/override", { path: p, mode }).then(reload)}>
                      {mode}
                    </Btn>
                  ))}
                </div>
              ))}
            </details>
          </Section>

          {unhandled.length > 0 && (
            <Section title="Not handled by the fake API (501)">
              {unhandled.map((u) => (
                <div key={u} style={s.warn}>{u}</div>
              ))}
            </Section>
          )}
        </div>
      )}
    </div>
  );
}
