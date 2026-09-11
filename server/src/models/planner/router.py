from fastapi import APIRouter, HTTPException, status, Depends

from .schema import PlanRequest
from .dependencies import get_agent

router = APIRouter()

router.post("")
async def get_plan(request: PlanRequest, agent=Depends(get_agent)):
    try:
    except Exception as e:
        