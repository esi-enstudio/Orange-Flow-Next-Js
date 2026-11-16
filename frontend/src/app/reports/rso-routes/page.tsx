"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import apiClient from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { useLanguage } from "@/i18n/useLanguage";
import { cn } from "@/lib/utils";
import { toast } from "react-hot-toast";
import {
  ChevronDown,
  Download,
  Loader2,
  Package,
  Route as RouteIcon,
  Search,
  SlidersHorizontal,
  TrendingUp,
  Users,
  Wallet,
  X,
} from "lucide-react";
import { AccessDenied } from "@/components/ui/AccessDenied";
import PageGuideModal from "@/components/PageGuideModal";
import { DateRangePicker } from "@/components/date-picker";
import EntitySelector from "@/app/zoom-in/_components/EntitySelector";

interface ReportProduct {
  product_code: string;
  activations: number;
  amount: number;
}

interface ReportRow {
  employee_id: number | null;
  rso_name: string;
  rso_code: string | null;
  route_id: number;
  route_code: string;
  retailer_count: number;
  active_retailers: number;
  activations: number;
  amount: number;
  products: ReportProduct[];
}

interface ReportSummary {
  activations: number;
  amount: number;
  retailers: number;
  unassigned_activations: number;
  routes: number;
  no_route_activations: number;
}

interface Option {
  id: number | string;
  name: string;
  sublabel?: string;
  code?: string;
}

interface ReportFilters {
  from: string;
  to: string;
  rsoIds: string[];
  routeIds: string[];
  productCodes: string[];
}

function monthStart(): string {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

const defaultFilters: ReportFilters = {
  from: monthStart(),
  to: today(),
  rsoIds: [],
  routeIds: [],
  productCodes: [],
};

const money = (value: number) =>
  value.toLocaleString("en-US", { maximumFractionDigits: 2 });

export default function RsoRouteReportPage() {
  const router = useRouter();
  const { selectedHouse, hasPermission, loading: authLoading } = useAuth();
  const { t } = useLanguage();

  const [rows, setRows] = useState<ReportRow[]>([]);
  const [summary, setSummary] = useState<ReportSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<"primary" | "all">("primary");
  const [search, setSearch] = useState("");
  const [expandedKey, setExpandedKey] = useState<string | null>(null);

  const [applied, setApplied] = useState<ReportFilters>({ ...defaultFilters });
  const [draft, setDraft] = useState<ReportFilters>({ ...defaultFilters });
  const [filtersOpen, setFiltersOpen] = useState(false);

  const [options, setOptions] = useState<{
    rsos: Option[];
    routes: Option[];
    products: Option[];
  }>({ rsos: [], routes: [], products: [] });
  const [optionsLoading, setOptionsLoading] = useState(false);
  const [exporting, setExporting] = useState(false);

  const canExport = hasPermission("reports.download");
  const activeFilterCount =
    (applied.rsoIds.length ? 1 : 0) +
    (applied.routeIds.length ? 1 : 0) +
    (applied.productCodes.length ? 1 : 0);

  useEffect(() => {
    if (
      !authLoading &&
      !hasPermission("reports.view") &&
      !hasPermission("activations.view")
    ) {
      const timer = setTimeout(() => router.push("/"), 5000);
      return () => clearTimeout(timer);
    }
  }, [authLoading, hasPermission, router]);

  const houseHeader = selectedHouse
    ? { "X-House-ID": String(selectedHouse.id) }
    : {};

  useEffect(() => {
    if (authLoading) return;
    if (!hasPermission("reports.view") && !hasPermission("activations.view")) return;
    let cancelled = false;
    (async () => {
      setOptionsLoading(true);
      try {
        const res = await apiClient.get("reports/rso-routes/options", {
          headers: houseHeader,
        });
        if (cancelled) return;
        const data = res.data?.data || {};
        setOptions({
          rsos: data.rsos || [],
          routes: data.routes || [],
          products: data.products || [],
        });
      } catch (err) {
        console.error(err);
        if (!cancelled) setOptions({ rsos: [], routes: [], products: [] });
      } finally {
        if (!cancelled) setOptionsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, selectedHouse?.id]);

  const fetchReport = useCallback(async () => {
    if (!applied.from || !applied.to) return;
    setLoading(true);
    try {
      const params: Record<string, string> = {
        from_date: applied.from,
        to_date: applied.to,
        mode,
      };
      if (applied.rsoIds.length) params.rso_ids = applied.rsoIds.join(",");
      if (applied.routeIds.length) params.route_ids = applied.routeIds.join(",");
      if (applied.productCodes.length)
        params.product_codes = applied.productCodes.join(",");
      const res = await apiClient.get("reports/rso-routes", {
        params,
        headers: houseHeader,
      });
      setRows(res.data?.data || []);
      setSummary(res.data?.summary || null);
    } catch (err) {
      console.error(err);
      toast.error(t("rso_routes.toast_load_failed"));
      setRows([]);
      setSummary(null);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applied, mode, selectedHouse?.id, t]);

  useEffect(() => {
    if (authLoading) return;
    if (!hasPermission("reports.view") && !hasPermission("activations.view")) return;
    fetchReport();
  }, [fetchReport, authLoading, hasPermission]);

  const handleExport = async () => {
    setExporting(true);
    try {
      const params: Record<string, string> = {
        from_date: applied.from,
        to_date: applied.to,
        mode,
      };
      if (applied.rsoIds.length) params.rso_ids = applied.rsoIds.join(",");
      if (applied.routeIds.length) params.route_ids = applied.routeIds.join(",");
      if (applied.productCodes.length)
        params.product_codes = applied.productCodes.join(",");
      const res = await apiClient.get("reports/rso-routes/export", {
        params,
        responseType: "blob",
        headers: houseHeader,
      });
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const link = document.createElement("a");
      link.href = url;
      link.download = "rso_route_report.xlsx";
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      console.error(err);
      toast.error(t("rso_routes.toast_export_failed"));
    } finally {
      setExporting(false);
    }
  };

  const visibleRows = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return rows;
    return rows.filter(
      (row) =>
        (row.rso_name || "").toLowerCase().includes(term) ||
        row.route_code.toLowerCase().includes(term)
    );
  }, [rows, search]);

  if (authLoading) {
    return (
      <div className="p-6 space-y-4">
        <div className="h-8 w-56 rounded-lg bg-gray-200 dark:bg-slate-700 animate-pulse" />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-24 rounded-2xl bg-gray-100 dark:bg-slate-800 animate-pulse" />
          ))}
        </div>
        <div className="h-72 rounded-2xl bg-gray-100 dark:bg-slate-800 animate-pulse" />
      </div>
    );
  }

  if (!hasPermission("reports.view") && !hasPermission("activations.view")) {
    return <AccessDenied />;
  }

  return (
    <div className="p-4 sm:p-6 space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
              {t("rso_routes.title")}
            </h1>
            <PageGuideModal pageKey="rso_routes" />
          </div>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            {t("rso_routes.description")}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="inline-flex rounded-xl border border-gray-200 dark:border-slate-700 overflow-hidden">
            {(["primary", "all"] as const).map((value) => (
              <button
                key={value}
                onClick={() => setMode(value)}
                className={cn(
                  "px-3.5 py-2.5 text-xs font-bold transition-colors cursor-pointer",
                  mode === value
                    ? "bg-primary-600 text-white"
                    : "bg-white dark:bg-slate-900 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-slate-800"
                )}
              >
                {value === "primary"
                  ? t("rso_routes.mode_primary")
                  : t("rso_routes.mode_all")}
              </button>
            ))}
          </div>
          {canExport && (
            <button
              onClick={handleExport}
              disabled={exporting}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border border-gray-200 dark:border-slate-700 text-sm font-semibold text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-slate-800 transition-colors cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
            >
              {exporting ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Download className="w-4 h-4" />
              )}
              {t("rso_routes.export")}
            </button>
          )}
        </div>
      </div>

      <p className="text-[11px] text-gray-500 dark:text-gray-400">
        {t("rso_routes.mode_hint")}
      </p>

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <SummaryCard
          icon={<TrendingUp className="w-4 h-4" />}
          label={t("rso_routes.summary_activations")}
          value={money(summary?.activations ?? 0)}
        />
        <SummaryCard
          icon={<Wallet className="w-4 h-4" />}
          label={t("rso_routes.summary_amount")}
          value={money(summary?.amount ?? 0)}
        />
        <SummaryCard
          icon={<Users className="w-4 h-4" />}
          label={t("rso_routes.summary_retailers")}
          value={money(summary?.retailers ?? 0)}
        />
        <SummaryCard
          icon={<RouteIcon className="w-4 h-4" />}
          label={t("rso_routes.summary_routes")}
          value={money(summary?.routes ?? 0)}
        />
        <SummaryCard
          icon={<Package className="w-4 h-4" />}
          label={t("rso_routes.summary_no_route")}
          value={money(summary?.no_route_activations ?? 0)}
          hint={`${t("rso_routes.summary_unassigned")}: ${money(
            summary?.unassigned_activations ?? 0
          )}`}
        />
      </div>

      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-gray-100 dark:border-slate-800 shadow-sm overflow-hidden">
        <div className="p-4 border-b border-gray-50 dark:border-slate-800 flex items-center gap-3">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("rso_routes.search_placeholder")}
              className="w-full pl-10 pr-4 py-2.5 bg-gray-50 dark:bg-slate-800 border-none rounded-xl text-sm focus:ring-2 focus:ring-primary-500 outline-none dark:text-gray-100"
            />
          </div>
          <button
            type="button"
            onClick={() => {
              setDraft({ ...applied });
              setFiltersOpen(true);
            }}
            title={t("rso_routes.filter_title")}
            aria-label={t("rso_routes.filter_title")}
            className="relative p-2.5 rounded-xl border border-gray-200 dark:border-slate-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-slate-800 transition-colors cursor-pointer"
          >
            <SlidersHorizontal className="w-4 h-4" />
            {activeFilterCount > 0 && (
              <span className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] px-1 rounded-full bg-primary-600 text-white text-[10px] font-bold flex items-center justify-center">
                {activeFilterCount}
              </span>
            )}
          </button>
        </div>

        {loading ? (
          <div className="divide-y divide-gray-50 dark:divide-slate-800">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex items-center gap-4 px-6 py-5 animate-pulse">
                <div className="space-y-2 flex-1">
                  <div className="h-3 w-40 bg-gray-200 dark:bg-slate-700 rounded-md" />
                  <div className="h-2.5 w-28 bg-gray-100 dark:bg-slate-800 rounded-md" />
                </div>
                <div className="hidden sm:block w-24 h-3 bg-gray-200 dark:bg-slate-700 rounded-md" />
                <div className="w-16 h-6 bg-gray-200 dark:bg-slate-700 rounded-full" />
              </div>
            ))}
          </div>
        ) : visibleRows.length === 0 ? (
          <div className="py-20 text-center">
            <RouteIcon className="w-12 h-12 text-gray-200 dark:text-gray-700 mx-auto mb-4" />
            <p className="text-gray-500 dark:text-gray-400 font-medium">
              {t("rso_routes.no_data")}
            </p>
          </div>
        ) : (
          <>
            <div className="hidden lg:block overflow-x-auto">
              <table className="w-full text-left min-w-[960px]">
                <thead>
                  <tr className="bg-gray-50/50 dark:bg-slate-800/50 text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-widest border-b border-gray-50 dark:border-slate-800">
                    <th className="px-6 py-4">{t("rso_routes.table_rso")}</th>
                    <th className="px-6 py-4">{t("rso_routes.table_route")}</th>
                    <th className="px-6 py-4 text-right">{t("rso_routes.table_retailers")}</th>
                    <th className="px-6 py-4 text-right">{t("rso_routes.table_active_retailers")}</th>
                    <th className="px-6 py-4 text-right">{t("rso_routes.table_activations")}</th>
                    <th className="px-6 py-4 text-right">{t("rso_routes.table_amount")}</th>
                    <th className="px-6 py-4">{t("rso_routes.table_products")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50 dark:divide-slate-800">
                  {visibleRows.map((row, index) => (
                    <tr
                      key={`${row.employee_id ?? "none"}-${row.route_id}-${index}`}
                      className="hover:bg-gray-50/30 dark:hover:bg-slate-800/30 transition-colors"
                    >
                      <td className="px-2 py-1">
                        <p className="font-medium text-sm text-gray-900 dark:text-gray-100">
                          {row.rso_name}
                        </p>
                        {row.rso_code && (
                          <p className="text-[11px] text-gray-500 dark:text-gray-400">
                            {row.rso_code}
                          </p>
                        )}
                      </td>
                      <td className="px-2 py-1">
                        <span className="font-mono text-xs text-gray-600 dark:text-gray-300">
                          {row.route_code}
                        </span>
                      </td>
                      <td className="px-2 py-1 text-right text-sm text-gray-700 dark:text-gray-200">
                        {row.retailer_count}
                      </td>
                      <td className="px-2 py-1 text-right text-sm text-gray-700 dark:text-gray-200">
                        {row.active_retailers}
                      </td>
                      <td className="px-2 py-1 text-right">
                        <span className="text-xs font-bold text-gray-800 dark:text-gray-100 bg-gray-50 dark:bg-slate-800 px-2.5 py-1 rounded-lg">
                          {row.activations}
                        </span>
                      </td>
                      <td className="px-2 py-1 text-right text-sm text-gray-700 dark:text-gray-200">
                        {money(row.amount)}
                      </td>
                      <td className="px-2 py-1">
                        <p className="text-[11px] text-gray-500 dark:text-gray-400 max-w-[240px] truncate">
                          {row.products
                            .slice(0, 3)
                            .map((p) => `${p.product_code} (${p.activations})`)
                            .join(", ") || "—"}
                        </p>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="lg:hidden divide-y divide-gray-50 dark:divide-slate-800">
              {visibleRows.map((row, index) => {
                const key = `${row.employee_id ?? "none"}-${row.route_id}-${index}`;
                return (
                  <div key={key}>
                    <button
                      onClick={() =>
                        setExpandedKey((prev) => (prev === key ? null : key))
                      }
                      className="w-full flex items-center gap-3 px-5 py-4 text-left cursor-pointer"
                    >
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-bold text-gray-900 dark:text-gray-100 truncate">
                          {row.rso_name}
                        </p>
                        <p className="text-[11px] text-gray-500 dark:text-gray-400 font-mono truncate">
                          {row.route_code}
                        </p>
                      </div>
                      <span className="text-xs font-bold text-gray-800 dark:text-gray-100 bg-gray-50 dark:bg-slate-800 px-2.5 py-1 rounded-lg shrink-0">
                        {row.activations}
                      </span>
                      <ChevronDown
                        className={cn(
                          "w-4 h-4 text-gray-400 transition-transform",
                          expandedKey === key && "rotate-180"
                        )}
                      />
                    </button>
                    {expandedKey === key && (
                      <div className="px-5 pb-4 pt-1 space-y-2">
                        <DetailRow
                          label={t("rso_routes.table_retailers")}
                          value={String(row.retailer_count)}
                        />
                        <DetailRow
                          label={t("rso_routes.table_active_retailers")}
                          value={String(row.active_retailers)}
                        />
                        <DetailRow
                          label={t("rso_routes.table_amount")}
                          value={money(row.amount)}
                        />
                        {row.products.map((product) => (
                          <DetailRow
                            key={product.product_code}
                            label={product.product_code}
                            value={`${product.activations} · ${money(product.amount)}`}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>

      <AnimatePresence>
        {filtersOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setFiltersOpen(false)}
              className="fixed inset-0 z-[100] bg-black/30 backdrop-blur-sm"
            />
            <motion.aside
              initial={{ x: "100%" }}
              animate={{ x: 0 }}
              exit={{ x: "100%" }}
              transition={{ type: "spring", damping: 25, stiffness: 200 }}
              role="dialog"
              aria-modal="true"
              aria-label={t("rso_routes.filter_title")}
              className="fixed inset-y-0 right-0 z-[101] w-full sm:max-w-md bg-white dark:bg-slate-900 shadow-2xl flex flex-col"
            >
              <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-gray-100 dark:border-slate-800">
                <h2 className="text-base font-bold text-gray-900 dark:text-gray-100">
                  {t("rso_routes.filter_title")}
                </h2>
                <button
                  type="button"
                  onClick={() => setFiltersOpen(false)}
                  aria-label={t("common.close")}
                  className="p-2 rounded-lg text-gray-400 hover:bg-gray-100 dark:hover:bg-slate-800 cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
                <DateRangePicker
                  label={t("rso_routes.filter_date_range")}
                  value={{ from: draft.from || null, to: draft.to || null }}
                  onChange={(range) =>
                    setDraft((f) => ({
                      ...f,
                      from: range.from ?? "",
                      to: range.to ?? "",
                    }))
                  }
                />

                <EntitySelector
                  label={t("rso_routes.filter_select_rso")}
                  items={options.rsos.map((option) => ({
                    id: String(option.id),
                    label: option.name,
                    sublabel: option.sublabel,
                  }))}
                  selectedIds={draft.rsoIds}
                  onChange={(ids) =>
                    setDraft((f) => ({ ...f, rsoIds: ids.map(String) }))
                  }
                  placeholder={t("rso_routes.select_rso_placeholder")}
                  searchPlaceholder={t("rso_routes.search_placeholder")}
                  emptyMessage={
                    optionsLoading ? t("rso_routes.loading") : t("rso_routes.no_data")
                  }
                  noResultsMessage={t("rso_routes.no_data")}
                  selectAllLabel={t("common.select_all")}
                  clearLabel={t("common.clear")}
                  selectedLabel={t("rso_routes.selected")}
                />

                <EntitySelector
                  label={t("rso_routes.filter_select_route")}
                  items={options.routes.map((option) => ({
                    id: String(option.id),
                    label: (option.code as string) || option.name,
                    sublabel: (option.code as string) ? option.name : undefined,
                  }))}
                  selectedIds={draft.routeIds}
                  onChange={(ids) =>
                    setDraft((f) => ({ ...f, routeIds: ids.map(String) }))
                  }
                  placeholder={t("rso_routes.select_route_placeholder")}
                  searchPlaceholder={t("rso_routes.search_placeholder")}
                  emptyMessage={
                    optionsLoading ? t("rso_routes.loading") : t("rso_routes.no_data")
                  }
                  noResultsMessage={t("rso_routes.no_data")}
                  selectAllLabel={t("common.select_all")}
                  clearLabel={t("common.clear")}
                  selectedLabel={t("rso_routes.selected")}
                />

                <EntitySelector
                  label={t("rso_routes.filter_select_product")}
                  items={options.products.map((option) => ({
                    id: String(option.code),
                    label: String(option.code),
                  }))}
                  selectedIds={draft.productCodes}
                  onChange={(ids) =>
                    setDraft((f) => ({ ...f, productCodes: ids.map(String) }))
                  }
                  placeholder={t("rso_routes.select_product_placeholder")}
                  searchPlaceholder={t("rso_routes.search_placeholder")}
                  emptyMessage={
                    optionsLoading ? t("rso_routes.loading") : t("rso_routes.no_data")
                  }
                  noResultsMessage={t("rso_routes.no_data")}
                  selectAllLabel={t("common.select_all")}
                  clearLabel={t("common.clear")}
                  selectedLabel={t("rso_routes.selected")}
                />
              </div>

              <div className="px-5 py-4 border-t border-gray-100 dark:border-slate-800 space-y-2">
                <button
                  onClick={() => {
                    setDraft({ ...defaultFilters });
                    setApplied({ ...defaultFilters });
                    setFiltersOpen(false);
                  }}
                  className="w-full px-4 py-2.5 rounded-xl text-sm font-semibold text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-slate-800 cursor-pointer"
                >
                  {t("rso_routes.filter_clear_all")}
                </button>
                <button
                  onClick={() => {
                    if (!draft.from || !draft.to) return;
                    setApplied({ ...draft });
                    setFiltersOpen(false);
                  }}
                  disabled={!draft.from || !draft.to}
                  className={cn(
                    "w-full px-4 py-2.5 rounded-xl text-sm font-bold transition-colors",
                    draft.from && draft.to
                      ? "bg-primary-600 text-white hover:bg-primary-700 cursor-pointer"
                      : "bg-gray-200 dark:bg-slate-700 text-gray-500 dark:text-gray-400 cursor-not-allowed"
                  )}
                >
                  {t("rso_routes.filter_apply")}
                </button>
              </div>
            </motion.aside>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}

function SummaryCard({
  icon,
  label,
  value,
  hint,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="bg-white dark:bg-slate-900 rounded-2xl border border-gray-100 dark:border-slate-800 shadow-sm px-4 py-3">
      <div className="flex items-center gap-2 text-gray-400 dark:text-gray-500">
        {icon}
        <span className="text-[10px] font-bold uppercase tracking-widest truncate">
          {label}
        </span>
      </div>
      <p className="text-xl font-bold text-gray-900 dark:text-gray-100 mt-1">{value}</p>
      {hint && <p className="text-[11px] text-gray-500 dark:text-gray-400">{hint}</p>}
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <span className="text-xs text-gray-500 dark:text-gray-400 shrink-0">{label}</span>
      <span className="text-sm font-medium text-gray-900 dark:text-gray-100">{value}</span>
    </div>
  );
}
