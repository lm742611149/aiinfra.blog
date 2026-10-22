---
title: 'Day 507 · 面试(五):10 分钟手写 Agent 循环'
description: '现场编码题:空白编辑器、10 分钟、写一个能跑的 Agent 循环。48 行参考答案实跑,一个不花钱的判卷脚本(7 条用例,假客户端用真的 SDK 类型),一个「十分钟里最常见写法」只拿 3/7 并且被 DeepSeek 400 拒掉;最后是加强题:并行、每个工具 3 秒超时、重复调用检测。'
pubDate: 2026-10-22
regime: none
tags: ['interview', 'live-coding', 'agent-loop', 'python', 'agent-zero']
series: 'agent-zero'
day: 507
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 506](/blog/agent-zero/day-506-interview-4/) 刷完了第四套题,MCP、Skills、评测、安全和工程化。到那天为止,四套题 64 道都进了 `part09/interview/` 和你的答题日志,`weak.py` 会告诉你哪几道要回炉。几个能直接拿去答题的数:5 张工单各跑 6 次,pass@3 是 0.90、pass^3 是 0.80;LLM 评委交换顺序后 4 组里 2 组改判;注入 20 次 0 成功,只能说明真实成功率大概率低于 14%。

前四天是「说」的面试。今天换成「写」:很多 Agent 岗的技术面会留 10 到 15 分钟让你在空白编辑器里现场写一个 Agent 循环。你在第三部分 [Day 166](/blog/agent-zero/day-166-agent-min/) 写过 25 行的最小循环,[Day 170](/blog/agent-zero/day-170-agent-full/) 写过 100 行的完整版,东西都学过。今天练的是另一种能力:没有自动补全、没有文章可抄、有人盯着、时间只有 10 分钟。

## 今天要解决的问题

学完今天,你应该能做到:

1. 不看任何资料,10 分钟内写出一个能跑的 Agent 循环,包含步数上限、工具不存在和参数错误的处理、工具结果按 `tool_call_id` 回填。
2. 用一个不花钱的判卷脚本给自己的手写版打分,知道每条用例在防什么错。
3. 在这个循环上现场加三个需求:同一轮的工具并行执行、每个工具有超时、同一个调用重复 3 次就停,并能说清每个改动的理由。
4. 写完以后主动补三句话:超时、成本上限、tracing,以及「`asyncio.timeout` 管不住同步阻塞代码」这个坑。

预计用时 2.5 小时。前置:[Day 166](/blog/agent-zero/day-166-agent-min/)、[Day 170](/blog/agent-zero/day-170-agent-full/) 的 Agent 循环;[Day 161](/blog/agent-zero/day-161-missing-result/) 漏回 tool 消息;[Day 162](/blog/agent-zero/day-162-parallel-tools/) 并行工具调用;[Day 192](/blog/agent-zero/day-192-failures-4/) 循环检测;[Day 392](/blog/agent-zero/day-392-timeouts/) 的 `asyncio.timeout`;[Day 505](/blog/agent-zero/day-505-interview-3/) 实验三的重复检测。

学法提示:先对照文章逐行敲一遍(不复制粘贴)并跑通;第二天合上文章,计时 10 分钟默写 `mini_agent.py` 的 `run`,用判卷脚本打分;做练习,做不出再展开参考答案,看完关掉重写一遍。

## 面试官在这 10 分钟里看什么

先说清楚这道题考什么,不然你会把时间花在不得分的地方。

面试官给的题面通常就一句话:「不用框架,写一个能调工具的 Agent,工具你随便编一个。」允许用你最熟的语言,允许查 SDK 的参数名(有的面试官会直接告诉你),不允许用 LangChain、LangGraph 这种现成的 agent。它和 LeetCode 那种算法题不一样,没有巧妙解法,得分点全在「你有没有生产意识」。我把能看到的得分点列成一张表,前五条是必须有的,后三条是加分:

| 得分点 | 少了会怎样 | 对应哪天 |
| --- | --- | --- |
| 循环:模型要调工具就执行,不调就返回 | 只能做一轮,不叫 Agent | [Day 165](/blog/agent-zero/day-165-agent-what/) |
| assistant 消息原样放回历史 | 下一轮请求直接 400 | [Day 159](/blog/agent-zero/day-159-tool-roundtrip/) |
| 工具结果带 `tool_call_id` | 模型对不上哪个结果是哪个调用,接口也会报错 | [Day 161](/blog/agent-zero/day-161-missing-result/) |
| 工具出错不崩,把错误当结果交回模型 | 一个错参数整个循环挂掉 | [Day 189](/blog/agent-zero/day-189-failures-1/) |
| 步数上限 | 模型一直要调工具就一直转,一直花钱 | [Day 192](/blog/agent-zero/day-192-failures-4/) |
| 工具结果截断 | 一个工具返回 500 条记录,把上下文撑爆 | [Day 191](/blog/agent-zero/day-191-failures-3/) |
| 「工具不存在」和「工具内部报错」分开报 | 模型以为工具没了,换着名字乱猜 | [Day 182](/blog/agent-zero/day-182-tool-design-2/) |
| 写完主动说超时、成本、tracing | 显得只会写 demo | [Day 392](/blog/agent-zero/day-392-timeouts/) |

很多人前五条只写出三条,通常漏的是第二条和第五条。第二条漏了跑不起来,第五条漏了跑得起来,但面试官一问「模型一直调工具怎么办」,你就只能现场改。

10 分钟怎么分,我自己练下来是这样:

<figure>
<svg viewBox="0 0 640 200" role="img" aria-label="10 分钟手写 Agent 循环的时间分配:1 分钟说骨架,2 分钟写工具表,4 分钟写循环主体,2 分钟写错误处理和上限,1 分钟跑一次并补充三句话">
  <rect x="0" y="0" width="640" height="200" fill="var(--paper-raised)"/>
  <text x="20" y="26" font-family="var(--font-mono)" font-size="12" fill="var(--ink-soft)">0 分                                                              10 分</text>
  <rect x="20" y="40" width="60" height="50" fill="var(--mem-wash)" stroke="var(--mem)"/>
  <text x="28" y="62" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">说骨架</text>
  <text x="28" y="80" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">1 分</text>
  <rect x="80" y="40" width="120" height="50" fill="var(--compute-wash)" stroke="var(--compute)"/>
  <text x="88" y="62" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">工具表 + 消息</text>
  <text x="88" y="80" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">2 分</text>
  <rect x="200" y="40" width="240" height="50" fill="var(--mem-wash)" stroke="var(--mem)"/>
  <text x="208" y="62" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">循环主体:调模型、放回、执行、回填</text>
  <text x="208" y="80" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">4 分</text>
  <rect x="440" y="40" width="120" height="50" fill="var(--compute-wash)" stroke="var(--compute)"/>
  <text x="448" y="62" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">错误 + 上限</text>
  <text x="448" y="80" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">2 分</text>
  <rect x="560" y="40" width="60" height="50" fill="var(--mem-wash)" stroke="var(--mem)"/>
  <text x="566" y="62" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">跑+讲</text>
  <text x="566" y="80" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">1 分</text>
  <text x="20" y="124" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">先写能跑的最短路径(循环主体),再补保护;顺序反过来,时间到了可能还跑不起来</text>
  <text x="20" y="146" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">边写边说:「这一行是为了……」,沉默写 10 分钟,面试官看不到你的判断</text>
  <text x="20" y="176" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">蓝色是「能跑」,琥珀色是「跑得住」;两类都要有</text>
</svg>
<figcaption>10 分钟的分配。最大的一块留给循环主体;错误处理和步数上限是最后两分钟补,但必须补。</figcaption>
</figure>

## 第一步:动手之前,先出声说骨架

面试官说完题,别急着敲键盘。用一分钟把骨架说出来,大概是这样五句话:

「我先准备一个工具表,名字对应函数和给模型看的 schema。循环里每一圈调一次模型,把它的回复原样加回历史。回复里没有工具调用,就把文字当结果返回。有工具调用,就逐个执行,结果按 `tool_call_id` 作为 tool 消息加回去,再转下一圈。最外面是一个步数上限,到了就转人工。」

这一分钟有两个用处。一是面试官能马上判断你思路对不对,不对的话他会提醒你,不至于写了 8 分钟才发现方向错了。二是这五句话就是你接下来的代码结构,一句对应几行,写的时候不会乱。

说完骨架再写,写的时候每写一块就说一句「这一行是为了什么」。沉默着写完 10 分钟,哪怕代码全对,面试官也只看到了结果,看不到你的判断。

## 第二步:参考答案,48 行

先建今天的目录。在 `agent-zero-lab/` 下:

```bash
cd agent-zero-lab
mkdir -p part09/live
touch part09/live/__init__.py
```

不用新装依赖:`openai` 和 `python-dotenv` 第二部分就装过了。`.env` 里的 `LLM_BASE_URL`、`LLM_API_KEY`、`LLM_MODEL` 还是 DeepSeek 那三行(2026 年 10 月我用的模型名是 `deepseek-flash`)。

下面是参考答案。注意它**没有**用我们自己的 `common/llm.py`:面试官的电脑上没有你的 `LLMClient`,现场能依赖的只有官方 SDK,所以直接用 `openai`。

```python
# agent-zero-lab/part09/live/mini_agent.py
import json
import os

from dotenv import load_dotenv
from openai import OpenAI

TEMPS = {"北京": 4.5, "上海": 16.2}


def get_temp(city: str) -> dict:
    return {"city": city, "temp_c": TEMPS[city]}


TOOLS = {
    "get_temp": (get_temp, {"type": "function", "function": {
        "name": "get_temp", "description": "查城市当前气温(摄氏度)",
        "parameters": {"type": "object", "properties": {"city": {"type": "string"}}, "required": ["city"]}}}),
}


def run(client, model: str, user_msg: str, tools: dict, max_steps: int = 8) -> str:
    messages = [{"role": "user", "content": user_msg}]
    specs = [spec for _, spec in tools.values()]
    for _ in range(max_steps):
        resp = client.chat.completions.create(model=model, messages=messages, tools=specs)
        msg = resp.choices[0].message
        messages.append(msg.model_dump(exclude_none=True))
        if not msg.tool_calls:
            return msg.content or ""
        for call in msg.tool_calls:
            name = call.function.name
            try:
                fn, _ = tools[name]
            except KeyError:
                result = {"error": f"没有名为 {name} 的工具,可用的有 {sorted(tools)}"}
            else:
                try:
                    result = fn(**json.loads(call.function.arguments))
                except Exception as e:
                    result = {"error": f"{type(e).__name__}: {e}"}
            messages.append({"role": "tool", "tool_call_id": call.id,
                             "content": json.dumps(result, ensure_ascii=False)[:4000]})
    return "步数超限,已转人工"


if __name__ == "__main__":
    load_dotenv()
    client = OpenAI(base_url=os.environ["LLM_BASE_URL"], api_key=os.environ["LLM_API_KEY"])
    print(run(client, os.environ["LLM_MODEL"], "北京和上海哪个更冷?差几度?", TOOLS))
```

<div class="line-notes">

- `TEMPS = {"北京": 4.5, "上海": 16.2}` 面试时别去接真的天气接口,网络一抖你的 10 分钟就没了。一个字典假装数据源,面试官要的是循环,不是天气。
- `def get_temp(city: str) -> dict:` 工具就是一个普通函数。字典里没有的城市会抛 `KeyError`,这一点后面判卷时有用:它是「工具内部报错」,不是「工具不存在」。
- `TOOLS = {` 工具表:名字对应一个二元组 `(Python 函数, 给模型看的 schema)`。一份给代码调,一份给模型看,和 [Day 168](/blog/agent-zero/day-168-tool-registry-1/) 的注册表是同一个想法,只是没写装饰器。面试时装饰器多花一分钟,可以说一句「正式代码里我会用装饰器自动生成 schema」,不用真写。
- `"parameters": {"type": "object", "properties": {"city": {"type": "string"}}, "required": ["city"]}}}),` 参数定义是 JSON Schema,[Day 157](/blog/agent-zero/day-157-tool-schema/) 讲过。面试时 description 写短就行,但别省掉 `required`。
- `def run(client, model: str, user_msg: str, tools: dict, max_steps: int = 8) -> str:` client 和 tools 都从参数传进来,而不是在函数里自己建。这样判卷脚本能塞一个假客户端和自己的工具进来测,这就是 [Day 459](/blog/agent-zero/day-459-flow-di/) 的依赖注入。面试时这样写还能顺口说一句「方便单测」,是加分项。
- `messages = [{"role": "user", "content": user_msg}]` 历史从一条用户消息开始。实跑问的是「北京和上海哪个更冷?差几度?」。
- `specs = [spec for _, spec in tools.values()]` 只把 schema 列表发给模型。`_` 表示这个位置的值(Python 函数)用不上,和 JS 解构里 `const [, spec] = pair` 跳过第一个一样。
- `for _ in range(max_steps):` 步数上限,默认 8 圈。用 `for` 而不是 `while True`,上限就写在循环头上,忘不了。
- `resp = client.chat.completions.create(model=model, messages=messages, tools=specs)` 每圈调一次模型。实跑第 1 圈只发了 1 条消息,模型一次返回两个调用:查北京、查上海。
- `messages.append(msg.model_dump(exclude_none=True))` 把模型的回复**原样**加回历史。`model_dump` 把 SDK 对象转成 dict,`exclude_none` 去掉值为 None 的字段。原样很重要:里面有 `tool_calls`,DeepSeek 返回思考内容时还有 `reasoning_content`,[Day 163](/blog/agent-zero/day-163-tool-choice/) 讲过思考模式下这段要传回去。漏了这一行会怎样,第五步会实跑一次。
- `if not msg.tool_calls:` 模型不再调工具,就把它的文字当最终答案。这是循环正常结束的唯一出口。
- `return msg.content or ""` `content` 可能是 None,`or ""` 保证返回字符串,和 JS 的 `msg.content ?? ""` 差不多(严格说 `or` 对空字符串也生效,像 `||`)。
- `for call in msg.tool_calls:` 同一轮可能有多个调用,逐个执行。实跑这一轮有两个。并行版在第七步。
- `try:` 这个 `try` 只包「按名字找工具」这一行。这是整段代码里最容易写错的地方,第五步专门演示。
- `except KeyError:` 字典里没有这个名字,说明模型调了一个不存在的工具。
- `result = {"error": f"没有名为 {name} 的工具,可用的有 {sorted(tools)}"}` 报错里列出可用的工具名,模型基本一次就能改对,这是 [Day 504](/blog/agent-zero/day-504-interview-2/) 实验二验证过的。
- `else:` `try/except/else`:`try` 里没出异常才走 `else`,也就是工具找到了才执行。工具自己内部抛的 `KeyError`(比如查「拉萨」)就不会被误报成「没有这个工具」。
- `result = fn(**json.loads(call.function.arguments))` 模型给的参数是 JSON 字符串,解析成 dict 再用 `**` 展开成关键字参数:`{"city": "北京"}` 变成 `get_temp(city="北京")`,返回 `{"city": "北京", "temp_c": 4.5}`。相当于 JS 里 `fn(JSON.parse(args))`,只是 Python 要展开成具名参数。
- `except Exception as e:` 参数名写错(`TypeError`)、JSON 只写了一半(`JSONDecodeError`)、工具自己报错,都在这里接住,变成一条错误结果交给模型,循环不崩。
- `messages.append({"role": "tool", "tool_call_id": call.id,` 每个结果带上对应调用的 id。实跑 DeepSeek 给的 id 形如 `call_00_` 开头的一串。模型靠 id 对结果,不靠顺序。
- `"content": json.dumps(result, ensure_ascii=False)[:4000]})` `ensure_ascii=False` 让中文原样输出,省 token;`[:4000]` 截断超长结果。截断按字符数,粗糙但 10 分钟里够用,面试时说一句「正式代码我会按 token 截,并告诉模型被截了」。
- `return "步数超限,已转人工"` 8 圈都用完还没答完,不硬撑,转人工。
- `client = OpenAI(base_url=os.environ["LLM_BASE_URL"], api_key=os.environ["LLM_API_KEY"])` 走 OpenAI 兼容协议连 DeepSeek。面试时如果对方给的是 OpenAI 的 key,写 `OpenAI()` 就行,SDK 会自己读 `OPENAI_API_KEY`。

</div>

运行:

```bash
uv run python -m part09.live.mini_agent
```

```text
**北京更冷。**

- 北京：4.5°C
- 上海：16.2°C

北京比上海低 **11.7°C**。

注：这只是当前气温对比；如果考虑体感，北方风力大、湿度低，南方湿冷穿透力强，感受可能和数字不完全一致。
```

能跑。最后那句「注」是模型自己加的,每次跑都不一样,你跑出来大概率没有这句。

48 行,其中真正的循环 `run` 是 25 行。面试时你写的大概就是 `run` 加一个工具,`if __name__` 那几行能省则省。

## 第三步:看它每一圈发了什么

光看最终答案,你看不到循环转了几圈。面试官很可能接着问「这个问题模型调了几次?每次发了几条消息?」,我们把它跑出来。

办法是给客户端包一层:做一个假的 `client`,它也有 `chat.completions.create`,内部转给真客户端,顺便打印一行。`run` 只认「有 `chat.completions.create` 这个方法的东西」,不关心你到底是不是 `OpenAI`,所以包一层它完全察觉不到。这和前端在 `fetch` 外面包一层打日志是一回事。

```python
# agent-zero-lab/part09/live/spy.py
import time


class Spy:
    """包住 OpenAI 客户端:每次调模型打印一行,并累计 token。"""

    def __init__(self, client) -> None:
        self.client = client
        self.chat = self
        self.completions = self
        self.calls = 0
        self.prompt_tokens = 0
        self.completion_tokens = 0
        self.t0 = time.perf_counter()

    def create(self, **kw):
        resp = self.client.chat.completions.create(**kw)
        self.calls += 1
        u = resp.usage
        self.prompt_tokens += u.prompt_tokens
        self.completion_tokens += u.completion_tokens
        msg = resp.choices[0].message
        calls = [f"{c.function.name}({c.function.arguments})" for c in msg.tool_calls or []]
        think = "有" if getattr(msg, "reasoning_content", None) else "无"
        print(f"[{time.perf_counter() - self.t0:5.2f}s] 第 {self.calls} 次 发 {len(kw['messages'])} 条"
              f" | 用量 {u.prompt_tokens}/{u.completion_tokens} | 思考 {think} | 调用 {calls or '无'}")
        return resp
```

<div class="line-notes">

- `self.chat = self` 这两行是整个技巧的关键。`run` 里写的是 `client.chat.completions.create(...)`,我们让 `chat` 和 `completions` 都指向自己,于是 `spy.chat.completions.create` 就等于 `spy.create`。
- `def create(self, **kw):` `**kw` 收下所有关键字参数(model、messages、tools),原样转给真客户端。相当于 JS 的 `create(...args)` 再 `real.create(...args)`。
- `u = resp.usage` 每次响应都带用量,`prompt_tokens` 是输入,`completion_tokens` 是输出。
- `calls = [f"{c.function.name}({c.function.arguments})" for c in msg.tool_calls or []]` `msg.tool_calls or []`:没有工具调用时是 None,换成空列表才能遍历。
- `think = "有" if getattr(msg, "reasoning_content", None) else "无"` DeepSeek 的回复对象上可能多一个 `reasoning_content` 字段。`getattr(对象, 名字, 默认值)` 取不到就用默认值,不会报错,和 JS 的可选链 `msg?.reasoning_content` 一个作用。
- `print(f"[{time.perf_counter() - self.t0:5.2f}s] 第 {self.calls} 次 发 {len(kw['messages'])} 条"` 打印从创建 Spy 起过了几秒、这是第几次、这次发了几条消息。

</div>

再写一个运行脚本,用 Spy 包住真客户端:

```python
# agent-zero-lab/part09/live/run_spy.py
import os

from dotenv import load_dotenv
from openai import OpenAI

from part09.live.mini_agent import TOOLS, run
from part09.live.spy import Spy

load_dotenv()
client = Spy(OpenAI(base_url=os.environ["LLM_BASE_URL"], api_key=os.environ["LLM_API_KEY"]))
print(run(client, os.environ["LLM_MODEL"], "北京和上海哪个更冷?差几度?", TOOLS))
print(f"合计 {client.calls} 次,输入 {client.prompt_tokens} / 输出 {client.completion_tokens} tokens")
```

<div class="line-notes">

- `from part09.live.mini_agent import TOOLS, run` 复用参考答案。`mini_agent.py` 的运行部分在 `if __name__` 下面,import 时不会执行。
- `client = Spy(OpenAI(base_url=os.environ["LLM_BASE_URL"], api_key=os.environ["LLM_API_KEY"]))` 真客户端外面套一层 Spy,交给 `run` 的是 Spy。`run` 一行都不用改。

</div>

```bash
uv run python -m part09.live.run_spy
```

```text
[ 1.31s] 第 1 次 发 1 条 | 用量 299/73 | 思考 无 | 调用 ['get_temp({"city": "北京"})', 'get_temp({"city": "上海"})']
[ 2.01s] 第 2 次 发 4 条 | 用量 420/67 | 思考 有 | 调用 无
当前的实时气温如下：

- **北京**：4.5 °C
- **上海**：16.2 °C

所以**北京更冷**，比上海低 **11.7 °C**。
合计 2 次,输入 719 / 输出 140 tokens
```

把这两行读懂,就能回答面试官的追问:

- 第 1 次只发了 1 条消息(用户问题),模型在**同一轮**里返回了两个调用。所以循环只转了两圈,不是三圈。
- 第 2 次发了 4 条:user、assistant(带两个 tool_calls)、两条 tool。这就是 `messages.append(msg.model_dump(...))` 加上两次 `messages.append({"role": "tool", ...})` 的结果。
- 第 2 次的输入 420 比第 1 次的 299 多了 121 个 token,多出来的就是那条 assistant 消息和两条工具结果。循环每转一圈,输入都会变长,这就是为什么步数上限也是成本上限。
- 第 2 次「思考 有」:这一次 DeepSeek 返回了一小段 `reasoning_content`。我的 `.env` 没给这个脚本传关思考的参数,模型有时会带一段。它被 `model_dump` 原样放回了历史,如果下一轮还要调工具,这段会跟着传回去。

花费:2026 年 10 月 22 日晚上 7 点跑的,DeepSeek 这个时段是空闲价,未命中输入 1 元、输出 4 元每百万 token。719 × 1 / 1,000,000 + 140 × 4 / 1,000,000 ≈ ¥0.0013。工作日白天高峰价翻倍,约 ¥0.0026。

## 第四步:一个不花钱的判卷脚本

自己练手写,最大的问题是不知道写得对不对。跑一次真模型只能看到「这次碰巧对了」,看不到那些这次没触发的分支:工具不存在、参数坏了、步数上限。我们写一个判卷脚本,用假客户端把每种情况都喂一遍。

假客户端怎么做?它要返回和真 SDK 一模一样的对象,否则 `msg.tool_calls`、`call.function.name` 这些写法测不出来。好在 openai SDK 的响应类型都是 pydantic 模型,可以从一个 dict 直接造出来:`ChatCompletion.model_validate({...})`。造出来的就是真的 `ChatCompletion` 类型,只是内容是我们写死的。这和 [Day 193](/blog/agent-zero/day-193-failures-5/) 用假模型离线测失败模式是一个思路。

```python
# agent-zero-lab/part09/live/check_loop.py
import copy
import importlib
import sys
from collections.abc import Sequence

from openai.types.chat import ChatCompletion


def reply(text: str | None = None, calls: Sequence[tuple[str, str, str]] = ()) -> ChatCompletion:
    tool_calls = [{"id": i, "type": "function", "function": {"name": n, "arguments": a}} for i, n, a in calls]
    msg = {"role": "assistant", "content": text, **({"tool_calls": tool_calls} if tool_calls else {})}
    return ChatCompletion.model_validate({
        "id": "fake", "object": "chat.completion", "created": 0, "model": "fake",
        "choices": [{"index": 0, "finish_reason": "tool_calls" if calls else "stop", "message": msg}]})


class FakeClient:
    def __init__(self, script: list[ChatCompletion], repeat_last: bool = False) -> None:
        self.script, self.repeat_last, self.sent = script, repeat_last, []
        self.chat = self.completions = self

    def create(self, **kw) -> ChatCompletion:
        self.sent.append(copy.deepcopy(kw["messages"]))
        if len(self.sent) > 20:
            raise RuntimeError("调了 20 次模型还没停,是不是没有步数上限?")
        if self.repeat_last and len(self.sent) > len(self.script):
            return self.script[-1]
        return self.script[len(self.sent) - 1]


def get_temp(city: str) -> dict:
    return {"city": city, "temp_c": {"北京": 4.5}[city]}


TOOLS = {"get_temp": (get_temp, {"type": "function", "function": {"name": "get_temp", "parameters": {}}})}
B = '{"city": "北京"}'


def tool_msgs(client: FakeClient) -> list[dict]:
    return [m for m in client.sent[-1] if m["role"] == "tool"]


def case_direct(run):
    c = FakeClient([reply("你好")])
    return run(c, "m", "hi", TOOLS) == "你好" and len(c.sent) == 1


def case_one_tool(run):
    c = FakeClient([reply(calls=[("c1", "get_temp", B)]), reply("北京 4.5 度")])
    out = run(c, "m", "北京几度", TOOLS)
    roles = [m["role"] for m in c.sent[1]]
    t = tool_msgs(c)
    return out == "北京 4.5 度" and roles == ["user", "assistant", "tool"] and t[0]["tool_call_id"] == "c1" and "4.5" in t[0]["content"]


def case_two_ids(run):
    c = FakeClient([reply(calls=[("c1", "get_temp", B), ("c2", "get_temp", B)]), reply("好")])
    run(c, "m", "q", TOOLS)
    return [m["tool_call_id"] for m in tool_msgs(c)] == ["c1", "c2"]


def case_unknown_tool(run):
    c = FakeClient([reply(calls=[("c1", "get_weather", B)]), reply("换个工具")])
    out = run(c, "m", "q", TOOLS)
    return out == "换个工具" and "error" in tool_msgs(c)[0]["content"]


def case_bad_json(run):
    c = FakeClient([reply(calls=[("c1", "get_temp", '{"city":')]), reply("参数错了")])
    out = run(c, "m", "q", TOOLS)
    return out == "参数错了" and "JSONDecodeError" in tool_msgs(c)[0]["content"]


def case_tool_keyerror(run):
    c = FakeClient([reply(calls=[("c1", "get_temp", '{"city": "拉萨"}')]), reply("没有拉萨的数据")])
    run(c, "m", "q", TOOLS)
    return "拉萨" in tool_msgs(c)[0]["content"]


def case_step_limit(run):
    c = FakeClient([reply(calls=[("c1", "get_temp", B)])], repeat_last=True)
    out = run(c, "m", "q", TOOLS, max_steps=3)
    return isinstance(out, str) and len(c.sent) == 3


CASES = [case_direct, case_one_tool, case_two_ids, case_unknown_tool, case_bad_json, case_tool_keyerror, case_step_limit]

if __name__ == "__main__":
    run = importlib.import_module(sys.argv[1]).run
    passed = 0
    for case in CASES:
        try:
            ok = bool(case(run))
            why = ""
        except Exception as e:
            ok, why = False, f"  ← {type(e).__name__}: {e}"
        passed += ok
        print(f"{'通过' if ok else '没过'}  {case.__name__}{why}")
    print(f"{passed}/{len(CASES)}")
```

<div class="line-notes">

- `from openai.types.chat import ChatCompletion` SDK 里「一次聊天响应」的类型,真客户端返回的就是它。
- `def reply(text: str | None = None, calls: Sequence[tuple[str, str, str]] = ()) -> ChatCompletion:` 造一个假回复:要么只有文字,要么带几个工具调用,每个调用是 `(id, 工具名, 参数字符串)`。`Sequence` 表示「列表或元组都行」,默认值用空元组 `()` 而不用 `[]`,因为默认值是所有调用共享的,用可变的列表当默认值是 Python 的老坑。
- `tool_calls = [{"id": i, "type": "function", "function": {"name": n, "arguments": a}} for i, n, a in calls]` 按 OpenAI 协议的格式拼出 tool_calls。`for i, n, a in calls` 把三元组拆成三个变量,和 JS 的 `for (const [i, n, a] of calls)` 一样。
- `msg = {"role": "assistant", "content": text, **({"tool_calls": tool_calls} if tool_calls else {})}` 有调用才加 `tool_calls` 这个键。`**{...}` 把一个字典展开合并进来,相当于 JS 的 `...(cond ? {tool_calls} : {})`。
- `return ChatCompletion.model_validate({` 用 pydantic 从 dict 造出真的 SDK 对象。这样 `resp.choices[0].message.tool_calls[0].function.name` 这些属性访问和真的一模一样,`model_dump` 也能用。
- `self.script, self.repeat_last, self.sent = script, repeat_last, []` `script` 是事先写好的回复列表,第 n 次调用返回第 n 个;`sent` 记下每次收到的 messages,事后检查。
- `self.sent.append(copy.deepcopy(kw["messages"]))` 必须深拷贝。`run` 里的 `messages` 是同一个列表,后面还会被 `append`;不拷贝的话,`sent` 里存的全是同一个列表的引用,事后看到的都是最终状态。JS 里同样的坑,要用 `structuredClone`。
- `if len(self.sent) > 20:` 防的是被测代码没有步数上限:脚本按 `repeat_last` 一直返回工具调用,没上限的循环会永远转下去,判卷脚本自己卡死。20 次就主动报错。
- `def get_temp(city: str) -> dict:` 判卷用自己的工具,不用你代码里的。只认北京,查别的城市会抛 `KeyError`。
- `B = '{"city": "北京"}'` 最常用的那个参数字符串,起个短名字省得每行都写。
- `def case_direct(run):` 用例 1:模型直接回答,不调工具。要返回那句话,而且只调一次模型。
- `roles = [m["role"] for m in c.sent[1]]` 用例 2 的关键:第 2 次请求的消息角色必须正好是 user、assistant、tool。少了 assistant 就是没把模型回复放回去。
- `return [m["tool_call_id"] for m in tool_msgs(c)] == ["c1", "c2"]` 用例 3:两个调用,两条结果,id 一一对应。
- `c = FakeClient([reply(calls=[("c1", "get_weather", B)]), reply("换个工具")])` 用例 4:调一个不存在的工具,循环不能崩,要把错误交给模型,让它接着走。
- `c = FakeClient([reply(calls=[("c1", "get_temp", '{"city":')]), reply("参数错了")])` 用例 5:JSON 只写了一半。真模型偶尔真会这样,尤其输出被 `max_tokens` 截断时。
- `return "拉萨" in tool_msgs(c)[0]["content"]` 用例 6:工具内部抛 `KeyError: '拉萨'`。报回去的错误里要有「拉萨」,说明如实报了工具内部的错;如果写成「没有名为 get_temp 的工具」,就是把内部错误误报成了工具不存在。
- `out = run(c, "m", "q", TOOLS, max_steps=3)` 用例 7:模型每次都要调工具,`max_steps=3` 时必须正好调 3 次模型就停下来。
- `run = importlib.import_module(sys.argv[1]).run` 按命令行给的模块名导入被测代码,拿它的 `run`。所以同一个判卷脚本能测参考答案,也能测你的手写版。相当于 JS 的动态 `await import(path)`。
- `ok = bool(case(run))` 每条用例返回真或假;用例里抛了异常也不让整个脚本停,记成「没过」并打印原因。

</div>

先测参考答案:

```bash
uv run python -m part09.live.check_loop part09.live.mini_agent
```

```text
通过  case_direct
通过  case_one_tool
通过  case_two_ids
通过  case_unknown_tool
通过  case_bad_json
通过  case_tool_keyerror
通过  case_step_limit
7/7
```

全过。这个脚本跑一次不到一秒,一分钱不花,以后你每次计时默写完,都用它打分。

## 第五步:十分钟里最常见的写法,拿几分

下面这个版本是我把手写时最常见的三个错误攒在一起写的,看起来也挺像回事。你先自己找一找错在哪,再往下看判卷结果。

```python
# agent-zero-lab/part09/live/attempt1.py
import json
import os

from dotenv import load_dotenv
from openai import OpenAI

from part09.live.mini_agent import TOOLS


def run(client, model: str, user_msg: str, tools: dict, max_steps: int = 8) -> str:
    messages = [{"role": "user", "content": user_msg}]
    specs = [spec for _, spec in tools.values()]
    while True:
        resp = client.chat.completions.create(model=model, messages=messages, tools=specs)
        msg = resp.choices[0].message
        if not msg.tool_calls:
            return msg.content or ""
        for call in msg.tool_calls:
            try:
                fn, _ = tools[call.function.name]
                result = fn(**json.loads(call.function.arguments))
            except KeyError:
                result = {"error": f"没有名为 {call.function.name} 的工具"}
            messages.append({"role": "tool", "tool_call_id": call.id, "content": json.dumps(result, ensure_ascii=False)})


if __name__ == "__main__":
    load_dotenv()
    client = OpenAI(base_url=os.environ["LLM_BASE_URL"], api_key=os.environ["LLM_API_KEY"])
    print(run(client, os.environ["LLM_MODEL"], "北京和上海哪个更冷?差几度?", TOOLS))
```

<div class="line-notes">

- `while True:` 错误一:没有步数上限。参数里明明写了 `max_steps`,循环却没用它。手写时很容易先写 `while True` 想着「最后再加」,然后忘了。
- `msg = resp.choices[0].message` 错误二:拿到回复以后没有 `messages.append(...)` 把它放回历史,直接就去执行工具了。
- `try:` 错误三:`try` 同时包住了「找工具」和「执行工具」两行,而且只 `except KeyError`。
- `except KeyError:` 于是两种情况都会出问题:工具内部的 `KeyError` 被说成「工具不存在」;JSON 解析错误、参数名错误这些不是 `KeyError` 的异常根本没人接,直接冲出去让整个循环崩掉。

</div>

判卷:

```bash
uv run python -m part09.live.check_loop part09.live.attempt1
```

```text
通过  case_direct
没过  case_one_tool
通过  case_two_ids
通过  case_unknown_tool
没过  case_bad_json  ← JSONDecodeError: Expecting value: line 1 column 9 (char 8)
没过  case_tool_keyerror
没过  case_step_limit  ← RuntimeError: 调了 20 次模型还没停,是不是没有步数上限?
3/7
```

3/7。四条没过,正好对上三个错误:`case_one_tool` 是没放回 assistant 消息(第 2 次请求的角色变成了 user、tool);`case_bad_json` 是 `JSONDecodeError` 没人接,直接冲出了 `run`;`case_tool_keyerror` 是「拉萨」的错误被说成了工具不存在;`case_step_limit` 是没有上限,假客户端调到第 21 次主动喊停。

`case_two_ids` 居然过了。它只检查两条 tool 消息的 id 对不对,没检查前面有没有 assistant 消息。判卷脚本只能查出你让它查的东西,这个漏洞练习 3 会补上。

假客户端说没放回 assistant 消息是错的,真接口怎么说?用真模型跑一次:

```bash
uv run python -m part09.live.attempt1
```

```text
Traceback (most recent call last):
  ...
  File "/Users/你/agent-zero-lab/.venv/lib/python3.12/site-packages/openai/_base_client.py", line 1247, in request
    raise self._make_status_error_from_response(err.response) from None
openai.BadRequestError: Error code: 400 - {'error': {'message': "Messages with role 'tool' must be a response to a preceding message with 'tool_calls' (request_id: 50d48521-d909-40a2-b4c6-f9ecda3b4939)", 'type': 'invalid_request_error', 'param': None, 'code': 'invalid_request_error'}}
```

(中间的 Traceback 很长,我省略了。)报错原文翻过来是:「role 为 tool 的消息,必须是对前面某条带 tool_calls 的消息的回应」。我们发过去的历史是 user、tool、tool,两条 tool 前面没有任何 assistant 说过「我要调工具」,接口当然不认。这就是 [Day 161](/blog/agent-zero/day-161-missing-result/) 讲过的那一类错,只是方向反过来:那天是有调用没结果,今天是有结果没调用。

在面试现场,这个 400 是最好的结果:错误马上暴露,你改一行就好。更可怕的是第三个错误,它不报错,只是让模型以为 `get_temp` 不存在,然后模型换着名字乱试,你看到的是「Agent 有点笨」,而不是一个 bug。

三个错误和修法对照:

| 错误 | 现象 | 修法 |
| --- | --- | --- |
| `while True` 没上限 | 模型一直调工具就一直转 | `for _ in range(max_steps):`,循环外 `return "步数超限"` |
| 没放回 assistant 消息 | 真接口 400,假客户端角色不对 | 调完模型第一件事就 `messages.append(msg.model_dump(exclude_none=True))` |
| `try` 包太大、只接 `KeyError` | 内部错误被误报;其他异常让循环崩掉 | `try` 只包查找,用 `else` 执行,执行那段 `except Exception` |

## 第六步:怎么计时默写

方法很土,但有效:

1. 新建一个空文件 `part09/live/my_run.py`,在编辑器设置里关掉 AI 补全(Zed、VS Code、Cursor 都能关),只留语法高亮。面试用的在线编辑器(CoderPad 之类)也就这个水平。
2. 手机定 10 分钟,开始。按第一步那五句话的顺序写,写的时候小声把每一块说出来。
3. 时间到,不管写没写完,停手,跑判卷:

```bash
uv run python -m part09.live.check_loop part09.live.my_run
```

4. 没过的用例,回去看对应那一行的 line-notes,第二天再写一遍。

第一次就在 10 分钟里写完、7/7 全过,不容易。没过不要紧,看清是哪条用例、对应哪一行,第二天再写。这东西就是熟练度,没有窍门,连着写几天,时间会一天比一天短。

判卷脚本要求你的函数签名和参考答案一样:`run(client, model, user_msg, tools, max_steps=8)`。工具表的格式也要一样(名字对应 `(函数, schema)`)。真面试里签名你自己定,这里统一只是为了能自动判卷。

## 第七步:加强题,并行、超时、重复检测

写完 25 行,有的面试官会接着加需求,这是区分「背过」和「真写过」的地方。最常见的三条一起出:「同一轮的工具调用要并行执行;每个工具最多等 3 秒;同一个工具用同样的参数调了 3 次就停。」

这三条你都学过:并行是 [Day 162](/blog/agent-zero/day-162-parallel-tools/),超时是 [Day 392](/blog/agent-zero/day-392-timeouts/) 的 `asyncio.timeout`,重复检测是 [Day 505](/blog/agent-zero/day-505-interview-3/) 实验三的 `Counter`。现场要做的是把它们拼进同一个循环。并行最自然的写法是改成 async:工具都是 `async def`,一轮的调用用 `asyncio.gather` 一起等。`gather` 相当于 JS 的 `Promise.all`。

```python
# agent-zero-lab/part09/live/async_agent.py
import asyncio
import json
import os
from collections import Counter

from dotenv import load_dotenv
from openai import AsyncOpenAI

TOOL_TIMEOUT = 3.0
MAX_REPEAT = 3


async def run_one(call, tools: dict) -> dict:
    name = call.function.name
    try:
        fn, _ = tools[name]
    except KeyError:
        result = {"error": f"没有名为 {name} 的工具,可用的有 {sorted(tools)}"}
    else:
        try:
            args = json.loads(call.function.arguments or "{}")
            async with asyncio.timeout(TOOL_TIMEOUT):
                result = await fn(**args)
        except TimeoutError:
            result = {"error": f"{name} 超过 {TOOL_TIMEOUT} 秒没返回"}
        except Exception as e:
            result = {"error": f"{type(e).__name__}: {e}"}
    return {"role": "tool", "tool_call_id": call.id, "content": json.dumps(result, ensure_ascii=False)[:4000]}


def call_key(call) -> str:
    try:
        args = json.loads(call.function.arguments or "{}")
    except json.JSONDecodeError:
        return call.function.name + call.function.arguments
    return call.function.name + json.dumps(args, sort_keys=True, ensure_ascii=False)


async def run(client, model: str, user_msg: str, tools: dict, max_steps: int = 8) -> str:
    messages = [{"role": "user", "content": user_msg}]
    specs = [spec for _, spec in tools.values()]
    seen: Counter[str] = Counter()
    for _ in range(max_steps):
        resp = await client.chat.completions.create(model=model, messages=messages, tools=specs)
        msg = resp.choices[0].message
        messages.append(msg.model_dump(exclude_none=True))
        if not msg.tool_calls:
            return msg.content or ""
        for call in msg.tool_calls:
            seen[call_key(call)] += 1
        if max(seen.values()) >= MAX_REPEAT:
            return "同一个调用重复了 3 次,已停下转人工"
        messages.extend(await asyncio.gather(*(run_one(c, tools) for c in msg.tool_calls)))
    return "步数超限,已转人工"


async def weather(city: str) -> dict:
    await asyncio.sleep(2)
    return {"city": city, "temp_c": {"北京": 4.5, "上海": 16.2}[city]}


async def news(city: str) -> dict:
    await asyncio.sleep(20)
    return {"city": city, "headline": "这条永远等不到"}


def spec(name: str, desc: str) -> dict:
    return {"type": "function", "function": {"name": name, "description": desc, "parameters": {
        "type": "object", "properties": {"city": {"type": "string"}}, "required": ["city"]}}}


TOOLS = {"weather": (weather, spec("weather", "查城市当前气温")),
         "news": (news, spec("news", "查城市今日头条新闻"))}

if __name__ == "__main__":
    load_dotenv()
    client = AsyncOpenAI(base_url=os.environ["LLM_BASE_URL"], api_key=os.environ["LLM_API_KEY"])
    q = "同时查一下北京和上海的气温,再查北京今天的头条新闻,然后简单总结。"
    print(asyncio.run(run(client, os.environ["LLM_MODEL"], q, TOOLS)))
```

<div class="line-notes">

- `from openai import AsyncOpenAI` 异步客户端,`create` 返回的是要 `await` 的协程,相当于 JS 里返回 Promise 的 `fetch`。
- `TOOL_TIMEOUT = 3.0` 题面说 3 秒。生产里按工具定,查库 2 秒、调外部 API 10 秒之类。
- `async def run_one(call, tools: dict) -> dict:` 把「执行一个调用」单独拿出来。它不管成功失败,永远返回一条 tool 消息,从不往外抛异常。这样 `gather` 不会因为一个工具出错就整体失败。
- `fn, _ = tools[name]` 和同步版一样,`try` 只包查找。
- `args = json.loads(call.function.arguments or "{}")` `or "{}"`:没参数的工具,有的模型给空字符串,`json.loads("")` 会报错。
- `async with asyncio.timeout(TOOL_TIMEOUT):` Python 3.11 起的写法,Day 392 用过:块里的代码 3 秒没跑完就被取消,块的出口抛 `TimeoutError`。像 `AbortSignal.timeout(3000)`,但不用把 signal 往下传。
- `result = await fn(**args)` 工具是 `async def`,要 `await`。
- `except TimeoutError:` 超时单独接,给模型一句它看得懂的话:不是参数错了,是工具慢。
- `def call_key(call) -> str:` 重复检测要比较「工具名 + 参数」。参数先解析再用 `sort_keys=True` 重新序列化,`{"city":"北京"}` 和 `{"city": "北京"}` 多一个空格、`{"a":1,"b":2}` 和 `{"b":2,"a":1}` 顺序不同,都算同一个调用。这是 Day 505 实验三的办法。
- `return call.function.name + call.function.arguments` JSON 解析不了的参数没法规范化,就用原始字符串当键。这个调用反正会在 `run_one` 里得到一个 `JSONDecodeError` 结果。
- `seen: Counter[str] = Counter()` 计数字典,没见过的键默认是 0,所以下面可以直接 `+= 1`。
- `resp = await client.chat.completions.create(model=model, messages=messages, tools=specs)` 异步版每次调模型都要 `await`。
- `seen[call_key(call)] += 1` 先把这一轮所有调用都计上数。
- `if max(seen.values()) >= MAX_REPEAT:` 判断放在**执行之前**:第 3 次重复的调用根本不会被执行。工具有副作用时(比如提交退款),这一点很重要。
- `messages.extend(await asyncio.gather(*(run_one(c, tools) for c in msg.tool_calls)))` 并行执行这一轮的全部调用。`gather` 返回的列表顺序和传入顺序一致,谁先跑完不影响,所以 tool 消息和 tool_calls 还是一一对应(模型其实靠 id 对,顺序对上只是更好读)。`*( ... )` 把生成器展开成多个参数,像 JS 的 `Promise.all(calls.map(c => runOne(c)))`。
- `async def weather(city: str) -> dict:` 假工具,睡 2 秒再返回,用来量并行有没有生效。
- `await asyncio.sleep(20)` 另一个假工具睡 20 秒,用来测超时。`asyncio.sleep` 是会让出控制权的「异步睡」,换成 `time.sleep` 超时就管不住了,写完要补的三句话里会说。
- `print(asyncio.run(run(client, os.environ["LLM_MODEL"], q, TOOLS)))` `asyncio.run` 启动事件循环跑完这个协程。

</div>

先用真模型跑。和第三步一样,我写了一个 `AsyncSpy` 来打印每次调模型的时间点,它就是 Spy 的异步版(`create` 前面加 `async`,里面 `await` 真客户端),代码在练习仓 `part09/live/aspy.py`,运行脚本 `part09/live/run_async.py` 和 `run_spy.py` 一个样子,这里不重复贴。

```bash
uv run python -m part09.live.run_async
```

```text
[ 1.60s] 第 1 次 发 1 条 | 调用 ['weather({"city": "北京"})', 'weather({"city": "上海"})', 'news({"city": "北京"})']
[ 5.92s] 第 2 次 发 5 条 | 调用 ['news({"city": "北京"})']
[10.16s] 第 3 次 发 7 条 | 调用 无
简要总结：

- **北京气温：4.5℃**
- **上海气温：16.2℃**，比北京高约 **11.7℃**
- **北京今日头条新闻**：未获取到，新闻查询连续两次超时。

总体来看，上海明显更暖和，北京较冷；北京新闻暂时无法查询。
合计 3 次,输入 1545 / 输出 286 tokens
```

逐行读:

- 第 1 次(1.60 秒返回)模型一轮发出 3 个调用:两个 `weather`、一个 `news`。
- 第 2 次在 5.92 秒发出,中间隔了 4.3 秒:三个工具并行跑,两个 `weather` 各 2 秒,`news` 在 3 秒时被超时取消,所以这一轮工具总共花了约 3 秒,剩下的是网络和模型时间。串行的话是 2 + 2 + 3 = 7 秒。
- 第 2 次模型看到新闻超时,又试了一次同样的 `news({"city": "北京"})`。这时计数是 2,还没到 3,放行,又超时一次。
- 第 3 次模型放弃重试,如实告诉用户「连续两次超时」,没有编一条新闻出来。

这次真模型自己就停了,重复检测没触发。要验证它,得用假客户端,让模型一直重复。判卷脚本 `part09/live/check_async.py` 做了三件事:并行时两个 2 秒的工具用时多少;20 秒的工具会不会在 3 秒被掐断;模型一直要求同一个调用时停在第几次。它复用第四步的 `reply` 来造假回复,结构和 `check_loop.py` 一样,完整代码在练习仓里。

```bash
uv run python -m part09.live.check_async
```

```text
并行:两个 2 秒的工具,用时 2.00 秒
超时:新闻超时了,用时 3.00 秒
重复:同一个调用重复了 3 次,已停下转人工;调了模型 3 次,工具真正执行 2 次
```

重复那条我故意让第 2 次的参数写成 `{"city":"北京"}`(没有空格),它照样被认成同一个调用。第 3 次模型又要调时,`run` 在执行前就停了,所以工具只真正执行了 2 次。

真模型那次花了多少:1545 个输入、286 个输出,空闲价 1545 × 1 / 1,000,000 + 286 × 4 / 1,000,000 ≈ ¥0.0027。

## 写完要主动补的三句话

代码写完,面试官还没开口,你主动补三句:

**超时要每一层都有。** 我只给工具加了超时,模型调用本身也要(openai SDK 的 `timeout` 参数),整个任务也要有一个总时限,而且内层比外层短,这是 Day 392 的原则。

**要有成本上限。** 步数上限只是间接的成本上限。更直接的是累计 `resp.usage` 的 token 数,超预算就停,练习 2 就写这个。

**要能看到每一步。** 正式代码里每次模型调用和工具调用都要记 trace(Langfuse 或 OpenTelemetry),我刚才用 Spy 打印的那几行,就是 trace 最简陋的样子。

如果面试官接着问「你的超时一定管用吗」,这句能说出来就是真写过的人:**`asyncio.timeout` 只能打断 `await`,工具内部要是用了同步阻塞的库(`requests`、同步的数据库驱动、`time.sleep`),超时不会生效**,要么换异步库,要么用 `asyncio.to_thread` 把同步调用丢到线程里。Day 392 实跑过这个坑:写了 1 秒的超时,结果安安静静等了 3 秒。

## 动手练习

**练习 1:用 TypeScript 写一遍。** 面试允许用你最熟的语言,你最熟的是 TypeScript。不用任何 SDK,用 `fetch` 直接调 DeepSeek 的 `/chat/completions`,写出和 `mini_agent.py` 同样功能的循环,用 Node 直接运行。

<details><summary>参考答案</summary>

较新的 Node 可以直接运行 `.ts` 文件(只是把类型标注擦掉,不做类型检查),我本机是 Node 24.22.0,不用装 tsx 也不用编译,也没有任何警告。`--env-file=.env` 让 Node 自己读 `.env`。

```typescript
// agent-zero-lab/part09/ex/ex507_agent.ts
type ToolCall = { id: string; function: { name: string; arguments: string } };
type Msg = { role: string; content?: string | null; tool_calls?: ToolCall[]; tool_call_id?: string };
type Tool = { fn: (args: any) => unknown; spec: object };

const TEMPS: Record<string, number> = { 北京: 4.5, 上海: 16.2 };
const TOOLS: Record<string, Tool> = {
  get_temp: {
    fn: ({ city }: { city: string }) => {
      if (!(city in TEMPS)) throw new Error(`没有 ${city} 的数据`);
      return { city, temp_c: TEMPS[city] };
    },
    spec: { type: "function", function: { name: "get_temp", description: "查城市当前气温(摄氏度)",
      parameters: { type: "object", properties: { city: { type: "string" } }, required: ["city"] } } },
  },
};

async function chat(messages: Msg[]): Promise<Msg> {
  const res = await fetch(`${process.env.LLM_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.LLM_API_KEY}` },
    body: JSON.stringify({ model: process.env.LLM_MODEL, messages, tools: Object.values(TOOLS).map((t) => t.spec) }),
  });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return (await res.json()).choices[0].message;
}

async function run(userMsg: string, maxSteps = 8): Promise<string> {
  const messages: Msg[] = [{ role: "user", content: userMsg }];
  for (let step = 0; step < maxSteps; step++) {
    const msg = await chat(messages);
    messages.push(msg);
    if (!msg.tool_calls?.length) return msg.content ?? "";
    for (const call of msg.tool_calls) {
      const tool = TOOLS[call.function.name];
      let result: unknown;
      if (!tool) {
        result = { error: `没有名为 ${call.function.name} 的工具` };
      } else {
        try {
          result = tool.fn(JSON.parse(call.function.arguments));
        } catch (e) {
          result = { error: `${(e as Error).name}: ${(e as Error).message}` };
        }
      }
      messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(result).slice(0, 4000) });
    }
  }
  return "步数超限,已转人工";
}

console.log(await run("北京和上海哪个更冷?差几度?"));
```

<div class="line-notes">

- `type Msg = { role: string; content?: string | null; tool_calls?: ToolCall[]; tool_call_id?: string };` 一个类型装下四种角色的消息。正式代码可以写成按 `role` 区分的联合类型,10 分钟里这样够了。
- `fn: ({ city }: { city: string }) => {` 参数直接解构。JS 没有 Python 的 `**kwargs`,模型给的 JSON 对象原样传进去,工具自己解构,这一步反而比 Python 简单。
- `if (!(city in TEMPS)) throw new Error(`没有 ${city} 的数据`);` JS 里查不存在的键只会得到 `undefined`,不会像 Python 那样抛 `KeyError`。想让「工具内部报错」这条路径存在,得自己 `throw`。
- `const res = await fetch(`${process.env.LLM_BASE_URL}/chat/completions`, {` OpenAI 兼容协议就是一个 POST,SDK 做的事情这里手写了:地址、鉴权头、JSON 体。
- `if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);` `fetch` 遇到 400 不会自己抛错,要自己检查 `res.ok`。这和 Python SDK 不一样,SDK 遇到 400 直接抛 `BadRequestError`。
- `messages.push(msg);` 接口返回的 message 对象原样放回历史,就是 Python 版的 `model_dump`。这里不用转换,因为它本来就是 JSON。
- `if (!msg.tool_calls?.length) return msg.content ?? "";` `?.` 可选链加 `length`:`tool_calls` 不存在或是空数组都算「不调工具」。
- `const tool = TOOLS[call.function.name];` 找不到是 `undefined`,用 `if (!tool)` 分开处理,天然就把「工具不存在」和「工具内部报错」分开了,不需要 Python 那种 `try/except/else`。
- `result = tool.fn(JSON.parse(call.function.arguments));` `JSON.parse` 失败会抛 `SyntaxError`,被下面的 `catch` 接住。
- `content: JSON.stringify(result).slice(0, 4000)` `JSON.stringify` 默认就不转义中文,不需要 Python 的 `ensure_ascii=False`。
- `console.log(await run("北京和上海哪个更冷?差几度?"));` 顶层 `await`,Node 直接跑 `.ts` 时按 ES 模块处理,可以这样写。

</div>

```bash
node --env-file=.env part09/ex/ex507_agent.ts
```

```text
**北京更冷。**

- 北京：4.5°C
- 上海：16.2°C

两者相差 **11.7°C**（16.2 − 4.5 = 11.7）。

补充一句：这里比较的是当前气温。北京是干冷，风大，体感温度往往比气温更低；上海湿度高，同样气温下体感会更冷一些。所以实际体感上的差距可能和 11.7°C 这个数字不完全一致。
```

48 行,和 Python 版差不多长。面试时如果对方不限语言,写 TS 你会快很多,而且能顺口讲一句「前端拿到的就是这个 JSON,一次运行就是一串消息」。有两点要知道:一是有的面试官希望你用 Python,因为岗位是 Python 后端,先问一句;二是判卷脚本测不了 TS 版,验收靠你自己对照五个得分点。

</details>

**练习 2:加一个 token 预算。** 在 `mini_agent.py` 的基础上加一个参数 `budget`(默认 20000),累计每次响应的 `usage.total_tokens`,超过预算且模型还想调工具时停下,返回「已用多少 tokens,超过预算,已转人工」。用预算 300 和 20000 各跑一次真模型,再用判卷脚本确认没破坏原来的功能。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part09/ex/ex507_budget.py
import json
import os

from dotenv import load_dotenv
from openai import OpenAI

from part09.live.mini_agent import TOOLS


def run(client, model: str, user_msg: str, tools: dict, max_steps: int = 8, budget: int = 20_000) -> str:
    messages = [{"role": "user", "content": user_msg}]
    specs = [spec for _, spec in tools.values()]
    used = 0
    for _ in range(max_steps):
        resp = client.chat.completions.create(model=model, messages=messages, tools=specs)
        used += resp.usage.total_tokens if resp.usage else 0
        msg = resp.choices[0].message
        messages.append(msg.model_dump(exclude_none=True))
        if not msg.tool_calls:
            return msg.content or ""
        if used >= budget:
            return f"已用 {used} tokens,超过预算 {budget},已转人工"
        for call in msg.tool_calls:
            try:
                fn, _ = tools[call.function.name]
            except KeyError:
                result = {"error": f"没有名为 {call.function.name} 的工具"}
            else:
                try:
                    result = fn(**json.loads(call.function.arguments))
                except Exception as e:
                    result = {"error": f"{type(e).__name__}: {e}"}
            messages.append({"role": "tool", "tool_call_id": call.id,
                             "content": json.dumps(result, ensure_ascii=False)[:4000]})
    return "步数超限,已转人工"


if __name__ == "__main__":
    load_dotenv()
    client = OpenAI(base_url=os.environ["LLM_BASE_URL"], api_key=os.environ["LLM_API_KEY"])
    for budget in (300, 20_000):
        print(budget, "→", run(client, os.environ["LLM_MODEL"], "北京和上海哪个更冷?差几度?", TOOLS, budget=budget)[:60])
```

<div class="line-notes">

- `def run(client, model: str, user_msg: str, tools: dict, max_steps: int = 8, budget: int = 20_000) -> str:` 新参数放在最后、有默认值,原来的调用方式不受影响,判卷脚本照样能用。`20_000` 里的下划线只是为了好读,等于 20000,JS 里也能写 `20_000`。
- `used += resp.usage.total_tokens if resp.usage else 0` `total_tokens` 是输入加输出。假客户端的回复没有 `usage`(是 None),所以要判断一下,不然判卷时会报 `AttributeError`。
- `if used >= budget:` 检查放在「模型还要调工具」之后:模型已经给出最终答案时,就算超了也把答案返回,花都花了,别浪费。只有它还想继续时才拦。

</div>

```bash
uv run python -m part09.ex.ex507_budget
uv run python -m part09.live.check_loop part09.ex.ex507_budget
```

```text
300 → 已用 365 tokens,超过预算 300,已转人工
20000 → 目前**北京更冷**。

- 北京：4.5 °C
- 上海：16.2 °C

北京比上海低 **11.7 度**。
7/7
```

预算 300 时,第一次调用就用了 365 个 token,模型还想调工具,停下。预算 20000 时正常答完。判卷 7/7,没破坏原来的行为。注意 `[:60]` 只截了前 60 个字符,换行也算字符,所以第二行显示了好几行。

生产里预算一般按钱算而不是按 token,因为输入、输出、缓存命中的单价差几十倍。思路一样,换成 Day 396 那个按单价累加的算式就行。

</details>

**练习 3:观察题。只放回文字,判卷能查出来吗?** 把 `mini_agent.py` 复制成 `part09/ex/ex507_lost.py`,把放回历史那一行改成 `messages.append({"role": "assistant", "content": msg.content or ""})`,也就是手写一个 dict、漏了 `tool_calls`。先猜:判卷脚本几条能过?真模型会怎样?然后跑一下,最后给判卷脚本补一条用例,让它能抓到这个错。

<details><summary>参考答案</summary>

```bash
sed -e 's#messages.append(msg.model_dump(exclude_none=True))#messages.append({"role": "assistant", "content": msg.content or ""})#' part09/live/mini_agent.py > part09/ex/ex507_lost.py
uv run python -m part09.ex.ex507_lost
uv run python -m part09.live.check_loop part09.ex.ex507_lost
```

`sed -e 's#旧#新#'` 是把文件里的「旧」替换成「新」再输出,`#` 是分隔符(因为内容里有 `/`,换个符号省得转义)。不熟 `sed` 的话,手动复制文件再改那一行,效果一样。(改完记得把文件第一行注释里的路径也改成 `ex507_lost.py`。)

```text
openai.BadRequestError: Error code: 400 - {'error': {'message': "Messages with role 'tool' must be a response to a preceding message with 'tool_calls' (request_id: bafad07c-d694-4c74-8819-01f2bcca9d8a
通过  case_direct
通过  case_one_tool
通过  case_two_ids
通过  case_unknown_tool
通过  case_bad_json
通过  case_tool_keyerror
通过  case_step_limit
7/7
```

(第一行是真模型那次的报错,只贴了最后一行的前半截。)判卷 7/7 全过,真模型 400。原因:`case_one_tool` 只检查了角色顺序是 user、assistant、tool,这个版本确实有一条 assistant 消息,只是里面没有 `tool_calls`。接口要的是「tool 消息前面有一条**带 tool_calls** 的 assistant 消息」,判卷脚本没查这一点。

补一条用例,加在 `check_loop.py` 的 `CASES = [...]` 前面,并把它加进列表:

```python
def case_assistant_kept(run):
    c = FakeClient([reply(calls=[("c1", "get_temp", B)]), reply("好")])
    run(c, "m", "q", TOOLS)
    a = c.sent[1][1]
    return a["role"] == "assistant" and [t["id"] for t in a.get("tool_calls", [])] == ["c1"]


CASES = [case_direct, case_one_tool, case_two_ids, case_unknown_tool, case_bad_json, case_tool_keyerror, case_step_limit,
         case_assistant_kept]
```

<div class="line-notes">

- `a = c.sent[1][1]` 第 2 次请求的第 2 条消息,应该是第 1 轮模型的回复。
- `return a["role"] == "assistant" and [t["id"] for t in a.get("tool_calls", [])] == ["c1"]` 不光要有 assistant,里面还得带着 id 为 c1 的那个调用。`a.get("tool_calls", [])` 没有这个键时返回空列表,不会报 `KeyError`。

</div>

```bash
uv run python -m part09.live.check_loop part09.ex.ex507_lost | tail -2
uv run python -m part09.live.check_loop part09.live.mini_agent | tail -1
```

```text
没过  case_assistant_kept
7/8
8/8
```

新用例抓住了它,参考答案 8/8。这道题的结论比代码重要:**假客户端只能检查你想到的东西,它模拟不了真接口的全部规则**。所以判卷全过以后,至少还要用真模型跑一次。面试官问「你怎么测 Agent 循环」,这就是一个很好的回答:不花钱的假模型测分支,少量真模型调用测协议。

</details>

**验收标准**

- 关掉 AI 补全,10 分钟内写完 `run`,`check_loop` 8/8(加了练习 3 那条以后)。
- 能说出 `attempt1.py` 的三个错误分别会导致什么现象,哪个最隐蔽。
- 加强题:能讲清并行为什么用 `gather`、重复检测为什么放在执行之前、`asyncio.timeout` 什么时候不管用。
- 写完能不看文章说出要补的三句话。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 现场编码(live coding) | 面试时在共享编辑器里当着面试官写代码,通常 10 到 45 分钟,边写边讲 |
| 判卷脚本 | 用一组固定用例自动检查你写的函数,这里是 `check_loop.py` |
| 假客户端(fake client) | 和真客户端有同样方法(`chat.completions.create`)、但返回事先写好的回复的对象,不联网、不花钱 |
| `ChatCompletion.model_validate` | 用 pydantic 从 dict 造出 openai SDK 的真实响应对象,假客户端靠它返回和真的一样的类型 |
| 鸭子类型 | 不管对象是什么类,只要有需要的方法就能用;`Spy`、`FakeClient` 能冒充 `OpenAI` 靠的就是这个 |
| `copy.deepcopy` | 把一个嵌套的列表或字典完整复制一份,改原来的不影响副本,相当于 JS 的 `structuredClone` |
| `try/except/else` | `try` 没出异常才执行 `else`;用来把「找工具」和「执行工具」的错误分开 |
| `asyncio.gather` | 同时等多个协程,按传入顺序返回结果,相当于 `Promise.all` |
| 重复调用检测 | 同一个工具加同样参数(规范化后)出现到阈值就停,判断放在执行前 |

## 常见误区

**先写 `while True`,想着最后加上限。** 时间一紧就忘了,判卷脚本会卡到第 21 次。从第一行就写 `for _ in range(max_steps)`。

**拿到回复先执行工具,忘了把回复放回历史。** 真接口 400:「Messages with role 'tool' must be a response to a preceding message with 'tool_calls'」。调完模型的下一行永远是 `messages.append(...)`。

**手写 assistant 的 dict,只放了 content。** 少了 `tool_calls`,和没放回去一样 400,而且判卷脚本不一定查得出来(练习 3)。用 `model_dump(exclude_none=True)` 原样放回,DeepSeek 带了 `reasoning_content` 时也一起带回去了。

**`try` 包住查找和执行,只接 `KeyError`。** 工具内部的 `KeyError` 被说成工具不存在,`JSONDecodeError` 没人接直接崩。`try` 只包查找,`else` 里执行并 `except Exception`。

**判卷全过就以为没问题了。** 假客户端只查你写进用例的规则。全过以后用真模型跑一次。

**在 async 工具里用同步库,以为超时设好了。** `asyncio.timeout` 只能打断 `await`,`requests`、`time.sleep` 会让它失效,而且不报错,只是多等。

**沉默写完 10 分钟。** 面试官看不到你的取舍。每写一块说一句为什么,写之前先用五句话说骨架。

## 学习资料

### 文档与文章

- [Thorsten Ball · How to Build an Agent](https://ampcode.com/how-to-build-an-agent):用 Go 一步步写一个能读写文件的 coding agent,作者想说明的就是「一个模型、一个循环、几个工具」,和今天的 `run` 是同一个骨架,换个语言再看一遍。
- [Anthropic · Building effective agents](https://www.anthropic.com/engineering/building-effective-agents):讲什么时候用 workflow、什么时候用 agent,写完代码面试官往往会顺着问这个。
- [DeepSeek · Function Calling 文档](https://api-docs.deepseek.com/zh-cn/guides/function_calling):中文,请求和返回的格式、tool 消息要带 `tool_call_id`,和今天的代码一一对应。
- [OpenAI · Function calling 指南](https://platform.openai.com/docs/guides/function-calling):协议的原始出处,面试官如果给的是 OpenAI 的 key,参数名以这里为准。
- [Python 文档 · 协程与任务](https://docs.python.org/zh-cn/3.12/library/asyncio-task.html):中文,`asyncio.timeout`、`gather`、`to_thread` 都在这一页,加强题遇到的问题查这里。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1TSg7zuEqR&autoplay=0&high_quality=1" title="Agent 的概念、原理与构建模式 —— 从零打造一个简化版的 Claude Code" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>马克的技术工作坊 · Agent 的概念、原理与构建模式,从零打造一个简化版的 Claude Code · 28 分钟,接近 60 万播放。后半段是现场手写循环,看他写的顺序和你计时默写的顺序有什么不同。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV12Zn667ERX&autoplay=0&high_quality=1" title="不用任何框架的 AI 工作台：432 行手写 Agent 循环，9.9 亿 token 账单" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>Dogwindi · 不用任何框架的 AI 工作台:432 行手写 Agent 循环,9.9 亿 token 账单 · 5 分钟,播放量很低,但正好是今天的话题往后走一步:一个手写循环用了很久以后,账单和代码长成了什么样。当一份一手经验看。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/D7_ipDqhtwk" title="How We Build Effective Agents: Barry Zhang, Anthropic" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>AI Engineer · How We Build Effective Agents(Barry Zhang,Anthropic) · 英文。他把 agent 归结成「模型在循环里用工具」,并讲了什么时候不该用 agent,写完代码被追问时可以引用。</figcaption>
</figure>

### 书籍

- Gayle Laakmann McDowell《Cracking the Coding Interview》(第 6 版,CareerCup,2015;中文版《程序员面试金典(第 6 版)》,人民邮电出版社):讲的是算法题,但前几章「面试时怎么边想边说、怎么先写能跑的再优化」对现场编码题完全适用。
- Chip Huyen《AI Engineering》(O'Reilly,2025):第 6 章「RAG and Agents」的后半章讲 agent、工具和规划,适合写完代码后对照着想「还缺什么」。

### 开源项目与代码

- [SWE-agent/mini-swe-agent](https://github.com/SWE-agent/mini-swe-agent):一个核心只有百来行的 coding agent,作者特意写得很小,读它的主循环,对照今天的 `run` 看多了哪些保护。
- [openai/openai-python](https://github.com/openai/openai-python):今天用到的 `ChatCompletion` 类型在 `src/openai/types/chat/` 下面,想知道假客户端还能造哪些字段就看这里。

## 自测

1. `run` 里调完模型之后的第一件事是什么?漏了会看到什么报错?

<details><summary>答案</summary>

把模型回复原样放回历史:`messages.append(msg.model_dump(exclude_none=True))`。漏了的话,下一次请求里 tool 消息前面没有带 tool_calls 的 assistant 消息,DeepSeek 返回 400:「Messages with role 'tool' must be a response to a preceding message with 'tool_calls'」。

</details>

2. 为什么 `try` 只包 `fn, _ = tools[name]` 这一行?

<details><summary>答案</summary>

为了把「工具不存在」和「工具内部报错」分开。工具内部也可能抛 `KeyError`(比如查不存在的城市),如果 `try` 把执行也包进去,这个错误会被误报成「没有这个工具」,模型就会以为工具没了、去换名字乱试。`try/except/else` 让查找失败走 `except`,查找成功才在 `else` 里执行,执行的错误另外 `except Exception` 接住。

</details>

3. 第三步实跑里,问「北京和上海哪个更冷」,模型被调了几次?第 2 次发了几条消息,分别是什么?

<details><summary>答案</summary>

2 次。第 1 次模型在同一轮里返回了两个 `get_temp` 调用;第 2 次发了 4 条:user、assistant(带两个 tool_calls)、两条 tool。第 2 次的输入从 299 涨到 420 个 token,多出来的就是这三条消息。

</details>

4. 加强题里,重复检测为什么放在执行工具之前,而不是之后?

<details><summary>答案</summary>

放在之前,第 3 次重复的调用根本不会被执行。工具有副作用时(提交退款、发邮件),多执行一次就是一次真实的错误操作。`check_async.py` 里模型要求了 3 次同样的调用,工具真正只执行了 2 次。

</details>

5. (面试题)「你这个超时是用 `asyncio.timeout` 做的,它一定管用吗?」

<details><summary>答案</summary>

不一定。`asyncio.timeout` 是靠在 `await` 的地方取消任务来实现的,工具内部如果用了同步阻塞的调用(`requests`、同步数据库驱动、`time.sleep`),事件循环被卡住,超时不会生效,也不报错,只是多等。办法是工具全部用真正的异步库(httpx 的 `AsyncClient`、异步数据库驱动),实在只有同步库的,用 `await asyncio.to_thread(同步函数, 参数)` 丢到线程里跑。另外超时只是「我不等了」,对方可能已经执行完了,有副作用的工具还要配幂等键。

</details>

6. (面试题)「你怎么测这个 Agent 循环?总不能每次都真调模型吧。」

<details><summary>答案</summary>

分两层。大部分用假客户端:它和真客户端有同样的 `chat.completions.create`,返回用 SDK 的 `ChatCompletion.model_validate` 造出来的真实类型,按脚本给出「直接回答」「调一个工具」「调不存在的工具」「参数是坏 JSON」「一直调工具」这些情况,检查 messages 的结构、`tool_call_id` 的对应和步数上限,一次不到一秒、不花钱。但假客户端只能查我写进用例的规则,我自己就遇到过判卷 7/7、真接口 400 的情况(assistant 消息漏了 tool_calls),所以还要有少量真模型的冒烟测试,验证协议本身。

</details>

## 明天预告

Day 508 · 系统设计(一):七步框架和企业客服 Agent。今天写的是 25 行的循环,明天把视野拉到整个系统:面试官说「我们每天 1 万张客服工单,设计一个 Agent 来处理」,你要在 40 分钟里讲清需求、指标、架构、数据、评测、风险、成本与 ROI 七步。今天的循环会变成架构图里「工作流 worker」那一个方块,步数上限、超时、重复检测都还在里面。
