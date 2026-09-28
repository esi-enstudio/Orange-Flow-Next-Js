"use client";

import { X } from "lucide-react";

interface ActiveFilterBadgeProps {
  label: string;
  value: string;
  /** Fully localized "Remove <label> filter" text, supplied by the caller. */
  removeLabel: string;
  onRemove: () => void;
}

/**
 * Compact removable badge for one applied filter. The remove control is a real
 * button with an accessible name so it can be operated by keyboard and announced
 * by screen readers.
 */
export default function ActiveFilterBadge({ label, value, removeLabel, onRemove }: ActiveFilterBadgeProps) {
  return (
    <span className="inline-flex max-w-full items-center gap-1 rounded-md border border-primary-200 bg-primary-50 py-0.5 pl-2 pr-1 text-[11px] dark:border-primary-500/30 dark:bg-primary-500/10">
      <span className="shrink-0 font-semibold text-gray-600 dark:text-gray-400">{label}</span>
      <span className="truncate font-medium text-primary-700 dark:text-primary-300">{value}</span>
      <button
        type="button"
        onClick={onRemove}
        aria-label={removeLabel}
        className="ml-0.5 shrink-0 cursor-pointer rounded p-0.5 text-primary-600 transition-colors hover:bg-primary-200/60 hover:text-red-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 dark:text-primary-300 dark:hover:bg-primary-500/20"
      >
        <X className="h-3 w-3" />
      </button>
    </span>
  );
}
