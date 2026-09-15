import "@testing-library/jest-dom";
import { i18nReady } from "../i18n";

// Block until i18next is initialised. Without this every component that calls
// useTranslation can re-render after its test has finished, outside act().
await i18nReady;
