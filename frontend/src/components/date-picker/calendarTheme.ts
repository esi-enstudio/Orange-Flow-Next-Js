import { getDefaultClassNames, type ClassNames } from "react-day-picker";

import { cn } from "@/lib/utils";

/**
 * Shared calendar skin so a range field and a single-date field sitting on the
 * same form are visually indistinguishable.
 *
 * `--cell-size` is the only responsive knob: 40px cells on a phone keep every
 * day a comfortable touch target, stepping down to 32px once there is room for a
 * second month beside the preset rail.
 */
export const DATE_PICKER_CELL_SIZE =
  "p-0 [--cell-size:2.5rem] sm:[--cell-size:2.25rem] xl:[--cell-size:2rem]";

const rdp = getDefaultClassNames();

/**
 * Overrides layered on top of the generated `ui/calendar` classes.
 *
 * `ui/calendar` spreads `classNames` last, so an override *replaces* the default
 * entry for that key rather than merging with it. Every default class (including
 * the `rdp-*` hooks other code and tests rely on) is therefore re-applied here;
 * tailwind-merge then drops whichever utility actually conflicts.
 */
export const DATE_PICKER_CLASS_NAMES: Partial<ClassNames> = {
  root: cn("w-full bg-transparent", rdp.root),
  months: cn("relative flex flex-col gap-6 sm:flex-row sm:gap-7", rdp.months),
  month: cn("flex w-full flex-col gap-3", rdp.month),
  month_caption: cn("flex h-7 w-full items-center justify-center px-0", rdp.month_caption),
  caption_label: cn(
    "select-none text-sm font-semibold text-gray-900 dark:text-gray-100",
    rdp.caption_label
  ),
  month_grid: cn("w-full border-collapse", rdp.month_grid),
  weekday: cn(
    "flex-1 select-none rounded-md text-[11px] font-semibold text-gray-400 dark:text-slate-500",
    rdp.weekday
  ),
  week: cn("mt-1 flex w-full", rdp.week),
  day: cn(
    "group/day relative aspect-square h-full w-full select-none p-0 text-center",
    "[&:first-child[data-selected=true]_button]:rounded-full",
    "[&:last-child[data-selected=true]_button]:rounded-full",
    rdp.day
  ),
  // The band is painted by the day button itself, so the cell stays neutral.
  range_start: cn("bg-transparent", rdp.range_start),
  range_middle: cn("rounded-none bg-transparent", rdp.range_middle),
  range_end: cn("bg-transparent", rdp.range_end),
  // Today reads as a highlighted label, not a filled block competing with a real
  // selection.
  today: cn(
    "rounded-full bg-transparent font-bold text-primary-600 data-[selected=true]:rounded-full dark:text-primary-400",
    rdp.today
  ),
  outside: cn("text-gray-300 dark:text-slate-600", rdp.outside),
  day_button: cn(
    "text-[13px] font-medium",
    "[&>span]:text-[13px] [&>span]:opacity-90",
    "hover:bg-gray-100 hover:text-gray-900 dark:hover:bg-slate-800 dark:hover:text-gray-100",
    "data-[selected-single=true]:rounded-full",
    "data-[range-start=true]:rounded-full",
    "data-[range-end=true]:rounded-full",
    "data-[range-middle=true]:rounded-none",
    "data-[range-middle=true]:bg-primary-50 data-[range-middle=true]:text-primary-900",
    "data-[range-middle=true]:hover:bg-primary-100",
    "dark:data-[range-middle=true]:bg-primary-500/15 dark:data-[range-middle=true]:text-primary-50",
    "dark:data-[range-middle=true]:hover:bg-primary-500/25",
    rdp.day_button
  ),
};
