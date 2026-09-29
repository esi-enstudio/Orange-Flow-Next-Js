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
  // Range geometry is addressed from the <tr> rather than from each <td>. A day
  // cell knows nothing about its neighbours, so on its own it cannot tell the
  // first cell of a row the band wrapped into from a cell in the middle of a
  // band — and a band that runs off the end of a row and resumes on the next one
  // with square corners reads as a rendering bug rather than a range.
  //
  // `dp-band` / `dp-band-end` are inert marker classes (see
  // DATE_PICKER_PREVIEW_CLASS_NAMES) that exist purely to be addressable from
  // here. They also out-specify the band rules on the <td> — `tr > td.x > button`
  // is (0,2,3) against (0,1,1) — so the caps and the endpoint win regardless of
  // the order Tailwind happens to emit the utilities in.
  week: cn(
    "mt-1 flex w-full",
    // Round only the outer edge of each row segment, so a band that wraps stays
    // continuous to the eye instead of being chopped into hard squares.
    "[&>td.dp-band:first-child>button]:rounded-l-full",
    "[&>td.dp-band:last-child>button]:rounded-r-full",
    // The pending endpoint is a *state*, not a cursor position, so it is drawn
    // from its own modifier instead of `:hover`. A touch or keyboard user never
    // fires :hover, and a dashed ring that only exists under the mouse is not a
    // reliable signal for where the click will land.
    "[&>td.dp-band-end>button]:rounded-full",
    "[&>td.dp-band-end>button]:border",
    "[&>td.dp-band-end>button]:border-dashed",
    "[&>td.dp-band-end>button]:border-[color:var(--clr-primary-400)]",
    "[&>td.dp-band-end>button]:bg-[color:var(--clr-primary-100)]",
    "dark:[&>td.dp-band-end>button]:border-[color:var(--clr-primary-300)]",
    "dark:[&>td.dp-band-end>button]:bg-[color-mix(in_srgb,var(--clr-primary-500)_22%,transparent)]",
    rdp.week
  ),
  day: cn(
    "group/day relative aspect-square h-full w-full select-none p-0 text-center",
    "[&:first-child[data-selected=true]_button]:rounded-full",
    "[&:last-child[data-selected=true]_button]:rounded-full",
    rdp.day
  ),
  // The band is painted by the day button itself, so the cell stays neutral.
  range_start: cn("bg-transparent", rdp.range_start),
  // Carries the same marker as the hover preview so both draw their row caps
  // from the identical rules. A preview that wrapped to the next row with square
  // corners but committed to a rounded one would be showing the user a
  // different result than the click actually produces.
  range_middle: cn("dp-band rounded-none bg-transparent", rdp.range_middle),
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
    // See the note on DATE_PICKER_PREVIEW_CLASS_NAMES: the `primary` scale is
    // hand-written in globals.css, so it only works as an arbitrary value.
    "data-[range-middle=true]:bg-[color:var(--clr-primary-50)] data-[range-middle=true]:text-[color:var(--clr-primary-900)]",
    "data-[range-middle=true]:hover:bg-[color:var(--clr-primary-100)]",
    "dark:data-[range-middle=true]:bg-[color-mix(in_srgb,var(--clr-primary-500)_15%,transparent)] dark:data-[range-middle=true]:text-[color:var(--clr-primary-50)]",
    "dark:data-[range-middle=true]:hover:bg-[color-mix(in_srgb,var(--clr-primary-500)_25%,transparent)]",
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
 *  - That class lands on the `<td>` (the `Day` cell), not on the `<button>`,
 *    so the fill reaches the painted button through a `_button` descendant
 *    selector — the same trick `day:` uses above. Anything that needs to know
 *    about a day's position within its row (the row caps, the endpoint) cannot
 *    be expressed from there at all, which is why those rules hang off `week`.
 *
 * The endpoint is drawn as a dashed ring over the band rather than as a solid
 * fill, so it reads as "not committed yet" while the band stays visible through
 * it.
 */
export const DATE_PICKER_PREVIEW_CLASS_NAMES: ModifiersClassNames = {
  range_preview: cn(
    // Inert marker, never styled on its own — it exists so the row-level
    // geometry rules in `week` can find a band cell from the enclosing <tr>.
    "dp-band",
    "[&_button]:rounded-none",
    // `bg-primary-50` &c. are hand-written utilities in globals.css, not
    // Tailwind theme entries, so Tailwind cannot compose them with a variant
    // and silently drops `data-[...]:bg-primary-50`. Addressing the palette
    // variable through an arbitrary value keeps this a real utility, which
    // `dark:` and `[&_button]` can both build on. The `color:` hint is required:
    // a bare `var()` gives Tailwind nothing to infer the value type from.
    "[&_button]:bg-[color:var(--clr-primary-50)] [&_button]:text-[color:var(--clr-primary-900)]",
    "dark:[&_button]:bg-[color-mix(in_srgb,var(--clr-primary-500)_10%,transparent)] dark:[&_button]:text-[color:var(--clr-primary-50)]",
    // Overrides the plain day hover, which is grey and would read as a break
    // in the band.
    "[&_button:hover]:bg-[color:var(--clr-primary-100)] dark:[&_button:hover]:bg-[color-mix(in_srgb,var(--clr-primary-500)_20%,transparent)]"
  ),
  // The endpoint's appearance lives with the other row-level rules in `week`;
  // all this needs to carry is the marker they are keyed on.
  range_preview_end: "dp-band-end",
};
