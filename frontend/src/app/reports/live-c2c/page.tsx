"use client";

import axios from "axios";
import Link from "next/link";
import { createPortal } from "react-dom";
import { useEffect, useRef, useState, type ChangeEvent, type ReactNode } from "react";
import {
  BarChart3,
  ChevronDown,
  ChevronRight,
  Download,
  FileSpreadsheet,
  Home,
  Loader2,
  Share2,
  Store,
  X,
} from "lucide-react";
import PageGuideModal from "@/components/PageGuideModal";
import ReportDeliveryModal from "@/components/ReportDeliveryModal";
import { AccessDenied } from "@/components/ui/AccessDenied";
import EntitySelector from "@/app/zoom-in/_components/EntitySelector";
import LiveC2CAutomationCard from "./_components/LiveC2CAutomationCard";
import { useAuth } from "@/context/AuthContext";
import { useLanguage } from "@/i18n/useLanguage";
import apiClient from "@/lib/api";
import {
  LiveC2CWorkbookError,
  listLiveC2CWorksheetNames,
  validateLiveC2CFile,
} from "@/lib/live-c2c-import";
import type {
  LiveC2CDiagnosticCandidate,
  LiveC2CEntityIssue,
  LiveC2CMatchReport,
} from "@/lib/live-c2c-diagnostics";
import { exportLiveC2CMismatches } from "@/lib/export-live-c2c-mismatches";
import { initialLiveC2CHouseId } from "@/lib/live-c2c-house-selection";

interface AccessibleHouse {
  id: number;
  name: string;
  code: string;
}

interface LiveC2CProductivityRow {
  employee_id: number;
  house_code: string;
  dms_code: string | null;
  rso_name: string;
  rso_itop_number: string | null;
  productivity_c2c_tgt: number;
  c2c_today_route: number;
  c2c_other_route: number;
  total_c2c: number;
  c2c_achievement_pct: number;
  c2c_remaining: number;
  productivity_trans_tgt: number;
  today_route_trans: number;
  other_route_trans: number;
  total_trans: number;
  trans_achievement_pct: number;
  trans_remaining: number;
  start_time: string | null;
  end_time: string | null;
  serving_hours: number | null;
}

interface LiveC2CBaseReportRow {
  employee_id: number;
  house_code: string | null;
  dms_code: string | null;
  rso_name: string;
  rso_itop_number: string | null;
  productivity_c2c_tgt: number;
  c2c_today_route: number;
  c2c_other_route: number;
  total_c2c: number;
  c2c_achievement_pct: number;
  c2c_remaining: number;
  productivity_trans_tgt: number;
  today_route_trans: number;
  other_route_trans: number;
  total_trans: number;
  trans_achievement_pct: number;
  trans_remaining: number;
  start_time: string | null;
  end_time: string | null;
  serving_hours: number | null;
}

function isBaseReportRow(value: unknown): value is LiveC2CBaseReportRow {
  if (typeof value !== "object" || value === null) return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.employee_id === "number"
    && (typeof row.house_code === "string" || row.house_code === null)
    && (typeof row.dms_code === "string" || row.dms_code === null)
    && typeof row.rso_name === "string"
    && (typeof row.rso_itop_number === "string" || row.rso_itop_number === null)
    && typeof row.productivity_c2c_tgt === "number"
    && Number.isFinite(row.productivity_c2c_tgt)
    && typeof row.c2c_today_route === "number"
    && Number.isFinite(row.c2c_today_route)
    && typeof row.c2c_other_route === "number"
    && Number.isFinite(row.c2c_other_route)
    && typeof row.total_c2c === "number"
    && Number.isFinite(row.total_c2c)
    && typeof row.c2c_achievement_pct === "number"
    && Number.isFinite(row.c2c_achievement_pct)
    && typeof row.c2c_remaining === "number"
    && Number.isFinite(row.c2c_remaining)
    && typeof row.productivity_trans_tgt === "number"
    && Number.isFinite(row.productivity_trans_tgt)
    && typeof row.today_route_trans === "number"
    && Number.isFinite(row.today_route_trans)
    && typeof row.other_route_trans === "number"
    && Number.isFinite(row.other_route_trans)
    && typeof row.total_trans === "number"
    && Number.isFinite(row.total_trans)
    && typeof row.trans_achievement_pct === "number"
    && Number.isFinite(row.trans_achievement_pct)
    && typeof row.trans_remaining === "number"
    && Number.isFinite(row.trans_remaining)
    && (typeof row.start_time === "string" || row.start_time === null)
    && (typeof row.end_time === "string" || row.end_time === null)
    && (
      row.serving_hours === null
      || (typeof row.serving_hours === "number" && Number.isFinite(row.serving_hours))
    )
  );
}

interface ApiErrorBody {
  error_code?: unknown;
  detail?: {
    error_code?: unknown;
  };
}

const REPORT_COLUMNS = [
  "serial_number",
  "house_code",
  "dms_code",
  "rso_name",
  "rso_itop_number",
  "productivity_c2c_tgt",
  "c2c_today_route",
  "c2c_other_route",
  "total_c2c",
  "c2c_achievement_pct",
  "c2c_remaining",
  "productivity_trans_tgt",
  "today_route_trans",
  "other_route_trans",
  "total_trans",
  "trans_achievement_pct",
  "trans_remaining",
  "start_time",
  "end_time",
  "serving_hours",
] as const;

type ReportColumn = (typeof REPORT_COLUMNS)[number];

type LiveC2CReportRow = LiveC2CBaseReportRow | LiveC2CProductivityRow;

// Non-additive columns: identity, percentages, and time-of-day values.
const NON_TOTAL_COLUMNS: ReadonlySet<ReportColumn> = new Set([
  "serial_number",
  "house_code",
  "dms_code",
  "rso_name",
  "rso_itop_number",
  "c2c_achievement_pct",
  "trans_achievement_pct",
  "start_time",
  "end_time",
]);

function numericReportValue(column: ReportColumn, row: LiveC2CReportRow): number | null {
  if (NON_TOTAL_COLUMNS.has(column)) return null;
  const value = (row as unknown as Record<string, unknown>)[column];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function numericField(row: LiveC2CReportRow, field: string): number | null {
  const value = (row as unknown as Record<string, unknown>)[field];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

// Achievement percentages are not summed; the total row shows the weighted
// figure (achieved ÷ target × 100) the same way the backend report does.
function aggregateAchievementPct(
  rows: LiveC2CReportRow[],
  achievedFields: readonly string[],
  targetField: string,
): number | null {
  let achieved = 0;
  let target = 0;
  let seen = false;
  for (const row of rows) {
    const rowTarget = numericField(row, targetField);
    if (rowTarget === null) continue;
    const values = achievedFields.map((field) => numericField(row, field));
    // Skip rows without the source columns (the base report has no trans data).
    if (values.every((value) => value === null)) continue;
    achieved += values.reduce<number>((sum, value) => sum + (value ?? 0), 0);
    target += rowTarget;
    seen = true;
  }
  if (!seen) return null;
  if (target <= 0) return 0;
  return Math.round((achieved / target) * 10000) / 100;
}

function reportColumnTotal(column: ReportColumn, rows: LiveC2CReportRow[]): number | null {
  if (column === "c2c_achievement_pct") {
    return aggregateAchievementPct(rows, ["total_c2c"], "productivity_c2c_tgt");
  }
  if (column === "trans_achievement_pct") {
    return aggregateAchievementPct(
      rows,
      ["total_trans"],
      "productivity_trans_tgt",
    );
  }
  // Serving hours reads as an average across the RSOs that have a value.
  if (column === "serving_hours") {
    let hours = 0;
    let count = 0;
    for (const row of rows) {
      const value = numericField(row, "serving_hours");
      if (value === null) continue;
      hours += value;
      count += 1;
    }
    return count === 0 ? null : Math.round((hours / count) * 100) / 100;
  }
  if (NON_TOTAL_COLUMNS.has(column)) return null;
  let total = 0;
  let seen = false;
  for (const row of rows) {
    const value = numericReportValue(column, row);
    if (value !== null) {
      total += value;
      seen = true;
    }
  }
  return seen ? total : null;
}

type NumberFormatter = (value: number, fractionDigits?: number) => string;

function baseReportCellText(
  column: ReportColumn,
  row: LiveC2CBaseReportRow,
  index: number,
  formatNumber: NumberFormatter,
): string {
  switch (column) {
    case "serial_number":
      return formatNumber(index + 1);
    case "house_code":
      return row.house_code || "—";
    case "dms_code":
      return row.dms_code || "—";
    case "rso_name":
      return row.rso_name || "—";
    case "rso_itop_number":
      return row.rso_itop_number || "—";
    case "productivity_c2c_tgt":
      return formatNumber(row.productivity_c2c_tgt);
    case "c2c_today_route":
      return formatNumber(row.c2c_today_route);
    case "c2c_other_route":
      return formatNumber(row.c2c_other_route);
    case "total_c2c":
      return formatNumber(row.total_c2c);
    case "c2c_achievement_pct":
      return `${formatNumber(row.c2c_achievement_pct)}%`;
    case "c2c_remaining":
      return formatNumber(row.c2c_remaining);
    case "productivity_trans_tgt":
      return formatNumber(row.productivity_trans_tgt);
    case "today_route_trans":
      return formatNumber(row.today_route_trans);
    case "other_route_trans":
      return formatNumber(row.other_route_trans);
    case "total_trans":
      return formatNumber(row.total_trans);
    case "trans_achievement_pct":
      // Always two decimals so the achievement figure reads 100.00%.
      return `${formatNumber(row.trans_achievement_pct, 2)}%`;
    case "trans_remaining":
      return formatNumber(row.trans_remaining);
    case "start_time":
      return row.start_time ?? "—";
    case "end_time":
      return row.end_time ?? "—";
    case "serving_hours":
      return row.serving_hours === null ? "—" : formatNumber(row.serving_hours);
  }
}

const RED_CELL_CLASS = "text-red-600 dark:text-red-400";
const GREEN_CELL_CLASS = "text-green-600 dark:text-green-400";

// Highlight rules: other-route workload always reads red; achievement at or
// above 100% and a remaining target of zero or below read green.
function reportCellToneClass(column: ReportColumn, row: LiveC2CReportRow): string {
  if (column === "c2c_other_route" || column === "other_route_trans") {
    return RED_CELL_CLASS;
  }
  const value = (row as unknown as Record<string, unknown>)[column];
  if (typeof value !== "number" || !Number.isFinite(value)) return "";
  if (column === "c2c_achievement_pct" || column === "trans_achievement_pct") {
    return value >= 100 ? GREEN_CELL_CLASS : "";
  }
  if (column === "c2c_remaining" || column === "trans_remaining") {
    return value <= 0 ? GREEN_CELL_CLASS : "";
  }
  return "";
}

// Same tone rules applied to the summed total row.
function totalCellToneClass(column: ReportColumn, total: number): string {
  if (column === "c2c_other_route" || column === "other_route_trans") {
    return RED_CELL_CLASS;
  }
  if (column === "c2c_achievement_pct" || column === "trans_achievement_pct") {
    return total >= 100 ? GREEN_CELL_CLASS : "";
  }
  if (column === "c2c_remaining" || column === "trans_remaining") {
    return total <= 0 ? GREEN_CELL_CLASS : "";
  }
  return "";
}

function totalCellText(
  column: ReportColumn,
  total: number,
  formatNumber: NumberFormatter,
): string {
  if (column === "c2c_achievement_pct" || column === "trans_achievement_pct") {
    return `${formatNumber(total, 2)}%`;
  }
  return formatNumber(total);
}

function isProductivityReportRow(value: unknown): value is LiveC2CProductivityRow {
  if (typeof value !== "object" || value === null) return false;
  const row = value as Record<string, unknown>;
  const numericFields = [
    "employee_id",
    "productivity_c2c_tgt",
    "c2c_today_route",
    "c2c_other_route",
    "total_c2c",
    "c2c_achievement_pct",
    "c2c_remaining",
    "productivity_trans_tgt",
    "today_route_trans",
    "other_route_trans",
    "total_trans",
    "trans_achievement_pct",
    "trans_remaining",
  ];
  return (
    numericFields.every(
      (field) => typeof row[field] === "number" && Number.isFinite(row[field]),
    )
    && typeof row.house_code === "string"
    && (typeof row.dms_code === "string" || row.dms_code === null)
    && typeof row.rso_name === "string"
    && (typeof row.rso_itop_number === "string" || row.rso_itop_number === null)
    && (typeof row.start_time === "string" || row.start_time === null)
    && (typeof row.end_time === "string" || row.end_time === null)
    && (
      row.serving_hours === null
      || (typeof row.serving_hours === "number" && Number.isFinite(row.serving_hours))
    )
  );
}

function reportCellText(
  column: ReportColumn,
  row: LiveC2CProductivityRow,
  index: number,
  formatNumber: NumberFormatter,
): string {
  switch (column) {
    case "serial_number":
      return formatNumber(index + 1);
    case "house_code":
      return row.house_code || "—";
    case "dms_code":
      return row.dms_code || "—";
    case "rso_name":
      return row.rso_name || "—";
    case "rso_itop_number":
      return row.rso_itop_number || "—";
    case "productivity_c2c_tgt":
      return formatNumber(row.productivity_c2c_tgt);
    case "c2c_today_route":
      return formatNumber(row.c2c_today_route);
    case "c2c_other_route":
      return formatNumber(row.c2c_other_route);
    case "total_c2c":
      return formatNumber(row.total_c2c);
    case "c2c_achievement_pct":
      return `${formatNumber(row.c2c_achievement_pct)}%`;
    case "c2c_remaining":
      return formatNumber(row.c2c_remaining);
    case "productivity_trans_tgt":
      return formatNumber(row.productivity_trans_tgt);
    case "today_route_trans":
      return formatNumber(row.today_route_trans);
    case "other_route_trans":
      return formatNumber(row.other_route_trans);
    case "total_trans":
      return formatNumber(row.total_trans);
    case "trans_achievement_pct":
      // Always two decimals so the achievement figure reads 100.00%.
      return `${formatNumber(row.trans_achievement_pct, 2)}%`;
    case "trans_remaining":
      return formatNumber(row.trans_remaining);
    case "start_time":
      return row.start_time ?? "—";
    case "end_time":
      return row.end_time ?? "—";
    case "serving_hours":
      return row.serving_hours === null ? "—" : formatNumber(row.serving_hours);
  }
}

function getImportErrorCode(error: unknown): string {
  if (!axios.isAxiosError<ApiErrorBody>(error)) return "upload_failed";
  const errorCode =
    error.response?.data?.detail?.error_code ??
    error.response?.data?.error_code;
  return typeof errorCode === "string" ? errorCode : "upload_failed";
}

function candidateLabel(
  side: LiveC2CEntityIssue["side"],
  candidate: LiveC2CDiagnosticCandidate,
): string {
  const code = side === "from" ? candidate.dms_code : candidate.retailer_code;
  const name = candidate.name ?? candidate.itop_number ?? "—";
  return code ? `${name} — ${code}` : name;
}

interface LiveC2CUploadModalProps {
  open: boolean;
  processing: boolean;
  title: string;
  description: string;
  closeLabel: string;
  errorMessage?: string;
  onClose: () => void;
  children: ReactNode;
}

function LiveC2CUploadModal({
  open,
  processing,
  title,
  description,
  closeLabel,
  errorMessage,
  onClose,
  children,
}: LiveC2CUploadModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  const canCloseRef = useRef(!processing);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    canCloseRef.current = !processing;
  }, [processing]);

  useEffect(() => {
    if (!open) return;

    const previousFocus =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialogRef.current?.focus();

    const close = () => {
      if (canCloseRef.current) onCloseRef.current();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;

      const focusable = dialogRef.current.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      if (focusable.length === 0) {
        event.preventDefault();
        dialogRef.current.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus();
    };
  }, [open]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[80] flex items-end justify-center bg-black/60 backdrop-blur-sm sm:items-center sm:p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !processing) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="live-c2c-upload-title"
        aria-describedby="live-c2c-upload-description"
        tabIndex={-1}
        className="flex max-h-[100dvh] w-full flex-col overflow-hidden rounded-t-3xl border border-gray-200 bg-white shadow-2xl outline-none dark:border-slate-700 dark:bg-slate-900 sm:max-h-[90dvh] sm:max-w-2xl sm:rounded-3xl"
      >
        <div className="flex items-start gap-3 border-b border-gray-100 px-4 py-4 dark:border-slate-800 sm:px-6">
          <div className="min-w-0 flex-1">
            <h2
              id="live-c2c-upload-title"
              className="text-lg font-bold text-gray-900 dark:text-gray-100"
            >
              {title}
            </h2>
            <p
              id="live-c2c-upload-description"
              className="mt-1 text-sm text-gray-500 dark:text-gray-400"
            >
              {description}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={processing}
            aria-label={closeLabel}
            className="flex min-h-11 min-w-11 shrink-0 cursor-pointer items-center justify-center rounded-xl text-gray-500 transition-colors hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50 dark:text-gray-400 dark:hover:bg-slate-800"
          >
            <X aria-hidden="true" className="size-5" />
          </button>
        </div>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4 sm:p-6">
          {errorMessage && (
            <p
              role="alert"
              className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300"
            >
              {errorMessage}
            </p>
          )}
          {children}
        </div>
      </div>
    </div>,
    document.body,
  );
}

export default function LiveC2CReportPage() {
  const { hasPermission, loading: authLoading } = useAuth();
  const { language, t } = useLanguage();
  const canView = hasPermission("reports.view") || hasPermission("itopup.view");
  const canImport = hasPermission("live_c2c.import");
  const canManageAutomation = hasPermission("live_c2c.automation_manage");
  const canViewAutomation =
    canManageAutomation || hasPermission("live_c2c.automation_view");
  const [houses, setHouses] = useState<AccessibleHouse[]>([]);
  const [housesLoading, setHousesLoading] = useState(true);
  const [housesError, setHousesError] = useState(false);
  const [selectedHouseId, setSelectedHouseId] = useState<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadModalOpen, setUploadModalOpen] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [sheetNames, setSheetNames] = useState<string[]>([]);
  const [selectedSheetName, setSelectedSheetName] = useState<string | null>(null);
  const [expandedRowId, setExpandedRowId] = useState<number | null>(null);
  const [reportRows, setReportRows] = useState<LiveC2CProductivityRow[] | null>(null);
  const [baseRows, setBaseRows] = useState<LiveC2CBaseReportRow[] | null>(null);
  const [baseLoading, setBaseLoading] = useState(false);
  const [baseError, setBaseError] = useState(false);
  const [readingWorkbook, setReadingWorkbook] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [matchReport, setMatchReport] = useState<LiveC2CMatchReport | null>(null);
  const [savedSummary, setSavedSummary] = useState<{ saved: number; skipped: number } | null>(null);
  const [savingToDb, setSavingToDb] = useState(false);
  const [baseReportRefreshKey, setBaseReportRefreshKey] = useState(0);
  // Keep the generated report visible after the save confirmation expires.
  const [reportGenerated, setReportGenerated] = useState(false);

  const [exporting, setExporting] = useState(false);
  const canExportMismatches = hasPermission("live_c2c.export");
  // Report delivery is shared with the Live Activations schedulers; either
  // permission unlocks the WhatsApp/Telegram schedule module (mirrors the API).
  const canShare = hasPermission("reports.whatsapp_share") || hasPermission("live_activations.schedule");
  const [wsModalOpen, setWsModalOpen] = useState(false);
  const selectedHouse = houses.find((house) => house.id === selectedHouseId) ?? null;
  const processing = readingWorkbook || previewing || savingToDb;
  const showReportArea =
    reportRows !== null
    || previewing
    || reportGenerated
    || savedSummary !== null
    || (matchReport === null && selectedHouseId !== null && !housesLoading);
  const displayedRows: LiveC2CReportRow[] = reportRows ?? baseRows ?? [];
  const columnTotals = new Map<ReportColumn, number>();
  for (const column of REPORT_COLUMNS) {
    const total = reportColumnTotal(column, displayedRows);
    if (total !== null) columnTotals.set(column, total);
  }
  const formatNumber: NumberFormatter = (value, fractionDigits = 0) =>
    new Intl.NumberFormat(language === "bn" ? "bn-BD" : "en-US", {
      minimumFractionDigits: fractionDigits,
      maximumFractionDigits: Math.max(fractionDigits, 2),
    }).format(value);

  useEffect(() => {
    if (authLoading || !canView) return;

    const controller = new AbortController();
    setHousesLoading(true);
    setHousesError(false);
    apiClient.get<AccessibleHouse[]>("/houses/accessible", {
      signal: controller.signal,
    }).then(({ data }) => {
      setHouses(data);
      setSelectedHouseId(initialLiveC2CHouseId(data));
    }).catch(() => {
      if (!controller.signal.aborted) setHousesError(true);
    }).finally(() => {
      if (!controller.signal.aborted) setHousesLoading(false);
    });

    return () => controller.abort();
  }, [authLoading, canView]);

  // The save confirmation is transient: it clears after 5 seconds so it never
  // lingers over the generated report.
  useEffect(() => {
    if (savedSummary === null) return;
    const timer = window.setTimeout(() => setSavedSummary(null), 5000);
    return () => window.clearTimeout(timer);
  }, [savedSummary]);

  useEffect(() => {
    if (authLoading || !canView || selectedHouseId === null) {
      setBaseRows(null);
      setBaseLoading(false);
      setBaseError(false);
      return;
    }

    const controller = new AbortController();
    setBaseRows(null);
    setBaseLoading(true);
    setBaseError(false);

    apiClient.get<{
      success: boolean;
      data: { target_date: string; rows: unknown };
    }>("/reports/live-c2c/rsos", {
      headers: { "X-House-ID": String(selectedHouseId) },
      signal: controller.signal,
    }).then(({ data }) => {
      const rows = data?.data?.rows;
      if (!Array.isArray(rows) || !rows.every(isBaseReportRow)) {
        throw new Error("invalid_base_report");
      }
      setBaseRows(rows);
    }).catch(() => {
      if (!controller.signal.aborted) setBaseError(true);
    }).finally(() => {
      if (!controller.signal.aborted) setBaseLoading(false);
    });

    return () => controller.abort();
  }, [authLoading, canView, selectedHouseId, baseReportRefreshKey]);

  const handleFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;

    setUploadError(null);
    setMatchReport(null);
    setReportRows(null);
    setSavedSummary(null);
    setReportGenerated(false);
    setSelectedFile(null);
    setSheetNames([]);
    setSelectedSheetName(null);

    if (!selectedHouseId) {
      setUploadError("house_required");
      return;
    }

    const validationError = validateLiveC2CFile(file);
    if (validationError) {
      setUploadError(validationError);
      return;
    }

    setReadingWorkbook(true);
    try {
      let names: string[];
      if (file.name.toLowerCase().endsWith(".xlsb")) {
        const formData = new FormData();
        formData.append("file", file);
        const { data } = await apiClient.post<{
          data: { sheet_names: string[] };
        }>("/reports/live-c2c/worksheets", formData, {
          headers: { "X-House-ID": String(selectedHouseId) },
        });
        names = data.data.sheet_names;
      } else {
        names = await listLiveC2CWorksheetNames(await file.arrayBuffer());
      }
      if (names.length === 0) {
        setUploadError("missing_worksheet");
        return;
      }
      setSelectedFile(file);
      setSheetNames(names);
    } catch (error) {
      setUploadError(error instanceof LiveC2CWorkbookError
        ? error.code
        : getImportErrorCode(error));
    } finally {
      setReadingWorkbook(false);
    }
  };

  const handleHouseChange = (ids: (string | number)[]) => {
    const value = ids[0];
    const nextHouseId = value === undefined ? null : Number(value);
    if (nextHouseId !== null && !Number.isSafeInteger(nextHouseId)) return;
    if (nextHouseId === selectedHouseId) return;

    setSelectedHouseId(nextHouseId);
    setExpandedRowId(null);
    setSelectedFile(null);
    setSheetNames([]);
    setSelectedSheetName(null);
    setUploadError(null);
    setMatchReport(null);
    setReportRows(null);
    setSavedSummary(null);
    setReportGenerated(false);
  };

  const handleExportMismatches = async () => {
    if (!matchReport || matchReport.issues.length === 0) return;

    setExporting(true);
    setUploadError(null);
    try {
      await exportLiveC2CMismatches({
        issues: matchReport.issues,
        houseName: selectedHouse?.name ?? null,
        houseCode: selectedHouse?.code ?? null,
        t,
      });
    } catch {
      setUploadError("export_failed");
    } finally {
      setExporting(false);
    }
  };

  const handleGenerateReport = async () => {
    if (!selectedHouseId || !selectedFile || !selectedSheetName) {
      setUploadError(!selectedHouseId ? "house_required" : "sheet_required");
      return;
    }

    setPreviewing(true);
    setUploadError(null);
    setMatchReport(null);
    setReportRows(null);
    const formData = new FormData();
    formData.append("file", selectedFile);
    formData.append("sheet_name", selectedSheetName);

    try {
      const { data } = await apiClient.post<{
        data: LiveC2CMatchReport & { report: unknown };
      }>(
        "/reports/live-c2c/preview",
        formData,
        { headers: { "X-House-ID": String(selectedHouseId) } },
      );
      const report = data.data;
      if (
        !Array.isArray(report.issues)
        || typeof report.summary?.total_rows !== "number"
        || !Array.isArray(report.report)
        || !report.report.every(isProductivityReportRow)
      ) {
        setUploadError("upload_failed");
        return;
      }
      setMatchReport(report);
      if (!report.can_import) return;
      setReportRows(report.report);
      setReportGenerated(true);

      // Persist the upload: a later upload only adds the transfers that are not
      // stored yet, and the live_c2c table is cleared after midnight.
      setSavingToDb(true);
      try {
        const saveData = new FormData();
        saveData.append("file", selectedFile);
        saveData.append("sheet_name", selectedSheetName);
        const { data: saved } = await apiClient.post<{
          data: { imported_rows: number; skipped_existing_rows: number };
        }>(
          "/reports/live-c2c/import",
          saveData,
          { headers: { "X-House-ID": String(selectedHouseId) } },
        );
        setSavedSummary({
          saved: saved.data.imported_rows,
          skipped: saved.data.skipped_existing_rows,
        });
        // Show the stored snapshot (earlier uploads included) instead of this file only.
        setReportRows(null);
        setBaseReportRefreshKey((key) => key + 1);
        setSelectedFile(null);
        setSheetNames([]);
        setSelectedSheetName(null);
        setUploadModalOpen(false);
      } catch (error) {
        const code = getImportErrorCode(error);
        setUploadError(code === "upload_failed" ? "save_failed" : code);
      } finally {
        setSavingToDb(false);
      }
    } catch (error) {
      setUploadError(getImportErrorCode(error));
    } finally {
      setPreviewing(false);
    }
  };

  if (!authLoading && !canView) return <AccessDenied />;

  return (
    <main className="mx-auto min-h-screen max-w-[1600px] min-w-0 p-2 pb-8 sm:px-6 sm:pb-8 sm:pt-2">
      <header className="mb-4 border-b border-gray-200 pb-4 dark:border-slate-700">
        <nav aria-label={t("live_c2c.breadcrumb_label")} className="-mt-2 mb-4 text-[13px]">
          <ol className="flex flex-wrap items-center gap-1.5 text-gray-500 dark:text-gray-400">
            <li>
              <Link
                href="/"
                className="inline-flex items-center gap-1.5 transition-colors hover:text-gray-700 dark:hover:text-gray-200"
              >
                <Home aria-hidden="true" className="size-4" />
                {t("live_c2c.breadcrumb_home")}
              </Link>
            </li>
            <li aria-hidden="true">
              <ChevronRight className="size-3.5" />
            </li>
            <li>{t("live_c2c.breadcrumb_reports")}</li>
            <li aria-hidden="true">
              <ChevronRight className="size-3.5" />
            </li>
            <li aria-current="page" className="font-medium text-gray-700 dark:text-gray-300">
              {t("live_c2c.title")}
            </li>
          </ol>
        </nav>
        <div className="flex items-start gap-3">
          <div className="mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary-50 text-primary-600 dark:bg-primary-500/10 dark:text-primary-400">
            <BarChart3 aria-hidden="true" className="size-5" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-semibold text-gray-900 dark:text-gray-100">
                {t("live_c2c.title")}
              </h1>
              <PageGuideModal pageKey="live_c2c" />
            </div>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
              {t("live_c2c.subtitle")}
            </p>
          </div>
        </div>
      </header>

      <section className="mt-4 min-w-0 space-y-4">
        <div className="flex flex-col gap-4 rounded-2xl border border-gray-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900 sm:flex-row sm:items-center">
          <div className="w-full min-w-0 sm:max-w-[340px] sm:flex-1">
            {housesLoading ? (
              <div
                role="status"
                aria-label={t("live_c2c.houses_loading")}
                className="h-11 w-full animate-pulse rounded-xl bg-gray-100 dark:bg-slate-800"
              />
            ) : housesError ? (
              <p
                role="alert"
                className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300"
              >
                {t("live_c2c.houses_error")}
              </p>
            ) : houses.length === 0 ? (
              <p
                role="alert"
                className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200"
              >
                {t("live_c2c.no_houses")}
              </p>
            ) : houses.length === 1 ? (
              <div className="flex h-11 min-w-0 items-center gap-2 rounded-xl border border-gray-200 bg-gray-50 px-3 text-sm text-gray-700 dark:border-slate-700 dark:bg-slate-800 dark:text-gray-200">
                <Store aria-hidden="true" className="size-4 shrink-0 text-gray-400" />
                <span className="truncate">{selectedHouse?.name}</span>
              </div>
            ) : (
              <EntitySelector
                label={t("live_c2c.house_label")}
                hideLabel
                items={houses.map((house) => ({
                  id: String(house.id),
                  label: house.name,
                  sublabel: house.code,
                }))}
                selectedIds={selectedHouseId === null ? [] : [String(selectedHouseId)]}
                onChange={handleHouseChange}
                placeholder={t("live_c2c.select_house")}
                searchPlaceholder={t("live_c2c.search_houses")}
                emptyMessage={t("live_c2c.no_houses")}
                noResultsMessage={t("live_c2c.no_matching_houses")}
                disabled={processing}
                single
                showSelectAll={false}
                clearLabel={t("live_c2c.clear_selection")}
              />
            )}
          </div>

          {selectedHouseId !== null && (canImport || canShare || selectedFile) && (
            <>
              <div aria-hidden="true" className="h-px w-full bg-gray-200 dark:bg-slate-700 sm:h-10 sm:w-px sm:shrink-0" />

              <div className="flex w-full flex-wrap items-center gap-2 sm:ml-auto sm:w-auto sm:justify-end">
                {canImport && (
                  <button
                    type="button"
                    onClick={() => setUploadModalOpen(true)}
                    disabled={processing || housesLoading || housesError}
                    className="inline-flex h-11 min-w-11 flex-1 items-center justify-center gap-2 rounded-xl bg-primary-600 px-4 text-sm font-semibold text-white transition-colors hover:bg-primary-700 disabled:cursor-not-allowed disabled:opacity-60 cursor-pointer sm:flex-none"
                  >
                    <FileSpreadsheet aria-hidden="true" className="size-[18px]" />
                    {t("live_c2c.upload_button")}
                  </button>
                )}

                {canShare && (
                  <button
                    type="button"
                    onClick={() => setWsModalOpen(true)}
                    disabled={processing}
                    aria-label={t("live_c2c.share_report")}
                    title={t("live_c2c.share_report")}
                    className="inline-flex h-11 min-h-11 min-w-11 flex-1 items-center justify-center gap-2 rounded-xl border border-green-300 bg-white px-4 text-sm font-semibold text-green-600 transition-colors hover:bg-green-50 disabled:cursor-not-allowed disabled:opacity-60 cursor-pointer dark:border-green-500/40 dark:bg-slate-900 dark:text-green-400 dark:hover:bg-green-500/10 sm:flex-none"
                  >
                    <Share2 aria-hidden="true" className="size-[18px]" />
                    <span>{t("live_c2c.share_button")}</span>
                  </button>
                )}
              </div>
            </>
          )}
        </div>

        {matchReport && matchReport.can_import && matchReport.summary.duplicate_rows > 0 && (
          <p
            role="status"
            className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200"
          >
            {t("live_c2c.duplicates.excluded_from_report", {
              count: matchReport.summary.duplicate_rows,
            })}
          </p>
        )}
        {matchReport?.house_mismatch && (
          <section
            role="alert"
            className="rounded-xl border border-amber-200 bg-amber-50/60 p-3 dark:border-amber-500/30 dark:bg-amber-500/10"
          >
            <h2 className="text-base font-semibold text-amber-900 dark:text-amber-200">
              {t("live_c2c.house_mismatch.title")}
            </h2>
            <p className="mt-1 text-sm text-amber-800 dark:text-amber-100">
              {matchReport.matching_house
                ? t("live_c2c.house_mismatch.matched_house_message", {
                    matched_house: `${matchReport.matching_house.name} (${matchReport.matching_house.code})`,
                    selected_house: selectedHouse
                      ? `${selectedHouse.name} (${selectedHouse.code})`
                      : "",
                  })
                : t("live_c2c.house_mismatch.message", {
                    house: selectedHouse
                      ? `${selectedHouse.name} (${selectedHouse.code})`
                      : "",
                  })}
            </p>
          </section>
        )}
        {matchReport && !matchReport.can_import && !matchReport.house_mismatch && (
          <section
            role="region"
            aria-live="polite"
            aria-label={t("live_c2c.diagnostics.title")}
            className="rounded-xl border border-red-200 bg-red-50/60 p-3 dark:border-red-500/30 dark:bg-red-500/10"
          >
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-base font-semibold text-red-800 dark:text-red-200">
                {t("live_c2c.diagnostics.title")}
              </h2>
              {canExportMismatches && matchReport.issues.length > 0 && (
                <button
                  type="button"
                  onClick={handleExportMismatches}
                  disabled={exporting}
                  aria-label={t("live_c2c.diagnostics.export")}
                  title={t("live_c2c.diagnostics.export")}
                  className="ml-auto inline-flex size-11 min-h-11 min-w-11 items-center justify-center rounded-xl border border-red-200 bg-white text-red-700 transition-colors hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-60 cursor-pointer dark:border-red-500/40 dark:bg-slate-900 dark:text-red-200 dark:hover:bg-slate-800"
                >
                  <Download aria-hidden="true" className="size-4" />
                  <span className="sr-only">
                    {t(exporting ? "live_c2c.diagnostics.exporting" : "live_c2c.diagnostics.export")}
                  </span>
                </button>
              )}
            </div>
            <p className="mt-1 text-sm text-red-700 dark:text-red-200">
              {t("live_c2c.diagnostics.blocked")}
            </p>

            <dl className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
              {[
                ["total_rows", matchReport.summary.total_rows],
                ["affected_rows", matchReport.summary.affected_rows],
                ["issue_count", matchReport.summary.issue_count],
              ].map(([key, value]) => (
                <div
                  key={key}
                  className="rounded-xl bg-white px-2 py-1 dark:bg-slate-900"
                >
                  <dt className="text-xs text-gray-500 dark:text-gray-400">
                    {t(`live_c2c.diagnostics.${key}`)}
                  </dt>
                  <dd className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                    {value}
                  </dd>
                </div>
              ))}
            </dl>

            {matchReport.issues.length === 0 ? (
              <p className="mt-3 text-sm text-gray-600 dark:text-gray-300">
                {t("live_c2c.diagnostics.empty")}
              </p>
            ) : (
              <>
                <ul className="mt-3 space-y-2 lg:hidden">
                  {matchReport.issues.map((issue) => (
                    <li
                      key={`${issue.side}-${issue.value}`}
                      className="rounded-xl border border-red-200 bg-white p-3 dark:border-red-500/30 dark:bg-slate-900"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="break-all font-mono text-sm font-semibold text-gray-900 dark:text-gray-100">
                          {issue.value}
                        </span>
                        <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-700 dark:bg-slate-800 dark:text-gray-200">
                          {t(`live_c2c.diagnostics.side_${issue.side}`)}
                        </span>
                        <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700 dark:bg-red-500/20 dark:text-red-200">
                          {t(`live_c2c.diagnostics.status_${issue.status}`)}
                        </span>
                      </div>
                      <p className="mt-2 text-xs text-gray-600 dark:text-gray-300">
                        {t("live_c2c.diagnostics.row_count", { count: issue.row_count })}
                        {" · "}
                        {t("live_c2c.diagnostics.excel_rows")}:{" "}
                        {issue.excel_rows.join(", ")}
                      </p>
                      {issue.candidates.length > 0 && (
                        <p className="mt-1 break-words text-xs text-gray-600 dark:text-gray-300">
                          <span className="font-medium">
                            {t("live_c2c.diagnostics.candidates")}:{" "}
                          </span>
                          {issue.candidates
                            .map((candidate) => candidateLabel(issue.side, candidate))
                            .join("; ")}
                        </p>
                      )}
                    </li>
                  ))}
                </ul>

                <div className="mt-3 hidden max-w-full overflow-x-auto rounded-xl border border-red-200 dark:border-red-500/30 lg:block">
                  <table className="w-full min-w-[720px] border-collapse bg-white text-left text-sm text-gray-800 dark:bg-slate-900 dark:text-gray-100">
                    <thead className="bg-gray-50 dark:bg-slate-800">
                      <tr>
                        {["value", "side", "status", "rows", "excel_rows", "candidates"].map((column) => (
                          <th
                            key={column}
                            scope="col"
                            className="whitespace-nowrap border border-gray-200 px-2 py-1 font-semibold dark:border-slate-700"
                          >
                            {t(`live_c2c.diagnostics.columns.${column}`)}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {matchReport.issues.map((issue) => (
                        <tr
                          key={`${issue.side}-${issue.value}`}
                          className="even:bg-gray-50 dark:even:bg-slate-800/50"
                        >
                          <td className="whitespace-nowrap border border-gray-200 px-2 py-1 font-mono dark:border-slate-700">
                            {issue.value}
                          </td>
                          <td className="whitespace-nowrap border border-gray-200 px-2 py-1 dark:border-slate-700">
                            {t(`live_c2c.diagnostics.side_${issue.side}`)}
                          </td>
                          <td className="whitespace-nowrap border border-gray-200 px-2 py-1 dark:border-slate-700">
                            {t(`live_c2c.diagnostics.status_${issue.status}`)}
                          </td>
                          <td className="whitespace-nowrap border border-gray-200 px-2 py-1 dark:border-slate-700">
                            {issue.row_count}
                          </td>
                          <td className="whitespace-nowrap border border-gray-200 px-2 py-1 dark:border-slate-700">
                            {issue.excel_rows.join(", ")}
                          </td>
                          <td className="border border-gray-200 px-2 py-1 dark:border-slate-700">
                            {issue.candidates.length > 0
                              ? issue.candidates
                                  .map((candidate) => candidateLabel(issue.side, candidate))
                                  .join("; ")
                              : "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}

            {matchReport.truncated && (
              <p className="mt-2 text-xs text-red-700 dark:text-red-200">
                {t("live_c2c.diagnostics.truncated")}
              </p>
            )}
          </section>
        )}
        {savedSummary && (
          <p
            role="status"
            className="rounded-xl border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800 dark:border-green-500/30 dark:bg-green-500/10 dark:text-green-300"
          >
            {t("live_c2c.import_saved", {
              saved: savedSummary.saved,
              skipped: savedSummary.skipped,
            })}
          </p>
        )}

        {showReportArea && (
        <div
          role="region"
          aria-label={t("live_c2c.title")}
          className="space-y-2 lg:hidden"
        >
          {previewing ? (
            Array.from({ length: 10 }, (_, index) => (
              <div
                key={`mobile-skeleton-${index}`}
                aria-hidden="true"
                className="h-16 animate-pulse rounded-xl border border-gray-200 bg-gray-100 dark:border-slate-700 dark:bg-slate-800"
              />
            ))
          ) : reportRows === null ? (
            baseLoading ? (
              Array.from({ length: 10 }, (_, index) => (
                <div
                  key={`base-skeleton-${index}`}
                  aria-hidden="true"
                  className="h-16 animate-pulse rounded-xl border border-gray-200 bg-gray-100 dark:border-slate-700 dark:bg-slate-800"
                />
              ))
            ) : baseError ? (
              <p
                role="alert"
                className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300"
              >
                {t("live_c2c.base_report_error")}
              </p>
            ) : baseRows === null || baseRows.length === 0 ? (
              <p role="status" className="rounded-xl border border-gray-200 bg-white px-3 py-4 text-center text-sm text-gray-500 dark:border-slate-700 dark:bg-slate-900 dark:text-gray-400">
                {t("live_c2c.no_active_rsos")}
              </p>
            ) : (
              baseRows.map((row, index) => {
                const isExpanded = expandedRowId === row.employee_id;
                return (
                  <article
                    key={row.employee_id}
                    className="overflow-hidden rounded-xl border border-gray-200 bg-white dark:border-slate-700 dark:bg-slate-900"
                  >
                    <button
                      type="button"
                      aria-expanded={isExpanded}
                      aria-label={t(isExpanded ? "live_c2c.hide_details" : "live_c2c.show_details")}
                      onClick={() => setExpandedRowId(isExpanded ? null : row.employee_id)}
                      className="flex min-h-11 w-full items-center justify-between gap-3 p-3 text-left cursor-pointer"
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-semibold text-gray-900 dark:text-gray-100">
                          {formatNumber(index + 1)}. {row.rso_name || "—"}
                        </span>
                        <span className="mt-1 block truncate text-xs text-gray-500 dark:text-gray-400">
                          {row.dms_code || "—"} · {row.rso_itop_number || "—"}
                        </span>
                      </span>
                      <ChevronDown
                        aria-hidden="true"
                        className={`size-4 shrink-0 transition-transform ${isExpanded ? "rotate-180" : ""}`}
                      />
                    </button>
                    {isExpanded && (
                      <dl className="grid grid-cols-1 gap-3 border-t border-gray-200 px-3 py-3 text-sm sm:grid-cols-2 dark:border-slate-700">
                        {REPORT_COLUMNS.slice(1).map((column) => (
                          <div key={column} className="min-w-0">
                            <dt className="text-xs text-gray-500 dark:text-gray-400">
                              {t(`live_c2c.report_columns.${column}`)}
                            </dt>
                            <dd
                              className={`mt-1 break-words text-gray-900 dark:text-gray-100 ${reportCellToneClass(column, row)}`}
                            >
                              {baseReportCellText(column, row, index, formatNumber)}
                            </dd>
                          </div>
                        ))}
                      </dl>
                    )}
                  </article>
                );
              })
            )
          ) : reportRows.length === 0 ? (
            <p role="status" className="rounded-xl border border-gray-200 bg-white px-3 py-4 text-center text-sm text-gray-500 dark:border-slate-700 dark:bg-slate-900 dark:text-gray-400">
              {t("live_c2c.no_active_rsos")}
            </p>
          ) : (
            reportRows.map((row, index) => {
              const isExpanded = expandedRowId === row.employee_id;
              return (
                <article
                  key={row.employee_id}
                  className="overflow-hidden rounded-xl border border-gray-200 bg-white dark:border-slate-700 dark:bg-slate-900"
                >
                  <button
                    type="button"
                    aria-expanded={isExpanded}
                    aria-label={t(isExpanded ? "live_c2c.hide_details" : "live_c2c.show_details")}
                    onClick={() => setExpandedRowId(isExpanded ? null : row.employee_id)}
                    className="flex min-h-11 w-full items-center justify-between gap-3 p-3 text-left cursor-pointer"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-semibold text-gray-900 dark:text-gray-100">
                        {formatNumber(index + 1)}. {row.rso_name}
                      </span>
                      <span className="mt-1 block truncate text-xs text-gray-500 dark:text-gray-400">
                        {row.dms_code ?? "—"} · {row.rso_itop_number ?? "—"}
                      </span>
                    </span>
                    <ChevronDown
                      aria-hidden="true"
                      className={`size-4 shrink-0 transition-transform ${isExpanded ? "rotate-180" : ""}`}
                    />
                    <span className="sr-only">
                      {t(isExpanded ? "live_c2c.hide_details" : "live_c2c.show_details")}
                    </span>
                  </button>
                  {isExpanded && (
                    <dl className="grid grid-cols-1 gap-3 border-t border-gray-200 px-3 py-3 text-sm sm:grid-cols-2 dark:border-slate-700">
                      {REPORT_COLUMNS.slice(1).map((column) => (
                        <div key={column} className="min-w-0">
                          <dt className="text-xs text-gray-500 dark:text-gray-400">
                            {t(`live_c2c.report_columns.${column}`)}
                          </dt>
                          <dd
                            className={`mt-1 break-words text-gray-900 dark:text-gray-100 ${reportCellToneClass(column, row)}`}
                          >
                            {reportCellText(column, row, index, formatNumber)}
                          </dd>
                        </div>
                      ))}
                    </dl>
                  )}
                </article>
              );
            })
          )}
          {!previewing && columnTotals.size > 0 && (
            <article className="rounded-xl border border-gray-200 bg-gray-50 p-3 dark:border-slate-700 dark:bg-slate-800">
              <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                {t("live_c2c.total_row")}
              </h3>
              <dl className="mt-2 grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
                {Array.from(columnTotals.entries()).map(([column, total]) => (
                  <div key={column} className="flex items-center justify-between gap-3">
                    <dt className="min-w-0 truncate text-gray-500 dark:text-gray-400">
                      {t(`live_c2c.report_columns.${column}`)}
                    </dt>
                    <dd
                      className={`font-semibold text-gray-900 dark:text-gray-100 ${totalCellToneClass(column, total)}`}
                    >
                      {totalCellText(column, total, formatNumber)}
                    </dd>
                  </div>
                ))}
              </dl>
            </article>
          )}
        </div>
        )}

        {showReportArea && (
        <div
          role="region"
          aria-label={t("live_c2c.title")}
          tabIndex={0}
          className="hidden max-w-full overflow-x-auto rounded-xl border border-gray-200 dark:border-slate-700 lg:block"
        >
          <table className="w-full min-w-[2100px] border-collapse bg-white text-left text-sm text-gray-800 dark:bg-slate-900 dark:text-gray-100">
            <thead className="bg-gray-50 dark:bg-slate-800">
              <tr>
                {REPORT_COLUMNS.map((column) => (
                  <th
                    key={column}
                    scope="col"
                    className="whitespace-nowrap border border-gray-200 px-2 py-2 font-semibold dark:border-slate-700"
                  >
                    {t(`live_c2c.report_columns.${column}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {previewing ? (
                Array.from({ length: 10 }, (_, rowIndex) => (
                  <tr key={`skeleton-${rowIndex}`} aria-hidden="true">
                    {REPORT_COLUMNS.map((column) => (
                      <td key={column} className="border border-gray-200 px-2 py-1 dark:border-slate-700">
                        <div className="h-4 w-4/5 animate-pulse rounded bg-gray-100 dark:bg-slate-800" />
                      </td>
                    ))}
                  </tr>
                ))
              ) : reportRows === null ? (
                baseLoading ? (
                  Array.from({ length: 10 }, (_, rowIndex) => (
                    <tr key={`base-skeleton-${rowIndex}`} aria-hidden="true">
                      {REPORT_COLUMNS.map((column) => (
                        <td key={column} className="border border-gray-200 px-2 py-1 dark:border-slate-700">
                          <div className="h-4 w-4/5 animate-pulse rounded bg-gray-100 dark:bg-slate-800" />
                        </td>
                      ))}
                    </tr>
                  ))
                ) : baseError ? (
                  <tr>
                    <td
                      colSpan={REPORT_COLUMNS.length}
                      className="border border-gray-200 px-2 py-1 text-center text-red-600 dark:border-slate-700 dark:text-red-300"
                    >
                      {t("live_c2c.base_report_error")}
                    </td>
                  </tr>
                ) : baseRows === null || baseRows.length === 0 ? (
                  <tr>
                    <td colSpan={REPORT_COLUMNS.length} className="border border-gray-200 px-2 py-1 text-center text-gray-500 dark:border-slate-700 dark:text-gray-400">
                      {t("live_c2c.no_active_rsos")}
                    </td>
                  </tr>
                ) : (
                  baseRows.map((row, index) => (
                    <tr key={row.employee_id} className="even:bg-gray-50 dark:even:bg-slate-800/50">
                      {REPORT_COLUMNS.map((column) => (
                        <td
                          key={column}
                          className={`whitespace-nowrap border border-gray-200 px-2 py-1 dark:border-slate-700 ${reportCellToneClass(column, row)}`}
                        >
                          {baseReportCellText(column, row, index, formatNumber)}
                        </td>
                      ))}
                    </tr>
                  ))
                )
              ) : reportRows.length === 0 ? (
                <tr>
                  <td colSpan={REPORT_COLUMNS.length} className="border border-gray-200 px-2 py-1 text-center text-gray-500 dark:border-slate-700 dark:text-gray-400">
                    {t("live_c2c.no_active_rsos")}
                  </td>
                </tr>
              ) : (
                reportRows.map((row, index) => (
                  <tr key={row.employee_id} className="even:bg-gray-50 dark:even:bg-slate-800/50">
                    {REPORT_COLUMNS.map((column) => (
                      <td
                        key={column}
                        className={`whitespace-nowrap border border-gray-200 px-2 py-1 dark:border-slate-700 ${reportCellToneClass(column, row)}`}
                      >
                        {reportCellText(column, row, index, formatNumber)}
                      </td>
                    ))}
                  </tr>
                ))
              )}
            </tbody>
            {!previewing && columnTotals.size > 0 && (
              <tfoot className="bg-gray-50 font-semibold dark:bg-slate-800">
                <tr>
                  {REPORT_COLUMNS.map((column) => {
                    const total = columnTotals.get(column);
                    return (
                      <td
                        key={column}
                        className={`whitespace-nowrap border border-gray-200 px-2 py-1 dark:border-slate-700 ${total !== undefined ? totalCellToneClass(column, total) : ""}`}
                      >
                        {column === "serial_number"
                          ? t("live_c2c.total_row")
                          : total !== undefined
                            ? totalCellText(column, total, formatNumber)
                            : ""}
                      </td>
                    );
                  })}
                </tr>
              </tfoot>
            )}
          </table>
        </div>
        )}
      </section>

      {selectedHouseId !== null && canViewAutomation && (
        <div className="mt-4">
          <LiveC2CAutomationCard
            key={selectedHouseId}
            houseId={selectedHouseId}
            canView={canViewAutomation}
            canManage={canManageAutomation}
          />
        </div>
      )}

      <LiveC2CUploadModal
        open={uploadModalOpen}
        processing={processing}
        title={t("live_c2c.upload_modal_title")}
        description={t("live_c2c.upload_modal_description")}
        closeLabel={t("common.close")}
        errorMessage={
          uploadError ? t(`live_c2c.errors.${uploadError}`) : undefined
        }
        onClose={() => setUploadModalOpen(false)}
      >
        <>
          <div className="space-y-3">
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xlsb,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel.sheet.binary.macroEnabled.12"
              aria-label={t("live_c2c.choose_file")}
              onChange={handleFileChange}
              className="sr-only"
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={processing || housesLoading || housesError}
              className="inline-flex min-h-11 w-full cursor-pointer items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white px-4 text-sm font-semibold text-gray-700 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:bg-slate-800 dark:text-gray-200 dark:hover:bg-slate-700"
            >
              {readingWorkbook ? (
                <Loader2 aria-hidden="true" className="size-4 animate-spin" />
              ) : (
                <FileSpreadsheet aria-hidden="true" className="size-4" />
              )}
              {t(readingWorkbook ? "live_c2c.processing" : "live_c2c.choose_file")}
            </button>
            {selectedFile && (
              <p
                title={selectedFile.name}
                className="flex min-w-0 items-center gap-2 rounded-xl bg-gray-50 px-3 py-2 text-sm text-gray-700 dark:bg-slate-800 dark:text-gray-200"
              >
                <FileSpreadsheet aria-hidden="true" className="size-4 shrink-0 text-primary-600 dark:text-primary-400" />
                <span className="min-w-0 truncate">{selectedFile.name}</span>
              </p>
            )}
          </div>

          {selectedFile && sheetNames.length > 0 && (
            <>
              <div className="space-y-3 rounded-xl border border-gray-200 p-3 dark:border-slate-700">
                <EntitySelector
                  label={t("live_c2c.sheet_label")}
                  items={sheetNames.map((name) => ({ id: name, label: name }))}
                  selectedIds={selectedSheetName ? [selectedSheetName] : []}
                  onChange={(ids) => {
                    const sheetName = ids[0];
                    setSelectedSheetName(typeof sheetName === "string" ? sheetName : null);
                  }}
                  placeholder={t("live_c2c.select_sheet")}
                  searchPlaceholder={t("live_c2c.search_sheets")}
                  emptyMessage={t("live_c2c.no_sheets")}
                  noResultsMessage={t("live_c2c.no_matching_sheets")}
                  disabled={processing}
                  required
                  single
                  showSelectAll={false}
                  clearLabel={t("live_c2c.clear_selection")}
                  portal
                />
                <p className="text-sm text-gray-600 dark:text-gray-300">
                  {t("live_c2c.required_columns")}
                </p>
              </div>

              {matchReport?.house_mismatch && (
                <section
                  role="alert"
                  className="rounded-xl border border-amber-200 bg-amber-50/60 p-3 dark:border-amber-500/30 dark:bg-amber-500/10"
                >
                  <h3 className="text-sm font-semibold text-amber-900 dark:text-amber-200">
                    {t("live_c2c.house_mismatch.title")}
                  </h3>
                  <p className="mt-1 text-sm text-amber-800 dark:text-amber-100">
                    {matchReport.matching_house
                      ? t("live_c2c.house_mismatch.matched_house_message", {
                          matched_house: `${matchReport.matching_house.name} (${matchReport.matching_house.code})`,
                          selected_house: selectedHouse
                            ? `${selectedHouse.name} (${selectedHouse.code})`
                            : "",
                        })
                      : t("live_c2c.house_mismatch.message", {
                          house: selectedHouse
                            ? `${selectedHouse.name} (${selectedHouse.code})`
                            : "",
                        })}
                  </p>
                </section>
              )}

              {matchReport && !matchReport.can_import && !matchReport.house_mismatch && (
                <section
                  role="alert"
                  aria-label={t("live_c2c.diagnostics.title")}
                  className="space-y-2 rounded-xl border border-red-200 bg-red-50/60 p-3 dark:border-red-500/30 dark:bg-red-500/10"
                >
                  <p className="text-sm font-semibold text-red-800 dark:text-red-200">
                    {t("live_c2c.diagnostics.blocked")}
                  </p>
                  <p className="text-sm text-red-700 dark:text-red-200">
                    {t("live_c2c.diagnostics.issue_count")}: {matchReport.summary.issue_count}
                  </p>
                  {canExportMismatches && matchReport.issues.length > 0 && (
                    <button
                      type="button"
                      onClick={handleExportMismatches}
                      disabled={exporting}
                      className="inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-xl border border-red-200 bg-white px-3 text-sm font-semibold text-red-700 transition-colors hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-red-500/40 dark:bg-slate-900 dark:text-red-200 dark:hover:bg-slate-800"
                    >
                      {exporting ? (
                        <Loader2 aria-hidden="true" className="size-4 animate-spin" />
                      ) : (
                        <Download aria-hidden="true" className="size-4" />
                      )}
                      {t(exporting ? "live_c2c.diagnostics.exporting" : "live_c2c.diagnostics.export")}
                    </button>
                  )}
                  <ul className="max-h-32 space-y-1 overflow-y-auto text-sm text-red-800 dark:text-red-200">
                    {matchReport.issues.slice(0, 5).map((issue) => (
                      <li key={`${issue.side}-${issue.value}`} className="break-words">
                        {issue.value}
                        {" — "}
                        {t(`live_c2c.diagnostics.side_${issue.side}`)}
                        {" · "}
                        {t("live_c2c.diagnostics.row_count", { count: issue.row_count })}
                      </li>
                    ))}
                  </ul>
                  {matchReport.truncated && (
                    <p className="text-xs text-red-700 dark:text-red-200">
                      {t("live_c2c.diagnostics.truncated")}
                    </p>
                  )}
                </section>
              )}

              <button
                type="button"
                onClick={handleGenerateReport}
                disabled={processing || !selectedSheetName}
                className="inline-flex min-h-11 w-full cursor-pointer items-center justify-center gap-2 rounded-xl bg-primary-600 px-4 text-sm font-semibold text-white transition-colors hover:bg-primary-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {processing ? (
                  <Loader2 aria-hidden="true" className="size-4 animate-spin" />
                ) : (
                  <FileSpreadsheet aria-hidden="true" className="size-4" />
                )}
                {t(
                  savingToDb
                    ? "live_c2c.saving"
                    : previewing
                      ? "live_c2c.generating"
                      : "live_c2c.generate_and_save",
                )}
              </button>
            </>
          )}
        </>
      </LiveC2CUploadModal>

      <ReportDeliveryModal
        open={wsModalOpen}
        houseId={selectedHouseId}
        reportType="live_c2c"
        title={t("live_c2c.whatsapp.title")}
        subtitle={t("live_c2c.whatsapp.subtitle")}
        onClose={() => setWsModalOpen(false)}
      />
    </main>
  );
}
