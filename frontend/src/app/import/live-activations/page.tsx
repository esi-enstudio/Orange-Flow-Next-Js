"use client";
import { useState, useRef, useEffect, useCallback } from "react";
import { useLanguage } from "@/i18n/useLanguage";
import { Upload, Download, ChevronLeft, ChevronRight, ChevronDown, Loader2, Database, X, CheckCircle2, Trash2 } from "lucide-react";
import { toast } from "react-hot-toast";
import axios from "@/lib/api";
import Cookies from "js-cookie";
import { ConfirmationModal } from "@/components/ui/ConfirmationModal";
import ActivationFilterBar, {
  ActivationFilters,
  defaultActivationFilters,
} from "@/components/activation-filters/ActivationFilterBar";
import { cn } from "@/lib/utils";
import { useAuth } from "@/context/AuthContext";
import { AccessDenied } from "@/components/ui/AccessDenied";

interface ActivationRecord {
  id: number; sim_no: string; activation_date: string; activation_time: string;
  retailer_code: string; retailer_name: string; bts_code: string; thana: string;
  promotion: string; product_code: string; product_name: string; msisdn: string;
  selling_price: string; house?: { id: number; name: string; code: string };
  rso_name: string | null; rso_employee_id: number | null;
  rso_dms_code: string | null; rso_itop_number: string | null;
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

export default function ImportLiveActivationsPage() {
  const { t } = useLanguage();
  const { hasPermission, loading: authLoading } = useAuth();
  const [data, setData] = useState<ActivationRecord[]>([]);
  const [filters, setFilters] = useState<ActivationFilters>({ ...defaultActivationFilters });
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [page, setPage] = useState(0);
  const [totalRecords, setTotalRecords] = useState(0);
  const [importProgress, setImportProgress] = useState<{ percent: number; message: string } | null>(null);
  const [showTruncateConfirm, setShowTruncateConfirm] = useState(false);
  const [truncating, setTruncating] = useState(false);
  const [showSummary, setShowSummary] = useState(false);
  const [summaryData, setSummaryData] = useState<{ message: string; count: number } | null>(null);
  const [summaryType, setSummaryType] = useState<"success" | "error">("success");
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const limit = 10;
  const fileInputRef = useRef<HTMLInputElement>(null);

  const fetchData = useCallback(async () => {
    // The table is always scoped to one house: with no house picked nothing is
    // requested at all, so a user can never land on every house's records.
    if (!filters.house_id) {
      setData([]);
      setTotalRecords(0);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      // House / employee / retailer / product code are the only filters the page
      // offers. The X-House-ID header mirrors the picked house so the table and
      // the export always cover the same house, and the backend still rejects
      // any house the user cannot read.
      const headers: Record<string, string> = { "X-House-ID": filters.house_id };
      const params: Record<string, string | number> = { skip: page * limit, limit, house_id: filters.house_id };
      if (filters.sim_msisdn) params.sim_msisdn = filters.sim_msisdn;
      if (filters.employee_ids.length) params.employee_ids = filters.employee_ids.join(",");
      if (filters.retailer_codes.length) params.retailer_codes = filters.retailer_codes.join(",");
      if (filters.product_codes.length) params.product_codes = filters.product_codes.join(",");
      const res = await axios.get("/live-activations", { params, headers });
      setData(res.data.data || []);
      setTotalRecords(res.data.total || 0);
    } catch { toast.error("Failed to load"); }
    finally { setLoading(false); }
  }, [page, filters]);

  // Any filter change re-runs the query from the first page.
  const handleFilterChange = useCallback((next: ActivationFilters) => {
    setFilters(next);
    setPage(0);
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

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
            const data = JSON.parse(line.slice(6));
            if (data.type === "progress") {
              const msg = data.message || "";
              const pctMatch = msg.match(/(\d+)%/);
              const pct = pctMatch ? parseInt(pctMatch[1]) : 0;
              setImportProgress({ percent: pct, message: msg });
            } else if (data.type === "complete") {
              result = data;
              setSummaryData({ message: data.message, count: data.count });
              setSummaryType("success");
              setShowSummary(true);
              setTimeout(() => setShowSummary(false), 6000);
            } else if (data.type === "error") {
              setSummaryData({ message: data.message, count: 0 });
              setSummaryType("error");
              setShowSummary(true);
              setTimeout(() => setShowSummary(false), 6000);
              throw new Error(data.message);
            }
          } catch (e: any) {
            if (e.message !== "Unexpected end of JSON input") throw e;
          }
        }
      }
    }
    return result;
  };

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
      const response = await fetch(`${baseURL}/live-activations/import`, {
        method: "POST",
        body: form,
        headers: token ? { "Authorization": `Bearer ${token}` } : {},
      });
      if (!response.ok) {
        const errText = await response.text();
        let errMsg = "Import failed";
        try { const errJson = JSON.parse(errText); errMsg = errJson.detail || errMsg; } catch { }
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

  const handleTruncate = async () => {
    setTruncating(true);
    try {
      await axios.delete("/live-activations/truncate");
      toast.success("All live activations deleted");
      setData([]);
      setTotalRecords(0);
      setShowTruncateConfirm(false);
    } catch {
      toast.error("Failed to delete");
    } finally {
      setTruncating(false);
    }
  };

  const handleExport = async () => {
    if (!filters.house_id) {
      toast.error(t("activations.filters.house_required_title"));
      return;
    }
    try {
      // The export shares the table's house, so the file always covers exactly
      // what the screen shows.
      const res = await axios.get("/live-activations/export", {
        responseType: "blob",
        headers: { "X-House-ID": filters.house_id },
        params: {
          house_id: filters.house_id,
          sim_msisdn: filters.sim_msisdn || undefined,
          employee_ids: filters.employee_ids.join(",") || undefined,
          retailer_codes: filters.retailer_codes.join(",") || undefined,
          product_codes: filters.product_codes.join(",") || undefined,
        },
      });
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const a = document.createElement("a"); a.href = url; a.download = "live_activations.xlsx"; a.click();
      window.URL.revokeObjectURL(url);
      toast.success("Exported");
    } catch { toast.error("Export failed"); }
  };

  const totalPages = Math.ceil(totalRecords / limit);

  if (!authLoading && !hasPermission("live_activations.import")) { return <AccessDenied />; }

  return (
    <div className="p-6 space-y-6">
      <style>{`
        @keyframes slideDown { from { transform: translateY(-100%); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
        @keyframes slideUp { from { transform: translateY(0); opacity: 1; } to { transform: translateY(-100%); opacity: 0; } }
        .animate-slide-down { animation: slideDown 0.35s ease-out; }
        .animate-slide-up { animation: slideUp 0.35s ease-out forwards; }
      `}</style>

      {showSummary && summaryData && (
        <div className="fixed top-0 left-0 right-0 z-[9999] pointer-events-none">
          <div className={`mx-auto max-w-md mt-4 pointer-events-auto ${showSummary ? 'animate-slide-down' : ''}`}>
            <div className={`rounded-2xl shadow-[0_8px_32px_rgba(0,0,0,0.12)] border p-5 ${summaryType === "success"
                ? "bg-white dark:bg-slate-800 border-gray-100 dark:border-slate-700"
                : "bg-red-50 dark:bg-red-900/20 border-red-100 dark:border-red-800"
              }`}>
              <div className="flex items-start gap-4">
                <div className={`flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center ${summaryType === "success"
                    ? "bg-emerald-100 dark:bg-emerald-500/20"
                    : "bg-red-100 dark:bg-red-500/20"
                  }`}>
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

      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-primary-100 dark:bg-primary-500/20 rounded-xl">
            <Database className="w-5 h-5 text-primary-600" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">{t('nav.import_live_activations')}</h1>
            <p className="text-sm text-gray-500">Import and view live activation records</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
          <input type="file" ref={fileInputRef} onChange={handleFileChange} className="hidden" accept=".xlsx,.xls" />
          <button onClick={() => fileInputRef.current?.click()} disabled={importing}
            className="flex items-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-xl text-sm font-medium hover:bg-primary-700 disabled:opacity-50 transition-colors shadow-md cursor-pointer disabled:cursor-not-allowed">
            {importing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
            {importing ? "Importing..." : "Import Excel"}
          </button>
          <button onClick={handleExport}
            className="flex items-center gap-2 px-4 py-2 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-xl text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-slate-800 transition-colors cursor-pointer">
            <Download className="w-4 h-4" /> Export
          </button>
          {/* The truncate endpoint is guarded by the same
              `live_activations.import` permission as this page. */}
          <button onClick={() => setShowTruncateConfirm(true)}
            className="flex items-center gap-2 px-4 py-2 bg-white dark:bg-slate-900 border border-red-200 dark:border-red-800/50 rounded-xl text-sm font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors cursor-pointer">
            <Trash2 className="w-4 h-4" /> Delete All
          </button>
        </div>
      </div>
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-gray-100 dark:border-slate-800 shadow-sm">
        <ActivationFilterBar apiBase="/live-activations" filters={filters} onChange={handleFilterChange} />
        {loading ? (
          <div className="divide-y divide-gray-50 dark:divide-slate-800">
            {Array.from({ length: 10 }).map((_, i) => (
              <div key={i} className="px-4 py-4 animate-pulse">
                <div className="flex items-center gap-4">
                  <div className="w-24 h-3 bg-gray-200 dark:bg-slate-700 rounded-md shrink-0" />
                  <div className="w-32 h-3 bg-gray-100 dark:bg-slate-800 rounded-md shrink-0" />
                  <div className="flex-1 h-3 bg-gray-100 dark:bg-slate-800 rounded-md" />
                  <div className="hidden md:block w-24 h-3 bg-gray-100 dark:bg-slate-800 rounded-md" />
                  <div className="hidden md:block w-20 h-3 bg-gray-100 dark:bg-slate-800 rounded-md" />
                </div>
              </div>
            ))}
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
            <p className="text-gray-500 dark:text-gray-400 font-medium">{t("activations.no_data")}</p>
          </div>
        ) : (
          <>
            <div
              className="hidden lg:block overflow-x-auto"
              tabIndex={0}
              role="region"
              aria-label={t("activations.filters.table_region")}
            >
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
                    className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-50/30 dark:hover:bg-slate-800/30 transition-colors text-left cursor-pointer">
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
          </>
        )}
        {totalRecords > 0 && (
          <div className="p-4 border-t border-gray-50 dark:border-slate-800 flex items-center justify-between">
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Showing {totalRecords === 0 ? 0 : page * limit + 1} to{" "}
              {Math.min((page + 1) * limit, totalRecords)} of {totalRecords}
            </p>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={page === 0}
                className="p-2 border rounded-lg hover:bg-gray-50 dark:hover:bg-slate-800 disabled:opacity-50"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button
                onClick={() => setPage((p) => p + 1)}
                disabled={page >= totalPages - 1}
                className="p-2 border rounded-lg hover:bg-gray-50 dark:hover:bg-slate-800 disabled:opacity-50"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </div>

      <ConfirmationModal
        isOpen={showTruncateConfirm}
        onClose={() => setShowTruncateConfirm(false)}
        onConfirm={handleTruncate}
        title="Delete All Data"
        message="Are you sure you want to delete ALL live activation records? This action cannot be undone."
        confirmText={truncating ? "Deleting..." : "Delete All"}
        type="danger"
        loading={truncating}
      />
    </div>
  );
}
