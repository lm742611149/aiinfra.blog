---
title: 'Day 132 · 代码即动作:CodeAct、Code Mode 与程序化工具调用'
description: '让模型不再一次调一个 JSON 工具,而是写一段 Python 批量调用工具、在代码里过滤和汇总,只把结果交回上下文。讲 CodeAct 论文、smolagents、Cloudflare Code Mode、Anthropic 程序化工具调用,自己写一个带工具桥的执行器,实测同一道题 JSON 做法和代码做法的 token 和正确率,最后讲沙箱为什么必须有、怎么选。'
pubDate: 2026-10-22
regime: none
tags: ['code-execution', 'codeact', 'sandbox', 'tool-use', 'agent-60']
series: 'agent-60'
day: 132
lang: 'zh'
---

## 今天要解决的问题

这是专题篇的一篇,**建议在 [Day 12 · Agent 的失败模式](/blog/agent-60/day-12-failure-modes/) 之后读**。你需要会 Day 9 手写的 Agent 循环和 `ToolRegistry`,知道 Day 11 讲的工具设计原则,也见过 Day 12 里「工具结果太长要截断」那一套。今天的代码放在 `agent-60-lab/topics/code_as_action/` 下面(目录名用下划线,因为要当 Python 包导入),所有命令都在仓库根目录跑。

先说一个你多半已经撞上过的场景。让 Agent 回答「退款最多的三个城市各退了多少钱」,它调用 `list_orders`,工具返回 116 条订单,八千多个字符原样塞进上下文。然后模型要在脑子里把这 116 个金额按城市加起来。它会认真地加,加完给你一个保留两位小数、看起来非常可信的数字,而这个数字有一半的概率是错的。

问题不在模型笨,在于我们让它做了它不擅长的事:搬运和心算大量数据。程序员处理这种事的办法是写个循环。那为什么不让模型也写个循环?这就是今天的主题:**让模型用代码表达动作**,工具变成可以在代码里调用的函数,中间数据留在执行环境里,只有 `print` 出来的那点东西回到上下文。

学完你应该能:

1. 说清 JSON 工具调用在「多步、数据量大」的任务上卡在哪,以及 CodeAct 论文的核心论点。
2. 分清 2025–2026 年这个思路的三种落地:smolagents 的 CodeAgent、Cloudflare 的 Code Mode、Anthropic 的程序化工具调用(Programmatic Tool Calling)。
3. 自己实现一个「代码在子进程里跑、工具调用转发回主进程」的执行器,并把它接进一个 Agent 循环。
4. 用实测数字比较两种做法的 token、调用次数和正确率。
5. 知道子进程不是沙箱,能说出 Docker、E2B、Modal 这类方案各自隔离了什么,以及什么时候不该用这个模式。

预计用时 4–5 小时。花费很少,下面所有实测加起来不到一毛钱。

## JSON 工具调用卡在哪

回忆一下 Day 8 的协议:模型输出一段 JSON,写明工具名和参数;你的代码执行,把结果作为 `tool` 消息塞回去;模型读完再决定下一步。一来一回叫一个回合。

这个协议有两个性质,在简单任务上完全不是问题,在复杂任务上就变成了瓶颈。

第一,**每个工具结果都要经过模型的上下文**。工具返回什么,模型就得读什么。返回 116 条订单就是八千字符、几千个 token;返回一万行日志就是几十万 token。Day 12 教你截断,截断是止血,不是治病:截掉的部分可能正好是答案需要的。

第二,**组合逻辑只能靠模型在回合之间完成**。「先查列表,再对其中前三个各查一次详情,再汇总」,在 JSON 协议里至少是三个回合(并行工具调用能把同一回合内的几个调用合并,但「先拿到列表才知道要查谁」这种依赖没法合并)。每个回合都要把整个上下文重新发一遍,回合越多,输入 token 越是成倍地涨。更要命的是循环、过滤、排序、求和这些操作,模型只能「心算」。

<figure>
<svg viewBox="0 0 640 300" role="img" aria-label="JSON 工具调用与代码调用的数据流对比">
  <rect x="0" y="0" width="640" height="300" fill="var(--paper-raised)" rx="6"/>
  <text x="160" y="28" text-anchor="middle" font-family="var(--font-mono)" font-size="13" fill="var(--ink)">JSON 工具调用</text>
  <text x="480" y="28" text-anchor="middle" font-family="var(--font-mono)" font-size="13" fill="var(--ink)">写代码调用</text>
  <line x1="320" y1="16" x2="320" y2="288" stroke="var(--rule)" stroke-dasharray="4 4"/>
  <rect x="40" y="50" width="100" height="40" fill="var(--mem-wash)" stroke="var(--mem)" rx="4"/>
  <text x="90" y="75" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--mem)">模型</text>
  <rect x="190" y="50" width="100" height="40" fill="var(--compute-wash)" stroke="var(--compute)" rx="4"/>
  <text x="240" y="75" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--compute)">工具</text>
  <line x1="140" y1="62" x2="190" y2="62" stroke="var(--ink-soft)"/>
  <line x1="190" y1="80" x2="140" y2="80" stroke="var(--compute)" stroke-width="3"/>
  <text x="165" y="110" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--compute)">116 条订单原样回来</text>
  <text x="165" y="140" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">回合 1 list_orders</text>
  <text x="165" y="160" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">模型心算各城市合计</text>
  <text x="165" y="180" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">回合 2 三次 get_city_manager</text>
  <text x="165" y="200" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">回合 3 写最终回答</text>
  <text x="165" y="240" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">输入约 9,000 token</text>
  <rect x="350" y="50" width="80" height="40" fill="var(--mem-wash)" stroke="var(--mem)" rx="4"/>
  <text x="390" y="75" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--mem)">模型</text>
  <rect x="460" y="50" width="160" height="100" fill="none" stroke="var(--ink-soft)" rx="4"/>
  <text x="540" y="68" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">执行环境</text>
  <rect x="475" y="80" width="60" height="30" fill="none" stroke="var(--ink-soft)" rx="3"/>
  <text x="505" y="99" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">代码</text>
  <rect x="550" y="80" width="60" height="30" fill="var(--compute-wash)" stroke="var(--compute)" rx="3"/>
  <text x="580" y="99" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--compute)">工具</text>
  <line x1="535" y1="95" x2="550" y2="95" stroke="var(--compute)" stroke-width="3"/>
  <text x="540" y="132" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--compute)">数据在这里过滤汇总</text>
  <line x1="430" y1="62" x2="460" y2="62" stroke="var(--ink-soft)"/>
  <text x="445" y="56" text-anchor="middle" font-family="var(--font-mono)" font-size="10" fill="var(--ink-faint)">代码</text>
  <line x1="460" y1="140" x2="430" y2="85" stroke="var(--mem)"/>
  <text x="410" y="175" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--mem)">只回来 3 行 print</text>
  <text x="480" y="240" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">输入约 550 token</text>
</svg>
<figcaption>同一道题的两种做法。左边每个工具结果都要穿过模型的上下文,汇总靠模型心算;右边模型写一段代码,工具在执行环境里被调用,数据就地处理,只有 print 的几行回到模型。图里的 token 数是下面实测的量级。</figcaption>
</figure>

## 让模型写代码:CodeAct 在说什么

2024 年 UIUC 和苹果的研究者发了一篇论文《Executable Code Actions Elicit Better LLM Agents》,提出 CodeAct:Agent 的每个动作不是一段 JSON,而是一段可执行的 Python。工具变成预先导入的函数,模型想调就调,想循环就循环,想把一个工具的结果喂给另一个工具就直接传变量。执行完,解释器的输出(包括报错)作为观察结果交回模型,下一轮模型可以改代码再跑。

论文的论点可以归结成三条,我觉得每条都站得住:

- **代码天然能组合**。JSON 没有变量、没有循环、没有条件。「对列表里每个元素调一次」在 JSON 里要模型展开成 N 个调用,在代码里是一个 `for`。
- **模型的训练数据里有海量代码**。模型见过的 Python 远比见过的「某种自定义 JSON 工具格式」多,写起来更顺。
- **报错信息是现成的反馈**。`TypeError: list_orders() got an unexpected keyword argument 'state'` 比你自己设计的错误提示还清楚,模型看了就知道怎么改。

论文在他们自建的多工具基准上报告,CodeAct 比 JSON 和纯文本格式的成功率最多高 20 个百分点,需要的回合数也更少。具体数字看论文表格,别背,重点是方向。

这个想法当时没有立刻成为主流,原因很现实:**执行模型生成的代码需要沙箱**,而 2024 年做一个安全、便宜、启动快的沙箱不是小事。到了 2025–2026 年,沙箱服务成熟了,MCP 让工具数量爆炸,上下文成本成了大问题,这个思路才被几家大厂同时捡起来。

## 2025–2026 年的三种落地

**smolagents 的 CodeAgent**。Hugging Face 的 smolagents 从一开始就把 CodeAgent 当成主打,Hugging Face Agents Course 的第二单元也是用它讲的。2026 年 10 月查到 PyPI 上最新是 1.26.0(5 月发布)。它默认用自己写的 `LocalPythonExecutor` 执行代码:不是直接 `exec`,而是解析语法树一步一步解释执行,默认禁止 import(要你显式放行)、限制循环次数。官方文档说得很直白,任何本地 Python 沙箱都不可能完全安全,真要隔离就用 `executor_type="e2b"`、`"modal"`、`"docker"` 这类远程执行器。

**Cloudflare 的 Code Mode**。2025 年 9 月 Cloudflare 发了一篇《Code Mode: the better way to use MCP》,做法是把 MCP 工具转成 TypeScript API,让模型写代码调用,代码跑在 Workers 的 V8 isolate 里。2026 年 2 月 20 日的后续文章更激进:Cloudflare 自己 API 有两千五百多个接口,如果每个都做成一个 MCP 工具,光工具定义就超过两百万 token;他们的新 MCP server 只暴露 `search()` 和 `execute()` 两个工具,固定开销大约一千 token。模型先写一段代码在 OpenAPI 规范里搜要用的接口,再写一段代码调用。沙箱里没有文件系统、没有环境变量,外部 fetch 默认关闭。

**Anthropic 的代码执行和程序化工具调用**。2025 年 11 月 4 日 Anthropic 工程博客发了《Code execution with MCP》,建议把 MCP server 呈现成文件树:`servers/google-drive/getDocument.ts` 这样每个工具一个文件,Agent 先列目录,用到哪个工具才读哪个文件。文中的例子把一个工作流的上下文开销从约 15 万 token 降到约 2 千。同月 24 日的《Introducing advanced tool use on the Claude Developer Platform》推出了程序化工具调用(Programmatic Tool Calling,下面简称 PTC),当时是 beta;2026 年 10 月查官方文档,状态已经是 GA。用法是在请求里加上代码执行工具 `code_execution_20260120`,再在你想让代码调用的工具定义上加 `allowed_callers: ["code_execution_20260120"]`。Claude 在 Anthropic 托管的容器里写 Python,里面每个工具都是一个 async 函数;代码调用工具时,API 会停下来返回一个 `tool_use` 块,`caller` 字段标明是代码调的,你执行完回传结果,代码接着跑。Anthropic 报告在复杂研究任务上平均 token 从 43,588 降到 27,297,降了 37%。

三家的共同点是:**工具执行仍然在你手里,代码执行在隔离环境里,中间数据不进上下文**。区别在于执行环境归谁管:smolagents 让你自己选,Cloudflare 和 Anthropic 托管在自家平台。文档里还有一句值得记住:`allowed_callers` 只是给模型的引导,不是安全边界,你的客户端仍要能处理模型直接调用这个工具的情况。

## 自己实现一个:工具桥加子进程

框架会用了,原理还是要自己写一遍才踏实。我们写的东西和 PTC 的结构一模一样:代码在一个单独的进程里跑,里面的「工具函数」其实是桩,调用时把请求发回主进程,主进程用 Day 9 的 `ToolRegistry` 真正执行,再把结果送回去。这样做有一个很重要的好处:**子进程里不需要任何 API key、不需要数据库连接**,真正有权限的东西都留在主进程。

<figure>
<svg viewBox="0 0 640 260" role="img" aria-label="工具桥时序图">
  <rect x="0" y="0" width="640" height="260" fill="var(--paper-raised)" rx="6"/>
  <rect x="60" y="20" width="160" height="36" fill="var(--mem-wash)" stroke="var(--mem)" rx="4"/>
  <text x="140" y="43" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--mem)">主进程 run_code</text>
  <rect x="420" y="20" width="160" height="36" fill="none" stroke="var(--ink-soft)" rx="4"/>
  <text x="500" y="43" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">子进程 python -I</text>
  <line x1="140" y1="56" x2="140" y2="245" stroke="var(--rule)"/>
  <line x1="500" y1="56" x2="500" y2="245" stroke="var(--rule)"/>
  <line x1="140" y1="80" x2="500" y2="80" stroke="var(--ink-soft)"/>
  <text x="320" y="74" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">启动:桥 + 工具桩 + 模型的代码</text>
  <line x1="500" y1="115" x2="140" y2="115" stroke="var(--compute)"/>
  <text x="320" y="109" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--compute)">stdout: \0TOOL {"name":"list_orders",...}</text>
  <rect x="70" y="125" width="140" height="28" fill="var(--compute-wash)" stroke="var(--compute)" rx="3"/>
  <text x="140" y="144" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--compute)">registry.call 真执行</text>
  <line x1="140" y1="170" x2="500" y2="170" stroke="var(--compute)"/>
  <text x="320" y="164" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--compute)">stdin: 工具结果 JSON 一行</text>
  <line x1="500" y1="205" x2="140" y2="205" stroke="var(--mem)"/>
  <text x="320" y="199" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--mem)">普通 print 行 → 收集起来交给模型</text>
  <text x="320" y="238" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">进程退出 / CPU 超限 / 20 秒超时 → 返回 RunResult</text>
</svg>
<figcaption>工具桥的一次往返。子进程靠一个特殊前缀把工具请求写到 stdout,主进程识别出来就去执行,把结果写回子进程的 stdin;其余的 stdout 行就是代码的正常输出。</figcaption>
</figure>

先准备一份数据和两个工具。数据用固定随机种子生成,保证你和我跑出来一模一样。

```python
# agent-60-lab/topics/code_as_action/tools.py
import random
from typing import Annotated, Literal

from w2.agent_loop import ToolRegistry

CITIES = ["北京", "上海", "广州", "深圳", "杭州", "成都", "武汉", "西安"]
MANAGERS = {"北京": "王磊", "上海": "陈静", "广州": "李娜", "深圳": "张伟",
            "杭州": "刘洋", "成都": "赵敏", "武汉": "孙浩", "西安": "周婷"}


def _make_orders(n: int = 400, seed: int = 132) -> list[dict]:
    rng = random.Random(seed)  # 固定种子,每次生成的数据一样
    rows = []
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
def list_orders(status: Annotated[Literal["paid", "refunded", "all"], "订单状态"] = "all") -> list:
    """按状态列出订单。每条订单有 id、city、amount(元)、status。"""
    return [o for o in ORDERS if status == "all" or o["status"] == status]


@reg.tool
def get_city_manager(city: Annotated[str, "城市名,例如 '杭州'"]) -> dict:
    """查某个城市的区域负责人。"""
    if city not in MANAGERS:
        return {"error": f"没有城市 {city},可选: {CITIES}"}
    return {"city": city, "manager": MANAGERS[city]}


def ground_truth() -> list[tuple[str, float, str]]:
    """标准答案:退款总额最高的三个城市。用来检查两种做法谁算对了。"""
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

- `from w2.agent_loop import ToolRegistry` 直接复用 Day 9 的工具登记处,schema 从类型标注和 docstring 自动生成。所以这个文件要在仓库根目录用 `uv run python -m topics.code_as_action.tools` 跑,`topics/` 和 `topics/code_as_action/` 下各放一个空的 `__init__.py`。
- `rng = random.Random(seed)` 用独立的随机数生成器,不碰全局的 `random`,种子固定为 132。这样每次 import 这个模块生成的 400 条订单完全一样,下面的标准答案才有意义。
- `"status": "refunded" if rng.random() < 0.3 else "paid",` 大约三成订单是退款。实测 400 条里退款 116 条。
- `ORDERS = _make_orders()` 模块级变量,import 时生成一次。真实项目里这里是数据库查询,今天用内存列表是为了不依赖 Day 23 的 cloudledger.db。
- `def list_orders(status:` 参数用 `Literal` 限定三个取值,Day 9 的 `_param_schema` 会把它变成 JSON Schema 里的 `enum`。默认值 `"all"` 让它成为可选参数。
- `if city not in MANAGERS:` Day 11 的报错原则:出错时告诉模型有哪些可选值,它下一轮就能改对。
- `def ground_truth()` 用普通 Python 算出标准答案,专门用来给两种 Agent 判卷。实测结果是 `[('上海', 10731.38, '陈静'), ('广州', 8613.37, '李娜'), ('成都', 8137.58, '赵敏')]`。
- `print("退款单 JSON 字符数", len(reg.call(` 看一眼如果走 JSON 工具调用,这个工具结果有多大。实测 8212 个字符,这些全都要进模型的上下文。

</div>

然后是执行器。核心只有两件事:给每个工具生成一个同名的桩函数,以及在主进程里一行一行读子进程的输出,遇到工具请求就执行并回写。

```python
# agent-60-lab/topics/code_as_action/sandbox.py
import inspect
import json
import os
import resource
import subprocess
import sys
import tempfile
import threading
from dataclasses import dataclass

from w2.agent_loop import ToolRegistry

TOOL_MARK = "\x00TOOL "  # 子进程用这个前缀告诉父进程「我要调工具」

BRIDGE = '''
import json, sys
def _call_tool(name, **kwargs):
    sys.__stdout__.write("\\x00TOOL " + json.dumps({"name": name, "args": kwargs}, ensure_ascii=False) + "\\n")
    sys.__stdout__.flush()
    return json.loads(sys.stdin.readline())
'''


def tool_stubs(registry: ToolRegistry) -> str:
    """给每个工具生成一个同名 Python 函数,函数体只是把调用转发给父进程。"""
    lines = []
    for name, fn in registry.funcs.items():
        params = inspect.signature(fn).parameters.values()
        sig = ", ".join(p.name if p.default is inspect.Parameter.empty else f"{p.name}={p.default!r}" for p in params)
        kwargs = ", ".join(f"{p.name}={p.name}" for p in params)
        lines.append(f"def {name}({sig}):\n    return _call_tool({name!r}, {kwargs})\n")
    return "\n".join(lines)


@dataclass
class RunResult:
    stdout: str
    stderr: str
    tool_calls: int
    timed_out: bool
    returncode: int | None


def _limits() -> None:  # 在子进程里、执行代码之前运行
    resource.setrlimit(resource.RLIMIT_CPU, (5, 5))  # 最多 5 秒 CPU


def run_code(code: str, registry: ToolRegistry, timeout: float = 20, max_out: int = 2000) -> RunResult:
    program = BRIDGE + tool_stubs(registry) + "\n# ---- 模型写的代码 ----\n" + code
    with tempfile.TemporaryDirectory() as tmp:
        proc = subprocess.Popen(
            [sys.executable, "-I", "-c", program],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            text=True, cwd=tmp, preexec_fn=_limits,
            env={"PATH": os.environ.get("PATH", ""), "PYTHONIOENCODING": "utf-8"},  # 不带任何 API key
        )
        assert proc.stdin and proc.stdout and proc.stderr
        timer = threading.Timer(timeout, proc.kill)
        timer.start()
        out, calls = [], 0
        try:
            for line in proc.stdout:
                if line.startswith(TOOL_MARK):
                    req = json.loads(line[len(TOOL_MARK):])
                    calls += 1
                    result = registry.call(req["name"], json.dumps(req["args"], ensure_ascii=False))
                    proc.stdin.write(result + "\n")
                    proc.stdin.flush()
                else:
                    out.append(line)
            err = proc.stderr.read()
            proc.wait()
        finally:
            timed_out = not timer.is_alive()  # 计时器已经触发 = 超时被杀
            timer.cancel()
    stdout = "".join(out)
    if len(stdout) > max_out:
        stdout = stdout[:max_out] + f"\n...(输出共 {len(stdout)} 字符,已截断,请只 print 需要的部分)"
    return RunResult(stdout, err[-1500:], calls, timed_out, proc.returncode)


if __name__ == "__main__":
    from topics.code_as_action.tools import reg

    demo = 'rows = list_orders("refunded")\nprint(len(rows), rows[0])\nprint(get_city_manager("杭州"))'
    r = run_code(demo, reg)
    print(r)
    print(run_code("while True: pass", reg))
    print(run_code("import os; print(os.environ.get('LLM_API_KEY'))", reg))
```

<div class="line-notes">

- `import resource` 标准库,只在 macOS 和 Linux 上有。Windows 用户这一行会报 `ModuleNotFoundError`,把 `_limits` 和 `preexec_fn` 两处删掉就能跑,只是少了 CPU 限制。
- `TOOL_MARK = "\x00TOOL "` 用一个以空字符 `\x00` 开头的前缀区分「工具请求」和「普通 print」。正常代码几乎不可能 print 出空字符开头的行,所以不会误判。
- `BRIDGE = '''` 这段字符串会被拼在模型代码前面,在子进程里执行。里面的 `\\x00` 写了两个反斜杠,因为外层是普通字符串,`\\` 变成一个反斜杠,子进程拿到的源码里才是 `\x00`。
- `sys.__stdout__.write(` 用 `sys.__stdout__` 而不是 `print`,是防止模型的代码改了 `sys.stdout`(比如重定向到 StringIO)以后,工具请求也被吞掉。
- `return json.loads(sys.stdin.readline())` 写完请求就阻塞等一行回复。主进程回写的是 `ToolRegistry.call` 的返回值,本来就是 JSON 字符串,这里解析回 Python 对象,所以模型的代码拿到的是 list 和 dict,不是字符串。
- `sig = ", ".join(` 从真实函数的签名生成桩函数的参数列表,有默认值的带上默认值。实测对 `list_orders` 生成 `status='all'`,对 `get_city_manager` 生成 `city`。类型标注故意丢掉,子进程不需要它们。
- `lines.append(f"def {name}({sig}):` 实测生成的两段桩代码是 `def list_orders(status='all'):\n    return _call_tool('list_orders', status=status)` 和 `def get_city_manager(city):\n    return _call_tool('get_city_manager', city=city)`。
- `resource.setrlimit(resource.RLIMIT_CPU, (5, 5))` 子进程最多用 5 秒 CPU,超了操作系统发 SIGXCPU 把它杀掉。实测 `while True: pass` 的退出码是 `-24`,负数表示被信号杀死,24 就是 SIGXCPU。
- `program = BRIDGE + tool_stubs(registry) +` 子进程实际执行的源码 = 桥 + 桩 + 模型的代码。模型看不到桥,它只知道有 `list_orders` 这些函数可以调。
- `[sys.executable, "-I", "-c", program],` 用和主进程同一个 Python 解释器。`-I` 是隔离模式:不把当前目录和脚本目录加进 `sys.path`,忽略 `PYTHON*` 环境变量和用户 site-packages,防止临时目录里有个 `json.py` 之类的文件被优先导入。
- `text=True, cwd=tmp, preexec_fn=_limits,` 工作目录是一个用完就删的临时目录,代码写的文件不会落在你的仓库里。`preexec_fn` 在 fork 之后、exec 之前在子进程里执行。
- `env={"PATH": os.environ.get("PATH", ""), "PYTHONIOENCODING": "utf-8"},` 只给两个环境变量。实测在子进程里打印 `os.environ.get('LLM_API_KEY')` 得到 `None`。不过 macOS 会自己补上 `LC_CTYPE` 和 `__CF_USER_TEXT_ENCODING`,实测 `sorted(os.environ)` 是这四个。
- `timer = threading.Timer(timeout, proc.kill)` 墙钟超时。CPU 限制管不住「卡在网络请求上不占 CPU」的代码,所以要再加一层 20 秒的总时限。
- `for line in proc.stdout:` 一行一行读子进程输出,直到子进程关闭 stdout(也就是退出)。
- `result = registry.call(req["name"], json.dumps(req["args"], ensure_ascii=False))` 真正执行工具的地方,在主进程里,用的是 Day 9 的 `call`:工具名不存在、参数不对都会变成 `{"error": ...}`,不会让主进程崩。
- `timed_out = not timer.is_alive()` 计时器还活着说明没到点,子进程是自己结束的;计时器已经结束(触发过 `kill`)说明是超时。
- `stdout = stdout[:max_out] +` 输出还是要截断,但截断提示写清楚了「请只 print 需要的部分」,模型下一轮会改代码少打印。这和 Day 12 截断工具结果不同:被截掉的只是展示,数据本身还在执行环境里。
- `demo = 'rows = list_orders("refunded")` 实测这段输出 `RunResult(stdout="116 {'id': 'O0001', 'city': '武汉', 'amount': 165.52, 'status': 'refunded'}\n{'city': '杭州', 'manager': '刘洋'}\n", stderr='', tool_calls=2, timed_out=False, returncode=0)`,两次工具调用都走了桥。

</div>

最后把执行器接进一个循环。结构和 Day 9 的 Agent 一样,只是「动作」从 tool_calls 换成了回复里的 python 代码块;没有代码块就当作最终回答。

```python
# agent-60-lab/topics/code_as_action/code_agent.py
import inspect
import re
from typing import Any

from common.llm import LLMClient
from topics.code_as_action.sandbox import run_code, tool_stubs
from w2.agent_loop import ToolRegistry

FENCE = "`" * 3  # 三个反引号;直接写在源码里会和 markdown 的代码块冲突
CODE_RE = re.compile(FENCE + r"python\n(.*?)" + FENCE, re.S)

SYSTEM = """你通过写 Python 代码来完成任务。下面这些函数已经定义好,直接调用,返回值是普通的 Python 对象:

{api}

规则:
1. 每次回复最多一个 python 代码块(用 {fence}python 开头、{fence} 结尾)。代码执行后,print 出来的内容会发给你看。
2. 数据的筛选、排序、求和都在代码里做,只 print 你需要看的结果,不要把整份数据打印出来。
3. 只能用 Python 标准库。
4. 信息够了就不要再写代码,直接用中文给出最终回答。"""


def api_doc(registry: ToolRegistry) -> str:
    docs = []
    for stub, fn in zip(tool_stubs(registry).split("\n\n"), registry.funcs.values()):
        header = stub.splitlines()[0].removesuffix(":")
        docs.append(f"{header}\n    \"\"\"{inspect.getdoc(fn)}\"\"\"")
    return "\n".join(docs)


class CodeAgent:
    def __init__(self, registry: ToolRegistry, llm: LLMClient, max_steps: int = 6):
        self.registry = registry
        self.llm = llm
        self.max_steps = max_steps
        self.messages: list[Any] = [{"role": "system", "content": SYSTEM.format(api=api_doc(registry), fence=FENCE)}]
        self.tool_calls = 0

    def run(self, task: str) -> str:
        self.messages.append({"role": "user", "content": task})
        for step in range(1, self.max_steps + 1):
            r = self.llm.chat(self.messages)
            self.messages.append(r.message)
            m = CODE_RE.search(r.content)
            if not m:  # 没写代码 = 最终回答
                print(f"[step {step}] 完成")
                return r.content
            res = run_code(m.group(1), self.registry)
            self.tool_calls += res.tool_calls
            print(f"[step {step}] 执行代码,其中调用工具 {res.tool_calls} 次,退出码 {res.returncode}")
            feedback = f"代码执行结果(退出码 {res.returncode}):\n{res.stdout or '(没有输出)'}"
            if res.stderr:
                feedback += f"\n报错:\n{res.stderr}"
            if res.timed_out:
                feedback += "\n代码超时被终止。"
            self.messages.append({"role": "user", "content": feedback})
        return f"已达到最大步数 {self.max_steps}。"
```

<div class="line-notes">

- `from common.llm import LLMClient` 用 Day 4 封装的客户端,它会读 `.env` 里的 `LLM_EXTRA_BODY`(课程默认关掉 DeepSeek 思考模式),还自带 `ledger` 记账,下面比成本直接用。
- `三个反引号;直接写在源码里` 三个反引号用 `` "`" * 3 `` 拼出来,而不是直接写在字符串里。原因很土:这份代码要贴在 markdown 文章和笔记里,源码里出现三个连续反引号会把 markdown 的代码块提前截断。你自己的项目里直接写也没问题。
- `CODE_RE = re.compile(FENCE + r"python` 从回复里抠出第一个 python 代码块。`.*?` 非贪婪,`re.S` 让 `.` 能匹配换行。
- `2. 数据的筛选、排序、求和都在代码里做,只 print` 这条规则很关键。下面 smolagents 那一节你会看到,没有这句话时模型第一步就把 116 条订单全打印出来,代码模式的省 token 优势直接没了。
- `for stub, fn in zip(tool_stubs(registry).split("\n\n"), registry.funcs.values()):` 复用桩代码的第一行当函数签名展示给模型,再配上工具原来的 docstring。实测生成的 API 说明是 `def list_orders(status='all')` 加一行文档、`def get_city_manager(city)` 加一行文档,一共不到 100 个字。
- `self.messages: list[Any] =` 和 Day 9 一样标成 `list[Any]`,否则把 `r.message`(一个 dict)追加进去时编辑器会画红线。
- `r = self.llm.chat(self.messages)` 注意没有传 `tools=`。对模型来说这只是普通对话,工具全在 system prompt 里以函数文档的形式出现,所以任何能写代码的模型都能用这个循环,不要求支持 function calling。
- `self.messages.append(r.message)` `r.message` 是 SDK 返回消息的原样 dict,开了思考模式时里面带着 `reasoning_content`,原样追加不会丢。
- `if not m:  # 没写代码 = 最终回答` 结束条件。缺点是模型如果在最终回答里顺手贴了一段示例代码,会被当成要执行的动作。smolagents 的做法是要求模型调用 `final_answer()` 函数来结束,更严格。
- `feedback = f"代码执行结果(退出码 {res.returncode}):\n` 把执行结果当作一条 user 消息发回去。报错也一起发,模型看到 `TypeError` 会自己改代码。
- `return f"已达到最大步数 {self.max_steps}。"` Day 12 的预算思路同样适用:代码模式也可能陷入「改代码、报错、再改」的循环。

</div>

## 实测:同一道题,两种做法

下面这个脚本用同一个模型、同一道题,先走 JSON 工具调用,再走代码调用,最后打印两边的 token 和花费。JSON 那一边没有用 Day 9 的 `Agent` 类,因为它不传 `extra_body`,DeepSeek 会默认打开思考模式,两边比起来就不公平了,所以这里用 `LLMClient` 写了个十几行的等价循环。

```python
# agent-60-lab/topics/code_as_action/compare.py
import json
from typing import Any

from common.llm import LLMClient
from topics.code_as_action.code_agent import FENCE, CodeAgent
from topics.code_as_action.tools import ground_truth, reg

TASK = "找出退款总金额最高的三个城市,给出每个城市的退款总额(保留两位小数)和区域负责人。"


def json_mode(llm: LLMClient, max_steps: int = 8) -> tuple[str, int]:
    """Day 9 那种做法:每次一个(或几个)JSON 工具调用,结果全部回到上下文。"""
    messages: list[Any] = [
        {"role": "system", "content": "你是一个仔细的数据助手,需要数据时调用工具。"},
        {"role": "user", "content": TASK},
    ]
    calls = 0
    for _ in range(max_steps):
        r = llm.chat(messages, tools=reg.schemas)
        messages.append(r.message)
        tool_calls = r.message.get("tool_calls") or []
        if not tool_calls:
            return r.content, calls
        for tc in tool_calls:
            calls += 1
            out = reg.call(tc["function"]["name"], tc["function"]["arguments"])
            messages.append({"role": "tool", "tool_call_id": tc["id"], "content": out})
    return "(撞到步数上限)", calls


if __name__ == "__main__":
    print("标准答案:", ground_truth())

    a = LLMClient()
    answer, calls = json_mode(a)
    print("\n== JSON 工具调用 ==\n", answer)
    print(f"工具调用 {calls} 次 | {a.ledger}")

    b = LLMClient()
    agent = CodeAgent(reg, b)
    answer = agent.run(TASK)
    print("\n== 写代码调用 ==\n", answer)
    print(f"工具调用 {agent.tool_calls} 次 | {b.ledger}")
    print("\n模型写的代码:")
    for m in agent.messages:
        if m.get("role") == "assistant" and FENCE + "python" in (m.get("content") or ""):
            print(m["content"])
    json.dump(agent.messages, open("code_agent_trace.json", "w"), ensure_ascii=False, indent=1)
```

<div class="line-notes">

- `TASK = "找出退款总金额最高的三个城市,` 这道题同时需要「拿大量数据」「按城市汇总排序」「对前三名各查一次」,正好踩中 JSON 协议的两个弱点。
- `r = llm.chat(messages, tools=reg.schemas)` 带 `tools=` 就是 Day 8 的原生工具调用。`LLMClient.chat` 把剩下的关键字参数原样传给 SDK。
- `tool_calls = r.message.get("tool_calls") or []` `r.message` 是 dict,所以用 `["function"]["name"]` 取字段,而不是 Day 9 那样的属性访问。
- `messages.append({"role": "tool", "tool_call_id": tc["id"], "content": out})` 每个工具结果都进上下文。第一个 `list_orders("refunded")` 的结果就是前面量过的 8212 个字符。
- `a = LLMClient()` 两种做法各用一个新的客户端,`ledger` 各自记账,互不干扰。
- `json.dump(agent.messages, open("code_agent_trace.json", "w")` 把代码模式的完整对话存下来,方便你看模型每一步写了什么、收到了什么。

</div>

运行 `uv run python -m topics.code_as_action.compare`。我 2026 年 10 月用 deepseek-flash(思考关闭,课程默认的 `.env`)连跑了三次,结果整理在下面。标准答案是上海 10731.38(陈静)、广州 8613.37(李娜)、成都 8137.58(赵敏)。

| 第几次 | 做法 | 模型调用 | 工具调用 | 输入 token | 输出 token | 花费 | 三个金额全对? |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | JSON | 3 | 4 | 8,996 | 845 | ¥0.0152 | 否(上海写成 9922.37) |
| 1 | 代码 | 2 | 4 | 555 | 245 | ¥0.0028 | 是 |
| 2 | JSON | 3 | 4 | 10,257 | 2,179 | ¥0.0254 | 是 |
| 2 | 代码 | 3 | 5 | 885 | 292 | ¥0.0036 | 是 |
| 3 | JSON | 3 | 4 | 8,415 | 498 | ¥0.0120 | 否(上海写成 11486.29) |
| 3 | 代码 | 2 | 4 | 546 | 243 | ¥0.0028 | 是 |

几个值得停下来看的地方。

**城市排名三次都对,金额两次错**。模型能看出哪几个城市退款多,但逐条相加 116 个两位小数,它就开始编了。第一次上海少了 800 多,第三次多了 700 多,两次都写得有零有整,不对照标准答案根本看不出来。第二次算对的那次,输出 token 是另外两次的三到四倍,模型在回答里一笔一笔地列了加法过程,相当于自己做了一次「思维链」,对了,但贵。

**代码模式的输入 token 少了大约 15 倍**。原因就是那张图:116 条订单从来没有进过模型的上下文。第一次代码模式里模型写的代码长这样:

```python
from collections import defaultdict

refunds = list_orders(status='refunded')
city_total = defaultdict(float)
for o in refunds:
    city_total[o['city']] += o['amount']

top3 = sorted(city_total.items(), key=lambda x: x[1], reverse=True)[:3]
for city, total in top3:
    mgr = get_city_manager(city)
    print(city, round(total, 2), mgr)
```

<div class="line-notes">

- `refunds = list_orders(status='refunded')` 看起来是普通函数调用,实际是桩函数,走桥回到主进程执行。返回的 116 条订单只存在于子进程的内存里。
- `city_total[o['city']] += o['amount']` 求和交给 Python 浮点运算,不再靠模型心算。
- `mgr = get_city_manager(city)` 在循环里调工具。JSON 协议里这需要模型在下一回合发三个调用,这里一段代码里就完成了,所以 4 次工具调用只用了 1 次代码执行。
- `print(city, round(total, 2), mgr)` 唯一回到模型的东西。实测是三行:`上海 10731.38 {'city': '上海', 'manager': '陈静'}`、`广州 8613.37 {...李娜}`、`成都 8137.58 {...赵敏}`。

</div>

**代码模式第二次多了一轮**。那次模型第一段代码先只 print 了各城市合计,看完再写第二段查负责人,所以模型调用 3 次、工具调用 5 次(多查了一个城市)。代码模式不是保证一步到位,只是每一步的信息密度高得多。

这个实验的数据量很小。数据从 116 条变成 1 万条,JSON 那边要么撑爆上下文、要么被截断后答错,代码这边的 token 基本不变。这就是 Cloudflare 那篇文章里「两百万 token 变一千」的来由。

## 换成 smolagents 看看

我们手写的执行器大概一百行。smolagents 把这些都做好了,还多了几样:`final_answer()` 结束机制、步骤日志、自己的安全解释器。用 `uv run --with smolagents` 临时装上跑一下,不用加进项目依赖。

```python
# agent-60-lab/topics/code_as_action/smol_demo.py
import os

from dotenv import load_dotenv
from smolagents import CodeAgent, OpenAIServerModel, tool

from topics.code_as_action.tools import get_city_manager as _manager
from topics.code_as_action.tools import list_orders as _list

load_dotenv()


@tool
def list_orders(status: str = "all") -> list:
    """按状态列出订单。每条订单有 id、city、amount(元)、status。

    Args:
        status: 订单状态,paid / refunded / all 三选一
    """
    return _list(status)  # type: ignore[arg-type]


@tool
def get_city_manager(city: str) -> dict:
    """查某个城市的区域负责人。

    Args:
        city: 城市名,例如 '杭州'
    """
    return _manager(city)


model = OpenAIServerModel(
    model_id=os.environ["LLM_MODEL"],
    api_base=os.environ["LLM_BASE_URL"],
    api_key=os.environ["LLM_API_KEY"],
    extra_body={"thinking": {"type": "disabled"}},
)
agent = CodeAgent(tools=[list_orders, get_city_manager], model=model, max_steps=6)
print(agent.run("找出退款总金额最高的三个城市,给出每个城市的退款总额(保留两位小数)和区域负责人。"))
```

<div class="line-notes">

- `from smolagents import CodeAgent, OpenAIServerModel, tool` 实测版本 1.26.0。`OpenAIServerModel` 是 smolagents 里对接任何 OpenAI 兼容接口的模型类,DeepSeek 直接能用。
- `@tool` smolagents 自己的工具装饰器。它要求 docstring 里有 `Args:` 一节,逐个写参数说明,少写一个参数它在定义时就报错。这和 Day 9 我们用 `Annotated` 写说明是两种风格,干的是一件事。
- `return _list(status)  # type: ignore[arg-type]` 底层还是同一份数据,所以两边结果可以直接比。这里 `status` 标成了 `str`,传给要求 `Literal` 的原函数会被类型检查器画线,加个 ignore。
- `extra_body={"thinking": {"type": "disabled"}},` 和课程 `.env` 保持一致,关掉思考模式。`OpenAIServerModel` 会把多余的关键字参数传给底层的 `chat.completions.create`。
- `agent = CodeAgent(tools=[list_orders, get_city_manager], model=model, max_steps=6)` 没写 `executor_type`,用的是默认的 `LocalPythonExecutor`,代码在当前进程里被它的解释器执行。

</div>

运行 `uv run --with smolagents python -m topics.code_as_action.smol_demo`。实测三个金额全对,但它走了 4 步,最后一步累计输入 20,308 token,比我们手写版多了 30 多倍。翻日志看原因:第 1 步模型写的代码是 `refunded_orders = list_orders(status="refunded")` 加 `print(refunded_orders)`,把 116 条订单全打印出来了,于是数据又回到了上下文。另外 smolagents 的 system prompt 本身就有两千多 token(第 1 步输入 2,112),每一步都要重发。

这不是说 smolagents 不好,它的提示词是为通用场景写的,要照顾各种模型。教训是:**代码模式的收益取决于模型愿不愿意「少打印」**,这需要在提示词里明确要求,也值得在评测里专门盯一个指标:每步执行输出的长度。

## 沙箱:隔离进程不是安全边界

到这里你可能已经想到了:我们让模型写的代码在自己电脑上跑。模型写错了会怎样?被注入了会怎样?

我在执行器里做了几层限制:独立进程、`-I` 隔离模式、临时工作目录、只给两个环境变量、5 秒 CPU、20 秒墙钟、输出截断。我拿几段「坏代码」测了一下,结果是这样的(练习 3 会让你自己跑):

| 测试 | 结果 |
| --- | --- |
| 打印所有环境变量 | 只看到 `LC_CTYPE`、`PATH`、`PYTHONIOENCODING`、`__CF_USER_TEXT_ENCODING`,API key 不在 |
| 读家目录下的 `~/.zshrc` | **读到了** |
| 访问 https://example.com | **返回 200,能联网** |
| 调一个不存在的 `refund_order` | `NameError`,退出码 1 |
| `list_orders(state=...)` 参数写错 | `TypeError`,退出码 1 |

后两条是我们想要的:错误被关在子进程里,变成模型能看懂的反馈。前三条说明问题:子进程拥有和你一样的文件权限和网络权限。Day 39 讲过 Simon Willison 的「致命三要素」:私有数据、不可信内容、对外发送能力,三样凑齐就能被偷数据。一个能读文件、能联网的代码执行环境,只要模型被一段恶意网页或工单注入,三样就齐了。

所以生产环境里代码一定要跑在真正的沙箱里。按隔离强度和运维成本,2026 年常见的几种选择:

- **本地 Docker 容器**。最容易起步:`--network none` 断网、`--read-only` 只读根文件系统、`--memory` 和 `--pids-limit` 限资源、用非 root 用户跑。缺点是容器和宿主共享内核,内核漏洞能逃逸;每次起容器有几百毫秒开销。smolagents 文档里给了一个完整的 Docker 执行器示例,参数就是上面这些。
- **托管沙箱服务**。E2B 用 Firecracker 微虚拟机,每个沙箱有自己的内核;Modal 的 Sandbox 基于 gVisor;Daytona 也提供类似的开发环境沙箱。它们都有 Python SDK(2026 年 10 月查到 PyPI 上 e2b-code-interpreter 2.11.2、modal 1.6.2、daytona 0.225.0,都是 10 月发的新版),按秒计费,冷启动在亚秒到一两秒之间,价格和启动时间各家都在变,用之前去官网看最新的。
- **V8 isolate**。Cloudflare Code Mode 的路子,只跑 JavaScript/TypeScript,启动极快、天然没有文件系统,但不能跑任意 Python 库。
- **厂商托管的代码执行**。Anthropic 的代码执行工具和 PTC,容器在 Anthropic 那边,你不用管沙箱,代价是只能用 Claude,而且这个容器里的数据不在零数据保留(ZDR)范围内,官方文档的功能说明里写着 `zdr: not-eligible`,做合规敏感业务时要注意。

不管选哪种,工具桥这个结构都值得保留:**沙箱里只放代码,不放凭据**。工具调用回到你的主进程执行,权限检查、审计日志、人工审批(Day 40 讲的那些)都还在原来的位置。这一点比沙箱本身的隔离强度更重要。

## 什么时候不该用

代码模式不是 JSON 工具调用的替代品,是另一种工具。我的判断标准:

- **只调一两个工具、结果很短**:用 JSON。代码模式要多写一段代码、多一次执行,还多了一个沙箱要维护,不划算。Day 14 那个查天气的命令行 Agent 就没必要改。
- **工具结果大、需要过滤汇总,或者一个任务要调很多次工具**:代码模式的收益最大。数据分析、批量处理、在几百个 MCP 工具里挑着用,都属于这类。
- **有写操作、要人工审批的工具**(退款、发邮件):不要让它们出现在代码里能随便调的函数列表中。代码里一个循环就能发一百封邮件。要么只开放只读工具给代码用,要么在工具桥那一层对写操作强制走审批,PTC 的 `allowed_callers` 就是为这种区分准备的。
- **对延迟很敏感的对话场景**:多一次沙箱启动和代码执行,可能多几百毫秒到几秒。Anthropic 的数据是 token 少了,但端到端延迟不一定少,要实测。

最后一点和 Day 13 的思路一致:如果你已经知道要怎么算(比如「退款最多的三个城市」是一个固定报表),直接写一个 `top_refund_cities()` 工具最稳。代码模式适合的是**路径事先不知道**、需要模型临场组合工具的任务。

## 动手练习

### 练习 1:跑通并填表

1. 在仓库根目录建 `topics/__init__.py`、`topics/code_as_action/__init__.py`(空文件),把上面 `tools.py`、`sandbox.py`、`code_agent.py`、`compare.py` 四个文件放进去。
2. 依次运行 `uv run python -m topics.code_as_action.tools`、`uv run python -m topics.code_as_action.sandbox`,对照 line-notes 里的实测输出。
3. 运行 `uv run python -m topics.code_as_action.compare` 三次,按上面的表格格式记下你的结果。

验收:代码模式三次金额全对;你能说出 JSON 模式错了几次、输入 token 大概差多少倍。模型和日期不同,你的数字会和我的不一样,方向应该一致。

### 练习 2:看模型怎么从报错里恢复

把 `code_agent.py` 的 SYSTEM 里 `{api}` 前面加一句「注意:list_orders 的参数名是 state」(故意给错的文档),再跑 compare。打开生成的 `code_agent_trace.json`,找到模型收到 `TypeError: list_orders() got an unexpected keyword argument 'state'` 之后的那一步,看它怎么改。

验收:trace 里能看到至少一次退出码 1 的执行结果,以及模型随后改成了正确的参数名(或者改成不传参数再自己筛选)。想一想:如果你的工具文档本身就是错的,模型能救多少?

### 练习 3:证明子进程不是沙箱

新建下面这个脚本并运行 `uv run python -m topics.code_as_action.escape_test`:

```python
# agent-60-lab/topics/code_as_action/escape_test.py
from topics.code_as_action.sandbox import run_code
from topics.code_as_action.tools import reg

tests = {
    "读环境变量": "import os; print(sorted(os.environ))",
    "读家目录文件": "from pathlib import Path; print(len(Path('~/.zshrc').expanduser().read_text()) > 0)",
    "联网": "import urllib.request; print(urllib.request.urlopen('https://example.com', timeout=5).status)",
    "调不存在的工具": "print(refund_order('O0001'))",
    "参数写错": "print(list_orders(state='refunded'))",
}
for name, code in tests.items():
    r = run_code(code, reg)
    print(f"{name}: 退出码 {r.returncode} | 输出 {r.stdout.strip()[:80]!r} | 报错末行 {r.stderr.strip().splitlines()[-1] if r.stderr.strip() else ''!r}")
```

<div class="line-notes">

- `"读家目录文件": "from pathlib import Path;` 只打印「读没读到」,不打印内容,免得把你的配置文件显示在终端里。用 bash 的同学没有 `.zshrc`,改成 `.bashrc` 或者任何一个家目录下存在的文件。实测在我的 Mac 上输出 `True`。
- `"联网": "import urllib.request;` 实测输出 `200`。子进程能访问任何网址,也就能把读到的东西发出去。
- `"调不存在的工具": "print(refund_order('O0001'))",` 实测退出码 1,报错末行 `NameError: name 'refund_order' is not defined`。不存在的工具连桩都没有,根本到不了主进程。
- `"参数写错": "print(list_orders(state='refunded'))",` 实测退出码 1,报错末行 `TypeError: list_orders() got an unexpected keyword argument 'state'`。参数错误在桩函数这一层就被 Python 拦下了,主进程的 `registry.call` 没被调用。
- `r.stderr.strip().splitlines()[-1] if r.stderr.strip() else ''` 只取报错的最后一行,也就是异常类型和信息那一行,前面的 traceback 省掉。

</div>

验收:前两项「读家目录文件」和「联网」成功,说明需要真沙箱。然后二选一:装了 Docker 的,把 `run_code` 里的启动命令换成 `["docker", "run", "-i", "--rm", "--network", "none", "--memory", "256m", "--pids-limit", "64", "--read-only", "python:3.12-slim", "python", "-I", "-c", program]` 并去掉 `preexec_fn`,重跑这个脚本,确认这两项失败(我这台机器没装 Docker,这一步没有实跑);没有 Docker 的,注册一个 E2B 免费账号,读它的 Python SDK 文档,写出用 `Sandbox().run_code()` 执行同样代码的版本,并说明工具桥要怎么改(提示:E2B 的代码不在你的机器上,stdin/stdout 桥要换成别的通道,比如在沙箱里起一个小 HTTP 服务回调,或者干脆像 smolagents 那样只让纯计算的代码进沙箱)。

### 练习 4:对比 smolagents

运行上面的 `smol_demo.py`,数一下它走了几步、第几步把数据全打印出来了。然后给 `CodeAgent` 加上 `instructions="只 print 你需要看的结果,不要打印整份数据。"`(`instructions` 是 smolagents 1.26 里 `MultiStepAgent` 的参数,`CodeAgent` 继承了它,会把这段话追加进 system prompt),再跑一次。

验收:记录加提示前后的累计输入 token 和步数,写一句话结论。我实测加了这一句以后步数还是 4,但最后一步的累计输入从 20,308 降到 9,832,剩下的大头是 smolagents 自己的提示词。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| CodeAct | 2024 年的论文提出的做法:Agent 的动作用可执行的 Python 代码表达,而不是 JSON 工具调用 |
| Code Mode | Cloudflare 的叫法:把 MCP 工具变成 TypeScript API,让模型写代码调用,在 V8 isolate 里执行 |
| 程序化工具调用(PTC) | Anthropic 的功能:Claude 在代码执行容器里写 Python,代码里调用你定义的工具,中间结果不进上下文 |
| `allowed_callers` | PTC 里工具定义的字段,写 `["code_execution_20260120"]` 表示这个工具只建议从代码里调用。只是引导,不是安全限制 |
| 工具桥 | 本课的叫法:沙箱里的工具函数只是桩,调用请求转发回有权限的主进程执行 |
| 桩函数(stub) | 和真函数同名同参数、但函数体只负责转发调用的假函数 |
| 沙箱 | 执行不可信代码的隔离环境,限制它能访问的文件、网络、进程和资源 |
| Firecracker | AWS 开源的轻量虚拟机技术,E2B 用它做沙箱,每个沙箱有独立内核 |
| gVisor | Google 开源的用户态内核,拦截容器的系统调用,比普通容器隔离更强 |
| V8 isolate | V8 JavaScript 引擎里的独立执行上下文,启动快、开销小,Cloudflare Workers 用它隔离租户 |
| SIGXCPU | 进程超过 CPU 时间限制时操作系统发出的信号,编号 24 |
| `LocalPythonExecutor` | smolagents 自带的 Python 解释器,逐个执行语法树节点,默认禁止导入、限制循环次数 |

## 常见误区

**以为代码模式一定更省 token。** 它省的是「工具结果进上下文」的那部分。如果模型第一步就把整份数据 print 出来,省下来的又全花回去了,smolagents 的实测就是这样。提示词要明确要求只打印需要的东西,评测里要盯每步输出长度。

**把子进程当沙箱。** 我们的执行器挡住了 API key、限制了 CPU 和时间,但代码照样能读你的文件、照样能联网。本地学习可以,上线必须换成 Docker 或托管沙箱。

**把凭据放进沙箱。** 很多教程为了省事,把 API key、数据库密码作为环境变量传进沙箱,让代码直接连数据库。这样沙箱一旦被注入,凭据就泄露了。工具桥的意义就是凭据留在外面。

**让写操作工具也能在代码里随便调。** 一个 `for` 循环就能把 `refund_order` 调一百次。写操作要么不暴露给代码,要么在桥这一层强制审批和限流。

**看到 CodeAct 论文的数字就全盘迁移。** 论文的提升是在他们的基准上测的。你的任务如果是「查一下天气」这种一两步的,JSON 工具调用更简单、更快、更好调试。先用 Day 29 以后的评测方法在自己的任务上量,再决定。

**以为 `allowed_callers` 能防止模型直接调工具。** Anthropic 文档原话的意思是:它控制工具怎么呈现给模型,模型会被强烈引导去遵守,但不是 API 层面的硬性拦截,不能当安全边界。

## 学习资料

### 文档与文章

- [Executable Code Actions Elicit Better LLM Agents(CodeAct 论文)](https://arxiv.org/abs/2402.01030):读摘要、第 2 节的动机图和实验表,半小时。理解「为什么代码比 JSON 好」的原始论证。
- [Anthropic · Code execution with MCP](https://www.anthropic.com/engineering/code-execution-with-mcp):2025-11-04,讲把 MCP server 变成文件树、渐进式加载、隐私和状态持久化。**必读**,20 分钟。
- [Anthropic · Introducing advanced tool use](https://www.anthropic.com/engineering/advanced-tool-use):2025-11-24,程序化工具调用、工具搜索、工具使用示例三件事一起发布,看 PTC 那一节和数据。
- [Claude 文档 · Programmatic tool calling](https://platform.claude.com/docs/en/agents-and-tools/tool-use/programmatic-tool-calling):2026 年 10 月状态是 GA。看 quick start、`allowed_callers` 和 `caller` 字段两节。
- [Cloudflare · Code Mode: the better way to use MCP](https://blog.cloudflare.com/code-mode/):2025-09-26 的第一篇,讲为什么把工具变成 TypeScript API。
- [Cloudflare · Code Mode MCP server](https://blog.cloudflare.com/code-mode-mcp/):2026-02-20 的后续,两千五百个接口只用 `search` 和 `execute` 两个工具,看它的数字和沙箱设计。
- [smolagents · Secure code execution](https://huggingface.co/docs/smolagents/tutorials/secure_code_execution):本地执行器的限制、E2B/Modal/Docker 执行器、两种沙箱方式的对比,20 分钟。
- [Simon Willison · The lethal trifecta](https://simonwillison.net/2025/Jun/16/the-lethal-trifecta/):看完再回头想想我们的子进程为什么危险。
- [Python 文档 · resource 模块](https://docs.python.org/3/library/resource.html):`setrlimit` 能限制哪些资源,哪些在 macOS 上不生效。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1x266YNEm8&autoplay=0&high_quality=1" title="3 行代码实现 AI Agent | smolagents 深度解析:Hugging Face 最新 Agent 构建库" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>kate人不错 · 3 行代码实现 AI Agent | smolagents 深度解析:Hugging Face 最新 Agent 构建库 · 20 分钟,看 CodeAgent 和 ToolCallingAgent 的区别、代码动作长什么样。版本比今天用的旧,API 细节以官方文档为准。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1pm7mzqESD&autoplay=0&high_quality=1" title="怎么快速搭建效果好的agent?smolagents框架分享" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>良睦路程序员 · 怎么快速搭建效果好的agent?smolagents框架分享 smolagents二次开发 · 29 分钟,讲作者在 smolagents 上二次开发的经验,适合想继续深挖这个框架的同学,挑感兴趣的段落看。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/dSGS6-iGhyo" title="Building Agents with Smolagents" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Hugging Face · Building Agents with Smolagents · Hugging Face 官方频道的讲解,看 code agent 的设计理由和沙箱选项那几段。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/n5K2fjlT0FQ" title="CodeAct: Code As Action Space of LLM Agents - Pros and Cons" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>John Tan Chong Min · CodeAct: Code As Action Space of LLM Agents - Pros and Cons · 逐节读论文并讨论代码动作的缺点,和今天「什么时候不该用」那一节对照看。</figcaption>
</figure>

Hugging Face Agents Course 第二单元的 [Code Agents 一节](https://huggingface.co/learn/agents-course/unit2/smolagents/code_agents)是图文加 notebook,可以当视频的补充,一小时。

### 书籍

- Chip Huyen《AI Engineering》(O'Reilly, 2025),第 6 章「RAG and Agents」里讲工具和规划的部分,看她怎么讨论动作空间和代码执行的风险。
- 今天这组书籍不是重点,这个方向的一手资料主要在上面的文章和文档里。

### 开源项目与代码

- [huggingface/smolagents](https://github.com/huggingface/smolagents):看 `src/smolagents/local_python_executor.py`,这就是那个逐节点解释执行的安全解释器,一小时能看懂主干。
- [xingyaoww/code-act](https://github.com/xingyaoww/code-act):CodeAct 论文的官方仓库,有数据集和评测脚本。
- [E2B 文档](https://e2b.dev/docs) 和 [Modal Sandbox 文档](https://modal.com/docs/guide/sandbox):做练习 3 时选一个看快速开始。

## 自测

1. JSON 工具调用在「先查列表,再对前三个各查详情,再汇总」这类任务上有哪两个瓶颈?

<details><summary>答案</summary>

一是每个工具的完整结果都要进模型上下文,列表一大就是几千上万 token,而且每个回合都要重发;二是「先拿到列表才知道查谁」这种依赖只能拆成多个回合,汇总、排序只能靠模型心算,容易算错。

</details>

2. 我们的执行器里,工具真正是在哪个进程执行的?为什么要这样设计?

<details><summary>答案</summary>

在主进程。子进程里的同名函数只是桩,把请求通过 stdout 发回主进程,主进程用 `ToolRegistry.call` 执行后把结果写回子进程的 stdin。这样凭据(API key、数据库连接)和权限检查、审计、审批都留在主进程,代码执行环境里只有代码,沙箱被攻破也拿不到凭据。

</details>

3. 实测里 JSON 模式有一次金额算对了,它和另外两次有什么不同?这说明了什么?

<details><summary>答案</summary>

算对的那次输出 token 是另外两次的三到四倍,模型在回答里逐笔列了加法过程。说明让模型把计算过程写出来能提高准确率,但代价是更多输出 token,而且仍然不可靠。真正可靠又便宜的办法是让代码去算。

</details>

4. `while True: pass` 在我们的执行器里退出码是 -24,这是怎么来的?如果模型写的是 `time.sleep(100)`,哪一层限制会生效?

<details><summary>答案</summary>

`_limits` 用 `setrlimit(RLIMIT_CPU, (5, 5))` 限制子进程最多 5 秒 CPU,死循环吃满 CPU,5 秒后操作系统发 SIGXCPU(24 号信号)杀掉它,`returncode` 为负的信号编号。`sleep` 不占 CPU,CPU 限制管不住,要靠 20 秒的 `threading.Timer` 墙钟超时调用 `proc.kill`,这时 `timed_out` 为 True。

</details>

5. (面试题)你的客服 Agent 有 40 个 MCP 工具,其中 5 个是写操作(退款、改订单、发邮件)。团队想上代码执行模式降成本,你会怎么设计?

<details><summary>答案</summary>

要点:①只把只读工具暴露给代码执行环境,写操作保留为普通的 JSON 工具调用,或者在工具桥上对写操作强制走审批和限流(PTC 里可以用 `allowed_callers` 区分,但它不是安全边界,桥上还要校验);②代码跑在真沙箱里(托管沙箱或加固的容器,断网或只允许白名单出站),沙箱里不放任何凭据;③提示词要求只打印需要的结果,输出截断;④评测对比改造前后的成功率、token、端到端延迟,以及每步输出长度;⑤审计日志记录每段代码和它触发的每次工具调用,方便事故复盘。

</details>

6. smolagents 的实测为什么累计输入 token 反而比 JSON 模式还多?

<details><summary>答案</summary>

两个原因:第 1 步模型把 116 条订单全部 print 出来,数据又回到了上下文;smolagents 的 system prompt 本身两千多 token,4 步每步都要重发。代码模式的收益取决于模型是否只打印需要的东西,以及框架提示词的长度。

</details>

## 明天预告

专题篇可以跳着读,按顺序的下一篇是 **Day 133 · 工具多了怎么办:Tool Search、延迟加载与工具检索**。今天解决的是「工具结果太大」,明天解决「工具定义太多」:接了十个 MCP server、两百个工具以后,光工具列表就占掉几万 token,模型还经常选错。我们会自己实现一个按需检索工具的机制,再看 Anthropic 的 Tool Search 是怎么做的。
