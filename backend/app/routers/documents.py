"""Document Automation API: document types, templates, versions and preview.

Phase 1/2 surface only. Generation, numbering and PDF rendering live in the
next phase and will add their own routes under the same prefix.

Authorization
-------------
* Reads require ``documents.templates.view``.
* Every write requires ``documents.templates.manage``.
* A global template (``house_id IS NULL``) is readable by every tenant but
  writable only by a super admin (enforced in `document_service`).
* A house template is only visible/writable inside that house. The house always
  comes from the ``X-House-ID`` header, never from the request body.
"""

import logging
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.user import User
from app.routers.deps import get_db, get_house_context, has_permission
from app.schemas.documents import (
    TemplateCreateIn,
    TemplateDuplicateIn,
    TemplatePreviewIn,
    TemplateUpdateIn,
    TemplateVersionIn,
)
from app.services import document_ast, document_render
from app.services import document_service as svc
from app.utils.activity_logger import log_activity

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/documents", tags=["documents"])

VIEW = "documents.templates.view"
MANAGE = "documents.templates.manage"
MODULE = "document_template"


def _pagination(page: int, per_page: int, total: int) -> dict:
    total_pages = (total + per_page - 1) // per_page if per_page else 0
    return {
        "page": page,
        "per_page": per_page,
        "total": total,
        "total_pages": total_pages,
        "has_next": page < total_pages,
        "has_prev": page > 1,
    }


async def _audit(
    db: AsyncSession,
    request: Request,
    user: User,
    action: str,
    template,
    *,
    old_values: Optional[dict] = None,
    new_values: Optional[dict] = None,
) -> None:
    await log_activity(
        db,
        user_id=user.id,
        user_name=getattr(user, "name", None),
        module=MODULE,
        action=action,
        record_id=template.id,
        record_identifier=template.name,
        old_values=old_values,
        new_values=new_values,
        request=request,
        status_code=200,
        commit=False,
    )


# --------------------------------------------------------------------------- #
# Types & variables
# --------------------------------------------------------------------------- #

@router.get("/types")
async def list_document_types(
    include_inactive: bool = Query(False),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission(VIEW)),
):
    data = await svc.list_types(db, include_inactive=include_inactive)
    return {"success": True, "data": data}


@router.get("/variables")
async def list_variables(
    current_user: User = Depends(has_permission(VIEW)),
):
    """Variable registry, so an editor can offer the available placeholders."""
    data = [
        {
            "key": key,
            "label": spec["label"],
            "label_bn": spec.get("label_bn", ""),
            "type": spec.get("type", "text"),
            "source": spec.get("source"),
            "readonly": bool(spec.get("readonly")),
        }
        for key, spec in sorted(document_ast.VARIABLES.items())
    ]
    return {"success": True, "data": data}


# --------------------------------------------------------------------------- #
# Templates
# --------------------------------------------------------------------------- #

@router.get("/templates")
async def list_templates(
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=100),
    search: Optional[str] = Query(None, max_length=200),
    document_type_id: Optional[int] = Query(None),
    scope: Optional[Literal["global", "house"]] = Query(None),
    mode: Optional[Literal["PREDEFINED", "VISUAL"]] = Query(None),
    include_inactive: bool = Query(False),
    db: AsyncSession = Depends(get_db),
    house_context: Optional[int] = Depends(get_house_context),
    current_user: User = Depends(has_permission(VIEW)),
):
    data, total = await svc.list_templates(
        db,
        house_id=house_context,
        document_type_id=document_type_id,
        scope=scope,
        mode=mode,
        search=search,
        include_inactive=include_inactive,
        page=page,
        per_page=per_page,
    )
    return {
        "success": True,
        "data": data,
        "pagination": _pagination(page, per_page, total),
    }


@router.post("/templates", status_code=status.HTTP_201_CREATED)
async def create_template(
    payload: TemplateCreateIn,
    request: Request,
    db: AsyncSession = Depends(get_db),
    house_context: Optional[int] = Depends(get_house_context),
    current_user: User = Depends(has_permission(MANAGE)),
):
    house_id = None if payload.scope == "global" else house_context
    if payload.scope == "house" and house_id is None:
        raise HTTPException(
            status_code=400,
            detail={"code": "HOUSE_REQUIRED", "message": "Select a house first (X-House-ID header)"},
        )

    template, version = await svc.create_template(
        db,
        document_type_id=payload.document_type_id,
        house_id=house_id,
        name=payload.name,
        template_mode=payload.template_mode,
        description=payload.description,
        is_default=payload.is_default,
        content_json=payload.content_json,
        variables_schema=payload.variables_schema,
        version_notes=payload.version_notes,
        publish=payload.publish,
        user=current_user,
    )
    await _audit(
        db, request, current_user, "create", template,
        new_values={"name": template.name, "scope": payload.scope, "version": version.version_number},
    )
    await db.commit()
    await db.refresh(template)
    await db.refresh(version)
    data = svc.serialize_template(
        template,
        {"version_number": version.version_number, "is_published": version.is_published},
    )
    data["version"] = svc.serialize_version(version, include_content=True)
    return {"success": True, "data": data}


@router.get("/templates/{template_id}")
async def get_template(
    template_id: int,
    db: AsyncSession = Depends(get_db),
    house_context: Optional[int] = Depends(get_house_context),
    current_user: User = Depends(has_permission(VIEW)),
):
    template = await svc.get_template(db, template_id)
    svc.assert_template_readable(template, house_context)
    latest = await svc.latest_version(db, template.id)
    data = svc.serialize_template(
        template,
        svc.serialize_version(latest) if latest else None,
    )
    if latest is not None:
        data["content_json"] = latest.content_json
    return {"success": True, "data": data}


@router.patch("/templates/{template_id}")
async def update_template(
    template_id: int,
    payload: TemplateUpdateIn,
    request: Request,
    db: AsyncSession = Depends(get_db),
    house_context: Optional[int] = Depends(get_house_context),
    current_user: User = Depends(has_permission(MANAGE)),
):
    template = await svc.get_template(db, template_id)
    before = {
        "name": template.name,
        "description": template.description,
        "is_default": template.is_default,
        "is_active": template.is_active,
    }
    await svc.update_template(
        db, template, house_id=house_context, user=current_user,
        **payload.model_dump(exclude_unset=True),
    )
    await _audit(db, request, current_user, "edit", template, old_values=before)
    await db.commit()
    return {"success": True, "data": svc.serialize_template(template)}


@router.delete("/templates/{template_id}")
async def delete_template(
    template_id: int,
    request: Request,
    db: AsyncSession = Depends(get_db),
    house_context: Optional[int] = Depends(get_house_context),
    current_user: User = Depends(has_permission(MANAGE)),
):
    template = await svc.get_template(db, template_id)
    await svc.delete_template(db, template, house_id=house_context, user=current_user)
    await _audit(
        db, request, current_user, "delete", template,
        old_values={"name": template.name, "house_id": template.house_id},
    )
    await db.commit()
    return {"success": True, "data": {"id": template_id}}


@router.post("/templates/{template_id}/duplicate", status_code=status.HTTP_201_CREATED)
async def duplicate_template(
    template_id: int,
    payload: TemplateDuplicateIn,
    request: Request,
    db: AsyncSession = Depends(get_db),
    house_context: Optional[int] = Depends(get_house_context),
    current_user: User = Depends(has_permission(MANAGE)),
):
    source = await svc.get_template(db, template_id)
    house_id = None if payload.scope == "global" else house_context
    if payload.scope == "house" and house_id is None:
        raise HTTPException(
            status_code=400,
            detail={"code": "HOUSE_REQUIRED", "message": "Select a house first (X-House-ID header)"},
        )
    template, version = await svc.duplicate_template(
        db, source, house_id=house_id, user=current_user, name=payload.name
    )
    await _audit(
        db, request, current_user, "create", template,
        new_values={"name": template.name, "copied_from": source.id},
    )
    await db.commit()
    return {
        "success": True,
        "data": svc.serialize_template(
            template,
            {"version_number": version.version_number, "is_published": version.is_published},
        ),
    }


@router.get("/templates/{template_id}/schema")
async def template_schema(
    template_id: int,
    version_number: Optional[int] = Query(None, ge=1),
    db: AsyncSession = Depends(get_db),
    house_context: Optional[int] = Depends(get_house_context),
    current_user: User = Depends(has_permission(VIEW)),
):
    """Variable definition a generation form must collect for this template."""
    template = await svc.get_template(db, template_id)
    svc.assert_template_readable(template, house_context)
    if version_number is not None:
        version = await svc.get_version(db, template.id, version_number)
    else:
        version = await svc.latest_version(db, template.id, published_only=True)
        version = version or await svc.latest_version(db, template.id)
    if version is None:
        raise HTTPException(
            status_code=404,
            detail={"code": "VERSION_NOT_FOUND", "message": "This template has no version"},
        )
    return {
        "success": True,
        "data": {
            "template_id": template.id,
            "version_number": version.version_number,
            "variables_schema": version.variables_schema or {"fields": []},
        },
    }


# --------------------------------------------------------------------------- #
# Versions
# --------------------------------------------------------------------------- #

@router.get("/templates/{template_id}/versions")
async def list_versions(
    template_id: int,
    db: AsyncSession = Depends(get_db),
    house_context: Optional[int] = Depends(get_house_context),
    current_user: User = Depends(has_permission(VIEW)),
):
    template = await svc.get_template(db, template_id)
    svc.assert_template_readable(template, house_context)
    versions = await svc.list_versions(db, template.id)
    return {"success": True, "data": versions}


@router.post("/templates/{template_id}/versions", status_code=status.HTTP_201_CREATED)
async def create_version(
    template_id: int,
    payload: TemplateVersionIn,
    request: Request,
    db: AsyncSession = Depends(get_db),
    house_context: Optional[int] = Depends(get_house_context),
    current_user: User = Depends(has_permission(MANAGE)),
):
    template = await svc.get_template(db, template_id)
    version = await svc.add_version(
        db,
        template,
        house_id=house_context,
        user=current_user,
        content_json=payload.content_json,
        variables_schema=payload.variables_schema,
        version_notes=payload.version_notes,
        publish=payload.publish,
    )
    await _audit(
        db, request, current_user, "edit", template,
        new_values={"version": version.version_number, "published": version.is_published},
    )
    await db.commit()
    await db.refresh(version)
    return {"success": True, "data": svc.serialize_version(version, include_content=True)}


@router.get("/templates/{template_id}/versions/{version_number}")
async def get_version(
    template_id: int,
    version_number: int,
    db: AsyncSession = Depends(get_db),
    house_context: Optional[int] = Depends(get_house_context),
    current_user: User = Depends(has_permission(VIEW)),
):
    template = await svc.get_template(db, template_id)
    svc.assert_template_readable(template, house_context)
    version = await svc.get_version(db, template.id, version_number)
    return {"success": True, "data": svc.serialize_version(version, include_content=True)}


@router.post("/templates/{template_id}/versions/{version_number}/publish")
async def publish_version(
    template_id: int,
    version_number: int,
    request: Request,
    db: AsyncSession = Depends(get_db),
    house_context: Optional[int] = Depends(get_house_context),
    current_user: User = Depends(has_permission(MANAGE)),
):
    template = await svc.get_template(db, template_id)
    version = await svc.get_version(db, template.id, version_number)
    await svc.publish_version(db, template, version, house_id=house_context, user=current_user)
    await _audit(
        db, request, current_user, "publish", template,
        new_values={"version": version.version_number},
    )
    await db.commit()
    return {"success": True, "data": svc.serialize_version(version)}


# --------------------------------------------------------------------------- #
# Preview
# --------------------------------------------------------------------------- #

@router.post("/render/preview")
async def render_preview(
    payload: TemplatePreviewIn,
    db: AsyncSession = Depends(get_db),
    house_context: Optional[int] = Depends(get_house_context),
    current_user: User = Depends(has_permission(VIEW)),
):
    """Render a template as HTML for the in-app preview (no PDF, no fonts)."""
    template = await svc.get_template(db, payload.template_id)
    svc.assert_template_readable(template, house_context)

    if payload.version_number is not None:
        version = await svc.get_version(db, template.id, payload.version_number)
    else:
        version = await svc.latest_version(db, template.id, published_only=True)
        version = version or await svc.latest_version(db, template.id)
    if version is None:
        raise HTTPException(
            status_code=404,
            detail={"code": "VERSION_NOT_FOUND", "message": "This template has no version"},
        )

    # A global template previewed without a house still resolves the global
    # letterhead/signatory (scope 0 matches no house row).
    scope_house_id = house_context or 0
    letterhead = await svc.resolve_letterhead(db, scope_house_id)
    signatory = await svc.resolve_signatory(
        db, house_id=scope_house_id, signatory_id=payload.signatory_id
    )

    fields = (version.variables_schema or {}).get("fields", [])
    values = dict(document_render.preview_values(fields))
    values.update({key: str(value) for key, value in payload.values.items()})
    context, missing = document_render.resolve_context(
        fields, values, signatory=signatory
    )
    html_document = document_render.render_html(
        version.content_json,
        context,
        letterhead=letterhead,
        signatory=signatory,
        title=template.name,
        embed_fonts=False,
    )
    return {
        "success": True,
        "data": {
            "template_id": template.id,
            "version_number": version.version_number,
            "html": html_document,
            "missing": missing,
        },
    }
