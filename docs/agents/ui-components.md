# Reusable UI Modules

> Detail spec referenced from [AGENTS.md](../../AGENTS.md). Rules here are binding; they are not optional guidance.

## Page Guide (Reusable Page Instructions) Module

### Objective

Every page must have a bilingual (বাংলা/English) **Guide** trigger that opens a modal explaining the page to newcomers — what it does, each option, common workflows, and important notes. The trigger is an **icon-only button placed at the end of the page title** — it must not sit as a separate labelled button inside the header action group.

### Implementation

- **Reusable component:** `frontend/src/components/PageGuideModal.tsx`
  ```tsx
  <div className="flex items-center gap-2.5">
    <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">{t("scratch_card_serials.title")}</h1>
    <PageGuideModal pageKey="scratch_card_serials" />
  </div>
  ```
  `pageKey` is the page's translation namespace. The component renders both the icon-only trigger and the modal (portal + body scroll lock + framer-motion). It renders nothing when the page has no `guide.*` translations.
  - The trigger is a small round `HelpCircle` icon (24x24 visual on desktop, 40x40 touch target on mobile) with `title` + `aria-label` for accessibility — no visible text label.
  - Place it **immediately after the `<h1>`** inside the same flex row, so the icon reads as the tail of the page title.
  - The icon stays outside the `<h1>` element itself (button as a sibling, not a child) so the heading's accessible name stays clean.

- **Content** authored in `frontend/src/i18n/translations.ts` under each page's namespace:
  - `guide.title` — modal heading
  - `guide.overview` — 1–2 sentence page summary (component renders nothing if this key is missing)
  - `guide.features_title` / `guide.steps_title` / `guide.notes_title` — section labels
  - `guide.features.f1.title` / `.desc`, `f2`, ... — each page option/button/filter
  - `guide.steps.s1.title` / `.desc`, `s2`, ... — step-by-step workflows
  - `guide.notes.n1.title` / `.desc`, `n2`, ... — tips/warnings

- Both `en` and `bn` translations **must** be authored together.

### Rules

1. Every page must include `<PageGuideModal pageKey="<namespace>" />` right after its `<h1>` page title (same flex row) — **never** as a standalone button in the header action group / toolbar
2. For panel or embedded views (cards inside another page, drawer panels) apply the same idea: icon after the panel title, not in the panel's action row
3. Every page must have complete `guide.*` content in `translations.ts` (en + bn)
4. Minimum keys per page: `title`, `overview`, plus at least `features_title` and one `features.f1`
5. If `guide.overview` is missing, the component safely renders nothing — no breakage
6. Guide trigger is informational (no extra permission required beyond the page's view permission)
7. Icon-only trigger must keep a mobile touch target of at least 40x40px and show `cursor-pointer` on hover

### Status Calculation Rules (Time-Based)

Employee performance status is determined by a **time-based comparison**, not raw percentage alone.

#### Logic (`timeBasedStatus`)

```
First 7 days of the month → raw percentage thresholds:
  ≥ 100% → Achieved
  ≥ 70%  → On Track
  ≥ 40%  → Needs Attention
  < 40%  → Behind

After 7 days → time-based:
  timePct = (daysElapsed / totalDays) × 100
  ≥ 100%       → Achieved
  ≥ timePct    → On Track        (at or ahead of schedule)
  ≥ timePct × 0.5 → Needs Attention (behind but within half of pace)
  < timePct × 0.5 → Behind        (significantly behind pace)
```

#### Example

| Day | daysElapsed | timePct | Achievement | Status      |
|-----|-------------|---------|-------------|-------------|
| 15  | 15          | 50%     | 60%         | On Track    |
| 15  | 15          | 50%     | 30%         | Needs Attention (≥25%) |
| 15  | 15          | 50%     | 20%         | Behind      |
| 27  | 26          | 86.7%   | 81.9%       | Needs Attention |
| 27  | 26          | 86.7%   | 19.7%       | Behind      |

#### Implementation
- Frontend function: `timeBasedStatus(pct, daysElapsed, totalDays)` in `page.tsx` and `export-activations.ts`
- Used in: `PerformanceTable` (employee rows + subtotal), Target vs Achievement card, Excel export KPI + employee rows
- Backend always sends raw `emp.status` / `emp.percentage`; frontend overrides display with time-based logic

---

### Responsive Table — Accordion Behavior

#### Breakpoint
- **lg (1024px) and above**: Normal scrollable `<table>` with all columns
- **Below lg**: Accordion list view (`<div>` with expandable rows)

#### Accordion Structure
```
┌──────────────────────────────────────────┐
│ [Rank badge]  Name                       │
│               itop/pool_number           │ ← Always visible (header)
│                               ▼ Chevron  │
├──────────────────────────────────────────┤
│ (expanded on click)                      │
│ Target: 100                              │
│ Achieved: 85  [StatusBadge]              │
│ %: 85%                                   │
│ Remaining: 15                            │
│ Daily Average: 5                         │
│ Projection: 150                          │
│ ─── Per-type rows (RSO/BP) ───          │
│ Market / Own Activation / Yesterday etc. │
└──────────────────────────────────────────┘
```

#### Rules
- Only **one** row expandable at a time (managed via `expandedId` state)
- Name + rank badge + identifier always visible (no scroll needed)
- Expanded content follows the same field order as the desktop table
- StatusBadge shown next to Achievement in expanded view
- Per-type extra rows (RSO Market/Own Activation, BP Yesterday/Day Count) only render for matching type

#### Implementation
- Component: `PerformanceTable` in `page.tsx`
- State: `expandedId: number | null`
- Uses `hidden lg:block` / `lg:hidden` for view switching
- No custom breakpoints — uses Tailwind's default `lg:`
