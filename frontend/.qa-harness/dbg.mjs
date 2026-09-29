import { createJiti } from "jiti";
import { renderToStaticMarkup } from "react-dom/server";
import * as React from "react";
const SRC = "/home/emil/opt/Orange-Flow-Next-Js/frontend/src";
const jiti = createJiti(import.meta.url, { alias: { "@": SRC }, jsx: { runtime: "automatic" }, interopDefault: true });
const { Calendar } = jiti(`${SRC}/components/ui/calendar.tsx`);
const { isDayInRange, isSameDay } = jiti(`${SRC}/components/date-picker/utils.ts`);

const lo = new Date("2026-09-10T00:00:00"), hi = new Date("2026-09-16T00:00:00");
let calls = 0;
const html = renderToStaticMarkup(React.createElement(Calendar, {
  mode: "range", selected: { from: lo, to: undefined }, defaultMonth: lo, numberOfMonths: 1,
  modifiers: {
    range_preview: (d) => { calls++; return isDayInRange(d, lo, hi); },
    always: () => true,
  },
  modifiersClassNames: { range_preview: "BANDCLASS", always: "ALWAYSCLASS" },
}));
console.log("modifier fn calls:", calls);
console.log("BANDCLASS present:", html.includes("BANDCLASS"), "count:", html.split("BANDCLASS").length-1);
console.log("ALWAYSCLASS present:", html.includes("ALWAYSCLASS"), "count:", html.split("ALWAYSCLASS").length-1);
const m = html.match(/<td[^>]*class="[^"]*BANDCLASS[^"]*"[^>]*>/);
console.log("sample td:", m ? m[0].slice(0,220) : "NONE");
