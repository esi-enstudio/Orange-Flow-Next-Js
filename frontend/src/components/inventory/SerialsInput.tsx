"use client";

import { useRef } from "react";
import { AlertCircle, Upload } from "lucide-react";
import { useLanguage } from "@/i18n/useLanguage";

export const SERIAL_RE = /^[A-Z0-9][A-Z0-9._/-]{2,63}$/;

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

export function SerialsInput({
  value,
  onChange,
  error,
  disabled,
}: {
  value: string;
  onChange: (value: string) => void;
  error?: string | null;
  disabled?: boolean;
}) {
  const { t } = useLanguage();
  const fileRef = useRef<HTMLInputElement | null>(null);
  const parsed = parseSerials(value);

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
      <div className="flex items-center justify-between gap-2 mb-1.5">
        <label className="block text-sm font-bold text-gray-700 dark:text-gray-300">
          {t("inventory.common.serial_numbers")}
        </label>
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={disabled}
          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold rounded-lg border border-gray-200 dark:border-slate-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
        >
          <Upload className="w-3.5 h-3.5" />
          {t("inventory.common.import_file")}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".csv,.txt,.xlsx"
          className="hidden"
          onChange={(event) => handleFile(event.target.files?.[0])}
        />
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
      <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-1">
        {t("inventory.common.serials_help")}
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
