import sys
import os
from logging.config import fileConfig

from sqlalchemy import engine_from_config
from sqlalchemy import pool

from alembic import context

# Add project root to path so we can import app modules
sys.path.insert(0, os.path.realpath(os.path.join(os.path.dirname(__file__), '..')))

from config.settings import settings
from app.Models.base import Base
# Import all models to ensure they are registered with Base.metadata
from app.Models.user import User
from app.Models.role import Role, Permission
from app.Models.house import House
from app.Models.employee import Employee
from app.Models.retailer import Retailer
from app.Models.activation import Activation
from app.Models.live_activation import LiveActivation
from app.Models.house_target import HouseTarget
from app.Models.supervisor_target import SupervisorTarget
from app.Models.rso_target import RSOTarget
from app.Models.bts import BTS
from app.Models.itopup_detail import ITopUpDetail
from app.Models.ga_filter import GAProductFilter, FilterTag, RetailerFilter
from app.Models.scratch_card_issue import ScratchCardIssue
from app.Models.sim_issue import SimIssue
from app.Models.subscription import HouseSubscription
from app.Models.sync_history import SyncHistory
from app.Models.mela import Mela, MelaActivity, MelaType, MelaEligibleBTS, MelaAssignment
from app.Models.leave_management import LeaveRequest
from app.Models.product import Product

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
