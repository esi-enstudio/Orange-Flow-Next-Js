"use client";

import { useState, useRef, useEffect } from "react";
import { Search, ChevronDown, Check, X } from "lucide-react";

export interface SelectorItem {
  id: string | number;
  label: string;
  sublabel?: string;
  badge?: string;
}

interface EntitySelectorProps {
  label: string;
  items: SelectorItem[];
  selectedIds: (string | number)[];
  onChange: (ids: (string | number)[]) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyMessage?: string;
  noResultsMessage?: string;
  error?: string;
  disabled?: boolean;
  required?: boolean;
  selectAllLabel?: string;
  clearLabel?: string;
}

export default function EntitySelector({
  label,
  items,
  selectedIds,
  onChange,
  placeholder = "Select...",
  searchPlaceholder = "Search...",
  emptyMessage = "No options available",
  noResultsMessage = "No results found",
  error,
  disabled = false,
  required = false,
  selectAllLabel = "Select All",
  clearLabel = "Clear",
}: EntitySelectorProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setSearch("");
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    if (open && searchRef.current) {
      searchRef.current.focus();
    }
  }, [open]);

  const filtered = items.filter((item) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      item.label.toLowerCase().includes(q) ||
      (item.sublabel && item.sublabel.toLowerCase().includes(q)) ||
      String(item.id).toLowerCase().includes(q)
    );
  });

  const toggleItem = (id: string | number) => {
    onChange(
      selectedIds.includes(id)
        ? selectedIds.filter((v) => v !== id)
        : [...selectedIds, id]
    );
  };

  const selectAll = () => {
    onChange(filtered.map((item) => item.id));
  };

  const clearAll = () => {
    const filteredIds = filtered.map((item) => item.id);
    onChange(selectedIds.filter((id) => !filteredIds.includes(id)));
  };

  const allFilteredSelected = filtered.length > 0 && filtered.every((item) => selectedIds.includes(item.id));

  return (
    <div ref={containerRef} className="relative">
      <label className="block text-sm font-bold text-gray-700 dark:text-gray-300 mb-1.5">
        {label}{required && <span className="text-red-500"> *</span>}
      </label>

      <button
        type="button"
        onClick={() => !disabled && setOpen(!open)}
        disabled={disabled}
        className="w-full flex items-center justify-between gap-2 px-3 py-2.5 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl text-sm outline-none focus:ring-2 focus:ring-primary-500 disabled:opacity-50 transition-colors"
      >
        <span className={`truncate ${selectedIds.length === 0 ? "text-gray-400" : "text-gray-900 dark:text-gray-100"}`}>
          {selectedIds.length === 0
            ? placeholder
            : `${selectedIds.length} selected`}
        </span>
        <div className="flex items-center gap-1.5 shrink-0">
          {selectedIds.length > 0 && (
            <span className="inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 text-[11px] font-bold text-white bg-primary-500 rounded-full">
              {selectedIds.length}
            </span>
          )}
          <ChevronDown className={`w-4 h-4 text-gray-400 transition-transform duration-200 ${open ? "rotate-180" : ""}`} />
        </div>
      </button>

      {error && <p className="text-xs text-red-500 mt-1">{error}</p>}

      {open && (
        <div className="absolute z-50 mt-1.5 w-full bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl shadow-lg animate-in fade-in slide-in-from-top-1 duration-150">
          {items.length > 0 && (
            <>
              <div className="relative p-2 pb-0">
                <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none" />
                <input
                  ref={searchRef}
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={searchPlaceholder}
                  className="w-full pl-8 pr-3 py-1.5 bg-gray-50 dark:bg-slate-800/50 border border-gray-200 dark:border-slate-700 rounded-lg text-xs outline-none focus:ring-2 focus:ring-primary-500 dark:text-gray-100"
                />
              </div>

              <div className="flex items-center gap-1 px-2 pt-2 pb-1 border-b border-gray-100 dark:border-slate-800">
                <button
                  type="button"
                  onClick={selectAll}
                  className="flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-primary-600 dark:text-primary-400 hover:bg-primary-50 dark:hover:bg-primary-900/20 rounded-lg transition-colors"
                >
                  <Check className="w-3 h-3" />
                  {selectAllLabel}
                </button>
                <button
                  type="button"
                  onClick={clearAll}
                  className="flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-gray-500 hover:bg-gray-100 dark:hover:bg-slate-800 rounded-lg transition-colors"
                >
                  <X className="w-3 h-3" />
                  {clearLabel}
                </button>
                {filtered.length > 0 && (
                  <span className="ml-auto text-[10px] text-gray-400">
                    {filtered.length} of {items.length}
                  </span>
                )}
              </div>
            </>
          )}

          <div className="max-h-48 overflow-y-auto scrollbar-custom p-1">
            {items.length === 0 ? (
              <p className="text-xs text-gray-400 p-3 text-center">{emptyMessage}</p>
            ) : filtered.length === 0 ? (
              <p className="text-xs text-gray-400 p-3 text-center">{noResultsMessage}</p>
            ) : (
              filtered.map((item) => {
                const isSelected = selectedIds.includes(item.id);
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => toggleItem(item.id)}
                    className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors ${
                      isSelected
                        ? "bg-primary-50 dark:bg-primary-900/20 text-primary-700 dark:text-primary-300"
                        : "text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-slate-800"
                    }`}
                  >
                    <div className={`w-4 h-4 rounded border-2 flex items-center justify-center shrink-0 transition-colors ${
                      isSelected
                        ? "bg-primary-500 border-primary-500"
                        : "border-gray-300 dark:border-slate-600"
                    }`}>
                      {isSelected && <Check className="w-3 h-3 text-white" />}
                    </div>
                    <div className="flex-1 text-left min-w-0">
                      <span className="block truncate">{item.label}</span>
                      {item.sublabel && (
                        <span className="block text-[11px] text-gray-400 dark:text-gray-500 truncate">{item.sublabel}</span>
                      )}
                    </div>
                    {item.badge && (
                      <span className="shrink-0 px-1.5 py-0.5 text-[10px] font-medium bg-gray-100 dark:bg-slate-800 text-gray-500 dark:text-gray-400 rounded-md">
                        {item.badge}
                      </span>
                    )}
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
