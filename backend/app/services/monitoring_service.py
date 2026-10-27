import logging
import asyncio
import os
from datetime import datetime, timedelta
from typing import List, Dict, Any, Optional
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, desc, func, and_

from app.models.system_monitoring import (
    SystemMetricSample,
    ContainerMetricSample,
    MonitoringAlert,
    AutomationJobRecord,
)
from app.models.house import House
from app.utils.timezone import now_naive

logger = logging.getLogger(__name__)

try:
    import psutil
except ImportError:  # optional probe dependency — never take the whole API down for monitoring
    psutil = None
    logger.warning(
        "psutil is not installed; system monitoring metrics collection is disabled. "
        "Rebuild the backend image after requirements.txt changes."
    )

async def collect_and_store_metrics(db: AsyncSession):
    """Collect host and container metrics, evaluate thresholds, and store samples."""
    if psutil is None:
        # Monitoring is optional: skip silently (the import already warned once).
        return
    try:
        # 1. Host System Metrics
        cpu_percent = psutil.cpu_percent(interval=1)
        cpu_count = psutil.cpu_count(logical=True) or 1

        load_1m, load_5m, load_15m = (None, None, None)
        try:
            if hasattr(os, "getloadavg"):
                load_1m, load_5m, load_15m = os.getloadavg()
        except Exception:
            pass

        mem = psutil.virtual_memory()
        ram_total = mem.total
        ram_used = mem.used
        ram_percent = mem.percent

        swap = psutil.swap_memory()
        swap_total = swap.total
        swap_used = swap.used
        swap_percent = swap.percent

        disk = psutil.disk_usage('/')
        disk_total = disk.total
        disk_used = disk.used
        disk_percent = disk.percent

        net = psutil.net_io_counters()
        net_sent = net.bytes_sent if net else 0
        net_recv = net.bytes_recv if net else 0

        boot_time = psutil.boot_time()
        uptime = datetime.now().timestamp() - boot_time

        system_sample = SystemMetricSample(
            cpu_percent=cpu_percent,
            cpu_count=cpu_count,
            load_1m=load_1m,
            load_5m=load_5m,
            load_15m=load_15m,
            ram_total=ram_total,
            ram_used=ram_used,
            ram_percent=ram_percent,
            swap_total=swap_total,
            swap_used=swap_used,
            swap_percent=swap_percent,
            disk_total=disk_total,
            disk_used=disk_used,
            disk_percent=disk_percent,
            net_sent=net_sent,
            net_recv=net_recv,
            uptime=uptime,
            timestamp=now_naive()
        )
        db.add(system_sample)

        # 2. Container Metrics (Docker via python docker SDK or fallback)
        containers_data = await _get_docker_containers_stats()
        for c in containers_data:
            c_sample = ContainerMetricSample(
                container_id=c.get("container_id", "unknown"),
                container_name=c.get("container_name", "unknown"),
                status=c.get("status", "unknown"),
                cpu_percent=c.get("cpu_percent", 0.0),
                memory_usage=c.get("memory_usage", 0),
                memory_limit=c.get("memory_limit", 0),
                memory_percent=c.get("memory_percent", 0.0),
                restart_count=c.get("restart_count", 0),
                timestamp=now_naive()
            )
            db.add(c_sample)

        # 3. Evaluate Thresholds & Alerts
        await _evaluate_alerts(db, cpu_percent, ram_percent, disk_percent, containers_data)

        await db.commit()
    except Exception as e:
        logger.error(f"Error collecting system monitoring metrics: {e}", exc_info=True)
        await db.rollback()


async def _get_docker_containers_stats() -> List[Dict[str, Any]]:
    """Inspect docker containers if docker socket is available."""
    containers = []
    try:
        import docker
        client = docker.from_env(timeout=2)
        docker_containers = client.containers.list(all=True)
        for dc in docker_containers:
            name = dc.name
            c_id = dc.id[:12]
            status = dc.status
            restart_count = 0
            try:
                restart_count = dc.attrs.get("RestartCount", 0)
            except Exception:
                pass

            cpu_pct = 0.0
            mem_usage = 0
            mem_limit = 0
            mem_pct = 0.0
            try:
                stats = dc.stats(stream=False)
                # Parse stats JSON if running
                if status == "running":
                    # basic cpu calculation approx from stats
                    cpu_stats = stats.get("cpu_stats", {})
                    precpu_stats = stats.get("precpu_stats", {})
                    cpu_delta = cpu_stats.get("cpu_usage", {}).get("total_usage", 0) - precpu_stats.get("cpu_usage", {}).get("total_usage", 0)
                    system_delta = cpu_stats.get("system_cpu_usage", 0) - precpu_stats.get("system_cpu_usage", 0)
                    default_cpus = (psutil.cpu_count(logical=True) if psutil else None) or 1
                    online_cpus = cpu_stats.get("online_cpus", default_cpus)
                    if system_delta > 0 and cpu_delta > 0:
                        cpu_pct = round((cpu_delta / system_delta) * online_cpus * 100.0, 2)

                    mem_stats = stats.get("memory_stats", {})
                    mem_usage = mem_stats.get("usage", 0)
                    mem_limit = mem_stats.get("limit", 0)
                    if mem_limit > 0:
                        mem_pct = round((mem_usage / mem_limit) * 100.0, 2)
            except Exception:
                pass

            containers.append({
                "container_id": c_id,
                "container_name": name,
                "status": status,
                "cpu_percent": cpu_pct,
                "memory_usage": mem_usage,
                "memory_limit": mem_limit,
                "memory_percent": mem_pct,
                "restart_count": restart_count,
            })
    except Exception:
        # Fallback if docker python library or socket is not present
        pass
    return containers


async def _evaluate_alerts(db: AsyncSession, cpu_pct: float, ram_pct: float, disk_pct: float, containers: List[Dict[str, Any]]):
    """Check thresholds and create/resolve monitoring alerts."""
    now_time = now_naive()

    # CPU Alert
    if cpu_pct >= 90.0:
        await _trigger_or_update_alert(db, "critical", "cpu", "High CPU Usage", f"Host CPU usage is critically high at {cpu_pct}%")
    elif cpu_pct >= 75.0:
        await _trigger_or_update_alert(db, "warning", "cpu", "Elevated CPU Usage", f"Host CPU usage is elevated at {cpu_pct}%")
    else:
        await _resolve_alert_by_category(db, "cpu")

    # RAM Alert
    if ram_pct >= 92.0:
        await _trigger_or_update_alert(db, "critical", "ram", "Critical Memory Usage", f"RAM usage is critically high at {ram_pct}%")
    elif ram_pct >= 85.0:
        await _trigger_or_update_alert(db, "warning", "ram", "High Memory Usage", f"RAM usage is high at {ram_pct}%")
    else:
        await _resolve_alert_by_category(db, "ram")

    # Disk Alert
    if disk_pct >= 92.0:
        await _trigger_or_update_alert(db, "critical", "disk", "Disk Space Critical", f"Root partition disk usage is critical at {disk_pct}%")
    elif disk_pct >= 85.0:
        await _trigger_or_update_alert(db, "warning", "disk", "Disk Space Warning", f"Root partition disk usage is high at {disk_pct}%")
    else:
        await _resolve_alert_by_category(db, "disk")

    # Container Alerts
    for c in containers:
        c_name = c["container_name"]
        if c["status"] not in ("running", "healthy"):
            await _trigger_or_update_alert(
                db, "critical", "container",
                f"Container Unhealthy/Stopped: {c_name}",
                f"Container {c_name} status is {c['status']}."
            )
        elif c["restart_count"] > 5:
            await _trigger_or_update_alert(
                db, "warning", "container",
                f"Frequent Container Restarts: {c_name}",
                f"Container {c_name} has restarted {c['restart_count']} times."
            )


async def _trigger_or_update_alert(db: AsyncSession, severity: str, category: str, title: str, message: str):
    stmt = select(MonitoringAlert).where(
        and_(MonitoringAlert.category == category, MonitoringAlert.status == "active")
    )
    res = await db.execute(stmt)
    alert = res.scalars().first()
    if alert:
        alert.severity = severity
        alert.title = title
        alert.message = message
        alert.last_detected_at = now_naive()
    else:
        new_alert = MonitoringAlert(
            severity=severity,
            category=category,
            title=title,
            message=message,
            status="active",
            first_detected_at=now_naive(),
            last_detected_at=now_naive()
        )
        db.add(new_alert)


async def _resolve_alert_by_category(db: AsyncSession, category: str):
    stmt = select(MonitoringAlert).where(
        and_(MonitoringAlert.category == category, MonitoringAlert.status == "active")
    )
    res = await db.execute(stmt)
    alerts = res.scalars().all()
    for alert in alerts:
        alert.status = "resolved"
        alert.resolved_at = now_naive()


async def get_system_health_summary(db: AsyncSession) -> Dict[str, Any]:
    """Return comprehensive system health summary for the monitoring dashboard."""
    # Latest system sample
    sys_stmt = select(SystemMetricSample).order_by(desc(SystemMetricSample.timestamp)).limit(1)
    sys_res = await db.execute(sys_stmt)
    latest_sys = sys_res.scalars().first()

    # Latest container samples (group by container_name)
    subq = select(
        ContainerMetricSample.container_name,
        func.max(ContainerMetricSample.timestamp).label("max_ts")
    ).group_by(ContainerMetricSample.container_name).subquery()

    cont_stmt = select(ContainerMetricSample).join(
        subq,
        and_(
            ContainerMetricSample.container_name == subq.c.container_name,
            ContainerMetricSample.timestamp == subq.c.max_ts
        )
    )
    cont_res = await db.execute(cont_stmt)
    latest_containers = cont_res.scalars().all()

    # Active alerts
    alerts_stmt = select(MonitoringAlert).where(MonitoringAlert.status == "active").order_by(desc(MonitoringAlert.last_detected_at))
    alerts_res = await db.execute(alerts_stmt)
    active_alerts = alerts_res.scalars().all()

    # Automation jobs summary (last 24 hours)
    cutoff_24h = now_naive() - timedelta(hours=24)
    jobs_count_stmt = select(
        AutomationJobRecord.status,
        func.count(AutomationJobRecord.id)
    ).where(AutomationJobRecord.created_at >= cutoff_24h).group_by(AutomationJobRecord.status)
    jobs_res = await db.execute(jobs_count_stmt)
    job_stats = {status: count for status, count in jobs_res.all()}

    # House monitoring status overview
    houses_stmt = select(House)
    houses_res = await db.execute(houses_stmt)
    houses = houses_res.scalars().all()

    house_overviews = []
    for h in houses:
        # Last successful sync for house
        last_sync_stmt = select(AutomationJobRecord).where(
            and_(AutomationJobRecord.house_id == h.id, AutomationJobRecord.status == "success")
        ).order_by(desc(AutomationJobRecord.completed_at)).limit(1)
        last_sync_res = await db.execute(last_sync_stmt)
        last_sync = last_sync_res.scalars().first()

        # Failed jobs count in 24h
        failed_count_stmt = select(func.count(AutomationJobRecord.id)).where(
            and_(AutomationJobRecord.house_id == h.id, AutomationJobRecord.status == "failed", AutomationJobRecord.created_at >= cutoff_24h)
        )
        failed_res = await db.execute(failed_count_stmt)
        failed_jobs = failed_res.scalar() or 0

        house_overviews.append({
            "house_id": h.id,
            "house_code": h.code,
            "house_name": h.name,
            "is_active": getattr(h, "is_active", True),
            "last_successful_sync": last_sync.completed_at if last_sync else None,
            "last_job_type": last_sync.job_type if last_sync else None,
            "failed_jobs_24h": failed_jobs,
            "status": "healthy" if failed_jobs == 0 else ("warning" if failed_jobs < 3 else "critical")
        })

    return {
        "system": {
            "cpu_percent": latest_sys.cpu_percent if latest_sys else 0.0,
            "cpu_count": latest_sys.cpu_count if latest_sys else 1,
            "load_average": [latest_sys.load_1m, latest_sys.load_5m, latest_sys.load_15m] if latest_sys else [0, 0, 0],
            "ram_total": latest_sys.ram_total if latest_sys else 0,
            "ram_used": latest_sys.ram_used if latest_sys else 0,
            "ram_percent": latest_sys.ram_percent if latest_sys else 0.0,
            "swap_percent": latest_sys.swap_percent if latest_sys else 0.0,
            "disk_total": latest_sys.disk_total if latest_sys else 0,
            "disk_used": latest_sys.disk_used if latest_sys else 0,
            "disk_percent": latest_sys.disk_percent if latest_sys else 0.0,
            "net_sent": latest_sys.net_sent if latest_sys else 0,
            "net_recv": latest_sys.net_recv if latest_sys else 0,
            "uptime": latest_sys.uptime if latest_sys else 0.0,
            "timestamp": latest_sys.timestamp if latest_sys else now_naive()
        },
        "containers": [
            {
                "container_id": c.container_id,
                "container_name": c.container_name,
                "status": c.status,
                "cpu_percent": c.cpu_percent,
                "memory_usage": c.memory_usage,
                "memory_limit": c.memory_limit,
                "memory_percent": c.memory_percent,
                "restart_count": c.restart_count,
                "timestamp": c.timestamp
            } for c in latest_containers
        ],
        "browser_automation": {
            "status": "running",
            "browser_type": "Chromium (Playwright)",
            "active_contexts": 1,
            "session_manager_status": "ready",
            "consecutive_failures": 0,
            "last_restart_at": None
        },
        "alerts": [
            {
                "id": a.id,
                "severity": a.severity,
                "category": a.category,
                "title": a.title,
                "message": a.message,
                "status": a.status,
                "first_detected_at": a.first_detected_at,
                "last_detected_at": a.last_detected_at,
            } for a in active_alerts
        ],
        "automation_jobs_24h": job_stats,
        "houses": house_overviews
    }


async def get_historical_metrics(db: AsyncSession, hours: int = 24) -> List[Dict[str, Any]]:
    """Get time-series system metric samples for charts."""
    cutoff = now_naive() - timedelta(hours=hours)
    stmt = select(SystemMetricSample).where(SystemMetricSample.timestamp >= cutoff).order_by(SystemMetricSample.timestamp.asc())
    res = await db.execute(stmt)
    samples = res.scalars().all()

    # Downsample if too many points to keep JSON response compact
    step = max(1, len(samples) // 100)
    filtered = samples[::step]

    return [
        {
            "timestamp": s.timestamp.isoformat(),
            "cpu_percent": s.cpu_percent,
            "ram_percent": s.ram_percent,
            "disk_percent": s.disk_percent,
            "load_1m": s.load_1m
        } for s in filtered
    ]
