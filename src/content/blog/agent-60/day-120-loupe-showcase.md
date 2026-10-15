---
title: 'Day 120 · Agent Loupe(九):开源发布与作品包装'
description: '作品一收尾:写一份三十秒能看懂的 README,用三篇 ADR 记下这几天最重要的取舍,配上一键启动脚本、CI 和发布前自查脚本,选 License、打第一个版本;再准备两分钟演示视频的分镜、个人网站上的案例页、简历描述,以及面试时三种长度的讲法和最可能被深挖的问题。'
pubDate: 2026-10-15
regime: none
tags: ['agent-loupe', 'open-source', 'readme', 'adr', 'portfolio', 'career', 'agent-60']
series: 'agent-60'
day: 120
lang: 'zh'
---

## 今天要解决的问题

Agent Loupe 的功能做完了,演示站也上线了。但到目前为止,知道它的只有你自己。今天要做的,是让一个陌生人(招聘方、面试官、可能用它的工程师)在很短的时间里明白三件事:它是什么,它做得有多好,做它的人是怎么思考的。

Day 105 包装 AgentOps 时讲过一个观察:评审给你的时间可能只有五分钟,而且越往深处看的人越少。README 第一屏决定了有没有人点演示链接,演示链接决定了有没有人去看 ADR,ADR 决定了面试时聊什么。今天按这个漏斗从上往下做。

学完你应该有:

1. 一份 README:第一屏说清楚是什么、有什么不一样、去哪试;往下是五分钟跑起来、架构、关键设计、性能、已知局限。
2. 三篇 ADR,记录这几天最重要的三个取舍,每篇都有被放弃的方案和代价。
3. 一个一键启动脚本、一个 CI 配置、一个发布前自查脚本,以及 License、CHANGELOG 和第一个版本号。
4. 一个两分钟演示视频的分镜、个人网站上的案例页,以及两三条简历描述。
5. 三种长度的项目讲法,和面试官最可能深挖的问题清单。

预计用时 6 小时,大部分是写作。前置:Day 111–119 的全部产出;Day 105(AgentOps 的包装)和 Day 106(设计文档和 ADR)可以对照着看。

## 一个陌生人会怎么看你的仓库

先换位想一下。一个面试官打开你的 GitHub 链接,他通常会:

- **看 README 第一屏(10 秒)。** 标题、一句话介绍、一张动图。他在判断「这是不是一个认真做的东西」。如果第一屏是 `npm install` 的说明或者一大段背景介绍,他多半就关掉了。
- **点演示链接(30 秒到 2 分钟)。** 如果有的话。随便点点,看能不能用、快不快、有没有报错。
- **翻一下代码结构和测试(1 分钟)。** 目录是否清楚,有没有测试,CI 是不是绿的。
- **如果约了面试,再回来看设计文档和 ADR。** 准备问题。

<figure>
<svg viewBox="0 0 640 240" role="img" aria-label="陌生人看仓库的四个阶段:README 第一屏 10 秒、演示站 30 秒到 2 分钟、代码和测试 1 分钟、面试前看 ADR;越往后看的人越少,每一层对应一个要准备的产出">
  <rect x="0" y="0" width="640" height="240" fill="var(--paper-raised)" rx="6"/>
  <g font-family="var(--font-mono)" font-size="11">
    <rect x="20" y="30" width="600" height="34" fill="var(--mem-wash)" stroke="var(--mem)"/>
    <text x="32" y="51" fill="var(--mem)">README 第一屏 · 10 秒</text>
    <text x="608" y="51" text-anchor="end" fill="var(--ink-soft)">一句话 + 动图 + 演示链接</text>
    <rect x="20" y="74" width="460" height="34" fill="var(--mem-wash)" stroke="var(--mem)"/>
    <text x="32" y="95" fill="var(--mem)">演示站 · 30 秒到 2 分钟</text>
    <text x="468" y="95" text-anchor="end" fill="var(--ink-soft)">样例、重跑、对比</text>
    <rect x="20" y="118" width="320" height="34" fill="var(--compute-wash)" stroke="var(--compute)"/>
    <text x="32" y="139" fill="var(--compute)">代码与测试 · 1 分钟</text>
    <text x="328" y="139" text-anchor="end" fill="var(--ink-soft)">CI 徽章、目录</text>
    <rect x="20" y="162" width="200" height="34" fill="var(--compute-wash)" stroke="var(--compute)"/>
    <text x="32" y="183" fill="var(--compute)">ADR · 面试前</text>
    <text x="208" y="183" text-anchor="end" fill="var(--ink-soft)">取舍、代价</text>
  </g>
  <text x="20" y="224" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">条越短,看到这一层的人越少;但每往下一层,看的人就越认真在考虑你</text>
</svg>
<figcaption>一个陌生人打开你的仓库以后的注意力漏斗。今天的产出按这四层准备,最上面一层的投入回报最高。</figcaption>
</figure>

所以 README 的结构就按这个顺序排。一句话介绍放最上面,而且这句话里要有「和别人不一样的地方」。「一个 Agent 调试工具」是一句废话,「按时间轴回放每一步,两次运行逐步对比,从任意一步改提示词重跑,把失败步骤一键变成评测用例」才告诉了别人你做了什么。

## README

下面是完整的 README。直接放在仓库根目录,把域名、用户名换成你自己的:

````markdown
# Agent Loupe

**给 AI Agent 用的调试器:按时间轴回放每一步,两次运行逐步对比,从任意一步改提示词重跑,把失败步骤一键变成评测用例。**

![演示:从第 3 步改提示词重跑,自动跳到对比页](docs/demo.gif)

## 在线演示

https://loupe.你的域名 (只读样例,可以从任意一步重跑;每人每小时 5 次,全站每天有花费上限)

## 为什么做这个

调 Agent 最费时间的不是写代码,是搞清楚「第 14 步它为什么那么做」以及「改了提示词以后从哪一步开始不一样」。现有的 trace 平台擅长看单次运行;Loupe 专注三件它们做得不够的事:

- **逐步对比**:用每一步的「决定」做签名,LCS 对齐两次运行,直接滚到第一处分歧。
- **从中间重跑**:第 N 步之前原样保留,工具结果从原运行回放(写操作永远不会真的执行),只重新调用模型。
- **失败变用例**:任意一步存成带快照的评测用例,批量跑 k 次,算 pass^k,前后两批做回归对比。

## 五分钟跑起来

需要 Python 3.12 + [uv](https://docs.astral.sh/uv/)、Node 22 + pnpm,以及一个 OpenAI 兼容的模型 key(重跑和评测才需要)。

```bash
git clone https://github.com/你的用户名/agent-loupe.git && cd agent-loupe
cp server/.env.example server/.env   # 填 LLM_BASE_URL / LLM_API_KEY / LLM_MODEL
./scripts/dev.sh                     # 后端 :8000,前端 :5173,第一次会导入 samples/ 里的样例
```

导入自己的 trace:在首页上传文件,支持 OTLP JSON(OpenTelemetry GenAI 语义约定)、Langfuse 导出,以及自带的轻量 SDK `server/loupe_sdk.py` 写出的 JSONL,见 [docs/import.md](docs/import.md)。模型价格在 `server/prices.json`。

## 架构

```text
web/ (React 18 + TS + Vite + Zustand)  ──HTTP──>  server/ (FastAPI + SQLite)
  运行列表 / 时间轴 / 步骤详情                        导入器 ─> runs + steps
  对比页 / 重跑对话框 / 评测页                        diff(LCS) / replay(cassette) / evalcases
                                                    guard(演示模式:只读、限流、每日花费上限)
```

## 关键设计

| 决定 | 为什么 | ADR |
| --- | --- | --- |
| LLM 步的签名用「这一步请求了哪些工具」,不用输入 | 输入是累积的历史,第一处分歧后全部对不上 | [0001](docs/adr/0001-llm-step-signature.md) |
| 重跑时 cassette miss 把错误返回给模型,并在结果里计数 | 中止太脆,模拟器会编数据;显式暴露最诚实 | [0002](docs/adr/0002-cassette-miss.md) |
| 评测用例存完整快照,不存 trace 引用 | trace 会过期、会被改;用例要自包含、不可变 | [0003](docs/adr/0003-eval-case-snapshot.md) |

## 性能

测量方法见 [docs/perf.md](docs/perf.md)(`samples/synthetic_10k.jsonl`,一万步合成 trace,固定随机种子;Chrome,本机 / CPU 4× 降速)。

| 指标 | 本机 | CPU 4× 降速 |
| --- | --- | --- |
| 首屏时间(中位数) | | |
| 滚动 avgFps | | |
| 滚动 longFrames | | |

## 已知局限

- 对齐用 O(n·m) 的 LCS,两条几千步的运行对比会明显变慢;计划换 Myers 或分段对齐。
- 重跑只回放工具结果,模型调用本身不可复现;一次重跑只能形成假设,验证要用评测。
- 单进程 + SQLite,适合个人和小团队;多实例部署需要把限流状态移到 Redis。
- cassette miss 的来源目前只记在运行的 tags 里,步骤级别还看不到是回放还是真实执行。

## License

MIT
````

几个有意的选择:

**「为什么做这个」只有三条,每条一句话说清楚它解决什么问题。** 不写「随着大模型的发展」这种开头。读者想知道的是你看到了什么痛点、你的东西和现有工具差在哪。这里我点名说了「现有的 trace 平台擅长看单次运行」,这是诚实的定位:Loupe 不是 Langfuse 的替代品,它专注几件它们做得不够的事。面试官看到这种定位会觉得你了解行业,而不是在自说自话。

**「五分钟跑起来」只有三条命令。** 这需要你真的把一键启动脚本写好。下面会给。

**「关键设计」是一张表,每行链接到 ADR。** 招聘方不会去读三篇 ADR,但他会扫一眼这张表,看到「为什么」那一列,就知道你做过取舍、而且想清楚了。

**「性能」那张表在测完之前是空的。** 发布前自查脚本会拦住空表。宁可晚一天发布,也不要编一个数字。表上面一句话写测量方法和环境,链接到详细的 `docs/perf.md`(内容就是 Day 119 性能一节的方法,加上你的测量结果)。

**「已知局限」写四条真实的。** 这是我觉得最能体现水平的一节。每条都是这几天实际遇到、权衡后暂时没做的事,并说明了影响范围。一个列出自己系统会在哪里出问题的人,比一个说「我的系统完美」的人可信得多。

**动图。** 用录屏工具录一段 10 到 15 秒的操作:在运行详情里点第 3 步、点「从这一步重跑」、改一句提示词、提交、自动跳到对比页、滚到第一处分歧、展开逐词 diff。转成 GIF 控制在 2 MB 以内(下面的自查脚本会检查),太大就降帧率、缩尺寸,或者换成 MP4 放进 GitHub 的 release 附件。README 里还提到了 `server/.env.example`、`docs/import.md`、`docs/perf.md`,这几个文件今天一起补上:`.env.example` 列出 Day 117 和 Day 119 用到的所有环境变量(值留空或写示例),`import.md` 是 Day 112 三种导入器的用法,`perf.md` 是测量方法加你的结果。

## 三篇 ADR

ADR(Architecture Decision Record,架构决策记录)是 Michael Nygard 2011 年提出的一种轻量文档:一个决定一篇,固定几个小节,编号递增,写完不改(决定变了就写一篇新的,把旧的标成「被取代」)。Day 106 专门讲过怎么写设计文档和 ADR,今天把它用在 Loupe 上。

一篇好的 ADR 要有三样东西:当时面临什么问题;考虑过哪些方案、为什么选这个;选了以后要付出什么代价。最后一样最容易被省略,也最有价值。

我从这五天里挑了三个最值得记录的决定。每一个都满足两个条件:有不止一个合理的方案,而且选错了会在以后造成实际问题。

`docs/adr/0001-llm-step-signature.md`:

```markdown
# 0001 · LLM 步的对齐签名用「决定」,不用输入

## 状态

已采纳(2026-10)

## 背景

对比页要把两次运行的步骤对齐。工具步用「工具名 + 规范化参数摘要」做签名很自然。LLM 步的输入是累积的对话历史,前面任何一步的输出有一点不同,后面每一个 LLM 步的输入都不同。用输入做签名,第一处分歧之后的所有 LLM 步都对不上,对比页退化成「从这里往后全部不同」。

考虑过的方案:
1. 用输入的完整摘要:上面说的问题。
2. 只用最后一条消息(本轮新增的内容)做摘要:工具结果的微小差异(比如时间戳)就会让它对不上,而且对「模型做了什么」不敏感。
3. 用模型这一步的决定:请求了哪些工具(按名字排序),或者直接回答(`<answer>`)。

## 决定

采用方案 3。签名形如 `llm:chat:calculate+get_weather` 或 `llm:chat:<answer>`。另外在对齐结果里加 `content_changed` 标记:签名相同但输出内容不同时为真,界面显示「相同(内容有变)」并允许展开逐词 diff。

## 后果

- 好处:对齐结果反映的是行为结构,用户能一眼看出「B 在第 3 步多要了一次计算」。
- 代价:两次最终回答措辞完全不同,也会被对齐为 same,必须依赖 `content_changed` 提示,否则会误导。
- 代价:同一个决定、不同参数的工具调用要靠第二层对齐(只看 kind + name)配成 changed,多了一层逻辑。
- 以后如果要支持「按语义对比回答」,应该加在第二层(内容 diff),不要改签名。
```

`docs/adr/0002-cassette-miss.md`:

```markdown
# 0002 · 重跑时 cassette miss 把错误返回给模型

## 状态

已采纳(2026-10)

## 背景

从第 N 步重跑时,工具调用默认从原运行回放(cassette)。模型改变行为后,常会用原运行没出现过的参数调用工具,这时磁带里找不到结果(miss)。2026-10-15 用 deepseek-flash 实测:改了一句系统提示词后重跑,9 步里有 2 次 miss,模型因此多绕了两步,并违反了「不要心算」的指令。

考虑过的方案:
1. 中止整个重跑,标记失败。
2. 把 miss 作为工具错误返回给模型,运行继续,在结果里计数。
3. 用一个模拟器(另一个 LLM 根据磁带猜一个合理结果)填补。

## 决定

采用方案 2,并配合两条规则:只读、无副作用、结果稳定的工具(计算器等)放进白名单,用户勾选后真实执行,以减少 miss;写操作工具永远不真实执行。每次重跑在 tags 里记 `cassette:N`、`live:N`、`miss:N`,对比页把 miss 的工具步算进「出错步」。

## 后果

- 好处:重跑大多能跑完,miss 的影响对用户可见,不会被当成提示词的效果。
- 代价:有 miss 的重跑,行为可能被扭曲,结论需要打折;用户必须先看 miss 数再分析。
- 放弃方案 3 的原因:调试的对象正是 Agent 对数据的反应,模拟器生成的数据会污染结论。
- 后续:Step 模型没有 `source` 字段,目前只在运行级别计数;如果用户需要逐步查看来源,要给 Step 加字段并迁移导入器。
```

`docs/adr/0003-eval-case-snapshot.md`:

```markdown
# 0003 · 评测用例存完整快照,不存 trace 引用

## 状态

已采纳(2026-10)

## 背景

用户在 Loupe 里把某次运行的第 N 步存成评测用例。最省事的做法是只存 `(run_id, step_idx)` 和断言,运行时再去原 trace 里取输入。

## 决定

用例保存完整快照:第 N 步发给模型的 messages 和 tools、原模型名、原运行全部工具步的输入输出(作为回放磁带)。运行用例不依赖原 trace 是否存在。

## 后果

- 好处:trace 过期、被删、被重新导入都不影响用例;快照可以单独脱敏;用例不可变,结果可比。
- 代价:每条用例几 KB 到几百 KB;几百条用例的评测集在几十 MB 量级,SQLite 可以接受。
- 代价:原 trace 修正了数据,用例不会跟着变,需要手动重新存。
- 有测试 `test_case_survives_deleting_original_run` 守护这个决定。
```

注意第二篇里引用了 Day 117 的实测数据(9 步里 2 次 miss,模型多绕了两步)。ADR 里有真实数据支撑,和只有推理的 ADR,说服力差别很大。第三篇最后一行指向守护这个决定的测试。决定、理由、守护它的测试连在一起,以后有人想改,会先看到为什么当初这么做。

还有一些值得记录的小决定,你可以自己补:为什么用 SQLite 而不是 Postgres(单人工具、零运维、一个文件就能分享);为什么分叉运行复制前缀而不是引用(读路径简单);为什么演示模式缺价格表时拒绝启动(Day 119)。

## 一键启动、CI 和发布前自查

README 承诺了「三条命令跑起来」,第三条是这个脚本:

```bash
#!/usr/bin/env bash
# agent-loupe/scripts/dev.sh  本地一键起前后端:./scripts/dev.sh
set -euo pipefail
cd "$(dirname "$0")/.."
(cd server && uv sync -q && uv run python -m scripts.seed_demo ../samples) # 第一次跑会导入样例
(cd server && exec uv run uvicorn loupe.app:create_app --factory --port 8000) &
API=$!
trap 'kill $API 2>/dev/null' EXIT
cd web && pnpm install --silent && pnpm dev
```

它会先同步依赖并导入样例(库已有数据就跳过),在后台起后端,前台起前端,`Ctrl+C` 时 `trap` 会把后端一起关掉。我在一台干净的环境里跑过它:删掉数据库以后执行,后端 8000 端口能拿到样例运行,前端 5173 端口能打开页面。

CI 用 GitHub Actions,后端跑 pytest,前端跑类型检查、单元测试和构建:

```yaml
# agent-loupe/.github/workflows/ci.yml
name: ci
on: [push, pull_request]
jobs:
  server:
    runs-on: ubuntu-latest
    defaults: { run: { working-directory: server } }
    steps:
      - uses: actions/checkout@v4
      - uses: astral-sh/setup-uv@v5
      - run: uv sync --frozen
      - run: uv run pytest -q
  web:
    runs-on: ubuntu-latest
    defaults: { run: { working-directory: web } }
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with: { version: 9 }
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: pnpm, cache-dependency-path: web/pnpm-lock.yaml }
      - run: pnpm install --frozen-lockfile
      - run: pnpm typecheck
      - run: pnpm test
      - run: pnpm build
```

README 顶部可以加 CI 状态徽章(在 Actions 页面里点工作流 → 右上角菜单 → Create status badge)。一个绿色的徽章是最便宜的「这个项目是认真维护的」信号。

发布前自查脚本把容易忘的事情都变成检查项:

```python
# agent-loupe/scripts/release_check.py  发布前自查:uv run --project server python scripts/release_check.py
import pathlib
import re
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "server"))
from loupe.redact import leftovers  # noqa: E402

problems: list[str] = []

# 1. README 必须有这几节,而且「性能」一节不能留空表
readme = (ROOT / "README.md").read_text(encoding="utf-8") if (ROOT / "README.md").exists() else ""
for h in ["## 在线演示", "## 五分钟跑起来", "## 架构", "## 关键设计", "## 性能", "## 已知局限"]:
    if h not in readme:
        problems.append(f"README 缺少「{h}」")
perf = readme.split("## 性能", 1)[-1].split("\n## ", 1)[0]
if re.search(r"\|\s*\|\s*\|", perf):
    problems.append("README 的性能表还有空格子,测完再发")

# 2. ADR 编号连续、每篇都有四个小节
adrs = sorted((ROOT / "docs" / "adr").glob("[0-9][0-9][0-9][0-9]-*.md"))
for i, p in enumerate(adrs, 1):
    if not p.name.startswith(f"{i:04d}-"):
        problems.append(f"ADR 编号不连续:{p.name}")
    text = p.read_text(encoding="utf-8")
    for sec in ["## 状态", "## 背景", "## 决定", "## 后果"]:
        if sec not in text:
            problems.append(f"{p.name} 缺少「{sec}」")

# 3. git 跟踪的文件里不能有 key,样例必须扫描干净,不能有大文件
files = subprocess.run(["git", "ls-files"], cwd=ROOT, capture_output=True, text=True).stdout.split()
for f in files:
    p = ROOT / f
    if not p.is_file():
        continue
    if p.stat().st_size > 2_000_000 and not f.startswith("samples/synthetic_"):
        problems.append(f"大文件 {f}({p.stat().st_size // 1024} KB),演示动图放 docs/ 也别超过 2 MB")
    if p.suffix in {".py", ".ts", ".tsx", ".md", ".toml", ".json", ".yml", ".env", ".txt"}:
        if re.search(r"\bsk-[A-Za-z0-9]{20,}", p.read_text(encoding="utf-8", errors="ignore")):
            problems.append(f"{f} 里疑似有 API key")
for p in (ROOT / "samples").glob("*.jsonl"):
    if p.stat().st_size > 5_000_000:  # 合成的一万步压测样例,不是真实数据
        continue
    if left := leftovers(p.read_text(encoding="utf-8")):
        problems.append(f"样例 {p.name} 没脱干净:{left[:2]}")
if any(f.endswith((".db", ".env")) for f in files):
    problems.append("数据库文件或 .env 被提交了")

print("\n".join(problems) if problems else "全部通过")
sys.exit(1 if problems else 0)
```

```bash
uv run --project server python scripts/release_check.py
```

我第一次跑这个脚本时,它报了一个我没想到的问题:`server/tests/test_redact.py 里疑似有 API key`。那是 Day 119 脱敏测试里的假 key `sk-abcdefghijklmnop1234`。它是假的,但它长得太像真的了:GitHub 的密钥扫描、各种安全工具都会对它报警,有的公司内部仓库还会直接拒绝推送。修法是在测试里把它拆开写:`"sk-" + "abcdefghijklmnop1234"`。现在仓库里的测试已经是拆开的写法。这种事只有自动检查才能发现,你自己是不会想到去看测试文件的。

补齐 README 以后再跑,只剩一条:「README 的性能表还有空格子,测完再发」。这正是它该拦住的。把 Day 119 的性能表测完填上,它就会输出「全部通过」。

## License、CHANGELOG 和第一个版本

**License。** 不放 License 的公开仓库,法律上别人不能使用你的代码,这会挡住所有想试用的人。作品集项目最常见的两个选择:

- **MIT**:最短、最宽松,几乎没有使用门槛。大部分前端和工具类项目用它。
- **Apache-2.0**:同样宽松,但多了明确的专利授权条款,企业法务更喜欢。

两个都行,我用 MIT。[choosealicense.com](https://choosealicense.com/) 是 GitHub 出的选择指南,三分钟能看完。在 GitHub 上新建文件、文件名填 `LICENSE`,会出现「Choose a license template」按钮,选完自动填好年份和名字。

**CHANGELOG。** 按 [Keep a Changelog](https://keepachangelog.com/) 的格式写,每个版本分「新增」「变更」「修复」。第一个版本可以把五天的功能列进「新增」:

```markdown
# Changelog

## [0.1.0] - 2026-10-15
### 新增
- trace 导入:OTLP JSON、Langfuse 导出、轻量 SDK
- 时间轴与步骤详情:token、成本、上下文占用
- 两次运行逐步对比(LCS 对齐 + 中文按词 diff)
- 从任意 LLM 步改参数重跑(cassette 回放、只读工具白名单)
- 失败步骤存为评测用例,批量运行、pass^k、回归对比、导出 golden.jsonl
- 演示模式:只读、限流、每日花费上限
```

**版本号。** 用[语义化版本](https://semver.org/)。还没有稳定的对外接口时用 `0.x`,`0.1.0` 就是「第一个能用的版本」。打标签并在 GitHub 上发布:

```bash
git tag -a v0.1.0 -m "v0.1.0:第一个公开版本"
git push origin v0.1.0
# 然后在 GitHub 的 Releases 页面基于这个 tag 新建 release,正文贴 CHANGELOG 里这一节
```

**发布 SDK(选做)。** 如果你想让别人在自己的 Agent 里用 Day 112 的 `server/loupe_sdk.py` 记录 trace,可以把它单独打包发到 PyPI(它只依赖标准库,很适合单独发布)。uv 自带了 `uv build` 和 `uv publish`,推荐用 PyPI 的 Trusted Publishing(在 GitHub Actions 里发布,不需要在本地保存 token)。这一步不是必须的,但一个能 `pip install` 的包,会让「开源项目」这四个字更实在。

**CONTRIBUTING。** 一页就够:怎么跑测试、代码风格(ruff、TypeScript strict)、提 PR 前跑哪几个命令。真正有人来贡献的概率不高,但它让仓库看起来像一个「欢迎别人参与」的项目。

## 两分钟演示视频

动图只能演示一个操作,视频能讲一个完整的故事。两分钟是上限,招聘方很少看完更长的视频。

| 时间 | 画面 | 旁白要点 |
| --- | --- | --- |
| 0:00–0:15 | 一条失败的 Agent 运行,时间轴上第 3 步标红 | 「调 Agent 最费时间的,是搞清楚它在哪一步、为什么走偏」 |
| 0:15–0:35 | 点开第 3 步:messages、工具调用、上下文占用条 | 看到模型在这一步做了什么决定、上下文被谁占满 |
| 0:35–1:00 | 点「从这一步重跑」,改一句系统提示词,提交 | 前面的步骤保留,工具结果回放,不会重复扣款 |
| 1:00–1:20 | 自动跳到对比页,滚到第一处分歧,展开逐词 diff | 一眼看出从哪一步开始不一样、具体改了什么 |
| 1:20–1:40 | 把这一步存成评测用例,批量跑 3 次,看 pass^3 | 一次重跑只是假设,评测才是证据 |
| 1:40–2:00 | README 的关键设计表和性能表,GitHub 链接 | 「设计取舍和测量方法都在仓库里」 |

录之前把演示数据准备好,每个操作先排练两遍。旁白可以后配,也可以只配字幕。发到 B 站和 YouTube 各一份,README 和案例页都放链接。

## 个人网站上的案例页

GitHub README 是给工程师看的,个人网站上的案例页是给所有人看的,包括不太懂技术的招聘方。它不是 README 的复制,而是一个故事。结构:

```markdown
# Agent Loupe:给 AI Agent 用的调试器

**一句话**:按时间轴回放每一步,两次运行逐步对比,从任意一步改提示词重跑,失败步骤一键变成评测用例。
**链接**:在线演示 · GitHub · 两分钟视频
**我的角色**:独立完成,设计、前后端、部署
**技术栈**:Python、FastAPI、SQLite、React 18、TypeScript、Zustand、Cloudflare Pages、Fly.io

## 问题
(两三句话:调 Agent 的时候遇到的具体痛点,最好有一个具体的场景)

## 我做了什么
(四个功能,每个一句话 + 一张截图)

## 三个关键取舍
(每个取舍两三句话:问题、选择、代价;链接到 ADR)

## 数据
(性能表 + 测量方法;一次真实的重跑实验:改了什么、miss 几次、行为怎么变)

## 如果再做一次
(两三条:你现在会怎么做得不一样)
```

「如果再做一次」这一节很多人不写,但它是最能体现成长的。比如:「我会在第一天就给 Step 加 `source` 字段,而不是把回放来源塞进 tags」「我会更早写性能测试,时间轴的虚拟滚动改了三次」。

如果你的个人网站就是这门课所在的站点(或者同类的 Astro 站),案例页可以写成一篇普通文章,放在一个 `projects` 标签下,首页加一个「作品」入口。

## 简历上怎么写

简历上的项目描述要短,每条一个「做了什么 + 用什么方法 + 结果或数据」。几个可以参考的写法:

- 独立设计并开源 Agent Loupe,一个 AI Agent 运行记录调试器(React + TypeScript + FastAPI),支持 trace 回放、逐步对比、从任意步骤重跑和评测用例沉淀;在线演示 + GitHub。
- 设计基于「模型决策」签名的两层 LCS 对齐算法,对比两次 Agent 运行并定位第一处行为分歧;前端用 Intl.Segmenter 实现中文按词 diff。
- 实现录制-回放式重跑:工具结果从原运行回放、写操作永不重放、只读工具白名单真实执行;实测发现 cassette miss 会扭曲模型行为,据此设计 miss 计数和白名单机制。
- 公开演示站按 IP 与全站滑动窗口限流、按当日实际花费设上限,修复了 X-Forwarded-For 取首值可被伪造绕过限流的问题。

数字填你自己测出来的(比如一万步 trace 的首屏时间)。没有测过的数字不要写。

## 面试时怎么讲

准备三个长度,面试官问「介绍一下你的项目」时,先给 30 秒版,看他的反应决定要不要展开。

**30 秒版。** 「我做了一个给 AI Agent 用的调试器,叫 Agent Loupe。调 Agent 最难的是看清它在哪一步、为什么走偏,改了以后又不知道从哪一步开始变了。它能逐步对比两次运行,能从任意一步改提示词重跑,前面的步骤和工具结果都从原运行回放,还能把失败的步骤一键存成评测用例。有在线演示,也开源了。」

**3 分钟版。** 在 30 秒版的基础上,挑两个技术点展开。我推荐讲对齐签名和 cassette miss,因为它们都有「一开始以为很简单,做了才发现不对」的故事:签名用输入会让第一处分歧后全部对不上,所以改用决策;cassette miss 实测会让模型绕圈、违反指令,所以加了 miss 计数和只读工具白名单。最后用一句话讲演示站怎么防止被刷。

**15 分钟版。** 这通常是面试官说「挑一个你最有成就感的项目深入讲讲」。按这个顺序:问题和定位(和现有工具的区别)→ 数据模型(Run/Step,为什么 LLM 步存完整输入)→ 三个关键取舍(对着 ADR 讲)→ 一次真实实验(Day 117 的三组重跑数据)→ 演示站的安全设计 → 已知局限和下一步。可以边讲边打开演示站。

### 最可能被深挖的问题

| 问题 | 去哪找答案 |
| --- | --- |
| 对齐算法的复杂度?两万步的运行怎么办? | Day 116 自测第 6 题;ADR 0001;README 已知局限 |
| 为什么不直接用 Langfuse / LangSmith? | README「为什么做这个」;Day 111 的竞品调研 |
| 重跑时写操作工具怎么处理?怎么保证不会误执行? | Day 117 白名单设计、练习 5 的安全测试 |
| 模型不确定,重跑的结论怎么信? | Day 117 非确定性一节;Day 118 实测 |
| 评测用例为什么要存快照? | ADR 0003 |
| 通过率 92% 但线上问题不少,怎么办? | Day 118 自测第 6 题 |
| 演示站被刷了怎么办?限流怎么取 IP? | Day 119 限流一节和自测第 6 题 |
| 如果要支持多团队、多租户,要改什么? | Day 82–84 的平台化内容;README 已知局限里的单进程 |
| 前端怎么渲染一万步不卡?怎么测的? | Day 114 虚拟滚动;Day 119 性能测量方法 |
| 这个项目里你最想重做的部分是什么? | 案例页「如果再做一次」 |

每个问题自己先口头答一遍,录下来听。答得磕磕绊绊的,回去看对应的那一天。

## 动手练习

1. **完成 README。** 按上面的结构写完,把动图录好,性能表填上真实数字。
2. **写完三篇 ADR,再补一篇。** 从「SQLite vs Postgres」「复制前缀 vs 引用」「缺价格表拒绝启动」里选一个,写第四篇。
3. **跑通发布前自查。** 加上 CI 配置,推到 GitHub 看 CI 变绿;`release_check.py` 输出「全部通过」。
4. **发布 v0.1.0。** 选 License,写 CHANGELOG,打 tag,建 GitHub Release。
5. **录视频、写案例页。** 按分镜录两分钟视频,在个人网站上发布案例页,链接到演示站、GitHub 和视频。
6. **模拟面试。** 找一个朋友(或者让 Claude 扮演面试官),按三种长度各讲一遍,让对方从深挖问题表里随机抽三个问。

**验收标准:** 仓库公开,README 第一屏有一句话介绍、动图和演示链接;CI 是绿的;`release_check.py` 全部通过;GitHub 上有 v0.1.0 的 release;个人网站上有案例页;你能不看稿讲出 30 秒版和 3 分钟版。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| README 第一屏 | 打开仓库不滚动就能看到的部分,决定访客是否继续看 |
| ADR | 架构决策记录,一个决定一篇,写背景、方案、决定、后果,只追加不修改 |
| 状态徽章(badge) | README 里显示 CI 是否通过等信息的小图标 |
| MIT / Apache-2.0 | 两种宽松的开源许可证,后者多了明确的专利授权 |
| 语义化版本(SemVer) | 主版本.次版本.修订号,0.x 表示接口还不稳定 |
| Keep a Changelog | 一种按版本记录变更的约定格式 |
| Trusted Publishing | PyPI 支持的从 CI 直接发布、无需长期 token 的机制 |
| 案例页(case study) | 个人网站上讲一个项目的故事:问题、做法、取舍、数据、反思 |

## 常见误区

**README 第一屏是安装说明。** 访客还不知道这是什么,不会想装它。第一屏放一句话介绍、动图和演示链接,安装放后面。

**「已知局限」不写,怕显得项目不完美。** 恰恰相反,能说清自己系统的边界,是资深工程师最重要的信号之一。

**ADR 只写选了什么,不写放弃了什么、付出了什么。** 那只是功能说明。被放弃的方案和代价才是 ADR 的价值。

**性能数字先随便写一个,以后再测。** 以后通常不会测,而面试官问你怎么测的,你答不上来。空着,测完再发。

**不放 License。** 公开仓库没有 License,别人在法律上不能用你的代码,所有想试用的人都会被挡住。

**测试里放长得像真 key 的假数据。** 会触发密钥扫描,甚至被拒绝推送。拆开写或者用明显不像 key 的值。

**演示视频太长。** 两分钟以内,每一段只讲一件事。超过三分钟的视频几乎没人看完。

**简历上写「熟悉」「了解」。** 写你做了什么、用了什么方法、得到了什么结果,有数字就写数字。

## 学习资料

### 文档与文章

- [GitHub Docs · About READMEs](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/about-readmes):README 放在哪、怎么显示、相对链接怎么写,10 分钟。
- [Michael Nygard · Documenting Architecture Decisions](https://www.cognitect.com/blog/2011/11/15/documenting-architecture-decisions):ADR 的原始文章,很短,15 分钟。
- [adr.github.io](https://adr.github.io/):ADR 的模板、工具和实践汇总,挑一个模板看看就行,15 分钟。
- [choosealicense.com](https://choosealicense.com/):开源许可证选择指南,5 分钟。
- [Keep a Changelog](https://keepachangelog.com/) 和 [Semantic Versioning](https://semver.org/):两份都很短,各 10 分钟。
- [Open Source Guides](https://opensource.guide/):GitHub 出的开源项目指南,看「Starting an Open Source Project」和「Finding Users for Your Project」两篇,30 分钟。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV15uVZzzEZs&autoplay=0&high_quality=1" title="90天从0到1.9K Star!开源项目作者教你快速涨Star技巧|推广github项目" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>vladelaina · 90天从0到1.9K Star!开源项目作者教你快速涨Star技巧|推广github项目 · 6 分钟,一个开源作者讲 README、演示和推广的实际经验,哪些做法有效。</figcaption>
</figure>

- 大翔_Arcxiang《教你写README.md——GitHub标记语言教程》(BV1Y5411W7j4,12 分钟):README 里 Markdown 的写法,如果你对表格、徽章、折叠块的语法不熟,看这个。

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/E6NO0rgFub4" title="How To Write a USEFUL README On Github" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Learn Fast Make Things · How To Write a USEFUL README On Github · 8 分钟,一个实用 README 应该有哪些部分、顺序怎么排。</figcaption>
</figure>

- O'Reilly《Ten Steps to a Better README - Mike Jang (Ignite OSCON 2015)》(YouTube `PC05prd2usY`,6 分钟):十条 README 建议的闪电演讲,老但不过时。

### 书籍

- Karl Fogel《Producing Open Source Software》第 2 版(O'Reilly 首版 2005,第 2 版在作者网站 [producingoss.com](https://producingoss.com/) 免费阅读):第 2 章「Getting Started」,讲一个开源项目起步时该准备什么:名字、使命说明、功能列表、开发状态、文档。

### 开源项目与代码

- [othneildrew/Best-README-Template](https://github.com/othneildrew/Best-README-Template):很流行的 README 模板,可以对照看哪些部分适合你的项目。
- [joelparkerhenderson/architecture-decision-record](https://github.com/joelparkerhenderson/architecture-decision-record):ADR 的各种模板和大量示例。
- [npryce/adr-tools](https://github.com/npryce/adr-tools):管理 ADR 编号和「被取代」关系的命令行小工具。

## 自测

1. README 第一屏应该放什么?为什么不放安装说明?

<details><summary>答案</summary>

一句话介绍(要有和别人不一样的地方)、一张动图、演示链接。访客打开仓库时还不知道这是什么,不会对安装感兴趣;第一屏的任务是让他在十秒内判断值不值得继续看。

</details>

2. 一篇 ADR 最容易被省略、也最有价值的部分是什么?

<details><summary>答案</summary>

后果,也就是选择这个方案要付出的代价,以及被放弃的方案。只写「选了什么」的 ADR 等于功能说明,看不出决策质量。

</details>

3. 为什么「已知局限」反而是加分项?

<details><summary>答案</summary>

能说清自己系统在哪里会出问题、影响范围多大、为什么暂时不解决,说明你理解系统的边界,做过取舍。这是资深工程师的核心能力;一个声称没有局限的系统,在有经验的人看来更可疑。

</details>

4. 发布前自查脚本为什么要拦住空的性能表?

<details><summary>答案</summary>

性能数字一旦先随便填了,通常就再也不会去测;面试时被问「怎么测的」答不上来,比没有数字更伤。脚本把「先测再发」变成硬性约束。

</details>

5. 为什么 `release_check.py` 会把测试文件里的假 key 报出来?应该怎么处理?

<details><summary>答案</summary>

它按 `sk-` 加二十个以上字母数字的模式扫描所有跟踪的文件,测试里的假 key 也匹配。即使是假的,也会触发 GitHub 密钥扫描或公司的推送拦截。处理方法是在测试里把它拆开拼接(`"sk-" + "..."`),或者用明显不像 key 的测试值。

</details>

6. 资深面试题:面试官说「Langfuse 和 LangSmith 都有 trace 和 playground,你这个项目的价值在哪?」你怎么回答?

<details><summary>答案</summary>

先承认它们的长处:成熟的 trace 采集、看单次运行、单次 LLM 调用的 playground、数据集和评测。然后讲 Loupe 聚焦的空白:两次运行在步骤粒度的对齐对比;从中间某一步带着修改继续跑完整个 Agent 循环,而不是只重发一次 LLM 调用;重跑时工具结果的回放和写操作保护;从失败步骤直接沉淀成带快照的步级用例。再讲作为作品的价值:它证明我理解 Agent 运行时的内部结构(上下文、工具调用、非确定性),能做出取舍并用数据验证(cassette miss 的实测),能做完整的前后端和安全的公开部署。最后可以说,如果在团队里,我会考虑把这些能力做成 Langfuse 的插件或基于它的数据,而不是另起炉灶,这本身就是一个取舍。

</details>

## 明天预告

作品一到这里完成了。它证明的是你懂 Agent 的内部、能做工具和平台。明天(Day 121)开始作品二:**作品二开题:BillSleuth,一个会查账的 Agent**。客户问「为什么这个月多扣了钱」,Agent 自己查订阅、发票、付款和税,复算金额,找出原因,给出带证据的解释,需要冲正时起草贷记单走人工审批。它要证明的是另一种能力:把 Agent 落到一个出错代价很高的真实业务里,并且用严格的评测证明它可靠。BillSleuth 的调查过程,最后也可以导出成 trace 放进 Agent Loupe 里看。
