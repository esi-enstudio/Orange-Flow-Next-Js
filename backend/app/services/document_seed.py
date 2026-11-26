"""Seed data for the Document Automation module.

Idempotent: `seed_documents_module` is called from `init_db()` on every start
and only inserts what is missing (matched by code / by global template name).

The default NOC template body is **derived from the existing resignation
letterhead text** (`house_letterhead.DEFAULT_BODY_TEXT`) so the two features can
never drift apart: same Bangla wording, same placeholders.
"""

import logging
import re

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.documents import (
    DocumentTemplate,
    DocumentTemplateVersion,
    DocumentType,
)
from app.services import document_ast
from app.services.house_letterhead import DEFAULT_BODY_TEXT
from app.utils.timezone import now_naive

logger = logging.getLogger(__name__)

# code, English name, Bangla name, number prefix, description
DOCUMENT_TYPES = (
    ("NOC", "No Objection Certificate", "অনাপত্তি সনদ", "NOC", "Clearance issued when an employee leaves"),
    ("RESIGNATION", "Resignation Letter", "পদত্যাগপত্র", "RES", "Employee resignation letter"),
    ("RELEASE", "Release Letter", "রিলিজ লেটার", "REL", "Release from duties"),
    ("EXPERIENCE", "Experience Certificate", "অভিজ্ঞতা সনদ", "EXP", "Employment experience certificate"),
    ("SALARY", "Salary Certificate", "বেতন সনদ", "SAL", "Salary confirmation"),
    ("APPOINTMENT", "Appointment Letter", "নিয়োগপত্র", "APT", "New appointment letter"),
    ("HOUSE_APPLICATION", "House Application", "হাউস আবেদনপত্র", "HAP", "Application addressed to the distribution house"),
)

NOC_TEMPLATE_NAME = "Banglalink Distribution House - NOC Standard"
NOC_TEMPLATE_DESCRIPTION = (
    "Global NOC template seeded from the resignation letterhead text. "
    "House-specific templates override it."
)
RESIGNATION_TEMPLATE_NAME = "Banglalink Distribution House - Resignation Standard"
RESIGNATION_TEMPLATE_DESCRIPTION = (
    "Global three-page resignation template: handwritten letter, NID and "
    "the house letterhead letter. House-specific templates override it."
)


def _chunks() -> list:
    return [chunk.strip() for chunk in re.split(r"\n\s*\n", DEFAULT_BODY_TEXT) if chunk.strip()]


def _signature_block(chunk: str) -> dict:
    """Turn the trailing signature lines of the letterhead text into a block.

    The four lines are name / designation / organisation / phone. When the text
    does not have that shape the caller keeps it as a normal paragraph instead.
    """
    lines = [line.strip() for line in chunk.splitlines() if line.strip()]
    return {
        "type": "signature",
        "align": "left",
        "show_image": True,
        "size": 12,
        "fallback": {
            "name": lines[0],
            "designation": lines[1],
            "organization": lines[2],
            "phone": lines[3],
        },
    }


def build_noc_ast() -> dict:
    """Document AST for the default NOC, built from DEFAULT_BODY_TEXT."""
    chunks = _chunks()
    blocks = []

    for index, chunk in enumerate(chunks):
        is_last = index == len(chunks) - 1
        line_count = len([line for line in chunk.splitlines() if line.strip()])

        if is_last and line_count == 4:
            blocks.append(_signature_block(chunk))
            continue
        if chunk.startswith("বিষয়"):
            blocks.append({"type": "heading", "text": chunk, "align": "left", "size": 13, "bold": True})
            continue
        blocks.append({"type": "paragraph", "text": chunk, "align": "justify"})

    return {
        # Existing seeded NOC bodies stay on v1; only newly authored templates
        # start from the v2 schema.
        "schema_version": 1,
        "page": {
            "format": "A4",
            "orientation": "portrait",
            "margins": {"top": 18, "right": 18, "bottom": 18, "left": 18},
            "font_size": 12,
            "line_height": 1.7,
        },
        "blocks": blocks,
    }


def noc_template_payload() -> tuple:
    """Validated (ast, variables_schema) for the default NOC template."""
    ast = document_ast.validate_ast(build_noc_ast())
    schema = document_ast.schema_from_keys(document_ast.collect_variables(ast))
    schema = document_ast.validate_variables_schema(schema, ast)
    return ast, schema


def _image_block(block_id: str, source: str, fallback_text: str) -> dict:
    return {
        "id": block_id,
        "type": "image",
        "source_kind": "dynamic",
        "source": source,
        "align": "center",
        "max_width_mm": 170,
        "max_height_mm": 240,
        "required": True,
        "fallback_text": fallback_text,
    }


def build_resignation_ast() -> dict:
    """Three-page AST: scan, NID, then the Bangla letterhead letter."""
    blocks = [
        _image_block(
            "res-letter",
            "resignation_letter",
            "Handwritten resignation letter / হাতে লেখা পদত্যাগপত্র",
        ),
        {"id": "res-page-1", "type": "page_break"},
        _image_block("res-nid", "employee_nid", "Employee NID / জাতীয় পরিচয়পত্র"),
        {"id": "res-page-2", "type": "page_break"},
    ]

    chunks = _chunks()
    for index, chunk in enumerate(chunks):
        line_count = len([line for line in chunk.splitlines() if line.strip()])
        if index == len(chunks) - 1 and line_count == 4:
            blocks.append({**_signature_block(chunk), "id": f"res-block-{index}"})
        elif chunk.startswith("বিষয়"):
            blocks.append(
                {
                    "id": f"res-block-{index}",
                    "type": "heading",
                    "text": chunk,
                    "align": "left",
                    "size": 13,
                    "bold": True,
                }
            )
        else:
            blocks.append(
                {
                    "id": f"res-block-{index}",
                    "type": "paragraph",
                    "text": chunk,
                    "align": "justify",
                }
            )

    return {
        "schema_version": document_ast.AST_SCHEMA_VERSION,
        # Both RSO and BP can use the global seed; narrower templates can be
        # authored per house in the editor.
        "audience": "all",
        "page": {
            "format": "A4",
            "orientation": "portrait",
            "margins": {"top": 18, "right": 18, "bottom": 18, "left": 18},
            "font_size": 12,
            "line_height": 1.7,
        },
        "blocks": blocks,
    }


def resignation_template_payload() -> tuple:
    """Validated (ast, variables_schema) for the default RESIGNATION template."""
    ast = document_ast.validate_ast(build_resignation_ast())
    schema = document_ast.schema_from_keys(document_ast.collect_variables(ast))
    schema = document_ast.validate_variables_schema(schema, ast)
    return ast, schema


async def _ensure_global_template(
    db: AsyncSession,
    *,
    document_type: DocumentType,
    name: str,
    description: str,
    template_mode: str,
    payload_factory,
    version_notes: str,
    created: dict,
) -> None:
    """Create a global template and its first published version if missing.

    An existing template is never edited or versioned by the seed: authored
    changes survive every restart.
    """
    template = (
        await db.execute(
            select(DocumentTemplate).where(
                DocumentTemplate.name == name,
                DocumentTemplate.house_id.is_(None),
                DocumentTemplate.is_deleted.is_(False),
            )
        )
    ).scalar_one_or_none()

    if template is None:
        ast, schema = payload_factory()
        template = DocumentTemplate(
            document_type_id=document_type.id,
            house_id=None,
            name=name,
            template_mode=template_mode,
            description=description,
            is_default=True,
            is_active=True,
        )
        db.add(template)
        await db.flush()
        created["templates"] += 1
    else:
        ast = schema = None

    has_version = (
        await db.execute(
            select(DocumentTemplateVersion.id).where(
                DocumentTemplateVersion.template_id == template.id
            )
        )
    ).first()

    if has_version is None:
        if ast is None:
            ast, schema = payload_factory()
        db.add(
            DocumentTemplateVersion(
                template_id=template.id,
                version_number=1,
                content_json=ast,
                variables_schema=schema,
                version_notes=version_notes,
                is_published=True,
                published_at=now_naive(),
            )
        )
        created["versions"] += 1


async def seed_documents_module(db: AsyncSession) -> dict:
    """Insert missing document types and the two global templates. Returns counts."""
    created = {"types": 0, "templates": 0, "versions": 0}

    if db.get_bind().dialect.name == "postgresql":
        await db.execute(text("SELECT pg_advisory_xact_lock(:key)"), {"key": 7_312_604_119})

    existing_codes = {
        row[0]
        for row in (
            await db.execute(
                select(DocumentType.code).where(DocumentType.is_deleted.is_(False))
            )
        ).all()
    }
    for code, name, name_bn, prefix, description in DOCUMENT_TYPES:
        if code in existing_codes:
            continue
        db.add(
            DocumentType(
                code=code,
                name=name,
                name_bn=name_bn,
                number_prefix=prefix,
                description=description,
            )
        )
        created["types"] += 1

    if created["types"]:
        await db.flush()

    seeds = (
        ("NOC", NOC_TEMPLATE_NAME, NOC_TEMPLATE_DESCRIPTION, "PREDEFINED", noc_template_payload, "Seeded default NOC template"),
        ("RESIGNATION", RESIGNATION_TEMPLATE_NAME, RESIGNATION_TEMPLATE_DESCRIPTION, "VISUAL", resignation_template_payload, "Seeded default RESIGNATION template"),
    )
    for code, name, description, mode, payload_factory, notes in seeds:
        document_type = (
            await db.execute(
                select(DocumentType).where(
                    DocumentType.code == code, DocumentType.is_deleted.is_(False)
                )
            )
        ).scalar_one_or_none()
        if document_type is None:
            continue
        await _ensure_global_template(
            db,
            document_type=document_type,
            name=name,
            description=description,
            template_mode=mode,
            payload_factory=payload_factory,
            version_notes=notes,
            created=created,
        )

    await db.commit()

    if any(created.values()):
        logger.info(
            "Documents module seed: %s type(s), %s template(s), %s version(s) created",
            created["types"],
            created["templates"],
            created["versions"],
        )
    return created
