import { useCallback, useLayoutEffect, useRef, useState } from "react";

type Open<K> = { key: K; anchor: HTMLElement } | null;

/** Which floating panel (`FloatingPanel`) a set of triggers has open, and the
 *  trigger it hangs under. A panel lets a press on its own anchor through, so
 *  the trigger toggles it here: pressed again it closes, and a press on
 *  another trigger opens that one instead. `onClose` runs whenever the open
 *  panel goes away, whatever closed it. `toggle` and `close` keep their
 *  identity, for memoised rows. */
export function usePopover<K extends string = "open">(onClose?: () => void) {
  const [open, setOpen] = useState<Open<K>>(null);
  const openRef = useRef<Open<K>>(open);
  const onCloseRef = useRef(onClose);
  useLayoutEffect(() => {
    openRef.current = open;
    onCloseRef.current = onClose;
  }, [open, onClose]);

  const set = useCallback((next: Open<K>) => {
    if (openRef.current) onCloseRef.current?.();
    openRef.current = next;
    setOpen(next);
  }, []);
  const toggle = useCallback(
    (key: K, anchor: HTMLElement) => set(openRef.current?.key === key ? null : { key, anchor }),
    [set],
  );
  const close = useCallback(() => set(null), [set]);

  return { key: open?.key ?? null, anchor: open?.anchor ?? null, toggle, close };
}
