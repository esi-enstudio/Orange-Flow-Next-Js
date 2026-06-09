"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import {
  Search,
  ChevronDown,
  ChevronUp,
  X,
  Filter,
  RotateCcw,
  User,
  Briefcase,
  Activity,
  CreditCard,
  Smartphone,
  Bike,
  Car,
  Droplets,
  Church,
  Calendar,
  DollarSign,
  Check,
  Minus,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useLanguage } from "@/i18n/useLanguage";
import apiClient from "@/lib/api";

export interface EmployeeFilters {
  search: string;
  house_id: number | null;
  role: string;
  status: string;
  market_type: string;
  motor_bike: string;
  bicyle: string;
  driving_license: string;
  blood_group: string;
  religion: string;
  has_assisted_code: boolean | null;
  has_user: boolean | null;
  has_bank_info: boolean | null;
  joining_date_from: string;
  joining_date_to: string;
  resigned_date_from: string;
  resigned_date_to: string;
  salary_min: string;
  salary_max: string;
}

export const defaultFilters: EmployeeFilters = {
  search: "",
  role: "",
  status: "",
  market_type: "",
  motor_bike: "",
  bicyle: "",
  driving_license: "",
  blood_group: "",
  religion: "",
  has_assisted_code: null,
  has_user: null,
  has_bank_info: null,
  joining_date_from: "",
  joining_date_to: "",
  resigned_date_from: "",
  resigned_date_to: "",
  salary_min: "",
  salary_max: "",
  house_id: null,
};

interface House {
  id: number;
  name: string;
  code: string;
}

interface FilterOption {
  value: string;
  label: string;
}

interface FilterOptions {
  statuses: string[];
  market_types: string[];
  blood_groups: string[];
  religions: string[];
}

interface Props {
  filters: EmployeeFilters;
  onChange: (filters: EmployeeFilters) => void;
  onClear: () => void;
  houses: House[];
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
        <div className={cn(
          "transition-transform duration-300",
          open ? "rotate-180" : "rotate-0"
        )}>
          <ChevronDown className="w-3.5 h-3.5" />
        </div>
      </button>
      <div
        className="overflow-hidden transition-all duration-300 ease-in-out"
        style={{ maxHeight }}
      >
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
  options: FilterOption[];
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

export default function EmployeeMasterFilter({ filters, onChange, onClear, houses }: Props) {
  const { t } = useLanguage();
  const [options, setOptions] = useState<FilterOptions>({
    statuses: [],
    market_types: [],
    blood_groups: [],
    religions: [],
  });

  useEffect(() => {
    apiClient.get<FilterOptions>("/employees/filter-options").then((res) => {
      if (res.data) setOptions(res.data);
    }).catch(() => {});
  }, []);

  const update = useCallback(
    (key: keyof EmployeeFilters, value: any) => {
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
    const h = houses.find(h => h.id === filters.house_id);
    if (h) chipList.push({ label: `House: ${h.name}`, onRemove: () => update("house_id", null) });
  }
  if (filters.role) chipList.push({ label: `Role: ${filters.role}`, onRemove: () => update("role", "") });
  if (filters.status) chipList.push({ label: `Status: ${filters.status}`, onRemove: () => update("status", "") });
  if (filters.market_type) chipList.push({ label: `Market: ${filters.market_type}`, onRemove: () => update("market_type", "") });
  if (filters.blood_group) chipList.push({ label: `Blood: ${filters.blood_group}`, onRemove: () => update("blood_group", "") });
  if (filters.religion) chipList.push({ label: `Religion: ${filters.religion}`, onRemove: () => update("religion", "") });
  if (filters.has_assisted_code !== null) chipList.push({ label: `Assisted code: ${filters.has_assisted_code ? "Yes" : "No"}`, onRemove: () => update("has_assisted_code", null) });
  if (filters.has_user !== null) chipList.push({ label: `Has user: ${filters.has_user ? "Yes" : "No"}`, onRemove: () => update("has_user", null) });
  if (filters.has_bank_info !== null) chipList.push({ label: `Bank info: ${filters.has_bank_info ? "Yes" : "No"}`, onRemove: () => update("has_bank_info", null) });
  if (filters.joining_date_from) chipList.push({ label: `Joined from: ${filters.joining_date_from}`, onRemove: () => update("joining_date_from", "") });
  if (filters.joining_date_to) chipList.push({ label: `Joined to: ${filters.joining_date_to}`, onRemove: () => update("joining_date_to", "") });
  if (filters.resigned_date_from) chipList.push({ label: `Resigned from: ${filters.resigned_date_from}`, onRemove: () => update("resigned_date_from", "") });
  if (filters.resigned_date_to) chipList.push({ label: `Resigned to: ${filters.resigned_date_to}`, onRemove: () => update("resigned_date_to", "") });
  if (filters.salary_min) chipList.push({ label: `Salary min: ${filters.salary_min}`, onRemove: () => update("salary_min", "") });
  if (filters.salary_max) chipList.push({ label: `Salary max: ${filters.salary_max}`, onRemove: () => update("salary_max", "") });

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
              placeholder="Search employees..."
              className="w-full pl-8 pr-3 py-1.5 bg-gray-50 dark:bg-slate-800 border border-transparent rounded-lg text-xs dark:text-gray-200 outline-none focus:border-primary-500 focus:ring-1 focus:ring-primary-500 transition-all"
              value={filters.search}
              onChange={(e) => update("search", e.target.value)}
            />
          </div>
        </div>

        {/* House & Role */}
        <div className="px-4 py-2.5 border-b dark:border-slate-800 space-y-2.5">
          <div>
            <label className="text-[10px] font-bold text-gray-400 uppercase block mb-1">House</label>
            <SelectFilter
              value={filters.house_id ? String(filters.house_id) : ""}
              onChange={(v) => update("house_id", v ? Number(v) : null)}
              options={houses.map((h) => ({ value: String(h.id), label: `${h.name} (${h.code})` }))}
              placeholder="All houses"
            />
          </div>
          <div>
            <label className="text-[10px] font-bold text-gray-400 uppercase block mb-1">Role</label>
            <SelectFilter
              value={filters.role}
              onChange={(v) => update("role", v)}
              options={["RSO", "BP", "CC", "Supervisor", "Manager", "Distributor", "Admin"].map((r) => ({ value: r, label: r }))}
              placeholder="All roles"
            />
          </div>
        </div>

        {/* Status & Market Type */}
        <FilterSection title="Status & Type" icon={Activity}>
          <SelectFilter
            value={filters.status}
            onChange={(v) => update("status", v)}
            options={options.statuses.map((s) => ({ value: s, label: s }))}
            placeholder="All statuses"
          />
          <SelectFilter
            value={filters.market_type}
            onChange={(v) => update("market_type", v)}
            options={options.market_types.map((s) => ({ value: s, label: s }))}
            placeholder="All market types"
          />
        </FilterSection>

        {/* Personal */}
        <FilterSection title="Personal" icon={User} defaultOpen={false}>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[10px] font-bold text-gray-400 uppercase block mb-1">Blood Group</label>
              <SelectFilter
                value={filters.blood_group}
                onChange={(v) => update("blood_group", v)}
                options={options.blood_groups.map((s) => ({ value: s, label: s }))}
                placeholder="Any"
              />
            </div>
            <div>
              <label className="text-[10px] font-bold text-gray-400 uppercase block mb-1">Religion</label>
              <SelectFilter
                value={filters.religion}
                onChange={(v) => update("religion", v)}
                options={options.religions.map((s) => ({ value: s, label: s }))}
                placeholder="Any"
              />
            </div>
          </div>
        </FilterSection>

        {/* Assets */}
        <FilterSection title="Assets" icon={Bike} defaultOpen={false}>
          <div className="grid grid-cols-3 gap-2">
            <SelectFilter
              value={filters.motor_bike}
              onChange={(v) => update("motor_bike", v)}
              options={[{ value: "Yes", label: "Yes" }, { value: "No", label: "No" }]}
              placeholder="Motor bike"
            />
            <SelectFilter
              value={filters.bicyle}
              onChange={(v) => update("bicyle", v)}
              options={[{ value: "Yes", label: "Yes" }, { value: "No", label: "No" }]}
              placeholder="Bicycle"
            />
            <SelectFilter
              value={filters.driving_license}
              onChange={(v) => update("driving_license", v)}
              options={[{ value: "Yes", label: "Yes" }, { value: "No", label: "No" }]}
              placeholder="License"
            />
          </div>
        </FilterSection>

        {/* Presence toggles */}
        <FilterSection title="Presence" icon={Check} defaultOpen={false}>
          <div className="space-y-2">
            <ToggleFilter
              value={filters.has_assisted_code}
              onChange={(v) => update("has_assisted_code", v)}
              label="Assisted retailer code"
            />
            <ToggleFilter
              value={filters.has_user}
              onChange={(v) => update("has_user", v)}
              label="Linked user"
            />
            <ToggleFilter
              value={filters.has_bank_info}
              onChange={(v) => update("has_bank_info", v)}
              label="Bank info"
            />
          </div>
        </FilterSection>

        {/* Date ranges */}
        <FilterSection title="Joining Date" icon={Calendar} defaultOpen={false}>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[10px] font-bold text-gray-400 uppercase block mb-1">From</label>
              <input
                type="date"
                value={filters.joining_date_from}
                onChange={(e) => update("joining_date_from", e.target.value)}
                className="w-full p-2 bg-gray-50 dark:bg-slate-800 border border-transparent rounded-lg text-xs dark:text-gray-200 outline-none focus:border-primary-500 focus:ring-1 focus:ring-primary-500 transition-all"
              />
            </div>
            <div>
              <label className="text-[10px] font-bold text-gray-400 uppercase block mb-1">To</label>
              <input
                type="date"
                value={filters.joining_date_to}
                onChange={(e) => update("joining_date_to", e.target.value)}
                className="w-full p-2 bg-gray-50 dark:bg-slate-800 border border-transparent rounded-lg text-xs dark:text-gray-200 outline-none focus:border-primary-500 focus:ring-1 focus:ring-primary-500 transition-all"
              />
            </div>
          </div>
        </FilterSection>

        <FilterSection title="Resigned Date" icon={Calendar} defaultOpen={false}>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[10px] font-bold text-gray-400 uppercase block mb-1">From</label>
              <input
                type="date"
                value={filters.resigned_date_from}
                onChange={(e) => update("resigned_date_from", e.target.value)}
                className="w-full p-2 bg-gray-50 dark:bg-slate-800 border border-transparent rounded-lg text-xs dark:text-gray-200 outline-none focus:border-primary-500 focus:ring-1 focus:ring-primary-500 transition-all"
              />
            </div>
            <div>
              <label className="text-[10px] font-bold text-gray-400 uppercase block mb-1">To</label>
              <input
                type="date"
                value={filters.resigned_date_to}
                onChange={(e) => update("resigned_date_to", e.target.value)}
                className="w-full p-2 bg-gray-50 dark:bg-slate-800 border border-transparent rounded-lg text-xs dark:text-gray-200 outline-none focus:border-primary-500 focus:ring-1 focus:ring-primary-500 transition-all"
              />
            </div>
          </div>
        </FilterSection>

        {/* Salary range */}
        <FilterSection title="Salary Range" icon={DollarSign} defaultOpen={false}>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[10px] font-bold text-gray-400 uppercase block mb-1">Min</label>
              <input
                type="number"
                placeholder="0"
                value={filters.salary_min}
                onChange={(e) => update("salary_min", e.target.value)}
                className="w-full p-2 bg-gray-50 dark:bg-slate-800 border border-transparent rounded-lg text-xs dark:text-gray-200 outline-none focus:border-primary-500 focus:ring-1 focus:ring-primary-500 transition-all"
              />
            </div>
            <div>
              <label className="text-[10px] font-bold text-gray-400 uppercase block mb-1">Max</label>
              <input
                type="number"
                placeholder="999999"
                value={filters.salary_max}
                onChange={(e) => update("salary_max", e.target.value)}
                className="w-full p-2 bg-gray-50 dark:bg-slate-800 border border-transparent rounded-lg text-xs dark:text-gray-200 outline-none focus:border-primary-500 focus:ring-1 focus:ring-primary-500 transition-all"
              />
            </div>
          </div>
        </FilterSection>
      </div>
    </div>
  );
}
