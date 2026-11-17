# API Conventions

> Detail spec referenced from [AGENTS.md](../../AGENTS.md). Rules here are binding; they are not optional guidance.

## API Versioning Convention

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

## Pagination API Contract

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

## Error Response Standards

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

## API Development Rules

Every API must have:
- Authentication check
- Permission check
- Validation
- Proper HTTP status code (see Error Response Standards)
- Error handling
