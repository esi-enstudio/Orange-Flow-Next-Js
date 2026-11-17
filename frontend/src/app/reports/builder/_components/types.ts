import type { SelectorItem } from "../../../zoom-in/_components/EntitySelector";

export type FilterType = "retailer" | "employee" | "supervisor" | "route";

export interface ReportFilters {
  retailer_ids: number[];
  employee_ids: number[];
  supervisor_ids: number[];
  route_codes: string[];
}

export interface ConfigState {
  metric: string;
  groupBy: string;
  dateFrom: string;
  dateTo: string;
  targetSource: string;
  targetValue: number | null;
  sortField: string;
  sortOrder: "asc" | "desc";
  filters: ReportFilters;
}

export interface ReportMetricOption {
  key: string;
  label_en: string;
  label_bn: string;
  value_type: "count" | "amount";
  target_sources: string[];
}

export interface ReportDimensionOption {
  key: string;
  label_en: string;
  label_bn: string;
}

export interface ReportOptions {
  metrics: ReportMetricOption[];
  dimensions: ReportDimensionOption[];
  matrix: Record<string, Record<string, string[]>>;
  statuses: string[];
  export_sync_max_rows: number;
}

export type FilterOptions = Record<FilterType, SelectorItem[]>;

export interface QueryResultRow {
  key: string | number | null;
  label: string;
  sublabel: string;
  achievement: number;
  target: number | null;
  adjusted_target: number | null;
  percent_applied: number | null;
  proration_factor: number | null;
  percentage: number | null;
  remaining: number | null;
  status: string;
  is_null_bucket: boolean;
}

export interface QueryResult {
  success: boolean;
  data: QueryResultRow[];
  summary: Omit<QueryResultRow, "key" | "label" | "sublabel" | "is_null_bucket"> & {
    row_count: number;
  };
  pagination: {
    page: number;
    per_page: number;
    total: number;
    total_pages: number;
    has_next: boolean;
    has_prev: boolean;
  };
  meta: {
    metric: string;
    metric_label_en: string;
    metric_label_bn: string;
    group_by: string;
    dimension_label_en: string;
    dimension_label_bn: string;
    date_from: string;
    date_to: string;
    target_source: string;
    value_type: "count" | "amount";
    target_is_period_level: boolean;
    row_comparison_suppressed: boolean;
  };
  warnings: { code: string; message: string; count?: number }[];
}
