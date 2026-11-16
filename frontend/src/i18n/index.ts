import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import en from "./en.json";
import fr from "./fr.json";
import { browserLanguage } from "./browserLanguage";
import { savedLanguage } from "./savedLanguage";
import { getAuthToken } from "../api/client";

// The init promise is exported: i18next signals `initialized` on a later tick even with inlined resources, and in a test that can land after the test body and trigger an act(...) warning. `src/test/setup.ts` awaits it.
export const i18nReady = i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    fr: { translation: fr },
  },
  lng: (getAuthToken() !== null ? savedLanguage() : null) ?? browserLanguage(),
  fallbackLng: "en",
  interpolation: { escapeValue: false },
});

export default i18n;
