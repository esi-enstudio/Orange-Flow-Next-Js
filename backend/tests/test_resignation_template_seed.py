"""Idempotent global 3-page RESIGNATION template seed."""

import pytest
from sqlalchemy import func, select

from app.models.documents import DocumentTemplate, DocumentTemplateVersion
from app.services import document_ast, document_render, document_seed


async def _seed_twice(db):
    await document_seed.seed_documents_module(db)
    first = (
        await db.execute(
            select(DocumentTemplate).where(
                DocumentTemplate.name == document_seed.RESIGNATION_TEMPLATE_NAME,
                DocumentTemplate.house_id.is_(None),
            )
        )
    ).scalar_one()
    version = (
        await db.execute(
            select(DocumentTemplateVersion).where(
                DocumentTemplateVersion.template_id == first.id
            )
        )
    ).scalar_one()
    await document_seed.seed_documents_module(db)
    return first, version


@pytest.mark.asyncio
async def test_seed_creates_published_global_resignation_template(db):
    template, version = await _seed_twice(db)

    assert template.is_default is True
    assert template.is_active is True
    assert template.house_id is None
    assert version.is_published is True
    assert version.version_number == 1
    assert version.content_json["schema_version"] == 2
    assert version.content_json["audience"] == "all"
    assert await db.scalar(
        select(func.count()).select_from(DocumentTemplate).where(
            DocumentTemplate.name == document_seed.RESIGNATION_TEMPLATE_NAME
        )
    ) == 1
    assert await db.scalar(
        select(func.count()).select_from(DocumentTemplateVersion).where(
            DocumentTemplateVersion.template_id == template.id
        )
    ) == 1


@pytest.mark.asyncio
async def test_seed_block_order_is_letter_nid_then_letterhead(db):
    ast, _schema = document_seed.resignation_template_payload()
    types = [(block["type"], block.get("source")) for block in ast["blocks"]]

    assert types[:5] == [
        ("image", "resignation_letter"),
        ("page_break", None),
        ("image", "employee_nid"),
        ("page_break", None),
        ("paragraph", None),
    ]
    assert any(block["type"] == "heading" for block in ast["blocks"][4:])
    assert ast["blocks"][0]["required"] is True
    assert ast["blocks"][2]["required"] is True
    assert any(block["type"] == "signature" and block["show_image"] for block in ast["blocks"])


@pytest.mark.asyncio
async def test_reseed_does_not_overwrite_an_edited_template(db):
    template, version = await _seed_twice(db)
    template.name = "Edited Resignation"
    version.content_json = {**version.content_json, "audience": "rso"}
    await db.commit()

    await document_seed.seed_documents_module(db)
    await db.refresh(template)
    await db.refresh(version)

    assert template.name == "Edited Resignation"
    assert version.content_json["audience"] == "rso"


@pytest.mark.asyncio
async def test_noc_template_stays_v1_and_renders(db):
    await document_seed.seed_documents_module(db)
    noc = (
        await db.execute(
            select(DocumentTemplate).where(
                DocumentTemplate.name == document_seed.NOC_TEMPLATE_NAME
            )
        )
    ).scalar_one()
    version = (
        await db.execute(
            select(DocumentTemplateVersion).where(
                DocumentTemplateVersion.template_id == noc.id
            )
        )
    ).scalar_one()

    assert version.content_json["schema_version"] == 1
    variables = document_ast.collect_variables(version.content_json)
    html = document_render.render_html(
        version.content_json, {key: "" for key in variables}, embed_fonts=False
    )
    assert "<html lang=" in html
