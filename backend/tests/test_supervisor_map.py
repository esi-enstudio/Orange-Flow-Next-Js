"""supervisor_map must resolve a member's supervisor from the team pivot.

Regression: Active LSO/SSO reports resolved the supervisor only from
rso_targets.supervisor_id and the user parent chain. Members tagged through the
Supervisors page (supervisor_rso_assignments) but without a linked user account
fell into an "unassigned" bucket, so the page showed the supervisor name on one
RSO row and the WhatsApp Supervisor Summary rendered a second
"Supervisor #None" record for a house that has a single supervisor.
"""
from datetime import date

from app.models.employee import Employee
from app.models.rso_target import RSOTarget
from app.models.supervisor_assignment import SupervisorRSOAssignment
from app.services.active_lso_report_service import supervisor_map

TARGET_DATE = date(2026, 10, 1)


def _employee(house_id: int, name: str, employee_type: str, **overrides) -> Employee:
    return Employee(
        house_id=house_id,
        employee_name=name,
        employee_id=f"{employee_type}-{name}",
        employee_type=employee_type,
        status="Active",
        **overrides,
    )


async def test_pivot_assigns_supervisor_without_a_linked_user(db, house):
    supervisor = _employee(house.id, "Supervisor One", "supervisor")
    rso = _employee(house.id, "RSO One", "rso")
    db.add_all([supervisor, rso])
    await db.flush()
    db.add(
        SupervisorRSOAssignment(
            supervisor_employee_id=supervisor.id,
            member_employee_id=rso.id,
            house_id=house.id,
        )
    )
    await db.commit()

    assert await supervisor_map(db, [rso.id], TARGET_DATE) == {rso.id: supervisor.id}


async def test_monthly_target_supervisor_wins_over_pivot(db, house):
    target_supervisor = _employee(house.id, "Target Supervisor", "supervisor")
    pivot_supervisor = _employee(house.id, "Pivot Supervisor", "supervisor")
    rso = _employee(house.id, "RSO One", "rso")
    db.add_all([target_supervisor, pivot_supervisor, rso])
    await db.flush()
    db.add_all([
        RSOTarget(
            house_id=house.id,
            employee_id=rso.id,
            supervisor_id=target_supervisor.id,
            target_date=TARGET_DATE,
        ),
        SupervisorRSOAssignment(
            supervisor_employee_id=pivot_supervisor.id,
            member_employee_id=rso.id,
            house_id=house.id,
        ),
    ])
    await db.commit()

    assert await supervisor_map(db, [rso.id], TARGET_DATE) == {
        rso.id: target_supervisor.id
    }
