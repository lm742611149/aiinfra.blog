---
title: 'Day 332 · 多 Agent(四):subagent 是为了省上下文,什么时候不该用多 Agent'
description: '前三天的多 Agent 都是按领域分工,subagent 的出发点不一样:主 Agent 把一大堆只用一次的中间过程关进一个临时的子 Agent,只拿回结论。用 2925 行的审计日志实跑对比两种做法,看上下文从 1.9 万压到 1.7 千,也看钱和时间没占到的便宜、结论被压缩时丢掉的细节、fork 型子 Agent 和子 Agent 套子 Agent 的账,最后收成一张什么时候不该用多 Agent 的清单。'
pubDate: 2026-10-23
regime: none
tags: ['multi-agent', 'subagent', 'context', 'agent-zero']
series: 'agent-zero'
day: 332
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 330](/blog/agent-zero/day-330-multi-agent-2/) 搭了主管派活:主管把账务专员和技术支持包装成两个工具,专员只看得到主管写的一句任务。[Day 331](/blog/agent-zero/day-331-multi-agent-3/) 换成专员交接:没有主管,账务和技术轮流接电话,接手的人看得到完整历史,顺手撞了漏回 ToolMessage 的 400 和踢皮球,还用一句话认识了 router、skills、custom workflow 和 A2A。

这两天的拆法有个共同点:**按领域分工**。账务一个、技术一个,各有各的提示词和工具,长期存在,可能由不同的人维护。今天讲另一种拆法,出发点完全不同。它不关心领域,只关心一件事:主 Agent 干到一半,要读一大堆东西,读完只需要结论,那一大堆就别留在我的上下文里了。

## 今天要解决的问题

学完今天,你要能做到:

1. 说清 subagent 和前两天的「分工式」多 Agent 差在哪:什么时候该开、开了以后谁看到什么、主 Agent 的上下文里到底多了什么。
2. 亲手跑一场同样的四轮客服对话,一次让主 Agent 自己读 2925 行日志,一次开子 Agent 去读,拿到真实的上下文大小、花费和用时,并说得出「省下的是什么,没省下的是什么」。
3. 复现并修好 subagent 最常见的坑:子 Agent 交回的结论是有损压缩,后面追问细节时主 Agent 答不出来。
4. 说出 fork 型子 Agent 和普通子 Agent 的取舍,以及「子 Agent 再开子 Agent」为什么要设深度和并发上限。
5. 写出一张「什么时候不该用多 Agent」的清单,并能用今天的数据给它撑腰。

预计用时 2.5–3 小时:概念和日志 20 分钟,对比实验 1 小时,三个坑 40 分钟,练习 1 小时。前置:[Day 330](/blog/agent-zero/day-330-multi-agent-2/) 的 `part05/multi/mini_agent.py`(`MiniAgent`、`Usage`、`client()`),昨天和前天的拓扑对比,[Day 284](/blog/agent-zero/day-284-mcp-resource-prompt/) 的 `cloudledger/server.py`(今天 import 它的 `find_customer`、`get_subscription` 和 `REFUND_POLICY`),[Day 182](/blog/agent-zero/day-182-tool-design-2/) 的工具描述怎么写,以及 [Day 329](/blog/agent-zero/day-329-multi-agent-1/) 里「能不能拆看有没有依赖」那条判断。今天调模型的实跑,你把文章里的脚本各跑一遍合计约 0.4 元(inline 0.0455 + sub 0.0521 + 坑一约 0.03 + 对比表 0.14 + 练习 2、3 各约 0.05 + fork 0.002);我为了让实验稳定重复跑了很多遍,全部加起来约 1.3 元。

学法提示:先对照文章逐行敲一遍(不复制粘贴)并跑通;第二天合上文章,把 `subagent_demo.py` 里的 `build_main()` 默写出来;做练习时先自己写,做不出再展开参考答案,看完关掉自己重写一遍。

## 两种拆法:拆人,和拆上下文

先把两种出发点放在一起。

**分工**(前两天):账务专员和技术支持是两个长期存在的角色。它们的提示词、工具、评测集各管各的,换一个客户问题它们还是它们。拆的是「谁来做」。

**subagent**(今天):主 Agent 手里有一个大块的、只读的、中间过程很长的活,比如把三个月的审计日志翻一遍找原因、在仓库里搜 40 个文件看某个函数被谁调用、读完一堆网页。它临时开一个子 Agent,给一句任务描述,子 Agent 自己去读、去试,读完交回一小段结论,然后这个子 Agent 连同它读过的几万 token 一起被丢掉。主 Agent 的上下文里只多了一次工具调用和几百字结论。拆的是「这一大坨中间过程放在哪」。

[Claude Code 的文档](https://code.claude.com/docs/en/sub-agents)是这么说的:子 Agent 适合「一个旁支任务会让你的主对话塞满搜索结果、日志或文件内容,而你之后不会再引用它们」的时候,"the subagent does that work in its own context and returns only the summary"。每个子 Agent 有自己的上下文窗口、系统提示词和工具权限。[LangChain 的 subagents 文档](https://docs.langchain.com/oss/python/langchain/multi-agent/subagents)说得更简短:每次调用都在干净的上下文里工作,避免主对话里的上下文膨胀。

判断你手上的是哪一种,问两个问题就够了。这个子 Agent 是不是临时的,用完就扔?它交回来的是不是一段压缩过的结论?两个都是,那它就是 subagent,解决的是 [Day 329](/blog/agent-zero/day-329-multi-agent-1/) 里算过的「上下文预算」问题,和团队怎么分工没有关系。你甚至可以让子 Agent 用和主 Agent 一模一样的提示词和工具,收益照样成立。

<figure>
<svg viewBox="0 0 640 270" role="img" aria-label="左边是分工式多 Agent:两个长期存在的专员各有自己的工具;右边是 subagent:主 Agent 临时开一个子 Agent 去读大量日志,只把结论带回,子 Agent 用完丢弃">
  <rect x="0" y="0" width="640" height="270" fill="var(--paper-raised)"/>
  <text x="150" y="24" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">分工:拆「谁来做」</text>
  <text x="490" y="24" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">subagent:拆「中间过程放哪」</text>
  <line x1="320" y1="36" x2="320" y2="250" stroke="var(--rule)" stroke-dasharray="3 3"/>
  <rect x="85" y="44" width="130" height="40" rx="5" fill="var(--mem-wash)" stroke="var(--mem)"/>
  <text x="150" y="69" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">主管 / 当前在线</text>
  <rect x="20" y="130" width="120" height="60" rx="5" fill="none" stroke="var(--ink-soft)"/>
  <text x="80" y="156" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">账务专员</text>
  <text x="80" y="176" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">长期存在</text>
  <rect x="160" y="130" width="120" height="60" rx="5" fill="none" stroke="var(--ink-soft)"/>
  <text x="220" y="156" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">技术支持</text>
  <text x="220" y="176" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">长期存在</text>
  <g stroke="var(--mem)" fill="none"><line x1="120" y1="84" x2="90" y2="130"/><line x1="180" y1="84" x2="210" y2="130"/></g>
  <text x="150" y="226" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">各有提示词、工具、评测集</text>
  <text x="150" y="244" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">按领域切,换问题还是它们</text>
  <rect x="360" y="44" width="260" height="40" rx="5" fill="var(--mem-wash)" stroke="var(--mem)"/>
  <text x="490" y="69" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">主 Agent:上下文始终很小</text>
  <rect x="360" y="130" width="170" height="60" rx="5" fill="none" stroke="var(--ink-soft)" stroke-dasharray="4 3"/>
  <text x="445" y="152" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">子 Agent(临时)</text>
  <rect x="372" y="162" width="146" height="20" rx="3" fill="var(--compute-wash)" stroke="var(--compute)"/>
  <text x="445" y="176" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">读 586 行日志 ≈ 1.7 万 token</text>
  <line x1="445" y1="84" x2="445" y2="130" stroke="var(--mem)"/>
  <text x="452" y="108" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">任务一句话</text>
  <rect x="550" y="136" width="70" height="48" rx="5" fill="var(--mem-wash)" stroke="var(--mem)"/>
  <text x="585" y="156" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">结论</text>
  <text x="585" y="172" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">几百字</text>
  <path d="M530 160 L550 160" stroke="var(--mem)" fill="none"/>
  <path d="M585 136 L585 84" stroke="var(--mem)" fill="none"/>
  <text x="490" y="226" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">子 Agent 和它读过的东西一起丢掉</text>
  <text x="490" y="244" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">收益只取决于「大块只读中间过程」</text>
</svg>
<figcaption>两种拆法的目的不同。分工靠角色长期存在,subagent 靠「用完就扔」。Day 329 里 Cognition 反对的是把有依赖的决策拆开,而 subagent 交出去的通常是只读的「去查一下」,两边的观点在这里不冲突。</figcaption>
</figure>

一句话记:**多 Agent 是拆人,subagent 是拆上下文。**

## 准备

今天接着前两天的 `part05/multi/`。`mini_agent.py` 是 [Day 330](/blog/agent-zero/day-330-multi-agent-2/) 建的,`cloudledger/server.py` 是 Day 284 建的,不用改它们。没装依赖的话,在练习仓库根目录跑一遍(今天没有新依赖):

```bash
cd ~/agent-zero-lab
uv add openai python-dotenv "mcp[cli]==2.3.0"
uv run python cloudledger/seed.py
cd part05/multi
```

```text
已生成 cloudledger.db: {'customers': 30, 'subscriptions': 30, 'invoices': 123, 'tickets': 41}
```

版本是 2026 年 10 月 23 日查到的:`openai` 3.37.0、`python-dotenv` 1.2.4、`mcp` 2.3.0。`.env` 和前两天一样:`LLM_BASE_URL=https://api.deepseek.com`、`LLM_MODEL=deepseek-flash`、`LLM_EXTRA_BODY={"thinking": {"type": "disabled"}}`、`LLM_PRICE=0.04,2,8`(缓存命中、未命中、输出三档,元每百万 token,来自 [DeepSeek 定价页](https://api-docs.deepseek.com/zh-cn/quick_start/pricing)高峰价)。

今天用的客户还是 C007 刘静(半岛咖啡),10 月 8 日两张 2392.00 元的发票 INV-2026-0123 和 INV-2026-0026。前两天只知道「重复扣款了」,今天要回答的是**为什么**,答案藏在一份很长的日志里。

## 第 1 步:造一份够长的审计日志

要演示「读大块中间过程」,得先有一块够大的。`seed.py` 里没有日志表,所以今天现造一个:7 月 1 日到 10 月 22 日,每天二三十行系统事件(登录、API 批量调用、导出任务、webhook),只有十几行是和扣款有关的,而且只有 10 月 8 日那天不正常。这些日志是我编的,云簿本来就是虚构公司,但结构贴近真实的支付系统:发请求、等回调、超时、重试、迟到的回调。

先不调模型,把工具本身看清楚。

```python
# agent-zero-lab/part05/multi/audit_log.py
"""给 Day 332 造的「审计日志」工具:一个客户几个月的系统事件,近三千行,真正有用的只有十几行。
seed.py 里没有这张表,日志是今天用固定随机种子现造的,每次运行一模一样。"""
import random
from datetime import date, timedelta

NOISE = [
    ("auth", "login.success", "user=刘静 ip=10.2.{a}.{b}"),
    ("auth", "token.refreshed", "client=web session=s{n}"),
    ("api", "call.batch", "endpoint=/v1/ledger count={n} status=200"),
    ("api", "call.batch", "endpoint=/v1/reports count={n} status=200"),
    ("export", "job.finished", "report=monthly rows={n} seconds={a}"),
    ("seat", "usage.snapshot", "seats=8/8 active={a}"),
    ("webhook", "delivered", "target=erp-sync status=200 ms={n}"),
]

# 真正有用的事件,按日期放。只有 10 月 8 日那一天不正常。
BILLING = {
    "2026-07-09": [
        ("09:00:01", "billing", "invoice.created", "INV-2026-0029 amount=2392.00"),
        ("09:00:03", "payment", "charge.requested", "INV-2026-0029 gateway=pay-a"),
        ("09:00:05", "payment", "charge.failed", "INV-2026-0029 reason=card_declined"),
    ],
    "2026-07-11": [
        ("09:00:02", "payment", "charge.requested", "INV-2026-0029 gateway=pay-a retry=1"),
        ("09:00:04", "payment", "charge.succeeded", "INV-2026-0029 amount=2392.00"),
    ],
    "2026-08-08": [
        ("09:00:01", "billing", "invoice.created", "INV-2026-0028 amount=2392.00"),
        ("09:00:03", "payment", "charge.requested", "INV-2026-0028 gateway=pay-a"),
        ("09:00:05", "payment", "charge.succeeded", "INV-2026-0028 amount=2392.00"),
    ],
    "2026-09-07": [
        ("09:00:01", "billing", "invoice.created", "INV-2026-0027 amount=2392.00"),
        ("09:00:03", "payment", "charge.requested", "INV-2026-0027 gateway=pay-a"),
        ("09:00:05", "payment", "charge.succeeded", "INV-2026-0027 amount=2392.00"),
    ],
    "2026-10-08": [
        ("09:00:01", "billing", "invoice.created", "INV-2026-0026 amount=2392.00"),
        ("09:00:03", "payment", "charge.requested", "INV-2026-0026 gateway=pay-a"),
        ("09:00:33", "payment", "gateway.timeout", "INV-2026-0026 gateway=pay-a waited=30s"),
        ("09:00:34", "billing", "job.retry_unpaid", "INV-2026-0026 状态未确认,按未支付处理,新建发票 INV-2026-0123"),
        ("09:00:34", "billing", "invoice.created", "INV-2026-0123 amount=2392.00 source=retry_unpaid"),
        ("09:00:36", "payment", "charge.succeeded", "INV-2026-0123 amount=2392.00 gateway=pay-a"),
        ("09:00:41", "payment", "callback.received", "INV-2026-0026 gateway=pay-a status=succeeded late=true"),
        ("09:00:41", "payment", "charge.succeeded", "INV-2026-0026 amount=2392.00 via=late_callback"),
    ],
}

FIRST_DAY = date(2026, 7, 1)
LAST_DAY = date(2026, 10, 22)


def build_log(per_day: tuple[int, int] = (20, 30)) -> list[str]:
    """造出 7 月 1 日到 10 月 22 日的全部日志行,按时间排好。per_day 是每天噪音行数的范围。"""
    rng = random.Random(332)  # 固定种子:每次运行结果一样
    rows: list[tuple[str, str]] = []
    day = FIRST_DAY
    while day <= LAST_DAY:
        d = day.isoformat()
        for _ in range(rng.randint(*per_day)):
            tm = f"{rng.randint(0, 23):02d}:{rng.randint(0, 59):02d}:{rng.randint(0, 59):02d}"
            area, event, tpl = rng.choice(NOISE)
            detail = tpl.format(a=rng.randint(1, 250), b=rng.randint(1, 250), n=rng.randint(10, 900))
            rows.append((f"{d} {tm}", f"{area} | {event} | {detail}"))
        for tm, area, event, detail in BILLING.get(d, []):
            rows.append((f"{d} {tm}", f"{area} | {event} | {detail}"))
        day += timedelta(days=1)
    rows.sort(key=lambda r: r[0])  # 稳定排序:同一秒的行保持写入顺序
    return [f"{ts} | {rest}" for ts, rest in rows]


LOG = build_log()


def read_audit_log(customer_id: str, start: str, end: str) -> str:
    """读取客户在 [start, end] 日期范围内的系统审计日志,每行一个事件,格式「时间 | 模块 | 事件 | 详情」。
    日期格式 YYYY-MM-DD,范围越大返回越多。目前只有 C007 有日志。"""
    if customer_id != "C007":
        return f"客户 {customer_id} 没有审计日志"
    lines = [ln for ln in LOG if start <= ln[:10] <= end]
    return "\n".join(lines) or f"{start} 到 {end} 没有日志"


if __name__ == "__main__":
    print("总行数", len(LOG), "总字符数", len("\n".join(LOG)))
    print("前 5 行:")
    print("\n".join(LOG[:5]))
    one_day = read_audit_log("C007", "2026-10-08", "2026-10-08")
    print("\n10 月 8 日这一天:")
    print(one_day)
    print("\n其他客户:", read_audit_log("C001", "2026-10-01", "2026-10-22"))
```

<div class="line-notes">

- `import random` Python 自带的随机数模块。今天要的不是「真随机」,而是「每次运行结果一样」的假数据,靠下面的固定种子做到。
- `from datetime import date, timedelta` `date(2026, 7, 1)` 是一个日期对象,`+ timedelta(days=1)` 就是后一天。相当于 JS 里 `new Date()` 加一天,只是不用自己算毫秒。
- `NOISE = [` 噪音事件的模板池,七种。每一项是三元组:模块名、事件名、详情模板。
- `("auth", "login.success", "user=刘静 ip=10.2.{a}.{b}"),` 详情里的 `{a}`、`{b}` 是占位,后面用 `str.format` 填成随机数。实测第一天凌晨有一行:`2026-07-01 03:38:56 | auth | login.success | user=刘静 ip=10.2.107.111`。
- `BILLING = {` 真正有用的事件,按日期放。键是日期字符串,值是当天的事件列表,每项是 (时间, 模块, 事件, 详情)。
- `"2026-07-09": [` 7 月 9 日是一个**干扰项**:第一次扣款 `card_declined`(卡被拒),11 日重试成功。它看起来像出过事,其实是正常的失败重试,发票只扣了一次钱。调查员要是看到「失败」就下结论,会查错方向。
- `("09:00:33", "payment", "gateway.timeout", "INV-2026-0026 gateway=pay-a waited=30s"),` 事故的起点:09:00:03 发起扣款,等了 30 秒网关没回话。
- `("09:00:34", "billing", "job.retry_unpaid", "INV-2026-0026 状态未确认,按未支付处理,新建发票 INV-2026-0123"),` 根因就在这一行:重试作业把「状态未确认」当成了「未支付」,于是另开了一张发票 INV-2026-0123。
- `("09:00:41", "payment", "callback.received", "INV-2026-0026 gateway=pay-a status=succeeded late=true"),` 迟到的回调:原来那笔扣款其实成功了,只是通知晚了 8 秒才到。
- `FIRST_DAY = date(2026, 7, 1)` 日志的起止日期,一共 114 天。
- `def build_log(per_day: tuple[int, int] = (20, 30)) -> list[str]:` 造日志的函数。`per_day` 是每天噪音行数的范围,默认二三十行。练习和后面的 `break_even.py` 会改它,默认值让总量在 2925 行。
- `rng = random.Random(332)` 自己建一个随机数发生器,种子固定为 332。不用全局的 `random.randint`,是为了不被别的代码影响。你的日志和我的一模一样,就靠这一行。
- `rows: list[tuple[str, str]] = []` 先收集 (时间戳, 其余内容) 的元组,最后统一排序。
- `while day <= LAST_DAY:` 一天一天往后走,走到 10 月 22 日为止。
- `for _ in range(rng.randint(*per_day)):` `*per_day` 把元组摊开成两个参数,`randint(20, 30)` 含两端。这一天造几行噪音,在 20 到 30 之间。
- `tm = f"{rng.randint(0, 23):02d}:{rng.randint(0, 59):02d}:{rng.randint(0, 59):02d}"` 随机的时分秒,`:02d` 表示不足两位补零,5 点显示成 `05`。
- `area, event, tpl = rng.choice(NOISE)` 从池里随机抽一个模板,同时解构成三个变量。
- `detail = tpl.format(` 用随机数填模板里的 `{a}`、`{b}`、`{n}`。
- `rows.append((f"{d} {tm}", f"{area} | {event} | {detail}"))` 噪音行加入列表。
- `for tm, area, event, detail in BILLING.get(d, []):` 当天要是有真事件就加进去,没有就是空列表,循环不执行。`dict.get(键, 默认值)` 在键不存在时返回默认值,不会报 `KeyError`。
- `rows.sort(key=lambda r: r[0])` 按时间戳排序。字符串 `2026-10-08 09:00:41` 的字典序和时间顺序一致,所以直接比字符串就行。同一秒的两行(09:00:34 的两条、09:00:41 的两条)Python 的排序是稳定的,保持写入顺序。
- `return [f"{ts} | {rest}" for ts, rest in rows]` 拼成最终的一行文字。
- `LOG = build_log()` 模块加载时造一次。实测 `len(LOG)` 是 2925。
- `def read_audit_log(customer_id: str, start: str, end: str) -> str:` 这就是要交给 Agent 的工具。注意它没有任何「摘要」功能,要多少行就返回多少行,这是故意的。
- `"""读取客户在 [start, end] 日期范围内的系统审计日志,每行一个事件,格式「时间 | 模块 | 事件 | 详情」。` docstring 是模型看到的工具描述。写清了日期格式和「范围越大返回越多」,模型会据此自己决定读多宽。
- `if customer_id != "C007":` 只有 C007 有日志。实测查 C001 返回 `客户 C001 没有审计日志`。
- `lines = [ln for ln in LOG if start <= ln[:10] <= end]` `ln[:10]` 取每行前 10 个字符,也就是日期部分,字符串比较。`"2026-10-01" <= "2026-10-08" <= "2026-10-23"` 成立。
- `return "\n".join(lines) or f"{start} 到 {end} 没有日志"` 空字符串是假值,范围里没日志时返回提示。
- `print("总行数", len(LOG), "总字符数", len("\n".join(LOG)))` 实测总行数 2925,总字符数 221731。

</div>

```bash
uv run python audit_log.py
```

输出(完整输出会把 10 月 8 日一整天 37 行都打出来,这里只截开头和关键的 8 行):

```text
总行数 2925 总字符数 221731
前 5 行:
2026-07-01 00:09:14 | webhook | delivered | target=erp-sync status=200 ms=405
2026-07-01 00:38:04 | auth | token.refreshed | client=web session=s528
2026-07-01 02:59:08 | export | job.finished | report=monthly rows=651 seconds=197
2026-07-01 03:38:56 | auth | login.success | user=刘静 ip=10.2.107.111
2026-07-01 05:41:43 | seat | usage.snapshot | seats=8/8 active=116
……(10 月 8 日其余 29 行是登录、API 调用、导出任务,略)
2026-10-08 09:00:01 | billing | invoice.created | INV-2026-0026 amount=2392.00
2026-10-08 09:00:03 | payment | charge.requested | INV-2026-0026 gateway=pay-a
2026-10-08 09:00:33 | payment | gateway.timeout | INV-2026-0026 gateway=pay-a waited=30s
2026-10-08 09:00:34 | billing | job.retry_unpaid | INV-2026-0026 状态未确认,按未支付处理,新建发票 INV-2026-0123
2026-10-08 09:00:34 | billing | invoice.created | INV-2026-0123 amount=2392.00 source=retry_unpaid
2026-10-08 09:00:36 | payment | charge.succeeded | INV-2026-0123 amount=2392.00 gateway=pay-a
2026-10-08 09:00:41 | payment | callback.received | INV-2026-0026 gateway=pay-a status=succeeded late=true
2026-10-08 09:00:41 | payment | charge.succeeded | INV-2026-0026 amount=2392.00 via=late_callback
```

10 月 8 日这一天共 37 行,只有 09:00 到 09:00:41 之间那 8 行和扣款有关。要回答「为什么扣了两次」,得从 586 行(10 月 1 日到 23 日)里把这 8 行挑出来。我算过,10 月 1 日到 23 日这一段是 44524 个字符,按后面真实的 token 数反推,大约 1.7 万 token。这就是今天要「放在哪」的那一大坨。

## 第 2 步:能记住对话的 ChatAgent

[Day 330](/blog/agent-zero/day-330-multi-agent-2/) 的 `MiniAgent.run()` 每次调用都从一份新的 `messages` 开始,这对「一次性的专员」正合适,它本身就是一个现成的子 Agent。但今天的主 Agent 要和客户来回聊四轮,得有记忆。所以写一个子类 `ChatAgent`:`messages` 跨轮保留,每一轮单独记账,并记下「现在上下文有多大」。

```python
# agent-zero-lab/part05/multi/chat_agent.py
"""多轮版 MiniAgent:messages 跨 say() 保留,每一轮单独记账。
Day 330 的 MiniAgent.run() 每次都从空白开始,适合当「一次性的专员」;主 Agent 要和客户来回聊,得有记忆。"""
import asyncio
import os
import time
from dataclasses import dataclass, field
from typing import Any

from mini_agent import MiniAgent, client, EXTRA_BODY


@dataclass
class ChatAgent(MiniAgent):
    messages: list[Any] = field(default_factory=list)
    context_tokens: int = 0  # 最近一次调模型时的输入 token 数,也就是「现在上下文有多大」
    turns: list[dict[str, Any]] = field(default_factory=list)  # 每一轮的账

    async def say(self, text: str) -> str:
        t0 = time.perf_counter()
        before = (self.usage.calls, self.usage.prompt_tokens, self.usage.cache_hit_tokens,
                  self.usage.completion_tokens, self.usage.cost)
        if not self.messages:
            self.messages.append({"role": "system", "content": self.system})
        self.messages.append({"role": "user", "content": text})
        specs: Any = [s for s, _ in self.tools.values()] or None
        answer = f"[{self.name}] 步数用完,没有得出结论"
        for _ in range(self.max_steps):
            resp = await client().chat.completions.create(
                model=os.environ["LLM_MODEL"], messages=self.messages, tools=specs, extra_body=EXTRA_BODY)
            self._account(resp)
            if resp.usage is not None:
                self.context_tokens = resp.usage.prompt_tokens
            msg = resp.choices[0].message
            self.messages.append(msg.model_dump(exclude_none=True))
            if not msg.tool_calls:
                answer = msg.content or ""
                break
            calls = [c for c in msg.tool_calls if c.type == "function"]
            if self.verbose:
                print(f"[{self.name}] 调工具:{[(c.function.name, c.function.arguments[:80]) for c in calls]}")
            outputs = await asyncio.gather(*(self._call(c.function.name, c.function.arguments) for c in calls))
            for call, out in zip(calls, outputs):
                self.messages.append({"role": "tool", "tool_call_id": call.id, "content": out})
        u = self.usage
        self.turns.append({
            "calls": u.calls - before[0],
            "prompt": u.prompt_tokens - before[1],
            "hit": u.cache_hit_tokens - before[2],
            "out": u.completion_tokens - before[3],
            "cost": u.cost - before[4],
            "context": self.context_tokens,
            "seconds": time.perf_counter() - t0,
        })
        return answer

    def turn_table(self) -> str:
        head = f"{'轮':>2}{'调用':>5}{'输入':>7}{'命中':>7}{'输出':>6}{'上下文':>8}{'秒':>6}{'元':>9}"
        rows = [f"{i:>2}{t['calls']:>5}{t['prompt']:>7}{t['hit']:>7}{t['out']:>6}{t['context']:>8}"
                f"{t['seconds']:>6.1f}{t['cost']:>9.4f}" for i, t in enumerate(self.turns, 1)]
        total = f"合计 {sum(t['calls'] for t in self.turns)} 次调用,{sum(t['cost'] for t in self.turns):.4f} 元"
        return "\n".join([head, *rows, total])
```

<div class="line-notes">

- `from mini_agent import MiniAgent, client, EXTRA_BODY` 复用 Day 330 的东西:`MiniAgent` 类、`client()` 取异步客户端、`EXTRA_BODY` 关思考模式的那段 JSON。`_call` 和 `_account` 也从 `MiniAgent` 继承,不用重写。
- `@dataclass` 子类也要加这个装饰器,新增的字段才会进 `__init__`。
- `class ChatAgent(MiniAgent):` 括号里写父类,Python 的继承。子类拥有父类所有的字段和方法,`name`、`system`、`tools`、`usage` 都白拿。
- `messages: list[Any] = field(default_factory=list)` 新字段:对话历史。`default_factory=list` 让每个实例各有一个自己的空列表(写 `= []` 会报错,原因 Day 330 讲过)。
- `context_tokens: int = 0  # 最近一次调模型时的输入 token 数,也就是「现在上下文有多大」` 今天最关键的一个数。API 返回的 `prompt_tokens` 就是这次请求发出去的全部输入,等于当时的上下文大小。
- `turns: list[dict[str, Any]] = field(default_factory=list)  # 每一轮的账` 每一轮结束往里加一条字典,最后打表。
- `async def say(self, text: str) -> str:` 客户说一句话,返回客服的回答。和 `run` 的区别是不重置 `messages`。
- `t0 = time.perf_counter()` 记这一轮的开始时间。
- `before = (self.usage.calls, self.usage.prompt_tokens, self.usage.cache_hit_tokens,` 先把累计账本的当前值拍个快照,轮末一减就是这一轮的账。`self.usage` 是整个 Agent 的累计,不是每轮的。
- `if not self.messages:` 第一次 `say` 时历史是空的,先放系统提示词。之后每轮历史里已经有它了。
- `self.messages.append({"role": "user", "content": text})` 把客户这句话追加到历史末尾。
- `specs: Any = [s for s, _ in self.tools.values()] or None` 和 `run` 里一样:工具定义列表,没有工具传 `None`。
- `answer = f"[{self.name}] 步数用完,没有得出结论"` 先备一个兜底回答,循环里拿到最终回复就覆盖它。
- `for _ in range(self.max_steps):` 一轮对话里最多调 6 次模型(查客户、查订阅和日志、写回答,通常 2–3 次)。
- `resp = await client().chat.completions.create(` 异步调模型。注意传的是 `self.messages`,整个历史,每次都是。
- `self._account(resp)` 父类的方法,把这次的 token 记到 `self.usage`。
- `self.context_tokens = resp.usage.prompt_tokens` 记下输入有多大。实测 inline 版第一轮最后一次调用是 18942,sub 版是 1697。
- `self.messages.append(msg.model_dump(exclude_none=True))` 模型这条回复进历史。带工具调用的回复也要进,下面才能配上 tool 消息。
- `if not msg.tool_calls:` 没有工具调用就是最终回答,存下来跳出循环。
- `calls = [c for c in msg.tool_calls if c.type == "function"]` 只留普通函数调用,理由同 Day 330。
- `outputs = await asyncio.gather(*(self._call(c.function.name, c.function.arguments) for c in calls))` 同一步的多个工具并发执行。第一轮里 `get_subscription` 和 `read_audit_log` 就是同时发出的。
- `self.messages.append({"role": "tool", "tool_call_id": call.id, "content": out})` 每个结果配上对应的 `tool_call_id`。**这一条的 `content` 就是那 1.7 万 token 的日志原文**,它从此住在主 Agent 的 `messages` 里,每一轮都要被重新发给模型。inline 版的问题全出在这一行。
- `"calls": u.calls - before[0],` 当前累计减去快照,就是这一轮的调用次数;下面几行同理。
- `"context": self.context_tokens,` 这一轮结束时的上下文大小。
- `def turn_table(self) -> str:` 把每一轮的账排成表,方便对比。
- `head = f"{'轮':>2}{'调用':>5}{'输入':>7}{'命中':>7}{'输出':>6}{'上下文':>8}{'秒':>6}{'元':>9}"` 表头。`>5` 是右对齐、宽度 5。
- `total = f"合计 {sum(t['calls'] for t in self.turns)} 次调用,{sum(t['cost'] for t in self.turns):.4f} 元"` 最后一行合计。

</div>

## 第 3 步:同一场对话,两种做法

现在拼实验。同一个客户、同一场四轮对话,问题固定:

1. 「10 月 8 日我被扣了两笔 2392 元,到底怎么回事?」要翻日志才能回答。
2. 「那这个订阅还会继续每月自动扣款吗?下一个周期到哪天?」只需要订阅信息,和日志无关。
3. 「你前面说有一笔是后来才确认成功的,那条成功通知具体是几点几分几秒收到的?」追问日志里的一个细节。
4. 「按退款政策,多扣的那笔多久能退回来?」只需要政策,政策已经写在主 Agent 的系统提示词里。

两种做法只有一处不同。**inline**:主 Agent 自己手握 `read_audit_log`,自己读日志。**sub**:主 Agent 没有 `read_audit_log`,只有一个 `investigate(task)` 工具,调用它会启动一个调查员(就是一个 `MiniAgent`),调查员读日志,交回结论和证据。注意调查员**就是** [Day 330](/blog/agent-zero/day-330-multi-agent-2/) 里的 `ask_billing_agent` 同一种写法,每次 `run()` 都从空白 `messages` 开始,用完即弃。区别只在意图:那时它是长期的领域专员,现在它是一次性的、替主 Agent 吃掉大块输入的临时工。

```python
# agent-zero-lab/part05/multi/subagent_demo.py
"""同一场四轮对话,两种做法:inline(主 Agent 自己读日志)和 subagent(开子 Agent 去读,只拿结论)。
用法:uv run python subagent_demo.py inline|sub"""
import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parents[2] / "cloudledger"))
from server import REFUND_POLICY, find_customer, get_subscription  # noqa: E402  # pyright: ignore[reportMissingImports]

from audit_log import read_audit_log  # noqa: E402
from chat_agent import ChatAgent  # noqa: E402
from mini_agent import MiniAgent  # noqa: E402

TURNS = [
    "我是 user007@example.com。10 月 8 日我被扣了两笔 2392 元,到底怎么回事?",
    "那这个订阅还会继续每月自动扣款吗?下一个周期到哪天?",
    "你前面说有一笔是后来才确认成功的,那条成功通知具体是几点几分几秒收到的?",
    "按退款政策,多扣的那笔多久能退回来?",
]
MAIN_SYSTEM = ("你是云簿客服。今天是 2026-10-23。用工具查事实再回答,不要编造发票号、金额、时间。回答简短,三五句话。你手上没有提交退款的工具,只能说「会转交客服主管审批」,不要说已提交。\n"
               "退款政策:\n" + REFUND_POLICY)
INVESTIGATOR_SYSTEM = ("你是日志调查员。用 read_audit_log 读日志,找出任务里问的那件事的原因。"
                       "只返回结论,但要带上支撑结论的关键证据:发票号、金额、带日期和秒的时间戳。不要贴整段日志。")
SCHEMA_ID = {"type": "object", "properties": {"query": {"type": "string"}}, "required": ["query"]}
SCHEMA_CUST = {"type": "object", "properties": {"customer_id": {"type": "string"}}, "required": ["customer_id"]}
SCHEMA_LOG = {"type": "object", "properties": {"customer_id": {"type": "string"}, "start": {"type": "string"},
                                              "end": {"type": "string"}}, "required": ["customer_id", "start", "end"]}


def build_main(mode: str, investigator_system: str = INVESTIGATOR_SYSTEM) -> ChatAgent:
    main = ChatAgent(name=f"main-{mode}", system=MAIN_SYSTEM, verbose=True)
    main.add_tool(find_customer, SCHEMA_ID)
    main.add_tool(get_subscription, SCHEMA_CUST)
    if mode == "inline":
        main.add_tool(read_audit_log, SCHEMA_LOG)
    else:
        investigator = MiniAgent(
            name="investigator", verbose=True, system=investigator_system)
        investigator.add_tool(read_audit_log, SCHEMA_LOG)

        async def investigate(task: str) -> str:
            """把一个需要翻大量日志才能回答的问题交给调查员。task 里写清客户编号、日期范围、要查什么。
            调查员只会返回结论和关键证据,不会把日志原文给你。"""
            return await investigator.run(task)

        main.add_tool(investigate, {"type": "object", "properties": {"task": {"type": "string"}}, "required": ["task"]})
        main.investigator = investigator  # type: ignore[attr-defined]
    return main


async def main_async(mode: str) -> None:
    main = build_main(mode)
    for i, q in enumerate(TURNS, 1):
        print(f"\n===== 第 {i} 轮 客户:{q}")
        print("客服:" + await main.say(q))
    print("\n" + main.turn_table())
    inv = getattr(main, "investigator", None)
    if inv is not None:
        u = inv.usage
        print(f"子 Agent 单独的账:{u.calls} 次调用,输入 {u.prompt_tokens},输出 {u.completion_tokens},{u.cost:.4f} 元")
        print(f"全部合计:{main.usage.cost + u.cost:.4f} 元")


if __name__ == "__main__":
    asyncio.run(main_async(sys.argv[1] if len(sys.argv) > 1 else "inline"))
```

<div class="line-notes">

- `sys.path.insert(0, str(Path(__file__).parents[2] / "cloudledger"))` 和前两天一样,把 `agent-zero-lab/cloudledger` 加进模块搜索路径,下一行才能 `from server import`。
- `from server import REFUND_POLICY, find_customer, get_subscription  # noqa: E402  # pyright: ignore[reportMissingImports]` 复用 Day 284 的函数和退款政策常量。注意 import `server` 的副作用:它会给根日志器装一个 Rich 处理器,所以 `mini_agent.py` 里要把 `httpx` 和 `httpx2` 两个日志器调到 WARNING(Day 330 踩过)。
- `from audit_log import read_audit_log  # noqa: E402` 今天第 1 步写的工具。
- `from chat_agent import ChatAgent  # noqa: E402` 第 2 步写的多轮 Agent。
- `from mini_agent import MiniAgent  # noqa: E402` 调查员用的是 Day 330 的原版 `MiniAgent`,它的 `run()` 每次从空白开始,这正是子 Agent 要的。
- `TURNS = [` 四句客户的话,实验里每种做法都问同样四句。第 3 句里的「你前面说有一笔是后来才确认成功的」是照着第 1 轮的真实回答写的,两种做法的第 1 轮回答里都说了「迟到的回调」。
- `MAIN_SYSTEM = ("你是云簿客服。今天是 2026-10-23。` 这一行是主 Agent 的系统提示词,有两处是我撞了坑才加的。第一处是日期。第一次跑时没写日期,模型自己去读了 `2025-10-01` 到 `2025-10-10` 的日志,什么都没查到,然后回答说「2025 年 10 月的审计日志里我查不到这两笔扣款记录」。Day 330 主管编年份是同一个毛病:模型不知道今天几号。把日期写进系统提示词,是最便宜的修法。第二处是这半句「你手上没有提交退款的工具,只能说会转交客服主管审批,不要说已提交」。第一版里客服好几次说「我这边已提交」「我现在就为您提交申请」,可它手上根本没有这个工具。这是主 Agent 凭空承诺,和 Day 330 主管编「3–5 个工作日」一样,加一句约束就收敛了。
- `"退款政策:\n" + REFUND_POLICY)` 把 Day 284 的四条政策原文拼进系统提示词。政策很短,不值得再造一个工具。
- `INVESTIGATOR_SYSTEM = ("你是日志调查员。用 read_audit_log 读日志,找出任务里问的那件事的原因。"` 调查员的系统提示词。
- `"只返回结论,但要带上支撑结论的关键证据:发票号、金额、带日期和秒的时间戳。不要贴整段日志。")` 这一句是今天的关键设计,后面「坑一」会看到去掉它的后果:子 Agent 交回的是**压缩过的**结论,压什么、留什么,要在这里讲清楚。
- `SCHEMA_ID = {"type": "object", "properties": {"query": {"type": "string"}}, "required": ["query"]}` 三个工具的参数 schema,手写,参数名要和函数的参数名一致。
- `SCHEMA_LOG = {"type": "object", "properties": {"customer_id": {"type": "string"}, "start": {"type": "string"},` 日志工具有三个参数:客户、开始日期、结束日期。模型传多宽的范围,完全由它自己定。
- `def build_main(mode: str, investigator_system: str = INVESTIGATOR_SYSTEM) -> ChatAgent:` 按模式造主 Agent。`investigator_system` 参数让后面的实验能换一个「话少」的调查员。
- `main = ChatAgent(name=f"main-{mode}", system=MAIN_SYSTEM, verbose=True)` 两种模式的主 Agent 其余都一样。
- `if mode == "inline":` 分叉点。
- `main.add_tool(read_audit_log, SCHEMA_LOG)` inline 模式:主 Agent 直接拿到日志工具,日志原文会进它的 `messages`。
- `investigator = MiniAgent(` sub 模式:造一个调查员,它独占 `read_audit_log`。
- `investigator.add_tool(read_audit_log, SCHEMA_LOG)` 日志工具挂在调查员身上,主 Agent 手里没有。
- `async def investigate(task: str) -> str:` 把调查员包装成主 Agent 的工具,和 Day 330 的 `ask_billing_agent` 同一个写法。函数定义写在 `else` 分支里,是为了直接引用外面刚建好的 `investigator`(闭包)。
- `"""把一个需要翻大量日志才能回答的问题交给调查员。task 里写清客户编号、日期范围、要查什么。` docstring 是主 Agent 看到的工具描述,有两个信息:什么时候该用它(要翻大量日志)、task 里要写什么(调查员看不到客户原话)。
- `return await investigator.run(task)` 调查员跑完整个循环,把最后一段文字当作工具结果交回。它读过的 586 行日志留在 `investigator.run` 的局部变量 `messages` 里,函数返回后就没人引用了。
- `main.add_tool(investigate, {"type": "object", "properties": {"task": {"type": "string"}}, "required": ["task"]})` 主 Agent 只看到一个参数 `task`。
- `main.investigator = investigator  # type: ignore[attr-defined]` 把调查员挂在主 Agent 身上,是为了最后能拿到它的账本。给对象临时加属性在 Python 里是允许的,类型检查器不喜欢,所以加了忽略注释。
- `return main` 返回造好的主 Agent。
- `async def main_async(mode: str) -> None:` 跑一场四轮对话。
- `for i, q in enumerate(TURNS, 1):` `enumerate(列表, 1)` 从 1 开始编号。
- `print("客服:" + await main.say(q))` 每一轮客户说一句,打印客服的回答。
- `print("\n" + main.turn_table())` 打印每轮的账。
- `inv = getattr(main, "investigator", None)` inline 模式没有这个属性,`getattr` 带默认值就返回 `None`,不报错。
- `print(f"全部合计:{main.usage.cost + u.cost:.4f} 元")` 主 Agent 的钱加子 Agent 的钱。**只看主 Agent 那一行会严重低估 sub 版的成本**,多 Agent 的账一定要加总。
- `asyncio.run(main_async(sys.argv[1] if len(sys.argv) > 1 else "inline"))` 命令行第一个参数选模式,默认 inline。

</div>

先跑 inline:

```bash
uv run python subagent_demo.py inline
```

```text

===== 第 1 轮 客户:我是 user007@example.com。10 月 8 日我被扣了两笔 2392 元,到底怎么回事?
[main-inline] 调工具:[('find_customer', '{"query": "user007@example.com"}')]
[main-inline] 调工具:[('get_subscription', '{"customer_id": "C007"}'), ('read_audit_log', '{"customer_id": "C007", "start": "2026-10-01", "end": "2026-10-23"}')]
客服:您这是企业版月付（8 席）的续费。10 月 8 日 9:00 系统先创建发票 INV-2026-0026 并发起扣款，但支付网关 30 秒超时、状态未确认，系统就按未支付处理，重新生成了 INV-2026-0123 并扣款成功；随后网关又返回了 INV-2026-0026 的迟到成功回调，于是同一笔费用被扣了两次。

这属于重复扣款，核实后应全额退还重复的那一笔。我这边没有直接提交退款的权限，会转交客服主管审批后处理。

===== 第 2 轮 客户:那这个订阅还会继续每月自动扣款吗?下一个周期到哪天?
客服:是的，您这个企业版月付订阅目前状态正常，会继续按月自动续费。本期到 2026-11-08 结束，届时会按原价自动扣下一期。若想停止续费，需在到期前取消，取消后当期结束就不再扣款，但月付不支持中途退款。

===== 第 3 轮 客户:你前面说有一笔是后来才确认成功的,那条成功通知具体是几点几分几秒收到的?
客服:根据审计日志，迟到回调是 2026-10-08 09:00:41 收到的（payment callback.received，INV-2026-0026，status=succeeded，late=true）。

===== 第 4 轮 客户:按退款政策,多扣的那笔多久能退回来?
客服:按重复扣款政策，核实后全额退还重复的那一笔，3 个工作日内原路退回。不过这笔退款需客服主管审批后才能执行，我这边会帮您转交，审批通过后按上述时限退回。

 轮   调用     输入     命中    输出     上下文     秒        元
 1    3  20369   1280   307   18942   3.5   0.0407
 2    1  19103  18944    69   19103   1.2   0.0016
 3    1  19198  18944    44   19198   1.0   0.0016
 4    1  19259  19072    48   19259   0.8   0.0015
合计 6 次调用,0.0455 元
```

第 1 轮的第二步,主 Agent 同时调了 `get_subscription` 和 `read_audit_log`,日期范围是 `2026-10-01` 到 `2026-10-23`,也就是 586 行、44524 个字符。这一轮的最后一次调用,输入是 18942 token。这些日志从此住在主 Agent 的 `messages` 里:第 2 轮问的是订阅,和日志毫无关系,输入还是 19103;第 4 轮问退款政策,19259。每一轮都背着它。

再跑 sub:

```bash
uv run python subagent_demo.py sub
```

```text

===== 第 1 轮 客户:我是 user007@example.com。10 月 8 日我被扣了两笔 2392 元,到底怎么回事?
[main-sub] 调工具:[('find_customer', '{"query": "user007@example.com"}')]
[main-sub] 调工具:[('get_subscription', '{"customer_id": "C007"}'), ('investigate', '{"task": "客户编号 C007(刘静,user007@example.com),请查 2026-10-01 至 2026-10-23 期间所有扣款/支付')]
[investigator] 收到任务:客户编号 C007(刘静,user007@example.com),请查 2026-10-01 至 2026-10-23 期间所有扣款/支付日志,重点核实 2026-10-08 是否有两笔各 2392 元的扣款,是否属于重复扣款(同一订单/同一账单被重复扣两次),并给出两笔扣款的交易/发票标识、时间和状态。
[investigator] 调工具:[('read_audit_log', '{"customer_id": "C007", "start": "2026-10-01", "end": "2026-10-23"}')]
[investigator] 交回结论,用时 5.8 秒
客服:确认了：10 月 8 日确实被扣了两笔 2392 元，属于**重复扣款**。09:00:33 支付网关超时，系统误判为未支付并发起重试；重试时生成了新发票 INV-2026-0123，09:00:36 扣款成功；随后原发票 INV-2026-0026 的延迟支付回调在 09:00:41 到达，并再次扣款成功。按政策，重复扣款经核实后会全额退还多扣的那一笔 2392 元，并在 3 个工作日内原路退回。我需要转交客服主管审批，审批通过后便可执行退款。

===== 第 2 轮 客户:那这个订阅还会继续每月自动扣款吗?下一个周期到哪天?
客服:您当前是企业版、月付、8 个席位，状态正常，本期于 **2026-11-08** 结束。按现状，届时会自动续费并扣款一个周期，续费到 2026-12-08。另外，月付不支持中途退款；如果取消，则当期结束后不再续费。需要我帮您转交取消或备注需求吗？

===== 第 3 轮 客户:你前面说有一笔是后来才确认成功的,那条成功通知具体是几点几分几秒收到的?
客服:迟到的成功回调是在 **2026-10-08 09:00:41** 收到的：INV-2026-0026 的 callback.received，状态为 succeeded，late=true，并在同一秒完成第二笔扣款。

另外说明一下：那笔先成功的是 INV-2026-0123，时间为 09:00:36。

===== 第 4 轮 客户:按退款政策,多扣的那笔多久能退回来?
客服:按政策，重复扣款核实后全额退还多扣的那一笔（2392 元），将在 **3 个工作日内原路退回**。目前正在等客服主管审批，审批通过后执行。

 轮   调用     输入     命中    输出     上下文     秒        元
 1    3   3039   1536   359    1697   9.8   0.0059
 2    1   1867   1664    83    1867   1.1   0.0011
 3    1   1976   1792    77    1976   1.3   0.0011
 4    1   2070   1920    43    2070   0.8   0.0007
合计 6 次调用,0.0089 元
子 Agent 单独的账:2 次调用,输入 19061,输出 826,0.0432 元
全部合计:0.0521 元
```

主 Agent 的第 1 轮最后一次调用,输入 1697 token。前面那 586 行日志去了调查员那里:调查员两次调用,输入 19061、输出 826,是这场对话里唯一读过日志的人。它交回的结论带着发票号和到秒的时间戳,所以第 3 轮追问「几点几分几秒」,主 Agent 照样答对了:09:00:41,而且还主动补了一句先成功的是 INV-2026-0123、09:00:36。

把两份输出的数放在一起:

| | inline | sub |
| --- | --- | --- |
| 主 Agent 第 1 轮末的上下文 | 18942 | 1697 |
| 主 Agent 第 4 轮的上下文 | 19259 | 2070 |
| 第 1 轮用时 | 3.5 秒 | 9.8 秒 |
| 模型调用次数 | 6 | 6(主)+ 2(子)= 8 |
| 实际花费 | 0.0455 元 | 0.0089 + 0.0432 = 0.0521 元 |
| 假设没有任何缓存命中 | 0.160 元 | 0.067 元 |

最后一行的算式是 (全部输入 token × 2 + 全部输出 token × 8) ÷ 1,000,000。inline:输入 20369 + 19103 + 19198 + 19259 = 77929,输出 468,(77929 × 2 + 468 × 8) ÷ 10⁶ = 0.1596。sub:主 Agent 输入 8952、输出 562,调查员输入 19061、输出 826,合计输入 28013、输出 1388,(28013 × 2 + 1388 × 8) ÷ 10⁶ = 0.0671。

<figure>
<svg viewBox="0 0 640 250" role="img" aria-label="四轮对话里主 Agent 的上下文大小:inline 版每轮约 1.9 万 token,sub 版每轮 1.7 千到 2.1 千 token">
  <rect x="0" y="0" width="640" height="250" fill="var(--paper-raised)"/>
  <text x="20" y="22" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">主 Agent 每轮结束时的上下文大小(token)</text>
  <g font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">
    <text x="20" y="62">第 1 轮</text><text x="20" y="112">第 2 轮</text><text x="20" y="162">第 3 轮</text><text x="20" y="212">第 4 轮</text>
  </g>
  <g stroke="var(--compute)" fill="var(--compute-wash)">
    <rect x="80" y="42" width="472" height="18"/><rect x="80" y="92" width="476" height="18"/>
    <rect x="80" y="142" width="478" height="18"/><rect x="80" y="192" width="480" height="18"/>
  </g>
  <g stroke="var(--mem)" fill="var(--mem-wash)">
    <rect x="80" y="62" width="42" height="18"/><rect x="80" y="112" width="47" height="18"/>
    <rect x="80" y="162" width="49" height="18"/><rect x="80" y="212" width="52" height="18"/>
  </g>
  <g font-family="var(--font-mono)" font-size="11" fill="var(--ink)">
    <text x="560" y="55" text-anchor="end" dx="-6">18942</text><text x="564" y="105" text-anchor="end" dx="-6">19103</text>
    <text x="566" y="155" text-anchor="end" dx="-6">19198</text><text x="568" y="205" text-anchor="end" dx="-6">19259</text>
    <text x="128" y="75">1697</text><text x="134" y="125">1867</text><text x="136" y="175">1976</text><text x="139" y="225">2070</text>
  </g>
  <rect x="440" y="226" width="12" height="10" fill="var(--compute-wash)" stroke="var(--compute)"/><text x="456" y="235" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">inline</text>
  <rect x="520" y="226" width="12" height="10" fill="var(--mem-wash)" stroke="var(--mem)"/><text x="536" y="235" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">sub</text>
</svg>
<figcaption>琥珀色是主 Agent 自己读日志的版本,蓝色是开子 Agent 的版本。条的长度按比例画,19259 对应 480 像素。两版的第 2、4 轮都在问和日志无关的事,inline 版照样背着那 1.7 万 token。</figcaption>
</figure>

## 读这份对比:省下的和没省下的

最直观的是上下文:1.9 万对 1.7 千,差了十倍多,而且这个差距不会随着聊天变短。如果客户接着再问二十句,inline 版每一句都要把整份日志再读一遍。

可是第一行「实际花费」让人意外:**sub 版没有更便宜,甚至略贵。** 我这场对话来回跑了好几次,同一套配置下 inline 是 0.0444 和 0.0455 元,sub 是 0.0423 和 0.0521 元,两边来回重叠,结论是「差不多」。原因在缓存。[Day 124](/blog/agent-zero/day-124-cost/) 讲过,DeepSeek 会缓存请求开头相同的部分,命中的输入只收 0.04 元每百万,是未命中价 2 元的五十分之一。inline 版的第 2、3、4 轮,上下文是在上一轮基础上追加的,开头完全一样,所以 19103 个输入里有 18944 个命中缓存,这三轮每轮只花 0.0016、0.0016、0.0015 元。背着 1.7 万 token 的日志聊天,钱上几乎没有惩罚。

这是今天最容易被说错的一点。很多文章说「subagent 省 token 省钱」,在有前缀缓存的厂商上,省钱不是它的主要收益。我在表的最后一行假设一个 token 都没命中缓存,sub 版才便宜了一倍多:0.067 对 0.160。什么时候会没命中?缓存有存活时间(用户停几分钟再回来可能就过期了),或者你换了不支持前缀缓存的模型、换了厂商,或者历史被你自己改写过(比如截断、摘要之后前缀变了)。

那 sub 版到底省了什么?至少有三样:

**第一,上下文窗口的上限。** 今天的日志只读了 23 天。真实系统里「翻三个月的日志」是常态,全读下来能到几十万 token,inline 版根本塞不进去,只能让模型分段读、自己做摘要。子 Agent 可以分段读而不污染主对话。

**第二,模型的注意力。** Anthropic 的[上下文工程那篇文章](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)把这叫 context rot:上下文里的 token 越多,模型对其中信息的召回就越差。它还写到子 Agent 架构的做法,子 Agent 可以用几万 token 去探索,却只交回「凝练过的摘要(通常 1000–2000 token)」。今天的对话还太短,看不出 inline 版答错,但这个风险是随长度涨的。

**第三,主 Agent 的每一轮都更轻、更快。** 看用时:第 2 到 4 轮 sub 版是 1.1、1.3、0.8 秒,inline 版是 1.2、1.0、0.8 秒,没什么差别,这又是缓存的功劳。

没占到便宜的也要说清:**第 1 轮慢了接近三倍**(9.8 秒对 3.5 秒),因为多了一次完整的子 Agent 往返:主 Agent 先写任务描述,调查员再读日志、再写结论,主 Agent 最后再把结论改写给客户。调用次数从 6 次变成 8 次,每多一次「转述」,就多一个编造和丢信息的机会。

所以对 subagent 比较诚实的说法是:**它买的是上下文的整洁和天花板,不是钱,更不是速度。** 要不要买,取决于日志有多大、对话有多长、窗口会不会不够。

## 坑一:结论是有损压缩

子 Agent 交回的是压缩过的结论,压缩就会丢东西。丢什么,取决于你让它怎么压。把调查员的系统提示词换成「最后只说结论,控制在 30 个字以内,只讲原因,不要写任何发票号、金额和时间」,再问同样的第 1 轮和第 3 轮:

```python
# agent-zero-lab/part05/multi/subagent_lossy.py
"""子 Agent 交回的结论是「有损压缩」:调查员被要求只说一句话,后面追问细节时主 Agent 就答不出来。"""
import asyncio

from subagent_demo import TURNS, build_main

TERSE = "你是日志调查员。用 read_audit_log 读日志,找出任务里问的那件事的原因。最后只说结论,控制在 30 个字以内,只讲原因,不要写任何发票号、金额和时间。"


async def main() -> None:
    agent = build_main("sub", investigator_system=TERSE)
    agent.investigator.verbose = False  # type: ignore[attr-defined]
    for q in (TURNS[0], TURNS[2]):
        print(f"\n客户:{q}")
        print("客服:" + await agent.say(q))
    print("\n调查员交回的原话:", agent.investigator.last_answer)  # type: ignore[attr-defined]


if __name__ == "__main__":
    asyncio.run(main())
```

<div class="line-notes">

- `from subagent_demo import TURNS, build_main` 直接复用上一个脚本里的客户问题和造主 Agent 的函数。import `subagent_demo` 时它底部的 `if __name__ == "__main__":` 不会执行,所以不会重复跑一遍实验。
- `TERSE = "你是日志调查员。用 read_audit_log 读日志,找出任务里问的那件事的原因。最后只说结论,控制在 30 个字以内,只讲原因,不要写任何发票号、金额和时间。"` 把调查员变成「话少」的版本。这在真实项目里并不夸张,为了省主 Agent 的上下文,很多人会这样写。
- `agent = build_main("sub", investigator_system=TERSE)` 用第二个参数换掉调查员的系统提示词,主 Agent 其余不变。
- `agent.investigator.verbose = False  # type: ignore[attr-defined]` 关掉调查员的过程打印,输出短一点。
- `for q in (TURNS[0], TURNS[2]):` 只问第 1 轮和第 3 轮:先让它查出原因,再追问细节。
- `print("\n调查员交回的原话:", agent.investigator.last_answer)  # type: ignore[attr-defined]` `last_answer` 是 Day 330 的 `MiniAgent` 记下的最近一次交回的文字,这里把子 Agent 交回的原话打出来对照。

</div>

```text

客户:我是 user007@example.com。10 月 8 日我被扣了两笔 2392 元,到底怎么回事?
[main-sub] 调工具:[('find_customer', '{"query": "user007@example.com"}')]
[main-sub] 调工具:[('get_subscription', '{"customer_id": "C007"}'), ('investigate', '{"task": "客户编号 C007(user007@example.com,半岛咖啡)。请查 2026-10-01 至 2026-10-23 期间的所有扣款')]
客服:查到了：10 月 8 日第一笔支付的回调超时，系统误判为未支付并重新扣款，随后首笔又成功回调，因此形成重复扣款。按政策重复的那一笔核实后全额原路退回，3 个工作日内到账。退款需要客服主管审批，我会转交客服主管处理，请保持留意。

客户:你前面说有一笔是后来才确认成功的,那条成功通知具体是几点几分几秒收到的?
客服:这个精确到秒的时间戳我这边看不到，调查员只返回结论，不给日志原文；需要精确时间的话得让技术同事调支付回调日志。要我转交客服主管一并核实吗？

调查员交回的原话: 首笔支付超时后，系统将它按未支付处理并重新开票扣款；随后首笔又收到迟到的成功回调，形成重复扣款。
```

调查员交回的原话只有一句:「首笔支付超时后,系统将它按未支付处理并重新开票扣款;随后首笔又收到迟到的成功回调,形成重复扣款。」没有时间,没有发票号。主 Agent 第 1 轮照着它给客户讲了个大概,然后第 3 轮被追问「几点几分几秒」,它诚实地说「这个精确到秒的时间戳我这边看不到」。

值得高兴的是,它没有编一个时间出来,这个结果比 Day 330 好。但客户体验已经坏了:信息明明被查到过,又在压缩里丢了。**这就是有损压缩:子 Agent 读过的东西,主 Agent 永远只能通过这一小段话知道。** 要避免,有三条路。

一是写在调查员的提示词里,像最初那版:结论加上关键证据(发票号、金额、带秒的时间戳),不要贴原文。这是成本最低的办法。二是让调查员交回结构化的证据清单,而不是一段话,练习 2 做这个。三是承认压缩有损,教主 Agent 在追问细节时**再派一次**,并在任务里明确点名要什么,练习 3 做这个。三条可以叠用。

## fork:带着全部历史去干活

普通子 Agent 从白纸开始,只看得到任务描述。如果任务一句话说不清,需要很多背景,你就得自己把背景写进任务里,写漏了,子 Agent 就缺信息。Claude Code 的文档里有一种不同的子 Agent 叫 fork,原文是 "A fork is a subagent that inherits the entire conversation so far instead of starting fresh.":它继承当前对话的全部历史,再去干一件事,它自己的工具调用不进主对话,只有最后结果回来。

两种取舍正好相反。普通子 Agent 输入干净、便宜,但要靠任务描述传背景。fork 不用写背景,而且它的前缀和主 Agent 完全一样,能吃到缓存,代价是它的输入带着主对话里所有的噪音。下面把这两种在同一件事上量一次:主 Agent 聊完第 1 轮之后,让子 Agent 把这件事写成一段给财务的退款备注。

```python
# agent-zero-lab/part05/multi/fork_demo.py
"""普通子 Agent 和 fork 型子 Agent 的区别:前者从白纸开始、只看到任务描述,后者带着主 Agent 的全部历史去干活。"""
import asyncio
import copy

from chat_agent import ChatAgent
from subagent_demo import TURNS, build_main

TASK = "把这位客户这件事写成一段给财务的退款申请备注,100 字以内,要有客户编号、两张发票号、金额和原因。"
WRITER = "你是财务备注撰写员,按任务要求写备注。任务里没有的信息不要编造,缺什么就写「缺:xxx」。"


async def main() -> None:
    boss = build_main("sub")
    boss.verbose = False
    boss.investigator.verbose = False  # type: ignore[attr-defined]
    await boss.say(TURNS[0])
    print(f"主 Agent 聊完第 1 轮,历史 {len(boss.messages)} 条,上下文 {boss.context_tokens} token\n")

    # 普通子 Agent:白纸一张。我们只好手写一句背景塞进任务里。
    plain = ChatAgent(name="plain", system=WRITER)
    out_plain = await plain.say("客户 C007 在 10 月 8 日被重复扣款,要退款。" + TASK)
    t = plain.turns[0]
    print(f"[普通子 Agent] 输入 {t['prompt']},命中缓存 {t['hit']},{t['cost']:.4f} 元\n{out_plain}\n")

    # fork 型:复制主 Agent 此刻的全部历史,再追加任务。
    fork = ChatAgent(name="fork", system=boss.system, tools=dict(boss.tools))
    fork.messages = copy.deepcopy(boss.messages)
    out_fork = await fork.say(TASK)
    t = fork.turns[0]
    print(f"[fork 子 Agent] 输入 {t['prompt']},命中缓存 {t['hit']},{t['cost']:.4f} 元\n{out_fork}")


if __name__ == "__main__":
    asyncio.run(main())
```

<div class="line-notes">

- `import copy` 标准库的复制模块,下面要用 `copy.deepcopy`。
- `TASK = "把这位客户这件事写成一段给财务的退款申请备注,100 字以内,要有客户编号、两张发票号、金额和原因。"` 同一个任务,发给两种子 Agent。
- `WRITER = "你是财务备注撰写员,按任务要求写备注。任务里没有的信息不要编造,缺什么就写「缺:xxx」。"` 普通子 Agent 的系统提示词。最后一句让它「缺什么就写缺」,不然它会自己编发票号。
- `boss = build_main("sub")` 主 Agent,和前面 sub 模式的一样。
- `await boss.say(TURNS[0])` 先聊完第 1 轮。实测此后主 Agent 的历史有 8 条消息(系统提示词、客户的话、两轮工具调用和结果、最终回答),上下文 1688 token。
- `plain = ChatAgent(name="plain", system=WRITER)` 普通子 Agent:全新的 `ChatAgent`,`messages` 是空的,没有工具。
- `out_plain = await plain.say("客户 C007 在 10 月 8 日被重复扣款,要退款。" + TASK)` 手写了一句背景塞进任务。我故意只写了一句,模拟「背景写得不全」,这在真实使用里太常见了。
- `t = plain.turns[0]` 取这一轮的账。`say` 每轮往 `turns` 里追加一条,第一轮就是下标 0。
- `fork = ChatAgent(name="fork", system=boss.system, tools=dict(boss.tools))` fork 要和主 Agent 的系统提示词、工具定义**一模一样**,请求的开头才完全相同,缓存才能命中。`dict(...)` 复制一份工具表。
- `fork.messages = copy.deepcopy(boss.messages)` fork 的核心一行:复制主 Agent 此刻的全部历史。要用 `deepcopy`(深拷贝),因为历史里是字典嵌套列表,浅拷贝只复制最外层,fork 往里追加内容时会改到主 Agent 的历史。JS 里相当于 `structuredClone`。
- `out_fork = await fork.say(TASK)` 在复制来的历史后面追加任务。这时 `messages` 非空,`say` 不会再放一遍系统提示词。

</div>

```text
主 Agent 聊完第 1 轮,历史 8 条,上下文 1688 token

[普通子 Agent] 输入 85,命中缓存 0,0.0004 元
客户C007于10月8日被重复扣款，申请退款。发票号：缺；金额：缺；原因：重复扣款。

[fork 子 Agent] 输入 1910,命中缓存 1664,0.0014 元
**客户编号 C007；2026-10-08 因网关扣款超时误判为未支付，系统重新开票并扣款成功；原发票的迟到成功回调又被记了一笔，导致重复扣款。发票 INV-2026-0123 与 INV-2026-0026 各扣款 2392.00 元，现申请退还其中一笔 2392.00 元，原路退回。**

（约 100 字）
```

普通子 Agent 的输入只有 85 个 token,0.0004 元,便宜得多,但它交回的备注里「发票号:缺;金额:缺」。它没编是因为我让它别编,它也确实什么都不知道。fork 的输入 1910 个 token,其中 1664 个命中缓存,0.0014 元,备注里有两张发票号、2392.00 元和原因。

fork 的价格是普通子 Agent 的三倍多,但这笔钱买到的是「不用自己写背景」。经验上,任务边界清楚、背景越少越好的(比如「在这 40 个文件里找出所有调用 `charge()` 的地方」),用普通子 Agent;一句话说不清、需要很多前文的,用 fork。

有一点别忽略:退哪一张发票,fork 这次写的是「退还其中一笔」没有拍板,我早先另一次跑,它直接写了「作废 INV-2026-0123」。两张发票同一天开出,没有任何信息决定该作废哪张,所以这是它自己拍的板,而且两次还不一样。这又是 Day 330 里「动作隐含决定」的老毛病,fork 继承了历史,继承不了「谁有权拍板」。需要拍板的事,不要塞进子 Agent 去办。

## 坑二:子 Agent 再开子 Agent

子 Agent 手里要是也有「开子 Agent」这个工具,会发生什么?每一层都想再派几个,总数是乘法往上涨的。下面这个不调模型的脚本,让每个子 Agent 都想再派 3 个下一层的,看账。

```python
# agent-zero-lab/part05/multi/spawn_toy.py
"""不调模型:子 Agent 一层层往下派活会怎样,以及深度上限和并发上限怎么写。
每个子 Agent 假装花 3000 token、睡 0.05 秒;每个子 Agent 在深度没到上限时再派 FANOUT 个孙子。"""
import asyncio

TOKENS_PER_AGENT = 3000
FANOUT = 3


class Stats:
    def __init__(self) -> None:
        self.agents = 0
        self.running = 0
        self.peak = 0


async def spawn(stats: Stats, depth: int, max_depth: int, sem: asyncio.Semaphore | None = None) -> None:
    """一个子 Agent:干活,然后(没到深度上限时)再派 FANOUT 个下一层。"""
    if sem is not None:
        await sem.acquire()
    stats.agents += 1
    stats.running += 1
    stats.peak = max(stats.peak, stats.running)
    await asyncio.sleep(0.05)  # 假装在调模型
    stats.running -= 1
    if sem is not None:
        sem.release()  # 干完自己的活就放行,再去等孙子
    if depth < max_depth:
        await asyncio.gather(*(spawn(stats, depth + 1, max_depth, sem) for _ in range(FANOUT)))


async def run(max_depth: int, limit: int | None = None) -> Stats:
    stats = Stats()
    sem = asyncio.Semaphore(limit) if limit else None
    await spawn(stats, 1, max_depth, sem)
    return stats


async def main() -> None:
    print("每个子 Agent 都想再派 3 个下一层的子 Agent,深度上限分别设成 1 到 5:")
    print(f"{'最大深度':>8}{'子 Agent 数':>12}{'token':>10}{'约几元':>9}")
    for d in range(1, 6):
        s = await run(d)
        tokens = s.agents * TOKENS_PER_AGENT
        print(f"{d:>8}{s.agents:>12}{tokens:>10}{tokens * 2 / 1_000_000:>9.3f}")
    print("\n并发上限:深度 5 共 121 个子 Agent,同时最多放行 N 个")
    for limit in (None, 20, 5):
        s = await run(5, limit)
        print(f"  上限 {limit or '无':>2}:一共 {s.agents} 个,同一时刻最多 {s.peak} 个在跑")


if __name__ == "__main__":
    asyncio.run(main())
```

<div class="line-notes">

- `import asyncio` 用来并发跑一堆假的子 Agent,`gather` 和 `Semaphore` 都是 [Day 68](/blog/agent-zero/day-068-async-3/) 学的。
- `TOKENS_PER_AGENT = 3000` 假设每个子 Agent 平均花 3000 token,是 Day 330 里单个专员的量级(3210)。
- `FANOUT = 3` 每个子 Agent 想再派 3 个。
- `class Stats:` 一个小计数器:总共开了多少个、同一时刻在跑几个、峰值多少。
- `async def spawn(stats: Stats, depth: int, max_depth: int, sem: asyncio.Semaphore | None = None) -> None:` 一个假子 Agent。`depth` 是自己在第几层,`max_depth` 是深度上限,`sem` 是可选的并发闸门。
- `if sem is not None:` 有闸门才排队。
- `await sem.acquire()` 拿一张「在跑」的票,票用完了就在这里等。`Semaphore(5)` 就是只有 5 张票。
- `stats.peak = max(stats.peak, stats.running)` 每次有人开跑,就更新同一时刻在跑的人数峰值。
- `await asyncio.sleep(0.05)` 假装在调模型,睡 0.05 秒。
- `sem.release()` 干完自己的活立刻还票,再去管孙子。如果等孙子干完才还票,爷爷们占着票等孙子,孙子又拿不到票,整个就死锁了。
- `if depth < max_depth:` 没到深度上限才继续往下派。把这一行去掉,它就一直往下,没有尽头。
- `await asyncio.gather(*(spawn(stats, depth + 1, max_depth, sem) for _ in range(FANOUT)))` 同时派 3 个下一层。这一行是乘法的来源:每层的个数是上一层的 3 倍。
- `async def run(max_depth: int, limit: int | None = None) -> Stats:` 跑一次实验的入口。
- `sem = asyncio.Semaphore(limit) if limit else None` 传了 `limit` 才建闸门。
- `for d in range(1, 6):` 深度上限分别设成 1、2、3、4、5。
- `print(f"{d:>8}{s.agents:>12}{tokens:>10}{tokens * 2 / 1_000_000:>9.3f}")` 约几元按 2 元每百万 token 算,就是 DeepSeek 的未命中输入价,不算输出,是个下限。
- `for limit in (None, 20, 5):` 并发上限分别是不限、20、5。
- `print(f"  上限 {limit or '无':>2}:一共 {s.agents} 个,同一时刻最多 {s.peak} 个在跑")` 深度 5 一共 121 个子 Agent。

</div>

```text
每个子 Agent 都想再派 3 个下一层的子 Agent,深度上限分别设成 1 到 5:
    最大深度   子 Agent 数     token      约几元
       1           1      3000    0.006
       2           4     12000    0.024
       3          13     39000    0.078
       4          40    120000    0.240
       5         121    363000    0.726

并发上限:深度 5 共 121 个子 Agent,同时最多放行 N 个
  上限  无:一共 121 个,同一时刻最多 81 个在跑
  上限 20:一共 121 个,同一时刻最多 20 个在跑
  上限  5:一共 121 个,同一时刻最多 5 个在跑
```

深度上限设成 1,只开 1 个,3000 token;设成 5,开 121 个,36 万 token,约 0.73 元,同一个任务。乘法有个特点:你每次只多放开一层,账单就翻三倍,而且从模型的角度看,每一层子 Agent 都觉得「再派几个帮手」是合理的,没有任何一层会觉得自己在失控。下半部分是并发:不设上限时,同一时刻有 81 个在跑,会同时撞厂商的限速(RPM/TPM,[Day 128](/blog/agent-zero/day-128-rate-limit/) 讲过);加上限 20 或 5,总数一样,只是排队跑。

所以做 subagent 的框架都有这两个限制。我对着 [Claude Agent SDK TypeScript 版的 CHANGELOG](https://github.com/anthropics/claude-agent-sdk-typescript/blob/main/CHANGELOG.md) 核对过(2026 年 10 月 23 日,最新是 0.3.309):0.3.217 版把子 Agent 嵌套深度的默认值从 5 降到 1,也就是默认不允许子 Agent 再开子 Agent,要更深得设环境变量 `CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH`;同一版加了同时运行的子 Agent 数量上限,默认 20,用 `CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS` 改。但 Claude Code 自己的[子 Agent 文档](https://code.claude.com/docs/en/sub-agents)今天写的是「默认最多可以在主对话之下嵌套三层」,设成 1 就关掉嵌套。两份官方资料口径不一样,默认值在不同版本、不同产品里变过,**以你装的版本和当时的文档为准**。我没有在本机实测这两个开关(没有跑 Claude Code 的子 Agent),上面只是 CHANGELOG 和文档的原话摘要。

不管用哪家的框架,自己写子 Agent 时都建议默认关嵌套,需要时再开。练习 1 写一个最小的深度闸门。

## 什么时候不该用多 Agent

今天和前三天的实验加起来,可以把「什么时候不该」收成一张有数据的清单。我自己的做法是,下面任何一条成立,先坚持单 Agent。

**子任务之间有依赖,或者有共同要拍板的决定。** Day 330 里「退哪一张发票」每次运行主管都拍了不同的板,今天 fork 又拍了一次。这类事拆给多个 Agent,每个都会自己定。

**工具结果小。** 子 Agent 的固定开销是多一次往返、多一次转述。拿上面的 `audit_log.build_log` 把日志调小,看看会怎样:

```python
# agent-zero-lab/part05/multi/break_even.py
"""什么时候开子 Agent 不划算:把日志每天的行数从 1 行调到 25 行左右,
同一场四轮对话,分别用 inline 和 subagent 跑,比总花费、主 Agent 的上下文大小和用时。"""
import asyncio

import audit_log
from mini_agent import MISS, OUT
from subagent_demo import TURNS, build_main

SIZES = [("小", (1, 1)), ("中", (4, 6)), ("大", (20, 30))]


async def one(mode: str) -> dict:
    agent = build_main(mode)
    agent.verbose = False
    inv = getattr(agent, "investigator", None)
    if inv is not None:
        inv.verbose = False
    for q in TURNS:
        await agent.say(q)
    cost = agent.usage.cost + (inv.usage.cost if inv else 0)
    prompt = agent.usage.prompt_tokens + (inv.usage.prompt_tokens if inv else 0)
    out = agent.usage.completion_tokens + (inv.usage.completion_tokens if inv else 0)
    nocache = (prompt * MISS + out * OUT) / 1_000_000  # 假设一个 token 都没命中缓存,要花多少
    return {"cost": cost, "nocache": nocache, "context": agent.context_tokens, "first": agent.turns[0]["seconds"],
            "calls": agent.usage.calls + (inv.usage.calls if inv else 0)}


async def main() -> None:
    print(f"{'日志':<4}{'行数':>6}{'做法':>9}{'调用':>5}{'末轮上下文':>11}{'首轮秒':>7}{'总元':>9}{'无缓存元':>10}")
    for label, per_day in SIZES:
        audit_log.LOG = audit_log.build_log(per_day)  # 换一份大小不同的日志,read_audit_log 读的是这个全局变量
        for mode in ("inline", "sub"):
            r = await one(mode)
            print(f"{label:<4}{len(audit_log.LOG):>6}{mode:>9}{r['calls']:>5}{r['context']:>11}"
                  f"{r['first']:>7.1f}{r['cost']:>9.4f}{r['nocache']:>10.4f}")


if __name__ == "__main__":
    asyncio.run(main())
```

<div class="line-notes">

- `import audit_log` 整个模块 import 进来(不是 `from ... import`),因为下面要给 `audit_log.LOG` 重新赋值。
- `from mini_agent import MISS, OUT` Day 330 里解析出来的未命中输入价和输出价,算「无缓存」那一列要用。
- `SIZES = [("小", (1, 1)), ("中", (4, 6)), ("大", (20, 30))]` 三档日志:每天 1 行、4 到 6 行、20 到 30 行。总行数分别是 133(114 天 × 1 + 19 行扣款事件)、591、2925。
- `async def one(mode: str) -> dict:` 用一种做法跑完四轮,返回这场的汇总。
- `agent = build_main(mode)` 复用上一个脚本的造主 Agent 函数。
- `agent.verbose = False` 批量跑,不要过程打印。
- `inv = getattr(agent, "investigator", None)` sub 模式才有调查员。
- `for q in TURNS:` 同样四句客户的话。
- `nocache = (prompt * MISS + out * OUT) / 1_000_000  # 假设一个 token 都没命中缓存,要花多少` 这一列不受缓存影响,拿它来比较才公平。
- `audit_log.LOG = audit_log.build_log(per_day)  # 换一份大小不同的日志,read_audit_log 读的是这个全局变量` 给模块里的全局变量重新赋值,`read_audit_log` 下一次执行时读到的就是新日志。这是为了实验才这么写的,真实代码里别这样改全局变量。
- `for mode in ("inline", "sub"):` 每一档日志,两种做法各跑一场。

</div>

```text
日志      行数       做法   调用      末轮上下文    首轮秒       总元      无缓存元
小      133   inline    6       2286    3.3   0.0086    0.0239
小      133      sub    8       2158    9.8   0.0190    0.0348
中      591   inline    6       3388    3.2   0.0110    0.0325
中      591      sub    8       2006    8.2   0.0187    0.0338
大     2925   inline    6      19319    3.3   0.0098    0.1603
大     2925      sub    8       2132    9.7   0.0414    0.0569
```

读这张表,只看最后一列(无缓存元)。「末轮上下文」是主 Agent 最后一轮的大小,它反映模型实际读了多少日志:模型自己选日期范围,所以「中」那档 inline 只读到 3388 token,不是我能控制的。

- 小:inline 0.0239 元,sub 0.0348 元,sub 贵了 46%,而且首轮慢 6 秒。日志小到主 Agent 的上下文总共才两千多 token,开子 Agent 纯属白花钱。
- 中:0.0325 对 0.0338,打平。上下文里多出三千来个 token 时,开销和收益相互抵消。
- 大:0.1603 对 0.0569,sub 便宜近三倍,主 Agent 的上下文从 1.9 万压到 2.1 千。

「大」那一行的「总元」是 0.0098,比 sub 还低,别被它骗了:这个 1.9 万 token 的开头刚刚在前面几次运行里被 DeepSeek 缓存过,命中价低得离谱。所以「总元」这一列会随你跑实验的节奏上下波动,我前面说 inline 和 sub 总花费来回重叠,就是这个缘故。看缓存无关的那一列才靠谱。

按这几次的数,在这场四轮对话里,工具结果大到主 Agent 上下文多出三五千 token 以上,subagent 才开始划算,对话越长越早打平。这是一场小实验的数,不是定律,你的任务不一样,打平点会在别处。

清单继续:

**只有一两轮就结束。** 子 Agent 的收益是「后面每一轮都不用背」,没有后面就没有收益。

**需要和用户来回确认。** 子 Agent 不面对用户,用户的追问只能经过主 Agent 转述,这正是 Day 331 交接模式要解决的。

**对延迟敏感。** 第 1 轮 3.5 秒变成 9.8 秒。

**没有评测集。** 多 Agent 的协调失败不报错:Day 330 的编造年份、今天的丢证据,都读起来像真的。没有评测,你不知道它哪天坏。

**结论里要保留证据,而你还没设计返回格式。** 今天的坑一。

反过来,这几种情况值得:大块的只读中间过程(翻日志、搜仓库、读网页),并且之后还要继续聊;能拆成互不相干的方向并行查的调研(Day 329 的并行账);多个团队各自维护不同领域的 Agent。

## 动手练习

1. 给「开子 Agent」加一个深度闸门:默认上限 1,主 Agent(第 0 层)可以开子 Agent,子 Agent 不能再开;被拒绝时返回一句让它自己干的话,不抛异常。不调模型,用假的 work 函数演示。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part05/multi/ex332_depth.py
"""练习 1:给「开子 Agent」加深度上限。不调模型,用假的 work 函数演示。"""
import asyncio
from typing import Awaitable, Callable

MAX_DEPTH = 1  # 默认只允许主 Agent 开一层子 Agent,子 Agent 不能再开
Work = Callable[[str, int], Awaitable[str]]
calls: list[str] = []


async def spawn_sub(task: str, depth: int, work: Work) -> str:
    """depth 是「调用者」所在的层:主 Agent 是 0,它开的子 Agent 是 1,以此类推。"""
    if depth >= MAX_DEPTH:
        return f"[拒绝] 你已经是第 {depth} 层,不能再开子 Agent。请自己完成:{task}"
    return await work(task, depth + 1)


async def fake_work(task: str, depth: int) -> str:
    """假子 Agent:先记一笔,再「想」再派一个孙子去干同样的活。"""
    calls.append(f"第 {depth} 层收到:{task}")
    reply = await spawn_sub(task + "(再细查)", depth, fake_work)
    return f"第 {depth} 层的结论(孙子回复:{reply})"


async def main() -> None:
    print(await spawn_sub("查 10 月 8 日的日志", 0, fake_work))
    print("\n".join(calls))
    print("实际开了", len(calls), "个子 Agent")


if __name__ == "__main__":
    asyncio.run(main())
```

<div class="line-notes">

- `from typing import Awaitable, Callable` 类型标注用。`Callable[[str, int], Awaitable[str]]` 读作「接收一个字符串和一个整数、返回(可 await 的)字符串的函数」,相当于 TS 里的 `(task: string, depth: number) => Promise<string>`。
- `MAX_DEPTH = 1  # 默认只允许主 Agent 开一层子 Agent,子 Agent 不能再开` 上限放在一个常量里,以后要改一个地方。
- `Work = Callable[[str, int], Awaitable[str]]` 给上面那串类型起个别名,下面写参数类型时短一点。
- `calls: list[str] = []` 记下每个真正被开出来的子 Agent,最后用它数个数。
- `async def spawn_sub(task: str, depth: int, work: Work) -> str:` 开子 Agent 的唯一入口,所有「想开子 Agent」的地方都得过它。`depth` 是**调用者**所在的层。
- `if depth >= MAX_DEPTH:` 主 Agent 是第 0 层,`0 >= 1` 不成立,放行;子 Agent 是第 1 层,`1 >= 1` 成立,拒绝。
- `return f"[拒绝] 你已经是第 {depth} 层,不能再开子 Agent。请自己完成:{task}"` 拒绝的话是写给**模型**看的,里面带着原任务和「请自己完成」。如果抛异常,整个任务就崩了;返回一段文字,子 Agent 还能自己想办法。这和 Day 330 里「工具报错变成模型能读的文字」是同一个原则。
- `return await work(task, depth + 1)` 放行时,把下一层的层数 +1 传给干活的函数。
- `async def fake_work(task: str, depth: int) -> str:` 假子 Agent,一上来就想再派一个孙子。
- `calls.append(f"第 {depth} 层收到:{task}")` 记一笔:实测只有 `第 1 层收到:查 10 月 8 日的日志`。
- `reply = await spawn_sub(task + "(再细查)", depth, fake_work)` 子 Agent(第 1 层)想再开子 Agent,调用 `spawn_sub` 时传的 `depth` 是自己的层数 1,所以被拒绝。
- `print(await spawn_sub("查 10 月 8 日的日志", 0, fake_work))` 主 Agent 从第 0 层开始,开出第 1 层的子 Agent。

</div>

```text
第 1 层的结论(孙子回复:[拒绝] 你已经是第 1 层,不能再开子 Agent。请自己完成:查 10 月 8 日的日志(再细查))
第 1 层收到:查 10 月 8 日的日志
实际开了 1 个子 Agent
```

只开了 1 个子 Agent,孙子被拒绝,子 Agent 拿到拒绝的话后照样返回了结论。把 `MAX_DEPTH` 改成 2 再跑,`calls` 会变成 2 行。

</details>

2. 让调查员交回**结构化**的证据(JSON,用 pydantic 校验),主 Agent 收到的是排好版的「结论 + 证据列表」。再问第 1 轮和第 3 轮,追问细节时应该能答。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part05/multi/ex332_structured.py
"""练习 2:让调查员交回结构化证据,而不是一句话。证据用 pydantic 校验,主 Agent 收到的是排好版的文本。"""
import asyncio

from pydantic import BaseModel, ValidationError

from mini_agent import MiniAgent
from audit_log import read_audit_log
from subagent_demo import SCHEMA_LOG, TURNS, build_main

SYSTEM = (
    "你是日志调查员。用 read_audit_log 读日志,查清任务里问的事。最后只输出一个 JSON,不要别的文字,格式:"
    '{"conclusion": "一句话结论", "evidence": [{"time": "YYYY-MM-DD HH:MM:SS", "event": "事件名", "ref": "发票号或交易号", "note": "一句话说明"}]}'
    "。evidence 把支撑结论的每一条日志都列出来,不要漏秒级时间。"
)


FENCE = "`" * 3  # 三个反引号,模型爱用它把 JSON 包成 markdown 代码块


class Evidence(BaseModel):
    time: str
    event: str
    ref: str
    note: str


class Report(BaseModel):
    conclusion: str
    evidence: list[Evidence]


def render(raw: str) -> str:
    """校验调查员的 JSON,转成主 Agent 好读的文本;格式不对就把错误原样告诉主 Agent。"""
    text = raw.strip().removeprefix(FENCE + "json").removesuffix(FENCE).strip()
    try:
        rep = Report.model_validate_json(text)
    except ValidationError as e:
        return f"[调查员的报告格式不对] {e.error_count()} 处错误,原文:{raw[:200]}"
    lines = [f"结论:{rep.conclusion}", "证据:"]
    lines += [f"- {ev.time} {ev.event} {ev.ref} {ev.note}" for ev in rep.evidence]
    return "\n".join(lines)


async def main() -> None:
    agent = build_main("sub")
    agent.verbose = False
    investigator = MiniAgent(name="investigator", system=SYSTEM)
    investigator.add_tool(read_audit_log, SCHEMA_LOG)

    async def investigate(task: str) -> str:
        """把一个需要翻大量日志才能回答的问题交给调查员。task 里写清客户编号、日期范围、要查什么。"""
        return render(await investigator.run(task))

    agent.tools.pop("investigate")  # 换掉 build_main 里挂的那个
    agent.add_tool(investigate, {"type": "object", "properties": {"task": {"type": "string"}}, "required": ["task"]})
    for q in (TURNS[0], TURNS[2]):
        print(f"\n客户:{q}\n客服:{await agent.say(q)}")
    print("\n调查员的原始 JSON:\n" + investigator.last_answer)


if __name__ == "__main__":
    asyncio.run(main())
```

<div class="line-notes">

- `from pydantic import BaseModel, ValidationError` [Day 51](/blog/agent-zero/day-051-pydantic-1/)、[Day 52](/blog/agent-zero/day-052-pydantic-2/) 学的 pydantic:用类声明数据的形状,`model_validate_json` 一步完成「解析 JSON + 校验字段」。
- `from mini_agent import MiniAgent` 调查员还是 Day 330 的 `MiniAgent`。
- `from subagent_demo import SCHEMA_LOG, TURNS, build_main` 复用日志工具的 schema、四句客户的话和造主 Agent 的函数。
- `SYSTEM = (` 新的调查员提示词。
- `'{"conclusion": "一句话结论", "evidence": [{"time": "YYYY-MM-DD HH:MM:SS", "event": "事件名", "ref": "发票号或交易号", "note": "一句话说明"}]}'` 把 JSON 的样子直接写给模型看。「只输出一个 JSON,不要别的文字」这句在上面一行。
- `"。evidence 把支撑结论的每一条日志都列出来,不要漏秒级时间。"` 要求证据全列,不要漏时间。
- `FENCE = "`" * 3  # 三个反引号,模型爱用它把 JSON 包成 markdown 代码块` 三个反引号写成 `"`" * 3`,是因为直接写进字符串会和 markdown 的代码围栏撞车。字符串乘整数就是重复,`"ab" * 3` 是 `"ababab"`。
- `class Evidence(BaseModel):` 一条证据:时间、事件名、编号、说明,四个字段都是字符串。
- `class Report(BaseModel):` 整份报告:一句话结论 + 一串证据。`list[Evidence]` 读作「元素都是 Evidence 的列表」。
- `def render(raw: str) -> str:` 把调查员交回的 JSON 校验、转成文本。
- `text = raw.strip().removeprefix(FENCE + "json").removesuffix(FENCE).strip()` 模型有时会把 JSON 包在 ```json 开头、``` 结尾的代码围栏里,这里先剥掉。`removeprefix`、`removesuffix` 是 Python 3.9 起的字符串方法。
- `rep = Report.model_validate_json(text)` 解析并校验。字段缺了、类型不对都会抛 `ValidationError`。
- `return f"[调查员的报告格式不对] {e.error_count()} 处错误,原文:{raw[:200]}"` 格式不对时,把错误数和原文开头原样告诉主 Agent,而不是装作没事。
- `lines = [f"结论:{rep.conclusion}", "证据:"]` 拼成排好版的文本:先一行结论,再一行「证据:」。
- `lines += [f"- {ev.time} {ev.event} {ev.ref} {ev.note}" for ev in rep.evidence]` 每条证据一行,实测第 1 轮这一步一共列了 8 条。
- `investigator = MiniAgent(name="investigator", system=SYSTEM)` 新调查员。
- `return render(await investigator.run(task))` 调查员跑完,先 `render` 再交回。
- `agent.tools.pop("investigate")  # 换掉 build_main 里挂的那个` 主 Agent 的工具表是字典,`pop` 按名字删掉旧的 `investigate`。
- `agent.add_tool(investigate, {"type": "object", "properties": {"task": {"type": "string"}}, "required": ["task"]})` 挂上新的。同名工具,函数换了。
- `print("\n调查员的原始 JSON:\n" + investigator.last_answer)` 把调查员的原始输出也打出来,方便你看它是否真的是合法 JSON。

</div>

```text

客户:我是 user007@example.com。10 月 8 日我被扣了两笔 2392 元,到底怎么回事?
客服:已经查清了,确实是重复扣款。10 月 8 日 09:00:33 网关超时,系统误判为未支付而重新出票(INV-2026-0123),结果原发票 INV-2026-0026 的迟到回调在 09:00:41 也扣款成功,同一笔企业版月付账单被扣了两次 2392 元。

按政策重复扣款会全额退还重复的那一笔 2392 元,3 个工作日内原路退回。需要客服主管审批,我会转交客服主管审批,请留意后续通知。

客户:你前面说有一笔是后来才确认成功的,那条成功通知具体是几点几分几秒收到的?
客服:那笔迟到回调是在 2026-10-08 09:00:41 收到的(INV-2026-0026,late=true,status=succeeded),同一时刻该发票的第二笔 2392 元扣款确认成功。

```

第 3 轮答对了:09:00:41,发票 INV-2026-0026,`late=true`。调查员的原始 JSON 有 8 条证据,从 09:00:01 创建发票一直到 09:00:41 的两条记录,全带着秒。代价是证据多了,主 Agent 上下文里多出几百 token,这是「保留细节」要付的钱,仍然比 1.7 万小得多。

</details>

3. 调查员保持「话少」(默认 30 字内、不写时间),但教主 Agent:客户追问的细节不在结论里时,再派一次,任务里点名要什么。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part05/multi/ex332_reinvestigate.py
"""练习 3:调查员仍然只说一句话(有损),但主 Agent 被教会「细节不在结论里就再派一次」。"""
import asyncio

from subagent_demo import MAIN_SYSTEM, TURNS, build_main

BRIEF = ("你是日志调查员。用 read_audit_log 读日志,找出任务里问的那件事的原因。最后只说结论,控制在 30 个字以内,不要写发票号、金额和时间。"
         "例外:如果任务里明确点名要某个细节(比如某条回调的时间),就把这个细节写进结论,精确到秒。")
EXTRA = ("\n如果客户追问的细节(时间、发票号、金额)不在调查员之前交回的结论里,不要猜,也不要说查不到,"
         "再调用一次 investigate,把客户要的那个细节明确写进 task,并要求调查员返回带秒的时间戳。")


async def main() -> None:
    agent = build_main("sub", investigator_system=BRIEF)
    agent.system = MAIN_SYSTEM + EXTRA  # system 在第一次 say 时才写进 messages,所以现在改还来得及
    agent.investigator.verbose = False  # type: ignore[attr-defined]
    for q in (TURNS[0], TURNS[2]):
        print(f"\n客户:{q}\n客服:{await agent.say(q)}")
    n = sum(1 for m in agent.messages for c in m.get("tool_calls", []) if c["function"]["name"] == "investigate")
    print(f"\n主 Agent 一共调了 {n} 次 investigate")


if __name__ == "__main__":
    asyncio.run(main())
```

<div class="line-notes">

- `from subagent_demo import MAIN_SYSTEM, TURNS, build_main` 这次不从 `subagent_lossy` 里借 `TERSE`,自己定义一个会「让步」的调查员。
- `BRIEF = ("你是日志调查员。用 read_audit_log 读日志,找出任务里问的那件事的原因。最后只说结论,控制在 30 个字以内,不要写发票号、金额和时间。"` 默认话少。
- `"例外:如果任务里明确点名要某个细节(比如某条回调的时间),就把这个细节写进结论,精确到秒。")` 这句例外是整个练习的关键。我第一版没写它,调查员对「不要写时间」执行得很彻底,主 Agent 再怎么追问,它也不肯给,一共派了 3 次(第 1 轮就派了 2 次),第 3 轮追问还是没拿到时间。
- `EXTRA = ("\n如果客户追问的细节(时间、发票号、金额)不在调查员之前交回的结论里,不要猜,也不要说查不到,"` 追加给主 Agent 的提示词。
- `"再调用一次 investigate,把客户要的那个细节明确写进 task,并要求调查员返回带秒的时间戳。")` 教它「再派一次」,并点名要什么。
- `agent.system = MAIN_SYSTEM + EXTRA  # system 在第一次 say 时才写进 messages,所以现在改还来得及` `ChatAgent.say` 第一次调用时才把 `self.system` 放进历史,在这之前改字段是有效的。
- `n = sum(1 for m in agent.messages for c in m.get("tool_calls", []) if c["function"]["name"] == "investigate")` 数历史里有多少次 `investigate` 调用。两层 `for` 的推导式:外层遍历消息,内层遍历这条消息里的工具调用。`m.get("tool_calls", [])` 对没有工具调用的消息返回空列表。

</div>

```text
[main-sub] 调工具:[('find_customer', '{"query": "user007@example.com"}')]
[main-sub] 调工具:[('get_subscription', '{"customer_id": "C007"}'), ('investigate', '{"task": "客户编号 C007（user007@example.com，半岛咖啡）。请核查 2026-10-08 当天该客户的两笔 2392 元扣款：分')]

客户:我是 user007@example.com。10 月 8 日我被扣了两笔 2392 元,到底怎么回事?
客服:查到了：您 10 月 8 日那两笔 2392 元属于同一笔订阅的重复扣款——09:00:03 的扣款请求在网关遇到 30 秒超时（09:00:33），系统误判为未支付，09:00:34 自动重试生成新单 INV-2026-0123 并在 09:00:36 扣款成功；原单 INV-2026-0026 的迟到回调在 09:00:41 也确认扣款成功，两笔均为同一渠道、同金额。

按重复扣款政策，核实后应全额退还多扣的那一笔，3 个工作日内原路退回。退款需要客服主管审批，我会把这一单转交主管处理。
[main-sub] 调工具:[('investigate', '{"task": "客户编号 C007（user007@example.com，半岛咖啡）。请确认 2026-10-08 迟到的扣款成功回调（late=true')]

客户:你前面说有一笔是后来才确认成功的,那条成功通知具体是几点几分几秒收到的?
客服:那条迟到的成功回调是在 09:00:41 收到的（原始扣款发起于 09:00:03）。也就是说，重试扣款先成功，原单的成功通知晚了几秒才到，才出现两笔都成功。

主 Agent 一共调了 2 次 investigate
```

主 Agent 一共调了 2 次 `investigate`:第 1 轮一次,第 3 轮被追问时又一次,任务里点名要「迟到的成功回调的时间」,调查员这次给了 09:00:41。多花了一次往返,换来了没丢的细节。

</details>

4. 把「什么时候不该用多 Agent」的清单写成函数,用 5 个场景当测试,不调模型。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part05/multi/ex332_should_split.py
"""练习 4:把「什么时候不该用多 Agent」的清单写成函数,用 5 个场景当测试。不调模型。"""
from dataclasses import dataclass


@dataclass
class Scenario:
    name: str
    depends_on_previous: bool  # 后一步要用前一步的结果或决定
    big_intermediate: bool     # 中间过程会产生大量只用一次的内容(日志、网页、几十个文件)
    parallel_directions: bool  # 能拆成互不相干的方向同时查
    long_chat: bool            # 之后还要和用户来回聊很多轮
    has_eval: bool             # 有评测集能发现协调失败


def advise(s: Scenario) -> str:
    if s.depends_on_previous:
        return "单 Agent:后一步依赖前一步,拆开会各自拍板"
    if not s.has_eval:
        return "先单 Agent:没有评测集,发现不了多 Agent 的协调失败"
    if s.parallel_directions:
        return "多 Agent 并行:方向互不相干,能省时间"
    if s.big_intermediate and s.long_chat:
        return "subagent:大块中间过程关进子 Agent,只留结论"
    return "单 Agent:拆不拆都没收益,别多花钱"


CASES = [
    (Scenario("写一篇连贯的长文", True, False, False, False, True), "单 Agent"),
    (Scenario("同时调研五家竞品", False, True, True, False, True), "多 Agent 并行"),
    (Scenario("翻三个月日志后接着聊", False, True, False, True, True), "subagent"),
    (Scenario("查一下客户邮箱对应的编号", False, False, False, False, True), "单 Agent"),
    (Scenario("翻日志后接着聊,但没有评测集", False, True, False, True, False), "先单 Agent"),
]

if __name__ == "__main__":
    for sc, expect in CASES:
        got = advise(sc)
        assert got.startswith(expect), f"{sc.name}:期望 {expect},得到 {got}"
        print(f"{sc.name} → {got}")
    print("5 个场景全部通过")
```

<div class="line-notes">

- `from dataclasses import dataclass` [Day 50](/blog/agent-zero/day-050-dataclass/) 学的,用来声明一个纯数据的类。
- `class Scenario:` 一个场景的六个特征,每个都是是/否。字段后面的注释说明什么算「是」。
- `depends_on_previous: bool  # 后一步要用前一步的结果或决定` 清单第一条,权重最高。
- `def advise(s: Scenario) -> str:` 按清单从严到松逐条判断,先命中先返回。
- `if s.depends_on_previous:` 有依赖,直接单 Agent,不看别的。顺序就是优先级。
- `if not s.has_eval:` 没有评测集,先单 Agent。注意它排在「并行」前面:连评测都没有,再能省时间也不建议拆。
- `if s.parallel_directions:` 方向互不相干,多 Agent 并行。
- `if s.big_intermediate and s.long_chat:` 大块中间过程并且还要聊很多轮,subagent。两个条件缺一个都不够,和前面 `break_even` 的数据对得上。
- `return "单 Agent:拆不拆都没收益,别多花钱"` 兜底:什么都不满足就别拆。
- `(Scenario("翻三个月日志后接着聊", False, True, False, True, True), "subagent"),` 五个场景之一,五个字段按顺序是依赖、大块中间过程、并行、长聊、有评测。
- `got = advise(sc)` 跑清单。
- `assert got.startswith(expect), f"{sc.name}:期望 {expect},得到 {got}"` 用 `assert` 当测试:前缀对不上就报错并带上说明。

</div>

```text
写一篇连贯的长文 → 单 Agent:后一步依赖前一步,拆开会各自拍板
同时调研五家竞品 → 多 Agent 并行:方向互不相干,能省时间
翻三个月日志后接着聊 → subagent:大块中间过程关进子 Agent,只留结论
查一下客户邮箱对应的编号 → 单 Agent:拆不拆都没收益,别多花钱
翻日志后接着聊,但没有评测集 → 先单 Agent:没有评测集,发现不了多 Agent 的协调失败
5 个场景全部通过
```

五个场景全部通过。你可以加自己的场景,比如「同时问账务和技术两件互不相干的事」,看清单会给什么建议,再想想它给的合不合理。

</details>

验收标准:`audit_log.py`、`spawn_toy.py`、`ex332_depth.py`、`ex332_should_split.py` 四个不调模型的脚本输出和上面一致;`subagent_demo.py` 的 inline 和 sub 两种模式第 3 轮都能答出 09:00:41,并且 sub 版主 Agent 的上下文在 3000 token 以内;能复现坑一(`subagent_lossy.py` 里主 Agent 说看不到时间戳)并用练习 2 或 3 修好。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| subagent(子 Agent) | 主 Agent 临时开的、用完即弃的 Agent,在自己的上下文里读大量内容,只把结论交回主 Agent |
| 上下文隔离 | 子 Agent 读过的东西不进主 Agent 的 `messages`,主 Agent 的上下文只多一次工具调用和一段结论 |
| inline(今天的叫法) | 主 Agent 自己调工具读大块内容,工具结果直接留在自己的历史里 |
| 有损压缩 | 子 Agent 的结论是对它读过内容的压缩,压缩时丢掉的东西主 Agent 再也看不到 |
| fork(fork 型子 Agent) | 继承主 Agent 全部历史的子 Agent,不用写背景,能命中缓存,但输入不干净 |
| 前缀缓存 | 厂商缓存请求开头相同的部分,命中的输入按低价收费,[Day 124](/blog/agent-zero/day-124-cost/) 讲过 |
| context rot | Anthropic 对「上下文越长,模型对其中信息的召回越差」现象的叫法 |
| 深度上限 | 允许子 Agent 再开子 Agent 的最多层数,默认关掉嵌套最安全 |
| 并发上限 | 同一时刻最多有几个子 Agent 在跑,防止撞厂商限速 |
| `Semaphore`(信号量) | asyncio 里的「票」,有 N 张票就最多 N 个协程同时跑 |
| `deepcopy`(深拷贝) | 连里面嵌套的列表和字典一起复制,改副本不会影响原件,相当于 JS 的 `structuredClone` |
| 继承 | 子类拿到父类所有字段和方法,再加自己的,[Day 42](/blog/agent-zero/day-042-classes-2/) 讲过;`ChatAgent` 继承 `MiniAgent` |
| 审计日志 | 系统按时间顺序记下发生的每个事件,今天的 `read_audit_log` 就是读它 |

## 常见误区

**以为 subagent 一定省钱。** 在有前缀缓存的厂商上,背着 1.7 万 token 聊天,后续每轮只多花一两分钱。今天的实测 inline 和 sub 总花费来回重叠;只有没命中缓存时 sub 才便宜一倍多。省的是上下文的天花板和整洁。

**只看主 Agent 那一行账。** sub 版主 Agent 只花了 0.0089 元,看上去便宜得惊人,子 Agent 另外花了 0.0432 元。多 Agent 的账一定要把每个 Agent 加总。

**让子 Agent 交回的结论越短越好。** 压缩是有损的。我把调查员压到 30 个字,第 3 轮追问到秒的时间,主 Agent 只能说「这个时间戳我这边看不到」。结论里要不要带证据,在调查员的提示词里就要定好。

**没在系统提示词里写今天的日期。** 模型会自己去查 2025 年的日志,什么都找不到。Day 330 的年份坑今天换了个样子又来了一次。

**把拍板的事交给子 Agent。** 我有一次跑 fork,它的备注直接写「作废 INV-2026-0123」,可两张发票同一天开出,数据里没有任何依据。子 Agent 适合「去查一下」,不适合「你来定」。

**子 Agent 里再放「开子 Agent」的工具,却不设上限。** 每层派 3 个,深度 5 就是 121 个、36 万 token。默认关掉嵌套,要开再设深度和并发上限。

**把有缓存时的「总元」当成稳定数字。** 同一个开头刚被缓存过,下一次运行就便宜得离谱,所以我表里「大」那一档 inline 总元只有 0.0098。比较方案请看不受缓存影响的列。

**把没有评测集时的一次成功当成结论。** 今天的每个数字都是单次或几次实跑,会上下浮动,方向可信,精确值不可信。上线前要用评测集跑几十次再看。

## 学习资料

### 文档与文章

- [Claude Code · Subagents](https://code.claude.com/docs/en/sub-agents):官方文档,讲什么时候该开子 Agent、每个子 Agent 的上下文窗口和权限、fork 型子 Agent、嵌套层数的限制。先读开头两节和 fork 那一节,20 分钟。
- [LangChain · Subagents](https://docs.langchain.com/oss/python/langchain/multi-agent/subagents):把子 Agent 当工具的写法,和今天的 `investigate` 对照,看它区分的同步和异步两种调用,15 分钟。
- [Anthropic · Effective context engineering for AI agents](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents):context rot 的出处,也讲了子 Agent 架构怎么把上下文隔离出去,读「sub-agent architectures」那一小节,15 分钟。
- [Anthropic · How we built our multi-agent research system](https://www.anthropic.com/engineering/multi-agent-research-system):Day 329 读过的那篇,今天回头看它怎么给子 Agent 写任务描述、怎么交回结果,10 分钟。
- [Cognition · Don't Build Multi-Agents](https://cognition.ai/blog/dont-build-multi-agents):Day 329 的另一篇,对照「什么时候不该用」那张清单再读一遍,10 分钟。
- [Claude Agent SDK · Subagents](https://platform.claude.com/docs/en/agent-sdk/subagents):SDK 里怎么定义子 Agent、限制它能用的工具,选读。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV16CYe62ET3&autoplay=0&high_quality=1" title="多Agent同时执行,具体争抢哪些资源?上下文和状态怎么隔离?" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>图灵AI大模型 · 多Agent同时执行,具体争抢哪些资源?上下文和状态怎么隔离? · 5 分钟,讲多个 Agent 并发时上下文和状态怎么隔离,和今天「子 Agent 有自己的 messages」对照着看。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/eW3oTyfeWZ0" title="Context Management in Claude Code" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Claude(Anthropic 官方频道)· Context Management in Claude Code · 英文,看它怎么讲上下文被工具结果塞满、子 Agent 怎么把这部分隔离出去。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/A3DKwLORVe4" title="Building with Subagents: Design Decisions" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>LangChain · Building with Subagents: Design Decisions · 英文,讲做子 Agent 时要定的几个设计问题(给它多少背景、交回什么、同步还是异步),正好对应今天的坑一和 fork 的取舍。</figcaption>
</figure>

### 书籍

- Chip Huyen《AI Engineering》(O'Reilly,2025):讲 Agent 的规划、工具和记忆那几章,读的时候想一想子 Agent 的结论算哪一种「记忆」,英文原版。
- Michael Albada《Building Applications with AI Agents》(O'Reilly,2025,副标题 Designing and Implementing Multiagent Systems):整本书围绕多 Agent 系统的设计,选读讲编排模式和取舍的几章,英文原版。

### 开源项目与代码

- [langchain-ai/deepagents](https://github.com/langchain-ai/deepagents):LangChain 做的现成 harness,内置子 Agent,看它怎么在主 Agent 的工具里暴露一个「开子 Agent」的工具、怎么限制子 Agent 的工具,和今天的 `investigate` 对照。
- [anthropics/claude-agent-sdk-typescript](https://github.com/anthropics/claude-agent-sdk-typescript):读它的 CHANGELOG 搜 subagent,能看到嵌套深度、并发上限、fork 这几次改动的来龙去脉。
- 今天的 `part05/multi/` 目录就是一个小开源项目:`mini_agent.py` + `chat_agent.py` 加起来不到 180 行,值得自己重写一遍。

## 自测

1. subagent 和 Day 330 的主管派活,在「出发点」上有什么区别?「用完就扔」指的是什么?

<details><summary>答案</summary>

主管派活的出发点是分工:账务、技术各有提示词和工具,长期存在。subagent 的出发点是隔离上下文:主 Agent 要读一大堆只用一次的东西,临时开一个子 Agent 去读,只交回结论。「用完就扔」指子 Agent 的 `messages`(连同它读过的几万 token)在返回结论后就没人引用了,主 Agent 的上下文里只留一次工具调用和结论。

</details>

2. 同一场四轮对话,inline 版 0.0455 元,sub 版 0.0521 元,sub 版反而略贵,为什么还说它有价值?

<details><summary>答案</summary>

因为有前缀缓存,inline 版后续几轮背着 1.9 万 token 也只按命中价收费,所以钱上几乎没有差别。sub 版省的是上下文:主 Agent 每轮 1.7–2.1 千 token 对 1.9 万,不会被窗口上限卡住,不容易受 context rot 影响。假设没有缓存命中时,sub 版 0.067 元对 inline 版 0.160 元。代价是第 1 轮慢了三倍左右、多了两次模型调用。

</details>

3. 调查员被要求「30 个字以内,不要写时间」,第 3 轮客户追问精确到秒的时间,主 Agent 答不出来。这是什么问题?给两种修法。

<details><summary>答案</summary>

子 Agent 的结论是有损压缩,压缩时丢掉的细节主 Agent 再也拿不到。修法一:在调查员的提示词里要求结论带关键证据(发票号、金额、带秒的时间戳)。修法二:让调查员交回结构化证据清单并用 pydantic 校验。修法三:教主 Agent 在追问细节时再派一次,任务里点名要什么,同时让调查员遇到点名要的细节时破例写出来。

</details>

4. fork 型子 Agent 和普通子 Agent 各适合什么任务?为什么 fork 的系统提示词和工具定义要和主 Agent 完全一样?

<details><summary>答案</summary>

普通子 Agent 从白纸开始,输入干净便宜,适合边界清楚、背景越少越好的任务,如「在 40 个文件里找出所有调用 charge() 的地方」。fork 继承主 Agent 的全部历史,不用写背景,适合一句话说不清、需要很多前文的任务,代价是输入带着主对话的噪音,而且不能把需要拍板的事交给它。系统提示词和工具定义要一致,是因为前缀缓存按请求开头逐 token 比较,开头一模一样才能命中,今天实测 1910 个输入里命中了 1664。

</details>

5. **面试题**:「你们的 Agent 什么时候会开子 Agent?有没有遇到过子 Agent 带来的问题?」怎么回答?

<details><summary>答案</summary>

参考要点:只在一个子任务会产生大块、只读、只用一次的中间内容(翻日志、搜仓库、读网页),并且之后主 Agent 还要继续对话时开,目的是把这些内容隔离在子 Agent 的上下文里,主 Agent 只拿结论。不会在小工具结果或只有一两轮的任务里开,因为那时多一次往返纯属多花钱:我实测日志小的时候 sub 版贵 46% 且慢了 6 秒。遇到过的问题:一是结论有损压缩,追问细节时主 Agent 答不出来,靠要求结论带证据、结构化输出或让主 Agent 追问时再派一次解决;二是子 Agent 嵌套会乘法涨账,所以默认关嵌套并设并发上限;三是 fork 型子 Agent 会替主 Agent 拍板,需要拍板的事不交给子 Agent;四是算账时要把子 Agent 的钱加进去。

</details>

6. 「什么时候不该用多 Agent」,请说出至少四条,并各配一个今天或前三天的证据。

<details><summary>答案</summary>

子任务有依赖或共同拍板的决定(Day 330 主管每次拍不同的发票,今天 fork 又拍了一次);工具结果小(今天日志小档 sub 贵 46%);只有一两轮对话(收益在后续轮次);需要和用户来回确认(Day 331 的交接才适合);对延迟敏感(首轮 3.5 秒变 9.8 秒);没有评测集(编造年份、丢证据都不报错);子 Agent 拍板型的任务。

</details>

## 明天预告

明天是 [Day 333 · 框架横评(一):先分层,同一个任务三种框架](/blog/agent-zero/day-333-frameworks-1/)。这周三天都是自己手写 `MiniAgent`、手拼拓扑,你可能会问:LangChain、OpenAI Agents SDK、Claude Agent SDK 这些现成的东西到底在哪一层、替你省了什么?明天先画一张分层图,再把同一个「查重复扣款」任务分别用三种框架各写一遍,和我们手写的版本放在一起比。
