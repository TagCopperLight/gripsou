import "@testing-library/jest-dom";
import { createElement } from "react";
import { act, render } from "@testing-library/react";
import { afterEach, beforeEach } from "vitest";
import { ErrorToasts } from "../components/ErrorToasts";
import { clearErrors } from "../lib/errorToasts";
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

// Failed actions show in the corner of the screen, outside the component that
// failed: mount that corner for every test, and start each one with it empty.
beforeEach(() => {
  render(createElement(ErrorToasts));
});
afterEach(() => {
  act(() => clearErrors());
});
