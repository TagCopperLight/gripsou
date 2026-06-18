type ToggleProps = {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  "aria-label"?: string;
};

export function Toggle({ checked, onChange, disabled = false, ...rest }: ToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition duration-140 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
        checked ? "bg-green" : "bg-surface-2"
      }`}
      {...rest}
    >
      <span
        className={`inline-block size-4 rounded-full bg-white transition-transform duration-140 ${
          checked ? "translate-x-6" : "translate-x-1"
        }`}
      />
    </button>
  );
}
