---
title: 'Day 438 · 架构:每个方块后面是哪个文件'
description: '把 SupportPilot 的架构图从一张好看的图变成一张能检查的表:每个方块对应一个具体文件、哪天建、里面应该有什么。再规定「谁能引用谁」,用六层加两条禁令把它写成规则,用 Python 的 ast 模块读 import 来检查。第一次跑就抓到我自己定层时的两个错;然后故意弄坏五处,检查全部抓到。'
pubDate: 2026-10-27
regime: none
tags: ['capstone', 'supportpilot', 'architecture', 'project-structure', 'ast', 'agent-zero']
series: 'agent-zero'
day: 438
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 437](/blog/agent-zero/day-437-prd/) 把昨天的 12 行需求表压成了一页 PRD:七条目标、五条非目标、16 个指标、六条风险,并且写了 `prd_check.py`,检查每条目标有指标、指标有数字、非目标有理由、需求表里的每一行都有人认领。PRD 回答的是「做什么、做到什么程度」。

今天回答另一半:**怎么做,每一块放在哪**。架构图人人会画,难的是图上每个方块都对得上仓库里一个真实的文件,并且开工后三周还对得上。今天把这件事也做成能检查的。

## 今天要解决的问题

今天讲两件事:**方块到文件的对应表**,以及**谁能引用谁的规则**。学完你应该能:

1. 画出 SupportPilot 的架构图,并且说出图上每个方块后面是哪个文件、哪一天建。
2. 解释为什么 `tools/business.py`(退款规则)不能 import `llm.py`,以及这个禁令放在代码里比放在提示词里可靠在哪。
3. 用一份按表生成的目录骨架,验证三件事:方块都有文件、文件都有归属、依赖方向没有反过来。
4. 读懂 Python 相对 import(`from ..llm import X`)是怎么换算成绝对路径的,以及怎么用 `ast` 模块读 import 而不运行代码。

今天不调模型,不花钱。预计用时 3 小时。前置:[Day 437](/blog/agent-zero/day-437-prd/) 的 PRD;[Day 32](/blog/agent-zero/day-032-modules/)、[Day 33](/blog/agent-zero/day-033-packages/) 的模块和包(今天大量用到 `import`、`__init__.py`);[Day 248](/blog/agent-zero/day-248-code-retrieval/) 用过 `ast` 切代码;[Day 196](/blog/agent-zero/day-196-workflow-vs-agent/) 的 workflow 与 agent 的区别。

学法照旧:先对照逐行敲一遍(不复制粘贴)并跑通;第二天合上文章,把六层的顺序和两条禁令默写出来;做练习,做不出再展开参考答案,看完关掉重写一遍。

## 先从前端看:架构图和真实的 import

你一定见过这样的项目:README 里一张分层架构图,清清楚楚写着「页面 → 组件 → hooks → API 层」。打开代码,`utils/format.ts` 里 `import` 了一个页面组件,组件里直接 `fetch`,hooks 里读了 `window.location`。图是图,代码是代码,两年后图成了装饰。

前端有一类工具专门管这件事:dependency-cruiser、ESLint 的 `import/no-restricted-paths`、Nx 的模块边界规则。你在 `.eslintrc` 里写「`components/` 不许引用 `pages/`」,违规的 import 直接报红。Python 里对应的工具叫 import-linter(PyPI 上现在是 2.15 版,2026 年 10 月查到)。我今天不装它,而是自己写一个五十行的版本,因为想让你看清楚它在做什么:**把每个 `.py` 文件读成一棵语法树,找出 import 语句,对照一张规则表**。会写了这个,再去用 import-linter 配规则,你就知道它在背后做什么。

## 先把图画出来

下面这张图就是 SupportPilot 的架构。它不按「调用顺序」画,按**依赖方向**画:越靠上,越接近用户;每一层只许引用下面的层。

<figure>
<svg viewBox="0 0 640 430" role="img" aria-label="SupportPilot 分层架构:web、api、agent、memory、tools/kb/security/obs、db 和 llm、config 六七层,只许向下引用;右边是外部系统:浏览器、飞书群、Postgres、LLM API">
  <g font-family="var(--font-mono)" font-size="11">
    <text x="20" y="20" fill="var(--ink-soft)">上层 → 下层,只许向下引用</text>
    <rect x="20" y="30" width="420" height="36" rx="5" fill="var(--paper-raised)" stroke="var(--rule)"/>
    <text x="32" y="52" fill="var(--ink)">web/ 工作台界面 · Day 469–472</text>
    <rect x="20" y="76" width="420" height="36" rx="5" fill="var(--paper-raised)" stroke="var(--rule)"/>
    <text x="32" y="98" fill="var(--ink)">api/ app.py · audience.py · Day 467、472</text>
    <rect x="20" y="122" width="420" height="62" rx="5" fill="var(--mem-wash)" stroke="var(--mem)"/>
    <text x="32" y="142" fill="var(--ink)">agent/ state · prompts · deps · nodes · graph</text>
    <text x="32" y="160" fill="var(--ink-soft)">10 个节点:load_customer prepare_context classify</text>
    <text x="32" y="175" fill="var(--ink-soft)">retrieve act draft check approval handoff finalize · Day 457–462、465</text>
    <rect x="20" y="194" width="420" height="36" rx="5" fill="var(--mem-wash)" stroke="var(--mem)"/>
    <text x="32" y="216" fill="var(--ink)">memory/ checkpoint · turns · compress · profile · forget · Day 464–466</text>
    <rect x="20" y="240" width="100" height="44" rx="5" fill="var(--compute-wash)" stroke="var(--compute)"/>
    <text x="30" y="258" fill="var(--ink)">tools/</text><text x="30" y="274" fill="var(--ink-soft)">Day 452–456</text>
    <rect x="128" y="240" width="100" height="44" rx="5" fill="var(--compute-wash)" stroke="var(--compute)"/>
    <text x="138" y="258" fill="var(--ink)">kb/</text><text x="138" y="274" fill="var(--ink-soft)">Day 448–451</text>
    <rect x="236" y="240" width="100" height="44" rx="5" fill="var(--paper-raised)" stroke="var(--rule)"/>
    <text x="246" y="258" fill="var(--ink)">security/</text><text x="246" y="274" fill="var(--ink-soft)">Day 488、490</text>
    <rect x="344" y="240" width="96" height="44" rx="5" fill="var(--paper-raised)" stroke="var(--rule)"/>
    <text x="354" y="258" fill="var(--ink)">obs/</text><text x="354" y="274" fill="var(--ink-soft)">Day 484–485</text>
    <rect x="20" y="294" width="205" height="36" rx="5" fill="var(--compute-wash)" stroke="var(--compute)"/>
    <text x="32" y="316" fill="var(--ink)">db.py · Day 443</text>
    <rect x="235" y="294" width="205" height="36" rx="5" fill="var(--mem-wash)" stroke="var(--mem)"/>
    <text x="247" y="316" fill="var(--ink)">llm.py · Day 457</text>
    <rect x="20" y="340" width="420" height="36" rx="5" fill="var(--paper-raised)" stroke="var(--rule)"/>
    <text x="32" y="362" fill="var(--ink)">config.py · Day 442</text>
    <text x="20" y="400" fill="var(--ink-faint)">同一层里的不同包(tools、kb、security、obs)之间也不许互相引用。</text>
    <text x="20" y="418" fill="var(--ink-faint)">tools/business.py 是确定性的,还额外不许引用 llm、agent、memory、kb。</text>
    <rect x="480" y="30" width="150" height="36" rx="5" fill="var(--paper-raised)" stroke="var(--rule)" stroke-dasharray="4 3"/>
    <text x="492" y="52" fill="var(--ink-soft)">浏览器(三种用户)</text>
    <rect x="480" y="240" width="150" height="44" rx="5" fill="var(--paper-raised)" stroke="var(--rule)" stroke-dasharray="4 3"/>
    <text x="492" y="258" fill="var(--ink-soft)">飞书群</text><text x="492" y="274" fill="var(--ink-faint)">tools/notify.py</text>
    <rect x="480" y="294" width="150" height="36" rx="5" fill="var(--paper-raised)" stroke="var(--rule)" stroke-dasharray="4 3"/>
    <text x="492" y="316" fill="var(--ink-soft)">Postgres + pgvector</text>
    <rect x="480" y="340" width="150" height="36" rx="5" fill="var(--paper-raised)" stroke="var(--rule)" stroke-dasharray="4 3"/>
    <text x="492" y="362" fill="var(--ink-soft)">LLM API</text>
    <line x1="440" y1="48" x2="480" y2="48" stroke="var(--ink-faint)"/>
    <line x1="440" y1="262" x2="480" y2="262" stroke="var(--ink-faint)"/>
    <line x1="440" y1="312" x2="480" y2="312" stroke="var(--ink-faint)"/>
    <line x1="440" y1="358" x2="480" y2="358" stroke="var(--ink-faint)"/>
  </g>
</svg>
<figcaption>SupportPilot 的架构,按依赖方向画。蓝色是调用大模型的地方(agent、memory、llm),琥珀色是工具和数据(tools、kb、db)。右边虚线框是仓库外面的系统。</figcaption>
</figure>

读图时注意三处和旧版本不一样。第一,界面是 `web/`(React,Day 469 起),不是 Streamlit;第二,图里 agent 有 10 个节点,不是 9 个:`prepare_context` 是 Day 465 做对话压缩时才加进去的,Day 457–462 先写 9 个;第三,**图上方块的先后和天数不是一回事**:`llm.py` 在最下层,却是 Day 457 才建(前面几天只有配置、数据库),层是依赖方向,日子是施工顺序。

### 几个设计决定

每个决定都是面试里会被追问的,所以写出来。

**为什么是固定流程加一小段 agent,而不是一个大 agent?** [Day 196](/blog/agent-zero/day-196-workflow-vs-agent/) 讲过 Anthropic 对 workflow 和 agent 的区分:下一步由谁决定。客服工单的主干是固定的(查客户、分诊、检索、起草、质检),只有「查哪些业务数据、查几次」随工单变化,所以只有 `act` 一个节点是循环,其余都是确定的。好处是每个节点可以单独测、单独评,出了问题知道在哪一步。代价是不灵活:一张工单问三件不相干的事,固定流程处理起来笨。我接受这个代价。

**为什么退款规则写在代码里?** 它在 `tools/business.py` 里,是一个纯函数。7 条规则 7 个单元测试,永远不会算错;让模型去算「950 × 7 ÷ 12 × 0.9」,它大多数时候算对,偶尔算错,而钱的事情不能偶尔。模型负责理解客户要什么、选对工具、把结果讲清楚。

**为什么质检单独一个节点?** 起草和检查分开,是 [Day 201](/blog/agent-zero/day-201-evaluator/) 的评估者-优化者模式。`check` 先跑规则(引用是不是编的、有没有承诺到账),过了再让便宜模型核对事实依据,不过就退回重写一次,还不过就转人工。

**为什么业务库和知识库放同一个 Postgres?** 本地起一个容器,部署也只要一个。pgvector 在几十万向量内够用,我们只有几百个文本块。以后到了千万级再拆。

**为什么工作流内部不走 MCP?** 内部直接调函数,少一跳网络,单测好写。同一套业务函数在 `tools/mcp_server.py` 里另外包一层,给 Claude Desktop、Cursor 或别的团队的 Agent 用。一份实现,两个出口。MCP 本身见 [Day 271](/blog/agent-zero/day-271-mcp-why/)。

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/D7_ipDqhtwk" title="How We Build Effective Agents: Barry Zhang, Anthropic" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>AI Engineer · How We Build Effective Agents: Barry Zhang, Anthropic · 15 分钟左右,重点听「不是所有事都需要 agent」和「站在 agent 的视角看它拿到的上下文」两段,解释了为什么 SupportPilot 只让 act 一个节点自主。</figcaption>
</figure>

## 把方块写成一张表

图好看,但检查不了。下一步把「方块 → 文件」写成数据。

```bash
cd ~/agent-zero-lab
```

```python
# agent-zero-lab/part08/arch.py
"""SupportPilot 架构:图上的每个方块,后面是哪个文件、哪天建、属于哪一层。"""
from dataclasses import dataclass


@dataclass(frozen=True)
class Box:
    name: str  # 图上的名字
    path: str  # 相对仓库根;以 / 结尾表示整个目录
    day: int  # 哪一天建
    symbol: str = ""  # 文件里应该有的函数/类名,可以为空


SRC = "src/supportpilot"

BOXES = [
    # 基础设施
    Box("配置", f"{SRC}/config.py", 442, "Settings"),
    Box("数据库连接", f"{SRC}/db.py", 443, "connect"),
    Box("表结构", "db/schema.sql", 443),
    Box("帮助中心文章", "data/kb/", 444),
    Box("事实源和造数", "scripts/", 444),
    Box("LLM 调用", f"{SRC}/llm.py", 457, "LLMClient"),
    # 知识库
    Box("切块", f"{SRC}/kb/chunker.py", 448, "chunk_article"),
    Box("向量化和导入", f"{SRC}/kb/ingest.py", 449, "ingest"),
    Box("混合检索", f"{SRC}/kb/retriever.py", 450, "search"),
    Box("引用", f"{SRC}/kb/cite.py", 451, "check_citations"),
    # 业务工具
    Box("业务函数", f"{SRC}/tools/business.py", 452, "check_refund_eligibility"),
    Box("工具注册表", f"{SRC}/tools/registry.py", 453, "ToolRegistry"),
    Box("受控 text-to-SQL", f"{SRC}/tools/sql_tool.py", 455, "run_readonly_sql"),
    Box("审批通知", f"{SRC}/tools/notify.py", 455, "notify_approval"),
    Box("MCP server", f"{SRC}/tools/mcp_server.py", 456, "main"),
    # 记忆
    Box("会话快照", f"{SRC}/memory/checkpoint.py", 464, "make_checkpointer"),
    Box("对话压缩", f"{SRC}/memory/compress.py", 465, "maybe_compress"),
    Box("客户画像", f"{SRC}/memory/profile.py", 466, "get_or_build_profile"),
    Box("对话记录渲染", f"{SRC}/memory/turns.py", 464, "render_turns"),
    Box("遗忘", f"{SRC}/memory/forget.py", 466, "forget_customer"),
    # 主工作流
    Box("状态", f"{SRC}/agent/state.py", 457, "SupportState"),
    Box("提示词", f"{SRC}/agent/prompts.py", 458, "CLASSIFY"),
    Box("依赖注入", f"{SRC}/agent/deps.py", 459, "Deps"),
    Box("load_customer 查客户", f"{SRC}/agent/nodes.py", 460, "load_customer"),
    Box("prepare_context 记忆", f"{SRC}/agent/nodes.py", 465, "prepare_context"),
    Box("classify 分诊", f"{SRC}/agent/nodes.py", 460, "classify"),
    Box("retrieve 检索", f"{SRC}/agent/nodes.py", 460, "retrieve"),
    Box("act 调工具", f"{SRC}/agent/nodes.py", 460, "act"),
    Box("draft 起草", f"{SRC}/agent/nodes.py", 460, "draft"),
    Box("check 质检", f"{SRC}/agent/nodes.py", 460, "check"),
    Box("approval 审批", f"{SRC}/agent/nodes.py", 460, "approval"),
    Box("handoff 转人工", f"{SRC}/agent/nodes.py", 460, "handoff"),
    Box("finalize 收尾", f"{SRC}/agent/nodes.py", 460, "finalize"),
    Box("图和路由", f"{SRC}/agent/graph.py", 462, "build_graph"),
    # 对外
    Box("接口和 SSE", f"{SRC}/api/app.py", 467, "app"),
    Box("按人裁剪", f"{SRC}/api/audience.py", 472, "for_audience"),
    Box("读流和 reducer", "web/src/lib/run.ts", 469),
    Box("工作台界面", "web/src/app/desk/page.tsx", 470),
    # 质量
    Box("评测集", "evals/datasets/", 476),
    Box("规则检查", "evals/checks.py", 477, "run_checks"),
    Box("LLM 评审", "evals/judges.py", 478, "judge_reply"),
    Box("跑评测", "evals/run_eval.py", 478, "main"),
    Box("追踪", f"{SRC}/obs/tracing.py", 484, "observe"),
    Box("账本", f"{SRC}/obs/ledger.py", 485, "CostLedger"),
    Box("防御", f"{SRC}/security/guards.py", 488, "check_untrusted"),
    Box("限流和额度", f"{SRC}/security/limits.py", 490, "RateLimiter"),
    # 工程
    Box("依赖和工具配置", "pyproject.toml", 441),
    Box("环境变量模板", ".env.example", 442),
    Box("本地 Postgres", "docker-compose.yml", 443),
    Box("常用命令", "Makefile", 446),
    Box("测试", "tests/", 446),
    Box("文档", "docs/", 437),
]

# 层:数字越大越靠上。只许上层引用下层,同层的不同包之间也不许互相引用。
LAYERS = {
    "config": 0,
    "db": 1, "llm": 1,
    "tools": 2, "kb": 2, "security": 2, "obs": 2,
    "memory": 3,
    "agent": 4,
    "api": 5,
}

# 额外禁令:这些模块必须是「确定性」的,不许碰模型、不许碰上层
FORBIDDEN = {
    "supportpilot.tools.business": ["supportpilot.llm", "supportpilot.agent", "supportpilot.memory", "supportpilot.kb"],
    "supportpilot.kb.cite": ["supportpilot.llm", "supportpilot.agent"],
}

# 骨架里每个文件按设计应该 import 的东西(只在生成骨架时用,照着真实设计写)
DESIGN_IMPORTS = {
    f"{SRC}/db.py": ["from .config import Settings"],
    f"{SRC}/llm.py": ["from .config import Settings"],
    f"{SRC}/kb/ingest.py": ["from ..db import connect", "from ..llm import LLMClient", "from .chunker import chunk_article"],
    f"{SRC}/kb/retriever.py": ["from ..db import connect", "from ..llm import LLMClient"],
    f"{SRC}/tools/business.py": ["from ..db import connect"],
    f"{SRC}/tools/registry.py": ["from . import business"],
    f"{SRC}/tools/sql_tool.py": ["from ..db import connect"],
    f"{SRC}/tools/mcp_server.py": ["from . import business"],
    f"{SRC}/memory/compress.py": ["from ..llm import LLMClient"],
    f"{SRC}/memory/profile.py": ["from ..llm import LLMClient", "from ..tools import business"],
    f"{SRC}/memory/checkpoint.py": ["from ..config import Settings"],
    f"{SRC}/agent/deps.py": ["from ..llm import LLMClient", "from ..tools.registry import ToolRegistry"],
    f"{SRC}/agent/nodes.py": ["from ..kb import retriever", "from ..memory import compress, profile", "from ..tools import business", "from .deps import Deps", "from .state import SupportState"],
    f"{SRC}/agent/graph.py": ["from .deps import Deps", "from .nodes import make_nodes", "from .state import SupportState"],
    f"{SRC}/api/app.py": ["from ..agent.graph import build_graph", "from ..memory.checkpoint import make_checkpointer"],
    f"{SRC}/api/audience.py": [],
    f"{SRC}/obs/ledger.py": ["from ..llm import LLMClient"],
    f"{SRC}/security/guards.py": [],
}


def rows() -> list[str]:
    out = ["| 方块 | 文件 | 哪天建 | 里面应该有 |", "| --- | --- | --- | --- |"]
    for b in sorted(BOXES, key=lambda b: (b.day, b.name)):
        out.append(f"| {b.name} | `{b.path}` | Day {b.day} | {b.symbol or '—'} |")
    return out


if __name__ == "__main__":
    print(f"{len(BOXES)} 个方块,涉及 {len({b.path for b in BOXES})} 个路径")
    print("\n".join(rows()))
```

<div class="line-notes">

- `from dataclasses import dataclass` 用 dataclass 装一个方块的信息([Day 50](/blog/agent-zero/day-050-dataclass/))。`frozen=True` 让它创建后不能修改,方块表是「声明」,不该被别处偷偷改。
- `symbol: str = ""  # 文件里应该有的函数/类名,可以为空` 比「文件存在」更强的约束:文件里要真有这个名字。后面检查用 `ast` 去找。
- `SRC = "src/supportpilot"` Python 项目的 `src` 布局:包代码放 `src/包名/` 下,Day 441 建仓库时会用。
- `Box("配置", f"{SRC}/config.py", 442, "Settings"),` 配置方块 → `config.py`,Day 442 建,里面应该有 `Settings`(pydantic-settings 的配置类)。
- `Box("帮助中心文章", "data/kb/", 444),` 路径以 `/` 结尾表示整个目录,这里是 Day 444 生成的 60 多篇文章。
- `Box("LLM 调用", f"{SRC}/llm.py", 457, "LLMClient"),` `LLMClient` 是 `common/llm.py` 搬进项目的版本,Day 457 加三样东西。
- `Box("业务函数", f"{SRC}/tools/business.py", 452, "check_refund_eligibility"),` 退款规则所在。这个函数名是我按旧课写的占位,Day 452 真写的时候对不上就改这一行。
- `Box("load_customer 查客户", f"{SRC}/agent/nodes.py", 460, "load_customer"),` 注意 9 个节点全部指向同一个文件 `agent/nodes.py`,靠 `symbol` 区分。节点是 `make_nodes(deps)` 里的嵌套函数,检查时 `ast.walk` 会钻进去找。
- `Box("prepare_context 记忆", f"{SRC}/agent/nodes.py", 465, "prepare_context"),` 这个节点 Day 465 才加,所以天数是 465 而不是 460。
- `Box("按人裁剪", f"{SRC}/api/audience.py", 472, "for_audience"),` 这是 Day 472 的接口层文件,函数名是它的真名。Day 462–472 已经写好的文件,我对着实际代码核对过名字(`SupportState`、`Deps`、`build_graph`、`make_checkpointer`、`maybe_compress`、`get_or_build_profile`);Day 448–456、477–490 还没写,名字是占位。
- `LAYERS = {` 层号。数字越大越靠上。`config` 在最底下,`api` 在最上面。
- `"db": 1, "llm": 1,` `db` 和 `llm` 都要读配置,所以在 `config` 上面;它们之间不互相引用,所以同层。
- `"tools": 2, "kb": 2, "security": 2, "obs": 2,` 四个包同层,互相不许引用。`obs` 在这层是因为账本要读 `LLMClient` 的 ledger。
- `"memory": 3,` 画像要调业务函数(`tools`),压缩要调模型(`llm`),所以在 `tools` 上面。
- `FORBIDDEN = {` 额外的禁令表:左边是模块,右边是它不许引用的东西。
- `"supportpilot.tools.business": [` 业务函数不许引用 `llm`、`agent`、`memory`、`kb`。理由:它是确定性的,输入一样输出必须一样;一旦它能调模型,退款金额就不再是「代码算的」了。
- `"supportpilot.kb.cite": [` 引用检查也一样:它判断「回复里的引用是不是真的」,不能让模型来判。
- `DESIGN_IMPORTS = {` 生成骨架时每个文件里先写好「按设计应该 import 的东西」,让检查在骨架上有东西可查。
- `f"{SRC}/memory/profile.py": ["from ..llm import LLMClient", "from ..tools import business"],` 这一行对应 Day 466 的真实代码:画像既要调模型又要查业务表,实际文件里就是这两条 import。
- `f"{SRC}/agent/graph.py": ["from .deps import Deps", "from .nodes import make_nodes", "from .state import SupportState"],` 对应 Day 462 的 `graph.py` 开头的三条相对 import。
- `def rows() -> list[str]:` 把方块表输出成 markdown 表格,按「哪天建」排序。
- `for b in sorted(BOXES, key=lambda b: (b.day, b.name)):` 先按天数、再按名字排序。`lambda` 相当于 JS 的箭头函数。
- `print(f"{len(BOXES)} 个方块,涉及 {len({b.path for b in BOXES})} 个路径")` 花括号里套了集合推导式:同一个文件可能被多个方块指向(`nodes.py` 有 10 个),所以方块数和路径数不一样。

</div>

```bash
uv run python -m part08.arch
```

`arch.py` 打印出来的头一行是「52 个方块,涉及 43 个路径」,后面是这张表:

| 方块 | 文件 | 哪天建 | 里面应该有 |
| --- | --- | --- | --- |
| 文档 | `docs/` | Day 437 | — |
| 依赖和工具配置 | `pyproject.toml` | Day 441 | — |
| 环境变量模板 | `.env.example` | Day 442 | — |
| 配置 | `src/supportpilot/config.py` | Day 442 | Settings |
| 数据库连接 | `src/supportpilot/db.py` | Day 443 | connect |
| 本地 Postgres | `docker-compose.yml` | Day 443 | — |
| 表结构 | `db/schema.sql` | Day 443 | — |
| 事实源和造数 | `scripts/` | Day 444 | — |
| 帮助中心文章 | `data/kb/` | Day 444 | — |
| 常用命令 | `Makefile` | Day 446 | — |
| 测试 | `tests/` | Day 446 | — |
| 切块 | `src/supportpilot/kb/chunker.py` | Day 448 | chunk_article |
| 向量化和导入 | `src/supportpilot/kb/ingest.py` | Day 449 | ingest |
| 混合检索 | `src/supportpilot/kb/retriever.py` | Day 450 | search |
| 引用 | `src/supportpilot/kb/cite.py` | Day 451 | check_citations |
| 业务函数 | `src/supportpilot/tools/business.py` | Day 452 | check_refund_eligibility |
| 工具注册表 | `src/supportpilot/tools/registry.py` | Day 453 | ToolRegistry |
| 受控 text-to-SQL | `src/supportpilot/tools/sql_tool.py` | Day 455 | run_readonly_sql |
| 审批通知 | `src/supportpilot/tools/notify.py` | Day 455 | notify_approval |
| MCP server | `src/supportpilot/tools/mcp_server.py` | Day 456 | main |
| LLM 调用 | `src/supportpilot/llm.py` | Day 457 | LLMClient |
| 状态 | `src/supportpilot/agent/state.py` | Day 457 | SupportState |
| 提示词 | `src/supportpilot/agent/prompts.py` | Day 458 | CLASSIFY |
| 依赖注入 | `src/supportpilot/agent/deps.py` | Day 459 | Deps |
| act 调工具 | `src/supportpilot/agent/nodes.py` | Day 460 | act |
| approval 审批 | `src/supportpilot/agent/nodes.py` | Day 460 | approval |
| check 质检 | `src/supportpilot/agent/nodes.py` | Day 460 | check |
| classify 分诊 | `src/supportpilot/agent/nodes.py` | Day 460 | classify |
| draft 起草 | `src/supportpilot/agent/nodes.py` | Day 460 | draft |
| finalize 收尾 | `src/supportpilot/agent/nodes.py` | Day 460 | finalize |
| handoff 转人工 | `src/supportpilot/agent/nodes.py` | Day 460 | handoff |
| load_customer 查客户 | `src/supportpilot/agent/nodes.py` | Day 460 | load_customer |
| retrieve 检索 | `src/supportpilot/agent/nodes.py` | Day 460 | retrieve |
| 图和路由 | `src/supportpilot/agent/graph.py` | Day 462 | build_graph |
| 会话快照 | `src/supportpilot/memory/checkpoint.py` | Day 464 | make_checkpointer |
| 对话记录渲染 | `src/supportpilot/memory/turns.py` | Day 464 | render_turns |
| prepare_context 记忆 | `src/supportpilot/agent/nodes.py` | Day 465 | prepare_context |
| 对话压缩 | `src/supportpilot/memory/compress.py` | Day 465 | maybe_compress |
| 客户画像 | `src/supportpilot/memory/profile.py` | Day 466 | get_or_build_profile |
| 遗忘 | `src/supportpilot/memory/forget.py` | Day 466 | forget_customer |
| 接口和 SSE | `src/supportpilot/api/app.py` | Day 467 | app |
| 读流和 reducer | `web/src/lib/run.ts` | Day 469 | — |
| 工作台界面 | `web/src/app/desk/page.tsx` | Day 470 | — |
| 按人裁剪 | `src/supportpilot/api/audience.py` | Day 472 | for_audience |
| 评测集 | `evals/datasets/` | Day 476 | — |
| 规则检查 | `evals/checks.py` | Day 477 | run_checks |
| LLM 评审 | `evals/judges.py` | Day 478 | judge_reply |
| 跑评测 | `evals/run_eval.py` | Day 478 | main |
| 追踪 | `src/supportpilot/obs/tracing.py` | Day 484 | observe |
| 账本 | `src/supportpilot/obs/ledger.py` | Day 485 | CostLedger |
| 防御 | `src/supportpilot/security/guards.py` | Day 488 | check_untrusted |
| 限流和额度 | `src/supportpilot/security/limits.py` | Day 490 | RateLimiter |

这张表就是架构图的「文字版」,而且有两个比图强的地方:每个方块有一个**天数**,它直接是后面 60 天的施工顺序(明天排期就从这里取);每个方块有一个**应该存在的名字**,检查时可以核对。

## 生成骨架,眼睛先看一遍

下面的脚本按表生成一份只有空壳的目录。它放在练习仓库的 `part08/arch_skeleton/` 下,**不是**真正的 SupportPilot 仓库(那个 Day 441 才建)。骨架的用处是在写任何业务代码之前,先看一眼目录长什么样、检查脚本能不能用。

```python
# agent-zero-lab/part08/make_skeleton.py
"""按 arch.py 生成一份只有空壳的目录骨架,用来检查架构。"""
import sys
from collections import defaultdict
from pathlib import Path

from part08.arch import BOXES, DESIGN_IMPORTS, SRC, Box

COMMENT = {".py": "#", ".sql": "--", ".ts": "//", ".tsx": "//", ".yml": "#", ".toml": "#"}


def stub_python(path: str, boxes: list[Box]) -> str:
    days = sorted({b.day for b in boxes})
    names = "、".join(b.name for b in boxes)
    lines = [f"# {path}", f'"""{names}。骨架占位,Day {days[0]} 才写实现。"""']
    lines += DESIGN_IMPORTS.get(path, [])
    lines.append("")
    if path.endswith("agent/nodes.py"):
        lines.append("def make_nodes(deps):")
        for b in boxes:
            lines.append(f"    def {b.symbol}(state): ...  # Day {b.day}")
        lines.append("    return {}")
        return "\n".join(lines) + "\n"
    for b in boxes:
        if not b.symbol:
            continue
        if b.symbol.isupper():
            lines.append(f'{b.symbol} = ""')
        elif b.symbol[0].isupper():
            lines.append(f"class {b.symbol}: ...")
        elif b.symbol == "app":
            lines.append("app = None")
        else:
            lines.append(f"def {b.symbol}(*args, **kwargs): ...")
    return "\n".join(lines) + "\n"


def make(root: Path) -> list[str]:
    by_path: defaultdict[str, list[Box]] = defaultdict(list)
    for b in BOXES:
        by_path[b.path].append(b)
    for path, boxes in by_path.items():
        target = root / path
        if path.endswith("/"):
            target.mkdir(parents=True, exist_ok=True)
            (target / ".gitkeep").touch()
            continue
        target.parent.mkdir(parents=True, exist_ok=True)
        suffix = target.suffix
        if suffix == ".py":
            target.write_text(stub_python(path, boxes), encoding="utf-8")
        else:
            c = COMMENT.get(suffix, "#")
            target.write_text(f"{c} {path} ({'、'.join(b.name for b in boxes)},Day {boxes[0].day})\n", encoding="utf-8")
    # 每个包目录补 __init__.py
    for d in [root / SRC, *[p for p in (root / SRC).rglob("*") if p.is_dir()]]:
        (d / "__init__.py").touch()
    return sorted(str(p.relative_to(root)) for p in root.rglob("*") if p.is_file())


def tree(root: Path) -> str:
    lines = [f"{root.name}/"]

    def walk(d: Path, prefix: str) -> None:
        items = sorted(d.iterdir(), key=lambda p: (p.is_file(), p.name))
        items = [p for p in items if p.name not in (".gitkeep", "__init__.py")]
        for i, p in enumerate(items):
            last = i == len(items) - 1
            lines.append(f"{prefix}{'└── ' if last else '├── '}{p.name}{'/' if p.is_dir() else ''}")
            if p.is_dir():
                walk(p, prefix + ("    " if last else "│   "))

    walk(root, "")
    return "\n".join(lines)


if __name__ == "__main__":
    root = Path(sys.argv[1] if len(sys.argv) > 1 else "part08/arch_skeleton/supportpilot")
    files = make(root)
    print(f"生成 {len(files)} 个文件到 {root}")
    print(tree(root))
```

<div class="line-notes">

- `from collections import defaultdict` 带默认值的字典,取一个不存在的键会自动建一个空列表。相当于 JS 里 `map[k] ??= []`。
- `COMMENT = {` 不同类型文件的注释符号。非 Python 文件只写一行注释占位。
- `def stub_python(path: str, boxes: list[Box]) -> str:` 生成一个 Python 空壳文件的内容。同一个文件可能对应多个方块。
- `lines = [f"# {path}", f'"""{names}。骨架占位,Day {days[0]} 才写实现。"""']` 第一行是文件自己的路径注释(课里每段代码都这么写),第二行是文档字符串,写明这个文件对应哪些方块。
- `lines += DESIGN_IMPORTS.get(path, [])` 把设计里该有的 import 写进去;表里没有的文件,`get` 返回空列表。
- `if path.endswith("agent/nodes.py"):` 节点文件特殊处理:生成 `make_nodes(deps)`,里面嵌套定义 10 个节点函数,和 Day 462 的真实结构一致。
- `lines.append(f"    def {b.symbol}(state): ...  # Day {b.day}")` 每个节点一个空函数,`...` 是 Python 里「还没写」的占位语法。
- `if b.symbol.isupper():` 全大写的名字(如 `CLASSIFY`)当作常量,生成 `CLASSIFY = ""`。
- `elif b.symbol[0].isupper():` 首字母大写的当作类。`b.symbol[0]` 取第一个字符。
- `def make(root: Path) -> list[str]:` 生成整份骨架,返回所有文件的相对路径。
- `by_path: defaultdict[str, list[Box]] = defaultdict(list)` 先按路径把方块分组。同一个路径只写一次文件。
- `if path.endswith("/"):` 目录型方块:建目录,放一个空的 `.gitkeep` 文件,git 不跟踪空目录,所以得放个占位文件。
- `target.write_text(stub_python(path, boxes), encoding="utf-8")` 写 Python 文件。`encoding="utf-8"` 每次都显式写,不依赖系统默认。
- `for d in [root / SRC, *[p for p in (root / SRC).rglob("*") if p.is_dir()]]:` 找出 `src/supportpilot` 和它下面所有子目录,每个都补一个 `__init__.py`,让它们成为包([Day 33](/blog/agent-zero/day-033-packages/))。`rglob("*")` 递归列出所有内容。
- `def tree(root: Path) -> str:` 自己写一个简易的 `tree` 命令(本机没装 `tree`)。
- `items = sorted(d.iterdir(), key=lambda p: (p.is_file(), p.name))` 排序:目录在前、文件在后,同类按名字。`False < True`,所以 `is_file()` 为假的(目录)排前面。
- `lines.append(f"{prefix}` 最后一个用 `└──`,其余用 `├──`;`prefix` 是上层累积下来的竖线缩进。

</div>

```bash
uv run python -m part08.make_skeleton
```

```text
生成 51 个文件到 part08/arch_skeleton/supportpilot
supportpilot/
├── data/
│   └── kb/
├── db/
│   └── schema.sql
├── docs/
├── evals/
│   ├── datasets/
│   ├── checks.py
│   ├── judges.py
│   └── run_eval.py
├── scripts/
├── src/
│   └── supportpilot/
│       ├── agent/
│       │   ├── deps.py
│       │   ├── graph.py
│       │   ├── nodes.py
│       │   ├── prompts.py
│       │   └── state.py
│       ├── api/
│       │   ├── app.py
│       │   └── audience.py
│       ├── kb/
│       │   ├── chunker.py
│       │   ├── cite.py
│       │   ├── ingest.py
│       │   └── retriever.py
│       ├── memory/
│       │   ├── checkpoint.py
│       │   ├── compress.py
│       │   ├── forget.py
│       │   ├── profile.py
│       │   └── turns.py
│       ├── obs/
│       │   ├── ledger.py
│       │   └── tracing.py
│       ├── security/
│       │   ├── guards.py
│       │   └── limits.py
│       ├── tools/
│       │   ├── business.py
│       │   ├── mcp_server.py
│       │   ├── notify.py
│       │   ├── registry.py
│       │   └── sql_tool.py
│       ├── config.py
│       ├── db.py
│       └── llm.py
├── tests/
├── web/
│   └── src/
│       ├── app/
│       │   └── desk/
│       │       └── page.tsx
│       └── lib/
│           └── run.ts
├── .env.example
├── Makefile
├── docker-compose.yml
└── pyproject.toml
```

先别急着往下读,看一眼这棵树:有没有哪个方块你想不起来它为什么在这?有没有哪个目录是图上没有的?后一种我第一次生成时就遇到了:我漏了 `memory/turns.py` 和 `memory/forget.py`(Day 464、466 的真实文件),后来补进方块表。

注意几个值得对照 Day 441 的地方:`pyproject.toml` 是 Day 441;`.env.example` 是 Day 442;`docker-compose.yml`(本地 Postgres)是 Day 443;`Makefile` 是 Day 446。排期明天再讲。

## 检查:方块有文件、文件有归属、依赖没反

下面三个检查加起来六十几行。

```python
# agent-zero-lab/part08/check_arch.py
"""检查架构:图上的方块都有文件、文件都属于某个方块、上层不被下层反向引用。"""
import ast
import sys
from pathlib import Path

from part08.arch import BOXES, FORBIDDEN, LAYERS, SRC

IGNORE = {"__init__.py", ".gitkeep"}


def defined_names(tree: ast.AST) -> set[str]:
    names: set[str] = set()
    for node in ast.walk(tree):  # walk 会钻进函数里面,所以嵌套定义的函数也找得到
        if isinstance(node, (ast.FunctionDef, ast.ClassDef)):
            names.add(node.name)
        elif isinstance(node, ast.Assign):
            names.update(t.id for t in node.targets if isinstance(t, ast.Name))
    return names


def check_boxes(root: Path) -> list[str]:
    problems: list[str] = []
    for b in BOXES:
        target = root / b.path
        if not target.exists():
            problems.append(f"方块「{b.name}」没有文件:{b.path}")
        elif b.symbol and target.suffix == ".py":
            if b.symbol not in defined_names(ast.parse(target.read_text(encoding="utf-8"))):
                problems.append(f"方块「{b.name}」的文件里找不到 {b.symbol}:{b.path}")
    return problems


def check_orphans(root: Path) -> list[str]:
    problems: list[str] = []
    for f in sorted(root.rglob("*")):
        if not f.is_file() or f.name in IGNORE:
            continue
        rel = f.relative_to(root).as_posix()
        owned = any(rel == b.path or (b.path.endswith("/") and rel.startswith(b.path)) for b in BOXES)
        if not owned:
            problems.append(f"文件不属于任何方块:{rel}")
    return problems


def module_name(root: Path, f: Path) -> str:
    parts = f.relative_to(root / "src").with_suffix("").parts
    return ".".join(p for p in parts if p != "__init__")


def resolve(current: str, level: int, module: str | None) -> str:
    """把 from ..llm import X 里的相对路径,换算成 supportpilot.llm。"""
    if level == 0:
        return module or ""
    base = current.split(".")[:-level]  # 当前模块名去掉最后 level 段
    return ".".join(base + ([module] if module else []))


def imported_modules(tree: ast.AST, current: str) -> list[str]:
    found: list[str] = []
    for node in ast.walk(tree):
        if isinstance(node, ast.ImportFrom):
            base = resolve(current, node.level, node.module)
            if base == "supportpilot" or (node.level and not node.module):
                found += [f"{base}.{a.name}" for a in node.names]  # from .. import x
            else:
                found.append(base)
        elif isinstance(node, ast.Import):
            found += [a.name for a in node.names]
    return [m for m in found if m.startswith("supportpilot")]


def top(module: str) -> str:
    parts = module.split(".")
    return parts[1] if len(parts) > 1 else ""


def check_layers(root: Path) -> list[str]:
    problems: list[str] = []
    for f in sorted((root / SRC).rglob("*.py")):
        if f.name == "__init__.py":
            continue
        me = module_name(root, f)
        mine = top(me)
        tree = ast.parse(f.read_text(encoding="utf-8"))
        for target in imported_modules(tree, me):
            theirs = top(target)
            if mine in LAYERS and theirs in LAYERS and mine != theirs:
                if LAYERS[theirs] > LAYERS[mine]:
                    problems.append(f"{me} 引用了更上层的 {target}")
                elif LAYERS[theirs] == LAYERS[mine]:
                    problems.append(f"{me} 引用了同层的另一个包 {target}")
            for banned in FORBIDDEN.get(me, []):
                if target == banned or target.startswith(banned + "."):
                    problems.append(f"{me} 是确定性模块,不许引用 {banned}")
    return problems


def run_all(root: Path) -> dict[str, list[str]]:
    return {"方块有文件": check_boxes(root), "文件有归属": check_orphans(root), "依赖方向": check_layers(root)}


if __name__ == "__main__":
    root = Path(sys.argv[1] if len(sys.argv) > 1 else "part08/arch_skeleton/supportpilot")
    results = run_all(root)
    for name, problems in results.items():
        print(f"{name}:", "通过" if not problems else f"{len(problems)} 个问题")
        for p in problems:
            print("  -", p)
    sys.exit(1 if any(results.values()) else 0)
```

<div class="line-notes">

- `import ast` Python 自带的模块,把源码读成语法树(Abstract Syntax Tree),**不运行代码**。相当于 JS 里 Babel 的 `parse`。Day 248 切代码时用过。
- `IGNORE = {"__init__.py", ".gitkeep"}` 这两个文件不需要属于任何方块。
- `def defined_names(tree: ast.AST) -> set[str]:` 返回这棵树里定义过的所有名字。
- `for node in ast.walk(tree):` `ast.walk` 会遍历整棵树,包括藏在函数里面的节点。所以 `make_nodes` 里嵌套的 `def classify` 也找得到。
- `if isinstance(node, (ast.FunctionDef, ast.ClassDef)):` 函数和类的定义节点,名字在 `node.name`。
- `elif isinstance(node, ast.Assign):` 赋值语句,`CLASSIFY = ""` 就是这种。
- `names.update(t.id for t in node.targets if isinstance(t, ast.Name))` 取赋值左边的变量名。`node.targets` 是左边的列表,因为 Python 允许 `a = b = 1`。
- `def check_boxes(root: Path) -> list[str]:` 检查一:图上的方块都有文件。
- `if not target.exists():` 文件(或目录)不存在,报「方块没有文件」。
- `if b.symbol not in defined_names(ast.parse(target.read_text(encoding="utf-8"))):` 文件在,但里面没有该有的名字,也报。`ast.parse` 把文本变成语法树。
- `def check_orphans(root: Path) -> list[str]:` 检查二:文件都有归属。
- `for f in sorted(root.rglob("*")):` 遍历仓库里所有东西。
- `owned = any(rel == b.path or (b.path.endswith("/") and rel.startswith(b.path)) for b in BOXES)` 一个文件被认领有两种情况:路径正好等于某个方块的路径;或者它在某个目录型方块里面(比如 `data/kb/x.md` 属于 `data/kb/`)。`any(...)` 有一个为真就为真。
- `def module_name(root: Path, f: Path) -> str:` 把文件路径换成模块名:`src/supportpilot/memory/profile.py` → `supportpilot.memory.profile`。
- `parts = f.relative_to(root / "src").with_suffix("").parts` 先去掉 `src/` 前缀,再去掉 `.py`,再切成各段。
- `def resolve(current: str, level: int, module: str | None) -> str:` 把相对 import 换算成绝对路径。
- `base = current.split(".")[:-level]` `from ..llm import X` 的 `level` 是 2(两个点)。当前模块是 `supportpilot.memory.profile`,去掉最后 2 段(`memory`、`profile`)剩 `supportpilot`,再拼上 `llm`。
- `def imported_modules(tree: ast.AST, current: str) -> list[str]:` 找出一个文件 import 了哪些自己项目的模块。
- `if isinstance(node, ast.ImportFrom):` `from … import …` 语句。`node.level` 是点的个数,`node.module` 是点后面的名字。
- `if base == "supportpilot" or (node.level and not node.module):` 处理 `from .. import x` 这种没写模块名、直接导入名字的情况:要把导入的名字也拼到路径后面。
- `return [m for m in found if m.startswith("supportpilot")]` 只保留自己项目的,`psycopg`、`fastapi` 这类外部包不管。
- `def top(module: str) -> str:` 取模块名的第二段,即它属于哪个顶层包:`supportpilot.memory.profile` → `memory`。
- `if mine in LAYERS and theirs in LAYERS and mine != theirs:` 只有两边都在层表里、且不是同一个包时才比层。同一个包内部互相引用不受限(`agent/graph.py` 引用 `agent/nodes.py` 当然可以)。
- `if LAYERS[theirs] > LAYERS[mine]:` 对方的层号更大,就是引用了更上层。
- `elif LAYERS[theirs] == LAYERS[mine]:` 层号相等但不是同一个包,就是引用了同层的另一个包。
- `for banned in FORBIDDEN.get(me, []):` 再查额外的禁令表。
- `if target == banned or target.startswith(banned + "."):` 目标就是被禁的模块,或者在它下面。加 `"."` 是为了防止 `supportpilot.llm` 误伤 `supportpilot.llmx` 这种前缀相同的名字。
- `def run_all(root: Path) -> dict[str, list[str]]:` 三个检查打包成一个字典,键是检查的名字。
- `root = Path(sys.argv[1] if len(sys.argv) > 1 else "part08/arch_skeleton/supportpilot")` 命令行可以传一个仓库根目录。Day 441 建了真仓库以后,你可以把这个脚本指过去检查它。
- `sys.exit(1 if any(results.values()) else 0)` 任何一个检查有问题就以退出码 1 结束,以后能挂进 CI 和 pre-commit。

</div>

```bash
uv run python -m part08.check_arch
```

```text
方块有文件: 通过
文件有归属: 通过
依赖方向: 通过
```

现在是通过的,但**我第一次跑的时候不是**。第一次我写的层表是这样的:`config` 和 `db` 都放在第 0 层,`llm` 和 `obs` 都放第 1 层。跑出来:

```text
方块有文件: 通过
文件有归属: 通过
依赖方向: 2 个问题
  - supportpilot.db 引用了同层的另一个包 supportpilot.config
  - supportpilot.obs.ledger 引用了同层的另一个包 supportpilot.llm
```

两条都是**我的层定错了**,不是代码错了:`db.py` 要读配置,所以 `db` 得比 `config` 高;`obs/ledger.py` 要读 `LLMClient` 的账本,所以 `obs` 得比 `llm` 高。于是把层表改成现在这样(`config` 0;`db`、`llm` 1;`tools`、`kb`、`security`、`obs` 2)。一份还没有业务代码的骨架,就帮我发现了设计里的两个不一致。这也是今天做这件事的意义:**依赖方向是设计的一部分,越早写下来越便宜**。

### 相对 import 是怎么换算的

检查里最绕的一段是 `resolve`,拿五个例子单独看一遍:

```python
# agent-zero-lab/part08/resolve_demo.py
"""看一眼相对 import 是怎么换算成绝对路径的。"""
from part08.check_arch import resolve

CASES = [
    ("supportpilot.memory.profile", 2, "llm"),  # from ..llm import LLMClient
    ("supportpilot.memory.profile", 2, "tools"),  # from ..tools import business
    ("supportpilot.agent.nodes", 1, "deps"),  # from .deps import Deps
    ("supportpilot.api.app", 2, "agent.graph"),  # from ..agent.graph import build_graph
    ("supportpilot.agent.nodes", 0, "psycopg"),  # import psycopg(不是相对的)
]
for current, level, module in CASES:
    print(f"{current:<28} level={level} module={module:<12} -> {resolve(current, level, module)}")
```

<div class="line-notes">

- `from part08.check_arch import resolve` 直接复用刚才写的函数。
- `CASES = [` 五组参数,每组(当前模块、点的个数、点后面的名字),注释里写了对应的源码写法。
- `("supportpilot.memory.profile", 2, "llm"),  # from ..llm import LLMClient` 两个点:往上走两级到 `supportpilot`,再进 `llm`。
- `("supportpilot.agent.nodes", 1, "deps"),  # from .deps import Deps` 一个点:同一个包,去掉自己(`nodes`)再接 `deps`,得到 `supportpilot.agent.deps`。
- `("supportpilot.agent.nodes", 0, "psycopg"),  # import psycopg(不是相对的)` `level` 为 0 说明不是相对 import,原样返回,后面会被「只保留自己项目」过滤掉。
- `print(f"{current:<28}` `:<28`、`:<12` 左对齐占位,让输出整齐。

</div>

```bash
uv run python -m part08.resolve_demo
```

```text
supportpilot.memory.profile  level=2 module=llm          -> supportpilot.llm
supportpilot.memory.profile  level=2 module=tools        -> supportpilot.tools
supportpilot.agent.nodes     level=1 module=deps         -> supportpilot.agent.deps
supportpilot.api.app         level=2 module=agent.graph  -> supportpilot.agent.graph
supportpilot.agent.nodes     level=0 module=psycopg      -> psycopg
```

记一个口诀:点的个数是「往上走几级」,一个点是「同一个包」(自己所在的目录),两个点是「上一级」。

### 故意弄坏它

和前两天一样,检查要弄坏几处才知道它真的会叫。下面在一份临时副本上改五处,不动骨架。

```python
# agent-zero-lab/part08/break_arch.py
"""在一份临时副本上故意弄坏骨架五处,看 check_arch 抓不抓得到。"""
import tempfile
from pathlib import Path

from part08.check_arch import run_all
from part08.make_skeleton import make

with tempfile.TemporaryDirectory() as tmp:
    root = Path(tmp) / "supportpilot"
    make(root)
    src = root / "src/supportpilot"

    (src / "kb/cite.py").unlink()  # 1. 图上有「引用」方块,文件却没了
    (src / "utils.py").write_text("def helper(): ...\n")  # 2. 多出一个不属于任何方块的文件
    with open(src / "agent/nodes.py", "a") as f:
        f.write("from ..api.app import app\n")  # 3. 工作流反过来引用接口层
    with open(src / "tools/business.py", "a") as f:
        f.write("from ..llm import LLMClient\n")  # 4. 确定性的业务函数去调模型
    with open(src / "tools/registry.py", "a") as f:
        f.write("from ..kb import retriever\n")  # 5. 同层的 tools 去引用 kb

    for name, problems in run_all(root).items():
        print(f"{name}:", "通过" if not problems else f"{len(problems)} 个问题")
        for p in problems:
            print("  -", p)
```

<div class="line-notes">

- `with tempfile.TemporaryDirectory() as tmp:` 建一个临时目录,`with` 结束时自动删掉。弄坏的是副本,原骨架不动。
- `make(root)` 在临时目录里重新生成一份骨架。
- `(src / "kb/cite.py").unlink()` 删文件。预期:检查一会说「引用」方块没有文件。
- `(src / "utils.py").write_text("def helper(): ...\n")` 多出一个谁也不认领的文件。每个项目最后都会长出一个 `utils.py`,今天先把它拦下来。
- `f.write("from ..api.app import app\n")` 往 `agent/nodes.py` 末尾追加一行,让工作流去引用接口层。预期:引用了更上层。
- `f.write("from ..llm import LLMClient\n")` 往业务函数文件里加对模型的引用。注意 `llm` 是第 1 层、`tools` 是第 2 层,按层规则它是合法的(上层引用下层),要靠 `FORBIDDEN` 才拦得住。
- `f.write("from ..kb import retriever\n")` 往工具注册表里加对知识库的引用:同层的两个包。
- `for name, problems in run_all(root).items():` 跑三个检查,打印每个的结果。

</div>

```bash
uv run python -m part08.break_arch
```

```text
方块有文件: 1 个问题
  - 方块「引用」没有文件:src/supportpilot/kb/cite.py
文件有归属: 1 个问题
  - 文件不属于任何方块:src/supportpilot/utils.py
依赖方向: 3 个问题
  - supportpilot.agent.nodes 引用了更上层的 supportpilot.api.app
  - supportpilot.tools.business 是确定性模块,不许引用 supportpilot.llm
  - supportpilot.tools.registry 引用了同层的另一个包 supportpilot.kb
```

五处改动,五个问题都抓到。第四个值得多看一眼:**层规则放它过去了,是禁令表拦住的**。这就是为什么我既要层,又要禁令:层管大方向,禁令管某几个模块的特殊身份。

## 禁令为什么写在代码里

回头讲 `tools/business.py` 不许引用 `llm`。你可能会说:在提示词里写「退款金额必须按规则算,不许自己估」不也行吗?

行,但不可靠。提示词里的规矩是请求,模型大多数时候照做;import 禁令是物理限制,它引用不了模型,就不可能让模型替它算钱。同理,PRD 里的「模型拿不到执行退款的工具」(N1)也是一个物理限制:工具注册表里就没有那个函数。**能用结构拦住的,不要靠嘴说。** 这是做 Agent 安全设计时最重要的一条习惯,[Day 413](/blog/agent-zero/day-413-least-privilege/) 的最小权限讲的是同一件事。

## 这张表以后怎么用

三点要诚实交代。

第一,**表里的名字有一部分是占位**。Day 462–472 已经写好的文件,我核对过(`SupportState`、`Deps`、`build_graph`、`make_checkpointer`、`maybe_compress`、`get_or_build_profile`、`for_audience`)。Day 448–456 和 Day 477–490 还没写,`chunk_article`、`check_refund_eligibility`、`run_checks`、`RateLimiter` 这些名字是我按旧课和大纲猜的。到了那天,实际名字对不上,回来改这张表,这是正常的。表是为了检查,不是为了预测。

第二,**这套检查可以搬到真仓库**。Day 441 建了 `supportpilot/`,你把 `check_arch.py` 指过去:`uv run python -m part08.check_arch ~/supportpilot`(路径换成你建的位置)。一开始会一片红,因为文件还没写。随着每天往里填,红会一点点变绿,这本身就是进度条。我没有在真仓库上跑过,因为它还不存在。

第三,**检查只看 import 语句,看不到动态引用**。`importlib.import_module("xxx")` 或者函数里面才 import 的写法(`ast.walk` 其实能看到函数内部的 import,但字符串拼出来的看不到)。真项目里用 import-linter 做同样的事,它支持更多规则(比如「分层」「独立」「禁止」三种合同),今天是理解原理,不是要你一直维护自己的版本。

## 动手练习

### 练习 1:给审批通知加失败重试

PRD 里 K6 说「飞书群推送失败只记录,不阻塞工单」。假设你决定加一个重试:新方块「通知失败重试」,放在 `src/supportpilot/tools/retry.py`,里面有函数 `retry_notify`,Day 455 建。写一个脚本演示:只改表不建文件时检查怎么说,建文件后检查怎么说。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part08/ex1_add_box.py
"""练习 1:给审批通知加「失败重试」,新增一个方块,看检查怎么说。"""
import tempfile
from pathlib import Path

from part08 import arch, check_arch, make_skeleton
from part08.arch import SRC, Box

NEW = Box("通知失败重试", f"{SRC}/tools/retry.py", 455, "retry_notify")

with tempfile.TemporaryDirectory() as tmp:
    root = Path(tmp) / "supportpilot"
    make_skeleton.make(root)  # 先按旧表生成骨架
    arch.BOXES.append(NEW)  # 再把新方块加进表,但文件还没建(三个模块用的是同一个列表对象)
    print("只改了表:", check_arch.check_boxes(root))
    make_skeleton.make(root)  # 重新生成,这次会建出 retry.py
    print("补了文件:", check_arch.run_all(root))
```

<div class="line-notes">

- `from part08 import arch, check_arch, make_skeleton` 导入三个模块本身(而不是里面的名字),后面要改 `arch.BOXES`。
- `NEW = Box("通知失败重试", f"{SRC}/tools/retry.py", 455, "retry_notify")` 新方块:放在 `tools/` 下,和 `notify.py` 同一个包,所以不会触发层的限制。
- `make_skeleton.make(root)  # 先按旧表生成骨架` 此时骨架里没有 `retry.py`。
- `arch.BOXES.append(NEW)` 在列表里追加。`arch`、`check_arch`、`make_skeleton` 三个模块里的 `BOXES` 是**同一个列表对象**,改一处,处处可见。
- `print("只改了表:", check_arch.check_boxes(root))` 只跑检查一:表里有、文件没有,所以报一条。
- `make_skeleton.make(root)` 再生成一次,这次会建出 `retry.py` 并写入 `def retry_notify`。
- `print("补了文件:", check_arch.run_all(root))` 三个检查全空,表示通过。

</div>

```bash
uv run python -m part08.ex1_add_box
```

```text
只改了表: ['方块「通知失败重试」没有文件:src/supportpilot/tools/retry.py']
补了文件: {'方块有文件': [], '文件有归属': [], '依赖方向': []}
```

这就是「先改表、再建文件」的节奏:表是计划,检查在你建完文件之前一直提醒你「还没做」。

</details>

### 练习 2:让业务函数去取客户画像

假设你想让 `tools/business.py` 直接调 `memory.profile.get_or_build_profile`,省得传参数。写个脚本看检查怎么说,然后说出正确的改法。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part08/ex2_bad_dep.py
"""练习 2:让业务函数去取客户画像(tools 引用 memory),看检查怎么说。"""
import tempfile
from pathlib import Path

from part08.check_arch import check_layers
from part08.make_skeleton import make

with tempfile.TemporaryDirectory() as tmp:
    root = Path(tmp) / "supportpilot"
    make(root)
    with open(root / "src/supportpilot/tools/business.py", "a") as f:
        f.write("from ..memory.profile import get_or_build_profile\n")
    for p in check_layers(root):
        print("-", p)
```

<div class="line-notes">

- `from part08.check_arch import check_layers` 只跑依赖方向这一个检查。
- `with open(root / "src/supportpilot/tools/business.py", "a") as f:` `"a"` 是追加模式,往文件末尾加一行,不覆盖原内容。
- `f.write("from ..memory.profile import get_or_build_profile\n")` 业务函数引用 `memory.profile`:`memory` 是第 3 层,`tools` 是第 2 层,所以是「下层引用上层」。
- `for p in check_layers(root):` 打印所有问题。

</div>

```bash
uv run python -m part08.ex2_bad_dep
```

```text
- supportpilot.tools.business 引用了更上层的 supportpilot.memory.profile
- supportpilot.tools.business 是确定性模块,不许引用 supportpilot.memory
```

同一行 import,两条规则同时报警。正确的改法:**让调用方把画像传进来**。`agent/nodes.py`(上层,有权引用 `memory`)先取到画像,再作为参数传给业务函数:`check_refund_eligibility(conn, customer, profile=...)`。这就是 [Day 459](/blog/agent-zero/day-459-flow-di/) 依赖注入的动机:下层不去找上层要东西,上层把东西递下去。

</details>

### 练习 3:画你自己项目的「方块 → 文件」表

选一个你想做的项目(Day 437 练习 3 的那个),写出它的方块 → 文件表,至少 10 行,并给它定一份层表和至少一条禁令。不用跑代码。

<details><summary>参考答案</summary>

以「报销单审核 Agent」为例,片段:

| 方块 | 文件 | 哪天建 | 里面应该有 |
| --- | --- | --- | --- |
| 配置 | `src/audit/config.py` | 第 1 天 | `Settings` |
| 发票识别 | `src/audit/ocr.py` | 第 3 天 | `read_invoice` |
| 报销制度 | `src/audit/policy.py` | 第 4 天 | `check_policy` |
| 重复检测 | `src/audit/dedup.py` | 第 5 天 | `find_duplicates` |
| 审核流程 | `src/audit/flow.py` | 第 7 天 | `build_flow` |
| 接口 | `src/audit/api.py` | 第 9 天 | `app` |

层表:`config` 0;`ocr`、`policy`、`dedup` 1;`flow` 2;`api` 3。禁令:`policy.py` 是确定性的,不许引用模型和 `flow`,理由和今天的 `business.py` 一样:超标判断是规则,不能让模型来判。

自检办法:问自己「如果我把 `policy.py` 里的规则改了,哪些文件必须跟着改?」答案应该只有测试和 `flow.py` 的调用处,不该有别的。

</details>

### 练习 4:加第四个检查:文件第一行是自己的路径

本课每段代码的第一行都是 `# 文件路径`。写一个检查:每个 `.py` 文件(`__init__.py` 和空文件除外)第一行必须是 `# 它自己相对根目录的路径`。故意把一个文件改名而不改第一行,看它报什么。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part08/ex4_header.py
"""练习 4:再加一条检查:每个 .py 文件第一行必须是 `# 它自己的路径`。"""
import tempfile
from pathlib import Path

from part08.make_skeleton import make


def header_problems(root: Path) -> list[str]:
    problems: list[str] = []
    for f in sorted(root.rglob("*.py")):
        if f.name == "__init__.py" or f.stat().st_size == 0:
            continue
        rel = f.relative_to(root).as_posix()
        first = f.read_text(encoding="utf-8").splitlines()[0]
        if first != f"# {rel}":
            problems.append(f"{rel} 第一行是 {first!r}")
    return problems


with tempfile.TemporaryDirectory() as tmp:
    root = Path(tmp) / "supportpilot"
    make(root)
    print("骨架:", header_problems(root) or "全部通过")
    (root / "src/supportpilot/kb/cite.py").rename(root / "src/supportpilot/kb/citation.py")  # 改名,忘了改第一行
    print("改名之后:", header_problems(root))
```

<div class="line-notes">

- `def header_problems(root: Path) -> list[str]:` 返回问题列表。
- `if f.name == "__init__.py" or f.stat().st_size == 0:` 跳过 `__init__.py` 和空文件(`st_size` 是文件大小)。空文件没有第一行,读它会越界。
- `rel = f.relative_to(root).as_posix()` 相对路径,`as_posix()` 保证用 `/`(Windows 上也一样),这样和文件里写的对得上。
- `first = f.read_text(encoding="utf-8").splitlines()[0]` 读出第一行。
- `if first != f"# {rel}":` 第一行必须正好是 `# ` 加路径。
- `(root / "src/supportpilot/kb/cite.py").rename(root / "src/supportpilot/kb/citation.py")` 改名,但文件内容没动,所以第一行还写着旧路径。
- `print("改名之后:", header_problems(root))` 预期会抓到这个文件。

</div>

```bash
uv run python -m part08.ex4_header
```

```text
骨架: 全部通过
改名之后: ["src/supportpilot/kb/citation.py 第一行是 '# src/supportpilot/kb/cite.py'"]
```

这条检查本身有点「强迫症」,但它抓的是一类真实问题:重命名文件时忘了改注释,三个月后文档和代码说的是两个位置。更重要的是示范了怎么扩展:一条新规则,二十行。

</details>

**验收标准:** `part08/` 下有 `arch.py`、`make_skeleton.py`、`check_arch.py`,三个检查在骨架上通过,`break_arch.py` 抓到五处改动;你能不看稿画出六层(config → db/llm → tools/kb/security/obs → memory → agent → api)和两条禁令,并解释为什么业务函数不能引用 `llm`。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 架构图 | 画出系统由哪几块组成、块和块之间怎么连的图;今天要求每个方块都对应一个文件 |
| 分层 | 把模块按「谁依赖谁」排成层,只许上层引用下层 |
| 依赖方向 | 模块 A 引用(import)模块 B,就是 A 依赖 B;方向反了容易出现循环引用 |
| 确定性模块 | 输入相同输出必相同的模块(比如退款规则),不许引用模型 |
| 骨架(skeleton) | 只有目录和空壳文件、没有实现的项目结构,用来先看结构、先跑检查 |
| 相对 import | 以点开头的 import,`.` 表示同包,`..` 表示上一级,`from ..llm import X` |
| `ast`(抽象语法树) | Python 自带模块,把源码读成树状结构,不运行就能分析;相当于 JS 的 Babel parse |
| orphan(孤儿文件) | 不属于任何方块的文件;今天的检查二专门抓它 |
| `src` 布局 | 包代码放在 `src/包名/` 下的项目结构,测试跑的一定是装好的包 |
| import-linter | Python 里检查模块引用规则的现成工具,对应前端的 dependency-cruiser |
| `defaultdict` | 取不存在的键时自动建默认值的字典,相当于 JS 里 `map[k] ??= []` |

## 常见误区

**架构图画成技术栈清单。** 一张图上堆满 logo 不是架构图。架构图要说明谁依赖谁、数据在哪停、哪里要人。今天这张图的每个方块都能找到文件,就是为了防这个。

**只画图,不检查。** 图和代码会慢慢分叉。把图写成数据(`arch.py`)再检查,两者就绑在一起了。

**层定错了以为是代码错了。** 我自己第一版就是这样:`db` 引用 `config`,不是 `db.py` 写错了,是层表里把它们放同一层。检查报错时先想「是规则错还是代码错」。

**确定性靠提示词保证。** 「请不要自己估算金额」是请求,import 禁令是限制。钱、权限、删除这类事,用结构拦。

**什么都往 `utils.py` 里放。** 孤儿检查会拦它:每个文件必须属于一个方块,想建 `utils.py` 就得先想清楚它属于哪个方块。

**以为架构定了就不动。** 表里 Day 448–456 的名字是占位。设计和实现总会有出入,改表比让表过期强。

## 学习资料

### 文档与文章

- [Anthropic · Building effective agents](https://www.anthropic.com/engineering/building-effective-agents):今天的设计决定(固定流程加一小段 agent、质检分开)基本都能在这篇找到依据,重读 workflow 与 agent 的区别和评估者-优化者两节。20 分钟。
- [C4 model](https://c4model.com/):Simon Brown 提出的画架构图的方法:系统、容器、组件、代码四层逐级放大。今天这张图大致是「容器和组件」那一层,看它的 diagram 例子,10 分钟。
- [Python 官方文档 · ast](https://docs.python.org/3/library/ast.html):今天用的 `ast.parse`、`ast.walk`、`ImportFrom` 的字段说明,找 `ImportFrom` 看 `level` 和 `module`,15 分钟。
- [Python 官方文档 · The import system](https://docs.python.org/3/reference/import.html):包和相对 import 的权威说明,看「Package Relative Imports」一节,10 分钟。
- [import-linter 文档](https://import-linter.readthedocs.io/en/stable/):Python 里的现成方案,看它的「Layers」合同,就是今天分层检查的成熟版。20 分钟。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1ftBMBSEqA&autoplay=0&high_quality=1" title="LangGraph 核心 4 件套！节点 / 边 / StateGraph 秒懂指南" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>大模型-小星 · LangGraph 核心 4 件套!节点 / 边 / StateGraph 秒懂指南 · 5 分钟,播放量不高。看它怎么讲节点、边和状态,对应我们架构里的 `agent/nodes.py`、`graph.py`、`state.py`;Day 462 会真正把图连起来。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/zcmU-OE452k" title="The Art of Visualising Software Architecture (Simon Brown) | DevTernity Conference" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Simon Brown · The Art of Visualising Software Architecture · 英文,DevTernity 大会。讲为什么大多数架构图没用,以及 C4 模型怎么让图和代码对得上。和今天「图上每个方块是哪个文件」是同一个目标。</figcaption>
</figure>

### 书籍

- Chip Huyen《AI Engineering》(O'Reilly,2025)第 10 章:讲 AI 应用的整体架构怎么一步步长出来(加上下文、护栏、路由、缓存……),可以对照今天的图看哪些在我们的设计里、哪些留给了后面的天。
- Robert C. Martin《Clean Architecture》(Prentice Hall,2017):依赖规则「源码依赖只能指向内层」就是今天分层的出处;偏理论,读第 5 部分(第 22 章「The Clean Architecture」)即可。我没有核实中文版的信息,按英文原版写。

### 开源项目与代码

- [seddonym/import-linter](https://github.com/seddonym/import-linter):今天手写的检查的成熟版,看它的 contracts 怎么描述「分层」和「禁止」。
- [sverweij/dependency-cruiser](https://github.com/sverweij/dependency-cruiser):前端对应物,你写 TS 项目时可以用它做同样的事。

## 自测

1. 说出 SupportPilot 的分层顺序(从下到上),并说出同层的不同包能不能互相引用。

<details><summary>答案</summary>

config → db、llm → tools、kb、security、obs → memory → agent → api(界面 web/ 在 api 之上,是 TypeScript 项目,不在这套检查里)。同层的不同包不能互相引用,比如 `tools` 不能直接引用 `kb`;要组合它们,由上层的 `agent` 去调用。

</details>

2. `tools/business.py` 为什么不许引用 `llm`?这条禁令放在 import 上比放在提示词里好在哪?

<details><summary>答案</summary>

它是确定性的规则函数(退款资格、金额),输入相同输出必须相同。一旦它能调模型,金额就不再是代码算的,会偶尔出错。放在 import 上是物理限制:它引用不了模型,就不可能让模型替它做决定;提示词里的「请不要」只是请求,模型大多数时候照做但不保证。

</details>

3. `from ..llm import LLMClient` 写在 `supportpilot/memory/profile.py` 里,换算成绝对路径是什么?为什么?

<details><summary>答案</summary>

`supportpilot.llm`。两个点表示往上走两级:当前模块 `supportpilot.memory.profile` 去掉最后两段(`memory`、`profile`)剩 `supportpilot`,再接上 `llm`。

</details>

4. 第一次跑 `check_arch.py` 报了两个同层引用,为什么说是层表错而不是代码错?

<details><summary>答案</summary>

`db.py` 要读 `config.py` 里的配置,`obs/ledger.py` 要读 `LLMClient` 的账本,这两个依赖是业务上必须的。层表把它们放在同一层,等于说它们不该互相依赖,和事实矛盾。正确做法是改层表,让依赖方的层号更大。看到检查报错,先问是规则错还是代码错。

</details>

5. **面试题**:「怎么保证你的 Agent 项目里,模型不能绕过业务规则?」

<details><summary>答案</summary>

我靠结构,不靠提示词。第一,业务规则(退款资格、金额)写成 `tools/business.py` 里的纯函数,每条规则一个单元测试;第二,工具注册表里没有「执行退款」这个函数,模型最多只能创建一张待审批的申请,金额由服务端按规则重算;第三,我把「确定性模块不许 import 模型」写成了检查,用 `ast` 读每个文件的 import,对照层表和禁令表,违规就报错,可以挂进 CI。所以即使有人在提示词里写了「帮我退 9999 元」,模型也没有一条路径能直接动钱。

</details>

## 明天预告

明天是 Day 439 · 排期和成本估算。今天的方块表里每个方块都有「哪天建」,明天把它们按周排成日程,哪些天重、哪些可以拆、复习日放哪;然后算一笔账:一张工单大约花多少 token、跑一次评测要花多少钱,价格当天查证并写明算式。PRD 里 M13 那条「单张工单平均成本 ≤ ¥0.05」,明天会第一次拿真实的 token 估算去验证它是不是拍脑袋。
