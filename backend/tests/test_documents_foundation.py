"""Phase 1 foundation: schema registration, AST validation and the seed data.

These tests do not touch the HTTP layer; they guard the pieces every later
phase depends on: the eight tables exist, the Document AST validator rejects
unsafe input, and the seeded NOC template really comes from the existing
`house_letterhead.DEFAULT_BODY_TEXT`.
"""

import json
from pathlib import Path

import pytest
from sqlalchemy import func, select
from sqlalchemy.dialects import postgresql

from app.models.base import Base
from app.models.documents import (
    DocumentLetterhead,
    DocumentNumberSequence,
    DocumentSignatory,
    DocumentTemplate,
    DocumentTemplateVersion,
    DocumentType,
    DocumentVersion,
    GeneratedDocument,
)
from app.services import document_ast
from app.services import document_seed
from app.services.house_letterhead import DEFAULT_BODY_TEXT

BACKEND_ROOT = Path(__file__).resolve().parents[1]
PERMISSIONS_FILE = BACKEND_ROOT / "config" / "permissions.json"

DOCUMENTS_PERMISSIONS = {
    "documents.view",
    "documents.create",
    "documents.edit",
    "documents.generate",
    "documents.download",
    "documents.regenerate",
    "documents.void",
    "documents.templates.view",
    "documents.templates.manage",
    "documents.letterheads.manage",
    "documents.signatories.manage",
    "documents.audit.view",
}


# --------------------------------------------------------------------------- #
# Schema
# --------------------------------------------------------------------------- #

def test_all_document_tables_are_registered():
    expected = {
        "document_types",
        "document_templates",
        "document_template_versions",
        "document_letterheads",
        "document_signatories",
        "generated_documents",
        "document_versions",
        "document_number_sequences",
    }
    assert expected <= set(Base.metadata.tables)


def test_document_tables_use_integer_primary_keys():
    """The project schema is Integer-PK based; UUIDs would break every FK."""
    for model in (
        DocumentType,
        DocumentTemplate,
        DocumentTemplateVersion,
        DocumentLetterhead,
        DocumentSignatory,
        GeneratedDocument,
        DocumentVersion,
        DocumentNumberSequence,
    ):
        pk_columns = list(model.__table__.primary_key.columns)
        assert len(pk_columns) == 1, f"{model.__name__} needs a single PK"
        assert pk_columns[0].type.python_type is int, model.__name__


def test_generated_document_number_is_unique_per_house():
    constraints = {c.name for c in GeneratedDocument.__table__.constraints}
    assert "uq_generated_document_number" in constraints


def test_version_tables_are_unique_per_version_number():
    assert "uq_document_template_version" in {
        c.name for c in DocumentTemplateVersion.__table__.constraints
    }
    assert "uq_document_version" in {
        c.name for c in DocumentVersion.__table__.constraints
    }


def test_number_sequence_is_unique_per_house_type_year():
    assert "uq_document_number_sequence" in {
        c.name for c in DocumentNumberSequence.__table__.constraints
    }


# --------------------------------------------------------------------------- #
# AST validation
# --------------------------------------------------------------------------- #

def _ast(**overrides):
    payload = {
        "schema_version": 1,
        "page": {"orientation": "portrait"},
        "blocks": [{"type": "paragraph", "text": "Hello {{ employee_name }}"}],
    }
    payload.update(overrides)
    return payload


def test_ast_normalises_and_assigns_block_ids():
    ast = document_ast.validate_ast(_ast())
    assert ast["schema_version"] == 1
    assert ast["page"]["format"] == "A4"
    assert ast["page"]["margins"]["top"] == 18
    assert len(ast["blocks"][0]["id"]) >= 6


def test_ast_rejects_unknown_block_type():
    with pytest.raises(document_ast.AstError, match="Unknown block type"):
        document_ast.validate_ast(_ast(blocks=[{"type": "script", "text": "alert(1)"}]))


def test_ast_rejects_unsupported_schema_version():
    with pytest.raises(document_ast.AstError, match="Unsupported template schema version"):
        document_ast.validate_ast(_ast(schema_version=99))


def test_ast_rejects_invalid_orientation():
    with pytest.raises(document_ast.AstError, match="orientation"):
        document_ast.validate_ast(_ast(page={"orientation": "diagonal"}))


def test_ast_rejects_too_many_blocks():
    blocks = [{"type": "paragraph", "text": "x"}] * (document_ast.MAX_BLOCKS + 1)
    with pytest.raises(document_ast.AstError, match="at most"):
        document_ast.validate_ast(_ast(blocks=blocks))


def test_ast_clamps_numeric_values():
    ast = document_ast.validate_ast(
        _ast(blocks=[{"type": "paragraph", "text": "x", "size": 999, "line_height": 0.1}])
    )
    assert ast["blocks"][0]["size"] == 40
    assert ast["blocks"][0]["line_height"] == 1.0


def test_variables_schema_rejects_undeclared_placeholder():
    ast = document_ast.validate_ast(_ast())
    with pytest.raises(document_ast.AstError, match="not declared"):
        document_ast.validate_variables_schema({"fields": []}, ast)


def test_variables_schema_rejects_unknown_source():
    with pytest.raises(document_ast.AstError, match="Variable source cannot be changed"):
        document_ast.validate_variables_schema(
            {"fields": [{"key": "employee_name", "source": "system.env"}]}
        )


def test_variables_schema_cannot_make_house_fields_editable():
    schema = document_ast.validate_variables_schema(
        {"fields": [{"key": "house_name", "readonly": False}]}
    )
    assert schema["fields"][0]["readonly"] is True


def test_variables_schema_cannot_remap_house_field_source():
    with pytest.raises(document_ast.AstError, match="Variable source cannot be changed"):
        document_ast.validate_variables_schema(
            {"fields": [{"key": "house_name", "source": "employee.employee_name"}]}
        )


def test_variables_schema_rejects_duplicate_keys():
    with pytest.raises(document_ast.AstError, match="Duplicate variable"):
        document_ast.validate_variables_schema(
            {"fields": [{"key": "nid"}, {"key": "nid"}]}
        )


def test_select_variable_requires_options():
    with pytest.raises(document_ast.AstError, match="needs at least one option"):
        document_ast.validate_variables_schema(
            {"fields": [{"key": "designation", "type": "select"}]}
        )


# --------------------------------------------------------------------------- #
# Seed data
# --------------------------------------------------------------------------- #

def test_noc_ast_is_built_from_the_existing_letterhead_text():
    """The seeded NOC must reuse DEFAULT_BODY_TEXT, not a retyped copy."""
    ast, _ = document_seed.noc_template_payload()
    printed = "\n".join(
        block.get("text", "") for block in ast["blocks"] if block["type"] != "signature"
    )
    first_chunk = DEFAULT_BODY_TEXT.split("\n\n")[0]
    for line in first_chunk.splitlines():
        assert line in printed, f"missing seeded line: {line}"
    assert "তিনি স্বেচ্ছায় চাকরি থেকে পদত্যাগ করেছেন" in printed
    assert any(block["type"] == "signature" for block in ast["blocks"])


def test_noc_ast_placeholders_are_all_in_the_registry():
    ast, schema = document_seed.noc_template_payload()
    used = document_ast.collect_variables(ast)
    assert used, "the seeded NOC must use dynamic variables"
    for key in used:
        assert key in document_ast.VARIABLES, f"unknown variable in seed: {key}"
    declared = {field["key"] for field in schema["fields"]}
    assert used - document_ast.SIGNATURE_ONLY_KEYS <= declared


def test_noc_ast_has_no_raw_html():
    ast, _ = document_seed.noc_template_payload()
    printed = json.dumps(ast, ensure_ascii=False)
    assert "<script" not in printed.lower()
    assert "javascript:" not in printed.lower()


async def test_seed_is_idempotent(db):
    first = await document_seed.seed_documents_module(db)
    assert first["types"] == len(document_seed.DOCUMENT_TYPES)
    assert first["templates"] == 1
    assert first["versions"] == 1

    second = await document_seed.seed_documents_module(db)
    assert second == {"types": 0, "templates": 0, "versions": 0}

    types = (await db.execute(select(func.count(DocumentType.id)))).scalar()
    templates = (await db.execute(select(func.count(DocumentTemplate.id)))).scalar()
    versions = (await db.execute(select(func.count(DocumentTemplateVersion.id)))).scalar()
    assert types == len(document_seed.DOCUMENT_TYPES)
    assert templates == 1
    assert versions == 1


async def test_seed_publishes_the_default_noc_version(db):
    await document_seed.seed_documents_module(db)
    version = (await db.execute(select(DocumentTemplateVersion))).scalar_one()
    assert version.is_published is True
    assert version.published_at is not None
    assert version.content_json["schema_version"] == document_ast.AST_SCHEMA_VERSION


# --------------------------------------------------------------------------- #
# Permissions and module registration
# --------------------------------------------------------------------------- #

def _permissions_config() -> dict:
    return json.loads(PERMISSIONS_FILE.read_text(encoding="utf-8"))


def test_documents_permissions_are_declared():
    config = _permissions_config()
    declared = set(config["modules"]["documents"]["permissions"])
    assert declared == DOCUMENTS_PERMISSIONS


def test_default_roles_only_reference_declared_permissions():
    config = _permissions_config()
    declared = {
        permission
        for module in config["modules"].values()
        for permission in module["permissions"]
    }
    for role in config["default_roles"]:
        unknown = set(role.get("permissions", [])) - declared
        assert not unknown, f"role {role['name']} references undeclared permissions: {unknown}"


def test_distributor_role_can_manage_documents():
    config = _permissions_config()
    distributor = next(r for r in config["default_roles"] if r["name"] == "Distributor")
    assert DOCUMENTS_PERMISSIONS <= set(distributor["permissions"])


def test_documents_module_is_mapped_for_plan_gating():
    from config.modules import (
        ALL_LEAF_ROUTES,
        LEAF_TO_API_PREFIXES,
        MODULE_KEYS,
        leaf_owners_for_path,
        module_for_path,
    )

    assert "documents" in MODULE_KEYS
    assert module_for_path("/api/v1/documents/templates") == "documents"
    assert "/documents" in ALL_LEAF_ROUTES
    assert LEAF_TO_API_PREFIXES["/documents"] == (
        "/api/v1/documents/records",
    )
    assert leaf_owners_for_path("documents", "/api/v1/documents/records/17") == [
        "/documents",
    ]
    assert "/documents/templates" in ALL_LEAF_ROUTES
    assert LEAF_TO_API_PREFIXES["/documents/templates"] == (
        "/api/v1/documents/templates",
        "/api/v1/documents/types",
        "/api/v1/documents/variables",
    )
    assert LEAF_TO_API_PREFIXES["/documents/letterheads"] == (
        "/api/v1/documents/letterheads",
    )
    assert LEAF_TO_API_PREFIXES["/documents/signatories"] == (
        "/api/v1/documents/signatories",
    )
    assert LEAF_TO_API_PREFIXES["/documents/create"] == (
        "/api/v1/documents",
        "/api/v1/documents/",
        "/api/v1/documents/employees",
    )


def test_number_statement_compiles_to_postgres_upsert_with_returning():
    from app.services.document_numbering import _sequence_upsert_statement

    statement = _sequence_upsert_statement(1, 2, 2026)
    sql = str(statement.compile(dialect=postgresql.dialect()))
    assert "ON CONFLICT (house_id, document_type_id, year)" in sql
    assert "DO UPDATE SET last_number" in sql
    assert "RETURNING document_number_sequences.last_number" in sql
