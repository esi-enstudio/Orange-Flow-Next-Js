"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import apiClient from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import {
  Search,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Download,
  Store,
  MapPin,
  Hash,
  ChevronDown,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "react-hot-toast";
import { AccessDenied } from "@/components/ui/AccessDenied";
import PageGuideModal from "@/components/PageGuideModal";
import { useLanguage } from "@/i18n/useLanguage";
import { houseHeaders, type DropdownMarking, type PaginationMeta, type RetailerRow } from "./types";

export default function RetailersPage() {
  const { selectedHouse, hasPermission, loading: authLoading } = useAuth();
  const router = useRouter();
  const { t } = useLanguage();

  const [retailers, setRetailers] = useState<RetailerRow[]>([]);
  const [markings, setMarkings] = useState<DropdownMarking[]>([]);
  const [loading, setLoading] = useState(true);
  const [markingsLoading, setMarkingsLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [markingFilter, setMarkingFilter] = useState("");
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState<PaginationMeta | null>(null);
  const [sortBy, setSortBy] = useState("id");
  const [sortOrder, setSortOrder] = useState("desc");
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [exporting, setExporting] = useState(false);
  const perPage = 20;

  useEffect(() => {
    if (!authLoading && !hasPermission("retailer_markings.view")) {
      const timer = setTimeout(() => router.push("/"), 5000);
      return () => clearTimeout(timer);
    }
  }, [authLoading, hasPermission, router]);

  const fetchMarkings = useCallback(async () => {
    setMarkingsLoading(true);
    try {
      const res = await apiClient.get("retailer-markings/options");
      setMarkings(res.data || []);
    } catch {
      setMarkings([]);
    } finally {
      setMarkingsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!authLoading && hasPermission("retailer_markings.view")) {
      fetchMarkings();
    }
  }, [authLoading, hasPermission, fetchMarkings]);

  const fetchRetailers = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, any> = {
        page,
        per_page: perPage,
        sort_by: sortBy,
        sort_order: sortOrder,
      };
      if (search) params.search = search;
      if (markingFilter) params.marking = markingFilter;
      const res = await apiClient.get("retailer-markings/retailers", {
        params,
        headers: houseHeaders(selectedHouse),
      });
      setRetailers(res.data.data || []);
      setPagination(res.data.pagination || null);
    } catch {
      toast.error(t("retailer_marking.toast_load_failed"));
    } finally {
      setLoading(false);
    }
  }, [page, search, markingFilter, sortBy, sortOrder, selectedHouse, t]);

  useEffect(() => {
    if (!authLoading && hasPermission("retailer_markings.view")) {
      fetchRetailers();
    }
  }, [selectedHouse, page, sortBy, sortOrder, markingFilter, authLoading, hasPermission, fetchRetailers]);

  const handleSearch = (value: string) => {
    setSearch(value);
    setPage(1);
  };

  const handleExport = async () => {
    if (!hasPermission("retailer_markings.export")) return;
    setExporting(true);
    try {
      const params: Record<string, any> = {};
      if (markingFilter) params.marking_id = markings.find((m) => m.name === markingFilter)?.id;
      const response = await apiClient.get("retailer-markings/export", {
        params,
        headers: houseHeaders(selectedHouse),
        responseType: "blob",
      });
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement("a");
      link.href = url;
      link.setAttribute("download", "retailer_marking_assignments.xlsx");
      document.body.appendChild(link);
      link.click();
      toast.success(t("retailer_marking.toast_export_success"));
    } catch {
      toast.error(t("retailer_marking.toast_export_failed"));
    } finally {
      setExporting(false);
    }
  };

  if (authLoading)
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="w-8 h-8 animate-spin text-primary-500" />
      </div>
    );
  if (!hasPermission("retailer_markings.view")) return <AccessDenied />;

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-gray-900 dark:text-gray-100">
            {t("retailer_marking.retailers_title")}
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            {t("retailer_marking.retailers_description")}
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <PageGuideModal pageKey="retailer_marking" />
          {hasPermission("retailer_markings.export") && (
            <button
              onClick={handleExport}
              disabled={exporting}
              className="inline-flex items-center justify-center gap-2 px-4 py-2 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 text-gray-700 dark:text-gray-200 rounded-xl text-sm font-bold hover:bg-gray-50 dark:hover:bg-slate-800 transition-colors shadow-sm disabled:opacity-50"
            >
              {exporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
              {t("retailer_marking.export_btn")}
            </button>
          )}
        </div>
      </div>

      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-gray-100 dark:border-slate-800 shadow-sm overflow-hidden">
        <div className="p-4 border-b border-gray-50 dark:border-slate-800 flex flex-col sm:flex-row sm:items-center gap-3">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 dark:text-gray-500" />
            <input
              type="text"
              placeholder={t("retailer_marking.search_retailers")}
              className="w-full pl-10 pr-4 py-2.5 bg-gray-50 dark:bg-slate-800 border-none rounded-xl text-sm focus:ring-2 focus:ring-primary-500 transition-all dark:text-gray-100 outline-none"
              value={search}
              onChange={(e) => handleSearch(e.target.value)}
            />
          </div>
          <select
            value={markingFilter}
            onChange={(e) => {
              setMarkingFilter(e.target.value);
              setPage(1);
            }}
            disabled={markingsLoading}
            className="px-3 py-2.5 rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs dark:text-gray-100 focus:ring-2 focus:ring-primary-500 outline-none disabled:opacity-50"
          >
            <option value="">{t("retailer_marking.all_markings")}</option>
            {markings.map((m) => (
              <option key={m.id} value={m.name}>
                {m.name}
              </option>
            ))}
          </select>
        </div>

        {loading ? (
          <div className="divide-y divide-gray-50 dark:divide-slate-800">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex items-center gap-4 px-6 py-5 animate-pulse">
                <div className="w-10 h-10 rounded-xl bg-gray-200 dark:bg-slate-700 shrink-0" />
                <div className="space-y-2 flex-1">
                  <div className="h-3 w-32 bg-gray-200 dark:bg-slate-700 rounded-md" />
                  <div className="h-2.5 w-24 bg-gray-100 dark:bg-slate-800 rounded-md" />
                </div>
                <div className="hidden sm:block flex-1 space-y-2">
                  <div className="h-3 w-20 bg-gray-200 dark:bg-slate-700 rounded-md" />
                  <div className="h-2.5 w-16 bg-gray-100 dark:bg-slate-800 rounded-md" />
                </div>
                <div className="hidden md:block flex-1 space-y-2">
                  <div className="h-4 w-14 bg-gray-200 dark:bg-slate-700 rounded-full" />
                </div>
                <div className="hidden lg:block flex-1 space-y-2">
                  <div className="h-3 w-24 bg-gray-200 dark:bg-slate-700 rounded-md" />
                  <div className="h-2.5 w-14 bg-gray-100 dark:bg-slate-800 rounded-md" />
                </div>
              </div>
            ))}
          </div>
        ) : !pagination || pagination.total === 0 ? (
          <div className="py-20 text-center">
            <Store className="w-12 h-12 text-gray-200 dark:text-gray-700 mx-auto mb-4" />
            <p className="text-gray-500 dark:text-gray-400 font-medium">{t("retailer_marking.no_retailers")}</p>
          </div>
        ) : (
          <>
            {/* Desktop table */}
            <div className="hidden lg:block overflow-x-auto">
              <table className="w-full text-left min-w-[1100px]">
                <thead>
                  <tr className="bg-gray-50/50 dark:bg-slate-800/50 text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-widest border-b border-gray-50 dark:border-slate-800">
                    <th className="px-6 py-4">{t("retailer_marking.table_house")}</th>
                    <th className="px-6 py-4">
                      <button onClick={() => setSortBy("name")} className="flex items-center gap-1 hover:text-gray-600 dark:hover:text-gray-300">
                        {t("retailer_marking.table_retailer")}
                      </button>
                    </th>
                    <th className="px-6 py-4">{t("retailer_marking.rso_col")}</th>
                    <th className="px-6 py-4">{t("retailer_marking.table_status")}</th>
                    <th className="px-6 py-4">{t("retailer_marking.thana_col")}</th>
                    <th className="px-6 py-4">{t("retailer_marking.markings_col")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50 dark:divide-slate-800">
                  {retailers.map((r) => (
                    <tr key={r.id} className="hover:bg-gray-50/30 dark:hover:bg-slate-800/30 transition-colors group">
                      <td className="px-2 py-1">
                        <div className="space-y-1 text-xs py-2">
                          <p className="font-bold text-gray-700 dark:text-gray-200">{r.house?.name || "N/A"}</p>
                          <p className="text-[11px] font-mono text-gray-500 dark:text-gray-400">{r.house?.code || ""}</p>
                        </div>
                      </td>
                      <td className="px-2 py-1">
                        <div className="flex items-center gap-3 py-2">
                          <div className="w-10 h-10 rounded-xl bg-primary-100 dark:bg-primary-500/20 flex items-center justify-center text-primary-700 dark:text-primary-400">
                            <Store className="w-5 h-5" />
                          </div>
                          <div className="min-w-0">
                            <p className="font-bold text-gray-900 dark:text-gray-100 text-sm truncate">{r.name}</p>
                            <div className="flex items-center text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">
                              <span className="font-mono">{r.retailer_code}</span>
                              <span className="text-sm leading-none text-gray-400 dark:text-gray-500 px-0.5">•</span>
                              <span className="font-mono">{r.itop_number || "—"}</span>
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="px-2 py-1">
                        {r.employee ? (
                          <div className="space-y-1 py-2">
                            <p className="font-semibold text-gray-800 dark:text-gray-200 text-sm">{r.employee.name}</p>
                            <div className="flex items-center text-[11px] text-gray-500 dark:text-gray-400">
                              <span className="font-mono">{r.employee.dms_code || "—"}</span>
                              <span className="text-sm leading-none text-gray-400 dark:text-gray-500 px-0.5">•</span>
                              <span className="font-mono">{r.employee.itop_number || "—"}</span>
                            </div>
                          </div>
                        ) : (
                          <span className="text-[11px] text-gray-400 dark:text-gray-500 py-2">—</span>
                        )}
                      </td>
                      <td className="px-2 py-1">
                        <div className="flex flex-col gap-1.5 py-2">
                          {(() => {
                            const isEnabled = r.enabled === "Yes" || r.enabled === "Y";
                            const isSimSeller = r.sim_seller === "Yes" || r.sim_seller === "Y";
                            return (
                              <>
                                <span
                                  className={cn(
                                    "inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider w-fit",
                                    isEnabled
                                      ? "bg-green-50 dark:bg-green-500/10 text-green-700 dark:text-green-400"
                                      : "bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-400"
                                  )}
                                >
                                  <span className={cn("w-1 h-1 rounded-full", isEnabled ? "bg-green-500" : "bg-red-500")} />
                                  {isEnabled ? t("common.enabled") : t("common.disabled")}
                                </span>
                                <span
                                  className={cn(
                                    "px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider w-fit",
                                    isSimSeller
                                      ? "bg-blue-50 text-blue-700 dark:bg-blue-500/10 dark:text-blue-400"
                                      : "bg-gray-50 text-gray-500 dark:bg-slate-800"
                                  )}
                                >
                                  {isSimSeller ? t("retailers.sim_seller_yes") : t("retailers.sim_seller_no")}
                                </span>
                              </>
                            );
                          })()}
                        </div>
                      </td>
                      <td className="px-2 py-1">
                        {r.markings.length === 0 ? (
                          <span className="text-[11px] text-gray-400 dark:text-gray-500">{t("retailer_marking.no_markings_assigned")}</span>
                        ) : (
                          <div className="flex flex-wrap gap-1.5">
                            {r.markings.map((name) => (
                              <span
                                key={name}
                                className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-primary-50 dark:bg-primary-500/10 text-primary-700 dark:text-primary-300 text-[11px] font-semibold border border-primary-100 dark:border-primary-500/20"
                              >
                                <Hash className="w-2.5 h-2.5" />
                                {name}
                              </span>
                            ))}
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile accordion */}
            <div className="lg:hidden divide-y divide-gray-50 dark:divide-slate-800">
              {retailers.map((r) => (
                <div key={r.id}>
                  <button
                    onClick={() => setExpandedId((prev) => (prev === r.id ? null : r.id))}
                    className="w-full flex items-center gap-3 px-5 py-4 text-left"
                  >
                    <div className="w-10 h-10 rounded-xl bg-primary-100 dark:bg-primary-500/20 flex items-center justify-center text-primary-700 dark:text-primary-400 shrink-0">
                      <Store className="w-5 h-5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-bold text-gray-900 dark:text-gray-100 text-sm truncate">{r.name}</p>
                      <p className="text-[11px] text-gray-500 dark:text-gray-400 font-mono truncate">
                        {r.retailer_code} · {r.itop_number || "—"}
                      </p>
                    </div>
                    <ChevronDown
                      className={cn("w-4 h-4 text-gray-400 transition-transform shrink-0", expandedId === r.id && "rotate-180")}
                    />
                  </button>
                  {expandedId === r.id && (
                    <div className="px-5 pb-4 pt-1 space-y-2 animate-in fade-in duration-200">
                      <p className="text-xs text-gray-500 dark:text-gray-400">
                        {t("retailer_marking.table_house")}:{" "}
                        <span className="font-semibold text-gray-700 dark:text-gray-200">{r.house?.name || "N/A"}</span>
                      </p>
                      <p className="text-xs text-gray-500 dark:text-gray-400">
                        {t("retailer_marking.rso_col")}:{" "}
                        {r.employee ? (
                          <span className="font-semibold text-gray-700 dark:text-gray-200">
                            {r.employee.name}
                            <span className="block text-[11px] font-mono font-normal text-gray-400 dark:text-gray-500">
                              {r.employee.dms_code || "—"} · {r.employee.itop_number || "—"}
                            </span>
                          </span>
                        ) : (
                          <span className="font-semibold text-gray-700 dark:text-gray-200">—</span>
                        )}
                      </p>
                      <p className="text-xs text-gray-500 dark:text-gray-400">
                        {t("retailer_marking.table_status")}:{" "}
                        <span className="flex flex-col gap-1 mt-1">
                          <span
                            className={cn(
                              "inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider w-fit",
                              r.enabled === "Yes" || r.enabled === "Y"
                                ? "bg-green-50 dark:bg-green-500/10 text-green-700 dark:text-green-400"
                                : "bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-400"
                            )}
                          >
                            <span
                              className={cn(
                                "w-1 h-1 rounded-full",
                                r.enabled === "Yes" || r.enabled === "Y" ? "bg-green-500" : "bg-red-500"
                              )}
                            />
                            {r.enabled === "Yes" || r.enabled === "Y" ? t("common.enabled") : t("common.disabled")}
                          </span>
                          <span
                            className={cn(
                              "px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider w-fit",
                              r.sim_seller === "Yes" || r.sim_seller === "Y"
                                ? "bg-blue-50 text-blue-700 dark:bg-blue-500/10 dark:text-blue-400"
                                : "bg-gray-50 text-gray-500 dark:bg-slate-800"
                            )}
                          >
                            {r.sim_seller === "Yes" || r.sim_seller === "Y"
                              ? t("retailers.sim_seller_yes")
                              : t("retailers.sim_seller_no")}
                          </span>
                        </span>
                      </p>
                      <p className="text-xs text-gray-500 dark:text-gray-400">
                        {t("retailer_marking.thana_col")}:{" "}
                        <span className="font-semibold text-gray-700 dark:text-gray-200">{r.thana || "—"}</span>
                      </p>
                      <div>
                        <p className="text-[11px] font-semibold text-gray-400 mb-1.5">{t("retailer_marking.markings_col")}</p>
                        {r.markings.length === 0 ? (
                          <p className="text-[11px] text-gray-400 dark:text-gray-500">{t("retailer_marking.no_markings_assigned")}</p>
                        ) : (
                          <div className="flex flex-wrap gap-1.5">
                            {r.markings.map((name) => (
                              <span
                                key={name}
                                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-primary-50 dark:bg-primary-500/10 text-primary-700 dark:text-primary-300 text-[11px] font-semibold border border-primary-100 dark:border-primary-500/20"
                              >
                                <Hash className="w-2.5 h-2.5" />
                                {name}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>

            <div className="p-4 border-t border-gray-50 dark:border-slate-800 flex items-center justify-between">
              <p className="text-xs text-gray-500 dark:text-gray-400">
                {t("retailer_marking.showing_results", {
                  start: pagination.total === 0 ? 0 : (pagination.page - 1) * pagination.per_page + 1,
                  end: Math.min(pagination.page * pagination.per_page, pagination.total),
                  total: pagination.total,
                })}
              </p>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setPage((p) => p - 1)}
                  disabled={!pagination.has_prev}
                  className="p-2 border rounded-lg hover:bg-gray-50 dark:hover:bg-slate-800 disabled:opacity-50"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <span className="text-xs text-gray-500 dark:text-gray-400 font-medium">
                  {pagination.page} / {pagination.total_pages}
                </span>
                <button
                  onClick={() => setPage((p) => p + 1)}
                  disabled={!pagination.has_next}
                  className="p-2 border rounded-lg hover:bg-gray-50 dark:hover:bg-slate-800 disabled:opacity-50"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}