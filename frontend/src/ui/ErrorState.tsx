import { CircleAlert } from "lucide-react";

import { Button } from "./Button";

type ErrorStateProps = {
  title: string;
  detail: string;
  /** The way out (Retry, Reload); none when there is nothing to do. */
  action?: { label: string; onClick: () => void };
  className?: string;
};

/** Something that couldn't be shown: a card that couldn't load, or a page
 *  that broke. A red icon, what went wrong, and the way out under it. */
export function ErrorState({ title, detail, action, className = "" }: ErrorStateProps) {
  return (
    <div role="alert" className={`flex flex-col items-center justify-center gap-2.5 text-center ${className}`}>
      <span className="flex size-10 items-center justify-center rounded-xl bg-red-soft text-red">
        <CircleAlert className="size-4" />
      </span>
      <div className="flex flex-col gap-0.5">
        <p className="text-sm font-medium text-fg">{title}</p>
        <p className="text-xs text-fg-faint">{detail}</p>
      </div>
      {action && (
        <Button variant="outline" padded={false} className="mt-1 rounded-lg! px-2.75 py-1.5 text-xs" onClick={action.onClick}>
          {action.label}
        </Button>
      )}
    </div>
  );
}
