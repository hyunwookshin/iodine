import os
from fastapi import APIRouter, HTTPException, Request, status
import asyncio
from server.src.models.core.config import setting
from .service import token_limit, select_model
from .schema import RoutingRequest

os.environ["OPENAI_API_KEY"] = setting.OPEN_AI_TOKEN

router = APIRouter()

@router.post("")
async def get_routing_decision(request: Request, body: RoutingRequest) -> dict:
    try:
        if isinstance(body.prompt, list):
            prompt_str = "\n".join(
                msg.get("content", "") for msg in body.prompt if isinstance(msg, dict) and "content" in msg
            )
        else:
            prompt_str = body.prompt

        loop = asyncio.get_running_loop()

        prompt_str = await loop.run_in_executor(token_limit, prompt_str)
        mf_router = request.app.state.controller.routers["mf"]

        win_rate = await loop.run_in_executor(mf_router.calculate_strong_win_rate, prompt_str)
        win_rate = float(win_rate)
        
        selected_model = select_model(body.models, win_rate, body.threshold)

        return {
            "selected_model": selected_model,
            "win_rate": win_rate,
            "threshold": body.threshold
        }
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, 
            detail=str(e)
        )