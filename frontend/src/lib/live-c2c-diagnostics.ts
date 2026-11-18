/**
 * Response shape of `POST /reports/live-c2c/preview` for rows that could not be
 * resolved to an RSO or retailer. Shared by the page and the xlsx export helper.
 */

export interface LiveC2CDiagnosticCandidate {
  id: number;
  name: string | null;
  name_bn?: string | null;
  dms_code?: string | null;
  retailer_code?: string | null;
  itop_number: string | null;
  enabled?: string | null;
}

export interface LiveC2CEntityIssue {
  side: "from" | "to";
  value: string;
  status: "not_found" | "ambiguous";
  row_count: number;
  excel_rows: number[];
  candidates: LiveC2CDiagnosticCandidate[];
}

export interface LiveC2CMatchSummary {
  total_rows: number;
  importable_rows: number;
  issue_count: number;
  affected_rows: number;
  duplicate_rows: number;
}

export interface LiveC2CMatchReport {
  can_import: boolean;
  summary: LiveC2CMatchSummary;
  issues: LiveC2CEntityIssue[];
  duplicate_excel_rows: number[];
  house_mismatch: boolean;
  matching_house: { name: string; code: string } | null;
  truncated: boolean;
  disabled_retailer_count: number;
}
