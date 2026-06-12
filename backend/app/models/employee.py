from sqlalchemy import Column, Integer, String, Boolean, ForeignKey, DateTime
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.models.base import Base

class Employee(Base):
    __tablename__ = "employees"

    id = Column(Integer, primary_key=True)
    
    # Relation with User table (bot user ID) ✅
    # This helps the bot identify RSO or BP when checking their GA.
    user_id = Column(Integer, ForeignKey('users.id'), nullable=True)  
    assisted_retailer_code = Column(String, nullable=True, index=True) # R026588  
    agency_id = Column(String, nullable=True) # If agency data exists
    
    # Basic info
    dms_code = Column(String, unique=True, index=True) # DMS Code (R642686)
    itop_number = Column(String, index=True)  # unique=True removed
    personal_number = Column(String)  # unique=True removed
    pool_number = Column(String)  # unique=False removed (default is False)
    status = Column(String, default="Active") # 'Active', 'Resigned', 'Suspended'
    
    # Bank info
    bank_name = Column(String)
    bank_account = Column(String)
    branch_name = Column(String)
    routing_number = Column(String)
    
    # Personal details
    home_town = Column(String)
    emergency_contact_person_name = Column(String)
    emergency_contact_person_number = Column(String)
    emergency_person_relationship = Column(String) # Relationship with emergency contact
    last_education = Column(String)
    institution_name = Column(String)
    blood_group = Column(String)
    present_address = Column(String)
    permanent_address = Column(String)
    fathers_name = Column(String)
    mothers_name = Column(String)
    religion = Column(String)
    dob = Column(String) # Date of Birth
    nid = Column(String)
    
    # Professional details
    previous_company_name = Column(String)
    previous_company_salary = Column(String)
    motor_bike = Column(String) # Yes/No
    bicyle = Column(String) # Yes/No
    driving_license = Column(String) # Yes/No
    joining_date = Column(String)
    resigned_date = Column(String)
    market_type = Column(String) # Rural/Urban
    salary = Column(String)
    
    # Employee classification
    employee_type = Column(String(30), default='unknown')  # rso, manager, supervisor, bp, bsp, rbsp
    employee_id = Column(String(50), unique=True, index=True)  # Business-facing ID like RSO-001, MGR-002

    # Hierarchy
    house_id = Column(Integer, ForeignKey('houses.id'), nullable=False)
    
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, onupdate=func.now())

    # Relationships
    house = relationship("House", backref="employees")

    # Relation: One employee can have many retailers
    retailers = relationship("Retailer", back_populates="employee")

    user = relationship("User", back_populates="employee_profile") # Link with User
