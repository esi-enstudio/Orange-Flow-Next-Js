"use client";

import { cn } from "@/lib/utils";

interface FilterFieldProps {
  label: string;
  /** Rendered under the control. Used for hints and disabled explanations. */
  hint?: string;
  /** Non-colour indicator for the disabled state (screen-reader friendly too). */
  disabledReason?: string;
  className?: string;
  htmlFor?: string;
  children: React.ReactNode;
}

/**
 * Label + control wrapper. Every filter control is rendered through this so label
 * typography, spacing and the disabled hint stay identical across sections.
 */
export default function FilterField({
  label,
  hint,
  disabledReason,
  className,
  htmlFor,
  children,
}: FilterFieldProps) {
  return (
    <div className={cn("min-w-0", className)}>
      <label
        htmlFor={htmlFor}
        className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400"
      >
        {label}
      </label>
      {children}
      {disabledReason && (
        <p className="mt-1 flex items-center gap-1 text-[10px] text-gray-400 dark:text-gray-500">
          <span aria-hidden="true">ⓘ</span>
          {disabledReason}
        </p>
      )}
      {hint && !disabledReason && (
        <p className="mt-1 text-[10px] text-gray-400 dark:text-gray-500">{hint}</p>
      )}
    </div>
  );
}
