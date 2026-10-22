---
title: 'Day 676 · Loupe(二十二):开源发布与作品包装'
description: '作品一收尾:写一份三十秒能看懂的 README,用 ADR 记下最重要的几个取舍(其中一篇来自昨天彩排踩的坑),再写一个发布前自查脚本,它第一次跑就抓出了测试里的假 key、被提交的 .env,还暴露了我自己正则里的一个 bug;最后是一键启动脚本、License、CHANGELOG,以及让模型扮演面试官给两版 30 秒讲法打分。'
pubDate: 2026-10-22
regime: none
tags: ['agent-loupe', 'readme', 'adr', 'open-source', 'portfolio', 'agent-zero']
series: 'agent-zero'
day: 676
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 675](/blog/agent-zero/day-675-loupe-deploy-2/) 把 Loupe 部署上了线:本机按线上的样子彩排,用 wrangler 验证 Pages 的 SPA 回退(顺手发现 `/* /index.html 200` 会被静默忽略),写了 Fly.io 和自己服务器两套后端配置,量出步骤接口一页 5000 条轻步骤中位数 89 ms、完整内容 200 ms,最后 `smoke.py` 八项全过。

功能做完了,也上线了,但到现在为止知道它的只有你自己。今天要做的是让一个陌生人在很短的时间里明白三件事:它是什么,做得怎么样,做它的人是怎么想问题的。

## 今天要解决的问题

学完今天,你应该能做到:

1. 写出 Loupe 的 README:第一屏一句话、动图、演示链接,往下是跑起来、架构、关键设计、性能、已知局限。
2. 用 ADR 记下三到四个取舍,每篇都写被放弃的方案和代价,其中至少一篇有你自己测出来的数据。
3. 写一个发布前自查脚本,把「README 缺节、性能表空着、仓库里有 key、`.env` 被提交、ADR 编号断了」这些事变成会失败的检查。
4. 准备一键启动脚本、License、CHANGELOG,以及三种长度的项目讲法,并让模型面试官给你的 30 秒版打一次分。

预计用时 3 小时,大半是写作。前置:[Day 491](/blog/agent-zero/day-491-readme-arch/)(README 和架构图)、[Day 519](/blog/agent-zero/day-519-senior-map/) 和 [Day 640](/blog/agent-zero/day-640-design-docs-1/)(ADR 和取舍的写法)、[Day 639](/blog/agent-zero/day-639-agentops-showcase/)(AgentOps 的包装)、[Day 675](/blog/agent-zero/day-675-loupe-deploy-2/)(今天 README 里的性能数字和 ADR 0003 的数据都来自它)。

学法提示:先对照文章逐行敲一遍(不复制粘贴)并跑通;第二天合上文章,把 README 的七个小节顺序和 `release_check.py` 的三类检查默写出来;做练习,做不出再展开参考答案,看完关掉自己重写一遍。

## 一个陌生人会怎么看你的仓库

先换位想一下。你在 GitHub 上随手点开一个别人的项目,会怎么看?大概是:看第一屏(标题、一句话、一张图),觉得有意思就点演示链接,还感兴趣就翻一下目录和测试,真要用或者真要面试这个人,才会去看设计文档。

面试官也一样,只是更没耐心:

- **README 第一屏,10 秒。** 他在判断「这是不是一个认真做的东西」。第一屏要是安装说明或者一大段背景,多半就关了。
- **演示站,30 秒到 2 分钟。** 随便点点,看能不能用、快不快、有没有报错。Day 675 那些部署工作就是为这一步。
- **代码和测试,1 分钟。** 目录清不清楚,有没有测试,CI 是不是绿的。
- **约了面试以后,ADR。** 他要准备问题,ADR 告诉他你做过哪些取舍,面试就围绕这些聊。

<figure>
<svg viewBox="0 0 640 240" role="img" aria-label="陌生人看仓库的四层:README 第一屏 10 秒、演示站 30 秒到 2 分钟、代码与测试 1 分钟、面试前看 ADR;越往后看的人越少">
  <rect x="0" y="0" width="640" height="240" fill="var(--paper-raised)" rx="6"/>
  <g font-family="var(--font-mono)" font-size="11">
    <rect x="20" y="30" width="600" height="34" fill="var(--mem-wash)" stroke="var(--mem)"/>
    <text x="32" y="51" fill="var(--mem)">README 第一屏 · 10 秒</text>
    <text x="608" y="51" text-anchor="end" fill="var(--ink-soft)">一句话 + 动图 + 演示链接</text>
    <rect x="20" y="74" width="460" height="34" fill="var(--mem-wash)" stroke="var(--mem)"/>
    <text x="32" y="95" fill="var(--mem)">演示站 · 30 秒到 2 分钟</text>
    <text x="468" y="95" text-anchor="end" fill="var(--ink-soft)">Day 675 的 smoke 8/8</text>
    <rect x="20" y="118" width="320" height="34" fill="var(--compute-wash)" stroke="var(--compute)"/>
    <text x="32" y="139" fill="var(--compute)">代码与测试 · 1 分钟</text>
    <text x="328" y="139" text-anchor="end" fill="var(--ink-soft)">CI 徽章、目录</text>
    <rect x="20" y="162" width="200" height="34" fill="var(--compute-wash)" stroke="var(--compute)"/>
    <text x="32" y="183" fill="var(--compute)">ADR · 面试前</text>
    <text x="208" y="183" text-anchor="end" fill="var(--ink-soft)">取舍、代价</text>
  </g>
  <text x="20" y="224" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">条越短,看到这一层的人越少;但越往下看的人,越是在认真考虑你</text>
</svg>
<figcaption>一个陌生人打开仓库以后的注意力漏斗。今天的产出按这四层从上往下准备,最上面一层投入回报最高。</figcaption>
</figure>

所以 README 的顺序就按这个漏斗排。一句话介绍放最上面,而且这句话里要有「和别人不一样的地方」。「一个 Agent 调试工具」是一句废话,「按时间轴回放每一步,两次运行逐步对比,从任意一步改提示词重跑,把失败步骤一键变成评测用例」才告诉了别人你做了什么。

## 第一步:README

[Day 491](/blog/agent-zero/day-491-readme-arch/) 给 SupportPilot 写过 README,结构一样,今天换成 Loupe 的内容。下面是完整版,放在仓库根目录。外层用四个反引号包着,因为 README 里面还有代码块:

````markdown
# Agent Loupe

**给 AI Agent 用的调试器:按时间轴回放每一步,两次运行逐步对比,从任意一步改提示词重跑,把失败步骤一键变成评测用例。**

![演示:从第 3 步改提示词重跑,自动跳到对比页](docs/demo.gif)

## 在线演示

https://loupe.example.com (只读样例,可以从任意一步重跑;每人每小时 5 次,全站每天有花费上限)

## 为什么做这个

调 Agent 最费时间的不是写代码,是搞清楚「第 14 步它为什么那么做」,以及「改了提示词以后从哪一步开始不一样」。现有的 trace 平台擅长看单次运行;Loupe 专注三件它们做得不够的事:

- **逐步对比**:用每一步的「决定」做签名,LCS 对齐两次运行,直接滚到第一处分歧。
- **从中间重跑**:第 N 步之前原样保留,工具结果从原运行回放(写操作永远不会真的执行),只重新调用模型。
- **失败变用例**:任意一步存成带快照的评测用例,批量跑 k 次算 pass^k,前后两批做回归对比。

## 五分钟跑起来

需要 Python 3.12 + [uv](https://docs.astral.sh/uv/)、Node 22 + pnpm,以及一个 OpenAI 兼容的模型 key(只有重跑和评测需要)。

```bash
git clone https://github.com/你的用户名/agent-loupe.git && cd agent-loupe
cp server/.env.example server/.env   # 填 LLM_BASE_URL / LLM_API_KEY / LLM_MODEL
./scripts/dev.sh                     # 后端 :8000,前端 :5173,第一次会导入 samples/ 里的样例
```

## 架构

```text
web/ (React 18 + TS + Vite + Zustand)  ──HTTP──>  server/ (FastAPI + SQLite,单进程)
  运行列表 / 时间轴 / 步骤详情                        导入器 -> runs + steps
  对比页 / 重跑对话框 / 评测页                        diff(LCS) / replay(cassette) / evalcases
                                                    guard(演示模式:只读、限流、每日花费上限)
```

## 关键设计

| 决定 | 为什么 | ADR |
| --- | --- | --- |
| LLM 步的签名用「这一步请求了哪些工具」,不用输入 | 输入是累积的历史,第一处分歧后全部对不上 | [0001](docs/adr/0001-llm-step-signature.md) |
| 评测用例存完整快照,不存 trace 引用 | trace 会过期、会被改;用例要自包含、不可变 | [0002](docs/adr/0002-eval-case-snapshot.md) |
| 关掉 uvicorn 的 proxy headers,客户端 IP 只由 client_ip 决定 | 两层都解析 X-Forwarded-For 时,本机实测伪造请求 8 次全放行 | [0003](docs/adr/0003-no-proxy-headers.md) |

## 性能

一万步合成 trace(`samples/synthetic_10k.jsonl`,固定随机种子)。接口用 `scripts/perf_api.py` 跑 5 次取中位数,前端方法见 `docs/perf.md`。

| 指标 | 本机(2019 款 Intel MBP,直连) | 线上演示站 |
| --- | --- | --- |
| 步骤接口 limit=5000 | 89 ms,278 KB | |
| 步骤接口 limit=5000&full=true | 200 ms,5295 KB | |
| 首屏时间(中位数) | | |
| 滚动 avgFps | | |
| 滚动 longFrames | | |

## 已知局限

- 对齐用 O(n·m) 的 LCS,两条几千步的运行对比会明显变慢。
- 重跑只回放工具结果,模型调用本身不可复现;一次重跑只能形成假设,验证要靠评测。
- 单进程 + SQLite,限流计数在内存里;多实例部署要先把计数挪到 Redis。
- 演示站靠 Pages 的 SPA 回退打开深层链接,`_redirects` 只在本机 wrangler 上验证过。

## License

MIT
````

<div class="line-notes">

- `# Agent Loupe` 标题就是项目名,不加副标题,副标题的活交给下一行。
- `**给 AI Agent 用的调试器` 这一行是整个 README 最重要的一句。四个动词(回放、对比、重跑、变用例)各对应一个功能,读的人不用往下翻就知道它做了什么。
- `![演示:从第 3 步改提示词重跑` 动图放第一屏。图片的替代文字写清楚动图里演示的是什么操作,图挂了或者读屏软件读到的时候也有信息。
- `## 在线演示` 演示链接紧跟在动图下面,括号里写清楚能做什么、限额是多少,免得访客点重跑被 429 了以为坏了。
- `## 为什么做这个` 不写「随着大模型的发展」这种开头。直接说看到了什么痛点,和现有工具差在哪。「现有的 trace 平台擅长看单次运行」是诚实的定位:Loupe 不是 Langfuse 的替代品,它专注几件它们做得不够的事。
- `- **逐步对比**` 三条,每条一句话说清解决什么问题,和一句话里的四个动词对应。
- `## 五分钟跑起来` 只有三条命令。这个承诺要靠下面的 `dev.sh` 兑现,写了做不到比不写更糟。
- `需要 Python 3.12` 前置写全,访客在 clone 之前就知道自己的机器能不能跑。
- `## 架构` 一张纯文本的图就够,GitHub 上任何地方都能正确显示。精致的架构图放到案例页。
- `## 关键设计` 一张表,每行一个决定、一句理由、一个 ADR 链接。招聘方不会读完 ADR,但会扫这一列「为什么」,看出你做过取舍。
- `| 关掉 uvicorn 的 proxy headers` 第三行来自昨天的彩排,理由那一栏写的是实测数字,不是推理。
- `## 性能` 先写测量方法和环境,再给表。没有方法的数字,有经验的面试官不会信。
- `| 步骤接口 limit=5000 | 89 ms,278 KB | |` 本机那一列是 Day 675 实测的;线上和前端那几行我还没量,**故意留空**。下面的自查脚本会拦住空表,宁可晚一天发也不编数字。
- `## 已知局限` 四条都是真实的,而且写了影响范围。最后一条是昨天新加的:`_redirects` 的结论只在本机验证过,这种「我知道我不确定什么」比装作什么都确定可信。
- `MIT` License 选哪个下面讲。

</div>

README 里还提到了 `server/.env.example`、`docs/demo.gif`、`docs/perf.md`,这几个今天一起补:`.env.example` 列出 Day 670 和 Day 674 用到的所有环境变量(值留空或写示例);`perf.md` 是 [Day 663](/blog/agent-zero/day-663-loupe-perf/) 的测量方法加你的结果;动图下面单独说。

**动图怎么录。** 录一段 10 到 15 秒的操作:在运行详情里点第 3 步,点「从这一步重跑」,改一句提示词,提交,自动跳到对比页,滚到第一处分歧,展开逐词 diff。macOS 自带的录屏(Shift+Command+5)录成 MOV,再转成 GIF,控制在 2 MB 以内,太大就降帧率、缩尺寸。[Day 208](/blog/agent-zero/day-208-cli-agent-4/) 给 CLI Agent 录过 demo.gif,方法一样。GitHub 的 README 也能直接放 MP4(拖进 issue 或 release 拿到链接),画质比 GIF 好得多。

## 第二步:ADR,把取舍写下来

ADR(Architecture Decision Record,架构决策记录)在 [Day 519](/blog/agent-zero/day-519-senior-map/) 第一次写过,[Day 640](/blog/agent-zero/day-640-design-docs-1/) 讲了取舍四要素。提醒一句它的规矩:一个决定一篇,固定「状态、背景、决定、后果」四节,编号递增,写完不改,决定变了就写一篇新的,把旧的标成「被取代」。

我从这几周里挑决定的标准是:**有不止一个合理的方案,而且选错了以后会造成实际问题。** 「用 React 还是 Vue」不满足第二条,不值得写。下面三篇,第三篇的数据是昨天彩排时测出来的,我先给它:

```markdown
# 0003 · 关掉 uvicorn 的 proxy headers,客户端 IP 只由 client_ip 决定

## 状态

已采纳(2026-10)

## 背景

演示站按客户端 IP 限流,`guard.client_ip` 按 `TRUST_PROXY` 的声明取 IP,有伪造头的单元测试。2026-10-22 本机彩排时,`TRUST_PROXY` 为空(声明前面没有代理),每次请求带一个不同的伪造 `X-Forwarded-For`,8 次重跑全部放行,限流失效。原因是 uvicorn 默认开着 proxy headers,对来自 127.0.0.1 的连接会先用 `X-Forwarded-For` 改写 `request.client.host`。

考虑过的方案:
1. 保留 uvicorn 的处理,把 `--forwarded-allow-ips` 配对,`client_ip` 只读 `request.client.host`。
2. 关掉 uvicorn 的处理(`--no-proxy-headers`),全部交给 `client_ip`。

## 决定

采用方案 2。启动入口 `server/scripts/start.sh` 固定带 `--no-proxy-headers`。

## 后果

- 好处:取 IP 的规则只有一处,有测试,部署平台换了只改 `TRUST_PROXY`。同样的 8 次伪造请求,改后第 6 次起返回 429。
- 代价:`request.client.host` 在代理后面永远是代理的地址,其他想用它的代码必须改调 `client_ip`。
- 代价:`request.url.scheme` 在代理后面是 http,以后要生成 https 的绝对链接需要自己处理 `X-Forwarded-Proto`。
- 守护它的是 `scripts/smoke.py` 第 6 项「伪造 X-Forwarded-For 绕不过限流」。
```

<div class="line-notes">

- `# 0003 · 关掉 uvicorn` 标题就是决定本身,一句话,看标题就知道选了什么。文件名 `docs/adr/0003-no-proxy-headers.md`,编号四位补零,下面的自查脚本靠它检查连续性。
- `## 状态` 已采纳、被取代、已废弃三选一,带上月份。
- `## 背景` 写当时面临的问题,要具体到能复现:哪天、什么条件、什么现象(8 次全放行)、为什么。
- `考虑过的方案:` 至少两个。只有一个方案的「决定」不需要 ADR。
- `1. 保留 uvicorn 的处理` 方案 1 不是错的,它也能工作。写出来是为了说明你知道有这条路。
- `## 决定` 一两句话,说选了哪个、落在哪个文件。
- `- 好处:取 IP 的规则只有一处` 好处也要带数据:改后第 6 次起 429。
- `- 代价:` 这是 ADR 最容易被省略、也最有价值的部分。选方案 2 意味着两件事变麻烦了,都写出来。以后有人想改回去,先看到这里。
- `- 守护它的是` 决定、理由、守护它的测试连在一起。有人删掉 `--no-proxy-headers`,smoke 第 6 项会失败,他会顺着找到这篇。

</div>

另外两篇。第一篇是 Day 667 的签名设计,第二篇是 Day 672 的用例快照:

```markdown
# 0001 · LLM 步的对齐签名用「决定」,不用输入

## 状态

已采纳(2026-10)

## 背景

对比页要把两次运行的步骤对齐。工具步用「工具名 + 规范化参数摘要」做签名很自然。LLM 步的输入是累积的对话历史,前面任何一步的输出有一点不同,后面每个 LLM 步的输入都不同。用输入做签名,第一处分歧之后的所有 LLM 步都对不上。

考虑过的方案:
1. 用完整输入的摘要:上面说的问题。
2. 只用本轮新增的最后一条消息:工具结果里的时间戳这种小差异就会让它对不上。
3. 用模型这一步的决定:请求了哪些工具(按名字排序),或者直接回答。

## 决定

采用方案 3。签名形如 `llm:chat:calculate+get_weather` 或 `llm:chat:<answer>`。签名相同但输出内容不同时标 `content_changed`,界面显示「相同(内容有变)」。

## 后果

- 好处:对齐反映的是行为结构,一眼看出「B 在第 3 步多要了一次计算」。
- 代价:两次最终回答措辞完全不同也会被对齐为 same,必须靠 `content_changed` 提示。
- 以后要支持「按语义对比回答」,加在内容 diff 那一层,不改签名。
```

<div class="line-notes">

- `1. 用完整输入的摘要:上面说的问题。` 三个方案每个都写了为什么不行,被放弃的理由和被选中的理由一样重要。
- `采用方案 3。签名形如` 给出签名的具体样子,读的人不用去翻代码就能想象。
- `- 代价:两次最终回答措辞完全不同` 这个代价是真实的:你在对比页上会看到两个意思相反的回答被标成「相同」,所以才有了 `content_changed`。
- `- 以后要支持` 给后来人的提示:要扩展往哪里加,别动哪里。

</div>

```markdown
# 0002 · 评测用例存完整快照,不存 trace 引用

## 状态

已采纳(2026-10)

## 背景

用户把某次运行的第 N 步存成评测用例。最省事的做法是只存 `(run_id, step_idx)` 和断言,跑用例时再去原 trace 里取输入。

## 决定

用例保存完整快照:第 N 步发给模型的 messages 和 tools、原模型名、原运行全部工具步的输入输出(作为回放磁带)。跑用例不依赖原 trace 是否还在。

## 后果

- 好处:trace 被删、被重新导入都不影响用例;快照可以单独脱敏;用例不可变,结果可比。
- 代价:每条用例几 KB 到几百 KB,几百条在几十 MB 量级,SQLite 可以接受。
- 代价:原 trace 修正了数据,用例不会跟着变,要手动重新存。
```

<div class="line-notes">

- `最省事的做法是只存` 背景里先承认省事的方案,再说为什么不用,读起来更可信。
- `- 代价:每条用例几 KB 到几百 KB` 代价给了量级,能判断它在什么规模下会变成问题。

</div>

还有一些值得记的小决定,练习里会补一篇:深层链接为什么用 `/* / 200`;cassette miss 为什么把错误返回给模型而不是中止(Day 669 到 670,如果你在 Day 670 实测过 miss 数,把数字写进去,ADR 有了真实数据说服力完全不一样);为什么用 SQLite 不用 Postgres。

## 第三步:发布前自查脚本

发布前要检查的东西很多,而且都是「人一兴奋就忘」的那种。我把它们写成一个脚本,发布前跑,有一项不过就退出码 1。它检查三类东西:README 的结构、ADR 的格式、仓库里不该有的东西。

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

# 1. README 必须有这几节,而且「性能」一节不能留空格子
readme_path = ROOT / "README.md"
readme = readme_path.read_text(encoding="utf-8") if readme_path.exists() else ""
for h in ["## 在线演示", "## 五分钟跑起来", "## 架构", "## 关键设计", "## 性能", "## 已知局限"]:
    if h not in readme:
        problems.append(f"README 缺少「{h}」")
perf = readme.split("## 性能", 1)[-1].split("\n## ", 1)[0]
if re.search(r"\|[ \t]*\|", perf):
    problems.append("README 的性能表还有空格子,测完再发")

# 2. ADR 编号连续、每篇都有四个小节
adrs = sorted((ROOT / "docs" / "adr").glob("[0-9][0-9][0-9][0-9]-*.md"))
if not adrs:
    problems.append("docs/adr/ 下一篇 ADR 都没有")
for i, p in enumerate(adrs, 1):
    if not p.name.startswith(f"{i:04d}-"):
        problems.append(f"ADR 编号不连续:{p.name}")
    text = p.read_text(encoding="utf-8")
    for sec in ["## 状态", "## 背景", "## 决定", "## 后果"]:
        if sec not in text:
            problems.append(f"{p.name} 缺少「{sec}」")

# 3. git 要提交的文件里不能有 key、大文件、数据库和 .env;样例必须扫描干净
files = subprocess.run(["git", "ls-files"], cwd=ROOT, capture_output=True, text=True).stdout.split()
for f in files:
    p = ROOT / f
    if not p.is_file():
        continue
    if p.stat().st_size > 2_000_000 and not f.startswith("samples/synthetic_"):
        problems.append(f"大文件 {f}({p.stat().st_size // 1024} KB)")
    if p.suffix in {".py", ".ts", ".tsx", ".md", ".toml", ".json", ".yml", ".env", ".txt", ".sh"}:
        if re.search(r"\bsk-[A-Za-z0-9]{20,}", p.read_text(encoding="utf-8", errors="ignore")):
            problems.append(f"{f} 里疑似有 API key")
    if f.endswith((".db", ".env")):
        problems.append(f"{f} 不该提交")
for p in sorted((ROOT / "samples").glob("*.jsonl")):
    if p.stat().st_size > 5_000_000:  # 合成的一万步压测样例,不是真实数据
        continue
    if left := leftovers(p.read_text(encoding="utf-8")):
        problems.append(f"样例 {p.name} 没脱干净:{left[:2]}")
if not (ROOT / "LICENSE").exists():
    problems.append("没有 LICENSE")

print("\n".join(problems) if problems else "全部通过")
sys.exit(1 if problems else 0)
```

<div class="line-notes">

- `ROOT = pathlib.Path(__file__).resolve().parent.parent` 脚本在 `scripts/` 下,上两级就是仓库根目录。`__file__` 相当于 Node 的 `__filename`。这样从哪个目录运行都能找到 README。
- `sys.path.insert(0, str(ROOT / "server"))` 把 `server/` 加进模块搜索路径,下一行才能 `from loupe.redact import ...`。相当于临时改了 Node 的模块解析根目录。
- `from loupe.redact import leftovers  # noqa: E402` [Day 674](/blog/agent-zero/day-674-loupe-deploy-1/) 的残留扫描函数,这里复用它扫样例。`# noqa: E402` 告诉 Ruff「import 不在文件顶部是故意的」。
- `readme = readme_path.read_text(encoding="utf-8") if readme_path.exists() else ""` README 不存在时当成空字符串,后面的检查会把每一节都报成缺失,而不是直接崩溃。
- `for h in ["## 在线演示"` 六个必须有的小节,和上面 README 的结构一一对应。
- `perf = readme.split("## 性能", 1)[-1].split("\n## ", 1)[0]` 截出「## 性能」到下一个二级标题之间的内容。`split(x, 1)` 只切一刀,`[-1]` 取后半段。
- `if re.search(r"\|[ \t]*\|", perf):` 找表格里的空格子,也就是两个竖线之间只有空格。这一行我第一次写错了,下面专门讲。
- `adrs = sorted((ROOT / "docs" / "adr").glob("[0-9][0-9][0-9][0-9]-*.md"))` 只认四位数字开头的文件,排序后就是编号顺序。
- `for i, p in enumerate(adrs, 1):` `enumerate(..., 1)` 从 1 开始计数,相当于 JS 的 `arr.forEach((p, i) => ...)` 但 i 从 1 起。
- `if not p.name.startswith(f"{i:04d}-"):` 第 i 篇的文件名必须以 `000i-` 开头。`{i:04d}` 是补零到四位,`3` 变成 `0003`。
- `files = subprocess.run(["git", "ls-files"]` 只检查 git 跟踪的文件,也就是真正会被推上去的那些。本地的 `.venv`、`node_modules` 不在里面。
- `if p.stat().st_size > 2_000_000` 超过 2 MB 的文件报出来,演示动图也别超过这个数。`2_000_000` 里的下划线只是为了好读,相当于 JS 的 `2_000_000` 数字分隔符。
- `re.search(r"\bsk-[A-Za-z0-9]{20,}"` `sk-` 后面跟 20 个以上字母数字,就是长得像 OpenAI 兼容 key 的东西。
- `if f.endswith((".db", ".env")):` `endswith` 可以传一个元组,任意一个匹配就算。
- `for p in sorted((ROOT / "samples").glob("*.jsonl")):` 每个样例都用 Day 674 的 `leftovers` 扫一遍邮箱、手机号、key。
- `if left := leftovers(` `:=` 是海象运算符,赋值的同时判断,相当于 JS 里 `if ((left = leftovers(...)).length)`。
- `if not (ROOT / "LICENSE").exists():` 没有 License 的公开仓库,别人在法律上不能用你的代码。

</div>

### 第一次跑,它抓出了什么

在仓库根目录先 `git init`,把文件加进暂存区(不需要 commit,`git ls-files` 列的是暂存区里的文件),然后跑:

```bash
cd agent-loupe
git init -q
git add -A
uv run --project server python scripts/release_check.py
```

<div class="line-notes">

- `git init -q` 在当前目录建 git 仓库,`-q` 不打印提示。[Day 56](/blog/agent-zero/day-056-git-1/) 讲过 init、add 和暂存区。
- `git add -A` 把所有没被 `.gitignore` 排除的文件放进暂存区。
- `uv run --project server python scripts/release_check.py` 借 `server/` 的虚拟环境跑,因为脚本要 import `loupe`。

</div>

那时我还没写 README、ADR 和 LICENSE,真实输出:

```text
README 缺少「## 在线演示」
README 缺少「## 五分钟跑起来」
README 缺少「## 架构」
README 缺少「## 关键设计」
README 缺少「## 性能」
README 缺少「## 已知局限」
docs/adr/ 下一篇 ADR 都没有
deploy/rehearsal.env 不该提交
server/tests/test_redact.py 里疑似有 API key
没有 LICENSE
```

缺 README、ADR、LICENSE 是预料之中的。另外两条是我自己都没想到的。

**`deploy/rehearsal.env 不该提交`。** 这是昨天彩排用的变量文件,里面只有一个 `rehearsal-admin` 这种练习用的 token,没有真 key。但规则是对的:`.env` 文件就是用来放密钥的,今天没放,明天有人顺手加一行 `LLM_API_KEY=...` 就推上去了。修法是把它从 git 里移出去,提交一份 `.example` 版本。这里有个坑我也踩了:只往 `.gitignore` 里加一行是不够的。

```bash
echo 'deploy/*.env' >> .gitignore
git add -A
git ls-files deploy
```

```text
deploy/empty-prices.json
deploy/rehearsal.env
```

`.gitignore` 只管还没被跟踪的文件,已经 `git add` 过的文件照样在。要用 `git rm --cached` 把它从暂存区拿掉(`--cached` 表示只从 git 里删,磁盘上的文件不动),再提交一份去掉真值的示例:

```bash
git rm -q --cached deploy/rehearsal.env
sed 's/^LOUPE_ADMIN_TOKEN=.*/LOUPE_ADMIN_TOKEN=换成随便一个字符串/' deploy/rehearsal.env > deploy/rehearsal.env.example
git add -A
git ls-files deploy
```

<div class="line-notes">

- `git rm -q --cached deploy/rehearsal.env` 从暂存区删掉,本地文件还在,彩排照样能用。
- `sed 's/^LOUPE_ADMIN_TOKEN=.*/LOUPE_ADMIN_TOKEN=换成随便一个字符串/'` 把 token 那一行的值换成提示文字,其余原样,生成示例文件。`^` 表示行首,`.*` 表示后面所有字符。

</div>

```text
deploy/empty-prices.json
deploy/rehearsal.env.example
```

**`server/tests/test_redact.py 里疑似有 API key`。** 那是 Day 674 脱敏测试里的假 key `sk-abcdefghijklmnop1234`。它是假的,但长得太像真的了:GitHub 的密钥扫描、很多公司的推送钩子都会对它报警,有的直接拒绝推送。修法是把它拆开写,运行时拼起来,源码里就不存在完整的字符串了:

```python
    fake_key = "sk-" + "abcdefghijklmnop1234"  # 拆开写,免得被当成真 key
```

<div class="line-notes">

- `fake_key = "sk-" + "abcdefghijklmnop1234"` 运行时得到的字符串和原来一模一样,测试照常通过(实跑 `1 passed in 0.03s`),但源码里搜不到完整的 `sk-` 加 20 个字符了。

</div>

这种事只有自动检查才发现得了,你自己不会想到去翻测试文件。

### 我自己正则里的 bug

补齐 README(性能表里线上和前端几行留空)、三篇 ADR、LICENSE 以后再跑,剩下一条:

```text
README 的性能表还有空格子,测完再发
```

这正是它该拦住的。但我做练习 2 的时候(把空格子都填上「待测」想看看会怎样),发现它**还是**报这一条。不对劲,填满了怎么还有空格子?

我一开始的写法是 `re.search(r"\|\s*\|", ...)`。问题在 `\s`:它不只匹配空格,还匹配换行。表格每一行以 `|` 结尾、下一行以 `|` 开头,中间是一个换行符,`|\n|` 正好被当成了一个空格子。也就是说,只要性能一节里有表格,这条检查**永远**失败,不管填没填。拿两行完全填满的表格验证一下:

```bash
python3 -c "
import re
print(re.findall(r'\|\s*\|', '| a | b |\n| c | d |'))
print(re.findall(r'\|[ \t]*\|', '| a | b |\n| c | d |'))"
```

<div class="line-notes">

- `re.findall(r'\|\s*\|'` 旧写法,`\s` 包括空格、制表符和换行。
- `re.findall(r'\|[ \t]*\|'` 新写法,方括号里只列空格和制表符,不跨行。

</div>

```text
['|\n|']
[]
```

旧写法在一张填满的表里找到了一个「空格子」,就是那个换行。改成 `[ \t]*` 以后,填满的表不再误报,真的空格子照样能抓到。一个永远失败的检查和一个永远通过的检查一样没用,而且更糟:它会让你习惯性地忽略它。所以检查脚本本身也要测,至少用一个「应该通过」和一个「应该失败」的输入各跑一次。

## 第四步:一键启动、CI、License 和版本

### dev.sh

README 承诺了「三条命令跑起来」,第三条是这个脚本:

```bash
#!/usr/bin/env bash
# agent-loupe/scripts/dev.sh  本地一键起前后端:./scripts/dev.sh(没装 pnpm 时 PM=npm ./scripts/dev.sh)
set -euo pipefail
cd "$(dirname "$0")/.."
PM="${PM:-pnpm}"
(cd server && uv sync -q && uv run python -m scripts.seed_demo ../samples)
(cd server && exec uv run uvicorn loupe.app:create_app --factory --port 8000 --workers 1 --no-proxy-headers) &
API=$!
trap 'kill $API 2>/dev/null' EXIT
cd web && "$PM" install --silent && "$PM" run dev
```

<div class="line-notes">

- `#!/usr/bin/env bash` 用 PATH 里找到的 bash 执行。`chmod +x scripts/dev.sh` 以后才能直接 `./scripts/dev.sh`。
- `set -euo pipefail` `-e` 出错就停,`-u` 用了没定义的变量就报错,`-o pipefail` 管道里任何一段失败整体就算失败。三个合起来是写 bash 脚本的标准开头。
- `cd "$(dirname "$0")/.."` `$0` 是脚本自己的路径,`dirname` 取目录,再上一级就是仓库根。从哪里调用这个脚本都一样。
- `PM="${PM:-pnpm}"` 包管理器默认 pnpm,可以用环境变量换成 npm。我本机没装 pnpm,实跑用的是 `PM=npm`。
- `(cd server && uv sync -q && uv run python -m scripts.seed_demo ../samples)` 括号开一个子 shell,里面 `cd` 不影响外面。同步依赖,再导入样例(库里有数据就跳过)。
- `(cd server && exec uv run uvicorn` 末尾的 `&` 让后端在后台跑,脚本继续往下走。参数和 Day 675 的 `start.sh` 一样,只有一个进程,不信 proxy headers。
- `API=$!` `$!` 是刚放到后台的那个进程的进程号,记下来,退出时要关掉它。
- `trap 'kill $API 2>/dev/null' EXIT` 脚本退出时(包括你按 Ctrl+C)执行这条命令,把后端一起关掉,免得 8000 端口被一个孤儿进程占着。
- `cd web && "$PM" install --silent && "$PM" run dev` 前台起前端,你在终端里看到的是 Vite 的输出。

</div>

删掉数据库从干净状态跑一次:

```bash
cd agent-loupe
rm -f server/loupe.db
PM=npm ./scripts/dev.sh
```

```text
导入 weather_demo.jsonl demo-weather 12 步
INFO:     Started server process [32058]
INFO:     Waiting for application startup.
INFO:     Application startup complete.
INFO:     Uvicorn running on http://127.0.0.1:8000 (Press CTRL+C to quit)
> dev
> vite
  VITE v8.3.5  ready in 365 ms
  ➜  Local:   http://localhost:5173/
```

另开终端,`curl -s localhost:8000/api/health` 返回 `{"ok":true,"pid":32058,"runs":1}`,`localhost:5173` 返回 200。

关于 `trap` 有一点要说清楚。我测试时是在另一个终端里 `kill -TERM` 这个脚本的进程,结果后端(8000)被 trap 关掉了,但前端的 vite 还活着,5173 还能访问。原因是 `kill` 只把信号发给了 bash 这一个进程,vite 是 npm 的子进程,没收到。你在终端里按 Ctrl+C 不会这样,因为终端会把信号发给整个前台进程组,vite 也在里面。所以平时用 Ctrl+C 没问题;如果你要在别的脚本里调 `dev.sh` 再杀掉它,记得杀整个进程组。

### CI(这段没实跑)

CI 用 GitHub Actions,[Day 375](/blog/agent-zero/day-375-eval-project-2/) 和 [Day 427](/blog/agent-zero/day-427-ci-cd/) 写过。我没有把这个仓库推到 GitHub 上跑,下面的 action 版本是 2026 年 10 月在各自仓库的 releases 页查到的最新主版本:

```yaml
# agent-loupe/.github/workflows/ci.yml
name: ci
on: [push, pull_request]
jobs:
  server:
    runs-on: ubuntu-latest
    defaults: { run: { working-directory: server } }
    steps:
      - uses: actions/checkout@v7
      - uses: astral-sh/setup-uv@v10
      - run: uv sync --frozen
      - run: uv run pytest -q
      - run: cd .. && uv run --project server python scripts/release_check.py
  web:
    runs-on: ubuntu-latest
    defaults: { run: { working-directory: web } }
    steps:
      - uses: actions/checkout@v7
      - uses: pnpm/action-setup@v6
      - uses: actions/setup-node@v7
        with: { node-version: 22, cache: pnpm, cache-dependency-path: web/pnpm-lock.yaml }
      - run: pnpm install --frozen-lockfile
      - run: pnpm build
```

<div class="line-notes">

- `on: [push, pull_request]` 每次推送和每个 PR 都跑。
- `defaults: { run: { working-directory: server } }` 这个 job 里所有 `run` 都在 `server/` 下执行。
- `uses: actions/checkout@v7` 把代码拉下来。`@v7` 是主版本标签,会自动跟到 v7 的最新小版本。
- `uses: astral-sh/setup-uv@v10` 装 uv。
- `run: uv sync --frozen` 严格按 `uv.lock` 装,锁文件和 pyproject 对不上就失败,防止「我本地能跑」。
- `run: cd .. && uv run --project server python scripts/release_check.py` 把发布前自查也放进 CI。注意它现在会因为性能表空着而失败,这是对的:CI 是红的就提醒你还没测完。如果你想先让 CI 绿着开发,可以只在打 tag 时跑这一步。
- `uses: pnpm/action-setup@v6` 装 pnpm。版本默认读 `package.json` 里的 `packageManager` 字段,建议在那里写死。
- `cache-dependency-path: web/pnpm-lock.yaml` monorepo 里锁文件不在根目录,要告诉缓存去哪找。
- `run: pnpm build` 构建脚本里有 `tsc --noEmit`,类型检查不过就红。

</div>

README 顶部可以加 CI 状态徽章(Actions 页面里点工作流,右上角菜单 Create status badge)。一个绿色的徽章是最便宜的「这个项目有人认真维护」的信号。

### License、CHANGELOG 和第一个版本

**License。** 作品集项目最常见的两个:

- **MIT**:最短、最宽松,别人基本可以随便用,只要保留版权声明。前端和工具类项目多数用它。
- **Apache-2.0**:同样宽松,多了明确的专利授权条款,企业法务更喜欢。

两个都行,我用 MIT。[choosealicense.com](https://choosealicense.com/) 是 GitHub 出的选择指南,中文可以看 [Gitee 开源指南的许可证一节](https://gitee.com/opensource-guide/guide/learning-and-using/licenses.html)。在 GitHub 网页上新建一个叫 `LICENSE` 的文件,会出现「Choose a license template」按钮,选完自动填好年份和名字。MIT 全文 21 行,开头是这样:

```text
MIT License

Copyright (c) 2026 你的名字

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
...
```

<div class="line-notes">

- `Copyright (c) 2026 你的名字` 唯一要改的一行:年份和你的名字。其余文字一个字都不要改,改了就不是标准 MIT 了,别人的法务工具认不出来。
- `...` 后面的条款照抄模板,完整文本在仓库的 `LICENSE` 里。

</div>

**CHANGELOG。** 按 [Keep a Changelog](https://keepachangelog.com/) 的格式,每个版本分「新增」「变更」「修复」:

```markdown
# Changelog

## [0.1.0] - 2026-10-22
### 新增
- trace 导入:OTLP JSON、Langfuse 导出、轻量 SDK
- 时间轴与步骤详情:token、成本、上下文占用
- 两次运行逐步对比(LCS 对齐 + 按词 diff)
- 从任意 LLM 步改参数重跑(cassette 回放、只读工具白名单)
- 失败步骤存为评测用例,批量运行、pass^k、回归对比、导出评测集
- 演示模式:只读、限流、每日花费上限;部署配置(Fly.io / systemd + Caddy)
```

<div class="line-notes">

- `## [0.1.0] - 2026-10-22` 版本号加日期。版本号用[语义化版本](https://semver.org/):主版本.次版本.修订号。接口还不稳定时用 `0.x`,`0.1.0` 就是「第一个能用的版本」。
- `### 新增` 第一个版本只有新增,把这几周的功能各写一行,每行对应作品篇的一两天。

</div>

**打 tag 发布(这段没实跑,要先 commit 并推到 GitHub):**

```bash
git commit -m "v0.1.0:第一个公开版本"
git tag -a v0.1.0 -m "v0.1.0:第一个公开版本"
git push origin main v0.1.0
```

<div class="line-notes">

- `git tag -a v0.1.0` 打一个带说明的标签,标签指向当前这个 commit。
- `git push origin main v0.1.0` 推分支的同时把标签也推上去,标签默认不会跟着 `git push` 走。推完在 GitHub 的 Releases 页面基于这个 tag 新建 release,正文贴 CHANGELOG 里这一节。

</div>

## 第五步:视频、案例页、简历和面试讲法

这一部分是写作,没有代码。但它决定了前面那些代码有没有人看,所以别跳过。

**两分钟演示视频。** 动图只能演示一个操作,视频能讲一个完整的故事。两分钟是上限:

| 时间 | 画面 | 旁白要点 |
| --- | --- | --- |
| 0:00–0:15 | 一条失败的 Agent 运行,时间轴上第 3 步标红 | 调 Agent 最费时间的,是搞清楚它在哪一步、为什么走偏 |
| 0:15–0:35 | 点开第 3 步:messages、工具调用、上下文占用条 | 模型在这一步做了什么决定,上下文被谁占满 |
| 0:35–1:00 | 点「从这一步重跑」,改一句系统提示词,提交 | 前面的步骤保留,工具结果回放,写操作不会执行 |
| 1:00–1:20 | 自动跳到对比页,滚到第一处分歧,展开逐词 diff | 一眼看出从哪一步开始不一样 |
| 1:20–1:40 | 把这一步存成评测用例,批量跑 3 次看 pass^3 | 一次重跑只是假设,评测才是证据 |
| 1:40–2:00 | README 的关键设计表、性能表、GitHub 链接 | 设计取舍和测量方法都在仓库里 |

录之前把演示数据准备好,每个操作排练两遍。旁白可以后配,或者只配字幕。B 站和 YouTube 各发一份,README 和案例页都放链接。

**个人网站上的案例页。** README 是给工程师看的,案例页是给所有人看的,包括不太懂技术的招聘方。它是一个故事,结构是:一句话和链接 → 问题(一个具体场景)→ 我做了什么(四个功能各一句加截图)→ 三个关键取舍(各两三句,链接 ADR)→ 数据(性能表、一次真实的重跑实验)→ 如果再做一次。最后一节很多人不写,但它最能体现成长,比如「我会在第一天就给 Step 加 `source` 字段,而不是把回放来源塞进 tags」「我会从第一天就在本机按线上的样子彩排,而不是最后一周才发现 uvicorn 在偷偷读代理头」。

**简历上怎么写。** 每条一个「做了什么 + 用什么方法 + 结果或数据」:

- 独立设计并开源 Agent Loupe,一个 AI Agent 运行记录调试器(React + TypeScript + FastAPI),支持 trace 回放、逐步对比、从任意步骤重跑和评测用例沉淀;在线演示 + GitHub。
- 设计基于「模型决策」签名的 LCS 对齐,对比两次 Agent 运行并定位第一处行为分歧。
- 公开演示站按 IP 与全站滑动窗口限流、按当日实际花费设上限;部署彩排中发现并修复 uvicorn 默认信任代理头导致限流可被伪造绕过的问题。

数字只写你自己测过的。没测过的不写。

**面试时三种长度。** 面试官说「介绍一下你的项目」,先给 30 秒版,看反应再决定展开多少。3 分钟版在 30 秒版基础上挑两个技术点讲「一开始以为很简单,做了才发现不对」的故事,我推荐签名设计(ADR 0001)和代理头(ADR 0003)。15 分钟版按「问题和定位 → 数据模型 → 三个取舍 → 一次真实实验 → 演示站安全 → 已知局限」讲,可以边讲边打开演示站。30 秒版怎么写,练习 4 让模型面试官帮你打分。

最可能被深挖的问题,每个都先自己口头答一遍,录下来听,答得磕磕绊绊的回去看对应那一天:

| 问题 | 去哪找答案 |
| --- | --- |
| 对齐算法的复杂度?两万步的运行怎么办? | Day 668;ADR 0001;README 已知局限 |
| 为什么不直接用 Langfuse / LangSmith? | README「为什么做这个」;Day 649 的竞品表 |
| 重跑时写操作工具怎么处理? | Day 669–670 |
| 模型不确定,重跑的结论怎么信? | Day 670;Day 673 的实测 |
| 评测用例为什么存快照? | ADR 0002 |
| 演示站被刷了怎么办?限流怎么取 IP? | Day 674;Day 675;ADR 0003 |
| 前端怎么渲染一万步不卡?怎么测的? | Day 663;README 性能表 |

## 今天的文件

| 零件(今天哪一步) | 文件 |
| --- | --- |
| 第一步 | `README.md`、`server/.env.example`、`docs/perf.md`、`docs/demo.gif` |
| 第二步 | `docs/adr/0001-llm-step-signature.md`、`0002-eval-case-snapshot.md`、`0003-no-proxy-headers.md` |
| 第三步 | `scripts/release_check.py`;修改 `.gitignore`、`server/tests/test_redact.py`;新增 `deploy/rehearsal.env.example` |
| 第四步 | `scripts/dev.sh`、`.github/workflows/ci.yml`、`LICENSE`、`CHANGELOG.md` |
| 练习 | `docs/adr/0004-spa-fallback-rule.md`、`scripts/mock_interviewer.py` |

今天只有练习 4 调了模型,两次请求共 298 个输入 token、158 个输出 token,按 `.env` 里的价格(未命中 2 元、输出 8 元每百万 token)算是 298 × 2 / 1,000,000 + 158 × 8 / 1,000,000 ≈ 0.0019 元。

## 动手练习

**练习 1:补一篇 ADR 0004。** 把昨天发现的「深层链接用 `/* / 200`」写成 ADR,放在 `docs/adr/0004-spa-fallback-rule.md`,再跑一次 `release_check.py` 确认编号和格式都对。顺便故意把 0003 改名成 0004 跑一次,看编号检查会说什么。

<details><summary>参考答案</summary>

```markdown
# 0004 · 深层链接用 `/* / 200`,并由 smoke 测试守护

## 状态

已采纳(2026-10)

## 背景

前端是单页应用,`/diff?a=..&b=..` 这种链接在 Pages 上没有对应文件。2026-10-22 用 wrangler 4.151.3 本机模拟时发现:常见写法 `/* /index.html 200` 被判定为死循环并忽略(`Parsed 0 valid redirect rules`);深层链接能打开,只是因为根目录没有 `404.html` 时 Pages 默认按 SPA 处理。加一个 `404.html` 后,深层链接返回 404。

考虑过的方案:
1. 不写 `_redirects`,依赖 Pages 的默认 SPA 行为。
2. 写 `/* /index.html 200`。
3. 写 `/* / 200`。

## 决定

采用方案 3。本机模拟中,有没有 `404.html` 深层链接都返回 200。

## 后果

- 好处:不依赖「根目录没有 404.html」这个隐含条件。
- 代价:任何不存在的路径都返回 index.html,写错的 JS 路径会得到 200 和一段 HTML,报错信息是 MIME 类型不对而不是 404。
- 代价:只在本机 wrangler 上验证过,线上行为靠 `scripts/smoke.py` 第 7 项每次部署后确认。
```

<div class="line-notes">

- `2026-10-22 用 wrangler 4.151.3 本机模拟时发现` 写清楚在什么环境下验证的。这个结论的可信度取决于环境,读的人要知道。
- `1. 不写` 方案 1 其实也能工作,写出来是为了说明为什么不想依赖隐含条件。
- `- 代价:只在本机 wrangler 上验证过` 诚实写出验证的边界,并指出谁在线上守护它。

</div>

```bash
git add -A
uv run --project server python scripts/release_check.py
git mv docs/adr/0003-no-proxy-headers.md docs/adr/0004-no-proxy-headers.md   # 先撤掉上面加的 0004 再试
```

我实跑的顺序是:先在只有 0001 到 0003 时把 0003 改名成 0004,输出

```text
README 的性能表还有空格子,测完再发
ADR 编号不连续:0004-no-proxy-headers.md
```

改回来、加上真正的 0004 以后再跑,只剩性能表那一条,编号和四个小节都通过。

</details>

**练习 2:观察会发生什么。** 把 README 性能表里所有空格子都填上「待测」,再跑 `release_check.py`。它会通过吗?如果通过了,说明什么?怎么补?

<details><summary>参考答案</summary>

用修好正则以后的版本跑(没修之前它会误报,原因见正文「我自己正则里的 bug」):

```bash
cp README.md /tmp/README.bak            # 先备份
# 把五行里的空格子都改成「待测」
uv run --project server python scripts/release_check.py; echo "exit=$?"
cp /tmp/README.bak README.md            # 改回来
```

```text
全部通过
exit=0
```

通过了。检查脚本只认「格子是不是空的」,不认「格子里是不是真数字」。一个想偷懒的人(或者赶着发布的你)填个「待测」就能骗过它。补法是再加一条,在性能一节里搜常见的占位词:

```python
if m := re.search(r"待测|待补|TBD|TODO|\?\?", perf):
    problems.append(f"README 的性能表里有占位词「{m.group(0)}」,测完再发")
```

<div class="line-notes">

- `re.search(r"待测|待补|TBD|TODO|\?\?", perf)` `|` 是「或」,任意一个出现就算。`\?\?` 匹配两个问号,有人喜欢写 `??` 占位。
- `m.group(0)` 匹配到的那个词,写进报错里,一眼知道是哪个占位词。

</div>

加上这条,只填一个「待测」再跑:

```text
README 的性能表还有空格子,测完再发
README 的性能表里有占位词「待测」,测完再发
exit=1
```

这说明自动检查只能挡住你预料到的偷懒方式。它的价值是把最常见的几种忘记变成硬约束,而不是保证数字是真的。数字是不是真测出来的,最后靠的是你在 README 里写的测量方法能不能被别人复现。

</details>

**练习 3:一万步的压测样例该不该进仓库?** `samples/synthetic_10k.jsonl` 有 10 MB,现在被 git 跟踪着。把它移出 git,README 里写清楚怎么生成;比较移出前后仓库里文件的总大小,并验证重新生成的文件和原来一模一样。

<details><summary>参考答案</summary>

```bash
cd agent-loupe
echo "前: $(git ls-files | xargs du -ck | tail -1)"
echo 'samples/synthetic_*.jsonl' >> .gitignore
git rm -q --cached samples/synthetic_10k.jsonl
git add -A
echo "后: $(git ls-files | xargs du -ck | tail -1)"
rm samples/synthetic_10k.jsonl
python3 samples/gen_synthetic.py 10000 > samples/synthetic_10k.jsonl
md5 -q samples/synthetic_10k.jsonl
python3 samples/gen_synthetic.py 10000 | md5 -q
```

<div class="line-notes">

- `git ls-files | xargs du -ck | tail -1` 把所有跟踪的文件交给 `du` 算大小,`-k` 以 KB 为单位,`-c` 最后加一行总计,`tail -1` 只要总计那行。
- `git rm -q --cached samples/synthetic_10k.jsonl` 和正文里 `.env` 那次一样,光改 `.gitignore` 不够。
- `python3 samples/gen_synthetic.py 10000 > samples/synthetic_10k.jsonl` [Day 663](/blog/agent-zero/day-663-loupe-perf/) 的生成脚本,固定随机种子 42。
- `md5 -q` macOS 上算文件指纹的命令(Linux 上是 `md5sum`)。两次指纹一样,说明生成是确定的。

</div>

```text
前: 10908	total
后: 284	total
61f80cba0f7e59fedecba1e8c1be26b0
61f80cba0f7e59fedecba1e8c1be26b0
```

仓库从约 10.9 MB 降到 284 KB,而且生成脚本每次造出来的文件指纹相同,所以「性能表是用这份数据测的」依然可以复现。README 的性能一节写一行:`python3 samples/gen_synthetic.py 10000 > samples/synthetic_10k.jsonl`。原则是:能由代码确定地生成的数据,提交生成它的代码,不提交数据。`release_check.py` 里对 `samples/synthetic_` 的大文件豁免也可以删掉了。

</details>

**练习 4(开放题):让模型当面试官,给你的 30 秒版打分。** 写两版 30 秒讲法(一版随手写的,一版按「痛点 → 三个功能 → 演示和安全」写的),让模型扮演面试官打 1 到 5 分,给一句理由和一个最想追问的问题。

<details><summary>参考答案</summary>

这里没有用 [Day 135](/blog/agent-zero/day-135-llm-client-1/) 起的 `common/llm.py`,因为 `agent-loupe` 是独立仓库,不依赖课程练习仓库。直接用 openai SDK,一次性脚本用 `uv run --with` 临时装依赖:

```python
# agent-loupe/scripts/mock_interviewer.py  让模型扮演面试官,给两版 30 秒讲法打分并追问一句
import json
import os
import sys

from dotenv import load_dotenv
from openai import OpenAI

load_dotenv(sys.argv[1] if len(sys.argv) > 1 else ".env")
client = OpenAI(base_url=os.environ["LLM_BASE_URL"], api_key=os.environ["LLM_API_KEY"])
extra = json.loads(os.environ.get("LLM_EXTRA_BODY", "{}"))

PITCHES = {
    "A": "我做了一个 Agent 调试工具,用 React 和 FastAPI 写的,功能挺多的,有时间轴、对比、重跑、评测,还部署上线了。",
    "B": ("我做了 Agent Loupe,一个给 AI Agent 用的调试器。调 Agent 最难的是看清它在哪一步走偏,"
          "改了提示词以后又不知道从哪一步开始变了。它能把两次运行按每一步的决定对齐,直接跳到第一处分歧;"
          "能从任意一步改提示词重跑,工具结果从原运行回放,写操作不会真执行;还能把失败的一步存成评测用例。"
          "有在线演示,限流和每日花费上限都做了,代码开源。"),
}
SYSTEM = ("你是一位招 AI Agent 工程师的面试官。候选人用 30 秒介绍作品。"
          "只输出一行 JSON:{\"score\": 1到5的整数, \"reason\": \"一句话\", \"follow_up\": \"你最想追问的一个问题\"}")

total_in = total_out = 0
for name, pitch in PITCHES.items():
    r = client.chat.completions.create(
        model=os.environ["LLM_MODEL"], temperature=0, extra_body=extra,
        messages=[{"role": "system", "content": SYSTEM}, {"role": "user", "content": pitch}],
        response_format={"type": "json_object"})
    total_in += r.usage.prompt_tokens
    total_out += r.usage.completion_tokens
    print(name, len(pitch), "字 ->", r.choices[0].message.content)
print(f"token:输入 {total_in},输出 {total_out}")
```

<div class="line-notes">

- `load_dotenv(sys.argv[1] if len(sys.argv) > 1 else ".env")` 从命令行指定的文件读 `LLM_BASE_URL`、`LLM_API_KEY`、`LLM_MODEL`。实跑用的是 DeepSeek,`LLM_MODEL=deepseek-flash`。
- `extra = json.loads(os.environ.get("LLM_EXTRA_BODY", "{}"))` 课程统一的写法,DeepSeek 这里是 `{"thinking": {"type": "disabled"}}`,关掉思考省钱。
- `PITCHES = {` 两版讲法。A 是我第一次随手说的,65 个字;B 按痛点、三个功能、演示和安全的顺序写,176 个字,念出来大约 30 秒。
- `SYSTEM = (` 让模型只输出一行 JSON,三个字段,方便程序处理也方便比较。
- `temperature=0` 打分要尽量稳定,同一版讲法多跑几次分数别乱跳。
- `response_format={"type": "json_object"}` JSON 模式,[Day 148](/blog/agent-zero/day-148-structured-2/) 讲过。
- `total_in += r.usage.prompt_tokens` 累计 token,算花费用。

</div>

```bash
uv run --no-project --with openai --with python-dotenv python scripts/mock_interviewer.py .env
```

<div class="line-notes">

- `--no-project --with openai --with python-dotenv` 不用当前项目的环境,临时装这两个包跑一次。这两个包不进 `server/` 的依赖,因为线上服务不需要它们。

</div>

```text
A 65 字 -> {"score": 3, "reason": "项目完整且已上线,但30秒内只罗列功能,缺少技术难点、个人贡献和量化结果,深度信息不足。", "follow_up": "时间轴和重跑功能里,你如何处理 Agent 多步执行中不确定性的状态回放?能具体讲讲实现方案吗?"}
B 176 字 -> {"score": 4, "reason": "痛点抓得准,分歧对齐、分支重跑、失败转评测用例三个功能形成闭环,且考虑了回放安全与成本控制,工程完成度明显高于一般作品。", "follow_up": "两次运行按步骤对齐时,如果 Agent 在中间多出或跳过了一步,你怎么判断哪一步才是真正的第一处分歧?"}
token:输入 298,输出 158
```

A 从 3 分到 B 的 4 分,理由对得上:A 只罗列功能,B 讲清了痛点和三个功能怎么形成闭环。更有用的是追问:B 被追问的「多出或跳过一步时怎么判断第一处分歧」,正好是 ADR 0001 和 Day 668 的 LCS 对齐要回答的问题。这说明好的 30 秒版会把面试官引到你准备最充分的地方。分数本身别太当真,一个模型、一次、temperature 0 的打分只能当参考;真正有用的是它的追问,把每个追问都准备一个 1 分钟的回答。

</details>

**验收标准:** README 有七个小节,第一屏有一句话、动图和演示链接;至少三篇 ADR,每篇都写了被放弃的方案和代价;`release_check.py` 在你的仓库里只剩「性能表还有空格子」这一类(或者全部通过,如果你都测完了),并且你能讲清楚 `\s` 和 `[ \t]` 的区别为什么重要;`dev.sh` 从删掉数据库的干净状态能起来;你能不看稿讲出 30 秒版和 3 分钟版。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| README 第一屏 | 打开仓库不滚动就能看到的部分,决定访客是否继续看 |
| ADR | 架构决策记录,一个决定一篇,写状态、背景、决定、后果,只追加不修改 |
| 发布前自查(release check) | 把发布前容易忘的事写成会失败的检查,有一项不过就退出码 1 |
| `git rm --cached` | 只从 git 的暂存区删掉文件,磁盘上的文件不动;已跟踪的文件光加 `.gitignore` 删不掉 |
| `trap` | bash 里注册「收到某个信号或退出时执行什么」,相当于给脚本加一个 finally |
| 状态徽章(badge) | README 里显示 CI 是否通过的小图标 |
| MIT / Apache-2.0 | 两种宽松的开源许可证,后者多了明确的专利授权 |
| 语义化版本(SemVer) | 主版本.次版本.修订号,`0.x` 表示接口还不稳定 |
| Keep a Changelog | 按版本记录变更的约定格式,每版分新增、变更、修复 |
| 案例页(case study) | 个人网站上讲一个项目的故事:问题、做法、取舍、数据、反思 |

## 常见误区

**README 第一屏是安装说明。** 访客还不知道这是什么,不会想装它。第一屏放一句话、动图和演示链接,安装放后面。

**「已知局限」不写,怕显得不完美。** 能说清自己系统在哪里会出问题,是资深工程师最重要的信号之一。Loupe 的四条局限都是真实的,而且写了影响范围。

**ADR 只写选了什么。** 那只是功能说明。被放弃的方案和代价才是 ADR 的价值,最好再加上你测出来的数据。

**性能数字先随便填一个,以后再测。** 以后通常不会测,面试官问你怎么测的,你答不上来。空着,让自查脚本拦住你。

**以为加了 `.gitignore` 就不会提交了。** 已经被跟踪的文件不受影响,今天 `deploy/rehearsal.env` 就是这样,要 `git rm --cached`。

**测试里放长得像真 key 的假数据。** 会触发密钥扫描,甚至被拒绝推送。拆开拼接写。

**检查脚本本身不测。** 我的 `\|\s*\|` 因为 `\s` 匹配换行,对任何表格都永远失败。写完检查,用一个应该通过、一个应该失败的输入各跑一次。

**把能生成的数据提交进仓库。** 10 MB 的合成样例由固定种子的脚本生成,提交脚本就够了,仓库从 10.9 MB 降到 284 KB。

**简历上写「熟悉」「了解」。** 写你做了什么、用了什么方法、得到了什么结果,有测过的数字就写数字。

## 学习资料

### 文档与文章

- [GitHub Docs · About READMEs](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/about-readmes):README 放在哪、怎么显示、相对链接怎么写,10 分钟。
- [Michael Nygard · Documenting Architecture Decisions](https://www.cognitect.com/blog/2011/11/15/documenting-architecture-decisions):ADR 的原始文章,很短,15 分钟。
- [adr.github.io](https://adr.github.io/):ADR 的模板、工具和实践汇总,挑一个模板看看,15 分钟。
- [Gitee 开源指南 · 认识开源许可证](https://gitee.com/opensource-guide/guide/learning-and-using/licenses.html):中文讲 MIT、Apache、GPL 的区别,15 分钟;英文可以看 [choosealicense.com](https://choosealicense.com/)。
- [Keep a Changelog](https://keepachangelog.com/) 和 [Semantic Versioning](https://semver.org/):两份都很短,各 10 分钟。
- [GitHub Docs · About releases](https://docs.github.com/en/repositories/releasing-projects-on-github/about-releases) 和 [Pro Git · 打标签](https://git-scm.com/book/zh/v2/Git-%E5%9F%BA%E7%A1%80-%E6%89%93%E6%A0%87%E7%AD%BE):tag 和 release 的关系,中文那篇讲清了为什么 `git push` 默认不推标签,20 分钟。
- [Open Source Guides](https://opensource.guide/):GitHub 出的开源指南,看「Starting an Open Source Project」一篇,20 分钟。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1ngzrYREyS&autoplay=0&high_quality=1" title="开源协议这么多,我们应如何选择?" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>__阿岳__ · 开源协议这么多,我们应如何选择? · 9 分钟,把常见开源协议的区别和怎么选讲清楚,看完能自己判断用 MIT 还是 Apache。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV15uVZzzEZs&autoplay=0&high_quality=1" title="90天从0到1.9K Star!开源项目作者教你快速涨Star技巧|推广github项目" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>vladelaina · 90天从0到1.9K Star!开源项目作者教你快速涨Star技巧|推广github项目 · 6 分钟,一个开源作者讲 README、演示和推广的实际经验。</figcaption>
</figure>

- zidea2015《详解人类与人工智能协作开发中架构决策记录 (ADR)》(BV12K7w6ZEHv,16 分钟):中文讲 ADR 的少见视频,结合了和 AI 一起写代码的场景。
- 此次是_《如何发布你的第一个GitHub项目?【GitHub开发者之旅】》(BV1H5xeeQELn,2 分钟):第一次在 GitHub 上建仓库、推代码的完整操作。

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/E6NO0rgFub4" title="How To Write a USEFUL README On Github" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Learn Fast Make Things · How To Write a USEFUL README On Github · 8 分钟,一个实用 README 有哪些部分、顺序怎么排。</figcaption>
</figure>

- CodeOpinion《Architecture Decision Records (ADR) as a LOG that answers "WHY?"》(YouTube `6H6zfCNeqek`):把 ADR 当成「回答为什么」的日志来用,和今天的写法一致。

### 书籍

- Karl Fogel《Producing Open Source Software》第 2 版(O'Reilly 首版 2005,第 2 版在作者网站 [producingoss.com](https://producingoss.com/) 免费阅读):第 2 章「Getting Started」讲一个开源项目起步时该准备什么:使命说明、功能列表、开发状态、文档。

### 开源项目与代码

- [othneildrew/Best-README-Template](https://github.com/othneildrew/Best-README-Template):很流行的 README 模板,对照看哪些部分适合你。
- [joelparkerhenderson/architecture-decision-record](https://github.com/joelparkerhenderson/architecture-decision-record):ADR 的各种模板和大量示例。
- [npryce/adr-tools](https://github.com/npryce/adr-tools):管理 ADR 编号和「被取代」关系的命令行小工具。

## 自测

1. README 第一屏应该放什么?为什么不放安装说明?

<details><summary>答案</summary>

一句话介绍(要有和别人不一样的地方)、一张动图、演示链接。访客打开仓库时还不知道这是什么,不会对安装感兴趣;第一屏的任务是让他在十秒内判断值不值得继续看。

</details>

2. 一篇 ADR 最容易被省略、也最有价值的是哪部分?ADR 0003 的这部分写了什么?

<details><summary>答案</summary>

后果里的代价,以及背景里被放弃的方案。ADR 0003 写了两个代价:代理后面的 `request.client.host` 永远是代理地址,其他代码必须改调 `client_ip`;`request.url.scheme` 在代理后面是 http,生成 https 链接要自己处理 `X-Forwarded-Proto`。

</details>

3. `deploy/rehearsal.env` 已经加进了 `.gitignore`,为什么 `git ls-files` 里还有它?

<details><summary>答案</summary>

`.gitignore` 只对还没被跟踪的文件生效。它之前已经被 `git add` 过,git 会继续跟踪。要用 `git rm --cached deploy/rehearsal.env` 把它从暂存区拿掉,磁盘上的文件保留。

</details>

4. `re.search(r"\|\s*\|", perf)` 为什么对一张填满的表也会报「有空格子」?

<details><summary>答案</summary>

`\s` 匹配包括换行在内的空白字符。表格一行以 `|` 结尾、下一行以 `|` 开头,中间的 `|\n|` 被当成了一个空格子,所以只要有两行以上的表格就永远失败。改成 `[ \t]*` 只匹配空格和制表符,不跨行。

</details>

5. 为什么测试里的假 key 要写成 `"sk-" + "abcdefghijklmnop1234"`?

<details><summary>答案</summary>

完整的 `sk-` 加 20 个字母数字会被 GitHub 密钥扫描、公司推送钩子和我们自己的 `release_check.py` 当成真 key 报警,甚至拒绝推送。拆开拼接后运行时值不变,测试照常通过,但源码里不存在完整的字符串。

</details>

6. 面试题:面试官说「Langfuse 和 LangSmith 都有 trace 和 playground,你这个项目的价值在哪?」你怎么回答?

<details><summary>答案</summary>

先承认它们的长处:成熟的 trace 采集、看单次运行、单次 LLM 调用的 playground、数据集和评测。然后讲 Loupe 聚焦的空白:两次运行在步骤粒度的对齐对比;从中间某一步带着修改继续跑完整个 Agent 循环,而不只是重发一次 LLM 调用;重跑时工具结果的回放和写操作保护;从失败步骤直接沉淀成带快照的用例。再讲作为作品的价值:它说明我理解 Agent 运行时的内部结构,能做出取舍并写进 ADR,能做完整的前后端和安全的公开部署,并且在部署彩排里自己发现过限流被绕过这种真实问题。最后可以说,如果在团队里,我会考虑把这些能力做成基于 Langfuse 数据的插件,而不是另起炉灶,这本身也是一个取舍。

</details>

## 明天预告

作品一 Agent Loupe 到这里完成了。明天 Day 677 开始作品二:**BillSleuth 开题,为什么选计费争议,订阅计费十分钟入门**。客户问「为什么这个月多扣了钱」,Agent 自己去查订阅、发票、扣款,复算金额,找出原因。动手之前得先懂计费本身,所以明天只讲两个概念:计费周期和按天折算,用 Python 手算一张中途升级的账单。
