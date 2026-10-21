---
title: 'Day 9 · 不用框架,100 行手写一个 Agent 循环'
description: '把昨天的一次往返改成 while 循环,加一个从函数签名自动生成 schema 的工具注册表,得到一个能连续调用多个工具、自己决定何时停下的 Agent。这段代码是面试最常考的手写题,也是后面整门课所有 Agent 的心脏。'
pubDate: 2026-10-12
regime: none
tags: ['agent-loop', 'tool-registry', 'python', 'agent-60']
series: 'agent-60'
day: 9
lang: 'zh'
---

## 今天要解决的问题

昨天的代码有个硬伤:它假设模型调一轮工具就能回答。现实里的任务不是这样的。用户说「读一下 cities.txt,查这几个城市的气温,告诉我平均气温」,模型得先读文件,看到三个城市名,再查三次天气,再算平均数,最后才回答。它要做几步,事先谁也不知道。

Agent 和普通的「调用一下 API」最大的区别就在这里:**步数由模型在运行时决定**。今天我们把它写出来。学完你应该能:

1. 默写出 Agent 循环的骨架(调模型、执行工具、回传、直到不再调工具),并说出每一行为什么存在。
2. 写一个工具注册表,用装饰器把普通 Python 函数变成工具,schema 从类型标注和 docstring 自动生成。
3. 给循环加上最大步数、逐步日志和 token 统计,让它可控、可观察。
4. 用自己写的这 100 行代码跑通一个需要 5 次以上工具调用的任务。
5. 在面试白板上 15 分钟内写出一个能跑的版本,并能回答「为什么要有最大步数」「工具报错怎么办」这类追问。

预计用时 4–5 小时,其中至少一半时间在敲代码和调试。前置是 Day 8 的 `weather.py`、`calc.py`,放在同一个 `agent-60-lab/w2/` 目录里。

## Agent 到底是什么

先给一个够用的定义。Simon Willison 在 2025 年那篇[《Designing agentic loops》](https://simonwillison.net/2025/Sep/30/designing-agentic-loops/)里沿用了他自己的说法:**Agent 就是在循环里调用工具、去达成一个目标的 LLM。** 我很喜欢这个定义,因为它没有任何玄学成分。没有「自主意识」,没有「规划模块」「记忆模块」这类听起来很唬人的框图,就是三样东西:一个模型、一组工具、一个循环。

Thorsten Ball 写过一篇很有名的文章[《How to Build an Agent》](https://ampcode.com/how-to-build-an-agent),用不到 400 行 Go 代码、三个工具(read_file、list_files、edit_file)做出了一个能改代码的 Agent。他的结论是,一个能用的代码 Agent 就是「一个 LLM、一个循环,加上足够的 token」,商业产品里那些看起来很厉害的东西,多数是在这个骨架上做的工程打磨。Claude Code、Cursor 的 Agent 模式、Codex,核心循环和你今天要写的没有本质区别。

这件事对你求职很重要。面试官问「说说 Agent 的原理」,最差的回答是背一串框架名词,最好的回答是在白板上画出这个循环,然后讲清楚每个环节在生产里会出什么问题。今天写完,你就有了这个底气。

<figure>
<svg viewBox="0 0 640 330" role="img" aria-label="Agent 循环示意图:调用模型、判断是否有工具调用、执行工具、回传结果">
  <rect x="0" y="0" width="640" height="330" fill="var(--paper-raised)" rx="6"/>
  <rect x="30" y="140" width="110" height="44" fill="none" stroke="var(--ink-soft)" rx="4"/>
  <text x="85" y="167" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">用户输入</text>
  <line x1="140" y1="162" x2="200" y2="162" stroke="var(--ink-soft)" marker-end="url(#a9)"/>
  <rect x="200" y="135" width="130" height="54" fill="var(--mem-wash)" stroke="var(--mem)" rx="4"/>
  <text x="265" y="158" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--mem)">调用模型</text>
  <text x="265" y="176" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--mem)">messages+tools</text>
  <line x1="330" y1="162" x2="390" y2="162" stroke="var(--ink-soft)" marker-end="url(#a9)"/>
  <polygon points="450,122 510,162 450,202 390,162" fill="none" stroke="var(--ink-soft)"/>
  <text x="450" y="158" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">有</text>
  <text x="450" y="173" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">tool_calls?</text>
  <line x1="510" y1="162" x2="560" y2="162" stroke="var(--ink-soft)" marker-end="url(#a9)"/>
  <text x="530" y="152" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">否</text>
  <rect x="560" y="140" width="66" height="44" fill="none" stroke="var(--ink)" rx="4"/>
  <text x="593" y="167" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">回答</text>
  <line x1="450" y1="202" x2="450" y2="250" stroke="var(--ink-soft)" marker-end="url(#a9)"/>
  <text x="462" y="230" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">是</text>
  <rect x="370" y="250" width="160" height="50" fill="var(--compute-wash)" stroke="var(--compute)" rx="4"/>
  <text x="450" y="272" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--compute)">执行每个工具</text>
  <text x="450" y="290" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--compute)">结果追加进 messages</text>
  <path d="M370 275 L265 275 L265 194" fill="none" stroke="var(--compute)" marker-end="url(#a9)"/>
  <text x="275" y="240" font-family="var(--font-mono)" font-size="11" fill="var(--compute)">再来一轮</text>
  <text x="265" y="110" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">每转一圈 = 一个 step,超过 max_steps 强制退出</text>
  <defs><marker id="a9" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0 L10 5 L0 10 z" fill="var(--ink-soft)"/></marker></defs>
</svg>
<figcaption>Agent 循环只有一个分支:模型这一轮要不要调工具。要就执行并回到模型,不要就结束。「什么时候停」完全交给模型判断,所以必须有步数上限兜底。</figcaption>
</figure>

## 先写一个 25 行的最小版

动手之前先写最丑的版本,把骨架看清楚。下面这段代码只依赖昨天的 `weather.py`,能跑:

```python
# agent-60-lab/w2/minimal_loop.py
import json
import os
from typing import Any

from dotenv import load_dotenv
from openai import OpenAI

from w2.tools_def import WEATHER_TOOL
from w2.weather import get_weather

load_dotenv()
client = OpenAI(base_url=os.environ["LLM_BASE_URL"], api_key=os.environ["LLM_API_KEY"])
messages: list[Any] = [{"role": "user", "content": "北京、上海、广州现在哪里最热?"}]

for _ in range(10):  # 最多转 10 圈
    msg = client.chat.completions.create(
        model=os.environ["LLM_MODEL"], messages=messages, tools=[WEATHER_TOOL]
    ).choices[0].message
    messages.append(msg.model_dump(exclude_none=True))  # 偷懒写法,正式版会手工构造
    if not msg.tool_calls:
        print(msg.content)
        break
    for tc in msg.tool_calls:
        if tc.type != "function":  # 和 Day 8 一样:先排除 custom 工具,编辑器才知道有 .function
            continue
        result = get_weather(**json.loads(tc.function.arguments))
        messages.append({"role": "tool", "tool_call_id": tc.id, "content": json.dumps(result, ensure_ascii=False)})
```

<div class="line-notes">

- `import json` 模型给的参数是 JSON 字符串,要用 `json.loads` 解开;工具结果要用 `json.dumps` 变回字符串塞进消息。
- `from typing import Any` 下面要把 `messages` 标成 `list[Any]`,原因见那一行。
- `from dotenv import load_dotenv` 从仓库根目录的 `.env` 读 `LLM_BASE_URL`、`LLM_API_KEY`、`LLM_MODEL`,这样 key 不用写进代码。
- `from w2.tools_def import WEATHER_TOOL` 复用 Day 8 手写的那份 schema。`w2.` 开头的写法要求你在仓库根目录用 `-m w2.minimal_loop` 运行,Python 才能找到 `w2` 这个包。
- `load_dotenv()` 必须在下面 `os.environ[...]` 之前执行,否则会报 `KeyError: 'LLM_BASE_URL'`。
- `client = OpenAI(` 拿 OpenAI 兼容协议连 DeepSeek。实测 `.env` 里 `LLM_BASE_URL=https://api.deepseek.com`、`LLM_MODEL=deepseek-flash`。
- `messages: list[Any] = [` 整个对话历史就是这一个列表,开头只有 1 条 user 消息。标成 `list[Any]` 是为了让编辑器别跟 SDK 的消息类型较劲,运行时没区别。
- `for _ in range(10):` `_` 表示「循环变量我用不上」。最多转 10 圈,是防止模型一直调工具停不下来的保险丝。实测这个问题只转了 2 圈就结束了。
- `msg = client.chat.completions.create(` 每一圈都把**完整的 messages** 发出去。实测第 1 圈发 1 条,第 2 圈发 5 条。
- `).choices[0].message` 只要第一个候选的 message。第 1 圈实测返回:`content='我来查一下这三个城市现在的天气。'`,`tool_calls` 有 3 个,分别是 `get_weather({"city": "北京"})`、上海、广州,一次性并行要了三个工具。用量是 prompt 363 / completion 137 token。
- `messages.append(msg.model_dump(exclude_none=True))` 把模型这一轮的回复原样放回历史。实测 dump 出来的 key 是 `['content', 'role', 'tool_calls', 'reasoning_content']`,每个 tool_call 里还带了一个 `"index": 0`。`index` 这种多余字段就是正文说的「偷懒写法」的风险:DeepSeek 不在意,换个严格的厂商就可能报错。
- `if not msg.tool_calls:` 退出条件:模型这一轮没要工具,就说明它觉得可以直接回答了。第 1 圈有 3 个 tool_calls,不进这里;第 2 圈 `tool_calls` 为空,进来。
- `print(msg.content)` 第 2 圈实测打印的回答开头是「**广州最热,21.6°C。**」,后面列了一张表:广州 21.6°C 晴、上海 16.2°C 多云、北京 4.5°C 晴。打印完 `break` 跳出循环。
- `for tc in msg.tool_calls:` 第 1 圈要了 3 个工具,这里就循环 3 次,`tc` 依次是北京、上海、广州那三个调用。
- `if tc.type != "function":` 实测 `tc.type` 都是 `"function"`,这行不会触发。它的作用主要是让编辑器知道下面的 `tc.function` 一定存在。
- `result = get_weather(**json.loads(tc.function.arguments))` 从里往外读:`tc.function.arguments` 是**字符串** `'{"city": "北京"}'` → `json.loads` 变成字典 `{'city': '北京'}` → `**` 把字典展开成关键字参数,等于 `get_weather(city='北京')`。实测返回 `{'city': '北京', 'country': '中国', 'temperature': 4.5, 'unit': 'celsius', 'weather': '晴', 'wind_kmh': 0.6}`。
- `messages.append({"role": "tool"` 把结果作为 tool 消息放回历史,`tool_call_id` 要和上面那个 tc 的 id 对上(实测像 `call_00_H77zlrkgjD3hMR7JVr129491`),模型靠它知道哪个结果对应哪次调用。`ensure_ascii=False` 让中文保持原样;不加的话「北京」会变成 `北京`,模型也能读懂,但更费 token。3 个结果放完,messages 从 2 条变成 5 条(user + assistant + 3 个 tool),进入第 2 圈。

</div>

在仓库根目录用 `uv run python -m w2.minimal_loop` 运行。

如果你照着更早的写法写成 `messages = [{"role": "user", ...}]`、循环里直接用 `tc.function`,编辑器会在这两处画红线,但程序照样能跑。原因和 Day 8 一样:第一处,编辑器把 `messages` 推断成「字符串到字符串的字典列表」,和 SDK 要求的消息类型对不上,所以标成 `list[Any]` 放宽;第二处,`tool_calls` 里的元素可能是 function 工具也可能是 custom 工具,只有前者有 `.function`,先用 `if tc.type != "function": continue` 排除掉,编辑器就知道下面一定是 function 了。

和昨天比,只是把「第一次请求、执行、第二次请求」折成了一个 `for` 循环。退出条件写在循环体里:模型这一轮没有 tool_calls,就打印回答并 break。`range(10)` 是最大步数,防止模型一直调工具停不下来。

你可能注意到我这里用了 `msg.model_dump(exclude_none=True)` 直接把 SDK 返回的对象转成字典塞回去。这是偷懒写法,大部分时候能用,但它会把 SDK 对象上所有非空字段都带上,某些厂商不认识多出来的字段会报错。正式版里我会手工挑字段,下面会看到。

25 行已经是一个 Agent 了。剩下的 75 行在解决三个工程问题:工具多了以后 schema 写不过来;出错了程序会直接崩;跑起来像黑盒,不知道它在干什么。

## 工具注册表:让函数签名自己变成 schema

昨天手写 `WEATHER_TOOL` 那段 JSON 时你应该已经觉得别扭了:函数签名里写一遍参数,schema 里又写一遍,改了一处忘了另一处,模型就会传一个函数不认识的参数。工具一多,这种不同步是必然的。

解决办法是让 schema 从函数本身生成。Python 的类型标注正好提供了需要的全部信息:参数名、类型、有没有默认值。再借用 `typing.Annotated` 给每个参数挂一句说明,用 docstring 当工具描述。最后效果是这样:

```python
@reg.tool
def get_weather(
    city: Annotated[str, "城市名,中文或英文,例如 '北京'"],
    unit: Annotated[Literal["celsius", "fahrenheit"], "温度单位"] = "celsius",
) -> dict:
    """查询某个城市当前的天气(气温、天气状况、风速)。"""
```

一个装饰器,函数照常写,schema 自动有了。`Literal` 会变成 `enum`,有默认值的参数不进 `required`。这就是 LangChain 的 `@tool`、OpenAI Agents SDK 的 `@function_tool`、MCP Python SDK 的 `@mcp.tool()` 在做的事,原理一模一样。你自己写过一遍,以后看到这些框架就不会觉得神秘。

注册表的另一半职责是**执行**。模型给的是函数名字符串和参数 JSON 字符串,注册表负责找到函数、解析参数、调用、把结果序列化回字符串。这里有一个设计决定我想强调:**执行过程中的任何异常都不往外抛,而是包装成 `{"error": ...}` 作为工具结果交还给模型。**

为什么?因为模型很擅长根据报错改正自己。参数 JSON 写坏了,它看到 `JSONDecodeError` 会重写一遍;调了不存在的工具,它看到「可用的有 [...]」会换一个;文件名写错了,它看到「workspace 里现有的文件: [...]」会自己挑对的。如果你在这里抛异常让整个程序崩掉,就等于剥夺了它纠错的机会。Day 11 讲工具设计时,我们会专门讲报错信息怎么写才能最大化这种自我纠正。

## 完整的 100 行

下面是今天的主体代码。我把它分成两个文件:`agent_loop.py` 是通用部分,以后每一周都会复用和扩展;`day09_demo.py` 定义今天要用的工具并跑一个任务。

```python
# agent-60-lab/w2/agent_loop.py
import inspect
import json
import os
import time
from collections.abc import Callable
from typing import Annotated, Any, Literal, get_args, get_origin, get_type_hints

from openai import OpenAI

PY2JSON = {str: "string", int: "integer", float: "number", bool: "boolean", list: "array", dict: "object"}


def _param_schema(tp: Any) -> dict:
    desc = None
    if get_origin(tp) is Annotated:  # Annotated[str, "说明"]
        tp, desc = get_args(tp)[0], get_args(tp)[1]
    if get_origin(tp) is Literal:
        schema = {"type": "string", "enum": list(get_args(tp))}
    else:
        schema = {"type": PY2JSON.get(tp, "string")}
    if desc:
        schema["description"] = desc
    return schema


class ToolRegistry:
    def __init__(self):
        self.funcs: dict[str, Callable] = {}
        self.schemas: list[Any] = []  # 和 Day 8 一样放宽成 Any,否则传给 SDK 的 tools= 会画红线

    def tool(self, fn: Callable) -> Callable:
        """装饰器:把一个普通函数注册成工具,schema 从类型标注和 docstring 生成。"""
        hints = get_type_hints(fn, include_extras=True)
        sig = inspect.signature(fn)
        props, required = {}, []
        for name, p in sig.parameters.items():
            props[name] = _param_schema(hints.get(name, str))
            if p.default is inspect.Parameter.empty:
                required.append(name)
        self.funcs[fn.__name__] = fn
        self.schemas.append({
            "type": "function",
            "function": {
                "name": fn.__name__,
                "description": inspect.getdoc(fn) or "",
                "parameters": {"type": "object", "properties": props, "required": required},
            },
        })
        return fn

    def call(self, name: str, arguments: str) -> str:
        if name not in self.funcs:
            return json.dumps({"error": f"没有叫 {name} 的工具,可用的有 {list(self.funcs)}"}, ensure_ascii=False)
        try:
            args = json.loads(arguments or "{}")
            result = self.funcs[name](**args)
        except Exception as e:  # noqa: BLE001 —— 这里就是要接住一切,错误不抛出,交给模型自己纠正
            result = {"error": f"{type(e).__name__}: {e}"}
        return json.dumps(result, ensure_ascii=False, default=str)


class Agent:
    def __init__(self, registry: ToolRegistry, system: str, max_steps: int = 10):
        self.client = OpenAI(base_url=os.environ["LLM_BASE_URL"], api_key=os.environ["LLM_API_KEY"])
        self.model = os.environ["LLM_MODEL"]
        self.registry = registry
        self.max_steps = max_steps
        self.messages: list[Any] = [{"role": "system", "content": system}]
        self.usage = {"prompt_tokens": 0, "completion_tokens": 0}

    def run(self, user_input: str) -> str:
        self.messages.append({"role": "user", "content": user_input})
        for step in range(1, self.max_steps + 1):
            t0 = time.time()
            resp = self.client.chat.completions.create(
                model=self.model, messages=self.messages, tools=self.registry.schemas
            )
            msg = resp.choices[0].message
            if resp.usage:
                self.usage["prompt_tokens"] += resp.usage.prompt_tokens
                self.usage["completion_tokens"] += resp.usage.completion_tokens
            self.messages.append(self._assistant_dict(msg))

            if not msg.tool_calls:  # 没有工具调用 = 模型认为可以回答了
                print(f"[step {step}] 完成 ({time.time() - t0:.1f}s)")
                return msg.content or ""

            for tc in msg.tool_calls:
                if tc.type != "function":  # 排除 custom 工具,同 Day 8
                    continue
                print(f"[step {step}] 调用 {tc.function.name}({tc.function.arguments})")
                out = self.registry.call(tc.function.name, tc.function.arguments)
                print(f"           结果 {out[:120]}")
                self.messages.append({"role": "tool", "tool_call_id": tc.id, "content": out})
        return f"已达到最大步数 {self.max_steps},任务没有完成。最后的进展见上面的日志。"

    @staticmethod
    def _assistant_dict(msg) -> dict:
        d: dict[str, Any] = {"role": "assistant", "content": msg.content}
        if msg.tool_calls:
            d["tool_calls"] = [tc.model_dump() for tc in msg.tool_calls]
        reasoning = getattr(msg, "reasoning_content", None)  # DeepSeek 思考模式,带 tools 时要回传
        if reasoning:
            d["reasoning_content"] = reasoning
        return d
```

<div class="line-notes">

- `import inspect` 用来读函数的签名(参数名、默认值)和 docstring,schema 就是从这些信息生成的。
- `from collections.abc import Callable` `Callable` 表示「可以调用的东西」,这里就是指工具函数。
- `from typing import Annotated, Any, Literal, get_args, get_origin, get_type_hints` 后三个是拆类型标注的工具:`get_origin` 问「这是什么外壳」,`get_args` 取「壳里装了什么」,`get_type_hints` 取一个函数所有参数的类型。
- `PY2JSON = {` Python 类型到 JSON Schema 类型名的对照表,比如 `str` 对应 `"string"`,`int` 对应 `"integer"`。
- `def _param_schema(tp: Any) -> dict:` 给**一个参数**生成 schema。函数名前面的下划线是约定,表示「模块内部用,别从外面调」。
- `desc = None` 先假设这个参数没有说明文字。
- `if get_origin(tp) is Annotated:` 拿 Day 9 demo 里的 `unit` 参数代入:`tp = Annotated[Literal["celsius", "fahrenheit"], "温度单位"]`,实测 `get_origin(tp)` 是 `typing.Annotated`,条件成立。如果是普通的 `str`,`get_origin(str)` 是 `None`。
- `tp, desc = get_args(tp)[0], get_args(tp)[1]` 实测 `get_args(tp)` 是 `(Literal['celsius', 'fahrenheit'], '温度单位')`。拆开后 `tp = Literal['celsius', 'fahrenheit']`,`desc = '温度单位'`。这是元组拆包,一行给两个变量赋值。
- `if get_origin(tp) is Literal:` 剥掉 Annotated 以后再看里面那层:`get_origin(Literal[...])` 是 `typing.Literal`,成立。
- `schema = {"type": "string", "enum": list(get_args(tp))}` `get_args` 拿到 `('celsius', 'fahrenheit')`,转成列表就是 enum。这里假设 Literal 里放的都是字符串。
- `schema = {"type": PY2JSON.get(tp, "string")}` 不是 Literal 的情况走这里。`dict.get(key, 默认值)`:`str` 查到 `"string"`,`int` 查到 `"integer"`。查不到的一律当成 string,实测 `list[str]` 就得到 `{'type': 'string'}`,这是正文说的「故意简化」。
- `if desc:` 有说明文字才加 description。实测 `unit` 最终是 `{'type': 'string', 'enum': ['celsius', 'fahrenheit'], 'description': '温度单位'}`。
- `class ToolRegistry:` 注册表负责两件事:登记工具(生成 schema),以及按名字执行工具。
- `self.funcs: dict[str, Callable] = {}` 名字 → 函数的映射。demo 注册完以后实测是 `['get_weather', 'calculate', 'read_file']` 三个 key。
- `self.schemas: list[Any] = []` 发给模型的 `tools=` 列表,和 funcs 一一对应。
- `def tool(self, fn: Callable) -> Callable:` 这是一个装饰器:`@reg.tool` 写在函数上面,等于 `get_weather = reg.tool(get_weather)`。
- `hints = get_type_hints(fn, include_extras=True)` 实测拿 demo 的 get_weather 代入:`{'city': Annotated[str, "城市名,中文或英文,例如 '北京'"], 'unit': Annotated[Literal['celsius', 'fahrenheit'], '温度单位'], 'return': dict}`。`include_extras=True` 不能省:不加的话 Annotated 外壳会被剥掉,只剩 `{'city': str, 'unit': Literal[...]}`,说明文字就全丢了。
- `sig = inspect.signature(fn)` 签名里有默认值信息,类型标注里没有,所以两个都要取。
- `props, required = {}, []` 一行初始化两个变量:参数 schema 字典和必填列表。
- `for name, p in sig.parameters.items():` 依次是 `city`(实测 `p.default` 是 `inspect._empty`,表示没有默认值)和 `unit`(`p.default = 'celsius'`)。
- `props[name] = _param_schema(hints.get(name, str))` 某个参数没写类型标注的话,就默认当成 str。
- `if p.default is inspect.Parameter.empty:` 没默认值才算必填。所以 `city` 进了 required,`unit` 没进。比较用 `is` 而不是 `==`,因为 `empty` 是一个哨兵对象,要比的是「是不是同一个对象」。
- `self.funcs[fn.__name__] = fn` 用函数名当工具名,`fn.__name__` 就是 `'get_weather'`。
- `self.schemas.append({` 实测 get_weather 生成的完整 schema:`{"type": "function", "function": {"name": "get_weather", "description": "查询某个城市当前的天气(气温、天气状况、风速)。", "parameters": {"type": "object", "properties": {"city": {...}, "unit": {...}}, "required": ["city"]}}}`。和 Day 8 手写的那份结构一模一样。
- `"description": inspect.getdoc(fn) or "",` `getdoc` 会把 docstring 的缩进清理干净。函数没写 docstring 时它返回 None,`or ""` 把 None 换成空串。
- `return fn` 装饰器一定要把原函数还回去,不然 `get_weather` 这个名字会变成 None,后面就没法直接调用了。
- `def call(self, name: str, arguments: str) -> str:` 入参是模型给的两个字符串,返回值也是字符串,因为 tool 消息的 content 只能是字符串。
- `if name not in self.funcs:` 实测 `call("nope", "{}")` 返回 `{"error": "没有叫 nope 的工具,可用的有 ['get_weather', 'calculate', 'read_file']"}`。把可用列表告诉模型,它下一轮就能改对。
- `args = json.loads(arguments or "{}")` 有的模型调无参工具时 arguments 给空串,`or "{}"` 兜底。实测传半截 JSON `'{"expression": '` 会在这里抛 `JSONDecodeError`。
- `result = self.funcs[name](**args)` 实测 `call("calculate", '{"expression": "(21.5+18)/2"}')` 返回 `{"expression": "(21.5+18)/2", "result": 19.75}`。参数名写错的话(`{"expr": "1+1"}`)会在这里抛 `TypeError`。
- `except Exception as e:` 所有异常都接住,变成一条 error 交还给模型。实测四种坏输入:<br>半截 JSON → `{"error": "JSONDecodeError: Expecting value: line 1 column 16 (char 15)"}`<br>参数名写错 → `{"error": "TypeError: calculate() got an unexpected keyword argument 'expr'"}`<br>空参数 `''` → `{"error": "TypeError: calculate() missing 1 required positional argument: 'expression'"}`<br>`type(e).__name__` 取的是异常类名,比如 `'TypeError'`。
- `return json.dumps(result, ensure_ascii=False, default=str)` `default=str` 是兜底:结果里如果有 JSON 不认识的对象(datetime、Path……),就先转成字符串,不会再抛一次异常。
- `class Agent:` 把 Day 9 最小版那个 for 循环包成一个类,并把历史、用量、步数上限都管起来。
- `def __init__(self, registry: ToolRegistry, system: str, max_steps: int = 10):` 每个 Agent 带着一个注册表、一段 system 提示词和步数上限。
- `self.messages: list[Any] = [{"role": "system"` 历史从 system 消息开始,所以 demo 第 1 次请求实测发出的是 2 条(system + user)。
- `self.usage = {` 两个计数器从 0 开始,下面每一步往上加。
- `def run(self, user_input: str) -> str:` 先把用户输入追加进历史,然后进入循环。
- `for step in range(1, self.max_steps + 1):` 让 step 从 1 开始数,日志里显示的就是 `[step 1]` 而不是 `[step 0]`。
- `t0 = time.time()` 记下这一步的开始时间,完成时打印耗时。实测最后一步用了 0.8s。
- `resp = self.client.chat.completions.create(` 每一步都发完整历史。demo 实测每步发出的消息条数是 2 → 4 → 8 → 10。
- `msg = resp.choices[0].message` 下面按「有没有 tool_calls」分成两路。
- `if resp.usage:` 实测 demo 四步的 prompt_tokens 依次是 542、629、945、1038,累加过程:542 → 1171 → 2116 → 3154。completion 依次是 43、155、51、184,累加到 433。最后打印 `{'prompt_tokens': 3154, 'completion_tokens': 433}`。每一步都要重发全部历史,所以 prompt 越来越大。
- `self.messages.append(self._assistant_dict(msg))` 用手工挑过字段的字典,不用 model_dump,下面 `_assistant_dict` 里细讲。
- `if not msg.tool_calls:` 实测前三步都有 tool_calls,第 4 步没有,于是从这里返回。
- `print(f"[step {step}] 完成` `:.1f` 保留一位小数,实测打印 `[step 4] 完成 (0.8s)`。
- `return msg.content or ""` content 可能是 None,`or ""` 保证返回的一定是字符串。
- `for tc in msg.tool_calls:` 实测 step 2 一次给了 3 个调用(杭州、成都、哈尔滨),在同一步里依次执行。
- `print(f"[step {step}] 调用` 实测打印 `[step 1] 调用 read_file({"path": "cities.txt"})`。
- `out = self.registry.call(` 不管成功还是失败,拿回来的都是字符串。实测 step 3 是 `calculate({"expression": "(14.1+15.2+(-0.1))/3"})`,结果 `{"expression": "(14.1+15.2+(-0.1))/3", "result": 9.733333333333333}`。
- `print(f"           结果 {out[:120]}")` 只打印前 120 个字符,免得日志被长结果刷屏。这只影响打印,存进历史的还是完整的 `out`。
- `self.messages.append({"role": "tool"` 一个 tool_call 对应一条 tool 消息。实测 step 2 的 3 个调用追加完以后,messages 从 5 条变成 8 条。
- `return f"已达到最大步数` 循环正常走完(没有中途 return)才会到这里。返回一句说明而不是抛异常,调用方可以照常处理。
- `@staticmethod` 这个方法不用 self,只是把 SDK 的消息对象转成字典,挂在类里方便找。
- `d: dict[str, Any] = {"role": "assistant"` 只挑需要的字段。content 可能是空串:实测 step 2 返回 3 个工具调用时 content 就是 `''`。
- `if msg.tool_calls:` 有工具调用才加 tool_calls 这个 key,没调工具时消息里就只有 role 和 content,干干净净。
- `d["tool_calls"] = [tc.model_dump() for tc in msg.tool_calls]` 每个调用转成 `{"id", "function": {"name", "arguments"}, "type"}` 结构。
- `reasoning = getattr(msg, "reasoning_content", None)` `getattr(对象, 属性名, 默认值)`:属性不存在时返回默认值,不会报错。实测 demo 的 step 2 带了 reasoning_content(模型先想了一段再并行调 3 个天气),其他步没带。思考模式下带着工具调用的那一轮,思考内容要原样回传给 DeepSeek,原因 Day 8 讲过。
- `return d` 返回的字典直接追加进 messages。

</div>

挑几处细节说一下。

`_param_schema` 处理了三种情况:普通类型直接映射,`Annotated` 拆出说明文字,`Literal` 变成 enum。没覆盖的类型(比如 `list[str]` 这种带泛型的、嵌套的 pydantic 模型)一律当成 string,这是故意的简化。生产里遇到复杂参数,直接用 Day 6 学过的 pydantic 模型生成 schema 会更稳,注册表留个口子接受手写 schema 即可。

`run` 里每一轮都把 `resp.usage` 累加起来。别小看这几行,Agent 的成本特点是**每一步都要把完整历史重新发一遍**,第 1 步发 500 token,第 5 步可能已经发 5000 token。你会在练习里亲眼看到 prompt_tokens 越来越大。Day 38 讲成本优化时,这个数字就是一切的起点。

达到最大步数时我返回了一段说明文字,而不是抛异常或者返回空字符串。对调用方来说,「任务没完成」也是一个需要被优雅处理的结果。生产系统里这个分支通常会接上「转人工」或「告诉用户换个问法」。

`_assistant_dict` 手工构造 assistant 消息,只挑 role、content、tool_calls 三个字段,外加 DeepSeek 思考模式需要回传的 `reasoning_content`(Day 8 讲过原因)。比 `model_dump` 啰嗦,但不会把奇怪的字段带给别的厂商。

然后是演示脚本:

```python
# agent-60-lab/w2/day09_demo.py
from pathlib import Path
from typing import Annotated, Literal

from dotenv import load_dotenv

from w2.agent_loop import Agent, ToolRegistry
from w2.calc import calculate as _calculate
from w2.weather import get_weather as _get_weather

load_dotenv()

WORKSPACE = Path("workspace").resolve()
reg = ToolRegistry()


@reg.tool
def get_weather(
    city: Annotated[str, "城市名,中文或英文,例如 '北京'"],
    unit: Annotated[Literal["celsius", "fahrenheit"], "温度单位"] = "celsius",
) -> dict:
    """查询某个城市当前的天气(气温、天气状况、风速)。"""
    return _get_weather(city, unit)


@reg.tool
def calculate(expression: Annotated[str, "只含数字和 + - * / ** % 括号的算式,例如 '(21.5+18)/2'"]) -> dict:
    """计算一个数学表达式。涉及任何算术时都用它,不要心算。"""
    return _calculate(expression)


@reg.tool
def read_file(path: Annotated[str, "workspace 目录下的相对路径,例如 'cities.txt'"]) -> dict:
    """读取 workspace 目录里的一个文本文件,返回内容。只能读 workspace 内的文件。"""
    target = (WORKSPACE / path).resolve()
    if not target.is_relative_to(WORKSPACE):
        return {"error": "只能读取 workspace 目录内的文件"}
    if not target.exists():
        files = [p.name for p in WORKSPACE.iterdir()]
        return {"error": f"文件 {path} 不存在。workspace 里现有的文件: {files}"}
    return {"path": path, "content": target.read_text(encoding="utf-8")[:4000]}


if __name__ == "__main__":
    WORKSPACE.mkdir(exist_ok=True)
    (WORKSPACE / "cities.txt").write_text("这次出差要去的城市:\n- 杭州\n- 成都\n- 哈尔滨\n", encoding="utf-8")
    agent = Agent(reg, system="你是一个做事很仔细的中文助手。需要外部信息时调用工具;算术一律用 calculate。")
    answer = agent.run("读一下 cities.txt,查这几个城市现在的气温,告诉我平均气温和最冷的是哪个。")
    print("\n最终回答:\n", answer)
    print("token 用量:", agent.usage)
```

<div class="line-notes">

- `from pathlib import Path` 下面用 Path 处理 workspace 路径和越界检查。
- `from w2.calc import calculate as _calculate` 用 `as` 改个带下划线的名字,因为下面要定义一个同名的 `calculate` 工具去包装它,不改名就冲突了。
- `load_dotenv()` 模块一被 import 就执行。Day 10 的 plan_execute 也是靠 import 这个模块顺带加载了 `.env`。
- `WORKSPACE = Path("workspace").resolve()` 相对路径,是相对**你运行命令的目录**来算的,`.resolve()` 把它变成绝对路径。在仓库根目录运行,它就是 `.../agent-60-lab/workspace`。
- `reg = ToolRegistry()` 全局注册表。Day 10 会 `from day09_demo import reg` 复用它。
- `@reg.tool` 装饰器在**模块被 import 的时候**就执行了,所以函数定义完,schema 就已经生成好了。
- `city: Annotated[str` 实测生成 `{"type": "string", "description": "城市名,中文或英文,例如 '北京'"}`。没有默认值,进 required。
- `unit: Annotated[Literal` 实测生成 `{"type": "string", "enum": ["celsius", "fahrenheit"], "description": "温度单位"}`。有默认值,不进 required。
- `"""查询某个城市当前的天气` 这句 docstring 原封不动变成 schema 的 description。
- `return _get_weather(city, unit)` 工具本身只是一层包装,真正干活的是 Day 8 写的 weather.py。实测杭州返回 `{"city": "杭州", "country": "中国", "temperature": 14.1, "unit": "celsius", "weather": "大致晴", "wind_kmh": 6.0}`。
- `def calculate(expression` 描述里的「不要心算」很重要:模型心算小数经常算错,让它全部走工具。
- `return _calculate(expression)` 实测 `(14.1+15.2+(-0.1))/3` 得到 `9.733333333333333`。
- `def read_file(path` 正文说的「一个 10 行的工具,预演了后面三天的主题」就是它。
- `target = (WORKSPACE / path).resolve()` `/` 是 Path 的拼接运算符。`resolve()` 会把 `..` 算掉:实测传 `'../.env'` 会解析成 workspace 上一级目录里的 `.env`。
- `if not target.is_relative_to(WORKSPACE):` 「解析后还在不在 workspace 里面」。实测 `call("read_file", '{"path": "../.env"}')` 返回 `{"error": "只能读取 workspace 目录内的文件"}`,API key 没被读出去。
- `if not target.exists():` 实测传拼错的 `'city.txt'` 返回 `{"error": "文件 city.txt 不存在。workspace 里现有的文件: ['cities.txt']"}`,模型下一轮就能改成正确的文件名。
- `files = [p.name for p in WORKSPACE.iterdir()]` `iterdir()` 列出目录里的每一项,`.name` 只取文件名,不带长长的绝对路径。
- `return {"path": path, "content": target.read_text(encoding="utf-8")[:4000]}` 切片 `[:4000]` 最多取 4000 个字符。实测 cities.txt 只有 27 个字符,原样返回。
- `if __name__ == "__main__":` 被 import 时(比如 Day 10 复用 reg)不会执行下面的代码。
- `WORKSPACE.mkdir(exist_ok=True)` 目录已经存在也不报错。
- `(WORKSPACE / "cities.txt").write_text(` 每次运行都重写这个文件,保证演示数据一样:杭州、成都、哈尔滨。
- `agent = Agent(reg, system=` 「算术一律用 calculate」配合工具描述,实测模型第 3 步确实调了 calculate 来算平均气温,没有自己心算。
- `answer = agent.run(` 实测完整过程:step 1 调 read_file(content 写着「我先读取文件。」)→ step 2 一次并行调 3 个 get_weather:杭州 14.1、成都 15.2、哈尔滨 -0.1 → step 3 调 calculate 得 9.733… → step 4 完成。最终回答:平均气温约 9.7°C,最冷的是哈尔滨 -0.1°C。
- `print("token 用量:", agent.usage)` 实测 `{'prompt_tokens': 3154, 'completion_tokens': 433}`。一个 4 步的小任务,输入 token 是输出的 7 倍多,因为每一步都在重发历史。

</div>

`read_file` 这个工具值得多看两眼。它做了三件事:把路径限制在 workspace 目录内(`is_relative_to` 检查,防止模型读 `../../.ssh/id_rsa`);文件不存在时把现有文件列表告诉模型;内容截断到 4000 字符。这三件事分别对应 Day 40 的权限、Day 11 的报错设计、Day 12 的结果过长问题。一个 10 行的工具,已经把后面三天的主题都预演了一遍。

我在本机不调 API 的情况下测了注册表部分。给它一个正常参数、一个坏掉的 JSON、一个不存在的工具名、一个多余的参数,得到的结果分别是:

```text
{"city": "北京", "unit": "celsius"}
{"error": "JSONDecodeError: Expecting value: line 1 column 9 (char 8)"}
{"error": "没有叫 nope 的工具,可用的有 ['get_weather']"}
{"error": "TypeError: get_weather() got an unexpected keyword argument 'town'"}
```

四种情况程序都没有崩,每个错误都变成了模型能读懂的一句话。这就是我们想要的。

## 跑起来看看它在想什么

```bash
# 在仓库根目录(agent-60-lab/)运行,和 Day 8 一样用 -m
uv run python -m w2.day09_demo
```

`workspace/` 目录会建在你运行命令的地方,也就是仓库根目录。

日志大致长这样(具体步数和顺序每次可能不同,这正是 Agent 的特点):

```text
[step 1] 调用 read_file({"path": "cities.txt"})
           结果 {"path": "cities.txt", "content": "这次出差要去的城市:\n- 杭州\n- 成都\n- 哈尔滨\n"}
[step 2] 调用 get_weather({"city": "杭州"})
           结果 {"city": "杭州", ...}
[step 2] 调用 get_weather({"city": "成都"})
           ...
[step 2] 调用 get_weather({"city": "哈尔滨"})
           ...
[step 3] 调用 calculate({"expression": "(...+...+...)/3"})
           ...
[step 4] 完成 (2.3s)
```

注意第 2 步:模型在一轮里并行请求了三个城市的天气。它看完文件就知道三个查询互不依赖,所以一次全发出来。如果你换一个能力弱一点的模型,可能会看到它一个一个查,用 5 步而不是 3 步。这就是为什么同一段 Agent 代码换模型后成本和延迟可能差好几倍。

再注意第 3 步:因为 system prompt 里写了「算术一律用 calculate」,工具描述里也写了「不要心算」,模型老老实实调了计算器。把这两句删掉再跑,很多模型会直接心算平均数。大部分时候也算得对,但温度带一位小数时偶尔会错 0.1。这个小实验能让你体会到,**Agent 的行为是提示词、工具描述、模型能力三者共同决定的**,改其中任何一个都会改变它的路径。

## Claude Code、Codex 的内部就是这个循环

你可能每天都在用 Claude Code、Codex 或者 Cursor 的 Agent 模式写代码。现在可以揭开它们的盖子了:**它们的核心就是你刚写的这个循环**,只是工具更多、上下文管理更讲究。Claude Code 的官方文档《How Claude Code works》开篇就把它描述成一个 agentic loop:收集上下文、采取行动、验证结果,三个阶段交织进行,模型根据上一步学到的东西决定下一步,一次任务能串起几十个动作。文档还给这层外壳起了个名字叫 agentic harness:**模型负责推理,外壳负责提供工具、管理模型能看到的上下文**。你的 `agent_loop.py` 就是一个最小的 harness。

这件事和找工作直接相关。我们 2026 年 10 月抓了 305 条 Agent 岗 JD,国内有 26% 明确要求熟练使用 Claude Code、Codex、Cursor 这类 Coding Agent,有的还写明要「把控生成代码的质量」。理解了内部机制,你用它的时候就知道它在干什么、会在哪里犯错。

把它们和你的 100 行对照一下:

| Coding Agent 里的东西 | 对应你的代码 | 说明 |
| --- | --- | --- |
| 读文件、改文件、建文件 | `read_file` 这类工具 | Claude Code 的文件类工具;Codex CLI 用 shell 命令加专门的补丁工具改文件 |
| 跑 shell 命令(测试、git、构建) | 一个能执行命令的工具 | 能力最强、风险也最大的工具,所以配了权限确认 |
| 按文件名、按正则搜索代码 | 和 Day 11 的 `notes_search` 同一类 | 先搜后读,而不是把整个仓库塞进上下文 |
| 待办清单 | Day 10 的 `update_todos` | 长任务里显式写出计划并逐项勾掉 |
| 自动压缩上下文 | 我们还没做,Day 20 讲 | 文档说接近上限时先清掉旧的工具输出,不够再把对话摘要化,早期的细节指令可能丢失 |
| 子 Agent | Day 10 plan-and-execute 的执行器 | 在独立上下文里干活,只把摘要交回主对话 |
| `CLAUDE.md` / `AGENTS.md` | 你的 system prompt | 每次会话都会加载的项目说明和规则 |
| 权限模式、文件快照可回滚 | Day 12 的防线思路,Day 40 讲权限 | 写操作前确认,出错能撤销;数据库、部署这类远端操作无法回滚 |
| 跑测试看结果再改 | 工具结果回到循环 | 这就是「验证结果」阶段,也是它能自我纠错的原因 |

懂了这张表,有几个用法上的结论自然就出来了。第一,**把规则写进 CLAUDE.md 或 AGENTS.md,而不是只在对话里说一次**,因为上下文压缩时早期对话里的指令可能被摘要掉,而这两个文件每次都会重新加载。第二,**给它能验证自己的手段**:有测试、有 lint、有能跑的命令,它就能在循环里自己发现错误;什么都没有,它只能凭感觉说「改好了」。第三,**大任务拆小、或者让它先列计划**,道理和 Day 10 一样,长循环容易迷路。

更重要的是怎么审查它的产出。Coding Agent 写的代码要当成一个很快但不太了解你项目的同事提交的 MR 来审,我自己的检查清单是:

1. 先看它做了什么,再看代码:翻一遍它的工具调用记录,跑了哪些命令、改了哪些文件、有没有改到任务范围以外的地方。
2. 测试是不是被「修」过:Agent 为了让测试通过,有时会去改测试本身、加 skip、或者把断言放宽。凡是测试文件有改动,单独细看。
3. 调用的 API 和库真的存在吗:模型会编出看起来很合理的函数名和参数,尤其是版本较新的库。不熟悉的调用去查一下文档。
4. 错误处理是不是被吞了:`except Exception: pass` 这类写法能让代码「跑通」,但把问题藏了起来。
5. 有没有写进密钥、改了配置、加了不需要的依赖:看 diff 里的配置文件、`.env`、依赖清单。
6. 自己跑一遍:它说测试都过了,你本地再跑一次。它的「已验证」只是它在循环里看到的结果,环境可能和你不同。

这六条也是面试官问「你怎么保证 AI 生成代码的质量」时最好的回答素材。本课程后面的练习,鼓励你用 Coding Agent 帮忙写代码,但每一次都按这个清单审一遍,审的过程本身就是在练这项 JD 里写明的能力。

## 面试官想从这道题里看到什么

「手写一个 Agent 循环」几乎是 Agent 岗面试必考的编码题,有时候是白板,有时候是给你 30 分钟和一个 API key。循环本身太简单,拉不开差距,面试官真正在看的是下面这几处:

**你知不知道 tool 消息要用 id 对应。** 写成「把结果拼进 user 消息」能跑,但说明你没真正读过协议。

**你会不会处理工具报错。** 写了 try/except 并且把错误交还给模型的,和让程序崩掉的,是两个档次。

**你有没有步数上限。** 没写的话,面试官一定会追问「模型一直调工具不停怎么办」。

**你有没有意识到上下文会越来越长。** 能主动提到「每步都要重发整个历史,长任务要考虑截断或摘要」,是加分项。Day 20 会讲具体做法。

**你能不能讲清楚为什么不用框架。** 不是说框架不好,而是你要能说出「这个场景下框架带来了什么、隐藏了什么」。手写过一遍的人,用框架时出了问题知道去哪里找。

练习的时候,建议你关掉编辑器的补全,用纸或者纯文本编辑器写一遍最小版,计时 15 分钟。写得出来,这道题你就稳了。

## 动手练习

**练习 1:跑通并读日志。** 运行 `day09_demo.py`,把完整日志和 `agent.usage` 抄到笔记里。数一下一共几个 step、几次工具调用。

**练习 2:观察 token 增长。** 在 `run` 循环里每一步打印 `resp.usage.prompt_tokens`。你会看到它逐步变大。算一下:如果按 2026 年 10 月 DeepSeek `deepseek-flash` 高峰价(输入未命中缓存每百万 token 0.3 美元,输出 1.2 美元,[定价页](https://api-docs.deepseek.com/quick_start/pricing))计,这次任务花了多少钱?公式是 `prompt_tokens / 1e6 × 0.3 + completion_tokens / 1e6 × 1.2`。

**练习 3:让它犯错再自己改。** 把 `cities.txt` 改名成 `city_list.txt`,但用户问题里还说 `cities.txt`。观察模型拿到「文件不存在,现有文件: [...]」的报错后,会不会自己去读正确的文件。

**练习 4:逼它撞上限。** 把 `max_steps` 改成 2 再跑,看返回了什么。然后思考:撞上限时只返回一句「没完成」对用户友好吗?试着改成让模型基于已有信息给一个部分答案(提示:撞上限后再调一次模型,`tool_choice="none"`,让它总结)。

**练习 5:默写。** 合上教程,15 分钟内在空白文件里写出最小版循环(不要求注册表),能跑通「北京多少度」。

**验收标准:** 练习 1 跑通且回答里有三个城市的真实温度和正确的平均值;练习 2 能算出单次任务的花费(应该在 0.1 分人民币以下的量级,算出来差太多就检查单位);练习 3 模型能自己纠正文件名;练习 4 撞上限后用户能拿到一个有用的部分回答;练习 5 能在 15 分钟内默写出来。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| Agent 循环(agent loop) | 调模型 → 执行工具 → 回传结果 → 再调模型,直到模型不再请求工具的循环 |
| step | 循环转一圈,也就是一次模型调用加上它请求的工具执行 |
| max_steps | 最大步数上限,防止无限循环和成本失控 |
| 工具注册表(tool registry) | 保存「工具名 → 函数」映射和 schema 列表,负责分发调用 |
| 装饰器(decorator) | Python 语法 `@xxx`,在不改函数体的前提下给函数加功能,这里用来注册工具 |
| `Annotated` | `typing` 里给类型附加元数据的写法,这里用来挂参数说明 |
| `Literal` | 限定取值的类型,这里映射成 JSON Schema 的 enum |
| 自我纠正 | 模型读到工具报错后自己修正参数或换工具重试的行为 |
| prompt_tokens / completion_tokens | 输入和输出 token 数,Agent 每一步都要重新计入完整历史 |

## 常见误区

**以为 Agent 需要复杂的架构。** 「感知、规划、记忆、行动」那种四框图适合写 PPT,不适合写代码。核心就是一个循环,其他能力都是在这个循环上加的工程。先把循环写对,再谈别的。

**工具出错就抛异常。** 程序崩了,用户什么都拿不到。把错误变成工具结果交给模型,大多数错误它自己就能绕过去。只有真正无法恢复的错误(比如 API key 失效)才应该往外抛。

**不设步数上限,或者设得太大。** 模型偶尔会陷入「调同一个工具、拿到同样结果、再调一次」的死循环。没有上限,一次请求就可能跑掉几块钱。上限多少合适取决于任务,简单问答 5–10 步,复杂的研究任务可能要 30–50 步,Day 12 会讲更聪明的循环检测。

**schema 和函数签名两处维护。** 迟早不同步。用注册表从函数生成,或者反过来从 pydantic 模型生成函数参数,保证只有一个真相来源。

**觉得手写了就不用学框架。** 手写是为了理解,不是为了在生产里重复造轮子。W4 我们会学 LangGraph,那时候你会发现它的核心节点就是今天这个循环,只是多了状态持久化、中断恢复这些你自己写起来很费劲的东西。

## 学习资料

### 文档与文章

- [Thorsten Ball · How to Build an Agent](https://ampcode.com/how-to-build-an-agent):300 行 Go 写出能改代码的 Agent,强烈推荐通读一遍,1 小时。不会 Go 也能看懂,结构和我们今天的 Python 版完全对应。
- [Simon Willison · Designing agentic loops](https://simonwillison.net/2025/Sep/30/designing-agentic-loops/):Agent 的定义、什么任务适合交给循环、跑「全自动模式」时怎么用沙箱和受限凭证保护自己,30 分钟。
- [Anthropic · Building effective agents](https://www.anthropic.com/engineering/building-effective-agents):先只读最后「Agents」那一节,看 Anthropic 怎么描述同一个循环,Day 13 会通读全文,20 分钟。
- [Claude Code 文档 · How Claude Code works](https://code.claude.com/docs/en/how-claude-code-works):官方讲 Claude Code 的 agentic loop、五类内置工具、上下文满了怎么压缩、权限和回滚,读完对照上面那张表,30 分钟。
- [Anthropic · Claude Code best practices](https://www.anthropic.com/engineering/claude-code-best-practices):怎么写 CLAUDE.md、怎么让它先计划再动手、怎么给它验证手段,用 Coding Agent 之前必读,30 分钟。
- [Lilian Weng · LLM Powered Autonomous Agents](https://lilianweng.github.io/posts/2023-06-23-agent/):2023 年的经典综述,框图式的讲法从这里流行起来。读完对比一下它和今天的「一个循环」视角,1 小时。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1TSg7zuEqR&autoplay=0&high_quality=1" title="Agent 的概念、原理与构建模式 —— 从零打造一个简化版的 Claude Code" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>马克的技术工作坊 · Agent 的概念、原理与构建模式,从零打造一个简化版的 Claude Code · 28 分钟,B 站播放近 60 万。前半段讲 Agent 循环,后半段手写代码,和今天的内容几乎一一对应,强烈推荐。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV19JdzBMESc&autoplay=0&high_quality=1" title="从零实现自己的agent第二期: 百行代码从零手搓agent" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>小单说AI · 从零实现自己的agent第二期:百行代码从零手搓agent · 10 分钟,短小直接,适合做完练习 5 后对照看自己漏了什么。</figcaption>
</figure>

- onedayhigh《从零手搓一个Agent,看完你也会》(BV1CWee6WEYf,24 分钟):另一种手搓写法,可以对比不同人的代码组织方式。

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/Q3Gb7Rjre3U" title="How AI Agents Actually Work (Explained in One Python File)" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Dave Ebbelaar · How AI Agents Actually Work (Explained in One Python File) · 用一个 Python 文件讲完 Agent 的全部原理,和今天的写法风格接近。</figcaption>
</figure>

- Hugging Face · Alejandro AO《Intro to Agents - Create an Agent from Scratch (No Frameworks)》(YouTube `vHDwpoSFdQY`):Hugging Face 官方出品,也是不用框架手写,作为补充。
- [Hugging Face Agents Course](https://huggingface.co/learn/agents-course):免费的系统课程,第 1 单元讲的就是 Thought-Action-Observation 循环,可以当作这周的课外读物。

### 书籍

- Chip Huyen《AI Engineering》(O'Reilly, 2025):第 6 章 Agents 部分的「Agent Overview」一节(原书约 276 页),对 Agent 的定义和今天的一致:规划一个做法,然后在循环里调用工具直到达成目标。
- Jay Alammar、Maarten Grootendorst《Hands-On Large Language Models》(O'Reilly, 2024):第 7 章「Advanced Text Generation Techniques and Tools」后半部分讲 Agent,配套 Colab 笔记本在[官方仓库](https://github.com/HandsOnLLM/Hands-On-Large-Language-Models)里。

### 开源项目与代码

- [datawhalechina/hello-agents · 第七章 构建你的 Agent 框架](https://github.com/datawhalechina/hello-agents/tree/main/docs/chapter7):Datawhale 的中文开源教程,这一章从零写一个小框架,比今天的代码走得更远,适合周末延伸。
- [huggingface/smolagents](https://github.com/huggingface/smolagents):Hugging Face 的极简 Agent 库,核心代码不多,读它的 `agents.py` 看别人怎么组织同一个循环。
- [openai/codex](https://github.com/openai/codex):OpenAI 开源的 Codex CLI,一个生产级的 Coding Agent。不用通读,找到它组织工具调用循环和沙箱的地方看一眼,你会认出今天的骨架。它读取的项目说明文件格式见 [agents.md](https://agents.md/)。

## 自测

1. 不看代码,说出 Agent 循环的四个步骤和唯一的退出条件。

<details><summary>答案</summary>

四步:把 messages 和 tools 发给模型;拿到响应,把 assistant 消息追加进历史;如果有 tool_calls,逐个执行并把结果作为 tool 消息追加;回到第一步。正常退出条件是模型这一轮没有 tool_calls(它认为可以回答了)。另外还有一个兜底退出:达到最大步数。

</details>

2. 工具执行时抛了异常,注册表为什么不直接 raise,而要返回 `{"error": ...}`?

<details><summary>答案</summary>

因为模型能根据报错自我纠正:参数写错了它会重写,工具名错了会换,文件名错了会根据提示选对的。直接 raise 会让整个任务失败,剥夺了纠错的机会。只有无法恢复的系统性错误(凭证失效、服务整体宕机)才应该往外抛。

</details>

3. 为什么 Agent 第 5 步的 prompt_tokens 比第 1 步多很多?这对成本意味着什么?

<details><summary>答案</summary>

API 无状态,每一步都要把从 system 到最近一次工具结果的完整历史重新发一遍,工具结果越多历史越长。总输入 token 大致随步数平方级增长(每一步发的量线性增加,累加起来是平方)。所以长任务的成本主要花在反复发送的历史上,这也是 prompt caching 和上下文压缩有价值的原因。

</details>

4. 注册表把 `Literal["celsius", "fahrenheit"]` 映射成了什么?为什么用 enum 比在描述里写「只能填 celsius 或 fahrenheit」更好?

<details><summary>答案</summary>

映射成 `{"type": "string", "enum": ["celsius", "fahrenheit"]}`。enum 是结构化约束,模型在生成参数时更容易遵守,开了 strict 模式的厂商还会在服务端强制;写在描述里只是自然语言提示,模型偶尔会填 "C" 或 "摄氏度"。

</details>

5. (面试题)「请手写一个最简单的 Agent,并说说它在生产环境里还缺什么。」

<details><summary>答案</summary>

代码部分写出 for 循环版本:调模型、判断 tool_calls、执行、用 tool_call_id 回传、无工具调用时返回。生产里还缺:工具报错和参数解析失败的处理;最大步数和预算上限;超时与重试;循环检测;上下文过长时的截断或摘要;日志和 tracing;敏感操作的人工确认;并发执行无依赖的工具;对工具输入的权限校验。能按「可靠性、成本、安全、可观测」分组讲出来就很好。

</details>

6. (面试题)「你平时用 Claude Code 或 Cursor 写代码吗?你怎么保证它生成的代码质量?」

<details><summary>答案</summary>

先讲原理:它是一个模型加工具的循环,会读文件、改文件、跑命令、根据结果再改,长对话会压缩上下文。所以用法上要把规则写进 CLAUDE.md/AGENTS.md、给它测试和 lint 让它能自我验证、大任务拆小或先出计划。审查上:看工具调用记录和改动范围;重点看测试文件有没有被改松;核实不熟悉的 API 是否存在;检查被吞掉的异常、密钥和多余依赖;本地重新跑测试。能举一个你发现它出错的具体例子更好。

</details>

## 明天预告

今天的循环里,模型「想」的过程是隐藏的:它直接给出工具调用,我们看不到它为什么这么选。明天(Day 10)讲 **ReAct 与规划**:先看 2022 年那篇让模型把 Thought、Action、Observation 写出来的论文,用纯提示词实现一次 ReAct;再看原生 function calling 时代 ReAct 变成了什么,以及 plan-and-execute、todo list 这些让 Agent「先想再做」的办法。
