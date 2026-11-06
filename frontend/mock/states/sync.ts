import ACCOUNT_PALETTE from "../../../shared/account-palette.json" with { type: "json" };
import { BANK, BROKER, SAVINGS } from "../data/base.ts";
import { connectionRow, healthy, type ConnectionRow } from "../data/rows.ts";
import { addAccount, connection, staleDay } from "./helpers.ts";
import type { MockState } from "./pieces.ts";

export const sync: MockState[] = [
  {
    id: "sync-every-status",
    label: "A connection in every status",
    pieces: ["Sync", "Settings · Connections"],
    group: "Connections",
    option: "Every status",
    apply(store) {
      // Each one holds one account (none: null), with some cash.
      const more: [string, Partial<ConnectionRow>, string | null][] = [
        ["Société Générale", { status: "syncing" }, "Compte courant"],
        ["Fortuneo", { status: "awaiting" }, "Compte courant"],
        ["Hello bank!", { status: "pending", lastSyncAt: null, health: null }, null],
        ["Linxea", { status: "error", lastError: "provider fetch: powens: GET /users/me/connections/42/accounts: 503 Service Unavailable" }, "Assurance vie Linxea Spirit 2"],
        ["La Banque Postale", { health: healthy({ state: "SCARequired" }) }, "Compte courant"],
        ["Caisse d'Épargne Île-de-France", { health: healthy({ state: "wrongpass", errorMessage: null, nextRetryOn: staleDay(-2) }) }, "Livret Développement Durable et Solidaire"],
        ["LCL", { health: healthy({ lastUpdatedOn: staleDay(6) }) }, "Compte courant"],
        ["Banque Populaire", { health: healthy({ verified: false, lastUpdatedOn: null }) }, "Compte courant"],
      ];
      more.forEach(([displayName, c, account], i) => {
        const id = store.ids.next("connection");
        store.connections.push(connectionRow(id, displayName, c));
        if (account !== null) addAccount(store, id, 600 + 100 * i, { name: account, color: ACCOUNT_PALETTE[3], typeKey: "checking" });
      });
      // A partial update: the bank's checking account is fresh, the Livret A is not.
      store.accountHealth[SAVINGS] = healthy({ lastUpdatedOn: staleDay(9) });
    },
  },
  {
    id: "sync-one-syncing",
    label: "One connection syncing (the button spins)",
    pieces: ["Sync", "Settings · Connections"],
    group: "Connections",
    option: "Syncing",
    apply(store) {
      const broker = connection(store, BROKER);
      if (broker) broker.status = "syncing";
    },
  },
  {
    id: "sync-one-error",
    label: "One connection failed (red dot)",
    pieces: ["Sync", "Settings · Connections"],
    group: "Connections",
    option: "Error",
    apply(store) {
      const broker = connection(store, BROKER);
      if (broker) Object.assign(broker, { status: "error", lastError: "sync interrupted (the server restarted)" });
    },
  },
  {
    id: "sync-one-warning",
    label: "Bank data outdated (amber dot)",
    pieces: ["Sync", "Settings · Connections"],
    group: "Connections",
    option: "Warning",
    apply(store) {
      const bank = connection(store, BANK);
      if (bank) bank.health = healthy({ lastUpdatedOn: staleDay(5) });
    },
  },
];
