---
title: 'Day 510 · 第 73 周复习:求职(Day 504–509)'
description: '这一周刷完了后三套面试题,练了 10 分钟手写 Agent 循环,做了两道系统设计题,题库到 79 道。今天不加新概念:画一张本周知识地图,计时默写 `run` 和四个小函数并用判卷脚本打分,再把整周的脚本拼成一场「三轮模拟面试」:基础题、现场编码、系统设计加追问,一个命令走完,成绩分开记。'
pubDate: 2026-10-22
regime: none
tags: ['interview', 'job-search', 'review', 'agent-loop', 'agent-zero']
series: 'agent-zero'
day: 510
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 509](/blog/agent-zero/day-509-sysdesign-2/) 做了第二道系统设计题 Deep Research Agent:用 Day 507 的 async 循环真跑了一个主管加三个研究员的小系统,量出它比单个 Agent 多花 3.5 倍输入 token、慢一倍,还把面试官最常追问的 15 个问题做成了第五套题库 `bank5.json`。

这一周的六天分成三块。Day 504 到 506 是「说」:后三套基础题,每套配几个几分钱的小实验,让答案里有自己量出来的数。Day 507 是「写」:空白编辑器里 10 分钟写 Agent 循环,外加一个不花钱的判卷脚本。Day 508 和 509 是「画」:七步框架加两道设计题。今天把三块各练一遍,再串成一场完整的模拟面试。

## 今天要解决的问题

复习日不学新东西,目标是确认这一周的东西你能不看文章拿出来。今天结束时你应该能:

1. 不看文章,说出这一周每天的核心产出:哪个脚本、哪个数字、防的是什么错。
2. 关掉 AI 补全,10 分钟默写出 `run`,判卷脚本 `check_loop` 跑出 8/8;再默写 `call_key`、`pass_at_k`、`pass_hat_k`、`little` 四个小函数,检查脚本 8/8。
3. 跑通本周小项目 `part09/review/mock.py`:一场三轮模拟面试,题目优先抽回炉题,编码成绩自动判卷,结果写进两份日志。
4. 说得出这一周最隐蔽的三个坑:判卷全过但真接口 400、用例写成值导致检查脚本自己先崩、不同种类的成绩混进同一份日志。

预计用时 3–4 小时,大头在两次默写和模拟面试。前置:[Day 504](/blog/agent-zero/day-504-interview-2/) 到 [Day 509](/blog/agent-zero/day-509-sysdesign-2/) 全部,以及 [Day 502](/blog/agent-zero/day-502-interview-1/) 的 `quiz.py` 和 `weak.py`。今天只有一次真模型调用,花费约 ¥0.002。

学法和平时一样:先对照逐行敲一遍(不复制粘贴)并跑通;第二天合上文章默写核心部分;做练习,做不出再展开参考答案,看完关掉重写一遍。

## 本周知识地图

<figure>
<svg viewBox="0 0 640 360" role="img" aria-label="第 73 周知识地图:上排是说的三天 504 到 506 四套题库和实验,中间是写的 507 判卷脚本,下排是画的 508 和 509 两道设计题,右侧汇入今天的模拟面试 mock.py">
  <rect x="0" y="0" width="640" height="360" fill="var(--paper-raised)"/>
  <text x="20" y="24" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">一场技术面试的三种题型,这一周各练了一遍</text>
  <text x="20" y="54" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">说</text>
  <rect x="50" y="38" width="120" height="44" fill="var(--mem-wash)" stroke="var(--mem)"/>
  <text x="58" y="57" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">504 bank2</text>
  <text x="58" y="73" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">工具调用 + RAG</text>
  <rect x="180" y="38" width="120" height="44" fill="var(--mem-wash)" stroke="var(--mem)"/>
  <text x="188" y="57" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">505 bank3</text>
  <text x="188" y="73" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">架构 + 上下文</text>
  <rect x="310" y="38" width="120" height="44" fill="var(--mem-wash)" stroke="var(--mem)"/>
  <text x="318" y="57" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">506 bank4</text>
  <text x="318" y="73" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">MCP 评测 安全</text>
  <text x="50" y="102" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">quiz.py 选题库 / load_all 读全部 / weak.py 回炉;每套配实验找证据</text>
  <text x="20" y="146" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">写</text>
  <rect x="50" y="122" width="380" height="50" fill="var(--compute-wash)" stroke="var(--compute)"/>
  <text x="58" y="142" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">507 mini_agent.run 25 行 + check_loop 8 条用例</text>
  <text x="58" y="160" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">加强:gather 并行 / timeout 3 秒 / call_key 重复检测</text>
  <text x="20" y="214" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">画</text>
  <rect x="50" y="192" width="185" height="50" fill="var(--mem-wash)" stroke="var(--mem)"/>
  <text x="58" y="212" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">508 七步框架 + 客服</text>
  <text x="58" y="230" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">利特尔 17.4 / ROI 敏感度</text>
  <rect x="245" y="192" width="185" height="50" fill="var(--mem-wash)" stroke="var(--mem)"/>
  <text x="253" y="212" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">509 Deep Research</text>
  <text x="253" y="230" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">多 Agent 实测 + bank5</text>
  <rect x="470" y="100" width="150" height="120" fill="var(--paper)" stroke="var(--rule)"/>
  <text x="480" y="122" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">510 mock.py</text>
  <text x="480" y="142" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">① 基础题 3 道</text>
  <text x="480" y="160" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">② 编码 判卷</text>
  <text x="480" y="178" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">③ 设计 + 追问 2</text>
  <text x="480" y="204" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">两份日志分开记</text>
  <line x1="430" y1="60" x2="470" y2="130" stroke="var(--ink-faint)"/>
  <line x1="430" y1="147" x2="470" y2="155" stroke="var(--ink-faint)"/>
  <line x1="430" y1="217" x2="470" y2="185" stroke="var(--ink-faint)"/>
  <text x="20" y="290" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">共同的教训:每个结论都要有自己量过的数,每个检查脚本都只查得出你写进用例的东西。</text>
  <text x="20" y="310" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">pass@3 0.90 vs pass^3 0.80;评委换序 4 组改判 2 组;注入 20 次 0 成功 ≠ 防住了;</text>
  <text x="20" y="330" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">判卷 7/7 但真接口 400;多 Agent 多花 3.5 倍 token。</text>
</svg>
<figcaption>本周六天按「说、写、画」三种题型排开,右边是今天把它们串起来的模拟面试。底部三行是这一周反复出现的同一件事:数字要自己量,检查要知道自己的盲区。</figcaption>
</figure>

图里我最想让你记住的是底部那几个数。这一周几乎每一个结论都带着一个反直觉的数字:pass@3 比 pass^3 高 0.1,差距全来自一张模糊工单;LLM 评委交换顺序后一半改判;注入 20 次全被挡住,真实成功率仍可能有百分之十几;判卷脚本 7/7 全过,真接口却直接 400。面试官追问的就是这些地方,背下来的答案在这里一戳就破,量过的人能把数字报出来。

## 本周每天一句话

[Day 504 · 面试(二)](/blog/agent-zero/day-504-interview-2/):工具调用 7 题和 RAG 8 题。`quiz.py` 加了选题库参数,`weak.py` 撞上 `KeyError: '25'` 后改用 `load_all()` 读全部题库;四个实验说明了模型只「请求」调用、错误喂回去一次就能改对、500 条工具结果让模型数错数、错误码检索为什么要混合检索。

[Day 505 · 面试(三)](/blog/agent-zero/day-505-interview-3/):架构与框架原理 8 题、上下文工程 6 题。同一张工单 agent 比 workflow 多花 9 倍输入 token;不调模型的 LangGraph 小图跑出了 reducer 报错;假模型演示了死循环要靠重复检测才能 3 步停下;长对话直接截断会让模型忘掉争议发票。

[Day 506 · 面试(四)](/blog/agent-zero/day-506-interview-4/):MCP、Skills、评测、安全 18 题。MCP 工具列表三行就转成 function calling 定义;pass@3 0.90、pass^3 0.80;评委交换顺序 4 组改判 2 组;注入 20 次 0 成功,只说明真实成功率大概率低于 14%。

[Day 507 · 面试(五)](/blog/agent-zero/day-507-live-coding/):10 分钟手写 Agent 循环。48 行参考答案,判卷脚本用 `ChatCompletion.model_validate` 造假回复,一份常见写法只拿 3/7 并被 DeepSeek 400 拒掉;加强题用 `gather` 并行、`asyncio.timeout` 掐 3 秒、`call_key` 规范化参数做重复检测。

[Day 508 · 系统设计(一)](/blog/agent-zero/day-508-sysdesign-1/):七步框架(需求、指标、架构、数据、评测、风险、成本),每天 1 万张工单的客服 Agent。利特尔法则估 17.4 个并发、模拟出 P99 是 27;ROI 敏感度显示客服看草稿的时间比 token 用量重要得多。

[Day 509 · 系统设计(二)](/blog/agent-zero/day-509-sysdesign-2/):Deep Research Agent。主管加三个研究员实跑,一个研究员为了找资料里没有的链接跑满步数;改一句派活的话,调用从 18 次降到 14 次;15 个追问进了 `bank5.json`,题库到 79 道。

哪一句读着觉得「好像是这样,但说不清为什么」,先回那一天把对应小节重看一遍再往下。

## 准备环境

今天的代码放在 `agent-zero-lab/part09/review/`,和 [Day 503](/blog/agent-zero/day-503-week72-review/) 的复习文件同目录。先确认本周的文件都在:

```bash
cd agent-zero-lab
for f in quiz.py weak.py interview/bank2.json interview/bank3.json interview/bank4.json interview/bank5.json interview/log.jsonl live/mini_agent.py live/check_loop.py live/spy.py live/attempt1.py; do [ -e part09/$f ] && echo "有 $f" || echo "缺 $f"; done
python3 -c "import json,glob;print(sum(len(json.load(open(p))) for p in glob.glob('part09/interview/bank*.json')), '道题')"
```

```text
有 quiz.py
有 weak.py
有 interview/bank2.json
有 interview/bank3.json
有 interview/bank4.json
有 interview/bank5.json
有 interview/log.jsonl
有 live/mini_agent.py
有 live/check_loop.py
有 live/spy.py
有 live/attempt1.py
79 道题
```

`[ -e 路径 ] && A || B` 是 Day 503 用过的写法:路径存在就做 A,否则做 B。第二行用 `glob` 找出全部题库文件,把每个文件的题数加起来:bank1 有 17 道(13 道加 4 道加题)、bank2 有 15 道、bank3 有 14 道、bank4 有 18 道、bank5 有 15 道,合计 79。不是 79 就说明哪一套没放进去,回那一天补。

`check_loop.py` 要是 Day 507 练习 3 改过的版本,也就是 8 条用例(最后一条是 `case_assistant_kept`)。如果你还停在 7 条,先回 Day 507 把练习 3 做了,今天的默写要用 8 条判。

`log.jsonl` 是你这一周答题的记录。为了把输出贴进文章,我这份是用管道模拟按键跑出来的,所以用时全是 0 秒;你自己的日志里用时是真的。

## 默写一:10 分钟写 `run`

这一周最该长在手上的代码就是 `run`。规则和 Day 507 第六步一样:新建 `part09/review/my_run.py`,关掉编辑器的 AI 补全,手机定 10 分钟,按五句话的骨架边说边写,时间到就停手判卷。

### 一份典型的第一次默写稿

下面这份不是参考答案,是把手写时容易犯、而 Day 507 没专门演示过的三个错误放在一起的一份稿子,原样判卷,看看判卷脚本能抓到什么:

```python
# agent-zero-lab/part09/review/my_run.py  (默写稿,第一次)
import json


def run(client, model: str, user_msg: str, tools: dict, max_steps: int = 8) -> str:
    messages = [{"role": "user", "content": user_msg}]
    specs = [spec for _, spec in tools.values()]
    step = 0
    while step <= max_steps:
        step += 1
        resp = client.chat.completions.create(model=model, messages=messages, tools=specs)
        msg = resp.choices[0].message
        messages.append({"role": "assistant", "content": msg.content or ""})
        if not msg.tool_calls:
            return msg.content or ""
        for call in msg.tool_calls:
            name = call.function.name
            args = json.loads(call.function.arguments)
            if name not in tools:
                result = {"error": f"没有名为 {name} 的工具,可用的有 {sorted(tools)}"}
            else:
                fn, _ = tools[name]
                try:
                    result = fn(**args)
                except Exception as e:
                    result = {"error": f"{type(e).__name__}: {e}"}
            messages.append({"role": "tool", "tool_call_id": call.id,
                             "content": json.dumps(result, ensure_ascii=False)[:4000]})
    return "步数超限,已转人工"
```

<div class="line-notes">

- `step = 0` 前端写惯了 `let i = 0; while (i <= n)`,很容易照搬。错误一就在下一行。
- `while step <= max_steps:` 用的是 `<=`:step 从 0 到 3 都会进循环,`max_steps=3` 时会调 4 次模型。差一次看起来不要紧,但这是「上限写错了」,面试官看见 `<=` 会直接问你。
- `messages.append({"role": "assistant", "content": msg.content or ""})` 错误二:手写了一个只有文字的 assistant 消息,`tool_calls` 丢了。这就是 Day 507 练习 3 那个坑,真接口会 400。
- `args = json.loads(call.function.arguments)` 错误三:解析参数放在了 `try` 外面。模型给出半截 JSON 时,`JSONDecodeError` 没人接,直接冲出 `run`。
- `if name not in tools:` 这一处不是错误。用 `if` 先判断工具在不在,代替 Day 507 的 `try/except KeyError/else`,效果一样:「工具不存在」和「工具内部报错」照样分得开,而且和 TypeScript 版的写法一模一样,前端读者可能更顺手。
- `fn, _ = tools[name]` 走到这里,名字一定在表里,所以这一行不会抛 `KeyError`。

</div>

```bash
uv run python -m part09.live.check_loop part09.review.my_run
```

```text
通过  case_direct
通过  case_one_tool
通过  case_two_ids
通过  case_unknown_tool
没过  case_bad_json  ← JSONDecodeError: Expecting value: line 1 column 9 (char 8)
通过  case_tool_keyerror
没过  case_step_limit
没过  case_assistant_kept
5/8
```

三个错误,三条没过,一一对上。`case_step_limit` 没打印原因,因为它没抛异常,只是结果不对。单独看一眼它调了几次模型:

```bash
uv run python -c "
from part09.live.check_loop import FakeClient, reply, TOOLS, B
from part09.review.my_run import run
c = FakeClient([reply(calls=[('c1', 'get_temp', B)])], repeat_last=True)
print(repr(run(c, 'm', 'q', TOOLS, max_steps=3)), len(c.sent))
"
```

```text
'步数超限,已转人工' 4
```

返回值看起来完全正常,只是调了 4 次而不是 3 次。这种错你自己读代码时最容易放过去,判卷脚本数的是次数,一下就抓住了。

如果你还停在 7 条用例的旧判卷脚本上,这份稿子能拿 5/7,而且错误二抓不到,7 条用例里没有一条检查 assistant 消息里带不带 `tool_calls`。这也是 Day 507 练习 3 要补那条用例的原因。

### 改三处

```python
# agent-zero-lab/part09/review/my_run.py  (改过以后)
import json


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
            if name not in tools:
                result = {"error": f"没有名为 {name} 的工具,可用的有 {sorted(tools)}"}
            else:
                fn, _ = tools[name]
                try:
                    result = fn(**json.loads(call.function.arguments))
                except Exception as e:
                    result = {"error": f"{type(e).__name__}: {e}"}
            messages.append({"role": "tool", "tool_call_id": call.id,
                             "content": json.dumps(result, ensure_ascii=False)[:4000]})
    return "步数超限,已转人工"
```

<div class="line-notes">

- `for _ in range(max_steps):` 上限写在循环头上,`range(3)` 正好是 0、1、2 三圈,不用自己管计数器。和 JS 的 `for (let i = 0; i < n; i++)` 对应的是 `<`,不是 `<=`。
- `messages.append(msg.model_dump(exclude_none=True))` 把 SDK 返回的消息对象原样转成 dict 放回去,`tool_calls` 和 DeepSeek 的 `reasoning_content` 一起带上。
- `result = fn(**json.loads(call.function.arguments))` 解析挪进 `try` 里面,半截 JSON 变成一条错误结果交回模型。

</div>

```bash
uv run python -m part09.live.check_loop part09.review.my_run
```

```text
通过  case_direct
通过  case_one_tool
通过  case_two_ids
通过  case_unknown_tool
通过  case_bad_json
通过  case_tool_keyerror
通过  case_step_limit
通过  case_assistant_kept
8/8
```

### 全过以后,真模型跑一次

Day 507 的结论是:假客户端只查你写进用例的东西,判卷全过以后至少用真模型跑一次。这次问题里多加了一个工具表里没有的城市「拉萨」,让「工具内部报错」那条路径在真模型上也走一遍。用 Day 507 的 `Spy` 包住客户端,看每一圈:

```python
# agent-zero-lab/part09/review/run_mine.py
import os

from dotenv import load_dotenv
from openai import OpenAI

from part09.live.mini_agent import TOOLS
from part09.live.spy import Spy
from part09.review.my_run import run

load_dotenv()
client = Spy(OpenAI(base_url=os.environ["LLM_BASE_URL"], api_key=os.environ["LLM_API_KEY"]))
print(run(client, os.environ["LLM_MODEL"], "北京和上海哪个更冷?差几度?拉萨呢?", TOOLS))
print(f"合计 {client.calls} 次,输入 {client.prompt_tokens} / 输出 {client.completion_tokens} tokens")
```

<div class="line-notes">

- `from part09.live.mini_agent import TOOLS` 工具表借参考答案的,只有北京和上海两个城市。
- `from part09.review.my_run import run` 被测的是你的默写版,不是参考答案。
- `client = Spy(OpenAI(` Day 507 第三步的 `Spy`,每次调模型打印一行用量和调用。`run` 只认 `chat.completions.create`,所以包一层它察觉不到。
- `"北京和上海哪个更冷?差几度?拉萨呢?"` 拉萨不在 `TEMPS` 里,`get_temp` 会抛 `KeyError: '拉萨'`,看模型拿到错误以后怎么说。

</div>

```bash
uv run python -m part09.review.run_mine
```

```text
[ 0.98s] 第 1 次 发 1 条 | 用量 302/115 | 思考 有 | 调用 ['get_temp({"city": "北京"})', 'get_temp({"city": "上海"})', 'get_temp({"city": "拉萨"})']
[ 1.98s] 第 2 次 发 5 条 | 用量 483/112 | 思考 有 | 调用 无
- **北京更冷**：北京 **4.5°C**，上海 **16.2°C**
- 北京比上海低 **11.7°C**
- **拉萨**：目前气温数据查询失败，暂时无法比较。
合计 2 次,输入 785 / 输出 227 tokens
```

模型一轮就发出三个调用。第 2 次发了 5 条消息:user、带三个 tool_calls 的 assistant、三条 tool。拉萨那条结果是 `{"error": "KeyError: '拉萨'"}`,模型如实说查询失败,没有编一个温度出来。两次请求都「思考 有」,DeepSeek 的 `reasoning_content` 被 `model_dump` 原样放回了历史,接口没报错。

花费:2026 年 10 月 22 日晚上 11 点 48 分跑的,DeepSeek 空闲价(北京时间工作日 9–12 点、14–18 点之外都是空闲价,2026 年 10 月查到),未命中输入 1 元、输出 4 元每百万 token:785 × 1 / 1,000,000 + 227 × 4 / 1,000,000 ≈ ¥0.0017。这是今天唯一一次花钱。

## 默写二:四个小函数

`run` 之外,这一周还有几个面试时可能被要求「现场写一下」的小函数。它们短,但每一个都踩过坑:

- `call_key(call)`:Day 507 加强题,把一次工具调用变成「工具名 + 规范化参数」的字符串,重复检测靠它。
- `pass_at_k(n, c, k)` 和 `pass_hat_k(n, c, k)`:Day 506 实验二,跑 n 次对 c 次,算「k 次里至少一次对」和「k 次全对」的概率。
- `little(per_day, peak, secs)`:Day 508,每天多少单、高峰是平均的几倍、每单处理几秒,算同时在处理多少单。

合上文章,写进 `part09/review/mine73.py`。检查脚本先给你,它只看结果:

```python
# agent-zero-lab/part09/review/check_week73.py  (第一版)
from part09.live.check_loop import reply
from part09.review.mine73 import call_key, little, pass_at_k, pass_hat_k


def call(name: str, args: str):
    return reply(calls=[("c1", name, args)]).choices[0].message.tool_calls[0]


CASES = [
    ("call_key 空格不同", call_key(call("news", '{"city":"北京"}')) == call_key(call("news", '{"city": "北京"}')), True),
    ("call_key 键顺序不同", call_key(call("f", '{"a":1,"b":2}')) == call_key(call("f", '{"b":2,"a":1}')), True),
    ("call_key 参数不同", call_key(call("news", '{"city":"北京"}')) == call_key(call("news", '{"city":"上海"}')), False),
    ("call_key 坏 JSON 不崩", isinstance(call_key(call("news", '{"city":')), str), True),
    ("pass@3 对 1 次", pass_at_k(6, 1, 3), 0.5),
    ("pass^3 对 1 次", pass_hat_k(6, 1, 3), 0.0),
    ("pass^3 全对", pass_hat_k(6, 6, 3), 1.0),
    ("利特尔 1 万单", round(little(10_000, 10, 15), 1), 17.4),
]

bad = 0
for name, got, want in CASES:
    ok = got == want
    bad += not ok
    print(f"{'✓' if ok else '✗'} {name}" + ("" if ok else f"  得到 {got!r},应该是 {want!r}"))
print(f"\n{len(CASES) - bad}/{len(CASES)} 通过")
```

<div class="line-notes">

- `from part09.live.check_loop import reply` 借 Day 507 判卷脚本里造假回复的函数,用它造出真的 SDK 调用对象。
- `return reply(calls=[("c1", name, args)]).choices[0].message.tool_calls[0]` 造一个只有一次工具调用的假回复,再把那个调用对象取出来。这样 `call_key` 拿到的 `call.function.name`、`call.function.arguments` 和真模型返回的一模一样。
- `("call_key 空格不同",` Day 507 的设计:`{"city":"北京"}` 和 `{"city": "北京"}` 只差一个空格,应该算同一个调用。
- `("call_key 键顺序不同",` 键的顺序不同也算同一个调用。这一条要靠 `sort_keys=True`。
- `("call_key 坏 JSON 不崩",` 半截 JSON 解析不了,`call_key` 不能崩,返回一个字符串就行。
- `("pass@3 对 1 次", pass_at_k(6, 1, 3), 0.5),` Day 506 的那张模糊工单:6 次对 1 次,pass@3 是 1 − C(5,3)/C(6,3) = 1 − 10/20 = 0.5。
- `("利特尔 1 万单", round(little(10_000, 10, 15), 1), 17.4),` Day 508:10000 ÷ 86400 × 10 × 15 ≈ 17.4。`round(x, 1)` 保留一位小数再比,浮点数直接比相等容易差在最后几位。

</div>

下面是一份典型的第一次默写稿,`call_key` 忘了两件事,`pass_at_k` 写成了一个看着很像的公式:

```python
# agent-zero-lab/part09/review/mine73.py  (默写稿,第一次)
import json
from math import comb


def call_key(call) -> str:
    args = json.loads(call.function.arguments or "{}")
    return call.function.name + json.dumps(args, ensure_ascii=False)


def pass_at_k(n: int, c: int, k: int) -> float:
    return 1 - (1 - c / n) ** k


def pass_hat_k(n: int, c: int, k: int) -> float:
    return comb(c, k) / comb(n, k)


def little(per_day: int, peak: float, secs: float) -> float:
    return per_day / 86400 * peak * secs
```

<div class="line-notes">

- `args = json.loads(call.function.arguments or "{}")` 没有 `try`,坏 JSON 会抛异常。
- `return call.function.name + json.dumps(args, ensure_ascii=False)` 少了 `sort_keys=True`。空格那条能过,因为解析再序列化以后空格本来就统一了;键顺序那条过不了,`json.dumps` 默认按字典原来的顺序输出。
- `return 1 - (1 - c / n) ** k` 这是「每次独立、成功率 c/n」时至少一次成功的概率,很多人记的是这个。它和 Day 506 的无偏估计不一样:Day 506 是从已经跑出来的 n 次结果里不放回地挑 k 次,用组合数。

</div>

```bash
uv run python -m part09.review.check_week73
```

```text
Traceback (most recent call last):
  File "<frozen runpy>", line 198, in _run_module_as_main
  File "<frozen runpy>", line 88, in _run_code
  File "/Users/你/agent-zero-lab/part09/review/check_week73.py", line 14, in <module>
    ("call_key 坏 JSON 不崩", isinstance(call_key(call("news", '{"city":')), str), True),
                                         ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
  File "/Users/你/agent-zero-lab/part09/review/mine73.py", line 7, in call_key
    args = json.loads(call.function.arguments or "{}")
           ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
  ...
json.decoder.JSONDecodeError: Expecting value: line 1 column 9 (char 8)
```

(中间 `json` 模块内部的几行我省略了。)判卷脚本自己先崩了,一个 ✓ ✗ 都没打出来。

问题不在默写稿,在检查脚本。`CASES` 列表里每一项的第二个元素是一个**值**:Python 建这个列表时,会从上到下把每个表达式当场算出来,算到第四行 `call_key(call("news", '{"city":'))` 抛了异常,整个列表都建不起来,后面的循环根本没机会跑。JS 里写 `const CASES = [[name, callKey(...), true], ...]` 是同一回事,数组字面量里的表达式也是当场求值。

回头看 Day 507 的 `check_loop.py` 为什么每条用例都写成一个函数(`def case_direct(run): ...`),主程序里再一条一条 `try` 着调用:用例是函数,就要等到调用时才执行,一条炸了只影响它自己。这正是 Day 503 的检查脚本没遇到、而 Day 507 已经替你防住的坑。

改法:每一项的第二个元素换成 `lambda: ...`,也就是一个没有参数、调用时才计算的小函数,相当于 JS 的 `() => ...`;循环里 `try` 着调用它。

```python
# agent-zero-lab/part09/review/check_week73.py  (改过以后,只列变化的部分)
CASES = [
    ("call_key 空格不同", lambda: call_key(call("news", '{"city":"北京"}')) == call_key(call("news", '{"city": "北京"}')), True),
    ("call_key 键顺序不同", lambda: call_key(call("f", '{"a":1,"b":2}')) == call_key(call("f", '{"b":2,"a":1}')), True),
    ("call_key 参数不同", lambda: call_key(call("news", '{"city":"北京"}')) == call_key(call("news", '{"city":"上海"}')), False),
    ("call_key 坏 JSON 不崩", lambda: isinstance(call_key(call("news", '{"city":')), str), True),
    ("pass@3 对 1 次", lambda: pass_at_k(6, 1, 3), 0.5),
    ("pass^3 对 1 次", lambda: pass_hat_k(6, 1, 3), 0.0),
    ("pass^3 全对", lambda: pass_hat_k(6, 6, 3), 1.0),
    ("利特尔 1 万单", lambda: round(little(10_000, 10, 15), 1), 17.4),
]

bad = 0
for name, case, want in CASES:
    try:
        got = case()
    except Exception as e:
        got = f"{type(e).__name__}: {e}"
    ok = got == want
    bad += not ok
    print(f"{'✓' if ok else '✗'} {name}" + ("" if ok else f"  得到 {got!r},应该是 {want!r}"))
print(f"\n{len(CASES) - bad}/{len(CASES)} 通过")
```

<div class="line-notes">

- `("call_key 空格不同", lambda: call_key(` `lambda: 表达式` 建一个函数,建的时候不执行,调用时才执行。整个列表现在装的是 8 个函数,建列表这一步不会再出错。
- `for name, case, want in CASES:` 第二个元素不再是结果,改名叫 `case`。
- `got = case()` 到这里才真正执行用例。
- `got = f"{type(e).__name__}: {e}"` 用例抛了异常,就把异常的名字和信息当成「得到的值」,它和期望值不相等,自然算没过,下面那行还会把它打印出来。

</div>

```bash
uv run python -m part09.review.check_week73
```

```text
✓ call_key 空格不同
✗ call_key 键顺序不同  得到 False,应该是 True
✓ call_key 参数不同
✗ call_key 坏 JSON 不崩  得到 'JSONDecodeError: Expecting value: line 1 column 9 (char 8)',应该是 True
✗ pass@3 对 1 次  得到 0.42129629629629617,应该是 0.5
✓ pass^3 对 1 次
✓ pass^3 全对
✓ 利特尔 1 万单

5/8 通过
```

三个 ✗ 正好是默写稿的三处问题。`pass@3` 那条值得多说一句:1 − (5/6)³ ≈ 0.42,和 0.5 差得不多,如果你的检查只看「大概对不对」,它就混过去了。两个公式回答的问题不一样:前者假设每次独立、成功率是 1/6;后者是在已经跑出来的 6 次结果里不放回地挑 3 次。Day 506 用后者,因为评测报告里我们手里就是那 6 次真实结果。

改好的版本:

```python
# agent-zero-lab/part09/review/mine73.py  (改过以后)
import json
from math import comb


def call_key(call) -> str:
    try:
        args = json.loads(call.function.arguments or "{}")
    except json.JSONDecodeError:
        return call.function.name + call.function.arguments
    return call.function.name + json.dumps(args, sort_keys=True, ensure_ascii=False)


def pass_at_k(n: int, c: int, k: int) -> float:
    return 1 - comb(n - c, k) / comb(n, k)


def pass_hat_k(n: int, c: int, k: int) -> float:
    return comb(c, k) / comb(n, k)


def little(per_day: int, peak: float, secs: float) -> float:
    return per_day / 86400 * peak * secs
```

<div class="line-notes">

- `except json.JSONDecodeError:` 只接解析错误。参数坏了没法规范化,就用原始字符串当键,反正 `run_one` 执行时会给模型一条错误结果。
- `return call.function.name + json.dumps(args, sort_keys=True, ensure_ascii=False)` `sort_keys=True` 让键按字母排序再输出,`{"b":2,"a":1}` 和 `{"a":1,"b":2}` 变成同一个字符串。
- `return 1 - comb(n - c, k) / comb(n, k)` 从 6 次里挑 3 次全挑到错的那 5 次:C(5,3)=10 种,总共 C(6,3)=20 种,10/20 全错,所以至少一次对的概率是 0.5。
- `return per_day / 86400 * peak * secs` 一天 86400 秒。每秒到达数 × 每单秒数 = 同时在处理的数量,就是 L = λ × W。

</div>

```bash
uv run python -m part09.review.check_week73
```

```text
✓ call_key 空格不同
✓ call_key 键顺序不同
✓ call_key 参数不同
✓ call_key 坏 JSON 不崩
✓ pass@3 对 1 次
✓ pass^3 对 1 次
✓ pass^3 全对
✓ 利特尔 1 万单

8/8 通过
```

两个默写都到 8/8 之前,别往下走。你的写法和我的不一样没关系,用例全过就行。

## 本周小项目:一场三轮模拟面试

一场真的 Agent 岗技术面,通常是这几样混在一起:几道基础题,一段现场编码,一道系统设计,最后面试官顺着你的设计追问。这一周你把它们分开练了,但分开练有个问题:你永远知道下一题是哪一类,也永远可以挑自己熟的练。

小项目 `mock.py` 把它们串成一场:

- 第一轮,基础题 3 道,从本周的 bank2 到 bank4 里抽,**先抽要回炉的题,再抽没抽过的,最后才是答得好的**。
- 第二轮,现场编码。它不出题,只计时;你写完按回车,它直接 import 你的 `run`,用 `check_loop` 的 8 条用例判卷。
- 第三轮,系统设计。从客服和 Deep Research 两道题里随机抽一道,打印七步的时间表,计时;讲完以后,从 bank5 抽 2 道追问。
- 题目成绩照旧写进 `log.jsonl`,这样 `weak.py` 能接着用;整场的汇总(编码几条、设计用了几分钟)写进另一份 `mock_log.jsonl`。

为什么要两份日志,在练习 2 会实跑一次给你看。

```python
# agent-zero-lab/part09/review/mock.py
import importlib
import json
import random
import sys
import time
from datetime import datetime
from pathlib import Path

from part09.live.check_loop import CASES
from part09.quiz import LIMIT, LOG, ask, load_all

MOCK_LOG = Path("part09/interview/mock_log.jsonl")
DESIGNS = ["设计一个每天 1 万张工单的企业客服 Agent", "设计一个 10 分钟交带引用报告的 Deep Research Agent"]
STEPS = "需求 5 → 指标 3 → 架构 12 → 数据 4 → 评测 6 → 风险 4 → 成本 4(分钟)"


def load_latest() -> dict[str, dict]:
    latest: dict[str, dict] = {}
    if LOG.exists():
        for line in LOG.read_text(encoding="utf-8").splitlines():
            rec = json.loads(line)
            latest[rec["id"]] = rec
    return latest


def priority(item: dict, latest: dict[str, dict]) -> int:
    r = latest.get(item["id"])
    if r is None:
        return 1
    if r["score"] < 2 or r["secs"] > LIMIT:
        return 0
    return 2


def pick(items: list[dict], latest: dict[str, dict], n: int) -> list[dict]:
    shuffled = random.sample(items, len(items))
    return sorted(shuffled, key=lambda it: priority(it, latest))[:n]


def grade(module: str) -> int:
    run = importlib.import_module(module).run
    passed = 0
    for case in CASES:
        try:
            passed += bool(case(run))
        except Exception:
            pass
    return passed


if __name__ == "__main__":
    module = sys.argv[1] if len(sys.argv) > 1 else "part09.review.my_run"
    latest = load_latest()
    bank = [it for it in load_all() if it["id"] not in {str(i) for i in range(1, 14)} and not it["id"].startswith("加")]
    basics = pick([it for it in bank if not it["id"].startswith("追")], latest, 3)
    follows = pick([it for it in bank if it["id"].startswith("追")], latest, 2)

    print("第一轮 · 基础题 3 道")
    records = [ask(it) for it in basics]

    print(f"\n第二轮 · 现场编码:关掉补全,10 分钟写 {module.replace('.', '/')}.py 的 run")
    start = time.perf_counter()
    input("写完按回车 > ")
    minutes = round((time.perf_counter() - start) / 60, 1)
    passed = grade(module)
    print(f"用时 {minutes} 分钟,判卷 {passed}/{len(CASES)}")

    topic = random.choice(DESIGNS)
    print(f"\n第三轮 · 系统设计:{topic}\n  时间表 {STEPS}")
    start = time.perf_counter()
    input("讲完按回车 > ")
    design_min = round((time.perf_counter() - start) / 60, 1)
    print(f"用时 {design_min} 分钟,接下来面试官追问:")
    records += [ask(it) for it in follows]

    with LOG.open("a", encoding="utf-8") as f:
        for rec in records:
            f.write(json.dumps(rec, ensure_ascii=False) + "\n")
    summary = {"at": datetime.now().isoformat(timespec="seconds"), "questions": [r["id"] for r in records],
               "q_score": sum(r["score"] for r in records), "code_min": minutes, "code_pass": passed,
               "design": topic, "design_min": design_min}
    with MOCK_LOG.open("a", encoding="utf-8") as f:
        f.write(json.dumps(summary, ensure_ascii=False) + "\n")
    print(f"\n题目 {summary['q_score']}/{2 * len(records)} 分,编码 {passed}/{len(CASES)},已记录到 {MOCK_LOG}")
```

<div class="line-notes">

- `from part09.live.check_loop import CASES` 直接复用 Day 507 判卷脚本的 8 条用例。`check_loop.py` 的运行部分在 `if __name__` 下面,import 时不会去读命令行参数。
- `from part09.quiz import LIMIT, LOG, ask, load_all` 出题、计时、自评全用 Day 502 的 `ask`,读题库用 Day 504 的 `load_all`。一行检查逻辑都没复制。
- `DESIGNS = [` 本周的两道设计题。你以后练了别的设计题,往这个列表里加一行就行。
- `STEPS = "需求 5 → 指标 3 → 架构 12 →` Day 508 七步框架的时间分配,打印出来提醒自己架构别讲超时。
- `def load_latest() -> dict[str, dict]:` 和 `weak.py` 开头那段一样:同一道题答过多次,只留最后一次。`if LOG.exists():` 让第一次用、还没有日志的人也能跑。
- `def priority(item: dict, latest: dict[str, dict]) -> int:` 给每道题一个优先级数字,越小越先抽:0 是要回炉的,1 是没抽过的,2 是已经答好的。回炉的判断和 `weak.py` 完全一样:不到 2 分,或者超过 120 秒。
- `r = latest.get(item["id"])` 字典的 `.get` 取不到时返回 None 而不是抛 `KeyError`,相当于 JS 里 `latest[id]` 拿到 `undefined`。
- `shuffled = random.sample(items, len(items))` 先把题目整体打乱。`random.sample(列表, 全长)` 返回一个打乱后的新列表,原列表不动。
- `return sorted(shuffled, key=lambda it: priority(it, latest))[:n]` 再按优先级排序。Python 的 `sorted` 是稳定排序,优先级相同的题保持打乱后的顺序,所以同一档里是随机的。最后切前 n 道。
- `def grade(module: str) -> int:` 判卷:按模块名 import 你的代码,把 8 条用例跑一遍,返回过了几条。逻辑和 `check_loop.py` 的主程序一样,只是不打印每一条。
- `bank = [it for it in load_all() if it["id"] not in {str(i) for i in range(1, 14)} and not it["id"].startswith("加")]` 只用本周的题。bank1 的编号是 1 到 13 和「加1」到「加4」,`{str(i) for i in range(1, 14)}` 是集合推导式,得到字符串 "1" 到 "13"。注意编号是字符串,写成数字就一道都排除不掉。
- `basics = pick([it for it in bank if not it["id"].startswith("追")], latest, 3)` 基础题从 bank2 到 bank4 里挑,也就是排除「追」开头的。
- `follows = pick([it for it in bank if it["id"].startswith("追")], latest, 2)` 追问只从 bank5 里挑 2 道。
- `records = [ask(it) for it in basics]` 三道基础题依次问,每道得到一条记录。
- `print(f"\n第二轮 · 现场编码:关掉补全,10 分钟写 {module.replace('.', '/')}.py 的 run")` 把模块名 `part09.review.my_run` 换成路径 `part09/review/my_run`,告诉你该写哪个文件。
- `minutes = round((time.perf_counter() - start) / 60, 1)` 计时换成分钟,保留一位小数。
- `passed = grade(module)` 你按回车的那一刻才 import 你的文件。所以要先写完、保存,再按回车。
- `records += [ask(it) for it in follows]` 设计讲完再问追问,两道追问的记录接到前面三道基础题后面。
- `with LOG.open("a", encoding="utf-8") as f:` 五道题的记录追加进原来的答题日志,`weak.py` 下次就能看到。
- `summary = {` 整场的汇总:问了哪几道、题目总分、编码用时和判卷结果、设计题和用时。
- `with MOCK_LOG.open("a", encoding="utf-8") as f:` 汇总写进**另一份**日志。编码成绩和设计用时不是题库里的题,不能混进 `log.jsonl`。

</div>

和以前一样,为了把输出贴进文章,我用管道模拟按键(每道题先一个回车表示答完,再给一个分数;编码和设计各一个回车)。你自己练的时候直接运行,真的出声答,真的写 10 分钟代码:

```bash
( echo; echo 1; echo; echo 2; echo; echo 0; echo; echo; echo; echo 1; echo; echo 2 ) | uv run python -m part09.review.mock
```

```text
第一轮 · 基础题 3 道

【46】Skills 是什么?和 MCP 工具、prompt 有什么区别?
出声答完按回车 > 用时 0.0 秒
  要点: 按需加载的能力包:说明 + 脚本 + 资料
  要点: 平时只放名字和描述,渐进式披露
  要点: 工具管能做什么,Skill 管怎么做
自评 0 没答出 / 1 答了一半 / 2 都答到 > 
【35】Agent 常见的失败模式有哪些?分别怎么处理?
出声答完按回车 > 用时 0.0 秒
  要点: 死循环:步数 + 重复检测
  要点: 工具名/参数错:校验回传
  要点: 超时降级、提前宣布完成、兜底转人工
自评 0 没答出 / 1 答了一半 / 2 都答到 > 
【43】MCP 是什么?解决什么问题?
出声答完按回车 > 用时 0.0 秒
  要点: 应用和工具之间的开放协议
  要点: M×N 集成变 M+N
  要点: tools/resources/prompts,JSON-RPC,stdio 和 Streamable HTTP
自评 0 没答出 / 1 答了一半 / 2 都答到 > 
第二轮 · 现场编码:关掉补全,10 分钟写 part09/review/my_run.py 的 run
写完按回车 > 用时 0.0 分钟,判卷 8/8

第三轮 · 系统设计:设计一个 10 分钟交带引用报告的 Deep Research Agent
  时间表 需求 5 → 指标 3 → 架构 12 → 数据 4 → 评测 6 → 风险 4 → 成本 4(分钟)
讲完按回车 > 用时 0.0 分钟,接下来面试官追问:

【追3】换模型怎么评估?
出声答完按回车 > 用时 0.0 秒
  要点: 离线全量跑评测集
  要点: 影子模式对比
  要点: 再灰度,看线上指标
自评 0 没答出 / 1 答了一半 / 2 都答到 > 
【追8】延迟太高怎么办?
出声答完按回车 > 用时 0.0 秒
  要点: 先量时间花在哪
  要点: 流式、并行、小模型做前置
  要点: 预先检索
自评 0 没答出 / 1 答了一半 / 2 都答到 > 
题目 6/10 分,编码 8/8,已记录到 part09/interview/mock_log.jsonl
```

对照跑之前的回炉清单看抽题有没有按优先级走。跑之前 `weak.py` 列出的回炉题里,基础题有 17、35、46(都是 0 分)和 20、31、43(1 分),追问有追3(1 分)。三道基础题抽到的 46、35、43 全在回炉清单里,两道追问里追3 也是回炉题,剩下一个名额才轮到没抽过的追8。

再跑一次 `weak.py`:

```bash
uv run python -m part09.weak
```

```text
题库 79 题,答过 13 题,要回炉 6 题
  [0分 0.0秒] 17. 工具有上百个时怎么办?… → 回去看 Day 184、Day 185
  [0分 0.0秒] 43. MCP 是什么?解决什么问题?… → 回去看 Day 271、Day 273、Day 274、Day 276
  [1分 0.0秒] 20. 工具返回结果太长(比如 500 条记录)… → 回去看 Day 191、Day 183
  [1分 0.0秒] 31. ReAct 是什么?原生 functio… → 回去看 Day 172、Day 175
  [1分 0.0秒] 46. Skills 是什么?和 MCP 工具、… → 回去看 Day 296、Day 297
  [1分 0.0秒] 追3. 换模型怎么评估?… → 回去看 Day 374、Day 375
```

(最后一行「还没抽到过」很长,我没贴。)35 这次答到 2 分,从清单上消失了;46 从 0 分升到 1 分,还在;43 从 1 分掉到 0 分,排到了前面。`weak.py` 只看每道题**最后一次**的成绩,所以这份清单跟着你每次的表现变。连续几场模拟面试下来,清单会越来越短,剩下的就是你真正的弱项。

### 零件和大代码的对照

| 零件 | 来自哪天 | 在 mock.py 哪一段 |
| --- | --- | --- |
| `ask`、`read_score`、`LIMIT`、`LOG` | Day 502 `quiz.py` | 第一轮和追问:出题、计时、自评 |
| `load_all` 读全部 `bank*.json` | Day 504 | `bank = [...]` |
| 「只留最后一次」+ 回炉条件 | Day 502 `weak.py` | `load_latest`、`priority` |
| bank3、bank4 的题 | Day 505、506 | 第一轮的题源 |
| `CASES` 8 条用例 + 按模块名 import | Day 507 `check_loop.py` + 练习 3 | `grade`,第二轮 |
| 七步框架和时间分配 | Day 508 | `STEPS`,第三轮 |
| 两道设计题 + bank5 追问 | Day 508、509 | `DESIGNS`、`follows` |

## 本周错题与坑清单

这一周真实踩过的坑,按出现的先后排。复习时每条都问自己:我现在还会不会再踩?

| 坑 | 出在哪天 | 现象 | 怎么防 |
| --- | --- | --- | --- |
| 新数据只改了写入没改读取 | 504、510 | 日志有了第二套题,`weak.py` 只读第一套,`KeyError: '25'` | 读写两头一起改;`load_all` 按 `bank*.json` 自动找 |
| 把 `arguments` 当字典 | 504 | `TypeError: string indices must be integers` | 它是 JSON 字符串,先 `json.loads` |
| schema 写了 enum 就不校验 | 504 | 模型照样给出 `unpaid` | 应用侧再校验一次 |
| 让模型在长结果里数数 | 504 | 两次温度 0 分别答 34 和 24,真实是 43 | 确定性计算交给代码 |
| 节点返回的是更新不是新状态 | 505 | 并行写同一个键 `InvalidUpdateError` | 给键配 reducer |
| 把 `recursion_limit` 当步数保护 | 505 | 默认上限非常大,卡死的图要很久才停 | 路由函数里自己按步数和花费判断 |
| 长对话直接截断 | 505 | 模型说「没有你之前提到的争议发票」 | 先摘要再截断,接近上限才做 |
| 被 import 的脚本没有 `__main__` 保护 | 502、505 | 一 import 就把实验请求又发一遍 | 会发请求的脚本运行部分全放进保护 |
| 只报 pass@k | 506 | 0.90 把一张三次错两次的工单藏起来 | 客服类看 pass^k 或单次准确率 |
| 两两比较只跑一个顺序 | 506 | 交换顺序 4 组改判 2 组 | 至少交换一次,不一致算平局 |
| 注入几次没成功就说防住了 | 506、509 | 20 次 0 成功,上界仍有约 14% | 防线放在权限上 |
| `while True` 没上限 | 507 | 判卷卡到第 21 次 | 第一行就写 `for _ in range(max_steps)` |
| `<=` 多转一圈 | 510 | `max_steps=3` 调了 4 次 | 用 `range`,不自己管计数器 |
| 没放回 assistant 或只放回文字 | 507、510 | 真接口 400;7 条用例的判卷查不出 | `model_dump(exclude_none=True)` 原样放回 |
| `try` 包太大或解析在 `try` 外 | 507、510 | 内部错误被误报成工具不存在,或 `JSONDecodeError` 冲出循环 | 查找和执行分开,解析放进执行的 `try` |
| 判卷全过就当没问题 | 507 | 7/7 但真接口 400 | 全过以后用真模型跑一次 |
| 用例写成值 | 510 | 一条用例抛异常,检查脚本整个崩掉 | 用例写成函数或 `lambda`,逐条 `try` |
| 记成近似公式 | 510 | pass@3 算成 0.42 而不是 0.5 | 记清估计的是什么,用组合数 |
| 按平均值开 worker | 508 | 平均 17.1,P99 是 27 | 模拟或留余量 |
| 假设之间对不上 | 508 | 1 万单 × 8 分钟 ≈ 222 人,不是 40 人 | 算一行隐含人数 |
| 子 Agent 派活不说交回什么 | 509 | 一个研究员找不存在的链接跑满步数 | 派活写清交付物和停止条件 |
| 研究题默认多 Agent | 509 | 多花 3.5 倍 token、慢一倍 | 先判断一个上下文装不装得下 |

## 动手练习

### 练习 1:看自己的进步

`mock_log.jsonl` 攒了几场以后,你想知道自己有没有进步。写一个脚本,把每一场的时间、题目得分、编码判卷、编码用时、设计题打成一张表,最后和上一场比:题目差几分,编码差几条。先再跑一场模拟面试,让日志里至少有两条。

<details><summary>参考答案</summary>

先再跑一场(同样用管道模拟,你自己是真答):

```bash
( echo; echo 2; echo; echo 1; echo; echo 2; echo; echo; echo; echo 2; echo; echo 1 ) | uv run python -m part09.review.mock | grep -E '^【|题目|判卷|系统设计'
```

```text
【20】工具返回结果太长(比如 500 条记录)怎么办?
【17】工具有上百个时怎么办?
【43】MCP 是什么?解决什么问题?
写完按回车 > 用时 0.0 分钟,判卷 8/8
第三轮 · 系统设计:设计一个 10 分钟交带引用报告的 Deep Research Agent
【追3】换模型怎么评估?
【追14】怎么保护用户隐私?
题目 8/10 分,编码 8/8,已记录到 part09/interview/mock_log.jsonl
```

`grep -E '^【|题目|判卷|系统设计'` 只留下这几种开头的行,方便看抽到了哪些题。三道基础题又全是回炉题(17、43 是 0 分,20 是 1 分)。设计题又抽到了 Deep Research,`random.choice` 两次碰上同一道是正常的,两道题各一半的概率。

```python
# agent-zero-lab/part09/ex/ex510_trend.py
import json

from part09.review.mock import MOCK_LOG

rows = [json.loads(line) for line in MOCK_LOG.read_text(encoding="utf-8").splitlines()]
print("时间                 题目   编码  编码分钟  设计题")
for r in rows:
    full = 2 * len(r["questions"])
    topic = "客服" if "客服" in r["design"] else "Deep Research"
    print(f"{r['at']:<20} {r['q_score']:>2}/{full:<3} {r['code_pass']}/8  {r['code_min']:>6}    {topic}")
if len(rows) >= 2:
    a, b = rows[-2], rows[-1]
    print(f"\n和上一次比:题目 {b['q_score'] - a['q_score']:+d} 分,编码 {b['code_pass'] - a['code_pass']:+d} 条")
```

<div class="line-notes">

- `from part09.review.mock import MOCK_LOG` 只借路径常量。`mock.py` 的主程序在 `__main__` 保护下面,import 不会开始一场面试。
- `rows = [json.loads(line) for line in MOCK_LOG.read_text(encoding="utf-8").splitlines()]` 每行一场,解析成字典列表。实跑有 2 场。
- `full = 2 * len(r["questions"])` 满分是题数乘 2。这里是 5 道,满分 10。
- `topic = "客服" if "客服" in r["design"] else "Deep Research"` 题目全名太长,表里只放一个短名字。我第一版直接切片 `r["design"][5:15]`,打出来是「10 分钟交带引用报」,看不出是哪道题。
- `{r['q_score']:>2}/{full:<3}` `>2` 右对齐占 2 格,`<3` 左对齐占 3 格,让各行的斜杠对齐。
- `a, b = rows[-2], rows[-1]` 倒数第二场和最后一场。
- `{b['q_score'] - a['q_score']:+d}` `+d` 让正数也带上加号,+2 比 2 更像「变化量」。

</div>

```bash
uv run python -m part09.ex.ex510_trend
```

```text
时间                 题目   编码  编码分钟  设计题
2026-10-22T23:49:32   6/10  8/8     0.0    Deep Research
2026-10-22T23:52:58   8/10  8/8     0.0    Deep Research

和上一次比:题目 +2 分,编码 +0 条
```

题目从 6 分到 8 分。不过要注意,自评分是你自己打的,前后标准不一定一样;编码那一列是判卷脚本给的,标准不会变,更可信。真正练的时候,编码用时那一列最有用:看它从十几分钟一天天降到 10 分钟以内。

</details>

### 练习 2:观察题。编码成绩能不能也写进 `log.jsonl`

`mock.py` 把编码成绩写进了另一份日志。有人觉得两份日志麻烦,想把编码成绩也当成一道「题」写进 `log.jsonl`,编号叫 `code`。先猜会发生什么,然后往 `log.jsonl` 末尾手动追加一行 `{"id": "code", "secs": 540.0, "score": 2, "at": "2026-10-22T23:55:00"}`(写了 9 分钟,判卷全过,记 2 分),跑 `weak.py` 看看。最后给出两种修法,说说你选哪种。

<details><summary>参考答案</summary>

```bash
cp part09/interview/log.jsonl part09/interview/log.bak
echo '{"id": "code", "secs": 540.0, "score": 2, "at": "2026-10-22T23:55:00"}' >> part09/interview/log.jsonl
uv run python -m part09.weak
```

第一行先把日志备份一份,做完实验好还原。`>>` 是追加到文件末尾,一个 `>` 会把整个文件覆盖掉,别打错。

```text
题库 79 题,答过 15 题,要回炉 5 题
  [1分 0.0秒] 17. 工具有上百个时怎么办?… → 回去看 Day 184、Day 185
  [1分 0.0秒] 31. ReAct 是什么?原生 functio… → 回去看 Day 172、Day 175
  [1分 0.0秒] 46. Skills 是什么?和 MCP 工具、… → 回去看 Day 296、Day 297
  [1分 0.0秒] 追14. 怎么保护用户隐私?… → 回去看 Day 416、Day 367
Traceback (most recent call last):
  ...
    item = bank[r["id"]]
           ~~~~^^^^^^^^^
KeyError: 'code'
```

又是 Day 504 那个 `KeyError`,只是这次是反过来的:日志里多了一个题库里没有的编号。明明记的是 2 分,为什么还进了回炉清单?因为回炉条件是 `score < 2 or secs > LIMIT`,`LIMIT` 是 120 秒,这是给一道口答题定的时间;编码写了 540 秒,当然超了。这说明「编码」和「口答题」的成绩口径根本不一样,硬塞进同一张表,连判断规则都对不上。它排在最后才炸,是因为 `sorted` 按分数排,2 分的排在 1 分的后面。

修法一:让 `weak.py` 跳过题库里没有的编号。

```python
# agent-zero-lab/part09/ex/ex510_weak_safe.py
import json

from part09.quiz import LIMIT, LOG, load_all

latest: dict[str, dict] = {}
for line in LOG.read_text(encoding="utf-8").splitlines():
    rec = json.loads(line)
    latest[rec["id"]] = rec

bank = {item["id"]: item for item in load_all()}
unknown = sorted(set(latest) - set(bank))
if unknown:
    print(f"日志里有题库没有的编号,跳过:{unknown}")
todo = [r for r in latest.values() if r["id"] in bank and (r["score"] < 2 or r["secs"] > LIMIT)]
print(f"题库 {len(bank)} 题,答过 {len(latest) - len(unknown)} 题,要回炉 {len(todo)} 题")
for r in sorted(todo, key=lambda r: r["score"]):
    item = bank[r["id"]]
    print(f"  [{r['score']}分] {item['id']}. {item['q'][:20]}…")
```

<div class="line-notes">

- `unknown = sorted(set(latest) - set(bank))` 日志里出现过、题库里没有的编号。`set(字典)` 得到字典所有键的集合,`-` 是差集。
- `if unknown:` 不是悄悄跳过,而是打印出来。悄悄跳过的话,你哪天把题库文件改名了,所有记录都被跳过,你还以为全答好了。
- `todo = [r for r in latest.values() if r["id"] in bank and (` 先确认编号在题库里,再判断要不要回炉。`and` 左边是 False 时右边不会算,和 JS 的 `&&` 一样短路。

</div>

```bash
uv run python -m part09.ex.ex510_weak_safe
cp part09/interview/log.bak part09/interview/log.jsonl
```

```text
日志里有题库没有的编号,跳过:['code']
题库 79 题,答过 14 题,要回炉 4 题
  [1分] 17. 工具有上百个时怎么办?…
  [1分] 31. ReAct 是什么?原生 functio…
  [1分] 46. Skills 是什么?和 MCP 工具、…
  [1分] 追14. 怎么保护用户隐私?…
```

修法二就是 `mock.py` 现在的做法:编码成绩不进 `log.jsonl`,另存一份。

我两种都要。修法二是根本:不同口径的数据分开放,`log.jsonl` 里只有题库里的题。修法一是防御:就算哪天有人(很可能是三个月后的你)又往里塞了别的东西,`weak.py` 也不会崩,而且会告诉你塞了什么。这和 RAG 里「只往索引里放同一种切块」「检索时遇到不认识的文档 ID 要报出来」是同一个思路。

</details>

### 练习 3:给判卷脚本补一条「截断」用例

Day 507 的得分点表里有一条「工具结果截断」,但 `check_loop` 的 8 条用例没有一条检查它。写 `part09/ex/ex510_truncate.py`:加一个会返回 1000 条记录的工具,补一条 `case_truncate`,检查交回模型的 tool 消息不超过 4000 个字符;把原来 8 条和新的一条一起跑,测参考答案、`attempt1.py` 和你的默写版。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part09/ex/ex510_truncate.py
import importlib
import sys

from part09.live.check_loop import CASES, FakeClient, reply, tool_msgs


def big(n: int) -> dict:
    return {"rows": ["x" * 10] * n}


BIG_TOOLS = {"big": (big, {"type": "function", "function": {"name": "big", "parameters": {}}})}


def case_truncate(run):
    c = FakeClient([reply(calls=[("c1", "big", '{"n": 1000}')]), reply("好")])
    run(c, "m", "q", BIG_TOOLS)
    return len(tool_msgs(c)[0]["content"]) <= 4000


if __name__ == "__main__":
    run = importlib.import_module(sys.argv[1]).run
    for case in [*CASES, case_truncate]:
        try:
            ok = bool(case(run))
        except Exception as e:
            ok = False
            print(f"   {case.__name__} 抛了 {type(e).__name__}")
        print(f"{'通过' if ok else '没过'}  {case.__name__}")
```

<div class="line-notes">

- `from part09.live.check_loop import CASES, FakeClient, reply, tool_msgs` 不改 Day 507 的文件,把需要的零件全借过来。
- `return {"rows": ["x" * 10] * n}` `"x" * 10` 是十个 x,`[...] * n` 是把列表重复 n 次,和 JS 的 `Array(n).fill("xxxxxxxxxx")` 一样。n=1000 时序列化出来是 14010 个字符。
- `BIG_TOOLS = {"big": (big,` 判卷用自己的工具表,格式和 `TOOLS` 一样:名字对应 `(函数, schema)`。
- `c = FakeClient([reply(calls=[("c1", "big", '{"n": 1000}')]), reply("好")])` 模型第一轮要 1000 条,第二轮直接回答。
- `return len(tool_msgs(c)[0]["content"]) <= 4000` 看第二次请求里那条 tool 消息的长度。参考答案截到 4000,所以正好是 4000。
- `for case in [*CASES, case_truncate]:` `*CASES` 把原来的 8 条展开,再接上新的一条,相当于 JS 的 `[...CASES, caseTruncate]`。

</div>

```bash
for m in part09.live.mini_agent part09.live.attempt1 part09.review.my_run; do echo "== $m"; uv run python -m part09.ex.ex510_truncate $m | tail -2; done
```

`for m in A B C; do ...; done` 是 shell 的循环,对三个模块各跑一次;`tail -2` 只看最后两行,也就是练习 3 那条和新补的这条。

```text
== part09.live.mini_agent
通过  case_assistant_kept
通过  case_truncate
== part09.live.attempt1
没过  case_assistant_kept
没过  case_truncate
== part09.review.my_run
通过  case_assistant_kept
通过  case_truncate
```

`attempt1.py` 又多挂了一条:它的 `json.dumps(result, ensure_ascii=False)` 后面没有 `[:4000]`,14010 个字符原样塞回了历史。在真实场景里,这就是 Day 504 实验三那种「500 条记录把模型算糊涂」的起点,而且每多转一圈,这 14000 个字符都要重新算一次输入费。

`[:4000]` 是按字符截,不是按 token 截,中文一个字大约对应一个多 token,英文四个字符左右一个 token,所以 4000 个字符换成 token 数,中英文差好几倍。面试时写这一行,顺口说一句「正式代码我会按 token 截,并在结果里告诉模型被截了、怎么翻页」,就是 Day 504 练习里分页那道题的答案。

</details>

**验收标准**

- `check_loop` 对你的默写版 8/8,而且是关掉补全、10 分钟内写出来的。
- `check_week73` 对你的 `mine73.py` 8/8,能说出 `1 − (1 − c/n)^k` 和组合数公式各在估计什么。
- `mock.py` 至少跑过一场真答的,`mock_log.jsonl` 里有记录,`weak.py` 的清单跟着变了。
- 错题清单里每一条,你都能不翻表说出现象和防法。

## 名词解释

复习日没有新概念,这里列本周最常用、最容易混的几个,每个后面是它首次出现或主要讲解的那一天。

| 名词 | 意思 |
| --- | --- |
| 题库 / 回炉 | `bank*.json` 里的题;最后一次不到 2 分或超时的题要重答(Day 502、504) |
| `load_all` | 按 `bank*.json` 找出所有题库并合并,加新题库不用改代码(Day 504) |
| reducer | LangGraph 里决定「节点返回的更新怎么合并进状态」的函数(Day 505 复习) |
| pass@k / pass^k | 跑 k 次至少一次对 / 每次都对的概率,前者看上限,后者看稳定(Day 506) |
| 位置偏差 | LLM 评委倾向于某个位置的答案,交换顺序会改判(Day 506) |
| 判卷脚本 | 用假客户端和固定用例给 `run` 打分,不联网不花钱(Day 507) |
| `call_key` | 工具名 + 排序后的参数 JSON,重复检测的依据(Day 507) |
| 七步框架 | 需求、指标、架构、数据、评测、风险、成本(Day 508) |
| 利特尔法则 | 同时在处理的数量 = 到达率 × 处理时间,L = λ × W(Day 508) |
| 派活说明 | 主 Agent 给子 Agent 的任务描述,要写清交付物和停止条件(Day 509) |
| `lambda` | 一行写成的匿名函数,`lambda: 表达式` 相当于 JS 的 `() => 表达式`,调用时才求值(今天的检查脚本) |
| 稳定排序 | 排序键相同的元素保持原来的先后顺序,`mock.py` 靠它在同一优先级里保持随机(今天) |

## 常见误区

**复习日把文章再读一遍就算复习了。** 读懂和写得出是两回事。今天两份默写稿加起来六处错,全是这一周讲过的点:`<=`、只放回文字、解析在 `try` 外、没 `sort_keys`、坏 JSON、记成近似公式。

**判卷 8/8 就不用跑真模型。** 8 条用例是 Day 507 练习 3 被真接口 400 教训过以后才补到 8 条的。今天练习 3 又找到一条没覆盖的(截断)。用例永远是你想到的那些,真接口才是全部规则。

**检查脚本出错了,以为是被测代码有问题。** 今天第一版 `check_week73` 一个结果都没打出来就崩了,原因在检查脚本自己:用例写成了值,建列表时就执行了。用例写成函数,逐条 `try`。

**模拟面试挑自己熟的题练。** `mock.py` 按「回炉、没抽过、答好了」的顺序抽题,就是为了不让你挑。真面试官不会只问你准备好的。

**所有成绩都往一份日志里写。** 口答题、编码、设计的成绩口径不同,回炉规则也不同。今天练习 2 把编码成绩塞进 `log.jsonl`,`weak.py` 当场 `KeyError`,就算不崩,120 秒的超时规则套在 9 分钟的编码上也没有意义。

**自评分涨了就是进步了。** 自评标准会松动。判卷结果和用时是客观的,看进步先看这两列。

## 学习资料

### 文档与文章

- [Python 文档 · 表达式(lambda)](https://docs.python.org/zh-cn/3.12/reference/expressions.html#lambda):中文,`lambda` 的定义只有一小段,今天检查脚本改版用的就是它,5 分钟。
- [Python 文档 · math.comb](https://docs.python.org/zh-cn/3.12/library/math.html#math.comb):组合数函数,`pass_at_k` 和 `pass_hat_k` 都靠它。
- [Python 文档 · importlib](https://docs.python.org/zh-cn/3.12/library/importlib.html):`import_module` 按字符串名字导入模块,`check_loop` 和 `mock.py` 判卷都靠它,看 `import_module` 一节就够。
- [Tech Interview Handbook · Coding interview prep](https://www.techinterviewhandbook.org/coding-interview-prep/):讲的是算法面试的准备节奏,「怎么安排练习、怎么模拟」那部分对今天的模拟面试同样适用。
- [Anthropic · Building effective agents](https://www.anthropic.com/engineering/building-effective-agents):这一周三种题型里都会被引用的一篇,模拟面试前再读一遍「什么时候用 workflow」那一节。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1aQMX6oEni&autoplay=0&high_quality=1" title="【Agent面经】目前B站最细的（AI Agent）高频面试八股文，吊打付费，帮你避开99%面试坑！存下吧，很难找全的！" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>Agent开发实战 · 【Agent面经】AI Agent 高频面试八股文 · 两个多小时的合集,标题很营销,内容是一题一题过。别从头看,拿它当「别人题库里有、我题库里没有」的检查表:翻目录,挑你 bank2 到 bank5 里没覆盖的题听,听完自己补进题库。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/I9-PUPYZyiw" title="Design ChatGPT - System Design Mock Interview (with eBay EM)" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Aced (formerly Exponent) · Design ChatGPT - System Design Mock Interview (with eBay EM) · 英文,一场完整的「设计 ChatGPT」模拟面试。重点看候选人开头几分钟怎么问需求、怎么说假设,对照 Day 508 七步框架的前两步,再看面试官在哪几处打断追问。</figcaption>
</figure>

### 书籍

- Alex Xu《System Design Interview – An Insider's Guide》(Byte Code LLC,2020):Day 508 推荐过,复习时重读第 3 章的四步框架,对照今天的 `STEPS` 时间表,看看哪几步是 Agent 题额外加的。
- Gayle Laakmann McDowell《Cracking the Coding Interview》(第 6 版,CareerCup,2015;中文版《程序员面试金典(第 6 版)》,人民邮电出版社):Day 507 推荐过,开头几章讲面试当天的流程和边想边说,做模拟面试前读那几章,40 分钟。

### 开源项目与代码

- [yangshun/tech-interview-handbook](https://github.com/yangshun/tech-interview-handbook):上面那个网站的源码仓库,面试准备的部分都是 Markdown,可以直接在 GitHub 上读。
- [openai/openai-python](https://github.com/openai/openai-python):判卷脚本里 `ChatCompletion.model_validate` 造的那些类型都在 `src/openai/types/chat/` 下面,想知道一个响应对象有哪些字段,读这里比猜快。

## 自测

1. 默写 `run` 时写成 `while step <= max_steps`(step 从 0 开始,进循环先加 1),`max_steps=3` 会调几次模型?为什么返回值看不出问题?

<details><summary>答案</summary>

4 次。step 为 0、1、2、3 时都满足 `<= 3`,进循环 4 次。返回值照样是「步数超限,已转人工」,看起来完全正常,只有数调用次数才发现。用 `for _ in range(max_steps)` 就不会有这个问题,判卷脚本的 `case_step_limit` 检查的正是调用次数。

</details>

2. 只放回 `{"role": "assistant", "content": msg.content}`,7 条用例的判卷脚本能抓到吗?真接口会怎样?

<details><summary>答案</summary>

抓不到。7 条用例里只检查了第二次请求的角色顺序是 user、assistant、tool,这份写法有 assistant,只是没有 `tool_calls`。真接口直接 400:「Messages with role 'tool' must be a response to a preceding message with 'tool_calls'」。Day 507 练习 3 补的 `case_assistant_kept` 专门查这一点,所以今天用 8 条判。

</details>

3. `check_week73` 第一版为什么一个结果都没打印就崩了?怎么改?

<details><summary>答案</summary>

用例的第二个元素写成了值,Python 建 `CASES` 列表时就把每个表达式当场算了一遍,第四条的 `call_key` 遇到坏 JSON 抛异常,整个列表建不起来,循环没机会跑。改成 `lambda: ...`,建列表时只建函数,循环里再逐条 `try` 着调用,一条出错只影响它自己。Day 507 的 `check_loop` 把每条用例写成 `def case_xxx(run)` 是同一个道理。

</details>

4. `mock.py` 为什么把编码成绩写进另一份日志?

<details><summary>答案</summary>

`weak.py` 会拿日志里的每个编号去题库里查,编码成绩的编号题库里没有,一查就 `KeyError`;而且回炉规则(不到 2 分或超过 120 秒)是为口答题定的,9 分钟的编码一定被判超时。不同口径的数据分开放,`log.jsonl` 里只有题库里的题。

</details>

5. (面试题)「你怎么测你写的 Agent 循环?」用这一周的东西答。

<details><summary>答案</summary>

分两层。第一层是不花钱的离线测试:做一个假客户端,它有和真 SDK 一样的 `chat.completions.create`,返回用 `ChatCompletion.model_validate` 造出来的真实类型,按脚本依次返回预设的回复。用它把每个分支都喂一遍:直接回答、一个工具、两个工具 id 对应、工具不存在、参数是半截 JSON、工具内部报错、步数上限、assistant 消息带着 tool_calls 放回去、工具结果截断,一共九条,一秒跑完。第二层是少量真模型调用,因为假客户端只能查我想到的规则,协议的全部规则只有真接口知道;我就遇到过判卷全过、真接口 400 的情况,原因是放回的 assistant 消息丢了 `tool_calls`。上线以后再加第三层:trace 里统计每次运行的步数、重复调用和超时,异常的点开看。

</details>

## 明天预告

Day 511 · 求职(一):数据从哪来,渠道和薪资。题刷完了、代码写熟了,接下来是两个现实问题:去哪儿找岗位,能拿多少钱。明天用 2026 年 10 月抓到的几百条 Agent 岗 JD 说话,先讲清楚这批数据从哪些平台来、每个平台能看到什么看不到什么,再写一个脚本把「30-60K·16薪」这种挂牌薪资折成年包,算中位数和分组,讲清楚口径:为什么网上的「平均月薪 6 万」和你能谈到的数差那么多。
