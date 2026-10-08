# -*- coding: utf-8 -*-
"""重建 AKShare 文档 RAG 索引：爬官方文档 -> 按接口切块 -> 生成 chunks.jsonl。

产物 agent/app/akshare_docs_data/chunks.jsonl 是 market_rag.py（fetch_market_data
节点）的检索索引。文档随 AKShare 版本更新，建议升级 requirements.txt 里的 akshare
后重跑本脚本，让 RAG 检索到的接口说明与新版本行为一致。

用法（在 agent/ 目录下）:
    python scripts/build_akshare_rag.py            # 完整流程：爬取 + 切块
    python scripts/build_akshare_rag.py --parse-only   # 只重新切块（复用已爬的 HTML）
    python scripts/build_akshare_rag.py --docs-dir /path/to/akshare_docs

依赖：requests beautifulsoup4 lxml（构建期依赖，运行 agent 服务不需要）。
爬取对站点友好：0.2-0.4 秒随机间隔、限速 2MB/s，全站约 50 个页面。
"""
from __future__ import annotations

import argparse
import json
import random
import re
import shutil
import sys
import time
import urllib.parse
from pathlib import Path

AGENT_DIR = Path(__file__).resolve().parent.parent
DEFAULT_DOCS_DIR = AGENT_DIR / ".akshare_docs_cache"
OUTPUT_FILE = AGENT_DIR / "app" / "akshare_docs_data" / "chunks.jsonl"

DOCS_BASE = "https://akshare.akfamily.xyz"
ENTRY_PAGE = "https://akshare.akfamily.xyz/index.html"

SKIP_FILES = {"search.html", "genindex.html", "changelog.html"}
MAX_PAGES = 200  # 安全阀：防止站点结构变化导致爬取范围失控


# ---------------------------------------------------------------- 爬取 ----


def fetch_page(session, url: str) -> str:
    for attempt in range(3):
        try:
            resp = session.get(url, timeout=30)
            resp.raise_for_status()
            return resp.text
        except Exception as exc:
            if attempt == 2:
                raise RuntimeError(f"抓取 {url} 失败: {exc}") from exc
            time.sleep(1.5 * (attempt + 1))
    raise RuntimeError("unreachable")


def crawl_docs(docs_dir: Path) -> int:
    """从入口页出发 BFS 抓取全站 .html，保持目录结构，返回页面数。"""
    import requests

    docs_dir.mkdir(parents=True, exist_ok=True)
    session = requests.Session()
    session.headers["User-Agent"] = "3x-agent-doc-index-builder/1.0"

    seen: set[str] = set()
    queue = [ENTRY_PAGE]
    n_saved = 0
    while queue and n_saved < MAX_PAGES:
        url = queue.pop(0)
        if url in seen:
            continue
        seen.add(url)

        html = fetch_page(session, url)
        rel = urllib.parse.urlparse(url).path.lstrip("/")
        target = docs_dir / (rel or "index.html")
        if not target.resolve().is_relative_to(docs_dir.resolve()):
            continue  # 路径逃逸防御
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(html, encoding="utf-8")
        n_saved += 1
        if n_saved % 10 == 0:
            print(f"  已抓取 {n_saved} 页…", file=sys.stderr)

        # 站内同域 .html 链接入队；静态资源与锚点不抓
        for href in re.findall(r'href="([^"#]+?\.html?)"', html):
            if href.startswith(("http://", "https://")):
                if not href.startswith(DOCS_BASE):
                    continue
                absu = href
            else:
                absu = urllib.parse.urljoin(url, href)
            path = urllib.parse.urlparse(absu).path
            if path.startswith(("http://", "https://")) or not path.endswith(".html"):
                continue
            normalized = DOCS_BASE + path
            if normalized not in seen and normalized not in queue:
                queue.append(normalized)

        time.sleep(random.uniform(0.2, 0.4))
    return n_saved


# ---------------------------------------------------------------- 切块 ----


def clean_text(text: str) -> str:
    text = re.sub(r"[ \t\xa0]+", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def table_to_text(table) -> str:
    """<table> -> '表头 / 表头 \\n 值 / 值' 紧凑文本，保留参数表语义。"""
    rows = []
    for tr in table.find_all("tr"):
        cells = [clean_text(td.get_text(" ", strip=True)) for td in tr.find_all(["th", "td"])]
        if cells:
            rows.append(cells)
    if not rows:
        return ""
    return "\n".join(" / ".join(r) for r in rows)


def section_chunks(section, source: str, breadcrumb: list[str]) -> list[dict]:
    """递归切 <section>：AKShare 文档每个接口条目是独立 section，天然成块。"""
    from bs4 import BeautifulSoup, Tag

    chunks = []
    title_el = section.find(["h1", "h2", "h3", "h4", "h5", "h6"], recursive=False)
    title = clean_text(title_el.get_text(" ", strip=True)) if title_el else ""
    path = breadcrumb + ([title] if title else [])

    parts: list[str] = []
    for el in section.children:
        if not isinstance(el, Tag):
            text = clean_text(str(el).strip())
            if text:
                parts.append(text)
            continue
        if el.name in ("h1", "h2", "h3", "h4", "h5", "h6", "section"):
            continue
        if el.name == "table":
            t = table_to_text(el)
            if t:
                parts.append(t)
            continue
        if el.name == "div" and "highlight" in " ".join(el.get("class", [])):
            parts.append("[代码]\n" + clean_text(el.get_text("\n", strip=False)))
            continue
        text = clean_text(el.get_text(" ", strip=True))
        if text:
            parts.append(text)

    if parts:
        header = f"[{source}]" if not path else f"[{' > '.join(path)}]"
        chunks.append({"source": source, "title": " > ".join(path) or "(无标题)", "text": f"{header} {'\n'.join(parts)}"})

    for child in section.find_all("section", recursive=False):
        chunks.extend(section_chunks(child, source, path))
    return chunks


def parse_docs(docs_dir: Path, out_file: Path) -> tuple[int, int]:
    from bs4 import BeautifulSoup

    n_files, n_chunks = 0, 0
    out_file.parent.mkdir(parents=True, exist_ok=True)
    with out_file.open("w", encoding="utf-8") as out:
        for page in sorted(docs_dir.rglob("*.html")):
            rel = page.relative_to(docs_dir).as_posix()
            if rel in SKIP_FILES or page.name.startswith("_"):
                continue
            soup = BeautifulSoup(page.read_text(encoding="utf-8", errors="ignore"), "lxml")
            main_div = soup.find("div", role="main") or soup.body
            top = main_div and (main_div.find("section", recursive=False) or main_div.find("section"))
            if top is None:
                continue
            n_files += 1
            for chunk in section_chunks(top, rel, []):
                out.write(json.dumps(chunk, ensure_ascii=False) + "\n")
                n_chunks += 1
    return n_files, n_chunks


def validate_index(out_file: Path) -> None:
    """产物必须能检索到核心业务接口，否则视为构建失败（防文档改版静默劣化）。"""
    sys.path.insert(0, str(AGENT_DIR))
    try:
        from app.market_rag import search_interfaces
    except ImportError:
        print("  跳过索引校验（agent 运行依赖未安装）", file=sys.stderr)
        return
    for query, expected in (
        ("上海黄金交易所Au99.99历史行情", "spot_hist_sge"),
        ("美股历史K线", None),
    ):
        hits = search_interfaces(query, topk=3)
        names = [h["interface"] for h in hits]
        if expected and expected not in names:
            raise RuntimeError(f"索引校验失败：{query!r} 未命中 {expected}，命中 {names}")
        if not hits:
            raise RuntimeError(f"索引校验失败：{query!r} 无任何命中")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--docs-dir", type=Path, default=DEFAULT_DOCS_DIR, help="HTML 缓存目录")
    ap.add_argument("--parse-only", action="store_true", help="跳过爬取，只重新切块")
    ap.add_argument("--keep-html", action="store_true", help="构建后保留 HTML 缓存（默认清理）")
    args = ap.parse_args()

    if not args.parse_only:
        if args.docs_dir.exists():
            shutil.rmtree(args.docs_dir)
        print(f"[1/3] 抓取 {DOCS_BASE} …", file=sys.stderr)
        n = crawl_docs(args.docs_dir)
        print(f"  共 {n} 页 -> {args.docs_dir}", file=sys.stderr)
    else:
        if not args.docs_dir.exists():
            sys.exit(f"HTML 缓存目录不存在：{args.docs_dir}（先完整跑一次）")

    print("[2/3] 切块 …", file=sys.stderr)
    n_files, n_chunks = parse_docs(args.docs_dir, OUTPUT_FILE)
    if n_files == 0 or n_chunks < 500:
        sys.exit(f"切块结果异常（{n_files} 页 / {n_chunks} 块），疑似文档结构变化，拒绝覆盖现有索引")
    print(f"  {n_files} 页 -> {n_chunks} 块 -> {OUTPUT_FILE}", file=sys.stderr)

    print("[3/3] 校验索引 …", file=sys.stderr)
    validate_index(OUTPUT_FILE)

    if not args.keep_html:
        shutil.rmtree(args.docs_dir, ignore_errors=True)
    print(f"完成：{OUTPUT_FILE}（{OUTPUT_FILE.stat().st_size // 1024} KB）", file=sys.stderr)


if __name__ == "__main__":
    main()
