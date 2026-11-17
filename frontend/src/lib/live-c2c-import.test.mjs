import assert from "node:assert/strict";
import test from "node:test";
import ExcelJS from "exceljs";
import {
  MAX_LIVE_C2C_FILE_SIZE,
  LiveC2CWorkbookError,
  listLiveC2CWorksheetNames,
  validateLiveC2CFile,
} from "./live-c2c-import.ts";

async function workbookBytes(sheetNames) {
  const workbook = new ExcelJS.Workbook();
  sheetNames.forEach((sheetName) => workbook.addWorksheet(sheetName));
  const buffer = await workbook.xlsx.writeBuffer();
  return new Response(buffer).arrayBuffer();
}

test("lists every worksheet in workbook order", async () => {
  assert.deepEqual(
    await listLiveC2CWorksheetNames(await workbookBytes(["Summary", "C2C Data"])),
    ["Summary", "C2C Data"],
  );
});

test("rejects unreadable workbook bytes", async () => {
  await assert.rejects(
    listLiveC2CWorksheetNames(new TextEncoder().encode("not an xlsx").buffer),
    (error) =>
      error instanceof LiveC2CWorkbookError && error.code === "invalid_workbook",
  );
});

test("allows xlsx and xlsb at the size limit and rejects unsupported or oversized files", () => {
  assert.equal(
    validateLiveC2CFile({ name: "live-c2c.xlsx", size: MAX_LIVE_C2C_FILE_SIZE }),
    null,
  );
  assert.equal(
    validateLiveC2CFile({ name: "live-c2c.xlsb", size: MAX_LIVE_C2C_FILE_SIZE }),
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
