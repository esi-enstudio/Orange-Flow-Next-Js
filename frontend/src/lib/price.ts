/**
 * Lifting price / amount formatting.
 *
 * A scratch card is quoted to four decimals (e.g. 97.1465), every other lifting
 * product carries a two-decimal price. A scratch-card price therefore keeps at
 * least two decimals — it still reads as money — and up to four, so no stored
 * precision is rounded away. Amounts computed from those prices (line totals,
 * total lifting, remaining, iTopUp) are rendered with the same precision, so a
 * line always reads exactly as ``unit price x quantity``.
 */

/** Decimals a lifting price can carry — the scratch-card price precision. */
export const PRICE_DECIMALS = 4;

const SCRATCH_CARD_KW = "scratch";

/** Two to four decimals: round money values never grow a trailing `.00`. */
const PRICE_FORMAT: Intl.NumberFormatOptions = {
  minimumFractionDigits: 2,
  maximumFractionDigits: PRICE_DECIMALS,
};

/**
 * Any category whose normalized form contains "scratch" (e.g. "Scratch Card",
 * "scratch_card", "Scratch") is treated as a scratch-card price and keeps up
 * to four decimals.
 */
export function isScratchCardCategory(category?: string | null): boolean {
  return (category || "").trim().toLowerCase().includes(SCRATCH_CARD_KW);
}

/**
 * Round a money value to the price precision (4 dp).
 *
 * Used for both display and calculation so the number that is shown is the
 * number that was added up: ``97.1465 x 3`` is 291.4395, never
 * 291.4394999999999.
 */
export function roundPrice(value: number | string | null | undefined): number {
  const raw = Number(value ?? 0);
  if (!Number.isFinite(raw)) return 0;
  return Math.round((raw + Number.EPSILON) * 10 ** PRICE_DECIMALS) / 10 ** PRICE_DECIMALS;
}

/** A lifting amount (line total, deposit, remaining, iTopUp): 2 to 4 decimals. */
export function formatLiftingAmount(
  value: number | string | null | undefined
): string {
  return roundPrice(value).toLocaleString(undefined, PRICE_FORMAT);
}

/**
 * A lifting *unit price* cell.
 *
 * Scratch cards show two to four decimals (`97.1465`); every other product
 * keeps the module's plain number (`100`).
 */
export function formatPrice(
  value: number | string | null | undefined,
  category?: string | null
): string {
  const raw = Number(value ?? 0);
  if (!Number.isFinite(raw)) return "0";
  if (isScratchCardCategory(category)) {
    return roundPrice(raw).toLocaleString(undefined, PRICE_FORMAT);
  }
  return raw.toLocaleString();
}
