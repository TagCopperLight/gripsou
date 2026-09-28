import { describe, it, expect } from "vitest";

import { escapeHtml, tooltipRow } from "./chartTheme";

describe("escapeHtml", () => {
  it("escapes the five HTML-significant characters", () => {
    expect(escapeHtml(`<img src=x onerror=alert(1)>`)).toBe(
      "&lt;img src=x onerror=alert(1)&gt;",
    );
    expect(escapeHtml(`"quoted" & 'single'`)).toBe("&quot;quoted&quot; &amp; &#39;single&#39;");
  });
});

describe("tooltipRow", () => {
  it("escapes an attacker-controlled label instead of injecting it into the tooltip's HTML", () => {
    // ECharts renders a tooltip formatter's return value as innerHTML — a
    // category or tag name is user-editable text, not markup (I3).
    const row = tooltipRow("#e0605f", `<img src=x onerror=alert(1)>`, "12,00 €");
    expect(row).toContain("&lt;img");
    expect(row).not.toContain("<img");
  });
});
