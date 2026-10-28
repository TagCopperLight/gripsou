import { useState } from "react";
import { useTranslation } from "react-i18next";
import { PageHeader } from "../components/PageHeader";
import { AccountsChartCard } from "../components/AccountsChartCard";
import { AccountsList } from "../components/AccountsList";

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
