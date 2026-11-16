import { useTranslation } from "react-i18next";

import { Surface } from "../../../ui/Surface";
import { Bone, Skeleton, TextBone } from "../../../ui/Skeleton";
import { AMOUNT_COL, CHIP_COL, CONFIDENCE_COL, REVIEW_ROW } from "./reviewColumns";
import { boneWidths } from "../../../ui/boneWidths";

/** The review queue while its rows load: the progress line's count and up to
 *  four lines in `ReviewLine`'s columns as bones, under the real title and
 *  bar. `queued` is the server's queue size when already known (it drives the
 *  Review tab): an empty queue is drawn as the empty state's card instead. */
export function ReviewSkeleton({ queued }: { queued?: number }) {
  const { t } = useTranslation();
  // A `Button`'s height: a text-sm line in py-2.25.
  const button = "h-9.5 w-20 shrink-0 rounded-xl";
  if (queued === 0) {
    return (
      <Surface className="h-55">
        <Skeleton className="flex h-full flex-col items-center justify-center gap-2.5">
          <Bone className="size-10 rounded-xl" />
          <div className="flex flex-col items-center gap-0.5">
            <TextBone text="text-sm" className="w-24" />
            <TextBone text="text-xs" className="w-56" />
          </div>
          {/* The outline button: a text-xs line in py-1.5, and its mt-1. */}
          <Bone className="mt-1 h-7 w-32 rounded-lg" />
        </Skeleton>
      </Surface>
    );
  }
  // An unknown queue shows as many rows as a long list.
  const widths = boneWidths(queued ?? 4);
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <Skeleton>
          <TextBone text="text-sm" className="w-30" />
        </Skeleton>
        <div className="h-1.5 w-1/2 rounded-full bg-surface-2" />
      </div>
      <Surface className="p-6">
        <h2 className="mb-4 text-lg font-semibold text-fg">{t("budget.review.title")}</h2>
        <Skeleton className="flex flex-col gap-2">
          {widths.map((w) => (
            <div key={w} className={REVIEW_ROW}>
              <Bone className="size-8 shrink-0 rounded-lg" />
              <div className="min-w-0 flex-1">
                <TextBone text="text-sm" style={{ width: `${w}%` }} />
                <TextBone text="text-xs" style={{ width: `${w * 0.6}%` }} />
              </div>
              <span className={`${AMOUNT_COL} flex justify-end`}>
                <TextBone text="text-sm" className="w-18" />
              </span>
              <span className={CHIP_COL}>
                {/* A category chip: a text-xs line in py-1. */}
                <Bone className="h-6 w-28 rounded-xl" />
              </span>
              <span className={`${CONFIDENCE_COL} flex justify-end`}>
                <TextBone text="text-sm" className="w-8" />
              </span>
              <Bone className={button} />
              <Bone className={button} />
            </div>
          ))}
        </Skeleton>
      </Surface>
    </div>
  );
}
