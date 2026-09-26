"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Archive,
  Camera,
  ChevronDown,
  Code2,
  Database,
  FileCog,
  Loader2,
  RefreshCw,
  RotateCcw,
  Search,
  ShieldCheck,
  Trash2,
  Rocket,
  X,
} from "lucide-react";
import { API_BASE, default as apiClient } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { useLanguage } from "@/i18n/useLanguage";
import { AccessDenied } from "@/components/ui/AccessDenied";
import { ConfirmationModal } from "@/components/ui/ConfirmationModal";
import PageGuideModal from "@/components/PageGuideModal";
import { cn } from "@/lib/utils";
import toast from "react-hot-toast";

const DEPLOY_SERVICE_HOST = (() => {
  const base = API_BASE.replace(/\/api\/?$/, "");
  try {
    return new URL(base).hostname;
  } catch {
    return window.location.hostname;
  }
})();

const DEPLOY_WS_URL = `ws://${DEPLOY_SERVICE_HOST}:8100`;

type OpState = "idle" | "running" | "completed" | "failed";

interface RestorePointItem {
  snapshot_id: string;
  label: string;
  trigger_source: string;
  created_at: string | null;
  git_sha: string | null;
  git_short_sha: string | null;
  git_branch: string | null;
  git_subject: string | null;
  git_dirty_files: number;
  has_database_dump: boolean;
  database_size: number;
  config_files: string[];
  total_size: number;
  status: string;
  registered: boolean;
  is_deployed: boolean;
  can_restore: boolean;
  created_by_name: string | null;
  restored_at: string | null;
  restored_by_name: string | null;
}

interface Pagination {
  page: number;
  per_page: number;
  total: number;
  total_pages: number;
  has_next: boolean;
  has_prev: boolean;
}

interface OpProgress {
  op: "snapshot" | "rollback" | null;
  state: OpState;
  currentStep: string | null;
  message: string | null;
  percent: number;
  logs: string[];
}

const EMPTY_OP: OpProgress = {
  op: null,
  state: "idle",
  currentStep: null,
  message: null,
  percent: 0,
  logs: [],
};

/** `t` from useLanguage(): interpolation values are strings or numbers. */
type TFunc = (path: string, params?: Record<string, string | number | undefined>) => string;

const PER_PAGE = 10;

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
    return new Date(iso).toLocaleString(undefined, {
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

function Th({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <th
      className={cn(
        "px-3 py-2.5 text-left text-[11px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400 whitespace-nowrap",
        className
      )}
    >
      {children}
    </th>
  );
}

/** The three things a restore point contains — the core of the whole feature. */
function ContentChips({ item, t }: { item: RestorePointItem; t: TFunc }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span
        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium bg-blue-50 dark:bg-blue-500/10 text-blue-700 dark:text-blue-400"
        title={item.git_sha || undefined}
      >
        <Code2 className="w-3 h-3" />
        {item.git_short_sha || t("restore_points.content_unknown")}
      </span>
      {item.has_database_dump ? (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400">
          <Database className="w-3 h-3" />
          {t("restore_points.content_db")}
        </span>
      ) : (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium bg-gray-100 dark:bg-slate-800 text-gray-500 dark:text-gray-400">
          <Database className="w-3 h-3" />
          {t("restore_points.content_no_db")}
        </span>
      )}
      <span
        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400"
        title={item.config_files.join(", ") || undefined}
      >
        <FileCog className="w-3 h-3" />
        {t("restore_points.content_config")}
      </span>
    </div>
  );
}

interface ActionButtonsProps {
  item: RestorePointItem;
  canRestore: boolean;
  canDelete: boolean;
  busy: boolean;
  t: TFunc;
  onRestore: (item: RestorePointItem) => void;
  onDelete: (item: RestorePointItem) => void;
  compact?: boolean;
}

function ActionButtons({
  item,
  canRestore,
  canDelete,
  busy,
  t,
  onRestore,
  onDelete,
  compact = false,
}: ActionButtonsProps) {
  const disabled = busy || !item.can_restore || item.status !== "success";
  const size = compact ? "px-3 py-2 text-xs" : "p-2";

  return (
    <div className={cn("flex items-center gap-2", compact ? "" : "justify-end")}>
      {canRestore && (
        <button
          onClick={() => onRestore(item)}
          disabled={disabled}
          title={t("restore_points.action_restore")}
          className={cn(
            size,
            "rounded-lg text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-500/10 hover:bg-amber-100 dark:hover:bg-amber-500/20 transition-colors cursor-pointer disabled:cursor-not-allowed disabled:opacity-40"
          )}
        >
          {compact && <RotateCcw className="w-3.5 h-3.5" />}
          {compact ? t("restore_points.action_restore") : <RotateCcw className="w-4 h-4" />}
        </button>
      )}
      {canDelete && (
        <button
          onClick={() => onDelete(item)}
          disabled={busy}
          title={t("restore_points.action_delete")}
          className={cn(
            size,
            "rounded-lg text-red-700 dark:text-red-400 bg-red-50 dark:bg-red-500/10 hover:bg-red-100 dark:hover:bg-red-500/20 transition-colors cursor-pointer disabled:cursor-not-allowed disabled:opacity-40"
          )}
        >
          {compact ? <Trash2 className="w-3.5 h-3.5" /> : <Trash2 className="w-4 h-4" />}
          {compact && t("restore_points.action_delete")}
        </button>
      )}
    </div>
  );
}

export default function RestorePointsPage() {
  const { t } = useLanguage();
  const { hasPermission, loading: authLoading } = useAuth();
  const router = useRouter();

  const [mounted, setMounted] = useState(false);
  const [data, setData] = useState<RestorePointItem[]>([]);
  const [pagination, setPagination] = useState<Pagination>({
    page: 1,
    per_page: PER_PAGE,
    total: 0,
    total_pages: 1,
    has_next: false,
    has_prev: false,
  });
  const [meta, setMeta] = useState<{
    deploy_service_reachable: boolean;
    deploy_service_outdated: boolean;
    error: string | null;
    keep: number | null;
    enabled: boolean;
    deployed_sha: string | null;
  }>({ deploy_service_reachable: true, deploy_service_outdated: false, error: null, keep: 10, enabled: true, deployed_sha: null });

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // create
  const [createOpen, setCreateOpen] = useState(false);
  const [createLabel, setCreateLabel] = useState("");
  const [creating, setCreating] = useState(false);

  // restore
  const [restoreTarget, setRestoreTarget] = useState<RestorePointItem | null>(null);
  const [restoreText, setRestoreText] = useState("");
  const [restoreError, setRestoreError] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [layers, setLayers] = useState({ code: true, database: true, config: true });

  // delete
  const [deleteTarget, setDeleteTarget] = useState<RestorePointItem | null>(null);
  const [deleting, setDeleting] = useState(false);

  const [op, setOp] = useState<OpProgress>(EMPTY_OP);
  const [wsConnected, setWsConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const logsRef = useRef<string[]>([]);

  useEffect(() => {
    const id = window.setTimeout(() => setMounted(true), 0);
    return () => window.clearTimeout(id);
  }, []);

  useEffect(() => {
    if (!authLoading && !hasPermission("restore_point.view")) {
      const timer = setTimeout(() => router.push("/"), 5000);
      return () => clearTimeout(timer);
    }
  }, [authLoading, hasPermission, router]);

  // ── data ──────────────────────────────────────────────────────────────────
  const fetchPoints = useCallback(
    async (pageNo = 1, quiet = false) => {
      if (!quiet) setLoading(true);
      try {
        const params: Record<string, unknown> = { page: pageNo, per_page: PER_PAGE };
        if (search.trim()) params.search = search.trim();
        const res = await apiClient.get("v1/restore-points", { params });
        setData(res.data?.data || []);
        if (res.data?.pagination) {
          setPagination(res.data.pagination);
          setPage(res.data.pagination.page ?? pageNo);
        }
        if (res.data?.meta) setMeta(res.data.meta);
      } catch (e) {
        if (!quiet) toast.error((e as Error)?.message || t("restore_points.load_failed"));
      } finally {
        setLoading(false);
      }
    },
    [search, t]
  );

  useEffect(() => {
    if (mounted && !authLoading && hasPermission("restore_point.view")) {
      // Deferred by a microtask so the loading state is not set synchronously
      // inside the effect body.
      const load = async () => {
        await Promise.resolve();
        await fetchPoints(1);
      };
      void load();
    }
  }, [mounted, authLoading, hasPermission]); // eslint-disable-line react-hooks/exhaustive-deps

  const searchRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!mounted || authLoading) return;
    if (searchRef.current) clearTimeout(searchRef.current);
    searchRef.current = setTimeout(() => void fetchPoints(1, true), 400);
    return () => {
      if (searchRef.current) clearTimeout(searchRef.current);
    };
  }, [search]); // eslint-disable-line react-hooks/exhaustive-deps

  const opRunning = op.state === "running";

  // Poll the list while an operation is in flight so the new row appears as
  // soon as the dump lands, and so a completed rollback is reflected.
  useEffect(() => {
    if (!mounted || authLoading || !opRunning) return;
    const id = window.setInterval(() => void fetchPoints(1, true), 3000);
    return () => window.clearInterval(id);
  }, [mounted, authLoading, opRunning, fetchPoints]);

  // ── live operation stream ─────────────────────────────────────────────────
  const pushLogs = useCallback((lines: string[]) => {
    if (lines.length === 0) return;
    logsRef.current = [...logsRef.current, ...lines].slice(-200);
    setOp((prev) => ({ ...prev, logs: logsRef.current }));
  }, []);

  useEffect(() => {
    if (!mounted || !hasPermission("restore_point.view")) return;

    let closed = false;
    let reconnect: ReturnType<typeof setTimeout> | null = null;

    const connect = () => {
      if (closed) return;
      try {
        const ws = new WebSocket(DEPLOY_WS_URL);
        wsRef.current = ws;

        ws.onopen = () => setWsConnected(true);
        ws.onclose = () => {
          setWsConnected(false);
          if (!closed) reconnect = setTimeout(connect, 3000);
        };
        ws.onerror = () => setWsConnected(false);
        ws.onmessage = (event) => {
          try {
            const msg = JSON.parse(event.data);
            const d = msg.data || {};
            switch (msg.type) {
              case "op_step":
                setOp((p) => ({ ...p, op: d.op || p.op, state: "running", currentStep: d.step || null }));
                break;
              case "op_progress":
                setOp((p) => ({ ...p, percent: d.percent ?? p.percent }));
                break;
              case "op_log":
                pushLogs([d.line]);
                break;
              case "op_log_batch":
                pushLogs(d.lines || []);
                break;
              case "op_complete":
                setOp((p) => ({ ...p, state: "completed", percent: 100, message: d.message || null }));
                void fetchPoints(1, true);
                break;
              case "op_failed":
                setOp((p) => ({ ...p, state: "failed", message: d.message || null }));
                void fetchPoints(1, true);
                break;
              case "op_state":
                setOp((p) => ({
                  ...p,
                  op: d.op || p.op,
                  state: (d.state as OpState) || p.state,
                  currentStep: d.currentStep ?? p.currentStep,
                  message: d.message ?? p.message,
                }));
                break;
            }
          } catch {
            /* ignore malformed frames */
          }
        };
      } catch {
        if (!closed) reconnect = setTimeout(connect, 3000);
      }
    };

    connect();
    return () => {
      closed = true;
      if (reconnect) clearTimeout(reconnect);
      wsRef.current?.close();
    };
  }, [mounted, hasPermission, pushLogs, fetchPoints]);

  // ── actions ───────────────────────────────────────────────────────────────
  const handleRefresh = async () => {
    setRefreshing(true);
    await fetchPoints(page, true);
    setTimeout(() => setRefreshing(false), 400);
  };

  const handleCreate = async () => {
    setCreating(true);
    try {
      await apiClient.post("v1/restore-points", { label: createLabel.trim() });
      toast.success(t("restore_points.create_started"));
      setCreateOpen(false);
      setCreateLabel("");
      logsRef.current = [];
      setOp({ ...EMPTY_OP, state: "running", op: "snapshot" });
    } catch (e) {
      toast.error((e as Error)?.message || t("restore_points.create_failed"));
    } finally {
      setCreating(false);
    }
  };

  const openRestore = (item: RestorePointItem) => {
    setRestoreTarget(item);
    setRestoreText("");
    setRestoreError(false);
    setLayers({ code: true, database: true, config: true });
  };

  const handleConfirmRestore = async () => {
    if (!restoreTarget) return;
    if (restoreText.trim().toUpperCase() !== "RESTORE") {
      setRestoreError(true);
      return;
    }
    if (!layers.code && !layers.database && !layers.config) {
      toast.error(t("restore_points.restore_no_layers"));
      return;
    }
    setRestoring(true);
    try {
      await apiClient.post(
        `v1/restore-points/${restoreTarget.snapshot_id}/restore`,
        {
          confirm: true,
          include_code: layers.code,
          include_database: layers.database,
          include_config: layers.config,
        },
        { timeout: 120000 }
      );
      toast.success(t("restore_points.restore_started"));
      setRestoreTarget(null);
      setRestoreText("");
      logsRef.current = [];
      setOp({ ...EMPTY_OP, state: "running", op: "rollback" });
    } catch (e) {
      toast.error((e as Error)?.message || t("restore_points.restore_failed"));
    } finally {
      setRestoring(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await apiClient.delete(`v1/restore-points/${deleteTarget.snapshot_id}`);
      toast.success(t("restore_points.delete_success"));
      setDeleteTarget(null);
      setExpandedId(null);
      void fetchPoints(data.length === 1 ? Math.max(page - 1, 1) : page, true);
    } catch (e) {
      toast.error((e as Error)?.message || t("restore_points.delete_failed"));
    } finally {
      setDeleting(false);
    }
  };

  const handleCancelOp = async () => {
    setBusy(true);
    try {
      await apiClient.post("v1/restore-points/cancel", null, { timeout: 30000 });
      toast.success(t("restore_points.cancel_requested"));
    } catch (e) {
      toast.error((e as Error)?.message || t("restore_points.cancel_failed"));
    } finally {
      setBusy(false);
    }
  };

  const canCreate = hasPermission("restore_point.create");
  const canRestore = hasPermission("restore_point.restore");
  const canDelete = hasPermission("restore_point.delete");

  if (mounted && !authLoading && !hasPermission("restore_point.view")) {
    return <AccessDenied />;
  }

  if (!mounted || authLoading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary-500" />
      </div>
    );
  }

  const disabledAll = opRunning || !meta.deploy_service_reachable || !meta.enabled;

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
            {t("restore_points.title")}
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            {t("restore_points.description")}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <PageGuideModal pageKey="restore_points" />
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            title={t("restore_points.refresh")}
            className="p-2.5 rounded-xl bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-slate-800 transition-colors cursor-pointer disabled:opacity-50"
          >
            <RefreshCw className={cn("w-4 h-4", refreshing && "animate-spin")} />
          </button>
          {canCreate && (
            <button
              onClick={() => setCreateOpen(true)}
              disabled={disabledAll}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-primary-500 text-white text-sm font-semibold hover:bg-primary-600 transition-all shadow-sm hover:shadow-md active:scale-[0.98] disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed"
            >
              <Camera className="w-4 h-4" />
              {t("restore_points.create")}
            </button>
          )}
        </div>
      </div>

      {/* Health banner */}
      {!meta.enabled && (
        <div className="flex items-start gap-3 p-4 rounded-2xl bg-gray-50 dark:bg-slate-800/50 border border-gray-200 dark:border-slate-700">
          <ShieldCheck className="w-5 h-5 text-gray-500 dark:text-gray-400 shrink-0 mt-0.5" />
          <p className="text-sm text-gray-600 dark:text-gray-400">{t("restore_points.banner_disabled")}</p>
        </div>
      )}
      {meta.enabled && !meta.deploy_service_reachable && (
        <div className="flex items-start gap-3 p-4 rounded-2xl bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/30">
          <ShieldCheck className="w-5 h-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
          <div className="text-sm text-amber-800 dark:text-amber-300 space-y-1">
            <p>{t("restore_points.banner_unreachable")}</p>
            {meta.deploy_service_outdated && (
              <p className="font-medium">{t("restore_points.banner_outdated")}</p>
            )}
          </div>
        </div>
      )}

      {/* Running operation */}
      {opRunning && (
        <div className="rounded-2xl border border-primary-500/30 bg-primary-50/50 dark:bg-primary-500/5 p-4 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 min-w-0">
              <Loader2 className="w-4 h-4 animate-spin text-primary-500 shrink-0" />
              <p className="text-sm font-semibold text-gray-800 dark:text-gray-200 truncate">
                {op.op === "rollback"
                  ? t("restore_points.op_rollback_running")
                  : t("restore_points.op_snapshot_running")}
                {op.currentStep ? ` · ${op.currentStep}` : ""}
              </p>
            </div>
            {canRestore && (
              <button
                onClick={handleCancelOp}
                disabled={busy}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-red-700 dark:text-red-400 bg-red-50 dark:bg-red-500/10 hover:bg-red-100 dark:hover:bg-red-500/20 transition-colors cursor-pointer disabled:opacity-50"
              >
                <X className="w-3.5 h-3.5" />
                {t("restore_points.action_cancel")}
              </button>
            )}
          </div>
          <div className="h-1.5 w-full rounded-full bg-gray-200 dark:bg-slate-700 overflow-hidden">
            <div
              className="h-full rounded-full bg-primary-500 transition-all duration-500"
              style={{ width: `${Math.max(op.percent, 5)}%` }}
            />
          </div>
          {op.logs.length > 0 && (
            <pre className="max-h-32 overflow-y-auto rounded-xl bg-gray-900 dark:bg-black p-3 text-[11px] leading-relaxed text-gray-100 whitespace-pre-wrap break-all">
              {op.logs.slice(-20).join("\n")}
            </pre>
          )}
          {!wsConnected && (
            <p className="text-[11px] text-amber-700 dark:text-amber-400">
              {t("restore_points.live_disconnected")}
            </p>
          )}
        </div>
      )}

      {/* Finished operation banner */}
      {!opRunning && op.state === "completed" && (
        <div className="flex items-start gap-3 p-4 rounded-2xl bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/30">
          <ShieldCheck className="w-5 h-5 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
          <p className="text-sm text-emerald-800 dark:text-emerald-300">
            {t("restore_points.op_done", { message: op.message || "" })}
          </p>
        </div>
      )}
      {!opRunning && op.state === "failed" && (
        <div className="flex items-start gap-3 p-4 rounded-2xl bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/30">
          <ShieldCheck className="w-5 h-5 text-red-600 dark:text-red-400 shrink-0 mt-0.5" />
          <p className="text-sm text-red-800 dark:text-red-300">
            {t("restore_points.op_failed", { message: op.message || "" })}
          </p>
        </div>
      )}

      {/* Search + count */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="relative sm:max-w-xs w-full">
          <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("restore_points.search_placeholder")}
            className="w-full pl-9 pr-4 py-2.5 rounded-xl bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 text-sm text-gray-900 dark:text-gray-100 placeholder:text-gray-400 outline-none focus:ring-2 focus:ring-primary-500 cursor-text"
          />
        </div>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          {t("restore_points.total", { count: pagination.total, keep: meta.keep ?? 10 })}
        </p>
      </div>

      {/* Desktop table */}
      <div className="hidden lg:block bg-white dark:bg-slate-900 rounded-2xl border border-gray-100 dark:border-slate-800 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px]">
            <thead className="bg-gray-50 dark:bg-slate-800/50 border-b border-gray-100 dark:border-slate-800">
              <tr>
                <Th>{t("restore_points.field_label")}</Th>
                <Th>{t("restore_points.field_contents")}</Th>
                <Th>{t("restore_points.field_size")}</Th>
                <Th>{t("restore_points.field_source")}</Th>
                <Th>{t("restore_points.field_created_at")}</Th>
                <Th className="text-right">{t("restore_points.field_actions")}</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50 dark:divide-slate-800">
              {loading ? (
                Array.from({ length: PER_PAGE }).map((_, i) => (
                  <tr key={i} className="animate-pulse">
                    <td className="px-2 py-1">
                      <div className="h-4 w-44 bg-gray-200 dark:bg-slate-700 rounded-md" />
                      <div className="h-2.5 w-28 bg-gray-100 dark:bg-slate-800 rounded-md mt-1.5" />
                    </td>
                    <td className="px-2 py-1">
                      <div className="flex gap-1.5">
                        <div className="h-5 w-16 bg-gray-200 dark:bg-slate-700 rounded-md" />
                        <div className="h-5 w-12 bg-gray-200 dark:bg-slate-700 rounded-md" />
                        <div className="h-5 w-12 bg-gray-200 dark:bg-slate-700 rounded-md" />
                      </div>
                    </td>
                    <td className="px-2 py-1">
                      <div className="h-4 w-14 bg-gray-200 dark:bg-slate-700 rounded-md" />
                    </td>
                    <td className="px-2 py-1">
                      <div className="h-5 w-20 bg-gray-200 dark:bg-slate-700 rounded-full" />
                    </td>
                    <td className="px-2 py-1">
                      <div className="h-4 w-32 bg-gray-200 dark:bg-slate-700 rounded-md" />
                    </td>
                    <td className="px-2 py-1">
                      <div className="flex gap-2 justify-end">
                        <div className="h-8 w-8 bg-gray-200 dark:bg-slate-700 rounded-lg" />
                        <div className="h-8 w-8 bg-gray-200 dark:bg-slate-700 rounded-lg" />
                      </div>
                    </td>
                  </tr>
                ))
              ) : data.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-6 py-16 text-center">
                    <Archive className="w-12 h-12 text-gray-300 dark:text-slate-700 mx-auto mb-3" />
                    <p className="text-sm text-gray-500 dark:text-gray-400">{t("restore_points.no_data")}</p>
                    {canCreate && (
                      <button
                        onClick={() => setCreateOpen(true)}
                        disabled={disabledAll}
                        className="mt-4 inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-primary-500 text-white text-sm font-semibold hover:bg-primary-600 transition-colors disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed"
                      >
                        <Camera className="w-4 h-4" />
                        {t("restore_points.create_first")}
                      </button>
                    )}
                  </td>
                </tr>
              ) : (
                data.map((item) => (
                  <tr
                    key={item.snapshot_id}
                    className="hover:bg-gray-50 dark:hover:bg-slate-800/50 transition-colors"
                  >
                    <td className="px-2 py-1">
                      <div className="flex items-start gap-2.5">
                        <span className="p-1.5 rounded-lg bg-blue-50 dark:bg-blue-500/10 shrink-0 mt-0.5">
                          <Archive className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                        </span>
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <p className="font-medium text-sm text-gray-900 dark:text-gray-100">
                              {item.label || item.snapshot_id}
                            </p>
                            {item.is_deployed && (
                              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide bg-emerald-100 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-400">
                                <Rocket className="w-2.5 h-2.5" />
                                {t("restore_points.badge_deployed")}
                              </span>
                            )}
                          </div>
                          <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5 truncate max-w-[280px]">
                            {item.git_subject || item.snapshot_id}
                          </p>
                          {item.git_branch && (
                            <p className="text-[11px] text-gray-500 dark:text-gray-400 truncate max-w-[280px]">
                              {item.git_branch}
                              {item.git_dirty_files > 0 &&
                                ` · ${t("restore_points.dirty_files", { count: item.git_dirty_files })}`}
                            </p>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="px-2 py-1">
                      <ContentChips item={item} t={t} />
                    </td>
                    <td className="px-2 py-1">
                      <p className="text-sm text-gray-600 dark:text-gray-400">
                        {formatBytes(item.total_size)}
                      </p>
                      {item.database_size > 0 && (
                        <p className="text-[11px] text-gray-500 dark:text-gray-400">
                          {t("restore_points.db_size", { size: formatBytes(item.database_size) })}
                        </p>
                      )}
                    </td>
                    <td className="px-2 py-1">
                      <span
                        className={cn(
                          "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium",
                          item.trigger_source === "auto_deploy"
                            ? "bg-violet-100 dark:bg-violet-500/10 text-violet-700 dark:text-violet-400"
                            : "bg-blue-100 dark:bg-blue-500/10 text-blue-700 dark:text-blue-400"
                        )}
                      >
                        {item.trigger_source === "auto_deploy" ? (
                          <Rocket className="w-3.5 h-3.5" />
                        ) : (
                          <Camera className="w-3.5 h-3.5" />
                        )}
                        {item.trigger_source === "auto_deploy"
                          ? t("restore_points.source_auto")
                          : t("restore_points.source_manual")}
                      </span>
                      {!item.registered && (
                        <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-1">
                          {t("restore_points.unregistered")}
                        </p>
                      )}
                    </td>
                    <td className="px-2 py-1">
                      <p className="text-sm text-gray-600 dark:text-gray-400">
                        {formatDate(item.created_at)}
                      </p>
                      <p className="text-[11px] text-gray-500 dark:text-gray-400">
                        {t("restore_points.field_created_by")}:{" "}
                        {item.created_by_name || t("restore_points.system")}
                      </p>
                      {item.restored_at && (
                        <p className="text-[11px] text-amber-600 dark:text-amber-400 mt-0.5">
                          {t("restore_points.restored_at", {
                            date: formatDate(item.restored_at),
                            who: item.restored_by_name || t("restore_points.system"),
                          })}
                        </p>
                      )}
                    </td>
                    <td className="px-2 py-1 text-right">
                      <ActionButtons
                        item={item}
                        canRestore={canRestore}
                        canDelete={canDelete}
                        busy={opRunning}
                        t={t}
                        onRestore={openRestore}
                        onDelete={setDeleteTarget}
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
          Array.from({ length: PER_PAGE }).map((_, i) => (
            <div
              key={i}
              className="bg-white dark:bg-slate-900 rounded-2xl border border-gray-100 dark:border-slate-800 p-4 animate-pulse space-y-3"
            >
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
            <Archive className="w-12 h-12 text-gray-300 dark:text-slate-700 mx-auto mb-3" />
            <p className="text-sm text-gray-500 dark:text-gray-400">{t("restore_points.no_data")}</p>
          </div>
        ) : (
          data.map((item) => {
            const expanded = expandedId === item.snapshot_id;
            return (
              <div
                key={item.snapshot_id}
                className="bg-white dark:bg-slate-900 rounded-2xl border border-gray-100 dark:border-slate-800 shadow-sm overflow-hidden"
              >
                <button
                  onClick={() => setExpandedId(expanded ? null : item.snapshot_id)}
                  className="w-full flex items-center gap-3 p-4 text-left cursor-pointer"
                >
                  <span className="p-2 rounded-xl bg-blue-50 dark:bg-blue-500/10 shrink-0">
                    <Archive className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <p className="font-medium text-sm text-gray-900 dark:text-gray-100 truncate">
                        {item.label || item.snapshot_id}
                      </p>
                      {item.is_deployed && (
                        <span className="shrink-0 inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-bold uppercase bg-emerald-100 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-400">
                          {t("restore_points.badge_deployed")}
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5 truncate">
                      {formatDate(item.created_at)} · {formatBytes(item.total_size)}
                    </p>
                  </div>
                  <ChevronDown
                    className={cn(
                      "w-4 h-4 text-gray-400 transition-transform shrink-0",
                      expanded && "rotate-180"
                    )}
                  />
                </button>
                {expanded && (
                  <div className="px-4 pb-4 pt-0 border-t border-gray-50 dark:border-slate-800">
                    <div className="pt-3">
                      <p className="text-[11px] text-gray-500 dark:text-gray-400 mb-1.5">
                        {t("restore_points.field_contents")}
                      </p>
                      <ContentChips item={item} t={t} />
                    </div>
                    <div className="grid grid-cols-2 gap-3 pt-3 text-sm">
                      <div className="col-span-2">
                        <p className="text-[11px] text-gray-500 dark:text-gray-400">
                          {t("restore_points.field_source")}
                        </p>
                        <p className="font-medium text-gray-800 dark:text-gray-200">
                          {item.trigger_source === "auto_deploy"
                            ? t("restore_points.source_auto")
                            : t("restore_points.source_manual")}
                        </p>
                      </div>
                      <div>
                        <p className="text-[11px] text-gray-500 dark:text-gray-400">
                          {t("restore_points.field_size")}
                        </p>
                        <p className="font-medium text-gray-800 dark:text-gray-200">
                          {formatBytes(item.total_size)}
                        </p>
                      </div>
                      <div>
                        <p className="text-[11px] text-gray-500 dark:text-gray-400">
                          {t("restore_points.field_created_by")}
                        </p>
                        <p className="font-medium text-gray-800 dark:text-gray-200">
                          {item.created_by_name || t("restore_points.system")}
                        </p>
                      </div>
                    </div>
                    {item.git_subject && (
                      <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-2 break-words">
                        {item.git_subject}
                      </p>
                    )}
                    {item.restored_at && (
                      <p className="text-[11px] text-amber-600 dark:text-amber-400 mt-1">
                        {t("restore_points.restored_at", {
                          date: formatDate(item.restored_at),
                          who: item.restored_by_name || t("restore_points.system"),
                        })}
                      </p>
                    )}
                    <div className="pt-4">
                      <ActionButtons
                        item={item}
                        canRestore={canRestore}
                        canDelete={canDelete}
                        busy={opRunning}
                        t={t}
                        onRestore={openRestore}
                        onDelete={setDeleteTarget}
                        compact
                      />
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
            onClick={() => fetchPoints(page - 1)}
            disabled={!pagination.has_prev}
            className="px-4 py-2 rounded-xl bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-slate-800 disabled:opacity-40 transition-colors cursor-pointer disabled:cursor-not-allowed"
          >
            {t("restore_points.prev")}
          </button>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {pagination.page} / {pagination.total_pages}
          </p>
          <button
            onClick={() => fetchPoints(page + 1)}
            disabled={!pagination.has_next}
            className="px-4 py-2 rounded-xl bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-slate-800 disabled:opacity-40 transition-colors cursor-pointer disabled:cursor-not-allowed"
          >
            {t("restore_points.next")}
          </button>
        </div>
      )}

      {/* Create modal */}
      <ConfirmationModal
        isOpen={createOpen}
        onClose={() => {
          if (creating) return;
          setCreateOpen(false);
        }}
        onConfirm={handleCreate}
        title={t("restore_points.create_title")}
        message={t("restore_points.create_confirm")}
        confirmText={t("restore_points.create")}
        type="info"
        loading={creating}
      >
        <div className="w-full mt-4 text-left">
          <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1.5">
            {t("restore_points.label_optional")}
          </label>
          <input
            type="text"
            value={createLabel}
            onChange={(e) => setCreateLabel(e.target.value)}
            placeholder={t("restore_points.label_placeholder")}
            maxLength={200}
            disabled={creating}
            className="w-full px-4 py-3 rounded-xl bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 text-sm text-gray-900 dark:text-gray-100 placeholder:text-gray-400 outline-none focus:ring-2 focus:ring-primary-500 disabled:opacity-50 cursor-text"
          />
        </div>
      </ConfirmationModal>

      {/* Restore modal */}
      <ConfirmationModal
        isOpen={!!restoreTarget}
        onClose={() => {
          if (restoring) return;
          setRestoreTarget(null);
          setRestoreText("");
          setRestoreError(false);
        }}
        onConfirm={handleConfirmRestore}
        title={t("restore_points.restore_title")}
        message={t("restore_points.restore_confirm")}
        confirmText={t("restore_points.restore_confirm_button")}
        type="danger"
        loading={restoring}
      >
        <div className="w-full mt-4 space-y-4 text-left">
          {restoreTarget && (
            <div className="rounded-xl bg-gray-50 dark:bg-slate-800 p-3 space-y-1">
              <p className="text-xs font-semibold text-gray-700 dark:text-gray-300 break-all">
                {restoreTarget.label || restoreTarget.snapshot_id}
              </p>
              <p className="text-[11px] text-gray-500 dark:text-gray-400">
                {formatDate(restoreTarget.created_at)} · {restoreTarget.git_short_sha}
              </p>
            </div>
          )}

          <div>
            <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 mb-2">
              {t("restore_points.layers_title")}
            </p>
            <div className="space-y-2">
              {(
                [
                  ["code", Code2, t("restore_points.layer_code"), t("restore_points.layer_code_hint")],
                  ["database", Database, t("restore_points.layer_database"), t("restore_points.layer_database_hint")],
                  ["config", FileCog, t("restore_points.layer_config"), t("restore_points.layer_config_hint")],
                ] as const
              ).map(([key, Icon, label, hint]) => (
                <label
                  key={key}
                  className="flex items-start gap-3 p-3 rounded-xl border border-gray-200 dark:border-slate-700 cursor-pointer hover:bg-gray-50 dark:hover:bg-slate-800/50 transition-colors"
                >
                  <input
                    type="checkbox"
                    checked={layers[key]}
                    onChange={(e) => setLayers((prev) => ({ ...prev, [key]: e.target.checked }))}
                    disabled={restoring}
                    className="mt-0.5 w-4 h-4 rounded border-2 border-gray-300 dark:border-slate-600 accent-primary-500 cursor-pointer disabled:cursor-not-allowed"
                  />
                  <Icon className="w-4 h-4 text-gray-500 dark:text-gray-400 shrink-0 mt-0.5" />
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-gray-800 dark:text-gray-200">
                      {label}
                    </span>
                    <span className="block text-[11px] text-gray-500 dark:text-gray-400">{hint}</span>
                  </span>
                </label>
              ))}
            </div>
          </div>

          <div className="rounded-xl bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/30 p-3">
            <p className="text-[11px] text-red-800 dark:text-red-300">{t("restore_points.restore_warning")}</p>
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1.5">
              {t("restore_points.restore_type_to_confirm")}
            </label>
            <input
              type="text"
              value={restoreText}
              onChange={(e) => {
                setRestoreText(e.target.value);
                setRestoreError(false);
              }}
              placeholder={t("restore_points.restore_input_placeholder")}
              disabled={restoring}
              className="w-full px-4 py-3 rounded-xl bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 text-sm text-gray-900 dark:text-gray-100 placeholder:text-gray-400 outline-none focus:ring-2 focus:ring-primary-500 disabled:opacity-50 cursor-text"
            />
            {restoreError && (
              <p className="text-xs text-red-500 mt-1.5">{t("restore_points.restore_input_mismatch")}</p>
            )}
          </div>
        </div>
      </ConfirmationModal>

      {/* Delete modal */}
      <ConfirmationModal
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleConfirmDelete}
        title={t("restore_points.delete_title")}
        message={t("restore_points.delete_confirm")}
        confirmText={t("restore_points.action_delete")}
        type="danger"
        loading={deleting}
      />
    </div>
  );
}
