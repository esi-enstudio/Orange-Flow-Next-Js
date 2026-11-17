# Multi-Tenant (House-Based Isolation)

> Detail spec referenced from [AGENTS.md](../../AGENTS.md). Rules here are binding; they are not optional guidance.

## Multi-Tenant (House-Based Isolation) Architecture

### Principle

This is a **multi-tenant system** where each **House** (Distribution House) acts as a tenant. Every module, model, API, and UI component must enforce **data isolation at the house level**. A user may belong to multiple houses, but can only access data belonging to their assigned houses.

No module should exist without considering house-level data isolation.

---

### Core Tenant Entity

The tenant is the **House** (table: `houses`).

```python
class House(Base):
    __tablename__ = "houses"

    id = Column(Integer, primary_key=True)
    name = Column(String(200), nullable=False)
    code = Column(String(50), unique=True, nullable=False)
    ...
```

Every data-bearing model in the system must reference the house via `house_id`.

---

### User-to-House Association

Users are associated with houses through a **many-to-many** relationship:

```python
user_houses = Table(
    'users_houses',
    Base.metadata,
    Column('user_id', Integer, ForeignKey('users.id', ondelete="CASCADE")),
    Column('house_id', Integer, ForeignKey('houses.id', ondelete="CASCADE"))
)
```

A user can belong to **zero, one, or multiple houses**. Admins bypass house restrictions entirely.

---

### Database Model Rules

#### Rule 1: Every data model must have `house_id`

Every model that stores user-created or business data **must** include a `house_id` foreign key:

```python
class AnyModel(Base):
    __tablename__ = "any_table"

    id = Column(Integer, primary_key=True)
    house_id = Column(Integer, ForeignKey("houses.id"), nullable=False, index=True)
    ...
```

#### Rule 2: Exceptions

Only system-level models (e.g., `users`, `roles`, `permissions`, `activity_logs`) may omit `house_id`. These are shared across all houses.

---

### API-Level House Context

#### X-House-ID Header

All data-accessing API endpoints must accept an `X-House-ID` header to specify the active house context.

Use the `get_house_context` dependency:

```python
from backend.app.routers.deps import get_house_context

@router.get("/api/v1/module")
async def list_items(
    house_context: Optional[int] = Depends(get_house_context),
    current_user: User = Depends(get_current_user),
):
    ...
```

This dependency:
- Reads `X-House-ID` from the request header
- If user is admin: returns the house ID as-is (or `None` to see all)
- If user is non-admin: verifies the user belongs to that house, returns `403` if not
- Returns `None` if no header is provided (meaning no house filter)

#### Admin Bypass

Admin users (`is_admin_user(current_user)`) can access data across all houses. They can either:
- Omit `X-House-ID` to see all houses' data
- Provide a specific `X-House-ID` to see a single house

Non-admin users are restricted to houses they belong to, even if they provide `X-House-ID`.

---

### Backend Query-Level Filtering

Every list/read endpoint **must** filter by the user's accessible houses.

#### Pattern 1 — When user_house_ids are available

```python
user_house_ids = [h.id for h in current_user.houses]
base_query = select(Model).where(Model.house_id.in_(user_house_ids))

if house_context:
    base_query = base_query.where(Model.house_id == house_context)
```

#### Pattern 2 — Using `AccessControl` utility

Use the `AccessControl` utility (`backend/app/utils/access_control.py`) for role-based row-level security:

- **Admin / House Manager** — filter by user's house IDs
- **Supervisor** — filter by subordinates within the same house
- **RSO / BP** — filter only their own records
- **Retailer** — filter by their own retailer code

```python
from backend.app.utils.access_control import AccessControl

access = AccessControl(current_user)
query = access.apply_house_filter(query, Model)
```

---

### Create/Update/Delete Operations

#### New Record Creation

When creating a new record:

```python
new_record = Model(house_id=house_context or current_user.houses[0].id, ...)
```

The `house_id` must be set from the `X-House-ID` header or the user's first house. **Never** allow the client to send `house_id` in the request body (trust the header, not the payload).

#### Update/Delete Verification

Before updating or deleting a record, verify the user has access to its house:

```python
record = await session.get(Model, record_id)
if record.house_id not in user_house_ids:
    raise HTTPException(status_code=403, detail="Access denied")
```

---

### Frontend House Context

#### House Selection

The frontend must provide a house selector (dropdown) for users who belong to multiple houses. The selected house is stored in the `AuthContext` as `selectedHouse`.

```typescript
// from AuthContext
selectedHouse: user?.selected_house_id 
  ? { id: user.selected_house_id } 
  : null,
```

#### API Calls with House Header

Every data-fetching API call must include the `X-House-ID` header when a house is selected:

```typescript
const params: Record<string, string> = {};
if (selectedHouseId) {
  params['X-House-ID'] = String(selectedHouseId);
}
const res = await apiClient.get("module/items", { headers: params });
```

#### Filtering Accessible Houses

Fetch the user's accessible houses on the frontend:

```typescript
// GET /houses/accessible returns only houses the user belongs to
const res = await apiClient.get("houses/accessible");
setHouses(res.data);
```

#### House Visibility — Assigned Houses Only (Hard Rule)

A user must see **exactly the houses assigned to them** in every house selector, filter, dropdown and list — never the full house table because they hold an admin-ish role.

- `GET /api/houses/accessible`, `GET /api/houses` and `GET /api/houses/filter-options` return `current_user.houses` for every role **except the platform super admin**. Tenant roles (`admin`, `manager`, `house manager`) are house-scoped, not platform roles.
- Reference helper: `_sees_all_houses()` in `backend/app/routers/houses.py` (mirrors `deps.get_house_context`).
- `GET /api/auth/me` may attach the full house list only for the super admin, and only when the user has no explicit `users_houses` rows.
- Enforcement is backend-first: hiding options in the UI is not enough. `TENANT_STRICT_HOUSE_ISOLATION=false` is the only opt-in escape hatch, and only for single-company deployments.
- Any new house dropdown/filter must read from these endpoints; never build a separate "all houses" list.
- Regression tests live in `backend/tests/test_tenant_isolation.py`.

#### UI House Selector

Users with multiple houses should see a house switcher in the header/sidebar.

Users with a single house should not see a selector (auto-select their only house).

---

### Permission + Multi-Tenant Interactions

#### Permission Scope

Permissions are **global** (not per-house). If a user has `module.view`, they can view data for **any house they belong to**. The house filter controls which data rows they see, not whether they can access the module.

#### Cross-House Restrictions

A user should never see data from a house they don't belong to, even if they have the right permission. This is enforced at:
1. **Backend query level** — `WHERE house_id IN (user_house_ids)`
2. **Backend house context** — `X-House-ID` validation
3. **Frontend API calls** — `X-House-ID` header sent with requests

---

### Import/Export with Multi-Tenant

#### Import

When importing data (CSV/Excel), the system must:
1. Determine the target house from the `X-House-ID` header (or from a column in the file, e.g., DD Code)
2. Verify the user has access to that house
3. Reject rows that reference houses the user doesn't belong to
4. Skip rows where the house cannot be determined (multi-tenant safety)

```python
# backend/app/services/Automation/employee_excel.py
house = get_house_from_dd_code(dd_code)
if not house:
    skip_row("No house found for DD Code")
    continue
```

#### Export

Export APIs must respect the house filter:
- If `X-House-ID` is set: export only that house's data
- If `X-House-ID` is not set and user is non-admin: export all user's house(s) data
- Admins can export all houses' data

---

### Activity Logs & Multi-Tenant

Activity logs (`activity_logs` table) are **system-wide** (no `house_id`). They are shared across all houses and require `audit.view` permission.

When querying activity logs, the frontend may filter by the selected house context, but the backend does not enforce house-level filtering on audit logs.

---

### Checklist — Multi-Tenant

প্রতিটি নতুন মডিউল/ফিচারের জন্য:

**Database**
- [ ] Model includes `house_id` foreign key (nullable or non-nullable as appropriate)
- [ ] `house_id` is indexed
- [ ] Created_at/updated_at audit fields present

**Backend API**
- [ ] Endpoint accepts `X-House-ID` header via `get_house_context` dependency
- [ ] List/read queries filter by `house_id IN (user_house_ids)`
- [ ] Create operations set `house_id` from header, not request body
- [ ] Update/delete verify user access to the record's house
- [ ] Admin bypass implemented for admin users

**Frontend**
- [ ] API calls include `X-House-ID` header when house is selected
- [ ] House selector provided for multi-house users
- [ ] House selector hidden for single-house users
- [ ] No cross-house data leakage in UI

**Import/Export**
- [ ] Import determines target house from header or file data
- [ ] Import validates user has access to target house
- [ ] Export respects house filter

**Security**
- [ ] Backend enforcement (frontend filtering is NOT enough)
- [ ] `house_id` from request body is never trusted
- [ ] Cross-house access returns 403

---

### Final Note

Multi-tenant house isolation is **not optional**. Every new module must implement house-level data isolation from day one. Retrofitting isolation later is error-prone and insecure. Always think: "Which house does this data belong to?" before writing any model, API, or component.
