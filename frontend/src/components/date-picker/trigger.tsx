"use client";

import * as React from "react";
import { CalendarIcon, ChevronDown } from "lucide-react";

import { PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

/** Matches the filter/select triggers used across the app (EntitySelector). */
const TRIGGER_BASE =
  "w-full flex items-center justify-between gap-2 px-3 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl text-sm outline-none focus:ring-2 focus:ring-primary-500 hover:border-gray-300 dark:hover:border-slate-700 disabled:opacity-50 transition-colors cursor-pointer disabled:cursor-not-allowed";

/** 44px on mobile, 36px from lg up — same scale the rest of the filter panel uses. */
const TRIGGER_HEIGHT = "h-11 lg:h-9";

export interface DatePickerTriggerProps {
  id?: string;
  open: boolean;
  disabled?: boolean;
  /** Already-localised trigger text. */
  text: string;
  muted?: boolean;
  /** Right-aligned day-count chip, rendered before the chevron. */
  badge?: React.ReactNode;
  ariaLabel?: string;
  className?: string;
}

/**
 * The one-line trigger shared by `DateRangePicker` and `DatePicker`. Kept in a
 * single place so a range field and a single-date field never drift apart.
 */
export function DatePickerTrigger({
  id,
  open,
  disabled = false,
  text,
  muted = false,
  badge,
  ariaLabel,
  className,
}: DatePickerTriggerProps) {
  return (
    <PopoverTrigger asChild>
      <button
        id={id}
        type="button"
        disabled={disabled}
        aria-label={ariaLabel}
        aria-expanded={open}
        className={cn(TRIGGER_BASE, TRIGGER_HEIGHT, className)}
      >
        <span
          className={cn(
            "flex min-w-0 items-center gap-2 truncate",
            muted ? "text-gray-500 dark:text-gray-400" : "text-gray-900 dark:text-gray-100"
          )}
        >
          <CalendarIcon className="h-4 w-4 shrink-0 text-gray-400" aria-hidden="true" />
          <span className="truncate">{text}</span>
        </span>
        <div className="flex shrink-0 items-center gap-1.5">
          {badge}
          <ChevronDown
            className={cn("h-4 w-4 text-gray-400 transition-transform duration-200", open && "rotate-180")}
            aria-hidden="true"
          />
        </div>
      </button>
    </PopoverTrigger>
  );
}

/** Panel chrome shared by both pickers: rounded card, no padding of its own. */
export const DATE_PICKER_PANEL =
  "w-auto max-w-[calc(100vw-1rem)] overflow-hidden rounded-2xl border border-gray-200 bg-white p-0 shadow-lg shadow-gray-900/5 dark:border-slate-800 dark:bg-slate-900 dark:shadow-black/40";
