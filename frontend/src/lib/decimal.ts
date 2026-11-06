// Arithmetic on the API's decimal strings, exactly, in BigInt: money and
// quantities are `Decimal` end to end (CLAUDE.md), and `Number(...)` would
// bring back the float error the strings exist to avoid. `Number` stays
// acceptable for a ratio or a chart coordinate, never for a shown amount.

/** A decimal string as the API sends it and as `normaliseDecimal` leaves a
 *  well-formed input. */
export const DECIMAL_RE = /^-?\d+(\.\d+)?$/;

type Scaled = { units: bigint; scale: number };

function parse(value: string): Scaled {
  const m = /^(-)?(\d+)(?:\.(\d+))?$/.exec(value.trim());
  if (!m) throw new Error(`not a decimal string: ${value}`);
  const [, negative, intPart, fracPart = ""] = m;
  const magnitude = BigInt(intPart + fracPart);
  return { units: negative ? -magnitude : magnitude, scale: fracPart.length };
}

function rescale(d: Scaled, scale: number): bigint {
  return d.units * 10n ** BigInt(scale - d.scale);
}

/** Zero renders unsigned, at the operands' width: `"-0.5" + "0.5"` is `"0.0"`. */
function render({ units, scale }: Scaled): string {
  const negative = units < 0n;
  const digits = (negative ? -units : units).toString().padStart(scale + 1, "0");
  const body = scale === 0 ? digits : `${digits.slice(0, -scale)}.${digits.slice(-scale)}`;
  return negative ? `-${body}` : body;
}

/** The sum, at the widest fraction length among the inputs (`"1.5" + "2.25"`
 *  is `"3.75"`). An empty list sums to `"0"`. */
export function sumDecimals(values: string[]): string {
  if (values.length === 0) return "0";
  const parsed = values.map(parse);
  const scale = Math.max(...parsed.map((p) => p.scale));
  return render({ units: parsed.reduce((sum, p) => sum + rescale(p, scale), 0n), scale });
}

export function negateDecimal(value: string): string {
  const d = parse(value);
  return render({ units: -d.units, scale: d.scale });
}

export function subtractDecimals(a: string, b: string): string {
  return sumDecimals([a, negateDecimal(b)]);
}

/** The exact product, at the sum of the operands' fraction lengths. */
export function multiplyDecimals(a: string, b: string): string {
  const x = parse(a);
  const y = parse(b);
  return render({ units: x.units * y.units, scale: x.scale + y.scale });
}

/** -1, 0 or 1 as `a` is below, equal to or above `b`; `"16.030"` equals `"16.03"`. */
export function compareDecimals(a: string, b: string): -1 | 0 | 1 {
  const x = parse(a);
  const y = parse(b);
  const scale = Math.max(x.scale, y.scale);
  const diff = rescale(x, scale) - rescale(y, scale);
  return diff < 0n ? -1 : diff > 0n ? 1 : 0;
}

/** An FR keyboard under `inputMode="decimal"` produces `16,03`, so a comma has
 *  to be readable as a decimal separator. But `15,617` (three decimals, like
 *  a typical ETF unit price) and `1,234` (en-US grouping) are indistinguishable
 *  from the string alone, and guessing wrong posts a value 1000x off in silence.
 *
 *  So the reader is locale-led: under `fr` a comma is the decimal separator,
 *  which is what the French keyboard produces and what French formatting means.
 *  Under any other language a comma is grouping, and a decimal comma is not
 *  expected — so anything containing one is left alone for `DECIMAL_RE` to
 *  reject, and the user is told rather than silently misread. Mixed or repeated
 *  separators are always ambiguous and always refused. */
export function normaliseDecimal(raw: string, language: string): string {
  const s = raw.trim();
  if (s.includes(".") && s.includes(",")) return s;
  if ((s.match(/,/g) ?? []).length > 1) return s;
  if (!language.toLowerCase().startsWith("fr")) return s;
  return s.replace(",", ".");
}
