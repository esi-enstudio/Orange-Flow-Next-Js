from pydantic import BaseModel
from typing import Optional, List, Any, Generic, TypeVar
from fastapi import Query

T = TypeVar("T")

class PaginationParams:
    def __init__(
        self,
        page: int = Query(1, ge=1, description="Current page number"),
        per_page: int = Query(20, ge=1, le=100, description="Items per page"),
        search: Optional[str] = Query(None, description="Search keyword"),
        sort_by: Optional[str] = Query("id", description="Field to sort by"),
        sort_order: Optional[str] = Query("desc", description="asc or desc"),
    ):
        self.page = page
        self.per_page = per_page
        self.search = search
        self.sort_by = sort_by
        self.sort_order = sort_order

class PaginationMeta(BaseModel):
    page: int
    per_page: int
    total: int
    total_pages: int
    has_next: bool
    has_prev: bool

class PaginatedResponse(BaseModel):
    success: bool = True
    data: List[Any]
    pagination: PaginationMeta
