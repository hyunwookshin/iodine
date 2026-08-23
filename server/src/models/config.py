import os
from dotenv import load_dotenv

load_dotenv()

class Setting:
    OPEN_AI_KEY: str = os.getenv("OPENAI_API_KEY")

setting = Setting()
