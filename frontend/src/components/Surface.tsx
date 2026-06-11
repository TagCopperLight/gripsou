import type { ComponentPropsWithoutRef } from "react";

type SurfaceProps = ComponentPropsWithoutRef<"div">;

export function Surface({ className = "", ...props }: SurfaceProps) {
  return (
    <div className={`bg-surface rounded-2xl ${className}`} {...props} />
  );
}
