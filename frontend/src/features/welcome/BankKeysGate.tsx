import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { KeyRound } from "lucide-react";

import { Button } from "../../ui/Button";
import { useApiKeys, useProviders } from "../../api/admin";
import { groupState } from "./serverSetup";

/** The bank step's buttons, for an admin: while no bank provider that is
 *  turned on has its keys, connecting would fail, so it says so and offers
 *  the server setup instead. Until the keys are known, the buttons show. */
export function BankKeysGate({ skip, onSetUp, children }: { skip: ReactNode; onSetUp: () => void; children: ReactNode }) {
  const { t } = useTranslation();
  const keys = useApiKeys().data;
  const providers = useProviders().data;
  if (!keys || !providers || groupState("bank", keys, providers) === "ready") return children;

  return (
    <>
      <div className="flex gap-3 rounded-2xl bg-amber-soft px-4 py-3 text-[13px] leading-relaxed text-amber">
        <KeyRound className="mt-0.5 size-4 shrink-0" />
        <p>{t("welcome.bank.keysMissing")}</p>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
        {skip}
        <Button onClick={onSetUp}>{t("welcome.bank.setUpKeys")}</Button>
      </div>
    </>
  );
}
