// The floating panels open right now, oldest first: Escape closes the newest
// one only.
const open: number[] = [];
let next = 0;

export function pushPanel(): number {
  const id = next++;
  open.push(id);
  return id;
}

export function popPanel(id: number): void {
  const i = open.indexOf(id);
  if (i >= 0) open.splice(i, 1);
}

export function isTopPanel(id: number): boolean {
  return open[open.length - 1] === id;
}
