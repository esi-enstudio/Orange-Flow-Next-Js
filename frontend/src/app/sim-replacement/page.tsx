"use client";
import { useState, useCallback, useEffect, useRef } from "react";
import { useLanguage } from "@/i18n/useLanguage";
import { useAuth } from "@/context/AuthContext";
import {
  Smartphone, Plus, Search, Loader2, X, Check, Eye, ThumbsUp,
  ThumbsDown, Disc, CheckCircle2, XCircle, Clock, AlertTriangle,
  ChevronDown, ChevronUp, Download, Ban, Pencil, Trash2,
} from "lucide-react";
import { toast } from "react-hot-toast";
import axios from "@/lib/api";
import { AccessDenied } from "@/components/ui/AccessDenied";
import { cn } from "@/lib/utils";

interface RequestItem {
  id: number; request_number: string; request_status: string;
  retailer_name?: string; retailer_code?: string; retailer_itop?: string;
  new_sim_number?: string;
  replacement_reason?: string; priority: string; requester_name?: string;
  requested_at?: string; approved_at?: string; issued_at?: string;
  activated_at?: string; house_id: number; ev_swap_serial?: string;
  approver_name?: string; issuer_name?: string; activator_name?: string;
  reason_details?: string; remarks?: string; notes?: string;
  retailer_id?: number;
}

interface HouseOption { id: number; name: string; code: string; display_name: string; }
interface RetailerOption { id: number; name: string; retailer_code: string; itop_number: string | null; }

interface PaginationMeta { page: number; per_page: number; total: number; total_pages: number; has_next: boolean; has_prev: boolean; }

const statusColors: Record<string, string> = {
  pending: "bg-amber-100 dark:bg-amber-500/20 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-700",
  approved: "bg-blue-100 dark:bg-blue-500/20 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-700",
  sim_issued: "bg-indigo-100 dark:bg-indigo-500/20 text-indigo-700 dark:text-indigo-300 border-indigo-200 dark:border-indigo-700",
  activated: "bg-green-100 dark:bg-green-500/20 text-green-700 dark:text-green-300 border-green-200 dark:border-green-700",
  closed: "bg-gray-100 dark:bg-gray-500/20 text-gray-700 dark:text-gray-300 border-gray-200 dark:border-gray-700",
  rejected: "bg-red-100 dark:bg-red-500/20 text-red-700 dark:text-red-300 border-red-200 dark:border-red-700",
  cancelled: "bg-rose-100 dark:bg-rose-500/20 text-rose-700 dark:text-rose-300 border-rose-200 dark:border-rose-700",
};

const priorityColors: Record<string, string> = {
  low: "text-gray-500", normal: "text-blue-500", high: "text-amber-500", urgent: "text-red-500",
};

function StatusBadge({ status, t }: { status: string; t: (key: string) => string }) {
  const icons: Record<string, any> = {
    pending: Clock, approved: ThumbsUp, sim_issued: Disc, activated: CheckCircle2,
    closed: Check, rejected: XCircle, cancelled: Ban,
  };
  const Icon = icons[status] || AlertTriangle;
  return (
    <span className={cn("inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold border whitespace-nowrap", statusColors[status] || "")}>
      <Icon className="w-3 h-3" />
      {t(`sim_replacement.status.${status}`) || status}
    </span>
  );
}

function formatDate(d?: string) {
  if (!d) return "-";
  return new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

export default function SimReplacementPage() {
  const { t } = useLanguage();
  const { hasPermission } = useAuth();
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<RequestItem[]>([]);
  const [pagination, setPagination] = useState<PaginationMeta | null>(null);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [showModal, setShowModal] = useState(false);
  const [selectedItem, setSelectedItem] = useState<RequestItem | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<RequestItem | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [formData, setFormData] = useState<any>({});
  const [houses, setHouses] = useState<HouseOption[]>([]);
  const [retailers, setRetailers] = useState<RetailerOption[]>([]);
  const [retailerSearch, setRetailerSearch] = useState("");
  const [retailerDropdownOpen, setRetailerDropdownOpen] = useState(false);
  const retailerDebounce = useRef<any>(null);
  const searchTimer = useRef<any>(null);
  const perPage = 20;

  const canCreate = hasPermission("sim_replacement.create");
  const canApprove = hasPermission("sim_replacement.approve");
  const canIssue = hasPermission("sim_replacement.issue");
  const canActivate = hasPermission("sim_replacement.activate");
  const canEdit = hasPermission("sim_replacement.edit");
  const canDelete = hasPermission("sim_replacement.delete");

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, any> = { page, per_page: perPage, sort_order: "desc", sort_by: "id" };
      if (search) params.search = search;
      if (statusFilter) params.status = statusFilter;
      const res = await axios.get("/v1/sim-replacement", { params });
      setItems(res.data.data || []);
      setPagination(res.data.pagination || null);
    } catch (e: any) { toast.error(e?.response?.data?.detail || e?.message || "Failed to load data"); }
    finally { setLoading(false); }
  }, [page, search, statusFilter]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleSearch = (val: string) => {
    setSearch(val);
    clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => setPage(1), 400);
  };

  const doAction = async (endpoint: string, id: number, body?: any, successMsg?: string) => {
    setActionLoading(true);
    try {
      await axios.post(`/v1/sim-replacement/${id}${endpoint}`, body || {});
      toast.success(successMsg || "Action completed");
      setShowModal(false);
      fetchData();
    } catch (e: any) { toast.error(e?.response?.data?.detail || "Action failed"); }
    finally { setActionLoading(false); }
  };

  const openCreateModal = () => {
    setSelectedItem(null);
    setIsEditing(false);
    setFormData({
      house_id: houses.length === 1 ? houses[0].id : "",
      replacement_reason: "Damaged", priority: "normal",
      retailer_id: "", retailer_code: "", retailer_name: "",
      ev_swap_serial: "", reason_details: "", notes: "", remarks: "",
    });
    setRetailerSearch("");
    setRetailers([]);
    setShowModal(true);
  };

  const openDetailModal = (item: RequestItem) => {
    setSelectedItem(item);
    setIsEditing(false);
    setShowModal(true);
  };

  const openEditModal = (item: RequestItem) => {
    setSelectedItem(item);
    setFormData({
      house_id: item.house_id,
      replacement_reason: item.replacement_reason || "Damaged",
      priority: item.priority || "normal",
      retailer_id: item.retailer_id || "",
      retailer_code: item.retailer_code || "",
      retailer_name: item.retailer_name || "",
      ev_swap_serial: item.ev_swap_serial || "",
      reason_details: item.reason_details || "",
      notes: item.notes || "",
      remarks: item.remarks || "",
    });
    setRetailerSearch(item.retailer_name || "");
    setRetailers([]);
    setIsEditing(true);
    setShowModal(true);
  };

  const fetchRetailers = (houseId: number, q?: string) => {
    axios.get(`/v1/sim-replacement/retailers`, { params: { house_id: houseId, search: q || "" } })
      .then(res => setRetailers(res.data || []))
      .catch(() => {});
  };

  useEffect(() => {
    axios.get("houses/accessible").then(res => setHouses(res.data || [])).catch(() => {});
  }, []);

  useEffect(() => {
    if (formData.house_id) fetchRetailers(formData.house_id);
  }, [formData.house_id]);

  const handleUpdate = async () => {
    if (!selectedItem) return;
    setActionLoading(true);
    try {
      const payload: any = {};
      for (const [k, v] of Object.entries(formData)) {
        if (v !== "" && v !== null && v !== undefined && ["replacement_reason", "reason_details", "ev_swap_serial", "priority", "notes", "remarks"].includes(k)) {
          payload[k] = v;
        }
      }
      await axios.put(`/v1/sim-replacement/${selectedItem.id}`, payload);
      toast.success(t("sim_replacement.toast_update_success"));
      setShowModal(false);
      fetchData();
    } catch (e: any) { toast.error(e?.response?.data?.detail || "Update failed"); }
    finally { setActionLoading(false); }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setActionLoading(true);
    try {
      await axios.delete(`/v1/sim-replacement/${deleteTarget.id}`);
      toast.success(t("sim_replacement.toast_delete_success"));
      setShowModal(false);
      setDeleteTarget(null);
      fetchData();
    } catch (e: any) { toast.error(e?.response?.data?.detail || "Delete failed"); }
    finally { setActionLoading(false); }
  };

  const handleCreate = async () => {
    setActionLoading(true);
    try {
      const payload: any = {};
      for (const [k, v] of Object.entries(formData)) {
        if (v !== "" && v !== null && v !== undefined) payload[k] = v;
      }
      await axios.post("/v1/sim-replacement", payload);
      toast.success(t("sim_replacement.toast_create_success"));
      setShowModal(false);
      fetchData();
    } catch (e: any) { toast.error(e?.response?.data?.detail || "Creation failed"); }
    finally { setActionLoading(false); }
  };

  const canView = hasPermission("sim_replacement.view");
  if (!canView) return <AccessDenied />;

  const renderDetailActions = (item: RequestItem) => {
    if (!item) return null;
    return (
      <div className="flex flex-wrap gap-2 mt-3">
        {item.request_status === "pending" && canEdit && (
          <button onClick={() => { setShowModal(false); setTimeout(() => openEditModal(item), 50); }} className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-amber-100 dark:bg-amber-500/20 text-amber-700 dark:text-amber-300 rounded-lg hover:bg-amber-200 dark:hover:bg-amber-500/30 cursor-pointer">
            <Pencil className="w-3 h-3" /> Edit
          </button>
        )}
        {item.request_status === "pending" && canDelete && (
          <button onClick={() => setDeleteTarget(item)} className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-red-100 dark:bg-red-500/20 text-red-700 dark:text-red-300 rounded-lg hover:bg-red-200 dark:hover:bg-red-500/30 cursor-pointer">
            <Trash2 className="w-3 h-3" /> Delete
          </button>
        )}
      </div>
    );
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center gap-3 flex-wrap">
        <div className="p-2.5 bg-indigo-100 dark:bg-indigo-500/20 rounded-xl">
          <Smartphone className="w-5 h-5 text-indigo-600" />
        </div>
        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">{t("sim_replacement.title")}</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">{t("sim_replacement.description")}</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => axios.get("/v1/sim-replacement/export/list").then(r => {
            const url = URL.createObjectURL(new Blob([r.data], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
            const a = document.createElement("a"); a.href = url; a.download = "sim_replacement_requests.xlsx"; a.click();
          }).catch(() => toast.error("Export failed"))} className="flex cursor-pointer items-center gap-2 px-4 py-2.5 bg-gray-100 dark:bg-slate-800 rounded-xl text-sm font-medium hover:bg-gray-200 dark:hover:bg-slate-700 transition-colors">
            <Download className="w-4 h-4" /> Export
          </button>
          {canCreate && (
            <button onClick={openCreateModal} className="flex cursor-pointer items-center gap-2 px-4 py-2.5 bg-indigo-600 text-white rounded-xl text-sm font-medium hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-200 dark:shadow-indigo-900/30">
              <Plus className="w-4 h-4" /> {t("sim_replacement.create")}
            </button>
          )}
        </div>
      </div>

      <div className="flex gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px] max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input value={search} onChange={e => handleSearch(e.target.value)} placeholder={t("sim_replacement.search_placeholder")} className="w-full pl-9 pr-4 py-2.5 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20" />
        </div>
        <select value={statusFilter} onChange={e => { setStatusFilter(e.target.value); setPage(1); }} className="px-4 py-2.5 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20">
          <option value="">All Status</option>
          {["pending", "approved", "sim_issued", "activated", "closed", "rejected", "cancelled"].map(s => (
            <option key={s} value={s}>{t(`sim_replacement.status.${s}`)}</option>
          ))}
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
          <Smartphone className="w-12 h-12 mx-auto text-gray-300 dark:text-gray-600 mb-3" />
          <p className="text-gray-500 dark:text-gray-400 font-medium">{t("sim_replacement.no_data")}</p>
          <p className="text-sm text-gray-400 dark:text-gray-500 mt-1">{t("sim_replacement.no_data_desc")}</p>
        </div>
      ) : (
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-gray-100 dark:border-slate-800 shadow-sm overflow-hidden">
          <div className="hidden lg:block overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-100 dark:border-slate-800 bg-gray-50 dark:bg-slate-800/50">
                  <th className="text-left px-2 py-2 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Request #</th>
                  <th className="text-left px-2 py-2 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Retailer</th>
                  <th className="text-left px-2 py-2 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">EV Swap Serial</th>
                  <th className="text-left px-2 py-2 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Reason</th>
                  <th className="text-left px-2 py-2 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Status</th>
                  <th className="text-left px-2 py-2 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Date</th>
                  <th className="text-right px-2 py-2 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50 dark:divide-slate-800">
                {items.map(item => (
                  <tr key={item.id} className="hover:bg-gray-50 dark:hover:bg-slate-800/30 transition-colors">
                    <td className="px-2 py-1">
                      <p className="font-medium text-sm text-indigo-600 dark:text-indigo-400">{item.request_number}</p>
                    </td>
                    <td className="px-2 py-1">
                      <p className="font-medium text-sm">{item.retailer_name || "-"}</p>
                      <p className="text-[11px] text-gray-500 dark:text-gray-400">
                        {item.retailer_code || "-"}
                        {item.retailer_itop && <span className="ml-1 text-gray-400">({item.retailer_itop})</span>}
                      </p>
                    </td>
                    <td className="px-2 py-1">
                      <p className="text-sm">{item.ev_swap_serial || "-"}</p>
                    </td>
                    <td className="px-2 py-1 text-sm">{item.replacement_reason?.replace(/_/g, " ") || "-"}</td>
                    <td className="px-2 py-1"><StatusBadge status={item.request_status} t={t} /></td>
                    <td className="px-2 py-1 text-sm text-gray-500">{formatDate(item.requested_at)}</td>
                    <td className="px-2 py-1 text-right">
                      <div className="flex items-center justify-end gap-1">
                        {item.request_status === "pending" && canEdit && (
                          <button onClick={() => openEditModal(item)} className="p-2 text-gray-400 hover:text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-500/10 rounded-lg transition-colors">
                            <Pencil className="w-4 h-4" />
                          </button>
                        )}
                        {item.request_status === "pending" && canDelete && (
                          <button onClick={() => setDeleteTarget(item)} className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-500/10 rounded-lg transition-colors">
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                        <button onClick={() => openDetailModal(item)} className="p-2 text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 dark:hover:bg-indigo-500/10 rounded-lg transition-colors">
                          <Eye className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="lg:hidden divide-y divide-gray-100 dark:divide-slate-800">
            {items.map(item => (
              <DetailRow key={item.id} item={item} t={t} formatDate={formatDate} StatusBadge={StatusBadge} openDetail={openDetailModal} renderActions={renderDetailActions} />
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

      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="fixed inset-0 bg-black/40" onClick={() => setDeleteTarget(null)} />
          <div className="relative bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border dark:border-slate-700 p-6 w-full max-w-sm mx-4">
            <div className="text-center">
              <div className="mx-auto w-12 h-12 rounded-full bg-red-100 dark:bg-red-500/20 flex items-center justify-center mb-4">
                <Trash2 className="w-6 h-6 text-red-600" />
              </div>
              <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100 mb-2">{t("common.delete")}</h3>
              <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">{t("sim_replacement.delete_confirm")}</p>
              <p className="text-xs text-gray-400 mb-6 bg-gray-50 dark:bg-slate-800/50 rounded-lg p-2">
                {deleteTarget.request_number}
              </p>
              <div className="flex gap-3 justify-center">
                <button onClick={() => setDeleteTarget(null)} className="px-4 py-2 text-sm rounded-xl border border-gray-200 dark:border-slate-700 hover:bg-gray-50 dark:hover:bg-slate-800 cursor-pointer">Cancel</button>
                <button onClick={handleDelete} disabled={actionLoading} className="px-4 py-2 text-sm rounded-xl bg-red-600 text-white hover:bg-red-700 disabled:opacity-50 cursor-pointer flex items-center gap-2">
                  {actionLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />} Delete
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-start justify-center pt-10 pb-10 overflow-y-auto">
          <div className="fixed inset-0 bg-black/40" onClick={() => setShowModal(false)} />
          <div className="relative bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border dark:border-slate-700 p-6 w-full max-w-2xl mx-4 max-h-[90vh] overflow-y-auto">
            <button onClick={() => setShowModal(false)} className="absolute top-4 right-4 p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"><X className="w-5 h-5" /></button>

            {isEditing ? (
              <>
                <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100 mb-4">{t("sim_replacement.edit_title")}</h3>
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-3 p-3 bg-gray-50 dark:bg-slate-800/50 rounded-xl text-sm">
                    <div><span className="text-xs text-gray-500">Request #</span><p className="font-medium">{selectedItem?.request_number}</p></div>
                    <div><span className="text-xs text-gray-500">Retailer</span><p className="font-medium">{selectedItem?.retailer_name || selectedItem?.retailer_code || "-"} {selectedItem?.retailer_itop && <span className="text-gray-400 font-normal">({selectedItem.retailer_itop})</span>}</p></div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="col-span-2 sm:col-span-1">
                      <label className="text-xs font-medium text-gray-500">{t("sim_replacement.fields.reason")}</label>
                      <select value={formData.replacement_reason || "Damaged"} onChange={e => setFormData({ ...formData, replacement_reason: e.target.value })} className="w-full mt-1 px-3 py-2 border border-gray-200 dark:border-slate-700 rounded-xl text-sm bg-white dark:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500/20">
                        {["Lost", "Damaged", "Stolen", "Network_Issue", "Other"].map(r => <option key={r} value={r}>{r.replace(/_/g, " ")}</option>)}
                      </select>
                    </div>
                    <div className="col-span-2 sm:col-span-1">
                      <label className="text-xs font-medium text-gray-500">{t("sim_replacement.fields.ev_swap_serial")}</label>
                      <input value={formData.ev_swap_serial || ""} onChange={e => setFormData({ ...formData, ev_swap_serial: e.target.value })} className="w-full mt-1 px-3 py-2 border border-gray-200 dark:border-slate-700 rounded-xl text-sm bg-white dark:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500/20" />
                    </div>
                    <div className="col-span-2 sm:col-span-1">
                      <label className="text-xs font-medium text-gray-500">{t("sim_replacement.fields.priority")}</label>
                      <select value={formData.priority || "normal"} onChange={e => setFormData({ ...formData, priority: e.target.value })} className="w-full mt-1 px-3 py-2 border border-gray-200 dark:border-slate-700 rounded-xl text-sm bg-white dark:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500/20">
                        {["low", "normal", "high", "urgent"].map(p => <option key={p} value={p}>{p.charAt(0).toUpperCase() + p.slice(1)}</option>)}
                      </select>
                    </div>
                    <div className="col-span-2">
                      <label className="text-xs font-medium text-gray-500">{t("sim_replacement.fields.reason_details")}</label>
                      <textarea value={formData.reason_details || ""} onChange={e => setFormData({ ...formData, reason_details: e.target.value })} rows={2} className="w-full mt-1 px-3 py-2 border border-gray-200 dark:border-slate-700 rounded-xl text-sm bg-white dark:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500/20" />
                    </div>
                    <div className="col-span-2">
                      <label className="text-xs font-medium text-gray-500">{t("sim_replacement.fields.remarks")}</label>
                      <textarea value={formData.remarks || ""} onChange={e => setFormData({ ...formData, remarks: e.target.value })} rows={2} className="w-full mt-1 px-3 py-2 border border-gray-200 dark:border-slate-700 rounded-xl text-sm bg-white dark:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500/20" />
                    </div>
                  </div>
                </div>
                <div className="flex justify-end gap-3 mt-6 pt-4 border-t border-gray-100 dark:border-slate-800">
                  <button onClick={() => setIsEditing(false)} className="px-4 py-2 text-sm rounded-xl border border-gray-200 dark:border-slate-700 hover:bg-gray-50 dark:hover:bg-slate-800 cursor-pointer">Cancel</button>
                  <button onClick={handleUpdate} disabled={actionLoading} className="px-4 py-2 text-sm rounded-xl bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 cursor-pointer flex items-center gap-2">
                    {actionLoading && <Loader2 className="w-4 h-4 animate-spin" />} Update
                  </button>
                </div>
              </>
            ) : selectedItem ? (
              <>
                <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100 mb-1">{selectedItem.request_number}</h3>
                <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
                  <StatusBadge status={selectedItem.request_status} t={t} />
                </p>

                <div className="grid grid-cols-2 gap-4 mb-4">
                  <div><label className="text-xs text-gray-500">Retailer</label><p className="font-medium">{selectedItem.retailer_name || selectedItem.retailer_code || "-"} {selectedItem.retailer_itop && <span className="text-gray-400 font-normal">({selectedItem.retailer_itop})</span>}</p></div>
                  <div><label className="text-xs text-gray-500">Reason</label><p className="font-medium">{selectedItem.replacement_reason?.replace(/_/g, " ") || "-"}</p></div>
                  <div><label className="text-xs text-gray-500">EV Swap Serial</label><p className="font-medium">{selectedItem.ev_swap_serial || "-"}</p></div>
                  <div><label className="text-xs text-gray-500">New SIM</label><p className="font-medium">{selectedItem.new_sim_number || "Not issued"}</p></div>
                </div>

                {selectedItem.reason_details && (
                  <div className="mb-4">
                    <label className="text-xs text-gray-500">Reason Details</label>
                    <p className="text-sm mt-0.5 text-gray-700 dark:text-gray-300 whitespace-pre-wrap">{selectedItem.reason_details}</p>
                  </div>
                )}

                {selectedItem.remarks && (
                  <div className="mb-4">
                    <label className="text-xs text-gray-500">Remarks</label>
                    <p className="text-sm mt-0.5 text-gray-700 dark:text-gray-300 whitespace-pre-wrap">{selectedItem.remarks}</p>
                  </div>
                )}

                <div className="flex flex-wrap gap-2 border-t border-gray-100 dark:border-slate-800 pt-4">
                  {selectedItem.request_status === "pending" && canApprove && (
                    <>
                      <button onClick={() => doAction("/approve", selectedItem.id, {}, t("sim_replacement.toast_approve_success"))} disabled={actionLoading} className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-xl text-sm font-medium hover:bg-green-700 cursor-pointer disabled:opacity-50">
                        {actionLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ThumbsUp className="w-4 h-4" />} {t("sim_replacement.actions.approve")}
                      </button>
                      <button onClick={() => doAction("/reject", selectedItem.id, {}, t("sim_replacement.toast_reject_success"))} disabled={actionLoading} className="flex items-center gap-2 px-4 py-2 bg-red-600 text-white rounded-xl text-sm font-medium hover:bg-red-700 cursor-pointer disabled:opacity-50">
                        {actionLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ThumbsDown className="w-4 h-4" />} {t("sim_replacement.actions.reject")}
                      </button>
                    </>
                  )}
                  {selectedItem.request_status === "approved" && canIssue && (
                    <button onClick={() => doAction("/issue", selectedItem.id, { new_sim_number: selectedItem.new_sim_number || "NEW" }, t("sim_replacement.toast_issue_success"))} disabled={actionLoading} className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-xl text-sm font-medium hover:bg-indigo-700 cursor-pointer disabled:opacity-50">
                      {actionLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Disc className="w-4 h-4" />} {t("sim_replacement.actions.issue_sim")}
                    </button>
                  )}
                  {selectedItem.request_status === "sim_issued" && canActivate && (
                    <button onClick={() => doAction("/activate", selectedItem.id, {}, t("sim_replacement.toast_activate_success"))} disabled={actionLoading} className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-xl text-sm font-medium hover:bg-blue-700 cursor-pointer disabled:opacity-50">
                      {actionLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />} {t("sim_replacement.actions.activate")}
                    </button>
                  )}
                  {selectedItem.request_status === "activated" && canEdit && (
                    <button onClick={() => doAction("/close", selectedItem.id, {}, t("sim_replacement.toast_close_success"))} disabled={actionLoading} className="flex items-center gap-2 px-4 py-2 bg-gray-700 text-white rounded-xl text-sm font-medium hover:bg-gray-800 cursor-pointer disabled:opacity-50">
                      {actionLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} {t("sim_replacement.actions.close")}
                    </button>
                  )}
                  {!["closed", "rejected", "cancelled"].includes(selectedItem.request_status) && canEdit && (
                    <button onClick={() => doAction("/cancel", selectedItem.id, {}, t("sim_replacement.toast_cancel_success"))} disabled={actionLoading} className="flex items-center gap-2 px-4 py-2 bg-rose-600 text-white rounded-xl text-sm font-medium hover:bg-rose-700 cursor-pointer disabled:opacity-50">
                      {actionLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Ban className="w-4 h-4" />} {t("sim_replacement.actions.cancel")}
                    </button>
                  )}
                  {selectedItem.request_status === "pending" && canEdit && (
                    <button onClick={() => openEditModal(selectedItem)} disabled={actionLoading} className="flex items-center gap-2 px-4 py-2 bg-amber-600 text-white rounded-xl text-sm font-medium hover:bg-amber-700 cursor-pointer disabled:opacity-50">
                      {actionLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Pencil className="w-4 h-4" />} {t("sim_replacement.actions.edit")}
                    </button>
                  )}
                  {selectedItem.request_status === "pending" && canDelete && (
                    <button onClick={() => setDeleteTarget(selectedItem)} className="flex items-center gap-2 px-4 py-2 bg-red-700 text-white rounded-xl text-sm font-medium hover:bg-red-800 cursor-pointer">
                      <Trash2 className="w-4 h-4" /> Delete
                    </button>
                  )}
                </div>
              </>
            ) : (
              <>
                <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100 mb-4">{t("sim_replacement.create")}</h3>
                <div className="grid grid-cols-2 gap-4">
                  <div className="col-span-2">
                    <label className="text-xs font-medium text-gray-500">{t("sim_replacement.fields.house")}</label>
                    <select value={formData.house_id || ""} onChange={e => { const v = e.target.value; setFormData({ ...formData, house_id: v ? Number(v) : "", retailer_id: "", retailer_code: "", retailer_name: "" }); }} className="w-full mt-1 px-3 py-2 border border-gray-200 dark:border-slate-700 rounded-xl text-sm bg-white dark:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500/20">
                      <option value="">{t("common.select_house")}</option>
                      {houses.map(h => <option key={h.id} value={h.id}>{h.display_name}</option>)}
                    </select>
                  </div>

                  <div className="col-span-2 relative">
                    <label className="text-xs font-medium text-gray-500">{t("sim_replacement.fields.retailer")}</label>
                    <input
                      value={formData.house_id ? (formData.retailer_name || retailerSearch) : ""}
                      onChange={e => {
                        const v = e.target.value;
                        setRetailerSearch(v);
                        setFormData({ ...formData, retailer_id: "", retailer_code: "", retailer_name: "" });
                        setRetailerDropdownOpen(true);
                        clearTimeout(retailerDebounce.current);
                        retailerDebounce.current = setTimeout(() => {
                          if (formData.house_id) fetchRetailers(formData.house_id, v);
                        }, 300);
                      }}
                      onFocus={() => { if (formData.house_id) { setRetailerDropdownOpen(true); if (retailers.length === 0) fetchRetailers(formData.house_id); } }}
                      placeholder={!formData.house_id ? t("sim_replacement.select_house_first") : t("sim_replacement.search_retailer")}
                      disabled={!formData.house_id}
                      className="w-full mt-1 px-3 py-2 border border-gray-200 dark:border-slate-700 rounded-xl text-sm bg-white dark:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 disabled:opacity-50"
                    />
                    {retailerDropdownOpen && formData.house_id && (
                      <>
                        <div className="fixed inset-0 z-10" onClick={() => setRetailerDropdownOpen(false)} />
                        <div className="absolute z-20 mt-1 w-full bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-xl shadow-lg max-h-48 overflow-y-auto">
                          {retailers.length === 0 ? (
                            <p className="px-3 py-2 text-sm text-gray-400">{t("sim_replacement.no_retailers")}</p>
                          ) : retailers.map(r => (
                            <button
                              key={r.id}
                              type="button"
                              onClick={() => {
                                setFormData({ ...formData, retailer_id: r.id, retailer_name: r.name, retailer_code: r.retailer_code });
                                setRetailerSearch(r.name);
                                setRetailerDropdownOpen(false);
                              }}
                              className="w-full text-left px-3 py-2 text-sm hover:bg-gray-100 dark:hover:bg-slate-700 cursor-pointer"
                            >
                              <span className="font-medium">{r.name}</span>
                              <span className="text-gray-400 ml-2">{r.retailer_code}</span>
                              {r.itop_number && <span className="text-gray-400 ml-1">({r.itop_number})</span>}
                            </button>
                          ))}
                        </div>
                      </>
                    )}
                  </div>

                  <div className="col-span-2 sm:col-span-1">
                    <label className="text-xs font-medium text-gray-500">{t("sim_replacement.fields.reason")}</label>
                    <select value={formData.replacement_reason || "Damaged"} onChange={e => setFormData({ ...formData, replacement_reason: e.target.value })} className="w-full mt-1 px-3 py-2 border border-gray-200 dark:border-slate-700 rounded-xl text-sm bg-white dark:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500/20">
                      {["Lost", "Damaged", "Stolen", "Network_Issue", "Other"].map(r => <option key={r} value={r}>{r.replace(/_/g, " ")}</option>)}
                    </select>
                  </div>

                  <div className="col-span-2 sm:col-span-1">
                    <label className="text-xs font-medium text-gray-500">{t("sim_replacement.fields.ev_swap_serial")}</label>
                    <input value={formData.ev_swap_serial || ""} onChange={e => setFormData({ ...formData, ev_swap_serial: e.target.value })} className="w-full mt-1 px-3 py-2 border border-gray-200 dark:border-slate-700 rounded-xl text-sm bg-white dark:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500/20" />
                  </div>

                  <div className="col-span-2 sm:col-span-1">
                    <label className="text-xs font-medium text-gray-500">{t("sim_replacement.fields.priority")}</label>
                    <select value={formData.priority || "normal"} onChange={e => setFormData({ ...formData, priority: e.target.value })} className="w-full mt-1 px-3 py-2 border border-gray-200 dark:border-slate-700 rounded-xl text-sm bg-white dark:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500/20">
                      {["low", "normal", "high", "urgent"].map(p => <option key={p} value={p}>{p.charAt(0).toUpperCase() + p.slice(1)}</option>)}
                    </select>
                  </div>

                  <div className="col-span-2">
                    <label className="text-xs font-medium text-gray-500">{t("sim_replacement.fields.reason_details")}</label>
                    <textarea value={formData.reason_details || ""} onChange={e => setFormData({ ...formData, reason_details: e.target.value })} rows={2} className="w-full mt-1 px-3 py-2 border border-gray-200 dark:border-slate-700 rounded-xl text-sm bg-white dark:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500/20" />
                  </div>

                  <div className="col-span-2">
                    <label className="text-xs font-medium text-gray-500">{t("sim_replacement.fields.remarks")}</label>
                    <textarea value={formData.remarks || ""} onChange={e => setFormData({ ...formData, remarks: e.target.value })} rows={2} className="w-full mt-1 px-3 py-2 border border-gray-200 dark:border-slate-700 rounded-xl text-sm bg-white dark:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500/20" />
                  </div>
                </div>
                <div className="flex justify-end gap-3 mt-6 pt-4 border-t border-gray-100 dark:border-slate-800">
                  <button onClick={() => setShowModal(false)} className="px-4 py-2 text-sm rounded-xl border border-gray-200 dark:border-slate-700 hover:bg-gray-50 dark:hover:bg-slate-800 cursor-pointer">Cancel</button>
                  <button onClick={handleCreate} disabled={actionLoading} className="px-4 py-2 text-sm rounded-xl bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 cursor-pointer flex items-center gap-2">
                    {actionLoading && <Loader2 className="w-4 h-4 animate-spin" />} {t("sim_replacement.create")}
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

function DetailRow({ item, t, formatDate, StatusBadge, openDetail, renderActions }: {
  item: RequestItem; t: any; formatDate: any; StatusBadge: any; openDetail: (item: RequestItem) => void; renderActions: (item: RequestItem) => React.ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="px-4 py-3">
      <button onClick={() => setExpanded(!expanded)} className="flex items-center gap-3 w-full text-left cursor-pointer">
        <div className="flex-1 min-w-0">
          <p className="font-medium text-sm text-indigo-600 dark:text-indigo-400">{item.request_number}</p>
          <p className="text-[11px] text-gray-500">
            {item.retailer_name || item.retailer_code || "-"}
            {item.retailer_itop && <span className="ml-1 text-gray-400">({item.retailer_itop})</span>}
          </p>
        </div>
        <StatusBadge status={item.request_status} t={t} />
        {expanded ? <ChevronUp className="w-4 h-4 text-gray-400 shrink-0" /> : <ChevronDown className="w-4 h-4 text-gray-400 shrink-0" />}
      </button>
      {expanded && (
        <div className="mt-3 ml-2 space-y-2 text-sm text-gray-600 dark:text-gray-400">
          <div className="grid grid-cols-2 gap-2">
            <div><span className="text-[11px] text-gray-500">EV Swap Serial:</span> <span className="font-medium">{item.ev_swap_serial || "-"}</span></div>
            <div><span className="text-[11px] text-gray-500">New SIM:</span> <span className="font-medium">{item.new_sim_number || "-"}</span></div>
            <div><span className="text-[11px] text-gray-500">Reason:</span> <span className="font-medium">{item.replacement_reason?.replace(/_/g, " ") || "-"}</span></div>
            <div><span className="text-[11px] text-gray-500">Date:</span> <span className="font-medium">{formatDate(item.requested_at)}</span></div>
          {item.reason_details && (
            <div className="col-span-2">
              <span className="text-[11px] text-gray-500">Reason Details:</span>
              <p className="text-xs mt-0.5 text-gray-700 dark:text-gray-300 whitespace-pre-wrap">{item.reason_details}</p>
            </div>
          )}
          {item.remarks && (
            <div className="col-span-2">
              <span className="text-[11px] text-gray-500">Remarks:</span>
              <p className="text-xs mt-0.5 text-gray-700 dark:text-gray-300 whitespace-pre-wrap">{item.remarks}</p>
            </div>
          )}
          </div>
          <div className="flex items-center gap-2 mt-2">
            <button onClick={() => openDetail(item)} className="flex items-center gap-1.5 text-indigo-600 text-xs font-medium hover:underline cursor-pointer">
              <Eye className="w-3.5 h-3.5" /> View Details
            </button>
            {renderActions(item)}
          </div>
        </div>
      )}
    </div>
  );
}
