import logging
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.routers.deps import get_db, get_current_user
from app.schemas.todo import TodoCreate, TodoUpdate, TodoSchema
from app.models.user import User
from app.models.todo import Todo

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/todos", tags=["todos"])


@router.get("", response_model=list[TodoSchema])
async def list_todos(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(Todo)
        .where(Todo.user_id == current_user.id)
        .order_by(Todo.created_at.desc())
    )
    return result.scalars().all()


@router.post("", response_model=TodoSchema, status_code=status.HTTP_201_CREATED)
async def create_todo(
    data: TodoCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    todo = Todo(
        title=data.title,
        description=data.description,
        priority=data.priority,
        due_date=data.due_date,
        user_id=current_user.id,
    )
    db.add(todo)
    await db.commit()
    await db.refresh(todo)
    return todo


@router.put("/{todo_id}", response_model=TodoSchema)
async def update_todo(
    todo_id: int,
    data: TodoUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(Todo).where(Todo.id == todo_id, Todo.user_id == current_user.id)
    )
    todo = result.scalar_one_or_none()
    if not todo:
        raise HTTPException(status_code=404, detail="Todo not found")

    update_data = data.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(todo, field, value)

    await db.commit()
    await db.refresh(todo)
    return todo


@router.delete("/{todo_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_todo(
    todo_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(Todo).where(Todo.id == todo_id, Todo.user_id == current_user.id)
    )
    todo = result.scalar_one_or_none()
    if not todo:
        raise HTTPException(status_code=404, detail="Todo not found")

    await db.delete(todo)
    await db.commit()
