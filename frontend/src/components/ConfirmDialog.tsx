import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { TriangleAlert } from "lucide-react";

import { Dialog } from "./Dialog";
import { Button } from "./Button";

type ConfirmDialogProps = {
  title: string;
  /** What will happen, in a sentence or two. */
  body: ReactNode;
  confirmLabel: string;
  /** `danger` for a deletion (red icon and button); `warning` for a write
   *  that is allowed but easy to regret (amber icon, plain button). */
  tone?: "danger" | "warning";
  busy?: boolean;
  /** Shown under the body when the confirmed action failed. */
  error?: string | null;
  onConfirm: () => void;
  onClose: () => void;
  "data-testid"?: string;
  confirmTestId?: string;
};

/** "Are you sure?" as one component: a sentence, Cancel, and one action.
 *  Cancel takes focus on open, so a stray Enter backs out instead of
 *  confirming. */
export function ConfirmDialog({
  title, body, confirmLabel, tone = "danger", busy = false, error = null,
  onConfirm, onClose, confirmTestId, ...rest
}: ConfirmDialogProps) {
  const { t } = useTranslation();

  return (
    <Dialog
      busy={busy}
      title={title}
      onClose={onClose}
      icon={<TriangleAlert className={`size-5 ${tone === "danger" ? "text-red" : "text-amber"}`} />}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            {t("common.cancel")}
          </Button>
          <Button
            variant={tone === "danger" ? "danger" : "primary"}
            data-testid={confirmTestId}
            onClick={() => {
              if (!busy) onConfirm();
            }}
            disabled={busy}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <p data-testid={rest["data-testid"]} className="text-sm text-fg-dim">
          {body}
        </p>
        {error && (
          <p role="alert" className="text-red text-sm">
            {error}
          </p>
        )}
      </div>
    </Dialog>
  );
}
