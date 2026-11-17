import ExcelJS from "exceljs";

export const MAX_LIVE_C2C_FILE_SIZE = 10 * 1024 * 1024;

export type LiveC2CFileErrorCode = "invalid_file_type" | "file_too_large";
export type LiveC2CWorkbookErrorCode = "invalid_workbook" | "missing_worksheet";

export class LiveC2CWorkbookError extends Error {
  readonly code: LiveC2CWorkbookErrorCode;

  constructor(code: LiveC2CWorkbookErrorCode) {
    super(code);
    this.name = "LiveC2CWorkbookError";
    this.code = code;
  }
}

export function validateLiveC2CFile(
  file: { name: string; size: number },
): LiveC2CFileErrorCode | null {
  const filename = file.name.toLowerCase();
  if (!filename.endsWith(".xlsx") && !filename.endsWith(".xlsb")) {
    return "invalid_file_type";
  }
  if (file.size > MAX_LIVE_C2C_FILE_SIZE) return "file_too_large";
  return null;
}

export async function listLiveC2CWorksheetNames(data: ArrayBuffer): Promise<string[]> {
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(data);
  } catch {
    throw new LiveC2CWorkbookError("invalid_workbook");
  }

  const names = workbook.worksheets.map((worksheet) => worksheet.name);
  if (names.length === 0) throw new LiveC2CWorkbookError("missing_worksheet");
  return names;
}
