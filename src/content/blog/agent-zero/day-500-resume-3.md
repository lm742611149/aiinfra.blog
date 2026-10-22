---
title: 'Day 500 · 简历(三):工作经历换角度,年限学历门槛'
description: '把一个前端工程师的工作经历诚实地往 Agent 岗改写:先把事实写成带职责级别的清单,让模型换角度改写,再用脚本抓职责升级和凭空多出来的技术词。后半段用正则从 JD 里读出年限和学历门槛,判断投、内推还是放弃。'
pubDate: 2026-10-22
regime: none
tags: ['resume', 'job-search', 'career-change', 'regex', 'agent-zero']
series: 'agent-zero'
day: 500
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 499](/blog/agent-zero/day-499-resume-2/) 把 SupportPilot 写成了四条三段式项目要点,写了 `lint`(查空话和口径)和 `check`(数字对账)两个脚本,还见识了检查器自己会错、脚本全绿也可能因果搭错。

项目经历写完,简历上还剩一大块:你原来的工作。这一块不能编,但可以换个角度写。今天讲怎么换才算诚实,以及 JD 上那些年限、学历门槛该怎么看。

## 今天要解决的问题

学完今天,你应该能做到:

1. 把自己的工作经历写成一份「事实清单」,每条带上你在这件事里是参与、负责还是主导。
2. 让模型按 Agent 岗的关键词改写工作经历,再用一个检查脚本抓三类不诚实:职责升级、凭空多出来的数字、凭空多出来的技术词。
3. 写一个读 JD 门槛的小脚本:认出最低年限、AI 方向年限、硕士是硬门槛还是优先,并给出投、内推还是放弃的建议;能说出它在哪些写法上会判错。

预计用时 2.5 小时。前置:[Day 498](/blog/agent-zero/day-498-resume-1/) 的 `part09/jds.json` 和 `load_jds`,[Day 499](/blog/agent-zero/day-499-resume-2/) 的正则用法(`re.compile`、`findall`、非捕获组),结构化输出([Day 147](/blog/agent-zero/day-147-structured-1/) 起)。

学法提示:先对照文章逐行敲一遍(不复制粘贴)并跑通;第二天合上文章,把 `check` 里三条规则和 `gate` 的判断顺序默写出来;做练习,做不出再展开参考答案,看完关掉重写一遍。

## 工作经历:同一件事,换个角度写

你原来是前端工程师。你可能觉得前端和 Agent 岗没什么关系,工作经历这一栏只能老老实实写「负责管理后台开发」。其实前端的日常工作里有不少 Agent 岗需要、但你没意识到的东西。关键是**换个角度描述同一件事,而不是编造没做过的事**。

拿一个做了三年 SaaS 管理后台的前端举例:

| 原来的写法 | 换个角度(同一件事,没有编造) | 对上了 JD 的哪个词 |
| --- | --- | --- |
| 写 E2E 测试 | 给下单流程写了 35 条 Playwright 端到端用例,接进 CI,合并前必须全绿 | 评测与回归、CI 门禁 |
| 做过 AI 助手页面 | 用 SSE 流式渲染 AI 客服回复,做了停止生成和断线重连 | 流式输出、Agent 前端体验 |
| 参与线上问题排查 | 参与排查 6 起线上白屏,用 Sentry 和 Performance 面板定位,2 起是接口返回结构变了 | 线上问题排查 |
| 用 Cursor 写代码 | 日常用 Cursor 写代码,给团队写了一份 8 条的 AI 生成代码 review 清单 | 熟练用 Coding Agent |

第一行值得多说一句。评测是 Day 498 那张表里两边都看重的硬通货,而「一批用例、接进 CI、不过不准合并」就是回归门禁。你在 Day 476–483 给 SupportPilot 做的事,本质上是把同一套思路搬到了模型输出上。面试时你可以说「我在前端就是这么守质量的,做 Agent 评测时最先想到的就是把它接进 CI」,这比单说一个课程项目更有说服力。

第二行更直接。Day 467–474 你做的 SupportPilot 界面,流式事件、工具调用卡片、停止和断线,和你工作里做过的 AI 助手是同一类问题。国内 35% 的 Agent 岗 JD 提了全栈或前端,网易那份写的是「具备基础前后端开发能力」。

最后一行,国内约四分之一的 JD 点名要会用 Claude Code、Cursor、Codex,有的还要「把控生成代码质量」。如果你真在用,写出来,而且写出你怎么控制质量。没用过就别写,这种东西面试时聊两句就露馅。

**换角度的边界在哪?** 我的标准是三条:做这件事的人还是你、你在里面的角色没变、数字和技术都是原来就有的。「参与」不能变「负责」,「负责」不能变「主导」;原来没有的数字不能凭空出现;原来没用过的技术不能因为 JD 要就写上去。

<figure>
<svg viewBox="0 0 640 220" role="img" aria-label="诚实改写的三条边界">
  <rect x="0" y="0" width="640" height="220" fill="var(--paper-raised)"/>
  <text x="20" y="28" font-family="var(--font-mono)" font-size="12" fill="var(--ink-soft)">职责只能往下或平着走,不能往上</text>
  <rect x="20" y="44" width="110" height="34" fill="none" stroke="var(--rule)"/>
  <text x="48" y="66" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">参与</text>
  <rect x="160" y="44" width="110" height="34" fill="none" stroke="var(--rule)"/>
  <text x="188" y="66" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">负责</text>
  <rect x="300" y="44" width="110" height="34" fill="none" stroke="var(--rule)"/>
  <text x="328" y="66" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">主导</text>
  <line x1="130" y1="61" x2="160" y2="61" stroke="var(--ink-faint)" stroke-dasharray="4 3"/>
  <line x1="270" y1="61" x2="300" y2="61" stroke="var(--ink-faint)" stroke-dasharray="4 3"/>
  <text x="430" y="66" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">虚线方向 = 不许</text>
  <rect x="20" y="104" width="290" height="96" fill="var(--mem-wash)" stroke="var(--mem)"/>
  <text x="32" y="126" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">事实 f3(你写的)</text>
  <text x="32" y="148" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">负责 · 35 条 Playwright 用例</text>
  <text x="32" y="168" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">接进 GitLab CI,合并前全绿</text>
  <rect x="336" y="104" width="290" height="96" fill="var(--compute-wash)" stroke="var(--compute)"/>
  <text x="348" y="126" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">改写(模型写的)</text>
  <text x="348" y="148" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">数字 ⊆ 事实里的数字</text>
  <text x="348" y="168" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">英文技术词 ⊆ 事实里的词</text>
  <text x="348" y="188" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">职责词不高于事实的级别</text>
  <line x1="310" y1="152" x2="336" y2="152" stroke="var(--rule)"/>
</svg>
<figcaption>改写可以换词序、换说法、换成 JD 的术语,但数字、技术词和职责级别三样只能从事实里来。</figcaption>
</figure>

如果你原来是测试或数据岗,思路一样:测试工程师的用例设计和回归体系对应评测,数据工程师的数据清洗和 SQL 对应 RAG 的数据处理和 text-to-SQL。

## 第一步:把事实写成清单

先别动笔写简历句子。把工作里做过的事一条一条写成事实,每条带上你在里面的角色。这一步必须你自己写,模型帮不了你,因为只有你知道哪件事是你牵头的、哪件事你只是跟着做。

在 `agent-zero-lab/` 下建 `part09/work_facts.json`。下面是示例,内容换成你自己的:

```json
[
 {"id": "f1", "role": "负责", "old": "负责管理后台前端开发", "fact": "负责公司 SaaS 管理后台的前端开发,React + TypeScript,3 年里做了订阅、发票、工单三个模块"},
 {"id": "f2", "role": "参与", "old": "参与线上问题排查", "fact": "参与排查 6 起线上白屏问题,用 Sentry 和浏览器 Performance 面板定位,其中 2 起是后端接口返回结构变了"},
 {"id": "f3", "role": "负责", "old": "写 E2E 测试", "fact": "给下单流程写了 35 条 Playwright 端到端用例,接进 GitLab CI,合并前必须全绿"},
 {"id": "f4", "role": "参与", "old": "做过 AI 助手页面", "fact": "参与公司 AI 客服助手的前端,用 SSE 流式渲染回复,做了停止生成和断线重连"},
 {"id": "f5", "role": "负责", "old": "用 Cursor 写代码", "fact": "日常用 Cursor 写代码,给团队写了一份 AI 生成代码的 review 清单,共 8 条"},
 {"id": "f6", "role": "负责", "old": "做埋点", "fact": "负责前端埋点 SDK,统一了 40 多个页面的事件上报格式"}
]
```

`role` 只有三个值。我的划分是:**参与**是你在别人主持的事情里干了一部分;**负责**是这件事交给了你、结果算你的;**主导**是你发起或牵头、还带着别人一起干。拿不准就往低了写,面试官问「这件事你们几个人做的,你具体做了哪块」时,往低了写的人永远不会被问倒。

`old` 是简历上原来的写法,留着对比用。`fact` 写得越具体越好,数字、工具名、结果都写进去,因为后面的检查脚本只认这里出现过的东西。

## 第二步:写检查脚本

检查三件事:改写里的数字必须在事实里出现过;改写里的英文技术词必须在事实里出现过;职责词不能比事实的 `role` 高。

```python
# agent-zero-lab/part09/honesty_check.py
import json
import re
from pathlib import Path

UPGRADE = {"参与": ["主导", "负责", "牵头", "独立"], "负责": ["主导", "牵头"]}
NUM = re.compile(r"\d+(?:\.\d+)?")
WORD = re.compile(r"[A-Za-z][A-Za-z+.#-]*")


def load_facts() -> dict[str, dict[str, str]]:
    rows = json.loads(Path("part09/work_facts.json").read_text(encoding="utf-8"))
    return {r["id"]: r for r in rows}


def check(text: str, fact_ids: list[str], facts: dict[str, dict[str, str]]) -> list[str]:
    missing = [i for i in fact_ids if i not in facts]
    if missing or not fact_ids:
        return [f"引用了不存在的事实 {missing or '(没引用)'}"]
    source = " ".join(facts[i]["fact"] for i in fact_ids)
    roles = {facts[i]["role"] for i in fact_ids}
    problems: list[str] = []
    for n in set(NUM.findall(text)) - set(NUM.findall(source)):
        problems.append(f"事实里没有的数字 {n}")
    for w in set(WORD.findall(text)) - set(WORD.findall(source)):
        problems.append(f"事实里没有的英文词 {w}")
    for role in roles:
        for verb in UPGRADE.get(role, []):
            if verb in text:
                problems.append(f"「{role}」被写成了「{verb}」")
    return problems


if __name__ == "__main__":
    facts = load_facts()
    tests = [
        ("排查 6 起线上白屏问题,用 Sentry 定位,其中 2 起是接口结构变化", ["f2"]),
        ("主导 6 起线上故障的根因分析,建立 Tracing 体系", ["f2"]),
        ("为下单流程建 50 条回归用例作为发布门禁", ["f3"]),
        ("把评测接进 CI", ["f9"]),
    ]
    for text, ids in tests:
        p = check(text, ids, facts)
        print("通过" if not p else p, "|", text)
```

<div class="line-notes">

- `UPGRADE = {"参与": ["主导", "负责", "牵头", "独立"], "负责": ["主导", "牵头"]}` 每个角色「不许出现的词」。事实是「参与」的,改写里出现「负责」「主导」都算升级;事实是「负责」的,出现「主导」「牵头」算升级。「主导」没有上限,不在表里。
- `NUM = re.compile(r"\d+(?:\.\d+)?")` 和 Day 499 的数字正则差不多,这次不带 `%`,工作经历里百分比少。
- `WORD = re.compile(r"[A-Za-z][A-Za-z+.#-]*")` 英文词:字母开头,后面可以跟字母和 `+ . # -`,这样 `TypeScript`、`C#`、`Node.js` 都是一个词。中文技术词(比如「链路追踪」)查不到,这是它的盲区。
- `def load_facts() -> dict[str, dict[str, str]]:` 读事实清单,转成「id → 事实」的字典,方便按 id 查。
- `return {r["id"]: r for r in rows}` 字典推导式,相当于 JS 的 `Object.fromEntries(rows.map(r => [r.id, r]))`。
- `def check(text: str, fact_ids: list[str], facts: dict[str, dict[str, str]]) -> list[str]:` 输入一条改写、它声称依据的事实 id 列表、全部事实。
- `missing = [i for i in fact_ids if i not in facts]` 先查引用的事实存不存在。模型可能编一个 f9 出来。
- `return [f"引用了不存在的事实 {missing or '(没引用)'}"]` 引用都不对,后面的检查没意义,直接返回。`missing or '(没引用)'`:列表为空(说明是 `fact_ids` 为空)就显示「(没引用)」。
- `source = " ".join(facts[i]["fact"] for i in fact_ids)` 把引用的几条事实拼成一段,作为这条改写的「原材料」。
- `roles = {facts[i]["role"] for i in fact_ids}` 集合推导式,收集这些事实的角色,去重。
- `for n in set(NUM.findall(text)) - set(NUM.findall(source)):` 集合减法:改写里有、事实里没有的数字。相当于 JS 里 `[...a].filter(x => !b.has(x))`。
- `for w in set(WORD.findall(text)) - set(WORD.findall(source)):` 英文词同理,区分大小写,`ci` 和 `CI` 算两个词。
- `for verb in UPGRADE.get(role, []):` 这个角色不许出现的词逐个查。`.get(role, [])` 对「主导」返回空列表。
- `tests = [` 四条测试:一条老实的、一条既升级又加词的、一条改了数字的、一条引用了不存在的事实。

</div>

```bash
uv run python part09/honesty_check.py
```

```text
通过 | 排查 6 起线上白屏问题,用 Sentry 定位,其中 2 起是接口结构变化
['事实里没有的英文词 Tracing', '「参与」被写成了「主导」'] | 主导 6 起线上故障的根因分析,建立 Tracing 体系
['事实里没有的数字 50'] | 为下单流程建 50 条回归用例作为发布门禁
["引用了不存在的事实 ['f9']"] | 把评测接进 CI
```

第二条是最典型的「包装」:参与排查变成「主导根因分析」,用了 Sentry 变成「建立 Tracing 体系」。每一处单独看都只是「说得好听一点」,合起来就是另一个人的经历了。面试官问「你建的 Tracing 体系用的什么,采样率多少」,你只用过 Sentry 的报错页,当场就接不住。

## 第三步:让模型换角度改写,再过检查

现在把事实清单和几个想对上的 JD 关键词交给模型。要它对每一条输出三样:依据哪几条事实、对上了哪个关键词、改写后的句子。要求它标出依据,是为了让检查脚本知道该拿哪条事实去比。

```python
# agent-zero-lab/part09/rewrite_work.py
import json

from pydantic import BaseModel

from common.llm import LLMClient
from part09.honesty_check import check, load_facts


class Line(BaseModel):
    fact_ids: list[str]
    jd_keyword: str
    text: str


class Rewrite(BaseModel):
    lines: list[Line]


JD_WORDS = "评测与回归、可观测 / Tracing、流式输出、工具调用、熟练用 Coding Agent、面向客户"
SYSTEM = (
    "你帮一个前端工程师把工作经历改写得更贴近 AI Agent 工程师岗位。"
    "每条只能改写用户给的事实,换个角度描述同一件事,不许加事实里没有的数字、技术和职责。"
    "fact_ids 写这条依据哪几条事实;jd_keyword 写它对上了哪个岗位关键词。"
    '只输出 JSON:{"lines": [{"fact_ids": ["f1"], "jd_keyword": "...", "text": "..."}]}'
)

facts = load_facts()
user = f"岗位关键词:{JD_WORDS}\n\n事实:\n" + json.dumps(list(facts.values()), ensure_ascii=False, indent=1)

llm = LLMClient()
r = llm.chat(
    [{"role": "system", "content": SYSTEM}, {"role": "user", "content": user}],
    response_format={"type": "json_object"},
    temperature=0,
)
out = Rewrite.model_validate(json.loads(r.content))

for line in out.lines:
    problems = check(line.text, line.fact_ids, facts)
    print(f"[{','.join(line.fact_ids)}|{line.jd_keyword}] {line.text}")
    print(f"   → {'通过' if not problems else problems}")
print(f"\n{r.prompt_tokens} 输入 / {r.completion_tokens} 输出 | ¥{r.cost:.5f}")
```

<div class="line-notes">

- `class Line(BaseModel):` 每条改写三个字段。`fact_ids` 是列表,因为一条简历要点可能合并了两件事。
- `JD_WORDS = "评测与回归、可观测 / Tracing、流式输出、工具调用、熟练用 Coding Agent、面向客户"` 这几个词来自 Day 498 的对照表。我故意放了「工具调用」,前端经历里其实没有能对上的,看模型会不会硬凑。
- `"每条只能改写用户给的事实,换个角度描述同一件事,不许加事实里没有的数字、技术和职责。"` 和 Day 499 一样,这只是请求,后面靠 `check` 验。
- `user = f"岗位关键词:{JD_WORDS}\n\n事实:\n" + json.dumps(list(facts.values()), ensure_ascii=False, indent=1)` 把事实原样转回 JSON 塞进去。`ensure_ascii=False` 让中文原样输出,不然会变成 `负责` 这种转义,模型也能读,但浪费 token。
- `out = Rewrite.model_validate(json.loads(r.content))` 解析加校验。
- `problems = check(line.text, line.fact_ids, facts)` 每条改写都拿它声称的依据去比。
- `print(f"[{','.join(line.fact_ids)}|{line.jd_keyword}] {line.text}")` 方括号里是依据和关键词,方便你一眼看出模型把哪条事实往哪个词上靠。

</div>

```bash
uv run python -m part09.rewrite_work
```

我实跑的输出:

```text
[f1|面向客户] 负责公司 SaaS 管理后台前端开发(React + TypeScript),3 年内交付订阅、发票、工单三个面向客户的业务模块
   → 通过
[f2|可观测 / Tracing] 参与 6 起线上白屏问题排查,借助 Sentry 与浏览器 Performance 面板做链路定位,其中 2 起定位到后端接口返回结构变更
   → 通过
[f3|评测与回归] 为下单流程编写 35 条 Playwright 端到端用例并接入 GitLab CI,作为合并前的回归门禁,必须全绿才能合入
   → 通过
[f4|流式输出] 参与公司 AI 客服助手前端,基于 SSE 实现流式回复渲染,并实现停止生成与断线重连
   → 通过
[f5|熟练用 Coding Agent] 日常使用 Cursor 作为 Coding Agent 写代码,并沉淀了一份 8 条 AI 生成代码 review 清单供团队使用
   → ['事实里没有的英文词 Agent', '事实里没有的英文词 Coding']
[f6|可观测 / Tracing] 负责前端埋点 SDK,统一 40 多个页面的事件上报格式,为线上行为观测提供一致的数据口径
   → 通过

506 输入 / 305 输出 | ¥0.00345
```

花费 ¥0.00345,算式 506 × 2 / 1,000,000 + 305 × 8 / 1,000,000 ≈ 0.00101 + 0.00244 = ¥0.00345(deepseek-flash 高峰价,2026 年 10 月查的 [DeepSeek 定价页](https://api-docs.deepseek.com/zh-cn/quick_start/pricing))。

模型没有加数字、没有升级职责,「工具调用」它也没硬凑,这比我预想的老实。脚本只拦了一条,我逐条看,结论和脚本不完全一样。

**f5 被拦,其实没问题。** 「Coding Agent」是 JD 里的原词,Cursor 本来就是一个 Coding Agent,这里只是把它叫成了 JD 的名字。脚本按规则办事,分不出「新技术」和「同一个东西的另一种叫法」。这是误伤,练习 1 让你加个白名单。

**f1 通过了,但我不会用。** 「三个面向客户的业务模块」把管理后台说成了面向客户。订阅、发票、工单这几个模块的用户是客户公司的管理员,硬说「面向客户」不算错,但 JD 里「面向客户 / 交付」说的是 FDE 那种和客户一起定需求、驻场交付的能力,两个意思完全不同。面试官顺着问「你直接对接过哪些客户」,你没有。这一条我会删掉「面向客户的」几个字,不去对那个关键词。

**f2 和 f6 都被往「可观测 / Tracing」上靠。** f2 的「做链路定位」有点虚,Sentry 主要看报错和性能,不是分布式链路追踪,我会改回「定位」。f6 的埋点是产品分析数据,和 Agent 的 trace 也不是一回事。这两条我保留原意,但不在技能栏里写「Tracing」,面试时如果被问,老实说「我做过前端监控和埋点,Agent 的 trace 是在 SupportPilot 里接 Langfuse 时学的」。

这三条里的问题,脚本一个都没报。规则能查「有没有凭空多东西」,查不了「词还是那个词,意思被拉到了别处」。所以和 Day 499 一样,最后一道是你。我定稿的四条工作经历要点:

> - 负责 SaaS 管理后台前端(React + TypeScript),3 年交付订阅、发票、工单三个模块。
> - 给下单流程写 35 条 Playwright 端到端用例接入 GitLab CI,作为合并前回归门禁。
> - 参与 AI 客服助手前端,用 SSE 流式渲染回复,实现停止生成和断线重连。
> - 日常用 Cursor 开发,为团队整理 8 条 AI 生成代码 review 清单。

f2 和 f6 没进定稿。不是因为它们不真,而是一页简历只放得下四条,这两条离 Agent 岗最远。它们留在事实清单里,面试被问到「线上问题怎么排查」时正好用得上。

## 第四步:年限和学历门槛,先看数据

这部分不好听,但必须说清楚。站长调研数据里有两样统计(2026 年 10 月 12 日抓取,Boss 直聘 435 条、猎聘 140 条的列表字段):

**年限**:Boss 上要求 3–5 年的最多,占 31.5%,其次是经验不限 23.9%、5–10 年 19.8%、1–3 年 14.3%;猎聘 3–5 年占 43.6%、1–3 年 20.7%。海外写了年限的岗位中位数是 5 年。

**学历**:Boss 列表里本科 80.5%,硕士加博士 9.4%;猎聘本科 79.3%(其中一半多写的是「统招本科」),硕士加博士 12.1%。卡得更严的是大厂和算法味重的岗位,第一批大厂官网 120 条里有 12 条提到硕士。海外基本不提学历。

两个数先记住:**主流是 3–5 年,明确卡硕士的大约一成**。

大多数 JD 里的年限指总的软件开发经验,不是 AI 经验。所以一个有 3 年前端经验的人,看到「3–5 年」的 Agent 岗是可以投的。但也有岗位单独写 AI 年限,比如 Day 498 那份中兵数字的 FDE 岗写的是「1–3 年开发工作经验,其中至少 1 年与 AI 应用 / Agent 开发 / 大模型落地相关」,网易写的是「2 年以上大模型 / 智能体开发经验」。这两种要分开看,脚本也要分开认。

## 第五步:用正则读门槛,先踩一个坑

先写最简单的版本,只认年限:「3-5 年」这种区间,或者「2 年以上」。

```python
# agent-zero-lab/part09/jd_gate_v1.py
import re

from part09.kw_count_v2 import load_jds

YEARS = re.compile(r"(\d+)\s*-\s*(\d+)\s*年|(\d+)\s*年以上")

for jd in load_jds():
    m = YEARS.search(jd["text"])
    print(f"{jd['id']:<14}", m.group(0) if m else "没找到年限")
```

<div class="line-notes">

- `YEARS = re.compile(r"(\d+)\s*-\s*(\d+)\s*年|(\d+)\s*年以上")` 两种写法用 `|` 连起来。`\s*` 是「零个或多个空白」,因为有的 JD 写「3-5 年」,有的写「3 - 5年」。三对括号是三个捕获组,左边那种写法命中时第 1、2 组有值,右边命中时第 3 组有值。
- `m = YEARS.search(jd["text"])` 找到第一个匹配。没找到返回 None。
- `print(f"{jd['id']:<14}", m.group(0) if m else "没找到年限")` `group(0)` 是整段匹配到的文字。f-string 里取字典值要用单引号 `jd['id']`,因为外面已经是双引号了。

</div>

```bash
uv run python -m part09.jd_gate_v1
```

```text
tencent        没找到年限
netease        2 年以上
zhaopin_rag    3-5 年
zhaopin_fde    没找到年限
intercom_fde   没找到年限
```

腾讯和 Intercom 本来就没写年限,没问题。但中兵数字那份(zhaopin_fde)明明写了「1–3 年」,为什么没找到?

回去看原文,那个横杠不是键盘上的减号 `-`,是 en dash `–`(长一点的横线)。它们在屏幕上几乎一样,但是两个不同的字符:减号是 U+002D,en dash 是 U+2013。Word、飞书、很多招聘后台的编辑器会把你打的减号自动换成 en dash。正则里写 `-` 只认减号,于是漏掉了。你可以在 Python 里验证:`"-" == "–"` 是 False,`ord("–")` 是 8211。

这一类坑在处理中文网页文本时到处都是:全角逗号「,」和半角「,」、全角空格、波浪线「~」和「〜」、「至」。改法是把常见的几种横线和连接词都放进一个字符集合。

## 第六步:完整的门槛判断

```python
# agent-zero-lab/part09/jd_gate.py
import re

from part09.kw_count_v2 import load_jds

YEARS = re.compile(r"(\d+)\s*[-–—~至]\s*(\d+)\s*年|(\d+)\s*年以上")
AI_YEARS = re.compile(r"(\d+)\s*年(?:以上)?[^,，;；。]{0,6}?(?:AI|Agent|大模型|智能体)")
HARD_MASTER = re.compile(r"(硕士|研究生)(及以上|以上)")
SOFT_MASTER = re.compile(r"(硕士|研究生)[^,，;；。]{0,4}优先")

MY_YEARS = 3


def min_years(text: str) -> int | None:
    m = YEARS.search(text)
    if not m:
        return None
    return int(m.group(1) or m.group(3))


def gate(text: str) -> tuple[str, list[str]]:
    notes: list[str] = []
    y = min_years(text)
    if y is not None:
        notes.append(f"最低 {y} 年")
    ai = AI_YEARS.search(text)
    if ai:
        notes.append(f"另要 AI 方向 {ai.group(1)} 年")
    if HARD_MASTER.search(text):
        notes.append("硕士是硬门槛")
        return "走内推,不然放弃", notes
    if SOFT_MASTER.search(text):
        notes.append("硕士只是优先")
    if y is not None and y > MY_YEARS + 1:
        return "能投,但别指望", notes
    if ai:
        return "投,简历里写清 AI 经验来自个人项目", notes
    return "投", notes


if __name__ == "__main__":
    samples = [(jd["id"], jd["text"]) for jd in load_jds()]
    samples += [
        ("样例_硬", "硕士及以上学历,3 年以上 Agent/RAG 落地经验"),
        ("样例_软", "本科及以上学历,硕士优先;5-10 年后端开发经验"),
    ]
    for name, text in samples:
        verdict, notes = gate(text)
        print(f"{name:<14}{verdict:<22}{notes}")
```

<div class="line-notes">

- `YEARS = re.compile(r"(\d+)\s*[-–—~至]\s*(\d+)\s*年|(\d+)\s*年以上")` 方括号是字符集合,里面任意一个字符都行:减号、en dash、em dash、波浪线、「至」。在 Zed 里这几个横线长得差不多,建议从这一行复制,这是数据不是逻辑。
- `AI_YEARS = re.compile(r"(\d+)\s*年(?:以上)?[^,，;；。]{0,6}?(?:AI|Agent|大模型|智能体)")` 「N 年」后面 6 个字以内出现 AI 相关词,就当作是 AI 方向的年限。`[^,，;；。]` 是「不是这几个标点」:半角逗号、全角逗号、半角分号、全角分号、句号,保证不跨句子去配。全角和半角两种都要放,中文 JD 里两种混着用。`{0,6}?` 是「0 到 6 个,越少越好」。网易的「2 年以上大模型」、中兵的「至少 1 年与 AI」都能匹配。
- `HARD_MASTER = re.compile(r"(硕士|研究生)(及以上|以上)")` 「硕士及以上」「研究生以上」是硬门槛。
- `SOFT_MASTER = re.compile(r"(硕士|研究生)[^,，;；。]{0,4}优先")` 「硕士优先」「研究生学历优先」只是加分项。同一句里四个字以内出现「优先」才算。
- `MY_YEARS = 3` 你的工作年限,换成你自己的。
- `def min_years(text: str) -> int | None:` 返回最低年限,没写就返回 None。`int | None` 相当于 TS 的 `number | null`。
- `return int(m.group(1) or m.group(3))` 区间写法看第 1 组,「以上」写法看第 3 组,没命中的组是 None。`None or "2"` 得到 `"2"`,再转成整数。
- `def gate(text: str) -> tuple[str, list[str]]:` 返回(建议, 理由列表)。
- `if HARD_MASTER.search(text):` 判断顺序有讲究:硬门槛最先判,命中就直接返回,后面不用看了。
- `return "走内推,不然放弃", notes` Python 的 return 可以直接返回一个元组,不写括号也行。相当于 JS 返回 `[verdict, notes]` 再解构。
- `if y is not None and y > MY_YEARS + 1:` 最低年限比你多两年以上,才算「别指望」。差一年的照投,年限这个东西很多公司是弹性的。
- `if ai:` 有 AI 年限要求的,能投,但简历里要写清 AI 经验的来源。
- `samples += [` 五份 JD 里没有卡硕士的,补两条样例来测硬门槛和软门槛。`+=` 拼接列表,相当于 JS 的 `samples.push(...)`。

</div>

```bash
uv run python -m part09.jd_gate
```

```text
tencent       投                     []
netease       投,简历里写清 AI 经验来自个人项目   ['最低 2 年', '另要 AI 方向 2 年']
zhaopin_rag   投                     ['最低 3 年']
zhaopin_fde   投,简历里写清 AI 经验来自个人项目   ['最低 1 年', '另要 AI 方向 1 年']
intercom_fde  投                     []
样例_硬          走内推,不然放弃              ['最低 3 年', '另要 AI 方向 3 年', '硕士是硬门槛']
样例_软          能投,但别指望               ['最低 5 年', '硕士只是优先']
```

zhaopin_fde 的「1–3 年」认出来了。网易那条「最低 2 年」和「另要 AI 方向 2 年」其实是同一句话,它的年限要求本身就是 AI 年限,脚本两个都报了,不影响结论。

<figure>
<svg viewBox="0 0 640 240" role="img" aria-label="门槛判断的顺序">
  <rect x="0" y="0" width="640" height="240" fill="var(--paper-raised)"/>
  <rect x="20" y="20" width="150" height="40" fill="var(--mem-wash)" stroke="var(--mem)"/>
  <text x="32" y="45" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">硕士及以上?</text>
  <text x="190" y="45" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">是 → 走内推,不然放弃</text>
  <rect x="20" y="80" width="150" height="40" fill="var(--mem-wash)" stroke="var(--mem)"/>
  <text x="32" y="105" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">最低年限 > 我+1?</text>
  <text x="190" y="105" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">是 → 能投,但别指望</text>
  <rect x="20" y="140" width="150" height="40" fill="var(--mem-wash)" stroke="var(--mem)"/>
  <text x="32" y="165" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">要 AI 方向年限?</text>
  <text x="190" y="165" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">是 → 投,写清 AI 经验来源</text>
  <rect x="20" y="196" width="150" height="34" fill="var(--compute-wash)" stroke="var(--compute)"/>
  <text x="80" y="218" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">投</text>
  <line x1="95" y1="60" x2="95" y2="80" stroke="var(--rule)"/>
  <line x1="95" y1="120" x2="95" y2="140" stroke="var(--rule)"/>
  <line x1="95" y1="180" x2="95" y2="196" stroke="var(--rule)"/>
  <text x="104" y="74" font-family="var(--font-mono)" font-size="10" fill="var(--ink-faint)">否</text>
  <text x="104" y="134" font-family="var(--font-mono)" font-size="10" fill="var(--ink-faint)">否</text>
  <text x="104" y="192" font-family="var(--font-mono)" font-size="10" fill="var(--ink-faint)">否</text>
  <text x="420" y="45" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">硕士优先:不拦,只记一笔</text>
  <text x="420" y="105" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">差一年照投</text>
</svg>
<figcaption>从最硬的门槛往下判,命中就停。这个顺序也是你读 JD 时眼睛该扫的顺序。</figcaption>
</figure>

### 拿全量数据跑一次

和 Day 498 一样,我把 `gate` 放到站长调研里国内 334 条带正文的 JD 上跑了一遍(数据未公开,结果贴在这里):

```text
334 [('投', 236), ('投,简历里写清 AI 经验来自个人项目', 46), ('能投,但别指望', 31), ('走内推,不然放弃', 21)]
hard 21 soft 3 ai_years 63 years found 159
```

硬卡硕士的 21 条,约 6%;正文里有 AI 方向年限要求的 63 条,约 19%;正文写了年限的只有 159 条,因为 Boss 和猎聘的年限大多在列表字段里,不在正文。

数字不能直接信,我从 63 条 AI 年限里随机抽了 8 条看原文,有 2 条是误判:「5年以上互联网或者AI行业数据分析经验」「2年以上后端开发或AI应用开发经验」。这两句的意思是「A 或 B 都行」,不是非要 AI 经验,但 AI 这个词落在了 6 个字的窗口里。8 条错 2 条,说明 63 这个数偏高,真实比例可能在一成五左右。练习 2 修这个。

## 怎么面对这些门槛

脚本能告诉你门槛在哪,怎么面对是另一回事。

**年限。** 3–5 年是主流,而且大多指总开发年限。你有 3 年前端,这类岗位照投。遇到单独要 AI 年限的(大约一两成),你的 AI 经验来自这门课的项目,算不上一年的 AI 工作经验,不要硬凑,比如把课程时间写成工作经历。但可以投,在简历和面试里坦率说明 AI 方向的经验来自哪里,用作品的深度去补。被拒很正常,不必内耗。

**学历。** 八成岗位写本科就够,把精力优先放在这些岗位上。写「硕士优先」的照常投,优先不是必须。写「硕士及以上」的,本科靠作品集很难越过初筛,因为很多公司的初筛是 HR 或系统按条件过滤的,你的作品集根本没机会被打开。如果特别想去这样一个团队,找内推:让在那里工作的人把你的简历直接递给用人经理,这几乎是唯一能绕过系统过滤的路。

学历只有一条铁律:**写真的**。专科就写专科,自考就写自考,时间写准。学历是入职背调必查的项目,查出来不是被拒的问题,是入职以后被开除的问题。下面 B 站那个视频讲的就是一个真实例子。

**课程项目和三年 Agent 经验的人比,差在哪?** 差在线上真实流量和真实用户带来的问题:凌晨的流量尖峰、用户各种奇怪的说法、上游接口悄悄改了字段、老板问为什么上个月成本翻倍。你可以在面试里主动承认这一点,然后讲你用什么方法尽量逼近真实:用评测集替代真实流量,用注入测试替代真实攻击者,用自建账本替代真实账单。这种自知之明在面试里通常是加分的,因为面试官最怕的是候选人分不清 demo 和生产的区别。

## 动手练习

**练习 1:加白名单。** f5 那条的「Coding」「Agent」是 JD 原词,不该被当成凭空多出来的技术。给检查加一个白名单 `ALLOW`,白名单里的词不报,但 `LangGraph` 这种真正的新技术词照报。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part09/ex/ex500_allow.py
from part09.honesty_check import check, load_facts

ALLOW = {"Coding", "Agent"}


def check2(text: str, fact_ids: list[str]) -> list[str]:
    problems = check(text, fact_ids, load_facts())
    return [p for p in problems if not any(p.endswith(f"英文词 {w}") for w in ALLOW)]


line = "日常使用 Cursor 作为 Coding Agent 写代码,并沉淀了一份 8 条 AI 生成代码 review 清单供团队使用"
print("原来:", check(line, ["f5"], load_facts()))
print("白名单后:", check2(line, ["f5"]) or "通过")
print("LangGraph:", check2("日常用 Cursor 和 LangGraph 写 Agent", ["f5"]))
```

<div class="line-notes">

- `ALLOW = {"Coding", "Agent"}` 用集合。白名单只放 JD 关键词里本来就有、而且是「同一个东西换个叫法」的词。别把 LangGraph 放进来,那是真的新技术。
- `def check2(text: str, fact_ids: list[str]) -> list[str]:` 在原来的 `check` 外面包一层过滤,不改原文件。
- `return [p for p in problems if not any(p.endswith(f"英文词 {w}") for w in ALLOW)]` 原检查的英文词问题都长成「事实里没有的英文词 XXX」,用 `endswith` 判断结尾是不是白名单里的词。按字符串过滤有点土,但不用改 `check` 的返回格式。
- `print("LangGraph:", check2("日常用 Cursor 和 LangGraph 写 Agent", ["f5"]))` 验证白名单没把真问题也放过去。

</div>

```text
原来: ['事实里没有的英文词 Coding', '事实里没有的英文词 Agent']
白名单后: 通过
LangGraph: ['事实里没有的英文词 LangGraph']
```

第一行两个问题的先后顺序你跑出来可能相反,因为它们来自集合运算,集合没有固定顺序。

</details>

**练习 2:修「或」的误判。** `AI_YEARS` 把「2年以上后端开发或AI应用开发经验」也当成了 AI 年限要求。写一个 `ai_years` 函数:匹配到的那一段里如果有「或」,就不算。用四句话测试。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part09/ex/ex500_or.py
from part09.jd_gate import AI_YEARS


def ai_years(text: str) -> int | None:
    m = AI_YEARS.search(text)
    if m is None or "或" in m.group(0):
        return None
    return int(m.group(1))


for t in [
    "5年以上互联网或者AI行业数据分析经验",
    "2年以上后端开发或AI应用开发经验",
    "2 年以上大模型 / 智能体开发经验",
    "其中至少 1 年与 AI 应用 / Agent 开发相关",
]:
    print(f"{ai_years(t)!s:<6}{t}")
```

<div class="line-notes">

- `from part09.jd_gate import AI_YEARS` 复用编译好的正则。`jd_gate.py` 写了 `if __name__ == "__main__":`,import 时不会把它的打印跑一遍。
- `if m is None or "或" in m.group(0):` `m.group(0)` 是匹配到的整段,比如第二句匹配到的是「2年以上后端开发或AI」,里面有「或」。「或者」也包含「或」,一起排除。
- `return int(m.group(1))` 第 1 组是年数。
- `print(f"{ai_years(t)!s:<6}{t}")` `!s` 把 None 转成字符串 "None" 再对齐。

</div>

```text
None  5年以上互联网或者AI行业数据分析经验
None  2年以上后端开发或AI应用开发经验
2     2 年以上大模型 / 智能体开发经验
1     其中至少 1 年与 AI 应用 / Agent 开发相关
```

两个误判排除了,两个真的还在。代价是如果有 JD 写「1 年以上大模型或智能体开发经验」(或连接的两边都是 AI),也会被排除,这种就漏掉了。规则的老问题,你得决定宁可漏还是宁可错。对于门槛判断,我宁可漏:漏掉一个 AI 年限要求,最坏是投了一个可能被拒的岗位;误报的话你可能放弃一个本来能投的。

</details>

**练习 3:判断三份 JD。** 用 `gate` 判断下面三段要求,并说出你同意不同意脚本的结论。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part09/ex/ex500_gate.py
from part09.jd_gate import gate

jds = {
    "A": "计算机、AI 或相关专业研究生及以上学历,1年以上研发经验",
    "B": "本科及以上,硕士优先;3-5年后端开发经验,其中1年以上大模型应用开发经验",
    "C": "统招本科,经验不限,熟悉 Python,有 Agent 个人项目或开源贡献均可",
}
for name, text in jds.items():
    verdict, notes = gate(text)
    print(f"{name}  {verdict:<22}{notes}")
```

<div class="line-notes">

- `jds = {` 三段要求是我根据调研里真实 JD 的写法改写的,不对应某一家公司。
- `"A": "计算机、AI 或相关专业研究生及以上学历,1年以上研发经验",` 注意「AI 或相关专业」里也有「或」和 AI,但它前面没有「N 年」,`AI_YEARS` 不会误判。
- `for name, text in jds.items():` 遍历字典的键值对。

</div>

```text
A  走内推,不然放弃              ['最低 1 年', '硕士是硬门槛']
B  投,简历里写清 AI 经验来自个人项目   ['最低 3 年', '另要 AI 方向 1 年', '硕士只是优先']
C  投                     []
```

A 我同意,研究生及以上是硬门槛,年限再低也绕不过初筛。B 我同意脚本的结论,但要补一句:它要的是「后端开发经验」,你是前端,3 年前端和 3 年后端在这家公司眼里可能不是一回事,投之前去看看职责里后端占多少。这一点脚本完全看不出来。C 是最该投的,「个人项目或开源贡献均可」几乎是在点名欢迎转方向的人。

</details>

**验收标准**

- 你有一份自己的 `work_facts.json`,每条都标了参与、负责或主导,拿不准的往低了写。
- 改写后的工作经历全部过了检查,被拦的每一条你都能说清是真问题还是检查器误伤。
- 你逐条读过改写,删掉了「关键词硬贴」的说法(像本文 f1 的「面向客户」)。
- 你拿自己想投的 5 份 JD 跑过 `gate`,并对每份写了一句同意或不同意的理由。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 换角度改写 | 同一件事,换成和目标岗位相关的说法和术语;人、角色、数字、技术都不变 |
| 事实清单 | 把工作里做过的事逐条写下,带角色、数字和工具,作为改写的唯一原材料 |
| 职责升级 | 把「参与」写成「负责」、把「负责」写成「主导」,是最常见的简历注水 |
| 关键词硬贴 | 词对上了 JD,意思却被拉到别处,例:管理后台说成「面向客户」 |
| 硬门槛 / 软门槛 | 「硕士及以上」是硬门槛,初筛直接过滤;「硕士优先」是软门槛,只是加分 |
| AI 方向年限 | JD 单独要求的 AI / Agent / 大模型工作年限,和总开发年限分开算 |
| 内推 | 由公司在职员工推荐,简历通常直接到用人团队,能绕过按条件过滤的初筛 |
| 背调 | 背景调查,入职前核实学历、工作经历,学历几乎必查 |
| en dash | 「–」,比减号长一点的横线,U+2013,编辑器常自动把减号换成它 |
| 字符集合 | 正则里的 `[...]`,匹配方括号里任意一个字符;`[^...]` 是「不是这些字符」 |

## 常见误区

**换角度就是往高了说。** 参与说成主导、用过 Sentry 说成建了 Tracing 体系,每一处都只是「好听一点」,合起来就是别人的经历。面试官顺着追问两层就露馅。

**关键词对上了就往上贴。** 本文 f1 的「面向客户」、f2 的「链路定位」都通过了脚本,但意思不对。对不上的关键词就让它空着,Day 498 的对照表里空着的格子是正常的。

**正则里只写半角减号。** JD 里的「1–3 年」用的是 en dash,`-` 匹配不上,而且不报错,只是悄悄漏掉。处理中文网页文本,横线、逗号、分号、空格都要考虑全角和半角两种。

**全量统计的数字直接用。** `AI_YEARS` 抽 8 条错了 2 条,63 这个数偏高。规则跑完必须抽查原文。

**看到硕士门槛就全部放弃,或者完全无视。** 分清「硕士优先」和「硕士及以上」:前者照投,后者走内推或放弃。

**学历写得模糊一点没关系。** 学历是背调必查项,不实的后果是入职后被开除。专科、自考、非全日制都如实写。

**把课程时间写成工作经验。** 自学一年多的课程项目是个人项目,不是 AI 工作年限。投要求 AI 年限的岗位时,坦率说明经验来源。

## 学习资料

### 文档与文章

- [Tech Interview Handbook · Resume](https://www.techinterviewhandbook.org/resume/):「Experience」一节讲工作经历怎么写成果,对转方向的人也适用,20 分钟。
- [网易 · Agent 应用开发工程师](https://hr.163.com/job-detail.html?id=76697):「2 年以上大模型 / 智能体开发经验」是 AI 方向年限写法的典型,同时写着「具备基础前后端开发能力」,前端出身读它会有信心。
- [智联招聘 · AI 智能体(FDE)工程师(中兵数字)](https://www.zhaopin.com/jobdetail/CCL1276161630J40883543101.htm):「其中至少 1 年与 AI 应用相关」和那个 en dash 的出处。
- [Python 文档 · re 模块](https://docs.python.org/zh-cn/3.12/library/re.html):查「字符集合 `[]`」和「`{m,n}?` 非贪婪」两条,对照今天的 `YEARS` 和 `AI_YEARS`。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1gQsGzYEZE&autoplay=0&high_quality=1" title="转行简历的写法 附参考模版" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>Melissa职业规划 · 转行简历的写法 附参考模版 · 10 分钟,讲转方向的人怎么把原来的经历和目标岗位接上,和今天「换角度」那节对照看。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1f64y1R7CT&autoplay=0&high_quality=1" title="程序员专科学历包装本科学历,拿到月薪3万,HR发现后被开除" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>余胜军说java编程 · 程序员专科学历包装本科学历,拿到月薪3万,HR发现后被开除 · 3 分半,学历造假的真实后果,看完就知道为什么学历只有「写真的」一条路。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1n7411P7At&autoplay=0&high_quality=1" title="给低学历要入行做程序员的几点建议" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>lookroot · 给低学历要入行做程序员的几点建议 · 6 分钟,2020 年的视频,行情数字过时了,但「用作品和内推绕过学历筛选」的思路今天仍然成立。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/SYlB9JcoJng" title="The Tech Resume Inside-Out with Gergely Orosz [Coding Career Chats]" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Shawn Wang (swyx) · The Tech Resume Inside-Out with Gergely Orosz [Coding Career Chats] · 前 Uber 工程经理聊招聘方怎么读工作经历,以及转方向的人该突出什么。</figcaption>
</figure>

### 书籍

- Gergely Orosz《The Tech Resume Inside Out》(自出版,2020):讲不同背景(转行、自学、资深)的人怎么写工作经历,读转行和非典型背景那几章,1 小时。
- John Sonmez《Soft Skills: The Software Developer's Life Manual》(Manning,2014):职业规划那部分讲了怎么看待门槛和怎么推销自己,不必全读,翻目录挑「职业」相关章节,1 小时。

### 开源项目与代码

- [posquit0/Awesome-CV](https://github.com/posquit0/Awesome-CV):LaTeX 简历模板,英文简历常用,明天排一页简历时可以选它。
- [Overleaf 简历模板](https://www.overleaf.com/latex/templates):在线编辑 LaTeX 模板,不用装任何东西。

## 自测

1. 「换角度改写」的边界是什么?举一个越界的例子。

<details><summary>答案</summary>

做事的人还是你、你在里面的角色不变、数字和技术都是原来就有的。越界的例子:事实是「参与排查 6 起白屏,用 Sentry 定位」,改写成「主导 6 起线上故障根因分析,建立 Tracing 体系」,职责从参与升到主导,技术从 Sentry 变成了没做过的 Tracing 体系。

</details>

2. `re.search(r"(\d+)\s*-\s*(\d+)\s*年", "1–3 年开发经验")` 为什么返回 None?怎么改?

<details><summary>答案</summary>

文本里的横线是 en dash「–」(U+2013),不是减号「-」(U+002D),正则里的 `-` 只匹配减号。改成字符集合 `[-–—~至]`,把减号、en dash、em dash、波浪线和「至」都包进去。

</details>

3. 「硕士优先」和「硕士及以上」分别该怎么对待?

<details><summary>答案</summary>

「硕士优先」是软门槛,本科照投;「硕士及以上」是硬门槛,初筛通常按条件过滤,本科靠作品集很难越过,特别想去就找内推让简历直接到用人团队,否则放弃,把精力放在八成只要本科的岗位上。

</details>

4. 检查脚本对 f1「三个面向客户的业务模块」报了通过,你为什么还要改它?

<details><summary>答案</summary>

脚本只查数字、英文词和职责级别有没有凭空多出来,查不了意思。管理后台的用户是客户公司的管理员,硬说「面向客户」字面不算错,但 JD 里的「面向客户 / 交付」指和客户一起定需求、驻场交付,两个意思不同。面试官问「你直接对接过哪些客户」就接不住,所以删掉,不去对这个关键词。

</details>

5. (面试题)「你做 AI 方向不到一年,我们要求至少一年 AI 应用经验,你怎么看?」

<details><summary>答案</summary>

参考答法:先承认,我的 AI 经验来自个人项目,没有一年的 AI 方向全职经历。然后讲深度:SupportPilot 有三层评测、注入测试、成本账本,数字都有口径;再讲迁移:我 3 年前端里做过 E2E 回归门禁和 AI 助手的流式前端,做 Agent 评测和界面时这些经验是直接用上的。最后承认差距:我缺的是线上真实流量,所以我在项目里用评测集、注入测试和账本去逼近。不辩解,不夸大,把面试官的注意力引到你有证据的地方。

</details>

## 明天预告

Day 501 · 简历(四):代表项目说明、一页结构、证书和英文版。项目经历和工作经历都写好了,明天把它们拼成一页简历:先写一段 300 字的代表项目说明,再定一页的版面结构,看看 2026 年那几个 Agent 认证值不值得考,最后出一份英文版。
