import type { LiveC2CEntityIssue } from "@/lib/live-c2c-diagnostics";

type Translate = (
  path: string,
  params?: Record<string, string | number | undefined>,
) => string;

export interface ExportLiveC2CMismatchesOptions {
  issues: LiveC2CEntityIssue[];
  houseName?: string | null;
  houseCode?: string | null;
  t: Translate;
}

function candidateText(issue: LiveC2CEntityIssue): string {
  return issue.candidates
    .map((candidate) => {
      const code =
        issue.side === "from" ? candidate.dms_code : candidate.retailer_code;
      const name = candidate.name ?? candidate.itop_number ?? "—";
      return code ? `${name} — ${code}` : name;
    })
    .join("; ");
}

function safeFilenamePart(value: string | null | undefined): string {
  const cleaned = (value ?? "").replace(/[^A-Za-z0-9_-]+/g, "_");
  return cleaned || "house";
}

/**
 * Browser-side xlsx export of the mismatch report returned by
 * `POST /reports/live-c2c/preview`. Same approach as `export-activations.ts`:
 * the payload already exists in the browser, so no server round-trip is needed.
 */
export async function exportLiveC2CMismatches({
  issues,
  houseName,
  houseCode,
  t,
}: ExportLiveC2CMismatchesOptions): Promise<void> {
  const ExcelJS = (await import("exceljs")).default;
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Orange Flow";
  const sheet = workbook.addWorksheet("Mismatches", {
    pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1 },
  });

  sheet.columns = [
    { header: t("live_c2c.diagnostics.columns.side"), key: "side", width: 22 },
    { header: t("live_c2c.diagnostics.columns.value"), key: "value", width: 18 },
    { header: t("live_c2c.diagnostics.columns.status"), key: "status", width: 18 },
    { header: t("live_c2c.diagnostics.columns.rows"), key: "rows", width: 12 },
    {
      header: t("live_c2c.diagnostics.columns.excel_rows"),
      key: "excelRows",
      width: 26,
    },
    {
      header: t("live_c2c.diagnostics.columns.candidates"),
      key: "candidates",
      width: 52,
    },
  ];
  sheet.getRow(1).font = { bold: true };

  for (const issue of issues) {
    sheet.addRow({
      side: t(`live_c2c.diagnostics.side_${issue.side}`),
      value: issue.value,
      status: t(`live_c2c.diagnostics.status_${issue.status}`),
      rows: issue.row_count,
      excelRows: issue.excel_rows.join(", "),
      candidates: candidateText(issue),
    });
  }

  if (houseName) {
    sheet.addRow({});
    sheet.addRow({ value: houseName });
  }

  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const date = new Date().toISOString().slice(0, 10);
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.setAttribute(
    "download",
    `live_c2c_mismatches_${safeFilenamePart(houseCode)}_${date}.xlsx`,
  );
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.URL.revokeObjectURL(url);
}
