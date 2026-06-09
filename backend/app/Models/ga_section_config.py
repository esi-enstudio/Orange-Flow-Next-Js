from sqlalchemy import Column, Integer, String, Boolean, DateTime, ForeignKey, JSON
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.models.base import Base


class GaSectionConfig(Base):
    __tablename__ = "ga_section_configs"

    id = Column(Integer, primary_key=True)
    house_id = Column(Integer, ForeignKey("houses.id"), nullable=False)
    section_key = Column(String(100), nullable=False)
    exclude_product_codes = Column(JSON, default=list)
    exclude_retailer_tags = Column(JSON, default=list)
    selected_employee_ids = Column(JSON, default=list)
    is_active = Column(Boolean, default=True)
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())
    updated_by = Column(Integer, ForeignKey("users.id"), nullable=True)

    house = relationship("House")
    updater = relationship("User")
