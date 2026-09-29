import { addDays, addMonths, endOfMonth, startOfMonth, startOfWeek, todayYMD, type YMD } from "./utils";

export type PresetId =
  | "today"
  | "yesterday"
  | "last_7_days"
  | "last_30_days"
  | "this_week"
  | "this_month"
  | "last_month"
  | "custom";

export interface DatePreset {
  id: PresetId;
  from: YMD;
  to: YMD;
}

/**
 * Ranges are resolved against a caller-supplied `today` so tests and the
 * calendar can stay in step, and so rendering a preset never drifts from the
 * value the user is actually looking at.
 */
export function buildPresets(today: YMD = todayYMD()): DatePreset[] {
  const thisMonthStart = startOfMonth(today);
  // Step back a month from the *first* of this month, then take that month's
  // end. Going via `addMonths(endOfMonth(...))` instead would clamp 30 Sep back
  // to 30 Aug and silently truncate the last month by a day.
  const lastMonthStart = addMonths(thisMonthStart, -1);
  return [
    { id: "today", from: today, to: today },
    { id: "yesterday", from: addDays(today, -1), to: addDays(today, -1) },
    { id: "last_7_days", from: addDays(today, -6), to: today },
    { id: "last_30_days", from: addDays(today, -29), to: today },
    { id: "this_week", from: startOfWeek(today), to: today },
    { id: "this_month", from: thisMonthStart, to: today },
    { id: "last_month", from: lastMonthStart, to: endOfMonth(lastMonthStart) },
  ];
}

/** First preset whose range equals the current selection, for the active chip. */
export function matchPreset(range: { from: YMD | null; to: YMD | null }): PresetId | null {
  if (!range.from || !range.to) return null;
  const found = buildPresets().find((p) => p.from === range.from && p.to === range.to);
  return found ? found.id : "custom";
}
