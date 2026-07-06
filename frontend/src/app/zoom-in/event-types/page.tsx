"use client";

import { useEffect, useState } from "react";
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
  ChartNoAxesColumnIncreasing,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface EventType {
  id: number;
  name: string;
  name_bn: string | null;
  is_active: boolean;
}

const defaultForm = { name: "", name_bn: "" };

export default function EventTypesPage() {
  const { hasPermission, loading: authLoading } = useAuth();
  const { t } = useLanguage();

  const [eventTypes, setEventTypes] = useState<EventType[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<EventType | null>(null);
  const [form, setForm] = useState(defaultForm);
  const [formLoading, setFormLoading] = useState(false);
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});

  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState<EventType | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  const fetchEventTypes = async () => {
    setLoading(true);
    try {
      const res = await apiClient.get("zoom-in/event-types", {
        params: { include_inactive: true },
      });
      setEventTypes(res.data);
    } catch {
      toast.error(t("zoom_in.event_types.messages.load_failed"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (authLoading || !hasPermission("zoom_in.view")) return;
    fetchEventTypes();
  }, [authLoading]);

  const openCreate = () => {
    setEditing(null);
    setForm(defaultForm);
    setFormErrors({});
    setFormOpen(true);
  };

  const openEdit = (et: EventType) => {
    setEditing(et);
    setForm({ name: et.name, name_bn: et.name_bn || "" });
    setFormErrors({});
    setFormOpen(true);
  };

  const closeForm = () => {
    setFormOpen(false);
    setEditing(null);
    setForm(defaultForm);
    setFormErrors({});
  };

  const validate = () => {
    const errs: Record<string, string> = {};
    if (!form.name.trim()) errs.name = t("zoom_in.event_types.validation.name_required");
    setFormErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;
    setFormLoading(true);
    try {
      const payload = { name: form.name.trim(), name_bn: form.name_bn.trim() || null };
      if (editing) {
        await apiClient.put(`zoom-in/event-types/${editing.id}`, {
          ...payload,
          is_active: editing.is_active,
        });
        toast.success(t("zoom_in.event_types.messages.update_success"));
      } else {
        await apiClient.post("zoom-in/event-types", payload);
        toast.success(t("zoom_in.event_types.messages.create_success"));
      }
      closeForm();
      fetchEventTypes();
    } catch (err: any) {
      if (err.response?.status === 409) {
        setFormErrors({ name: t("zoom_in.event_types.validation.name_exists") });
      } else {
        toast.error(err.response?.data?.detail || t("common.error"));
      }
    } finally {
      setFormLoading(false);
    }
  };

  const openDelete = (et: EventType) => {
    setDeleting(et);
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
      await apiClient.delete(`zoom-in/event-types/${deleting.id}`);
      toast.success(t("zoom_in.event_types.messages.delete_success"));
      closeDelete();
      fetchEventTypes();
    } catch {
      toast.error(t("common.error"));
    } finally {
      setDeleteLoading(false);
    }
  };

  if (!authLoading && !hasPermission("zoom_in.view")) {
    return <AccessDenied />;
  }

  const filtered = eventTypes.filter((et) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      et.name.toLowerCase().includes(q) ||
      (et.name_bn && et.name_bn.toLowerCase().includes(q))
    );
  });

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">{t("zoom_in.event_types.title")}</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{t("zoom_in.event_types.description")}</p>
        </div>
        {hasPermission("zoom_in.create") && (
          <button
            onClick={openCreate}
            className="inline-flex items-center justify-center gap-2 px-4 py-2 bg-primary-500 text-white rounded-lg text-sm font-bold hover:bg-primary-600 transition-colors shadow-sm"
          >
            <Plus className="w-4 h-4" />
            {t("zoom_in.event_types.create")}
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
      </div>

      {loading ? (
        <div className="divide-y divide-gray-100 dark:divide-slate-800 bg-white dark:bg-slate-900 rounded-2xl border border-gray-100 dark:border-slate-800 overflow-hidden">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="flex items-center gap-4 px-6 py-5 animate-pulse">
              <div className="space-y-2 flex-1">
                <div className="h-3 w-40 bg-gray-200 dark:bg-slate-700 rounded-md" />
                <div className="h-2.5 w-24 bg-gray-100 dark:bg-slate-800 rounded-md" />
              </div>
              <div className="hidden sm:block flex-1 space-y-2">
                <div className="h-3 w-20 bg-gray-200 dark:bg-slate-700 rounded-md" />
              </div>
            </div>
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-dashed border-gray-300 dark:border-slate-800 p-16 text-center">
          <ChartNoAxesColumnIncreasing className="w-12 h-12 text-gray-300 dark:text-gray-700 mx-auto mb-4" />
          <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100">{t("zoom_in.event_types.messages.no_data")}</h3>
        </div>
      ) : (
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-gray-100 dark:border-slate-800 overflow-hidden">
          <div className="overflow-x-auto scrollbar-custom">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 dark:border-slate-800 bg-gray-50 dark:bg-slate-900/50">
                  <th className="text-left px-6 py-4 font-bold text-gray-500 dark:text-gray-400 text-xs uppercase tracking-wider">{t("zoom_in.event_types.table.name")}</th>
                  <th className="text-left px-6 py-4 font-bold text-gray-500 dark:text-gray-400 text-xs uppercase tracking-wider">{t("zoom_in.event_types.table.name_bn")}</th>
                  <th className="text-left px-6 py-4 font-bold text-gray-500 dark:text-gray-400 text-xs uppercase tracking-wider">{t("zoom_in.event_types.table.status")}</th>
                  <th className="text-right px-6 py-4 font-bold text-gray-500 dark:text-gray-400 text-xs uppercase tracking-wider">{t("zoom_in.event_types.table.actions")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50 dark:divide-slate-800/50">
                {filtered.map((et) => (
                  <tr key={et.id} className="hover:bg-gray-50 dark:hover:bg-slate-800/50 transition-colors">
                    <td className="px-6 py-4 text-gray-900 dark:text-gray-100 font-medium">{et.name}</td>
                    <td className="px-6 py-4 text-gray-700 dark:text-gray-300">{et.name_bn || "—"}</td>
                    <td className="px-6 py-4">
                      <span className={cn(
                        "inline-flex px-2.5 py-0.5 rounded-full text-xs font-bold",
                        et.is_active
                          ? "bg-green-50 dark:bg-green-500/10 text-green-600 dark:text-green-400"
                          : "bg-gray-50 dark:bg-slate-800 text-gray-500 dark:text-gray-400"
                      )}>
                        {et.is_active ? t("zoom_in.event_types.status.active") : t("zoom_in.event_types.status.inactive")}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex items-center justify-end gap-2">
                        {hasPermission("zoom_in.edit") && (
                          <button
                            onClick={() => openEdit(et)}
                            className="p-2 text-gray-400 hover:text-amber-500 hover:bg-amber-50 dark:hover:bg-amber-500/10 rounded-lg transition-all"
                            title="Edit"
                          >
                            <Pencil className="w-4 h-4" />
                          </button>
                        )}
                        {hasPermission("zoom_in.delete") && (
                          <button
                            onClick={() => openDelete(et)}
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
      )}

      {/* ── Create / Edit Modal ── */}
      {formOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-white dark:bg-slate-900 w-full max-w-lg rounded-2xl shadow-2xl animate-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between p-6 border-b border-gray-100 dark:border-slate-800">
              <div>
                <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">
                  {editing ? t("zoom_in.event_types.edit") : t("zoom_in.event_types.create")}
                </h2>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{t("zoom_in.event_types.description")}</p>
              </div>
              <button
                onClick={closeForm}
                className="p-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-slate-800 rounded-xl transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleFormSubmit} className="p-6 space-y-5">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                <div>
                  <label className="block text-sm font-bold text-gray-700 dark:text-gray-300 mb-1.5">
                    {t("zoom_in.event_types.fields.name")} <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    className={cn(
                      "w-full px-3 py-2.5 bg-white dark:bg-slate-900 border rounded-xl text-sm outline-none focus:ring-2 focus:ring-primary-500 dark:text-gray-100",
                      formErrors.name ? "border-red-500" : "border-gray-200 dark:border-slate-800"
                    )}
                    placeholder="Enter name in English"
                  />
                  {formErrors.name && <p className="text-xs text-red-500 mt-1">{formErrors.name}</p>}
                </div>
                <div>
                  <label className="block text-sm font-bold text-gray-700 dark:text-gray-300 mb-1.5">
                    {t("zoom_in.event_types.fields.name_bn")}
                  </label>
                  <input
                    type="text"
                    value={form.name_bn}
                    onChange={(e) => setForm({ ...form, name_bn: e.target.value })}
                    className="w-full px-3 py-2.5 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl text-sm outline-none focus:ring-2 focus:ring-primary-500 dark:text-gray-100"
                    placeholder="বাংলায় নাম লিখুন"
                  />
                </div>
              </div>

              {editing && (
                <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={editing.is_active}
                    onChange={(e) => setEditing({ ...editing, is_active: e.target.checked })}
                    className="rounded border-gray-300 dark:border-slate-700"
                  />
                  <span className="font-bold">{t("zoom_in.event_types.fields.is_active")}</span>
                </label>
              )}

              <div className="flex items-center justify-end gap-3 pt-4 border-t border-gray-100 dark:border-slate-800">
                <button
                  type="button"
                  onClick={closeForm}
                  className="px-6 py-2.5 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 text-gray-700 dark:text-gray-200 rounded-xl text-sm font-bold hover:bg-gray-50 dark:hover:bg-slate-800 transition-colors"
                >
                  {t("common.cancel")}
                </button>
                <button
                  type="submit"
                  disabled={formLoading}
                  className="px-6 py-2.5 bg-primary-500 text-white rounded-xl text-sm font-bold hover:bg-primary-600 transition-colors disabled:opacity-50 flex items-center gap-2"
                >
                  {formLoading && <Loader2 className="w-4 h-4 animate-spin" />}
                  {editing ? <Check className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
                  {editing ? t("common.save_changes") : t("zoom_in.event_types.create")}
                </button>
              </div>
            </form>
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
                {t("zoom_in.event_types.messages.delete_confirm")}
              </h3>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                <span className="font-semibold text-gray-700 dark:text-gray-300">{deleting.name}</span>
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
