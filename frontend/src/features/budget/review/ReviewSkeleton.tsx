import { Surface } from "../../../ui/Surface";
import { AMOUNT_COL, CHIP_COL, CONFIDENCE_COL, REVIEW_ROW } from "./reviewColumns";

/** The review queue while its rows load: the page's own shape in grey, four
 *  pulsing lines in `ReviewLine`'s columns, so the real lines take their place. */
export function ReviewSkeleton({ title }: { title: string }) {
  const bone = "rounded-md bg-surface-3";
  const button = "h-9.5 w-20 shrink-0 rounded-xl bg-surface-3";
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
            <div key={w} className={REVIEW_ROW}>
              <span className="size-8 shrink-0 rounded-lg bg-surface-3" />
              <div className="min-w-0 flex-1">
                <div className={`mb-2 h-2.75 ${bone}`} style={{ width: `${w}%` }} />
                <div className={`h-2.25 ${bone}`} style={{ width: `${w * 0.6}%` }} />
              </div>
              <span className={`${AMOUNT_COL} flex justify-end`}>
                <span className={`h-2.75 w-18 ${bone}`} />
              </span>
              <span className={CHIP_COL}>
                <span className="h-5.5 w-28 rounded-lg bg-surface-3" />
              </span>
              <span className={`${CONFIDENCE_COL} flex justify-end`}>
                <span className={`h-2.75 w-8 ${bone}`} />
              </span>
              <span className={button} />
              <span className={button} />
            </div>
          ))}
        </div>
      </Surface>
    </div>
  );
}
