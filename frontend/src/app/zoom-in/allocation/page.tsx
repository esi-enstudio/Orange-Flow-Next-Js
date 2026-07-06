"use client";

import { useEffect, useState, useCallback } from "react";
import apiClient from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { useLanguage } from "@/i18n/useLanguage";
import { AccessDenied } from "@/components/ui/AccessDenied";
import { toast } from "react-hot-toast";
import {
  Plus,
  Search,
  Pencil,
  Trash2,
  X,
  Loader2,
  AlertTriangle,
  Check,
  ChevronLeft,
  ChevronRight,
  ChartNoAxesColumnIncreasing,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface Allocation {
  id: number;
  house_id: number;
  month: string;
  event_type_id: number;
  thana: string;
  count: number;
  budget_per_unit: number;
  total_budget: number;
  house_name: string | null;
  event_type_name: string | null;
}

interface House {
  id: number;
  name: string;
  code: string;
  display_name: string;
}

interface EventType {
  id: number;
  name: string;
}

interface PaginationMeta {
  page: number;
  per_page: number;
  total: number;
  total_pages: number;
  has_next: boolean;
  has_prev: boolean;
}

interface PaginatedResponse<T> {
  success: boolean;
  data: T[];
  pagination: PaginationMeta;
}

function toMonthValue(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function currentMonth(): string {
  return toMonthValue(new Date());
}

export default function AllocationsPage() {
  const { hasPermission, loading: authLoading } = useAuth();
  const { t } = useLanguage();

  const [allocations, setAllocations] = useState<Allocation[]>([]);
  const [pagination, setPagination] = useState<PaginationMeta | null>(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [monthFilter, setMonthFilter] = useState(currentMonth());
  const [search, setSearch] = useState("");

  const [houses, setHouses] = useState<House[]>([]);
  const [eventTypes, setEventTypes] = useState<EventType[]>([]);
  const [thanas, setThanas] = useState<string[]>([]);

  const [editOpen, setEditOpen] = useState(false);
  const [editing, setEditing] = useState<Allocation | null>(null);
  const [editForm, setEditForm] = useState({
    count: 0,
    budget_per_unit: 0,
  });
  const [editLoading, setEditLoading] = useState(false);
  const [editErrors, setEditErrors] = useState<Record<string, string>>({});

  const [createOpen, setCreateOpen] = useState(false);
  const [createHouseId, setCreateHouseId] = useState(0);
  const [createMonth, setCreateMonth] = useState(currentMonth());
  const [createRows, setCreateRows] = useState<{ thana: string; event_type_id: number; count: number; budget_per_unit: number }[]>([]);
  const [createLoading, setCreateLoading] = useState(false);

  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState<Allocation | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  const fetchAllocations = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, string | number> = {
        page,
        per_page: 20,
        month: monthFilter,
        sort_by: "month",
        sort_order: "desc",
      };
      if (search) params.search = search;
      const res = await apiClient.get<PaginatedResponse<Allocation>>(
        "zoom-in/allocations",
        { params }
      );
      setAllocations(res.data.data);
      setPagination(res.data.pagination);
    } catch {
      toast.error(t("zoom_in.allocations.messages.load_failed"));
    } finally {
      setLoading(false);
    }
  }, [page, monthFilter, search, t]);

  const fetchDropdownData = useCallback(async () => {
    try {
      const [housesRes, etRes, thanasRes] = await Promise.all([
        apiClient.get<House[]>("houses/accessible"),
        apiClient.get<EventType[]>("zoom-in/event-types"),
        apiClient.get<string[]>("zoom-in/thanas"),
      ]);
      setHouses(housesRes.data);
      setEventTypes(etRes.data);
      setThanas(thanasRes.data);
    } catch {
      toast.error(t("zoom_in.allocations.messages.load_failed"));
    }
  }, [t]);

  useEffect(() => {
    if (authLoading || !hasPermission("zoom_in.view")) return;
    fetchAllocations();
  }, [fetchAllocations, authLoading]);

  const handleMonthFilterChange = (newMonth: string) => {
    setMonthFilter(newMonth);
    setPage(1);
  };

  useEffect(() => {
    if (authLoading) return;
    fetchDropdownData();
  }, [fetchDropdownData, authLoading]);

  const totalBudget = allocations.reduce((sum, a) => sum + a.total_budget, 0);

  const openCreate = () => {
    setCreateHouseId(0);
    setCreateMonth(monthFilter);
    setCreateRows([]);
    setCreateOpen(true);
  };

  const openEdit = (a: Allocation) => {
    setEditing(a);
    setEditForm({ count: a.count, budget_per_unit: a.budget_per_unit });
    setEditErrors({});
    setEditOpen(true);
  };

  const closeEdit = () => {
    setEditOpen(false);
    setEditing(null);
    setEditForm({ count: 0, budget_per_unit: 0 });
    setEditErrors({});
  };

  const addRow = () => {
    setCreateRows((prev) => [...prev, { thana: "", event_type_id: 0, count: 0, budget_per_unit: 0 }]);
  };

  const removeRow = (idx: number) => {
    setCreateRows((prev) => prev.filter((_, i) => i !== idx));
  };

  const updateRow = (idx: number, field: string, value: unknown) => {
    setCreateRows((prev) => {
      const rows = [...prev];
      rows[idx] = { ...rows[idx], [field]: value };
      return rows;
    });
  };

  const handleCreateSubmit = async () => {
    if (!createHouseId) { toast.error(t("zoom_in.validation.house_required")); return; }
    if (!createMonth) { toast.error(t("zoom_in.validation.month_required")); return; }
    const validRows = createRows.filter((r) => r.thana && r.event_type_id);
    if (!validRows.length) { toast.error(t("zoom_in.allocations.validation.no_items")); return; }
    setCreateLoading(true);
    try {
      await apiClient.post("zoom-in/allocations/bulk", {
        house_id: createHouseId,
        month: createMonth + "-01",
        allocations: validRows.map((r) => ({
          event_type_id: r.event_type_id,
          thana: r.thana,
          count: r.count,
          budget_per_unit: r.budget_per_unit,
        })),
      });
      toast.success(t("zoom_in.allocations.messages.create_success"));
      setCreateOpen(false);
      fetchAllocations();
    } catch (err: any) {
      toast.error(err.response?.data?.detail || err.message || t("common.error"));
    } finally {
      setCreateLoading(false);
    }
  };

  const handleEditSubmit = async () => {
    if (!editing) return;
    setEditLoading(true);
    try {
      await apiClient.put(`zoom-in/allocations/${editing.id}`, {
        count: editForm.count,
        budget_per_unit: editForm.budget_per_unit,
      });
      toast.success(t("zoom_in.allocations.messages.update_success"));
      closeEdit();
      fetchAllocations();
    } catch (err: any) {
      toast.error(err.response?.data?.detail || err.message || t("common.error"));
    } finally {
      setEditLoading(false);
    }
  };

  const openDelete = (a: Allocation) => {
    setDeleting(a);
    setDeleteOpen(true);
  };

  const closeDelete = () => {
    setDeleteOpen(false);
    setDeleting(null);
  };

  const handleDeleteConfirm = async () => {
    if (!deleting) return;
    setDeleteLoading(true);
    try {
      await apiClient.delete(`zoom-in/allocations/${deleting.id}`);
      toast.success(t("zoom_in.allocations.messages.delete_success"));
      closeDelete();
      fetchAllocations();
    } catch {
      toast.error(t("common.error"));
    } finally {
      setDeleteLoading(false);
    }
  };

  if (!authLoading && !hasPermission("zoom_in.view")) {
    return <AccessDenied />;
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
            {t("zoom_in.allocations.title")}
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            {t("zoom_in.allocations.description")}
          </p>
        </div>
        {hasPermission("zoom_in.create") && (
          <button
            onClick={openCreate}
            className="inline-flex items-center justify-center gap-2 px-4 py-2 bg-primary-500 text-white rounded-lg text-sm font-bold hover:bg-primary-600 transition-colors shadow-sm"
          >
            <Plus className="w-4 h-4" />
            {t("zoom_in.allocations.create")}
          </button>
        )}
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            placeholder={t("common.search")}
            className="w-full pl-10 pr-4 py-2 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl text-sm focus:ring-2 focus:ring-primary-500 transition-all outline-none dark:text-gray-100"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="w-full sm:w-48">
          <input
            type="month"
            value={monthFilter}
            onChange={(e) => handleMonthFilterChange(e.target.value)}
            className="w-full px-3 py-2 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl text-sm focus:ring-2 focus:ring-primary-500 transition-all outline-none dark:text-gray-100"
          />
        </div>
      </div>

      {loading ? (
        <div className="divide-y divide-gray-100 dark:divide-slate-800 bg-white dark:bg-slate-900 rounded-2xl border border-gray-100 dark:border-slate-800 overflow-hidden">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="flex items-center gap-4 px-6 py-5 animate-pulse">
              <div className="space-y-2 flex-1">
                <div className="h-3 w-36 bg-gray-200 dark:bg-slate-700 rounded-md" />
                <div className="h-2.5 w-20 bg-gray-100 dark:bg-slate-800 rounded-md" />
              </div>
              <div className="hidden sm:block flex-1 space-y-2">
                <div className="h-3 w-24 bg-gray-200 dark:bg-slate-700 rounded-md" />
              </div>
            </div>
          ))}
        </div>
      ) : allocations.length === 0 ? (
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-dashed border-gray-300 dark:border-slate-800 p-16 text-center">
          <ChartNoAxesColumnIncreasing className="w-12 h-12 text-gray-300 dark:text-gray-700 mx-auto mb-4" />
          <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100">
            {t("zoom_in.allocations.messages.no_data")}
          </h3>
        </div>
      ) : (
        <>
          <div className="bg-primary-50 dark:bg-primary-500/10 rounded-2xl border border-primary-100 dark:border-primary-500/20 px-6 py-4 flex items-center justify-between">
            <span className="text-sm font-bold text-gray-700 dark:text-gray-300">
              {t("zoom_in.fields.total_budget")}
            </span>
            <span className="text-xl font-bold text-primary-600 dark:text-primary-400">
              ৳{totalBudget.toLocaleString()}
            </span>
          </div>

          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-gray-100 dark:border-slate-800 overflow-hidden">
            <div className="overflow-x-auto scrollbar-custom">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 dark:border-slate-800 bg-gray-50 dark:bg-slate-900/50">
                    <th className="text-left px-6 py-4 font-bold text-gray-500 dark:text-gray-400 text-xs uppercase tracking-wider">
                      {t("zoom_in.allocations.table.house")}
                    </th>
                    <th className="text-left px-6 py-4 font-bold text-gray-500 dark:text-gray-400 text-xs uppercase tracking-wider">
                      {t("zoom_in.allocations.table.month")}
                    </th>
                    <th className="text-left px-6 py-4 font-bold text-gray-500 dark:text-gray-400 text-xs uppercase tracking-wider">
                      {t("zoom_in.allocations.table.event_type")}
                    </th>
                    <th className="text-left px-6 py-4 font-bold text-gray-500 dark:text-gray-400 text-xs uppercase tracking-wider">
                      {t("zoom_in.fields.thana")}
                    </th>
                    <th className="text-right px-6 py-4 font-bold text-gray-500 dark:text-gray-400 text-xs uppercase tracking-wider">
                      {t("zoom_in.allocations.table.count")}
                    </th>
                    <th className="text-right px-6 py-4 font-bold text-gray-500 dark:text-gray-400 text-xs uppercase tracking-wider">
                      {t("zoom_in.allocations.table.budget_per_unit")}
                    </th>
                    <th className="text-right px-6 py-4 font-bold text-gray-500 dark:text-gray-400 text-xs uppercase tracking-wider">
                      {t("zoom_in.allocations.table.total_budget")}
                    </th>
                    <th className="text-right px-6 py-4 font-bold text-gray-500 dark:text-gray-400 text-xs uppercase tracking-wider">
                      {t("zoom_in.allocations.table.actions")}
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50 dark:divide-slate-800/50">
                  {allocations.map((a) => (
                    <tr key={a.id} className="hover:bg-gray-50 dark:hover:bg-slate-800/50 transition-colors">
                      <td className="px-6 py-4 text-gray-900 dark:text-gray-100 font-medium">
                        {a.house_name || `#${a.house_id}`}
                      </td>
                      <td className="px-6 py-4 text-gray-700 dark:text-gray-300">
                        {a.month}
                      </td>
                      <td className="px-6 py-4 text-gray-700 dark:text-gray-300">
                        {a.event_type_name || `#${a.event_type_id}`}
                      </td>
                      <td className="px-6 py-4 text-gray-700 dark:text-gray-300">
                        {a.thana || "—"}
                      </td>
                      <td className="px-6 py-4 text-right text-gray-900 dark:text-gray-100 font-medium">
                        {a.count}
                      </td>
                      <td className="px-6 py-4 text-right text-gray-900 dark:text-gray-100 font-medium">
                        ৳{a.budget_per_unit.toLocaleString()}
                      </td>
                      <td className="px-6 py-4 text-right text-gray-900 dark:text-gray-100 font-bold">
                        ৳{a.total_budget.toLocaleString()}
                      </td>
                      <td className="px-6 py-4 text-right">
                        <div className="flex items-center justify-end gap-2">
                          {hasPermission("zoom_in.edit") && (
                            <button
                              onClick={() => openEdit(a)}
                              className="p-2 text-gray-400 hover:text-amber-500 hover:bg-amber-50 dark:hover:bg-amber-500/10 rounded-lg transition-all"
                              title="Edit"
                            >
                              <Pencil className="w-4 h-4" />
                            </button>
                          )}
                          {hasPermission("zoom_in.delete") && (
                            <button
                              onClick={() => openDelete(a)}
                              className="p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 rounded-lg transition-all"
                              title="Delete"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {pagination && pagination.total_pages > 1 && (
            <div className="flex items-center justify-between gap-4">
              <p className="text-sm text-gray-500 dark:text-gray-400">
                {pagination.total} {t("zoom_in.allocations.messages.no_data")}
              </p>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={!pagination.has_prev}
                  className="p-2 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 disabled:opacity-40 transition-all"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <span className="text-sm font-medium text-gray-700 dark:text-gray-300 px-2">
                  {pagination.page} / {pagination.total_pages}
                </span>
                <button
                  onClick={() => setPage((p) => p + 1)}
                  disabled={!pagination.has_next}
                  className="p-2 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 disabled:opacity-40 transition-all"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {/* ── Create Modal (dynamic rows) ── */}
      {createOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-white dark:bg-slate-900 w-full max-w-4xl rounded-2xl shadow-2xl animate-in zoom-in-95 duration-200 max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between p-6 border-b border-gray-100 dark:border-slate-800 shrink-0">
              <div>
                <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">
                  {t("zoom_in.allocations.create")}
                </h2>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                  {t("zoom_in.allocations.description")}
                </p>
              </div>
              <button
                onClick={() => setCreateOpen(false)}
                className="p-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-slate-800 rounded-xl transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 space-y-5 overflow-y-auto flex-1">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-bold text-gray-700 dark:text-gray-300 mb-1.5">
                    {t("zoom_in.fields.house")} <span className="text-red-500">*</span>
                  </label>
                  <select
                    value={createHouseId}
                    onChange={(e) => setCreateHouseId(Number(e.target.value))}
                    className="w-full px-3 py-2.5 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl text-sm outline-none focus:ring-2 focus:ring-primary-500 dark:text-gray-100"
                  >
                    <option value={0}>{t("zoom_in.fields.select_house")}</option>
                    {houses.map((h) => (
                      <option key={h.id} value={h.id}>{h.display_name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-bold text-gray-700 dark:text-gray-300 mb-1.5">
                    {t("zoom_in.fields.month")} <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="month"
                    value={createMonth}
                    onChange={(e) => setCreateMonth(e.target.value)}
                    className="w-full px-3 py-2.5 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl text-sm outline-none focus:ring-2 focus:ring-primary-500 dark:text-gray-100"
                  />
                </div>
              </div>

              <div className="border border-gray-200 dark:border-slate-800 rounded-xl overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 dark:bg-slate-800/50 border-b border-gray-200 dark:border-slate-800">
                      <th className="text-left px-4 py-3 font-bold text-gray-500 dark:text-gray-400 text-xs uppercase tracking-wider min-w-[140px]">
                        {t("zoom_in.fields.thana")}
                      </th>
                      <th className="text-left px-4 py-3 font-bold text-gray-500 dark:text-gray-400 text-xs uppercase tracking-wider min-w-[140px]">
                        {t("zoom_in.fields.event_type")}
                      </th>
                      <th className="text-left px-4 py-3 font-bold text-gray-500 dark:text-gray-400 text-xs uppercase tracking-wider min-w-[100px]">
                        {t("zoom_in.fields.count")}
                      </th>
                      <th className="text-left px-4 py-3 font-bold text-gray-500 dark:text-gray-400 text-xs uppercase tracking-wider min-w-[120px]">
                        {t("zoom_in.fields.budget_per_unit")}
                      </th>
                      <th className="w-16 px-4 py-3" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-slate-800">
                    {createRows.map((row, idx) => (
                      <tr key={idx}>
                        <td className="px-4 py-2">
                          <select
                            value={row.thana}
                            onChange={(e) => updateRow(idx, "thana", e.target.value)}
                            className="w-full px-2 py-1.5 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-lg text-sm outline-none focus:ring-2 focus:ring-primary-500 dark:text-gray-100"
                          >
                            <option value="">{t("zoom_in.fields.select_thana")}</option>
                            {thanas.map((th) => (
                              <option key={th} value={th}>{th}</option>
                            ))}
                          </select>
                        </td>
                        <td className="px-4 py-2">
                          <select
                            value={row.event_type_id}
                            onChange={(e) => updateRow(idx, "event_type_id", Number(e.target.value))}
                            className="w-full px-2 py-1.5 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-lg text-sm outline-none focus:ring-2 focus:ring-primary-500 dark:text-gray-100"
                          >
                            <option value={0}>{t("zoom_in.fields.select_event_type")}</option>
                            {eventTypes.map((et) => (
                              <option key={et.id} value={et.id}>{et.name}</option>
                            ))}
                          </select>
                        </td>
                        <td className="px-4 py-2">
                          <input
                            type="number"
                            min={0}
                            value={row.count || ""}
                            onChange={(e) => updateRow(idx, "count", Number(e.target.value) || 0)}
                            className="w-full px-2 py-1.5 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-lg text-sm outline-none focus:ring-2 focus:ring-primary-500 dark:text-gray-100"
                          />
                        </td>
                        <td className="px-4 py-2">
                          <input
                            type="number"
                            min={0}
                            step={0.01}
                            value={row.budget_per_unit || ""}
                            onChange={(e) => updateRow(idx, "budget_per_unit", Number(e.target.value) || 0)}
                            className="w-full px-2 py-1.5 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-lg text-sm outline-none focus:ring-2 focus:ring-primary-500 dark:text-gray-100"
                          />
                        </td>
                        <td className="px-4 py-2 text-center">
                          <button
                            type="button"
                            onClick={() => removeRow(idx)}
                            className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 rounded-lg transition-colors"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <button
                type="button"
                onClick={addRow}
                className="w-full py-3 rounded-xl border-2 border-dashed border-gray-300 dark:border-slate-700 text-gray-500 dark:text-gray-400 text-sm font-bold hover:border-primary-400 hover:text-primary-500 transition-colors flex items-center justify-center gap-2"
              >
                <Plus className="w-4 h-4" />
                {t("zoom_in.allocations.add_row")}
              </button>
            </div>

            <div className="flex items-center justify-end gap-3 p-6 border-t border-gray-100 dark:border-slate-800 shrink-0">
              <button
                type="button"
                onClick={() => setCreateOpen(false)}
                className="px-6 py-2.5 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 text-gray-700 dark:text-gray-200 rounded-xl text-sm font-bold hover:bg-gray-50 dark:hover:bg-slate-800 transition-colors"
              >
                {t("common.cancel")}
              </button>
              <button
                onClick={handleCreateSubmit}
                disabled={createLoading}
                className="px-6 py-2.5 bg-primary-500 text-white rounded-xl text-sm font-bold hover:bg-primary-600 transition-colors disabled:opacity-50 flex items-center gap-2"
              >
                {createLoading && <Loader2 className="w-4 h-4 animate-spin" />}
                <Check className="w-4 h-4" />
                {t("zoom_in.allocations.create")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Edit Modal ── */}
      {editOpen && editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-white dark:bg-slate-900 w-full max-w-lg rounded-2xl shadow-2xl animate-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between p-6 border-b border-gray-100 dark:border-slate-800">
              <div>
                <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">{t("zoom_in.allocations.edit")}</h2>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{t("zoom_in.allocations.description")}</p>
              </div>
              <button onClick={closeEdit} className="p-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-slate-800 rounded-xl transition-colors"><X className="w-5 h-5" /></button>
            </div>
            <div className="p-6 space-y-5">
              <div className="bg-gray-50 dark:bg-slate-800/50 rounded-xl p-4 space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500 dark:text-gray-400">{t("zoom_in.fields.house")}</span>
                  <span className="font-medium text-gray-900 dark:text-gray-100">{editing.house_name || `#${editing.house_id}`}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500 dark:text-gray-400">{t("zoom_in.fields.month")}</span>
                  <span className="font-medium text-gray-900 dark:text-gray-100">{editing.month}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500 dark:text-gray-400">{t("zoom_in.fields.event_type")}</span>
                  <span className="font-medium text-gray-900 dark:text-gray-100">{editing.event_type_name || `#${editing.event_type_id}`}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500 dark:text-gray-400">{t("zoom_in.fields.thana")}</span>
                  <span className="font-medium text-gray-900 dark:text-gray-100">{editing.thana || "—"}</span>
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                <div>
                  <label className="block text-sm font-bold text-gray-700 dark:text-gray-300 mb-1.5">{t("zoom_in.fields.count")}</label>
                  <input type="number" min={0} value={editForm.count} onChange={(e) => setEditForm({ ...editForm, count: Number(e.target.value) })}
                    className="w-full px-3 py-2.5 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl text-sm outline-none focus:ring-2 focus:ring-primary-500 dark:text-gray-100" />
                  {editErrors.count && <p className="text-xs text-red-500 mt-1">{editErrors.count}</p>}
                </div>
                <div>
                  <label className="block text-sm font-bold text-gray-700 dark:text-gray-300 mb-1.5">{t("zoom_in.fields.budget_per_unit")}</label>
                  <input type="number" min={0} step={0.01} value={editForm.budget_per_unit} onChange={(e) => setEditForm({ ...editForm, budget_per_unit: Number(e.target.value) })}
                    className="w-full px-3 py-2.5 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl text-sm outline-none focus:ring-2 focus:ring-primary-500 dark:text-gray-100" />
                  {editErrors.budget_per_unit && <p className="text-xs text-red-500 mt-1">{editErrors.budget_per_unit}</p>}
                </div>
              </div>
              <div className="bg-primary-50 dark:bg-primary-500/10 rounded-xl px-4 py-3 flex items-center justify-between">
                <span className="text-sm font-bold text-gray-700 dark:text-gray-300">{t("zoom_in.fields.total_budget")}</span>
                <span className="text-lg font-bold text-primary-600 dark:text-primary-400">৳{(editForm.count * editForm.budget_per_unit).toLocaleString()}</span>
              </div>
              <div className="flex items-center justify-end gap-3 pt-4 border-t border-gray-100 dark:border-slate-800">
                <button type="button" onClick={closeEdit} className="px-6 py-2.5 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 text-gray-700 dark:text-gray-200 rounded-xl text-sm font-bold hover:bg-gray-50 dark:hover:bg-slate-800 transition-colors">{t("common.cancel")}</button>
                <button onClick={handleEditSubmit} disabled={editLoading} className="px-6 py-2.5 bg-primary-500 text-white rounded-xl text-sm font-bold hover:bg-primary-600 transition-colors disabled:opacity-50 flex items-center gap-2">
                  {editLoading && <Loader2 className="w-4 h-4 animate-spin" />}
                  <Check className="w-4 h-4" />
                  {t("common.save_changes")}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Custom Delete Confirmation Modal ── */}
      {deleteOpen && deleting && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-white dark:bg-slate-900 w-full max-w-sm rounded-2xl shadow-2xl animate-in zoom-in-95 duration-200 overflow-hidden">
            <div className="p-8 flex flex-col items-center text-center">
              <div className="w-20 h-20 rounded-full bg-red-100 dark:bg-red-500/20 flex items-center justify-center mb-6">
                <AlertTriangle className="w-10 h-10 text-red-600 dark:text-red-400" />
              </div>
              <h3 className="text-xl font-bold text-gray-900 dark:text-gray-100 mb-2">
                {t("zoom_in.allocations.messages.delete_confirm")}
              </h3>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                <span className="font-semibold text-gray-700 dark:text-gray-300">
                  {deleting.house_name || `#${deleting.house_id}`}
                </span>
                {" — "}
                <span className="text-gray-500 dark:text-gray-400">
                  {deleting.event_type_name}{deleting.thana ? ` — ${deleting.thana}` : ""}
                </span>
              </p>
            </div>

            <div className="px-8 pb-8 flex flex-col gap-3">
              <button
                onClick={handleDeleteConfirm}
                disabled={deleteLoading}
                className="w-full py-3.5 rounded-xl bg-red-600 hover:bg-red-700 text-white font-bold transition-all disabled:opacity-50 flex items-center justify-center gap-2 shadow-lg"
              >
                {deleteLoading ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Trash2 className="w-4 h-4" />
                )}
                {deleteLoading ? t("common.processing") : t("common.delete")}
              </button>
              <button
                onClick={closeDelete}
                disabled={deleteLoading}
                className="w-full py-3.5 rounded-xl text-gray-500 dark:text-gray-400 font-bold hover:bg-gray-50 dark:hover:bg-slate-800 transition-all"
              >
                {t("common.cancel")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
