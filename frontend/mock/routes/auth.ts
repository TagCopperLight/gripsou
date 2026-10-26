import type { SessionUser } from "../../src/api/types";
import { withPatch, type PrefsPatch } from "../../src/lib/prefs";
import { reply, type Router } from "../router";
import type { Store } from "../store";

const TOKEN = "mock";

export function authRoutes(r: Router<Store>): void {
  r.route("GET", "/auth/me", ({ store }) => store.user);

  r.route("PATCH", "/auth/prefs", ({ store, body }): SessionUser => {
    store.user = { ...store.user, prefs: withPatch(store.user.prefs, body as PrefsPatch) };
    return store.user;
  });

  // Any credentials sign in as the store's user.
  r.route("POST", "/auth/login", ({ store }) => ({ token: TOKEN, user: store.user }));
  r.route("POST", "/auth/logout", () => reply(204));
}
