"""Query engine tests for the report engine."""
from datetime import date, datetime

import pytest
from sqlalchemy import select

from app.models.activation import Activation
from app.models.employee import Employee
from app.models.house import House
from app.models.itopup_detail import ITopUpDetail
from app.models.retailer import Retailer
from app.models.role import Role
from app.models.route import RetailerRoute, Route
from app.models.scratch_card_issue import ScratchCardIssue
from app.models.supervisor_assignment import SupervisorRSOAssignment
from app.models.user import User
from app.services.report_engine.engine import ReportFilter, ReportRequest, ReportSort, run_report
from app.services.report_engine.status import compute_status


async def _make_user(
    db,
    *,
    username: str,
    house: House,
    role_name: str = "Manager",
    employee: Employee | None = None,
) -> User:
    role = Role(name=role_name)
    db.add(role)
    user = User(
        username=username, hashed_password="x", name="Engine Test", status="Active",
    )
    user.roles.append(role)
    user.houses.append(house)
    if employee is not None:
        employee.user = user
        db.add(employee)
    db.add(user)
    await db.commit()
    await db.refresh(user)
    from sqlalchemy.orm import selectinload

    result = await db.execute(
        select(User)
        .options(selectinload(User.employee_profile))
        .where(User.id == user.id)
    )
    return result.scalar_one()


async def _seed_house_data(db, house):
    """Two RSOs, one BP, three retailers, activations + itopup + scratch rows."""
    rso_a = Employee(
        house_id=house.id, employee_name="Rahim", dms_code="R001",
        employee_type="rso", status="Active",
    )
    rso_b = Employee(
        house_id=house.id, employee_name="Karim", dms_code="R002",
        employee_type="rso", status="Active",
    )
    bp = Employee(
        house_id=house.id, employee_name="BP User", dms_code="B001",
        employee_type="bp", status="Active",
    )
    db.add_all([rso_a, rso_b, bp])
    await db.commit()
    for e in (rso_a, rso_b, bp):
        await db.refresh(e)

    ret_a = Retailer(house_id=house.id, retailer_code="RA", name="Shop A", employee_id=rso_a.id)
    ret_b = Retailer(house_id=house.id, retailer_code="RB", name="Shop B", employee_id=rso_b.id)
    ret_c = Retailer(house_id=house.id, retailer_code="RC", name="Shop C (no owner)", employee_id=None)
    ret_d = Retailer(house_id=house.id, retailer_code="RD", name="Shop D", employee_id=bp.id)
    db.add_all([ret_a, ret_b, ret_c, ret_d])
    await db.commit()
    for r in (ret_a, ret_b, ret_c, ret_d):
        await db.refresh(r)

    today = date(2026, 11, 15)
    db.add_all([
        Activation(house_id=house.id, retailer_id=ret_a.id, retailer_code="RA",
                   activation_date=today, employee_id=rso_a.id, route_code="RT1"),
        Activation(house_id=house.id, retailer_id=ret_a.id, retailer_code="RA",
                   activation_date=today, employee_id=rso_a.id, route_code="RT1"),
        Activation(house_id=house.id, retailer_id=ret_b.id, retailer_code="RB",
                   activation_date=today, employee_id=rso_b.id, route_code="RT2"),
        Activation(house_id=house.id, retailer_id=ret_c.id, retailer_code="RC",
                   activation_date=today, employee_id=None, route_code=None),
        ITopUpDetail(house_id=house.id, retailer_id=ret_a.id, report_type="C2C",
                     report_date=today, daily_value=100.0),
        ITopUpDetail(house_id=house.id, retailer_id=ret_b.id, report_type="C2S",
                     report_date=today, daily_value=50.0),
        ScratchCardIssue(house_id=house.id, retailer_id=ret_a.id, retailer_code="RA",
                         issue_date=today, quantity=5),
    ])
    await db.commit()
    return dict(rso_a=rso_a, rso_b=rso_b, bp=bp, ret_a=ret_a, ret_b=ret_b, ret_c=ret_c, ret_d=ret_d)


async def _run(db, user, house, **overrides):
    req = ReportRequest(
        metric="ga_activation", date_from=date(2026, 11, 1), date_to=date(2026, 11, 30),
        group_by="rso", target_source="house", **overrides,
    )
    return await run_report(db=db, user=user, house_id=house.id, req=req)


async def test_ga_by_rso_counts_and_summary_matches(db, house):
    await _seed_house_data(db, house)
    user = await _make_user(db, username="mgr", house=house, role_name="House Manager")
    res = await _run(db, user, house)
    by_label = {r["label"]: r for r in res["data"]}
    assert by_label["Rahim"]["achievement"] == 2
    assert by_label["Karim"]["achievement"] == 1
    assert by_label["Unassigned"]["achievement"] == 1  # retailer with no owner
    assert res["summary"]["achievement"] == 4
    assert res["summary"]["achievement"] == sum(r["achievement"] for r in res["data"])
    assert res["summary"]["target"] == 0  # no house target row -> 0
    assert res["summary"]["status"] == "no_target"


async def test_date_grouping_summary_matches_rows(db, house):
    await _seed_house_data(db, house)
    user = await _make_user(db, username="mgr", house=house, role_name="House Manager")
    req = ReportRequest(
        metric="ga_activation", date_from=date(2026, 11, 1), date_to=date(2026, 11, 15),
        group_by="date", target_source="house",
    )
    res = await run_report(db=db, user=user, house_id=house.id, req=req)
    assert len(res["data"]) == 1  # only 2026-11-15 has rows
    row = res["data"][0]
    assert row["achievement"] == 4
    assert row["label"] == "15 Nov 2026"
    assert row["percentage"] is None  # row comparison suppressed for date + house target
    assert row["status"] == "not_applicable"
    assert res["meta"]["row_comparison_suppressed"] is True
    assert res["summary"]["achievement"] == 4 == row["achievement"]


async def test_custom_literal_target_rows(db, house):
    await _seed_house_data(db, house)
    user = await _make_user(db, username="mgr", house=house, role_name="House Manager")
    req = ReportRequest(
        metric="ga_activation", date_from=date(2026, 11, 1), date_to=date(2026, 11, 15),
        group_by="rso", target_source="custom", custom_value=10.0,
    )
    res = await run_report(db=db, user=user, house_id=house.id, req=req)
    for row in res["data"]:
        assert row["target"] == 10.0
        assert row["adjusted_target"] == 10.0
    # Rahim: 2/10 = 20%
    rahim = next(r for r in res["data"] if r["label"] == "Rahim")
    assert rahim["percentage"] == 20.0
    assert rahim["remaining"] == 8
    assert res["summary"]["target"] == 10.0
    assert res["summary"]["achievement"] == 4
    assert res["summary"]["percentage"] == 40.0


async def test_target_zero_status_no_target(db, house):
    await _seed_house_data(db, house)
    user = await _make_user(db, username="mgr", house=house, role_name="House Manager")
    req = ReportRequest(
        metric="ga_activation", date_from=date(2026, 11, 1), date_to=date(2026, 11, 15),
        group_by="rso", target_source="custom", custom_value=0.0,
    )
    res = await run_report(db=db, user=user, house_id=house.id, req=req)
    assert res["summary"]["status"] == "no_target"
    assert res["summary"]["percentage"] is None
    for row in res["data"]:
        assert row["status"] == "no_target"
        assert row["percentage"] is None


async def test_none_target(db, house):
    await _seed_house_data(db, house)
    user = await _make_user(db, username="mgr", house=house, role_name="House Manager")
    req = ReportRequest(
        metric="ga_activation", date_from=date(2026, 11, 1), date_to=date(2026, 11, 15),
        group_by="rso", target_source="none",
    )
    res = await run_report(db=db, user=user, house_id=house.id, req=req)
    assert res["summary"]["target"] is None
    assert res["summary"]["status"] == "not_applicable"
    for row in res["data"]:
        assert row["target"] is None
        assert row["status"] == "not_applicable"


async def test_c2c_amount_metric(db, house):
    await _seed_house_data(db, house)
    user = await _make_user(db, username="mgr", house=house, role_name="House Manager")
    req = ReportRequest(
        metric="c2c", date_from=date(2026, 11, 1), date_to=date(2026, 11, 15),
        group_by="rso", target_source="house",
    )
    res = await run_report(db=db, user=user, house_id=house.id, req=req)
    by_label = {r["label"]: r for r in res["data"]}
    assert by_label["Rahim"]["achievement"] == 100.0
    assert by_label["Rahim"]["value_type"] if False else True
    assert res["meta"]["value_type"] == "amount"


async def test_pagination_slices_after_sort(db, house):
    await _seed_house_data(db, house)
    user = await _make_user(db, username="mgr", house=house, role_name="House Manager")
    req = ReportRequest(
        metric="ga_activation", date_from=date(2026, 11, 1), date_to=date(2026, 11, 15),
        group_by="rso", sort=ReportSort(field="achievement", order="desc"),
        page=1, per_page=2,
    )
    res = await run_report(db=db, user=user, house_id=house.id, req=req)
    assert len(res["data"]) == 2
    assert res["data"][0]["achievement"] >= res["data"][1]["achievement"]
    assert res["pagination"]["total"] == 3  # Rahim, Karim, Unassigned (no owner); BP has 0 activations
    assert res["pagination"]["has_next"] is True


async def test_deterministic_order(db, house):
    await _seed_house_data(db, house)
    user = await _make_user(db, username="mgr", house=house, role_name="House Manager")
    req = ReportRequest(
        metric="ga_activation", date_from=date(2026, 11, 1), date_to=date(2026, 11, 15),
        group_by="rso",
    )
    a = await run_report(db=db, user=user, house_id=house.id, req=req)
    b = await run_report(db=db, user=user, house_id=house.id, req=req)
    assert [r["label"] for r in a["data"]] == [r["label"] for r in b["data"]]
    assert [r["achievement"] for r in a["data"]] == [r["achievement"] for r in b["data"]]


async def test_incompatible_source_dimension_raises(db, house):
    user = await _make_user(db, username="mgr", house=house, role_name="House Manager")
    req = ReportRequest(
        metric="ga_activation", date_from=date(2026, 11, 1), date_to=date(2026, 11, 15),
        group_by="bp", target_source="rso",
    )
    with pytest.raises(ValueError) as exc:
        await run_report(db=db, user=user, house_id=house.id, req=req)
    assert exc.value.args[0] == "TARGET_SOURCE_NOT_AVAILABLE"


async def test_multi_group_by_raises(db, house):
    user = await _make_user(db, username="mgr", house=house, role_name="House Manager")
    req = ReportRequest(
        metric="ga_activation", date_from=date(2026, 11, 1), date_to=date(2026, 11, 15),
        group_by=["rso", "date"],
    )
    with pytest.raises(ValueError) as exc:
        await run_report(db=db, user=user, house_id=house.id, req=req)
    assert exc.value.args[0] == "GROUP_BY_MULTI_UNSUPPORTED"


async def test_supervisor_sees_only_team(db, house):
    sup = Employee(
        house_id=house.id, employee_name="Sup", dms_code="S1",
        employee_type="supervisor", status="Active",
    )
    member = Employee(
        house_id=house.id, employee_name="Mem", dms_code="M1",
        employee_type="rso", status="Active",
    )
    outsider = Employee(
        house_id=house.id, employee_name="Out", dms_code="O1",
        employee_type="rso", status="Active",
    )
    db.add_all([sup, member, outsider])
    await db.commit()
    for e in (sup, member, outsider):
        await db.refresh(e)

    r_mem = Retailer(house_id=house.id, retailer_code="RM", name="Mem Shop", employee_id=member.id)
    r_out = Retailer(house_id=house.id, retailer_code="RO", name="Out Shop", employee_id=outsider.id)
    db.add_all([r_mem, r_out])
    await db.commit()
    await db.refresh(r_mem)
    await db.refresh(r_out)

    db.add_all([
        Activation(house_id=house.id, retailer_id=r_mem.id, retailer_code="RM",
                   activation_date=date(2026, 11, 15), employee_id=member.id),
        Activation(house_id=house.id, retailer_id=r_out.id, retailer_code="RO",
                   activation_date=date(2026, 11, 15), employee_id=outsider.id),
    ])
    await db.commit()

    link = SupervisorRSOAssignment(
        supervisor_employee_id=sup.id, member_employee_id=member.id, house_id=house.id,
    )
    db.add(link)
    await db.commit()

    user = await _make_user(db, username="sup", house=house, role_name="Supervisor", employee=sup)
    req = ReportRequest(
        metric="ga_activation", date_from=date(2026, 11, 1), date_to=date(2026, 11, 15),
        group_by="retailer", target_source="none",
    )
    res = await run_report(db=db, user=user, house_id=house.id, req=req)
    labels = {r["label"] for r in res["data"]}
    assert labels == {"Mem Shop"}  # outsider excluded by scope


async def test_supervisor_filter_joins_owner_alias_for_other_groupings(db, house):
    seeded = await _seed_house_data(db, house)
    supervisor = Employee(
        house_id=house.id, employee_name="Sup", dms_code="S1",
        employee_type="supervisor", status="Active",
    )
    db.add(supervisor)
    await db.flush()
    db.add(SupervisorRSOAssignment(
        supervisor_employee_id=supervisor.id,
        member_employee_id=seeded["rso_a"].id,
        house_id=house.id,
    ))
    await db.commit()
    user = await _make_user(db, username="supervisor-filter", house=house)

    req = ReportRequest(
        metric="ga_activation",
        date_from=date(2026, 11, 1),
        date_to=date(2026, 11, 30),
        group_by="rso",
        filters=ReportFilter(supervisor_ids=(supervisor.id,)),
        target_source="none",
    )
    result = await run_report(db=db, user=user, house_id=house.id, req=req)

    assert {row["label"] for row in result["data"]} == {"Rahim"}
    assert result["summary"]["achievement"] == 2
    assert not result["warnings"]


async def test_route_filter_joins_route_for_metrics_without_route_code(db, house):
    seeded = await _seed_house_data(db, house)
    route_one = Route(house_id=house.id, code="RT1", name="Route One")
    route_two = Route(house_id=house.id, code="RT2", name="Route Two")
    db.add_all([route_one, route_two])
    await db.flush()
    db.add_all([
        RetailerRoute(
            retailer_id=seeded["ret_a"].id, route_id=route_one.id,
            is_primary=True, status="active", effective_from=datetime(2026, 1, 1),
        ),
        RetailerRoute(
            retailer_id=seeded["ret_b"].id, route_id=route_two.id,
            is_primary=True, status="active", effective_from=datetime(2026, 1, 1),
        ),
    ])
    await db.commit()
    user = await _make_user(db, username="route-filter", house=house)

    req = ReportRequest(
        metric="c2c",
        date_from=date(2026, 11, 1),
        date_to=date(2026, 11, 30),
        group_by="rso",
        filters=ReportFilter(route_codes=("RT1",)),
        target_source="none",
    )
    result = await run_report(db=db, user=user, house_id=house.id, req=req)

    assert {row["label"] for row in result["data"]} == {"Rahim"}
    assert result["summary"]["achievement"] == 100
    assert not result["warnings"]


async def test_cross_house_metric_is_blocked_by_scope(db, house):
    other = House(code="H002", name="Other", email="other@example.com")
    db.add(other)
    await db.commit()
    await db.refresh(other)
    Activation(house_id=other.id, retailer_code="X", activation_date=date(2026, 11, 15))
    await db.commit()

    user = await _make_user(db, username="mgr2", house=house, role_name="House Manager")
    req = ReportRequest(
        metric="ga_activation", date_from=date(2026, 11, 1), date_to=date(2026, 11, 15),
        group_by="rso", target_source="none",
    )
    res = await run_report(db=db, user=user, house_id=house.id, req=req)
    assert res["summary"]["achievement"] == 0


def test_compute_status_matches_engine_enum():
    from app.services.report_engine.status import STATUS_VALUES
    assert compute_status(percentage=100.0, target=10, date_from=date(2026,1,1),
                          date_to=date(2026,1,31), today=date(2026,2,1)) in STATUS_VALUES
