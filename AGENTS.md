# AGENTS.md

# Project Development Rules & AI Agent Instructions

## Project Overview

This project is a professional Management System for a Banglalink Distribution House.

Technology Stack:

- Frontend: Next.js (App Router)
- UI: Shadcn UI + Tailwind CSS
- Backend: Python FastAPI
- Database: PostgreSQL
- Authentication: Role & Permission Based Access Control

The AI Agent must strictly follow all rules mentioned below for every task, module, component, API, database model, form, and UI implementation.

---

# Table of Contents

1. Mandatory Skills Usage
2. Core Development Principles
3. Module Development Rules
4. Permission Based Architecture
5. Permission Naming Convention
6. CRUD Permission Rules
7. Additional Permission Rules
8. Permission Storage
9. Backend Permission Enforcement
10. Frontend Permission Rules
11. Sidebar/Menu Permission Rules
12. Route Protection
13. API Versioning Convention
14. Pagination API Contract
15. Error Response Standards
16. Form Development Rules
17. Input Field Type Rules
18. Frontend Validation
19. Backend Validation
20. Error Handling
21. Database Rules
22. Soft Delete Convention
23. Activity Log / Audit Trail
24. API Development Rules
25. UI/UX Rules
26. Loading / Skeleton Guidelines
27. Table/List Module Rules
28. Import/Export Rules
29. Security Rules
30. Code Quality Rules
31. New Feature Checklist
32. Final Rule
33. Responsive / Mobile-Friendly Requirement
34. Internationalization (i18n) — Bilingual (বাংলা/English) Support

---

# Mandatory Skills Usage

Always use these skills for this project:

- nextjs-app-router-patterns
- frontend-design
- shadcn
- shadcn-ui
- tailwind-4-docs
- tailwind-css-patterns
- web-design-guidelines

These skills must be considered before creating or modifying:
- Pages
- Layouts
- Components
- Forms
- Tables
- Dashboards
- Navigation
- UI Elements
- Responsive Designs

---

# Core Development Principles

Every implementation must be:

- Secure
- Scalable
- Maintainable
- Production-ready
- Modular
- Permission controlled
- Fully validated
- Type-safe
- User friendly

Never create quick temporary solutions.

Always follow proper software engineering practices.

---

# Module Development Rules

Whenever creating a new module:

The module must be developed as a complete feature.

A module includes:

- Database Model
- Backend API
- Validation Schema
- Frontend Pages
- Components
- Forms
- Tables
- Permissions
- Navigation
- Security Rules

---

# Permission Based Architecture

Every module must follow strict permission-based access control.

No module should exist without permissions.

---

# Permission Naming Convention

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

# CRUD Permission Rules

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

# Additional Permission Rules

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

# Permission Storage

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

# Backend Permission Enforcement

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

# Frontend Permission Rules

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

# Sidebar/Menu Permission Rules

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

# Route Protection

All protected pages must verify permissions.

Example:

Route:
/users

Required:
user.view

Without permission:
Return unauthorized response.

---

# API Versioning Convention

All API endpoints must be prefixed with a version.

Format:

```
/api/v1/{module}/{action}
```

Examples:

```
/api/v1/users
/api/v1/users/{id}
/api/v1/roles
/api/v1/permissions
```

When breaking changes are introduced, increment the version number (v1 -> v2).

Do not remove old API versions until all clients have migrated.

---

# Pagination API Contract

All list/list-all APIs must return a standardized paginated response.

Request parameters:

| Parameter  | Type   | Default | Description                  |
|------------|--------|---------|------------------------------|
| page       | int    | 1       | Current page number          |
| per_page   | int    | 20      | Items per page (max 100)     |
| search     | string | null    | Search keyword               |
| sort_by    | string | id      | Field to sort by             |
| sort_order | string | desc    | asc or desc                  |
| filters    | object | {}      | Key-value filter pairs       |

Response format:

```json
{
  "success": true,
  "data": [
    { "id": 1, "name": "..." }
  ],
  "pagination": {
    "page": 1,
    "per_page": 20,
    "total": 150,
    "total_pages": 8,
    "has_next": true,
    "has_prev": false
  }
}
```

All table/list modules must follow this contract consistently.

---

# Error Response Standards

All API error responses must follow standard HTTP status codes with structured JSON bodies.

Status code usage:

| Status Code | When to Use                                          |
|-------------|------------------------------------------------------|
| 200         | Successful GET, PUT, PATCH requests                  |
| 201         | Successful POST (resource created)                   |
| 204         | Successful DELETE (no content)                       |
| 400         | Validation error / Bad request (client mistake)      |
| 401         | Unauthenticated (missing/invalid token)              |
| 403         | Authenticated but missing required permission        |
| 404         | Resource not found                                   |
| 409         | Conflict (e.g., duplicate entry)                     |
| 422         | Unprocessable entity (schema validation failure)     |
| 429         | Rate limit exceeded                                  |
| 500         | Internal server error (unhandled exception)          |

Validation error response (400):

```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "One or more fields are invalid",
    "fields": {
      "email": "Email already exists",
      "phone": "Invalid phone number format"
    }
  }
}
```

Permission error response (403):

```json
{
  "success": false,
  "error": {
    "code": "FORBIDDEN",
    "message": "You do not have permission to perform this action",
    "required_permission": "user.create"
  }
}
```

Authentication error response (401):

```json
{
  "success": false,
  "error": {
    "code": "UNAUTHORIZED",
    "message": "Invalid or expired token"
  }
}
```

Frontend must display field-level errors (`fields` object) directly under the related input.

---

# Form Development Rules

Whenever creating any form:

The form must have:
- Frontend validation
- Backend validation
- Proper error handling
- Field type accuracy
- Security validation

---

# Input Field Type Rules

Always use the correct HTML/UI input type.

Examples:

Name:
text

Email:
email

Phone:
tel

Number:
number

Date:
date

Password:
password

Do not use generic text input for everything.

---

# Frontend Validation

Every form must validate before submission.

Validation must include:
- Required fields
- Correct format
- Minimum length
- Maximum length
- Data type
- Business rules

Validation errors must appear directly below the related field.

Example:

Email Field:
Email is required
Invalid email format

---

# Backend Validation

Frontend validation is not trusted.

FastAPI backend must validate every request.

Backend validation must include:
- Data type checking
- Required fields
- Database constraints
- Business logic validation
- Security checks

---

# Error Handling

Validation errors must return structured responses (see Error Response Standards section).

Frontend must display these messages under the correct fields.

---

# Database Rules

Whenever creating a new model:

Must consider:
- Proper relationships
- Indexing
- Constraints
- Unique fields
- Nullable fields
- Audit fields

Use created_at, updated_at, created_by, updated_by where applicable.

---

# Soft Delete Convention

All data-modifying models must implement soft delete.

Every table must include:

```python
is_deleted = Column(Boolean, default=False, index=True)
deleted_at = Column(DateTime, nullable=True)
deleted_by = Column(Integer, ForeignKey("users.id"), nullable=True)
```

Rules:
- All list queries must filter `is_deleted = False` by default
- DELETE API should perform soft delete (set `is_deleted = True`, `deleted_at = now`, `deleted_by = current_user`)
- Hard delete is only allowed via an admin-only API with separate permission (`module.delete.permanent`)
- Soft-deleted records may be restored via a dedicated API (`module.restore`)

---

# Activity Log / Audit Trail

## Objective

প্রতিটি ইউজার কখন, কোন কাজ, কোন মডিউলে, কার IP থেকে, এবং কি পরিবর্তন করেছে — তার সম্পূর্ণ এবং অপরিবর্তনীয় রেকর্ড রাখা।

## Database Table Structure

Create an `activity_logs` table:

| Column        | Type      | Description                                         |
|---------------|-----------|-----------------------------------------------------|
| id            | int       | Primary key (auto-increment)                        |
| user_id       | int       | Foreign key to users (who performed the action)     |
| user_name     | string    | Denormalized user name (useful for fast queries)    |
| module        | string    | Affected module name (e.g., user, role, product)    |
| action        | string    | Action performed (see action types below)           |
| record_id     | int       | ID of affected record (nullable for non-record actions like login/logout) |
| record_identifier | string | Human-readable identifier (e.g., username, order number) for quick identification |
| old_values    | jsonb     | Previous values (for edit/delete) — null if not applicable |
| new_values    | jsonb     | New values (for create/edit) — null if not applicable |
| endpoint      | string    | API endpoint called (e.g., /api/v1/users/10)        |
| method        | string    | HTTP method (GET/POST/PUT/PATCH/DELETE)             |
| status_code   | int       | HTTP response status code                           |
| ip_address    | string    | Request IP address (IPv4 or IPv6)                   |
| user_agent    | string    | Browser/Client user-agent string                    |
| duration_ms   | int       | Request processing time in milliseconds             |
| created_at    | datetime  | Timestamp of when the action occurred (indexed)     |

### Indexing Strategy

```sql
CREATE INDEX idx_activity_logs_user_id ON activity_logs(user_id);
CREATE INDEX idx_activity_logs_module ON activity_logs(module);
CREATE INDEX idx_activity_logs_action ON activity_logs(action);
CREATE INDEX idx_activity_logs_created_at ON activity_logs(created_at);
CREATE INDEX idx_activity_logs_user_date ON activity_logs(user_id, created_at DESC);
```

## Standard Action Types

| Action   | When to Use                                    |
|----------|------------------------------------------------|
| login    | User successfully logged in                    |
| logout   | User logged out                                |
| failed_login | Failed login attempt                     |
| create   | New record created                             |
| edit     | Existing record updated                        |
| delete   | Record soft-deleted                            |
| restore  | Soft-deleted record restored                   |
| permanent_delete | Record hard-deleted (admin only)        |
| approve  | Record approved                                |
| reject   | Record rejected                                |
| publish  | Record published                               |
| unpublish| Record unpublished                             |
| import   | Bulk data import                               |
| export   | Data export                                    |
| view     | Sensitive record viewed (e.g., financial data) |

## Implementation Mechanism

### Backend — Middleware/Decorator Approach

Use a FastAPI dependency or decorator to auto-log:

```python
# Example decorator signature
def log_activity(
    module: str,
    action: str,
    record_id: int = None,
    record_identifier: str = None,
    old_values: dict = None,
    new_values: dict = None,
):
    ...
```

The decorator/dependency must automatically capture:
- `user_id` — from authenticated request
- `user_name` — from current user context
- `ip_address` — from `request.client.host`
- `user_agent` — from `request.headers.get("user-agent")`
- `endpoint` — from `request.url.path`
- `method` — from `request.method`
- `created_at` — current UTC timestamp

### Auto-Log Rules

1. **Login/Logout** — Logged at the authentication API level (no decorator needed)
2. **Create** — Log after successful insert; `new_values` = created data, `old_values` = null
3. **Edit** — Log after successful update; `old_values` = previous state, `new_values` = updated fields
4. **Delete** — Log before soft delete; `old_values` = deleted record, `new_values` = null
5. **All sensitive mutations** (create, edit, delete, approve, reject, publish, restore) — Must log before returning the response
6. **Sensitive View** — Log when accessing confidential data (e.g., viewing user salary, financial reports)

## Browsing / Querying Audit Logs

Audit logs are **read-only** via API and require a separate permission: `audit.view`.

### Allowed Filters (via API)

| Filter        | Type   | Description                               |
|---------------|--------|-------------------------------------------|
| user_id       | int    | Filter by specific user                   |
| module        | string | Filter by module name                     |
| action        | string | Filter by action type                     |
| record_id     | int    | Filter by affected record ID              |
| from_date     | date   | Start date (inclusive)                    |
| to_date       | date   | End date (inclusive)                      |
| search        | string | Search in record_identifier or user_name  |

### Response Format

```json
{
  "success": true,
  "data": [
    {
      "id": 1,
      "user_id": 5,
      "user_name": "John Doe",
      "module": "user",
      "action": "edit",
      "record_id": 10,
      "record_identifier": "johndoe@email.com",
      "old_values": { "status": "inactive" },
      "new_values": { "status": "active" },
      "endpoint": "/api/v1/users/10",
      "method": "PATCH",
      "status_code": 200,
      "ip_address": "192.168.1.100",
      "user_agent": "Mozilla/5.0 ...",
      "duration_ms": 45,
      "created_at": "2026-06-16T10:30:00Z"
    }
  ],
  "pagination": {
    "page": 1,
    "per_page": 20,
    "total": 150,
    "total_pages": 8,
    "has_next": true,
    "has_prev": false
  }
}
```

## Data Retention Policy

- Activity logs older than **1 year** should be archived to a separate archive table or cold storage
- Archived logs must remain queryable via a separate API endpoint with `audit.view.archive` permission
- Implement a scheduled task (e.g., cron / Celery beat) that runs daily to move expired logs

## Security Rules

- Audit logs are **append-only**. No UPDATE or DELETE API exists for log entries
- Hard-deleting logs requires direct database access and must be logged separately
- User IP addresses and user-agent data are sensitive — mask them in non-admin API responses
- Only users with `audit.view` permission can access audit logs
- Only users with `audit.view.sensitive` permission can see IP addresses and user-agent values

---

# API Development Rules

Every API must have:
- Authentication check
- Permission check
- Validation
- Proper HTTP status code (see Error Response Standards)
- Error handling

---

# UI/UX Rules

All UI must follow:
- Modern dashboard style
- Responsive design
- Accessibility
- Consistent spacing
- Professional appearance

Use:
- Shadcn UI components
- Tailwind CSS patterns

Avoid:
- Random custom UI
- Inconsistent styles
- Duplicate components

---

# Loading / Skeleton Guidelines

## Principle

ডেটা লোড হওয়ার সময় ব্যবহারকারীকে **অপেক্ষার অনুভূতি না দিয়ে** বোঝাতে হবে যে কাজ হচ্ছে। শুধু spinner দেখানো যথেষ্ট নয় — বাস্তব UI-এর মতো skeleton দেখানো user experience-এর জন্য অনেক ভালো।

## Rules

1. **Skeleton, Not Spinner** — শুধু একটি `Loader2` spinner না রেখে **content-aware skeleton** ব্যবহার করতে হবে। টেবিলের জন্য skeleton row, কার্ডের জন্য skeleton card, ফর্মের জন্য skeleton field
2. **animate-pulse** — Tailwind-এর `animate-pulse` ব্যবহার করে shimmer effect তৈরি করুন। আলাদা CSS কীফ্রেম না লিখে
3. **Match Layout** — skeleton-এর আকৃতি ও কলাম সংখ্যা আসল content-এর মতো হতে হবে। টেবিলে যত কলাম, skeleton-এও তত কলাম
4. **Responsive Skeleton** — মোবাইলের জন্য skeleton-এ কম কলাম দেখাতে হবে, বড় স্ক্রিনে বেশি (যেমন `hidden sm:block`, `hidden md:block`)
5. **Per-Item Skeleton** — list/table-এ প্রতি পৃষ্ঠায় যত আইটেম দেখানো হয়, skeleton-এও ততটি আইটেম দেখান (যেমন per_page = 5 হলে ৫টি skeleton row)
6. **Card Skeleton** — grid layout-এর ক্ষেত্রে (যেমন dashboard cards), প্রতিটি কার্ডের জন্য separate skeleton কার্ড দেখান
7. **Form Skeleton** — ফর্ম লোড হতে সময় নিলে (যেমন edit page), প্রতিটি input field-এর জায়গায় skeleton দেখান
8. **Avoid Layout Shift** — skeleton-এর মাত্রা (height/width) আসল content-এর কাছাকাছি রাখুন, যাতে লোড হওয়ার পর হঠাৎ লেআউট না নড়ে

## Implementation Pattern

```tsx
{loading ? (
  <div className="divide-y divide-gray-50 dark:divide-slate-800">
    {Array.from({ length: 5 }).map((_, i) => (
      <div key={i} className="flex items-center gap-4 px-6 py-5 animate-pulse">
        <div className="w-10 h-10 rounded-xl bg-gray-200 dark:bg-slate-700 shrink-0" />
        <div className="space-y-2 flex-1">
          <div className="h-3 w-32 bg-gray-200 dark:bg-slate-700 rounded-md" />
          <div className="h-2.5 w-24 bg-gray-100 dark:bg-slate-800 rounded-md" />
        </div>
        <div className="hidden sm:block flex-1 space-y-2">
          <div className="h-3 w-20 bg-gray-200 dark:bg-slate-700 rounded-md" />
          <div className="h-2.5 w-16 bg-gray-100 dark:bg-slate-800 rounded-md" />
        </div>
      </div>
    ))}
  </div>
) : (
  <RealContent />
)}
```

## When NOT to Use Skeleton

- API call ২০০ms-এর কম সময় নিলে skeleton দেখানোর দরকার নেই — সরাসরি content দেখান
- Error state-এ skeleton নয়, error message দেখান
- Empty state-এ skeleton নয়, "No data" message দেখান

---

# Table/List Module Rules

Every data table should support when required:
- Search
- Filtering
- Sorting
- Pagination (see Pagination API Contract)
- Export
- Import
- Action buttons

Action buttons must be permission controlled.

Example:

Edit button:
Requires:
module.edit

Delete button:
Requires:
module.delete

## Table Cell Styling Rules

1. **`<td>` class** — All `<td>` elements must have `class="px-2 py-1"`. This applies to every table cell across the entire application.

2. **Subtitle Font Size** — If a `<td>` contains a subtitle (secondary text below the main value), the subtitle must use `font-size: 11px` (via Tailwind class `text-[11px]` or inline style). The subtitle should also use a muted text color (`text-gray-500 dark:text-gray-400`).

```tsx
// Example: <td> with main value and subtitle
<td className="px-2 py-1">
  <p className="font-medium">Main Value</p>
    <p className="text-[11px] text-gray-500 dark:text-gray-400">Subtitle text</p>
</td>
```

3. **Responsive — Collapsible Rows** — Small screen-এ (`lg` breakpoint-এর নিচে) টেবিলের row গুলো **collapsible/expandable accordion**-এ convert হবে। Desktop টেবিল (`hidden lg:table`) লুকিয়ে mobile-friendly accordion list (`lg:hidden`) দেখাতে হবে। প্রতিটি accordion-এ শুধু মূল তথ্য (name, identifier) visible থাকবে, остальные details click-এ expand হবে। একসাথে শুধু একটি row expand রাখতে হবে। বিস্তারিত জন্য নিচের **Responsive Table — Accordion Behavior** সেকশন দেখুন।

---

# Import/Export Rules

If import/export exists:
Create permissions:
module.import
module.export

Only authorized users can access these features.

---

# Retailer↔Employee Attribution Rules

## Problem Background

BP/CC assisted retailer codes (e.g., `R344412 "BP Assisted Code - Jasim Uddin Suman"`) carry the **RSO's iTopUp SR number** in their `I_TOP_UP_SR_NUMBER` column. If retailer auto-linking matches `itop_number` first, these codes get wrongly assigned to the RSO, inflating the RSO's activation achievement. (Real incident: RSO 1915270101 showed 173 instead of 52.)

## Mandatory Rules

1. **Assisted-code ownership takes priority** — When linking a retailer to an employee, first match `retailer_code` against `Employee.assisted_retailer_code`. Only fall back to `itop_number` matching when no assisted-code owner exists.

2. **Never auto-assign BP/CC assisted codes to RSO employees** — A retailer whose `retailer_code` equals some employee's `assisted_retailer_code` must be linked to **that employee**, regardless of the `I_TOP_UP_SR_NUMBER` value in the file.

3. **Reference implementation** — `backend/app/services/Automation/retailer_excel.py`:
   ```python
   assisted_map = {f.assisted_retailer_code: f.id for f in emp_rows if f.assisted_retailer_code}
   rso_map = {f.itop_number: f.id for f in emp_rows if f.itop_number}
   linked_emp_id = assisted_map.get(r_code) or rso_map.get(itop_sr_no)
   ```

4. **Startup self-healing** — `backend/app/services/db_service.py` `_migrate_retailer_employee_link()` re-links any retailer whose `employee_id` does not match its assisted-code owner. Keep this idempotent migration registered in `init_db()`.

5. **Sanity check during development/QA** — Run this query to detect mis-assignments after any retailer import or employee update:
   ```sql
   SELECT r.retailer_code, r.name, r.employee_id, e.id AS owner_id, e.employee_type
   FROM retailers r
   JOIN employees e ON e.assisted_retailer_code = r.retailer_code
   WHERE r.employee_id IS DISTINCT FROM e.id;
   ```
   Expected result: **0 rows**. Any row means attribution is broken and must be fixed before shipping.

---

# Security Rules

Always protect against:
- Unauthorized access
- SQL injection
- XSS
- CSRF
- Data leakage
- Invalid input
- Privilege escalation

Never trust frontend data.

---

# Code Quality Rules

Before completing any task:
Check:
- Naming conventions
- Folder structure
- Reusable components
- Duplicate code
- Type safety
- Error handling

---

# New Feature Checklist

Before marking any feature complete:

**Backend**
- [ ] Database model created
- [ ] API created
- [ ] Validation added
- [ ] Authentication checked
- [ ] Permission checked

**Frontend**
- [ ] Page created
- [ ] Components created
- [ ] Form validation added
- [ ] Error messages shown
- [ ] Permission based UI implemented

**Security**
- [ ] Unauthorized users blocked
- [ ] API protected
- [ ] Sensitive actions restricted

**Permission**
- [ ] permissions.json updated
- [ ] Sidebar permission added
- [ ] Buttons permission controlled

**Audit**
- [ ] Activity log entry created for mutations

**UX**
- [ ] Content-aware skeleton added for loading states

**Responsive**
- [ ] Mobile (375px) টেস্ট করা হয়েছে
- [ ] Tablet (768px) টেস্ট করা হয়েছে
- [ ] Desktop (1280px+) টেস্ট করা হয়েছে
- [ ] Horizontal scroll নেই
- [ ] Touch target size (44x44px) maintain করা হয়েছে

---

# Final Rule

Never create any module, page, API, button, action, or form without considering:
1. Permission
2. Security
3. Validation
4. User Experience
5. Scalability

Every implementation must be production-ready.

---

# Responsive / Mobile-Friendly Requirement

## Principle

প্রতিটি মডিউল, পেজ, কম্পোনেন্ট, ফর্ম, টেবিল, এবং ড্যাশবোর্ড **ডেস্কটপ ও মোবাইল — উভয় ডিভাইসেই** সঠিকভাবে কাজ করতে হবে।

## Rules

1. **Mobile-First Approach** — প্রথমে মোবাইল স্ক্রিনের জন্য ডিজাইন করুন, তারপর বড় স্ক্রিনের জন্য expand করুন
2. **Breakpoints** — Tailwind CSS breakpoints ব্যবহার করুন (sm, md, lg, xl, 2xl)
3. **No Horizontal Scroll** — মোবাইল ডিভাইসে কোনো পেজে horizontal scrollbar আসা যাবে না
4. **Responsive Tables** — ডেটা টেবিল মোবাইলে responsive হতে হবে (card view, horizontal scroll, বা collapsible row)
5. **Touch-Friendly** — বাটন, লিংক, ফর্ম ফিল্ড — সবকিছু至少要 44x44px touch target size maintain করতে হবে
6. **Forms** — মোবাইলে ফর্ম ফিল্ড full-width হবে, labels properly aligned থাকবে
7. **Sidebar/Navigation** — মোবাইলে sidebar auto-collapse হবে (hamburger menu)
8. **Modals & Drawers** — মোবাইলে modal full-screen বা bottom sheet আকারে দেখাতে হবে
9. **Font & Spacing** — ছোট স্ক্রিনে font-size ও spacing কমাতে হবে, কিন্তু readability বজায় রাখতে হবে

## Testing

প্রতিটি মডিউল ডেলিভারির আগে নিম্নলিখিত ব্রেকপয়েন্টে টেস্ট করতে হবে:

- **Mobile:** 375px (iPhone SE) — সবচেয়ে ছোট স্ক্রিন
- **Mobile:** 414px (iPhone Plus/Pro Max)
- **Tablet:** 768px (iPad)
- **Desktop:** 1280px+
- **Large Screen:** 1536px+

## Checklist

প্রতিটি নতুন মডিউলের জন্য:
- [ ] Mobile (375px) এ সব কনটেন্ট visible এবং readable
- [ ] Tablet (768px) এ লেআউট ঠিক আছে
- [ ] Desktop (1280px+) এ পূর্ণ লেআউট কাজ করছে
- [ ] Horizontal scroll নেই
- [ ] Touch target size (44x44px) maintain করা হয়েছে
- [ ] Navigation / sidebar মোবাইলে ঠিকমতো কাজ করছে

---

# Multi-Tenant (House-Based Isolation) Architecture

## Principle

This is a **multi-tenant system** where each **House** (Distribution House) acts as a tenant. Every module, model, API, and UI component must enforce **data isolation at the house level**. A user may belong to multiple houses, but can only access data belonging to their assigned houses.

No module should exist without considering house-level data isolation.

---

## Core Tenant Entity

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

## User-to-House Association

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

## Database Model Rules

### Rule 1: Every data model must have `house_id`

Every model that stores user-created or business data **must** include a `house_id` foreign key:

```python
class AnyModel(Base):
    __tablename__ = "any_table"

    id = Column(Integer, primary_key=True)
    house_id = Column(Integer, ForeignKey("houses.id"), nullable=False, index=True)
    ...
```

### Rule 2: Exceptions

Only system-level models (e.g., `users`, `roles`, `permissions`, `activity_logs`) may omit `house_id`. These are shared across all houses.

---

## API-Level House Context

### X-House-ID Header

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

### Admin Bypass

Admin users (`is_admin_user(current_user)`) can access data across all houses. They can either:
- Omit `X-House-ID` to see all houses' data
- Provide a specific `X-House-ID` to see a single house

Non-admin users are restricted to houses they belong to, even if they provide `X-House-ID`.

---

## Backend Query-Level Filtering

Every list/read endpoint **must** filter by the user's accessible houses.

### Pattern 1 — When user_house_ids are available

```python
user_house_ids = [h.id for h in current_user.houses]
base_query = select(Model).where(Model.house_id.in_(user_house_ids))

if house_context:
    base_query = base_query.where(Model.house_id == house_context)
```

### Pattern 2 — Using `AccessControl` utility

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

## Create/Update/Delete Operations

### New Record Creation

When creating a new record:

```python
new_record = Model(house_id=house_context or current_user.houses[0].id, ...)
```

The `house_id` must be set from the `X-House-ID` header or the user's first house. **Never** allow the client to send `house_id` in the request body (trust the header, not the payload).

### Update/Delete Verification

Before updating or deleting a record, verify the user has access to its house:

```python
record = await session.get(Model, record_id)
if record.house_id not in user_house_ids:
    raise HTTPException(status_code=403, detail="Access denied")
```

---

## Frontend House Context

### House Selection

The frontend must provide a house selector (dropdown) for users who belong to multiple houses. The selected house is stored in the `AuthContext` as `selectedHouse`.

```typescript
// from AuthContext
selectedHouse: user?.selected_house_id 
  ? { id: user.selected_house_id } 
  : null,
```

### API Calls with House Header

Every data-fetching API call must include the `X-House-ID` header when a house is selected:

```typescript
const params: Record<string, string> = {};
if (selectedHouseId) {
  params['X-House-ID'] = String(selectedHouseId);
}
const res = await apiClient.get("module/items", { headers: params });
```

### Filtering Accessible Houses

Fetch the user's accessible houses on the frontend:

```typescript
// GET /houses/accessible returns only houses the user belongs to
const res = await apiClient.get("houses/accessible");
setHouses(res.data);
```

### UI House Selector

Users with multiple houses should see a house switcher in the header/sidebar.

Users with a single house should not see a selector (auto-select their only house).

---

## Permission + Multi-Tenant Interactions

### Permission Scope

Permissions are **global** (not per-house). If a user has `module.view`, they can view data for **any house they belong to**. The house filter controls which data rows they see, not whether they can access the module.

### Cross-House Restrictions

A user should never see data from a house they don't belong to, even if they have the right permission. This is enforced at:
1. **Backend query level** — `WHERE house_id IN (user_house_ids)`
2. **Backend house context** — `X-House-ID` validation
3. **Frontend API calls** — `X-House-ID` header sent with requests

---

## Import/Export with Multi-Tenant

### Import

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

### Export

Export APIs must respect the house filter:
- If `X-House-ID` is set: export only that house's data
- If `X-House-ID` is not set and user is non-admin: export all user's house(s) data
- Admins can export all houses' data

---

## Activity Logs & Multi-Tenant

Activity logs (`activity_logs` table) are **system-wide** (no `house_id`). They are shared across all houses and require `audit.view` permission.

When querying activity logs, the frontend may filter by the selected house context, but the backend does not enforce house-level filtering on audit logs.

---

## Checklist — Multi-Tenant

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

## Final Note

Multi-tenant house isolation is **not optional**. Every new module must implement house-level data isolation from day one. Retrofitting isolation later is error-prone and insecure. Always think: "Which house does this data belong to?" before writing any model, API, or component.

---

# Internationalization (i18n) — Bilingual (বাংলা/English) Support

## Objective

প্রতিটি নতুন ফিচার, মডিউল, পেজ, কম্পোনেন্ট, ফর্ম, টেবিল, এবং API — **বাংলা ও ইংরেজি — উভয় ভাষায়** ব্যবহারকারীর কাছে উপস্থাপন করতে হবে। কোনো মডিউল শুধুমাত্র ইংরেজিতে তৈরি করে later localization-এর জন্য রেখে দেওয়া যাবে না। প্রতিটি ফিচার ডেলিভারির সময়ই সম্পূর্ণ bilingual হতে হবে।

## Technology Choice

- **Frontend i18n Library:** `next-intl` — Next.js App Router-এর জন্য official recommended library
- **Translation File Format:** JSON (namespaced by module/page)
- **Storage Location:** `messages/{locale}/{namespace}.json`

## Directory Structure

```
messages/
├── en/
│   ├── common.json          # Shared/global translations (buttons, labels, errors)
│   ├── auth.json            # Login, register, forgot password
│   ├── user.json            # User module
│   ├── role.json            # Role module
│   ├── dashboard.json       # Dashboard widgets
│   └── ...
└── bn/
    ├── common.json
    ├── auth.json
    ├── user.json
    ├── role.json
    ├── dashboard.json
    └── ...
```

## Translation Key Naming Convention

Keys must follow a consistent hierarchical naming pattern:

```json
{
  "module": {
    "section": {
      "action": "Translated text"
    }
  }
}
```

Examples:

```json
// messages/en/user.json
{
  "user": {
    "list": {
      "title": "User List",
      "create": "Create User"
    },
    "fields": {
      "name": "Name",
      "email": "Email",
      "phone": "Phone",
      "role": "Role"
    },
    "validation": {
      "name_required": "Name is required",
      "email_invalid": "Invalid email format"
    },
    "messages": {
      "create_success": "User created successfully",
      "delete_confirm": "Are you sure you want to delete this user?"
    }
  }
}
```

```json
// messages/bn/user.json
{
  "user": {
    "list": {
      "title": "ব্যবহারকারী তালিকা",
      "create": "নতুন ব্যবহারকারী"
    },
    "fields": {
      "name": "নাম",
      "email": "ইমেইল",
      "phone": "ফোন",
      "role": "ভূমিকা"
    },
    "validation": {
      "name_required": "নাম আবশ্যক",
      "email_invalid": "ভুল ইমেইল ফরম্যাট"
    },
    "messages": {
      "create_success": "ব্যবহারকারী সফলভাবে তৈরি হয়েছে",
      "delete_confirm": "আপনি কি এই ব্যবহারকারী মুছে ফেলতে চান?"
    }
  }
}
```

## Locale Detection & Routing

1. **Path-based localization** — URL prefix-এর মাধ্যমে locale নির্ধারণ:
   - `/en/users` — ইংরেজি
   - `/bn/users` — বাংলা

2. **Next.js Middleware** — স্বয়ংক্রিয় locale detection:
   - `accept-language` header চেক করা
   - LocalStorage/Cookie-তে সংরক্ষিত preference ব্যবহার করা
   - ডিফল্ট locale: `bn` (প্রাথমিকভাবে বাংলাদেশী users-এর জন্য)

3. **Locale Switching** — ব্যবহারকারী যেকোনো সময় navbar/header থেকে locale পরিবর্তন করতে পারবে, এবং তা cookie-তে সংরক্ষিত থাকবে

## Backend — Multilingual Data Storage

### Static/Configuration Data

Translations for static data (module names, permission labels, dropdown options etc.) should be stored in JSON translation files on the frontend only.

### Dynamic/User-Generated Data

If a module has fields that need to store content **in multiple languages** (e.g., product name in both languages, category description), follow this pattern:

```python
# Database model with multilingual support
class Product(Base):
    __tablename__ = "products"

    id = Column(Integer, primary_key=True)
    name_en = Column(String(200), nullable=False)   # English name
    name_bn = Column(String(200), nullable=False)   # Bengali name
    description_en = Column(Text, nullable=True)
    description_bn = Column(Text, nullable=True)
    ...
```

**Rules:**
- `name_en` এবং `name_bn` — উভয়ই required (যদি না business logic নির্দিষ্ট ভাষার জন্য optional করে)
- `description_en` / `description_bn` — nullable হতে পারে
- API response-এ `Accept-Language` header অনুযায়ী শুধুমাত্র প্রয়োজনীয় language field রিটার্ন করা, অথবা উভয় ভাষার data একসাথে রিটার্ন করে frontend-এ locale অনুযায়ী দেখানো
- Frontend ফর্মে উভয় ভাষার input field পাশাপাশি দেখানো (tab বা split-view-এ)

### API Response Pattern for Multilingual Data

Option A — Locale-aware response:
```json
{
  "id": 1,
  "name": "Product Name in Requested Language",
  "description": "Description in Requested Language"
}
```

Option B — Full bilingual response (উভয় ভাষার data):
```json
{
  "id": 1,
  "name_en": "Product Name",
  "name_bn": "পণ্যের নাম",
  "description_en": "Description",
  "description_bn": "বিবরণ"
}
```

Choice between A and B depends on module requirements. Option B is preferred for forms/edit pages, Option A for display-only pages.

## Frontend Implementation Rules

### 1. Import and Usage Pattern

```tsx
import { useTranslations } from 'next-intl';

export default function UserList() {
  const t = useTranslations('user');
  
  return (
    <div>
      <h1>{t('list.title')}</h1>
      <Button>{t('list.create')}</Button>
    </div>
  );
}
```

### 2. Dynamic Values in Translations

```json
{
  "user": {
    "messages": {
      "welcome": "Welcome, {name}!",
      "record_count": "{count} users found"
    }
  }
}
```

```tsx
t('messages.welcome', { name: 'John' });
t('messages.record_count', { count: users.length });
```

### 3. Forms — Bilingual Input Fields

When creating/editing an entity that requires multilingual data:

- **Side-by-side layout:** দুটি input field পাশাপাশি দেখান — left side-এ English, right side-এ Bengali
- **Label pattern:** `Name (English)` / `নাম (বাংলা)`
- **Tab approach:** অথবা দুইটি tab ব্যবহার করুন — "English" এবং "বাংলা"
- **At least one required:** কমপক্ষে একটিতে value থাকতেই হবে (business logic অনুযায়ী)

```tsx
<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
  <div>
    <Label>{t('fields.name')} (English)</Label>
    <Input {...register('name_en')} placeholder="Enter name in English" />
    {errors.name_en && <p className="text-red-500">{errors.name_en.message}</p>}
  </div>
  <div>
    <Label>{t('fields.name')} (বাংলা)</Label>
    <Input {...register('name_bn')} placeholder="বাংলায় নাম লিখুন" />
    {errors.name_bn && <p className="text-red-500">{errors.name_bn.message}</p>}
  </div>
</div>
```

### 4. Validation Messages

- Frontend validation messages must come from translation files
- Backend validation errors are returned in English by default; frontend maps error codes to localized messages

```tsx
// messages/bn/user.json
{
  "validation": {
    "name_required": "নাম আবশ্যক",
    "email_invalid": "ইমেইল ঠিকানা সঠিক নয়"
  }
}
```

### 5. Table Columns

Table headers should use translation keys. Data display should respect current locale:

```tsx
const columns = [
  { key: 'name', label: t('fields.name') },
  { key: 'email', label: t('fields.email') },
  { key: 'role', label: t('fields.role') },
  { key: 'status', label: t('fields.status') },
];
```

### 6. Breadcrumbs & Navigation

```tsx
const breadcrumbs = [
  { label: t('list.title'), href: '/users' },
  { label: currentUser.name, href: `/users/${id}` },
];
```

### 7. Language Switcher Component

```tsx
export function LanguageSwitcher() {
  const pathname = usePathname();
  const router = useRouter();
  const currentLocale = useLocale();
  
  const switchTo = currentLocale === 'en' ? 'bn' : 'en';
  const label = currentLocale === 'en' ? 'বাংলা' : 'English';
  
  return (
    <Button
      variant="ghost"
      onClick={() => router.replace(`/${switchTo}${pathname}`)}
    >
      {label}
    </Button>
  );
}
```

## Rules for New Modules

১. প্রতিটি নতুন মডিউলের জন্য আলাদা translation namespace তৈরি করতে হবে
২. `messages/en/{module}.json` এবং `messages/bn/{module}.json` — দুটি ফাইলই create করতে হবে
৩. বাংলা অনুবাদ বাদ দিয়ে শুধুমাত্র ইংরেজি ফাইল তৈরি করা যাবে না
৪. ন্যূনতম নিচের keys প্রতিটি মডিউলে থাকতে হবে:
   - `{module}.list.title`
   - `{module}.list.create`
   - `{module}.fields.*` (প্রতিটি DB field-এর জন্য)
   - `{module}.validation.*` (প্রয়োজনীয় validation messages)
   - `{module}.messages.create_success`
   - `{module}.messages.update_success`
   - `{module}.messages.delete_success`
   - `{module}.messages.delete_confirm`
   - `{module}.messages.no_data` (empty state)

## Form Error Display — Bilingual

```tsx
// Backend থেকে field-level error আসলে frontend-এ locale অনুযায়ী দেখানো
{error?.fields?.email && (
  <p className="text-red-500 text-sm mt-1">
    {locale === 'bn' 
      ? 'এই ইমেইলটি ইতিমধ্যে ব্যবহার করা হচ্ছে'
      : error.fields.email
    }
  </p>
)}
```

Backend always returns errors in English. Frontend maps known error codes/messages to Bengali when locale is `bn`.

## Backend — Multilingual Support for Error Messages

Backend JSON error responses should include an optional `error_code` field that frontend can use to look up the translated message:

```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "error_code": "email_already_exists",
    "message": "Email already exists",
    "fields": {
      "email": "Email already exists"
    }
  }
}
```

Frontend translation file:
```json
{
  "errors": {
    "email_already_exists": "এই ইমেইলটি ইতিমধ্যে ব্যবহার করা হচ্ছে"
  }
}
```

## Checklist — i18n

প্রতিটি নতুন মডিউল/ফিচারের জন্য:

- [ ] `messages/en/{module}.json` — English translations created
- [ ] `messages/bn/{module}.json` — বাংলা অনুবাদ তৈরি করা হয়েছে
- [ ] All UI text uses `useTranslations()` hook, no hardcoded English strings
- [ ] Form fields for multilingual data (name_en/name_bn) properly implemented
- [ ] Validation messages come from translation files
- [ ] Backend error codes are mapped to frontend translations
- [ ] Table headers use translated strings
- [ ] Breadcrumbs, page titles, buttons — all translated
- [ ] Language switcher works and maintains route
- [ ] Empty states, loading states, error states — all translated
- [ ] Sidebar/menu labels — translated
- [ ] Notifications/toast messages — translated
- [ ] Pagination labels — translated
- [ ] Both locales tested: `/en/...` and `/bn/...`
- [ ] RTL (Right-to-Left) layout check — বাংলা текстаের জন্য কোনো RTL adjustment প্রয়োজন কিনা নিশ্চিত করা হয়েছে

# Page Guide (Reusable Page Instructions) Module

## Objective

Every page must have a bilingual (বাংলা/English) **Guide** button that opens a modal explaining the page to newcomers — what it does, each option, common workflows, and important notes.

## Implementation

- **Reusable component:** `frontend/src/components/PageGuideModal.tsx`
  ```tsx
  <PageGuideModal pageKey="scratch_card_serials" />
  ```
  `pageKey` is the page's translation namespace. The component renders both the trigger button and the modal (portal + body scroll lock + framer-motion).

- **Content** authored in `frontend/src/i18n/translations.ts` under each page's namespace:
  - `guide.title` — modal heading
  - `guide.overview` — 1–2 sentence page summary (component renders nothing if this key is missing)
  - `guide.features_title` / `guide.steps_title` / `guide.notes_title` — section labels
  - `guide.features.f1.title` / `.desc`, `f2`, ... — each page option/button/filter
  - `guide.steps.s1.title` / `.desc`, `s2`, ... — step-by-step workflows
  - `guide.notes.n1.title` / `.desc`, `n2`, ... — tips/warnings

- Both `en` and `bn` translations **must** be authored together.

## Rules

1. Every page must include `<PageGuideModal pageKey="<namespace>" />` in its header button group
2. Every page must have complete `guide.*` content in `translations.ts` (en + bn)
3. Minimum keys per page: `title`, `overview`, plus at least `features_title` and one `features.f1`
4. If `guide.overview` is missing, the component safely renders nothing — no breakage
5. Guide buttons are informational (no extra permission required beyond the page's view permission)

## Status Calculation Rules (Time-Based)

Employee performance status is determined by a **time-based comparison**, not raw percentage alone.

### Logic (`timeBasedStatus`)

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

### Example

| Day | daysElapsed | timePct | Achievement | Status      |
|-----|-------------|---------|-------------|-------------|
| 15  | 15          | 50%     | 60%         | On Track    |
| 15  | 15          | 50%     | 30%         | Needs Attention (≥25%) |
| 15  | 15          | 50%     | 20%         | Behind      |
| 27  | 26          | 86.7%   | 81.9%       | Needs Attention |
| 27  | 26          | 86.7%   | 19.7%       | Behind      |

### Implementation
- Frontend function: `timeBasedStatus(pct, daysElapsed, totalDays)` in `page.tsx` and `export-activations.ts`
- Used in: `PerformanceTable` (employee rows + subtotal), Target vs Achievement card, Excel export KPI + employee rows
- Backend always sends raw `emp.status` / `emp.percentage`; frontend overrides display with time-based logic

---

## Responsive Table — Accordion Behavior

### Breakpoint
- **lg (1024px) and above**: Normal scrollable `<table>` with all columns
- **Below lg**: Accordion list view (`<div>` with expandable rows)

### Accordion Structure
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

### Rules
- Only **one** row expandable at a time (managed via `expandedId` state)
- Name + rank badge + identifier always visible (no scroll needed)
- Expanded content follows the same field order as the desktop table
- StatusBadge shown next to Achievement in expanded view
- Per-type extra rows (RSO Market/Own Activation, BP Yesterday/Day Count) only render for matching type

### Implementation
- Component: `PerformanceTable` in `page.tsx`
- State: `expandedId: number | null`
- Uses `hidden lg:block` / `lg:hidden` for view switching
- No custom breakpoints — uses Tailwind's default `lg:`

---

## Timezone Configuration

### Canonical Timezone

The project consistently uses **Bangladesh Standard Time (BST, UTC+6)** via a centralized utility.

### Utility Module

```python
# backend/app/utils/timezone.py
BST = timezone(timedelta(hours=6))

def now() -> datetime:           # Timezone-aware BST datetime
def now_naive() -> datetime:     # Naive BST datetime (no tzinfo)
def utc_now() -> datetime:       # UTC datetime (for JWT tokens)
def to_bst(dt) -> datetime:      # Convert any datetime to BST-aware
def to_bst_naive(dt) -> datetime: # Convert to naive BST
```

### Environment Variable

```env
TIME_ZONE=Asia/Dhaka
```

Added to `backend/config/settings.py`:

```python
TIME_ZONE: str = "Asia/Dhaka"
```

### Rules

1. **Use `now_naive()` for all timestamp assignments** in routers — replaces `datetime.utcnow()` or `datetime.utcnow() + timedelta(hours=6)`
2. **Use `now()` for scheduler/logger** — timezone-aware BST
3. **Use `utc_now()` for JWT token expiry** — JWT standard expects UTC
4. **Model column defaults** should use `now_naive` (not `datetime.utcnow`)
5. **Never hardcode** `datetime.utcnow() + timedelta(hours=6)` — always use `now_naive()`

### Files Updated

- `backend/app/utils/timezone.py` — centralized utility
- `backend/config/settings.py` — `TIME_ZONE` field
- `backend/main.py` — uses utility instead of hardcoded BST
- `backend/app/routers/deps.py` — `utc_now()` for JWT
- `backend/app/routers/scratch_card_serials.py`
- `backend/app/routers/sim_replacement.py` (13 occurrences)
- `backend/app/routers/cv.py`, `zoom_in.py`, `commission.py`, `bp_targets.py`
- `backend/app/models/commission.py`, `cv.py` — model defaults
- `.env` / `.env.example` / `backend/.env`

---

# Reusable WhatsApp/Telegram Report Delivery Module

## Overview

A reusable module for scheduling and sending report images (PNG) to WhatsApp groups or Telegram chats. Supports multiple report types via a registry pattern.

## Architecture

### Backend

**Report Builder Registry** (`backend/app/services/report_builders.py`):
- Central registry mapping `report_type` strings to builder functions
- Each builder: `async (db: AsyncSession, house_id: int) -> bytes` (returns PNG image)
- To add a new report type: add builder function + register in `REPORT_BUILDERS` dict

**Existing Report Types:**
| `report_type` | Builder Function | Description |
|---|---|---|
| `ga_live` | `build_ga_live_report_image()` | GA Live Report with RSO/BP/CC sections |
| `active_lso` | `build_active_lso_report_image()` | Active LSO retailer performance |
| `active_sso` | `build_active_sso_report_image()` | Active SSO SIM activation performance |

**Schedule Model** (`backend/app/models/whatsapp_schedule.py`):
- `report_type` column (VARCHAR(50), default `"ga_live"`)
- `channel`: `"whatsapp"` or `"telegram"`
- `schedule_type`: `"daily"` (HH:MM) or `"interval"` (every N minutes)

**Schedule Service** (`backend/app/services/whatsapp_schedule_service.py`):
- `send_schedule_report()` dispatches to correct builder via `get_report_builder(schedule.report_type)`
- Background runner in `main.py` fires every 30 seconds, checks `_is_due()`

**API Endpoints** (`backend/app/routers/whatsapp_schedules.py`):
- `GET /api/whatsapp-schedules?report_type=xxx` — list (filtered by report_type)
- `POST /api/whatsapp-schedules` — create (requires `report_type` in payload)
- `PATCH /api/whatsapp-schedules/{id}` — update
- `DELETE /api/whatsapp-schedules/{id}` — soft delete
- `POST /api/whatsapp-schedules/{id}/send-now` — immediate send
- `GET /api/whatsapp/status` — WhatsApp connection status
- `GET /api/whatsapp/groups` — list WhatsApp groups

**Permission:** `live_activations.schedule` (used for all report types)

### Frontend

**Reusable Component** (`frontend/src/components/WhatsAppReportDeliveryModal.tsx`):

```tsx
<WhatsAppReportDeliveryModal
  open={isOpen}
  houseId={houseId}
  reportType="active_lso"          // Required: which report to send
  title="Active LSO Report Delivery"   // Optional: modal title
  subtitle="Auto-send report daily"    // Optional: modal subtitle
  onClose={() => setIsOpen(false)}
/>
```

**Features:**
- WhatsApp connection status with QR code scanning
- WhatsApp group selection grid
- Telegram channel support
- Frequency: repeat every N minutes OR daily at HH:MM
- Optional caption
- Active schedule list with send now, edit, pause/resume, delete
- 5-second polling for WhatsApp connection status

### How to Add a New Report Type

1. **Create builder function** in `backend/app/services/xxx_whatsapp_image.py`:
```python
async def build_xxx_report_image(db: AsyncSession, house_id: int) -> bytes:
    # Generate report data, render PNG with Pillow, return bytes
    ...
```

2. **Register in** `backend/app/services/report_builders.py`:
```python
from app.services.xxx_whatsapp_image import build_xxx_report_image
REPORT_BUILDERS["xxx"] = build_xxx_report_image
```

3. **Allow in router** — add `"xxx"` to the allowed `report_type` values in `backend/app/routers/whatsapp_schedules.py`

4. **Use in frontend:**
```tsx
import WhatsAppReportDeliveryModal from "@/components/WhatsAppReportDeliveryModal";

<WhatsAppReportDeliveryModal
  reportType="xxx"
  title="XXX Report Delivery"
  subtitle="Auto-send XXX report"
/>
```

### Files

| File | Purpose |
|------|---------|
| `backend/app/models/whatsapp_schedule.py` | Schedule DB model |
| `backend/app/services/report_builders.py` | Registry + builder dispatch |
| `backend/app/services/whatsapp_schedule_service.py` | Schedule execution engine |
| `backend/app/services/ga_live_whatsapp_image.py` | GA Live PNG builder |
| `backend/app/services/active_lso_whatsapp_image.py` | Active LSO PNG builder |
| `backend/app/services/active_sso_whatsapp_image.py` | Active SSO PNG builder |
| `backend/app/routers/whatsapp_schedules.py` | API endpoints |
| `frontend/src/components/WhatsAppReportDeliveryModal.tsx` | Reusable React component |
| `backend/main.py` (lines 300-322) | Background scheduler loop |

---

