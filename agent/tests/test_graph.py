from app.graph import select_tables_for_prompt


def test_market_prompt_selects_tech_table_without_page_context() -> None:
    tables = ["agent_messages", "ai_daily_snapshots", "precious_metal_snapshots", "tech_market_snapshots"]

    assert select_tables_for_prompt("分析 NVDA 的市盈率和日 K 线", tables) == ["tech_market_snapshots"]


def test_metal_prompt_selects_metal_table() -> None:
    tables = ["ai_daily_snapshots", "precious_metal_snapshots", "tech_market_snapshots"]

    assert select_tables_for_prompt("黄金和白银最近的日线走势", tables) == ["precious_metal_snapshots"]


def test_ai_market_prompt_selects_both_data_domains() -> None:
    tables = ["ai_daily_snapshots", "precious_metal_snapshots", "tech_market_snapshots"]

    assert select_tables_for_prompt("结合 AI 日报分析科技和黄金市场", tables) == [
        "ai_daily_snapshots",
        "precious_metal_snapshots",
        "tech_market_snapshots",
    ]
