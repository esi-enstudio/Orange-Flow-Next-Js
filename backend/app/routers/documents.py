"""Document Automation API: templates, branding assets, signatories and PDFs.

Authorization
-------------
* Template reads/writes require the corresponding ``documents.templates.*``
  permission. Letterhead and signatory routes use their dedicated manage
  permissions.
* Global assets are readable by authorized users but writable only by a super
  admin. House assets are scoped by the authorized ``X-House-ID`` context.
* House scope is never accepted from an asset request body.
"""

import logging
import hashlib
import re
import uuid
from datetime import date, datetime, time, timedelta
from typing import Literal, Optional

from fastapi import APIRouter, Depends, File, HTTPException, Query, Request, UploadFile, status
from fastapi.responses import FileResponse
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.documents import (
    DocumentLetterhead,
    DocumentSignatory,
    DocumentTemplate,
    DocumentTemplateVersion,
    DocumentType,
    DocumentVersion,
    GeneratedDocument,
)
from app.models.activity_log import ActivityLog
from app.models.employee import Employee
from app.models.house import House
from app.models.user import User
from app.routers.deps import (
    get_db,
    get_house_context,
    has_any_permission,
    has_permission,
    require_house_context,
)
from app.schemas.documents import (
    DocumentLetterheadCreateIn,
    DocumentLetterheadUpdateIn,
    DocumentSignatoryCreateIn,
    DocumentSignatoryUpdateIn,
    GeneratedDocumentCreateIn,
    GeneratedDocumentUpdateIn,
    TemplateCreateIn,
    TemplateDuplicateIn,
    TemplatePreviewIn,
    TemplateUpdateIn,
    TemplateVersionIn,
)
from app.services import document_assets
from app.services import document_ast, document_render
from app.services import document_numbering, document_pdf
from app.services import document_service as svc
from app.utils.activity_logger import log_activity
from app.utils.access_control import is_super_admin_user
from app.utils.timezone import now_naive

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


async def _audit_asset(
    db: AsyncSession,
    request: Request,
    user: User,
    action: str,
    resource: str,
    record,
    *,
    old_values: Optional[dict] = None,
    new_values: Optional[dict] = None,
) -> None:
    await log_activity(
        db,
        user_id=user.id,
        user_name=getattr(user, "name", None),
        module="documents",
        action=action,
        record_id=record.id,
        record_identifier=f"{resource}: {record.name}",
        old_values=old_values,
        new_values=new_values,
        request=request,
        status_code=200,
        commit=False,
    )


async def _audit_document(
    db: AsyncSession,
    request: Request,
    user: User,
    action: str,
    document: GeneratedDocument,
    *,
    old_values: Optional[dict] = None,
    new_values: Optional[dict] = None,
) -> None:
    await log_activity(
        db,
        user_id=user.id,
        user_name=getattr(user, "name", None),
        module="documents",
        action=action,
        record_id=document.id,
        record_identifier=document.document_number,
        old_values=old_values,
        new_values=new_values,
        request=request,
        status_code=200,
        commit=False,
    )


def _serialize_document(document: GeneratedDocument) -> dict:
    return {
        "id": document.id,
        "document_number": document.document_number,
        "document_type_id": document.document_type_id,
        "template_id": document.template_id,
        "template_version_id": document.template_version_id,
        "letterhead_id": document.letterhead_id,
        "signatory_id": document.signatory_id,
        "house_id": document.house_id,
        "employee_id": document.employee_id,
        "document_title": document.document_title,
        "document_data": document.document_data or {},
        "status": document.status,
        "current_version": document.current_version,
        "created_at": document.created_at.isoformat() if document.created_at else None,
        "updated_at": document.updated_at.isoformat() if document.updated_at else None,
    }


def _serialize_document_version(version: DocumentVersion) -> dict:
    return {
        "id": version.id,
        "document_id": version.document_id,
        "version_number": version.version_number,
        "template_version_id": version.template_version_id,
        "file_checksum": version.file_checksum,
        "file_size": version.file_size,
        "generated_at": version.generated_at.isoformat() if version.generated_at else None,
        "generated_by": version.generated_by,
        "download_url": (
            f"/api/v1/documents/{version.document_id}/versions/"
            f"{version.version_number}/download"
        ),
    }


async def _document_for_house(
    db: AsyncSession,
    document_id: int,
    house_id: int,
    *,
    lock: bool = False,
) -> GeneratedDocument:
    query = select(GeneratedDocument).where(
        GeneratedDocument.id == document_id,
        GeneratedDocument.house_id == house_id,
    )
    if lock:
        query = query.with_for_update()
    document = (await db.execute(query)).scalar_one_or_none()
    if document is None:
        raise HTTPException(
            status_code=404,
            detail={"code": "DOCUMENT_NOT_FOUND", "message": "Document not found"},
        )
    return document


def _record_filters(
    *,
    house_id: int,
    status_filter: Optional[str],
    document_type_id: Optional[int],
    from_date: Optional[date],
    to_date: Optional[date],
    search: Optional[str],
) -> list:
    filters = [GeneratedDocument.house_id == house_id]
    if status_filter:
        filters.append(GeneratedDocument.status == status_filter)
    if document_type_id is not None:
        filters.append(GeneratedDocument.document_type_id == document_type_id)
    if from_date:
        filters.append(
            GeneratedDocument.created_at >= datetime.combine(from_date, time.min)
        )
    if to_date:
        filters.append(
            GeneratedDocument.created_at
            < datetime.combine(to_date + timedelta(days=1), time.min)
        )
    if search and search.strip():
        term = f"%{search.strip()}%"
        filters.append(
            or_(
                GeneratedDocument.document_number.ilike(term),
                GeneratedDocument.document_title.ilike(term),
                Employee.employee_name.ilike(term),
                DocumentType.name.ilike(term),
                DocumentType.name_bn.ilike(term),
            )
        )
    return filters


def _serialize_record_row(row) -> dict:
    document, type_name, type_name_bn, employee_name = row
    return {
        **_serialize_document(document),
        "document_type_name": type_name,
        "document_type_name_bn": type_name_bn,
        "employee_name": employee_name,
    }


@router.get("/records")
async def list_generated_document_records(
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=100),
    search: Optional[str] = Query(None, max_length=100),
    status_filter: Optional[Literal["DRAFT", "GENERATED", "VOID"]] = Query(
        None, alias="status"
    ),
    document_type_id: Optional[int] = Query(None, ge=1),
    from_date: Optional[date] = Query(None),
    to_date: Optional[date] = Query(None),
    db: AsyncSession = Depends(get_db),
    house_context: int = Depends(require_house_context),
    current_user: User = Depends(has_permission(VIEW)),
):
    filters = _record_filters(
        house_id=house_context,
        status_filter=status_filter,
        document_type_id=document_type_id,
        from_date=from_date,
        to_date=to_date,
        search=search,
    )
    total = (
        await db.execute(
            select(func.count(GeneratedDocument.id))
            .join(DocumentType, DocumentType.id == GeneratedDocument.document_type_id)
            .outerjoin(Employee, Employee.id == GeneratedDocument.employee_id)
            .where(*filters)
        )
    ).scalar_one()
    rows = (
        await db.execute(
            select(
                GeneratedDocument,
                DocumentType.name,
                DocumentType.name_bn,
                Employee.employee_name,
            )
            .join(DocumentType, DocumentType.id == GeneratedDocument.document_type_id)
            .outerjoin(Employee, Employee.id == GeneratedDocument.employee_id)
            .where(*filters)
            .order_by(GeneratedDocument.created_at.desc(), GeneratedDocument.id.desc())
            .offset((page - 1) * per_page)
            .limit(per_page)
        )
    ).all()
    total_pages = (total + per_page - 1) // per_page
    return {
        "success": True,
        "data": [_serialize_record_row(row) for row in rows],
        "pagination": {
            "page": page,
            "per_page": per_page,
            "total": total,
            "total_pages": total_pages,
            "has_next": page < total_pages,
            "has_prev": page > 1,
        },
    }


@router.get("/records/summary")
async def generated_document_summary(
    db: AsyncSession = Depends(get_db),
    house_context: int = Depends(require_house_context),
    current_user: User = Depends(has_permission(VIEW)),
):
    rows = (
        await db.execute(
            select(GeneratedDocument.status, func.count(GeneratedDocument.id))
            .where(GeneratedDocument.house_id == house_context)
            .group_by(GeneratedDocument.status)
        )
    ).all()
    counts = {status: count for status, count in rows}
    return {
        "success": True,
        "data": {
            "total": sum(counts.values()),
            "draft": counts.get("DRAFT", 0),
            "generated": counts.get("GENERATED", 0),
            "void": counts.get("VOID", 0),
        },
    }


@router.get("/records/{document_id}/audit")
async def generated_document_audit(
    document_id: int,
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
    house_context: int = Depends(require_house_context),
    current_user: User = Depends(has_permission("documents.audit.view")),
):
    document = await _document_for_house(db, document_id, house_context)
    filters = (
        ActivityLog.module == "documents",
        ActivityLog.record_id == document.id,
    )
    total = (
        await db.execute(
            select(func.count(ActivityLog.id)).where(*filters)
        )
    ).scalar_one()
    logs = (
        await db.execute(
            select(ActivityLog)
            .where(*filters)
            .order_by(ActivityLog.created_at.desc(), ActivityLog.id.desc())
            .offset((page - 1) * per_page)
            .limit(per_page)
        )
    ).scalars().all()
    total_pages = (total + per_page - 1) // per_page
    return {
        "success": True,
        "data": [
            {
                "id": log.id,
                "action": log.action,
                "user_name": log.user_name,
                "record_identifier": log.record_identifier,
                "created_at": log.created_at.isoformat() if log.created_at else None,
                "old_values": log.old_values,
                "new_values": log.new_values,
            }
            for log in logs
        ],
        "pagination": {
            "page": page,
            "per_page": per_page,
            "total": total,
            "total_pages": total_pages,
            "has_next": page < total_pages,
            "has_prev": page > 1,
        },
    }


async def _employee_for_house(
    db: AsyncSession,
    employee_id: Optional[int],
    house_id: int,
) -> Optional[Employee]:
    if employee_id is None:
        return None
    employee = (
        await db.execute(
            select(Employee).where(
                Employee.id == employee_id,
                Employee.house_id == house_id,
            )
        )
    ).scalar_one_or_none()
    if employee is None:
        raise HTTPException(
            status_code=404,
            detail={"code": "EMPLOYEE_NOT_FOUND", "message": "Employee not found in the selected house"},
        )
    return employee


async def _template_and_version(
    db: AsyncSession,
    template_id: int,
    house_id: int,
    *,
    expected_type_id: Optional[int] = None,
) -> tuple[DocumentTemplate, DocumentTemplateVersion]:
    template = await svc.get_template(db, template_id)
    if template.house_id is not None and template.house_id != house_id:
        raise HTTPException(
            status_code=403,
            detail={"code": "TEMPLATE_FORBIDDEN", "message": "This template belongs to another house"},
        )
    if not template.is_active:
        raise HTTPException(
            status_code=422,
            detail={"code": "TEMPLATE_INACTIVE", "message": "This template is inactive"},
        )
    if expected_type_id is not None and template.document_type_id != expected_type_id:
        raise HTTPException(
            status_code=422,
            detail={"code": "TEMPLATE_TYPE_MISMATCH", "message": "The template does not match the document type"},
        )
    version = await svc.latest_version(db, template.id, published_only=True)
    if version is None:
        raise HTTPException(
            status_code=422,
            detail={"code": "TEMPLATE_NOT_PUBLISHED", "message": "Publish a template version before creating a document"},
        )
    return template, version


def _clean_document_data(fields: list, values: dict) -> dict:
    by_key = {field["key"]: field for field in fields}
    unknown = set(values) - by_key.keys()
    readonly = {key for key in values if by_key.get(key, {}).get("readonly")}
    if unknown or readonly:
        invalid = sorted(unknown | readonly)
        raise HTTPException(
            status_code=422,
            detail={
                "code": "INVALID_DOCUMENT_DATA",
                "message": "Document data contains unknown or read-only fields",
                "fields": {key: "This field cannot be supplied" for key in invalid},
            },
        )
    cleaned = {}
    errors = {}
    for key, raw_value in values.items():
        value = raw_value.strip()
        if len(value) > 10_000:
            errors[key] = "Value must be 10,000 characters or fewer"
            continue
        field = by_key[key]
        if value and field.get("type") == "date":
            try:
                date.fromisoformat(value)
            except ValueError:
                errors[key] = "Enter a valid date"
                continue
        if value and field.get("type") == "select" and value not in field.get("options", []):
            errors[key] = "Choose one of the available options"
            continue
        cleaned[key] = value
    if errors:
        raise HTTPException(
            status_code=422,
            detail={
                "code": "INVALID_DOCUMENT_DATA",
                "message": "One or more document fields are invalid",
                "fields": errors,
            },
        )
    return cleaned


def _validate_required_fields(fields: list, context: dict) -> None:
    missing = [
        field["key"]
        for field in fields
        if field.get("required") and not str(context.get(field["key"], "")).strip()
    ]
    if missing:
        raise HTTPException(
            status_code=422,
            detail={
                "code": "DOCUMENT_FIELDS_REQUIRED",
                "message": "Complete all required document fields before generating",
                "fields": {key: "This field is required" for key in missing},
            },
        )


async def _render_document_version(
    db: AsyncSession,
    document: GeneratedDocument,
    house: House,
    employee: Optional[Employee],
    user: User,
    request: Request,
    *,
    allocate_number: bool,
) -> DocumentVersion:
    document_type = await db.get(DocumentType, document.document_type_id)
    if document_type is None or document_type.is_deleted or not document_type.is_active:
        raise HTTPException(
            status_code=422,
            detail={"code": "DOCUMENT_TYPE_UNAVAILABLE", "message": "This document type is no longer available"},
        )
    template_version = await db.get(DocumentTemplateVersion, document.template_version_id)
    if template_version is None:
        raise HTTPException(
            status_code=422,
            detail={"code": "TEMPLATE_VERSION_MISSING", "message": "The saved template version is unavailable"},
        )
    template = await db.get(DocumentTemplate, document.template_id)
    if template is None:
        raise HTTPException(status_code=422, detail={"code": "TEMPLATE_MISSING", "message": "The saved template is unavailable"})

    version_number = document.current_version + 1
    if allocate_number:
        document.document_number = await document_numbering.allocate_document_number(
            db,
            house_id=document.house_id,
            document_type_id=document.document_type_id,
            year=now_naive().year,
            prefix=document_type.number_prefix,
        )

    letterhead = await svc.resolve_letterhead(
        db, document.house_id, letterhead_id=document.letterhead_id
    )
    signatory = await svc.resolve_signatory(
        db, house_id=document.house_id, signatory_id=document.signatory_id
    )
    fields = (template_version.variables_schema or {}).get("fields", [])
    document_data = dict(document.document_data or {})
    document_data["document_date"] = document_data.get("document_date") or now_naive().date().isoformat()
    document_data["document_title"] = document.document_title
    context, _missing = document_render.resolve_context(
        fields,
        document_data,
        employee=employee,
        house=house,
        document={
            "document_number": document.document_number,
            "document_date": document_data["document_date"],
            "document_title": document.document_title,
        },
        signatory=signatory,
    )
    _validate_required_fields(fields, context)
    html_document = document_render.render_html(
        template_version.content_json,
        context,
        letterhead=letterhead,
        signatory=signatory,
        title=document.document_title,
    )
    stored_path = None
    document_id = document.id
    try:
        pdf_bytes = await document_pdf.render_pdf(html_document)
        stored_path = document_pdf.store_pdf(document_id=document_id, content=pdf_bytes)
    except Exception as exc:
        await db.rollback()
        if stored_path:
            document_pdf.remove_pdf(stored_path)
        logger.exception("Document PDF generation failed for document %s", document_id)
        raise HTTPException(
            status_code=500,
            detail={
                "code": "PDF_GENERATION_FAILED",
                "message": "The PDF could not be generated. No document number was consumed.",
            },
        ) from exc

    document.document_data = document_data
    document.status = "GENERATED"
    document.current_version = version_number
    document.updated_by = user.id
    version = DocumentVersion(
        document_id=document.id,
        version_number=version_number,
        pdf_path=stored_path,
        html_snapshot=html_document,
        document_data_snapshot=document_data,
        template_version_id=template_version.id,
        letterhead_snapshot=svc.snapshot_letterhead(letterhead),
        signatory_snapshot=svc.snapshot_signatory(signatory),
        file_checksum=hashlib.sha256(pdf_bytes).hexdigest(),
        file_size=len(pdf_bytes),
        generated_by=user.id,
    )
    db.add(version)
    try:
        await db.flush()
        await _audit_document(
            db, request, user, "generate" if allocate_number else "regenerate", document,
            new_values={
                "document_number": document.document_number,
                "version": version_number,
                "sha256": version.file_checksum,
            },
        )
    except Exception:
        await db.rollback()
        document_pdf.remove_pdf(stored_path)
        raise
    try:
        await db.commit()
    except Exception:
        # A failed/ambiguous commit leaves the immutable file in place rather
        # than risking a committed row that points to a deleted PDF.
        await db.rollback()
        raise
    await db.refresh(document)
    await db.refresh(version)
    return version


def _asset_query(model, house_context: Optional[int]):
    query = select(model).where(model.is_deleted.is_(False))
    if house_context is None:
        return query.where(model.house_id.is_(None))
    return query.where(or_(model.house_id.is_(None), model.house_id == house_context))


def _write_scope(scope: str, house_context: Optional[int], user: User) -> Optional[int]:
    if scope == "global":
        if not is_super_admin_user(user):
            raise HTTPException(
                status_code=403,
                detail={"code": "GLOBAL_DOCUMENT_ASSET_FORBIDDEN", "message": "Only a super admin can manage global assets"},
            )
        return None
    if house_context is None:
        raise HTTPException(
            status_code=400,
            detail={"code": "HOUSE_CONTEXT_REQUIRED", "message": "Select a house before managing house assets"},
        )
    return house_context


async def _get_asset_for_scope(db: AsyncSession, model, asset_id: int, house_context: Optional[int]):
    asset = await db.get(model, asset_id)
    if asset is None or asset.is_deleted:
        raise HTTPException(status_code=404, detail={"code": "DOCUMENT_ASSET_NOT_FOUND", "message": "Document asset not found"})
    if asset.house_id is not None and asset.house_id != house_context:
        raise HTTPException(status_code=404, detail={"code": "DOCUMENT_ASSET_NOT_FOUND", "message": "Document asset not found"})
    return asset


async def _set_scope_default(
    db: AsyncSession,
    model,
    house_id: Optional[int],
    *,
    exclude_id: Optional[int] = None,
) -> None:
    scope = model.house_id.is_(None) if house_id is None else model.house_id == house_id
    query = select(model).where(
        scope,
        model.is_deleted.is_(False),
        model.is_active.is_(True),
        model.is_default.is_(True),
    )
    if exclude_id is not None:
        query = query.where(model.id != exclude_id)
    rows = (await db.execute(query.with_for_update())).scalars().all()
    for row in rows:
        row.is_default = False


def _validate_asset_values(payload: dict) -> None:
    email = payload.get("email")
    if email and not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", email):
        raise HTTPException(
            status_code=422,
            detail={"code": "INVALID_EMAIL", "message": "Enter a valid email address"},
        )
    phones = payload.get("phone_numbers")
    if phones is not None and any(len(phone) > 30 for phone in phones):
        raise HTTPException(
            status_code=422,
            detail={"code": "INVALID_PHONE", "message": "Phone numbers must be 30 characters or fewer"},
        )


# --------------------------------------------------------------------------- #
# Types & variables
# --------------------------------------------------------------------------- #

@router.get("/types")
async def list_document_types(
    include_inactive: bool = Query(False),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_any_permission([VIEW, "documents.create"])),
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

@router.get("/letterheads")
async def list_document_letterheads(
    db: AsyncSession = Depends(get_db),
    house_context: Optional[int] = Depends(get_house_context),
    current_user: User = Depends(has_permission("documents.letterheads.manage")),
):
    rows = (
        await db.execute(
            _asset_query(DocumentLetterhead, house_context).order_by(
                DocumentLetterhead.house_id.is_not(None),
                DocumentLetterhead.name,
            )
        )
    ).scalars().all()
    return {"success": True, "data": [svc.serialize_letterhead(row) for row in rows]}


@router.post("/letterheads", status_code=status.HTTP_201_CREATED)
async def create_document_letterhead(
    payload: DocumentLetterheadCreateIn,
    request: Request,
    db: AsyncSession = Depends(get_db),
    house_context: Optional[int] = Depends(get_house_context),
    current_user: User = Depends(has_permission("documents.letterheads.manage")),
):
    values = payload.model_dump(exclude={"scope"})
    _validate_asset_values(values)
    if values["is_default"] and not values["is_active"]:
        raise HTTPException(status_code=422, detail={"code": "INACTIVE_DEFAULT", "message": "A default letterhead must be active"})
    house_id = _write_scope(payload.scope, house_context, current_user)
    if values["is_default"]:
        await _set_scope_default(db, DocumentLetterhead, house_id)
    letterhead = DocumentLetterhead(
        house_id=house_id,
        created_by=current_user.id,
        updated_by=current_user.id,
        **values,
    )
    db.add(letterhead)
    await db.flush()
    await _audit_asset(
        db, request, current_user, "create", "letterhead", letterhead,
        new_values=values,
    )
    await db.commit()
    await db.refresh(letterhead)
    return {"success": True, "data": svc.serialize_letterhead(letterhead)}


@router.get("/letterheads/{letterhead_id}")
async def get_document_letterhead(
    letterhead_id: int,
    db: AsyncSession = Depends(get_db),
    house_context: Optional[int] = Depends(get_house_context),
    current_user: User = Depends(has_permission("documents.letterheads.manage")),
):
    letterhead = await _get_asset_for_scope(db, DocumentLetterhead, letterhead_id, house_context)
    return {"success": True, "data": svc.serialize_letterhead(letterhead)}


@router.patch("/letterheads/{letterhead_id}")
async def update_document_letterhead(
    letterhead_id: int,
    payload: DocumentLetterheadUpdateIn,
    request: Request,
    db: AsyncSession = Depends(get_db),
    house_context: Optional[int] = Depends(get_house_context),
    current_user: User = Depends(has_permission("documents.letterheads.manage")),
):
    letterhead = await _get_asset_for_scope(db, DocumentLetterhead, letterhead_id, house_context)
    _write_scope("global" if letterhead.house_id is None else "house", house_context, current_user)
    values = payload.model_dump(exclude_unset=True)
    _validate_asset_values(values)
    if values.get("is_default") is True and values.get("is_active", letterhead.is_active) is False:
        raise HTTPException(status_code=422, detail={"code": "INACTIVE_DEFAULT", "message": "A default letterhead must be active"})
    if values.get("is_active") is False and letterhead.is_default:
        values["is_default"] = False
    if values.get("is_default") is True:
        await _set_scope_default(db, DocumentLetterhead, letterhead.house_id, exclude_id=letterhead.id)
    old_values = {key: getattr(letterhead, key) for key in values}
    for key, value in values.items():
        setattr(letterhead, key, value)
    letterhead.updated_by = current_user.id
    await _audit_asset(
        db, request, current_user, "edit", "letterhead", letterhead,
        old_values=old_values, new_values=values,
    )
    await db.commit()
    await db.refresh(letterhead)
    return {"success": True, "data": svc.serialize_letterhead(letterhead)}


@router.delete("/letterheads/{letterhead_id}")
async def delete_document_letterhead(
    letterhead_id: int,
    request: Request,
    db: AsyncSession = Depends(get_db),
    house_context: Optional[int] = Depends(get_house_context),
    current_user: User = Depends(has_permission("documents.letterheads.manage")),
):
    letterhead = await _get_asset_for_scope(db, DocumentLetterhead, letterhead_id, house_context)
    _write_scope("global" if letterhead.house_id is None else "house", house_context, current_user)
    previous = svc.snapshot_letterhead(letterhead)
    letterhead.is_deleted = True
    letterhead.deleted_at = now_naive()
    letterhead.deleted_by = current_user.id
    letterhead.is_default = False
    await _audit_asset(
        db, request, current_user, "delete", "letterhead", letterhead,
        old_values=previous,
    )
    await db.commit()
    return {"success": True, "data": {"id": letterhead.id, "deleted": True}}


@router.post("/letterheads/{letterhead_id}/logo")
async def upload_document_letterhead_logo(
    letterhead_id: int,
    request: Request,
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    house_context: Optional[int] = Depends(get_house_context),
    current_user: User = Depends(has_permission("documents.letterheads.manage")),
):
    letterhead = await _get_asset_for_scope(db, DocumentLetterhead, letterhead_id, house_context)
    _write_scope("global" if letterhead.house_id is None else "house", house_context, current_user)
    try:
        path = await document_assets.store_image(
            file, house_id=letterhead.house_id, resource="letterheads", record_id=letterhead.id
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail={"code": "INVALID_IMAGE", "message": str(exc)}) from exc
    previous = letterhead.logo_path
    letterhead.logo_path = path
    letterhead.updated_by = current_user.id
    try:
        await _audit_asset(
            db, request, current_user, "edit", "letterhead", letterhead,
            old_values={"logo_path": previous}, new_values={"logo_path": path},
        )
        await db.commit()
    except Exception:
        await db.rollback()
        document_assets.remove_image(path)
        raise
    await db.refresh(letterhead)
    return {"success": True, "data": svc.serialize_letterhead(letterhead)}


@router.get("/letterheads/{letterhead_id}/logo")
async def stream_document_letterhead_logo(
    letterhead_id: int,
    db: AsyncSession = Depends(get_db),
    house_context: Optional[int] = Depends(get_house_context),
    current_user: User = Depends(has_permission("documents.letterheads.manage")),
):
    letterhead = await _get_asset_for_scope(db, DocumentLetterhead, letterhead_id, house_context)
    path = document_assets.image_fs_path(letterhead.logo_path)
    if not path:
        raise HTTPException(status_code=404, detail={"code": "IMAGE_NOT_FOUND", "message": "Letterhead logo not found"})
    return FileResponse(path, media_type="image/jpeg", headers={"Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff"})


@router.get("/signatories")
async def list_document_signatories(
    db: AsyncSession = Depends(get_db),
    house_context: Optional[int] = Depends(get_house_context),
    current_user: User = Depends(has_permission("documents.signatories.manage")),
):
    rows = (
        await db.execute(
            _asset_query(DocumentSignatory, house_context).order_by(
                DocumentSignatory.house_id.is_not(None),
                DocumentSignatory.name,
            )
        )
    ).scalars().all()
    return {"success": True, "data": [svc.serialize_signatory(row) for row in rows]}


@router.post("/signatories", status_code=status.HTTP_201_CREATED)
async def create_document_signatory(
    payload: DocumentSignatoryCreateIn,
    request: Request,
    db: AsyncSession = Depends(get_db),
    house_context: Optional[int] = Depends(get_house_context),
    current_user: User = Depends(has_permission("documents.signatories.manage")),
):
    values = payload.model_dump(exclude={"scope"})
    if values["is_default"] and not values["is_active"]:
        raise HTTPException(status_code=422, detail={"code": "INACTIVE_DEFAULT", "message": "A default signatory must be active"})
    house_id = _write_scope(payload.scope, house_context, current_user)
    if values["is_default"]:
        await _set_scope_default(db, DocumentSignatory, house_id)
    signatory = DocumentSignatory(
        house_id=house_id,
        created_by=current_user.id,
        updated_by=current_user.id,
        **values,
    )
    db.add(signatory)
    await db.flush()
    await _audit_asset(
        db, request, current_user, "create", "signatory", signatory,
        new_values=values,
    )
    await db.commit()
    await db.refresh(signatory)
    return {"success": True, "data": svc.serialize_signatory(signatory)}


@router.get("/signatories/{signatory_id}")
async def get_document_signatory(
    signatory_id: int,
    db: AsyncSession = Depends(get_db),
    house_context: Optional[int] = Depends(get_house_context),
    current_user: User = Depends(has_permission("documents.signatories.manage")),
):
    signatory = await _get_asset_for_scope(db, DocumentSignatory, signatory_id, house_context)
    return {"success": True, "data": svc.serialize_signatory(signatory)}


@router.patch("/signatories/{signatory_id}")
async def update_document_signatory(
    signatory_id: int,
    payload: DocumentSignatoryUpdateIn,
    request: Request,
    db: AsyncSession = Depends(get_db),
    house_context: Optional[int] = Depends(get_house_context),
    current_user: User = Depends(has_permission("documents.signatories.manage")),
):
    signatory = await _get_asset_for_scope(db, DocumentSignatory, signatory_id, house_context)
    _write_scope("global" if signatory.house_id is None else "house", house_context, current_user)
    values = payload.model_dump(exclude_unset=True)
    if values.get("is_default") is True and values.get("is_active", signatory.is_active) is False:
        raise HTTPException(status_code=422, detail={"code": "INACTIVE_DEFAULT", "message": "A default signatory must be active"})
    if values.get("is_active") is False and signatory.is_default:
        values["is_default"] = False
    if values.get("is_default") is True:
        await _set_scope_default(db, DocumentSignatory, signatory.house_id, exclude_id=signatory.id)
    old_values = {key: getattr(signatory, key) for key in values}
    for key, value in values.items():
        setattr(signatory, key, value)
    signatory.updated_by = current_user.id
    await _audit_asset(
        db, request, current_user, "edit", "signatory", signatory,
        old_values=old_values, new_values=values,
    )
    await db.commit()
    await db.refresh(signatory)
    return {"success": True, "data": svc.serialize_signatory(signatory)}


@router.delete("/signatories/{signatory_id}")
async def delete_document_signatory(
    signatory_id: int,
    request: Request,
    db: AsyncSession = Depends(get_db),
    house_context: Optional[int] = Depends(get_house_context),
    current_user: User = Depends(has_permission("documents.signatories.manage")),
):
    signatory = await _get_asset_for_scope(db, DocumentSignatory, signatory_id, house_context)
    _write_scope("global" if signatory.house_id is None else "house", house_context, current_user)
    previous = svc.snapshot_signatory(signatory)
    signatory.is_deleted = True
    signatory.deleted_at = now_naive()
    signatory.deleted_by = current_user.id
    signatory.is_default = False
    await _audit_asset(
        db, request, current_user, "delete", "signatory", signatory,
        old_values=previous,
    )
    await db.commit()
    return {"success": True, "data": {"id": signatory.id, "deleted": True}}


@router.post("/signatories/{signatory_id}/signature")
async def upload_document_signatory_signature(
    signatory_id: int,
    request: Request,
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    house_context: Optional[int] = Depends(get_house_context),
    current_user: User = Depends(has_permission("documents.signatories.manage")),
):
    signatory = await _get_asset_for_scope(db, DocumentSignatory, signatory_id, house_context)
    _write_scope("global" if signatory.house_id is None else "house", house_context, current_user)
    try:
        path = await document_assets.store_image(
            file, house_id=signatory.house_id, resource="signatories", record_id=signatory.id
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail={"code": "INVALID_IMAGE", "message": str(exc)}) from exc
    previous = signatory.signature_path
    signatory.signature_path = path
    signatory.updated_by = current_user.id
    try:
        await _audit_asset(
            db, request, current_user, "edit", "signatory", signatory,
            old_values={"signature_path": previous}, new_values={"signature_path": path},
        )
        await db.commit()
    except Exception:
        await db.rollback()
        document_assets.remove_image(path)
        raise
    await db.refresh(signatory)
    return {"success": True, "data": svc.serialize_signatory(signatory)}


@router.get("/signatories/{signatory_id}/signature")
async def stream_document_signatory_signature(
    signatory_id: int,
    db: AsyncSession = Depends(get_db),
    house_context: Optional[int] = Depends(get_house_context),
    current_user: User = Depends(has_permission("documents.signatories.manage")),
):
    signatory = await _get_asset_for_scope(db, DocumentSignatory, signatory_id, house_context)
    path = document_assets.image_fs_path(signatory.signature_path)
    if not path:
        raise HTTPException(status_code=404, detail={"code": "IMAGE_NOT_FOUND", "message": "Signatory signature not found"})
    return FileResponse(path, media_type="image/jpeg", headers={"Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff"})

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
    current_user: User = Depends(has_any_permission([VIEW, "documents.create"])),
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
    current_user: User = Depends(has_any_permission([VIEW, "documents.create"])),
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
    current_user: User = Depends(has_any_permission([VIEW, "documents.create"])),
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

    scope_house_id = house_context or 0
    house = await db.get(House, house_context) if house_context is not None else None
    employee = await _employee_for_house(db, payload.employee_id, scope_house_id)
    letterhead = await svc.resolve_letterhead(
        db, scope_house_id, letterhead_id=payload.letterhead_id
    )
    signatory = await svc.resolve_signatory(
        db, house_id=scope_house_id, signatory_id=payload.signatory_id
    )

    fields = (version.variables_schema or {}).get("fields", [])
    values = dict(document_render.preview_values(fields))
    submitted = {**payload.document_data, **payload.values}
    values.update(_clean_document_data(fields, submitted))
    preview_date = values.get("document_date") or now_naive().date().isoformat()
    context, missing = document_render.resolve_context(
        fields,
        values,
        employee=employee,
        house=house,
        document={
            "document_number": "PREVIEW",
            "document_date": preview_date,
            "document_title": template.name,
        },
        signatory=signatory,
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


@router.get("/employees/search")
async def search_document_employees(
    q: str = Query(..., min_length=2, max_length=100),
    limit: int = Query(20, ge=1, le=50),
    db: AsyncSession = Depends(get_db),
    house_context: Optional[int] = Depends(get_house_context),
    current_user: User = Depends(has_permission("documents.create")),
):
    if house_context is None:
        raise HTTPException(
            status_code=400,
            detail={"code": "HOUSE_CONTEXT_REQUIRED", "message": "Select a house before searching employees"},
        )
    term = f"%{q.strip()}%"
    rows = (
        await db.execute(
            select(Employee)
            .where(
                Employee.house_id == house_context,
                or_(
                    Employee.employee_name.ilike(term),
                    Employee.dms_code.ilike(term),
                    Employee.employee_id.ilike(term),
                    Employee.itop_number.ilike(term),
                ),
            )
            .order_by(Employee.employee_name, Employee.id)
            .limit(limit)
        )
    ).scalars().all()
    return {
        "success": True,
        "data": [
            {
                "id": employee.id,
                "employee_name": employee.employee_name,
                "dms_code": employee.dms_code,
                "employee_id": employee.employee_id,
                "itop_number": employee.itop_number,
                "employee_type": employee.employee_type,
                "house_id": employee.house_id,
            }
            for employee in rows
        ],
    }


@router.get("/employees/{employee_id}")
async def get_document_employee(
    employee_id: int,
    db: AsyncSession = Depends(get_db),
    house_context: int = Depends(require_house_context),
    current_user: User = Depends(has_permission("documents.create")),
):
    employee = await _employee_for_house(db, employee_id, house_context)
    if employee is None:
        raise HTTPException(status_code=404, detail={"code": "EMPLOYEE_NOT_FOUND", "message": "Employee not found"})
    return {
        "success": True,
        "data": {
            "id": employee.id,
            "employee_name": employee.employee_name,
            "fathers_name": employee.fathers_name,
            "mothers_name": employee.mothers_name,
            "nid": employee.nid,
            "dob": employee.dob,
            "dms_code": employee.dms_code,
            "employee_id": employee.employee_id,
            "itop_number": employee.itop_number,
            "personal_number": employee.personal_number,
            "pool_number": employee.pool_number,
            "employee_type": employee.employee_type,
            "joining_date": employee.joining_date,
            "resigned_date": employee.resigned_date,
            "present_address": employee.present_address,
            "permanent_address": employee.permanent_address,
        },
    }


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_generated_document_draft(
    payload: GeneratedDocumentCreateIn,
    request: Request,
    db: AsyncSession = Depends(get_db),
    house_context: int = Depends(require_house_context),
    current_user: User = Depends(has_permission("documents.create")),
):
    template, template_version = await _template_and_version(
        db, payload.template_id, house_context
    )
    employee = await _employee_for_house(db, payload.employee_id, house_context)
    letterhead = await svc.resolve_letterhead(
        db, house_context, letterhead_id=payload.letterhead_id
    )
    signatory = await svc.resolve_signatory(
        db, house_id=house_context, signatory_id=payload.signatory_id
    )
    fields = (template_version.variables_schema or {}).get("fields", [])
    document_data = _clean_document_data(fields, payload.document_data)
    document_data.setdefault("document_date", now_naive().date().isoformat())
    title = (payload.document_title or template.name).strip()
    if not title:
        raise HTTPException(
            status_code=422,
            detail={"code": "DOCUMENT_TITLE_REQUIRED", "message": "Document title is required"},
        )
    document_type = await db.get(DocumentType, template.document_type_id)
    if document_type is None or document_type.is_deleted or not document_type.is_active:
        raise HTTPException(
            status_code=422,
            detail={"code": "DOCUMENT_TYPE_UNAVAILABLE", "message": "This document type is unavailable"},
        )

    document = GeneratedDocument(
        document_number=f"DRAFT-{uuid.uuid4().hex}",
        document_type_id=template.document_type_id,
        template_id=template.id,
        template_version_id=template_version.id,
        letterhead_id=letterhead.id if letterhead else None,
        signatory_id=signatory.id if signatory else None,
        house_id=house_context,
        employee_id=employee.id if employee else None,
        document_title=title,
        document_data=document_data,
        status="DRAFT",
        current_version=0,
        created_by=current_user.id,
        updated_by=current_user.id,
    )
    db.add(document)
    await db.flush()
    await _audit_document(
        db, request, current_user, "create", document,
        new_values={
            "document_title": title,
            "template_id": template.id,
            "employee_id": document.employee_id,
        },
    )
    await db.commit()
    await db.refresh(document)
    return {"success": True, "data": _serialize_document(document)}


@router.patch("/{document_id}")
async def update_generated_document_draft(
    document_id: int,
    payload: GeneratedDocumentUpdateIn,
    request: Request,
    db: AsyncSession = Depends(get_db),
    house_context: int = Depends(require_house_context),
    current_user: User = Depends(has_permission("documents.edit")),
):
    document = await _document_for_house(db, document_id, house_context, lock=True)
    if document.status != "DRAFT":
        raise HTTPException(
            status_code=409,
            detail={"code": "DOCUMENT_NOT_DRAFT", "message": "Only draft documents can be edited"},
        )
    values = payload.model_dump(exclude_unset=True)
    template_id = values.pop("template_id", document.template_id)
    template, template_version = await _template_and_version(
        db,
        template_id,
        house_context,
        expected_type_id=document.document_type_id if template_id == document.template_id else None,
    )
    if template.document_type_id != document.document_type_id:
        document.document_type_id = template.document_type_id
    fields = (template_version.variables_schema or {}).get("fields", [])
    employee_id = values.pop("employee_id", document.employee_id)
    employee = await _employee_for_house(db, employee_id, house_context)
    letterhead_id = values.pop("letterhead_id", document.letterhead_id)
    signatory_id = values.pop("signatory_id", document.signatory_id)
    letterhead = await svc.resolve_letterhead(
        db, house_context, letterhead_id=letterhead_id
    )
    signatory = await svc.resolve_signatory(
        db, house_id=house_context, signatory_id=signatory_id
    )
    submitted_data = values.pop("document_data", None)
    if submitted_data is not None:
        allowed_keys = {field["key"] for field in fields}
        retained = {
            key: value
            for key, value in (document.document_data or {}).items()
            if key in allowed_keys
        }
        merged_data = {**retained, **submitted_data}
        document.document_data = _clean_document_data(fields, merged_data)
    document.document_data = dict(document.document_data or {})
    if "document_date" in {field["key"] for field in fields}:
        document.document_data.setdefault("document_date", now_naive().date().isoformat())
    document.template_id = template.id
    document.template_version_id = template_version.id
    document.employee_id = employee.id if employee else None
    document.letterhead_id = letterhead.id if letterhead else None
    document.signatory_id = signatory.id if signatory else None
    if "document_title" in values:
        title = values["document_title"].strip()
        if not title:
            raise HTTPException(
                status_code=422,
                detail={"code": "DOCUMENT_TITLE_REQUIRED", "message": "Document title is required"},
            )
        document.document_title = title
    document.updated_by = current_user.id
    await _audit_document(
        db, request, current_user, "edit", document,
        new_values={
            "document_title": document.document_title,
            "template_id": template.id,
            "employee_id": document.employee_id,
            "document_data": document.document_data,
        },
    )
    await db.commit()
    await db.refresh(document)
    return {"success": True, "data": _serialize_document(document)}


@router.post("/records/{document_id}/generate")
@router.post("/{document_id}/generate")
async def generate_document(
    document_id: int,
    request: Request,
    db: AsyncSession = Depends(get_db),
    house_context: int = Depends(require_house_context),
    current_user: User = Depends(has_permission("documents.generate")),
):
    document = await _document_for_house(db, document_id, house_context, lock=True)
    if document.status != "DRAFT":
        raise HTTPException(
            status_code=409,
            detail={"code": "DOCUMENT_NOT_DRAFT", "message": "Only a draft can be generated"},
        )
    house = await db.get(House, house_context)
    if house is None:
        raise HTTPException(status_code=404, detail={"code": "HOUSE_NOT_FOUND", "message": "House not found"})
    employee = await _employee_for_house(db, document.employee_id, house_context)
    try:
        version = await _render_document_version(
            db, document, house, employee, current_user, request, allocate_number=True
        )
    except Exception:
        await db.rollback()
        raise
    return {
        "success": True,
        "data": {
            "document": _serialize_document(document),
            "version": _serialize_document_version(version),
        },
    }


@router.post("/records/{document_id}/regenerate")
@router.post("/{document_id}/regenerate")
async def regenerate_document(
    document_id: int,
    request: Request,
    db: AsyncSession = Depends(get_db),
    house_context: int = Depends(require_house_context),
    current_user: User = Depends(has_permission("documents.regenerate")),
):
    document = await _document_for_house(db, document_id, house_context, lock=True)
    if document.status != "GENERATED":
        raise HTTPException(
            status_code=409,
            detail={"code": "DOCUMENT_NOT_GENERATED", "message": "Only a generated document can be regenerated"},
        )
    house = await db.get(House, house_context)
    if house is None:
        raise HTTPException(status_code=404, detail={"code": "HOUSE_NOT_FOUND", "message": "House not found"})
    employee = await _employee_for_house(db, document.employee_id, house_context)
    try:
        version = await _render_document_version(
            db, document, house, employee, current_user, request, allocate_number=False
        )
    except Exception:
        await db.rollback()
        raise
    return {
        "success": True,
        "data": {
            "document": _serialize_document(document),
            "version": _serialize_document_version(version),
        },
    }


@router.post("/records/{document_id}/void")
@router.post("/{document_id}/void")
async def void_document(
    document_id: int,
    request: Request,
    db: AsyncSession = Depends(get_db),
    house_context: int = Depends(require_house_context),
    current_user: User = Depends(has_permission("documents.void")),
):
    document = await _document_for_house(db, document_id, house_context, lock=True)
    if document.status == "VOID":
        raise HTTPException(
            status_code=409,
            detail={"code": "DOCUMENT_ALREADY_VOID", "message": "This document is already void"},
        )
    previous_status = document.status
    document.status = "VOID"
    document.updated_by = current_user.id
    await _audit_document(
        db, request, current_user, "void", document,
        old_values={"status": previous_status},
        new_values={"status": "VOID"},
    )
    await db.commit()
    await db.refresh(document)
    return {"success": True, "data": _serialize_document(document)}


@router.get("/records/{document_id}")
@router.get("/{document_id}")
async def get_generated_document(
    document_id: int,
    db: AsyncSession = Depends(get_db),
    house_context: int = Depends(require_house_context),
    current_user: User = Depends(has_permission("documents.view")),
):
    document = await _document_for_house(db, document_id, house_context)
    versions = (
        await db.execute(
            select(DocumentVersion)
            .where(DocumentVersion.document_id == document.id)
            .order_by(DocumentVersion.version_number.desc())
        )
    ).scalars().all()
    document_type = await db.get(DocumentType, document.document_type_id)
    template = await db.get(DocumentTemplate, document.template_id)
    employee = await _employee_for_house(db, document.employee_id, house_context)
    return {
        "success": True,
        "data": {
            **_serialize_document(document),
            "document_type_name": document_type.name if document_type else None,
            "document_type_name_bn": document_type.name_bn if document_type else None,
            "template_name": template.name if template else None,
            "employee_name": employee.employee_name if employee else None,
            "versions": [_serialize_document_version(version) for version in versions],
        },
    }


@router.get("/records/{document_id}/versions/{version_number}/download")
@router.get("/{document_id}/versions/{version_number}/download")
async def download_document_version(
    document_id: int,
    version_number: int,
    db: AsyncSession = Depends(get_db),
    house_context: int = Depends(require_house_context),
    current_user: User = Depends(has_permission("documents.download")),
):
    document = await _document_for_house(db, document_id, house_context)
    version = (
        await db.execute(
            select(DocumentVersion).where(
                DocumentVersion.document_id == document.id,
                DocumentVersion.version_number == version_number,
            )
        )
    ).scalar_one_or_none()
    if version is None:
        raise HTTPException(status_code=404, detail={"code": "VERSION_NOT_FOUND", "message": "Document version not found"})
    path = document_pdf.pdf_fs_path(version.pdf_path)
    if not path:
        raise HTTPException(status_code=404, detail={"code": "PDF_NOT_FOUND", "message": "The stored PDF is unavailable"})
    return FileResponse(
        path,
        media_type="application/pdf",
        filename=f"{document.document_number}-v{version.version_number}.pdf",
        headers={"Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff"},
    )
