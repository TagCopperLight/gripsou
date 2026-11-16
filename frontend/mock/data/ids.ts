// Every id in the fake dataset comes from here. Each kind has its own prefix, so no two ids are equal.

const PREFIX = {
  user: "001",
  session: "002",
  passkey: "003",
  connection: "004",
  account: "005",
  security: "006",
  lot: "007",
  txn: "008",
  category: "009",
  tag: "00a",
} as const;

export type IdKind = keyof typeof PREFIX;

const FIRST_ALLOCATED = 100;

function format(kind: IdKind, n: number): string {
  return `00000000-0000-4000-8${PREFIX[kind]}-${n.toString(16).padStart(12, "0")}`;
}

export function named(kind: IdKind, n: number): string {
  if (n < 1 || n >= FIRST_ALLOCATED) throw new Error(`named id ${kind} ${n} outside 1..${FIRST_ALLOCATED - 1}`);
  return format(kind, n);
}

export type Ids = { next(kind: IdKind): string };

export function createIds(): Ids {
  const last: Partial<Record<IdKind, number>> = {};
  return {
    next(kind) {
      last[kind] = (last[kind] ?? FIRST_ALLOCATED - 1) + 1;
      return format(kind, last[kind]);
    },
  };
}
