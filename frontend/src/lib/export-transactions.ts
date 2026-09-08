import apiClient from "./api";

export interface TransactionsExportParams {
  report_type?: string;
  start_date: string;
  end_date: string;
  house_id?: number | null;
  rso_id?: number | null;
  retailer_id?: number | null;
}

export interface RetailerThresholdExportParams {
  report_types: string[];
  min_amount: number;
  start_date: string;
  end_date: string;
  house_id?: number | null;
  rso_id?: number | null;
}

export async function exportRetailerThresholdReport(params: RetailerThresholdExportParams): Promise<void> {
  const query: Record<string, string> = {
    report_types: params.report_types.join(","),
    min_amount: String(params.min_amount),
    start_date: params.start_date,
    end_date: params.end_date,
  };
  if (params.house_id) query.house_id = String(params.house_id);
  if (params.rso_id) query.rso_id = String(params.rso_id);

  const res = await apiClient.get("reports/transactions/retailer-threshold/export", {
    params: query,
    responseType: "blob",
  });

  const disposition = (res.headers?.["content-disposition"] as string | undefined) ?? "";
  let filename = `retailer_threshold_${params.start_date}_to_${params.end_date}.xlsx`;
  const match = disposition.match(/filename="?([^";]+)"?/i);
  if (match?.[1]) filename = match[1];

  const blob = res.data as Blob;
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.setAttribute("download", filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.URL.revokeObjectURL(url);
}

export async function exportTransactionsReport(params: TransactionsExportParams): Promise<void> {
  const query: Record<string, string> = {
    start_date: params.start_date,
    end_date: params.end_date,
  };
  if (params.report_type) query.report_type = params.report_type;
  if (params.house_id) query.house_id = String(params.house_id);
  if (params.rso_id) query.rso_id = String(params.rso_id);
  if (params.retailer_id) query.retailer_id = String(params.retailer_id);

  const res = await apiClient.get("reports/transactions/export", {
    params: query,
    responseType: "blob",
  });

  const disposition = (res.headers?.["content-disposition"] as string | undefined) ?? "";
  let filename = `transactions_report_${params.start_date}_to_${params.end_date}.xlsx`;
  const match = disposition.match(/filename="?([^";]+)"?/i);
  if (match?.[1]) filename = match[1];

  const blob = res.data as Blob;
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.setAttribute("download", filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.URL.revokeObjectURL(url);
}