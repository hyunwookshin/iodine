from langchain_openai import ChatOpenAI
from .tools import suggest_file_edits

tools = [
    suggest_file_edits
]

llm = ChatOpenAI(
    model="gpt-5-mini",
    temperature="0.7"
).bind_tools

async def chatbot(state):
    response = await llm.ainvoke(state["messages"])

    return {
        "messages": [response]
    }