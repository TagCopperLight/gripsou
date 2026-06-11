import { useTranslation } from "react-i18next";
import { Surface } from "../components/Surface";

export function Dashboard() {
  const { t } = useTranslation();
  return (
    <div>
      <p className="text-fg-dim text-[13px] pb-1">
        {new Date().toLocaleDateString("default", {
          weekday: "long",
          year: "numeric",
          month: "long",
          day: "numeric",
        })}
      </p>
      <h1 className="text-2xl font-bold">{t("nav.dashboard")}</h1>
      <Surface className="h-40 w-full my-4">
      </Surface>
    </div>
  );
}
