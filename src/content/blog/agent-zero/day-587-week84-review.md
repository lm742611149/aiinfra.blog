---
title: 'Day 587 · 第 84 周复习:进阶(Day 581–586)'
description: '这一周从给 Agent 设计奖励、把分诊小模型整理成能交付的流水线,走到平台的三个问题:租户是谁、隔离怎么做、控制面和数据面怎么拆,最后是模型网关和按 token 限流。今天把六天串成一张图,逐天一句话回顾,做一个只用本周知识的小项目:平台前门 front_door.py,让一个请求依次过认租户、核对请求体、暂停开关、模型策略、token 预扣五道关,再默写本周三个核心函数并跑通。'
pubDate: 2026-10-27
regime: none
tags: ['review', 'platform', 'gateway', 'python', 'agent-zero']
series: 'agent-zero'
day: 587
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 586](/blog/agent-zero/day-586-gateway-1/) 打开了平台图里的「模型网关」:业务方只拿虚拟 key,真 key 只在网关里;写了一个 40 行的透传网关,看到业务方只改 `base_url` 和 key 就能接进来;查了 2026 年 10 月 LiteLLM、Portkey、Higress 这些现成方案的现状;然后讲了为什么限流要按 token(同一份流量,按请求数限流放行 45 万 token,按 token 限流只放行 15 万),写了令牌桶,又用真实接口量出「字符数除以 2」这个估算中文少估 15%、英文多估 132%,所以请求要先预扣、拿到响应后再按真实用量结算。

这一周六天,前两天讲模型怎么训、怎么交付,后四天讲平台。看上去是两个话题,其实有一条线:**一个东西做出来、跑通了,和它能被别人放心地用,中间还有一大截**。奖励函数写了不等于模型没钻空子;一堆脚本跑通了不等于别人能复现;一个 Agent 跑得好不等于第二个团队能安全地共用同一套基础设施。今天把这一截理一遍。下周 Day 588 继续网关,把今天的前门接上预算、降级和成本归因。

## 今天要解决的问题

学完今天你应该能做到:

1. 不看文章,说出这一周六天各解决了什么问题,并且能说出两条贯穿的线索:「分数涨了不代表真变好」和「少了一道检查,就会有一类事故」。
2. 写出一个平台前门 `front_door.py`,只用本周学过的东西,让一个请求依次过认租户、核对请求体、暂停开关、模型策略、token 预扣五道关,最后按真实用量结算和记账,并能说清楚为什么这五道关是这个顺序。
3. 默写本周三段核心代码:租户只从 key 认并核对请求体(Day 583)、回退链也要过租户策略的 `pick_model`(Day 584)、令牌桶的 `try_take`(Day 586),跑出和文章一致的数字。

预计用时 3.5 小时(复习日可以长一点)。前置:[Day 581](/blog/agent-zero/day-581-rl-2/) 到 [Day 586](/blog/agent-zero/day-586-gateway-1/) 全部。今天不调 API,不连数据库,花费 0 元。用到的文件是这周建的:`part10/platform/tenants.py`(Day 583)、`part10/platform/model_policy.py`(Day 584)、`part10/gateway/token_bucket.py`(Day 586)。

学法:先对照逐行敲一遍(不复制粘贴)并跑通;第二天合上文章默写核心部分(`recall_week84.py` 里的三段);做练习,做不出再展开参考答案,看完关掉重写一遍。

## 本周知识地图

<figure>
<svg viewBox="0 0 640 360" role="img" aria-label="第 84 周知识地图:模型线两天(奖励设计与 GRPO、流水线与数据卡模型卡)和平台线四天(什么时候做平台与租户、隔离四维度与行级安全、控制面数据面与中间件、模型网关与 token 限流),今天的 front_door 把平台线串起来">
<text x="20" y="24" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">模型线:东西做出来以后,怎么证明它真的变好、怎么交给别人</text>
<rect x="20" y="34" width="290" height="64" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="165" y="56" font-family="var(--font-mono)" font-size="12" fill="var(--ink)" text-anchor="middle">581 奖励设计 + GRPO</text>
<text x="165" y="74" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)" text-anchor="middle">结果/格式/过程/效率</text>
<text x="165" y="89" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)" text-anchor="middle">奖励作弊:宽松的判分被钻</text>
<rect x="330" y="34" width="290" height="64" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="475" y="56" font-family="var(--font-mono)" font-size="12" fill="var(--ink)" text-anchor="middle">582 流水线 + 数据卡模型卡</text>
<text x="475" y="74" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)" text-anchor="middle">清单哈希、Makefile、配置文件</text>
<text x="475" y="89" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)" text-anchor="middle">test 用锁保证只跑一次</text>
<text x="20" y="128" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">平台线:一个 Agent 变成很多团队共用的基础设施</text>
<rect x="20" y="138" width="145" height="74" rx="6" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="92" y="160" font-family="var(--font-mono)" font-size="12" fill="var(--ink)" text-anchor="middle">583 该不该做</text>
<text x="92" y="178" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)" text-anchor="middle">三个信号 七块能力</text>
<text x="92" y="193" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)" text-anchor="middle">租户从 key 认</text>
<rect x="177" y="138" width="145" height="74" rx="6" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="249" y="160" font-family="var(--font-mono)" font-size="12" fill="var(--ink)" text-anchor="middle">584 隔离</text>
<text x="249" y="178" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)" text-anchor="middle">四维度 三种部署</text>
<text x="249" y="193" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)" text-anchor="middle">行级安全兜底</text>
<rect x="334" y="138" width="145" height="74" rx="6" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="406" y="160" font-family="var(--font-mono)" font-size="12" fill="var(--ink)" text-anchor="middle">585 两个面</text>
<text x="406" y="178" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)" text-anchor="middle">快照下发 + 事件推送</text>
<text x="406" y="193" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)" text-anchor="middle">Valkey 队列 向量库</text>
<rect x="491" y="138" width="129" height="74" rx="6" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="555" y="160" font-family="var(--font-mono)" font-size="12" fill="var(--ink)" text-anchor="middle">586 网关</text>
<text x="555" y="178" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)" text-anchor="middle">虚拟 key 令牌桶</text>
<text x="555" y="193" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)" text-anchor="middle">预扣和结算</text>
<line x1="92" y1="212" x2="92" y2="252" stroke="var(--ink-faint)"/>
<line x1="249" y1="212" x2="249" y2="252" stroke="var(--ink-faint)"/>
<line x1="406" y1="212" x2="406" y2="252" stroke="var(--ink-faint)"/>
<line x1="555" y1="212" x2="555" y2="252" stroke="var(--ink-faint)"/>
<text x="20" y="246" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">今天的小项目</text>
<rect x="20" y="256" width="600" height="84" rx="6" fill="none" stroke="var(--rule)" stroke-dasharray="4 3"/>
<text x="320" y="280" font-family="var(--font-mono)" font-size="12" fill="var(--ink)" text-anchor="middle">front_door.py:一个请求过五道关</text>
<text x="320" y="300" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)" text-anchor="middle">认租户(583)→ 核对请求体(583)→ 暂停开关(585)→ 模型策略(584)→ token 预扣(586)</text>
<text x="320" y="320" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)" text-anchor="middle">上游是假的,按真实用量结算,记一行账</text>
</svg>
<figcaption>第 84 周的地图。模型线两天收的是「怎么证明变好、怎么交付」,平台线四天收的是「怎么让很多团队安全地共用」。今天的前门项目只用平台线四天的东西,模型线的东西放在下面的错题清单里复习。</figcaption>
</figure>

## 每天一句话

- [Day 581 · 强化学习(二):给 Agent 设计奖励,GRPO 训练分诊模型](/blog/agent-zero/day-581-rl-2/):Agent 的奖励拆成结果、格式、过程约束、效率四部分,过程违规要重罚(−1.0)而不是扣一点;转人工不扣分时,自己办错扣 −0.5 的话,模型把握不到三分之一就会甩锅;奖励最怕宽松判分,「八个类别全写上」在宽松版里照样拿分。
- [Day 582 · 给 AgentOps 训练路由小模型:流水线、数据卡、模型卡](/blog/agent-zero/day-582-router-pipeline/):一堆实验脚本整理成 Makefile 一条链;数据文件有清单和哈希;训练集和评测题的重合要先查(查出 route_dev 50 张里有 36 张混进了训练集);阈值只在 dev 上选、写进 `route.yaml`;test 用一把锁保证只跑一次;数据卡和模型卡的数字全从报告里填,模板里有缺的键就报错。
- [Day 583 · 平台(一):什么时候该做平台,平台给什么,租户是谁](/blog/agent-zero/day-583-platform-1/):三个信号(第三个团队来要、同一个修复改好几遍、有人要分账)出现了再做;平台给七块能力,三样留给业务团队;租户只能从 API key 认,请求体里自称是谁只用来核对;每条查询都要带 `tenant_id`,漏一次 Maple 就能搜到云簿 VIP 客户的手机号。
- [Day 584 · 平台(二):隔离四维度,silo/pool/bridge,行级安全](/blog/agent-zero/day-584-platform-2/):数据(包括缓存)、配额、密钥、模型四道门各漏一次再补上;默认选 pool、留好切 silo 的口子;行级安全让忘了设租户的查询变成 0 行,但超级用户和没加 `FORCE` 的 owner 照样看到全部 3 行,`WITH CHECK (true)` 能让租户往别家写数据,会话级 `SET` 配连接池会串租户。
- [Day 585 · 平台(三):控制面和数据面,中间件放在哪](/blog/agent-zero/day-585-platform-3/):数据面不能每个请求都问控制面(控制面挂 60 秒,60 个请求全是 500),配快照加版本号加事件推送;Valkey 里 `INCR` 才是对的共享计数(先读后写 160 次只记了 36 次),队列至少执行一次所以处理要幂等,锁会过期,pgvector 带租户过滤小租户默认只能拿到 0 到 4 行,大工具结果放对象存储、上下文里放引用。
- [Day 586 · 模型网关(一):网关管什么,买还是写,按 token 限流](/blog/agent-zero/day-586-gateway-1/):网关骨架是认虚拟 key、换真 key、记账;买还是写要看维护状态和供应链风险(2026 年 3 月 LiteLLM 被投毒);按 token 限流用令牌桶,请求进来时先预扣(估算输入加 `max_tokens`),响应后按真实 `usage` 结算,不结算 5 个请求就多占 1,211 个额度。

这六天有两条线索反复出现。一条是**分数和事实不是一回事**:581 里宽松的判分器给「八个类别全写上」也打满分,训练 reward 涨了不等于真变好;582 里 test 看过再改配置,它就不是没见过的题了;585 的向量检索没有任何报错,只是少返回行;586 的估算偏差也不会报错,只是桶悄悄少了一截。另一条是**少一道检查,就会多一类事故**:583 少了「租户从 key 认」,Maple 的 key 能换来云簿的身份;584 少了 `FORCE`,owner 看到全部数据;585 少了幂等,账多扣一个点数;586 少了结算,桶被白白占满。今天的小项目把平台线这几道检查按顺序摆在一起。

## 小项目:平台前门 front_door.py

### 要做什么

假设 Day 588 要写的最小网关马上要动工,在那之前,先把「一个请求进来,平台应该按什么顺序检查什么」写成一个能跑能测的东西。它不调模型,上游是一个假的函数,只返回确定的 token 数。每一道关都来自这周的一天:

1. 认租户,不认识的 key 回 401(Day 583 的 `resolve`)。
2. 请求体里自称的 `org` 必须和 key 认出来的一致,不一致回 403(Day 583 的 `handle_good`)。
3. 快照里这个租户有没有被暂停,被暂停回 403(Day 585 的快照加暂停开关)。
4. 模型策略:点名的模型要过租户策略,`auto` 时按回退链选,回退链里每一个也要过策略;一个都没有回 503(Day 584 的 `pick_model`)。
5. 按 token 预扣,不够回 429 并带上要等几秒;比整个桶还大回 413(Day 586 的令牌桶)。
6. 调假上游,按真实用量结算(多了还、少了补),记一行账。

新建 `part10/week84/front_door.py`:

```python
# agent-zero-lab/part10/week84/front_door.py
"""第 84 周小项目:平台的「前门」。一个请求进来,按顺序过五道关,最后记一行账:
认租户(Day 583)→ 核对请求体(Day 583)→ 看快照里有没有被暂停(Day 585)→ 模型策略(Day 584)→ 按 token 预扣(Day 586),
上游调用是假的(只返回确定的 token 数),调用完按真实用量结算、记账。不调任何接口,不连数据库。
用法:uv run python part10/week84/front_door.py
"""
import sys
from dataclasses import dataclass, field
from pathlib import Path

PART = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(PART / "platform"), str(PART / "gateway")]

from model_policy import ModelNotAllowed, check, pick_model  # noqa: E402
from tenants import Tenant, UnknownKey, resolve  # noqa: E402
from token_bucket import TokenBucket  # noqa: E402

MAX_TOKENS_CAP = 2048             # 调用方想要的输出上限超过它,按它算
DEFAULT_MAX_TOKENS = 512          # 没填 max_tokens 时的默认值


@dataclass(frozen=True)
class Snapshot:
    version: int
    paused: frozenset[str]
    tpm: dict[str, int]           # 每个租户每分钟能用多少 token


@dataclass
class Response:
    status: int
    detail: str
    model: str | None = None
    retry_after: float | None = None


@dataclass
class Clock:
    now: float = 0.0

    def __call__(self) -> float:
        return self.now


def estimate_input(messages: list[dict[str, str]]) -> int:
    return len("".join(m["content"] for m in messages)) * 2 // 3          # 偏保守:中文约 1.7 字符/token,这里按 1.5


def fake_upstream(messages: list[dict[str, str]], max_tokens: int) -> tuple[int, int]:
    """假的供应商:输入 token = 字符数 ÷ 1.7,输出固定 60 个(不超过 max_tokens)。"""
    chars = len("".join(m["content"] for m in messages))
    return round(chars / 1.7), min(60, max_tokens)


@dataclass
class FrontDoor:
    snap: Snapshot
    clock: Clock
    outages: set[str] = field(default_factory=set)
    buckets: dict[str, TokenBucket] = field(default_factory=dict)
    ledger: list[tuple[str, str, str, int]] = field(default_factory=list)      # (org, project, model, 实际 token)

    def bucket(self, org: str) -> TokenBucket:
        if org not in self.buckets:
            tpm = self.snap.tpm[org]
            self.buckets[org] = TokenBucket(capacity=tpm, rate=tpm / 60, clock=self.clock)
        return self.buckets[org]

    # 第一道和第二道:认租户,核对请求体(Day 583 的两条底线)
    def identify(self, api_key: str, body: dict) -> Tenant | Response:
        try:
            t = resolve(api_key)
        except UnknownKey:
            return Response(401, "unknown key")
        if "org" in body and body["org"] != t.org:
            return Response(403, f"key 属于 {t.org},请求体却说自己是 {body['org']}")
        return t

    # 第三道:快照里有没有被暂停(Day 585)
    def not_paused(self, t: Tenant) -> Response | None:
        return Response(403, f"{t.org} 已被暂停") if t.org in self.snap.paused else None

    # 第四道:模型策略,回退链也要过策略(Day 584)
    def choose_model(self, t: Tenant, body: dict) -> str | Response:
        want = body.get("model", "auto")
        try:
            if want == "auto":
                return pick_model(t.org, self.outages)
            check(t.org, want)
            return want
        except ModelNotAllowed as e:
            return Response(503 if want == "auto" else 403, str(e))

    # 第五道:按 token 预扣(Day 586)。返回预扣额,或者 429
    def reserve(self, t: Tenant, body: dict) -> int | Response:
        max_tokens = min(int(body.get("max_tokens") or DEFAULT_MAX_TOKENS), MAX_TOKENS_CAP)
        need = estimate_input(body["messages"]) + max_tokens
        ok, wait = self.bucket(t.org).try_take(need)
        if ok:
            return need
        if wait == float("inf"):
            return Response(413, f"请求预扣 {need} 比整个桶还大,改小 max_tokens 或拆分")
        return Response(429, f"{t.org} 的 token 额度不够", retry_after=round(wait, 1))

    def admit(self, api_key: str, body: dict) -> Response:
        t = self.identify(api_key, body)
        if isinstance(t, Response):
            return t
        if (r := self.not_paused(t)) is not None:
            return r
        model = self.choose_model(t, body)
        if isinstance(model, Response):
            return model
        reserved = self.reserve(t, body)
        if isinstance(reserved, Response):
            return reserved
        max_tokens = min(int(body.get("max_tokens") or DEFAULT_MAX_TOKENS), MAX_TOKENS_CAP)
        p, c = fake_upstream(body["messages"], max_tokens)
        actual = p + c
        if actual <= reserved:                                  # 结算:多了还,少了补
            self.bucket(t.org).give_back(reserved - actual)
        else:
            self.bucket(t.org).take_anyway(actual - reserved)
        self.ledger.append((t.org, t.project, model, actual))
        return Response(200, f"预扣 {reserved},实际 {actual}", model=model)


def ask(text: str, **extra: object) -> dict:
    return {"messages": [{"role": "user", "content": text}], **extra}


if __name__ == "__main__":
    clock = Clock()
    door = FrontDoor(Snapshot(1, frozenset(), {"yunbu": 20_000, "maple": 4_000}), clock)
    q = "客户说本月账单多了一笔 300 元的席位费,请帮忙核实。" * 5          # 约 130 个字符

    def show(label: str, key: str, body: dict) -> None:
        r = door.admit(key, body)
        extra = f" 等 {r.retry_after} 秒" if r.retry_after else ""
        print(f"{label:<24}→ {r.status} {r.detail}{extra}" + (f" [{r.model}]" if r.model else ""))

    show("云簿客服,正常", "sk-yunbu-support", ask(q, model="deepseek-flash", max_tokens=300))
    show("乱猜的 key", "sk-guess", ask(q))
    show("Maple 冒充云簿", "sk-maple-support", ask(q, org="yunbu"))
    show("Maple 点名大模型", "sk-maple-support", ask(q, model="deepseek-v4-pro"))
    door.outages = {"deepseek-v4-pro", "deepseek-flash"}
    show("Maple auto,主模型挂了", "sk-maple-support", ask(q, max_tokens=300))
    door.outages = {"qwen-local"}
    show("Maple auto,本地也挂了", "sk-maple-support", ask(q, max_tokens=300))
    door.outages = set()
    show("Maple 贴一份长文档", "sk-maple-support", ask(q * 30, max_tokens=300))
    show("紧接着再来一个", "sk-maple-support", ask(q, max_tokens=2000))
    show("一份超长文档", "sk-maple-support", ask(q * 60, max_tokens=300))
    clock.now = 40.0
    show("等了 40 秒再来", "sk-maple-support", ask(q, max_tokens=2000))
    door.snap = Snapshot(2, frozenset({"maple"}), door.snap.tpm)       # 运维在控制面暂停了 Maple
    show("Maple 被暂停后", "sk-maple-support", ask(q, max_tokens=300))
    print("账本:", door.ledger)
    print("桶余额:", {k: round(b.tokens) for k, b in door.buckets.items()})
```

<div class="line-notes">

- `PART = Path(__file__).resolve().parents[1]` 这个文件在 `part10/week84/` 里,`parents[1]` 是它的上两层,也就是 `part10/`。`Path` 是 [Day 37](/blog/agent-zero/day-037-pathlib/) 学过的路径对象。
- `sys.path[:0] = [str(PART / "platform"), str(PART / "gateway")]` 把 `part10/platform/` 和 `part10/gateway/` 插到 Python 的导入路径最前面,这样才能 `import` 前几天写的 `tenants.py`、`model_policy.py`、`token_bucket.py`。`[:0] = ...` 是「在列表最前面插入」的写法。
- `from model_policy import ModelNotAllowed, check, pick_model  # noqa: E402` Day 584 的模型策略。`noqa: E402` 告诉检查工具「导入不在文件开头是故意的」。
- `from tenants import Tenant, UnknownKey, resolve  # noqa: E402` Day 583 的租户认证。
- `from token_bucket import TokenBucket  # noqa: E402` Day 586 的令牌桶。
- `MAX_TOKENS_CAP = 2048             # 调用方想要的输出上限超过它,按它算` 平台给的最大 `max_tokens`。Day 586 说过它直接决定预扣多少,不设上限就会被写成 4096 的调用方占光桶。
- `class Snapshot:` Day 585 的配置快照,`frozen=True` 只读。今天多放了一个 `tpm`:每个租户每分钟能用多少 token。
- `paused: frozenset[str]` 被暂停的租户。
- `class Response:` 返回给调用方的东西:状态码、说明,429 时还带 `retry_after`。
- `class Clock:` 假时钟。`__call__` 让这个对象可以像函数一样被调用:`clock()` 返回 `clock.now`。令牌桶要的时钟参数正好是「调用它返回当前秒数」的东西,所以这个对象可以直接传进去。
- `return len("".join(m["content"] for m in messages)) * 2 // 3          # 偏保守:中文约 1.7 字符/token,这里按 1.5` 估算输入:所有消息的字符数乘 2 除 3,也就是每 1.5 个字符一个 token。比实测的 1.7 稍微偏宽,Day 586 说过宁可偏宽。
- `return round(chars / 1.7), min(60, max_tokens)` 假上游:输入 token 数 = 字符数 ÷ 1.7,输出固定 60 个,但不超过 `max_tokens`。它故意和估算用不同的系数,这样预扣和实际才会有差。
- `buckets: dict[str, TokenBucket] = field(default_factory=dict)` 每个租户一个桶,第一次用到时才创建。`field(default_factory=dict)` 是 dataclass 里给「可变默认值」的写法,每个对象各拿一个新字典。
- `self.buckets[org] = TokenBucket(capacity=tpm, rate=tpm / 60, clock=self.clock)` 桶容量是这个租户的每分钟 token 数,每秒补 `tpm / 60`,和 Day 586 一样。时钟用我们自己的假时钟。
- `def identify(self, api_key: str, body: dict) -> Tenant | Response:` 前两道关。返回值要么是认出来的 `Tenant`,要么是一个现成的错误 `Response`。
- `return Response(401, "unknown key")` 不认识的 key,没走到后面任何一关,没有消耗任何额度。
- `if "org" in body and body["org"] != t.org:` 请求体里自称的租户只用来核对。
- `return Response(403, f"key 属于 {t.org},请求体却说自己是 {body['org']}")` 不一致回 403,这类请求正常客户端不会发,真实系统里应该记一条安全日志。
- `return Response(403, f"{t.org} 已被暂停") if t.org in self.snap.paused else None` 第三道关:只读本地快照,不问控制面。暂停是整个租户级别的。
- `want = body.get("model", "auto")` 调用方不指定模型就是 `auto`,让平台按回退链选。
- `return pick_model(t.org, self.outages)` `auto`:Day 584 的回退链,每一个都要过租户策略。`self.outages` 是现在挂掉的模型集合。
- `check(t.org, want)` 点名的模型:直接过策略检查,不允许就抛 `ModelNotAllowed`。
- `return Response(503 if want == "auto" else 403, str(e))` 两种拒绝用不同的状态码:点名了不允许的模型是 403(你没权限),`auto` 却一个都选不出来是 503(平台现在没有可用的模型)。
- `max_tokens = min(int(body.get("max_tokens") or DEFAULT_MAX_TOKENS), MAX_TOKENS_CAP)` 没填就用默认 512,填了超过 2048 就按 2048。
- `need = estimate_input(body["messages"]) + max_tokens` 预扣额 = 估的输入 + 输出上限,Day 586 的公式。
- `ok, wait = self.bucket(t.org).try_take(need)` 向桶里拿预扣额。
- `if wait == float("inf"):` 比整个桶还大,等多久都拿不到。
- `return Response(413, f"请求预扣 {need} 比整个桶还大,改小 max_tokens 或拆分")` 这种请求回 413 而不是 429,因为稍后重试没有用,调用方要改请求本身。
- `return Response(429, f"{t.org} 的 token 额度不够", retry_after=round(wait, 1))` 额度暂时不够回 429,并告诉调用方等几秒,这个数字来自令牌桶的 `(缺口 ÷ 每秒补多少)`。
- `t = self.identify(api_key, body)` `admit` 把几道关按顺序串起来。
- `if isinstance(t, Response):` 返回的是错误就直接返回,不继续往下。
- `if (r := self.not_paused(t)) is not None:` `:=` 是「赋值表达式」,一边赋值给 `r` 一边判断。相当于先 `r = self.not_paused(t)` 再 `if r is not None`,少写一行。
- `reserved = self.reserve(t, body)` 预扣放在最后一道关:前面所有检查都通过了才动桶,被拒绝的请求不占额度。练习 2 会把顺序换掉看后果。
- `p, c = fake_upstream(body["messages"], max_tokens)` 调假上游,拿到输入、输出 token 数。
- `actual = p + c` 真实用量。
- `self.bucket(t.org).give_back(reserved - actual)` 预扣多了,把差额还回去。
- `self.bucket(t.org).take_anyway(actual - reserved)` 预扣少了,补扣,余额可以变负数。
- `self.ledger.append((t.org, t.project, model, actual))` 记一行账:哪个租户、哪个项目、用了哪个模型、真实用了多少 token。
- `door = FrontDoor(Snapshot(1, frozenset(), {"yunbu": 20_000, "maple": 4_000}), clock)` 版本 1 的快照:没人被暂停,云簿每分钟 2 万 token,Maple 每分钟 4,000。
- `q = "客户说本月账单多了一笔 300 元的席位费,请帮忙核实。" * 5          # 约 130 个字符` 演示用的问题,重复 5 遍凑长度。
- `show("乱猜的 key", "sk-guess", ask(q))` 逐个演示,每一行 `show` 对应输出里的一行。
- `door.outages = {"deepseek-v4-pro", "deepseek-flash"}` 假装两个云端模型都挂了。
- `door.snap = Snapshot(2, frozenset({"maple"}), door.snap.tpm)       # 运维在控制面暂停了 Maple` 换一份新快照,版本 2,Maple 被暂停。这就是 Day 585 里「数据面拿到新快照」的那一步。

</div>

```bash
cd agent-zero-lab
uv run python part10/week84/front_door.py
```

```text
云簿客服,正常                 → 200 预扣 393,实际 142 [deepseek-flash]
乱猜的 key                 → 401 unknown key
Maple 冒充云簿              → 403 key 属于 maple,请求体却说自己是 yunbu
Maple 点名大模型             → 403 maple 不能用 deepseek-v4-pro(合同:客户数据不出本机房,只能用自部署模型)
Maple auto,主模型挂了        → 200 预扣 393,实际 142 [qwen-local]
Maple auto,本地也挂了        → 503 maple 没有可用的模型(挂掉的:['qwen-local'])
Maple 贴一份长文档            → 200 预扣 3100,实际 2531 [qwen-local]
紧接着再来一个                 → 429 maple 的 token 额度不够 等 11.5 秒
一份超长文档                  → 413 请求预扣 5900 比整个桶还大,改小 max_tokens 或拆分
等了 40 秒再来               → 200 预扣 2093,实际 142 [qwen-local]
Maple 被暂停后              → 403 maple 已被暂停
账本: [('yunbu', 'support', 'deepseek-flash', 142), ('maple', 'support', 'qwen-local', 142), ('maple', 'support', 'qwen-local', 2531), ('maple', 'support', 'qwen-local', 142)]
桶余额: {'yunbu': 19858, 'maple': 3852}
```

### 读输出

一行一行对着五道关看。

- 第 1 行:云簿客服点名 `deepseek-flash`,过了所有关。预扣 393(估算输入 93 加 `max_tokens` 300),实际 142,多预扣的 251 在结算时还回桶里。
- 第 2 行:乱猜的 key,第一道关就 401,不碰桶。
- 第 3 行:Maple 的 key,请求体写自己是云簿,第二道关 403。这就是 Day 583 的 `handle_good`。
- 第 4 行:Maple 点名大模型,第四道关 403,理由写着合同。这是 Day 584 的 `check`。
- 第 5 行:大模型都挂了,Maple 用 `auto`,回退链走到 `qwen-local`(唯一允许的)。注意模型是平台选的,不是 Maple 选的。
- 第 6 行:连 `qwen-local` 也挂了,`auto` 一个都选不出来,503。对比第 4 行的 403:同样是「拒绝」,一个是你没权限,一个是我这边暂时没有。
- 第 7 行:Maple 贴了一份长文档,预扣 3,100,实际 2,531,过。
- 第 8 行:紧接着再要 2,000 个输出,桶里只剩约 1,327,429,告诉它要等 11.5 秒。算式:预扣 2,093,缺口 766,Maple 每分钟 4,000 所以每秒补约 66.7,766 ÷ 66.7 ≈ 11.5。
- 第 9 行:一份超长文档,预扣 5,900,比整个桶(4,000)还大,413。等多久都没用。
- 第 10 行:假时钟拨到 40 秒,桶补满了,再来 2,000 个输出的请求过了。
- 第 11 行:运维换了版本 2 的快照,Maple 被暂停,403。没有问控制面。

账本只记了成功的 4 行,桶余额里云簿 19,858、Maple 3,852。被拒绝的请求一行账都没有、一个额度都没有占。

**顺序不是随便排的**:越便宜的检查越靠前,会消耗资源的操作放最后。认租户和核对请求体只是查字典,暂停开关是读本地内存,模型策略也是查表,预扣才动桶。倒过来的话,一个被策略拒绝的请求也会占掉额度,练习 2 会让你亲眼看到。

### 零件和大代码的对照

| 零件 | 在哪学的 | 今天的位置 |
| --- | --- | --- |
| `resolve`、请求体只核对 | Day 583 `tenants.py`、`handle_request.py` | `identify` |
| 本地快照加暂停开关 | Day 585 `plane_sync.py`、`kill_switch.py` | `Snapshot`、`not_paused` |
| 回退链也过租户策略 | Day 584 `model_policy.py` | `choose_model` |
| 令牌桶、预扣和结算 | Day 586 `token_bucket.py`、`estimate_settle.py` | `reserve`、`admit` 最后几行 |
| 估算偏保守 | Day 586 的实测(中文 1.7 字符/token) | `estimate_input` |
| 状态码选择(401/403/413/429/503) | Day 586 的 `Retry-After`、Day 584 的拒绝 | `Response` 的各处 |

## 本周错题与坑清单

和上周一样,按「会不会报错」分两类。平台线这四天不报错的坑特别多,大部分是数字悄悄不对,没有任何提示。

会报错的:

- **Makefile 里用空格缩进**:`/tmp/bad.mk:2: *** missing separator.  Stop.`,命令行必须以 Tab 开头(Day 582)。
- **数据卡模板里有的键没有数据来源**:`KeyError: "模板里有 2 个键没有数据来源:['dev.recall', 'test.f1']"`,这是故意的,宁可报错也不填空(Day 582)。
- **看过 test 再改配置**:`拒绝:test 在 727bdf0f 版配置下跑过了,现在的配置是 8ecfda01`,锁在拦你,换一份新的 test(Day 582)。
- **RLS 下往别家的名下写**:`new row violates row-level security policy for table "kb_chunks"`,这是 `WITH CHECK` 在起作用,不是 bug(Day 584)。
- **重复跑脚本时角色删不掉**:`psycopg.errors.DependentObjectsStillExist: role "migrator" cannot be dropped because some objects depend on it`,先 `DROP OWNED BY`(Day 584)。
- **schema-per-tenant 忘了设 `search_path`**:`relation "faq" does not exist`(Day 584)。
- **`current_setting('app.tenant_id')` 少了第二个参数**:变量没设时直接报错,让没接入租户的后台任务一起炸(Day 584)。
- **没有租户就查询**:`LookupError:当前请求没有租户,拒绝查询`,故意让它报错,不默默变成「查全部」(Day 584)。

不报错的:

- **宽松的判分函数**:「八个类别全写上」在宽松版里拿满分,对冲答案、加客套、先写推理都能钻空子(Day 581)。
- **过程违规只扣一点分**:模型会算账,违规省下的麻烦如果比扣的分值钱就违规;要罚到和结果同一个量级(Day 581)。
- **转人工不扣分**:自己办错扣 −0.5 时,把握不到三分之一模型就转人工;扣 −1.0 时临界点是 0.5(Day 581)。
- **训练集混进了评测题**:route_dev 50 张里 36 张、route_test 30 张里 17 张也在训练集里,不查不知道(Day 582)。
- **三份仓库的 `llm_client.py` 内容有三种**:超时修复三个仓库有两个、手机号脱敏只有一个(Day 583)。
- **按各团队自报的调用次数平摊账单**:客服 81%、销售 14%,按真实花费汇总是 58%、39%(Day 583)。
- **漏写 `tenant_id`**:Maple 搜「退款」搜到了云簿 VIP 客户的手机号,没有报错(Day 583)。
- **缓存 key 里没有租户**:同一问题 Maple 拿到了云簿的答案,「真正算了 1 次」(Day 584)。
- **一个租户的批处理吃光共享额度**:没有租户配额时 Maple 20 个请求成功 7 个(Day 584)。
- **RLS 开了,但用超级用户或没加 `FORCE` 的 owner 连库**:看到全部 3 行(Day 584)。
- **`WITH CHECK (true)`**:Maple 能往云簿名下写数据(Day 584)。
- **连接池里的会话级 `SET`**:请求 2 忘了设租户,变成了 Maple(Day 584)。
- **回退链只检查第一选择**:Maple 的数据悄悄去了 `deepseek-flash`(Day 584)。
- **数据面每个请求同步问控制面**:控制面挂 60 秒,60 个请求全是 500(Day 585)。
- **只靠推送不留拉取**:断线期间错过一条事件,数据面一直活在旧版本里(Day 585)。
- **共享计数先读后写**:8 个线程 160 次加一,Valkey 里只记到 36,160 个全放行(Day 585)。
- **队列重复投递**:worker 在确认前崩溃,T-301 被处理两次,不幂等就多扣一个点数(Day 585)。
- **锁过期了你还在干活**:A 释放时发现「锁早已过期」,A 和 B 已经重叠处理(Day 585)。
- **带租户过滤的向量检索**:小租户占 2%,默认设置下 20 次查询只返回 0 到 4 行,和精确结果只重合 14/200(Day 585)。
- **按请求数限流**:66 个请求一个没拦,45 万 token 全放行(Day 586)。
- **预扣后不结算**:5 个请求预扣 1,642、实际 431,桶里少了 1,211(Day 586)。
- **用字符数除以 2 估 token**:中文少估 15%、英文多估 132%(Day 586)。

这张清单本身就是复习材料:合上文章,每一条说出「是什么现象、为什么、怎么修」。说不出的回到那一天重看。

## 动手练习

1. **默写本周三段代码**:合上文章,新建 `part10/week84/recall_week84.py`,写出 `identify(api_key, body)`(租户只从 key 认,请求体里的 `org` 只核对)、`pick_model(org, outages)`(回退链每一个都过租户策略)、令牌桶的 `try_take(n)`(用到的时候才补水,比桶大返回无限久)。验证:Maple 的 key 配云簿的 `org` 要抛 `PermissionError`;Maple 在两个云端模型都挂时选 `qwen-local`,连它也挂就抛错;容量 6 万、每秒补 1,000 的桶,先拿 1,500 再拿 40,000 余额 18,500,再要 30,000 要等 11.5 秒,等到 11.5 秒就放行、余额 0,70,000 永远拿不到。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part10/week84/recall_week84.py
"""练习 1 参考答案:默写本周三段核心代码,各自独立,不 import 本周别的文件,最后用本周实跑的数字验证。
用法:uv run python part10/week84/recall_week84.py
"""
from dataclasses import dataclass
from typing import Callable

# ---- 1. Day 583:租户只从 key 认,请求体里自称是谁只用来核对 ----
KEYS = {"sk-yunbu-support": ("yunbu", "support"), "sk-maple-support": ("maple", "support")}


def identify(api_key: str, body: dict) -> tuple[str, str]:
    try:
        org, project = KEYS[api_key]
    except KeyError:
        raise LookupError("unknown key") from None
    if "org" in body and body["org"] != org:
        raise PermissionError(f"key 属于 {org},请求体却说自己是 {body['org']}")
    return org, project


# ---- 2. Day 584:回退链上的每一个模型都要过租户策略 ----
ALLOWED = {"yunbu": {"deepseek-v4-pro", "deepseek-flash", "qwen-local"}, "maple": {"qwen-local"}}
CHAIN = ["deepseek-v4-pro", "deepseek-flash", "qwen-local"]


def pick_model(org: str, outages: set[str]) -> str:
    for m in CHAIN:
        if m not in outages and m in ALLOWED[org]:
            return m
    raise RuntimeError(f"{org} 没有可用的模型")


# ---- 3. Day 586:令牌桶,用到的时候才补水 ----
@dataclass
class Bucket:
    capacity: float
    rate: float
    clock: Callable[[], float]
    tokens: float = 0.0
    updated: float = 0.0

    def __post_init__(self) -> None:
        self.tokens, self.updated = self.capacity, self.clock()

    def try_take(self, n: float) -> tuple[bool, float]:
        now = self.clock()
        self.tokens = min(self.capacity, self.tokens + (now - self.updated) * self.rate)
        self.updated = now
        if n > self.capacity:
            return False, float("inf")
        if self.tokens >= n:
            self.tokens -= n
            return True, 0.0
        return False, (n - self.tokens) / self.rate


if __name__ == "__main__":
    assert identify("sk-maple-support", {}) == ("maple", "support")
    try:
        identify("sk-maple-support", {"org": "yunbu"})
        raise SystemExit("应该被拒绝")
    except PermissionError as e:
        print("1 通过:", e)

    assert pick_model("maple", {"deepseek-v4-pro", "deepseek-flash"}) == "qwen-local"
    assert pick_model("yunbu", {"deepseek-v4-pro"}) == "deepseek-flash"
    try:
        pick_model("maple", {"qwen-local"})
        raise SystemExit("应该拒绝")
    except RuntimeError as e:
        print("2 通过:", e)

    now = [0.0]
    b = Bucket(60_000, 1_000, lambda: now[0])
    assert b.try_take(1_500) == (True, 0.0) and b.tokens == 58_500
    assert b.try_take(40_000) == (True, 0.0) and b.tokens == 18_500
    ok, wait = b.try_take(30_000)
    assert not ok and wait == 11.5
    now[0] = 11.5
    assert b.try_take(30_000) == (True, 0.0) and b.tokens == 0
    assert b.try_take(70_000) == (False, float("inf"))
    print("3 通过:余额 58500 → 18500 → 等 11.5 秒 → 0,70000 永远拿不到")
```

<div class="line-notes">

- `KEYS = {"sk-yunbu-support": ("yunbu", "support"), "sk-maple-support": ("maple", "support")}` 缩小版的租户表,key 到 (org, project)。
- `org, project = KEYS[api_key]` 租户只从 key 认,一行字典查找。
- `raise LookupError("unknown key") from None` `KeyError` 换成一个更清楚的异常,`from None` 去掉那一串「During handling of the above exception」的噪音。
- `if "org" in body and body["org"] != org:` 请求体里的 `org` 只用来核对。
- `ALLOWED = {"yunbu"` 每个租户允许的模型。
- `CHAIN = ["deepseek-v4-pro", "deepseek-flash", "qwen-local"]` 平台默认的回退顺序,从强到弱。这里只是字符串,今天没有调用任何模型。
- `if m not in outages and m in ALLOWED[org]:` 回退链上每一个候选都同时过两关:没挂、租户被允许。少了后半句,就是 Day 584 里「朴素回退」让 Maple 的数据出境的那个 bug。
- `raise RuntimeError(f"{org} 没有可用的模型")` 一个都没有就拒绝,不悄悄退到不允许的。
- `class Bucket:` 令牌桶的最小版。
- `self.tokens, self.updated = self.capacity, self.clock()` 创建时桶是满的,记下当前时间。
- `self.tokens = min(self.capacity, self.tokens + (now - self.updated) * self.rate)` 用到的时候才补水:距离上次的秒数乘以每秒补的量,封顶在容量。
- `if n > self.capacity:` 比桶还大。
- `return False, float("inf")` 永远拿不到,调用方不该重试。
- `return False, (n - self.tokens) / self.rate` 不够时,要等的秒数 = 缺口 ÷ 每秒补的量。
- `assert b.try_take(1_500) == (True, 0.0) and b.tokens == 58_500` 第一次拿完,余额 60,000 − 1,500。
- `assert not ok and wait == 11.5` 30,000 要等 11.5 秒:缺口 30,000 − 18,500 = 11,500,÷ 1,000。
- `now[0] = 11.5` 假时钟拨到 11.5 秒,下一次 `try_take` 前会补上 11,500。

</div>

```bash
uv run python part10/week84/recall_week84.py
```

```text
1 通过: key 属于 maple,请求体却说自己是 yunbu
2 通过: maple 没有可用的模型
3 通过:余额 58500 → 18500 → 等 11.5 秒 → 0,70000 永远拿不到
```

三个 `assert` 都过了才会打印这三行。如果你默写时卡住了,最容易卡的是第三段的「补水」那一行:忘了 `min(capacity, ...)` 封顶,桶会越补越大;忘了先补水再判断,等多久都不会有额度。

</details>

2. **把顺序换掉**:把 `FrontDoor.admit` 里的「预扣」挪到「模型策略」前面,让 Maple 用 `deepseek-v4-pro`(她没权限)连发 10 个请求,每个 `max_tokens=500`。再发一个合法的 `qwen-local` 请求。对比正确顺序和错误顺序下:桶里还剩多少、合法请求能不能过。

<details><summary>参考答案</summary>

新建 `part10/week84/bad_order.py`,继承 `FrontDoor`,只重写 `admit`:

```python
# agent-zero-lab/part10/week84/bad_order.py
"""练习 2 参考答案:把「预扣」放到「模型策略」前面,被拒绝的请求也会吃掉额度。
用法:uv run python part10/week84/bad_order.py
"""
from front_door import Clock, FrontDoor, Response, Snapshot, ask


class BadOrderDoor(FrontDoor):
    def admit(self, api_key: str, body: dict) -> Response:
        t = self.identify(api_key, body)
        if isinstance(t, Response):
            return t
        reserved = self.reserve(t, body)                 # 错:先预扣
        if isinstance(reserved, Response):
            return reserved
        model = self.choose_model(t, body)               # 后做策略检查,被拒绝时没有把预扣还回去
        if isinstance(model, Response):
            return model
        return Response(200, "ok", model=model)


def run(door_cls: type[FrontDoor]) -> None:
    door = door_cls(Snapshot(1, frozenset(), {"yunbu": 20_000, "maple": 4_000}), Clock())
    codes = [door.admit("sk-maple-support", ask("客户账单问题" * 10, model="deepseek-v4-pro", max_tokens=500)).status
             for _ in range(10)]
    balance = door.bucket("maple").tokens
    good = door.admit("sk-maple-support", ask("客户账单问题" * 10, model="qwen-local", max_tokens=500))
    print(f"{door_cls.__name__:<14} 10 个被策略拒绝的请求,状态码 {sorted(set(codes))};桶里还剩 {balance:.0f};随后一个合法请求 → {good.status}")


if __name__ == "__main__":
    run(FrontDoor)
    run(BadOrderDoor)
```

<div class="line-notes">

- `from front_door import Clock, FrontDoor, Response, Snapshot, ask` 直接用 `front_door.py` 里的东西。从 `agent-zero-lab` 根目录用 `uv run python part10/week84/bad_order.py` 跑,脚本所在目录会自动加进导入路径,所以能找到同目录的 `front_door.py`。
- `class BadOrderDoor(FrontDoor):` 继承,只改一个方法。`FrontDoor` 把每道关拆成了 `identify`、`reserve`、`choose_model` 几个方法,所以换顺序只要在 `admit` 里换调用的先后。
- `reserved = self.reserve(t, body)                 # 错:先预扣` 先动桶。
- `model = self.choose_model(t, body)               # 后做策略检查,被拒绝时没有把预扣还回去` 策略拒绝时已经预扣了,而且没有任何地方把它还回去。
- `def run(door_cls: type[FrontDoor]) -> None:` 参数是一个类,不是对象,`type[FrontDoor]` 是它的类型写法。同一份流量分别对两个类各跑一遍。
- `codes = [door.admit(` Maple 点名大模型连发 10 次,收集状态码。
- `balance = door.bucket("maple").tokens` 发完 10 个以后,先看桶里还剩多少,再发合法请求。
- `print(f"{door_cls.__name__:<14}` 状态码去重排序打印。

</div>

```bash
uv run python part10/week84/bad_order.py
```

```text
FrontDoor      10 个被策略拒绝的请求,状态码 [403];桶里还剩 4000;随后一个合法请求 → 200
BadOrderDoor   10 个被策略拒绝的请求,状态码 [403, 429];桶里还剩 220;随后一个合法请求 → 429
```

正确的顺序下,10 个被策略拒绝的请求一个额度都没占,桶里还是满的 4,000,随后的合法请求照常通过。错误的顺序下,每个被拒绝的请求都先预扣了约 500,前 7 个状态码是 403,后面桶空了,变成了 429,桶里只剩 220,随后那个合法的请求也被 429 挡住了。

这个现象有两层。第一层是**没权限的请求能把有权限的请求饿死**:一个没有权限的租户(或者一个攻击者拿着租户的 key 乱试)只要不停发被拒绝的请求,就能把这个租户的额度耗光。第二层更隐蔽:监控里看到的是一堆 429,会让你以为是额度配小了,而真正的原因是策略检查的位置。把检查放在动资源的操作之前,是网关里最便宜的一条防线。

</details>

3. **写测试**:为 `front_door.py` 写 6 个 pytest 测试,每个对应一道关:乱猜的 key 是 401;请求体冒充别的租户是 403;换成暂停快照后同一个租户被挡住;回退链永远不出租户的策略集合,一个都没有是 503;额度不够是 429 且带 `retry_after`,拨动时钟后恢复;结算会把没用的预扣还回去。

<details><summary>参考答案</summary>

新建 `tests/test_front_door.py`:

```python
# agent-zero-lab/tests/test_front_door.py
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "part10" / "week84"))

from front_door import Clock, FrontDoor, Snapshot, ask  # noqa: E402


def make() -> tuple[FrontDoor, Clock]:
    clock = Clock()
    return FrontDoor(Snapshot(1, frozenset(), {"yunbu": 20_000, "maple": 4_000}), clock), clock


def test_unknown_key_is_401():
    door, _ = make()
    assert door.admit("sk-guess", ask("hi")).status == 401


def test_body_cannot_claim_other_tenant():
    door, _ = make()
    assert door.admit("sk-maple-support", ask("hi", org="yunbu")).status == 403


def test_paused_tenant_is_blocked_after_new_snapshot():
    door, _ = make()
    assert door.admit("sk-maple-support", ask("hi")).status == 200
    door.snap = Snapshot(2, frozenset({"maple"}), door.snap.tpm)
    assert door.admit("sk-maple-support", ask("hi")).status == 403


def test_fallback_stays_inside_policy():
    door, _ = make()
    door.outages = {"deepseek-v4-pro", "deepseek-flash"}
    assert door.admit("sk-maple-support", ask("hi")).model == "qwen-local"
    door.outages = {"qwen-local"}
    assert door.admit("sk-maple-support", ask("hi")).status == 503


def test_over_budget_gets_429_with_retry_after_then_recovers():
    door, clock = make()
    assert door.admit("sk-maple-support", ask("账单" * 2000, max_tokens=300)).status == 200
    r = door.admit("sk-maple-support", ask("hi", max_tokens=2000))
    assert r.status == 429 and r.retry_after is not None and r.retry_after > 0
    clock.now += r.retry_after + 1
    assert door.admit("sk-maple-support", ask("hi", max_tokens=2000)).status == 200


def test_settle_returns_unused_reservation():
    door, _ = make()
    door.admit("sk-yunbu-support", ask("hi", max_tokens=1000))
    used = door.ledger[0][3]
    assert round(door.bucket("yunbu").tokens) == 20_000 - used
```

<div class="line-notes">

- `sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "part10" / "week84"))` 测试文件在 `tests/` 里,往上一层是 `agent-zero-lab/`,再进到 `part10/week84/`,把它放进导入路径,才找得到 `front_door`。
- `def make() -> tuple[FrontDoor, Clock]:` 每个测试都新建一个干净的前门,互不影响。返回前门和它的假时钟,测试里可以拨动时钟。
- `assert door.admit("sk-guess", ask("hi")).status == 401` 乱猜的 key。
- `assert door.admit("sk-maple-support", ask("hi", org="yunbu")).status == 403` 冒充。
- `door.snap = Snapshot(2, frozenset({"maple"}), door.snap.tpm)` 换上暂停 Maple 的新快照,同一个前门对象,同一个 key,结果从 200 变成 403。
- `door.outages = {"deepseek-v4-pro", "deepseek-flash"}` 两个云端都挂,`assert ... .model == "qwen-local"` 回退不出 Maple 的策略集合。
- `assert door.admit("sk-maple-support", ask("账单" * 2000, max_tokens=300)).status == 200` 一份约 4,000 字符的长文档,先吃掉大部分额度。
- `assert r.status == 429 and r.retry_after is not None and r.retry_after > 0` 额度不够返回 429,并且 `retry_after` 有值。`is not None` 是给类型检查器看的。
- `clock.now += r.retry_after + 1` 拨动假时钟,多等 1 秒保证补够。
- `assert round(door.bucket("yunbu").tokens) == 20_000 - used` 结算以后桶里的余额应该正好等于容量减去实际用量。预扣的 1,000+ 个额度没有白占。

</div>

```bash
uv run pytest -q tests/test_front_door.py
```

```text
......                                                                   [100%]
6 passed in 0.04s
```

6 个都过。注意这些测试里没有一个调了接口、连了数据库,所以它们能在每次提交时跑。这也是前门设计成「上游是个可以替换的函数、时钟是个可以注入的对象」的原因。

</details>

4. **排查顺序(开放题)**:Maple 的客户反馈,AI 助手的回答里出现了云簿的 VIP 客户张三的手机号。你按什么顺序排查?列出至少六个可能的原因,每个写一句怎么验证,并说清哪个最该先查。

<details><summary>参考答案</summary>

没有唯一答案,我的顺序是先查便宜且最常见的,再查要动数据库的:

| 顺序 | 可能原因 | 怎么验证 |
| --- | --- | --- |
| 1 | 缓存 key 里没有租户(Day 584) | 复现:Maple 和云簿问同一个问题,看是不是「真正算了 1 次」;查缓存 key 的拼接代码 |
| 2 | 某条查询漏了 `tenant_id`(Day 583) | 用 `find_unscoped.py` 一类的粗筛扫代码里查业务表却没出现 `tenant_id` 的 SQL |
| 3 | 请求的租户身份被请求体决定(Day 583) | 搜 `body["org"]` 之类的用法,看租户是不是从 key 认的 |
| 4 | RLS 没开,或者应用用超级用户 / 没加 `FORCE` 的 owner 连库(Day 584) | 跑体检脚本,查所有含 `tenant_id` 的表 `relrowsecurity`、`relforcerowsecurity`;查连接串用的角色 |
| 5 | 连接池里会话级 `SET` 残留(Day 584) | 搜 `SET app.tenant_id`,改成事务内 `set_config(..., true)`;复现:同一条连接连续服务两个租户 |
| 6 | 向量库没按租户过滤,或者 collection 是共用的(Day 585) | 用 Maple 的身份检索「张三」,看返回的 chunk 属于谁;查检索那一层有没有租户条件 |
| 7 | 回退到了别的模型或别的部署(Day 584) | 查那次请求实际走的模型和部署,看是不是回退链越界 |
| 8 | trace、评测集、日志里已经有原文,被另一个入口读出来(Day 584) | 查这些存储的访问权限和租户前缀(Day 585 的对象存储 key 前缀) |

最先查 1 和 2:最便宜、最常见、能在几分钟内复现或排除。4 和 5 要动数据库,放在后面,但它们是「为什么上一道防线没拦住」的答案,所以一定要查,不能只修眼前的漏洞。查完以后不要只修那一处:把这条路径写成一个测试(给 Maple 和云簿各跑一遍,断言互相看不到对方的数据),接进 CI。

</details>

**验收标准**:`front_door.py` 的输出和文章里的 11 行一致;`recall_week84.py` 三段默写,每段都能跑出文章里的数字,并且 `assert` 全过;`bad_order.py` 里正确顺序的桶是 4,000、错误顺序是 220;6 个 pytest 测试全过。能不看文章讲清楚「为什么预扣放在最后一道关」。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 前门(front door) | 平台数据面最前面那一层,请求进来要依次过的几道关。本课的 `front_door.py` 是 Day 588 网关的雏形 |
| 关(gate) | 对一个请求做的一次检查,通过才进下一关。便宜的检查靠前,消耗资源的操作靠后 |
| 状态码选择 | 401 没认出你是谁,403 认出你但不允许,413 请求本身太大,429 额度暂时不够,503 平台暂时没有可用的资源 |
| 赋值表达式 `:=` | Python 3.8 起的写法,一边赋值一边当表达式用,如 `if (r := f()) is not None` |
| 假上游 | 用一个返回确定数字的函数代替真实的模型调用,让测试不花钱、结果可重复 |
| 注入时钟 | 把「现在几点」做成参数传进去,测试时换成假的,就不用真的等 |
| 饿死(starvation) | 一类请求占光了共享资源,别的请求一直拿不到。没权限的请求如果也消耗额度,就会把有权限的请求饿死 |
| 本周模型线 | 581 的奖励设计和 582 的流水线、数据卡、模型卡,见上面的一句话回顾和错题清单 |
| 本周平台线 | 583 到 586,租户、隔离、控制面数据面、模型网关 |

## 常见误区

**以为复习就是把六天再读一遍。** 合上文章,把错题清单里的每一条说出「现象、原因、怎么修」,说不出的才回去看。再读一遍只是熟悉,说出来才是会。

**检查的顺序随便排。** 便宜的靠前,会消耗资源的靠后。我们的实测:把预扣放在策略检查前面,10 个被拒绝的请求把桶吃到只剩 220,后面合法的请求也被 429 挡住,而且监控上看到的全是 429,会误导你去调大额度。

**拒绝的状态码都用 403,或者都用 429。** 401、403、413、429、503 是五种不同的情形,调用方的处理完全不同:429 要退避重试,413 要改请求,503 要等平台恢复,403 重试没有意义。网关该告诉调用方真话。

**测试里调真接口。** 假上游加注入时钟,每个测试几毫秒跑完,不花钱,每次提交都能跑。6 个测试 0.04 秒。

**看到分数涨了就收工。** 这周两次碰到:581 的 reward 涨可能是钻空子,582 的 test 分数看过再改配置就不算数了。分数是对着某个口径算的,口径本身要先审。

**只修眼前的那个漏洞。** 开放题的答案里,每一条原因对应的都是前几天讲过的一道防线。出了事故,先问「是哪一道防线没拦住」,再决定补哪里、加什么测试,不要只改那一行代码。

## 学习资料

### 文档与文章

- [Martin Fowler · What I talk about when I talk about platforms](https://martinfowler.com/articles/talk-about-platforms.html):回顾这周平台线时读,平台是「自助服务的 API、工具和知识」,不是一个必须迁移过去的东西。约 15 分钟。
- [AWS · SaaS Tenant Isolation Strategies](https://docs.aws.amazon.com/whitepapers/latest/saas-tenant-isolation-strategies/saas-tenant-isolation-strategies.html):Day 584 引用过,复习时把 silo、pool、bridge 再对一遍。
- [PostgreSQL 17 文档 · Row Security Policies](https://www.postgresql.org/docs/17/ddl-rowsecurity.html):RLS 的一手来源,默写 `USING` 和 `WITH CHECK` 的区别前读一遍。
- [Anthropic · Rate limits](https://platform.claude.com/docs/en/api/rate-limits) 和 [DeepSeek · 限速](https://api-docs.deepseek.com/quick_start/rate_limit):同一件事两种做法,一个按 RPM、ITPM、OTPM,一个按并发。
- [pgvector README](https://github.com/pgvector/pgvector):Day 585 复现的那个过滤坑的出处。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1Ve4y1g7Bk&autoplay=0&high_quality=1" title="【IT老齐249】SAAS多租户系统数据如何隔离?三种方案综合对比" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>IT老齐 · 【IT老齐249】SAAS多租户系统数据如何隔离?三种方案综合对比 · 12 分钟。回顾 Day 584 的 silo、bridge、pool,合上文章先自己说一遍三种的取舍再看。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1T99DBoE9j&autoplay=0&high_quality=1" title="大模型API网关,Token限流与计费怎么设计?" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>图灵程序员诸葛 · 大模型API网关,Token限流与计费怎么设计? · 约 3 分钟。回顾 Day 586,看它有没有提到预扣和结算。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/WN8mmHU2HOU" title="Panel: Control Plane vs Data Plane: Untangling the Tenets of Multitenancy" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>CNCF · Panel: Control Plane vs Data Plane: Untangling the Tenets of Multitenancy · 英文座谈,把 Day 584、585 两天串起来听。</figcaption>
</figure>

### 书籍

- Martin Kleppmann《Designing Data-Intensive Applications》(O'Reilly, 2017):这周的几个坑(竞态、至少一次投递、锁)在第 7、8、11 章都能找到更系统的说法,复习时挑一章读。

### 开源项目与代码

- [BerriAI/litellm](https://github.com/BerriAI/litellm):今天的 `front_door.py` 缺的东西(预算、降级、花费日志、管理界面)都在里面,下周 Day 588 补上其中几样之前,可以先翻翻它的 `proxy/` 目录。
- [valkey-io/valkey](https://github.com/valkey-io/valkey):Day 585 用的共享计数和队列。

## 自测

1. 说出本周两条贯穿的线索,各举一个这周的例子。

<details><summary>答案</summary>

一、分数和事实不是一回事:581 里宽松的判分器给「八个类别全写上」也满分;582 里 test 看过再改配置就不是没见过的题;585 里带租户过滤的向量检索没有报错只是少返回行;586 里估算偏差让桶悄悄少一截。二、少一道检查多一类事故:583 少了「租户从 key 认」,Maple 的 key 换来云簿的身份;584 少了 `FORCE`,owner 看到全部数据;585 少了幂等,多扣点数;586 少了结算,桶被白占。

</details>

2. 前门的五道关为什么是这个顺序?把预扣放到策略检查前面会怎样?

<details><summary>答案</summary>

越便宜的检查越靠前,会消耗资源的操作放最后:认租户、核对请求体、看暂停开关、查模型策略都只是查字典或读本地内存,预扣才动桶。倒过来的话,被策略拒绝的请求也占了额度又没有还回去,实测 10 个被拒绝的请求把桶吃到只剩 220,随后合法的请求也被 429 挡住。没权限的请求把有权限的请求饿死,监控上还只看到 429,会误导人去调大额度。

</details>

3. 401、403、413、429、503 各表示什么,调用方该怎么处理?

<details><summary>答案</summary>

401:没认出你是谁(key 不认识),换 key,重试没用。403:认出你了但不允许(冒充别的租户、被暂停、点名了没权限的模型),重试没用。413:请求本身比整个桶还大,要改请求(缩小 `max_tokens` 或拆分),等也没用。429:额度暂时不够,按 `retry_after` 等一会再来。503:平台暂时没有可用的资源(回退链一个都选不出来),稍后再试,这是平台的问题不是调用方的。

</details>

4. 租户为什么只能从 key 认?如果请求体里写的租户和 key 认出来的不一致怎么办?

<details><summary>答案</summary>

请求体是客户端能随便写的,谁想冒充谁都行,拿到 Maple 合法 key 的人在请求体里写云簿,就能让后面所有带 `tenant_id` 的查询都查云簿的数据,前面的隔离做得再好也白搭。所以租户只从 key 认,请求体里的 `org` 只用来核对。不一致直接拒绝(403),而且值得记一条安全日志,因为正常客户端不会这么发。

</details>

5. (面试题)让你设计一个多租户的 Agent 平台前门,请求进来时依次做哪些检查,每一道防什么事故?哪些不能让数据面同步问控制面?

<details><summary>答案</summary>

按顺序:一、认租户(虚拟 key 到租户),防冒充和乱猜;二、核对请求体里的租户,防拿着自己的 key 冒充别人;三、读本地快照看租户是否被暂停、配额多少,防控制面一抖全站抖、也是紧急开关的落点;四、模型策略,回退链上每个候选都过租户策略,防数据悄悄出境;五、按 token 预扣,防一个租户吃光共享额度,请求结束后按真实用量结算。数据库层另有行级安全兜底,缓存 key、向量库、对象存储 key 都要带租户。三、四里要用到的配置(暂停、配额、模型策略)都来自控制面下发的版本化快照,数据面本地缓存,请求路径上不同步问控制面;紧急开关另走推送通道,并带版本号,对不上就整份重拉。

</details>

6. 令牌桶的 `try_take` 在什么情况下返回「无限久」?调用方拿到它该怎么办?

<details><summary>答案</summary>

请求要的额度比整个桶的容量还大。桶最多只能装 `capacity`,等多久都攒不够。调用方不该重试,要改请求本身:缩小 `max_tokens`、拆分输入。前门里这种情况返回 413 而不是 429,就是为了把「等一等就好」和「等也没用」分开。

</details>

## 明天预告

Day 588 · 模型网关(二):预算配额、路由降级、成本归因,写一个最小网关。今天的前门有五道关,但上游是假的,没有预算,没有熔断,账本只是一个列表。明天把它接成真的:预算用完拒绝还是降级到便宜的模型,什么错误该换供应商、什么不该换,熔断器什么时候打开,流式请求的降级为什么只能在第一个 token 之前,账怎么记才能和供应商的月账单对上;最后把它写成一个带测试的最小网关,测试里用的假上游,就是今天这个思路。
