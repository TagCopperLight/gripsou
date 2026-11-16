import type { ReactNode } from "react";

/** A disabled fieldset turns off the whole subtree, including controls never told
 *  about the loading. It is `display: contents` because as a box it doesn't pass a
 *  flex parent's height limit down; `className` lays children out in a plain div.
 *  `role="none"`: it groups nothing the user should hear about. */
export function LoadingFrame({ loading, className, children }: {
  loading: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <fieldset role="none" disabled={loading} className="contents">
      {className === undefined ? children : <div className={className}>{children}</div>}
    </fieldset>
  );
}
