# Mobile Compact Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce shared mobile page gutters to 8px, make the RSO targets page one-column on mobile, and store the rule for all pages.

**Architecture:** Reduce the dashboard shell's mobile padding globally. Apply page-specific responsive classes to the RSO targets page so section/action groups, form grids, modal inputs, and buttons stack below `sm`; retain the project's responsive table behavior.

**Tech Stack:** Next.js App Router, React, Tailwind CSS, existing dashboard layout.

**Spec:** `docs/superpowers/specs/2026-11-18-mobile-compact-layout-design.md`

## Global Constraints

- Mobile base is below Tailwind `sm` (640px); the shared shell gutter is 8px.
- On mobile, page-level section/action groups and grouped buttons use one column; form fields use one column.
- Keep interactive touch targets at least 44x44px.
- Keep table handling within the responsive table patterns already documented.
- Do not add a frontend test runner; verify with lint, TypeScript, and browser checks at 375px, 414px, 768px, and 1280px.
- The new responsive rule is binding for all existing and new routes; this task changes the shared gutter and the requested RSO page, not every route implementation.

## Review Focus

- **Nested padding:** shared shell and page root together leave no more than 8px of mobile outer gutter on `/targets/rso`.
- **Action groups:** header and filter actions stack at 375px and remain usable with 44px touch targets.
- **Form grids:** all two-field grids in the RSO form become one column below `sm`.
- **Responsive table:** data table may scroll within its own container, but the document itself has no horizontal overflow.
- **Desktop regression:** existing two-column form and horizontal header/action layout return above the mobile breakpoint.

---

### Task 1: Store and apply the compact mobile layout rule

**Files:**
- Modify: `docs/agents/responsive.md`
- Modify: `frontend/src/components/layout/DashboardLayout.tsx`
- Modify: `frontend/src/app/targets/rso/page.tsx`

**Interfaces:**
- Consumes: Tailwind `sm` breakpoint and existing responsive table guidance.
- Produces: 8px shared mobile gutter and compact one-column layout in the RSO targets page.

- [ ] **Step 1: Record the global mobile layout standard**

Add a binding rule to `docs/agents/responsive.md`: all pages (existing and new) use an 8px mobile outer gutter; sections, form field groups, and grouped action buttons stack in one column below `sm`; preserve 44x44px touch targets and the existing responsive-table options.

- [ ] **Step 2: Reduce the shared dashboard mobile gutter**

In the non-focus, non-liftings branch of `DashboardLayout.tsx`, change mobile padding from `p-4` to `p-2`, keeping `md:p-8` and the existing bottom padding.

- [ ] **Step 3: Make RSO target content compact and one-column on mobile**

In `targets/rso/page.tsx`, use no additional page-root padding below `sm`; stack page header actions, search/filter, pagination, modal footer, and grouped form controls below `sm`; change inner `grid-cols-2` form groups to `grid-cols-1 sm:grid-cols-2`; make mobile action buttons full-width and at least 44px high. Preserve the contained horizontal-scroll table and larger-screen layout.

- [ ] **Step 4: Run frontend lint and type checking**

Run: `cd frontend && npm run lint && npx tsc --noEmit`
Expected: no lint errors and TypeScript exits successfully.

- [ ] **Step 5: Verify mobile and desktop behavior in the browser**

At 375px and 414px, verify 8px outer gutter, one-column section/form/action layout, 44px touch targets, and no document horizontal overflow. At 768px and 1280px, verify the existing wider layout and table behavior remain intact.

