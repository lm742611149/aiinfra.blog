---
title: 'Day 60 · 结业:60 天回顾、能力自检清单、接下来怎么进阶'
description: '最后一天。对照 880 条真实 JD 的技能频次给自己打一次勾,清点作品,把没达标的地方排进补课计划;然后讲接下来三个月值得深入的方向:LoRA 轻量微调、浏览器 Agent、Agent Harness 与可观测、语音 Agent、开源贡献,附一个最小可跑的浏览器 Agent 和一个 LoRA 实验的设计模板,以及长期跟进这个领域的信息源。'
pubDate: 2026-10-12
regime: none
tags: ['graduation', 'self-assessment', 'lora', 'browser-agent', 'roadmap', 'agent-60']
series: 'agent-60'
day: 60
lang: 'zh'
---

## 今天要解决的问题

六十天前你可能还没写过 Python,不知道 function calling 是什么。今天你手里有一个带评测、带 trace、带安全测试、部署在公网上的客服 Agent,可能还有一个代码审查 Agent,一份对着真实 JD 改过的简历,和一个准备好的题库。

今天是最后一天,不学新的大块内容,做三件事:

1. 对照 JD 给自己的每项能力打勾,每个勾都要有证据,没有证据的就是没达标。
2. 把没达标的部分排进一个两周的补课计划,同时开始投递,不要等「全部学完」。
3. 选一到两个进阶方向,规划接下来三个月。

预计用时 3–5 小时。如果你想今天就动手体验一个进阶方向,后面的浏览器 Agent 例子再加 2 小时。

## 60 天走过的路

<figure>
<svg viewBox="0 0 640 260" role="img" aria-label="60 天课程的九周结构与产出">
  <rect x="0" y="0" width="640" height="260" fill="var(--paper-raised)"/>
  <line x1="30" y1="130" x2="610" y2="130" stroke="var(--rule)" stroke-width="2"/>
  <circle cx="40" cy="130" r="6" fill="var(--mem)"/>
  <text x="22" y="110" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">W1</text>
  <text x="14" y="158" font-family="var(--font-mono)" font-size="10" fill="var(--ink-soft)">API·提示词</text>
  <circle cx="110" cy="130" r="6" fill="var(--mem)"/>
  <text x="96" y="110" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">W2</text>
  <text x="84" y="158" font-family="var(--font-mono)" font-size="10" fill="var(--ink-soft)">工具·循环</text>
  <circle cx="180" cy="130" r="6" fill="var(--mem)"/>
  <text x="166" y="110" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">W3</text>
  <text x="160" y="158" font-family="var(--font-mono)" font-size="10" fill="var(--ink-soft)">RAG·上下文</text>
  <circle cx="250" cy="130" r="6" fill="var(--mem)"/>
  <text x="236" y="110" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">W4</text>
  <text x="226" y="158" font-family="var(--font-mono)" font-size="10" fill="var(--ink-soft)">MCP·框架</text>
  <circle cx="320" cy="130" r="6" fill="var(--compute)"/>
  <text x="306" y="110" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">W5</text>
  <text x="302" y="158" font-family="var(--font-mono)" font-size="10" fill="var(--ink-soft)">评测·可观测</text>
  <circle cx="390" cy="130" r="6" fill="var(--compute)"/>
  <text x="376" y="110" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">W6</text>
  <text x="372" y="158" font-family="var(--font-mono)" font-size="10" fill="var(--ink-soft)">生产化</text>
  <rect x="440" y="118" width="90" height="24" fill="var(--compute-wash)" stroke="var(--compute)"/>
  <text x="448" y="134" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">W7–8 毕业项目</text>
  <circle cx="570" cy="130" r="6" fill="var(--mem)"/>
  <text x="556" y="110" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">W9</text>
  <text x="550" y="158" font-family="var(--font-mono)" font-size="10" fill="var(--ink-soft)">求职</text>
  <text x="30" y="200" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">产出:命令行聊天机器人 → 命令行 Agent → 文档问答 → 工单分流 → 评测门禁 → 公网服务</text>
  <text x="30" y="220" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">     → SupportPilot → 代码审查 Agent → 简历·题库·求职漏斗</text>
  <text x="30" y="246" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">前四周学「怎么做出来」,中间两周学「怎么证明它好、怎么让它跑得住」,后三周把它变成工作</text>
</svg>
<figcaption>九周的结构。前四周的东西网上教程很多,真正拉开差距的是 W5 和 W6:评测、可观测、安全、成本。</figcaption>
</figure>

如果让我挑这门课里最重要的一个习惯,那就是:**每一个「它变好了」的判断都要有数字,每一个数字都要说得清口径。**招聘方用来区分「跟着教程搭了 demo 的人」和「能在生产上负责一个 Agent 的人」,看的几乎就是这一点。站长整理的 880 条 JD 里,海外 62%、国内 48% 的岗位提到评测;腾讯一个 Agent 岗的要求是「每次 Prompt、模型、工具变更都有量化的收益与回归判定」;智联上一家公司直接要求候选人「能讲清上线后效果指标是多少、是怎么测出来的」。这件事你已经练了五周,带走它。

## 能力自检:每个勾都要有证据

下表左边是 JD 里出现频率较高的能力和它在国内(有正文的 334 条)、海外(185 条)样本里的比例(关键词匹配,只看方向;最后一行 Computer/Browser Use 只在第一批 305 条里统计过),右边两列你自己填。证据要具体到「哪个文件、哪个数字、哪个链接」;填不出证据的,就算你「觉得会」,也打叉。

| 能力 | 国内 | 海外 | 课程 | 我的证据 | 达标 |
| --- | --- | --- | --- | --- | --- |
| Python 工程(类型、异步、测试) | 65% | 63% | Day 2 起 | | |
| 上下文工程与记忆 | 52% | 25% | Day 20、48 | | |
| 工具调用与 Agent 循环(能手写) | 55% | 39% | Day 8–12 | | |
| 评测(测试集、judge、轨迹、CI 门禁) | 48% | 62% | W5、Day 50–51 | | |
| RAG(混合检索、rerank、检索评测) | 51% | 54% | W3、Day 45 | | |
| Agent 框架及其原理、何时不用 | 46% | 36% | Day 24–27 | | |
| 多 Agent 与子 Agent 分工 | 37% | 22% | Day 26 | | |
| 部署(Docker、云、HTTPS) | 39% | 53% | Day 41、53 | | |
| 提示词与结构化输出 | 46% | 46% | Day 5–6 | | |
| 面向业务或客户的需求拆解 | 33% | 46% | Day 43、58、59 | | |
| 可观测与 tracing | 21% | 31% | Day 34、52 | | |
| 成本、延迟与 ROI | 31% | 39% | Day 38、52、58 | | |
| MCP(写 server、接 client) | 17% | 16% | Day 22–23、46 | | |
| 熟练使用并审查 Coding Agent | 21% | 15% | Day 55 | | |
| SQL 与数据系统 | 31% | 41% | Day 17、46 | | |
| 安全(注入、权限、沙箱) | 11% | 22% | Day 39–40、53 | | |
| Skills 与 Agent Harness 概念 | 10% | 3% | Day 27、57 | | |
| 微调(LoRA) | 23% | 19% | 进阶方向 | | |
| Computer / Browser Use | 5% | 1% | 进阶方向 | | |

再加三条和技能无关、但决定你能不能拿到 offer 的检查:

- [ ] SupportPilot 在公网可访问,README 第一屏有演示、有带口径的数字。
- [ ] 简历中英文各一页,每个技能词都有证据,所有链接可点。
- [ ] 60 道基础题第二轮没有答不上来的,手写 Agent 循环 10 分钟内完成,做过至少一次完整的系统设计模拟。

## 没达标怎么办

先说一个判断:**不要等所有格子都打勾再开始投递。** 招聘本身就是最好的反馈。从明天开始按 Day 59 的节奏投,同时用两周时间补短板。

补课的顺序按「JD 频次高 × 你差得多」排。几种常见情况:

- **评测这一行打了叉。** 这是最该优先补的。回到 Day 29–35,把 SupportPilot 的测试集扩到 100 条,把 judge 和人工标注的一致率算出来,让 CI 门禁真正跑起来。没有这一行,简历上其他内容的说服力都会打折。
- **框架原理答不上来。** 回到 Day 24–25,再读一遍 LangGraph 的持久化和运行时文档,然后试着不用 LangGraph 实现一个带 checkpoint 的最小状态机,做过一次就再也忘不了。
- **上下文工程只会说概念。** 在 SupportPilot 里加一个真实的压缩机制:对话超过一定 token 后自动摘要,用多轮评测证明压缩前后成功率没有明显下降。
- **安全这一行没把握。** 把 Day 53 的注入测试集扩到 40 条,再请一个朋友完全不看你的代码,只看演示地址,试着攻破它。
- **部署没真正做过。** 不要跳过。一个能打开的公网地址,在简历上的分量比十行技术栈大。

## 接下来三个月:选一到两个方向

课程刻意没讲的东西有很多。下面这几个方向是我认为最值得投入的,按「JD 需求 × 和你现有能力的衔接」排序。不要都做,选一到两个做深。

### 方向一:LoRA 轻量微调

课程一开始就说不教训练,这个判断对两个月速成是对的。但调研数据显示,国内约 23%、新加坡香港约 28% 的 Agent 岗提到微调或强化学习,中小公司的 JD 里常见一句「独立完成过至少一次开源模型的轻量微调,能说明微调前后的量化差异以及付出的代价」。这正好是一个可以在一个月内补上的点,而且你已经有了评测能力,这是做微调最关键的前提。

LoRA 的直觉不难。模型里有大量形状为 d × d 的权重矩阵,全量微调要更新所有参数。LoRA 冻结原矩阵 W,另外训练两个小矩阵 B(d × r)和 A(r × d),用 W + BA 代替 W,r 通常取 8 或 16。算一下:一个 4096 × 4096 的矩阵有 16,777,216 个参数;r = 8 时,B 和 A 合计 4096 × 8 × 2 = 65,536 个参数,只有原来的约 0.39%。要训练的参数少两个数量级,显存和时间都降下来,一张消费级显卡或者按小时租的云 GPU 就能跑 7B 以下的模型。

一个能写进简历的 LoRA 实验,我建议这样设计,用你已有的 SupportPilot:

1. **选一个窄任务**:工单分类。现在它由一个通用小模型加 prompt 完成,你有准确率基线。
2. **造数据**:用大模型按类别合成加人工校对,做 1,000 到 3,000 条训练样本,另外留出 Day 50 的测试集绝对不进训练(这一步最容易犯错)。
3. **训练**:用 LLaMA-Factory 或 Unsloth 在一个 1.5B 到 7B 的开源模型上做 LoRA,记录 GPU 型号、时长、花费。
4. **评测**:在同一个测试集上比较「通用小模型 + prompt」「微调后的模型」「大模型 + prompt」三者的准确率、延迟、单次成本。
5. **写结论**:微调值不值,包括你付出的代价(数据准备时间、训练成本、部署一个自托管模型的运维成本)和副作用(比如在训练集没覆盖的类别上是否变差)。

结论是「不值得」也完全可以写进简历,只要数据扎实。面试官想看的是你会判断,而不是你会跑训练脚本。

### 方向二:浏览器 Agent 与 Computer Use

这个方向在样本里比例不高(第一批 120 条国内样本里约 5%),但出现的地方都很有分量:一家大型游戏公司把 Computer/Browser Use 列为加分项,腾讯有专门的浏览器自动化岗。它的价值在于很多企业系统没有 API,只有网页界面,浏览器 Agent 是让 Agent 能操作这些系统的唯一办法。

它的原理就是你熟悉的 Agent 循环,只是工具换成了操作浏览器。下面是一个最小可跑的版本,把 Playwright 包成四个工具,接到 Day 9 的循环上就能用:

```python
# agent-60-lab/advanced/browser_tools.py
# 依赖:uv add playwright && uv run playwright install chromium
from urllib.parse import urlparse

from playwright.sync_api import sync_playwright

ALLOWED_HOSTS = {"demo.your-domain.com", "help.cloudledger.example"}  # 只允许访问白名单站点

_MARK_ELEMENTS = """
() => {
  const els = [...document.querySelectorAll('a, button, input, textarea, select')]
    .filter(e => e.offsetParent !== null)
    .slice(0, 80);
  return els.map((e, i) => {
    e.setAttribute('data-agent-id', String(i));
    const label = e.innerText || e.value || e.placeholder || e.getAttribute('aria-label') || '';
    return { id: i, tag: e.tagName.toLowerCase(), text: label.trim().slice(0, 60) };
  });
}
"""


class BrowserTools:
    def __init__(self, headless: bool = True):
        self._pw = sync_playwright().start()
        self._browser = self._pw.chromium.launch(headless=headless)
        self.page = self._browser.new_page()

    def read_page(self) -> dict:
        """返回当前页面的标题、正文前 3000 字和带编号的可交互元素列表。"""
        elements = self.page.evaluate(_MARK_ELEMENTS)
        text = self.page.inner_text("body")[:3000]
        return {"url": self.page.url, "title": self.page.title(), "text": text, "elements": elements}

    def goto(self, url: str) -> dict:
        """打开一个网址,只允许白名单域名。"""
        if urlparse(url).hostname not in ALLOWED_HOSTS:
            return {"error": "该域名不在允许访问的列表里"}
        self.page.goto(url, timeout=15_000)
        return self.read_page()

    def click(self, element_id: int) -> dict:
        """点击 read_page 返回的某个元素。"""
        self.page.click(f'[data-agent-id="{element_id}"]', timeout=5_000)
        self.page.wait_for_load_state("domcontentloaded")
        return self.read_page()

    def type_text(self, element_id: int, text: str) -> dict:
        """在输入框里填入文字(会先清空)。"""
        self.page.fill(f'[data-agent-id="{element_id}"]', text, timeout=5_000)
        return self.read_page()

    def close(self) -> None:
        self._browser.close()
        self._pw.stop()
```

给元素编号再让模型按编号操作,是 browser-use 这类开源项目常用的思路,比让模型自己写 CSS 选择器可靠得多。正式的项目还会加截图让多模态模型看,加滚动和等待,处理弹窗和登录态。

浏览器 Agent 把 Day 53 讲过的风险放大了好几倍:它读的每一个网页都是不可信内容,可能藏着注入;它能点「确认付款」「删除」「发送」这类不可逆按钮;如果用的是已登录的浏览器会话,它拥有你的全部权限。所以最小原则是:域名白名单、独立的浏览器配置(不复用你自己登录过的浏览器)、敏感按钮之前强制人工确认、全程录屏或记录操作日志。练手时只在你自己部署的 SupportPilot 演示站上操作,比如让它「登录演示账号,提交一张工单,把回复内容读出来」,这本身就是一个不错的端到端测试。

### 方向三:Agent Harness 与可观测

如果你本来是后端或平台工程师,这是和你原有能力衔接最好的方向。国内大厂的「Agent Harness」「Agent Infra」岗位关心的是运行底座:任务调度、状态持久化与恢复、工具和 Skill 的注册、沙箱、全链路 tracing、评测流水线。可以从两件事入手:把 SupportPilot 的 tracing 改成基于 OpenTelemetry 的 GenAI 语义约定,让它能接入任何支持 OTel 的后端;给代码执行类工具做一个基于容器的沙箱,限制网络、文件和执行时间。这两件事都很「工程」,恰好是很多算法背景候选人的短板。

### 方向四:语音 Agent

在样本里比例很低(约 2% 到 3%),但客服、销售、预约这类场景的需求在增长。技术上多了语音识别、语音合成、打断处理和低延迟的流式管道。如果你对实时系统感兴趣可以看看 Pipecat、LiveKit Agents 这类开源框架。作为转方向后的第一个进阶方向,我不太推荐,岗位还少。

### 方向五:开源贡献

一个被合并的 PR 是招聘方很认的信号,而且能让你接触到比个人项目复杂得多的代码。门槛最低的入口:给你用过的 MCP server 修 bug 或补文档;给 LangGraph 的文档补一个中文场景的例子;给 Datawhale 的 hello-agents 这类中文教程提 PR。先从文档和测试开始,不要一上来就挑核心功能。

## 怎么跟上这个领域

Agent 领域半年一个样,你今天学的框架 API,明年可能就变了。但评测、上下文管理、权限设计、成本意识这些底层的东西变得很慢。跟进新东西时,我的习惯是只跟少数几个高质量信息源,而不是刷所有新闻:

- **Simon Willison 的博客**:几乎每天更新,对新模型、新工具的上手实测和安全问题最敏锐。
- **Anthropic Engineering 博客**和 OpenAI、LangChain 的工程博客:一手的工程实践,课程里引用了很多篇。
- **Hamel Husain** 和 **Chip Huyen** 的博客:评测和 AI 工程的方法论。
- **Latent Space** 播客和 **smol.ai 的 AI News**:每天的行业动态汇总,扫标题就行。
- 中文:Datawhale 的开源教程,B 站上几个认真做原理讲解的 UP 主,课程里引用过的那些可以关注。

更重要的是保持动手。每个月做一个小东西,用新出的模型或工具,在你的评测集上跑一遍,写一篇短博客记录结果。半年后你会有六篇带数据的文章,这比任何证书都有用。

## 动手练习

**步骤**

1. 填完能力自检表,每个勾都写上证据(文件路径、数字或链接)。
2. 把所有打叉的项目按「JD 频次 × 差距」排序,取前三项,写一个两周补课计划,每天具体到做哪件事。
3. 今天至少投出 5 份简历,把求职漏斗表建起来(Day 59)。
4. 从五个进阶方向里选一到两个,写下三个月的目标和第一周的第一步。
5. (可选,2 小时)跑通浏览器 Agent:把 `BrowserTools` 的四个方法注册成工具,接到 Day 9 的循环上,让它在你的 SupportPilot 演示站上完成一次「提交工单并读回回复」。
6. 写一篇 60 天的学习复盘,发在你的博客或社交平台:你做了什么、最难的地方、最大的收获、下一步。

**验收标准**

- 自检表里每个勾都有可点开或可运行的证据。
- 补课计划和进阶计划都具体到「第一周做什么」。
- 今天的投递已经发出,漏斗表里有记录。
- (可选项)浏览器 Agent 能在白名单站点上完成一次完整任务,访问白名单之外的域名时被拒绝。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| LoRA | Low-Rank Adaptation,冻结原权重,只训练两个低秩小矩阵的轻量微调方法 |
| 秩 r | LoRA 小矩阵的中间维度,越大可学的东西越多,参数也越多 |
| Computer Use | 让模型通过截图和鼠标键盘操作整个电脑界面的能力 |
| 浏览器 Agent | 通过浏览器自动化工具(如 Playwright)操作网页完成任务的 Agent |
| Playwright | 微软开源的浏览器自动化库,支持 Chromium、Firefox、WebKit |
| OpenTelemetry GenAI 语义约定 | OpenTelemetry 为大模型调用、Agent 等定义的标准化 span 属性 |
| 沙箱 | 限制程序能访问的网络、文件和资源的隔离运行环境 |
| 能力自检 | 对照岗位要求逐项检查,每项都要求有可验证的证据 |

## 常见误区

**等「全部学完」再投简历。** 永远不会有全部学完的那一天。招聘过程本身就是最好的反馈,边投边补。

**进阶方向贪多。** 五个方向都浅尝一下,三个月后每个都讲不深。选一到两个,做出带数据的成果。

**觉得微调是「更高级」的方向。** 对 Agent 工程师来说,微调是工具箱里的一个工具,不是升级路线。大多数问题用更好的上下文和评测就能解决,能判断什么时候不用微调同样是本事。

**浏览器 Agent 直接用自己日常的浏览器跑。** 它会继承你所有的登录态,一次注入就可能让它用你的身份做事。永远用独立的浏览器配置和白名单。

**追每一个新框架。** 底层能力(评测、上下文、权限、成本)比框架 API 寿命长得多,新框架等它稳定了再学,通常一两天就能上手。

**学完就不再写博客和作品。** 两个月的成果会随着时间贬值,持续的、带数据的公开输出才会复利。

## 学习资料

### 文档与文章

- [LoRA 论文](https://arxiv.org/abs/2106.09685):读摘要和第 4 节方法部分,30 分钟,弄清低秩分解的思路。
- [Hugging Face PEFT 文档](https://huggingface.co/docs/peft/index):LoRA 等参数高效微调方法的官方库文档。
- [Hugging Face LLM Course](https://huggingface.co/learn/llm-course):如果想系统补一下模型和微调的基础,这是免费且更新及时的课程。
- [Playwright Python 文档](https://playwright.dev/python/docs/intro):浏览器 Agent 的基础,看安装、定位元素和等待机制三节。
- [Anthropic · Computer use tool](https://docs.anthropic.com/en/docs/agents-and-tools/tool-use/computer-use-tool):截图加鼠标键盘的 Computer Use 方案,重点读它的安全建议。
- [OpenTelemetry GenAI 语义约定](https://opentelemetry.io/docs/specs/semconv/gen-ai/):做 Harness 和可观测方向的起点。
- 信息源:[Simon Willison](https://simonwillison.net/)、[Anthropic Engineering](https://www.anthropic.com/engineering)、[Hamel Husain](https://hamel.dev/blog/posts/evals/)、[Chip Huyen](https://huyenchip.com/blog/)、[Latent Space](https://www.latent.space/)、[AI News by smol.ai](https://news.smol.ai/)。
- 课程回看:吴恩达《Agentic AI》[中英字幕版](https://www.bilibili.com/video/BV1MDsgzxEfS/)(31 集),学完整个课程后再看一遍,会有和第一次完全不同的感受。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1vZfKYeEDk&autoplay=0&high_quality=1" title="一句话命令AI操作浏览器替我打工,Browser Use原理+实战" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>技术爬爬虾 · 一句话命令AI操作浏览器替我打工,Browser Use原理+实战 · 10 分钟,本地跑 browser-use 并穿插讲源码原理,和上面的最小实现对照看。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1MRMnz1EGW&autoplay=0&high_quality=1" title="LLaMA Factory 微调教程:如何构建高质量数据集?" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>code秘密花园 · LLaMA Factory 微调教程:如何构建高质量数据集? · 25 分钟,微调效果的上限由数据决定,先看这个再动手训。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/LCEmiRjPEtQ" title="Andrej Karpathy: Software Is Changing (Again)" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Y Combinator · Andrej Karpathy: Software Is Changing (Again) · Karpathy 讲软件 3.0 和「部分自主」的产品形态,学完这门课再看,能听懂他为什么强调人在环路里。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/4pYzYmSdSH4" title="Andrew Ng: State of AI Agents | LangChain Interrupt" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>LangChain · Andrew Ng: State of AI Agents | LangChain Interrupt · 吴恩达讲 Agent 的现状,其中关于评测和「Agent 工程师需要什么能力」的部分和这门课的主线一致。</figcaption>
</figure>

### 书籍

- Chip Huyen《AI Engineering》(O'Reilly, 2025):第 7 章 Finetuning 和第 8 章 Dataset Engineering,选微调方向的话先读这两章;整本书值得在接下来三个月里通读一遍。
- Michael Albada《Building Applications with AI Agents》(O'Reilly, 2025):第 7 章 Learning in Agentic Systems、第 11 章 Improvement Loops、第 13 章 Human-Agent Collaboration,是课程之后的自然延伸。
- Jay Alammar、Maarten Grootendorst《Hands-On Large Language Models》(O'Reilly, 2024):第 12 章 Fine-Tuning Generation Models,配合 LoRA 实验读。

### 开源项目与代码

- [hiyouga/LLaMA-Factory](https://github.com/hiyouga/LLaMA-Factory) 和 [unslothai/unsloth](https://github.com/unslothai/unsloth):两个最常用的 LoRA 微调工具,前者有 Web 界面、中文文档完善,后者更省显存。
- [datawhalechina/self-llm](https://github.com/datawhalechina/self-llm):中文的开源模型部署和微调教程合集。
- [browser-use/browser-use](https://github.com/browser-use/browser-use):开源浏览器 Agent,看它如何表示页面元素和处理失败。
- [modelcontextprotocol/servers](https://github.com/modelcontextprotocol/servers):官方 MCP server 合集,找一个你用过的,从修文档或补测试开始做开源贡献。
- [pipecat-ai/pipecat](https://github.com/pipecat-ai/pipecat)、[livekit/agents](https://github.com/livekit/agents):语音 Agent 方向的两个开源框架。

## 自测

1. 能力自检表里,你打了勾但写不出证据的项,应该怎么处理?

<details><summary>答案</summary>

改成打叉。没有证据的「会」在面试里经不起追问。然后判断它在 JD 里的频次和你的差距,决定是放进两周补课计划,还是暂时从简历上拿掉。

</details>

2. 一个 4096 × 4096 的权重矩阵,用 r = 16 的 LoRA,新增的可训练参数是多少?占原矩阵的比例?

<details><summary>答案</summary>

B 是 4096 × 16,A 是 16 × 4096,合计 4096 × 16 × 2 = 131,072 个参数;原矩阵 16,777,216 个,比例约 0.78%。

</details>

3. 设计一个 LoRA 实验时,最容易犯、也最致命的错误是什么?

<details><summary>答案</summary>

测试集的数据(或者和它高度相似的数据)进入了训练集,导致评测分数虚高。测试集必须提前固定并严格隔离,合成训练数据时也要检查和测试集的重复与近似重复。

</details>

4. (面试题)「你会怎么设计一个能操作内部网页系统的浏览器 Agent?主要风险是什么?」

<details><summary>答案</summary>

设计:Playwright 驱动独立的浏览器配置,页面表示为正文摘要加带编号的可交互元素(必要时加截图给多模态模型),工具包括打开、读取、点击、输入,接 Agent 循环;域名白名单;对提交、付款、删除等不可逆操作前强制人工确认;全程记录操作日志和截图;步数和时间上限。风险:网页内容中的间接注入、继承登录态导致的越权、误点不可逆操作、页面结构变化导致的不稳定。可以引用致命三要素说明为什么浏览器 Agent 风险尤其高。

</details>

5. 为什么文中说「微调结论是不值得也可以写进简历」?

<details><summary>答案</summary>

因为面试官看重的是判断能力和方法:你有没有用同一个测试集比较多种方案,有没有算清楚训练、部署、运维的代价,有没有检查副作用。一个数据扎实的「不值得」结论,说明你知道什么时候不该用某个技术,这在工程上和「会用」同样重要。

</details>

6. 选进阶方向时,你会用什么标准?按这个标准给自己选一个。

<details><summary>答案</summary>

两个维度:岗位需求(JD 里出现的频次和你目标公司的方向)和衔接度(和你已有能力的距离,越近越容易做出成果)。比如后端背景的人,Agent Harness 与可观测衔接度最高;想投中小公司应用岗的人,LoRA 微调在 JD 里出现得多;对客服、电销场景感兴趣的人可以考虑语音 Agent。答案没有对错,重要的是用这两个维度说清理由。

</details>

## 明天预告

60 天到这里是一个能投简历的终点,但不是课程的终点。明天开始是进阶篇,Day 61:资深 Agent 工程师和中级差在哪。

进阶篇一共 50 天,目标是资深和 Staff 那一档:把 SupportPilot 升级成多租户的 AgentOps 平台,补上评测里的统计学、模型网关、自部署和微调、规模化可观测、写设计文档和带人。你可以先按 Day 59 的节奏把简历投出去,一边面试一边往下学,两件事不冲突。

如果这六十天里有哪一天的内容你觉得写错了、过时了,或者讲得不清楚,欢迎在那一篇下面留言。
