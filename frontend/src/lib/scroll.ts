/** The app scrolls inside `<main>`, not the window, and `<main>` survives
 *  navigation: naming it lets the router reset and restore its scrollTop. */
export const MAIN_SCROLL_ID = "main";

export const MAIN_SCROLL_SELECTOR = `[data-scroll-restoration-id="${MAIN_SCROLL_ID}"]`;

export const scrollRestorationOptions = {
  scrollRestoration: true,
  scrollToTopSelectors: [MAIN_SCROLL_SELECTOR],
};
