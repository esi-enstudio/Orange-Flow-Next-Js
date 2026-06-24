"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import {
  Search,
  ChevronDown,
  X,
  Filter,
  RotateCcw,
  Calendar,
  Smartphone,
  Store,
  Package,
  MapPin,
  Radio,
  CreditCard,
  User,
  Phone,
  Users,
  Building2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import apiClient from "@/lib/api";

export interface ActivationsFilters {
  search: string;
  activation_date_from: string;
  activation_date_to: string;
  activation_time: string;
  retailer_code: string;
  retailer_name: string;
  bts_code: string;
  thana: string;
  promotion: string;
  product_code: string;
  product_codes: string;
  product_name: string;
  sim_no: string;
  msisdn: string;
  selling_price_min: string;
  selling_price_max: string;
  bp_flag: string;
  bp_number: string;
  fc_bts_code: string;
  bio_bts_code: string;
  dh_lifting_date: string;
  issue_date: string;
  subscription_type: string;
  service_class: string;
  customer_second_contact: string;
  rso_employee_id: string;
  house_id: string;
}

export const defaultActivationsFilters: ActivationsFilters = {
  search: "",
  activation_date_from: "",
  activation_date_to: "",
  activation_time: "",
  retailer_code: "",
  retailer_name: "",
  bts_code: "",
  thana: "",
  promotion: "",
  product_code: "",
  product_codes: "",
  product_name: "",
  sim_no: "",
  msisdn: "",
  selling_price_min: "",
  selling_price_max: "",
  bp_flag: "",
  bp_number: "",
  fc_bts_code: "",
  bio_bts_code: "",
  dh_lifting_date: "",
  issue_date: "",
  subscription_type: "",
  service_class: "",
  customer_second_contact: "",
  rso_employee_id: "",
  house_id: "",
};

interface HouseItem {
  id: number;
  name: string;
  code: string;
}

interface RSOItem {
  id: number;
  name: string;
  employee_id: string;
  dms_code: string;
}

interface FilterOptions {
  promotions: string[];
  product_codes: string[];
  product_names: string[];
  subscription_types: string[];
  service_classes: string[];
  bp_flags: string[];
}

interface Props {
  filters: ActivationsFilters;
  onChange: (filters: ActivationsFilters) => void;
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

function TextFilter({
  value,
  onChange,
  placeholder,
  icon: Icon,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  icon?: any;
}) {
  return (
    <div className="relative group">
      {Icon && (
        <Icon className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-gray-400 group-focus-within:text-primary-500 transition-colors" />
      )}
      <input
        type="text"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={cn(
          "w-full bg-gray-50 dark:bg-slate-800 border border-transparent rounded-lg text-xs dark:text-gray-200 outline-none focus:border-primary-500 focus:ring-1 focus:ring-primary-500 transition-all",
          Icon ? "pl-7 pr-2.5 py-1.5" : "px-2.5 py-1.5"
        )}
      />
    </div>
  );
}

function DateFilter({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <input
      type="date"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full p-1.5 bg-gray-50 dark:bg-slate-800 border border-transparent rounded-lg text-xs dark:text-gray-200 outline-none focus:border-primary-500 focus:ring-1 focus:ring-primary-500 transition-all"
    />
  );
}

function SelectFilter({
  value,
  onChange,
  options,
  placeholder,
  optionLabels,
}: {
  value: string;
  onChange: (v: string) => void;
  options: string[];
  placeholder: string;
  optionLabels?: Record<string, string>;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full p-1.5 bg-gray-50 dark:bg-slate-800 border border-transparent rounded-lg text-xs dark:text-gray-200 outline-none focus:border-primary-500 focus:ring-1 focus:ring-primary-500 transition-all appearance-none"
    >
      <option value="">{placeholder}</option>
      {options.map((opt) => (
        <option key={opt} value={opt}>{optionLabels ? optionLabels[opt] || opt : opt}</option>
      ))}
    </select>
  );
}

function MultiSelectFilter({
  values,
  onChange,
  options,
  placeholder,
}: {
  values: string;
  onChange: (v: string) => void;
  options: string[];
  placeholder: string;
}) {
  const [open, setOpen] = useState(false);
  const selected = values ? values.split(",").filter(Boolean) : [];

  const toggle = (opt: string) => {
    const next = selected.includes(opt)
      ? selected.filter((s) => s !== opt)
      : [...selected, opt];
    onChange(next.join(","));
  };

  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    if (open) document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full px-2.5 py-1.5 bg-gray-50 dark:bg-slate-800 border border-transparent rounded-lg text-xs text-left dark:text-gray-200 outline-none focus:border-primary-500 focus:ring-1 focus:ring-primary-500 transition-all flex items-center justify-between gap-1"
      >
        <span className="truncate">
          {selected.length === 0
            ? placeholder
            : `${selected.length} selected`}
        </span>
        <ChevronDown className={cn("w-3 h-3 shrink-0 transition-transform", open && "rotate-180")} />
      </button>
      {selected.length > 0 && !open && (
        <div className="flex flex-wrap gap-1 mt-1.5">
          {selected.map((s) => (
            <span key={s} className="inline-flex items-center gap-0.5 px-1.5 py-0.5 bg-primary-50 dark:bg-primary-500/10 text-primary-700 dark:text-primary-300 rounded text-[10px] font-medium">
              {s}
              <button type="button" onClick={() => toggle(s)} className="hover:text-red-500">
                <X className="w-2.5 h-2.5" />
              </button>
            </span>
          ))}
        </div>
      )}
      {open && (
        <div className="absolute z-50 mt-1 w-full bg-white dark:bg-slate-900 border dark:border-slate-700 rounded-lg shadow-lg max-h-48 overflow-y-auto">
          {options.length === 0 ? (
            <div className="px-3 py-2 text-xs text-gray-400">No options</div>
          ) : (
            options.map((opt) => (
              <label
                key={opt}
                className="flex items-center gap-2 px-3 py-1.5 hover:bg-gray-50 dark:hover:bg-slate-800 cursor-pointer text-xs dark:text-gray-200"
              >
                <input
                  type="checkbox"
                  checked={selected.includes(opt)}
                  onChange={() => toggle(opt)}
                  className="rounded border-gray-300 dark:border-slate-600"
                />
                {opt}
              </label>
            ))
          )}
        </div>
      )}
    </div>
  );
}

export default function ActivationsFilter({ filters, onChange, onClear }: Props) {
  const [options, setOptions] = useState<FilterOptions>({
    promotions: [],
    product_codes: [],
    product_names: [],
    subscription_types: [],
    service_classes: [],
    bp_flags: [],
  });
  const [rsoList, setRsoList] = useState<RSOItem[]>([]);
  const [houses, setHouses] = useState<HouseItem[]>([]);

  useEffect(() => {
    const hid = filters.house_id ? { params: { house_id: filters.house_id } } : {};
    apiClient.get<FilterOptions>("/activations/filter-options", hid).then((res) => {
      if (res.data) {
        setOptions(res.data);
        if (res.data.product_codes?.length && !filters.product_codes) {
          update("product_codes", res.data.product_codes.join(","));
        }
      }
    }).catch(() => {});
    apiClient.get<RSOItem[]>("/activations/rso-list", hid).then((res) => {
      if (res.data) setRsoList(res.data);
    }).catch(() => {});
    apiClient.get<HouseItem[]>("houses/accessible").then((res) => {
      if (res.data) setHouses(res.data);
    }).catch(() => {});
  }, [filters.house_id]);

  const update = useCallback(
    (key: keyof ActivationsFilters, value: any) => {
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
  if (filters.activation_date_from) chipList.push({ label: `Date from: ${filters.activation_date_from}`, onRemove: () => update("activation_date_from", "") });
  if (filters.activation_date_to) chipList.push({ label: `Date to: ${filters.activation_date_to}`, onRemove: () => update("activation_date_to", "") });
  if (filters.activation_time) chipList.push({ label: `Time: ${filters.activation_time}`, onRemove: () => update("activation_time", "") });
  if (filters.retailer_code) chipList.push({ label: `Rtlr code: ${filters.retailer_code}`, onRemove: () => update("retailer_code", "") });
  if (filters.retailer_name) chipList.push({ label: `Rtlr name: ${filters.retailer_name}`, onRemove: () => update("retailer_name", "") });
  if (filters.bts_code) chipList.push({ label: `BTS: ${filters.bts_code}`, onRemove: () => update("bts_code", "") });
  if (filters.thana) chipList.push({ label: `Thana: ${filters.thana}`, onRemove: () => update("thana", "") });
  if (filters.promotion) chipList.push({ label: `Promo: ${filters.promotion}`, onRemove: () => update("promotion", "") });
  if (filters.product_code) chipList.push({ label: `Prod code: ${filters.product_code}`, onRemove: () => update("product_code", "") });
  if (filters.product_codes) {
    const codes = filters.product_codes.split(",").filter(Boolean);
    codes.forEach((c) => chipList.push({ label: `Code: ${c}`, onRemove: () => {
      const next = codes.filter((x) => x !== c).join(",");
      update("product_codes", next);
    }}));
  }
  if (filters.product_name) chipList.push({ label: `Prod name: ${filters.product_name}`, onRemove: () => update("product_name", "") });
  if (filters.sim_no) chipList.push({ label: `SIM: ${filters.sim_no}`, onRemove: () => update("sim_no", "") });
  if (filters.msisdn) chipList.push({ label: `MSISDN: ${filters.msisdn}`, onRemove: () => update("msisdn", "") });
  if (filters.selling_price_min) chipList.push({ label: `Price min: ${filters.selling_price_min}`, onRemove: () => update("selling_price_min", "") });
  if (filters.selling_price_max) chipList.push({ label: `Price max: ${filters.selling_price_max}`, onRemove: () => update("selling_price_max", "") });
  if (filters.bp_flag) chipList.push({ label: `BP flag: ${filters.bp_flag}`, onRemove: () => update("bp_flag", "") });
  if (filters.bp_number) chipList.push({ label: `BP no: ${filters.bp_number}`, onRemove: () => update("bp_number", "") });
  if (filters.fc_bts_code) chipList.push({ label: `FC BTS: ${filters.fc_bts_code}`, onRemove: () => update("fc_bts_code", "") });
  if (filters.bio_bts_code) chipList.push({ label: `Bio BTS: ${filters.bio_bts_code}`, onRemove: () => update("bio_bts_code", "") });
  if (filters.dh_lifting_date) chipList.push({ label: `DH lift: ${filters.dh_lifting_date}`, onRemove: () => update("dh_lifting_date", "") });
  if (filters.issue_date) chipList.push({ label: `Issue: ${filters.issue_date}`, onRemove: () => update("issue_date", "") });
  if (filters.subscription_type) chipList.push({ label: `Sub type: ${filters.subscription_type}`, onRemove: () => update("subscription_type", "") });
  if (filters.service_class) chipList.push({ label: `Service class: ${filters.service_class}`, onRemove: () => update("service_class", "") });
  if (filters.customer_second_contact) chipList.push({ label: `2nd contact: ${filters.customer_second_contact}`, onRemove: () => update("customer_second_contact", "") });
  if (filters.rso_employee_id) {
    const rso = rsoList.find((r) => String(r.id) === filters.rso_employee_id);
    chipList.push({ label: `RSO: ${rso?.name || filters.rso_employee_id}`, onRemove: () => update("rso_employee_id", "") });
  }
  if (filters.house_id) {
    const house = houses.find((h) => String(h.id) === filters.house_id);
    chipList.push({ label: `House: ${house?.name || filters.house_id}`, onRemove: () => update("house_id", "") });
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
              placeholder="Search SIM, retailer, MSISDN..."
              className="w-full pl-8 pr-3 py-1.5 bg-gray-50 dark:bg-slate-800 border border-transparent rounded-lg text-xs dark:text-gray-200 outline-none focus:border-primary-500 focus:ring-1 focus:ring-primary-500 transition-all"
              value={filters.search}
              onChange={(e) => update("search", e.target.value)}
            />
          </div>
        </div>

        {/* House Filter */}
        <FilterSection title="House" icon={Building2}>
          <div>
            <label className="text-[10px] font-bold text-gray-400 uppercase block mb-1">Select House</label>
            <SelectFilter
              value={filters.house_id}
              onChange={(v) => update("house_id", v)}
              options={houses.map((h) => String(h.id))}
              optionLabels={houses.reduce((acc, h) => { acc[String(h.id)] = `${h.name} (${h.code})`; return acc; }, {} as Record<string, string>)}
              placeholder="All houses"
            />
          </div>
        </FilterSection>

        {/* RSO Filter */}
        <FilterSection title="RSO (Retail Sales Officer)" icon={Users}>
          <div>
            <label className="text-[10px] font-bold text-gray-400 uppercase block mb-1">Select RSO</label>
            <SelectFilter
              value={filters.rso_employee_id}
              onChange={(v) => update("rso_employee_id", v)}
              options={rsoList.map((r) => String(r.id))}
              optionLabels={rsoList.reduce((acc, r) => { acc[String(r.id)] = r.name; return acc; }, {} as Record<string, string>)}
              placeholder="All RSOs"
            />
          </div>
        </FilterSection>

        {/* Activation Date */}
        <FilterSection title="Activation Date" icon={Calendar}>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[10px] font-bold text-gray-400 uppercase block mb-1">From</label>
              <DateFilter value={filters.activation_date_from} onChange={(v) => update("activation_date_from", v)} />
            </div>
            <div>
              <label className="text-[10px] font-bold text-gray-400 uppercase block mb-1">To</label>
              <DateFilter value={filters.activation_date_to} onChange={(v) => update("activation_date_to", v)} />
            </div>
          </div>
          <div>
            <label className="text-[10px] font-bold text-gray-400 uppercase block mb-1">Activation Time</label>
            <TextFilter value={filters.activation_time} onChange={(v) => update("activation_time", v)} placeholder="e.g. 14:30:00" />
          </div>
        </FilterSection>

        {/* SIM & MSISDN */}
        <FilterSection title="SIM & MSISDN" icon={Smartphone}>
          <TextFilter value={filters.sim_no} onChange={(v) => update("sim_no", v)} placeholder="SIM number" icon={Smartphone} />
          <TextFilter value={filters.msisdn} onChange={(v) => update("msisdn", v)} placeholder="MSISDN number" icon={Phone} />
        </FilterSection>

        {/* Retailer */}
        <FilterSection title="Retailer" icon={Store}>
          <TextFilter value={filters.retailer_code} onChange={(v) => update("retailer_code", v)} placeholder="Retailer code" />
          <TextFilter value={filters.retailer_name} onChange={(v) => update("retailer_name", v)} placeholder="Retailer name" />
        </FilterSection>

        {/* Product */}
        <FilterSection title="Product" icon={Package} defaultOpen={false}>
          <div>
            <label className="text-[10px] font-bold text-gray-400 uppercase block mb-1">Product Code</label>
            <MultiSelectFilter values={filters.product_codes} onChange={(v) => update("product_codes", v)} options={options.product_codes} placeholder="All codes" />
          </div>
          <div>
            <label className="text-[10px] font-bold text-gray-400 uppercase block mb-1">Product Name</label>
            <SelectFilter value={filters.product_name} onChange={(v) => update("product_name", v)} options={options.product_names} placeholder="All names" />
          </div>
          <div>
            <label className="text-[10px] font-bold text-gray-400 uppercase block mb-1">Promotion</label>
            <SelectFilter value={filters.promotion} onChange={(v) => update("promotion", v)} options={options.promotions} placeholder="All promotions" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[10px] font-bold text-gray-400 uppercase block mb-1">Price Min</label>
              <TextFilter value={filters.selling_price_min} onChange={(v) => update("selling_price_min", v)} placeholder="0" />
            </div>
            <div>
              <label className="text-[10px] font-bold text-gray-400 uppercase block mb-1">Price Max</label>
              <TextFilter value={filters.selling_price_max} onChange={(v) => update("selling_price_max", v)} placeholder="999" />
            </div>
          </div>
        </FilterSection>

        {/* Location */}
        <FilterSection title="Location" icon={MapPin} defaultOpen={false}>
          <TextFilter value={filters.bts_code} onChange={(v) => update("bts_code", v)} placeholder="BTS code" />
          <TextFilter value={filters.thana} onChange={(v) => update("thana", v)} placeholder="Thana" />
          <TextFilter value={filters.fc_bts_code} onChange={(v) => update("fc_bts_code", v)} placeholder="FC BTS code" />
          <TextFilter value={filters.bio_bts_code} onChange={(v) => update("bio_bts_code", v)} placeholder="Bio BTS code" />
        </FilterSection>

        {/* Subscription */}
        <FilterSection title="Subscription" icon={Radio} defaultOpen={false}>
          <div>
            <label className="text-[10px] font-bold text-gray-400 uppercase block mb-1">Subscription Type</label>
            <SelectFilter value={filters.subscription_type} onChange={(v) => update("subscription_type", v)} options={options.subscription_types} placeholder="All types" />
          </div>
          <div>
            <label className="text-[10px] font-bold text-gray-400 uppercase block mb-1">Service Class</label>
            <SelectFilter value={filters.service_class} onChange={(v) => update("service_class", v)} options={options.service_classes} placeholder="All classes" />
          </div>
        </FilterSection>

        {/* BP Info */}
        <FilterSection title="BP Info" icon={CreditCard} defaultOpen={false}>
          <div>
            <label className="text-[10px] font-bold text-gray-400 uppercase block mb-1">BP Flag</label>
            <SelectFilter value={filters.bp_flag} onChange={(v) => update("bp_flag", v)} options={options.bp_flags} placeholder="All" />
          </div>
          <TextFilter value={filters.bp_number} onChange={(v) => update("bp_number", v)} placeholder="BP number" />
        </FilterSection>

        {/* Other Dates & Contact */}
        <FilterSection title="Other" icon={User} defaultOpen={false}>
          <div>
            <label className="text-[10px] font-bold text-gray-400 uppercase block mb-1">DH Lifting Date</label>
            <TextFilter value={filters.dh_lifting_date} onChange={(v) => update("dh_lifting_date", v)} placeholder="DH lifting date" />
          </div>
          <div>
            <label className="text-[10px] font-bold text-gray-400 uppercase block mb-1">Issue Date</label>
            <TextFilter value={filters.issue_date} onChange={(v) => update("issue_date", v)} placeholder="Issue date" />
          </div>
          <div>
            <label className="text-[10px] font-bold text-gray-400 uppercase block mb-1">2nd Contact</label>
            <TextFilter value={filters.customer_second_contact} onChange={(v) => update("customer_second_contact", v)} placeholder="Customer second contact" />
          </div>
        </FilterSection>
      </div>
    </div>
  );
}
