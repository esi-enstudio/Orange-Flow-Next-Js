import re
from datetime import datetime
from sqlalchemy import Column, Integer, String, Text, Date, Boolean, DateTime, ForeignKey, JSON
from app.models.base import Base
from app.utils.timezone import now_naive


def generate_slug(name: str, model_id: int = 0) -> str:
    slug = name.lower().strip()
    slug = re.sub(r'[^\w\s-]', '', slug)
    slug = re.sub(r'[-\s]+', '-', slug)
    slug = slug.strip('-')
    if model_id:
        slug = f"{slug}-{model_id}"
    return slug


class CV(Base):
    __tablename__ = "cvs"

    id = Column(Integer, primary_key=True, index=True)
    slug = Column(String(255), unique=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    house_id = Column(Integer, ForeignKey("houses.id"), nullable=True, index=True)

    name = Column(String(200), nullable=False)
    care_of = Column(String(200), nullable=True)
    mobile = Column(String(20), nullable=True)

    fathers_name = Column(String(200), nullable=True)
    mothers_name = Column(String(200), nullable=True)
    permanent_address = Column(Text, nullable=True)
    date_of_birth = Column(Date, nullable=True)
    nid_number = Column(String(50), nullable=True)
    nationality = Column(String(50), default="Bangladeshi")
    religion = Column(String(50), nullable=True)
    marital_status = Column(String(50), nullable=True)
    blood_group = Column(String(10), nullable=True)

    educational_qualifications = Column(JSON, default=[])

    professional_experiences = Column(JSON, default=[])

    language_proficiency = Column(Text, nullable=True)

    photo_url = Column(String(500), nullable=True)
    signature_url = Column(String(500), nullable=True)

    declaration_text = Column(Text, nullable=True)
    signature_name = Column(String(200), nullable=True)
    declaration_date = Column(Date, nullable=True)

    created_at = Column(DateTime, default=now_naive)
    updated_at = Column(DateTime, default=now_naive, onupdate=now_naive)
    is_deleted = Column(Boolean, default=False, index=True)
    deleted_at = Column(DateTime, nullable=True)
    deleted_by = Column(Integer, ForeignKey("users.id"), nullable=True)
