import { useEffect, useState } from "react";

/** Delays the query-facing value by `delay`ms, without ever delaying `value`
 *  itself — callers keep the raw value for a fully responsive input and use
 *  the debounced one only for the expensive operation (here, a fetch). */
export function useDebouncedValue<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(id);
  }, [value, delay]);
  return debounced;
}
