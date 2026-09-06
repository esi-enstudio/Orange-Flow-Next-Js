"use client";

import { useState, useCallback, useEffect, useImperativeHandle, forwardRef } from "react";
import { cn } from "@/lib/utils";
import { Plus, X, AlertCircle } from "lucide-react";

interface RangeEntry {
  id: string;
  start: string;
  end: string;
  qty: string;
}

export interface SerialRangeInputHandle {
  resetFromValue: (val: string) => void;
}

interface SerialRangeInputProps {
  onChange: (formatted: string) => void;
  disabled?: boolean;
  maxSerials?: number;
}

function b(v: string): bigint {
  try {
    return BigInt(v);
  } catch {
    return BigInt(0);
  }
}

let uidCounter = 1;
function uid() {
  return `sr_${uidCounter++}_${Date.now()}`;
}

function calcQty(start: string, end: string): string {
  if (!start || !end) return "";
  const s = b(start);
  const e = b(end);
  if (s === BigInt(0) || e === BigInt(0)) return "";
  if (e < s) return "";
  const diff = e - s + BigInt(1);
  if (diff > BigInt(500)) return "";
  return diff.toString();
}

function calcEnd(start: string, qty: string): string {
  if (!start || !qty) return "";
  const s = b(start);
  const q = b(qty);
  if (s === BigInt(0) || q === BigInt(0)) return "";
  if (q > BigInt(500)) return "";
  return (s + q - BigInt(1)).toString();
}



export const SerialRangeInput = forwardRef<SerialRangeInputHandle, SerialRangeInputProps>(
  function SerialRangeInput({ onChange, disabled = false, maxSerials = 500 }, ref) {
    const [ranges, setRanges] = useState<RangeEntry[]>([{ id: uid(), start: "", end: "", qty: "" }]);

    // Notify parent after render — never during render
    useEffect(() => {
      const valid = ranges.filter((r) => r.start && r.end);
      const formatted = valid.map((r) => `${r.start}-${r.end}`).join("\n");
      onChange(formatted);
    }, [ranges, onChange]);

    const updateField = useCallback(
      (id: string, field: "start" | "end" | "qty", value: string) => {
        setRanges((prev) =>
          prev.map((r) => {
            if (r.id !== id) return r;
            const updated = { ...r, [field]: value };

            if (field === "end") {
              const q = calcQty(updated.start, value);
              if (q) updated.qty = q;
            } else if (field === "qty") {
              const e = calcEnd(updated.start, value);
              if (e) updated.end = e;
            } else if (field === "start") {
              if (updated.end) {
                const q = calcQty(value, updated.end);
                if (q) updated.qty = q;
              } else if (updated.qty) {
                const e = calcEnd(value, updated.qty);
                if (e) updated.end = e;
              }
            }

            return updated;
          })
        );
      },
      []
    );

    const addRange = useCallback(() => {
      setRanges((prev) => [...prev, { id: uid(), start: "", end: "", qty: "" }]);
    }, []);

    const removeRange = useCallback((id: string) => {
      setRanges((prev) => {
        if (prev.length <= 1) return prev;
        return prev.filter((r) => r.id !== id);
      });
    }, []);

    const totalSerials = ranges.reduce((sum, r) => {
      if (!r.start || !r.end) return sum;
      const s = b(r.start);
      const e = b(r.end);
      if (s === BigInt(0) || e === BigInt(0)) return sum;
      if (e < s) return sum;
      const diff = e - s + BigInt(1);
      if (diff > BigInt(500)) return sum;
      try {
        return sum + Number(diff);
      } catch {
        return sum;
      }
    }, 0);

    const exceedsLimit = totalSerials > maxSerials;

    useImperativeHandle(ref, () => ({
      resetFromValue(val: string) {
        const parsed = parseRangeValue(val);
        const entries =
          parsed.length > 0
            ? parsed
            : [{ id: uid(), start: "", end: "", qty: "" }];
        setRanges(entries);
        // useEffect will handle onChange
      },
    }));

    return (
      <div className="space-y-3">
        {ranges.map((range, index) => {
          const qty =
            range.start && range.end && !range.qty
              ? calcQty(range.start, range.end)
              : range.qty;

          return (
            <div
              key={range.id}
              className="flex flex-col gap-3 p-3.5 rounded-2xl border border-gray-100 dark:border-slate-800 bg-gray-50/40 dark:bg-slate-800/20 sm:p-0 sm:rounded-none sm:border-0 sm:bg-transparent sm:flex-row sm:items-end sm:gap-2"
            >
              {/* Start Serial */}
              <div className="min-w-0 flex-1">
                {index === 0 && (
                  <label className="hidden sm:block text-[11px] font-bold text-gray-500 dark:text-gray-400 mb-1.5">
                    Start
                  </label>
                )}
                <label className="sm:hidden block text-[11px] font-bold text-gray-500 dark:text-gray-400 mb-1.5">
                  {index === 0 ? "Start" : `Range ${index + 1} — Start`}
                </label>
                <input
                  type="text"
                  inputMode="numeric"
                  value={range.start}
                  onChange={(e) =>
                    updateField(range.id, "start", e.target.value.replace(/\D/g, ""))
                  }
                  disabled={disabled}
                  placeholder="898803992145808574"
                  className={cn(
                    "w-full px-3 py-2.5 border rounded-xl bg-gray-50/50 dark:bg-slate-800/30 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-600 focus:outline-none focus:ring-2 transition-all text-sm font-mono tracking-tight",
                    exceedsLimit
                      ? "focus:ring-red-500 border-red-300 dark:border-red-500/20"
                      : "focus:ring-emerald-500"
                  )}
                />
              </div>

              {/* End Serial */}
              <div className="min-w-0 flex-1">
                {index === 0 && (
                  <label className="hidden sm:block text-[11px] font-bold text-gray-500 dark:text-gray-400 mb-1.5">
                    End
                  </label>
                )}
                <label className="sm:hidden block text-[11px] font-bold text-gray-500 dark:text-gray-400 mb-1.5">
                  {index === 0 ? "End" : `Range ${index + 1} — End`}
                </label>
                <input
                  type="text"
                  inputMode="numeric"
                  value={range.end}
                  onChange={(e) =>
                    updateField(range.id, "end", e.target.value.replace(/\D/g, ""))
                  }
                  disabled={disabled}
                  placeholder="898803992145808733"
                  className={cn(
                    "w-full px-3 py-2.5 border rounded-xl bg-gray-50/50 dark:bg-slate-800/30 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-600 focus:outline-none focus:ring-2 transition-all text-sm font-mono tracking-tight",
                    exceedsLimit
                      ? "focus:ring-red-500 border-red-300 dark:border-red-500/20"
                      : "focus:ring-emerald-500"
                  )}
                />
              </div>

              <div className="flex items-end gap-2 w-full sm:w-20">
                {/* Qty (editable — derives end) */}
                <div className="flex-1 sm:w-20 sm:flex-none min-w-0">
                  {index === 0 && (
                    <label className="hidden sm:block text-[11px] font-bold text-gray-500 dark:text-gray-400 mb-1.5">
                      Qty
                    </label>
                  )}
                  <label className="sm:hidden block text-[11px] font-bold text-gray-500 dark:text-gray-400 mb-1.5">
                    {index === 0 ? "Qty" : `Range ${index + 1} — Qty`}
                  </label>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={qty}
                    onChange={(e) =>
                      updateField(range.id, "qty", e.target.value.replace(/\D/g, ""))
                    }
                    disabled={disabled}
                    placeholder="—"
                    className={cn(
                      "w-full px-2 py-2.5 rounded-xl text-sm font-mono font-bold text-center border bg-gray-50/50 dark:bg-slate-800/30 focus:outline-none focus:ring-2 transition-all",
                      qty
                        ? "text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-500/20 focus:ring-emerald-500"
                        : "text-gray-400 dark:text-gray-500 border-gray-200 dark:border-slate-700 focus:ring-gray-400",
                      exceedsLimit && "focus:ring-red-500 border-red-300 dark:border-red-500/20"
                    )}
                  />
                </div>

                {/* Remove */}
                {ranges.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeRange(range.id)}
                    disabled={disabled}
                    aria-label={`Remove range ${index + 1}`}
                    className="h-11 w-11 sm:h-auto sm:w-auto sm:px-2 sm:py-2.5 text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 rounded-xl transition-all flex-shrink-0 self-end sm:self-auto flex items-center justify-center"
                  >
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>
          );
        })}

        {/* Total count + Add More */}
        <div className="flex items-center justify-between pt-1">
          <div className="flex flex-wrap items-center gap-2 sm:gap-3">
            <button
              type="button"
              onClick={addRange}
              disabled={disabled}
              className="flex items-center gap-1.5 px-3.5 py-2 min-h-[44px] text-xs font-bold text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/20 rounded-xl hover:bg-emerald-100 dark:hover:bg-emerald-500/20 transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              Add More
            </button>
            {totalSerials > 0 && (
              <span
                className={cn(
                  "text-xs font-bold px-3 py-2 rounded-xl border inline-flex items-center",
                  exceedsLimit
                    ? "bg-red-50 text-red-600 border-red-200 dark:bg-red-500/10 dark:text-red-400 dark:border-red-500/20"
                    : "bg-gray-100 text-gray-600 dark:bg-slate-800 dark:text-gray-400 dark:border-slate-700"
                )}
              >
                Total: {totalSerials} / {maxSerials}
              </span>
            )}
          </div>
        </div>

        {exceedsLimit && (
          <p className="text-xs font-bold text-red-500 dark:text-red-400 flex items-center gap-1.5">
            <AlertCircle className="w-4 h-4" />
            Total serials ({totalSerials}) exceeds the limit of {maxSerials}.
          </p>
        )}
      </div>
    );
  }
);

function parseRangeValue(val: string): RangeEntry[] {
  if (!val.trim()) return [];
  const lines = val.split("\n").map((l) => l.trim()).filter(Boolean);
  const entries: RangeEntry[] = [];
  for (const line of lines) {
    if (line.includes("-")) {
      const parts = line.split("-");
      if (parts.length === 2) {
        const start = parts[0].trim();
        const end = parts[1].trim();
        const q = calcQty(start, end);
        entries.push({ id: uid(), start, end, qty: q });
      }
    }
  }
  return entries;
}
