from dotenv import load_dotenv
load_dotenv()

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from routellm.controller import Controller
from contextlib import asynccontextmanager
from services.route_llm import lifespan
from OpenAI import AsyncOpenAI
from api import api_router
from config import setting
from services.planner import SessionManager

CLIENT_BASE = "http://localhost:5173"

@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.controller = Controller(
        routers=["mf"],
        strong_model="strong-placeholder",
        weak_model="weak-placeholder"
    )
    app.state.open_ai_service = AsyncOpenAI(api_key=setting.OPEN_AI_KEY)
    app.state.session_manager = SessionManager()
    yield
    await app.state.session_manager.close_all_request()
    app.state.session_maanger = None
    app.state.controller = None
    app.state.open_ai_service = None

app = FastAPI(title="LLM API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[CLIENT_BASE],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(api_router)