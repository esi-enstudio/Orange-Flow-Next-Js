"use client";

import { Search, X } from "lucide-react";

interface FilterSearchProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  /** Localized accessible name for the clear button. */
  clearLabel?: string;
  className?: string;
}

/** Prominent global search that sits directly under the filter panel header. */
export default function FilterSearch({
  value,
  onChange,
  placeholder = "Search...",
  clearLabel = "Clear search",
  className,
}: FilterSearchProps) {
  return (
    <div className={className}>
      <label htmlFor="filter-global-search" className="sr-only">
        {placeholder}
      </label>
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
        <input
          id="filter-global-search"
          type="search"
          value={value}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          className="h-11 w-full rounded-lg border border-gray-200 bg-white pl-9 pr-9 text-sm text-gray-900 outline-none transition-colors placeholder:text-gray-400 focus:border-primary-500 focus:ring-2 focus:ring-primary-500/25 dark:border-slate-700 dark:bg-slate-800 dark:text-gray-100"
        />
        {value && (
          <button
            type="button"
            onClick={() => onChange("")}
            aria-label={clearLabel}
            className="absolute right-2 top-1/2 -translate-y-1/2 cursor-pointer rounded p-1 text-gray-400 transition-colors hover:text-gray-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 dark:hover:text-gray-200"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}
