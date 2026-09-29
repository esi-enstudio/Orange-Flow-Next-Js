/**
 * Date helpers for the date pickers.
 *
 * Every value that crosses a component boundary or hits the API is a
 * `YYYY-MM-DD` string. That is what a native `<input type="date">` already
 * yields and what every backend endpoint in this project expects, so nothing
 * downstream needs to convert.
 *
 * Timezone rules that these helpers exist to enforce:
 *
 *  - Never build a "today" from `toISOString()`. That is UTC, and Bangladesh
 *    runs UTC+6, so any call before 06:00 local yields *yesterday's* date.
 *  - Never parse a `YYYY-MM-DD` with `new Date(str)`. JS reads that as UTC
 *    midnight, which renders as the previous day in negative-offset zones and
 *    desyncs react-day-picker's internal matching. `parseYMD` builds a local
 *    midnight instead.
 */

export type YMD = string;

export interface DateRangeValue {
  from: YMD | null;
  to: YMD | null;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** Local-timezone calendar date as `YYYY-MM-DD`. Never use `toISOString()`. */
export function toYMD(date: Date): YMD {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Local midnight for a `YYYY-MM-DD` string. Returns `null` when unparseable. */
export function parseYMD(ymd: YMD | null | undefined): Date | null {
  if (!ymd) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd.trim());
  if (!match) return null;
  const [, y, m, d] = match;
  const date = new Date(Number(y), Number(m) - 1, Number(d));
  // Reject overflow like 2026-02-31, which JS would silently roll into March.
  if (date.getFullYear() !== Number(y) || date.getMonth() !== Number(m) - 1 || date.getDate() !== Number(d)) {
    return null;
  }
  return date;
}

export function todayYMD(): YMD {
  return toYMD(new Date());
}

export function isValidYMD(ymd: YMD | null | undefined): boolean {
  return parseYMD(ymd) !== null;
}

/** Chronological compare on the `YYYY-MM-DD` strings themselves. */
export function compareYMD(a: YMD, b: YMD): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function addDays(ymd: YMD, days: number): YMD {
  const date = parseYMD(ymd);
  if (!date) return ymd;
  date.setDate(date.getDate() + days);
  return toYMD(date);
}

export function addMonths(ymd: YMD, months: number): YMD {
  const date = parseYMD(ymd);
  if (!date) return ymd;
  const targetDay = date.getDate();
  date.setDate(1);
  date.setMonth(date.getMonth() + months);
  // Clamp so 31 Jan minus one month lands on 28/29 Feb rather than spilling
  // into the following month.
  const daysInTarget = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
  date.setDate(Math.min(targetDay, daysInTarget));
  return toYMD(date);
}

export function startOfMonth(ymd: YMD): YMD {
  return `${ymd.slice(0, 7)}-01`;
}

export function endOfMonth(ymd: YMD): YMD {
  const date = parseYMD(ymd);
  if (!date) return ymd;
  return toYMD(new Date(date.getFullYear(), date.getMonth() + 1, 0));
}

/**
 * Week starts Sunday. That matches `date-fns`'s `bn` locale (`weekStartsOn: 0`)
 * and therefore the calendar grid the user is looking at — if the preset
 * disagreed with the grid, "This Week" would look wrong.
 */
export function startOfWeek(ymd: YMD): YMD {
  const date = parseYMD(ymd);
  if (!date) return ymd;
  date.setDate(date.getDate() - date.getDay());
  return toYMD(date);
}

/** Inclusive day count, so a same-day range is 1 and not 0. */
export function dayCount(from: YMD, to: YMD): number {
  const a = parseYMD(from);
  const b = parseYMD(to);
  if (!a || !b) return 0;
  return Math.round((b.getTime() - a.getTime()) / 86_400_000) + 1;
}

/** True when `ymd` is at or before `max`, and at or after `min`. */
export function withinBounds(ymd: YMD, min?: YMD, max?: YMD): boolean {
  if (min && compareYMD(ymd, min) < 0) return false;
  if (max && compareYMD(ymd, max) > 0) return false;
  return true;
}

/**
 * Comparator for react-day-picker. Matches on the calendar day only and ignores
 * the time component, so a cell always lines up with the `YYYY-MM-DD` it maps
 * to regardless of which midnight react-day-picker built it from.
 */
export function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

export function isDateWithin(day: Date, min?: Date | null, max?: Date | null): boolean {
  if (min && compareDay(day, min) < 0) return false;
  if (max && compareDay(day, max) > 0) return false;
  return true;
}

/**
 * True when `day` sits between `lo` and `hi`, inclusive, in either order.
 *
 * Order-independent on purpose: dragging backwards from the start date is a
 * normal gesture in a range picker, and hiding the band there would leave the
 * user with no feedback at all about what they are about to select.
 */
export function isDayInRange(day: Date, lo: Date, hi: Date): boolean {
  const [start, end] = compareDay(lo, hi) <= 0 ? [lo, hi] : [hi, lo];
  return compareDay(day, start) >= 0 && compareDay(day, end) <= 0;
}

function compareDay(a: Date, b: Date): number {
  const at = a.getTime() - a.getHours() * 3_600_000 - a.getMinutes() * 60_000;
  const bt = b.getTime() - b.getHours() * 3_600_000 - b.getMinutes() * 60_000;
  return at === bt ? 0 : at < bt ? -1 : 1;
}
