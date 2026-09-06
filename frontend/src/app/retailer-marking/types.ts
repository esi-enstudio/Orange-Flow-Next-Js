export interface Marking {
  id: number;
  name: string;
  code: string;
  description: string | null;
  status: string;
  retailer_count: number;
  created_at: string | null;
  updated_at: string | null;
}

export interface DropdownMarking {
  id: number;
  name: string;
  code: string;
  status: string;
  description: string | null;
}

export interface PaginationMeta {
  page: number;
  per_page: number;
  total: number;
  total_pages: number;
  has_next: boolean;
  has_prev: boolean;
}

export interface RetailerRow {
  id: number;
  house_id: number;
  retailer_code: string;
  name: string;
  itop_number: string;
  thana: string | null;
  type: string | null;
  house?: { id: number; name: string; code: string } | null;
  markings: string[];
}

export interface HistoryRetailer {
  id: number;
  retailer_code: string;
  name: string;
  itop_number: string;
  house_id: number;
}

export interface HistoryRow {
  id: number;
  retailer_id: number;
  marking_id: number;
  marking_name: string | null;
  marking_code: string | null;
  status: string;
  effective_from: string | null;
  effective_to: string | null;
  assigned_by: number | null;
  assigned_by_name: string | null;
  removed_by: number | null;
  removed_by_name: string | null;
  assigned_at: string | null;
  removed_at: string | null;
  remarks: string | null;
  retailer: HistoryRetailer | null;
}

export interface ImportPreviewRow {
  line: number;
  retailer_number: string;
  retailer_name: string;
  marking_name: string;
  retailer_id: number | null;
  valid: boolean;
  error: string | null;
}

export interface ImportPreview {
  batch_reference: string;
  total: number;
  valid_count: number;
  invalid_count: number;
  errors: ImportPreviewRow[];
  rows: ImportPreviewRow[];
  new_markings: string[];
}

export function houseHeaders(selectedHouse: { id: number } | null): Record<string, string> {
  return selectedHouse ? { "X-House-ID": String(selectedHouse.id) } : {};
}