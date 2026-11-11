import { keysReady } from "../data/backend.ts";
import { daysAgo } from "../data/util.ts";
import { nothingConnected } from "./helpers.ts";
import type { MockState } from "./pieces.ts";

export const apiKeys: MockState[] = [
  {
    id: "api-keys-none",
    label: "No key saved yet (fresh install)",
    pieces: ["API keys"],
    apply(store) {
      for (const p of store.apiKeys) {
        for (const f of p.fields) {
          if (f.secret) f.set = false;
          else f.value = null;
        }
        p.ready = keysReady(p);
      }
      store.aiSettings.available = [];
      store.aiSettings.provider = null;
    },
  },
];

export const general: MockState[] = [
  {
    id: "settings-us-formats",
    label: "US formats: MM/DD/YYYY, 1,234.56, $ before, New York",
    pieces: ["Settings · General"],
    apply(store) {
      Object.assign(store.user.prefs, {
        dateFormat: "MM/DD/YYYY", numberGroupSep: ",", numberDecimalSep: ".", currencyPosition: "before", currency: "USD", timeZone: "America/New_York",
      });
    },
  },
  {
    id: "fx-rate-down",
    label: "Currency change can't get its rate (Settings)",
    pieces: ["Settings · General", "Exchange rates"],
    apply(store) {
      store.fx.rateDown = true;
    },
  },
];

export const account: MockState[] = [
  {
    id: "account-two-factor-on",
    label: "Two-factor on, 3 recovery codes left",
    pieces: ["Settings · Account"],
    apply(store) {
      store.mfa = { ...store.mfa, totp: true, recoveryRemaining: 3 };
    },
  },
  {
    id: "account-passkeys",
    label: "Two passkeys",
    pieces: ["Settings · Account"],
    apply(store) {
      store.mfa = {
        ...store.mfa,
        passkeys: [
          { id: store.ids.next("passkey"), name: "MacBook Touch ID", createdAt: daysAgo(90), lastUsedAt: daysAgo(1) },
          { id: store.ids.next("passkey"), name: "YubiKey 5C", createdAt: daysAgo(30), lastUsedAt: null },
        ],
      };
    },
  },
  {
    id: "account-many-sessions",
    label: "Five sessions, one not remembered, one with no IP",
    pieces: ["Settings · Account"],
    group: "Sessions",
    option: "Five",
    apply(store) {
      store.sessions.push(
        { id: store.ids.next("session"), device: "Chrome on Windows", ip: "203.0.113.42", createdAt: daysAgo(3), lastActiveAt: daysAgo(3), remembered: false, current: false },
        { id: store.ids.next("session"), device: "Firefox on Android", ip: null, createdAt: daysAgo(70), lastActiveAt: daysAgo(25), remembered: true, current: false },
        { id: store.ids.next("session"), device: "Microsoft Edge on Windows with a very long device name", ip: "2001:db8:85a3::8a2e:370:7334", createdAt: daysAgo(1), lastActiveAt: Date.now() - 600_000, remembered: true, current: false },
      );
    },
  },
  {
    id: "account-only-session",
    label: "Only this session",
    pieces: ["Settings · Account"],
    group: "Sessions",
    option: "Only this one",
    apply(store) {
      store.sessions = store.sessions.filter((s) => s.current);
    },
  },
];

export const connections: MockState[] = [
  {
    id: "connections-two-providers",
    label: "Two providers enabled (Add shows a picker)",
    pieces: ["Settings · Connections"],
    apply(store) {
      store.providers.push({ key: "bridge", displayName: "Bridge", description: "Banks through Bridge by Bankin'.", enabled: true });
    },
  },
];

export const users: MockState[] = [
  {
    id: "users-several",
    label: "Five members, a long name and email",
    pieces: ["Settings · Users"],
    apply(store) {
      store.users.push(
        { id: store.ids.next("user"), name: "Jules", email: "jules@example.com", role: "user", joinedAt: daysAgo(30), isSelf: false, avatar: null },
        { id: store.ids.next("user"), name: "Marie-Charlotte de La Fontaine-Beaumont", email: "marie-charlotte.delafontaine-beaumont@example.com", role: "admin", joinedAt: daysAgo(400), isSelf: false, avatar: null },
        { id: store.ids.next("user"), name: "Sam", email: "sam@example.com", role: "user", joinedAt: daysAgo(2), isSelf: false, avatar: null },
      );
    },
  },
];

export const server: MockState[] = [
  {
    id: "server-ai-off",
    label: "No AI provider chosen",
    pieces: ["Settings · Server"],
    apply(store) {
      store.aiSettings = { ...store.aiSettings, provider: null, model: null };
    },
  },
  {
    id: "server-ai-usage",
    label: "AI used by two models, one without prices",
    pieces: ["Settings · Server"],
    group: "AI usage",
    option: "Two models",
    apply(store) {
      store.aiUsage.models.push({ model: "jev-large", runs: 3, runsWithoutUsage: 1, tokensIn: 96_400, tokensOut: 9_210, priceIn: null, priceOut: null, cost: null });
    },
  },
  {
    id: "server-ai-unused",
    label: "AI never used",
    pieces: ["Settings · Server"],
    group: "AI usage",
    option: "None",
    apply(store) {
      store.aiUsage = { ...store.aiUsage, models: [], totalCost: "0" };
    },
  },
];

// Log out to reach /login; /invite/any, /reset/any, /invite/expired;
// /connections/callback?state=x (add &error=1 for a failure).
export const signIn: MockState[] = [
  {
    id: "setup-needed",
    label: "Fresh install: no account yet (the setup code \"wrong\" is refused)",
    pieces: ["Sign-in pages"],
    apply(store) {
      store.setupNeeded = true;
    },
  },
  {
    id: "login-two-factor",
    label: "Signing in asks for a code (000000 and the backup code \"wrong\" are refused)",
    pieces: ["Sign-in pages"],
    apply(store) {
      store.loginMfa = true;
    },
  },
  {
    id: "welcome-new",
    label: "A new account, at the welcome screen",
    pieces: ["Sign-in pages"],
    apply(store) {
      nothingConnected(store);
      store.user = { ...store.user, welcomeDone: false };
    },
  },
  {
    id: "welcome-no-ai",
    label: "No AI provider (the welcome screen has two steps)",
    pieces: ["Sign-in pages"],
    apply(store) {
      store.aiStatus = { ...store.aiStatus, configured: false };
    },
  },
];
