from langgraph.graph import StateGraph, START, END

from .state import AgentState
from .nodes import chatbot

def create_agent_graph():
    builder = StateGraph(AgentState)
    builder.add_node("chatbot", chatbot)
    builder.add_node(START, "chatbot")
    builder.add_node("chatbot", END)

    return builder.compile()