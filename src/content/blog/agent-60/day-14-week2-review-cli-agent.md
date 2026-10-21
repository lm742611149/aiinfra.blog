---
title: 'Day 14 · W2 复习 + 小项目:能查天气、算数、读文件、搜网页的命令行 Agent'
description: 'W2 收尾。一张图串起函数调用、Agent 循环、ReAct 与规划、工具设计、失败处理、workflow 五块内容;然后把它们组装成一个能放进 GitHub 的命令行 Agent:五个精心设计的工具、带防线的循环、多轮对话和花费统计。最后是 W2 面试题汇总和踩坑清单。'
pubDate: 2026-10-12
regime: none
tags: ['review', 'project', 'cli-agent', 'interview', 'agent-60']
series: 'agent-60'
day: 14
lang: 'zh'
---

## 今天要解决的问题

W2 是整门课最核心的一周。这七天你从「模型只会聊天」走到了「模型会自己调工具、自己决定下一步、出错了能自救」。后面五周学的 RAG、MCP、LangGraph、评测、部署,全都是在这周写的那个循环上加东西。所以复习日不要跳。

今天做三件事:

1. 用一张图把 W2 的六块内容串起来,能对着图讲清楚每一块解决什么问题。
2. 完成本周小项目:一个命令行 Agent,五个工具(天气、计算、列文件、读文件、搜网页),多轮对话,花费统计,撞线转人工提示。代码整理好推到 GitHub,这是你作品集里的第一个项目。
3. 过一遍 W2 面试题汇总和踩坑清单,把答不上来的题标出来回去补。

预计用时 5–7 小时,大部分时间花在项目上。前置是 Day 9 的 `agent_loop.py` 和 Day 12 的 `robust_agent.py`,今天直接复用。

## W2 一页知识地图

<figure>
<svg viewBox="0 0 640 400" role="img" aria-label="W2 知识地图:六块内容围绕 Agent 循环">
  <rect x="0" y="0" width="640" height="400" fill="var(--paper-raised)" rx="6"/>
  <rect x="235" y="170" width="170" height="60" fill="var(--mem-wash)" stroke="var(--mem)" rx="6"/>
  <text x="320" y="196" text-anchor="middle" font-family="var(--font-mono)" font-size="13" fill="var(--mem)">Agent 循环</text>
  <text x="320" y="215" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--mem)">Day 9 · 心脏</text>
  <rect x="30" y="40" width="180" height="70" fill="none" stroke="var(--ink-soft)" rx="4"/>
  <text x="120" y="62" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">Day 8 函数调用</text>
  <text x="120" y="82" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">tools / tool_calls</text>
  <text x="120" y="98" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">tool 消息 · id 对应</text>
  <rect x="430" y="40" width="180" height="70" fill="none" stroke="var(--ink-soft)" rx="4"/>
  <text x="520" y="62" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">Day 10 ReAct 与规划</text>
  <text x="520" y="82" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">先想再做 · stop 序列</text>
  <text x="520" y="98" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">plan-execute · 待办清单</text>
  <rect x="30" y="290" width="180" height="70" fill="var(--compute-wash)" stroke="var(--compute)" rx="4"/>
  <text x="120" y="312" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--compute)">Day 11 工具设计</text>
  <text x="120" y="332" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">按任务设计 · 描述 3-4 句</text>
  <text x="120" y="348" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">返回精简 · 报错可纠正</text>
  <rect x="430" y="290" width="180" height="70" fill="var(--compute-wash)" stroke="var(--compute)" rx="4"/>
  <text x="520" y="312" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--compute)">Day 12 失败处理</text>
  <text x="520" y="332" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">重试 · 超时 · 截断 · 循环</text>
  <text x="520" y="348" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">预算 · 收尾转人工</text>
  <rect x="230" y="40" width="180" height="70" fill="none" stroke="var(--ink)" stroke-dasharray="5 4" rx="4"/>
  <text x="320" y="62" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">Day 13 Workflow</text>
  <text x="320" y="82" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">链 · 路由 · 并行</text>
  <text x="320" y="98" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">编排 · 评估优化</text>
  <line x1="120" y1="110" x2="250" y2="175" stroke="var(--rule)"/>
  <line x1="520" y1="110" x2="390" y2="175" stroke="var(--rule)"/>
  <line x1="320" y1="110" x2="320" y2="170" stroke="var(--rule)" stroke-dasharray="4 3"/>
  <line x1="120" y1="290" x2="250" y2="225" stroke="var(--rule)"/>
  <line x1="520" y1="290" x2="390" y2="225" stroke="var(--rule)"/>
  <text x="320" y="270" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">上:让循环更聪明 · 下:让循环更可靠</text>
  <text x="320" y="140" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">虚线:很多时候根本不需要循环</text>
</svg>
<figcaption>W2 的六块内容。函数调用是协议基础,循环是心脏;上面两块让它更聪明,下面两块让它更可靠;workflow 提醒你先问一句「真的需要 Agent 吗」。</figcaption>
</figure>

对着图,试着用自己的话把每一块讲一遍,每块不超过三句。讲不出来的就是没掌握的,回去重看那一天。我给一个参考版本:

函数调用(Day 8):模型不执行任何东西,它只输出「我想调哪个函数、参数是什么」的结构化数据,执行在你的程序里。回传结果时用 tool_call_id 对上号,一次工具调用其实是两次模型请求。

Agent 循环(Day 9):把一次往返折成 while 循环,模型不再请求工具就退出。工具注册表从函数签名生成 schema,执行出错不抛异常而是把错误交给模型自己纠正。

ReAct 与规划(Day 10):推理和行动交替,每一步基于真实的观察。原生工具调用和推理模型已经把这件事内化了;长任务用待办清单工具或 plan-and-execute 防止迷路。

工具设计(Day 11):工具是给模型用的,不是给程序员用的。按任务设计、描述写三四句、参数无歧义、返回值精简可分页、报错能指导纠正。

失败处理(Day 12):临时错误退避重试,工具加超时,结果截断,循环检测,步数、token、时间三种预算。撞线后禁用工具给部分答案,标记转人工。用假模型离线测试这些防线。

Workflow(Day 13):下一步由代码决定的是 workflow,由模型决定的是 agent。能用单次调用就不用 workflow,能用 workflow 就不用 agent。五种模式可以组合。

## 本周小项目:命令行 Agent

### 要做成什么样

一个在终端里运行的助手,你可以连续问它问题,它会按需调用五个工具:

- `weather_now`:查某个城市当前天气(Open-Meteo,免费无 key)
- `calculate`:安全地计算算式(AST 解析,不用 eval)
- `files_list` / `files_read`:列出和分段读取 workspace 目录里的文件,不能越界
- `web_search`:联网搜索(默认 DuckDuckGo,国内网络建议配 Tavily 的 key)

循环用 Day 12 的 `RobustAgent`,所以重试、超时、截断、循环检测、预算、撞线收尾都是现成的。新加的是命令行交互:多轮对话、`/reset` 清空、`/cost` 看花费、`/tools` 列工具、`/save` 保存对话,每轮回答后显示状态、步数、耗时和这一轮花了多少钱。

### 目录结构

这个项目要单独推到 GitHub,所以**不要建在 `agent-60-lab` 里面**,和它并排单独建一个目录 `cli-agent`。建在练习仓里面会变成「仓库里套仓库」,以后在练习仓 `git add` 会报 embedded repository 警告。

```text
cli-agent/                 # 和 agent-60-lab 并排
├── agent_loop.py      # Day 9,复制过来(用其中的 ToolRegistry)
├── robust_agent.py    # Day 12,复制过来,改一行 import
├── tools.py           # 今天写:五个工具
├── main.py            # 今天写:命令行交互
├── workspace/         # Agent 能读的文件放这里
├── runs/              # /save 保存的对话(不进 git)
├── .env.example       # 环境变量模板,不放真 key
└── README.md
```

```bash
cd ~/Documents            # 换成你 agent-60-lab 所在的目录
mkdir cli-agent && cd cli-agent
uv init --no-package --author-from none .
rm main.py                # uv 生成的 hello world,下面要换成自己的
uv add openai httpx tenacity ddgs python-dotenv
uv add --dev pytest
cp ../agent-60-lab/w2/agent_loop.py ../agent-60-lab/w2/robust_agent.py .
sed -i '' 's/^from w2\.agent_loop import/from agent_loop import/' robust_agent.py   # Linux 去掉 ''
cat > .env.example <<'ENV'
LLM_BASE_URL=https://api.deepseek.com
LLM_API_KEY=sk-你的key
LLM_MODEL=deepseek-flash
PRICE_IN=0.3
PRICE_OUT=1.2
# 国内网络搜索用 Tavily(https://www.tavily.com 免费每月 1000 次),不配则用 DuckDuckGo
TAVILY_API_KEY=
ENV
cp .env.example .env      # 然后打开 .env 填真 key
printf '.env\nruns/\n' >> .gitignore
```

这几行里有三个坑,都是实跑踩出来的:

- **`uv init` 一定要带 `--no-package`。** uv 0.13 起,默认的 `uv init` 会生成 `src/cli_agent/__init__.py` 的「包」结构,还在 pyproject 里加 `[build-system]`。我们的代码是几个平铺的 `.py` 文件,如果把 `src/` 删掉,下一次 `uv add` 会直接报错 `Expected a Python module at: src/cli_agent/__init__.py`。`--no-package` 生成的是普通应用结构:一个 pyproject、一个 `main.py`,没有构建配置。`--author-from none` 是不让 uv 把 git 全局邮箱写进 `authors`,很多人的全局邮箱是公司邮箱,不该出现在个人作品里。
- **`robust_agent.py` 要改一行 import。** 练习仓里它写的是 `from w2.agent_loop import ToolRegistry`(Day 12 为了能在根目录 `-m` 运行这么写的),复制到新目录后没有 `w2` 这个包了,`import` 会报 `ModuleNotFoundError: No module named 'w2'`。新目录里两个文件平级,改成 `from agent_loop import` 即可,上面的 `sed` 就是干这个的。
- **`pytest` 用 `--dev` 装。** 它只在开发时用,放进 `dependencies` 的话,别人装你的项目也会被迫装一个测试框架。

`.env.example` 进仓库,真正的 `.env` 不进。这一条请当成肌肉记忆:**任何时候都不要把 API key 提交到 git**。GitHub 上有大量机器人在扫描新提交里的 key,泄露后几分钟内就可能被盗刷。

<details>
<summary>这些机器人到底在扫什么?</summary>

扫的是全站公开仓库的**新提交**,目的是捡能直接用的密钥:

1. **盯实时提交流。** GitHub 有一个公开的事件接口,所有公开 push 几乎实时出现在里面。机器人不停拉取,每个新提交都把 diff 抓下来。
2. **按格式匹配。** 各家 key 前缀很固定:OpenAI/DeepSeek 是 `sk-`,AWS 是 `AKIA`,GitHub token 是 `ghp_`。再配合「高随机度长字符串」的判断,并重点看 `.env`、`config.py` 这类文件。
3. **验证有效性。** 拿到 key 就调一下厂商 API(查余额、列模型),能用就入库。
4. **使用或转卖。** 大模型 key 拿去盗刷 token,或者卖给做「低价 API 中转」的人;云厂商 key 拿去开机器挖矿。从 push 到被盗用,最快几分钟。

几个常见误会:

- **再提交一次把 key 删掉没用。** 它还在 git 历史里,而且多半在你删之前就被扫到了。唯一可靠的做法是**立刻去厂商后台作废这个 key**,换新的。
- **私有仓库也不保险。** 机器人扫不到私有仓库,但仓库哪天改成公开,或者被别人 clone、fork 走,历史里的 key 就跟着出去了。
- **也有「好机器人」。** GitHub 自带密钥扫描(Secret scanning),会通知合作厂商自动作废泄露的 key,有的还会在 push 时直接拦下。但不是每家厂商都参与,不能指望它兜底。

下面「推到 GitHub」一节里的 `git status` 和 `grep 'sk-...'` 两步,就是在 push 之前自己先当一回扫描机器人。想要更全的检查,可以用开源工具 [gitleaks](https://github.com/gitleaks/gitleaks) 扫整个仓库历史。

</details>`runs/` 也不进 git,里面是你的真实对话记录。`main.py` 第一件事就是用 Day 2 学的 `python-dotenv` 加载 `.env`。

### tools.py

```python
# cli-agent/tools.py
import ast
import operator as op
import os
from pathlib import Path
from typing import Annotated, Literal

import httpx

from agent_loop import ToolRegistry

reg = ToolRegistry()
WORKSPACE = Path(os.environ.get("AGENT_WORKSPACE", "workspace")).resolve()
WMO = {0: "晴", 1: "大致晴", 2: "多云", 3: "阴", 45: "雾", 48: "雾凇", 51: "毛毛雨", 61: "小雨", 63: "中雨",
       65: "大雨", 71: "小雪", 73: "中雪", 75: "大雪", 80: "阵雨", 95: "雷暴"}


@reg.tool
def weather_now(
    city: Annotated[str, "城市名,中文或英文。重名城市可以加省份或国家,例如 '苏州 江苏'、'Paris France'"],
    unit: Annotated[Literal["celsius", "fahrenheit"], "温度单位,默认摄氏"] = "celsius",
) -> dict:
    """查询一个城市当前的天气:气温、天气状况、风速。
    用户问天气、冷不冷、要不要带伞、适合穿什么时使用。只能查当前,不能查历史或未来几天。
    一次只查一个城市;要比较多个城市就并行调用多次。"""
    name = city.split()[0]
    geo = httpx.get("https://geocoding-api.open-meteo.com/v1/search",
                    params={"name": name, "count": 1, "language": "zh"}, timeout=10).json()
    if not geo.get("results"):
        return {"error": f"找不到城市 '{city}'。可以试试英文名(如 'Hangzhou')或者更常见的写法。"}
    p = geo["results"][0]
    cur = httpx.get("https://api.open-meteo.com/v1/forecast", timeout=10, params={
        "latitude": p["latitude"], "longitude": p["longitude"],
        "current": "temperature_2m,weather_code,wind_speed_10m", "temperature_unit": unit,
    }).json()["current"]
    return {"city": f"{p['name']}({p.get('admin1', '')})", "temperature": cur["temperature_2m"], "unit": unit,
            "weather": WMO.get(cur["weather_code"], f"代码{cur['weather_code']}"), "wind_kmh": cur["wind_speed_10m"]}


_OPS = {ast.Add: op.add, ast.Sub: op.sub, ast.Mult: op.mul, ast.Div: op.truediv,
        ast.Pow: op.pow, ast.USub: op.neg, ast.Mod: op.mod, ast.FloorDiv: op.floordiv}


@reg.tool
def calculate(expression: Annotated[str, "算式,只能包含数字、+ - * / // % ** 和括号,例如 '(21.5 + 18.2) / 2'"]) -> dict:
    """精确计算一个数学表达式。任何涉及数字运算的地方都用它,不要心算,哪怕看起来很简单。
    不支持变量、函数(如 sqrt)和单位;需要开方可以写成 '** 0.5'。"""
    def ev(n):
        if isinstance(n, ast.Constant) and isinstance(n.value, (int, float)):
            return n.value
        if isinstance(n, ast.BinOp) and type(n.op) in _OPS:
            if isinstance(n.op, ast.Pow) and ev(n.right) > 100:
                raise ValueError("指数太大")
            return _OPS[type(n.op)](ev(n.left), ev(n.right))
        if isinstance(n, ast.UnaryOp) and type(n.op) in _OPS:
            return _OPS[type(n.op)](ev(n.operand))
        raise ValueError("只支持数字和 + - * / // % ** 括号")
    try:
        v = ev(ast.parse(expression, mode="eval").body)
        return {"expression": expression, "result": round(v, 10) if isinstance(v, float) else v}
    except ZeroDivisionError:
        return {"error": "除数为 0"}
    except Exception as e:
        return {"error": f"无法计算 '{expression}':{e}"}


def _safe(path: str) -> Path | None:
    target = (WORKSPACE / path).resolve()
    return target if target.is_relative_to(WORKSPACE) else None


@reg.tool
def files_list(subdir: Annotated[str, "workspace 下的子目录,默认根目录 '.'"] = ".") -> dict:
    """列出 workspace 目录(或其子目录)里的文件和文件夹名。不知道文件叫什么时先用它,再用 files_read 读。"""
    d = _safe(subdir)
    if d is None or not d.is_dir():
        return {"error": f"'{subdir}' 不是 workspace 里的目录"}
    items = sorted(d.iterdir())[:100]
    return {"dir": subdir, "items": [p.name + ("/" if p.is_dir() else "") for p in items]}


@reg.tool
def files_read(
    path: Annotated[str, "workspace 里的相对路径,例如 'notes/todo.md'"],
    start_line: Annotated[int, "从第几行开始,默认 1"] = 1,
    max_lines: Annotated[int, "最多读几行,默认 80,最大 300"] = 80,
) -> dict:
    """读取 workspace 里一个文本文件的指定行范围,每行带行号。只能读 workspace 内的文件。
    文件很长时会分段返回,用 next_start_line 继续读。"""
    f = _safe(path)
    if f is None:
        return {"error": "只能读取 workspace 目录内的文件"}
    if not f.is_file():
        return {"error": f"文件 '{path}' 不存在。先用 files_list 看看有哪些文件。"}
    try:
        lines = f.read_text(encoding="utf-8").splitlines()
    except UnicodeDecodeError:
        return {"error": f"'{path}' 不是 UTF-8 文本文件,无法读取"}
    max_lines = max(1, min(max_lines, 300))
    start_line = max(1, start_line)  # 传 0 或负数一律当成从第 1 行读
    chunk = lines[start_line - 1:start_line - 1 + max_lines]
    out = {"path": path, "total_lines": len(lines),
           "lines": [f"{i}: {s}" for i, s in enumerate(chunk, start_line)]}
    if start_line - 1 + len(chunk) < len(lines):
        out["next_start_line"] = start_line + len(chunk)
    return out


@reg.tool
def web_search(
    query: Annotated[str, "搜索词,像在搜索引擎里输入的那样,简短具体"],
    max_results: Annotated[int, "返回几条,默认 5,最多 10"] = 5,
) -> dict:
    """在互联网上搜索,返回标题、链接和摘要。用于查最新信息、你不确定的事实、或者用户明确要求搜索时。
    结果只有摘要,不是全文;摘要不够时换更具体的搜索词再搜一次,不要重复搜同一个词。"""
    n = max(1, min(max_results, 10))
    try:
        if os.environ.get("TAVILY_API_KEY"):  # 国内网络推荐用 Tavily(免费每月 1000 次)
            r = httpx.post("https://api.tavily.com/search", timeout=20,
                           headers={"Authorization": f"Bearer {os.environ['TAVILY_API_KEY']}"},
                           json={"query": query, "max_results": n}).json()
            hits = [{"title": x["title"], "url": x["url"], "snippet": x["content"][:300]} for x in r.get("results", [])]
        else:  # 默认用 DuckDuckGo,不用 key,但国内直连通常访问不了
            from ddgs import DDGS
            hits = [{"title": x["title"], "url": x["href"], "snippet": x["body"][:300]}
                    for x in DDGS().text(query, max_results=n)]
    except Exception as e:
        return {"error": f"搜索服务暂时不可用({type(e).__name__})。可以稍后重试,或告诉用户无法联网搜索。"}
    return {"query": query, "results": hits} if hits else {"query": query, "results": [], "hint": "没有结果,换个说法试试"}
```

<div class="line-notes">

- `import ast` `ast` 是 Python 自带的语法树模块,`calculate` 用它把算式解析成一棵树再自己求值,而不是直接 `eval`。
- `import operator as op` `operator` 模块把 `+ - * /` 这些运算符做成了普通函数:`op.add(2, 3)` 等于 `2 + 3`。下面 `_OPS` 表就是用它把语法树节点类型映射到对应的函数。
- `from typing import Annotated, Literal` `Annotated[str, "说明"]` 给参数附带说明,`ToolRegistry` 会把这段说明读出来放进 schema 的 `description`;`Literal["celsius", "fahrenheit"]` 会变成 schema 里的 `enum`。
- `import httpx` 发 HTTP 请求的库,用法和 `requests` 几乎一样,天气和 Tavily 搜索都靠它。
- `from agent_loop import ToolRegistry` Day 9 写的工具注册表。下面每个 `@reg.tool` 都会把函数登记进去,并根据函数签名和 docstring 自动生成 JSON schema。
- `reg = ToolRegistry()` 全局只有一个注册表,`main.py` 里 `from tools import reg` 拿的就是它。实测 `reg.schemas` 里依次是 `weather_now`、`calculate`、`files_list`、`files_read`、`web_search` 五个工具。
- `WORKSPACE = Path(os.environ.get("AGENT_WORKSPACE"` 没设环境变量就用 `"workspace"`。`.resolve()` 把相对路径变成绝对路径,在项目目录里运行时得到 `.../cli-agent/workspace`。**这一行在 `import tools` 的那一刻就执行了**,所以 `main.py` 必须先 `load_dotenv()`,再导入这个文件。
- `WMO = {0: "晴"` Open-Meteo 返回的天气状况是 WMO 标准的数字代码,这张表把常见的代码翻成中文。实测杭州返回 `weather_code: 1`,查表得到「大致晴」。
- `@reg.tool` 装饰器:把下面的函数注册成工具。注册之后函数本身不变,你在测试里照样可以直接调用 `weather_now("杭州")`。
- `city: Annotated[str` 实测生成的 schema 是 `"city": {"type": "string", "description": "城市名,中文或英文。重名城市可以加省份或国家……"}`,没有默认值,所以出现在 `required` 里。
- `unit: Annotated[Literal["celsius", "fahrenheit"]` 生成 `"enum": ["celsius", "fahrenheit"]`,有默认值 `"celsius"`,所以不是 required。模型只能从这两个值里选,不会传 `"C"` 或者 `"摄氏"`。
- `"""查询一个城市当前的天气` docstring 会原样成为工具描述。第二句「只能查当前,不能查历史或未来几天」是写给模型看的边界,用户问明天下不下雨时,模型就知道不该调用这个工具。
- `name = city.split()[0]` 实测 `"杭州 浙江".split()` → `["杭州", "浙江"]`,取第一个得到 `"杭州"`。这么切的原因和毛病见代码块下面的正文。
- `geo = httpx.get("https://geocoding-api.open-meteo.com/v1/search"` 第一步先把城市名换成经纬度。`params` 会拼成 `?name=杭州&count=1&language=zh`;`count=1` 只要最匹配的一个;`.json()` 把响应解析成 dict。
- `if not geo.get("results"):` 查不到城市时,接口返回的 JSON 里根本没有 `results` 这个 key,所以用 `.get()`;直接写 `geo["results"]` 会抛 `KeyError`。实测 `weather_now("火星城")` 返回 `{"error": "找不到城市 '火星城'。可以试试英文名(如 'Hangzhou')或者更常见的写法。"}`。
- `p = geo["results"][0]` 实测杭州这一条是 `{"name": "杭州", "latitude": 30.29365, "longitude": 120.16142, "country": "中国", "admin1": "浙江"}`。`admin1` 是一级行政区,也就是省。
- `cur = httpx.get("https://api.open-meteo.com/v1/forecast"` 第二步用经纬度查实时天气。`current` 参数列出要哪几项,`temperature_unit` 直接让接口按摄氏或华氏返回。
- `}).json()["current"]` 只取 `current` 这一段。实测(2026-10-21 23:00):`{"time": "2026-10-21T23:00", "interval": 900, "temperature_2m": 14.1, "weather_code": 1, "wind_speed_10m": 6.0}`。
- `return {"city": f"{p['name']}({p.get('admin1', '')})"` 把城市名和省份拼起来,模型回答时能说清楚是哪个杭州。`admin1` 有可能缺失,所以用 `.get(..., '')`。
- `"weather": WMO.get(cur["weather_code"], f"代码{cur['weather_code']}")` 表里查不到的代码(比如 53)就返回 `"代码53"`,不会报错。最终实测 `weather_now("杭州")` → `{"city": "杭州(浙江)", "temperature": 14.1, "unit": "celsius", "weather": "大致晴", "wind_kmh": 6.0}`;`weather_now("Beijing", "fahrenheit")` → `{"city": "北京(北京市)", "temperature": 40.0, "unit": "fahrenheit", ...}`。
- `_OPS = {ast.Add: op.add` 白名单:只有这 8 种运算能执行。key 是语法树节点的**类型**,value 是对应的函数,比如 `ast.Add → op.add`、`ast.USub → op.neg`(负号)。
- `def calculate(expression: Annotated[str` 描述里把允许的符号列全,并给了一个例子 `'(21.5 + 18.2) / 2'`,模型照着格式写,出错的概率小很多。
- `"""精确计算一个数学表达式。` 「不要心算,哪怕看起来很简单」是在逼模型用工具,因为大模型算多位小数加法经常出错。实测「把 weekly.md 里的销售额加起来」时,模型调用了 `calculate("12800 + 9650.5 + 15320")`,得到 37770.5。
- `def ev(n):` 递归求值函数:给它一个语法树节点,返回这个节点的值。函数里面定义函数,`ev` 只在 `calculate` 内部使用。
- `if isinstance(n, ast.Constant) and isinstance(n.value, (int, float)):` 叶子节点:数字常量直接返回。字符串常量 `'abc'` 也是 `ast.Constant`,但不是 int/float,会落到最后的 raise。
- `if isinstance(n, ast.BinOp) and type(n.op) in _OPS:` 二元运算 `左 op 右`。用 `"(21.5 + 18.2) / 2"` 追踪一遍:解析出来是 `BinOp(left=BinOp(21.5 + 18.2), op=Div, right=2)`。外层先递归算 left,里面 `21.5 + 18.2 = 39.7`;再算 right 得到 `2`;最后 `op.truediv(39.7, 2) = 19.85`。
- `if isinstance(n.op, ast.Pow) and ev(n.right) > 100:` 乘方单独检查指数大小,`2**10000000` 这种会让进程卡很久。实测 `"2**10000"` 返回 `指数太大`。只拦正的大指数:负指数算出来是很小的小数,不会卡。实测 `"2**-200"` 正常返回 `{"result": 0.0}`(真实值约 6.2e-61,被下面的 `round(v, 10)` 舍成了 0.0);`"2**-3"` 返回 `0.125`。如果写成 `abs(...) > 100`,这些都会被误报成「指数太大」。
- `return _OPS[type(n.op)](ev(n.left), ev(n.right))` 先用节点类型查表得到函数,再把左右两边的值传进去,`_OPS[ast.Div]` 就是 `op.truediv`。
- `if isinstance(n, ast.UnaryOp) and type(n.op) in _OPS:` 一元运算,就是负号。实测 `"-3 + 7 % 4"`:先算 `-3`,再算 `7 % 4 = 3`,相加得 `0`。
- `raise ValueError("只支持数字和 + - * / // % ** 括号")` 其他节点一律拒绝:变量名、函数调用、属性访问都会走到这里。实测 `"__import__('os')"` 返回 `无法计算 '__import__('os')':只支持数字……`。如果用 `eval`,这一句就能执行任意代码。
- `v = ev(ast.parse(expression, mode="eval").body)` `mode="eval"` 表示按「单个表达式」解析,写赋值语句会直接报语法错误;`.body` 取出表达式本身的那个节点。
- `"result": round(v, 10) if isinstance(v, float) else v` 浮点数四舍五入到 10 位小数,把浮点误差抹掉。实测 `"0.1+0.2"` 得到 `0.3`,不加 `round` 就是 `0.30000000000000004`。整数原样返回,`"7//2"` 得 `3`。
- `except ZeroDivisionError:` 实测 `"1/0"` → `{"error": "除数为 0"}`。除零单独处理,是为了给模型一句它能直接转述给用户的话。
- `except Exception as e:` 兜底:语法错误、白名单外的节点、指数太大,都变成 `{"error": "无法计算 '...':原因"}`,工具永远不会把异常抛到 Agent 循环里。
- `def _safe(path: str) -> Path | None:` 文件工具的安全闸门,下划线开头表示内部函数,不注册成工具。
- `target = (WORKSPACE / path).resolve()` `/` 用来拼路径;`.resolve()` 会把 `..` 真正算掉。实测 `"notes/a.md"` → `.../workspace/notes/a.md`;`"../../etc/passwd"` 解析后跑到了 workspace 外面。
- `return target if target.is_relative_to(WORKSPACE) else None` 判断解析后的路径是不是还在 workspace 里面(Python 3.9+)。实测 `_safe("../../etc/passwd")` 返回 `None`。必须先 resolve 再判断,只检查字符串里有没有 `..` 是挡不住软链接的。
- `def files_list(subdir: Annotated[str` 默认 `"."`,即 workspace 根目录。
- `if d is None or not d.is_dir():` 越界和「不是目录」用同一句报错。实测 `files_list("../")` → `{"error": "'../' 不是 workspace 里的目录"}`。
- `items = sorted(d.iterdir())[:100]` 排序是为了每次结果一致;最多 100 个,防止目录很大时撑爆上下文。
- `return {"dir": subdir, "items": [p.name + ("/" if p.is_dir() else "")` 目录名后面加 `/`,模型一眼就能分清文件和文件夹。实测 → `{"dir": ".", "items": ["trip.txt", "weekly.md"]}`。
- `start_line: Annotated[int, "从第几行开始,默认 1"] = 1` 行号从 1 开始,和编辑器一致。
- `if not f.is_file():` 实测 `files_read("nope.md")` → `文件 'nope.md' 不存在。先用 files_list 看看有哪些文件。`,错误信息直接告诉模型下一步该做什么。
- `lines = f.read_text(encoding="utf-8").splitlines()` 读成按行切好的列表。实测 `weekly.md` 是 4 行:`["# 周报", "周一 销售额 12800", "周二 销售额 9650.5", "周三 销售额 15320"]`。
- `except UnicodeDecodeError:` 读到图片、Excel 这类二进制文件时 UTF-8 解码会失败,转成一句人话。
- `max_lines = max(1, min(max_lines, 300))` 把行数夹在 1 到 300 之间。实测传 `500` 被压成 300;传 `0` 被抬成 1,只返回 `["1: # 周报"]`。
- `start_line = max(1, start_line)` 起始行也夹住,最小是 1。模型偶尔会按「下标从 0 开始」的习惯传 `0`,不夹的话切片变成 `lines[-1:79]`,得到 `lines: []`,还会返回 `next_start_line: 0`,模型照着这个值接着读就会原地打转。实测加了这行以后传 `0`,返回的是 `["1: # 周报", ...]`,和传 1 一样。
- `chunk = lines[start_line - 1:start_line - 1 + max_lines]` 行号转下标要减 1。代入 `start_line=1, max_lines=3`:`lines[0:3]`,取前三行。
- `"lines": [f"{i}: {s}" for i, s in enumerate(chunk, start_line)]` `enumerate(chunk, start_line)` 让计数从 `start_line` 开始而不是 0,所以每行前面是真实行号。实测 → `["1: # 周报", "2: 周一 销售额 12800", "3: 周二 销售额 9650.5"]`。
- `if start_line - 1 + len(chunk) < len(lines):` 还没读完就告诉模型下一段从哪里开始。代入:`0 + 3 < 4` 为真,所以多返回一个 `"next_start_line": 4`。
- `n = max(1, min(max_results, 10))` 和上面一样的夹值写法,条数限制在 1 到 10。
- `if os.environ.get("TAVILY_API_KEY"):` 配了 Tavily 的 key 就用 Tavily,否则走 DuckDuckGo。
- `headers={"Authorization": f"Bearer {os.environ['TAVILY_API_KEY']}"}` key 放在请求头里,不要拼进 URL,否则会出现在各种日志里。
- `hits = [{"title": x["title"], "url": x["url"], "snippet": x["content"][:300]}` 把 Tavily 的字段名统一成 `title/url/snippet`,摘要截到 300 字。两个搜索后端返回的格式一样,模型就不用关心背后用的是哪家。
- `from ddgs import DDGS` 放在函数里面导入:只有真的走到 DuckDuckGo 分支才需要这个包,没装也不影响其他工具。
- `for x in DDGS().text(query, max_results=n)]` DuckDuckGo 返回的字段叫 `href` 和 `body`,在这里改名对齐。这次实测搜 `"open-meteo api"` 取 2 条,第一条是 `{"title": "️ Free Open-Source Weather API | Open-Meteo.com", "url": "https://open-meteo.com/", ...}`。
- `except Exception as e:` 搜索服务时好时坏(正文里那次就是 `DDGSException`),这里只返回异常类型名,不把一大段堆栈塞给模型。
- `return {"query": query, "results": hits} if hits else` 有结果就正常返回;没结果时多给一条 `hint`,提示模型换个说法,别拿同一个词再搜一遍。

</div>

**`name = city.split()[0]` 在干什么?** `split()` 不带参数时按空白(空格、Tab、连续多个空格)切成列表,`[0]` 取第一个元素,相当于 TS 的 `city.trim().split(/\s+/)[0]`:`"苏州 江苏"` → `["苏州", "江苏"]` → `"苏州"`。要切是因为 Open-Meteo 的地名搜索只认城市名,实测传 `"苏州 江苏"` 返回空结果、传 `"苏州"` 才查得到。但这么写有两个毛病:一是省份被丢掉了,描述里让模型加省份消歧义,其实没用上(实测搜英文 `"Suzhou"`,排第一的是安徽宿州);二是多个单词的英文城市名会被切坏,`"New York"` 只剩 `"New"`,排第一的是尼日利亚的 Nnewi。可以拿它做练习 3:比如查 10 条结果,再用省份那个词按 `admin1` / `country` 过滤。

**`max(1, min(max_lines, 300))` 是什么写法?** 把数值「夹」在一个范围里:先 `min(..., 300)` 压住上限,再 `max(1, ...)` 抬起下限,相当于 TS 的 `Math.max(1, Math.min(maxLines, 300))`。`web_search` 里的 `max(1, min(max_results, 10))` 也是一样。手敲时最容易把括号放错成 `max(1, min(max_lines), 300)`:`min` 只拿到一个参数时会把它当成「一组数」去遍历,类型检查报 `"int" is incompatible with protocol "Iterable"`,运行时报 `TypeError: 'int' object is not iterable`。

对照 Day 11 的六条原则过一遍这五个工具:

名字都带了命名空间前缀(`weather_`、`files_`、`web_`),以后加更多工具也不会混。每个描述都有三四句,说清了做什么、什么时候用、有什么限制。`weather_now` 明确写了「只能查当前,不能查未来」,不然用户问「明天会下雨吗」,模型会调用它然后拿当前天气胡乱回答;写清楚以后,模型会直接说它查不了预报。

`calculate` 比 Day 8 的版本多了两道保护:指数大于 100 直接拒绝(负指数不受影响)(`2**10000000` 会让进程卡住很久),除零单独给出报错。`files_read` 沿用分段读取和越界检查,起始行也夹到不小于 1,模型传 0 不会读出空结果。`web_search` 在描述里提醒模型「不要重复搜同一个词」,配合 Day 12 的循环检测,双保险。

我在本机不调模型、直接调用工具函数做了检查,下面是真实输出:

```text
calculate("(21.5 + 18.2) / 2")      → {"expression": "(21.5 + 18.2) / 2", "result": 19.85}
calculate("2**10000")               → {"error": "无法计算 '2**10000':指数太大"}
calculate("1/0")                    → {"error": "除数为 0"}
files_read("../../etc/passwd")      → {"error": "只能读取 workspace 目录内的文件"}
weather_now("杭州")                 → {"city": "杭州(浙江)", "temperature": 26.0, "unit": "celsius", "weather": "晴", "wind_kmh": 6.8}
web_search(...)                     → {"error": "搜索服务暂时不可用(DDGSException)。可以稍后重试,或告诉用户无法联网搜索。"}
```

最后一行是我测试时 DuckDuckGo 恰好抽风,同样的调用几分钟前是成功的。这正好说明为什么工具内部要兜住异常:免费的搜索服务就是会时好时坏,工具返回一句人话,模型就能告诉用户「暂时搜不了」,而不是整个程序崩掉。

### main.py

```python
# cli-agent/main.py  运行:uv run python main.py
import json
import os
import time
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()  # 必须在下面两个 import 之前:tools.py 导入时就读 AGENT_WORKSPACE

from robust_agent import Limits, RobustAgent
from tools import WORKSPACE, reg

# 价格按你的厂商填(美元 / 每百万 token)。默认值是 2026-10 查到的 DeepSeek deepseek-flash 高峰价
PRICE_IN = float(os.environ.get("PRICE_IN", "0.3"))
PRICE_OUT = float(os.environ.get("PRICE_OUT", "1.2"))

SYSTEM = f"""你是一个命令行助手,运行在用户的电脑上。今天是 {time.strftime('%Y-%m-%d')}。
你可以查天气、做计算、读 workspace 目录里的文件、上网搜索。
规则:
- 需要实时信息或文件内容时调用工具,不要凭记忆编造。
- 任何数字计算都用 calculate。
- 互不依赖的查询一次性并行发出。
- 回答简洁,用中文;引用搜索结果时附上链接。"""

HELP = "命令:/reset 清空对话  /cost 查看花费  /tools 列出工具  /save 保存对话  /quit 退出"


def cost(u: dict) -> float:
    return u["prompt_tokens"] / 1e6 * PRICE_IN + u["completion_tokens"] / 1e6 * PRICE_OUT


def new_agent() -> RobustAgent:
    return RobustAgent(reg, SYSTEM, Limits(max_steps=10, max_tokens=80_000, max_seconds=90))


def main():
    WORKSPACE.mkdir(exist_ok=True)
    Path("runs").mkdir(exist_ok=True)
    agent = new_agent()
    total = {"prompt_tokens": 0, "completion_tokens": 0}  # 整段对话的累计用量,给 /cost 看
    print(f"CLI Agent 已启动,模型 {agent.model},工作目录 {WORKSPACE}\n{HELP}")
    while True:
        try:
            q = input("\n你> ").strip()
        except (EOFError, KeyboardInterrupt):
            break
        if not q:
            continue
        if q == "/quit":
            break
        if q == "/reset":
            agent = new_agent()  # 只清对话,不清 total,/cost 仍是本次启动以来的总花费
            print("已清空对话。")
            continue
        if q == "/cost":
            print(f"累计 token {total},约 ${cost(total):.5f}")
            continue
        if q == "/tools":
            for s in reg.schemas:
                print("-", s["function"]["name"], ":", s["function"]["description"].splitlines()[0])
            continue
        if q == "/save":
            f = Path("runs") / f"chat_{time.strftime('%Y%m%d_%H%M%S')}.json"
            f.write_text(json.dumps(agent.messages, ensure_ascii=False, indent=2), encoding="utf-8")
            print("已保存到", f)
            continue

        # 循环检测和 token 预算都按轮算:RobustAgent 是按「一个任务」设计的,
        # 不清零的话,聊十几轮后每一轮一开始就会撞 max_tokens,直接以 budget 收尾
        agent.seen.clear()
        agent.usage = {"prompt_tokens": 0, "completion_tokens": 0}
        t0 = time.time()
        result = agent.run(q)
        spent = agent.usage
        for k in total:
            total[k] += spent[k]
        print(f"\n助手> {result.answer}")
        flag = "  [需要人工跟进]" if result.needs_human else ""
        print(f"  ({result.status},{result.steps} 步,{time.time() - t0:.1f}s,本轮 ${cost(spent):.5f}){flag}")


if __name__ == "__main__":
    main()
```

<div class="line-notes">

- `import json` `/save` 要把对话存成 JSON 文件。
- `import time` 有三个用处:system prompt 里写今天的日期、`/save` 文件名里的时间戳、每轮计时。
- `load_dotenv()  # 必须在下面两个 import 之前` 把 `.env` 里的 `LLM_*`、`AGENT_WORKSPACE`、`TAVILY_API_KEY` 加载进环境变量。顺序的原因正文第一点讲了:`tools.py` 一被导入就读 `AGENT_WORKSPACE`。
- `from robust_agent import Limits, RobustAgent` Day 12 写的健壮版 Agent。`Limits` 是一组上限(步数、token、时间),`RobustAgent.run()` 返回一个 `AgentResult`,里面有 `answer`、`status`、`steps`、`needs_human`。
- `from tools import WORKSPACE, reg` 拿到工作目录和注册好的五个工具。
- `PRICE_IN = float(os.environ.get("PRICE_IN", "0.3"))` 环境变量读出来都是字符串,要 `float()` 转一下。单位是美元/每百万 token,输入 0.3、输出 1.2。
- `SYSTEM = f"""你是一个命令行助手` 这是 f-string,`{time.strftime('%Y-%m-%d')}` 在启动时会替换成当天日期,这次实跑是「今天是 2026-10-22」。模型自己不知道今天几号,不告诉它,用户问「今天周几」它只能瞎猜。
- `- 任何数字计算都用 calculate。` 和 `calculate` 描述里那句「不要心算」前后呼应。实测求和那一轮,模型确实去调用了 `calculate`。
- `- 互不依赖的查询一次性并行发出。` 比如「杭州和成都哪个冷」,模型会在一次回复里同时发出两个 `weather_now` 调用,省掉一轮来回。
- `HELP = "命令:/reset 清空对话` 斜杠命令由程序自己处理,不发给模型,所以不花钱。
- `def cost(u: dict) -> float:` 用 token 数算美元。代入实测的总量 `{"prompt_tokens": 7058, "completion_tokens": 228}`:`7058 / 1e6 × 0.3 + 228 / 1e6 × 1.2 = 0.0021174 + 0.0002736 ≈ $0.00239`。`1e6` 就是一百万。
- `def new_agent() -> RobustAgent:` 建新 Agent 抽成函数,启动和 `/reset` 都调用它。
- `Limits(max_steps=10, max_tokens=80_000, max_seconds=90)` 每轮最多调用模型 10 次、用 8 万 token、跑 90 秒。`80_000` 里的下划线只是为了好读,等于 `80000`。没传的参数用 `Limits` 的默认值,比如 `max_repeats=2`(完全相同的工具调用最多两次)。
- `WORKSPACE.mkdir(exist_ok=True)` 目录不存在就创建,已经存在也不报错。
- `Path("runs").mkdir(exist_ok=True)` `/save` 的文件存在这里。`runs/` 已经写进 `.gitignore`,因为里面是真实的对话记录。
- `total = {"prompt_tokens": 0, "completion_tokens": 0}` 整段对话的累计用量。和 `agent.usage` 分开记,原因正文第二点讲了。
- `print(f"CLI Agent 已启动,模型 {agent.model}` 实跑输出:`CLI Agent 已启动,模型 deepseek-flash,工作目录 .../workspace`。
- `while True:` 主循环:读一行、处理、再读下一行,直到 `/quit` 或者 Ctrl+D。
- `q = input("\n你> ").strip()` `input` 显示提示符并等待输入,`.strip()` 去掉首尾空格和换行。
- `except (EOFError, KeyboardInterrupt):` Ctrl+D 抛 `EOFError`,Ctrl+C 抛 `KeyboardInterrupt`,两种都当成正常退出,不打印一大段报错。
- `if not q:` 直接回车得到空字符串,跳过,不去调用模型。
- `agent = new_agent()  # 只清对话,不清 total` 实测:`/reset` 前后两次 `/cost` 都是 `{'prompt_tokens': 7058, 'completion_tokens': 228},约 $0.00239`,说明花费累计没有被清掉。
- `print(f"累计 token {total},约 ${cost(total):.5f}")` `:.5f` 保留 5 位小数。这里的 `$` 是普通字符,不是格式化语法。
- `for s in reg.schemas:` 打印每个工具的名字和描述的第一行。实测第一行是 `- weather_now : 查询一个城市当前的天气:气温、天气状况、风速。`
- `print("-", s["function"]["name"], ":", s["function"]["description"].splitlines()[0])` `print` 收到多个参数时默认用空格隔开,所以输出里冒号两边都有空格。
- `f = Path("runs") / f"chat_{time.strftime('%Y%m%d_%H%M%S')}.json"` 用时间戳当文件名,不会覆盖之前的存档。这次实跑存成 `runs/chat_20261022_070558.json`。
- `f.write_text(json.dumps(agent.messages, ensure_ascii=False, indent=2)` `ensure_ascii=False` 让中文原样写进文件,不然会变成 `杭` 这样的转义;`indent=2` 是为了方便人看。实测存下来 13 条消息,角色依次是 system、user、assistant(调用 weather_now)、tool、assistant(回答)、user、再加三组 assistant/tool,最后一条 assistant。
- `agent.seen.clear()` 清空循环检测的计数,`seen` 是一个 `{调用签名: 次数}` 的 dict。
- `agent.usage = {"prompt_tokens": 0, "completion_tokens": 0}` 本轮 token 从 0 开始算,`max_tokens` 预算就变成按轮比较。
- `t0 = time.time()` 当前时间的秒数(浮点数),和后面的 `time.time() - t0` 一起算出本轮耗时。
- `result = agent.run(q)` 跑一整轮 Agent 循环。实测第二轮「把 weekly.md 里的销售额加起来」走了 4 步:`files_list` → `files_read(weekly.md)` → `calculate("12800 + 9650.5 + 15320")` → 回答 37770.5。
- `for k in total:` 遍历 dict 就是遍历它的 key。把本轮用量加进总量:两轮实测加起来是输入 7058、输出 228。
- `flag = "  [需要人工跟进]" if result.needs_human else ""` 三元表达式,相当于 TS 的 `needsHuman ? "..." : ""`。撞了步数、预算、超时或循环上限时,`needs_human` 为 True。
- `print(f"  ({result.status},{result.steps} 步` 实测两轮的状态行:`(ok,2 步,7.4s,本轮 $0.00071)` 和 `(ok,4 步,2.5s,本轮 $0.00169)`。第二轮步数多,而且带着第一轮的历史,所以更贵。
- `if __name__ == "__main__":` 直接运行 `main.py` 时才进入主循环,被别的文件导入时不会启动。

</div>

有三处值得说。

一是 `load_dotenv()` 放在 `from robust_agent ...` 和 `from tools ...` **之前**。`tools.py` 在被导入的那一刻就执行了 `WORKSPACE = Path(os.environ.get("AGENT_WORKSPACE", ...))`,如果先导入再加载 `.env`,你在 `.env` 里配的 `AGENT_WORKSPACE` 就不生效。Ruff 可能会提示 E402(import 不在文件顶部),这里是故意的,可以忽略。

二是每轮开始前把 `agent.seen` 和 `agent.usage` 都清零。Day 12 的 `RobustAgent` 是按「一个任务」设计的:循环检测按整个对话计数,token 预算 `max_tokens` 比的也是 `self.usage` 的累计值。放进多轮对话就出问题了。用户第二次问天气,模型调用同样的工具完全合理,不该被当成循环。预算更隐蔽:我实测前八个测试问题就累计了约 42k token,`max_tokens=80_000` 的话聊到十三四轮,之后**每一轮一开始就撞预算**,直接以 `budget` 状态收尾,回答全是「信息不足」。所以预算按轮算,整段对话的总量另外记在 `total` 里给 `/cost` 用。`/reset` 只换 agent,不清 `total`。

三是每轮的花费单独打印。你能直观地看到,随着对话变长,同样一个简单问题的花费会越来越高,因为每次都要带上更长的历史(下面实测里第一轮 `$0.0007`,第八轮 `$0.004`)。这个现象 Day 20 讲上下文工程时会正面处理。

### 接上真模型试一试

准备几个文件放进 `workspace/`,比如一份出差城市清单、一份带数字的周报。然后挨个试下面这些问题,每个问题都在考 W2 的某个知识点:

| 问题 | 考的是什么 | 期望的行为 |
| --- | --- | --- |
| 杭州、成都、哈尔滨现在哪里最冷? | 并行调用 | 一轮发出三个 weather_now |
| 这三个城市的平均气温是多少? | 多轮上下文 + 计算器 | 不重新查天气,直接用上一轮结果调 calculate |
| workspace 里有什么文件? | 工具选择 | 调 files_list |
| 读一下周报,算出本周总销售额 | 多步 + 分段读取 | files_read 后调 calculate |
| 明天上海会下雨吗? | 工具边界 | 说明只能查当前天气,不乱答 |
| 2 的 10000 次方是多少? | 工具报错 | 拿到「指数太大」后如实告知 |
| 帮我读 /etc/passwd | 安全边界 | 拒绝,说明只能读 workspace |
| 搜一下 Open-Meteo 是什么 | 联网搜索 | 回答附带链接 |

记录每个问题的状态、步数和花费。这张表就是你的第一份「评测集」雏形,W5 会把它扩展成自动化的评测。

下面是我 2026-10-17 用 deepseek-flash 实跑的结果(`workspace/` 里放了 `trip.txt` 和 `weekly.md` 两个文件,周报里只有周一到周三的数字),八个问题合计约 $0.015:

| # | 实际调用 | 状态 / 步数 | 符合期望吗 |
| --- | --- | --- | --- |
| 1 | 一轮并行 3 个 weather_now | ok / 2 | 符合 |
| 2 | 直接 calculate `(30.3 + 23.4 + 13.8) / 3`,没重新查天气 | ok / 2 | 符合 |
| 3 | files_list | ok / 2 | 符合 |
| 4 | files_read → calculate,还主动指出周报缺周四到周日 | ok / 3 | 符合 |
| 5 | weather_now(上海) + web_search「上海 明天 降雨」 | ok / 2 | **不完全符合**:没有乱答,但绕过工具边界去搜了 |
| 6 | calculate 报「指数太大」后,又用 calculate 算对数估计 | ok / 3 | 符合,还给了 ≈1.995×10³⁰¹⁰ |
| 7 | 没调用任何工具,直接拒绝 | ok / 1 | 符合 |
| 8 | web_search 第一次超时,换了更短的词再搜 | ok / 3 | 符合,附了官网和 GitHub 链接 |

第 5 题很有意思:模型知道 `weather_now` 查不了预报(它回答里原话就是这么说的),但它没停在「我查不了」,而是自己想到用 `web_search` 去搜天气预报网站。这算不算错,取决于你的产品定义。如果你希望它搜,这就是好行为;如果你担心搜索摘要不可靠,就要在 `web_search` 的描述或系统提示里写清楚。这正好是练习 3 的素材。你的结果会和我的不同,模型每次的选择都有随机性,所以练习 3 要求「重跑三次」。

### 推到 GitHub

README 至少写清楚这几件事:这个项目是什么(一句话);演示(一段终端录屏 GIF 或者一段对话截图);怎么运行(三步之内);架构(Agent 循环 + 工具注册表 + 防线,可以直接用今天的知识地图);设计取舍(为什么没用框架、工具怎么设计的、失败怎么处理的)。

最后一项最重要。面试官看你的仓库,看的不是代码量,而是你**为什么这么做**。「手写循环是为了完全掌控重试和预算逻辑」「web_search 描述里写了不要重复搜索,配合循环检测双保险」「计算器用 AST 而不是 eval,防止代码注入」,这些句子比一千行代码更能说明你懂行。

下面是一份可以直接改的项目描述。仓库简介(About 一栏)用英文一行,海外面试官也能看懂:

```text
A hand-rolled CLI AI agent in Python, no framework: 5 tools (weather, calculator, sandboxed file reader, web search), retries, timeouts, loop detection, token budget, multi-turn chat with per-turn cost.
```

README 开头:

```markdown
# cli-agent

一个不依赖 LangChain 等框架、从零手写的命令行 AI Agent。它能按需调用五个工具回答问题:
查实时天气、精确计算、读取指定目录内的文件、联网搜索。

## 特性
- **手写 Agent 循环**:模型决定调用哪个工具,支持一轮内并行调用多个工具
- **工具注册表**:用类型标注自动生成 JSON Schema,加一个工具只需写一个函数
- **防线**:模型调用指数退避重试、单个工具超时、过长结果截断、重复调用检测、
  步数/时间/token 三重上限,撞线时让模型基于已有信息给出部分答案并标记需人工跟进
- **安全**:计算器用 AST 解析而不是 eval;文件工具限制在 workspace 目录内,拒绝 `../` 越界
- **命令行交互**:多轮对话,/reset /cost /tools /save 命令,每轮显示状态、步数、耗时和花费

## 实测
8 个测试问题(并行调用、多轮上下文、工具边界、报错恢复、越权拒绝等)用 deepseek-flash 跑,
X 个行为符合预期,合计约 $X。详见下方测试表。

## 设计取舍
- 为什么不用框架:重试、预算、撞线收尾这些逻辑要完全掌控,手写循环只有一百多行
- 多轮对话里循环检测和 token 预算按轮清零,否则聊十几轮后每轮都会撞预算上限
- web_search 描述里写明「不要重复搜同一个词」,配合循环检测双保险
```

「实测」里的 X 填你练习 2 的真实结果,别抄别人的数字。简历上一两行就够:**命令行 AI Agent(Python,个人项目)**:不依赖框架手写 Agent 循环和工具注册表,集成天气、计算、文件、搜索五个工具;实现重试、超时、循环检测、token 预算和撞线降级;自建 8 题测试集评估工具选择和边界行为。

**录终端 GIF:** 用 asciinema 录、agg 转成 GIF。asciinema 自己敲一遍就行:`asciinema rec demo.cast` 开始录,正常运行 `uv run python main.py` 问几个问题,`exit` 结束;然后 `agg --font-family "Menlo,PingFang SC" --idle-time-limit 2.5 demo.cast docs/demo.gif`。两个参数都别省:不指定中文字体,GIF 里的中文会变成方框;`--idle-time-limit` 把等模型回答的几十秒压成 2.5 秒,否则 GIF 又长又大。三四个问题录出来约 400 KB,放在 `docs/` 里,README 用 `![演示](docs/demo.gif)` 引用。Homebrew 在较老的 macOS 上可能没有预编译包(`no bottle available`),这时去 agg 的 [GitHub Releases](https://github.com/asciinema/agg/releases) 直接下载单个可执行文件。

推之前先在 GitHub 网页上建一个**空仓库**(不要勾 README、.gitignore、License,否则第一次 push 会冲突),然后:

```bash
cd cli-agent
git config user.email "你的个人邮箱"     # 只对这个仓库生效;全局可能是公司邮箱
git config user.name "你的名字"
git add .
git status                # 确认列表里没有 .env 和 runs/
git diff --cached | grep -E 'sk-[A-Za-z0-9]{20,}' && echo "有真 key,别提交!"
git commit -m "CLI agent: 5 tools, robust loop, multi-turn REPL"
git branch -M main        # uv init 建的是 master,GitHub 默认是 main
git remote add origin https://github.com/你的用户名/cli-agent.git
git push -u origin main
```

`git config` 不带 `--global` 就只改当前仓库。

如果 push 时报 `could not read Username for 'https://github.com'`,说明这个终端没存 HTTPS 凭据。已经在 GitHub 配过 SSH key 的话(`ssh -T git@github.com` 能看到 `Hi 你的用户名!`),把远程地址换成 SSH 再推:`git remote set-url origin git@github.com:你的用户名/cli-agent.git`。

推之前再把每个命令手动敲一遍:`/tools` 列完工具后不该再出现「助手>」,`/cost` 的金额不该几乎是 0。手敲代码时少一个 `continue`、多一个数字(`1e6` 敲成 `1e67`)类型检查都查不出来,只能靠实际跑一遍。提交记录里的邮箱是公开的,别人点开 commit 就能看到,所以作品集仓库要用个人邮箱。

## W2 面试题汇总

下面十二道题在 Agent 岗面试里出现频率很高。先自己答,再展开看要点。

**1. 说说 function calling 的原理。模型真的执行了函数吗?**

<details><summary>答案</summary>

没有。模型根据 tools 定义,在需要时生成结构化的调用请求(函数名 + JSON 参数),请求就结束了。应用程序解析并执行函数,把结果作为 tool 消息(带 tool_call_id)回传,再次请求模型生成最终回答。工具定义会被服务端渲染进提示词,模型经过专门训练来生成这种格式。

</details>

**2. 手写一个最简单的 Agent。**

<details><summary>答案</summary>

for 循环,上限 N 步:调模型(带 messages 和 tools);把 assistant 消息追加进历史;没有 tool_calls 就返回 content;否则逐个执行工具,结果以 tool 消息追加,继续循环;超过 N 步返回未完成。追问时补充:报错交给模型、循环检测、预算、上下文增长。

</details>

**3. Agent 陷入死循环怎么办?**

<details><summary>答案</summary>

多层防护:最大步数;对「工具名 + 参数」做指纹计数,重复调用时返回提示而不执行,多次重复强制收尾;token 和时间预算;工具描述里提示不要重复调用;撞线后禁用工具让模型给部分答案并转人工。从根源上看,循环常因工具返回信息不足或报错不清晰,要回到工具设计上改。

</details>

**4. 工具调用失败、超时、返回异常怎么处理?**

<details><summary>答案</summary>

工具内部:HTTP 调用设超时,异常捕获后返回可操作的报错信息。循环层:线程池加总超时兜底,结果过长截断并说明。模型 API:只对 429/5xx/连接错误做带抖动的指数退避重试,避免与 SDK 自带重试叠加。写操作要幂等,防止超时后重试导致重复执行。

</details>

**5. 怎么设计一个好的工具?**

<details><summary>答案</summary>

按任务设计而不是照搬 API(search 而不是 list);名字和参数无歧义,多系统加命名空间;描述三四句,写清用途、时机、参数含义和限制;能枚举就枚举,宽进严出;返回高信号字段,支持分页和详略选择,截断时说明;报错说清错在哪、正确格式、下一步建议;用评测比较改动前后效果。

</details>

**6. ReAct 是什么?现在还用吗?**

<details><summary>答案</summary>

2022 年的方法,让模型交替输出 Thought、Action,系统填入 Observation,结合推理和行动。早期用提示词加 stop 序列实现。现在原生 function calling 和推理模型已经内化了这个思想,很少照抄文本格式,但「推理与行动交替、基于真实观察决策」仍是所有 Agent 的基础。

</details>

**7. Workflow 和 Agent 有什么区别?你怎么选?**

<details><summary>答案</summary>

下一步由代码决定是 workflow,由模型动态决定是 agent。选择原则:能单次调用解决就不用 workflow,步骤可预测就用 workflow(链、路由、并行、编排、评估优化),只有开放式、步数无法预知的任务才用 agent。agent 更灵活但更贵、更慢、更难测试。

</details>

**8. 一个 Agent 任务的成本怎么估算?为什么长任务特别贵?**

<details><summary>答案</summary>

成本 = 输入 token × 输入单价 + 输出 token × 输出单价,对每一步求和。因为 API 无状态,每一步都要重发完整历史,输入 token 随步数线性增长,总量接近平方增长。工具结果越大增长越快。优化手段:精简工具返回、上下文压缩、prompt caching、小模型处理简单步骤。

</details>

**9. 多个工具调用可以并行执行吗?有什么风险?**

<details><summary>答案</summary>

模型一次返回多个 tool_calls 时,互不依赖的只读调用可以并发执行(asyncio.gather 或线程池),节省延迟。风险是有副作用或互相依赖的调用(先创建再查询),并发可能导致顺序错误;写操作建议串行,必要时关闭厂商的并行调用开关。

</details>

**10. 你怎么测试一个 Agent?**

<details><summary>答案</summary>

分两类。工程逻辑(循环控制、重试、超时、截断、预算、转人工)用假模型按剧本返回响应,离线、确定性地单元测试。行为质量(工具选得对不对、回答好不好)用固定的评测集跑真模型,检查工具调用轨迹和最终答案,配合 LLM 评分,改动前后对比。线上再加 tracing 和失败轨迹的错误分析。

</details>

**11. 什么时候不该用 Agent?**

<details><summary>答案</summary>

步骤固定、路径可预测时用 workflow;单次调用加检索能解决时连 workflow 都不用;出错代价高且没有可靠验证手段时(比如直接操作资金)不让 Agent 自主执行,至少加人工审批;延迟和成本敏感的高频场景优先用确定性流程。判断依据是「下一步能不能由代码决定」,能就不需要 Agent。

</details>

**12. 什么时候不该用框架?你的项目为什么没用 LangChain/LangGraph?**

<details><summary>答案</summary>

逻辑简单(几次调用、一个循环)时直接用 API,代码更短、更透明;需要精确控制重试、预算、上下文组装时,框架的抽象层反而碍事,出错时要穿过好几层才能看到真实的提示词。框架的价值在于状态持久化、中断恢复、人工审批、可视化调试这些自己写很费劲的能力,需要时再引入,并且要清楚它底层在做什么。本项目手写是为了掌控每一道防线,W4 需要 checkpoint 和人工审批时会换成 LangGraph,这个取舍本身就是面试时的好答案。

</details>

## W2 踩坑清单

这一周最容易踩的坑,按出现频率排:

- **把 arguments 当字典。** 它是 JSON 字符串,要 `json.loads`,而且可能解析失败。
- **回传结果时漏了 assistant 消息,或漏了某个 tool_call_id。** 多数厂商直接 400。
- **tool 消息的 content 塞了 Python 对象。** 必须是字符串,中文加 `ensure_ascii=False`。
- **DeepSeek 思考模式下没回传 reasoning_content。** 带 tools 的多轮请求效果变差。
- **纯文本 ReAct 不加 stop 序列。** 模型自己编 Observation。
- **工具异常直接抛出,程序崩溃。** 应该转成报错信息交给模型。
- **工具返回整个数据集。** 一次几万字符,上下文和钱包一起爆。
- **没有步数上限。** 模型偶尔停不下来。
- **SDK 重试和自己的重试叠加。** 请求次数成倍增加。
- **用 eval 实现计算器。** 等于给模型开了一个任意代码执行的后门。
- **读文件工具不检查路径。** `../../` 一路读到系统文件。
- **API key 提交进 git。** 几分钟内就可能被盗刷。
- **单任务的预算和循环检测直接搬进多轮对话。** 累计值越滚越大,聊十几轮后每轮都撞线。多轮场景要按轮清零。
- **复制代码到新项目后 import 路径没改。** `from w2.xxx` 在新目录里找不到包。

## 动手练习

**练习 1:完成项目。** 按上面的目录结构把 CLI Agent 跑起来,`/tools` 能列出五个工具。

**练习 2:跑完测试问题表。** 把八个问题都问一遍,记录到下表(空表,填你的实测):

| # | 状态 | 步数 | 本轮花费 | 行为符合期望吗 | 不符合的话,问题在哪 |
| --- | --- | --- | --- | --- | --- |
| 1 | | | | | |
| 2 | | | | | |
| 3 | | | | | |
| 4 | | | | | |
| 5 | | | | | |
| 6 | | | | | |
| 7 | | | | | |
| 8 | | | | | |

**练习 3:修一个问题。** 从表里挑一个不符合期望的问题,判断它属于工具设计、提示词还是模型能力的问题,改一处,重跑三次验证。写下改动和结果。

**练习 4:加一个工具。** 自己设计第六个工具,比如 `files_write`(只能写 workspace、不能覆盖已有文件)或 `time_now`(返回指定时区的当前时间)。按六条原则写描述,在假模型下写一个单元测试。

**练习 5:发布。** 推到 GitHub,README 包含演示、运行方法、架构图和至少三条设计取舍说明。确认仓库里没有 `.env`。

**验收标准:** 八个测试问题至少六个行为符合期望;练习 3 有改动前后的对比;练习 4 的新工具有测试;GitHub 仓库别人照 README 三步能跑起来,且不含任何密钥。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 命令行 Agent(CLI Agent) | 在终端里交互的 Agent,本周小项目的形态 |
| 多轮对话 | 保留之前的 messages,下一个问题能用上之前的上下文 |
| 本轮花费 | 本轮前后累计用量之差乘以单价 |
| `.env` / `.env.example` | 存放真实密钥的本地文件 / 进仓库的模板文件 |
| Open-Meteo | 免费、无需注册的天气 API |
| Tavily | 面向 Agent 的搜索 API,免费额度每月 1000 次 |
| DuckDuckGo(ddgs) | 无需 key 的搜索,Python 库名 `ddgs`,国内直连通常不可用 |
| AST | 抽象语法树,计算器用它只解析数学表达式,避免执行任意代码 |
| 评测集雏形 | 固定的一组问题加期望行为,用来比较改动前后的效果 |

## 常见误区

**项目做完就算完。** 没有测试问题表、没有 README 设计说明的项目,在面试官眼里和「跟着教程敲了一遍」没有区别。

**工具越多越显得厉害。** 五个设计良好的工具,比二十个随手包装的 API 更能体现水平。

**花费不重要,反正很便宜。** 单次确实便宜,但你要能说出它随对话长度怎么增长、为什么。面试和生产都会问。

**搜索失败是 bug。** 免费搜索服务本来就不稳定,重要的是工具把失败变成一句人话,Agent 能体面地告诉用户。

**跳过复习日。** W2 的循环是后面所有内容的地基。今天讲不清楚的地方,后面每一周都会再绊你一次。

## 学习资料

### 文档与文章

- [Anthropic · Building effective agents](https://www.anthropic.com/engineering/building-effective-agents):复习时再读一遍,这次重点读结尾的总结和两个附录,30 分钟。
- [Anthropic · Writing effective tools for agents](https://www.anthropic.com/engineering/writing-tools-for-agents):对照它审查你今天的五个工具,30 分钟。
- [Thorsten Ball · How to Build an Agent](https://ampcode.com/how-to-build-an-agent):如果 Day 9 没读,今天读;读过的话对比他的 Go 版和你的 Python 版,40 分钟。
- [Tavily 额度说明](https://docs.tavily.com/documentation/api-credits):搜索工具的免费额度和计费方式,5 分钟。
- [Open-Meteo 文档](https://open-meteo.com/en/docs):天气工具的数据源,想加「未来几天预报」工具时看,15 分钟。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1dw526tEMA&autoplay=0&high_quality=1" title="【2026/Agent】一期讲透!理论+代码从ToolCall到Harness、Claw,告诉你Agent的一切" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>木乔_Mokio · 【2026/Agent】一期讲透!理论+代码从ToolCall到Harness、Claw,告诉你Agent的一切 · 20 个分 P 共约 2 小时 50 分钟,从工具调用讲到完整的 Agent 外壳,代码在作者的 GitHub 仓库。适合周末把 W2 整体再过一遍。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1CWee6WEYf&autoplay=0&high_quality=1" title="从零手搓一个Agent,看完你也会" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>onedayhigh · 从零手搓一个Agent,看完你也会 · 24 分钟,另一种手搓 Agent 的写法,看完对比一下和你的项目在结构上的异同。</figcaption>
</figure>

- 马克的技术工作坊《Agent 的概念、原理与构建模式》(BV1TSg7zuEqR):Day 9 推荐过,复习时再看一遍后半段的代码部分。

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/bZzyPscbtI8" title="Building AI Agents in Pure Python - Beginner Course" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Dave Ebbelaar · Building AI Agents in Pure Python - Beginner Course · 纯 Python 构建 Agent 的完整入门课,覆盖本周大部分内容,适合当作英文版总复习。</figcaption>
</figure>

- Anthropic《Tips for building AI agents》(YouTube `LP5OCa20Zpg`):Day 11 推荐过,复习时重听关于「什么时候不该用 agent」的部分。

### 书籍

- Chip Huyen《AI Engineering》(O'Reilly, 2025):第 6 章 Agents 部分整体回顾一遍(Agent Overview、Tools、Planning、Failure Modes),和本周六天一一对应。
- 黄佳《大模型应用开发 动手做AI Agent》(人民邮电出版社, 2024):中文读者可以把书里 Function Calling、ReAct、Plan-and-Execute 三个项目连起来看一遍,和本周内容互相印证。

### 开源项目与代码

- [Wood-Q/MokioAgent](https://github.com/Wood-Q/MokioAgent):上面那个 B 站视频的配套代码,分理论和项目两个分支。
- [huggingface/smolagents](https://github.com/huggingface/smolagents):一个精简的生产级 Agent 库。读它怎么处理工具报错和步数上限,对照你的 `robust_agent.py`。
- [datawhalechina/hello-agents](https://github.com/datawhalechina/hello-agents):第四章和第七章作为本周的中文补充材料。

## 自测

1. 不看笔记,画出 W2 知识地图,每块写一句话。

<details><summary>答案</summary>

参考正文「W2 一页知识地图」一节:函数调用是协议基础;循环是心脏;ReAct 与规划让它更聪明;工具设计和失败处理让它更可靠;workflow 提醒先问是否真的需要 agent。

</details>

2. 为什么 CLI Agent 每轮开始前要清空循环检测计数?

<details><summary>答案</summary>

循环检测原本按整个对话计数。多轮对话里用户再次问天气,模型调用同样的工具是合理的,不应被当成循环拦截。按轮清空后,只检测单轮任务内部的重复调用。

</details>

3. 同一个简单问题,在对话第 1 轮和第 10 轮问,本轮花费为什么不同?

<details><summary>答案</summary>

每次请求都要带上完整的对话历史(包括之前所有的工具结果),第 10 轮的输入 token 远多于第 1 轮,所以同样的问题花费更高。这是上下文工程要解决的问题。

</details>

4. `weather_now` 的描述里写「只能查当前,不能查未来」,删掉这句会发生什么?

<details><summary>答案</summary>

用户问明天的天气时,模型可能调用 weather_now 拿到当前天气,然后当成明天的天气回答,给出错误信息。明确写出限制后,模型会直接告诉用户查不了预报。工具的边界要写在描述里。

</details>

5. (面试题)「介绍一下你做过的 Agent 项目。」用今天的项目准备一段两分钟的回答。

<details><summary>答案</summary>

参考结构:一句话说项目是什么;架构(手写循环 + 工具注册表 + 防线);一两个设计取舍及原因(为什么不用框架、工具怎么设计、失败怎么兜底);一个具体的问题和你怎么解决的(比如搜索服务不稳定、长对话花费增长);数据(测试问题的通过率、单轮平均花费)。避免只罗列技术名词。

</details>

## 明天预告

W2 结束,你的 Agent 已经能查天气、读文件、上网搜索了。但如果你问它「云簿的退款政策是什么」,它只能去网上搜,搜不到公司内部的知识。W3 解决这个问题。明天(Day 15)从最基础的概念开始:**Embedding,把文字变成向量**,手算一遍余弦相似度,弄明白机器是怎么判断两句话「意思相近」的。
