from fastapi import APIRouter
from server.src.models.route.router import router as route_router

routes = APIRouter(prefix="/api")

routes.include_router(route_router, prefix="/route", tags=["route"])