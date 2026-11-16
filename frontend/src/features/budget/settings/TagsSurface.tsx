import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Plus } from "lucide-react";

import { SettingsSurface } from "../../../ui/SettingsSurface";
import { Bone, Skeleton } from "../../../ui/Skeleton";
import { boneWidths } from "../../../ui/boneWidths";
import { CardError } from "../../../ui/CardError";
import { Button } from "../../../ui/Button";
import { useBudgetTags } from "../../../api/budget";
import type { BudgetTag } from "../../../api/wire";
import { TagModal } from "./TagModal";
import { DeleteTagModal } from "./DeleteTagModal";
import { TagChip } from "../TagChip";

export function TagsSurface() {
  const { t } = useTranslation();
  const { data, isPending, isError, refetch } = useBudgetTags();
  const [editing, setEditing] = useState<BudgetTag | "new" | null>(null);
  const [deleting, setDeleting] = useState<BudgetTag | null>(null);

  return (
    <div>
      <SettingsSurface
        title={t("settings.budget.tags.title")}
        action={
          <Button
            onClick={() => setEditing("new")}
            disabled={isPending || isError}
            padded={false}
            className="inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap text-xs px-2.75 py-1.5"
          >
            <Plus className="size-4" />
            {t("settings.budget.tags.add")}
          </Button>
        }
      >
        {isError ? (
          <CardError onRetry={() => refetch()} className="h-40" />
        ) : isPending ? (
          <Skeleton className="flex flex-wrap gap-2">
            {boneWidths(4).map((w) => (
              <Bone key={w} className="h-6.5" style={{ width: w * 1.2 }} />
            ))}
          </Skeleton>
        ) : data.length === 0 ? (
          <p className="text-sm text-fg-faint">{t("settings.budget.tags.empty")}</p>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {data.map((tag) => (
              <li key={tag.id} className="max-w-full">
                <button
                  type="button"
                  aria-label={t("settings.budget.tags.edit", { name: tag.name })}
                  onClick={() => setEditing(tag)}
                  className="block max-w-full cursor-pointer rounded-md ring-fg-faint/50 transition duration-140 hover:ring-1 hover:brightness-125"
                >
                  <TagChip tag={tag} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </SettingsSurface>

      {editing && (
        <TagModal
          tag={editing === "new" ? undefined : editing}
          onClose={() => setEditing(null)}
          onDelete={(tag) => {
            setEditing(null);
            setDeleting(tag);
          }}
        />
      )}
      {deleting && <DeleteTagModal tag={deleting} onClose={() => setDeleting(null)} />}
    </div>
  );
}
