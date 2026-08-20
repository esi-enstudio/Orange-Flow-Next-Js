import os
from pydantic_settings import BaseSettings, SettingsConfigDict
from pydantic import computed_field, model_validator
from urllib.parse import quote_plus
from typing import Optional

class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file='.env', env_file_encoding='utf-8', extra='ignore')

    # Note: Telegram Bot settings are deprecated for web-only mode
    # BOT_TOKEN: str
    # SUPER_ADMIN_ID: int

    # Database
    DB_USER: str
    DB_PASS: str
    DB_HOST: str
    DB_PORT: str = "5432"
    DB_NAME: str

    # Ngrok & Webhook (Mostly legacy, but kept for potential OTP services)
    NGROK_AUTH_TOKEN: Optional[str] = None
    WEBHOOK_PORT: int = 8080
    START_NGROK: bool = False
    STATIC_DOMAIN: Optional[str] = None
    FORWARD_OTPS_TO: Optional[str] = None

    # Automation & Scheduler
    DISABLE_SCHEDULER: bool = False
    ENABLE_GA_SYNC: bool = True
    HEADLESS_MODE: bool = True

    # Redis / Caching
    REDIS_URL: str = "redis://redis:6379/0"
    CACHE_ENABLED: bool = True

    # SMTP / Email
    SMTP_HOST: Optional[str] = None
    SMTP_PORT: int = 587
    SMTP_USER: Optional[str] = None
    SMTP_PASS: Optional[str] = None
    SMTP_FROM: Optional[str] = None
    APP_URL: str = "http://localhost:3000"

    # JWT Authentication
    SECRET_KEY: str
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 10080 # 7 days
    PASSWORD_RESET_EXPIRE_MINUTES: int = 30

    # Timezone
    TIME_ZONE: str = "Asia/Dhaka"

    # WhatsApp Multi-Session Gateway (go-whatsapp-multi-session-rest-api)
    WA_GATEWAY_URL: str = "http://localhost:7001"
    WA_GATEWAY_ADMIN_KEY: str = ""
    WA_GATEWAY_JWT_KEY: str = ""
    WA_GATEWAY_ENABLED: bool = True

    @model_validator(mode="after")
    def validate_secret_key(self) -> "Settings":
        insecure_defaults = {"your-secret-key-change-it-in-env", ""}
        if self.SECRET_KEY in insecure_defaults:
            raise ValueError(
                "SECRET_KEY is insecure. Set a strong random value in .env file. "
                "Generate one with: python -c \"import secrets; print(secrets.token_hex(32))\""
            )
        if len(self.SECRET_KEY) < 32:
            raise ValueError("SECRET_KEY must be at least 32 characters long.")
        return self

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

# Export for backward compatibility
DISABLE_SCHEDULER = settings.DISABLE_SCHEDULER
ENABLE_GA_SYNC = settings.ENABLE_GA_SYNC
HEADLESS = settings.HEADLESS_MODE
DATABASE_URL = settings.DATABASE_URL
SECRET_KEY = settings.SECRET_KEY
ALGORITHM = settings.ALGORITHM
ACCESS_TOKEN_EXPIRE_MINUTES = settings.ACCESS_TOKEN_EXPIRE_MINUTES
