from pydantic import BaseModel
from typing import Optional, List

class ActivationReportSchema(BaseModel):
    total_activations: int
    excluded_count: int
    filtered_total: int
    data: List[dict]
    excluded_tags: List[str] = []
