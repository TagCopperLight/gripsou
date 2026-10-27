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
  /** A field to fill before confirming (a password, the email typed back),
   *  shown under the body. */
  children?: ReactNode;
  /** Keeps the action off until `children` is filled in. */
  confirmDisabled?: boolean;
  onConfirm: () => void;
  onClose: () => void;
  "data-testid"?: string;
  confirmTestId?: string;
};

/** "Are you sure?" as one component: a sentence, Cancel, and one action.
 *  Cancel takes focus on open, so a stray Enter backs out instead of
 *  confirming; with a field to fill (`children`), the field takes it. */
export function ConfirmDialog({
  title, body, confirmLabel, tone = "danger", busy = false, children, confirmDisabled = false,
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
              if (!busy && !confirmDisabled) onConfirm();
            }}
            disabled={busy || confirmDisabled}
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
        {children}
      </div>
    </Dialog>
  );
}
