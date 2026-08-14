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
  yesterday_activation: number;
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

interface PrintPayload {
  summary: Summary;
  rso_performance: EmployeeRow[];
  bp_performance: EmployeeRow[];
  cc_performance: EmployeeRow[];
  supervisor_performance: EmployeeRow[];
  house_name?: string;
  house_code?: string;
  month: number;
  year: number;
  month_name: string;
  days_elapsed: number;
  total_days: number;
}

function fmt(n: number): string {
  if (n === undefined || n === null) return "—";
  return n.toLocaleString("en-US");
}

function fmt1(n: number): string {
  if (n === undefined || n === null) return "—";
  return Math.round(n).toLocaleString("en-US");
}

function projectionStatus(achPct: number, projPct: number): string {
  if (achPct >= 100) return "Achieved";
  if (projPct >= 100) return "On Track";
  if (projPct >= 95) return "Needs Attention";
  return "Behind";
}

function statusColor(s: string): string {
  const key = s.toLowerCase().replace(/\s+/g, "_");
  if (key === "achieved") return "#10B981";
  if (key === "on_track") return "#3B82F6";
  if (key === "needs_attention") return "#F59E0B";
  if (key === "behind") return "#EF4444";
  return "#64748B";
}

export function printActivationsReport(payload: PrintPayload, returnHtmlOnly?: boolean, imageMode?: boolean): string | void {
  const { summary, rso_performance, bp_performance, cc_performance, supervisor_performance, house_name, house_code, month, year, month_name, days_elapsed, total_days } = payload;
  const now = new Date();
  const dateStr = now.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

  const statusStr = projectionStatus(summary.achievement_percentage, Math.round(summary.projection / Math.max(summary.monthly_target, 1) * 100)).toLowerCase().replace(/\s+/g, "_");

  function sectionTable(label: string, employees: EmployeeRow[], identLabel: string, headers: string[], renderRow: (emp: EmployeeRow, i: number) => string[], renderSubtotal: () => string[]): string {
    if (employees.length === 0) return "";
    const totalTarget = employees.reduce((s, e) => s + e.target, 0);
    const totalAchieved = employees.reduce((s, e) => s + e.achievement, 0);
    const totalPct = totalTarget ? Math.round(totalAchieved / totalTarget * 100) : 0;
    const totalRemaining = employees.reduce((s, e) => s + e.remaining, 0);
    const totalDailyAvg = totalAchieved / Math.max(days_elapsed, 1);
    const totalProjection = employees.reduce((s, e) => s + e.projection, 0);
    const totalProjPct = totalTarget ? Math.round(totalProjection / totalTarget * 100) : 0;
    const totalDRR = Math.ceil(totalRemaining / Math.max(summary.days_remaining, 1));

    const rows = employees.map((emp, i) => {
      const cells = renderRow(emp, i);
      return `<tr${i % 2 === 1 ? ' style="background:#F8FAFC"' : ''}>
        ${cells.map((c, ci) => {
          const isStatus = ci === cells.length - 1;
          const isPct = ci === 5;
          const color = isStatus ? statusColor(c) : isPct ? (Number(String(c).replace('%', '')) >= 100 ? "#10B981" : Number(String(c).replace('%', '')) >= 70 ? "#3B82F6" : Number(String(c).replace('%', '')) >= 40 ? "#F59E0B" : "#EF4444") : "#1E293B";
          return `<td style="padding:3px 5px;border:1px solid #E2E8F0;text-align:${ci === 1 ? 'left' : 'center'};font-size:11px;color:${color};font-weight:${isStatus || isPct ? '700' : '400'}">${c}</td>`;
        }).join('')}
      </tr>`;
    }).join('');

    const subCells = renderSubtotal();
    const subtotal = `<tr style="background:#F8FAFC;font-weight:700">
      ${subCells.map((c, ci) => {
        const isStatus = ci === subCells.length - 1;
        const isPct = ci === 5;
        const color = isStatus ? statusColor(c) : isPct ? (Number(String(c).replace('%', '')) >= 100 ? "#10B981" : Number(String(c).replace('%', '')) >= 70 ? "#3B82F6" : Number(String(c).replace('%', '')) >= 40 ? "#F59E0B" : "#EF4444") : "#1E293B";
        return `<td style="padding:3px 5px;border:1px solid #E2E8F0;text-align:${ci === 1 ? 'left' : 'center'};font-size:11px;color:${color}">${c}</td>`;
      }).join('')}
    </tr>`;

    return `
      <h3 style="margin:20px 0 8px;font-size:14px;font-weight:700;color:#1E293B">${label}</h3>
      <table style="width:100%;border-collapse:collapse;margin-bottom:4px">
        <thead>
          <tr style="background:#F1F5F9">
            ${headers.map((h, i) => `<th style="padding:3px 5px;border:1px solid #E2E8F0;text-align:${i === 1 ? 'left' : 'center'};font-size:11px;font-weight:700;color:#1E293B">${h}</th>`).join('')}
          </tr>
        </thead>
        <tbody>
          ${rows}
          ${subtotal}
        </tbody>
      </table>
    `;
  }

  const rsoHeaders = ["#", "Name", "Itopup Number", "Target", "Ach", "%", "Remain", "DRR", "D.Avg", "Projection", "Market", "Own Activation", "Status"];
  const bpHeaders = ["#", "Name", "Pool Number", "Target", "Ach", "%", "Remain", "DRR", "D.Avg", "Projection", "Yesterday", "Day Count", "Status"];
  const ccHeaders = ["#", "Name", "Identifier", "Target", "Ach", "%", "Remain", "D.Avg", "Projection", "Status"];
  const supHeaders = ["#", "Name", "Pool Number", "Target", "Ach", "%", "Remain", "DRR", "D.Avg", "Projection", "Yesterday", "Status"];

  const rsoHtml = sectionTable("RSO PERFORMANCE", rso_performance, "Itopup Number", rsoHeaders,
    (emp) => [
      String(emp.achievement),
    ],
    () => []
  );

  const html = `<!DOCTYPE html>
<html>
<head><title>Activation Report - ${month_name} ${year}</title>
<style>
  @page { size: landscape; margin: 2mm; }
  @media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
  body { font-family: Calibri, Arial, sans-serif; margin: 0; color: #1E293B; font-size: 11px; }
  table { font-size: 11px; border-collapse: collapse; table-layout: fixed; width: 100%; }
  th, td { padding: 3px 5px; font-size: 11px; line-height: 1.25; word-wrap: break-word; overflow-wrap: break-word; }
  h1 { font-size: 16px !important; margin: 0 0 2px !important; }
  h3 { font-size: 13px !important; margin: 6px 0 3px !important; }
  .info { font-size: 10px; }
  .footer { font-size: 9px; }
</style>
${imageMode ? `<style>
  /* Image mode: larger fonts + landscape layout for WhatsApp/image share. */
  html, body { width: 1700px !important; }
  body { font-size: 15px !important; column-count: 2; column-gap: 24px; }
  table { font-size: 15px !important; }
  th, td { font-size: 15px !important; padding: 5px 8px !important; line-height: 1.35 !important; }
  h1 { font-size: 24px !important; column-span: all; }
  h3 { font-size: 20px !important; margin: 10px 0 5px !important; }
  .info { font-size: 14px !important; column-span: all; }
  .footer { font-size: 13px !important; column-span: all; }
  /* keep each section (heading + table) together; don't split across columns */
  h3, table { break-inside: avoid; page-break-inside: avoid; }
</style>` : ''}
</head>
<body>
  <h1 style="font-size:16px;margin:0 0 2px;color:#1E293B">Activation Report (${month_name} ${year})</h1>
  <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
    <div class="info" style="color:#64748B">${house_name ? `House: ${house_name} (${house_code})` : ""} | Generated: ${dateStr}</div>
    <div class="info" style="color:#64748B;font-style:italic">Days Elapsed: ${summary.days_elapsed}/${summary.total_days} | Days Remaining: ${summary.days_remaining}</div>
  </div>

  <h3 style="font-size:13px;font-weight:700;color:#1E293B;margin:0 0 4px">HOUSE SUMMARY</h3>
  <table style="width:100%;border-collapse:collapse;margin-bottom:6px">
    <thead>
      <tr style="background:#F1F5F9">
        ${["Target","Ach","%","Remaining","DRR","D.Avg","Projection","Yesterday","Expected %","Status"].map((h, i) => { const w = ["10%","9%","7%","11%","7%","8%","11%","11%","9%","17%"][i]; return `<th style="width:${w};padding:3px 5px;border:1px solid #E2E8F0;text-align:center;font-size:11px;font-weight:700;color:#1E293B">${h}</th>`; }).join('')}
      </tr>
    </thead>
    <tbody>
      <tr>
        ${[fmt(summary.monthly_target), fmt(summary.achievement), `${summary.achievement_percentage}%`, fmt(summary.remaining), fmt1(summary.daily_required), fmt1(summary.daily_average), fmt1(summary.projection), fmt(summary.yesterday_activation), `${summary.expected_percentage}%`, projectionStatus(summary.achievement_percentage, Math.round(summary.projection / Math.max(summary.monthly_target, 1) * 100))].map((val, i) => {
          const isPct = i === 2;
          const isStatus = i === 9;
          const pctNum = isPct ? summary.achievement_percentage : 0;
          const color = isStatus ? statusColor(val) : isPct ? (pctNum >= 100 ? "#10B981" : pctNum >= 70 ? "#3B82F6" : pctNum >= 40 ? "#F59E0B" : "#EF4444") : "#1E293B";
          return `<td style="padding:3px 5px;border:1px solid #E2E8F0;text-align:center;font-size:11px;color:${color};font-weight:${isStatus || isPct ? '700' : '400'}">${val}</td>`;
        }).join('')}
      </tr>
    </tbody>
  </table>

  <h3 style="margin:8px 0 4px;font-size:13px;font-weight:700;color:#1E293B">RSO PERFORMANCE</h3>
  <table style="width:100%;border-collapse:collapse;margin-bottom:2px">
    <thead>
      <tr style="background:#F1F5F9">
        ${rsoHeaders.map((h, i) => { const w = ["3%","13%","8%","6%","6%","5%","8%","5%","6%","9%","11%","14%","6%"][i]; return `<th style="width:${w};padding:3px 5px;border:1px solid #E2E8F0;text-align:${i === 1 ? 'left' : 'center'};font-size:11px;font-weight:700;color:#1E293B">${h}</th>`; }).join('')}
      </tr>
    </thead>
    <tbody>
      ${rso_performance.map((emp, i) => {
        const cells = [
          String(i + 1), emp.name, emp.itop_number || "—",
          fmt(emp.target), fmt(emp.achievement), `${emp.percentage}%`,
          fmt(emp.remaining),
          String(Math.ceil(emp.remaining / Math.max(summary.days_remaining, 1))),
          fmt1(emp.daily_average), `${fmt1(emp.projection)} (${Math.round(emp.projection / Math.max(emp.target, 1) * 100)}%)`,
          `Yest ${fmt(emp.market_yesterday ?? 0)} / MTD ${fmt(emp.market_activation ?? 0)}`,
          `Yest ${fmt(emp.yesterday_activation ?? 0)} / MTD ${fmt(emp.month_total_activation ?? 0)} (Day ${emp.active_days ?? 0})`,
          projectionStatus(emp.percentage, Math.round(emp.projection / Math.max(emp.target, 1) * 100)),
        ];
        return `<tr${i % 2 === 1 ? ' style="background:#F8FAFC"' : ''}>
          ${cells.map((c, ci) => {
            const isStatus = ci === cells.length - 1;
            const isPct = ci === 5;
            const numVal = Number(String(c).replace('%', ''));
            const color = isStatus ? statusColor(c) : isPct ? (numVal >= 100 ? "#10B981" : numVal >= 70 ? "#3B82F6" : numVal >= 40 ? "#F59E0B" : "#EF4444") : "#1E293B";
            return `<td style="padding:3px 5px;border:1px solid #E2E8F0;text-align:${ci === 1 ? 'left' : 'center'};font-size:11px;color:${color};font-weight:${isStatus || isPct ? '700' : '400'}">${c}</td>`;
          }).join('')}
        </tr>`;
      }).join('')}
      ${rso_performance.length > 0 ? (() => {
        const t = rso_performance.reduce((s, e) => s + e.target, 0);
        const a = rso_performance.reduce((s, e) => s + e.achievement, 0);
        const p = t ? Math.round(a / t * 100) : 0;
        const r = rso_performance.reduce((s, e) => s + e.remaining, 0);
        const da = a / Math.max(days_elapsed, 1);
        const pr = rso_performance.reduce((s, e) => s + e.projection, 0);
        const pp = t ? Math.round(pr / t * 100) : 0;
        const drr = Math.ceil(r / Math.max(summary.days_remaining, 1));
        const subCells = [
          "", "Subtotal", "",
          fmt(t), fmt(a), `${p}%`,
          fmt(r), String(drr), fmt1(Math.round(da)),
          `${fmt1(Math.round(pr))} (${pp}%)`,
          `Yest ${fmt(rso_performance.reduce((s, e) => s + (e.market_yesterday ?? 0), 0))} / MTD ${fmt(rso_performance.reduce((s, e) => s + (e.market_activation ?? 0), 0))}`,
          `Yest ${fmt(rso_performance.reduce((s, e) => s + (e.yesterday_activation ?? 0), 0))} / MTD ${fmt(rso_performance.reduce((s, e) => s + (e.month_total_activation ?? 0), 0))} (Day ${rso_performance.reduce((s, e) => s + (e.active_days ?? 0), 0)})`,
          projectionStatus(p, pp),
        ];
        return `<tr style="background:#F8FAFC;font-weight:700">
          ${subCells.map((c, ci) => {
            const isStatus = ci === subCells.length - 1;
            const isPct = ci === 5;
            const numVal = Number(String(c).replace('%', ''));
            const color = isStatus ? statusColor(c) : isPct ? (numVal >= 100 ? "#10B981" : numVal >= 70 ? "#3B82F6" : numVal >= 40 ? "#F59E0B" : "#EF4444") : "#1E293B";
            return `<td style="padding:3px 5px;border:1px solid #E2E8F0;text-align:${ci === 1 ? 'left' : 'center'};font-size:11px;color:${color}">${c}</td>`;
          }).join('')}
        </tr>`;
      })() : ''}
    </tbody>
  </table>

  ${bp_performance.length > 0 ? `
  <h3 style="margin:8px 0 4px;font-size:13px;font-weight:700;color:#1E293B">BP PERFORMANCE</h3>
  <table style="width:100%;border-collapse:collapse;margin-bottom:2px">
    <thead>
      <tr style="background:#F1F5F9">
        ${bpHeaders.map((h, i) => { const w = ["3%","14%","8%","6%","6%","5%","8%","5%","6%","9%","14%","10%","6%"][i]; return `<th style="width:${w};padding:3px 5px;border:1px solid #E2E8F0;text-align:${i === 1 ? 'left' : 'center'};font-size:11px;font-weight:700;color:#1E293B">${h}</th>`; }).join('')}
      </tr>
    </thead>
    <tbody>
      ${bp_performance.map((emp, i) => {
        const cells = [
          String(i + 1), emp.name, emp.pool_number || "—",
          fmt(emp.target), fmt(emp.achievement), `${emp.percentage}%`,
          fmt(emp.remaining),
          String(Math.ceil(emp.remaining / Math.max(summary.days_remaining, 1))),
          fmt1(emp.daily_average), `${fmt1(emp.projection)} (${Math.round(emp.projection / Math.max(emp.target, 1) * 100)}%)`,
          fmt(emp.yesterday_activation ?? 0),
          String(emp.active_days ?? 0),
          projectionStatus(emp.percentage, Math.round(emp.projection / Math.max(emp.target, 1) * 100)),
        ];
        return `<tr${i % 2 === 1 ? ' style="background:#F8FAFC"' : ''}>
          ${cells.map((c, ci) => {
            const isStatus = ci === cells.length - 1;
            const isPct = ci === 5;
            const numVal = Number(String(c).replace('%', ''));
            const color = isStatus ? statusColor(c) : isPct ? (numVal >= 100 ? "#10B981" : numVal >= 70 ? "#3B82F6" : numVal >= 40 ? "#F59E0B" : "#EF4444") : "#1E293B";
            return `<td style="padding:3px 5px;border:1px solid #E2E8F0;text-align:${ci === 1 ? 'left' : 'center'};font-size:11px;color:${color};font-weight:${isStatus || isPct ? '700' : '400'}">${c}</td>`;
          }).join('')}
        </tr>`;
      }).join('')}
      ${bp_performance.length > 0 ? (() => {
        const t = bp_performance.reduce((s, e) => s + e.target, 0);
        const a = bp_performance.reduce((s, e) => s + e.achievement, 0);
        const p = t ? Math.round(a / t * 100) : 0;
        const r = bp_performance.reduce((s, e) => s + e.remaining, 0);
        const da = a / Math.max(days_elapsed, 1);
        const pr = bp_performance.reduce((s, e) => s + e.projection, 0);
        const pp = t ? Math.round(pr / t * 100) : 0;
        const drr = Math.ceil(r / Math.max(summary.days_remaining, 1));
        const subCells = [
          "", "Subtotal", "",
          fmt(t), fmt(a), `${p}%`,
          fmt(r), String(drr), fmt1(Math.round(da)),
          `${fmt1(Math.round(pr))} (${pp}%)`,
          fmt(bp_performance.reduce((s, e) => s + (e.yesterday_activation ?? 0), 0)),
          String(bp_performance.reduce((s, e) => s + (e.active_days ?? 0), 0)),
          projectionStatus(p, pp),
        ];
        return `<tr style="background:#F8FAFC;font-weight:700">
          ${subCells.map((c, ci) => {
            const isStatus = ci === subCells.length - 1;
            const isPct = ci === 5;
            const numVal = Number(String(c).replace('%', ''));
            const color = isStatus ? statusColor(c) : isPct ? (numVal >= 100 ? "#10B981" : numVal >= 70 ? "#3B82F6" : numVal >= 40 ? "#F59E0B" : "#EF4444") : "#1E293B";
            return `<td style="padding:3px 5px;border:1px solid #E2E8F0;text-align:${ci === 1 ? 'left' : 'center'};font-size:11px;color:${color}">${c}</td>`;
          }).join('')}
        </tr>`;
      })() : ''}
    </tbody>
  </table>` : ''}

  ${cc_performance.length > 0 ? `
  <h3 style="margin:8px 0 4px;font-size:13px;font-weight:700;color:#1E293B">CC PERFORMANCE</h3>
  <table style="width:100%;border-collapse:collapse;margin-bottom:2px">
    <thead>
      <tr style="background:#F1F5F9">
        ${ccHeaders.map((h, i) => { const w = ["4%","16%","12%","9%","9%","7%","10%","10%","12%","11%"][i]; return `<th style="width:${w};padding:3px 5px;border:1px solid #E2E8F0;text-align:${i === 1 ? 'left' : 'center'};font-size:11px;font-weight:700;color:#1E293B">${h}</th>`; }).join('')}
      </tr>
    </thead>
    <tbody>
      ${cc_performance.map((emp, i) => {
        const cells = [
          String(i + 1), emp.name, "—",
          fmt(emp.target), fmt(emp.achievement), `${emp.percentage}%`,
          fmt(emp.remaining), fmt1(emp.daily_average), fmt1(emp.projection),
          projectionStatus(emp.percentage, Math.round(emp.projection / Math.max(emp.target, 1) * 100)),
        ];
        return `<tr${i % 2 === 1 ? ' style="background:#F8FAFC"' : ''}>
          ${cells.map((c, ci) => {
            const isStatus = ci === cells.length - 1;
            const isPct = ci === 5;
            const numVal = Number(String(c).replace('%', ''));
            const color = isStatus ? statusColor(c) : isPct ? (numVal >= 100 ? "#10B981" : numVal >= 70 ? "#3B82F6" : numVal >= 40 ? "#F59E0B" : "#EF4444") : "#1E293B";
            return `<td style="padding:3px 5px;border:1px solid #E2E8F0;text-align:${ci === 1 ? 'left' : 'center'};font-size:11px;color:${color};font-weight:${isStatus || isPct ? '700' : '400'}">${c}</td>`;
          }).join('')}
        </tr>`;
      }).join('')}
    </tbody>
  </table>` : ''}

  ${supervisor_performance.length > 0 ? `
  <h3 style="margin:8px 0 4px;font-size:13px;font-weight:700;color:#1E293B">SUPERVISOR PERFORMANCE</h3>
  <table style="width:100%;border-collapse:collapse;margin-bottom:2px">
    <thead>
      <tr style="background:#F1F5F9">
        ${supHeaders.map((h, i) => { const w = ["4%","14%","9%","7%","7%","6%","9%","6%","7%","10%","15%","6%"][i]; return `<th style="width:${w};padding:3px 5px;border:1px solid #E2E8F0;text-align:${i === 1 ? 'left' : 'center'};font-size:11px;font-weight:700;color:#1E293B">${h}</th>`; }).join('')}
      </tr>
    </thead>
    <tbody>
      ${supervisor_performance.map((emp, i) => {
        const cells = [
          String(i + 1), emp.name, emp.pool_number || "—",
          fmt(emp.target), fmt(emp.achievement), `${emp.percentage}%`,
          fmt(emp.remaining),
          String(Math.ceil(emp.remaining / Math.max(summary.days_remaining, 1))),
          fmt1(emp.daily_average), `${fmt1(emp.projection)} (${Math.round(emp.projection / Math.max(emp.target, 1) * 100)}%)`,
          fmt(emp.yesterday_activation ?? 0),
          projectionStatus(emp.percentage, Math.round(emp.projection / Math.max(emp.target, 1) * 100)),
        ];
        return `<tr${i % 2 === 1 ? ' style="background:#F8FAFC"' : ''}>
          ${cells.map((c, ci) => {
            const isStatus = ci === cells.length - 1;
            const isPct = ci === 5;
            const numVal = Number(String(c).replace('%', ''));
            const color = isStatus ? statusColor(c) : isPct ? (numVal >= 100 ? "#10B981" : numVal >= 70 ? "#3B82F6" : numVal >= 40 ? "#F59E0B" : "#EF4444") : "#1E293B";
            return `<td style="padding:3px 5px;border:1px solid #E2E8F0;text-align:${ci === 1 ? 'left' : 'center'};font-size:11px;color:${color};font-weight:${isStatus || isPct ? '700' : '400'}">${c}</td>`;
          }).join('')}
        </tr>`;
      }).join('')}
      ${supervisor_performance.length > 0 ? (() => {
        const t = supervisor_performance.reduce((s, e) => s + e.target, 0);
        const a = supervisor_performance.reduce((s, e) => s + e.achievement, 0);
        const p = t ? Math.round(a / t * 100) : 0;
        const r = supervisor_performance.reduce((s, e) => s + e.remaining, 0);
        const da = a / Math.max(days_elapsed, 1);
        const pr = supervisor_performance.reduce((s, e) => s + e.projection, 0);
        const pp = t ? Math.round(pr / t * 100) : 0;
        const drr = Math.ceil(r / Math.max(summary.days_remaining, 1));
        const subCells = [
          "", "Subtotal", "",
          fmt(t), fmt(a), `${p}%`,
          fmt(r), String(drr), fmt1(Math.round(da)),
          `${fmt1(Math.round(pr))} (${pp}%)`,
          fmt(supervisor_performance.reduce((s, e) => s + (e.yesterday_activation ?? 0), 0)),
          projectionStatus(p, pp),
        ];
        return `<tr style="background:#F8FAFC;font-weight:700">
          ${subCells.map((c, ci) => {
            const isStatus = ci === subCells.length - 1;
            const isPct = ci === 5;
            const numVal = Number(String(c).replace('%', ''));
            const color = isStatus ? statusColor(c) : isPct ? (numVal >= 100 ? "#10B981" : numVal >= 70 ? "#3B82F6" : numVal >= 40 ? "#F59E0B" : "#EF4444") : "#1E293B";
            return `<td style="padding:3px 5px;border:1px solid #E2E8F0;text-align:${ci === 1 ? 'left' : 'center'};font-size:11px;color:${color}">${c}</td>`;
          }).join('')}
        </tr>`;
      })() : ''}
    </tbody>
  </table>` : ''}

  <div class="footer" style="margin-top:12px;color:#94A3B8;text-align:center">Orange Flow — Activation Report</div>

  <script>
    window.onload = function() { window.print(); };
  <\/script>
</body>
</html>`;

  if (returnHtmlOnly) return html;

  const win = window.open("", "_blank");
  if (win) {
    win.document.write(html);
    win.document.close();
  }
}

interface RechargeSummary {
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
  yesterday_achievement: number;
}

interface RechargeEmployeeRow {
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
}

interface RechargePrintPayload {
  summary: RechargeSummary;
  rso_performance: RechargeEmployeeRow[];
  supervisor_performance: RechargeEmployeeRow[];
  house_name?: string;
  house_code?: string;
  month: number;
  year: number;
  month_name: string;
  days_elapsed: number;
  total_days: number;
}

export function printRechargeReport(payload: RechargePrintPayload, returnHtmlOnly?: boolean, imageMode?: boolean): string | void {
  const { summary, rso_performance, supervisor_performance, house_name, house_code, month, year, month_name, days_elapsed, total_days } = payload;
  const now = new Date();
  const dateStr = now.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

  const statusStr = projectionStatus(summary.achievement_percentage, Math.round(summary.projection / Math.max(summary.monthly_target, 1) * 100)).toLowerCase().replace(/\s+/g, "_");

  const rsoHeaders = ["#", "Name", "Itopup", "Target", "EV Tgt", "SC Tgt", "Ach", "%", "Remain", "DRR", "D.Avg", "Projection", "Status"];
  const supHeaders = ["#", "Name", "Pool", "Target", "EV Tgt", "SC Tgt", "Ach", "%", "Remain", "DRR", "D.Avg", "Projection", "Status"];

  const writeSectionTable = (label: string, employees: RechargeEmployeeRow[], headers: string[], identField: "itop_number" | "pool_number") => {
    if (employees.length === 0) return "";
    const totalTarget = employees.reduce((s, e) => s + e.target, 0);
    const totalAchieved = employees.reduce((s, e) => s + e.achievement, 0);
    const totalPct = totalTarget ? Math.round(totalAchieved / totalTarget * 100) : 0;
    const totalRemaining = employees.reduce((s, e) => s + e.remaining, 0);
    const totalDailyAvg = totalAchieved / Math.max(days_elapsed, 1);
    const totalProjection = employees.reduce((s, e) => s + e.projection, 0);
    const totalProjPct = totalTarget ? Math.round(totalProjection / totalTarget * 100) : 0;
    const totalDRR = Math.ceil(totalRemaining / Math.max(summary.days_remaining, 1));
    const totalEv = employees.reduce((s, e) => s + (e.ev_target ?? 0), 0);
    const totalSc = employees.reduce((s, e) => s + (e.sc_target ?? 0), 0);

    const rows = employees.map((emp, i) => {
      const ident = identField === "itop_number" ? (emp.itop_number || "—") : (emp.pool_number || "—");
      const cells = [
        String(i + 1), emp.name, ident,
        fmt(emp.target), fmt(emp.ev_target ?? 0), fmt(emp.sc_target ?? 0),
        fmt(emp.achievement), `${emp.percentage}%`,
        fmt(emp.remaining),
        String(Math.ceil(emp.remaining / Math.max(summary.days_remaining, 1))),
        fmt1(emp.daily_average), `${fmt1(emp.projection)} (${Math.round(emp.projection / Math.max(emp.target, 1) * 100)}%)`,
        projectionStatus(emp.percentage, Math.round(emp.projection / Math.max(emp.target, 1) * 100)),
      ];
      return `<tr${i % 2 === 1 ? ' style="background:#F8FAFC"' : ''}>
        ${cells.map((c, ci) => {
          const isStatus = ci === cells.length - 1;
          const isPct = ci === 7;
          const numVal = Number(String(c).replace('%', ''));
          const color = isStatus ? statusColor(c) : isPct ? (numVal >= 100 ? "#10B981" : numVal >= 70 ? "#3B82F6" : numVal >= 40 ? "#F59E0B" : "#EF4444") : "#1E293B";
          return `<td style="padding:3px 5px;border:1px solid #E2E8F0;text-align:${ci === 1 ? 'left' : 'center'};font-size:11px;color:${color};font-weight:${isStatus || isPct ? '700' : '400'}">${c}</td>`;
        }).join('')}
      </tr>`;
    }).join('');

    const subCells = [
      "", "Subtotal", "",
      fmt(totalTarget), fmt(totalEv), fmt(totalSc),
      fmt(totalAchieved), `${totalPct}%`,
      fmt(totalRemaining), String(totalDRR), fmt1(Math.round(totalDailyAvg)),
      `${fmt1(Math.round(totalProjection))} (${totalProjPct}%)`,
      projectionStatus(totalPct, totalProjPct),
    ];
    const subtotal = `<tr style="background:#F8FAFC;font-weight:700">
      ${subCells.map((c, ci) => {
        const isStatus = ci === subCells.length - 1;
        const isPct = ci === 7;
        const numVal = Number(String(c).replace('%', ''));
        const color = isStatus ? statusColor(c) : isPct ? (numVal >= 100 ? "#10B981" : numVal >= 70 ? "#3B82F6" : numVal >= 40 ? "#F59E0B" : "#EF4444") : "#1E293B";
        return `<td style="padding:3px 5px;border:1px solid #E2E8F0;text-align:${ci === 1 ? 'left' : 'center'};font-size:11px;color:${color}">${c}</td>`;
      }).join('')}
    </tr>`;

    return `
      <h3 style="margin:20px 0 8px;font-size:14px;font-weight:700;color:#1E293B">${label}</h3>
      <table style="width:100%;border-collapse:collapse;margin-bottom:4px">
        <thead>
          <tr style="background:#F1F5F9">
            ${headers.map((h, i) => `<th style="padding:3px 5px;border:1px solid #E2E8F0;text-align:${i === 1 ? 'left' : 'center'};font-size:11px;font-weight:700;color:#1E293B">${h}</th>`).join('')}
          </tr>
        </thead>
        <tbody>
          ${rows}
          ${subtotal}
        </tbody>
      </table>
    `;
  };

  const rsoHtml = writeSectionTable("RSO PERFORMANCE", rso_performance, rsoHeaders, "itop_number");
  const supHtml = writeSectionTable("SUPERVISOR PERFORMANCE", supervisor_performance, supHeaders, "pool_number");

  const html = `<!DOCTYPE html>
<html>
<head><title>Recharge Report - ${month_name} ${year}</title>
<style>
  @page { size: landscape; margin: 2mm; }
  @media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
  body { font-family: Calibri, Arial, sans-serif; margin: 0; color: #1E293B; font-size: 11px; }
  table { font-size: 11px; border-collapse: collapse; table-layout: fixed; width: 100%; }
  th, td { padding: 3px 5px; font-size: 11px; line-height: 1.25; word-wrap: break-word; overflow-wrap: break-word; }
  h1 { font-size: 16px !important; margin: 0 0 2px !important; }
  h3 { font-size: 13px !important; margin: 6px 0 3px !important; }
  .info { font-size: 10px; }
  .footer { font-size: 9px; }
</style>
${imageMode ? `<style>
  html, body { width: 1700px !important; }
  body { font-size: 15px !important; column-count: 2; column-gap: 24px; }
  table { font-size: 15px !important; }
  th, td { font-size: 15px !important; padding: 5px 8px !important; line-height: 1.35 !important; }
  h1 { font-size: 24px !important; column-span: all; }
  h3 { font-size: 20px !important; margin: 10px 0 5px !important; }
  .info { font-size: 14px !important; column-span: all; }
  .footer { font-size: 13px !important; column-span: all; }
  h3, table { break-inside: avoid; page-break-inside: avoid; }
</style>` : ''}
</head>
<body>
  <h1 style="font-size:16px;margin:0 0 2px;color:#1E293B">Recharge Report (C2C) - ${month_name} ${year}</h1>
  <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
    <div class="info" style="color:#64748B">${house_name ? `House: ${house_name} (${house_code})` : ""} | Generated: ${dateStr}</div>
    <div class="info" style="color:#64748B;font-style:italic">Days Elapsed: ${summary.days_elapsed}/${summary.total_days} | Days Remaining: ${summary.days_remaining}</div>
  </div>

  <h3 style="font-size:13px;font-weight:700;color:#1E293B;margin:0 0 4px">HOUSE SUMMARY</h3>
  <table style="width:100%;border-collapse:collapse;margin-bottom:6px">
    <thead>
      <tr style="background:#F1F5F9">
        ${["Target","Ach","%","Remaining","DRR","D.Avg","Projection","Yesterday","Expected %","Status"].map((h, i) => `<th style="width:${["10%","9%","7%","11%","7%","8%","11%","11%","9%","17%"][i]};padding:3px 5px;border:1px solid #E2E8F0;text-align:center;font-size:11px;font-weight:700;color:#1E293B">${h}</th>`).join('')}
      </tr>
    </thead>
    <tbody>
      <tr>
        ${[fmt(summary.monthly_target), fmt(summary.achievement), `${summary.achievement_percentage}%`, fmt(summary.remaining), fmt1(summary.daily_required), fmt1(summary.daily_average), fmt1(summary.projection), fmt(summary.yesterday_achievement), `${summary.expected_percentage}%`, projectionStatus(summary.achievement_percentage, Math.round(summary.projection / Math.max(summary.monthly_target, 1) * 100))].map((val, i) => {
          const isPct = i === 2;
          const isStatus = i === 9;
          const pctNum = isPct ? summary.achievement_percentage : 0;
          const color = isStatus ? statusColor(val) : isPct ? (pctNum >= 100 ? "#10B981" : pctNum >= 70 ? "#3B82F6" : pctNum >= 40 ? "#F59E0B" : "#EF4444") : "#1E293B";
          return `<td style="padding:3px 5px;border:1px solid #E2E8F0;text-align:center;font-size:11px;color:${color};font-weight:${isStatus || isPct ? '700' : '400'}">${val}</td>`;
        }).join('')}
      </tr>
    </tbody>
  </table>

  ${rsoHtml}
  ${supHtml}

  <div class="footer" style="margin-top:12px;color:#94A3B8;text-align:center">Orange Flow — Recharge Report</div>

  <script>
    window.onload = function() { window.print(); };
  <\/script>
</body>
</html>`;

  if (returnHtmlOnly) return html;

  const win = window.open("", "_blank");
  if (win) {
    win.document.write(html);
    win.document.close();
  }
}
