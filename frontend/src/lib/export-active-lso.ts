import apiClient from "./api";

export interface ActiveLsoExportParams {
  start_date: string;
  end_date: string;
  house_id?: number | null;
  manager_id?: number | null;
  supervisor_id?: number | null;
  rso_id?: number | null;
  status?: string | null;
}

export async function exportActiveLsoReport(format: "xlsx" | "csv", params: ActiveLsoExportParams): Promise<void> {
  const query: Record<string, string> = {
    start_date: params.start_date,
    end_date: params.end_date,
    format,
  };
  if (params.house_id) query.house_id = String(params.house_id);
  if (params.manager_id) query.manager_id = String(params.manager_id);
  if (params.supervisor_id) query.supervisor_id = String(params.supervisor_id);
  if (params.rso_id) query.rso_id = String(params.rso_id);
  if (params.status) query.status = params.status;

  const res = await apiClient.get("reports/active-lso/export", {
    params: query,
    responseType: "blob",
  });

  const disposition = (res.headers?.["content-disposition"] as string | undefined) ?? "";
  let filename = `active_lso_report_${params.start_date}_to_${params.end_date}.${format}`;
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
