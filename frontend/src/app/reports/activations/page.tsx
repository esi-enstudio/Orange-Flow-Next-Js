"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import apiClient from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import {
  BarChart3,
  Filter,
  RotateCcw,
  ChevronLeft,
  ChevronRight,
  Search,
  Calendar,
  Store,
  Tag,
  X,
  Download,
  Copy,
  User
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "react-hot-toast";
import { AccessDenied } from "@/components/ui/AccessDenied";
import { useLanguage } from "@/i18n/useLanguage";

interface Tag {
  id: number;
  name: string;
}

interface ActivationRecord {
  id: number;
  activation_date: string;
  retailer_code: string;
  retailer_name: string;
  retailer_tags: string[];
  rso: { name: string; itop: string } | null;
  sim_no: string;
  msisdn: string;
  product_name: string;
  product_code: string;
  selling_price: string;
  thana: string;
  house: { id: number; name: string; code: string } | null;
}

interface ReportResponse {
  total_activations: number;
  excluded_count: number;
  filtered_total: number;
  excluded_tags: string[];
  page: number;
  page_size: number;
  data: ActivationRecord[];
}

export default function ActivationsReportPage() {
  const { selectedHouse, hasPermission, loading: authLoading } = useAuth();
  const router = useRouter();
  const { t } = useLanguage();

  const [tags, setTags] = useState<Tag[]>([]);
  const [selectedExcludeTags, setSelectedExcludeTags] = useState<string[]>([]);
  const today = new Date();
  const firstDay = new Date(today.getFullYear(), today.getMonth(), 1);
  const lastDay = new Date(today.getFullYear(), today.getMonth() + 1, 0);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  const [startDate, setStartDate] = useState(fmt(firstDay));
  const [endDate, setEndDate] = useState(fmt(lastDay));
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [report, setReport] = useState<ReportResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const pageSize = 10;

  useEffect(() => {
    if (!authLoading && !hasPermission("view_reports")) {
      const timer = setTimeout(() => router.push("/"), 5000);
      return () => clearTimeout(timer);
    }
  }, [authLoading, hasPermission, router]);

  const fetchTags = useCallback(async () => {
    try {
      const res = await apiClient.get("filter-tags");
      setTags(res.data);
    } catch {
      // silently fail
    }
  }, []);

  const fetchReport = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, any> = {
        page,
        page_size: pageSize
      };
      if (startDate) params.start_date = startDate;
      if (endDate) params.end_date = endDate;
      if (selectedExcludeTags.length > 0) params.exclude_tags = selectedExcludeTags.join(",");
      if (search) params.search = search;

      const res = await apiClient.get("activations/report", { params });
      setReport(res.data);
    } catch {
      toast.error("Failed to load report");
    } finally {
      setLoading(false);
      setInitialLoading(false);
    }
  }, [page, startDate, endDate, selectedExcludeTags, search]);

  useEffect(() => {
    if (!authLoading && hasPermission("view_reports")) {
      fetchTags();
      fetchReport();
    }
  }, [authLoading, hasPermission, fetchTags, fetchReport]);

  const handleRefresh = () => {
    setPage(1);
    fetchReport();
  };

  const toggleExcludeTag = (tagName: string) => {
    setSelectedExcludeTags(prev =>
      prev.includes(tagName) ? prev.filter(t => t !== tagName) : [...prev, tagName]
    );
    setPage(1);
  };

  const handleExport = async () => {
    try {
      const params: Record<string, any> = {};
      if (startDate) params.start_date = startDate;
      if (endDate) params.end_date = endDate;
      if (selectedExcludeTags.length > 0) params.exclude_tags = selectedExcludeTags.join(",");

      const res = await apiClient.get("activations/export", {
        params,
        responseType: 'blob'
      });
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', 'activations_report.xlsx');
      document.body.appendChild(link);
      link.click();
      toast.success("Export successful");
    } catch {
      toast.error("Export failed");
    }
  };

  const totalPages = report ? Math.ceil(report.filtered_total / pageSize) : 0;

  if (!authLoading && !hasPermission("view_reports")) {
    return <AccessDenied />;
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">{t('activation_report.title')}</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{t('activation_report.description')}</p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={handleExport}
            className="inline-flex items-center gap-2 px-4 py-2 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 text-gray-700 dark:text-gray-200 rounded-lg text-sm font-bold hover:bg-gray-50 dark:hover:bg-slate-800 transition-colors shadow-sm"
          >
            <Download className="w-4 h-4" />
            {t('activation_report.export_report')}
          </button>
          <button
            onClick={handleRefresh}
            disabled={loading}
            className="inline-flex items-center gap-2 px-4 py-2 bg-primary-500 text-white rounded-lg text-sm font-bold hover:bg-primary-600 transition-colors shadow-sm disabled:opacity-50"
          >
            <RotateCcw className={cn("w-4 h-4", loading && "animate-spin")} />
            {t('activation_report.refresh')}
          </button>
        </div>
      </div>

      {/* Stats Cards */}
      {report && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="bg-white dark:bg-slate-900 rounded-xl border border-gray-100 dark:border-slate-800 p-4 shadow-sm">
            <p className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider">{t('activation_report.total_activations')}</p>
            <p className="text-2xl font-black text-gray-900 dark:text-gray-100 mt-1">{report.total_activations.toLocaleString()}</p>
          </div>
          <div className="bg-white dark:bg-slate-900 rounded-xl border border-gray-100 dark:border-slate-800 p-4 shadow-sm">
            <p className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider">{t('activation_report.excluded')}</p>
            <p className="text-2xl font-black text-rose-600 dark:text-rose-400 mt-1">{report.excluded_count.toLocaleString()}</p>
            {report.excluded_tags.length > 0 && (
              <p className="text-[10px] text-gray-400 mt-1">{report.excluded_tags.join(", ")}</p>
            )}
          </div>
          <div className="bg-white dark:bg-slate-900 rounded-xl border border-gray-100 dark:border-slate-800 p-4 shadow-sm">
            <p className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider">{t('activation_report.filtered_total')}</p>
            <p className="text-2xl font-black text-emerald-600 dark:text-emerald-400 mt-1">{report.filtered_total.toLocaleString()}</p>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-gray-100 dark:border-slate-800 shadow-sm overflow-hidden">
        <div className="p-4 border-b border-gray-50 dark:border-slate-800">
          <div className="flex flex-wrap items-end gap-4">
            <div className="flex-1 min-w-[200px]">
              <label className="text-[10px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1 block">{t('activation_report.start_date')}</label>
              <div className="relative">
                <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input
                  type="date"
                  value={startDate}
                  onChange={e => { setStartDate(e.target.value); setPage(1); }}
                  className="w-full pl-10 pr-4 py-2.5 bg-gray-50 dark:bg-slate-800 border-none rounded-xl text-sm focus:ring-2 focus:ring-primary-500 outline-none dark:text-gray-100"
                />
              </div>
            </div>
            <div className="flex-1 min-w-[200px]">
              <label className="text-[10px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1 block">{t('activation_report.end_date')}</label>
              <div className="relative">
                <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input
                  type="date"
                  value={endDate}
                  onChange={e => { setEndDate(e.target.value); setPage(1); }}
                  className="w-full pl-10 pr-4 py-2.5 bg-gray-50 dark:bg-slate-800 border-none rounded-xl text-sm focus:ring-2 focus:ring-primary-500 outline-none dark:text-gray-100"
                />
              </div>
            </div>
            <div className="flex-1 min-w-[200px]">
              <label className="text-[10px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1 block">{t('activation_report.search')}</label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input
                  type="text"
                  value={search}
                  onChange={e => { setSearch(e.target.value); setPage(1); }}
                  placeholder={t('activation_report.search')}
                  className="w-full pl-10 pr-4 py-2.5 bg-gray-50 dark:bg-slate-800 border-none rounded-xl text-sm focus:ring-2 focus:ring-primary-500 outline-none dark:text-gray-100"
                />
              </div>
            </div>
          </div>
        </div>

        {/* Exclude Tags */}
        {tags.length > 0 && (
          <div className="p-4 border-b border-gray-50 dark:border-slate-800">
            <div className="flex items-center gap-2 mb-3">
              <Filter className="w-4 h-4 text-gray-400" />
              <span className="text-xs font-bold text-gray-500 dark:text-gray-400">{t('activation_report.exclude_tags')}</span>
            </div>
            <div className="flex flex-wrap gap-2">
              {tags.map(tag => (
                <button
                  key={tag.id}
                  onClick={() => toggleExcludeTag(tag.name)}
                  className={cn(
                    "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all border",
                    selectedExcludeTags.includes(tag.name)
                      ? "bg-rose-50 dark:bg-rose-500/10 border-rose-200 dark:border-rose-500/30 text-rose-700 dark:text-rose-400"
                      : "bg-gray-50 dark:bg-slate-800 border-gray-200 dark:border-slate-700 text-gray-600 dark:text-gray-400 hover:border-gray-300 dark:hover:border-slate-600"
                  )}
                >
                  <Tag className="w-3 h-3" />
                  {tag.name}
                  {selectedExcludeTags.includes(tag.name) && <X className="w-3 h-3" />}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Data Table */}
        {initialLoading ? (
          <div className="py-20 flex flex-col items-center justify-center gap-4">
            <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary-500" />
          </div>
        ) : !report || report.data.length === 0 ? (
          <div className="py-20 text-center">
            <BarChart3 className="w-12 h-12 text-gray-200 dark:text-gray-700 mx-auto mb-4" />
            <p className="text-gray-500 dark:text-gray-400 font-medium">{t('activation_report.no_data')}</p>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-left min-w-[1000px]">
                <thead>
                  <tr className="bg-gray-50/50 dark:bg-slate-800/50 text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-widest border-b border-gray-50 dark:border-slate-800">
                    <th className="px-6 py-4">{t('activation_report.house')}</th>
                    <th className="px-6 py-4">{t('activation_report.date')}</th>
                    <th className="px-6 py-4">{t('activation_report.retailer')}</th>
                    <th className="px-6 py-4">{t('activation_report.rso')}</th>
                    <th className="px-6 py-4">{t('activation_report.sim')}</th>
                    <th className="px-6 py-4">{t('activation_report.product')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50 dark:divide-slate-800">
                  {report.data.map(r => {
                    const dateStr = r.activation_date
                      ? new Date(r.activation_date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
                      : "—";
                    return (
                    <tr key={r.id} className="hover:bg-gray-50/30 dark:hover:bg-slate-800/30 transition-colors">
                      <td className="px-6 py-4">
                        <div>
                          <p className="text-xs font-bold text-gray-600 dark:text-gray-400">{r.house?.name || "—"}</p>
                          {r.house?.code && <p className="text-[10px] text-gray-500 font-mono">{r.house.code}</p>}
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <span className="text-sm font-bold text-gray-900 dark:text-gray-100">{dateStr}</span>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-2">
                          <div className="w-8 h-8 rounded-lg bg-primary-100 dark:bg-primary-500/20 flex items-center justify-center text-primary-600 dark:text-primary-400 shrink-0">
                            <Store className="w-4 h-4" />
                          </div>
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className="text-sm font-bold text-gray-900 dark:text-gray-100">{r.retailer_name}</span>
                              {r.retailer_tags && r.retailer_tags.map(tag => (
                                <span key={tag} className="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-bold bg-indigo-50 dark:bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border border-indigo-100 dark:border-indigo-500/20">
                                  {tag}
                                </span>
                              ))}
                            </div>
                            <p className="text-[10px] text-gray-500 font-mono">{r.retailer_code}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        {r.rso ? (
                          <div className="flex items-center gap-2">
                            <div className="w-7 h-7 rounded-lg bg-amber-100 dark:bg-amber-500/20 flex items-center justify-center text-amber-600 dark:text-amber-400 shrink-0">
                              <User className="w-3.5 h-3.5" />
                            </div>
                            <div>
                              <p className="text-xs font-bold text-gray-900 dark:text-gray-100">{r.rso.name}</p>
                              <p className="text-[10px] text-gray-500 font-mono">{r.rso.itop}</p>
                            </div>
                          </div>
                        ) : (
                          <span className="text-xs text-gray-400">—</span>
                        )}
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-2">
                          <div>
                            <div className="flex items-center gap-1">
                              <span className="text-xs font-mono font-bold text-gray-700 dark:text-gray-300">{r.sim_no || "—"}</span>
                              {r.sim_no && (
                                <button
                                  onClick={() => { navigator.clipboard.writeText(r.sim_no); toast.success("SIM copied"); }}
                                  className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors"
                                  title="Copy SIM"
                                >
                                  <Copy className="w-3 h-3" />
                                </button>
                              )}
                            </div>
                            {r.msisdn && (
                              <p className="text-[10px] text-gray-500 font-mono mt-0.5">{r.msisdn}</p>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <div>
                          <p className="text-xs font-medium text-gray-600 dark:text-gray-400">{r.product_name || "—"}</p>
                          {r.product_code && <p className="text-[10px] text-gray-500 font-mono">{r.product_code}</p>}
                        </div>
                      </td>
                    </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            <div className="p-4 border-t border-gray-50 dark:border-slate-800 flex items-center justify-between">
              <p className="text-xs text-gray-500 dark:text-gray-400">
                {t('activation_report.showing_results', {
                  start: ((page - 1) * pageSize) + 1,
                  end: Math.min(page * pageSize, report.filtered_total),
                  total: report.filtered_total
                })}
              </p>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  disabled={page <= 1}
                  className="p-2 border rounded-lg hover:bg-gray-50 dark:hover:bg-slate-800 disabled:opacity-50 transition-colors"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <span className="text-xs font-bold text-gray-500 dark:text-gray-400 px-2">
                  {t('activation_report.page')} {page} / {totalPages}
                </span>
                <button
                  onClick={() => setPage(p => p + 1)}
                  disabled={page >= totalPages}
                  className="p-2 border rounded-lg hover:bg-gray-50 dark:hover:bg-slate-800 disabled:opacity-50 transition-colors"
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
