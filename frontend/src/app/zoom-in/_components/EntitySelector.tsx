"use client";

import { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
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
  single?: boolean;
  selectAllLabel?: string;
  clearLabel?: string;
  selectedLabel?: string;
  onSearchChange?: (q: string) => void;
  /**
   * Render the label in the visually-hidden a11y slot only. Set this when the
   * surrounding form already renders its own visible label, so the two never
   * duplicate each other.
   */
  hideLabel?: boolean;
  /**
   * Render the dropdown in a document.body portal with viewport-aware placement.
   * Enable this when the trigger sits inside a clipping ancestor (overflow-hidden,
   * collapsed accordion, scrollable card) that would otherwise cut the option list
   * off. Defaults to false so existing usages keep their current behaviour.
   */
  portal?: boolean;
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
  single = false,
  selectAllLabel = "Select All",
  clearLabel = "Clear",
  selectedLabel = "selected",
  onSearchChange,
  hideLabel = false,
  portal = false,
}: EntitySelectorProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [portalPos, setPortalPos] = useState<{
    top?: number;
    bottom?: number;
    left: number;
    width: number;
    listMaxHeight: number;
  } | null>(null);

  const computePortalPos = () => {
    const el = triggerRef.current;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    const gap = 6;
    const edge = 8;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const spaceBelow = vh - rect.bottom - gap - edge;
    const spaceAbove = rect.top - gap - edge;
    // Only flip above when there is not enough room below and above is roomier.
    const placeAbove = spaceBelow < 160 && spaceAbove > spaceBelow;
    const avail = placeAbove ? spaceAbove : spaceBelow;
    const width = Math.min(rect.width, vw - edge * 2);
    const left = Math.min(Math.max(edge, rect.left), Math.max(edge, vw - width - edge));
    // Reserve ~92px for the search row, the Select All/Clear row and padding. The
    // floor stays at 0 so a cramped space shrinks the list instead of pushing the
    // whole menu past the viewport edge.
    const listMaxHeight = Math.max(0, Math.min(192, avail - 92));
    const menuHeight = 92 + listMaxHeight + 8;
    if (placeAbove) {
      // An off-screen trigger would otherwise produce a negative `bottom` and park
      // the menu outside the viewport, so keep it at least `edge` from the top.
      const bottom = Math.max(edge, vh - rect.top + gap);
      return { bottom, left, width, listMaxHeight };
    }
    return {
      top: Math.min(rect.bottom + gap, Math.max(edge, vh - edge - menuHeight)),
      left,
      width,
      listMaxHeight,
    };
  };

  useEffect(() => {
    if (!open || !portal) return;
    // The trigger position at open time. A scroll only dismisses the menu when
    // the page actually moved the trigger, so focus-induced scrolls (e.g. the
    // search input being autofocused right after opening) do not close it.
    const anchor = triggerRef.current?.getBoundingClientRect();
    const onResize = () => setPortalPos(computePortalPos());
    const onScroll = () => {
      const now = triggerRef.current?.getBoundingClientRect();
      if (!anchor || !now) return;
      if (Math.abs(now.top - anchor.top) < 1 && Math.abs(now.left - anchor.left) < 1) return;
      setOpen(false);
      setSearch("");
    };
    window.addEventListener("scroll", onScroll, false);
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("scroll", onScroll, false);
      window.removeEventListener("resize", onResize);
    };
  }, [open, portal]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      const target = e.target as Node;
      const inContainer = containerRef.current?.contains(target);
      const inMenu = menuRef.current?.contains(target);
      if (!inContainer && !inMenu) {
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

  // Escape must dismiss the menu no matter where focus sits (trigger or the search
  // input), and return focus to the trigger so keyboard users are not stranded.
  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      setOpen(false);
      setSearch("");
      triggerRef.current?.focus();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);

  const trimmedSearch = search.trim();
  const filtered = items.filter((item) => {
    if (!trimmedSearch) return true;
    const q = trimmedSearch.toLowerCase();
    return (
      item.label.toLowerCase().includes(q) ||
      (item.sublabel && item.sublabel.toLowerCase().includes(q)) ||
      String(item.id).toLowerCase().includes(q)
    );
  });

  const selectedItem = single ? items.find((item) => selectedIds.includes(item.id)) : undefined;

  const toggleItem = (id: string | number) => {
    if (single) {
      onChange(selectedIds[0] === id ? [] : [id]);
      setOpen(false);
      return;
    }
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
    // With a search active, clear only the matching (visible) selections. With
    // no search, clear everything — including selected ids that are no longer
    // present in `items` (a saved value whose option list changed since), which
    // the visible-only filter could never remove.
    if (!trimmedSearch) {
      onChange([]);
      return;
    }
    const filteredIds = filtered.map((item) => item.id);
    onChange(selectedIds.filter((id) => !filteredIds.includes(id)));
  };

  // Enter picks the first matching option so the menu is fully operable without a
  // mouse. For a single-select that selects and closes; for a multi-select it
  // toggles the first match and keeps the menu open for further picks.
  const commitFirstMatch = () => {
    const first = filtered[0];
    if (!first) {
      setOpen(false);
      triggerRef.current?.focus();
      return;
    }
    toggleItem(first.id);
    if (single) {
      triggerRef.current?.focus();
    }
  };

    const menuBody = (
    <>
          {(items.length > 0 || onSearchChange) && (
            <>
              <div className="relative p-2 pb-0">
                <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none" />
                <input
                  ref={searchRef}
                  type="text"
                  value={search}
                  onChange={(e) => {
                    setSearch(e.target.value);
                    onSearchChange?.(e.target.value);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      commitFirstMatch();
                    }
                  }}
                  placeholder={searchPlaceholder}
                  className="w-full pl-8 pr-3 py-1.5 bg-gray-50 dark:bg-slate-800/50 border border-gray-200 dark:border-slate-700 rounded-lg text-xs outline-none focus:ring-2 focus:ring-primary-500 dark:text-gray-100"
                />
              </div>

              {items.length > 0 && (
                <div className="flex items-center gap-1 px-2 pt-2 pb-1 border-b border-gray-100 dark:border-slate-800">
                {!single && (
                <button
                  type="button"
                  onClick={selectAll}
                   className="flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-medium text-primary-600 dark:text-primary-400 hover:bg-primary-50 dark:hover:bg-primary-900/20 rounded-lg transition-colors"
                >
                  <Check className="w-3 h-3" />
                  {selectAllLabel}
                </button>
                )}
                <button
                  type="button"
                  onClick={clearAll}
                   className="flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-medium text-gray-500 hover:bg-gray-100 dark:hover:bg-slate-800 rounded-lg transition-colors"
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
              )}
            </>
          )}

          <div
            role="listbox"
            aria-multiselectable={!single}
            className={`overflow-y-auto scrollbar-custom p-1 ${portal ? "" : "max-h-48"}`}
            style={portal ? { maxHeight: portalPos?.listMaxHeight } : undefined}
          >
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
                    role="option"
                    aria-selected={isSelected}
                    onClick={() => toggleItem(item.id)}
                     className={`w-full flex items-center gap-2.5 px-3 py-3 lg:py-2 rounded-lg text-sm transition-colors ${
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
    </>
  );

  return (
    <div ref={containerRef} className="relative">
      <label
        className={hideLabel ? "sr-only" : "block text-sm font-bold text-gray-700 dark:text-gray-300 mb-1.5"}
      >
        {label}{required && <span className="text-red-500"> *</span>}
      </label>

      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={hideLabel ? label : undefined}
        onClick={() => {
          if (disabled) return;
          if (!open && portal) setPortalPos(computePortalPos());
          setOpen(!open);
        }}
        disabled={disabled}
        /* Height is shared with `DatePickerTrigger` so a select and a date field
           sitting in the same filter grid line up exactly. */
        className="w-full flex items-center justify-between gap-2 px-3 h-11 lg:h-9 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl text-sm outline-none focus:ring-2 focus:ring-primary-500 hover:border-gray-300 dark:hover:border-slate-700 disabled:opacity-50 transition-colors cursor-pointer disabled:cursor-not-allowed"
      >
        {/* gray-500 rather than gray-400: gray-400 on white fails the 4.5:1
            contrast minimum axe flags on this placeholder. */}
        <span className={`truncate ${selectedIds.length === 0 ? "text-gray-500 dark:text-gray-400" : "text-gray-900 dark:text-gray-100"}`}>
          {single
            ? selectedItem
              ? selectedItem.label
              : placeholder
            : selectedIds.length === 0
              ? placeholder
              : `${selectedIds.length} ${selectedLabel}`}
        </span>
        <div className="flex items-center gap-1.5 shrink-0">
          {!single && selectedIds.length > 0 && (
            <span className="inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 text-[11px] font-bold text-white bg-primary-600 rounded-full">
              {selectedIds.length}
            </span>
          )}
          <ChevronDown className={`w-4 h-4 text-gray-400 transition-transform duration-200 ${open ? "rotate-180" : ""}`} />
        </div>
      </button>

      {error && <p className="text-xs text-red-500 mt-1">{error}</p>}

      {open && (
        portal && portalPos ? (
          createPortal(
            <div
              ref={menuRef}
              style={{
                position: "fixed",
                top: portalPos.top,
                bottom: portalPos.bottom,
                left: portalPos.left,
                width: portalPos.width,
                zIndex: 50,
              }}
              className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl shadow-lg animate-in fade-in slide-in-from-top-1 duration-150"
            >
              {menuBody}
            </div>,
            document.body
          )
        ) : (
          <div className="absolute z-50 mt-1.5 w-full bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl shadow-lg animate-in fade-in slide-in-from-top-1 duration-150">
            {menuBody}
          </div>
        )
      )}
    </div>
  );
}
