"use client";
import { useState, useEffect, useCallback } from "react";
import { Search, Download, X, Loader2, Database, ChevronLeft, ChevronRight, ChevronDown, ChevronUp, Plus, Trash2, Upload, AlertTriangle, CheckCircle2, Copy } from "lucide-react";
import { toast } from "react-hot-toast";
import apiClient from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { AccessDenied } from "@/components/ui/AccessDenied";
import { Checkbox } from "@/components/ui/checkbox";
import { useLanguage } from "@/i18n/useLanguage";
import PageGuideModal from "@/components/PageGuideModal";

interface SerialRecord {
  id: number; house_id: number; house_name: string | null; house_code: string | null;
  product_id: number;
  product_name: string | null; product_code: string | null;
  serial_number: string;
  status: string; batch_id: string | null; notes: string | null;
  used_at: string | null; used_by: number | null;
  used_by_name: string | null; used_by_role: string | null;
  created_at: string; updated_at: string;
  exit_order_no: string | null; rf_no: string | null;
}

interface StockSummary {
  house_id: number; house_name: string; house_code: string;
  total_serials: number; total_value: number;
}

interface House {
  id: number; name: string; code: string;
}

interface InvoiceRow {
  productId: number | ""; startSerial: string; endSerial: string; qty: string; exitOrderNo: string; rfNo: string;
}

interface Product {
  id: number; product_code: string; product_name: string; mrp: number; category: string; status: string;
}

export default function SCSerialsPage() {
  const { hasPermission, loading: authLoading, selectedHouse } = useAuth();
  const { t } = useLanguage();

  const plural = (n: number) => (n === 1 ? "one" : "many");

  // list state
  const [data, setData] = useState<SerialRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [totalRecords, setTotalRecords] = useState(0);
  const perPage = 5;

  // filters
  const [search, setSearch] = useState("");
  const [filterProductId, setFilterProductId] = useState<string>("");
  const [filterStatus, setFilterStatus] = useState<string>("");

  // stock summary
  const [stockSummary, setStockSummary] = useState<StockSummary[]>([]);
  const [summaryLoading, setSummaryLoading] = useState(false);

  // detail modal
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [detailData, setDetailData] = useState<{ house_name: string; house_code: string; products: any[] } | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  // houses for modal selector
  const [houses, setHouses] = useState<House[]>([]);
  const [modalHouseId, setModalHouseId] = useState<number | "">("");

  // batch import modal
  const [showImport, setShowImport] = useState(false);
  const [importBatch, setImportBatch] = useState("");
  const [importing, setImporting] = useState(false);
  const [invoiceRows, setInvoiceRows] = useState<InvoiceRow[]>([
    { productId: "", startSerial: "", endSerial: "", qty: "", exitOrderNo: "", rfNo: "" },
  ]);
  const [importResult, setImportResult] = useState<{ inserted: number; skipped: number; skippedSerials: string[] } | null>(null);

  // products for dropdown
  const [products, setProducts] = useState<Product[]>([]);

  // delete confirm
  const [deletingId, setDeletingId] = useState<number | null>(null);

  // permanent delete confirm
  const [permanentDeleteId, setPermanentDeleteId] = useState<number | null>(null);

  // bulk permanent delete
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [showBulkDeleteConfirm, setShowBulkDeleteConfirm] = useState(false);

  // bulk update
  const [bulkExitOrderNo, setBulkExitOrderNo] = useState("");
  const [bulkRfNo, setBulkRfNo] = useState("");
  const [isBulkUpdating, setIsBulkUpdating] = useState(false);

  // export house select
  const [showExportHouse, setShowExportHouse] = useState(false);
  const [exportHouseId, setExportHouseId] = useState<number | "">("");

  // allocate
  const [showAllocate, setShowAllocate] = useState(false);
  const [allocHouseId, setAllocHouseId] = useState<number | "">("");
  const [allocAmount, setAllocAmount] = useState("");
  const [allocating, setAllocating] = useState(false);
  const [allocResult, setAllocResult] = useState<any>(null);
  const [allocError, setAllocError] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [allocNotes, setAllocNotes] = useState("");

  const generateBatchId = () => {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    const h = String(now.getHours()).padStart(2, '0');
    const min = String(now.getMinutes()).padStart(2, '0');
    const s = String(now.getSeconds()).padStart(2, '0');
    const ms = String(now.getMilliseconds()).padStart(3, '0');
    return `SC-${y}${m}${d}-${h}${min}${s}${ms}`;
  };

  const totalPages = Math.max(1, Math.ceil(totalRecords / perPage));

  const houseHeaders: Record<string, string> = {};
  if (selectedHouse?.id) {
    houseHeaders["X-House-ID"] = String(selectedHouse.id);
  }

  const todayDateRange = () => {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    const today = `${y}-${m}-${d}`;
    return { dateFrom: today, dateTo: today };
  };

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const { dateFrom, dateTo } = todayDateRange();
      const params: Record<string, string | number> = { page, per_page: perPage, sort_order: "desc", date_from: dateFrom, date_to: dateTo };
      if (search) params.search = search;
      if (filterProductId) params.product_id = Number(filterProductId);
      if (filterStatus) params.status = filterStatus;
      const res = await apiClient.get("/v1/scratch-card-serials", { params, headers: houseHeaders });
      setData(res.data.data || []);
      setTotalRecords(res.data.pagination?.total || 0);
    } catch { toast.error(t('scratch_card_serials.toast_load_failed')); }
    finally { setLoading(false); }
  }, [page, search, filterProductId, filterStatus, selectedHouse?.id]);

  const fetchSummary = useCallback(async () => {
    setSummaryLoading(true);
    try {
      const res = await apiClient.get("/v1/scratch-card-serials/stock/summary", { headers: houseHeaders });
      setStockSummary(Array.isArray(res.data.data) ? res.data.data : []);
    } catch { /* silent */ }
    finally { setSummaryLoading(false); }
  }, [selectedHouse?.id]);

  const fetchHouseDetail = async (houseId: number) => {
    setDetailLoading(true);
    setDetailData(null);
    setShowDetailModal(true);
    try {
      const res = await apiClient.get("/v1/scratch-card-serials/stock/summary", {
        params: { house_id: houseId },
        headers: houseHeaders,
      });
      setDetailData(res.data.data || null);
    } catch { toast.error(t('scratch_card_serials.toast_house_details_failed')); }
    finally { setDetailLoading(false); }
  };

  useEffect(() => { fetchData(); }, [fetchData]);
  useEffect(() => { fetchSummary(); }, [fetchSummary]);

  useEffect(() => {
    apiClient.get("houses/accessible").then(res => {
      setHouses(res.data || []);
    }).catch(() => {});
    apiClient.get("products", { params: { per_page: 200, category: "Scratch Card" } }).then(res => {
      setProducts((res.data.data || res.data || []).filter((p: Product) => p.status === "Active"));
    }).catch(() => {});
  }, []);

  // reset to page 1 when filters change
  useEffect(() => { setPage(1); }, [search, filterProductId, filterStatus]);

  const handleExport = async (houseId: number) => {
    try {
      const headers: Record<string, string> = { "X-House-ID": String(houseId) };
      const params: Record<string, string> = {};
      if (filterProductId) params.product_id = filterProductId;
      const res = await apiClient.get("/v1/scratch-card-serials/export/list", {
        params, headers, responseType: "blob",
      });
      const house = houses.find(h => h.id === houseId);
      const houseCode = house?.code || houseId;
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const a = document.createElement("a"); a.href = url; a.download = `scratch_card_serials_${houseCode}.xlsx`; a.click();
      window.URL.revokeObjectURL(url);
      toast.success(t('scratch_card_serials.toast_export_success'));
    } catch { toast.error(t('scratch_card_serials.toast_export_failed')); }
  };

  const handleDelete = async (id: number) => {
    try {
      await apiClient.delete(`/v1/scratch-card-serials/${id}`, { headers: houseHeaders });
      toast.success(t('scratch_card_serials.toast_delete_success'));
      fetchData();
      fetchSummary();
    } catch (e: any) { toast.error(e?.message || t('scratch_card_serials.toast_delete_failed')); }
    finally { setDeletingId(null); }
  };

  const handlePermanentDelete = async (id: number) => {
    try {
      await apiClient.delete(`/v1/scratch-card-serials/${id}/permanent`, { headers: houseHeaders });
      toast.success(t('scratch_card_serials.toast_permanent_delete_success'));
      fetchData();
      fetchSummary();
    } catch (e: any) { toast.error(e?.message || t('scratch_card_serials.toast_permanent_delete_failed')); }
    finally { setPermanentDeleteId(null); }
  };

  const handleBulkPermanentDelete = async () => {
    if (selectedIds.length === 0) return;
    try {
      await apiClient.post("/v1/scratch-card-serials/bulk-permanent-delete", selectedIds, { headers: houseHeaders });
      toast.success(t('scratch_card_serials.toast_bulk_perm_delete_success', { count: selectedIds.length }));
      setSelectedIds([]);
      fetchData();
      fetchSummary();
    } catch (e: any) { toast.error(e?.message || t('scratch_card_serials.toast_bulk_perm_delete_failed')); }
    finally { setShowBulkDeleteConfirm(false); }
  };

  const handleBulkUpdate = async () => {
    if (selectedIds.length === 0) return;
    if (!bulkExitOrderNo && !bulkRfNo) { toast.error(t('scratch_card_serials.toast_bulk_field_required')); return; }
    setIsBulkUpdating(true);
    try {
      await apiClient.put("/v1/scratch-card-serials/bulk/update", {
        serial_ids: selectedIds,
        exit_order_no: bulkExitOrderNo || null,
        rf_no: bulkRfNo || null,
      }, { headers: houseHeaders });
      toast.success(t('scratch_card_serials.toast_bulk_update_success', { count: selectedIds.length }));
      setBulkExitOrderNo("");
      setBulkRfNo("");
      setSelectedIds([]);
      fetchData();
      fetchSummary();
    } catch (e: any) { toast.error(e?.message || t('scratch_card_serials.toast_bulk_update_failed')); }
    finally { setIsBulkUpdating(false); }
  };

  const [showBulkDelete, setShowBulkDelete] = useState(false);
  const handleBulkDelete = async () => {
    if (selectedIds.length === 0) return;
    try {
      await apiClient.post("/v1/scratch-card-serials/bulk-delete", selectedIds, { headers: houseHeaders });
      toast.success(t('scratch_card_serials.toast_bulk_delete_success', { count: selectedIds.length }));
      setSelectedIds([]);
      fetchData();
      fetchSummary();
    } catch (e: any) { toast.error(e?.message || t('scratch_card_serials.toast_bulk_delete_failed')); }
    finally { setShowBulkDelete(false); }
  };

  const toggleSelect = (id: number) => {
    setSelectedIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  };

  const toggleSelectAll = async () => {
    const allIds = data.map(r => r.id);
    if (allIds.length === 0) return;
    const allSelected = allIds.every(id => selectedIds.includes(id));
    if (!allSelected) {
      setSelectedIds(allIds);
    } else {
      setSelectedIds([]);
    }
  };

  const [selectingAll, setSelectingAll] = useState(false);
  const selectAllMatching = async () => {
    setSelectingAll(true);
    try {
      const { dateFrom, dateTo } = todayDateRange();
      const params: Record<string, string | number> = {};
      if (search) params.search = search;
      if (filterProductId) params.product_id = Number(filterProductId);
      if (filterStatus) params.status = filterStatus;
      params.date_from = dateFrom;
      params.date_to = dateTo;
      const res = await apiClient.post("/v1/scratch-card-serials/select-all", null, { params, headers: houseHeaders });
      const allIds = res.data.data?.ids || [];
      if (allIds.length === 0) { toast.error(t('scratch_card_serials.toast_no_matching')); return; }
      setSelectedIds(allIds);
      toast.success(t('scratch_card_serials.toast_matching_selected', { count: allIds.length }));
    } catch { toast.error(t('scratch_card_serials.toast_fetch_matching_failed')); }
    finally { setSelectingAll(false); }
  };

  const calcInvoiceTotal = (): number => {
    let total = 0;
    for (const row of invoiceRows) {
      if (!row.productId || !row.startSerial) continue;
      if (row.endSerial) {
        try {
          const s = BigInt(row.startSerial);
          const e = BigInt(row.endSerial);
          if (e >= s && e - s <= BigInt(100000)) total += Number(e - s + BigInt(1));
        } catch {}
      } else if (row.qty) {
        const q = parseInt(row.qty, 10);
        if (!isNaN(q) && q > 0 && q <= 100000) total += q;
      }
    }
    return total;
  };

  const handleInvoiceImport = async () => {
    if (!modalHouseId) { toast.error(t('scratch_card_serials.toast_select_house')); return; }

    const productMap = new Map<number, { product: Product; serials: string[]; len: number }>();
    for (const row of invoiceRows) {
      if (!row.productId || !row.startSerial || !row.endSerial) continue;
      const s = BigInt(row.startSerial);
      const e = BigInt(row.endSerial);
      if (e < s) {
        const p = products.find(x => x.id === row.productId);
        toast.error(t('scratch_card_serials.toast_invalid_range', { code: p?.product_code || row.productId }));
        return;
      }
      if (e - s > BigInt(100000)) {
        const p = products.find(x => x.id === row.productId);
        toast.error(t('scratch_card_serials.toast_range_too_large', { code: p?.product_code || row.productId }));
        return;
      }
      const len = row.startSerial.length;
      if (!productMap.has(row.productId)) {
        const p = products.find(x => x.id === row.productId);
        if (!p) continue;
        productMap.set(row.productId, { product: p, serials: [], len });
      }
      const entry = productMap.get(row.productId)!;
      for (let i = s; i <= e; i++) {
        entry.serials.push(String(i).padStart(len, '0'));
      }
    }

    if (!productMap.size) { toast.error(t('scratch_card_serials.toast_no_valid_rows')); return; }

    setImporting(true);
    const headers: Record<string, string> = { "X-House-ID": String(modalHouseId) };
    const commonExitOrderNo = invoiceRows[0]?.exitOrderNo || null;
    const commonRfNo = invoiceRows[0]?.rfNo || null;
    let totalInserted = 0;
    let totalSkipped = 0;
    const skippedSerials: string[] = [];
    try {
      for (const [, entry] of productMap) {
        const res = await apiClient.post("/v1/scratch-card-serials/batch", {
          serials: entry.serials,
          product_id: entry.product.id,
          batch_id: importBatch || null,
          exit_order_no: commonExitOrderNo,
          rf_no: commonRfNo,
        }, { headers });
        const d = res.data ?? {};
        totalInserted += Number(d.inserted ?? 0);
        totalSkipped += Number(d.skipped ?? 0);
        for (const sn of (d.skipped_serials ?? []) as string[]) {
          if (skippedSerials.length < 200) skippedSerials.push(sn);
        }
      }
      setImportResult({ inserted: totalInserted, skipped: totalSkipped, skippedSerials });
      fetchData();
      fetchSummary();
      if (totalSkipped > 0) {
        toast.error(
          t(`scratch_card_serials.toast_dup_skip_${plural(totalSkipped)}`, { count: totalSkipped })
        );
        return;
      }
      toast.success(
        `${t(`scratch_card_serials.toast_imported_${plural(totalInserted)}`, { count: totalInserted })} ${t(`scratch_card_serials.toast_import_product_${plural(productMap.size)}`, { count: productMap.size })}`
      );
      setShowImport(false);
      setImportBatch("");
      setModalHouseId("");
      setImportResult(null);
      setInvoiceRows([{ productId: "", startSerial: "", endSerial: "", qty: "", exitOrderNo: "", rfNo: "" }]);
    } catch (e: any) { toast.error(e?.message || t('scratch_card_serials.toast_import_failed')); }
    finally { setImporting(false); }
  };

  const handleFindSerials = async () => {
    if (!allocAmount || Number(allocAmount) < 1) {
      toast.error(t('scratch_card_serials.toast_invalid_amount'));
      return;
    }
    if (!allocHouseId) {
      toast.error(t('scratch_card_serials.toast_select_house'));
      return;
    }
    setAllocating(true);
    setAllocResult(null);
    setAllocError("");
    const allocHeaders: Record<string, string> = { "X-House-ID": String(allocHouseId) };
    try {
      const res = await apiClient.post("/v1/scratch-card-serials/allocate",
        { request_amount: Number(allocAmount) },
        { headers: allocHeaders }
      );
      setAllocResult(res.data.data);
    } catch (e: any) {
      const msg = e?.response?.data?.error?.message || e?.response?.data?.detail || e?.message || t('scratch_card_serials.toast_alloc_failed');
      setAllocError(msg);
    }
    finally { setAllocating(false); }
  };

  const handleConfirmAllocation = async () => {
    if (!allocResult?.ranges?.length) return;
    setConfirming(true);
    const confirmHeaders: Record<string, string> = {};
    if (allocHouseId) confirmHeaders["X-House-ID"] = String(allocHouseId);
    try {
      const res = await apiClient.post("/v1/scratch-card-serials/confirm-allocation",
        {
          ranges: allocResult.ranges.map((r: any) => ({ start_serial: r.start_serial, end_serial: r.end_serial })),
          notes: allocNotes || undefined,
        },
        { headers: confirmHeaders }
      );
      toast.success(res.data.message || t('scratch_card_serials.toast_alloc_confirmed'));
      setAllocResult(null);
      setAllocAmount("");
      setAllocNotes("");
      fetchData();
      fetchSummary();
    } catch (e: any) {
      toast.error(e?.response?.data?.detail || e?.message || t('scratch_card_serials.toast_alloc_confirm_failed'));
    }
    finally { setConfirming(false); }
  };

  const formatDate = (d: Date) => {
    const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
    return `${d.getDate().toString().padStart(2, "0")} ${months[d.getMonth()]} ${d.getFullYear()}`;
  };

  const timeAgo = (d: Date) => {
    const diff = Date.now() - d.getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return t('scratch_card_serials.time_just_now');
    if (mins < 60) return t('scratch_card_serials.time_min_ago', { m: mins });
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return t('scratch_card_serials.time_hour_ago', { h: hrs });
    const days = Math.floor(hrs / 24);
    if (days < 30) return t('scratch_card_serials.time_day_ago', { d: days });
    return formatDate(d);
  };

  if (!authLoading && !hasPermission("scratch_card_serials.view")) return <AccessDenied />;

  return (
    <div className="p-4 sm:p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-primary-100 dark:bg-primary-500/20 rounded-xl">
            <Database className="w-5 h-5 text-primary-600" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">{t('scratch_card_serials.title')}</h1>
            <p className="text-sm text-gray-500">{t('scratch_card_serials.description')}</p>
          </div>
        </div>
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 w-full sm:w-auto">
          {hasPermission("scratch_card_serials.create") && (
              <button onClick={async () => {
                setShowImport(true);
                setModalHouseId("");
                setImportResult(null);
                try {
                  const res = await apiClient.get("/v1/scratch-card-serials/batch-id/generate");
                  setImportBatch(res.data.data?.batch_id || generateBatchId());
                } catch { setImportBatch(generateBatchId()); }
              }}
              className="flex items-center justify-center gap-2 px-4 py-2.5 sm:py-2 bg-primary-600 text-white rounded-xl text-sm font-medium hover:bg-primary-700 transition-colors">
              <Plus className="w-4 h-4" /> {t('scratch_card_serials.btn_add_serials')}
            </button>
          )}
          <div className="flex flex-1 sm:flex-none gap-2">
            {hasPermission("scratch_card_serials.export") && (
              <button onClick={() => { setExportHouseId(""); setShowExportHouse(true); }}
                className="flex-1 sm:flex-none flex items-center justify-center gap-2 px-4 py-2.5 sm:py-2 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-xl text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-slate-800 transition-colors">
                <Download className="w-4 h-4" /> {t('scratch_card_serials.btn_export')}
              </button>
            )}
            {hasPermission("scratch_card_serials.view") && (
              <button onClick={() => { setShowAllocate(true); setAllocAmount(""); setAllocResult(null); setAllocError(""); setAllocNotes(""); }}
                className="flex-1 sm:flex-none flex items-center justify-center gap-2 px-4 py-2.5 sm:py-2 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-xl text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-slate-800 transition-colors">
                <Database className="w-4 h-4" /> {t('scratch_card_serials.btn_allocate')}
              </button>
            )}
            <PageGuideModal pageKey="scratch_card_serials" />
          </div>
        </div>
      </div>

      {/* Stock Summary — per house */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-[repeat(auto-fit,minmax(320px,1fr))] gap-4">
        {summaryLoading ? (
          Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="bg-white dark:bg-slate-900 rounded-2xl border border-gray-100 dark:border-slate-800 p-5 animate-pulse">
              <div className="h-4 w-28 bg-gray-200 dark:bg-slate-700 rounded mb-3" />
              <div className="h-3 w-20 bg-gray-200 dark:bg-slate-700 rounded mb-4" />
              <div className="h-7 w-24 bg-gray-200 dark:bg-slate-700 rounded mb-2" />
              <div className="h-7 w-20 bg-gray-100 dark:bg-slate-800 rounded" />
            </div>
          ))
        ) : stockSummary.length === 0 ? (
          <div className="col-span-full text-center py-8 text-gray-400 text-sm">{t('scratch_card_serials.no_stock_data')}</div>
        ) : (
          stockSummary.map(s => (
            <div key={s.house_id} className="bg-white dark:bg-slate-900 rounded-2xl border border-gray-100 dark:border-slate-800 p-5 relative overflow-hidden group">
              {/* Top accent bar */}
              <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-primary-500 to-primary-600" />
              <div className="flex items-center gap-3 mb-3">
                <div className="w-10 h-10 rounded-xl bg-primary-50 dark:bg-primary-500/10 flex items-center justify-center text-primary-600 dark:text-primary-400 font-bold text-sm shrink-0">
                  {s.house_name.charAt(0)}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-bold text-gray-900 dark:text-gray-100 truncate">{s.house_name}</p>
                  <p className="text-[11px] text-gray-400 truncate">{s.house_code}</p>
                </div>
                <button onClick={() => fetchHouseDetail(s.house_id)}
                  className="w-8 h-8 rounded-lg bg-gray-50 dark:bg-slate-800 border border-gray-200 dark:border-slate-700 flex items-center justify-center text-gray-400 hover:text-primary-600 hover:border-primary-300 dark:hover:text-primary-400 dark:hover:border-primary-700 transition-all opacity-0 group-hover:opacity-100">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </button>
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-gray-500 dark:text-gray-400">{t('scratch_card_serials.total_serials')}</span>
                  <span className="text-lg font-bold text-gray-900 dark:text-gray-100">{s.total_serials.toLocaleString('en-US')}</span>
                </div>
                <div className="border-t border-gray-100 dark:border-slate-800 pt-2 flex items-center justify-between">
                  <span className="text-xs text-gray-500 dark:text-gray-400">{t('scratch_card_serials.total_value')}</span>
                  <span className="text-lg font-bold text-emerald-600 dark:text-emerald-500">
                    ৳ {s.total_value.toLocaleString('en-US')}
                  </span>
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Filters */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            placeholder={t('scratch_card_serials.search_placeholder_search')}
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-9 pr-4 py-2 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-xl text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500"
          />
        </div>
        <select value={filterProductId} onChange={e => setFilterProductId(e.target.value)}
          className="px-3 py-2 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-xl text-sm text-gray-700 dark:text-gray-300 focus:outline-none focus:ring-2 focus:ring-primary-500/20">
          <option value="">{t('scratch_card_serials.filter_all')}</option>
          {products.map(p => (
            <option key={p.id} value={p.id}>{p.product_code} - {p.product_name}</option>
          ))}
        </select>
        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
          className="px-3 py-2 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-xl text-sm text-gray-700 dark:text-gray-300 focus:outline-none focus:ring-2 focus:ring-primary-500/20">
          <option value="">{t('scratch_card_serials.filter_all_status')}</option>
          <option value="available">{t('scratch_card_serials.filter_available')}</option>
          <option value="used">{t('scratch_card_serials.filter_used')}</option>
          <option value="allocated">{t('scratch_card_serials.filter_allocated')}</option>
        </select>
      </div>

      {/* Select All Matching */}
      <div className="flex items-center justify-between">
        <button
          onClick={selectAllMatching}
          disabled={selectingAll}
          className="flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-primary-600 dark:text-primary-400 bg-primary-50 dark:bg-primary-500/10 border border-primary-200 dark:border-primary-500/20 rounded-xl hover:bg-primary-100 dark:hover:bg-primary-500/20 transition-colors disabled:opacity-50"
        >
          {selectingAll ? <Loader2 className="w-4 h-4 animate-spin" /> : <Database className="w-4 h-4" />}
          {t('scratch_card_serials.select_all_matching')}
        </button>
      </div>

      {/* Bulk Action Bar */}
      {selectedIds.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 bg-orange-50 dark:bg-orange-500/10 border border-orange-200 dark:border-orange-500/20 rounded-2xl px-4 py-3">
          <span className="text-sm font-medium text-orange-700 dark:text-orange-300 whitespace-nowrap">
            {t('scratch_card_serials.n_selected', { count: selectedIds.length })}
          </span>
          <input
            placeholder={t('scratch_card_serials.bulk_exit_order_placeholder')}
            value={bulkExitOrderNo}
            onChange={e => setBulkExitOrderNo(e.target.value)}
            className="flex-1 min-w-[160px] px-3 py-1.5 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-xl text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary-500/20"
          />
          <input
            placeholder={t('scratch_card_serials.bulk_rf_placeholder')}
            value={bulkRfNo}
            onChange={e => setBulkRfNo(e.target.value)}
            className="flex-1 min-w-[160px] px-3 py-1.5 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-xl text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary-500/20"
          />
          <button
            onClick={handleBulkUpdate}
            disabled={isBulkUpdating}
            className="flex items-center gap-1.5 px-4 py-1.5 bg-primary-600 text-white rounded-xl text-sm font-medium hover:bg-primary-700 transition-colors disabled:opacity-50"
          >
            {isBulkUpdating ? <Loader2 className="w-4 h-4 animate-spin" /> : <X className="w-4 h-4" />}
            {t('scratch_card_serials.btn_update')}
          </button>
          {hasPermission("scratch_card_serials.delete") && (
            <button
              onClick={() => setShowBulkDelete(true)}
              className="flex items-center gap-1.5 px-4 py-1.5 bg-orange-600 text-white rounded-xl text-sm font-medium hover:bg-orange-700 transition-colors"
            >
              <Trash2 className="w-4 h-4" /> {t('scratch_card_serials.btn_delete')}
            </button>
          )}
          <button
            onClick={() => { setSelectedIds([]); setBulkExitOrderNo(""); setBulkRfNo(""); }}
            className="ml-auto text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
          >
            {t('scratch_card_serials.clear_selection')}
          </button>
        </div>
      )}

      {/* Table */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-gray-100 dark:border-slate-800 shadow-sm overflow-hidden">
        <div className="hidden lg:block overflow-x-auto scrollbar-custom">
          <table className="w-full text-sm whitespace-nowrap">
            <thead>
              <tr className="border-b border-gray-100 dark:border-slate-800">
                <th className="w-10 px-2 py-2">
                  {hasPermission("scratch_card_serials.delete") && (
                    <Checkbox
                      checked={selectedIds.length > 0 && data.every(r => selectedIds.includes(r.id))}
                      onCheckedChange={toggleSelectAll}
                      className="border-gray-400 data-[state=checked]:bg-orange-600 data-[state=checked]:border-orange-600"
                    />
                  )}
                </th>
                <th className="text-left px-2 py-2 font-semibold text-gray-600 dark:text-gray-400 text-xs uppercase">{t('scratch_card_serials.table_serial')}</th>
                <th className="text-left px-2 py-2 font-semibold text-gray-600 dark:text-gray-400 text-xs uppercase">{t('scratch_card_serials.table_house')}</th>
                <th className="text-left px-2 py-2 font-semibold text-gray-600 dark:text-gray-400 text-xs uppercase">{t('scratch_card_serials.table_product')}</th>
                <th className="text-left px-2 py-2 font-semibold text-gray-600 dark:text-gray-400 text-xs uppercase">{t('scratch_card_serials.table_batch')}</th>
                <th className="text-left px-2 py-2 font-semibold text-gray-600 dark:text-gray-400 text-xs uppercase">{t('scratch_card_serials.table_order_rf')}</th>
                <th className="text-left px-2 py-2 font-semibold text-gray-600 dark:text-gray-400 text-xs uppercase">{t('scratch_card_serials.table_used_at')}</th>
                <th className="text-left px-2 py-2 font-semibold text-gray-600 dark:text-gray-400 text-xs uppercase">{t('scratch_card_serials.table_used_by')}</th>
                <th className="text-left px-2 py-2 font-semibold text-gray-600 dark:text-gray-400 text-xs uppercase">{t('scratch_card_serials.table_created')}</th>
                <th className="text-left px-2 py-2 font-semibold text-gray-600 dark:text-gray-400 text-xs uppercase">{t('scratch_card_serials.table_updated')}</th>
                <th className="text-right px-2 py-2 font-semibold text-gray-600 dark:text-gray-400 text-xs uppercase">{t('scratch_card_serials.table_actions')}</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i} className="border-b border-gray-50 dark:border-slate-800/50 animate-pulse">
                    {Array.from({ length: 11 }).map((_, j) => (
                      <td key={j} className="px-2 py-1"><div className="h-4 bg-gray-200 dark:bg-slate-700 rounded w-3/4" /></td>
                    ))}
                  </tr>
                ))
              ) : data.length === 0 ? (
                <tr><td colSpan={11} className="text-center py-12 text-gray-400">{t('scratch_card_serials.no_data')}</td></tr>
              ) : data.map(r => (
                <tr key={r.id} className={`border-b border-gray-50 dark:border-slate-800/50 hover:bg-gray-50 dark:hover:bg-slate-800/50 transition-colors ${selectedIds.includes(r.id) ? 'bg-orange-50 dark:bg-orange-500/5' : ''}`}>
                  <td className="px-2 py-1">
                    {hasPermission("scratch_card_serials.delete") && (
                      <Checkbox
                        checked={selectedIds.includes(r.id)}
                        onCheckedChange={() => toggleSelect(r.id)}
                        className="border-gray-400 data-[state=checked]:bg-orange-600 data-[state=checked]:border-orange-600"
                      />
                    )}
                  </td>
                  <td className="px-2 py-1">
                    <div className="flex items-center gap-2">
                      <span className={`font-mono text-xs font-medium ${r.status === "used" ? "line-through text-gray-400 dark:text-gray-500" : "text-gray-900 dark:text-gray-100"}`}>
                        {r.serial_number}
                      </span>
                      {r.status === "used" && <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />}
                    </div>
                  </td>
                  <td className="px-2 py-1">
                    <p className="font-medium text-gray-900 dark:text-gray-100 text-sm">{r.house_name || t('scratch_card_serials.house_hash', { id: r.house_id })}</p>
                    <p className="text-[11px] text-gray-500 dark:text-gray-400">{r.house_code || ""}</p>
                  </td>
                  <td className="px-2 py-1">
                    <p className="font-medium text-gray-900 dark:text-gray-100 text-sm">{r.product_name || t('scratch_card_serials.product_hash', { id: r.product_id })}</p>
                    <p className="text-[11px] text-gray-500 dark:text-gray-400">{r.product_code || ""}</p>
                  </td>
                  <td className="px-2 py-1 text-gray-500 dark:text-gray-400 text-[11px]">{r.batch_id || "-"}</td>
                  <td className="px-2 py-1">
  <p className="text-xs text-gray-900 dark:text-gray-100">{r.exit_order_no || "-"}</p>
  <p className="text-[11px] text-gray-500 dark:text-gray-400">{r.rf_no || ""}</p>
</td>
                    <td className="px-2 py-1">
                      {r.used_at ? (
                        <div>
                          <p className="font-medium text-gray-900 dark:text-gray-100 text-sm">{formatDate(new Date(r.used_at))}</p>
                          <p className="text-[11px] text-gray-500 dark:text-gray-400">{timeAgo(new Date(r.used_at))}</p>
                        </div>
                      ) : (
                        <span className="text-gray-400">-</span>
                      )}
                    </td>
                    <td className="px-2 py-1">
                      {r.used_by_name ? (
                        <div>
                          <p className="font-medium text-gray-900 dark:text-gray-100 text-sm">{r.used_by_name}</p>
                          <p className="text-[11px] text-gray-500 dark:text-gray-400">{r.used_by_role || ""}</p>
                        </div>
                      ) : (
                        <span className="text-gray-400">-</span>
                      )}
                    </td>
                    <td className="px-2 py-1">
                      {r.created_at ? (
                        <div>
                          <p className="font-medium text-gray-900 dark:text-gray-100 text-sm">{formatDate(new Date(r.created_at))}</p>
                          <p className="text-[11px] text-gray-500 dark:text-gray-400">{timeAgo(new Date(r.created_at))}</p>
                        </div>
                      ) : (
                        <span className="text-gray-400">-</span>
                      )}
                    </td>
                    <td className="px-2 py-1">
                      {r.updated_at ? (
                        <div>
                          <p className="font-medium text-gray-900 dark:text-gray-100 text-sm">{formatDate(new Date(r.updated_at))}</p>
                          <p className="text-[11px] text-gray-500 dark:text-gray-400">{timeAgo(new Date(r.updated_at))}</p>
                        </div>
                      ) : (
                        <span className="text-gray-400">-</span>
                      )}
                    </td>
                    <td className="px-2 py-1 text-right">
                    <div className="flex items-center justify-end gap-1">
                      {hasPermission("scratch_card_serials.delete") && (
                        r.status === "used" ? (
                          <button
                            onClick={() => setPermanentDeleteId(r.id)}
                            title={t('scratch_card_serials.perm_delete_tooltip')}
                            className="p-1.5 text-orange-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-500/10 rounded-lg transition-colors"
                          >
                            <AlertTriangle className="w-4 h-4" />
                          </button>
                        ) : (
                          <button
                            onClick={() => setDeletingId(r.id)}
                            className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 rounded-lg transition-colors"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Mobile Accordion */}
        <div className="lg:hidden divide-y divide-gray-100 dark:divide-slate-800">
          {loading ? (
            Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex items-center gap-4 px-4 py-4 animate-pulse">
                <div className="w-10 h-10 rounded-xl bg-gray-200 dark:bg-slate-700 shrink-0" />
                <div className="space-y-2 flex-1">
                  <div className="h-3 w-32 bg-gray-200 dark:bg-slate-700 rounded-md" />
                  <div className="h-2.5 w-24 bg-gray-100 dark:bg-slate-800 rounded-md" />
                </div>
              </div>
            ))
          ) : data.length === 0 ? (
            <div className="text-center py-12 text-gray-400">{t('scratch_card_serials.no_data')}</div>
          ) : (
            <MobileRow
              data={data}
              selectedIds={selectedIds}
              toggleSelect={toggleSelect}
              hasDelete={hasPermission("scratch_card_serials.delete")}
              formatDate={formatDate}
              timeAgo={timeAgo}
              setPermanentDeleteId={setPermanentDeleteId}
              setDeletingId={setDeletingId}
            />
          )}
        </div>

        {totalRecords > 0 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100 dark:border-slate-800">
            <span className="text-xs text-gray-400">
              {t('scratch_card_serials.showing_results', {
                start: (page - 1) * perPage + 1,
                end: Math.min(page * perPage, totalRecords),
                total: totalRecords,
              })}
            </span>
            <div className="flex items-center gap-2">
              <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1}
                className="flex items-center gap-1 px-3 py-1.5 text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-slate-800 rounded-lg disabled:opacity-50 transition-colors">
                <ChevronLeft className="w-3.5 h-3.5" /> {t('scratch_card_serials.prev')}
              </button>
              <button onClick={() => setPage(p => p + 1)} disabled={page >= totalPages}
                className="flex items-center gap-1 px-3 py-1.5 text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-slate-800 rounded-lg disabled:opacity-50 transition-colors">
                {t('scratch_card_serials.next')} <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Delete Confirm Modal */}
      {deletingId !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-xl border border-gray-100 dark:border-slate-800 p-6 w-full max-w-sm">
            <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100 mb-2">{t('scratch_card_serials.delete_title')}</h3>
            <p className="text-sm text-gray-500 mb-6">{t('scratch_card_serials.delete_message')}</p>
            <div className="flex items-center gap-3 justify-end">
              <button onClick={() => setDeletingId(null)}
                className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-slate-800 rounded-xl hover:bg-gray-200 dark:hover:bg-slate-700 transition-colors">
                {t('common.cancel')}
              </button>
              <button onClick={() => handleDelete(deletingId)}
                className="px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-xl hover:bg-red-700 transition-colors flex items-center gap-2">
                <Trash2 className="w-4 h-4" /> {t('scratch_card_serials.delete_confirm')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Permanent Delete Confirm Modal */}
      {permanentDeleteId !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-xl border border-gray-100 dark:border-slate-800 p-6 w-full max-w-sm">
            <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100 mb-2">{t('scratch_card_serials.permanent_delete_title')}</h3>
            <p className="text-sm text-gray-500 mb-6">{t('scratch_card_serials.permanent_delete_message')}</p>
            <div className="flex items-center gap-3 justify-end">
              <button onClick={() => setPermanentDeleteId(null)}
                className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-slate-800 rounded-xl hover:bg-gray-200 dark:hover:bg-slate-700 transition-colors">
                {t('common.cancel')}
              </button>
              <button onClick={() => handlePermanentDelete(permanentDeleteId)}
                className="px-4 py-2 text-sm font-medium text-white bg-orange-600 rounded-xl hover:bg-orange-700 transition-colors flex items-center gap-2">
                <AlertTriangle className="w-4 h-4" /> {t('scratch_card_serials.permanent_delete_confirm')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bulk Permanent Delete Confirm Modal */}
      {showBulkDeleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-xl border border-gray-100 dark:border-slate-800 p-6 w-full max-w-sm">
            <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100 mb-2">{t('scratch_card_serials.bulk_perm_delete_title', { count: selectedIds.length })}</h3>
            <p className="text-sm text-gray-500 mb-6">{t('scratch_card_serials.bulk_perm_delete_message')}</p>
            <div className="flex items-center gap-3 justify-end">
              <button onClick={() => setShowBulkDeleteConfirm(false)}
                className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-slate-800 rounded-xl hover:bg-gray-200 dark:hover:bg-slate-700 transition-colors">
                {t('common.cancel')}
              </button>
              <button onClick={handleBulkPermanentDelete}
                className="px-4 py-2 text-sm font-medium text-white bg-orange-600 rounded-xl hover:bg-orange-700 transition-colors flex items-center gap-2">
                <AlertTriangle className="w-4 h-4" /> {t('scratch_card_serials.delete_all')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bulk Delete Confirm Modal */}
      {showBulkDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-xl border border-gray-100 dark:border-slate-800 p-6 w-full max-w-sm">
            <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100 mb-2">{t('scratch_card_serials.bulk_delete_title', { count: selectedIds.length })}</h3>
            <p className="text-sm text-gray-500 mb-6">{t('scratch_card_serials.bulk_delete_message')}</p>
            <div className="flex items-center gap-3 justify-end">
              <button onClick={() => setShowBulkDelete(false)}
                className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-slate-800 rounded-xl hover:bg-gray-200 dark:hover:bg-slate-700 transition-colors">
                {t('common.cancel')}
              </button>
              <button onClick={handleBulkDelete}
                className="px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-xl hover:bg-red-700 transition-colors flex items-center gap-2">
                <Trash2 className="w-4 h-4" /> {t('scratch_card_serials.delete_all')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Import Modal */}
      {showImport && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-xl border border-gray-100 dark:border-slate-800 p-6 w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100">{t('scratch_card_serials.modal_import_title')}</h3>
              <button onClick={() => {
                setShowImport(false);
                setImportBatch("");
                setModalHouseId("");
                setImportResult(null);
                setInvoiceRows([{ productId: "", startSerial: "", endSerial: "", qty: "", exitOrderNo: "", rfNo: "" }]);
              }} className="p-1 text-gray-400 hover:text-gray-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* House + Batch ID (common) */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('scratch_card_serials.field_house')}</label>
                <select value={modalHouseId} onChange={e => setModalHouseId(e.target.value ? Number(e.target.value) : "")}
                  className="w-full px-3 py-2 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-xl text-sm text-gray-700 dark:text-gray-300 focus:outline-none focus:ring-2 focus:ring-primary-500/20">
                  <option value="">{t('common.select_house')}</option>
                  {houses.map(h => (
                    <option key={h.id} value={h.id}>{h.name} ({h.code})</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('scratch_card_serials.field_batch_id')}</label>
                <input value={importBatch} readOnly
                  className="w-full px-3 py-2 bg-gray-50 dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-xl text-sm text-gray-500 dark:text-gray-400 font-mono cursor-not-allowed"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('scratch_card_serials.field_exit_order_no')}</label>
                <input value={invoiceRows[0]?.exitOrderNo || ""} onChange={e => {
                  const rows = [...invoiceRows];
                  rows.forEach(r => r.exitOrderNo = e.target.value);
                  setInvoiceRows(rows);
                }} placeholder="EX26DHK68xxx"
                  className="w-full px-3 py-2 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-xl text-sm text-gray-700 dark:text-gray-300 focus:outline-none focus:ring-2 focus:ring-primary-500/20"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('scratch_card_serials.field_rf_no')}</label>
                <input value={invoiceRows[0]?.rfNo || ""} onChange={e => {
                  const rows = [...invoiceRows];
                  rows.forEach(r => r.rfNo = e.target.value);
                  setInvoiceRows(rows);
                }} placeholder={t('scratch_card_serials.field_rf_no_placeholder')}
                  className="w-full px-3 py-2 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-xl text-sm text-gray-700 dark:text-gray-300 focus:outline-none focus:ring-2 focus:ring-primary-500/20"
                />
              </div>
            </div>

            <div className="space-y-4">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-100 dark:border-slate-800">
                        <th className="text-left px-2 py-2 font-semibold text-gray-600 dark:text-gray-400 text-xs uppercase w-28">{t('scratch_card_serials.field_product')}</th>
                        <th className="text-left px-2 py-2 font-semibold text-gray-600 dark:text-gray-400 text-xs uppercase">{t('scratch_card_serials.field_start_serial')}</th>
                        <th className="text-left px-2 py-2 font-semibold text-gray-600 dark:text-gray-400 text-xs uppercase">{t('scratch_card_serials.field_end_serial')}</th>
                        <th className="text-left px-2 py-2 font-semibold text-gray-600 dark:text-gray-400 text-xs uppercase w-28">{t('scratch_card_serials.field_qty')}</th>
                        <th className="w-10" />
                      </tr>
                    </thead>
                    <tbody>
                      {invoiceRows.map((row, i) => {
                        return (
                          <tr key={i} className="border-b border-gray-50 dark:border-slate-800/50">
                            <td className="px-2 py-1.5">
                              <select value={row.productId} onChange={e => {
                                const rows = [...invoiceRows];
                                rows[i].productId = e.target.value ? Number(e.target.value) : "";
                                setInvoiceRows(rows);
                              }}
                                className="w-full px-2 py-1.5 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-lg text-sm text-gray-700 dark:text-gray-300 focus:outline-none focus:ring-2 focus:ring-primary-500/20">
                                <option value="">{t('scratch_card_serials.modal_select')}</option>
                                {products.map(p => (
                                  <option key={p.id} value={p.id}>{p.product_code} - {p.product_name} ({p.mrp}tk)</option>
                                ))}
                              </select>
                            </td>
                            <td className="px-2 py-1.5">
                              <input value={row.startSerial} onChange={e => {
                                const rows = [...invoiceRows];
                                rows[i].startSerial = e.target.value;
                                rows[i].endSerial = "";
                                rows[i].qty = "";
                                setInvoiceRows(rows);
                              }} placeholder="503880790190"
                                className="w-full px-2 py-1.5 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-lg text-sm font-mono text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary-500/20"
                              />
                            </td>
                            <td className="px-2 py-1.5">
                              <input value={row.endSerial} onChange={e => {
                                const rows = [...invoiceRows];
                                rows[i].endSerial = e.target.value;
                                if (rows[i].startSerial && rows[i].endSerial) {
                                  try {
                                    const s = BigInt(rows[i].startSerial);
                                    const e = BigInt(rows[i].endSerial);
                                    if (e >= s) rows[i].qty = String(e - s + BigInt(1));
                                  } catch {}
                                }
                                setInvoiceRows(rows);
                              }} placeholder="503880795189"
                                className="w-full px-2 py-1.5 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-lg text-sm font-mono text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary-500/20"
                              />
                            </td>
                            <td className="px-2 py-1.5">
                              <input value={row.qty} onChange={e => {
                                const rows = [...invoiceRows];
                                rows[i].qty = e.target.value;
                                if (rows[i].startSerial && rows[i].qty) {
                                  try {
                                    const s = BigInt(rows[i].startSerial);
                                    const q = BigInt(rows[i].qty);
                                    if (q > BigInt(0)) rows[i].endSerial = String(s + q - BigInt(1));
                                  } catch {}
                                }
                                setInvoiceRows(rows);
                              }} placeholder="5000"
                                className="w-full px-2 py-1.5 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-lg text-sm font-mono text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary-500/20"
                              />
                            </td>
                            <td className="px-2 py-1.5">
                              {invoiceRows.length > 1 && (
                                <button onClick={() => {
                                  setInvoiceRows(rows => rows.filter((_, j) => j !== i));
                                }} className="p-1 text-gray-400 hover:text-red-500 rounded transition-colors">
                                  <X className="w-3.5 h-3.5" />
                                </button>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <button onClick={() => setInvoiceRows(rows => [...rows, { productId: "", startSerial: "", endSerial: "", qty: "", exitOrderNo: "", rfNo: "" }])}
                  className="flex items-center gap-2 px-3 py-1.5 text-sm text-primary-600 hover:text-primary-700 font-medium transition-colors cursor-pointer">
                  <Plus className="w-4 h-4" /> {t('scratch_card_serials.add_row')}
                </button>
                {importResult && (
                  <div className={`rounded-xl border p-4 mt-3 ${importResult.skipped > 0
                    ? "border-amber-200 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-500/10"
                    : "border-emerald-200 dark:border-emerald-500/30 bg-emerald-50 dark:bg-emerald-500/10"}`}>
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-sm text-gray-900 dark:text-gray-100">
                        {importResult.skipped > 0 ? t('scratch_card_serials.import_finished_duplicates') : t('scratch_card_serials.import_successful')}
                      </span>
                      {importResult.skipped > 0 && (
                        <span className="text-[11px] px-2 py-0.5 rounded-md bg-amber-500/15 text-amber-700 dark:text-amber-400 font-semibold">
                          {t('scratch_card_serials.n_skipped', { count: importResult.skipped })}
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-gray-600 dark:text-gray-300 mt-1">
                      {t(`scratch_card_serials.import_inserted_${plural(importResult.inserted)}`, { count: importResult.inserted })}
                      {importResult.skipped > 0
                        ? ` · ${t(`scratch_card_serials.import_dup_skip_${plural(importResult.skipped)}`, { count: importResult.skipped })}`
                        : ""}
                    </p>
                    {importResult.skipped > 0 && importResult.skippedSerials.length > 0 && (
                      <div className="mt-2">
                        <p className="text-[11px] font-medium text-gray-500 dark:text-gray-400 mb-1">
                          {t('scratch_card_serials.skipped_serials_list', {
                            count: `${importResult.skippedSerials.length}${importResult.skipped > importResult.skippedSerials.length ? "+" : ""}`,
                          })}
                        </p>
                        <div className="flex flex-wrap gap-1.5">
                          {importResult.skippedSerials.map((sn, i) => (
                            <span key={i} className="px-2 py-0.5 rounded-md bg-white dark:bg-slate-800 border border-amber-200 dark:border-amber-500/25 text-[11px] font-mono text-gray-700 dark:text-gray-300">
                              {sn}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-500">{t('scratch_card_serials.import_total_label')} <strong className="text-gray-900 dark:text-gray-100">{calcInvoiceTotal().toLocaleString()}</strong> {t('scratch_card_serials.import_serials_word')}</span>
                  <div className="flex gap-2">
                    <button onClick={() => {
                      setShowImport(false);
                      setImportResult(null);
                      setInvoiceRows([{ productId: "", startSerial: "", endSerial: "", qty: "", exitOrderNo: "", rfNo: "" }]);
                    }} className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-slate-800 rounded-xl hover:bg-gray-200 dark:hover:bg-slate-700 transition-colors">
                      {t('common.cancel')}
                    </button>
                    <button onClick={handleInvoiceImport} disabled={importing}
                      className="flex items-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-xl text-sm font-medium hover:bg-primary-700 disabled:opacity-50 transition-colors">
                      {importing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                      {importing ? t('scratch_card_serials.importing') : t('scratch_card_serials.import_n_serials', { count: calcInvoiceTotal().toLocaleString() })}
                    </button>
                  </div>
                </div>
              </div>
          </div>
        </div>
      )}

      {/* Allocate Modal */}
      {showAllocate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-xl border border-gray-100 dark:border-slate-800 p-6 w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100">{t('scratch_card_serials.allocate')}</h3>
              <button onClick={() => { setShowAllocate(false); setAllocResult(null); setAllocError(""); setAllocNotes(""); }}
                className="p-1 text-gray-400 hover:text-gray-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* House Select */}
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('scratch_card_serials.field_house')}</label>
              <select value={allocHouseId} onChange={e => setAllocHouseId(e.target.value ? Number(e.target.value) : "")}
                className="w-full px-3 py-2 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-xl text-sm text-gray-700 dark:text-gray-300 focus:outline-none focus:ring-2 focus:ring-primary-500/20">
                <option value="">{t('common.select_house')}</option>
                {houses.map(h => (
                  <option key={h.id} value={h.id}>{h.name} ({h.code})</option>
                ))}
              </select>
            </div>

            {/* Amount Input */}
            <div className="flex items-end gap-3 mb-4">
              <div className="flex-1">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('scratch_card_serials.request_amount')}</label>
                <input
                  type="number"
                  min="1"
                  value={allocAmount}
                  onChange={e => setAllocAmount(e.target.value)}
                  placeholder={t('scratch_card_serials.alloc_amount_placeholder')}
                  className="w-full px-3 py-2 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-xl text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary-500/20"
                />
              </div>
              <button onClick={handleFindSerials} disabled={allocating}
                className="flex items-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-xl text-sm font-medium hover:bg-primary-700 disabled:opacity-50 transition-colors">
                {allocating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                {allocating ? t('scratch_card_serials.searching') : t('scratch_card_serials.allocate_btn')}
              </button>
            </div>

            {/* Error */}
            {allocError && (
              <div className="p-3 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 rounded-xl text-sm text-red-600 dark:text-red-400 mb-4">
                {allocError}
              </div>
            )}

            {/* Result */}
            {allocResult && (
              <>
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-4 text-sm">
                    <span className="text-gray-500">{t('scratch_card_serials.alloc_requested_label')} <strong className="text-gray-900 dark:text-gray-100">{allocResult.requested_amount} {t('scratch_card_serials.taka')}</strong></span>
                    <span className="text-emerald-600 font-medium">{t('scratch_card_serials.alloc_fulfilled')} {allocResult.fulfilled_amount} {t('scratch_card_serials.taka')}</span>
                  </div>
                  <button onClick={() => {
                    const text = allocResult.ranges.map((r: any) =>
                      `${r.product_name || r.product_code || `Product #${r.product_id}`}: ${r.start_serial} - ${r.end_serial} (${r.count} pcs, ${r.total_value}tk)`
                    ).join("\n");
                    navigator.clipboard.writeText(text);
                    toast.success(t('scratch_card_serials.copied_to_clipboard'));
                  }}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-600 dark:text-gray-400 bg-gray-100 dark:bg-slate-800 rounded-lg hover:bg-gray-200 dark:hover:bg-slate-700 transition-colors">
                    <Copy className="w-3.5 h-3.5" /> {t('scratch_card_serials.copy_all')}
                  </button>
                </div>

                <div className="overflow-x-auto mb-4">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-100 dark:border-slate-800">
                        <th className="text-left px-2 py-2 font-semibold text-gray-600 dark:text-gray-400 text-xs uppercase">{t('scratch_card_serials.field_product')}</th>
                        <th className="text-left px-2 py-2 font-semibold text-gray-600 dark:text-gray-400 text-xs uppercase">{t('scratch_card_serials.amount')}</th>
                        <th className="text-left px-2 py-2 font-semibold text-gray-600 dark:text-gray-400 text-xs uppercase">{t('scratch_card_serials.field_start_serial')}</th>
                        <th className="text-left px-2 py-2 font-semibold text-gray-600 dark:text-gray-400 text-xs uppercase">{t('scratch_card_serials.field_end_serial')}</th>
                        <th className="text-center px-2 py-2 font-semibold text-gray-600 dark:text-gray-400 text-xs uppercase">{t('scratch_card_serials.count')}</th>
                        <th className="text-right px-2 py-2 font-semibold text-gray-600 dark:text-gray-400 text-xs uppercase">{t('common.total')}</th>
                        <th className="w-10 px-2 py-2" />
                      </tr>
                    </thead>
                    <tbody>
                      {allocResult.ranges.map((r: any, i: number) => (
                        <tr key={i} className="border-b border-gray-50 dark:border-slate-800/50">
                          <td className="px-2 py-1.5">
                            <p className="font-medium text-gray-900 dark:text-gray-100">{r.product_name || t('scratch_card_serials.product_hash', { id: r.product_id })}</p>
                            <p className="text-[11px] text-gray-500">{r.product_code}</p>
                          </td>
                          <td className="px-2 py-1.5 text-gray-700 dark:text-gray-300">{r.amount}tk</td>
                          <td className="px-2 py-1.5 font-mono text-xs text-gray-900 dark:text-gray-100">{r.start_serial}</td>
                          <td className="px-2 py-1.5 font-mono text-xs text-gray-900 dark:text-gray-100">{r.end_serial}</td>
                          <td className="px-2 py-1.5 text-center text-gray-700 dark:text-gray-300">{r.count}</td>
                          <td className="px-2 py-1.5 text-right font-medium text-gray-900 dark:text-gray-100">{r.total_value}</td>
                          <td className="px-2 py-1.5">
                            <button onClick={() => {
                              const txt = `${r.start_serial} - ${r.end_serial}`;
                              navigator.clipboard.writeText(txt);
                              toast.success(t('scratch_card_serials.copied'));
                            }}
                              className="p-1 text-gray-400 hover:text-primary-600 rounded transition-colors"
                              title={t('scratch_card_serials.copy_range')}>
                              <Copy className="w-3.5 h-3.5" />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="mb-4">
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('scratch_card_serials.field_notes')}</label>
                  <textarea
                    value={allocNotes}
                    onChange={e => setAllocNotes(e.target.value)}
                    placeholder={t('scratch_card_serials.alloc_notes_placeholder')}
                    rows={2}
                    className="w-full px-3 py-2 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-xl text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary-500/20 resize-none"
                  />
                </div>

                <div className="flex items-center justify-end gap-2">
                  <button onClick={() => { setShowAllocate(false); setAllocResult(null); setAllocError(""); setAllocNotes(""); }}
                    className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-slate-800 rounded-xl hover:bg-gray-200 dark:hover:bg-slate-700 transition-colors">
                    {t('common.cancel')}
                  </button>
                  <button onClick={handleConfirmAllocation} disabled={confirming}
                    className="flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white rounded-xl text-sm font-medium hover:bg-emerald-700 disabled:opacity-50 transition-colors">
                    {confirming ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                    {confirming ? t('scratch_card_serials.confirming') : t('scratch_card_serials.confirm_allocation')}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Export House Select */}
      {showExportHouse && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-xl border border-gray-100 dark:border-slate-800 p-6 w-full max-w-sm">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100">{t('scratch_card_serials.export_title')}</h3>
              <button onClick={() => setShowExportHouse(false)} className="p-1 text-gray-400 hover:text-gray-600">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('common.select_house')}</label>
              <select value={exportHouseId} onChange={e => setExportHouseId(e.target.value ? Number(e.target.value) : "")}
                className="w-full px-3 py-2 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-xl text-sm text-gray-700 dark:text-gray-300 focus:outline-none focus:ring-2 focus:ring-primary-500/20">
                <option value="">{t('common.select_house')}</option>
                {houses.map(h => (
                  <option key={h.id} value={h.id}>{h.name} ({h.code})</option>
                ))}
              </select>
            </div>
            <div className="flex items-center justify-end gap-2">
              <button onClick={() => setShowExportHouse(false)}
                className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-slate-800 rounded-xl hover:bg-gray-200 dark:hover:bg-slate-700 transition-colors">
                {t('common.cancel')}
              </button>
              <button onClick={async () => {
                if (!exportHouseId) { toast.error(t('scratch_card_serials.toast_select_house')); return; }
                setShowExportHouse(false);
                await handleExport(Number(exportHouseId));
              }}
                className="flex items-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-xl text-sm font-medium hover:bg-primary-700 transition-colors">
                <Download className="w-4 h-4" /> {t('scratch_card_serials.btn_export')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* House Detail Modal */}
      {showDetailModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-xl border border-gray-100 dark:border-slate-800 p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100">
                {detailData ? `${detailData.house_name} (${detailData.house_code})` : t('scratch_card_serials.house_details')}
              </h3>
              <button onClick={() => { setShowDetailModal(false); setDetailData(null); }} className="p-1 text-gray-400 hover:text-gray-600">
                <X className="w-5 h-5" />
              </button>
            </div>
            {detailLoading ? (
              <div className="space-y-3">
                {Array.from({ length: 3 }).map((_, i) => (
                  <div key={i} className="h-14 bg-gray-100 dark:bg-slate-800 rounded-xl animate-pulse" />
                ))}
              </div>
            ) : detailData ? (
              <div className="space-y-2">
                {detailData.products.length === 0 ? (
                  <p className="text-sm text-gray-400 text-center py-6">{t('scratch_card_serials.no_products')}</p>
                ) : (
                  detailData.products.map((p: any) => (
                    <div key={p.product_id} className="p-3 bg-gray-50 dark:bg-slate-800/50 rounded-xl">
                      <div className="flex items-center justify-between mb-2">
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">{p.product_name}</p>
                          <p className="text-[11px] text-gray-400 truncate">{p.product_code} · MRP: ৳{p.mrp}</p>
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div className="bg-white dark:bg-slate-900 rounded-lg p-2.5 border border-emerald-100 dark:border-emerald-900/30">
                          <p className="text-[11px] text-gray-400 mb-0.5">{t('scratch_card_serials.filter_available')}</p>
                          <p className="text-sm font-bold text-emerald-600">{t('scratch_card_serials.qty_label')} {p.available_qty.toLocaleString('en-US')}</p>
                          <p className="text-xs font-semibold text-emerald-500">৳ {p.available_amount.toLocaleString('en-US')}</p>
                        </div>
                        <div className="bg-white dark:bg-slate-900 rounded-lg p-2.5 border border-gray-100 dark:border-slate-700">
                          <p className="text-[11px] text-gray-400 mb-0.5">{t('scratch_card_serials.filter_used')}</p>
                          <p className="text-sm font-bold text-gray-600 dark:text-gray-300">{t('scratch_card_serials.qty_label')} {p.used_qty.toLocaleString('en-US')}</p>
                          <p className="text-xs font-semibold text-gray-500">৳ {p.used_amount.toLocaleString('en-US')}</p>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            ) : (
              <p className="text-sm text-gray-400 text-center py-6">{t('scratch_card_serials.load_failed')}</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function MobileRow({ data, selectedIds, toggleSelect, hasDelete, formatDate, timeAgo, setPermanentDeleteId, setDeletingId }: {
  data: SerialRecord[]; selectedIds: number[]; toggleSelect: (id: number) => void;
  hasDelete: boolean; formatDate: (d: Date) => string; timeAgo: (d: Date) => string;
  setPermanentDeleteId: (id: number) => void; setDeletingId: (id: number) => void;
}) {
  const { t } = useLanguage();
  const [expandedId, setExpandedId] = useState<number | null>(null);
  return (
    <>
      {data.map(r => (
        <div key={r.id} className="px-4 py-3">
          <div
            onClick={() => setExpandedId(expandedId === r.id ? null : r.id)}
            className="flex items-center gap-3 w-full text-left cursor-pointer">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                {hasDelete && (
                  <Checkbox
                    checked={selectedIds.includes(r.id)}
                    onCheckedChange={() => toggleSelect(r.id)}
                    className="border-gray-400 data-[state=checked]:bg-orange-600 data-[state=checked]:border-orange-600"
                  />
                )}
                <span className={`font-mono text-xs font-medium ${r.status === "used" ? "line-through text-gray-400 dark:text-gray-500" : "text-indigo-600 dark:text-indigo-400"}`}>
                  {r.serial_number}
                </span>
                {r.status === "used" && <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />}
              </div>
              <p className="text-[11px] text-gray-500 mt-0.5">{r.product_name || t('scratch_card_serials.product_hash', { id: r.product_id })}</p>
            </div>
            {expandedId === r.id ? <ChevronUp className="w-4 h-4 text-gray-400 shrink-0" /> : <ChevronDown className="w-4 h-4 text-gray-400 shrink-0" />}
          </div>
          {expandedId === r.id && (
            <div className="mt-3 ml-2 space-y-2 text-sm text-gray-600 dark:text-gray-400">
              <div className="grid grid-cols-2 gap-2">
                <div><span className="text-[11px] text-gray-500">{t('scratch_card_serials.table_batch')}:</span> <span className="font-medium">{r.batch_id || "-"}</span></div>
                <div className="col-span-2">
                  <span className="text-[11px] text-gray-500">{t('scratch_card_serials.table_order_rf')}:</span>
                  <p className="font-medium text-xs mt-0.5">{r.exit_order_no || "-"} {r.rf_no ? <span className="text-gray-400 font-normal">/ {r.rf_no}</span> : ""}</p>
                </div>
                <div><span className="text-[11px] text-gray-500">{t('scratch_card_serials.table_used_at')}:</span> <span className="font-medium">{r.used_at ? formatDate(new Date(r.used_at)) : "-"}</span></div>
                <div><span className="text-[11px] text-gray-500">{t('scratch_card_serials.table_used_by')}:</span> <span className="font-medium">{r.used_by_name || "-"}</span></div>
                <div><span className="text-[11px] text-gray-500">{t('scratch_card_serials.table_created')}:</span> <span className="font-medium">{r.created_at ? formatDate(new Date(r.created_at)) : "-"}</span></div>
                <div><span className="text-[11px] text-gray-500">{t('scratch_card_serials.table_updated')}:</span> <span className="font-medium">{r.updated_at ? formatDate(new Date(r.updated_at)) : "-"}</span></div>
              </div>
              {hasDelete && (
                <div className="flex gap-2 pt-1">
                  {r.status === "used" ? (
                    <button onClick={() => setPermanentDeleteId(r.id)} className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium bg-orange-100 dark:bg-orange-500/20 text-orange-700 dark:text-orange-300 rounded-lg hover:bg-orange-200 cursor-pointer">
                      <AlertTriangle className="w-3 h-3" /> {t('scratch_card_serials.btn_permanent_delete')}
                    </button>
                  ) : (
                    <button onClick={() => setDeletingId(r.id)} className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium bg-red-100 dark:bg-red-500/20 text-red-700 dark:text-red-300 rounded-lg hover:bg-red-200 cursor-pointer">
                      <Trash2 className="w-3 h-3" /> {t('scratch_card_serials.btn_delete')}
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      ))}
    </>
  );
}
