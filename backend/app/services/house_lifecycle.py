"""House billing lifecycle: keep `House.is_active` in sync with subscriptions.

Policy
------
- A house whose latest subscription is NOT entitled (expired / cancelled /
  paused / past grace) is automatically deactivated and flagged with
  `deactivated_for_billing = True`.
- A house that was auto-deactivated and later has an entitled subscription
  again (renewal / reactivation / resume) is automatically re-activated.
- Houses without a subscription record are left untouched (legacy fail-open).
- A manual admin deactivation is never overridden: the flag is only set when
  the lifecycle itself flips the house to inactive.

The scheduler (`billing_runner`) runs a full sweep every cycle, and the
subscription service calls `sync_house_billing_state()` for the affected house
so renewals unlock immediately instead of waiting for the next sweep.

Backend request enforcement does NOT rely on this flag: `PlanModuleGuard`
checks the subscription entitlement in real time.
"""

import logging
from typing import Iterable, Optional

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.house import House
from app.models.subscription import HouseSubscription
from app.services import entitlement
from app.utils.timezone import now_naive

logger = logging.getLogger(__name__)


async def sync_house_billing_state(
    db: AsyncSession,
    house_ids: Optional[Iterable[int]] = None,
) -> dict:
    """Deactivate/reactivate houses based on their latest subscription.

    Returns `{"deactivated": n, "reactivated": n}`. Commits the session.
    """
    now = now_naive()
    stats = {"deactivated": 0, "reactivated": 0}

    # Only the newest subscription id per house matters. Filtering in SQL keeps
    # the sweep from loading every historical row once houses renew repeatedly.
    latest_ids_query = select(func.max(HouseSubscription.id)).where(
        HouseSubscription.is_deleted == False  # noqa: E712
    )
    if house_ids is not None:
        ids = [int(h) for h in house_ids]
        if not ids:
            return stats
        latest_ids_query = latest_ids_query.where(HouseSubscription.house_id.in_(ids))
    latest_ids_query = latest_ids_query.group_by(HouseSubscription.house_id)

    sub_query = select(HouseSubscription).where(
        HouseSubscription.id.in_(latest_ids_query)
    )
    subs = (await db.execute(sub_query)).scalars().all()
    latest: dict[int, HouseSubscription] = {sub.house_id: sub for sub in subs}

    if not latest:
        return stats

    houses = (
        await db.execute(select(House).where(House.id.in_(list(latest.keys()))))
    ).scalars().all()
    houses_by_id = {house.id: house for house in houses}

    for house_id, sub in latest.items():
        house = houses_by_id.get(house_id)
        if house is None:
            continue
        if entitlement.is_entitled(sub, now):
            if house.deactivated_for_billing:
                house.is_active = True
                house.deactivated_for_billing = False
                stats["reactivated"] += 1
        else:
            if house.is_active:
                house.is_active = False
                house.deactivated_for_billing = True
                stats["deactivated"] += 1

    await db.commit()

    if stats["deactivated"] or stats["reactivated"]:
        logger.info(
            "House billing sync: %s deactivated, %s reactivated",
            stats["deactivated"], stats["reactivated"],
        )
    return stats
