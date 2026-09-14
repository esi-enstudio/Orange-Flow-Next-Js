from sqlalchemy import (
    Column,
    Integer,
    String,
    Boolean,
    DateTime,
    ForeignKey,
    Index,
    UniqueConstraint,
    text,
)
from sqlalchemy.orm import relationship

from app.models.base import Base
from app.utils.timezone import now_naive


class ReportRuleMaster(Base):
    """Master rule configuration used by report builders (GA Live, Activations, etc.).

    A rule is scoped to a house + context_key and targets a single employee role.
    At most one rule per (house_id, context_key, target_role) may be active.
    """

    __tablename__ = "report_rule_masters"
    __table_args__ = (
        Index(
            "uq_rule_master_active_house_context_role",
            "house_id",
            "context_key",
            "target_role",
            unique=True,
            postgresql_where=text("is_deleted = false AND is_active = true"),
        ),
    )

    id = Column(Integer, primary_key=True)
    house_id = Column(Integer, ForeignKey("houses.id"), nullable=False, index=True)
    context_key = Column(String(100), nullable=False, index=True)
    rule_name = Column(String(200), nullable=False)
    target_role = Column(
        String(20), nullable=False, index=True
    )  # HOUSE | SUPERVISOR | RSO | BP | CC
    is_active = Column(Boolean, default=False, index=True)

    # Audit
    created_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    updated_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime, default=now_naive)
    updated_at = Column(DateTime, default=now_naive, onupdate=now_naive)

    # Soft delete
    is_deleted = Column(Boolean, default=False, index=True)
    deleted_at = Column(DateTime, nullable=True)
    deleted_by = Column(Integer, ForeignKey("users.id"), nullable=True)

    excluded_product_codes = relationship(
        "RuleExcludedProductCode",
        back_populates="rule",
        cascade="all, delete-orphan",
    )
    excluded_retailer_types = relationship(
        "RuleExcludedRetailerType",
        back_populates="rule",
        cascade="all, delete-orphan",
    )
    included_employee_ids = relationship(
        "RuleIncludedEmployeeId",
        back_populates="rule",
        cascade="all, delete-orphan",
    )


class RuleExcludedProductCode(Base):
    """A product code excluded by a rule (applies globally within house+context)."""

    __tablename__ = "rule_excluded_product_codes"
    __table_args__ = (
        UniqueConstraint(
            "rule_id",
            "product_code",
            name="uq_rule_excluded_product_code_rule_code",
        ),
    )

    id = Column(Integer, primary_key=True)
    rule_id = Column(
        Integer, ForeignKey("report_rule_masters.id", ondelete="CASCADE"), nullable=False, index=True
    )
    product_code = Column(String(100), nullable=False, index=True)

    created_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    updated_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime, default=now_naive)
    updated_at = Column(DateTime, default=now_naive, onupdate=now_naive)

    is_deleted = Column(Boolean, default=False, index=True)
    deleted_at = Column(DateTime, nullable=True)
    deleted_by = Column(Integer, ForeignKey("users.id"), nullable=True)

    rule = relationship("ReportRuleMaster", back_populates="excluded_product_codes")


class RuleExcludedRetailerType(Base):
    """A retailer marking/tag name whose retailers are excluded by the rule."""

    __tablename__ = "rule_excluded_retailer_types"
    __table_args__ = (
        UniqueConstraint(
            "rule_id",
            "retailer_type",
            name="uq_rule_excluded_retailer_type_rule_type",
        ),
    )

    id = Column(Integer, primary_key=True)
    rule_id = Column(
        Integer, ForeignKey("report_rule_masters.id", ondelete="CASCADE"), nullable=False, index=True
    )
    retailer_type = Column(String(100), nullable=False, index=True)

    created_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    updated_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime, default=now_naive)
    updated_at = Column(DateTime, default=now_naive, onupdate=now_naive)

    is_deleted = Column(Boolean, default=False, index=True)
    deleted_at = Column(DateTime, nullable=True)
    deleted_by = Column(Integer, ForeignKey("users.id"), nullable=True)

    rule = relationship("ReportRuleMaster", back_populates="excluded_retailer_types")


class RuleIncludedEmployeeId(Base):
    """An employee (user_id) whose rows are included by the rule.

    When present, only these employees' results are shown for the rule's
    house+context+target_role.
    """

    __tablename__ = "rule_included_employee_ids"
    __table_args__ = (
        UniqueConstraint(
            "rule_id",
            "user_id",
            name="uq_rule_included_employee_id_rule_user",
        ),
    )

    id = Column(Integer, primary_key=True)
    rule_id = Column(
        Integer, ForeignKey("report_rule_masters.id", ondelete="CASCADE"), nullable=False, index=True
    )
    user_id = Column(
        Integer, ForeignKey("users.id"), nullable=False, index=True
    )

    created_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    updated_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime, default=now_naive)
    updated_at = Column(DateTime, default=now_naive, onupdate=now_naive)

    is_deleted = Column(Boolean, default=False, index=True)
    deleted_at = Column(DateTime, nullable=True)
    deleted_by = Column(Integer, ForeignKey("users.id"), nullable=True)

    rule = relationship("ReportRuleMaster", back_populates="included_employee_ids")