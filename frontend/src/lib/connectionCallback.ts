/** Split the query string a provider redirects back with: `state` is the
 *  connection id we sent, everything else is for `/connections/complete`. */
export function parseCallbackParams(search: string): {
  connectionId: string | null;
  rest: Record<string, string>;
} {
  const { state: connectionId = null, ...rest } = Object.fromEntries(new URLSearchParams(search));
  return { connectionId, rest };
}
