---
title: 'Day 89 · Coding Agent 内部:读 SWE-agent / OpenHands / Codex 的设计'
description: '同样一个模型,换一套工具接口,修 bug 的成功率能差出一截。今天把 SWE-agent、mini-swe-agent、OpenHands SDK、Codex CLI 拆开读:工具集怎么设计、编辑怎么做、上下文怎么压、沙箱怎么关、什么时候停。最后自己实现一套 ACI 工具和卡死检测,并设计一个能说服人的对比实验。'
pubDate: 2026-10-12
regime: none
tags: ['coding-agent', 'swe-agent', 'openhands', 'codex', 'aci', 'swe-bench', 'source-reading', 'agent-60']
series: 'agent-60'
day: 89
lang: 'zh'
---

## 今天要解决的问题

Day 9 你写过一个 100 行的 Agent 循环,Day 55 做过一个代码审查机器人。那两样东西离 Claude Code、Codex、OpenHands 这种能自己改仓库、跑测试、提 PR 的 Coding Agent 还差什么?差的不是循环本身,循环大家都一样。差在循环外面那一圈:给模型什么工具、编辑怎么落盘、上下文满了怎么办、命令在哪跑、什么时候判定它卡住了。

资深面试里问 Coding Agent,很少问「你用过 Cursor 吗」,更常见的是「如果让你设计一个修 bug 的 Agent,文件编辑工具你会怎么设计,为什么」。这种题只能靠读过真实实现来答。

学完今天你应该能:

1. 说出一个 Coding Agent 的五个组成部分,并指出 SWE-agent、mini-swe-agent、OpenHands、Codex 在每一块上的不同选择。
2. 解释 ACI(agent-computer interface)是什么,为什么同一个模型换一套工具接口成绩会差很多,又为什么 2025 年以后「只给 bash」也能打出高分。
3. 在三个开源仓库里找到对应的源码文件,读懂编辑工具、上下文压缩、卡死检测、沙箱这几处的关键逻辑。
4. 自己实现一套带校验的编辑工具和卡死检测器,并写出一个对比实验的设计,能回答「你怎么证明你的工具比 bash 好」。

预计用时 4 到 6 小时,读源码那部分最花时间。前置:Day 9(Agent 循环)、Day 11(工具设计)、Day 26(Browser Use)、Day 55(代码审查 Agent)。

## 先把 Coding Agent 拆成五块

拿任何一个 Coding Agent 来看,剥掉界面之后都是这五块:

<figure>
<svg viewBox="0 0 640 300" role="img" aria-label="Coding Agent 的五个组成部分">
  <rect x="0" y="0" width="640" height="300" fill="var(--paper-raised)"/>
  <rect x="250" y="20" width="140" height="56" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
  <text x="320" y="44" text-anchor="middle" font-family="var(--font-mono)" font-size="13" fill="var(--ink)">模型 + 提示词</text>
  <text x="320" y="62" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">循环在这里转</text>
  <rect x="24" y="120" width="170" height="64" rx="6" fill="var(--compute-wash)" stroke="var(--compute)"/>
  <text x="109" y="146" text-anchor="middle" font-family="var(--font-mono)" font-size="13" fill="var(--ink)">① 工具集 / ACI</text>
  <text x="109" y="166" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">看、搜、改、跑</text>
  <rect x="235" y="120" width="170" height="64" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
  <text x="320" y="146" text-anchor="middle" font-family="var(--font-mono)" font-size="13" fill="var(--ink)">② 上下文管理</text>
  <text x="320" y="166" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">仓库检索 · 压缩</text>
  <rect x="446" y="120" width="170" height="64" rx="6" fill="var(--compute-wash)" stroke="var(--compute)"/>
  <text x="531" y="146" text-anchor="middle" font-family="var(--font-mono)" font-size="13" fill="var(--ink)">③ 执行环境</text>
  <text x="531" y="166" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">容器 · 沙箱 · 权限</text>
  <rect x="130" y="222" width="170" height="56" rx="6" fill="var(--paper-raised)" stroke="var(--rule)"/>
  <text x="215" y="246" text-anchor="middle" font-family="var(--font-mono)" font-size="13" fill="var(--ink)">④ 验证</text>
  <text x="215" y="264" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">复现脚本 · 跑测试</text>
  <rect x="340" y="222" width="170" height="56" rx="6" fill="var(--paper-raised)" stroke="var(--rule)"/>
  <text x="425" y="246" text-anchor="middle" font-family="var(--font-mono)" font-size="13" fill="var(--ink)">⑤ 停止与兜底</text>
  <text x="425" y="264" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">预算 · 卡死检测</text>
  <line x1="290" y1="76" x2="120" y2="120" stroke="var(--rule)"/>
  <line x1="320" y1="76" x2="320" y2="120" stroke="var(--rule)"/>
  <line x1="350" y1="76" x2="520" y2="120" stroke="var(--rule)"/>
  <line x1="300" y1="76" x2="215" y2="222" stroke="var(--rule)"/>
  <line x1="340" y1="76" x2="425" y2="222" stroke="var(--rule)"/>
</svg>
<figcaption>模型在中间转循环,周围五块决定了它能不能把活干完。读任何一个 Coding Agent 的源码,都按这五块去找对应文件。</figcaption>
</figure>

①工具集决定模型能做什么、看到什么格式的结果。②上下文管理决定在一个几十万行的仓库里,哪些东西进到模型眼前,对话长了以后丢掉什么。③执行环境决定命令在哪跑、能碰哪些文件和网络。④验证是它判断「我改对了」的依据,一般是复现脚本加测试。⑤停止与兜底是步数、花费、时间的上限,以及发现它原地打转时怎么办。

下面四个项目,每个在这五块上的选择都不一样,而且都能找到对应的源码。我建议你开着 GitHub 对照着读,别只看我的转述。

## SWE-agent:接口设计本身就是性能

SWE-agent 是普林斯顿团队 2024 年的工作,论文标题已经把观点说完了:《SWE-agent: Agent-Computer Interfaces Enable Automated Software Engineering》。他们的出发点是:人写代码有 IDE,模型也是一种「用户」,只是它的需求和人不一样,应该给它专门设计界面。当时用 GPT-4 Turbo 在完整的 SWE-bench 上解决了 12.5% 的问题,在那个时间点是最好成绩。

具体做了哪些设计?去仓库里看 `tools/` 目录,每个子目录是一组工具(仓库里叫 bundle),配置写在各自的 `config.yaml` 里:

- `tools/windowed/config.yaml`:分窗查看文件。`open`、`goto`、`scroll_up`、`scroll_down` 这几个命令,模型每次只看到一个窗口(默认 100 行),带行号。为什么不直接 `cat` 整个文件?论文里的消融实验说得很清楚,整文件塞进去,模型反而更容易找不到重点,上下文也被撑爆。
- `tools/edit_anthropic/bin/str_replace_editor`:精确替换式编辑,要求 `old_str` 在文件里唯一。这个工具的接口最早来自 Anthropic 的 computer use 演示,后来几乎成了行业标准,OpenHands、Claude Code 都有同样形态的编辑工具。
- `tools/windowed_edit_linting/config.yaml`:编辑时先跑 lint,有语法错误就拒绝写入,把错误告诉模型。论文里这一条对成绩的影响很明显,因为模型改 Python 最常见的翻车就是缩进。
- `tools/review_on_submit_m/config.yaml`:模型调用 submit 时不直接结束,而是把 diff 甩回给它,让它确认删掉了复现脚本、没动测试文件,再 submit 一次。

再看 `config/default.yaml` 里的 `instance_template`,任务提示写的是一个很朴素的流程:先读相关代码,写个复现脚本跑出错误,改源码,再跑复现脚本确认修好,想想边界情况。还有一句「不需要你改测试文件」。这个流程就是④验证那一块的全部内容,简单,但有用。

同一个文件里还有 `history_processors` 配置 `cache_control`,只给最后两条消息打 prompt caching 标记。这是成本优化,Day 38 讲过前缀缓存的原理,这里是实际用法。

核心循环在 `sweagent/agent/agents.py`,历史处理在 `sweagent/agent/history_processors.py`。agents.py 比较长,第一次读建议只找三件事:模型输出怎么解析成动作,动作执行后的输出怎么拼成下一条消息,什么条件下退出。

## mini-swe-agent:只给 bash,反而跑得不差

同一个团队一年后做了 mini-swe-agent,README 里第一句话就很挑衅:如果我们的 Agent 简单 100 倍,还能差不多好用吗?答案是能。README 写着它在 SWE-bench Verified 上超过 74%,而它的设计和 SWE-agent 几乎反着来:

- 除了 bash 什么工具都没有,连模型的 tool calling 接口都不用,模型直接在回复里写一段 bash 代码块。
- 历史完全线性,每一步就是往 messages 里追加,轨迹和发给模型的消息是同一个东西。
- 每个动作用 `subprocess.run` 独立执行,不维持一个长期的 shell 会话。换到容器里跑,只要把 `subprocess.run` 换成 `docker exec`。

整个 Agent 类在 `src/minisweagent/agents/default.py`,真的就一百多行。值得细看的是 `AgentConfig` 里的几个上限:`step_limit`、`cost_limit`(默认 3.0 美元)、`wall_time_limit_seconds`、`max_consecutive_format_errors`(连续 3 次格式错误就退出)。`run()` 里的循环就是不断 `step()`,直到最后一条消息的 role 是 `exit`。上限一到,抛出 `LimitsExceeded` 之类的异常,异常里带着一条 exit 消息。这种「用异常把控制流带出来」的写法很干净,你可以对比一下自己 Day 12 写的失败处理。

那 SWE-agent 那一套精心设计的 ACI 是不是白做了?不是。两件事同时成立:2024 年的模型需要专门设计的接口才能干好活;到了 2025、2026 年,模型本身在 bash 上已经足够熟练,接口带来的增益变小了,而简单带来的好处(好调试、好拿来训练、任何模型都能跑)变大了。这对你做技术决策的启发是:**工具接口的价值和模型能力强相关**,换了更强的模型以后,要重新评测之前那些花哨工具还值不值得留。很多团队的 Agent 越写越复杂,从来没回头删过东西。

## OpenHands:把 Agent 做成能上生产的工程

OpenHands(前身 OpenDevin)走的是另一条路,目标是做成平台。2026 年它的仓库结构变化挺大,先说清楚免得你找不到代码:`OpenHands/OpenHands` 主仓库现在是一个叫 Agent Canvas 的自托管控制台,可以跑 OpenHands 自己的 Agent,也可以通过 ACP(Agent Client Protocol)跑 Claude Code、Codex、Gemini CLI 这些第三方 Agent。真正的 Agent 核心拆到了 `OpenHands/software-agent-sdk` 这个仓库里。读源码去后者。

SDK 里值得读的几处:

- `openhands-sdk/openhands/sdk/agent/agent.py`:Agent 主逻辑。
- `openhands-sdk/openhands/sdk/conversation/stuck_detector.py`:卡死检测。注释里列了五种模式:重复的动作和观察、重复的动作和报错、没有用户输入时自言自语、两种动作来回交替、上下文窗口报错。只扫最近 20 个事件,不读全量历史。今天的练习会仿照它写一个简化版。
- `openhands-sdk/openhands/sdk/context/condenser/llm_summarizing_condenser.py`:上下文快满时,用 LLM 把较早的事件总结成一段摘要。同目录还有 `pipeline_condenser.py`,可以把多个压缩策略串起来。和 Day 20、Day 63 讲的压缩是一回事,这里是生产实现。
- `openhands-tools/openhands/tools/` 下每个工具一个目录:`terminal`、`file_editor`、`grep`、`glob`、`task_tracker`、`delegate`、`browser_use`、`apply_patch`。注意 `grep` 和 `glob` 是独立工具,而不是让模型自己在 terminal 里敲;`task_tracker` 就是 Day 10 讲过的 todo 式规划;`delegate` 是派子 Agent。

OpenHands 的论文(2407.16741)讲的是早期架构,事件流(event stream)这个核心设计一直保留到现在:Agent 的每个动作、每个观察都是一个事件,存下来以后可以回放、可以从中间恢复、可以拿去做评测。Day 65 讲持久化执行时你会再次看到这个思路。

## Codex CLI:编辑格式和沙箱是重点

OpenAI 的 Codex CLI 用 Rust 写,开源在 `openai/codex`,代码集中在 `codex-rs/` 下。仓库很大(九千多个文件),别从头读,按问题去找:

**编辑怎么做。** 看 `codex-rs/core/src/tools/handlers/apply_patch_spec.rs`。Codex 的编辑工具叫 `apply_patch`,是一个 freeform(自由格式)工具:模型不输出 JSON,而是直接输出一段补丁文本,格式由一个 Lark 语法约束,语法文件在 `codex-rs/core/assets/tools/apply_patch.lark`。这和 str_replace 的思路不同:str_replace 一次改一处,靠「唯一匹配」定位;apply_patch 一次可以改多个文件、多个块,靠补丁里的上下文行定位。后者适合大改动,但模型要能写出格式严格的补丁,所以 OpenAI 用语法约束解码来保证格式。为什么不用 JSON?因为代码里大量的引号和换行在 JSON 里都要转义,模型写长代码时转义很容易出错。

**命令在哪跑、能碰什么。** 看 `codex-rs/sandboxing/src/`。macOS 上用 Seatbelt(`seatbelt.rs`,基础策略在 `seatbelt_base_policy.sbpl`),Linux 上用 bubblewrap 和 Landlock(`bwrap.rs`、`landlock.rs`)。另外 `codex-rs/execpolicy/src/policy.rs` 是命令级的策略:哪些命令直接放行、哪些要问用户、哪些禁止。这两层分开很有意思,一层是操作系统级的隔离(就算模型执行了恶意命令,也出不了工作目录),一层是语义级的审批(`rm -rf` 这种先问人)。Day 40 讲最小权限时只讲到了概念,这里是真的实现。

**上下文满了怎么办。** `codex-rs/core/src/compact.rs` 以及同目录下 `compact_token_budget.rs`、`compact_retained_tool_outputs.rs`。从文件名就能看出它关心的问题:压缩时给多少 token 预算,哪些工具输出要保留原文。

**项目级说明怎么加载。** `codex-rs/core/src/agents_md.rs` 处理 `AGENTS.md`。Day 2 讲过用 CLAUDE.md / AGENTS.md 给 Coding Agent 写项目约定,这里能看到它是怎么被读进上下文的。

## 四个项目横着比一遍

| 维度 | SWE-agent | mini-swe-agent | OpenHands SDK | Codex CLI |
| --- | --- | --- | --- | --- |
| 编辑方式 | str_replace,带 lint 拒写 | 只有 bash(sed、cat 重定向) | file_editor + apply_patch | apply_patch,语法约束 |
| 查看代码 | 100 行分窗 | bash | file_editor、grep、glob | 主要靠 shell |
| 执行环境 | Docker 容器 | 每步独立 subprocess,可换容器 | Workspace 抽象,本地或远程 | Seatbelt / bwrap 沙箱 + 命令策略 |
| 上下文压缩 | 历史处理器 | 不压缩,线性历史 | LLM 摘要 condenser,可串联 | compact,带 token 预算 |
| 停止与兜底 | 步数、花费 | 步数、花费、时间、格式错误次数 | 卡死检测 + 上限 | 用户审批 + 上限 |
| 定位 | 研究,强调 ACI | 研究基线,强调极简 | 平台 / SDK | 产品 |

这张表我建议你自己再补一列 Claude Code(它不开源,但 Anthropic 的文档和工程博客写了很多设计),面试时被问「你会怎么设计」,可以直接拿这张表里的取舍来讲。

## SWE-bench:分数怎么来的,又该怎么看

几乎所有 Coding Agent 都报 SWE-bench 的分数。它的构造是:从 12 个热门 Python 仓库里收集真实的 GitHub issue 和对应的修复 PR,一共 2,294 个任务。Agent 拿到 issue 描述和修复前的仓库,改完以后跑两组测试:FAIL_TO_PASS(修复前失败、修复后应该通过,证明修好了)和 PASS_TO_PASS(本来就通过、改完也得通过,证明没改坏别的)。两组都过才算解决。

SWE-bench Verified 是 OpenAI 和原作者一起人工筛过的 500 个子集,剔掉了描述不清、测试本身有问题的任务,所以现在大家主要报 Verified。

看这个分数要留三个心眼。第一,训练数据污染,这些仓库和 issue 都是公开的,模型可能见过答案。第二,同一个模型配不同的 Agent 框架,分数差很多,所以 SWE-bench 的榜单其实是「模型加框架」的组合分。mini-swe-agent 的作用之一就是当统一框架,让你单独比较模型。第三,它只覆盖 Python、只覆盖「有 issue 有测试」的修 bug 任务,不代表加新功能、做重构、读需求的能力。Day 73 设计自己的 benchmark 时,你会用到这里的构造方法。

## 仓库那么大,模型怎么找到要改的地方

这是 Coding Agent 最实际的问题。几种做法:

一是 agentic search,也就是给模型 grep、glob、find,让它自己像人一样一层层找。OpenHands 把 grep 和 glob 做成独立工具,mini-swe-agent 干脆只有 bash,都是这个路子。优点是不用预先建索引,代码改了马上能搜到最新的;缺点是步数多、费 token。

二是向量检索,先把代码切块做 embedding,按语义找。听起来很合理,实际在 Coding Agent 里用得反而不多:代码里的标识符、函数名本来就是精确匹配更准,语义检索容易召回一堆「看起来相关」的东西;而且代码一直在改,索引的维护成本高。

三是 repo map,先用静态分析生成一份精简的仓库地图(文件列表、每个文件里的类和函数签名),放进上下文当目录用。

我的观点是,做一个面向真实仓库的 Coding Agent,先用 agentic search 加一份轻量的 repo map,向量检索留到你有评测数据证明它确实提高了定位准确率再加。这个判断本身也是面试时可以讲的取舍。

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1ragGzLE42&autoplay=0&high_quality=1" title="【论文精读】Agent经典论文！秒解Github Issues？软件工程Agent全解析，为Agent打造专属电脑接口" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>大咖讲AI · 【论文精读】Agent经典论文!秒解Github Issues?软件工程Agent全解析,为Agent打造专属电脑接口 · 68 分钟,SWE-agent 论文逐段讲,重点听 ACI 设计原则和消融实验那段。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/RJ6NN8Y-xok" title="SWE-agent: A deep dive" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Ofir Press · SWE-agent: A deep dive · 20 分钟,作者本人讲为什么要给模型单独设计界面,和论文配合看。</figcaption>
</figure>

## 一个实验设计:怎么证明你的工具比 bash 好

读完源码,你大概会想给自己的 Agent 也做一套 ACI。在动手之前先想清楚怎么证明它有用,不然就是凭感觉加复杂度。一个最小可行的实验:

- **任务集**:从你们自己的仓库(或者一个开源 Python 项目)里挑 20 个已经修复的 bug,用修复前的提交和对应的测试,构造成「issue 描述 + 仓库 + 判定测试」。20 个很少,Day 69 会讲样本量,这里先跑通流程。
- **两组**:A 组只给 bash;B 组给分窗查看、str_replace 带校验、受限搜索。模型、提示词、上限全都一样。
- **每题跑 3 次**,记录解决率、平均步数、平均 token、平均花费、格式错误次数。
- **看结论时**分开看:解决率涨了多少,花费涨了多少。如果 B 组解决率只涨了 1 题,而花费多了一倍,那这套工具在当前模型上就不值得。

把这个实验跑完写成一页报告,比在简历上写「设计了 Coding Agent 的工具集」有说服力得多。

## 动手练习

**目标**:实现一套带校验的 ACI 工具和一个卡死检测器,用测试证明它们的行为;再读三份源码,写一页笔记。

**第 1 步:建目录,装依赖。**

```bash
mkdir -p agentops/aci && cd agentops/aci
uv init --python 3.12 && uv add --dev pytest
```

**第 2 步:写 ACI 工具。** 三个工具的返回值都是给模型看的字符串,所以重点是报错信息能指导模型下一步怎么做。

```python
# agentops/aci/aci_tools.py
"""给 Coding Agent 用的三件工具:带行号的分窗查看、精确替换编辑、受限搜索。

设计原则(来自 SWE-agent 的 ACI 研究):
- 输出要短、要带定位信息(文件名、行号),让模型下一步知道往哪走;
- 编辑前先校验,坏代码不落盘,报错要告诉模型怎么改;
- 结果太多时截断,并明确告诉模型「还有多少、怎么缩小范围」。
"""
from __future__ import annotations

import ast
import re
from pathlib import Path

WINDOW = 100          # 一次最多给模型看多少行
MAX_HITS = 50         # 搜索最多返回多少条
CONTEXT = 4           # 编辑后回显改动处上下各几行


def view(path: str, start: int = 1, window: int = WINDOW) -> str:
    p = Path(path)
    if not p.is_file():
        return f"错误:{path} 不存在或不是文件。可以先用 search 找到正确路径。"
    lines = p.read_text(encoding="utf-8", errors="replace").splitlines()
    total = len(lines)
    start = max(1, min(start, max(total, 1)))
    end = min(total, start + window - 1)
    body = "\n".join(f"{i:>5}| {lines[i - 1]}" for i in range(start, end + 1))
    head = f"[{path},共 {total} 行,显示 {start}-{end}]"
    tail = ""
    if end < total:
        tail = f"\n(后面还有 {total - end} 行,继续看用 view(\"{path}\", start={end + 1}))"
    return f"{head}\n{body}{tail}"


def _line_of(text: str, offset: int) -> int:
    return text.count("\n", 0, offset) + 1


def str_replace(path: str, old: str, new: str) -> str:
    p = Path(path)
    if not p.is_file():
        return f"错误:{path} 不存在。新建文件请用 create。"
    text = p.read_text(encoding="utf-8")
    hits = [m.start() for m in re.finditer(re.escape(old), text)]
    if not hits:
        return ("错误:old 在文件里一处都没找到。常见原因是缩进或空格不一致。"
                "先用 view 看准原文,再把要替换的片段原样复制过来。")
    if len(hits) > 1:
        where = ", ".join(str(_line_of(text, h)) for h in hits[:10])
        return (f"错误:old 在文件里出现了 {len(hits)} 次(第 {where} 行)。"
                "请多带几行上下文,让它只匹配一处。")
    new_text = text.replace(old, new, 1)
    if p.suffix == ".py":
        try:
            ast.parse(new_text)
        except SyntaxError as e:
            return (f"拒绝写入:改完后第 {e.lineno} 行有语法错误({e.msg})。"
                    "文件没有被修改,请修正 new 后重试。")
    p.write_text(new_text, encoding="utf-8")
    first = _line_of(new_text, hits[0])
    last = first + new.count("\n")
    lines = new_text.splitlines()
    a, b = max(1, first - CONTEXT), min(len(lines), last + CONTEXT)
    snippet = "\n".join(f"{i:>5}| {lines[i - 1]}" for i in range(a, b + 1))
    return f"已修改 {path} 第 {first}-{last} 行。改动附近现在是:\n{snippet}"


def search(root: str, pattern: str, glob: str = "*.py", max_hits: int = MAX_HITS) -> str:
    rx = re.compile(pattern)
    hits: list[str] = []
    files = 0
    for f in sorted(Path(root).rglob(glob)):
        if any(part.startswith(".") for part in f.parts):
            continue
        matched = False
        for i, line in enumerate(f.read_text(encoding="utf-8", errors="replace").splitlines(), 1):
            if rx.search(line):
                hits.append(f"{f}:{i}: {line.strip()[:120]}")
                matched = True
        files += matched
    if not hits:
        return f"没有匹配 /{pattern}/ 的行(范围 {root}/**/{glob})。"
    shown = hits[:max_hits]
    more = len(hits) - len(shown)
    out = f"在 {files} 个文件里找到 {len(hits)} 处:\n" + "\n".join(shown)
    if more:
        out += f"\n(还有 {more} 处没显示。请把 pattern 写得更具体,或缩小 glob。)"
    return out
```

**第 3 步:写卡死检测器。** 只看最近一段步骤,识别三种模式。

```python
# agentops/aci/stuck_detector.py
"""检测 Agent 是不是在原地打转。思路参考 OpenHands SDK 的 StuckDetector:
只看最近一段事件,识别三种模式:同一动作反复、同一错误反复、两个动作来回切换。"""
from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class Step:
    action: str          # 规范化后的动作,比如 'view(app.py,1)'
    observation: str     # 工具返回的前 200 个字
    is_error: bool = False


def check(steps: list[Step], window: int = 12, repeat: int = 4, alternate: int = 3) -> str | None:
    recent = steps[-window:]
    if len(recent) >= repeat:
        tail = recent[-repeat:]
        if len({(s.action, s.observation) for s in tail}) == 1:
            return f"同一个动作连续 {repeat} 次且结果相同:{tail[0].action}"
        errs = [s for s in tail if s.is_error]
        if len(errs) == repeat and len({s.observation for s in errs}) == 1:
            return f"连续 {repeat} 次报同一个错:{errs[0].observation[:60]}"
    need = alternate * 2
    if len(recent) >= need:
        tail = recent[-need:]
        a, b = tail[0].action, tail[1].action
        if a != b and all(s.action == (a if i % 2 == 0 else b) for i, s in enumerate(tail)):
            return f"在两个动作之间来回 {alternate} 轮:{a} / {b}"
    return None
```

**第 4 步:写测试并跑通。**

```python
# agentops/aci/test_aci.py
from pathlib import Path
from aci_tools import view, str_replace, search
from stuck_detector import Step, check


def make(tmp: Path) -> Path:
    f = tmp / "calc.py"
    f.write_text("def add(a, b):\n    return a - b\n\n\ndef sub(a, b):\n    return a - b\n", encoding="utf-8")
    return f


def test_view_window(tmp_path):
    f = tmp_path / "big.py"
    f.write_text("\n".join(f"x{i} = {i}" for i in range(250)), encoding="utf-8")
    out = view(str(f), start=1, window=100)
    assert "共 250 行,显示 1-100" in out and "start=101" in out


def test_replace_ambiguous_then_ok(tmp_path):
    f = make(tmp_path)
    out = str_replace(str(f), "return a - b", "return a + b")
    assert "出现了 2 次" in out and "第 2, 6 行" in out
    out = str_replace(str(f), "def add(a, b):\n    return a - b", "def add(a, b):\n    return a + b")
    assert out.startswith("已修改") and "return a + b" in f.read_text()


def test_replace_rejects_syntax_error(tmp_path):
    f = make(tmp_path)
    before = f.read_text()
    out = str_replace(str(f), "def sub(a, b):", "def sub(a, b)")
    assert out.startswith("拒绝写入") and f.read_text() == before


def test_search_truncates(tmp_path):
    for i in range(3):
        (tmp_path / f"m{i}.py").write_text("\n".join("TODO fix" for _ in range(30)), encoding="utf-8")
    out = search(str(tmp_path), r"TODO", max_hits=50)
    assert "找到 90 处" in out and "还有 40 处" in out


def test_stuck_patterns():
    same = [Step("view(a.py,1)", "...")] * 4
    assert "连续 4 次" in check(same)
    alt = [Step("view(a.py,1)", "x"), Step("view(b.py,1)", "y")] * 3
    assert "来回 3 轮" in check(alt)
    ok = [Step(f"view(a.py,{i})", str(i)) for i in range(6)]
    assert check(ok) is None
```

```bash
uv run pytest -q
```

输出大致长这样:`5 passed`。

**第 5 步:接进你的 Agent 循环。** 用 Day 9 的工具注册表把 `view`、`str_replace`、`search` 注册成工具,每步执行后把动作规范化成字符串(比如 `view(app.py,1)`)喂给 `check()`。检测到卡住时,不要直接退出,先往对话里塞一条提示:「你已经连续 4 次执行同一个操作且结果相同,换个思路,比如先搜索再查看」。连续两次提示后还卡,再退出并标记为失败。这个「先提醒、再终止」的两段式,OpenHands 的 stuck detector 也是这么做的。

**第 6 步:读源码写笔记。** 打开下面三个文件,每个回答一个问题,写在 `notes/source-reading.md` 里:

1. `SWE-agent/tools/windowed_edit_linting/config.yaml` 加上 `tools/windowed/config.yaml`:lint 不通过时,返回给模型的信息里包含什么?
2. `software-agent-sdk/openhands-sdk/openhands/sdk/conversation/stuck_detector.py`:「自言自语」(monologue)模式是怎么判定的?阈值从哪里来?
3. `codex/codex-rs/core/src/tools/handlers/apply_patch_spec.rs` 加上 `codex-rs/core/assets/tools/apply_patch.lark`:补丁里一个 hunk 由哪几部分组成?

**验收标准**:5 个测试全部通过;笔记里三个问题都有答案,并且每个答案都引用了具体的行;写出上面「一个实验设计」那一节的完整实验方案(任务来源、两组配置、指标、判定规则),哪怕暂时没跑。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| Coding Agent | 能自己读代码、改文件、跑命令和测试来完成编程任务的 Agent,比如 Claude Code、Codex、OpenHands |
| ACI(agent-computer interface) | 专门给模型设计的「人机界面」,包括工具有哪些、输入输出长什么样、报错怎么写 |
| str_replace 编辑 | 用「把唯一出现的一段旧文本替换成新文本」的方式编辑文件,要求旧文本在文件里只出现一次 |
| apply_patch | Codex 的编辑工具,模型输出一段补丁文本,一次可以改多个文件多个位置 |
| freeform tool | 不走 JSON 参数、直接接收自由文本的工具,可以用语法约束格式 |
| SWE-bench / Verified | 用真实 GitHub issue 和测试评测修 bug 能力的基准;Verified 是人工筛过的 500 题子集 |
| FAIL_TO_PASS / PASS_TO_PASS | SWE-bench 的两组判定测试:修复后应该变通过的,和本来就该一直通过的 |
| agentic search | 让模型用 grep、glob 这类工具自己一步步找代码,而不是预先建索引 |
| condenser | OpenHands 里负责压缩上下文的组件 |
| Seatbelt / bubblewrap / Landlock | macOS 和 Linux 上的进程级沙箱机制,限制进程能访问的文件和网络 |
| ACP(Agent Client Protocol) | 编辑器或控制台和 Coding Agent 之间通信的协议,OpenHands Agent Canvas 用它接第三方 Agent |

## 常见误区

**以为工具越多越好。** 每加一个工具,模型就多一种选错的可能,工具说明也要占上下文。mini-swe-agent 只有 bash 也能打出高分,说明工具的增益要用实验证明,不能默认。

**编辑工具不做校验,坏代码直接落盘。** 模型改出语法错误,下一步再改时看到的已经是坏文件,经常越改越乱。写入前做语法检查、拒绝写入并说明原因,是成本最低、收益最高的一条。

**拿 SWE-bench 分数直接比模型。** 榜单上的分数是模型加框架加配置的结果,换了框架能差十几个点。比较模型要用同一个框架,mini-swe-agent 就是为此存在的。

**沙箱只做一层。** 只做命令黑名单,模型换个写法就绕过去了;只做系统级隔离,又会在隔离范围内误删工作目录里的东西。Codex 把系统沙箱和命令审批分成两层,值得照抄这个思路。

**卡死了直接杀掉。** 很多时候提醒一句模型就能换思路。先提示,再终止,并且把被终止的轨迹存下来做错误分析。

## 学习资料

### 文档与文章

- [SWE-agent 论文(arXiv 2405.15793)](https://arxiv.org/abs/2405.15793):ACI 概念的出处,重点读第 3 节的接口设计原则和消融实验表,1 小时。
- [OpenHands 论文(arXiv 2407.16741)](https://arxiv.org/abs/2407.16741):事件流架构和沙箱设计,读第 2 节,40 分钟。
- [SWE-bench 论文(arXiv 2310.06770)](https://arxiv.org/abs/2310.06770):基准怎么构造、怎么判定,读第 2 节,30 分钟。
- [SWE-bench 官网](https://www.swebench.com/):Verified、bash only 等几个榜单,看看「同模型不同框架」的分数差距,15 分钟。
- [Anthropic:Claude Code best practices](https://www.anthropic.com/engineering/claude-code-best-practices):官方讲 Claude Code 的使用和设计思路,可以当作补表格最后一列的材料,30 分钟。
- [Anthropic:Writing effective tools for agents](https://www.anthropic.com/engineering/writing-tools-for-agents):工具设计的通用原则,和 ACI 的思路一致,30 分钟。

### B 站视频

- 大咖讲AI《【论文精读】Agent经典论文!秒解Github Issues?软件工程Agent全解析,为Agent打造专属电脑接口》:已嵌入正文,SWE-agent 论文精读。
- AI论文小小编《OpenHands软件代理SDK:面向生产代理的可组合和可扩展基础》:23 分钟,讲 OpenHands SDK 论文的架构,配合读 software-agent-sdk 源码。

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1t2y3BdETP&autoplay=0&high_quality=1" title="OpenHands软件代理SDK：面向生产代理的可组合和可扩展基础" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>AI论文小小编 · OpenHands软件代理SDK:面向生产代理的可组合和可扩展基础 · 23 分钟,看事件、工具、Workspace 这几个抽象怎么拆的。</figcaption>
</figure>

### 其他经典视频

- Ofir Press《SWE-agent: A deep dive》:已嵌入正文。
- OpenHands 官方《How to Get Started with OpenHands (CLI, Cloud & SDK Explained)》:24 分钟,看 CLI、Cloud、SDK 三种用法的关系,读源码前先建立整体印象。

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/jQ2ft0RKhsY" title="How to Get Started with OpenHands (CLI, Cloud &amp; SDK Explained)" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>OpenHands · How to Get Started with OpenHands (CLI, Cloud &amp; SDK Explained) · 24 分钟,SDK 部分从 15 分钟左右开始。</figcaption>
</figure>

- Matthew Berman《SWE-Agent Team Interview - Agents, Programming, and Benchmarks!》:52 分钟,和 SWE-agent 团队的访谈,讲 benchmark 的局限和他们怎么看 Agent 框架的复杂度,有空再看。

### 书籍

- Chip Huyen《AI Engineering》(O'Reilly, 2025):第 6 章「RAG and Agents」的 Agent 部分,讲工具、规划和失败模式,作为今天的理论底子,1.5 小时。英文原版。

### 开源项目与代码

- [SWE-agent/SWE-agent](https://github.com/SWE-agent/SWE-agent):读 `tools/windowed/`、`tools/edit_anthropic/`、`tools/review_on_submit_m/`、`config/default.yaml`、`sweagent/agent/agents.py`。
- [SWE-agent/mini-swe-agent](https://github.com/SWE-agent/mini-swe-agent):读 `src/minisweagent/agents/default.py` 和 `src/minisweagent/environments/local.py`,半小时能读完。
- [OpenHands/software-agent-sdk](https://github.com/OpenHands/software-agent-sdk):读 `openhands-sdk/openhands/sdk/conversation/stuck_detector.py`、`openhands-sdk/openhands/sdk/context/condenser/llm_summarizing_condenser.py`、`openhands-tools/openhands/tools/` 下的工具定义。
- [openai/codex](https://github.com/openai/codex):读 `codex-rs/core/src/tools/handlers/apply_patch_spec.rs`、`codex-rs/core/assets/tools/apply_patch.lark`、`codex-rs/sandboxing/src/seatbelt.rs`、`codex-rs/execpolicy/src/policy.rs`、`codex-rs/core/src/compact.rs`。

## 自测

**1. SWE-agent 的编辑工具在写入前做语法检查,这一条为什么对成绩影响大?**

<details><summary>答案</summary>

模型改 Python 最常见的错误是缩进和括号。坏代码一旦落盘,下一步模型看到的就是一个已经坏掉的文件,它往往在错误的基础上继续改,越改越乱。写入前检查、拒绝写入并说明哪一行什么错,相当于把错误挡在源头,模型只需要重新生成这一次编辑。

</details>

**2. mini-swe-agent 只给 bash 也能在 SWE-bench Verified 上超过 74%,这是不是说明 ACI 没用?**

<details><summary>答案</summary>

不是。ACI 的价值和模型能力相关。2024 年的模型需要专门设计的接口才能可靠地查看和编辑代码;到 2025、2026 年,模型在 bash 上已经很熟练,专门接口的增益变小了,而极简设计在调试、训练数据、兼容性上的好处变大了。正确的做法是每换一代模型,就用评测重新衡量这些工具还值不值得留。

</details>

**3. Codex 的 apply_patch 为什么做成 freeform 工具,而不是 JSON 参数?**

<details><summary>答案</summary>

补丁里全是代码,代码里有大量引号、反斜杠和换行。放进 JSON 字符串都要转义,模型写长代码时转义很容易出错,一个字符错了整段 JSON 就解析失败。freeform 工具让模型直接输出补丁文本,再用 Lark 语法做约束解码保证格式正确,两边的好处都拿到了。

</details>

**4. 为什么 Codex 要把系统级沙箱和命令审批分成两层?**

<details><summary>答案</summary>

两层防的东西不一样。系统级沙箱(Seatbelt、bubblewrap、Landlock)保证进程无论执行什么命令,都出不了允许的目录和网络范围,防的是越界。命令审批按语义判断风险,比如 `rm -rf`、`git push --force` 先问人,防的是在允许范围内做破坏性操作。只有黑名单容易被换个写法绕过,只有沙箱又拦不住在工作目录里误删,所以两层都要。

</details>

**5. SWE-bench 里 PASS_TO_PASS 这组测试的作用是什么?只有 FAIL_TO_PASS 会出什么问题?**

<details><summary>答案</summary>

PASS_TO_PASS 是修复前就通过的测试,改完也必须通过,用来检查有没有把别的功能改坏。只看 FAIL_TO_PASS 的话,模型可以用很粗暴的方式让目标测试通过,比如把相关逻辑整个绕过,其他功能坏了也发现不了。

</details>

**6. 资深面试题:让你给公司内部的 Java 单体仓库(两百万行)设计一个修 bug 的 Coding Agent,工具集和上下文策略你会怎么定?怎么证明你的设计是对的?**

<details><summary>答案</summary>

先说约束:仓库大、语言是 Java、构建慢,所以「跑测试」本身很贵。工具集我会给:受限的代码搜索(grep 加按模块过滤,结果截断并提示缩小范围)、分窗查看、带编译检查的精确替换编辑(写入前对单个文件做语法检查,避免每次都全量编译)、只跑相关模块测试的测试工具,以及 git diff。上下文上,预先生成一份 repo map(模块、包、类和公共方法签名)放进系统提示,定位靠 agentic search,先不做向量索引。执行放在容器里,只读挂载依赖缓存,网络默认关闭。停止条件包括步数、花费、时间和卡死检测。

证明方式是做对比实验:从仓库历史里挑几十个已修复的 bug,构造成「issue + 修复前提交 + 判定测试」,对比只给 bash 的基线和我的工具集,每题多跑几次,看解决率、步数、花费,并做统计检验(Day 69 的方法)。如果某个工具在评测上没有带来显著提升,就把它去掉。上线后再看真实使用中的采纳率和回滚率。

</details>

## 明天预告

Day 90 讲 Computer Use 与 Browser Agent:让 Agent 用图形界面。今天的 Agent 操作的是文本(代码和命令),明天它要看截图、点按钮、填表单。我们会比较截图坐标和 DOM / 可访问性树两条路线,看 2026 年 Claude 和 OpenAI 的 computer use 接口现在长什么样,自己用 Playwright 搭一个能被注入攻击的测试页,把安全问题当场演示出来。
