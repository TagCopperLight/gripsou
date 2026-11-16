import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { TriangleAlert } from "lucide-react";

import { Dialog } from "./Dialog";
import { Button, type BusyProps } from "./Button";

type ConfirmDialogProps = BusyProps & {
  title: string;
  body: ReactNode;
  confirmLabel: string;
  tone?: "danger" | "warning";
  children?: ReactNode;
  confirmDisabled?: boolean;
  large?: boolean;
  onConfirm: () => void;
  onClose: () => void;
};

/** Cancel takes focus on open so a stray Enter backs out; with `children`, the field takes it. */
export function ConfirmDialog({
  title, body, confirmLabel, tone = "danger", busy, busyLabel, children, confirmDisabled = false, large = false,
  onConfirm, onClose,
}: ConfirmDialogProps) {
  const { t } = useTranslation();
  const actionBusy: BusyProps = busyLabel === undefined ? {} : { busy: busy ?? false, busyLabel };

  return (
    <Dialog
      large={large}
      busy={busy ?? false}
      title={title}
      onClose={onClose}
      icon={<TriangleAlert className={`size-5 ${tone === "danger" ? "text-red" : "text-amber"}`} />}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy ?? false}>
            {t("common.cancel")}
          </Button>
          <Button
            variant={tone === "danger" ? "danger" : "primary"}
            onClick={() => {
              if (!busy && !confirmDisabled) onConfirm();
            }}
            disabled={confirmDisabled}
            {...actionBusy}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <p className="text-sm text-fg-dim">
          {body}
        </p>
        {children}
      </div>
    </Dialog>
  );
}
