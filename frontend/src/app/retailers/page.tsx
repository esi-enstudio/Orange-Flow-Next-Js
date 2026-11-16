"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import apiClient from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import {
  Search,
  ChevronLeft,
  ChevronRight,
  Loader2,
  User,
  Phone,
  Smartphone,
  Store,
  Hash,
  CalendarDays,
  Upload,
  Download,
  FileSpreadsheet,
  Eye,
  X,
  ArrowUpDown,
  SlidersHorizontal,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "react-hot-toast";
import { motion, AnimatePresence } from "framer-motion";
import { AccessDenied } from "@/components/ui/AccessDenied";
import PageGuideModal from "@/components/PageGuideModal";
import { useLanguage } from "@/i18n/useLanguage";
import EntitySelector from "@/app/zoom-in/_components/EntitySelector";
import { houseHeaders } from "@/app/retailers/retailer-marking/types";

interface Retailer {
  id: number;
  house_id: number;
  retailer_code: string;
  name: string;
  type: string;
  enabled: string;
  sim_seller: string;
  scratch_card_seller: string;
  tran_mobile_no: string;
  itop_sr_number: string;
  itop_number: string;
  service_point: string;
  category: string;
  owner_name: string;
  contact_no: string;
  district: string;
  thana: string;
  address: string;
  nid: string;
  bp_code: string;
  bp_number: string;
  dob: string;
  route: string;
  on_route_today: boolean;
  routes?: { id: number; code: string; name?: string | null; is_primary: boolean }[];
  house?: { name: string, code: string };
  employee?: { name: string, employee_name?: string, itop_number: string, dms_code: string, user?: { name: string } };
}

interface PaginationMeta {
  page: number;
  per_page: number;
  total: number;
  total_pages: number;
  has_next: boolean;
  has_prev: boolean;
}

interface House {
  id: number;
  name: string;
  code: string;
}

interface RetailerOption {
  id: number;
  retailer_code: string;
  name: string;
  itop_number?: string | null;
  itop_sr_number?: string | null;
}

interface RsoOption {
  id: number;
  dms_code: string;
  itop_number: string;
  employee_name?: string;
}

interface RouteOption {
  id: number;
  code: string;
  name?: string | null;
}

interface FilterOptions {
  types: string[];
  service_points: string[];
  categories: string[];
  thanas: string[];
}

interface RetailerFilters {
  house_id: number | null;
  retailer_ids: string[];
  employee_ids: string[];
  route_ids: string[];
  retailer_type: string;
  enabled: string;
  sim_seller: string;
  scratch_card_seller: string;
  service_point: string;
  category: string;
  thana: string;
  visit_day: string;
  on_route_today: boolean;
}

const EMPTY_FILTERS: RetailerFilters = {
  house_id: null,
  retailer_ids: [],
  employee_ids: [],
  route_ids: [],
  retailer_type: "",
  enabled: "",
  sim_seller: "",
  scratch_card_seller: "",
  service_point: "",
  category: "",
  thana: "",
  visit_day: "",
  on_route_today: false,
};

const EMPTY_OPTIONS: FilterOptions = {
  types: [],
  service_points: [],
  categories: [],
  thanas: [],
};

const WEEKDAY_OPTIONS = [
  { value: "saturday", key: "weekday_sat" },
  { value: "sunday", key: "weekday_sun" },
  { value: "monday", key: "weekday_mon" },
  { value: "tuesday", key: "weekday_tue" },
  { value: "wednesday", key: "weekday_wed" },
  { value: "thursday", key: "weekday_thu" },
  { value: "friday", key: "weekday_fri" },
] as const;

const selectClass =
  "w-full h-10 px-3 rounded-xl border border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-sm text-gray-900 dark:text-gray-100 outline-none focus:ring-2 focus:ring-primary-500 cursor-pointer disabled:cursor-not-allowed disabled:opacity-50 transition-colors";

function cloneFilters(filters: RetailerFilters): RetailerFilters {
  return {
    ...filters,
    retailer_ids: [...filters.retailer_ids],
    employee_ids: [...filters.employee_ids],
    route_ids: [...filters.route_ids],
  };
}

function countActiveFilters(filters: RetailerFilters): number {
  let count = 0;
  if (filters.house_id) count += 1;
  if (filters.retailer_ids.length) count += 1;
  if (filters.employee_ids.length) count += 1;
  if (filters.route_ids.length) count += 1;
  if (filters.retailer_type) count += 1;
  if (filters.enabled) count += 1;
  if (filters.sim_seller) count += 1;
  if (filters.scratch_card_seller) count += 1;
  if (filters.service_point) count += 1;
  if (filters.category) count += 1;
  if (filters.thana) count += 1;
  if (filters.visit_day) count += 1;
  if (filters.on_route_today) count += 1;
  return count;
}

export default function RetailersPage() {
  const { selectedHouse, hasPermission, loading: authLoading } = useAuth();
  const router = useRouter();
  const { t } = useLanguage();
  const [retailers, setRetailers] = useState<Retailer[]>([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState<RetailerFilters>({ ...EMPTY_FILTERS });
  const [draftFilters, setDraftFilters] = useState<RetailerFilters>({ ...EMPTY_FILTERS });
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [houses, setHouses] = useState<House[]>([]);
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState<PaginationMeta | null>(null);
  const [sortBy, setSortBy] = useState("id");
  const [sortOrder, setSortOrder] = useState("desc");
  const perPage = 5;

  const [searchText, setSearchText] = useState("");
  const [searchQuery, setSearchQuery] = useState("");

  const [filterOptions, setFilterOptions] = useState<FilterOptions>({ ...EMPTY_OPTIONS });
  const [retailerLookup, setRetailerLookup] = useState<Record<string, { label: string; sublabel?: string }>>({});
  const [retailerSearch, setRetailerSearch] = useState("");
  const [loadingRetailerOptions, setLoadingRetailerOptions] = useState(false);
  const [rsoOptions, setRsoOptions] = useState<RsoOption[]>([]);
  const [routeOptions, setRouteOptions] = useState<RouteOption[]>([]);

  useEffect(() => {
    if (!authLoading && !hasPermission("retailers.view")) {
      const timer = setTimeout(() => {
        router.push("/");
      }, 5000);
      return () => clearTimeout(timer);
    }
  }, [authLoading, hasPermission, router]);

  const [isImporting, setIsImporting] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [importProgress, setImportProgress] = useState(0);
  const [viewingRetailer, setViewingRetailer] = useState<Retailer | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const houseId = useMemo(
    () => filters.house_id ?? selectedHouse?.id ?? null,
    [filters.house_id, selectedHouse]
  );
  const draftHouseId = useMemo(
    () => draftFilters.house_id ?? selectedHouse?.id ?? null,
    [draftFilters.house_id, selectedHouse]
  );

  const scopeHeaders = useCallback(
    (scopeHouseId: number | null) =>
      scopeHouseId ? { "X-House-ID": String(scopeHouseId) } : undefined,
    []
  );

  // Toolbar search is immediate (debounced); drawer filters apply on Apply.
  useEffect(() => {
    const timer = setTimeout(() => {
      setSearchQuery(searchText.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchText]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, any> = {
        page,
        per_page: perPage,
        sort_by: sortBy,
        sort_order: sortOrder,
      };
      if (searchQuery) params.search = searchQuery;
      if (filters.retailer_ids.length) params.retailer_ids = filters.retailer_ids.join(",");
      if (filters.employee_ids.length) params.employee_ids = filters.employee_ids.join(",");
      if (filters.route_ids.length) params.route_ids = filters.route_ids.join(",");
      if (filters.retailer_type) params.retailer_type = filters.retailer_type;
      if (filters.enabled) params.enabled = filters.enabled;
      if (filters.sim_seller) params.sim_seller = filters.sim_seller;
      if (filters.scratch_card_seller) params.scratch_card_seller = filters.scratch_card_seller;
      if (filters.service_point) params.service_point = filters.service_point;
      if (filters.category) params.category = filters.category;
      if (filters.thana) params.thana = filters.thana;
      if (filters.on_route_today) params.on_route_today = true;
      else if (filters.visit_day) params.visit_day = filters.visit_day;

      const headers = scopeHeaders(houseId);
      const retRes = await apiClient.get("retailers", headers ? { params, headers } : { params });
      setRetailers(retRes.data.data || []);
      setPagination(retRes.data.pagination || null);
    } catch (err) {
      console.error("Failed to fetch data", err);
      setRetailers([]);
      setPagination(null);
    } finally {
      setLoading(false);
    }
  }, [page, filters, sortBy, sortOrder, searchQuery, houseId, scopeHeaders]);

  useEffect(() => {
    if (!authLoading && hasPermission("retailers.view")) {
      fetchData();
    }
  }, [authLoading, hasPermission, fetchData]);

  useEffect(() => {
    if (authLoading || !hasPermission("retailers.view")) return;
    apiClient.get("houses/accessible")
      .then((res) => {
        const data = res.data?.data || res.data || [];
        setHouses(Array.isArray(data) ? data : []);
      })
      .catch(() => {});
  }, [authLoading, hasPermission]);

  const loadFilterOptions = useCallback(async (scopeHouseId: number | null) => {
    try {
      const res = await apiClient.get("retailers/filter-options", {
        headers: scopeHeaders(scopeHouseId),
      });
      setFilterOptions({
        types: res.data?.data?.types || [],
        service_points: res.data?.data?.service_points || [],
        categories: res.data?.data?.categories || [],
        thanas: res.data?.data?.thanas || [],
      });
    } catch {
      setFilterOptions({ ...EMPTY_OPTIONS });
    }
  }, [scopeHeaders]);

  const loadRetailerOptions = useCallback(async (scopeHouseId: number | null, query: string) => {
    if (!scopeHouseId) return;
    setLoadingRetailerOptions(true);
    try {
      const res = await apiClient.get(`retailers/by-house/${scopeHouseId}`, {
        params: query ? { search: query } : undefined,
        headers: scopeHeaders(scopeHouseId),
      });
      const rows: RetailerOption[] = res.data || [];
      setRetailerLookup((prev) => {
        const next = { ...prev };
        rows.forEach((row) => {
          // Retailer code first, with the iTop number right next to it so the two
          // identifiers can be told apart at a glance in the selector.
          const itop = row.itop_number || row.itop_sr_number;
          next[String(row.id)] = {
            label: row.name,
            sublabel:
              [row.retailer_code, itop ? `iTop ${itop}` : null].filter(Boolean).join(" • ") ||
              undefined,
          };
        });
        return next;
      });
    } catch {
      // keep whatever options are already cached
    } finally {
      setLoadingRetailerOptions(false);
    }
  }, [scopeHeaders]);

  const loadRsoOptions = useCallback(async (scopeHouseId: number | null) => {
    try {
      const params: Record<string, string | number> = {
        status: "Active",
        employee_type: "rso",
        sort_by: "dms_code",
        sort_order: "asc",
        per_page: 200,
      };
      if (scopeHouseId) params.filter_house_id = scopeHouseId;
      const res = await apiClient.get("employees", {
        params,
        headers: scopeHeaders(scopeHouseId),
      });
      setRsoOptions(res.data?.data || []);
    } catch {
      setRsoOptions([]);
    }
  }, [scopeHeaders]);

  const loadRouteOptions = useCallback(async (scopeHouseId: number | null) => {
    try {
      const res = await apiClient.get("routes/options", {
        params: { limit: 500 },
        headers: scopeHeaders(scopeHouseId),
      });
      setRouteOptions(res.data?.data || []);
    } catch {
      setRouteOptions([]);
    }
  }, [scopeHeaders]);

  useEffect(() => {
    if (!filtersOpen) return;
    loadFilterOptions(draftHouseId);
    loadRsoOptions(draftHouseId);
    loadRouteOptions(draftHouseId);
    loadRetailerOptions(draftHouseId, "");
  }, [filtersOpen, draftHouseId, loadFilterOptions, loadRsoOptions, loadRouteOptions, loadRetailerOptions]);

  useEffect(() => {
    if (!filtersOpen) return;
    const query = retailerSearch.trim();
    if (query.length < 2) return;
    const timer = setTimeout(() => loadRetailerOptions(draftHouseId, query), 300);
    return () => clearTimeout(timer);
  }, [retailerSearch, filtersOpen, draftHouseId, loadRetailerOptions]);

  const toggleSort = (field: string) => {
    if (sortBy === field) {
      setSortOrder(prev => prev === "asc" ? "desc" : "asc");
    } else {
      setSortBy(field);
      setSortOrder("desc");
    }
    setPage(1);
  };

  const openFilters = () => {
    setDraftFilters(cloneFilters(filters));
    setRetailerSearch("");
    setFiltersOpen(true);
  };

  const applyFilters = () => {
    setFilters(cloneFilters(draftFilters));
    setPage(1);
    setFiltersOpen(false);
  };

  const handleImportClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsImporting(true);
    setImportProgress(20);

    const importData = new FormData();
    importData.append("file", file);

    try {
      setImportProgress(40);
      const response = await apiClient.post("retailers/import", importData, { timeout: 300000 });
      setImportProgress(100);
      toast.success(response.data.message);
      fetchData();
    } catch (err: any) {
      const detail = err.response?.data?.detail;
      let msg = "Import failed";
      if (typeof detail === "string") {
        msg = detail;
      } else if (Array.isArray(detail)) {
        msg = detail.map((e: any) => e.msg || "").filter(Boolean).join(", ");
      }
      toast.error(msg);
    } finally {
      setTimeout(() => {
        setIsImporting(false);
        setImportProgress(0);
        if (fileInputRef.current) fileInputRef.current.value = "";
      }, 1000);
    }
  };

  const handleExport = async () => {
    setIsExporting(true);
    try {
      const headers = scopeHeaders(houseId);
      const response = await apiClient.get("retailers/export", headers ? { responseType: 'blob', headers } : { responseType: 'blob' });
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', 'retailers.xlsx');
      document.body.appendChild(link);
      link.click();
      toast.success(t('retailers.toast_export_success') || 'Export successful');
    } catch (err) {
      toast.error(t('retailers.toast_export_failed') || 'Export failed');
    } finally {
      setIsExporting(false);
    }
  };

  const handleDmsRetailerListExport = async () => {
    if (!hasPermission("retailers.sync")) {
      toast.error(t('retailers.no_sync_permission') || 'You do not have permission to sync retailer list from DMS');
      return;
    }
    setIsExporting(true);
    try {
      const res = await apiClient.post("dms/retailer-list-export", {}, { headers: houseHeaders(selectedHouse) });
      toast.success(t('retailers.toast_dms_export_success') || 'DMS retailer list export started');
    } catch (err: any) {
      const detail = err.response?.data?.detail;
      let msg = "DMS export failed";
      if (typeof detail === "string") {
        msg = detail;
      } else if (Array.isArray(detail)) {
        msg = detail.map((e: any) => e.msg || "").filter(Boolean).join(", ");
      }
      toast.error(msg);
    } finally {
      setIsExporting(false);
    }
  };

  if (!authLoading && !hasPermission("retailers.view")) {
    return <AccessDenied />;
  }

  const activeFilterCount = countActiveFilters(filters);
  const draftActiveCount = countActiveFilters(draftFilters);
  const retailerItems = Object.entries(retailerLookup).map(([id, value]) => ({
    id,
    label: value.label,
    sublabel: value.sublabel,
  }));
  const rsoItems = rsoOptions.map((employee) => ({
    id: String(employee.id),
    label: employee.employee_name || employee.dms_code || String(employee.id),
    sublabel: [employee.dms_code, employee.itop_number].filter(Boolean).join(" · ") || undefined,
  }));
  const routeItems = routeOptions.map((route) => ({
    id: String(route.id),
    label: route.name || route.code,
    sublabel: route.code,
  }));

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">{t('retailers.title')}</h1>
            <PageGuideModal pageKey="retailers" />
          </div>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1 transition-colors">{t('retailers.description')}</p>
        </div>
        <div className="flex flex-wrap gap-3">
          <input type="file" ref={fileInputRef} onChange={handleFileChange} className="hidden" accept=".xlsx, .xls" />
          <button
            onClick={handleImportClick}
            disabled={isImporting}
            className="inline-flex items-center justify-center gap-2 px-4 py-2 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 text-gray-700 dark:text-gray-200 rounded-lg text-sm font-bold hover:bg-gray-50 dark:hover:bg-slate-800 transition-colors shadow-sm disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
          >
            {isImporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
            {t('retailers.import_list')}
          </button>
          <button
            onClick={handleDmsRetailerListExport}
            disabled={!hasPermission("retailers.sync") || isExporting}
            className="inline-flex items-center justify-center gap-2 px-4 py-2 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 text-gray-700 dark:text-gray-200 rounded-lg text-sm font-bold hover:bg-gray-50 dark:hover:bg-slate-800 transition-colors shadow-sm cursor-pointer disabled:cursor-not-allowed"
          >
            {isExporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
            {t('retailers.dms_export')}
          </button>
          <button
            onClick={handleExport}
            disabled={isExporting}
            className="inline-flex items-center justify-center gap-2 px-4 py-2 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 text-gray-700 dark:text-gray-200 rounded-lg text-sm font-bold hover:bg-gray-50 dark:hover:bg-slate-800 transition-colors shadow-sm disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
          >
            {isExporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
            {t('retailers.export_list')}
          </button>
        </div>
      </div>

      {isImporting && (
        <div className="bg-white dark:bg-slate-900 p-6 rounded-2xl border border-primary-100 dark:border-primary-500/20 shadow-xl animate-in slide-in-from-top-4 duration-300">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-primary-100 dark:bg-primary-500/20 rounded-xl text-primary-600">
                <FileSpreadsheet className="w-5 h-5" />
              </div>
              <div>
                <h4 className="text-sm font-bold text-gray-900 dark:text-gray-100">{t('retailers.import_processing')}</h4>
                <p className="text-xs text-gray-500 dark:text-gray-400">{t('retailers.import_wait')}</p>
              </div>
            </div>
            <span className="text-sm font-black text-primary-600">{importProgress}%</span>
          </div>
          <div className="w-full h-2 bg-gray-100 dark:bg-slate-800 rounded-full overflow-hidden">
            <div
              className="h-full bg-primary-500 transition-all duration-500 ease-out shadow-[0_0_10px_rgba(249,115,22,0.5)]"
              style={{ width: `${importProgress}%` }}
            />
          </div>
        </div>
      )}

      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-gray-100 dark:border-slate-800 shadow-sm overflow-hidden transition-colors duration-300">
        <div className="p-4 border-b border-gray-50 dark:border-slate-800">
          <div className="flex flex-row gap-2 md:gap-4 justify-between items-center">
            <div className="flex items-center gap-2 min-w-0">
              <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">{t('retailers.title')}</h2>
              {pagination && (
                <span className="text-xs text-gray-500 dark:text-gray-400">
                  {t('retailers.showing_results', {
                    start: pagination.total === 0 ? 0 : (pagination.page - 1) * pagination.per_page + 1,
                    end: Math.min(pagination.page * pagination.per_page, pagination.total),
                    total: pagination.total,
                  })}
                </span>
              )}
            </div>
            <div className="flex items-center gap-2 ml-auto">
              <div className="relative group">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 dark:text-gray-500 transition-colors group-focus-within:text-primary-500" />
                <input
                  type="text"
                  placeholder={t('retailers.search_placeholder')}
                  className="w-44 sm:w-72 pl-10 pr-4 py-2.5 bg-gray-50 dark:bg-slate-800 border-none rounded-xl text-sm focus:ring-2 focus:ring-primary-500 transition-all dark:text-gray-100 outline-none cursor-text"
                  value={searchText}
                  onChange={(e) => setSearchText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      setSearchQuery(searchText.trim());
                      setPage(1);
                    }
                  }}
                />
              </div>
              <button
                onClick={openFilters}
                title={t('retailers.filters_title')}
                aria-label={t('retailers.filters_title')}
                className="relative p-2.5 rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-gray-600 dark:text-gray-300 hover:border-primary-400 hover:text-primary-600 transition-colors cursor-pointer shrink-0"
              >
                <SlidersHorizontal className="w-4 h-4" />
                {activeFilterCount > 0 && (
                  <span className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] px-1 rounded-full bg-primary-600 text-white text-[10px] font-semibold flex items-center justify-center">
                    {activeFilterCount}
                  </span>
                )}
              </button>
            </div>
          </div>
        </div>

        {loading ? (
          <div className="divide-y divide-gray-50 dark:divide-slate-800">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex items-center gap-4 px-6 py-5 animate-pulse">
                <div className="flex items-center gap-3 flex-1">
                  <div className="w-10 h-10 rounded-xl bg-gray-200 dark:bg-slate-700 shrink-0" />
                  <div className="space-y-2">
                    <div className="h-3 w-32 bg-gray-200 dark:bg-slate-700 rounded-md" />
                    <div className="h-2.5 w-24 bg-gray-100 dark:bg-slate-800 rounded-md" />
                  </div>
                </div>
                <div className="hidden sm:block flex-1 space-y-2">
                  <div className="h-3 w-20 bg-gray-200 dark:bg-slate-700 rounded-md" />
                  <div className="h-2.5 w-16 bg-gray-100 dark:bg-slate-800 rounded-md" />
                </div>
                <div className="hidden md:block flex-1 space-y-2">
                  <div className="h-4 w-14 bg-gray-200 dark:bg-slate-700 rounded-full" />
                  <div className="h-3 w-10 bg-gray-100 dark:bg-slate-800 rounded-full" />
                </div>
                <div className="hidden lg:block flex-1 space-y-2">
                  <div className="h-3 w-24 bg-gray-200 dark:bg-slate-700 rounded-md" />
                  <div className="h-2.5 w-14 bg-gray-100 dark:bg-slate-800 rounded-md" />
                </div>
                <div className="w-10 h-10 rounded-lg bg-gray-200 dark:bg-slate-700 shrink-0" />
              </div>
            ))}
          </div>
        ) : !pagination || pagination.total === 0 ? (
          <div className="py-20 text-center">
            <Store className="w-12 h-12 text-gray-200 dark:text-gray-700 mx-auto mb-4" />
            <p className="text-gray-500 dark:text-gray-400 font-medium">{t('retailers.no_retailers')}</p>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-left min-w-[1300px] whitespace-nowrap">
                <thead>
                  <tr className="bg-gray-50/50 dark:bg-slate-800/50 text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-widest border-b border-gray-50 dark:border-slate-800">
                    <th className="px-6 py-4">
                      <button onClick={() => toggleSort("house_id")} className="flex items-center gap-1 hover:text-gray-600 dark:hover:text-gray-300 cursor-pointer">
                        {t('retailers.table_house')}
                        <ArrowUpDown className="w-3 h-3" />
                      </button>
                    </th>
                    <th className="px-6 py-4">
                      <button onClick={() => toggleSort("name")} className="flex items-center gap-1 hover:text-gray-600 dark:hover:text-gray-300 cursor-pointer">
                        {t('retailers.table_name')}
                        <ArrowUpDown className="w-3 h-3" />
                      </button>
                    </th>
                    <th className="px-6 py-4">{t('retailers.field_type')}</th>
                    <th className="px-6 py-4">{t('retailers.field_category')}</th>
                    <th className="px-6 py-4">{t('retailers.table_rso')}</th>
                    <th className="px-6 py-4">{t('retailers.table_route')}</th>
                    <th className="px-6 py-4">{t('retailers.on_route_today_badge')}</th>
                    <th className="px-6 py-4">{t('retailers.table_status')}</th>
                    <th className="px-6 py-4"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50 dark:divide-slate-800">
                  {retailers.map((r) => (
                    <tr key={r.id} className="hover:bg-gray-50/30 dark:hover:bg-slate-800/30 transition-colors group">
                      <td className="px-6 py-4">
                        <div className="space-y-1 text-xs">
                          <p className="font-bold text-gray-700 dark:text-gray-200">{r.house?.name || "N/A"}</p>
                          <p className="text-[10px] font-mono text-gray-500 dark:text-gray-400">{r.house?.code || ""}</p>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-xl bg-primary-100 dark:bg-primary-500/20 flex items-center justify-center text-primary-700 dark:text-primary-400 font-bold shadow-sm">
                            <Store className="w-5 h-5" />
                          </div>
                          <div>
                            <p className="font-bold text-gray-900 dark:text-gray-100 text-sm">{r.name}</p>
                            <p className="text-[11px] text-gray-500 dark:text-gray-400 flex items-center gap-1.5">
                              <Phone className="w-2.5 h-2.5" /> {r.itop_number} <Hash className="w-2.5 h-2.5 ml-1" /> {r.retailer_code}
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className="px-2 py-1">
                        <span className="text-xs text-gray-700 dark:text-gray-200">{r.type || "—"}</span>
                      </td>
                      <td className="px-2 py-1">
                        <span className="text-xs text-gray-700 dark:text-gray-200">{r.category || "—"}</span>
                      </td>
                      <td className="px-6 py-4">
                        <div className="space-y-1">
                          <p className="text-xs font-bold text-gray-700 dark:text-gray-200 flex items-center gap-1.5">
                            <User className="w-3 h-3 text-purple-500" /> {r.employee?.employee_name || r.employee?.name || t('retailers.no_rso')}
                          </p>
                          {r.employee?.itop_number && (
                            <p className="text-[11px] text-gray-500 dark:text-gray-400 font-mono flex items-center gap-1">
                              <Smartphone className="w-2.5 h-2.5 text-blue-500" /> {r.employee.itop_number}
                              {r.employee.dms_code && (
                                <span>• {r.employee.dms_code}</span>
                              )}
                            </p>
                          )}
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="space-y-1">
                          <p className="text-xs font-bold text-gray-700 dark:text-gray-200 truncate max-w-[200px]" title={r.routes?.map((route) => route.name || route.code).join(", ") || r.route || ""}>
                            {r.routes && r.routes.length > 0
                              ? r.routes.map((route) => route.name || route.code).join(", ")
                              : r.route || "—"}
                          </p>
                          {r.routes && r.routes.length > 0 && (
                            <p className="text-[11px] font-mono text-gray-500 dark:text-gray-400 truncate max-w-[200px]">
                              {r.routes.map((route) => route.code).join(", ")}
                            </p>
                          )}
                        </div>
                      </td>
                      <td className="px-2 py-1">
                        <span className={cn(
                          "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold",
                          r.on_route_today
                            ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300"
                            : "bg-gray-50 text-gray-500 dark:bg-slate-800 dark:text-gray-400"
                        )}>
                          {r.on_route_today && <CalendarDays className="h-3 w-3" />}
                          {r.on_route_today ? t("common.yes") : t("common.no")}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex flex-col gap-1.5">
                          {(() => {
                            const isEnabled = r.enabled === "Yes" || r.enabled === "Y";
                            const isSimSeller = r.sim_seller === "Yes" || r.sim_seller === "Y";
                            const isScratchCardSeller = r.scratch_card_seller === "Yes" || r.scratch_card_seller === "Y";
                            return (
                              <>
                                <span className={cn(
                                  "inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider w-fit",
                                  isEnabled
                                    ? "bg-green-50 dark:bg-green-500/10 text-green-700 dark:text-green-400"
                                    : "bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-400"
                                )}>
                                  <span className={cn("w-1 h-1 rounded-full", isEnabled ? "bg-green-500" : "bg-red-500")}></span>
                                  {isEnabled ? t('common.enabled') : t('common.disabled')}
                                </span>
                                <span className={cn(
                                  "px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider w-fit",
                                  isSimSeller ? "bg-blue-50 text-blue-700 dark:bg-blue-500/10 dark:text-blue-400" : "bg-gray-50 text-gray-500 dark:bg-slate-800"
                                )}>
                                  {isSimSeller ? t('retailers.sso_yes') : t('retailers.sso_no')}
                                </span>
                                {isScratchCardSeller && (
                                  <span className="px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider w-fit bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400">
                                    {t('retailers.field_scratch_card_seller')}
                                  </span>
                                )}
                              </>
                            );
                          })()}
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <button
                          onClick={() => setViewingRetailer(r)}
                          className="p-2 text-gray-400 hover:text-primary-500 hover:bg-primary-50 dark:hover:bg-primary-500/10 rounded-lg transition-colors cursor-pointer"
                          title={t('retailers.view_details')}
                        >
                          <Eye className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="p-4 border-t border-gray-50 dark:border-slate-800 flex items-center justify-between">
              <p className="text-xs text-gray-500 dark:text-gray-400">
                {t('retailers.showing_results', {
                  start: pagination.total === 0 ? 0 : (pagination.page - 1) * pagination.per_page + 1,
                  end: Math.min(pagination.page * pagination.per_page, pagination.total),
                  total: pagination.total
                })}
              </p>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setPage(p => p - 1)}
                  disabled={!pagination.has_prev}
                  className="p-2 border rounded-lg hover:bg-gray-50 dark:hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <span className="text-xs text-gray-500 dark:text-gray-400 font-medium">
                  {pagination.page} / {pagination.total_pages}
                </span>
                <button
                  onClick={() => setPage(p => p + 1)}
                  disabled={!pagination.has_next}
                  className="p-2 border rounded-lg hover:bg-gray-50 dark:hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          </>
        )}
      </div>

      {viewingRetailer && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] overflow-y-auto mx-4 animate-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between p-6 border-b border-gray-100 dark:border-slate-800">
              <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">
                <Store className="w-5 h-5 text-primary-500" />
                {viewingRetailer.name}
                <span className="text-sm font-mono text-gray-400 font-normal">#{viewingRetailer.retailer_code}</span>
              </h2>
              <button
                onClick={() => setViewingRetailer(null)}
                className="p-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-slate-800 rounded-xl transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-4">
              <Field label={t('retailers.field_retailer_code')} value={viewingRetailer.retailer_code} />
              <Field label={t('retailers.field_retailer_name')} value={viewingRetailer.name} />
              <Field label={t('retailers.field_type')} value={viewingRetailer.type} />
              <Field label={t('retailers.field_category')} value={viewingRetailer.category} />
              <Field
                label={t('retailers.field_route')}
                value={
                  viewingRetailer.routes && viewingRetailer.routes.length > 0
                    ? viewingRetailer.routes.map((route) => route.code).join(", ")
                    : viewingRetailer.route
                }
              />
              <Field label={t('retailers.field_itop')} value={viewingRetailer.itop_number} />
              <Field label={t('retailers.field_sr_number')} value={viewingRetailer.itop_sr_number} />
              <Field label={t('retailers.field_tran_mobile')} value={viewingRetailer.tran_mobile_no} />
              <Field label={t('retailers.field_service_point')} value={viewingRetailer.service_point} />
              <Field label={t('retailers.field_sim_seller')} value={viewingRetailer.sim_seller === "Yes" || viewingRetailer.sim_seller === "Y" ? "Yes" : "No"} />
              <Field label={t('retailers.field_scratch_card_seller')} value={viewingRetailer.scratch_card_seller === "Yes" || viewingRetailer.scratch_card_seller === "Y" ? "Yes" : "No"} />
              <Field label={t('common.enabled')} value={viewingRetailer.enabled === "Yes" || viewingRetailer.enabled === "Y" ? t('common.enabled') : t('common.disabled')} />
              <Field label={t('retailers.field_house')} value={viewingRetailer.house ? `${viewingRetailer.house.name} (${viewingRetailer.house.code})` : "N/A"} />
              <Field label={t('retailers.no_rso')} value={viewingRetailer.employee?.employee_name || viewingRetailer.employee?.name || "N/A"} />
              <Field label={t('retailers.field_owner_name')} value={viewingRetailer.owner_name} />
              <Field label={t('retailers.field_contact_no')} value={viewingRetailer.contact_no} />
              <Field label={t('retailers.field_district')} value={viewingRetailer.district} />
              <Field label={t('retailers.field_thana')} value={viewingRetailer.thana} />
              <Field label={t('retailers.field_address')} value={viewingRetailer.address} className="md:col-span-2" />
              <Field label={t('retailers.field_nid')} value={viewingRetailer.nid} />
              <Field label={t('retailers.field_bp_code')} value={viewingRetailer.bp_code} />
              <Field label={t('retailers.field_bp_number')} value={viewingRetailer.bp_number} />
              <Field label={t('retailers.field_dob')} value={viewingRetailer.dob} />
            </div>
            <div className="p-6 pt-0 flex justify-end">
              <button
                onClick={() => setViewingRetailer(null)}
                className="px-6 py-2.5 bg-gray-100 dark:bg-slate-800 text-gray-700 dark:text-gray-200 rounded-xl text-sm font-bold hover:bg-gray-200 dark:hover:bg-slate-700 transition-colors cursor-pointer"
              >
                {t('retailers.btn_close')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Filter Drawer — right-side panel, filters apply only on Apply */}
      <AnimatePresence>
        {filtersOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setFiltersOpen(false)}
              className="fixed inset-0 z-[100] bg-black/30 backdrop-blur-sm"
            />
            <motion.aside
              initial={{ x: "100%" }}
              animate={{ x: 0 }}
              exit={{ x: "100%" }}
              transition={{ type: "spring", damping: 25, stiffness: 200 }}
              role="dialog"
              aria-modal="true"
              aria-label={t('retailers.filters_title')}
              className="fixed inset-y-0 right-0 z-[101] w-full sm:max-w-md bg-white dark:bg-slate-900 shadow-2xl flex flex-col"
            >
              <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-gray-100 dark:border-slate-800">
                <div className="flex items-center gap-2">
                  <h2 className="text-base font-bold text-gray-900 dark:text-gray-100">
                    {t('retailers.filters_title')}
                  </h2>
                  {draftActiveCount > 0 && (
                    <span className="text-[10px] font-bold bg-primary-100 dark:bg-primary-500/20 text-primary-700 dark:text-primary-300 px-2 py-0.5 rounded-full">
                      {t('retailers.filters_active_count', { count: draftActiveCount })}
                    </span>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => setFiltersOpen(false)}
                  aria-label={t('retailers.filters_close')}
                  className="p-2 rounded-lg text-gray-400 hover:bg-gray-100 dark:hover:bg-slate-800 hover:text-gray-600 dark:hover:text-gray-300 transition-colors cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
                <FilterField label={t('retailers.field_house')}>
                  <select
                    value={draftFilters.house_id ? String(draftFilters.house_id) : ""}
                    onChange={(e) =>
                      setDraftFilters((prev) => ({
                        ...prev,
                        house_id: e.target.value ? Number(e.target.value) : null,
                        retailer_ids: [],
                        employee_ids: [],
                        route_ids: [],
                      }))
                    }
                    className={selectClass}
                  >
                    <option value="">{t('retailers.filters_all_houses')}</option>
                    {houses.map((house) => (
                      <option key={house.id} value={house.id}>
                        {house.name} ({house.code})
                      </option>
                    ))}
                  </select>
                </FilterField>

                <EntitySelector
                  label={t('retailers.filters_retailer')}
                  items={retailerItems}
                  selectedIds={draftFilters.retailer_ids}
                  onChange={(ids) =>
                    setDraftFilters((prev) => ({ ...prev, retailer_ids: ids.map(String) }))
                  }
                  placeholder={t('retailers.filters_retailer_placeholder')}
                  searchPlaceholder={t('retailers.filters_retailer_search')}
                  emptyMessage={loadingRetailerOptions ? t('common.loading') : t('retailers.filters_retailer_placeholder')}
                  noResultsMessage={t('retailers.filters_retailer_no_results')}
                  onSearchChange={setRetailerSearch}
                  disabled={!draftHouseId}
                  selectAllLabel={t('common.select_all')}
                  clearLabel={t('common.clear')}
                  selectedLabel={t('retailers.filters_selected')}
                />

                <FilterField label={t('retailers.filters_type')}>
                  <select
                    value={draftFilters.retailer_type}
                    onChange={(e) => setDraftFilters((prev) => ({ ...prev, retailer_type: e.target.value }))}
                    className={selectClass}
                  >
                    <option value="">{t('retailers.filters_all_types')}</option>
                    {filterOptions.types.map((type) => (
                      <option key={type} value={type}>{type}</option>
                    ))}
                  </select>
                </FilterField>

                <div className="grid grid-cols-2 gap-3">
                  <FilterField label={t('retailers.filters_enabled')}>
                    <select
                      value={draftFilters.enabled}
                      onChange={(e) => setDraftFilters((prev) => ({ ...prev, enabled: e.target.value }))}
                      className={selectClass}
                    >
                      <option value="">{t('retailers.filters_any')}</option>
                      <option value="Yes">{t('common.yes')}</option>
                      <option value="No">{t('common.no')}</option>
                    </select>
                  </FilterField>
                  <FilterField label={t('retailers.filters_sim_seller')}>
                    <select
                      value={draftFilters.sim_seller}
                      onChange={(e) => setDraftFilters((prev) => ({ ...prev, sim_seller: e.target.value }))}
                      className={selectClass}
                    >
                      <option value="">{t('retailers.filters_any')}</option>
                      <option value="Yes">{t('common.yes')}</option>
                      <option value="No">{t('common.no')}</option>
                    </select>
                  </FilterField>
                </div>

                <FilterField label={t('retailers.filters_scratch_card_seller')}>
                  <select
                    value={draftFilters.scratch_card_seller}
                    onChange={(e) => setDraftFilters((prev) => ({ ...prev, scratch_card_seller: e.target.value }))}
                    className={selectClass}
                  >
                    <option value="">{t('retailers.filters_any')}</option>
                    <option value="Yes">{t('common.yes')}</option>
                    <option value="No">{t('common.no')}</option>
                  </select>
                </FilterField>

                <EntitySelector
                  label={t('retailers.filters_rso')}
                  items={rsoItems}
                  selectedIds={draftFilters.employee_ids}
                  onChange={(ids) =>
                    setDraftFilters((prev) => ({ ...prev, employee_ids: ids.map(String) }))
                  }
                  placeholder={t('retailers.filters_all_rsos')}
                  searchPlaceholder={t('retailers.filters_rso')}
                  emptyMessage={t('retailers.filters_all_rsos')}
                  noResultsMessage={t('retailers.filters_retailer_no_results')}
                  selectAllLabel={t('common.select_all')}
                  clearLabel={t('common.clear')}
                  selectedLabel={t('retailers.filters_selected')}
                />

                <FilterField label={t('retailers.filters_service_point')}>
                  <select
                    value={draftFilters.service_point}
                    onChange={(e) => setDraftFilters((prev) => ({ ...prev, service_point: e.target.value }))}
                    className={selectClass}
                  >
                    <option value="">{t('retailers.filters_any')}</option>
                    {filterOptions.service_points.map((value) => (
                      <option key={value} value={value}>{value}</option>
                    ))}
                  </select>
                </FilterField>

                <FilterField label={t('retailers.filters_category')}>
                  <select
                    value={draftFilters.category}
                    onChange={(e) => setDraftFilters((prev) => ({ ...prev, category: e.target.value }))}
                    className={selectClass}
                  >
                    <option value="">{t('retailers.filters_any')}</option>
                    {filterOptions.categories.map((value) => (
                      <option key={value} value={value}>{value}</option>
                    ))}
                  </select>
                </FilterField>

                <FilterField label={t('retailers.filters_thana')}>
                  <select
                    value={draftFilters.thana}
                    onChange={(e) => setDraftFilters((prev) => ({ ...prev, thana: e.target.value }))}
                    className={selectClass}
                  >
                    <option value="">{t('retailers.filters_any')}</option>
                    {filterOptions.thanas.map((value) => (
                      <option key={value} value={value}>{value}</option>
                    ))}
                  </select>
                </FilterField>

                <EntitySelector
                  label={t('retailers.field_route')}
                  items={routeItems}
                  selectedIds={draftFilters.route_ids}
                  onChange={(ids) =>
                    setDraftFilters((prev) => ({ ...prev, route_ids: ids.map(String) }))
                  }
                  placeholder={t('retailers.filters_route')}
                  searchPlaceholder={t('retailers.filters_route')}
                  emptyMessage={t('retailers.filters_routes_empty')}
                  noResultsMessage={t('retailers.filters_routes_empty')}
                  selectAllLabel={t('common.select_all')}
                  clearLabel={t('common.clear')}
                  selectedLabel={t('retailers.filters_selected')}
                />

                <div className="space-y-1.5">
                  <label className="flex items-center justify-between gap-3 px-3 py-2.5 rounded-xl border border-gray-200 dark:border-slate-800 cursor-pointer">
                    <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                      {t('retailers.filters_on_route_today')}
                    </span>
                    <input
                      type="checkbox"
                      checked={draftFilters.on_route_today}
                      onChange={(e) =>
                        setDraftFilters((prev) => ({
                          ...prev,
                          on_route_today: e.target.checked,
                          visit_day: e.target.checked ? "" : prev.visit_day,
                        }))
                      }
                      className="h-4 w-4 accent-primary-600 cursor-pointer"
                    />
                  </label>
                  <p className="text-[11px] text-gray-500 dark:text-gray-400">
                    {t('retailers.filters_on_route_hint')}
                  </p>
                </div>

                <FilterField label={t('retailers.filters_weekday')}>
                  <select
                    value={draftFilters.visit_day}
                    onChange={(e) => setDraftFilters((prev) => ({ ...prev, visit_day: e.target.value }))}
                    disabled={draftFilters.on_route_today}
                    className={selectClass}
                  >
                    <option value="">{t('retailers.filters_weekday_any')}</option>
                    {WEEKDAY_OPTIONS.map((day) => (
                      <option key={day.value} value={day.value}>
                        {t(`retailers.${day.key}`)}
                      </option>
                    ))}
                  </select>
                </FilterField>
              </div>

              <div className="px-5 py-4 border-t border-gray-100 dark:border-slate-800 space-y-2">
                <button
                  type="button"
                  onClick={applyFilters}
                  className="w-full inline-flex items-center justify-center gap-2 px-6 py-2.5 rounded-lg text-sm font-medium bg-primary-600 text-white hover:bg-primary-700 shadow-sm shadow-primary-600/25 active:scale-[0.98] transition-all cursor-pointer"
                >
                  <Search className="w-4 h-4" />
                  {t('retailers.filters_apply')}
                </button>
                <button
                  type="button"
                  onClick={() => setDraftFilters({ ...EMPTY_FILTERS })}
                  className="w-full inline-flex items-center justify-center gap-2 px-6 py-2 rounded-lg text-sm font-medium border border-gray-200 dark:border-slate-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                >
                  {t('retailers.filters_reset')}
                </button>
              </div>
            </motion.aside>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}

function FilterField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="block text-sm font-bold text-gray-700 dark:text-gray-300">{label}</label>
      {children}
    </div>
  );
}

function Field({ label, value, className = "" }: { label: string; value?: string | null; className?: string }) {
  return (
    <div className={className}>
      <p className="text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-widest mb-0.5">{label}</p>
      <p className="text-sm font-medium text-gray-800 dark:text-gray-200 break-words">{value || "—"}</p>
    </div>
  );
}
