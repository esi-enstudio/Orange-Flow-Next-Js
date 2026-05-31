from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Header
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import joinedload, selectinload

from app.Routers.deps import get_db, has_permission, get_house_context, get_current_user
from app.Schemas.filter import FilterTagSchema, FilterTagCreate, RetailerFilterSchema, RetailerFilterCreate, RetailerFilterBulkCreate, ExcludedProductSchema, ExcludedProductCreate
from app.Models.ga_filter import FilterTag, RetailerFilter
from app.Models.product_exclusion import ExcludedProductCode
from app.Models.retailer import Retailer
from app.Models.employee import Employee
from app.Models.user import User
from app.Models.house import House
from app.Utils.access_control import is_admin_user

router = APIRouter(prefix="/api", tags=["filters"])

@router.get("/filter-tags", response_model=list[FilterTagSchema])
async def list_filter_tags(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("view_retailers")),
    house_id: Optional[int] = Depends(get_house_context)
):
    query = select(FilterTag)
    is_admin = is_admin_user(current_user)
    if house_id:
        query = query.where(FilterTag.house_id == house_id)
    elif not is_admin:
        user_house_ids = [h.id for h in current_user.houses]
        if user_house_ids:
            query = query.where(FilterTag.house_id.in_(user_house_ids))
        else:
            query = query.where(FilterTag.house_id == -1)
    result = await db.execute(query.order_by(FilterTag.name))
    return result.scalars().all()

@router.post("/filter-tags", response_model=FilterTagSchema)
async def create_filter_tag(
    tag_data: FilterTagCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("edit_retailers")),
    x_house_id: Optional[int] = Header(None, alias="X-House-ID")
):
    target_house_id = tag_data.house_id or x_house_id
    if not target_house_id:
        user_house_ids = [h.id for h in current_user.houses]
        if user_house_ids:
            target_house_id = user_house_ids[0]
        else:
            first_house = (await db.execute(select(House).limit(1))).scalar_one_or_none()
            if first_house:
                target_house_id = first_house.id
            else:
                raise HTTPException(status_code=400, detail="No house found. Please create a house first or specify house_id.")
    existing = (await db.execute(select(FilterTag).where(FilterTag.house_id == target_house_id, FilterTag.name == tag_data.name))).scalar_one_or_none()
    if existing:
        raise HTTPException(status_code=400, detail=f"Tag '{tag_data.name}' already exists in this house")
    new_tag = FilterTag(house_id=target_house_id, name=tag_data.name)
    db.add(new_tag)
    await db.commit()
    await db.refresh(new_tag)
    return new_tag

@router.delete("/filter-tags/{tag_id}")
async def delete_filter_tag(
    tag_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("edit_retailers"))
):
    result = await db.execute(select(FilterTag).where(FilterTag.id == tag_id))
    tag = result.scalar_one_or_none()
    if not tag:
        raise HTTPException(status_code=404, detail="Tag not found")
    await db.execute(RetailerFilter.__table__.delete().where(RetailerFilter.tag == tag.name, RetailerFilter.house_id == tag.house_id))
    await db.delete(tag)
    await db.commit()
    return {"message": "Tag deleted successfully"}

@router.get("/retailer-filters")
async def list_retailer_filters(
    tag: Optional[str] = None,
    search: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("view_retailers")),
    house_id: Optional[int] = Depends(get_house_context)
):
    query = select(RetailerFilter).options(
        joinedload(RetailerFilter.retailer).joinedload(Retailer.employee).selectinload(Employee.user)
    )
    is_admin = is_admin_user(current_user)
    if house_id:
        query = query.where(RetailerFilter.house_id == house_id)
    elif not is_admin:
        user_house_ids = [h.id for h in current_user.houses]
        if user_house_ids:
            query = query.where(RetailerFilter.house_id.in_(user_house_ids))
        else:
            query = query.where(RetailerFilter.house_id == -1)
    if tag:
        query = query.where(RetailerFilter.tag == tag)
    if search:
        pattern = f"%{search}%"
        query = query.where(RetailerFilter.retailer.has(Retailer.name.ilike(pattern)) | RetailerFilter.retailer.has(Retailer.retailer_code.ilike(pattern)))
    result = await db.execute(query.order_by(RetailerFilter.id.desc()))
    filters = result.unique().scalars().all()
    output = []
    for f in filters:
        item = {"id": f.id, "house_id": f.house_id, "retailer_id": f.retailer_id, "tag": f.tag,
                "created_at": f.created_at.isoformat() if f.created_at else None, "retailer": None}
        if f.retailer:
            emp = f.retailer.employee
            item["retailer"] = {
                "id": f.retailer.id, "name": f.retailer.name, "retailer_code": f.retailer.retailer_code,
                "itop_number": f.retailer.itop_number, "thana": f.retailer.thana, "type": f.retailer.type,
                "employee": {"name": emp.user.name if emp and emp.user else (emp.dms_code if emp else None),
                             "itop_number": emp.itop_number if emp else None} if emp else None
            }
        output.append(item)
    return output

@router.post("/retailer-filters")
async def create_retailer_filter(
    filter_data: RetailerFilterCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("edit_retailers"))
):
    retailer = await db.get(Retailer, filter_data.retailer_id)
    if not retailer:
        raise HTTPException(status_code=404, detail="Retailer not found")
    existing = (await db.execute(select(RetailerFilter).where(
        RetailerFilter.house_id == retailer.house_id,
        RetailerFilter.retailer_id == filter_data.retailer_id,
        RetailerFilter.tag == filter_data.tag
    ))).scalar_one_or_none()
    if existing:
        raise HTTPException(status_code=400, detail="Retailer already has this tag")
    new_filter = RetailerFilter(house_id=retailer.house_id, retailer_id=filter_data.retailer_id, tag=filter_data.tag)
    db.add(new_filter)
    await db.commit()
    await db.refresh(new_filter)
    return {"id": new_filter.id, "house_id": new_filter.house_id, "retailer_id": new_filter.retailer_id, "tag": new_filter.tag, "message": "Retailer tagged successfully"}

@router.post("/retailer-filters/bulk")
async def bulk_create_retailer_filters(
    bulk_data: RetailerFilterBulkCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("edit_retailers"))
):
    count = 0
    errors = []
    for retailer_id in bulk_data.retailer_ids:
        retailer = await db.get(Retailer, retailer_id)
        if not retailer:
            errors.append(f"Retailer {retailer_id} not found")
            continue
        existing = (await db.execute(select(RetailerFilter).where(
            RetailerFilter.house_id == retailer.house_id,
            RetailerFilter.retailer_id == retailer_id,
            RetailerFilter.tag == bulk_data.tag
        ))).scalar_one_or_none()
        if existing:
            continue
        new_filter = RetailerFilter(house_id=retailer.house_id, retailer_id=retailer_id, tag=bulk_data.tag)
        db.add(new_filter)
        count += 1
    await db.commit()
    return {"message": f"{count} retailers tagged successfully", "count": count, "errors": errors}

@router.delete("/retailer-filters/{filter_id}")
async def delete_retailer_filter(
    filter_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("edit_retailers"))
):
    result = await db.execute(select(RetailerFilter).where(RetailerFilter.id == filter_id))
    rf = result.scalar_one_or_none()
    if not rf:
        raise HTTPException(status_code=404, detail="Retailer filter not found")
    await db.delete(rf)
    await db.commit()
    return {"message": "Retailer tag removed successfully"}

# --- Product Code Exclusions ---

@router.get("/product-exclusions", response_model=list[ExcludedProductSchema])
async def list_product_exclusions(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("view_reports")),
):
    result = await db.execute(select(ExcludedProductCode).order_by(ExcludedProductCode.product_code))
    return result.scalars().all()

@router.post("/product-exclusions", response_model=ExcludedProductSchema)
async def create_product_exclusion(
    data: ExcludedProductCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("edit_retailers")),
):
    existing = await db.execute(
        select(ExcludedProductCode).where(ExcludedProductCode.product_code == data.product_code)
    )
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=400, detail=f"Product code '{data.product_code}' is already excluded")
    entry = ExcludedProductCode(product_code=data.product_code)
    db.add(entry)
    await db.commit()
    await db.refresh(entry)
    return entry

@router.delete("/product-exclusions/{exclusion_id}")
async def delete_product_exclusion(
    exclusion_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("edit_retailers")),
):
    result = await db.execute(select(ExcludedProductCode).where(ExcludedProductCode.id == exclusion_id))
    entry = result.scalar_one_or_none()
    if not entry:
        raise HTTPException(status_code=404, detail="Excluded product code not found")
    await db.delete(entry)
    await db.commit()
    return {"message": "Product code exclusion removed"}
