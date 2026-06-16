"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import apiClient from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import {
  Search,
  ChevronLeft,
  ChevronRight,
  Loader2,
  User,
  Phone,
  Smartphone,
  Store,
  Hash,
  Upload,
  Download,
  FileSpreadsheet,
  Eye,
  X,
  ArrowUpDown
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "react-hot-toast";
import { AccessDenied } from "@/components/ui/AccessDenied";
import { useLanguage } from "@/i18n/useLanguage";

interface Retailer {
  id: number;
  house_id: number;
  retailer_code: string;
  name: string;
  type: string;
  enabled: string;
  sim_seller: string;
  tran_mobile_no: string;
  itop_sr_number: string;
  itop_number: string;
  service_point: string;
  category: string;
  owner_name: string;
  contact_no: string;
  district: string;
  thana: string;
  address: string;
  nid: string;
  bp_code: string;
  bp_number: string;
  dob: string;
  route: string;
  house?: { name: string, code: string };
  employee?: { name: string, itop_number: string, dms_code: string, user?: { name: string } };
}

interface PaginationMeta {
  page: number;
  per_page: number;
  total: number;
  total_pages: number;
  has_next: boolean;
  has_prev: boolean;
}

export default function RetailersPage() {
  const { selectedHouse, hasPermission, loading: authLoading } = useAuth();
  const router = useRouter();
  const { t } = useLanguage();
  const [retailers, setRetailers] = useState<Retailer[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState<PaginationMeta | null>(null);
  const [sortBy, setSortBy] = useState("id");
  const [sortOrder, setSortOrder] = useState("desc");
  const perPage = 5;

  useEffect(() => {
    if (!authLoading && !hasPermission("retailers.view")) {
      const timer = setTimeout(() => {
        router.push("/");
      }, 5000);
      return () => clearTimeout(timer);
    }
  }, [authLoading, hasPermission, router]);

  const [isImporting, setIsImporting] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [importProgress, setImportProgress] = useState(0);
  const [viewingRetailer, setViewingRetailer] = useState<Retailer | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, any> = {
        page,
        per_page: perPage,
        sort_by: sortBy,
        sort_order: sortOrder,
      };
      if (search) params.search = search;
      const retRes = await apiClient.get("retailers", { params });
      setRetailers(retRes.data.data || []);
      setPagination(retRes.data.pagination || null);
    } catch (err) {
      console.error("Failed to fetch data", err);
    } finally {
      setLoading(false);
    }
  }, [page, search, sortBy, sortOrder]);

  useEffect(() => {
    if (!authLoading && hasPermission("retailers.view")) {
      fetchData();
    }
  }, [selectedHouse, page, sortBy, sortOrder, authLoading, hasPermission, fetchData]);

  const handleSearch = (value: string) => {
    setSearch(value);
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    searchTimeoutRef.current = setTimeout(() => {
      setPage(1);
    }, 400);
  };

  const toggleSort = (field: string) => {
    if (sortBy === field) {
      setSortOrder(prev => prev === "asc" ? "desc" : "asc");
    } else {
      setSortBy(field);
      setSortOrder("desc");
    }
    setPage(1);
  };

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
      const response = await apiClient.post("retailers/import", importData);
      setImportProgress(100);
      toast.success(response.data.message);
      fetchData();
    } catch (err: any) {
      const detail = err.response?.data?.detail;
      let msg = "Import failed";
      if (typeof detail === "string") {
        msg = detail;
      } else if (Array.isArray(detail)) {
        msg = detail.map((e: any) => e.msg || "").filter(Boolean).join(", ");
      }
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
      const response = await apiClient.get("retailers/export", { responseType: 'blob' });
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', 'retailers.xlsx');
      document.body.appendChild(link);
      link.click();
      toast.success(t('retailers.toast_export_success') || 'Export successful');
    } catch (err) {
      toast.error(t('retailers.toast_export_failed') || 'Export failed');
    } finally {
      setIsExporting(false);
    }
  };

  if (!authLoading && !hasPermission("retailers.view")) {
    return <AccessDenied />;
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">{t('retailers.title')}</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1 transition-colors">{t('retailers.description')}</p>
        </div>
        <div className="flex flex-wrap gap-3">
          <input type="file" ref={fileInputRef} onChange={handleFileChange} className="hidden" accept=".xlsx, .xls" />
          <button
            onClick={handleImportClick}
            disabled={isImporting}
            className="inline-flex items-center justify-center gap-2 px-4 py-2 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 text-gray-700 dark:text-gray-200 rounded-lg text-sm font-bold hover:bg-gray-50 dark:hover:bg-slate-800 transition-colors shadow-sm disabled:opacity-50"
          >
            {isImporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
            {t('retailers.import_list')}
          </button>
          <button
            onClick={handleExport}
            disabled={isExporting}
            className="inline-flex items-center justify-center gap-2 px-4 py-2 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 text-gray-700 dark:text-gray-200 rounded-lg text-sm font-bold hover:bg-gray-50 dark:hover:bg-slate-800 transition-colors shadow-sm"
          >
            {isExporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
            {t('retailers.export_list')}
          </button>
        </div>
      </div>

      {isImporting && (
        <div className="bg-white dark:bg-slate-900 p-6 rounded-2xl border border-primary-100 dark:border-primary-500/20 shadow-xl animate-in slide-in-from-top-4 duration-300">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-primary-100 dark:bg-primary-500/20 rounded-xl text-primary-600">
                <FileSpreadsheet className="w-5 h-5" />
              </div>
              <div>
                <h4 className="text-sm font-bold text-gray-900 dark:text-gray-100">{t('retailers.import_processing')}</h4>
                <p className="text-xs text-gray-500 dark:text-gray-400">{t('retailers.import_wait')}</p>
              </div>
            </div>
            <span className="text-sm font-black text-primary-600">{importProgress}%</span>
          </div>
          <div className="w-full h-2 bg-gray-100 dark:bg-slate-800 rounded-full overflow-hidden">
            <div
              className="h-full bg-primary-500 transition-all duration-500 ease-out shadow-[0_0_10px_rgba(249,115,22,0.5)]"
              style={{ width: `${importProgress}%` }}
            />
          </div>
        </div>
      )}

      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-gray-100 dark:border-slate-800 shadow-sm overflow-hidden transition-colors duration-300">
        <div className="p-4 border-b border-gray-50 dark:border-slate-800">
          <div className="relative max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 dark:text-gray-500" />
            <input
              type="text"
              placeholder={t('retailers.search_placeholder')}
              className="w-full pl-10 pr-4 py-2.5 bg-gray-50 dark:bg-slate-800 border-none rounded-xl text-sm focus:ring-2 focus:ring-primary-500 transition-all dark:text-gray-100 outline-none"
              value={search}
              onChange={(e) => handleSearch(e.target.value)}
            />
          </div>
        </div>

        {loading ? (
          <div className="divide-y divide-gray-50 dark:divide-slate-800">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex items-center gap-4 px-6 py-5 animate-pulse">
                <div className="flex items-center gap-3 flex-1">
                  <div className="w-10 h-10 rounded-xl bg-gray-200 dark:bg-slate-700 shrink-0" />
                  <div className="space-y-2">
                    <div className="h-3 w-32 bg-gray-200 dark:bg-slate-700 rounded-md" />
                    <div className="h-2.5 w-24 bg-gray-100 dark:bg-slate-800 rounded-md" />
                  </div>
                </div>
                <div className="hidden sm:block flex-1 space-y-2">
                  <div className="h-3 w-20 bg-gray-200 dark:bg-slate-700 rounded-md" />
                  <div className="h-2.5 w-16 bg-gray-100 dark:bg-slate-800 rounded-md" />
                </div>
                <div className="hidden md:block flex-1 space-y-2">
                  <div className="h-4 w-14 bg-gray-200 dark:bg-slate-700 rounded-full" />
                  <div className="h-3 w-10 bg-gray-100 dark:bg-slate-800 rounded-full" />
                </div>
                <div className="hidden lg:block flex-1 space-y-2">
                  <div className="h-3 w-24 bg-gray-200 dark:bg-slate-700 rounded-md" />
                  <div className="h-2.5 w-14 bg-gray-100 dark:bg-slate-800 rounded-md" />
                </div>
                <div className="w-10 h-10 rounded-lg bg-gray-200 dark:bg-slate-700 shrink-0" />
              </div>
            ))}
          </div>
        ) : !pagination || pagination.total === 0 ? (
          <div className="py-20 text-center">
            <Store className="w-12 h-12 text-gray-200 dark:text-gray-700 mx-auto mb-4" />
            <p className="text-gray-500 dark:text-gray-400 font-medium">{t('retailers.no_retailers')}</p>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-left min-w-[900px]">
                <thead>
                  <tr className="bg-gray-50/50 dark:bg-slate-800/50 text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-widest border-b border-gray-50 dark:border-slate-800">
                    <th className="px-6 py-4">
                      <button onClick={() => toggleSort("name")} className="flex items-center gap-1 hover:text-gray-600 dark:hover:text-gray-300">
                        {t('retailers.table_name')}
                        <ArrowUpDown className="w-3 h-3" />
                      </button>
                    </th>
                    <th className="px-6 py-4">{t('retailers.table_rso')}</th>
                    <th className="px-6 py-4">{t('retailers.table_status')}</th>
                    <th className="px-6 py-4">
                      <button onClick={() => toggleSort("house_id")} className="flex items-center gap-1 hover:text-gray-600 dark:hover:text-gray-300">
                        {t('retailers.table_house')}
                        <ArrowUpDown className="w-3 h-3" />
                      </button>
                    </th>
                    <th className="px-6 py-4"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50 dark:divide-slate-800">
                  {retailers.map((r) => (
                    <tr key={r.id} className="hover:bg-gray-50/30 dark:hover:bg-slate-800/30 transition-colors group">
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-xl bg-primary-100 dark:bg-primary-500/20 flex items-center justify-center text-primary-700 dark:text-primary-400 font-bold shadow-sm">
                            <Store className="w-5 h-5" />
                          </div>
                          <div>
                            <p className="font-bold text-gray-900 dark:text-gray-100 text-sm">{r.name}</p>
                            <p className="text-[10px] text-gray-500 dark:text-gray-400 flex items-center gap-1.5">
                              <Phone className="w-2.5 h-2.5" /> {r.itop_number} <Hash className="w-2.5 h-2.5 ml-1" /> {r.retailer_code}
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="space-y-1">
                          <p className="text-xs font-bold text-gray-700 dark:text-gray-200 flex items-center gap-1.5">
                            <User className="w-3 h-3 text-purple-500" /> {r.employee?.user?.name || r.employee?.name || t('retailers.no_rso')}
                          </p>
                          {r.employee?.itop_number && (
                            <p className="text-[10px] text-gray-500 dark:text-gray-400 font-mono flex items-center gap-1">
                              <Smartphone className="w-2.5 h-2.5 text-blue-500" /> {r.employee.itop_number}
                              {r.employee.dms_code && (
                                <span>• {r.employee.dms_code}</span>
                              )}
                            </p>
                          )}
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex flex-col gap-1.5">
                          {(() => {
                            const isEnabled = r.enabled === "Yes" || r.enabled === "Y";
                            const isSimSeller = r.sim_seller === "Yes" || r.sim_seller === "Y";
                            return (
                              <>
                                <span className={cn(
                                  "inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider w-fit",
                                  isEnabled
                                    ? "bg-green-50 dark:bg-green-500/10 text-green-700 dark:text-green-400"
                                    : "bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-400"
                                )}>
                                  <span className={cn("w-1 h-1 rounded-full", isEnabled ? "bg-green-500" : "bg-red-500")}></span>
                                  {isEnabled ? t('common.enabled') : t('common.disabled')}
                                </span>
                                <span className={cn(
                                  "px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider w-fit",
                                  isSimSeller ? "bg-blue-50 text-blue-700 dark:bg-blue-500/10 dark:text-blue-400" : "bg-gray-50 text-gray-500 dark:bg-slate-800"
                                )}>
                                  {isSimSeller ? t('retailers.sim_seller_yes') : t('retailers.sim_seller_no')}
                                </span>
                              </>
                            );
                          })()}
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="space-y-1 text-xs">
                          <p className="font-bold text-gray-700 dark:text-gray-200">{r.house?.name || "N/A"}</p>
                          <p className="text-[10px] font-mono text-gray-500 dark:text-gray-400">{r.house?.code || ""}</p>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <button
                          onClick={() => setViewingRetailer(r)}
                          className="p-2 text-gray-400 hover:text-primary-500 hover:bg-primary-50 dark:hover:bg-primary-500/10 rounded-lg transition-colors"
                          title={t('retailers.view_details')}
                        >
                          <Eye className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="p-4 border-t border-gray-50 dark:border-slate-800 flex items-center justify-between">
              <p className="text-xs text-gray-500 dark:text-gray-400">
                {t('retailers.showing_results', {
                  start: pagination.total === 0 ? 0 : (pagination.page - 1) * pagination.per_page + 1,
                  end: Math.min(pagination.page * pagination.per_page, pagination.total),
                  total: pagination.total
                })}
              </p>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setPage(p => p - 1)}
                  disabled={!pagination.has_prev}
                  className="p-2 border rounded-lg hover:bg-gray-50 dark:hover:bg-slate-800 disabled:opacity-50"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <span className="text-xs text-gray-500 dark:text-gray-400 font-medium">
                  {pagination.page} / {pagination.total_pages}
                </span>
                <button
                  onClick={() => setPage(p => p + 1)}
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

      {viewingRetailer && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] overflow-y-auto mx-4 animate-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between p-6 border-b border-gray-100 dark:border-slate-800">
              <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">
                <Store className="w-5 h-5 text-primary-500" />
                {viewingRetailer.name}
                <span className="text-sm font-mono text-gray-400 font-normal">#{viewingRetailer.retailer_code}</span>
              </h2>
              <button
                onClick={() => setViewingRetailer(null)}
                className="p-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-slate-800 rounded-xl transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-4">
              <Field label={t('retailers.field_retailer_code')} value={viewingRetailer.retailer_code} />
              <Field label={t('retailers.field_retailer_name')} value={viewingRetailer.name} />
              <Field label={t('retailers.field_type')} value={viewingRetailer.type} />
              <Field label={t('retailers.field_category')} value={viewingRetailer.category} />
              <Field label={t('retailers.field_route')} value={viewingRetailer.route} />
              <Field label={t('retailers.field_itop')} value={viewingRetailer.itop_number} />
              <Field label={t('retailers.field_sr_number')} value={viewingRetailer.itop_sr_number} />
              <Field label={t('retailers.field_tran_mobile')} value={viewingRetailer.tran_mobile_no} />
              <Field label={t('retailers.field_service_point')} value={viewingRetailer.service_point} />
              <Field label={t('retailers.field_sim_seller')} value={viewingRetailer.sim_seller === "Yes" || viewingRetailer.sim_seller === "Y" ? "Yes" : "No"} />
              <Field label={t('common.enabled')} value={viewingRetailer.enabled === "Yes" || viewingRetailer.enabled === "Y" ? t('common.enabled') : t('common.disabled')} />
              <Field label={t('retailers.field_house')} value={viewingRetailer.house ? `${viewingRetailer.house.name} (${viewingRetailer.house.code})` : "N/A"} />
              <Field label={t('retailers.no_rso')} value={viewingRetailer.employee?.user?.name || viewingRetailer.employee?.name || "N/A"} />
              <Field label={t('retailers.field_owner_name')} value={viewingRetailer.owner_name} />
              <Field label={t('retailers.field_contact_no')} value={viewingRetailer.contact_no} />
              <Field label={t('retailers.field_district')} value={viewingRetailer.district} />
              <Field label={t('retailers.field_thana')} value={viewingRetailer.thana} />
              <Field label={t('retailers.field_address')} value={viewingRetailer.address} className="md:col-span-2" />
              <Field label={t('retailers.field_nid')} value={viewingRetailer.nid} />
              <Field label={t('retailers.field_bp_code')} value={viewingRetailer.bp_code} />
              <Field label={t('retailers.field_bp_number')} value={viewingRetailer.bp_number} />
              <Field label={t('retailers.field_dob')} value={viewingRetailer.dob} />
            </div>
            <div className="p-6 pt-0 flex justify-end">
              <button
                onClick={() => setViewingRetailer(null)}
                className="px-6 py-2.5 bg-gray-100 dark:bg-slate-800 text-gray-700 dark:text-gray-200 rounded-xl text-sm font-bold hover:bg-gray-200 dark:hover:bg-slate-700 transition-colors"
              >
                {t('retailers.btn_close')}
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
