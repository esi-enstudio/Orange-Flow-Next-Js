"""Image blocks in rendered document HTML: embedding, fallback, v1 stability."""

from app.services import document_ast, document_render


def _ast(*blocks, schema_version=2):
    return document_ast.validate_ast(
        {
            "schema_version": schema_version,
            "page": {"orientation": "portrait"},
            "blocks": list(blocks),
        }
    )


def _body(html):
    return html.split("<body>", 1)[1].split("</body>", 1)[0]


def test_embeds_resolved_image_with_block_dimensions():
    ast = _ast(
        {
            "type": "image",
            "source_kind": "dynamic",
            "source": "employee_nid",
            "align": "right",
            "max_width_mm": 150,
            "max_height_mm": 200,
        }
    )
    html = document_render.render_html(
        ast,
        {},
        images={"employee_nid": "data:image/jpeg;base64,QUJD"},
        embed_fonts=False,
    )
    body = _body(html)
    assert '<figure class="doc-image"' in body
    assert '<img src="data:image/jpeg;base64,QUJD"' in body
    assert "text-align:right" in body
    assert "max-width:150mm" in body
    assert "max-height:200mm" in body
    assert "break-inside:avoid" in html


def test_image_block_escapes_fallback():
    ast = _ast(
        {
            "type": "image",
            "source_kind": "dynamic",
            "source": "resignation_letter",
            "fallback_text": "<script>alert(1)</script>",
        }
    )
    html = document_render.render_html(ast, {}, embed_fonts=False)
    body = _body(html)
    assert "<script>" not in body
    assert "&lt;script&gt;alert(1)&lt;/script&gt;" in body


def test_unresolved_image_without_fallback_renders_nothing():
    ast = _ast({"type": "image", "source_kind": "dynamic", "source": "employee_nid"})
    assert _body(document_render.render_html(ast, {}, embed_fonts=False)) == ""


def test_v1_body_is_byte_identical():
    ast = _ast([{"type": "paragraph", "text": "Hello"}][0], schema_version=1)
    html = document_render.render_html(ast, {}, embed_fonts=False)
    assert _body(html) == (
        '<p class="doc-p" style="text-align:left;font-size:12.0pt;'
        'line-height:1.7;">Hello</p>'
    )
