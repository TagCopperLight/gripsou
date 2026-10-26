// The review mode's in-memory database. One base dataset; `resetStore` puts it
// back. Lives in the Vite process, so it survives page reloads.

import type { SessionUser } from "../src/api/types";
import { DEFAULT_PREFS } from "../src/lib/prefs";

export type Store = {
  user: SessionUser;
};

function baseStore(): Store {
  return {
    user: {
      id: "00000000-0000-4000-8000-000000000001",
      name: "Camille Martin",
      email: "camille@example.com",
      role: "admin",
      prefs: { ...DEFAULT_PREFS },
      welcomeDone: true,
    },
  };
}

let store = baseStore();

export function getStore(): Store {
  return store;
}

export function resetStore(): Store {
  store = baseStore();
  return store;
}
