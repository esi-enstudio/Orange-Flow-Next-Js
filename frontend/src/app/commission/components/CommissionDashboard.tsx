"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Calculator,
  Download,
  Filter,
  RefreshCw,
  Upload,
  X,
} from "lucide-react";
import FilterSidebar from "./FilterSidebar";
import SummaryCards from "./SummaryCards";
import ResultsTable from "./ResultsTable";
import AnalyticsSection from "./AnalyticsSection";
import ImportUploadModal from "./ImportUploadModal";
import {
  fetchCommissionData,
  fetchCommissionAnalytics,
  buildFilterPayload,
  exportCommissionExcel,
} from "@/lib/commission";
import type {
  CommissionFilterState,
  PaginatedResponse,
  DashboardAnalytics,
} from "@/types/commission";

interface Props {
  filters: CommissionFilterState;
  onFiltersChange: (filters: CommissionFilterState) => void;
}

export default function CommissionDashboard({ filters, onFiltersChange }: Props) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [data, setData] = useState<PaginatedResponse | null>(null);
  const [analytics, setAnalytics] = useState<DashboardAnalytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [showImport, setShowImport] = useState(false);
  const [exporting, setExporting] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const payload = buildFilterPayload(filters, page);
      const [commissionData, analyticsData] = await Promise.all([
        fetchCommissionData(payload),
        fetchCommissionAnalytics(payload),
      ]);
      setData(commissionData);
      setAnalytics(analyticsData);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load commission data");
    } finally {
      setLoading(false);
    }
  }, [filters, page]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleExport = async () => {
    setExporting(true);
    try {
      const payload = buildFilterPayload(filters, page, data?.total || 10000);
      await exportCommissionExcel(payload);
    } catch (err) {
      setError("Export failed");
    } finally {
      setExporting(false);
    }
  };

  const activeFilterCount = [
    filters.date.from || filters.date.to,
    filters.houseIds.length > 0,
    filters.campaignTypeIds.length > 0,
    filters.campaignCategory,
    filters.participantType,
    filters.search,
  ].filter(Boolean).length;

  return (
    <div className="flex h-full bg-gray-50 dark:bg-slate-950">
      <FilterSidebar
        filters={filters}
        onFiltersChange={onFiltersChange}
        isOpen={sidebarOpen}
        onToggle={() => setSidebarOpen(!sidebarOpen)}
      />

      <div className="flex-1 overflow-y-auto overflow-x-hidden">
        <div className="p-4 sm:p-6 lg:p-8 space-y-6">
          {/* Header */}
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <div className="flex items-center gap-3 mb-1">
                <div className="p-2.5 rounded-xl bg-gradient-to-br from-primary-500 to-primary-600 text-white shadow-lg shadow-primary-500/30">
                  <Calculator className="w-5 h-5" />
                </div>
                <h1 className="text-2xl font-bold tracking-tight text-gray-900 dark:text-gray-100">
                  Commission Dashboard
                </h1>
              </div>
              <p className="text-sm text-gray-500 dark:text-gray-400 ml-12">
                Filter and analyze commission transactions
              </p>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              <button
                onClick={() => setSidebarOpen(!sidebarOpen)}
                className="relative inline-flex items-center gap-2 px-3.5 py-2 rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-gray-50 dark:hover:bg-slate-800 transition-colors text-sm font-medium text-gray-700 dark:text-gray-300 cursor-pointer"
                title="Toggle filters"
              >
                <Filter className="w-4 h-4" />
                <span className="hidden sm:inline">Filters</span>
                {activeFilterCount > 0 && (
                  <span className="absolute -top-1 -right-1 flex items-center justify-center w-5 h-5 text-[10px] font-bold text-white bg-primary-500 rounded-full">
                    {activeFilterCount}
                  </span>
                )}
              </button>

              <button
                onClick={loadData}
                disabled={loading}
                className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-gray-50 dark:hover:bg-slate-800 transition-colors text-sm font-medium text-gray-700 dark:text-gray-300 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                title="Refresh"
              >
                <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
                <span className="hidden sm:inline">Refresh</span>
              </button>

              <button
                onClick={() => setShowImport(true)}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-gradient-to-r from-emerald-500 to-emerald-600 hover:from-emerald-600 hover:to-emerald-700 text-white transition-all text-sm font-semibold shadow-lg shadow-emerald-500/30 cursor-pointer"
              >
                <Upload className="w-4 h-4" />
                <span>Import</span>
              </button>

              <button
                onClick={handleExport}
                disabled={exporting || !data || data.total === 0}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-gradient-to-r from-primary-500 to-primary-600 hover:from-primary-600 hover:to-primary-700 text-white transition-all text-sm font-semibold shadow-lg shadow-primary-500/30 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
              >
                {exporting ? (
                  <RefreshCw className="w-4 h-4 animate-spin" />
                ) : (
                  <Download className="w-4 h-4" />
                )}
                <span>{exporting ? 'Exporting...' : 'Export'}</span>
              </button>
            </div>
          </div>

          {/* Error Alert */}
          {error && (
            <div className="flex items-start gap-3 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl text-red-700 dark:text-red-400">
              <div className="flex-1 text-sm">{error}</div>
              <button
                onClick={() => setError(null)}
                className="p-1 hover:bg-red-100 dark:hover:bg-red-900/30 rounded-lg transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          )}

          {/* Loading State */}
          {loading && !data ? (
            <div className="flex flex-col items-center justify-center min-h-[500px] gap-4">
              <div className="relative">
                <div className="w-16 h-16 rounded-full border-4 border-gray-200 dark:border-slate-800"></div>
                <div className="absolute inset-0 w-16 h-16 rounded-full border-4 border-primary-500 border-t-transparent animate-spin"></div>
              </div>
              <div className="text-center">
                <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
                  Loading commission data...
                </p>
                <p className="text-xs text-gray-400 mt-1">
                  This may take a few seconds
                </p>
              </div>
            </div>
          ) : (
            <>
              {/* Summary Cards */}
              {analytics && <SummaryCards summary={analytics.summary} />}

              {/* Analytics Section */}
              {analytics && <AnalyticsSection analytics={analytics} />}

              {/* Results Table */}
              {data && (
                <ResultsTable
                  data={data}
                  page={page}
                  onPageChange={setPage}
                  onRefresh={loadData}
                />
              )}
            </>
          )}
        </div>
      </div>

      <ImportUploadModal
        open={showImport}
        onClose={() => setShowImport(false)}
        onSuccess={loadData}
      />
    </div>
  );
}
