from sqlalchemy import Column, Integer, String, Date, ForeignKey, DateTime, Text, Enum
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.Models.base import Base
import enum

class LeaveStatus(enum.Enum):
    PENDING = "Pending"
    APPROVED = "Approved"
    REJECTED = "Rejected"
    CANCELLED = "Cancelled"

class LeaveRequest(Base):
    __tablename__ = "leave_requests"

    id = Column(Integer, primary_key=True, index=True)
    house_id = Column(Integer, ForeignKey('houses.id'), nullable=False)
    employee_id = Column(Integer, ForeignKey('employees.id'), nullable=False)
    
    # ছুটির বিস্তারিত
    leave_type = Column(String, nullable=False) # e.g., 'Sick', 'Casual', 'Emergency'
    start_date = Column(Date, nullable=False)
    end_date = Column(Date, nullable=False)
    total_days = Column(Integer)
    reason = Column(Text, nullable=True)
    
    # এপ্রুভাল প্রসেস
    status = Column(String, default="Pending") # Pending, Approved, Rejected
    approved_by = Column(Integer, ForeignKey('users.id'), nullable=True) # কোন ম্যানেজার এপ্রুভ করেছেন
    admin_remarks = Column(Text, nullable=True) # এপ্রুভ বা রিজেক্ট করার কারণ
    
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, onupdate=func.now())

    # Relationships
    house = relationship("House")
    employee = relationship("Employee", backref="leave_history")
    approver = relationship("User")

    @property
    def duration_display(self):
        if self.start_date == self.end_date:
            return f"{self.start_date}"
        return f"{self.start_date} to {self.end_date} ({self.total_days} days)"
