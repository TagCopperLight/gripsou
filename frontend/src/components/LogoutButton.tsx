import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "@tanstack/react-router";
import { LogOut } from "lucide-react";
import { Button } from "./Button";
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
        className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-red transition-colors hover:bg-red-soft"
      >
        <LogOut className="size-4.5" strokeWidth={2} />
        <span>{t("auth.logOut")}</span>
      </button>
      {confirming && (
        <ConfirmModal onCancel={() => setConfirming(false)} onConfirm={confirm} />
      )}
    </>
  );
}

function ConfirmModal({
  onCancel,
  onConfirm,
}: {
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const { t } = useTranslation();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onCancel]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={onCancel}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t("auth.logOutConfirmTitle")}
        onClick={(e) => e.stopPropagation()}
        className="relative w-96 max-w-[90vw] rounded-3xl bg-surface p-6"
      >
        <h2 className="text-xl font-semibold text-fg">{t("auth.logOutConfirmTitle")}</h2>
        <p className="mt-2 text-sm text-fg-dim">{t("auth.logOutConfirmBody")}</p>
        <div className="mt-6 flex items-center justify-end gap-2">
          <Button variant="ghost" onClick={onCancel}>
            {t("common.cancel")}
          </Button>
          <Button variant="danger" onClick={onConfirm}>
            {t("auth.logOut")}
          </Button>
        </div>
      </div>
    </div>
  );
}
