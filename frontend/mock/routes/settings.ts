import type { Router } from "../router";
import type { Store } from "../store";

export function settingsRoutes(r: Router<Store>): void {
  r.route("GET", "/health", () => ({ status: "ok", version: "0.0.0-mock" }));
  r.route("GET", "/users", ({ store }) => store.users);
  r.route("GET", "/providers", ({ store }) => store.providers);
  r.route("GET", "/providers/enabled", ({ store }) =>
    store.providers.filter((p) => p.enabled).map(({ key, displayName, description }) => ({ key, displayName, description })),
  );
  r.route("GET", "/settings/budget-ai", ({ store }) => store.aiSettings);
  r.route("GET", "/settings/budget-ai/usage", ({ store }) => store.aiUsage);
  r.route("GET", "/settings/budget-ai/models/:provider", () => ["jev-small", "jev-large"]);
}
