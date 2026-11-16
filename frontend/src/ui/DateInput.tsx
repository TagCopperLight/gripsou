import { useRef, useState, type InputHTMLAttributes } from "react";
import { useTranslation } from "react-i18next";
import { Calendar } from "lucide-react";

import { usePrefs } from "../auth/context";
import { fillPattern, formatDate, parseDate } from "../lib/date";
import { TextInput } from "./TextInput";

type DateInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "value" | "onChange"> & {
  /** An ISO day, or "" when empty or unreadable. */
  value: string;
  onChange: (value: string) => void;
  invalid?: boolean;
  tone?: "default" | "sunken";
};

/** Shows and reads the day in the user's date pattern; the calendar button opens the browser's picker. */
export function DateInput({ value, onChange, className = "", onBlur, ...props }: DateInputProps) {
  const { t } = useTranslation();
  const { dateFormat } = usePrefs();
  const picker = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState<string | null>(null);

  const shown = draft !== null && (parseDate(draft, dateFormat) ?? "") === value
    ? draft
    : value === "" ? "" : formatDate(value, { pattern: dateFormat });
  const placeholder = fillPattern(dateFormat, (token) => t(`common.dateInput.tokens.${token}`));

  return (
    <div className={`relative w-full ${className}`}>
      <TextInput
        {...props}
        inputMode="numeric"
        placeholder={placeholder}
        value={shown}
        className="pr-10"
        onChange={(e) => {
          setDraft(e.target.value);
          onChange(parseDate(e.target.value, dateFormat) ?? "");
        }}
        onBlur={(e) => {
          if (parseDate(e.target.value, dateFormat) !== null) setDraft(null);
          onBlur?.(e);
        }}
      />
      <button
        type="button"
        aria-label={t("common.dateInput.pick")}
        onClick={() => picker.current?.showPicker()}
        className="absolute inset-y-0 right-0 flex w-10 cursor-pointer items-center justify-center rounded-r-xl text-fg-faint transition-colors duration-140 hover:text-fg"
      >
        <Calendar className="size-4" />
      </button>
      <input
        ref={picker}
        type="date"
        tabIndex={-1}
        aria-hidden
        value={value}
        onChange={(e) => {
          setDraft(null);
          onChange(e.target.value);
        }}
        className="pointer-events-none absolute inset-x-0 bottom-0 h-0 opacity-0"
      />
    </div>
  );
}
