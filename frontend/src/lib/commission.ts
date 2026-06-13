import apiClient from "./api";
import type {
  CommissionFilterPayload,
  PaginatedResponse,
  DashboardAnalytics,
  FilterOptions,
  ImportResponse,
  CommissionTransaction,
  CommissionTransactionUpdate,
} from "@/types/commission";

export async function fetchCommissionData(
  payload: CommissionFilterPayload
): Promise<PaginatedResponse> {
  const response = await apiClient.post("/commission/filter", payload);
  return response.data;
}

export async function fetchCommissionAnalytics(
  payload: CommissionFilterPayload
): Promise<DashboardAnalytics> {
  const response = await apiClient.post("/commission/analytics", payload);
  return response.data;
}

export async function fetchFilterOptions(): Promise<FilterOptions> {
  const response = await apiClient.get("/commission/filter-options");
  return response.data;
}

export async function fetchHouses(): Promise<
  { id: number; code: string; name: string }[]
> {
  const response = await apiClient.get("/commission/houses");
  return response.data;
}

export async function fetchCampaignTypes(): Promise<
  { id: number; campaign_name: string; category: string }[]
> {
  const response = await apiClient.get("/commission/campaign-types");
  return response.data;
}

export async function uploadCommissionFile(
  file: File
): Promise<ImportResponse> {
  const formData = new FormData();
  formData.append("file", file);
  const response = await apiClient.post("/commission/import/upload", formData);
  return response.data;
}

export async function processImport(
  batchReference: string
): Promise<{ message: string; processed: number }> {
  const response = await apiClient.post(
    `/commission/import/${batchReference}/process`
  );
  return response.data;
}

export async function getImportReport(
  batchReference: string
): Promise<ImportResponse> {
  const response = await apiClient.get(
    `/commission/import/${batchReference}/report`
  );
  return response.data;
}

export async function exportCommissionExcel(
  payload: CommissionFilterPayload
): Promise<void> {
  const response = await apiClient.post("/commission/export", payload, {
    responseType: "blob",
  });
  const url = window.URL.createObjectURL(new Blob([response.data]));
  const link = document.createElement("a");
  link.href = url;
  link.download = `commission_export_${Date.now()}.xlsx`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.URL.revokeObjectURL(url);
}

export async function fetchMonthlyTrend(
  months: number = 12,
  houseIds?: number[]
) {
  const params: Record<string, string | number> = { months };
  if (houseIds?.length) params.house_ids = houseIds.join(",");
  const response = await apiClient.get("/commission/monthly-trend", { params });
  return response.data;
}

export function buildFilterPayload(
  filters: CommissionFilterState,
  page: number = 1,
  pageSize: number = 50
): CommissionFilterPayload {
  const payload: CommissionFilterPayload = { page, page_size: pageSize };

  if (filters.date.from || filters.date.to) {
    payload.date = {};
    if (filters.date.from) payload.date.from = filters.date.from;
    if (filters.date.to) payload.date.to = filters.date.to;
  }

  if (filters.houseIds.length > 0) payload.house_ids = filters.houseIds;
  if (filters.campaignTypeIds.length > 0)
    payload.campaign_type_ids = filters.campaignTypeIds;
  if (filters.campaignCategory)
    payload.campaign_category = filters.campaignCategory;
  if (filters.participantType)
    payload.participant_type = filters.participantType;
  if (filters.search) payload.search = filters.search;

  return payload;
}

export async function updateCommissionTransaction(
  transactionId: number,
  data: CommissionTransactionUpdate
): Promise<CommissionTransaction> {
  const response = await apiClient.put(
    `/commission/transactions/${transactionId}`,
    data
  );
  return response.data;
}

export async function deleteCommissionTransaction(
  transactionId: number
): Promise<{ message: string }> {
  const response = await apiClient.delete(
    `/commission/transactions/${transactionId}`
  );
  return response.data;
}

export async function deleteCommissionBatch(
  batchId: number
): Promise<{ message: string }> {
  const response = await apiClient.delete(`/commission/batches/${batchId}`);
  return response.data;
}
