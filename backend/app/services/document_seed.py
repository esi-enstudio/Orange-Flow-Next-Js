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
        "schema_version": document_ast.AST_SCHEMA_VERSION,
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


async def seed_documents_module(db: AsyncSession) -> dict:
    """Insert missing document types and the global NOC template. Returns counts."""
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

    noc_type = (
        await db.execute(
            select(DocumentType).where(
                DocumentType.code == "NOC", DocumentType.is_deleted.is_(False)
            )
        )
    ).scalar_one_or_none()

    if noc_type is not None:
        template = (
            await db.execute(
                select(DocumentTemplate).where(
                    DocumentTemplate.name == NOC_TEMPLATE_NAME,
                    DocumentTemplate.house_id.is_(None),
                    DocumentTemplate.is_deleted.is_(False),
                )
            )
        ).scalar_one_or_none()

        if template is None:
            ast, schema = noc_template_payload()
            template = DocumentTemplate(
                document_type_id=noc_type.id,
                house_id=None,
                name=NOC_TEMPLATE_NAME,
                template_mode="PREDEFINED",
                description=NOC_TEMPLATE_DESCRIPTION,
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
                ast, schema = noc_template_payload()
            db.add(
                DocumentTemplateVersion(
                    template_id=template.id,
                    version_number=1,
                    content_json=ast,
                    variables_schema=schema,
                    version_notes="Seeded default NOC template",
                    is_published=True,
                    published_at=now_naive(),
                )
            )
            created["versions"] += 1

    await db.commit()

    if any(created.values()):
        logger.info(
            "Documents module seed: %s type(s), %s template(s), %s version(s) created",
            created["types"],
            created["templates"],
            created["versions"],
        )
    return created
