from sqlalchemy import Column, Integer, String, DateTime, Boolean
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.Models.base import Base
from app.Models.user import user_houses

class House(Base):
    __tablename__ = "houses"

    id = Column(Integer, primary_key=True, index=True)
    cluster = Column(String)
    region = Column(String)
    wh_region = Column(String) # WH Region
    code = Column(String, unique=True) # Distributor_Code
    name = Column(String) # Distributor_Name
    district = Column(String) # District
    email = Column(String) # Email Address
    address = Column(String) # Present Address of The Distribution House
    proprietor_name = Column(String) # Proprietor Name
    proprietor_contact = Column(String) # Proprietor Contact Number
    poc_name = Column(String) # POC Name
    poc_mobile = Column(String) # POC Mobile Number
    lifting_date = Column(String) # Lifting date
    latitude = Column(String) # Latitude
    longitude = Column(String) # Longitude
    bts_id = Column(String) # BTS ID

    # DMS Credentials (নিজেদের প্রয়োজনের জন্য রাখা হলো)
    dms_user = Column(String, nullable=True)
    dms_pass = Column(String, nullable=True)
    dms_house_id = Column(String, nullable=True)

    subscription_date = Column(DateTime)
    is_active = Column(Boolean, default=True, nullable=False)
    is_sync_enabled = Column(Boolean, default=False, nullable=False)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, onupdate=func.now())

    # User মডেলের সাথে রিলেশন
    users = relationship(
        "User", 
        secondary=user_houses, # এটি যোগ করা বাধ্যতামূলক ✅
        back_populates="houses"
    )
    
    retailers = relationship("Retailer", back_populates="house")
    subscriptions = relationship("HouseSubscription", back_populates="house", order_by="desc(HouseSubscription.end_date)")

    @property
    def display_name(self):
        """হাউজের নাম এবং কোড রিটার্ন করবে (যেমন: Patwary Telecom (MYMVAI01))"""
        return f"{self.name} ({self.code})"