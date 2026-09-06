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
  Store,
  Hash,
  History,
  ChevronDown,
  UserCheck,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "react-hot-toast";
import { AccessDenied } from "@/components/ui/AccessDenied";
import PageGuideModal from "@/components/PageGuideModal";
import { useLanguage } from "@/i18n/useLanguage";
import { houseHeaders, type DropdownMarking, type HistoryRow, type PaginationMeta } from "../types";

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function HistoryPage() {
  const { selectedHouse, hasPermission, loading: authLoading } = useAuth();
  const router = useRouter();
  const { t } = useLanguage();

  const [rows, setRows] = useState<HistoryRow[]>([]);
  const [markings, setMarkings] = useState<DropdownMarking[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [markingFilter, setMarkingFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState<PaginationMeta | null>(null);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const perPage = 20;

  useEffect(() => {
    if (!authLoading && !hasPermission("retailer_markings.view")) {
      const timer = setTimeout(() => router.push("/"), 5000);
      return () => clearTimeout(timer);
    }
  }, [authLoading, hasPermission, router]);

  const fetchMarkings = useCallback(async () => {
    try {
      const res = await apiClient.get("retailer-markings/options");
      setMarkings(res.data || []);
    } catch {
      setMarkings([]);
    }
  }, []);

  useEffect(() => {
    if (!authLoading && hasPermission("retailer_markings.view")) {
      fetchMarkings();
    }
  }, [authLoading, hasPermission, fetchMarkings]);

  const fetchHistory = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, any> = { page, per_page: perPage };
      if (search) params.search = search;
      if (markingFilter) {
        const m = markings.find((x) => x.name === markingFilter);
        if (m) params.marking_id = m.id;
      }
      if (statusFilter) params.status = statusFilter;
      const res = await apiClient.get("retailer-markings/history", {
        params,
        headers: houseHeaders(selectedHouse),
      });
      setRows(res.data.data || []);
      setPagination(res.data.pagination || null);
    } catch {
      toast.error(t("retailer_marking.toast_load_failed"));
    } finally {
      setLoading(false);
    }
  }, [page, search, markingFilter, statusFilter, markings, selectedHouse, t]);

  useEffect(() => {
    if (!authLoading && hasPermission("retailer_markings.view")) {
      fetchHistory();
    }
  }, [selectedHouse, page, markingFilter, statusFilter, authLoading, hasPermission, fetchHistory]);

  const handleSearch = (value: string) => {
    setSearch(value);
    setPage(1);
  };

  if (authLoading)
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="w-8 h-8 animate-spin text-primary-500" />
      </div>
    );
  if (!hasPermission("retailer_markings.view")) return <AccessDenied />;

  const StatusBadge = ({ status }: { status: string }) => (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider",
        status === "active"
          ? "bg-green-50 dark:bg-green-500/10 text-green-700 dark:text-green-400"
          : "bg-gray-100 dark:bg-slate-800 text-gray-500 dark:text-gray-400"
      )}
    >
      <span
        className="w-1 h-1 rounded-full"
        style={{ backgroundColor: status === "active" ? "rgb(34 197 94)" : "rgb(148 163 184)" }}
      />
      {status === "active" ? t("retailer_marking.active") : t("retailer_marking.inactive")}
    </span>
  );

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-gray-900 dark:text-gray-100">
            {t("retailer_marking.history_title")}
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{t("retailer_marking.history_description")}</p>
        </div>
        <PageGuideModal pageKey="retailer_marking" />
      </div>

      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-gray-100 dark:border-slate-800 shadow-sm overflow-hidden">
        <div className="p-4 border-b border-gray-50 dark:border-slate-800 flex flex-col sm:flex-row sm:items-center gap-3">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 dark:text-gray-500" />
            <input
              type="text"
              placeholder={t("retailer_marking.search_placeholder")}
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
            className="px-3 py-2.5 rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs dark:text-gray-100 focus:ring-2 focus:ring-primary-500 outline-none"
          >
            <option value="">{t("retailer_marking.all_markings")}</option>
            {markings.map((m) => (
              <option key={m.id} value={m.name}>
                {m.name}
              </option>
            ))}
          </select>
          <select
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.target.value);
              setPage(1);
            }}
            className="px-3 py-2.5 rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs dark:text-gray-100 focus:ring-2 focus:ring-primary-500 outline-none"
          >
            <option value="">{t("retailer_marking.all_status")}</option>
            <option value="active">{t("retailer_marking.active")}</option>
            <option value="inactive">{t("retailer_marking.inactive")}</option>
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
                </div>
              </div>
            ))}
          </div>
        ) : !pagination || pagination.total === 0 ? (
          <div className="py-20 text-center">
            <History className="w-12 h-12 text-gray-200 dark:text-gray-700 mx-auto mb-4" />
            <p className="text-gray-500 dark:text-gray-400 font-medium">{t("retailer_marking.no_history")}</p>
          </div>
        ) : (
          <>
            {/* Desktop table */}
            <div className="hidden lg:block overflow-x-auto">
              <table className="w-full text-left min-w-[1000px]">
                <thead>
                  <tr className="bg-gray-50/50 dark:bg-slate-800/50 text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-widest border-b border-gray-50 dark:border-slate-800">
                    <th className="px-6 py-4">{t("retailer_marking.table_retailer")}</th>
                    <th className="px-6 py-4">{t("retailer_marking.marking_col")}</th>
                    <th className="px-6 py-4">{t("retailer_marking.table_status")}</th>
                    <th className="px-6 py-4">{t("retailer_marking.assigned_at")}</th>
                    <th className="px-6 py-4">{t("retailer_marking.assigned_by")}</th>
                    <th className="px-6 py-4">{t("retailer_marking.removed_at")}</th>
                    <th className="px-6 py-4">{t("retailer_marking.remarks")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50 dark:divide-slate-800">
                  {rows.map((r) => (
                    <tr key={r.id} className="hover:bg-gray-50/30 dark:hover:bg-slate-800/30 transition-colors group">
                      <td className="px-2 py-1">
                        <div className="flex items-center gap-3 py-2">
                          <div className="w-10 h-10 rounded-xl bg-primary-100 dark:bg-primary-500/20 flex items-center justify-center text-primary-700 dark:text-primary-400 shrink-0">
                            <Store className="w-5 h-5" />
                          </div>
                          <div>
                            <p className="font-bold text-gray-900 dark:text-gray-100 text-sm">{r.retailer?.name}</p>
                            <p className="text-[11px] font-mono text-gray-500 dark:text-gray-400">
                              {r.retailer?.retailer_code}
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className="px-2 py-1">
                        <span className="inline-flex items-center gap-1 text-xs font-semibold text-gray-700 dark:text-gray-200">
                          <Hash className="w-3 h-3 text-primary-500" /> {r.marking_name || "—"}
                        </span>
                      </td>
                      <td className="px-2 py-1">
                        <StatusBadge status={r.status} />
                      </td>
                      <td className="px-2 py-1">
                        <p className="text-xs text-gray-600 dark:text-gray-300">{formatDate(r.assigned_at)}</p>
                      </td>
                      <td className="px-2 py-1">
                        <p className="text-xs text-gray-600 dark:text-gray-300 flex items-center gap-1.5">
                          <UserCheck className="w-3 h-3 text-gray-400" /> {r.assigned_by_name || "—"}
                        </p>
                      </td>
                      <td className="px-2 py-1">
                        <p className="text-xs text-gray-600 dark:text-gray-300">{formatDate(r.removed_at)}</p>
                      </td>
                      <td className="px-2 py-1">
                        <p className="text-xs text-gray-500 dark:text-gray-400 max-w-[200px] truncate">{r.remarks || "—"}</p>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile accordion */}
            <div className="lg:hidden divide-y divide-gray-50 dark:divide-slate-800">
              {rows.map((r) => (
                <div key={r.id}>
                  <button
                    onClick={() => setExpandedId((prev) => (prev === r.id ? null : r.id))}
                    className="w-full flex items-center gap-3 px-5 py-4 text-left"
                  >
                    <div className="w-10 h-10 rounded-xl bg-primary-100 dark:bg-primary-500/20 flex items-center justify-center text-primary-700 dark:text-primary-400 shrink-0">
                      <Store className="w-5 h-5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-bold text-gray-900 dark:text-gray-100 text-sm truncate">{r.retailer?.name}</p>
                      <p className="text-[11px] text-gray-500 dark:text-gray-400 font-mono truncate">
                        {r.retailer?.retailer_code} · {r.marking_name || "—"}
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      <StatusBadge status={r.status} />
                      <p className="text-[11px] text-gray-400 mt-1">{formatDate(r.assigned_at)}</p>
                    </div>
                    <ChevronDown
                      className={cn("w-4 h-4 text-gray-400 transition-transform shrink-0", expandedId === r.id && "rotate-180")}
                    />
                  </button>
                  {expandedId === r.id && (
                    <div className="px-5 pb-4 pt-1 space-y-2 animate-in fade-in duration-200">
                      <p className="text-xs text-gray-500 dark:text-gray-400">
                        {t("retailer_marking.assigned_by")}:{" "}
                        <span className="font-semibold text-gray-700 dark:text-gray-200">{r.assigned_by_name || "—"}</span>
                      </p>
                      <p className="text-xs text-gray-500 dark:text-gray-400">
                        {t("retailer_marking.removed_at")}:{" "}
                        <span className="font-semibold text-gray-700 dark:text-gray-200">{formatDate(r.removed_at)}</span>
                      </p>
                      {r.removed_by_name && (
                        <p className="text-xs text-gray-500 dark:text-gray-400">
                          {t("retailer_marking.removed_by")}:{" "}
                          <span className="font-semibold text-gray-700 dark:text-gray-200">{r.removed_by_name}</span>
                        </p>
                      )}
                      <p className="text-xs text-gray-500 dark:text-gray-400">
                        {t("retailer_marking.remarks")}:{" "}
                        <span className="font-semibold text-gray-700 dark:text-gray-200">{r.remarks || "—"}</span>
                      </p>
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