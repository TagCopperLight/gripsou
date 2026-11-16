import { useTranslation } from "react-i18next";

import { SettingsSurface } from "../../../ui/SettingsSurface";
import { CardError } from "../../../ui/CardError";
import { Bone, Skeleton, TextBone } from "../../../ui/Skeleton";
import { useApiKeys } from "../../../api/admin";
import type { ApiKeyProvider } from "../../../api/wire";
import { KeyFieldList } from "./KeyFields";
import { useSaveKey, type SaveKey } from "./useSaveKey";

/** Settings → Server: the values each provider needs (Powens, the AI, logos).
 *  Each field saves on its own: a plain one on Enter or when it loses focus,
 *  a secret only on Enter or its Save button. A saved secret never comes back
 *  from the server, so it shows as dots until it is replaced or removed. */
const PROVIDERS = "flex flex-col divide-y divide-surface-2";
const PROVIDER = "flex flex-col gap-4 py-5 first:pt-0 last:pb-0";

export function ApiKeysSurface() {
  const { t } = useTranslation();
  const query = useApiKeys();
  const saveKey = useSaveKey();

  return (
    <SettingsSurface title={t("settings.server.apiKeys.title")}>
      {query.isError ? (
        <CardError onRetry={() => void query.refetch()} className="h-64" />
      ) : query.isPending ? (
        <Skeleton className={PROVIDERS}>
          {Array.from({ length: 3 }, (_, i) => (
            <div key={i} className={PROVIDER}>
              <TextBone text="text-sm" className="w-20" />
              <div className="flex flex-col gap-2">
                <TextBone text="text-sm" className="w-28" />
                <Bone className="h-9.5 rounded-xl" />
              </div>
            </div>
          ))}
        </Skeleton>
      ) : (
        <div className={PROVIDERS}>
          {query.data.map((p) => (
            <ProviderKeys
              key={p.key}
              provider={p}
              save={saveKey(p.key)}
            />
          ))}
        </div>
      )}
    </SettingsSurface>
  );
}

function ProviderKeys({ provider, save }: { provider: ApiKeyProvider; save: SaveKey }) {
  return (
    <div className={PROVIDER}>
      <span className="text-sm font-medium text-fg">{provider.displayName}</span>
      <KeyFieldList fields={provider.fields} save={save} />
    </div>
  );
}
