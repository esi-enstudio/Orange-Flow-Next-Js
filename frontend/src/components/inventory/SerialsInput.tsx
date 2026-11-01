"use client";

import { useEffect, useRef, useState } from "react";
import { AlertCircle, Plus, Trash2, Upload } from "lucide-react";
import { useLanguage } from "@/i18n/useLanguage";

export const SERIAL_RE = /^[A-Z0-9][A-Z0-9._/-]{2,63}$/;
const MAX_SERIAL_PREVIEW = 100000;

function splitTrailingNumber(value: string): { prefix: string; number: string } | null {
  const match = value.match(/^(.*?)(\d+)$/);
  if (!match) return null;
  return { prefix: match[1], number: match[2] };
}

/**
 * End serial for `start` + `quantity` (both directions of the range sync use
 * this). Works for any serial shape: an 18-digit ICCID, a prefixed serial such
 * as `APISC001`, or a shorter numeric block. The trailing digit block keeps its
 * width, so `APISC001` + 3 → `APISC003`.
 */
export function serialEndFromQuantity(start: string, quantity: string): string | null {
  const startParts = splitTrailingNumber((start || "").trim().toUpperCase());
  if (!startParts || !/^\d+$/.test(quantity)) return null;
  const count = BigInt(quantity);
  if (count < BigInt(1)) return null;
  const end = BigInt(startParts.number) + count - BigInt(1);
  const endDigits = end.toString();
  // Never produce a block that a serial number could not hold.
  if (endDigits.length > 18) return null;
  return startParts.prefix + endDigits.padStart(startParts.number.length, "0");
}

/** Quantity implied by a `start` / `end` pair, or null when it is not a range. */
export function serialQuantityFromRange(start: string, end: string): string | null {
  const startParts = splitTrailingNumber((start || "").trim().toUpperCase());
  const endParts = splitTrailingNumber((end || "").trim().toUpperCase());
  if (!startParts || !endParts) return null;
  if (endParts.prefix !== "" && endParts.prefix !== startParts.prefix) return null;
  if (endParts.number.length > startParts.number.length) return null;
  // A shorter end is a suffix of the start's digit block (`...254` → `...750`).
  const endDigits =
    startParts.number.slice(0, startParts.number.length - endParts.number.length) +
    endParts.number;
  const first = BigInt(startParts.number);
  const last = BigInt(endDigits);
  if (last < first) return null;
  return (last - first + BigInt(1)).toString();
}

function getSerialRangeBounds(token: string) {
  const parts = token.split("-");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  const [startRaw, endRaw] = parts as [string, string];
  // Any serial shape is fine (an 18-digit ICCID, a 12-digit numeric serial, or a
  // prefixed one such as APISC001); only the trailing digit block is compared.
  const start = splitTrailingNumber(startRaw);
  if (!start) return null;
  const end = splitTrailingNumber(endRaw);
  if (!end) return null;

  // The end may repeat the start's prefix or be only its trailing digits
  // (e.g. 898803841015320254-750); anything else is not a range.
  if (end.prefix !== "" && end.prefix !== start.prefix) return null;
  if (end.number.length > start.number.length) return null;
  const endNumber =
    start.number.slice(0, start.number.length - end.number.length) + end.number;

  const first = BigInt(start.number);
  const last = BigInt(endNumber);
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

  const seen = new Set<string>();
  const valid: string[] = [];
  const duplicates: string[] = [];
  const invalid: string[] = [];
  let total = 0;
  const addSerial = (serial: string) => {
    total += 1;
    if (!SERIAL_RE.test(serial)) {
      invalid.push(serial);
    } else if (seen.has(serial)) {
      duplicates.push(serial);
    } else {
      seen.add(serial);
      valid.push(serial);
    }
  };

  for (const token of tokens) {
    if (token.startsWith("-") || token.endsWith("-")) {
      invalid.push(token);
      continue;
    }
    if (/^[^-\s]+-[^-\s]+$/.test(token)) {
      const bounds = getSerialRangeBounds(token);
      if (bounds) {
        const rangeCount = bounds.last - bounds.first + BigInt(1);
        if (BigInt(total) + rangeCount > BigInt(MAX_SERIAL_PREVIEW)) {
          invalid.push(token);
          break;
        }
        for (let current = bounds.first; current <= bounds.last; current++) {
          addSerial(bounds.prefix + current.toString().padStart(bounds.width, "0"));
        }
      } else {
        invalid.push(token);
      }
    } else {
      addSerial(token);
    }
  }

  return {
    valid,
    duplicates: Array.from(new Set(duplicates)),
    invalid: Array.from(new Set(invalid)),
    total,
  };
}

export function countSerialsWithRanges(text: string): number {
  let count = 0;
  for (const rawToken of text.split(/[\s,;]+/)) {
    const token = rawToken.trim().toUpperCase();
    if (!token || token.startsWith("-") || token.endsWith("-")) continue;
    if (/^[^-\s]+-[^-\s]+$/.test(token)) {
      const bounds = getSerialRangeBounds(token);
      if (bounds) count += Number(bounds.last - bounds.first + BigInt(1));
    } else if (SERIAL_RE.test(token)) {
      count += 1;
    }
  }
  return count;
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
  const [rangeEntries, setRangeEntries] = useState<SerialRangeEntry[]>(() =>
    rangeEntriesFromValue(value)
  );
  const [parsed, setParsed] = useState(() =>
    expandRanges ? parseSerialsWithRanges(value) : parseSerials(value)
  );
  // Keeps a typed quantity visible while it cannot yet be turned into an end
  // serial (for example before the start serial is filled in).
  const [quantityDrafts, setQuantityDrafts] = useState<Record<number, string>>({});

  useEffect(() => {
    if (expandRanges) {
      setRangeEntries(rangeEntriesFromValue(value));
      setQuantityDrafts({});
    }
  }, [expandRanges, value]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setParsed(expandRanges ? parseSerialsWithRanges(value) : parseSerials(value));
    }, 350);
    return () => clearTimeout(timer);
  }, [expandRanges, value]);

  const updateRangeEntries = (next: SerialRangeEntry[], serialize = true) => {
    setRangeEntries(next);
    if (next.length !== rangeEntries.length) setQuantityDrafts({});
    if (serialize) onChange(serializeRangeEntries(next));
  };

  const quantityForRange = ({ start, end }: SerialRangeEntry): string | null =>
    serialQuantityFromRange(start, end);
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
      {expandRanges ? null : (
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
      {expandRanges ? (
        <div>
          {rangeEntries.map((entry, index) => {
            const quantity = quantityForRange(entry);
            return (
              <div
                key={index}
                className="flex items-end gap-1.5 mb-2"
              >
                <div className="min-w-0 flex-1">
                  <label className="block text-[11px] font-bold text-gray-500 dark:text-gray-400 mb-1.5">
                    {t("inventory.receiving.range_start")}
                  </label>
                  <input
                    inputMode="numeric"
                    type="text"
                    value={entry.start}
                    placeholder="898803841015320254"
                    disabled={disabled}
                    onChange={(event) => {
                      const rawStart = event.target.value.toUpperCase();
                      // A quantity typed before the start serial fills the end as
                      // soon as the start becomes usable.
                      const draftQuantity = quantityDrafts[index];
                      const draftEnd = draftQuantity
                        ? serialEndFromQuantity(rawStart, draftQuantity)
                        : null;
                      const next = rangeEntries.map((item, itemIndex) =>
                        itemIndex === index
                          ? {
                              ...item,
                              start: rawStart,
                              ...(draftEnd !== null ? { end: draftEnd } : {}),
                            }
                          : item
                      );
                      updateRangeEntries(next);
                    }}
                    className="w-full px-2 py-2.5 border border-gray-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-900 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-primary-500 transition-all text-sm font-mono tracking-tight disabled:opacity-50"
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
                    placeholder="—"
                    disabled={disabled}
                    onChange={(event) => {
                      const next = rangeEntries.map((item, itemIndex) =>
                        itemIndex === index
                          ? { ...item, end: event.target.value.toUpperCase() }
                          : item
                      );
                      updateRangeEntries(next);
                    }}
                    className="w-full px-2 py-2.5 border border-gray-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-900 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-primary-500 transition-all text-sm font-mono tracking-tight disabled:opacity-50"
                  />
                </div>
                <div className="flex items-end gap-1.5 shrink-0">
                  <div className="w-16 sm:w-20">
                    <label className="block text-[11px] font-bold text-gray-500 dark:text-gray-400 mb-1.5">
                      {t("inventory.receiving.range_quantity")}
                    </label>
                    <input
                      inputMode="numeric"
                      type="text"
                      value={quantity ?? quantityDrafts[index] ?? ""}
                      placeholder="—"
                      aria-label={t("inventory.receiving.range_quantity")}
                      disabled={disabled}
                      onChange={(event) => {
                        const rawQuantity = event.target.value;
                        if (!/^\d*$/.test(rawQuantity)) return;
                        setQuantityDrafts((current) => ({ ...current, [index]: rawQuantity }));
                        const nextEnd = rawQuantity
                          ? serialEndFromQuantity(entry.start.trim(), rawQuantity)
                          : "";
                        const next = rangeEntries.map((item, itemIndex) =>
                          itemIndex === index
                            ? {
                                ...item,
                                end: nextEnd ?? "",
                              }
                            : item
                          );
                          updateRangeEntries(next);
                      }}
                      className="w-full px-2 py-2.5 rounded-xl text-sm font-mono font-bold text-center border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 focus:outline-none focus:ring-2 focus:ring-primary-500 transition-all disabled:opacity-50"
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
          <div className="flex items-center gap-2 pt-1">
            <button
              type="button"
              onClick={() => updateRangeEntries([...rangeEntries, { start: "", end: "" }])}
              disabled={disabled}
              className="flex items-center gap-1.5 px-3.5 py-2 min-h-[44px] text-xs font-bold text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/20 rounded-xl hover:bg-emerald-100 dark:hover:bg-emerald-500/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              {t("inventory.receiving.add_range")}
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
      {expandRanges ? null : (
        <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-1">
          {t("inventory.common.serials_help")}
        </p>
      )}
      {error ? (
        <p className="flex items-center gap-1 text-xs text-red-600 dark:text-red-400 mt-1">
          <AlertCircle className="w-3.5 h-3.5" /> {error}
        </p>
      ) : null}
      {!expandRanges && value.trim() ? (
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
