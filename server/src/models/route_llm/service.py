import tiktoken
from .schema import Model

MAX_INPUT_TOKENS = 8000
_enc = tiktoken.get_encoding("cl100k_base")

def token_limit(text:str, max_tokens: int = MAX_INPUT_TOKENS) -> str:
    tokens = _enc.encode(text)
    if len(tokens) <= max_tokens:
        return text
    return _enc.decode(tokens[:max_tokens])

def select_model(models: list[Model], win_rate: float, threshold: float) -> str:
    if not models:
        raise ValueError("model list is empty, cannot select model")
    MAX_SCORE = 1.0
    MIN_SCORE = 0.0
    num_models = len(models)
    if num_models == 1:
        return models[0]

    win_rate = max(MIN_SCORE, min(MAX_SCORE, win_rate))
    if win_rate < threshold:
        return models[0]

    scaling = (win_rate - threshold)/(MAX_SCORE - threshold) if threshold < MAX_SCORE else MIN_SCORE
    index = min(int(scaling * num_models), num_models - 1)
    return models[index]