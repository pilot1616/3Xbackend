# -*- coding: utf-8 -*-
"""AI 日报抓取（hex2077.dev）。

解析逻辑对齐 Go 后端 internal/service/ai_daily_sync.go（同一数据源、同一
清洗规则），落库到 ai_daily_snapshots（source+slug 唯一，重复抓取覆盖更新）。
所有远程请求接受协作式中断：检查点在索引页之后、每篇文章之前。
"""
from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from datetime import datetime
from html import unescape
from typing import Any

import requests

from .interrupt import InterruptEvent, Interrupted

DEFAULT_SOURCE_BASE = "https://hex2077.dev"
DEFAULT_INDEX_PATH = "/docs/"
DEFAULT_MAX_ENTRIES = 7
DEFAULT_USER_AGENT = "Mozilla/5.0 (compatible; 3x-data-fetch-ai-daily/1.0)"

TAG_RE = re.compile(r"(?s)<[^>]+>")
SPACE_RE = re.compile(r"\s+")
LINK_RE = re.compile(r'(?is)<a[^>]+href="([^"]*/docs/[^"]+)"[^>]*>(.*?)</a>')
TITLE_RE = re.compile(r"(?is)<h1[^>]*>(.*?)</h1>")
READ_TIME_RE = re.compile(r"(?is)(\d+\s*min(?:ute)?\s*read|阅读\s*\d+\s*分钟)")
HEADING_RE = re.compile(r"(?is)<h2[^>]*>(.*?)</h2>")
PARA_RE = re.compile(r"(?is)<p[^>]*>(.*?)</p>")
LIST_RE = re.compile(r"(?is)<ul[^>]*>(.*?)</ul>")
LIST_ITEM_RE = re.compile(r"(?is)<li[^>]*>(.*?)</li>")
MAIN_RE = re.compile(r"(?is)<main[^>]*>(.*?)</main>")
ARTICLE_RE = re.compile(r"(?is)<article[^>]*>(.*?)</article>")
SECTION_RE = re.compile(r"(?is)<section[^>]*>(.*?)</section>")

CONTENT_MARKERS = ("ai", "openai", "模型", "融资", "发布", "研究", "芯片", "agent")
NOISE_MARKERS = ("导航", "搜索", "ctrl+k", "上一篇", "下一篇", "返回首页", "目录")
PARA_NOISE = (
    "导航", "搜索", "ctrl+k", "上一篇", "下一篇", "返回首页", "展开目录", "收起目录", "目录",
    "ai日报 /", "hex2077", "赞助", "copyright", "访问网页版", "进群交流", "全网数据聚合",
    "前沿科学探索", "行业自由发声", "开源创新力量", "ai与人类未来",
)
NORMALIZE_TAIL_MARKERS = (
    "访问网页版↗️", "进群交流🤙",
    "AI资讯 | 每日早读 | 全网数据聚合 | 前沿科学探索 | 行业自由发声 | 开源创新力量 | AI与人类未来",
)
SUMMARY_CUT_MARKERS = ("产品与功能更新", "今日看点", "重点内容")


@dataclass
class AIDailyPayload:
    source: str
    title: str
    slug: str
    source_url: str
    published_date: str
    summary: str
    read_time: str
    content: str
    sections: list[dict[str, Any]] = field(default_factory=list)
    links: list[dict[str, str]] = field(default_factory=list)
    meta: dict[str, str] = field(default_factory=dict)
    fetched_at: str = ""


def _clean_html(value: str) -> str:
    value = (
        value.replace("&nbsp;", " ")
        .replace("&amp;", "&")
        .replace("&#x27;", "'")
        .replace("&#39;", "'")
        .replace("&quot;", '"')
    )
    return SPACE_RE.sub(" ", TAG_RE.sub(" ", unescape(value))).strip()


def _truncate(value: str, limit: int) -> str:
    return value if limit <= 0 or len(value) <= limit else value[:limit]


def _normalize_text(text: str) -> str:
    text = text.strip()
    for prefix in ("摘要：", "今日摘要："):
        if text.startswith(prefix):
            text = text[len(prefix):]
    for marker in NORMALIZE_TAIL_MARKERS:
        idx = text.find(marker)
        if idx >= 0:
            text = text[:idx]
    text = re.sub(r"阅读时间\s*\d+\s*分钟", "", text)
    text = re.sub(r"AI资讯日报\s*\d{4}/\d{1,2}/\d{1,2}", "", text)
    text = text.strip("\"|,，。:： ")
    return SPACE_RE.sub(" ", text).strip()


def _is_useful_paragraph(text: str, title: str) -> bool:
    if not text:
        return False
    lower = text.lower()
    if any(noise in lower for noise in PARA_NOISE):
        return False
    if title and text == title:
        return False
    if title and lower.startswith((title + " 阅读时间").lower()):
        return False
    return len(text) >= 20


def _extract_date_from_slug(slug: str) -> str:
    for part in reversed(slug.strip("/").split("/")):
        if re.fullmatch(r"\d{4}-\d{2}-\d{2}", part):
            return part
    return ""


def _score_content_scope(segment: str) -> int:
    score = len(PARA_RE.findall(segment)) * 3 + len(HEADING_RE.findall(segment)) * 2
    score += len(LIST_ITEM_RE.findall(segment))
    text = _clean_html(segment).lower()
    score += 4 * sum(1 for m in CONTENT_MARKERS if m in text)
    score -= 5 * sum(1 for n in NOISE_MARKERS if n in text)
    return score


def _content_scope(body: str) -> str:
    candidates = [m.group(1) for m in MAIN_RE.finditer(body)]
    candidates += [m.group(1) for m in ARTICLE_RE.finditer(body)]
    candidates += [m.group(1) for m in SECTION_RE.finditer(body)]
    best, best_score = "", -1
    for candidate in candidates:
        score = _score_content_scope(candidate)
        if score > best_score:
            best, best_score = candidate, score
    return best or body


def _extract_sections(body: str) -> list[dict[str, Any]]:
    sections: list[dict[str, Any]] = []
    headings = list(HEADING_RE.finditer(body))
    for idx, match in enumerate(headings):
        heading = _clean_html(match.group(1))
        if not heading:
            continue
        segment = body[match.end(): headings[idx + 1].start() if idx + 1 < len(headings) else len(body)]
        items: list[str] = []
        for list_block in LIST_RE.finditer(segment):
            for item_match in LIST_ITEM_RE.finditer(list_block.group(1)):
                item = _normalize_text(_clean_html(item_match.group(1)))
                if item:
                    items.append(item)
        sections.append({"heading": heading, "items": items})
    return sections


def _extract_links(body: str, base_url: str) -> list[dict[str, str]]:
    links: list[dict[str, str]] = []
    seen: set[str] = set()
    for match in LINK_RE.finditer(body):
        url = match.group(1).strip()
        if not url:
            continue
        if url.startswith("/"):
            url = base_url + url
        title = _normalize_text(_clean_html(match.group(2))) or url
        key = f"{title}|{url}"
        if key in seen:
            continue
        seen.add(key)
        links.append({"title": title, "url": url})
    return links


def _build_summary(summary: str, content: str) -> str:
    source = summary.strip() or content.strip()
    for marker in SUMMARY_CUT_MARKERS:
        idx = source.find(marker)
        if idx > 0:
            source = source[:idx].strip()
            break
    return source


class AIDailyClient:
    """hex2077.dev AI 日报客户端；所有请求在发起前检查中断。"""

    def __init__(
        self,
        interrupt: InterruptEvent | None = None,
        base_url: str = DEFAULT_SOURCE_BASE,
        index_path: str = DEFAULT_INDEX_PATH,
        user_agent: str = DEFAULT_USER_AGENT,
        timeout: float = 20.0,
    ) -> None:
        self.interrupt = interrupt
        self.base_url = base_url.rstrip("/")
        self.index_path = index_path
        self.user_agent = user_agent
        self.timeout = timeout

    def _get(self, url: str) -> str:
        self._checkpoint(f"GET {url}")
        resp = requests.get(url, timeout=self.timeout, headers={"User-Agent": self.user_agent})
        resp.raise_for_status()
        return resp.text

    def _checkpoint(self, where: str) -> None:
        if self.interrupt is not None:
            self.interrupt.checkpoint(where)

    def fetch_index(self, max_entries: int = DEFAULT_MAX_ENTRIES) -> list[dict[str, str]]:
        """取日报索引，slug 降序（最新在前），限制条数。"""
        body = self._get(f"{self.base_url}{self.index_path}")
        entries: dict[str, dict[str, str]] = {}
        for match in LINK_RE.finditer(body):
            href = match.group(1).strip()
            if "/docs/" not in href:
                continue
            full_url = href if href.startswith("http") else self.base_url + href
            slug = full_url.removeprefix(self.base_url).strip("/")
            title = _clean_html(match.group(2))
            if not slug or not title:
                continue
            entries.setdefault(slug, {"title": title, "url": full_url, "slug": slug})
        ordered = sorted(entries.values(), key=lambda e: e["slug"], reverse=True)
        return ordered[:max_entries] if max_entries > 0 else ordered

    def fetch_daily(self, entry: dict[str, str], fetched_at: datetime) -> AIDailyPayload:
        body = self._get(entry["url"])

        title = entry["title"]
        title_match = TITLE_RE.search(body)
        if title_match:
            parsed = _clean_html(title_match.group(1))
            if parsed:
                title = parsed

        scope = _content_scope(body)
        summary = ""
        content_parts: list[str] = []
        for para_match in PARA_RE.finditer(scope):
            text = _normalize_text(_clean_html(para_match.group(1)))
            if not _is_useful_paragraph(text, title):
                continue
            if not summary:
                summary = text
            content_parts.append(text)
        if not summary:
            summary = _truncate(_normalize_text(title), 1000)

        read_time = READ_TIME_RE.search(scope) or READ_TIME_RE.search(body)
        content = _truncate("\n\n".join(content_parts), 65535)

        return AIDailyPayload(
            source="hex2077",
            title=_truncate(title, 255),
            slug=_truncate(entry["slug"], 255),
            source_url=_truncate(entry["url"], 255),
            published_date=_extract_date_from_slug(entry["slug"])[:32],
            summary=_truncate(_build_summary(summary, content), 320),
            read_time=_truncate(_clean_html(read_time.group(1)) if read_time else "", 64),
            content=content,
            sections=_extract_sections(scope),
            links=_extract_links(scope, self.base_url),
            meta={"entrySlug": entry["slug"]},
            fetched_at=fetched_at.isoformat(),
        )

    def fetch_latest(self, max_entries: int = DEFAULT_MAX_ENTRIES) -> tuple[list[dict[str, Any]], list[str]]:
        """抓取最新 N 篇日报，返回 (records, failures)；检查点在每篇文章之间。

        中断不是失败：收到中断即停止抓取后续文章，已抓到的记录原样返回。
        """
        fetched_at = datetime.now()
        records: list[dict[str, Any]] = []
        failures: list[str] = []
        entries = self.fetch_index(max_entries)
        for entry in entries:
            if self.interrupt is not None and self.interrupt.requested:
                break
            try:
                payload = self.fetch_daily(entry, fetched_at)
            except Interrupted:
                break
            except Exception as exc:
                failures.append(f"{entry['slug']}: fetch failed: {exc}")
                continue
            records.append(self.to_record(payload))
        return records, failures

    @staticmethod
    def to_record(payload: AIDailyPayload) -> dict[str, Any]:
        return {
            "source": payload.source,
            "title": payload.title,
            "slug": payload.slug,
            "source_url": payload.source_url,
            "published_date": payload.published_date,
            "summary": payload.summary,
            "read_time": payload.read_time,
            "content": payload.content,
            "sections_json": json.dumps(payload.sections, ensure_ascii=False),
            "links_json": json.dumps(payload.links, ensure_ascii=False),
            "meta_json": json.dumps(payload.meta, ensure_ascii=False),
            "fetched_at": payload.fetched_at,
        }
