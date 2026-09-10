"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import apiClient from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import {
  Search, Download, Building2, Calendar, Package,
  RotateCcw, ChevronDown, ChevronLeft, ChevronRight,
  Inbox, TrendingUp, BarChart3, CalendarDays, Hash,
  ArrowUp, ArrowDown, ChevronsUpDown, X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import EntitySelector from "@/app/zoom-in/_components/EntitySelector";
import { toast } from "react-hot-toast";
import { AccessDenied } from "@/components/ui/AccessDenied";
import { useLanguage } from "@/i18n/useLanguage";
import PageGuideModal from "@/components/PageGuideModal";

// ── Types ──

interface HouseOption {
  id: number;
  name: string;
  code: string;
  display_name?: string;
}

interface RetailerOption {
  id: number;
  retailer_code: string;
  name: string;
  owner_name?: string;
  itop_number?: string;
  house_id: number;
  employee_name?: string;
  rso_itop_number?: string;
}

interface ActivationRecord {
  id: number;
  sim_no: string;
  activation_date: string | null;
  activation_time: string | null;
  retailer_code: string;
  retailer_name: string;
  retailer_itop_number?: string | null;
  bts_code: string | null;
  thana: string | null;
  promotion: string | null;
  product_code: string | null;
  product_name: string | null;
  msisdn: string | null;
  selling_price: string | null;
  bp_flag: string | null;
  bp_number: string | null;
  fc_bts_code: string | null;
  bio_bts_code: string | null;
  dh_lifting_date: string | null;
  issue_date: string | null;
  subscription_type: string | null;
  service_class: string | null;
  customer_second_contact: string | null;
  house_id: number;
  house_name: string | null;
  rso_name: string | null;
  rso_dms_code: string | null;
}

interface Pagination {
  page: number;
  per_page: number;
  total: number;
  total_pages: number;
  has_next: boolean;
  has_prev: boolean;
}

interface ProductCodeItem {
  code: string;
  count: number;
}

interface RsoOption {
  value: string;
  dms_code: string | null;
  itop_number: string | null;
  employee_type: string | null;
  count: number;
}

interface SummaryData {
  total_activations: number;
  product_breakdown: ProductCodeItem[];
  daily_breakdown: { date: string; count: number }[];
}

// ── Helpers ──

function toDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function formatNumber(n: number | null | undefined): string {
  if (n === null || n === undefined) return "0";
  return Number(n).toLocaleString();
}

function formatDate(dateStr: string | null, lang: string): string {
  if (!dateStr) return "-";
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  if (lang === "bn") {
    const bnDays = ["রবি", "সোম", "মঙ্গল", "বুধ", "বৃহস্পতি", "শুক্র", "শনি"];
    const bnMonths = ["জানুয়ারি", "ফেব্রুয়ারি", "মার্চ", "এপ্রিল", "মে", "জুন", "জুলাই", "আগস্ট", "সেপ্টেম্বর", "অক্টোবর", "নভেম্বর", "ডিসেম্বর"];
    const bnNum = (n: number) => String(n).replace(/\d/g, (d) => "০১২৩৪৫৬৭৮৯"[Number(d)]);
    return `${bnDays[dt.getDay()]}, ${bnNum(d)} ${bnMonths[m - 1]} ${bnNum(y)}`;
  }
  return dt.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

// ── Skeletons ──

const SkeletonCard = () => (
  <div className="animate-pulse bg-white dark:bg-slate-900 rounded-xl border border-gray-100 dark:border-slate-800 p-5 shadow-sm">
    <div className="h-3 w-24 bg-gray-200 dark:bg-slate-700 rounded-md mb-3" />
    <div className="h-7 w-20 bg-gray-200 dark:bg-slate-700 rounded-md mb-2" />
    <div className="h-2.5 w-16 bg-gray-100 dark:bg-slate-800 rounded-md" />
  </div>
);

const SkeletonTable = () => (
  <>
    <div className="hidden lg:block overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-100 dark:border-slate-800">
            {[20, 28, 24, 28, 24, 16].map((w, i) => (
              <th key={i} className="px-2 py-3 text-left">
                <div
                  className="h-3 rounded-md bg-gray-200 dark:bg-slate-700 animate-pulse"
                  style={{ width: `${w * 4}px` }}
                />
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-50 dark:divide-slate-800">
          {Array.from({ length: 8 }).map((_, r) => (
            <tr key={r}>
              <td className="px-2 py-1">
                <div className="space-y-1.5 animate-pulse">
                  <div className="h-3 w-24 bg-gray-200 dark:bg-slate-700 rounded-md" />
                  <div className="h-2.5 w-16 bg-gray-100 dark:bg-slate-800 rounded-md" />
                </div>
              </td>
              <td className="px-2 py-1">
                <div className="space-y-1.5 animate-pulse">
                  <div className="h-3 w-28 bg-gray-200 dark:bg-slate-700 rounded-md" />
                  <div className="h-2.5 w-20 bg-gray-100 dark:bg-slate-800 rounded-md" />
                </div>
              </td>
              <td className="px-2 py-1">
                <div className="space-y-1.5 animate-pulse">
                  <div className="h-3 w-24 bg-gray-200 dark:bg-slate-700 rounded-md" />
                  <div className="h-2.5 w-12 bg-gray-100 dark:bg-slate-800 rounded-md" />
                </div>
              </td>
              <td className="px-2 py-1">
                <div className="space-y-1.5 animate-pulse">
                  <div className="h-3 w-28 bg-gray-200 dark:bg-slate-700 rounded-md" />
                  <div className="h-2.5 w-24 bg-gray-100 dark:bg-slate-800 rounded-md" />
                </div>
              </td>
              <td className="px-2 py-1">
                <div className="space-y-1.5 animate-pulse">
                  <div className="h-4 w-20 bg-primary-100 dark:bg-primary-500/20 rounded-md" />
                  <div className="h-2.5 w-24 bg-gray-100 dark:bg-slate-800 rounded-md" />
                </div>
              </td>
              <td className="px-2 py-1">
                <div className="h-3 w-14 bg-gray-200 dark:bg-slate-700 rounded-md animate-pulse" />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>

    <div className="lg:hidden divide-y divide-gray-50 dark:divide-slate-800">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 px-4 py-3 animate-pulse">
          <div className="w-9 h-9 rounded-lg bg-gray-200 dark:bg-slate-700 shrink-0" />
          <div className="flex-1 space-y-2">
            <div className="h-3 w-32 bg-gray-200 dark:bg-slate-700 rounded-md" />
            <div className="h-2.5 w-24 bg-gray-100 dark:bg-slate-800 rounded-md" />
          </div>
          <div className="h-4 w-4 bg-gray-100 dark:bg-slate-800 rounded" />
        </div>
      ))}
    </div>
  </>
);

// ── Main Component ──

export default function GAQueryPage() {
  const { selectedHouse, hasPermission, loading: authLoading } = useAuth();
  const { t, language } = useLanguage();

  const today = new Date();
  const [selectedHouseId, setSelectedHouseId] = useState<string>(
    selectedHouse ? String(selectedHouse.id) : ""
  );
  const [houses, setHouses] = useState<HouseOption[]>([]);

  const [startDate, setStartDate] = useState(
    toDateStr(new Date(today.getFullYear(), today.getMonth(), 1))
  );
  const [endDate, setEndDate] = useState(toDateStr(today));

  const [retailers, setRetailers] = useState<RetailerOption[]>([]);
  const [retailerSearch, setRetailerSearch] = useState("");
  const [selectedRetailerIds, setSelectedRetailerIds] = useState<string[]>([]);
  const [loadingRetailers, setLoadingRetailers] = useState(false);

  const [activations, setActivations] = useState<ActivationRecord[]>([]);
  const [pagination, setPagination] = useState<Pagination | null>(null);
  const [loading, setLoading] = useState(false);
  const [searchText, setSearchText] = useState("");

  const [productCodes, setProductCodes] = useState<ProductCodeItem[]>([]);
  const [loadingProducts, setLoadingProducts] = useState(false);

  const [rsoOptions, setRsoOptions] = useState<RsoOption[]>([]);
  const [rsoSelected, setRsoSelected] = useState<string[]>([]);
  const [loadingRso, setLoadingRso] = useState(false);

  const [selectedProductCodes, setSelectedProductCodes] = useState<string[]>([]);

  const [summary, setSummary] = useState<SummaryData | null>(null);

  const [expandedId, setExpandedId] = useState<number | null>(null);

  const [sortBy, setSortBy] = useState<string>("");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");
  const [columnFilters, setColumnFilters] = useState<Record<string, string>>({});

  // ── Permission check ──
  const canView = hasPermission("ga_query.view");
  const canExport = hasPermission("ga_query.export");

  // ── Fetch houses ──
  useEffect(() => {
    if (!authLoading && canView) {
      apiClient
        .get("houses/accessible")
        .then((res) => setHouses(res.data))
        .catch(() => {});
    }
  }, [authLoading, canView]);

  // ── Fetch retailers ──
  const fetchRetailers = useCallback(
    async (search: string) => {
      if (!selectedHouseId) {
        setRetailers([]);
        return;
      }
      setLoadingRetailers(true);
      try {
        const res = await apiClient.get("ga-query/retailers", {
          params: { search: search || undefined },
          headers: { "X-House-ID": selectedHouseId },
        });
        setRetailers(res.data || []);
      } catch {
        setRetailers([]);
      } finally {
        setLoadingRetailers(false);
      }
    },
    [selectedHouseId]
  );

  useEffect(() => {
    const q = retailerSearch.trim();
    if (q.length === 0) return;
    const timer = setTimeout(() => fetchRetailers(q), 300);
    return () => clearTimeout(timer);
  }, [retailerSearch, fetchRetailers]);

  // ── Fetch RSO options ──
  const fetchRsoOptions = useCallback(
    async (retIds: string[]) => {
      setLoadingRso(true);
      try {
        const headers: Record<string, string> = {};
        if (selectedHouseId) headers["X-House-ID"] = selectedHouseId;
        const res = await apiClient.get("ga-query/rso-options", {
          params: {
            ...(retIds.length > 0 ? { retailer_ids: retIds.join(",") } : {}),
            start_date: startDate,
            end_date: endDate,
          },
          headers,
        });
        setRsoOptions(res.data || []);
      } catch {
        setRsoOptions([]);
      } finally {
        setLoadingRso(false);
      }
    },
    [selectedHouseId, startDate, endDate]
  );

  // ── Fetch product codes ──
  const fetchProductCodes = useCallback(
    async (retIds: string[]) => {
      setLoadingProducts(true);
      try {
        const headers: Record<string, string> = {};
        if (selectedHouseId) headers["X-House-ID"] = selectedHouseId;
        const res = await apiClient.get("ga-query/product-codes", {
          params: {
            ...(retIds.length > 0 ? { retailer_ids: retIds.join(",") } : {}),
            start_date: startDate,
            end_date: endDate,
          },
          headers,
        });
        setProductCodes(res.data || []);
      } catch {
        setProductCodes([]);
      } finally {
        setLoadingProducts(false);
      }
    },
    [selectedHouseId, startDate, endDate]
  );

  // ── Load RSO & product options when house / date range changes ──
  useEffect(() => {
    if (selectedHouseId) {
      fetchProductCodes([]);
      fetchRsoOptions([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedHouseId, startDate, endDate]);

  // ── Fetch activations ──
  const fetchActivations = useCallback(
    async (
      retIds: string[],
      page: number = 1,
      overrides?: { sortBy?: string; sortOrder?: "asc" | "desc"; filters?: Record<string, string> }
    ) => {
      setLoading(true);
      try {
        const params: Record<string, string | number> = {
          start_date: startDate,
          end_date: endDate,
          page,
          per_page: 50,
          sort_order: overrides?.sortOrder ?? sortOrder,
        };
        if (overrides?.sortBy ?? sortBy) params.sort_by = overrides?.sortBy ?? sortBy;
        if (retIds.length > 0) params.retailer_ids = retIds.join(",");
        if (searchText) params.search = searchText;

        const activeFilters = overrides?.filters ?? columnFilters;
        Object.entries(activeFilters).forEach(([key, value]) => {
          if (value) params[`f_${key}`] = value;
        });

        const headers: Record<string, string> = {};
        if (selectedHouseId) headers["X-House-ID"] = selectedHouseId;

        const res = await apiClient.get("ga-query/activations", { params, headers });
        setActivations(res.data?.data || []);
        setPagination(res.data?.pagination || null);
      } catch (err: any) {
        toast.error(err?.message || t("ga_query.error_loading"));
        setActivations([]);
        setPagination(null);
      } finally {
        setLoading(false);
      }
    },
    [selectedHouseId, startDate, endDate, searchText, sortBy, sortOrder, columnFilters, t]
  );

  // ── Fetch summary ──
  const fetchSummary = useCallback(
    async (retIds: string[]) => {
      try {
        const headers: Record<string, string> = {};
        if (selectedHouseId) headers["X-House-ID"] = selectedHouseId;
        const res = await apiClient.get("ga-query/summary", {
          params: {
            ...(retIds.length > 0 ? { retailer_ids: retIds.join(",") } : {}),
            start_date: startDate,
            end_date: endDate,
          },
          headers,
        });
        setSummary(res.data || null);
      } catch {
        setSummary(null);
      }
    },
    [selectedHouseId, startDate, endDate]
  );

  // ── Apply handler ──
  const handleApply = () => {
    if (!selectedHouseId) {
      toast.error(t("ga_query.select_house_required"));
      return;
    }
    setSearchText("");
    setSortBy("");
    setSortOrder("desc");
    fetchProductCodes(selectedRetailerIds);
    fetchRsoOptions(selectedRetailerIds);
    fetchActivations(selectedRetailerIds, 1, { sortBy: "", sortOrder: "desc", filters: columnFilters });
    fetchSummary(selectedRetailerIds);
  };

  // ── Page change ──
  const handlePageChange = (newPage: number) => {
    fetchActivations(selectedRetailerIds, newPage);
    setExpandedId(null);
  };

  // ── Sort handler ──
  const handleSortBy = (key: string) => {
    let nextBy = key;
    let nextOrder: "asc" | "desc" = "asc";
    if (sortBy === key) {
      if (sortOrder === "asc") {
        nextOrder = "desc";
      } else {
        nextBy = "";
      }
    }
    setSortBy(nextBy);
    setSortOrder(nextOrder);
    fetchActivations(selectedRetailerIds, 1, {
      sortBy: nextBy,
      sortOrder: nextOrder,
      filters: columnFilters,
    });
  };

  // ── Column filter handler (stages the filter; applied on Apply) ──
  const handleColumnFilter = (key: string, value: string) => {
    setColumnFilters((prev) => {
      const next = { ...prev };
      if (value) next[key] = value;
      else delete next[key];
      return next;
    });
  };

  // ── Export ──
  const handleExport = async () => {
    try {
      const headers: Record<string, string> = {};
      if (selectedHouseId) headers["X-House-ID"] = selectedHouseId;
      const res = await apiClient.get("ga-query/export", {
        params: {
          ...(selectedRetailerIds.length > 0 ? { retailer_ids: selectedRetailerIds.join(",") } : {}),
          start_date: startDate,
          end_date: endDate,
        },
        headers,
        responseType: "blob",
      });
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const link = document.createElement("a");
      link.href = url;
      link.setAttribute("download", `ga_query_activations.xlsx`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
      toast.success(t("ga_query.export_success"));
    } catch (err: any) {
      toast.error(err?.message || t("ga_query.export_failed"));
    }
  };

  // ── RSO multi-select change (staged until Apply) ──
  const handleRsoChange = (vals: string[]) => {
    setRsoSelected(vals);
    handleColumnFilter("rso", vals.join(","));
  };

  // ── Product multi-select change (staged until Apply) ──
  const handleProductChange = (vals: string[]) => {
    setSelectedProductCodes(vals);
    handleColumnFilter("product", vals.join(","));
  };

  // ── Render ──
  if (authLoading) {
    return (
      <div className="min-h-screen bg-gray-50/50 dark:bg-slate-950 p-4 sm:p-6">
        <div className="max-w-[1400px] mx-auto space-y-6">
          <div className="animate-pulse h-8 w-48 bg-gray-200 dark:bg-slate-700 rounded-md" />
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} />)}
          </div>
          <div className="animate-pulse h-48 bg-gray-200 dark:bg-slate-700 rounded-xl" />
        </div>
      </div>
    );
  }

  if (!canView) {
    return <AccessDenied />;
  }

  return (
    <div className="min-h-screen bg-gray-50/50 dark:bg-slate-950 p-4 sm:p-6">
      <div className="max-w-[1400px] mx-auto space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h1 className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-gray-100">
              {t("ga_query.title")}
            </h1>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
              {t("ga_query.subtitle")}
            </p>
          </div>
          <PageGuideModal pageKey="ga_query" />
        </div>

        {/* Filters Panel */}
        <div className="bg-white dark:bg-slate-900 rounded-xl border border-gray-100 dark:border-slate-800 shadow-sm p-4 sm:p-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* House Selector */}
            <div className="space-y-1.5">
              <label className="flex items-center gap-1.5 text-sm font-medium text-gray-700 dark:text-gray-300">
                <Building2 className="w-4 h-4 text-primary-500" />
                {t("ga_query.select_house")}
              </label>
              <select
                value={selectedHouseId}
                onChange={(e) => {
                  setSelectedHouseId(e.target.value);
                  setSelectedRetailerIds([]);
                  setRetailers([]);
                  setActivations([]);
                  setProductCodes([]);
                  setSelectedProductCodes([]);
                  setRsoSelected([]);
                  setSummary(null);
                  setPagination(null);
                }}
                className="w-full px-3 py-2.5 rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-primary-500/40 focus:border-primary-500 transition-colors cursor-pointer"
              >
                <option value="">{t("ga_query.select_house")}</option>
                {houses.map((h) => (
                  <option key={h.id} value={h.id}>
                    {h.code} — {h.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Start Date */}
            <div className="space-y-1.5">
              <label className="flex items-center gap-1.5 text-sm font-medium text-gray-700 dark:text-gray-300">
                <Calendar className="w-4 h-4 text-primary-500" />
                {t("ga_query.start_date")}
              </label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-full px-3 py-2.5 rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-primary-500/40 focus:border-primary-500 transition-colors cursor-pointer"
              />
            </div>

            {/* End Date */}
            <div className="space-y-1.5">
              <label className="flex items-center gap-1.5 text-sm font-medium text-gray-700 dark:text-gray-300">
                <Calendar className="w-4 h-4 text-primary-500" />
                {t("ga_query.end_date")}
              </label>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="w-full px-3 py-2.5 rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-primary-500/40 focus:border-primary-500 transition-colors cursor-pointer"
              />
            </div>

            {/* Retailer Selector */}
            <EntitySelector
              label={t("ga_query.select_retailer")}
              items={retailers.map((r) => ({
                id: String(r.id),
                label: r.name,
                sublabel: `${r.retailer_code}${r.itop_number ? ` • ${r.itop_number}` : ""}`,
              }))}
              selectedIds={selectedRetailerIds}
              onChange={(ids) => setSelectedRetailerIds(ids.map(String))}
              placeholder={t("ga_query.select_retailer_placeholder")}
              searchPlaceholder={t("ga_query.retailer_search")}
              emptyMessage={loadingRetailers ? t("ga_query.loading_retailers") : t("ga_query.type_to_search")}
              noResultsMessage={t("ga_query.no_retailers")}
              onSearchChange={(q) => setRetailerSearch(q)}
              disabled={!selectedHouseId}
              selectAllLabel={t("common.select_all")}
              clearLabel={t("common.clear")}
              selectedLabel={t("ga_query.selected")}
            />

            {/* RSO Multi-Select */}
            <EntitySelector
              label={t("ga_query.select_rso")}
              items={rsoOptions.map((o) => ({
                id: o.value,
                label: o.value,
                sublabel: `DMS: ${o.dms_code ?? "—"}${o.itop_number ? ` • ITop: ${o.itop_number}` : ""}`,
                badge: o.employee_type ? o.employee_type.toUpperCase() : undefined,
              }))}
              selectedIds={rsoSelected}
              onChange={(ids) => handleRsoChange(ids.map(String))}
              placeholder={t("ga_query.select_rso_placeholder")}
              searchPlaceholder={t("ga_query.rso_search")}
              emptyMessage={loadingRso ? t("ga_query.loading_rso") : t("ga_query.no_rso")}
              noResultsMessage={t("ga_query.no_rso")}
              disabled={!selectedHouseId}
              selectAllLabel={t("common.select_all")}
              clearLabel={t("common.clear")}
              selectedLabel={t("ga_query.selected")}
            />

            {/* Product Multi-Select */}
            <EntitySelector
              label={t("ga_query.table.product")}
              items={productCodes.map((p) => ({
                id: p.code,
                label: p.code,
                sublabel: `• ${p.count}`,
              }))}
              selectedIds={selectedProductCodes}
              onChange={(ids) => handleProductChange(ids.map(String))}
              placeholder={t("ga_query.select_product_placeholder")}
              searchPlaceholder={t("ga_query.product_search")}
              emptyMessage={loadingProducts ? t("ga_query.loading_products") : t("ga_query.no_product_codes")}
              noResultsMessage={t("ga_query.no_product_codes")}
              disabled={!selectedHouseId}
              selectAllLabel={t("common.select_all")}
              clearLabel={t("common.clear")}
              selectedLabel={t("ga_query.selected")}
            />

            {/* SIM / MSISDN Filter */}
            <div className="space-y-1.5">
              <label className="flex items-center gap-1.5 text-sm font-medium text-gray-700 dark:text-gray-300">
                <Hash className="w-4 h-4 text-primary-500" />
                {t("ga_query.table.sim_msisdn")}
              </label>
              <FilterInput value={columnFilters.sim_msisdn ?? ""} onApply={(v) => handleColumnFilter("sim_msisdn", v)} placeholder={t("ga_query.table.filter_placeholder")} />
            </div>
          </div>

          {/* Apply Button */}
          <div className="mt-4">
            <button
              onClick={handleApply}
              disabled={!selectedHouseId || loading}
              className={cn(
                "inline-flex items-center justify-center gap-2 px-6 py-2.5 rounded-lg text-sm font-medium transition-all cursor-pointer",
                selectedHouseId
                  ? "bg-primary-600 text-white hover:bg-primary-700 shadow-sm shadow-primary-600/25 active:scale-[0.98]"
                  : "bg-gray-200 dark:bg-slate-700 text-gray-500 dark:text-gray-400 cursor-not-allowed"
              )}
            >
              <Search className="w-4 h-4" />
              {loading ? t("ga_query.loading_data") : t("ga_query.apply")}
            </button>
          </div>
        </div>

        {/* Summary Cards */}
        {summary && (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
            <div className="bg-white dark:bg-slate-900 rounded-xl border border-gray-100 dark:border-slate-800 shadow-sm p-4 sm:p-5">
              <div className="flex items-center gap-2 mb-2">
                <div className="p-1.5 rounded-md bg-primary-50 dark:bg-primary-500/10">
                  <TrendingUp className="w-4 h-4 text-primary-600 dark:text-primary-400" />
                </div>
                <span className="text-xs font-medium text-gray-500 dark:text-gray-400">{t("ga_query.total_activations")}</span>
              </div>
              <p className="text-2xl font-bold text-gray-900 dark:text-gray-100">{formatNumber(summary.total_activations)}</p>
            </div>
            <div className="bg-white dark:bg-slate-900 rounded-xl border border-gray-100 dark:border-slate-800 shadow-sm p-4 sm:p-5">
              <div className="flex items-center gap-2 mb-2">
                <div className="p-1.5 rounded-md bg-emerald-50 dark:bg-emerald-500/10">
                  <Package className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                </div>
                <span className="text-xs font-medium text-gray-500 dark:text-gray-400">{t("ga_query.unique_products")}</span>
              </div>
              <p className="text-2xl font-bold text-gray-900 dark:text-gray-100">{formatNumber(summary.product_breakdown.length)}</p>
            </div>
            <div className="bg-white dark:bg-slate-900 rounded-xl border border-gray-100 dark:border-slate-800 shadow-sm p-4 sm:p-5">
              <div className="flex items-center gap-2 mb-2">
                <div className="p-1.5 rounded-md bg-blue-50 dark:bg-blue-500/10">
                  <CalendarDays className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                </div>
                <span className="text-xs font-medium text-gray-500 dark:text-gray-400">{t("ga_query.active_days")}</span>
              </div>
              <p className="text-2xl font-bold text-gray-900 dark:text-gray-100">{formatNumber(summary.daily_breakdown.length)}</p>
            </div>
            <div className="bg-white dark:bg-slate-900 rounded-xl border border-gray-100 dark:border-slate-800 shadow-sm p-4 sm:p-5">
              <div className="flex items-center gap-2 mb-2">
                <div className="p-1.5 rounded-md bg-amber-50 dark:bg-amber-500/10">
                  <BarChart3 className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                </div>
                <span className="text-xs font-medium text-gray-500 dark:text-gray-400">{t("ga_query.daily_average")}</span>
              </div>
              <p className="text-2xl font-bold text-gray-900 dark:text-gray-100">
                {summary.daily_breakdown.length > 0
                  ? (summary.total_activations / summary.daily_breakdown.length).toFixed(1)
                  : "0"}
              </p>
            </div>
          </div>
        )}

        {/* Results */}
        <div className="bg-white dark:bg-slate-900 rounded-xl border border-gray-100 dark:border-slate-800 shadow-sm overflow-hidden">
          {/* Toolbar */}
          <div className="px-4 sm:px-6 py-3 border-b border-gray-100 dark:border-slate-800 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
              <div className="flex items-center flex-wrap gap-2">
                <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                  {t("ga_query.filter.title")}
                </h2>
                {pagination && (
                  <span className="text-xs text-gray-500 dark:text-gray-400">
                    {t("ga_query.total_label", { count: formatNumber(pagination.total) })}
                  </span>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {/* Export */}
                {canExport && activations.length > 0 && (
                  <button
                    onClick={handleExport}
                    title={t("ga_query.download_excel")}
                    className="group inline-flex items-center gap-1.5 p-2.5 rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-gray-600 dark:text-gray-300 hover:border-primary-400 hover:bg-primary-50 dark:hover:bg-primary-500/10 hover:text-primary-600 dark:hover:text-primary-400 transition-colors duration-200 cursor-pointer"
                  >
                    <Download className="w-4 h-4 shrink-0" />
                    <span className="max-w-0 overflow-hidden whitespace-nowrap opacity-0 transition-all duration-300 ease-out text-xs font-medium group-hover:max-w-[280px] group-hover:opacity-100">
                      {t("ga_query.download_excel")}
                    </span>
                  </button>
                )}

                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <input
                    type="text"
                    value={searchText}
                    onChange={(e) => setSearchText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        fetchActivations(selectedRetailerIds, 1);
                      }
                    }}
                    placeholder={t("ga_query.filter.search_placeholder")}
                    className="w-40 sm:w-56 pl-9 pr-3 py-2 rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-primary-500/40 transition-colors"
                  />
                </div>
              </div>
            </div>

          {/* Loading skeleton */}
          {loading && <SkeletonTable />}

          {/* Empty state */}
          {!loading && activations.length === 0 && (
            <div className="px-6 py-16 text-center">
              <Inbox className="w-12 h-12 text-gray-300 dark:text-gray-600 mx-auto mb-3" />
              <p className="text-sm font-medium text-gray-500 dark:text-gray-400">{t("ga_query.no_data")}</p>
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">{t("ga_query.no_data_hint")}</p>
            </div>
          )}

          {/* Desktop Table */}
          {!loading && activations.length > 0 && (
            <>
              <div className="hidden lg:block overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50/80 dark:bg-slate-800/50 border-b border-gray-100 dark:border-slate-800">
                      <ColumnHeader
                        sortKey="activation_date"
                        label={t("ga_query.table.activation_date")}
                        sortBy={sortBy}
                        sortOrder={sortOrder}
                        onSort={handleSortBy}
                      />
                      <ColumnHeader
                        sortKey="retailer"
                        label={t("ga_query.table.retailer")}
                        sortBy={sortBy}
                        sortOrder={sortOrder}
                        onSort={handleSortBy}
                        className="min-w-[160px]"
                      />
                      <ColumnHeader
                        sortKey="rso"
                        label={t("ga_query.table.rso")}
                        sortBy={sortBy}
                        sortOrder={sortOrder}
                        onSort={handleSortBy}
                      />
                      <ColumnHeader
                        sortKey="sim_msisdn"
                        label={t("ga_query.table.sim_msisdn")}
                        sortBy={sortBy}
                        sortOrder={sortOrder}
                        onSort={handleSortBy}
                        className="min-w-[160px]"
                      />
                      <ColumnHeader
                        sortKey="product"
                        label={t("ga_query.table.product")}
                        sortBy={sortBy}
                        sortOrder={sortOrder}
                        onSort={handleSortBy}
                        className="min-w-[140px]"
                      />
                      <ColumnHeader
                        sortKey="selling_price"
                        label={t("ga_query.table.selling_price")}
                        sortBy={sortBy}
                        sortOrder={sortOrder}
                        onSort={handleSortBy}
                      />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50 dark:divide-slate-800">
                    {activations.map((a) => (
                      <tr key={a.id} className="hover:bg-gray-50/50 dark:hover:bg-slate-800/30 transition-colors">
                        <td className="px-2 py-1 text-gray-900 dark:text-gray-100 whitespace-nowrap">
                          <p className="font-medium">{formatDate(a.activation_date, language)}</p>
                          {a.activation_time && (
                            <p className="text-[11px] text-gray-500 dark:text-gray-400">{a.activation_time}</p>
                          )}
                        </td>
                        <td className="px-2 py-1 max-w-[200px]">
                          <p className="font-medium text-gray-900 dark:text-gray-100 truncate">{a.retailer_name || "-"}</p>
                          {(a.retailer_code || a.retailer_itop_number) && (
                            <p className="text-[11px] text-gray-500 dark:text-gray-400 truncate [overflow-wrap:anywhere]">
                              {[a.retailer_code, a.retailer_itop_number].filter(Boolean).join(" • ")}
                            </p>
                          )}
                        </td>
                        <td className="px-2 py-1">
                          {a.rso_name && (
                            <p className="text-xs font-medium text-gray-900 dark:text-gray-100">{a.rso_name}</p>
                          )}
                          {a.rso_dms_code && (
                            <p className="text-[11px] text-gray-500 dark:text-gray-400">{a.rso_dms_code}</p>
                          )}
                        </td>
                        <td className="px-2 py-1">
                          <p className="font-mono text-xs font-medium text-gray-900 dark:text-gray-100">{a.sim_no || "-"}</p>
                          {a.msisdn && (
                            <p className="text-[11px] text-gray-500 dark:text-gray-400 font-mono">{a.msisdn}</p>
                          )}
                        </td>
                        <td className="px-2 py-1">
                          <span className="inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium bg-primary-50 dark:bg-primary-500/10 text-primary-700 dark:text-primary-300">
                            {a.product_code || "-"}
                          </span>
                          {a.product_name && a.product_name !== a.product_code && (
                            <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">{a.product_name}</p>
                          )}
                        </td>
                        <td className="px-2 py-1 text-gray-600 dark:text-gray-400">{a.selling_price || "-"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Mobile Accordion */}
              <div className="lg:hidden divide-y divide-gray-50 dark:divide-slate-800">
                {activations.map((a) => {
                  const isExpanded = expandedId === a.id;
                  return (
                    <div key={a.id}>
                      <button
                        onClick={() => setExpandedId(isExpanded ? null : a.id)}
                        className="w-full px-4 py-3 flex items-center gap-3 text-left hover:bg-gray-50/50 dark:hover:bg-slate-800/30 transition-colors"
                      >
                        <div className="w-9 h-9 rounded-lg bg-primary-50 dark:bg-primary-500/10 flex items-center justify-center shrink-0">
                          <Hash className="w-4 h-4 text-primary-600 dark:text-primary-400" />
                        </div>
                                                  <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">{a.sim_no}</p>
                          {a.msisdn && (
                            <p className="text-[11px] text-gray-500 dark:text-gray-400 truncate">{a.msisdn}</p>
                          )}
                          <p className="text-[11px] text-gray-500 dark:text-gray-400">
                            {formatDate(a.activation_date, language)} · {a.product_code || "-"}
                          </p>
                        </div>
                        <ChevronDown className={cn(
                          "w-4 h-4 text-gray-400 shrink-0 transition-transform",
                          isExpanded && "rotate-180"
                        )} />
                      </button>
                      {isExpanded && (
                        <div className="px-4 pb-4 space-y-2 bg-gray-50/50 dark:bg-slate-800/20">
                          <div className="flex items-baseline justify-between gap-4">
                            <span className="text-xs text-gray-500 dark:text-gray-400 shrink-0">{t("ga_query.table.retailer")}</span>
                            <div className="text-right">
                              <span className="text-sm font-medium text-gray-900 dark:text-gray-100">{a.retailer_name || "-"}</span>
                              {(a.retailer_code || a.retailer_itop_number) && (
                                <span className="block text-[11px] text-gray-500 dark:text-gray-400">
                                  {[a.retailer_code, a.retailer_itop_number].filter(Boolean).join(" • ")}
                                </span>
                              )}
                            </div>
                          </div>
                          <DetailRow label={t("ga_query.table.rso")} value={a.rso_name} sub={a.rso_dms_code} />
                          <DetailRow
                            label={t("ga_query.table.sim_msisdn")}
                            value={[a.sim_no, a.msisdn].filter(Boolean).join(" / ") || null}
                          />
                          <DetailRow label={t("ga_query.table.product_name")} value={a.product_name} />
                          <DetailRow label={t("ga_query.table.selling_price")} value={a.selling_price} />
                          <DetailRow label={t("ga_query.table.subscription_type")} value={a.subscription_type} />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </>
          )}

          {/* Pagination */}
          {pagination && pagination.total_pages > 1 && (
            <div className="px-4 sm:px-6 py-3 border-t border-gray-100 dark:border-slate-800 flex items-center justify-between">
              <span className="text-xs text-gray-500 dark:text-gray-400">
                Page {pagination.page} of {pagination.total_pages} ({formatNumber(pagination.total)} total)
              </span>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => handlePageChange(pagination.page - 1)}
                  disabled={!pagination.has_prev}
                  className={cn(
                    "p-2 rounded-lg transition-colors cursor-pointer",
                    pagination.has_prev
                      ? "hover:bg-gray-100 dark:hover:bg-slate-800 text-gray-700 dark:text-gray-300"
                      : "text-gray-300 dark:text-gray-600 cursor-not-allowed"
                  )}
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                {Array.from({ length: Math.min(pagination.total_pages, 5) }).map((_, i) => {
                  let pageNum: number;
                  if (pagination.total_pages <= 5) {
                    pageNum = i + 1;
                  } else if (pagination.page <= 3) {
                    pageNum = i + 1;
                  } else if (pagination.page >= pagination.total_pages - 2) {
                    pageNum = pagination.total_pages - 4 + i;
                  } else {
                    pageNum = pagination.page - 2 + i;
                  }
                  return (
                    <button
                      key={pageNum}
                      onClick={() => handlePageChange(pageNum)}
                      className={cn(
                        "w-8 h-8 rounded-lg text-xs font-medium transition-colors cursor-pointer",
                        pageNum === pagination.page
                          ? "bg-primary-600 text-white shadow-sm"
                          : "hover:bg-gray-100 dark:hover:bg-slate-800 text-gray-700 dark:text-gray-300"
                      )}
                    >
                      {pageNum}
                    </button>
                  );
                })}
                <button
                  onClick={() => handlePageChange(pagination.page + 1)}
                  disabled={!pagination.has_next}
                  className={cn(
                    "p-2 rounded-lg transition-colors cursor-pointer",
                    pagination.has_next
                      ? "hover:bg-gray-100 dark:hover:bg-slate-800 text-gray-700 dark:text-gray-300"
                      : "text-gray-300 dark:text-gray-600 cursor-not-allowed"
                  )}
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Detail row for mobile accordion ──
function DetailRow({ label, value, sub }: { label: string; value: string | null; sub?: string | null }) {
  if (!value) return null;
  return (
    <div className="flex items-baseline justify-between gap-4">
      <span className="text-xs text-gray-500 dark:text-gray-400 shrink-0">{label}</span>
      <div className="text-right">
        <span className="text-sm font-medium text-gray-900 dark:text-gray-100">{value}</span>
        {sub && <span className="block text-[11px] text-gray-500 dark:text-gray-400">{sub}</span>}
      </div>
    </div>
  );
}

// ── Filter input with draft (Enter to apply, date applies on change) ──
function FilterInput({
  value,
  onApply,
  type = "text",
  placeholder,
}: {
  value: string;
  onApply: (v: string) => void;
  type?: "text" | "date";
  placeholder?: string;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);

  if (type === "date") {
    return (
      <input
        type="date"
        value={value}
        onChange={(e) => onApply(e.target.value)}
        className="w-full px-3 py-2.5 rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-primary-500/40 focus:border-primary-500 transition-colors cursor-pointer"
      />
    );
  }

  return (
    <div className="relative">
      <input
        type="text"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            onApply(draft.trim());
            (e.target as HTMLInputElement).blur();
          }
        }}
        placeholder={placeholder ?? "Filter..."}
        className="w-full pl-3 pr-8 py-2.5 rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-primary-500/40 focus:border-primary-500 transition-colors"
      />
      {draft && (
        <button
          type="button"
          onClick={() => { setDraft(""); onApply(""); }}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 cursor-pointer"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  );
}

// ── Sortable column header (filter lives in the top Filters Panel) ──
function ColumnHeader({
  label,
  sortKey,
  sortBy,
  sortOrder,
  onSort,
  className,
}: {
  label: string;
  sortKey: string;
  sortBy: string;
  sortOrder: "asc" | "desc";
  onSort: (key: string) => void;
  className?: string;
}) {
  const active = sortBy === sortKey;
  return (
    <th className={cn("px-4 py-3 text-left", className)}>
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className="inline-flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-gray-600 dark:text-gray-400 hover:text-primary-600 dark:hover:text-primary-400 transition-colors cursor-pointer"
      >
        {label}
        {active ? (
          sortOrder === "asc" ? (
            <ArrowUp className="w-3.5 h-3.5" />
          ) : (
            <ArrowDown className="w-3.5 h-3.5" />
          )
        ) : (
          <ChevronsUpDown className="w-3.5 h-3.5 opacity-40" />
        )}
      </button>
    </th>
  );
}
