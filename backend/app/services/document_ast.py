"""Document AST (schema v1) and the variable registry.

The AST is the *only* template body format. Both template modes
(PREDEFINED / VISUAL) store this JSON; raw HTML is never accepted from a user.
`app/services/document_render.py` turns it into HTML, so validation here is the
security boundary for everything the renderer later prints.

Shape (schema_version 1)::

    {
      "schema_version": 1,
      "page": {
        "format": "A4",
        "orientation": "portrait",
        "margins": {"top": 18, "right": 18, "bottom": 18, "left": 18},
        "font_size": 12,
        "line_height": 1.7
      },
      "blocks": [
        {"id": "b1", "type": "heading", "text": "অনাপত্তি সনদ", "align": "center", "size": 14, "bold": true},
        {"id": "b2", "type": "paragraph", "text": "যাহা দ্বারা ... {{ employee_name }}"},
        {"id": "b3", "type": "spacer", "height": 8},
        {"id": "b4", "type": "divider"},
        {"id": "b5", "type": "signature", "align": "left", "show_image": true,
         "fallback": {"name": "{{proprietor_name}}", "designation": "ডিস্ট্রিবিউটর",
                      "organization": "{{house_name}}", "phone": "{{proprietor_contact}}"}},
        {"id": "b6", "type": "page_break"}
      ]
    }

Text supports inline ``{{ variable_key }}`` tokens. Every key must exist in
`VARIABLES` *and* be declared in the template's `variables_schema`, so the
generation form always collects what the body prints.
"""

import re
import uuid
from typing import Iterable, Optional

# Bump when the block structure changes in a way that needs a converter. Stored
# templates keep their own version, so old templates keep rendering.
AST_SCHEMA_VERSION = 1
SUPPORTED_AST_VERSIONS = (1,)

BLOCK_TYPES = (
    "heading",
    "paragraph",
    "spacer",
    "divider",
    "signature",
    "page_break",
)
ALIGNMENTS = ("left", "center", "right", "justify")
ORIENTATIONS = ("portrait", "landscape")
FIELD_TYPES = ("text", "textarea", "date", "number", "select")

MAX_BLOCKS = 300
MAX_FIELDS = 100
MAX_TEXT = 20000
MAX_OPTIONS = 100

PLACEHOLDER_RE = re.compile(r"\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}")

# --------------------------------------------------------------------------- #
# Variable registry
#
# `source` is the dotted path the generation service resolves automatically.
# ``None`` means the user must type the value in the generation form.
# --------------------------------------------------------------------------- #

_EMPLOYEE = "employee"
_HOUSE = "house"
_DOCUMENT = "document"

VARIABLES: dict = {
    # ---- employee (auto) ----
    "employee_name": {"label": "Employee Name", "label_bn": "কর্মীর নাম", "source": f"{_EMPLOYEE}.employee_name", "type": "text"},
    "fathers_name": {"label": "Father's Name", "label_bn": "পিতার নাম", "source": f"{_EMPLOYEE}.fathers_name", "type": "text"},
    "mothers_name": {"label": "Mother's Name", "label_bn": "মাতার নাম", "source": f"{_EMPLOYEE}.mothers_name", "type": "text"},
    "nid": {"label": "NID Number", "label_bn": "জাতীয় পরিচয়পত্র নম্বর", "source": f"{_EMPLOYEE}.nid", "type": "text"},
    "dob": {"label": "Date of Birth", "label_bn": "জন্ম তারিখ", "source": f"{_EMPLOYEE}.dob", "type": "date"},
    "dms_code": {"label": "DMS Code", "label_bn": "ডিএমএস কোড", "source": f"{_EMPLOYEE}.dms_code", "type": "text"},
    "employee_id": {"label": "Employee ID", "label_bn": "কর্মী আইডি", "source": f"{_EMPLOYEE}.employee_id", "type": "text"},
    "itop_number": {"label": "iTop Number", "label_bn": "আইটপ নম্বর", "source": f"{_EMPLOYEE}.itop_number", "type": "text"},
    "personal_number": {"label": "Personal Number", "label_bn": "ব্যক্তিগত নম্বর", "source": f"{_EMPLOYEE}.personal_number", "type": "text"},
    "pool_number": {"label": "Pool Number", "label_bn": "পুল নম্বর", "source": f"{_EMPLOYEE}.pool_number", "type": "text"},
    "employee_type": {"label": "Employee Type", "label_bn": "কর্মীর ধরন", "source": f"{_EMPLOYEE}.employee_type", "type": "text"},
    "designation": {"label": "Designation", "label_bn": "পদবি", "source": f"{_EMPLOYEE}.designation", "type": "text"},
    "joining_date": {"label": "Joining Date", "label_bn": "যোগদানের তারিখ", "source": f"{_EMPLOYEE}.joining_date", "type": "date"},
    "resigned_date": {"label": "Last Working Date", "label_bn": "শেষ কর্মদিবস", "source": f"{_EMPLOYEE}.resigned_date", "type": "date"},
    "present_address": {"label": "Present Address", "label_bn": "বর্তমান ঠিকানা", "source": f"{_EMPLOYEE}.present_address", "type": "text"},
    "permanent_address": {"label": "Permanent Address", "label_bn": "স্থায়ী ঠিকানা", "source": f"{_EMPLOYEE}.permanent_address", "type": "text"},
    "bank_name": {"label": "Bank Name", "label_bn": "ব্যাংকের নাম", "source": f"{_EMPLOYEE}.bank_name", "type": "text"},
    "bank_account": {"label": "Bank Account", "label_bn": "ব্যাংক হিসাব", "source": f"{_EMPLOYEE}.bank_account", "type": "text"},
    "branch_name": {"label": "Branch Name", "label_bn": "শাখার নাম", "source": f"{_EMPLOYEE}.branch_name", "type": "text"},
    "blood_group": {"label": "Blood Group", "label_bn": "রক্তের গ্রুপ", "source": f"{_EMPLOYEE}.blood_group", "type": "text"},
    "last_education": {"label": "Last Education", "label_bn": "শিক্ষাগত যোগ্যতা", "source": f"{_EMPLOYEE}.last_education", "type": "text"},
    "institution_name": {"label": "Institution", "label_bn": "শিক্ষা প্রতিষ্ঠান", "source": f"{_EMPLOYEE}.institution_name", "type": "text"},
    "emergency_contact_person_name": {"label": "Emergency Contact", "label_bn": "আপদকালীন যোগাযোগ", "source": f"{_EMPLOYEE}.emergency_contact_person_name", "type": "text"},
    "emergency_contact_person_number": {"label": "Emergency Contact Number", "label_bn": "আপদকালীন নম্বর", "source": f"{_EMPLOYEE}.emergency_contact_person_number", "type": "text"},

    # ---- house (auto, read-only) ----
    "house_name": {"label": "House Name", "label_bn": "হাউসের নাম", "source": f"{_HOUSE}.name", "type": "text", "readonly": True},
    "house_code": {"label": "House Code", "label_bn": "হাউস কোড", "source": f"{_HOUSE}.code", "type": "text", "readonly": True},
    "house_address": {"label": "House Address", "label_bn": "হাউসের ঠিকানা", "source": f"{_HOUSE}.address", "type": "text", "readonly": True},
    "house_district": {"label": "District", "label_bn": "জেলা", "source": f"{_HOUSE}.district", "type": "text", "readonly": True},
    "house_email": {"label": "House Email", "label_bn": "হাউসের ইমেইল", "source": f"{_HOUSE}.email", "type": "text", "readonly": True},
    "proprietor_name": {"label": "Proprietor Name", "label_bn": "স্বত্বাধিকারীর নাম", "source": f"{_HOUSE}.proprietor_name", "type": "text", "readonly": True},
    "proprietor_contact": {"label": "Proprietor Contact", "label_bn": "স্বত্বাধিকারীর যোগাযোগ", "source": f"{_HOUSE}.proprietor_contact", "type": "text", "readonly": True},
    "poc_name": {"label": "POC Name", "label_bn": "পিওসি নাম", "source": f"{_HOUSE}.poc_name", "type": "text", "readonly": True},
    "poc_mobile": {"label": "POC Mobile", "label_bn": "পিওসি মোবাইল", "source": f"{_HOUSE}.poc_mobile", "type": "text", "readonly": True},

    # ---- document (auto, read-only) ----
    "document_number": {"label": "Document Number", "label_bn": "ডকুমেন্ট নম্বর", "source": f"{_DOCUMENT}.document_number", "type": "text", "readonly": True},
    "document_date": {"label": "Document Date", "label_bn": "ডকুমেন্টের তারিখ", "source": f"{_DOCUMENT}.document_date", "type": "date"},
    # The seeded NOC body (and the resignation letterhead) call it "application
    # date"; both names resolve to the same value.
    "application_date": {"label": "Application Date", "label_bn": "আবেদনের তারিখ", "source": f"{_DOCUMENT}.document_date", "type": "date"},
    "document_title": {"label": "Document Title", "label_bn": "ডকুমেন্টের শিরোনাম", "source": f"{_DOCUMENT}.document_title", "type": "text"},

    # ---- signatory (auto from the selected signatory, read-only) ----
    "signatory_name": {"label": "Signatory Name", "label_bn": "স্বাক্ষরকারীর নাম", "source": "signatory.name", "type": "text", "readonly": True},
    "signatory_designation": {"label": "Signatory Designation", "label_bn": "স্বাক্ষরকারীর পদবি", "source": "signatory.designation", "type": "text", "readonly": True},
    "signatory_phone": {"label": "Signatory Phone", "label_bn": "স্বাক্ষরকারীর ফোন", "source": "signatory.phone", "type": "text", "readonly": True},
}

# Keys the renderer prints through a `signature` block. Declaring them as
# fields would make the generation form ask for a value the block already
# resolves, so they are filtered out of `schema_from_keys`.
SIGNATURE_ONLY_KEYS = frozenset(
    {"signatory_name", "signatory_designation", "signatory_phone"}
)


class AstError(ValueError):
    """Raised when an AST / variable schema is malformed. Message is user-facing."""


# --------------------------------------------------------------------------- #
# Primitive cleaners
# --------------------------------------------------------------------------- #

def _text(value, limit: int = MAX_TEXT) -> str:
    if value is None:
        return ""
    if not isinstance(value, str):
        raise AstError("Text values must be strings")
    return value.replace("\x00", "")[:limit]


def _number(value, default: float, low: float, high: float) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return default
    return max(low, min(high, number))


def _flag(value, default: bool = False) -> bool:
    if value is None:
        return default
    return bool(value)


def _align(value, default: str = "left") -> str:
    return value if value in ALIGNMENTS else default


def _block_id(value) -> str:
    if isinstance(value, str) and re.fullmatch(r"[A-Za-z0-9_-]{1,40}", value):
        return value
    return uuid.uuid4().hex[:12]


def _clean_block(raw) -> Optional[dict]:
    """Normalise one block. Returns None for an unknown block type."""
    if not isinstance(raw, dict):
        raise AstError("Every block must be an object")
    block_type = raw.get("type")
    if block_type not in BLOCK_TYPES:
        raise AstError(f"Unknown block type: {block_type!r}")

    block = {"id": _block_id(raw.get("id")), "type": block_type}

    if block_type in ("heading", "paragraph"):
        block["text"] = _text(raw.get("text"))
        block["align"] = _align(raw.get("align"), "left" if block_type == "paragraph" else "center")
        block["size"] = _number(raw.get("size"), 12, 6, 40)
        block["bold"] = _flag(raw.get("bold"), block_type == "heading")
        block["line_height"] = _number(raw.get("line_height"), 1.7, 1.0, 3.0)
    elif block_type == "spacer":
        block["height"] = _number(raw.get("height"), 8, 1, 100)
    elif block_type == "divider":
        block["size"] = _number(raw.get("size"), 1, 0.5, 4)
    elif block_type == "signature":
        block["align"] = _align(raw.get("align"), "left")
        block["show_image"] = _flag(raw.get("show_image"), True)
        block["size"] = _number(raw.get("size"), 12, 6, 40)
        fallback = raw.get("fallback")
        if isinstance(fallback, dict):
            block["fallback"] = {
                "name": _text(fallback.get("name"), 200),
                "designation": _text(fallback.get("designation"), 200),
                "organization": _text(fallback.get("organization"), 200),
                "phone": _text(fallback.get("phone"), 100),
            }
    # page_break carries nothing else

    return block


# --------------------------------------------------------------------------- #
# AST validation
# --------------------------------------------------------------------------- #

def validate_ast(payload) -> dict:
    """Normalise a client supplied AST. Raises `AstError` on anything invalid."""
    if not isinstance(payload, dict):
        raise AstError("Template content must be an object")

    schema_version = payload.get("schema_version", AST_SCHEMA_VERSION)
    if schema_version not in SUPPORTED_AST_VERSIONS:
        raise AstError(
            f"Unsupported template schema version {schema_version!r}. "
            f"Supported: {', '.join(str(v) for v in SUPPORTED_AST_VERSIONS)}"
        )

    page_raw = payload.get("page") if isinstance(payload.get("page"), dict) else {}
    orientation = page_raw.get("orientation", "portrait")
    if orientation not in ORIENTATIONS:
        raise AstError("Page orientation must be 'portrait' or 'landscape'")
    margins_raw = page_raw.get("margins") if isinstance(page_raw.get("margins"), dict) else {}
    margins = {
        side: _number(margins_raw.get(side), 18, 5, 50)
        for side in ("top", "right", "bottom", "left")
    }

    blocks_raw = payload.get("blocks")
    if not isinstance(blocks_raw, list):
        raise AstError("Template content must have a 'blocks' list")
    if len(blocks_raw) > MAX_BLOCKS:
        raise AstError(f"A template may have at most {MAX_BLOCKS} blocks")

    blocks = [_clean_block(raw) for raw in blocks_raw]

    return {
        "schema_version": AST_SCHEMA_VERSION,
        "page": {
            "format": "A4",
            "orientation": orientation,
            "margins": margins,
            "font_size": _number(page_raw.get("font_size"), 12, 6, 40),
            "line_height": _number(page_raw.get("line_height"), 1.7, 1.0, 3.0),
        },
        "blocks": blocks,
    }


# --------------------------------------------------------------------------- #
# Variables
# --------------------------------------------------------------------------- #

def collect_variables(ast: dict) -> set:
    """Every ``{{ key }}`` token used anywhere in the template."""
    found: set = set()
    for block in ast.get("blocks", []):
        texts = [block.get("text") or ""]
        fallback = block.get("fallback")
        if isinstance(fallback, dict):
            texts.extend(str(value or "") for value in fallback.values())
        for text in texts:
            found.update(PLACEHOLDER_RE.findall(text))
    return found


def validate_variables_schema(payload, ast: Optional[dict] = None) -> dict:
    """Normalise the generation-form definition and cross-check it with the AST."""
    if payload is None:
        payload = {"fields": []}
    if not isinstance(payload, dict):
        raise AstError("Variables schema must be an object")
    fields_raw = payload.get("fields")
    if not isinstance(fields_raw, list):
        raise AstError("Variables schema must have a 'fields' list")
    if len(fields_raw) > MAX_FIELDS:
        raise AstError(f"A template may define at most {MAX_FIELDS} variables")

    fields = []
    seen: set = set()
    for raw in fields_raw:
        if not isinstance(raw, dict):
            raise AstError("Every variable must be an object")
        key = raw.get("key")
        if not isinstance(key, str) or not PLACEHOLDER_RE.fullmatch("{{ " + key + " }}"):
            raise AstError(f"Invalid variable key: {key!r}")
        if key in seen:
            raise AstError(f"Duplicate variable key: {key}")
        if key not in VARIABLES:
            raise AstError(f"Unknown variable key: {key}")
        seen.add(key)

        spec = VARIABLES[key]
        source = raw.get("source", spec.get("source"))
        if source != spec.get("source"):
            raise AstError(f"Variable source cannot be changed for '{key}'")

        field_type = raw.get("type") or spec.get("type") or "text"
        if field_type not in FIELD_TYPES:
            raise AstError(f"Invalid type for variable '{key}': {field_type!r}")

        options_raw = raw.get("options")
        options = []
        if isinstance(options_raw, list):
            options = [str(item)[:100] for item in options_raw[:MAX_OPTIONS] if str(item).strip()]
        if field_type == "select" and not options:
            raise AstError(f"Select variable '{key}' needs at least one option")

        fields.append(
            {
                "key": key,
                "label": _text(raw.get("label") or spec.get("label") or key, 200),
                "label_bn": _text(raw.get("label_bn") or spec.get("label_bn") or "", 200),
                "type": field_type,
                "required": _flag(raw.get("required"), False),
                "source": source,
                "readonly": bool(spec.get("readonly")) or _flag(raw.get("readonly")),
                "default": _text(raw.get("default"), 500),
                "options": options,
            }
        )

    if ast is not None:
        used = collect_variables(ast)
        undeclared = sorted(used - seen)
        if undeclared:
            raise AstError(
                "These variables are used in the template but not declared: "
                + ", ".join(undeclared)
            )
        unknown = sorted(key for key in used if key not in VARIABLES)
        if unknown:
            raise AstError("Unknown variables: " + ", ".join(unknown))

    return {"fields": fields}


def schema_from_keys(keys: Iterable[str], required: bool = True) -> dict:
    """Build a variables schema from the keys an AST actually uses.

    Labels, types and sources come from the registry, so a template seeded from
    existing text always matches the text it prints.
    """
    fields = []
    for key in sorted(set(keys)):
        if key in SIGNATURE_ONLY_KEYS:
            continue
        spec = VARIABLES.get(key)
        if not spec:
            raise AstError(f"Unknown variable: {key}")
        fields.append(
            {
                "key": key,
                "label": spec["label"],
                "label_bn": spec.get("label_bn", ""),
                "type": spec.get("type", "text"),
                "required": required and not spec.get("readonly", False),
                "source": spec.get("source"),
                "readonly": bool(spec.get("readonly")),
                "default": "",
                "options": [],
            }
        )
    return {"fields": fields}


def source_map() -> dict:
    """``source`` -> variable keys, used by the renderer's context resolver.

    A source can back several keys (``document_date`` and ``application_date``
    are aliases), so every alias receives the same resolved value.
    """
    mapping: dict = {}
    for key, spec in VARIABLES.items():
        source = spec.get("source")
        if source:
            mapping.setdefault(source, []).append(key)
    return mapping
