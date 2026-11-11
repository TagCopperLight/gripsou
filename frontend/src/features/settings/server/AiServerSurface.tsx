import { useTranslation } from "react-i18next";

import { SettingsSurface } from "../../../ui/SettingsSurface";
import { AiProviderFields } from "./AiProviderFields";

/** Settings → Server: the AI that categorises transactions. */
export function AiServerSurface() {
  const { t } = useTranslation();
  return (
    <SettingsSurface title={t("settings.server.budgetAi")} hint={t("settings.server.budgetAiHint")}>
      <AiProviderFields />
    </SettingsSurface>
  );
}
