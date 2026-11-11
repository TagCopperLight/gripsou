import { useTranslation } from "react-i18next";

import { SettingsSurface } from "../../../ui/SettingsSurface";
import { CardState } from "../../../ui/CardState";
import { useApiKeys } from "../../../api/admin";
import type { ApiKeyProvider } from "../../../api/wire";
import { KeyFieldList } from "./KeyFields";
import { useSaveKey, type SaveKey } from "./useSaveKey";

/** Settings → Server: the values each provider needs (Powens, the AI, logos).
 *  Each field saves on its own: a plain one on Enter or when it loses focus,
 *  a secret only on Enter or its Save button. A saved secret never comes back
 *  from the server, so it shows as dots until it is replaced or removed. */
export function ApiKeysSurface() {
  const { t } = useTranslation();
  const query = useApiKeys();
  const saveKey = useSaveKey();

  return (
    <SettingsSurface title={t("settings.server.apiKeys.title")}>
      {!query.data ? (
        <CardState
          variant={query.isError ? "error" : "loading"}
          onRetry={() => void query.refetch()}
          className="h-64"
        />
      ) : (
        <div className="flex flex-col divide-y divide-surface-2">
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
    <div className="flex flex-col gap-4 py-5 first:pt-0 last:pb-0">
      <span className="text-sm font-medium text-fg">{provider.displayName}</span>
      <KeyFieldList fields={provider.fields} save={save} />
    </div>
  );
}
