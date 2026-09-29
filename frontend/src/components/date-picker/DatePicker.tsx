"use client";

import * as React from "react";
import { bn as bnLocale, enUS } from "react-day-picker/locale";

import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { useLanguage } from "@/i18n/useLanguage";

import { DATE_PICKER_CELL_SIZE, DATE_PICKER_CLASS_NAMES } from "./calendarTheme";
import { formatYMD } from "./format";
import { DATE_PICKER_PANEL, DatePickerTrigger } from "./trigger";
import { isDateWithin, parseYMD, toYMD, type YMD } from "./utils";

export interface DatePickerProps {
  value: YMD | null;
  onChange: (value: YMD | null) => void;
  label?: string;
  hideLabel?: boolean;
  placeholder?: string;
  min?: YMD;
  max?: YMD;
  disabled?: boolean;
  disabledReason?: string;
  className?: string;
  id?: string;
  "aria-label"?: string;
}

/**
 * Single-date counterpart to `DateRangePicker`, for form fields such as date of
 * birth or a lifting date. Shares the trigger styling, the calendar settings and
 * the `YYYY-MM-DD` contract so the two are interchangeable on a form.
 */
export function DatePicker({
  value,
  onChange,
  label,
  hideLabel = false,
  placeholder,
  min,
  max,
  disabled = false,
  disabledReason,
  className,
  id,
  "aria-label": ariaLabel,
}: DatePickerProps) {
  const { t, language } = useLanguage();
  const [open, setOpen] = React.useState(false);

  const minDate = React.useMemo(() => parseYMD(min), [min]);
  const maxDate = React.useMemo(() => parseYMD(max), [max]);
  const selected = React.useMemo(() => parseYMD(value) ?? undefined, [value]);

  const displayText = value
    ? formatYMD(value, language)
    : (placeholder ?? t("common.date_range.select_date"));

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
          muted={!value}
          ariaLabel={hideLabel && label ? label : ariaLabel}
        />

        <PopoverContent align="start" sideOffset={8} collisionPadding={8} className={cn(DATE_PICKER_PANEL, "p-2.5")}>
          <Calendar
            mode="single"
            selected={selected}
            onSelect={(day) => {
              onChange(day ? toYMD(day) : null);
              if (day) setOpen(false);
            }}
            defaultMonth={selected}
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

export default DatePicker;
