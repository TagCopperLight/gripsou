// The query string of each route that takes one, read into its generated
// type as the server's `Query` extractor reads it: a value that doesn't fit
// its field is a 400 in axum's words. A route whose query type gains a field
// fails to type-check here until it is read.

import type { Key, Query } from "../src/api/route.ts";
import { RANGES, type RangeParams, type SummaryParams, type TransactionParams, type TrendParams, type TypeBucket } from "../src/api/wire.ts";

/** A query string the server refuses to read; `message` is its 400 text. */
export class BadQuery extends Error {}

const refuse = (detail: string): never => {
  throw new BadQuery(`Failed to deserialize query string: ${detail}`);
};

type Raw = URLSearchParams;
type Reader<T> = { [F in keyof T]-?: (q: Raw, name: F & string) => T[F] };

const text = (q: Raw, name: string): string | undefined => q.get(name) ?? undefined;

function int(q: Raw, name: string, unsigned = false): number | undefined {
  const raw = q.get(name);
  if (raw === null) return undefined;
  if (raw === "") refuse(`${name}: cannot parse integer from empty string`);
  if (!(unsigned ? /^\+?\d+$/ : /^[+-]?\d+$/).test(raw)) refuse(`${name}: invalid digit found in string`);
  return Number(raw);
}

function bool(q: Raw, name: string): boolean | undefined {
  const raw = q.get(name);
  if (raw === null) return undefined;
  if (raw !== "true" && raw !== "false") refuse(`${name}: provided string was not \`true\` or \`false\``);
  return raw === "true";
}

function date(q: Raw, name: string): string | undefined {
  const raw = q.get(name);
  if (raw !== null && !/^\d{4}-\d{2}-\d{2}$/.test(raw)) refuse(`${name}: input contains invalid characters`);
  return raw ?? undefined;
}

function oneOf<T extends string>(values: readonly T[]) {
  return (q: Raw, name: string): T | undefined => {
    const raw = q.get(name);
    if (raw === null) return undefined;
    return values.find((v) => v === raw)
      ?? refuse(`${name}: unknown variant \`${raw}\`, expected one of ${values.map((v) => `\`${v}\``).join(", ")}`);
  };
}

function required(q: Raw, name: string): string {
  return q.get(name) ?? refuse(`missing field \`${name}\``);
}

function read<T>(fields: Reader<T>) {
  return (q: Raw): T => {
    const out: Partial<T> = {};
    for (const name of Object.keys(fields) as (keyof T & string)[]) {
      const value = fields[name](q, name);
      if (value !== undefined) out[name] = value;
    }
    return out as T;
  };
}

const range = read<RangeParams>({ range: oneOf(RANGES) });

const transactions = read<TransactionParams>({
  search: text,
  accountId: text,
  // Any text: the server reads the bucket as a string, then checks it.
  bucket: (q, name) => text(q, name) as TypeBucket | undefined,
  from: date,
  to: date,
  categoryIds: text,
  tagIds: text,
  uncategorized: bool,
  needsReview: bool,
  includeTransfers: bool,
  limit: (q, name) => int(q, name),
  offset: (q, name) => int(q, name),
});

type WithQuery = { [K in Key as Query<K> extends undefined ? never : K]: (q: Raw) => Query<K> };

const QUERIES: WithQuery = {
  "GET /dashboard/net-worth": range,
  "GET /accounts/series": range,
  "GET /holdings/:id/prices": range,
  "GET /transactions": transactions,
  "GET /transactions/counts": transactions,
  "GET /budget/summary": read<SummaryParams>({ month: text, from: date, to: date }),
  "GET /budget/trend": read<TrendParams>({ anchor: required, months: (q, name) => int(q, name, true) }),
};

/** The route's query, read from the URL; throws `BadQuery`. */
export function readQuery<K extends Key>(key: K, raw: Raw): Query<K> {
  const reader = (QUERIES as Partial<Record<Key, (q: Raw) => unknown>>)[key];
  return (reader ? reader(raw) : undefined) as Query<K>;
}
