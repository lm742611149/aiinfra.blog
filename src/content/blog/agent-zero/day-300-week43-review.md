---
title: 'Day 300 · 第 43 周复习:MCP 与编排(Day 294–299)'
description: '这一周先把问数 Agent 做成能自修、能评测、表多了也撑得住的样子,再讲 Agent Skills 的格式和加载器,最后转到 LangChain 和 LangGraph,画出第一张只有一个节点的图。今天画知识地图,每天一句话回顾,把 skill 格式检查和问数 SQL 判决装进一个单节点图做成「上线门禁」(8 条测试全过,三种故意改坏都被抓到),再默写本周三样核心代码、找四个藏起来的错误。'
pubDate: 2026-10-23
regime: none
tags: ['review', 'text-to-sql', 'skills', 'langgraph', 'pytest', 'agent-zero']
series: 'agent-zero'
day: 300
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 299](/blog/agent-zero/day-299-lg-one-node/) 画了第一张 LangGraph 图:一个状态、一个节点、两条边,走完「定义状态、建图纸、加节点、连边、编译、调用」六步。节点返回的是「更新」不是整个状态;返回不存在的键会被悄悄丢掉,原地修改 `state` 不算数;`TypedDict` 运行时不检查类型;41 张真工单过一遍,分成账单 18、订阅 8、技术 6、账号 9,每次 `invoke` 约 2.5 毫秒,比普通函数慢几百倍,但节点里一旦调模型这点开销就看不见了。

今天是第 43 周的最后一天。这一周讲的东西表面上没什么关系:问数、Skills、两个框架的名字。但它们有一个共同点,都在回答同一个问题:**Agent 的「周边」怎么做得可检查**。SQL 要过闸门和评测,skill 要过格式检查,框架的默认行为要自己实测。所以今天的小项目就做一个门禁,把这几道检查装进 Day 299 的单节点图里。

## 今天要解决的问题

1. 能对着一张图说出本周六天各解决了什么,并说出每天最该记住的一两个数字。
2. 做出小项目 `part05/review43_gate.py`:一个单节点图,同时检查一个 skill 目录和一批「模型写的 SQL」,配 8 条 pytest 测试,全部通过;再故意改坏三处,确认测试能抓到。
3. 合上文章默写出三样本周核心代码:放宽的结果比较函数、路径防护 `inside()`、单节点图,并让九条断言全过。
4. 能在一份代码里找出本周讲过的四类错误,并说出每一类的真实现象。

预计用时 3.5 小时。今天不调模型,花费 ¥0。

前置:本周的 [Day 294](/blog/agent-zero/day-294-text-to-sql-3/) 到 [Day 299](/blog/agent-zero/day-299-lg-one-node/)。要用到 `part05/text2sql/` 里的 `safe_db.py`、`eval_sql.py`,`part05/skills/skill_check.py` 和 `.claude/skills/refund-policy/`,`part05/lg/billing_tools.py`,Day 280 的 `cloudledger/seed.py`,以及 Day 287 的 `pyproject.toml` 里 `[tool.pytest]` 那一段。

学法:先对照逐行敲一遍(不复制粘贴)并跑通;第二天合上文章默写核心部分;做练习,做不出再展开参考答案,看完关掉重写一遍。复习日的默写最要紧,练习 1 请真的合上文章写。

所有命令在 `agent-zero-lab/` 根目录跑(我的是 `/Users/你/agent-zero-lab`)。先重置业务库,免得前几天的实验留下数据让数字对不上:

```bash
cd /Users/你/agent-zero-lab
uv run python cloudledger/seed.py
uv run python -m part05.skills.skill_check .claude/skills/refund-policy
```

<div class="line-notes">

- `uv run python cloudledger/seed.py` 删库重建,固定随机种子,每次都是 30 个客户、123 张发票、41 张工单。输出 `已生成 cloudledger.db: {'customers': 30, 'subscriptions': 30, 'invoices': 123, 'tickets': 41}`。
- `uv run python -m part05.skills.skill_check .claude/skills/refund-policy` 确认 Day 296 的 skill 还在、格式没坏。应该输出 `通过  .claude/skills/refund-policy`。今天的门禁要检查的就是它。

</div>

## 本周知识地图

<figure>
<svg viewBox="0 0 640 310" role="img" aria-label="第 43 周知识地图:左列问数两天,294 问数循环与评测,295 表多了怎么办;中列 Skills 两天,296 格式与检查器,297 加载器与 token;右列编排两天,298 LangChain 和 LangGraph 的关系,299 单节点图;下方是今天的小项目上线门禁,左列提供 run_sql 和 matches,中列提供 skill_check,右列提供单节点图">
<rect x="0" y="0" width="640" height="310" fill="var(--paper-raised)"/>
<g font-family="var(--font-mono)" font-size="12">
<text x="20" y="22" fill="var(--ink-soft)">问数</text>
<text x="240" y="22" fill="var(--ink-soft)">Skills</text>
<text x="460" y="22" fill="var(--ink-soft)">编排</text>
<rect x="20" y="30" width="160" height="50" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="100" y="52" fill="var(--ink)" text-anchor="middle">294 问数循环</text>
<text x="100" y="69" fill="var(--ink-soft)" text-anchor="middle" font-size="11">自修 · 10 题评测 EX</text>
<rect x="20" y="92" width="160" height="50" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="100" y="114" fill="var(--ink)" text-anchor="middle">295 表多了</text>
<text x="100" y="131" fill="var(--ink-soft)" text-anchor="middle" font-size="11">检索 · 挑表 · 语义层</text>
<rect x="240" y="30" width="160" height="50" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="320" y="52" fill="var(--ink)" text-anchor="middle">296 Skill 格式</text>
<text x="320" y="69" fill="var(--ink-soft)" text-anchor="middle" font-size="11">SKILL.md · 检查器</text>
<rect x="240" y="92" width="160" height="50" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="320" y="114" fill="var(--ink)" text-anchor="middle">297 加载器</text>
<text x="320" y="131" fill="var(--ink-soft)" text-anchor="middle" font-size="11">三层 · token · 恶意 skill</text>
<rect x="460" y="30" width="160" height="50" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="540" y="52" fill="var(--ink)" text-anchor="middle">298 两个库的关系</text>
<text x="540" y="69" fill="var(--ink-soft)" text-anchor="middle" font-size="11">依赖树 · create_agent</text>
<rect x="460" y="92" width="160" height="50" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="540" y="114" fill="var(--ink)" text-anchor="middle">299 单节点图</text>
<text x="540" y="131" fill="var(--ink-soft)" text-anchor="middle" font-size="11">六步骨架 · 更新不是全量</text>
<rect x="150" y="206" width="340" height="76" rx="8" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="320" y="232" fill="var(--ink)" text-anchor="middle">今天的小项目</text>
<text x="320" y="252" fill="var(--ink)" text-anchor="middle">review43_gate.py</text>
<text x="320" y="270" fill="var(--ink-soft)" text-anchor="middle" font-size="11">一个节点 · 三种检查 · 8 条测试</text>
<line x1="100" y1="142" x2="210" y2="206" stroke="var(--ink-soft)"/>
<line x1="320" y1="142" x2="320" y2="206" stroke="var(--ink-soft)"/>
<line x1="540" y1="142" x2="430" y2="206" stroke="var(--ink-soft)"/>
<text x="46" y="188" fill="var(--ink-faint)" font-size="11">run_sql · matches</text>
<text x="330" y="180" fill="var(--ink-faint)" font-size="11">skill_check</text>
<text x="470" y="188" fill="var(--ink-faint)" font-size="11">单节点图</text>
</g>
</svg>
<figcaption>上面六天,下面一个小项目。左列的执行器和比较函数、中列的格式检查器、右列的单节点图,今天各出一件,拼成一个门禁。</figcaption>
</figure>

先把这周实测出来的数字摆在一张表里。面试被问到「你做过 Text-to-SQL 吗」「Skills 省了多少 token」,答案要靠这些数,不能靠印象:

| 天 | 做了什么 | 最该记住的数 |
| --- | --- | --- |
| 294 | 问数循环:写 SQL、执行、被拒绝带原因重写、结果自检一次、回答;10 道题评测 | 第一次 8/10,两道错题都是评测器错(模型多选了一列),放宽比较函数后 10/10;三遍评测共 90 次调用约 ¥0.06 |
| 295 | 表多到 68 张:全量说明书、embedding 检索、让模型挑表、语义层;BIRD 和 Spider 2.0 两个基准 | 说明书 12484 字符、输入 token 是小库的 3.1 倍,10/10 掉到 9/10;检索召回 7/10(k 从 3 涨到 6 不变);模型挑表 10/10 |
| 296 | Skill 是什么:一个带 `SKILL.md` 的文件夹;写 `refund-policy`;检查器 | 让模型心算退款金额,直接报数 12 题对 3 题,写步骤 12 题全对但输出多了 130 倍的 token |
| 297 | 沙箱里让 Claude Code 用 skill;自己写加载器;量 token;恶意 skill 实验 | 两个 skill 时的输入 token:一句话 47、加目录 169、加三个工具定义 689、全文 785、连脚本 2159 |
| 298 | `uv tree` 证明谁依赖谁;同一个任务写手写版和 `create_agent` 版 | `langchain` 直接依赖 `langgraph`,反过来不成立;工具抛 `ConnectionError`,手写版交给模型,默认 `create_agent` 整个抛出来 |
| 299 | 六步骨架,一个节点,两条边 | 每次 `invoke` 约 2.5 毫秒,普通函数几微秒;返回不存在的键和原地修改 `state` 都不报错 |

第二张表是这一周所有「检查」各自管什么,门禁要把其中三样装在一起:

| 检查 | 来自 | 管什么 | 管不到什么 |
| --- | --- | --- | --- |
| `run_sql` 的三道闸 | Day 292、294 | 模型写的 SQL 能不能执行:只读、单条、没有越界 | SQL 能跑但结果不对 |
| `matches` 比较结果集 | Day 294 | 模型 SQL 的结果和标准答案是否相同,允许多选列、不看顺序 | 标准答案本身有并列或歧义 |
| `skill_check` | Day 296 | skill 目录合不合开放标准的格式 | description 写得清不清、模型会不会触发 |
| 评测集 | Day 294、296、297 | 一批固定的问题上准不准 | 评测集没覆盖的问题 |
| `uv tree`、`inspect` | Day 298 | 包和函数的真实关系,不信文章 | 运行时行为(要实测) |
| `invoke` 之后打印状态 | Day 299 | 节点到底写了哪些字段 | 键名拼错这类悄悄丢的错只能靠肉眼或测试 |

## 本周每天一句话

- [Day 294](/blog/agent-zero/day-294-text-to-sql-3/):把说明书和 `safe_db` 接成问数循环 `ask_data.py`,先用台词写死的假模型走通骨架再换真模型,自检只做一次;10 道题第一次 8/10,看错题才发现是评测器的比较函数太严,放宽后 10/10,又查出第 9 题标准答案有并列。
- [Day 295](/blog/agent-zero/day-295-text-to-sql-4/):造一个 68 张表的仓库,全量说明书长到 12484 字符、token 3.1 倍;embedding 检索只召回 7/10,漏的是「MRR」「欠费」这类业务词;让模型从表目录里挑表 10/10;语义层让模型只能点指标,口径永远一致,但点错指标的问题还在。
- [Day 296](/blog/agent-zero/day-296-skills-1/):Skill 是一个文件夹,开头是元数据(name 和 description 常驻上下文),正文触发时才读,参考文件和脚本用到才读;金额交给脚本算,因为模型心算 12 题只对 3 题;写了 `skill_check.py` 检查格式。
- [Day 297](/blog/agent-zero/day-297-skills-2/):先造只能读写一个目录的沙箱,让 Claude Code 用 skill 看它什么时候触发;再自己写加载器(三个按需取内容的工具、路径防护、不经 shell、环境变量过滤),量出目录比全文省多少;恶意 skill 实验说明「模型拒绝了」不等于安全。
- [Day 298](/blog/agent-zero/day-298-langchain-vs-langgraph/):LangChain 1.x 建在 LangGraph 上,不是二选一;`create_agent` 返回的就是一张有 `model` 和 `tools` 两个节点的图;旧教程的 `create_react_agent` 已弃用;框架默认值和手写版不一样(工具抛异常),换框架要一条一条核对。
- [Day 299](/blog/agent-zero/day-299-lg-one-node/):六步骨架(状态、图纸、节点、边、编译、调用),节点返回更新、框架负责合并;`TypedDict` 不检查类型,返回不存在的键和原地改 `state` 都悄悄无效,没连 `END` 在 1.2.16 里居然也能编译运行。

## 本周小项目:上线门禁

这周做的几样东西,有一个共同的麻烦:**改了就不知道有没有改坏**。换了个模型,问数的 SQL 还对不对?改了 skill 的描述,格式还合规吗?手工去跑十几个脚本太累,所以做一个门禁:给它一个 skill 目录和一批「模型写的 SQL 加标准 SQL」,它一次判决,哪里有问题、问题是什么,都写出来。

只用这周学过的东西:

- skill 那一半,直接用 Day 296 的 `skill_check.check`;
- SQL 那一半,用 Day 292 的 `run_sql`(被拒绝统一抛 `SQLRejected`)执行,再用 Day 294 的 `matches` 比较结果集;
- 把这些装进 **一个节点**,用 Day 299 的六步建成图。两个检查本来可以拆成两个节点,但两个节点怎么串还没学(Day 301 的内容),所以今天故意写成一个节点,最后一节会回头说这有什么代价;
- 用 pytest 写合同(Day 287),再故意改坏三处,看测试抓不抓得住。

```python
# agent-zero-lab/part05/review43_gate.py
"""第 43 周小项目:上线门禁。一个节点的图,把「skill 格式检查」和「模型写的 SQL 对不对」两道检查装在一起。
用法:uv run python -m part05.review43_gate"""
from pathlib import Path
from typing import NotRequired, TypedDict

from langgraph.graph import END, START, StateGraph

from part05.skills.skill_check import check as check_skill
from part05.text2sql.eval_sql import matches
from part05.text2sql.safe_db import SQLRejected, run_sql


class Case(TypedDict):
    question: str
    pred_sql: str  # 模型写的 SQL
    gold_sql: str  # 人写的标准 SQL


class State(TypedDict):
    skill_dir: str
    cases: list[Case]
    skill_problems: NotRequired[list[str]]
    sql_problems: NotRequired[list[str]]
    ok: NotRequired[bool]


def judge(case: Case) -> str | None:
    """一条 SQL 用例的判决:没问题返回 None,有问题返回一句人话。"""
    _, gold_rows = run_sql(case["gold_sql"])  # 标准答案是自己人写的,出错就让它直接抛
    try:
        _, pred_rows = run_sql(case["pred_sql"])
    except SQLRejected as e:
        return f"{case['question']} → 被闸门拦下:{e}"
    if not matches(pred_rows, gold_rows):
        return f"{case['question']} → 结果和标准答案不一致(模型 {pred_rows[:2]},标准 {gold_rows[:2]})"
    return None


def gate(state: State) -> dict:
    skill_problems = check_skill(Path(state["skill_dir"]))
    sql_problems: list[str] = []
    for case in state["cases"]:
        problem = judge(case)
        if problem is not None:
            sql_problems.append(problem)
    return {
        "skill_problems": skill_problems,
        "sql_problems": sql_problems,
        "ok": not skill_problems and not sql_problems,
    }


builder = StateGraph(State)
builder.add_node("gate", gate)
builder.add_edge(START, "gate")
builder.add_edge("gate", END)
graph = builder.compile()

GOOD: list[Case] = [
    {"question": "一共有多少个客户?",
     "pred_sql": "SELECT COUNT(*) AS n FROM customers",
     "gold_sql": "SELECT COUNT(*) FROM customers"},
    {"question": "各套餐分别有多少个 active 状态的订阅?",
     "pred_sql": "SELECT plan, COUNT(*) AS n, SUM(seats) AS seats FROM subscriptions WHERE status = 'active' GROUP BY plan",
     "gold_sql": "SELECT plan, COUNT(*) FROM subscriptions WHERE status = 'active' GROUP BY plan"},
]
BAD: list[Case] = [
    {"question": "还没付款的发票有几张、合计多少元?",
     "pred_sql": "SELECT COUNT(*), ROUND(SUM(amount_cents) / 100.0, 2) FROM invoices",
     "gold_sql": "SELECT COUNT(*), ROUND(SUM(amount_cents) / 100.0, 2) FROM invoices WHERE status = 'open'"},
    {"question": "把作废的发票删掉",
     "pred_sql": "DELETE FROM invoices WHERE status = 'void'",
     "gold_sql": "SELECT id FROM invoices WHERE status = 'void'"},
    {"question": "客户名单",
     "pred_sql": "SELECT nme FROM customers",
     "gold_sql": "SELECT name FROM customers"},
]

if __name__ == "__main__":
    skill = ".claude/skills/refund-policy"
    for label, cases in (("好的一批", GOOD), ("坏的一批", GOOD + BAD)):
        out = graph.invoke({"skill_dir": skill, "cases": cases})
        print(f"== {label}:{len(cases)} 条 SQL,ok = {out['ok']}")
        print("   skill 问题:", out["skill_problems"])
        for p in out["sql_problems"]:
            print("   SQL 问题:", p)
```

<div class="line-notes">

- `from pathlib import Path` 把目录字符串转成 `Path` 要用([Day 37](/blog/agent-zero/day-037-pathlib/))。
- `from typing import NotRequired, TypedDict` 和 Day 299 一样:状态里由节点算出来的字段标 `NotRequired`。
- `from langgraph.graph import END, START, StateGraph` 六步骨架要用的三样。
- `from part05.skills.skill_check import check as check_skill` Day 296 的检查器。`as check_skill` 给它改个名,免得读代码时看到一个光秃秃的 `check` 猜不出检查什么。
- `from part05.text2sql.eval_sql import matches` Day 294 放宽后的比较函数。**注意**:这一行会顺带导入 `eval_sql.py`,而它又导入 `ask_data.py`,里面有一行模块级的 `llm = LLMClient()`。创建对象只读 `.env`,不发请求,所以不花钱,但 `.env` 不在就会在这里报错。
- `from part05.text2sql.safe_db import SQLRejected, run_sql` Day 292 的执行器,被拒绝、列名写错、超时统一抛 `SQLRejected`。
- `class Case(TypedDict):` 一条 SQL 用例的形状:一个问题、模型写的 SQL、标准 SQL。和 Day 294 里 `CASES` 的 `(问题, 标准 SQL)` 比,多了一项模型写的。
- `pred_sql: str  # 模型写的 SQL` 门禁不关心这条 SQL 是哪个模型、第几次写的,拿到就判。这也让它能离线跑,不调模型。
- `class State(TypedDict):` 整张图的状态。
- `cases: list[Case]` 一批用例,每项都是一个 `Case`。
- `skill_problems: NotRequired[list[str]]` skill 检查的问题列表,节点算出来才有,所以 `NotRequired`。空列表是通过。
- `ok: NotRequired[bool]` 总结论。前面三个检查有任何一个有问题就是 `False`。
- `def judge(case: Case) -> str | None:` 判一条用例,返回 `None` 表示没问题,返回字符串就是问题描述。`str | None` 读作「字符串或者没有」([Day 46](/blog/agent-zero/day-046-type-hints-2/))。
- `_, gold_rows = run_sql(case["gold_sql"])` 先跑标准答案。`run_sql` 返回(列名, 行),列名用不上,用 `_` 接住。标准 SQL 是人写的,这里**不接异常**:它要是出错说明评测集坏了,应该大声失败,不该当成模型的错。
- `_, pred_rows = run_sql(case["pred_sql"])` 再跑模型的 SQL。放在 `try` 里。
- `except SQLRejected as e:` 模型的 SQL 被拒绝或报错,把原因原样带进问题描述。
- `return f"{case['question']} → 被闸门拦下:{e}"` f-string 里取字典的值,外层用双引号、里面的键用单引号,避免引号打架。代入「把作废的发票删掉」:`e` 是「只允许 SELECT,收到的是 DELETE」。
- `if not matches(pred_rows, gold_rows):` 两边都跑成功了,比结果集。代入「还没付款的发票」那条:模型忘了 `WHERE status = 'open'`,得到 `[(123, 431394.0)]`,标准是 `[(10, 22533.0)]`,不相等。
- `return f"{case['question']} → 结果和标准答案不一致` 只截两行做样子,别把整张表打出来。
- `return None` 没问题。
- `def gate(state: State) -> dict:` 唯一的节点。收到状态,返回更新。
- `skill_problems = check_skill(Path(state["skill_dir"]))` 第一个检查:skill 目录。`state["skill_dir"]` 是字符串,转成 `Path` 再给检查器。
- `sql_problems: list[str] = []` 攒问题的空列表。
- `for case in state["cases"]:` 对每条用例各判一次。
- `problem = judge(case)` 判决结果,`None` 或一句话。
- `if problem is not None:` 判断「是不是没问题」用 `is None`/`is not None`,不用 `==`。
- `sql_problems.append(problem)` 有问题才收集。
- `"ok": not skill_problems and not sql_problems,` 空列表在条件里是假,所以 `not 空列表` 为真。两个都为空才是 `True`。
- `builder = StateGraph(State)` 六步骨架里的第 2 步。后面四行就是 Day 299 的第 3 到 5 步,只是节点名叫 `"gate"`。
- `GOOD: list[Case] = [` 两条应该放行的用例。
- `"pred_sql": "SELECT plan, COUNT(*) AS n, SUM(seats) AS seats FROM subscriptions WHERE status = 'active' GROUP BY plan",` 模型比标准答案多选了一列座位数。Day 294 里这正是评测器误判的原因,`matches` 放宽之后应当放行。
- `BAD: list[Case] = [` 三条应该被拦的用例,覆盖三种不同的失败:结果不对、被闸门拦下、列名写错。
- `if __name__ == "__main__":` 直接运行时才跑下面的演示;测试文件导入时不跑。
- `skill = ".claude/skills/refund-policy"` 要检查的 skill。
- `for label, cases in (("好的一批", GOOD), ("坏的一批", GOOD + BAD)):` 两批各跑一次。`GOOD + BAD` 是两个列表拼接,5 条。
- `out = graph.invoke({"skill_dir": skill, "cases": cases})` 第 6 步。初始状态只给两个必填字段。
- `print(f"== {label}:{len(cases)} 条 SQL,ok = {out['ok']}")` 好的一批 2 条、坏的一批 5 条。
- `for p in out["sql_problems"]:` 把每条问题打印出来。

</div>

```bash
uv run python -m part05.review43_gate
```

```text
== 好的一批:2 条 SQL,ok = True
   skill 问题: []
== 坏的一批:5 条 SQL,ok = False
   skill 问题: []
   SQL 问题: 还没付款的发票有几张、合计多少元? → 结果和标准答案不一致(模型 [(123, 431394.0)],标准 [(10, 22533.0)])
   SQL 问题: 把作废的发票删掉 → 被闸门拦下:只允许 SELECT,收到的是 DELETE
   SQL 问题: 客户名单 → 被闸门拦下:执行出错:no such column: nme
```

好的一批:两条都放行,包括那条多选了一列的。坏的一批:前两条好用例照样过,后面三条各被一种方式拦住,原因都写得清清楚楚。注意第一条的原因:`SELECT COUNT(*), ROUND(SUM(...)) FROM invoices` **能正常执行、也不报错**,只是漏了 `WHERE status = 'open'`,数字 123 张、431394 元和标准的 10 张、22533 元差了一个数量级。这类错只有拿结果和标准答案比才看得出来,是 Day 291 说的「数字能跑出来但口径是模型编的」。

### 把它写成合同

和 Day 287、293 一样,每条测试只锁一个行为。这个门禁不调模型、不联网,8 条测试加起来一秒多:

```python
# agent-zero-lab/tests/test_review43_gate.py
"""第 43 周小项目的合同:门禁该放行的放行,该拦的拦,并说清楚拦的原因。不调模型,不联网。"""
from pathlib import Path

import pytest

from part05.review43_gate import BAD, GOOD, Case, State, graph

SKILL = ".claude/skills/refund-policy"


def run(cases: list[Case], skill_dir: str = SKILL) -> dict:
    return graph.invoke(State(skill_dir=skill_dir, cases=cases))


def test_good_batch_passes() -> None:
    out = run(GOOD)
    assert out["ok"] is True
    assert out["skill_problems"] == []
    assert out["sql_problems"] == []


def test_extra_column_is_not_a_failure() -> None:
    # 模型多选了 n 和 seats 两列,Day 294 的比较函数应当放过
    out = run([GOOD[1]])
    assert out["ok"] is True


@pytest.mark.parametrize(
    ("case", "reason"),
    [
        (BAD[0], "结果和标准答案不一致"),
        (BAD[1], "只允许 SELECT"),
        (BAD[2], "no such column"),
    ],
)
def test_bad_sql_is_caught_with_reason(case: Case, reason: str) -> None:
    out = run([case])
    assert out["ok"] is False
    assert len(out["sql_problems"]) == 1
    assert reason in out["sql_problems"][0]
    assert case["question"] in out["sql_problems"][0]


def test_broken_skill_is_caught(tmp_path: Path) -> None:
    bad = tmp_path / "Refund_Policy"  # 目录名大写加下划线
    bad.mkdir()
    (bad / "SKILL.md").write_text("---\nname: refund-policy\ndescription: x\n---\n正文\n", encoding="utf-8")
    out = run(GOOD, skill_dir=str(bad))
    assert out["ok"] is False
    assert out["sql_problems"] == []  # SQL 那一半不受影响
    assert any("和目录名" in p for p in out["skill_problems"])


def test_missing_skill_dir_is_reported() -> None:
    out = run([], skill_dir=".claude/skills/not-exist")
    assert out["skill_problems"] == ["缺少 SKILL.md"]
    assert out["ok"] is False


def test_invoke_does_not_touch_input() -> None:
    init = State(skill_dir=SKILL, cases=list(GOOD))
    run_before = dict(init)
    graph.invoke(init)
    assert init == run_before
    assert "ok" not in init
```

<div class="line-notes">

- `from pathlib import Path` 给 `tmp_path` 的类型标注用。
- `import pytest` 用 `parametrize` 和 `tmp_path`([Day 73](/blog/agent-zero/day-073-pytest-3/))。
- `from part05.review43_gate import BAD, GOOD, Case, State, graph` 把门禁里的用例和图直接拿来测。要能 `import part05...`,靠的是 `pyproject.toml` 里 `pythonpath = ["."]`(Day 287 加的)。
- `SKILL = ".claude/skills/refund-policy"` 测试默认检查的 skill,相对仓库根目录写,所以要在 `agent-zero-lab/` 里跑 `pytest`。
- `def run(cases: list[Case], skill_dir: str = SKILL) -> dict:` 测试的小帮手,少写重复代码。
- `return graph.invoke(State(skill_dir=skill_dir, cases=cases))` `State(...)` 是 `TypedDict` 的构造写法,得到的就是一个普通字典 `{"skill_dir": ..., "cases": ...}`,好处是编辑器会检查键名和类型。
- `def test_good_batch_passes() -> None:` 好的两条:整体放行。
- `assert out["ok"] is True` 用 `is True` 而不是只看真假,防止 `ok` 被写成别的「看起来为真」的东西(比如非空列表)。
- `def test_extra_column_is_not_a_failure() -> None:` 单独锁一条:多选一列不算错。这是 Day 294 踩过的坑,值得单独一条测试。
- `out = run([GOOD[1]])` 只跑第二条(有多选列的那条)。
- `@pytest.mark.parametrize(` 把同一个测试函数用三组参数各跑一次([Day 73](/blog/agent-zero/day-073-pytest-3/))。
- `(BAD[0], "结果和标准答案不一致"),` 第一组:结果不对,期望原因里有这句话。
- `def test_bad_sql_is_caught_with_reason(case: Case, reason: str) -> None:` 三组参数共用的测试体。
- `assert len(out["sql_problems"]) == 1` 一条坏用例应该恰好产生一条问题,不多不少。
- `assert reason in out["sql_problems"][0]` 问题里要有具体原因,不能只说「失败了」。
- `def test_broken_skill_is_caught(tmp_path: Path) -> None:` `tmp_path` 是 pytest 给每个测试准备的临时目录,测完自动清理,不会污染真实的 `.claude/skills/`。
- `bad = tmp_path / "Refund_Policy"  # 目录名大写加下划线` 故意起一个不合规的目录名。
- `(bad / "SKILL.md").write_text(` 在里面写一个 `name: refund-policy` 的 `SKILL.md`,和目录名对不上。
- `assert out["sql_problems"] == []  # SQL 那一半不受影响` 用了 `GOOD` 两条 SQL,它们应该照样没问题。这条断言要求两个检查互相独立。
- `assert any("和目录名" in p for p in out["skill_problems"])` 实际的问题是 `name「refund-policy」和目录名「Refund_Policy」不一致`。
- `def test_missing_skill_dir_is_reported() -> None:` 目录根本不存在。
- `assert out["skill_problems"] == ["缺少 SKILL.md"]` Day 296 的检查器对不存在的目录给的就是这一句。
- `def test_invoke_does_not_touch_input() -> None:` 锁住 Day 299 的结论:`invoke` 不改你传进去的字典。
- `run_before = dict(init)` 先复制一份。
- `assert init == run_before` 调用之后原字典没变。
- `assert "ok" not in init` 并且没有被塞进 `ok`。

</div>

```bash
uv run pytest -q tests/test_review43_gate.py
```

```text
........                                                                 [100%]
8 passed in 1.20s
```

8 条,不到 2 秒。注意这里没有一条用到网络和模型,换句话说**这道门禁可以放进每次提交都跑的 CI 里**,花费是零。

### 这些测试真的能抓住 bug 吗

有测试不等于测试有用。和 Day 293 一样,故意改坏三处,看谁会红。每次改完跑一遍,再改回来。

**改坏一:把放宽的比较函数换回严格相等。** 这是 Day 294 第一次评测掉进去的坑:

```bash
cp part05/review43_gate.py /tmp/gate.bak
sed -i '' 's/    if not matches(pred_rows, gold_rows):/    if pred_rows != gold_rows:/' part05/review43_gate.py
uv run pytest -q tests/test_review43_gate.py
cp /tmp/gate.bak part05/review43_gate.py
```

<div class="line-notes">

- `cp part05/review43_gate.py /tmp/gate.bak` 先备份。这次实验要改三次,最后统一从备份还原,比反向 `sed` 稳。
- `sed -i '' 's/    if not matches(pred_rows, gold_rows):/    if pred_rows != gold_rows:/' part05/review43_gate.py` 把用 `matches` 的那行换成「两个列表不相等」。`-i ''` 是 macOS 的就地修改写法,Linux 上是 `-i`。前面保留四个空格,只匹配 `judge` 里缩进的那一行。
- `uv run pytest -q tests/test_review43_gate.py` 只跑今天这一个文件。
- `cp /tmp/gate.bak part05/review43_gate.py` 还原。

</div>

```text
FAILED tests/test_review43_gate.py::test_good_batch_passes
FAILED tests/test_review43_gate.py::test_extra_column_is_not_a_failure
FAILED tests/test_review43_gate.py::test_broken_skill_is_caught
3 failed, 5 passed in 1.29s
```

三条红。前两条是我预料的:多选一列的那条被判错了。第三条我没预料到:`test_broken_skill_is_caught` 为了检查 skill,顺手用了 `GOOD` 当 SQL,于是被牵连,它那句 `assert out["sql_problems"] == []` 红了。这个意外其实是好事:它说明「skill 检查和 SQL 检查互相独立」这条规矩被测试锁住了,SQL 那一半坏了,skill 的测试也会告诉你。

**改坏二:`ok` 只看 SQL,忘了看 skill。**

```bash
sed -i '' 's/        "ok": not skill_problems and not sql_problems,/        "ok": not sql_problems,/' part05/review43_gate.py
uv run pytest -q tests/test_review43_gate.py
cp /tmp/gate.bak part05/review43_gate.py
```

<div class="line-notes">

- `sed -i '' 's/        "ok": not skill_problems and not sql_problems,/        "ok": not sql_problems,/' part05/review43_gate.py` 把总结论里 `skill_problems` 那一半删掉,八个空格是 `gate` 返回字典里的缩进。
- `uv run pytest -q tests/test_review43_gate.py` 再跑。
- `cp /tmp/gate.bak part05/review43_gate.py` 还原。

</div>

```text
FAILED tests/test_review43_gate.py::test_broken_skill_is_caught
FAILED tests/test_review43_gate.py::test_missing_skill_dir_is_reported
2 failed, 6 passed in 1.23s
```

恰好两条红,都是 skill 坏了却还显示 `ok` 的情况。skill 问题照样被收集进了 `skill_problems`,只是总结论没把它算进去,一个只看 `ok` 的脚本(比如 CI)会误以为全部通过。

**改坏三:返回字典里把键名拼错一个字母。** 这是 Day 299 讲的「悄悄丢掉」:

```bash
sed -i '' 's/        "sql_problems": sql_problems,/        "sql_problem": sql_problems,/' part05/review43_gate.py
uv run pytest -q tests/test_review43_gate.py
cp /tmp/gate.bak part05/review43_gate.py
```

<div class="line-notes">

- `sed -i '' 's/        "sql_problems": sql_problems,/        "sql_problem": sql_problems,/' part05/review43_gate.py` 把返回字典里的键 `sql_problems` 改成 `sql_problem`(少了个 s)。`State` 里没有这个字段,框架会悄悄丢掉这次更新。
- `uv run pytest -q tests/test_review43_gate.py` 跑测试。
- `cp /tmp/gate.bak part05/review43_gate.py` 最后一次还原。

</div>

```text
FAILED tests/test_review43_gate.py::test_good_batch_passes
FAILED tests/test_review43_gate.py::test_bad_sql_is_caught_with_reason
FAILED tests/test_review43_gate.py::test_bad_sql_is_caught_with_reason
FAILED tests/test_review43_gate.py::test_bad_sql_is_caught_with_reason
FAILED tests/test_review43_gate.py::test_broken_skill_is_caught
5 failed, 3 passed in 1.25s
```

五条红,原因都是 `out["sql_problems"]` 不存在,抛 `KeyError`。图本身**没有报任何错**,`invoke` 照样返回,是测试读结果时才炸出来。这就是为什么 Day 299 反复说:返回的键名拼错不会报错,你需要测试去读它。(中间三条同名的 `test_bad_sql_is_caught_with_reason` 是同一个测试函数的三组参数,各红一次。)

三个改坏实验的共同点:每个都恰好被几条测试抓到,而且抓它们的原因和我预想的对得上或者能解释。最后还原之后再跑一次,8 条全绿,别漏了这一步。

### 一个节点装三件事,代价是什么

今天的 `gate` 一个节点里做了两个检查,第四个练习还会再加一个。好处是简单,代价也看得到:

- 想知道「skill 检查花了多久」「SQL 判决花了多久」,看不出来,只有一个总数;
- 某一个检查抛了没接住的异常(比如标准 SQL 写错了),整个节点失败,另一个检查的结果也拿不到;
- 想只重跑 SQL 那一半,不行,只能整个节点重来。

这些问题都是「该拆成两个节点」的信号。Day 301 讲两个节点怎么串起来,以及怎么用 `stream` 看到每个节点各自写了什么,那时候回头把 `gate` 拆开,就是一个很自然的练习。

## 本周错题与坑清单

这周写和跑的时候真实撞到的,按出现频率排。前面几天各自的「常见误区」里都有,这里只收最容易再犯的:

| 坑 | 真实报错或现象 | 怎么改 |
| --- | --- | --- |
| 分数低就去改提示词 | Day 294 第一次 8/10,两道错题模型其实答对了,多选一列被评测器判错 | 先读错题、先查评测器,再动提示词 |
| 比较结果集用列表 `==` | 行顺序一换、多选一列就判错(今天练习 3 的表) | `Counter` 比较(顺序无关、重复要数清),必要时挑列子集 |
| 标准答案没人看 | 第 9 题用了 `LIMIT 1`,数据里两家并列,「对」是碰巧 | 评测集写完把每条标准结果打出来看一遍 |
| 以为 `temperature=0` 每次一样 | 同一个问题多跑几次,有一次写出 `DELETE` | 评测多跑几遍看稳不稳 |
| 表多了就用 embedding 检索 | 召回只有 7/10,k 从 3 涨到 6 不变;业务词(MRR、欠费)匹配不上表名 | 业务词靠术语表或让模型挑表;看没参与调试的题上的分数 |
| 为评测集补规则分数涨了就收工 | 练习里 10 题涨到 10/10,5 个新问题一点没涨 | 看没参与调试的问题 |
| 把 skill 当更长的 system prompt | 只有一两套规则、每次都要用,直接写 prompt 更省事 | skill 适合「很多套、每次只用一两套」 |
| 让模型心算有唯一答案的数 | 直接报数 12 题对 3 题 | 金额、日期写成脚本,模型只读结果 |
| 脚本悄悄给出一个看着合理的错数 | 取「最近一张已付款发票」,翻出去年的,算出「可退 1089 元」,没有任何报错 | 脚本遇到数据不对要明确报错 |
| 以为「模型拒绝了」就安全 | 没防护时模型调了读 `.env` 的工具,文件内容已经进了发给厂商的请求 | 防护放在工具层:路径限制、不经 shell、环境变量过滤 |
| 写 `run_skill_script` 用 `shell=True` | 参数里一个分号就能夹带第二条命令(今天练习 2 复现) | 列表传参,不经 shell |
| 用 `startswith` 判断路径在不在目录里 | `refund-policy-evil` 以 `refund-policy` 开头,被放行(今天练习 2 复现) | `Path.is_relative_to`,且 `root` 要先 `resolve()` |
| 以为 LangChain 和 LangGraph 二选一 | `uv tree`:`langchain` 依赖 `langgraph` | 它们是上下两层 |
| 换框架后以为手写时做对的防护都还在 | 工具抛 `ConnectionError`,默认的 `create_agent` 整个调用抛出来 | 一条一条核对框架默认值,必要时加 `ToolErrorMiddleware` |
| 节点返回的键名拼错 | 没有任何报错,字段悄悄缺了(今天改坏三) | 键名从 `State` 里复制,写测试去读结果 |
| 在节点里直接改 `state` | 最终状态里没有这个字段 | 只有返回值算数 |
| `TypedDict` 当运行时校验 | 传整数进图,到节点里才 `TypeError` | 入口校验用 pydantic(Day 302) |

## 动手练习

**练习 1(默写):三样核心代码。** 合上文章,新建 `part05/review43_dictation.py`,写出:①`normalize(rows)` 和 `matches(pred, gold)`:行不看顺序但重复要数清,浮点保留两位,模型多选了列也算对;②`inside(root, rel)`:把 `rel` 接在 `root` 后面解析,结果必须还在 `root` 里面,否则抛 `PermissionError`;③一个单节点图 `make_graph()`:状态有 `text`,节点 `count` 把 `len(text)` 写进 `length`。写完用下面的检查脚本跑九条断言。

先看检查脚本(你写的代码要让它全过):

```python
# agent-zero-lab/part05/review43_dictation_check.py
"""练习 1 的检查脚本:对你默写的 review43_dictation.py 跑九条断言。用法:uv run python -m part05.review43_dictation_check"""
import tempfile
from pathlib import Path

from part05.review43_dictation import State, inside, make_graph, matches

checks: list[tuple[str, bool]] = []


def ok(name: str, cond: bool) -> None:
    checks.append((name, cond))
    print(("通过  " if cond else "失败  ") + name)


# 比较函数
gold = [("专业版", 10), ("企业版", 8), ("基础版", 12)]
ok("顺序不同算对", matches(list(reversed(gold)), gold))
ok("多一列算对", matches([(p, n, 99) for p, n in gold], gold))
ok("少一行算错", not matches(gold[:2], gold))
ok("重复一行算错", not matches(gold + [gold[0]], gold))
ok("浮点差零点零零零四算对", matches([(20273.0004,)], [(20273.0,)]))

# 路径防护:root 旁边放一个名字以 root 开头的"邻居",专门挑 startswith 的毛病
with tempfile.TemporaryDirectory() as d:
    root = (Path(d) / "refund-policy").resolve()
    (root / "references").mkdir(parents=True)
    (root / "references" / "policy.md").write_text("规则", encoding="utf-8")
    neighbour = Path(d) / "refund-policy-evil"
    neighbour.mkdir()
    (neighbour / "secret.txt").write_text("假密码", encoding="utf-8")

    ok("技能目录里的文件放行", inside(root, "references/policy.md").name == "policy.md")
    try:
        inside(root, "../refund-policy-evil/secret.txt")
        ok("名字以 root 开头的邻居目录被拦", False)
    except PermissionError:
        ok("名字以 root 开头的邻居目录被拦", True)
    try:
        inside(root, "../../etc/passwd")
        ok("向上跳出去被拦", False)
    except PermissionError:
        ok("向上跳出去被拦", True)

# 单节点图
out = make_graph().invoke(State(text="上个月的发票开错了"))
ok("单节点图算出长度 9", out.get("length") == 9)

failed = [name for name, cond in checks if not cond]
print(f"\n{len(checks) - len(failed)}/{len(checks)} 通过")
raise SystemExit(1 if failed else 0)
```

<div class="line-notes">

- `import tempfile` 标准库,用来建一个测完自动删除的临时目录。
- `from part05.review43_dictation import State, inside, make_graph, matches` 从**你默写的文件**里导入。名字必须一致:`State`、`inside`、`make_graph`、`matches`。
- `checks: list[tuple[str, bool]] = []` 记录每条断言的名字和结果。
- `def ok(name: str, cond: bool) -> None:` 小帮手:记下来并打印「通过」或「失败」。不用 `assert`,为的是一条失败后面的还能继续跑,一次看全。
- `ok("顺序不同算对", matches(list(reversed(gold)), gold))` `reversed` 把三行倒过来,代入后 pred 是 `[("基础版", 12), ("企业版", 8), ("专业版", 10)]`,应当算对。
- `ok("多一列算对", matches([(p, n, 99) for p, n in gold], gold))` 每行多一个 99,三列对两列,要挑列子集才能对上。
- `ok("少一行算错", not matches(gold[:2], gold))` 只给前两行。
- `ok("重复一行算错", not matches(gold + [gold[0]], gold))` 多出一行重复的。用 `set` 比较会漏掉这一条,这是用 `Counter` 的原因。
- `ok("浮点差零点零零零四算对", matches([(20273.0004,)], [(20273.0,)]))` 两位小数四舍五入后相同。
- `root = (Path(d) / "refund-policy").resolve()` 临时目录下建一个「技能目录」。**`.resolve()` 很重要**:在 macOS 上临时目录 `/var/...` 实际是 `/private/var/...` 的软链接,不先 `resolve`,`inside` 里的比较会出错。
- `neighbour = Path(d) / "refund-policy-evil"` 名字以 `refund-policy` 开头的邻居目录,专门用来抓「用字符串前缀判断」的写法。
- `ok("技能目录里的文件放行", inside(root, "references/policy.md").name == "policy.md")` 正常路径放行。
- `inside(root, "../refund-policy-evil/secret.txt")` 路径解析后是邻居目录里的文件,必须抛 `PermissionError`。没抛就走到下一行 `ok(..., False)`。
- `inside(root, "../../etc/passwd")` 彻底跳出临时目录,同样必须被拦。
- `out = make_graph().invoke(State(text="上个月的发票开错了"))` 单节点图,「上个月的发票开错了」是 9 个字。
- `raise SystemExit(1 if failed else 0)` 有失败就用退出码 1 结束,CI 能识别。

</div>

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part05/review43_dictation.py
"""练习 1 参考答案:默写本周三样核心代码。比较函数(Day 294)、路径防护(Day 297)、单节点图(Day 299)。"""
from collections import Counter
from itertools import combinations
from pathlib import Path
from typing import NotRequired, TypedDict

from langgraph.graph import END, START, StateGraph


def normalize(rows: list[tuple]) -> Counter:
    """行集合不比顺序,但重复的行要数清楚;浮点保留两位。"""
    return Counter(tuple(round(v, 2) if isinstance(v, float) else v for v in r) for r in rows)


def matches(pred: list[tuple], gold: list[tuple]) -> bool:
    """模型多选了几列也算对:挑出和标准答案列数相同的列子集,有一组对上就行。"""
    if normalize(pred) == normalize(gold):
        return True
    if not pred or not gold or len(pred[0]) <= len(gold[0]):
        return False
    want = normalize(gold)
    for idx in combinations(range(len(pred[0])), len(gold[0])):
        if normalize([tuple(r[i] for i in idx) for r in pred]) == want:
            return True
    return False


def inside(root: Path, rel: str) -> Path:
    """模型给的路径一律不信任:解析之后必须还在 root 里面。root 本身要先是解析过的绝对路径。"""
    p = (root / rel).resolve()
    if not p.is_relative_to(root):
        raise PermissionError(f"{rel} 不在技能目录里")
    return p


class State(TypedDict):
    text: str
    length: NotRequired[int]


def count(state: State) -> dict:
    return {"length": len(state["text"])}


def make_graph():
    b = StateGraph(State)
    b.add_node("count", count)
    b.add_edge(START, "count")
    b.add_edge("count", END)
    return b.compile()
```

<div class="line-notes">

- `from collections import Counter` 数元素出现几次的字典。`Counter([("a", 1), ("a", 1)])` 得到 `{("a", 1): 2}`。
- `from itertools import combinations` 从一堆列号里挑出所有「选 k 个」的组合,`combinations(range(3), 2)` 依次给出 `(0, 1)`、`(0, 2)`、`(1, 2)`。
- `def normalize(rows: list[tuple]) -> Counter:` 把一批行变成「每种行出现几次」。
- `return Counter(tuple(round(v, 2) if isinstance(v, float) else v for v in r) for r in rows)` 外层 `for r in rows` 取每一行,里面把行里的每个值 `v` 处理一下:浮点数 `round` 到两位,别的原样。代入 `[(20273.0004,)]`:`round(20273.0004, 2)` 是 `20273.0`,所以和 `[(20273.0,)]` 的 `Counter` 相等。
- `if normalize(pred) == normalize(gold):` 先试最简单的:整张表一模一样。顺序反过来的情况在这里就过了,因为 `Counter` 不看顺序。
- `if not pred or not gold or len(pred[0]) <= len(gold[0]):` 到这里说明不完全相等。模型的结果为空、标准为空,或者列数不比标准多,再挑列也没用,直接判错。`not pred` 对空列表为真。
- `want = normalize(gold)` 标准答案的「行计数」,循环里要反复比,先算好一次。
- `for idx in combinations(range(len(pred[0])), len(gold[0])):` 代入「多一列」:`pred[0]` 有 3 列,标准 2 列,`idx` 依次是 `(0, 1)`、`(0, 2)`、`(1, 2)`。
- `if normalize([tuple(r[i] for i in idx) for r in pred]) == want:` 只保留这几列,再比。`(0, 1)` 那一组留下的就是标准答案,返回 `True`。
- `return False` 所有列组合都对不上。
- `def inside(root: Path, rel: str) -> Path:` 路径防护。
- `p = (root / rel).resolve()` 先拼,再 `resolve()`:把 `..` 和软链接都展开成真实的绝对路径。代入 `rel = "../refund-policy-evil/secret.txt"`:拼出来是 `.../refund-policy/../refund-policy-evil/secret.txt`,`resolve` 之后是 `.../refund-policy-evil/secret.txt`。
- `if not p.is_relative_to(root):` `is_relative_to` 按路径的层级判断「p 是不是在 root 底下」。`refund-policy-evil` 和 `refund-policy` 是并列的两个目录,所以判断为假,会被拦住。用 `str(p).startswith(str(root))` 就拦不住,练习 2 会复现。
- `raise PermissionError(f"{rel} 不在技能目录里")` 抛的错误信息写明是哪个路径,给模型看也能懂。
- `class State(TypedDict):` 单节点图的状态。
- `length: NotRequired[int]` 节点才算出来的字段,标 `NotRequired`。
- `def count(state: State) -> dict:` 节点。
- `return {"length": len(state["text"])}` 代入 `"上个月的发票开错了"`,`len` 是 9,返回 `{"length": 9}`。
- `def make_graph():` 把六步骨架包进一个函数,每次调用得到一张新图。
- `b.add_node("count", count)` 第 3 步,节点名 `"count"`。
- `return b.compile()` 第 5 步,编译后返回。

</div>

```bash
uv run python -m part05.review43_dictation_check
```

```text
通过  顺序不同算对
通过  多一列算对
通过  少一行算错
通过  重复一行算错
通过  浮点差零点零零零四算对
通过  技能目录里的文件放行
通过  名字以 root 开头的邻居目录被拦
通过  向上跳出去被拦
通过  单节点图算出长度 9

9/9 通过
```

九条全过。如果你默写时漏了哪一条,对照上面的注释看漏在哪。最容易漏的两处:一是 `normalize` 里浮点要 `round`,二是 `inside` 里用 `is_relative_to` 而不是字符串前缀。

</details>

**练习 2(找错):四个错误。** 下面这份 `review43_buggy.py` 里藏了本周讲过的四类错误,每个函数一个。先只用眼睛找,写下你认为的四处和各自会出现什么现象;然后把检查脚本跑一遍验证,再改好。

```python
# agent-zero-lab/part05/review43_buggy.py
"""练习 2:这份代码里藏了本周讲过的四类错误。先用眼睛找,再跑 review43_buggy_check.py 验证。"""
import subprocess
from pathlib import Path
from typing import NotRequired, TypedDict

from langgraph.graph import END, START, StateGraph


def matches(pred: list[tuple], gold: list[tuple]) -> bool:
    return pred == gold


def inside(root: Path, rel: str) -> Path:
    p = (root / rel).resolve()
    if not str(p).startswith(str(root)):
        raise PermissionError(f"{rel} 不在技能目录里")
    return p


def run_script(name: str, arg: str, cwd: Path) -> str:
    r = subprocess.run(f"echo {name} {arg}", shell=True, cwd=cwd, capture_output=True, text=True)
    return r.stdout.strip()


class State(TypedDict):
    text: str
    length: NotRequired[int]


def count(state: State) -> dict:
    return {"lenght": len(state["text"])}


def make_graph():
    b = StateGraph(State)
    b.add_node("count", count)
    b.add_edge(START, "count")
    b.add_edge("count", END)
    return b.compile()
```

<div class="line-notes">

- `import subprocess` 标准库,用来运行外部命令。`run_script` 模拟 Day 297 的 `run_skill_script`,这里只让它 `echo`,不会真的干什么。
- `def matches(pred: list[tuple], gold: list[tuple]) -> bool:` 比较模型结果和标准答案。
- `return pred == gold` 第一处可疑的地方,先不下结论。
- `def inside(root: Path, rel: str) -> Path:` 路径防护。
- `if not str(p).startswith(str(root)):` 第二处可疑的地方。
- `def run_script(name: str, arg: str, cwd: Path) -> str:` 按名字跑一个脚本,`arg` 来自模型。
- `r = subprocess.run(f"echo {name} {arg}", shell=True, cwd=cwd, capture_output=True, text=True)` 第三处可疑的地方。`cwd=cwd` 让命令在指定目录里跑。
- `def count(state: State) -> dict:` 单节点图里的节点。
- `return {"lenght": len(state["text"])}` 第四处可疑的地方。

</div>

<details><summary>参考答案</summary>

先看检查脚本。它对一个模块里的四个函数各打一击,默认检查 `review43_buggy`,传模块名就检查别的:

```python
# agent-zero-lab/part05/review43_buggy_check.py
"""练习 2 的检查脚本:对一个模块里的四个函数各打一击。
用法:uv run python -m part05.review43_buggy_check [模块名],不写模块名就检查 part05.review43_buggy"""
import importlib
import sys
import tempfile
from pathlib import Path

mod = importlib.import_module(sys.argv[1] if len(sys.argv) > 1 else "part05.review43_buggy")
State, inside, make_graph, matches, run_script = mod.State, mod.inside, mod.make_graph, mod.matches, mod.run_script

failed = 0


def report(name: str, passed: bool, detail: str = "") -> None:
    global failed
    failed += not passed
    print(f"{'通过' if passed else '失败'}  {name}" + (f"   ← {detail}" if detail and not passed else ""))


gold = [("专业版", 10), ("企业版", 8), ("基础版", 12)]
report("1 行顺序不同也应该算对", matches(list(reversed(gold)), gold), "顺序一换就判错")

with tempfile.TemporaryDirectory() as d:
    root = (Path(d) / "refund-policy").resolve()
    root.mkdir()
    (Path(d) / "refund-policy-evil").mkdir()
    (Path(d) / "refund-policy-evil" / "secret.txt").write_text("假密码", encoding="utf-8")
    try:
        got = inside(root, "../refund-policy-evil/secret.txt")
        report("2 名字以 root 开头的邻居目录应该被拦", False, f"放行了 {got.name}")
    except PermissionError:
        report("2 名字以 root 开头的邻居目录应该被拦", True)

    out = run_script("load_skill", "refund; touch injected.txt", cwd=Path(d))
    created = (Path(d) / "injected.txt").exists()
    report("3 参数里夹带的第二条命令不应该被执行", not created, f"目录里多出了 injected.txt,echo 输出:{out!r}")

result = make_graph().invoke(State(text="上个月的发票开错了"))
report("4 节点应该把长度写进 length", "length" in result, f"最终状态是 {result}")

print(f"\n{4 - failed}/4 通过")
sys.exit(1 if failed else 0)
```

<div class="line-notes">

- `import importlib` 标准库,能按名字字符串导入模块。
- `mod = importlib.import_module(sys.argv[1] if len(sys.argv) > 1 else "part05.review43_buggy")` `sys.argv` 是命令行参数列表,第 0 项是脚本自己,所以 `len > 1` 就是用户传了模块名。没传就检查有错误的那份。
- `State, inside, make_graph, matches, run_script = mod.State, mod.inside, mod.make_graph, mod.matches, mod.run_script` 从导入的模块里取出五样,同一份检查脚本因此能同时检查「有错的」和「改好的」。
- `failed = 0` 失败计数。
- `global failed` 在函数里改模块级变量要先声明。`failed += not passed` 把布尔值当 0/1 加。
- `report("1 行顺序不同也应该算对", matches(list(reversed(gold)), gold), "顺序一换就判错")` 打第一个函数:结果倒过来。
- `root = (Path(d) / "refund-policy").resolve()` 和练习 1 同样的布置:一个技能目录,旁边一个同前缀的邻居。
- `got = inside(root, "../refund-policy-evil/secret.txt")` 如果这一行没抛异常,说明邻居目录被放行了。
- `out = run_script("load_skill", "refund; touch injected.txt", cwd=Path(d))` 打第三个函数:参数里夹带一个分号和第二条命令。`touch` 只在临时目录里建一个空文件,是无害的演示。
- `created = (Path(d) / "injected.txt").exists()` 看第二条命令有没有被执行:有没有多出一个文件。
- `result = make_graph().invoke(State(text="上个月的发票开错了"))` 打第四个函数。
- `report("4 节点应该把长度写进 length"` 第四个函数的判定:`"length" in result` 看最终状态里有没有 `length` 键,没有就把整个最终状态打印出来当线索。

</div>

```bash
uv run python -m part05.review43_buggy_check
```

```text
失败  1 行顺序不同也应该算对   ← 顺序一换就判错
失败  2 名字以 root 开头的邻居目录应该被拦   ← 放行了 secret.txt
失败  3 参数里夹带的第二条命令不应该被执行   ← 目录里多出了 injected.txt,echo 输出:'load_skill refund'
失败  4 节点应该把长度写进 length   ← 最终状态是 {'text': '上个月的发票开错了'}

0/4 通过
```

四个全中。逐个说:

1. **`return pred == gold`**:列表相等要求顺序也相同,模型的 SQL 没写 `ORDER BY` 时行的顺序本来就不保证,倒过来就判错。这是 Day 294 评测器误判的同一类,也不处理重复行。改成 `Counter(pred) == Counter(gold)`。
2. **`str(p).startswith(str(root))`**:`.../refund-policy-evil/secret.txt` 以 `.../refund-policy` 开头,字符串前缀的判断把它放行了。改成 `p.is_relative_to(root)`,按路径层级判断。
3. **`shell=True` 加 f-string 拼命令**:参数里的分号让 shell 把后面的 `touch injected.txt` 当成第二条命令执行了。注意 `echo` 的输出只是 `'load_skill refund'`,第二条命令的痕迹要看目录里多了文件,**输出里看不出来**。改成列表传参 `["echo", name, arg]`,不经过 shell。
4. **`{"lenght": ...}`**:键名拼错,`State` 里没有这个字段,框架悄悄丢掉,图没报任何错,最终状态里只有 `text`。

改好的版本,四处改动各有一行注释:

```python
# agent-zero-lab/part05/review43_fixed.py
"""练习 2 参考答案:review43_buggy.py 改好的版本。"""
import subprocess
from collections import Counter
from pathlib import Path
from typing import NotRequired, TypedDict

from langgraph.graph import END, START, StateGraph


def matches(pred: list[tuple], gold: list[tuple]) -> bool:
    return Counter(pred) == Counter(gold)  # 错误 1:不比顺序,但重复的行要数清楚


def inside(root: Path, rel: str) -> Path:
    p = (root / rel).resolve()
    if not p.is_relative_to(root):  # 错误 2:按路径层级比,不是按字符串前缀比
        raise PermissionError(f"{rel} 不在技能目录里")
    return p


def run_script(name: str, arg: str, cwd: Path) -> str:
    r = subprocess.run(["echo", name, arg], cwd=cwd, capture_output=True, text=True)  # 错误 3:列表传参,不经 shell
    return r.stdout.strip()


class State(TypedDict):
    text: str
    length: NotRequired[int]


def count(state: State) -> dict:
    return {"length": len(state["text"])}  # 错误 4:键名和 State 里的一致


def make_graph():
    b = StateGraph(State)
    b.add_node("count", count)
    b.add_edge(START, "count")
    b.add_edge("count", END)
    return b.compile()
```

<div class="line-notes">

- `from collections import Counter` 改错误 1 要用。
- `return Counter(pred) == Counter(gold)  # 错误 1:` 代入倒过来的三行:两边 `Counter` 里都是三种行各一次,相等。重复一行时一边某种行是 2 次,另一边是 1 次,不等。
- `if not p.is_relative_to(root):  # 错误 2:` 代入邻居目录,`p` 是 `.../refund-policy-evil/secret.txt`,它不在 `.../refund-policy` 底下,判断为假,`not` 之后进入 `raise`。
- `r = subprocess.run(["echo", name, arg], cwd=cwd, capture_output=True, text=True)  # 错误 3:` 列表里每一项是一个独立的参数,`arg` 整个就是 `echo` 的一个参数,即使里面有分号,也只是被原样打印出来。
- `return {"length": len(state["text"])}  # 错误 4:` 键名对上 `State`,框架就会把它合并进状态。

</div>

```bash
uv run python -m part05.review43_buggy_check part05.review43_fixed
```

```text
通过  1 行顺序不同也应该算对
通过  2 名字以 root 开头的邻居目录应该被拦
通过  3 参数里夹带的第二条命令不应该被执行
通过  4 节点应该把长度写进 length

4/4 通过
```

第三条的另一个旁证:改好之后 `echo` 输出的是 `load_skill refund; touch injected.txt` 整句话,分号只是个普通字符。

</details>

**练习 3(观察会发生什么):四种比较函数的反应。** 新建 `part05/review43_compare.py`。拿三个套餐的标准结果 `gold`,造三种变形:顺序反过来、每行多选一列、多重复一行。再写四种比较函数(列表 `==`、`set` 相等、`Counter` 相等、`matches`),打印一张「比较函数 × 变形」的表,每格写「对」或「错」。先写下你的预测,再跑,把和预测不一样的格子标出来并解释。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part05/review43_compare.py
"""练习 3:四种比较函数,面对三种「长得不一样但意思一样(或不一样)」的结果,各是什么反应。用法:uv run python -m part05.review43_compare"""
from part05.review43_dictation import matches, normalize

gold = [("专业版", 10), ("企业版", 8), ("基础版", 12)]

VARIANTS = {
    "顺序反过来": list(reversed(gold)),
    "多选一列": [(p, n, "多余") for p, n in gold],
    "重复了一行": gold + [gold[0]],
}

COMPARATORS = {
    "列表 ==": lambda pred, g: pred == g,
    "set 相等": lambda pred, g: set(pred) == set(g),
    "Counter 相等": lambda pred, g: normalize(pred) == normalize(g),
    "matches": matches,
}

print("比较函数 | " + " | ".join(VARIANTS))
for cname, cmp in COMPARATORS.items():
    cells = [("对" if cmp(rows, gold) else "错") for rows in VARIANTS.values()]
    print(f"{cname} | " + " | ".join(cells))
print("\n理想答案:顺序反过来=对,多选一列=对,重复了一行=错")
```

<div class="line-notes">

- `from part05.review43_dictation import matches, normalize` 复用练习 1 参考答案里的两个函数。你默写的版本只要通过了九条断言,这里一样能用。
- `gold = [("专业版", 10), ("企业版", 8), ("基础版", 12)]` 三个套餐的订阅数,和 Day 292 的 `GROUP BY plan` 结果一样。
- `"顺序反过来": list(reversed(gold)),` 第一种变形:同样的三行,顺序倒过来。意思没变。
- `"多选一列": [(p, n, "多余") for p, n in gold],` 第二种变形:模型多选了一列,意思没变(答案还在里面)。
- `"重复了一行": gold + [gold[0]],` 第三种变形:专业版那行出现了两次,这是 JOIN 把行数放大的典型症状,意思**变了**,应当判错。
- `"列表 ==": lambda pred, g: pred == g,` `lambda` 是匿名函数,等价于 JS 的箭头函数 `(pred, g) => pred === g`。
- `"set 相等": lambda pred, g: set(pred) == set(g),` 集合会去重,所以重复行会被吞掉。
- `"Counter 相等": lambda pred, g: normalize(pred) == normalize(g),` 数清每种行出现几次。
- `"matches": matches,` 函数本身也可以放进字典当值,直接是第四种。
- `print("比较函数 | " + " | ".join(VARIANTS))` `" | ".join(VARIANTS)` 对字典是把所有键连起来,三个变形的名字。
- `for cname, cmp in COMPARATORS.items():` 逐个比较函数。
- `cells = [("对" if cmp(rows, gold) else "错") for rows in VARIANTS.values()]` 对三种变形各比一次。
- `print(f"{cname} | " + " | ".join(cells))` 每个比较函数一行。

</div>

```bash
uv run python -m part05.review43_compare
```

```text
比较函数 | 顺序反过来 | 多选一列 | 重复了一行
列表 == | 错 | 错 | 错
set 相等 | 对 | 错 | 对
Counter 相等 | 对 | 错 | 错
matches | 对 | 对 | 错

理想答案:顺序反过来=对,多选一列=对,重复了一行=错
```

只有 `matches` 一行和「理想答案」完全一致。其他三行各有一个毛病:

- **列表 `==`**:三种变形全错,顺序反过来这种本来该对的也错了(Day 294 之前评测器的状态)。
- **`set` 相等**:顺序对了,**重复了一行也判对**,这是最危险的:JOIN 放大行数的错最容易这样漏过去。用集合比较看着省事,这个表说明它最危险。
- **`Counter` 相等**:顺序和重复都处理对了,但「多选一列」还是错,Day 294 里两道误判的题就是这样。所以才要在 `Counter` 之上再加一层「挑列子集」。

</details>

**练习 4(开放题):给门禁再加一道数据检查。** 给 `review43_gate.py` 再加第三道检查:Day 298 的 `billing_tools.find_duplicates("C007")` 应该恰好返回一组重复扣款(`INV-2026-0026` 和 `INV-2026-0123`),`C003` 应该一组都没有。要求:仍然只有一个节点;不改 `review43_gate.py` 本身,新建 `part05/review43_gate_tools.py`;并构造一份「删了一张发票」的库副本,证明新检查能抓到。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part05/review43_gate_tools.py
"""练习 4 参考答案:给门禁加第三道检查(账单工具的数据回归),仍然只有一个节点。
用法:uv run python -m part05.review43_gate_tools"""
import shutil
import sqlite3
import tempfile
from pathlib import Path
from typing import NotRequired

from langgraph.graph import END, START, StateGraph

from part05.lg import billing_tools
from part05.review43_gate import GOOD, State as GateState, gate


class State(GateState):
    tool_problems: NotRequired[list[str]]


def check_tools() -> list[str]:
    """C007 应该恰好有一组重复扣款(INV-2026-0026 和 INV-2026-0123),C003 一组都没有。"""
    problems: list[str] = []
    found = billing_tools.find_duplicates("C007")["duplicates"]
    assert isinstance(found, list)
    ids = [d["invoice_ids"] for d in found]
    if ids != [["INV-2026-0026", "INV-2026-0123"]]:
        problems.append(f"C007 的重复扣款应该是 INV-2026-0026 和 INV-2026-0123 一组,实际是 {ids}")
    if billing_tools.find_duplicates("C003")["duplicates"] != []:
        problems.append("C003 不该有重复扣款")
    return problems


def gate_plus(state: State) -> dict:
    out = gate(state)  # 节点就是普通函数,可以直接调用另一个节点的函数
    tool_problems = check_tools()
    out["tool_problems"] = tool_problems
    out["ok"] = out["ok"] and not tool_problems
    return out


builder = StateGraph(State)
builder.add_node("gate_plus", gate_plus)
builder.add_edge(START, "gate_plus")
builder.add_edge("gate_plus", END)
graph = builder.compile()

if __name__ == "__main__":
    init = State(skill_dir=".claude/skills/refund-policy", cases=GOOD)
    out = graph.invoke(init)
    print("原库:", out["ok"], out["tool_problems"])

    with tempfile.TemporaryDirectory() as d:  # 拷一份库,删掉一张重复发票,再让工具读它
        copy = Path(d) / "cloudledger.db"
        shutil.copy(billing_tools.DB, copy)
        conn = sqlite3.connect(copy)
        conn.execute("DELETE FROM invoices WHERE id = 'INV-2026-0123'")
        conn.commit()
        conn.close()
        original = billing_tools.DB
        billing_tools.DB = copy
        try:
            out = graph.invoke(init)
        finally:
            billing_tools.DB = original
    print("删了一张发票的副本:", out["ok"], out["tool_problems"])
```

<div class="line-notes">

- `from part05.lg import billing_tools` 导入模块本身,而不是里面的函数,因为后面要改它的 `DB` 变量,必须通过模块去改才有效。
- `from part05.review43_gate import GOOD, State as GateState, gate` 复用上面门禁的用例、状态和节点函数。`State as GateState` 把原来的 `State` 起个别名,免得和下面新的 `State` 重名。
- `class State(GateState):` `TypedDict` 可以继承:新状态拥有原来所有字段,再加一个。
- `tool_problems: NotRequired[list[str]]` 新字段,也是节点算出来的。
- `found = billing_tools.find_duplicates("C007")["duplicates"]` 昨天(Day 298)的工具函数。返回 `{"customer_id": "C007", "duplicates": [...]}`,取出 `duplicates` 这一项。
- `assert isinstance(found, list)` `find_duplicates` 的返回类型是 `dict[str, object]`,`duplicates` 的值编辑器不知道是列表。这一行既是运行时检查,也让编辑器明白它是列表。
- `ids = [d["invoice_ids"] for d in found]` 每一组取出发票号列表。C007 原库里是 `[['INV-2026-0026', 'INV-2026-0123']]`。
- `if ids != [["INV-2026-0026", "INV-2026-0123"]]:` 和预期的整体比较,多一组、少一组、发票号不同都会进来。
- `if billing_tools.find_duplicates("C003")["duplicates"] != []:` 另一个方向的检查:没有重复的客户不该查出重复。
- `def gate_plus(state: State) -> dict:` 新节点。
- `out = gate(state)  # 节点就是普通函数,可以直接调用另一个节点的函数` 先调旧门禁的节点函数,拿到它的更新字典。这样旧逻辑一行不用复制。
- `out["tool_problems"] = tool_problems` 往更新字典里再加一个键。
- `out["ok"] = out["ok"] and not tool_problems` 重新算总结论:旧门禁说 `ok` 并且工具检查也没问题,才是 `True`。
- `builder.add_node("gate_plus", gate_plus)` 仍然是一个节点,六步骨架照旧。
- `init = State(skill_dir=".claude/skills/refund-policy", cases=GOOD)` 初始状态:真 skill 目录加两条好用例。
- `with tempfile.TemporaryDirectory() as d:` 建临时目录,`with` 结束时整个目录连同里面的库副本一起删掉。
- `shutil.copy(billing_tools.DB, copy)` 复制一份业务库。**我们只改副本,不碰真库**。
- `conn.execute("DELETE FROM invoices WHERE id = 'INV-2026-0123'")` 在副本里删掉重复的那张发票。这里是普通可写连接,和 `billing_tools` 里只读的连接是两回事。
- `conn.commit()` 提交修改([Day 91](/blog/agent-zero/day-091-sql-6/) 讲过事务),不提交的话删除不会落盘。
- `original = billing_tools.DB` 记下原来的路径。
- `billing_tools.DB = copy` 把模块里的 `DB` 变量指向副本。`find_duplicates` 每次调用时才读这个变量,所以马上生效。
- `finally:` 不管 `invoke` 成功还是抛异常,都把路径还原,免得影响后面的代码。

</div>

```bash
uv run python -m part05.review43_gate_tools
```

```text
原库: True []
删了一张发票的副本: False ['C007 的重复扣款应该是 INV-2026-0026 和 INV-2026-0123 一组,实际是 []']
```

原库里第三道检查通过;副本里少了一张发票,`C007` 的重复扣款组消失了,检查报出「实际是 `[]`」,总结论变成 `False`。这类检查叫**数据回归**:代码没改,但种子数据变了(或者有人把库重新生成了一遍),依赖这份数据的演示和测试会悄悄失效,门禁在这里提前发现。

练习里还有一个点:`gate_plus` 直接调了 `gate(state)`。**节点只是普通函数**,可以互相调用。这个办法在今天好用,但也是「一个节点装太多事」的一种表现:下次想把 SQL 检查和工具检查分开时,就该上两个节点了。

</details>

**验收标准:** 门禁的 8 条测试全过,三种改坏每次都能抓到,还原后再跑一遍全绿;练习 1 的九条断言全过;练习 2 的四处错误都能指出并说出现象;练习 3 能解释表里每一格;练习 4 的副本能被抓到。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 门禁(gate) | 在上线或合并前自动跑的一道检查,有任何问题就拦住,并说清原因。例:今天的 `review43_gate.py` |
| 数据回归 | 代码没改,但依赖的数据变了,导致原来对的结果变错。例:种子库重新生成后,C007 的重复扣款没了 |
| 改坏实验(变异检查) | 故意把代码改坏一处,看测试会不会变红,用来验证测试真的有用。例:把 `matches` 换成 `!=` |
| 执行准确率(EX) | Text-to-SQL 的评分方式:模型 SQL 的结果集和标准 SQL 的结果集一样才算对,Day 294 |
| 召回(recall) | 该找回来的东西,实际找回来多少。Day 295 里检索表的 7/10 就是召回率 |
| 语义层 | 把指标和维度的口径提前定义好,模型只能「点菜」不能写 SQL,Day 295 |
| 渐进式披露 | 信息分层,用到哪层才读哪层。Skill 的三层加载就是例子,Day 296 |
| `SKILL.md` | Skill 的入口文件,开头是 frontmatter 元数据,后面是正文,Day 296 |
| 路径防护 | 对模型给的路径一律不信任,解析后必须还在允许的目录里,Day 297 的 `_inside` |
| 状态图(StateGraph) | LangGraph 里「共享一份状态的节点和边」的图纸类,Day 299 |
| 更新(update) | 节点返回的字典,只含它改了的键,由框架合并进状态 |
| 浅拷贝 | 复制外层容器、里面的元素仍是同一批对象。`state.copy()` 就是 |
| `tmp_path` | pytest 给每个测试准备的临时目录,测完自动清理 |
| `is_relative_to` | `Path` 的方法,按路径层级判断「是不是在某个目录底下」,比字符串前缀可靠 |

## 常见误区

**测试全绿就以为测试有用。** 8 条测试全绿并不说明它们有用,要做改坏实验。今天改坏三处,抓到的测试数是 3、2、5,每一次我都能说出为什么是这几条。如果有一处改坏之后全绿,说明那里没有测试保护。

**检查脚本一失败就停下。** 练习 1 的检查脚本故意用「记录加打印」而不是 `assert`,一次跑完所有条目,你能看到全部漏洞,而不是修一个跑一次、再看到下一个。

**把检查器的「通过」当成「写得好」。** `skill_check` 能查格式,查不出 description 有没有写清触发场景;门禁的 `matches` 能查结果集,查不出标准答案本身有没有并列。检查器说通过,只表示它能查的那部分没问题。

**一个节点装了很多事。** 今天为了只用本周知识,把两个检查塞进一个节点,代价是看不见各自的耗时、一个失败拖着另一个、没法只重跑一半。到了下一课学会串节点,应该拆开。

**复习只看不写。** 复习日的价值在练习 1:合上文章默写。看一遍文章觉得都懂,和写出来跑过九条断言,差得很远。

**在真实目录里演示危险写法。** 练习 2 里 `touch injected.txt` 是无害的,但习惯要对:演示危险写法时,一律放在 `tempfile.TemporaryDirectory()` 或 `tmp_path` 里,测完自动删,不要在真实目录里留下任何东西。

## 学习资料

### 文档与文章

- [pytest 文档 · How to use fixtures](https://docs.pytest.org/en/stable/how-to/fixtures.html) 和 [tmp_path](https://docs.pytest.org/en/stable/how-to/tmp_path.html):`tmp_path` 的官方说明。今天用它造「坏 skill」目录,测完自动清理。
- [Python 文档 · pathlib.PurePath.is_relative_to](https://docs.python.org/3/library/pathlib.html#pathlib.PurePath.is_relative_to):路径防护用的那个方法,注意它不会帮你解析 `..`,所以要先 `resolve()`。
- [Agent Skills 开放标准](https://agentskills.io/specification):本周 Day 296–297 的规范原文,复习时把 name、description 的字段规则再对照一遍 `skill_check.py`。
- [LangGraph 文档 · Graph API](https://docs.langchain.com/oss/python/langgraph/graph-api):Day 299 之后的下一站,先读 State 和 Nodes 两节。
- [BIRD 官网](https://bird-bench.github.io/):Text-to-SQL 基准,面试常问,本周 Day 295 讲过。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1QuJ16aEhy&autoplay=0&high_quality=1" title="保姆级Skill通关指南,系统了解Skill是什么,让Agent再好用百倍!" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>BV1QuJ16aEhy · 保姆级Skill通关指南,系统了解Skill是什么 · 16 分钟(B 站标题经 view API 核对)。复习本周 Skills 两天,看它讲的和你自己实测的哪些对得上。</figcaption>
</figure>

- 《准确率提升90%以上的Text2SQL实践分享》(BV1YsVDzLEwf,约 45 分钟):别人在生产里怎么做问数,对照 Day 294–295 的自修、检索、语义层,看他们多做了哪些事。
- 尚硅谷《LangGraph教程》(BV1z3NY66EY1,全套约 21 小时):Day 299 之后几天要对照着看的课,今天可以先扫目录。

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/aHCDrAbH_go" title="Building Effective Agents with LangGraph" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>LangChain · Building Effective Agents with LangGraph · 官方频道,英文,开字幕。我只核对了标题和频道,没有逐段看完。本周最后两天的编排内容,在这里看官方怎么画。</figcaption>
</figure>

- IBM Technology《LangChain vs LangGraph: A Tale of Two Frameworks》(YouTube `qAF1NjEVHhY`,英文):10 分钟,面试前复习两个库的定位。

### 书籍

- Chip Huyen,《AI Engineering》,O'Reilly,2025:讲评测和系统搭建的部分,可以对照 Day 294–295 的评测和 Day 296–297 的「为什么要测」。我没有核实有无中文版。
- Mayo Oshin、Nuno Campos,《Learning LangChain》,O'Reilly,2025:LangGraph 部分和 Day 299 开始的内容对应,出版时 1.0 还没发布,API 要对照着看。

### 开源项目与代码

- [langchain-ai/langgraph](https://github.com/langchain-ai/langgraph):接下来十几天都要用。
- [anthropics/skills](https://github.com/anthropics/skills):Anthropic 官方的 skill 示例仓库,可以拿几个来跑一遍 `skill_check.py`,看有没有「非标准字段」的提示。

## 自测

1. 为什么评测里的结果集比较要用 `Counter`,而不是列表 `==` 或 `set`?

<details><summary>答案</summary>

列表 `==` 要求行顺序相同,而没写 `ORDER BY` 的 SQL 行顺序本来不保证,会把「对的」判成错。`set` 会去重,JOIN 放大行数造成的重复行会被吞掉,把「错的」判成对。`Counter` 不看顺序、但每种行出现几次要数清楚,两头都对。再加一层「挑列子集」,模型多选了列也能判对。今天练习 3 的表实测了这四种写法。

</details>

2. 路径防护为什么要用 `Path.is_relative_to`,不用 `str(p).startswith(str(root))`?

<details><summary>答案</summary>

字符串前缀不看路径层级。`.../refund-policy-evil/secret.txt` 以 `.../refund-policy` 开头,但它是一个并列的邻居目录,不是子目录。`is_relative_to` 按路径的每一段比较,能分出这两种。另外两个前提:路径要先 `resolve()` 展开 `..` 和软链接,`root` 本身也要是 `resolve()` 过的(macOS 上 `/var` 其实是 `/private/var`)。

</details>

3. 节点返回 `{"lenght": 9}`(键名拼错)会怎样?你怎么发现?

<details><summary>答案</summary>

不会报错。`lenght` 不是状态里的字段,这次更新被悄悄丢掉,最终状态里没有 `length`。发现的办法只有两个:`invoke` 之后读最终状态时发现缺字段(比如 `result["length"]` 抛 `KeyError`),或者写测试读它。今天门禁的改坏三就是这样被 5 条测试抓到的。

</details>

4. `shell=True` 加 f-string 拼命令,为什么危险?用列表传参为什么就安全?

<details><summary>答案</summary>

`shell=True` 会把整个字符串交给 shell 解析,模型给的参数里只要有分号、`&&`、反引号,就能夹带第二条命令。列表传参时每一项直接成为程序的一个参数,不经过 shell,分号只是普通字符。练习 2 里 `refund; touch injected.txt` 实测:`shell=True` 时目录里多出了 `injected.txt`,改成列表后这句话被原样当作一个字符串打印。

</details>

5. 面试题:你做了一个问数 Agent 和一批 skill,怎么保证后续改动(换模型、改提示词、改 skill 描述)不会悄悄变差?

<details><summary>答案</summary>

做一道离线的门禁,每次改动自动跑:①一批固定的问题,模型写的 SQL 和标准 SQL 比结果集(执行准确率),并且多跑几遍看稳不稳;②对 skill 目录跑格式检查器;③对依赖的数据和工具做回归检查(种子数据变了会不会让演示悄悄失效)。门禁本身也要被验证:故意改坏几处,确认测试会变红。要补一句局限:评测集只覆盖你想到的问题,通过了门禁不等于没有别的错,所以还要看没参与调试的新问题上的分数,以及线上的真实反馈。

</details>

## 明天预告

Day 301 · LangGraph(二):两个节点串起来,用 stream 看每一步。今天的门禁把两个检查塞进了一个节点,代价已经说过。明天学两个节点怎么连:一个节点的输出怎么成为下一个节点的输入,`add_sequence` 一次登记一串节点;再用 `stream` 代替 `invoke`,每跑完一个节点就看到它改了什么,这是调试图时最常用的办法。
