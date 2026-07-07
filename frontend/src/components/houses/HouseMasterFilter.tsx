"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import {
  Search,
  ChevronDown,
  X,
  Filter,
  RotateCcw,
  MapPin,
  Layers,
  Globe,
  Activity,
} from "lucide-react";
import { cn } from "@/lib/utils";
import apiClient from "@/lib/api";
import type { HouseFilters } from "@/types/house";

interface FilterOptions {
  clusters: string[];
  regions: string[];
  wh_regions: string[];
  districts: string[];
}

interface Props {
  filters: HouseFilters;
  onChange: (filters: HouseFilters) => void;
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
  options: string[];
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
        <option key={opt} value={opt}>{opt}</option>
      ))}
    </select>
  );
}

export default function HouseMasterFilter({ filters, onChange, onClear }: Props) {
  const [options, setOptions] = useState<FilterOptions>({
    clusters: [],
    regions: [],
    wh_regions: [],
    districts: [],
  });

  useEffect(() => {
    apiClient.get<FilterOptions>("/houses/filter-options").then((res) => {
      if (res.data) setOptions(res.data);
    }).catch(() => {});
  }, []);

  const update = useCallback(
    (key: keyof HouseFilters, value: any) => {
      onChange({ ...filters, [key]: value });
    },
    [filters, onChange]
  );

  const activeCount = Object.entries(filters).filter(([key, val]) => {
    if (key === "search") return (val as string).length > 0;
    if (val === null || val === "") return false;
    return true;
  }).length;

  const chipList: { label: string; onRemove: () => void }[] = [];
  if (filters.cluster) chipList.push({ label: `Cluster: ${filters.cluster}`, onRemove: () => update("cluster", "") });
  if (filters.region) chipList.push({ label: `Region: ${filters.region}`, onRemove: () => update("region", "") });
  if (filters.wh_region) chipList.push({ label: `WH Region: ${filters.wh_region}`, onRemove: () => update("wh_region", "") });
  if (filters.district) chipList.push({ label: `District: ${filters.district}`, onRemove: () => update("district", "") });
  if (filters.is_active !== null) chipList.push({ label: `Status: ${filters.is_active ? "Active" : "Inactive"}`, onRemove: () => update("is_active", null) });

  return (
    <div className="bg-white dark:bg-slate-900 rounded-2xl border dark:border-slate-800 shadow-sm overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b dark:border-slate-800 flex items-center justify-between bg-gray-50/50 dark:bg-slate-900/50">
        <div className="flex items-center gap-2">
          <Filter className="w-4 h-4 text-primary-500" />
          <span className="text-sm font-bold dark:text-gray-100">Filters</span>
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
            Clear all
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
              placeholder="Search houses..."
              className="w-full pl-8 pr-3 py-1.5 bg-gray-50 dark:bg-slate-800 border border-transparent rounded-lg text-xs dark:text-gray-200 outline-none focus:border-primary-500 focus:ring-1 focus:ring-primary-500 transition-all"
              value={filters.search}
              onChange={(e) => update("search", e.target.value)}
            />
          </div>
        </div>

        {/* Location Filters */}
        <FilterSection title="Location" icon={MapPin}>
          <SelectFilter
            value={filters.cluster}
            onChange={(v) => update("cluster", v)}
            options={options.clusters}
            placeholder="All clusters"
          />
          <SelectFilter
            value={filters.region}
            onChange={(v) => update("region", v)}
            options={options.regions}
            placeholder="All regions"
          />
          <SelectFilter
            value={filters.wh_region}
            onChange={(v) => update("wh_region", v)}
            options={options.wh_regions}
            placeholder="All WH regions"
          />
          <SelectFilter
            value={filters.district}
            onChange={(v) => update("district", v)}
            options={options.districts}
            placeholder="All districts"
          />
        </FilterSection>

        {/* Status */}
        <FilterSection title="Status" icon={Activity} defaultOpen={false}>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => update("is_active", filters.is_active === true ? null : true)}
              className={cn(
                "flex-1 p-2 text-[11px] font-bold rounded-lg border transition-all",
                filters.is_active === true
                  ? "bg-green-500 border-green-500 text-white"
                  : "bg-gray-50 dark:bg-slate-800 border-transparent text-gray-500 hover:border-green-300"
              )}
            >
              Active
            </button>
            <button
              type="button"
              onClick={() => update("is_active", filters.is_active === false ? null : false)}
              className={cn(
                "flex-1 p-2 text-[11px] font-bold rounded-lg border transition-all",
                filters.is_active === false
                  ? "bg-red-500 border-red-500 text-white"
                  : "bg-gray-50 dark:bg-slate-800 border-transparent text-gray-500 hover:border-red-300"
              )}
            >
              Inactive
            </button>
          </div>
        </FilterSection>
      </div>
    </div>
  );
}
