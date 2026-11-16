import type { ReactNode } from "react";

/** A card, a modal body or any block whose controls wait for its data: while
 *  `loading`, every button, input and select inside it is off. A native
 *  disabled fieldset does this for the whole subtree, including controls that
 *  were never told about the loading, and `:disabled` styles them.
 *
 *  The fieldset itself takes no part in the layout (`display: contents`): as a
 *  box it doesn't pass a flex parent's height limit down, so a scrolling area
 *  inside it would overflow. `className` lays its children out in a plain div.
 *  Nor is it a group to assistive tech (`role="none"`): it groups nothing the
 *  user should hear about, only the controls that wait together. */
export function LoadingFrame({ loading, className, children }: {
  /** True while the data this frame shows is loading. */
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
