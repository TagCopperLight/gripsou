// What each server route takes and answers: `Api` in src/api/routes.ts,
// generated from the server's route registration, where each handler's
// signature gives its request body and answer. routes.test fails on a server
// route with no mock handler that isn't in NOT_MOCKED. `void`: no body.

import type { Api, Route } from "../src/api/routes.ts";

/** Server routes the app never calls, so the mock leaves them out. */
export const NOT_MOCKED = [
  // Providers call it, not the app.
  "POST /webhooks/:provider",
] as const satisfies readonly Route[];

export type Key = keyof Api;
export type Body<K extends Key> = Api[K] extends { body: infer B } ? B : undefined;
export type Res<K extends Key> = Api[K]["res"];
