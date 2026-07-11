import ExcelJS from 'exceljs';

interface RsoRow {
  name: string;
  itop_number: string;
  assisted_code: string;
  own_activation: number;
  market_activation: number;
  total_activation: number;
  target: number;
  remaining: number;
  yesterday_own: number;
  yesterday_market: number;
  yesterday_total: number;
}

interface CcRow {
  name: string;
  dms_code: string;
  own_activation: number;
  contribution: number;
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

interface HouseSummary {
  monthly_target: number;
  achievement: number;
  achievement_percentage: number;
  remaining: number;
  daily_required: number;
  daily_required_with_friday: number;
  days_remaining: number;
}

interface ExportPayload {
  houseName: string;
  houseCode: string;
  totalActivations: number;
  employeeActivation: number;
  marketActivation: number;
  summary: HouseSummary;
  rsos: RsoRow[];
  bps: BpRow[];
  ccs: CcRow[];
  supervisors: SupervisorRow[];
}

const BORDER = "000000";
const SECTION_BG = "9FA8DA";
const HEADER_BG = "C5CAE9";
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
  cell.font = { bold: true, size: 11, name: "Calibri", color: { argb: "000000" } };
  cell.alignment = { vertical: "middle", horizontal: "left" };
  cell.border = allBorders;
}

function headerRow(ws: ExcelJS.Worksheet, row: number, headers: string[], fillColor?: string) {
  const r = ws.getRow(row);
  headers.forEach((h, i) => {
    const cell = r.getCell(i + 1);
    cell.value = h;
    cell.font = { bold: true, size: 11, name: "Calibri", color: { argb: "000000" } };
    cell.alignment = { vertical: "middle", horizontal: "center" };
    cell.border = allBorders;
    if (fillColor) {
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: fillColor } };
    }
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
    cell.font = { bold: false, size: 11, name: "Calibri", color: { argb: TEXT_DARK } };
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
    cell.font = { bold: true, size: 11, name: "Calibri", color: { argb: TEXT_DARK } };
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
  const { houseName, houseCode, totalActivations, summary, rsos, bps, ccs, supervisors } = payload;
  const { monthly_target, achievement, achievement_percentage, remaining, daily_required, daily_required_with_friday } = summary;

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
  titleCell.font = { bold: true, size: 18, name: "Calibri", color: { argb: TEXT_DARK } };
  titleCell.alignment = { vertical: "middle", horizontal: "left" };

  function fmt(n: number): string {
    return n?.toLocaleString("en-US") ?? "0";
  }

  /* ── DD Target Summary Headers (E2:I2) ── */
  const ddHeaders = ["Target", "Ach", "%", "Remain", "DRR"];
  const ddHeaderRow = ws.getRow(2);
  ddHeaderRow.height = 24;
  ddHeaders.forEach((h, i) => {
    const cell = ddHeaderRow.getCell(5 + i);
    cell.value = h;
    cell.font = { bold: true, size: 11, name: "Calibri", color: { argb: TEXT_DARK } };
    cell.alignment = { vertical: "middle", horizontal: "center" };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: SECTION_BG } };
    cell.border = allBorders;
  });

  /* ── DD Target Summary Values (E3:I3) ── */
  const pctColor = achievement_percentage >= 100 ? MEDIUM_BG : achievement_percentage >= 70 ? "#10B981" : achievement_percentage >= 40 ? "#F59E0B" : "#EF4444";
  const dataRow3 = ws.getRow(3);
  dataRow3.height = 22;
  const ddValues = [fmt(monthly_target), fmt(achievement), "", "", fmt(daily_required_with_friday)];
  ddValues.forEach((val, i) => {
    const cell = dataRow3.getCell(5 + i);
    cell.value = val;
    cell.font = {
      color: { argb: i === 2 ? pctColor : TEXT_DARK },
      size: 11, name: "Calibri",
      bold: i === 2,
    };
    cell.alignment = { vertical: "middle", horizontal: "center" };
    cell.border = allBorders;
  });
  ws.getCell(3, 7).value = { formula: `IF(E3>0, ROUND(F3/E3*100, 1), 0)` };
  ws.getCell(3, 7).numFmt = '0.0"%"';
  ws.getCell(3, 7).alignment = { vertical: "middle", horizontal: "right" };
  ws.getCell(3, 8).value = { formula: `E3-F3` };

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
  houseCell.font = { bold: true, size: 11, name: "Calibri", color: { argb: TEXT_MUTED } };
  houseCell.alignment = { vertical: "middle", horizontal: "left" };

  /* ════════════════════════════════════════════
     ROW 4: Generated Info
     ════════════════════════════════════════════ */
  ws.mergeCells(4, 1, 4, 3);
  const genCell = ws.getCell("A4");
  genCell.value = `Generated: ${dateStr}, ${timeStr}`;
  genCell.font = { bold: true, size: 11, name: "Calibri", color: { argb: TEXT_MUTED } };
  genCell.alignment = { vertical: "middle", horizontal: "left" };

  /* ════════════════════════════════════════════
     RSO / BP / SUPERVISOR sections (dynamic row offsets)
     ════════════════════════════════════════════ */
  let r = 5;
  const daysRemaining = summary.days_remaining;
  const sortedRsos = [...rsos].sort((a, b) => (a.itop_number || '').localeCompare(b.itop_number || ''));
  const sortedBps = [...bps].sort((a, b) => (a.pool_number || '').localeCompare(b.pool_number || ''));

  /* ════════════════════════════════════════════
     RSO PERFORMANCE
     ════════════════════════════════════════════ */
  if (sortedRsos.length > 0) {
    const RSO_TITLE_ROW = r;
    ws.mergeCells(RSO_TITLE_ROW, 1, RSO_TITLE_ROW, 10);
    ws.mergeCells(RSO_TITLE_ROW, 11, RSO_TITLE_ROW, 13);
    const rsoTitleCell = ws.getCell(RSO_TITLE_ROW, 1);
    rsoTitleCell.value = "RSO PERFORMANCE";
    rsoTitleCell.font = { bold: true, size: 11, name: "Calibri", color: { argb: "000000" } };
    rsoTitleCell.alignment = { vertical: "middle", horizontal: "left" };
    rsoTitleCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: SECTION_BG } };
    rsoTitleCell.border = allBorders;
    const rsoYestCell = ws.getCell(RSO_TITLE_ROW, 11);
    rsoYestCell.value = "Yesterday";
    rsoYestCell.font = { bold: true, size: 11, name: "Calibri", color: { argb: "000000" } };
    rsoYestCell.alignment = { vertical: "middle", horizontal: "center" };
    rsoYestCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: MEDIUM_ORANGE } };
    rsoYestCell.border = allBorders;
    r++;

    const RSO_HEADER_ROW = r;
    headerRow(ws, RSO_HEADER_ROW, [
      "#", "Name", "ITop Number", "Assisted Code",
      "Today Target",
      "Own Code", "Market", "Total",
      "%", "Remain",
      "Own Code", "Market", "Total",
    ], HEADER_BG);
    [ws.getCell(RSO_HEADER_ROW, 11), ws.getCell(RSO_HEADER_ROW, 12), ws.getCell(RSO_HEADER_ROW, 13)].forEach((cell) => {
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: MEDIUM_ORANGE } };
    });
    r++;

    const RSO_DATA_START = r;
    sortedRsos.forEach((rsoItem, i) => {
      const drr = rsoItem.remaining > 0 ? Math.ceil(rsoItem.remaining / Math.max(daysRemaining, 1)) : 0;
      dataRow(ws, r, [
        i + 1,
        rsoItem.name,
        rsoItem.itop_number || "",
        rsoItem.assisted_code || "",
        drr,
        rsoItem.own_activation,
        rsoItem.market_activation,
        rsoItem.total_activation,
        "",
        "",
        rsoItem.yesterday_own,
        rsoItem.yesterday_market,
        rsoItem.yesterday_total,
      ]);
      ws.getCell(r, 9).value = { formula: `IF(E${r}>0, H${r}/E${r}, 0)` };
      ws.getCell(r, 9).numFmt = '0%';
      ws.getCell(r, 9).alignment = { vertical: "middle", horizontal: "right" };
      ws.getCell(r, 10).value = { formula: `MAX(0, E${r}-H${r})` };
      [11, 12, 13].forEach((ci) => {
        ws.getCell(r, ci).fill = { type: "pattern", pattern: "solid", fgColor: { argb: LIGHT_ORANGE } };
      });
      r++;
    });
    const RSO_DATA_END = r - 1;

    // 5 Arrows (Colored) icon set on Total (col H) and % (col I)
    if (RSO_DATA_START <= RSO_DATA_END) {
      ws.addConditionalFormatting({
        ref: `H${RSO_DATA_START}:H${RSO_DATA_END}`,
        rules: [{ type: 'iconSet' as any, iconSet: '5Arrows', cfvo: [
          { type: 'min' as any, value: 0 },
          { type: 'percent' as any, value: 20 },
          { type: 'percent' as any, value: 40 },
          { type: 'percent' as any, value: 60 },
          { type: 'percent' as any, value: 80 },
        ]}] as any,
      });
      ws.addConditionalFormatting({
        ref: `I${RSO_DATA_START}:I${RSO_DATA_END}`,
        rules: [{ type: 'iconSet' as any, iconSet: '5Arrows', cfvo: [
          { type: 'min' as any, value: 0 },
          { type: 'percent' as any, value: 20 },
          { type: 'percent' as any, value: 40 },
          { type: 'percent' as any, value: 60 },
          { type: 'percent' as any, value: 80 },
        ]}] as any,
      });
    }

    if (sortedRsos.length > 1) {
      const RSO_TOTAL_ROW = r;
      formulaRow(ws, RSO_TOTAL_ROW, ["E", "F", "G", "H", "J", "K", "L", "M"], RSO_DATA_START, RSO_DATA_END, "Total", 13);
      ws.getCell(RSO_TOTAL_ROW, 9).value = { formula: `IF(E${RSO_TOTAL_ROW}>0, H${RSO_TOTAL_ROW}/E${RSO_TOTAL_ROW}, 0)` };
      ws.getCell(RSO_TOTAL_ROW, 9).numFmt = '0%';
      ws.getCell(RSO_TOTAL_ROW, 9).alignment = { vertical: "middle", horizontal: "right" };
      [11, 12, 13].forEach((ci) => {
        ws.getCell(RSO_TOTAL_ROW, ci).fill = { type: "pattern", pattern: "solid", fgColor: { argb: LIGHT_ORANGE } };
      });
      r++;
    }
    r++; // spacer
  }

  /* ════════════════════════════════════════════
     BP PERFORMANCE
     ════════════════════════════════════════════ */
  if (sortedBps.length > 0) {
    const BP_TITLE_ROW = r;
    ws.mergeCells(BP_TITLE_ROW, 1, BP_TITLE_ROW, 9);
    const bpTitleCell = ws.getCell(BP_TITLE_ROW, 1);
    bpTitleCell.value = "BP PERFORMANCE";
    bpTitleCell.font = { bold: true, size: 11, name: "Calibri", color: { argb: "000000" } };
    bpTitleCell.alignment = { vertical: "middle", horizontal: "left" };
    bpTitleCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: SECTION_BG } };
    bpTitleCell.border = allBorders;
    r++;

    const BP_HEADER_ROW = r;
    headerRow(ws, BP_HEADER_ROW, [
      "#", "Name", "Pool Number", "Assisted Code",
      "Today Target",
      "Ach", "%", "Remain", "Yest GA",
    ], HEADER_BG);
    ws.getCell(BP_HEADER_ROW, 9).fill = { type: "pattern", pattern: "solid", fgColor: { argb: MEDIUM_ORANGE } };
    r++;

    const BP_DATA_START = r;
    sortedBps.forEach((bpItem, i) => {
      dataRow(ws, r, [
        i + 1,
        bpItem.name,
        bpItem.pool_number || "",
        bpItem.assisted_code || "",
        0,
        bpItem.own_activation,
        "",
        "",
        bpItem.yesterday_activation,
      ]);
      ws.getCell(r, 7).value = { formula: `IF(E${r}>0, F${r}/E${r}, 0)` };
      ws.getCell(r, 7).numFmt = '0%';
      ws.getCell(r, 7).alignment = { vertical: "middle", horizontal: "right" };
      ws.getCell(r, 8).value = { formula: `MAX(0, E${r}-F${r})` };
      ws.getCell(r, 9).fill = { type: "pattern", pattern: "solid", fgColor: { argb: LIGHT_ORANGE } };
      r++;
    });
    const BP_DATA_END = r - 1;

    // 5 Arrows (Colored) icon set on Ach/Total (col F) and % (col G)
    if (BP_DATA_START <= BP_DATA_END) {
      ws.addConditionalFormatting({
        ref: `F${BP_DATA_START}:F${BP_DATA_END}`,
        rules: [{ type: 'iconSet' as any, iconSet: '5Arrows', cfvo: [
          { type: 'min' as any, value: 0 },
          { type: 'percent' as any, value: 20 },
          { type: 'percent' as any, value: 40 },
          { type: 'percent' as any, value: 60 },
          { type: 'percent' as any, value: 80 },
        ]}] as any,
      });
      ws.addConditionalFormatting({
        ref: `G${BP_DATA_START}:G${BP_DATA_END}`,
        rules: [{ type: 'iconSet' as any, iconSet: '5Arrows', cfvo: [
          { type: 'min' as any, value: 0 },
          { type: 'percent' as any, value: 20 },
          { type: 'percent' as any, value: 40 },
          { type: 'percent' as any, value: 60 },
          { type: 'percent' as any, value: 80 },
        ]}] as any,
      });
    }

    if (sortedBps.length > 1) {
      const BP_TOTAL_ROW = r;
      formulaRow(ws, BP_TOTAL_ROW, ["E", "F", "H", "I"], BP_DATA_START, BP_DATA_END, "Total", 9);
      ws.getCell(BP_TOTAL_ROW, 7).value = { formula: `IF(E${BP_TOTAL_ROW}>0, F${BP_TOTAL_ROW}/E${BP_TOTAL_ROW}, 0)` };
      ws.getCell(BP_TOTAL_ROW, 7).numFmt = '0%';
      ws.getCell(BP_TOTAL_ROW, 7).alignment = { vertical: "middle", horizontal: "right" };
      ws.getCell(BP_TOTAL_ROW, 9).fill = { type: "pattern", pattern: "solid", fgColor: { argb: LIGHT_ORANGE } };
      r++;
    }
    r++; // spacer
  }

  /* ════════════════════════════════════════════
     CC PERFORMANCE
     ════════════════════════════════════════════ */
  const sortedCcs = [...ccs].sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  if (sortedCcs.length > 0) {
    const CC_TITLE_ROW = r;
    sectionTitle(ws, CC_TITLE_ROW, "CC PERFORMANCE", 4);
    ws.getCell(CC_TITLE_ROW, 1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: SECTION_BG } };
    r++;

    const CC_HEADER_ROW = r;
    headerRow(ws, CC_HEADER_ROW, [
      "#", "Name", "DMS Code", "Today GA",
    ], HEADER_BG);
    r++;

    const CC_DATA_START = r;
    sortedCcs.forEach((ccItem, i) => {
      dataRow(ws, r, [
        i + 1,
        ccItem.name,
        ccItem.dms_code || "",
        ccItem.own_activation,
      ]);
      r++;
    });
    const CC_DATA_END = r - 1;

    if (sortedCcs.length > 1) {
      const CC_TOTAL_ROW = r;
      formulaRow(ws, CC_TOTAL_ROW, ["D"], CC_DATA_START, CC_DATA_END, "Total", 4);
      r++;
    }
    r++; // spacer
  }

  /* ════════════════════════════════════════════
     SUPERVISOR PERFORMANCE
     ════════════════════════════════════════════ */
  if (supervisors.length > 0) {
    const SUP_TITLE_ROW = r;
    sectionTitle(ws, SUP_TITLE_ROW, "SUPERVISOR PERFORMANCE", 5);
    ws.getCell(SUP_TITLE_ROW, 1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: SECTION_BG } };
    r++;

    const SUP_HEADER_ROW = r;
    headerRow(ws, SUP_HEADER_ROW, [
      "#", "Name", "Pool Number", "Today GA", "Yest GA",
    ], HEADER_BG);
    r++;

    const SUP_DATA_START = r;
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
    const SUP_DATA_END = r - 1;

    if (supervisors.length > 1) {
      const SUP_TOTAL_ROW = r;
      formulaRow(ws, SUP_TOTAL_ROW, ["D", "E"], SUP_DATA_START, SUP_DATA_END, "Total", 5);
      r++;
    }
  }

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
