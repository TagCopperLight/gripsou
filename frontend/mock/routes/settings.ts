import { reply, type Router } from "../router.ts";
import type { Store } from "../store.ts";

export function settingsRoutes(r: Router<Store>): void {
  r.route("GET", "/health", () => ({ status: "ok", version: "0.0.0-mock" }));
  r.route("GET", "/users", ({ store }) => store.users);
  // Made-up tokens: the links lead to the review's invite and reset pages.
  r.route("POST", "/invites", () => ({ token: "mock-invite-token" }));
  r.route("POST", "/users/:id/reset-link", () => ({ token: "mock-reset-token" }));
  // As the server: never your own role, never the last admin.
  r.route("PATCH", "/users/:id", ({ store, params, body }) => {
    const { role } = body as { role: "admin" | "user" };
    const user = store.users.find((u) => u.id === params.id);
    if (!user) return reply(404, { error: "user not found" });
    if (user.isSelf) return reply(409, { error: "cannot change your own role" });
    if (role === "user" && !store.users.some((u) => u.role === "admin" && u !== user)) return reply(409, { error: "cannot demote the last admin" });
    user.role = role;
    return reply(204);
  });
  r.route("DELETE", "/users/:id", ({ store, params }) => {
    store.users = store.users.filter((u) => u.id !== params.id || u.isSelf);
    return reply(204);
  });
  r.route("GET", "/providers", ({ store }) => store.providers);
  r.route("GET", "/providers/enabled", ({ store }) =>
    store.providers.filter((p) => p.enabled).map(({ key, displayName, description }) => ({ key, displayName, description })),
  );
  r.route("GET", "/settings/api-keys", ({ store }) => store.apiKeys);
  // As the server: one field at a time, null removes it; the JEV key decides
  // whether the AI can pick JEV.
  r.route("PATCH", "/settings/api-keys/:provider", ({ store, params, body }) => {
    const { field, value } = body as { field: string; value: string | null };
    const p = store.apiKeys.find((x) => x.key === params.provider);
    const f = p?.fields.find((x) => x.key === field);
    if (!p || !f) return reply(404, { error: "no such setting" });
    if (f.secret) f.set = value !== null;
    else f.value = value;
    if (p.key === "jev" && f.secret) {
      store.aiSettings.available = f.set ? ["jev"] : [];
      if (!f.set) store.aiSettings.provider = null;
    }
    return p;
  });
  r.route("GET", "/settings/budget-ai", ({ store }) => store.aiSettings);
  r.route("GET", "/settings/budget-ai/usage", ({ store }) => store.aiUsage);
  r.route("GET", "/settings/budget-ai/models/:provider", () => ["jev-small", "jev-large"]);
  r.route("PATCH", "/providers/:key", ({ store, params, body }) => {
    const p = store.providers.find((x) => x.key === params.key);
    if (!p) return reply(404, { error: "no such provider" });
    p.enabled = (body as { enabled: boolean }).enabled;
    return p;
  });
  r.route("PATCH", "/settings/budget-ai", ({ store, body }) => {
    Object.assign(store.aiSettings, body as { provider: string | null; model: string | null });
    return reply(204);
  });
  // Prices change what each model cost; the totals follow.
  r.route("PUT", "/settings/budget-ai/prices", ({ store, body }) => {
    const prices = body as Record<string, { in: string; out: string }>;
    let total = 0;
    for (const m of store.aiUsage.models) {
      const p = prices[m.model];
      m.priceIn = p?.in ?? null;
      m.priceOut = p?.out ?? null;
      m.cost = p ? ((m.tokensIn * Number(p.in) + m.tokensOut * Number(p.out)) / 1e6).toFixed(2) : null;
      if (m.cost) total += Number(m.cost);
    }
    store.aiUsage.totalCost = total.toFixed(2);
    return reply(204);
  });
}
