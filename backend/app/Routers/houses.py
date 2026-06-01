from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.Routers.deps import get_db, has_permission, has_any_permission, get_current_user
from app.Schemas.house import HouseSchema, HouseCreate
from app.Models.house import House
from app.Models.user import User
from app.Utils.access_control import is_admin_user

router = APIRouter(prefix="/api/houses", tags=["houses"])


@router.get("/accessible")
async def get_accessible_houses(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    is_admin = is_admin_user(current_user)
    if is_admin:
        result = await db.execute(select(House).order_by(House.name))
        houses = result.scalars().all()
    else:
        houses = current_user.houses
    return [
        {"id": h.id, "name": h.name, "code": h.code, "display_name": f"{h.name} ({h.code})"}
        for h in houses
    ]

@router.get("", response_model=list[HouseSchema])
async def list_houses(db: AsyncSession = Depends(get_db), current_user: User = Depends(has_any_permission(["view_houses", "view_users", "edit_users"]))):
    is_admin = is_admin_user(current_user)
    if is_admin:
        result = await db.execute(select(House).order_by(House.name))
        return result.scalars().all()
    return current_user.houses

@router.post("", response_model=HouseSchema)
async def create_house(house_data: HouseCreate, db: AsyncSession = Depends(get_db), current_user: User = Depends(has_permission("create_houses"))):
    existing = (await db.execute(select(House).where(House.code == house_data.code))).scalar_one_or_none()
    if existing: raise HTTPException(status_code=400, detail="House with this code already exists")
    new_house = House(**house_data.model_dump())
    db.add(new_house)
    await db.commit()
    await db.refresh(new_house)
    return new_house

@router.put("/{house_id}", response_model=HouseSchema)
async def update_house(house_id: int, house_data: HouseCreate, db: AsyncSession = Depends(get_db), current_user: User = Depends(has_permission("edit_houses"))):
    result = await db.execute(select(House).where(House.id == house_id))
    house = result.scalar_one_or_none()
    if not house: raise HTTPException(status_code=404, detail="House not found")
    is_admin = is_admin_user(current_user)
    user_house_ids = [h.id for h in current_user.houses]
    if not is_admin and house_id not in user_house_ids:
        raise HTTPException(status_code=403, detail="You do not have access to edit this house")
    for key, value in house_data.model_dump().items():
        setattr(house, key, value)
    await db.commit()
    await db.refresh(house)
    return house

@router.delete("/{house_id}")
async def delete_house(house_id: int, db: AsyncSession = Depends(get_db), current_user: User = Depends(has_permission("delete_houses"))):
    result = await db.execute(select(House).where(House.id == house_id))
    house = result.scalar_one_or_none()
    if not house: raise HTTPException(status_code=404, detail="House not found")
    await db.delete(house)
    await db.commit()
    return {"message": "House deleted successfully"}
