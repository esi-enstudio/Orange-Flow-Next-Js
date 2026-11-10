"""Request/response models for the Document Automation API."""

from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, Field


class TemplateCreateIn(BaseModel):
    document_type_id: int
    # "house" (default) uses the X-House-ID context; "global" is super-admin only.
    scope: Literal["house", "global"] = "house"
    name: str = Field(min_length=1, max_length=200)
    template_mode: Literal["PREDEFINED", "VISUAL"] = "PREDEFINED"
    description: Optional[str] = Field(default=None, max_length=2000)
    is_default: bool = False
    content_json: Dict[str, Any]
    variables_schema: Dict[str, Any] = Field(default_factory=lambda: {"fields": []})
    version_notes: Optional[str] = Field(default=None, max_length=1000)
    publish: bool = True


class TemplateUpdateIn(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=200)
    description: Optional[str] = Field(default=None, max_length=2000)
    is_default: Optional[bool] = None
    is_active: Optional[bool] = None


class TemplateVersionIn(BaseModel):
    content_json: Dict[str, Any]
    variables_schema: Dict[str, Any] = Field(default_factory=lambda: {"fields": []})
    version_notes: Optional[str] = Field(default=None, max_length=1000)
    publish: bool = True


class TemplateDuplicateIn(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    scope: Literal["house", "global"] = "house"


class TemplatePreviewIn(BaseModel):
    template_id: int
    version_number: Optional[int] = None
    values: Dict[str, str] = Field(default_factory=dict)
    signatory_id: Optional[int] = None


class TemplateSchemaOut(BaseModel):
    success: bool = True
    data: Dict[str, Any]


class DocumentTypeOut(BaseModel):
    id: int
    code: str
    name: str
    name_bn: Optional[str] = None
    number_prefix: str
    description: Optional[str] = None
    is_active: bool


class TemplateVariableOut(BaseModel):
    key: str
    label: str
    label_bn: Optional[str] = None
    type: str
    required: bool
    source: Optional[str] = None
    readonly: bool
    default: Optional[str] = None
    options: List[str] = Field(default_factory=list)
