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
  className?: string;
};

export function Avatar({ name, color, className = "size-9" }: AvatarProps) {
  return (
    <span
      className={`flex items-center justify-center rounded-full shrink-0 font-semibold text-black leading-none ${className}`}
      style={{ background: color ?? colorForName(name) }}
    >
      <span className="text-[13px]">{initials(name)}</span>
    </span>
  );
}
