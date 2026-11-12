import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { KeyRound } from "lucide-react";

import { Button } from "../../ui/Button";
import { WelcomeFooter } from "./WelcomeFooter";

/** The bank step's buttons for an admin whose server has no working bank
 *  keys: it says so and offers the bank keys' screen instead. */
export function BankKeysGate({ skip, onBack, onSetUp }: { skip: ReactNode; onBack: () => void; onSetUp: () => void }) {
  const { t } = useTranslation();
  return (
    <>
      <div className="flex gap-3 rounded-2xl bg-amber-soft px-4 py-3 text-[13px] leading-relaxed text-amber">
        <KeyRound className="mt-0.5 size-4 shrink-0" />
        <p>{t("welcome.bank.keysMissing")}</p>
      </div>
      <WelcomeFooter onBack={onBack}>
        {skip}
        <Button onClick={onSetUp}>{t("welcome.bank.setUpKeys")}</Button>
      </WelcomeFooter>
    </>
  );
}
