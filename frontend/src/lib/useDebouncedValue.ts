import { useCallback, useEffect, useRef, useState } from "react";

/** Delays the query-facing value by `delay`ms, without ever delaying `value`
 *  itself — callers keep the raw value for a fully responsive input and use
 *  the debounced one only for the expensive operation (here, a fetch).
 *  The second return value flushes the current input on explicit submission. */
export function useDebouncedValue<T>(value: T, delay: number) {
  const [debounced, setDebounced] = useState(value);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    timer.current = setTimeout(() => setDebounced(() => value), delay);
    return () => clearTimeout(timer.current);
  }, [value, delay]);
  const flush = useCallback(() => {
    clearTimeout(timer.current);
    setDebounced(() => value);
  }, [value]);
  return [debounced, flush] as const;
}
