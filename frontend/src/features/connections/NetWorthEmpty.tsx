import { useTranslation } from "react-i18next";
import { useNavigate } from "@tanstack/react-router";
import { ChartLine, Loader2 } from "lucide-react";

import { Button } from "../../ui/Button";
import { Bone, Skeleton, TextBone } from "../../ui/Skeleton";
import { useConnections } from "../../api/connections";
import { netWorthEmptyKind } from "../../lib/connectionState";

/** Stands in for the net worth chart while the user has no accounts. Only
 *  mounted then, so the dashboard doesn't read the connections otherwise. */
export function NetWorthEmpty({ className = "" }: { className?: string }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { data, isError } = useConnections();
  if (data === undefined && !isError) {
    // The message's shape: in nearly every case it offers a button.
    return (
      <Skeleton className={`flex flex-col items-center justify-center gap-2 ${className}`}>
        <Bone className="size-6" />
        <TextBone text="text-sm" className="w-40" />
        <TextBone text="text-sm" className="w-72 max-w-full" />
        <Bone className="mt-2 h-9.5 w-36 rounded-xl" />
      </Skeleton>
    );
  }

  // Unreachable connections: the points already say there are no accounts,
  // and Settings · Connections is where to look either way.
  const kind = netWorthEmptyKind(data ?? []);
  const Icon = kind === "syncing" ? Loader2 : ChartLine;
  return (
    <div className={`flex flex-col items-center justify-center gap-2 text-center ${className}`}>
      <Icon className={`size-6 text-fg-faint ${kind === "syncing" ? "animate-spin" : ""}`} />
      <p className="text-fg text-sm font-medium">{t(`dashboard.netWorth.empty.${kind}.title`)}</p>
      <p className="max-w-md text-sm text-fg-faint">{t(`dashboard.netWorth.empty.${kind}.body`)}</p>
      {kind !== "syncing" && (
        <Button variant="outline" className="mt-2" onClick={() => navigate({ to: "/settings/connections" })}>
          {t(`dashboard.netWorth.empty.${kind}.action`)}
        </Button>
      )}
    </div>
  );
}
