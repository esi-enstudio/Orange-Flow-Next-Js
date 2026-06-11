from sqlalchemy import Column, Integer, String, Table, ForeignKey, DateTime
from sqlalchemy.sql import func
from sqlalchemy.orm import relationship
from app.models.base import Base

# 1. Pivot table between Role and Permission
role_permissions = Table(
    'roles_permissions',
    Base.metadata,
    Column('role_id', Integer, ForeignKey('roles.id')),
    Column('permission_id', Integer, ForeignKey('permissions.id'))
)


class Role(Base):
    __tablename__ = "roles"
    id = Column(Integer, primary_key=True)
    name = Column(String, unique=True)

    # Relationship (with Permission)
    permissions = relationship("Permission", secondary=role_permissions, lazy="selectin")

    # Relationship (with User - Many-to-Many)
    # Use 'secondary' with user_roles defined in user.py
    # Using string reference to avoid direct import errors
    from app.models.user import user_roles  # Local import to avoid circular error
    users = relationship("User", secondary=user_roles, back_populates="roles")


class Permission(Base):
    __tablename__ = "permissions"
    id = Column(Integer, primary_key=True)
    name = Column(String, unique=True)
    created_at = Column(DateTime, server_default=func.now())