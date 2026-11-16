import "@testing-library/jest-dom";
import { createElement } from "react";
import { act, render } from "@testing-library/react";
import { afterEach, beforeEach } from "vitest";
import { ErrorToasts } from "../shell/ErrorToasts";
import { clearErrors } from "../lib/errorToasts";
import { i18nReady } from "../i18n";

// Without this, components calling useTranslation re-render after their test ends, outside act().
await i18nReady;

// jsdom has no `Element.prototype.scrollTo` and `window.scrollTo` throws; router scroll restoration calls both.
if (!Element.prototype.scrollTo) {
  Element.prototype.scrollTo = function scrollTo() {};
}
window.scrollTo = function scrollTo() {};

// jsdom has no `matchMedia`; tests run the desktop layout.
window.matchMedia = (query: string) =>
  ({ matches: false, media: query, addEventListener() {}, removeEventListener() {} }) as unknown as MediaQueryList;

// The toast corner is outside the failing component.
beforeEach(() => {
  render(createElement(ErrorToasts));
});
afterEach(() => {
  act(() => clearErrors());
});
