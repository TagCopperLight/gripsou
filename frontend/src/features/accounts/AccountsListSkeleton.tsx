import { useTranslation } from "react-i18next";

import { Surface } from "../../ui/Surface";
import { CardTitle } from "../../ui/CardTitle";
import { Bone, Skeleton, TextBone } from "../../ui/Skeleton";
import { boneWidths } from "../../ui/boneWidths";

export function AccountsListSkeleton({ className = "" }: { className?: string }) {
  const { t } = useTranslation();
  return (
    <section className={`flex flex-col gap-4 ${className}`}>
      <Surface className="p-4 md:p-5">
        <div className="flex items-center justify-between gap-4">
          <CardTitle>{t("account.allAccounts")}</CardTitle>
          <Skeleton>
            <TextBone text="text-sm" className="w-24" />
          </Skeleton>
        </div>
        <Skeleton className="mt-3">
          <Bone className="h-2.5 rounded-full" />
        </Skeleton>
      </Surface>
      <Surface className="p-4 pb-3.5 md:p-5 md:pb-4.5">
        <Skeleton>
          <div className="flex items-center gap-2.5 pb-[9.5px]">
            <Bone className="size-6 shrink-0 rounded-md" />
            <TextBone text="text-sm" className="w-28" />
            <TextBone text="ml-auto text-sm" className="w-20" />
          </div>
          <ul className="-mx-2">
            {boneWidths(2).map((w) => (
              <li key={w} className="border-t border-surface-2 first:border-t-0">
                <div className="grid grid-cols-[1fr_auto_auto] items-center gap-3 py-2.5 pr-2 pl-5 sm:grid-cols-[1fr_auto_auto_auto] md:grid-cols-[1fr_auto_11rem_8rem]">
                  <span className="flex min-w-0 items-center gap-2.5">
                    <Bone className="size-2.5 shrink-0 rounded-[3px]" />
                    <TextBone text="flex-1 text-[13px]" style={{ width: `${w}%` }} />
                  </span>
                  <Bone className="hidden h-4.5 w-16 sm:block" />
                  <span className="flex items-center gap-3">
                    <Bone className="hidden h-1 flex-1 rounded-full md:block" />
                    <Bone className="ml-auto h-2.5 w-10" />
                  </span>
                  <TextBone text="text-[13px]" className="ml-auto w-20" />
                </div>
              </li>
            ))}
          </ul>
        </Skeleton>
      </Surface>
    </section>
  );
}
