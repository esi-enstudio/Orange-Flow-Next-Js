import type { CSSProperties } from "react";

/**
 * Shared helpers for the house letterhead preview (editor canvas + the compact
 * thumbnail shown on the resignation documents page).
 */

// A4 width in points (210mm). The PDF renders the body in points on a real A4
// page, so the on-screen preview scales that same size with the canvas width.
export const A4_WIDTH_PT = 595.28;

// Tags the backend sanitizer keeps in the body HTML.
export const LETTERHEAD_HTML_TAG_RE =
  /<\/?(b|strong|i|em|u|s|strike|br|div|p|span|ul|ol|li|img)\b/i;

const HTML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (char) => HTML_ESCAPES[char]);
}

/** Sample employee values so a preview never shows raw `{{placeholders}}`. */
export const LETTERHEAD_SAMPLE_VALUES: Record<string, string> = {
  application_date: "৩০ নভেম্বর ২০২৬",
  employee_name: "মোঃ আব্দুল করিম",
  fathers_name: "মোঃ আব্দুল রহমান",
  nid: "১২৩৪৫৬৭৮৯০১২৩",
  designation: "RSO (Retail Sales Officer)",
  joining_date: "১৫ জানুয়ারি ২০২১",
  resigned_date: "৩০ জুন ২০২৬",
  dms_code: "R123456",
  proprietor_name: "সামছুজ্জামান পাটোয়ারী",
  proprietor_contact: "০১৯১৭৭৪৭৫৫৫",
};

export interface PreviewBlock {
  x: number;
  y: number;
  w: number;
  size: number;
  bold?: boolean;
}

/**
 * Body text HTML with `{{key}}` placeholders filled. Legacy plain-text values
 * are escaped first so newlines survive as text, not markup.
 */
export function substituteLetterheadPlaceholders(
  text: string,
  values: Record<string, string>
): string {
  const source = LETTERHEAD_HTML_TAG_RE.test(text) ? text : escapeHtml(text);
  return source.replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (_match, key: string) =>
    escapeHtml(values[key] ?? "")
  );
}

/**
 * Position + font size for a layout block. The font is scaled with the preview
 * width, otherwise the fixed point size overflows the page on small screens.
 */
export function previewBlockStyle(block: PreviewBlock, canvasWidth: number): CSSProperties {
  return {
    left: `${block.x}%`,
    top: `${block.y}%`,
    width: `${block.w}%`,
    fontSize: canvasWidth
      ? `${(block.size * canvasWidth) / A4_WIDTH_PT}px`
      : `${block.size}pt`,
    fontWeight: block.bold ? 700 : 400,
  };
}
