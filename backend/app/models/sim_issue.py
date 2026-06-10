from sqlalchemy import Column, Integer, String, Date, Numeric, ForeignKey, DateTime
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.models.base import Base

class SimIssue(Base):
    __tablename__ = "sim_issues"

    id = Column(Integer, primary_key=True, index=True)

    # Excel Headers Mapping
    issue_date = Column(Date, index=True)             # ISSUEDATE
    
    distributor_code = Column(String, index=True)     # DISTRIBUTORCODE
    distributor_name = Column(String)                 # DISTRIBUTORNAME
    house_id = Column(Integer, ForeignKey('houses.id'), nullable=True) # Linked House ID
    
    cluster_market = Column(String, index=True)       # CLUSTER_MARKET
    
    retailer_code = Column(String, index=True)        # RETAILERCODE
    retailer_name = Column(String)                    # RETAILERNAME
    retailer_id = Column(Integer, ForeignKey('retailers.id'), nullable=True) # Linked Retailer ID
    
    promotion = Column(String)                        # PROMOTION
    product_code = Column(String, index=True)         # PRODUCTCODE
    product_name = Column(String)                     # PRODUCTNAME
    selling_price = Column(Numeric(10, 2))            # SELLINGPRICE
    sim_no = Column(String, unique=True, index=True)  # SIMNO (Unique constraint for auditing)

    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, onupdate=func.now())

    # Relationships
    house = relationship("House")
    retailer = relationship("Retailer")
