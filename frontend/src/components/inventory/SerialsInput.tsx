"use client";

import { useEffect, useRef, useState } from "react";
import { AlertCircle, Barcode, Clipboard, Plus, RotateCcw, Trash2, Upload } from "lucide-react";
import { useLanguage } from "@/i18n/useLanguage";

export const SERIAL_RE = /^[A-Z0-9][A-Z0-9._/-]{2,63}$/;
const SERIAL_RANGE_SERIAL_RE = /^\d{18}$/;

function splitTrailingNumber(value: string): { prefix: string; number: string } | null {
  const match = value.match(/^(.*?)(\d+)$/);
  if (!match) return null;
  return { prefix: match[1], number: match[2] };
}

export function serialEndFromQuantity(start: string, quantity: string): string | null {
  if (!SERIAL_RANGE_SERIAL_RE.test(start) || !/^\d+$/.test(quantity)) return null;
  const count = BigInt(quantity);
  if (count < BigInt(1)) return null;
  const end = BigInt(start) + count - BigInt(1);
  if (end > BigInt("999999999999999999")) return null;
  return end.toString().padStart(18, "0");
}

function getSerialRangeBounds(token: string) {
  const parts = token.split("-");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  const [startRaw, endRaw] = parts as [string, string];
  if (!SERIAL_RANGE_SERIAL_RE.test(startRaw) || !/^\d{1,18}$/.test(endRaw)) return null;
  let start = splitTrailingNumber(startRaw);
  if (!start) return null;
  let end = splitTrailingNumber(endRaw);
  if (!end) return null;

  // When the end is abbreviated, retain the shared prefix, including digits
  // from numeric-only serials (e.g. 898803841015320254-750).
  if (
    end.prefix === "" &&
    endRaw.length < start.number.length
  ) {
    const sharedDigitsLength = start.number.length - endRaw.length;
    const sharedPrefix = start.number.slice(0, sharedDigitsLength);
    start = {
      prefix: start.prefix + sharedPrefix,
      number: start.number.slice(sharedDigitsLength),
    };
    end = { prefix: start.prefix, number: endRaw };
  } else if (end.prefix === "" && start.prefix !== "" && endRaw.length === start.number.length) {
    // Also allow a full-width end suffix when the serial has a non-numeric prefix.
    end = { prefix: start.prefix, number: endRaw };
  }
  if (start.prefix !== end.prefix || start.number.length !== end.number.length) return null;

  const first = BigInt(start.number);
  const last = BigInt(end.number);
  if (last < first) return null;
  return { prefix: start.prefix, width: start.number.length, first, last };
}

/** Expand a single `START-END` token, or return null when it is not a valid range. */
export function expandSerialRange(token: string): string[] | null {
  const bounds = getSerialRangeBounds(token);
  if (!bounds) return null;

  const serials: string[] = [];
  for (let current = bounds.first; current <= bounds.last; current++) {
    serials.push(bounds.prefix + current.toString().padStart(bounds.width, "0"));
  }
  return serials;
}

/** Like `parseSerials`, but `START-END` tokens expand into individual serials. */
export function parseSerialsWithRanges(text: string) {
  const tokens = text
    .split(/[\s,;]+/)
    .map((token) => token.trim().toUpperCase())
    .filter(Boolean);

  const expanded: string[] = [];
  const invalidRanges: string[] = [];
  for (const token of tokens) {
    if (token.startsWith("-") || token.endsWith("-")) {
      invalidRanges.push(token);
      continue;
    }
    if (/^[^-\s]+-[^-\s]+$/.test(token)) {
      const range = expandSerialRange(token);
      if (range) {
        expanded.push(...range);
      } else {
        invalidRanges.push(token);
      }
    } else {
      expanded.push(token);
    }
  }

  const parsed = parseSerials(expanded.join("\n"));
  if (invalidRanges.length === 0) return parsed;
  return {
    ...parsed,
    invalid: Array.from(new Set([...parsed.invalid, ...invalidRanges])),
  };
}

export function parseSerials(text: string) {
  const tokens = text
    .split(/[\s,;]+/)
    .map((token) => token.trim())
    .filter(Boolean)
    .map((token) => token.toUpperCase());

  const seen = new Set<string>();
  const valid: string[] = [];
  const duplicates: string[] = [];
  const invalid: string[] = [];

  for (const token of tokens) {
    if (!SERIAL_RE.test(token)) {
      invalid.push(token);
    } else if (seen.has(token)) {
      duplicates.push(token);
    } else {
      seen.add(token);
      valid.push(token);
    }
  }

  return {
    valid,
    duplicates: Array.from(new Set(duplicates)),
    invalid: Array.from(new Set(invalid)),
    total: tokens.length,
  };
}

interface SerialRangeEntry {
  start: string;
  end: string;
}

function rangeEntriesFromValue(value: string): SerialRangeEntry[] {
  const entries = value
    .split(/[\s,;]+/)
    .map((token) => token.trim().toUpperCase())
    .filter(Boolean)
    .map((token) => {
      const parts = token.split("-");
      if (parts.length === 2) {
        return { start: parts[0], end: parts[1] };
      }
      return { start: token, end: "" };
    });

  return entries.length > 0 ? entries : [{ start: "", end: "" }];
}

function serializeRangeEntries(entries: SerialRangeEntry[]) {
  return entries
    .map(({ start, end }) => {
      if (!start.trim()) return "";
      return `${start.trim()}-${end.trim()}`;
    })
    .filter(Boolean)
    .join("\n");
}

export function SerialsInput({
  value,
  onChange,
  error,
  disabled,
  expandRanges = false,
}: {
  value: string;
  onChange: (value: string) => void;
  error?: string | null;
  disabled?: boolean;
  /** Parse `START-END` tokens into individual serials (receiving multi-product). */
  expandRanges?: boolean;
}) {
  const { t } = useLanguage();
  const fileRef = useRef<HTMLInputElement | null>(null);
  const startInputRef = useRef<HTMLInputElement | null>(null);
  const [entryMode, setEntryMode] = useState<"range" | "list">(
    expandRanges ? "range" : "list"
  );
  const [rangeEntries, setRangeEntries] = useState<SerialRangeEntry[]>(() =>
    rangeEntriesFromValue(value)
  );
  const parsed = expandRanges ? parseSerialsWithRanges(value) : parseSerials(value);

  useEffect(() => {
    if (expandRanges) setRangeEntries(rangeEntriesFromValue(value));
  }, [expandRanges, value]);

  const updateRangeEntries = (next: SerialRangeEntry[]) => {
    setRangeEntries(next);
    onChange(serializeRangeEntries(next));
  };

  const resetSerials = () => {
    updateRangeEntries([{ start: "", end: "" }]);
  };

  const loadExample = () => {
    updateRangeEntries([
      { start: "898803921654700214", end: "898803921654700220" },
    ]);
  };

  const quantityForRange = ({ start, end }: SerialRangeEntry): string | null => {
    if (!SERIAL_RANGE_SERIAL_RE.test(start.trim())) return null;
    if (!end.trim() || !/^\d{1,18}$/.test(end.trim())) return null;
    const bounds = getSerialRangeBounds(`${start.trim()}-${end.trim()}`);
    return bounds ? (bounds.last - bounds.first + BigInt(1)).toString() : null;
  };
  const hasRangeError =
    entryMode === "range" &&
    rangeEntries.some(({ start, end }) => {
      const trimmedStart = start.trim();
      const trimmedEnd = end.trim();
      const quantity = quantityForRange({ start: trimmedStart, end: trimmedEnd });
      return (
        (trimmedStart && !SERIAL_RANGE_SERIAL_RE.test(trimmedStart)) ||
        (trimmedEnd && !trimmedStart) ||
        (trimmedStart && !trimmedEnd) ||
        (trimmedEnd && !/^\d{1,18}$/.test(trimmedEnd)) ||
        (trimmedStart && trimmedEnd && quantity === null)
      );
    });

  const handleFile = async (file?: File | null) => {
    if (!file) return;
    let lines: string[] = [];

    if (file.name.toLowerCase().endsWith(".xlsx")) {
      const ExcelJS = (await import("exceljs")).default;
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(await file.arrayBuffer());
      const sheet = workbook.worksheets[0];
      sheet?.eachRow((row) => {
        const cell = row.getCell(1).value as unknown;
        const text =
          typeof cell === "number"
            ? String(cell)
            : typeof cell === "string"
              ? cell
              : ((cell as { text?: string } | null)?.text ?? "");
        if (text && !/^serial/i.test(text.trim())) lines.push(text.trim());
      });
    } else {
      const text = await file.text();
      lines = text
        .split(/\r?\n/)
        .map((line) => line.split(/[,;\t]/)[0]?.trim())
        .filter(Boolean) as string[];
    }

    onChange([value.trim(), ...lines].filter(Boolean).join("\n"));
    if (fileRef.current) fileRef.current.value = "";
  };

  return (
    <div>
      {expandRanges ? (
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3 mb-4">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-black text-gray-500 dark:text-gray-400 tracking-wide uppercase">
              {t("inventory.receiving.entry_method")}
            </label>
            <div className="flex gap-1.5 p-1 bg-gray-100/80 dark:bg-slate-800 border border-gray-200/50 dark:border-slate-700 rounded-2xl">
              <button
                type="button"
                onClick={() => setEntryMode("range")}
                disabled={disabled}
                className={`px-4 py-2 min-h-[40px] text-xs font-black rounded-xl transition-all disabled:cursor-not-allowed ${
                  entryMode === "range"
                    ? "bg-white dark:bg-slate-700 text-gray-900 dark:text-white shadow-md"
                    : "text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200"
                }`}
              >
                {t("inventory.receiving.serial_range")}
              </button>
              <button
                type="button"
                onClick={() => setEntryMode("list")}
                disabled={disabled}
                className={`px-4 py-2 min-h-[40px] text-xs font-black rounded-xl transition-all disabled:cursor-not-allowed ${
                  entryMode === "list"
                    ? "bg-white dark:bg-slate-700 text-gray-900 dark:text-white shadow-md"
                    : "text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200"
                }`}
              >
                {t("inventory.receiving.multiline_list")}
              </button>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-1">
            {entryMode === "range" ? (
              <button
                type="button"
                onClick={() => startInputRef.current?.focus()}
                disabled={disabled}
                className="flex items-center gap-1.5 px-2.5 py-2 min-h-[44px] text-xs font-bold border-b border-primary-500/20 text-primary-500 hover:text-primary-600 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
              >
                <Barcode className="w-3.5 h-3.5" />
                {t("inventory.receiving.scan_barcode")}
              </button>
            ) : null}
            <button
              type="button"
              onClick={loadExample}
              disabled={disabled}
              className="flex items-center gap-1.5 px-2.5 py-2 min-h-[44px] text-xs font-bold border-b border-primary-500/20 text-primary-500 hover:text-primary-600 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
            >
              <Clipboard className="w-3.5 h-3.5" />
              {t("inventory.receiving.load_example")}
            </button>
            <button
              type="button"
              onClick={resetSerials}
              disabled={disabled}
              className="flex items-center gap-1.5 px-2.5 py-2 min-h-[44px] text-xs font-bold text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              {t("inventory.receiving.reset")}
            </button>
          </div>
        </div>
      ) : (
        <div className="flex items-center justify-between gap-2 mb-1.5">
          <label className="block text-sm font-bold text-gray-700 dark:text-gray-300">
            {t("inventory.common.serial_numbers")}
          </label>
        </div>
      )}
      <input
        ref={fileRef}
        type="file"
        accept=".csv,.txt,.xlsx"
        className="hidden"
        onChange={(event) => handleFile(event.target.files?.[0])}
      />
      {expandRanges && entryMode === "range" ? (
        <div className="space-y-3">
          {rangeEntries.map((entry, index) => {
            const quantity = quantityForRange(entry);
            const rangeError =
              (entry.start.trim() && !SERIAL_RANGE_SERIAL_RE.test(entry.start.trim())) ||
              (entry.end.trim() && !entry.start.trim()) ||
              (entry.start.trim() && !entry.end.trim()) ||
              (entry.end.trim() && !/^\d{1,18}$/.test(entry.end.trim())) ||
              (entry.start.trim() && entry.end.trim() && quantity === null);
            return (
              <div
                key={index}
                className="flex flex-col gap-3 p-3.5 rounded-2xl border border-gray-100 dark:border-slate-800 bg-gray-50/40 dark:bg-slate-800/20 sm:p-0 sm:rounded-none sm:border-0 sm:bg-transparent sm:flex-row sm:items-end sm:gap-2"
              >
                <div className="min-w-0 flex-1">
                  <label className="block text-[11px] font-bold text-gray-500 dark:text-gray-400 mb-1.5">
                    {t("inventory.receiving.range_start")}
                  </label>
                  <input
                    ref={index === 0 ? startInputRef : undefined}
                    inputMode="numeric"
                    type="text"
                    value={entry.start}
                    placeholder="898803841015320254"
                    maxLength={18}
                    aria-invalid={Boolean(rangeError)}
                    disabled={disabled}
                    onChange={(event) => {
                      const next = rangeEntries.map((item, itemIndex) =>
                        itemIndex === index
                          ? { ...item, start: event.target.value.toUpperCase() }
                          : item
                      );
                      updateRangeEntries(next);
                    }}
                    className={`w-full px-3 py-2.5 border rounded-xl bg-white dark:bg-slate-900 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-600 focus:outline-none focus:ring-2 transition-all text-sm font-mono tracking-tight disabled:opacity-50 ${
                      rangeError
                        ? "border-red-300 dark:border-red-700 focus:ring-red-500"
                        : "border-gray-200 dark:border-slate-700 focus:ring-primary-500"
                    }`}
                  />
                </div>
                <div className="min-w-0 flex-1">
                  <label className="block text-[11px] font-bold text-gray-500 dark:text-gray-400 mb-1.5">
                    {t("inventory.receiving.range_end")}
                  </label>
                  <input
                    inputMode="numeric"
                    type="text"
                    value={entry.end}
                    placeholder="898803841015320750"
                    maxLength={18}
                    aria-invalid={Boolean(rangeError)}
                    disabled={disabled}
                    onChange={(event) => {
                      const next = rangeEntries.map((item, itemIndex) =>
                        itemIndex === index
                          ? { ...item, end: event.target.value.toUpperCase() }
                          : item
                      );
                      updateRangeEntries(next);
                    }}
                    className={`w-full px-3 py-2.5 border rounded-xl bg-white dark:bg-slate-900 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-600 focus:outline-none focus:ring-2 transition-all text-sm font-mono tracking-tight disabled:opacity-50 ${
                      rangeError
                        ? "border-red-300 dark:border-red-700 focus:ring-red-500"
                        : "border-gray-200 dark:border-slate-700 focus:ring-primary-500"
                    }`}
                  />
                </div>
                <div className="flex items-end gap-2 w-full sm:w-24">
                  <div className="flex-1 min-w-0">
                    <label className="block text-[11px] font-bold text-gray-500 dark:text-gray-400 mb-1.5">
                      {t("inventory.receiving.range_quantity")}
                    </label>
                    <input
                      inputMode="numeric"
                      type="text"
                      value={quantity || ""}
                      placeholder="—"
                      aria-label={t("inventory.receiving.range_quantity")}
                      aria-invalid={Boolean(rangeError)}
                      disabled={disabled}
                      onChange={(event) => {
                        const rawQuantity = event.target.value;
                        if (!/^\d*$/.test(rawQuantity)) return;
                        const nextEnd = rawQuantity
                          ? serialEndFromQuantity(entry.start.trim(), rawQuantity)
                          : "";
                        const next = rangeEntries.map((item, itemIndex) =>
                          itemIndex === index
                            ? { ...item, end: nextEnd ?? "" }
                            : item
                        );
                        updateRangeEntries(next);
                      }}
                      className={`w-full px-2 py-2.5 rounded-xl text-sm font-mono font-bold text-center border bg-white dark:bg-slate-900 focus:outline-none focus:ring-2 transition-all disabled:opacity-50 ${
                        rangeError
                          ? "border-red-300 dark:border-red-700 focus:ring-red-500"
                          : "border-gray-200 dark:border-slate-700 focus:ring-primary-500"
                      }`}
                    />
                  </div>
                  {rangeEntries.length > 1 ? (
                    <button
                      type="button"
                      onClick={() => updateRangeEntries(rangeEntries.filter((_, itemIndex) => itemIndex !== index))}
                      disabled={disabled}
                      aria-label={t("inventory.receiving.remove_range")}
                      title={t("inventory.receiving.remove_range")}
                      className="p-2.5 min-h-[44px] min-w-[44px] rounded-xl text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                    >
                      <Trash2 className="w-4 h-4 mx-auto" />
                    </button>
                  ) : null}
                </div>
              </div>
            );
          })}
          <div className="flex items-center justify-between gap-2 pt-1">
            <button
              type="button"
              onClick={() => updateRangeEntries([...rangeEntries, { start: "", end: "" }])}
              disabled={disabled}
              className="flex items-center gap-1.5 px-3.5 py-2 min-h-[44px] text-xs font-bold text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/20 rounded-xl hover:bg-emerald-100 dark:hover:bg-emerald-500/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              {t("inventory.receiving.add_range")}
            </button>
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={disabled}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 min-h-[44px] text-xs font-semibold rounded-xl border border-gray-200 dark:border-slate-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
            >
              <Upload className="w-3.5 h-3.5" />
              {t("inventory.common.import_file")}
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="flex justify-end mb-1.5">
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={disabled}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold rounded-lg border border-gray-200 dark:border-slate-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
            >
              <Upload className="w-3.5 h-3.5" />
              {t("inventory.common.import_file")}
            </button>
          </div>
          <textarea
            value={value}
            onChange={(event) => onChange(event.target.value)}
            disabled={disabled}
            rows={7}
            spellCheck={false}
            placeholder={"890123456789012345\n890123456789012346"}
            className={`w-full rounded-xl border bg-white dark:bg-slate-900 px-3 py-2 text-sm font-mono cursor-text outline-none focus:ring-2 focus:ring-primary-500 disabled:opacity-50 ${
              error
                ? "border-red-300 dark:border-red-700"
                : "border-gray-200 dark:border-slate-800"
            }`}
          />
        </>
      )}
      {hasRangeError ? (
        <p className="flex items-center gap-1 text-xs text-red-600 dark:text-red-400 mt-2">
          <AlertCircle className="w-3.5 h-3.5" /> {t("inventory.receiving.invalid_range")}
        </p>
      ) : null}
      <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-1">
        {expandRanges && entryMode === "range"
          ? t("inventory.receiving.serial_ranges_help")
          : t("inventory.common.serials_help")}
      </p>
      {error ? (
        <p className="flex items-center gap-1 text-xs text-red-600 dark:text-red-400 mt-1">
          <AlertCircle className="w-3.5 h-3.5" /> {error}
        </p>
      ) : null}
      {value.trim() ? (
        <div className="flex flex-wrap items-center gap-2 mt-2 text-[11px]">
          <span className="px-2 py-0.5 rounded-md bg-green-50 dark:bg-green-500/10 text-green-700 dark:text-green-300 font-semibold">
            {t("inventory.common.valid")}: {parsed.valid.length}
          </span>
          {parsed.duplicates.length > 0 ? (
            <span className="px-2 py-0.5 rounded-md bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-300 font-semibold">
              {t("inventory.common.duplicates")}: {parsed.duplicates.length}
            </span>
          ) : null}
          {parsed.invalid.length > 0 ? (
            <span className="px-2 py-0.5 rounded-md bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-300 font-semibold">
              {t("inventory.common.invalid")}: {parsed.invalid.length}
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
