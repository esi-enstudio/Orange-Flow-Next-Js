# RSO Target Date and Filter Design

- **Intent:** Make the RSO target table date consistently display as `DD MMM YYYY` and replace its inline filter controls with the project's right-side filter drawer.
- **Why:** The current date display depends on browser locale, and filters are applied immediately from an inline section instead of staged application.
- **Approach:** Render ISO target dates with the existing YMD formatter in English (`DD MMM YYYY`). Move the existing House, Market Type, and Target Month filters into a responsive right drawer; edits remain draft until Apply, and closing/backdrop discards the draft.
- **Alternatives considered:** A date-range filter would change the current monthly-target semantics and needs a new backend range contract; keeping inline/immediate filters conflicts with the project filter standard. Retain the current exact month API filter in the drawer.
- **Constraints / non-goals:** No backend/API changes, no change to monthly filtering semantics, no new filter criteria, and no unrelated table or navigation redesign.
