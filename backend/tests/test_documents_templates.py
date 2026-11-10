"""Phase 2: template CRUD, immutable versions, scope resolution and render safety.

The renderer is the security boundary for everything a generated document
prints, so the escaping and path-traversal tests here are as important as the
CRUD ones.
"""

from types import SimpleNamespace

import pytest
from fastapi import FastAPI, HTTPException
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select

from app.models.activity_log import ActivityLog
from app.models.documents import DocumentTemplate
from app.routers.deps import get_current_user, get_db
from app.routers.documents import router
from app.services import document_render, document_seed
from app.services import document_service as svc

DOC_PERMISSIONS = (
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
)


def _user(house=None, *, permissions=DOC_PERMISSIONS, role="Distributor", user_id=1):
    return SimpleNamespace(
        id=user_id,
        name=f"User {user_id}",
        status="Active",
        houses=[house] if house is not None else [],
        roles=[
            SimpleNamespace(
                name=role,
                permissions=[SimpleNamespace(name=p) for p in permissions],
            )
        ],
    )


def _ast(text="Hello {{ employee_name }}", **extra):
    block = {"type": "paragraph", "text": text}
    block.update(extra)
    return {
        "schema_version": 1,
        "page": {"orientation": "portrait"},
        "blocks": [block],
    }


def _schema(*keys):
    return {
        "fields": [
            {"key": key, "label": key, "type": "text", "required": False}
            for key in keys
        ]
    }


@pytest.fixture
async def api(db):
    app = FastAPI()
    app.include_router(router)
    state = {"user": None}

    async def _get_db():
        yield db

    async def _current_user():
        return state["user"]

    app.dependency_overrides[get_db] = _get_db
    app.dependency_overrides[get_current_user] = _current_user
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        yield client, state


async def _seed(db):
    await document_seed.seed_documents_module(db)
    noc = (
        await db.execute(select(document_seed.DocumentType).where(document_seed.DocumentType.code == "NOC"))
    ).scalar_one()
    return noc


# --------------------------------------------------------------------------- #
# CRUD
# --------------------------------------------------------------------------- #

async def test_create_list_and_get_template(api, db):
    client, state = api
    house = await _make_house(db)
    noc = await _seed(db)
    state["user"] = _user(house)
    headers = {"X-House-ID": str(house.id)}

    response = await client.post(
        "/api/v1/documents/templates",
        headers=headers,
        json={
            "document_type_id": noc.id,
            "name": "House NOC",
            "content_json": _ast(),
            "variables_schema": _schema("employee_name"),
        },
    )
    assert response.status_code == 201, response.text
    created = response.json()["data"]
    assert created["scope"] == "house"
    assert created["house_id"] == house.id
    assert created["version"]["version_number"] == 1
    assert created["version"]["is_published"] is True

    listed = await client.get("/api/v1/documents/templates", headers=headers)
    assert listed.status_code == 200
    body = listed.json()
    names = {row["name"] for row in body["data"]}
    assert "House NOC" in names
    assert body["pagination"]["total"] >= 1

    fetched = await client.get(f"/api/v1/documents/templates/{created['id']}", headers=headers)
    assert fetched.status_code == 200
    assert fetched.json()["data"]["content_json"]["blocks"][0]["text"] == "Hello {{ employee_name }}"


async def test_template_names_are_case_insensitive_within_the_same_scope(api, db):
    client, state = api
    house = await _make_house(db)
    noc = await _seed(db)
    state["user"] = _user(house)
    headers = {"X-House-ID": str(house.id)}
    payload = {
        "document_type_id": noc.id,
        "name": "House NOC",
        "content_json": _ast(),
        "variables_schema": _schema("employee_name"),
    }

    created = await client.post("/api/v1/documents/templates", headers=headers, json=payload)
    assert created.status_code == 201, created.text

    payload["name"] = "house noc"
    duplicate = await client.post("/api/v1/documents/templates", headers=headers, json=payload)
    assert duplicate.status_code == 409
    assert duplicate.json()["detail"]["code"] == "TEMPLATE_NAME_TAKEN"


async def test_tenant_cannot_create_global_template(api, db):
    client, state = api
    house = await _make_house(db)
    noc = await _seed(db)
    state["user"] = _user(house)

    response = await client.post(
        "/api/v1/documents/templates",
        headers={"X-House-ID": str(house.id)},
        json={
            "document_type_id": noc.id,
            "scope": "global",
            "name": "Global NOC copy",
            "content_json": _ast(),
            "variables_schema": _schema("employee_name"),
        },
    )
    assert response.status_code == 403
    assert response.json()["detail"]["code"] == "GLOBAL_TEMPLATE_FORBIDDEN"


async def test_super_admin_can_create_global_template(api, db):
    client, state = api
    noc = await _seed(db)
    state["user"] = _user(None, role="Super Admin", permissions=())

    response = await client.post(
        "/api/v1/documents/templates",
        json={
            "document_type_id": noc.id,
            "scope": "global",
            "name": "Global NOC copy",
            "content_json": _ast(),
            "variables_schema": _schema("employee_name"),
        },
    )
    assert response.status_code == 201, response.text
    assert response.json()["data"]["scope"] == "global"


async def test_cross_house_template_is_forbidden(api, db):
    client, state = api
    house_a = await _make_house(db, code="HA", name="House A")
    house_b = await _make_house(db, code="HB", name="House B")
    noc = await _seed(db)
    state["user"] = _user(house_b)
    created = await client.post(
        "/api/v1/documents/templates",
        headers={"X-House-ID": str(house_b.id)},
        json={
            "document_type_id": noc.id,
            "name": "B NOC",
            "content_json": _ast(),
            "variables_schema": _schema("employee_name"),
        },
    )
    template_id = created.json()["data"]["id"]

    state["user"] = _user(house_a)
    response = await client.get(
        f"/api/v1/documents/templates/{template_id}",
        headers={"X-House-ID": str(house_a.id)},
    )
    assert response.status_code == 403
    assert response.json()["detail"]["code"] == "TEMPLATE_FORBIDDEN"


async def test_soft_delete_hides_template(api, db):
    client, state = api
    house = await _make_house(db)
    noc = await _seed(db)
    state["user"] = _user(house)
    headers = {"X-House-ID": str(house.id)}
    created = await client.post(
        "/api/v1/documents/templates",
        headers=headers,
        json={
            "document_type_id": noc.id,
            "name": "To delete",
            "content_json": _ast(),
            "variables_schema": _schema("employee_name"),
        },
    )
    template_id = created.json()["data"]["id"]

    deleted = await client.delete(f"/api/v1/documents/templates/{template_id}", headers=headers)
    assert deleted.status_code == 200

    listed = await client.get("/api/v1/documents/templates", headers=headers)
    assert template_id not in {row["id"] for row in listed.json()["data"]}


async def test_activity_log_is_written_on_create(api, db):
    client, state = api
    house = await _make_house(db)
    noc = await _seed(db)
    state["user"] = _user(house)

    await client.post(
        "/api/v1/documents/templates",
        headers={"X-House-ID": str(house.id)},
        json={
            "document_type_id": noc.id,
            "name": "Audited NOC",
            "content_json": _ast(),
            "variables_schema": _schema("employee_name"),
        },
    )

    log = (
        await db.execute(
            select(ActivityLog).where(
                ActivityLog.module == "document_template",
                ActivityLog.action == "create",
            )
        )
    ).scalar_one_or_none()
    assert log is not None
    assert log.record_identifier == "Audited NOC"


# --------------------------------------------------------------------------- #
# Versions
# --------------------------------------------------------------------------- #

async def test_versions_are_immutable(api, db):
    client, state = api
    house = await _make_house(db)
    noc = await _seed(db)
    state["user"] = _user(house)
    headers = {"X-House-ID": str(house.id)}

    created = await client.post(
        "/api/v1/documents/templates",
        headers=headers,
        json={
            "document_type_id": noc.id,
            "name": "Versioned NOC",
            "content_json": _ast("version one"),
            "variables_schema": _schema("employee_name"),
        },
    )
    template_id = created.json()["data"]["id"]

    second = await client.post(
        f"/api/v1/documents/templates/{template_id}/versions",
        headers=headers,
        json={
            "content_json": _ast("version two"),
            "variables_schema": _schema("employee_name"),
            "publish": False,
        },
    )
    assert second.status_code == 201, second.text
    assert second.json()["data"]["version_number"] == 2

    first_version = await client.get(
        f"/api/v1/documents/templates/{template_id}/versions/1", headers=headers
    )
    assert first_version.json()["data"]["content_json"]["blocks"][0]["text"] == "version one"

    latest = await client.get(f"/api/v1/documents/templates/{template_id}", headers=headers)
    assert latest.json()["data"]["content_json"]["blocks"][0]["text"] == "version two"

    versions = await client.get(f"/api/v1/documents/templates/{template_id}/versions", headers=headers)
    assert [row["version_number"] for row in versions.json()["data"]] == [2, 1]


async def test_publish_marks_version(api, db):
    client, state = api
    house = await _make_house(db)
    noc = await _seed(db)
    state["user"] = _user(house)
    headers = {"X-House-ID": str(house.id)}
    created = await client.post(
        "/api/v1/documents/templates",
        headers=headers,
        json={
            "document_type_id": noc.id,
            "name": "Publish me",
            "content_json": _ast(),
            "variables_schema": _schema("employee_name"),
            "publish": False,
        },
    )
    template_id = created.json()["data"]["id"]

    published = await client.post(
        f"/api/v1/documents/templates/{template_id}/versions/1/publish", headers=headers
    )
    assert published.status_code == 200
    assert published.json()["data"]["is_published"] is True
    assert published.json()["data"]["published_at"] is not None


async def test_undeclared_variable_is_rejected(api, db):
    client, state = api
    house = await _make_house(db)
    noc = await _seed(db)
    state["user"] = _user(house)

    response = await client.post(
        "/api/v1/documents/templates",
        headers={"X-House-ID": str(house.id)},
        json={
            "document_type_id": noc.id,
            "name": "Broken NOC",
            "content_json": _ast("NID: {{ nid }}"),
            "variables_schema": _schema(),
        },
    )
    assert response.status_code == 422
    assert response.json()["detail"]["code"] == "INVALID_VARIABLES"
    assert "nid" in response.json()["detail"]["message"]


# --------------------------------------------------------------------------- #
# Scope resolution
# --------------------------------------------------------------------------- #

async def _make_template(db, house_id, name, *, is_default=False, published=True, type_code="NOC"):
    noc = (
        await db.execute(select(document_seed.DocumentType).where(document_seed.DocumentType.code == type_code))
    ).scalar_one()
    template = DocumentTemplate(
        document_type_id=noc.id,
        house_id=house_id,
        name=name,
        template_mode="PREDEFINED",
        is_default=is_default,
        is_active=True,
    )
    db.add(template)
    await db.flush()
    from app.models.documents import DocumentTemplateVersion

    db.add(
        DocumentTemplateVersion(
            template_id=template.id,
            version_number=1,
            content_json=_ast(),
            variables_schema=_schema("employee_name"),
            is_published=published,
        )
    )
    await db.commit()
    await db.refresh(template)
    return template


async def test_house_template_wins_over_global(db):
    await _seed(db)
    house = await _make_house(db)
    global_template = await _make_template(db, None, "Global NOC", is_default=True)
    house_template = await _make_template(db, house.id, "House NOC", is_default=True)

    resolved_template, resolved_version = await svc.resolve_template(
        db, document_type_id=global_template.document_type_id, house_id=house.id
    )
    assert resolved_template.id == house_template.id
    assert resolved_version.version_number == 1


async def test_global_template_is_the_fallback(db):
    await _seed(db)
    house = await _make_house(db)
    global_template = await _make_template(db, None, "Global only", is_default=True, type_code="RELEASE")

    resolved_template, _ = await svc.resolve_template(
        db, document_type_id=global_template.document_type_id, house_id=house.id
    )
    assert resolved_template.id == global_template.id


async def test_ambiguous_defaults_raise_409(db):
    await _seed(db)
    house = await _make_house(db)
    first = await _make_template(db, house.id, "NOC one", is_default=True)
    await _make_template(db, house.id, "NOC two", is_default=True)

    with pytest.raises(HTTPException) as excinfo:
        await svc.resolve_template(db, document_type_id=first.document_type_id, house_id=house.id)
    assert excinfo.value.status_code == 409
    assert excinfo.value.detail["code"] == "AMBIGUOUS_DEFAULT_TEMPLATE"


async def test_unpublished_version_is_not_resolved(db):
    await _seed(db)
    house = await _make_house(db)
    template = await _make_template(db, house.id, "Draft only", published=False, type_code="RELEASE")

    with pytest.raises(HTTPException) as excinfo:
        await svc.resolve_template(db, document_type_id=template.document_type_id, house_id=house.id)
    assert excinfo.value.status_code == 422
    assert excinfo.value.detail["code"] == "NO_TEMPLATE"


# --------------------------------------------------------------------------- #
# Renderer safety
# --------------------------------------------------------------------------- #

def test_renderer_escapes_user_supplied_html():
    ast = document_render.document_ast.validate_ast(_ast("<script>alert(1)</script> {{ employee_name }}"))
    context = {"employee_name": "<img src=x onerror=alert(2)>"}
    html_document = document_render.render_html(ast, context)

    assert "<script>alert(1)</script>" not in html_document
    assert "&lt;script&gt;alert(1)&lt;/script&gt;" in html_document
    assert "<img" not in html_document
    assert "&lt;img src=x onerror=alert(2)&gt;" in html_document


def test_renderer_ignores_unknown_placeholders():
    ast = document_render.document_ast.validate_ast(_ast("{{ unknown_key }}"))
    with pytest.raises(document_render.document_ast.AstError, match="Unknown template variables"):
        document_render.render_html(ast, {})


def test_renderer_requires_a_value_for_each_template_variable():
    ast = document_render.document_ast.validate_ast(_ast("{{ employee_name }}"))
    with pytest.raises(document_render.document_ast.AstError, match="Undefined template variables"):
        document_render.render_html(ast, {})


def test_renderer_revalidates_css_values_and_drops_untrusted_attributes():
    ast = _ast("Safe text")
    ast["blocks"][0]["align"] = "left; background:url(https://attacker.example)"
    ast["blocks"][0]["onmouseover"] = "alert(1)"

    html_document = document_render.render_html(ast, {})

    assert "attacker.example" not in html_document
    assert "onmouseover" not in html_document
    assert 'text-align:left;' in html_document


def test_renderer_rejects_image_paths_outside_private_uploads(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    assert document_render._image_data_uri_from_path("../../etc/passwd") is None
    assert document_render._image_data_uri_from_path("/etc/passwd") is None


def test_preview_html_has_no_embedded_font_payload():
    ast = document_render.document_ast.validate_ast(_ast("{{ employee_name }}"))
    context = {"employee_name": "মোঃ করিম"}
    preview = document_render.render_html(ast, context, embed_fonts=False)
    pdf_html = document_render.render_html(ast, context, embed_fonts=True)

    assert "data:font/ttf;base64" not in preview
    assert "'Noto Sans Bengali'" in preview
    # The PDF path keeps the embeddable face (empty only if the font files are
    # missing in the test container).
    assert "font-family:NotoBengali" in pdf_html


async def test_preview_endpoint_returns_html(api, db):
    client, state = api
    house = await _make_house(db)
    noc = await _seed(db)
    state["user"] = _user(house)
    headers = {"X-House-ID": str(house.id)}
    created = await client.post(
        "/api/v1/documents/templates",
        headers=headers,
        json={
            "document_type_id": noc.id,
            "name": "Preview NOC",
            "content_json": _ast("Dear {{ employee_name }}"),
            "variables_schema": _schema("employee_name"),
        },
    )
    template_id = created.json()["data"]["id"]

    response = await client.post(
        "/api/v1/documents/render/preview",
        headers=headers,
        json={"template_id": template_id, "values": {"employee_name": "Rahim"}},
    )
    assert response.status_code == 200, response.text
    payload = response.json()["data"]
    assert "Rahim" in payload["html"]
    assert "data:font/ttf;base64" not in payload["html"]
    assert payload["missing"] == []


# --------------------------------------------------------------------------- #
# Helpers
# --------------------------------------------------------------------------- #

async def _make_house(db, code="H001", name="Test House"):
    from app.models.house import House

    house = House(code=code, name=name, email=f"{code.lower()}@example.com", address="Dhaka")
    db.add(house)
    await db.commit()
    await db.refresh(house)
    return house
