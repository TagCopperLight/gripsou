/**
 * The app scrolls inside `<main>` (RootLayout pins the shell to `h-dvh`), not
 * the window — and `<main>` belongs to the pathless `app` route, so it stays
 * mounted across navigations and would otherwise keep the previous page's
 * scrollTop. Naming it here lets the router reset/restore it like the window.
 */
export const MAIN_SCROLL_ID = "main";

export const MAIN_SCROLL_SELECTOR = `[data-scroll-restoration-id="${MAIN_SCROLL_ID}"]`;

/** Router options that make scroll behave: top on a new page, restored on back/forward. */
export const scrollRestorationOptions = {
  scrollRestoration: true,
  scrollToTopSelectors: [MAIN_SCROLL_SELECTOR],
};
