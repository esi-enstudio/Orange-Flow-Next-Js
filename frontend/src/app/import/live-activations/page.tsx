"use client";
import { useState, useRef, useEffect, useCallback } from "react";
import { useLanguage } from "@/i18n/useLanguage";
import { Search, Upload, Download, ChevronLeft, ChevronRight, Loader2, Database, X, CheckCircle2, Trash2, SlidersHorizontal } from "lucide-react";
import { toast } from "react-hot-toast";
import axios from "@/lib/api";
import Cookies from "js-cookie";
import { ConfirmationModal } from "@/components/ui/ConfirmationModal";
import LiveActivationsFilter, { LiveActivationFilters, defaultLiveActivationFilters } from "@/components/live-activations/LiveActivationsFilter";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";
import { useAuth } from "@/context/AuthContext";
import { AccessDenied } from "@/components/ui/AccessDenied";

interface ActivationRecord {
  id: number; sim_no: string; activation_date: string; activation_time: string;
  retailer_code: string; retailer_name: string; bts_code: string; thana: string;
  promotion: string; product_code: string; product_name: string; msisdn: string;
  selling_price: string; house?: { id: number; name: string; code: string };
}

export default function ImportLiveActivationsPage() {
  const { t } = useLanguage();
  const { hasPermission, loading: authLoading } = useAuth();
  const [data, setData] = useState<ActivationRecord[]>([]);
  const [filters, setFilters] = useState<LiveActivationFilters>({ ...defaultLiveActivationFilters });
  const [showFilters, setShowFilters] = useState(false);
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
  const limit = 5;
  const fileInputRef = useRef<HTMLInputElement>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, any> = { skip: page * limit, limit };
      const f = filters;
      if (f.search) params.search = f.search;
      if (f.activation_date_from) params.activation_date_from = f.activation_date_from;
      if (f.activation_date_to) params.activation_date_to = f.activation_date_to;
      if (f.activation_time) params.activation_time = f.activation_time;
      if (f.retailer_code) params.retailer_code = f.retailer_code;
      if (f.retailer_name) params.retailer_name = f.retailer_name;
      if (f.bts_code) params.bts_code = f.bts_code;
      if (f.thana) params.thana = f.thana;
      if (f.promotion) params.promotion = f.promotion;
      if (f.product_code) params.product_code = f.product_code;
      if (f.product_name) params.product_name = f.product_name;
      if (f.sim_no) params.sim_no = f.sim_no;
      if (f.msisdn) params.msisdn = f.msisdn;
      if (f.selling_price_min) params.selling_price_min = f.selling_price_min;
      if (f.selling_price_max) params.selling_price_max = f.selling_price_max;
      if (f.bp_flag) params.bp_flag = f.bp_flag;
      if (f.bp_number) params.bp_number = f.bp_number;
      if (f.fc_bts_code) params.fc_bts_code = f.fc_bts_code;
      if (f.bio_bts_code) params.bio_bts_code = f.bio_bts_code;
      if (f.dh_lifting_date) params.dh_lifting_date = f.dh_lifting_date;
      if (f.issue_date) params.issue_date = f.issue_date;
      if (f.subscription_type) params.subscription_type = f.subscription_type;
      if (f.service_class) params.service_class = f.service_class;
      if (f.customer_second_contact) params.customer_second_contact = f.customer_second_contact;
      const res = await axios.get("/live-activations", { params });
      setData(res.data.data || []);
      setTotalRecords(res.data.total || 0);
    } catch { toast.error("Failed to load"); }
    finally { setLoading(false); }
  }, [filters, page]);

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
    try {
      const res = await axios.get("/live-activations/export", { responseType: "blob" });
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

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-primary-100 dark:bg-primary-500/20 rounded-xl">
            <Database className="w-5 h-5 text-primary-600" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">{t('nav.import_live_activations')}</h1>
            <p className="text-sm text-gray-500">Import and view live activation records</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <input type="file" ref={fileInputRef} onChange={handleFileChange} className="hidden" accept=".xlsx,.xls" />
          <button onClick={() => fileInputRef.current?.click()} disabled={importing}
            className="flex items-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-xl text-sm font-medium hover:bg-primary-700 disabled:opacity-50 transition-colors shadow-md">
            {importing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
            {importing ? "Importing..." : "Import Excel"}
          </button>
          <button onClick={handleExport}
            className="flex items-center gap-2 px-4 py-2 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-xl text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-slate-800 transition-colors">
            <Download className="w-4 h-4" /> Export
          </button>
          {totalRecords > 0 && (
            <button onClick={() => setShowTruncateConfirm(true)}
              className="flex items-center gap-2 px-4 py-2 bg-white dark:bg-slate-900 border border-red-200 dark:border-red-800/50 rounded-xl text-sm font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors">
              <Trash2 className="w-4 h-4" /> Clear All
            </button>
          )}
        </div>
      </div>
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-gray-100 dark:border-slate-800 shadow-sm">
        <div className="p-4 border-b border-gray-100 dark:border-slate-800 flex items-center gap-3">
          <button
            onClick={() => setShowFilters(!showFilters)}
            className={cn(
              "p-2 rounded-xl border transition-all active:scale-95 shrink-0",
              showFilters
                ? "bg-primary-500 text-white border-primary-500 shadow-sm"
                : "bg-white dark:bg-slate-800 border-gray-200 dark:border-slate-700 text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-slate-700"
            )}
            title="Toggle filters"
          >
            <SlidersHorizontal className="w-4 h-4" />
          </button>
          <div className="relative flex-1 group">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 group-focus-within:text-primary-500 transition-colors" />
            <input type="text" placeholder="Search by SIM, retailer, MSISDN..." value={filters.search}
              onChange={e => { setFilters(f => ({ ...f, search: e.target.value })); setPage(0); }}
              className="w-full pl-10 pr-4 py-2 bg-gray-50 dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-xl text-sm focus:ring-2 focus:ring-primary-500 outline-none transition-all" />
          </div>
        </div>

        <AnimatePresence>
          {showFilters && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.3, ease: "easeInOut" }}
              className="overflow-hidden border-b dark:border-slate-800"
            >
              <div className="p-4">
                <LiveActivationsFilter
                  filters={filters}
                  onChange={(f) => { setFilters(f); setPage(0); }}
                  onClear={() => { setFilters({ ...defaultLiveActivationFilters }); setPage(0); }}
                />
              </div>
            </motion.div>
          )}
        </AnimatePresence>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 dark:border-slate-800">
                <th className="text-left px-4 py-3 font-semibold text-gray-600 dark:text-gray-400 text-xs uppercase">SIM</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-600 dark:text-gray-400 text-xs uppercase">Date</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-600 dark:text-gray-400 text-xs uppercase">Retailer</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-600 dark:text-gray-400 text-xs uppercase">Product</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-600 dark:text-gray-400 text-xs uppercase">MSISDN</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-600 dark:text-gray-400 text-xs uppercase">BTS</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-600 dark:text-gray-400 text-xs uppercase">Thana</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={7} className="text-center py-12 text-gray-400"><Loader2 className="w-5 h-5 animate-spin mx-auto" /></td></tr>
              ) : data.length === 0 ? (
                <tr><td colSpan={7} className="text-center py-12 text-gray-400">No records</td></tr>
              ) : data.map((r) => (
                <tr key={r.id} className="border-b border-gray-50 dark:border-slate-800/50 hover:bg-gray-50 dark:hover:bg-slate-800/50 transition-colors">
                  <td className="px-4 py-3 font-mono text-xs text-gray-900 dark:text-gray-100">{r.sim_no}</td>
                  <td className="px-4 py-3 text-gray-600 dark:text-gray-400">{r.activation_date || "-"}</td>
                  <td className="px-4 py-3"><div className="font-medium text-gray-900 dark:text-gray-100">{r.retailer_name || "-"}</div><div className="text-xs text-gray-400">{r.retailer_code || ""}</div></td>
                  <td className="px-4 py-3 text-gray-600 dark:text-gray-400">{r.product_name || "-"}</td>
                  <td className="px-4 py-3 font-mono text-xs text-gray-600 dark:text-gray-400">{r.msisdn || "-"}</td>
                  <td className="px-4 py-3 text-gray-600 dark:text-gray-400">{r.bts_code || "-"}</td>
                  <td className="px-4 py-3 text-gray-600 dark:text-gray-400">{r.thana || "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
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
