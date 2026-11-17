# Database Rules

> Detail spec referenced from [AGENTS.md](../../AGENTS.md). Rules here are binding; they are not optional guidance.

## Database Rules

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

## Soft Delete Convention

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
