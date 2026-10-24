import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "@tanstack/react-router";
import { LogOut } from "lucide-react";
import { ConfirmDialog } from "./ConfirmDialog";
import { useAuth } from "../auth/context";

export function LogoutButton() {
  const { t } = useTranslation();
  const { logout } = useAuth();
  const navigate = useNavigate();
  const [confirming, setConfirming] = useState(false);

  const confirm = () => {
    logout();
    navigate({ to: "/login" });
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="flex w-full cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-red transition-colors hover:bg-red-soft"
      >
        <LogOut className="size-4.5" strokeWidth={2} />
        <span>{t("auth.logOut")}</span>
      </button>
      {confirming && (
        <ConfirmDialog
          title={t("auth.logOutConfirmTitle")}
          body={t("auth.logOutConfirmBody")}
          confirmLabel={t("auth.logOut")}
          onConfirm={confirm}
          onClose={() => setConfirming(false)}
        />
      )}
    </>
  );
}
