import { useState } from "react";
import { useTranslation } from "react-i18next";
import { PageHeader } from "../../ui/PageHeader";
import { AccountsChartCard } from "./AccountsChartCard";
import { AccountsList } from "./AccountsList";

export function Accounts() {
  const { t } = useTranslation();
  // The account under the pointer, in the legend, the bar or the list: the
  // chart brings its band forward.
  const [hovered, setHovered] = useState<string | null>(null);
  return (
    <div>
      <PageHeader title={t("nav.accounts")} />
      <AccountsChartCard className="my-4" highlight={hovered} onHover={setHovered} />
      <AccountsList className="mb-4" onHover={setHovered} />
    </div>
  );
}
