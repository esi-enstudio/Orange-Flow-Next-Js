"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { SlidersHorizontal, X } from "lucide-react";

import EntitySelector, { type SelectorItem } from "../../../zoom-in/_components/EntitySelector";
import { DateRangePicker } from "@/components/date-picker";
import { useLanguage } from "@/i18n/useLanguage";
import type {
  ConfigState,
  FilterOptions,
  FilterType,
  ReportOptions,
  ReportFilters,
} from "./types";

interface ConfigPanelProps {
  options: ReportOptions | null;
  value: ConfigState;
  onChange: (patch: Partial<ConfigState>) => void;
  filterOptions: FilterOptions;
  onFilterSearch: (type: FilterType, search: string) => void;
  onExport: () => void;
  canExport: boolean;
  exporting: boolean;
}

const FILTER_TYPES: FilterType[] = ["retailer", "employee", "supervisor", "route"];

function selectedFor(type: FilterType, filters: ReportFilters): (string | number)[] {
  switch (type) {
    case "retailer":
      return filters.retailer_ids;
    case "employee":
      return filters.employee_ids;
    case "supervisor":
      return filters.supervisor_ids;
    case "route":
      return filters.route_codes;
  }
}

function withSelected(
  type: FilterType,
  ids: (string | number)[],
  filters: ReportFilters,
): ReportFilters {
  switch (type) {
    case "retailer":
      return { ...filters, retailer_ids: ids.map(Number).filter(Number.isSafeInteger) };
    case "employee":
      return { ...filters, employee_ids: ids.map(Number).filter(Number.isSafeInteger) };
    case "supervisor":
      return { ...filters, supervisor_ids: ids.map(Number).filter(Number.isSafeInteger) };
    case "route":
      return { ...filters, route_codes: ids.map(String) };
  }
}

export default function ConfigPanel({
  options,
  value,
  onChange,
  filterOptions,
  onFilterSearch,
  onExport,
  canExport,
  exporting,
}: ConfigPanelProps) {
  const { language, t } = useLanguage();
  const [filterOpen, setFilterOpen] = useState(false);
  const [draftFilters, setDraftFilters] = useState(value.filters);
  const metric = options?.metrics.find((item) => item.key === value.metric);
  const availableSources = metric?.target_sources ?? [];
  const dimensions = options?.matrix[value.metric]?.[value.targetSource] ?? [];
  const activeFilters = Object.values(value.filters).reduce((count, ids) => count + ids.length, 0);

  useEffect(() => {
    if (filterOpen) setDraftFilters(value.filters);
  }, [filterOpen, value.filters]);

  const localized = (english: string, bangla: string) => language === "bn" ? bangla : english;

  return (
    <div className="space-y-4">
      <section className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <h2 className="mb-4 text-sm font-bold text-gray-900 dark:text-gray-100">
          {t("report_builder.config_title")}
        </h2>
        <div className="space-y-4">
          <label className="block text-sm font-bold text-gray-700 dark:text-gray-300">
            {t("report_builder.metric")}
            <select
              value={value.metric}
              onChange={(event) => onChange({ metric: event.target.value })}
              className="mt-1.5 h-11 w-full cursor-pointer rounded-xl border border-gray-200 bg-white px-3 text-sm font-normal text-gray-900 outline-none focus:ring-2 focus:ring-primary-500 dark:border-slate-700 dark:bg-slate-900 dark:text-gray-100"
            >
              {(options?.metrics ?? []).map((item) => (
                <option key={item.key} value={item.key}>
                  {localized(item.label_en, item.label_bn)}
                </option>
              ))}
            </select>
          </label>

          <label className="block text-sm font-bold text-gray-700 dark:text-gray-300">
            {t("report_builder.dimension")}
            <select
              value={value.groupBy}
              onChange={(event) => onChange({ groupBy: event.target.value })}
              className="mt-1.5 h-11 w-full cursor-pointer rounded-xl border border-gray-200 bg-white px-3 text-sm font-normal text-gray-900 outline-none focus:ring-2 focus:ring-primary-500 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-gray-100"
            >
              {dimensions.map((key) => {
                const item = options?.dimensions.find((dimension) => dimension.key === key);
                return item ? (
                  <option key={key} value={key}>
                    {localized(item.label_en, item.label_bn)}
                  </option>
                ) : null;
              })}
            </select>
          </label>

          <DateRangePicker
            label={t("report_builder.date_range")}
            value={{ from: value.dateFrom || null, to: value.dateTo || null }}
            onChange={(range) => onChange({
              dateFrom: range.from ?? "",
              dateTo: range.to ?? "",
            })}
          />

          <label className="block text-sm font-bold text-gray-700 dark:text-gray-300">
            {t("report_builder.target_source")}
            <select
              value={value.targetSource}
              onChange={(event) => onChange({ targetSource: event.target.value })}
              className="mt-1.5 h-11 w-full cursor-pointer rounded-xl border border-gray-200 bg-white px-3 text-sm font-normal text-gray-900 outline-none focus:ring-2 focus:ring-primary-500 dark:border-slate-700 dark:bg-slate-900 dark:text-gray-100"
            >
              {availableSources.map((source) => (
                <option key={source} value={source}>
                  {t(`report_builder.target_sources.${source}`)}
                </option>
              ))}
            </select>
          </label>

          {value.targetSource === "custom" && (
            <label className="block text-sm font-bold text-gray-700 dark:text-gray-300">
              {t("report_builder.target_value")}
              <input
                type="number"
                min="0"
                step="any"
                value={value.targetValue ?? ""}
                onChange={(event) => {
                  const raw = event.target.value;
                  const parsed = Number(raw);
                  onChange({
                    targetValue: raw === "" || !Number.isFinite(parsed) ? null : parsed,
                  });
                }}
                className="mt-1.5 h-11 w-full rounded-xl border border-gray-200 bg-white px-3 text-sm font-normal text-gray-900 outline-none focus:ring-2 focus:ring-primary-500 dark:border-slate-700 dark:bg-slate-900 dark:text-gray-100"
              />
              {value.targetValue === null && (
                <span className="mt-1 block text-xs font-normal text-amber-700 dark:text-amber-300">
                  {t("report_builder.value_required")}
                </span>
              )}
              {value.targetValue !== null && value.targetValue < 0 && (
                <span className="mt-1 block text-xs font-normal text-red-600 dark:text-red-300">
                  {t("report_builder.value_invalid")}
                </span>
              )}
            </label>
          )}

          <label className="block text-sm font-bold text-gray-700 dark:text-gray-300">
            {t("report_builder.sort_field")}
            <select
              value={value.sortField}
              onChange={(event) => onChange({ sortField: event.target.value })}
              className="mt-1.5 h-11 w-full cursor-pointer rounded-xl border border-gray-200 bg-white px-3 text-sm font-normal text-gray-900 outline-none focus:ring-2 focus:ring-primary-500 dark:border-slate-700 dark:bg-slate-900 dark:text-gray-100"
            >
              {["achievement", "target", "percentage", "remaining", "label", "status"].map((field) => (
                <option key={field} value={field}>{t(`report_builder.columns.${field}`)}</option>
              ))}
            </select>
          </label>
          <label className="block text-sm font-bold text-gray-700 dark:text-gray-300">
            {t("report_builder.sort_order")}
            <select
              value={value.sortOrder}
              onChange={(event) => onChange({ sortOrder: event.target.value as "asc" | "desc" })}
              className="mt-1.5 h-11 w-full cursor-pointer rounded-xl border border-gray-200 bg-white px-3 text-sm font-normal text-gray-900 outline-none focus:ring-2 focus:ring-primary-500 dark:border-slate-700 dark:bg-slate-900 dark:text-gray-100"
            >
              <option value="desc">{t("report_builder.descending")}</option>
              <option value="asc">{t("report_builder.ascending")}</option>
            </select>
          </label>
        </div>
      </section>

      <div className="flex items-center gap-2">
        <button
          type="button"
          title={t("report_builder.refine_results")}
          aria-label={t("report_builder.refine_results")}
          onClick={() => setFilterOpen(true)}
          className="relative inline-flex h-11 min-w-11 flex-1 items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white px-3 text-sm font-semibold text-gray-700 transition-colors hover:bg-gray-50 cursor-pointer dark:border-slate-800 dark:bg-slate-900 dark:text-gray-200 dark:hover:bg-slate-800"
        >
          <SlidersHorizontal className="h-4 w-4" />
          <span>{t("report_builder.filters")}</span>
          {activeFilters > 0 && (
            <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-primary-600 px-1 text-[11px] font-bold text-white">
              {activeFilters}
            </span>
          )}
        </button>
        {canExport && (
          <button
            type="button"
            onClick={onExport}
            disabled={exporting || !options || (
              value.targetSource === "custom" &&
              (value.targetValue === null || !Number.isFinite(value.targetValue) || value.targetValue < 0)
            )}
            className="inline-flex h-11 min-w-11 flex-1 items-center justify-center rounded-xl bg-primary-600 px-3 text-sm font-semibold text-white transition-colors hover:bg-primary-700 disabled:cursor-not-allowed disabled:opacity-50 enabled:cursor-pointer"
          >
            {exporting ? t("report_builder.exporting") : t("report_builder.export")}
          </button>
        )}
      </div>

      <AnimatePresence>
        {filterOpen && (
          <>
            <motion.button
              type="button"
              aria-label={t("report_builder.close")}
              onClick={() => setFilterOpen(false)}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-[110] cursor-pointer border-0 bg-black/30 p-0 backdrop-blur-sm"
            />
            <motion.aside
              initial={{ x: "100%" }}
              animate={{ x: 0 }}
              exit={{ x: "100%" }}
              transition={{ type: "spring", damping: 25, stiffness: 200 }}
              className="fixed inset-y-0 right-0 z-[111] flex w-full flex-col bg-white shadow-2xl dark:bg-slate-900 sm:max-w-md"
              aria-label={t("report_builder.filters")}
            >
              <div className="flex min-h-16 items-center justify-between border-b border-gray-100 px-5 dark:border-slate-800">
                <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">
                  {t("report_builder.refine_results")}
                </h2>
                <button
                  type="button"
                  title={t("report_builder.close")}
                  aria-label={t("report_builder.close")}
                  onClick={() => setFilterOpen(false)}
                  className="inline-flex h-11 w-11 items-center justify-center rounded-xl text-gray-500 hover:bg-gray-100 cursor-pointer dark:text-gray-300 dark:hover:bg-slate-800"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
              <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
                {FILTER_TYPES.map((type) => {
                  const key = `${type}s` as keyof ReportFilters;
                  const items: SelectorItem[] = filterOptions[type];
                  return (
                    <EntitySelector
                      key={type}
                      label={t(`report_builder.filter_fields.${key}`)}
                      items={items}
                      selectedIds={selectedFor(type, draftFilters)}
                      onChange={(ids) => setDraftFilters((current) => withSelected(type, ids, current))}
                      placeholder={t("report_builder.placeholder")}
                      searchPlaceholder={t("report_builder.search")}
                      emptyMessage={t("report_builder.no_options")}
                      noResultsMessage={t("report_builder.no_results")}
                      selectAllLabel={t("report_builder.select_all")}
                      clearLabel={t("report_builder.clear")}
                      selectedLabel={t("report_builder.selected")}
                      onSearchChange={(search) => onFilterSearch(type, search)}
                      remoteSearch
                    />
                  );
                })}
              </div>
              <div className="border-t border-gray-100 p-4 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => {
                    onChange({ filters: draftFilters });
                    setFilterOpen(false);
                  }}
                  className="h-11 w-full rounded-xl bg-primary-600 px-4 text-sm font-semibold text-white transition-colors hover:bg-primary-700 cursor-pointer"
                >
                  {t("report_builder.apply")}
                </button>
              </div>
            </motion.aside>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
