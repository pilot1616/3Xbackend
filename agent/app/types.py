from pydantic import BaseModel, Field
from typing import Any


class AgentUser(BaseModel):
    id: int
    username: str


class PromptRequest(BaseModel):
    prompt: str = Field(min_length=1)
    context: dict[str, Any] = Field(default_factory=dict)
    db_scope: str | None = None
    # Go 代理转发时附带请求用户；旧客户端不传也不影响请求本身。
    user: AgentUser | None = None


class PromptResponse(BaseModel):
    answer: str
    query_summary: str
    sources: list[dict[str, Any]] = Field(default_factory=list)
    error: str = ""


class ChatRequest(BaseModel):
    conversation_id: str | None = None
    message: str = Field(min_length=1)
    context: dict[str, Any] = Field(default_factory=dict)
    user: AgentUser


class ChatResponse(BaseModel):
    conversation_id: str
    message_id: str
    reply: str
    query_summary: str
    sources: list[dict[str, Any]] = Field(default_factory=list)
    run_id: str
    error: str = ""
