from __future__ import annotations

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv

load_dotenv()

from .config import settings
from .db import build_engine
from .graph import build_graph
from .types import PromptRequest, PromptResponse


engine = build_engine()
workflow = build_graph(engine)

app = FastAPI(title="3X Agent", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/prompt", response_model=PromptResponse)
def prompt(request: PromptRequest) -> PromptResponse:
    if not settings.llm_api_key:
        raise HTTPException(status_code=500, detail="LLM_API_KEY is not configured")
    try:
        result = workflow.invoke(
            {
                "prompt": request.prompt,
                "context": request.context,
                "db_scope": request.db_scope,
            }
        )
    except Exception as exc:
        return PromptResponse(answer="", query_summary="", sources=[], error=str(exc))

    sources = []
    query_result = result.get("query_result")
    if query_result:
        sources.append(
            {
                "sql": query_result.sql,
                "columns": query_result.columns,
                "rows": query_result.rows,
            }
        )
    return PromptResponse(
        answer=result.get("answer", ""),
        query_summary=result.get("query_summary", ""),
        sources=sources,
        error=result.get("error", ""),
    )


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("app.main:app", host=settings.host, port=settings.port, reload=False)
