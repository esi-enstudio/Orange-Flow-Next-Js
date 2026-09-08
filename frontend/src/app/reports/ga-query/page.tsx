"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import apiClient from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import {
  Search, Download, Building2, Calendar, Package,
  RotateCcw, ChevronDown, ChevronLeft, ChevronRight,
  Inbox, TrendingUp, BarChart3, CalendarDays, Hash, Store,
} from "lucide-react";
import { cn } from "@/lib/utils";
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

const SkeletonRow = () => (
  <div className="flex items-center gap-4 px-4 sm:px-6 py-4 animate-pulse border-b border-gray-50 dark:border-slate-800">
    <div className="w-10 h-10 rounded-lg bg-gray-200 dark:bg-slate-700 shrink-0" />
    <div className="space-y-2 flex-1">
      <div className="h-3 w-28 bg-gray-200 dark:bg-slate-700 rounded-md" />
      <div className="h-2.5 w-20 bg-gray-100 dark:bg-slate-800 rounded-md" />
    </div>
    <div className="hidden sm:block flex-1 space-y-2">
      <div className="h-3 w-16 bg-gray-200 dark:bg-slate-700 rounded-md" />
    </div>
    <div className="w-20 h-6 rounded-md bg-gray-200 dark:bg-slate-700" />
  </div>
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
  const [retailerOpen, setRetailerOpen] = useState(false);
  const [retailerMenu, setRetailerMenu] = useState<{ top: number; left: number; width: number } | null>(null);
  const [selectedRetailerIds, setSelectedRetailerIds] = useState<string[]>([]);
  const [loadingRetailers, setLoadingRetailers] = useState(false);

  const [activations, setActivations] = useState<ActivationRecord[]>([]);
  const [pagination, setPagination] = useState<Pagination | null>(null);
  const [loading, setLoading] = useState(false);
  const [searchText, setSearchText] = useState("");

  const [productCodes, setProductCodes] = useState<ProductCodeItem[]>([]);
  const [selectedProductCode, setSelectedProductCode] = useState<string>("");
  const [loadingProducts, setLoadingProducts] = useState(false);

  const [summary, setSummary] = useState<SummaryData | null>(null);

  const [expandedId, setExpandedId] = useState<number | null>(null);

  const retailerDropdownRef = useRef<HTMLDivElement>(null);
  const retailerTriggerRef = useRef<HTMLButtonElement>(null);

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

  // ── Close dropdown on outside click / scroll / resize ──
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (retailerDropdownRef.current && !retailerDropdownRef.current.contains(e.target as Node)) {
        setRetailerOpen(false);
      }
    };
    const onCloseAny = () => setRetailerOpen(false);
    document.addEventListener("mousedown", onClick);
    window.addEventListener("scroll", onCloseAny, true);
    window.addEventListener("resize", onCloseAny);
    return () => {
      document.removeEventListener("mousedown", onClick);
      window.removeEventListener("scroll", onCloseAny, true);
      window.removeEventListener("resize", onCloseAny);
    };
  }, []);

  // ── Toggle retailer menu (fixed-position, viewport-aware) ──
  const toggleRetailerMenu = () => {
    if (!selectedHouseId) return;
    if (retailerOpen) {
      setRetailerOpen(false);
      return;
    }
    const el = retailerTriggerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const menuW = Math.min(Math.max(rect.width, 300), window.innerWidth - 24);
    const menuH = Math.min(window.innerHeight * 0.5, 360);
    const left = Math.max(Math.min(rect.left, window.innerWidth - menuW - 12), 12);
    const below = rect.bottom + 6 + menuH <= window.innerHeight;
    const top = below ? rect.bottom + 6 : Math.max(rect.top - menuH - 6, 12);
    setRetailerMenu({ top, left, width: menuW });
    setRetailerOpen(true);
  };

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

  // ── Fetch activations ──
  const fetchActivations = useCallback(
    async (retIds: string[], page: number = 1) => {
      setLoading(true);
      try {
        const params: Record<string, string | number> = {
          start_date: startDate,
          end_date: endDate,
          page,
          per_page: 50,
        };
        if (retIds.length > 0) params.retailer_ids = retIds.join(",");
        if (selectedProductCode) params.product_code = selectedProductCode;
        if (searchText) params.search = searchText;

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
    [selectedHouseId, startDate, endDate, selectedProductCode, searchText, t]
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
    setSelectedProductCode("");
    setSearchText("");
    fetchProductCodes(selectedRetailerIds);
    fetchActivations(selectedRetailerIds, 1);
    fetchSummary(selectedRetailerIds);
  };

  // ── Page change ──
  const handlePageChange = (newPage: number) => {
    fetchActivations(selectedRetailerIds, newPage);
    setExpandedId(null);
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
          ...(selectedProductCode ? { product_code: selectedProductCode } : {}),
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

  // ── Product filter ──
  useEffect(() => {
    if (activations.length > 0) {
      fetchActivations(selectedRetailerIds, pagination?.page || 1);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedProductCode]);

  const selectedRetailers = useMemo(
    () => retailers.filter((r) => selectedRetailerIds.includes(String(r.id))),
    [retailers, selectedRetailerIds]
  );

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
            <div className="space-y-1.5" ref={retailerDropdownRef}>
              <label className="flex items-center gap-1.5 text-sm font-medium text-gray-700 dark:text-gray-300">
                <Store className="w-4 h-4 text-primary-500" />
                {t("ga_query.select_retailer")}
              </label>
              <div className="relative">
                <button
                  type="button"
                  ref={retailerTriggerRef}
                  onClick={toggleRetailerMenu}
                  disabled={!selectedHouseId}
                  className={cn(
                    "w-full px-3 py-2.5 rounded-lg border text-sm text-left flex items-center justify-between gap-2 transition-colors cursor-pointer",
                    !selectedHouseId
                      ? "border-gray-100 dark:border-slate-800 bg-gray-50 dark:bg-slate-900 text-gray-400 cursor-not-allowed"
                      : selectedRetailers.length > 0
                        ? "border-primary-300 dark:border-primary-500/60 bg-primary-50/60 dark:bg-primary-500/10 text-primary-700 dark:text-primary-300 hover:border-primary-400 dark:hover:border-primary-400 focus:outline-none focus:ring-2 focus:ring-primary-500/40"
                        : "border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-gray-900 dark:text-gray-100 hover:border-primary-300 dark:hover:border-primary-600 focus:outline-none focus:ring-2 focus:ring-primary-500/40"
                  )}
                >
                  <span className="flex flex-col min-w-0">
                    {selectedRetailers.length > 0 ? (
                      <>
                        <span className={cn("truncate font-medium", selectedRetailers.length > 0 ? "text-primary-700 dark:text-primary-300" : "text-gray-900 dark:text-gray-100")}>
                          {selectedRetailers.length} {t("ga_query.selected")}
                        </span>
                        <span className="text-[11px] text-gray-500 dark:text-gray-400 truncate">
                          {selectedRetailers.map((r) => r.retailer_code).join(", ")}
                        </span>
                      </>
                    ) : (
                      <span className="truncate text-gray-400 dark:text-gray-500">{t("ga_query.retailer_search")}</span>
                    )}
                  </span>
                  <ChevronDown className={cn("w-4 h-4 shrink-0 transition-transform", retailerOpen && "rotate-180")} />
                </button>

                {retailerOpen && selectedHouseId && (
                  <div
                    className="fixed z-50 flex flex-col bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-lg shadow-xl"
                    style={{ top: retailerMenu?.top ?? 0, left: retailerMenu?.left ?? 0, width: retailerMenu?.width ?? 300 }}
                  >
                    <div className="p-2 border-b border-gray-100 dark:border-slate-800">
                      <input
                        type="text"
                        value={retailerSearch}
                        onChange={(e) => setRetailerSearch(e.target.value)}
                        placeholder={t("ga_query.retailer_search")}
                        className="w-full px-3 py-2 rounded-md border border-gray-200 dark:border-slate-600 bg-white dark:bg-slate-900 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-primary-500/40"
                        autoFocus
                      />
                    </div>
                    <div className="overflow-y-auto max-h-[min(50vh,360px)]">
                      {loadingRetailers ? (
                        <div className="px-3 py-4 text-sm text-gray-500 dark:text-gray-400 text-center">{t("ga_query.loading_retailers")}</div>
                      ) : retailerSearch.trim().length === 0 ? (
                        <div className="px-3 py-4 text-sm text-gray-400 dark:text-gray-500 text-center">{t("ga_query.type_to_search")}</div>
                      ) : retailers.length === 0 ? (
                        <div className="px-3 py-4 text-sm text-gray-500 dark:text-gray-400 text-center">{t("ga_query.no_retailers")}</div>
                      ) : (
                        retailers.map((r) => {
                          const isSelected = selectedRetailerIds.includes(String(r.id));
                          return (
                            <button
                              key={r.id}
                              onClick={() => {
                                setSelectedRetailerIds((prev) =>
                                  isSelected
                                    ? prev.filter((id) => id !== String(r.id))
                                    : [...prev, String(r.id)]
                                );
                              }}
                              className={cn(
                                "w-full px-3 py-2.5 text-left text-sm transition-colors flex items-start gap-2.5",
                                isSelected
                                  ? "bg-primary-50 dark:bg-primary-500/15 text-primary-600 dark:text-primary-300"
                                  : "text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-slate-700/60"
                              )}
                            >
                              <span
                                className={cn(
                                  "mt-0.5 w-4 h-4 rounded border flex items-center justify-center shrink-0 transition-colors",
                                  isSelected
                                    ? "bg-primary-500 dark:bg-primary-400 border-primary-500 dark:border-primary-400 text-white dark:text-primary-900"
                                    : "border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-800"
                                )}
                              >
                                {isSelected && (
                                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" className="w-3 h-3">
                                    <polyline points="20 6 9 17 4 12" />
                                  </svg>
                                )}
                              </span>
                              <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">
                                <span className={cn("block font-medium leading-snug", isSelected ? "text-primary-700 dark:text-primary-200" : "text-gray-900 dark:text-gray-100")}>
                                  {r.name}
                                  {r.rso_itop_number && (
                                    <span className="text-gray-400 dark:text-gray-500 font-normal">
                                      {" "}({String(r.rso_itop_number).slice(-3)})
                                    </span>
                                  )}
                                </span>
                                <span className="block text-[11px] text-gray-500 dark:text-gray-400 [overflow-wrap:anywhere]">
                                  {r.retailer_code}
                                  {r.itop_number && <span> • {r.itop_number}</span>}
                                </span>
                              </span>
                            </button>
                          );
                        })
                      )}
                    </div>
                  </div>
                )}
              </div>
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

                {/* Product Code Filter */}
                {productCodes.length > 0 && (
                  <select
                    value={selectedProductCode}
                    onChange={(e) => setSelectedProductCode(e.target.value)}
                    className="px-3 py-2 rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-primary-500/40 transition-colors max-w-[180px] sm:max-w-xs cursor-pointer"
                  >
                    <option value="">{t("ga_query.all_product_codes")}</option>
                    {productCodes.map((p) => (
                      <option key={p.code} value={p.code}>
                        {p.code} ({p.count})
                      </option>
                    ))}
                  </select>
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
          {loading && (
            <div className="divide-y divide-gray-50 dark:divide-slate-800">
              {Array.from({ length: 8 }).map((_, i) => <SkeletonRow key={i} />)}
            </div>
          )}

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
                      <th className="text-left px-4 py-3 font-medium text-gray-600 dark:text-gray-400">{t("ga_query.table.activation_date")}</th>
                      <th className="text-left px-4 py-3 font-medium text-gray-600 dark:text-gray-400">{t("ga_query.table.retailer")}</th>
                      <th className="text-left px-4 py-3 font-medium text-gray-600 dark:text-gray-400">{t("ga_query.table.rso")}</th>
                      <th className="text-left px-4 py-3 font-medium text-gray-600 dark:text-gray-400">{t("ga_query.table.sim_no")}</th>
                      <th className="text-left px-4 py-3 font-medium text-gray-600 dark:text-gray-400">{t("ga_query.table.msisdn")}</th>
                      <th className="text-left px-4 py-3 font-medium text-gray-600 dark:text-gray-400">{t("ga_query.table.product_code")}</th>
                      <th className="text-left px-4 py-3 font-medium text-gray-600 dark:text-gray-400">{t("ga_query.table.product_name")}</th>
                      <th className="text-left px-4 py-3 font-medium text-gray-600 dark:text-gray-400">{t("ga_query.table.selling_price")}</th>
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
                          <p className="font-mono text-xs font-medium text-gray-900 dark:text-gray-100">{a.sim_no}</p>
                        </td>
                        <td className="px-2 py-1">
                          <p className="font-mono text-xs text-gray-900 dark:text-gray-100">{a.msisdn || "-"}</p>
                        </td>
                        <td className="px-2 py-1">
                          <span className="inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium bg-primary-50 dark:bg-primary-500/10 text-primary-700 dark:text-primary-300">
                            {a.product_code || "-"}
                          </span>
                        </td>
                        <td className="px-2 py-1 text-gray-600 dark:text-gray-400 max-w-[150px] truncate">{a.product_name || "-"}</td>
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
                          <DetailRow label={t("ga_query.table.msisdn")} value={a.msisdn} />
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
