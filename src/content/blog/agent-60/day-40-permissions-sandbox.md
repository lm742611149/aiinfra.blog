---
title: 'Day 40 · 安全(二):最小权限、沙箱、人工确认与数据脱敏'
description: '给工单 Agent 的每个工具定权限等级,让权限检查发生在代码里而不是 prompt 里;数据库账号也按最小权限拆开;Agent 需要跑代码时放进断网、限资源的沙箱;手机号、身份证号在进模型之前替换成占位符;每次敏感操作写进只能追加的审计表。最后对照 OWASP LLM Top 10 做一次自查。'
pubDate: 2026-10-12
regime: none
tags: ['security', 'least-privilege', 'sandbox', 'pii', 'audit-log', 'owasp', 'agent-60']
series: 'agent-60'
day: 40
lang: 'zh'
---

## 今天要解决的问题

昨天的结论是:假设模型一定会被骗,让它被骗了也干不了坏事。昨天做了几个具体的点:数据范围从登录态来、退款金额在代码里校验、邮件收件人固定。今天把这些零散的点变成一套系统的做法,并补上昨天没碰的几块。

今天结束时你应该能:

1. 给 SupportPilot 的所有工具划分权限等级,写一个工具注册表,让「这个工具在什么情况下能调、要不要审批」由代码统一决定。
2. 把 Agent 用的数据库账号、API 凭证也按最小权限拆开,知道为什么只靠应用层检查不够。
3. 设计一个经得起推敲的人工审批流程:审批人看到什么、谁能批、多久过期、小额能不能自动批。
4. 在 Agent 需要执行代码时,用 Docker 搭一个断网、限内存、限时间的沙箱,并知道托管沙箱服务(如 E2B)解决的是什么问题。
5. 在客户数据进入模型之前做可还原的脱敏,知道这件事和《个人信息保护法》、跨境调用海外模型之间的关系。
6. 建一张只能追加的审计表,并对照 OWASP LLM Top 10 给自己的 Agent 打分。

预计用时 5–6 小时。前置:Day 11(工具设计)、Day 25(审批)、Day 39(注入防御)。

## 先算清楚「过度授权」的账

OWASP LLM Top 10 的第六项叫 Excessive Agency,过度授权。它把问题拆成三种:功能过多(给了 Agent 用不到的工具)、权限过大(工具本身能做的事超出需要)、自主性过高(该人确认的操作没有确认)。

拿 SupportPilot 对一下,很容易就能找出这三种问题的影子。

功能过多:W4 做 MCP server 的时候,为了方便调试,很多人会把「查任意 SQL」「更新客户资料」这类工具也挂上去。上线时忘了摘。

权限过大:退款工具底层用的数据库连接,是开发时那个 `postgres` 超级用户。工具代码里写的是 `INSERT INTO refund_requests`,但这个连接实际上能 `DROP TABLE customers`。如果哪天工具代码里出现了一个 SQL 拼接漏洞,或者被注入影响了某个参数,后果的上限是整个数据库。

自主性过高:「小于 50 元的退款自动批准,省得麻烦主管」。听起来合理,但如果一个攻击者开 100 个账号,每个账号退 49 元呢?

今天的每一节都是在收紧这三样中的一样。

## 工具分级:让权限检查成为代码

我的习惯是把工具分成四级:

| 等级 | 含义 | SupportPilot 里的工具 | 规则 |
| --- | --- | --- | --- |
| L0 只读 | 只读当前客户自己的数据或公开知识 | `search_kb`、`get_customer`、`get_invoice`、`list_subscriptions` | 任何类别的工单都可用 |
| L1 可逆写 | 写操作,但只影响内部状态,随时可撤销 | `add_internal_note`、`set_ticket_tags`、`escalate_to_human` | 可用,写审计日志 |
| L2 敏感写 | 涉及钱、对外发送、或改变客户可见的状态 | `create_refund_request`、`email_customer`、`pause_subscription` | 必须人工审批,写审计日志,有频率上限 |
| L3 禁止 | 不可逆或影响范围大 | 删除账户、改价格、批量操作、任意 SQL | 不注册给 Agent,只能人工在后台操作 |

L3 那一行最重要的不是规则,而是「不注册」。最安全的工具是 Agent 根本看不到的工具。

接下来把这张表变成代码。思路是给每个工具附上元数据,再写一个统一的守卫函数。所有工具调用都必须经过守卫,工具函数本身不需要关心权限:

```python
# agent-60-lab/w6/app/tool_registry.py
from dataclasses import dataclass, field
from enum import IntEnum


class Tier(IntEnum):
    READ = 0
    REVERSIBLE = 1
    SENSITIVE = 2


@dataclass(frozen=True)
class ToolSpec:
    name: str
    tier: Tier
    categories: frozenset[str] = field(default_factory=lambda: frozenset({"*"}))  # 哪些工单类别可用
    per_customer_daily_limit: int | None = None   # 每个客户每天最多调用几次


REGISTRY: dict[str, ToolSpec] = {
    s.name: s
    for s in [
        ToolSpec("search_kb", Tier.READ),
        ToolSpec("get_customer", Tier.READ),
        ToolSpec("get_invoice", Tier.READ),
        ToolSpec("list_subscriptions", Tier.READ),
        ToolSpec("add_internal_note", Tier.REVERSIBLE),
        ToolSpec("set_ticket_tags", Tier.REVERSIBLE),
        ToolSpec("escalate_to_human", Tier.REVERSIBLE),
        ToolSpec("create_refund_request", Tier.SENSITIVE, frozenset({"billing", "refund"}), per_customer_daily_limit=2),
        ToolSpec("email_customer", Tier.SENSITIVE, per_customer_daily_limit=5),
        ToolSpec("pause_subscription", Tier.SENSITIVE, frozenset({"subscription"}), per_customer_daily_limit=1),
    ]
}


class ToolDenied(Exception):
    pass


def tools_for_category(category: str) -> list[str]:
    """给模型看的工具列表:只包含这个类别允许的。按名字排序,对 prompt 缓存友好(Day 38)。"""
    return sorted(
        name for name, s in REGISTRY.items() if "*" in s.categories or category in s.categories
    )


async def guard(name: str, *, category: str, customer_id: str, usage_today: int) -> ToolSpec:
    spec = REGISTRY.get(name)
    if spec is None:
        raise ToolDenied(f"未知工具 {name}")          # 模型幻觉出来的工具名
    if "*" not in spec.categories and category not in spec.categories:
        raise ToolDenied(f"{name} 不适用于 {category} 类工单")
    if spec.per_customer_daily_limit is not None and usage_today >= spec.per_customer_daily_limit:
        raise ToolDenied(f"{name} 今天对该客户的调用次数已达上限")
    return spec
```

这里有两层防护在叠加。`tools_for_category` 决定模型能**看到**哪些工具,这是昨天「先规划后执行」的落地:咨询类工单的工具列表里根本没有退款工具。`guard` 决定模型**调用**时是否放行,它是第二道关:就算模型通过某种方式凭空写出了一个不在列表里的工具名,守卫也会拒绝。两层看起来重复,但它们防的东西不一样。第一层减少模型犯错的机会,第二层保证犯错了也不会执行。

频率上限对付的就是「开 100 个账号每个退 49 元」这种情况的一部分。单个客户每天最多申请两次退款,更多的需要人工。跨账号的批量滥用要靠业务风控(同设备、同支付方式的关联),那已经超出 Agent 的范围了,但你要知道它存在。

`guard` 返回 `spec` 以后,L2 工具走 Day 25 的 interrupt 审批流程,L1 和 L0 直接执行,三者都写审计日志。在 LangGraph 里,最干净的接入方式是自己写工具执行节点,或者用一个包装函数把每个工具包起来,在包装里调 `guard`。

## 最小权限要落到凭证上

工具分级是应用层的检查。应用层的检查依赖代码没有 bug。如果某天有人写了一个新工具,忘了在注册表里登记,或者守卫函数被重构时出了错,应用层就漏了。

所以还要有一层不依赖应用代码的防护:**凭证本身的权限**。Agent 服务连数据库用的账号,只能做 Agent 需要做的事:

```sql
-- agent-60-lab/w6/sql/003_roles.sql
-- Agent 读:只读业务表,不能读内部表(员工、财务配置等)
CREATE ROLE agent_reader LOGIN PASSWORD 'change-me-reader';
GRANT USAGE ON SCHEMA public TO agent_reader;
GRANT SELECT ON customers, subscriptions, invoices, kb_chunks TO agent_reader;

-- Agent 写:只能往这几张表插入,不能更新也不能删除
CREATE ROLE agent_writer LOGIN PASSWORD 'change-me-writer';
GRANT USAGE ON SCHEMA public TO agent_writer;
GRANT SELECT ON invoices, refund_requests TO agent_writer;            -- 退款校验要读
GRANT INSERT ON refund_requests, ticket_notes, audit_log TO agent_writer;
GRANT UPDATE (tags, agent_status, agent_note, updated_at) ON tickets TO agent_writer;  -- 只能改这几列

-- LangGraph checkpoint 用独立的账号和独立的 schema
CREATE ROLE agent_state LOGIN PASSWORD 'change-me-state';
CREATE SCHEMA agent_state AUTHORIZATION agent_state;
```

Postgres 支持把 UPDATE 权限精确到列,`GRANT UPDATE (tags, ...)` 那一行就是这个用法。Agent 能改工单的标签和状态,但改不了工单的客户 id、金额这些字段。

如果你有一个客户 id 字段做多租户隔离,还可以进一步用 Postgres 的行级安全(Row Level Security):每个连接先 `SET app.customer_id = 'cus_1001'`,策略规定只能看到这个客户的行。这样即便工具代码里忘了写 `WHERE customer_id = %s`,数据库也只会返回当前客户的数据。这对 SaaS 产品是很值得做的一层,但配置和调试有一定成本,毕业项目里可以作为加分项。

同样的道理适用于所有外部凭证。MCP server 调用订单系统的 API token,应该是一个只有查询和创建退款申请权限的服务账号,而不是某个管理员的个人 token。邮件服务的 API key,只能用于发送,不能读取收件箱。我见过的真实事故里,有不少是「Agent 用的 key 权限太大」和「这个 key 出现在了日志里」两件事同时发生。

<figure>
<svg viewBox="0 0 640 250" role="img" aria-label="三道权限关卡:模型只看到类别允许的工具;守卫函数检查等级和频率;数据库账号只有最小授权">
<rect x="20" y="30" width="110" height="190" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="75" y="120" text-anchor="middle" font-family="var(--font-mono)" font-size="13" fill="var(--ink)">模型</text>
<text x="75" y="140" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">可能被骗</text>
<rect x="170" y="30" width="130" height="190" rx="6" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="235" y="55" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">关卡 1</text>
<text x="235" y="80" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">按类别给工具</text>
<text x="235" y="98" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">看不到就调不了</text>
<rect x="330" y="30" width="130" height="190" rx="6" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="395" y="55" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">关卡 2</text>
<text x="395" y="80" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">guard()</text>
<text x="395" y="98" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">等级 · 频率</text>
<text x="395" y="116" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">L2 → 人工审批</text>
<rect x="490" y="30" width="130" height="190" rx="6" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="555" y="55" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">关卡 3</text>
<text x="555" y="80" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">数据库 / API</text>
<text x="555" y="98" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">凭证最小授权</text>
<text x="555" y="116" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">不依赖应用代码</text>
<line x1="130" y1="160" x2="170" y2="160" stroke="var(--ink-soft)" stroke-width="1.5"/>
<line x1="300" y1="160" x2="330" y2="160" stroke="var(--ink-soft)" stroke-width="1.5"/>
<line x1="460" y1="160" x2="490" y2="160" stroke="var(--ink-soft)" stroke-width="1.5"/>
<text x="20" y="242" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">越往右越不依赖「代码写对了」,任何一道关卡单独失效,后面的还在</text>
</svg>
<figcaption>三道权限关卡。关卡 1 和 2 在应用代码里,关卡 3 在基础设施里。安全设计的核心思想是纵深防御:不指望任何一层是完美的。</figcaption>
</figure>

## 人工确认:设计一个不会变成橡皮图章的审批

Day 25 让退款停下来等审批,技术上已经通了。但审批流程设计得不好,人工确认就会退化成每天点几百次「批准」的机械动作,形同虚设。几个我认为必须想清楚的问题:

**审批人看到什么。** 昨天说过,不能只给模型写的摘要。审批卡片的每个字段都应该从数据库直接查:客户是谁、注册多久、这张发票的金额和支付时间、这个客户历史退款几次、本次申请金额、工单原文(折叠显示,标明「客户原文,可能包含误导内容」)。模型写的理由可以放,但要标明「Agent 生成」,并放在最后。

**谁能批。** 至少要保证审批人不是发起人。对 Agent 来说发起人是 Agent 本身,看起来没问题。但要注意另一种情况:坐席在对话里引导 Agent 发起退款,再由同一个坐席审批,这就绕过了四眼原则。按金额分级:小额坐席能批,大额要主管。

**多久过期。** 一个挂了三天没人批的退款申请,客户情况可能已经变了(比如已经通过别的渠道退过)。给审批设有效期,比如 48 小时,过期自动作废,工单转人工。恢复审批的任务执行时,也要重新跑一遍 Day 39 的 `check_refund` 校验,不能直接用三天前的结论。

**小额能不能自动批。** 这是一个业务决定,不是技术决定。如果要做,至少满足三个条件:金额阈值低;有每客户、每天的频率上限;有全局的每日总额熔断(比如 Agent 当天自动批准的总额超过 2,000 元就全部转人工审批)。最后这一条经常被忘记,它防的是系统性问题,比如某个 bug 让 Agent 对所有工单都申请退款。

## 沙箱:当 Agent 需要执行代码

客服 Agent 通常不需要执行代码。但 Agent 工程师这个岗位上,你一定会遇到需要的场景:数据分析 Agent 要跑 pandas 处理客户上传的 CSV,Coding Agent 要跑测试,运营让你做一个「用自然语言查报表」的功能,模型写出的 SQL 或 Python 要真的执行。

模型生成的代码要当作不可信代码对待,和执行陌生人发来的脚本一样。最低限度的隔离用 Docker 就能做:

```python
# agent-60-lab/w6/app/sandbox_docker.py
import asyncio
import tempfile
from pathlib import Path

IMAGE = "python:3.12-slim"


async def run_python(code: str, timeout_s: int = 20, files: dict[str, bytes] | None = None) -> dict:
    """在一次性容器里执行一段 Python。断网、只读根文件系统、限 CPU/内存/进程数、非 root。"""
    with tempfile.TemporaryDirectory() as tmp:
        work = Path(tmp)
        work.chmod(0o755)   # TemporaryDirectory 默认 0700,容器里的 nobody 用户读不了
        (work / "main.py").write_text(code, encoding="utf-8")
        for name, data in (files or {}).items():
            (work / Path(name).name).write_bytes(data)   # 只取文件名,防路径穿越
        for f in work.iterdir():
            f.chmod(0o644)

        cmd = [
            "docker", "run", "--rm",
            "--network", "none",               # 断网:代码偷到什么也送不出去
            "--read-only",                     # 根文件系统只读
            "--tmpfs", "/tmp:size=64m",        # 只给一块小的可写临时区
            "--memory", "256m", "--memory-swap", "256m",
            "--cpus", "0.5",
            "--pids-limit", "64",              # 防 fork 炸弹
            "--cap-drop", "ALL",
            "--security-opt", "no-new-privileges",
            "--user", "65534:65534",           # nobody
            "-v", f"{work}:/work:ro",
            "-w", "/work",
            IMAGE, "python", "main.py",
        ]
        proc = await asyncio.create_subprocess_exec(
            *cmd, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE
        )
        try:
            out, err = await asyncio.wait_for(proc.communicate(), timeout=timeout_s)
        except TimeoutError:
            proc.kill()
            return {"ok": False, "error": f"执行超过 {timeout_s} 秒,已终止"}
        return {
            "ok": proc.returncode == 0,
            "exit_code": proc.returncode,
            "stdout": out.decode(errors="replace")[-4000:],   # 只留尾部,防止输出灌爆上下文
            "stderr": err.decode(errors="replace")[-2000:],
        }
```

每个参数挡的东西都不一样,我建议你逐个删掉试试看会发生什么。`--network none` 是最重要的一个,它直接切断了昨天说的致命三要素里的「对外通信」。`--pids-limit` 防的是 `while True: os.fork()` 这种代码。超时那里有个细节:`proc.kill()` 杀的是 `docker` 客户端进程,容器本身可能还在跑。更稳妥的做法是给容器起一个名字,超时后 `docker kill <name>`,或者在容器内用 `timeout` 命令包住 python。这个改进留作练习。

Docker 容器和宿主机共享内核,内核漏洞可以逃逸。对安全要求更高的场景,业界用更强的隔离:gVisor 在用户态实现了一个内核,拦截容器的系统调用;Firecracker 是 AWS 开源的轻量虚拟机,每个沙箱是一台独立的微型虚拟机,启动只要一百多毫秒。

自己运维这些很麻烦,所以出现了托管沙箱服务,E2B 是其中最知名的一家,底层用的就是 Firecracker。用法很简单,官方文档的快速开始是这样的:

```python
# uv add e2b   需要环境变量 E2B_API_KEY
from e2b import Sandbox

sandbox = Sandbox.create()
result = sandbox.commands.run('echo "Hello from E2B Sandbox!"')
print(result.stdout)
```

E2B 按沙箱存活时长计费,有免费额度,付费档是每月 150 美元起(2026 年 10 月查到的第三方汇总,各家说法不一,以官网为准)。成本的大头是沙箱活着的时间,不是代码执行的时间,所以用完要立刻关掉。同类服务还有 Modal、Daytona 等,大的云厂商也在推自己的 Agent 沙箱产品。面试时被问到,能讲清楚「容器共享内核所以隔离弱、微虚拟机隔离强、托管服务省运维但按时长计费」就够了。

## 数据脱敏:客户信息进模型之前

客服工单里充满了个人信息。客户会在工单里写手机号、身份证号(实名认证问题)、银行卡号(退款到账问题)、家庭住址(发票寄送)。这些东西直接发给模型,有三个问题。

第一是合规。《个人信息保护法》要求处理个人信息遵循最小必要原则。如果你调用的是海外模型,数据离开中国境内,还涉及个人信息出境的一整套规定(安全评估、标准合同或认证,视数据量和类型而定)。具体怎么合规是法务的事,但作为工程师你要知道:**很多公司选国内模型,原因不只是网络和价格,还有这个**。如果一定要用海外模型,脱敏能大幅降低风险。

第二是留存。模型厂商会在一定期限内保留 API 请求数据(用于滥用检测等),各家政策不同,企业版通常可以申请零留存。你的 Langfuse 里也存着每一次调用的完整输入输出。手机号在你自己的数据库里是受控的,散落到 trace 系统、日志系统、第三方服务里,就不受控了。

第三是模型其实不需要它们。回答「我的退款到账了吗」,模型不需要知道银行卡号的全部 16 位,知道「尾号 3456 的卡」就够了。

所以做法是**可还原的假名化**:在发给模型之前,把敏感信息替换成占位符,同时保存一张映射表;模型的输出里如果出现占位符,在展示给用户之前换回来。

```python
# agent-60-lab/w6/app/pii.py
import re
from dataclasses import dataclass, field

PHONE = re.compile(r"(?<!\d)1[3-9]\d{9}(?!\d)")
EMAIL = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")
ID_CARD = re.compile(r"(?<![0-9Xx])[1-9]\d{5}(?:19|20)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])\d{3}[\dXx](?![0-9Xx])")
BANK_CARD = re.compile(r"(?<!\d)\d{16,19}(?!\d)")

_ID_WEIGHTS = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2]
_ID_CHECK = "10X98765432"


def valid_id_card(s: str) -> bool:
    """18 位身份证校验位(GB 11643)。正则匹配到的不一定是身份证,校验一下减少误伤。"""
    total = sum(int(c) * w for c, w in zip(s[:17], _ID_WEIGHTS))
    return _ID_CHECK[total % 11] == s[17].upper()


def luhn_ok(s: str) -> bool:
    """银行卡号的 Luhn 校验,避免把订单号之类的长数字误判成卡号。"""
    digits = [int(c) for c in s][::-1]
    total = sum(d if i % 2 == 0 else (d * 2 - 9 if d * 2 > 9 else d * 2) for i, d in enumerate(digits))
    return total % 10 == 0


@dataclass
class Redactor:
    mapping: dict[str, str] = field(default_factory=dict)   # 占位符 → 原文
    _counter: dict[str, int] = field(default_factory=dict)

    def _token(self, kind: str, original: str) -> str:
        for k, v in self.mapping.items():          # 同一个值复用同一个占位符,模型能看出「是同一个号码」
            if v == original:
                return k
        n = self._counter.get(kind, 0) + 1
        self._counter[kind] = n
        tok = f"<{kind}_{n}>"
        self.mapping[tok] = original
        return tok

    def redact(self, text: str) -> str:
        text = ID_CARD.sub(lambda m: self._token("ID", m.group()) if valid_id_card(m.group()) else m.group(), text)
        text = BANK_CARD.sub(
            lambda m: self._token(f"CARD_尾号{m.group()[-4:]}", m.group()) if luhn_ok(m.group()) else m.group(), text
        )
        text = PHONE.sub(lambda m: self._token("PHONE", m.group()), text)
        text = EMAIL.sub(lambda m: self._token("EMAIL", m.group()), text)
        return text

    def restore(self, text: str) -> str:
        for tok, original in self.mapping.items():
            text = text.replace(tok, original)
        return text
```

几个设计上的考虑。

身份证在银行卡之前处理,因为 18 位身份证号也满足「16 到 19 位数字」,顺序反了会被当成卡号。即便如此,身份证号末位如果是数字,它也可能同时通过 Luhn 校验,先处理身份证就避开了这个歧义。

Luhn 校验也不是万能的。一串随机数字碰巧通过 Luhn 的概率是十分之一,所以如果你的订单号恰好也是 16 到 19 位纯数字,每十个里会有一个被误当成卡号。解决办法是利用你自己系统里的格式知识:CloudLedger 的订单号如果都以年份开头、或者都带固定前缀,先把它们识别出来排除掉;也可以要求银行卡号附近出现「卡」「银行」这类关键词才替换。这类规则没有通用答案,要拿你真实的工单数据去调。

银行卡占位符里带了尾号,`<CARD_尾号3456_1>`。这样模型可以自然地说「退款会退回您尾号 3456 的卡」,不需要还原就能直接发给客户。这比「完全遮蔽」更实用,也是银行短信里常见的做法。

`restore` 用在哪?大部分时候你不需要还原,客服回复里本来就不应该出现完整的手机号和身份证号。需要还原的场景是工具调用:模型说「查一下 `<PHONE_1>` 名下的账户」,工具执行前要把占位符换回真实号码去查。所以 `Redactor` 实例要和会话绑定(存在 LangGraph 状态里),在工具执行层调用 `restore` 处理参数。

正则方案的局限要清楚:它只能抓格式固定的东西。「我住在杭州市西湖区某某路 88 号」这样的地址,「我叫王小明」这样的姓名,正则抓不住。需要的话,可以用微软开源的 Presidio 这类框架,它把规则、正则、命名实体识别模型组合起来,支持自定义中文识别器。但识别类方法都有漏检,所以脱敏是降低风险,不是消除风险。

还有一处要记得:**trace 也要脱敏**。如果脱敏在模型调用之前完成,Langfuse 里记录的自然就是占位符版本,这是最省事的。如果有些地方绕过了脱敏直接记日志,Langfuse 的 Python SDK 也提供了 masking 钩子,可以在数据发出去之前再过滤一遍。

## 审计日志:出了事能查清楚

最后一块是审计。上线一段时间后,你一定会遇到这样的问题:「这个客户说我们的 AI 承诺了给他退 500 块,是真的吗?」「上周三那笔错误退款是谁批的?」没有审计日志,你只能去翻散落在各处的应用日志。

审计日志和应用日志不一样:它记录的是「谁在什么时候对什么做了什么」,要求完整、不可篡改、保留时间长。

```sql
-- agent-60-lab/w6/sql/004_audit.sql
CREATE TABLE IF NOT EXISTS audit_log (
    id            BIGSERIAL PRIMARY KEY,
    at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    actor_type    TEXT NOT NULL,          -- agent | human | system
    actor_id      TEXT NOT NULL,          -- 会话 id / 坐席 id
    customer_id   TEXT,
    ticket_id     TEXT,
    action        TEXT NOT NULL,          -- 工具名 或 approve / reject
    tier          SMALLINT,
    args_redacted JSONB,                  -- 脱敏后的参数
    outcome       TEXT NOT NULL,          -- ok | denied | error | pending_approval
    detail        TEXT,
    trace_id      TEXT                    -- 关联到 Langfuse,方便看完整上下文
);

-- 只能追加:Agent 和应用账号都没有 UPDATE / DELETE 权限
REVOKE UPDATE, DELETE, TRUNCATE ON audit_log FROM PUBLIC;
GRANT INSERT ON audit_log TO agent_writer;
GRANT USAGE ON SEQUENCE audit_log_id_seq TO agent_writer;
```

`trace_id` 这一列很有用。审计表只记关键事实,保持小而稳定;想看那一刻模型到底看到了什么、为什么这么决定,顺着 trace_id 去 Langfuse 里找完整上下文。

被 `guard` 拒绝的调用也要记(`outcome = 'denied'`)。正常运行时拒绝次数应该很少,某个客户的会话里突然出现大量拒绝,往往说明有人在试探,值得一个告警。

## 对照 OWASP LLM Top 10 自查

把这两天做的事对照 OWASP 2025 版的十项过一遍。这张表做出来以后,可以直接放进毕业项目的 README,面试时也是很好的素材。

| 编号 | 风险 | SupportPilot 的对策 | 状态 |
| --- | --- | --- | --- |
| LLM01 | Prompt Injection | 四层防御(Day 39);注入测试集进 CI | |
| LLM02 | Sensitive Information Disclosure | 数据范围由登录态决定;PII 脱敏;trace 脱敏 | |
| LLM03 | Supply Chain | 依赖锁版本;第三方 MCP server 审查后才接入;模型来源可信 | |
| LLM04 | Data and Model Poisoning | 知识库文章变更需审核;导入时剥离 HTML 注释等隐藏内容 | |
| LLM05 | Improper Output Handling | 回复净化、链接白名单、前端 CSP;模型生成的代码只在沙箱执行 | |
| LLM06 | Excessive Agency | 工具分级、按类别给工具、L2 审批、L3 不注册、凭证最小权限 | |
| LLM07 | System Prompt Leakage | system prompt 不含任何密钥和敏感规则 | |
| LLM08 | Vector and Embedding Weaknesses | 向量检索按客户/权限过滤;不同租户的私有文档不混在一个无过滤的索引里 | |
| LLM09 | Misinformation | 回复必须带引用;自检节点;评测集里的事实性检查 | |
| LLM10 | Unbounded Consumption | 单轮步数上限、单轮超时(Day 36)、每客户每日 token 预算、全局并发闸门 | |

LLM10 是最容易被当成「性能问题」而忽略的安全问题。一个恶意用户写一段让 Agent 无限循环调工具的输入,或者开很多会话同时刷,账单会在一夜之间爆掉。Day 12 的步数上限、Day 36 的超时、Day 37 的并发控制,加上今天要补的每客户每日 token 预算,一起构成了对它的防御。

## 动手练习

1. 写好 `tool_registry.py`,把你所有的工具登记进去。检查有没有 L3 级别的工具还挂在 Agent 上,有就摘掉。
2. 把 `guard` 接进工具执行路径。写测试:咨询类工单调用退款工具被拒;同一客户当天第 3 次退款被拒;不存在的工具名被拒。
3. 建三个数据库角色,把 Agent 服务的连接串换成 `agent_reader` 和 `agent_writer`。用 `agent_writer` 手动执行一次 `DELETE FROM customers`,确认报权限错误。
4. 实现 `run_python` 沙箱,分别执行这几段代码,记录结果:`import urllib.request; urllib.request.urlopen("https://example.com")`;`open("/etc/passwd").read()`;`while True: pass`;`[0] * 10**9`。把超时后容器残留的问题修好。
5. 实现 `Redactor`,用 10 条包含手机号、邮箱、身份证、银行卡、订单号的测试文本验证。订单号不能被误判成银行卡。
6. 建审计表,让所有工具调用(包括被拒绝的)都写入。
7. 填完 OWASP 自查表的「状态」一列(已做 / 部分 / 未做)。

**验收标准**:第 2、3 步的测试通过;第 4 步四段代码都被挡住或终止,且没有残留容器(`docker ps -a` 检查);第 5 步零误判;能对任意一张工单,从审计表查到它触发的每一次工具调用和审批记录。

| 沙箱测试 | 预期 | 实际 |
| --- | --- | --- |
| 访问网络 | 失败(网络不可达) | |
| 读 /etc/passwd | 能读到容器自己的文件(不是宿主机的) | |
| 死循环 | 超时终止 | |
| 申请大内存 | 被 OOM 终止 | |

## 名词解释

| 名词 | 意思 |
| --- | --- |
| Excessive Agency | OWASP LLM06,过度授权:功能过多、权限过大、自主性过高 |
| 最小权限原则 | 每个组件只拥有完成任务所必需的最小权限 |
| 纵深防御 | 多层相互独立的防护,任何一层失效时其他层仍然有效 |
| 行级安全(RLS) | 数据库按策略限制每个连接能看到哪些行 |
| 四眼原则 | 敏感操作需要发起人以外的另一个人确认 |
| 沙箱 | 隔离执行不可信代码的环境,限制其网络、文件、资源访问 |
| gVisor / Firecracker | 比普通容器更强的隔离技术:用户态内核 / 轻量虚拟机 |
| 假名化 | 用占位符替换个人信息,并保留可还原的映射 |
| 审计日志 | 记录「谁在何时对何物做了何事」的只追加记录 |

## 常见误区

**只在 prompt 里写「不要调用退款工具,除非……」。** 工具能不能调,应该由代码决定。prompt 里的规则是给模型的建议,不是权限控制。

**Agent 服务用超级用户连数据库。** 开发时图方便,上线时忘了换。应用层的检查一旦有漏洞,后果的上限就是整个数据库。

**以为 Docker 就是安全沙箱。** 默认配置的容器能联网、以 root 运行、没有资源限制。要逐项收紧,而且要知道它和宿主机共享内核。

**用正则脱敏就认为数据安全了。** 正则只能抓格式固定的信息,姓名、地址抓不住。脱敏是降低风险,要配合数据范围控制和最小必要原则。

**审批流程只管「批不批」,不管「批的时候看到什么」。** 审批人只看模型写的摘要,注入就能把审批人也骗过去。

**不记录被拒绝的调用。** 拒绝记录是发现攻击和发现 bug 最直接的信号。

## 学习资料

### 文档与文章

- [OWASP · LLM06:2025 Excessive Agency](https://genai.owasp.org/llmrisk/llm062025-excessive-agency/):过度授权的三种来源和缓解措施。今天的工具分级就是对着它设计的。20 分钟。
- [Postgres 文档 · Privileges](https://www.postgresql.org/docs/current/ddl-priv.html):GRANT、REVOKE、列级权限的官方说明。行级安全在同一章节的 Row Security Policies 一节。40 分钟。
- [Docker 文档 · Resource constraints](https://docs.docker.com/engine/containers/resource_constraints/):`--memory`、`--cpus` 这些参数的准确含义。15 分钟。
- [E2B 文档](https://docs.e2b.dev/):托管沙箱的用法,看快速开始和计费说明。15 分钟。[gVisor](https://gvisor.dev/) 和 [Firecracker](https://firecracker-microvm.github.io/) 的首页各看 5 分钟,知道它们是什么。
- [Microsoft Presidio](https://microsoft.github.io/presidio/):开源的 PII 识别和脱敏框架,看架构图和自定义识别器的写法。20 分钟。
- [Langfuse · Masking](https://langfuse.com/docs/observability/features/masking):在 trace 发出之前过滤敏感数据的钩子。10 分钟。
- 《中华人民共和国个人信息保护法》全文([网信办](https://www.cac.gov.cn/2021-08/20/c_1631050028355286.htm)):不用全读,看第一章总则里的最小必要原则(第六条)和第三章个人信息跨境提供的规则(第三十八条起)。30 分钟。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1Toc9etExB&autoplay=0&high_quality=1" title="大语言模型安全[OWASP-Top-10-for-LLMs]-ai安全" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>熊牛逼呀 · 大语言模型安全 [OWASP Top 10 for LLMs] · 12 集共约 2.5 小时,逐项讲 OWASP 十大风险。今天重点看讲敏感信息泄露、过度授权和无限制消耗的那几集,做自查表时对照着看。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/csT16BaTHwY" title="Running AI Agents in Secure Sandboxes with E2B &amp; Docker MCP | Docker’s AI Guide to the Galaxy" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Docker · Running AI Agents in Secure Sandboxes with E2B & Docker MCP · 25 分钟,Docker 官方频道和 E2B 一起讲 Agent 为什么需要沙箱、两种方案怎么配合。看完对容器隔离和微虚拟机隔离的区别会更有体感。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/gUNXZMcd2jU" title="OWASP's Top 10 Ways to Attack LLMs: AI Vulnerabilities Exposed" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>IBM Technology · OWASP's Top 10 Ways to Attack LLMs · 昨天看了前半段,今天看后半段,覆盖过度授权、system prompt 泄露和无限制消耗。</figcaption>
</figure>

### 书籍

- Steve Wilson《The Developer's Playbook for Large Language Model Security》(O'Reilly, 2024):今天读讲过度授权(excessive agency)、信任边界和构建安全流程的章节。1.5 小时。
- Martin Kleppmann《Designing Data-Intensive Applications》第一版第 12 章「The Future of Data Systems」的最后一节「Doing the Right Thing」:讨论数据系统的隐私和责任,和今天的脱敏、审计是同一个话题的更大视角。30 分钟。

### 开源项目与代码

- [e2b-dev/E2B](https://github.com/e2b-dev/E2B):托管沙箱的 SDK 源码,看它的 README 了解 Sandbox 生命周期管理。
- [protectai/llm-guard](https://github.com/protectai/llm-guard):包含 Anonymize(脱敏)和 Deanonymize(还原)两个扫描器,思路和今天的 `Redactor` 一样,可以对照学习它怎么处理更多实体类型。

## 自测

1. 工具已经按类别过滤、只给模型看允许的工具了,为什么还需要 `guard` 再检查一次?

<details><summary>答案</summary>

过滤只是让模型看不到,不能保证模型不调用。模型可能幻觉出一个工具名,或者被注入诱导写出一个不在列表里的工具调用;代码改动也可能让某个路径绕过了过滤。`guard` 在执行前做确定性检查,是第二道独立的关卡。两层防的东西不同:第一层降低犯错概率,第二层保证犯错不执行。

</details>

2. 应用层已经有完整的权限检查,为什么数据库账号也要做最小授权?

<details><summary>答案</summary>

应用层检查依赖代码正确。新增工具忘了登记、重构引入 bug、SQL 拼接漏洞,都可能让应用层检查失效。数据库权限是独立于应用代码的一层,即使应用层漏了,Agent 用的账号也做不了超出授权的操作,后果的上限被限制住了。这就是纵深防御。

</details>

3. 小额退款自动批准,至少要配哪几道保险?

<details><summary>答案</summary>

金额阈值;每客户每天的次数或总额上限;全局每日自动批准总额熔断,超过就全部转人工;恢复执行时重新校验发票状态和可退金额;全部写审计日志并有异常告警。全局熔断最容易被忘,它防的是 bug 或系统性攻击导致的大面积错误退款。

</details>

4. 为什么脱敏时身份证要在银行卡之前处理?银行卡占位符为什么带尾号?

<details><summary>答案</summary>

18 位身份证号也落在「16 到 19 位数字」的范围内,如果末位是数字还可能碰巧通过 Luhn 校验,先处理银行卡就可能把身份证误当成卡号。带尾号是为了让模型能自然地说「退回尾号 3456 的卡」,这句话可以直接发给客户,不需要还原完整卡号,既实用又不泄露。

</details>

5. (面试题)你的 Agent 要执行模型生成的 Python 代码,你会怎么做隔离?

<details><summary>答案</summary>

参考答法:每次执行用一次性环境,执行完销毁。最低限度用 Docker:断网、只读根文件系统加小块 tmpfs、限制内存 CPU 和进程数、去掉所有 capabilities、非 root 用户、执行超时后强制 kill 容器、输出截断。容器和宿主共享内核,安全要求高时换成 gVisor 或 Firecracker 这样的微虚拟机隔离,或者用 E2B 这类托管服务,注意它按存活时长计费,用完立即关闭。另外沙箱里只放这次任务需要的文件,不挂载任何凭证。

</details>

6. (面试题)用海外模型做国内客户的客服 Agent,数据层面你会提醒团队注意什么?

<details><summary>答案</summary>

个人信息出境涉及《个人信息保护法》第三章的规定,需要法务评估走哪条合规路径;技术上做最小必要:发给模型之前对手机号、身份证、银行卡等做可还原的假名化,模型只需要知道尾号等必要信息;确认模型厂商的数据留存政策,能申请零留存的申请;trace 和日志系统也要脱敏,不能让完整的个人信息散落在第三方服务里;评估是否可以把涉及个人信息的环节换成国内模型。

</details>

## 明天预告

Day 41 · 部署上线。安全加固做完,SupportPilot 终于可以离开你的笔记本了。明天写 Dockerfile 和 compose 文件,把 API、worker、Postgres、Redis 编排在一起,处理好密钥,部署到一台云服务器上(国内轻量云和海外平台各给一条路),配上 HTTPS;最后看看什么时候值得用 Ollama 或 vLLM 自己跑开源模型。
