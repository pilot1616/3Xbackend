# -*- coding: utf-8 -*-
"""闲聊意图识别：判断 /chat 消息是否无需查库即可回答。

纯规则、零 LLM 开销：问候/身份/感谢/告别/闲聊类消息直接走对话路径，
跳过 SQL 生成与"结论/依据/风险/建议"分析模板。判定采取保守策略——
只要消息里出现任何数据诉求信号（标的、指标、行情词、数据表字段词），
一律视为业务问题走原管线，宁可多查一次库也不吞掉正经提问。
"""
from __future__ import annotations

import re

# 显式数据诉求：命中任何一条都绝不当成闲聊。
DATA_SIGNALS = (
    # 标的与指标
    "黄金", "白银", "铂金", "钯金", "铜", "镍", "铝", "锌", "金", "银",
    "xau", "xag", "xpt", "xpd", "xauusd", "xagusd",
    "股票", "股价", "美股", "港股", "a股", "基金", "etf", "指数",
    "英伟达", "苹果", "微软", "amd", "博通", "台积电", "特斯拉",
    "aapl", "msft", "nvda", "amd", "avgo", "tsm", "ndx", "qqq", "xlk", "smh", "igv", "soxx",
    "价格", "行情", "走势", "k线", "涨", "跌", "涨幅", "跌幅", "收盘", "开盘",
    "市值", "市盈率", "估值", "pe", "贝塔", "beta", "成交量",
    "现货", "期货", "合约", "金交所", "上金所",
    # 数据与报表
    "日报", "ai日报", "资讯", "新闻", "数据", "查询", "统计", "分析", "趋势",
    "最近", "历史", "今天", "昨天", "本周", "上周", "本月", "上月", "最新",
    "多少", "几", "排名", "对比", "联动", "相关性", "关系",
    # 论坛业务
    "帖子", "评论", "论坛", "问题", "回答", "用户",
)

# 明确的闲聊信号。
GREETING_RE = re.compile(
    r"^(你好|您好|hi|hello|hey|哈喽|嗨|早上好|上午好|下午好|晚上好|早安|晚安|"
    r"在吗|在么|你是谁|你叫什么|你是什么|自我介绍|介绍一下你自己)[!！。~～?？\s]*$",
    re.IGNORECASE,
)
THANKS_RE = re.compile(r"^(谢谢|感谢|多谢|辛苦了|thx|thanks|thank you|好的|嗯+|哦+|收到|明白|了解|ok|okay)[!！。~～\s]*$", re.IGNORECASE)
FAREWELL_RE = re.compile(r"^(拜拜|再见|下次见|bye|goodbye|晚安)[!！。~～\s]*$", re.IGNORECASE)

# 身份/能力闲聊：句子里问"你是/你会/你能"但没有具体数据诉求。
IDENTITY_RE = re.compile(r"你是|你会|你能|你是小狗|是小狗|名字|谁做的|谁开发|什么模型")

# 无数据诉求的短句（寒暄、玩笑、情绪表达）：交给闲聊路径自由发挥。
_CHITCHAT_MAX_LEN = 20


def is_smalltalk(message: str) -> bool:
    """判断消息是否为无需查库的闲聊。

    顺序很重要：先排除数据诉求，再匹配闲聊模式；超长文本永远不是闲聊。
    """
    text = (message or "").strip()
    if not text or len(text) > _CHITCHAT_MAX_LEN:
        return False

    lowered = text.lower()
    if any(signal in lowered for signal in DATA_SIGNALS):
        return False

    if GREETING_RE.match(text) or THANKS_RE.match(text) or FAREWELL_RE.match(text):
        return True
    if IDENTITY_RE.search(text):
        return True

    # 其余情况视为业务问题，走查库管线（保守：不猜）。
    return False
