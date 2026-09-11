from fastapi import Request

def get_agent(request: Request):
    return request.app.state.agent