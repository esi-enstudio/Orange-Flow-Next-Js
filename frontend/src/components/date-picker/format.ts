import { parseYMD, type YMD } from "./utils";

/**
 * Display-only formatting for `YYYY-MM-DD` values. This is intentionally *not*
 * the wire format — callers always keep the raw `YYYY-MM-DD` and only render
 * through here.
 *
 * Bengali output matches the existing report tables: Bengali numerals, Bengali
 * weekday and month names. English uses the en-GB short form the rest of the app
 * settled on.
 */

const BN_MONTHS = [
  "জানুয়ারি", "ফেব্রুয়ারি", "মার্চ", "এপ্রিল", "মে", "জুন",
  "জুলাই", "আগস্ট", "সেপ্টেম্বর", "অক্টোবর", "নভেম্বর", "ডিসেম্বর",
];

/**
 * The abbreviations newspapers in Bangladesh actually use. These cannot be
 * derived by truncating the full names — a plain `slice(0, 3)` turns
 * "ফেব্রুয়ারি" into "ফেব্র" and "সেপ্টেম্বর" into "সেপ্ট", neither of which is
 * how the month is written in Bangla.
 */
const BN_MONTHS_SHORT = [
  "জানু", "ফেব", "মার্চ", "এপ্রি", "মে", "জুন",
  "জুল", "আগ", "সেপ্ট", "অক্টো", "নভে", "ডিসে",
];

const toBnDigits = (value: string) =>
  value.replace(/\d/g, (d) => "০১২৩৪৫৬৭৮৯"[Number(d)]);

/**
 * Localised plain number for compact chrome (the trigger's day-count badge),
 * so a Bengali UI does not show one Latin numeral among Bengali text.
 */
export function formatNumber(value: number, language: "en" | "bn"): string {
  return language === "bn" ? toBnDigits(String(value)) : String(value);
}

export function formatYMD(ymd: YMD | null | undefined, language: "en" | "bn", fallback = "-"): string {
  const date = parseYMD(ymd);
  if (!date) return fallback;

  if (language === "bn") {
    const day = toBnDigits(String(date.getDate()));
    const month = BN_MONTHS[date.getMonth()];
    const year = toBnDigits(String(date.getFullYear()));
    return `${day} ${month} ${year}`;
  }

  return date.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

/** Short form for the trigger, where horizontal space is tight. */
export function formatYMDShort(ymd: YMD | null | undefined, language: "en" | "bn", fallback = "-"): string {
  const date = parseYMD(ymd);
  if (!date) return fallback;

  if (language === "bn") {
    const day = toBnDigits(String(date.getDate()));
    const month = BN_MONTHS_SHORT[date.getMonth()];
    const year = toBnDigits(String(date.getFullYear()));
    return `${day} ${month} ${year}`;
  }

  return date.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}
