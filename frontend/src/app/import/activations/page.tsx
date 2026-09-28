"use client";
import { useState, useRef, useEffect, useCallback } from "react";
import { useLanguage } from "@/i18n/useLanguage";
import { useAuth } from "@/context/AuthContext";
import {
  Upload, Download, ChevronLeft, ChevronRight, ChevronDown,
  Loader2, Database, X, CheckCircle2, Trash2,
} from "lucide-react";
import { toast } from "react-hot-toast";
import axios from "@/lib/api";
import Cookies from "js-cookie";
import { AccessDenied } from "@/components/ui/AccessDenied";
import { cn } from "@/lib/utils";
import ActivationFilterBar, {
  ActivationFilters,
  defaultActivationFilters,
} from "@/components/activation-filters/ActivationFilterBar";

interface Activation {
  id: number; sim_no: string; activation_date: string; activation_time: string;
  retailer_code: string; retailer_name: string; bts_code: string; thana: string;
  promotion: string; product_code: string; product_name: string; msisdn: string;
  selling_price: string; bp_flag: string; bp_number: string;
  fc_bts_code: string; bio_bts_code: string; dh_lifting_date: string; issue_date: string;
  subscription_type: string; service_class: string; customer_second_contact: string;
  rso_name: string | null; rso_employee_id: number | null;
  rso_dms_code: string | null; rso_itop_number: string | null;
  house_id: number;
  house?: { id: number; name: string; code: string };
}

interface Pagination {
  page: number; per_page: number; total: number;
  total_pages: number; has_next: boolean; has_prev: boolean;
}

interface HouseOption {
  id: number; name: string; code: string; display_name: string;
}

const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function formatDate(dateStr: string): string {
  if (!dateStr) return "-";
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;
  } catch { return dateStr; }
}

export default function ImportActivationsPage() {
  const { t } = useLanguage();
  const { hasPermission, loading: authLoading } = useAuth();
  const [data, setData] = useState<Activation[]>([]);
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState<Pagination | null>(null);
  const [importProgress, setImportProgress] = useState<{percent: number; message: string} | null>(null);
  const [showSummary, setShowSummary] = useState(false);
  const [summaryData, setSummaryData] = useState<{message: string; count: number} | null>(null);
  const [summaryType, setSummaryType] = useState<"success" | "error">("success");
  const [filters, setFilters] = useState<ActivationFilters>({ ...defaultActivationFilters });
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [houses, setHouses] = useState<HouseOption[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const perPage = 10;

  const fetchData = useCallback(async () => {
    // The table is always scoped to one house: with no house picked nothing is
    // requested at all, so a user can never land on every house's records.
    if (!filters.house_id) {
      setData([]);
      setPagination(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      // The X-House-ID header mirrors the picked house so the table and the export
      // always cover the same house, and the backend still rejects any house the
      // user cannot read.
      const headers: Record<string, string> = { "X-House-ID": filters.house_id };
      const params: Record<string, string | number> = {
        skip: (page - 1) * perPage, limit: perPage, house_id: filters.house_id,
      };
      if (filters.sim_msisdn) params.sim_msisdn = filters.sim_msisdn;
      if (filters.employee_ids.length) params.employee_ids = filters.employee_ids.join(",");
      if (filters.retailer_codes.length) params.retailer_codes = filters.retailer_codes.join(",");
      if (filters.product_codes.length) params.product_codes = filters.product_codes.join(",");
      const res = await axios.get("/activations", { params, headers });
      setData(res.data.data || []);
      const total = res.data.total || 0;
      const totalPages = Math.ceil(total / perPage);
      setPagination({
        page, per_page: perPage, total, total_pages: totalPages,
        has_next: page < totalPages, has_prev: page > 1,
      });
    } catch {
      toast.error("Failed to load");
    } finally {
      setLoading(false);
    }
  }, [page, filters]);

  // Any filter change re-runs the query from the first page.
  const handleFilterChange = useCallback((next: ActivationFilters) => {
    setFilters(next);
    setPage(1);
    setExpandedId(null);
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    axios.get("/houses/accessible").then(r => setHouses(r.data || [])).catch(() => {});
  }, []);

  const handlePageChange = (newPage: number) => {
    if (newPage === page || !pagination) return;
    setPage(newPage);
    setExpandedId(null);
  };

  const readSSEStream = async (response: Response) => {
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let result: any = null;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        if (line.startsWith("data: ")) {
          try {
            const d = JSON.parse(line.slice(6));
            if (d.type === "progress") {
              const msg = d.message || "";
              const pctMatch = msg.match(/(\d+)%/);
              const pct = pctMatch ? parseInt(pctMatch[1]) : 0;
              setImportProgress({ percent: pct, message: msg });
            } else if (d.type === "complete") {
              result = d;
              setSummaryData({ message: d.message, count: d.count });
              setSummaryType("success");
              setShowSummary(true);
              setTimeout(() => setShowSummary(false), 6000);
            } else if (d.type === "error") {
              setSummaryData({ message: d.message, count: 0 });
              setSummaryType("error");
              setShowSummary(true);
              setTimeout(() => setShowSummary(false), 6000);
              throw new Error(d.message);
            }
          } catch (e: any) {
            if (e.message !== "Unexpected end of JSON input") throw e;
          }
        }
      }
    }
    return result;
  };

  // The picked house is the only house context on this page: import and export
  // both follow the filter, never a silently inherited global selection.
  const effectiveHouseId = filters.house_id;

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true);
    setImportProgress({ percent: 0, message: "Uploading file..." });
    try {
      const form = new FormData();
      form.append("file", file);
      const token = Cookies.get("token");
      const baseURL = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000/api";
      const headers: Record<string, string> = {};
      if (token) headers["Authorization"] = `Bearer ${token}`;
      if (effectiveHouseId) headers["X-House-ID"] = effectiveHouseId;
      const response = await fetch(`${baseURL}/activations/import`, {
        method: "POST", body: form, headers,
      });
      if (!response.ok) {
        const errText = await response.text();
        let errMsg = "Import failed";
        try { const errJson = JSON.parse(errText); errMsg = errJson.detail || errMsg; } catch {}
        throw new Error(errMsg);
      }
      const result = await readSSEStream(response);
      if (result) {
        toast.success(result.message);
        fetchData();
      }
    } catch (err: any) {
      const msg = err?.message || "Import failed";
      toast.error(typeof msg === "string" ? msg : JSON.stringify(msg));
    } finally {
      setImporting(false);
      setImportProgress(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const [showTruncateConfirm, setShowTruncateConfirm] = useState(false);
  const [truncating, setTruncating] = useState(false);
  const [truncateHouseId, setTruncateHouseId] = useState("");

  const handleTruncate = async () => {
    setTruncating(true);
    try {
      const params: Record<string, string> = {};
      if (truncateHouseId) params.house_id = truncateHouseId;
      await axios.delete("/activations/truncate", { params });
      const msg = truncateHouseId
        ? `Activations deleted for ${houses.find(h => String(h.id) === truncateHouseId)?.name || "selected house"}`
        : "All activations deleted";
      toast.success(msg);
      setData([]);
      setPagination(null);
      setShowTruncateConfirm(false);
      setTruncateHouseId("");
    } catch {
      toast.error("Failed to delete");
    } finally {
      setTruncating(false);
    }
  };

  const [showDatePicker, setShowDatePicker] = useState(false);
  const [exportStartDate, setExportStartDate] = useState("");
  const [exportEndDate, setExportEndDate] = useState("");
  const [exporting, setExporting] = useState(false);
  const todayStr = new Date().toISOString().split("T")[0];

  const handleExport = () => {
    if (!filters.house_id) { toast.error(t("activations.filters.house_required_title")); return; }
    setShowDatePicker(true);
  };

  const runExport = async (startDate: string, endDate: string) => {
    if (!filters.house_id) { toast.error(t("activations.filters.house_required_title")); return; }
    if (!startDate || !endDate) { toast.error("Please select both dates"); return; }
    if (startDate > endDate) { toast.error("Start date cannot be after end date"); return; }
    setExporting(true);
    setShowDatePicker(false);
    try {
      // The export shares the table's house and filters, intersected with the
      // chosen date range, so the file always matches what the screen shows.
      const params: Record<string, string> = {
        house_id: filters.house_id,
        start_date: startDate,
        end_date: endDate,
      };
      if (filters.sim_msisdn) params.sim_msisdn = filters.sim_msisdn;
      if (filters.employee_ids.length) params.employee_ids = filters.employee_ids.join(",");
      if (filters.retailer_codes.length) params.retailer_codes = filters.retailer_codes.join(",");
      if (filters.product_codes.length) params.product_codes = filters.product_codes.join(",");
      const res = await axios.get("/activations/export", {
        params, headers: { "X-House-ID": filters.house_id }, responseType: "blob",
      });
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const a = document.createElement("a"); a.href = url; a.download = `activations_${startDate}_to_${endDate}.xlsx`; a.click();
      window.URL.revokeObjectURL(url);
      toast.success("Exported successfully");
    } catch { toast.error("Export failed"); }
    finally { setExporting(false); closeDatePicker(); }
  };

  const closeDatePicker = () => { setShowDatePicker(false); setExportStartDate(""); setExportEndDate(""); };

  if (!authLoading && !hasPermission("activations.import")) { return <AccessDenied />; }

  return (
    <div className="p-6 space-y-6">
      <style>{`
        @keyframes slideDown { from { transform: translateY(-100%); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
        .animate-slide-down { animation: slideDown 0.35s ease-out; }
      `}</style>

      {showDatePicker && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-xl border border-gray-100 dark:border-slate-800 p-6 w-full max-w-sm mx-4 animate-in zoom-in-95 duration-200">
            <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100 mb-1">Export Activations</h3>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-5">Select date range to export</p>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Start Date</label>
                <input type="date" value={exportStartDate} max={exportEndDate || todayStr}
                  onChange={e => setExportStartDate(e.target.value)}
                  className="w-full px-3 py-2 bg-gray-50 dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-xl text-sm focus:ring-2 focus:ring-primary-500 outline-none dark:text-gray-100" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">End Date</label>
                <input type="date" value={exportEndDate} min={exportStartDate || undefined} max={todayStr}
                  onChange={e => setExportEndDate(e.target.value)}
                  className="w-full px-3 py-2 bg-gray-50 dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-xl text-sm focus:ring-2 focus:ring-primary-500 outline-none dark:text-gray-100" />
              </div>
            </div>
            <div className="flex items-center gap-3 mt-6">
              <button onClick={closeDatePicker}
                className="flex-1 px-4 py-2.5 border border-gray-200 dark:border-slate-700 rounded-xl text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-slate-800 transition-colors">
                Cancel
              </button>
              <button onClick={() => runExport(exportStartDate, exportEndDate)} disabled={exporting}
                className="flex-1 px-4 py-2.5 bg-primary-600 text-white rounded-xl text-sm font-medium hover:bg-primary-700 transition-colors disabled:opacity-50">
                {exporting ? <Loader2 className="w-4 h-4 animate-spin mx-auto" /> : "Export"}
              </button>
            </div>
          </div>
        </div>
      )}

      {showSummary && summaryData && (
        <div className="fixed top-0 left-0 right-0 z-[9999] pointer-events-none">
          <div className="mx-auto max-w-md mt-4 pointer-events-auto animate-slide-down">
            <div className={cn("rounded-2xl shadow-[0_8px_32px_rgba(0,0,0,0.12)] border p-5",
              summaryType === "success"
                ? "bg-white dark:bg-slate-800 border-gray-100 dark:border-slate-700"
                : "bg-red-50 dark:bg-red-900/20 border-red-100 dark:border-red-800"
            )}>
              <div className="flex items-start gap-4">
                <div className={cn("flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center",
                  summaryType === "success"
                    ? "bg-emerald-100 dark:bg-emerald-500/20"
                    : "bg-red-100 dark:bg-red-500/20"
                )}>
                  {summaryType === "success"
                    ? <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                    : <X className="w-5 h-5 text-red-600" />
                  }
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="font-semibold text-gray-900 dark:text-gray-100">
                    {summaryType === "success" ? "Import Complete" : "Import Failed"}
                  </h3>
                  <p className="text-sm text-gray-600 dark:text-gray-400 mt-1 break-words">{summaryData.message}</p>
                  {summaryType === "success" && (
                    <div className="mt-2 inline-flex items-center gap-1.5 px-2.5 py-1 bg-emerald-50 dark:bg-emerald-500/10 rounded-lg">
                      <span className="text-sm font-semibold text-emerald-600">{summaryData.count}</span>
                      <span className="text-xs text-emerald-500">records</span>
                    </div>
                  )}
                </div>
                <button onClick={() => setShowSummary(false)} className="flex-shrink-0 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors">
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between flex-wrap gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-primary-100 dark:bg-primary-500/20 rounded-xl">
            <Database className="w-5 h-5 text-primary-600" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">{t('nav.import_activations')}</h1>
            <p className="text-sm text-gray-500 dark:text-gray-400">Import and view activation records</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <input type="file" ref={fileInputRef} onChange={handleFileChange} className="hidden" accept=".xlsx,.xls" />
          <button onClick={() => fileInputRef.current?.click()} disabled={importing}
            className="group flex items-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-xl text-sm font-medium hover:bg-primary-700 disabled:opacity-50 transition-colors shadow-lg shadow-primary-200 dark:shadow-primary-900/30">
            {importing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4 group-hover:scale-110 transition-transform" />}
            {importing ? "Importing..." : "Import Excel"}
          </button>
          <button onClick={handleExport} disabled={exporting}
            className="group flex items-center gap-2 px-4 py-2 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-slate-800 transition-colors disabled:opacity-50">
            {exporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4 group-hover:text-primary-600 transition-colors" />}
            {exporting ? "Exporting..." : "Export"}
          </button>
          {filters.house_id && pagination && pagination.total > 0 && (
            <button onClick={() => setShowTruncateConfirm(true)}
              className="group flex items-center gap-2 px-4 py-2 bg-white dark:bg-slate-900 border border-red-200 dark:border-red-800/50 rounded-xl text-sm font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors">
              <Trash2 className="w-4 h-4" /> Delete All
            </button>
          )}
        </div>
      </div>

      {importProgress && (
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-gray-100 dark:border-slate-800 shadow-sm p-5">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin text-primary-600" />
              <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Import Progress</span>
            </div>
            <span className="text-sm font-semibold text-primary-600">{importProgress.percent}%</span>
          </div>
          <div className="w-full bg-gray-100 dark:bg-slate-700 rounded-full h-2.5">
            <div className="bg-primary-600 h-2.5 rounded-full transition-all duration-500 ease-out" style={{ width: `${importProgress.percent}%` }} />
          </div>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">{importProgress.message}</p>
        </div>
      )}

      {/* Filter + Table Section */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-gray-100 dark:border-slate-800 shadow-sm">
        <ActivationFilterBar
          apiBase="/activations"
          filters={filters}
          onChange={handleFilterChange}
        />
        {/* Toolbar */}
        <div className="p-4 border-b border-gray-100 dark:border-slate-800 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 flex-1">
            <span className="text-xs text-gray-500 dark:text-gray-400">
              {loading
                ? "Loading..."
                : pagination
                  ? `${pagination.total} ${pagination.total === 1 ? "record" : "records"}`
                  : "No records"}
            </span>
          </div>
        </div>

        {loading ? (
          <div>
            <div className="hidden lg:block">
              <div className="divide-y divide-gray-50 dark:divide-slate-800">
                {Array.from({ length: 10 }).map((_, i) => (
                  <div key={i} className="flex items-center gap-4 px-4 py-3 animate-pulse">
                    <div className="w-[130px] shrink-0 space-y-1">
                      <div className="h-3 w-20 bg-gray-200 dark:bg-slate-700 rounded-md" />
                      <div className="h-2.5 w-12 bg-gray-100 dark:bg-slate-800 rounded-md" />
                    </div>
                    <div className="w-[130px] shrink-0 space-y-1">
                      <div className="h-3 w-20 bg-gray-200 dark:bg-slate-700 rounded-md" />
                      <div className="h-2.5 w-16 bg-gray-100 dark:bg-slate-800 rounded-md" />
                    </div>
                    <div className="w-[110px] shrink-0">
                      <div className="h-3 w-20 bg-gray-200 dark:bg-slate-700 rounded-md" />
                    </div>
                    <div className="w-[120px] shrink-0 space-y-1">
                      <div className="h-3 w-24 bg-gray-200 dark:bg-slate-700 rounded-md" />
                      <div className="h-2.5 w-16 bg-gray-100 dark:bg-slate-800 rounded-md" />
                    </div>
                    <div className="flex-1 space-y-1">
                      <div className="h-3 w-28 bg-gray-200 dark:bg-slate-700 rounded-md" />
                      <div className="h-2.5 w-20 bg-gray-100 dark:bg-slate-800 rounded-md" />
                    </div>
                    <div className="w-[120px] shrink-0 space-y-1">
                      <div className="h-3 w-16 bg-gray-200 dark:bg-slate-700 rounded-md" />
                      <div className="h-2.5 w-12 bg-gray-100 dark:bg-slate-800 rounded-md" />
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div className="lg:hidden space-y-3 p-4">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="bg-gray-50 dark:bg-slate-800 rounded-xl animate-pulse overflow-hidden">
                  <div className="flex items-center justify-between px-4 py-3">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-xl bg-gray-200 dark:bg-slate-700 shrink-0" />
                      <div className="space-y-2">
                        <div className="h-3 w-36 bg-gray-200 dark:bg-slate-700 rounded-md" />
                        <div className="h-2.5 w-24 bg-gray-100 dark:bg-slate-800 rounded-md" />
                      </div>
                    </div>
                    <div className="w-4 h-4 bg-gray-200 dark:bg-slate-700 rounded-md" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : !filters.house_id ? (
          <div className="py-20 px-6 text-center">
            <Database className="w-12 h-12 text-gray-200 dark:text-gray-700 mx-auto mb-4" />
            <p className="text-gray-700 dark:text-gray-200 font-semibold">
              {t("activations.filters.house_required_title")}
            </p>
            <p className="text-sm text-gray-500 dark:text-gray-400 max-w-md mx-auto mt-2">
              {t("activations.filters.house_required_desc")}
            </p>
          </div>
        ) : data.length === 0 ? (
          <div className="py-20 text-center">
            <Database className="w-12 h-12 text-gray-200 dark:text-gray-700 mx-auto mb-4" />
            <p className="text-gray-500 dark:text-gray-400 font-medium">No records found for the selected filters</p>
          </div>
        ) : (
          <>
            <div className="hidden lg:block overflow-x-auto scrollbar-custom">
              <table className="w-full text-left whitespace-nowrap">
                <thead>
                  <tr className="bg-gray-50/50 dark:bg-slate-800/50 text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-widest border-b border-gray-50 dark:border-slate-800">
                    <th className="px-2 py-1">House</th>
                    <th className="px-2 py-1">SIM / MSISDN</th>
                    <th className="px-2 py-1">Date / Time</th>
                    <th className="px-2 py-1">RSO</th>
                    <th className="px-2 py-1">Retailer</th>
                    <th className="px-2 py-1">Product / Price</th>
                    <th className="px-2 py-1">BTS / Thana</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50 dark:divide-slate-800">
                  {data.map((r) => (
                    <tr key={r.id} className="hover:bg-gray-50/30 dark:hover:bg-slate-800/30 transition-colors">
                      <td className="px-2 py-1">
                        <div className="text-xs text-gray-700 dark:text-gray-300">{r.house?.name || "-"}</div>
                        <div className="text-[11px] text-gray-400">{r.house?.code || ""}</div>
                      </td>
                      <td className="px-2 py-1">
                        <div className="font-mono text-xs text-gray-900 dark:text-gray-100">{r.sim_no}</div>
                        <div className="font-mono text-[11px] text-gray-400">{r.msisdn || ""}</div>
                      </td>
                      <td className="px-2 py-1 whitespace-nowrap">
                        <div className="text-gray-900 dark:text-gray-100 text-xs">{formatDate(r.activation_date)}</div>
                        <div className="text-[11px] text-gray-400">{r.activation_time || ""}</div>
                      </td>
                      <td className="px-2 py-1">
                        <div className="font-medium text-gray-900 dark:text-gray-100 text-xs">{r.rso_name || "-"}</div>
                        <div className="text-[11px] text-gray-400">{r.rso_dms_code || ""}{r.rso_itop_number ? ` | ${r.rso_itop_number}` : ""}</div>
                      </td>
                      <td className="px-2 py-1">
                        <div className="font-medium text-gray-900 dark:text-gray-100 text-xs">{r.retailer_name || "-"}</div>
                        <div className="text-[11px] text-gray-400">{r.retailer_code || ""}</div>
                      </td>
                      <td className="px-2 py-1">
                        <div className="text-gray-900 dark:text-gray-100 text-xs">{r.product_name || "-"}</div>
                        <div className="text-[11px] text-gray-400">{r.product_code ? `${r.product_code}` : ""}{r.selling_price ? ` / ৳${r.selling_price}` : ""}</div>
                      </td>
                      <td className="px-2 py-1 whitespace-nowrap">
                        <div className="text-gray-900 dark:text-gray-100 text-xs">{r.bts_code || "-"}</div>
                        <div className="text-[11px] text-gray-400">{r.thana || ""}</div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="lg:hidden divide-y divide-gray-50 dark:divide-slate-800">
              {data.map((r) => (
                <div key={r.id}>
                  <button onClick={() => setExpandedId(expandedId === r.id ? null : r.id)}
                    className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-50/30 dark:hover:bg-slate-800/30 transition-colors text-left">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-9 h-9 rounded-xl bg-primary-100 dark:bg-primary-500/20 flex items-center justify-center text-primary-700 dark:text-primary-400 font-bold shadow-sm shrink-0">
                        <span className="text-[10px]">{r.sim_no?.slice(-3) || "?"}</span>
                      </div>
                      <div className="min-w-0">
                        <p className="font-bold text-gray-900 dark:text-gray-100 text-sm truncate">{r.retailer_name || "-"}</p>
                        <p className="text-[11px] text-gray-500 dark:text-gray-400 truncate">{r.sim_no}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-gray-500 dark:text-gray-400">{formatDate(r.activation_date)}</span>
                      <ChevronDown className={cn("w-4 h-4 text-gray-400 shrink-0 transition-transform duration-300", expandedId === r.id && "rotate-180")} />
                    </div>
                  </button>
                  {expandedId === r.id && (
                    <div className="px-4 pb-4 space-y-3 animate-in slide-in-from-top-1 duration-200">
                      <div className="h-px bg-gray-100 dark:bg-slate-800" />
                      <div className="grid grid-cols-2 gap-3">
                        <div className="col-span-2">
                          <p className="text-[10px] font-bold text-gray-400 uppercase mb-0.5">House</p>
                          <p className="text-xs font-medium text-gray-700 dark:text-gray-200">{r.house?.name || "-"}</p>
                          {r.house?.code && <p className="text-[11px] text-gray-500">{r.house.code}</p>}
                        </div>
                        <div>
                          <p className="text-[10px] font-bold text-gray-400 uppercase mb-0.5">SIM</p>
                          <p className="text-xs font-mono font-medium text-gray-700 dark:text-gray-200">{r.sim_no}</p>
                        </div>
                        <div>
                          <p className="text-[10px] font-bold text-gray-400 uppercase mb-0.5">MSISDN</p>
                          <p className="text-xs font-mono font-medium text-gray-700 dark:text-gray-200">{r.msisdn || "-"}</p>
                        </div>
                        <div>
                          <p className="text-[10px] font-bold text-gray-400 uppercase mb-0.5">Date / Time</p>
                          <p className="text-xs font-medium text-gray-700 dark:text-gray-200">{formatDate(r.activation_date)}</p>
                          {r.activation_time && <p className="text-[11px] text-gray-500">{r.activation_time}</p>}
                        </div>
                        <div>
                          <p className="text-[10px] font-bold text-gray-400 uppercase mb-0.5">Retailer</p>
                          <p className="text-xs font-medium text-gray-700 dark:text-gray-200">{r.retailer_name || "-"}</p>
                          <p className="text-[11px] text-gray-500">{r.retailer_code || ""}</p>
                        </div>
                        <div className="col-span-2">
                          <p className="text-[10px] font-bold text-gray-400 uppercase mb-0.5">RSO</p>
                          <p className="text-xs font-medium text-gray-700 dark:text-gray-200">{r.rso_name || "-"}</p>
                          {(r.rso_dms_code || r.rso_itop_number) && (
                            <p className="text-[11px] text-gray-500">{r.rso_dms_code}{r.rso_itop_number ? ` | ${r.rso_itop_number}` : ""}</p>
                          )}
                        </div>
                        <div>
                          <p className="text-[10px] font-bold text-gray-400 uppercase mb-0.5">Product</p>
                          <p className="text-xs font-medium text-gray-700 dark:text-gray-200">{r.product_name || "-"}</p>
                          <p className="text-[11px] text-gray-500">{r.product_code || ""}{r.selling_price ? ` / ৳${r.selling_price}` : ""}</p>
                        </div>
                        <div>
                          <p className="text-[10px] font-bold text-gray-400 uppercase mb-0.5">BTS / Thana</p>
                          <p className="text-xs font-medium text-gray-700 dark:text-gray-200">{r.bts_code || "-"}</p>
                          <p className="text-[11px] text-gray-500">{r.thana || ""}</p>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>

            {pagination && (
              <div className="p-4 border-t border-gray-50 dark:border-slate-800 flex items-center justify-between flex-wrap gap-2">
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  Showing {(pagination.page - 1) * pagination.per_page + 1} to {Math.min(pagination.page * pagination.per_page, pagination.total)} of {pagination.total}
                </p>
                <div className="flex items-center gap-2">
                  <button onClick={() => handlePageChange(page - 1)} disabled={!pagination.has_prev}
                    className="p-2 border border-gray-200 dark:border-slate-700 rounded-lg hover:bg-gray-50 dark:hover:bg-slate-800 disabled:opacity-50 transition-colors">
                    <ChevronLeft className="w-4 h-4 text-gray-600 dark:text-gray-400" />
                  </button>
                  <span className="text-xs font-bold text-gray-500 dark:text-gray-400 px-2 min-w-[40px] text-center">
                    {pagination.page} / {pagination.total_pages}
                  </span>
                  <button onClick={() => handlePageChange(page + 1)} disabled={!pagination.has_next}
                    className="p-2 border border-gray-200 dark:border-slate-700 rounded-lg hover:bg-gray-50 dark:hover:bg-slate-800 disabled:opacity-50 transition-colors">
                    <ChevronRight className="w-4 h-4 text-gray-600 dark:text-gray-400" />
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
      {showTruncateConfirm && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-300">
          <div className="bg-white dark:bg-slate-900 w-full max-w-sm rounded-3xl shadow-2xl border border-gray-100 dark:border-slate-800 overflow-hidden">
            <div className="p-8 flex flex-col items-center text-center">
              <div className="w-20 h-20 rounded-full flex items-center justify-center mb-6 bg-red-100 dark:bg-red-500/20">
                <Trash2 className="w-10 h-10 text-red-600 dark:text-red-400" />
              </div>
              <h3 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-2">Delete Data</h3>
              <p className="text-sm text-gray-500 dark:text-gray-400 leading-relaxed mb-5">
                {truncateHouseId
                  ? `Are you sure you want to delete all activation data for "${houses.find(h => String(h.id) === truncateHouseId)?.name || "selected house"}"?`
                  : "Are you sure you want to delete ALL activation records for all houses?"}
              </p>
              <select
                value={truncateHouseId}
                onChange={e => setTruncateHouseId(e.target.value)}
                className="w-full p-3 bg-gray-50 dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-xl text-sm dark:text-gray-200 outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500 transition-all appearance-none"
              >
                <option value="">All Houses</option>
                {houses.map(h => (
                  <option key={h.id} value={h.id}>{h.display_name || h.name}</option>
                ))}
              </select>
            </div>
            <div className="p-6 pt-0 flex flex-col gap-3">
              <button onClick={handleTruncate} disabled={truncating}
                className="w-full py-4 rounded-2xl text-white font-bold transition-all shadow-lg active:scale-[0.98] disabled:opacity-50 bg-red-600 hover:bg-red-700">
                {truncating ? "Deleting..." : "Delete"}
              </button>
              <button onClick={() => { setShowTruncateConfirm(false); setTruncateHouseId(""); }} disabled={truncating}
                className="w-full py-4 rounded-2xl text-gray-500 dark:text-gray-400 font-bold hover:bg-gray-50 dark:hover:bg-slate-800 transition-all">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
