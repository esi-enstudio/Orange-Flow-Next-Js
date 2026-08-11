import ExcelJS from 'exceljs';

interface Summary {
  monthly_target: number;
  ev_c2c_target: number;
  sc_primary_target: number;
  achievement: number;
  achievement_percentage: number;
  remaining: number;
  daily_required: number;
  daily_required_with_friday: number;
  daily_average: number;
  projection: number;
  expected_percentage: number;
  days_elapsed: number;
  days_remaining: number;
  total_days: number;
  yesterday_achievement: number;
  remaining_fridays?: number;
}

interface EmployeeRow {
  id: number;
  name: string;
  target: number;
  ev_target?: number;
  sc_target?: number;
  achievement: number;
  percentage: number;
  remaining: number;
  daily_average: number;
  projection: number;
  status: string;
  employee_type?: string;
  itop_number?: string;
  pool_number?: string;
  yesterday_achievement?: number;
}

interface ExportPayload {
  summary: Summary;
  rso_performance: EmployeeRow[];
  supervisor_performance: EmployeeRow[];
  house_name?: string;
  house_code?: string;
  month: number;
  year: number;
  month_name: string;
  report_type?: "recharge" | "ev_secondary";
  days_elapsed: number;
  total_days: number;
}

const PRIMARY = "7C3AED";
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
  const key = s.toLowerCase().replace(/\s+/g, "_");
  return colors[key] || TEXT_MUTED;
}

function timeBasedStatus(pct: number, daysElapsed: number, totalDays: number): string {
  if (pct >= 100) return "achieved";
  if (daysElapsed <= 7) {
    if (pct >= 70) return "on_track";
    if (pct >= 40) return "needs_attention";
    return "behind";
  }
  const timePct = totalDays > 0 ? (daysElapsed / totalDays) * 100 : 0;
  if (pct >= timePct) return "on_track";
  if (pct >= timePct * 0.5) return "needs_attention";
  return "behind";
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

function addSectionHeader(ws: ExcelJS.Worksheet, row: number, label: string, cols: number, fullBorder: boolean = false): number {
  const r = ws.getRow(row);
  for (let c = 1; c <= cols; c++) {
    const cell = r.getCell(c);
    cell.value = c === 1 ? label : "";
    cell.font = { bold: true, color: { argb: TEXT_DARK }, size: 11, name: "Calibri" };
    cell.alignment = { vertical: "middle", horizontal: c === 1 ? "left" : "center" };
    cell.border = fullBorder
      ? {
          top: { style: "thin", color: { argb: "000000" } },
          bottom: { style: "thin", color: { argb: "000000" } },
          left: { style: "thin", color: { argb: "000000" } },
          right: { style: "thin", color: { argb: "000000" } },
        }
      : {
          top: { style: "thin", color: { argb: BORDER } },
          bottom: { style: "thin", color: { argb: BORDER } },
          left: c === 1 ? { style: "thin", color: { argb: BORDER } } : undefined,
          right: c === cols ? { style: "thin", color: { argb: BORDER } } : undefined,
        };
  }
  ws.mergeCells(row, 1, row, cols);
  return row + 1;
}

function addColHeaders(ws: ExcelJS.Worksheet, row: number, headers: string[], colStart: number = 1, fullBorder: boolean = false): number {
  const r = ws.getRow(row);
  r.height = 24;
  headers.forEach((h, i) => {
    const cell = r.getCell(colStart + i);
    cell.value = h;
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: SUBHEADER_BG } };
    cell.font = { bold: true, color: { argb: TEXT_DARK }, size: 10, name: "Calibri" };
    cell.alignment = { vertical: "middle", horizontal: i === 1 ? "left" : "center" };
    cell.border = fullBorder
      ? {
          top: { style: "thin", color: { argb: "000000" } },
          bottom: { style: "thin", color: { argb: "000000" } },
          left: { style: "thin", color: { argb: "000000" } },
          right: { style: "thin", color: { argb: "000000" } },
        }
      : {
          top: { style: "thin", color: { argb: BORDER } },
          bottom: { style: "thin", color: { argb: BORDER } },
          left: i === 0 ? { style: "thin", color: { argb: BORDER } } : undefined,
          right: i === headers.length - 1 ? { style: "thin", color: { argb: BORDER } } : undefined,
        };
  });
  return row + 1;
}

function addDataRow(ws: ExcelJS.Worksheet, row: number, cells: (string | number)[], colStart: number, alt: boolean, statusIdx: number = -1, pctIdx: number = -1, fullBorder: boolean = false): number {
  const r = ws.getRow(row);
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
    cell.border = fullBorder
      ? {
          top: { style: "thin", color: { argb: "000000" } },
          bottom: { style: "thin", color: { argb: "000000" } },
          left: { style: "thin", color: { argb: "000000" } },
          right: { style: "thin", color: { argb: "000000" } },
        }
      : {
          top: { style: "thin", color: { argb: BORDER } },
          bottom: { style: "thin", color: { argb: BORDER } },
          left: i === 0 ? { style: "thin", color: { argb: BORDER } } : undefined,
          right: i === cells.length - 1 ? { style: "thin", color: { argb: BORDER } } : undefined,
        };
  });
  return row + 1;
}

export async function exportRechargeReport(payload: ExportPayload): Promise<void> {
  const { summary, rso_performance, supervisor_performance, house_name, house_code, month, year, month_name, report_type, days_elapsed, total_days } = payload;
  const now = new Date();
  const dateStr = now.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  const isEv = report_type === "ev_secondary";
  const reportTitle = isEv ? "EV C2C Report" : "Recharge Report (C2C)";

  const wb = new ExcelJS.Workbook();
  wb.creator = "Orange Flow";
  const ws = wb.addWorksheet("Recharge Report", {
    pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9, margins: { top: 0, bottom: 0, left: 0, right: 0, header: 0, footer: 0 } },
  });

  const colWidths = [5, 30, 20, 18, 18, 10, 14, 18, 14, 16, 18, 24];
  ws.columns = colWidths.map((w, i) => ({ key: String(i), width: w }));

  let r = 1;

  ws.mergeCells(1, 1, 2, 3);
  const titleCell = ws.getCell('A1');
  titleCell.value = `${reportTitle} - ${month_name} ${year}`;
  titleCell.font = { bold: true, color: { argb: TEXT_DARK }, size: 14, name: "Calibri" };
  titleCell.alignment = { vertical: "middle", horizontal: "left" };
  titleCell.border = {
    top: { style: "thin", color: { argb: "000000" } },
    bottom: { style: "thin", color: { argb: "000000" } },
    left: { style: "thin", color: { argb: "000000" } },
    right: { style: "thin", color: { argb: "000000" } },
  };

  const hsColStart = 4;
  const hsHeaders = ["Target", "Ach", "%", "Remain", "DRR", "D.Avg", "Projection", "Yesterday", "Expected %", "Status"];
  const headerRow = ws.getRow(1);
  headerRow.height = 24;
  hsHeaders.forEach((h, i) => {
    const cell = headerRow.getCell(hsColStart + i);
    cell.value = h;
    cell.font = { bold: true, color: { argb: TEXT_DARK }, size: 10, name: "Calibri" };
    cell.alignment = { vertical: "middle", horizontal: "center" };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: SUBHEADER_BG } };
    cell.border = {
      top: { style: "thin", color: { argb: "000000" } },
      bottom: { style: "thin", color: { argb: "000000" } },
      left: { style: "thin", color: { argb: "000000" } },
      right: { style: "thin", color: { argb: "000000" } },
    };
  });

  const dataRow = ws.getRow(2);
  const statusStr = timeBasedStatus(summary.achievement_percentage, days_elapsed, total_days).toLowerCase().replace(/\s+/g, "_");
  const hsValues = [
    fmt(summary.monthly_target),
    fmt(summary.achievement),
    `${summary.achievement_percentage}%`,
    fmt(summary.remaining),
    `${fmt1(summary.daily_required)} / F:${fmt1(summary.daily_required_with_friday)}`,
    fmt1(summary.daily_average),
    fmt1(summary.projection),
    fmt(summary.yesterday_achievement),
    `${summary.expected_percentage}%`,
    statusLabel(statusStr),
  ];
  hsValues.forEach((val, i) => {
    const cell = dataRow.getCell(hsColStart + i);
    cell.value = val;
    cell.font = {
      color: { argb: i === 2 ? kpiStatusColor(summary.achievement_percentage) : i === 9 ? statusColor(statusStr) : TEXT_DARK },
      size: 10,
      name: "Calibri",
      bold: i === 2 || i === 9,
    };
    cell.alignment = { vertical: "middle", horizontal: "center" };
    cell.border = {
      top: { style: "thin", color: { argb: "000000" } },
      bottom: { style: "thin", color: { argb: "000000" } },
      left: { style: "thin", color: { argb: "000000" } },
      right: { style: "thin", color: { argb: "000000" } },
    };
  });

  r = 3;

  ws.mergeCells(3, 1, 4, 3);
  const subCell = ws.getCell('A3');
  subCell.value = `${house_name ? `House: ${house_name} (${house_code})\n` : ""}Generated: ${dateStr}`;
  subCell.font = { color: { argb: TEXT_MUTED }, size: 10, name: "Calibri" };
  subCell.alignment = { vertical: "middle", horizontal: "left", wrapText: true };

  ws.mergeCells(3, 4, 3, 13);
  const daysCell = ws.getCell('D3');
  daysCell.value = `Days Elapsed: ${summary.days_elapsed}/${summary.total_days}  |  Days Remaining: ${summary.days_remaining}`;
  daysCell.font = { italic: true, color: { argb: TEXT_MUTED }, size: 9, name: "Calibri" };
  daysCell.alignment = { vertical: "middle", horizontal: "center" };

  r = 5;

  const writeSection = (label: string, employees: EmployeeRow[], identField: "itop_number" | "pool_number" | null) => {
    if (employees.length === 0) return;
    const isSupervisor = label === "SUPERVISOR PERFORMANCE";
    const baseHeaders = isSupervisor ? ["#", "Name", "Pool"] : ["#", "Name", "Itop"];
    const extraHeaders = isEv ? [] : ["EV Tgt", "SC Tgt"];
    const headers = [...baseHeaders, "Target", ...extraHeaders, "Ach", "%", "Remain", "DRR", "D.Avg", "Projection", "Status"];
    const fullBorder = true;
    const cols = headers.length;
    const pctIdx = headers.indexOf("%");
    r = addSectionHeader(ws, r, label, cols, fullBorder);
    r = addColHeaders(ws, r, headers, 1, fullBorder);
    employees.forEach((emp, i) => {
      let ident = "—";
      if (identField === "itop_number" && emp.itop_number) ident = emp.itop_number;
      if (identField === "pool_number" && emp.pool_number) ident = emp.pool_number;
      const drrWithF = Math.ceil(emp.remaining / Math.max(summary.days_remaining + (summary.remaining_fridays ?? 0), 1));
      const drrWithoutF = Math.ceil(emp.remaining / Math.max(summary.days_remaining, 1));
      const cells = isEv
        ? [
            i + 1, emp.name, ident,
            fmt(emp.target),
            fmt(emp.achievement), `${emp.percentage}%`,
            fmt(emp.remaining),
            `${drrWithoutF} / F:${drrWithF}`,
            fmt1(emp.daily_average), `${fmt1(emp.projection)} (${Math.round(emp.projection / Math.max(emp.target, 1) * 100)}%)`,
            timeBasedStatus(emp.percentage, days_elapsed, total_days),
          ]
        : [
            i + 1, emp.name, ident,
            fmt(emp.target), fmt(emp.ev_target ?? 0), fmt(emp.sc_target ?? 0),
            fmt(emp.achievement), `${emp.percentage}%`,
            fmt(emp.remaining),
            `${drrWithoutF} / F:${drrWithF}`,
            fmt1(emp.daily_average), `${fmt1(emp.projection)} (${Math.round(emp.projection / Math.max(emp.target, 1) * 100)}%)`,
            timeBasedStatus(emp.percentage, days_elapsed, total_days),
          ];
      addDataRow(ws, r, cells, 1, i % 2 === 1, cells.length - 1, pctIdx, fullBorder);
      r++;
    });
    if (employees.length > 0) {
      const totalTarget = employees.reduce((s, e) => s + e.target, 0);
      const totalAchieved = employees.reduce((s, e) => s + e.achievement, 0);
      const totalPct = totalTarget ? Math.round(totalAchieved / totalTarget * 100) : 0;
      const totalRemaining = employees.reduce((s, e) => s + e.remaining, 0);
      const totalDailyAvg = totalAchieved / Math.max(days_elapsed, 1);
      const totalProjection = employees.reduce((s, e) => s + e.projection, 0);
      const totalProjPct = totalTarget ? Math.round(totalProjection / totalTarget * 100) : 0;
      const totalDRRwithF = Math.ceil(totalRemaining / Math.max(summary.days_remaining + (summary.remaining_fridays ?? 0), 1));
      const totalDRRwithoutF = Math.ceil(totalRemaining / Math.max(summary.days_remaining, 1));
      const evTotal = employees.reduce((s, e) => s + (e.ev_target ?? 0), 0);
      const scTotal = employees.reduce((s, e) => s + (e.sc_target ?? 0), 0);
      const subtotalCells = isEv
        ? [
            "", "Subtotal", "",
            fmt(totalTarget),
            fmt(totalAchieved), `${totalPct}%`,
            fmt(totalRemaining), `${totalDRRwithoutF} / F:${totalDRRwithF}`, fmt1(Math.round(totalDailyAvg)),
            `${fmt1(Math.round(totalProjection))} (${totalProjPct}%)`,
            timeBasedStatus(totalPct, days_elapsed, total_days),
          ]
        : [
            "", "Subtotal", "",
            fmt(totalTarget), fmt(evTotal), fmt(scTotal),
            fmt(totalAchieved), `${totalPct}%`,
            fmt(totalRemaining), `${totalDRRwithoutF} / F:${totalDRRwithF}`, fmt1(Math.round(totalDailyAvg)),
            `${fmt1(Math.round(totalProjection))} (${totalProjPct}%)`,
            timeBasedStatus(totalPct, days_elapsed, total_days),
          ];
      const subRow = ws.getRow(r);
      subtotalCells.forEach((val, i) => {
        const cell = subRow.getCell(1 + i);
        cell.value = val;
        const isStatus = i === subtotalCells.length - 1;
        const isPct = i === pctIdx;
        cell.font = {
          bold: true,
          color: { argb: isStatus ? statusColor(String(val)) : isPct ? pctColor(Number(String(val).replace('%', '')) || 0) : TEXT_DARK },
          size: 10,
          name: "Calibri",
        };
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: ROW_ALT } };
        cell.alignment = { vertical: "middle", horizontal: i === 1 ? "left" : "center" };
        cell.border = fullBorder
          ? {
              top: { style: "thin", color: { argb: "000000" } },
              bottom: { style: "thin", color: { argb: "000000" } },
              left: { style: "thin", color: { argb: "000000" } },
              right: { style: "thin", color: { argb: "000000" } },
            }
          : {
              top: { style: "thin", color: { argb: BORDER } },
              bottom: { style: "thin", color: { argb: BORDER } },
              left: i === 0 ? { style: "thin", color: { argb: BORDER } } : undefined,
              right: i === subtotalCells.length - 1 ? { style: "thin", color: { argb: BORDER } } : undefined,
            };
      });
      r++;
    }
    r++;
  };

  writeSection("RSO PERFORMANCE", rso_performance, "itop_number");
  writeSection("SUPERVISOR PERFORMANCE", supervisor_performance, "pool_number");

  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.setAttribute("download", `recharge_report_${year}_${month}.xlsx`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.URL.revokeObjectURL(url);
}
