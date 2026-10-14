---
title: 'Day 7 · W1 复习 + 小项目：带流式输出和成本统计的命令行聊天机器人'
description: 'W1 收尾。先用一张图把这周的知识串起来，再做本周小项目：一个支持多轮、流式、切换厂商、开关思考模式、斜杠命令、会话保存和加载、实时账单的命令行聊天机器人。最后是 W1 的面试题和这一周最容易踩的坑。'
pubDate: 2026-10-12
regime: none
tags: ['review', 'project', 'cli', 'agent-60']
series: 'agent-60'
day: 7
lang: 'zh'
---

## 今天要解决的问题

这一周你学了六样东西：模型的基本直觉、Python 工具链、API 调用、多轮和流式、提示词、结构化输出。分开学的时候每一样都不难，今天要做的是把它们拼成一个完整的、你愿意每天用的小工具，并且确认每一块你都真的掌握了。

今天结束时你应该：

1. 能不看笔记，画出 W1 的知识地图，说出每一块解决什么问题。
2. 完成本周小项目 `w1/chatbot.py`，它会成为你后面几周调试提示词的随手工具。
3. 能回答本周的面试题，答不出来的回去重看对应那天。
4. 把这周的代码整理好、写好 README、提交到 GitHub。

预计用时：5 到 6 小时。复习日不赶进度，宁可多花时间把不熟的地方补上。

## 一页知识地图

<figure>
<svg viewBox="0 0 640 330" role="img" aria-label="W1 知识地图：从模型直觉到可复用的客户端">
<rect x="0" y="0" width="640" height="330" fill="var(--paper-raised)" rx="6"/>
<g font-family="var(--font-mono)" font-size="12">
<rect x="20" y="20" width="180" height="78" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="110" y="42" text-anchor="middle" fill="var(--ink)">Day 1 模型直觉</text>
<text x="110" y="62" text-anchor="middle" fill="var(--ink-soft)">token / 窗口</text>
<text x="110" y="80" text-anchor="middle" fill="var(--ink-soft)">采样 / 幻觉 / 思考</text>
<rect x="230" y="20" width="180" height="78" rx="6" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="320" y="42" text-anchor="middle" fill="var(--ink)">Day 2 Python</text>
<text x="320" y="62" text-anchor="middle" fill="var(--ink-soft)">uv / 类型 / pydantic</text>
<text x="320" y="80" text-anchor="middle" fill="var(--ink-soft)">async / pytest</text>
<rect x="440" y="20" width="180" height="78" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="530" y="42" text-anchor="middle" fill="var(--ink)">Day 3 API</text>
<text x="530" y="62" text-anchor="middle" fill="var(--ink-soft)">兼容协议 / usage</text>
<text x="530" y="80" text-anchor="middle" fill="var(--ink-soft)">错误码 / 重试</text>
<rect x="20" y="130" width="180" height="78" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="110" y="152" text-anchor="middle" fill="var(--ink)">Day 4 对话状态</text>
<text x="110" y="172" text-anchor="middle" fill="var(--ink-soft)">messages / 裁剪</text>
<text x="110" y="190" text-anchor="middle" fill="var(--ink-soft)">流式 / TTFT</text>
<rect x="230" y="130" width="180" height="78" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="320" y="152" text-anchor="middle" fill="var(--ink)">Day 5 提示词</text>
<text x="320" y="172" text-anchor="middle" fill="var(--ink-soft)">背景 / 示例 / CoT</text>
<text x="320" y="190" text-anchor="middle" fill="var(--ink-soft)">标签 / 量化比较</text>
<rect x="440" y="130" width="180" height="78" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="530" y="152" text-anchor="middle" fill="var(--ink)">Day 6 结构化输出</text>
<text x="530" y="172" text-anchor="middle" fill="var(--ink-soft)">schema / 校验</text>
<text x="530" y="190" text-anchor="middle" fill="var(--ink-soft)">带错误重试</text>
<rect x="120" y="245" width="400" height="64" rx="6" fill="var(--compute)" stroke="var(--compute)"/>
<text x="320" y="270" text-anchor="middle" fill="var(--paper-raised)">common/llm.py · common/structured.py</text>
<text x="320" y="292" text-anchor="middle" fill="var(--paper-raised)">W2 起每一天都 import 它们</text>
<line x1="110" y1="208" x2="200" y2="245" stroke="var(--ink-soft)"/>
<line x1="320" y1="208" x2="320" y2="245" stroke="var(--ink-soft)"/>
<line x1="530" y1="208" x2="440" y2="245" stroke="var(--ink-soft)"/>
<line x1="530" y1="98" x2="530" y2="130" stroke="var(--ink-soft)"/>
<line x1="110" y1="98" x2="110" y2="130" stroke="var(--ink-soft)"/>
<line x1="320" y1="98" x2="320" y2="130" stroke="var(--ink-soft)"/>
</g>
</svg>
<figcaption>W1 的六块内容最后都沉淀成了两个文件。W2 开始做 Agent 时，你不会再关心怎么调 API、怎么算钱、怎么解析 JSON，这些都已经被封装好了。</figcaption>
</figure>

用几句话把这张图串一遍，试着自己说出来，说不顺的地方就是没掌握的地方：

模型是一个「猜下一个 token」的函数，它只能看到你这次请求里发过去的东西（上下文窗口），所以事实要靠你送进去，记忆要靠你重发历史。你通过一个 HTTP 接口调用它，几乎所有厂商都兼容 OpenAI 的格式，计费按 token，缓存命中的前缀便宜几十倍。多轮对话的成本随轮数平方增长，所以要裁剪历史，并且原样回放以保住缓存。流式输出降低首字延迟。提示词的核心是把背景、规则、格式写清楚，用示例覆盖边界，用标签隔开材料，并且每次改动都用数据量一下。程序要消费模型的输出时，用 schema 约束它，用 pydantic 校验它，失败了带着错误信息让它改。

## 本周小项目：命令行聊天机器人

需求：

- 多轮对话，流式输出，历史按轮滑动窗口。
- 斜杠命令：`/help` 帮助、`/env 文件名` 切换厂商、`/think on|off` 开关思考模式（DeepSeek）、`/system 内容` 改 system prompt、`/clear` 清空历史、`/save 文件名` 和 `/load 文件名` 保存和加载会话、`/cost` 显示账单、`/quit` 退出。
- 每轮结束显示 TTFT、输入输出 token、缓存命中和本轮花费。
- 会话保存成 JSON，下次能接着聊。

这些需求里没有一个是新知识，全部是这周学过的东西的组合。先自己试着写，写不出来再看下面的参考实现。

建议的写法顺序：先只做最基本的输入循环和流式输出，跑通了再加 `/quit` 和 `/clear`，然后是 `/cost`，最后才是保存加载和切换厂商。每加一个命令就手动试一下，别一口气写完两百行再调试。这也是以后写 Agent 的习惯：先跑通最短的路径，再一块块加能力，每一步都能看到结果。

为什么做命令行而不是网页？因为命令行版本最快能写完，所有注意力都在逻辑上。网页界面 W6 做服务化、W7 做毕业项目时会有，到时候这里的 `ChatBot` 逻辑可以几乎原样搬过去。

### 参考实现

先给 `Conversation` 加两个序列化方法。打开 `common/llm.py`，在 `Conversation` 类末尾加上（和上面的 `messages` 方法之间空一行）：

```python
    # 追加到 common/llm.py 的 Conversation 类中
    def to_dict(self) -> dict[str, Any]:
        return {"system": self.system["content"], "max_turns": self.max_turns, "turns": self.turns}

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> Conversation:
        conv = cls(data["system"], data.get("max_turns", 20))
        conv.turns = data["turns"]
        return conv
```

返回类型直接写 `Conversation` 就行，不用加引号：`llm.py` 开头有 `from __future__ import annotations`，类在自己的方法里引用自己不会报错。网上老代码常写成 `-> "Conversation"`，在我们的项目里 Ruff 会提示 `UP037` 让你去掉引号。`@classmethod` 是类方法，第一个参数 `cls` 是类本身，`cls(...)` 就是 `Conversation(...)`，作用和 Day 6 的 `model_validate_json` 一样，是个「造实例」的工厂方法。

然后是主程序：

```python
# agent-60-lab/w1/chatbot.py
"""W1 小项目：命令行聊天机器人。运行：uv run python -m w1.chatbot [--env .env.deepseek]"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import openai

from common.llm import Conversation, LLMClient

DEFAULT_SYSTEM = "你是一个简洁、靠谱的技术助手。用中文回答，不确定的事情直说不确定。"
SESSIONS = Path("sessions")

HELP = """命令：
  /help              显示帮助
  /env <文件>        切换厂商配置，比如 /env .env.claude
  /think on|off      开关思考模式（仅 DeepSeek）
  /system <内容>     修改 system prompt（会保留历史）
  /clear             清空历史
  /save <名字>       保存会话到 sessions/<名字>.json
  /load <名字>       加载会话
  /cost              显示累计账单
  /quit              退出"""


class ChatBot:
    def __init__(self, env_file: str | None) -> None:
        self.env_file = env_file
        self.client = LLMClient(env_file)
        self.conv = Conversation(DEFAULT_SYSTEM, max_turns=10)
        self.total_cost = 0.0   # 切换厂商后 ledger 会重置，这里单独累计

    # ---------- 命令 ----------
    def handle_command(self, line: str) -> bool:
        """处理斜杠命令。返回 False 表示退出。"""
        cmd, _, arg = line.partition(" ")
        arg = arg.strip()
        if cmd == "/quit":
            return False
        if cmd == "/help":
            print(HELP)
        elif cmd == "/env":
            if not arg or not Path(arg).exists():
                print("找不到配置文件：", arg or "(空)")
            else:
                self.total_cost += self.client.ledger.cost
                self.client = LLMClient(arg)
                self.env_file = arg
                print(f"已切换到 {self.client.model}（{arg}）")
        elif cmd == "/think":
            if arg not in ("on", "off"):
                print("用法：/think on 或 /think off")
            else:
                kind = "enabled" if arg == "on" else "disabled"
                self.client.extra_body["thinking"] = {"type": kind}
                print("思考模式：", arg, "（非 DeepSeek 厂商可能不认这个参数）")
        elif cmd == "/system":
            if not arg:
                print("当前 system：", self.conv.system["content"])
            else:
                self.conv.system = {"role": "system", "content": arg}
                print("已更新 system prompt")
        elif cmd == "/clear":
            self.conv.turns.clear()
            print("历史已清空")
        elif cmd == "/save":
            SESSIONS.mkdir(exist_ok=True)
            path = SESSIONS / f"{arg or 'default'}.json"
            path.write_text(json.dumps(self.conv.to_dict(), ensure_ascii=False, indent=2), encoding="utf-8")
            print("已保存到", path)
        elif cmd == "/load":
            path = SESSIONS / f"{arg or 'default'}.json"
            if not path.exists():
                print("没有这个会话：", path)
            else:
                self.conv = Conversation.from_dict(json.loads(path.read_text(encoding="utf-8")))
                print(f"已加载 {path}，共 {len(self.conv.turns)} 轮")
        elif cmd == "/cost":
            print("当前厂商：", self.client.ledger)
            print(f"本次运行累计约 ¥{self.total_cost + self.client.ledger.cost:.4f}")
        else:
            print("未知命令，输入 /help 查看")
        return True

    # ---------- 对话 ----------
    def ask(self, text: str) -> None:
        self.conv.add_user(text)
        print("助手：", end="", flush=True)
        try:
            for piece in self.client.stream(self.conv.messages(), temperature=0.5, max_tokens=2000):
                print(piece, end="", flush=True)
        except openai.APIStatusError as e:
            self.conv.turns.pop()             # 这轮失败了，别把孤零零的 user 消息留在历史里
            print(f"\n[出错 HTTP {e.status_code}] {e.message}")
            return
        except openai.APIConnectionError:
            self.conv.turns.pop()
            print("\n[连不上服务器，检查网络或代理]")
            return
        except KeyboardInterrupt:
            self.conv.turns.pop()
            print("\n[已中断]")
            return
        r = self.client.last
        self.conv.add_assistant(r.message)
        ttft = f"{r.ttft:.2f}s" if r.ttft is not None else "-"
        warn = "  ⚠ 被截断" if r.finish_reason == "length" else ""
        print(f"\n  [{self.client.model} | TTFT {ttft} | 输入 {r.prompt_tokens}（缓存 {r.cache_hit_tokens}）"
              f" | 输出 {r.completion_tokens} | ¥{r.cost:.5f}]{warn}")

    def run(self) -> None:
        print(f"已连接 {self.client.model}。输入 /help 查看命令。")
        while True:
            try:
                line = input("\n你：").strip()
            except (EOFError, KeyboardInterrupt):
                break
            if not line:
                continue
            if line.startswith("/"):
                if not self.handle_command(line):
                    break
            else:
                self.ask(line)
        print(f"\n再见。本次运行累计约 ¥{self.total_cost + self.client.ledger.cost:.4f}")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--env", default=None, help="配置文件，默认 .env")
    ChatBot(parser.parse_args().env).run()


if __name__ == "__main__":
    main()
```

先看 `handle_command` 开头这两行，后面所有命令都靠它拆参数：

```python
cmd, _, arg = line.partition(" ")
arg = arg.strip()
```

`partition(" ")` 在**第一个**空格处把字符串切成三段 `(前面, 分隔符, 后面)`，再用 tuple 解包赋给三个变量，中间的空格用不上，用 `_` 接住（Python 惯例，表示「这个值不要」，相当于 JS 的 `const [cmd, , arg] = ...`）：

```python
"/save s1".partition(" ")                    # ("/save", " ", "s1")
"/system 你是 严格的 审稿人".partition(" ")   # ("/system", " ", "你是 严格的 审稿人")
"/clear".partition(" ")                      # ("/clear", "", "")  没有空格也不报错
```

为什么不用 `split(" ")`：它会在**每个**空格处切，`/system` 后面整段带空格的提示词就被拆碎了。我们只想在命令名后面切一刀，partition 正好。最后 `strip()` 去掉参数两头多打的空格。

`/save` 分支里有几个文件操作的写法也值得认一下：

```python
SESSIONS.mkdir(exist_ok=True)                        # 建 sessions/ 目录，已存在不报错
path = SESSIONS / f"{arg or 'default'}.json"         # Path 用 / 拼路径，相当于 path.join
path.write_text(json.dumps(self.conv.to_dict(), ensure_ascii=False, indent=2), encoding="utf-8")
```

- `SESSIONS` 是 `Path("sessions")`，`pathlib` 重载了 `/`，`Path("sessions") / "s1.json"` 就是 `sessions/s1.json`，看着像除法其实是拼路径。
- `arg or 'default'`：arg 是空字符串（只输了 `/save`）时用 `'default'`，相当于 JS 的 `arg || "default"`。f-string 外面是双引号，里面就要用单引号。
- `json.dumps(obj, ensure_ascii=False, indent=2)` 相当于 `JSON.stringify(obj, null, 2)`，`ensure_ascii=False` 让中文原样保存；`write_text` 相当于 `fs.writeFileSync`。
- `/load` 反过来：`read_text()` → `json.loads()` → `Conversation.from_dict()`。

几处设计说明，面试讲项目时这些就是你的谈资：

**出错时回滚这一轮。** 请求失败后，如果把用户那条消息留在历史里，下一次请求会出现两条连续的 user 消息，有的厂商会报错，有的会让模型困惑。所以失败就 `pop()` 掉。这是一个很小的细节，但它体现的是「状态一致性」的意识。

**Ctrl+C 中断流式输出。** 生成到一半按 Ctrl+C，会触发 `KeyboardInterrupt`，我们丢弃这一轮，回到输入提示符，而不是让整个程序退出。注意此时已经生成的那部分 token 照样要付钱。

**切换厂商时累计花费。** 新建 `LLMClient` 时 ledger 会归零，所以切换前把旧的花费加到 `total_cost` 里。

**会话文件里存的是完整的 assistant 消息**，包括 `reasoning_content`。加载回来接着聊时，历史和当时一模一样，前缀缓存也有机会命中。

还有一处故意没做的：`/system` 修改 system prompt 后历史保留。这会让前缀缓存全部失效（system 是最前面的部分），下一轮会贵一些。这是功能和成本之间的一个取舍，你可以在 `/system` 的提示里告诉用户这一点。

### 给它写测试

命令处理是纯逻辑，可以不碰网络地测。用 pytest 自带的 `monkeypatch` 和 `tmp_path`：

```python
# agent-60-lab/tests/test_chatbot.py
import json

import pytest

from common.llm import Conversation
from w1 import chatbot


@pytest.fixture
def bot(monkeypatch, tmp_path):
    monkeypatch.setenv("LLM_BASE_URL", "http://localhost:1")
    monkeypatch.setenv("LLM_API_KEY", "test")
    monkeypatch.setenv("LLM_MODEL", "fake-model")
    monkeypatch.setenv("LLM_EXTRA_BODY", "{}")
    monkeypatch.setattr(chatbot, "SESSIONS", tmp_path)
    return chatbot.ChatBot(env_file=None)


def test_save_and_load_roundtrip(bot, tmp_path):
    bot.conv.add_user("你好")
    bot.conv.add_assistant({"role": "assistant", "content": "你好！", "reasoning_content": "打招呼"})
    assert bot.handle_command("/save s1")
    saved = json.loads((tmp_path / "s1.json").read_text(encoding="utf-8"))
    assert saved["turns"][0][1]["reasoning_content"] == "打招呼"

    bot.handle_command("/clear")
    assert bot.conv.turns == []
    bot.handle_command("/load s1")
    assert bot.conv.messages()[-1]["content"] == "你好！"


def test_think_toggle(bot):
    bot.handle_command("/think on")
    assert bot.client.extra_body["thinking"] == {"type": "enabled"}
    bot.handle_command("/think off")
    assert bot.client.extra_body["thinking"] == {"type": "disabled"}


def test_quit_returns_false(bot):
    assert bot.handle_command("/quit") is False


def test_conversation_dict_roundtrip():
    c = Conversation("SYS", max_turns=3)
    c.add_user("q")
    c.add_assistant({"role": "assistant", "content": "a"})
    assert Conversation.from_dict(c.to_dict()).messages() == c.messages()
```

测试里设置了假的环境变量，`LLMClient` 构造时只是建一个客户端对象，不会真的发请求，所以这些测试不需要网络和 key。`load_dotenv()` 默认不会覆盖已经存在的环境变量，所以就算你本地有 `.env` 文件，测试用的也是假值，不会误花钱。

### 扩展挑战（选做）

基础版做完还有余力的话，下面几个扩展每个都能练到这周的一个知识点，挑一两个做：

**`/retry`：重新生成上一轮回答。** 删掉最后一轮的 assistant 消息，用同样的历史再请求一次。想一想 temperature 设多少时重新生成才有意义。

**按 token 预算裁剪。** 现在是按轮数裁剪，改成「历史总 token 不超过 6000」。难点是请求前你不知道每条消息有多少 token，可以用每轮返回的 `prompt_tokens` 做估算，或者用 Day 1 的「中文每字约 0.6 token」粗略换算。

**摘要压缩。** 当轮数超过上限时，不是直接丢掉最早的几轮，而是调用一次模型，把它们压缩成一段摘要，放在 system 后面。注意摘要这次调用的花费也要计入账单，并且观察压缩前后缓存命中的变化，你会发现每压缩一次，缓存就要重新建立一次。

**`/extract`：把当前对话抽取成结构化笔记。** 用 Day 6 的 `extract()`，定义一个包含「讨论的主题」「得出的结论」「待办事项」三个字段的 schema，把整段对话抽成一份笔记保存下来。这是一个很实用的功能，也是一次结构化输出的综合练习。

**显示思考过程。** 开启思考模式时，把 `reasoning_content` 用灰色或缩进显示在正文之前。需要改 `LLMClient.stream()`，让它区分思考内容和正文分别 yield。

每做完一个，都给它补一个测试。

## 动手练习

**第 1 步：写完并跑通小项目。** 先自己写，卡住了再参考上面的实现。

```bash
uv run python -m w1.chatbot --env .env.deepseek
uv run pytest -q
```

**第 2 步：用它做一次真实的提示词调试。** 用 `/system` 把 Day 5 的工单分类 v3 提示词贴进去，然后把 Day 5 的工单（`w1/tickets.py` 里那些）一条条发进去，观察结果。再用 `/think on` 对比开关思考模式时边界工单的表现和花费差别。这就是你接下来几周调提示词的日常姿势。

**第 3 步：整理仓库。** 写一个 `README.md`，包含：这个仓库是什么、怎么装（`uv sync`）、怎么配置（复制 `.env.example`）、W1 每个脚本是干什么的、怎么跑测试。补齐 `.env.example`：

```bash
# agent-60-lab/.env.example
LLM_BASE_URL=https://api.deepseek.com
LLM_API_KEY=替换成你的key
LLM_MODEL=deepseek-flash
LLM_EXTRA_BODY={"thinking": {"type": "disabled"}}
LLM_PRICE=0.04,2,8
```

**第 4 步：提交并推到 GitHub。** 先确认 `.gitignore` 里至少有 `.env`、`.env.*`、`!.env.example`、`.venv/`、`sessions/`（会话文件可能有隐私内容，Day 0 建的 `.gitignore` 里还没有这一行，记得补上）。然后暂存、查密钥、再提交：

```bash
git add -A
git status                                                   # 看一眼清单，不该有 .env、sessions/
git diff --cached | grep -E "sk-[A-Za-z0-9]{20,}" && echo "⚠ 有密钥，别提交！"
git commit -m "W1: LLM client, structured extraction, CLI chatbot"
```

顺序很重要：`git diff --cached` 看的是**已暂存**的内容，所以要先 `git add` 再查；在 add 之前查，什么都查不出来。正则要求 `sk-` 后面跟 20 位以上字母数字，是为了只抓真 key，不误报 `.env.example` 里的 `sk-你的key` 这种占位符。

推到 GitHub：先在 github.com 右上角 **New repository** 建一个空仓库，名字 `agent-60-lab`，选 **Private**，不要勾 README / .gitignore（本地已经有了），然后：

```bash
git branch -M main                                           # uv init 建的默认分支可能叫 master，统一改成 main
git remote add origin git@github.com:<你的用户名>/agent-60-lab.git
git push -u origin main
```

推完到 GitHub 网页上再看一遍文件列表，确认没有 `.env`。

**第 5 步：对照自测题，把答不出来的标出来，回去重看对应的那天。** 面试题汇总里的每一题，都试着对着镜子或者录音讲两分钟，讲不下去的就是没真懂。

**验收标准：** 聊天机器人所有命令都能用；测试全部通过；仓库有 README 和 `.env.example`，已推到 GitHub 且没有任何密钥。

## 一周下来，你应该已经有的手感

复习不只是对答案，更要检查「手感」。下面这些事情，如果你能不查资料、几分钟内做完，说明这周学扎实了；哪一条要翻笔记半天，就回去把对应那天的练习重新敲一遍。

- 新建一个 uv 项目，加上 openai 和 pydantic 依赖，写一个脚本调用模型并打印 token 用量。五分钟以内。
- 看到一次调用的 usage（命中、未命中、输出各多少），心算出大概花了几分钱。
- 给你一段 SSE 原始报文，指出哪一块是最后一块、用量在哪里、结束标志是什么。
- 给一个新任务（比如「判断用户评论是不是在投诉」）写出第一版提示词，包含背景、类别定义、输出格式，并准备 10 条测试数据。
- 定义一个 pydantic 模型，导出 JSON Schema，用 `extract()` 跑通一次抽取，并故意制造一次校验失败看重试是否生效。
- 解释给一个没学过的朋友听：为什么模型「记得」你上一句话。

我自己第一次学到这个阶段时，最大的感受是：大模型应用开发里「AI」的部分比想象中少，「工程」的部分比想象中多。调 API 本身一行代码，但要让它在出错、超时、截断、格式不对、费用失控这些情况下都表现得可预期，需要的是扎实的后端功夫。这正是有工程背景的人转这个方向的优势所在。

## 下周怎么准备

W2 开始做 Agent，会比这周难一个台阶。有几件事今天顺手做好，下周会轻松很多。

第一，确认 `common/llm.py` 和 `common/structured.py` 的测试都是绿的。下周每一天都会 import 它们，基础不稳后面会很痛苦。

第二，充值。下周的 Agent 一次任务会调用模型好几次，加上调试时反复跑，费用会比这周高。按 Day 0 的估算，W2 大概几块到十几块钱，余额留 30 元以上比较安心。

第三，把 Anthropic 的《Building effective agents》再读一遍（见学习资料），下周 Day 13 会逐个实现里面的模式。

第四，想一想你身边有什么工作是「需要查好几个地方、做几步判断」的。下周的小项目是一个通用的命令行助手，如果你能想到一个自己真正用得上的场景（比如查公司内部文档、整理日报），把工具换成那个场景的，做出来的东西更有意思，面试时也更好讲。

## W1 面试题汇总

下面这些是这一周内容在面试里的常见问法。不用背答案，用自己的话能讲清楚、能举出自己代码里的例子就行。答案要点在每天的自测里已经给过，这里只列问题，最后的自测部分挑了几道给完整答案。

- 大模型为什么会产生幻觉？在工程上怎么缓解？（Day 1）
- 上下文窗口已经很大了，为什么还需要 RAG？（Day 1）
- temperature 设成 0 输出就一定确定吗？（Day 1）
- Python 的 GIL 对 Agent 服务的并发有什么影响？（Day 2）
- 你的系统要接多家模型厂商，怎么设计？（Day 3）
- 哪些 API 错误应该重试，哪些不应该？重试怎么做？（Day 3）
- 多轮对话越来越慢、越来越贵，怎么优化？（Day 4）
- 流式输出是怎么实现的？首字延迟受哪些因素影响？（Day 4）
- 怎么判断一个问题是提示词能解决的，还是需要别的手段？（Day 5）
- 团队里多人改提示词导致线上效果不稳定，怎么管理？（Day 5）
- JSON mode 和 Structured Outputs 有什么区别？（Day 6）
- 怎么保证模型抽取的关键字段（金额、编号）是正确的？（Day 6）

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 斜杠命令 | 以 `/` 开头的特殊输入，由程序处理而不是发给模型 |
| 会话持久化 | 把对话历史保存到文件或数据库，下次可以恢复 |
| 状态一致性 | 出错时把状态回滚到一致的样子，比如删掉失败那轮的用户消息 |
| monkeypatch | pytest 提供的临时替换环境变量、属性、函数的工具 |
| tmp_path | pytest 提供的临时目录，测试结束自动清理 |
| fixture | pytest 中为测试准备公共资源的函数 |
| .env.example | 列出所需环境变量但不含真实值的模板文件，提交进仓库 |

## 常见误区

这是 W1 我见过（也自己犯过）最多的坑，挑出来集中再过一遍：

**照抄过时教程里的模型名和参数。** 2024、2025 年的视频和博客里很多写法已经不对了，以官方文档当前版本为准。

**API 报错不看状态码就重试。** 401、402、400 重试没用，先看清楚是什么错。

**不看 finish_reason。** 被截断的回答和完整的回答，content 看起来都是一段正常的文字。

**多轮对话只存 content。** 丢了 reasoning_content 和 tool_calls，下周一加工具就 400。

**流式请求失败后，历史里留了一条孤零零的 user 消息。** 下一轮出现连续两条 user，有的厂商会直接报错。

**提示词改了凭感觉说「好像更好了」。** 至少用十几条带标注的数据量一下。

**相信 JSON mode 返回的字段一定对。** 必须 pydantic 校验。

**密钥进了 git。** 提交前 `git diff --cached` 看一眼，养成习惯。

## 学习资料

### 文档与文章

- 回顾本周每一天的「必看」文档，这周没看完的今天补上：[DeepSeek 文档](https://api-docs.deepseek.com/zh-cn/)、[Claude 提示词最佳实践](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices)、[OpenAI Structured Outputs](https://platform.openai.com/docs/guides/structured-outputs)。
- [Anthropic《Building effective agents》](https://www.anthropic.com/engineering/building-effective-agents)：Day 0 读过一遍。下周开始做 Agent，今天带着这周的知识再读一遍，你会发现第一遍没看懂的地方现在都能看懂了。30 分钟。
- [pytest 文档：monkeypatch](https://docs.pytest.org/en/stable/how-to/monkeypatch.html)：今天测试里用到的工具。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1kC4y1P7Lt&autoplay=0&high_quality=1" title="【中英字幕】【Andrej Karpathy】【一小时交流】大语言模型介绍" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>Dr括号（搬运）· 【中英字幕】【Andrej Karpathy】【一小时交流】大语言模型介绍 · 如果 Day 1 只看了 3Blue1Brown 的短片，今天把这一小时看完，它是对这一周「模型是什么」最好的总结。</figcaption>
</figure>

- 吴恩达《Agentic AI》（BV1aaxyz8ELY）：看模块 1 剩下的几 P（P4、P6、P7、P8），为下周做 Agent 打底，大约 25 分钟。

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/EWvNQjAaOHw" title="How I use LLMs" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Andrej Karpathy · How I use LLMs · 2 小时，站在使用者角度讲思考模型、工具使用、搜索、代码执行等。你这周从开发者角度学了同样的东西，换个角度看一遍会把很多点串起来。可以 1.5 倍速，挑感兴趣的章节看。</figcaption>
</figure>

### 书籍

- Chip Huyen《AI Engineering》（O'Reilly，2025）：这周如果只读了零散的章节，周末把第 1 章和第 5 章完整读一遍。
- 《图解大模型：生成式 AI 原理与实战》（人民邮电出版社，2025）：Day 1 推荐的第 2、3 章没读的补上，图很多，读起来不累。

### 开源项目与代码

- [anthropics/prompt-eng-interactive-tutorial](https://github.com/anthropics/prompt-eng-interactive-tutorial)：Day 5 推荐的交互教程，没做完的今天做完。
- [Datawhale《hello-agents》](https://github.com/datawhalechina/hello-agents)：读一读它的前几章，和这周的内容对照，为下周进入 Agent 预热。

## 自测

1. 不看任何资料，写出 `LLMClient.chat()` 从发请求到返回 `ChatResult` 要做的几件事。

<details><summary>答案</summary>

合并厂商扩展参数（extra_body）和本次参数；调用 chat.completions.create 并计时；取 choices[0]；把 message 原样 dump 成 dict（保留 reasoning_content、tool_calls）；读 usage，取出缓存命中数（兼容 DeepSeek 和 OpenAI 两种字段）；按价格算花费；组装 ChatResult；记入 ledger。

</details>

2. 你的聊天机器人用了 30 轮后变得很慢，你会按什么顺序排查？

<details><summary>答案</summary>

先看每轮的输入 token 数是否在持续增长（历史裁剪是否生效）；再看缓存命中数是否正常（是不是改动了历史或 system 导致缓存失效）；再看 TTFT 和总时长哪个变大了（TTFT 变大多半是输入变长或开了思考模式，总时长变大可能是输出变长）；最后看是否频繁遇到 429 触发了自动重试。

</details>

3. 为什么流式请求失败或被中断时要把这一轮的 user 消息从历史里删掉？

<details><summary>答案</summary>

保持历史的一致性。不删的话，下一轮会出现连续两条 user 消息且中间没有 assistant 回复，有的厂商会报错，有的会让模型困惑。同时这条失败的消息也会污染之后的上下文。

</details>

4. 面试题：「讲讲你做过的这个命令行聊天机器人，有什么设计上的考虑？」

<details><summary>答案</summary>

参考结构：先一句话说它是什么（支持多厂商、流式、成本统计的命令行对话工具，作为后续 Agent 开发的基础组件）；然后讲两三个设计点：统一的客户端封装隔离了厂商差异，换厂商只改配置；历史按轮滑动窗口并原样回放，兼顾成本、缓存和工具调用的兼容性；失败时回滚当前轮保持状态一致；每轮记录 TTFT、token、缓存和花费，便于做成本和延迟分析。最后说一个取舍（比如修改 system prompt 会让缓存失效）和你会怎么改进（摘要压缩、异步版本）。用具体数字（比如缓存命中后单轮成本降了多少）会更有说服力。

</details>

5. 面试题：「在 Agent 系统里，结构化输出为什么重要？你会怎么保证它的可靠性？」

<details><summary>答案</summary>

重要性：Agent 的输出要被程序消费（路由、调用工具、写数据库），工具调用本身就是结构化输出，格式不可靠整条流水线就会断。可靠性分层保证：优先用厂商的 schema 约束输出（约束解码），不支持时用 JSON mode 加 schema 写进提示词；程序侧永远用 pydantic 校验；校验失败把错误信息喂回去重试，设重试上限；区分截断、空返回、校验失败等不同错误分别处理；关键字段用规则二次核对；监控重试率作为质量指标。

</details>

6. 这一周你觉得最难的是哪一部分？回到那一天，把自测题重新做一遍。

<details><summary>答案</summary>

这一题没有标准答案。如果某一天的自测有两道以上答不出来，建议把那天的「动手练习」重新从零写一遍，不看之前的代码。

</details>

## 明天预告

Day 8 · Function calling：模型怎么「调用」函数（它其实只写了一段 JSON）。W2 开始，正式进入 Agent。明天你会看到，所谓模型调用工具，其实是模型输出了一段「我想调用哪个函数、参数是什么」的结构化数据，执行的永远是你的代码。把一次完整的工具调用来回拆成消息时序，你就理解了 Agent 的一半。
