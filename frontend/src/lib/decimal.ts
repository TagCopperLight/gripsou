// Exact arithmetic on the API's decimal strings in BigInt: `Number(...)` brings
// back float error. `Number` is fine for a ratio or chart coordinate, never a
// shown amount.

/** A typed number in the API's form (`-12.5`): `"+1"` is `"1"`, `".5"`
 *  is `"0.5"`, `"1."` is `"1"`. Null unless it is digits with an optional
 *  sign and decimal point. */
export function canonicalDecimal(value: string): string | null {
  const m = /^([+-]?)(\d*)(?:\.(\d*))?$/.exec(value);
  if (!m) return null;
  const [, sign, int, frac = ""] = m;
  if (int === "" && frac === "") return null;
  return `${sign === "-" ? "-" : ""}${int || "0"}${frac ? `.${frac}` : ""}`;
}

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

/** At the widest fraction length among the inputs. */
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

/** At the sum of the operands' fraction lengths. */
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

/** FR keyboards produce `16,03`, but `15,617` (ETF price) and `1,234` (en-US
 *  grouping) look alike, and guessing wrong posts a value 1000x off. So it
 *  follows the locale: under `fr` a comma is the decimal separator; under any
 *  other language it is grouping, and a number with one is left for
 *  `canonicalDecimal` to reject. Mixed or repeated separators are refused. */
export function normaliseDecimal(raw: string, language: string): string {
  const s = raw.trim();
  if (s.includes(".") && s.includes(",")) return s;
  if ((s.match(/,/g) ?? []).length > 1) return s;
  if (!language.toLowerCase().startsWith("fr")) return s;
  return s.replace(",", ".");
}
