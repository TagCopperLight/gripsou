import { useTranslation } from "react-i18next";

import { ErrorState } from "../../../ui/ErrorState";
import { Button } from "../../../ui/Button";
import { Dialog } from "../../../ui/Dialog";
import { CopyField } from "../../../ui/CopyField";

type LinkModalProps = {
  title: string;
  subtitle: string;
  body: string;
  link: string | null; // null while the token is still being generated
  /** The link could not be made. */
  error?: boolean;
  onClose: () => void;
};

export function LinkModal({ title, subtitle, body, link, error = false, onClose }: LinkModalProps) {
  const { t } = useTranslation();

  return (
    <Dialog
      title={title}
      subtitle={subtitle}
      onClose={onClose}
      footer={<Button onClick={onClose}>{t("settings.users.done")}</Button>}
    >
      <p className="text-sm text-fg-dim">{body}</p>
      {error ? (
        <ErrorState title={t("settings.users.linkError")} detail={t("common.tryAgain")} className="mt-4 py-4" />
      ) : (
        <div className="mt-4">
          <CopyField value={link} label={t("settings.users.copyLink")} pending={t("common.loading")} />
        </div>
      )}
    </Dialog>
  );
}
