import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import en from "./en.json";
import fr from "./fr.json";

// en/fr strings; per-user locale comes from prefs once settings land.
//
// The init promise is exported, not discarded: i18next signals `initialized` on
// a later tick even with the resources inlined, and every `useTranslation`
// consumer re-renders when it does. In the app that tick lands long before a
// user sees anything; in a test it can land AFTER the test body finished, which
// React reports as "an update to <Component> was not wrapped in act(...)".
// `src/test/setup.ts` awaits this so no test ever starts mid-init.
export const i18nReady = i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    fr: { translation: fr },
  },
  lng: "en",
  fallbackLng: "en",
  interpolation: { escapeValue: false },
});

export default i18n;
