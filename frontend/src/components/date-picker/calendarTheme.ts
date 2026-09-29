import { getDefaultClassNames, type ClassNames, type ModifiersClassNames } from "react-day-picker";

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
  /**
   * Row-level range styling. A day cell knows nothing about its neighbours, so the
   * *continuous* look of a selected range (left cap, right cap, row boundary
   * handling) is driven from the <tr> wrapping a row of days.
   *
   * react-day-picker v10 exposes `dp-range-start`, `dp-range-middle`, and
   * `dp-range-end` data-* attributes on the <td>, so we can read each cell's role
   * in the range and paint caps accordingly — keeping a band that wraps across
   * rows looking like one unbroken selection rather than a stack of pills.
   */
  week: cn(
    "mt-1 flex w-full",
    // Start of the range gets a rounded left edge.
    "[&>td[data-range-start=true]_button]:rounded-l-full",
    // End of the range gets a rounded right edge.
    "[&>td[data-range-end=true]_button]:rounded-r-full",
    // Middle of the range is square on both ends so the band reads as continuous.
    "[&>td[data-range-middle=true]_button]:rounded-none",
    // A single-day "range" (start === end) is a circle.
    "[&>td[data-range-start=true][data-range-end=true]_button]:rounded-full",
    // When the range wraps from the last cell of a row into the first cell of the
    // next row, the row-boundary cell that is the *end* of one visual segment is
    // also the *start* of the range continuing into the next row — keep it rounded
    // only on the side that touches the range edge.
    rdp.week
  ),
  day: cn(
    "group/day relative aspect-square h-full w-full select-none p-0 text-center",
    rdp.day
  ),
  range_start: cn("bg-[color:var(--clr-primary-600)] text-white", rdp.range_start),
  range_middle: cn(
    "bg-[color:var(--clr-primary-50)] text-[color:var(--clr-primary-900)]",
    "dark:bg-[color-mix(in_srgb,var(--clr-primary-500)_15%,transparent)] dark:text-[color:var(--clr-primary-50)]",
    rdp.range_middle
  ),
  range_end: cn("bg-[color:var(--clr-primary-600)] text-white", rdp.range_end),
  today: cn(
    "rounded-full bg-transparent font-bold text-primary-600 dark:text-primary-400",
    rdp.today
  ),
  selected: cn("bg-primary-600 text-primary-foreground", rdp.selected),
  outside: cn("text-gray-300 dark:text-slate-600", rdp.outside),
  day_button: cn(
    "text-[13px] font-medium",
    "[&>span]:text-[13px] [&>span]:opacity-90",
    "hover:bg-gray-100 hover:text-gray-900 dark:hover:bg-slate-800 dark:hover:text-gray-100",
    rdp.day_button
  ),
};

/**
 * Hover preview for a half-finished range: once a start date is picked, the
 * band up to the hovered day shows what a click would select.
 *
 * Two structural details drive the whole shape of this object:
 *
 *  - Custom modifier classes must arrive through `modifiersClassNames`, not
 *    `classNames`. `ClassNames` is a closed union of react-day-picker's own UI /
 *    DayFlag / SelectionState keys, so an arbitrary `range_preview` entry there
 *    is neither typed nor read — `getClassNamesForModifiers` checks
 *    `modifiersClassNames` first and silently falls through otherwise.
 *  - That class lands on the <td> (the Day cell), so descendant selectors carry
 *    the paint to the inner button. The same row-level geometry rules in
 *    `week` above handle the left/right caps for the preview band too.
 *
 * The endpoint is drawn as a dashed ring over the band rather than a solid fill
 * so it reads as "not committed yet" while the band stays visible through it.
 */
export const DATE_PICKER_PREVIEW_CLASS_NAMES: ModifiersClassNames = {
  range_preview: cn(
    "bg-[color:var(--clr-primary-50)] text-[color:var(--clr-primary-900)]",
    "dark:bg-[color-mix(in_srgb,var(--clr-primary-500)_10%,transparent)] dark:text-[color:var(--clr-primary-50)]",
    "[&_button]:bg-[color:var(--clr-primary-50)] [&_button]:text-[color:var(--clr-primary-900)]",
    "dark:[&_button]:bg-[color-mix(in_srgb,var(--clr-primary-500)_10%,transparent)] dark:[&_button]:text-[color:var(--clr-primary-50)]"
  ),
  range_preview_end: cn(
    "rounded-full border border-[color:var(--clr-primary-400)] bg-[color:var(--clr-primary-100)] text-[color:var(--clr-primary-900)]",
    "dark:border-[color:var(--clr-primary-300)] dark:bg-[color-mix(in_srgb,var(--clr-primary-500)_22%,transparent)] dark:text-[color:var(--clr-primary-50)]",
    "[&_button]:rounded-full [&_button]:border [&_button]:border-dashed [&_button]:border-[color:var(--clr-primary-400)] [&_button]:bg-[color:var(--clr-primary-100)] [&_button]:text-[color:var(--clr-primary-900)]",
    "dark:[&_button]:border-[color:var(--clr-primary-300)] dark:[&_button]:bg-[color-mix(in_srgb,var(--clr-primary-500)_22%,transparent)] dark:[&_button]:text-[color:var(--clr-primary-50)]"
  ),
};
