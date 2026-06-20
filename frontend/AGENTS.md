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

---

# Import/Export Rules

If import/export exists:
Create permissions:
module.import
module.export

Only authorized users can access these features.

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

## Final Note

যেকোনো হার্ডকোডেড ইংরেজি স্ট্রিং কোডে থাকা যাবে না। প্রতিটি visible text — label, title, button, error message, tooltip, placeholder, toast — সবকিছু translation function-এর মাধ্যমে render করতে হবে। শুধুমাত্র code-level identifier (variable name, key name, etc.) ইংরেজি রাখা যাবে।

---


