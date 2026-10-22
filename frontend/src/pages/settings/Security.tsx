import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ChevronRight } from "lucide-react";

import { Surface } from "../../components/Surface";
import { Button } from "../../components/Button";
import { Dialog } from "../../components/Dialog";
import { ReauthModal } from "../../components/ReauthModal";
import { TotpSetupModal } from "../../components/TotpSetupModal";
import { BackupCodesView } from "../../components/BackupCodesView";
import { SessionDetailModal } from "../../components/SessionDetailModal";
import {
  useChangePassword,
  useMfaStatus,
  useRemoveTotp,
  useRegenerateRecovery,
  useSessions,
  useRevokeSession,
  useRevokeOtherSessions,
} from "../../api/hooks";
import { ApiError } from "../../api/client";
import type { Session } from "../../api/types";
import { formatDate, formatRelative } from "../../lib/date";
import { passwordLengthOk } from "../../lib/password";

export function SettingsSecurity() {
  const { t } = useTranslation();

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPasswordValue] = useState("");
  // Set when "Update password" is clicked with a new password breaking the
  // length rule; editing the new password clears it.
  const [lengthError, setLengthError] = useState(false);
  const setNewPassword = (value: string) => {
    setNewPasswordValue(value);
    setLengthError(false);
  };
  const [confirmPassword, setConfirmPassword] = useState("");
  const changePassword = useChangePassword();

  const passwordsMismatch =
    confirmPassword !== "" && newPassword !== confirmPassword;
  const canUpdatePassword =
    currentPassword !== "" &&
    newPassword !== "" &&
    newPassword === confirmPassword;


  const updatePassword = () => {
    if (!canUpdatePassword) return;
    if (!passwordLengthOk(newPassword)) {
      setLengthError(true);
      return;
    }
    changePassword.mutate(
      { currentPassword, newPassword },
      {
        onSuccess: () => {
          setCurrentPassword("");
          setNewPassword("");
          setConfirmPassword("");
        },
      },
    );
  };

  const { data: sessions = [] } = useSessions();
  const revokeSession = useRevokeSession();
  const revokeOthers = useRevokeOtherSessions();
  const hasOthers = sessions.some((s) => !s.current);


  const { data: mfa } = useMfaStatus();
  const removeTotp = useRemoveTotp();
  const regenerate = useRegenerateRecovery();
  // What the password prompt is for; the token it earns is spent right away.
  const [asking, setAsking] = useState<null | "setup" | "remove" | "regenerate">(null);
  const [setupToken, setSetupToken] = useState<string | null>(null);
  const [newCodes, setNewCodes] = useState<string[] | null>(null);
  const [mfaError, setMfaError] = useState<null | "expired" | "failed">(null);

  const failWith = (err: unknown) =>
    setMfaError(err instanceof ApiError && err.status === 401 ? "expired" : "failed");
  const onReauthed = (token: string) => {
    const action = asking;
    setAsking(null);
    setMfaError(null);
    if (action === "setup") setSetupToken(token);
    else if (action === "remove") removeTotp.mutate(token, { onError: failWith });
    else if (action === "regenerate")
      regenerate.mutate(token, {
        onSuccess: (res) => setNewCodes(res.recoveryCodes),
        onError: failWith,
      });
  };
  const ask = (action: "setup" | "remove" | "regenerate") => {
    setMfaError(null);
    setAsking(action);
  };
  const mfaBusy = removeTotp.isPending || regenerate.isPending;

  const [detail, setDetail] = useState<Session | null>(null);

  return (
    <div className="flex flex-col gap-4 pb-8 md:mt-13">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 md:items-stretch">
      <Surface className="p-6 h-full flex flex-col">
        <h2 className="mb-5 text-lg font-semibold text-fg">
          {t("settings.account.password")}
        </h2>
        <div className="flex flex-1 flex-col gap-5">
          <Field label={t("settings.account.currentPassword")}>
            <TextInput
              type="password"
              value={currentPassword}
              onChange={setCurrentPassword}
              ariaLabel={t("settings.account.currentPassword")}
            />
          </Field>
          <Field label={t("settings.account.newPassword")}>
            <TextInput
              type="password"
              value={newPassword}
              onChange={setNewPassword}
              ariaLabel={t("settings.account.newPassword")}
            />
          </Field>
          <Field label={t("settings.account.confirmNewPassword")}>
            <TextInput
              type="password"
              value={confirmPassword}
              onChange={setConfirmPassword}
              ariaLabel={t("settings.account.confirmNewPassword")}
            />
          </Field>
          {lengthError && <p className="text-sm text-red">{t("auth.passwordLength")}</p>}
          {passwordsMismatch && (
            <p className="text-sm text-red">{t("settings.account.passwordsDoNotMatch")}</p>
          )}
          {changePassword.isSuccess && (
            <p className="text-sm text-green">{t("settings.account.passwordUpdated")}</p>
          )}
          {changePassword.isError && (
            <p className="text-sm text-red">
              {t("settings.account.currentPasswordIncorrect")}
            </p>
          )}
          <div className="mt-auto flex justify-end pt-1">
            <Button
              onClick={updatePassword}
              disabled={!canUpdatePassword || changePassword.isPending}
            >
              {t("settings.account.updatePassword")}
            </Button>
          </div>
        </div>
      </Surface>

      <Surface className="p-6 h-full flex flex-col">
        <h2 className="mb-1 text-lg font-semibold text-fg">{t("settings.security.twoFactor")}</h2>
        <p className="mb-5 text-sm text-fg-faint">{t("settings.security.twoFactorDescription")}</p>
        {mfa && (
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between gap-4 rounded-xl bg-surface-2 px-4 py-3">
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <span className="text-[15px] text-fg">{t("settings.security.authenticatorApp")}</span>
                {mfa.totp && (
                  <span className="rounded-md bg-green-soft px-2 py-0.5 text-xs font-medium text-green">
                    {t("settings.security.on")}
                  </span>
                )}
                {!mfa.available && !mfa.totp && (
                  <span className="text-sm text-fg-faint">{t("settings.security.totpUnavailable")}</span>
                )}
              </div>
              {mfa.totp ? (
                <Button
                  variant="ghost"
                  onClick={() => ask("remove")}
                  disabled={mfaBusy}
                  className="shrink-0 text-red hover:text-red"
                >
                  {t("settings.security.remove")}
                </Button>
              ) : (
                mfa.available && (
                  <Button variant="ghost" onClick={() => ask("setup")} className="shrink-0">
                    {t("settings.security.setUp")}
                  </Button>
                )
              )}
            </div>
            {mfa.totp && (
              <div className="flex items-center justify-between gap-4 rounded-xl bg-surface-2 px-4 py-3">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <span className="text-[15px] text-fg">{t("settings.security.backupCodes")}</span>
                  <span className="text-sm text-fg-faint">
                    {t("settings.security.codesLeft", { count: mfa.recoveryRemaining })}
                  </span>
                </div>
                <Button
                  variant="ghost"
                  onClick={() => ask("regenerate")}
                  disabled={mfaBusy}
                  className="shrink-0"
                >
                  {t("settings.security.regenerate")}
                </Button>
              </div>
            )}
            {mfaError && (
              <p className="text-sm text-red">
                {mfaError === "expired"
                  ? t("settings.security.reauthExpired")
                  : t("settings.security.actionFailed")}
              </p>
            )}
          </div>
        )}
      </Surface>
      </div>

      <Surface className="p-6">
        <h2 className="mb-1 text-lg font-semibold text-fg">{t("settings.account.sessions")}</h2>
        <p className="mb-5 text-sm text-fg-faint">{t("settings.account.sessionsDescription")}</p>
        {/* Phone: one fixed-height summary row per session, details on tap. */}
        <div className="flex flex-col gap-3 md:hidden">
          {sessions.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => setDetail(s)}
              className="flex cursor-pointer items-center gap-3 rounded-xl bg-surface-2 px-4 py-3 text-left"
            >
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="flex items-center gap-2">
                  <span className="truncate text-[15px] text-fg">{s.device}</span>
                  {s.current && (
                    <span className="shrink-0 rounded-md bg-green-soft px-2 py-0.5 text-xs font-medium text-green">
                      {t("settings.account.thisDevice")}
                    </span>
                  )}
                </span>
                <span className="truncate text-sm text-fg-faint">
                  {s.ip ? `${s.ip} · ` : ""}
                  {t("settings.account.lastActive", { time: formatRelative(s.lastActiveAt) })}
                </span>
              </span>
              <ChevronRight className="size-4 shrink-0 text-fg-faint" />
            </button>
          ))}
        </div>

        <div className="hidden flex-col gap-3 md:flex">
          {sessions.map((s) => (
            <div key={s.id} className="flex flex-col gap-2 rounded-xl bg-surface-2 px-4 py-3 md:flex-row md:items-center md:justify-between md:gap-4">
              <div className="flex min-w-0 flex-col gap-0.5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[15px] text-fg">{s.device}</span>
                  {s.current && (
                    <span className="rounded-md bg-green-soft px-2 py-0.5 text-xs font-medium text-green">
                      {t("settings.account.thisDevice")}
                    </span>
                  )}
                  <span className="rounded-md bg-surface-3 px-2 py-0.5 text-xs font-medium text-fg-dim">
                    {s.remembered
                      ? t("settings.account.sessionRemembered")
                      : t("settings.account.sessionSingle")}
                  </span>
                </div>
                <span className="text-sm text-fg-faint">
                  {s.ip ? `${s.ip} · ` : ""}
                  {t("settings.account.lastActive", { time: formatRelative(s.lastActiveAt) })}
                  {" · "}
                  {t("settings.account.signedInOn", { date: formatDate(s.createdAt) })}
                </span>
              </div>
              {!s.current && (
                <Button
                  variant="ghost"
                  onClick={() => revokeSession.mutate(s.id)}
                  disabled={revokeSession.isPending}
                  className="self-end shrink-0 text-red hover:text-red"
                >
                  {t("settings.account.revokeSession")}
                </Button>
              )}
            </div>
          ))}
        </div>
        {hasOthers && (
          <div className="flex justify-end pt-4">
            <Button
              variant="ghost"
              onClick={() => revokeOthers.mutate()}
              disabled={revokeOthers.isPending}
              className="text-red hover:text-red"
            >
              {t("settings.account.logOutOtherSessions")}
            </Button>
          </div>
        )}
      </Surface>

      {asking && <ReauthModal onConfirmed={onReauthed} onClose={() => setAsking(null)} />}

      {setupToken && (
        <TotpSetupModal
          reauth={setupToken}
          onClose={() => setSetupToken(null)}
          onReauthExpired={() => {
            setSetupToken(null);
            setMfaError("expired");
          }}
        />
      )}

      {newCodes && (
        <Dialog
          title={t("settings.security.backupCodesTitle")}
          // The codes are shown only once: the button is the way out.
          onClose={() => {}}
          busy
          footer={<Button onClick={() => setNewCodes(null)}>{t("settings.security.savedThem")}</Button>}
        >
          <BackupCodesView codes={newCodes} />
        </Dialog>
      )}

      {detail && (
        <SessionDetailModal
          session={detail}
          revoking={revokeSession.isPending}
          onRevoke={
            detail.current
              ? undefined
              : () => {
                  revokeSession.mutate(detail.id);
                  setDetail(null);
                }
          }
          onClose={() => setDetail(null)}
        />
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-sm text-fg-faint">{label}</span>
      {children}
    </div>
  );
}

function TextInput({
  value,
  onChange,
  type = "text",
  ariaLabel,
}: {
  value: string;
  onChange: (value: string) => void;
  type?: "text" | "email" | "password";
  ariaLabel?: string;
}) {
  return (
    <input
      type={type}
      aria-label={ariaLabel}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full bg-surface-2 rounded-xl px-4 py-3 text-fg text-[15px] outline-none focus:ring-1 focus:ring-green h-10.25"
    />
  );
}
