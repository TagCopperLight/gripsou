import { useCallback, useEffect, useLayoutEffect, useRef } from "react";

/** Nearest scrollable ancestor, which is the element an IntersectionObserver
 *  has to use as its root for `rootMargin` to mean anything. Resolved by
 *  walking the DOM rather than hard-coding the shell's `<main>`, so moving a
 *  list somewhere else cannot quietly turn preloading back off. null (no
 *  scrollable ancestor) is the observer's default: the viewport. */
function scrollParent(node: Element): Element | null {
  for (let el = node.parentElement; el; el = el.parentElement) {
    const overflowY = getComputedStyle(el).overflowY;
    if (overflowY === "auto" || overflowY === "scroll") return el;
  }
  return null;
}

/** Infinite scroll: a ref for an empty element after a list's last row; the
 *  next page loads while it is within two screens of view.
 *
 *  One observer per mounted sentinel, never per render: a list re-renders on
 *  every keystroke and click, and a fresh observer reports its first reading
 *  at once — pages would load because something rendered, not because the
 *  user scrolled. The callback reads the latest values through a ref instead. */
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
  // A page just landed: the sentinel may still be in range (a short page, a
  // tall window), and an observer only reports changes. Observing again asks
  // for one fresh reading of where it stands now.
  useEffect(() => {
    const o = observed.current;
    if (!o || !hasNextPage || fetchingNextPage) return;
    o.observer.unobserve(o.node);
    o.observer.observe(o.node);
  }, [hasNextPage, fetchingNextPage]);
  return sentinel;
}
