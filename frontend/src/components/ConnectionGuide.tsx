import { useTranslation } from "react-i18next";
import { Eye, type LucideIcon } from "lucide-react";
import type { EnabledProvider } from "../api/types";
import { PROVIDER_GUIDE } from "./connectionGuide";

/** How a bank connection works, before the user is sent to the provider: what
 *  gripsou can do with the data, then each enabled provider's own points. */
export function ConnectionGuide({ providers }: { providers: EnabledProvider[] }) {
  const { t } = useTranslation();
  const readOnlyBody =
    providers.length === 1
      ? t("connectionGuide.readOnly.bodyOne", { provider: providers[0].displayName })
      : t("connectionGuide.readOnly.body");
  return (
    <div className="flex flex-col gap-5">
      <GuideRow icon={Eye} title={t("connectionGuide.readOnly.title")} body={readOnlyBody} />
      {providers.flatMap((p) =>
        (PROVIDER_GUIDE[p.key] ?? []).map((point) => (
          <GuideRow key={`${p.key}-${point.title}`} icon={point.icon} title={t(point.title)} body={t(point.body)} />
        )),
      )}
    </div>
  );
}

function GuideRow({ icon: Icon, title, body }: { icon: LucideIcon; title: string; body: string }) {
  return (
    <div className="flex gap-3.5">
      {/* In a square, as on the Security rows: each point stands on its own. */}
      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-surface-2 text-fg-dim">
        <Icon className="size-4.5" strokeWidth={2} />
      </span>
      <div className="flex flex-col gap-0.75 pt-px">
        <span className="text-sm font-medium text-fg">{title}</span>
        <span className="text-[13px] leading-relaxed text-fg-dim">{body}</span>
      </div>
    </div>
  );
}
