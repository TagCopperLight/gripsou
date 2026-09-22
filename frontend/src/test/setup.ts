import "@testing-library/jest-dom";
import { i18nReady } from "../i18n";

// Block until i18next is initialised. Without this every component that calls
// useTranslation can re-render after its test has finished, outside act().
await i18nReady;

// jsdom has no layout engine: `Element.prototype.scrollTo` is missing entirely
// and `window.scrollTo` throws "Not implemented". The router's scroll
// restoration calls both on every navigation, so stub them as no-ops.
if (!Element.prototype.scrollTo) {
  Element.prototype.scrollTo = function scrollTo() {};
}
window.scrollTo = function scrollTo() {};
