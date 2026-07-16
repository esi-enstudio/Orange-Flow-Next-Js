"use client";
import { useState, useCallback, useEffect, useRef } from "react";
import { useLanguage } from "@/i18n/useLanguage";
import { useAuth } from "@/context/AuthContext";
import {
  Package, Plus, Search, Loader2, X, Eye, Download, ChevronDown, ChevronUp,
} from "lucide-react";
import { toast } from "react-hot-toast";
import axios from "@/lib/api";
import { AccessDenied } from "@/components/ui/AccessDenied";
import { cn } from "@/lib/utils";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000/api";

interface SimProduct {
  id: number; product_code: string; product_name: string; subcategory?: string;
}

interface House {
  id: number; name: string; code: string; display_name: string;
}

interface SerialRange { starting_serial: string; ending_serial: string; }

interface InventoryItem {
  id: number; house_id: number; product_id?: number;
  sim_type: string; starting_serial: string; ending_serial: string;
  serial_ranges?: string;
  quantity: number; available_quantity: number; supplier?: string;
  batch_number?: string; purchase_date?: string; status: string; notes?: string;
  exit_order_no?: string;
  created_at?: string;
}

interface PaginationMeta { page: number; per_page: number; total: number; total_pages: number; has_next: boolean; has_prev: boolean; }

const statusColors: Record<string, string> = {
  active: "bg-green-100 dark:bg-green-500/20 text-green-700 dark:text-green-300 border-green-200 dark:border-green-700",
  exhausted: "bg-gray-100 dark:bg-gray-500/20 text-gray-600 dark:text-gray-300 border-gray-200 dark:border-gray-700",
  expired: "bg-red-100 dark:bg-red-500/20 text-red-700 dark:text-red-300 border-red-200 dark:border-red-700",
};

function StatusBadge({ status }: { status: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold border", statusColors[status] || "")}>
      {status}
    </span>
  );
}

export default function SimInventoryPage() {
  const { t } = useLanguage();
  const { hasPermission } = useAuth();
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [pagination, setPagination] = useState<PaginationMeta | null>(null);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [simTypeFilter, setSimTypeFilter] = useState("");
  const [showModal, setShowModal] = useState(false);
  const [selectedItem, setSelectedItem] = useState<InventoryItem | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [formData, setFormData] = useState<any>({});
  const [products, setProducts] = useState<SimProduct[]>([]);
  const [houses, setHouses] = useState<House[]>([]);
  const searchTimer = useRef<any>(null);
  const perPage = 20;

  useEffect(() => {
    axios.get("/v1/sim-products").then(r => setProducts(r.data || [])).catch(() => {});
    axios.get("/houses/accessible").then(r => setHouses(r.data || [])).catch(() => {});
  }, []);

  const canCreate = hasPermission("sim_inventory.create");
  const canEdit = hasPermission("sim_inventory.edit");

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, any> = { page, per_page: perPage, sort_order: "desc", sort_by: "id" };
      if (search) params.search = search;
      if (statusFilter) params.status = statusFilter;
      if (simTypeFilter) params.sim_type = simTypeFilter;
      const res = await axios.get("/v1/sim-inventory", { params });
      setItems(res.data.data || []);
      setPagination(res.data.pagination || null);
    } catch { toast.error("Failed to load data"); }
    finally { setLoading(false); }
  }, [page, search, statusFilter, simTypeFilter]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleSearch = (val: string) => {
    setSearch(val);
    clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => setPage(1), 400);
  };

  const calcTotalQty = (ranges: SerialRange[]) => {
    let total = BigInt(0);
    for (const r of ranges) {
      if (r.starting_serial && r.ending_serial) {
        let startStr = r.starting_serial;
        let endStr = r.ending_serial;
        if (endStr.length < startStr.length) {
          const prefix = startStr.slice(0, startStr.length - endStr.length);
          endStr = prefix + endStr;
        }
        if (startStr.length === endStr.length) {
          try {
            const start = BigInt(startStr);
            const end = BigInt(endStr);
            total += end - start + BigInt(1);
          } catch { /* invalid number */ }
        }
      }
    }
    return total > BigInt(0) ? Number(total) : "";
  };

  const openCreateModal = () => {
    setSelectedItem(null);
    setFormData({
      house_id: houses.length === 1 ? houses[0].id : "",
      product_id: "", sim_type: "", supplier: "Banglalink",
      serial_ranges: [{ starting_serial: "", ending_serial: "" }],
      quantity: "", purchase_date: "", exit_order_no: "", notes: "",
    });
    setShowModal(true);
  };

  const openDetailModal = (item: InventoryItem) => {
    setSelectedItem(item);
    setShowModal(true);
  };

  const updateRange = (idx: number, field: keyof SerialRange, value: string) => {
    const ranges: SerialRange[] = [...(formData.serial_ranges || [])];
    if (!ranges[idx]) ranges[idx] = { starting_serial: "", ending_serial: "" };
    ranges[idx] = { ...ranges[idx], [field]: value };
    setFormData({ ...formData, serial_ranges: ranges, quantity: calcTotalQty(ranges) });
  };

  const addRange = () => {
    const ranges: SerialRange[] = [...(formData.serial_ranges || []), { starting_serial: "", ending_serial: "" }];
    setFormData({ ...formData, serial_ranges: ranges });
  };

  const removeRange = (idx: number) => {
    const ranges: SerialRange[] = (formData.serial_ranges || []).filter((_: any, i: number) => i !== idx);
    setFormData({ ...formData, serial_ranges: ranges, quantity: calcTotalQty(ranges) });
  };

  const handleSubmit = async () => {
    const selectedProd = products.find(p => p.id === Number(formData.product_id));
    const ranges: SerialRange[] = formData.serial_ranges || [];
    const validRanges = ranges.filter(r => r.starting_serial && r.ending_serial);
    if (!selectedProd || !formData.house_id || validRanges.length === 0) {
      toast.error("House, SIM product, and at least one serial range are required");
      return;
    }
    setActionLoading(true);
    try {
      await axios.post("/v1/sim-inventory", {
        house_id: Number(formData.house_id),
        product_id: selectedProd.id,
        sim_type: selectedProd.product_name,
        serial_ranges: validRanges,
        quantity: parseInt(formData.quantity) || 0,
        supplier: formData.supplier || undefined,
        purchase_date: formData.purchase_date || undefined,
        exit_order_no: formData.exit_order_no || undefined,
        notes: formData.notes || undefined,
      });
      toast.success(t("sim_inventory.toast_create_success"));
      setShowModal(false);
      fetchData();
    } catch (e: any) { toast.error(e?.response?.data?.detail || "Creation failed"); }
    finally { setActionLoading(false); }
  };

  const canView = hasPermission("sim_inventory.view");
  if (!canView) return <AccessDenied />;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center gap-3 flex-wrap">
        <div className="p-2.5 bg-indigo-100 dark:bg-indigo-500/20 rounded-xl">
          <Package className="w-5 h-5 text-indigo-600" />
        </div>
        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">{t("sim_inventory.title")}</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">{t("sim_inventory.description")}</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => axios.get("/v1/sim-inventory/export/list", { responseType: "blob" }).then(r => {
            const url = URL.createObjectURL(new Blob([r.data], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
            const a = document.createElement("a"); a.href = url; a.download = "sim_inventory.xlsx"; a.click();
          }).catch(() => toast.error("Export failed"))} className="flex cursor-pointer items-center gap-2 px-4 py-2.5 bg-gray-100 dark:bg-slate-800 rounded-xl text-sm font-medium hover:bg-gray-200 dark:hover:bg-slate-700 transition-colors">
            <Download className="w-4 h-4" /> Export
          </button>
          {canCreate && (
            <button onClick={openCreateModal} className="flex cursor-pointer items-center gap-2 px-4 py-2.5 bg-indigo-600 text-white rounded-xl text-sm font-medium hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-200 dark:shadow-indigo-900/30">
              <Plus className="w-4 h-4" /> {t("sim_inventory.create")}
            </button>
          )}
        </div>
      </div>

      <div className="flex gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px] max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input value={search} onChange={e => handleSearch(e.target.value)} placeholder={t("sim_inventory.search_placeholder")} className="w-full pl-9 pr-4 py-2.5 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20" />
        </div>
        <select value={statusFilter} onChange={e => { setStatusFilter(e.target.value); setPage(1); }} className="px-4 py-2.5 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-xl text-sm">
          <option value="">All Status</option>
          {["active", "exhausted", "expired"].map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <select value={simTypeFilter} onChange={e => { setSimTypeFilter(e.target.value); setPage(1); }} className="px-4 py-2.5 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-xl text-sm">
          <option value="">All Types</option>
          {["Prepaid", "Postpaid", "MNP"].map(t => <option key={t} value={t}>{t}</option>)}
        </select>
      </div>

      {loading ? (
        <div className="divide-y divide-gray-50 dark:divide-slate-800 bg-white dark:bg-slate-900 rounded-2xl border border-gray-100 dark:border-slate-800 shadow-sm">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex items-center gap-4 px-6 py-5 animate-pulse">
              <div className="w-10 h-10 rounded-xl bg-gray-200 dark:bg-slate-700 shrink-0" />
              <div className="space-y-2 flex-1">
                <div className="h-3 w-32 bg-gray-200 dark:bg-slate-700 rounded-md" />
                <div className="h-2.5 w-24 bg-gray-100 dark:bg-slate-800 rounded-md" />
              </div>
            </div>
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="text-center py-16 bg-white dark:bg-slate-900 rounded-2xl border border-gray-100 dark:border-slate-800 shadow-sm">
          <Package className="w-12 h-12 mx-auto text-gray-300 dark:text-gray-600 mb-3" />
          <p className="text-gray-500 dark:text-gray-400 font-medium">{t("sim_inventory.no_data")}</p>
          <p className="text-sm text-gray-400 dark:text-gray-500 mt-1">{t("sim_inventory.no_data_desc")}</p>
        </div>
      ) : (
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-gray-100 dark:border-slate-800 shadow-sm overflow-hidden">
          <div className="hidden lg:block overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-100 dark:border-slate-800 bg-gray-50 dark:bg-slate-800/50">
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Batch #</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Type</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Serial Range</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Total</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Available</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Supplier</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Status</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50 dark:divide-slate-800">
                {items.map(item => (
                  <tr key={item.id} className="hover:bg-gray-50 dark:hover:bg-slate-800/30 transition-colors">
                    <td className="px-4 py-3"><p className="font-medium text-sm">{item.batch_number || "-"}</p></td>
                    <td className="px-4 py-3"><p className="text-sm">{item.sim_type}</p></td>
                    <td className="px-4 py-3">
                      <p className="text-sm font-mono text-xs">{item.starting_serial}</p>
                      <p className="text-[11px] text-gray-500 font-mono">{item.ending_serial}</p>
                    </td>
                    <td className="px-4 py-3 text-right text-sm font-medium">{item.quantity}</td>
                    <td className="px-4 py-3 text-right text-sm">{item.available_quantity}</td>
                    <td className="px-4 py-3 text-sm">{item.supplier || "-"}</td>
                    <td className="px-4 py-3"><StatusBadge status={item.status} /></td>
                    <td className="px-4 py-3 text-right">
                      <button onClick={() => openDetailModal(item)} className="p-2 text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 dark:hover:bg-indigo-500/10 rounded-lg transition-colors">
                        <Eye className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="lg:hidden divide-y divide-gray-100 dark:divide-slate-800">
            {items.map(item => (
              <div key={item.id} className="px-4 py-3">
                <button onClick={() => openDetailModal(item)} className="flex items-center gap-3 w-full text-left cursor-pointer">
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm">{item.batch_number || `Batch #${item.id}`}</p>
                    <p className="text-[11px] text-gray-500">{item.sim_type} | {item.quantity} total, {item.available_quantity} avail</p>
                  </div>
                  <StatusBadge status={item.status} />
                </button>
              </div>
            ))}
          </div>

          {pagination && (
            <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100 dark:border-slate-800">
              <p className="text-sm text-gray-500">Page {pagination.page} of {pagination.total_pages} ({pagination.total} items)</p>
              <div className="flex gap-2">
                <button disabled={!pagination.has_prev} onClick={() => setPage(p => p - 1)} className="px-3 py-1.5 text-sm rounded-lg border border-gray-200 dark:border-slate-700 disabled:opacity-40 hover:bg-gray-50 dark:hover:bg-slate-800 cursor-pointer">Prev</button>
                <button disabled={!pagination.has_next} onClick={() => setPage(p => p + 1)} className="px-3 py-1.5 text-sm rounded-lg border border-gray-200 dark:border-slate-700 disabled:opacity-40 hover:bg-gray-50 dark:hover:bg-slate-800 cursor-pointer">Next</button>
              </div>
            </div>
          )}
        </div>
      )}

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-start justify-center pt-10 pb-10 overflow-y-auto">
          <div className="fixed inset-0 bg-black/40" onClick={() => setShowModal(false)} />
          <div className="relative bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border dark:border-slate-700 p-6 w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto">
            <button onClick={() => setShowModal(false)} className="absolute top-4 right-4 p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"><X className="w-5 h-5" /></button>

            {selectedItem ? (
              <>
                <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100 mb-4">Stock Detail</h3>
                <div className="grid grid-cols-2 gap-4">
                  <div><label className="text-xs text-gray-500">Batch</label><p className="font-medium">{selectedItem.batch_number || "-"}</p></div>
                  <div><label className="text-xs text-gray-500">SIM Type</label><p className="font-medium">{selectedItem.sim_type}</p></div>
                  <div className="col-span-2">
                    <label className="text-xs text-gray-500">Serial Ranges</label>
                    {selectedItem.serial_ranges ? (
                      <div className="mt-1 space-y-1">
                        {(JSON.parse(selectedItem.serial_ranges) as SerialRange[]).map((r, i) => (
                          <p key={i} className="font-mono text-xs text-gray-700 dark:text-gray-300">
                            {r.starting_serial} — {r.ending_serial}
                          </p>
                        ))}
                      </div>
                    ) : (
                      <p className="font-mono text-xs">{selectedItem.starting_serial} — {selectedItem.ending_serial}</p>
                    )}
                  </div>
                  <div><label className="text-xs text-gray-500">Total Qty</label><p className="font-medium">{selectedItem.quantity}</p></div>
                  <div><label className="text-xs text-gray-500">Available</label><p className="font-medium text-green-600">{selectedItem.available_quantity}</p></div>
                  <div><label className="text-xs text-gray-500">Supplier</label><p className="font-medium">{selectedItem.supplier || "-"}</p></div>
                  <div><label className="text-xs text-gray-500">Exit Order No.</label><p className="font-medium">{selectedItem.exit_order_no || "-"}</p></div>
                  <div><label className="text-xs text-gray-500">Status</label><StatusBadge status={selectedItem.status} /></div>
                  {selectedItem.purchase_date && <div><label className="text-xs text-gray-500">Purchase Date</label><p className="font-medium">{selectedItem.purchase_date}</p></div>}
                </div>
              </>
            ) : (
              <>
                <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100 mb-4">{t("sim_inventory.create")}</h3>
                <div className="grid grid-cols-2 gap-4">
                  <div className="col-span-2 sm:col-span-1">
                    <label className="text-xs font-medium text-gray-500">House *</label>
                    <select value={formData.house_id} onChange={e => setFormData({ ...formData, house_id: e.target.value })} className="w-full mt-1 px-3 py-2 border border-gray-200 dark:border-slate-700 rounded-xl text-sm bg-white dark:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500/20">
                      <option value="">Select House</option>
                      {houses.map(h => <option key={h.id} value={h.id}>{h.display_name}</option>)}
                    </select>
                  </div>
                  <div className="col-span-2 sm:col-span-1">
                    <label className="text-xs font-medium text-gray-500">SIM Product *</label>
                    <select value={formData.product_id} onChange={e => setFormData({ ...formData, product_id: e.target.value, sim_type: products.find(p => p.id === Number(e.target.value))?.product_name || "" })} className="w-full mt-1 px-3 py-2 border border-gray-200 dark:border-slate-700 rounded-xl text-sm bg-white dark:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500/20">
                      <option value="">Select SIM Product</option>
                      {products.map(p => <option key={p.id} value={p.id}>{p.product_code}</option>)}
                    </select>
                  </div>

                  <div className="col-span-2">
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-xs font-medium text-gray-500">Serial Ranges *</label>
                      <button type="button" onClick={addRange} className="text-xs text-indigo-600 hover:text-indigo-700 font-medium cursor-pointer">+ Add Range</button>
                    </div>
                    <div className="space-y-2">
                      {(formData.serial_ranges || []).map((r: SerialRange, i: number) => (
                        <div key={i} className="flex items-center gap-2">
                          <input value={r.starting_serial} onChange={e => updateRange(i, "starting_serial", e.target.value)} placeholder="Start" className="flex-1 px-3 py-2 border border-gray-200 dark:border-slate-700 rounded-xl text-sm bg-white dark:bg-slate-800 font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500/20" />
                          <span className="text-gray-400">—</span>
                          <input value={r.ending_serial} onChange={e => updateRange(i, "ending_serial", e.target.value)} placeholder="End" className="flex-1 px-3 py-2 border border-gray-200 dark:border-slate-700 rounded-xl text-sm bg-white dark:bg-slate-800 font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500/20" />
                          {(formData.serial_ranges || []).length > 1 && (
                            <button type="button" onClick={() => removeRange(i)} className="p-2 text-gray-400 hover:text-red-500 cursor-pointer"><X className="w-4 h-4" /></button>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="col-span-2 sm:col-span-1">
                    <label className="text-xs font-medium text-gray-500">Quantity</label>
                    <input type="number" value={formData.quantity} readOnly className="w-full mt-1 px-3 py-2 border border-gray-200 dark:border-slate-700 rounded-xl text-sm bg-gray-50 dark:bg-slate-800 text-gray-600 dark:text-gray-400 cursor-not-allowed" />
                    <p className="text-[11px] text-gray-400 mt-0.5">Auto-calculated</p>
                  </div>
                  <div className="col-span-2 sm:col-span-1">
                    <label className="text-xs font-medium text-gray-500">Supplier</label>
                    <input value={formData.supplier || ""} onChange={e => setFormData({ ...formData, supplier: e.target.value })} className="w-full mt-1 px-3 py-2 border border-gray-200 dark:border-slate-700 rounded-xl text-sm bg-white dark:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500/20" />
                  </div>
                  <div className="col-span-2 sm:col-span-1">
                    <label className="text-xs font-medium text-gray-500">Exit Order No.</label>
                    <input value={formData.exit_order_no || ""} onChange={e => setFormData({ ...formData, exit_order_no: e.target.value })} className="w-full mt-1 px-3 py-2 border border-gray-200 dark:border-slate-700 rounded-xl text-sm bg-white dark:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500/20" />
                  </div>
                  <div className="col-span-2 sm:col-span-1">
                    <label className="text-xs font-medium text-gray-500">Purchase Date</label>
                    <input type="date" value={formData.purchase_date || ""} onChange={e => setFormData({ ...formData, purchase_date: e.target.value })} className="w-full mt-1 px-3 py-2 border border-gray-200 dark:border-slate-700 rounded-xl text-sm bg-white dark:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500/20" />
                  </div>
                </div>
                <div className="flex justify-end gap-3 mt-6 pt-4 border-t border-gray-100 dark:border-slate-800">
                  <button onClick={() => setShowModal(false)} className="px-4 py-2 text-sm rounded-xl border border-gray-200 dark:border-slate-700 hover:bg-gray-50 dark:hover:bg-slate-800 cursor-pointer">Cancel</button>
                  <button onClick={handleSubmit} disabled={actionLoading} className="px-4 py-2 text-sm rounded-xl bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 cursor-pointer flex items-center gap-2">
                    {actionLoading && <Loader2 className="w-4 h-4 animate-spin" />} {t("sim_inventory.create")}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
