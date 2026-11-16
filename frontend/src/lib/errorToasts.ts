import { useEffect, useRef, useSyncExternalStore } from "react";

/** `detail` is the line under the title: "Try again in a moment." when undefined, none when null. */
export type ErrorToast = { id: number; title: string; detail?: string | null; done?: boolean };

let toasts: ErrorToast[] = [];
let next = 1;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

const SHOWN_MS = 5000;

export function showError(title: string, detail?: string | null): number {
  return show({ title, detail });
}

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

/** The component going away doesn't close the message, so a window's failure outlives the window. */
export function useErrorToast(message: string | null | false | undefined, detail?: string | null): void {
  const shown = useRef<number | null>(null);
  useEffect(() => {
    if (shown.current !== null) dismissError(shown.current);
    shown.current = message ? showError(message, detail) : null;
  }, [message, detail]);
}
