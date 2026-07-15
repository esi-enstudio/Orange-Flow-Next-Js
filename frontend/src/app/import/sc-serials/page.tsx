"use client";
import { useState, useEffect, useCallback } from "react";
import { Search, Download, X, Loader2, Database, ChevronLeft, ChevronRight, Plus, Trash2, Upload, AlertTriangle, CheckCircle2, Copy } from "lucide-react";
import { toast } from "react-hot-toast";
import apiClient from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { AccessDenied } from "@/components/ui/AccessDenied";
import { Checkbox } from "@/components/ui/checkbox";
import { useLanguage } from "@/i18n/useLanguage";

interface SerialRecord {
  id: number; house_id: number; product_id: number;
  product_name: string | null; product_code: string | null;
  serial_number: string;
  status: string; batch_id: string | null; notes: string | null;
  used_at: string | null; used_by: number | null;
  used_by_name: string | null; used_by_role: string | null;
  created_at: string; updated_at: string;
}

interface StockSummary {
  house_id: number; house_name: string; house_code: string;
  product_id: number; product_name: string; product_code: string;
  available: number; used: number; allocated: number; total: number;
}

interface House {
  id: number; name: string; code: string;
}

interface InvoiceRow {
  productId: number | ""; startSerial: string; endSerial: string;
}

interface Product {
  id: number; product_code: string; product_name: string; mrp: number; category: string; status: string;
}

export default function SCSerialsPage() {
  const { hasPermission, loading: authLoading, selectedHouse } = useAuth();
  const { t } = useLanguage();

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
  const [filterBatch, setFilterBatch] = useState("");

  // stock summary
  const [stockSummary, setStockSummary] = useState<StockSummary[]>([]);
  const [summaryLoading, setSummaryLoading] = useState(false);

  // houses for modal selector
  const [houses, setHouses] = useState<House[]>([]);
  const [modalHouseId, setModalHouseId] = useState<number | "">("");

  // batch import modal
  const [showImport, setShowImport] = useState(false);
  const [importBatch, setImportBatch] = useState("");
  const [importing, setImporting] = useState(false);
  const [invoiceRows, setInvoiceRows] = useState<InvoiceRow[]>([
    { productId: "", startSerial: "", endSerial: "" },
  ]);

  // products for dropdown
  const [products, setProducts] = useState<Product[]>([]);

  // delete confirm
  const [deletingId, setDeletingId] = useState<number | null>(null);

  // permanent delete confirm
  const [permanentDeleteId, setPermanentDeleteId] = useState<number | null>(null);

  // bulk permanent delete
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [showBulkDeleteConfirm, setShowBulkDeleteConfirm] = useState(false);

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

  const monthDateRange = () => {
    const now = new Date();
    const y = now.getFullYear();
    const m = now.getMonth();
    const first = `${y}-${String(m + 1).padStart(2, '0')}-01`;
    const lastDay = new Date(y, m + 1, 0).getDate();
    const last = `${y}-${String(m + 1).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
    return { dateFrom: first, dateTo: last };
  };

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const { dateFrom, dateTo } = monthDateRange();
      const params: Record<string, string | number> = { page, per_page: perPage, sort_order: "desc", date_from: dateFrom, date_to: dateTo };
      if (search) params.search = search;
      if (filterProductId) params.product_id = Number(filterProductId);
      if (filterStatus) params.status = filterStatus;
      if (filterBatch) params.batch_id = filterBatch;
      const res = await apiClient.get("/v1/scratch-card-serials", { params, headers: houseHeaders });
      setData(res.data.data || []);
      setTotalRecords(res.data.pagination?.total || 0);
    } catch { toast.error("Failed to load serials"); }
    finally { setLoading(false); }
  }, [page, search, filterProductId, filterStatus, filterBatch, selectedHouse?.id]);

  const fetchSummary = useCallback(async () => {
    setSummaryLoading(true);
    try {
      const res = await apiClient.get("/v1/scratch-card-serials/stock/summary", { headers: houseHeaders });
      setStockSummary(Array.isArray(res.data.data) ? res.data.data : []);
    } catch { /* silent */ }
    finally { setSummaryLoading(false); }
  }, [selectedHouse?.id]);

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
  useEffect(() => { setPage(1); }, [search, filterProductId, filterStatus, filterBatch]);

  const handleExport = async (houseId: number) => {
    try {
      const headers: Record<string, string> = { "X-House-ID": String(houseId) };
      const params: Record<string, string> = {};
      if (filterProductId) params.product_id = filterProductId;
      if (filterBatch) params.batch_id = filterBatch;
      const res = await apiClient.get("/v1/scratch-card-serials/export/list", {
        params, headers, responseType: "blob",
      });
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const a = document.createElement("a"); a.href = url; a.download = "scratch_card_serials.xlsx"; a.click();
      window.URL.revokeObjectURL(url);
      toast.success("Exported successfully");
    } catch { toast.error("Export failed"); }
  };

  const handleDelete = async (id: number) => {
    try {
      await apiClient.delete(`/v1/scratch-card-serials/${id}`, { headers: houseHeaders });
      toast.success(t('scratch_card_serials.toast_delete_success'));
      fetchData();
      fetchSummary();
    } catch (e: any) { toast.error(e?.message || "Delete failed"); }
    finally { setDeletingId(null); }
  };

  const handlePermanentDelete = async (id: number) => {
    try {
      await apiClient.delete(`/v1/scratch-card-serials/${id}/permanent`, { headers: houseHeaders });
      toast.success(t('scratch_card_serials.toast_permanent_delete_success'));
      fetchData();
      fetchSummary();
    } catch (e: any) { toast.error(e?.message || "Permanent delete failed"); }
    finally { setPermanentDeleteId(null); }
  };

  const handleBulkPermanentDelete = async () => {
    if (selectedIds.length === 0) return;
    try {
      await apiClient.post("/v1/scratch-card-serials/bulk-permanent-delete", selectedIds, { headers: houseHeaders });
      toast.success(`${selectedIds.length} used serials permanently deleted`);
      setSelectedIds([]);
      fetchData();
      fetchSummary();
    } catch (e: any) { toast.error(e?.message || "Bulk permanent delete failed"); }
    finally { setShowBulkDeleteConfirm(false); }
  };

  const toggleSelect = (id: number) => {
    setSelectedIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  };

  const toggleSelectAll = async () => {
    const usedIds = data.filter(r => r.status === "used").map(r => r.id);
    if (usedIds.length === 0) return;
    const allSelected = usedIds.every(id => selectedIds.includes(id));
    if (!allSelected) {
      try {
        const { dateFrom, dateTo } = monthDateRange();
      const params: Record<string, string | number> = { per_page: 10000, sort_order: "desc", date_from: dateFrom, date_to: dateTo };
        if (search) params.search = search;
        if (filterProductId) params.product_id = Number(filterProductId);
        if (filterBatch) params.batch_id = filterBatch;
        const res = await apiClient.get("/v1/scratch-card-serials", { params, headers: houseHeaders });
        const allUsedIds = (res.data.data || []).filter((r: SerialRecord) => r.status === "used").map((r: SerialRecord) => r.id);
        setSelectedIds(allUsedIds);
      } catch { setSelectedIds([...usedIds]); }
    } else {
      setSelectedIds([]);
    }
  };

  const calcInvoiceTotal = (): number => {
    let total = 0;
    for (const row of invoiceRows) {
      if (row.productId && row.startSerial && row.endSerial) {
        const s = BigInt(row.startSerial);
        const e = BigInt(row.endSerial);
        if (e >= s && e - s <= BigInt(100000)) total += Number(e - s + BigInt(1));
      }
    }
    return total;
  };

  const handleInvoiceImport = async () => {
    if (!modalHouseId) { toast.error("Select a house"); return; }

    const productMap = new Map<number, { product: Product; serials: string[]; len: number }>();
    for (const row of invoiceRows) {
      if (!row.productId || !row.startSerial || !row.endSerial) continue;
      const s = BigInt(row.startSerial);
      const e = BigInt(row.endSerial);
      if (e < s) {
        const p = products.find(x => x.id === row.productId);
        toast.error(`Invalid range for ${p?.product_code || row.productId}: start > end`);
        return;
      }
      if (e - s > BigInt(100000)) {
        const p = products.find(x => x.id === row.productId);
        toast.error(`Range too large for ${p?.product_code || row.productId} (max 100,000)`);
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

    if (!productMap.size) { toast.error("No valid rows entered"); return; }

    setImporting(true);
    const headers: Record<string, string> = { "X-House-ID": String(modalHouseId) };
    let totalInserted = 0;
    try {
      for (const [, entry] of productMap) {
        const res = await apiClient.post("/v1/scratch-card-serials/batch", {
          serials: entry.serials,
          product_id: entry.product.id,
          batch_id: importBatch || null,
        }, { headers });
        totalInserted += entry.serials.length;
      }
      toast.success(`${totalInserted} serials imported (${productMap.size} product${productMap.size > 1 ? 's' : ''})`);
      setShowImport(false);
      setImportBatch("");
      setModalHouseId("");
      setInvoiceRows([{ productId: "", startSerial: "", endSerial: "" }]);
      fetchData();
      fetchSummary();
    } catch (e: any) { toast.error(e?.message || "Import failed"); }
    finally { setImporting(false); }
  };

  const handleFindSerials = async () => {
    if (!allocAmount || Number(allocAmount) < 1) {
      toast.error("Enter a valid amount");
      return;
    }
    if (!allocHouseId) {
      toast.error("Select a house");
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
      const msg = e?.response?.data?.error?.message || e?.response?.data?.detail || e?.message || "Failed to allocate";
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
      toast.success(res.data.message || "Allocation confirmed");
      setAllocResult(null);
      setAllocAmount("");
      setAllocNotes("");
      fetchData();
      fetchSummary();
    } catch (e: any) {
      toast.error(e?.response?.data?.detail || e?.message || "Confirmation failed");
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
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    if (days < 30) return `${days}d ago`;
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
            <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">SC Serials</h1>
            <p className="text-sm text-gray-500">Manage scratch card serial numbers</p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {hasPermission("scratch_card_serials.create") && (
              <button onClick={async () => {
                setShowImport(true);
                setModalHouseId("");
                try {
                  const res = await apiClient.get("/v1/scratch-card-serials/batch-id/generate");
                  setImportBatch(res.data.data?.batch_id || generateBatchId());
                } catch { setImportBatch(generateBatchId()); }
              }}
              className="flex items-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-xl text-sm font-medium hover:bg-primary-700 transition-colors">
              <Plus className="w-4 h-4" /> Add Serials
            </button>
          )}
          {hasPermission("scratch_card_serials.export") && (
            <button onClick={() => { setExportHouseId(""); setShowExportHouse(true); }}
              className="flex items-center gap-2 px-4 py-2 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-xl text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-slate-800 transition-colors">
              <Download className="w-4 h-4" /> Export
            </button>
          )}
          {hasPermission("scratch_card_serials.view") && (
            <button onClick={() => { setShowAllocate(true); setAllocAmount(""); setAllocResult(null); setAllocError(""); setAllocNotes(""); }}
              className="flex items-center gap-2 px-4 py-2 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-xl text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-slate-800 transition-colors">
              <Database className="w-4 h-4" /> Allocate
            </button>
          )}
        </div>
      </div>

      {/* Stock Summary */}
      <div className="grid grid-cols-1 sm:grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
        {summaryLoading ? (
          Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="bg-white dark:bg-slate-900 rounded-2xl border border-gray-100 dark:border-slate-800 p-4 animate-pulse">
              <div className="h-3 w-16 bg-gray-200 dark:bg-slate-700 rounded mb-3" />
              <div className="h-6 w-12 bg-gray-200 dark:bg-slate-700 rounded" />
            </div>
          ))
        ) : stockSummary.length === 0 ? (
          <div className="col-span-full text-center py-6 text-gray-400 text-sm">No stock data available</div>
        ) : (
          stockSummary.map(s => (
            <div key={`${s.house_id}-${s.product_id}`} className="bg-white dark:bg-slate-900 rounded-2xl border border-gray-100 dark:border-slate-800 p-4">
              <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1 truncate">{s.product_name}</p>
              <p className="text-[11px] text-gray-400 mb-1 truncate">{s.product_code}</p>
              <p className="text-[11px] text-primary-600 dark:text-primary-400 mb-2 font-medium">{s.house_name} ({s.house_code})</p>
              <div className="flex items-center justify-between text-sm">
                <span className="text-emerald-600 font-medium">{s.available.toLocaleString('en-US')} avail</span>
                <span className="text-gray-400">/</span>
                <span className="text-gray-500">{s.used.toLocaleString('en-US')} used</span>
              </div>
              <p className="text-[11px] text-gray-400 mt-1">Total: {s.total.toLocaleString('en-US')}</p>
            </div>
          ))
        )}
      </div>

      {/* Filters */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            placeholder="Search serial number..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-9 pr-4 py-2 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-xl text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500"
          />
        </div>
        <select value={filterProductId} onChange={e => setFilterProductId(e.target.value)}
          className="px-3 py-2 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-xl text-sm text-gray-700 dark:text-gray-300 focus:outline-none focus:ring-2 focus:ring-primary-500/20">
          <option value="">All Products</option>
          {products.map(p => (
            <option key={p.id} value={p.id}>{p.product_code} - {p.product_name}</option>
          ))}
        </select>
        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
          className="px-3 py-2 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-xl text-sm text-gray-700 dark:text-gray-300 focus:outline-none focus:ring-2 focus:ring-primary-500/20">
          <option value="">All Status</option>
          <option value="available">Available</option>
          <option value="used">Used</option>
          <option value="allocated">Allocated</option>
        </select>
        <input
          placeholder="Batch ID"
          value={filterBatch}
          onChange={e => setFilterBatch(e.target.value)}
          className="w-full px-3 py-2 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-xl text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary-500/20"
        />
      </div>

      {/* Bulk Action Bar */}
      {selectedIds.length > 0 && hasPermission("scratch_card_serials.delete") && (
        <div className="flex items-center justify-between bg-orange-50 dark:bg-orange-500/10 border border-orange-200 dark:border-orange-500/20 rounded-2xl px-4 py-3">
          <span className="text-sm font-medium text-orange-700 dark:text-orange-300">
            {selectedIds.length} used serial selected
          </span>
          <button
            onClick={() => setShowBulkDeleteConfirm(true)}
            className="flex items-center gap-2 px-4 py-2 bg-orange-600 text-white rounded-xl text-sm font-medium hover:bg-orange-700 transition-colors"
          >
            <AlertTriangle className="w-4 h-4" /> Delete Selected
          </button>
        </div>
      )}

      {/* Table */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-gray-100 dark:border-slate-800 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 dark:border-slate-800">
                <th className="w-10 px-2 py-3">
                  {hasPermission("scratch_card_serials.delete") && (
                    <Checkbox
                      checked={selectedIds.length > 0 && data.filter(r => r.status === "used").every(r => selectedIds.includes(r.id))}
                      onCheckedChange={toggleSelectAll}
                      className="border-gray-400 data-[state=checked]:bg-orange-600 data-[state=checked]:border-orange-600"
                    />
                  )}
                </th>
                <th className="text-left px-4 py-3 font-semibold text-gray-600 dark:text-gray-400 text-xs uppercase">Serial #</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-600 dark:text-gray-400 text-xs uppercase">Product</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-600 dark:text-gray-400 text-xs uppercase">Batch</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-600 dark:text-gray-400 text-xs uppercase">Notes</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-600 dark:text-gray-400 text-xs uppercase">Used At</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-600 dark:text-gray-400 text-xs uppercase">Used By</th>
                <th className="text-right px-4 py-3 font-semibold text-gray-600 dark:text-gray-400 text-xs uppercase">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i} className="border-b border-gray-50 dark:border-slate-800/50 animate-pulse">
                    {Array.from({ length: 8 }).map((_, j) => (
                      <td key={j} className="px-4 py-3"><div className="h-4 bg-gray-200 dark:bg-slate-700 rounded w-3/4" /></td>
                    ))}
                  </tr>
                ))
              ) : data.length === 0 ? (
                <tr><td colSpan={8} className="text-center py-12 text-gray-400">No serials found</td></tr>
              ) : data.map(r => (
                <tr key={r.id} className={`border-b border-gray-50 dark:border-slate-800/50 hover:bg-gray-50 dark:hover:bg-slate-800/50 transition-colors ${selectedIds.includes(r.id) ? 'bg-orange-50 dark:bg-orange-500/5' : ''}`}>
                  <td className="px-2 py-3">
                    {r.status === "used" && hasPermission("scratch_card_serials.delete") && (
                      <Checkbox
                        checked={selectedIds.includes(r.id)}
                        onCheckedChange={() => toggleSelect(r.id)}
                        className="border-gray-400 data-[state=checked]:bg-orange-600 data-[state=checked]:border-orange-600"
                      />
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <span className={`font-mono text-xs font-medium ${r.status === "used" ? "line-through text-gray-400 dark:text-gray-500" : "text-gray-900 dark:text-gray-100"}`}>
                        {r.serial_number}
                      </span>
                      {r.status === "used" && <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <p className="font-medium text-gray-900 dark:text-gray-100 text-sm">{r.product_name || `Product #${r.product_id}`}</p>
                    <p className="text-[11px] text-gray-500 dark:text-gray-400">{r.product_code || ""}</p>
                  </td>
                  <td className="px-4 py-3 text-gray-500 dark:text-gray-400 text-[11px]">{r.batch_id || "-"}</td>
                  <td className="px-4 py-3 text-gray-500 dark:text-gray-400 text-[11px] max-w-[120px] truncate">{r.notes || "-"}</td>
                    <td className="px-4 py-3">
                      {r.used_at ? (
                        <div>
                          <p className="font-medium text-gray-900 dark:text-gray-100 text-sm">{formatDate(new Date(r.used_at))}</p>
                          <p className="text-[11px] text-gray-500 dark:text-gray-400">{timeAgo(new Date(r.used_at))}</p>
                        </div>
                      ) : (
                        <span className="text-gray-400">-</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {r.used_by_name ? (
                        <div>
                          <p className="font-medium text-gray-900 dark:text-gray-100 text-sm">{r.used_by_name}</p>
                          <p className="text-[11px] text-gray-500 dark:text-gray-400">{r.used_by_role || ""}</p>
                        </div>
                      ) : (
                        <span className="text-gray-400">-</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-1">
                      {hasPermission("scratch_card_serials.delete") && (
                        r.status === "used" ? (
                          <button
                            onClick={() => setPermanentDeleteId(r.id)}
                            title="Permanently delete used serial"
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
        {totalRecords > 0 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100 dark:border-slate-800">
            <span className="text-xs text-gray-400">
              Showing {(page - 1) * perPage + 1} to {Math.min(page * perPage, totalRecords)} of {totalRecords}
            </span>
            <div className="flex items-center gap-2">
              <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1}
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

      {/* Delete Confirm Modal */}
      {deletingId !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-xl border border-gray-100 dark:border-slate-800 p-6 w-full max-w-sm">
            <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100 mb-2">Delete Serial</h3>
            <p className="text-sm text-gray-500 mb-6">Are you sure you want to delete this serial? This cannot be undone.</p>
            <div className="flex items-center gap-3 justify-end">
              <button onClick={() => setDeletingId(null)}
                className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-slate-800 rounded-xl hover:bg-gray-200 dark:hover:bg-slate-700 transition-colors">
                Cancel
              </button>
              <button onClick={() => handleDelete(deletingId)}
                className="px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-xl hover:bg-red-700 transition-colors flex items-center gap-2">
                <Trash2 className="w-4 h-4" /> Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Permanent Delete Confirm Modal */}
      {permanentDeleteId !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-xl border border-gray-100 dark:border-slate-800 p-6 w-full max-w-sm">
            <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100 mb-2">Permanently Delete Used Serial</h3>
            <p className="text-sm text-gray-500 mb-6">This serial is marked as used. Permanently delete it? This cannot be undone.</p>
            <div className="flex items-center gap-3 justify-end">
              <button onClick={() => setPermanentDeleteId(null)}
                className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-slate-800 rounded-xl hover:bg-gray-200 dark:hover:bg-slate-700 transition-colors">
                Cancel
              </button>
              <button onClick={() => handlePermanentDelete(permanentDeleteId)}
                className="px-4 py-2 text-sm font-medium text-white bg-orange-600 rounded-xl hover:bg-orange-700 transition-colors flex items-center gap-2">
                <AlertTriangle className="w-4 h-4" /> Delete Permanently
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bulk Permanent Delete Confirm Modal */}
      {showBulkDeleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-xl border border-gray-100 dark:border-slate-800 p-6 w-full max-w-sm">
            <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100 mb-2">Permanently Delete {selectedIds.length} Serials?</h3>
            <p className="text-sm text-gray-500 mb-6">These serials are marked as used. Permanently delete them? This cannot be undone.</p>
            <div className="flex items-center gap-3 justify-end">
              <button onClick={() => setShowBulkDeleteConfirm(false)}
                className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-slate-800 rounded-xl hover:bg-gray-200 dark:hover:bg-slate-700 transition-colors">
                Cancel
              </button>
              <button onClick={handleBulkPermanentDelete}
                className="px-4 py-2 text-sm font-medium text-white bg-orange-600 rounded-xl hover:bg-orange-700 transition-colors flex items-center gap-2">
                <AlertTriangle className="w-4 h-4" /> Delete All
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
              <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100">Import SC Serials</h3>
              <button onClick={() => {
                setShowImport(false);
                setImportBatch("");
                setModalHouseId("");
                setInvoiceRows([{ productId: "", startSerial: "", endSerial: "" }]);
              }} className="p-1 text-gray-400 hover:text-gray-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* House + Batch ID (common) */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">House</label>
                <select value={modalHouseId} onChange={e => setModalHouseId(e.target.value ? Number(e.target.value) : "")}
                  className="w-full px-3 py-2 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-xl text-sm text-gray-700 dark:text-gray-300 focus:outline-none focus:ring-2 focus:ring-primary-500/20">
                  <option value="">Select house</option>
                  {houses.map(h => (
                    <option key={h.id} value={h.id}>{h.name} ({h.code})</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Batch ID</label>
                <input value={importBatch} readOnly
                  className="w-full px-3 py-2 bg-gray-50 dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-xl text-sm text-gray-500 dark:text-gray-400 font-mono cursor-not-allowed"
                />
              </div>
            </div>

            <div className="space-y-4">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-100 dark:border-slate-800">
                        <th className="text-left px-2 py-2 font-semibold text-gray-600 dark:text-gray-400 text-xs uppercase w-28">Product</th>
                        <th className="text-left px-2 py-2 font-semibold text-gray-600 dark:text-gray-400 text-xs uppercase">Start Serial</th>
                        <th className="text-left px-2 py-2 font-semibold text-gray-600 dark:text-gray-400 text-xs uppercase">End Serial</th>
                        <th className="text-left px-2 py-2 font-semibold text-gray-600 dark:text-gray-400 text-xs uppercase w-16">Qty</th>
                        <th className="w-10" />
                      </tr>
                    </thead>
                    <tbody>
                      {invoiceRows.map((row, i) => {
                        let qty = 0;
                        if (row.startSerial && row.endSerial) {
                          try {
                            const s = BigInt(row.startSerial);
                            const e = BigInt(row.endSerial);
                            if (e >= s) qty = Number(e - s + BigInt(1));
                          } catch {}
                        }
                        return (
                          <tr key={i} className="border-b border-gray-50 dark:border-slate-800/50">
                            <td className="px-2 py-1.5">
                              <select value={row.productId} onChange={e => {
                                const rows = [...invoiceRows];
                                rows[i].productId = e.target.value ? Number(e.target.value) : "";
                                setInvoiceRows(rows);
                              }}
                                className="w-full px-2 py-1.5 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-lg text-sm text-gray-700 dark:text-gray-300 focus:outline-none focus:ring-2 focus:ring-primary-500/20">
                                <option value="">Select</option>
                                {products.map(p => (
                                  <option key={p.id} value={p.id}>{p.product_code} - {p.product_name} ({p.mrp}tk)</option>
                                ))}
                              </select>
                            </td>
                            <td className="px-2 py-1.5">
                              <input value={row.startSerial} onChange={e => {
                                const rows = [...invoiceRows];
                                rows[i].startSerial = e.target.value;
                                setInvoiceRows(rows);
                              }} placeholder="503880790190"
                                className="w-full px-2 py-1.5 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-lg text-sm font-mono text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary-500/20"
                              />
                            </td>
                            <td className="px-2 py-1.5">
                              <input value={row.endSerial} onChange={e => {
                                const rows = [...invoiceRows];
                                rows[i].endSerial = e.target.value;
                                setInvoiceRows(rows);
                              }} placeholder="503880795189"
                                className="w-full px-2 py-1.5 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-lg text-sm font-mono text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary-500/20"
                              />
                            </td>
                            <td className="px-2 py-1.5 text-sm text-gray-500">{qty || "-"}</td>
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
                <button onClick={() => setInvoiceRows(rows => [...rows, { productId: "", startSerial: "", endSerial: "" }])}
                  className="flex items-center gap-2 px-3 py-1.5 text-sm text-primary-600 hover:text-primary-700 font-medium transition-colors">
                  <Plus className="w-4 h-4" /> Add Row
                </button>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-500">Total: <strong className="text-gray-900 dark:text-gray-100">{calcInvoiceTotal().toLocaleString()}</strong> serials</span>
                  <div className="flex gap-2">
                    <button onClick={() => {
                      setShowImport(false);
                      setInvoiceRows([{ productId: "", startSerial: "", endSerial: "" }]);
                    }} className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-slate-800 rounded-xl hover:bg-gray-200 dark:hover:bg-slate-700 transition-colors">
                      Cancel
                    </button>
                    <button onClick={handleInvoiceImport} disabled={importing}
                      className="flex items-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-xl text-sm font-medium hover:bg-primary-700 disabled:opacity-50 transition-colors">
                      {importing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                      {importing ? "Importing..." : `Import ${calcInvoiceTotal().toLocaleString()} Serials`}
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
              <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100">Allocate Serials</h3>
              <button onClick={() => { setShowAllocate(false); setAllocResult(null); setAllocError(""); setAllocNotes(""); }}
                className="p-1 text-gray-400 hover:text-gray-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* House Select */}
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">House</label>
              <select value={allocHouseId} onChange={e => setAllocHouseId(e.target.value ? Number(e.target.value) : "")}
                className="w-full px-3 py-2 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-xl text-sm text-gray-700 dark:text-gray-300 focus:outline-none focus:ring-2 focus:ring-primary-500/20">
                <option value="">Select house</option>
                {houses.map(h => (
                  <option key={h.id} value={h.id}>{h.name} ({h.code})</option>
                ))}
              </select>
            </div>

            {/* Amount Input */}
            <div className="flex items-end gap-3 mb-4">
              <div className="flex-1">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Request Amount (BDT)</label>
                <input
                  type="number"
                  min="1"
                  value={allocAmount}
                  onChange={e => setAllocAmount(e.target.value)}
                  placeholder="e.g. 10000"
                  className="w-full px-3 py-2 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-xl text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary-500/20"
                />
              </div>
              <button onClick={handleFindSerials} disabled={allocating}
                className="flex items-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-xl text-sm font-medium hover:bg-primary-700 disabled:opacity-50 transition-colors">
                {allocating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                {allocating ? "Searching..." : "Find Available Serials"}
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
                    <span className="text-gray-500">Requested: <strong className="text-gray-900 dark:text-gray-100">{allocResult.requested_amount} Taka</strong></span>
                    <span className="text-emerald-600 font-medium">Fulfilled: {allocResult.fulfilled_amount} Taka</span>
                  </div>
                  <button onClick={() => {
                    const text = allocResult.ranges.map((r: any) =>
                      `${r.product_name || r.product_code || `Product #${r.product_id}`}: ${r.start_serial} - ${r.end_serial} (${r.count} pcs, ${r.total_value}tk)`
                    ).join("\n");
                    navigator.clipboard.writeText(text);
                    toast.success("Copied to clipboard");
                  }}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-600 dark:text-gray-400 bg-gray-100 dark:bg-slate-800 rounded-lg hover:bg-gray-200 dark:hover:bg-slate-700 transition-colors">
                    <Copy className="w-3.5 h-3.5" /> Copy All
                  </button>
                </div>

                <div className="overflow-x-auto mb-4">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-100 dark:border-slate-800">
                        <th className="text-left px-2 py-2 font-semibold text-gray-600 dark:text-gray-400 text-xs uppercase">Product</th>
                        <th className="text-left px-2 py-2 font-semibold text-gray-600 dark:text-gray-400 text-xs uppercase">Amount</th>
                        <th className="text-left px-2 py-2 font-semibold text-gray-600 dark:text-gray-400 text-xs uppercase">Start Serial</th>
                        <th className="text-left px-2 py-2 font-semibold text-gray-600 dark:text-gray-400 text-xs uppercase">End Serial</th>
                        <th className="text-center px-2 py-2 font-semibold text-gray-600 dark:text-gray-400 text-xs uppercase">Count</th>
                        <th className="text-right px-2 py-2 font-semibold text-gray-600 dark:text-gray-400 text-xs uppercase">Total</th>
                        <th className="w-10 px-2 py-2" />
                      </tr>
                    </thead>
                    <tbody>
                      {allocResult.ranges.map((r: any, i: number) => (
                        <tr key={i} className="border-b border-gray-50 dark:border-slate-800/50">
                          <td className="px-2 py-1.5">
                            <p className="font-medium text-gray-900 dark:text-gray-100">{r.product_name || `Product #${r.product_id}`}</p>
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
                              toast.success("Copied");
                            }}
                              className="p-1 text-gray-400 hover:text-primary-600 rounded transition-colors"
                              title="Copy range">
                              <Copy className="w-3.5 h-3.5" />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="mb-4">
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Notes (optional)</label>
                  <textarea
                    value={allocNotes}
                    onChange={e => setAllocNotes(e.target.value)}
                    placeholder="e.g. Allocated for House X monthly demand"
                    rows={2}
                    className="w-full px-3 py-2 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-xl text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary-500/20 resize-none"
                  />
                </div>

                <div className="flex items-center justify-end gap-2">
                  <button onClick={() => { setShowAllocate(false); setAllocResult(null); setAllocError(""); setAllocNotes(""); }}
                    className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-slate-800 rounded-xl hover:bg-gray-200 dark:hover:bg-slate-700 transition-colors">
                    Cancel
                  </button>
                  <button onClick={handleConfirmAllocation} disabled={confirming}
                    className="flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white rounded-xl text-sm font-medium hover:bg-emerald-700 disabled:opacity-50 transition-colors">
                    {confirming ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                    {confirming ? "Confirming..." : "Confirm & Mark Used"}
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
              <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100">Export Serials</h3>
              <button onClick={() => setShowExportHouse(false)} className="p-1 text-gray-400 hover:text-gray-600">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Select House</label>
              <select value={exportHouseId} onChange={e => setExportHouseId(e.target.value ? Number(e.target.value) : "")}
                className="w-full px-3 py-2 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-xl text-sm text-gray-700 dark:text-gray-300 focus:outline-none focus:ring-2 focus:ring-primary-500/20">
                <option value="">Select house</option>
                {houses.map(h => (
                  <option key={h.id} value={h.id}>{h.name} ({h.code})</option>
                ))}
              </select>
            </div>
            <div className="flex items-center justify-end gap-2">
              <button onClick={() => setShowExportHouse(false)}
                className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-slate-800 rounded-xl hover:bg-gray-200 dark:hover:bg-slate-700 transition-colors">
                Cancel
              </button>
              <button onClick={async () => {
                if (!exportHouseId) { toast.error("Select a house"); return; }
                setShowExportHouse(false);
                await handleExport(Number(exportHouseId));
              }}
                className="flex items-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-xl text-sm font-medium hover:bg-primary-700 transition-colors">
                <Download className="w-4 h-4" /> Export
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
