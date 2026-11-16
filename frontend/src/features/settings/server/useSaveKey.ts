import { useTranslation } from "react-i18next";

import { useSetApiKey } from "../../../api/admin";
import { useErrorToast } from "../../../lib/errorToasts";

export type SaveKey = (field: string, value: string | null, onSaved?: () => void) => Promise<void>;

export function useSaveKey(): (provider: string) => SaveKey {
  const { t } = useTranslation();
  const save = useSetApiKey();
  useErrorToast(save.isError && t("settings.server.apiKeys.saveError"));
  // Not mutate's onSuccess: it only fires for the latest call, and two fields can be saving at once.
  return (provider) => (field, value, onSaved) =>
    save.mutateAsync({ provider, field, value }).then(onSaved, () => {});
}
