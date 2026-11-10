"""Template / letterhead resolution and immutable versioning.

Every write goes through `document_ast.validate_ast` +
`validate_variables_schema`, so an invalid body can never reach the database.

Scope rules
-----------
* ``house_id IS NULL`` -> global template/letterhead/signatory. Readable by any
  tenant, writable only by a super admin.
* ``house_id == active house`` -> that house's own row. Writable by a user with
  the matching ``documents.*`` permission inside that house.
* Generation resolves **house first, then global**. More than one usable
  default in a scope is a configuration error, never an arbitrary pick.
"""

import logging
from typing import Optional

from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.documents import (
    DocumentLetterhead,
    DocumentSignatory,
    DocumentTemplate,
    DocumentTemplateVersion,
    DocumentType,
)
from app.services import document_ast
from app.utils.access_control import is_super_admin_user
from app.utils.timezone import now_naive

logger = logging.getLogger(__name__)


# --------------------------------------------------------------------------- #
# Serializers
# --------------------------------------------------------------------------- #

def serialize_type(document_type: DocumentType) -> dict:
    return {
        "id": document_type.id,
        "code": document_type.code,
        "name": document_type.name,
        "name_bn": document_type.name_bn,
        "number_prefix": document_type.number_prefix,
        "description": document_type.description,
        "is_active": document_type.is_active,
    }


def serialize_template(template: DocumentTemplate, latest: Optional[dict] = None) -> dict:
    return {
        "id": template.id,
        "document_type_id": template.document_type_id,
        "house_id": template.house_id,
        "scope": "global" if template.house_id is None else "house",
        "name": template.name,
        "template_mode": template.template_mode,
        "description": template.description,
        "is_default": template.is_default,
        "is_active": template.is_active,
        "latest_version": latest,
        "created_at": template.created_at.isoformat() if template.created_at else None,
        "updated_at": template.updated_at.isoformat() if template.updated_at else None,
    }


def serialize_version(version: DocumentTemplateVersion, *, include_content: bool = False) -> dict:
    payload = {
        "id": version.id,
        "template_id": version.template_id,
        "version_number": version.version_number,
        "variables_schema": version.variables_schema or {"fields": []},
        "version_notes": version.version_notes,
        "is_published": version.is_published,
        "published_at": version.published_at.isoformat() if version.published_at else None,
        "created_at": version.created_at.isoformat() if version.created_at else None,
        "created_by": version.created_by,
    }
    if include_content:
        payload["content_json"] = version.content_json
    return payload


# --------------------------------------------------------------------------- #
# Types
# --------------------------------------------------------------------------- #

async def list_types(db: AsyncSession, *, include_inactive: bool = False) -> list:
    query = select(DocumentType).where(DocumentType.is_deleted.is_(False))
    if not include_inactive:
        query = query.where(DocumentType.is_active.is_(True))
    result = await db.execute(query.order_by(DocumentType.name))
    return [serialize_type(row) for row in result.unique().scalars().all()]


# --------------------------------------------------------------------------- #
# Templates
# --------------------------------------------------------------------------- #

async def get_template(db: AsyncSession, template_id: int) -> DocumentTemplate:
    template = await db.get(DocumentTemplate, template_id)
    if template is None or template.is_deleted:
        raise HTTPException(status_code=404, detail={"code": "TEMPLATE_NOT_FOUND", "message": "Template not found"})
    return template


def assert_template_readable(template: DocumentTemplate, house_id: Optional[int]) -> None:
    """A house may read global templates and its own; never another house's."""
    if template.house_id is None:
        return
    if house_id is None or template.house_id != house_id:
        raise HTTPException(
            status_code=403,
            detail={"code": "TEMPLATE_FORBIDDEN", "message": "This template belongs to another house"},
        )


def assert_template_writable(template: DocumentTemplate, house_id: Optional[int], user) -> None:
    if template.house_id is None:
        if not is_super_admin_user(user):
            raise HTTPException(
                status_code=403,
                detail={
                    "code": "GLOBAL_TEMPLATE_READ_ONLY",
                    "message": "Only a super admin can change a global template",
                },
            )
        return
    if house_id is None or template.house_id != house_id:
        raise HTTPException(
            status_code=403,
            detail={"code": "TEMPLATE_FORBIDDEN", "message": "This template belongs to another house"},
        )


async def _assert_name_free(
    db: AsyncSession,
    *,
    document_type_id: int,
    house_id: Optional[int],
    name: str,
    exclude_id: Optional[int] = None,
) -> None:
    query = select(DocumentTemplate.id).where(
        DocumentTemplate.document_type_id == document_type_id,
        func.lower(DocumentTemplate.name) == name.lower(),
        DocumentTemplate.is_deleted.is_(False),
    )
    query = query.where(
        DocumentTemplate.house_id.is_(None) if house_id is None else DocumentTemplate.house_id == house_id
    )
    if exclude_id is not None:
        query = query.where(DocumentTemplate.id != exclude_id)
    if (await db.execute(query)).first():
        raise HTTPException(
            status_code=409,
            detail={
                "code": "TEMPLATE_NAME_TAKEN",
                "message": "A template with this name already exists in this scope",
                "fields": {"name": "Already used"},
            },
        )


async def list_templates(
    db: AsyncSession,
    *,
    house_id: Optional[int],
    document_type_id: Optional[int] = None,
    scope: Optional[str] = None,
    mode: Optional[str] = None,
    search: Optional[str] = None,
    include_inactive: bool = False,
    page: int = 1,
    per_page: int = 20,
) -> tuple:
    """Global templates plus the active house's own, with a latest-version summary."""
    if house_id is None:
        scope_filter = DocumentTemplate.house_id.is_(None)
    else:
        scope_filter = (DocumentTemplate.house_id.is_(None)) | (DocumentTemplate.house_id == house_id)

    query = select(DocumentTemplate).where(
        DocumentTemplate.is_deleted.is_(False), scope_filter
    )
    if scope == "global":
        query = query.where(DocumentTemplate.house_id.is_(None))
    elif scope == "house":
        query = query.where(DocumentTemplate.house_id == house_id)
    if document_type_id:
        query = query.where(DocumentTemplate.document_type_id == document_type_id)
    if mode:
        query = query.where(DocumentTemplate.template_mode == mode)
    if not include_inactive:
        query = query.where(DocumentTemplate.is_active.is_(True))
    if search:
        query = query.where(DocumentTemplate.name.ilike(f"%{search}%"))

    total = (await db.execute(select(func.count()).select_from(query.subquery()))).scalar() or 0
    rows = (
        await db.execute(
            query.order_by(DocumentTemplate.house_id.nullsfirst(), DocumentTemplate.name)
            .offset((page - 1) * per_page)
            .limit(per_page)
        )
    ).unique().scalars().all()

    latest_by_template = await _latest_versions(db, [row.id for row in rows])
    data = [serialize_template(row, latest_by_template.get(row.id)) for row in rows]
    return data, total


async def _latest_versions(db: AsyncSession, template_ids: list) -> dict:
    """Highest version number per template (published or not) for the list badge."""
    if not template_ids:
        return {}
    rows = (
        await db.execute(
            select(
                DocumentTemplateVersion.template_id,
                DocumentTemplateVersion.version_number,
                DocumentTemplateVersion.is_published,
            )
            .where(DocumentTemplateVersion.template_id.in_(template_ids))
            .order_by(DocumentTemplateVersion.template_id, DocumentTemplateVersion.version_number.desc())
        )
    ).all()
    latest: dict = {}
    for template_id, version_number, is_published in rows:
        entry = latest.setdefault(template_id, {"version_number": version_number, "is_published": is_published})
        if is_published and "published_version" not in entry:
            entry["published_version"] = version_number
    return latest


async def latest_version(db: AsyncSession, template_id: int, *, published_only: bool = False) -> Optional[DocumentTemplateVersion]:
    query = select(DocumentTemplateVersion).where(
        DocumentTemplateVersion.template_id == template_id
    )
    if published_only:
        query = query.where(DocumentTemplateVersion.is_published.is_(True))
    query = query.order_by(DocumentTemplateVersion.version_number.desc()).limit(1)
    return (await db.execute(query)).scalar_one_or_none()


async def list_versions(db: AsyncSession, template_id: int) -> list:
    """All versions of a template, newest first (bodies excluded)."""
    rows = (
        await db.execute(
            select(DocumentTemplateVersion)
            .where(DocumentTemplateVersion.template_id == template_id)
            .order_by(DocumentTemplateVersion.version_number.desc())
        )
    ).unique().scalars().all()
    return [serialize_version(row) for row in rows]


async def get_version(db: AsyncSession, template_id: int, version_number: int) -> DocumentTemplateVersion:
    version = (
        await db.execute(
            select(DocumentTemplateVersion).where(
                DocumentTemplateVersion.template_id == template_id,
                DocumentTemplateVersion.version_number == version_number,
            )
        )
    ).scalar_one_or_none()
    if version is None:
        raise HTTPException(status_code=404, detail={"code": "VERSION_NOT_FOUND", "message": "Template version not found"})
    return version


async def create_template(
    db: AsyncSession,
    *,
    document_type_id: int,
    house_id: Optional[int],
    name: str,
    template_mode: str,
    description: Optional[str],
    is_default: bool,
    content_json: dict,
    variables_schema: dict,
    version_notes: Optional[str],
    publish: bool,
    user,
) -> tuple:
    """Create a template with its first version. Validates the body first."""
    if house_id is None and not is_super_admin_user(user):
        raise HTTPException(
            status_code=403,
            detail={
                "code": "GLOBAL_TEMPLATE_FORBIDDEN",
                "message": "Only a super admin can create a global template",
            },
        )
    if house_id is not None:
        house_ids = [house.id for house in getattr(user, "houses", []) or []]
        if house_id not in house_ids and not is_super_admin_user(user):
            raise HTTPException(status_code=403, detail="You do not have access to this house context")

    document_type = await db.get(DocumentType, document_type_id)
    if document_type is None or document_type.is_deleted:
        raise HTTPException(status_code=404, detail={"code": "TYPE_NOT_FOUND", "message": "Document type not found"})

    if template_mode not in ("PREDEFINED", "VISUAL"):
        raise HTTPException(status_code=422, detail={"code": "INVALID_MODE", "message": "Invalid template mode"})

    await _assert_name_free(db, document_type_id=document_type_id, house_id=house_id, name=name)

    ast = _validated_ast(content_json)
    schema = _validated_schema(variables_schema, ast)

    template = DocumentTemplate(
        document_type_id=document_type_id,
        house_id=house_id,
        name=name,
        template_mode=template_mode,
        description=description,
        is_default=is_default,
        is_active=True,
        created_by=user.id,
        updated_by=user.id,
    )
    db.add(template)
    await db.flush()

    version = DocumentTemplateVersion(
        template_id=template.id,
        version_number=1,
        content_json=ast,
        variables_schema=schema,
        version_notes=version_notes,
        is_published=bool(publish),
        published_at=now_naive() if publish else None,
        created_by=user.id,
    )
    db.add(version)
    await db.flush()
    return template, version


async def update_template(
    db: AsyncSession,
    template: DocumentTemplate,
    *,
    house_id: Optional[int],
    user,
    **changes,
) -> DocumentTemplate:
    assert_template_writable(template, house_id, user)

    name = changes.get("name")
    if name and name != template.name:
        await _assert_name_free(
            db,
            document_type_id=template.document_type_id,
            house_id=template.house_id,
            name=name,
            exclude_id=template.id,
        )
        template.name = name
    for field in ("description", "is_default", "is_active"):
        if field in changes and changes[field] is not None:
            setattr(template, field, changes[field])
    template.updated_by = user.id
    await db.flush()
    return template


async def delete_template(db: AsyncSession, template: DocumentTemplate, *, house_id: Optional[int], user) -> None:
    assert_template_writable(template, house_id, user)
    template.is_deleted = True
    template.is_active = False
    template.deleted_at = now_naive()
    template.deleted_by = user.id
    await db.flush()


async def add_version(
    db: AsyncSession,
    template: DocumentTemplate,
    *,
    house_id: Optional[int],
    user,
    content_json: dict,
    variables_schema: dict,
    version_notes: Optional[str],
    publish: bool,
) -> DocumentTemplateVersion:
    assert_template_writable(template, house_id, user)

    ast = _validated_ast(content_json)
    schema = _validated_schema(variables_schema, ast)

    await db.execute(
        select(DocumentTemplate.id)
        .where(DocumentTemplate.id == template.id)
        .with_for_update()
    )
    current = (
        await db.execute(
            select(func.max(DocumentTemplateVersion.version_number)).where(
                DocumentTemplateVersion.template_id == template.id
            )
        )
    ).scalar() or 0

    version = DocumentTemplateVersion(
        template_id=template.id,
        version_number=current + 1,
        content_json=ast,
        variables_schema=schema,
        version_notes=version_notes,
        is_published=bool(publish),
        published_at=now_naive() if publish else None,
        created_by=user.id,
    )
    db.add(version)
    template.updated_by = user.id
    await db.flush()
    return version


async def publish_version(
    db: AsyncSession,
    template: DocumentTemplate,
    version: DocumentTemplateVersion,
    *,
    house_id: Optional[int],
    user,
) -> DocumentTemplateVersion:
    assert_template_writable(template, house_id, user)
    if not version.is_published:
        version.is_published = True
        version.published_at = now_naive()
        await db.flush()
    return version


async def duplicate_template(
    db: AsyncSession,
    template: DocumentTemplate,
    *,
    house_id: Optional[int],
    user,
    name: str,
) -> tuple:
    assert_template_readable(template, house_id)
    source_version = await latest_version(db, template.id, published_only=True) or await latest_version(db, template.id)
    if source_version is None:
        raise HTTPException(status_code=422, detail={"code": "TEMPLATE_EMPTY", "message": "This template has no version to copy"})

    return await create_template(
        db,
        document_type_id=template.document_type_id,
        house_id=house_id,
        name=name,
        template_mode=template.template_mode,
        description=template.description,
        is_default=False,
        content_json=source_version.content_json,
        variables_schema=source_version.variables_schema,
        version_notes=f"Copied from template #{template.id} v{source_version.version_number}",
        publish=True,
        user=user,
    )


def _validated_ast(content_json) -> dict:
    try:
        return document_ast.validate_ast(content_json)
    except document_ast.AstError as exc:
        raise HTTPException(
            status_code=422,
            detail={"code": "INVALID_TEMPLATE", "message": str(exc), "fields": {"content_json": str(exc)}},
        ) from exc


def _validated_schema(variables_schema, ast: dict) -> dict:
    try:
        return document_ast.validate_variables_schema(variables_schema, ast)
    except document_ast.AstError as exc:
        raise HTTPException(
            status_code=422,
            detail={"code": "INVALID_VARIABLES", "message": str(exc), "fields": {"variables_schema": str(exc)}},
        ) from exc


# --------------------------------------------------------------------------- #
# Resolution (generation + preview)
# --------------------------------------------------------------------------- #

async def resolve_template(
    db: AsyncSession, *, document_type_id: int, house_id: int
) -> tuple:
    """House template first, then the global one. Ambiguity is an error."""
    house_template = await _resolve_scope(db, document_type_id, house_id)
    if house_template is not None:
        return house_template
    global_template = await _resolve_scope(db, document_type_id, None)
    if global_template is not None:
        return global_template
    raise HTTPException(
        status_code=422,
        detail={
            "code": "NO_TEMPLATE",
            "message": "No published template is available for this document type in this house",
        },
    )


async def _resolve_scope(db: AsyncSession, document_type_id: int, house_id: Optional[int]) -> Optional[tuple]:
    scope_filter = (
        DocumentTemplate.house_id.is_(None) if house_id is None else DocumentTemplate.house_id == house_id
    )
    candidates = (
        await db.execute(
            select(DocumentTemplate).where(
                DocumentTemplate.document_type_id == document_type_id,
                DocumentTemplate.is_active.is_(True),
                DocumentTemplate.is_deleted.is_(False),
                scope_filter,
            )
        )
    ).unique().scalars().all()

    usable = []
    for candidate in candidates:
        version = await latest_version(db, candidate.id, published_only=True)
        if version is not None:
            usable.append((candidate, version))

    if not usable:
        return None

    defaults = [item for item in usable if item[0].is_default]
    if len(defaults) > 1:
        raise HTTPException(
            status_code=409,
            detail={
                "code": "AMBIGUOUS_DEFAULT_TEMPLATE",
                "message": "More than one default template is active for this document type",
            },
        )
    if len(defaults) == 1:
        return defaults[0]
    if len(usable) == 1:
        return usable[0]
    raise HTTPException(
        status_code=409,
        detail={
            "code": "TEMPLATE_AMBIGUOUS",
            "message": "Several templates are available for this document type. Mark one as default.",
        },
    )


async def resolve_letterhead(db: AsyncSession, house_id: int) -> Optional[DocumentLetterhead]:
    """House letterhead first, then the global one; ambiguity is an error."""
    for scope_house_id in (house_id, None):
        scope_filter = (
            DocumentLetterhead.house_id.is_(None)
            if scope_house_id is None
            else DocumentLetterhead.house_id == scope_house_id
        )
        rows = (
            await db.execute(
                select(DocumentLetterhead).where(
                    scope_filter,
                    DocumentLetterhead.is_active.is_(True),
                    DocumentLetterhead.is_deleted.is_(False),
                )
            )
        ).unique().scalars().all()
        if not rows:
            continue
        defaults = [row for row in rows if row.is_default]
        if len(defaults) > 1:
            raise HTTPException(
                status_code=409,
                detail={
                    "code": "AMBIGUOUS_DEFAULT_LETTERHEAD",
                    "message": "More than one default letterhead is active",
                },
            )
        if len(defaults) == 1:
            return defaults[0]
        if len(rows) == 1:
            return rows[0]
        raise HTTPException(
            status_code=409,
            detail={
                "code": "LETTERHEAD_AMBIGUOUS",
                "message": "Several letterheads are active. Mark one as default.",
            },
        )
    return None


async def resolve_signatory(
    db: AsyncSession, *, house_id: int, signatory_id: Optional[int] = None
) -> Optional[DocumentSignatory]:
    if signatory_id is not None:
        signatory = await db.get(DocumentSignatory, signatory_id)
        if signatory is None or signatory.is_deleted:
            raise HTTPException(status_code=404, detail={"code": "SIGNATORY_NOT_FOUND", "message": "Signatory not found"})
        if signatory.house_id is not None and signatory.house_id != house_id:
            raise HTTPException(
                status_code=403,
                detail={"code": "SIGNATORY_FORBIDDEN", "message": "This signatory belongs to another house"},
            )
        return signatory

    for scope_house_id in (house_id, None):
        scope_filter = (
            DocumentSignatory.house_id.is_(None)
            if scope_house_id is None
            else DocumentSignatory.house_id == scope_house_id
        )
        rows = (
            await db.execute(
                select(DocumentSignatory).where(
                    scope_filter,
                    DocumentSignatory.is_active.is_(True),
                    DocumentSignatory.is_deleted.is_(False),
                )
            )
        ).unique().scalars().all()
        defaults = [row for row in rows if row.is_default]
        if defaults:
            return defaults[0]
        if len(rows) == 1:
            return rows[0]
    return None
