"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import apiClient from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import {
  Search,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Plus,
  Pencil,
  Trash2,
  Hash,
  Tag,
  AlertTriangle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "react-hot-toast";
import { AccessDenied } from "@/components/ui/AccessDenied";
import { ConfirmationModal } from "@/components/ui/ConfirmationModal";
import PageGuideModal from "@/components/PageGuideModal";
import { useLanguage } from "@/i18n/useLanguage";
import type { Marking, PaginationMeta } from "../types";

export default function MarkingsPage() {
  const { selectedHouse, hasPermission, loading: authLoading } = useAuth();
  const router = useRouter();
  const { t } = useLanguage();

  const [markings, setMarkings] = useState<Marking[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState<PaginationMeta | null>(null);
  const [sortBy, setSortBy] = useState("name");
  const [sortOrder, setSortOrder] = useState("asc");
  const perPage = 20;

  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Marking | null>(null);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [description, setDescription] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<Marking | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const canCreate = hasPermission("retailer_markings.create");
  const canEdit = hasPermission("retailer_markings.edit");
  const canDelete = hasPermission("retailer_markings.delete");

  useEffect(() => {
    if (!authLoading && !hasPermission("retailer_markings.view")) {
      const timer = setTimeout(() => router.push("/"), 5000);
      return () => clearTimeout(timer);
    }
  }, [authLoading, hasPermission, router]);

  const fetchMarkings = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, any> = {
        page,
        per_page: perPage,
        sort_by: sortBy,
        sort_order: sortOrder,
      };
      if (search) params.search = search;
      if (statusFilter) params.status = statusFilter;
      const res = await apiClient.get("retailer-markings", { params });
      setMarkings(res.data.data || []);
      setPagination(res.data.pagination || null);
    } catch {
      toast.error(t("retailer_marking.toast_load_failed"));
    } finally {
      setLoading(false);
    }
  }, [page, search, statusFilter, sortBy, sortOrder, t]);

  useEffect(() => {
    if (!authLoading && hasPermission("retailer_markings.view")) {
      fetchMarkings();
    }
  }, [selectedHouse, page, sortBy, sortOrder, statusFilter, authLoading, hasPermission, fetchMarkings]);

  const handleSearch = (value: string) => {
    setSearch(value);
    setPage(1);
  };

  const toggleSort = (field: string) => {
    if (sortBy === field) {
      setSortOrder((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setSortBy(field);
      setSortOrder("asc");
    }
    setPage(1);
  };

  const openCreate = () => {
    setEditing(null);
    setName("");
    setCode("");
    setDescription("");
    setFormError(null);
    setShowForm(true);
  };

  const openEdit = (m: Marking) => {
    setEditing(m);
    setName(m.name);
    setCode(m.code);
    setDescription(m.description || "");
    setFormError(null);
    setShowForm(true);
  };

  const closeForm = () => {
    setShowForm(false);
    setEditing(null);
  };

  const handleSave = async () => {
    if (!name.trim() || !code.trim()) {
      setFormError(t("retailer_marking.validation_name_code_required"));
      return;
    }
    setSaving(true);
    setFormError(null);
    try {
      const payload = {
        name: name.trim(),
        code: code.trim().toUpperCase(),
        description: description.trim() || null,
      };
      if (editing) {
        await apiClient.patch(`retailer-markings/${editing.id}`, payload);
        toast.success(t("retailer_marking.toast_updated"));
      } else {
        await apiClient.post("retailer-markings", payload);
        toast.success(t("retailer_marking.toast_created"));
      }
      setShowForm(false);
      setEditing(null);
      fetchMarkings();
    } catch (err: any) {
      setFormError(err.response?.data?.detail || t("retailer_marking.toast_save_failed"));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteConfirm) return;
    setDeleting(true);
    try {
      await apiClient.delete(`retailer-markings/${deleteConfirm.id}`);
      toast.success(t("retailer_marking.toast_deleted"));
      setDeleteConfirm(null);
      fetchMarkings();
    } catch (err: any) {
      toast.error(err.response?.data?.detail || t("retailer_marking.toast_delete_failed"));
    } finally {
      setDeleting(false);
    }
  };

  if (authLoading)
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="w-8 h-8 animate-spin text-primary-500" />
      </div>
    );
  if (!hasPermission("retailer_markings.view")) return <AccessDenied />;

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-gray-900 dark:text-gray-100">
            {t("retailer_marking.markings_title")}
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            {t("retailer_marking.markings_description")}
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <PageGuideModal pageKey="retailer_marking" />
          {canCreate && (
            <button
              onClick={openCreate}
              className="inline-flex items-center justify-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-xl text-sm font-bold hover:bg-primary-700 transition-colors shadow-lg shadow-primary-100 dark:shadow-none"
            >
              <Plus className="w-4 h-4" />
              {t("retailer_marking.add_marking")}
            </button>
          )}
        </div>
      </div>

      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-gray-100 dark:border-slate-800 shadow-sm overflow-hidden">
        <div className="p-4 border-b border-gray-50 dark:border-slate-800 flex flex-col sm:flex-row sm:items-center gap-3">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 dark:text-gray-500" />
            <input
              type="text"
              placeholder={t("retailer_marking.search_placeholder")}
              className="w-full pl-10 pr-4 py-2.5 bg-gray-50 dark:bg-slate-800 border-none rounded-xl text-sm focus:ring-2 focus:ring-primary-500 transition-all dark:text-gray-100 outline-none"
              value={search}
              onChange={(e) => handleSearch(e.target.value)}
            />
          </div>
          <select
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.target.value);
              setPage(1);
            }}
            className="px-3 py-2.5 rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs dark:text-gray-100 focus:ring-2 focus:ring-primary-500 outline-none"
          >
            <option value="">{t("retailer_marking.all_status")}</option>
            <option value="active">{t("retailer_marking.active")}</option>
            <option value="inactive">{t("retailer_marking.inactive")}</option>
          </select>
        </div>

        {loading ? (
          <div className="divide-y divide-gray-50 dark:divide-slate-800">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex items-center gap-4 px-6 py-5 animate-pulse">
                <div className="w-10 h-10 rounded-xl bg-gray-200 dark:bg-slate-700 shrink-0" />
                <div className="space-y-2 flex-1">
                  <div className="h-3 w-32 bg-gray-200 dark:bg-slate-700 rounded-md" />
                  <div className="h-2.5 w-24 bg-gray-100 dark:bg-slate-800 rounded-md" />
                </div>
                <div className="hidden sm:block flex-1 space-y-2">
                  <div className="h-3 w-20 bg-gray-200 dark:bg-slate-700 rounded-md" />
                  <div className="h-2.5 w-16 bg-gray-100 dark:bg-slate-800 rounded-md" />
                </div>
                <div className="hidden md:block flex-1 space-y-2">
                  <div className="h-4 w-14 bg-gray-200 dark:bg-slate-700 rounded-full" />
                </div>
                <div className="hidden lg:block flex-1 space-y-2">
                  <div className="h-3 w-24 bg-gray-200 dark:bg-slate-700 rounded-md" />
                </div>
                <div className="w-20 h-9 rounded-lg bg-gray-200 dark:bg-slate-700 shrink-0" />
              </div>
            ))}
          </div>
        ) : !pagination || pagination.total === 0 ? (
          <div className="py-20 text-center">
            <Tag className="w-12 h-12 text-gray-200 dark:text-gray-700 mx-auto mb-4" />
            <p className="text-gray-500 dark:text-gray-400 font-medium">{t("retailer_marking.no_markings")}</p>
          </div>
        ) : (
          <>
            {/* Desktop table */}
            <div className="hidden lg:block overflow-x-auto">
              <table className="w-full text-left min-w-[820px]">
                <thead>
                  <tr className="bg-gray-50/50 dark:bg-slate-800/50 text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-widest border-b border-gray-50 dark:border-slate-800">
                    <th className="px-6 py-4">
                      <button onClick={() => toggleSort("name")} className="flex items-center gap-1 hover:text-gray-600 dark:hover:text-gray-300">
                        {t("retailer_marking.marking_name")}
                      </button>
                    </th>
                    <th className="px-6 py-4">{t("retailer_marking.marking_code")}</th>
                    <th className="px-6 py-4">{t("retailer_marking.marking_status")}</th>
                    <th className="px-6 py-4">
                      <button onClick={() => toggleSort("retailer_count")} className="flex items-center gap-1 hover:text-gray-600 dark:hover:text-gray-300">
                        {t("retailer_marking.retailer_count")}
                      </button>
                    </th>
                    <th className="px-6 py-4">{t("retailer_marking.description_col")}</th>
                    <th className="px-6 py-4 text-right">{t("retailer_marking.action")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50 dark:divide-slate-800">
                  {markings.map((m) => (
                    <tr key={m.id} className="hover:bg-gray-50/30 dark:hover:bg-slate-800/30 transition-colors group">
                      <td className="px-2 py-1">
                        <div className="flex items-center gap-3 py-3">
                          <div className="w-10 h-10 rounded-xl bg-primary-100 dark:bg-primary-500/20 flex items-center justify-center text-primary-700 dark:text-primary-400">
                            <Hash className="w-5 h-5" />
                          </div>
                          <div>
                            <p className="font-bold text-gray-900 dark:text-gray-100 text-sm">{m.name}</p>
                            {m.description && (
                              <p className="text-[11px] text-gray-500 dark:text-gray-400 max-w-[260px] truncate">{m.description}</p>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="px-2 py-1">
                        <span className="font-mono text-xs text-gray-500 dark:text-gray-400">{m.code}</span>
                      </td>
                      <td className="px-2 py-1">
                        <span
                          className={cn(
                            "inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider",
                            m.status === "active"
                              ? "bg-green-50 dark:bg-green-500/10 text-green-700 dark:text-green-400"
                              : "bg-gray-100 dark:bg-slate-800 text-gray-500 dark:text-gray-400"
                          )}
                        >
                          <span
                            className="w-1 h-1 rounded-full"
                            style={{
                              backgroundColor:
                                m.status === "active" ? "rgb(34 197 94)" : "rgb(148 163 184)",
                            }}
                          />
                          {m.status === "active" ? t("retailer_marking.active") : t("retailer_marking.inactive")}
                        </span>
                      </td>
                      <td className="px-2 py-1">
                        <span className="text-xs font-bold text-gray-700 dark:text-gray-200 bg-gray-50 dark:bg-slate-800 px-2.5 py-1 rounded-lg">
                          {m.retailer_count}
                        </span>
                      </td>
                      <td className="px-2 py-1">
                        <p className="text-xs text-gray-500 dark:text-gray-400 max-w-[220px] truncate">{m.description || "—"}</p>
                      </td>
                      <td className="px-2 py-1">
                        <div className="flex items-center justify-end gap-1">
                          {canEdit && (
                            <button
                              onClick={() => openEdit(m)}
                              className="p-2 rounded-lg text-gray-400 hover:text-primary-500 hover:bg-primary-50 dark:hover:bg-primary-500/10 transition-colors"
                              title={t("retailer_marking.edit_marking")}
                            >
                              <Pencil className="w-4 h-4" />
                            </button>
                          )}
                          {canDelete && (
                            <button
                              onClick={() => setDeleteConfirm(m)}
                              className="p-2 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors"
                              title={t("retailer_marking.delete_marking")}
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

            {/* Mobile accordion */}
            <div className="lg:hidden divide-y divide-gray-50 dark:divide-slate-800">
              {markings.map((m) => (
                <div key={m.id}>
                  <button
                    onClick={() => setExpandedId((prev) => (prev === m.id ? null : m.id))}
                    className="w-full flex items-center gap-3 px-5 py-4 text-left"
                  >
                    <div className="w-10 h-10 rounded-xl bg-primary-100 dark:bg-primary-500/20 flex items-center justify-center text-primary-700 dark:text-primary-400 shrink-0">
                      <Hash className="w-5 h-5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-bold text-gray-900 dark:text-gray-100 text-sm truncate">{m.name}</p>
                      <p className="text-[11px] text-gray-500 dark:text-gray-400 font-mono">{m.code}</p>
                    </div>
                    <div className="text-right shrink-0">
                      <span
                        className={cn(
                          "inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider",
                          m.status === "active"
                            ? "bg-green-50 dark:bg-green-500/10 text-green-700 dark:text-green-400"
                            : "bg-gray-100 dark:bg-slate-800 text-gray-500 dark:text-gray-400"
                        )}
                      >
                        {m.status === "active" ? t("retailer_marking.active") : t("retailer_marking.inactive")}
                      </span>
                      <p className="text-[11px] text-gray-400 mt-1">{m.retailer_count}</p>
                    </div>
                  </button>
                  {expandedId === m.id && (
                    <div className="px-5 pb-4 pt-1 space-y-2 animate-in fade-in duration-200">
                      <p className="text-sm text-gray-600 dark:text-gray-300">
                        {t("retailer_marking.description_col")}:{" "}
                        <span className="text-gray-800 dark:text-gray-100">{m.description || "—"}</span>
                      </p>
                      <div className="flex items-center gap-2 pt-1">
                        {canEdit && (
                          <button
                            onClick={() => openEdit(m)}
                            className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border border-gray-200 dark:border-slate-700 text-sm font-semibold text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-slate-800 transition-colors"
                          >
                            <Pencil className="w-4 h-4" />
                            {t("retailer_marking.edit_marking")}
                          </button>
                        )}
                        {canDelete && (
                          <button
                            onClick={() => setDeleteConfirm(m)}
                            className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border border-red-100 dark:border-red-500/20 text-sm font-semibold text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors"
                          >
                            <Trash2 className="w-4 h-4" />
                            {t("retailer_marking.delete_marking")}
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>

            <div className="p-4 border-t border-gray-50 dark:border-slate-800 flex items-center justify-between">
              <p className="text-xs text-gray-500 dark:text-gray-400">
                {t("retailer_marking.showing_results", {
                  start: pagination.total === 0 ? 0 : (pagination.page - 1) * pagination.per_page + 1,
                  end: Math.min(pagination.page * pagination.per_page, pagination.total),
                  total: pagination.total,
                })}
              </p>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setPage((p) => p - 1)}
                  disabled={!pagination.has_prev}
                  className="p-2 border rounded-lg hover:bg-gray-50 dark:hover:bg-slate-800 disabled:opacity-50"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <span className="text-xs text-gray-500 dark:text-gray-400 font-medium">
                  {pagination.page} / {pagination.total_pages}
                </span>
                <button
                  onClick={() => setPage((p) => p + 1)}
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

      {/* Create / Edit modal */}
      {showForm && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-white dark:bg-slate-900 w-full max-w-lg rounded-2xl shadow-2xl border border-gray-100 dark:border-slate-800 overflow-hidden">
            <div className="flex items-center gap-3 px-6 py-4 border-b border-gray-100 dark:border-slate-800">
              <div className="w-10 h-10 rounded-xl bg-primary-100 dark:bg-primary-500/20 flex items-center justify-center">
                <Tag className="w-5 h-5 text-primary-600 dark:text-primary-400" />
              </div>
              <div>
                <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">
                  {editing ? t("retailer_marking.edit_marking") : t("retailer_marking.add_marking")}
                </h2>
                <p className="text-xs text-gray-500 dark:text-gray-400">{t("retailer_marking.form_subtitle")}</p>
              </div>
            </div>
            <div className="p-6 space-y-4">
              {formError && (
                <div className="flex items-start gap-2 px-3 py-2.5 rounded-xl bg-red-50 dark:bg-red-500/10 text-red-600 dark:text-red-400 text-sm">
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                  {formError}
                </div>
              )}
              <div>
                <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1.5">
                  {t("retailer_marking.marking_name")} *
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={t("retailer_marking.marking_name_placeholder")}
                  className="w-full px-4 py-2.5 rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm dark:text-gray-100 focus:ring-2 focus:ring-primary-500 outline-none"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1.5">
                  {t("retailer_marking.marking_code")} *
                </label>
                <input
                  type="text"
                  value={code}
                  onChange={(e) => setCode(e.target.value.toUpperCase())}
                  placeholder={t("retailer_marking.marking_code_placeholder")}
                  maxLength={50}
                  className="w-full px-4 py-2.5 rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm dark:text-gray-100 font-mono focus:ring-2 focus:ring-primary-500 outline-none"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1.5">
                  {t("retailer_marking.description_label")}
                </label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={3}
                  placeholder={t("retailer_marking.description_placeholder")}
                  className="w-full px-4 py-2.5 rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm dark:text-gray-100 focus:ring-2 focus:ring-primary-500 outline-none resize-none"
                />
              </div>
            </div>
            <div className="p-6 pt-0 flex gap-3">
              <button
                onClick={closeForm}
                disabled={saving}
                className="flex-1 py-3 rounded-xl text-gray-600 dark:text-gray-300 font-bold hover:bg-gray-50 dark:hover:bg-slate-800 transition-colors"
              >
                {t("common.cancel")}
              </button>
              <button
                onClick={handleSave}
                disabled={saving || !name.trim() || !code.trim()}
                className="flex-1 py-3 rounded-xl bg-primary-600 text-white font-bold hover:bg-primary-700 disabled:opacity-50 transition-all flex items-center justify-center gap-2 shadow-lg shadow-primary-100 dark:shadow-none"
              >
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                {editing ? t("retailer_marking.save_changes") : t("retailer_marking.create_marking")}
              </button>
            </div>
          </div>
        </div>
      )}

      <ConfirmationModal
        isOpen={!!deleteConfirm}
        onClose={() => setDeleteConfirm(null)}
        onConfirm={handleDelete}
        title={t("retailer_marking.delete_marking")}
        message={`${t("common.confirm_delete_desc")} "${deleteConfirm?.name}"?`}
        confirmText={t("retailer_marking.delete_marking")}
        type="danger"
        loading={deleting}
      />
    </div>
  );
}