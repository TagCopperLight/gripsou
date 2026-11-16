import { useTranslation } from "react-i18next";

import { SettingsSurface } from "../../../ui/SettingsSurface";
import { AiProviderFields } from "./AiProviderFields";

export function AiServerSurface() {
  const { t } = useTranslation();
  return (
    <SettingsSurface title={t("settings.server.budgetAi")} hint={t("settings.server.budgetAiHint")}>
      <AiProviderFields />
    </SettingsSurface>
  );
}
