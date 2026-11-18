# Setup Wizard Route Import Design

- **Intent:** Let initial setup register DMS routes before importing retailers, so retailer route codes can resolve to the route master.
- **Flow:** Keep the existing wizard order and insert an optional Routes upload step after Employees and before Retailers.
- **Implementation:** Add route-import state/UI and a setup endpoint that reuses the existing DMS route-list importer and its house/RSO matching rules; preserve the wizard's streaming progress and skip behavior. Record the mutation in the routes activity log. Add English and Bengali copy and focused regression coverage.
- **Approaches:** A wizard route-upload step completes the requested workflow; a link to the authenticated Routes page would not upload in the wizard and does not meet the request. Proceed with the upload step.
- **Constraints / non-goals:** Do not change unrelated setup/auth behavior, route semantics, or existing data. The importer may only run after house and employee data are available.
