import os
from pydantic_settings import BaseSettings, SettingsConfigDict
from pydantic import computed_field
from urllib.parse import quote_plus
from typing import Optional

class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file='.env', env_file_encoding='utf-8', extra='ignore')

    # Telegram Bot
    BOT_TOKEN: str
    SUPER_ADMIN_ID: int

    # Database
    DB_USER: str
    DB_PASS: str
    DB_HOST: str
    DB_PORT: str = "5432"
    DB_NAME: str

    # Ngrok & Webhook
    NGROK_AUTH_TOKEN: Optional[str] = None
    WEBHOOK_PORT: int = 8080
    START_NGROK: bool = False
    STATIC_DOMAIN: Optional[str] = None
    FORWARD_OTPS_TO: Optional[str] = None

    # Automation & Scheduler
    DISABLE_SCHEDULER: bool = False
    ENABLE_GA_SYNC: bool = True
    HEADLESS_MODE: bool = True

    @computed_field
    @property
    def DATABASE_URL(self) -> str:
        password = quote_plus(self.DB_PASS)
        return f"postgresql+asyncpg://{self.DB_USER}:{password}@{self.DB_HOST}:{self.DB_PORT}/{self.DB_NAME}"

    @computed_field
    @property
    def SYNC_DATABASE_URL(self) -> str:
        """Used for Alembic migrations which need a sync driver"""
        password = quote_plus(self.DB_PASS)
        return f"postgresql://{self.DB_USER}:{password}@{self.DB_HOST}:{self.DB_PORT}/{self.DB_NAME}"

# Instantiate settings
settings = Settings()

# Export for backward compatibility with existing code
BOT_TOKEN = settings.BOT_TOKEN
SUPER_ADMIN_ID = settings.SUPER_ADMIN_ID
NGROK_AUTH_TOKEN = settings.NGROK_AUTH_TOKEN
WEBHOOK_PORT = settings.WEBHOOK_PORT
FORWARD_OTPS_TO = settings.FORWARD_OTPS_TO
START_NGROK = settings.START_NGROK
STATIC_DOMAIN = settings.STATIC_DOMAIN
DISABLE_SCHEDULER = settings.DISABLE_SCHEDULER
ENABLE_GA_SYNC = settings.ENABLE_GA_SYNC
HEADLESS = settings.HEADLESS_MODE
DATABASE_URL = settings.DATABASE_URL
