from langgraph.types import Command

class AgentService:
    def __init__(self,graph):
        self.graph = graph

    async def chat(
        self,
        message: str,
        thread_id: str
    ):
        config = {
            "configurable": {
                "thread_id": thread_id
            }
        }

        return await self.graph.ainvoke(
            {
                "messages": [
                    {
                        "role": "user",
                        "content": message
                    }
                ]
            },
            config = config
        )

    