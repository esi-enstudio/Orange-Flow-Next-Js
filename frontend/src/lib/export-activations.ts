import ExcelJS from 'exceljs';

interface Summary {
  monthly_target: number;
  achievement: number;
  achievement_percentage: number;
  remaining: number;
  daily_required: number;
  daily_average: number;
  projection: number;
  expected_percentage: number;
  days_elapsed: number;
  days_remaining: number;
  total_days: number;
}

interface EmployeeRow {
  id: number;
  name: string;
  target: number;
  achievement: number;
  percentage: number;
  remaining: number;
  daily_average: number;
  projection: number;
  status: string;
  employee_type?: string;
  itop_number?: string;
  pool_number?: string;
  market_activation?: number;
  market_yesterday?: number;
  yesterday_activation?: number;
  month_total_activation?: number;
  active_days?: number;
}

interface ExportPayload {
  summary: Summary;
  rso_performance: EmployeeRow[];
  bp_performance: EmployeeRow[];
  cc_performance: EmployeeRow[];
  house_name?: string;
  month: number;
  year: number;
  month_name: string;
}

const PRIMARY = "7C3AED";
const PRIMARY_DARK = "5B21B6";
const HEADER_BG = "1E293B";
const SUBHEADER_BG = "F1F5F9";
const ROW_ALT = "F8FAFC";
const BORDER = "E2E8F0";
const WHITE = "FFFFFF";
const TEXT_DARK = "1E293B";
const TEXT_MUTED = "64748B";
const GREEN = "10B981";
const BLUE = "3B82F6";
const AMBER = "F59E0B";
const RED = "EF4444";

function fmt(n: number): string {
  if (n === undefined || n === null) return "—";
  return n.toLocaleString("en-US");
}

function fmt1(n: number): string {
  if (n === undefined || n === null) return "—";
  return Math.round(n).toLocaleString("en-US");
}

function statusLabel(s: string): string {
  const labels: Record<string, string> = {
    achieved: "Achieved",
    on_track: "On Track",
    needs_attention: "Needs Attention",
    behind: "Behind",
  };
  return labels[s] || s;
}

function statusColor(s: string): string {
  const colors: Record<string, string> = {
    achieved: GREEN,
    on_track: BLUE,
    needs_attention: AMBER,
    behind: RED,
  };
  return colors[s] || TEXT_MUTED;
}

function kpiStatus(pct: number): string {
  if (pct >= 100) return "Achieved";
  if (pct >= 70) return "On Track";
  if (pct >= 40) return "Needs Attention";
  return "Behind";
}

function kpiStatusColor(pct: number): string {
  if (pct >= 100) return GREEN;
  if (pct >= 70) return BLUE;
  if (pct >= 40) return AMBER;
  return RED;
}

function pctColor(p: number): string {
  if (p >= 100) return GREEN;
  if (p >= 70) return BLUE;
  if (p >= 40) return AMBER;
  return RED;
}

function addSectionHeader(ws: ExcelJS.Worksheet, row: number, label: string, cols: number): number {
  const r = ws.getRow(row);
  r.height = 32;
  for (let c = 1; c <= cols; c++) {
    const cell = r.getCell(c);
    cell.value = c === 1 ? label : "";
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: PRIMARY } };
    cell.font = { bold: true, color: { argb: WHITE }, size: 12, name: "Calibri" };
    cell.alignment = { vertical: "middle", horizontal: c === 1 ? "left" : "center" };
    cell.border = {
      top: { style: "thin", color: { argb: PRIMARY_DARK } },
      bottom: { style: "thin", color: { argb: PRIMARY_DARK } },
      left: c === 1 ? { style: "thin", color: { argb: PRIMARY_DARK } } : undefined,
      right: c === cols ? { style: "thin", color: { argb: PRIMARY_DARK } } : undefined,
    };
  }
  ws.mergeCells(row, 1, row, cols);
  return row + 1;
}

function addColHeaders(ws: ExcelJS.Worksheet, row: number, headers: string[], colStart: number = 1): number {
  const r = ws.getRow(row);
  r.height = 24;
  headers.forEach((h, i) => {
    const cell = r.getCell(colStart + i);
    cell.value = h;
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: SUBHEADER_BG } };
    cell.font = { bold: true, color: { argb: TEXT_DARK }, size: 10, name: "Calibri" };
    cell.alignment = { vertical: "middle", horizontal: i === 1 ? "left" : "center" };
    cell.border = {
      top: { style: "thin", color: { argb: BORDER } },
      bottom: { style: "thin", color: { argb: BORDER } },
      left: i === 0 ? { style: "thin", color: { argb: BORDER } } : undefined,
      right: i === headers.length - 1 ? { style: "thin", color: { argb: BORDER } } : undefined,
    };
  });
  return row + 1;
}

function addDataRow(ws: ExcelJS.Worksheet, row: number, cells: (string | number)[], colStart: number, alt: boolean, statusIdx: number = -1, pctIdx: number = -1): number {
  const r = ws.getRow(row);
  r.height = 22;
  cells.forEach((val, i) => {
    const cell = r.getCell(colStart + i);
    cell.value = val;
    cell.font = {
      color: { argb: i === statusIdx ? statusColor(String(val)) : i === pctIdx ? pctColor(Number(val) || 0) : TEXT_DARK },
      size: 10,
      name: "Calibri",
      bold: i === statusIdx || i === pctIdx,
    };
    cell.fill = alt
      ? { type: "pattern", pattern: "solid", fgColor: { argb: ROW_ALT } }
      : undefined;
    cell.alignment = { vertical: "middle", horizontal: i === 1 ? "left" : "center" };
    cell.border = {
      top: { style: "thin", color: { argb: BORDER } },
      bottom: { style: "thin", color: { argb: BORDER } },
      left: i === 0 ? { style: "thin", color: { argb: BORDER } } : undefined,
      right: i === cells.length - 1 ? { style: "thin", color: { argb: BORDER } } : undefined,
    };
  });
  return row + 1;
}

export async function exportActivationsReport(payload: ExportPayload): Promise<void> {
  const { summary, rso_performance, bp_performance, cc_performance, house_name, month, year, month_name } = payload;
  const now = new Date();
  const dateStr = now.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

  const wb = new ExcelJS.Workbook();
  wb.creator = "Orange Flow";
  const ws = wb.addWorksheet("Activation Report", {
    pageSetup: { orientation: "landscape", fitToPage: true, paperSize: 9, margins: { top: 0, bottom: 0, left: 0, right: 0, header: 0, footer: 0 } },
  });

  const COLS = 10;
  const colWidths = [5, 28, 16, 16, 16, 10, 14, 12, 14, 18];
  ws.columns = colWidths.map((w, i) => ({ key: String(i), width: w }));

  let r = 1;

  // ── Title bar ──
  const titleRow = ws.getRow(r);
  titleRow.height = 42;
  const titleCell = titleRow.getCell(1);
  titleCell.value = `ORANGE FLOW — Activation Report (${month_name} ${year})`;
  titleCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_BG } };
  titleCell.font = { bold: true, color: { argb: WHITE }, size: 16, name: "Calibri" };
  titleCell.alignment = { vertical: "middle", horizontal: "left" };
  for (let c = 2; c <= COLS; c++) {
    const cell = titleRow.getCell(c);
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_BG } };
  }
  ws.mergeCells(r, 1, r, COLS);
  r++;

  // ── Subtitle ──
  const subRow = ws.getRow(r);
  subRow.height = 22;
  const subCell = subRow.getCell(1);
  subCell.value = `${house_name ? `House: ${house_name}  |  ` : ""}Generated: ${dateStr}`;
  subCell.font = { color: { argb: TEXT_MUTED }, size: 10, name: "Calibri" };
  subCell.alignment = { vertical: "middle", horizontal: "left" };
  ws.mergeCells(r, 1, r, COLS);
  r++;

  // Empty row
  r++;

  // ── KPI SUMMARY ──
  r = addSectionHeader(ws, r, "KPI SUMMARY", 9);
  r = addColHeaders(ws, r, ["Monthly Target", "Achievement", "Achieved %", "Status", "Remaining", "Daily Avg", "Daily Required", "Projection", "Expected %"], 1);

  // KPI data row — all center aligned
  const kpiRow = ws.getRow(r);
  kpiRow.height = 22;
  const kpiValues = [
    fmt(summary.monthly_target),
    fmt(summary.achievement),
    `${summary.achievement_percentage}%`,
    kpiStatus(summary.achievement_percentage),
    fmt(summary.remaining),
    fmt1(summary.daily_average),
    fmt1(summary.daily_required),
    fmt1(summary.projection),
    `${summary.expected_percentage}%`,
  ];
  kpiValues.forEach((val, i) => {
    const cell = kpiRow.getCell(1 + i);
    cell.value = val;
    cell.font = {
      color: { argb: i === 2 ? kpiStatusColor(summary.achievement_percentage) : i === 3 ? statusColor(val === "Achieved" ? "achieved" : val === "On Track" ? "on_track" : val === "Needs Attention" ? "needs_attention" : "behind") : TEXT_DARK },
      size: 10,
      name: "Calibri",
      bold: i === 2 || i === 3,
    };
    cell.alignment = { vertical: "middle", horizontal: "center" };
    cell.border = {
      top: { style: "thin", color: { argb: BORDER } },
      bottom: { style: "thin", color: { argb: BORDER } },
      left: i === 0 ? { style: "thin", color: { argb: BORDER } } : undefined,
      right: i === kpiValues.length - 1 ? { style: "thin", color: { argb: BORDER } } : undefined,
    };
  });
  r++;

  // Days info
  const daysRow = ws.getRow(r);
  daysRow.height = 20;
  const daysCell = daysRow.getCell(1);
  daysCell.value = `Days Elapsed: ${summary.days_elapsed}/${summary.total_days}  |  Days Remaining: ${summary.days_remaining}`;
  daysCell.font = { italic: true, color: { argb: TEXT_MUTED }, size: 9, name: "Calibri" };
  daysCell.alignment = { vertical: "middle", horizontal: "center" };
  ws.mergeCells(r, 1, r, 9);
  for (let c = 2; c <= 9; c++) {
    const cell = daysRow.getCell(c);
    cell.alignment = { vertical: "middle", horizontal: "center" };
  }
  r++;

  // Empty row
  r++;

  // ── Helper to write a performance section ──
  const writeSection = (label: string, employees: EmployeeRow[], identLabel: string, identField: "itop_number" | "pool_number" | null) => {
    if (employees.length === 0) return;
    const isRso = label === "RSO PERFORMANCE";
    const isBp = label === "BP PERFORMANCE";
    const headers = isRso
      ? ["#", "Name", identLabel, "Target", "Achievement", "%", "Remaining", "Daily Avg", "Projection", "Market", "Own Activation", "Status"]
      : isBp
        ? ["#", "Name", identLabel, "Target", "Achievement", "%", "Remaining", "Daily Avg", "Projection", "Yesterday", "Day Count", "Status"]
        : ["#", "Name", identLabel, "Target", "Achievement", "%", "Remaining", "Daily Avg", "Projection", "Status"];
    const cols = isRso ? 12 : isBp ? 12 : 10;
    r = addSectionHeader(ws, r, label, cols);

    // Update column widths dynamically for RSO / BP
    if (isRso) {
      ws.columns = [
        { width: 5 },   // #
        { width: 28 },  // Name
        { width: 16 },  // Identifier
        { width: 16 },  // Target
        { width: 16 },  // Achievement
        { width: 10 },  // %
        { width: 14 },  // Remaining
        { width: 12 },  // Daily Avg
        { width: 14 },  // Projection
        { width: 14 },  // Market
        { width: 22 },  // Own Activation
        { width: 18 },  // Status
      ];
    } else if (isBp) {
      ws.columns = [
        { width: 5 },   // #
        { width: 28 },  // Name
        { width: 16 },  // Identifier
        { width: 16 },  // Target
        { width: 16 },  // Achievement
        { width: 10 },  // %
        { width: 14 },  // Remaining
        { width: 12 },  // Daily Avg
        { width: 14 },  // Projection
        { width: 12 },  // Yesterday
        { width: 12 },  // Day Count
        { width: 18 },  // Status
      ];
    }

    r = addColHeaders(ws, r, headers, 1);
    const pctIdx = 5;
    employees.forEach((emp, i) => {
      let ident = "—";
      if (identField === "itop_number" && emp.itop_number) ident = emp.itop_number;
      if (identField === "pool_number" && emp.pool_number) ident = emp.pool_number;
      const cells = isRso
        ? [
            i + 1, emp.name, ident,
            fmt(emp.target), fmt(emp.achievement), `${emp.percentage}%`,
            fmt(emp.remaining), fmt1(emp.daily_average), fmt1(emp.projection),
            `Yest ${fmt(emp.market_yesterday ?? 0)} / MTD ${fmt(emp.market_activation ?? 0)}`,
            `Yest ${fmt(emp.yesterday_activation ?? 0)} / MTD ${fmt(emp.month_total_activation ?? 0)} (Day ${emp.active_days ?? 0})`,
            statusLabel(emp.status),
          ]
        : isBp
          ? [
              i + 1, emp.name, ident,
              fmt(emp.target), fmt(emp.achievement), `${emp.percentage}%`,
              fmt(emp.remaining), fmt1(emp.daily_average), fmt1(emp.projection),
              fmt(emp.yesterday_activation ?? 0),
              String(emp.active_days ?? 0),
              statusLabel(emp.status),
            ]
          : [
              i + 1, emp.name, ident,
              fmt(emp.target), fmt(emp.achievement), `${emp.percentage}%`,
              fmt(emp.remaining), fmt1(emp.daily_average), fmt1(emp.projection),
              statusLabel(emp.status),
            ];
      addDataRow(ws, r, cells, 1, i % 2 === 1, cells.length - 1, pctIdx);
      r++;
    });
    r++;
  };

  writeSection("RSO PERFORMANCE", rso_performance, "Itopup Number", "itop_number");
  writeSection("BP PERFORMANCE", bp_performance, "Pool Number", "pool_number");
  writeSection("CC PERFORMANCE", cc_performance, "Identifier", null);

  // ── Generate file ──
  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.setAttribute("download", `activation_report_${year}_${month}.xlsx`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.URL.revokeObjectURL(url);
}
