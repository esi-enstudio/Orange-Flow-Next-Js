import ExcelJS from "exceljs";

export const LIVE_C2C_COLUMNS = [
  { key: "serial_number", header: "SL #" },
  { key: "dd_code", header: "DD Code" },
  { key: "rso_name", header: "RSO Name" },
  { key: "rso_code", header: "RSO Code" },
  { key: "rso_number", header: "RSO Number" },
  { key: "check_in_time", header: "Check-in time" },
  { key: "productivity_c2c_target", header: "Productivity C2C Tgt" },
  { key: "c2c_today_route", header: "C2C today's route" },
  { key: "c2c_other_route", header: "C2C other route" },
  { key: "total_c2c", header: "Total C2C" },
  { key: "c2c_achievement", header: "Ach%" },
  { key: "c2c_remaining", header: "Remain" },
  { key: "gap", header: "Gap" },
  { key: "today_target", header: "Today Target" },
  { key: "target_remaining", header: "Remain" },
  { key: "productivity_trans_target", header: "Productivity trans.Tgt" },
  { key: "today_route_trans", header: "Todays route trans" },
  { key: "other_route_trans", header: "Other route trans*" },
  { key: "trans_achievement", header: "Ach%" },
  { key: "trans_remaining", header: "Remain" },
  { key: "start_time", header: "Start Time" },
  { key: "end_time", header: "End Time" },
  { key: "serving_hours", header: "Serving hours" },
] as const;
export const LIVE_C2C_HEADERS = Object.freeze(
  LIVE_C2C_COLUMNS.map(({ header }) => header),
);
export const MAX_LIVE_C2C_FILE_SIZE = 10 * 1024 * 1024;

export type LiveC2CFileErrorCode = "invalid_file_type" | "file_too_large";

export function validateLiveC2CFile(
  file: { name: string; size: number },
): LiveC2CFileErrorCode | null {
  if (!file.name.toLowerCase().endsWith(".xlsx")) return "invalid_file_type";
  if (file.size > MAX_LIVE_C2C_FILE_SIZE) return "file_too_large";
  return null;
}

export type LiveC2CWorkbookErrorCode =
  | "invalid_workbook"
  | "missing_worksheet"
  | "invalid_headers";

export class LiveC2CWorkbookError extends Error {
  readonly code: LiveC2CWorkbookErrorCode;

  constructor(code: LiveC2CWorkbookErrorCode) {
    super(code);
    this.name = "LiveC2CWorkbookError";
    this.code = code;
  }
}

function normalizeHeader(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

export async function parseLiveC2CWorkbook(data: ArrayBuffer): Promise<string[][]> {
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(data);
  } catch {
    throw new LiveC2CWorkbookError("invalid_workbook");
  }

  const worksheet = workbook.worksheets[0];
  if (!worksheet) throw new LiveC2CWorkbookError("missing_worksheet");

  const headerRow = worksheet.getRow(1);
  const headersMatch = LIVE_C2C_HEADERS.every((header, index) =>
    normalizeHeader(headerRow.getCell(index + 1).text) === normalizeHeader(header),
  );
  if (!headersMatch) throw new LiveC2CWorkbookError("invalid_headers");

  const rows: string[][] = [];
  for (let rowNumber = 2; rowNumber <= worksheet.rowCount; rowNumber++) {
    const values = LIVE_C2C_HEADERS.map((_, index) =>
      worksheet.getRow(rowNumber).getCell(index + 1).text,
    );
    if (values.some((value) => value.trim() !== "")) rows.push(values);
  }
  return rows;
}
