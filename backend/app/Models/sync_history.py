from sqlalchemy import Column, Integer, String, Date, DateTime, ForeignKey, UniqueConstraint
from sqlalchemy.sql import func
from app.models.base import Base

class SyncHistory(Base):
    __tablename__ = "sync_history"

    id = Column(Integer, primary_key=True)
    house_id = Column(Integer, ForeignKey('houses.id'), nullable=False)
    module_name = Column(String, nullable=False) # activation, sim_issue, scratch_card, dms_report_C2C, etc.
    sync_date = Column(Date, nullable=False)
    status = Column(String, default="success") # success, no_data
    created_at = Column(DateTime, server_default=func.now())

    __table_args__ = (
        UniqueConstraint('house_id', 'module_name', 'sync_date', name='_house_module_date_uc'),
    )
