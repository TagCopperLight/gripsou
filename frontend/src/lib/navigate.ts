/** Full-page navigation (to a provider's site or back). Its own function so
 *  tests can replace it: jsdom cannot navigate and `location` cannot be stubbed. */
export function goTo(url: string) {
  window.location.href = url;
}
