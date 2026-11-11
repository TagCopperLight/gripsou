import { useTranslation } from "react-i18next";

import { useSetApiKey } from "../../../api/admin";
import { useErrorToast } from "../../../lib/errorToasts";

/** Saves one provider's field; `onSaved` runs once the server took it. */
export type SaveKey = (field: string, value: string | null, onSaved?: () => void) => void;

/** The save behind every key field, with its error toast. */
export function useSaveKey(): (provider: string) => SaveKey {
  const { t } = useTranslation();
  const save = useSetApiKey();
  useErrorToast(save.isError && t("settings.server.apiKeys.saveError"));
  // Not mutate's onSuccess: it only fires for the latest call, and two fields
  // can be saving at once. A failure shows through save.isError.
  return (provider) => (field, value, onSaved) =>
    void save.mutateAsync({ provider, field, value }).then(onSaved, () => {});
}
