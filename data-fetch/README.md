# Data Fetch

基于 AkShare 的金融数据同步服务，直接写入当前项目使用的 MySQL 表：

- `precious_metal_snapshots`
- `tech_market_snapshots`

## 本地运行

```bash
cd data-fetch
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
python -m app.main once
```

持续轮询：

```bash
python -m app.main loop
```

