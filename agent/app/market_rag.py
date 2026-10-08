"""AKShare 文档 RAG 检索：为市场数据节点挑选合适的接口。

索引进程内构建一次（chunks.jsonl 来自本地镜像的 AKShare 官方文档，
按"一个接口一个块"切分），检索用 BM25 + jieba 分词，外加接口名精确
命中与标题加权。这里不依赖任何外部 embedding 服务。
"""
from __future__ import annotations

import json
import re
from functools import lru_cache
from pathlib import Path

import jieba
from rank_bm25 import BM25Okapi

from .akshare_tool import CATALOG

CHUNKS_FILE = Path(__file__).resolve().parent / "akshare_docs_data" / "chunks.jsonl"

IFACE_RE = re.compile(r"\b[a-z]+(?:_[a-z0-9]+)+\b")
_TOKEN_CACHE: dict[str, list[str]] = {}


def tokenize(text: str) -> list[str]:
    """中英文混合分词；接口名（下划线词）整词保留，检索时是强信号。"""
    toks = _TOKEN_CACHE.get(text)
    if toks is not None:
        return toks
    words = jieba.lcut_for_search(text)
    toks = [w.lower() for w in words if w.strip()]
    toks.extend(m.group(0) for m in IFACE_RE.finditer(text.lower()) if "_" in m.group(0))
    _TOKEN_CACHE[text] = toks
    return toks


@lru_cache(maxsize=1)
def _build_index() -> tuple[BM25Okapi, list[tuple[str, str, frozenset[str]]]]:
    """构建 BM25 索引；只保留能映射到白名单接口的块，检索结果可直接执行。"""
    iface_to_chunk: dict[str, str] = {}
    titles: list[tuple[str, str]] = []  # (title, body) 顺序与 chunk 文本一致
    bodies: list[str] = []
    with CHUNKS_FILE.open(encoding="utf-8") as f:
        for line in f:
            chunk = json.loads(line)
            body = chunk["text"]
            m = re.search(r"接口：([a-z][a-z0-9_]*)", body[:200])
            if m and "接口：" in body[:80]:
                # 多个块讲同一接口时保留最完整的一个（默认先到先得）。
                iface_to_chunk.setdefault(m.group(1), body)
            titles.append((chunk["title"], body))
            bodies.append(body)

    bm25 = BM25Okapi([tokenize(b) for b in bodies])
    title_tokens = tuple(frozenset(tokenize(t)) for t, _ in titles)
    return bm25, list(zip([t for t, _ in titles], bodies, title_tokens))


@lru_cache(maxsize=1)
def _catalog_bodies() -> dict[str, str]:
    """白名单接口 -> 该接口的文档块正文。"""
    bm25, entries = _build_index()
    del bm25
    catalog_bodies: dict[str, str] = {}
    for body in (b for _, b, _ in entries):
        m = re.search(r"接口：([a-z][a-z0-9_]*)", body[:200])
        if m and m.group(1) in CATALOG:
            catalog_bodies.setdefault(m.group(1), body)
    return catalog_bodies


def _catalog_synthetic_body(name: str) -> str:
    """目录元数据拼出的合成块：文档缺块时兜底，保证每个白名单接口都可被检索。"""
    fn = CATALOG[name]
    params = "；".join(f"{k}: {v}" for k, v in fn.params.items())
    return f"接口：{name}\n描述：{fn.description}\n输入参数\n{params}"


def search_interfaces(query: str, topk: int = 3) -> list[dict[str, str]]:
    """检索与问题最相关的白名单接口，返回 [{interface, doc}]（含输入/输出参数说明）。"""
    catalog_bodies = _catalog_bodies()
    q_tokens = tokenize(query)

    scores: dict[str, float] = {}
    q_set = {t for t in q_tokens if len(t) >= 2}
    # 用目录合成块建一个轻量索引：块数 = 白名单数（20），开销可忽略。
    names = list(CATALOG)
    corpus = [tokenize(catalog_bodies.get(n) or _catalog_synthetic_body(n)) for n in names]
    bm25 = BM25Okapi(corpus)
    raw = bm25.get_scores(q_tokens)
    avg = sum(raw) / max(len(raw), 1)
    for name, s in zip(names, raw):
        title_hit = sum(1 for t in q_set if t in name.lower())
        scores[name] = float(s) + avg * 0.8 * title_hit

    # 问题里直接点名接口 -> 精确命中置顶。
    ranked = sorted(scores, key=lambda n: scores[n], reverse=True)
    exact = [m.group(0) for m in IFACE_RE.finditer(query.lower()) if m.group(0) in CATALOG]
    ordered = [n for n in exact if n in scores] + [n for n in ranked if n not in exact]

    results: list[dict[str, str]] = []
    for name in ordered[:topk]:
        body = catalog_bodies.get(name) or _catalog_synthetic_body(name)
        results.append({"interface": name, "doc": body[:2500]})
    return results
