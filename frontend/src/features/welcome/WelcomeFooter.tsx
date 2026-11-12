import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "../../ui/Button";

/** A welcome screen's buttons: Back on the left (none on the first screen),
 *  the screen's own on the right. */
export function WelcomeFooter({ onBack, children }: { onBack?: () => void; children: ReactNode }) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
      {onBack ? (
        <Button variant="ghost" padded={false} onClick={onBack}>
          {t("common.back")}
        </Button>
      ) : (
        <span />
      )}
      <div className="flex flex-wrap items-center justify-end gap-4">{children}</div>
    </div>
  );
}

/** Past a step without doing it. */
export function WelcomeSkip({ onClick, disabled }: { onClick: (() => void) | undefined; disabled?: boolean }) {
  const { t } = useTranslation();
  return (
    <Button variant="ghost" padded={false} onClick={onClick} disabled={disabled}>
      {t("welcome.skip")}
    </Button>
  );
}
