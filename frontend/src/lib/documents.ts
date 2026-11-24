export function getDocumentErrorMessage(error: unknown, fallback: string): string {
  if (typeof error !== "object" || error === null || !("response" in error)) return fallback;
  const response = error.response;
  if (typeof response !== "object" || response === null || !("data" in response)) return fallback;
  const data = response.data;
  if (typeof data !== "object" || data === null || !("detail" in data)) return fallback;
  const detail = data.detail;
  if (typeof detail === "string") return detail;
  if (typeof detail === "object" && detail !== null && "message" in detail && typeof detail.message === "string") {
    return detail.message;
  }
  return fallback;
}

export function getDocumentFieldErrors(error: unknown): Record<string, string> {
  if (typeof error !== "object" || error === null || !("response" in error)) return {};
  const response = error.response;
  if (typeof response !== "object" || response === null || !("data" in response)) return {};
  const data = response.data;
  if (typeof data !== "object" || data === null) return {};
  // apiClient's response interceptor flattens structured detail.fields into
  // data._fieldErrors while replacing detail with its message string.
  const fields = "_fieldErrors" in data ? data._fieldErrors : undefined;
  if (typeof fields !== "object" || fields === null) return {};
  return Object.fromEntries(
    Object.entries(fields).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );
}

export function formatDocumentDate(value: string | null | undefined): string {
  if (!value) return "-";
  const datePart = value.slice(0, 10);
  const parsed = new Date(`${datePart}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return "-";
  return parsed.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

export function formatDocumentDateTime(value: string | null | undefined): string {
  if (!value) return "-";
  const dateTimeValue = /(?:Z|[+-]\d{2}:\d{2})$/i.test(value) ? value : `${value}+06:00`;
  const parsed = new Date(dateTimeValue);
  if (Number.isNaN(parsed.getTime())) return "-";
  return `${formatDocumentDate(value)} ${parsed.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Dhaka",
  })}`;
}
