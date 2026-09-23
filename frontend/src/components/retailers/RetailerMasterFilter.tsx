"use client";

import { useEffect, useState, useCallback, type ReactNode } from "react";
import {
  Search,
  ChevronDown,
  X,
  Filter,
  RotateCcw,
  Store,
  User,
  MapPin,
  Hash,
  Check,
  Minus,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useLanguage } from "@/i18n/useLanguage";
import apiClient from "@/lib/api";

export interface RetailerFilters {
  search: string;
  house_id: number | null;
  retailer_type: string;
  enabled: string;
  sim_seller: string;
  category: string;
  district: string;
  thana: string;
  route: string;
  has_employee: boolean | null;
  employee_id: number | null;
}

export const defaultFilters: RetailerFilters = {
  search: "",
  house_id: null,
  retailer_type: "",
  enabled: "",
  sim_seller: "",
  category: "",
  district: "",
  thana: "",
  route: "",
  has_employee: null,
  employee_id: null,
};

interface House {
  id: number;
  name: string;
  code: string;
}

interface Employee {
  id: number;
  dms_code: string;
  itop_number: string;
  employee_name?: string;
  user?: { name: string };
}

interface Props {
  filters: RetailerFilters;
  onChange: (filters: RetailerFilters) => void;
  onClear: () => void;
  houses: House[];
  selectedHouseId?: number | null;
}

function FilterSection({ title, icon: Icon, children, defaultOpen = true }: { title: string; icon: LucideIcon; children: ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-b dark:border-slate-800 last:border-b-0">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-4 py-2.5 text-[11px] font-bold text-gray-500 uppercase tracking-widest hover:bg-gray-50 dark:hover:bg-slate-800/50 transition-colors cursor-pointer"
      >
        <div className="flex items-center gap-2">
          <Icon className="w-3.5 h-3.5" />
          <span>{title}</span>
        </div>
        <div className={cn("transition-transform duration-300", open ? "rotate-180" : "rotate-0")}>
          <ChevronDown className="w-3.5 h-3.5" />
        </div>
      </button>
      <div className={cn("overflow-hidden transition-all duration-300 ease-in-out", open ? "max-h-[500px]" : "max-h-0")}>
        <div className="px-4 pb-3 space-y-2.5">
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
      className="w-full p-2 bg-gray-50 dark:bg-slate-800 border border-transparent rounded-lg text-xs dark:text-gray-200 outline-none focus:border-primary-500 focus:ring-1 focus:ring-primary-500 transition-all appearance-none cursor-pointer"
    >
      <option value="">{placeholder}</option>
      {options.map((opt) => (
        <option key={opt.value} value={opt.value}>{opt.label}</option>
      ))}
    </select>
  );
}

function TextFilter({
  value,
  onChange,
  placeholder,
  icon: Icon,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  icon: LucideIcon;
}) {
  return (
    <div className="relative group">
      <Icon className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 group-focus-within:text-primary-500 transition-colors" />
      <input
        type="text"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full pl-8 pr-3 py-1.5 bg-gray-50 dark:bg-slate-800 border border-transparent rounded-lg text-xs dark:text-gray-200 outline-none focus:border-primary-500 focus:ring-1 focus:ring-primary-500 transition-all"
      />
    </div>
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
            "px-2.5 py-1 text-[10px] font-bold transition-all cursor-pointer",
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
            "px-2.5 py-1 text-[10px] font-bold transition-all cursor-pointer",
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

export default function RetailerMasterFilter({ filters, onChange, onClear, houses, selectedHouseId }: Props) {
  const { t } = useLanguage();
  const [employees, setEmployees] = useState<Employee[]>([]);

  const effectiveHouseId = filters.house_id ?? selectedHouseId ?? null;

  useEffect(() => {
    const params = new URLSearchParams();
    params.set("status", "Active");
    params.set("employee_type", "rso");
    params.set("sort_by", "dms_code");
    params.set("sort_order", "asc");
    params.set("per_page", "100");
    if (effectiveHouseId) params.set("filter_house_id", String(effectiveHouseId));
    apiClient.get<{ data: Employee[] }>(`employees?${params.toString()}`)
      .then((res) => setEmployees(res.data.data || []))
      .catch(() => {});
  }, [effectiveHouseId]);

  const update = useCallback(
    (key: keyof RetailerFilters, value: any) => {
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
  if (filters.retailer_type) chipList.push({ label: `Type: ${filters.retailer_type}`, onRemove: () => update("retailer_type", "") });
  if (filters.enabled) chipList.push({ label: `Enabled: ${filters.enabled}`, onRemove: () => update("enabled", "") });
  if (filters.sim_seller) chipList.push({ label: `SIM seller: ${filters.sim_seller}`, onRemove: () => update("sim_seller", "") });
  if (filters.category) chipList.push({ label: `Category: ${filters.category}`, onRemove: () => update("category", "") });
  if (filters.district) chipList.push({ label: `District: ${filters.district}`, onRemove: () => update("district", "") });
  if (filters.thana) chipList.push({ label: `Thana: ${filters.thana}`, onRemove: () => update("thana", "") });
  if (filters.route) chipList.push({ label: `Route: ${filters.route}`, onRemove: () => update("route", "") });
  if (filters.employee_id) {
    const e = employees.find(e => e.id === filters.employee_id);
    if (e) chipList.push({ label: `RSO: ${e.user?.name || e.employee_name || e.dms_code}`, onRemove: () => update("employee_id", null) });
  }
  if (filters.has_employee !== null) chipList.push({ label: `Linked RSO: ${filters.has_employee ? "Yes" : "No"}`, onRemove: () => update("has_employee", null) });

  return (
    <div className="bg-white dark:bg-slate-900 rounded-2xl border dark:border-slate-800 shadow-sm overflow-hidden">
      <div className="px-4 py-3 border-b dark:border-slate-800 flex items-center justify-between bg-gray-50/50 dark:bg-slate-900/50">
        <div className="flex items-center gap-2">
          <Filter className="w-4 h-4 text-primary-500" />
          <span className="text-sm font-bold dark:text-gray-100">{t('retailers.filters_title')}</span>
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
            className="text-[11px] font-bold text-red-500 hover:text-red-600 flex items-center gap-1 transition-colors cursor-pointer"
          >
            <RotateCcw className="w-3 h-3" />
            {t('retailers.filters_clear_all')}
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
              <button type="button" onClick={chip.onRemove} className="hover:text-red-500 transition-colors cursor-pointer">
                <X className="w-3 h-3" />
              </button>
            </span>
          ))}
        </div>
      )}

      <div className="divide-y dark:divide-slate-800">
        <div className="px-4 py-2.5">
          <div className="relative group">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 group-focus-within:text-primary-500 transition-colors" />
            <input
              type="text"
              placeholder={t('retailers.search_placeholder')}
              className="w-full pl-8 pr-3 py-1.5 bg-gray-50 dark:bg-slate-800 border border-transparent rounded-lg text-xs dark:text-gray-200 outline-none focus:border-primary-500 focus:ring-1 focus:ring-primary-500 transition-all"
              value={filters.search}
              onChange={(e) => update("search", e.target.value)}
            />
          </div>
        </div>

        <div className="px-4 py-2.5 space-y-2.5">
          <div>
            <label className="text-[10px] font-bold text-gray-400 uppercase block mb-1">{t('retailers.field_house')}</label>
            <SelectFilter
              value={filters.house_id ? String(filters.house_id) : ""}
              onChange={(v) => update("house_id", v ? Number(v) : null)}
              options={houses.map((h) => ({ value: String(h.id), label: `${h.name} (${h.code})` }))}
              placeholder={t('retailers.filters_all_houses')}
            />
          </div>
          <div>
            <label className="text-[10px] font-bold text-gray-400 uppercase block mb-1">{t('retailers.filters_rso')}</label>
            <SelectFilter
              value={filters.employee_id ? String(filters.employee_id) : ""}
              onChange={(v) => update("employee_id", v ? Number(v) : null)}
              options={employees.map((e) => ({ value: String(e.id), label: `${e.user?.name || e.employee_name || e.dms_code}${e.itop_number ? ` (${e.itop_number})` : ""}` }))}
              placeholder={t('retailers.filters_all_rsos')}
            />
          </div>
          <div>
            <label className="text-[10px] font-bold text-gray-400 uppercase block mb-1">{t('retailers.field_type')}</label>
            <SelectFilter
              value={filters.retailer_type}
              onChange={(v) => update("retailer_type", v)}
              options={["Regular", "BP Assisted"].map((r) => ({ value: r, label: r }))}
              placeholder={t('retailers.filters_all_types')}
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[10px] font-bold text-gray-400 uppercase block mb-1">{t('common.enabled')}</label>
              <SelectFilter
                value={filters.enabled}
                onChange={(v) => update("enabled", v)}
                options={[
                  { value: "Yes", label: t('common.yes') },
                  { value: "No", label: t('common.no') },
                ]}
                placeholder="Any"
              />
            </div>
            <div>
              <label className="text-[10px] font-bold text-gray-400 uppercase block mb-1">{t('retailers.field_sim_seller')}</label>
              <SelectFilter
                value={filters.sim_seller}
                onChange={(v) => update("sim_seller", v)}
                options={[
                  { value: "Yes", label: t('common.yes') },
                  { value: "No", label: t('common.no') },
                ]}
                placeholder="Any"
              />
            </div>
          </div>
        </div>

        <FilterSection title={t('retailers.filters_location')} icon={MapPin} defaultOpen={false}>
          <div className="grid grid-cols-2 gap-2">
            <TextFilter value={filters.category} onChange={(v) => update("category", v)} placeholder={t('retailers.filters_category')} icon={Store} />
            <TextFilter value={filters.route} onChange={(v) => update("route", v)} placeholder={t('retailers.filters_route')} icon={Hash} />
            <TextFilter value={filters.district} onChange={(v) => update("district", v)} placeholder={t('retailers.filters_district')} icon={MapPin} />
            <TextFilter value={filters.thana} onChange={(v) => update("thana", v)} placeholder={t('retailers.filters_thana')} icon={MapPin} />
          </div>
        </FilterSection>

        <FilterSection title={t('retailers.filters_presence')} icon={User} defaultOpen={false}>
          <div className="space-y-2">
            <ToggleFilter
              value={filters.has_employee}
              onChange={(v) => { update("has_employee", v); if (v !== null) update("employee_id", null); }}
              label={t('retailers.filters_linked_rso')}
            />
          </div>
        </FilterSection>
      </div>
    </div>
  );
}