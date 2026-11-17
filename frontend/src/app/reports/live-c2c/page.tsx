"use client";

import { useEffect, useRef, useState, type ChangeEvent } from "react";
import PageGuideModal from "@/components/PageGuideModal";
import { AccessDenied } from "@/components/ui/AccessDenied";
import { useAuth } from "@/context/AuthContext";
import { useLanguage } from "@/i18n/useLanguage";
import apiClient from "@/lib/api";
import {
  LIVE_C2C_COLUMNS,
  LiveC2CWorkbookError,
  parseLiveC2CWorkbook,
  validateLiveC2CFile,
  type LiveC2CFileErrorCode,
  type LiveC2CWorkbookErrorCode,
} from "@/lib/live-c2c-import";
import { initialLiveC2CHouseId } from "@/lib/live-c2c-house-selection";

type UploadErrorCode =
  | LiveC2CFileErrorCode
  | LiveC2CWorkbookErrorCode
  | "house_required"
  | "upload_failed";

interface AccessibleHouse {
  id: number;
  name: string;
  code: string;
}

export default function LiveC2CReportPage() {
  const { hasPermission, loading: authLoading } = useAuth();
  const { t } = useLanguage();
  const canView = hasPermission("reports.view") || hasPermission("itopup.view");
  const [houses, setHouses] = useState<AccessibleHouse[]>([]);
  const [housesLoading, setHousesLoading] = useState(true);
  const [housesError, setHousesError] = useState(false);
  const [selectedHouseId, setSelectedHouseId] = useState<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<string[][]>([]);
  const [fileName, setFileName] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);
  const [uploadError, setUploadError] = useState<UploadErrorCode | null>(null);
  const selectedHouse = houses.find((house) => house.id === selectedHouseId) ?? null;

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

  const handleFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;
    if (!selectedHouseId) {
      setUploadError("house_required");
      return;
    }

    setUploadError(null);
    const validationError = validateLiveC2CFile(file);
    if (validationError) {
      setUploadError(validationError);
      return;
    }

    setProcessing(true);
    try {
      const nextRows = await parseLiveC2CWorkbook(await file.arrayBuffer());
      setRows(nextRows);
      setFileName(file.name);
    } catch (error) {
      setUploadError(
        error instanceof LiveC2CWorkbookError ? error.code : "upload_failed",
      );
    } finally {
      setProcessing(false);
    }
  };

  const handleHouseChange = (event: ChangeEvent<HTMLSelectElement>) => {
    const value = event.currentTarget.value;
    const nextHouseId = value ? Number(value) : null;
    if (nextHouseId !== null && !Number.isSafeInteger(nextHouseId)) return;
    if (nextHouseId === selectedHouseId) return;

    setSelectedHouseId(nextHouseId);
    setRows([]);
    setFileName(null);
    setUploadError(null);
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

      <section className="mt-5 min-w-0 space-y-3">
        <div className="flex flex-wrap items-center gap-3">
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
            <p className="rounded-xl bg-gray-100 px-3 py-2 text-sm text-gray-700 dark:bg-slate-800 dark:text-gray-200">
              <span className="font-semibold">{t("live_c2c.house_label")}: </span>
              {selectedHouse?.name}
            </p>
          ) : (
            <label className="block w-full text-sm font-bold text-gray-700 sm:max-w-xs dark:text-gray-300">
              {t("live_c2c.house_label")}
              <select
                value={selectedHouseId ?? ""}
                onChange={handleHouseChange}
                disabled={processing}
                className="mt-1.5 h-11 w-full cursor-pointer rounded-xl border border-gray-200 bg-white px-3 text-sm font-normal text-gray-900 outline-none focus:ring-2 focus:ring-primary-500 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-gray-100"
              >
                <option value="">{t("live_c2c.select_house")}</option>
                {houses.map((house) => (
                  <option key={house.id} value={house.id}>
                    {house.name}{house.code ? ` (${house.code})` : ""}
                  </option>
                ))}
              </select>
            </label>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            aria-label={t("live_c2c.upload_button")}
            onChange={handleFileChange}
            className="sr-only"
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={processing || housesLoading || housesError || !selectedHouseId}
            className="inline-flex h-11 items-center justify-center rounded-xl bg-primary-600 px-4 text-sm font-semibold text-white transition-colors hover:bg-primary-700 disabled:cursor-not-allowed disabled:opacity-60 cursor-pointer"
          >
            {t(processing ? "live_c2c.processing" : "live_c2c.upload_button")}
          </button>
          {fileName && (
            <span className="min-w-0 truncate text-sm text-gray-600 dark:text-gray-300">
              {fileName}
            </span>
          )}
          {rows.length > 0 && (
            <span className="text-sm text-gray-500 dark:text-gray-400">
              {t("live_c2c.row_count", { count: rows.length })}
            </span>
          )}
        </div>

        {uploadError && (
          <p
            role="alert"
            className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300"
          >
            {t(`live_c2c.errors.${uploadError}`)}
          </p>
        )}

        <div
          role="region"
          aria-label={t("live_c2c.title")}
          tabIndex={0}
          className="max-w-full overflow-x-auto rounded-xl border border-gray-200 dark:border-slate-700"
        >
          <table className="min-w-max border-collapse bg-white text-left text-sm text-gray-800 dark:bg-slate-900 dark:text-gray-100">
            <thead className="bg-gray-50 dark:bg-slate-800">
              <tr>
                {LIVE_C2C_COLUMNS.map((column) => (
                  <th
                    key={column.key}
                    scope="col"
                    className="whitespace-nowrap border border-gray-200 px-3 py-2 font-semibold dark:border-slate-700"
                  >
                    {t(`live_c2c.columns.${column.key}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td
                    colSpan={LIVE_C2C_COLUMNS.length}
                    className="border border-gray-200 px-2 py-1 text-center text-gray-500 dark:border-slate-700 dark:text-gray-400"
                  >
                    {t("live_c2c.empty_state")}
                  </td>
                </tr>
              ) : (
                rows.map((row, rowIndex) => (
                  <tr
                    key={`row-${rowIndex}`}
                    className="even:bg-gray-50 dark:even:bg-slate-800/50"
                  >
                    {row.map((value, columnIndex) => (
                      <td
                        key={`${rowIndex}-${columnIndex}`}
                        className="whitespace-nowrap border border-gray-200 px-2 py-1 dark:border-slate-700"
                      >
                        {value}
                      </td>
                    ))}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
