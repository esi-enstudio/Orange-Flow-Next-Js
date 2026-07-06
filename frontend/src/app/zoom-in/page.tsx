"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import apiClient from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { useLanguage } from "@/i18n/useLanguage";
import { AccessDenied } from "@/components/ui/AccessDenied";
import { toast } from "react-hot-toast";
import {
  Plus,
  Search,
  ChevronLeft,
  ChevronRight,
  Eye,
  Pencil,
  Trash2,
  ChartNoAxesColumnIncreasing,
  FileDown,
} from "lucide-react";
import CreateEventModal from "./_components/CreateEventModal";
import DeleteConfirmModal from "./_components/DeleteConfirmModal";

interface EventItem {
  id: number;
  house_id: number;
  date: string;
  event_type_id: number;
  activity_id: number;
  thana: string;
  activation_count: number;
  house_name: string | null;
  house_code: string | null;
  event_type_name: string | null;
  activity_name: string | null;
  bts_ids: number[];
  rso_ids: number[];
  bp_ids: number[];
  retailer_codes: string[];
}

interface PaginatedResponse {
  success: boolean;
  data: EventItem[];
  pagination: {
    page: number;
    per_page: number;
    total: number;
    total_pages: number;
    has_next: boolean;
    has_prev: boolean;
  };
}

export default function ZoomInPage() {
  const { hasPermission, loading: authLoading } = useAuth();
  const router = useRouter();
  const { t } = useLanguage();

  const [events, setEvents] = useState<EventItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState({ total: 0, total_pages: 0, has_next: false, has_prev: false });
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editEventId, setEditEventId] = useState<number | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ id: number; label: string } | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [exporting, setExporting] = useState(false);

  const handleExport = async () => {
    setExporting(true);
    try {
      const res = await apiClient.get("zoom-in/events/export", {
        responseType: "blob",
      });
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const a = document.createElement("a");
      a.href = url;
      a.download = `zoom_in_events_${new Date().toISOString().slice(0, 10).replace(/-/g, "")}.xlsx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
      toast.success(t("zoom_in.messages.export_success"));
    } catch {
      toast.error(t("zoom_in.messages.export_failed"));
    } finally {
      setExporting(false);
    }
  };

  const fetchEvents = async () => {
    setLoading(true);
    try {
      const params: Record<string, string> = {
        page: String(page),
        per_page: "5",
      };
      if (search) params.search = search;
      const res = await apiClient.get<PaginatedResponse>("zoom-in/events", { params });
      setEvents(res.data.data);
      setPagination(res.data.pagination);
    } catch {
      toast.error(t("zoom_in.messages.load_failed"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (authLoading || !hasPermission("zoom_in.view")) return;
    fetchEvents();
  }, [authLoading]);

  useEffect(() => {
    if (authLoading || !hasPermission("zoom_in.view")) return;
    fetchEvents();
  }, [page, search]);

  const handleDeleteConfirm = async () => {
    if (!deleteTarget) return;
    setDeleteLoading(true);
    try {
      await apiClient.delete(`zoom-in/events/${deleteTarget.id}`);
      toast.success(t("zoom_in.messages.delete_success"));
      setDeleteTarget(null);
      fetchEvents();
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
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">{t("zoom_in.title")}</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{t("zoom_in.description")}</p>
        </div>
        <div className="flex flex-wrap gap-3">
          {hasPermission("zoom_in.export") && (
            <button
              onClick={handleExport}
              disabled={exporting}
              className="inline-flex items-center justify-center gap-2 px-4 py-2 bg-green-500 text-white rounded-lg text-sm font-bold hover:bg-green-600 transition-colors shadow-sm disabled:opacity-50"
            >
              <FileDown className="w-4 h-4" />
              {t("common.export")}
            </button>
          )}
          {hasPermission("zoom_in.create") && (
            <button
              onClick={() => setShowCreateModal(true)}
              className="inline-flex items-center justify-center gap-2 px-4 py-2 bg-primary-500 text-white rounded-lg text-sm font-bold hover:bg-primary-600 transition-colors shadow-sm"
            >
              <Plus className="w-4 h-4" />
              {t("zoom_in.create_event")}
            </button>
          )}
        </div>
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            placeholder="Search..."
            className="w-full pl-10 pr-4 py-2 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl text-sm focus:ring-2 focus:ring-primary-500 transition-all outline-none dark:text-gray-100"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
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
      ) : events.length === 0 ? (
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-dashed border-gray-300 dark:border-slate-800 p-16 text-center">
          <ChartNoAxesColumnIncreasing className="w-12 h-12 text-gray-300 dark:text-gray-700 mx-auto mb-4" />
          <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100">{t("zoom_in.messages.no_events")}</h3>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{t("zoom_in.messages.no_events_desc")}</p>
        </div>
      ) : (
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-gray-100 dark:border-slate-800 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 dark:border-slate-800 bg-gray-50 dark:bg-slate-900/50">
                  <th className="text-left px-6 py-4 font-bold text-gray-500 dark:text-gray-400 text-xs uppercase tracking-wider">{t("zoom_in.table.date")}</th>
                  <th className="text-left px-6 py-4 font-bold text-gray-500 dark:text-gray-400 text-xs uppercase tracking-wider">{t("zoom_in.fields.house")}</th>
                  <th className="text-left px-6 py-4 font-bold text-gray-500 dark:text-gray-400 text-xs uppercase tracking-wider">{t("zoom_in.fields.thana")}</th>
                  <th className="text-left px-6 py-4 font-bold text-gray-500 dark:text-gray-400 text-xs uppercase tracking-wider">{t("zoom_in.fields.event_type")}</th>
                  <th className="text-left px-6 py-4 font-bold text-gray-500 dark:text-gray-400 text-xs uppercase tracking-wider">{t("zoom_in.fields.activation_count")}</th>
                  <th className="text-right px-6 py-4 font-bold text-gray-500 dark:text-gray-400 text-xs uppercase tracking-wider">{t("zoom_in.table.actions")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50 dark:divide-slate-800/50">
                {events.map((event) => {
                  const d = new Date(event.date);
                  const formattedDate = d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
                  return (
                  <tr key={event.id} className="hover:bg-gray-50 dark:hover:bg-slate-800/50 transition-colors">
                    <td className="whitespace-nowrap px-6 py-4 text-gray-900 dark:text-gray-100 font-medium">{formattedDate}</td>
                    <td className="whitespace-nowrap px-6 py-4">
                      <div className="text-gray-900 dark:text-gray-100 font-medium">{event.house_name || "—"}</div>
                      {event.house_code && <div className="text-[11px] text-gray-400 dark:text-gray-500 mt-0.5">{event.house_code}</div>}
                    </td>
                    <td className="whitespace-nowrap px-6 py-4 text-gray-700 dark:text-gray-300">{event.thana}</td>
                    <td className="whitespace-nowrap px-6 py-4">
                      <span className="inline-flex px-2.5 py-0.5 rounded-full text-xs font-bold bg-primary-50 dark:bg-primary-500/10 text-primary-600 dark:text-primary-400">
                        {event.event_type_name || "—"}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-6 py-4 text-gray-900 dark:text-gray-100 font-bold">{event.activation_count ?? 0}</td>
                    <td className="whitespace-nowrap px-6 py-4 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => router.push(`/zoom-in/${event.id}`)}
                          className="p-2 text-gray-400 hover:text-primary-500 hover:bg-primary-50 dark:hover:bg-primary-500/10 rounded-lg transition-all"
                          title="View"
                        >
                          <Eye className="w-4 h-4" />
                        </button>
                        {hasPermission("zoom_in.edit") && (
                          <button
                            onClick={() => setEditEventId(event.id)}
                            className="p-2 text-gray-400 hover:text-amber-500 hover:bg-amber-50 dark:hover:bg-amber-500/10 rounded-lg transition-all"
                            title="Edit"
                          >
                            <Pencil className="w-4 h-4" />
                          </button>
                        )}
                        {hasPermission("zoom_in.delete") && (
                          <button
                            onClick={() => setDeleteTarget({ id: event.id, label: `#${event.id} — ${event.house_name || event.date}` })}
                            className="p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 rounded-lg transition-all"
                            title="Delete"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {!loading && pagination.total_pages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-xs text-gray-500 dark:text-gray-400">
            Showing {(page - 1) * 5 + 1} to {Math.min(page * 5, pagination.total)} of {pagination.total}
          </p>
          <div className="flex items-center gap-4">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={!pagination.has_prev}
              className="flex items-center gap-1 px-4 py-2 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-lg text-sm font-medium text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-slate-800 disabled:opacity-50"
            >
              <ChevronLeft className="w-4 h-4" />
              {t("common.prev")}
            </button>
            <span className="text-sm font-bold text-gray-900 dark:text-gray-100">{page} / {pagination.total_pages}</span>
            <button
              onClick={() => setPage((p) => p + 1)}
              disabled={!pagination.has_next}
              className="flex items-center gap-1 px-4 py-2 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-lg text-sm font-medium text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-slate-800 disabled:opacity-50"
            >
              {t("common.next")}
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      <CreateEventModal
        isOpen={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        onSuccess={fetchEvents}
      />
      <CreateEventModal
        isOpen={!!editEventId}
        editEventId={editEventId}
        onClose={() => setEditEventId(null)}
        onSuccess={fetchEvents}
      />
      <DeleteConfirmModal
        isOpen={!!deleteTarget}
        deleting={deleteTarget}
        loading={deleteLoading}
        onConfirm={handleDeleteConfirm}
        onClose={() => { setDeleteTarget(null); setDeleteLoading(false); }}
      />
    </div>
  );
}
