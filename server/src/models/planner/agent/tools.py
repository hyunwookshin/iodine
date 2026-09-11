from langchain_core.tools import tool
from langgraph.types import interrupt

@tool
async def suggest_file_edits() -> str:
    return "Suggested file edits success"

@tool
async def plan():
    approved = interrupt({
        "action": "plan",
        "message": "approve plan?"
    })

    if not approved:
        return "Canceled"