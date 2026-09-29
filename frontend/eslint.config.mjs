import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Vendored third-party skill packages (shadcn, tailwind, design guides,
    // etc.). They are upstream reference material, not application code, so we
    // neither lint nor own their issues.
    ".agents/**",
  ]),

  // ---------------------------------------------------------------------------
  // Lint debt triage (added 2026-09-29)
  //
  // Background: this file has never carried rule overrides. The 466 errors it
  // used to report arrived through dependency drift — `eslint-config-next`
  // pulls in `eslint-plugin-react-hooks@7.x` transitively, and v7 added the
  // React Compiler ruleset. Nothing here was enabled deliberately, and the
  // codebase was never triaged against it.
  //
  // The rules below are downgraded in two buckets. The split is deliberate:
  // 418 of the 466 errors are high-volume noise that would train the team to
  // ignore lint output entirely, while the ~48 in bucket B include 41 genuine
  // correctness bugs we do not want to lose sight of.
  //
  // Re-enabling a rule means fixing the underlying code, not deleting a line
  // here. Exit criteria for each are noted below.
  // ---------------------------------------------------------------------------
  {
    rules: {
      // --- Bucket A: high volume, structural, needs its own task -------------
      // 287 errors / 77 files. Replacing `any` with real types cascades into new
      // type errors; it is a type-safety project, not a lint sweep.
      // Exit criteria: app has a type-safety backlog and tsc stays clean.
      "@typescript-eslint/no-explicit-any": "off",

      // 131 errors / 77 files. The dominant pattern is data fetching in an
      // effect, which is load-bearing across the app — "fixing" it changes
      // request timing, loading states and pagination in ways that need
      // per-page verification. No test suite exists to catch regressions.
      // Exit criteria: fetch layer is centralised (react-query/SWR or an
      // equivalent) and per-page behaviour is covered by tests.
      "react-hooks/set-state-in-effect": "off",

      // --- Bucket B: low volume, real bugs, keep the signal -----------------
      // 27 errors, 26 of them in src/app/setup/page.tsx. Reading ref.current
      // during render produces stale/torn UI. THIS IS A REAL BUG.
      // Exit criteria: setup/page.tsx is rewritten to read refs in effects or
      // callbacks, then re-enable as "error".
      "react-hooks/refs": "warn",

      // 7 errors. Mutating state or props in place. THIS IS A REAL BUG.
      // Exit criteria: immutable updates land, then re-enable as "error".
      "react-hooks/immutability": "warn",

      // 4 errors, all in commission/components/FilterSidebar.tsx. Components
      // defined during render remount on every parent render, losing local
      // state. THIS IS A REAL BUG.
      // Exit criteria: hoisted out of the render body, then re-enable.
      "react-hooks/static-components": "warn",

      // 3 errors. Impure render (side effects during render).
      // Exit criteria: effects moved into useEffect, then re-enable.
      "react-hooks/purity": "warn",

      // 2 errors. Manual useMemo defeats the cache.
      // Exit criteria: dead memos removed, then re-enable.
      "react-hooks/preserve-manual-memoization": "warn",

      // 2 errors. Trivial and worth keeping visible.
      "react/no-unescaped-entities": "warn",
      "prefer-const": "warn",

      // 2 errors, both false positives: CommonJS `require` is correct and
      // idiomatic in next.config.js and root-level Node scripts. Prefer scoping
      // this rule to src/** so it stops firing on config files.
      "@typescript-eslint/no-require-imports": "warn",
    },
  },
]);

export default eslintConfig;
