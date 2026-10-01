/**
 * Shared SIM serial-length validation helpers.
 *
 * The expected serial digit length is configurable from System Settings
 * (default 18) and is enforced across all DMS serial entry pages.
 *
 * Both the range Start and End serials must be exactly `serialLength` digits.
 */

export const DEFAULT_SERIAL_LENGTH = 18;
export const MIN_SERIAL_LENGTH = 1;
export const MAX_SERIAL_LENGTH = 30;

export type SerialLengthError =
  | "too_short"
  | "too_long"
  | "range_short"
  | "range_long";

/** Keep only digits, capped at the configured serial length. */
export function sanitizeSerialInput(value: string, serialLength: number): string {
  return value.replace(/\D/g, "").slice(0, serialLength);
}

/** Validate a single serial token against the configured length. */
export function validateSerialLength(
  value: string,
  serialLength: number
): SerialLengthError | null {
  if (!value) return null;
  if (value.length !== serialLength) {
    return value.length < serialLength ? "too_short" : "too_long";
  }
  return null;
}

/**
 * Validate one input line. A line is either a plain serial or a "start-end" range.
 * The Start and End serials of a range must both be exactly `serialLength` digits.
 * Returns null when valid, otherwise an error code.
 */
export function validateSerialLine(
  rawLine: string,
  serialLength: number
): SerialLengthError | null {
  const line = rawLine.trim();
  if (!line) return null;

  if (line.includes("-")) {
    const parts = line.split("-");
    if (parts.length === 2) {
      const start = parts[0].trim();
      const end = parts[1].trim();
      if (/^\d+$/.test(start) && /^\d+$/.test(end)) {
        return (
          validateSerialLength(start, serialLength) ??
          validateSerialLength(end, serialLength)
        );
      }
    }
  }

  const digits = line.replace(/\D/g, "");
  if (!digits) return null;
  return validateSerialLength(digits, serialLength);
}

export interface SerialListAnalysis {
  total: number;
  invalid: number;
}

/** Analyze a multi-line textarea value, counting lines with invalid lengths. */
export function analyzeSerialList(
  value: string,
  serialLength: number
): SerialListAnalysis {
  const lines = value
    .split(/[\n,;]+/)
    .map((l) => l.trim())
    .filter(Boolean);
  let invalid = 0;
  for (const line of lines) {
    if (validateSerialLine(line, serialLength)) invalid += 1;
  }
  return { total: lines.length, invalid };
}
