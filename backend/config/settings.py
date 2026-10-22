import os
from pydantic_settings import BaseSettings, SettingsConfigDict
from pydantic import computed_field, model_validator
from urllib.parse import quote_plus
from typing import Optional

class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file='.env', env_file_encoding='utf-8', extra='ignore')

    # Runtime environment: development | staging | production (prod accepted).
    # Drives safety rails for security-critical billing flags — see
    # `_enforce_billing_safety` below.
    ENVIRONMENT: str = "development"

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

    # Live Location device ingest (optional shared secret). Leave empty to let
    # the mobile macro POST without a key (internal deployments only).
    LOCATION_INGEST_API_KEY: Optional[str] = None

    # Maintenance mode: minutes of warning/grace period (countdown notification)
    # before enforcement kicks in after a super admin enables maintenance.
    MAINTENANCE_GRACE_MINUTES: int = 10

    # Default country code used to expand locally-typed phone numbers
    # (e.g. "01732547755" -> "8801732547755") into full international form.
    DEFAULT_COUNTRY_CODE: str = "880"

    # WhatsApp Multi-Session Gateway (go-whatsapp-multi-session-rest-api)
    WA_GATEWAY_URL: str = "http://localhost:7001"
    WA_GATEWAY_ADMIN_KEY: str = ""
    WA_GATEWAY_JWT_KEY: str = ""
    WA_GATEWAY_ENABLED: bool = True

    # ---- Subscription & Billing (SSLCommerz gateway) ----
    # Provider-agnostic; only sslcommerz is implemented. Add another gateway
    # by implementing app.services.payment.<provider>.py and registering it.
    PAYMENT_GATEWAY: str = "sslcommerz"

    SSLCOMMERZ_STORE_ID: str = ""
    SSLCOMMERZ_STORE_PASSWORD: str = ""
    SSLCOMMERZ_SANDBOX: bool = True
    SSLCOMMERZ_API_BASE: str = "https://sandbox.sslcommerz.com"  # live: https://securepay.sslcommerz.com
    SSLCOMMERZ_SESSION_PATH: str = "/gwprocess/v4/api.php"
    SSLCOMMERZ_VALIDATION_PATH: str = "/validator/api/validationserverAPI.php"
    SSLCOMMERZ_MERCHANT_VALIDATION_PATH: str = "/validator/api/merchantTransIDvalidationAPI.php"
    SSLCOMMERZ_REFUND_PATH: str = "/validator/api/merchantValidation/initRefund.php"
    SSLCOMMERZ_IPN_URL: Optional[str] = None  # public IPN url registered in merchant panel
    SSLCOMMERZ_SUCCESS_URL: Optional[str] = None
    SSLCOMMERZ_FAIL_URL: Optional[str] = None
    SSLCOMMERZ_CANCEL_URL: Optional[str] = None

    # Billing policy
    BILLING_ENABLED: bool = True
    BILLING_GRACE_DAYS: int = 7          # past_due -> expired after this many days
    BILLING_RENEWAL_REMINDER_DAYS: int = 5  # issue renewal invoice N days before period end
    BILLING_TRIAL_END_REMINDER_DAYS: int = 3
    BILLING_TAX_PERCENT: int = 0
    BILLING_INVOICE_DRY_RUN: bool = False  # when True, invoicing works without a real gateway
    DEFAULT_SUBSCRIPTION_PLAN_SLUG: str = "basic"  # assigned when a house subscribes without explicit plan

    # ---- Plan access policy (deny-by-default) ----
    # A house with NO subscription record, or one whose plan is no longer
    # entitled (expired / cancelled / paused / past grace), is blocked for every
    # user of that house except super admins. Billing, plans, profile and
    # read-only house routes stay reachable so the tenant can renew or pick a
    # plan. Set False only for a staged rollout (restores the legacy fail-open
    # behaviour where a plan-less house had full access).
    BILLING_REQUIRE_PLAN: bool = True
    # One-time safety net for the switch to fail-closed: on startup, houses that
    # existed before plan enforcement are granted an explicit "legacy unlimited"
    # plan instead of being locked out. Logged loudly so operators can replace
    # it with a real plan. Idempotent; safe to leave enabled.
    BILLING_LEGACY_BACKFILL: bool = True
    # Slug of the plan used for that legacy grant (created on demand).
    BILLING_LEGACY_PLAN_SLUG: str = "legacy-unlimited"
    # Slug of the plan auto-assigned when a new house is created. Empty string
    # disables auto-provisioning (the house then starts unsubscribed and its
    # employees see the "no plan" gate until an admin assigns one).
    BILLING_DEFAULT_PLAN_SLUG: str = ""

    # ---- Multi-tenant isolation ----
    # When True (default), EVERY non-super-admin user must belong to the house
    # they select via X-House-ID. An "admin"/"manager"/"house manager" role is
    # tenant-scoped: it must never read another house's data just because the
    # header names it. Set False only for a single-company deployment where
    # those roles are deliberately platform-wide.
    TENANT_STRICT_HOUSE_ISOLATION: bool = True
    # Report-only pass of the legacy backfill: logs exactly which houses would
    # receive the legacy plan and what would be attached, without writing.
    # Use for the staging / production migration dry run.
    BILLING_LEGACY_BACKFILL_DRY_RUN: bool = False

    # ---- Restore Points (rollback safety net) ----
    # The backend does not execute snapshots itself; it asks the deploy-service
    # container to, because that is the only process with the repo, the docker
    # socket and the database all in reach at once.
    RESTORE_POINTS_ENABLED: bool = True
    # Docker-compose service name of the deploy container.
    DEPLOY_SERVICE_URL: str = "http://deploy-service:8100"

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

    @property
    def IS_PRODUCTION(self) -> bool:
        return self.ENVIRONMENT.strip().lower() in {"production", "prod"}

    @model_validator(mode="after")
    def enforce_production_billing_safety(self) -> "Settings":
        """Refuse to boot production with a security-weakening billing flag.

        Two flags can silently give the product away:
          - ``BILLING_REQUIRE_PLAN=false`` restores the old fail-open policy, so
            a tenant with no plan (or an expired one) keeps full access.
          - ``BILLING_INVOICE_DRY_RUN=true`` makes the gateway validator return a
            synthetic VALID result, so any checkout succeeds without money.

        Failing the boot is deliberate: a misconfigured production instance must
        never serve traffic that leaks access or accepts fake payments. Staging
        is allowed to exercise both, but must opt in explicitly.
        """
        if not self.IS_PRODUCTION:
            return self
        if not self.BILLING_REQUIRE_PLAN:
            raise ValueError(
                "BILLING_REQUIRE_PLAN=false is not allowed when "
                "ENVIRONMENT=production. It restores the fail-open access policy "
                "and lets houses without a plan use the product. Remove the flag "
                "(default is true) or set it to true."
            )
        if self.BILLING_INVOICE_DRY_RUN:
            raise ValueError(
                "BILLING_INVOICE_DRY_RUN=true is not allowed when "
                "ENVIRONMENT=production. It bypasses the payment gateway's "
                "server-side validation and would activate subscriptions without "
                "a real payment. Set it to false."
            )
        if not self.BILLING_ENABLED:
            raise ValueError(
                "BILLING_ENABLED=false is not allowed when ENVIRONMENT=production: "
                "billing is the only way a blocked tenant can renew."
            )
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
