from fastapi import APIRouter
# from services.ai_planning import router as plan_router
from services.route_llm import router as route_router

api_router = APIRouter(prefix="/api")

# api_router.include_router(plan_router, prefix="/plan")
api_router.include_router(route_router, prefix="/route")