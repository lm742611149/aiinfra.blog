---
title: 'Day 194 · 失败模式(六):失败了要留下什么'
description: '前五天让 Agent 出事时不崩、不烧钱、不乱说话,今天解决「出事之后怎么查」:每次运行落一行 JSON(JSON Lines),记下每一步模型和工具各花了多久、多少 token、结果多大、最后给用户说了什么,写进磁盘前先脱敏、写失败不拖垮任务。再写一个小脚本按状态筛、按耗时排、把一次运行摊成时间线。实测一次 llm_error 的 8.8 秒全花在重试等待上,一次真模型运行 5 秒里工具只占 0 秒、模型占 5 秒;还抓到一个真坑:一条看起来无害的邮箱正则,遇到 2 万个字符的文本要跑 2.9 秒。'
pubDate: 2026-10-23
regime: none
tags: ['reliability', 'logging', 'observability', 'agent-zero']
series: 'agent-zero'
day: 194
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 193](/blog/agent-zero/day-193-failures-5/) 把四个零件拼成了 `RobustAgent`,补上了收尾 token 记账和 `llm_error` 状态,又用一个按剧本演戏的 `FakeClient` 写了离线测试,九类失败不再有「崩」和「干等」。那一课留了一个口子:`RobustAgent` 的 `_model_step`、`_tool_step` 是给子类覆盖的,`self.llm` 也特意标成了协议类型。

今天用上它。测试证明的是「出事时 Agent 怎么反应」,但线上真出事了,你面对的是另一个问题:**用户说「它刚才回了句废话」,你怎么知道当时发生了什么?** 它在第几步撞的线、之前调了哪些工具、哪一步最慢、花了多少钱、最后到底回了用户什么。没记下来,这些全都只能猜。

## 今天要解决的问题

学完你应该能:

1. 说出为什么 Agent 的日志要写成「一次运行一行 JSON」(JSON Lines),而不是一堆 `print` 出来的句子。
2. 继承 `RobustAgent` 写一个 `LoggedAgent`:不改主循环,给每次模型调用和每次工具调用计时、记 token、记结果大小,运行结束写一行日志。
3. 写进磁盘前先脱敏和截断,日志写失败时不拖垮正在做的任务。
4. 写一个 `triage.py`:从一批日志里按状态筛出出事的运行,按耗时排序,把其中一次摊成时间线,一眼看出时间花在哪。

今天两个新概念:**结构化日志(JSON Lines)** 和 **用继承给已有类加记录功能**。

预计用时 2.5 小时。前置:[Day 193](/blog/agent-zero/day-193-failures-5/)(`robust_agent.py`、`fake_client.py`)、[Day 192](/blog/agent-zero/day-192-failures-4/)(`AgentResult`)、[Day 39](/blog/agent-zero/day-039-json/)(`json`)、[Day 37](/blog/agent-zero/day-037-pathlib/)(`pathlib`)、[Day 38](/blog/agent-zero/day-038-files-with/)(读写文件和 `with`)、[Day 42](/blog/agent-zero/day-042-classes-2/)(继承和 `super()`)。代码在 `agent-zero-lab/part03/` 和 `tests/`,命令都在 `agent-zero-lab/` 根目录跑。今天真调模型的只有 `make_logs.py` 里的两次运行,按未命中价最多约 ¥0.013(算式在文中);我调试时重跑了几遍,总共花了不到 ¥0.06。

学法:先对照文章逐行敲一遍(不复制粘贴)并跑通;第二天合上文章,默写 `TimedChat.chat` 和 `LoggedAgent.run`;做练习,做不出再展开参考答案,看完关掉自己重写一遍。

## 为什么 print 不够

前端调页面出问题时,你会打开 DevTools 的 Network 面板:每个请求一行,有状态码、耗时、大小,点开能看请求头和响应体,还能按「慢的」「失败的」筛。Agent 的日志要做成同样的东西:**每次运行一条记录,每条记录里有结构,能筛、能排序、能点开看细节。**

最顺手的做法是 `print(f"run {id} finished: status={status}, steps={steps}")`,写成一句话。能看,但不好查。下面这个脚本把同一件事写成一句话和写成一行 JSON,然后都想「把步数捞出来」:

```python
# agent-zero-lab/part03/log_formats.py  同一件事,写成一句话和写成一行 JSON,想把「步数」捞出来时差在哪
import json
import re

user_said = "查一下订单,steps=3 的那个"  # 用户的话里碰巧也有 steps=
lines_text = [
    f"run ab12 user said: {user_said} -> finished status=loop steps=4",
    "run cd34 user said: 杭州天气 -> finished status=ok steps=2",
]
lines_json = [
    json.dumps({"run_id": "ab12", "user": user_said, "status": "loop", "steps": 4}, ensure_ascii=False),
    json.dumps({"run_id": "cd34", "user": "杭州天气", "status": "ok", "steps": 2}, ensure_ascii=False),
]

found: list[str] = []
for s in lines_text:
    m = re.search(r"steps=(\d+)", s)  # 找第一个 steps=数字
    found.append(m.group(1) if m else "?")
print("正则从句子里捞 steps:", found, "  <- 第一条应该是 4")
print("从 JSON 里取 steps :", [json.loads(s)["steps"] for s in lines_json])
```

<div class="line-notes">

- `user_said = "查一下订单,steps=3 的那个"  # 用户的话里碰巧也有 steps=` 故意造一个撞车:用户的话里恰好有一段长得像日志字段的文字。真实用户什么都会写。
- `f"run ab12 user said: {user_said} -> finished status=loop steps=4"` 一句话格式:用户的话在中间,真正的步数 `steps=4` 在最后。
- `json.dumps({"run_id": "ab12", "user": user_said, "status": "loop", "steps": 4}, ensure_ascii=False)` JSON 格式:同样的信息,每个字段有名字,用户的话只是 `"user"` 字段的值。`ensure_ascii=False` 让中文保持原样([Day 39](/blog/agent-zero/day-039-json/) 讲过)。
- `m = re.search(r"steps=(\d+)", s)  # 找第一个 steps=数字` 在句子里用正则找。`re.search` 返回第一个匹配,没找到返回 `None`,所以要判断 `if m`。
- `found.append(m.group(1) if m else "?")` `m.group(1)` 取括号里捕获的那一段数字。
- `[json.loads(s)["steps"] for s in lines_json]` JSON 这边是直接按名字取值,不管 `"user"` 里写了什么。

</div>

```bash
cd /Users/你/agent-zero-lab
uv run python -m part03.log_formats
```

```text
正则从句子里捞 steps: ['3', '2']   <- 第一条应该是 4
从 JSON 里取 steps : [4, 2]
```

句子格式的那一边,第一条捞出了 3:正则抓到了用户那句话里的 `steps=3`。你可以再把正则写严一点(「只取最后一个」「只取 `finished` 之后的」),但每多一种格式、每多一个字段,正则就得跟着改,而且用户的话永远可能再撞一次。JSON 这边没有这个问题:**字段有名字,值是什么都不会串位。** 这就是「结构化日志」的意思:日志不是写给人念的句子,是写给程序查的记录,念的时候再让程序把它排版成人话(下面的时间线就是这么做的)。

## JSON Lines:一行一条,追加写

结构化日志常见的存法叫 **JSON Lines**(扩展名 `.jsonl`):文件里**每一行是一个完整的 JSON**,行与行之间没有逗号,也没有外层的方括号。为什么不干脆存成一个大 JSON 数组?下面这个脚本演示:

```python
# agent-zero-lab/part03/jsonl_basics.py  JSON Lines:一行一条记录,追加写;写到一半断电,只坏最后一行
import json
import tempfile
from pathlib import Path

with tempfile.TemporaryDirectory() as tmp:
    path = Path(tmp) / "demo.jsonl"
    for i in range(1, 4):
        with path.open("a", encoding="utf-8") as f:  # "a" 是追加:不动前面已有的内容
            f.write(json.dumps({"run_id": f"r{i}", "status": "ok"}, ensure_ascii=False) + "\n")
    with path.open("a", encoding="utf-8") as f:
        f.write('{"run_id": "r4", "sta')  # 模拟进程在写第 4 行的时候被杀掉

    text = path.read_text(encoding="utf-8")
    print(text)
    good = []
    for line in text.splitlines():
        try:
            good.append(json.loads(line)["run_id"])
        except json.JSONDecodeError:
            print("跳过一行坏的:", line)
    print("按行读,救回来的:", good)
    try:
        json.loads("[" + ",".join(text.splitlines()) + "]")  # 如果当初存成一个大 JSON 数组
    except json.JSONDecodeError as e:
        print("整个当 JSON 读:", type(e).__name__, e)
```

<div class="line-notes">

- `import tempfile` 标准库,在系统临时目录里建个一次性的文件夹,演示完自动删掉,不在你的仓库里留垃圾。
- `with tempfile.TemporaryDirectory() as tmp:` 进入 `with` 块时建目录,离开时(哪怕中途报错)自动删掉。`tmp` 是目录路径字符串。
- `path = Path(tmp) / "demo.jsonl"` `pathlib` 里用 `/` 拼路径,比字符串拼接稳([Day 37](/blog/agent-zero/day-037-pathlib/))。
- `with path.open("a", encoding="utf-8") as f:` 打开文件,模式 `"a"` 是 append(追加):写的内容接在文件末尾,不动前面已有的。反过来 `"w"` 会把整个文件清空重写,日志千万别用它。
- `f.write(json.dumps({"run_id": f"r{i}", "status": "ok"}, ensure_ascii=False) + "\n")` 一条记录转成一行 JSON,末尾加换行符 `\n`。`json.dumps` 默认不会在字符串里产生真正的换行(换行会被转义成 `\n` 两个字符),所以一条记录一定占一行。
- `f.write('{"run_id": "r4", "sta')` 故意只写半行,而且没有换行符,模拟程序写到一半被 `kill -9` 或者断电。
- `for line in text.splitlines():` 按行切开。`splitlines()` 相当于 JS 的 `text.split("\n")`。
- `good.append(json.loads(line)["run_id"])` 每行单独解析,只取 `run_id`。
- `except json.JSONDecodeError:` 半行解析不了,抛 `JSONDecodeError`,接住、跳过这一行,别的行不受影响。
- `json.loads("[" + ",".join(text.splitlines()) + "]")` 模拟「如果当初存成一个大数组」:把所有行用逗号连起来再套上方括号,整个解析。

</div>

```bash
uv run python -m part03.jsonl_basics
```

```text
{"run_id": "r1", "status": "ok"}
{"run_id": "r2", "status": "ok"}
{"run_id": "r3", "status": "ok"}
{"run_id": "r4", "sta
跳过一行坏的: {"run_id": "r4", "sta
按行读,救回来的: ['r1', 'r2', 'r3']
整个当 JSON 读: JSONDecodeError Unterminated string starting at: line 1 column 118 (char 117)
```

三个好处,这里都看到了:

- **追加写不用读旧内容。** 大 JSON 数组每加一条都得读出来、改、整个写回去;`.jsonl` 只在末尾加一行。日志一天几万行也不慢。
- **坏了只坏一行。** 写到一半被杀,损失的只有最后半行,前面三条完好。大数组少一个 `]`,整个文件都读不出来。
- **能用文本工具处理。** `grep '"status": "loop"' runs-2026-10-23.jsonl` 就能筛;`wc -l` 就能数有多少次运行。

这也是 Day 189 到 193 里一直强调「出事时要能从中间恢复」的同一个思路:**别让一次小故障变成全盘丢失。**

## 一次运行该留下什么

先想清楚要回答哪些问题,再决定存什么字段。出了事,你会问:

| 你会问 | 要存的字段 | 从哪来 |
| --- | --- | --- |
| 这是哪次运行?什么时候的? | `run_id`、`time` | 随机生成、当前时间 |
| 用户问了什么? | `user` | 脱敏后的原话 |
| 最后怎么收场的?转人工了吗? | `status`、`error`、`needs_human`、`answer` | `AgentResult` |
| 花了多少钱?几步? | `usage`、`steps` | `AgentResult` |
| 一共多久? | `seconds` | 自己掐表 |
| 有没有被循环检测拦过? | `blocked` | 数 `messages` 里回了 `LOOP_MSG` 的 tool 消息 |
| 每一步模型花了多久、多少 token、要调什么工具? | `events` 里 `type: model` 的项 | 包在 `chat` 外面记 |
| 每个工具花了多久、结果多大、有没有超时或被截断? | `events` 里 `type: tool` 的项 | 覆盖 `_tool_step` 记 |
| 对话里到底说了什么? | `messages` | 脱敏、截断之后的历史 |

<figure>
<svg viewBox="0 0 640 250" role="img" aria-label="LoggedAgent 的结构:RobustAgent 主循环不变,TimedChat 包在 chat 外面记模型事件,_tool_step 覆盖版记工具事件,运行结束把一条记录追加到 jsonl 文件">
  <rect x="0" y="0" width="640" height="250" fill="var(--paper-raised)" rx="6"/>
  <rect x="20" y="30" width="170" height="60" fill="var(--paper)" stroke="var(--ink-soft)" rx="4"/>
  <text x="105" y="52" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">RobustAgent.run</text>
  <text x="105" y="70" text-anchor="middle" font-family="var(--font-mono)" font-size="10" fill="var(--ink-soft)">主循环一行没改</text>
  <rect x="230" y="20" width="180" height="38" fill="var(--mem-wash)" stroke="var(--mem)" rx="4"/>
  <text x="320" y="44" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">TimedChat.chat 记模型事件</text>
  <rect x="230" y="68" width="180" height="38" fill="var(--compute-wash)" stroke="var(--compute)" rx="4"/>
  <text x="320" y="92" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">_tool_step 记工具事件</text>
  <line x1="190" y1="52" x2="230" y2="40" stroke="var(--ink-soft)"/>
  <line x1="190" y1="68" x2="230" y2="86" stroke="var(--ink-soft)"/>
  <rect x="450" y="40" width="170" height="50" fill="var(--paper)" stroke="var(--ink-soft)" rx="4"/>
  <text x="535" y="60" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">events 列表</text>
  <text x="535" y="78" text-anchor="middle" font-family="var(--font-mono)" font-size="10" fill="var(--ink-soft)">按发生顺序</text>
  <line x1="410" y1="39" x2="450" y2="55" stroke="var(--ink-soft)"/>
  <line x1="410" y1="87" x2="450" y2="75" stroke="var(--ink-soft)"/>
  <path d="M105 90 L105 150 L240 150" fill="none" stroke="var(--ink)"/>
  <text x="110" y="132" font-family="var(--font-mono)" font-size="10" fill="var(--ink-faint)">AgentResult</text>
  <path d="M535 90 L535 150 L400 150" fill="none" stroke="var(--ink)"/>
  <rect x="240" y="130" width="160" height="40" fill="none" stroke="var(--ink)" rx="4"/>
  <text x="320" y="154" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">脱敏 + 截断 → 一条记录</text>
  <line x1="320" y1="170" x2="320" y2="196" stroke="var(--ink)"/>
  <rect x="190" y="196" width="260" height="36" fill="var(--paper)" stroke="var(--ink)" rx="4"/>
  <text x="320" y="219" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">logs/runs-日期.jsonl 追加一行</text>
</svg>
<figcaption>LoggedAgent 只在两个缝上插东西:模型调用和工具调用。主循环、重试、收尾一行没动,所以昨天的 20 个测试对它同样有效。</figcaption>
</figure>

模型事件为什么不去覆盖 `_model_step`,而是包在 `chat` 外面?因为主循环里**还有一次模型调用不经过 `_model_step`**:撞线时 `wrap_up` 直接调的 `self.llm.chat`。只覆盖 `_model_step` 会漏掉收尾那次,而收尾恰好是出事时最想看的一次。包在 `self.llm` 外面,主循环和收尾都经过它。

## 写 LoggedAgent

```python
# agent-zero-lab/part03/run_log.py  Day 194:每次运行留一行结构化日志(JSON Lines),记下每一步的耗时、token 和工具结果大小
import json
import re
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from uuid import uuid4

from common.llm import ChatResult
from part03.budget import AgentResult
from part03.loop_guard import LOOP_MSG
from part03.retry_llm import SupportsChat
from part03.robust_agent import RobustAgent

# 写进磁盘之前先抹掉的东西:(正则, 替换成什么)。能抹掉常见的,抹不全姓名、地址这类
SECRETS = [
    (re.compile(r"sk-[A-Za-z0-9_-]{8,}"), "sk-***"),
    (re.compile(r"(?<!\d)1[3-9]\d{9}(?!\d)"), "手机号***"),
    (re.compile(r"[\w.+-]{1,64}@[\w-]{1,63}\.[\w.]{1,63}"), "邮箱***"),  # 每段限长,原因见 redact_slow.py
]
MAX_FIELD = 2000  # 日志里任何一段文字最多留多少字符


def redact(text: str) -> str:
    for pattern, mask in SECRETS:
        text = pattern.sub(mask, text)
    if len(text) > MAX_FIELD:
        text = text[:MAX_FIELD] + f"…[日志里只留前 {MAX_FIELD} 字符,原文共 {len(text)} 字符]"
    return text


class TimedChat:
    """包在 chat 外面:每次调用记一个事件(耗时、token、要调哪些工具,或者抛了什么错),再原样返回。"""

    def __init__(self, inner: SupportsChat) -> None:
        self.inner = inner
        self.events: list[dict[str, Any]] = []

    def chat(self, messages: list[dict[str, Any]], **kw: Any) -> ChatResult:
        kind = "wrap_up" if kw.get("tool_choice") == "none" else "step"
        start = time.perf_counter()
        try:
            r = self.inner.chat(messages, **kw)
        except Exception as e:
            self.events.append({"type": "model", "kind": kind, "seconds": round(time.perf_counter() - start, 2),
                                "error": type(e).__name__})
            raise  # 记完照样往外抛,不改变 RobustAgent 的行为
        calls = [tc["function"]["name"] for tc in r.message.get("tool_calls") or []]
        self.events.append({"type": "model", "kind": kind, "seconds": round(time.perf_counter() - start, 2),
                            "prompt_tokens": r.prompt_tokens, "completion_tokens": r.completion_tokens, "tool_calls": calls})
        return r


class LoggedAgent(RobustAgent):
    def __init__(self, *args: Any, log_dir: str | Path = "logs", **kw: Any) -> None:
        super().__init__(*args, **kw)
        self.timed = TimedChat(self.llm)  # 把父类建好的带重试的 llm 再包一层
        self.llm = self.timed
        self.log_dir = Path(log_dir)

    def _tool_step(self, name: str, arguments: str, elapsed: float) -> str:
        start = time.perf_counter()
        out = super()._tool_step(name, arguments, elapsed)
        steps = sum(1 for e in self.timed.events if e["type"] == "model" and e["kind"] == "step")
        self.timed.events.append({"type": "tool", "step": steps, "name": name, "arguments": redact(arguments),
                                  "seconds": round(time.perf_counter() - start, 2), "result_chars": len(out),
                                  "truncated": "已截断" in out, "is_error": out.startswith('{"error"')})
        return out

    def run(self, user: str) -> AgentResult:
        self.timed.events.clear()
        started = datetime.now(timezone.utc)
        t0 = time.perf_counter()
        result = super().run(user)
        record = {
            "run_id": uuid4().hex[:8],
            "time": started.isoformat(timespec="seconds"),
            "user": redact(user),
            "status": result.status, "error": result.error, "steps": result.steps, "needs_human": result.needs_human,
            "answer": redact(result.answer), "usage": result.usage, "seconds": round(time.perf_counter() - t0, 2),
            "blocked": sum(1 for m in self.messages if m["role"] == "tool" and m["content"] == LOOP_MSG),
            "events": list(self.timed.events),
            "messages": [self._slim(m) for m in self.messages],
        }
        self._write(record, started)
        return result

    @staticmethod
    def _slim(m: dict[str, Any]) -> dict[str, Any]:
        """一条消息存进日志的样子:内容脱敏截断,工具调用只留名字和参数。"""
        out: dict[str, Any] = {"role": m["role"], "content": redact(m.get("content") or "")}
        if m.get("tool_calls"):
            out["tool_calls"] = [{"name": tc["function"]["name"], "arguments": redact(tc["function"]["arguments"])}
                                 for tc in m["tool_calls"]]
        return out

    def _write(self, record: dict[str, Any], when: datetime) -> None:
        try:
            self.log_dir.mkdir(parents=True, exist_ok=True)
            path = self.log_dir / f"runs-{when:%Y-%m-%d}.jsonl"
            with path.open("a", encoding="utf-8") as f:
                f.write(json.dumps(record, ensure_ascii=False) + "\n")
        except OSError as e:  # 磁盘满了、目录没权限:日志写不进去不能拖垮正经任务
            print(f"[run_log] 写日志失败:{type(e).__name__}: {e}", file=sys.stderr)
```

<div class="line-notes">

- `import re` 脱敏用正则。
- `import sys` 日志写失败时往标准错误输出(`sys.stderr`)打一行提示。
- `from datetime import datetime, timezone` 记录时间用 UTC(世界标准时间)。服务器和同事可能在不同时区,日志里统一存 UTC,看的时候再换成本地时间。北京时间是 UTC+8,所以我 11:37 跑的,日志里写的是 `03:37`。
- `from uuid import uuid4` 生成随机 id。`uuid4().hex[:8]` 取前 8 位十六进制,日志里够用来区分几百万次运行。
- `from common.llm import ChatResult` 只为了标注 `TimedChat.chat` 的返回类型。
- `from part03.loop_guard import LOOP_MSG` 数「被拦了几次」要认出那句提醒。
- `from part03.retry_llm import SupportsChat` `TimedChat` 包的对象只要有 `chat` 就行。
- `SECRETS = [` 一张「正则 → 替换成什么」的表,放在模块顶层,所以练习 2 可以往里加规则、测试里可以用 `monkeypatch` 替换它。
- `(re.compile(r"sk-[A-Za-z0-9_-]{8,}"), "sk-***"),` 抹掉长得像 API key 的东西:`sk-` 开头、后面至少 8 个字母数字。`re.compile` 先编译好,反复用不用每次重新解析。
- `(re.compile(r"(?<!\d)1[3-9]\d{9}(?!\d)"), "手机号***"),` 大陆手机号:`1`、第二位 3 到 9、再 9 位数字,共 11 位。`(?<!\d)` 是「前面不能是数字」,`(?!\d)` 是「后面不能是数字」,这样一串 18 位的订单号里面碰巧有 11 位像手机号的片段不会被误抹。
- `(re.compile(r"[\w.+-]{1,64}@[\w-]{1,63}\.[\w.]{1,63}"), "邮箱***"),  # 每段限长,原因见 redact_slow.py` 邮箱。注意每一段都写了 `{1,64}` 这样的长度上限,而不是 `+`。为什么要限长,下一节单独讲,这是我写这天的脚本时真踩到的坑。
- `MAX_FIELD = 2000  # 日志里任何一段文字最多留多少字符` 一次工具返回 20 万字符的日志,没必要原样存进日志,留个开头够查问题了。
- `def redact(text: str) -> str:` 脱敏加截断的统一入口,所有要写进日志的文字都过它。
- `for pattern, mask in SECRETS:` 元组拆包,逐条规则替换。
- `text = pattern.sub(mask, text)` 把所有匹配的地方换成 `mask`。
- `if len(text) > MAX_FIELD:` 超长才截。
- `text = text[:MAX_FIELD] + f"…[日志里只留前 {MAX_FIELD} 字符,原文共 {len(text)} 字符]"` 右边先算完(此时 `len(text)` 还是原长度)再赋值,所以提示里的数字是原文长度。截断时说明原长,以后看日志的人才知道「这里被截过」。
- `class TimedChat:` 包装器,和昨天的 `RetryingChat` 同一种写法:有 `chat` 方法,里面转调另一个有 `chat` 的东西,顺手做点事。
- `self.events: list[dict[str, Any]] = []` 本次运行的事件列表,按发生顺序往里追加。模型事件由它自己记,工具事件由 `LoggedAgent._tool_step` 往同一个列表里记,顺序天然是对的。
- `kind = "wrap_up" if kw.get("tool_choice") == "none" else "step"` 收尾那次调用一定带 `tool_choice="none"`(Day 192),借它把收尾那次和普通的一步区分开,日志里写成 `kind`。
- `start = time.perf_counter()` 掐表。注意这个计时在 `RetryingChat` **外面**,所以重试等待的时间也算在这次调用里,下面 `llm_error` 那次 8.8 秒就是这么来的。
- `r = self.inner.chat(messages, **kw)` 真正的调用,放在 `try` 里。
- `except Exception as e:` 失败也要记一笔:耗时加异常类名。
- `"error": type(e).__name__})` 失败事件:耗时加异常类名,没有 token(失败的请求没有 `usage`)。
- `raise  # 记完照样往外抛,不改变 RobustAgent 的行为` 单独一个 `raise` 是「把刚接住的异常原样再抛出去」。日志只是旁观者,不能改变被观察者的行为。如果这里不抛,`RobustAgent` 就看不到异常,`llm_error` 就永远不会出现。
- `calls = [tc["function"]["name"] for tc in r.message.get("tool_calls") or []]` 这一步模型要调哪些工具,只存名字(参数在 `messages` 里)。`or []` 处理没有工具调用的情况。
- `"prompt_tokens": r.prompt_tokens, "completion_tokens": r.completion_tokens, "tool_calls": calls})` 成功的模型事件:耗时、两个 token 数、要调的工具名。`round(x, 2)` 保留两位小数。
- `return r` 原样返回给调用方。
- `class LoggedAgent(RobustAgent):` 继承昨天的 `RobustAgent`。除了下面覆盖的几个地方,所有行为都和父类一样。
- `def __init__(self, *args: Any, log_dir: str | Path = "logs", **kw: Any) -> None:` `*args` 收下所有位置参数、`**kw` 收下所有关键字参数,原样转交给父类,这样 `LoggedAgent` 的用法和 `RobustAgent` 一模一样,只多一个 `log_dir`。`log_dir` 写在 `*args` 之后,所以必须用关键字传。
- `super().__init__(*args, **kw)` `super()` 是「父类」,[Day 42](/blog/agent-zero/day-042-classes-2/) 讲过。`*args` 在调用处是展开:把元组拆回一个个位置参数。
- `self.timed = TimedChat(self.llm)  # 把父类建好的带重试的 llm 再包一层` 父类 `__init__` 里已经把 `self.llm` 设成了「带重试的 llm」,这里再包一层计时。
- `self.llm = self.timed` 把 `self.llm` 换成包装后的。因为昨天特意把它标成 `SupportsChat`,类型检查不会报错。主循环里所有 `self.llm.chat(...)` 和传给 `wrap_up` 的 `self.llm` 从此都经过计时。
- `def _tool_step(self, name: str, arguments: str, elapsed: float) -> str:` 覆盖父类的方法,签名必须一模一样。
- `out = super()._tool_step(name, arguments, elapsed)` 先让父类干活(超时、截断都在里面),再记账。这是「继承加功能」的标准写法:调用父类原来的版本,在前后加自己的事。
- `steps = sum(1 for e in self.timed.events if e["type"] == "model" and e["kind"] == "step")` 数一下到目前为止有几次普通的模型调用,就是这个工具调用属于第几步。`sum(1 for ...)` 是数个数的惯用写法,相当于 JS 的 `filter(...).length`。
- `"arguments": redact(arguments),` 参数也过脱敏,用户的手机号可能被模型原样放进工具参数。
- `"truncated": "已截断" in out, "is_error": out.startswith('{"error"')})` 两个标记。Day 191 的截断提示里有「已截断」三个字,用它认出这个结果被截过;注册表和超时都用 `{"error": ...}` 的格式回报错,开头一匹配就知道这次工具调用是不是出了错。
- `def run(self, user: str) -> AgentResult:` 覆盖 `run`:跑之前清空事件、记开始时间,跑完拼一条记录写出去。
- `self.timed.events.clear()` 同一个对象连续 `run` 两次,第二次不能带着第一次的事件。
- `started = datetime.now(timezone.utc)` 带时区的当前时间。不要用 `datetime.utcnow()`,它返回的是不带时区信息的「天真」时间,Python 3.12 起已标记弃用。
- `result = super().run(user)` 父类的整个主循环原样执行。
- `"run_id": uuid4().hex[:8],` 随机 id,没有规律,但同一次日志里重复的概率可以忽略。
- `"time": started.isoformat(timespec="seconds"),` 例如 `2026-10-23T03:37:30+00:00`,按字符串排序就是按时间排序。
- `"user": redact(user),` 用户原话过脱敏。
- `"status": result.status,` `AgentResult` 的字段平铺进来,今天补上的 `error` 就在这里派上用场。
- `"answer": redact(result.answer), "usage": result.usage, "seconds": round(time.perf_counter() - t0, 2),` 回答也脱敏,总耗时是整个 `run` 的墙钟时间。
- `"blocked": sum(1 for m in self.messages if m["role"] == "tool" and m["content"] == LOOP_MSG),` 被循环检测拦下的次数:回给模型的 tool 消息内容恰好等于那句 `LOOP_MSG`。
- `"events": list(self.timed.events),` 复制一份。下一次 `run` 开头会 `clear()` 原列表,不复制的话记录里的事件会被清掉。
- `"messages": [self._slim(m) for m in self.messages],` 整个对话历史,每条先过 `_slim`。
- `@staticmethod` 静态方法:不需要 `self`,纯粹是个格式转换。
- `out: dict[str, Any] = {"role": m["role"], "content": redact(m.get("content") or "")}` 内容脱敏截断。`m.get("content") or ""` 处理 assistant 发工具调用时 `content` 为空或 `None` 的情况。
- `out["tool_calls"] = [{"name": tc["function"]["name"],` 工具调用只留名字和参数,去掉 `id`、`type` 这些样板。练习 4 的重放就靠这里存下来的名字和参数。
- `def _write(self, record: dict[str, Any], when: datetime) -> None:` 写盘。
- `self.log_dir.mkdir(parents=True, exist_ok=True)` 目录不存在就建,`parents=True` 连上层一起建,`exist_ok=True` 已经有了不报错,相当于 `mkdir -p`。
- `path = self.log_dir / f"runs-{when:%Y-%m-%d}.jsonl"` 文件名带日期:`runs-2026-10-23.jsonl`。`{when:%Y-%m-%d}` 是 f-string 里的日期格式化。一天一个文件,删旧日志时按文件名删就行。
- `f.write(json.dumps(record, ensure_ascii=False) + "\n")` 一行 JSON 加换行。
- `except OSError as e:  # 磁盘满了、目录没权限:日志写不进去不能拖垮正经任务` `OSError` 是文件和目录相关错误的基类。日志是辅助,任务才是主业,写不进去只打一行警告。
- `print(f"[run_log] 写日志失败:{type(e).__name__}: {e}", file=sys.stderr)` `file=sys.stderr` 往标准错误输出打印,不会混进正常输出。生产环境里这里应该换成报警,不能只打一行就算了,否则日志悄悄停写你也不知道。

</div>

注意 `LoggedAgent` 对 `RobustAgent` 的改动**只有三处**:`__init__` 里多包一层,`_tool_step` 前后记账,`run` 前后清空和落盘。主循环、重试、循环检测、预算、收尾,一行没碰。这就是昨天把 `_model_step`、`_tool_step` 拆成方法、把 `self.llm` 标成协议类型的回报。

## 脱敏的正则也会出事

`redact` 里邮箱那一行,我第一遍是这么写的:`[\w.+-]+@[\w-]+\.[\w.]+`,用户名部分不限长度,看起来人畜无害。跑测试时发现一个测试要 0.58 秒,而它只是在测「一万个字符的字符串会被截断」。往下查,是邮箱正则慢。下面这个脚本把松的和限长的并排比一下:

```python
# agent-zero-lab/part03/redact_slow.py  脱敏用的正则写得松,遇到一万个字符的长文本会慢到什么程度?
import re
import time

LOOSE = re.compile(r"[\w.+-]+@[\w-]+\.[\w.]+")  # 邮箱:用户名部分不限长度
BOUNDED = re.compile(r"[\w.+-]{1,64}@[\w-]{1,63}\.[\w.]{1,63}")  # 邮箱:每一段都限定长度

for n in (2_000, 10_000, 20_000):
    text = "x" * n  # 一长串字母,里面没有 @,正则要在每个位置都试一遍
    row = [f"{n:6} 字符"]
    for name, pattern in (("松的", LOOSE), ("限长的", BOUNDED)):
        start = time.perf_counter()
        pattern.sub("邮箱***", text)
        row.append(f"{name} {time.perf_counter() - start:.3f} 秒")
    print(" | ".join(row))
```

<div class="line-notes">

- `LOOSE = re.compile(r"[\w.+-]+@[\w-]+\.[\w.]+")  # 邮箱:用户名部分不限长度` 我第一遍写的。`[\w.+-]+` 是「一个或多个字母数字下划线点加减号」,后面要跟一个 `@`。
- `BOUNDED = re.compile(r"[\w.+-]{1,64}@[\w-]{1,63}\.[\w.]{1,63}")  # 邮箱:每一段都限定长度` 现在 `run_log.py` 里用的。邮箱用户名最长 64 个字符(RFC 5321)、域名每一段最长 63 个字符(RFC 1035),都是协议里的上限,所以限长不会漏掉真邮箱。
- `text = "x" * n  # 一长串字母,里面没有 @,正则要在每个位置都试一遍` 最坏的输入:全是能匹配用户名的字符,但没有 `@`。
- `for name, pattern in (("松的", LOOSE), ("限长的", BOUNDED)):` 元组的元组,两个正则各跑一遍。
- `pattern.sub("邮箱***", text)` 真正执行替换,计时只量这一行。

</div>

```bash
uv run python -m part03.redact_slow
```

```text
  2000 字符 | 松的 0.023 秒 | 限长的 0.001 秒
 10000 字符 | 松的 0.671 秒 | 限长的 0.007 秒
 20000 字符 | 松的 2.865 秒 | 限长的 0.023 秒
```

松的正则在 2 万字符上要 2.9 秒,而且是**平方级**增长:字符数翻 2 倍,时间涨 4 倍多,我另外试过 10 万字符,跑了 82 秒。原因是它从每个位置开始都尝试往后吞尽所有「像用户名的字符」,吞到末尾发现没有 `@`,退回来从下一个位置再来一遍。这类问题叫**正则回溯**,严重时能让一个请求把整个服务拖死(叫 ReDoS)。

放到我们的场景里:`redact` 要处理的是用户输入和工具返回,**这些都是不可信的、长度不可控的文本**。一条 20 万字符的工具结果(Day 191 那个 `dump_logs`)进了松的邮箱正则,日志这一步就能卡住整个 Agent 好几分钟,而日志本来只是个旁观者。所以两条纪律:

1. 写给不可信文本用的正则,**每一段都限长**,不要用裸的 `+` 和 `*` 去吞「任意多个」。
2. 上面 `redact` 先脱敏、后截断,所以长文本会整条过一遍正则。更保险的做法是脱敏之前先把输入截到某个硬上限(比如 5 万字符),这里没有这么做,因为那样截断点可能把一个 key 劈成两半(前半段没满 8 个字符,就不会被 `sk-` 规则抹掉)。两种取舍都有,选哪个取决于你更怕慢还是更怕漏。

还有一个必须说清楚的局限:**正则脱敏只抹得掉有固定格式的东西**(key、手机号、邮箱)。用户的姓名、地址、病情描述,正则抹不掉。所以更根本的办法是少存:能只存 `status` 就别存 `messages`,存 `messages` 的日志就要像对待数据库一样管权限、设保留期限。公司的合规要求怎么定,以公司规定为准,这里只讲技术上能做到什么。

## 攒一批日志

用 `LoggedAgent` 把昨天 `failure_zoo_193.py` 里那九类失败再跑一遍,每次运行都写日志;再加两次真模型运行(华东跑步那个任务,一次 `max_steps=1` 撞线、一次放开步数)。用户的话里故意塞了手机号和一个假 key,看脱敏有没有生效。

```python
# agent-zero-lab/part03/make_logs.py  Day 194:攒一批日志。九类失败(七类假模型、两类真 SDK)加两次真模型运行,都用 LoggedAgent 写进 logs/
import shutil
from pathlib import Path

from part03.budget import Limits
from part03.failure_zoo import reg
from part03.failure_zoo_193 import SCRIPTS
from part03.fake_client import FakeClient
from part03.retry_llm import make_llm
from part03.run_log import LoggedAgent
from part03.wrapup_real import reg as trip_reg

LOG_DIR = Path("logs")
shutil.rmtree(LOG_DIR, ignore_errors=True)  # 每次重新攒,不和上次的混在一起

for name, script in SCRIPTS.items():
    agent = LoggedAgent(reg, "你是助手。", Limits(max_steps=6, tool_timeout=1), llm=FakeClient(script),
                        verbose=False, log_dir=LOG_DIR)
    agent.run("帮我查一下,我的手机是 13812345678,key 是 sk-abcdef1234567890。")  # 故意带上要脱敏的东西

for overrides in ({"base_url": "http://127.0.0.1:9"}, {"api_key": "sk-wrong-key-for-demo"}):
    LoggedAgent(reg, "你是助手。", llm=make_llm(**overrides), verbose=False, log_dir=LOG_DIR).run("杭州天气?")

for steps in (1, 8):  # 真模型:一次撞线收尾,一次正常跑完
    LoggedAgent(trip_reg, "你是出行助手。", Limits(max_steps=steps), llm=make_llm(), verbose=False,
                log_dir=LOG_DIR).run("华东哪个城市今天最适合户外跑步?气温和空气质量都要看。")

print("写好了:", *sorted(p.name for p in LOG_DIR.iterdir()))
```

<div class="line-notes">

- `import shutil` 标准库的文件操作模块,这里用它的 `rmtree` 删目录。
- `from part03.failure_zoo_193 import SCRIPTS` 昨天那张剧本表。能这样导入,是因为昨天给它的主程序加了 `if __name__ == "__main__":` 守卫,导入时不会把九类全跑一遍。
- `from part03.wrapup_real import reg as trip_reg` Day 192 里登记了 `list_cities`、`get_weather`、`get_aqi` 的注册表。`as trip_reg` 起个别名,免得和 `failure_zoo` 的 `reg` 重名。
- `LOG_DIR = Path("logs")` 相对路径,就是你在 `agent-zero-lab/` 根目录下的 `logs/`。
- `shutil.rmtree(LOG_DIR, ignore_errors=True)  # 每次重新攒,不和上次的混在一起` 先删干净。`ignore_errors=True` 让目录不存在时不报错。**这一行只对 `logs/` 这个相对路径有效,别把它改成别的目录**。
- `for name, script in SCRIPTS.items():` 遍历七类假模型剧本。`name` 这里用不上,但元组拆包要两个变量。
- `agent = LoggedAgent(reg, "你是助手。", Limits(max_steps=6, tool_timeout=1), llm=FakeClient(script),` 和昨天体检一样的参数,多一个 `log_dir`。`verbose=False` 不打印每步,只留日志。
- `agent.run("帮我查一下,我的手机是 13812345678,key 是 sk-abcdef1234567890。")` 故意带上要脱敏的东西。这个 key 是我随手编的,不是真的。
- `for overrides in ({"base_url": "http://127.0.0.1:9"}, {"api_key": "sk-wrong-key-for-demo"}):` 两个真 SDK 场景:连不上的端口、写错的 key。
- `LoggedAgent(reg, "你是助手。", llm=make_llm(**overrides), verbose=False, log_dir=LOG_DIR).run("杭州天气?")` 建完直接 `.run`,不存变量,因为之后不需要再用这个 agent。
- `for steps in (1, 8):  # 真模型:一次撞线收尾,一次正常跑完` 这两次才真正花钱。
- `Limits(max_steps=steps), llm=make_llm()` `make_llm()` 读 `.env` 里的 `LLM_*`,默认 DeepSeek。
- `print("写好了:", *sorted(p.name for p in LOG_DIR.iterdir()))` `*` 把列表展开成多个参数给 `print`。

</div>

```bash
uv run python -m part03.make_logs
```

```text
写好了: runs-2026-10-23.jsonl
```

九类加两次真模型,一共 11 次运行,写进一个文件,11 行。看看里面长什么样。下面是「key 写错」那次的一行,我用 `json.dumps(..., indent=2)` 缩进排版了一下方便读(文件里它是一行):

```json
{
  "run_id": "a723373d",
  "time": "2026-10-23T03:37:30+00:00",
  "user": "杭州天气?",
  "status": "llm_error",
  "error": "AuthenticationError",
  "steps": 0,
  "needs_human": true,
  "answer": "模型服务暂时不可用(AuthenticationError),已转人工同事跟进。",
  "usage": {"prompt_tokens": 0, "completion_tokens": 0},
  "seconds": 0.1,
  "blocked": 0,
  "events": [{"type": "model", "kind": "step", "seconds": 0.1, "error": "AuthenticationError"}],
  "messages": [
    {"role": "system", "content": "你是助手。"},
    {"role": "user", "content": "杭州天气?"},
    {"role": "assistant", "content": "模型服务暂时不可用(AuthenticationError),已转人工同事跟进。"}
  ]
}
```

这条记录自己就能讲完故事:没走成一步(`steps: 0`),模型事件只有一个、0.1 秒、错误是 `AuthenticationError`,没花一个 token,转人工。再看一条脱敏后的用户输入,在九类里任意一条里:

```text
"user": "帮我查一下,我的手机是 手机号***,key 是 sk-***。"
```

真手机号和 key 没进文件,可以用 `grep 13812345678 logs/*.jsonl` 验证,应该什么都搜不到。

## 读日志:从一堆记录里找出出事的

日志写了没人看就是浪费磁盘。下面是读的这一边。它有两个模式:不带 id 时给一张总览,带 id 时把那次运行摊成时间线。

```python
# agent-zero-lab/part03/triage.py  Day 194:从一堆日志里按状态筛、按耗时排,再把一次运行摊开成时间线
import json
import sys
from collections import Counter
from pathlib import Path
from typing import Any


def load_runs(log_dir: str | Path) -> tuple[list[dict[str, Any]], int]:
    """读 log_dir 下所有 runs-*.jsonl。返回 (记录列表, 坏行数)。一行坏了只跳过那一行,不影响别的。"""
    runs: list[dict[str, Any]] = []
    bad = 0
    for path in sorted(Path(log_dir).glob("runs-*.jsonl")):
        for line in path.read_text(encoding="utf-8").splitlines():
            if not line.strip():
                continue
            try:
                runs.append(json.loads(line))
            except json.JSONDecodeError:
                bad += 1  # 进程写到一半被杀,会留下半行
    return runs, bad


def summary(runs: list[dict[str, Any]]) -> None:
    by_status = Counter(r["status"] for r in runs)
    print(f"一共 {len(runs)} 次运行:" + "、".join(f"{s} {n}" for s, n in by_status.most_common()))
    tokens = sum(sum(r["usage"].values()) for r in runs)
    print(f"累计 {tokens} 个 token,最慢的一次 {max(r['seconds'] for r in runs)} 秒")
    print("\n没有正常结束的运行(按耗时从长到短):")
    for r in sorted((r for r in runs if r["status"] != "ok"), key=lambda r: -r["seconds"]):
        err = f" {r['error']}" if r["error"] else ""
        print(f"  {r['run_id']}  {r['status']:10}{err:20} {r['steps']} 步  {r['seconds']:5.1f} 秒  拦 {r['blocked']} 次")
    slow: list[tuple[float, str, str]] = []
    for r in runs:
        slow += [(e["seconds"], e["name"], r["run_id"]) for e in r["events"] if e["type"] == "tool"]
    print("\n最慢的三次工具调用:")
    for seconds, name, run_id in sorted(slow, reverse=True)[:3]:
        print(f"  {seconds:4.1f} 秒  {name}  (运行 {run_id})")


def timeline(run: dict[str, Any]) -> None:
    print(f"运行 {run['run_id']} {run['time']} status={run['status']} 共 {run['seconds']} 秒")
    print(f"用户:{run['user']}")
    clock = 0.0
    for e in run["events"]:
        clock += e["seconds"]
        if e["type"] == "model":
            what = e.get("error") or f"{e['prompt_tokens']}+{e['completion_tokens']} tok 调 {e['tool_calls'] or '无'}"
            print(f"  [{clock:5.1f}s] 模型({e['kind']}) {e['seconds']:4.1f}s  {what}")
        else:
            flags = ("截断 " if e["truncated"] else "") + ("报错 " if e["is_error"] else "")
            print(f"  [{clock:5.1f}s] 工具 {e['name']}{e['arguments']} {e['seconds']:4.1f}s  {e['result_chars']} 字符 {flags}")
    answer = run["answer"][:80].replace("\n", " ")  # 回答里的换行会把时间线打乱
    print(f"回答:{answer}")


if __name__ == "__main__":
    all_runs, bad_lines = load_runs(sys.argv[1])
    if bad_lines:
        print(f"(跳过 {bad_lines} 行读不出来的日志)")
    if len(sys.argv) > 2:
        timeline(next(r for r in all_runs if r["run_id"] == sys.argv[2]))
    else:
        summary(all_runs)
```

<div class="line-notes">

- `from collections import Counter` 数个数的字典。`Counter(["ok", "loop", "ok"])` 得到 `{"ok": 2, "loop": 1}`,相当于 JS 里手写的 `reduce` 计数。
- `def load_runs(log_dir: str | Path) -> tuple[list[dict[str, Any]], int]:` 返回两样东西:记录列表和坏行数。返回元组,调用处用 `runs, bad = ...` 拆开。
- `for path in sorted(Path(log_dir).glob("runs-*.jsonl")):` `glob` 按通配符列出文件,`sorted` 按文件名排,文件名里带日期,所以天然是时间顺序。
- `for line in path.read_text(encoding="utf-8").splitlines():` 整个文件读成字符串再按行切。日志小的时候这样最简单;文件大到几百 MB 就该改成 `for line in f:` 逐行读。
- `if not line.strip():` 空行跳过,下一行的 `continue` 是跳过这一轮、进入下一轮,和 JS 一样。
- `runs.append(json.loads(line))` 一行一个 JSON。
- `bad += 1  # 进程写到一半被杀,会留下半行` 坏行只计数、不中断,和 `jsonl_basics.py` 演示的一样。
- `by_status = Counter(r["status"] for r in runs)` 按状态数个数。
- `"、".join(f"{s} {n}" for s, n in by_status.most_common())` `most_common()` 按个数从多到少给出 `(状态, 个数)`,拼成「ok 6、max_steps 2」这样的一句话。
- `tokens = sum(sum(r["usage"].values()) for r in runs)` 内层求一次运行的输入加输出,外层求所有运行的总和。
- `for r in sorted((r for r in runs if r["status"] != "ok"), key=lambda r: -r["seconds"]):` 先筛出没有正常结束的,再按耗时**从长到短**排。`key=lambda r: -r["seconds"]` 取负号就是倒序。
- `err = f" {r['error']}" if r["error"] else ""` 有错误类名就带上。
- `print(f"  {r['run_id']}  {r['status']:10}{err:20}` `:10`、`:20` 是左对齐并补空格到固定宽度,表格才整齐。
- `slow: list[tuple[float, str, str]] = []` 收集所有工具事件:(耗时, 工具名, 运行 id)。
- `slow += [(e["seconds"], e["name"], r["run_id"]) for e in r["events"] if e["type"] == "tool"]` 列表推导式加上 `+=`,把这次运行的工具事件并进去。
- `sorted(slow, reverse=True)[:3]` 元组按第一个元素(耗时)倒序排,取前三。`[:3]` 是切片。
- `def timeline(run: dict[str, Any]) -> None:` 把一次运行摊成时间线。
- `clock += e["seconds"]` 累加:模型调用和工具调用在主循环里是**串行**的(一个做完才做下一个),所以把耗时依次加起来就是「到这一步已经过了多久」。
- `what = e.get("error") or f"{e['prompt_tokens']}+{e['completion_tokens']} tok 调 {e['tool_calls'] or '无'}"` 模型事件要么有 `error`(失败那次),要么有 token 和工具名。`or` 在这里是「前面是空就用后面的」。
- `flags = ("截断 " if e["truncated"] else "") + ("报错 " if e["is_error"] else "")` 工具事件上的两个标记。
- `answer = run["answer"][:80].replace("\n", " ")` 回答只留前 80 个字符,并把换行换成空格:真模型的回答常带表格,不处理会把时间线的版面撑乱。
- `if __name__ == "__main__":` 命令行入口,下面读 `sys.argv`。
- `all_runs, bad_lines = load_runs(sys.argv[1])` `sys.argv[1]` 是命令行第一个参数,日志目录。
- `if len(sys.argv) > 2:` 有第二个参数就当 run_id,摊时间线。
- `timeline(next(r for r in all_runs if r["run_id"] == sys.argv[2]))` `next(生成器)` 取第一个满足条件的。找不到会抛 `StopIteration`,练习里可以改成给个友好提示。

</div>

```bash
uv run python -m part03.triage logs
```

```text
一共 11 次运行:ok 6、max_steps 2、llm_error 2、loop 1
累计 6138 个 token,最慢的一次 8.83 秒

没有正常结束的运行(按耗时从长到短):
  ab983126  llm_error  APIConnectionError  0 步    8.8 秒  拦 0 次
  7162c668  max_steps                      1 步    2.9 秒  拦 0 次
  a723373d  llm_error  AuthenticationError 0 步    0.1 秒  拦 0 次
  d33b4f39  loop                           4 步    0.0 秒  拦 2 次
  15da4671  max_steps                      6 步    0.0 秒  拦 0 次

最慢的三次工具调用:
   1.0 秒  slow_lookup  (运行 00a9fe49)
   0.0 秒  search_web  (运行 6ec06669)
   0.0 秒  list_cities  (运行 e0a3290c)
```

读这张总览:11 次运行,6 次正常、5 次不正常(`max_steps` 2 次、`llm_error` 2 次、`loop` 1 次)。5 次不正常里最慢的是 `APIConnectionError` 那次,8.8 秒,0 步;接下来是真模型撞线那次(`max_steps`,1 步,2.9 秒)。不正常的运行按耗时排序是有道理的:你最先想看的是「用户等得最久、最后还没成功」的那几次。

挑几次摊开看。先是循环那次(`d33b4f39`):

```bash
uv run python -m part03.triage logs d33b4f39
```

```text
运行 d33b4f39 2026-10-23T03:37:21+00:00 status=loop 共 0.0 秒
用户:帮我查一下,我的手机是 手机号***,key 是 sk-***。
  [  0.0s] 模型(step)  0.0s  100+20 tok 调 ['get_weather']
  [  0.0s] 工具 get_weather{"city": "杭州"}  0.0s  26 字符 
  [  0.0s] 模型(step)  0.0s  100+20 tok 调 ['get_weather']
  [  0.0s] 工具 get_weather{"city": "杭州"}  0.0s  26 字符 
  [  0.0s] 模型(step)  0.0s  100+20 tok 调 ['get_weather']
  [  0.0s] 模型(step)  0.0s  100+20 tok 调 ['get_weather']
  [  0.0s] 模型(wrap_up)  0.0s  100+20 tok 调 无
回答:已经查到的结果见上,其余没有完成。
```

时间线里看得到:前两步各有一个模型事件加一个工具事件(真执行了);第 3、4 步只有模型事件,没有工具事件,因为那两个调用被循环检测拦下了,没进 `_tool_step`;最后是 `wrap_up` 的模型事件,`调 无` 说明收尾那次老老实实只回了文字。总览里的 `拦 2 次` 就是这两步。

再看 `llm_error` 那次(`ab983126`):

```bash
uv run python -m part03.triage logs ab983126
```

```text
运行 ab983126 2026-10-23T03:37:21+00:00 status=llm_error 共 8.83 秒
用户:杭州天气?
  [  8.8s] 模型(step)  8.8s  APIConnectionError
回答:模型服务暂时不可用(APIConnectionError),已转人工同事跟进。
```

整个运行只有一个模型事件,**8.8 秒**,没有 token,错误是 `APIConnectionError`。这 8.8 秒是 Day 190 那 4 次尝试加三次指数退避的等待。靠日志你能把「用户反映它卡了快 10 秒然后说服务不可用」直接对上号,而不是怀疑是不是工具慢。

再看真模型撞线那次(`7162c668`):

```bash
uv run python -m part03.triage logs 7162c668
```

```text
运行 7162c668 2026-10-23T03:37:30+00:00 status=max_steps 共 2.87 秒
用户:华东哪个城市今天最适合户外跑步?气温和空气质量都要看。
  [  0.8s] 模型(step)  0.8s  391+51 tok 调 ['list_cities']
  [  0.8s] 工具 list_cities{"region": "华东"}  0.0s  36 字符 
  [  2.9s] 模型(wrap_up)  2.0s  141+214 tok 调 无
回答:我目前只完成了第一步——确认华东的城市列表（杭州、上海、南京、苏州、宁波、合肥），还**没有**查这几个城市今天的实际气温和空气质量数据，所以暂时没法给出确切的
```

真模型这次,第 1 步调模型 0.8 秒,工具 0.0 秒(假数据,瞬间),收尾那次模型又花了 **2.0 秒**,一共 2.9 秒。收尾要写一大段「已完成什么、没完成什么」,输出 token 多(214 个),时间也长。如果你的预算里 `max_seconds` 压得很紧,要留出收尾的时间,不然会出现「预算够跑工具、不够收尾」的尴尬。

最后看正常跑完的那次(`e0a3290c`):

```bash
uv run python -m part03.triage logs e0a3290c
```

```text
运行 e0a3290c 2026-10-23T03:37:33+00:00 status=ok 共 5.05 秒
用户:华东哪个城市今天最适合户外跑步?气温和空气质量都要看。
  [  0.8s] 模型(step)  0.8s  391+56 tok 调 ['list_cities']
  [  0.8s] 工具 list_cities{"region": "华东"}  0.0s  36 字符 
  [  2.3s] 模型(step)  1.5s  477+357 tok 调 ['get_weather', 'get_weather', 'get_weather', 'get_weather', 'get_weather', 'get_weather', 'get_aqi', 'get_aqi', 'get_aqi', 'get_aqi', 'get_aqi', 'get_aqi']
  [  2.3s] 工具 get_weather{"city": "杭州"}  0.0s  26 字符 
  [  2.3s] 工具 get_weather{"city": "上海"}  0.0s  26 字符 
  [  2.3s] 工具 get_weather{"city": "南京"}  0.0s  26 字符 
  [  2.3s] 工具 get_weather{"city": "苏州"}  0.0s  26 字符 
  [  2.3s] 工具 get_weather{"city": "宁波"}  0.0s  26 字符 
  [  2.3s] 工具 get_weather{"city": "合肥"}  0.0s  26 字符 
  [  2.3s] 工具 get_aqi{"city": "杭州"}  0.0s  25 字符 
  [  2.3s] 工具 get_aqi{"city": "上海"}  0.0s  25 字符 
  [  2.3s] 工具 get_aqi{"city": "南京"}  0.0s  26 字符 
  [  2.3s] 工具 get_aqi{"city": "苏州"}  0.0s  25 字符 
  [  2.3s] 工具 get_aqi{"city": "宁波"}  0.0s  25 字符 
  [  2.3s] 工具 get_aqi{"city": "合肥"}  0.0s  26 字符 
  [  5.1s] 模型(step)  2.8s  1072+348 tok 调 无
回答:## 华东 6 城今日户外跑步条件对比  | 城市 | 气温 | AQI | 评价 | |---|---|---|---| | **宁波** | 22℃ | *
```

一共 5.1 秒,三次模型调用分别是 0.8、1.5、2.8 秒,12 个工具调用加起来是 0.0 秒。**时间全花在模型上**,工具是本地假函数所以几乎不花时间。真实系统里工具通常要访问网络,那时这张时间线会告诉你该先优化哪一边。这就是日志的价值:你不用猜,直接看。

### 花费

`make_logs.py` 里两次真模型运行的 token 在日志里能直接加:撞线那次 391 + 51 + 141 + 214 = 797,正常那次 391 + 56 + 477 + 357 + 1,072 + 348 = 2,701。按未命中价(输入 2 元、输出 8 元每百万 token,2026 年 10 月核对)算,撞线那次输入 532 × 2 + 输出 265 × 8 = 3,184 ÷ 10⁶ ≈ ¥0.0032,正常那次输入 1,940 × 2 + 输出 761 × 8 = 9,968 ÷ 10⁶ ≈ ¥0.0100,合计约 ¥0.013。实际有缓存命中,比这个略低。

## 测试:日志本身也要守住

日志是「出事时唯一的线索」,它自己不能出事。五个测试,都用昨天的 `FakeClient`,不联网:

```python
# agent-zero-lab/tests/test_run_log.py  Day 194:日志该有的字段、脱敏、写失败不拖垮任务、坏行不影响读取
import json
from pathlib import Path
from typing import Any

import pytest

from part03.fake_client import FakeClient, call, fake_http_error
from part03.run_log import MAX_FIELD, LoggedAgent, redact
from part03.triage import load_runs
from tests.test_robust_agent import reg


def read_records(log_dir: Path) -> list[dict[str, Any]]:
    (path,) = log_dir.glob("runs-*.jsonl")  # 只应该有一个文件,多了少了都会在这里报错
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines()]


def test_one_run_writes_one_line_with_events_and_no_secrets(tmp_path: Path) -> None:
    fake = FakeClient([[call("echo", text="a")], "好的"])
    agent = LoggedAgent(reg, "sys", llm=fake, verbose=False, log_dir=tmp_path)
    agent.run("手机 13812345678,key sk-abcdef1234567890,邮箱 a.b@x.com")
    (rec,) = read_records(tmp_path)
    assert (rec["status"], rec["steps"], rec["blocked"]) == ("ok", 2, 0)
    assert [(e["type"], e.get("kind")) for e in rec["events"]] == [("model", "step"), ("tool", None), ("model", "step")]
    raw = (next(tmp_path.glob("*.jsonl"))).read_text(encoding="utf-8")
    assert "13812345678" not in raw and "sk-abcdef" not in raw and "a.b@x.com" not in raw
    assert "手机号***" in raw and "sk-***" in raw and "邮箱***" in raw


def test_wrap_up_and_llm_error_are_logged(tmp_path: Path, waits: list[float]) -> None:
    loop = FakeClient([[call("echo", text="a")]] * 4 + ["部分答案"])
    LoggedAgent(reg, "sys", llm=loop, verbose=False, log_dir=tmp_path).run("hi")
    down = FakeClient([fake_http_error(401)])
    LoggedAgent(reg, "sys", llm=down, verbose=False, log_dir=tmp_path).run("hi")
    loop_rec, down_rec = read_records(tmp_path)
    assert loop_rec["status"] == "loop" and loop_rec["blocked"] == 2
    assert [e["kind"] for e in loop_rec["events"] if e["type"] == "model"] == ["step"] * 4 + ["wrap_up"]
    assert down_rec["status"] == "llm_error" and down_rec["error"] == "AuthenticationError"
    assert down_rec["events"][0]["error"] == "AuthenticationError"


def test_unwritable_log_dir_does_not_break_the_run(tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    blocker = tmp_path / "logs"
    blocker.write_text("我是个文件,不是目录")  # 想在它下面建目录,必然失败
    agent = LoggedAgent(reg, "sys", llm=FakeClient(["好的"]), verbose=False, log_dir=blocker / "sub")
    assert agent.run("hi").status == "ok"
    assert "写日志失败" in capsys.readouterr().err


def test_half_written_line_is_skipped(tmp_path: Path) -> None:
    good = json.dumps({"run_id": "r1", "status": "ok"})
    (tmp_path / "runs-2026-10-23.jsonl").write_text(good + '\n{"run_id": "r2", "sta', encoding="utf-8")
    runs, bad = load_runs(tmp_path)
    assert [r["run_id"] for r in runs] == ["r1"] and bad == 1


def test_redact_truncates_long_text() -> None:
    out = redact("x" * 10_000)
    assert len(out) < MAX_FIELD + 100 and "原文共 10000 字符" in out
```

<div class="line-notes">

- `from part03.run_log import MAX_FIELD, LoggedAgent, redact` 常量也可以导入,测试里用它判断截断是否生效。
- `from part03.triage import load_runs` 读的这边也要测。
- `from tests.test_robust_agent import reg` 借用昨天那张测试专用工具表(`echo`、`nap`、`slow`、`big`、`boom`)。
- `def read_records(log_dir: Path) -> list[dict[str, Any]]:` 测试里的小工具:读回日志目录里那一个文件的所有记录。
- `(path,) = log_dir.glob("runs-*.jsonl")  # 只应该有一个文件,多了少了都会在这里报错` 左边加逗号是元组拆包,要求右边**恰好有一个**元素,不是一个就报 `ValueError`。这样「日志文件数量不对」不用另写断言。
- `def test_one_run_writes_one_line_with_events_and_no_secrets(tmp_path: Path) -> None:` `tmp_path` 是 pytest 自带的 fixture,给每个测试一个独一无二的临时目录,测试完留给你查看、过几次后自动清理。不用自己建删。
- `fake = FakeClient([[call("echo", text="a")], "好的"])` 一步工具调用,一句最终回答。
- `agent.run("手机 13812345678,key sk-abcdef1234567890,邮箱 a.b@x.com")` 用户话里一次放三种要脱敏的东西。
- `(rec,) = read_records(tmp_path)` 同样是「恰好一条」。
- `assert (rec["status"], rec["steps"], rec["blocked"]) == ("ok", 2, 0)` 记录里的状态字段对得上。
- `assert [(e["type"], e.get("kind")) for e in rec["events"]] == [("model", "step"), ("tool", None), ("model", "step")]` 事件顺序:模型、工具、模型。工具事件没有 `kind`,`e.get("kind")` 取到 `None`。
- `raw = (next(tmp_path.glob("*.jsonl"))).read_text(encoding="utf-8")` 脱敏要在**原始文件文本**上查,不能在解析后的字典上查,因为你要证明的是「这些东西没有出现在磁盘上」。
- `assert "13812345678" not in raw and "sk-abcdef" not in raw and "a.b@x.com" not in raw` 三样原文都不在文件里。
- `assert "手机号***" in raw and "sk-***" in raw and "邮箱***" in raw` 同时确认是被替换了,不是整条记录丢了。
- `def test_wrap_up_and_llm_error_are_logged(tmp_path: Path, waits: list[float]) -> None:` 参数里的 `waits` 是昨天 `conftest.py` 里的 fixture,401 不重试其实用不上它,保留是为了以后改成 429 时不会真睡。
- `loop = FakeClient([[call("echo", text="a")]] * 4 + ["部分答案"])` 循环场景。
- `down = FakeClient([fake_http_error(401)])` 模型叫不动的场景,一个 401。
- `loop_rec, down_rec = read_records(tmp_path)` 同一个文件里两条记录,按写入顺序拆给两个变量。
- `assert loop_rec["status"] == "loop" and loop_rec["blocked"] == 2` 被拦了 2 次(第 3、4 次调用)。
- `assert [e["kind"] for e in loop_rec["events"] if e["type"] == "model"] == ["step"] * 4 + ["wrap_up"]` 模型事件 5 个:4 个普通步骤加 1 个收尾。**收尾那次调用确实被记下了**,这是不去覆盖 `_model_step` 的回报。
- `assert down_rec["events"][0]["error"] == "AuthenticationError"` 失败的那次模型调用也记了事件,带异常类名。
- `blocker.write_text("我是个文件,不是目录")` 先造一个**普通文件**。
- `log_dir=blocker / "sub"` 要在一个文件下面建目录,操作系统必然拒绝。
- `assert agent.run("hi").status == "ok"` 日志写失败,任务本身照样成功。
- `assert "写日志失败" in capsys.readouterr().err` `capsys` 是 pytest 自带的 fixture,抓住测试期间打到标准输出和标准错误的内容,`.err` 是标准错误那部分,验证警告确实打出来了。
- `(tmp_path / "runs-2026-10-23.jsonl").write_text(good + '\n{"run_id": "r2", "sta', encoding="utf-8")` 一行好的加半行坏的,和 `jsonl_basics.py` 一样。
- `assert [r["run_id"] for r in runs] == ["r1"] and bad == 1` 读出来一条,坏行数 1。
- `out = redact("x" * 10_000)` 一万个字符,不含任何敏感内容。
- `assert len(out) < MAX_FIELD + 100 and "原文共 10000 字符" in out` 被截到 2000 左右,并且提示里写着原长。

</div>

```bash
uv run pytest -q
```

```text
.........................                                                [100%]
25 passed in 1.53s
```

20 个旧的加今天 5 个,全绿。这里顺手看一个关键点:**日志的测试和 Agent 的测试是同一套思路**。三件事:造一个确定的剧本、跑、断言结果。区别只是断言的对象换成了磁盘上的文件。

## 动手练习

### 练习 1:哪个工具最拖后腿

在 `logs/` 上写一个脚本,按工具名汇总:调用次数、总耗时、最慢一次、报错次数、被截断次数,按总耗时倒序。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part03/ex194_tool_stats.py  练习 1:按工具汇总调用次数、总耗时、最慢一次、报错和截断次数
import sys
from collections import defaultdict
from typing import Any

from part03.triage import load_runs

runs, _ = load_runs(sys.argv[1])
stats: dict[str, dict[str, Any]] = defaultdict(lambda: {"calls": 0, "total": 0.0, "slowest": 0.0, "errors": 0, "cut": 0})
for run in runs:
    for e in run["events"]:
        if e["type"] != "tool":
            continue
        s = stats[e["name"]]
        s["calls"] += 1
        s["total"] += e["seconds"]
        s["slowest"] = max(s["slowest"], e["seconds"])
        s["errors"] += e["is_error"]  # 布尔值能直接加,True 当 1
        s["cut"] += e["truncated"]

print(f"{'工具':14} {'次数':>4} {'总耗时':>7} {'最慢':>6} {'报错':>4} {'截断':>4}")
for name, s in sorted(stats.items(), key=lambda kv: -kv[1]["total"]):
    print(f"{name:14} {s['calls']:4d} {s['total']:6.1f}s {s['slowest']:5.1f}s {s['errors']:4d} {s['cut']:4d}")
```

<div class="line-notes">

- `from collections import defaultdict` 带默认值的字典:取一个不存在的键时,自动用一个工厂函数造默认值,省得每次先判断「这个键有没有」。
- `runs, _ = load_runs(sys.argv[1])` 返回的第二个值(坏行数)这里用不上,用下划线丢掉。
- `stats: dict[str, dict[str, Any]] = defaultdict(lambda: {"calls": 0, "total": 0.0, "slowest": 0.0, "errors": 0, "cut": 0})` 第一次遇到某个工具名时,自动建一个全 0 的统计字典。`lambda: {...}` 是每次调用都返回一个新字典的匿名函数。
- `if e["type"] != "tool":` 模型事件不统计,`continue` 跳到下一个事件。
- `s = stats[e["name"]]` 取(或自动建)这个工具的统计字典,拿一个短名字用。
- `s["slowest"] = max(s["slowest"], e["seconds"])` 保留较大的那个。
- `s["errors"] += e["is_error"]  # 布尔值能直接加,True 当 1` Python 里 `True` 就是 1、`False` 就是 0,所以能直接累加。
- `print(f"{'工具':14} {'次数':>4}` `>4` 是右对齐宽度 4,`14` 是左对齐(字符串默认)宽度 14。
- `sorted(stats.items(), key=lambda kv: -kv[1]["total"])` `stats.items()` 给出 `(工具名, 统计字典)` 对,`kv[1]` 是统计字典。取负号倒序。

</div>

```bash
uv run python -m part03.ex194_tool_stats logs
```

```text
工具               次数     总耗时     最慢   报错   截断
slow_lookup       1    1.0s   1.0s    1    0
flaky_lookup      1    0.0s   0.0s    1    0
get_weather      15    0.0s   0.0s    1    0
search_web        1    0.0s   0.0s    1    0
dump_logs         1    0.0s   0.0s    0    1
list_cities       2    0.0s   0.0s    0    0
get_aqi           6    0.0s   0.0s    0    0
```

`slow_lookup` 总耗时 1.0 秒、报错 1 次(超时被包成了报错),是唯一拖后腿的;`get_weather` 调了 15 次但全是 0.0 秒,其中报错 1 次(那个参数不是合法 JSON 的)。`dump_logs` 截断 1 次。真实系统里这张表是做优化和做容量规划的起点。

</details>

### 练习 2:给脱敏加一条身份证号的规则

在 `SECRETS` 里加一条:18 位身份证号(17 位数字加最后一位数字或 X)抹成 `证件号***`。写测试验证身份证号和手机号都被抹掉。再试试一个 18 位的订单号会怎样,把结果写进测试。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/tests/test_redact_extra.py  练习 2:给脱敏加一条身份证号的规则,并写下它的误伤
import re

import pytest

from part03 import run_log


@pytest.fixture
def with_id_rule(monkeypatch: pytest.MonkeyPatch) -> None:
    rule = (re.compile(r"(?<!\d)\d{17}[\dXx](?!\d)"), "证件号***")
    monkeypatch.setattr(run_log, "SECRETS", [*run_log.SECRETS, rule])


def test_id_number_and_phone_are_both_masked(with_id_rule: None) -> None:
    out = run_log.redact("身份证 11010119900307123X,手机 13812345678")
    assert out == "身份证 证件号***,手机 手机号***"


def test_known_false_positive_18_digit_order_number(with_id_rule: None) -> None:
    assert run_log.redact("订单号 202610230000123456") == "订单号 证件号***"  # 误伤:宁可错杀,也别漏
```

<div class="line-notes">

- `import re` 要自己编译一条正则。
- `def with_id_rule(monkeypatch: pytest.MonkeyPatch) -> None:` 上面一行 `@pytest.fixture` 把它标成 fixture。这是一个只做事、不返回值的 fixture:测试参数里写上它的名字,pytest 就先执行它(往 `SECRETS` 里加一条规则)。
- `rule = (re.compile(r"(?<!\d)\d{17}[\dXx](?!\d)"), "证件号***")` 前面不能是数字、17 位数字、最后一位是数字或 X、后面不能是数字。`[\dXx]` 兼容小写 x。
- `monkeypatch.setattr(run_log, "SECRETS", [*run_log.SECRETS, rule])` 把模块里的 `SECRETS` 换成「原来的加上新规则」。`[*列表, 新项]` 是展开再追加,相当于 JS 的 `[...list, item]`。测试结束 `monkeypatch` 自动换回来,不会影响别的测试。`redact` 里是在函数运行时才读 `SECRETS`,所以替换能生效。
- `assert out == "身份证 证件号***,手机 手机号***"` 两种都被抹了,并且身份证号没有被手机号规则误抹(`(?<!\d)` 和 `(?!\d)` 的功劳)。
- `assert run_log.redact("订单号 202610230000123456") == "订单号 证件号***"  # 误伤:宁可错杀,也别漏` 一个 18 位的订单号,格式和身份证号一样,被抹掉了。把这个**误伤写成测试**,是为了让以后改规则的人知道这是已知的取舍,不是 bug。

</div>

```bash
uv run pytest tests/test_redact_extra.py -v
```

```text
tests/test_redact_extra.py::test_id_number_and_phone_are_both_masked PASSED [ 50%]
tests/test_redact_extra.py::test_known_false_positive_18_digit_order_number PASSED [100%]
============================== 2 passed in 0.02s ==============================
```

脱敏永远是在「漏」和「错杀」之间选。日志里订单号被抹掉会让你少一条线索,身份证号漏出来可能是一次事故,所以这里选错杀。如果你的订单号真是 18 位数字,更好的办法是让订单号带固定前缀、规则只匹配身份证的格式(比如校验出生日期那 8 位是不是合法日期),这是以后可以细化的。

</details>

### 练习 3:四个线程同时写一个日志文件

起 4 个线程,每个线程跑 25 次 `LoggedAgent`,都往同一个目录写。每次运行故意制造一条很长的记录(超过 8 KB 的写缓冲)。跑完检查:一共多少行,每一行还能不能解析成 JSON。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part03/ex194_concurrent.py  练习 3:四个线程同时往一个日志文件写,每行还是完整的 JSON 吗?
import json
import tempfile
from pathlib import Path
from threading import Thread

from part03.fake_client import FakeClient, call
from part03.run_log import LoggedAgent
from tests.test_robust_agent import reg

CHUNK = "很长的一句话。" * 270  # 约 1900 个汉字,正好不被日志截断


def worker(log_dir: Path, n: int) -> None:
    for _ in range(n):
        LoggedAgent(reg, "sys", llm=FakeClient([[call("echo", text=f"{i}{CHUNK}")] for i in range(10)] + ["好的"]), verbose=False, log_dir=log_dir).run("hi")


with tempfile.TemporaryDirectory() as tmp:
    threads = [Thread(target=worker, args=(Path(tmp), 25)) for _ in range(4)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    (path,) = Path(tmp).glob("runs-*.jsonl")
    lines = path.read_text(encoding="utf-8").splitlines()
    ok = 0
    for line in lines:
        try:
            json.loads(line)
            ok += 1
        except json.JSONDecodeError:
            pass
    print(f"一共 {len(lines)} 行,能解析的 {ok} 行,坏了 {len(lines) - ok} 行;单行最长 {max(len(x) for x in lines)} 字符")
```

<div class="line-notes">

- `from threading import Thread` 标准库的线程。
- `CHUNK = "很长的一句话。" * 270  # 约 1900 个汉字,正好不被日志截断` 每个工具结果 1900 多个字符,低于 `MAX_FIELD = 2000`,不被截断。
- `FakeClient([[call("echo", text=f"{i}{CHUNK}")] for i in range(10)] + ["好的"])` 10 步,每步调一次 `echo`,参数各不相同(开头的 `i` 不同,免得触发循环检测),总共一条记录有十几万字节。
- `threads = [Thread(target=worker, args=(Path(tmp), 25)) for _ in range(4)]` 建 4 个线程对象,`target` 是它要跑的函数,`args` 是传给函数的参数元组。
- `for t in threads:` 第一个循环,里面的 `t.start()` 把线程全部启动。
- `for t in threads:` 第二个循环,里面的 `t.join()` 是「等这个线程结束」,相当于 `await Promise.all`。
- `(path,) = Path(tmp).glob("runs-*.jsonl")` 恰好一个文件。
- `ok += 1` 能解析的行数加一,解析失败的不加。

</div>

```bash
uv run python -m part03.ex194_concurrent
```

```text
一共 100 行,能解析的 100 行,坏了 0 行;单行最长 61426 字符
```

100 次运行、100 行、100 行能解析,单行最长 6 万多个字符(汉字在 UTF-8 里占 3 个字节,一行将近 20 万字节)。我跑了三遍,每次都是零损坏。

别急着下「线程同时写没问题」的结论。**我没能把它写坏,不等于它保证不坏。** 这个结果依赖几个条件:同一个进程里的线程,每次都是 `with open(..., "a")` 各开各的文件对象,一条记录只调一次 `f.write`,而且文件在本机磁盘上。Python 对超过缓冲区的大写入会一次性交给操作系统,操作系统对追加模式的写入又会原子地定位到文件末尾,所以这里没出事。换成多个进程同时写、或者文件放在网络盘(NFS)上,行为就没这么好了。要稳妥就让**一个**地方负责写:加一个 `threading.Lock`,或者各线程把记录放进队列、由一个写线程取出来写(这个队列思路第七部分讲生产化时会再碰到)。

</details>

### 练习 4:把线上的失败变成回归测试

日志里存了每条 assistant 消息,等于存下了「模型当时演的剧本」。写一个 `replay(record, registry)`:从一条日志记录重建 `FakeClient` 的剧本,用同样的用户输入、同样的系统提示重放一遍,和原来的状态、步数对比。再写一个测试:先用 `LoggedAgent` 跑一次循环场景,再重放日志里的那条记录,结果必须一致。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part03/ex194_replay.py  练习 4:把日志里的一次运行变回剧本,重放一遍,看 Agent 还会不会得到同样的结果
import json
import sys
from typing import Any

from part03.agent_loop import ToolRegistry
from part03.budget import AgentResult, Limits
from part03.fake_client import FakeClient, Step
from part03.robust_agent import RobustAgent


def script_from(record: dict[str, Any]) -> list[Step]:
    """日志里每条 assistant 消息就是模型当时演的一幕:有工具调用就是工具调用,没有就是文字回答。"""
    if record["status"] == "llm_error":
        raise ValueError("llm_error 的运行里模型一句话都没说成,日志里没有可重放的消息")
    script: list[Step] = []
    for m in record["messages"]:
        if m["role"] != "assistant":
            continue
        if "tool_calls" in m:
            script.append([(tc["name"], tc["arguments"]) for tc in m["tool_calls"]])
        else:
            script.append(m["content"])
    return script


def replay(record: dict[str, Any], registry: ToolRegistry, limits: Limits | None = None) -> AgentResult:
    agent = RobustAgent(registry, record["messages"][0]["content"], limits, llm=FakeClient(script_from(record)),
                        verbose=False)
    return agent.run(record["user"])


if __name__ == "__main__":
    from part03.failure_zoo import reg

    with open(sys.argv[1], encoding="utf-8") as f:
        for line in f:
            rec = json.loads(line)
            if rec["status"] == "llm_error" or any(c["name"] not in reg.funcs for m in rec["messages"] for c in m.get("tool_calls", [])):
                continue  # 没法重放的:模型没说成话,或者用了这份注册表里没有的工具
            again = replay(rec, reg, Limits(max_steps=6, tool_timeout=1))
            same = (again.status, again.steps) == (rec["status"], rec["steps"])
            print(f"{rec['run_id']} 原来 {rec['status']:9} {rec['steps']} 步 | 重放 {again.status:9} {again.steps} 步 | {'一致' if same else '不一致!'}")
```

<div class="line-notes">

- `def script_from(record: dict[str, Any]) -> list[Step]:` 日志记录 → 剧本。`Step` 是昨天 `fake_client.py` 里定义的类型别名。
- `if record["status"] == "llm_error":` `llm_error` 的运行里模型一句话都没说成(`messages` 里没有真正的 assistant 回复),没法还原,明确报错比悄悄返回一个空剧本好。
- `for m in record["messages"]:` 遍历整个历史,循环里 `if m["role"] != "assistant": continue` 只看 assistant 消息,每条就是模型的一幕。
- `if "tool_calls" in m:` 日志里的工具调用是 `[{"name": ..., "arguments": ...}]`,没有 `tool_calls` 键就是文字回答。`in` 判断字典里有没有这个键。
- `script.append([(tc["name"], tc["arguments"]) for tc in m["tool_calls"]])` 还原成昨天剧本格式里的列表幕。
- `script.append(m["content"])` 文字幕。注意最后一条 assistant 消息可能是收尾的回答,它和别的文字幕一样被还原了。
- `def replay(record: dict[str, Any], registry: ToolRegistry, limits: Limits | None = None) -> AgentResult:` 用日志里的系统提示(`messages[0]`)和用户输入重建一个 `RobustAgent`,模型换成 `FakeClient`,工具用传进来的注册表(真工具,这样超时、截断、循环检测都是真的在跑)。
- 注意 `limits` 要自己传:原运行用的限制日志里没存,这是个遗漏。想真正「精确重放」,`limits` 也该写进日志(练习以外的改进)。
- `if rec["status"] == "llm_error" or any(c["name"] not in reg.funcs` 命令行入口里先跳过没法重放的:模型没说成话的,或者用到了这张注册表里没有的工具的。`any(...)` 只要有一个满足就是真。
- `same = (again.status, again.steps) == (rec["status"], rec["steps"])` 状态和步数都一样才算重放一致。

</div>

```bash
uv run python -m part03.ex194_replay logs/runs-2026-10-23.jsonl
```

```text
00a9fe49 原来 ok        2 步 | 重放 ok        2 步 | 一致
cf3b2c8a 原来 ok        2 步 | 重放 ok        2 步 | 一致
0c620c90 原来 ok        2 步 | 重放 ok        2 步 | 一致
d33b4f39 原来 loop      4 步 | 重放 loop      4 步 | 一致
bc2baf6d 原来 ok        2 步 | 重放 ok        2 步 | 一致
15da4671 原来 max_steps 6 步 | 重放 max_steps 6 步 | 一致
```

六条能重放的运行,重放结果全部一致。另外五条被跳过了:两个 `llm_error`,一个调了不存在的工具 `search_web`,两次真模型运行(用的是 `list_cities` 等,不在 `failure_zoo` 的注册表里)。再看测试:

```python
# agent-zero-lab/tests/test_replay.py  练习 4:日志里的一次运行,能变回剧本重放出同样的结果
def test_logged_loop_run_replays_to_the_same_result(tmp_path: Path) -> None:
    original = FakeClient([[call("echo", text="a")]] * 4 + ["部分答案"])
    LoggedAgent(reg, "sys", llm=original, verbose=False, log_dir=tmp_path).run("hi")
    record = json.loads(next(tmp_path.glob("*.jsonl")).read_text(encoding="utf-8"))
    assert script_from(record) == [[("echo", '{"text": "a"}')]] * 4 + ["部分答案"]  # 剧本被完整还原
    again = replay(record, reg, Limits())
    assert (again.status, again.steps, again.answer) == (record["status"], record["steps"], record["answer"])
```

<div class="line-notes">

- `LoggedAgent(reg, "sys", llm=original, verbose=False, log_dir=tmp_path).run("hi")` 第一次:正常跑,写日志。
- `record = json.loads(next(tmp_path.glob("*.jsonl")).read_text(encoding="utf-8"))` 读回那一行日志。文件里只有一行,所以直接 `json.loads` 整个文本也行。
- `assert script_from(record) == [[("echo", '{"text": "a"}')]] * 4 + ["部分答案"]` 还原出的剧本,和当初喂给 `FakeClient` 的完全相同(`call()` 生成的元组和日志里还原的元组是一样的)。这条断言证明「日志里存的信息够还原模型的每一幕」。
- `again = replay(record, reg, Limits())` 第二次:只靠日志里的信息重放。
- `assert (again.status, again.steps, again.answer) == (record["status"], record["steps"], record["answer"])` 重放的结果和原来一致。

</div>

```bash
uv run pytest -q
```

```text
............................                                             [100%]
28 passed in 1.44s
```

28 个全绿(20 + 5 + 练习 2 的 2 个 + 练习 4 的 1 个)。这个办法的真正用处是:**线上有一次失败,把它的日志记录取出来,重放成一个测试,修好 Bug 之后这个测试就是回归测试。** 它重放的是「模型说了什么」,工具和 Agent 代码是真的,所以能验证你的修复对这一次真实失败有效。它不能验证的是模型下次还会不会这样说,那要靠评测集(第六部分)。

</details>

**验收标准**:能说出 JSON Lines 比大 JSON 数组好在哪三点;`log_formats.py` 能说明为什么句子里的正则会捞错;`make_logs.py` 跑出 11 行、`grep 13812345678 logs/*.jsonl` 搜不到;能从 `triage.py` 的总览找到最慢的失败运行,并用时间线说出时间花在哪;`uv run pytest -q` 28 个全绿;能解释为什么邮箱正则要限长;练习 3 能说清「没写坏」和「保证不坏」的区别。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 日志(log) | 程序运行时留下的记录,出事之后用来还原当时发生了什么 |
| 结构化日志 | 每条记录是有字段名的数据(通常是 JSON),不是一句话。程序能按字段筛选、排序、统计 |
| JSON Lines / `.jsonl` | 每行一个完整 JSON 的文件格式,追加写、按行读,坏一行不影响其他行 |
| 追加模式(`"a"`) | 打开文件时只往末尾写,不动已有内容。`"w"` 会清空重写 |
| 事件(event) | 一次运行里发生的一件小事:一次模型调用、一次工具调用。每条带类型、耗时、各自的数据 |
| 时间线(timeline) | 把一次运行里所有事件按发生顺序摊开,配上累计时间 |
| `run_id` | 一次运行的随机编号,日志、报错、用户反馈靠它对上同一次运行 |
| UTC | 世界标准时间。日志统一存 UTC,看的时候再换算本地时间 |
| 脱敏(redact) | 写进日志前把 key、手机号、邮箱这类敏感信息替换成占位符 |
| 回溯(backtracking)/ ReDoS | 正则匹配失败时退回去换个方式再试。写得松的正则遇到长的不可信文本,耗时可以平方级增长,拖死服务 |
| 包装器 | 有同样接口、里面转调另一个对象并顺手做点事的类。`RetryingChat`、`TimedChat` 都是 |
| `super()` | 取到父类,用来调用父类原来的方法再加自己的逻辑 |
| 重放(replay) | 拿日志里记下的模型回复重建剧本,让 Agent 再跑一遍,验证结果能否复现 |
| `tmp_path` / `capsys` | pytest 自带的 fixture:前者给每个测试一个临时目录,后者抓住测试期间打印到标准输出和标准错误的内容 |

## 常见误区

**用 `print` 当日志。** 重启进程就没了,没法按字段查,和其他输出混在一起。至少写进文件;能写成 JSON 就写成 JSON。

**把日志存成一个大 JSON 数组。** 每加一条要读写整个文件,写到一半被杀整个文件作废。用 `.jsonl`。

**用 `"w"` 打开日志文件。** 每次打开都把旧日志清空。日志永远用 `"a"`。

**日志只存最终结果。** 只有 `status` 和 `answer`,出事时你只知道「失败了」,不知道哪一步、为什么。至少要有每一步的耗时、token 和工具结果大小。

**只覆盖 `_model_step` 记模型调用。** 收尾那次调用不经过它,出事时最想看的一次反而没记。包在 `self.llm` 外面,所有路径都经过。

**记录日志的代码改变了被记录的行为。** `TimedChat` 里 `except` 之后要 `raise`,吞掉异常会让 `RobustAgent` 看不到 `APIError`,`llm_error` 就永远不会出现。日志是旁观者。

**日志写不进去就让任务一起崩。** 磁盘满了、目录没权限,任务本身没有错。`_write` 里 `except OSError` 只打警告。(但别只打警告就算,线上要接报警,否则日志停写没人知道。)

**脱敏正则不限长度。** 用户名部分写成 `[\w.+-]+`,碰上 2 万个字符的不可信文本要 2.9 秒,10 万字符 82 秒。每一段都写 `{1,64}` 这样的上限。

**以为脱敏做了就安全。** 正则只抹得掉有固定格式的东西。姓名、地址抹不掉。能不存的就不存,存了的日志要管权限和保留期限。

**用 `datetime.utcnow()`。** 它返回不带时区的时间,Python 3.12 起已弃用。用 `datetime.now(timezone.utc)`。

**一条日志存几十万字符的工具结果。** 日志文件会膨胀,读的时候也慢。截断到够查问题就行,并写明原长。

**以为线程同时写文件「肯定没事」。** 我四线程跑了三遍没出事,但那取决于平台、写入大小和文件系统。要保证,就让一个地方负责写。

## 学习资料

### 文档与文章

- [JSON Lines 官网](https://jsonlines.org/):格式的说明,一页纸,三条规则:UTF-8、每行一个合法 JSON、行以 `\n` 结尾。英文。
- [Python 官方文档 · logging 模块](https://docs.python.org/zh-cn/3.12/library/logging.html):中文版。今天没有用 `logging`,是为了先把「记什么」讲清楚;真正的项目里日志级别(DEBUG/INFO/ERROR)、输出到多个地方、按大小轮转都由它负责,可以把今天的 JSON 记录接在它上面。
- [OpenTelemetry · Semantic conventions for generative AI](https://opentelemetry.io/docs/specs/semconv/gen-ai/):行业正在统一的 AI 应用可观测性字段约定,看看别人给「一次模型调用」「一次工具调用」起了哪些字段名,和我们的 `events` 对照。英文,这套约定还在演进,字段名会变,读思路别背字段。
- [Hamel Husain · Your AI Product Needs Evals](https://hamel.dev/blog/posts/evals/):强调「先看数据」:先从日志里把真实的失败一条条读出来,再决定评测什么。英文。
- [Anthropic · Demystifying evals for AI agents](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents):把一次运行的完整记录叫 transcript,评测和排查都是围绕它做的。今天的 `messages` 加 `events` 就是一份 transcript。英文。
- [Langfuse 文档](https://langfuse.com/docs):开源的 LLM 可观测性平台,把每次运行存成 trace,每个模型调用、工具调用是其中的 span,在网页上逐步回放。今天手写的东西是它的最小版,第六部分会真正接入。英文。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1gM7HzuEEJ&autoplay=0&high_quality=1" title="Python 别再打印了，赶紧学完日志模块，调试的好帮手" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>努力啊小白 · Python 别再打印了,赶紧学完日志模块,调试的好帮手 · 15 分钟,从 print 过渡到 logging,看日志级别和输出到文件,对应今天「为什么 print 不够」。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1rJv8eNE1x&autoplay=0&high_quality=1" title="[Python] logging模块怎么用" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>隔壁的程序员老王 · [Python] logging模块怎么用 · 10 分钟,logging 的基本用法,2024 年的视频。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1nZ3Q6yEzk&autoplay=0&high_quality=1" title="Langfuse 到底是什么？LLM 监控、Trace 与历史记录一次讲清" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>前端屎不了 · Langfuse 到底是什么?LLM 监控、Trace 与历史记录一次讲清 · 11 分钟,看一眼「专业版的运行记录」长什么样,对照今天的时间线,想想自己手写的少了什么。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/9L77QExPmI0" title="Modern Python logging" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>mCoding · Modern Python logging · 讲现代的 `logging` 配置写法,英文;看完回头想想练习 3 里「一个地方负责写」用 `logging` 怎么实现。</figcaption>
</figure>

### 书籍

- Chip Huyen《AI Engineering》(O'Reilly, 2025):讲 AI 应用的监控和可观测性,强调要记录中间步骤而不只是最终输出,英文。
- Charity Majors、Liz Fong-Jones、George Miranda《Observability Engineering》(O'Reilly, 2022):讲「宽事件」(一次请求一条带很多字段的记录)的日志思路,和今天一次运行一行记录同源,英文。

### 开源项目与代码

- [langfuse/langfuse](https://github.com/langfuse/langfuse):开源 LLM 可观测性平台,可以读它的数据模型(trace、observation)看一条运行记录应该含什么。
- [Delgan/loguru](https://github.com/Delgan/loguru):Python 第三方日志库,`serialize=True` 一个参数就能输出 JSON 行日志,想少写点代码时可以用。

## 自测

1. 为什么 Agent 的日志要「一次运行一行 JSON」,而不是一句话?

<details><summary>答案</summary>

句子靠正则捞字段,用户的话里碰巧有相同的文字就会串位(`log_formats.py` 把 `steps=4` 捞成了 3)。JSON 每个字段有名字,程序可以按状态筛、按耗时排、算 token 总和。一行一条(JSON Lines)还可以追加写,不用读旧内容,写到一半被杀只坏最后一行。

</details>

2. 为什么模型调用的计时要包在 `self.llm` 外面(`TimedChat`),而不是覆盖 `_model_step`?

<details><summary>答案</summary>

撞线时的收尾 `wrap_up` 直接调的是 `self.llm.chat`,不经过 `_model_step`。只覆盖 `_model_step` 会漏掉收尾那次调用,而收尾恰好是出事时最想看的一次。包在 `self.llm` 外面,主循环和收尾都会经过。顺带,计时在重试外面,重试等待的时间也算进这次调用。

</details>

3. `TimedChat.chat` 里 `except Exception as e:` 之后为什么要 `raise`?

<details><summary>答案</summary>

日志只能旁观,不能改变被观察者的行为。`RobustAgent` 靠接住 `openai.APIError` 来返回 `llm_error`,如果 `TimedChat` 把异常吞了,Agent 就看不到失败,会把一个不存在的结果当成成功往下走。记完再原样抛出,行为就没变。

</details>

4. `_write` 里为什么接住 `OSError` 只打一行警告,不让它抛出去?这样做有什么风险?

<details><summary>答案</summary>

日志是辅助,任务才是主业,磁盘满了不该让用户的请求失败。风险是日志悄悄停写,没人知道,真出事时发现没有记录。所以生产环境里这里应该触发报警(不只是打印),并监控日志文件是否在持续增长。

</details>

5. 脱敏用的邮箱正则为什么要给每一段限长?不限会怎样?

<details><summary>答案</summary>

不限长的 `[\w.+-]+@...` 遇到一长串没有 `@` 的字符时,会从每个位置开始吞到末尾再退回来,耗时随长度平方增长:2 万字符 2.9 秒,10 万字符 82 秒。`redact` 处理的是不可信、长度不可控的文本,一条长的工具结果就能让日志这一步卡住整个 Agent。每段限成 `{1,64}`,耗时降到几十毫秒;64 和 63 是邮箱各段的协议上限,不会漏掉真邮箱。

</details>

6. 面试题:线上一个 Agent 请求「偶尔很慢」,用户反映但你复现不了。你的日志里该有什么,才能事后查出原因?

<details><summary>答案</summary>

至少要有:每次运行的 `run_id`、开始时间、总耗时、最终状态;每一步模型调用的耗时、token、要调的工具名;每个工具调用的耗时、结果大小、是否超时或被截断;重试的情况(包含重试等待的总耗时);被循环检测拦下的次数;收尾那次调用也要记。有了它,按「耗时从长到短」筛出慢的运行,摊成时间线,就能分辨慢在哪:模型本身慢(单次调用耗时高)、工具慢(某个工具的耗时分布有长尾)、重试(一次调用里夹着退避等待)、步数多(循环或者任务本身长),而不是凭印象猜。再往上要加聚合监控:各状态的占比、耗时的 P50/P99、按工具的耗时分布,异常升高时报警。

</details>

## 明天预告

明天是 **Day 195 · 第 28 周复习:工具与 Agent 循环(Day 189–194)**。这一周六课从「为什么 Agent 特别容易出事」走到「出事之后留下什么」,一共做了七个文件、二十八个测试。明天先画一张知识地图,把九类失败、四个零件、两层测试和日志放进同一张图;再默写 `LoopGuard.check` 和 `RobustAgent.run` 的主循环;最后用本周的东西拼一个小项目:往 Agent 里随机注入故障,批量跑两百次,对比有防线和没防线的成功率、崩溃率和花费。
