import os
import tiktoken
from contextlib import asynccontextmanager
from fastapi import FastAPI, APIRouter, HTTPException, Request
from routellm.controller import Controller
from pydantic import BaseModel, Field
from fastapi.concurrency import run_in_threadpool
from typing import Union

os.environ["OPENAI_API_KEY"] = os.environ.get("OPENAI_API_KEY",
                                  os.environ.get("OPENAI_TOKEN", ""))

class Model(BaseModel):
    id: str
    label: str

class RoutingRequest(BaseModel):
    prompt: str | list[dict] = Field(..., description="User prompt")
    models: list[Model] = Field(..., min_length=2, description="User models from same provider")
    threshold: float = Field(default=0.11593, description="threshold for cost/quality")

@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.controller = Controller(
        routers=["mf"],
        strong_model="strong-placeholder",
        weak_model="weak-placeholder"
    )
    yield
    app.state.controller = None

router = APIRouter()

MAX_INPUT_TOKENS = 8000
_enc = tiktoken.get_encoding("cl100k_base")

def token_limit(text:str, max_tokens: int = MAX_INPUT_TOKENS) -> str:
    tokens = _enc.encode(text)
    if len(tokens) <= max_tokens:
        return text
    return _enc.decode(tokens[:max_tokens])

def select_model(models: list[Model], win_rate: float, threshold: float) -> str:
    if not models:
        raise ValueError("model list is empty, cannot select model")
    MAX_SCORE = 1.0
    MIN_SCORE = 0.0
    num_models = len(models)
    if num_models == 1:
        return models[0]

    win_rate = max(MIN_SCORE, min(MAX_SCORE, win_rate))
    if win_rate < threshold:
        return models[0]

    scaling = (win_rate - threshold)/(MAX_SCORE - threshold) if threshold < MAX_SCORE else MIN_SCORE
    index = min(int(scaling * num_models), num_models - 1)
    return models[index]

@router.post("")
async def get_routing_decision(request: Request, body: RoutingRequest) -> dict:
    try:
        if isinstance(body.prompt, list):
            prompt_str = "\n".join(
                msg.get("content", "") for msg in body.prompt if isinstance(msg, dict) and "content" in msg
            )
        else:
            prompt_str = body.prompt

        prompt_str = await run_in_threadpool(token_limit, prompt_str)

        mf_router = request.app.state.controller.routers["mf"]
        win_rate = await run_in_threadpool(lambda: float(mf_router.calculate_strong_win_rate(prompt_str)))
        
        selected_model = select_model(body.models, win_rate, body.threshold)

        return {
            "status": "success",
            "selected_model": selected_model,
            "win_rate": win_rate,
            "version": "v1",
            "threshold": body.threshold
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))