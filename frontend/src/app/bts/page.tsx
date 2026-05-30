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
  Download,
  Loader2,
  Eye,
  X,
  Map as MapIcon,
  Filter
} from "lucide-react";
import { useLanguage } from "@/i18n/useLanguage";
import { AccessDenied } from "@/components/ui/AccessDenied";
import { toast } from "react-hot-toast";

interface BTS {
  id: number;
  house_id: number;
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

interface House {
  id: number;
  name: string;
  code: string;
}

export default function BTSPage() {
  const { hasPermission, loading: authLoading } = useAuth();
  const router = useRouter();
  const { t } = useLanguage();
  const [btsList, setBtsList] = useState<BTS[]>([]);
  const [houses, setHouses] = useState<House[]>([]);
  const [thanas, setThanas] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [filterHouse, setFilterHouse] = useState("");
  const [filterThana, setFilterThana] = useState("");
  const limit = 12;

  const [isImporting, setIsImporting] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [importProgress, setImportProgress] = useState(0);
  const [viewingBTS, setViewingBTS] = useState<BTS | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!authLoading && !hasPermission("view_bts")) {
      const timer = setTimeout(() => {
        router.push("/");
      }, 5000);
      return () => clearTimeout(timer);
    }
  }, [authLoading, hasPermission, router]);

  const fetchBTS = async () => {
    setLoading(true);
    try {
      const params: Record<string, string> = {};
      if (search) params.search = search;
      if (filterHouse) params.filter_house_id = filterHouse;
      if (filterThana) params.thana = filterThana;
      params.limit = "10000";

      const [btsRes, houseRes, filterRes] = await Promise.all([
        apiClient.get("bts", { params }),
        apiClient.get("houses").catch(() => ({ data: [] })),
        apiClient.get("bts/filters", { params: filterHouse ? { filter_house_id: filterHouse } : {} }).catch(() => ({ data: { thanas: [] } }))
      ]);
      setBtsList(btsRes.data);
      setHouses(houseRes.data);
      setThanas(filterRes.data.thanas || []);
    } catch (err) {
      console.error("Failed to fetch BTS", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!authLoading && hasPermission("view_bts")) {
      fetchBTS();
    }
  }, [filterHouse, filterThana, authLoading, hasPermission]);

  useEffect(() => {
    if (!authLoading && hasPermission("view_bts")) {
      const timer = setTimeout(() => fetchBTS(), 400);
      return () => clearTimeout(timer);
    }
  }, [search, authLoading, hasPermission]);

  const handleImportClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsImporting(true);
    setImportProgress(20);
    const importData = new FormData();
    importData.append("file", file);

    try {
      setImportProgress(40);
      const response = await apiClient.post("bts/import", importData);
      setImportProgress(100);
      toast.success(response.data.message);
      fetchBTS();
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

  const handleExport = async () => {
    setIsExporting(true);
    try {
      const response = await apiClient.get("bts/export", { responseType: 'blob' });
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', 'bts_stations.xlsx');
      document.body.appendChild(link);
      link.click();
      toast.success(t('bts.toast_export_success'));
    } catch (err) {
      toast.error(t('bts.toast_export_failed'));
    } finally {
      setIsExporting(false);
    }
  };

  const paginatedList = btsList.slice(page * limit, (page + 1) * limit);
  const totalPages = Math.ceil(btsList.length / limit);

  if (!authLoading && !hasPermission("view_bts")) {
    return <AccessDenied />;
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">{t('bts.title')}</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{t('bts.description')}</p>
        </div>
        <div className="flex flex-wrap gap-3">
          <input type="file" ref={fileInputRef} onChange={handleFileChange} className="hidden" accept=".xlsx, .xls" />
          <button
            onClick={handleImportClick}
            disabled={isImporting}
            className="inline-flex items-center justify-center gap-2 px-4 py-2 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 text-gray-700 dark:text-gray-200 rounded-lg text-sm font-bold hover:bg-gray-50 dark:hover:bg-slate-800 transition-colors shadow-sm disabled:opacity-50"
          >
            {isImporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
            {t('bts.import_list')}
          </button>
          <button
            onClick={handleExport}
            disabled={isExporting}
            className="inline-flex items-center justify-center gap-2 px-4 py-2 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 text-gray-700 dark:text-gray-200 rounded-lg text-sm font-bold hover:bg-gray-50 dark:hover:bg-slate-800 transition-colors shadow-sm"
          >
            {isExporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
            {t('bts.export_list')}
          </button>
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
                <h4 className="text-sm font-bold text-gray-900 dark:text-gray-100">{t('bts.import_processing')}</h4>
                <p className="text-xs text-gray-500 dark:text-gray-400">{t('bts.import_wait')}</p>
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
          <input
            type="text"
            placeholder={t('bts.search_placeholder')}
            className="w-full pl-10 pr-4 py-2 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl text-sm focus:ring-2 focus:ring-primary-500 transition-all outline-none dark:text-gray-100"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(0);
            }}
          />
        </div>
        <div className="relative">
          <Filter className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 dark:text-gray-500" />
          <select
            value={filterHouse}
            onChange={e => { setFilterHouse(e.target.value); setFilterThana(""); setPage(0); }}
            className="pl-9 pr-8 py-2 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl text-sm outline-none appearance-none cursor-pointer dark:text-gray-100 min-w-[160px]"
          >
            <option value="">{t('bts.all_houses')}</option>
            {houses.map(h => (
              <option key={h.id} value={h.id}>{h.name}</option>
            ))}
          </select>
        </div>
        <div className="relative">
          <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 dark:text-gray-500" />
          <select
            value={filterThana}
            onChange={e => { setFilterThana(e.target.value); setPage(0); }}
            className="pl-9 pr-8 py-2 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl text-sm outline-none appearance-none cursor-pointer dark:text-gray-100 min-w-[160px]"
          >
            <option value="">{t('bts.all_thanas')}</option>
            {thanas.map(th => (
              <option key={th} value={th}>{th}</option>
            ))}
          </select>
        </div>
        {(search || filterHouse || filterThana) && (
          <button
            onClick={() => { setSearch(""); setFilterHouse(""); setFilterThana(""); setPage(0); }}
            className="px-3 py-2 text-sm font-medium text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-slate-800 rounded-xl transition-colors"
          >
            {t('common.reset')}
          </button>
        )}
      </div>

      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
          {[1, 2, 3, 4, 5, 6, 7, 8].map(i => (
            <div key={i} className="h-48 bg-gray-100 dark:bg-slate-900 rounded-2xl animate-pulse"></div>
          ))}
        </div>
      ) : btsList.length === 0 ? (
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-dashed border-gray-300 dark:border-slate-800 p-20 text-center">
          <Database className="w-12 h-12 text-gray-300 dark:text-gray-700 mx-auto mb-4" />
          <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100">{t('bts.no_stations')}</h3>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{t('bts.no_stations_hint')}</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
          {paginatedList.map((s) => (
            <div key={s.id} className="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-gray-100 dark:border-slate-800 shadow-sm hover:shadow-md dark:hover:shadow-primary-500/5 transition-all group duration-300">
              <div className="flex justify-between items-start mb-4">
                <div className="w-12 h-12 bg-primary-50 dark:bg-primary-500/10 rounded-xl flex items-center justify-center text-primary-600 dark:text-primary-400 group-hover:bg-primary-600 group-hover:text-white transition-colors duration-300">
                  <Signal className="w-6 h-6" />
                </div>
                <button
                  onClick={() => setViewingBTS(s)}
                  className="p-1.5 text-gray-400 dark:text-gray-500 hover:text-primary-500 hover:bg-primary-50 dark:hover:bg-primary-500/10 rounded-lg transition-colors"
                  title={t('bts.view_details')}
                >
                  <Eye className="w-4 h-4" />
                </button>
              </div>

              <h3 className="font-bold text-gray-900 dark:text-gray-100 group-hover:text-primary-600 dark:group-hover:text-primary-400 transition-colors duration-300">{s.bts_code}</h3>
              <p className="text-xs font-mono text-gray-500 dark:text-gray-400 mt-1 bg-gray-50 dark:bg-slate-800 inline-block px-1.5 py-0.5 rounded">{s.address || s.short_address || "—"}</p>

              <div className="mt-6 pt-4 border-t border-gray-50 dark:border-slate-800 space-y-3">
                <div className="flex items-center justify-between text-xs text-gray-500 dark:text-gray-400">
                  <div className="flex items-center gap-1.5">
                    <MapPin className="w-3.5 h-3.5" />
                    {s.thana || "N/A"}
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="font-mono">{s.distributor_code || "—"}</span>
                  </div>
                </div>
                <div className="flex items-center justify-between">
                  {s.latitude && s.longitude ? (
                    <a
                      href={`https://www.google.com/maps?q=${s.latitude},${s.longitude}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1 text-[10px] font-bold text-primary-600 dark:text-primary-400 hover:underline"
                    >
                      <MapIcon className="w-3 h-3" />
                      {t('bts.view_on_map')}
                    </a>
                  ) : (
                    <span />
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {!loading && btsList.length > 0 && (
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4 mt-8">
          <p className="text-xs text-gray-500 dark:text-gray-400">
            {t('bts.showing_results', {
              start: btsList.length === 0 ? 0 : (page * limit) + 1,
              end: Math.min((page + 1) * limit, btsList.length),
              total: btsList.length
            })}
          </p>
          <div className="flex items-center gap-4">
            <button
              onClick={() => setPage(p => Math.max(0, p - 1))}
              disabled={page === 0}
              className="flex items-center gap-1 px-4 py-2 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-lg text-sm font-medium text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-slate-800 disabled:opacity-50"
            >
              <ChevronLeft className="w-4 h-4" />
              {t('common.prev')}
            </button>
            <span className="text-sm font-bold text-gray-900 dark:text-gray-100">{t('bts.page_info', { number: page + 1 })}</span>
            <button
              onClick={() => setPage(p => p + 1)}
              disabled={paginatedList.length < limit}
              className="flex items-center gap-1 px-4 py-2 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-lg text-sm font-medium text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-slate-800 disabled:opacity-50"
            >
              {t('common.next')}
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {viewingBTS && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] overflow-y-auto mx-4 animate-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between p-6 border-b border-gray-100 dark:border-slate-800">
              <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">
                <Signal className="w-5 h-5 text-primary-500" />
                {viewingBTS.site_id}
                <span className="text-sm font-mono text-gray-400 font-normal">#{viewingBTS.bts_code}</span>
              </h2>
              <button
                onClick={() => setViewingBTS(null)}
                className="p-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-slate-800 rounded-xl transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-4">
              <Field label="SITE ID" value={viewingBTS.site_id} />
              <Field label="BTS CODE" value={viewingBTS.bts_code} />
              <Field label={t('bts.site_type')} value={viewingBTS.site_type} />
              <Field label={t('bts.thana')} value={viewingBTS.thana} />
              <Field label="Thana (BN)" value={viewingBTS.thana_bn} />
              <Field label="District" value={viewingBTS.district} />
              <Field label="District (BN)" value={viewingBTS.district_bn} />
              <Field label="Division" value={viewingBTS.division} />
              <Field label="Division (BN)" value={viewingBTS.division_bn} />
              <Field label="Cluster" value={viewingBTS.cluster} />
              <Field label="Cluster (BN)" value={viewingBTS.cluster_bn} />
              <Field label="Region" value={viewingBTS.region} />
              <Field label="Region (BN)" value={viewingBTS.region_bn} />
              <Field label="Network Mode" value={viewingBTS.network_mode} />
              <Field label="Archetype" value={viewingBTS.archetype} />
              <Field label="Market" value={viewingBTS.market} />
              <Field label="Distributor Code" value={viewingBTS.distributor_code} />
              <Field label="Urban/Rural" value={viewingBTS.urban_rural} />
              <Field label="Priority" value={viewingBTS.priority} />
              <Field label="2G On Air" value={viewingBTS.onair_date_2g} />
              <Field label="3G On Air" value={viewingBTS.onair_date_3g} />
              <Field label="4G On Air" value={viewingBTS.onair_date_4g} />
              <Field label="Longitude" value={viewingBTS.longitude} />
              <Field label="Latitude" value={viewingBTS.latitude} />
              <Field label={t('bts.short_address')} value={viewingBTS.short_address} className="md:col-span-2" />
              <Field label="Short Address (BN)" value={viewingBTS.short_address_bn} className="md:col-span-2" />
              <Field label="Address" value={viewingBTS.address} className="md:col-span-2" />
              <Field label="Address (BN)" value={viewingBTS.address_bn} className="md:col-span-2" />
            </div>
            <div className="p-6 pt-0 flex justify-end">
              <button
                onClick={() => setViewingBTS(null)}
                className="px-6 py-2.5 bg-gray-100 dark:bg-slate-800 text-gray-700 dark:text-gray-200 rounded-xl text-sm font-bold hover:bg-gray-200 dark:hover:bg-slate-700 transition-colors"
              >
                {t('bts.btn_close')}
              </button>
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
