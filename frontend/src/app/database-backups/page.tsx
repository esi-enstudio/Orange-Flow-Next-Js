"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Database,
  Download,
  Trash2,
  RefreshCw,
  Loader2,
  ChevronDown,
  Search,
  CheckCircle2,
  XCircle,
  Clock,
  HardDrive,
} from "lucide-react";
import apiClient from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { useLanguage } from "@/i18n/useLanguage";
import { AccessDenied } from "@/components/ui/AccessDenied";
import { ConfirmationModal } from "@/components/ui/ConfirmationModal";
import PageGuideModal from "@/components/PageGuideModal";
import { cn } from "@/lib/utils";
import toast from "react-hot-toast";

type BackupStatus = "running" | "success" | "failed";

interface BackupItem {
  id: number;
  file_name: string;
  file_size: number;
  db_name: string;
  pg_version: string | null;
  status: BackupStatus;
  error_message: string | null;
  created_at: string | null;
  created_by: number | null;
}

interface Pagination {
  page: number;
  per_page: number;
  total: number;
  total_pages: number;
  has_next: boolean;
  has_prev: boolean;
}

function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return "—";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i += 1;
  }
  return `${value.toFixed(value >= 100 || i === 0 ? 0 : 1)} ${units[i]}`;
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, {
      year: "numeric",
      month: "short",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

interface BackupActionProps {
  item: BackupItem;
  canDownload: boolean;
  canDelete: boolean;
  downloadingId: number | null;
  t: (p: string) => string;
  onDownload: (item: BackupItem) => void;
  onDelete: (item: BackupItem) => void;
}

function BackupActions({ item, canDownload, canDelete, downloadingId, t, onDownload, onDelete }: BackupActionProps) {
  return (
    <div className={cn("flex items-center gap-2 justify-end", item.status === "success" ? "" : "opacity-40 pointer-events-none")}>
      {canDownload && (
        <button
          onClick={() => onDownload(item)}
          disabled={downloadingId === item.id || item.status !== "success"}
          title={t("database_backups.action_download")}
          className="p-2 rounded-lg text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-500/10 hover:bg-blue-100 dark:hover:bg-blue-500/20 transition-colors cursor-pointer disabled:cursor-not-allowed"
        >
          {downloadingId === item.id ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Download className="w-4 h-4" />
          )}
        </button>
      )}
      {canDelete && (
        <button
          onClick={() => onDelete(item)}
          title={t("database_backups.action_delete")}
          className="p-2 rounded-lg text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-500/10 hover:bg-red-100 dark:hover:bg-red-500/20 transition-colors cursor-pointer"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      )}
    </div>
  );
}

function Th({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <th className={cn("px-3 py-2.5 text-left text-[11px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400 whitespace-nowrap", className)}>
      {children}
    </th>
  );
}

function StatusBadge({ status, t }: { status: BackupStatus; t: (p: string) => string }) {
  const config = {
    running: {
      cls: "bg-amber-100 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400",
      icon: <Clock className="w-3.5 h-3.5" />,
      label: t("database_backups.status_running"),
    },
    success: {
      cls: "bg-emerald-100 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
      icon: <CheckCircle2 className="w-3.5 h-3.5" />,
      label: t("database_backups.status_success"),
    },
    failed: {
      cls: "bg-red-100 dark:bg-red-500/10 text-red-700 dark:text-red-400",
      icon: <XCircle className="w-3.5 h-3.5" />,
      label: t("database_backups.status_failed"),
    },
  }[status];

  return (
    <span className={cn("inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium", config.cls)}>
      {config.icon}
      {config.label}
    </span>
  );
}

export default function DatabaseBackupsPage() {
  const { t } = useLanguage();
  const { hasPermission, loading: authLoading } = useAuth();
  const router = useRouter();

  const [mounted, setMounted] = useState(false);
  const [data, setData] = useState<BackupItem[]>([]);
  const [pagination, setPagination] = useState<Pagination>({
    page: 1,
    per_page: 10,
    total: 0,
    total_pages: 1,
    has_next: false,
    has_prev: false,
  });
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<BackupItem | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [downloadingId, setDownloadingId] = useState<number | null>(null);

  useEffect(() => {
    const id = window.setTimeout(() => setMounted(true), 0);
    return () => window.clearTimeout(id);
  }, []);

  useEffect(() => {
    if (!authLoading && !hasPermission("database_backup.view")) {
      const timer = setTimeout(() => router.push("/"), 5000);
      return () => clearTimeout(timer);
    }
  }, [authLoading, hasPermission, router]);

  const fetchBackups = useCallback(
    async (pageNo = page, quiet = false) => {
      if (!quiet) setLoading(true);
      try {
        const params: Record<string, unknown> = { page: pageNo, per_page: pagination.per_page };
        if (search.trim()) params.search = search.trim();
        const res = await apiClient.get("v1/database-backups", { params });
        setData(res.data.data || []);
        setPagination(res.data.pagination || {});
        setPage(res.data.pagination?.page ?? pageNo);
      } catch {
        if (!quiet) toast.error(t("database_backups.backup_failed"));
      } finally {
        setLoading(false);
      }
    },
    [page, pagination.per_page, search, t]
  );

  useEffect(() => {
    if (mounted && !authLoading && hasPermission("database_backup.view")) {
      const load = async () => {
        await Promise.resolve();
        await fetchBackups(1);
      };
      void load();
    }
  }, [mounted, authLoading, hasPermission]); // eslint-disable-line react-hooks/exhaustive-deps

  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!mounted || authLoading) return;
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    searchDebounceRef.current = setTimeout(() => {
      void fetchBackups(1, true);
    }, 400);
    return () => {
      if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    };
  }, [search]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleCreate = async () => {
    setCreating(true);
    try {
      await apiClient.post("v1/database-backups");
      toast.success(t("database_backups.backup_started"));
      setTimeout(() => fetchBackups(1, false), 500);
    } catch {
      toast.error(t("database_backups.backup_failed"));
    } finally {
      setCreating(false);
    }
  };

  const handleDownload = async (item: BackupItem) => {
    setDownloadingId(item.id);
    try {
      const res = await apiClient.get(`v1/database-backups/${item.id}/download`, {
        responseType: "blob",
      });
      const url = window.URL.createObjectURL(res.data);
      const a = document.createElement("a");
      a.href = url;
      a.download = item.file_name;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    } catch {
      toast.error(t("database_backups.download_failed"));
    } finally {
      setDownloadingId(null);
    }
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await apiClient.delete(`v1/database-backups/${deleteTarget.id}`);
      toast.success(t("database_backups.delete_success"));
      setDeleteTarget(null);
      fetchBackups(deleteTarget && data.length === 1 ? Math.max(page - 1, 1) : page, true);
    } catch {
      toast.error(t("database_backups.delete_failed"));
    } finally {
      setDeleting(false);
    }
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    await fetchBackups(page, true);
    setTimeout(() => setRefreshing(false), 500);
  };

  const canCreate = hasPermission("database_backup.create");
  const canDownload = hasPermission("database_backup.download");
  const canDelete = hasPermission("database_backup.delete");

  if (mounted && !authLoading && !hasPermission("database_backup.view")) {
    return <AccessDenied />;
  }

  if (!mounted || authLoading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary-500" />
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">{t("database_backups.title")}</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{t("database_backups.description")}</p>
        </div>
        <div className="flex items-center gap-3">
          <PageGuideModal pageKey="database_backups" />
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            title={t("database_backups.refresh")}
            className="p-2.5 rounded-xl bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-slate-800 transition-colors cursor-pointer disabled:opacity-50"
          >
            <RefreshCw className={cn("w-4 h-4", refreshing && "animate-spin")} />
          </button>
          {canCreate && (
            <button
              onClick={handleCreate}
              disabled={creating}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-primary-500 text-white text-sm font-semibold hover:bg-primary-600 transition-all shadow-sm hover:shadow-md active:scale-[0.98] disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed"
            >
              {creating ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Database className="w-4 h-4" />
              )}
              {creating ? t("database_backups.creating") : t("database_backups.create")}
            </button>
          )}
        </div>
      </div>

      {/* Search + count */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="relative sm:max-w-xs w-full">
          <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("database_backups.search_placeholder")}
            className="w-full pl-9 pr-4 py-2.5 rounded-xl bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 text-sm text-gray-900 dark:text-gray-100 placeholder:text-gray-400 outline-none focus:ring-2 focus:ring-primary-500"
          />
        </div>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          {t("database_backups.total_backups", { count: pagination.total })}
        </p>
      </div>

      {/* Desktop table */}
      <div className="hidden lg:block bg-white dark:bg-slate-900 rounded-2xl border border-gray-100 dark:border-slate-800 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px]">
            <thead className="bg-gray-50 dark:bg-slate-800/50 border-b border-gray-100 dark:border-slate-800">
              <tr>
                <Th>{t("database_backups.field_file")}</Th>
                <Th>{t("database_backups.field_size")}</Th>
                <Th>{t("database_backups.field_db")}</Th>
                <Th>{t("database_backups.field_status")}</Th>
                <Th>{t("database_backups.field_created_at")}</Th>
                <Th className="text-right">{t("database_backups.action_download")} / {t("database_backups.action_delete")}</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50 dark:divide-slate-800">
              {loading ? (
                Array.from({ length: pagination.per_page }).map((_, i) => (
                  <tr key={i} className="animate-pulse">
                    <td className="px-3 py-1">
                      <div className="h-4 w-48 bg-gray-200 dark:bg-slate-700 rounded-md" />
                    </td>
                    <td className="px-3 py-1">
                      <div className="h-4 w-14 bg-gray-200 dark:bg-slate-700 rounded-md" />
                    </td>
                    <td className="px-3 py-1">
                      <div className="h-4 w-28 bg-gray-200 dark:bg-slate-700 rounded-md" />
                    </td>
                    <td className="px-3 py-1">
                      <div className="h-5 w-20 bg-gray-200 dark:bg-slate-700 rounded-full" />
                    </td>
                    <td className="px-3 py-1">
                      <div className="h-4 w-36 bg-gray-200 dark:bg-slate-700 rounded-md" />
                    </td>
                    <td className="px-3 py-1">
                      <div className="flex gap-2 justify-end">
                        <div className="h-8 w-8 bg-gray-200 dark:bg-slate-700 rounded-lg" />
                      </div>
                    </td>
                  </tr>
                ))
              ) : data.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-6 py-16 text-center">
                    <Database className="w-12 h-12 text-gray-300 dark:text-slate-700 mx-auto mb-3" />
                    <p className="text-sm text-gray-500 dark:text-gray-400">{t("database_backups.no_data")}</p>
                  </td>
                </tr>
              ) : (
                data.map((item) => (
                  <tr key={item.id} className="hover:bg-gray-50 dark:hover:bg-slate-800/50 transition-colors">
                    <td className="px-2 py-1">
                      <div className="flex items-center gap-2.5">
                        <span className="p-1.5 rounded-lg bg-blue-50 dark:bg-blue-500/10 shrink-0">
                          <HardDrive className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                        </span>
                        <p className="font-medium text-sm text-gray-900 dark:text-gray-100 break-all">{item.file_name}</p>
                      </div>
                    </td>
                    <td className="px-2 py-1">
                      <p className="text-sm text-gray-600 dark:text-gray-400">
                        {item.status === "running" ? t("database_backups.size_pending") : formatBytes(item.file_size)}
                      </p>
                    </td>
                    <td className="px-2 py-1">
                      <p className="text-sm font-medium text-gray-800 dark:text-gray-200">{item.db_name}</p>
                      <p className="text-[11px] text-gray-500 dark:text-gray-400">{item.pg_version || "—"}</p>
                    </td>
                    <td className="px-2 py-1">
                      <StatusBadge status={item.status} t={t} />
                      {item.status === "failed" && item.error_message && (
                        <p className="text-[11px] text-red-500 mt-1 max-w-[200px] truncate" title={item.error_message}>
                          {item.error_message}
                        </p>
                      )}
                    </td>
                    <td className="px-2 py-1">
                      <p className="text-sm text-gray-600 dark:text-gray-400">{formatDate(item.created_at)}</p>
                      <p className="text-[11px] text-gray-500 dark:text-gray-400">
                        {t("database_backups.field_created_by")}: {item.created_by ?? "—"}
                      </p>
                    </td>
                    <td className="px-2 py-1 text-right">
                      <BackupActions
                        item={item}
                        canDownload={canDownload}
                        canDelete={canDelete}
                        downloadingId={downloadingId}
                        t={t}
                        onDownload={handleDownload}
                        onDelete={(i) => setDeleteTarget(i)}
                      />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Mobile accordion */}
      <div className="lg:hidden space-y-3">
        {loading ? (
          Array.from({ length: pagination.per_page }).map((_, i) => (
            <div key={i} className="bg-white dark:bg-slate-900 rounded-2xl border border-gray-100 dark:border-slate-800 p-4 animate-pulse space-y-3">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-gray-200 dark:bg-slate-700 shrink-0" />
                <div className="space-y-2 flex-1">
                  <div className="h-3 w-40 bg-gray-200 dark:bg-slate-700 rounded-md" />
                  <div className="h-2.5 w-24 bg-gray-100 dark:bg-slate-800 rounded-md" />
                </div>
              </div>
            </div>
          ))
        ) : data.length === 0 ? (
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-gray-100 dark:border-slate-800 px-6 py-14 text-center">
            <Database className="w-12 h-12 text-gray-300 dark:text-slate-700 mx-auto mb-3" />
            <p className="text-sm text-gray-500 dark:text-gray-400">{t("database_backups.no_data")}</p>
          </div>
        ) : (
          data.map((item) => {
            const expanded = expandedId === item.id;
            return (
              <div key={item.id} className="bg-white dark:bg-slate-900 rounded-2xl border border-gray-100 dark:border-slate-800 shadow-sm overflow-hidden">
                <button
                  onClick={() => setExpandedId(expanded ? null : item.id)}
                  className="w-full flex items-center gap-3 p-4 text-left cursor-pointer"
                >
                  <span className="p-2 rounded-xl bg-blue-50 dark:bg-blue-500/10 shrink-0">
                    <HardDrive className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm text-gray-900 dark:text-gray-100 truncate">{item.file_name}</p>
                    <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">
                      {formatDate(item.created_at)} · {item.status === "running" ? t("database_backups.size_pending") : formatBytes(item.file_size)}
                    </p>
                  </div>
                  <StatusBadge status={item.status} t={t} />
                  <ChevronDown className={cn("w-4 h-4 text-gray-400 transition-transform shrink-0", expanded && "rotate-180")} />
                </button>
                {expanded && (
                  <div className="px-4 pb-4 pt-0 border-t border-gray-50 dark:border-slate-800">
                    <div className="grid grid-cols-2 gap-3 pt-3 text-sm">
                      <div>
                        <p className="text-[11px] text-gray-500 dark:text-gray-400">{t("database_backups.field_db")}</p>
                        <p className="font-medium text-gray-800 dark:text-gray-200">{item.db_name}</p>
                      </div>
                      <div>
                        <p className="text-[11px] text-gray-500 dark:text-gray-400">{t("database_backups.field_created_by")}</p>
                        <p className="font-medium text-gray-800 dark:text-gray-200">{item.created_by ?? "—"}</p>
                      </div>
                      <div>
                        <p className="text-[11px] text-gray-500 dark:text-gray-400">{t("database_backups.field_size")}</p>
                        <p className="font-medium text-gray-800 dark:text-gray-200">
                          {item.status === "running" ? t("database_backups.size_pending") : formatBytes(item.file_size)}
                        </p>
                      </div>
                      <div>
                        <p className="text-[11px] text-gray-500 dark:text-gray-400">{t("database_backups.field_created_at")}</p>
                        <p className="font-medium text-gray-800 dark:text-gray-200">{formatDate(item.created_at)}</p>
                      </div>
                    </div>
                    {item.status === "failed" && item.error_message && (
                      <p className="text-[11px] text-red-500 mt-2 break-words">{item.error_message}</p>
                    )}
                    <div className="flex items-center gap-3 pt-4">
                      {canDownload && (
                        <button
                          onClick={() => handleDownload(item)}
                          disabled={item.status !== "success" || downloadingId === item.id}
                          className="inline-flex items-center gap-2 flex-1 justify-center px-4 py-3 rounded-xl bg-blue-50 dark:bg-blue-500/10 text-blue-700 dark:text-blue-400 text-sm font-semibold disabled:opacity-40 transition-colors cursor-pointer disabled:cursor-not-allowed"
                        >
                          {downloadingId === item.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                          {t("database_backups.action_download")}
                        </button>
                      )}
                      {canDelete && (
                        <button
                          onClick={() => setDeleteTarget(item)}
                          className="inline-flex items-center gap-2 flex-1 justify-center px-4 py-3 rounded-xl bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-400 text-sm font-semibold transition-colors cursor-pointer"
                        >
                          <Trash2 className="w-4 h-4" />
                          {t("database_backups.action_delete")}
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Pagination */}
      {!loading && data.length > 0 && pagination.total_pages > 1 && (
        <div className="flex items-center justify-between gap-3">
          <button
            onClick={() => fetchBackups(page - 1)}
            disabled={!pagination.has_prev}
            className="px-4 py-2 rounded-xl bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-slate-800 disabled:opacity-40 transition-colors cursor-pointer disabled:cursor-not-allowed"
          >
            Prev
          </button>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {pagination.page} / {pagination.total_pages}
          </p>
          <button
            onClick={() => fetchBackups(page + 1)}
            disabled={!pagination.has_next}
            className="px-4 py-2 rounded-xl bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-slate-800 disabled:opacity-40 transition-colors cursor-pointer disabled:cursor-not-allowed"
          >
            Next
          </button>
        </div>
      )}

      <ConfirmationModal
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleConfirmDelete}
        title={t("database_backups.delete_title")}
        message={t("database_backups.delete_confirm")}
        confirmText={t("database_backups.action_delete")}
        type="danger"
        loading={deleting}
      />
    </div>
  );
}