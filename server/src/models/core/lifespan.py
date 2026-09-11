from fastapi import FastAPI
from contextlib import asynccontextmanager

from concurrent.futures import ProcessPoolExecutor
from route_llm.controller import Controller

from server.src.models.core.config import setting
from planner.agent.graph import create_agent_graph


@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.controller = Controller(
        routers=["mf"],
        strong_model="strong-placeholder",
        weak_model="weak-placeholder"
    )
    app.state.agent = create_agent_graph()
    app.state.process_pool = ProcessPoolExecutor()
    yield

    app.state.controller = None
    app.state.pool.shutdown(wait=True)
    app.state.agent = None