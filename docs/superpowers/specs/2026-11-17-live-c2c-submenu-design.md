# Live C2C Submenu Design

## Intent

Add a blank, permission-protected Live C2C page reachable under Reports, with bilingual navigation and page text. This reserves the route without implementing report data or behavior.

## Approaches

- **Add a Reports child page (chosen):** use `/reports/live-c2c`, the existing `reports` module and `reports.view` / `itopup.view` permissions, and register it as a grantable Reports leaf. This follows the current navigation and access patterns.
- **Create a new module/API:** unnecessary for a blank page and would expand permissions, plan wiring, and backend scope.

## Design

- Add a `Live C2C` child under Reports in `navItems`.
- Add matching English and Bengali translation keys.
- Create `/reports/live-c2c` with the translated page title and standard Page Guide, with no report controls or data fetching.
- Show and gate page access with the existing `reports.view` or `itopup.view` permission; register the route in the Reports module's leaf catalog and map its API ownership to the existing iTopUp endpoint.
- No backend endpoint, new permission, or report functionality is included.

## Verification

Run frontend lint and TypeScript checks, and the plan-module parity test. Check the route and navigation in English and Bengali at mobile and desktop widths.
