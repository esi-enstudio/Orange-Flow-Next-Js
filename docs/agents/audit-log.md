# Activity Log / Audit Trail

> Detail spec referenced from [AGENTS.md](../../AGENTS.md). Rules here are binding; they are not optional guidance.

## Activity Log / Audit Trail

### Objective

প্রতিটি ইউজার কখন, কোন কাজ, কোন মডিউলে, কার IP থেকে, এবং কি পরিবর্তন করেছে — তার সম্পূর্ণ এবং অপরিবর্তনীয় রেকর্ড রাখা।

### Database Table Structure

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

#### Indexing Strategy

```sql
CREATE INDEX idx_activity_logs_user_id ON activity_logs(user_id);
CREATE INDEX idx_activity_logs_module ON activity_logs(module);
CREATE INDEX idx_activity_logs_action ON activity_logs(action);
CREATE INDEX idx_activity_logs_created_at ON activity_logs(created_at);
CREATE INDEX idx_activity_logs_user_date ON activity_logs(user_id, created_at DESC);
```

### Standard Action Types

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

### Implementation Mechanism

#### Backend — Middleware/Decorator Approach

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

#### Auto-Log Rules

1. **Login/Logout** — Logged at the authentication API level (no decorator needed)
2. **Create** — Log after successful insert; `new_values` = created data, `old_values` = null
3. **Edit** — Log after successful update; `old_values` = previous state, `new_values` = updated fields
4. **Delete** — Log before soft delete; `old_values` = deleted record, `new_values` = null
5. **All sensitive mutations** (create, edit, delete, approve, reject, publish, restore) — Must log before returning the response
6. **Sensitive View** — Log when accessing confidential data (e.g., viewing user salary, financial reports)

### Browsing / Querying Audit Logs

Audit logs are **read-only** via API and require a separate permission: `audit.view`.

#### Allowed Filters (via API)

| Filter        | Type   | Description                               |
|---------------|--------|-------------------------------------------|
| user_id       | int    | Filter by specific user                   |
| module        | string | Filter by module name                     |
| action        | string | Filter by action type                     |
| record_id     | int    | Filter by affected record ID              |
| from_date     | date   | Start date (inclusive)                    |
| to_date       | date   | End date (inclusive)                      |
| search        | string | Search in record_identifier or user_name  |

#### Response Format

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

### Data Retention Policy

- Activity logs older than **1 year** should be archived to a separate archive table or cold storage
- Archived logs must remain queryable via a separate API endpoint with `audit.view.archive` permission
- Implement a scheduled task (e.g., cron / Celery beat) that runs daily to move expired logs

### Security Rules

- Audit logs are **append-only**. No UPDATE or DELETE API exists for log entries
- Hard-deleting logs requires direct database access and must be logged separately
- User IP addresses and user-agent data are sensitive — mask them in non-admin API responses
- Only users with `audit.view` permission can access audit logs
- Only users with `audit.view.sensitive` permission can see IP addresses and user-agent values
