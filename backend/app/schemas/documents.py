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
    letterhead_id: Optional[int] = None
    employee_id: Optional[int] = None
    document_data: Dict[str, str] = Field(default_factory=dict)


class GeneratedDocumentCreateIn(BaseModel):
    template_id: int
    document_title: Optional[str] = Field(default=None, max_length=255)
    employee_id: Optional[int] = Field(default=None, ge=1)
    letterhead_id: Optional[int] = Field(default=None, ge=1)
    signatory_id: Optional[int] = Field(default=None, ge=1)
    document_data: Dict[str, str] = Field(default_factory=dict, max_length=100)


class GeneratedDocumentUpdateIn(BaseModel):
    template_id: Optional[int] = Field(default=None, ge=1)
    document_title: Optional[str] = Field(default=None, min_length=1, max_length=255)
    employee_id: Optional[int] = Field(default=None, ge=1)
    letterhead_id: Optional[int] = Field(default=None, ge=1)
    signatory_id: Optional[int] = Field(default=None, ge=1)
    document_data: Optional[Dict[str, str]] = Field(default=None, max_length=100)


class GeneratedDocumentOut(BaseModel):
    id: int
    document_number: str
    document_type_id: int
    template_id: int
    template_version_id: int
    letterhead_id: Optional[int] = None
    signatory_id: Optional[int] = None
    house_id: int
    employee_id: Optional[int] = None
    document_title: str
    document_data: Dict[str, Any]
    status: str
    current_version: int
    created_at: Optional[str] = None
    updated_at: Optional[str] = None


class DocumentEmployeeOut(BaseModel):
    id: int
    employee_name: Optional[str] = None
    dms_code: Optional[str] = None
    employee_id: Optional[str] = None
    itop_number: Optional[str] = None
    employee_type: Optional[str] = None
    house_id: int


class DocumentLetterheadCreateIn(BaseModel):
    scope: Literal["house", "global"] = "house"
    name: str = Field(min_length=1, max_length=200)
    organization_name: str = Field(min_length=1, max_length=200)
    subtitle: Optional[str] = Field(default=None, max_length=200)
    address: Optional[str] = Field(default=None, max_length=2000)
    phone_numbers: List[str] = Field(default_factory=list, max_length=10)
    email: Optional[str] = Field(default=None, max_length=255)
    footer_text: Optional[str] = Field(default=None, max_length=2000)
    is_default: bool = False
    is_active: bool = True


class DocumentLetterheadUpdateIn(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=200)
    organization_name: Optional[str] = Field(default=None, min_length=1, max_length=200)
    subtitle: Optional[str] = Field(default=None, max_length=200)
    address: Optional[str] = Field(default=None, max_length=2000)
    phone_numbers: Optional[List[str]] = Field(default=None, max_length=10)
    email: Optional[str] = Field(default=None, max_length=255)
    footer_text: Optional[str] = Field(default=None, max_length=2000)
    is_default: Optional[bool] = None
    is_active: Optional[bool] = None


class DocumentSignatoryCreateIn(BaseModel):
    scope: Literal["house", "global"] = "house"
    name: str = Field(min_length=1, max_length=200)
    designation: str = Field(min_length=1, max_length=150)
    phone: Optional[str] = Field(default=None, max_length=30)
    is_default: bool = False
    is_active: bool = True


class DocumentSignatoryUpdateIn(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=200)
    designation: Optional[str] = Field(default=None, min_length=1, max_length=150)
    phone: Optional[str] = Field(default=None, max_length=30)
    is_default: Optional[bool] = None
    is_active: Optional[bool] = None


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
