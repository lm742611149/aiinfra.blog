---
title: 'Day 64 · 记忆系统:短期、长期、情景、语义,怎么写、怎么忘'
description: '昨天管的是一次任务里的上下文,今天管跨会话的记忆。先用 CoALA 的分类把「记忆」拆开,再看 mem0、Letta、Zep、LangGraph store 各自怎么解决写入、检索、冲突和遗忘,最后给 SupportPilot 写一个带来源优先级、有效期和删除权的客户记忆,并讲清楚哪些东西绝对不能记。'
pubDate: 2026-10-12
updatedDate: 2026-10-15
regime: none
tags: ['memory', 'mem0', 'letta', 'zep', 'agent-60']
series: 'agent-60'
day: 64
lang: 'zh'
---

## 今天要解决的问题

客户 C007 上周来问过重复扣款,这周又来问「退款到了吗」。如果 SupportPilot 完全不记得上周的事,客户得把情况再讲一遍,体验很差。如果它记得,但记的是客户上周随口说的「我是年付」,而业务系统里他三天前已经降级成月付,那它会按错误的套餐计算退款,更糟。

这就是记忆系统要解决的问题:跨会话地记住有用的东西,而且记对、记得及时更新、该忘的时候忘掉。腾讯那个 Agent 架构师的 JD 里专门写了一条「搭建跨层全局记忆与上下文体系,实现跨对话、跨场景、跨周期的记忆复用」,说明这在资深岗里是一个独立的设计课题。

学完今天你应该能:

1. 用 CoALA 的四类记忆(工作、情景、语义、程序)给一个 Agent 的记忆需求分类。
2. 回答设计记忆系统的四个问题:什么时候写、写什么、谁来写、冲突了听谁的。
3. 说出 mem0、Letta、Zep、LangGraph store 的核心设计差别,知道各自适合什么。
4. 给 SupportPilot 实现一个客户记忆,支持来源优先级、有效期、替代历史和删除。

预计用时 5 小时。前置:Day 20(记忆基础)、Day 48(SupportPilot 多轮与客户画像)、Day 63。

## 先把「记忆」拆开

「Agent 要有记忆」这句话太笼统,不拆开没法设计。2023 年普林斯顿的论文《Cognitive Architectures for Language Agents》(简称 CoALA)借用认知科学的分类,把语言 Agent 的记忆分成四种,现在业界讨论记忆基本都用这套词:

**工作记忆**:当前这一次任务正在用的信息,就是上下文窗口里的东西。昨天 Day 63 管的就是它。

**情景记忆**:发生过的事。「C007 在 9 月 3 日报告了重复扣款,我们提交了退款。」它有时间、有经过,适合用来回答「上次怎么处理的」。

**语义记忆**:关于世界或用户的事实。「C007 是月付基础版」「C007 只接受邮件联系」。它没有时间线,只有当前值。

**程序记忆**:怎么做事。可以是写死在代码和提示词里的流程,也可以是 Agent 从经验里学到的规则,比如「这个客户群体问退款时,先确认是否是年付」。

分清楚以后,设计就清晰多了。SupportPilot 需要的主要是情景记忆(历史工单摘要)和语义记忆(客户画像和偏好)。程序记忆要非常谨慎:让 Agent 自己从对话里学规则并在下次执行,等于让它自己改自己的行为,评测和审计都很难做,我不建议在客服这种有资金操作的场景里开放。

<figure>
<svg viewBox="0 0 640 240" role="img" aria-label="四类记忆:工作记忆在上下文里,情景记忆记发生过的事,语义记忆记事实,程序记忆记做法;SupportPilot 主要用情景和语义两类">
  <rect x="0" y="0" width="640" height="240" fill="var(--paper-raised)"/>
  <g font-family="var(--font-mono)" text-anchor="middle">
    <rect x="230" y="16" width="180" height="50" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
    <text x="320" y="38" font-size="13" fill="var(--ink)">工作记忆</text>
    <text x="320" y="56" font-size="10" fill="var(--ink-soft)">上下文窗口 · Day 63</text>
    <rect x="30" y="120" width="180" height="70" rx="6" fill="var(--compute-wash)" stroke="var(--compute)" stroke-width="2"/>
    <text x="120" y="144" font-size="13" fill="var(--ink)">情景记忆</text>
    <text x="120" y="162" font-size="10" fill="var(--ink-soft)">发生过的事,有时间</text>
    <text x="120" y="178" font-size="10" fill="var(--ink-soft)">「9 月报过重复扣款」</text>
    <rect x="230" y="120" width="180" height="70" rx="6" fill="var(--compute-wash)" stroke="var(--compute)" stroke-width="2"/>
    <text x="320" y="144" font-size="13" fill="var(--ink)">语义记忆</text>
    <text x="320" y="162" font-size="10" fill="var(--ink-soft)">事实,只有当前值</text>
    <text x="320" y="178" font-size="10" fill="var(--ink-soft)">「月付 · 只要邮件」</text>
    <rect x="430" y="120" width="180" height="70" rx="6" fill="var(--paper)" stroke="var(--rule)" stroke-dasharray="4 3"/>
    <text x="520" y="144" font-size="13" fill="var(--ink-faint)">程序记忆</text>
    <text x="520" y="162" font-size="10" fill="var(--ink-faint)">怎么做事</text>
    <text x="520" y="178" font-size="10" fill="var(--ink-faint)">客服场景先不开放</text>
  </g>
  <g stroke="var(--rule)"><line x1="280" y1="66" x2="140" y2="120"/><line x1="320" y1="66" x2="320" y2="120"/><line x1="360" y1="66" x2="500" y2="120"/></g>
  <text x="320" y="222" text-anchor="middle" font-family="var(--font-mono)" font-size="10" fill="var(--ink-faint)">长期记忆按需检索,取回来的部分放进工作记忆</text>
</svg>
<figcaption>CoALA 的四类记忆。加粗框是 SupportPilot 要做的两类,程序记忆因为难评测、难审计,暂不开放。</figcaption>
</figure>

## 设计记忆的四个问题

### 什么时候写

两种时机。**热路径写入**:Agent 在对话中途调用一个「记住这件事」的工具,马上写。好处是下一句话就能用上;坏处是增加了这一轮的延迟和出错可能,而且模型在专心回答问题时,判断「这个值不值得记」往往不太准。**后台写入**:对话结束后,由一个单独的流程读完整段对话,抽取值得记的东西。延迟不影响用户,而且能看到完整上下文再判断。LangGraph 的记忆文档把这两种叫做 hot path 和 background,也讨论了同样的取舍。

客服场景我选后台写入:工单关闭时触发抽取。一张工单内部的信息靠上下文就够了,跨会话的记忆晚几秒写进去没关系。

### 写什么

不是什么都值得记。我的筛选规则是三条:**下次可能用得上**(客户偏好的联系方式,用得上;客户说今天心情不好,用不上);**不能从业务系统直接查到**(套餐类型业务系统里有,记忆里存一份只会制造不一致,应该现查);**不违反隐私规则**(银行卡号、身份证号、密码,永远不进记忆,写入层直接拒绝)。

第二条值得多说一句。很多团队会把「客户是年付」这种业务数据也存进记忆,结果业务系统改了、记忆没改,Agent 拿着过期信息办事。业务事实的权威来源是业务系统,记忆里最多存一份带来源的副本,用的时候以系统为准。下面的实现会体现这一点。

### 谁来写

**Agent 自己写**:Letta(原 MemGPT)的思路。Agent 的上下文里有几块「核心记忆」,它可以通过工具自己编辑,像操作系统管理内存一样决定什么放在上下文、什么换出到外部存储。灵活,但记忆质量取决于模型每一次的判断。

**抽取流程写**:mem0 的思路。一个专门的流程从对话里抽取候选事实,再和已有记忆比对,决定是新增(ADD)、更新(UPDATE)、删除(DELETE)还是不变(NOOP)。可控,容易评测。这是 mem0 论文和早期版本的做法;2026 年 4 月起,mem0 PyPI 页面描述的新算法改成了只追加(ADD-only):一次抽取只新增,不再改写或删除旧记忆,冲突交给检索阶段去挑。两种做法的取舍下面「冲突了听谁的」会讲。

**业务系统写**:最可靠,但只覆盖结构化数据。

SupportPilot 三种都有:业务系统写入的事实优先级最高,客服人工确认的次之,模型从对话里抽取的最低。

### 冲突了听谁的

同一个 key 有了新值,怎么办?常见的三种策略:**新的覆盖旧的**,最简单,但对话里客户随口一句话就能把系统里的正确数据覆盖掉;**按来源优先级**,低优先级不能覆盖高优先级;**保留时间线**,旧值不删,标记为「被某条替代」,需要时能回答「以前是什么、什么时候变的」。Zep 的 Graphiti 引擎就是这个思路,图里每条事实都带有效时间,新事实让旧事实失效但不删除。

我的实现把后两种结合:按来源优先级决定能不能写,写进去以后旧值保留并标记被替代。

### 再加一个:怎么忘

前四个问题大家都会想到,遗忘经常被忘掉。不忘的记忆系统会出三种问题:过期信息误导 Agent(三个月前的「正在处理退款」早就处理完了);记忆越来越多,检索质量下降;用户要求删除个人信息时删不干净。

三种遗忘机制:**有效期**,不同类型的事实设不同的过期时间,「当前问题」30 天,「偏好」不过期;**衰减**,检索打分时越旧的分越低,这个思路来自 2023 年斯坦福的《Generative Agents》论文,它用重要性、新近度、相关性三项给记忆打分;**显式删除**,客户行使删除权时按客户维度全部删除。国内《个人信息保护法》规定个人有权要求删除其个人信息,做 To B 的系统,客户的法务一定会问这一条。

## 四个开源方案对比

| 方案 | 核心思路 | 谁来写 | 冲突处理 | 适合 |
| --- | --- | --- | --- | --- |
| mem0 | 抽取事实写入记忆层 | 抽取流程 | 早期:ADD / UPDATE / DELETE / NOOP;2026-04 起只追加,靠检索挑 | 用户画像、偏好类记忆,接入快 |
| Letta(MemGPT) | 上下文分层,Agent 用工具自己管理核心记忆;主仓库已迁到 letta-code | Agent 自己 | 由 Agent 判断 | 长期陪伴型、需要自主管理记忆的 Agent |
| Zep / Graphiti | 带时间的知识图谱,融合对话和业务数据 | 抽取流程 | 新事实让旧事实失效,保留时间线 | 实体关系复杂、需要时间推理的企业场景 |
| LangGraph store | 按命名空间存 JSON 文档,可语义检索 | 你自己决定 | 你自己写 | 已经用 LangGraph、想完全自己控制 |

我查到的版本(2026 年 10 月):mem0 的 Python 包 `mem0ai` 2.2.1,Letta 的客户端 `letta-client` 1.12.1。注意两处变化:mem0 新算法是只追加,托管平台公布的分数含开源 SDK 里没有的专有优化;Letta 的主仓库已从 `letta-ai/letta` 迁到 `letta-ai/letta-code`(npm 安装的终端工具和 App Server),旧的 V1 API 服务留在 archive 分支,网上按旧仓库写的教程可能跑不通。几家都发过论文或技术报告,而且都说自己在某个基准上赢了别人。mem0 的论文报告在 LOCOMO 基准上,LLM 评审分数比 OpenAI 的记忆功能相对高 26%;Zep 的论文报告在 MemGPT 团队提出的 DMR 基准上 94.8% 对 93.4%,在 LongMemEval 上准确率最多提升 18.5%。这些都是厂商自己测的,基准也不完全相同,看它们的方法设计比看数字更有用。

怎么选?我的建议是:**记忆逻辑和你的业务规则绑得越紧,越应该自己写**。客服场景的来源优先级、有效期、删除权,都是业务规则,用通用框架反而要绕。像个人助理那种「记住用户的一切偏好」的场景,mem0 这类开箱即用的方案更省事。

## 给 SupportPilot 写客户记忆

下面的实现用 SQLite,两百行以内。关键设计:按租户和客户隔离;来源有优先级;每种事实有默认有效期;旧值不删只标记替代;检索按重要性乘以新近度排序;敏感字段写入时直接拒绝;按客户软删除。

```python
# agentops/memory/store.py
"""SupportPilot 客户记忆:带来源、有效期、可撤销的事实存储。"""
from __future__ import annotations

import math
import sqlite3
import time
from dataclasses import dataclass

# 来源优先级:业务系统 > 客服人工确认 > 对话中模型抽取
SOURCE_RANK = {"system": 3, "agent_confirmed": 2, "extracted": 1}
# 不同类型的事实,默认多久后过期(秒)。None 表示不过期,直到被新事实替代。
TTL = {"preference": None, "profile": None, "situation": 30 * 86400, "episode": 180 * 86400}
FORBIDDEN_KEYS = {"card_number", "password", "id_number"}  # 永远不进记忆


@dataclass
class Fact:
    id: int
    customer_id: str
    kind: str
    key: str
    value: str
    source: str
    created_at: float
    expires_at: float | None
    importance: float


class MemoryStore:
    def __init__(self, path: str = ":memory:"):
        self.db = sqlite3.connect(path)
        self.db.execute("""CREATE TABLE IF NOT EXISTS facts(
            id INTEGER PRIMARY KEY, tenant TEXT, customer_id TEXT, kind TEXT, key TEXT, value TEXT,
            source TEXT, created_at REAL, expires_at REAL, importance REAL,
            superseded_by INTEGER, deleted INTEGER DEFAULT 0)""")

    def write(self, tenant: str, customer_id: str, kind: str, key: str, value: str,
              source: str = "extracted", importance: float = 0.5, now: float | None = None) -> str:
        """写入一条事实。返回 ADD / UPDATE / NOOP / REJECT,和 mem0 论文里的更新操作同名。"""
        now = now or time.time()
        if key in FORBIDDEN_KEYS:
            return "REJECT"
        cur = self._current(tenant, customer_id, key, now)
        if cur and cur.value == value:
            return "NOOP"
        if cur and SOURCE_RANK[source] < SOURCE_RANK[cur.source]:
            return "REJECT"  # 对话里抽出来的,不能覆盖业务系统里的
        ttl = TTL.get(kind)
        new_id = self.db.execute(
            "INSERT INTO facts(tenant,customer_id,kind,key,value,source,created_at,expires_at,importance)"
            " VALUES(?,?,?,?,?,?,?,?,?)",
            (tenant, customer_id, kind, key, value, source, now, now + ttl if ttl else None, importance)).lastrowid
        if cur:  # 旧事实不删,标记为被替代,留着做审计和时间线
            self.db.execute("UPDATE facts SET superseded_by=? WHERE id=?", (new_id, cur.id))
            return "UPDATE"
        return "ADD"

    def _current(self, tenant, customer_id, key, now) -> Fact | None:
        row = self.db.execute(
            "SELECT id,customer_id,kind,key,value,source,created_at,expires_at,importance FROM facts"
            " WHERE tenant=? AND customer_id=? AND key=? AND superseded_by IS NULL AND deleted=0"
            " AND (expires_at IS NULL OR expires_at>?) ORDER BY created_at DESC LIMIT 1",
            (tenant, customer_id, key, now)).fetchone()
        return Fact(*row) if row else None

    def recall(self, tenant: str, customer_id: str, k: int = 5, now: float | None = None,
               half_life_days: float = 30) -> list[Fact]:
        """按 重要性 × 新近度 排序取前 k 条。相关性留给调用方用检索再过滤一遍。"""
        now = now or time.time()
        rows = self.db.execute(
            "SELECT id,customer_id,kind,key,value,source,created_at,expires_at,importance FROM facts"
            " WHERE tenant=? AND customer_id=? AND superseded_by IS NULL AND deleted=0"
            " AND (expires_at IS NULL OR expires_at>?)", (tenant, customer_id, now)).fetchall()
        facts = [Fact(*r) for r in rows]
        decay = lambda f: math.exp(-math.log(2) * (now - f.created_at) / (half_life_days * 86400))
        return sorted(facts, key=lambda f: f.importance * decay(f), reverse=True)[:k]

    def forget_customer(self, tenant: str, customer_id: str) -> int:
        """客户要求删除个人信息时调用。软删除后由定时任务物理清除。"""
        return self.db.execute("UPDATE facts SET deleted=1 WHERE tenant=? AND customer_id=?",
                               (tenant, customer_id)).rowcount

    def history(self, tenant: str, customer_id: str, key: str) -> list[tuple[str, str]]:
        return self.db.execute("SELECT value, source FROM facts WHERE tenant=? AND customer_id=? AND key=?"
                               " ORDER BY created_at", (tenant, customer_id, key)).fetchall()
```

用一个时间线跑一遍。注意第 4 行:客户在对话里说自己是「月付基础版」,来源是模型抽取,而当前值来自业务系统,所以被拒绝;第二天业务系统确认他确实降级了,这次来源是系统,更新成功。

```python
# agentops/memory/demo.py
from memory import MemoryStore

DAY = 86400
t0 = 1_790_000_000
m = MemoryStore()
T, C = "cloudledger", "C007"
print(m.write(T, C, "profile", "plan", "年付专业版", source="system", importance=0.9, now=t0))
print(m.write(T, C, "preference", "contact", "只接受邮件,不要打电话", importance=0.8, now=t0))
print(m.write(T, C, "situation", "open_issue", "9 月重复扣款 468 元,已提交退款", importance=0.7, now=t0))
print(m.write(T, C, "profile", "plan", "月付基础版", source="extracted", now=t0 + DAY))   # 对话里客户随口说的
print(m.write(T, C, "profile", "plan", "月付基础版", source="system", now=t0 + 2 * DAY))  # 业务系统确认降级了
print(m.write(T, C, "preference", "card_number", "6222 **** 1234", now=t0 + 2 * DAY))
print("plan 的变化:", m.history(T, C, "plan"))
print("第 3 天能想起:", [(f.key, f.value) for f in m.recall(T, C, now=t0 + 3 * DAY)])
print("第 40 天能想起:", [(f.key, f.value) for f in m.recall(T, C, now=t0 + 40 * DAY)])
print("删除:", m.forget_customer(T, C), "条;之后:", m.recall(T, C, now=t0 + 41 * DAY))
```

本机运行的输出:

```text
ADD
ADD
ADD
REJECT
UPDATE
REJECT
plan 的变化: [('年付专业版', 'system'), ('月付基础版', 'system')]
第 3 天能想起: [('contact', '只接受邮件,不要打电话'), ('open_issue', '9 月重复扣款 468 元,已提交退款'), ('plan', '月付基础版')]
第 40 天能想起: [('contact', '只接受邮件,不要打电话'), ('plan', '月付基础版')]
删除: 4 条;之后: []
```

几点说明。第 40 天时「当前问题」已经过了 30 天有效期,不再被想起;偏好和套餐没有有效期,还在。`history` 能看到套餐的完整变化,而且模型抽取的那条错误值根本没进库(被 REJECT 了),所以历史里只有两条系统来源的记录。删除是软删除,真正的物理删除应该由定时任务在保留期后执行,并且要连同备份一起处理,这一点做合规审计时一定会被问到。

还有一个我故意留下的问题:第二次写 plan 时没有传 `importance`,用了默认值 0.5,所以它排在了最后。真实系统里,重要性应该由写入方按类型给出合理的默认值,而不是每次调用都靠人记得传。这是练习的一部分。

检索这里只用了重要性和新近度。真实使用时还要加相关性:先按当前工单的内容做一次语义检索,把相关的记忆过滤出来,再用这个分数排序。语义检索部分可以直接复用 W3 的 embedding 和 pgvector。

<figure>
<svg viewBox="0 0 640 200" role="img" aria-label="记忆写入流程:工单关闭后抽取候选事实,经过敏感字段过滤、来源优先级判断,结果是新增、更新、不变或拒绝">
  <rect x="0" y="0" width="640" height="200" fill="var(--paper-raised)"/>
  <g font-family="var(--font-mono)" font-size="11" text-anchor="middle">
    <rect x="20" y="70" width="100" height="44" rx="4" fill="var(--paper)" stroke="var(--ink-soft)"/><text x="70" y="90" fill="var(--ink)">工单关闭</text><text x="70" y="106" fill="var(--ink-faint)" font-size="10">后台触发</text>
    <rect x="140" y="70" width="110" height="44" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/><text x="195" y="90" fill="var(--ink)">LLM 抽取</text><text x="195" y="106" fill="var(--ink-faint)" font-size="10">候选事实</text>
    <rect x="270" y="70" width="100" height="44" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/><text x="320" y="90" fill="var(--ink)">敏感字段?</text><text x="320" y="106" fill="var(--ink-faint)" font-size="10">是则拒绝</text>
    <rect x="390" y="70" width="110" height="44" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/><text x="445" y="90" fill="var(--ink)">来源够格?</text><text x="445" y="106" fill="var(--ink-faint)" font-size="10">不能覆盖更高的</text>
    <rect x="520" y="20" width="100" height="30" rx="4" fill="var(--paper)" stroke="var(--mem)"/><text x="570" y="40" fill="var(--ink)">ADD</text>
    <rect x="520" y="60" width="100" height="30" rx="4" fill="var(--paper)" stroke="var(--mem)"/><text x="570" y="80" fill="var(--ink)">UPDATE</text>
    <rect x="520" y="100" width="100" height="30" rx="4" fill="var(--paper)" stroke="var(--rule)"/><text x="570" y="120" fill="var(--ink-faint)">NOOP</text>
    <rect x="520" y="140" width="100" height="30" rx="4" fill="var(--paper)" stroke="var(--compute)"/><text x="570" y="160" fill="var(--compute)">REJECT</text>
  </g>
  <g stroke="var(--ink-faint)" fill="none"><line x1="120" y1="92" x2="140" y2="92"/><line x1="250" y1="92" x2="270" y2="92"/><line x1="370" y1="92" x2="390" y2="92"/><line x1="500" y1="92" x2="520" y2="35"/><line x1="500" y1="92" x2="520" y2="75"/><line x1="500" y1="92" x2="520" y2="115"/><line x1="500" y1="92" x2="520" y2="155"/></g>
</svg>
<figcaption>后台写入的流程。抽取之后的两道检查都是确定性的代码,不靠模型判断,这是记忆系统可评测、可审计的关键。</figcaption>
</figure>

## 记忆系统怎么评测

做了记忆以后,怎么知道它让 Agent 变好了而不是变坏了?可以从三个层次测。

**写入质量**:准备 50 段对话,人工标注每段应该抽出哪些事实,对比抽取结果的准确率和召回率。重点看两类错误:漏记了重要的,以及记了不该记的(尤其是敏感信息)。

**检索质量**:给定一个新工单,应该想起哪几条记忆,看检索的命中情况。和 W3 的检索评测是同一套方法。

**端到端**:同一批多轮场景(上周来过、这周又来),分别在有记忆和无记忆的条件下跑,比较任务成功率、客户需要重复说明的次数、以及「用了过期信息」的错误次数。最后一项最容易被忽视,但它恰恰是记忆系统最危险的失败方式。

## 动手练习

**第一步:分类。** 列出 SupportPilot 一个客户在三个月里可能产生的 15 条信息(偏好、问题、操作、情绪等),按 CoALA 四类分好,并标出每条「记、不记、现查业务系统」。

**第二步:跑通实现。** 把 `memory.py` 放进 `agentops/memory/store.py`,跑出和上面一样的输出。

**第三步:补三个功能。** 一是按 kind 给 importance 设默认值,写入时可覆盖;二是加一个 `recall(query=...)` 参数,先用 embedding 过滤相关记忆再排序;三是写一个后台抽取函数 `extract_facts(ticket_messages) -> list[dict]`,用你的 LLMClient 和 Day 6 的结构化输出实现,输出直接喂给 `write`。

**第四步:评测写入质量。** 造 20 段多轮客服对话(可以用模型生成再人工修改),人工标注应抽取的事实,算出抽取的准确率和召回率,单独统计敏感信息是否全部被拒绝。

**验收标准**:15 条信息分类有理由;三个功能都有单元测试;写入评测有数字;敏感信息拒绝率 100%,做不到就说明原因和补救方案。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| CoALA | 2023 年的论文,提出语言 Agent 的认知架构框架,其中的记忆分类被广泛使用 |
| 工作记忆 | 当前任务正在使用的信息,即上下文窗口 |
| 情景记忆 | 发生过的事件,带时间和经过 |
| 语义记忆 | 关于用户或世界的事实,只关心当前值 |
| 程序记忆 | 关于怎么做事的知识,规则和流程 |
| 热路径写入 | Agent 在对话进行中实时写入记忆 |
| 后台写入 | 对话结束后由独立流程抽取并写入记忆 |
| 软删除 | 先打删除标记、之后再物理清除的删除方式 |

## 常见误区

**把业务数据也存进记忆。** 套餐、余额、订单状态这些业务系统里有的东西,记忆里存一份只会产生不一致。业务事实以系统为准,记忆存的是系统里没有的东西。

**新值总是覆盖旧值。** 客户随口一句话就能把正确的系统数据覆盖掉。写入要看来源,低可信度不能覆盖高可信度。

**只想着怎么记,不想怎么忘。** 过期的「正在处理中」比没有记忆更糟,它会让 Agent 自信地说错话。每种事实都要有有效期或衰减。

**用模型判断要不要拒绝敏感信息。** 敏感字段的拦截必须是确定性的代码规则,模型判断再准也有漏网的时候,而这里漏一次就是合规事故。

**让 Agent 自己学规则并立刻生效。** 程序记忆在客服这类有资金操作的场景里风险很高,行为会在没有评审的情况下改变。要学规则,也应该经过人工审核和评测后再上线。

**只评测「有没有记住」。** 还要评测「有没有用错」。用了过期或错误的记忆,是记忆系统最危险的失败方式。

## 学习资料

### 文档与文章

- [CoALA 论文《Cognitive Architectures for Language Agents》](https://arxiv.org/abs/2309.02427):读第 4 节记忆部分和图 1,今天的分类都来自这里。40 分钟。
- [LangGraph 记忆文档](https://docs.langchain.com/oss/python/langgraph/memory):热路径和后台写入、语义情景程序三类记忆在 LangGraph 里怎么实现,写得很清楚。30 分钟。
- [mem0 论文](https://arxiv.org/abs/2504.19413):重点看抽取和更新两个阶段的设计,ADD/UPDATE/DELETE/NOOP 那张流程图(这是论文版本,新版已改为只追加)。
- [MemGPT 论文](https://arxiv.org/abs/2310.08560):把上下文类比成操作系统内存分层,这个类比本身值得记住。
- [Zep 论文](https://arxiv.org/abs/2501.13956):看 Graphiti 怎么给事实加时间维度。
- [Generative Agents 论文](https://arxiv.org/abs/2304.03442):第 4 节记忆检索的三项打分(新近度、重要性、相关性)。
- [记忆机制综述](https://arxiv.org/abs/2404.13501):想系统了解这个方向可以翻一翻目录,不用全读。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1p2DyB4Ee3&autoplay=0&high_quality=1" title="Agent记忆框架怎么选?5大Agent Memory项目工程级横向对比" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>唐国梁Tommy · Agent记忆框架怎么选?5大Agent Memory项目工程级横向对比,哪一种才是未来Agent记忆的标准答案 · 15 分钟,播放量 6 万多,和今天的对比表互相印证。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/E0k9Ppq6yXY" title="Stateful Agents — Full Workshop with Charles Packer of Letta and MemGPT" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>AI Engineer · Stateful Agents — Full Workshop with Charles Packer of Letta and MemGPT · MemGPT 一作讲有状态 Agent 的设计,前 30 分钟的概念部分最有价值。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/BacJ6sEhqMo" title="The Four Types of Memory Every AI Agent Needs" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>IBM Technology · The Four Types of Memory Every AI Agent Needs · 短视频,用白板讲四类记忆,适合开始之前先看。</figcaption>
</figure>

### 书籍

- Chip Huyen《AI Engineering》(O'Reilly,2025)第 6 章「RAG and Agents」中关于记忆的小节:把记忆和 RAG 放在一起讲,可以看清两者的边界。
- Martin Kleppmann《Designing Data-Intensive Applications》(O'Reilly,2017)第 5 章「Replication」:讲多副本之间的冲突解决,「最后写入者胜」的坑和我们今天的来源优先级是同一类问题。

### 开源项目与代码

- [mem0ai/mem0](https://github.com/mem0ai/mem0) 和 [PyPI 页面](https://pypi.org/project/mem0ai/):看 README 里的架构图,以及 2026 年 4 月新算法改成只追加的说明。
- [letta-ai/letta-code](https://github.com/letta-ai/letta-code):Letta 当前的主仓库。核心记忆块和记忆编辑工具的旧实现在 [letta-ai/letta](https://github.com/letta-ai/letta) 的 archive 分支,想看 MemGPT 原始设计去那里。
- [getzep/graphiti](https://github.com/getzep/graphiti):带时间的知识图谱实现。

## 自测

1. 「客户只接受邮件联系」属于 CoALA 的哪类记忆?「客户 9 月报过重复扣款」呢?

<details><summary>答案</summary>

前者是语义记忆(关于客户的事实,只关心当前值);后者是情景记忆(发生过的事,有时间)。

</details>

2. 为什么不建议把客户的套餐类型存进记忆?

<details><summary>答案</summary>

套餐是业务系统里的权威数据,记忆里存一份会在系统变更后过期,造成不一致。应该在需要时实时查询业务系统。如果一定要存,也要标记来源,并以系统为准。

</details>

3. 热路径写入和后台写入各有什么优缺点?客服场景为什么选后台?

<details><summary>答案</summary>

热路径写入下一句就能用,但增加当轮延迟和出错可能,模型在回答问题时判断记忆价值也不太准。后台写入不影响用户延迟,能看到完整对话再判断,但有几秒到几分钟的延迟。客服场景一张工单内靠上下文就够,跨会话记忆晚一点写入没关系,所以选后台。

</details>

4. 记忆系统需要哪几种遗忘机制?各自解决什么问题?

<details><summary>答案</summary>

有效期(过期信息不再被想起)、衰减(检索时旧信息分数降低,控制记忆膨胀)、显式删除(满足用户删除个人信息的合规要求)。

</details>

5. 为什么敏感信息的拦截要用确定性代码而不是让模型判断?

<details><summary>答案</summary>

模型判断有概率出错,而敏感信息漏进记忆一次就是合规事故,且可能被后续对话泄露。确定性规则可测试、可审计,结果可预期。

</details>

6. 资深面试题:「设计一个跨会话的客户记忆系统,要求不能用错过期信息,并满足用户的删除权。说说你的数据模型和关键流程。」

<details><summary>答案</summary>

要点:数据模型按租户和客户隔离,每条事实有类型、键、值、来源、创建时间、过期时间、重要性、被替代标记、删除标记;写入走后台抽取,经过敏感字段拦截和来源优先级判断,结果是新增、更新、不变或拒绝,旧值保留时间线;业务数据不进记忆或以系统为准;检索按相关性、重要性、新近度综合打分,过期的不返回;删除按客户维度软删除,定时物理清除并覆盖备份,有审计记录。评测要同时测「记住了没有」和「有没有用错」。提到程序记忆的风险和人工审核会加分。

</details>

## 明天预告

Day 65 · 持久化执行:跑几小时的 Agent 怎么不怕重启。记忆解决的是「跨会话记住」,明天解决「一次任务跑到一半,进程挂了怎么办」。我们会讲 durable execution 的原理,对比 Temporal、Restate、DBOS 和 LangGraph checkpoint,讲清楚 Agent 的非确定性给重放带来的麻烦,再自己写一个能断点续跑的长任务。
