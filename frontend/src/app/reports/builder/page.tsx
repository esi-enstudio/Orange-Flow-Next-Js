"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import { AnimatePresence, motion } from "framer-motion";
import { SlidersHorizontal, X } from "lucide-react";
import { toast } from "react-hot-toast";

import { AccessDenied } from "@/components/ui/AccessDenied";
import PageGuideModal from "@/components/PageGuideModal";
import apiClient from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { useLanguage } from "@/i18n/useLanguage";
import ConfigPanel from "./_components/ConfigPanel";
import PreviewPanel from "./_components/PreviewPanel";
import type {
  ConfigState,
  FilterOptions,
  FilterType,
  QueryResult,
  ReportOptions,
} from "./_components/types";

function localDate(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function initialConfig(): ConfigState {
  const today = new Date();
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
  return {
    metric: "",
    groupBy: "",
    dateFrom: localDate(monthStart),
    dateTo: localDate(today),
    targetSource: "",
    targetValue: null,
    sortField: "achievement",
    sortOrder: "desc",
    filters: {
      retailer_ids: [],
      employee_ids: [],
      supervisor_ids: [],
      route_codes: [],
    },
  };
}

async function apiErrorMessage(error: unknown, fallback: string) {
  if (!axios.isAxiosError(error)) return fallback;
  let data = error.response?.data;
  if (data instanceof Blob) {
    try {
      data = JSON.parse(await data.text());
    } catch {
      return fallback;
    }
  }
  if (typeof data?.detail === "string") return data.detail;
  if (typeof data?.error?.message === "string") return data.error.message;
  if (typeof error.message === "string") return error.message;
  return fallback;
}

const EMPTY_FILTER_OPTIONS: FilterOptions = {
  retailer: [],
  employee: [],
  supervisor: [],
  route: [],
};

export default function ReportBuilderPage() {
  const { selectedHouse, user, hasPermission, loading: authLoading } = useAuth();
  const { t } = useLanguage();
  const canView = hasPermission("report_builder.view");
  const canExport = hasPermission("report_builder.export");
  const selectedHouseId = selectedHouse?.id ?? null;
  const [options, setOptions] = useState<ReportOptions | null>(null);
  const [config, setConfig] = useState<ConfigState>(initialConfig);
  const [filterOptions, setFilterOptions] = useState<FilterOptions>(EMPTY_FILTER_OPTIONS);
  const [result, setResult] = useState<QueryResult | null>(null);
  const [queryError, setQueryError] = useState<string | null>(null);
  const [optionsLoading, setOptionsLoading] = useState(false);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [page, setPage] = useState(1);
  const [mobileConfigOpen, setMobileConfigOpen] = useState(false);
  const [retryToken, setRetryToken] = useState(0);
  const filterTimers = useRef<Partial<Record<FilterType, ReturnType<typeof setTimeout>>>>({});
  const filterControllers = useRef<Partial<Record<FilterType, AbortController>>>({});

  const headers = useMemo(
    () => selectedHouseId ? { "X-House-ID": String(selectedHouseId) } : {},
    [selectedHouseId],
  );
  const selectedHouseName = user?.houses?.find((house) => house.id === selectedHouseId)?.name;

  useEffect(() => {
    if (authLoading || !canView || !selectedHouseId) return;
    const controller = new AbortController();
    let active = true;
    setOptions(null);
    setOptionsLoading(true);
    setQueryError(null);
    apiClient.get<ReportOptions>("v1/report-builder/options", {
      headers,
      signal: controller.signal,
    }).then(({ data }) => {
      if (active) setOptions(data);
    })
      .catch(async (error: unknown) => {
        if (!axios.isCancel(error)) {
          setQueryError(await apiErrorMessage(error, t("report_builder.query_error")));
        }
      }).finally(() => {
        if (active) setOptionsLoading(false);
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [authLoading, canView, selectedHouseId, headers, t, retryToken]);

  useEffect(() => {
    if (!options) return;
    setConfig((current) => {
      const metric = options.metrics.find((item) => item.key === current.metric) ?? options.metrics[0];
      if (!metric) return current;
      const targetSource = metric.target_sources.includes(current.targetSource)
        ? current.targetSource
        : metric.target_sources[0] ?? "none";
      const dimensions = options.matrix[metric.key]?.[targetSource] ?? [];
      const groupBy = dimensions.includes(current.groupBy) ? current.groupBy : dimensions[0] ?? "";
      return { ...current, metric: metric.key, targetSource, groupBy };
    });
  }, [options]);

  const requestFilterOptions = useCallback((type: FilterType, search: string) => {
    const existingTimer = filterTimers.current[type];
    if (existingTimer) clearTimeout(existingTimer);
    filterControllers.current[type]?.abort();
    filterTimers.current[type] = setTimeout(() => {
      if (!selectedHouseId) return;
      const controller = new AbortController();
      filterControllers.current[type] = controller;
      apiClient.get("v1/report-builder/filter-options", {
        params: { type, search: search || undefined },
        headers,
        signal: controller.signal,
      }).then(({ data }) => {
        setFilterOptions((current) => ({ ...current, [type]: data }));
      }).catch(async (error: unknown) => {
        if (!axios.isCancel(error)) {
          toast.error(await apiErrorMessage(error, t("report_builder.query_error")));
        }
      });
    }, search ? 250 : 0);
  }, [headers, selectedHouseId, t]);

  useEffect(() => {
    if (!options || !selectedHouseId) return;
    (["retailer", "employee", "supervisor", "route"] as const).forEach((type) => {
      requestFilterOptions(type, "");
    });
  }, [options, selectedHouseId, requestFilterOptions]);

  const queryPayload = useMemo(() => ({
    metric: config.metric,
    date_from: config.dateFrom,
    date_to: config.dateTo,
    group_by: [config.groupBy],
    filters: config.filters,
    target: {
      source: config.targetSource,
      value: config.targetSource === "custom" ? config.targetValue : null,
    },
    sort: { field: config.sortField, order: config.sortOrder },
    page,
    per_page: 50,
  }), [config, page]);

  useEffect(() => {
    if (
      authLoading || !canView || !selectedHouseId || !options ||
      !queryPayload.metric || !queryPayload.group_by[0] ||
      !queryPayload.date_from || !queryPayload.date_to ||
      (queryPayload.target.source === "custom" && (
        queryPayload.target.value == null || !Number.isFinite(queryPayload.target.value) ||
        queryPayload.target.value < 0
      ))
    ) return;

    const controller = new AbortController();
    let active = true;
    setQueryError(null);
    const slowQuery = setTimeout(() => {
      if (active) setLoading(true);
    }, 200);
    const debounce = setTimeout(() => {
      apiClient.post<QueryResult>("v1/report-builder/query", queryPayload, {
        headers,
        signal: controller.signal,
      }).then(({ data }) => {
        if (active) setResult(data);
      }).catch(async (error: unknown) => {
        if (active && !axios.isCancel(error)) {
          setQueryError(await apiErrorMessage(error, t("report_builder.query_error")));
        }
      }).finally(() => {
        clearTimeout(slowQuery);
        if (active) setLoading(false);
      });
    }, 400);
    return () => {
      active = false;
      clearTimeout(debounce);
      clearTimeout(slowQuery);
      controller.abort();
      setLoading(false);
    };
  }, [authLoading, canView, selectedHouseId, options, queryPayload, headers, t, retryToken]);

  useEffect(() => () => {
    Object.values(filterTimers.current).forEach((timer) => timer && clearTimeout(timer));
    Object.values(filterControllers.current).forEach((controller) => controller?.abort());
  }, []);

  const changeConfig = useCallback((patch: Partial<ConfigState>) => {
    setQueryError(null);
    setConfig((current) => {
      const next = { ...current, ...patch };
      if (options && (patch.metric !== undefined || patch.targetSource !== undefined)) {
        const metric = options.metrics.find((item) => item.key === next.metric);
        const dimensions = options.matrix[next.metric]?.[next.targetSource] ?? [];
        if (metric && !dimensions.includes(next.groupBy)) {
          next.groupBy = dimensions[0] ?? "";
        }
        if (metric && !metric.target_sources.includes(next.targetSource)) {
          next.targetSource = metric.target_sources[0] ?? "none";
          const fallbackDimensions = options.matrix[next.metric]?.[next.targetSource] ?? [];
          next.groupBy = fallbackDimensions.includes(current.groupBy)
            ? current.groupBy
            : fallbackDimensions[0] ?? "";
        }
      }
      return next;
    });
    setPage(1);
  }, [options]);

  const handleSort = useCallback((field: string) => {
    setConfig((current) => ({
      ...current,
      sortField: current.sortField === field
        ? current.sortOrder === "asc" ? "desc" : "asc"
        : field,
      sortOrder: current.sortField === field ? (current.sortOrder === "asc" ? "desc" : "asc") : "desc",
    }));
    setPage(1);
  }, []);

  const exportReport = useCallback(async () => {
    if (
      !canExport || !selectedHouseId || !options || !queryPayload.metric ||
      (queryPayload.target.source === "custom" && (
        queryPayload.target.value == null || !Number.isFinite(queryPayload.target.value) ||
        queryPayload.target.value < 0
      ))
    ) return;
    setExporting(true);
    try {
      const response = await apiClient.post<Blob>(
        "v1/report-builder/export",
        { ...queryPayload, page: 1 },
        { headers, responseType: "blob" },
      );
      const blobUrl = URL.createObjectURL(response.data);
      const anchor = document.createElement("a");
      const contentDisposition = response.headers["content-disposition"] as string | undefined;
      const filename = contentDisposition?.match(/filename="([^"]+)"/i)?.[1]
        ?? `report_builder_${config.dateFrom}_${config.dateTo}.xlsx`;
      anchor.href = blobUrl;
      anchor.download = filename;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
      toast.success(t("report_builder.export"));
    } catch (error) {
      toast.error(await apiErrorMessage(error, t("report_builder.export_error")));
    } finally {
      setExporting(false);
    }
  }, [canExport, selectedHouseId, options, queryPayload, headers, config.dateFrom, config.dateTo, t]);

  const configPanel = (
    <ConfigPanel
      options={options}
      value={config}
      onChange={changeConfig}
      filterOptions={filterOptions}
      onFilterSearch={requestFilterOptions}
      onExport={exportReport}
      canExport={canExport}
      exporting={exporting}
    />
  );

  if (authLoading) {
    return (
      <div className="mx-auto max-w-[1600px] space-y-4 p-4 sm:p-6">
        <div className="h-8 w-56 animate-pulse rounded-lg bg-gray-200 dark:bg-slate-700" />
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
          <div className="h-[520px] animate-pulse rounded-2xl bg-gray-100 dark:bg-slate-800" />
          <div className="h-[520px] animate-pulse rounded-2xl bg-gray-100 dark:bg-slate-800" />
        </div>
      </div>
    );
  }
  if (!canView) return <AccessDenied />;

  return (
    <main className="mx-auto min-h-screen max-w-[1600px] p-4 pb-8 sm:p-6">
      <header className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <div className="min-w-0">
            <h1 className="truncate text-2xl font-bold text-gray-900 dark:text-gray-100">
              {t("report_builder.title")}
            </h1>
          </div>
          <PageGuideModal pageKey="report_builder" />
        </div>
        <div className="flex items-center gap-2">
          {selectedHouseId && (
            <span className="rounded-full bg-gray-100 px-3 py-1.5 text-xs font-medium text-gray-600 dark:bg-slate-800 dark:text-gray-300">
              {selectedHouseName || t("report_builder.house_selected")}
            </span>
          )}
          <button
            type="button"
            onClick={() => setMobileConfigOpen(true)}
            aria-label={t("report_builder.config_title")}
            className="inline-flex h-11 items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 text-sm font-semibold text-gray-700 cursor-pointer xl:hidden dark:border-slate-800 dark:bg-slate-900 dark:text-gray-200"
          >
            <SlidersHorizontal className="h-4 w-4" />
            {t("report_builder.configure")}
          </button>
        </div>
      </header>
      <p className="mb-5 max-w-3xl text-sm text-gray-500 dark:text-gray-400">
        {t("report_builder.subtitle")}
      </p>

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <section className="min-w-0 space-y-4">
          {selectedHouseId ? (
            <PreviewPanel
              result={result}
              loading={optionsLoading || loading}
              error={queryError}
              sort={config}
              onSort={handleSort}
              page={page}
              onPage={setPage}
              onRetry={() => setRetryToken((token) => token + 1)}
            />
          ) : (
            <p role="alert" className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
              {t("report_builder.house_required")}
            </p>
          )}
        </section>
        <aside className="hidden xl:sticky xl:top-4 xl:block">{configPanel}</aside>
      </div>

      <AnimatePresence>
        {mobileConfigOpen && (
          <>
            <motion.button
              type="button"
              aria-label={t("report_builder.close")}
              onClick={() => setMobileConfigOpen(false)}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-[100] cursor-pointer border-0 bg-black/30 p-0 backdrop-blur-sm xl:hidden"
            />
            <motion.aside
              initial={{ x: "100%" }}
              animate={{ x: 0 }}
              exit={{ x: "100%" }}
              transition={{ type: "spring", damping: 25, stiffness: 200 }}
              className="fixed inset-y-0 right-0 z-[101] flex w-full flex-col overflow-y-auto bg-gray-50 p-4 shadow-2xl dark:bg-slate-950 sm:max-w-md xl:hidden"
              aria-label={t("report_builder.config_title")}
            >
              <div className="mb-4 flex min-h-11 items-center justify-between">
                <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">
                  {t("report_builder.config_title")}
                </h2>
                <button
                  type="button"
                  title={t("report_builder.close")}
                  aria-label={t("report_builder.close")}
                  onClick={() => setMobileConfigOpen(false)}
                  className="inline-flex h-11 w-11 items-center justify-center rounded-xl text-gray-500 hover:bg-gray-100 cursor-pointer dark:text-gray-300 dark:hover:bg-slate-800"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
              {configPanel}
            </motion.aside>
          </>
        )}
      </AnimatePresence>
    </main>
  );
}
