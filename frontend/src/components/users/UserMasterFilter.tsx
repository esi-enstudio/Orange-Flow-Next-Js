"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import {
  Search,
  ChevronDown,
  X,
  Filter,
  RotateCcw,
  User,
  Activity,
  Calendar,
  Clock,
  Phone,
  Hash,
  Building2,
  Briefcase,
  Check,
  Minus,
} from "lucide-react";
import { cn } from "@/lib/utils";
import apiClient from "@/lib/api";
import type { UserFilters } from "@/types/user";

export const defaultFilters: UserFilters = {
  search: "",
  status: "",
  role_ids: [],
  house_ids: [],
  parent_id: null,
  phone_number: "",
  telegram_id: "",
  has_employee_profile: null,
  created_from: "",
  created_to: "",
  updated_from: "",
  updated_to: "",
};

interface House {
  id: number;
  name: string;
  code: string;
}

interface Role {
  id: number;
  name: string;
}

interface ParentUser {
  id: number;
  name: string;
  username: string;
}

interface FilterOptions {
  statuses: string[];
  roles: Role[];
  parents: ParentUser[];
}

interface Props {
  filters: UserFilters;
  onChange: (filters: UserFilters) => void;
  onClear: () => void;
  houses: House[];
  roles: Role[];
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

function ToggleFilter({
  value,
  onChange,
  label,
}: {
  value: boolean | null;
  onChange: (v: boolean | null) => void;
  label: string;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-[11px] text-gray-500 font-medium whitespace-nowrap">{label}</span>
      <div className="flex rounded-lg overflow-hidden border dark:border-slate-700">
        <button
          type="button"
          onClick={() => onChange(value === true ? null : true)}
          className={cn(
            "px-2.5 py-1 text-[10px] font-bold transition-all",
            value === true
              ? "bg-green-500 text-white"
              : "bg-gray-50 dark:bg-slate-800 text-gray-400 hover:text-green-600"
          )}
        >
          <Check className="w-3 h-3" />
        </button>
        <button
          type="button"
          onClick={() => onChange(value === false ? null : false)}
          className={cn(
            "px-2.5 py-1 text-[10px] font-bold transition-all",
            value === false
              ? "bg-red-500 text-white"
              : "bg-gray-50 dark:bg-slate-800 text-gray-400 hover:text-red-600"
          )}
        >
          <Minus className="w-3 h-3" />
        </button>
      </div>
    </div>
  );
}

export default function UserMasterFilter({ filters, onChange, onClear, houses, roles }: Props) {
  const [options, setOptions] = useState<FilterOptions>({
    statuses: [],
    roles: [],
    parents: [],
  });

  useEffect(() => {
    apiClient.get<FilterOptions>("/users/filter-options").then((res) => {
      if (res.data) setOptions(res.data);
    }).catch(() => {});
  }, []);

  const update = useCallback(
    (key: keyof UserFilters, value: any) => {
      onChange({ ...filters, [key]: value });
    },
    [filters, onChange]
  );

  const activeCount = Object.entries(filters).filter(([key, val]) => {
    if (key === "search") return (val as string).length > 0;
    if (key === "role_ids" || key === "house_ids") return (val as number[]).length > 0;
    if (val === null || val === "") return false;
    return true;
  }).length;

  const chipList: { label: string; onRemove: () => void }[] = [];
  if (filters.status) chipList.push({ label: `Status: ${filters.status}`, onRemove: () => update("status", "") });
  if (filters.role_ids.length) {
    filters.role_ids.forEach(id => {
      const r = [...options.roles, ...roles].find(rr => rr.id === id);
      if (r) chipList.push({ label: `Role: ${r.name}`, onRemove: () => update("role_ids", filters.role_ids.filter(i => i !== id)) });
    });
  }
  if (filters.house_ids.length) {
    filters.house_ids.forEach(id => {
      const h = houses.find(hh => hh.id === id);
      if (h) chipList.push({ label: `House: ${h.name}`, onRemove: () => update("house_ids", filters.house_ids.filter(i => i !== id)) });
    });
  }
  if (filters.parent_id) {
    const p = options.parents.find(pp => pp.id === filters.parent_id);
    if (p) chipList.push({ label: `Reports to: ${p.name}`, onRemove: () => update("parent_id", null) });
  }
  if (filters.phone_number) chipList.push({ label: `Phone: ${filters.phone_number}`, onRemove: () => update("phone_number", "") });
  if (filters.telegram_id) chipList.push({ label: `Telegram: ${filters.telegram_id}`, onRemove: () => update("telegram_id", "") });
  if (filters.has_employee_profile !== null) chipList.push({ label: `Employee profile: ${filters.has_employee_profile ? "Yes" : "No"}`, onRemove: () => update("has_employee_profile", null) });
  if (filters.created_from) chipList.push({ label: `Created from: ${filters.created_from}`, onRemove: () => update("created_from", "") });
  if (filters.created_to) chipList.push({ label: `Created to: ${filters.created_to}`, onRemove: () => update("created_to", "") });
  if (filters.updated_from) chipList.push({ label: `Updated from: ${filters.updated_from}`, onRemove: () => update("updated_from", "") });
  if (filters.updated_to) chipList.push({ label: `Updated to: ${filters.updated_to}`, onRemove: () => update("updated_to", "") });

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
              placeholder="Search users..."
              className="w-full pl-8 pr-3 py-1.5 bg-gray-50 dark:bg-slate-800 border border-transparent rounded-lg text-xs dark:text-gray-200 outline-none focus:border-primary-500 focus:ring-1 focus:ring-primary-500 transition-all"
              value={filters.search}
              onChange={(e) => update("search", e.target.value)}
            />
          </div>
        </div>

        {/* Status */}
        <FilterSection title="Status" icon={Activity}>
          <SelectFilter
            value={filters.status}
            onChange={(v) => update("status", v)}
            options={options.statuses.map((s) => ({ value: s, label: s }))}
            placeholder="All statuses"
          />
          <ToggleFilter
            value={filters.has_employee_profile}
            onChange={(v) => update("has_employee_profile", v)}
            label="Has employee profile"
          />
        </FilterSection>

        {/* Roles & Houses */}
        <FilterSection title="Roles & Houses" icon={Briefcase}>
          <div>
            <label className="text-[10px] font-bold text-gray-400 uppercase block mb-1">Roles</label>
            <div className="flex flex-wrap gap-1.5 p-2 bg-gray-50 dark:bg-slate-800 rounded-lg">
              {(options.roles.length ? options.roles : roles).map((r) => {
                const selected = filters.role_ids.includes(r.id);
                return (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => {
                      update("role_ids", selected
                        ? filters.role_ids.filter(id => id !== r.id)
                        : [...filters.role_ids, r.id]
                      );
                    }}
                    className={cn(
                      "px-2 py-1 text-[10px] font-bold rounded-full border transition-all",
                      selected
                        ? "bg-blue-500 border-blue-500 text-white"
                        : "bg-white dark:bg-slate-900 border-gray-200 dark:border-slate-700 text-gray-500 hover:border-blue-300"
                    )}
                  >
                    {r.name}
                  </button>
                );
              })}
            </div>
          </div>
          <div>
            <label className="text-[10px] font-bold text-gray-400 uppercase block mb-1">Houses</label>
            <div className="flex flex-wrap gap-1.5 p-2 bg-gray-50 dark:bg-slate-800 rounded-lg max-h-[120px] overflow-y-auto">
              {houses.map((h) => {
                const selected = filters.house_ids.includes(h.id);
                return (
                  <button
                    key={h.id}
                    type="button"
                    onClick={() => {
                      update("house_ids", selected
                        ? filters.house_ids.filter(id => id !== h.id)
                        : [...filters.house_ids, h.id]
                      );
                    }}
                    className={cn(
                      "px-2 py-1 text-[10px] font-bold rounded-full border transition-all",
                      selected
                        ? "bg-purple-500 border-purple-500 text-white"
                        : "bg-white dark:bg-slate-900 border-gray-200 dark:border-slate-700 text-gray-500 hover:border-purple-300"
                    )}
                  >
                    {h.name} ({h.code})
                  </button>
                );
              })}
            </div>
          </div>
        </FilterSection>

        {/* Reporting Line */}
        <FilterSection title="Reporting Line" icon={User} defaultOpen={false}>
          <div>
            <label className="text-[10px] font-bold text-gray-400 uppercase block mb-1">Reports to</label>
            <SelectFilter
              value={filters.parent_id ? String(filters.parent_id) : ""}
              onChange={(v) => update("parent_id", v ? Number(v) : null)}
              options={options.parents.map((p) => ({ value: String(p.id), label: `${p.name} (@${p.username})` }))}
              placeholder="Any parent"
            />
          </div>
        </FilterSection>

        {/* Contact */}
        <FilterSection title="Contact" icon={Phone} defaultOpen={false}>
          <div className="space-y-2">
            <div>
              <label className="text-[10px] font-bold text-gray-400 uppercase block mb-1">Phone number</label>
              <input
                type="text"
                placeholder="Search by phone..."
                value={filters.phone_number}
                onChange={(e) => update("phone_number", e.target.value)}
                className="w-full p-2 bg-gray-50 dark:bg-slate-800 border border-transparent rounded-lg text-xs dark:text-gray-200 outline-none focus:border-primary-500 focus:ring-1 focus:ring-primary-500 transition-all"
              />
            </div>
            <div>
              <label className="text-[10px] font-bold text-gray-400 uppercase block mb-1">Telegram ID</label>
              <input
                type="text"
                placeholder="Search by Telegram ID..."
                value={filters.telegram_id}
                onChange={(e) => update("telegram_id", e.target.value)}
                className="w-full p-2 bg-gray-50 dark:bg-slate-800 border border-transparent rounded-lg text-xs dark:text-gray-200 outline-none focus:border-primary-500 focus:ring-1 focus:ring-primary-500 transition-all"
              />
            </div>
          </div>
        </FilterSection>

        {/* Created Date */}
        <FilterSection title="Created Date" icon={Calendar} defaultOpen={false}>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[10px] font-bold text-gray-400 uppercase block mb-1">From</label>
              <input
                type="date"
                value={filters.created_from}
                onChange={(e) => update("created_from", e.target.value)}
                className="w-full p-2 bg-gray-50 dark:bg-slate-800 border border-transparent rounded-lg text-xs dark:text-gray-200 outline-none focus:border-primary-500 focus:ring-1 focus:ring-primary-500 transition-all"
              />
            </div>
            <div>
              <label className="text-[10px] font-bold text-gray-400 uppercase block mb-1">To</label>
              <input
                type="date"
                value={filters.created_to}
                onChange={(e) => update("created_to", e.target.value)}
                className="w-full p-2 bg-gray-50 dark:bg-slate-800 border border-transparent rounded-lg text-xs dark:text-gray-200 outline-none focus:border-primary-500 focus:ring-1 focus:ring-primary-500 transition-all"
              />
            </div>
          </div>
        </FilterSection>

        {/* Updated Date */}
        <FilterSection title="Updated Date" icon={Clock} defaultOpen={false}>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[10px] font-bold text-gray-400 uppercase block mb-1">From</label>
              <input
                type="date"
                value={filters.updated_from}
                onChange={(e) => update("updated_from", e.target.value)}
                className="w-full p-2 bg-gray-50 dark:bg-slate-800 border border-transparent rounded-lg text-xs dark:text-gray-200 outline-none focus:border-primary-500 focus:ring-1 focus:ring-primary-500 transition-all"
              />
            </div>
            <div>
              <label className="text-[10px] font-bold text-gray-400 uppercase block mb-1">To</label>
              <input
                type="date"
                value={filters.updated_to}
                onChange={(e) => update("updated_to", e.target.value)}
                className="w-full p-2 bg-gray-50 dark:bg-slate-800 border border-transparent rounded-lg text-xs dark:text-gray-200 outline-none focus:border-primary-500 focus:ring-1 focus:ring-primary-500 transition-all"
              />
            </div>
          </div>
        </FilterSection>
      </div>
    </div>
  );
}
