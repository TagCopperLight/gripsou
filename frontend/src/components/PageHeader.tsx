import { useContext } from "react";
import { AuthContext } from "../auth/context";
import { getPrefs } from "../lib/prefs";
import { useTranslation } from "react-i18next";

type PageHeaderProps = {
  title: string;
};

// Page title with today's date above it. Shared by the Dashboard and Accounts pages.
export function PageHeader({ title }: PageHeaderProps) {
  const prefs = useContext(AuthContext)?.prefs ?? getPrefs();
  const { i18n } = useTranslation();
  return (
    <div>
      <p className="text-fg-dim text-sm pb-1">
        {new Date().toLocaleDateString(i18n.language, {
          timeZone: prefs.timeZone,
          weekday: "long",
          year: "numeric",
          month: "long",
          day: "numeric",
        })}
      </p>
      <h1 className="text-2xl font-bold">{title}</h1>
    </div>
  );
}
