import { useCallback, useEffect, useRef, useState } from "react";

/** Delays the returned value, never `value` itself. The second return flushes on submit. */
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
