from sqlalchemy import Column, Integer, String, Date, ForeignKey, DateTime, Table
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.models.base import Base

# 1. Pivot table: Link mela with BTS (must be before class) ✅
mela_bts_link = Table(
    'mela_bts_assignments',
    Base.metadata,
    Column('mela_id', Integer, ForeignKey('melas.id'), primary_key=True),
    Column('bts_id', Integer, ForeignKey('bts_list.id'), primary_key=True)
)

# 2. Mela type (e.g., Zoom In)
class MelaType(Base):
    __tablename__ = "mela_types"
    id = Column(Integer, primary_key=True)
    name = Column(String, unique=True, nullable=False)

# 3. Mela activity (e.g., Local Games)
class MelaActivity(Base):
    __tablename__ = "mela_activities"
    id = Column(Integer, primary_key=True)
    name = Column(String, unique=True, nullable=False)

# 4. Eligible BTS list (Pivot table) ✅
class MelaEligibleBTS(Base):
    __tablename__ = "mela_eligible_bts"
    id = Column(Integer, primary_key=True)
    house_id = Column(Integer, ForeignKey('houses.id'), nullable=False)
    bts_id = Column(Integer, ForeignKey('bts_list.id'), nullable=False)
    
    # Relationship
    bts = relationship("BTS") 
    house = relationship("House")

# 5. Main mela management table
class Mela(Base):
    __tablename__ = "melas"

    id = Column(Integer, primary_key=True)
    house_id = Column(Integer, ForeignKey('houses.id'), nullable=False)
    
    activity_date = Column(Date, nullable=False, index=True)
    thana = Column(String) # Auto-populate from bts_list
    location = Column(String)
    
    # Stores mela type and activity ID ✅
    mela_type_id = Column(Integer, ForeignKey('mela_types.id'))
    mela_activity_id = Column(Integer, ForeignKey('mela_activities.id'))
    
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, onupdate=func.now())

    # Relationships
    house = relationship("House")
    mela_type = relationship("MelaType")
    mela_activity = relationship("MelaActivity")
    
    # Which BTS are under this mela ✅
    covered_bts = relationship("BTS", secondary=mela_bts_link, lazy="selectin")
    
    # Which employees are under this mela ✅
    assignments = relationship("MelaAssignment", back_populates="mela", cascade="all, delete-orphan", lazy="selectin")

class MelaAssignment(Base):
    """Track employees participating in mela (RSO, BP, SSO)"""
    __tablename__ = "mela_assignments"

    id = Column(Integer, primary_key=True)
    mela_id = Column(Integer, ForeignKey('melas.id'), nullable=False)
    
    retailer_code = Column(String, nullable=False, index=True) 
    role_type = Column(String, nullable=False) # 'RSO', 'BP', or 'SSO'
    
    mela = relationship("Mela", back_populates="assignments")