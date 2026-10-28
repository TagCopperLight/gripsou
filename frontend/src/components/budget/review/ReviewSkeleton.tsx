import { Surface } from "../../Surface";

/** The review queue while its rows load: the page's own shape in grey, four
 *  pulsing lines cut like `ReviewLine` (icon, name and date, amount, chip,
 *  confidence, the two buttons), so the real lines take their place. */
export function ReviewSkeleton({ title }: { title: string }) {
  const bone = "rounded-md bg-surface-3";
  return (
    <div data-testid="review-loading" aria-busy className="flex flex-col gap-4 motion-safe:animate-pulse">
      <div className="flex items-center gap-3">
        <span className={`h-3 w-30 ${bone}`} />
        <div className="h-1.5 w-1/2 rounded-full bg-surface-2" />
      </div>
      <Surface className="p-6">
        <h2 className="mb-4 text-lg font-semibold text-fg">{title}</h2>
        <div className="flex flex-col gap-2">
          {[46, 34, 52, 40].map((w) => (
            <div key={w} className="flex items-center gap-4 rounded-xl bg-surface-2 px-4 py-3">
              <span className="size-8 shrink-0 rounded-[10px] bg-surface-3" />
              <div className="min-w-0 flex-1">
                <div className={`mb-2 h-2.75 ${bone}`} style={{ width: `${w}%` }} />
                <div className={`h-2.25 ${bone}`} style={{ width: `${w * 0.6}%` }} />
              </div>
              <span className={`h-2.75 w-18 shrink-0 ${bone}`} />
              <span className="h-5.5 w-28 shrink-0 rounded-lg bg-surface-3" />
              <span className={`h-2.75 w-8 shrink-0 ${bone}`} />
              <span className="h-7 w-16 shrink-0 rounded-[10px] bg-surface-3" />
              <span className="h-7 w-16 shrink-0 rounded-[10px] bg-surface-3" />
            </div>
          ))}
        </div>
      </Surface>
    </div>
  );
}
