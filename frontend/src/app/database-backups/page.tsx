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
  RotateCcw,
  Upload,
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
type BackupPhase = "starting" | "dumping" | "finalizing" | "success" | "failed";
type RestorePhase =
  | "preparing_safety_backup"
  | "removing_existing_objects"
  | "reading_archive"
  | "restoring"
  | "finalizing"
  | "completed"
  | "failed";

interface RestoreJob {
  id: string;
  file_name: string;
  status: "running" | "success" | "failed";
  phase: RestorePhase;
  progress: number;
  completed: number;
  total: number;
  current_item: string;
  safety_file: string | null;
  error: string | null;
  warning?: string | null;
}

interface BackupProgress {
  id: number;
  file_name: string;
  status: BackupStatus;
  phase: BackupPhase;
  progress: number;
  bytes_written: number;
  estimated_bytes: number;
  current_item: string;
  error: string | null;
  started_at: string | null;
  updated_at: string | null;
}

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
  created_by_name?: string | null;
  progress?: BackupProgress | null;
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
  canRestore: boolean;
  canDelete: boolean;
  restoreRunning: boolean;
  downloadingId: number | null;
  t: (p: string) => string;
  onDownload: (item: BackupItem) => void;
  onRestore: (item: BackupItem) => void;
  onDelete: (item: BackupItem) => void;
}

function BackupActions({ item, canDownload, canRestore, canDelete, restoreRunning, downloadingId, t, onDownload, onRestore, onDelete }: BackupActionProps) {
  return (
    <div className="flex items-center gap-2 justify-end">
      {canDownload && (
        <button
          onClick={() => onDownload(item)}
          disabled={downloadingId === item.id || item.status !== "success"}
          title={t("database_backups.action_download")}
          className={cn(
            "p-2 rounded-lg text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-500/10 hover:bg-blue-100 dark:hover:bg-blue-500/20 transition-colors cursor-pointer disabled:cursor-not-allowed",
            item.status !== "success" && "opacity-45 pointer-events-none"
          )}
        >
          {downloadingId === item.id ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Download className="w-4 h-4" />
          )}
        </button>
      )}
      {canRestore && (
        <button
          onClick={() => onRestore(item)}
          disabled={item.status !== "success" || restoreRunning}
          title={t("database_backups.action_restore")}
          className={cn(
            "p-2 rounded-lg text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-500/10 hover:bg-amber-100 dark:hover:bg-amber-500/20 transition-colors cursor-pointer disabled:cursor-not-allowed",
            item.status !== "success" && "opacity-45 pointer-events-none"
          )}
        >
          <RotateCcw className="w-4 h-4" />
        </button>
      )}
      {canDelete && (
        <button
          onClick={() => onDelete(item)}
          disabled={item.status === "running"}
          title={t("database_backups.action_delete")}
          className={cn(
            "p-2 rounded-lg text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-500/10 hover:bg-red-100 dark:hover:bg-red-500/20 transition-colors cursor-pointer disabled:cursor-not-allowed",
            item.status === "running" && "opacity-45 pointer-events-none"
          )}
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
  const [restoreTarget, setRestoreTarget] = useState<BackupItem | null>(null);
  const [restoring, setRestoring] = useState(false);
  const [restoreJob, setRestoreJob] = useState<RestoreJob | null>(null);
  const [restorePollError, setRestorePollError] = useState(false);
  const [currentBackup, setCurrentBackup] = useState<BackupProgress | null>(null);
  const [backupPollError, setBackupPollError] = useState(false);
  const [watchBackup, setWatchBackup] = useState(false);
  const [restoreConfirm, setRestoreConfirm] = useState("");
  const [restoreError, setRestoreError] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

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
        try {
          const res = await apiClient.get("v1/database-backups/restore-jobs/current");
          if (res.data.job) setRestoreJob(res.data.job as RestoreJob);
        } catch {
          toast.error(t("database_backups.restore_status_unavailable"));
        }
        try {
          const res = await apiClient.get("v1/database-backups/current-job");
          const job = (res.data?.job ?? null) as BackupProgress | null;
          if (job?.status === "running") {
            setCurrentBackup(job);
            setWatchBackup(true);
          }
        } catch {
          // The list below still renders; progress polling starts on create.
        }
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

  useEffect(() => {
    if (!watchBackup || authLoading) return;
    let stopped = false;
    let timer: number | null = null;
    const poll = async () => {
      try {
        const res = await apiClient.get("v1/database-backups/current-job", { timeout: 15000 });
        if (stopped) return;
        setBackupPollError(false);
        const job = (res.data?.job ?? null) as BackupProgress | null;
        if (job) {
          setCurrentBackup(job);
          setData((prev) =>
            prev.map((item) =>
              item.id === job.id ? { ...item, status: job.status, progress: job } : item
            )
          );
        } else {
          setCurrentBackup(null);
          setWatchBackup(false);
          void fetchBackups(1, true);
        }
      } catch {
        if (!stopped) setBackupPollError(true);
      }
      if (!stopped) timer = window.setTimeout(poll, 1200);
    };
    void poll();
    return () => {
      stopped = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [watchBackup, authLoading, fetchBackups]);

  const handleCreate = async () => {
    setCreating(true);
    try {
      const res = await apiClient.post("v1/database-backups", null, { timeout: 600000 });
      toast.success(t("database_backups.backup_started"));
      const created = res.data?.backup;
      if (created?.id) {
        const startedAt = created.created_at ?? new Date().toISOString();
        setCurrentBackup({
          id: created.id,
          file_name: created.file_name,
          status: "running",
          phase: "starting",
          progress: 0,
          bytes_written: 0,
          estimated_bytes: 0,
          current_item: "",
          error: null,
          started_at: startedAt,
          updated_at: startedAt,
        });
        setData((prev) => {
          if (prev.some((x) => x.id === created.id)) return prev;
          return [
            {
              id: created.id,
              file_name: created.file_name,
              file_size: created.file_size ?? 0,
              db_name: created.db_name ?? "",
              pg_version: created.pg_version ?? null,
              status: created.status ?? "running",
              error_message: created.error_message ?? null,
              created_at: created.created_at ?? null,
              created_by: created.created_by ?? null,
              created_by_name: created.created_by_name ?? null,
            },
            ...prev,
          ];
        });
      }
      setWatchBackup(true);
      void fetchBackups(1, true);
    } catch (e) {
      const err = e as { response?: { status?: number }; message?: string };
      toast.error(
        err.response?.status === 409
          ? t("database_backups.backup_already_running")
          : err.message || t("database_backups.backup_failed")
      );
    } finally {
      setCreating(false);
    }
  };

  const handleDownload = async (item: BackupItem) => {
    setDownloadingId(item.id);
    try {
      const res = await apiClient.get(`v1/database-backups/${item.id}/download`, {
        responseType: "blob",
        timeout: 600000,
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

  const openRestore = (item: BackupItem) => {
    setRestoreConfirm("");
    setRestoreError(false);
    setRestoreTarget(item);
  };

  const handleConfirmRestore = async () => {
    if (!restoreTarget) return;
    if (restoreConfirm.trim().toUpperCase() !== "RESTORE") {
      setRestoreError(true);
      return;
    }
    setRestoring(true);
    setRestoreError(false);
    try {
      const res = await apiClient.post(`v1/database-backups/${restoreTarget.id}/restore`);
      setRestoreJob(res.data.job);
      setRestorePollError(false);
      toast.success(t("database_backups.restore_started"));
      setRestoreTarget(null);
      setRestoreConfirm("");
    } catch (e) {
      const detail = (e as Error)?.message;
      toast.error(detail || t("database_backups.restore_failed"));
    } finally {
      setRestoring(false);
    }
  };

  const canCreate = hasPermission("database_backup.create");
  const canDownload = hasPermission("database_backup.download");
  const canRestore = hasPermission("database_backup.restore");
  const canDelete = hasPermission("database_backup.delete");

  const handleUploadChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setUploadFile(file);
    setRestoreConfirm("");
    setRestoreError(false);
    setUploadOpen(true);
  };

  const handleConfirmUploadRestore = async () => {
    if (!uploadFile) return;
    if (restoreConfirm.trim().toUpperCase() !== "RESTORE") {
      setRestoreError(true);
      return;
    }
    setUploading(true);
    setUploadProgress(0);
    setRestoreError(false);
    const formData = new FormData();
    formData.append("file", uploadFile);
    try {
      const res = await apiClient.post("v1/database-backups/upload-restore", formData, {
        timeout: 600000,
        onUploadProgress: (event) => {
          if (event.total) {
            setUploadProgress(Math.min(100, Math.round((event.loaded / event.total) * 100)));
          }
        },
      });
      setRestoreJob(res.data.job);
      setRestorePollError(false);
      toast.success(t("database_backups.restore_started"));
      setUploadOpen(false);
      setUploadFile(null);
      setRestoreConfirm("");
    } catch (e) {
      const detail = (e as Error)?.message;
      toast.error(detail || t("database_backups.restore_failed"));
    } finally {
      setUploading(false);
    }
  };

  const restoreJobId = restoreJob?.id;
  const restoreJobStatus = restoreJob?.status;

  useEffect(() => {
    if (!restoreJobId || restoreJobStatus !== "running") return;
    let stopped = false;
    const poll = async () => {
      try {
        const res = await apiClient.get(`v1/database-backups/restore-jobs/${restoreJobId}`);
        if (stopped) return;
        setRestorePollError(false);
        const job = res.data.job as RestoreJob;
        setRestoreJob(job);
        if (job.status === "success") {
          toast.success(t("database_backups.restore_success"));
          setTimeout(() => void fetchBackups(1, true), 1500);
        } else if (job.status === "failed") {
          toast.error(job.error || t("database_backups.restore_failed"));
        }
      } catch {
        setRestorePollError(true);
      }
    };
    void poll();
    const timer = window.setInterval(() => void poll(), 1000);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [restoreJobId, restoreJobStatus, t, fetchBackups]);

  const safetyBackupRunning = restoreJob?.phase === "preparing_safety_backup";

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
          <div className="flex items-center gap-2.5">
            <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">{t("database_backups.title")}</h1>
            <PageGuideModal pageKey="database_backups" />
          </div>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{t("database_backups.description")}</p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            title={t("database_backups.refresh")}
            className="p-2.5 rounded-xl bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-slate-800 transition-colors cursor-pointer disabled:opacity-50"
          >
            <RefreshCw className={cn("w-4 h-4", refreshing && "animate-spin")} />
          </button>
          {canRestore && (
            <>
              <input
                ref={fileInputRef}
                type="file"
                accept=".dump,.backup,.bak,.tar,.gz"
                className="hidden"
                onChange={handleUploadChange}
              />
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading || restoreJob?.status === "running"}
                title={t("database_backups.restore_upload_title")}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 text-amber-700 dark:text-amber-400 text-sm font-medium hover:bg-amber-50 dark:hover:bg-amber-500/10 transition-colors cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Upload className="w-4 h-4" />
                {t("database_backups.restore_upload_button")}
              </button>
            </>
          )}
          {canCreate && (
            <button
              onClick={handleCreate}
              disabled={creating || !!currentBackup}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-primary-500 text-white text-sm font-semibold hover:bg-primary-600 transition-all shadow-sm hover:shadow-md active:scale-[0.98] disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed"
            >
              {creating || currentBackup ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Database className="w-4 h-4" />
              )}
              {creating
                ? t("database_backups.creating")
                : currentBackup
                  ? t("database_backups.backup_running_button")
                  : t("database_backups.create")}
            </button>
          )}
        </div>
      </div>

      {currentBackup && (
        <section
          aria-live="polite"
          className="rounded-2xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-900/50 dark:bg-amber-950/20 sm:p-5"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-gray-100">
                <Loader2 className="h-4 w-4 shrink-0 animate-spin text-amber-600" />
                <span className="truncate">{currentBackup.file_name}</span>
              </div>
              <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
                {t(`database_backups.backup_phase_${currentBackup.phase}`)}
              </p>
            </div>
            <span className="shrink-0 rounded-full bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-700 dark:bg-amber-500/10 dark:text-amber-400">
              {currentBackup.progress}%
            </span>
          </div>
          <div
            className="mt-4 h-2.5 overflow-hidden rounded-full bg-white/80 dark:bg-slate-800"
            role="progressbar"
            aria-label={t("database_backups.backup_progress")}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={currentBackup.phase === "starting" ? undefined : currentBackup.progress}
            aria-valuetext={
              currentBackup.phase === "starting"
                ? t("database_backups.backup_phase_starting")
                : t("database_backups.backup_percent", { percent: currentBackup.progress })
            }
          >
            <div
              className={cn(
                "h-full rounded-full bg-amber-500 transition-[width] duration-500",
                currentBackup.phase === "starting" && "w-1/3 animate-pulse"
              )}
              style={currentBackup.phase === "starting" ? undefined : { width: `${Math.max(currentBackup.progress, 3)}%` }}
            />
          </div>
          <div className="mt-2 flex flex-col gap-1 text-xs text-gray-600 dark:text-gray-400 sm:flex-row sm:items-center sm:justify-between">
            <span>
              {currentBackup.phase === "starting"
                ? t("database_backups.backup_progress_estimate_pending")
                : t("database_backups.backup_percent", { percent: currentBackup.progress })}
            </span>
            {currentBackup.estimated_bytes > 0 && (
              <span>
                {t("database_backups.backup_bytes_progress", {
                  written: formatBytes(currentBackup.bytes_written),
                  total: formatBytes(currentBackup.estimated_bytes),
                })}
              </span>
            )}
          </div>
          {currentBackup.current_item && (
            <p className="mt-2 break-all text-xs text-gray-500 dark:text-gray-400">
              {t("database_backups.backup_current_item")}: {currentBackup.current_item}
            </p>
          )}
          {backupPollError && (
            <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">
              {t("database_backups.backup_connection_retrying")}
            </p>
          )}
          <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
            {t("database_backups.backup_progress_hint")}
          </p>
        </section>
      )}

      {restoreJob && (
        <section
          aria-live="polite"
          className={cn(
            "rounded-2xl border p-4 sm:p-5",
            restoreJob.status === "failed"
              ? "border-red-200 bg-red-50 dark:border-red-900/50 dark:bg-red-950/20"
              : restoreJob.status === "success"
                ? "border-emerald-200 bg-emerald-50 dark:border-emerald-900/50 dark:bg-emerald-950/20"
                : "border-amber-200 bg-amber-50 dark:border-amber-900/50 dark:bg-amber-950/20"
          )}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-gray-100">
                {restoreJob.status === "running" ? (
                  <Loader2 className="h-4 w-4 shrink-0 animate-spin text-amber-600" />
                ) : restoreJob.status === "success" ? (
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
                ) : (
                  <XCircle className="h-4 w-4 shrink-0 text-red-600" />
                )}
                <span className="truncate">{restoreJob.file_name}</span>
              </div>
              <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
                {t(`database_backups.restore_phase_${restoreJob.phase}`)}
              </p>
            </div>
            {restoreJob.status !== "running" && (
              <button
                onClick={() => setRestoreJob(null)}
                className="min-h-10 rounded-lg px-3 py-1 text-sm text-gray-500 hover:bg-black/5 dark:hover:bg-white/5 cursor-pointer"
              >
                {t("database_backups.restore_dismiss")}
              </button>
            )}
          </div>
          <div
            className="mt-4 h-2.5 overflow-hidden rounded-full bg-white/80 dark:bg-slate-800"
            role="progressbar"
            aria-label={t("database_backups.restore_progress")}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={safetyBackupRunning ? undefined : restoreJob.progress}
            aria-valuetext={
              safetyBackupRunning
                ? t("database_backups.restore_phase_preparing_safety_backup")
                : t("database_backups.restore_percent", { percent: restoreJob.progress })
            }
          >
            <div
              className={cn(
                "h-full rounded-full transition-[width] duration-500",
                safetyBackupRunning && "w-1/3 animate-pulse",
                restoreJob.status === "failed" ? "bg-red-500" : "bg-amber-500"
              )}
              style={safetyBackupRunning ? undefined : { width: `${restoreJob.progress}%` }}
            />
          </div>
          <div className="mt-2 flex flex-col gap-1 text-xs text-gray-600 dark:text-gray-400 sm:flex-row sm:items-center sm:justify-between">
            <span>
              {safetyBackupRunning
                ? t("database_backups.restore_progress_estimate_pending")
                : t("database_backups.restore_percent", { percent: restoreJob.progress })}
            </span>
            {restoreJob.total > 0 && (
              <span>
                {t("database_backups.restore_items_progress", {
                  completed:
                    restoreJob.status === "success"
                      ? restoreJob.total
                      : restoreJob.completed,
                  total: restoreJob.total,
                  remaining:
                    restoreJob.status === "success"
                      ? 0
                      : Math.max(0, restoreJob.total - restoreJob.completed),
                })}
              </span>
            )}
          </div>
          {restoreJob.current_item && (
            <p className="mt-2 break-all text-xs text-gray-500 dark:text-gray-400">
              {t("database_backups.restore_current_item")}: {restoreJob.current_item}
            </p>
          )}
          {restorePollError && restoreJob.status === "running" && (
            <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">
              {t("database_backups.restore_connection_retrying")}
            </p>
          )}
          {restoreJob.error && (
            <p className="mt-2 break-words text-sm text-red-700 dark:text-red-300">{restoreJob.error}</p>
          )}
          {restoreJob.warning && (
            <p className="mt-2 break-words text-sm text-amber-700 dark:text-amber-300">
              {restoreJob.warning === "BACKUP_RECORD_CLEANUP_FAILED"
                ? t("database_backups.restore_backup_record_warning")
                : restoreJob.warning}
            </p>
          )}
          {restoreJob.safety_file && (
            <p className="mt-2 break-all text-xs text-gray-500 dark:text-gray-400">
              {t("database_backups.restore_safety_file")}: {restoreJob.safety_file}
            </p>
          )}
        </section>
      )}

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
                <Th className="text-right">{t("database_backups.action_restore")} / {t("database_backups.action_download")} / {t("database_backups.action_delete")}</Th>
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
                      {item.status === "running" && item.progress && (
                        <div className="mt-1.5 w-28">
                          <div className="h-1.5 overflow-hidden rounded-full bg-amber-100 dark:bg-amber-500/20">
                            <div
                              className="h-full rounded-full bg-amber-500 transition-[width] duration-500"
                              style={{ width: `${Math.max(item.progress.progress, 3)}%` }}
                            />
                          </div>
                          <p className="mt-1 text-[11px] text-gray-500 dark:text-gray-400">
                            {item.progress.progress}%
                          </p>
                        </div>
                      )}
                      {item.status === "failed" && item.error_message && (
                        <p className="text-[11px] text-red-500 mt-1 max-w-[200px] truncate" title={item.error_message}>
                          {item.error_message}
                        </p>
                      )}
                    </td>
                    <td className="px-2 py-1">
                      <p className="text-sm text-gray-600 dark:text-gray-400">{formatDate(item.created_at)}</p>
                      <p className="text-[11px] text-gray-500 dark:text-gray-400">
                        {t("database_backups.field_created_by")}: {item.created_by_name ?? item.created_by ?? "—"}
                      </p>
                    </td>
                    <td className="px-2 py-1 text-right">
                      <BackupActions
                        item={item}
                        canDownload={canDownload}
                        canRestore={canRestore}
                        canDelete={canDelete}
                        restoreRunning={restoreJob?.status === "running"}
                        downloadingId={downloadingId}
                        t={t}
                        onDownload={handleDownload}
                        onRestore={openRestore}
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
                      {formatDate(item.created_at)} ·{" "}
                      {item.status === "running"
                        ? `${t("database_backups.size_pending")}${item.progress ? ` · ${item.progress.progress}%` : ""}`
                        : formatBytes(item.file_size)}
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
                        <p className="font-medium text-gray-800 dark:text-gray-200">{item.created_by_name ?? item.created_by ?? "—"}</p>
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
                    {item.status === "running" && item.progress && (
                      <div className="mt-3">
                        <div className="mb-1 flex justify-between text-[11px] text-gray-500 dark:text-gray-400">
                          <span>{t(`database_backups.backup_phase_${item.progress.phase}`)}</span>
                          <span>{item.progress.progress}%</span>
                        </div>
                        <div className="h-1.5 overflow-hidden rounded-full bg-amber-100 dark:bg-amber-500/20">
                          <div
                            className="h-full rounded-full bg-amber-500 transition-[width] duration-500"
                            style={{ width: `${Math.max(item.progress.progress, 3)}%` }}
                          />
                        </div>
                      </div>
                    )}
                    {item.status === "failed" && item.error_message && (
                      <p className="text-[11px] text-red-500 mt-2 break-words">{item.error_message}</p>
                    )}
                    <div className="flex flex-wrap items-center gap-3 pt-4">
                      {canRestore && (
                        <button
                          onClick={() => openRestore(item)}
                          disabled={item.status !== "success" || restoreJob?.status === "running"}
                          className="inline-flex items-center gap-2 flex-1 justify-center px-4 py-3 rounded-xl bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400 text-sm font-semibold disabled:opacity-40 transition-colors cursor-pointer disabled:cursor-not-allowed"
                        >
                          <RotateCcw className="w-4 h-4" />
                          {t("database_backups.action_restore")}
                        </button>
                      )}
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
                          disabled={item.status === "running"}
                          className="inline-flex items-center gap-2 flex-1 justify-center px-4 py-3 rounded-xl bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-400 text-sm font-semibold transition-colors cursor-pointer disabled:cursor-not-allowed disabled:opacity-40"
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

      <ConfirmationModal
        isOpen={!!restoreTarget}
        onClose={() => {
          if (restoring) return;
          setRestoreTarget(null);
          setRestoreConfirm("");
          setRestoreError(false);
        }}
        onConfirm={handleConfirmRestore}
        title={t("database_backups.restore_title")}
        message={t("database_backups.restore_confirm")}
        confirmText={t("database_backups.restore_confirm_button")}
        type="danger"
        loading={restoring}
      >
        <div className="w-full mt-4">
          {restoreTarget && (
            <p className="text-xs font-mono text-gray-600 dark:text-gray-400 bg-gray-50 dark:bg-slate-800 rounded-lg px-3 py-2 mb-3 text-left break-all">
              {restoreTarget.file_name}
            </p>
          )}
          <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1.5 text-left">
            {t("database_backups.restore_type_to_confirm")}
          </label>
          <input
            type="text"
            value={restoreConfirm}
            onChange={(e) => {
              setRestoreConfirm(e.target.value);
              setRestoreError(false);
            }}
            placeholder={t("database_backups.restore_input_placeholder")}
            disabled={restoring}
            className="w-full px-4 py-3 rounded-xl bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 text-sm text-gray-900 dark:text-gray-100 placeholder:text-gray-400 outline-none focus:ring-2 focus:ring-primary-500 disabled:opacity-50 cursor-text"
          />
          {restoreError && (
            <p className="text-xs text-red-500 mt-1.5 text-left">{t("database_backups.restore_input_mismatch")}</p>
          )}
        </div>
      </ConfirmationModal>

      <ConfirmationModal
        isOpen={uploadOpen}
        onClose={() => {
          if (uploading) return;
          setUploadOpen(false);
          setUploadFile(null);
          setRestoreConfirm("");
          setRestoreError(false);
        }}
        onConfirm={handleConfirmUploadRestore}
        title={t("database_backups.restore_title")}
        message={t("database_backups.restore_confirm")}
        confirmText={t("database_backups.restore_confirm_button")}
        type="danger"
        loading={uploading}
      >
        <div className="w-full mt-4">
          {uploading && (
            <div className="mb-4 text-left">
              <div className="mb-1 flex justify-between text-xs text-gray-500 dark:text-gray-400">
                <span>{t("database_backups.restore_upload_progress", { percent: uploadProgress })}</span>
                <span>{uploadProgress}%</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-gray-100 dark:bg-slate-800">
                <div
                  className="h-full rounded-full bg-amber-500 transition-[width] duration-200"
                  style={{ width: `${uploadProgress}%` }}
                />
              </div>
            </div>
          )}
          {uploadFile && (
            <>
              <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1.5 text-left">
                {t("database_backups.restore_upload_file_label")}
              </p>
              <p className="text-xs font-mono text-gray-600 dark:text-gray-400 bg-gray-50 dark:bg-slate-800 rounded-lg px-3 py-2 mb-3 text-left break-all">
                {uploadFile.name} ({formatBytes(uploadFile.size)})
              </p>
            </>
          )}
          <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1.5 text-left">
            {t("database_backups.restore_type_to_confirm")}
          </label>
          <input
            type="text"
            value={restoreConfirm}
            onChange={(e) => {
              setRestoreConfirm(e.target.value);
              setRestoreError(false);
            }}
            placeholder={t("database_backups.restore_input_placeholder")}
            disabled={uploading}
            className="w-full px-4 py-3 rounded-xl bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 text-sm text-gray-900 dark:text-gray-100 placeholder:text-gray-400 outline-none focus:ring-2 focus:ring-primary-500 disabled:opacity-50 cursor-text"
          />
          {restoreError && (
            <p className="text-xs text-red-500 mt-1.5 text-left">{t("database_backups.restore_input_mismatch")}</p>
          )}
        </div>
      </ConfirmationModal>
    </div>
  );
}