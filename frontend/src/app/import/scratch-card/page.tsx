"use client";
import { useState, useRef, useEffect, useCallback } from "react";
import { Upload, Download, ChevronLeft, ChevronRight, Loader2, Database, X, CheckCircle2 } from "lucide-react";
import { toast } from "react-hot-toast";
import Cookies from "js-cookie";
import axios from "@/lib/api";

interface Record {
  id: number; cluster_name: string; region: string; issue_date: string; distributor_code: string;
  distributor_name: string; retailer_code: string; retailer_name: string; product_name: string;
  product_code: string; start_sc_no: string; end_sc_no: string; rso_code: string; quantity: number; value: number;
}

export default function ImportScratchCardPage() {
  const [data, setData] = useState<Record[]>([]);
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [page, setPage] = useState(0);
  const [totalRecords, setTotalRecords] = useState(0);
  const [importProgress, setImportProgress] = useState<{percent: number; message: string} | null>(null);
  const [showSummary, setShowSummary] = useState(false);
  const [summaryData, setSummaryData] = useState<{message: string; count: number} | null>(null);
  const [summaryType, setSummaryType] = useState<"success" | "error">("success");
  const limit = 5;
  const totalPages = Math.ceil(totalRecords / limit);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await axios.get("/scratch-card", { params: { skip: page * limit, limit } });
      setData(res.data.data || []);
      setTotalRecords(res.data.total || 0);
    } catch { toast.error("Failed to load"); }
    finally { setLoading(false); }
  }, [page]);

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
      const response = await fetch(`${baseURL}/scratch-card/import`, {
        method: "POST",
        body: form,
        headers: token ? { "Authorization": `Bearer ${token}` } : {},
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

  const handleExport = async () => {
    try {
      const res = await axios.get("/scratch-card/export", { responseType: "blob" });
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const a = document.createElement("a"); a.href = url; a.download = "scratch_card.xlsx"; a.click();
      window.URL.revokeObjectURL(url);
      toast.success("Exported");
    } catch { toast.error("Export failed"); }
  };

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
            <div className={`rounded-2xl shadow-[0_8px_32px_rgba(0,0,0,0.12)] border p-5 ${
              summaryType === "success"
                ? "bg-white dark:bg-slate-800 border-gray-100 dark:border-slate-700"
                : "bg-red-50 dark:bg-red-900/20 border-red-100 dark:border-red-800"
            }`}>
              <div className="flex items-start gap-4">
                <div className={`flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center ${
                  summaryType === "success"
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
            <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">Scratch Card Issues</h1>
            <p className="text-sm text-gray-500">Import and view scratch card records</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <input type="file" ref={fileInputRef} onChange={handleFileChange} className="hidden" accept=".xlsx,.xls" />
          <button onClick={() => fileInputRef.current?.click()} disabled={importing}
            className="flex items-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-xl text-sm font-medium hover:bg-primary-700 disabled:opacity-50 transition-colors shadow-lg shadow-primary-200">
            {importing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
            {importing ? "Importing..." : "Import Excel"}
          </button>
          <button onClick={handleExport}
            className="flex items-center gap-2 px-4 py-2 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-xl text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-slate-800 transition-colors">
            <Download className="w-4 h-4" /> Export
          </button>
        </div>
      </div>
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-gray-100 dark:border-slate-800 shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 dark:border-slate-800">
                <th className="text-left px-4 py-3 font-semibold text-gray-600 dark:text-gray-400 text-xs uppercase">Distributor</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-600 dark:text-gray-400 text-xs uppercase">Retailer</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-600 dark:text-gray-400 text-xs uppercase">Product</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-600 dark:text-gray-400 text-xs uppercase">SC Range</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-600 dark:text-gray-400 text-xs uppercase">Qty</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-600 dark:text-gray-400 text-xs uppercase">Value</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-600 dark:text-gray-400 text-xs uppercase">Date</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={7} className="text-center py-12 text-gray-400"><Loader2 className="w-5 h-5 animate-spin mx-auto" /></td></tr>
              ) : data.length === 0 ? (
                <tr><td colSpan={7} className="text-center py-12 text-gray-400">No records</td></tr>
              ) : data.map((r) => (
                <tr key={r.id} className="border-b border-gray-50 dark:border-slate-800/50 hover:bg-gray-50 dark:hover:bg-slate-800/50 transition-colors">
                  <td className="px-4 py-3"><div className="font-medium text-gray-900 dark:text-gray-100">{r.distributor_name || "-"}</div><div className="text-xs text-gray-400">{r.distributor_code || ""}</div></td>
                  <td className="px-4 py-3"><div className="text-gray-900 dark:text-gray-100">{r.retailer_name || "-"}</div><div className="text-xs text-gray-400">{r.retailer_code || ""}</div></td>
                  <td className="px-4 py-3 text-gray-600 dark:text-gray-400">{r.product_name || "-"}</td>
                  <td className="px-4 py-3 font-mono text-xs text-gray-600 dark:text-gray-400">{r.start_sc_no || "-"} - {r.end_sc_no || ""}</td>
                  <td className="px-4 py-3 text-gray-900 dark:text-gray-100 font-medium">{r.quantity}</td>
                  <td className="px-4 py-3 text-gray-900 dark:text-gray-100 font-medium">{r.value}</td>
                  <td className="px-4 py-3 text-gray-600 dark:text-gray-400">{r.issue_date || "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {totalRecords > 0 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100 dark:border-slate-800">
            <span className="text-xs text-gray-400">
              Showing {page * limit + 1} to {Math.min((page + 1) * limit, totalRecords)} of {totalRecords} results
            </span>
            <div className="flex items-center gap-3">
              <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}
                className="flex items-center gap-1 px-3 py-1.5 text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-slate-800 rounded-lg disabled:opacity-50 transition-colors">
                <ChevronLeft className="w-3.5 h-3.5" /> Prev
              </button>
              <div className="flex items-center gap-1">
                {Array.from({ length: Math.min(totalPages, 5) }, (_, i) => {
                  const startPage = Math.max(0, Math.min(page - 2, totalPages - 5));
                  const p = startPage + i;
                  if (p >= totalPages) return null;
                  return (
                    <button key={p} onClick={() => setPage(p)}
                      className={`w-8 h-8 text-sm rounded-lg font-medium transition-colors ${
                        p === page
                          ? "bg-primary-100 dark:bg-primary-500/20 text-primary-700 dark:text-primary-300"
                          : "text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-slate-800"
                      }`}>
                      {p + 1}
                    </button>
                  );
                })}
              </div>
              <button onClick={() => setPage(p => p + 1)} disabled={(page + 1) * limit >= totalRecords}
                className="flex items-center gap-1 px-3 py-1.5 text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-slate-800 rounded-lg disabled:opacity-50 transition-colors">
                Next <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
