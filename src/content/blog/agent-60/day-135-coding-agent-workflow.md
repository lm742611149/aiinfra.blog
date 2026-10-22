---
title: 'Day 135 · 用 Coding Agent 干活:AGENTS.md、hooks、无人值守与规格驱动开发'
description: '这一课不讲 Coding Agent 内部怎么实现,讲你作为工程师怎么用它:写一份够短的 AGENTS.md,用 hooks 把「请不要」变成「不能」,配一个只读的审查子 Agent,用 claude -p 在 CI 里无人值守地跑,再用 Spec Kit 走一遍规格驱动开发。最后讲怎么验收 Agent 写的代码,以及面试官问「你怎么用 AI 写代码」时怎么答。'
pubDate: 2026-10-22
regime: none
tags: ['coding-agent', 'claude-code', 'agents-md', 'hooks', 'spec-driven', 'ci', 'agent-60']
series: 'agent-60'
day: 135
lang: 'zh'
---

## 今天要解决的问题

**建议在 [Day 14 · W2 复习 + 小项目:命令行 Agent](/blog/agent-60/day-14-week2-review-cli-agent/) 之后读。** 专题篇可以跳着读,这一篇只用到 Day 14 以前的东西:你已经手写过 Agent 循环,知道工具调用是模型写一段 JSON、程序去执行;也有了一个推到 GitHub 的 `cli-agent` 仓库和本地的 `agent-60-lab` 练习仓库。

先说清楚这一课和另外两课的分工。[Day 89](/blog/agent-60/day-89-coding-agents-internals/) 拆的是 SWE-agent、OpenHands、Codex 的**内部设计**,是造 Agent 的人的视角;[Day 55](/blog/agent-60/day-55-second-project-code-review-agent/) 是自己做一个审查机器人。今天是**用的人**的视角:你每天开着 Claude Code、Codex 或 Cursor 写代码,怎么配置它,才能让它少犯错、犯了错能被拦住、没人盯着的时候也能放心让它跑。

招聘方很在意这件事。站里 Day 0 的 JD 调研里,国内有正文的 334 条 JD 约 21% 点名要求熟练使用 Coding Agent,海外 15%,常见写法是「熟练使用 Claude Code/Cursor 并能把控生成代码的质量」。前半句人人会说,后半句才是面试时拉开差距的地方。

学完你应该能做到:

1. 给 `agent-60-lab` 写一份 100 行以内的 `AGENTS.md`,让 Claude Code 和 Codex 读同一份指令,说得出哪些东西该写、哪些不该写。
2. 配两个 hooks:改密钥文件、跑危险命令时直接拒绝;改完 Python 文件自动跑 ruff 和测试,不过就把报错塞回给模型。用假输入把两个钩子都测一遍。
3. 写一个只读的代码审查子 Agent,知道它和主会话的区别。
4. 用 `claude -p` 在脚本里无人值守地跑一次,拿到 JSON 结果和花费;读懂一份 GitHub Actions 自动审查配置,说出它的权限风险。
5. 用 GitHub Spec Kit 给一个小需求走完 specify → plan → tasks → implement,判断什么样的需求值得这样做。

预计用时 4–6 小时。前置:装好 Claude Code(或者 Codex CLI,命令不同但思路一样),有一个能用的订阅或 API key。整课的 API 花费主要在第 4、5 步,一次 headless 运行几分钱到几毛钱,Spec Kit 走一遍完整流程看需求大小,小需求大概一两块钱。

## 先分清:你在用 Agent,不是在造 Agent

Day 9 你写过一个 100 行的循环:把消息发给模型,模型返回工具调用,你执行,把结果塞回去,直到模型说完了。Claude Code 本质上就是一个打磨了很久的这种循环,工具是读文件、改文件、跑 shell、搜索,外加一大堆上下文管理和权限控制。区别在于这次循环不是你写的,你能动的只有它留出来的几个口子。

这些口子按「约束力」从弱到强排,大致是四层:

<figure>
<svg viewBox="0 0 640 300" role="img" aria-label="Coding Agent 的四层控制:指令文件是建议,权限模式是开关,hooks 是强制检查,CI 是最后验收">
<rect x="0" y="0" width="640" height="300" fill="var(--paper-raised)"/>
<g font-family="var(--font-mono)" font-size="12">
<rect x="20" y="20" width="600" height="56" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="36" y="44" fill="var(--mem)">① 指令文件 AGENTS.md / CLAUDE.md</text>
<text x="36" y="64" fill="var(--ink-soft)">进上下文,模型「读了大概会照做」。软约束,写得越短越准越有用</text>
<rect x="20" y="88" width="600" height="56" rx="6" fill="none" stroke="var(--mem)"/>
<text x="36" y="112" fill="var(--mem)">② 权限规则和模式 allow / deny / acceptEdits / dontAsk</text>
<text x="36" y="132" fill="var(--ink-soft)">按工具名和命令前缀放行或拒绝,不懂语义</text>
<rect x="20" y="156" width="600" height="56" rx="6" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="36" y="180" fill="var(--compute)">③ hooks:你的程序在每次工具调用前后运行</text>
<text x="36" y="200" fill="var(--ink-soft)">能看到参数、能拒绝、能把报错塞回给模型。硬约束</text>
<rect x="20" y="224" width="600" height="56" rx="6" fill="none" stroke="var(--compute)"/>
<text x="36" y="248" fill="var(--compute)">④ CI 与人工审查</text>
<text x="36" y="268" fill="var(--ink-soft)">Agent 怎么折腾都绕不过去的最后一道门:测试、类型检查、code review</text>
</g>
</svg>
<figcaption>越往下越硬。常见的错误是把该放在第 ③ 层的规则写进第 ① 层,然后奇怪模型「为什么不听话」。</figcaption>
</figure>

Claude Code 官方文档把第一层说得很直白:CLAUDE.md 和自动记忆都是「上下文,不是强制配置」,要无论模型怎么想都拦住某个操作,就用 PreToolUse hook。我第一次配的时候在 CLAUDE.md 里写了「不要读 .env」,结果它在排查一个连不上数据库的问题时,还是 `cat .env` 看了一眼连接串。它没有恶意,它在认真解决问题,而这条规则对它来说只是一句建议。

## 指令文件:AGENTS.md 和 CLAUDE.md

**AGENTS.md** 是一个约定,不是什么复杂规范:仓库根目录放一个 Markdown 文件,告诉 Coding Agent 怎么构建、怎么测试、有什么规矩。它 2025 年 8 月出来,2025 年 12 月 OpenAI 把它和 Anthropic 的 MCP、Block 的 goose 一起捐给了 Linux 基金会下面新成立的 Agentic AI Foundation(AAIF)。OpenAI 当时的说法是已经有超过 6 万个开源项目在用(2026 年 10 月查到,出处见学习资料)。Codex、Cursor、Copilot、Gemini CLI 都认它。

Claude Code 自己的文件叫 **CLAUDE.md**,现在也能直接读 AGENTS.md。按官方文档(2026 年 10 月查到,要 v2.1.277 以后):仓库里只有 AGENTS.md、没有 CLAUDE.md 时,它读 AGENTS.md;两个都有,默认只读 CLAUDE.md。所以团队里有人用 Claude Code、有人用 Codex,最省事的做法是正文写在 AGENTS.md 里,CLAUDE.md 只写一行 `@AGENTS.md` 把它导进来,再补几条 Claude 独有的东西。

Claude Code 加载 CLAUDE.md 是分层的:`~/.claude/CLAUDE.md` 是你个人所有项目通用的,项目根目录的 `CLAUDE.md` 进 git 给团队共享,`CLAUDE.local.md` 是你个人对这个项目的偏好、要加进 `.gitignore`。子目录里的 CLAUDE.md 不是一启动就加载,而是 Claude 读写那个目录里的文件时才加载。规则多了还可以拆进 `.claude/rules/`,按路径匹配,只有碰到对应文件时才进上下文。

### 写什么

官方给的长度目标是**每个 CLAUDE.md 200 行以内**,理由是越长越占上下文、越不容易被遵守。我自己的经验是 100 行以内效果最好。写进去的应该是「每次会话都要知道的事实」:

- 怎么跑、怎么测:具体命令,一字不差。
- 目录结构里不显然的约定。
- 你踩过、而模型大概率也会踩的坑。

最后一条最值钱。下面是给 `agent-60-lab` 写的版本,里面每一条都对应这门课里真实出过的问题:

```markdown
<!-- agent-60-lab/AGENTS.md -->
# agent-60-lab

60 天 AI Agent 课程的练习仓库。Python 3.12 + uv,每周一个目录 w1/ … w4/,专题在 topics/。

## 命令
- 装依赖:`uv sync`
- 跑某个练习:在**仓库根目录**跑 `uv run python -m w2.agent_loop`,不要 cd 进子目录、不要按文件路径跑
- W3 的文件是平级 import 写的,例外:`uv run python w3/docqa.py`
- 测试:`uv run pytest -q`(pyproject 里已配 pythonpath=["."])
- 只检查不改:`uvx ruff check <文件>`;不要跑 `ruff --fix`,格式化交给编辑器

## 约定
- 调大模型一律用 common/llm.py 的 LLMClient,不要直接 new OpenAI()
- messages 的类型写 `list[Any]`,否则 basedpyright 报红
- DeepSeek 关思考模式靠 .env 里的 LLM_EXTRA_BODY,不要在代码里写死 extra_body
- 金额一律用「分」存成 int(见 w4/cloudledger/seed.py),展示时才除以 100

## 不要做
- 不要读、改、打印 .env 和 .env.*(.env.example 可以);需要配置项看 .env.example
- 不要改 tests/ 里已有的断言来让测试通过;测试错了先停下来问
- 不要 git push,不要改 git 配置

## 详细文档
- 课程每一天的说明在 https://aiinfra.blog/course/ ,遇到某一天的代码先读那一天的文章
```

<div class="line-notes">

- `# agent-60-lab` 第一段只用一句话说清这是什么仓库。模型每次会话都会读到这段,别在这里写项目历史和愿景。
- `在**仓库根目录**跑` 这一条来自 Day 8 到 Day 12 里反复出现的问题:按路径跑 `python w2/agent_loop.py` 会让 `from w2.xxx import` 找不到包。写清楚以后,模型给你的运行命令就是对的。
- `W3 的文件是平级 import 写的,例外` 规则有例外就要写出来,不然模型会把 W3 也改成 `-m` 方式跑,然后报 `No module named 'chunking'`。
- `格式化交给编辑器` 禁止项要给理由或替代做法。光写「不要格式化」,模型不知道该怎么检查代码风格。
- `messages 的类型写` Day 8 和 Day 9 里 `list[dict]` 导致的类型红线一共出现过 6 条,这种「编辑器报错但能跑」的问题模型自己发现不了。
- `不要读、改、打印 .env` 这一条写在这里只是提醒,真正拦住它的是后面的 hook。两边都写,模型读到这条就不会去尝试,hook 负责兜底。
- `不要改 tests/ 里已有的断言` Coding Agent 最常见的偷懒方式之一就是改测试让它通过。写进指令文件能挡掉大部分,剩下的靠审查(见后文)。
- `## 详细文档` 不把整门课的内容塞进来,只给一个入口。这就是后面会讲的「给地图,不给手册」。

</div>

```markdown
<!-- agent-60-lab/CLAUDE.md -->
@AGENTS.md

## Claude Code 专用
- 改完 Python 文件后 hooks 会自动跑 ruff 和 pytest,看到 hook 报错就先修
- 需要独立审查时用 reviewer 子 Agent,不要自己审自己刚写的代码
```

<div class="line-notes">

- `@AGENTS.md` 导入语法。被导入的文件在启动时就展开进上下文,所以导入只是方便组织,不省上下文。导入最多递归 4 层,路径相对于写导入的这个文件。
- `hooks 会自动跑 ruff 和 pytest` 告诉模型 hook 的存在,它看到 hook 返回的报错时就知道这是预期内的反馈,不会以为环境坏了。

</div>

### 不写什么

不写代码风格细节,那是 linter 的事,写了也是浪费上下文。不写「要写高质量代码」「注意安全」这种谁都会说的话,对模型没有信息量。不写只对某个子目录有用的长流程,那种放进 `.claude/rules/` 的路径规则或者 skill 里(Skill 见 [Day 131](/blog/agent-60/day-131-agent-skills/))。

还有一条容易忽略:**指令之间不能打架**。官方文档的说法是两条指令矛盾时,模型「可能随便挑一条」。最常见的矛盾来自 `~/.claude/CLAUDE.md` 和项目 CLAUDE.md,比如个人文件写「用 pnpm」,项目里写「用 npm」。隔一阵子把几层文件放在一起读一遍。

### 给地图,不给手册

2026 年 2 月 OpenAI 发了一篇被讨论很多的文章《Harness engineering: leveraging Codex in an agent-first world》,作者 Ryan Lopopolo。讲的是他们一个团队五个月里做出一个内部产品,代码全部由 Codex 写,人一行没手写。我能打开的二手整理里提到的数字是三名工程师起步、约 1500 个 PR、约一百万行代码(原文 openai.com 对脚本返回 403,这些数字我没有在原文里核对,引用时请自己去看)。

对写指令文件最有用的一条经验是:AGENTS.md 不要试图装下关于系统的所有知识,它是一份**目录**,指向更详细的设计文档、计划和架构决策记录。原因很朴素,一个塞满东西的长文件,模型读完也抓不住重点;一张短地图加上「需要时去这里看」,模型会按需去读。这和 Day 20 讲的上下文工程是一回事:上下文是稀缺资源,只放每次都要用的东西。

## hooks:把「请不要」变成「不能」

hook 是你写的一段程序,Claude Code 在生命周期的固定时刻调用它。2026 年 10 月的文档里事件已经有三十多个,日常最有用的是这几个:

| 事件 | 什么时候触发 | 典型用途 |
| --- | --- | --- |
| `PreToolUse` | 工具调用执行之前 | 拦危险命令、拦读密钥、改参数 |
| `PostToolUse` | 工具执行完 | 改完文件跑 lint 和测试,把结果反馈给模型 |
| `UserPromptSubmit` | 你按回车之后、模型看到之前 | 往提示词里补上下文,拦敏感信息 |
| `Stop` | 模型准备结束这一轮 | 检查任务是不是真做完了,没做完就不让停 |
| `SessionStart` | 会话开始 | 注入当天的上下文,比如当前分支、未完成的 TODO |

配置写在 `.claude/settings.json`(进 git,团队共享)、`.claude/settings.local.json`(个人)或 `~/.claude/settings.json`(你所有项目)。结构是三层嵌套:事件 → 匹配器 → 处理程序。

`agent-60-lab/.claude/settings.json`(JSON 不能写注释,路径写在这里):

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash|Read|Edit|Write",
        "hooks": [
          { "type": "command", "command": "uv run python ${CLAUDE_PROJECT_DIR}/.claude/hooks/guard.py" }
        ]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "Edit|Write",
        "hooks": [
          { "type": "command", "command": "uv run python ${CLAUDE_PROJECT_DIR}/.claude/hooks/after_edit.py" }
        ]
      }
    ]
  }
}
```

<div class="line-notes">

- `"PreToolUse": [` 一个事件下面可以挂多组匹配器,每组里又可以挂多个处理程序。多个 PreToolUse 钩子给出不同决定时,优先级是 deny > defer > ask > allow。
- `"matcher": "Bash|Read|Edit|Write"` 匹配器按工具名过滤,支持 `|` 写多个。不写 matcher 就是所有工具都触发,每次读文件都要启动一次 Python,会明显变慢。
- `"type": "command"` 处理程序除了 command(跑一个命令),还有 http、mcp_tool、prompt、agent 几种。command 最简单,也最好测。命令里的 `${CLAUDE_PROJECT_DIR}` 是 Claude Code 提供的变量,指向项目根目录;用它拼出绝对路径,模型 cd 到子目录以后钩子照样能找到脚本。
- `"matcher": "Edit|Write"` 只在改文件之后跑检查,读文件不跑。

</div>

处理程序从 stdin 收到一段 JSON,里面有会话 id、当前目录、事件名、工具名和工具参数。它通过两样东西把决定告诉 Claude Code:退出码和 stdout 上的 JSON。这里有个反直觉的坑,文档特意标了出来:**exit 1 不会拦住任何东西**。exit 0 是成功,exit 2 才是「阻断」,其他非零退出码一律当成「钩子自己出错了,操作照常进行」。Unix 习惯里失败就 exit 1,写安全检查时千万别这么写。

下面是拦截钩子。它不用 exit 2,而是 exit 0 加一段 JSON 写清决定和理由,这样模型能看到为什么被拒:

```python
# agent-60-lab/.claude/hooks/guard.py
"""PreToolUse 钩子:模型每次要调 Bash / 读写文件之前,Claude Code 先把这次调用的 JSON 从 stdin 交给我。
不想让它做的,打印 deny;要人点头的,打印 ask;其他情况什么都不打印、exit 0,走正常权限流程。
"""

import json
import re
import sys

event = json.load(sys.stdin)
tool = event.get("tool_name", "")
args = event.get("tool_input", {})

SECRET = re.compile(r"(^|/)\.env($|\.)")  # .env、.env.deepseek,但不拦 .env.example
DANGER = [r"\brm\s+-[a-z]*r[a-z]*f", r"git\s+push\s+.*--force", r"git\s+reset\s+--hard"]


def decide(decision: str, reason: str) -> None:
    print(json.dumps({
        "hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": decision,
            "permissionDecisionReason": reason,
        }
    }, ensure_ascii=False))
    sys.exit(0)


path = args.get("file_path", "")
if tool in {"Read", "Edit", "Write"} and SECRET.search(path) and not path.endswith(".example"):
    decide("deny", f"{path} 里是 API key,不许读也不许改。需要配置项去看 .env.example。")

if tool == "Bash":
    cmd = args.get("command", "")
    if re.search(r"\.env\b(?!\.example)", cmd):
        decide("deny", "命令里碰到了 .env,密钥文件不许通过 shell 读。")
    for pat in DANGER:
        if re.search(pat, cmd):
            decide("deny", f"危险命令被钩子拦下:{cmd}")
    if re.search(r"\bgit\s+push\b", cmd):
        decide("ask", "要推到远程,先让人看一眼。")

sys.exit(0)
```

<div class="line-notes">

- `event = json.load(sys.stdin)` Claude Code 每次调用都会新起一个进程,把事件 JSON 写进 stdin。拿读 `.env` 的那次测试输入代入:`{"tool_name": "Read", "tool_input": {"file_path": "/x/agent-60-lab/.env"}}`。
- `tool = event.get("tool_name", "")` 代入后是 `"Read"`。用 `.get` 带默认值,事件格式哪天多了少了字段,钩子也不至于直接崩。
- `args = event.get("tool_input", {})` 代入后是 `{"file_path": "/x/agent-60-lab/.env"}`。Bash 工具的参数里是 `command`,文件类工具是 `file_path`。
- `SECRET = re.compile(r"(^|/)\.env($|\.)")` 匹配路径里以 `.env` 结尾或者 `.env.` 开头的部分。`/x/.env` 和 `/x/.env.deepseek` 都能匹配上,`.env.example` 也会匹配上,所以下面还要单独放行它。
- `DANGER = [` 三条危险命令:`rm -rf`(含 `rm -fr`、`rm -Rf` 这类变体,因为中间那段是 `[a-z]*`)、强推、硬重置。
- `def decide(decision: str, reason: str) -> None:` 决定写成 JSON 打印到 stdout。`permissionDecision` 可以是 allow、deny、ask、defer 四种,defer 只在 `-p` 无人值守模式下有用。
- `sys.exit(0)` 注意是 0。打印了 deny 的 JSON 再 exit 0,Claude Code 按 JSON 里的决定办。如果这里 exit 1,文档的规则是「非阻断错误,操作继续」,等于白拦。
- `path = args.get("file_path", "")` 代入后是 `"/x/agent-60-lab/.env"`。
- `if tool in {"Read", "Edit", "Write"} and SECRET.search(path)` 三个条件都满足:是文件工具、路径匹配密钥、不是 example。实测输出是 `{"hookSpecificOutput": {"hookEventName": "PreToolUse", "permissionDecision": "deny", "permissionDecisionReason": "/x/agent-60-lab/.env 里是 API key,不许读也不许改。需要配置项去看 .env.example。"}}`。换成 `.env.example` 再测一次,什么都不打印,exit 0,正常放行。
- `if re.search(r"\.env\b(?!\.example)", cmd):` 模型被拒绝读文件以后,常见的下一步是换成 `cat .env`。测试输入 `cat .env.deepseek` 命中这一条,返回「命令里碰到了 .env」。
- `for pat in DANGER:` 测试输入 `rm -rf w3`,命中第一条,返回「危险命令被钩子拦下:rm -rf w3」。
- `decide("ask", "要推到远程,先让人看一眼。")` 测试输入 `git push origin main`,返回 ask:Claude Code 会弹出确认,而不是直接拒绝。普通的 `uv run pytest -q` 什么都不命中,exit 0。

</div>

第二个钩子在改完文件以后跑检查。PostToolUse 的时候工具已经执行完了,拦不住,能做的是用 `decision: "block"` 把问题作为反馈塞给模型,它看到以后会接着修:

```python
# agent-60-lab/.claude/hooks/after_edit.py
"""PostToolUse 钩子:模型改完一个 .py 文件,马上跑 ruff 和这个目录相关的测试。
不通过就返回 decision=block,把报错塞回给模型,它会接着修;通过就安静退出。
"""

import json
import subprocess
import sys
from pathlib import Path

event = json.load(sys.stdin)
path = Path(event.get("tool_input", {}).get("file_path", ""))
if path.suffix != ".py":
    sys.exit(0)


def run(cmd: list[str]) -> tuple[int, str]:
    p = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
    return p.returncode, (p.stdout + p.stderr)[-1500:]  # 只要最后 1500 字,别把上下文撑爆


problems = []
code, out = run(["uvx", "ruff", "check", str(path)])
if code != 0:
    problems.append(f"ruff 没过:\n{out}")
code, out = run(["uv", "run", "pytest", "-q", "-x", "tests"])
if code not in (0, 5):  # 5 = 一个测试都没收集到,不算失败
    problems.append(f"pytest 没过:\n{out}")

if problems:
    print(json.dumps({"decision": "block", "reason": "\n\n".join(problems)}, ensure_ascii=False))
sys.exit(0)
```

<div class="line-notes">

- `path = Path(event.get("tool_input", {}).get("file_path", ""))` 测试时我故意写了一个语法错误的文件 `tmp_bad.py`,内容是 `def f(:`,输入 `{"tool_name": "Write", "tool_input": {"file_path": "tmp_bad.py"}}`,这里拿到 `Path("tmp_bad.py")`。
- `if path.suffix != ".py":` 改的是 Markdown、JSON 就直接放过,不浪费时间跑测试。
- `timeout=120` 钩子本身也有超时。测试套件很大的项目别在 PostToolUse 里跑全量,只跑和改动相关的那部分,不然每改一个文件都要等。
- `[-1500:]` 只留输出的最后 1500 个字符。pytest 失败时最有用的信息在最后,前面的进度点没用,全塞回去会白白吃掉上下文。
- `code, out = run(["uvx", "ruff", "check", str(path)])` 代入 `tmp_bad.py`,ruff 返回非零,输出两条 `invalid-syntax`,第一条是 `Expected a parameter or the end of the parameter list --> tmp_bad.py:1:7`。
- `if code not in (0, 5):` pytest 的退出码 5 表示没收集到测试。新建的空项目还没有测试,不应该因此报错。这次 lab 里的 15 个测试都通过,code 是 0。
- `print(json.dumps({"decision": "block"` 实测打印的是 `{"decision": "block", "reason": "ruff 没过:\ninvalid-syntax: Expected a parameter ..."}`。模型看到这段 reason 就知道自己刚写的文件第 1 行第 7 列有语法错误。对正常的 `cost.py` 跑一遍,两项检查都过,什么都不打印。

</div>

两个钩子都可以不开 Claude Code 直接测,把 JSON 用管道喂进去就行。这一点很重要:**钩子是普通程序,先单独测通再挂上去**。挂上去以后出了问题很难看清是钩子错了还是模型错了。

```bash
# 在 agent-60-lab 根目录
echo '{"tool_name":"Read","tool_input":{"file_path":"/x/agent-60-lab/.env"}}' | uv run python .claude/hooks/guard.py
echo '{"tool_name":"Bash","tool_input":{"command":"git push origin main"}}' | uv run python .claude/hooks/guard.py
echo '{"tool_name":"Edit","tool_input":{"file_path":"cost.py"}}' | uv run python .claude/hooks/after_edit.py; echo "exit $?"
```

最后提醒一个我查资料时看到的情况:2026 年上半年 Claude Code 的 issue 区有好几个报告说,在 `-p` 无人值守模式下 PreToolUse 钩子没有触发,或者触发了但没拦住,这些 issue 后来都标了已解决,但我没查到具体是哪个版本修的。结论很简单:**在你自己装的版本上,用无人值守模式实际测一次钩子能不能拦住**,别默认它一定生效。安全边界最好还是叠一层不依赖 Agent 的东西,比如 CI 里跑的密钥扫描、只给 CI 一个权限很小的 token。

## 子 Agent:让另一个上下文来审

Day 26 讲过多 Agent 的上下文隔离。在 Coding Agent 里最常用的就是这一招:写代码的会话已经被自己的思路塞满了,让它自己审自己刚写的东西,效果很差。开一个**子 Agent**,给它干净的上下文和只读的工具,专门审。

Claude Code 的子 Agent 是一个带 frontmatter 的 Markdown 文件,放在 `.claude/agents/`(项目,进 git)或者 `~/.claude/agents/`(个人)。正文就是它的 system prompt:

```markdown
<!-- agent-60-lab/.claude/agents/reviewer.md -->
---
name: reviewer
description: 审查刚改过的代码。主会话改完一组文件、准备说「完成了」之前调用它。
tools: Read, Grep, Glob, Bash(git diff *), Bash(uv run pytest *)
model: sonnet
---

你是这个仓库的代码审查人,只读不写。先跑 `git diff` 看改了什么,再按顺序检查:

1. tests/ 里有没有删断言、改期望值、加 skip。有就列出来,这是最严重的问题。
2. 有没有用 try/except 吞掉异常、用 mock 绕过真实逻辑、把类型标注放宽成 Any 来消红线。
3. 新代码有没有违反 AGENTS.md 里的约定。
4. 跑一次 `uv run pytest -q`,报告结果。

每个问题写:文件:行号、问题、为什么是问题。没有问题就说没有问题,不要为了显得认真而凑。
```

<div class="line-notes">

- `name: reviewer` 和 `description` 是仅有的两个必填字段。主会话靠 description 决定什么时候把任务交给它,所以这一句要写清「什么时候用」。
- `tools: Read, Grep, Glob, Bash(git diff *), Bash(uv run pytest *)` 不写 tools 就继承主会话的全部工具,包括改文件。审查的人不应该能改代码,这里只给读文件和两条具体的命令。`Bash(git diff *)` 是权限规则语法,星号前面的空格不能省,省了会把 `git diff-index` 也匹配进来。
- `model: sonnet` 审查不需要最贵的模型。可选值还有 opus、haiku、inherit 或完整的模型 id。字段名写错时 Claude Code 不报错、直接忽略,写完去 `/agents` 里看一眼是否生效。
- `1. tests/ 里有没有删断言` 把最常见、最危险的偷懒方式放在第一条。审查清单要具体到「去看什么」,不要写「检查代码质量」。
- `没有问题就说没有问题,不要为了显得认真而凑` 不加这句,模型审查时很喜欢挑一些无关痛痒的风格问题凑数。

</div>

子 Agent 还能配 `permissionMode`、`maxTurns`、`isolation: worktree`(在临时的 git worktree 里跑,不碰你的工作区)等字段,用到再查文档。它和 Skill 的区别是:Skill 是往当前上下文里按需加载一份说明,子 Agent 是另开一个上下文去干活,干完只把结论带回来。

## 无人值守:headless 模式和 CI

前面都是你坐在终端前面盯着。很多活其实不需要人盯:每天早上把依赖升级一下跑测试、PR 一开就先过一遍审查、构建失败了先让它看看日志。Claude Code 的 `-p`(`--print`)就是干这个的,不进交互界面,跑完把结果打到 stdout,退出码 0 表示成功。

2026 年 10 月的官方文档里有几个参数是写脚本必用的,我按重要性排:

- `--bare`:不自动加载本机的 hooks、skills、插件、MCP server、自动记忆和 CLAUDE.md。CI 里一定要加,不然同一个命令在你机器上和同事机器上行为不一样。文档说以后 `-p` 会默认开启它。bare 模式不读 OAuth 登录,要设 `ANTHROPIC_API_KEY`。
- `--allowedTools`:预先放行哪些工具,语法和权限规则一样,比如 `"Read,Edit,Bash(uv run pytest *)"`。
- `--permission-mode dontAsk`:凡是需要弹窗确认的一律拒绝,适合锁死的 CI。
- `--output-format json`:结果是 JSON,里面有 `result`(文本结果)、`session_id`、`total_cost_usd`(客户端估算的花费)。配合 `--json-schema` 还能拿到符合 schema 的 `structured_output` 字段,这就是 Day 6 的结构化输出,只是换成了 Agent。
- `--max-budget-usd`:花费上限,到了就停。

下面这个脚本让它修失败的测试,每一步都可以审计:

```bash
#!/usr/bin/env bash
# agent-60-lab/scripts/ai_fix_tests.sh
# 用法:ANTHROPIC_API_KEY=... bash scripts/ai_fix_tests.sh
set -euo pipefail

if uv run pytest -q -x tests > /tmp/pytest.log 2>&1; then
  echo "测试本来就是绿的,不用修"; exit 0
fi

claude --bare -p "tests 有失败,日志在 /tmp/pytest.log。只改 w*/ 和 common/ 下的源码让测试通过,不许改 tests/。改完再跑一次 uv run pytest -q。" \
  --append-system-prompt-file AGENTS.md \
  --allowedTools "Read,Edit,Bash(uv run pytest *)" \
  --permission-mode dontAsk \
  --max-budget-usd 0.50 \
  --output-format json > /tmp/ai_fix.json

jq -r '.result' /tmp/ai_fix.json
echo "花费约 \$$(jq -r '.total_cost_usd' /tmp/ai_fix.json)"
git diff --stat -- tests/ | grep . && { echo "它改了 tests/,作废"; git checkout -- tests/; exit 1; }
uv run pytest -q
```

<div class="line-notes">

- `set -euo pipefail` 任何一步失败就停。无人值守的脚本最怕前面失败了后面还在继续,最后给你一个看起来成功的结果。
- `if uv run pytest -q -x tests > /tmp/pytest.log 2>&1; then` 先确认确实有东西要修。不加这一步,每次跑都会花钱,模型还会在没问题的代码上「找点事做」。
- `claude --bare -p` 提示词里写清三件事:日志在哪、能改哪里、不能改哪里、完成的标准是什么。无人值守时它没法问你,模糊的地方它会自己猜。
- `--append-system-prompt-file AGENTS.md` bare 模式不自动读 AGENTS.md 和 CLAUDE.md,要显式传进去。用 append 而不是 `--system-prompt`,后者会替换掉 Claude Code 默认的系统提示词。
- `--allowedTools "Read,Edit,Bash(uv run pytest *)"` 只放行读、改和跑测试。它想跑别的命令(比如 `pip install`)会被拒绝。
- `--permission-mode dontAsk` 没放行又需要确认的操作一律拒绝,不会卡在那里等一个永远不会来的确认。
- `--max-budget-usd 0.50` 我给这种小修复的上限是 5 毛美元,够它读十几个文件、改几次、跑几次测试。超了就停,说明这个问题不适合无人值守。
- `jq -r '.total_cost_usd'` 文档说明这是客户端估算值,和账单可能有出入,用来设预算和画趋势够了。
- `git diff --stat -- tests/ | grep . && {` 不信任提示词里的「不许改 tests/」,用 git 检查一遍。`grep .` 在有输出时返回 0,也就是 tests/ 有改动时进入花括号,回滚并以失败退出。
- `uv run pytest -q` 最后自己再跑一次,以这个结果为准,不以模型说的「已经修好了」为准。

</div>

跑完 `/tmp/ai_fix.json` 大致长这样(示例:这三个字段名来自官方文档,实际还有更多字段,数值是我编的):

```json
{"result": "w2/robust_agent.py 第 56 行把 `client | OpenAI` 改成了 ...,15 个测试全部通过。", "session_id": "2f1c…", "total_cost_usd": 0.083}
```

放进 CI 是同一个思路。Anthropic 官方的 GitHub Action 是 `anthropics/claude-code-action@v1`,它的文档里给了一个 PR 一打开就自动审查的例子,核心部分是这样(按官方 solutions 文档精简):

```yaml
# .github/workflows/claude-review.yml
name: Claude Auto Review
on:
  pull_request:
    types: [opened, synchronize]

jobs:
  review:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      pull-requests: write
      id-token: write
    steps:
      - uses: actions/checkout@v6
        with:
          fetch-depth: 1
      - uses: anthropics/claude-code-action@v1
        with:
          anthropic_api_key: ${{ secrets.ANTHROPIC_API_KEY }}
          prompt: |
            REPO: ${{ github.repository }}
            PR NUMBER: ${{ github.event.pull_request.number }}
            审查这个 PR:正确性、测试有没有被削弱、是否违反 AGENTS.md。
            顶层意见用 gh pr comment,具体代码问题用行内评论。
          claude_args: |
            --allowedTools "mcp__github_inline_comment__create_inline_comment,Bash(gh pr comment:*),Bash(gh pr diff:*),Bash(gh pr view:*)"
```

<div class="line-notes">

- `types: [opened, synchronize]` PR 新建和有新提交时都触发。每次 push 都审一次会花不少钱,提交频繁的仓库可以改成只在 PR 标了某个 label 时才跑。
- `permissions:` 这一段是整个文件里最该仔细看的。`contents: read` 只读代码,`pull-requests: write` 能发评论。不要为了省事给 `contents: write`,那样它就能直接往分支推代码了。
- `fetch-depth: 1` 只拉最新一个提交,快。
- `anthropic_api_key: ${{ secrets.ANTHROPIC_API_KEY }}` key 放在仓库的 Secrets 里。注意:GitHub 默认不会把 secrets 交给 fork 仓库发来的 PR 的工作流,这是对的,别为了让外部 PR 也能审就去改这个设置。
- `--allowedTools "mcp__github_inline_comment__create_inline_comment` 只能读 PR、发评论,别的都做不了。官方例子用的是 `:*` 前缀写法,和前面 `Bash(git diff *)` 的空格星号写法是同一个意思的两种写法。

</div>

<figure>
<svg viewBox="0 0 640 210" role="img" aria-label="无人值守流程:触发、跑 Agent、机械检查、人工审查,任何一步不过都回到人">
<rect x="0" y="0" width="640" height="210" fill="var(--paper-raised)"/>
<g font-family="var(--font-mono)" font-size="12">
<rect x="16" y="30" width="110" height="56" rx="6" fill="none" stroke="var(--ink-soft)"/>
<text x="30" y="54" fill="var(--ink)">触发</text>
<text x="30" y="74" fill="var(--ink-faint)" font-size="11">PR / 定时 / 构建失败</text>
<rect x="150" y="30" width="140" height="56" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="164" y="54" fill="var(--mem)">claude -p --bare</text>
<text x="164" y="74" fill="var(--ink-faint)" font-size="11">白名单工具 + 预算上限</text>
<rect x="314" y="30" width="140" height="56" rx="6" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="328" y="54" fill="var(--compute)">机械检查</text>
<text x="328" y="74" fill="var(--ink-faint)" font-size="11">测试 / tests 没被改 / 类型</text>
<rect x="478" y="30" width="146" height="56" rx="6" fill="none" stroke="var(--ink-soft)"/>
<text x="492" y="54" fill="var(--ink)">人看 diff</text>
<text x="492" y="74" fill="var(--ink-faint)" font-size="11">合并的决定在人手里</text>
<line x1="126" y1="58" x2="148" y2="58" stroke="var(--rule)"/>
<line x1="290" y1="58" x2="312" y2="58" stroke="var(--rule)"/>
<line x1="454" y1="58" x2="476" y2="58" stroke="var(--rule)"/>
<path d="M 384 86 L 384 150 L 70 150 L 70 88" fill="none" stroke="var(--compute)" stroke-dasharray="4 3"/>
<text x="150" y="170" fill="var(--compute)" font-size="11">不过:回滚它的改动,发通知,交给人</text>
</g>
</svg>
<figcaption>Agent 只负责中间那一格。前后两格都不依赖它说的话,这样它犯错的代价是一次失败的运行,而不是一次坏掉的发布。</figcaption>
</figure>

还有一个安全细节,来自 2026 年 10 月的 headless 文档:**不加 `--bare` 时,`-p` 会运行项目 `.claude/settings.json` 里的 hooks、连接 `.mcp.json` 里的 MCP server,而且不会弹出「是否信任这个文件夹」的对话框。** 换句话说,如果你在 CI 里对一个外部贡献者提交的分支跑不带 `--bare` 的 `claude -p`,他在 PR 里加一个 hook 就能在你的 CI 机器上执行任意命令。这正是 Day 39 讲的「不可信内容 + 执行能力」,只是这次不可信内容是一个配置文件。

## 规格驱动开发:先写清楚再让它写

用 Coding Agent 写一个两百行的函数,一句话描述就够了。写一个要改十几个文件、半天才做完的功能,一句话描述的结果通常是:它很快写出一大堆代码,方向偏了一点,你花在纠偏上的时间比自己写还多。

规格驱动开发(Spec-Driven Development,SDD)的思路是把一次性的「描述 → 代码」拆成几步,每一步都留下一份能审查的文档:**需求规格 → 技术方案 → 任务清单 → 实现**。人审文档比审代码快得多,方向错了在文档阶段就能发现。

### GitHub Spec Kit

GitHub 的 Spec Kit 是这套思路最流行的实现。2026 年 10 月查到:1.0.0 在 2026-08-21 发布(正好是项目第一次提交后一年),我写这篇时最新是 2026-10-19 的 v1.2.2。安装用 uv:

```bash
uv tool install specify-cli
cd ~/Documents/cli-agent          # 用 Day 14 推到 GitHub 的那个项目练
specify init . --integration claude
```

我在临时目录里实际跑了一遍 `specify init demo --integration claude --script sh`(v1.2.2),它生成的东西有两部分。一部分在 `.claude/skills/` 下面,是十个 skill:`speckit-constitution`、`speckit-specify`、`speckit-clarify`、`speckit-plan`、`speckit-tasks`、`speckit-analyze`、`speckit-checklist`、`speckit-implement`、`speckit-converge`、`speckit-taskstoissues`;另一部分在 `.specify/` 下面,是项目宪章 `memory/constitution.md`、几份模板(spec、plan、tasks、checklist)和一组 bash 脚本。所以它本身没有什么魔法:就是一组写得很细的 Skill,加上让模型照着填的模板。

在 Claude Code 里按顺序用这几个命令(注意 1.x 版本是连字符 `/speckit-specify`,网上很多 2025 年的教程写的是点号 `/speckit.specify`,那是老版本):

1. `/speckit-constitution`:写项目的「宪法」,比如「所有新功能必须先有测试」「不引入新依赖要说明理由」。一个项目写一次。
2. `/speckit-specify 给 cli-agent 加一个 --budget 参数,单次运行花费超过这个数就停下并提示`:生成需求规格。看它的模板就知道它在要什么:用户故事按优先级 P1/P2/P3 排,每个故事要能独立测试;边界情况;功能需求;成功标准(要能量化)。拿不准的地方它会标 `[NEEDS CLARIFICATION]`。
3. `/speckit-clarify`(可选):针对含糊的地方逐条问你。我建议别跳过,这一步最省返工。
4. `/speckit-plan`:技术方案,用什么库、改哪些模块、数据怎么流。
5. `/speckit-tasks`:把方案拆成编号任务,标出哪些可以并行(`[P]`)、属于哪个用户故事。
6. `/speckit-implement`:按任务清单实现。

每一步生成的文件都在 `specs/<编号-功能名>/` 下面,和代码一起进 git。三个月以后有人问「这个参数为什么是这么设计的」,答案在 spec 里。

### 别的工具和什么时候值得用

AWS 的 Kiro 是另一个思路相近的 IDE,它的 spec 也是三份文件:`requirements.md`(用户故事和验收标准)、`design.md`(架构和时序图)、`tasks.md`(任务清单)。Kiro 早期的需求格式用的是 EARS 句式,类似「WHEN 用户提交空表单 THE SYSTEM SHALL 提示必填项」;我在 2026 年 10 月的 Kiro 文档页上只看到「structured notation」的说法,没看到 EARS 这个词,写法可能变了,用的时候以它的文档为准。Martin Fowler 网站上有一篇把 Kiro、Spec Kit、Tessl 放在一起比较的文章,列在学习资料里。

不是什么需求都值得走这一套。我的判断标准是**自己写要超过半天**、或者**需求本身还不清楚**的时候用;修一个 bug、加一个小参数,走完六步花的时间比写代码还长,而且生成的 spec 也没人会再看。还有一个常见的反模式:spec 写了几千字,但成功标准是「功能正常工作」。规格的价值全在能被验证的那几条上。

## 验收 Agent 写的代码

这一节是面试最会追问的。Agent 写代码的速度远超你读代码的速度,你不可能逐行读完它写的每一行,所以要知道**看哪里**。

我自己的审查顺序是这样的:

1. **先看测试改了什么。** `git diff --stat -- tests/`。测试文件有改动,先看是新增了用例还是改了旧的期望值。改期望值、删断言、加 `@pytest.mark.skip`,这三种一出现,整个改动先打回去。
2. **再看改了多少。** 一个「修一个 bug」的任务改了二十个文件,大概率它顺手重构了一堆东西。要求它只改和任务相关的部分,其他的另开 PR。
3. **找「消音」的写法。** 宽泛的 `except Exception: pass`、把类型标注改成 `Any` 来消除红线、用 mock 把真实逻辑整个替换掉、加了个 `if test_mode:` 分支。这些都能让检查变绿,但问题还在。
4. **跑一个它没见过的场景。** 测试是它看着写的,最好的验证是你自己手动跑一个测试里没有的输入。

OpenAI 那篇 harness engineering 文章里还有一条思路值得学:**把审查意见变成机械检查**。同一类问题你在审查里指出过两次,就写一条 lint 规则或者结构测试,让它以后在 PostToolUse 钩子里自动被抓住,报错信息直接写成「应该怎么改」,这样 Agent 看到报错就能自己修。前面的 `after_edit.py` 就是这个机制的最小版本。

最后是各家工具的对照。概念都一样,名字不同:

| 能力 | Claude Code | Codex CLI | Cursor |
| --- | --- | --- | --- |
| 仓库指令文件 | CLAUDE.md,也读 AGENTS.md | AGENTS.md | `.cursor/rules/` 规则文件,也认 AGENTS.md |
| 工具调用前后的钩子 | hooks(三十多个事件) | 查当前文档 | 查当前文档 |
| 无人值守 | `claude -p`,Agent SDK | `codex exec` | 后台 Agent / Cloud Agents |
| 子 Agent | `.claude/agents/` | 查当前文档 | 查当前文档 |

表里 Codex 和 Cursor 两列,指令文件那一行我核对过(agents.md 官网把 Codex、Cursor 都列为支持者,两家的文档页在学习资料里);钩子和子 Agent 两家都在快速迭代,我没有逐个核实,所以写的是「查当前文档」。

## 面试时怎么讲

「你平时怎么用 AI 写代码」现在几乎是 Agent 岗的必问题。不要回答「我用 Cursor,效率提高了三倍」,这句话谁都能说,也没法验证。按今天的四层来讲:我在仓库里放了一份多短的指令文件、里面写了哪些踩过的坑;我用哪些钩子拦住了什么;我让它无人值守地做哪类事、怎么设预算、怎么验收;哪类任务我不交给它。能举出一个它犯错、被你的某一层拦住的具体例子,比说十句效率提升都有用。

## 动手练习

1. **写指令文件。** 在 `agent-60-lab` 根目录建 `AGENTS.md` 和 `CLAUDE.md`(内容参照上文,把你自己踩过的坑换进去)。开一个新的 Claude Code 会话,问它「怎么跑 Day 9 的 agent_loop?」,它给的命令应该是在根目录 `uv run python -m w2.agent_loop`。
2. **装钩子并单独测。** 建 `.claude/hooks/guard.py`、`after_edit.py` 和 `.claude/settings.json`。先用上文的三条 `echo ... |` 命令测一遍,输出和文中一致再进 Claude Code。然后让它「看一下 .env 里配的是哪个模型」,应该被拒绝,并且它会转去读 `.env.example`。
3. **让钩子把问题塞回去。** 让 Claude Code 在 `w1/` 下新建一个故意写错的文件(比如让它「写一个函数,参数列表先空着,我待会补」)。观察 PostToolUse 返回 block 以后,它是不是马上去修。
4. **建审查子 Agent。** 建 `.claude/agents/reviewer.md`。让主会话改一个小功能,然后说「用 reviewer 审一下」。在 `/agents` 里确认它的工具列表只有只读的那几个。
5. **无人值守跑一次。** 在 `agent-60-lab` 里故意改坏一个函数让某个测试失败,跑 `scripts/ai_fix_tests.sh`。记下它花了多少钱、改了哪些文件、tests/ 有没有被动。
6. **走一遍 Spec Kit。** 在 `cli-agent` 仓库里 `specify init . --integration claude`,用 `/speckit-specify` 到 `/speckit-implement` 给它加 `--budget` 参数。把 `specs/` 下的文件和代码一起提交。

**验收标准**:

- 第 2 步:三条测试命令的输出和文中一致;在会话里读 `.env` 被拒绝,理由是钩子写的那句话。
- 第 5 步:脚本最后的 `uv run pytest -q` 全绿,`git diff --stat -- tests/` 为空,记下 `total_cost_usd`。
- 第 6 步:`specs/` 里有 spec、plan、tasks 三份文件,spec 的成功标准至少有一条是可以量化的(比如「花费超过上限后 1 次调用内停止」)。
- 能用两分钟讲清「你怎么用 Coding Agent,怎么保证它写的代码质量」,并举出今天练习里一个被拦住的例子。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| AGENTS.md | 放在仓库里给 Coding Agent 看的 Markdown 指令文件,2025-12 起由 Linux 基金会下的 AAIF 管理,多家工具通用 |
| CLAUDE.md | Claude Code 自己的指令文件,分用户级、项目级、本地级,可以用 `@路径` 导入其他文件 |
| hook(钩子) | Coding Agent 在固定时刻(工具调用前后、会话开始、准备结束等)调用的你自己的程序,能拦截、能反馈 |
| PreToolUse / PostToolUse | 工具执行前 / 执行后触发的两个最常用的钩子事件 |
| permissionDecision | PreToolUse 钩子返回的决定:allow、deny、ask、defer |
| 子 Agent(subagent) | 主会话把任务交出去、在独立上下文里执行的 Agent,有自己的工具白名单和 system prompt |
| headless / `-p` 模式 | 不进交互界面、跑完就退出的运行方式,用于脚本和 CI |
| `--bare` | headless 模式下不加载本机 hooks、插件、MCP、CLAUDE.md 等任何自动发现的配置,保证每台机器结果一致 |
| 规格驱动开发(SDD) | 先写需求规格、方案、任务清单,人审过文档再让 Agent 实现 |
| Spec Kit | GitHub 的开源 SDD 工具,1.x 版本以一组 Skill 和模板的形式装进 Coding Agent |
| harness engineering | 2026 年流行起来的说法:工程师的主要工作变成搭建让 Agent 可靠干活的环境(文档、检查、反馈回路) |

## 常见误区

**把强制规则写进 CLAUDE.md 就以为生效了。** 指令文件是上下文,是建议。必须遵守的规则(不读密钥、不跑危险命令)放进钩子或权限规则,指令文件里写一句只是让它少去试。

**钩子出错时 exit 1。** exit 1 是「非阻断错误」,操作照常执行。要拦住就 exit 2,或者 exit 0 并打印 deny 的 JSON。

**指令文件越写越长。** 每次被坑都往里加一条,半年后变成 600 行,模型反而什么都抓不住。超过 100 行就该拆:只和某个目录有关的放进路径规则,长流程放进 Skill,剩下的给一个文档入口。

**CI 里跑 `claude -p` 不加 `--bare`。** 不加时它会加载仓库里的 hooks 和 MCP 配置,而且不问是否信任。对外部提交的分支这么跑,等于让对方在你的 CI 机器上执行代码。

**相信「已经修好了」。** 模型的总结是它的说法,不是事实。以你自己跑的测试结果和 `git diff` 为准。

**所有需求都走 Spec Kit。** 小改动走完六步得不偿失。它适合大需求和需求本身模糊的情况,值不值得看的是 spec 里有没有能验证的成功标准。

## 学习资料

### 文档与文章

- [Claude Code · Hooks 参考](https://code.claude.com/docs/en/hooks):事件列表、输入输出格式、退出码规则。页面很长,先看 PreToolUse 和 PostToolUse 两节,半小时。
- [Claude Code · How Claude remembers your project](https://code.claude.com/docs/en/memory):CLAUDE.md 的层级、导入、`.claude/rules/`、和 AGENTS.md 的关系。20 分钟。
- [Claude Code · Run Claude Code programmatically](https://code.claude.com/docs/en/headless):`-p`、`--bare`、`--allowedTools`、JSON 输出,以及不加 bare 时会自动运行哪些仓库内容。写 CI 之前必读。
- [Claude Code · Subagents](https://code.claude.com/docs/en/sub-agents):子 Agent 的全部 frontmatter 字段和存放位置。
- [Best practices for Claude Code](https://code.claude.com/docs/en/best-practices):官方的使用建议,和今天的内容互相印证,40 分钟。
- [agents.md](https://agents.md):AGENTS.md 的官方站,看一眼示例和支持它的工具列表。
- [Codex · AGENTS.md 指南](https://developers.openai.com/codex/guides/agents-md):Codex 怎么查找和合并多层 AGENTS.md,和 Claude Code 的规则对比着看。
- [Cursor · Rules](https://cursor.com/docs/context/rules):Cursor 的规则文件写法。
- [OpenAI · Harness engineering: leveraging Codex in an agent-first world](https://openai.com/index/harness-engineering/)(2026-02-11,对脚本返回 403,需浏览器打开):今天「给地图不给手册」「把审查变成机械检查」两个观点的出处,一小时。
- [OpenAI · Agentic AI Foundation](https://openai.com/index/agentic-ai-foundation/)(需浏览器打开):AGENTS.md 捐给 Linux 基金会的公告。
- [GitHub Blog · Spec-driven development with AI](https://github.blog/ai-and-ml/generative-ai/spec-driven-development-with-ai-get-started-with-a-new-open-source-toolkit/):Spec Kit 作者讲为什么做这个,20 分钟。
- [Martin Fowler 网站 · Understanding Spec-Driven-Development: Kiro, spec-kit, and Tessl](https://martinfowler.com/articles/exploring-gen-ai/sdd-3-tools.html):三个 SDD 工具的冷静对比,有批评也有肯定,30 分钟。
- [Kiro · Specs](https://kiro.dev/docs/specs/):Kiro 的三份 spec 文件。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1yDLG6DE39&autoplay=0&high_quality=1" title="Hooks入门只需5分钟" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>Yin_Code · Hooks入门只需5分钟 · 2026 年 5 月,4 分半。先看这个建立直觉,再回来读上面两个钩子的代码。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1aKxEzHEy9&autoplay=0&high_quality=1" title="这才是AI编程的正确姿势：Spec Kit 实战开发演示！7条命令跑通规格驱动开发+强制TDD，从需求到代码全自动！支持 Claude Code、Cursor" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>AI超元域 · Spec Kit 实战开发演示 · 12 分钟,完整走一遍流程。视频是 2025 年 10 月的老版本,命令是点号写法 `/speckit.specify`,1.x 版本改成了连字符,其他步骤一样。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1mRn66JERc&autoplay=0&high_quality=1" title="AI 写得比你读得快，code review 要怎么做？" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>grapeot · AI 写得比你读得快,code review 要怎么做? · 2026 年 10 月,18 分钟。对应上面「验收 Agent 写的代码」那一节,讲审查重点怎么变。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/julbw1JuAz0" title="Building Claude Code with Boris Cherny" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>The Pragmatic Engineer · Building Claude Code with Boris Cherny · Claude Code 负责人讲他们团队自己怎么用 Claude Code、为什么做成现在这个样子。挑讲 CLAUDE.md 和团队工作流的部分看。</figcaption>
</figure>

### 书籍

- Addy Osmani《Beyond Vibe Coding: From Coder to AI-Era Developer》(O'Reilly,2025):讲怎么给 AI 写清楚目标和约束、怎么审查它生成的代码,还有多 Agent 编码工作流。今天的内容对应讲 AI 辅助工作流和代码审查的那几章,两三个小时。我没有查到中译本。
- Chip Huyen《AI Engineering》(O'Reilly,2025)第 6 章「RAG and Agents」的 Agent 部分:讲 Agent 的失败模式和评估,读完再看「验收 Agent 写的代码」那一节会更有体会。

### 开源项目与代码

- [github/spec-kit](https://github.com/github/spec-kit):看 `templates/` 下的 spec 和 tasks 模板,学它怎么逼模型写出可验证的需求;[releases](https://github.com/github/spec-kit/releases) 看版本变化。
- [anthropics/claude-code-action](https://github.com/anthropics/claude-code-action):官方 GitHub Action,`docs/solutions.md` 里有十来个可以直接抄的工作流。
- [openai/codex](https://github.com/openai/codex):Codex CLI 的源码和文档,想对比两家的 AGENTS.md 处理逻辑可以看。

## 自测

**1. 你在 CLAUDE.md 里写了「不要读 .env」,Claude Code 还是读了。为什么?怎么改?**

<details><summary>答案</summary>

CLAUDE.md 是进上下文的指令,模型会参考,但不是强制约束;它在解决问题时判断需要看连接串,就去读了。要强制,就写一个 PreToolUse 钩子,对 Read/Edit/Write 检查 `file_path`、对 Bash 检查命令里有没有 `.env`,返回 `permissionDecision: "deny"`;或者在权限规则里加 deny。CLAUDE.md 里那句可以留着,作用是让它一开始就不去试。

</details>

**2. 一个 PreToolUse 钩子检查到危险命令后 `sys.exit(1)`,会发生什么?**

<details><summary>答案</summary>

什么也拦不住。按 Claude Code 的规则,exit 1(以及除 0、2 以外的非零退出码)且没有有效 JSON 输出时算「非阻断错误」,操作照常执行。要拦截应该 exit 2(stderr 会反馈给模型),或者 exit 0 并在 stdout 打印带 `permissionDecision: "deny"` 的 JSON。

</details>

**3. 为什么 CI 里跑 `claude -p` 建议加 `--bare`?不加有什么风险?**

<details><summary>答案</summary>

两个原因。一是可重复:不加时会自动加载本机和仓库里的 hooks、skills、插件、MCP server、CLAUDE.md,不同机器结果不同。二是安全:不加时 `-p` 会运行项目 `.claude/settings.json` 里的 hooks、连接 `.mcp.json` 里的 server,而且没有信任确认。对外部贡献者的分支这么跑,对方在 PR 里加一个 hook 就能在 CI 机器上执行命令。

</details>

**4. 审查子 Agent 为什么要限制成只读工具?它和让主会话「再检查一遍」有什么区别?**

<details><summary>答案</summary>

审查者能改代码,就会顺手「修」问题,结果是审查和修改混在一起,你分不清哪些是它发现的问题、哪些是它改的东西,也失去了独立检查的意义。和主会话自查相比,子 Agent 有干净的上下文,没有被主会话的实现思路带偏,更容易看出「这个测试其实被改弱了」这类问题。

</details>

**5. 什么样的需求值得走 Spec Kit 的完整流程?什么样的不值得?**

<details><summary>答案</summary>

自己写要超过半天、涉及多个模块、或者需求本身还没想清楚的值得:文档阶段发现方向错误比代码阶段便宜得多,spec 也能留作以后的设计记录。修 bug、加一个小参数这类改动不值得,六步流程的时间比写代码还长。判断一份 spec 有没有用,看它的成功标准能不能被验证。

</details>

**6.(面试题)「你怎么用 AI 写代码?怎么保证它写的代码质量?」请用两分钟回答。**

<details><summary>答案</summary>

参考结构:先讲分层。仓库里有一份几十行的 AGENTS.md,写的是运行和测试命令、几条踩过的坑,详细内容只给文档入口;必须遵守的规则不靠指令文件,用 PreToolUse 钩子拦截读密钥和危险命令,用 PostToolUse 钩子在改完文件后自动跑 lint 和测试,不过就把报错反馈给它。审查用一个只读的子 Agent,重点看测试有没有被削弱。重复性工作(修失败的测试、依赖升级)用 headless 模式在脚本里跑,有工具白名单和预算上限,最后以我自己跑的测试和 git diff 为准。大需求先用 Spec Kit 写规格再实现。然后举一个具体例子:比如它为了让测试通过去改断言,被 `git diff -- tests/` 那一步抓到并回滚。最后说哪些事不交给它(比如涉及生产数据的操作)。

</details>

## 明天预告

专题篇可以跳着读。按编号,下一篇是 **Day 136 · 多模态与文档解析:看图、OCR、版面分析、多模态 RAG**:让模型读客户发来的截图和扫描账单,三条路解析 PDF,把抽出来的金额和业务库对账,再讲图片怎么进 RAG。
