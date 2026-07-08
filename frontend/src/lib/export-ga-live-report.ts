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
  ddTarget: number;
  achievement: number;
  percentage: number;
  remaining: number;
  drr: number;
  rsos: RsoRow[];
  bps: BpRow[];
  supervisors: SupervisorRow[];
}

const BORDER = "D1D5DB";
const SECTION_BG = "F1F5F9";
const TEXT_DARK = "1E293B";
const TEXT_MUTED = "64748B";
const WHITE = "FFFFFF";
const MEDIUM_BG = "93C5FD";
const LIGHT_BG = "DBEAFE";
const MEDIUM_ORANGE = "FCD34D";
const LIGHT_ORANGE = "FEF3C7";

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
  cell.alignment = { vertical: "middle", horizontal: "left" };
  cell.border = allBorders;
}

function headerRow(ws: ExcelJS.Worksheet, row: number, headers: string[]) {
  const r = ws.getRow(row);
  headers.forEach((h, i) => {
    const cell = r.getCell(i + 1);
    cell.value = h;
    cell.font = { bold: true, size: 10, name: "Calibri", color: { argb: TEXT_DARK } };
    cell.alignment = { vertical: "middle", horizontal: "center" };
    cell.border = allBorders;
  });
}

function dataRow(
  ws: ExcelJS.Worksheet,
  row: number,
  values: (string | number)[],
) {
  const r = ws.getRow(row);

  values.forEach((val, i) => {
    const cell = r.getCell(i + 1);
    cell.value = val;
    cell.font = { bold: false, size: 10, name: "Calibri", color: { argb: TEXT_DARK } };
    cell.alignment = {
      vertical: "middle",
      horizontal: i === 1 ? "left" : "center",
    };
    cell.border = allBorders;
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
  const { houseName, houseCode, totalActivations, ddTarget, achievement, percentage, remaining, drr, rsos, bps, supervisors } = payload;

  const now = new Date();
  const monthYear = now.toLocaleDateString("en-US", { month: "long", year: "numeric" });
  const dateStr = now.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
  const timeStr = now.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: true });

  const wb = new ExcelJS.Workbook();
  wb.creator = "Orange Flow";
  const ws = wb.addWorksheet("GA Live Report", {
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
    { width: 12 },
    { width: 12 },
    { width: 12 },
  ];

  const COLS = 13;

  /* ════════════════════════════════════════════
     ROW 1-2: Title + DD Target Headers
     ════════════════════════════════════════════ */
  ws.mergeCells(1, 1, 2, 3);
  const titleCell = ws.getCell("A1");
  titleCell.value = `GA Live Report (${monthYear})`;
  titleCell.font = { bold: true, size: 14, name: "Calibri", color: { argb: TEXT_DARK } };
  titleCell.alignment = { vertical: "middle", horizontal: "left" };

  /* ── DD Target Summary Headers (E2:I2) ── */
  const ddHeaders = ["DD Target", "Ach", "%", "Remain", "DRR"];
  ddHeaders.forEach((h, i) => {
    const cell = ws.getCell(2, 5 + i);
    cell.value = h;
    cell.font = { bold: true, size: 10, name: "Calibri", color: { argb: TEXT_DARK } };
    cell.alignment = { vertical: "middle", horizontal: "center" };
    cell.border = allBorders;
  });

  /* ── DD Target Summary Values (E3:I3) ── */
  const ddValues = [ddTarget, achievement, `${percentage}%`, remaining, drr];
  ddValues.forEach((v, i) => {
    const cell = ws.getCell(3, 5 + i);
    cell.value = v;
    cell.font = { bold: true, size: 10, name: "Calibri", color: { argb: TEXT_DARK } };
    cell.alignment = { vertical: "middle", horizontal: "center" };
    cell.border = allBorders;
  });

  /* ── Total Activation Count (K1:M4) ── */
  ws.mergeCells(1, 11, 4, 13);
  const totalCell = ws.getCell("K1");
  totalCell.value = totalActivations;
  totalCell.font = { bold: true, size: 48, name: "Calibri", color: { argb: TEXT_DARK } };
  totalCell.alignment = { vertical: "middle", horizontal: "center" };
  totalCell.border = allBorders;

  /* ════════════════════════════════════════════
     ROW 3: House Info
     ════════════════════════════════════════════ */
  ws.mergeCells(3, 1, 3, 3);
  const houseCell = ws.getCell("A3");
  houseCell.value = `House: ${houseName} (${houseCode})`;
  houseCell.font = { bold: true, size: 10, name: "Calibri", color: { argb: TEXT_MUTED } };
  houseCell.alignment = { vertical: "middle", horizontal: "left" };

  /* ════════════════════════════════════════════
     ROW 4: Generated Info
     ════════════════════════════════════════════ */
  ws.mergeCells(4, 1, 4, 3);
  const genCell = ws.getCell("A4");
  genCell.value = `Generated: ${dateStr}, ${timeStr}`;
  genCell.font = { bold: true, size: 10, name: "Calibri", color: { argb: TEXT_MUTED } };
  genCell.alignment = { vertical: "middle", horizontal: "left" };

  /* ════════════════════════════════════════════
     ROW 5: RSO PERFORMANCE section title
     ════════════════════════════════════════════ */
   ws.mergeCells(5, 1, 5, 10);
   ws.mergeCells(5, 11, 5, 13);
   const rsoTitleCell = ws.getCell("A5");
   rsoTitleCell.value = "RSO PERFORMANCE";
   rsoTitleCell.font = { bold: true, size: 11, name: "Calibri", color: { argb: TEXT_DARK } };
   rsoTitleCell.alignment = { vertical: "middle", horizontal: "left" };
   rsoTitleCell.border = allBorders;
   const rsoYestCell = ws.getCell("K5");
   rsoYestCell.value = "Yesterday";
   rsoYestCell.font = { bold: true, size: 11, name: "Calibri", color: { argb: TEXT_DARK } };
   rsoYestCell.alignment = { vertical: "middle", horizontal: "center" };
   rsoYestCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: MEDIUM_ORANGE } };
   rsoYestCell.border = allBorders;

  /* ════════════════════════════════════════════
     ROW 6: RSO Headers
     ════════════════════════════════════════════ */
  headerRow(ws, 6, [
    "#", "Name", "ITop Number", "Assisted Code",
    "Today Target",
    "Own Code", "Market", "Total",
    "%", "Remain",
    "Own Code", "Market", "Total",
  ]);
  [ws.getCell("K6"), ws.getCell("L6"), ws.getCell("M6")].forEach((cell) => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: MEDIUM_ORANGE } };
  });

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
      0,
      rso.own_activation,
      rso.market_activation,
      rso.total_activation,
      0,
      0,
      rso.yesterday_own,
      rso.yesterday_market,
      rso.yesterday_total,
    ]);
    [11, 12, 13].forEach((ci) => {
      ws.getCell(r, ci).fill = { type: "pattern", pattern: "solid", fgColor: { argb: LIGHT_ORANGE } };
    });
    r++;
  });
  while (r <= RSO_DATA_END) {
    for (let ci = 1; ci <= COLS; ci++) {
      const cell = ws.getCell(r, ci);
      cell.border = allBorders;
      cell.font = { size: 10, name: "Calibri" };
    }

    r++;
  }

  /* ════════════════════════════════════════════
     ROW 25: RSO Total (formulas)
     ════════════════════════════════════════════ */
  formulaRow(ws, 25, ["F", "G", "H", "I", "J", "K", "L", "M"], RSO_DATA_START, RSO_DATA_END, "Total", 13);
  [11, 12, 13].forEach((ci) => {
    ws.getCell(25, ci).fill = { type: "pattern", pattern: "solid", fgColor: { argb: LIGHT_ORANGE } };
  });

  /* ════════════════════════════════════════════
     ROW 26: Spacer
     ════════════════════════════════════════════ */

  /* ════════════════════════════════════════════
     ROW 27: BP PERFORMANCE section title
     ════════════════════════════════════════════ */
   ws.mergeCells(27, 1, 27, 9);
   const bpTitleCell = ws.getCell("A27");
   bpTitleCell.value = "BP PERFORMANCE";
   bpTitleCell.font = { bold: true, size: 11, name: "Calibri", color: { argb: TEXT_DARK } };
   bpTitleCell.alignment = { vertical: "middle", horizontal: "left" };
   bpTitleCell.border = allBorders;

  /* ════════════════════════════════════════════
     ROW 28: BP Headers
     ════════════════════════════════════════════ */
  headerRow(ws, 28, [
    "#", "Name", "Pool Number", "Assisted Code",
    "Today Target",
    "Ach", "%", "Remain", "Yest GA",
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
      0,
      bp.own_activation,
      0,
      0,
      bp.yesterday_activation,
    ]);
    r++;
  });
  while (r <= BP_DATA_END) {
    for (let ci = 1; ci <= 9; ci++) {
      const cell = ws.getCell(r, ci);
      cell.border = allBorders;
      cell.font = { size: 10, name: "Calibri" };
    }

    r++;
  }

  /* ════════════════════════════════════════════
     ROW 33: BP Subtotal (formulas)
     ════════════════════════════════════════════ */
  formulaRow(ws, 33, ["F", "G", "H", "I"], BP_DATA_START, BP_DATA_END, "Total", 9);

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

    r++;
  }

  /* ════════════════════════════════════════════
     ROW 39: Supervisor Subtotal (formulas)
     ════════════════════════════════════════════ */
  formulaRow(ws, 39, ["D", "E"], SUP_DATA_START, SUP_DATA_END, "Total", 5);

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
  const day = String(now.getDate()).padStart(2, "0");
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const year = now.getFullYear();
  const displayDate = `${day}-${month}-${year}`;
  link.setAttribute("download", `ga_live_report_${displayDate}.xlsx`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.URL.revokeObjectURL(url);
}
