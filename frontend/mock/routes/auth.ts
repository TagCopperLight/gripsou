import { withPatch, type PrefsPatch } from "../../src/lib/prefs";
import { reply, type Router } from "../router";
import type { Store } from "../store";

const TOKEN = "mock";

/** Made-up codes, the server's shape (xxxx-xxxx). */
const RECOVERY_CODES = ["k7qm-2xd9", "p4wn-8rtc", "h3vb-6yle", "z9fa-1mks", "c2tj-7gqp", "n8re-4wvd", "u5xh-3bnz", "f6ly-9cpa", "m1gs-5kte", "w4dq-2jhr"];

/** A placeholder in place of the QR code: no authenticator should scan it. */
const QR_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 21 21" shape-rendering="crispEdges"><rect width="21" height="21" fill="#fff"/><path d="M0 0h7v7H0zM14 0h7v7h-7zM0 14h7v7H0z" fill="#000"/><path d="M1 1h5v5H1zM15 1h5v5h-5zM1 15h5v5H1z" fill="#fff"/><path d="M2 2h3v3H2zM16 2h3v3h-3zM2 16h3v3H2zM9 2h2v2H9zM8 8h5v1H8zM10 10h3v3h-3zM15 9h2v4h-2zM9 15h4v2H9zM15 15h4v4h-4z" fill="#000"/></svg>`;

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

  r.route("DELETE", "/auth/sessions/:id", ({ store, params }) => {
    store.sessions = store.sessions.filter((s) => s.id !== params.id || s.current);
    return reply(204);
  });
  r.route("DELETE", "/auth/sessions", ({ store }) => {
    store.sessions = store.sessions.filter((s) => s.current);
    return reply(204);
  });

  // Two-factor: any 6 digits confirm the app, except "000000".
  r.route("POST", "/auth/mfa/totp/setup", () => ({ secret: "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP", qrSvg: QR_SVG }));
  r.route("POST", "/auth/mfa/totp/confirm", ({ store, body }) => {
    if ((body as { code: string }).code === "000000") return reply(400, { error: "invalid code" });
    store.mfa = { ...store.mfa, totp: true, recoveryRemaining: 10 };
    return { recoveryCodes: RECOVERY_CODES };
  });
  r.route("DELETE", "/auth/mfa/totp", ({ store }) => {
    store.mfa = { ...store.mfa, totp: false, recoveryRemaining: 0 };
    return reply(204);
  });
  r.route("POST", "/auth/mfa/recovery/regenerate", ({ store }) => {
    store.mfa = { ...store.mfa, recoveryRemaining: 10 };
    return { recoveryCodes: RECOVERY_CODES };
  });
  r.route("PATCH", "/auth/mfa/passkeys/:id", ({ store, params, body }) => {
    store.mfa = { ...store.mfa, passkeys: store.mfa.passkeys.map((p) => (p.id === params.id ? { ...p, name: (body as { name: string }).name } : p)) };
    return reply(204);
  });
  r.route("DELETE", "/auth/mfa/passkeys/:id", ({ store, params }) => {
    store.mfa = { ...store.mfa, passkeys: store.mfa.passkeys.filter((p) => p.id !== params.id) };
    return reply(204);
  });
}
