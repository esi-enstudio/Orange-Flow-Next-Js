from sqlalchemy import Column, Integer, String, DateTime, Boolean, JSON, Index, text
from app.models.base import Base
from app.utils.timezone import now_naive


WEBHOOK_EVENT_STATUS_RECEIVED = "received"
WEBHOOK_EVENT_STATUS_PROCESSED = "processed"
WEBHOOK_EVENT_STATUS_ERROR = "error"
WEBHOOK_EVENT_STATUS_IGNORED = "ignored"
WEBHOOK_EVENT_STATUS_SIGNATURE_INVALID = "signature_invalid"


class WebhookEvent(Base):
    """Append-only record of every payment-gateway webhook received.

    Used for idempotency (partial unique on provider + event_id) and audit.
    """

    __tablename__ = "webhook_events"

    id = Column(Integer, primary_key=True, index=True)
    provider = Column(String(32), nullable=False, index=True)  # sslcommerz | ...
    event_id = Column(String(128), nullable=True)  # gateway event id (tran_id) - unique per provider
    event_type = Column(String(50), nullable=True)  # payment.succeeded, payment.failed, ...

    # received | processed | error | ignored | signature_invalid | failed
    status = Column(String(20), nullable=False, default="received", index=True)
    reason = Column(String(64), nullable=True)  # machine reason e.g. signature_mismatch
    processing_note = Column(String(500), nullable=True)

    method = Column(String(10), nullable=True)  # HTTP method
    status_code = Column(Integer, nullable=True)
    duration_ms = Column(Integer, nullable=True)

    resource_type = Column(String(32), nullable=True)  # invoice | payment
    resource_id = Column(Integer, nullable=True, index=True)

    payload = Column(JSON, nullable=True)  # sanitized payload (no raw card numbers)
    headers = Column(JSON, nullable=True)  # sanitized headers (signature fields kept)
    signature_valid = Column(Boolean, default=False)
    ip_address = Column(String(45), nullable=True)

    processed_at = Column(DateTime, nullable=True)
    error_message = Column(String(500), nullable=True)

    created_at = Column(DateTime, default=now_naive, index=True)

    __table_args__ = (
        # Idempotency: only one processed event per provider + event id
        Index("uq_webhook_event_uid", "provider", "event_id", unique=True,
              postgresql_where=text("event_id IS NOT NULL")),
    )