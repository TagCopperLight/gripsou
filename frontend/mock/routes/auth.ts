import { withPatch, type PrefsPatch } from "../../src/lib/prefs";
import { reply, type Router } from "../router";
import type { Store } from "../store";

const TOKEN = "mock";

/** The review's way to type a refused password: "wrong". */
const wrong = (body: unknown, field: string) => (body as Record<string, unknown> | undefined)?.[field] === "wrong";

export function authRoutes(r: Router<Store>): void {
  r.route("GET", "/auth/me", ({ store }) => store.user);
  r.route("GET", "/auth/sessions", ({ store }) => store.sessions);
  r.route("GET", "/auth/mfa/status", ({ store }) => store.mfa);
  r.route("GET", "/auth/token/:token", () => ({ type: "invite", email: null }));

  r.route("PATCH", "/auth/prefs", ({ store, body }) => {
    const currency = (body as PrefsPatch).currency;
    if (store.fx.rateDown && currency !== undefined && currency !== store.user.prefs.currency && currency !== "EUR") {
      return reply(502, { error: `no exchange rate into ${currency} right now` });
    }
    store.user = { ...store.user, prefs: withPatch(store.user.prefs, body as PrefsPatch) };
    return store.user;
  });

  // Any credentials sign in as the store's user, except the password "wrong",
  // which shows the form's error. Same for every password check below.
  r.route("POST", "/auth/login", ({ store, body }) =>
    wrong(body, "password") ? reply(401, { error: "invalid email or password" }) : { token: TOKEN, user: store.user },
  );
  r.route("POST", "/auth/reauth", ({ body }) =>
    wrong(body, "password") ? reply(400, { error: "wrong password" }) : { reauth: "mock-reauth" },
  );
  r.route("POST", "/auth/change-password", ({ body }) =>
    wrong(body, "currentPassword") ? reply(400, { error: "wrong password" }) : reply(204),
  );
  r.route("DELETE", "/auth/account", ({ body }) =>
    wrong(body, "password") ? reply(400, { error: "wrong password" }) : reply(204),
  );
  // An email ending in "@taken.example" belongs to another account.
  r.route("PATCH", "/auth/me", ({ store, body }) => {
    const { name, email } = body as { name: string; email: string };
    if (email.endsWith("@taken.example")) return reply(409, { error: "email in use" });
    store.user = { ...store.user, name, email };
    return store.user;
  });
  r.route("POST", "/auth/logout", () => reply(204));
}
