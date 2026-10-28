import { reply, type Router } from "../router";
import type { Store } from "../store";

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
  r.route("GET", "/settings/budget-ai", ({ store }) => store.aiSettings);
  r.route("GET", "/settings/budget-ai/usage", ({ store }) => store.aiUsage);
  r.route("GET", "/settings/budget-ai/models/:provider", () => ["jev-small", "jev-large"]);
}
