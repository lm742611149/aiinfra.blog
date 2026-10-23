---
title: 'Day 198 · 模式二:路由'
description: '第二种 workflow 模式:先给输入分类,再交给专门的分支处理,分不清就转人工。今天用 30 张带标准答案的工单评测分类器:deepseek-flash 和 deepseek-v4-pro 都答对 29 张,而且错的是同一张,模型自报的置信度几乎没有区分度(答错那张 0.95,同样 0.95 的答对了 9 张)。再写路由本体、送错分支会怎样、三种做法的账(小模型通用 ¥0.0005/张,大模型通用 ¥0.0018/张,路由 ¥0.0013/张且 6 张转人工)和 13 个离线用例;练习里量提示词改动是不是真的有效。'
pubDate: 2026-10-23
regime: none
tags: ['workflow', 'routing', 'classification', 'agent-zero']
series: 'agent-zero'
day: 198
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 197](/blog/agent-zero/day-197-chaining/) 写了第一个 workflow 模式:提示链。抽取、起草、润色三步接力,每步之间有代码做的门,门不过就转人工或带着原因重写。实测里,单提示词在标准工单上已经够好,链的好处是「保证」:没订单号 8 遍全转人工,六个订单号那张门拦下了 2 遍漏单,代价是三次调用、三倍的钱。

那条链是一条路走到底:所有工单经过同样的三步。但客服工单其实分得很清楚,查扣费的、报故障的、改账号的,各自该问的问题、该用的口气、甚至该用的模型都不一样。今天做第二个模式:**路由**。

## 今天要解决的问题

学完今天,你应该能:

1. 说出路由是什么,什么时候用它,它和 agent 在「谁来选」上差在哪。
2. 写出一个分类器:输出类别和置信度,对模型返回的格式不信任,坏数据进不了后面。
3. 用带标准答案的数据评测分类器,看懂准确率、错在哪、置信度到底有没有用。
4. 写出路由本体:按类别走不同分支(不同提示词、不同模型),分不清或没有对应分支就转人工,并用离线测试钉住每个出口。

今天两个新概念:**路由**(分类分流)和**置信度出口**(分不清就不自动处理)。

预计用时 3 小时。前置:[Day 196](/blog/agent-zero/day-196-workflow-vs-agent/)(`wf_common.py`)、[Day 197](/blog/agent-zero/day-197-chaining/)(门和转人工的思路、剧本式测试)、[Day 68](/blog/agent-zero/day-068-async-3/)(`gather` 和 `Semaphore`,练习 3 用)、[Day 124](/blog/agent-zero/day-124-cost/)(token 计费)。代码在 `agent-zero-lab/part03/` 和 `tests/`,命令都在 `agent-zero-lab/` 根目录跑。今天要在 `.env` 里加两行,配一个「大模型」,后面有说明。真调模型,按文中命令跑一遍约 ¥0.27,算法见文末「花费」。

学法:先对照文章逐行敲一遍(不复制粘贴)并跑通;第二天合上文章,默写 `parse_classification` 和 `route` 的四个出口;做练习时先自己写,做不出再展开参考答案,看完关掉自己重写一遍。

## 路由是什么

前端的 router 你天天用:URL 进来,路由表把 `/orders/42` 分给订单详情组件,把 `/login` 分给登录组件。每个组件各管各的页面,不用写一个大组件处理所有 URL。提示词里的路由是同一个思路,输入不是 URL 而是**一段文字**,路由表不是正则而是**一次模型调用**:先分类,再交给对应的分支。

Anthropic 那篇文章的定义:"Routing classifies an input and directs it to a specialized followup task",对输入分类,然后交给专门的后续任务。它适合"complex tasks where there are distinct categories that are better handled separately",有明显不同类别、分开处理更好的复杂任务。文中举了两个例子,都在客服场景:把一般问题、退款、技术支持分到不同流程;把简单常见的问题交给小而便宜的模型、难的交给更强的模型。

注意它和 agent 的分别。路由里模型只做一件事:选一个类别,然后**交棒**。后面走哪条分支、每条分支做什么,都是你写好的。Agent 是模型在每一步都重新选。所以路由仍然是 workflow:分支的数量和内容是代码定的,模型只在入口处投一票。

<figure>
<svg viewBox="0 0 640 280" role="img" aria-label="路由:工单先经过小模型分类,按类别分到计费、技术、账号三个分支,分到其他或置信度低就转人工;计费分支用大模型,其余用小模型">
  <rect x="0" y="0" width="640" height="280" fill="var(--paper-raised)" rx="6"/>
  <text x="20" y="26" font-family="var(--font-mono)" font-size="13" fill="var(--ink)">路由:先投一票,再交棒</text>
  <rect x="14" y="110" width="90" height="44" fill="var(--paper)" stroke="var(--ink-soft)" rx="4"/>
  <text x="59" y="137" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">一张工单</text>
  <rect x="134" y="100" width="120" height="64" fill="var(--mem-wash)" stroke="var(--mem)" rx="4"/>
  <text x="194" y="126" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">分类器</text>
  <text x="194" y="144" text-anchor="middle" font-family="var(--font-mono)" font-size="10" fill="var(--ink-soft)">小模型,一次调用</text>
  <rect x="300" y="46" width="150" height="40" fill="var(--mem-wash)" stroke="var(--mem)" rx="4"/>
  <text x="375" y="63" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">billing 计费专员</text>
  <text x="375" y="78" text-anchor="middle" font-family="var(--font-mono)" font-size="10" fill="var(--ink-soft)">大模型</text>
  <rect x="300" y="96" width="150" height="40" fill="var(--mem-wash)" stroke="var(--mem)" rx="4"/>
  <text x="375" y="113" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">technical 技术支持</text>
  <text x="375" y="128" text-anchor="middle" font-family="var(--font-mono)" font-size="10" fill="var(--ink-soft)">小模型</text>
  <rect x="300" y="146" width="150" height="40" fill="var(--mem-wash)" stroke="var(--mem)" rx="4"/>
  <text x="375" y="163" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">account 账号专员</text>
  <text x="375" y="178" text-anchor="middle" font-family="var(--font-mono)" font-size="10" fill="var(--ink-soft)">小模型</text>
  <rect x="300" y="206" width="150" height="40" fill="var(--compute-wash)" stroke="var(--compute)" rx="4"/>
  <text x="375" y="223" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">转人工</text>
  <text x="375" y="238" text-anchor="middle" font-family="var(--font-mono)" font-size="10" fill="var(--ink-soft)">other / 置信度低 / 格式坏</text>
  <rect x="490" y="96" width="136" height="40" fill="var(--paper)" stroke="var(--ink-soft)" rx="4"/>
  <text x="558" y="121" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">写给客户的回复</text>
  <path d="M104 132 H134 M254 132 H275 M275 66 V226 M275 66 H300 M275 116 H300 M275 166 H300 M275 226 H300 M450 66 L470 66 L470 116 H490 M450 116 H490 M450 166 L470 166 L470 116" stroke="var(--ink-soft)" fill="none"/>
  <text x="320" y="268" text-anchor="middle" font-family="var(--font-mono)" font-size="10" fill="var(--ink-faint)">分支有几个、各自用什么提示词和模型,都是代码写死的</text>
</svg>
<figcaption>分类器只在入口投一票。每个分支有自己的系统提示词,还可以有自己的模型。没有对应分支的类别、分不清的工单,统一从下面出去。</figcaption>
</figure>

为什么不把四种处理都写进一个大提示词?两个理由。第一,各分支的要求会互相打架:计费要复述金额和订单号,技术要追问报错信息,账号要提醒别发密码。写在一起,提示词越来越长,每次都带着用不上的三份要求。第二,分开以后可以**给不同分支不同的模型**。涉及钱的用强一点的,查报错用便宜的。

## 先配「大模型」

要演示「按分支选模型」,得有两个模型。我这个账号的模型列表里有 `deepseek-flash` 和 `deepseek-v4-pro` 两档,2026 年 10 月查价格页:flash 高峰时段输入(缓存未命中)2 元每百万 token、输出 8 元;pro 是 9 元和 27 元,约贵 3.4 到 4.5 倍。空闲时段价格都减半。`wf_common.py` 里已经留好了位置(Day 196 的 `BIG_MODEL`),只要在 `.env` 里加两行:

```text
LLM_BIG_MODEL=deepseek-v4-pro
LLM_BIG_PRICE=0.3,9,27
```

价格三个数依次是缓存命中、未命中、输出,元每百万 token。如果你的服务商只有一个模型,不配这两行也能跑,`BIG_MODEL` 会退回默认模型,只是演示不出差别。

## 先造数据:30 张带标准答案的工单

路由的好坏取决于分类准不准,而「准不准」只有拿**带标准答案的数据**量才知道。我自己编了 30 张云簿的工单,放进 `part03/routing_data.py`。标准答案是我按「钱的问题归计费、产品故障归技术、登录权限归账号、其余归其他」标的。里面故意放了三张我自己也觉得不好分的。

```python
# agent-zero-lab/part03/routing_data.py  Day 198:路由评测用的 30 张带标准答案的工单(自己编的,云簿 CloudLedger 场景)
CATEGORIES = ["billing", "technical", "account", "other"]

# (工单内容, 标准答案)。billing=钱、账单、发票、退款;technical=产品功能、报错、同步、API;
# account=登录、密码、权限、成员;other=以上都不是
TICKETS: list[tuple[str, str]] = [
    # --- billing 8 ---
    ("我 9 月 28 号续费被扣了两次 1188 元,订单号 CL-20931 和 CL-20932,请退一笔。", "billing"),
    ("发票抬头开错了,公司名少了「有限」两个字,能重开一张吗?", "billing"),
    ("你们年付套餐中途不想用了,剩下几个月的钱能退吗?", "billing"),
    ("上个月账单比前一个月多了 300 块,没加过人也没升级,帮我查一下为什么。", "billing"),
    ("我想从专业版月付改成年付,有没有折扣?", "billing"),
    ("我们财务要对公转账,你们的收款账户和开户行是什么?", "billing"),
    ("优惠码 NEWYEAR 输入后提示已失效,但活动页面写的是到月底。", "billing"),
    ("登录后在账单页发现多了一笔我没买过的「高级插件」费用,298 元。", "billing"),
    # --- technical 8 ---
    ("导出报表一直转圈,等了十分钟还没下载下来,浏览器是 Chrome。", "technical"),
    ("调用 /api/v2/invoices 返回 500,请求 ID 是 req_8f3a21,从今天早上开始的。", "technical"),
    ("CRM 同步状态一直显示「进行中」,昨天的数据没同步过来。", "technical"),
    ("移动端打开仪表盘白屏,iPhone 15,iOS 18.2。", "technical"),
    ("Webhook 回调收不到,我们的服务器日志里一条都没有。", "technical"),
    ("批量导入 5000 行客户数据,导到 3200 行左右就报错「格式不正确」。", "technical"),
    ("发票 PDF 下载下来是空白页,换了几个订单都一样。", "technical"),
    ("搜索框输入中文拼音时页面会卡住,英文正常。", "technical"),
    # --- account 8 ---
    ("我忘记密码了,发了重置邮件但一直没收到。", "account"),
    ("新来的同事需要看报表的权限,但不能改账单设置,怎么设置?", "account"),
    ("我换了手机,双重验证的验证码收不到了,登不进去。", "account"),
    ("公司邮箱换了域名,账号绑定的邮箱怎么改?", "account"),
    ("离职同事的账号还能登录,请帮我停掉并转移他名下的数据。", "account"),
    ("登录时提示「账号已被锁定」,我没有输错过密码。", "account"),
    ("我想把管理员权限转给另一个同事,怎么操作?", "account"),
    ("用 Google 账号登录提示未注册,但我们公司明明开通过。", "account"),
    # --- other 6 ---
    ("你们周末客服上班吗?", "other"),
    ("我是某咨询公司的,想和你们谈合作分销,请问找谁?", "other"),
    ("你们公司在招后端工程师吗?我想投简历。", "other"),
    ("上次电话客服态度很差,我要投诉,请把我的意见转给主管。", "other"),
    ("你们的产品和竞品 FinBooks 比有什么优势?", "other"),
    ("请问云簿是哪年成立的,总部在哪个城市?", "other"),
]

# 我觉得不好分的几张(混着两类的话)的下标,统计时单独看
HARD = {7, 14, 20}  # 多了一笔没买过的费用 / 发票 PDF 空白 / 离职同事账号
```

<div class="line-notes">

- `CATEGORIES = ["billing", "technical", "account", "other"]` 四个类别的名字。后面分类器的输出必须是这四个之一,不在里面就当坏数据。
- `TICKETS: list[tuple[str, str]] = [` 一个列表,每个元素是 (工单内容, 标准答案) 的元组,相当于 JS 的 `[string, string][]`。
- `("我 9 月 28 号续费被扣了两次 1188 元,订单号 CL-20931 和 CL-20932,请退一笔。", "billing"),` 第 0 号,Day 196 起一直用的重复扣费工单。
- `("登录后在账单页发现多了一笔我没买过的「高级插件」费用,298 元。", "billing"),` 第 7 号,难的:开头说「登录」,实际是扣费问题。我标 billing,分类器要抓住重点。
- `("导出报表一直转圈,等了十分钟还没下载下来,浏览器是 Chrome。", "technical"),` 第 8 号,后面「送错分支」实验用。
- `("发票 PDF 下载下来是空白页,换了几个订单都一样。", "technical"),` 第 14 号,难的:提到发票,但问题是文件打不开。我标 technical,后面会发现这是分类器的老大难。
- `("离职同事的账号还能登录,请帮我停掉并转移他名下的数据。", "account"),` 第 20 号,难的:账号问题,但也可能牵涉扣费。
- `("你们周末客服上班吗?", "other"),` 第 24 号起是「其他」,六张,都应该转人工。
- `HARD = {7, 14, 20}  # 多了一笔没买过的费用 / 发票 PDF 空白 / 离职同事账号` 三张难的下标,集合。统计时单独看。

</div>

## 分类器:输出类别和置信度,并且不信任它

`part03/wf2_classify.py`。分类器的提示词里把四个类别的**边界**写清楚(什么算 billing,什么算 other),要求输出 JSON:类别加置信度。关键是下面的解析函数:模型返回的 JSON 它有时会写错,不能直接信。

```python
# agent-zero-lab/part03/wf2_classify.py  Day 198:路由的第一步,分类。输出类别和置信度,并且不信任模型的输出格式
from dataclasses import dataclass
from typing import Any

from part03.routing_data import CATEGORIES
from part03.wf_common import llm_json

CLASSIFY_PROMPT = (
    "把客服工单分到一个类别。类别说明:\n"
    "billing:扣费、账单、发票、退款、价格、优惠码\n"
    "technical:产品功能故障、报错、同步、API、导入导出\n"
    "account:登录、密码、权限、成员、邮箱、双重验证\n"
    "other:以上都不是(营业时间、合作、招聘、投诉服务态度、公司介绍等)\n"
    "输出 JSON:{\"category\": \"billing|technical|account|other\", \"confidence\": 0 到 1 之间的小数}\n\n工单:\n"
)


@dataclass
class Classification:
    category: str
    confidence: float


def parse_classification(raw: dict[str, Any]) -> Classification | None:
    """把模型返回的 dict 变成 Classification。格式不对返回 None,不让坏数据流进后面。"""
    category = raw.get("category")
    if category not in CATEGORIES:
        return None
    try:
        confidence = float(raw.get("confidence", 0))  # 模型有时把数字写成字符串 "0.9"
    except (TypeError, ValueError):
        return None
    if not 0 <= confidence <= 1:
        return None
    return Classification(category, confidence)


def classify(ticket: str, model: str | None = None) -> Classification | None:
    return parse_classification(llm_json(CLASSIFY_PROMPT + ticket, model=model))
```

<div class="line-notes">

- `from dataclasses import dataclass` 一个小的数据类用。
- `from part03.routing_data import CATEGORIES` 合法类别的名单,解析时拿它对照。
- `from part03.wf_common import llm_json` 分类要 JSON 结果,所以用 `llm_json`。
- `CLASSIFY_PROMPT = (` 分类提示词,圆括号里是几个相邻字符串,自动拼成一个。
- `"billing:扣费、账单、发票、退款、价格、优惠码\n"` 每个类别一行说明,边界写在提示词里。
- `"other:以上都不是(营业时间、合作、招聘、投诉服务态度、公司介绍等)\n"` 给 `other` 也写清楚,免得模型把它当垃圾桶或者干脆不用。
- `"输出 JSON:{\"category\": \"billing|technical|account|other\", \"confidence\": 0 到 1 之间的小数}\n\n工单:\n"` 提示词停在「工单:」换行,后面直接拼上工单。
- `class Classification:` 分类结果:类别加置信度。
- `def parse_classification(raw: dict[str, Any]) -> Classification | None:` 输入是 `llm_json` 给的 dict,输出是合格的 `Classification` 或 `None`。`None` 表示「这份输出不能用」。
- `category = raw.get("category")` 拿类别,模型没给就是 `None`。
- `if category not in CATEGORIES:` 不在四个之内就当坏数据。模型有时会自己发明类别,比如 `"refund"`。`None` 也不在名单里,同样拦下。
- `confidence = float(raw.get("confidence", 0))  # 模型有时把数字写成字符串 "0.9"` `float("0.9")` 能转,`float(0.9)` 也能转,两种写法都吃。没给置信度当 0。
- `except (TypeError, ValueError):` `float("很高")` 抛 `ValueError`,`float(None)` 抛 `TypeError`,两种都按坏数据处理。
- `if not 0 <= confidence <= 1:` Python 允许连着写比较,等价于 `0 <= c and c <= 1`。`1.5` 或 `-0.2` 都是坏数据。
- `return Classification(category, confidence)` 通过全部检查才造出对象,后面代码拿到的一定是合法类别、合法置信度。
- `def classify(ticket: str, model: str | None = None) -> Classification | None:` 分类入口,`model` 可以指定用哪个模型。
- `return parse_classification(llm_json(CLASSIFY_PROMPT + ticket, model=model))` 一次调用加解析。

</div>

## 量一量:30 张里答对几张

`part03/wf2_eval.py` 把 30 张工单挨个交给分类器,对着标准答案打分,同时跑默认的 flash 和大模型 pro,结果存成 JSON,后面分析置信度时不用再调模型。

```python
# agent-zero-lab/part03/wf2_eval.py  Day 198:拿 30 张带标准答案的工单评测分类器,结果存成 JSON 供后面离线分析
import json
import sys
import time
from collections import Counter
from pathlib import Path

from part03.routing_data import HARD, TICKETS
from part03.wf2_classify import classify
from part03.wf_common import BIG_MODEL, MODEL, client_for

OUT = Path("part03/routing_eval.json")


def evaluate(model: str) -> list[dict[str, object]]:
    rows: list[dict[str, object]] = []
    for i, (text, truth) in enumerate(TICKETS):
        c = classify(text, model=model)
        rows.append({"i": i, "truth": truth, "pred": c.category if c else None, "conf": c.confidence if c else None})
    return rows


if __name__ == "__main__":
    results: dict[str, list[dict[str, object]]] = {}
    for model in (MODEL, BIG_MODEL):
        t0 = time.perf_counter()
        rows = evaluate(model)
        secs = time.perf_counter() - t0
        results[model] = rows
        ok = sum(r["pred"] == r["truth"] for r in rows)
        hard_ok = sum(r["pred"] == r["truth"] for r in rows if r["i"] in HARD)
        ledger = client_for(model).ledger
        print(f"{model}: 答对 {ok}/{len(rows)}(难的 3 张里 {hard_ok}) | {secs / len(rows):.2f} 秒/张 | {ledger}")
        wrong = [(r["i"], r["truth"], r["pred"], r["conf"]) for r in rows if r["pred"] != r["truth"]]
        print("   答错:", wrong or "无")
        print("   置信度分布:", sorted(Counter(r["conf"] for r in rows).items(), key=lambda kv: str(kv[0])))
    OUT.write_text(json.dumps(results, ensure_ascii=False, indent=1))
    print("已存到", OUT, file=sys.stderr)
```

<div class="line-notes">

- `from collections import Counter` 数置信度各个取值出现几次。
- `OUT = Path("part03/routing_eval.json")` 结果存到这个文件。
- `def evaluate(model: str) -> list[dict[str, object]]:` 对一个模型跑完 30 张,返回每张的记录。
- `for i, (text, truth) in enumerate(TICKETS):` `enumerate` 给每张配下标 `i`,元组 `(text, truth)` 同时拆开。
- `c = classify(text, model=model)` 分类。
- `rows.append({"i": i, "truth": truth, "pred": c.category if c else None, "conf": c.confidence if c else None})` 一张一条记录。分类器返回 `None`(坏数据)时 `pred` 和 `conf` 都记 `None`。
- `for model in (MODEL, BIG_MODEL):` 两个模型各来一遍。
- `ok = sum(r["pred"] == r["truth"] for r in rows)` 比较结果是布尔值,`sum` 当 1 和 0 加起来,就是答对几张。
- `hard_ok = sum(r["pred"] == r["truth"] for r in rows if r["i"] in HARD)` 三张难的里答对几张。
- `ledger = client_for(model).ledger` 取这个模型客户端的账本。两个模型各自一本,所以能分开算钱。
- `wrong = [(r["i"], r["truth"], r["pred"], r["conf"]) for r in rows if r["pred"] != r["truth"]]` 答错的清单:下标、标准答案、分成了什么、置信度。
- `print("   置信度分布:", sorted(Counter(r["conf"] for r in rows).items(), key=lambda kv: str(kv[0])))` `Counter` 数每个置信度出现几次,`.items()` 变成 (值, 次数) 的列表,按值排序。
- `OUT.write_text(json.dumps(results, ensure_ascii=False, indent=1))` 存成 JSON,中文不转义。

</div>

```bash
uv run python -m part03.wf2_eval
```

```text
deepseek-flash: 答对 29/30(难的 3 张里 2) | 0.69 秒/张 | 30 次调用 | 输入 4702 / 输出 429 tokens | 约 ¥0.0128
   答错: [(14, 'technical', 'billing', 0.95)]
   置信度分布: [(0.93, 1), (0.95, 10), (0.97, 9), (0.98, 8), (0.99, 2)]
deepseek-v4-pro: 答对 29/30(难的 3 张里 2) | 0.94 秒/张 | 30 次调用 | 输入 4612 / 输出 429 tokens | 约 ¥0.0208
   答错: [(14, 'technical', 'billing', 0.95)]
   置信度分布: [(0.9, 6), (0.95, 20), (0.97, 1), (0.98, 1), (0.99, 1)]
已存到 part03/routing_eval.json
```

几件事:

**两个模型都是 29/30,错的是同一张**:第 14 号「发票 PDF 下载下来是空白页」,标准答案 technical(文件坏了),两个模型都分成了 billing(提到了发票),置信度还是 0.95。大模型没有在这张上比小模型强。

**这个任务上,小模型够用。** 分类是简单任务,花 pro 的钱没换来更高的准确率。每张 0.69 秒对 0.94 秒,单价上 flash 一张约 ¥0.00043,pro 约 ¥0.00069。但是别拿价目表的倍数去乘:pro 的价目表比 flash 贵 3 到 4 倍,账单上只贵约 1.6 倍,因为这 30 次调用的前 140 来个 token 的提示词完全一样,pro 的缓存命中了其中 128 个(命中价 0.3 元,比未命中价 9 元便宜得多),而 flash 我单独查了两次调用,`cache_hit_tokens` 都是 0。我没查到官方对 flash 不命中缓存的说明,不知道原因,只记录事实:**按价目表估价会偏,要看真实的账本。**

**置信度这一栏几乎没有信息。** flash 30 张全部是 0.93 到 0.99,答错那张是 0.95。

## 置信度到底能不能筛出错的

路由常见的做法是「置信度低于阈值就转人工」,这样就算分类器偶尔错也能少错一点。这个做法有效的前提是:**错的那些置信度确实更低**。拿存好的结果看一眼,不调模型。`part03/wf2_threshold.py`:

```python
# agent-zero-lab/part03/wf2_threshold.py  Day 198:拿存好的评测结果(不调模型),看置信度阈值到底能不能筛出错的
import json
from pathlib import Path

rows_by_model = json.loads(Path("part03/routing_eval.json").read_text())
model = next(iter(rows_by_model))  # 第一个是默认(便宜)模型
rows = rows_by_model[model]

print(f"模型 {model},共 {len(rows)} 张。阈值越高,自动处理的越少")
print("阈值 | 自动处理 | 其中答错 | 转人工 | 转人工里本来答对的")
for t in (0.5, 0.8, 0.9, 0.95, 0.96, 0.98, 0.99):
    auto = [r for r in rows if r["conf"] is not None and r["conf"] >= t]
    wrong = [r for r in auto if r["pred"] != r["truth"]]
    held = [r for r in rows if r not in auto]
    held_ok = [r for r in held if r["pred"] == r["truth"]]
    print(f"{t:<4} | {len(auto):>3} 张    | {len(wrong)} 张     | {len(held):>3} 张 | {len(held_ok)} 张")

print("\n答错那张的置信度 vs 同样置信度下答对的张数:")
for r in rows:
    if r["pred"] != r["truth"]:
        same = sum(1 for x in rows if x["conf"] == r["conf"] and x["pred"] == x["truth"])
        print(f"  第 {r['i']} 张 置信度 {r['conf']},同样是 {r['conf']} 的答对了 {same} 张")

names = list(rows_by_model)
a, b = rows_by_model[names[0]], rows_by_model[names[1]]
agree = sum(x["pred"] == y["pred"] for x, y in zip(a, b))
both_wrong = sum(x["pred"] == y["pred"] != x["truth"] for x, y in zip(a, b))
print(f"\n{names[0]} 和 {names[1]} 分类一致 {agree}/{len(a)} 张,两个一起答错 {both_wrong} 张")
```

<div class="line-notes">

- `rows_by_model = json.loads(Path("part03/routing_eval.json").read_text())` 读上一步存的评测结果。键是模型名,值是 30 条记录。
- `model = next(iter(rows_by_model))  # 第一个是默认(便宜)模型` 取字典里第一个键。`iter` 加 `next` 是取第一个的惯用写法。
- `for t in (0.5, 0.8, 0.9, 0.95, 0.96, 0.98, 0.99):` 试七个阈值。
- `auto = [r for r in rows if r["conf"] is not None and r["conf"] >= t]` 置信度不低于阈值的,会被自动处理。
- `wrong = [r for r in auto if r["pred"] != r["truth"]]` 其中答错的,这是「没拦住的错」。
- `held = [r for r in rows if r not in auto]` 被拦下转人工的。
- `held_ok = [r for r in held if r["pred"] == r["truth"]]` 被拦下的里面,其实分类是对的有几张,这是「冤枉的」。
- `same = sum(1 for x in rows if x["conf"] == r["conf"] and x["pred"] == x["truth"])` 和答错那张置信度一模一样、却答对了的有几张。
- `agree = sum(x["pred"] == y["pred"] for x, y in zip(a, b))` `zip` 把两个模型的 30 条记录一一配对,数两个模型分类一致的张数。
- `both_wrong = sum(x["pred"] == y["pred"] != x["truth"] for x, y in zip(a, b))` 连着写的比较:两个模型的预测一致,并且不等于标准答案,就是「一起错」。

</div>

```bash
uv run python -m part03.wf2_threshold
```

```text
模型 deepseek-flash,共 30 张。阈值越高,自动处理的越少
阈值 | 自动处理 | 其中答错 | 转人工 | 转人工里本来答对的
0.5  |  30 张    | 1 张     |   0 张 | 0 张
0.8  |  30 张    | 1 张     |   0 张 | 0 张
0.9  |  30 张    | 1 张     |   0 张 | 0 张
0.95 |  29 张    | 1 张     |   1 张 | 1 张
0.96 |  19 张    | 0 张     |  11 张 | 10 张
0.98 |  10 张    | 0 张     |  20 张 | 19 张
0.99 |   2 张    | 0 张     |  28 张 | 27 张

答错那张的置信度 vs 同样置信度下答对的张数:
  第 14 张 置信度 0.95,同样是 0.95 的答对了 9 张

deepseek-flash 和 deepseek-v4-pro 分类一致 30/30 张,两个一起答错 1 张
```

<figure>
<svg viewBox="0 0 640 250" role="img" aria-label="阈值从 0.9 提到 0.96,自动处理的工单从 30 张降到 19 张,答错的 1 张被拦下但同时冤枉了 10 张答对的">
  <rect x="0" y="0" width="640" height="250" fill="var(--paper-raised)" rx="6"/>
  <text x="20" y="26" font-family="var(--font-mono)" font-size="13" fill="var(--ink)">阈值提高,自动处理量(蓝)和转人工量(琥珀)</text>
  <text x="20" y="62" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">≤0.9</text>
  <rect x="80" y="48" width="450" height="20" fill="var(--mem-wash)" stroke="var(--mem)"/>
  <text x="540" y="63" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">30 / 0 · 错 1</text>
  <text x="20" y="102" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">0.95</text>
  <rect x="80" y="88" width="435" height="20" fill="var(--mem-wash)" stroke="var(--mem)"/>
  <rect x="515" y="88" width="15" height="20" fill="var(--compute-wash)" stroke="var(--compute)"/>
  <text x="540" y="103" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">29 / 1 · 错 1</text>
  <text x="20" y="142" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">0.96</text>
  <rect x="80" y="128" width="285" height="20" fill="var(--mem-wash)" stroke="var(--mem)"/>
  <rect x="365" y="128" width="165" height="20" fill="var(--compute-wash)" stroke="var(--compute)"/>
  <text x="540" y="143" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">19 / 11 · 错 0</text>
  <text x="20" y="182" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">0.98</text>
  <rect x="80" y="168" width="150" height="20" fill="var(--mem-wash)" stroke="var(--mem)"/>
  <rect x="230" y="168" width="300" height="20" fill="var(--compute-wash)" stroke="var(--compute)"/>
  <text x="540" y="183" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">10 / 20 · 错 0</text>
  <text x="320" y="228" text-anchor="middle" font-family="var(--font-mono)" font-size="10" fill="var(--ink-faint)">拦住那 1 张错的,代价是多转 10 张本来答对的:三分之一的量</text>
</svg>
<figcaption>总长度都是 30 张。阈值定到 0.96 才能拦下答错的那张,同时有 10 张答对的也被送去人工。</figcaption>
</figure>

读这张表:

- 阈值 0.5 到 0.9,一张都没拦,因为所有工单置信度都在 0.93 以上。常见的「低于 0.8 转人工」在这个模型上**等于没写**。
- 阈值提到 0.96 才把答错那张拦下来,但同时多拦了 10 张本来答对的,约三分之一的量被冤枉送去人工。
- 答错那张置信度 0.95,另有 9 张置信度同样是 0.95 却答对了,所以没有任何阈值能「只拦它」。
- 最后一行更要紧:两个模型意见一致 30/30,错也错在同一张。让两个模型投票、不一致就转人工,在这批数据上筛不出任何东西(练习 2 会在更难的数据上再试一次)。

结论不是「置信度没用」,是**模型自报的置信度,要用你的数据验过才能用**。更靠谱的做法是把阈值当成要调的参数:拿评测集画出这张表,看你愿意为「少错一张」多转多少人工。如果你的业务里「分错」比「转人工」贵得多(比如计费分到技术,客户的钱被晾着),宁可阈值高一点;如果人工很紧张,宁可低一点。这个取舍是业务决定,不是模型决定。

## 路由本体

分类器有了,现在写路由。`part03/wf2_routing.py` 有三块:每个分支的 `Handler`(系统提示词加模型),`route` 函数(分类、检查、交棒),三个出口(格式坏、没有对应分支、置信度低)全部是转人工。

```python
# agent-zero-lab/part03/wf2_routing.py  Day 198 模式二:路由,先分类,再交给专门的分支;分不清就转人工
from dataclasses import dataclass

from part03.wf2_classify import classify
from part03.wf_common import BIG_MODEL, MODEL, llm

REPLY_RULE = "直接写给客户的回复,120 字以内,不要写成内部处理步骤;你不能查任何系统,不要说「已核实」「已提交」,只说明会转给同事核实;不要承诺到账日期或修复时间。"


@dataclass
class Handler:
    system: str  # 这个分支专属的系统提示词
    model: str  # 这个分支用哪个模型


HANDLERS: dict[str, Handler] = {
    "billing": Handler("你是云簿 CloudLedger 的计费专员,熟悉扣费、退款、发票规则。涉及金额时复述客户给的数字和订单号。" + REPLY_RULE, BIG_MODEL),
    "technical": Handler("你是云簿的技术支持。先确认客户的报错信息、浏览器或设备、复现步骤,缺什么就问什么。" + REPLY_RULE, MODEL),
    "account": Handler("你是云簿的账号专员。涉及登录、权限、改邮箱时给出操作入口;绝不要客户在工单里发密码或验证码,要提醒这一点。" + REPLY_RULE, MODEL),
}  # 没有 "other":分到 other 的一律转人工


@dataclass
class RouteResult:
    status: str  # "handled" 或 "handoff"
    reason: str  # handled 时是类别;handoff 时是转人工的原因
    reply: str = ""
    category: str | None = None
    confidence: float | None = None


def route(ticket: str, threshold: float = 0.8) -> RouteResult:
    c = classify(ticket)  # 分类用默认(便宜)模型
    if c is None:
        return RouteResult("handoff", "分类结果格式不对")
    if c.category not in HANDLERS:
        return RouteResult("handoff", f"分到 {c.category},没有对应的分支", category=c.category, confidence=c.confidence)
    if c.confidence < threshold:
        return RouteResult("handoff", f"置信度 {c.confidence} 低于 {threshold}", category=c.category, confidence=c.confidence)
    h = HANDLERS[c.category]
    reply = llm(ticket, system=h.system, model=h.model)
    return RouteResult("handled", c.category, reply, c.category, c.confidence)


if __name__ == "__main__":
    for text in ["我 9 月 28 号续费被扣了两次 1188 元,订单号 CL-20931 和 CL-20932,请退一笔。", "你们周末客服上班吗?", "我换了手机,双重验证的验证码收不到了,登不进去。"]:
        r = route(text)
        print(f"[{r.status}] {r.reason} | 置信度 {r.confidence}")
        print("   ", r.reply.replace("\n", " ") if r.reply else "(转人工,没有自动回复)")
```

<div class="line-notes">

- `from part03.wf2_classify import classify` 分类器,上一节写的。
- `from part03.wf_common import BIG_MODEL, MODEL, llm` 两个模型名都要用,计费分支用 `BIG_MODEL`。
- `REPLY_RULE = "直接写给客户的回复,120 字以内,不要写成内部处理步骤;你不能查任何系统,不要说「已核实」「已提交」,只说明会转给同事核实;不要承诺到账日期或修复时间。"` 三个分支共用的结尾要求。第一条是我踩过的坑:早期版本没写,分支提示词里写「回答要给出具体的下一步操作」,模型就把回复写成了给同事的处理步骤。第二条是 Day 196、197 一路踩过的:没有查询权限的模型会说「已核实」「已提交」。
- `class Handler:` 一个分支就是两样东西:提示词和模型。
- `HANDLERS: dict[str, Handler] = {` 分支表,键是类别名。加一个分支就是加一行。
- `"billing": Handler("你是云簿 CloudLedger 的计费专员,熟悉扣费、退款、发票规则。涉及金额时复述客户给的数字和订单号。" + REPLY_RULE, BIG_MODEL),` 计费分支:涉及钱,用大模型。
- `"technical": Handler("你是云簿的技术支持。先确认客户的报错信息、浏览器或设备、复现步骤,缺什么就问什么。" + REPLY_RULE, MODEL),` 技术分支:追问信息,用便宜的默认模型。
- `"account": Handler("你是云簿的账号专员。涉及登录、权限、改邮箱时给出操作入口;绝不要客户在工单里发密码或验证码,要提醒这一点。" + REPLY_RULE, MODEL),` 账号分支:提醒安全。
- `}  # 没有 "other":分到 other 的一律转人工` 表里故意没有 `other`。没有分支,就是没人管,只能转人工。
- `class RouteResult:` 路由的返回值,和 Day 197 的 `ChainResult` 是同一种思路。
- `status: str  # "handled" 或 "handoff"` 调用方只看这个。
- `reason: str  # handled 时是类别;handoff 时是转人工的原因` 一个字段两种用法,偷懒但够用。
- `category: str | None = None` 分类出来是什么,转人工时也留着,方便人工看。
- `def route(ticket: str, threshold: float = 0.8) -> RouteResult:` 阈值默认 0.8,这是我动手前随手写的,上面的表已经说明它在这个模型上等于没设。
- `c = classify(ticket)  # 分类用默认(便宜)模型` 分类这一步不指定模型,就是 `MODEL`。
- `if c is None:` 出口一:模型返回的东西解析不了。
- `return RouteResult("handoff", "分类结果格式不对")` 转人工,不让坏数据往后走。
- `if c.category not in HANDLERS:` 出口二:类别合法(`CATEGORIES` 里有),但没有对应分支,也就是 `other`。
- `return RouteResult("handoff", f"分到 {c.category},没有对应的分支", category=c.category, confidence=c.confidence)` 转人工,把类别和置信度带上。
- `if c.confidence < threshold:` 出口三:置信度低。注意是 `<`,所以置信度**等于**阈值时通过(测试里钉住了这一点)。
- `h = HANDLERS[c.category]` 走到这里类别一定在表里,可以直接取。
- `reply = llm(ticket, system=h.system, model=h.model)` 交棒:用这个分支自己的系统提示词和模型回答。用户消息就是工单原文。
- `return RouteResult("handled", c.category, reply, c.category, c.confidence)` 成功出口。
- `for text in ["我 9 月 28 号续费被扣了两次 1188 元,订单号 CL-20931 和 CL-20932,请退一笔。", "你们周末客服上班吗?", "我换了手机,双重验证的验证码收不到了,登不进去。"]:` 三张工单各走一种出口:计费、其他、账号。
- `print(f"[{r.status}] {r.reason} | 置信度 {r.confidence}")` 打印状态和原因。

</div>

```bash
uv run python -m part03.wf2_routing
```

```text
[handled] billing | 置信度 0.99
    您好,您反馈 9 月 28 日续费被扣两笔 1188 元,订单号 CL-20931 和 CL-20932,需退一笔。我会将您的订单信息转给相关同事核实处理,请耐心等待。
[handoff] 分到 other,没有对应的分支 | 置信度 0.95
    (转人工,没有自动回复)
[handled] account | 置信度 0.97
    换手机后收不到双重验证码,可在登录页点「无法验证」走身份校验,或到账号安全设置更新双重验证方式;也可提交工单转同事核实处理。请勿在工单中发送密码或验证码。
```

三张工单走了三个出口。注意两处细节:账号那封信自己带了「请勿在工单中发送密码或验证码」,这是分支系统提示词起的作用,技术分支和计费分支的回复里就没有这句。计费那封信复述了金额和订单号,这也是它专属的要求。

## 送错分支会怎样

常听到一种说法:「一个被错误路由的工单,比一个转人工的工单糟糕得多」。这次真验一下。`part03/wf2_misroute.py` 把两张工单分别送进**三个分支**,看每个分支怎么回:

```python
# agent-zero-lab/part03/wf2_misroute.py  Day 198:故意送错分支,看「被错误路由」的客户收到什么
from part03.routing_data import TICKETS
from part03.wf2_routing import HANDLERS
from part03.wf_common import llm

for idx in (0, 8):  # 0 号是重复扣费(billing),8 号是导出报表转圈(technical)
    text, truth = TICKETS[idx]
    print(f"\n工单 {idx}(标准答案 {truth}):{text}")
    for name, h in HANDLERS.items():
        reply = llm(text, system=h.system, model=h.model).replace("\n", " ")
        mark = "← 正确分支" if name == truth else ""
        print(f"  送给 {name:<9}{mark}\n    {reply}")
```

<div class="line-notes">

- `for idx in (0, 8):  # 0 号是重复扣费(billing),8 号是导出报表转圈(technical)` 各取一张。
- `text, truth = TICKETS[idx]` 元组拆成工单内容和标准答案。
- `for name, h in HANDLERS.items():` 对三个分支各来一次。
- `reply = llm(text, system=h.system, model=h.model).replace("\n", " ")` 不经分类器,直接强制用这个分支回答,换行替换成空格方便看。
- `mark = "← 正确分支" if name == truth else ""` 标出哪个分支是对的。

</div>

```bash
uv run python -m part03.wf2_misroute
```

```text
工单 0(标准答案 billing):我 9 月 28 号续费被扣了两次 1188 元,订单号 CL-20931 和 CL-20932,请退一笔。
  送给 billing  ← 正确分支
    您好,您反馈的 9 月 28 日两笔 1188 元扣费,订单号 CL-20931 和 CL-20932,我会转给相关同事核实并处理退款,请您耐心等待。
  送给 technical
    您好,了解到您 9 月 28 日续费时被扣了两次 1188 元,订单号 CL-20931 和 CL-20932,希望退回一笔。为便于转交同事核实,麻烦提供一下扣款账户、支付方式和扣款时间,并说明当时操作步骤。
  送给 account  
    您的情况我记下了,订单号 CL-20931、CL-20932 的重复扣款会转给同事核实处理。请勿在工单中发送密码或验证码。

工单 8(标准答案 technical):导出报表一直转圈,等了十分钟还没下载下来,浏览器是 Chrome。
  送给 billing  
    您好,关于导出报表一直转圈的问题,我会将您的情况转给相关同事核实处理。请您稍候。
  送给 technical← 正确分支
    您好,抱歉给您带来不便。请补充:报表名称或类型、数据时间范围、点了导出后一直转圈的具体步骤,以及 Chrome 版本。信息不全我先帮您转给同事核实。
  送给 account  
    您好,报表导出卡住建议先换无痕窗口或清缓存重试,也可换浏览器试一次。若仍无响应,请把报表名称、操作时间、报错截图发来,我会转给同事核实。请勿在工单中发送密码或验证码。
```

我动手前以为送错的回复会离谱,实际上**多数只是平庸,不是灾难**:

- 重复扣费送给技术分支:它让客户补「扣款账户、支付方式、操作步骤」,对一个已经给了订单号和金额的人来说是多余的追问。
- 重复扣费送给账号分支:回复还行,但莫名多了「请勿发送密码或验证码」。
- 导出报表送给计费分支:只回了「转给同事」,客户得不到任何排查建议,白等一轮。送给账号分支反倒给了换无痕窗口、清缓存的建议,碰巧有用,但文末同样多一句无关的安全提醒。

所以送错的主要代价是**浪费客户一个来回**和**偶尔的答非所问**,不是出事故。这是因为我的 `REPLY_RULE` 给每个分支都加了「不要说已核实、转给同事」这样的收口,压住了分支的最坏表现。如果分支里带了写操作工具(比如计费分支能提交退款),送错的代价会大得多。**路由和后面能做什么事是连着的**,分支能力越大,分类越要准、阈值越要严。

## 三种做法的账

最后算账。同样 30 张工单,三种做法:全部交给小模型用一个通用提示词(不分类);全部交给大模型用一个通用提示词;路由(小模型分类,计费走大模型,`other` 转人工)。`part03/wf2_cost.py`:

```python
# agent-zero-lab/part03/wf2_cost.py  Day 198:三种做法处理同样 30 张工单,比钱、比时间、比转人工几张
import time
from collections import Counter
from collections.abc import Callable

from part03.routing_data import TICKETS
from part03.wf2_routing import REPLY_RULE, route
from part03.wf_common import BIG_MODEL, MODEL, llm, total_calls, total_cost

GENERIC = "你是云簿 CloudLedger 的客服,处理各类客户工单。" + REPLY_RULE


def all_with(model: str) -> Callable[[str], bool]:
    def run(text: str) -> bool:
        llm(text, system=GENERIC, model=model)
        return False  # 不分类,全都自动回复,没有转人工

    return run


HANDOFF_REASONS: Counter[str] = Counter()  # 路由转人工的原因各几张


def routed(text: str) -> bool:
    r = route(text)
    if r.status == "handoff":
        HANDOFF_REASONS[r.reason] += 1
    return r.status == "handoff"


STRATEGIES: dict[str, Callable[[str], bool]] = {
    "全部交给小模型,一个通用提示词": all_with(MODEL),
    "全部交给大模型,一个通用提示词": all_with(BIG_MODEL),
    "路由:小模型分类,计费走大模型": routed,
}

if __name__ == "__main__":
    for name, fn in STRATEGIES.items():
        k0, c0, t0 = total_calls(), total_cost(), time.perf_counter()
        handoffs = sum(fn(text) for text, _ in TICKETS)
        n = len(TICKETS)
        print(f"{name}: 转人工 {handoffs} 张 | {total_calls() - k0} 次调用 | {(time.perf_counter() - t0) / n:.2f} 秒/张 | ¥{(total_cost() - c0) / n:.4f}/张(共 ¥{total_cost() - c0:.4f})")
    print("路由转人工的原因:", dict(HANDOFF_REASONS))
```

<div class="line-notes">

- `from collections import Counter` 数转人工原因。
- `GENERIC = "你是云簿 CloudLedger 的客服,处理各类客户工单。" + REPLY_RULE` 通用提示词:不分类,一个提示词管所有。结尾沿用同一个 `REPLY_RULE`,这样对比的是「分不分类」,不是「有没有收口规则」。
- `def all_with(model: str) -> Callable[[str], bool]:` 造一个「用指定模型、通用提示词回答」的函数,是闭包写法。
- `llm(text, system=GENERIC, model=model)` 回复内容这里丢掉了,只关心账。
- `return False  # 不分类,全都自动回复,没有转人工` 返回值表示「有没有转人工」,这里恒为假。
- `HANDOFF_REASONS: Counter[str] = Counter()  # 路由转人工的原因各几张` 模块级计数器。`Counter` 是字典的子类,缺的键默认为 0。
- `r = route(text)` 路由版:分类加分支。
- `HANDOFF_REASONS[r.reason] += 1` 转人工时把原因记上一笔。
- `STRATEGIES: dict[str, Callable[[str], bool]] = {` 三种做法放进字典。
- `k0, c0, t0 = total_calls(), total_cost(), time.perf_counter()` 起点三个值,三种做法各自前后相减。
- `handoffs = sum(fn(text) for text, _ in TICKETS)` 对 30 张都跑一遍,把「是否转人工」的布尔值加起来。`_` 表示标准答案这里用不上。
- `print("路由转人工的原因:", dict(HANDOFF_REASONS))` 最后看转人工是为什么。

</div>

```bash
uv run python -m part03.wf2_cost
```

```text
全部交给小模型,一个通用提示词: 转人工 0 张 | 30 次调用 | 0.98 秒/张 | ¥0.0005/张(共 ¥0.0149)
全部交给大模型,一个通用提示词: 转人工 0 张 | 30 次调用 | 1.37 秒/张 | ¥0.0018/张(共 ¥0.0535)
路由:小模型分类,计费走大模型: 转人工 6 张 | 54 次调用 | 1.71 秒/张 | ¥0.0013/张(共 ¥0.0397)
路由转人工的原因: {'分到 other,没有对应的分支': 6}
```

读账本,先别急着说路由省钱:

- **比全大模型便宜**:路由每张 ¥0.0013,全大模型 ¥0.0018,省约 28%。大头在约 9 张计费分支的工单走的是大模型(含那张被分错的 14 号),其余约 15 张走小模型,另外 6 张直接转人工、没有花回复的钱。
- **比全小模型贵**:全小模型每张只要 ¥0.0005,路由要 ¥0.0013,是 2.6 倍。路由多了一次分类调用(30 次,约 ¥0.013),计费分支又用了贵的模型。
- **耗时最长**:路由 1.71 秒/张,因为要先分类、再回复,两次串行调用。

所以这笔账说的是:**路由不是为了省钱,是为了「每一类工单用对的提示词和对的模型」**。省钱的前提是「小模型在大部分分支上已经够用」,而这件事要靠评测证明(第六部分)。上面三种做法的回复质量我一个字都没比,只比了账。如果小模型通用回复已经够好,最划算的做法其实是第一行,不分类。路由值钱的情形是:分支之间的要求真的不同(计费要精确复述数字,账号要安全提醒),或者某个分支必须用更强的模型。

6 张转人工全是 `other`,没有一张是因为置信度或格式,也没有因为分类错被误转。

## 用剧本测试路由

路由的每个出口都能用离线测试钉住。把 `classify` 和 `llm` 换成假的,让分类结果由测试指定。新建 `tests/test_wf2_routing.py`:

```python
# agent-zero-lab/tests/test_wf2_routing.py  Day 198:不调真模型,验证分类结果的解析和路由的每个出口
from typing import Any

import pytest

from part03 import wf2_routing
from part03.wf2_classify import Classification, parse_classification
from part03.wf_common import BIG_MODEL, MODEL


@pytest.mark.parametrize(
    "raw, expected",
    [
        ({"category": "billing", "confidence": 0.9}, Classification("billing", 0.9)),
        ({"category": "account", "confidence": "0.85"}, Classification("account", 0.85)),  # 数字写成了字符串
        ({"category": "refund", "confidence": 0.9}, None),  # 不在四个类别里
        ({"category": "billing", "confidence": 1.5}, None),  # 置信度超范围
        ({"category": "billing", "confidence": "很高"}, None),  # 不是数字
        ({"category": "billing"}, Classification("billing", 0.0)),  # 没给置信度,按 0 算
        ({}, None),
    ],
)
def test_parse_classification(raw: dict[str, Any], expected: Classification | None) -> None:
    assert parse_classification(raw) == expected


class Spy:
    """记下 llm 的调用(提示词、系统提示词、模型),并让 classify 返回写死的结果。"""

    def __init__(self, result: Classification | None) -> None:
        self.result = result
        self.llm_calls: list[dict[str, Any]] = []

    def classify(self, ticket: str, model: str | None = None) -> Classification | None:
        return self.result

    def llm(self, prompt: str, system: str = "", model: str | None = None) -> str:
        self.llm_calls.append({"prompt": prompt, "system": system, "model": model})
        return "回复"


def install(monkeypatch: pytest.MonkeyPatch, result: Classification | None) -> Spy:
    s = Spy(result)
    monkeypatch.setattr(wf2_routing, "classify", s.classify)
    monkeypatch.setattr(wf2_routing, "llm", s.llm)
    return s


def test_bad_classification_hands_off_without_calling_llm(monkeypatch: pytest.MonkeyPatch) -> None:
    s = install(monkeypatch, None)
    r = wf2_routing.route("x")
    assert r.status == "handoff" and "格式" in r.reason
    assert s.llm_calls == []


def test_other_has_no_branch(monkeypatch: pytest.MonkeyPatch) -> None:
    s = install(monkeypatch, Classification("other", 0.99))
    r = wf2_routing.route("你们周末上班吗")
    assert r.status == "handoff" and r.category == "other"
    assert s.llm_calls == []


def test_low_confidence_hands_off(monkeypatch: pytest.MonkeyPatch) -> None:
    s = install(monkeypatch, Classification("billing", 0.5))
    r = wf2_routing.route("x", threshold=0.8)
    assert r.status == "handoff" and "低于" in r.reason
    assert s.llm_calls == []


def test_confidence_equal_to_threshold_passes(monkeypatch: pytest.MonkeyPatch) -> None:
    install(monkeypatch, Classification("account", 0.8))
    assert wf2_routing.route("x", threshold=0.8).status == "handled"


def test_billing_goes_to_big_model_with_its_own_system_prompt(monkeypatch: pytest.MonkeyPatch) -> None:
    s = install(monkeypatch, Classification("billing", 0.95))
    r = wf2_routing.route("被扣了两次")
    assert r.status == "handled" and r.reply == "回复"
    call = s.llm_calls[0]
    assert call["model"] == BIG_MODEL and "计费专员" in call["system"] and call["prompt"] == "被扣了两次"


def test_technical_goes_to_default_model(monkeypatch: pytest.MonkeyPatch) -> None:
    s = install(monkeypatch, Classification("technical", 0.95))
    wf2_routing.route("报错")
    assert s.llm_calls[0]["model"] == MODEL and "技术支持" in s.llm_calls[0]["system"]
```

<div class="line-notes">

- `from part03.wf2_classify import Classification, parse_classification` 测解析函数,也要用 `Classification` 造预期值。
- `from part03.wf_common import BIG_MODEL, MODEL` 测「计费分支用大模型、技术分支用默认模型」。
- `@pytest.mark.parametrize(` 解析函数一次测 7 组输入。
- `({"category": "account", "confidence": "0.85"}, Classification("account", 0.85)),  # 数字写成了字符串` 模型把 0.85 写成 `"0.85"`,应该照样解析成数字。
- `({"category": "refund", "confidence": 0.9}, None),  # 不在四个类别里` 模型自己发明的类别,必须拒绝。
- `({"category": "billing", "confidence": 1.5}, None),  # 置信度超范围` 范围外拒绝。
- `({"category": "billing", "confidence": "很高"}, None),  # 不是数字` `float("很高")` 抛 `ValueError`,被 `except` 接住。
- `({"category": "billing"}, Classification("billing", 0.0)),  # 没给置信度,按 0 算` 没给置信度不算坏数据,但会在路由里因为低于阈值转人工。
- `assert parse_classification(raw) == expected` dataclass 自带 `==`,两个字段都相等就相等,所以能直接比较。
- `class Spy:` 间谍:`classify` 返回测试指定的结果,`llm` 记下每次被调用的参数。
- `self.llm_calls: list[dict[str, Any]] = []` 每次 `llm` 调用记一个字典:提示词、系统提示词、模型。
- `monkeypatch.setattr(wf2_routing, "classify", s.classify)` 换掉 `wf2_routing` 里的 `classify`。
- `def test_bad_classification_hands_off_without_calling_llm(` 出口一:格式坏。
- `assert s.llm_calls == []` 钉住:转人工时一次回复调用都没发。
- `def test_other_has_no_branch(` 出口二。
- `def test_low_confidence_hands_off(` 出口三。
- `def test_confidence_equal_to_threshold_passes(` 边界:0.8 对 0.8 要通过。差一位的 `<=` 和 `<` 就是在这里区分。
- `assert call["model"] == BIG_MODEL and "计费专员" in call["system"] and call["prompt"] == "被扣了两次"` 一条断言钉住三件事:用了大模型、用了计费专员的系统提示词、用户消息是工单原文。
- `assert s.llm_calls[0]["model"] == MODEL and "技术支持" in s.llm_calls[0]["system"]` 技术分支用默认模型。

</div>

```bash
uv run pytest -q tests/test_wf2_routing.py
```

```text
.............                                                            [100%]
13 passed in 1.37s
```

## 动手练习

### 练习 1:改提示词,怎么知道真的变好了

第 14 号「发票 PDF 空白页」两个模型都分错。试三个版本的分类提示词:A 只有类别名,没有说明;B 带类别说明(现用版);C 在 B 的基础上加一条规则「发票文件下载、打开、导出出现异常属于 technical」。除了 30 张旧工单,另外写 8 张**没拿来调过提示词**的新工单做对照。每个版本都量一遍。先猜:C 能全对吗?它的提升可信吗?新建 `part03/ex198_ablation.py`。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part03/ex198_ablation.py  Day 198 练习 1:分类提示词改三个版本,在 30 张旧工单和 8 张没见过的新工单上各量一遍
from part03 import wf2_classify
from part03.routing_data import TICKETS
from part03.wf_common import total_cost

HOLDOUT = [  # 8 张我另外写的、从没拿来调过提示词的工单
    ("发票 PDF 点下载只得到一个损坏的文件,打不开。", "technical"),
    ("为什么我这个月被收了两次存储空间费?", "billing"),
    ("新员工收不到邀请邮件,没法加入团队。", "account"),
    ("导出的账单 Excel 里金额列全是乱码。", "technical"),
    ("我想开一张去年 12 月的发票,但页面没有这个月份可选。", "billing"),
    ("忘了我是用哪个邮箱注册的,怎么找回账号?", "account"),
    ("你们有没有面向学校的优惠?", "billing"),
    ("你们和 Salesforce 的集成支持哪些版本?", "other"),
]

BARE = "把客服工单分到一个类别。输出 JSON:{\"category\": \"billing|technical|account|other\", \"confidence\": 0 到 1 之间的小数}\n\n工单:\n"
WITH_DESC = wf2_classify.CLASSIFY_PROMPT
WITH_RULE = WITH_DESC.replace("输出 JSON", "注意:发票文件下载、打开、导出出现异常属于 technical,不属于 billing。\n输出 JSON")

def score(pairs: list[tuple[str, str]]) -> tuple[int, list[tuple[str, str, str | None]]]:
    """返回 (答对几张, 答错的清单)。每张工单只调一次分类。"""
    wrong: list[tuple[str, str, str | None]] = []
    for text, truth in pairs:
        c = wf2_classify.classify(text)
        pred = c.category if c else None
        if pred != truth:
            wrong.append((text[:14], truth, pred))
    return len(pairs) - len(wrong), wrong


if __name__ == "__main__":
    c0 = total_cost()
    for name, prompt in [("A 只有类别名", BARE), ("B 带类别说明(现用版)", WITH_DESC), ("C B 再加一条发票文件规则", WITH_RULE)]:
        wf2_classify.CLASSIFY_PROMPT = prompt  # classify 每次调用才读这个名字,换了就生效
        old_ok, old_wrong = score(TICKETS)
        new_ok, new_wrong = score(HOLDOUT)
        print(f"{name}: 旧 30 张答对 {old_ok} | 新 8 张答对 {new_ok}")
        for text, truth, pred in old_wrong + new_wrong:
            print(f"    答错:{text}… 标准 {truth},分成了 {pred}")
    print(f"花费 ¥{total_cost() - c0:.4f}")
```

<div class="line-notes">

- `from part03 import wf2_classify` 要替换模块里的 `CLASSIFY_PROMPT`,导入模块本身。
- `HOLDOUT = [  # 8 张我另外写的、从没拿来调过提示词的工单` 留出集(holdout):调提示词时不看它,最后用它检查提升是不是只对旧工单有效。
- `("发票 PDF 点下载只得到一个损坏的文件,打不开。", "technical"),` 新集里和 14 号同类的一张。我写它的时候已经知道 14 号的问题,所以它**不是独立的**,这一点下面会说。
- `("你们和 Salesforce 的集成支持哪些版本?", "other"),` 这张我标 other:问集成,但不是故障也不是计费,边界模糊。
- `BARE = "把客服工单分到一个类别。输出 JSON:` 版本 A:没有类别说明。
- `WITH_DESC = wf2_classify.CLASSIFY_PROMPT` 版本 B:现用版。
- `WITH_RULE = WITH_DESC.replace("输出 JSON", "注意:发票文件下载、打开、导出出现异常属于 technical,不属于 billing。\n输出 JSON")` 版本 C:在「输出 JSON」前插入一条规则。`str.replace` 返回新字符串。
- `def score(pairs: list[tuple[str, str]]) -> tuple[int, list[tuple[str, str, str | None]]]:` 对一批 (工单, 标准答案) 打分,返回答对几张和答错的清单。
- `c = wf2_classify.classify(text)` 每张只调一次。
- `wrong.append((text[:14], truth, pred))` 工单只存前 14 个字,够认出是哪张。
- `return len(pairs) - len(wrong), wrong` 答对数就是总数减答错数。
- `wf2_classify.CLASSIFY_PROMPT = prompt  # classify 每次调用才读这个名字,换了就生效` 换提示词。`classify` 函数每次执行时去模块里找 `CLASSIFY_PROMPT`,所以改了立刻生效。
- `old_ok, old_wrong = score(TICKETS)` 旧 30 张。
- `new_ok, new_wrong = score(HOLDOUT)` 新 8 张。

</div>

```bash
uv run python -m part03.ex198_ablation
```

我跑了两遍(每遍花 ¥0.0444),第一遍:

```text
A 只有类别名: 旧 30 张答对 29 | 新 8 张答对 6
    答错:发票 PDF 下载下来是空白… 标准 technical,分成了 billing
    答错:你们有没有面向学校的优惠?… 标准 billing,分成了 other
    答错:你们和 Salesforce… 标准 other,分成了 technical
B 带类别说明(现用版): 旧 30 张答对 29 | 新 8 张答对 6
    答错:发票 PDF 下载下来是空白… 标准 technical,分成了 billing
    答错:发票 PDF 点下载只得到一… 标准 technical,分成了 billing
    答错:你们和 Salesforce… 标准 other,分成了 technical
C B 再加一条发票文件规则: 旧 30 张答对 30 | 新 8 张答对 8
花费 ¥0.0444
```

第二遍:

```text
A 只有类别名: 旧 30 张答对 29 | 新 8 张答对 4
    答错:发票 PDF 下载下来是空白… 标准 technical,分成了 billing
    答错:发票 PDF 点下载只得到一… 标准 technical,分成了 billing
    答错:导出的账单 Excel 里金… 标准 technical,分成了 billing
    答错:你们有没有面向学校的优惠?… 标准 billing,分成了 other
    答错:你们和 Salesforce… 标准 other,分成了 technical
B 带类别说明(现用版): 旧 30 张答对 29 | 新 8 张答对 7
    答错:发票 PDF 下载下来是空白… 标准 technical,分成了 billing
    答错:发票 PDF 点下载只得到一… 标准 technical,分成了 billing
C B 再加一条发票文件规则: 旧 30 张答对 30 | 新 8 张答对 8
花费 ¥0.0444
```

读法:

1. **同一个提示词跑两遍,结果会不一样。** B 在新集上第一遍 6、第二遍 7;A 第一遍 6、第二遍 4。因为模型有随机性,同样的输入也不保证同样的输出。**两三张的差别不是信号**,所以 A 和 B 谁好我下不了结论,只能说 B 没有明显比 A 差,类别说明在这批数据上没拉开差距。
2. **C 两遍都是 30/30 加 8/8**,而且这个提升跨过了两遍随机波动,我愿意相信它是真的。
3. 但也要打折扣:新集里的发票文件那张,是我看过 14 号的错误之后写的,和规则几乎是同一个模式,不算独立。要证明规则没有过拟合,得用**不同类型**的新数据:比如「合同 PDF 打不开」「导出的 CSV 乱码」。而且这条规则可能副作用,把真的「发票开错抬头」分成 technical,我的 30 张里没有足够的这类数据量出来。

**规则:提示词改一处,在旧集上看有没有掉分,在没见过的新集上看有没有涨分,每个版本多跑几遍看波动。** 30 张只能发现明显问题,真要上线,评测集要大得多,而且要是真实流量里抽出来的。第六部分会系统讲。

</details>

### 练习 2:两个模型投票,不一致就转人工

上面看到两个模型在 30 张上完全一致,筛不出东西。换成 10 张我故意写成「混着两类」的工单,看两个模型的意见会不会分歧。新建 `part03/ex198_vote.py`。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part03/ex198_vote.py  Day 198 练习 2:两个模型分类,不一致就转人工,能不能筛出难的
from part03.routing_data import TICKETS
from part03.wf2_classify import classify
from part03.wf_common import BIG_MODEL, MODEL, total_cost

AMBIGUOUS = [  # 10 张我故意写成「混着两类」的工单,没有唯一标准答案
    "登录后发现账单里有一笔不认识的扣费。",
    "离职同事还在用我们的账号,而且每月还在扣他那份的钱。",
    "改了邮箱以后发票还是发到旧邮箱,没法下载。",
    "同步失败之后我被扣了两次费。",
    "我想把专业版的席位转给另一个部门,费用怎么算?",
    "API 密钥泄露了,要重置,而且要核对这几天有没有异常扣费。",
    "忘记密码,而且旧邮箱已经停用,发票也要重开。",
    "导出的发票金额和账单页对不上。",
    "管理员离职了,没人能改套餐了,下个月还会自动续费。",
    "手机端付款成功了但订阅状态还是未开通。",
]


def disagree(texts: list[str]) -> list[tuple[str, str, str]]:
    out: list[tuple[str, str, str]] = []
    for t in texts:
        a, b = classify(t, model=MODEL), classify(t, model=BIG_MODEL)
        ca, cb = (a.category if a else "?"), (b.category if b else "?")
        if ca != cb:
            out.append((t[:16], ca, cb))
    return out


if __name__ == "__main__":
    c0 = total_cost()
    texts = [t for t, _ in TICKETS]
    d = disagree(texts)
    print(f"30 张有标准答案的:两个模型意见不一致 {len(d)} 张", d)
    d = disagree(AMBIGUOUS)
    print(f"10 张混着两类的:意见不一致 {len(d)} 张")
    for t, ca, cb in d:
        print(f"    {t}… 小模型 {ca} / 大模型 {cb}")
    print(f"花费 ¥{total_cost() - c0:.4f}")
```

<div class="line-notes">

- `AMBIGUOUS = [  # 10 张我故意写成「混着两类」的工单,没有唯一标准答案` 没有标准答案是故意的:这些工单本来就该由人来判断。
- `"登录后发现账单里有一笔不认识的扣费。",` 开头登录、实质扣费。
- `"离职同事还在用我们的账号,而且每月还在扣他那份的钱。",` 账号加扣费,两件事。
- `"手机端付款成功了但订阅状态还是未开通。",` 付款和功能状态,也是两件事。
- `def disagree(texts: list[str]) -> list[tuple[str, str, str]]:` 对一批工单,返回两个模型意见不一致的那些,每条是 (工单前 16 字, 小模型的类别, 大模型的类别)。
- `a, b = classify(t, model=MODEL), classify(t, model=BIG_MODEL)` 同一张工单分别交给两个模型。
- `ca, cb = (a.category if a else "?"), (b.category if b else "?")` 分类失败(`None`)的用 `"?"` 表示。
- `if ca != cb:` 意见不一致才记下。
- `d = disagree(texts)` 先看 30 张有标准答案的。
- `d = disagree(AMBIGUOUS)` 再看 10 张混着的。

</div>

```bash
uv run python -m part03.ex198_vote
```

```text
30 张有标准答案的:两个模型意见不一致 0 张 []
10 张混着两类的:意见不一致 2 张
    离职同事还在用我们的账号,而且每… 小模型 account / 大模型 billing
    管理员离职了,没人能改套餐了,下… 小模型 account / 大模型 billing
花费 ¥0.0430
```

在 30 张上 0 张分歧,等于没筛出任何东西(包括那张两个模型一起答错的 14 号)。在 10 张混着的上有 2 张分歧,而且恰好是最典型的「账号问题顺带牵涉扣费」,这两张转人工是合理的。另外 8 张两个模型意见一致,但没有标准答案,我也不能说它们分对了。

结论:**投票能筛出「模型自己也拿不准」的那类,筛不出「模型一致地错」的那类。** 代价是每张多调一次大模型,这次 80 次调用花了 ¥0.043。如果你的分类错误主要是「一致地错」(比如提示词里的边界定义有歧义,第 14 号就是),投票帮不上,要去改提示词或加规则(练习 1)。

</details>

### 练习 3:30 张工单并发分类

串行分类 30 张要多久?用 `allm_json` 加 `asyncio.gather` 加 `Semaphore` 限制同时在飞的请求数,对比并发上限 5 和 10。新建 `part03/ex198_async_classify.py`。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part03/ex198_async_classify.py  Day 198 练习 3:30 张工单的分类,串行和并发各跑一遍
import asyncio
import time

from part03.routing_data import TICKETS
from part03.wf2_classify import CLASSIFY_PROMPT, Classification, classify, parse_classification
from part03.wf_common import allm_json, total_cost


async def aclassify(ticket: str, sem: asyncio.Semaphore) -> Classification | None:
    async with sem:  # 同时在飞的请求不超过信号量的名额
        return parse_classification(await allm_json(CLASSIFY_PROMPT + ticket))


async def classify_all(limit: int) -> list[Classification | None]:
    sem = asyncio.Semaphore(limit)
    return list(await asyncio.gather(*(aclassify(text, sem) for text, _ in TICKETS)))


if __name__ == "__main__":
    c0 = total_cost()
    t0 = time.perf_counter()
    serial = [classify(text) for text, _ in TICKETS]
    t_serial = time.perf_counter() - t0
    for limit in (5, 10):
        t0 = time.perf_counter()
        par = asyncio.run(classify_all(limit))
        ok = sum(c is not None and c.category == truth for c, (_, truth) in zip(par, TICKETS))
        print(f"并发上限 {limit}: {time.perf_counter() - t0:.1f} 秒,答对 {ok}/30")
    ok = sum(c is not None and c.category == truth for c, (_, truth) in zip(serial, TICKETS))
    print(f"串行: {t_serial:.1f} 秒,答对 {ok}/30")
    print(f"花费 ¥{total_cost() - c0:.4f}")
```

<div class="line-notes">

- `from part03.wf2_classify import CLASSIFY_PROMPT, Classification, classify, parse_classification` 复用解析函数。异步版分类只是把「调模型」那一步换成异步的,别的不重写。
- `from part03.wf_common import allm_json, total_cost` Day 196 建的异步 JSON 函数。
- `async def aclassify(ticket: str, sem: asyncio.Semaphore) -> Classification | None:` 一张工单的异步分类,多一个信号量参数。
- `async with sem:  # 同时在飞的请求不超过信号量的名额` `Semaphore(10)` 像一个有 10 个名额的门:进去占一个名额,出来还回去。名额用完,新来的在门外排队。好处是不会一下子把 30 个请求同时打给服务端被限流。
- `return parse_classification(await allm_json(CLASSIFY_PROMPT + ticket))` `await` 等模型返回,然后照样走解析,坏数据一样会变成 `None`。
- `sem = asyncio.Semaphore(limit)` 每次 `classify_all` 新建一个,`limit` 是名额数。
- `return list(await asyncio.gather(*(aclassify(text, sem) for text, _ in TICKETS)))` 30 个协程交给 `gather`,返回结果按传入顺序排列,所以下面能和 `TICKETS` 的标准答案一一对应。
- `serial = [classify(text) for text, _ in TICKETS]` 串行:一张一张来。
- `for limit in (5, 10):` 两个并发上限各跑一遍。
- `par = asyncio.run(classify_all(limit))` 每个上限一次 `asyncio.run`。
- `ok = sum(c is not None and c.category == truth for c, (_, truth) in zip(par, TICKETS))` `zip` 把结果和工单配对,`(_, truth)` 拆出标准答案。

</div>

```bash
uv run python -m part03.ex198_async_classify
```

```text
并发上限 5: 4.6 秒,答对 29/30
并发上限 10: 2.4 秒,答对 29/30
串行: 19.4 秒,答对 29/30
花费 ¥0.0385
```

串行 19.4 秒,上限 5 是 4.6 秒,上限 10 是 2.4 秒,答对数都是 29/30,准确率没因为并发变化。上限 5 时每批 5 个、约 6 批,时间大致是 6 个往返;上限 10 是 3 批。再往上加,会开始撞服务端的限流(Day 126 的 429),省下的时间不值得。

注意:这三次一共调了 90 次模型,花了 ¥0.0385。并发让你**更快**,不让你更省钱。

</details>

## 花费

文中命令跑一遍的大致花费:`wf2_eval`(flash 加 pro 各 30 次)¥0.0336,`wf2_routing` 主程序 3 次约 ¥0.002,`wf2_misroute` 6 次约 ¥0.005,`wf2_cost` 三种做法共 114 次 ¥0.108(是今天最贵的,0.0149 + 0.0535 + 0.0397),练习 1 一遍 ¥0.0444,练习 2 ¥0.0430,练习 3 ¥0.0385,`wf2_threshold` 不调模型。合计约 ¥0.27(练习 1 我跑了两遍,实际多花一份)。价格按 `.env` 里的高峰价:deepseek-flash 缓存命中 0.04、未命中 2、输出 8 元每百万 token,deepseek-v4-pro 是 0.3、9、27,我 2026 年 10 月查过 DeepSeek 价格页。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 路由(routing) | 先给输入分类,再交给专门的后续处理。例:工单分到计费、技术、账号三个分支 |
| 分支(handler) | 路由后接手的一条处理路线,有自己的系统提示词,也可以有自己的模型 |
| 置信度(confidence) | 分类器自己报的「有多确定」,0 到 1。模型自报的,不一定准 |
| 阈值(threshold) | 置信度低于它就不自动处理,转人工的那条线。要用评测数据定 |
| 评测集 | 带标准答案的一批样本,用来量系统好坏。今天的 30 张工单 |
| 留出集(holdout) | 调提示词时不看、最后用来检查提升是否只对旧数据有效的样本 |
| 准确率 | 答对的占比。今天 29/30 |
| 误转 / 漏转 | 本来答对却被转人工(冤枉),本来该转人工却自动处理了(漏掉) |
| 缓存命中(cache hit) | 提示词前面一段和之前的请求完全相同时,服务端少收一部分钱。今天 pro 命中了、flash 没命中 |
| `Semaphore` | 限制同时进行的任务数的计数器,相当于有名额的门 |

## 常见误区

**以为路由是为了省钱。** 今天的账里路由比全小模型贵 2.6 倍,比全大模型便宜 28%。它的价值是每类工单用对的提示词和模型,省钱只在「小模型够用、大模型只留给难分支」时才成立,而这要评测证明。

**相信模型自报的置信度。** flash 30 张全在 0.93 到 0.99,答错那张是 0.95,同样 0.95 的答对了 9 张。阈值 0.8 在这个模型上等于没设。置信度要用自己的数据画表验过才能用。

**拿价目表的倍数估账单。** pro 价目表贵 3 到 4 倍,今天账上只贵 1.6 倍,因为 pro 命中了提示词缓存、flash 没命中。估价看真实账本,不看价目表。

**把「两个模型一致」当成「对」。** 两个模型在 30 张上完全一致,包括一起错的那张。一致只能说明它们对这张的判断相同,不能说明对。投票筛的是「拿不准」,筛不了「一致地错」。

**改了提示词只看一次结果。** 练习 1 里同一个版本跑两遍,新集上答对数在 6 和 7、6 和 4 之间跳。两三张的差不是信号。每个版本多跑几遍,并且留一份没调过的新数据。

**分类器返回什么都直接用。** 模型会把 `0.85` 写成 `"0.85"`,会发明 `"refund"` 这样的类别,会给 `1.5` 的置信度。`parse_classification` 把这些都挡在门外,后面的代码才能放心地 `HANDLERS[c.category]`。

**以为送错分支一定出大事。** 今天的实验里送错的回复多数只是平庸:多余的追问、多余的安全提醒。但分支能力越大(比如带写操作工具)代价越大,所以分支越强,分类越要准、阈值越要严。

**分支提示词没限制写作对象。** 我的第一版计费分支回的是「# 处理方案:一、核实流水……」,给客户写成了给同事的内部步骤。分支提示词要明说「写给客户」,并且说明没有的权限(不能查系统、不能说已核实)。

## 学习资料

### 文档与文章

- [Anthropic · Building effective agents](https://www.anthropic.com/engineering/building-effective-agents):读「Workflow: Routing」一节,两个例子(客服分流、按难度分模型)今天都做了。英文。
- [claude-cookbooks · basic_workflows.ipynb](https://github.com/anthropics/claude-cookbooks/blob/main/patterns/agents/basic_workflows.ipynb):官方的路由参考实现,用 XML 标签让模型先写理由再选分支,和今天的 JSON 写法对照看。英文。
- [RouteLLM 论文 · Learning to Route LLMs with Preference Data](https://arxiv.org/abs/2406.18665):LMSYS 团队的论文,训练一个路由器在强弱两个模型之间选,在保证质量的前提下省大量成本。今天是手写规则版,这篇是学出来的版本。英文。
- [DeepSeek API 文档 · 上下文硬盘缓存](https://api-docs.deepseek.com/zh-cn/guides/kv_cache):中文,讲前缀相同时怎么命中缓存、怎么计费,对照今天 pro 命中 128 个 token 的现象。
- [Python 文档 · asyncio 同步原语](https://docs.python.org/zh-cn/3.12/library/asyncio-sync.html):中文,`Semaphore` 的用法。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1KZBMBcEgN&autoplay=0&high_quality=1" title="Workflow 模式之:Routing —在一切开始之前,先选对路|精读《Building Effective Agents》④" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>慢学AI · Workflow 模式之:Routing —在一切开始之前,先选对路 · 4 分钟,讲路由的定义和适用场景,看完对照今天的「路由是什么」一节。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/V_K6PCmdtRg" title="What is an LLM Router?" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Sam Witteveen · What is an LLM Router? · 讲 LLM 路由的几种做法:按语义、按难度、按成本,英文。今天做的是最朴素的一种。</figcaption>
</figure>

### 书籍

- Antonio Gulli《Agentic Design Patterns: A Hands-On Guide to Building Intelligent Systems》(Springer, 2025):Routing 一章,带代码,讲基于 LLM 分类、基于向量相似度、基于规则几种路由方式,英文。
- Chip Huyen《AI Engineering》(O'Reilly, 2025):讲模型路由与网关、评测集怎么建,今天的「分类要用带标准答案的数据量」可以对着读,英文。

### 开源项目与代码

- [lm-sys/RouteLLM](https://github.com/lm-sys/RouteLLM):上面论文的开源实现,训练好的路由器可以直接用。
- [aurelio-labs/semantic-router](https://github.com/aurelio-labs/semantic-router):用向量相似度做路由的库,不用每次调模型,第四部分学完向量再回头看。

## 自测

1. 路由和 agent 都是「模型做选择」,区别在哪里?

<details><summary>答案</summary>

路由里模型只在入口选一次类别,然后交棒:分支有几个、各自做什么、用什么模型都是代码写死的,所以仍然是 workflow。Agent 是模型在每一步都重新选下一步做什么。路由的分类结果就算错了,后果也被限制在「走错一个预设分支」里。

</details>

2. `parse_classification` 为什么要把「`"confidence": "0.85"`」当成合法,又把「`"category": "refund"`」当成非法?

<details><summary>答案</summary>

字符串 `"0.85"` 的意思没有歧义,`float()` 能转成 0.85,放过不影响后面,还少一次误转人工。`"refund"` 不在四个类别里,后面 `HANDLERS[c.category]` 要用它当键,放进去会 `KeyError` 或者走错分支,所以必须在入口拦下。判断标准是:这份输出的意思我能不能确定,后面的代码能不能放心用。

</details>

3. 实测里阈值定在 0.8 是什么效果?要拦下答错的那一张阈值得定多少,代价是什么?

<details><summary>答案</summary>

0.8 时 30 张全部自动处理,一张没拦,因为模型报的置信度都在 0.93 以上。要拦下答错那张(置信度 0.95)得把阈值定到 0.96,代价是同时有 10 张本来答对的也被转人工,约三分之一的量。因为 0.95 这个值上还有 9 张答对的,没有阈值能只拦它。

</details>

4. 路由比全小模型贵 2.6 倍,还值得做吗?

<details><summary>答案</summary>

看分支之间是不是真的需要不同的处理。如果小模型加一个通用提示词的回复质量已经够用(要用评测证明),不分类最划算。路由值得的情形有:不同类别的要求互相冲突、写在一个提示词里会变长变乱;某一类必须用更强的模型或带不同的工具(比如计费分支要能提交退款);某一类必须转人工或走别的系统(比如 `other`)。判断依据是评测里的质量差距,不是账面成本。

</details>

5. 面试题:你的客服系统用了意图分类做路由,上线后发现有一类工单总是被分错到别的分支。你怎么排查和修?

<details><summary>答案</summary>

先从线上日志里把这一类被分错的真实工单抽出来,标上正确答案,建成评测集;看它们被分成了什么、置信度多少、是不是都有同一种措辞(比如「发票」「登录」这种会误导的词)。再看提示词里这两个类别的边界是不是写得有歧义,优先改边界说明、加几个易混淆的示例,而不是换更大的模型。每改一版,用旧评测集看没有掉分,用没见过的新数据看有没有涨,并且多跑几遍避开随机波动。如果规则一直打补丁,考虑加一个明确的「拿不准」类别,让它转人工,而不是硬分。上线后继续监控各类别的占比和被人工改派的比例,占比突变往往是第一个信号。如果这一类误分的代价特别高,把阈值针对这一类调高,或者让它不走自动分支。

</details>

## 明天预告

明天是 **Day 199 · 模式三:并行**。路由是「选一条路走」,今天练习 3 里已经偷偷用了一次并发:30 个分类请求同时发,2.4 秒做完 19.4 秒的活。明天把它讲成一个正式的模式:一个任务拆成几个互相独立的子任务同时做(分段),或者同一个任务让模型做好几次再汇总(投票)。投票今天已经见过一个雏形,两个模型一起答错那张,明天会看投票什么时候真的有用。
