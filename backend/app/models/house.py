from sqlalchemy import Column, ForeignKey, Integer, String, DateTime, Boolean
from sqlalchemy.dialects.postgresql import JSONB
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

    # Bangla values, typed as-is by the operator for the Bangla letterhead.
    name_bn = Column(String)
    address_bn = Column(String)
    proprietor_name_bn = Column(String)
    proprietor_contact_bn = Column(String)
    poc_name_bn = Column(String)
    poc_mobile_bn = Column(String)
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
    # True when the billing lifecycle auto-deactivated this house (expired
    # plan). Distinguishes automatic locks from manual admin deactivation so a
    # renewal only re-enables houses that were locked by billing.
    deactivated_for_billing = Column(Boolean, default=False, nullable=False)
    is_sync_enabled = Column(Boolean, default=False, nullable=False)
    is_live_sync_enabled = Column(Boolean, default=False, nullable=False)
    # Show the PULL badge next to iTopUp on this house's lifting records.
    show_pull_button = Column(Boolean, default=False, nullable=False)

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

    # Resignation letterhead (per house). The image is the full-page design;
    # `letterhead_layout` stores the editable body block (percentages) printed
    # on top of it. Files live under private_uploads/letterheads/{house_id}/.
    letterhead_image_path = Column(String(500), nullable=True)
    # Proprietor signature printed on the letterhead (auto-placed when uploaded).
    proprietor_signature_path = Column(String(500), nullable=True)
    letterhead_layout = Column(JSONB, nullable=True)
    letterhead_updated_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    letterhead_updated_at = Column(DateTime, nullable=True)

    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, onupdate=func.now())

    # Relation with User model
    users = relationship(
        "User", 
        secondary=user_houses, # Mandatory to add ✅
        back_populates="houses"
    )
    
    retailers = relationship("Retailer", back_populates="house")
    documents = relationship("HouseDocument", back_populates="house")
    subscriptions = relationship("HouseSubscription", back_populates="house", order_by="desc(HouseSubscription.end_date)")

    @property
    def display_name(self):
        """Returns house name and code (e.g., Patwary Telecom (MYMVAI01))"""
        return f"{self.name} ({self.code})"