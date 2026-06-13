export interface CommissionFilterState {
  date: {
    from: string;
    to: string;
  };
  houseIds: number[];
  campaignTypeIds: number[];
  campaignCategory: string;
  participantType: string;
  search: string;
}

export interface DateFilter {
  exact?: string;
  from?: string;
  to?: string;
  month?: number;
  year?: number;
}

export interface CommissionFilterPayload {
  date?: DateFilter;
  house_ids?: number[];
  campaign_type_ids?: number[];
  campaign_category?: string;
  participant_type?: string;
  search?: string;
  page: number;
  page_size: number;
  sort_by?: string;
  sort_order?: string;
}

export interface CommissionTransaction {
  id: number;
  statement_date: string;
  batch_reference: string;
  house_id: number;
  house_code: string;
  house_name: string;
  campaign_name: string;
  campaign_category: string;
  participant_type: string;
  participant_ref: string;
  participant_name: string;
  employee_id: number | null;
  employee_employee_id: string | null;
  employee_dms_code: string | null;
  employee_name: string | null;
  purpose: string | null;
  amount: number;
  extra_data: Record<string, unknown> | null;
  created_at: string;
}

export interface CommissionSummary {
  total_campaign_amount: number;
  transaction_count: number;
  house_count: number;
}

export interface CampaignPerformance {
  campaign_type_id: number;
  campaign_name: string;
  category: string;
  total_amount: number;
  transaction_count: number;
  house_count: number;
}

export interface HousePerformance {
  house_id: number;
  house_code: string;
  house_name: string;
  total_amount: number;
  transaction_count: number;
}

export interface PaginatedResponse {
  items: CommissionTransaction[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
  summary: CommissionSummary;
}

export interface DashboardAnalytics {
  summary: CommissionSummary;
  campaign_performance: CampaignPerformance[];
  house_performance: HousePerformance[];
  monthly_trend?: MonthlyTrend[];
}

export interface MonthlyTrend {
  year: number;
  month: number;
  campaign_total: string;
}

export interface FilterOption {
  id: number;
  code?: string;
  name?: string;
}

export interface FilterOptions {
  houses: FilterOption[];
  campaigns: { id: number; name: string; category: string }[];
  available_months: string[];
  categories: string[];
  participant_types: string[];
}

export interface ImportResponse {
  batch_reference: string;
  total_rows: number;
  valid_rows: number;
  failed_rows: number;
  errors?: { row: number; errors: string[] }[];
}

export interface CommissionTransactionUpdate {
  campaign_type_id?: number;
  participant_type?: string;
  participant_ref?: string;
  participant_name?: string;
  purpose?: string;
  amount?: number;
  extra_data?: Record<string, unknown>;
}

export const DEFAULT_FILTER_STATE: CommissionFilterState = {
  date: { from: "", to: "" },
  houseIds: [],
  campaignTypeIds: [],
  campaignCategory: "",
  participantType: "",
  search: "",
};
