"use client";

import { useId } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

/** One shared control height keeps every row of the panel perfectly aligned. */
const CONTROL_BASE =
  "w-full rounded-lg border bg-white text-[13px] text-gray-900 transition-colors outline-none placeholder:text-gray-400 focus:border-primary-500 focus:ring-2 focus:ring-primary-500/25 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-slate-800 dark:text-gray-100 dark:placeholder:text-gray-500";

const CONTROL_HEIGHT = "h-11 lg:h-9";

interface BaseProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  /** Pass the id referenced by the wrapping FilterField label for a real label/control association. */
  id?: string;
  "aria-label"?: string;
}

interface TextInputProps extends BaseProps {
  icon?: React.ComponentType<{ className?: string }>;
  type?: "text" | "tel" | "number";
}

export function TextInput({
  value,
  onChange,
  placeholder,
  icon: Icon,
  type = "text",
  disabled,
  className,
  id,
  ...rest
}: TextInputProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  return (
    <div className={cn("relative", className)}>
      {Icon && (
        <Icon className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" />
      )}
      <input
        id={inputId}
        type={type}
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className={cn(
          CONTROL_BASE,
          CONTROL_HEIGHT,
          "border-gray-200 dark:border-slate-700",
          Icon ? "pl-8 pr-2.5" : "px-2.5"
        )}
        {...rest}
      />
    </div>
  );
}

export function DateInput({
  value,
  onChange,
  disabled,
  className,
  min,
  max,
  id,
  ...rest
}: BaseProps & { min?: string; max?: string }) {
  return (
    <input
      id={id}
      type="date"
      value={value}
      disabled={disabled}
      min={min}
      max={max}
      onChange={(e) => onChange(e.target.value)}
      className={cn(CONTROL_BASE, CONTROL_HEIGHT, "border-gray-200 px-2.5 dark:border-slate-700", className)}
      {...rest}
    />
  );
}

export function TimeInput({ value, onChange, disabled, className, id, ...rest }: BaseProps) {
  return (
    <input
      id={id}
      type="time"
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      className={cn(CONTROL_BASE, CONTROL_HEIGHT, "border-gray-200 px-2.5 dark:border-slate-700", className)}
      {...rest}
    />
  );
}

/**
 * Native select for short, fixed enumerations (2-8 options) where offering a
 * search box would be noise. Shares the exact height, border and focus treatment
 * of TextInput so mixed rows stay aligned.
 */
export function SelectInput({
  value,
  onChange,
  options,
  placeholder,
  disabled,
  className,
  id,
  ...rest
}: Omit<BaseProps, "placeholder"> & {
  options: readonly string[];
  placeholder?: string;
}) {
  return (
    <div className={cn("relative", className)}>
      <select
        id={id}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className={cn(
          CONTROL_BASE,
          CONTROL_HEIGHT,
          "cursor-pointer appearance-none border-gray-200 bg-white pl-2.5 pr-8 dark:border-slate-700 dark:bg-slate-800",
          value ? "" : "text-gray-400 dark:text-gray-500"
        )}
        {...rest}
      >
        <option value="">{placeholder ?? "All"}</option>
        {options.map((opt) => (
          <option key={opt} value={opt} className="text-gray-900 dark:text-gray-100">
            {opt}
          </option>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" />
    </div>
  );
}
