"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import {
  Search,
  ChevronDown,
  X,
  Filter,
  RotateCcw,
  Building2,
  Calendar,
} from "lucide-react";
import { cn } from "@/lib/utils";
import apiClient from "@/lib/api";

export interface BpTargetsFilters {
  search: string;
  house_id: string;
  target_month: string;
  employee_id: string;
}

export const defaultBpTargetsFilters: BpTargetsFilters = {
  search: "",
  house_id: "",
  target_month: "",
  employee_id: "",
};

interface HouseItem {
  id: number;
  name: string;
  code: string;
  display_name?: string;
}

interface BPItem {
  id: number;
  name?: string;
  employee_id?: string;
  dms_code?: string;
  pool_number?: string;
}

interface Props {
  filters: BpTargetsFilters;
  onChange: (filters: BpTargetsFilters) => void;
  onClear: () => void;
  defaultMonth: string;
}

export default function BpTargetsFilter({ filters, onChange, onClear, defaultMonth }: Props) {
  const [houses, setHouses] = useState<HouseItem[]>([]);
  const [bpList, setBpList] = useState<BPItem[]>([]);

  useEffect(() => {
    apiClient.get<HouseItem[]>("houses/accessible").then((res) => {
      if (res.data) setHouses(res.data);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    const params: Record<string, any> = {};
    if (filters.house_id) params.house_id = filters.house_id;
    apiClient.get<BPItem[]>("bp-retailer-codes/bp-employees", { params }).then((res) => {
      if (res.data) setBpList(res.data);
    }).catch(() => {});
  }, [filters.house_id]);

  const update = useCallback(
    (key: keyof BpTargetsFilters, value: any) => {
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
  if (filters.house_id) {
    const house = houses.find((h) => String(h.id) === filters.house_id);
    chipList.push({ label: `House: ${house?.display_name || house?.name || filters.house_id}`, onRemove: () => update("house_id", "") });
  }
  if (filters.target_month) chipList.push({ label: `Month: ${filters.target_month}`, onRemove: () => update("target_month", "") });
  if (filters.employee_id) {
    const bp = bpList.find((b) => String(b.id) === filters.employee_id);
    chipList.push({ label: `BP: ${bp?.name || bp?.employee_id || filters.employee_id}`, onRemove: () => update("employee_id", "") });
  }

  return (
    <div className="bg-white dark:bg-slate-900 rounded-2xl border dark:border-slate-800 shadow-sm overflow-hidden">
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

      <div className="divide-y dark:divide-slate-800">
        {/* Search */}
        <div className="px-4 py-2.5">
          <div className="relative group">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 group-focus-within:text-primary-500 transition-colors" />
            <input
              type="text"
              placeholder="Search by employee ID, iTop or phone..."
              className="w-full pl-8 pr-3 py-1.5 bg-gray-50 dark:bg-slate-800 border border-transparent rounded-lg text-xs dark:text-gray-200 outline-none focus:border-primary-500 focus:ring-1 focus:ring-primary-500 transition-all"
              value={filters.search}
              onChange={(e) => update("search", e.target.value)}
            />
          </div>
        </div>

        {/* House Filter */}
        <div className="border-b dark:border-slate-800 last:border-b-0">
          <div className="px-4 py-2.5">
            <label className="text-[10px] font-bold text-gray-400 uppercase block mb-1">
              <Building2 className="w-3 h-3 inline mr-1" />
              Select House
            </label>
            <select
              value={filters.house_id}
              onChange={(e) => update("house_id", e.target.value)}
              className="w-full p-1.5 bg-gray-50 dark:bg-slate-800 border border-transparent rounded-lg text-xs dark:text-gray-200 outline-none focus:border-primary-500 focus:ring-1 focus:ring-primary-500 transition-all appearance-none"
            >
              <option value="">All houses</option>
              {houses.map((h) => (
                <option key={h.id} value={String(h.id)}>{h.display_name || `${h.name} (${h.code})`}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Month Filter */}
        <div className="border-b dark:border-slate-800 last:border-b-0">
          <div className="px-4 py-2.5">
            <label className="text-[10px] font-bold text-gray-400 uppercase block mb-1">
              <Calendar className="w-3 h-3 inline mr-1" />
              Target Month
            </label>
            <input
              type="month"
              value={filters.target_month || defaultMonth.substring(0, 7)}
              onChange={(e) => update("target_month", e.target.value)}
              className="w-full p-1.5 bg-gray-50 dark:bg-slate-800 border border-transparent rounded-lg text-xs dark:text-gray-200 outline-none focus:border-primary-500 focus:ring-1 focus:ring-primary-500 transition-all"
            />
          </div>
        </div>

        {/* BP Employee Filter */}
        <div className="border-b dark:border-slate-800 last:border-b-0">
          <div className="px-4 py-2.5">
            <label className="text-[10px] font-bold text-gray-400 uppercase block mb-1">
              <Search className="w-3 h-3 inline mr-1" />
              BP Employee
            </label>
            <select
              value={filters.employee_id}
              onChange={(e) => update("employee_id", e.target.value)}
              className="w-full p-1.5 bg-gray-50 dark:bg-slate-800 border border-transparent rounded-lg text-xs dark:text-gray-200 outline-none focus:border-primary-500 focus:ring-1 focus:ring-primary-500 transition-all appearance-none"
            >
              <option value="">All BPs</option>
              {bpList.map((bp) => (
                <option key={bp.id} value={String(bp.id)}>
                  {bp.name || bp.employee_id || `BP #${bp.id}`} {bp.dms_code ? `(${bp.dms_code})` : ""}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>
    </div>
  );
}
