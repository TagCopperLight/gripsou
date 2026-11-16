import { useSyncExternalStore } from "react";

/** Tailwind's `md` breakpoint: below it the app uses its phone layout. Keep in step with `max-md:`/`md:` classes. */
const PHONE_QUERY = "(max-width: 47.99rem)";

export function isPhone(): boolean {
  return window.matchMedia(PHONE_QUERY).matches;
}

function subscribe(onChange: () => void) {
  const query = window.matchMedia(PHONE_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

/** For layout CSS can't express: chart options, routes, a different component tree. */
export function usePhone(): boolean {
  return useSyncExternalStore(subscribe, isPhone);
}
