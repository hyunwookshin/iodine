from pydantic import BaseModel, Field

class Model(BaseModel):
    """
    AI model

    Attributes:
        id (str):
        label (str):
    """
    id: str
    label: str

class RoutingRequest(BaseModel):
    """
    Payload for selected Model

    Attributes:
        prompt (str): user prompt
        models (list[Model]): a list of model based on same provider
        threshold (float): threshold between cost and quality
    """
    prompt: str | list[dict] = Field(..., description="User prompt")
    models: list[Model] = Field(..., min_length=2, description="User models from same provider")
    threshold: float = Field(default=0.11593, description="threshold for cost/quality")