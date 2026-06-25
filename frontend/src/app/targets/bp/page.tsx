"use client";

import { useEffect, useState, useCallback } from "react";
import apiClient from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import {
  Crosshair, Plus, Loader2, Search, Pencil, Trash2, X, ChevronLeft, ChevronRight
} from "lucide-react";
import { toast } from "react-hot-toast";
import { useLanguage } from "@/i18n/useLanguage";
import { AccessDenied } from "@/components/ui/AccessDenied";
import { ConfirmationModal } from "@/components/ui/ConfirmationModal";

interface BpTarget {
  id: number;
  house_id: number;
  employee_id: number;
  ga_target: number;
  ev_secondary: number;
  sc_secondary: number;
  total_recharge: number;
  target_date: string;
  house?: { id: number; display_name?: string; name?: string };
  employee?: { id: number; employee_id?: string; itop_number?: string; personal_number?: string };
}

interface Pagination {
  page: number;
  per_page: number;
  total: number;
  total_pages: number;
  has_next: boolean;
  has_prev: boolean;
}

export default function BPTargetsPage() {
  const { hasPermission, loading: authLoading, selectedHouse, user } = useAuth();
  const { t } = useLanguage();

  const [data, setData] = useState<BpTarget[]>([]);
  const [loading, setLoading] = useState(true);
  const [pagination, setPagination] = useState<Pagination>({
    page: 1, per_page: 20, total: 0, total_pages: 0, has_next: false, has_prev: false,
  });
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");

  const [houses, setHouses] = useState<any[]>([]);
  const [bpEmployees, setBpEmployees] = useState<any[]>([]);
  const [distributing, setDistributing] = useState(false);

  const [modalOpen, setModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<BpTarget | null>(null);
  const [modalHouseId, setModalHouseId] = useState("");
  const [formData, setFormData] = useState({
    employee_id: "",
    target_date: "",
    ga_target: "0",
    ev_secondary: "0.00",
    sc_secondary: "0.00",
    total_recharge: "0.00",
  });
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  const today = new Date();
  const defaultMonth = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-01`;
  const defaultMonthValue = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`;

  const canView = hasPermission("bp_targets.view");
  const canCreate = hasPermission("bp_targets.create");
  const canEdit = hasPermission("bp_targets.edit");
  const canDelete = hasPermission("bp_targets.delete");

  const fetchData = useCallback(async () => {
    if (!canView) { setLoading(false); return; }
    setLoading(true);
    try {
      const params: Record<string, string> = {
        page: String(page), per_page: "20",
        target_date: defaultMonth,
      };
      if (search) params.search = search;
      const res = await apiClient.get("bp-targets", { params });
      setData(res.data?.data || []);
      setPagination(res.data?.pagination || pagination);
    } catch (err: any) {
      console.error("BP Targets fetch error:", err);
      toast.error(t("bp_targets.toast_load_failed") || t("common.error"));
    }
    setLoading(false);
  }, [page, search, canView, defaultMonth]);

  useEffect(() => {
    if (authLoading) return;
    apiClient.get("houses/accessible").then(res => setHouses(res.data || [])).catch(() => {});
  }, [authLoading]);

  useEffect(() => {
    if (!authLoading) fetchData();
  }, [fetchData, authLoading]);

  useEffect(() => {
    if (modalOpen && modalHouseId) {
      apiClient.get("bp-retailer-codes/bp-employees", {
        params: { house_id: modalHouseId }
      }).then(res => setBpEmployees(res.data || [])).catch(() => {});
    }
  }, [modalOpen, modalHouseId]);

  const handleDistribute = async () => {
    setDistributing(true);
    try {
      const params: Record<string, string> = { target_date: defaultMonth };
      const res = await apiClient.post("bp-targets/distribute", null, { params });
      toast.success(res.data?.message || t("bp_targets.distribute_success"));
      fetchData();
    } catch {
      toast.error(t("common.error"));
    }
    setDistributing(false);
  };

  const openCreateModal = () => {
    setEditingItem(null);
    const firstHouseId = houses.length > 0 ? String(houses[0].id) : "";
    setModalHouseId(firstHouseId);
    setBpEmployees([]);
    setFormData({
      employee_id: "",
      target_date: defaultMonthValue,
      ga_target: "0",
      ev_secondary: "0.00",
      sc_secondary: "0.00",
      total_recharge: "0.00",
    });
    setFormErrors({});
    setModalOpen(true);
  };

  const openEditModal = (item: BpTarget) => {
    setEditingItem(item);
    const dateStr = item.target_date?.split("T")[0] || defaultMonth;
    const monthVal = dateStr.substring(0, 7);
    setModalHouseId(String(item.house_id));
    setFormData({
      employee_id: String(item.employee_id),
      target_date: monthVal,
      ga_target: String(item.ga_target ?? 0),
      ev_secondary: String(item.ev_secondary ?? "0.00"),
      sc_secondary: String(item.sc_secondary ?? "0.00"),
      total_recharge: String(item.total_recharge ?? "0.00"),
    });
    setFormErrors({});
    setModalOpen(true);
  };

  const validateForm = () => {
    const errors: Record<string, string> = {};
    if (!editingItem && !formData.employee_id) errors.employee_id = t("common.field_required") || "Employee is required";
    if (!formData.target_date) errors.target_date = t("common.field_required") || "Target date is required";
    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSave = async () => {
    if (!validateForm()) return;
    setSaving(true);
    try {
      const targetDate = formData.target_date.length === 7
        ? `${formData.target_date}-01`
        : formData.target_date;
      const body = {
        ...(editingItem ? {} : { employee_id: Number(formData.employee_id), house_id: Number(modalHouseId) }),
        target_date: targetDate,
        ga_target: Number(formData.ga_target) || 0,
        ev_secondary: Number(formData.ev_secondary) || 0,
        sc_secondary: Number(formData.sc_secondary) || 0,
        total_recharge: Number(formData.total_recharge) || 0,
      };

      if (editingItem) {
        await apiClient.put(`bp-targets/${editingItem.id}`, body);
        toast.success(t("bp_targets.toast_update_success"));
      } else {
        await apiClient.post("bp-targets", body);
        toast.success(t("bp_targets.toast_create_success"));
      }
      setModalOpen(false);
      fetchData();
    } catch (err: any) {
      console.error("BP Target create/edit error:", err);
      const detail = err?.response?.data?.detail || err?.response?.data?.message;
      const status = err?.response?.status;
      const msg = detail ? `${detail}${status ? ` (${status})` : ""}` : t("common.error");
      toast.error(msg);
    }
    setSaving(false);
  };

  const openDeleteModal = (id: number) => {
    setDeletingId(id);
    setDeleteModalOpen(true);
  };

  const handleDelete = async () => {
    if (!deletingId) return;
    try {
      await apiClient.delete(`bp-targets/${deletingId}`);
      toast.success(t("bp_targets.toast_delete_success"));
      setDeleteModalOpen(false);
      setDeletingId(null);
      fetchData();
    } catch {
      toast.error(t("bp_targets.toast_delete_failed") || t("common.error"));
    }
  };

  if (!authLoading && !canView) return <AccessDenied />;

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-gray-900 dark:text-gray-100">
            {t("bp_targets.title")}
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            {t("bp_targets.manage_for", { month: defaultMonth })}
          </p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          {canEdit && (
            <button
              onClick={handleDistribute}
              disabled={distributing}
              className="px-4 py-2.5 bg-primary-500 text-white rounded-xl text-sm font-semibold flex items-center gap-2 hover:bg-primary-600 transition-colors disabled:opacity-50 min-h-[44px]"
            >
              {distributing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
              {t("bp_targets.auto_distribute")}
            </button>
          )}
          {canCreate && (
            <button
              onClick={openCreateModal}
              className="px-4 py-2.5 bg-emerald-500 text-white rounded-xl text-sm font-semibold flex items-center gap-2 hover:bg-emerald-600 transition-colors min-h-[44px]"
            >
              <Plus className="w-4 h-4" />
              {t("bp_targets.add_new")}
            </button>
          )}
        </div>
      </div>

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
        <input
          type="text"
          value={search}
          onChange={e => { setSearch(e.target.value); setPage(1); }}
          placeholder={t("bp_targets.search_placeholder")}
          className="w-full pl-9 pr-4 py-2.5 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-xl text-sm outline-none focus:ring-2 focus:ring-primary-500 min-h-[44px]"
        />
      </div>

      {loading ? (
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-gray-100 dark:border-slate-800 shadow-sm overflow-hidden">
          <div className="divide-y divide-gray-50 dark:divide-slate-800">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex items-center gap-4 px-6 py-5 animate-pulse">
                <div className="space-y-2 flex-1">
                  <div className="h-3 w-32 bg-gray-200 dark:bg-slate-700 rounded-md" />
                  <div className="h-2.5 w-24 bg-gray-100 dark:bg-slate-800 rounded-md" />
                </div>
                <div className="hidden sm:block flex-1 space-y-2">
                  <div className="h-3 w-20 bg-gray-200 dark:bg-slate-700 rounded-md" />
                </div>
                <div className="hidden md:block flex-1 space-y-2">
                  <div className="h-3 w-16 bg-gray-200 dark:bg-slate-700 rounded-md" />
                </div>
                <div className="hidden md:block flex-1 space-y-2">
                  <div className="h-3 w-20 bg-gray-200 dark:bg-slate-700 rounded-md" />
                </div>
                <div className="w-20 h-8 bg-gray-200 dark:bg-slate-700 rounded-lg" />
              </div>
            ))}
          </div>
        </div>
      ) : data.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <Crosshair className="w-16 h-16 text-gray-300 dark:text-gray-600 mb-4" />
          <h3 className="text-lg font-semibold text-gray-700 dark:text-gray-300">{t("bp_targets.no_data")}</h3>
          <p className="text-sm text-gray-500 mt-2">{t("bp_targets.no_data_desc")}</p>
        </div>
      ) : (
        <>
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-gray-100 dark:border-slate-800 shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-50 dark:border-slate-800 bg-gray-50/50 dark:bg-slate-800/50">
                    <th className="text-left px-6 py-4 font-semibold text-gray-700 dark:text-gray-300 whitespace-nowrap">
                      {t("bp_targets.table_bp")}
                    </th>
                    <th className="text-left px-6 py-4 font-semibold text-gray-700 dark:text-gray-300 whitespace-nowrap hidden sm:table-cell">
                      {t("bp_targets.table_house")}
                    </th>
                    <th className="text-right px-6 py-4 font-semibold text-gray-700 dark:text-gray-300 whitespace-nowrap">
                      {t("bp_targets.table_ga")}
                    </th>
                    <th className="text-right px-6 py-4 font-semibold text-gray-700 dark:text-gray-300 whitespace-nowrap hidden md:table-cell">
                      {t("bp_targets.table_ev")}
                    </th>
                    <th className="text-right px-6 py-4 font-semibold text-gray-700 dark:text-gray-300 whitespace-nowrap hidden md:table-cell">
                      {t("bp_targets.table_sc")}
                    </th>
                    <th className="text-right px-6 py-4 font-semibold text-gray-700 dark:text-gray-300 whitespace-nowrap hidden lg:table-cell">
                      {t("bp_targets.table_recharge")}
                    </th>
                    <th className="text-center px-6 py-4 font-semibold text-gray-700 dark:text-gray-300 whitespace-nowrap hidden sm:table-cell">
                      {t("bp_targets.table_date")}
                    </th>
                    {(canEdit || canDelete) && (
                      <th className="text-center px-6 py-4 font-semibold text-gray-700 dark:text-gray-300 whitespace-nowrap">
                        {t("bp_targets.table_actions")}
                      </th>
                    )}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50 dark:divide-slate-800">
                  {data.map((bt) => (
                    <tr key={bt.id} className="hover:bg-gray-50/50 dark:hover:bg-slate-800/50">
                      <td className="px-6 py-4">
                        <div className="font-medium text-gray-900 dark:text-gray-100">
                          {bt.employee?.employee_id || `BP #${bt.employee_id}`}
                        </div>
                        <div className="text-xs text-gray-400 sm:hidden mt-1">
                          {bt.house?.display_name || bt.house?.name || ""}
                        </div>
                      </td>
                      <td className="px-6 py-4 text-gray-500 hidden sm:table-cell">
                        {bt.house?.display_name || bt.house?.name || ""}
                      </td>
                      <td className="px-6 py-4 text-right font-semibold text-gray-900 dark:text-gray-100">
                        {bt.ga_target}
                      </td>
                      <td className="px-6 py-4 text-right text-gray-500 hidden md:table-cell">
                        {bt.ev_secondary}
                      </td>
                      <td className="px-6 py-4 text-right text-gray-500 hidden md:table-cell">
                        {bt.sc_secondary}
                      </td>
                      <td className="px-6 py-4 text-right text-gray-500 hidden lg:table-cell">
                        {bt.total_recharge}
                      </td>
                      <td className="px-6 py-4 text-center text-gray-400 text-xs hidden sm:table-cell">
                        {bt.target_date?.split("T")[0]}
                      </td>
                      {(canEdit || canDelete) && (
                        <td className="px-6 py-4">
                          <div className="flex items-center justify-center gap-2">
                            {canEdit && (
                              <button
                                onClick={() => openEditModal(bt)}
                                className="p-2 text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-500/10 rounded-lg transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center"
                                title={t("common.edit")}
                              >
                                <Pencil className="w-4 h-4" />
                              </button>
                            )}
                            {canDelete && (
                              <button
                                onClick={() => openDeleteModal(bt.id)}
                                className="p-2 text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 rounded-lg transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center"
                                title={t("common.delete")}
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            )}
                          </div>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {pagination.total_pages > 1 && (
            <div className="flex items-center justify-between gap-4 text-sm">
              <p className="text-gray-500 dark:text-gray-400">
                {t("bp_targets.showing_results", {
                  start: (pagination.page - 1) * pagination.per_page + 1,
                  end: Math.min(pagination.page * pagination.per_page, pagination.total),
                  total: pagination.total,
                })}
              </p>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  disabled={!pagination.has_prev}
                  className="p-2.5 border border-gray-200 dark:border-slate-700 rounded-xl hover:bg-gray-50 dark:hover:bg-slate-800 disabled:opacity-40 transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <span className="px-3 py-1.5 font-medium text-gray-700 dark:text-gray-300">
                  {pagination.page} / {pagination.total_pages}
                </span>
                <button
                  onClick={() => setPage(p => Math.min(pagination.total_pages, p + 1))}
                  disabled={!pagination.has_next}
                  className="p-2.5 border border-gray-200 dark:border-slate-700 rounded-xl hover:bg-gray-50 dark:hover:bg-slate-800 disabled:opacity-40 transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" onClick={() => setModalOpen(false)}>
          <div
            className="bg-white dark:bg-slate-900 rounded-2xl shadow-xl border border-gray-100 dark:border-slate-800 w-full max-w-lg max-h-[90vh] overflow-y-auto"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between p-6 border-b border-gray-100 dark:border-slate-800">
              <div>
                <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">
                  {editingItem ? t("bp_targets.modal_edit_title") : t("bp_targets.modal_create_title")}
                </h2>
                <p className="text-sm text-gray-500 mt-0.5">{t("bp_targets.modal_subtitle")}</p>
              </div>
              <button
                onClick={() => setModalOpen(false)}
                className="p-2 hover:bg-gray-100 dark:hover:bg-slate-800 rounded-xl transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center"
              >
                <X className="w-5 h-5 text-gray-400" />
              </button>
            </div>

            <div className="p-6 space-y-5">
              {!editingItem && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                    {t("bp_targets.house")}
                  </label>
                  <select
                    value={modalHouseId}
                    onChange={e => { setModalHouseId(e.target.value); setFormData(f => ({ ...f, employee_id: "" })); }}
                    className="w-full px-3 py-2.5 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-xl text-sm outline-none focus:ring-2 focus:ring-primary-500 min-h-[44px]"
                  >
                    <option value="">{t("bp_targets.all_houses")}</option>
                    {houses.map((h: any) => (
                      <option key={h.id} value={h.id}>{h.display_name}</option>
                    ))}
                  </select>
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                  {t("bp_targets.field_employee")}
                </label>
                <select
                  value={formData.employee_id}
                  onChange={e => setFormData(f => ({ ...f, employee_id: e.target.value }))}
                  disabled={!!editingItem || !modalHouseId}
                  className="w-full px-3 py-2.5 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-xl text-sm outline-none focus:ring-2 focus:ring-primary-500 min-h-[44px] disabled:opacity-50"
                >
                  <option value="">{t("bp_targets.field_employee_placeholder")}</option>
                  {bpEmployees.map((emp: any) => (
                    <option key={emp.id} value={emp.id}>
                      {emp.name || emp.employee_id || `BP #${emp.id}`} — {emp.pool_number || "N/A"}
                    </option>
                  ))}
                </select>
                {formErrors.employee_id && (
                  <p className="text-red-500 text-xs mt-1">{formErrors.employee_id}</p>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                  {t("bp_targets.field_target_date")}
                </label>
                <input
                  type="month"
                  value={formData.target_date}
                  onChange={e => setFormData(f => ({ ...f, target_date: e.target.value }))}
                  className="w-full px-3 py-2.5 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-xl text-sm outline-none focus:ring-2 focus:ring-primary-500 min-h-[44px]"
                />
                {formErrors.target_date && (
                  <p className="text-red-500 text-xs mt-1">{formErrors.target_date}</p>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                    {t("bp_targets.field_ga_target")}
                  </label>
                  <input
                    type="number"
                    value={formData.ga_target}
                    onChange={e => setFormData(f => ({ ...f, ga_target: e.target.value }))}
                    placeholder={t("bp_targets.field_ga_placeholder")}
                    className="w-full px-3 py-2.5 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-xl text-sm outline-none focus:ring-2 focus:ring-primary-500 min-h-[44px]"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                    {t("bp_targets.field_ev_secondary")}
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    value={formData.ev_secondary}
                    onChange={e => setFormData(f => ({ ...f, ev_secondary: e.target.value }))}
                    placeholder={t("bp_targets.field_ev_placeholder")}
                    className="w-full px-3 py-2.5 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-xl text-sm outline-none focus:ring-2 focus:ring-primary-500 min-h-[44px]"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                    {t("bp_targets.field_sc_secondary")}
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    value={formData.sc_secondary}
                    onChange={e => setFormData(f => ({ ...f, sc_secondary: e.target.value }))}
                    placeholder={t("bp_targets.field_sc_placeholder")}
                    className="w-full px-3 py-2.5 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-xl text-sm outline-none focus:ring-2 focus:ring-primary-500 min-h-[44px]"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                    {t("bp_targets.field_total_recharge")}
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    value={formData.total_recharge}
                    onChange={e => setFormData(f => ({ ...f, total_recharge: e.target.value }))}
                    placeholder={t("bp_targets.field_total_recharge_placeholder")}
                    className="w-full px-3 py-2.5 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-xl text-sm outline-none focus:ring-2 focus:ring-primary-500 min-h-[44px]"
                  />
                </div>
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 p-6 border-t border-gray-100 dark:border-slate-800">
              <button
                onClick={() => setModalOpen(false)}
                className="px-5 py-2.5 border border-gray-200 dark:border-slate-700 rounded-xl text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-slate-800 transition-colors min-h-[44px]"
              >
                {t("bp_targets.btn_cancel")}
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="px-5 py-2.5 bg-primary-500 text-white rounded-xl text-sm font-semibold hover:bg-primary-600 transition-colors disabled:opacity-50 flex items-center gap-2 min-h-[44px]"
              >
                {saving && <Loader2 className="w-4 h-4 animate-spin" />}
                {editingItem ? t("bp_targets.btn_update") : t("bp_targets.btn_create")}
              </button>
            </div>
          </div>
        </div>
      )}

      <ConfirmationModal
        isOpen={deleteModalOpen}
        onClose={() => setDeleteModalOpen(false)}
        onConfirm={handleDelete}
        title={t("bp_targets.delete_title")}
        message={t("bp_targets.delete_message")}
        confirmText={t("bp_targets.delete_confirm")}
      />
    </div>
  );
}
