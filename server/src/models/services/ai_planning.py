from pydantic import BaseModel, Field
from fastapi import APIRouter, HTTPException, Request
from openai import AsyncOpenAI
from config import setting
import asyncio
import websocket
import json

class PlanningRequest(BaseModel):
    session_id: str = Field(..., description="Unique id for a session")
    history: list[str] = Field(default_factory=list)
    description: list[str] = Field(min_length=2)

class PlanResponse(BaseModel):
    plan: list[str]
    explaination: list[str]

class LLMService:
    def __init__(self, service):
        self.service = service

    async def generate_plan(self, user_history: str, user_needs: str) -> dict:
        try:
            response = await self.service.beta.chat.completions.parse(
                model = "gpt-5.6",
                messages = [
                    {
                        "role": "system", 
                        "content": (
                            "You are a system planner, your job is to create an array of a todo list "
                            f"based on user needed task: {user_needs}, if user needs is something simple, dont make a todo list and just return a solution " 
                            "mark the beginning of each step with [] for not started, [~] for in progress, and [x] for completed. For each step, provide a clear explaination reason why it's done this way"
                        )
                    }
                ],
                response_format=PlanResponse,
            )
            
            planner = response.choices[0].message.parsed

            return {
                "status": 200,
                "plan": planner.plan,
                "explaination": planner.explaination
            }
        
        except Exception as e:
            print(f"Error {e}")
            raise e

class SessionAgent:
    def __init__(self, session_id: str, uri: str, service: LLMService):
        self.session_id = session_id
        self.uri = uri
        self.service = service
        self.task_queue = asyncio.Queue()
        self.idle_timeout = 10000
        self.task = None

    async def run(self):
        if not self.task or self.task.done():
            self.task = asyncio.create_task(self._process_queue())

    async def add_task(self, user_history: str, user_needs: str):
        await self.task_queue.put((user_history, user_needs))

    async def _process_queue(self):
        try:
            async with websocket.connection(self.uri) as ws:
                while True:
                    try:
                        user_history, user_needs = await asyncio.wait_for(
                            self.task_queue.get(),
                            timeout = self.idle_timeout
                        )
                    except asyncio.TimeoutError:
                        break

                    try:
                        generate_plan_response = await self.service.generate_plan(user_history, user_needs)

                        playload = {
                            "session_id": self.session_id,
                            "plan": generate_plan_response.plan,
                            "explaination": generate_plan_response.explaination
                        }

                        await ws.send(json.dumps(playload))
                        ack = await ws.recv()

                    except Exception as error_task:
                        print(f"Error on task for session id {self.session_id} task error: {error_task}")

        except Exception as e:
            print("error: ",e)
        finally:
            self.task_queue.task_done()
            self.task = None


class SessionManager:
    def __init__(self, sessions: dict[str, SessionAgent]):
        self.sessions = sessions

    def get_or_create_agent(self, session_id: str, uri: str, service: LLMService) -> SessionAgent:
        if session_id not in self.sessions:
            self.sessions[session_id] = SessionAgent(session_id, uri, service)
        return self.sessions[session_id]

    def close_all_request(self):
        for session in self.sessions.values():
            if session.task and not session.task.done():
                session.task.cancel()
        self.sessions.clear()

router = APIRouter()

@router.post("")
async def get_planning(request: Request ,body: PlanningRequest) -> dict:
    try:
        user_history = " ".join(body.history)
        user_needs = " ".join(body.description)
        uri = "ws://localhost:8000/ws"

        session_manager: SessionManager = request.app.state.session_manager
        open_ai_service: AsyncOpenAI = request.app.state.open_ai_service

        llm_service = LLMService(open_ai_service)

        agent = session_manager.get_or_create_agent(body.session_id, uri, llm_service)
        await agent.add_task(user_history, user_needs)
        await agent.run()
        
        return {
            "status": 200,
            "planner": result.planner,
            "explainations": result.explainations
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
