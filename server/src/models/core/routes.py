from fastapi import APIRouter
from server.src.models.planner.router import router as plan_router
from server.src.models.route.router import router as route_router

routes = APIRouter(prefix="/api")

routes.include_router(plan_router, prefix="/plan", tags=["plan"])
routes.include_router(route_router, prefix="/route", tags=["route"])