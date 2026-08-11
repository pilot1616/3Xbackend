from pydantic import BaseModel, Field
from typing import Any


class PromptRequest(BaseModel):
    prompt: str = Field(min_length=1)
    context: dict[str, Any] = Field(default_factory=dict)
    db_scope: str | None = None


class PromptResponse(BaseModel):
    answer: str
    query_summary: str
    sources: list[dict[str, Any]] = Field(default_factory=list)
    error: str = ""

