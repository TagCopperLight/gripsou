import type { ReactNode } from "react";

export function AuthPage({ children, note }: { children: ReactNode; note?: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-bg px-6 py-10">
      <div className="w-100 max-w-full">
        <div className="mb-8 sm:mb-15 text-center whitespace-nowrap font-wordmark text-[clamp(2.5rem,15vw,75px)] font-semibold tracking-tight text-fg">
          gripsou
        </div>
        {children}
        {note && <div className="mt-6 text-center text-xs text-fg-faint sm:text-sm">{note}</div>}
      </div>
    </div>
  );
}
