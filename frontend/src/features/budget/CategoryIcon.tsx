import type { CSSProperties } from "react";

import { FilledDot } from "./FilledDot";
import { BUDGET_ICONS } from "../../lib/budget";

type CategoryIconProps = {
  /** The category's icon name; `null` or an unknown name draws the dot. */
  icon: string | null;
  className?: string;
  style?: CSSProperties;
};

/** A category's glyph, with the one fallback every surface shares: a category
 *  without an icon is a solid dot in its own colour — on the chip, the row
 *  avatar, the settings table and the modal's preview alike. */
export function CategoryIcon({ icon, className, style }: CategoryIconProps) {
  // Indexed, not looked up through a function: `react-hooks/static-components`
  // only accepts a component taken from a static record.
  const Icon = (icon && BUDGET_ICONS[icon]) || FilledDot;
  return <Icon className={className} style={style} />;
}
