import type { CSSProperties } from "react";

import { FilledDot } from "./FilledDot";
import { BUDGET_ICONS } from "./budgetIcons";

type CategoryIconProps = {
  /** The category's icon name; `null` or an unknown name draws the dot. */
  icon: string | null;
  className?: string;
  style?: CSSProperties;
};

export function CategoryIcon({ icon, className, style }: CategoryIconProps) {
  // Indexed from a static record: `react-hooks/static-components` rejects anything else.
  const Icon = (icon && BUDGET_ICONS[icon]) || FilledDot;
  return <Icon className={className} style={style} />;
}
