"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Calculator,
  Download,
  Filter,
  RefreshCw,
  Upload,
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
    try {
      const payload = buildFilterPayload(filters, page, data?.total || 10000);
      await exportCommissionExcel(payload);
    } catch (err) {
      setError("Export failed");
    }
  };

  return (
    <div className="flex h-[calc(100vh-4rem)]">
      <FilterSidebar
        filters={filters}
        onFiltersChange={onFiltersChange}
        isOpen={sidebarOpen}
        onToggle={() => setSidebarOpen(!sidebarOpen)}
      />

      <div className="flex-1 overflow-auto">
        <div className="p-6 space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-gray-900 dark:text-gray-100 flex items-center gap-3">
                <div className="p-2.5 rounded-xl bg-primary-50 text-primary-600 shadow-sm">
                  <Calculator className="w-5 h-5" />
                </div>
                Commission Dashboard
              </h1>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-1 ml-1">
                Filter and analyze house commission and campaign data
              </p>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => setSidebarOpen(!sidebarOpen)}
                className="p-2 rounded-lg border border-gray-200 dark:border-slate-700 hover:bg-gray-50 dark:hover:bg-slate-800 transition-colors"
                title="Toggle filters"
              >
                <Filter className="w-4 h-4" />
              </button>
              <button
                onClick={loadData}
                className="p-2 rounded-lg border border-gray-200 dark:border-slate-700 hover:bg-gray-50 dark:hover:bg-slate-800 transition-colors"
                title="Refresh"
              >
                <RefreshCw className="w-4 h-4" />
              </button>
              <button
                onClick={() => setShowImport(true)}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 transition-colors text-sm font-medium"
              >
                <Upload className="w-4 h-4" />
                Import
              </button>
              <button
                onClick={handleExport}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary-600 text-white hover:bg-primary-700 transition-colors text-sm font-medium"
              >
                <Download className="w-4 h-4" />
                Export
              </button>
            </div>
          </div>

          {error && (
            <div className="p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl text-red-700 dark:text-red-400 text-sm">
              {error}
            </div>
          )}

          {loading && !data ? (
            <div className="flex items-center justify-center min-h-[400px]">
              <div className="flex items-center gap-3 text-gray-400">
                <RefreshCw className="w-5 h-5 animate-spin" />
                <span>Loading commission data...</span>
              </div>
            </div>
          ) : (
            <>
              {analytics && <SummaryCards summary={analytics.summary} />}
              {analytics && <AnalyticsSection analytics={analytics} />}
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
