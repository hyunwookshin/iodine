import os
from dotenv import load_dotenv

load_dotenv()

class Setting:
    OPEN_AI_KEY: str = os.getenv("OPENAI_API_KEY")
    OPEN_AI_TOKEN: str = os.getenv("OPENAI_TOKEN", "")

setting = Setting()
