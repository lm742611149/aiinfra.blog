---
title: 'Day 186 · 代码即动作(一):JSON 工具调用卡在哪,CodeAct 在说什么'
description: '同一道「找出退款最多的三个城市」,用 JSON 工具调用跑三遍:116 条订单 3,486 个 token 原样进上下文、每一步重发,三遍都把上海的总额算错,其中一遍模型把 23 个数一个不差地列出来,加出来却少了 170 元。再让模型只「写」一段调用工具的 Python(今天不执行),输入 141、输出 130 个 token。然后讲 CodeAct 论文的三个论点,以及 smolagents、Cloudflare Code Mode、Anthropic 代码执行和程序化工具调用这三种 2025–2026 年的落地。'
pubDate: 2026-10-22
regime: none
tags: ['code-execution', 'codeact', 'tool-use', 'context-engineering', 'agent-zero']
series: 'agent-zero'
day: 186
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 184](/blog/agent-zero/day-184-tool-search-1/) 和 [Day 185](/blog/agent-zero/day-185-tool-search-2/) 解决的是「工具定义太多」:60 个工具全挂上每步 4,500 个 token,于是先砍、合并、路由,再做工具检索,开局只挂 `search_tools`,搜到什么挂什么。代价也看到了:没挂上的工具在模型眼里就等于不存在。

可上下文里的大块头不只有工具定义。[Day 180](/blog/agent-zero/day-180-tool-design-1/) 坏工具一次 `grep` 就灌进来三万多 token,那是工具**结果**太大。Day 182 的办法是给返回值设上限、让工具只返回需要的东西。但有一类任务,工具必须返回大量数据,因为任务本身就是「拿一大堆数据,算出一个小结论」。今天看 JSON 工具调用在这类任务上卡在哪,以及一个思路完全不同的解法:让模型写代码。

## 今天要解决的问题

学完你应该能:

1. 说出 JSON 工具调用的两个性质(每个结果都过上下文、组合逻辑只能靠模型在回合之间完成),并用实跑数字说明它们在「多步、数据量大」的任务上为什么又贵又容易错。
2. 说清 CodeAct 的核心主意和论文的三个论点。
3. 分清 2025–2026 年这个思路的三种落地:smolagents 的 CodeAgent、Cloudflare 的 Code Mode、Anthropic 的代码执行与程序化工具调用,知道它们的共同点和区别。
4. 知道为什么「执行模型写的代码」必须有沙箱,所以今天只让模型写、不执行。

今天两个新概念:**中间结果过上下文**,和 **CodeAct(代码即动作)**。真正把模型写的代码跑起来、在沙箱里接上工具,是明天 [Day 187](/blog/agent-zero/day-187-codeact-2/) 的事。

预计用时 2 小时。前置:[Day 159](/blog/agent-zero/day-159-tool-roundtrip/)(tool 消息一来一回)、[Day 162](/blog/agent-zero/day-162-parallel-tools/)(并行工具调用)、[Day 169](/blog/agent-zero/day-169-tool-registry-2/) 和 [Day 170](/blog/agent-zero/day-170-agent-full/)(注册表和 `run_agent`)、[Day 142](/blog/agent-zero/day-142-prompt-4/)(让模型先想再答)。代码在 `agent-zero-lab/part03/`,命令都在 `agent-zero-lab/` 根目录跑。正文实跑约 ¥0.05;练习 1 要放大数据跑两遍,约 ¥0.15;全部加起来约 ¥0.21。

学法:先对照文章逐行敲一遍(不复制粘贴)并跑通;第二天合上文章,画出「JSON 工具调用」和「写代码调用」两条数据流,默写 `orders_tools.py` 的两个工具;做练习,做不出再展开参考答案,看完关掉自己重写一遍。

## 一道看起来很简单的题

先说一个你多半撞上过的场景。运营问 Agent:「退款最多的三个城市各退了多少钱,区域负责人是谁?」Agent 手里有两个工具:`list_orders` 按状态列订单,`get_city_manager` 查某个城市的负责人。

人来做这道题,打开 Excel 筛出退款单,按城市做个数据透视表,排序取前三,再查三次负责人。程序员来做,写个循环求和。没有人会把一百多个金额念出来、在脑子里加。

可 JSON 工具调用就是让模型这么干的。先把数据和工具准备好。

## 第一步:400 条订单和两个工具

数据用固定随机种子生成,你和我跑出来一模一样;明天的 Day 187 也用这个文件。

```python
# agent-zero-lab/part03/orders_tools.py  400 条订单和两个工具,Day 186、187 都用它
import random
from typing import Annotated, Any, Literal

from part03.agent_loop import ToolRegistry

CITIES = ["北京", "上海", "广州", "深圳", "杭州", "成都", "武汉", "西安"]
MANAGERS = {"北京": "王磊", "上海": "陈静", "广州": "李娜", "深圳": "张伟",
            "杭州": "刘洋", "成都": "赵敏", "武汉": "孙浩", "西安": "周婷"}


def _make_orders(n: int = 400, seed: int = 132) -> list[dict[str, Any]]:
    rng = random.Random(seed)  # 固定种子,每次生成的数据一样
    rows: list[dict[str, Any]] = []
    for i in range(1, n + 1):
        rows.append({
            "id": f"O{i:04d}",
            "city": rng.choice(CITIES),
            "amount": round(rng.uniform(30, 900), 2),
            "status": "refunded" if rng.random() < 0.3 else "paid",
        })
    return rows


ORDERS = _make_orders()
reg = ToolRegistry()


@reg.tool
def list_orders(status: Annotated[Literal["paid", "refunded", "all"], "订单状态"] = "all") -> list[dict[str, Any]]:
    """按状态列出订单。每条订单有 id、city、amount(元)、status。"""
    return [o for o in ORDERS if status == "all" or o["status"] == status]


@reg.tool
def get_city_manager(city: Annotated[str, "城市名,例如 '杭州'"]) -> dict[str, str]:
    """查某个城市的区域负责人。"""
    if city not in MANAGERS:
        return {"error": f"没有城市 {city},可选: {CITIES}"}
    return {"city": city, "manager": MANAGERS[city]}


def ground_truth() -> list[tuple[str, float, str]]:
    """标准答案:退款总额最高的三个城市。用普通 Python 算,专门用来判卷。"""
    totals: dict[str, float] = {}
    for o in ORDERS:
        if o["status"] == "refunded":
            totals[o["city"]] = totals.get(o["city"], 0) + o["amount"]
    top = sorted(totals.items(), key=lambda kv: kv[1], reverse=True)[:3]
    return [(c, round(t, 2), MANAGERS[c]) for c, t in top]


if __name__ == "__main__":
    refunded = list_orders("refunded")
    print("订单总数", len(ORDERS), "退款单", len(refunded))
    print("退款单 JSON 字符数", len(reg.call("list_orders", '{"status": "refunded"}')))
    print("标准答案", ground_truth())
```

<div class="line-notes">

- `from part03.agent_loop import ToolRegistry` 用回 [Day 168](/blog/agent-zero/day-168-tool-registry-1/) 的装饰器写法,两个工具的 schema 从类型标注和 docstring 自动生成。
- `CITIES = ["北京", "上海", "广州", "深圳", "杭州", "成都", "武汉", "西安"]` 八个城市。
- `MANAGERS = {"北京": "王磊", "上海": "陈静", "广州": "李娜", "深圳": "张伟",` 每个城市一个区域负责人。
- `rng = random.Random(seed)  # 固定种子,每次生成的数据一样` 用一个独立的随机数生成器,种子固定为 132。同一个种子每次产生的随机数序列完全一样,所以 400 条订单每次都一样,标准答案才有意义。JS 的 `Math.random()` 不能设种子,这是 Python 标准库方便的地方。
- `"id": f"O{i:04d}",` `:04d` 是补零到 4 位,`O0001`、`O0400`。相当于 JS 的 `String(i).padStart(4, "0")`。
- `"amount": round(rng.uniform(30, 900), 2),` 30 到 900 元之间的随机金额,保留两位小数。
- `"status": "refunded" if rng.random() < 0.3 else "paid",` 大约三成是退款。实测 400 条里退款 116 条。
- `ORDERS = _make_orders()` 模块级变量,导入时生成一次。真实项目里这里是数据库查询。
- `def list_orders(status: Annotated[Literal["paid", "refunded", "all"], "订单状态"] = "all") -> list[dict[str, Any]]:` 参数用 `Literal` 限定三个取值,[Day 169](/blog/agent-zero/day-169-tool-registry-2/) 的注册表会把它变成 schema 里的 `enum`。默认值让它成为可选参数。
- `return [o for o in ORDERS if status == "all" or o["status"] == status]` 按状态过滤。注意它返回的是**全部**匹配的订单,没有上限。按 [Day 182](/blog/agent-zero/day-182-tool-design-2/) 的原则五这是个坏设计,今天故意留着,因为这道题确实需要全部数据。
- `if city not in MANAGERS:` 报错时告诉模型有哪些城市可选,Day 182 原则六。
- `def ground_truth() -> list[tuple[str, float, str]]:` 用普通 Python 算出标准答案,专门用来判卷。
- `totals[o["city"]] = totals.get(o["city"], 0) + o["amount"]` 按城市累加。`totals.get(键, 0)` 第一次遇到某个城市时返回 0,相当于 `(totals[city] ?? 0) + amount`。
- `top = sorted(totals.items(), key=lambda kv: kv[1], reverse=True)[:3]` `totals.items()` 是 (城市, 总额) 二元组的序列,按第二个元素从大到小排,取前 3。
- `print("退款单 JSON 字符数", len(reg.call("list_orders", '{"status": "refunded"}')))` 走注册表的 `call`,得到的就是会塞进 tool 消息的那个字符串。

</div>

```bash
# 在 agent-zero-lab/ 下跑
uv run python -m part03.orders_tools
```

```text
订单总数 400 退款单 116
退款单 JSON 字符数 8212
标准答案 [('上海', 10731.38, '陈静'), ('广州', 8613.37, '李娜'), ('成都', 8137.58, '赵敏')]
```

116 条退款单,序列化成 JSON 是 8,212 个字符。练习 3 用 `max_tokens=1` 量过,它在 DeepSeek 那边是 3,486 个 token。标准答案是上海 10,731.38(陈静)、广州 8,613.37(李娜)、成都 8,137.58(赵敏)。

## 第二步:用 JSON 工具调用跑三遍

就用 Day 170 的 `run_agent`,一行不改。再写一个判卷函数:答案里要同时出现正确的金额(误差小于 1 分钱)和负责人。

```python
# agent-zero-lab/part03/json_mode.py  JSON 工具调用做一道「拿大量数据再汇总」的题,看它卡在哪
import re
import sys

from part03.agent_loop import run_agent
from part03.orders_tools import ground_truth, reg

SYSTEM = "你是一个仔细的数据助手,需要数据时调用工具。"
TASK = "找出退款总金额最高的三个城市,给出每个城市的退款总额(保留两位小数)和区域负责人。"


def grade(answer: str) -> str:
    marks = []
    for city, total, manager in ground_truth():
        nums = [float(x.replace(",", "")) for x in re.findall(r"\d[\d,]*\.\d{2}", answer)]
        ok = any(abs(n - total) < 0.01 for n in nums) and manager in answer
        marks.append(f"{city}{'对' if ok else '错'}")
    return " ".join(marks)


if __name__ == "__main__":
    runs = int(sys.argv[1]) if len(sys.argv) > 1 else 1
    print("标准答案:", ground_truth())
    for k in range(1, runs + 1):
        print(f"\n==== 第 {k} 次")
        answer, llm = run_agent(reg, SYSTEM, TASK, max_steps=6)
        print(answer)
        print("判卷:", grade(answer), "|", llm.ledger)
```

<div class="line-notes">

- `from part03.orders_tools import ground_truth, reg` 拿到标准答案和两个工具的注册表。
- `SYSTEM = "你是一个仔细的数据助手,需要数据时调用工具。"` 特意写了「仔细」,看它仔细了能不能算对。
- `TASK = "找出退款总金额最高的三个城市,给出每个城市的退款总额(保留两位小数)和区域负责人。"` 这道题同时需要「拿大量数据」「按城市汇总排序」「对前三名各查一次」。
- `nums = [float(x.replace(",", "")) for x in re.findall(r"\d[\d,]*\.\d{2}", answer)]` 用正则从回答里抓出所有带两位小数的数字,比如 `10,731.38`,去掉千分位逗号再转成浮点数。`re.findall` 相当于 JS 的 `answer.match(/…/g)`。
- `ok = any(abs(n - total) < 0.01 for n in nums) and manager in answer` 回答里只要有一个数和标准答案差不到 1 分钱,并且负责人名字出现了,这个城市就算对。`any(...)` 相当于 JS 的 `nums.some(...)`。
- `marks.append(f"{city}{'对' if ok else '错'}")` 每个城市打一个对错。
- `runs = int(sys.argv[1]) if len(sys.argv) > 1 else 1` 命令行第一个参数是跑几遍。
- `answer, llm = run_agent(reg, SYSTEM, TASK, max_steps=6)` 每一遍都新建一个 `LLMClient`(在 `run_agent` 里面),账本互不干扰。

</div>

```bash
uv run python -m part03.json_mode 3
```

DeepSeek `deepseek-flash`,思考关闭(课程默认的 `.env`),2026 年 10 月 22 日实测,回答只保留表格和关键几行:

```text
标准答案: [('上海', 10731.38, '陈静'), ('广州', 8613.37, '李娜'), ('成都', 8137.58, '赵敏')]

==== 第 1 次
[step 1] 输入 389 tok | 输出 64 tok
    调用 list_orders({"status": "refunded"}) -> 返回 8212 字符
[step 2] 输入 3946 tok | 输出 700 tok
    调用 get_city_manager({"city": "上海"}) -> 返回 31 字符
    调用 get_city_manager({"city": "广州"}) -> 返回 31 字符
    调用 get_city_manager({"city": "成都"}) -> 返回 31 字符
[step 3] 输入 4713 tok | 输出 198 tok
| 1 | 上海 | 11331.37 | 陈静 |
| 2 | 广州 | 8613.44 | 李娜 |
| 3 | 成都 | 8137.58 | 赵敏 |
判卷: 上海错 广州错 成都对 | 3 次调用 | 输入 9048 / 输出 962 tokens | 约 ¥0.0158

==== 第 2 次
[step 1] 输入 389 tok | 输出 50 tok
    调用 list_orders({"status": "refunded"}) -> 返回 8212 字符
[step 2] 输入 3932 tok | 输出 135 tok
    调用 get_city_manager({"city": "上海"}) -> 返回 31 字符
    调用 get_city_manager({"city": "广州"}) -> 返回 31 字符
    调用 get_city_manager({"city": "成都"}) -> 返回 31 字符
    调用 get_city_manager({"city": "杭州"}) -> 返回 31 字符
[step 3] 输入 4155 tok | 输出 472 tok
我需要先算准各城市总额,再确认前三名。让我核算:

**上海**:797.55+791.15+69.17+62.73+835.22+500.57+305.28+609.91+288.99+354.63+610.6+299.83+178.31+573.89+623.12+72.03+777.04+78.82+623.38+632.39+579.42+396.26+671.09 = 10560.85

**广州**:745.86+692.07+40.97+169.82+497.79+69.31+87.77+850.93+774.85+598.3+630.57+58.14+486.99+186.67+598.15+621.33+507.25+94.34+728.52+173.74 = 8613.43
……
| 1 | 上海 | 10560.85 | 陈静 |
| 2 | 广州 | 8613.43 | 李娜 |
| 3 | 成都 | 8137.58 | 赵敏 |
判卷: 上海错 广州错 成都对 | 3 次调用 | 输入 8476 / 输出 657 tokens | 约 ¥0.0132

==== 第 3 次
[step 1] 输入 389 tok | 输出 64 tok
    调用 list_orders({"status": "refunded"}) -> 返回 8212 字符
[step 2] 输入 3946 tok | 输出 716 tok
    调用 get_city_manager({"city": "上海"}) -> 返回 31 字符
    调用 get_city_manager({"city": "广州"}) -> 返回 31 字符
    调用 get_city_manager({"city": "成都"}) -> 返回 31 字符
[step 3] 输入 4729 tok | 输出 185 tok
| 1 | 上海 | 10,813.37 | 陈静 |
| 2 | 广州 | 8,613.47 | 李娜 |
| 3 | 成都 | 8,137.58 | 赵敏 |
判卷: 上海错 广州错 成都对 | 3 次调用 | 输入 9064 / 输出 965 tokens | 约 ¥0.0158
```

### 读这三遍

**排名三次都对,金额三次都错。** 模型看得出哪几个城市退款多,负责人也查对了,可一到 23 个两位小数相加,它就开始编。上海三次写的是 11,331.37、10,560.85、10,813.37,正确答案是 10,731.38,误差从 82 元到 600 元。广州差得少,8,613.44、8,613.43、8,613.47 对 8,613.37,差几分钱,但照样是错的。而且每个数都写得有零有整,表格整整齐齐,不对照标准答案根本看不出来。

**第二遍最值得细看。** 它没有直接给答案,而是像 [Day 142](/blog/agent-zero/day-142-prompt-4/) 学的「先想再答」那样,把上海的 23 个金额一个个列了出来再求和。我用 Python 核对了一下:这 23 个数和真实数据**一个不差**,一个没漏、一个没抄错,加起来是 10,731.38。可模型写在等号后面的是 10,560.85,少了 170.53 元。广州的 20 个数也全对,真和是 8,613.37,它写的是 8,613.43。

这说明问题不在「读」而在「算」。从八千多字符的 JSON 里把属于上海的金额挑出来,模型做得很好;把二十几个小数加起来,它做不好。原因 [Day 106](/blog/agent-zero/day-106-next-token/) 就埋下了:模型每次只是猜下一个 token 最可能是什么,`10560.85` 是它猜出来的一串字符,不是算出来的。列出算式能帮它少猜一点,但帮不到可靠。

**数据每一步都要重发。** 看输入 token:第一步 389,第二步一下跳到 3,946,多出来的约 3,500 就是那 116 条订单;第三步 4,713,订单还在历史里,又发了一遍。三步总输入 9,048 个 token,其中约 7,000 是同一份订单数据发了两遍。如果任务需要五步,它就要被发四遍。

<figure>
<svg viewBox="0 0 640 300" role="img" aria-label="JSON 工具调用与写代码调用的数据流对比">
  <rect x="0" y="0" width="640" height="300" fill="var(--paper-raised)" rx="6"/>
  <text x="160" y="28" text-anchor="middle" font-family="var(--font-mono)" font-size="13" fill="var(--ink)">JSON 工具调用</text>
  <text x="480" y="28" text-anchor="middle" font-family="var(--font-mono)" font-size="13" fill="var(--ink)">写代码调用</text>
  <line x1="320" y1="16" x2="320" y2="288" stroke="var(--rule)" stroke-dasharray="4 4"/>
  <rect x="40" y="50" width="100" height="40" fill="var(--mem-wash)" stroke="var(--mem)" rx="4"/>
  <text x="90" y="75" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">模型</text>
  <rect x="190" y="50" width="100" height="40" fill="var(--compute-wash)" stroke="var(--compute)" rx="4"/>
  <text x="240" y="75" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">工具</text>
  <line x1="140" y1="62" x2="190" y2="62" stroke="var(--ink-soft)"/>
  <line x1="190" y1="80" x2="140" y2="80" stroke="var(--compute)" stroke-width="3"/>
  <text x="165" y="110" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">116 条订单原样回来</text>
  <text x="165" y="140" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">回合 1 list_orders</text>
  <text x="165" y="160" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">模型心算各城市合计</text>
  <text x="165" y="180" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">回合 2 三次 get_city_manager</text>
  <text x="165" y="200" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">回合 3 写最终回答</text>
  <text x="165" y="240" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">输入约 9,000 token</text>
  <text x="165" y="260" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">三遍金额全错</text>
  <rect x="350" y="50" width="80" height="40" fill="var(--mem-wash)" stroke="var(--mem)" rx="4"/>
  <text x="390" y="75" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">模型</text>
  <rect x="460" y="50" width="160" height="100" fill="none" stroke="var(--ink-soft)" rx="4"/>
  <text x="540" y="68" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">执行环境(沙箱)</text>
  <rect x="475" y="80" width="60" height="30" fill="var(--paper)" stroke="var(--ink-soft)" rx="3"/>
  <text x="505" y="99" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">代码</text>
  <rect x="550" y="80" width="60" height="30" fill="var(--compute-wash)" stroke="var(--compute)" rx="3"/>
  <text x="580" y="99" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">工具</text>
  <line x1="535" y1="95" x2="550" y2="95" stroke="var(--compute)" stroke-width="3"/>
  <text x="540" y="132" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">数据在这里过滤汇总</text>
  <line x1="430" y1="62" x2="460" y2="62" stroke="var(--ink-soft)"/>
  <text x="445" y="56" text-anchor="middle" font-family="var(--font-mono)" font-size="10" fill="var(--ink-faint)">代码</text>
  <line x1="460" y1="140" x2="430" y2="85" stroke="var(--mem)"/>
  <text x="400" y="175" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">只回来 3 行 print</text>
  <text x="480" y="240" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">写代码:输入 141 + 输出 130</text>
  <text x="480" y="260" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">执行和回传结果明天做</text>
</svg>
<figcaption>同一道题的两种做法。左边每个工具结果都要穿过模型的上下文,汇总靠模型「猜」出来;右边模型写一段代码,工具在执行环境里被调用,数据就地处理,只有 print 的几行回到模型。左边的数字是今天的实测,右边目前只实测了「写代码」那一步。</figcaption>
</figure>

## JSON 工具调用卡在哪

回顾一下 [Day 159](/blog/agent-zero/day-159-tool-roundtrip/) 的协议:模型输出一段 JSON,写明工具名和参数;你的代码执行,把结果作为 `tool` 消息塞回去;模型读完再决定下一步。一来一回叫一个回合。

这个协议有两个性质。在简单任务上它们完全不是问题,在今天这种任务上就成了瓶颈。

**第一,每个工具结果都要经过模型的上下文。** 工具返回什么,模型就得读什么,读完它还留在历史里,后面每一步都再发一遍。116 条订单是 3,486 个 token;数据变成 1,200 条,就是一万多个 token(练习 1 实测);变成一万行日志,就是几十万。Day 182 教的设上限、Day 191 会讲的截断,都是在这个协议里止血,截掉的部分可能正好是答案需要的。

前端里有个很像的事。你要在页面上显示「本月销售额最高的三个城市」,不会让后端把一万条订单全返回给浏览器、再在 JS 里求和,而是让后端写一条 SQL 聚合好,只返回三行。数据在哪里,计算就该在哪里做,别让大块数据跑来跑去。JSON 工具调用的问题就是,它只有一种做法:把数据搬到模型面前。

**第二,组合逻辑只能靠模型在回合之间完成。**「先查列表,再对前三名各查一次负责人,再汇总」,在 JSON 协议里至少要三个回合。[Day 162](/blog/agent-zero/day-162-parallel-tools/) 的并行工具调用能把同一回合里互不依赖的几个调用合在一起(上面第二步三次 `get_city_manager` 就是并行的),但「先拿到列表才知道要查哪三个城市」这种依赖没法合并。更要命的是循环、过滤、排序、求和这些操作,JSON 里根本表达不了,只能让模型在脑子里做,也就是我们刚才看到的「猜」。

两个性质叠在一起:数据越多、步骤越多,JSON 做法越贵,也越容易错。

## 让模型写代码:CodeAct 在说什么

2024 年 2 月,伊利诺伊大学厄巴纳-香槟分校(UIUC)的王星尧(Xingyao Wang)等人发了一篇论文[《Executable Code Actions Elicit Better LLM Agents》](https://arxiv.org/abs/2402.01030),后来发表在 ICML 2024。它提出的 CodeAct 意思是:**Agent 的每一个动作不再是一段 JSON,而是一段可执行的 Python 代码。** 工具变成代码里预先导入好的函数,模型想调就调,想循环就循环,想把一个工具的结果传给另一个就直接用变量。代码执行完,解释器的输出(包括报错)作为观察结果交回模型,下一轮模型可以改代码再跑。

用今天这道题说,CodeAct 的一个「动作」就是一段代码,里面先调 `list_orders`,在代码里按城市求和、排序,再对前三名调 `get_city_manager`,最后 print 出三行。116 条订单只存在于执行代码的那个环境里,从来不进模型的上下文。

论文的论点可以归成三条,我觉得每条都站得住:

- **代码天然能组合。** JSON 没有变量、没有循环、没有条件。「对列表里每个元素调一次」在 JSON 里要模型展开成 N 个调用,在代码里是一个 `for`。
- **模型的训练数据里有海量代码。** 模型见过的 Python 远比见过的「某家自定义的 JSON 工具格式」多,写起来更顺。
- **报错是现成的反馈。** `TypeError: list_orders() got an unexpected keyword argument 'state'` 比你自己设计的错误提示还清楚,模型一看就知道该怎么改。

论文在 API-Bank 和他们自己做的多工具基准上比较了 17 个模型,报告 CodeAct 的成功率比 JSON 和纯文本格式最多高 20%,需要的回合数也更少。具体数字看论文表格,不用背,重点是方向。

这个主意 2024 年并没有立刻成为主流,原因很现实:**执行模型生成的代码需要沙箱。** 模型写的代码在你的电脑上跑,它能做的事和你自己写的代码一样多:读你的文件、删你的目录、把环境变量里的 key 发到外网。2024 年做一个安全、便宜、启动快的沙箱不是小事。到了 2025–2026 年,沙箱服务成熟了,MCP 让工具数量爆炸,上下文成本成了大问题,这个思路才被几家同时捡起来。

## 第三步:让模型只「写」,今天不执行

在讲那几家之前,先亲眼看看「模型写代码」长什么样。下面这个脚本只做一件事:把两个工具的函数签名告诉模型,让它写一段 Python 完成同一道题。**写出来的代码只打印,不执行。**

为什么不执行?因为执行模型写的代码,第一版就得有沙箱,这是我们这门课的硬规矩。今天还没有沙箱,明天会做一个「代码在子进程里跑、工具调用转发回主进程」的执行器,并且讲清楚子进程为什么还不算真正的沙箱。

```python
# agent-zero-lab/part03/write_code_only.py  只让模型「写」一段调用工具的代码,今天不执行它
from common.llm import LLMClient
from part03.json_mode import TASK

FENCE = "`" * 3  # 三个反引号。直接写在字符串里会把文章的代码块提前截断
API = f'''你可以在 Python 里直接调用这两个函数(已经导入好了):
def list_orders(status: str = "all") -> list[dict]:
    """status 取 "paid" / "refunded" / "all"。每条订单有 id、city、amount(元)、status。"""
def get_city_manager(city: str) -> dict:
    """返回 {{"city": ..., "manager": ...}}"""
写一段 Python 完成任务,只把最终结果 print 出来。只输出一个 {FENCE}python 代码块,不要解释。'''

llm = LLMClient()
r = llm.chat([{"role": "system", "content": API}, {"role": "user", "content": TASK}], temperature=0)
print(r.content)
print(f"\n输入 {r.prompt_tokens} tok | 输出 {r.completion_tokens} tok |", llm.ledger)
```

<div class="line-notes">

- `from part03.json_mode import TASK` 和第二步同一道题。
- `FENCE = ` 一个反引号字符乘以 3,得到三个反引号。字符串乘以整数就是重复,相当于 JS 的 `repeat(3)`。这样写是为了这篇文章:Markdown 的代码块就是用三个反引号包起来的,代码里直接写三个反引号会让网页上的代码块在这里提前结束。你自己的文件里直接写也没问题。
- `API = f'''你可以在 Python 里直接调用这两个函数(已经导入好了):` 三引号是多行字符串,前面加 `f` 变成 f-string,和 JS 的反引号模板字符串一样能用 `{FENCE}` 插值。告诉模型「这两个函数已经导入好了」,它就会直接调用。
- `def list_orders(status: str = "all") -> list[dict]:` 给模型看的不是 JSON Schema,而是 Python 函数签名加 docstring。这正是 CodeAct 的做法:工具以「函数」的样子出现在模型面前。
- `"""返回 {{"city": ..., "manager": ...}}"""` 在 f-string 里,想输出字面的花括号要写两个 `{{` `}}`。我第一次只写了一个,直接报错 `ValueError: Format specifier missing precision`:Python 把 `{"city": ...}` 当成了插值,把冒号后面当成了格式说明。
- `写一段 Python 完成任务,只把最终结果 print 出来。只输出一个 {FENCE}python 代码块,不要解释。'''` 「只把最终结果 print 出来」很关键,print 的东西就是将来唯一回到模型上下文的东西。
- `r = llm.chat([{"role": "system", "content": API}, {"role": "user", "content": TASK}], temperature=0)` 注意这里**没有传 `tools`**,模型不是在做 function calling,只是在写一段文本(恰好是代码)。`temperature=0` 让输出尽量稳定,方便你复现。
- `print(r.content)` 打印模型写的代码。到此为止,没有 `exec`,没有子进程,这段代码一个字符都没被执行。

</div>

```bash
uv run python -m part03.write_code_only
```

````text
```python
orders = list_orders("refunded")
city_totals = {}
for o in orders:
    city_totals[o["city"]] = city_totals.get(o["city"], 0) + o["amount"]

top3 = sorted(city_totals.items(), key=lambda x: x[1], reverse=True)[:3]
result = []
for city, total in top3:
    manager = get_city_manager(city)["manager"]
    result.append({"city": city, "refund_total": round(total, 2), "manager": manager})

print(result)
```

输入 141 tok | 输出 130 tok | 1 次调用 | 输入 141 / 输出 130 tokens | 约 ¥0.0013
````

逐行对一下:先拿退款单,按城市累加,排序取前三,对前三名各查一次负责人,保留两位小数,print。和我们的 `ground_truth()` 逻辑一模一样。这段代码如果在一个接好了工具的环境里执行,print 出来的会是三行结果(练习 3 量过,三行这样的结果约 33 个 token),求和由 Python 的浮点运算完成,不会再有「10560.85」这种猜出来的数。

数一下账:**写代码这一步,输入 141 个 token,输出 130 个。** JSON 做法三步加起来输入九千多、输出几百到近千。当然这不是完整的比较:代码还没执行,执行完结果还要回传给模型、让它写最终回答,那一轮还要再花几百个 token;明天会跑出完整的对比。但量级的差别已经很清楚了:116 条订单从头到尾没有进过模型的上下文。

还有一个细节值得注意:循环里的 `get_city_manager(city)` 是在代码里连续调了三次。在 JSON 协议里,这需要模型先看到前三名是谁,再在下一个回合发三个调用;在代码里,「先拿到列表才知道查谁」这个依赖就是一个普通的变量传递,一段代码里就完成了。

## 2025–2026 年的三种落地

**smolagents 的 CodeAgent。** Hugging Face 的 smolagents 从一开始就把 CodeAgent 当成主打,[Hugging Face Agents Course](https://huggingface.co/learn/agents-course) 的第二单元就是用它讲的。2026 年 10 月查 PyPI,最新版本是 1.26.0(5 月发布)。它默认不是直接用 Python 解释器执行模型的代码,而是用自己重写的 `LocalPythonExecutor`:把代码解析成语法树,一个操作一个操作地解释执行;默认禁止 import,要你显式放行;限制基本操作的总次数,防止死循环。[官方文档](https://huggingface.co/docs/smolagents/tutorials/secure_code_execution)说得很直白:任何本地 Python 沙箱都不可能完全安全,真要隔离就用 `executor_type="e2b"`、`"modal"`、`"docker"`、`"blaxel"` 这类把代码放到别的机器或容器里跑的执行器。

**Cloudflare 的 Code Mode。** 2025 年 9 月 26 日 Cloudflare 发了一篇[《Code Mode: the better way to use MCP》](https://blog.cloudflare.com/code-mode/),做法是把 MCP 工具转成 TypeScript API,让模型写 TypeScript 代码去调用,代码跑在 Cloudflare Workers 的 V8 isolate 里(和浏览器里隔离不同标签页的是同一类技术)。2026 年 2 月 20 日的[后续文章](https://blog.cloudflare.com/code-mode-mcp/)更激进:Cloudflare 自己的 API 有两千五百多个接口,每个做成一个 MCP 工具的话,光工具定义就要上百万 token;他们的新 MCP server 只暴露 `search()` 和 `execute()` 两个工具,固定开销大约一千 token,不管接口有多少。模型先写一段代码在 API 规范里搜要用的接口,再写一段代码调用。你会发现这把 Day 185 的工具检索和今天的代码执行合在了一起。

**Anthropic 的代码执行和程序化工具调用。** 2025 年 11 月 4 日 Anthropic 工程博客发了[《Code execution with MCP》](https://www.anthropic.com/engineering/code-execution-with-mcp),点名了两个问题:工具定义撑满上下文(Day 184 的问题),和中间结果消耗 token(今天的问题)。文中的例子是从 Google Drive 读一份两小时的会议记录、再写进 Salesforce,这份记录会两次穿过模型的上下文,多花约五万 token。他们建议把 MCP server 呈现成文件树,`servers/google-drive/getDocument.ts` 这样每个工具一个文件,Agent 先列目录、用到哪个才读哪个,再写代码调用;文中一个工作流的上下文开销从约 15 万 token 降到约 2 千,省了 98.7%。

同月 24 日的[《Introducing advanced tool use》](https://www.anthropic.com/engineering/advanced-tool-use)推出了程序化工具调用(Programmatic Tool Calling,简称 PTC),2026 年 10 月查[官方文档](https://platform.claude.com/docs/en/agents-and-tools/tool-use/programmatic-tool-calling)状态已经是正式可用(GA)。用法是在请求里加上代码执行工具(`code_execution_20260120` 或更新的版本),再在你希望代码能调用的工具定义上加 `allowed_callers`。Claude 在 Anthropic 托管的容器里写 Python,每个工具在里面是一个函数;代码调用工具时,API 会暂停并把这次调用作为 `tool_use` 交给你,你执行完回传结果,代码接着跑。中间结果留在容器里,只有代码最后的输出进 Claude 的上下文。Anthropic 报告在复杂研究任务上平均 token 从 43,588 降到 27,297,少了 37%。文档里还有一句值得记住:`allowed_callers` 只是给模型的引导,**不是安全边界**,你的程序仍然要能处理模型直接调用这个工具的情况。

三家的共同点是:**工具的执行仍然在你手里,代码的执行在一个隔离的环境里,中间数据不进上下文。** 区别在于执行环境归谁管:smolagents 让你自己选(本地解释器或远程沙箱),Cloudflare 和 Anthropic 托管在自家平台上。明天我们自己写的版本,结构上和 PTC 一模一样:代码在一个单独的进程里跑,里面的工具函数是「桩」,调用时把请求转发回主进程执行。

<figure>
<svg viewBox="0 0 640 230" role="img" aria-label="三种落地的对比:smolagents 本地解释器或远程沙箱、Cloudflare V8 isolate、Anthropic 托管容器,共同点是工具在你手里、代码在隔离环境、中间数据不进上下文">
  <rect x="0" y="0" width="640" height="230" fill="var(--paper-raised)" rx="6"/>
  <rect x="20" y="30" width="190" height="110" fill="var(--paper)" stroke="var(--rule)" rx="4"/>
  <text x="115" y="52" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">smolagents</text>
  <text x="115" y="74" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">写 Python</text>
  <text x="115" y="94" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">本地 AST 解释器</text>
  <text x="115" y="114" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">或 E2B/Docker/Modal</text>
  <rect x="225" y="30" width="190" height="110" fill="var(--paper)" stroke="var(--rule)" rx="4"/>
  <text x="320" y="52" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">Cloudflare Code Mode</text>
  <text x="320" y="74" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">写 TypeScript</text>
  <text x="320" y="94" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">Workers V8 isolate</text>
  <text x="320" y="114" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">search() + execute()</text>
  <rect x="430" y="30" width="190" height="110" fill="var(--paper)" stroke="var(--rule)" rx="4"/>
  <text x="525" y="52" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">Anthropic PTC</text>
  <text x="525" y="74" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">写 Python</text>
  <text x="525" y="94" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">Anthropic 托管容器</text>
  <text x="525" y="114" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">allowed_callers</text>
  <rect x="20" y="160" width="600" height="50" fill="var(--compute-wash)" stroke="var(--compute)" rx="4"/>
  <text x="320" y="182" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">共同点:工具执行在你手里 · 代码在隔离环境里跑 · 中间数据不进上下文</text>
  <text x="320" y="200" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">区别:执行环境是你自己管,还是平台托管</text>
</svg>
<figcaption>2025–2026 年把 CodeAct 落地的三种方式。写的语言、跑代码的地方不一样,核心是同一件事。</figcaption>
</figure>

## 先别急着全换成代码

看到这里你可能想:那以后所有工具都让模型写代码调不就好了?先别急。今天的题是专门挑的,「拿大量数据、做计算」正好踩中 JSON 的两个弱点。很多任务不是这样的:查一个客户、发一封邮件、读一篇纪要,一两个工具调用就完事,数据量也小。这时候写代码反而多了一层:要有执行环境、要处理代码报错、要防模型写出危险的代码。

还有一个更朴素的办法,练习 2 会试:**按任务加一个汇总工具。**「按城市汇总退款」如果是常见需求,就直接做成一个 `refund_totals_by_city` 工具,在工具里用 Python 算好,只返回三行。这其实就是 [Day 182](/blog/agent-zero/day-182-tool-design-2/) 原则一「按任务设计,不按命令设计」。它不需要沙箱,结果完全确定。

CodeAct 真正的价值在于**你没法预先知道用户要怎么组合工具**的时候:今天问退款最多的城市,明天问每个负责人名下退款率最高的月份,后天问哪些客户连续三个月都有退款。你不可能为每一种问法都写一个汇总工具,让模型现写代码就成了最灵活的选择。什么时候该用、什么时候不该用,明天跑完完整对比后再细说。

## 动手练习

### 练习 1:订单从 400 条加到 1,200 条

把 `ORDERS` 换成 `_make_orders(n=1200)`,用 JSON 做法跑同一道题。看工具结果多大、输入 token 涨了多少、答案对不对。建议跑两遍。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part03/json_mode_big.py  练习 1:订单从 400 条加到 1200 条,JSON 做法会怎样
from part03 import orders_tools
from part03.agent_loop import run_agent
from part03.json_mode import SYSTEM, TASK, grade

orders_tools.ORDERS[:] = orders_tools._make_orders(n=1200)  # 原地换成 1200 条,工具和标准答案都跟着变
print("退款单", sum(o["status"] == "refunded" for o in orders_tools.ORDERS),
      "| JSON 字符数", len(orders_tools.reg.call("list_orders", '{"status": "refunded"}')))
print("标准答案:", orders_tools.ground_truth())
answer, llm = run_agent(orders_tools.reg, SYSTEM, TASK, max_steps=6)
print(answer[-400:])
print("判卷:", grade(answer), "|", llm.ledger)
```

<div class="line-notes">

- `orders_tools.ORDERS[:] = orders_tools._make_orders(n=1200)  # 原地换成 1200 条,工具和标准答案都跟着变` 切片赋值原地替换列表内容。`list_orders` 和 `ground_truth` 里引用的都是 `ORDERS` 这个列表对象,原地换掉它们就都看到新数据了。如果写成 `orders_tools.ORDERS = ...`,只是让模块属性指向新列表,两个函数里的名字在本模块里查找,也能生效;但别的模块里 `from ... import ORDERS` 拿到的还是旧列表,原地改更保险。
- `print("退款单", sum(o["status"] == "refunded" for o in orders_tools.ORDERS),` `True` 在 Python 里可以当 1 加,所以对布尔值求和就是数个数。
- `answer, llm = run_agent(orders_tools.reg, SYSTEM, TASK, max_steps=6)` 注册表还是原来那个,工具函数没变,只是数据变了。
- `print(answer[-400:])` 回答可能很长,只看最后 400 个字符,表格通常在最后。

</div>

```bash
uv run python -m part03.json_mode_big
```

第一遍:

```text
退款单 368 | JSON 字符数 26058
标准答案: [('杭州', 26080.82, '刘洋'), ('西安', 24965.31, '周婷'), ('成都', 23051.19, '赵敏')]
[step 1] 输入 389 tok | 输出 55 tok
    调用 list_orders({"status": "refunded"}) -> 返回 26058 字符
[step 2] 输入 11497 tok | 输出 6538 tok
    调用 get_city_manager({"city": "杭州"}) -> 返回 31 字符
    调用 get_city_manager({"city": "西安"}) -> 返回 31 字符
    调用 get_city_manager({"city": "成都"}) -> 返回 31 字符
[step 3] 输入 18102 tok | 输出 138 tok
……
| 1 | 杭州 | 26,080.82 | 刘洋 |
| 2 | 西安 | 24,965.31 | 周婷 |
| 3 | 成都 | 23,051.19 | 赵敏 |
……
判卷: 杭州对 西安对 成都对 | 3 次调用 | 输入 29988 / 输出 6731 tokens | 约 ¥0.0774
```

第二遍(同一个脚本再跑一次;我为了看清模型在第二、三步写了什么,临时把每次的回复内容也打印了出来,这里只摘要):

```text
[step 1] 输入 389 tok | 输出 56 tok
    调用 list_orders({"status": "refunded"}) -> 返回 26058 字符
[step 2] 输入 11498 tok | 输出 759 tok
    调用 get_city_manager × 8 个城市
[step 3] 输入 12429 tok | 输出 5673 tok
    (回复正文 9,317 个字符,先把杭州的 51 个金额列出来,再写「661.2+741.67=1402.87、+590.74=1993.61……」逐笔累加)
| 1 | **杭州** | **26080.82** | 刘洋 |
| 2 | **西安** | **24185.00** | 周婷 |
| 3 | **成都** | **22181.74** | 赵敏 |
判卷: 杭州对 西安错 成都错 | 3 次调用 | 输入 24316 / 输出 6488 tokens | 约 ¥0.0754
```

两遍放在一起看:

**工具结果变成 26,058 个字符,第二步输入一下子到了 1.1 万 token。** 数据量翻三倍,上下文跟着翻三倍,而且第三步还要再发一遍。

**模型的应对是「把算式写出来」。** 两遍都输出了六千多个 token,用的是逐笔累加的写法,相当于自己做了一次很长的思维链。第一遍三个都算对了;第二遍杭州对了,西安和成都错了,西安少了 780 元。同一道题,同样的做法,一遍对一遍错。

**花费涨了五倍,对错变成了抛硬币。** 400 条时一遍约 ¥0.015,1,200 条时约 ¥0.076,其中大头是输出:六千多个输出 token 按每百万 8 元算就是五分钱,全花在「用文字做加法」上。

数据量再大,比如一万条,JSON 做法要么撑爆上下文窗口,要么被截断后答错。而写代码那段的 token 基本不变,因为代码根本不关心有多少条数据。

</details>

### 练习 2:不换成写代码,加一个汇总工具

在 `orders_tools.reg` 上再登记一个 `refund_totals_by_city(top=3)`,在工具里用 Python 按城市汇总退款并排序。描述里告诉模型「问哪些城市退款最多时用它,不要自己去加」。用 400 条数据跑同一道题。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part03/json_mode_agg.py  练习 2:不换成写代码,而是按任务加一个汇总工具
from typing import Annotated

from part03.agent_loop import run_agent
from part03.json_mode import SYSTEM, TASK, grade
from part03.orders_tools import ORDERS, reg


@reg.tool
def refund_totals_by_city(
    top: Annotated[int, "只返回退款总额最高的前几个城市,默认 3"] = 3,
) -> list[dict[str, float | str]]:
    """按城市汇总已退款订单的金额,从高到低排序,金额单位元、保留两位小数。问「哪些城市退款最多」时用它,不要自己去加 list_orders 的结果。"""
    totals: dict[str, float] = {}
    for o in ORDERS:
        if o["status"] == "refunded":
            totals[o["city"]] = totals.get(o["city"], 0) + o["amount"]
    ranked = sorted(totals.items(), key=lambda kv: kv[1], reverse=True)[:top]
    return [{"city": c, "refund_total": round(t, 2)} for c, t in ranked]


answer, llm = run_agent(reg, SYSTEM, TASK, max_steps=6)
print(answer)
print("判卷:", grade(answer), "|", llm.ledger)
```

<div class="line-notes">

- `@reg.tool` 直接登记到 `orders_tools` 里那个注册表上。导入 `reg` 拿到的是同一个对象,所以 `run_agent(reg, ...)` 时三个工具都在。
- `top: Annotated[int, "只返回退款总额最高的前几个城市,默认 3"] = 3,` 参数有默认值,模型可以不填。
- `) -> list[dict[str, float | str]]:` 返回值类型:字典列表,值可能是字符串(城市)或浮点数(金额)。`float | str` 相当于 TS 的 `number | string`。
- `"""按城市汇总已退款订单的金额,从高到低排序,金额单位元、保留两位小数。问「哪些城市退款最多」时用它,不要自己去加 list_orders 的结果。"""` 描述里明确说了什么时候用它、别用另一个工具自己加,[Day 182](/blog/agent-zero/day-182-tool-design-2/) 原则三。
- `return [{"city": c, "refund_total": round(t, 2)} for c, t in ranked]` 只返回前 `top` 个城市的名字和总额,三条加起来 124 个字符。

</div>

```bash
uv run python -m part03.json_mode_agg
```

```text
[step 1] 输入 493 tok | 输出 53 tok
    调用 refund_totals_by_city({"top": 3}) -> 返回 124 字符
[step 2] 输入 609 tok | 输出 111 tok
    调用 get_city_manager({"city": "上海"}) -> 返回 31 字符
    调用 get_city_manager({"city": "广州"}) -> 返回 31 字符
    调用 get_city_manager({"city": "成都"}) -> 返回 31 字符
[step 3] 输入 787 tok | 输出 103 tok
退款总金额最高的三个城市如下:

| 排名 | 城市 | 退款总额(元) | 区域负责人 |
|------|------|----------------|------------|
| 1 | 上海 | 10,731.38 | 陈静 |
| 2 | 广州 | 8,613.37 | 李娜 |
| 3 | 成都 | 8,137.58 | 赵敏 |

三个城市退款总额合计 27,482.33 元。
判卷: 上海对 广州对 成都对 | 3 次调用 | 输入 1889 / 输出 267 tokens | 约 ¥0.0037
```

全对,输入 1,889 个 token,花费是 JSON 做法的四分之一。模型第一步就选了新工具,没去碰 `list_orders`。连最后那句「合计 27,482.33 元」也是对的(三个数相加确实是这个),三个数相加它还是能做对的,难的是二十几个。

这个练习想说明的是:**很多时候「数据太大」的问题,在工具设计层面就能解决,不需要 CodeAct。** 但它的前提是你预先知道用户要问「按城市汇总退款」。换一种问法,比如「退款金额超过 800 元的订单里,哪个城市占比最高」,这个工具就帮不上了,要么再加一个工具,要么让模型写代码。

</details>

### 练习 3:量一下结果的 token

用 `max_tokens=1` 量出 116 条退款单 JSON 和「三行 print 结果」各是多少 token。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part03/result_tokens.py  练习 3:一个工具结果有多少 token,一行 print 又有多少
from common.llm import LLMClient
from part03.orders_tools import ground_truth, reg

llm = LLMClient()
big = reg.call("list_orders", '{"status": "refunded"}')
small = "\n".join(f"{c} {t} {m}" for c, t, m in ground_truth())
for label, text in [("116 条退款单 JSON", big), ("三行 print 结果", small)]:
    r = llm.chat([{"role": "user", "content": text}], max_tokens=1)
    print(f"{label}: {len(text)} 字符 -> {r.prompt_tokens} token")
print(llm.ledger)
```

<div class="line-notes">

- `big = reg.call("list_orders", '{"status": "refunded"}')` 走注册表拿到的,就是 JSON 做法里塞进 tool 消息的那个字符串。
- `small = "\n".join(f"{c} {t} {m}" for c, t, m in ground_truth())` 模拟代码做法 print 出来的三行:城市、总额、负责人。
- `r = llm.chat([{"role": "user", "content": text}], max_tokens=1)` 把文本当成一条消息发过去,看 `prompt_tokens`。这会多算几个消息格式的 token,但量级不受影响。

</div>

```bash
uv run python -m part03.result_tokens
```

```text
116 条退款单 JSON: 8212 字符 -> 3486 token
三行 print 结果: 42 字符 -> 33 token
2 次调用 | 输入 3519 / 输出 2 tokens | 约 ¥0.0071
```

一百倍的差距,而且 JSON 那边每多一步就要多付一遍。注意中文 JSON 的 token 密度:8,212 个字符 3,486 个 token,大约 2.4 个字符一个 token,比 Day 184 量的工具定义(3.5 个字符一个 token)更费,因为订单数据里城市名是中文,数字和标点也多。

</details>

### 练习 4:判断该用哪种做法(开放题)

下面三个场景,你会用普通 JSON 工具调用、加一个专门的汇总工具,还是让模型写代码?说出理由。

1. 客服 Agent 根据客户邮箱查出客户,再查他最近的发票。
2. 运营每天问「昨天各渠道的新增订单数」,问法基本固定。
3. 数据分析助手,用户会问各种临时的组合统计,比如「上个月退款超过 800 元的订单里,每个负责人名下占比最高的城市」。

<details><summary>参考答案</summary>

这是一个示范解法,不是唯一答案。

1. **普通 JSON 工具调用。** 两步,每步数据都很小(一个客户、几张发票),没有计算。写代码要多一个执行环境,收益几乎为零。Day 184 的 `customer_find` 加 `invoice_list` 就是这种。
2. **加一个专门的汇总工具。** 问法固定,结果确定,做成 `orders_daily_by_channel(date)` 一个工具,在工具里聚合好只返回几行,和练习 2 一样,不需要沙箱,也不会算错。
3. **让模型写代码。** 组合方式无法预先穷举,每种问法都加一个工具不现实;数据量也大,JSON 做法要把全部订单搬进上下文、再让模型心算,今天已经看到它算不对。这时 CodeAct 的灵活性最值钱,代价是要有沙箱,并且要处理代码报错和权限(明天讲)。

判断的主线就两个问题:**数据需要穿过模型吗?** 需要计算或大量数据时尽量不要。**组合方式能预先知道吗?** 能就做成工具,不能才让模型现写代码。

</details>

**验收标准**:练习 1 有两遍的输入、输出 token 和对错,能说出数据量变大后 JSON 做法哪里变贵、哪里变得不可靠;练习 2 全对并说出这种做法的前提;练习 3 有两个 token 数;练习 4 三个场景各有选择和理由。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 中间结果 | 工具返回的、只是为了算出最终答案而存在的数据,比如今天的 116 条订单。最终答案只要三行 |
| 中间结果过上下文 | JSON 工具调用里,每个工具结果都作为 tool 消息进入模型的上下文,之后每一步都重发 |
| 回合(round trip) | 模型发出工具调用 → 你执行 → 结果回传 → 模型再决定,这一来一回。[Day 159](/blog/agent-zero/day-159-tool-roundtrip/) 首次出现 |
| CodeAct(代码即动作) | 让 Agent 的每个动作是一段可执行的代码,工具是代码里的函数。出自 2024 年的论文《Executable Code Actions Elicit Better LLM Agents》 |
| 沙箱(sandbox) | 一个限制了权限的执行环境,让不可信的代码跑起来也碰不到不该碰的文件、网络和密钥。和浏览器把网页关在沙箱里是一个意思 |
| smolagents | Hugging Face 的 Agent 库,主打 CodeAgent,默认用自己写的受限解释器执行代码 |
| Code Mode | Cloudflare 的做法:把 MCP 工具变成 TypeScript API,让模型写代码调用,在 V8 isolate 里执行 |
| 程序化工具调用(PTC) | Anthropic 的做法:Claude 在托管容器里写 Python 调你的工具,中间结果留在容器里,只有输出进上下文 |
| `allowed_callers` | PTC 里标在工具定义上的字段,表示这个工具可以被代码调用。只是引导,不是安全边界 |
| 汇总工具 | 按任务专门写的工具,在工具里把大量数据算成小结论再返回,比如练习 2 的 `refund_totals_by_city` |

## 常见误区

**以为模型能把一堆数加对。** 今天三遍金额全错,其中一遍把 23 个数一个不差地列出来,加出来却少了 170 元。模型输出的数字是猜出来的一串字符,不是算出来的。凡是求和、计数、排序这类计算,交给代码。

**看到模型「列出了算式」就放心。** 列算式能提高一点准确率,但不能保证对,而且很贵:1,200 条数据时模型为了逐笔累加输出了六千多个 token,一遍对一遍错。

**以为数据量大只是钱的问题。** 数据量变大,上下文跟着变大,每一步还要重发;到某个量级要么撑爆窗口,要么被截断,截掉的部分可能正好是答案需要的。

**拿到模型写的代码就直接 `exec`。** 模型写的代码能做的事和你自己写的一样多:读文件、删目录、发网络请求。没有沙箱之前一行都别执行。今天只打印不执行,就是这个原因。

**以为 CodeAct 适合所有任务。** 一两步、数据量小、没有计算的任务,JSON 工具调用更简单。问法固定的统计需求,做成专门的汇总工具更稳。CodeAct 的优势在于组合方式没法预先穷举的时候。

**在 f-string 里直接写花括号。** 给模型的提示里常常要放 JSON 示例,如果这个字符串前面有 `f`,`{"city": ...}` 会被当成插值,报 `ValueError: Format specifier missing precision`。要么写成 `{{` `}}`,要么别用 f-string。

**以为 `allowed_callers` 能防止模型直接调某个工具。** Anthropic 文档明确说了它不是安全边界,你的程序仍然要能处理模型直接调用的情况。权限要在执行工具的那一侧控制。

## 学习资料

### 文档与文章

- [arXiv · Executable Code Actions Elicit Better LLM Agents](https://arxiv.org/abs/2402.01030):CodeAct 原论文,ICML 2024。读摘要和第 2 节,看他们怎么比较 JSON、文本和代码三种动作格式,英文。
- [Anthropic · Code execution with MCP](https://www.anthropic.com/engineering/code-execution-with-mcp):2025 年 11 月 4 日,讲工具定义和中间结果两个问题,以及把 MCP server 呈现成文件树的做法,和今天的内容对应得最紧,英文。
- [Cloudflare · Code Mode: the better way to use MCP](https://blog.cloudflare.com/code-mode/):2025 年 9 月 26 日,前端读者会觉得很亲切,TypeScript 加 V8 isolate,英文。
- [Cloudflare · Code Mode MCP](https://blog.cloudflare.com/code-mode-mcp/):2026 年 2 月 20 日的后续,两千五百多个接口只用 `search()` 和 `execute()` 两个工具,英文。
- [Claude 文档 · Programmatic tool calling](https://platform.claude.com/docs/en/agents-and-tools/tool-use/programmatic-tool-calling):PTC 的正式文档,看 `allowed_callers` 和「不是安全边界」那段,英文。
- [smolagents 文档 · Secure code execution](https://huggingface.co/docs/smolagents/tutorials/secure_code_execution):为什么代码更好、本地解释器怎么限制 import 和循环、为什么本地沙箱不可能完全安全,英文。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1wXZfYRErX&autoplay=0&high_quality=1" title="ReAct和CodeAct-Agent调用外部工具的两种方法，从原理到实战-工具调用/MCP/FunctionCall/OpenAI/Cursor/LLM" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>MiuMiu8802 · ReAct 和 CodeAct,Agent 调用外部工具的两种方法,从原理到实战 · 55 分钟,把 JSON/文本式工具调用和写代码调用放在一起对比讲,配套代码在简介的 GitHub 仓库。时间长,可以先看原理部分。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1pzmJB5E4d&autoplay=0&high_quality=1" title="代码执行mcp工具，解决上下文爆炸问题" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>Token杰-自然智群 · 代码执行 mcp 工具,解决上下文爆炸问题 · 不到 6 分钟,讲的就是 Anthropic《Code execution with MCP》那篇的思路,适合读英文原文前先听个中文版。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/-ZikRWR1Gb4" title="Code Mode: Giving AI Agents an Entire API in 1,000 Tokens (With Demos)" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Cloudflare · Code Mode: Giving AI Agents an Entire API in 1,000 Tokens (With Demos) · Cloudflare 官方的演示,看模型怎么写 TypeScript 先搜接口再调用,英文。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/n5K2fjlT0FQ" title="CodeAct: Code As Action Space of LLM Agents - Pros and Cons" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>John Tan Chong Min · CodeAct: Code As Action Space of LLM Agents - Pros and Cons · 讲论文,也讲这种做法的缺点,和今天「先别急着全换成代码」那一节对着看,英文。</figcaption>
</figure>

### 书籍

- Chip Huyen《AI Engineering》(O'Reilly, 2025):第 6 章 Agent 部分讲工具和规划,其中把「代码解释器」列为一类重要的工具,并讨论了让 Agent 执行代码的风险,英文。

### 开源项目与代码

- [xingyaoww/code-act](https://github.com/xingyaoww/code-act):CodeAct 论文的官方仓库,有数据集和评测代码,看 README 了解他们怎么搭实验。
- [huggingface/smolagents](https://github.com/huggingface/smolagents):`src/smolagents/local_python_executor.py` 就是那个「把代码解析成语法树逐步解释执行」的受限解释器,可以搜 `authorized_imports` 看它怎么限制 import。

## 自测

1. JSON 工具调用的哪两个性质,让它在「拿大量数据再汇总」的任务上又贵又容易错?

<details><summary>答案</summary>

一是每个工具结果都要经过模型的上下文,而且留在历史里每一步重发:116 条订单 3,486 个 token,三步任务里发了两遍。二是组合逻辑只能靠模型在回合之间完成,循环、过滤、求和这些在 JSON 里表达不了,只能让模型「心算」,而模型写出的数字是猜出来的,今天三遍上海的金额全错。

</details>

2. 第二遍里模型把上海的 23 个金额全部正确地列了出来,结果还是错了。这说明了什么?

<details><summary>答案</summary>

说明问题不在从大段 JSON 里找数据(这一步它做得很好),而在计算本身。模型输出等号后面的数字时,是在预测下一个最可能的 token,不是在做加法,所以列出算式也只能降低出错的概率,不能保证对。计算应该交给代码。

</details>

3. CodeAct 论文的三个论点是什么?为什么这个主意 2024 年没有立刻流行?

<details><summary>答案</summary>

三个论点:代码天然能组合(变量、循环、条件,JSON 都没有);模型训练数据里有海量代码,写代码比写自定义 JSON 格式更顺;解释器的报错本身就是很好的反馈。没有立刻流行是因为执行模型生成的代码必须有沙箱,当时做一个安全、便宜、启动快的沙箱成本很高;2025–2026 年沙箱服务成熟、MCP 让工具数量和上下文成本成了大问题后,才被几家同时采用。

</details>

4. smolagents、Cloudflare Code Mode、Anthropic PTC 三者的共同点是什么?最主要的区别是什么?

<details><summary>答案</summary>

共同点:工具的执行仍然由你(或你的服务)控制,模型写的代码在隔离环境里执行,中间数据留在执行环境里不进上下文,只有代码的输出回到模型。最主要的区别是执行环境归谁管:smolagents 让你选本地受限解释器或远程沙箱;Cloudflare 跑在自家 Workers 的 V8 isolate 里,写的是 TypeScript;Anthropic 跑在自家托管的容器里,写的是 Python。

</details>

5. 面试题:你的数据分析 Agent 经常给出「看起来很精确但不对」的统计数字。你会怎么分析原因、怎么改?

<details><summary>答案</summary>

先看轨迹:如果工具把大量原始数据返回给了模型,数字是模型自己在回答里算的,那原因基本就是「让模型心算」,模型输出的数字是预测出来的,数据越多越不可靠,列出算式也只是降低概率。改法按场景分:问法固定的统计,做成专门的汇总工具,在工具里用代码算好只返回结果;问法灵活、组合方式没法穷举的,改成 CodeAct,让模型写代码调用工具、在代码里计算,只把 print 的结果交回模型,并且一定要配沙箱、限制 import 和网络、设超时。最后用一批带标准答案的统计题做回归评测,用程序判卷,不要凭肉眼看「像不像对的」。

</details>

## 明天预告

明天是 **Day 187 · 代码即动作(二):工具桥加子进程,两种做法实测**。今天模型写的那段代码还躺在屏幕上没执行。明天给它一个执行环境:代码在一个单独的子进程里跑,里面的 `list_orders` 是一个桩,调用时把请求通过「工具桥」转发回主进程,主进程用注册表真正执行再把结果送回去,子进程里不需要任何 key。接进 Agent 循环后,同一道题 JSON 做法和代码做法完整地比一遍 token、调用次数和正确率,再讲为什么子进程还不算真正的沙箱。
