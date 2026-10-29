import apiClient from "@/lib/api";

/** Report renders are image builds; give them time before the fetch gives up. */
const PRINT_TIMEOUT = 180_000;

interface PrintReportImageOptions {
  /** Backend print endpoint, e.g. "reports/active-lso/print". */
  path: string;
  houseId?: number | null;
  params?: Record<string, string | number | boolean>;
}

/**
 * Print a report in the WhatsApp delivery layout.
 *
 * The backend renders the report with the same image builder the WhatsApp send
 * uses (one PNG per A4 page) and returns a self-contained HTML document with
 * those pages inlined and `window.print()` wired up. This opens that document
 * in a new window, so the printout matches the image recipients receive.
 */
export async function printReportImage({ path, houseId, params }: PrintReportImageOptions): Promise<void> {
  // Opened synchronously: a window opened after the await would be popup-blocked.
  const win = window.open("", "_blank");
  try {
    const res = await apiClient.get(path, {
      params: params ?? {},
      headers: houseId ? { "X-House-ID": String(houseId) } : {},
      responseType: "text",
      // Keep the HTML document verbatim instead of letting axios JSON-parse it.
      transformResponse: [(data) => data],
      timeout: PRINT_TIMEOUT,
    });
    if (!win) throw new Error("Print window was blocked by the browser");
    win.document.open();
    win.document.write(String(res.data));
    win.document.close();
  } catch (error) {
    if (win) win.close();
    throw error;
  }
}
