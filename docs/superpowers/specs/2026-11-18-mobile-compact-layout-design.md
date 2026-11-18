# Mobile Compact Layout Design

- **Intent:** Minimize mobile page gutters and put page sections, form fields, and grouped action buttons into one column. Store this as a binding rule for all new and existing pages.
- **Why:** The RSO targets page currently combines generous shell/page padding with multi-column form/action groups on narrow screens.
- **Approach:** Set the shared dashboard shell's mobile gutter to 8px. For `/targets/rso`, remove the duplicate mobile page gutter, stack page/action/pagination/modal controls below `sm`, and keep form grids single-column on mobile. Update the responsive guide so this pattern is mandatory across all routes.
- **Alternatives considered:** A global CSS rule forcing every flex/grid/button into a column could break tables, inline control groups, and specialized widgets; rejected. Refactoring all 108 routes at once is possible but would require a separate page-by-page migration and validation; this change stores the global standard and implements it in the shared shell and requested page.
- **Constraints / non-goals:** Preserve 44x44px touch targets and existing responsive table strategies (including contained horizontal scrolling). Do not alter backend behavior, tablet/desktop layouts, or unrelated routes in this task.
