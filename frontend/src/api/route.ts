// What each route takes and answers, read off the generated `Api`. Shared by
// the client and the review mode's fake API (mock/router.ts).

import type { Api } from "./routes";

export type Key = keyof Api;
/** The JSON body the route takes; `undefined`: none. */
export type Body<K extends Key> = Api[K] extends { body: infer B } ? B : undefined;
/** The query parameters the route takes; `undefined`: none. */
export type Query<K extends Key> = Api[K] extends { query: infer Q } ? Q : undefined;
/** What the route answers; `void`: no body. */
export type Res<K extends Key> = Api[K]["res"];

type ParamNames<P extends string> = P extends `${string}:${infer N}/${infer Rest}`
  ? N | ParamNames<Rest>
  : P extends `${string}:${infer N}`
    ? N
    : never;

/** The `:name` segments of the route's path. */
export type Params<K extends Key> = { [N in ParamNames<K>]: string };
