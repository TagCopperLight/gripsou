import { useCallback, useEffect, useLayoutEffect, useRef } from "react";

/** Nearest scrollable ancestor: the IntersectionObserver root `rootMargin` needs.
 *  Walked, not hard-coded to `<main>`. null means the viewport. */
function scrollParent(node: Element): Element | null {
  for (let el = node.parentElement; el; el = el.parentElement) {
    const overflowY = getComputedStyle(el).overflowY;
    if (overflowY === "auto" || overflowY === "scroll") return el;
  }
  return null;
}

/** Ref for an empty element after the last row; the next page loads within two
 *  screens of it. One observer per sentinel, never per render: a fresh observer
 *  reports at once and would load pages on re-render. */
export function useLoadOnScroll(hasNextPage: boolean, fetchingNextPage: boolean, onLoadMore: () => void) {
  const latest = useRef({ hasNextPage, fetchingNextPage, onLoadMore });
  useLayoutEffect(() => {
    latest.current = { hasNextPage, fetchingNextPage, onLoadMore };
  });
  const observed = useRef<{ observer: IntersectionObserver; node: Element } | null>(null);
  const sentinel = useCallback((node: HTMLDivElement | null) => {
    if (!node || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        const { hasNextPage: more, fetchingNextPage: busy, onLoadMore: load } = latest.current;
        if (entries.some((e) => e.isIntersecting) && more && !busy) load();
      },
      { root: scrollParent(node), rootMargin: "2000px 0px" },
    );
    observer.observe(node);
    observed.current = { observer, node };
    return () => {
      observer.disconnect();
      observed.current = null;
    };
  }, []);
// An observer only reports changes: observing again forces a fresh reading after a page lands.
  useEffect(() => {
    const o = observed.current;
    if (!o || !hasNextPage || fetchingNextPage) return;
    o.observer.unobserve(o.node);
    o.observer.observe(o.node);
  }, [hasNextPage, fetchingNextPage]);
  return sentinel;
}
