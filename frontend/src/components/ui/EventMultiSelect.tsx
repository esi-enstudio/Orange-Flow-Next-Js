"use client";

import { useMemo, useState } from "react";
import { ChevronDown, Search, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";

export interface EventMultiSelectItem {
  id: string | number;
  name: string;
  startDate?: string | null;
  endDate?: string | null;
  description?: string | null;
  color?: string;
}

interface EventMultiSelectProps {
  items: EventMultiSelectItem[];
  selectedIds: Array<string | number>;
  onChange: (ids: Array<string | number>) => void;
  onDelete?: (item: EventMultiSelectItem) => void;
  onViewAll?: () => void;
  label?: string;
  description?: string;
  placeholder?: string;
  emptyMessage?: string;
  noResultsMessage?: string;
  viewAllLabel?: string;
  clearLabel?: string;
  showDelete?: boolean;
  singleSelect?: boolean;
  disabled?: boolean;
}

function ordinal(n: number) {
  const v = Math.abs(n) % 100;
  const rem = v % 10;
  if (v >= 11 && v <= 13) return `${n}th`;
  if (rem === 1) return `${n}st`;
  if (rem === 2) return `${n}nd`;
  if (rem === 3) return `${n}rd`;
  return `${n}th`;
}

function formatEventRange(startDate?: string | null, endDate?: string | null) {
  const parse = (value?: string | null) => {
    if (!value) return null;
    const match = /^\d{4}-\d{2}-\d{2}$/.exec(value);
    if (!match) return null;
    const [year, month, day] = value.split("-").map(Number);
    const date = new Date(year, month - 1, day);
    if (Number.isNaN(date.getTime())) return null;
    return date;
  };

  const start = parse(startDate);
  const end = parse(endDate);

  if (!start && !end) return "";
  if (!start) return end ? formatDate(end) : "";
  if (!end) return formatDate(start);

  if (start.getFullYear() === end.getFullYear() && start.getMonth() === end.getMonth()) {
    return `${ordinal(start.getDate())} to ${ordinal(end.getDate())} ${new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric" }).format(start)}`;
  }

  return `${formatDate(start)} to ${formatDate(end)}`;
}

function formatDate(value: Date) {
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(value);
}

export default function EventMultiSelect({
  items,
  selectedIds,
  onChange,
  onDelete,
  onViewAll,
  placeholder = "Search event...",
  emptyMessage = "No matching events",
  noResultsMessage = "No results found",
  showDelete = false,
  singleSelect = false,
  disabled = false,
}: EventMultiSelectProps) {
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);

  const selectedItem = items.find((item) => String(item.id) === String(selectedIds[0] ?? ""));

  const filteredItems = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return items;

    return items.filter((item) => {
      const haystack = [item.name, item.description ?? "", item.startDate ?? "", item.endDate ?? ""].join(" ").toLowerCase();
      return haystack.includes(query);
    });
  }, [items, search]);

  const toggleItem = (id: string | number) => {
    if (disabled) return;

    if (singleSelect) {
      onChange([id]);
      setOpen(false);
      setSearch("");
      return;
    }

    const current = selectedIds.includes(id);
    const next = current
      ? selectedIds.filter((value) => value !== id)
      : [...selectedIds, id];

    onChange(next);
  };

  const clearSelection = () => {
    if (disabled) return;
    onChange([]);
    setOpen(false);
    setSearch("");
  };

  const selectedSet = new Set(selectedIds.map(String));

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => !disabled && setOpen((prev) => !prev)}
        disabled={disabled}
        className="flex w-full items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-3 py-3 text-left text-sm text-slate-800 shadow-sm transition-colors hover:border-pink-300 focus:border-pink-500 focus:outline-none dark:border-slate-700 dark:bg-slate-900/80 dark:text-slate-100"
      >
        <span className="flex min-w-0 items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-pink-50 text-pink-500 dark:bg-pink-500/10 dark:text-pink-300">
            <Search className="h-3.5 w-3.5" />
          </span>
          <span className="truncate">
            {selectedItem ? selectedItem.name : placeholder}
          </span>
        </span>
        <span className="flex items-center gap-2">
          {selectedIds.length > 0 && !singleSelect && (
            <span className="rounded-full bg-pink-100 px-2 py-0.5 text-[10px] font-semibold text-pink-600 dark:bg-pink-500/20 dark:text-pink-200">
              {selectedIds.length}
            </span>
          )}
          <ChevronDown className={cn("h-4 w-4 text-slate-500 transition-transform dark:text-slate-400", open && "rotate-180")} />
        </span>
      </button>

      {open && (
        <div className="absolute z-30 mt-2 w-full overflow-hidden rounded-xl border border-slate-200 bg-white shadow-[0_16px_40px_rgba(15,23,42,0.12)] dark:border-slate-700 dark:bg-slate-900">
          <div className="border-b border-slate-200 bg-slate-50 px-3 py-2 dark:border-slate-700 dark:bg-slate-800/80">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={placeholder}
                className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-8 pr-2 text-sm text-slate-800 outline-none ring-0 focus:border-pink-500 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
                autoFocus
              />
            </div>
          </div>

          <div className="max-h-[300px] overflow-y-auto bg-white dark:bg-slate-900">
            {filteredItems.length === 0 ? (
              <div className="px-3 py-3 text-sm text-slate-500 dark:text-slate-400">{noResultsMessage || emptyMessage}</div>
            ) : (
              filteredItems.map((item) => {
                const isSelected = selectedSet.has(String(item.id));
                const dateRange = formatEventRange(item.startDate, item.endDate);

                return (
                  <div
                    key={String(item.id)}
                    className={cn(
                      "group flex items-center gap-2 border-b border-slate-100 px-3 py-2.5 last:border-b-0 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800/80",
                      isSelected && "bg-pink-50 dark:bg-pink-500/5"
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => toggleItem(item.id)}
                      className="flex flex-1 items-center gap-3 text-left"
                    >
                      <span className={cn("mt-0.5 h-3.5 w-3.5 rounded-full border-2 border-slate-300 bg-white dark:border-slate-500 dark:bg-slate-900", isSelected && "border-pink-500 bg-pink-500") } />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-slate-800 dark:text-slate-100">{item.name}</span>
                        {dateRange && (
                          <span className="mt-0.5 block truncate text-[11px] text-slate-500 dark:text-slate-400">{dateRange}</span>
                        )}
                      </span>
                    </button>

                    {showDelete && onDelete && (
                      <button
                        type="button"
                        onClick={() => onDelete(item)}
                        className="flex h-7 w-7 items-center justify-center rounded-md border border-red-200 bg-red-50 text-red-500 hover:bg-red-100 dark:border-red-400/40 dark:bg-red-500/10 dark:text-red-300"
                        aria-label={`Delete ${item.name}`}
                        title="Delete event"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                );
              })
            )}
          </div>

          {(!singleSelect || selectedIds.length > 0) && (
            <div className="flex items-center justify-between border-t border-slate-200 bg-slate-50 px-3 py-2 dark:border-slate-700 dark:bg-slate-800/80">
              <span className="text-[11px] text-slate-500 dark:text-slate-400">
                {filteredItems.length} result{filteredItems.length === 1 ? "" : "s"}
              </span>
              {selectedIds.length > 0 && !singleSelect && (
                <button type="button" onClick={clearSelection} className="text-[11px] font-medium text-pink-600 hover:text-pink-500 dark:text-pink-300">
                  Clear
                </button>
              )}
              {onViewAll && (
                <button type="button" onClick={() => { setOpen(false); setSearch(""); onViewAll(); }} className="text-[11px] font-medium text-slate-700 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white">
                  View all
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
