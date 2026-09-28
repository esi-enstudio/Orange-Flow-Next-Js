"use client";

import { Loader2, RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";

interface FilterActionsProps {
  onReset: () => void;
  onApply: () => void;
  /** True while the parent is fetching, so Apply cannot be double-submitted. */
  applying?: boolean;
  hasActiveFilters?: boolean;
  applyLabel?: string;
  /** Localized label shown while an apply request is in flight. */
  applyingLabel?: string;
  resetLabel?: string;
  className?: string;
}

/** Sticky footer holding the Reset / Apply pair, sized for touch targets. */
export default function FilterActions({
  onReset,
  onApply,
  applying = false,
  hasActiveFilters = false,
  applyLabel = "Apply Filters",
  applyingLabel = "Applying…",
  resetLabel = "Reset",
  className,
}: FilterActionsProps) {
  return (
    <div
      className={cn(
        "flex items-center gap-2 border-t border-gray-100 bg-gray-50/60 px-3 py-2.5 dark:border-slate-800 dark:bg-slate-900/60",
        className
      )}
    >
      <button
        type="button"
        onClick={onReset}
        disabled={applying || !hasActiveFilters}
        className="inline-flex h-11 lg:h-9 flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 text-[13px] font-semibold text-gray-700 transition-colors hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-gray-200 dark:hover:bg-slate-700"
      >
        <RotateCcw className="h-3.5 w-3.5" />
        {resetLabel}
      </button>
      <button
        type="button"
        onClick={onApply}
        disabled={applying}
        aria-busy={applying}
        className="inline-flex h-11 lg:h-9 flex-[1.4] cursor-pointer items-center justify-center gap-1.5 rounded-lg bg-primary-600 px-3 text-[13px] font-semibold text-white transition-colors hover:bg-primary-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-60 dark:focus-visible:ring-offset-slate-900"
      >
        {applying ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
        {applying ? applyingLabel : applyLabel}
      </button>
    </div>
  );
}
