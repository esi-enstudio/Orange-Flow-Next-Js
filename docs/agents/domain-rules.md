# Domain Rules

> Detail spec referenced from [AGENTS.md](../../AGENTS.md). Rules here are binding; they are not optional guidance.

## Retailer↔Employee Attribution Rules

### Problem Background

BP assisted retailer codes (e.g., `R344412 "BP Assisted Code - Jasim Uddin Suman"`) carry the **RSO's iTopUp SR number** in their `I_TOP_UP_SR_NUMBER` column. If retailer auto-linking matches `itop_number` first, these codes get wrongly assigned to the RSO, inflating the RSO's activation achievement. (Real incident: RSO 1915270101 showed 173 instead of 52.)

### Mandatory Rules

1. **Assisted-code ownership takes priority** — When linking a retailer to an employee, first match `retailer_code` against `Employee.assisted_retailer_code`. Only fall back to `itop_number` matching when no assisted-code owner exists.

2. **Never auto-assign BP assisted codes to RSO employees** — A retailer whose `retailer_code` equals some employee's `assisted_retailer_code` must be linked to **that employee**, regardless of the `I_TOP_UP_SR_NUMBER` value in the file.

3. **Reference implementation** — `backend/app/services/Automation/retailer_excel.py`:
   ```python
   assisted_map = {f.assisted_retailer_code: f.id for f in emp_rows if f.assisted_retailer_code}
   rso_map = {f.itop_number: f.id for f in emp_rows if f.itop_number}
   linked_emp_id = assisted_map.get(r_code) or rso_map.get(itop_sr_no)
   ```

4. **Startup self-healing** — `backend/app/services/db_service.py` `_migrate_retailer_employee_link()` re-links any retailer whose `employee_id` does not match its assisted-code owner. Keep this idempotent migration registered in `init_db()`.

5. **Resigned/Inactive owner transfers to the successor (Active) RSO** — If an employee's status is not `Active`, their retailers (iTop-linked AND assisted-code-linked) must be reassigned to the **Active successor RSO** that now owns the same `itop_number` (or, for assisted codes of a resigned BP without an iTop successor, the Active employee owning the retailer's `itop_sr_number`). Active owners always win over non-active owners when they share an iTop number or assisted code. Implemented in:
   - `retailer_excel.py` — `active_map`/`active_assisted_map` (active wins the dict) plus the successor redirect for non-active assisted owners.
   - `db_service.py` — the iTop re-link + resigned-owner re-link migration passes.

6. **Sanity check during development/QA** — Run this query to detect mis-assignments after any retailer import or employee update. Rows are allowed **only** when the assisted-code owner is not `Active` and an Active successor RSO owns the retailer's `itop_sr_number` (an intentional takeover):
   ```sql
   SELECT r.retailer_code, r.name, r.employee_id, e.id AS owner_id, e.status AS owner_status, e.employee_type
   FROM retailers r
   JOIN employees e ON e.assisted_retailer_code = r.retailer_code
   WHERE r.employee_id IS DISTINCT FROM e.id
     AND NOT (e.status <> 'Active'
              AND EXISTS (
                SELECT 1 FROM employees a
                WHERE a.status = 'Active' AND a.id <> e.id
                  AND (a.itop_number = e.itop_number OR a.itop_number = r.itop_sr_number)
              ));
   ```
   Expected result: **0 rows**. Any row means attribution is broken and must be fixed before shipping.

---

## Supervisor Team Handoff Rules

### Problem Background

A supervisor owns RSO/BP team members through the `supervisor_rso_assignments` pivot table (model `SupervisorRSOAssignment`, unique on `member_employee_id`; the member column holds both RSO and BP employee ids). `User.parent_id` is kept in sync for backward compatibility. When a supervisor becomes **Resigned/Inactive**, their team must not stay tagged to them — it must move to the new (active successor) supervisor.

### Mandatory Rules

1. **Pivot is the source of truth** — team membership lives in `supervisor_rso_assignments`, not `Employee.supervisor_id` (which does not exist). Always update the pivot and sync `User.parent_id`.

2. **Resigning a supervisor requires team transfer** — In the Employees UI, setting a supervisor to `Resigned`/`Inactive` must first check `GET /api/employees/{emp_id}/team-count`; if > 0, prompt for the new supervisor and call `POST /api/employees/{emp_id}/reassign-team` with `{ new_supervisor_id, status }`. Never silently resign a supervisor who still owns a team.

3. **Successor rules** — The new supervisor must be `Active`, `employee_type = 'supervisor'`, and in the **same house** as the outgoing supervisor. Cross-house transfers are rejected (`422`).

4. **Startup self-healing** — `backend/app/services/db_service.py` `_migrate_supervisor_team_link()` re-points team rows from a non-active supervisor to an Active supervisor in the same house sharing the same `itop_number` or `pool_number`, and syncs `users.parent_id`. It is idempotent and registered in `init_db()`. Keep it registered.

5. **Reference implementation** — `backend/app/routers/employees.py`:
   - `GET /{emp_id}/team-count` — count of pivot rows owned by the employee.
   - `POST /{emp_id}/reassign-team` — moves all pivot rows to the new supervisor, syncs each member's `parent_id`, sets the outgoing supervisor's status, and writes an `reassign_team` activity log.

6. **Sanity check during development/QA** — Run this query to detect a non-active supervisor still owning a team when an active successor exists:
   ```sql
   SELECT a.supervisor_employee_id, s.dms_code, s.status, a.member_employee_id
   FROM supervisor_rso_assignments a
   JOIN employees s ON s.id = a.supervisor_employee_id
   WHERE s.status <> 'Active'
     AND EXISTS (
       SELECT 1 FROM employees a2
       WHERE a2.employee_type = 'supervisor' AND a2.status = 'Active'
         AND a2.house_id = s.house_id AND a2.id <> s.id
         AND ((a2.itop_number IS NOT NULL AND a2.itop_number = s.itop_number)
              OR (a2.pool_number IS NOT NULL AND a2.pool_number = s.pool_number))
     );
   ```
   Expected result: **0 rows**.
