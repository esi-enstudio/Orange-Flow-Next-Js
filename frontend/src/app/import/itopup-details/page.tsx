"use client";
import { useState, useRef, useEffect, useCallback } from "react";
import { useLanguage } from "@/i18n/useLanguage";
import { useAuth } from "@/context/AuthContext";
import {
  Search, Upload, Download, ChevronLeft, ChevronRight, ChevronDown,
  Loader2, Database, X, CheckCircle2, Calendar, Filter, RotateCcw,
  SlidersHorizontal, Store, Building2, User, CloudDownload,
} from "lucide-react";
import { toast } from "react-hot-toast";
import axios from "@/lib/api";
import Cookies from "js-cookie";
import { AccessDenied } from "@/components/ui/AccessDenied";
import { cn } from "@/lib/utils";

interface ItopUpRecord {
  id: number; report_type: string; report_date: string; daily_value: number;
  house?: { id: number; name: string; code: string };
  retailer?: {
    id: number; retailer_code: string; name: string; itop_number: string;
    employee?: {
      id: number; dms_code: string; itop_number: string; employee_type: string;
      user?: { id: number; name: string };
    };
  };
}

interface Pagination {
  page: number; per_page: number; total: number;
  total_pages: number; has_next: boolean; has_prev: boolean;
}

interface Filters {
  search: string; report_type: string;
  start_date: string; end_date: string; retailer_search: string;
  house_id: string; rso_id: string;
}

interface HouseOption {
  id: number; name: string; code: string; display_name: string;
}

interface RsoOption {
  id: number; name: string; dms_code: string; itop_number: string;
}

const REPORT_TYPES = ["C2C", "C2S", "Balance"] as const;

const defaultFilters: Filters = {
  search: "", report_type: "",
  start_date: "", end_date: "", retailer_search: "",
  house_id: "", rso_id: "",
};

function FilterSection({ title, icon: Icon, children, defaultOpen = true }: { title: string; icon: any; children: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-b dark:border-slate-800 last:border-b-0">
      <button type="button" onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-4 py-2.5 text-[11px] font-bold text-gray-500 uppercase tracking-widest hover:bg-gray-50 dark:hover:bg-slate-800/50 transition-colors">
        <div className="flex items-center gap-2">
          <Icon className="w-3.5 h-3.5" />
          <span>{title}</span>
        </div>
        <ChevronDown className={cn("w-3.5 h-3.5 transition-transform duration-300", open && "rotate-180")} />
      </button>
      <div className={cn("transition-all duration-300 ease-in-out", open ? "max-h-[500px] overflow-visible" : "max-h-0 overflow-hidden")}>
        <div className="px-4 pb-3 space-y-2.5">{children}</div>
      </div>
    </div>
  );
}

export default function ImportItopUpPage() {
  const { t } = useLanguage();
  const { hasPermission, loading: authLoading, selectedHouse } = useAuth();
  const [data, setData] = useState<ItopUpRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState<Pagination | null>(null);
  const [importProgress, setImportProgress] = useState<{percent: number; message: string} | null>(null);
  const [showSummary, setShowSummary] = useState(false);
  const [summaryData, setSummaryData] = useState<{message: string; count: number} | null>(null);
  const [summaryType, setSummaryType] = useState<"success" | "error">("success");
  const [showImportModal, setShowImportModal] = useState(false);
  const [selectedType, setSelectedType] = useState<string>("C2C");
  const today = new Date();
  const yesterdayDate = new Date(today);
  yesterdayDate.setDate(yesterdayDate.getDate() - 1);
  const firstOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
  const fmtDate = (d: Date) => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  };

  const [showFilter, setShowFilter] = useState(false);
  const [filters, setFilters] = useState<Filters>({
    ...defaultFilters,
    start_date: fmtDate(firstOfMonth),
    end_date: fmtDate(yesterdayDate),
  });
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [houses, setHouses] = useState<HouseOption[]>([]);
  const [rsos, setRsos] = useState<RsoOption[]>([]);
  const [searchInput, setSearchInput] = useState("");
  const [retailerSearchInput, setRetailerSearchInput] = useState("");
  const [rsoSearch, setRsoSearch] = useState("");
  const [rsoOpen, setRsoOpen] = useState(false);
  const rsoRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const perPage = 10;

  const hasActiveFilters = Object.values(filters).some(v => v !== "");

  const formatDate = (dateStr: string) => {
    if (!dateStr) return "-";
    const d = new Date(dateStr);
    return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  };

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, string | number> = {
        page, per_page: perPage, sort_by: "report_date", sort_order: "asc",
      };
      const headers: Record<string, string> = {};
      if (selectedHouse?.id) headers["X-House-ID"] = String(selectedHouse.id);
      if (filters.search) params.search = filters.search;
      if (filters.report_type) params.report_type = filters.report_type;
      if (filters.start_date) params.start_date = filters.start_date;
      if (filters.end_date) params.end_date = filters.end_date;
      if (filters.retailer_search) params.retailer_search = filters.retailer_search;
      if (filters.house_id) params.house_id = filters.house_id;
      if (filters.rso_id) params.rso_id = filters.rso_id;
      const res = await axios.get("/itopup-details", { params, headers });
      setData(res.data.data || []);
      setPagination(res.data.pagination || null);
    } catch {
      toast.error("Failed to load");
    } finally {
      setLoading(false);
    }
  }, [page, filters, selectedHouse?.id]);

  useEffect(() => { fetchData(); }, [fetchData]);

  useEffect(() => {
    axios.get("/houses/accessible").then(r => setHouses(r.data || [])).catch(() => {});
  }, []);

  const fetchRsos = useCallback(async (houseId: string, search: string) => {
    const params: Record<string, string> = {};
    if (houseId) params.house_id = houseId;
    if (search) params.search = search;
    try {
      const r = await axios.get("/itopup-details/rso-list", { params });
      setRsos(r.data || []);
    } catch {}
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      fetchRsos(filters.house_id, rsoSearch);
    }, 300);
    return () => clearTimeout(timer);
  }, [filters.house_id, rsoSearch, fetchRsos]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setFilters(prev => ({ ...prev, search: searchInput }));
      if (searchInput !== filters.search) setPage(1);
    }, 400);
    return () => clearTimeout(timer);
  }, [searchInput]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setFilters(prev => ({ ...prev, retailer_search: retailerSearchInput }));
      if (retailerSearchInput !== filters.retailer_search) setPage(1);
    }, 400);
    return () => clearTimeout(timer);
  }, [retailerSearchInput]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (rsoRef.current && !rsoRef.current.contains(e.target as Node)) setRsoOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleClearFilters = () => {
    setSearchInput("");
    setRetailerSearchInput("");
    setRsoSearch("");
    setFilters({ ...defaultFilters });
    setPage(1);
  };

  const updateFilter = (key: keyof Filters, value: string) => {
    setFilters(prev => ({ ...prev, [key]: value }));
  };

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

  const handleModalUpload = () => { fileInputRef.current?.click(); };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setShowImportModal(false);
    setImporting(true);
    setImportProgress({ percent: 0, message: t('import.uploading') });
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("report_type", selectedType);
      const token = Cookies.get("token");
      const baseURL = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000/api";
      const response = await fetch(`${baseURL}/itopup-details/import`, {
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

  const [syncingDMS, setSyncingDMS] = useState(false);

  const handleSyncFromDMS = async () => {
    setSyncingDMS(true);
    setImportProgress({ percent: 0, message: "Starting sync..." });
    try {
      const token = Cookies.get("token");
      const baseURL = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000/api";
      const headers: Record<string, string> = {};
      if (token) headers["Authorization"] = `Bearer ${token}`;
      if (selectedHouse?.id) headers["X-House-ID"] = String(selectedHouse.id);
      const response = await fetch(`${baseURL}/sync/itopup`, {
        method: "POST",
        headers,
      });
      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData?.detail || errData?.message || `Request failed (${response.status})`);
      }
      await readSSEStream(response);
      fetchData();
    } catch (err: any) {
      toast.error(err?.message || "Sync failed");
    } finally {
      setSyncingDMS(false);
      setImportProgress(null);
    }
  };

  const handleExport = async () => {
    try {
      const params: Record<string, string> = {};
      const headers: Record<string, string> = {};
      if (selectedHouse?.id) headers["X-House-ID"] = String(selectedHouse.id);
      if (filters.report_type) params.report_type = filters.report_type;
      if (filters.start_date) params.start_date = filters.start_date;
      if (filters.end_date) params.end_date = filters.end_date;
      const res = await axios.get("/itopup-details/export", { params, headers, responseType: "blob" });
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const a = document.createElement("a"); a.href = url; a.download = "itopup_details.xlsx"; a.click();
      window.URL.revokeObjectURL(url);
      toast.success("Exported");
    } catch { toast.error("Export failed"); }
  };

  const activeChipList: { label: string; onRemove: () => void }[] = [];
  if (filters.search) activeChipList.push({ label: `Search: ${filters.search}`, onRemove: () => { setSearchInput(""); updateFilter("search", ""); setPage(1); } });
  if (filters.report_type) activeChipList.push({ label: `Type: ${filters.report_type}`, onRemove: () => { updateFilter("report_type", ""); setPage(1); } });
  if (filters.start_date) activeChipList.push({ label: `From: ${filters.start_date}`, onRemove: () => { updateFilter("start_date", ""); setPage(1); } });
  if (filters.end_date) activeChipList.push({ label: `To: ${filters.end_date}`, onRemove: () => { updateFilter("end_date", ""); setPage(1); } });
  if (filters.retailer_search) activeChipList.push({ label: `Retailer: ${filters.retailer_search}`, onRemove: () => { setRetailerSearchInput(""); updateFilter("retailer_search", ""); setPage(1); } });
  if (filters.house_id) {
    const h = houses.find(hh => String(hh.id) === filters.house_id);
    if (h) activeChipList.push({ label: `House: ${h.name}`, onRemove: () => { updateFilter("house_id", ""); setPage(1); } });
  }
  if (filters.rso_id) {
    const r = rsos.find(rr => String(rr.id) === filters.rso_id);
    if (r) activeChipList.push({ label: `RSO: ${r.name}`, onRemove: () => { updateFilter("rso_id", ""); setPage(1); } });
  }

  const totalPages = pagination?.total_pages || 1;

  if (!authLoading && !hasPermission("itopup.import")) { return <AccessDenied />; }

  return (
    <div className="p-6 space-y-6">
      <style>{`
        @keyframes slideDown { from { transform: translateY(-100%); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
        @keyframes slideUp { from { transform: translateY(0); opacity: 1; } to { transform: translateY(-100%); opacity: 0; } }
        .animate-slide-down { animation: slideDown 0.35s ease-out; }
        .animate-slide-up { animation: slideUp 0.35s ease-out forwards; }
        .rso-scrollbar::-webkit-scrollbar { width: 5px; }
        .rso-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .rso-scrollbar::-webkit-scrollbar-thumb { background: #d1d5db; border-radius: 10px; }
        .rso-scrollbar::-webkit-scrollbar-thumb:hover { background: #9ca3af; }
        .dark .rso-scrollbar::-webkit-scrollbar-thumb { background: #475569; }
        .dark .rso-scrollbar::-webkit-scrollbar-thumb:hover { background: #64748b; }
      `}</style>

      {showImportModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-xl border border-gray-100 dark:border-slate-800 p-6 w-full max-w-sm mx-4 animate-in zoom-in-95 duration-200">
            <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100 mb-1">{t('import.progress_title')}</h3>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-5">{t('import.itopup_desc')}</p>
            <div className="space-y-3 mb-6">
              {REPORT_TYPES.map((rt) => (
                <button key={rt} onClick={() => setSelectedType(rt)}
                  className={cn("w-full flex items-center justify-between px-4 py-3 rounded-xl text-sm font-medium text-left transition-all border",
                    selectedType === rt
                      ? "bg-primary-100 dark:bg-primary-500/20 border-primary-300 dark:border-primary-600 text-primary-700 dark:text-primary-300"
                      : "bg-gray-50 dark:bg-slate-800 border-gray-200 dark:border-slate-700 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-slate-700"
                  )}>
                  <span>{rt}</span>
                  {selectedType === rt && <CheckCircle2 className="w-5 h-5 text-emerald-500" />}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-3">
              <button onClick={() => setShowImportModal(false)}
                className="flex-1 px-4 py-2.5 border border-gray-200 dark:border-slate-700 rounded-xl text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-slate-800 transition-colors">
                Cancel
              </button>
              <button onClick={handleModalUpload}
                className="flex-1 px-4 py-2.5 bg-primary-600 text-white rounded-xl text-sm font-medium hover:bg-primary-700 transition-colors">
                Upload File
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
                    {summaryType === "success" ? t('import.complete_title') : t('import.failed_title')}
                  </h3>
                  <p className="text-sm text-gray-600 dark:text-gray-400 mt-1 break-words">{summaryData.message}</p>
                  {summaryType === "success" && (
                    <div className="mt-2 inline-flex items-center gap-1.5 px-2.5 py-1 bg-emerald-50 dark:bg-emerald-500/10 rounded-lg">
                      <span className="text-sm font-semibold text-emerald-600">{summaryData.count}</span>
                      <span className="text-xs text-emerald-500">{t('import.records_label')}</span>
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
            <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">{t('nav.import_itopup')}</h1>
            <p className="text-sm text-gray-500 dark:text-gray-400">{t('import.itopup_desc')}</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <input type="file" ref={fileInputRef} onChange={handleFileChange} className="hidden" accept=".xlsx,.xls" />
          <button onClick={() => setShowImportModal(true)} disabled={importing}
            className="flex items-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-xl text-sm font-medium hover:bg-primary-700 disabled:opacity-50 transition-colors shadow-lg shadow-primary-200 dark:shadow-primary-900/30">
            {importing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
            {importing ? `${t('common.processing')}...` : "Import Excel"}
          </button>
          <button onClick={handleExport}
            className="flex items-center gap-2 px-4 py-2 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-slate-800 transition-colors">
            <Download className="w-4 h-4" /> Export
          </button>
          <button onClick={handleSyncFromDMS} disabled={syncingDMS || importing}
            className="flex items-center gap-2 px-4 py-2 bg-purple-50 dark:bg-purple-500/10 border border-purple-200 dark:border-purple-800/50 rounded-xl text-sm font-medium text-purple-700 dark:text-purple-400 hover:bg-purple-100 dark:hover:bg-purple-500/20 transition-colors disabled:opacity-50">
            {syncingDMS ? <Loader2 className="w-4 h-4 animate-spin" /> : <CloudDownload className="w-4 h-4" />}
            {syncingDMS ? "Syncing..." : "Sync from DMS"}
          </button>
        </div>
      </div>

      {importProgress && (
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-gray-100 dark:border-slate-800 shadow-sm p-5">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin text-primary-600" />
              <span className="text-sm font-medium text-gray-700 dark:text-gray-300">{t('import.progress_title')}</span>
            </div>
            <span className="text-sm font-semibold text-primary-600">{importProgress.percent}%</span>
          </div>
          <div className="w-full bg-gray-100 dark:bg-slate-700 rounded-full h-2.5">
            <div className="bg-primary-600 h-2.5 rounded-full transition-all duration-500 ease-out" style={{ width: `${importProgress.percent}%` }} />
          </div>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">{importProgress.message}</p>
        </div>
      )}

      {/* Filter + Table */}
      <div className="flex gap-6">
        {/* Filter Sidebar */}
        <div className={cn(
          "w-72 shrink-0 transition-all duration-300 ease-in-out",
          showFilter ? "opacity-100 max-w-[288px]" : "opacity-0 max-w-0 overflow-hidden"
        )}>
          <div className="bg-white dark:bg-slate-900 rounded-2xl border dark:border-slate-800 shadow-sm overflow-hidden sticky top-6">
            <div className="px-4 py-3 border-b dark:border-slate-800 flex items-center justify-between bg-gray-50/50 dark:bg-slate-900/50">
              <div className="flex items-center gap-2">
                <Filter className="w-4 h-4 text-primary-500" />
                <span className="text-sm font-bold dark:text-gray-100">Filters</span>
                {activeChipList.length > 0 && (
                  <span className="text-[10px] font-bold bg-primary-100 dark:bg-primary-500/20 text-primary-700 dark:text-primary-300 px-2 py-0.5 rounded-full">
                    {activeChipList.length}
                  </span>
                )}
              </div>
              {activeChipList.length > 0 && (
                <button type="button" onClick={handleClearFilters}
                  className="text-[11px] font-bold text-red-500 hover:text-red-600 flex items-center gap-1 transition-colors">
                  <RotateCcw className="w-3 h-3" /> Clear
                </button>
              )}
            </div>

            {activeChipList.length > 0 && (
              <div className="px-4 py-2 border-b dark:border-slate-800 flex flex-wrap gap-1.5">
                {activeChipList.map((chip, i) => (
                  <span key={i}
                    className="inline-flex items-center gap-1 px-2 py-0.5 bg-primary-50 dark:bg-primary-500/10 text-primary-700 dark:text-primary-300 rounded-full text-[10px] font-bold">
                    {chip.label}
                    <button type="button" onClick={chip.onRemove} className="hover:text-red-500 transition-colors">
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}

            <div className="divide-y dark:divide-slate-800">
              {/* Search */}
              <div className="px-4 py-2.5">
                <div className="relative group">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 group-focus-within:text-primary-500 transition-colors" />
                  <input type="text" placeholder="Search type, date..."
                    value={searchInput}
                    onChange={e => setSearchInput(e.target.value)}
                    className="w-full pl-8 pr-3 py-1.5 bg-gray-50 dark:bg-slate-800 border border-transparent rounded-lg text-xs dark:text-gray-200 outline-none focus:border-primary-500 focus:ring-1 focus:ring-primary-500 transition-all" />
                </div>
              </div>

              {/* House */}
              <FilterSection title="House" icon={Building2}>
                <select value={filters.house_id}
                  onChange={e => { updateFilter("house_id", e.target.value); setPage(1); }}
                  className="w-full p-2 bg-gray-50 dark:bg-slate-800 border border-transparent rounded-lg text-xs dark:text-gray-200 outline-none focus:border-primary-500 focus:ring-1 focus:ring-primary-500 transition-all appearance-none">
                  <option value="">All houses</option>
                  {houses.map(h => <option key={h.id} value={h.id}>{h.display_name}</option>)}
                </select>
              </FilterSection>

              {/* RSO */}
              <FilterSection title="RSO" icon={User}>
                <div className="relative" ref={rsoRef}>
                  <div className="relative">
                    <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
                    <input type="text" placeholder="Search RSO..."
                      value={rsoSearch}
                      onChange={e => setRsoSearch(e.target.value)}
                      onFocus={() => setRsoOpen(true)}
                      className="w-full pl-7 pr-3 py-1.5 bg-gray-50 dark:bg-slate-800 border border-transparent rounded-lg text-xs dark:text-gray-200 outline-none focus:border-primary-500 focus:ring-1 focus:ring-primary-500 transition-all" />
                  </div>
                  {rsoOpen && (
                    <div className="absolute z-50 left-0 right-0 mt-1 max-h-48 overflow-y-auto rso-scrollbar bg-white dark:bg-slate-900 border dark:border-slate-700 rounded-lg shadow-lg">
                      {rsos.length === 0 ? (
                        <div className="px-3 py-2 text-xs text-gray-400">No RSOs found</div>
                      ) : (
                        rsos.map(r => {
                          const itopLast3 = r.itop_number ? r.itop_number.slice(-3) : "";
                          return (
                            <button key={r.id} type="button"
                              onClick={() => { updateFilter("rso_id", String(r.id)); setRsoOpen(false); setRsoSearch(""); }}
                              className={cn(
                                "w-full text-left px-3 py-2 transition-colors",
                                filters.rso_id === String(r.id)
                                  ? "bg-primary-50 dark:bg-primary-500/10 text-primary-700 dark:text-primary-300"
                                  : "hover:bg-gray-50 dark:hover:bg-slate-800 text-gray-700 dark:text-gray-300"
                              )}>
                              <p className="text-xs font-medium">{r.name}</p>
                              <p className="text-[11px] text-gray-400">
                                {r.dms_code}{itopLast3 ? ` | ${itopLast3}` : ""}
                              </p>
                            </button>
                          );
                        })
                      )}
                    </div>
                  )}
                </div>
              </FilterSection>

              {/* Report Type */}
              <FilterSection title="Report Type" icon={Database}>
                <select value={filters.report_type}
                  onChange={e => { updateFilter("report_type", e.target.value); setPage(1); }}
                  className="w-full p-2 bg-gray-50 dark:bg-slate-800 border border-transparent rounded-lg text-xs dark:text-gray-200 outline-none focus:border-primary-500 focus:ring-1 focus:ring-primary-500 transition-all appearance-none">
                  <option value="">All types</option>
                  {REPORT_TYPES.map(rt => <option key={rt} value={rt}>{rt}</option>)}
                </select>
              </FilterSection>

              {/* Date Range */}
              <FilterSection title="Date Range" icon={Calendar}>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[10px] font-bold text-gray-400 uppercase block mb-1">From</label>
                    <input type="date" value={filters.start_date}
                      onChange={e => { updateFilter("start_date", e.target.value); setPage(1); }}
                      className="w-full p-2 bg-gray-50 dark:bg-slate-800 border border-transparent rounded-lg text-xs dark:text-gray-200 outline-none focus:border-primary-500 focus:ring-1 focus:ring-primary-500 transition-all" />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-gray-400 uppercase block mb-1">To</label>
                    <input type="date" value={filters.end_date}
                      onChange={e => { updateFilter("end_date", e.target.value); setPage(1); }}
                      className="w-full p-2 bg-gray-50 dark:bg-slate-800 border border-transparent rounded-lg text-xs dark:text-gray-200 outline-none focus:border-primary-500 focus:ring-1 focus:ring-primary-500 transition-all" />
                  </div>
                </div>
              </FilterSection>

              {/* Retailer Search */}
              <FilterSection title="Retailer" icon={Store} defaultOpen={false}>
                <div className="relative group">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 group-focus-within:text-primary-500 transition-colors" />
                  <input type="text" placeholder="Search by code or name..."
                    value={retailerSearchInput}
                    onChange={e => setRetailerSearchInput(e.target.value)}
                    className="w-full pl-8 pr-3 py-1.5 bg-gray-50 dark:bg-slate-800 border border-transparent rounded-lg text-xs dark:text-gray-200 outline-none focus:border-primary-500 focus:ring-1 focus:ring-primary-500 transition-all" />
                </div>
              </FilterSection>
            </div>
          </div>
        </div>

        {/* Table Section */}
        <div className="flex-1 min-w-0">
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-gray-100 dark:border-slate-800 shadow-sm">
            {/* Toolbar */}
            <div className="p-4 border-b border-gray-100 dark:border-slate-800 flex items-center justify-between gap-4">
              <div className="flex items-center gap-3 flex-1">
                <button onClick={() => setShowFilter(!showFilter)}
                  className={cn("p-2 rounded-xl border transition-all",
                    showFilter
                      ? "bg-primary-50 dark:bg-primary-500/10 border-primary-200 dark:border-primary-700 text-primary-600"
                      : "border-gray-200 dark:border-slate-700 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                  )}>
                  <SlidersHorizontal className="w-4 h-4" />
                </button>
                {pagination && (
                  <span className="text-xs text-gray-500 dark:text-gray-400">
                    {pagination.total} {pagination.total === 1 ? "record" : "records"}
                  </span>
                )}
              </div>
            </div>

            {/* Loading Skeleton */}
            {loading ? (
              <div>
                {/* Desktop skeleton */}
                <div className="hidden lg:block">
                  {Array.from({ length: perPage }).map((_, i) => (
                    <div key={i} className="flex items-center gap-4 px-2 py-1 animate-pulse border-b border-gray-50 dark:border-slate-800/50">
                      <div className="h-3 w-16 bg-gray-200 dark:bg-slate-700 rounded-md" />
                      <div className="h-3 w-24 bg-gray-200 dark:bg-slate-700 rounded-md" />
                      <div className="h-3 w-20 bg-gray-200 dark:bg-slate-700 rounded-md" />
                      <div className="h-3 w-16 bg-gray-200 dark:bg-slate-700 rounded-md" />
                      <div className="flex-1 space-y-1">
                        <div className="h-3 w-28 bg-gray-200 dark:bg-slate-700 rounded-md" />
                        <div className="h-2.5 w-20 bg-gray-100 dark:bg-slate-800 rounded-md" />
                      </div>
                    </div>
                  ))}
                </div>
                {/* Mobile skeleton */}
                <div className="lg:hidden space-y-3 p-4">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <div key={i} className="bg-gray-50 dark:bg-slate-800 rounded-xl p-4 animate-pulse">
                      <div className="flex items-center justify-between">
                        <div className="space-y-2 flex-1">
                          <div className="h-3 w-40 bg-gray-200 dark:bg-slate-700 rounded-md" />
                          <div className="h-2.5 w-28 bg-gray-100 dark:bg-slate-800 rounded-md" />
                        </div>
                        <div className="w-5 h-5 bg-gray-200 dark:bg-slate-700 rounded-md" />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : data.length === 0 ? (
              <div className="py-20 text-center">
                <Database className="w-12 h-12 text-gray-200 dark:text-gray-700 mx-auto mb-4" />
                <p className="text-gray-500 dark:text-gray-400 font-medium">No records found</p>
              </div>
            ) : (
              <>
                {/* Desktop Table — lg+ */}
                <div className="hidden lg:block overflow-x-auto scrollbar-custom">
                  <table className="w-full text-left whitespace-nowrap">
                    <thead>
                      <tr className="bg-gray-50/50 dark:bg-slate-800/50 text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-widest border-b border-gray-50 dark:border-slate-800">
                        <th className="px-2 py-1">House</th>
                        <th className="px-2 py-1">Date</th>
                        <th className="px-2 py-1">RSO</th>
                        <th className="px-2 py-1">Retailer</th>
                        <th className="px-2 py-1 text-right">Amount</th>
                        <th className="px-2 py-1">Type</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50 dark:divide-slate-800">
                      {data.map((r) => {
                        const rsoName = r.retailer?.employee?.user?.name;
                        const rsoDms = r.retailer?.employee?.dms_code;
                        const rsoItop = r.retailer?.employee?.itop_number;
                        const hasRso = rsoName || rsoDms || rsoItop;
                        return (
                        <tr key={r.id} className="hover:bg-gray-50/30 dark:hover:bg-slate-800/30 transition-colors group">
                          <td className="px-2 py-1">
                            <p className="text-xs text-gray-700 dark:text-gray-300">{r.house?.name || "-"}</p>
                            <p className="text-[11px] text-gray-500 dark:text-gray-400">{r.house?.code || ""}</p>
                          </td>
                          <td className="px-2 py-1 text-xs text-gray-600 dark:text-gray-400 whitespace-nowrap">{formatDate(r.report_date)}</td>
                          <td className="px-2 py-1">
                            {hasRso ? (
                              <>
                                <p className="text-xs font-medium text-gray-900 dark:text-gray-100">{rsoName}</p>
                                <p className="text-[11px] text-gray-500 dark:text-gray-400">{rsoDms}{rsoItop ? ` | ${rsoItop}` : ""}</p>
                              </>
                            ) : (
                              <span className="text-xs text-gray-400">-</span>
                            )}
                          </td>
                          <td className="px-2 py-1">
                            <p className="text-xs font-medium text-gray-900 dark:text-gray-100">{r.retailer?.name || "-"}</p>
                            <p className="text-[11px] text-gray-500 dark:text-gray-400">
                              {[r.retailer?.retailer_code, r.retailer?.itop_number].filter(Boolean).join(" | ") || ""}
                            </p>
                          </td>
                          <td className="px-2 py-1 text-xs font-semibold text-gray-900 dark:text-gray-100 text-right tabular-nums">{r.daily_value.toLocaleString()}</td>
                          <td className="px-2 py-1">
                            <span className="px-2 py-0.5 bg-primary-100 dark:bg-primary-500/20 text-primary-700 dark:text-primary-300 rounded-md text-[10px] font-bold">{r.report_type}</span>
                          </td>
                        </tr>
                      );})}
                    </tbody>
                  </table>
                </div>

                {/* Mobile Accordion — below lg */}
                <div className="lg:hidden divide-y divide-gray-50 dark:divide-slate-800">
                  {data.map((r) => {
                    const rsoName = r.retailer?.employee?.user?.name;
                    const rsoDms = r.retailer?.employee?.dms_code;
                    const rsoItop = r.retailer?.employee?.itop_number;
                    const hasRso = rsoName || rsoDms || rsoItop;
                    return (
                    <div key={r.id}>
                      <button onClick={() => setExpandedId(expandedId === r.id ? null : r.id)}
                        className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-50/30 dark:hover:bg-slate-800/30 transition-colors text-left">
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="w-9 h-9 rounded-xl bg-primary-100 dark:bg-primary-500/20 flex items-center justify-center text-primary-700 dark:text-primary-400 font-bold shadow-sm shrink-0">
                            <Store className="w-4 h-4" />
                          </div>
                          <div className="min-w-0">
                            <p className="font-bold text-gray-900 dark:text-gray-100 text-sm truncate">{r.retailer?.name || "-"}</p>
                            <p className="text-[11px] text-gray-500 dark:text-gray-400 truncate">{formatDate(r.report_date)}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-bold text-gray-900 dark:text-gray-100">{r.daily_value.toLocaleString()}</span>
                          <ChevronDown className={cn("w-4 h-4 text-gray-400 shrink-0 transition-transform duration-300", expandedId === r.id && "rotate-180")} />
                        </div>
                      </button>
                      {expandedId === r.id && (
                        <div className="px-4 pb-4 space-y-3 animate-in slide-in-from-top-1 duration-200">
                          <div className="h-px bg-gray-100 dark:bg-slate-800" />
                          <div className="grid grid-cols-2 gap-3">
                            <div>
                              <p className="text-[10px] font-bold text-gray-400 uppercase mb-0.5">House</p>
                              <p className="text-xs font-medium text-gray-700 dark:text-gray-200">{r.house?.name || "-"}</p>
                              {r.house?.code && <p className="text-[11px] text-gray-500">{r.house.code}</p>}
                            </div>
                            <div>
                              <p className="text-[10px] font-bold text-gray-400 uppercase mb-0.5">Date</p>
                              <p className="text-xs font-medium text-gray-700 dark:text-gray-200">{formatDate(r.report_date)}</p>
                            </div>
                            <div className="col-span-2">
                              <p className="text-[10px] font-bold text-gray-400 uppercase mb-0.5">RSO</p>
                              {hasRso ? (
                                <>
                                  <p className="text-xs font-medium text-gray-700 dark:text-gray-200">{rsoName}</p>
                                  <p className="text-[11px] text-gray-500">{rsoDms}{rsoItop ? ` | ${rsoItop}` : ""}</p>
                                </>
                              ) : (
                                <p className="text-xs text-gray-400">-</p>
                              )}
                            </div>
                            <div className="col-span-2">
                              <p className="text-[10px] font-bold text-gray-400 uppercase mb-0.5">Retailer</p>
                              <p className="text-xs font-medium text-gray-700 dark:text-gray-200">{r.retailer?.name || "-"}</p>
                              <p className="text-[11px] text-gray-500">
                                {[r.retailer?.retailer_code, r.retailer?.itop_number].filter(Boolean).join(" | ") || ""}
                              </p>
                            </div>
                            <div>
                              <p className="text-[10px] font-bold text-gray-400 uppercase mb-0.5">Amount</p>
                              <p className="text-xs font-semibold text-gray-900 dark:text-gray-100">{r.daily_value.toLocaleString()}</p>
                            </div>
                            <div>
                              <p className="text-[10px] font-bold text-gray-400 uppercase mb-0.5">Type</p>
                              <span className="px-1.5 py-0.5 bg-primary-100 dark:bg-primary-500/20 text-primary-700 dark:text-primary-300 rounded text-[10px] font-bold">{r.report_type}</span>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  );})}
                </div>

                {/* Pagination */}
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
        </div>
      </div>
    </div>
  );
}
