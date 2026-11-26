"""AST v2: image blocks (dynamic/manual) and root audience validation."""

import pytest

from app.services import document_ast
from app.services.document_ast import AstError


def _ast(blocks, schema_version=2, **root):
    payload = {
        "schema_version": schema_version,
        "page": {"orientation": "portrait"},
        "blocks": blocks,
    }
    payload.update(root)
    return payload


def test_image_block_requires_schema_v2():
    with pytest.raises(AstError, match="schema version 2"):
        document_ast.validate_ast(
            _ast([{"type": "image", "source_kind": "dynamic", "source": "employee_nid"}], 1)
        )


def test_v2_dynamic_image_block_normalizes_defaults():
    result = document_ast.validate_ast(
        _ast([{"type": "image", "source_kind": "dynamic", "source": "resignation_letter"}])
    )
    assert result["schema_version"] == 2
    assert result["blocks"][0] == {
        "id": result["blocks"][0]["id"],
        "type": "image",
        "source_kind": "dynamic",
        "source": "resignation_letter",
        "asset_id": None,
        "align": "center",
        "max_width_mm": 170,
        "max_height_mm": 240,
        "required": True,
        "fallback_text": "",
    }


def test_v2_manual_image_block_normalizes_without_source():
    result = document_ast.validate_ast(
        _ast([{"type": "image", "source_kind": "manual", "asset_id": 7}])
    )
    block = result["blocks"][0]
    assert block["source"] is None
    assert block["asset_id"] == 7
    assert block["source_kind"] == "manual"


def test_unknown_dynamic_source_is_rejected():
    with pytest.raises(AstError, match="Unknown image source"):
        document_ast.validate_ast(
            _ast([{"type": "image", "source_kind": "dynamic", "source": "passport"}])
        )


def test_manual_block_without_asset_id_is_rejected():
    with pytest.raises(AstError, match="asset_id"):
        document_ast.validate_ast(_ast([{"type": "image", "source_kind": "manual"}]))


def test_dynamic_block_with_asset_id_is_rejected():
    with pytest.raises(AstError, match="asset_id"):
        document_ast.validate_ast(
            _ast(
                [
                    {
                        "type": "image",
                        "source_kind": "dynamic",
                        "source": "employee_nid",
                        "asset_id": 7,
                    }
                ]
            )
        )


def test_image_dimensions_are_clamped_to_allowed_range():
    result = document_ast.validate_ast(
        _ast(
            [
                {
                    "type": "image",
                    "source_kind": "manual",
                    "asset_id": 7,
                    "max_width_mm": 999,
                    "max_height_mm": 1,
                }
            ]
        )
    )
    assert result["blocks"][0]["max_width_mm"] == 190
    assert result["blocks"][0]["max_height_mm"] == 20


def test_unknown_audience_is_rejected():
    with pytest.raises(AstError, match="audience"):
        document_ast.validate_ast(_ast([], audience="manager"))


def test_missing_audience_defaults_to_all():
    assert document_ast.validate_ast(_ast([]))["audience"] == "all"


def test_v1_text_template_still_validates_with_v1_schema():
    result = document_ast.validate_ast(
        _ast(
            [{"type": "paragraph", "text": "Hello {{ employee_name }}"}],
            schema_version=1,
        )
    )
    assert result["schema_version"] == 1
    assert result["blocks"][0]["text"] == "Hello {{ employee_name }}"


def test_collectors_read_dynamic_sources_and_manual_asset_ids():
    result = document_ast.validate_ast(
        _ast(
            [
                {"type": "image", "source_kind": "dynamic", "source": "resignation_letter"},
                {"type": "page_break"},
                {"type": "image", "source_kind": "dynamic", "source": "employee_nid"},
                {"type": "page_break"},
                {"type": "image", "source_kind": "manual", "asset_id": 7},
            ]
        )
    )
    assert document_ast.collect_image_sources(result) == {
        "resignation_letter",
        "employee_nid",
    }
    assert document_ast.collect_asset_ids(result) == {7}
