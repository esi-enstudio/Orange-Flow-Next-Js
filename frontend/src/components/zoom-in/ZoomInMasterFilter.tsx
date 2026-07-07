"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import {
  Search,
  ChevronDown,
  X,
  Filter,
  RotateCcw,
  Calendar,
  Building2,
  Tag,
  MapPin,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useLanguage } from "@/i18n/useLanguage";
import apiClient from "@/lib/api";

export interface ZoomInFilters {
  search: string;
  date_from: string;
  date_to: string;
  event_type_id: number | null;
  activity_id: number | null;
  thana: string;
}

export const defaultFilters: ZoomInFilters = {
  search: "",
  date_from: "",
  date_to: "",
  event_type_id: null,
  activity_id: null,
  thana: "",
};

interface FilterOption {
  id: number;
  name: string;
  name_bn: string | null;
}

interface FilterOptions {
  event_types: FilterOption[];
  activities: FilterOption[];
}

interface Props {
  filters: ZoomInFilters;
  onChange: (filters: ZoomInFilters) => void;
  onClear: () => void;
}

function FilterSection({ title, icon: Icon, children, defaultOpen = true }: { title: string; icon: any; children: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const contentRef = useRef<HTMLDivElement>(null);
  const [maxHeight, setMaxHeight] = useState(defaultOpen ? "500px" : "0px");

  useEffect(() => {
    if (contentRef.current) {
      setMaxHeight(open ? `${contentRef.current.scrollHeight}px` : "0px");
    }
  }, [open, children]);

  return (
    <div className="border-b dark:border-slate-800 last:border-b-0">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-4 py-2.5 text-[11px] font-bold text-gray-500 uppercase tracking-widest hover:bg-gray-50 dark:hover:bg-slate-800/50 transition-colors"
      >
        <div className="flex items-center gap-2">
          <Icon className="w-3.5 h-3.5" />
          <span>{title}</span>
        </div>
        <div className={cn("transition-transform duration-300", open ? "rotate-180" : "rotate-0")}>
          <ChevronDown className="w-3.5 h-3.5" />
        </div>
      </button>
      <div className="overflow-hidden transition-all duration-300 ease-in-out" style={{ maxHeight }}>
        <div ref={contentRef} className="px-4 pb-3 space-y-2.5">
          {children}
        </div>
      </div>
    </div>
  );
}

function SelectFilter({
  value,
  onChange,
  options,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  placeholder: string;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full p-2 bg-gray-50 dark:bg-slate-800 border border-transparent rounded-lg text-xs dark:text-gray-200 outline-none focus:border-primary-500 focus:ring-1 focus:ring-primary-500 transition-all appearance-none"
    >
      <option value="">{placeholder}</option>
      {options.map((opt) => (
        <option key={opt.value} value={opt.value}>{opt.label}</option>
      ))}
    </select>
  );
}

export default function ZoomInMasterFilter({ filters, onChange, onClear }: Props) {
  const { t } = useLanguage();
  const [options, setOptions] = useState<FilterOptions>({
    event_types: [],
    activities: [],
  });
  const [localSearch, setLocalSearch] = useState(filters.search);
  const [localThana, setLocalThana] = useState(filters.thana);
  const searchTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const thanaTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    apiClient.get<FilterOptions>("/zoom-in/filter-options").then((res) => {
      if (res.data) setOptions(res.data);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    setLocalSearch(filters.search);
    setLocalThana(filters.thana);
  }, [filters.search, filters.thana]);

  const updateSearch = useCallback(
    (value: string) => {
      setLocalSearch(value);
      clearTimeout(searchTimer.current);
      searchTimer.current = setTimeout(() => {
        onChange({ ...filters, search: value });
      }, 500);
    },
    [filters, onChange]
  );

  const updateThana = useCallback(
    (value: string) => {
      setLocalThana(value);
      clearTimeout(thanaTimer.current);
      thanaTimer.current = setTimeout(() => {
        onChange({ ...filters, thana: value });
      }, 500);
    },
    [filters, onChange]
  );

  useEffect(() => {
    return () => {
      clearTimeout(searchTimer.current);
      clearTimeout(thanaTimer.current);
    };
  }, []);

  const update = useCallback(
    (key: keyof ZoomInFilters, value: any) => {
      onChange({ ...filters, [key]: value });
    },
    [filters, onChange]
  );

  const activeCount = Object.entries(filters).filter(([key, val]) => {
    if (key === "search") return (val as string).length > 0;
    if (key === "date_from" || key === "date_to" || key === "thana") return (val as string).length > 0;
    if (val === null || val === "") return false;
    return true;
  }).length;

  const chipList: { label: string; onRemove: () => void }[] = [];
  if (filters.date_from) chipList.push({ label: `Date from: ${filters.date_from}`, onRemove: () => update("date_from", "") });
  if (filters.date_to) chipList.push({ label: `Date to: ${filters.date_to}`, onRemove: () => update("date_to", "") });
  if (filters.event_type_id) {
    const et = options.event_types.find(e => e.id === filters.event_type_id);
    if (et) chipList.push({ label: `Event: ${et.name}`, onRemove: () => update("event_type_id", null) });
  }
  if (filters.activity_id) {
    const a = options.activities.find(ac => ac.id === filters.activity_id);
    if (a) chipList.push({ label: `Activity: ${a.name}`, onRemove: () => update("activity_id", null) });
  }
  if (filters.thana) chipList.push({ label: `Thana: ${filters.thana}`, onRemove: () => update("thana", "") });

  return (
    <div className="bg-white dark:bg-slate-900 rounded-2xl border dark:border-slate-800 shadow-sm overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b dark:border-slate-800 flex items-center justify-between bg-gray-50/50 dark:bg-slate-900/50">
        <div className="flex items-center gap-2">
          <Filter className="w-4 h-4 text-primary-500" />
          <span className="text-sm font-bold dark:text-gray-100">{t("common.filter") || "Filters"}</span>
          {activeCount > 0 && (
            <span className="text-[10px] font-bold bg-primary-100 dark:bg-primary-500/20 text-primary-700 dark:text-primary-300 px-2 py-0.5 rounded-full">
              {activeCount}
            </span>
          )}
        </div>
        {activeCount > 0 && (
          <button
            type="button"
            onClick={onClear}
            className="text-[11px] font-bold text-red-500 hover:text-red-600 flex items-center gap-1 transition-colors"
          >
            <RotateCcw className="w-3 h-3" />
            {t("common.clear") || "Clear all"}
          </button>
        )}
      </div>

      {/* Active chips */}
      {chipList.length > 0 && (
        <div className="px-4 py-2 border-b dark:border-slate-800 flex flex-wrap gap-1.5">
          {chipList.map((chip, i) => (
            <span
              key={i}
              className="inline-flex items-center gap-1 px-2 py-0.5 bg-primary-50 dark:bg-primary-500/10 text-primary-700 dark:text-primary-300 rounded-full text-[10px] font-bold"
            >
              {chip.label}
              <button type="button" onClick={chip.onRemove} className="hover:text-red-500 transition-colors">
                <X className="w-3 h-3" />
              </button>
            </span>
          ))}
        </div>
      )}

      {/* Filter sections */}
      <div className="divide-y dark:divide-slate-800">
        {/* Search */}
        <div className="px-4 py-2.5">
          <div className="relative group">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 group-focus-within:text-primary-500 transition-colors" />
            <input
              type="text"
              placeholder={t("zoom_in.search_placeholder") || "Search events..."}
              className="w-full pl-8 pr-3 py-1.5 bg-gray-50 dark:bg-slate-800 border border-transparent rounded-lg text-xs dark:text-gray-200 outline-none focus:border-primary-500 focus:ring-1 focus:ring-primary-500 transition-all"
              value={localSearch}
              onChange={(e) => updateSearch(e.target.value)}
            />
          </div>
        </div>

        {/* Date Range */}
        <FilterSection title={t("zoom_in.table.date") || "Date"} icon={Calendar}>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[10px] font-bold text-gray-400 uppercase block mb-1">{t("zoom_in.table.date_from") || "From"}</label>
              <input
                type="date"
                value={filters.date_from}
                onChange={(e) => update("date_from", e.target.value)}
                className="w-full p-2 bg-gray-50 dark:bg-slate-800 border border-transparent rounded-lg text-xs dark:text-gray-200 outline-none focus:border-primary-500 focus:ring-1 focus:ring-primary-500 transition-all"
              />
            </div>
            <div>
              <label className="text-[10px] font-bold text-gray-400 uppercase block mb-1">{t("zoom_in.table.date_to") || "To"}</label>
              <input
                type="date"
                value={filters.date_to}
                onChange={(e) => update("date_to", e.target.value)}
                className="w-full p-2 bg-gray-50 dark:bg-slate-800 border border-transparent rounded-lg text-xs dark:text-gray-200 outline-none focus:border-primary-500 focus:ring-1 focus:ring-primary-500 transition-all"
              />
            </div>
          </div>
        </FilterSection>

        {/* Event Type & Activity */}
        <FilterSection title={t("zoom_in.fields.event_type") || "Event Type & Activity"} icon={Tag}>
          <div>
            <label className="text-[10px] font-bold text-gray-400 uppercase block mb-1">{t("zoom_in.fields.event_type") || "Event Type"}</label>
            <SelectFilter
              value={filters.event_type_id ? String(filters.event_type_id) : ""}
              onChange={(v) => update("event_type_id", v ? Number(v) : null)}
              options={options.event_types.map((et) => ({ value: String(et.id), label: et.name }))}
              placeholder={t("zoom_in.fields.select_event_type") || "All types"}
            />
          </div>
          <div>
            <label className="text-[10px] font-bold text-gray-400 uppercase block mb-1">{t("zoom_in.fields.activity") || "Activity"}</label>
            <SelectFilter
              value={filters.activity_id ? String(filters.activity_id) : ""}
              onChange={(v) => update("activity_id", v ? Number(v) : null)}
              options={options.activities.map((a) => ({ value: String(a.id), label: a.name }))}
              placeholder={t("zoom_in.fields.select_activity") || "All activities"}
            />
          </div>
        </FilterSection>

        {/* Thana */}
        <FilterSection title={t("zoom_in.fields.thana") || "Thana"} icon={MapPin} defaultOpen={false}>
          <div>
            <input
              type="text"
              placeholder={t("zoom_in.search_placeholder") || "Search by thana..."}
              className="w-full p-2 bg-gray-50 dark:bg-slate-800 border border-transparent rounded-lg text-xs dark:text-gray-200 outline-none focus:border-primary-500 focus:ring-1 focus:ring-primary-500 transition-all"
              value={localThana}
              onChange={(e) => updateThana(e.target.value)}
            />
          </div>
        </FilterSection>
      </div>
    </div>
  );
}
