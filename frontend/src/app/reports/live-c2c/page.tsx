"use client";

import axios from "axios";
import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { ChevronDown, Download } from "lucide-react";
import PageGuideModal from "@/components/PageGuideModal";
import { AccessDenied } from "@/components/ui/AccessDenied";
import { ConfirmationModal } from "@/components/ui/ConfirmationModal";
import EntitySelector from "@/app/zoom-in/_components/EntitySelector";
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

interface LiveC2CRow {
  id: number;
  from_msisdn: string;
  to_msisdn: string;
  modified_on: string | null;
  transfer_mrp: string;
  on_route: "Y" | "N";
}

interface LiveC2CPagination {
  page: number;
  per_page: number;
  total: number;
  total_pages: number;
  has_next: boolean;
  has_prev: boolean;
}

interface LiveC2CListResponse {
  success: boolean;
  data: LiveC2CRow[];
  pagination: LiveC2CPagination;
}

interface ApiErrorBody {
  error_code?: unknown;
  detail?: {
    error_code?: unknown;
  };
}

const ROWS_PER_PAGE = 50;

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

export default function LiveC2CReportPage() {
  const { hasPermission, loading: authLoading } = useAuth();
  const { t } = useLanguage();
  const canView = hasPermission("reports.view") || hasPermission("itopup.view");
  const canImport = hasPermission("live_c2c.import");
  const [houses, setHouses] = useState<AccessibleHouse[]>([]);
  const [housesLoading, setHousesLoading] = useState(true);
  const [housesError, setHousesError] = useState(false);
  const [selectedHouseId, setSelectedHouseId] = useState<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [sheetNames, setSheetNames] = useState<string[]>([]);
  const [selectedSheetName, setSelectedSheetName] = useState<string | null>(null);
  const [rows, setRows] = useState<LiveC2CRow[]>([]);
  const [expandedRowId, setExpandedRowId] = useState<number | null>(null);
  const [pagination, setPagination] = useState<LiveC2CPagination | null>(null);
  const [page, setPage] = useState(1);
  const [listLoading, setListLoading] = useState(false);
  const [listError, setListError] = useState(false);
  const [readingWorkbook, setReadingWorkbook] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [importResult, setImportResult] = useState<{
    imported: number;
    duplicates: number;
  } | null>(null);
  const [matchReport, setMatchReport] = useState<LiveC2CMatchReport | null>(null);
  const [disabledRetailerConfirmCount, setDisabledRetailerConfirmCount] = useState<number | null>(null);
  const [exporting, setExporting] = useState(false);
  const canExportMismatches = hasPermission("live_c2c.export");
  const [refreshKey, setRefreshKey] = useState(0);
  const selectedHouse = houses.find((house) => house.id === selectedHouseId) ?? null;
  const processing = readingWorkbook || previewing || importing;

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

  useEffect(() => {
    if (!selectedHouseId) {
      setRows([]);
      setPagination(null);
      setListLoading(false);
      setListError(false);
      return;
    }

    const controller = new AbortController();
    setListLoading(true);
    setListError(false);
    setExpandedRowId(null);
    setRows([]);
    setPagination(null);
    apiClient.get<LiveC2CListResponse>("/reports/live-c2c", {
      params: { page, per_page: ROWS_PER_PAGE },
      headers: { "X-House-ID": String(selectedHouseId) },
      signal: controller.signal,
    }).then(({ data }) => {
      setRows(data.data);
      setPagination(data.pagination);
    }).catch(() => {
      if (!controller.signal.aborted) setListError(true);
    }).finally(() => {
      if (!controller.signal.aborted) setListLoading(false);
    });

    return () => controller.abort();
  }, [page, refreshKey, selectedHouseId]);

  const handleFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;

    setUploadError(null);
    setImportResult(null);
    setMatchReport(null);
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
    setPage(1);
    setExpandedRowId(null);
    setSelectedFile(null);
    setSheetNames([]);
    setSelectedSheetName(null);
    setUploadError(null);
    setImportResult(null);
    setMatchReport(null);
  };

  const handleImport = async () => {
    if (!selectedHouseId || !selectedFile || !selectedSheetName) {
      setUploadError(!selectedHouseId ? "house_required" : "sheet_required");
      return;
    }

    setImporting(true);
    setUploadError(null);
    setImportResult(null);
    const formData = new FormData();
    formData.append("file", selectedFile);
    formData.append("sheet_name", selectedSheetName);

    try {
      const { data } = await apiClient.post<{
        data: { imported_rows: number; duplicate_rows?: number };
      }>("/reports/live-c2c/import", formData, {
        headers: { "X-House-ID": String(selectedHouseId) },
      });
      setImportResult({
        imported: data.data.imported_rows,
        duplicates: data.data.duplicate_rows ?? 0,
      });
      setMatchReport(null);
      setSelectedFile(null);
      setSheetNames([]);
      setSelectedSheetName(null);
      setPage(1);
      setRefreshKey((current) => current + 1);
    } catch (error) {
      setUploadError(getImportErrorCode(error));
    } finally {
      setImporting(false);
    }
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

  const handlePreviewAndConfirm = async () => {
    if (!selectedHouseId || !selectedFile || !selectedSheetName) {
      setUploadError(!selectedHouseId ? "house_required" : "sheet_required");
      return;
    }

    setPreviewing(true);
    setUploadError(null);
    setDisabledRetailerConfirmCount(null);
    const formData = new FormData();
    formData.append("file", selectedFile);
    formData.append("sheet_name", selectedSheetName);

    try {
      const { data } = await apiClient.post<{ data: LiveC2CMatchReport }>(
        "/reports/live-c2c/preview",
        formData,
        { headers: { "X-House-ID": String(selectedHouseId) } },
      );
      const report = data.data;
      const disabledCount = report.disabled_retailer_count;
      if (
        !Array.isArray(report.issues)
        || typeof report.summary?.total_rows !== "number"
        || !Number.isSafeInteger(disabledCount)
        || disabledCount < 0
      ) {
        setUploadError("upload_failed");
        return;
      }
      setMatchReport(report);
      if (!report.can_import) return;
      if (disabledCount > 0) {
        setDisabledRetailerConfirmCount(disabledCount);
      } else {
        void handleImport();
      }
    } catch (error) {
      setUploadError(getImportErrorCode(error));
    } finally {
      setPreviewing(false);
    }
  };

  if (!authLoading && !canView) return <AccessDenied />;

  return (
    <main className="mx-auto min-h-screen max-w-[1600px] min-w-0 p-4 pb-8 sm:p-6">
      <header className="flex items-center gap-2.5">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
          {t("live_c2c.title")}
        </h1>
        <PageGuideModal pageKey="live_c2c" />
      </header>

      <section className="mt-5 min-w-0 space-y-4">
        <div className="flex flex-wrap items-end gap-3">
          {housesLoading ? (
            <div
              role="status"
              aria-label={t("live_c2c.houses_loading")}
              className="h-11 w-full animate-pulse rounded-xl bg-gray-100 sm:max-w-xs dark:bg-slate-800"
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
            <p className="min-h-11 rounded-xl bg-gray-100 px-3 py-2 text-sm text-gray-700 dark:bg-slate-800 dark:text-gray-200">
              <span className="font-semibold">{t("live_c2c.house_label")}: </span>
              {selectedHouse?.name}
            </p>
          ) : (
            <div className="w-full sm:max-w-xs">
              <EntitySelector
                label={t("live_c2c.house_label")}
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
            </div>
          )}

          {canImport && (
            <>
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.xlsb,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel.sheet.binary.macroEnabled.12"
                aria-label={t("live_c2c.upload_button")}
                onChange={handleFileChange}
                className="sr-only"
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={processing || housesLoading || housesError || !selectedHouseId}
                className="inline-flex h-11 min-w-11 items-center justify-center rounded-xl bg-primary-600 px-4 text-sm font-semibold text-white transition-colors hover:bg-primary-700 disabled:cursor-not-allowed disabled:opacity-60 cursor-pointer"
              >
                {t(readingWorkbook ? "live_c2c.processing" : "live_c2c.upload_button")}
              </button>
            </>
          )}

          {selectedFile && (
            <span className="min-h-11 max-w-full content-center truncate text-sm text-gray-600 dark:text-gray-300">
              {selectedFile.name}
            </span>
          )}
        </div>

        {selectedFile && sheetNames.length > 0 && (
          <div className="flex flex-col gap-3 rounded-xl border border-gray-200 bg-white p-3 sm:flex-row sm:items-end dark:border-slate-700 dark:bg-slate-900">
            <div className="w-full sm:max-w-sm">
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
                disabled={importing}
                required
                single
                showSelectAll={false}
                clearLabel={t("live_c2c.clear_selection")}
              />
            </div>
            <p className="min-h-11 content-center text-sm text-gray-600 dark:text-gray-300">
              {t("live_c2c.required_columns")}
            </p>
            <button
              type="button"
              onClick={handlePreviewAndConfirm}
              disabled={processing || !selectedSheetName}
              className="inline-flex h-11 min-w-11 items-center justify-center rounded-xl bg-primary-600 px-4 text-sm font-semibold text-white transition-colors hover:bg-primary-700 disabled:cursor-not-allowed disabled:opacity-60 cursor-pointer sm:ml-auto"
            >
              {t(
                previewing
                  ? "live_c2c.checking"
                  : importing
                    ? "live_c2c.saving"
                    : "live_c2c.save_button",
              )}
            </button>
          </div>
        )}

        {uploadError && (
          <p
            role="alert"
            className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300"
          >
            {t(`live_c2c.errors.${uploadError}`)}
          </p>
        )}
        {importResult !== null && (
          <p
            role="status"
            className="rounded-xl border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800 dark:border-green-500/30 dark:bg-green-500/10 dark:text-green-300"
          >
            {importResult.duplicates > 0
              ? t("live_c2c.duplicates.imported_with_duplicates", {
                  count: importResult.imported,
                  duplicates: importResult.duplicates,
                })
              : t("live_c2c.import_success", { count: importResult.imported })}
          </p>
        )}
        {matchReport && matchReport.can_import && matchReport.summary.duplicate_rows > 0 && (
          <p
            role="status"
            className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200"
          >
            {t("live_c2c.duplicates.will_skip", {
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
        <div
          role="region"
          aria-label={t("live_c2c.title")}
          className="space-y-2 lg:hidden"
        >
          {listLoading ? (
            Array.from({ length: 5 }, (_, index) => (
              <div
                key={`mobile-skeleton-${index}`}
                aria-hidden="true"
                className="h-16 animate-pulse rounded-xl border border-gray-200 bg-gray-100 dark:border-slate-700 dark:bg-slate-800"
              />
            ))
          ) : rows.length === 0 ? (
            <p
              role={listError ? "alert" : "status"}
              className={`rounded-xl border px-3 py-4 text-center text-sm ${
                listError
                  ? "border-red-200 bg-red-50 text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300"
                  : "border-gray-200 bg-white text-gray-500 dark:border-slate-700 dark:bg-slate-900 dark:text-gray-400"
              }`}
            >
              {t(listError ? "live_c2c.list_error" : "live_c2c.empty_state")}
            </p>
          ) : (
            rows.map((row) => {
              const isExpanded = expandedRowId === row.id;
              return (
                <article
                  key={row.id}
                  className="overflow-hidden rounded-xl border border-gray-200 bg-white dark:border-slate-700 dark:bg-slate-900"
                >
                  <button
                    type="button"
                    aria-expanded={isExpanded}
                    aria-label={t(isExpanded ? "live_c2c.hide_details" : "live_c2c.show_details")}
                    onClick={() => setExpandedRowId(isExpanded ? null : row.id)}
                    className="flex min-h-11 w-full items-center justify-between gap-3 p-3 text-left cursor-pointer"
                  >
                    <span className="min-w-0">
                      <span className="flex items-center gap-2 truncate text-sm font-semibold text-gray-900 dark:text-gray-100">
                        <span className="truncate">{row.from_msisdn}</span>
                        <span aria-hidden="true" className="text-gray-400">→</span>
                        <span className="truncate">{row.to_msisdn}</span>
                      </span>
                      <span className="mt-1 block text-xs text-gray-500 dark:text-gray-400">
                        {t("live_c2c.columns.on_route")}: {row.on_route}
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
                    <dl className="grid grid-cols-2 gap-3 border-t border-gray-200 px-3 py-3 text-sm dark:border-slate-700">
                      <div>
                        <dt className="text-xs text-gray-500 dark:text-gray-400">
                          {t("live_c2c.columns.modified_on")}
                        </dt>
                        <dd className="mt-1 break-words text-gray-900 dark:text-gray-100">
                          {row.modified_on ?? "—"}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-xs text-gray-500 dark:text-gray-400">
                          {t("live_c2c.columns.transfer_mrp")}
                        </dt>
                        <dd className="mt-1 break-words text-gray-900 dark:text-gray-100">
                          {row.transfer_mrp}
                        </dd>
                      </div>
                    </dl>
                  )}
                </article>
              );
            })
          )}
        </div>

        <div
          role="region"
          aria-label={t("live_c2c.title")}
          tabIndex={0}
          className="hidden max-w-full overflow-x-auto rounded-xl border border-gray-200 dark:border-slate-700 lg:block"
        >
          <table className="w-full min-w-[720px] border-collapse bg-white text-left text-sm text-gray-800 dark:bg-slate-900 dark:text-gray-100">
            <thead className="bg-gray-50 dark:bg-slate-800">
              <tr>
                {["from_msisdn", "to_msisdn", "on_route", "modified_on", "transfer_mrp"].map((column) => (
                  <th
                    key={column}
                    scope="col"
                    className="whitespace-nowrap border border-gray-200 px-3 py-2 font-semibold dark:border-slate-700"
                  >
                    {t(`live_c2c.columns.${column}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {listLoading ? (
                Array.from({ length: 5 }, (_, rowIndex) => (
                  <tr key={`skeleton-${rowIndex}`} aria-hidden="true">
                    {Array.from({ length: 5 }, (_, columnIndex) => (
                      <td key={columnIndex} className="border border-gray-200 px-2 py-1 dark:border-slate-700">
                        <div className="h-4 w-4/5 animate-pulse rounded bg-gray-100 dark:bg-slate-800" />
                      </td>
                    ))}
                  </tr>
                ))
              ) : rows.length === 0 ? (
                <tr>
                  <td
                    colSpan={5}
                    role={listError ? "alert" : undefined}
                    className={`border border-gray-200 px-2 py-1 text-center dark:border-slate-700 ${
                      listError
                        ? "text-red-700 dark:text-red-300"
                        : "text-gray-500 dark:text-gray-400"
                    }`}
                  >
                    {t(listError ? "live_c2c.list_error" : "live_c2c.empty_state")}
                  </td>
                </tr>
              ) : (
                rows.map((row) => (
                  <tr key={row.id} className="even:bg-gray-50 dark:even:bg-slate-800/50">
                    <td className="whitespace-nowrap border border-gray-200 px-2 py-1 dark:border-slate-700">
                      {row.from_msisdn}
                    </td>
                    <td className="whitespace-nowrap border border-gray-200 px-2 py-1 dark:border-slate-700">
                      {row.to_msisdn}
                    </td>
                    <td className="whitespace-nowrap border border-gray-200 px-2 py-1 dark:border-slate-700">
                      {row.on_route}
                    </td>
                    <td className="whitespace-nowrap border border-gray-200 px-2 py-1 dark:border-slate-700">
                      {row.modified_on ?? "—"}
                    </td>
                    <td className="whitespace-nowrap border border-gray-200 px-2 py-1 dark:border-slate-700">
                      {row.transfer_mrp}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {pagination && pagination.total > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-gray-600 dark:text-gray-300">
              {t("live_c2c.row_count", { count: pagination.total })}
            </p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setPage((current) => Math.max(1, current - 1))}
                disabled={!pagination.has_prev || listLoading}
                className="min-h-11 rounded-xl border border-gray-200 px-3 text-sm text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer dark:border-slate-700 dark:text-gray-200 dark:hover:bg-slate-800"
              >
                {t("live_c2c.previous")}
              </button>
              <span className="text-sm text-gray-600 dark:text-gray-300">
                {t("live_c2c.page_count", {
                  page: pagination.page,
                  pages: pagination.total_pages,
                })}
              </span>
              <button
                type="button"
                onClick={() => setPage((current) => current + 1)}
                disabled={!pagination.has_next || listLoading}
                className="min-h-11 rounded-xl border border-gray-200 px-3 text-sm text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer dark:border-slate-700 dark:text-gray-200 dark:hover:bg-slate-800"
              >
                {t("live_c2c.next")}
              </button>
            </div>
          </div>
        )}
      </section>
      <ConfirmationModal
        isOpen={disabledRetailerConfirmCount !== null && disabledRetailerConfirmCount > 0}
        onClose={() => setDisabledRetailerConfirmCount(null)}
        onConfirm={() => {
          setDisabledRetailerConfirmCount(null);
          void handleImport();
        }}
        title={t("live_c2c.disabled_retailer_title")}
        message={t("live_c2c.disabled_retailer_summary", {
          count: disabledRetailerConfirmCount ?? 0,
        })}
        confirmText={t("live_c2c.disabled_retailer_replace_confirm")}
        loading={importing}
        type="warning"
      >
        <div className="mt-4 w-full rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-left dark:border-amber-500/30 dark:bg-amber-500/10">
          <p className="text-sm font-semibold text-amber-900 dark:text-amber-200">
            {t("live_c2c.disabled_retailer_replace_title")}
          </p>
          <p className="mt-1 text-xs leading-relaxed text-amber-800 dark:text-amber-200/90">
            {t("live_c2c.disabled_retailer_replace_message")}
          </p>
        </div>
      </ConfirmationModal>
    </main>
  );
}
