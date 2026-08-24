from sqlalchemy import Column, Integer, String, DateTime, Boolean
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.models.base import Base
from app.models.user import user_houses

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

    # DMS Credentials (for internal use)
    dms_user = Column(String, nullable=True)
    dms_pass = Column(String, nullable=True)
    dms_house_id = Column(String, nullable=True)

    subscription_date = Column(DateTime)
    is_active = Column(Boolean, default=True, nullable=False)
    is_sync_enabled = Column(Boolean, default=False, nullable=False)
    is_live_sync_enabled = Column(Boolean, default=False, nullable=False)

    # WhatsApp Gateway (go-whatsapp-multi-session-rest-api)
    wa_api_key = Column(String(200), nullable=True)
    wa_device_id = Column(String(100), nullable=True)
    wa_device_secret = Column(String(200), nullable=True)
    wa_jwt_token = Column(String(500), nullable=True)
    wa_phone_number = Column(String(20), nullable=True)
    wa_status = Column(String(20), default="disconnected")  # disconnected|connecting|connected|error
    wa_last_error = Column(String(500), nullable=True)
    wa_last_connected_at = Column(DateTime, nullable=True)

    # Telegram report delivery (shared bots, manual chat linking)
    telegram_chat_id = Column(String(64), nullable=True)
    telegram_chat_name = Column(String(200), nullable=True)

    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, onupdate=func.now())

    # Relation with User model
    users = relationship(
        "User", 
        secondary=user_houses, # Mandatory to add ✅
        back_populates="houses"
    )
    
    retailers = relationship("Retailer", back_populates="house")
    subscriptions = relationship("HouseSubscription", back_populates="house", order_by="desc(HouseSubscription.end_date)")

    @property
    def display_name(self):
        """Returns house name and code (e.g., Patwary Telecom (MYMVAI01))"""
        return f"{self.name} ({self.code})"