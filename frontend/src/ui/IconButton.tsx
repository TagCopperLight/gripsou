import type { ComponentPropsWithoutRef } from "react";

/** A row's action: a faint icon that lights up when hovered, red when it
 *  destroys something. Give it an `aria-label`: the icon is all it shows.
 *  Disabled, it fades and lets the pointer through to the row under it, so a
 *  clickable row still answers a click there. */
export function IconButton({
  danger = false,
  className = "",
  ...props
}: ComponentPropsWithoutRef<"button"> & { danger?: boolean }) {
  return (
    <button
      type="button"
      className={`size-8 shrink-0 rounded-lg flex items-center justify-center cursor-pointer text-fg-faint transition-colors duration-140 enabled:hover:bg-surface-2 disabled:opacity-30 disabled:pointer-events-none ${
        danger ? "enabled:hover:text-red" : "enabled:hover:text-fg"
      } ${className}`}
      {...props}
    />
  );
}
