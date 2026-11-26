"""Resolve template image sources into embedded data URIs.

The AST may only name an allow-listed dynamic source or a manual template
asset id. No path, filename, URL, or data URI is ever accepted from a client;
files are read from private storage through guarded helpers.
"""

import logging
from typing import Optional

from app.services import document_ast, document_render, employee_documents, template_assets

logger = logging.getLogger(__name__)


def _embed_document(doc) -> Optional[str]:
    path = employee_documents.document_file_path(doc)
    if not path:
        return None
    try:
        with open(path, "rb") as handle:
            return document_render._image_data_uri(handle.read())
    except Exception as exc:  # noqa: BLE001 - a broken scan must not kill rendering
        logger.warning("Could not embed employee document %s: %s", doc.id, exc)
        return None


async def resolve_image_sources(
    db,
    *,
    house_id: int,
    template_id: int,
    employee,
    ast: dict,
) -> tuple[dict[str, str], list[str]]:
    """Return ``{source: data_uri}`` plus names of sources that could not resolve."""
    images: dict[str, str] = {}
    missing: list[str] = []
    dynamic_sources = document_ast.collect_image_sources(ast)

    if employee is None:
        # The editor previews before an employee is selected; only manual
        # template assets can resolve without one.
        missing.extend(sorted(dynamic_sources))

    resolvable_sources = sorted(dynamic_sources) if employee is not None else []
    for source in resolvable_sources:
        doc = None
        if source == "resignation_letter":
            doc = await employee_documents.latest_document(
                db, employee.id, ("resignation_letter",), house_id=house_id
            )
        elif source == "employee_nid":
            docs = await employee_documents.latest_nid_documents(
                db, [employee.id], house_id=house_id
            )
            doc = docs.get(employee.id)
        if doc is None:
            missing.append(source)
            continue
        uri = _embed_document(doc)
        if uri:
            images[source] = uri
        else:
            missing.append(source)

    for asset_id in sorted(document_ast.collect_asset_ids(ast)):
        asset = await template_assets.load_for_render(
            db, template_id=template_id, asset_id=asset_id, house_id=house_id
        )
        uri = template_assets.image_data_uri(asset.storage_path) if asset else None
        key = f"manual:{asset_id}"
        if uri:
            images[key] = uri
        else:
            missing.append(key)

    return images, missing
