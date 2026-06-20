"use client";

import { useEffect, useState, useRef } from "react";
import { useRouter } from "next/navigation";
import apiClient from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import {
  Search,
  MapPin,
  Signal,
  ChevronLeft,
  ChevronRight,
  Database,
  Upload,
  Loader2,
  Eye,
  X,
  Map as MapIcon,
  Trash2,
  FileDown,
  Plus,
} from "lucide-react";
import { useLanguage } from "@/i18n/useLanguage";
import { AccessDenied } from "@/components/ui/AccessDenied";
import { toast } from "react-hot-toast";

interface BTSData {
  id: number;
  site_id: string;
  bts_code: string;
  site_type: string;
  thana: string;
  thana_bn: string;
  district: string;
  district_bn: string;
  division: string;
  division_bn: string;
  cluster: string;
  cluster_bn: string;
  region: string;
  region_bn: string;
  network_mode: string;
  address: string;
  address_bn: string;
  short_address: string;
  short_address_bn: string;
  longitude: string;
  latitude: string;
  archetype: string;
  market: string;
  distributor_code: string;
  onair_date_2g: string;
  onair_date_3g: string;
  onair_date_4g: string;
  urban_rural: string;
  priority: string;
}

interface EligibleEntry {
  id: number;
  house_id: number;
  house_code: string | null;
  bts_id: number;
  bts: BTSData;
}

export default function EligibleBTSPage() {
  const { hasPermission, loading: authLoading } = useAuth();
  const router = useRouter();
  const { t } = useLanguage();
  const [entries, setEntries] = useState<EligibleEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const limit = 12;

  const [isImporting, setIsImporting] = useState(false);
  const [isClearing, setIsClearing] = useState(false);
  const [importProgress, setImportProgress] = useState(0);
  const [viewingEntry, setViewingEntry] = useState<EligibleEntry | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [showAttachModal, setShowAttachModal] = useState(false);
  const [attachHouseCode, setAttachHouseCode] = useState("");
  const [attachSearch, setAttachSearch] = useState("");
  const [availableBts, setAvailableBts] = useState<BTSData[]>([]);
  const [availableLoading, setAvailableLoading] = useState(false);
  const [attaching, setAttaching] = useState(false);

  useEffect(() => {
    if (!authLoading && !hasPermission("zoom_in.view")) {
      const timer = setTimeout(() => { router.push("/"); }, 5000);
      return () => clearTimeout(timer);
    }
  }, [authLoading, hasPermission, router]);

  const fetchEligibleBTS = async () => {
    setLoading(true);
    try {
      const params: Record<string, string> = {};
      if (search) params.search = search;
      const res = await apiClient.get("zoom-in/eligible-bts", { params });
      setEntries(res.data);
    } catch (err) {
      console.error("Failed to fetch eligible BTS", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!authLoading && hasPermission("zoom_in.view")) fetchEligibleBTS();
  }, [authLoading, hasPermission]);

  useEffect(() => {
    if (!authLoading && hasPermission("zoom_in.view")) {
      const timer = setTimeout(() => fetchEligibleBTS(), 400);
      return () => clearTimeout(timer);
    }
  }, [search, authLoading, hasPermission]);

  useEffect(() => {
    if (!showAttachModal || !attachHouseCode.trim()) { setAvailableBts([]); return; }
    const timer = setTimeout(async () => {
      setAvailableLoading(true);
      try {
        const params: Record<string, string> = { house_code: attachHouseCode.trim().toUpperCase() };
        if (attachSearch) params.search = attachSearch;
        const res = await apiClient.get("zoom-in/eligible-bts/available", { params });
        setAvailableBts(res.data);
      } catch { setAvailableBts([]); } finally { setAvailableLoading(false); }
    }, 300);
    return () => clearTimeout(timer);
  }, [attachSearch, attachHouseCode, showAttachModal]);

  const handleImportClick = () => fileInputRef.current?.click();

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsImporting(true);
    setImportProgress(20);
    const formData = new FormData();
    formData.append("file", file);
    try {
      setImportProgress(40);
      const response = await apiClient.post("zoom-in/eligible-bts/import", formData);
      setImportProgress(100);
      toast.success(response.data.message);
      fetchEligibleBTS();
    } catch (err: any) {
      const detail = err.response?.data?.detail;
      let msg = "Import failed";
      if (typeof detail === "string") msg = detail;
      else if (Array.isArray(detail)) msg = detail.map((e: any) => e.msg || "").filter(Boolean).join(", ");
      toast.error(msg);
    } finally {
      setTimeout(() => {
        setIsImporting(false);
        setImportProgress(0);
        if (fileInputRef.current) fileInputRef.current.value = "";
      }, 1000);
    }
  };

  const handleClear = async () => {
    if (!confirm(t('zoom_in.eligible_bts.messages.clear_confirm'))) return;
    setIsClearing(true);
    try {
      await apiClient.delete("zoom-in/eligible-bts");
      toast.success(t('zoom_in.eligible_bts.messages.clear_success'));
      setEntries([]);
    } catch (err) {
      toast.error("Failed to clear eligible BTS list");
    } finally { setIsClearing(false); }
  };

  const handleDownloadSample = async () => {
    try {
      const res = await apiClient.get("zoom-in/eligible-bts/sample", { responseType: "blob" });
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const a = document.createElement("a");
      a.href = url;
      a.download = "eligible_bts_sample.xlsx";
      a.click();
      window.URL.revokeObjectURL(url);
    } catch { toast.error("Sample download failed"); }
  };

  const handleAttach = async (btsCode: string) => {
    if (!attachHouseCode.trim()) return;
    setAttaching(true);
    try {
      await apiClient.post("zoom-in/eligible-bts/attach", {
        house_code: attachHouseCode.trim().toUpperCase(),
        bts_code: btsCode,
      });
      toast.success(t('zoom_in.eligible_bts.messages.attach_success'));
      fetchEligibleBTS();
      fetchAvailableBts(attachHouseCode, attachSearch);
    } catch (err: any) {
      toast.error(err.response?.data?.detail || "Attach failed");
    } finally { setAttaching(false); }
  };

  const handleDetach = async (entryId: number) => {
    if (!confirm(t('zoom_in.eligible_bts.messages.detach_confirm'))) return;
    setDeletingId(entryId);
    try {
      await apiClient.delete(`zoom-in/eligible-bts/${entryId}`);
      toast.success(t('zoom_in.eligible_bts.messages.detach_success'));
      setEntries(prev => prev.filter(e => e.id !== entryId));
    } catch (err: any) {
      toast.error(err.response?.data?.detail || "Detach failed");
    } finally { setDeletingId(null); }
  };

  const filteredList = entries;
  const paginatedList = filteredList.slice(page * limit, (page + 1) * limit);
  const totalPages = Math.ceil(filteredList.length / limit);

  if (!authLoading && !hasPermission("zoom_in.view")) return <AccessDenied />;

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">{t('zoom_in.eligible_bts.title')}</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{t('zoom_in.eligible_bts.description')}</p>
        </div>
        <div className="flex flex-wrap gap-3">
          <input type="file" ref={fileInputRef} onChange={handleFileChange} className="hidden" accept=".xlsx, .xls" />
          {hasPermission("zoom_in.create") && (
            <button
              onClick={() => { setAttachHouseCode(""); setAttachSearch(""); setAvailableBts([]); setShowAttachModal(true); }}
              className="inline-flex items-center justify-center gap-2 px-4 py-2 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 text-gray-700 dark:text-gray-200 rounded-lg text-sm font-bold hover:bg-primary-50 dark:hover:bg-primary-500/10 hover:text-primary-600 dark:hover:text-primary-400 transition-colors shadow-sm"
            >
              <Plus className="w-4 h-4" />
              {t('zoom_in.eligible_bts.attach')}
            </button>
          )}
          <button
            onClick={handleDownloadSample}
            className="inline-flex items-center justify-center gap-2 px-4 py-2 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 text-gray-700 dark:text-gray-200 rounded-lg text-sm font-bold hover:bg-amber-50 dark:hover:bg-amber-900/20 hover:text-amber-600 dark:hover:text-amber-400 transition-colors shadow-sm"
            title={t('zoom_in.eligible_bts.download_sample')}
          >
            <FileDown className="w-4 h-4" />
            {t('zoom_in.eligible_bts.download_sample')}
          </button>
          {hasPermission("zoom_in.import") && (
            <button onClick={handleImportClick} disabled={isImporting}
              className="inline-flex items-center justify-center gap-2 px-4 py-2 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 text-gray-700 dark:text-gray-200 rounded-lg text-sm font-bold hover:bg-gray-50 dark:hover:bg-slate-800 transition-colors shadow-sm disabled:opacity-50"
            >
              {isImporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
              {t('zoom_in.eligible_bts.import_list')}
            </button>
          )}
          {hasPermission("zoom_in.delete") && entries.length > 0 && (
            <button onClick={handleClear} disabled={isClearing}
              className="inline-flex items-center justify-center gap-2 px-4 py-2 bg-white dark:bg-slate-900 border border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 rounded-lg text-sm font-bold hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors shadow-sm disabled:opacity-50"
            >
              {isClearing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
              {t('zoom_in.eligible_bts.clear_list')}
            </button>
          )}
        </div>
      </div>

      {isImporting && (
        <div className="bg-white dark:bg-slate-900 p-6 rounded-2xl border border-primary-100 dark:border-primary-500/20 shadow-xl animate-in slide-in-from-top-4 duration-300">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-primary-100 dark:bg-primary-500/20 rounded-xl text-primary-600">
                <Database className="w-5 h-5" />
              </div>
              <div>
                <h4 className="text-sm font-bold text-gray-900 dark:text-gray-100">{t('zoom_in.eligible_bts.import_processing')}</h4>
                <p className="text-xs text-gray-500 dark:text-gray-400">{t('zoom_in.eligible_bts.import_wait')}</p>
              </div>
            </div>
            <span className="text-sm font-black text-primary-600">{importProgress}%</span>
          </div>
          <div className="w-full h-2 bg-gray-100 dark:bg-slate-800 rounded-full overflow-hidden">
            <div className="h-full bg-primary-500 transition-all duration-500 ease-out shadow-[0_0_10px_rgba(249,115,22,0.5)]" style={{ width: `${importProgress}%` }} />
          </div>
        </div>
      )}

      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 dark:text-gray-500" />
          <input type="text" placeholder={t('zoom_in.eligible_bts.search_placeholder')}
            className="w-full pl-10 pr-4 py-2 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl text-sm focus:ring-2 focus:ring-primary-500 transition-all outline-none dark:text-gray-100"
            value={search} onChange={(e) => { setSearch(e.target.value); setPage(0); }}
          />
        </div>
        {search && (
          <button onClick={() => { setSearch(""); setPage(0); }}
            className="px-3 py-2 text-sm font-medium text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-slate-800 rounded-xl transition-colors"
          >{t('common.reset')}</button>
        )}
      </div>

      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
          {[1, 2, 3, 4, 5, 6, 7, 8].map(i => (
            <div key={i} className="h-48 bg-gray-100 dark:bg-slate-900 rounded-2xl animate-pulse" />
          ))}
        </div>
      ) : filteredList.length === 0 ? (
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-dashed border-gray-300 dark:border-slate-800 p-20 text-center">
          <Database className="w-12 h-12 text-gray-300 dark:text-gray-700 mx-auto mb-4" />
          <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100">{t('zoom_in.eligible_bts.no_data')}</h3>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{t('zoom_in.eligible_bts.no_data_hint')}</p>
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <button onClick={() => { setAttachHouseCode(""); setAttachSearch(""); setAvailableBts([]); setShowAttachModal(true); }}
              className="inline-flex items-center justify-center gap-2 px-5 py-2.5 bg-primary-50 dark:bg-primary-500/10 border border-primary-200 dark:border-primary-500/20 text-primary-700 dark:text-primary-300 rounded-xl text-sm font-bold hover:bg-primary-100 dark:hover:bg-primary-500/20 transition-colors"
            >
              <Plus className="w-4 h-4" />
              {t('zoom_in.eligible_bts.attach')}
            </button>
            <button onClick={handleDownloadSample}
              className="inline-flex items-center justify-center gap-2 px-5 py-2.5 bg-gray-50 dark:bg-slate-800 border border-gray-200 dark:border-slate-700 text-gray-600 dark:text-gray-300 rounded-xl text-sm font-bold hover:bg-gray-100 dark:hover:bg-slate-700 transition-colors"
            >
              <FileDown className="w-4 h-4" />
              {t('zoom_in.eligible_bts.download_sample')}
            </button>
          </div>
        </div>
      ) : (
        <>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            {t('zoom_in.eligible_bts.showing_count', { count: filteredList.length })}
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
            {paginatedList.map((entry) => {
              const b = entry.bts;
              return (
                <div key={entry.id} className="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-gray-100 dark:border-slate-800 shadow-sm hover:shadow-md dark:hover:shadow-primary-500/5 transition-all group duration-300">
                  <div className="flex justify-between items-start mb-4">
                    <div className="flex items-center gap-3">
                      <div className="w-12 h-12 bg-primary-50 dark:bg-primary-500/10 rounded-xl flex items-center justify-center text-primary-600 dark:text-primary-400 group-hover:bg-primary-600 group-hover:text-white transition-colors duration-300">
                        <Signal className="w-6 h-6" />
                      </div>
                      <div>
                        <p className="text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-widest">{entry.house_code || `#${entry.house_id}`}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      <button onClick={() => setViewingEntry(entry)}
                        className="p-1.5 text-gray-400 dark:text-gray-500 hover:text-primary-500 hover:bg-primary-50 dark:hover:bg-primary-500/10 rounded-lg transition-colors"
                        title={t('zoom_in.eligible_bts.view_details')}
                      ><Eye className="w-4 h-4" /></button>
                      {hasPermission("zoom_in.delete") && (
                        <button onClick={() => handleDetach(entry.id)} disabled={deletingId === entry.id}
                          className="p-1.5 text-gray-400 dark:text-gray-500 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 rounded-lg transition-colors disabled:opacity-50"
                          title={t('zoom_in.eligible_bts.detach')}
                        >{deletingId === entry.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <X className="w-4 h-4" />}</button>
                      )}
                    </div>
                  </div>

                  <h3 className="font-bold text-gray-900 dark:text-gray-100 group-hover:text-primary-600 dark:group-hover:text-primary-400 transition-colors duration-300">{b.bts_code}</h3>
                  <p className="text-xs font-mono text-gray-500 dark:text-gray-400 mt-1 bg-gray-50 dark:bg-slate-800 inline-block px-1.5 py-0.5 rounded">{b.short_address || b.address || "—"}</p>

                  <div className="mt-6 pt-4 border-t border-gray-50 dark:border-slate-800 space-y-3">
                    <div className="flex items-center justify-between text-xs text-gray-500 dark:text-gray-400">
                      <div className="flex items-center gap-1.5">
                        <MapPin className="w-3.5 h-3.5" />
                        {b.thana || "N/A"}
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className="font-mono">{b.distributor_code || "—"}</span>
                      </div>
                    </div>
                    <div className="flex items-center justify-between">
                      {b.latitude && b.longitude ? (
                        <a href={`https://www.google.com/maps?q=${b.latitude},${b.longitude}`} target="_blank" rel="noopener noreferrer"
                          className="flex items-center gap-1 text-[10px] font-bold text-primary-600 dark:text-primary-400 hover:underline"
                        ><MapIcon className="w-3 h-3" />{t('zoom_in.eligible_bts.view_on_map')}</a>
                      ) : <span />}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {!loading && filteredList.length > 0 && (
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4 mt-8">
          <p className="text-xs text-gray-500 dark:text-gray-400">
            {t('zoom_in.eligible_bts.showing_results', {
              start: filteredList.length === 0 ? 0 : (page * limit) + 1,
              end: Math.min((page + 1) * limit, filteredList.length),
              total: filteredList.length,
            })}
          </p>
          <div className="flex items-center gap-4">
            <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}
              className="flex items-center gap-1 px-4 py-2 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-lg text-sm font-medium text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-slate-800 disabled:opacity-50"
            ><ChevronLeft className="w-4 h-4" />{t('common.prev')}</button>
            <span className="text-sm font-bold text-gray-900 dark:text-gray-100">{t('zoom_in.eligible_bts.page_info', { number: page + 1 })}</span>
            <button onClick={() => setPage(p => p + 1)} disabled={paginatedList.length < limit}
              className="flex items-center gap-1 px-4 py-2 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-lg text-sm font-medium text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-slate-800 disabled:opacity-50"
            >{t('common.next')}<ChevronRight className="w-4 h-4" /></button>
          </div>
        </div>
      )}

      {viewingEntry && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] overflow-y-auto mx-4 animate-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between p-6 border-b border-gray-100 dark:border-slate-800">
              <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">
                <Signal className="w-5 h-5 text-primary-500" />
                {viewingEntry.bts.site_id}
                <span className="text-sm font-mono text-gray-400 font-normal">#{viewingEntry.bts.bts_code}</span>
                {viewingEntry.house_code && <span className="text-xs font-bold text-gray-400 bg-gray-100 dark:bg-slate-800 px-2 py-0.5 rounded">{viewingEntry.house_code}</span>}
              </h2>
              <button onClick={() => setViewingEntry(null)}
                className="p-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-slate-800 rounded-xl transition-colors"
              ><X className="w-5 h-5" /></button>
            </div>
            <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-4">
              <Field label="SITE ID" value={viewingEntry.bts.site_id} />
              <Field label="BTS CODE" value={viewingEntry.bts.bts_code} />
              <Field label={t('zoom_in.eligible_bts.site_type')} value={viewingEntry.bts.site_type} />
              <Field label={t('zoom_in.eligible_bts.thana')} value={viewingEntry.bts.thana} />
              <Field label="Thana (BN)" value={viewingEntry.bts.thana_bn} />
              <Field label="District" value={viewingEntry.bts.district} />
              <Field label="District (BN)" value={viewingEntry.bts.district_bn} />
              <Field label="Division" value={viewingEntry.bts.division} />
              <Field label="Division (BN)" value={viewingEntry.bts.division_bn} />
              <Field label="Cluster" value={viewingEntry.bts.cluster} />
              <Field label="Cluster (BN)" value={viewingEntry.bts.cluster_bn} />
              <Field label="Region" value={viewingEntry.bts.region} />
              <Field label="Region (BN)" value={viewingEntry.bts.region_bn} />
              <Field label="Network Mode" value={viewingEntry.bts.network_mode} />
              <Field label="Archetype" value={viewingEntry.bts.archetype} />
              <Field label="Market" value={viewingEntry.bts.market} />
              <Field label="Distributor Code" value={viewingEntry.bts.distributor_code} />
              <Field label="Urban/Rural" value={viewingEntry.bts.urban_rural} />
              <Field label="Priority" value={viewingEntry.bts.priority} />
              <Field label="2G On Air" value={viewingEntry.bts.onair_date_2g} />
              <Field label="3G On Air" value={viewingEntry.bts.onair_date_3g} />
              <Field label="4G On Air" value={viewingEntry.bts.onair_date_4g} />
              <Field label="Longitude" value={viewingEntry.bts.longitude} />
              <Field label="Latitude" value={viewingEntry.bts.latitude} />
              <Field label={t('zoom_in.eligible_bts.short_address')} value={viewingEntry.bts.short_address} className="md:col-span-2" />
              <Field label="Short Address (BN)" value={viewingEntry.bts.short_address_bn} className="md:col-span-2" />
              <Field label="Address" value={viewingEntry.bts.address} className="md:col-span-2" />
              <Field label="Address (BN)" value={viewingEntry.bts.address_bn} className="md:col-span-2" />
            </div>
            <div className="p-6 pt-0 flex justify-end">
              <button onClick={() => setViewingEntry(null)}
                className="px-6 py-2.5 bg-gray-100 dark:bg-slate-800 text-gray-700 dark:text-gray-200 rounded-xl text-sm font-bold hover:bg-gray-200 dark:hover:bg-slate-700 transition-colors"
              >{t('zoom_in.eligible_bts.btn_close')}</button>
            </div>
          </div>
        </div>
      )}

      {showAttachModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl w-full max-w-lg max-h-[80vh] flex flex-col mx-4 animate-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between p-6 border-b border-gray-100 dark:border-slate-800">
              <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">{t('zoom_in.eligible_bts.attach')}</h2>
              <button onClick={() => setShowAttachModal(false)}
                className="p-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-slate-800 rounded-xl transition-colors"
              ><X className="w-5 h-5" /></button>
            </div>
            <div className="p-6 space-y-4 flex-1 overflow-y-auto">
              <div>
                <label className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-widest mb-1.5 block">{t('zoom_in.eligible_bts.house_code')}</label>
                <input type="text" value={attachHouseCode} onChange={e => { setAttachHouseCode(e.target.value.toUpperCase()); setAttachSearch(""); setAvailableBts([]); }}
                  placeholder="e.g. MYMVAI01"
                  className="w-full px-4 py-2.5 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl text-sm focus:ring-2 focus:ring-primary-500 transition-all outline-none dark:text-gray-100"
                />
              </div>
              {attachHouseCode.trim() && (
                <div>
                  <label className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-widest mb-1.5 block">{t('zoom_in.eligible_bts.search_bts')}</label>
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                    <input type="text" value={attachSearch} onChange={e => setAttachSearch(e.target.value)}
                      placeholder={t('zoom_in.eligible_bts.search_placeholder')}
                      className="w-full pl-10 pr-4 py-2.5 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl text-sm focus:ring-2 focus:ring-primary-500 transition-all outline-none dark:text-gray-100"
                    />
                  </div>
                </div>
              )}
              <div className="max-h-60 overflow-y-auto space-y-1">
                {availableLoading ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="w-5 h-5 animate-spin text-gray-400" />
                  </div>
                ) : availableBts.length === 0 && attachHouseCode.trim() ? (
                  <p className="text-sm text-gray-400 text-center py-6">{t('zoom_in.eligible_bts.no_available_bts')}</p>
                ) : (
                  availableBts.map(b => (
                    <button key={b.id} onClick={() => handleAttach(b.bts_code)} disabled={attaching}
                      className="w-full flex items-center justify-between p-3 rounded-xl hover:bg-primary-50 dark:hover:bg-primary-500/10 border border-transparent hover:border-primary-200 dark:hover:border-primary-500/20 transition-all group disabled:opacity-50 text-left"
                    >
                      <div>
                        <p className="text-sm font-bold text-gray-900 dark:text-gray-100 group-hover:text-primary-600 dark:group-hover:text-primary-400">{b.bts_code}</p>
                        <p className="text-xs text-gray-500 dark:text-gray-400">{b.site_id} — {b.thana || "N/A"}</p>
                      </div>
                      <Plus className="w-4 h-4 text-gray-400 group-hover:text-primary-500 shrink-0" />
                    </button>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Field({ label, value, className = "" }: { label: string; value?: string | null; className?: string }) {
  return (
    <div className={className}>
      <p className="text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-widest mb-0.5">{label}</p>
      <p className="text-sm font-medium text-gray-800 dark:text-gray-200 break-words">{value || "—"}</p>
    </div>
  );
}
