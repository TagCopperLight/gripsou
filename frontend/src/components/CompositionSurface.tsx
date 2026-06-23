import { useTranslation } from "react-i18next";
import { ACCOUNT_PALETTE } from "../lib/palette";
import { localizeCountry, localizeSector } from "../lib/composition-i18n";
import type { Allocation, Composition } from "../api/types";

// Boursorama only lists the top holdings, so the listed weights sum to less
// than 100%. "Other" is the remainder (everything not broken out individually).
const OTHER_COLOR = "var(--color-fg-faint)";

type Slice = { name: string; percent: number; color: string };

/// Real slices (as integer percents) plus an "Other" remainder, so the displayed
/// percents always total exactly 100%. "Other" absorbs both the unlisted holdings
/// and the leftover from rounding each slice; it is shown only when it is >= 1%.
function buildSlices(items: Allocation[], otherLabel: string): Slice[] {
  const slices: Slice[] = items.map((a, i) => ({
    name: a.name,
    percent: Math.round(a.weight * 100),
    // Cycle the fixed account palette by position for well-spaced, distinct
    // colors (top-N lists fit within the palette; longer lists wrap).
    color: ACCOUNT_PALETTE[i % ACCOUNT_PALETTE.length],
  }));
  const otherPercent = 100 - slices.reduce((sum, s) => sum + s.percent, 0);
  if (otherPercent >= 1) {
    slices.push({ name: otherLabel, percent: otherPercent, color: OTHER_COLOR });
  }
  return slices;
}

function AllocationBar({
  title,
  items,
  otherLabel,
}: {
  title: string;
  items: Allocation[];
  otherLabel: string;
}) {
  if (items.length === 0) return null;
  const slices = buildSlices(items, otherLabel);
  return (
    <div className="flex flex-col gap-2">
      <span className="text-fg font-semibold text-sm pb-1">{title}</span>
      <div className="flex h-3 rounded-full overflow-hidden bg-surface-3">
        {slices.map((s) => (
          <span
            key={s.name}
            data-testid={`seg-${s.name}`}
            style={{ width: `${s.percent}%`, background: s.color }}
          />
        ))}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1.5 mt-1">
        {slices.map((s) => (
          <span key={s.name} className="flex items-center gap-1.5 text-xs">
            <span
              className="size-2.5 rounded-sm shrink-0"
              style={{ background: s.color }}
            />
            <span className="text-fg-dim">{s.name}</span>
            <span className="font-mono text-fg-faint">{s.percent}%</span>
          </span>
        ))}
      </div>
    </div>
  );
}

export function CompositionSurface({ composition }: { composition: Composition }) {
  const { t, i18n } = useTranslation();
  const otherLabel = t("dashboard.assetModal.otherAllocation");
  const countries = composition.countries.map((a) => ({
    ...a,
    name: localizeCountry(a.name, i18n.language),
  }));
  const sectors = composition.sectors.map((a) => ({
    ...a,
    name: localizeSector(a.name, t),
  }));
  return (
    <div className="bg-surface-2 rounded-2xl p-5 flex flex-col gap-6">
      <AllocationBar
        title={t("dashboard.assetModal.countryDistribution")}
        items={countries}
        otherLabel={otherLabel}
      />
      <AllocationBar
        title={t("dashboard.assetModal.sectorDistribution")}
        items={sectors}
        otherLabel={otherLabel}
      />
    </div>
  );
}
