/** Its own function so tests can replace it: jsdom cannot navigate. */
export function goTo(url: string) {
  window.location.href = url;
}
