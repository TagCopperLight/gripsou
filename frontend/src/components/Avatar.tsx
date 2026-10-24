import { ACCOUNT_PALETTE } from "../lib/palette";

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return name.trim().slice(0, 2).toUpperCase();
}

// Stable color per name so avatars are consistent without a stored color.
function colorForName(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return ACCOUNT_PALETTE[h % ACCOUNT_PALETTE.length];
}

type AvatarProps = {
  name: string;
  color?: string;
  src?: string;
  className?: string;
};

// The initials are sized from the circle's own width (cqw), so they keep the
// same proportions at every avatar size without each caller picking a text size.
export function Avatar({ name, color, src, className = "size-9" }: AvatarProps) {
  if (src) {
    return (
      <img
        src={src}
        alt=""
        className={`rounded-full shrink-0 object-cover ${className}`}
      />
    );
  }
  const c = color ?? colorForName(name);
  return (
    <span className={`@container block shrink-0 ${className}`}>
      <span
        className="flex size-full items-center justify-center rounded-full"
        style={{
          background: `color-mix(in srgb, ${c} 16%, transparent)`,
          boxShadow: `inset 0 0 0 max(1px, 2.5cqw) color-mix(in srgb, ${c} 45%, transparent)`,
          color: c,
        }}
      >
        <span className="font-wordmark text-[32cqw] font-semibold leading-none tracking-[-0.04em]">{initials(name)}</span>
      </span>
    </span>
  );
}
