# Permissions (RBAC)

> Detail spec referenced from [AGENTS.md](../../AGENTS.md). Rules here are binding; they are not optional guidance.

## Permission Based Architecture

Every module must follow strict permission-based access control.

No module should exist without permissions.

---

## Permission Naming Convention

Permission naming format:
module.action

Example:

User Module:
user.view
user.create
user.edit
user.delete
user.import
user.export

---

## CRUD Permission Rules

If a module has CRUD operations, create separate permissions:

Create:
module.create

Read/View:
module.view

Update:
module.edit

Delete:
module.delete

---

## Additional Permission Rules

If a module contains extra functionality, create separate permissions.

Examples:

Import:
module.import

Export:
module.export

Approve:
module.approve

Reject:
module.reject

Publish:
module.publish

Any additional feature must have its own permission.

---

## Permission Storage

All module permissions must be registered inside:
backend/config/permissions.json

Example:

```json
{
  "user": [
    "user.view",
    "user.create",
    "user.edit",
    "user.delete",
    "user.import",
    "user.export"
  ]
}
```

Whenever a new module is created:
1. Identify required permissions
2. Add permissions inside permissions.json
3. Use those permissions everywhere

---

## Backend Permission Enforcement

Frontend permission checking is NOT enough.

Every API endpoint must verify permission.

Example:

User creation API:
Required permission:
user.create

User update API:
Required permission:
user.edit

User deletion API:
Required permission:
user.delete

A user must never access an API without proper permission.

---

## Frontend Permission Rules

UI elements must be permission aware.

If user does not have permission:
- Hide button
- Hide menu item
- Block action
- Prevent navigation access

Example:

Create User Button:
Only visible if:
user.create

Delete Button:
Only visible if:
user.delete

---

## Sidebar/Menu Permission Rules

Every sidebar item must have permission dependency.

Example:

Users Menu:
Visible if user has ANY:
user.view
user.create
user.edit
user.delete
user.import
user.export

If user has none of these permissions:
The Users menu must not appear.

---

## Route Protection

All protected pages must verify permissions.

Example:

Route:
/users

Required:
user.view

Without permission:
Return unauthorized response.
