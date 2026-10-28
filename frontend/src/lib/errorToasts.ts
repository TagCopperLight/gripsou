import { useEffect, useRef, useSyncExternalStore } from "react";

/** `detail` is the line under the title: "Try again in a moment." when
 *  undefined, none when null. `done` is a finished action, in green. */
export type ErrorToast = { id: number; title: string; detail?: string | null; done?: boolean };

let toasts: ErrorToast[] = [];
let next = 1;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

/** How long a message stays when nobody closes it. */
const SHOWN_MS = 5000;

/** Shows a failed action in the corner of the screen for a few seconds, or
 *  until it's closed. The same message twice moves to the front rather than
 *  stacking. */
export function showError(title: string, detail?: string | null): number {
  return show({ title, detail });
}

/** A finished action that changed things out of sight ("12 rows updated"),
 *  in the same corner, in green. */
export function showDone(title: string): number {
  return show({ title, detail: null, done: true });
}

function show(toast: Omit<ErrorToast, "id">): number {
  const id = next++;
  toasts = [...toasts.filter((t) => t.title !== toast.title), { id, ...toast }];
  emit();
  setTimeout(() => dismissError(id), SHOWN_MS);
  return id;
}

export function dismissError(id: number): void {
  toasts = toasts.filter((t) => t.id !== id);
  emit();
}

/** Closes every message: the tests start each case from none. */
export function clearErrors(): void {
  toasts = [];
  emit();
}

export function useErrorToasts(): ErrorToast[] {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => toasts,
  );
}

/** Shows `message` as an error each time it turns up, for an action whose
 *  failure the component already tracks. Its turning back to nothing (the
 *  action tried again, or a later one went through) closes it; the component
 *  going away doesn't, so a window's failure outlives the window. */
export function useErrorToast(message: string | null | false | undefined, detail?: string | null): void {
  const shown = useRef<number | null>(null);
  useEffect(() => {
    if (shown.current !== null) dismissError(shown.current);
    shown.current = message ? showError(message, detail) : null;
  }, [message, detail]);
}
