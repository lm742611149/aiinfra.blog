---
title: 'Day 88 · W13 复习:AgentOps 平台架构评审'
description: 'W13 收尾。把平台架构、模型网关、MCP 网关、规模化可观测、治理合规、事故响应拼成一份完整的 AgentOps 平台设计文档,用一份 36 项的架构评审清单逐项过一遍,再用模型当评审人做一次预审。最后是这一周的资深面试题和坑清单。'
pubDate: 2026-10-12
regime: none
tags: ['review', 'design-doc', 'architecture-review', 'agentops', 'platform', 'agent-60']
series: 'agent-60'
day: 88
lang: 'zh'
---

## 今天要解决的问题

这一周的六天,每天讲的都是平台的一块:Day 82 的整体架构和多租户,Day 83 的模型网关,Day 84 的工具中心,Day 85 的可观测,Day 86 的治理合规,Day 87 的事故响应。单独看每一块都不难,难的是把它们放在一起时,接口能不能对上、取舍是不是一致、有没有哪个地方两边都以为对方会做。

资深工程师的主要产出物之一就是**设计文档**,而设计文档的价值有一半在评审:让别人在动工之前挑出问题。今天你要做三件事:

1. 写一份完整的 AgentOps 平台设计文档,把这一周的内容拼起来,包括成本估算和风险。
2. 用一份架构评审清单自查,再用模型当评审人做一次预审,把发现的问题补上。
3. 用这一周的资深面试题练习「讲取舍」,把坑清单过一遍。

这份设计文档会是 Day 96 进阶毕业项目开题的底稿,所以值得认真写。预计用时 5–6 小时。

## 一页知识地图

<figure>
<svg viewBox="0 0 640 360" role="img" aria-label="W13 知识地图:中心是 AgentOps 平台,周围是平台架构与多租户、模型网关、工具中心、规模化可观测、治理与合规、事故响应六块,每块标出核心概念">
  <rect x="0" y="0" width="640" height="360" fill="var(--paper-raised)"/>
  <rect x="245" y="150" width="150" height="60" rx="8" fill="var(--mem-wash)" stroke="var(--mem)" stroke-width="2"/>
  <text x="320" y="176" text-anchor="middle" font-family="var(--font-mono)" font-size="13" fill="var(--ink)">AgentOps 平台</text>
  <text x="320" y="194" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">控制面 + 数据面</text>
  <g font-family="var(--font-mono)" font-size="11">
    <rect x="20" y="20" width="190" height="86" rx="6" fill="var(--paper-raised)" stroke="var(--rule)"/>
    <text x="115" y="40" text-anchor="middle" fill="var(--ink)">Day 82 平台与多租户</text>
    <text x="115" y="60" text-anchor="middle" fill="var(--ink-soft)">三个信号 · silo/pool/bridge</text>
    <text x="115" y="76" text-anchor="middle" fill="var(--ink-soft)">RLS 兜底 · 配置快照</text>
    <text x="115" y="92" text-anchor="middle" fill="var(--ink-soft)">代码优先 + 配置管控</text>
    <rect x="225" y="20" width="190" height="86" rx="6" fill="var(--paper-raised)" stroke="var(--rule)"/>
    <text x="320" y="40" text-anchor="middle" fill="var(--ink)">Day 83 模型网关</text>
    <text x="320" y="60" text-anchor="middle" fill="var(--ink-soft)">虚拟 key · token 令牌桶</text>
    <text x="320" y="76" text-anchor="middle" fill="var(--ink-soft)">降级 + 熔断 · 成本归因</text>
    <text x="320" y="92" text-anchor="middle" fill="var(--ink-soft)">供应链安全</text>
    <rect x="430" y="20" width="190" height="86" rx="6" fill="var(--paper-raised)" stroke="var(--rule)"/>
    <text x="525" y="40" text-anchor="middle" fill="var(--ink)">Day 84 工具中心</text>
    <text x="525" y="60" text-anchor="middle" fill="var(--ink-soft)">OAuth 2.1 · CIMD · 受众</text>
    <text x="525" y="76" text-anchor="middle" fill="var(--ink-soft)">禁止透传 · 指纹钉住</text>
    <text x="525" y="92" text-anchor="middle" fill="var(--ink-soft)">风险分级 · 哈希链审计</text>
    <rect x="20" y="254" width="190" height="86" rx="6" fill="var(--paper-raised)" stroke="var(--rule)"/>
    <text x="115" y="274" text-anchor="middle" fill="var(--ink)">Day 85 规模化可观测</text>
    <text x="115" y="294" text-anchor="middle" fill="var(--ink-soft)">traceparent 全链路</text>
    <text x="115" y="310" text-anchor="middle" fill="var(--ink-soft)">尾部采样 · 原文分离</text>
    <text x="115" y="326" text-anchor="middle" fill="var(--ink-soft)">SLO 燃烧速率 · 基数</text>
    <rect x="225" y="254" width="190" height="86" rx="6" fill="var(--paper-raised)" stroke="var(--rule)"/>
    <text x="320" y="274" text-anchor="middle" fill="var(--ink)">Day 86 治理与合规</text>
    <text x="320" y="294" text-anchor="middle" fill="var(--ink-soft)">备案/登记 · 标识 · 出境</text>
    <text x="320" y="310" text-anchor="middle" fill="var(--ink-soft)">数据流图 · 保留期</text>
    <text x="320" y="326" text-anchor="middle" fill="var(--ink-soft)">删除到底 · AI Act</text>
    <rect x="430" y="254" width="190" height="86" rx="6" fill="var(--paper-raised)" stroke="var(--rule)"/>
    <text x="525" y="274" text-anchor="middle" fill="var(--ink)">Day 87 事故响应</text>
    <text x="525" y="294" text-anchor="middle" fill="var(--ink-soft)">六类事故 · 分档开关</text>
    <text x="525" y="310" text-anchor="middle" fill="var(--ink-soft)">行为熔断 · 回放定位</text>
    <text x="525" y="326" text-anchor="middle" fill="var(--ink-soft)">无责复盘 · 坏样本进评测</text>
  </g>
  <g stroke="var(--ink-faint)" stroke-width="1.2">
    <line x1="160" y1="106" x2="270" y2="150"/><line x1="320" y1="106" x2="320" y2="150"/><line x1="480" y1="106" x2="370" y2="150"/>
    <line x1="160" y1="254" x2="270" y2="210"/><line x1="320" y1="254" x2="320" y2="210"/><line x1="480" y1="254" x2="370" y2="210"/>
  </g>
</svg>
<figcaption>W13 的六块内容。上面三块是数据面的主要组件,下面三块是贯穿整个平台的横向能力。评审时最常出问题的,是上下两排之间的接缝:比如网关的用量日志是不是带了治理需要的「最终用户」维度,工具中心的审计是不是满足日志留存要求。</figcaption>
</figure>

如果你只能记住这一周的一句话:**平台的价值在于把每个 Agent 都需要、而且做错了代价很大的东西集中做对**,其余都是这句话的展开。

## AgentOps 平台设计文档

下面是设计文档的结构和每一节该写什么。我把它写成模板加要点的形式,你要做的是用这一周学到的内容和自己的判断把它填满。好的设计文档有一个共同特点:**取舍写得比方案多**。只写「我们用 LiteLLM」的文档没有信息量,写清楚「为什么不自己写、什么情况下会换掉它」的才有。

```markdown
# AgentOps 平台设计文档 v0.1

作者 / 评审人 / 状态(草稿、评审中、已批准)/ 最后更新

## 1. 背景
现在有哪些 Agent、哪些团队;重复建设和事故带来了什么具体问题(带数字)。

## 2. 目标与非目标
目标:3–5 条,每条可衡量。例如「90% 的模型调用经过网关」「每月成本归因误差 < 2%」。
非目标:至少 3 条。例如「不提供可视化搭建界面」「不替业务方写提示词」。

## 3. 用户与场景
内部业务团队(写代码的)、运营同学(用 Dify 的)、值班工程师、安全与法务。
每类用户最常做的三件事。

## 4. 总体架构
控制面组件清单、数据面组件清单、两者之间怎么同步配置、控制面不可用时会怎样。
一张架构图。

## 5. 多租户
租户模型(几层、谁是租户);默认部署模式与 silo 的条件;
数据库、向量库、缓存、trace、评测集五处各自的隔离方式;隔离怎么测试。

## 6. 模型网关
选型与理由(以及什么情况下推翻);限流(按 token、预扣结算);预算(软硬上限);
路由与降级(哪些错误降级、熔断、流式的限制、降级目标进评测);成本归因与对账;
供应链安全(锁版本、签名校验)。

## 7. 工具中心
授权流程(按当前 MCP 规范版本);不透传令牌;注册中心字段;指纹钉住;
授权模型(租户、角色、工具、风险);人工审批;审计(摘要、哈希链、锚定)。

## 8. 运行时
复用 W10 的 harness 与持久化执行;Agent 定义的配置与代码边界;灰度发布。

## 9. 可观测
链路贯通方式;采样规则;原文与元数据两路与各自保留期;核心指标;SLO 与告警;
平台自身的 SLO。

## 10. 治理与合规
数据流图;数据分级与保留期表;删除流程与回执;备案、标识、出境的处理方式;
对外安全问卷的标准答案在哪里维护。

## 11. 事故响应
紧急开关的档位与生效方式;行为熔断的指标与阈值;值班与升级;复盘流程。

## 12. 成本估算
平台自身的基础设施成本 + 观测存储 + 人力;与「不做平台」的对比。

## 13. 上线计划
分几期;第一期接哪两个团队;迁移方式;成功的判断标准。

## 14. 风险与待定问题
主要风险、缓解措施;还没想清楚、需要评审会讨论的问题。
```

### 成本估算怎么写

很多设计文档在成本这一节写得很空,「成本可控」这种话对评审人没有任何帮助。给一个算式,哪怕粗糙:

```text
假设:每天 100 万次 Agent 运行,平均每次模型成本 $0.006(Day 38 的退款工单算式)

模型费用(平台不改变,但要能归因):  1,000,000 × 0.006 = $6,000/天
网关:无状态实例 + Redis,按峰值 QPS 2,000 估 6 个实例 + 一个小 Redis 集群
观测存储:采样前元数据 30 GB/天、原文 100 GB/天(Day 85)
        尾部采样留 10% 后,原文 10 GB/天 × 30 天 = 300 GB,元数据 3 GB/天 × 180 天 = 540 GB
平台团队:3–4 人

收益(写成可以核对的口径):
- 网关的降级避免的停服时间(去年供应商故障 N 次、合计 M 小时)
- 预算拦截避免的超支(去年最大一次超支多少)
- 合规:能回答安全问卷,不需要每个团队各自准备
- 重复建设:N 个团队各自维护网关、观测、审计的人力
```

具体的基础设施价格随云厂商和地区差别很大,你在文档里填自己公司的实际单价。重点是让评审人看到你**知道钱花在哪、量级是多少、和不做相比值不值**。

## 架构评审清单

下面这份清单是我按这一周的内容整理的,一共 36 项。评审前先自己逐项过一遍,每一项回答「文档里写了吗、写在哪一节」。标星号的是我认为必须有的,缺了就不应该进入评审会。

**平台与多租户**

1. ★ 写清了什么时候、为什么要做平台,有具体数字。
2. ★ 租户模型:谁是租户、几层、默认 pool 还是 silo、silo 的条件。
3. ★ 数据库、向量库、缓存、trace、评测集五处的租户隔离方式。
4. 有自动化的租户隔离测试(RLS、缓存键、检索过滤)。
5. ★ 控制面和数据面分开;控制面不可用时数据面能继续服务。
6. Agent 定义中哪些是配置、哪些是代码,边界清楚。
7. 平台给业务方留了逃生口(透传供应商特有参数等)。

**模型网关**

8. ★ 选型有理由,也写了推翻条件。
9. ★ 按 token 限流,说明了预扣和结算;多实例下状态放共享存储并保证原子。
10. ★ 降级只针对可恢复错误;有熔断;流式只在首包前降级。
11. ★ 降级目标进了回归评测。
12. 预算有软硬上限,超预算降级到便宜模型是显式的产品决策。
13. 成本归因的维度、价格表版本、月度对账方法。
14. ★ 网关依赖锁版本、镜像校验签名,机器上没有无关凭证。

**工具中心**

15. ★ 授权流程基于当前 MCP 规范版本,写明版本号。
16. ★ 不透传用户令牌;网关用自己的身份调用下游并传递「代表谁」。
17. 如果网关是 OAuth 代理,实现了按客户端的同意以防混淆代理。
18. ★ 工具注册中心的字段;工具定义指纹钉住,变化后自动停用。
19. ★ 授权模型包含租户、角色、工具、风险;写操作要求人类身份;危险操作要审批。
20. 审计日志存参数摘要,有哈希链并定期锚定。
21. 新 MCP server 的接入审核流程和定期复审。

**可观测**

22. ★ trace 贯穿运行时、网关、工具中心。
23. ★ 尾部采样规则;长任务和多实例的处理方式。
24. ★ 原文和元数据分开,各自的保留期和访问权限。
25. 核心指标清单,以及标签基数的控制原则。
26. ★ 基于 SLO 的燃烧速率告警;成本异常告警;质量告警。
27. 平台自身有 SLO,并且比业务 Agent 更严。

**治理与合规**

28. ★ 数据流图,覆盖评测集、缓存、备份、第三方。
29. ★ 数据分级和每类数据的保留期表。
30. ★ 删除流程覆盖所有登记的存储,有回执。
31. 面向公众服务的备案、登记、标识要求怎么满足;出境怎么控制和统计。
32. 安全问卷标准答案的维护位置。

**事故响应**

33. ★ 分档紧急开关,在数据面本地生效,只能自动收紧。
34. 行为熔断的指标和阈值,阈值的依据。
35. 值班手册、升级路径、对外沟通口径。
36. ★ 复盘流程,以及「事故坏样本进评测集」的机制。

## 用模型做一次预审

人工评审会很贵,一屋子资深工程师坐一个小时。在约评审会之前,可以先用模型做一次预审,把明显的遗漏补上,让评审会把时间花在真正需要讨论的取舍上。下面这个脚本把设计文档和清单交给模型,让它逐项判断覆盖情况,必须项有缺失就返回非零退出码,可以接到 CI 里,文档提交时自动跑:

```python
# agent-60-lab/w13/review/review_doc.py
# 用模型当一个「不客气的评审人」,按清单逐项检查设计文档。
# 用法: uv run python review_doc.py design.md
import json
import os
import sys

from openai import OpenAI

# (编号, 是否必须, 检查项)。完整清单见正文「架构评审清单」,这里挑了一部分
CHECKLIST = [
    ("T1", True, "写清了租户是谁、几层,默认 pool 还是 silo,哪些租户需要 silo 以及原因"),
    ("T2", True, "说明了数据库、向量库、缓存、trace、评测集五处的租户隔离方式"),
    ("G1", True, "模型网关按 token 限流,并说明了预扣和结算"),
    ("G2", True, "说明了哪些错误降级、哪些不降级,以及降级目标是否进了评测"),
    ("G3", False, "成本归因的维度和月度对账方法"),
    ("M1", True, "工具调用不透传用户令牌,网关用自己的身份调下游"),
    ("M2", True, "工具定义有指纹钉住,变化后自动停用"),
    ("O1", True, "有尾部采样规则,原文和元数据分开保留"),
    ("O2", True, "有基于 SLO 的燃烧速率告警和成本异常告警"),
    ("C1", True, "有数据流图、数据分级、每类数据的保留期"),
    ("C2", True, "删除请求覆盖所有存储,包括评测集和第三方观测平台"),
    ("I1", True, "有分档紧急开关,说明了在控制面不可用时是否仍能生效"),
    ("P1", False, "给出了平台自身的 SLO,并且比业务 Agent 更严"),
    ("R1", False, "列出了主要风险和非目标"),
]

PROMPT = """你是一位挑剔的资深架构评审人。下面是一份平台设计文档和一份检查清单。
对清单里的每一项,判断文档的覆盖情况:covered(写清楚了)、partial(提到但不完整)、missing(没写)。
evidence 字段引用文档里的原话(不超过 40 字);如果是 missing,写你认为应该补充什么。
只输出 JSON:{"items": [{"id": "T1", "status": "covered|partial|missing", "evidence": "..."}]}

检查清单:
%s

设计文档:
<doc>
%s
</doc>"""


def build_prompt(doc: str) -> str:
    lines = "\n".join(f"{cid}: {text}" for cid, _, text in CHECKLIST)
    return PROMPT % (lines, doc)


def parse(raw: str) -> dict[str, dict]:
    """只认清单里有的编号,只认三种状态。模型漏掉的项一律当 missing。"""
    items = {i["id"]: i for i in json.loads(raw).get("items", [])
             if i.get("status") in ("covered", "partial", "missing")}
    return {cid: items.get(cid, {"id": cid, "status": "missing", "evidence": "(评审未返回)"})
            for cid, _, _ in CHECKLIST}


def gate(results: dict[str, dict]) -> list[str]:
    """必须项里有 missing 的,返回它们的编号;为空表示可以进入人工评审。"""
    return [cid for cid, must, _ in CHECKLIST if must and results[cid]["status"] == "missing"]


def to_markdown(results: dict[str, dict]) -> str:
    rows = ["| 编号 | 必须 | 状态 | 依据或建议 |", "| --- | --- | --- | --- |"]
    for cid, must, _ in CHECKLIST:
        r = results[cid]
        rows.append(f"| {cid} | {'是' if must else ''} | {r['status']} | {r['evidence']} |")
    return "\n".join(rows)


def main(path: str) -> int:
    doc = open(path, encoding="utf-8").read()
    client = OpenAI(base_url=os.environ["LLM_BASE_URL"], api_key=os.environ["LLM_API_KEY"])
    resp = client.chat.completions.create(
        model=os.environ["LLM_MODEL"],
        response_format={"type": "json_object"},
        messages=[{"role": "user", "content": build_prompt(doc)}],
    )
    results = parse(resp.choices[0].message.content)
    print(to_markdown(results))
    blocking = gate(results)
    if blocking:
        print(f"\n必须项缺失:{', '.join(blocking)}。补完再约人工评审。")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1]))
```

测试只覆盖不依赖模型的部分(解析、门禁、输出格式),确保模型返回了奇怪的东西时脚本的行为是可控的:

```python
# agent-60-lab/w13/review/test_review_doc.py
import json

from review_doc import CHECKLIST, build_prompt, gate, parse, to_markdown


def test_unknown_ids_and_missing_items_are_handled():
    raw = json.dumps({"items": [
        {"id": "T1", "status": "covered", "evidence": "默认 pool"},
        {"id": "ZZ", "status": "covered", "evidence": "模型编出来的编号"},
        {"id": "G1", "status": "great", "evidence": "非法状态"},
    ]})
    r = parse(raw)
    assert set(r) == {cid for cid, _, _ in CHECKLIST}
    assert r["T1"]["status"] == "covered"
    assert r["G1"]["status"] == "missing"          # 非法状态按缺失处理


def test_gate_only_blocks_on_required_items():
    r = parse(json.dumps({"items": [{"id": cid, "status": "covered", "evidence": "x"} for cid, _, _ in CHECKLIST]}))
    assert gate(r) == []
    r["P1"]["status"] = "missing"                  # 非必须项缺失不拦
    assert gate(r) == []
    r["M1"]["status"] = "missing"
    assert gate(r) == ["M1"]
    assert "| M1 | 是 | missing |" in to_markdown(r)


def test_prompt_contains_every_item():
    p = build_prompt("文档正文")
    assert all(cid in p for cid, _, _ in CHECKLIST) and "<doc>" in p
```

运行 `uv run pytest -q w13/review`,我本机是 `3 passed`。接真实模型跑的时候,`LLM_MODEL` 用你常用的那个。

要清醒地认识到,模型预审只能发现「有没有写」,很难判断「写得对不对」:它会把「我们用 RLS 做租户隔离」判成 covered,但不会发现你的策略漏了 `WITH CHECK`。所以它是评审会的前置过滤,不是替代。另外,它自己也会出错,我在 `parse` 里把模型漏掉或者编造的项都当作 missing 处理,宁可多报,不要漏报。

## 评审会怎么开

设计文档写完,预审过了,就可以约评审会。几条经验:

- **提前两天发文档**,要求参会人会前读完并在文档里留评论。会上只讨论评论里有分歧的点,不要在会上从头读文档。
- **请对的人**:至少一位做过类似系统的资深工程师、一位安全、一位将要接入的业务团队代表。业务方代表最容易被漏掉,但他们最清楚平台好不好用。
- **把待定问题写在文档最后**,会上集中讨论。评审会最有价值的产出,是这些问题的结论和理由,要记录下来,写进文档或者架构决策记录(ADR)。
- **区分「必须改」和「建议」**。评审意见很多时,作者需要知道哪些是阻塞上线的。
- **评审的对象是方案,不是人。** 和无责复盘是一个道理。

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1TT421k7Y3&autoplay=0&high_quality=1" title="大厂内部技术方案评审，如何避免过度设计" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>极海Channel · 大厂内部技术方案评审,如何避免过度设计 · 7 分钟。讲技术方案评审里最常见的问题:过度设计。平台类项目尤其容易犯,正好呼应 Day 82 说的「最薄可用平台」。</figcaption>
</figure>

## W13 资深面试题汇总

这一周每天的最后一道自测题都是资深面试题,这里再补几道综合性的。回答时注意三点:先问清约束和规模,再给方案;每个关键决定都说取舍;说清楚怎么验证和怎么演进。

1. 设计一个服务全公司的 Agent 平台,你会先做哪个组件,为什么?

<details><summary>答案要点</summary>

先做模型网关:接入成本最低(改 base_url),收益立刻可见(按团队分账、统一限流、故障切换、真实 key 收口),而且它是之后治理(合规路由)、可观测(用量和成本)的基础。工具中心第二,因为它解决的是安全问题,但接入需要改 Agent 的工具调用方式,成本更高。可观测和治理是横向能力,随着前两者建设逐步落地。不先做可视化搭建界面和统一 DSL。

</details>

2. 多租户 Agent 平台里,哪些地方最容易发生租户数据串漏?怎么系统性地防?

<details><summary>答案要点</summary>

数据库查询漏租户条件、向量检索没有租户过滤、网关或语义缓存的缓存键缺租户、长期记忆串用户、评测集里混着各租户的真实数据、trace 后端的访问权限全员共享。系统性的防法:所有数据访问走统一的数据访问层,租户从鉴权上下文注入;数据库层 RLS 兜底且默认拒绝;缓存键强制包含租户;自动化隔离测试进 CI;评测集入库前脱敏;trace 后端按租户授权并审计访问。

</details>

3. 你的模型网关在供应商故障时自动降级到备用模型,结果客户投诉回复质量下降。复盘时你会提出什么改进?

<details><summary>答案要点</summary>

降级目标必须进回归评测,并定期跑,确认质量在可接受范围;对质量要求高的任务,宁可降级到「转人工」而不是降级到差很多的模型,也就是降级链里可以有「人工」这一级;响应头和 trace 里标明实际用的模型,方便统计降级期间的质量;降级期间触发质量告警的阈值单独设置;和业务方事先约定降级策略,而不是平台单方面决定。

</details>

4. 安全团队要求「所有 Agent 的工具调用都要能追溯到具体的人」。后台批处理的 Agent 怎么办?

<details><summary>答案要点</summary>

后台 Agent 没有在线用户,但它的运行是某个人或某个系统发起和授权的。做法:后台 Agent 只开读工具;需要写操作的批处理,由发起人用自己的身份提交任务,任务记录「代表谁」,工具中心据此授权并审计;或者设计成 Agent 只生成待执行的操作清单,由人批量审批后执行。审计里要能从每一次写操作追溯到批准它的人。

</details>

5. 你怎么判断一个 Agent 平台「做成功了」?

<details><summary>答案要点</summary>

看业务方是否主动使用和受益,而不是平台功能有多少:接入的团队数和模型调用覆盖率;新 Agent 从零到上线的时间是否缩短;事故中「系统先发现」的比例、平均止血时间;成本归因准确率和预算超支次数;安全问卷和合规审查的准备时间;平台自身的 SLO 达成情况;业务团队的满意度(定期调研)。如果平台团队成了瓶颈(所有改动都要排队),说明边界划错了。

</details>

## W13 坑清单

这一周最容易踩的坑,按我觉得的严重程度排:

1. **RLS 策略只写 `USING`、应用用超级用户连库、连接池里用会话级 `SET`。** 三个都会让你以为有隔离,其实没有。
2. **网关透传用户令牌给下游。** MCP 规范明确禁止,也会让审计失效。
3. **工具定义只在接入时审核一次。** rug pull 就是冲着这个来的,要钉住指纹。
4. **评测集用线上原文。** 永不过期、权限宽松的个人信息库,还是删除请求最容易漏的地方。
5. **全量 trace 加原文一起长期保留。** 费用和隐私风险同时失控。
6. **降级目标没评测过。** 真降级的那天才发现备用模型不合格。
7. **用不带日期的模型别名。** 供应商一升级,你的 Agent 行为就变了,还找不到自己的变更记录。
8. **按请求数限流、多实例下用进程内存限流。** 前者防不住大请求,后者让限额变成 N 倍。
9. **熔断器自动恢复。** 问题没解决就反复开关。
10. **只有「关掉整个 Agent」一个开关。** 一拨下去人工队列被压垮,所以大家都不敢拨。
11. **网关机器上放着无关凭证、依赖随便升级。** 2026 年 3 月的 LiteLLM 投毒事件就是冲着这类机器去的。
12. **平台还没有用户就开始设计完整的抽象。** 最后没人用。

## 动手练习

**第一步:写设计文档(3 小时)。** 按上面的模板写 `agentops/docs/design.md`(仓库在 Day 96 才正式建,可以先放在 `agent-60-lab/w13/design.md`)。要求:

- 14 节全部写到,每一节至少有一个明确的取舍(选了什么、没选什么、为什么)。
- 有一张架构图(可以用 Mermaid 或者手画拍照)。
- 成本估算一节有算式。
- 「风险与待定问题」至少 5 条。

**第二步:自查和预审(1 小时)。** 用 36 项清单逐项自查,在文档末尾附一张表:每一项写在哪一节,没写的说明原因。然后跑 `review_doc.py` 做模型预审,对比模型的结论和你的自查,有分歧的地方想一想谁对。补完必须项。

**第三步:模拟评审会(1 小时)。** 找一位同学或者同事扮演评审人(找不到的话,让模型扮演「挑剔的安全负责人」和「将要接入的业务团队代表」两个角色,分别对你的文档提问),记录下他们的问题和你的回答。至少有 3 个问题让你改了文档。

**第四步:写一条 ADR(30 分钟)。** 从评审中挑一个最有争议的决定(比如「自研网关还是用 LiteLLM」「Agent 定义用配置还是代码」),按 ADR 的格式写下来:背景、选项、决定、后果。

**验收标准:**

- 设计文档 14 节齐全,36 项清单中带星号的全部覆盖。
- `review_doc.py` 对你的文档返回 0(必须项无缺失)。
- 有一份评审记录,包含至少 3 处因评审而做的修改。
- 有一条 ADR。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 设计文档(design doc) | 动工前描述问题、方案、取舍和风险的文档,用于评审和留档 |
| 非目标(non-goals) | 明确声明不做的事,用来控制范围、避免误解 |
| 架构评审 | 在实施前由相关方检查设计,发现问题和分歧 |
| ADR(架构决策记录) | 记录一个重要架构决定的背景、选项、结论和后果的短文档 |
| 预审 | 评审会之前的自动或自助检查,过滤明显遗漏 |
| 必须项 / 建议项 | 不满足就不能进入下一步的检查项 / 可以留到后续改进的项 |
| 接缝(seam) | 两个组件或两块职责之间的交界处,问题最常出现的地方 |
| 推翻条件 | 设计文档里写明「在什么情况下会改变这个决定」 |

## 常见误区

**设计文档只写方案,不写取舍。** 评审人最想知道的是你考虑过什么、为什么没选。只有方案的文档无法评审,也无法在半年后回答「当时为什么这样做」。

**把设计文档写成说明书。** 设计文档在动工前写,关注问题和决定;API 说明、操作手册是另外的文档。

**评审会上从头读文档。** 浪费所有人的时间。提前发、会前评论、会上只讨论分歧。

**用模型预审代替人工评审。** 模型能发现「没写」,很难发现「写错了」,而且它自己也会出错。它只是过滤器。

**只请技术人员评审平台设计。** 安全、法务和业务方代表能发现技术人员看不到的问题,平台尤其需要业务方的视角。

**评审结论没有记录。** 三个月后同样的争论会再来一次。结论和理由写进文档或 ADR。

## 学习资料

### 文档与文章

- [Malte Ubl · Design Docs at Google](https://www.industrialempathy.com/posts/design-docs-at-google/):Google 设计文档的结构、什么时候值得写、评审怎么进行。设计文档入门最好的一篇。30 分钟。
- [AWS Well-Architected · Generative AI Lens](https://docs.aws.amazon.com/wellarchitected/latest/generative-ai-lens/generative-ai-lens.html):AWS 针对生成式 AI 工作负载的架构评审框架,按卓越运营、安全、可靠性、性能、成本、可持续性六个支柱提问,可以拿来补充今天的清单。1 小时。
- [Microsoft · Azure Well-Architected Framework: AI workloads](https://learn.microsoft.com/en-us/azure/well-architected/ai/):微软版的 AI 工作负载架构指南,设计原则和评审清单都有。1 小时。
- [ADR GitHub 组织](https://adr.github.io/):架构决策记录的介绍和各种模板。20 分钟。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV17s4y1J7rG&autoplay=0&high_quality=1" title="阿里工程师带你学技术文档该怎么写" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>阿里技术 · 阿里工程师带你学技术文档该怎么写 · 30 分钟。阿里的工程师讲技术文档的结构和写法,包括方案文档怎么让读者快速抓住重点。</figcaption>
</figure>

上面那个讲技术方案评审、避免过度设计的视频也在这一组。

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/bgHL41e7vgI" title="What Is A Design Doc In Software Engineering? (full example)" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Clément Mihailescu · What Is A Design Doc In Software Engineering? (full example) · 16 分钟。前 Google 工程师用一个完整的例子走一遍设计文档的每一节,适合第一次写设计文档的人对照着写。</figcaption>
</figure>

### 书籍

- Tanya Reilly《The Staff Engineer's Path》(O'Reilly, 2022):第二部分讲 Staff 工程师怎么推动大型项目,包括写设计文档、做技术决策、处理分歧。这本书对「资深」意味着什么讲得很实在。3 小时。
- Titus Winters、Tom Manshreck、Hyrum Wright《Software Engineering at Google》(O'Reilly, 2020):第 10 章「Documentation」讲设计文档在 Google 工程文化里的位置和写法。40 分钟。
- Tod Golding《Building Multi-Tenant SaaS Architectures》(O'Reilly, 2024):Day 82 推荐过,写设计文档的多租户一节时可以再翻一遍第 2、3 章。

### 开源项目与代码

- [joelparkerhenderson/architecture-decision-record](https://github.com/joelparkerhenderson/architecture-decision-record):ADR 的模板合集和大量示例,挑一个格式用于你今天的第四步。20 分钟。
- 这一周写的 `agent-60-lab/w13/` 目录:网关、工具中心、可观测、治理、事故五个模块加今天的评审脚本,一共 21 个测试。把它们全部跑一遍(`uv run pytest -q w13`),作为 AgentOps 平台的第一批零件。

## 自测

1. 设计文档里的「非目标」有什么用?给 AgentOps 写三条。

<details><summary>答案</summary>

非目标明确告诉读者和评审人这个项目不做什么,用来控制范围、避免评审时被拉去讨论无关的东西,也避免业务方误以为平台会提供某些能力。AgentOps 的例子:不提供可视化拖拽搭建界面(用 Dify 满足);不替业务团队编写和维护提示词与业务工具;第一期不支持多区域部署;不做模型训练与微调平台(由 W12 相关团队负责)。

</details>

2. 36 项清单里,你认为最容易在评审中被漏掉的三项是什么?为什么?

<details><summary>答案</summary>

参考答案(可以有不同的选择,关键是理由):评测集的租户隔离和脱敏(大家把它当测试资产而不是数据存储);控制面不可用时数据面能否继续服务(正常运行时看不出来,只有故障时才暴露);降级目标是否进了评测(降级本身是可靠性设计,质量影响常被忽略)。它们的共同点是都处在两块职责的接缝上。

</details>

3. 为什么模型预审脚本把「模型漏掉的项」和「非法状态」都当成 missing?

<details><summary>答案</summary>

这是一个门禁,宁可多报不要漏报。如果把模型漏掉的项当作通过,模型偶尔少输出一项,必须项的缺失就会被放过。当作 missing 的代价只是作者多看一眼确认,而放过的代价可能是一个设计缺陷进入实施。同理,非法状态说明模型的输出不可信,不应该被当成 covered。

</details>

4. 成本估算一节为什么要写「和不做平台相比」?

<details><summary>答案</summary>

平台是一项投资,评审人和管理层要判断值不值。只写平台花多少钱,没有参照;和不做相比,才能看出收益:各团队重复维护网关、观测、审计的人力,供应商故障导致的停服时间,预算失控造成的超支,应对安全问卷和合规审查的时间。收益要写成可以核对的口径,否则就是空话。

</details>

5. **资深面试题**:评审会上,安全负责人和业务团队代表对「Agent 写操作是否一律需要人工审批」意见相反,僵持不下。作为设计文档的作者,你怎么推进?

<details><summary>答案</summary>

先把分歧具体化:安全方担心的是什么风险(错误退款、越权、注入导致的写操作),业务方担心的是什么成本(审批队列积压、响应变慢、人力)。然后用数据和分级把一刀切变成可讨论的方案:按工具风险和金额分级,低风险小额写操作在确定性护栏(金额上限、频率上限、对账)保护下自动执行,高风险或大额的走审批;先在一个租户灰度,用数据(错误率、审批量、处理时长)验证;约定复查时间点和推翻条件。把讨论结论和理由写进 ADR。原则是作者不替双方做价值判断,而是把取舍摆清楚、提供可验证的折中方案,必要时请更高一级的负责人在充分信息下拍板。

</details>

## 明天预告

Day 89 开始 W14 前沿形态,第一天是 **Coding Agent 内部:读 SWE-agent / OpenHands / Codex 的设计**。你每天都在用 Claude Code 或 Cursor 这类编码 Agent,明天拆开看它们内部:给代码 Agent 设计的工具集(编辑、搜索、执行、测试)、为什么 SWE-agent 提出了「Agent-计算机接口」这个概念、仓库上下文怎么检索、沙箱怎么做,以及 SWE-bench 是怎么评测它们的,并动手读一个开源实现的关键代码。
