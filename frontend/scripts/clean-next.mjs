// Remove the Next.js build/dev cache, including the `.next.stale-<date>`
// recovery copies Next.js leaves behind when it cannot reuse an existing build
// directory.
//
// Usage: npm run clean
//
// This is the recovery step for a poisoned Turbopack cache: a dev server that
// was killed while writing `.next` can make the App Router answer
// `404 - This page could not be found` for routes that exist, and can make
// PostCSS emit corrupted CSS. Removing the cache forces a clean compile.

import { readdirSync, rmSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const caches = readdirSync(root).filter(
  (entry) => entry === ".next" || entry.startsWith(".next.stale-")
);

if (caches.length === 0) {
  console.log("No Next.js cache to remove.");
  process.exit(0);
}

for (const entry of caches) {
  rmSync(path.join(root, entry), { recursive: true, force: true });
  console.log(`Removed ${entry}`);
}

console.log("Next.js cache cleared. Start the dev server again.");
