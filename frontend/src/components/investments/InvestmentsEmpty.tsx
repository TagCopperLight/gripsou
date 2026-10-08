import { useTranslation } from "react-i18next";
import { useNavigate } from "@tanstack/react-router";
import { ChartPie, Unplug } from "lucide-react";

import { Surface } from "../Surface";
import { Button } from "../Button";

type InvestmentsEmptyProps = {
  /** "noConnection": nothing is connected at all. "empty": connected, but no
   *  account holds a security (cash doesn't count on this page). */
  variant: "noConnection" | "empty";
};

/** Stands in for the whole page when there is nothing to show. */
export function InvestmentsEmpty({ variant }: InvestmentsEmptyProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const Icon = variant === "noConnection" ? Unplug : ChartPie;

  return (
    <Surface className="mt-4 flex flex-col items-center gap-2 p-16">
      <Icon className="size-6 text-fg-faint" />
      <p className="text-fg text-sm font-medium">{t(`investments.${variant}.title`)}</p>
      <p className="max-w-md text-center text-sm text-fg-faint">{t(`investments.${variant}.body`)}</p>
      {variant === "noConnection" && (
        <Button className="mt-3" onClick={() => navigate({ to: "/settings/connections" })}>
          {t("investments.noConnection.action")}
        </Button>
      )}
    </Surface>
  );
}
