from pydantic import BaseModel

class PlanRequest(BaseModel):
    """
    Attributes:
    prompt: user prompt to make plan
    """
    prompt: str
