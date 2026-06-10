import { useTranslation } from "react-i18next";

export function App() {
  const { t } = useTranslation();
  return (
    <main className="app">
      <h1>gripsou</h1>
      <p>{t("placeholder")}</p>
    </main>
  );
}
