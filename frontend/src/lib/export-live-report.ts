import ExcelJS from 'exceljs';

interface RsoRow {
  name: string;
  itop_number: string;
  assisted_code: string;
  own_activation: number;
  market_activation: number;
  total_activation: number;
  yesterday_own: number;
  yesterday_market: number;
  yesterday_total: number;
}

interface BpRow {
  name: string;
  pool_number: string;
  assisted_code: string;
  own_activation: number;
  yesterday_activation: number;
}

interface SupervisorRow {
  name: string;
  dms_code: string;
  total_activation: number;
  employee_activation: number;
  market_activation: number;
  yesterday_total?: number;
}

interface ExportPayload {
  houseName: string;
  houseCode: string;
  totalActivations: number;
  employeeActivation: number;
  marketActivation: number;
  rsos: RsoRow[];
  bps: BpRow[];
  supervisors: SupervisorRow[];
}

const BORDER = "D1D5DB";
const SECTION_BG = "F1F5F9";
const TEXT_DARK = "1E293B";
const TEXT_MUTED = "64748B";
const WHITE = "FFFFFF";

const thinBorder: Partial<ExcelJS.Border> = {
  style: "thin",
  color: { argb: BORDER },
};

const allBorders: Partial<ExcelJS.Borders> = {
  top: thinBorder,
  bottom: thinBorder,
  left: thinBorder,
  right: thinBorder,
};

function sectionTitle(ws: ExcelJS.Worksheet, row: number, label: string, cols: number) {
  ws.mergeCells(row, 1, row, cols);
  const cell = ws.getCell(row, 1);
  cell.value = label;
  cell.font = { bold: true, size: 11, name: "Calibri", color: { argb: TEXT_DARK } };
  cell.alignment = { vertical: "middle", horizontal: "center" };
  cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: SECTION_BG } };
  cell.border = allBorders;
  ws.getRow(row).height = 24;
}

function headerRow(ws: ExcelJS.Worksheet, row: number, headers: string[], heights: number[] = []) {
  const r = ws.getRow(row);
  r.height = 24;
  headers.forEach((h, i) => {
    const cell = r.getCell(i + 1);
    cell.value = h;
    cell.font = { bold: true, size: 10, name: "Calibri", color: { argb: TEXT_DARK } };
    cell.alignment = { vertical: "middle", horizontal: "center" };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: SECTION_BG } };
    cell.border = allBorders;
  });
}

function dataRow(
  ws: ExcelJS.Worksheet,
  row: number,
  values: (string | number)[],
  isTotal: boolean = false,
) {
  const r = ws.getRow(row);
  r.height = 22;
  values.forEach((val, i) => {
    const cell = r.getCell(i + 1);
    cell.value = val;
    cell.font = {
      bold: isTotal,
      size: 10,
      name: "Calibri",
      color: { argb: TEXT_DARK },
    };
    cell.alignment = {
      vertical: "middle",
      horizontal: i === 1 ? "left" : "center",
    };
    cell.border = allBorders;
    if (isTotal) {
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: SECTION_BG } };
    }
  });
}

function formulaRow(
  ws: ExcelJS.Worksheet,
  row: number,
  formulaCols: string[],
  dataStart: number,
  dataEnd: number,
  label: string,
  totalCols: number = 10,
) {
  const r = ws.getRow(row);
  r.height = 22;
  for (let ci = 1; ci <= totalCols; ci++) {
    const colLetter = String.fromCharCode(64 + ci);
    const cell = r.getCell(ci);
    cell.font = { bold: true, size: 10, name: "Calibri", color: { argb: TEXT_DARK } };
    cell.alignment = { vertical: "middle", horizontal: "center" };
    cell.border = allBorders;
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: SECTION_BG } };
    if (ci === 1) {
      cell.value = label;
    } else if (formulaCols.includes(colLetter)) {
      cell.value = { formula: `SUM(${colLetter}${dataStart}:${colLetter}${dataEnd})` };
    }
  }
}

export async function exportLiveReport(payload: ExportPayload): Promise<void> {
  const { houseName, houseCode, totalActivations, employeeActivation, marketActivation, rsos, bps, supervisors } = payload;

  const now = new Date();
  const monthYear = now.toLocaleDateString("en-US", { month: "long", year: "numeric" });
  const dateStr = now.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
  const timeStr = now.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: true });

  const wb = new ExcelJS.Workbook();
  wb.creator = "Orange Flow";
  const ws = wb.addWorksheet("RSO Report", {
    pageSetup: {
      orientation: "landscape",
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      paperSize: 9,
      margins: { top: 0, bottom: 0, left: 0, right: 0, header: 0, footer: 0 },
    },
  });

  ws.columns = [
    { width: 6 },
    { width: 28 },
    { width: 20 },
    { width: 18 },
    { width: 12 },
    { width: 12 },
    { width: 12 },
    { width: 12 },
    { width: 12 },
    { width: 12 },
  ];

  const COLS = 10;

  /* ════════════════════════════════════════════
     ROW 1: Title + Summary Headers
     ════════════════════════════════════════════ */
  ws.mergeCells(1, 1, 1, 3);
  const titleCell = ws.getCell("A1");
  titleCell.value = `GA Live Report (${monthYear})`;
  titleCell.font = { bold: true, size: 14, name: "Calibri", color: { argb: TEXT_DARK } };
  titleCell.alignment = { vertical: "middle", horizontal: "left" };

  const sumHeaders = ["House Need", "Ach", "Remain"];
  ["D1", "E1", "F1"].forEach((ref, i) => {
    const cell = ws.getCell(ref);
    cell.value = sumHeaders[i];
    cell.font = { bold: true, size: 10, name: "Calibri", color: { argb: TEXT_DARK } };
    cell.alignment = { vertical: "middle", horizontal: "center" };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: SECTION_BG } };
    cell.border = allBorders;
  });
  ws.getRow(1).height = 28;

  /* ════════════════════════════════════════════
     ROW 2: Summary Values
     ════════════════════════════════════════════ */
  const sumValues = [totalActivations, employeeActivation, marketActivation];
  ["D2", "E2", "F2"].forEach((ref, i) => {
    const cell = ws.getCell(ref);
    cell.value = sumValues[i];
    cell.font = { bold: true, size: 11, name: "Calibri", color: { argb: TEXT_DARK } };
    cell.alignment = { vertical: "middle", horizontal: "center" };
    cell.border = allBorders;
  });
  for (let c = 1; c <= 3; c++) {
    ws.getCell(2, c).border = allBorders;
  }
  ws.getRow(2).height = 22;

  /* ════════════════════════════════════════════
     ROW 3: House Info
     ════════════════════════════════════════════ */
  ws.mergeCells(3, 1, 3, 3);
  const infoCell = ws.getCell("A3");
  infoCell.value = `House: ${houseName} (${houseCode})\nGenerated: ${dateStr}, ${timeStr}`;
  infoCell.font = { color: { argb: TEXT_MUTED }, size: 10, name: "Calibri" };
  infoCell.alignment = { vertical: "middle", horizontal: "left", wrapText: true };
  ws.getRow(3).height = 36;

  /* ════════════════════════════════════════════
     ROW 4: Spacer
     ════════════════════════════════════════════ */

  /* ════════════════════════════════════════════
     ROW 5: RSO PERFORMANCE section title
     ════════════════════════════════════════════ */
  sectionTitle(ws, 5, "RSO PERFORMANCE", COLS);

  /* ════════════════════════════════════════════
     ROW 6: RSO Headers
     ════════════════════════════════════════════ */
  headerRow(ws, 6, [
    "#", "Name", "ITop Number", "Assisted Code",
    "Today Own", "Today Market", "Today Total",
    "Yest Own", "Yest Market", "Yest Total",
  ]);

  /* ════════════════════════════════════════════
     ROWS 7-24: RSO Data
     ════════════════════════════════════════════ */
  const RSO_DATA_START = 7;
  const RSO_DATA_END = 24;
  let r = RSO_DATA_START;
  rsos.forEach((rso, i) => {
    dataRow(ws, r, [
      i + 1,
      rso.name,
      rso.itop_number || "",
      rso.assisted_code || "",
      rso.own_activation,
      rso.market_activation,
      rso.total_activation,
      rso.yesterday_own,
      rso.yesterday_market,
      rso.yesterday_total,
    ]);
    r++;
  });
  while (r <= RSO_DATA_END) {
    for (let ci = 1; ci <= COLS; ci++) {
      const cell = ws.getCell(r, ci);
      cell.border = allBorders;
      cell.font = { size: 10, name: "Calibri" };
    }
    ws.getRow(r).height = 22;
    r++;
  }

  /* ════════════════════════════════════════════
     ROW 25: RSO Total (formulas)
     ════════════════════════════════════════════ */
  formulaRow(ws, 25, ["E", "F", "G", "H", "I", "J"], RSO_DATA_START, RSO_DATA_END, "Total");

  /* ════════════════════════════════════════════
     ROW 26: Spacer
     ════════════════════════════════════════════ */

  /* ════════════════════════════════════════════
     ROW 27: BP PERFORMANCE section title
     ════════════════════════════════════════════ */
  sectionTitle(ws, 27, "BP PERFORMANCE", COLS);

  /* ════════════════════════════════════════════
     ROW 28: BP Headers
     ════════════════════════════════════════════ */
  headerRow(ws, 28, [
    "#", "Name", "Pool Number", "Assisted Code",
    "Today Own", "Today Market", "Today Total",
    "Yest Own", "Yest Market", "Yest Total",
  ]);

  /* ════════════════════════════════════════════
     ROWS 29-32: BP Data
     ════════════════════════════════════════════ */
  const BP_DATA_START = 29;
  const BP_DATA_END = 32;
  r = BP_DATA_START;
  bps.forEach((bp, i) => {
    dataRow(ws, r, [
      i + 1,
      bp.name,
      bp.pool_number || "",
      bp.assisted_code || "",
      bp.own_activation,
      0,
      bp.own_activation,
      bp.yesterday_activation,
      0,
      bp.yesterday_activation,
    ]);
    r++;
  });
  while (r <= BP_DATA_END) {
    for (let ci = 1; ci <= COLS; ci++) {
      const cell = ws.getCell(r, ci);
      cell.border = allBorders;
      cell.font = { size: 10, name: "Calibri" };
    }
    ws.getRow(r).height = 22;
    r++;
  }

  /* ════════════════════════════════════════════
     ROW 33: BP Subtotal (formulas)
     ════════════════════════════════════════════ */
  formulaRow(ws, 33, ["E", "F", "G", "H", "I", "J"], BP_DATA_START, BP_DATA_END, "Subtotal");

  /* ════════════════════════════════════════════
     ROW 34: Spacer
     ════════════════════════════════════════════ */

  /* ════════════════════════════════════════════
     ROW 35: SUPERVISOR PERFORMANCE section title
     ════════════════════════════════════════════ */
  sectionTitle(ws, 35, "SUPERVISOR PERFORMANCE", 5);

  /* ════════════════════════════════════════════
     ROW 36: Supervisor Headers
     ════════════════════════════════════════════ */
  headerRow(ws, 36, [
    "#", "Name", "Pool Number", "Today GA", "Yest GA",
  ]);

  /* ════════════════════════════════════════════
     ROWS 37-38: Supervisor Data
     ════════════════════════════════════════════ */
  const SUP_DATA_START = 37;
  const SUP_DATA_END = 38;
  r = SUP_DATA_START;
  supervisors.forEach((sup, i) => {
    dataRow(ws, r, [
      i + 1,
      sup.name,
      sup.dms_code || "",
      sup.total_activation,
      sup.yesterday_total ?? 0,
    ]);
    r++;
  });
  while (r <= SUP_DATA_END) {
    for (let ci = 1; ci <= 5; ci++) {
      const cell = ws.getCell(r, ci);
      cell.border = allBorders;
      cell.font = { size: 10, name: "Calibri" };
    }
    ws.getRow(r).height = 22;
    r++;
  }

  /* ════════════════════════════════════════════
     ROW 39: Supervisor Subtotal (formulas)
     ════════════════════════════════════════════ */
  formulaRow(ws, 39, ["D", "E"], SUP_DATA_START, SUP_DATA_END, "Subtotal", 5);

  /* ════════════════════════════════════════════
     Generate file
     ════════════════════════════════════════════ */
  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  const todayStr = now.toISOString().slice(0, 10);
  link.setAttribute("download", `rso_report_${todayStr}.xlsx`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.URL.revokeObjectURL(url);
}
