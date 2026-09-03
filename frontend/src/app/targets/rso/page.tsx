"use client";
import { useState, useRef, useEffect, useCallback } from "react";
import { useLanguage } from "@/i18n/useLanguage";
import { Search, Upload, Download, ChevronLeft, ChevronRight, ChevronUp, Loader2, Crosshair, X, CheckCircle2, FileDown, Plus, Edit2, Trash2, Check, AlertCircle, ChevronDown, Filter, SlidersHorizontal } from "lucide-react";
import { toast } from "react-hot-toast";
import axios from "@/lib/api";
import apiClient from "@/lib/api";
import Cookies from "js-cookie";
import { useAuth } from "@/context/AuthContext";
import { AccessDenied } from "@/components/ui/AccessDenied";
import { ConfirmationModal } from "@/components/ui/ConfirmationModal";

interface RSOOption {
  id: number;
  user_id: number | null;
  name: string | null;
  employee_id: string;
  dms_code: string;
  itop_number: string;
  pool_number: string;
}

interface House {
  id: number; name: string; code: string;
}

interface SupervisorOption {
  id: number | null;
  user_id: number | null;
  name: string | null;
  employee_id: string;
  itop_number: string;
  pool_number: string;
}

interface RSOTargetRecord {
  id: number;
  house_id: number;
  employee_id: number;
  supervisor_id: number | null;
  ev_secondary: number;
  sc_secondary: number;
  total_recharge: number;
  ga: number;
  sso: number;
  lso: number;
  bso: number;
  ddso: number;
  dsso: number;
  dso: number;
  dlso: number;
  service_route: string;
  market_type: string;
  thana_name: string;
  ga_target_modified: number;
  ev_secondary_modified: number;
  sc_secondary_modified: number;
  recharge_target_modified: number;
  lso_target_modified: number;
  sso_target_modified: number;
  bso_target_modified: number;
  daily_dso_target_modified: number;
  extra_targets?: Record<string, number>;
  target_date: string;
  house?: { id: number; name: string; code: string };
  employee?: { user?: { name: string }; dms_code: string; itop_number: string };
  supervisor?: { user?: { name: string }; pool_number: string };
}

type ErrDict = Record<string, string>;

export default function RSOTargetsPage() {
  const { t, language } = useLanguage();
  const { hasPermission, loading: authLoading } = useAuth();
  const [data, setData] = useState<RSOTargetRecord[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [page, setPage] = useState(1);
  const [totalRecords, setTotalRecords] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [importProgress, setImportProgress] = useState<{percent: number; message: string} | null>(null);
  const [showSummary, setShowSummary] = useState(false);
  const [summaryData, setSummaryData] = useState<{message: string; count: number} | null>(null);
  const [summaryType, setSummaryType] = useState<"success" | "error">("success");
  const perPage = 5;
  const [filterOpen, setFilterOpen] = useState(false);
  const [filters, setFilters] = useState({ house_id: 0, market_type: "", target_date: "" });
  const [filterHouses, setFilterHouses] = useState<House[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  const [isFormModalOpen, setIsFormModalOpen] = useState(false);
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<RSOTargetRecord | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [isDeleteAllOpen, setIsDeleteAllOpen] = useState(false);
  const [deletingAll, setDeletingAll] = useState(false);
  const [rsoList, setRsoList] = useState<RSOOption[]>([]);
  const [supervisorList, setSupervisorList] = useState<SupervisorOption[]>([]);
  const [houses, setHouses] = useState<House[]>([]);
  const [formData, setFormData] = useState({
    house_id: 0,
    employee_id: 0,
    supervisor_id: 0,
    target_date: "",
    ev_secondary: "",
    sc_secondary: "",
    total_recharge: "",
    ga: "",
    sso: "",
    lso: "",
    bso: "",
    ddso: "",
    dsso: "",
    dso: "",
    dlso: "",
    service_route: "",
    market_type: "",
    thana_name: "",
    extra_targets: [] as {key: string; value: string}[],
  });
  const [formLoading, setFormLoading] = useState(false);
  const [formError, setFormError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<ErrDict>({});

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, any> = { page, per_page: perPage };
      if (search) params.search = search;
      if (filters.target_date) params.target_date = filters.target_date + "-01";
      if (filters.market_type) params.market_type = filters.market_type;
      if (filters.house_id) params.house_id = String(filters.house_id);
      const res = await axios.get("/rso-targets", { params });
      setData(res.data?.data || []);
      setTotalRecords(res.data?.pagination?.total || 0);
      setTotalPages(res.data?.pagination?.total_pages || 1);
    } catch (err: any) {
      const msg = err?.response?.data?.detail || err?.response?.data?.error?.message || err?.message || "Failed to load";
      toast.error(msg);
      console.error("Fetch RSO targets error:", err);
    }
    finally { setLoading(false); }
  }, [search, page, filters]);

  const fetchRsoList = async (houseId?: number, excludeMonth?: string) => {
    try {
      const params: Record<string, string> = {};
      if (houseId) params.house_id = String(houseId);
      if (excludeMonth) params.exclude_month = excludeMonth;
      const res = await apiClient.get("employees/rso-list", { params });
      const list: RSOOption[] = res.data?.data || [];
      setRsoList(list);
    } catch (err: any) {
      console.error("Fetch RSO list error:", err);
    }
  };

  const fetchSupervisorList = async (houseId?: number) => {
    try {
      const params: Record<string, string> = {};
      if (houseId) params.house_id = String(houseId);
      const res = await apiClient.get("employees/supervisors-list", { params });
      const list: SupervisorOption[] = res.data?.data || [];
      setSupervisorList(list);
    } catch (err: any) {
      console.error("Fetch supervisor list error:", err);
    }
  };

  const fetchHouses = async () => {
    try {
      const res = await apiClient.get("houses");
      const h = res.data.data || res.data || [];
      setHouses(h);
      setFilterHouses(h);
    } catch {}
  };

  useEffect(() => { fetchHouses(); fetchData(); }, [fetchData]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const openAddModal = async () => {
    await fetchHouses();
    setRsoList([]);
    setSupervisorList([]);
    setEditingItem(null);
    const now = new Date();
    const defaultMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    setFormData({
      house_id: 0, employee_id: 0, supervisor_id: 0, target_date: defaultMonth, ev_secondary: "", sc_secondary: "",
      total_recharge: "", ga: "", sso: "", lso: "", bso: "", ddso: "", dsso: "", dso: "", dlso: "",
      service_route: "", market_type: "", thana_name: "", extra_targets: [],
    });
    setFormError("");
    setFieldErrors({});
    setIsFormModalOpen(true);
  };

  const openEditModal = async (item: RSOTargetRecord) => {
    await fetchHouses();
    if (item.house_id) {
      fetchRsoList(item.house_id);
      fetchSupervisorList(item.house_id);
    }
    setEditingItem(item);
    const extra = item.extra_targets;
    const extraArr = extra && typeof extra === "object"
      ? Object.entries(extra).map(([k, v]) => ({ key: k, value: String(v) }))
      : [];
    setFormData({
      house_id: item.house_id || 0,
      employee_id: item.employee_id,
      supervisor_id: item.supervisor_id || 0,
      target_date: item.target_date ? item.target_date.substring(0, 7) : "",
      ev_secondary: String(item.ev_secondary || ""),
      sc_secondary: String(item.sc_secondary || ""),
      total_recharge: String(item.total_recharge || ""),
      ga: String(item.ga || ""),
      sso: String(item.sso || ""),
      lso: String(item.lso || ""),
      bso: String(item.bso || ""),
      ddso: String(item.ddso || ""),
      dsso: String(item.dsso || ""),
      dso: String(item.dso || ""),
      dlso: String(item.dlso || ""),
      service_route: item.service_route || "",
      market_type: item.market_type || "",
      thana_name: item.thana_name || "",
      extra_targets: extraArr,
    });
    setFormError("");
    setFieldErrors({});
    setIsFormModalOpen(true);
  };

  const validateForm = () => {
    const errors: ErrDict = {};
    if (!formData.employee_id) errors.employee_id = "RSO is required";
    if (!formData.target_date) errors.target_date = "Target date is required";
    if (!formData.ev_secondary) errors.ev_secondary = "EV Secondary is required";
    if (!formData.sc_secondary) errors.sc_secondary = "SC Secondary is required";
    if (!formData.ga) errors.ga = "GA is required";
    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validateForm()) { toast.error("Please fix errors"); return; }
    setFormLoading(true);
    setFormError("");
    try {
      const extra: Record<string, number> = {};
      formData.extra_targets.forEach(et => {
        if (et.key.trim()) extra[et.key.trim()] = parseFloat(et.value) || 0;
      });
      const payload: Record<string, any> = {
        employee_id: formData.employee_id,
        target_date: formData.target_date + "-01",
        house_id: formData.house_id || undefined,
        ev_secondary: parseFloat(formData.ev_secondary) || 0,
        sc_secondary: parseFloat(formData.sc_secondary) || 0,
        total_recharge: parseFloat(formData.total_recharge) || 0,
        ga: parseInt(formData.ga) || 0,
        sso: parseInt(formData.sso) || 0,
        lso: parseInt(formData.lso) || 0,
        bso: parseInt(formData.bso) || 0,
        ddso: parseInt(formData.ddso) || 0,
        dsso: parseInt(formData.dsso) || 0,
        dso: parseInt(formData.dso) || 0,
        dlso: parseInt(formData.dlso) || 0,
        extra_targets: extra,
      };
      if (formData.supervisor_id) payload.supervisor_id = formData.supervisor_id;
      if (formData.service_route) payload.service_route = formData.service_route;
      if (formData.market_type) payload.market_type = formData.market_type;
      if (formData.thana_name) payload.thana_name = formData.thana_name;

      if (editingItem) {
        await apiClient.put(`rso-targets/${editingItem.id}`, payload);
        toast.success(t('rso_targets.toast_update_success'));
      } else {
        await apiClient.post("rso-targets", payload);
        toast.success(t('rso_targets.toast_create_success'));
      }
      setIsFormModalOpen(false);
      fetchData();
    } catch (err: any) {
      const msg = err?.response?.data?.detail || err?.response?.data?.message || "Action failed";
      setFormError(msg);
      toast.error(msg);
    } finally { setFormLoading(false); }
  };

  const handleDeleteClick = (id: number) => {
    setDeletingId(id);
    setIsConfirmOpen(true);
  };

  const handleConfirmDelete = async () => {
    if (!deletingId) return;
    setFormLoading(true);
    try {
      await apiClient.delete(`rso-targets/${deletingId}`);
      toast.success(t('rso_targets.toast_delete_success'));
      setIsConfirmOpen(false);
      fetchData();
    } catch { toast.error(t('rso_targets.toast_delete_failed')); }
    finally { setFormLoading(false); setDeletingId(null); }
  };

  const handleConfirmDeleteAll = async () => {
    setDeletingAll(true);
    try {
      const params: Record<string, string> = {};
      if (filters.house_id) params.house_id = String(filters.house_id);
      if (filters.market_type) params.market_type = filters.market_type;
      if (filters.target_date) params.target_date = filters.target_date + "-01";
      const res = await apiClient.delete("rso-targets", { params });
      const count = res.data?.deleted ?? 0;
      toast.success(count > 0 ? `${count} RSO target(s) deleted` : t('rso_targets.no_data'));
      setIsDeleteAllOpen(false);
      fetchData();
    } catch (err: any) {
      const msg = err?.response?.data?.detail || err?.response?.data?.message || "Failed to delete";
      toast.error(msg);
    }
    finally { setDeletingAll(false); }
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
              setImportProgress({ percent: pctMatch ? parseInt(pctMatch[1]) : 0, message: msg });
            } else if (d.type === "complete") {
              result = d;
              setSummaryData({ message: d.message, count: d.count }); setSummaryType("success"); setShowSummary(true);
              setTimeout(() => setShowSummary(false), 6000);
            } else if (d.type === "error") {
              setSummaryData({ message: d.message, count: 0 }); setSummaryType("error"); setShowSummary(true);
              setTimeout(() => setShowSummary(false), 6000);
              throw new Error(d.message);
            }
          } catch (e: any) { if (e.message !== "Unexpected end of JSON input") throw e; }
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
      const response = await fetch(`${baseURL}/rso-targets/import`, {
        method: "POST", body: form,
        headers: token ? { "Authorization": `Bearer ${token}` } : {},
      });
      if (!response.ok) {
        const errText = await response.text();
        let errMsg = "Import failed";
        try { const errJson = JSON.parse(errText); errMsg = errJson.detail || errMsg; } catch {}
        throw new Error(errMsg);
      }
      const result = await readSSEStream(response);
      if (result) { toast.success(result.message); fetchData(); }
    } catch (err: any) { toast.error(err?.message || "Import failed"); }
    finally {
      setImporting(false); setImportProgress(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleExport = async () => {
    try {
      const res = await axios.get("/rso-targets/export", { responseType: "blob" });
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const a = document.createElement("a"); a.href = url; a.download = "rso_targets.xlsx"; a.click();
      window.URL.revokeObjectURL(url);
      toast.success("Exported");
    } catch { toast.error("Export failed"); }
  };

  const handleDownloadSample = async () => {
    try {
      const res = await axios.get("/rso-targets/sample", { responseType: "blob" });
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const a = document.createElement("a"); a.href = url; a.download = "rso_targets_sample.xlsx"; a.click();
      window.URL.revokeObjectURL(url);
      toast.success("Sample downloaded");
    } catch { toast.error("Download failed"); }
  };

  if (!authLoading && !hasPermission("targets.view")) { return <AccessDenied />; }

  const canEdit = hasPermission("targets.edit");

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
                    {summaryType === "success" ? "Import Completed" : "Import Failed"}
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
          <div className="p-2.5 bg-rose-100 dark:bg-rose-500/20 rounded-xl">
            <Crosshair className="w-5 h-5 text-rose-600" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">{t('nav.rso_targets')}</h1>
            <p className="text-sm text-gray-500 dark:text-gray-400">{t('rso_targets.description')}</p>
          </div>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          {canEdit && (
            <button onClick={openAddModal}
              className="flex items-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-xl text-sm font-medium hover:bg-primary-700 transition-colors shadow-lg shadow-primary-200 dark:shadow-none">
              <Plus className="w-4 h-4" /> {t('rso_targets.add_new')}
            </button>
          )}
          <input type="file" ref={fileInputRef} onChange={handleFileChange} className="hidden" accept=".xlsx,.xls" />
          <div className="relative" ref={menuRef}>
            <button onClick={() => setMenuOpen(!menuOpen)}
              className="flex items-center gap-2 px-4 py-2 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-xl text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-slate-800 transition-colors">
              <Download className="w-4 h-4" /> Actions <ChevronDown className={`w-3.5 h-3.5 transition-transform ${menuOpen ? 'rotate-180' : ''}`} />
            </button>
            {menuOpen && (
              <div className="absolute right-0 mt-2 w-52 bg-white dark:bg-slate-900 border border-gray-100 dark:border-slate-700 rounded-2xl shadow-xl z-50 overflow-hidden animate-in fade-in slide-in-from-top-2 duration-200">
                <button onClick={() => { fileInputRef.current?.click(); setMenuOpen(false); }} disabled={importing}
                  className="flex items-center gap-3 w-full px-4 py-3 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-slate-800 transition-colors disabled:opacity-50">
                  <Upload className="w-4 h-4 text-rose-500" /> Import Excel
                </button>
                <div className="h-px bg-gray-100 dark:bg-slate-800" />
                <button onClick={() => { handleDownloadSample(); setMenuOpen(false); }}
                  className="flex items-center gap-3 w-full px-4 py-3 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-slate-800 transition-colors">
                  <FileDown className="w-4 h-4 text-emerald-500" /> Download Sample
                </button>
                <div className="h-px bg-gray-100 dark:bg-slate-800" />
                <button onClick={() => { handleExport(); setMenuOpen(false); }}
                  className="flex items-center gap-3 w-full px-4 py-3 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-slate-800 transition-colors">
                  <Download className="w-4 h-4 text-blue-500" /> Export Excel
                </button>
                {canEdit && (
                  <>
                    <div className="h-px bg-gray-100 dark:bg-slate-800" />
                    <button onClick={() => { setIsDeleteAllOpen(true); setMenuOpen(false); }} disabled={deletingAll}
                      className="flex items-center gap-3 w-full px-4 py-3 text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors disabled:opacity-50">
                      <Trash2 className="w-4 h-4 text-red-500" /> Delete All
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {importProgress && (
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-gray-100 dark:border-slate-800 shadow-sm p-5">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin text-rose-600" />
              <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Import Progress</span>
            </div>
            <span className="text-sm font-semibold text-rose-600">{importProgress.percent}%</span>
          </div>
          <div className="w-full bg-gray-100 dark:bg-slate-700 rounded-full h-2.5">
            <div className="bg-rose-600 h-2.5 rounded-full transition-all duration-500 ease-out" style={{ width: `${importProgress.percent}%` }} />
          </div>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">{importProgress.message}</p>
        </div>
      )}

      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-gray-100 dark:border-slate-800 shadow-sm">
        <div className="p-4 border-b border-gray-100 dark:border-slate-800">
          <div className="flex items-center gap-3">
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input type="text" placeholder={t('rso_targets.search_placeholder')} value={search}
                onChange={e => { setSearch(e.target.value); setPage(1); }}
                className="w-full pl-10 pr-4 py-2 bg-gray-50 dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-xl text-sm focus:ring-2 focus:ring-rose-500 outline-none dark:text-gray-100" />
            </div>
            <button onClick={() => setFilterOpen(!filterOpen)}
              className={`p-2 rounded-xl border transition-colors ${
                filterOpen
                  ? "bg-rose-50 border-rose-200 text-rose-600 dark:bg-rose-500/10 dark:border-rose-800"
                  : "bg-white dark:bg-slate-900 border-gray-200 dark:border-slate-700 text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-slate-800"
              }`}
              title="Filters"
            >
              <SlidersHorizontal className="w-4 h-4" />
            </button>
          </div>
        </div>

        {filterOpen && (
          <div className="px-4 py-3 border-b border-gray-100 dark:border-slate-800 bg-gray-50/50 dark:bg-slate-800/30">
            <div className="flex items-end gap-4 flex-wrap">
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-gray-400 uppercase block">House</label>
                <select value={filters.house_id} onChange={e => { setFilters(f => ({...f, house_id: parseInt(e.target.value)})); setPage(1); }}
                  className="py-1.5 px-3 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-lg text-xs dark:text-gray-200 outline-none focus:border-rose-500/30 transition-all">
                  <option value={0} className="dark:bg-slate-800">All Houses</option>
                  {filterHouses.map(h => (
                    <option key={h.id} value={h.id} className="dark:bg-slate-800">{h.name} ({h.code})</option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-gray-400 uppercase block">Market Type</label>
                <select value={filters.market_type} onChange={e => { setFilters(f => ({...f, market_type: e.target.value})); setPage(1); }}
                  className="py-1.5 px-3 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-lg text-xs dark:text-gray-200 outline-none focus:border-rose-500/30 transition-all">
                  <option value="" className="dark:bg-slate-800">All</option>
                  <option value="Main House" className="dark:bg-slate-800">Main House</option>
                  <option value="OSDO" className="dark:bg-slate-800">OSDO</option>
                  <option value="Residential RSO" className="dark:bg-slate-800">Residential RSO</option>
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-gray-400 uppercase block">Target Month</label>
                <input type="month" value={filters.target_date} onChange={e => { setFilters(f => ({...f, target_date: e.target.value})); setPage(1); }}
                  className="py-1.5 px-3 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-lg text-xs dark:text-gray-200 outline-none focus:border-rose-500/30 transition-all" />
              </div>
              {(filters.house_id || filters.market_type || filters.target_date) && (
                <button onClick={() => { setFilters({ house_id: 0, market_type: "", target_date: "" }); setPage(1); }}
                  className="py-1.5 px-3 text-xs font-bold text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 rounded-lg transition-colors">
                  Clear
                </button>
              )}
            </div>
          </div>
        )}

        <div className="overflow-x-auto scrollbar-custom">
          <table className="w-full text-sm whitespace-nowrap">
            <thead>
              <tr className="border-b border-gray-100 dark:border-slate-800">
                <th className="text-left px-4 py-3 font-semibold text-gray-600 dark:text-gray-400 text-xs uppercase">House</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-600 dark:text-gray-400 text-xs uppercase">{t('rso_targets.table_rso')}</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-600 dark:text-gray-400 text-xs uppercase">{t('rso_targets.table_supervisor')}</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-600 dark:text-gray-400 text-xs uppercase">{t('rso_targets.table_ev_secondary')}</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-600 dark:text-gray-400 text-xs uppercase">{t('rso_targets.table_sc_secondary')}</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-600 dark:text-gray-400 text-xs uppercase">{t('rso_targets.table_recharge')}</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-600 dark:text-gray-400 text-xs uppercase">{t('rso_targets.table_ga')}</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-600 dark:text-gray-400 text-xs uppercase">{t('rso_targets.table_dsso')}</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-600 dark:text-gray-400 text-xs uppercase">{t('rso_targets.table_dso')}</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-600 dark:text-gray-400 text-xs uppercase">{t('rso_targets.table_dlso')}</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-600 dark:text-gray-400 text-xs uppercase">{t('rso_targets.table_route')}</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-600 dark:text-gray-400 text-xs uppercase">{t('rso_targets.table_date')}</th>
                {canEdit && <th className="text-right px-4 py-3 font-semibold text-gray-600 dark:text-gray-400 text-xs uppercase">{t('rso_targets.table_actions')}</th>}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i} className="animate-pulse">
                    {Array.from({ length: canEdit ? 13 : 12 }).map((__, j) => (
                      <td key={j} className="px-4 py-4">
                        <div className="h-4 bg-gray-200 dark:bg-slate-700 rounded-md" />
                      </td>
                    ))}
                  </tr>
                ))
              ) : data.length === 0 ? (
                <tr><td colSpan={canEdit ? 13 : 12} className="text-center py-12 text-gray-400">{t('rso_targets.no_data')}</td></tr>
              ) : data.map((r) => (
                <tr key={r.id} className="border-b border-gray-50 dark:border-slate-800/50 hover:bg-gray-50 dark:hover:bg-slate-800/50 transition-colors">
                  <td className="px-4 py-3">
                    <div className="font-medium text-gray-900 dark:text-gray-100">{r.house?.name || "-"}</div>
                    {r.house?.code && (
                      <div className="text-xs text-gray-400 mt-0.5">{r.house.code}</div>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="font-medium text-gray-900 dark:text-gray-100">{r.employee?.user?.name || r.employee?.dms_code || `#${r.employee_id}`}</div>
                    {r.employee?.dms_code && (
                      <div className="text-xs text-gray-400 mt-0.5">{r.employee.dms_code} • {r.employee.itop_number || ''}</div>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="font-medium text-gray-900 dark:text-gray-100">{r.supervisor?.user?.name || r.supervisor?.pool_number || "-"}</div>
                    {r.supervisor?.pool_number && (
                      <div className="text-xs text-gray-400 mt-0.5">{r.supervisor.pool_number}</div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-gray-600 dark:text-gray-400">{r.ev_secondary}</td>
                  <td className="px-4 py-3 text-gray-600 dark:text-gray-400">{r.sc_secondary}</td>
                  <td className="px-4 py-3 text-gray-600 dark:text-gray-400">{r.total_recharge}</td>
                  <td className="px-4 py-3 text-gray-600 dark:text-gray-400">{r.ga}</td>
                  <td className="px-4 py-3 text-gray-600 dark:text-gray-400">{r.dsso}</td>
                  <td className="px-4 py-3 text-gray-600 dark:text-gray-400">{r.dso}</td>
                  <td className="px-4 py-3 text-gray-600 dark:text-gray-400">{r.dlso}</td>
                  <td className="px-4 py-3 text-gray-600 dark:text-gray-400">{r.service_route || "-"}</td>
                  <td className="px-4 py-3 text-gray-600 dark:text-gray-400">{r.target_date ? new Date(r.target_date).toLocaleDateString() : "-"}</td>
                  {canEdit && (
                    <td className="px-4 py-3 text-right">
                      <div className="flex justify-end gap-1">
                        <button onClick={() => openEditModal(r)} className="p-2 hover:bg-primary-50 dark:hover:bg-primary-500/10 rounded-xl text-gray-400 hover:text-primary-600 transition-all" title="Edit">
                          <Edit2 className="w-4 h-4" />
                        </button>
                        <button onClick={() => handleDeleteClick(r.id)} className="p-2 hover:bg-red-50 dark:hover:bg-red-500/10 rounded-xl text-gray-400 hover:text-red-600 transition-all" title="Delete">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {totalRecords > 0 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100 dark:border-slate-800">
            <span className="text-xs text-gray-400">
              {t('rso_targets.showing_results', { start: (page - 1) * perPage + 1, end: Math.min(page * perPage, totalRecords), total: totalRecords })}
            </span>
            <div className="flex items-center gap-3">
              <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
                className="flex items-center gap-1 px-3 py-1.5 text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-slate-800 rounded-lg disabled:opacity-50 transition-colors">
                <ChevronLeft className="w-3.5 h-3.5" /> Prev
              </button>
              <button onClick={() => setPage(p => p + 1)} disabled={page >= totalPages}
                className="flex items-center gap-1 px-3 py-1.5 text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-slate-800 rounded-lg disabled:opacity-50 transition-colors">
                Next <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}
      </div>

      {isFormModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-0 md:p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-300">
          <div className="bg-white dark:bg-slate-900 w-full max-w-3xl h-full md:h-auto md:max-h-[90vh] md:rounded-3xl shadow-2xl overflow-hidden flex flex-col animate-in zoom-in-95 duration-200">
            <div className="p-6 border-b border-gray-50 dark:border-slate-800 flex items-center justify-between flex-shrink-0">
              <div>
                <h3 className="text-xl font-bold text-gray-900 dark:text-gray-100">
                  {editingItem ? t('rso_targets.modal_edit_title') : t('rso_targets.modal_create_title')}
                </h3>
                <p className="text-xs text-gray-500 dark:text-gray-400">{t('rso_targets.modal_subtitle')}</p>
              </div>
              <button onClick={() => setIsFormModalOpen(false)}
                className="p-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 rounded-xl bg-gray-50 dark:bg-slate-800 transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleFormSubmit} className="flex-1 overflow-y-auto p-6 scrollbar-hide">
              {formError && (
                <div className="mb-6 flex items-start gap-3 p-4 bg-red-50 dark:bg-red-500/10 border border-red-100 dark:border-red-800 rounded-2xl">
                  <AlertCircle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
                  <p className="text-sm text-red-600 dark:text-red-400">{formError}</p>
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-4">
                  <h4 className="text-xs font-bold text-primary-600 uppercase tracking-widest">House, RSO & Date</h4>
                  <div className="space-y-3">
                    <div className="space-y-1.5">
                      <label className="block text-[11px] font-bold text-gray-600 dark:text-gray-400 uppercase tracking-wider ml-1">
                        {t('house_targets.field_house')} <span className="text-red-500">*</span>
                      </label>
                      <select value={formData.house_id} onChange={e => { const h = parseInt(e.target.value); setFormData({...formData, house_id: h, employee_id: 0, supervisor_id: 0}); if (h) { fetchRsoList(h, formData.target_date); fetchSupervisorList(h); } }}
                        className="w-full py-3 px-4 bg-gray-50 dark:bg-slate-800 border border-transparent rounded-2xl text-sm dark:text-gray-100 outline-none focus:border-primary-500/30 transition-all">
                        <option value={0} className="dark:bg-slate-800 dark:text-gray-400">{t('house_targets.field_house_placeholder')}</option>
                        {houses.map(h => (
                          <option key={h.id} value={h.id} className="dark:bg-slate-800 dark:text-gray-100">{h.name} ({h.code})</option>
                        ))}
                      </select>
                      {fieldErrors.house_id && <p className="text-[10px] text-red-500 font-bold ml-1">{fieldErrors.house_id}</p>}
                    </div>
                    <div className="space-y-1.5">
                      <label className="block text-[11px] font-bold text-gray-600 dark:text-gray-400 uppercase tracking-wider ml-1">
                        {t('rso_targets.field_employee')} <span className="text-red-500">*</span>
                      </label>
                      <select value={formData.employee_id} onChange={e => setFormData({...formData, employee_id: parseInt(e.target.value)})}
                        className="w-full py-3 px-4 bg-gray-50 dark:bg-slate-800 border border-transparent rounded-2xl text-sm dark:text-gray-100 outline-none focus:border-primary-500/30 transition-all">
                        <option value={0} className="dark:bg-slate-800 dark:text-gray-400">{t('rso_targets.field_employee_placeholder')}</option>
                        {rsoList.map(r => (
                          <option key={r.id} value={r.id} className="dark:bg-slate-800 dark:text-gray-100">{r.name || r.dms_code} ({r.itop_number})</option>
                        ))}
                      </select>
                      {fieldErrors.employee_id && <p className="text-[10px] text-red-500 font-bold ml-1">{fieldErrors.employee_id}</p>}
                    </div>
                    <div className="space-y-1.5">
                      <label className="block text-[11px] font-bold text-gray-600 dark:text-gray-400 uppercase tracking-wider ml-1">
                        {t('rso_targets.field_supervisor')}
                      </label>
                      <select value={formData.supervisor_id} onChange={e => setFormData({...formData, supervisor_id: parseInt(e.target.value)})}
                        disabled={!formData.house_id}
                        className="w-full py-3 px-4 bg-gray-50 dark:bg-slate-800 border border-transparent rounded-2xl text-sm dark:text-gray-100 outline-none focus:border-primary-500/30 transition-all disabled:opacity-50 disabled:cursor-not-allowed">
                        <option value={0} className="dark:bg-slate-800 dark:text-gray-400">{t('rso_targets.field_supervisor_placeholder')}</option>
                        {supervisorList.map(s => (
                          <option key={s.id ?? s.user_id} value={s.id ?? 0} className="dark:bg-slate-800 dark:text-gray-100">
                            {s.name || s.pool_number || s.employee_id}{s.pool_number ? ` (${s.pool_number})` : ""}
                          </option>
                        ))}
                      </select>
                      {fieldErrors.supervisor_id && <p className="text-[10px] text-red-500 font-bold ml-1">{fieldErrors.supervisor_id}</p>}
                    </div>
                    <InputField label={t('rso_targets.field_target_date')} type="month" required
                      value={formData.target_date}
                      onChange={v => {
                        setFormData({...formData, target_date: v, employee_id: 0});
                        if (formData.house_id && !editingItem) fetchRsoList(formData.house_id, v);
                      }}
                      leftIcon={Crosshair}
                      error={fieldErrors.target_date} />
                  </div>

                  <h4 className="text-xs font-bold text-rose-600 uppercase tracking-widest pt-2">EV & SC Targets</h4>
                  <div className="grid grid-cols-2 gap-3">
                    <InputField label={t('rso_targets.field_ev_secondary')} type="number" required
                      value={formData.ev_secondary}
                      onChange={v => {
                        const ev = parseFloat(v) || 0;
                        const sc = parseFloat(formData.sc_secondary) || 0;
                        setFormData({...formData, ev_secondary: v, total_recharge: String(ev + sc)});
                      }}
                      placeholder={t('rso_targets.field_ev_secondary_placeholder')}
                      error={fieldErrors.ev_secondary} />
                    <InputField label={t('rso_targets.field_sc_secondary')} type="number" required
                      value={formData.sc_secondary}
                      onChange={v => {
                        const ev = parseFloat(formData.ev_secondary) || 0;
                        const sc = parseFloat(v) || 0;
                        setFormData({...formData, sc_secondary: v, total_recharge: String(ev + sc)});
                      }}
                      placeholder={t('rso_targets.field_sc_secondary_placeholder')}
                      error={fieldErrors.sc_secondary} />
                  </div>
                  <InputField label={t('rso_targets.field_total_recharge')} type="number" disabled
                    value={formData.total_recharge}
                    onChange={() => {}}
                    placeholder={t('rso_targets.field_total_recharge_placeholder')} />
                </div>

                <div className="space-y-4">
                  <h4 className="text-xs font-bold text-purple-600 uppercase tracking-widest">GA & Channel Targets</h4>
                  <div className="grid grid-cols-2 gap-3">
                    <InputField label={t('rso_targets.field_ga')} type="number" required
                      value={formData.ga}
                      onChange={v => setFormData({...formData, ga: v})}
                      placeholder={t('rso_targets.field_ga_placeholder')}
                      error={fieldErrors.ga} />
                  </div>

                  <h4 className="text-xs font-bold text-blue-600 uppercase tracking-widest pt-2">SO Targets</h4>
                  <div className="grid grid-cols-2 gap-3">
                    <InputField label={t('rso_targets.field_sso')} type="number"
                      value={formData.sso}
                      onChange={v => setFormData({...formData, sso: v})}
                      placeholder={t('rso_targets.field_sso_placeholder')}
                      error={fieldErrors.sso} />
                    <InputField label={t('rso_targets.field_lso')} type="number"
                      value={formData.lso}
                      onChange={v => setFormData({...formData, lso: v})}
                      placeholder={t('rso_targets.field_lso_placeholder')}
                      error={fieldErrors.lso} />
                    <InputField label={t('rso_targets.field_bso')} type="number"
                      value={formData.bso}
                      onChange={v => setFormData({...formData, bso: v})}
                      placeholder={t('rso_targets.field_bso_placeholder')}
                      error={fieldErrors.bso} />
                    <InputField label={t('rso_targets.field_ddso')} type="number"
                      value={formData.ddso}
                      onChange={v => setFormData({...formData, ddso: v})}
                      placeholder={t('rso_targets.field_ddso_placeholder')}
                      error={fieldErrors.ddso} />
                    <InputField label={t('rso_targets.field_dsso')} type="number"
                      value={formData.dsso}
                      onChange={v => setFormData({...formData, dsso: v})}
                      placeholder={t('rso_targets.field_dsso_placeholder')}
                      error={fieldErrors.dsso} />
                    <InputField label={t('rso_targets.field_dso')} type="number"
                      value={formData.dso}
                      onChange={v => setFormData({...formData, dso: v})}
                      placeholder={t('rso_targets.field_dso_placeholder')}
                      error={fieldErrors.dso} />
                    <InputField label={t('rso_targets.field_dlso')} type="number"
                      value={formData.dlso}
                      onChange={v => setFormData({...formData, dlso: v})}
                      placeholder={t('rso_targets.field_dlso_placeholder')}
                      error={fieldErrors.dlso} />
                  </div>

                  <h4 className="text-xs font-bold text-emerald-600 uppercase tracking-widest pt-2">Route Info</h4>
                  <div className="grid grid-cols-1 gap-3">
                    <InputField label={t('rso_targets.field_service_route')} type="text"
                      value={formData.service_route}
                      onChange={v => setFormData({...formData, service_route: v})}
                      placeholder={t('rso_targets.field_service_route_placeholder')} />
                    <InputField label={t('rso_targets.field_market_type')} type="text"
                      value={formData.market_type}
                      onChange={v => setFormData({...formData, market_type: v})}
                      placeholder={t('rso_targets.field_market_type_placeholder')} />
                    <InputField label={t('rso_targets.field_thana_name')} type="text"
                      value={formData.thana_name}
                      onChange={v => setFormData({...formData, thana_name: v})}
                      placeholder={t('rso_targets.field_thana_name_placeholder')} />
                  </div>

                  <div className="pt-4 border-t border-gray-50 dark:border-slate-800">
                    <div className="flex items-center justify-between mb-3">
                      <h4 className="text-xs font-bold text-amber-600 uppercase tracking-widest">Additional Targets</h4>
                      <button type="button" onClick={() => setFormData({...formData, extra_targets: [...formData.extra_targets, {key: "", value: ""}]})}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-500/10 rounded-xl transition-colors">
                        <Plus className="w-3.5 h-3.5" /> Add
                      </button>
                    </div>
                    <div className="space-y-2">
                      {formData.extra_targets.map((et, i) => (
                        <div key={i} className="flex items-center gap-2">
                          <input type="text" placeholder="Target name"
                            value={et.key}
                            onChange={e => {
                              const arr = [...formData.extra_targets];
                              arr[i] = {...arr[i], key: e.target.value};
                              setFormData({...formData, extra_targets: arr});
                            }}
                            className="flex-1 py-2.5 px-3 bg-gray-50 dark:bg-slate-800/50 border border-transparent rounded-xl text-xs dark:text-gray-100 outline-none focus:border-amber-500/30 transition-all placeholder:text-gray-400" />
                          <input type="number" placeholder="Value"
                            value={et.value}
                            onChange={e => {
                              const arr = [...formData.extra_targets];
                              arr[i] = {...arr[i], value: e.target.value};
                              setFormData({...formData, extra_targets: arr});
                            }}
                            className="w-28 py-2.5 px-3 bg-gray-50 dark:bg-slate-800/50 border border-transparent rounded-xl text-xs dark:text-gray-100 outline-none focus:border-amber-500/30 transition-all placeholder:text-gray-400" />
                          <button type="button" onClick={() => setFormData({...formData, extra_targets: formData.extra_targets.filter((_, j) => j !== i)})}
                            className="p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 rounded-lg transition-colors">
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      ))}
                      {formData.extra_targets.length === 0 && (
                        <p className="text-xs text-gray-400 italic">No additional targets. Click &quot;Add&quot; to create one.</p>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              <div className="mt-10 pt-6 border-t border-gray-50 dark:border-slate-800 flex gap-4">
                <button type="button" onClick={() => setIsFormModalOpen(false)}
                  className="flex-1 py-3 text-sm font-bold text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-slate-800 rounded-2xl transition-all">
                  {t('rso_targets.btn_cancel')}
                </button>
                <button type="submit" disabled={formLoading}
                  className="flex-[2] py-3 bg-primary-600 text-white rounded-2xl text-sm font-bold hover:bg-primary-700 transition-all shadow-xl shadow-primary-200 dark:shadow-none flex items-center justify-center gap-2">
                  {formLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                  {editingItem ? t('rso_targets.btn_update') : t('rso_targets.btn_create')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <ConfirmationModal
        isOpen={isConfirmOpen}
        onClose={() => setIsConfirmOpen(false)}
        onConfirm={handleConfirmDelete}
        type="danger"
        title={t('rso_targets.delete_title')}
        message={t('rso_targets.delete_message')}
        confirmText={t('rso_targets.delete_confirm')}
        loading={formLoading}
      />

      <ConfirmationModal
        isOpen={isDeleteAllOpen}
        onClose={() => setIsDeleteAllOpen(false)}
        onConfirm={handleConfirmDeleteAll}
        type="danger"
        title="Delete All RSO Targets"
        message="Are you sure you want to delete all RSO targets? This action cannot be undone."
        confirmText={deletingAll ? "Deleting..." : "Delete All"}
        loading={deletingAll}
      />
    </div>
  );
}

function InputField({ label, value, onChange, placeholder, required = false, type = "text", disabled = false, leftIcon: Icon, error }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string; required?: boolean;
  type?: string; disabled?: boolean; leftIcon?: React.ComponentType<{ className?: string }>; error?: string;
}) {
  return (
    <div className="space-y-1.5">
      <label className="block text-[11px] font-bold text-gray-600 dark:text-gray-400 uppercase tracking-wider ml-1">
        {label} {required && <span className="text-red-500">*</span>}
      </label>
      <div className="relative group/input">
        {Icon && (
          <div className={`absolute left-4 top-1/2 -translate-y-1/2 transition-colors ${error ? "text-red-500" : "text-gray-400 group-focus-within/input:text-primary-500"}`}>
            <Icon className="w-4 h-4" />
          </div>
        )}
        <input
          type={type}
          required={required}
          disabled={disabled}
          className={`w-full py-3 bg-gray-50 dark:bg-slate-800/50 border transition-all dark:text-gray-100 outline-none disabled:opacity-50 rounded-2xl text-sm ${Icon ? "pl-11" : "pl-4"} pr-4 ${
            error ? "border-red-500/50 focus:border-red-500 ring-1 ring-red-500/10" : "border-transparent focus:border-primary-500/30"
          }`}
          placeholder={placeholder}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      </div>
      {error && <p className="text-[10px] text-red-500 font-bold ml-1 animate-in slide-in-from-top-1 duration-200">{error}</p>}
    </div>
  );
}
