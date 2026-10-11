/** Every time zone the browser knows, plus UTC and the default. */
export const TIME_ZONES = [...new Set(["UTC", "Europe/Paris", ...Intl.supportedValuesOf("timeZone")])].sort();
