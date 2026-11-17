import assert from "node:assert/strict";
import test from "node:test";
import ExcelJS from "exceljs";
import {
  LIVE_C2C_HEADERS,
  MAX_LIVE_C2C_FILE_SIZE,
  LiveC2CWorkbookError,
  parseLiveC2CWorkbook,
  validateLiveC2CFile,
} from "./live-c2c-import.ts";

const headers = [
  "SL #",
  "DD Code",
  "RSO Name",
  "RSO Code",
  "RSO Number",
  "Check-in time",
  "Productivity C2C Tgt",
  "C2C today's route",
  "C2C other route",
  "Total C2C",
  "Ach%",
  "Remain",
  "Gap",
  "Today Target",
  "Remain",
  "Productivity trans.Tgt",
  "Todays route trans",
  "Other route trans*",
  "Ach%",
  "Remain",
  "Start Time",
  "End Time",
  "Serving hours",
];

test("does not include the SCR today-route column", () => {
  assert.equal(LIVE_C2C_HEADERS.includes("SCR (today's route)"), false);
});

async function workbookBytes(rows) {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet("Live C2C");
  rows.forEach((row) => worksheet.addRow(row));
  const buffer = await workbook.xlsx.writeBuffer();
  return new Response(buffer).arrayBuffer();
}

test("parses ordered headers and keeps duplicate headings in distinct columns", async () => {
  const row = headers.map((_, index) => `value-${index}`);
  const normalizedHeaders = headers.map((header) =>
    ` ${header.toUpperCase().replace(/ /g, "   ")} `,
  );
  const rows = await parseLiveC2CWorkbook(
    await workbookBytes([
      [...normalizedHeaders, "Extra column"],
      [...row, "ignored"],
    ]),
  );

  assert.equal(rows.length, 1);
  assert.equal(rows[0].length, 23);
  assert.equal(rows[0][10], "value-10");
  assert.equal(rows[0][11], "value-11");
  assert.equal(rows[0][18], "value-18");
  assert.equal(rows[0][19], "value-19");
});

test("rejects missing or reordered required headers", async () => {
  const invalidHeaders = [...headers];
  [invalidHeaders[10], invalidHeaders[11]] = [invalidHeaders[11], invalidHeaders[10]];

  await assert.rejects(
    parseLiveC2CWorkbook(await workbookBytes([invalidHeaders])),
    (error) =>
      error instanceof LiveC2CWorkbookError && error.code === "invalid_headers",
  );
});

test("rejects unreadable workbook bytes", async () => {
  await assert.rejects(
    parseLiveC2CWorkbook(new TextEncoder().encode("not an xlsx").buffer),
    (error) =>
      error instanceof LiveC2CWorkbookError && error.code === "invalid_workbook",
  );
});

test("accepts a header-only worksheet as an empty preview", async () => {
  const rows = await parseLiveC2CWorkbook(await workbookBytes([headers]));

  assert.deepEqual(rows, []);
});

test("allows an xlsx at the size limit and rejects unsupported or oversized files", () => {
  assert.equal(
    validateLiveC2CFile({ name: "live-c2c.xlsx", size: MAX_LIVE_C2C_FILE_SIZE }),
    null,
  );
  assert.equal(
    validateLiveC2CFile({ name: "live-c2c.xlsx", size: MAX_LIVE_C2C_FILE_SIZE + 1 }),
    "file_too_large",
  );
  assert.equal(
    validateLiveC2CFile({ name: "live-c2c.xls", size: 1 }),
    "invalid_file_type",
  );
});
