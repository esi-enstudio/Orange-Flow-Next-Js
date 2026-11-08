"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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
  placeholder?: string;
  emptyMessage?: string;
  noResultsMessage?: string;
  viewAllLabel?: string;
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
  placeholder = "Search event...",
  emptyMessage = "No matching events",
  noResultsMessage = "No matching events",
  viewAllLabel = "View all",
  showDelete = false,
  singleSelect = false,
  disabled = false,
}: EventMultiSelectProps) {
  const [search, setSearch] = useState("");
  const [showAll, setShowAll] = useState(false);
  const [open, setOpen] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const listVisible = open;

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const filteredItems = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return items;

    return items.filter((item) => {
      const haystack = [
        item.name,
        item.description ?? "",
        item.startDate ?? "",
        item.endDate ?? "",
        formatEventRange(item.startDate, item.endDate),
      ].join(" ").toLowerCase();
      return haystack.includes(query);
    });
  }, [items, search]);

  const toggleItem = (id: string | number) => {
    if (disabled) return;

    if (singleSelect) {
      onChange(selectedSet.has(String(id)) ? [] : [id]);
      setSearch("");
      setShowAll(false);
      setOpen(false);
      return;
    }

    const current = selectedIds.includes(id);
    const next = current
      ? selectedIds.filter((value) => value !== id)
      : [...selectedIds, id];

    onChange(next);
  };

  const selectedSet = new Set(selectedIds.map(String));
  const selectedItems = items.filter((item) => selectedSet.has(String(item.id)));
  const selectedDisplayValue = selectedItems
    .map((item) => {
      const dateRange = formatEventRange(item.startDate, item.endDate);
      return dateRange ? `${item.name} (${dateRange})` : item.name;
    })
    .join(", ");
  const displayItems = search.trim() ? filteredItems : showAll ? items : filteredItems.slice(0, 7);
  const visibleCount = displayItems.length;
  const showViewAll = !showAll && displayItems.length < items.length;

  return (
    <div ref={containerRef} className="relative">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-[17px] w-[17px] -translate-y-1/2 text-slate-400" aria-hidden="true" />
        <input
          ref={searchInputRef}
          type="search"
          role="combobox"
          value={singleSelect && !open && selectedDisplayValue ? selectedDisplayValue : search}
          onChange={(event) => {
            setSearch(event.target.value);
            setShowAll(false);
            setOpen(true);
          }}
          onFocus={() => {
            setSearch("");
            setShowAll(false);
            setOpen(true);
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              setSearch("");
              setShowAll(false);
              setOpen(false);
              searchInputRef.current?.blur();
            }
            if (event.key === "ArrowDown" && listVisible) {
              event.preventDefault();
              const firstOption = document.getElementById("event-multi-select-option-0");
              firstOption?.focus();
            }
          }}
          placeholder={placeholder}
          autoComplete="off"
          aria-label="Search events"
          aria-autocomplete="list"
          aria-expanded={listVisible}
          aria-controls="event-multi-select-list"
          disabled={disabled}
          className="h-[40px] w-full rounded-[10px] border border-slate-200 bg-white py-2 pl-10 pr-12 text-sm text-slate-800 placeholder:text-slate-500 outline-none transition-colors focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 disabled:cursor-not-allowed dark:border-[#344b6a] dark:bg-[#101e34] dark:text-slate-100 dark:placeholder:text-slate-400"
        />
        <button
          type="button"
          onClick={() => {
            if (!disabled) {
              if (open) {
                setOpen(false);
                setSearch("");
                searchInputRef.current?.blur();
              } else {
                setOpen(true);
                searchInputRef.current?.focus();
              }
            }
          }}
          disabled={disabled}
          aria-label={listVisible ? "Hide event list" : viewAllLabel}
          className="absolute right-2 top-1/2 flex h-8 w-8 -translate-y-1/2 cursor-pointer items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:cursor-not-allowed dark:text-slate-400 dark:hover:bg-slate-700"
        >
          <ChevronDown className={cn("h-4 w-4 transition-transform", listVisible && "rotate-180")} />
        </button>
      </div>

      {listVisible && (
        <div className="absolute z-30 mt-1.5 w-full overflow-hidden rounded-[10px] border border-slate-200 bg-white shadow-[0_12px_30px_rgba(15,23,42,0.18)] dark:border-[#344b6a] dark:bg-[#0b1629]">
          <div
            id="event-multi-select-list"
            role="listbox"
            aria-label="Events"
            className="max-h-[220px] overflow-y-auto overscroll-contain [scrollbar-width:thin] [scrollbar-color:#64748b_transparent]"
          >
            {filteredItems.length === 0 ? (
              <div className="px-3 py-3 text-sm text-slate-500 dark:text-slate-400">
                {search.trim() ? noResultsMessage : emptyMessage}
              </div>
            ) : (
              displayItems.map((item, index) => {
                const isSelected = selectedSet.has(String(item.id));
                const dateRange = formatEventRange(item.startDate, item.endDate);
                const displayName = dateRange ? `${item.name} (${dateRange})` : item.name;

                return (
                  <div
                    key={String(item.id)}
                    className={cn(
                      "flex min-h-[31px] items-center gap-2.5 px-2.5 transition-colors hover:bg-slate-100 dark:hover:bg-white/[0.05]",
                      isSelected && "bg-pink-50 dark:bg-[rgba(190,35,100,0.22)]"
                    )}
                  >
                    <button
                      id={`event-multi-select-option-${index}`}
                      type="button"
                      role="option"
                      aria-selected={isSelected}
                      onClick={() => toggleItem(item.id)}
                      onKeyDown={(event) => {
                        if (event.key === "ArrowDown") {
                          event.preventDefault();
                          document.getElementById(`event-multi-select-option-${index + 1}`)?.focus();
                        } else if (event.key === "ArrowUp") {
                          event.preventDefault();
                          if (index === 0) searchInputRef.current?.focus();
                          else document.getElementById(`event-multi-select-option-${index - 1}`)?.focus();
                        }
                      }}
                       title={displayName}
                       className="flex min-w-0 flex-1 items-center gap-2.5 py-1 text-left text-sm text-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500 dark:text-slate-100"
                    >
                       <span
                         aria-hidden="true"
                        className={cn(
                          "h-2 w-2 shrink-0 rounded-full",
                          item.color ?? "bg-[#7da7e8]"
                        )}
                      />
                      <span className="min-w-0 flex-1 truncate font-normal">{displayName}</span>
                    </button>

                    {showDelete && onDelete && (
                      <button
                        type="button"
                        onClick={() => onDelete(item)}
                        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-slate-400 hover:bg-red-50 hover:text-red-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:hover:bg-red-500/10 dark:hover:text-red-300"
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

          <footer className="flex h-[35px] items-center justify-between border-t border-slate-200 px-2.5 text-xs text-slate-500 dark:border-white/[0.08] dark:text-[#8494ac]">
            <span aria-live="polite">
              Showing {visibleCount} of {items.length} events
            </span>
            {showViewAll && (
              <button
                type="button"
                onClick={() => {
                  setSearch("");
                  setShowAll(true);
                  setOpen(true);
                }}
                className="flex h-full cursor-pointer items-center gap-1 font-medium text-pink-600 hover:text-pink-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:text-[#ff365c] dark:hover:text-pink-300"
              >
                {viewAllLabel} <span aria-hidden="true">→</span>
              </button>
            )}
          </footer>
        </div>
      )}
    </div>
  );
}
