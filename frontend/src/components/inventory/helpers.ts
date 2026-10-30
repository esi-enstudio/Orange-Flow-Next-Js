export function formatDate(value?: string | null): string {
  if (!value) return "-";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export function houseHeaders(houseId?: number): Record<string, string> {
  return houseId ? { "X-House-ID": String(houseId) } : {};
}

export function apiError(err: unknown, fallback: string) {
  const response = (err as { response?: { data?: any } })?.response?.data;
  const detail = response?.detail;
  let message = fallback;

  if (typeof detail === "string") {
    message = detail;
  } else if (detail && typeof detail === "object") {
    message = detail.message || fallback;
  } else if (response?.error?.message) {
    message = response.error.message;
  }

  const fields =
    response?._fieldErrors ||
    (detail && typeof detail === "object" ? detail.fields : undefined) ||
    (response?.error?.fields as Record<string, string> | undefined);

  return { message, fields: fields as Record<string, string> | undefined };
}
