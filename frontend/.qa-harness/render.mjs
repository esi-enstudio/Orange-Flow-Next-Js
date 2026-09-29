// Renders the REAL calendar with the REAL theme to static HTML, in the exact
// hover states we care about, so the band can be judged visually.
import { createJiti } from "jiti";
import { renderToStaticMarkup } from "react-dom/server";
import * as React from "react";

const SRC = "/home/emil/opt/Orange-Flow-Next-Js/frontend/src";
const jiti = createJiti(import.meta.url, {
  alias: { "@": SRC },
  jsx: { runtime: "automatic" },
  interopDefault: true,
});

const { Calendar } = jiti(`${SRC}/components/ui/calendar.tsx`);
const theme = jiti(`${SRC}/components/date-picker/calendarTheme.ts`);
const { isDayInRange, isSameDay } = jiti(`${SRC}/components/date-picker/utils.ts`);

const { DATE_PICKER_CLASS_NAMES, DATE_PICKER_PREVIEW_CLASS_NAMES, DATE_PICKER_CELL_SIZE } = theme;

const ymd = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

function scenario(name, { from, to, hover, note }) {
  const fromDate = from ? new Date(`${from}T00:00:00`) : undefined;
  const toDate = to ? new Date(`${to}T00:00:00`) : undefined;
  const isPartial = Boolean(fromDate && !toDate);
  const hoverDate = hover ? new Date(`${hover}T00:00:00`) : undefined;

  const preview =
    isPartial && hoverDate && fromDate
      ? { lo: fromDate, hi: hoverDate }
      : null;

  const modifiers = preview
    ? {
        range_preview: (day) => isDayInRange(day, preview.lo, preview.hi),
        range_preview_end: (day) => isSameDay(day, preview.hi),
      }
    : undefined;

  const html = renderToStaticMarkup(
    React.createElement(Calendar, {
      mode: "range",
      selected: { from: fromDate, to: toDate },
      defaultMonth: fromDate ?? toDate,
      numberOfMonths: 1,
      showOutsideDays: true,
      className: DATE_PICKER_CELL_SIZE,
      classNames: DATE_PICKER_CLASS_NAMES,
      modifiers,
      modifiersClassNames: DATE_PICKER_PREVIEW_CLASS_NAMES,
    })
  );

  const band = preview
    ? `${ymd(preview.lo)} → ${ymd(preview.hi)}`
    : "—";

  return `
  <section class="case">
    <header>
      <h2>${name}</h2>
      <p>${note}</p>
      <p class="band">band: ${band}</p>
    </header>
    <div class="panel">${html}</div>
  </section>`;
}

const cases = [
  scenario("1. Empty — no start yet", { note: "nothing should be highlighted", from: null }),
  scenario("2. Partial, hover forward", {
    from: "2026-09-10",
    to: null,
    hover: "2026-09-16",
    note: "LIVE PREVIEW: 10 → 16, endpoint is 16",
  }),
  scenario("3. Partial, hover backward", {
    from: "2026-09-10",
    to: null,
    hover: "2026-09-05",
    note: "LIVE PREVIEW: 5 → 10, endpoint is 5 (earlier day)",
  }),
  scenario("4. Partial, hover = start", {
    from: "2026-09-10",
    to: null,
    hover: "2026-09-10",
    note: "single-day preview",
  }),
  scenario("5. Committed range", {
    from: "2026-09-10",
    to: "2026-09-16",
    note: "for comparison with the preview band",
  }),
  scenario("6. Crosses month boundary", {
    from: "2026-09-26",
    to: null,
    hover: "2026-10-04",
    note: "band must stay contiguous across the last row",
  }),
].join("\n");

const html = `<!doctype html>
<html><head><meta charset="utf-8">
<link rel="stylesheet" href="./out.css">
<style>
  body { font-family: system-ui, sans-serif; background:#f8fafc; margin:0; padding:24px; }
  .grid { display:flex; flex-wrap:wrap; gap:24px; align-items:flex-start; }
  .case { background:#fff; border:1px solid #e2e8f0; border-radius:12px; padding:12px; }
  .case h2 { font-size:13px; margin:0 0 2px; }
  .case p { font-size:11px; color:#64748b; margin:0; }
  .case .band { color:#7c3aed; font-weight:600; }
  .panel { margin-top:8px; }
</style></head>
<body><div class="grid">${cases}</div></body></html>`;

process.stdout.write(html);
