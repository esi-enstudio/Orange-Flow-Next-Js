from sqlalchemy import Column, Integer, String, Float, BigInteger, Text, DateTime, ForeignKey, Index
from sqlalchemy.sql import func
from app.models.base import Base

class SystemMetricSample(Base):
    __tablename__ = "system_metric_samples"

    id = Column(Integer, primary_key=True)
    timestamp = Column(DateTime, server_default=func.now(), index=True)
    cpu_percent = Column(Float, nullable=False, default=0.0)
    cpu_count = Column(Integer, nullable=False, default=1)
    load_1m = Column(Float, nullable=True)
    load_5m = Column(Float, nullable=True)
    load_15m = Column(Float, nullable=True)
    ram_total = Column(BigInteger, nullable=False, default=0)
    ram_used = Column(BigInteger, nullable=False, default=0)
    ram_percent = Column(Float, nullable=False, default=0.0)
    swap_total = Column(BigInteger, nullable=True, default=0)
    swap_used = Column(BigInteger, nullable=True, default=0)
    swap_percent = Column(Float, nullable=True, default=0.0)
    disk_total = Column(BigInteger, nullable=False, default=0)
    disk_used = Column(BigInteger, nullable=False, default=0)
    disk_percent = Column(Float, nullable=False, default=0.0)
    net_sent = Column(BigInteger, nullable=True, default=0)
    net_recv = Column(BigInteger, nullable=True, default=0)
    uptime = Column(Float, nullable=True, default=0.0)

    __table_args__ = (
        Index('idx_system_metric_timestamp', 'timestamp'),
    )


class ContainerMetricSample(Base):
    __tablename__ = "container_metric_samples"

    id = Column(Integer, primary_key=True)
    timestamp = Column(DateTime, server_default=func.now(), index=True)
    container_id = Column(String(100), nullable=False)
    container_name = Column(String(200), nullable=False)
    status = Column(String(50), nullable=False, default="unknown") # running, stopped, restarting, unhealthy
    cpu_percent = Column(Float, nullable=True, default=0.0)
    memory_usage = Column(BigInteger, nullable=True, default=0)
    memory_limit = Column(BigInteger, nullable=True, default=0)
    memory_percent = Column(Float, nullable=True, default=0.0)
    restart_count = Column(Integer, nullable=False, default=0)

    __table_args__ = (
        Index('idx_container_metric_timestamp', 'timestamp'),
        Index('idx_container_metric_name', 'container_name'),
    )


class MonitoringAlert(Base):
    __tablename__ = "monitoring_alerts"

    id = Column(Integer, primary_key=True)
    severity = Column(String(20), nullable=False, default="warning") # warning, critical
    category = Column(String(50), nullable=False, default="system") # cpu, ram, disk, container, automation, browser
    title = Column(String(200), nullable=False)
    message = Column(Text, nullable=False)
    status = Column(String(20), nullable=False, default="active") # active, resolved
    first_detected_at = Column(DateTime, server_default=func.now())
    last_detected_at = Column(DateTime, server_default=func.now())
    resolved_at = Column(DateTime, nullable=True)
    acknowledged_by_id = Column(Integer, ForeignKey('users.id'), nullable=True)
    acknowledged_at = Column(DateTime, nullable=True)

    __table_args__ = (
        Index('idx_monitoring_alert_status', 'status'),
        Index('idx_monitoring_alert_severity', 'severity'),
    )


class AutomationJobRecord(Base):
    __tablename__ = "automation_job_records"

    id = Column(Integer, primary_key=True)
    house_id = Column(Integer, ForeignKey('houses.id'), nullable=True)
    job_type = Column(String(100), nullable=False) # e.g. ga_sync, dms_sync, whatsapp_delivery, sim_issue, activation_report
    job_identifier = Column(String(255), nullable=True)
    status = Column(String(30), nullable=False, default="queued") # queued, running, success, failed, retrying, cancelled
    error_message = Column(Text, nullable=True)
    started_at = Column(DateTime, nullable=True)
    completed_at = Column(DateTime, nullable=True)
    duration_ms = Column(Integer, nullable=True)
    retry_count = Column(Integer, nullable=False, default=0)
    created_at = Column(DateTime, server_default=func.now(), index=True)

    __table_args__ = (
        Index('idx_auto_job_house_id', 'house_id'),
        Index('idx_auto_job_type', 'job_type'),
        Index('idx_auto_job_status', 'status'),
        Index('idx_auto_job_created', 'created_at'),
    )
