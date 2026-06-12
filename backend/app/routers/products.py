import logging
from typing import Optional, List
from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy import select, or_, and_
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.routers.deps import get_db, has_permission, has_any_permission
from app.schemas.product import ProductSchema, ProductCreate, ProductUpdate
from app.models.product import Product, ProductCategory, ProductCodeHistory
from app.models.user import User

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/products", tags=["products"])


@router.get("", response_model=List[ProductSchema])
async def list_products(
    search: Optional[str] = Query(None, description="Search by product code, name, or category"),
    category: Optional[str] = Query(None, description="Filter by category"),
    status: Optional[str] = Query(None, description="Filter by status"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_any_permission(["view_products", "view_lifting"])),
):
    query = select(Product).order_by(Product.category, Product.product_name)

    conditions = []

    if search:
        search_pattern = f"%{search}%"
        conditions.append(
            or_(
                Product.product_code.ilike(search_pattern),
                Product.product_name.ilike(search_pattern),
                Product.category.ilike(search_pattern),
            )
        )

    if category:
        conditions.append(Product.category == category)

    if status:
        conditions.append(Product.status == status)

    if conditions:
        query = query.where(and_(*conditions))

    result = await db.execute(query)
    return result.scalars().all()


@router.get("/categories")
async def get_categories(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("view_products")),
):
    categories = [c.value for c in ProductCategory]
    return {"categories": categories}


@router.get("/filter-options")
async def get_product_filter_options(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("view_products")),
):
    result = await db.execute(select(Product.category).distinct())
    categories = [row[0] for row in result.all() if row[0]]

    result = await db.execute(select(Product.subcategory).distinct().where(Product.subcategory.isnot(None)))
    subcategories = [row[0] for row in result.all() if row[0]]

    return {
        "categories": categories,
        "subcategories": subcategories,
        "statuses": ["Active", "Inactive"],
    }


@router.post("", response_model=ProductSchema, status_code=status.HTTP_201_CREATED)
async def create_product(
    product_data: ProductCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("create_products")),
):
    existing = (await db.execute(select(Product).where(Product.product_code == product_data.product_code))).scalar_one_or_none()
    if existing:
        raise HTTPException(
            status_code=422,
            detail=[{"loc": ["body", "product_code"], "msg": "Product with this code already exists", "type": "value_error"}]
        )

    new_product = Product(**product_data.model_dump())
    db.add(new_product)
    await db.commit()
    await db.refresh(new_product)
    return new_product


@router.get("/{product_id}", response_model=ProductSchema)
async def get_product(
    product_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("view_products")),
):
    result = await db.execute(select(Product).where(Product.id == product_id))
    product = result.scalar_one_or_none()
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")
    return product


@router.put("/{product_id}", response_model=ProductSchema)
async def update_product(
    product_id: int,
    product_data: ProductUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("edit_products")),
):
    result = await db.execute(select(Product).where(Product.id == product_id))
    product = result.scalar_one_or_none()
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")

    if product_data.product_code and product_data.product_code != product.product_code:
        existing = (await db.execute(select(Product).where(Product.product_code == product_data.product_code))).scalar_one_or_none()
        if existing:
            raise HTTPException(
                status_code=422,
                detail=[{"loc": ["body", "product_code"], "msg": "Product code already in use", "type": "value_error"}]
            )

        db.add(ProductCodeHistory(
            product_id=product.id,
            old_code=product.product_code,
            new_code=product_data.product_code,
            changed_by=current_user.id,
        ))

    update_data = product_data.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(product, key, value)

    await db.commit()
    await db.refresh(product)
    return product


@router.delete("/{product_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_product(
    product_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("delete_products")),
):
    result = await db.execute(select(Product).where(Product.id == product_id))
    product = result.scalar_one_or_none()
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")

    await db.delete(product)
    await db.commit()