from sqlalchemy import Column, Integer, String, Date, Time, Numeric, ForeignKey, DateTime, BigInteger
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.Models.base import Base

class ScratchCardIssue(Base):
    __tablename__ = "scratch_card_issues"

    id = Column(Integer, primary_key=True, index=True)
    
    # Excel Headers Mapping
    cluster_name = Column(String, index=True)         # Cluster_Name
    region = Column(String, index=True)               # Region
    issue_date = Column(Date, index=True)             # IssueDate
    issue_time = Column(String)                       # IssueTime (Stored as string to preserve original format)
    lifting_date = Column(Date)                       # LiftingDate
    
    distributor_name = Column(String)                 # Distributor (For reference)
    distributor_code = Column(String, index=True)     # DistributorCode
    house_id = Column(Integer, ForeignKey('houses.id'), nullable=True) # Linked House ID
    
    retailer_name = Column(String)                    # Retailer (For reference)
    retailer_code = Column(String, index=True)        # RetailerCode
    retailer_id = Column(Integer, ForeignKey('retailers.id'), nullable=True) # Linked Retailer ID
    
    route_code = Column(String)                       # RouteCode
    product_name = Column(String)                     # Product
    product_code = Column(String, index=True)         # ProductCode
    
    start_sc_no = Column(String, index=True)          # StartSCNo
    end_sc_no = Column(String, index=True)            # EndSCNo
    rso_code = Column(String, index=True)             # RSOCode
    
    quantity = Column(Integer)                        # Quantity
    value = Column(Numeric(12, 2))                    # Value

    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, onupdate=func.now())

    # Relationships
    house = relationship("House")
    retailer = relationship("Retailer")
