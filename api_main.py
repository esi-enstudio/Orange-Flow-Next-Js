from fastapi import FastAPI, Depends, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from typing import List, Optional
from pydantic import BaseModel

from app.Services.db_service import async_session
from app.Models.retailer import Retailer
from app.Models.house import House

app = FastAPI(title="OrangeFlow API for Telegram Mini App")

# CORS Setup (Next.js এর সাথে কানেক্ট করার জন্য জরুরি)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], # প্রোডাকশনে এখানে শুধু আপনার ফ্রন্টএন্ড ইউআরএল দিবেন
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Pydantic Models for Response
class RetailerSchema(BaseModel):
    id: int
    name: str
    retailer_code: Optional[str]
    itop_number: Optional[str]
    thana: Optional[str]
    contact_no: Optional[str]

    class Config:
        from_attributes = True

# Database Dependency
async def get_db():
    async with async_session() as session:
        yield session

@app.get("/")
async def root():
    return {"message": "OrangeFlow API is running"}

@app.get("/api/retailers", response_model=List[RetailerSchema])
async def get_retailers(
    house_id: Optional[int] = None,
    skip: int = 0,
    limit: int = 20,
    search: Optional[str] = None,
    db: AsyncSession = Depends(get_db)
):
    query = select(Retailer)
    
    if house_id:
        query = query.where(Retailer.house_id == house_id)
    
    if search:
        search_pattern = f"%{search}%"
        query = query.where(
            (Retailer.name.ilike(search_pattern)) | 
            (Retailer.retailer_code.ilike(search_pattern)) |
            (Retailer.itop_number.ilike(search_pattern))
        )
    
    query = query.offset(skip).limit(limit).order_by(Retailer.name)
    result = await db.execute(query)
    retailers = result.scalars().all()
    return retailers

@app.get("/api/retailers/{retailer_id}", response_model=RetailerSchema)
async def get_retailer_detail(retailer_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Retailer).where(Retailer.id == retailer_id))
    retailer = result.scalar_one_or_none()
    if not retailer:
        raise HTTPException(status_code=404, detail="Retailer not found")
    return retailer

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
