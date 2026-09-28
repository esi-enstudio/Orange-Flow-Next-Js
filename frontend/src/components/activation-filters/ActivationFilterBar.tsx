"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, RotateCcw, Search, SlidersHorizontal, X } from "lucide-react";
import axios from "@/lib/api";
import { useLanguage } from "@/i18n/useLanguage";
import EntitySelector, { SelectorItem } from "@/app/zoom-in/_components/EntitySelector";

export interface ActivationFilters {
  house_id: string;
  sim_msisdn: string;
  employee_ids: string[];
  retailer_codes: string[];
  product_codes: string[];
}

export const defaultActivationFilters: ActivationFilters = {
  house_id: "",
  sim_msisdn: "",
  employee_ids: [],
  retailer_codes: [],
  product_codes: [],
};

export function countActiveFilters(f: ActivationFilters): number {
  return (
    (f.house_id ? 1 : 0) +
    (f.sim_msisdn ? 1 : 0) +
    (f.employee_ids.length ? 1 : 0) +
    (f.retailer_codes.length ? 1 : 0) +
    (f.product_codes.length ? 1 : 0)
  );
}

interface HouseOption {
  id: number;
  name: string;
  code: string;
  display_name?: string;
}

interface EmployeeOption {
  id: number;
  name: string;
  dms_code: string;
  itop_number?: string | null;
  employee_type?: string;
  status?: string;
}

interface RetailerOption {
  id: string;
  name: string;
  retailer_code: string;
  itop_number?: string | null;
}

interface ProductCodeOption {
  id: string;
  name: string;
}

interface Props {
  /** API prefix that owns this filter, e.g. "/activations" or "/live-activations". */
  apiBase: string;
  filters: ActivationFilters;
  onChange: (filters: ActivationFilters) => void;
}

export default function ActivationFilterBar({ apiBase, filters, onChange }: Props) {
  const { t } = useLanguage();
  const [houses, setHouses] = useState<HouseOption[]>([]);
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [retailers, setRetailers] = useState<RetailerOption[]>([]);
  const [productCodes, setProductCodes] = useState<ProductCodeOption[]>([]);
  const [optionsLoading, setOptionsLoading] = useState(false);
  const [retailerSearch, setRetailerSearch] = useState("");
  const [simMsisdnInput, setSimMsisdnInput] = useState(filters.sim_msisdn);
  // Typing must not fire a query per keystroke, so the input stays local and only
  // lands in the applied filters after a short pause (or immediately on Enter).
  const filtersRef = useRef(filters);
  useEffect(() => {
    filtersRef.current = filters;
  }, [filters]);
  const simMsisdnTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Houses come from the shared accessible endpoint, so the filter can never
  // offer a house the user is not allowed to read.
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await axios.get("/houses/accessible");
        if (active) setHouses(res.data || []);
      } catch {
        if (active) setHouses([]);
      }
    })();
    return () => { active = false; };
  }, []);

  const loadDependentOptions = useCallback(async (houseId: string) => {
    if (!houseId) {
      setEmployees([]);
      setRetailers([]);
      setProductCodes([]);
      return;
    }
    setOptionsLoading(true);
    try {
      const [empRes, retRes, prodRes] = await Promise.all([
        axios.get(`${apiBase}/filter-options/employees`, { params: { house_id: houseId } }),
        axios.get(`${apiBase}/filter-options/retailers`, { params: { house_id: houseId } }),
        axios.get(`${apiBase}/filter-options/product-codes`, { params: { house_id: houseId } }),
      ]);
      setEmployees(empRes.data || []);
      setRetailers(retRes.data || []);
      setProductCodes(prodRes.data || []);
    } catch {
      setEmployees([]);
      setRetailers([]);
      setProductCodes([]);
    } finally {
      setOptionsLoading(false);
    }
  }, [apiBase]);

  useEffect(() => { loadDependentOptions(filters.house_id); }, [filters.house_id, loadDependentOptions]);

  // A house holds thousands of retailers, so the retailer list is searched on the
  // server instead of shipping every row to the browser.
  useEffect(() => {
    if (!filters.house_id) return;
    let active = true;
    const timer = setTimeout(async () => {
      try {
        const res = await axios.get(`${apiBase}/filter-options/retailers`, {
          params: { house_id: filters.house_id, search: retailerSearch || undefined },
        });
        if (active) setRetailers(res.data || []);
      } catch {
        if (active) setRetailers([]);
      }
    }, 300);
    return () => { active = false; clearTimeout(timer); };
  }, [apiBase, filters.house_id, retailerSearch]);

  const houseItems: SelectorItem[] = houses.map((h) => ({
    id: h.id,
    label: h.display_name || `${h.name} (${h.code})`,
    sublabel: h.code,
  }));

  const employeeItems: SelectorItem[] = employees.map((e) => ({
    id: e.id,
    label: e.name,
    sublabel: [e.dms_code, e.itop_number].filter(Boolean).join(" | "),
    badge: e.employee_type ? e.employee_type.toUpperCase() : undefined,
  }));

  const retailerItems: SelectorItem[] = retailers.map((r) => ({
    id: r.id,
    label: r.name,
    sublabel: [r.retailer_code, r.itop_number].filter(Boolean).join(" | "),
  }));

  const productItems: SelectorItem[] = productCodes.map((p) => ({
    id: p.id,
    label: p.id,
    sublabel: p.name !== p.id ? p.name : undefined,
  }));

  const handleHouseChange = (ids: (string | number)[]) => {
    const next = String(ids[0] ?? "");
    // Switching house invalidates every dependent selection and the search term.
    setSimMsisdnInput("");
    if (simMsisdnTimer.current) clearTimeout(simMsisdnTimer.current);
    onChange({
      house_id: next, sim_msisdn: "", employee_ids: [], retailer_codes: [],
      product_codes: [],
    });
  };

  const applySimMsisdn = (value: string) => {
    if (simMsisdnTimer.current) clearTimeout(simMsisdnTimer.current);
    onChange({ ...filtersRef.current, sim_msisdn: value });
  };

  const handleSimMsisdnChange = (value: string) => {
    setSimMsisdnInput(value);
    if (simMsisdnTimer.current) clearTimeout(simMsisdnTimer.current);
    simMsisdnTimer.current = setTimeout(() => {
      onChange({ ...filtersRef.current, sim_msisdn: value });
    }, 400);
  };

  const activeCount = countActiveFilters(filters);
  const noHouse = !filters.house_id;
  const dependentDisabled = noHouse || optionsLoading;

  return (
    <div className="p-4 space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <p className="text-sm font-semibold text-gray-700 dark:text-gray-200 flex items-center gap-2">
          <SlidersHorizontal className="w-4 h-4" />
          {t("activations.filters.title")}
          {activeCount > 0 && (
            <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-primary-600 px-1.5 text-[10px] font-bold text-white">
              {activeCount}
            </span>
          )}
        </p>
        {activeCount > 0 && (
          <button
            onClick={() => {
              setRetailerSearch("");
              setSimMsisdnInput("");
              if (simMsisdnTimer.current) clearTimeout(simMsisdnTimer.current);
              onChange({ ...defaultActivationFilters });
            }}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-600 dark:text-gray-300 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-lg hover:bg-gray-50 dark:hover:bg-slate-800 transition-colors cursor-pointer"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            {t("activations.filters.reset")}
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <EntitySelector
          label={t("activations.filters.house")}
          items={houseItems}
          selectedIds={filters.house_id ? [Number(filters.house_id)] : []}
          onChange={handleHouseChange}
          single
          portal
          placeholder={t("activations.filters.house_placeholder")}
          searchPlaceholder={t("activations.filters.house_search")}
          emptyMessage={t("activations.filters.no_houses")}
          noResultsMessage={t("activations.filters.no_houses")}
        />

        <div>
          <label
            htmlFor="live-activation-sim-msisdn"
            className="block text-sm font-bold text-gray-700 dark:text-gray-300 mb-1.5"
          >
            {t("activations.filters.sim_msisdn_label")}
          </label>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
            <input
              id="live-activation-sim-msisdn"
              type="text"
              inputMode="search"
              role="searchbox"
              autoComplete="off"
              spellCheck={false}
              value={simMsisdnInput}
              onChange={(e) => handleSimMsisdnChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  applySimMsisdn(simMsisdnInput);
                }
              }}
              disabled={noHouse}
              placeholder={
                noHouse
                  ? t("activations.filters.retailer_disabled_reason")
                  : t("activations.filters.sim_msisdn_placeholder")
              }
              aria-label={t("activations.filters.sim_msisdn_label")}
              className="w-full pl-10 pr-9 py-2 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl text-sm text-gray-700 dark:text-gray-300 placeholder:text-gray-400 outline-none focus:ring-2 focus:ring-primary-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            />
            {simMsisdnInput && (
              <button
                type="button"
                onClick={() => {
                  setSimMsisdnInput("");
                  applySimMsisdn("");
                }}
                title={t("activations.filters.clear_search")}
                aria-label={t("activations.filters.clear_search")}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
        <EntitySelector
          label={t("activations.filters.employee")}
          items={employeeItems}
          selectedIds={filters.employee_ids.map(Number)}
          onChange={(ids) => onChange({ ...filters, employee_ids: ids.map(String) })}
          disabled={dependentDisabled}
          portal
          placeholder={
            optionsLoading
              ? t("activations.filters.employee_loading")
              : noHouse
                ? t("activations.filters.retailer_disabled_reason")
                : t("activations.filters.employee_placeholder")
          }
          searchPlaceholder={t("activations.filters.employee_search")}
          emptyMessage={t("activations.filters.no_employees")}
          noResultsMessage={t("activations.filters.no_employees")}
          selectedLabel={t("activations.filters.selected")}
        />

        <EntitySelector
          label={t("activations.filters.retailer")}
          items={retailerItems}
          selectedIds={filters.retailer_codes}
          onChange={(ids) => onChange({ ...filters, retailer_codes: ids.map(String) })}
          disabled={dependentDisabled}
          portal
          onSearchChange={(q) => setRetailerSearch(q)}
          placeholder={
            optionsLoading
              ? t("activations.filters.retailer_loading")
              : noHouse
                ? t("activations.filters.retailer_disabled_reason")
                : t("activations.filters.retailer_placeholder")
          }
          searchPlaceholder={t("activations.filters.retailer_search")}
          emptyMessage={t("activations.filters.no_retailers")}
          noResultsMessage={t("activations.filters.no_retailers")}
          selectedLabel={t("activations.filters.selected")}
        />

        <EntitySelector
          label={t("activations.filters.product_code")}
          items={productItems}
          selectedIds={filters.product_codes}
          onChange={(ids) => onChange({ ...filters, product_codes: ids.map(String) })}
          disabled={dependentDisabled}
          portal
          placeholder={
            optionsLoading
              ? t("activations.filters.product_loading")
              : noHouse
                ? t("activations.filters.retailer_disabled_reason")
                : t("activations.filters.product_placeholder")
          }
          searchPlaceholder={t("activations.filters.product_search")}
          emptyMessage={t("activations.filters.no_products")}
          noResultsMessage={t("activations.filters.no_products")}
          selectedLabel={t("activations.filters.selected")}
        />
      </div>

      {optionsLoading && (
        <p className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
          {t("activations.filters.applying")}
        </p>
      )}
    </div>
  );
}
