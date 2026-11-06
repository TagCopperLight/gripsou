// What each server route takes and answers: `Api` in src/api/routes.ts,
// generated from the server's route registration, read through the client's
// helpers (src/api/route.ts). routes.test fails on a server route with no mock
// handler that isn't in NOT_MOCKED.

import type { Route } from "../src/api/routes.ts";

export type { Body, Key, Res } from "../src/api/route.ts";

/** Server routes the app never calls, so the mock leaves them out. */
export const NOT_MOCKED = [
  // Providers call it, not the app.
  "POST /webhooks/:provider",
] as const satisfies readonly Route[];
