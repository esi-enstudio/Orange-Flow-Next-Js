from sqlalchemy import Column, Integer, String, BigInteger, Table, ForeignKey, DateTime
from sqlalchemy.sql import func
from sqlalchemy.orm import relationship
from app.models.base import Base

# Pivot table (User <-> Role) - must be defined before the class
user_roles = Table(
    'users_roles',
    Base.metadata,
    Column('user_id', Integer, ForeignKey('users.id')),
    Column('role_id', Integer, ForeignKey('roles.id'))
)

# Pivot table (User <-> House)
user_houses = Table(
    'users_houses',
    Base.metadata,
    Column('user_id', Integer, ForeignKey('users.id', ondelete="CASCADE")),
    Column('house_id', Integer, ForeignKey('houses.id', ondelete="CASCADE"))
)


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    telegram_id = Column(BigInteger, unique=True, nullable=True) # Web users might not have Telegram
    username = Column(String, unique=True, index=True, nullable=True)
    hashed_password = Column(String, nullable=True)
    name = Column(String, nullable=True)
    email = Column(String, unique=True, index=True, nullable=True)
    phone_number = Column(String, nullable=True)
    profile_pic = Column(String, nullable=True)
    status = Column(String, default="Active", nullable=False)

    # Reporting line (Self-referencing Foreign Key) ✅
    parent_id = Column(Integer, ForeignKey('users.id'), nullable=True)

    # Many-to-many relationship (with Role table)
    roles = relationship("Role", secondary=user_roles, back_populates="users", lazy="selectin")

    # Relationship with House
    houses = relationship("House", secondary=user_houses, back_populates="users", lazy="selectin")

    # Relationship with Employee
    employee_profile = relationship("Employee", back_populates="user", uselist=False)

    # Reporting line relationship
    parent = relationship("User", remote_side=[id], backref="subordinates")

    todos = relationship("Todo", back_populates="user", lazy="selectin", cascade="all, delete-orphan")

    # Timestamp columns
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, onupdate=func.now())