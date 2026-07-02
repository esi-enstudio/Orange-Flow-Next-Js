from datetime import date, datetime
from typing import Optional, List
from pydantic import BaseModel


class EducationalQualification(BaseModel):
    degree: str
    group_subject: str
    board: str
    result: str
    institution: str
    passing_year: int


class ProfessionalExperience(BaseModel):
    institution: str
    designation: str
    duration: str
    responsibilities: List[str]


class CVBase(BaseModel):
    name: str
    care_of: Optional[str] = None
    mobile: Optional[str] = None

    fathers_name: Optional[str] = None
    mothers_name: Optional[str] = None
    permanent_address: Optional[str] = None
    date_of_birth: Optional[date] = None
    nid_number: Optional[str] = None
    nationality: Optional[str] = "Bangladeshi"
    religion: Optional[str] = None
    marital_status: Optional[str] = None
    blood_group: Optional[str] = None

    educational_qualifications: List[EducationalQualification] = []
    professional_experiences: List[ProfessionalExperience] = []

    language_proficiency: Optional[str] = None

    photo_url: Optional[str] = None
    signature_url: Optional[str] = None

    declaration_text: Optional[str] = None
    signature_name: Optional[str] = None
    declaration_date: Optional[date] = None


class CVCreate(CVBase):
    pass


class CVUpdate(CVBase):
    pass


class CVSchema(CVBase):
    id: int
    slug: str
    user_id: int
    house_id: Optional[int] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    model_config = {"from_attributes": True}
