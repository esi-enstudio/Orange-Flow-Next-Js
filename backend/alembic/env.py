import sys
import os
from logging.config import fileConfig

from sqlalchemy import engine_from_config
from sqlalchemy import pool

from alembic import context

# Add project root to path so we can import app modules
sys.path.insert(0, os.path.realpath(os.path.join(os.path.dirname(__file__), '..')))

from config.settings import settings
from app.models.base import Base
# Import all models to ensure they are registered with Base.metadata
from app.models.user import User
from app.models.role import Role, Permission
from app.models.house import House
from app.models.employee import Employee
from app.models.retailer import Retailer
from app.models.activation import Activation
from app.models.live_activation import LiveActivation
from app.models.house_target import HouseTarget
from app.models.supervisor_target import SupervisorTarget
from app.models.rso_target import RSOTarget
from app.models.bts import BTS
from app.models.itopup_detail import ITopUpDetail
from app.models.ga_filter import GAProductFilter, FilterTag, RetailerFilter
from app.models.scratch_card_issue import ScratchCardIssue
from app.models.scratch_card_serial import ScratchCardSerial
from app.models.sim_issue import SimIssue
from app.models.subscription import HouseSubscription
from app.models.sync_history import SyncHistory
from app.models.mela import Mela, MelaActivity, MelaType, MelaEligibleBTS, MelaAssignment
from app.models.leave_management import LeaveRequest
from app.models.product import Product
from app.models.ga_section_config import GaSectionConfig
from app.models.app_setting import AppSetting
from app.models.commission import (
    StatementBatch, CampaignType, CampaignTransaction,
    FinancialEntry, CommissionAuditLog, CommissionStaging,
)
from app.models.bp_retailer_code import BpRetailerCode
from app.models.bp_target import BpTarget
from app.models.retailer_visit import RetailerVisit
from app.models.order_collection import OrderCollection
from app.models.zoom_in import (
    ZoomInEventType, ZoomInActivity,
    ZoomInAllocation, ZoomInEvent,
    ZoomInEventBTS, ZoomInEventRSO, ZoomInEventBP, ZoomInEventRetailer,
)

# this is the Alembic Config object, which provides
# access to the values within the .ini file in use.
config = context.config

# Set the database URL from settings (escape % for configparser interpolation)
config.set_main_option("sqlalchemy.url", settings.SYNC_DATABASE_URL.replace("%", "%%"))

# Interpret the config file for Python logging.
# This line sets up loggers basically.
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# add your model's MetaData object here
# for 'autogenerate' support
target_metadata = Base.metadata

def run_migrations_offline() -> None:
    """Run migrations in 'offline' mode."""
    url = config.get_main_option("sqlalchemy.url")
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )

    with context.begin_transaction():
        context.run_migrations()

def run_migrations_online() -> None:
    """Run migrations in 'online' mode."""
    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )

    with connectable.connect() as connection:
        context.configure(
            connection=connection, target_metadata=target_metadata
        )

        with context.begin_transaction():
            context.run_migrations()

if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
