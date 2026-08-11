# Agent

独立的 LangGraph AI Agent 服务。

## 启动

```bash
cd agent
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
uvicorn app.main:app --host 0.0.0.0 --port 8010
```

## 接口

- `GET /health`
- `POST /prompt`

