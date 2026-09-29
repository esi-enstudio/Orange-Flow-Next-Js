"use client";

import * as React from "react";
import { X } from "lucide-react";
import type { DateRange } from "react-day-picker";
import { bn as bnLocale, enUS } from "react-day-picker/locale";

import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { useLanguage } from "@/i18n/useLanguage";

import { DATE_PICKER_CELL_SIZE, DATE_PICKER_CLASS_NAMES } from "./calendarTheme";
import { formatNumber, formatYMDShort } from "./format";
import { useMediaQuery } from "./hooks";
import { buildPresets, matchPreset, type PresetId } from "./presets";
import { DATE_PICKER_PANEL, DatePickerTrigger } from "./trigger";
import {
  dayCount,
  isDateWithin,
  parseYMD,
  toYMD,
  type DateRangeValue,
  type YMD,
} from "./utils";

export interface DateRangePickerLabels {
  placeholder?: string;
  selectEndDate?: string;
  from?: string;
  to?: string;
  today?: string;
  yesterday?: string;
  last7?: string;
  last30?: string;
  thisWeek?: string;
  thisMonth?: string;
  lastMonth?: string;
  custom?: string;
  daysSelected?: string;
  presetsTitle?: string;
  clear?: string;
}

export interface DateRangePickerProps {
  value: DateRangeValue;
  onChange: (value: DateRangeValue) => void;
  label?: string;
  hideLabel?: boolean;
  placeholder?: string;
  selectEndDateLabel?: string;
  presetLabels?: DateRangePickerLabels;
  daysSelectedLabel?: string;
  min?: YMD;
  max?: YMD;
  disabled?: boolean;
  disabledReason?: string;
  className?: string;
  id?: string;
  "aria-label"?: string;
}

export function DateRangePicker({
  value,
  onChange,
  label,
  hideLabel = false,
  placeholder,
  selectEndDateLabel,
  presetLabels,
  daysSelectedLabel,
  min,
  max,
  disabled = false,
  disabledReason,
  className,
  id,
  "aria-label": ariaLabel,
}: DateRangePickerProps) {
  const { t, language } = useLanguage();
  const [open, setOpen] = React.useState(false);
  // A second month only earns its width on a wide desktop; below that the panel
  // keeps a single month so it never dominates the viewport.
  const isWide = useMediaQuery("(min-width: 1280px)");

  const minDate = React.useMemo(() => parseYMD(min), [min]);
  const maxDate = React.useMemo(() => parseYMD(max), [max]);

  // The parent owns the selection, including the half-finished state (start
  // picked, end still pending) — deriving here instead of keeping a local
  // draft keeps a single source of truth and means a reset from the parent
  // (Clear all filters) cannot be shadowed by stale local state.
  const selected = React.useMemo<DateRange>(
    () => ({ from: parseYMD(value.from) ?? undefined, to: parseYMD(value.to) ?? undefined }),
    [value.from, value.to]
  );

  const presets = React.useMemo(() => buildPresets(), []);
  const activePreset = matchPreset({ from: value.from, to: value.to });

  const presetText: Record<Exclude<PresetId, "custom">, string> = {
    today: presetLabels?.today ?? t("common.date_range.today"),
    yesterday: presetLabels?.yesterday ?? t("common.date_range.yesterday"),
    last_7_days: presetLabels?.last7 ?? t("common.date_range.last_7_days"),
    last_30_days: presetLabels?.last30 ?? t("common.date_range.last_30_days"),
    this_week: presetLabels?.thisWeek ?? t("common.date_range.this_week"),
    this_month: presetLabels?.thisMonth ?? t("common.date_range.this_month"),
    last_month: presetLabels?.lastMonth ?? t("common.date_range.last_month"),
  };

  const emit = (next: DateRange) => {
    onChange({ from: next.from ? toYMD(next.from) : null, to: next.to ? toYMD(next.to) : null });
  };

  const handleSelect = (next: DateRange | undefined) => {
    if (!next?.from) {
      emit({ from: undefined, to: undefined });
      return;
    }
    // react-day-picker reports the range on every intermediate click, so an
    // open range only counts as complete once `to` is present.
    emit({ from: next.from, to: next.to });
    if (next.to) setOpen(false);
  };

  const applyPreset = (id: Exclude<PresetId, "custom">) => {
    const preset = presets.find((p) => p.id === id);
    if (!preset) return;
    emit({ from: parseYMD(preset.from) ?? undefined, to: parseYMD(preset.to) ?? undefined });
    setOpen(false);
  };

  const hasBoth = Boolean(value.from && value.to);
  const isPartial = Boolean(value.from && !value.to);

  const displayText = isPartial
    ? `${formatYMDShort(value.from, language)} – ${selectEndDateLabel ?? t("common.date_range.select_end_date")}`
    : hasBoth
      ? `${formatYMDShort(value.from, language)} – ${formatYMDShort(value.to, language)}`
      : (placeholder ?? t("common.date_range.placeholder"));

  const showPlaceholder = !value.from && !value.to;
  const days = hasBoth ? dayCount(value.from as YMD, value.to as YMD) : 0;

  const footerText = showPlaceholder
    ? (placeholder ?? t("common.date_range.placeholder"))
    : isPartial
      ? (selectEndDateLabel ?? t("common.date_range.select_end_date"))
      : `${formatNumber(days, language)} ${daysSelectedLabel ?? t("common.date_range.days_selected")}`;

  return (
    <div className={cn("relative", className)}>
      {label && (
        <label
          htmlFor={id}
          className={hideLabel ? "sr-only" : "block text-sm font-bold text-gray-700 dark:text-gray-300 mb-1.5"}
        >
          {label}
        </label>
      )}

      <Popover open={open} onOpenChange={setOpen}>
        <DatePickerTrigger
          id={id}
          open={open}
          disabled={disabled}
          text={displayText}
          muted={showPlaceholder}
          ariaLabel={hideLabel && label ? label : ariaLabel}
          badge={
            hasBoth && days > 0 ? (
              <span
                title={daysSelectedLabel ?? t("common.date_range.days_selected")}
                className="inline-flex h-5 min-w-[20px] items-center justify-center rounded-full bg-primary-600 px-1.5 text-[11px] font-bold text-white"
              >
                {formatNumber(days, language)}
              </span>
            ) : null
          }
        />

        <PopoverContent align="start" sideOffset={8} collisionPadding={8} className={DATE_PICKER_PANEL}>
          <div className="flex flex-col sm:flex-row">
            {/* Presets: a swipeable single row on a phone, a vertical rail from
                sm up. This keeps the calendar the hero instead of a wall of chips. */}
            <div className="shrink-0 border-b border-gray-100 p-2.5 sm:w-40 sm:border-b-0 sm:border-r sm:p-3 dark:border-slate-800">
              <p className="mb-1.5 hidden px-2 text-[10px] font-bold uppercase tracking-wider text-gray-400 sm:block dark:text-slate-500">
                {presetLabels?.presetsTitle ?? t("common.date_range.presets")}
              </p>
              <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-0.5 [scrollbar-width:none] sm:mx-0 sm:flex-col sm:gap-1 sm:overflow-x-visible sm:px-0 sm:pb-0 [&::-webkit-scrollbar]:hidden">
                {(Object.keys(presetText) as (keyof typeof presetText)[]).map((presetId) => (
                  <button
                    key={presetId}
                    type="button"
                    onClick={() => applyPreset(presetId)}
                    aria-pressed={activePreset === presetId}
                    className={cn(
                      "shrink-0 cursor-pointer rounded-lg border px-2.5 py-1.5 text-[11px] font-medium whitespace-nowrap transition-colors sm:w-full sm:text-left",
                      activePreset === presetId
                        ? "border-primary-500 bg-primary-500 text-white"
                        : "border-gray-200 bg-white text-gray-600 hover:border-gray-300 hover:bg-gray-50 dark:border-slate-700 dark:bg-slate-900 dark:text-gray-300 dark:hover:bg-slate-800"
                    )}
                  >
                    {presetText[presetId]}
                  </button>
                ))}
                {activePreset === "custom" && hasBoth && (
                  <span className="inline-flex shrink-0 cursor-pointer items-center rounded-lg border border-primary-300 bg-primary-50 px-2.5 py-1.5 text-[11px] font-medium whitespace-nowrap text-primary-700 sm:w-full dark:border-primary-500/40 dark:bg-primary-500/10 dark:text-primary-300">
                    {presetLabels?.custom ?? t("common.date_range.custom")}
                  </span>
                )}
              </div>
            </div>

            <div className="p-3">
              <Calendar
                mode="range"
                selected={selected}
                onSelect={handleSelect}
                defaultMonth={parseYMD(value.from) ?? parseYMD(value.to) ?? undefined}
                numberOfMonths={isWide ? 2 : 1}
                locale={language === "bn" ? bnLocale : enUS}
                // react-day-picker v10 redefined `min`/`max` as a *count of days*, so
                // date bounds can only be expressed through `disabled` plus the
                // navigable window.
                startMonth={minDate ?? undefined}
                endMonth={maxDate ?? undefined}
                disabled={(day: Date) => !isDateWithin(day, minDate, maxDate)}
                className={DATE_PICKER_CELL_SIZE}
                classNames={DATE_PICKER_CLASS_NAMES}
              />
            </div>
          </div>

          {/* Live summary + reset, so a wide panel never hides what is selected. */}
          <div className="flex items-center justify-between gap-2 border-t border-gray-100 px-3 py-2 dark:border-slate-800">
            <span className={cn("truncate text-xs", showPlaceholder ? "text-gray-400 dark:text-gray-500" : "font-medium text-gray-700 dark:text-gray-200")}>
              {footerText}
            </span>
            {(value.from || value.to) && (
              <button
                type="button"
                onClick={() => {
                  emit({ from: undefined, to: undefined });
                  setOpen(false);
                }}
                className="inline-flex shrink-0 cursor-pointer items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-medium text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-slate-800 dark:hover:text-gray-200"
              >
                <X className="h-3 w-3" aria-hidden="true" />
                {presetLabels?.clear ?? t("common.date_range.clear")}
              </button>
            )}
          </div>
        </PopoverContent>
      </Popover>

      {disabledReason && disabled && (
        <p className="mt-1 flex items-center gap-1 text-[10px] text-gray-400 dark:text-gray-500">
          <span aria-hidden="true">ⓘ</span>
          {disabledReason}
        </p>
      )}
    </div>
  );
}

export default DateRangePicker;
