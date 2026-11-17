import { useTranslation } from "react-i18next";
import { ACCOUNT_PALETTE } from "../../../lib/palette";
import { STRIPE_CSS } from "../../exposure/exposureColors";
import { localizeCountry, localizeSector } from "../../../lib/composition-i18n";
import { allocationPercents } from "../../../lib/composition";
import type { Allocation, Composition } from "../../../api/wire";
import { ColorSquare } from "../../../ui/ColorSquare";
import { usePhone } from "../../../ui/usePhone";

// "Other" is striped like the leftover slice of the Investments donuts.
const OTHER_COLOR = STRIPE_CSS;

type Slice = { name: string; percent: number; color: string };

/** A phone folds the small slices into "Other": their labels would fill the screen. */
const PHONE_MIN_PERCENT = 5;

function buildSlices(items: Allocation[], otherLabel: string, minPercent: number): Slice[] {
  const { listed: all, other: rest } = allocationPercents(items);
  const listed = all.filter((s) => s.percent >= minPercent);
  const other = rest + all.reduce((sum, s) => (s.percent < minPercent ? sum + s.percent : sum), 0);
  const slices = listed.map((s, i) => ({ ...s, color: ACCOUNT_PALETTE[i % ACCOUNT_PALETTE.length] }));
  return other >= 1 ? [...slices, { name: otherLabel, percent: other, color: OTHER_COLOR }] : slices;
}

function AllocationBar({
  title,
  items,
  otherLabel,
  minPercent,
}: {
  title: string;
  items: Allocation[];
  otherLabel: string;
  minPercent: number;
}) {
  if (items.length === 0) return null;
  const slices = buildSlices(items, otherLabel, minPercent);
  return (
    <div className="flex flex-col gap-2">
      <span className="text-fg font-semibold text-sm pb-1">{title}</span>
      <div className="flex h-3 gap-1">
        {/* Each slice is its own pill, so a 0% slice would leave a stray gap. */}
        {slices.filter((s) => s.percent > 0).map((s) => (
          <span
            key={s.name}
            data-testid={`seg-${s.name}`}
            className="h-full min-w-1 rounded-full"
            style={{ flexGrow: s.percent, flexBasis: 0, background: s.color }}
          />
        ))}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1.5 mt-1">
        {slices.map((s) => (
          <span key={s.name} className="flex items-center gap-1.5 text-xs">
            <ColorSquare color={s.color} />
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
  const minPercent = usePhone() ? PHONE_MIN_PERCENT : 0;
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
        minPercent={minPercent}
      />
      <AllocationBar
        title={t("dashboard.assetModal.sectorDistribution")}
        items={sectors}
        otherLabel={otherLabel}
        minPercent={minPercent}
      />
    </div>
  );
}
