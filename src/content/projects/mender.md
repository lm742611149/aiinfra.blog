---
title: 'Mender · 从零写代码 Agent,跑 SWE-bench'
name: 'Mender'
tagline: '不用框架,自己写一个修 GitHub issue 的代码 Agent,按官方方法跑分'
summary: '从一个空文件开始写代码 Agent:看代码、搜索、改文件、跑测试、交 patch。在 SWE-bench Verified 里分层抽 50 题,用官方 Docker harness 判分,公开通过率、单题成本和每一道失败题的原因。本机跑不了评测,要租一台 x86 云服务器。'
order: 4
difficulty: 4
level: '资深'
duration: '6–8 周(业余时间)'
cost: '约 $60–150(API 费 + 云服务器,2026-10 估算)'
gpu: false
targets: ['Coding Agent 工程师', 'Agent 平台工程师', '海外 FDE']
stack: ['Python', 'Docker', 'SWE-bench harness', 'LiteLLM', 'pytest', 'AWS EC2']
recognition: '按 SWE-bench 官方 harness 判分的 50 题通过率 + 与 mini-swe-agent 同模型对照 + 公开轨迹与技术报告'
depends: []
status: 'spec'
---

## 这个项目是什么

SWE-bench(Jimenez 等,2023)把真实 GitHub issue 变成了考题:给你一个 Python 仓库的某个历史版本和一段 issue 描述,你交一个 patch,判分程序在干净容器里打上 patch,跑一组修复前会失败、修复后应该通过的测试(`FAIL_TO_PASS`),再跑一组原本就通过、不能被你改坏的测试(`PASS_TO_PASS`),两组都过才算「解决」。原始数据集 2,294 题,来自 12 个热门仓库。SWE-bench Verified 是 OpenAI 和 SWE-bench 团队 2024 年 8 月筛出来的 500 题子集,经过人工确认题目描述足够清楚、测试是公平的。

Mender 就是你自己写的那个交 patch 的东西。不用 LangGraph,不用 OpenHands,也不直接改 SWE-agent,从一个空的 `agent.py` 开始:一个循环、四五个工具、一个上下文管理策略、一个提交动作。然后从 Verified 的 500 题里按难度分层抽 50 题,用官方 harness 判分,得出一个你自己负责的通过率,外加每道题花了多少钱、走了多少步、失败的那些死在哪里。

做完长这样:一个几百行的仓库,一份 `predictions.jsonl`,一份官方 harness 生成的 `results.json`,一张失败分类表,和一篇技术文章讲你每次改动对通过率和成本的影响。

## 为什么值得做

coding agent 是 2025–2026 年最热的 Agent 形态,招聘 JD 里「做过代码 Agent」「熟悉 SWE-bench」出现得越来越多。但大多数人的经历是「用过 Claude Code / Cursor」,能讲清楚一个代码 Agent 内部为什么这样设计的人少。从零写一个、用公认的方法测出数字,面试时你能回答的问题层次完全不一样。

这件事已经有足够好的参照物,你不是在黑暗里摸索。SWE-agent 论文(Yang 等,2024)提出 ACI(agent-computer interface,给 Agent 设计的操作界面)的概念,核心观点是 Agent 和人一样需要专门设计的工具,比如带行号的文件查看器、改完立刻跑 lint 的编辑命令;它在完整 SWE-bench 上 pass@1 12.5%。一年后同一个团队做了 mini-swe-agent,只给 bash 一个工具,Agent 类约 100 行,README 里说在 Verified 上超过 74%。Agentless(Xia 等,2024)走另一条路,不让模型自主决定下一步,固定成定位、修复、验证三段,在 SWE-bench Lite 上 32.00%、单题平均 $0.70。这三家放在一起就是一场很好的设计辩论:工具应该多精细?流程该交给模型还是写死?你的项目可以用数据加入这场辩论。

必须说清楚一件事。2026 年 2 月 23 日 OpenAI 发文说不再用 SWE-bench Verified 衡量前沿模型的编码能力,理由是他们审查了一批模型反复做不出来的题,认为其中至少 59.4% 的测试会拒绝正确解,而且有证据显示多个前沿模型能凭记忆复现原始修复,也就是数据污染。他们推荐改用 Scale AI 的 SWE-bench Pro。这对 Mender 的影响是:Verified 上的高分说服力下降了,但它仍然是公开基线最多、工具链最成熟的一套,用来练「从零写 Agent + 按官方方法评测」完全合适。你的报告里要主动写出这个局限,失败分析时也要留意「我的解其实是对的,只是测试太死」这一类。能主动讲出基准的毛病,本身就是资深的信号。这一段的判断是我的,事实部分来源见参考资料。

对准的岗位:做 coding agent 的公司和团队、Agent 平台(要给内部开发者提供代码修复能力)、海外 FDE(客户问「你们的 Agent 能自动修 bug 吗」,你得知道它能修到什么程度)。

## 要做出什么

必做:

- Agent 循环:消息历史、工具调用、步数上限和单题美元上限、超限时强制提交当前 diff。
- 工具集(ACI):`view`(带行号、按行区间看文件)、`search`(包装 `grep -rn` 或 ripgrep,结果截断并提示总数)、`edit`(字符串替换,要求 old 串在文件里唯一,改完自动 `python -m py_compile` 检查语法,失败就回滚并把报错还给模型)、`bash`(非交互、有超时、输出截头截尾)、`submit`。
- 运行环境:每道题用该题对应的 SWE-bench 实例镜像起一个容器,仓库在 `/testbed`,Agent 的所有命令通过 `docker exec` 在容器里执行。
- 评测流水线:固定种子分层抽 50 题 → 并行跑 Agent → 生成 predictions → 官方 harness 判分 → 汇总通过率、成本、步数。
- 对照基线:同一个模型、同样 50 题,跑一遍 mini-swe-agent,当作「最简 bash-only 脚手架」的参照。
- 失败分析:每道失败题读完轨迹,归到定位错、改错、改对但测试不认、超步数、环境问题等类别。

加分:

- 消融实验:去掉 lint 回滚、去掉行号、把 `edit` 换成纯 bash 的 `sed`,看通过率和成本各变多少。
- 先复现再修:让 Agent 第一步写一个复现脚本,跑出报错后再改代码,修完再跑一次,对比有无这一步的差异。
- Agentless 风格的固定流程版本,与自主循环版本对比。
- 在 SWE-bench Pro 的公开子集上抽题跑一小批,看分数掉多少。

不做什么:不做 IDE 插件,不做多语言(只做 Python 仓库),不刷全量 500 题,不提交排行榜(官方要求技术报告、pass@1、不用 hints,50 题子集也不符合),不调用联网搜索。

## 架构

<figure>
<svg viewBox="0 0 640 410" role="img" aria-label="Mender 架构图:本机只写代码,云服务器上 runner 为每题启动实例容器,Agent 通过 ACI 工具在容器里操作,产出 patch 后由官方 harness 在新容器里判分">
  <rect x="0" y="0" width="640" height="410" fill="var(--paper-raised)" rx="6"/>
  <defs><marker id="md4a" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="var(--ink-soft)"/></marker></defs>
  <rect x="20" y="20" width="120" height="56" fill="none" stroke="var(--rule)"/>
  <text x="80" y="43" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">本机 Mac</text>
  <text x="80" y="63" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">写代码 + SSH</text>
  <line x1="140" y1="48" x2="168" y2="48" stroke="var(--ink-soft)" stroke-dasharray="4 3" marker-end="url(#md4a)"/>
  <rect x="170" y="12" width="455" height="386" fill="none" stroke="var(--rule)" stroke-dasharray="6 4"/>
  <text x="185" y="32" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">云服务器 x86_64 · 8 vCPU · 32GB · 150GB 盘 · Docker</text>
  <rect x="185" y="46" width="170" height="52" fill="none" stroke="var(--rule)"/>
  <text x="270" y="68" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">runner</text>
  <text x="270" y="87" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">50 题 · 并行 4</text>
  <line x1="270" y1="98" x2="270" y2="122" stroke="var(--ink-soft)" marker-end="url(#md4a)"/>
  <rect x="185" y="124" width="230" height="136" fill="var(--mem-wash)" stroke="var(--mem)"/>
  <text x="200" y="146" font-family="var(--font-mono)" font-size="12" fill="var(--mem)">Mender Agent 循环</text>
  <text x="200" y="170" font-family="var(--font-mono)" font-size="11" fill="var(--mem)">issue 描述 → LLM</text>
  <text x="200" y="190" font-family="var(--font-mono)" font-size="11" fill="var(--mem)">→ 一个工具调用</text>
  <text x="200" y="210" font-family="var(--font-mono)" font-size="11" fill="var(--mem)">→ 截断后的观察</text>
  <text x="200" y="230" font-family="var(--font-mono)" font-size="11" fill="var(--mem)">步数 / 美元上限</text>
  <text x="200" y="250" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">轨迹写 JSONL</text>
  <line x1="415" y1="180" x2="443" y2="180" stroke="var(--ink-soft)" marker-end="url(#md4a)"/>
  <line x1="443" y1="205" x2="415" y2="205" stroke="var(--ink-soft)" marker-end="url(#md4a)"/>
  <rect x="445" y="124" width="165" height="136" fill="var(--compute-wash)" stroke="var(--compute)"/>
  <text x="527" y="146" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--compute)">实例容器</text>
  <text x="458" y="170" font-family="var(--font-mono)" font-size="11" fill="var(--compute)">view · search</text>
  <text x="458" y="190" font-family="var(--font-mono)" font-size="11" fill="var(--compute)">edit + 语法检查</text>
  <text x="458" y="210" font-family="var(--font-mono)" font-size="11" fill="var(--compute)">bash(超时)</text>
  <text x="458" y="230" font-family="var(--font-mono)" font-size="11" fill="var(--compute)">/testbed 仓库</text>
  <text x="458" y="250" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">看不到隐藏测试</text>
  <line x1="527" y1="260" x2="527" y2="288" stroke="var(--ink-soft)" marker-end="url(#md4a)"/>
  <text x="535" y="280" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">git diff</text>
  <rect x="445" y="290" width="165" height="44" fill="none" stroke="var(--rule)"/>
  <text x="527" y="317" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">predictions.jsonl</text>
  <line x1="445" y1="312" x2="417" y2="312" stroke="var(--ink-soft)" marker-end="url(#md4a)"/>
  <rect x="185" y="282" width="230" height="60" fill="var(--compute-wash)" stroke="var(--compute)"/>
  <text x="300" y="305" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--compute)">官方 harness(新容器)</text>
  <text x="300" y="327" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--compute)">FAIL_TO_PASS + PASS_TO_PASS</text>
  <line x1="300" y1="342" x2="300" y2="358" stroke="var(--ink-soft)" marker-end="url(#md4a)"/>
  <rect x="185" y="360" width="425" height="30" fill="none" stroke="var(--rule)"/>
  <text x="397" y="380" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">results.json → 通过率 · 单题成本 · 失败分类报告</text>
</svg>
<figcaption>虚线框里的东西都跑在租来的云服务器上。Agent 干活的容器和判分的容器是两个,判分容器才会打上隐藏测试,Agent 从头到尾看不到它们。</figcaption>
</figure>

第一个取舍:工具要多精细。mini-swe-agent 证明了强模型只用 bash 也能拿高分,那为什么还要写 `view` 和 `edit`?我的理由是成本和稳定性,不是能力上限。`cat` 一个 2000 行的 Django 文件会把几万 token 塞进上下文,带行号的区间查看能省下大头;`sed -i` 改错一个缩进,Python 文件直接坏掉,模型要花好几步才发现,而 `edit` 自带语法检查能当场回滚。这些是假设,消融实验就是用来验证它们的。

第二个取舍:Agent 也在实例容器里跑命令。SWE-bench 每道题都有现成的镜像(数据集里的 `image` 字段,形如 `swebench/sweb.eval.x86_64.<实例名>`),依赖都装好了,conda 环境叫 `testbed`。Agent 在同一个环境里跑测试,看到的报错和判分时一致,不会出现「我本地能过、判分不过」的环境差异。mini-swe-agent 的做法也是把 `subprocess.run` 换成 `docker exec`,每条命令独立执行,不维护一个长期的 shell 会话,这个设计我建议直接学过来。

第三个取舍:本机不跑评测。官方 README 建议用 x86_64 机器、至少 120GB 空闲磁盘、16GB 内存、8 核,`arm64` 支持仍是实验性的。站长的 2019 款 Intel MacBook 架构是对的,但没装 Docker,磁盘和内存也达不到这个建议值,硬跑只会和浏览器、IDE 抢内存。所以代码在本机写,通过 SSH 或 VS Code Remote 连到云服务器上跑。

## 分阶段计划

| 周 | 目标 | 产出 | 怎么算完成 |
| --- | --- | --- | --- |
| 1 | 环境打通 | 云服务器、Docker、SWE-bench 安装,抽好 50 题 | 用 gold patch 跑通官方 harness,50 题全部判为解决;记下镜像拉取时间和磁盘占用 |
| 2 | Agent v0 | 循环 + bash + submit,只用一个工具 | 在 10 题开发子集上跑完,harness 能读你的 predictions |
| 3 | ACI 工具 | view / search / edit + 语法检查、输出截断 | 每个工具有单测;10 题开发子集上和 v0 对比通过率和 token |
| 4 | 第一次全量 | 50 题跑分,mini-swe-agent 同模型基线 | 两份 `results.json`,成本表,初版失败清单 |
| 5 | 失败分析与迭代 | 失败分类表,针对前两类的改动 | 每类至少 3 个轨迹证据;改动只在开发子集上调,不看全量题的失败细节 |
| 6 | 第二次全量 + 统计 | 50 题重跑,配对比较 | McNemar 或 bootstrap 给出改动前后的差异和区间 |
| 7 | 消融(加分) | 去掉某个工具或某步骤的对比表 | 每个消融项都有通过率、单题成本、平均步数 |
| 8 | 包装 | README、技术报告、轨迹公开 | 别人照 README 能在自己的云服务器上复现判分 |

第 5 周那条规则很重要:开发子集(10 题)用来调,评测子集(40 题,或者你另抽的 50 题)只用来最后测。如果你看着全量 50 题的失败轨迹改 prompt,分数会涨,但那是在拟合这 50 道题。

## 验收指标

| 指标 | 怎么测 | 目标 |
| --- | --- | --- |
| 通过率(% resolved) | 官方 harness 的 `results.json` | 报告数字和 Wilson 区间;50 题的区间很宽,别把 2 个点的差异当进步 |
| 与基线的差 | 同模型同题的 mini-swe-agent,配对比较 | 报告差多少、是否显著;没赢也照实写,分析为什么 |
| 单题成本 | 每题 token × 价格表,含失败题 | 写中位数和 P90,注明模型、价格、查证日期 |
| 平均步数 / 墙钟时间 | 轨迹统计 | 只报分布,用来解释成本 |
| 空 patch 率 | 没有任何改动或 patch 打不上的题 | 越低越好,每一题都要解释 |
| 失败分类覆盖 | 每道失败题都有归类 | 100%,一题都不漏 |
| 规则合规 | 自查 SWE-bench 提交 checklist | pass@1、不用 `hints_text`、不用隐藏测试、不联网 |

公开基线怎么用:swebench.com 的 bash-only 榜单是用 mini-swe-agent 跑各家模型,口径统一,最适合当参照。2026-10-15 查到的几条(Verified 全 500 题,mini-swe-agent v2.0.0,2026-02-17 提交):DeepSeek V3.2 (high) 70.0%、单题平均 $0.448、平均 88.5 次调用;Claude 4.5 Haiku (high) 66.6%、$0.331;GPT 5 mini 56.2%、$0.047。这些数字是全量 500 题,你是 50 题子集,只能看量级,不能直接比。真正的对照是你自己在同 50 题上跑的 mini-swe-agent。

## 最终产出

- GitHub 仓库:Agent、工具、runner、抽题脚本、分析脚本,外加一份「在云服务器上从零复现」的文档。
- 技术报告:方法、50 题的抽样方式、通过率和区间、成本、消融、失败分类,以及 Verified 已被指出存在测试缺陷和污染的局限说明。
- 公开轨迹:每道题的完整 JSONL,别人能逐题检查你没有偷看测试。
- 技术文章:「100 行 bash-only 和 600 行带 ACI 的 Agent,差在哪」,用你的消融数据说话。
- 加分:给 mini-swe-agent 或 SWE-bench 提文档或小修复 PR,内容来自你复现时真实遇到的问题。

## 难点和坑

钱和机器。按 Vantage 2026-10-15 查到的 AWS us-east-1 按需价,m6i.2xlarge(8 vCPU、32GiB)$0.384/小时,c6i.2xlarge(8 vCPU、16GiB)$0.34/小时。整个项目算 40 小时开机,约 $15;再挂一块 150GB 的 gp3 盘,按 AWS 页面示例费率 $0.08/GB-月,约 $12/月,而且停机也照收,项目结束记得删盘。API 费用按公开榜单的量级估,单题 $0.05–0.5,50 题一轮 $2.5–25,算上开发子集反复跑和两三轮全量,$40–120 比较现实。用 `deepseek-flash` 这类便宜模型迭代,最后再用强模型跑一轮。

不想租整台机器的话有两个云端评测选项,都只管判分,不管 Agent 运行。一是 Modal:SWE-bench 文档给了 `--modal true` 的跑法,Modal 的 Starter 方案每月送 $30 额度,CPU 按 $0.0000131/物理核/秒计费(2026-10-15 查证)。二是官方的 sb-cli,把 predictions 提交到 SWE-bench 的云端评测,但文档里 `swe-bench_verified` 的 `test` 划分示例配额只有 1 次,说明它是给最终提交用的,不适合反复迭代。Agent 本身仍然需要一个能起容器的环境,所以我的建议还是租一台机器。

国内网络。实例镜像都在 Docker Hub 上,国内的云服务器拉 Docker Hub 经常失败或极慢,50 个镜像可能拖上很久。直接选海外区域的服务器,省掉配镜像加速的麻烦。另外 SWE-bench 当前主分支的 v5 CLI 构建镜像要先克隆一个 `swe-bench-tasks` 任务仓库,README 里有命令,版本更新快,开工那天以 README 为准。

判分结果会被缓存。官方 README 写得很清楚:harness 按 `run_id` 和 `instance_id` 缓存结果,同一个 `run_id` 重新提交不同的 patch,它会直接复用第一次的结果。你改了 Agent 重跑却发现分数一分没变,多半是这个原因。每次评测用新的 `run_id`,比如带上 git commit 哈希。

隐藏测试泄露。数据集里有 `test_patch`、`FAIL_TO_PASS`、`eval_script` 和 `hints_text` 字段,eval_script 里甚至直接包含测试补丁。写 runner 时只把 `problem_statement` 交给 Agent,其他字段一律不进 prompt。容器里也要确认那些测试文件还是旧版本。官方提交 checklist 明确要求不用隐藏测试、不用 hints、单次尝试,我们不提交排行榜,也按这个标准来,否则数字没意义。

输出爆上下文。Django 跑一次测试会打出几千行,`pip install -e .` 的日志更长。bash 工具必须截断:保留开头 50 行和结尾 100 行,中间写「省略了 N 行」。不截断的话一道题跑到第 20 步上下文就满了,成本也翻几倍。

改对了但判错。OpenAI 的审查说 Verified 里相当比例的失败题测试过严,比如测试要求了题目描述里根本没提的实现细节。失败分析时会遇到「我的 patch 逻辑上没错,只是和原始修复的写法不同」,这一类要单独归类,并在报告里给出例子,不要悄悄当成 Agent 的错,也不要拿它给自己的分数找补。

Agent 跑偏去改测试。模型发现测试不过,有时会去改测试文件让它通过。判分时 harness 会用官方测试覆盖,所以这种 patch 不会作弊成功,但它浪费步数。在 system prompt 里说明不要修改测试,并在 `edit` 工具里对 `tests/` 路径给出提醒。

## 面试里怎么讲

示范讲法:「我想搞清楚代码 Agent 的脚手架设计到底影响多大,所以没用框架,从零写了一个,叫 Mender。问题定义用的是 SWE-bench Verified,我按难度分层抽了 50 题,用官方 Docker harness 判分。方案上我实现了带行号的查看、唯一匹配的字符串替换编辑、改完自动语法检查,Agent 在每道题的官方镜像里执行命令。数据方面,第一轮通过率是 X%,同模型的 mini-swe-agent 是 Y%,单题成本中位数分别是多少。失败分析发现最多的是定位错误,我加了先写复现脚本的步骤,第二轮在配对检验下提高了多少。取舍上,消融实验显示语法检查回滚主要省的是步数和钱,对通过率影响不大;行号查看对大文件的仓库帮助最明显。我也在报告里写了 Verified 的局限,OpenAI 今年 2 月指出它的测试缺陷和污染问题,所以我把『改对但测试不认』单独归了一类。」X、Y 和所有数字换成你自己的。

<details>
<summary>50 道题能说明什么?统计上站得住吗?</summary>

50 题的通过率,95% 置信区间宽度通常在正负十几个百分点,所以我不会拿单次 50 题的分数和别人的全量分数比。我用它做两件事:同题配对比较(同一道题改动前后谁对谁错,用 McNemar 检验),配对能消掉题目难度差异,比两个独立比例的比较灵敏得多;另一件是失败分析,50 道题我能每一道都读完轨迹,这是跑 500 题做不到的。如果要更强的结论,下一步是扩到 Verified 全量或者换到 SWE-bench Pro 公开子集。

</details>

<details>
<summary>你的 Agent 和 mini-swe-agent、SWE-agent 比,设计上有什么不同?</summary>

mini-swe-agent 只有 bash,线性历史,每条命令独立执行,我学了后两点,因为它们让轨迹干净、容易在容器里执行。我和它的区别是加了少量 ACI 工具,这一点更接近 SWE-agent 的思路,但比 SWE-agent 少得多。我的结论来自消融数据:哪些工具值得留,哪些可以删。Agentless 的固定流程我也做了一个版本对比,它更便宜、更可预测,自主循环在需要多轮试错的题上更好。

</details>

<details>
<summary>如果要把这个 Agent 用在公司内部仓库上,还缺什么?</summary>

SWE-bench 的题目有一个隐含前提:issue 写得清楚,而且有测试能判对错。公司内部的 issue 经常两者都没有。要落地至少还缺这些:一个按仓库定制的测试运行入口和超时策略;权限和沙箱,Agent 不能碰生产凭据;人工审查环节,输出是 MR 而不是直接合并;内部评测集,从历史已修复的 bug 里按 SWE-bench 的方法造题,这样才能知道它在你们的代码上到底有多少成功率。

</details>

## 前置知识

- Day 8–12:function calling、手写 Agent 循环、ReAct、工具设计、失败模式。
- Day 30–31、33:错误分析、建测试集、轨迹评测。
- Day 38:成本与延迟。
- Day 40:最小权限与沙箱。
- Day 41:Docker 与云服务器部署。
- Day 62–63:harness 设计、长任务的上下文管理。
- Day 69:评测里的统计学(区间、McNemar、bootstrap)。
- Day 73:从 SWE-bench 学 benchmark 设计。
- Day 89:Coding Agent 内部,读 SWE-agent / OpenHands 的设计。

## 参考资料

- [SWE-bench 论文(Jimenez 等,2023)](https://arxiv.org/abs/2310.06770):任务定义、判分方式,2,294 题与 12 个仓库的来源。
- [SWE-bench 仓库](https://github.com/SWE-bench/SWE-bench):官方 harness、硬件建议、结果缓存说明,开工以它的 README 为准。
- [SWE-bench 评测指南](https://github.com/SWE-bench/SWE-bench/blob/main/docs/guides/evaluation.md):含 Modal 云端评测的命令。
- [SWE-bench Verified 数据集](https://huggingface.co/datasets/SWE-bench/SWE-bench_Verified):500 题,`difficulty` 字段用来分层抽样,`image` 字段是实例镜像名。
- [SWE-bench 提交 checklist](https://github.com/SWE-bench/experiments/blob/main/checklist.md):pass@1、不用 hints 和隐藏测试的规则,我们自评也按它来。
- [SWE-bench 排行榜](https://www.swebench.com/):bash-only 榜单是统一用 mini-swe-agent 跑的,看量级和单题成本。
- [sb-cli](https://github.com/SWE-bench/sb-cli):官方云端评测工具,了解它的配额限制。
- [SWE-agent 论文(Yang 等,2024)](https://arxiv.org/abs/2405.15793):ACI 的概念和各项设计的消融,Mender 的工具设计主要参考它。
- [mini-swe-agent](https://github.com/SWE-agent/mini-swe-agent):100 行级别的 bash-only 基线,同模型对照用,也值得通读源码。
- [Agentless 论文(Xia 等,2024)](https://arxiv.org/abs/2407.01489):固定三段流程的思路,做对照版本时参考。
- [OpenHands 论文(Wang 等,2024)](https://arxiv.org/abs/2407.16741) 和 [仓库](https://github.com/OpenHands/OpenHands):看一个完整开源平台的沙箱和运行时怎么设计。
- [Anthropic 的 SWE-bench 文章](https://www.anthropic.com/engineering/swe-bench-sonnet):一个极简脚手架加工具描述打磨的实例,写工具说明时参考。
- [SWE-bench Pro 论文(Deng 等,2025)](https://arxiv.org/abs/2509.16941):加分项要用的更难基准。
- [The Decoder 关于 OpenAI 停用 Verified 的报道](https://the-decoder.com/openai-wants-to-retire-the-ai-coding-benchmark-that-everyone-has-been-competing-on/):OpenAI 原文《Why we no longer evaluate SWE-bench Verified》的转述,原文在 openai.com,本文写作时 curl 访问返回 403,请自己用浏览器看原文。
- [Vantage 上的 m6i.2xlarge](https://instances.vantage.sh/aws/ec2/m6i.2xlarge) 和 [Modal 价格页](https://modal.com/pricing):租机器和云端评测的价格,开工前再查一次。
