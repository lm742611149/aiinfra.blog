---
title: 'Day 501 · 简历(四):代表项目说明、一页结构、证书和英文版'
description: '把前三天写好的零件拼成一份能投的简历:先写一段四问结构的代表项目说明并用脚本查结构和数字,再用 JSON 加 HTML 排一页,用 Chrome 打成 PDF,用 pypdf 查页数、链接和机器能不能读出正常汉字。最后看 2026 年几个 Agent 认证值不值得考,出一份英文版。'
pubDate: 2026-10-22
regime: none
tags: ['resume', 'job-search', 'pdf', 'ats', 'agent-zero']
series: 'agent-zero'
day: 501
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 500](/blog/agent-zero/day-500-resume-3/) 把一个前端工程师的工作经历写成了带角色的事实清单,让模型换角度改写,再用 `honesty_check.py` 抓职责升级和凭空多出来的技术词;后半段用正则读 JD 里的年限和学历门槛,`gate` 给出投、内推还是放弃。

到这里,简历的三块正文都有了:[Day 499](/blog/agent-zero/day-499-resume-2/) 的四条 SupportPilot 要点和两条代码审查机器人要点,Day 500 定稿的四条工作经历。今天把它们拼起来,变成一份真的能发出去的 PDF。

## 今天要解决的问题

学完今天,你应该能做到:

1. 写一段 300 字左右的「代表项目说明」,四个问题一个不少,并用脚本查结构、长度和数字。
2. 用一份 JSON 加一个 HTML 模板排出一页简历,用 Chrome 打印成 PDF,再用脚本确认三件事:只有一页、链接能点、机器读出来的是正常汉字。
3. 说得出 2026 年几个 Agent 相关认证考什么、多少钱、谁能报,以及证书在简历上放哪。
4. 让模型出英文版要点,用脚本查数字有没有丢、开头是不是动词,再人工改掉脚本查不出的问题。

预计用时 2.5–3 小时。前置:Day 499 的 `number_check.py`(`numbers_in`、`check`)和 `part09/results.md`,Day 500 定稿的工作经历,[Day 498](/blog/agent-zero/day-498-resume-1/) 的 `load_jds`,结构化输出([Day 147](/blog/agent-zero/day-147-structured-1/) 起)。

今天用到的东西有两样是新的:Python 的 pypdf 库,和用 Chrome 的命令行模式打印 PDF。HTML 和 CSS 是你的老本行,这里不讲。

学法提示:先对照文章逐行敲一遍(不复制粘贴)并跑通;第二天合上文章,把 `story_check` 和 `pdf_check` 两个函数默写出来;做练习,做不出再展开参考答案,看完关掉重写一遍。

## 代表项目说明:四个问题,300 字

越来越多的公司会在简历之外再要一段项目说明。Day 498 那份智联上的「AI 大模型应用开发工程师」岗,投递要求里写得很直白:挑一个你做过的大模型项目,写清楚数据从哪来、你怎么处理、上线后效果是多少、如果再做一次你会改进什么。

我很喜欢这四个问题,因为它们正好是面试官听你讲项目时脑子里的顺序。哪怕对方没要求,也建议你准备一份:面试开头的「介绍一下你最有代表性的项目」,答的就是这四件事。

这四问里最容易被人跳过的是第四问「再来一次」。很多人觉得承认不足会减分,其实正相反。一个说得出自己项目哪里不好、打算怎么改的人,面试官会相信他真的做过;一个把项目说得完美无缺的人,面试官会开始找破绽。

先用 Markdown 写一版草稿,存成 `part09/story_v1.md`。我第一次写成了这样:

```markdown
## 数据从哪来
虚构 SaaS 公司「云簿」的帮助中心文章和客户、订阅、发票、工单四张业务表,都由 seed 脚本生成;另外造了 100 条测试工单和 24 条注入用例。

## 怎么处理
帮助中心按标题层级切块,向量检索和 BM25 混合后 rerank;业务数据走 MCP 工具按需查,客户身份由服务端绑在工具层;LangGraph 编排分类、检索、执行、起草、自检,退款进 interrupt 人工审批。

## 效果
40 条 test 工单端到端成功率 80%,单工单成本 ¥0.009,越权和绕过审批两类攻击成功次数从 3 降到 0。
```

先别急着挑毛病,写个脚本让它替你挑。

## 第一步:写 `story_check`

规则有三条:四个小节都要有而且不能空;汉字数在 250 到 380 之间;所有数字都能在记录表里找到。数字那条直接复用 Day 499 的 `number_check.py`。

```python
# agent-zero-lab/part09/story_check.py
import re
import sys
from pathlib import Path

from part09.number_check import check, numbers_in

SECTIONS = ["数据从哪来", "怎么处理", "效果", "再来一次"]
HAN = re.compile(r"[一-鿿]")


def split_sections(md: str) -> dict[str, str]:
    parts = re.split(r"^## (.+)$", md, flags=re.M)
    return {parts[i].strip(): parts[i + 1].strip() for i in range(1, len(parts), 2)}


def story_check(md: str, known: set[str]) -> list[str]:
    sec = split_sections(md)
    problems = [f"缺「{s}」" for s in SECTIONS if not sec.get(s)]
    han = len(HAN.findall(md))
    if not 250 <= han <= 380:
        problems.append(f"汉字 {han} 个,不在 250–380 之间")
    problems += [f"记录表里没有的数字 {n}" for n in check(md, known)]
    return problems


if __name__ == "__main__":
    path = Path(sys.argv[1])
    known = numbers_in(Path("part09/results.md").read_text(encoding="utf-8"))
    md = path.read_text(encoding="utf-8")
    print(f"{path.name}: 汉字 {len(HAN.findall(md))},小节 {list(split_sections(md))}")
    print(story_check(md, known) or "通过")
```

<div class="line-notes">

- `import sys` 要用 `sys.argv` 读命令行参数。`sys.argv[1]` 是脚本名后面的第一个参数,相当于 Node 里的 `process.argv[2]`(Node 多了一个 node 本身)。
- `from part09.number_check import check, numbers_in` Day 499 写的两个函数:`numbers_in` 从一段文字里收集所有数字,`check` 返回「要点里有、记录表里没有」的数字。
- `SECTIONS = ["数据从哪来", "怎么处理", "效果", "再来一次"]` 四个小节标题,和 Markdown 里 `## ` 后面的字一字不差。
- `HAN = re.compile(r"[一-鿿]")` 汉字的字符范围,和本站统计字数用的是同一个口径。数字、英文、标点都不算。
- `parts = re.split(r"^## (.+)$", md, flags=re.M)` 按 `## 标题` 那一行切开。`re.M` 让 `^` 和 `$` 匹配每一行的开头结尾,而不是整段文字的开头结尾。正则里有捕获组时,`re.split` 会把捕获到的标题也留在结果里,所以 `parts` 长这样:`['', '数据从哪来', '虚构 SaaS…', '怎么处理', '帮助中心…', '效果', '40 条…']`。
- `return {parts[i].strip(): parts[i + 1].strip() for i in range(1, len(parts), 2)}` 从下标 1 开始每次跳两格,`parts[i]` 是标题,`parts[i + 1]` 是它下面的正文。`range(1, 7, 2)` 产出 1、3、5,相当于 JS 里 `for (let i = 1; i < 7; i += 2)`。
- `problems = [f"缺「{s}」" for s in SECTIONS if not sec.get(s)]` 小节不存在,`sec.get(s)` 返回 None;小节存在但下面没写字,返回空字符串。两种都是假值,一起抓。
- `if not 250 <= han <= 380:` Python 可以把比较连起来写,意思是 `250 <= han and han <= 380`。JS 里这么写会出错,Python 里是对的。
- `problems += [f"记录表里没有的数字 {n}" for n in check(md, known)]` 列表 `+=` 另一个列表,相当于 JS 的 `problems.push(...xs)`。
- `print(story_check(md, known) or "通过")` 空列表是假值,`or` 就返回「通过」。

</div>

在 `agent-zero-lab/` 目录下运行,文件路径作为参数传进去:

```bash
cd agent-zero-lab
uv run python -m part09.story_check part09/story_v1.md
```

```text
story_v1.md: 汉字 152,小节 ['数据从哪来', '怎么处理', '效果']
['缺「再来一次」', '汉字 152 个,不在 250–380 之间', '记录表里没有的数字 25', '记录表里没有的数字 80%']
```

四个问题,一个一个看。

「再来一次」没写,是我故意漏的,也是真实草稿里最常漏的一节。152 个汉字太短,第三问只有一句话。80% 是我凭印象写的,记录表里最终成功率是 77.5%,这正是 Day 499 讲过的那种「自己记错」。

**第三个是误报。** 25 是从哪来的?回去找,是「BM25」里的 25。`numbers_in` 的正则只认数字,不管它前面是不是贴着字母,于是 BM25、GPT4、S3 这类名字里的数字都会被当成「要对账的数」。Day 499 那几条要点恰好没有这种词,今天第一次撞上。

修法是先把「字母紧跟数字」这种词从文字里抹掉,再去对账。在 `HAN` 下面加一行,`story_check` 里改一行:

```python
TOKEN_NUM = re.compile(r"[A-Za-z]+\d+")
```

```python
    plain = TOKEN_NUM.sub("", md)
    problems += [f"记录表里没有的数字 {n}" for n in check(plain, known)]
```

<div class="line-notes">

- `plain = TOKEN_NUM.sub("", md)` `re.sub` 是正则替换,相当于 JS 的 `md.replace(/[A-Za-z]+\d+/g, "")`。BM25 整个被换成空字符串。
- `problems += [f"记录表里没有的数字 {n}" for n in check(plain, known)]` 拿抹掉之后的文字去对账。字数统计还用原来的 `md`,因为 BM25 里本来就没有汉字,不影响。

</div>

改完再跑一次 v1,25 没了,剩下三个是真问题:

```text
story_v1.md: 汉字 152,小节 ['数据从哪来', '怎么处理', '效果']
['缺「再来一次」', '汉字 152 个,不在 250–380 之间', '记录表里没有的数字 80%']
```

这个规则也有代价:如果你写「BM25 召回 25 条」,后面那个独立的 25 照样会被检查,但「Top5」里的 5 就查不到了。对代表项目说明来说够用。

## 第二步:改出定稿

按报的问题改,存成 `part09/story.md`:

```markdown
## 数据从哪来
虚构的 SaaS 公司「云簿」:帮助中心文章,加客户、订阅、发票、工单四张业务表,全部由 seed 脚本生成。为了能量化,另外造了 100 条测试工单(dev 60 条、test 40 条)和 24 条注入用例。数据是合成的,这一点我在面试里会先说。

## 怎么处理
帮助中心按标题层级切块,向量检索和 BM25 混合后 rerank;业务数据通过 MCP 工具按需查,客户身份由服务端绑在工具层,模型改不了。LangGraph 编排分类、检索、执行、起草、自检几个节点,退款只能申请,经 interrupt 转人工审批。

## 效果
40 条 test 工单端到端成功率从基线 55% 迭代到 77.5%;单工单成本 ¥0.021 降到 ¥0.009;24 条注入用例里,越权和绕过审批两类的成功次数从 3 降到 0。

## 再来一次
评测集太依赖合成数据,我会更早找真人写一批工单;自检节点误拒偏多,先做错误分析再决定要不要换模型,而不是直接调 prompt。
```

```bash
uv run python -m part09.story_check part09/story.md
```

```text
story.md: 汉字 260,小节 ['数据从哪来', '怎么处理', '效果', '再来一次']
通过
```

260 个汉字,加上数字、英文和标点,整段大约 350 个字符,正好是对方说的「300 字左右」那个量级。招聘方说的「300 字」一般是 Word 里的字数,口径和我们不一样,差几十个字没人在意,差一倍就说明你没取舍。

脚本通过了,我自己再读一遍,有两处是故意这么写的。

第一段末尾那句「数据是合成的,这一点我在面试里会先说」,是主动把最大的弱点摆出来。你不说,面试官问「你这 100 条工单是真实客户的吗」,你再承认,就显得像被抓到了。

第四段的两条改进都是真的不足,而且都给了「先做什么」。「先做错误分析再决定要不要换模型」这句是在告诉面试官:我知道 [Day 480](/blog/agent-zero/day-480-iterate-1/) 那套方法,不会拍脑袋。面试官很可能顺着问「误拒偏多是多少,你怎么知道的」,这时候你要有数。记录表里目前没有这个数,所以我没写具体比例,面试前要去补。

## 一页简历长什么样

正文零件都有了,接下来决定它们在一页纸上怎么摆。

<figure>
<svg viewBox="0 0 640 300" role="img" aria-label="一页简历的版面结构:顶部是姓名和可点击链接,接着是一句话定位和技能,中间最大的一块是项目经历,下面是工作经历和教育">
  <rect x="0" y="0" width="640" height="300" fill="var(--paper-raised)"/>
  <rect x="150" y="14" width="340" height="276" fill="none" stroke="var(--rule)"/>
  <rect x="162" y="24" width="316" height="30" fill="var(--mem-wash)" stroke="var(--mem)"/>
  <text x="172" y="44" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">姓名 · 电话 · 邮箱 · GitHub · 演示</text>
  <rect x="162" y="60" width="316" height="20" fill="none" stroke="var(--rule)"/>
  <text x="172" y="74" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">一句话定位 + 城市、到岗时间</text>
  <rect x="162" y="86" width="316" height="28" fill="none" stroke="var(--rule)"/>
  <text x="172" y="104" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">技能(分组,只写能被追问的)</text>
  <rect x="162" y="120" width="316" height="84" fill="var(--compute-wash)" stroke="var(--compute)"/>
  <text x="172" y="140" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">项目经历 ×2(做了什么·数字·口径)</text>
  <text x="172" y="158" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">占版面最大,每条带数字</text>
  <rect x="162" y="210" width="316" height="56" fill="none" stroke="var(--rule)"/>
  <text x="172" y="230" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">工作经历(换角度改写)</text>
  <rect x="162" y="272" width="316" height="14" fill="none" stroke="var(--rule)"/>
  <text x="172" y="283" font-family="var(--font-mono)" font-size="10" fill="var(--ink)">教育 · 证书(可选,一行)</text>
  <text x="500" y="44" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">链接放顶部</text>
  <text x="500" y="150" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">转方向的人</text>
  <text x="500" y="166" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">项目放工作前</text>
</svg>
<figcaption>转方向的候选人把项目经历放在工作经历前面,因为 Agent 能力全靠项目证明。如果你原来的工作就和 Agent 高度相关,反过来放。</figcaption>
</figure>

这张图里每一块都有讲究,我按从上往下的顺序说。

**链接放最顶上,而且要能点。** GitHub、在线演示、博客,放在名字下面那一行。PDF 里的链接必须是真正的超链接,面试官点一下就能打开。写成纯文本的话,他得手动选中复制再粘贴进地址栏,大多数人不会这么做,你花了 Day 490 一整天上线的 demo 就没人看了。

**一句话定位**写在链接下面,比如「前端工程师(3 年),近期专注 AI Agent 开发,做过带评测和注入测试的客服 Agent 与代码审查机器人」。HR 扫一眼就知道你是谁、想干什么。国内简历通常还会在这里写期望城市和到岗时间,照片可选,技术岗基本不看。

**技能栏分组写**,每组一行:Agent 开发、检索、评测与可观测、工程。只写你能被追问三层的东西。Day 498 的对照表里空着的格子(比如 Go),这里也空着。

**项目经历占最大的版面。** 对转方向的人,这是唯一能证明你会做 Agent 的地方,放在工作经历前面。

**一页。** 三年以内经验,一页足够。超过一页,通常不是因为你做的事多,而是没取舍。

## 第三步:简历内容写成 JSON

我推荐把简历的内容和排版分开:内容放一份 JSON,排版是一个 HTML 模板。这样做的好处是,你后面要出英文版、要给不同岗位出侧重不同的版本,只换 JSON 就行,样式不用动;而且脚本能直接读 JSON 里的要点去做检查。这个思路和前端里「数据和组件分开」是一回事,开源社区也有现成的格式叫 JSON Resume,学习资料里有链接。

建 `part09/resume_zh.json`。这是数据不是代码,可以直接复制,把名字、联系方式、学校换成你的:

```json
{
 "name": "张三",
 "contact": [
  {"text": "138-0000-0000"},
  {"text": "zhangsan@example.com", "href": "mailto:zhangsan@example.com"},
  {"text": "github.com/zhangsan", "href": "https://github.com/zhangsan"},
  {"text": "SupportPilot 演示", "href": "https://demo.example.com"}
 ],
 "headline": "前端工程师(3 年),近期专注 AI Agent 开发,做过带评测和注入测试的客服 Agent 与代码审查机器人。期望城市:杭州 / 上海,一个月内到岗。",
 "skills": [
  ["Agent 开发", "LangGraph、MCP、Function Calling、上下文工程"],
  ["检索", "pgvector、BM25 混合检索、rerank"],
  ["评测与可观测", "规则 + LLM 评审、轨迹评测、Langfuse"],
  ["工程", "Python、FastAPI、PostgreSQL、Docker;TypeScript、React"]
 ],
 "projects": [
  {"title": "SupportPilot · SaaS 智能客服工单 Agent", "meta": "个人项目 · 2026.10",
   "bullets": [
    "用 LangGraph 编排分类、混合检索、MCP 业务工具、起草、自检等九个节点,退款经 interrupt 转人工审批;40 条 test 工单端到端成功率 77.5%。",
    "建三层评测(规则、LLM 评审、轨迹)接入 GitHub Actions 门禁;评审与人工抽检 40 条一致率 85%,迭代 4 轮后 test 成功率 55% → 77.5%。",
    "稳定 prompt 前缀并按难度路由大小模型,dev 集 60 条上缓存命中率 31% → 78%,单工单成本 ¥0.021 → ¥0.009。",
    "设计 24 条注入用例覆盖六类攻击;身份绑在工具层、退款只能申请,越权与绕过审批两类 8 条用例成功次数 3 → 0。"]},
  {"title": "代码审查机器人", "meta": "个人项目 · 2026.10",
   "bullets": [
    "解析 unified diff 并校验行号,意见只落在改动行;在 6 个 PR 埋的 20 个 bug 上召回 14 个。",
    "挂进 GitHub Actions 每个 PR 自动评论,20 个埋 bug 召回 70%,52 条意见有用率 73%。"]}
 ],
 "work": [
  {"title": "某 SaaS 公司 · 前端工程师", "meta": "2023.07 – 至今",
   "bullets": [
    "负责 SaaS 管理后台前端(React + TypeScript),3 年交付订阅、发票、工单三个模块。",
    "给下单流程写 35 条 Playwright 端到端用例接入 GitLab CI,作为合并前回归门禁。",
    "参与 AI 客服助手前端,用 SSE 流式渲染回复,实现停止生成和断线重连。",
    "日常用 Cursor 开发,为团队整理 8 条 AI 生成代码 review 清单。"]}
 ],
 "education": "某某大学 · 软件工程 · 本科 · 2019.09 – 2023.06",
 "certs": ""
}
```

几个字段说一下。`contact` 里有 `href` 的会变成链接,电话没有。项目的四条要点是 Day 499 `project_final.py` 里的 `FINAL` 原样搬过来的,代码审查机器人那两条来自 Day 499 练习 2 的定稿,工作经历是 Day 500 的定稿。每一条都已经过了检查脚本,今天不重新检查内容,只管排版。`certs` 先空着,后面讲证书时再说要不要填。

## 第四步:JSON 渲染成 HTML

模板就是一个函数,读 JSON,拼出 HTML 字符串。你写过 React,看这个会觉得很原始,但它只有几十行,没有依赖,而且 Python 标准库就够了。

```python
# agent-zero-lab/part09/build_resume.py
import json
import sys
from html import escape
from pathlib import Path

CSS = """
@page { size: A4; margin: 14mm 16mm; }
body { font-family: "PingFang SC", "Noto Sans CJK SC", sans-serif; font-size: 10.5pt; line-height: 1.45; color: #111; }
h1 { font-size: 18pt; margin: 0 0 2px; }
h2 { font-size: 11.5pt; border-bottom: 1px solid #999; margin: 10px 0 4px; }
.contact a { color: #0645ad; }
.row { display: flex; justify-content: space-between; font-weight: 600; }
ul { margin: 2px 0 6px; padding-left: 18px; }
"""


def link(c: dict[str, str]) -> str:
    text = escape(c["text"])
    return f'<a href="{escape(c["href"])}">{text}</a>' if c.get("href") else text


def block(items: list[dict]) -> str:
    out = []
    for it in items:
        lis = "".join(f"<li>{escape(b)}</li>" for b in it["bullets"])
        out.append(f'<div class="row"><span>{escape(it["title"])}</span><span>{escape(it["meta"])}</span></div><ul>{lis}</ul>')
    return "".join(out)


def build(d: dict, order: list[str]) -> str:
    sections = {
        "skills": "<h2>技能</h2><ul>" + "".join(f"<li><b>{escape(k)}</b>:{escape(v)}</li>" for k, v in d["skills"]) + "</ul>",
        "projects": "<h2>项目经历</h2>" + block(d["projects"]),
        "work": "<h2>工作经历</h2>" + block(d["work"]),
        "education": f"<h2>教育</h2><p>{escape(d['education'])}</p>",
        "certs": f"<h2>证书</h2><p>{escape(d['certs'])}</p>" if d.get("certs") else "",
    }
    head = f"<h1>{escape(d['name'])}</h1><p class='contact'>{' · '.join(link(c) for c in d['contact'])}</p><p>{escape(d['headline'])}</p>"
    body = head + "".join(sections[k] for k in order)
    return f'<!doctype html><html lang="zh"><meta charset="utf-8"><style>{CSS}</style><body>{body}</body></html>'


if __name__ == "__main__":
    src = Path(sys.argv[1])
    order = ["skills", "projects", "work", "education", "certs"]
    html = build(json.loads(src.read_text(encoding="utf-8")), order)
    out = Path("part09/out") / (src.stem + ".html")
    out.write_text(html, encoding="utf-8")
    print(f"已写入 {out},{len(html)} 字符")
```

<div class="line-notes">

- `from html import escape` 标准库的 HTML 转义函数,把 `<`、`>`、`&`、引号换成实体。要点里的「React + TypeScript」没问题,但如果哪天你写了 `<Suspense>` 这种词,不转义就会被浏览器当成标签吃掉。相当于 React 帮你自动做的那件事,这里要自己做。
- `CSS = """` 三引号字符串可以跨行,相当于 JS 的模板字符串(反引号),只是不能插值。
- `@page { size: A4; margin: 14mm 16mm; }` 打印专用的 CSS 规则,定纸张大小和页边距。屏幕上看不出效果,打印成 PDF 时才生效。国内外简历一般都用 A4,美国用 Letter。
- `body { font-family: "PingFang SC", "Noto Sans CJK SC", sans-serif;` 先用 macOS 自带的苹方。这一行后面会改,改的原因是今天最值得记住的一个坑。
- `.row { display: flex; justify-content: space-between; font-weight: 600; }` 标题在左、时间在右,flex 两端对齐,你闭着眼都会写。
- `def link(c: dict[str, str]) -> str:` 有 `href` 就输出 `<a>`,没有就是纯文字。
- `return f'<a href="{escape(c["href"])}">{text}</a>' if c.get("href") else text` 外层用单引号,里面 HTML 属性才能用双引号。`x if 条件 else y` 是 Python 的三元表达式,相当于 JS 的 `条件 ? x : y`,只是顺序不一样。
- `def block(items: list[dict]) -> str:` 项目和工作经历结构一样(标题、时间、要点列表),共用一个函数。
- `lis = "".join(f"<li>{escape(b)}</li>" for b in it["bullets"])` 相当于 JS 的 `it.bullets.map(b => `<li>${b}</li>`).join("")`。
- `def build(d: dict, order: list[str]) -> str:` `order` 决定几个板块的先后。转方向的人项目在前,练习 2 让你换过来看看。
- `"certs": f"<h2>证书</h2><p>{escape(d['certs'])}</p>" if d.get("certs") else "",` `certs` 是空字符串时整个板块不输出,不会留一个空标题。
- `body = head + "".join(sections[k] for k in order)` 按 `order` 的顺序取出各板块拼起来。
- `out = Path("part09/out") / (src.stem + ".html")` `src.stem` 是去掉扩展名的文件名,`resume_zh.json` 的 stem 是 `resume_zh`。`Path / "x"` 是拼路径,相当于 Node 的 `path.join`。
- `print(f"已写入 {out},{len(html)} 字符")` `len` 数的是字符,不是字节,所以和文件大小对不上(一个汉字在 UTF-8 里占 3 个字节)。

</div>

```bash
mkdir -p part09/out
uv run python -m part09.build_resume part09/resume_zh.json
```

```text
已写入 part09/out/resume_zh.html,2127 字符
```

在浏览器里打开 `part09/out/resume_zh.html` 就能看到效果。你是前端,CSS 想怎么调都行,这里只给一个干净够用的起点。

## 第五步:用 Chrome 打成 PDF

HTML 变 PDF 有很多工具,我选 Chrome 自己的无界面模式(headless),理由很简单:你电脑上本来就装了,不用再装任何东西,而且你在浏览器里看到的样子就是 PDF 的样子。headless 的意思是 Chrome 不打开窗口,在后台把页面渲染好,直接输出结果。

<figure>
<svg viewBox="0 0 640 170" role="img" aria-label="简历流水线:resume_zh.json 经 build_resume.py 变成 HTML,经 Chrome headless 打印成 PDF,再由 pdf_check.py 检查页数、链接和抽出的文字">
  <rect x="0" y="0" width="640" height="170" fill="var(--paper-raised)"/>
  <rect x="14" y="50" width="120" height="50" fill="var(--mem-wash)" stroke="var(--mem)"/>
  <text x="26" y="72" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">resume_zh</text>
  <text x="26" y="90" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">.json 内容</text>
  <rect x="170" y="50" width="120" height="50" fill="var(--mem-wash)" stroke="var(--mem)"/>
  <text x="182" y="72" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">.html</text>
  <text x="182" y="90" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">内容+样式</text>
  <rect x="326" y="50" width="120" height="50" fill="var(--compute-wash)" stroke="var(--compute)"/>
  <text x="338" y="72" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">.pdf</text>
  <text x="338" y="90" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">投出去的文件</text>
  <rect x="482" y="50" width="144" height="50" fill="var(--compute-wash)" stroke="var(--compute)"/>
  <text x="494" y="72" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">pdf_check</text>
  <text x="494" y="90" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">页数·链接·文字</text>
  <line x1="134" y1="75" x2="170" y2="75" stroke="var(--ink-faint)"/>
  <line x1="290" y1="75" x2="326" y2="75" stroke="var(--ink-faint)"/>
  <line x1="446" y1="75" x2="482" y2="75" stroke="var(--ink-faint)"/>
  <text x="136" y="126" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">build_resume.py</text>
  <text x="300" y="126" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">Chrome headless</text>
  <text x="14" y="154" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">检查的是最后那个 PDF,不是 HTML:招聘系统和 HR 拿到的只有它</text>
</svg>
<figcaption>今天的简历流水线。前两段你在浏览器里看得到,第三段要靠脚本,因为机器怎么读 PDF,眼睛看不出来。</figcaption>
</figure>

在 `agent-zero-lab/` 下执行。Chrome 的可执行文件藏在 .app 包里面,路径有空格,所以先存进一个变量,用的时候加双引号:

```bash
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
"$CHROME" --headless --no-pdf-header-footer --print-to-pdf=part09/out/resume_zh.pdf "file://$PWD/part09/out/resume_zh.html"
```

```text
[16032:1452823:1022/124832.582450:ERROR:ui/display/mac/cv_display_link_mac.mm:188] CVDisplayLinkCreateWithCGDisplay failed. CVReturn: -6670
253401 bytes written to file part09/out/resume_zh.pdf
```

第一行那个 ERROR 不用管,它是 Chrome 在无界面模式下找不到显示器时的抱怨,我每次跑都有,PDF 照常生成。看最后一行有「bytes written」就行。`--no-pdf-header-footer` 去掉打印时默认加在页眉页脚的日期、标题和文件路径,不加的话你的简历顶上会印着 `file:///Users/你的用户名/...`。`file://$PWD/...` 是本地文件的 URL,`$PWD` 是当前目录的绝对路径,Chrome 要的是绝对地址。Windows 读者 Chrome 的路径不一样,在命令行里通常是 `"C:\Program Files\Google\Chrome\Application\chrome.exe"`,这个我没有实跑过。

## 第六步:用 pypdf 检查 PDF

PDF 生成了,你打开看看,一页,链接是蓝的,好像没什么问题。但有几件事眼睛看不出来:链接是真的能点,还是只是蓝色的字;招聘系统把 PDF 转成文字时,读到的是什么。

这第二件事要多说一句。很多公司,尤其是海外和国内大厂,收简历用的是 ATS(Applicant Tracking System,招聘管理系统)。你上传 PDF 以后,系统先把里面的文字抽出来,存进数据库,HR 按关键词搜人、筛人。如果抽出来的文字是乱的,你的简历在搜索里就等于不存在,HR 根本看不到它长得多好看。

pypdf 是一个纯 Python 的 PDF 库,能读页数、读链接、抽文字,正好拿来模拟这一步。先装上:

```bash
uv add pypdf
```

```text
 + pypdf==6.21.2
```

pypdf 6.21.2 是 2026 年 10 月在 PyPI 上查到的最新版。

```python
# agent-zero-lab/part09/pdf_check.py
import re
import sys

from pypdf import PdfReader

MUST_READ = ["SupportPilot", "LangGraph", "77.5%", "工程师", "项目经历"]
RADICAL = re.compile(r"[\u2e80-\u2fdf]")


def pdf_check(path: str) -> list[str]:
    reader = PdfReader(path)
    problems: list[str] = []
    pages = len(reader.pages)
    if pages != 1:
        problems.append(f"{pages} 页,不是一页")
    links: list[str] = []
    for page in reader.pages:
        for annot in page.get("/Annots") or []:
            a = annot.get_object()
            if a.get("/Subtype") == "/Link" and "/A" in a:
                links.append(str(a["/A"].get("/URI")))
    print("链接:", links)
    if not any(u.startswith("https://github.com/") for u in links):
        problems.append("没有可点的 GitHub 链接")
    text = "".join(p.extract_text() for p in reader.pages)
    odd = sorted(set(RADICAL.findall(text)))
    if odd:
        problems.append(f"抽出了 {len(odd)} 种部首字符 {odd},机器读到的不是正常汉字")
    for word in MUST_READ:
        if word not in text:
            problems.append(f"抽出的文字里找不到「{word}」")
    print(f"{pages} 页,{len(links)} 个链接,抽出 {len(text)} 个字符")
    return problems


if __name__ == "__main__":
    print(pdf_check(sys.argv[1]) or "通过")
```

<div class="line-notes">

- `from pypdf import PdfReader` 读 PDF 只要这一个类。
- `MUST_READ = ["SupportPilot", "LangGraph", "77.5%", "工程师", "项目经历"]` 几个「HR 很可能会搜」的词。机器从 PDF 里读不出它们,就说明有问题。换成你简历上最关键的几个词。
- `RADICAL = re.compile(r"[\u2e80-\u2fdf]")` Unicode 里「部首补充」和「康熙部首」两个区块的范围。为什么要查它,跑完你就知道了。`\u2e80` 是用编号写一个字符,和 JS 正则里的写法一样。
- `reader = PdfReader(path)` 打开 PDF。
- `pages = len(reader.pages)` 页数。`reader.pages` 像一个列表,`len` 取长度。
- `for annot in page.get("/Annots") or []:` PDF 里的链接不是文字的一部分,而是盖在页面上的一块「注释」(annotation),记在每页的 `/Annots` 里。PDF 内部的键名都以 `/` 开头。没有注释的页 `get` 返回 None,`or []` 让循环什么都不做。
- `a = annot.get_object()` 注释在 PDF 里是一个引用,要 `get_object()` 才能拿到真正的内容。可以理解成指针解引用。
- `if a.get("/Subtype") == "/Link" and "/A" in a:` 只要类型是链接、而且带「动作」(`/A`)的注释。
- `links.append(str(a["/A"].get("/URI")))` 动作里的 `/URI` 就是链接地址。实跑拿到的第一个是 `mailto:zhangsan@example.com`。
- `if not any(u.startswith("https://github.com/") for u in links):` 至少要有一个能点的 GitHub 链接,这是 Agent 岗简历上最重要的一个链接。
- `text = "".join(p.extract_text() for p in reader.pages)` 把每页抽出来的文字连起来。这就是 ATS 能看到的全部内容。
- `odd = sorted(set(RADICAL.findall(text)))` 找出所有部首字符,去重排序。
- `if word not in text:` 关键词逐个查。

</div>

```bash
uv run python -m part09.pdf_check part09/out/resume_zh.pdf
```

```text
链接: ['mailto:zhangsan@example.com', 'https://github.com/zhangsan', 'https://demo.example.com/']
1 页,3 个链接,抽出 1096 个字符
["抽出了 19 种部首字符 ['⻅', '⻔', '⼀', '⼈', '⼊', '⼤', '⼩', '⼯', '⼿', '⽂', '⽇', '⽉', '⽌', '⽣', '⽤', '⽬', '⾃', '⾄', '⾏'],机器读到的不是正常汉字", '抽出的文字里找不到「工程师」', '抽出的文字里找不到「项目经历」']
```

一页、三个链接都对,但「工程师」和「项目经历」找不到。这两个词明明就印在纸上。

说实话,`RADICAL` 这条规则是我第一次跑出「找不到工程师」以后才加上的。当时我把 `text` 打印出来看,开头是这样的:

```text
前端⼯程师(3 年),近期专注 AI Agent 开发,做过带评测和注⼊测试的客服 Agent 与代码审查机器⼈。
```

肉眼看完全正常。但这里的「⼯」不是「工」,「⼈」不是「人」。前者是 U+2F2F,Unicode 里「康熙部首」区块的「工」字部首;后者才是我们平时打的 U+5DE5。两个字长得一模一样,对计算机来说是完全不同的字符,所以搜「工程师」搜不到「⼯程师」。你可以在 Python 里验证:`"⼯" == "工"` 是 False。

**原因在字体。** PDF 里记的其实是字形编号,另外附一张「这个字形对应哪个 Unicode 字符」的表,抽文字时靠这张表翻译。macOS 的苹方等字体在 Chrome 打出的 PDF 里,有一部分常用字(一、人、工、目、月、大……)的字形被映射到了康熙部首上。我换了几个字体各打一份 PDF 去抽,结果是这样:

| 字体 | 抽出来的「工程师」「项目」「一个月」 |
| --- | --- |
| PingFang SC(苹方) | ⼯程师、项⽬、⼀个⽉(部首) |
| Hiragino Sans GB(冬青黑体) | 同上 |
| Songti SC(宋体) | 同上 |
| Heiti SC | 同上,而且「目」变成了另一个部首 ⺫ |
| STHeiti(华文黑体) | 工程师、项目、一个月(正常) |

为了确认不是 pypdf 自己的毛病,我又用另一个库 pdfminer.six 抽了苹方和华文黑体两份,结果和 pypdf 一模一样,问题确实在 PDF 本身。

这会不会真的害你漏掉面试?我没法去测每家公司的 ATS。做得好的系统会先做 Unicode 规范化(NFKC),规范化以后康熙部首会被转回正常汉字,Python 里 `unicodedata.normalize("NFKC", "⼯")` 返回的就是「工」。但你没法知道对方用的系统做不做这一步,最稳的办法是让 PDF 里本来就是正常的字。

修法是改 `build_resume.py` 里 CSS 的一行,把华文黑体放第一位,后面跟 Windows 常见的微软雅黑:

```css
body { font-family: "STHeiti", "Microsoft YaHei", sans-serif; font-size: 10.5pt; line-height: 1.45; color: #111; }
```

微软雅黑那条我没在 Windows 上实跑过,用 Windows 的读者自己跑一遍 `pdf_check` 确认。用 Word、WPS 或者在线简历工具导出 PDF 的,同样拿这个脚本查一遍,哪个工具都可能有这个问题。

重新生成、打印、检查:

```bash
uv run python -m part09.build_resume part09/resume_zh.json
"$CHROME" --headless --no-pdf-header-footer --print-to-pdf=part09/out/resume_zh.pdf "file://$PWD/part09/out/resume_zh.html"
uv run python -m part09.pdf_check part09/out/resume_zh.pdf
```

```text
已写入 part09/out/resume_zh.html,2122 字符
89198 bytes written to file part09/out/resume_zh.pdf
链接: ['mailto:zhangsan@example.com', 'https://github.com/zhangsan', 'https://demo.example.com/']
1 页,3 个链接,抽出 1098 个字符
通过
```

(Chrome 那行 ERROR 我从这里开始省略了。)PDF 从 253401 字节变成 89198 字节,是因为嵌进去的字体换了,和内容无关。

### 再看两个更常见的错

字体那个坑比较隐蔽。更常见的是另外两种:链接写成了纯文本,以及东西太多挤成了两页。造一份坏简历试试,下面这个脚本复制一份 JSON,把所有 `href` 删掉,再塞进一个 12 条的「课程练习合集」和 Day 500 没进定稿的两条工作经历:

```python
# agent-zero-lab/part09/make_bad.py
import json
from pathlib import Path

d = json.loads(Path("part09/resume_zh.json").read_text(encoding="utf-8"))
for c in d["contact"]:
    c.pop("href", None)
d["projects"].append({
    "title": "课程练习合集", "meta": "2025.10 – 2026.10",
    "bullets": [f"练习 {i}:用 Python 写的小工具,包括天气 CLI、工单分类器、迷你账单库等若干小项目,用于学习基础语法和工程习惯。" for i in range(1, 13)],
})
d["work"][0]["bullets"] += [
    "参与排查 6 起线上白屏问题,用 Sentry 和浏览器 Performance 面板定位,其中 2 起是后端接口返回结构变了。",
    "负责前端埋点 SDK,统一了 40 多个页面的事件上报格式。",
]
Path("part09/resume_bad.json").write_text(json.dumps(d, ensure_ascii=False, indent=1), encoding="utf-8")
print("项目", len(d["projects"]), "个,工作要点", len(d["work"][0]["bullets"]), "条")
```

<div class="line-notes">

- `c.pop("href", None)` 删掉字典里的 `href` 键,没有就返回 None 不报错。相当于 JS 的 `delete c.href`。
- `"bullets": [f"练习 {i}:用 Python 写的小工具` 列表推导式造出 12 条几乎一样的要点。真实简历里这种「凑数的练习」我见过不少。
- `d["work"][0]["bullets"] += [` 工作经历从 4 条变 6 条。

</div>

```bash
uv run python -m part09.make_bad
uv run python -m part09.build_resume part09/resume_bad.json
"$CHROME" --headless --no-pdf-header-footer --print-to-pdf=part09/out/resume_bad.pdf "file://$PWD/part09/out/resume_bad.html"
uv run python -m part09.pdf_check part09/out/resume_bad.pdf
```

```text
项目 3 个,工作要点 6 条
已写入 part09/out/resume_bad.html,3035 字符
106228 bytes written to file part09/out/resume_bad.pdf
链接: []
2 页,0 个链接,抽出 1978 个字符
['2 页,不是一页', '没有可点的 GitHub 链接']
```

两个问题都抓到了。在浏览器里看 `resume_bad.html`,GitHub 地址照样显示在那里,但它就是一串字,点不动。

两页怎么改?不是缩字号、压行距,是删。课程练习合集整个删掉,那些练习的价值已经体现在两个作品里了;Day 500 没进定稿的两条,本来就是因为离 Agent 岗最远才没放。每次想往简历里加一条时问自己:面试官看到这条,会想追问吗?不会就别加。

## 证书:要不要考,考了写在哪

2026 年 Agent 方向出了好几个认证,常有人问考一个能不能补「没有 AI 工作经历」这块短板。先看招聘方怎么说。拿 Day 498 的五份 JD 数一下:

```python
# agent-zero-lab/part09/cert_count.py
import re

from part09.kw_count_v2 import load_jds

CERT = re.compile(r"证书|认证|certif\w*|ACP|AWS Certified|LCAE", re.I)

for jd in load_jds():
    hits = CERT.findall(jd["text"])
    print(f"{jd['id']:<14}{hits}")
```

<div class="line-notes">

- `CERT = re.compile(r"证书|认证|certif\w*|ACP|AWS Certified|LCAE", re.I)` 中英文和几个具体证书名。`certif\w*` 能匹配 certified、certification。`re.I` 忽略大小写。
- `hits = CERT.findall(jd["text"])` 返回所有命中的片段,没有就是空列表。

</div>

```bash
uv run python -m part09.cert_count
```

```text
tencent       []
netease       []
zhaopin_rag   []
zhaopin_fde   []
intercom_fde  []
```

五份一个都没提。五份太少,说明不了什么,站长的全量数据更有说服力:880 条 JD 里提到「持有某证书优先」的大约十来条,基本都是云厂商证书(阿里云、AWS、Azure、Google Cloud、Databricks),没有一条点名 LangChain 或 Anthropic 的认证,国内只有 1 条写了阿里云证书优先。招聘方筛人看的仍然是项目和能被追问的经验。

下面是 2026 年 10 月我查到的三个,以官方页面为准,价格这一年变过不止一次:

| 认证 | 考什么 | 费用和形式 | 我的看法 |
| --- | --- | --- | --- |
| LangChain Certified Agent Engineer(LCAE) | 构建、测试、部署、监控 Agent 四块各占 25%,围绕 LangChain、LangGraph、LangSmith | 官方页写的:99 美元,40 道选择题 120 分钟,答对 28 道通过,有效期 24 个月 | 和这门课第五、六部分重合度高,学完再考不难。投用 LangGraph 的公司有一点信号作用 |
| Claude Certified Architect(Anthropic) | Claude 上的 Agent、工具、MCP、上下文管理等架构设计 | 都是第三方文章汇总的:Foundations 级 125 美元一次(有文章说 2026 年 6 月 30 日从 99 美元涨上来),60 道情景选择题 120 分钟,Pearson VUE 监考;**只有 Claude 合作伙伴网络里的公司员工能报,要用公司邮箱** | 个人基本报不了。Anthropic Academy 的免费课程人人能学,值得刷 |
| 阿里云大模型 ACP | 提示词、RAG、微调、应用开发、多 Agent 与多模态、生产实践 | 官方有大纲变更公告;大模型方向的考试费我在官方页面没找到。阿里云其他方向的 ACP 是 1200 元一次(来自阿里云开发者社区的文章),报名前以认证官网为准 | 投阿里云生态的公司、外包和集成商有用;对大厂技术岗基本不加分 |

Claude 那一行我没有找到 Anthropic 自己的定价页,几个数字都来自第三方文章,彼此还有出入,你真要报名时以合作伙伴门户里看到的为准。

我的建议是**作品优先,证书可选**。你已经做完 SupportPilot 和代码审查机器人,如果还想再要一个能写进简历的东西,花 99 美元和一个周末考 LCAE 性价比还可以;作品没做完就去考证,是把时间花错了地方。

考过以后,写在简历最下面,一行就够,别放到顶部和项目抢位置:在 `resume_zh.json` 里填 `"certs": "LangChain Certified Agent Engineer(LCAE),2026.11"`,`build_resume` 会自动在教育下面加一个「证书」板块。面试被问到时,讲你在作品里怎么用这些东西,比讲考试本身有用得多。

还有一类要躲开:各种培训机构发的「AI 智能体工程师」「大模型应用开发师」证书,有的挂着某某协会的名头,收费几千到上万。招聘方基本不认,[Day 513](/blog/agent-zero/day-513-offer/) 讲避坑时还会提。

## 第七步:英文版

投新加坡、香港或海外远程岗,需要英文简历。不是把中文版机翻一遍,几处习惯不一样:

- 不写照片、年龄、婚育、籍贯。
- 每条要点用过去式动词开头:Built、Designed、Cut、Wrote。
- 数字照样要有,英文简历比中文更看重 impact(可量化的结果)。
- 一条一行到一行半,大约 20 到 30 个词。
- 口径写清楚:on 40 test tickets、across 6 PRs。

规则这么清楚,让模型来翻正合适,然后用脚本查。先翻译:

```python
# agent-zero-lab/part09/translate_en.py
import json
from pathlib import Path

from pydantic import BaseModel

from common.llm import LLMClient


class EnBullets(BaseModel):
    bullets: list[str]


SYSTEM = (
    "You translate Chinese resume bullets into English for an AI Agent Engineer role. "
    "Rules: one English bullet per Chinese bullet, same order; start with a past-tense verb "
    "(Built, Designed, Cut, Wrote...); keep every number exactly; keep tool names as they are; "
    "do not add anything not in the source; max 30 words each. "
    'Output JSON only: {"bullets": ["..."]}'
)

data = json.loads(Path("part09/resume_zh.json").read_text(encoding="utf-8"))
zh = [b for p in data["projects"] for b in p["bullets"]]

llm = LLMClient()
r = llm.chat(
    [{"role": "system", "content": SYSTEM}, {"role": "user", "content": json.dumps(zh, ensure_ascii=False)}],
    response_format={"type": "json_object"},
    temperature=0,
)
en = EnBullets.model_validate_json(r.content).bullets
Path("part09/out/bullets_en.json").write_text(json.dumps({"zh": zh, "en": en}, ensure_ascii=False, indent=1), encoding="utf-8")
for b in en:
    print("-", b)
print(f"\n{len(zh)} 条中文 → {len(en)} 条英文 | {r.prompt_tokens} 输入 / {r.completion_tokens} 输出 | ¥{r.cost:.5f}")
```

<div class="line-notes">

- `from common.llm import LLMClient` [Day 135](/blog/agent-zero/day-135-llm-client-1/) 封装的客户端,读 `agent-zero-lab/.env` 里的 `LLM_BASE_URL / LLM_API_KEY / LLM_MODEL`,`r.cost` 按自建账本算好了人民币。
- `class EnBullets(BaseModel):` 只要一个字段:英文要点的列表。
- `SYSTEM = (` 这次 system prompt 用英文写,因为要的是英文输出,英文指令让模型更少夹带中文习惯。几条规则就是上面那个列表。
- `"do not add anything not in the source; max 30 words each. "` 「不许加东西」和 Day 500 一样只是请求,后面靠脚本验。
- `zh = [b for p in data["projects"] for b in p["bullets"]]` 两层循环的推导式,把两个项目的要点摊平成一个列表,一共 6 条。相当于 JS 的 `data.projects.flatMap(p => p.bullets)`。今天只翻项目经历,工作经历是练习。
- `response_format={"type": "json_object"},` JSON mode,[Day 148](/blog/agent-zero/day-148-structured-2/) 讲过。
- `en = EnBullets.model_validate_json(r.content).bullets` 直接从 JSON 字符串校验,等于 `json.loads` 加 `model_validate` 两步合一。
- `Path("part09/out/bullets_en.json").write_text(` 中英文成对存下来,下一个脚本要逐条对比。

</div>

```bash
uv run python -m part09.translate_en
```

我实跑的输出:

```text
- Orchestrated nine nodes in LangGraph—classification, hybrid retrieval, MCP business tools, drafting, self-check—with refunds routed to human approval via interrupt; 77.5% end-to-end success on 40 test tickets.
- Built three-layer evaluation (rules, LLM review, trajectory) into GitHub Actions gates; 85% agreement between review and 40 manual spot checks, test success 55% → 77.5% after 4 iterations.
- Stabilized prompt prefix and routed models by difficulty, raising cache hit rate 31% → 78% on 60 dev cases, cutting cost per ticket ¥0.021 → ¥0.009.
- Designed 24 injection cases covering six attack types; bound identity at the tool layer with refunds request-only, cutting privilege-escalation and approval-bypass successes 3 → 0 across 8 cases.
- Parsed unified diffs and validated line numbers so comments land only on changed lines; recalled 14 of 20 bugs planted across 6 PRs.
- Wired into GitHub Actions to auto-comment on every PR, recalling 70% of 20 planted bugs with 73% usefulness across 52 comments.

6 条中文 → 6 条英文 | 372 输入 / 256 输出 | ¥0.00279
```

花费 ¥0.00279,算式 372 × 2 / 1,000,000 + 256 × 8 / 1,000,000 ≈ 0.00074 + 0.00205 = ¥0.00279。这是按 deepseek-flash 高峰价(输入未命中 2 元、输出 8 元每百万 token,2026 年 10 月查的 [DeepSeek 定价页](https://api-docs.deepseek.com/zh-cn/quick_start/pricing))算的。我跑的时候是北京时间 12 点 48 分,在午间低谷时段,低谷价是高峰的一半,实际扣费大约一半。

## 第八步:英文版的检查

查四样:开头像不像过去式动词;有没有残留汉字;词数超没超 30;数字有没有丢、有没有多。最后一条最重要,数字丢了或者变了,前面三天的对账就白做了。

```python
# agent-zero-lab/part09/en_check.py
import json
import re
from pathlib import Path

from part09.number_check import numbers_in

IRREGULAR = {"Built", "Wrote", "Ran", "Led", "Cut", "Set", "Made", "Drove"}
HAN = re.compile(r"[一-鿿]")


def en_check(zh: str, en: str) -> list[str]:
    problems: list[str] = []
    first = en.split()[0]
    if not (first.endswith("ed") or first in IRREGULAR):
        problems.append(f"开头「{first}」不像过去式动词")
    if HAN.search(en):
        problems.append("还有汉字")
    words = len(en.split())
    if words > 30:
        problems.append(f"{words} 个词,超过 30")
    lost = numbers_in(zh) - numbers_in(en)
    added = numbers_in(en) - numbers_in(zh)
    if lost:
        problems.append(f"丢了数字 {sorted(lost)}")
    if added:
        problems.append(f"多了数字 {sorted(added)}")
    return problems


if __name__ == "__main__":
    pair = json.loads(Path("part09/out/bullets_en.json").read_text(encoding="utf-8"))
    for i, (zh, en) in enumerate(zip(pair["zh"], pair["en"], strict=True), 1):
        print(i, en_check(zh, en) or "通过")
```

<div class="line-notes">

- `IRREGULAR = {"Built", "Wrote", "Ran", "Led", "Cut", "Set", "Made", "Drove"}` 不规则动词的过去式不以 ed 结尾,列几个简历里常用的。用到别的就往里加。
- `first = en.split()[0]` `split()` 不带参数时按任意空白切,取第一个词。
- `if not (first.endswith("ed") or first in IRREGULAR):` 以 ed 结尾或在白名单里就算过。这是很粗的规则,「Need」这种不是过去式的词也会被它放过,只是简历开头不会这么写。
- `lost = numbers_in(zh) - numbers_in(en)` 集合减法,中文里有、英文里没有的数字。Day 499 的 `numbers_in` 正好两边都能用,因为阿拉伯数字在中英文里写法一样。
- `added = numbers_in(en) - numbers_in(zh)` 反过来,英文里凭空多出来的。
- `for i, (zh, en) in enumerate(zip(pair["zh"], pair["en"], strict=True), 1):` `zip` 把两个列表一对一配起来,相当于 lodash 的 `_.zip`。`strict=True` 要求两边一样长,不一样就报错,防止模型少翻一条时你没发现。

</div>

```bash
uv run python -m part09.en_check
```

```text
1 通过
2 通过
3 通过
4 通过
5 通过
6 通过
```

全过。但我逐条读下来,至少有三处要改,和 Day 499、Day 500 一样,脚本查不出意思。

**第 1 条把「等」弄丢了。** 中文是「分类、混合检索、MCP 业务工具、起草、自检等九个节点」,英文变成了「nine nodes in LangGraph—classification, ..., self-check—」,用破折号把五个名字括起来,读起来就是「九个节点就是这五个」。Day 499 刚刚修过这个矛盾,翻译又把它带回来了。

**第 2 条的「LLM review」不是行话。** 英文 JD 和英文资料里这个东西叫 LLM-as-judge,海外面试官看到 LLM review 会愣一下。中文「LLM 评审」是我们自己的叫法,翻译时要换成对方圈子里的词。

**第 6 条没有主语。** 「Wired into GitHub Actions」,把什么接进去了?英文简历的要点可以省略「I」,但不能省掉宾语。

顺便还有一处脚本自己的毛病。第 1 条里的「LangGraph—classification」中间是破折号不是空格,`split()` 把它算成了一个词,所以这条的词数被算少了。练习 3 修它。

我改的定稿,同样过一遍检查:

```python
# agent-zero-lab/part09/en_final.py
import json
from pathlib import Path

from part09.en_check import en_check

zh = json.loads(Path("part09/out/bullets_en.json").read_text(encoding="utf-8"))["zh"]
FINAL_EN = [
    "Orchestrated a nine-node LangGraph workflow (classify, hybrid retrieval, MCP business tools, draft, self-check, etc.) with interrupt-based human approval for refunds; 77.5% end-to-end success on 40 test tickets.",
    "Built a three-layer eval (rules, LLM-as-judge, trajectory) gated in GitHub Actions; judge matched 40 human labels 85% of the time; test success 55% → 77.5% over 4 iterations.",
    "Stabilized the prompt prefix and routed models by difficulty, raising cache hit rate 31% → 78% on 60 dev tickets and cutting cost per ticket ¥0.021 → ¥0.009.",
    "Designed 24 injection cases across six attack types; bound identity at the tool layer and made refunds request-only, cutting privilege-escalation and approval-bypass successes 3 → 0 across 8 cases.",
    "Parsed unified diffs and validated line numbers so comments land only on changed lines; recalled 14 of 20 bugs planted across 6 PRs.",
    "Integrated the bot into GitHub Actions to comment on every PR; recalled 70% of 20 planted bugs, with 73% of 52 comments rated useful.",
]
for i, (z, e) in enumerate(zip(zh, FINAL_EN, strict=True), 1):
    print(i, len(e.split()), "词", en_check(z, e) or "通过")
```

<div class="line-notes">

- `"Orchestrated a nine-node LangGraph workflow` 五个名字放括号里加 etc.,和中文的「等」对上。
- `"Built a three-layer eval (rules, LLM-as-judge, trajectory)` LLM review 换成 LLM-as-judge;「85% agreement between review and 40 manual spot checks」改成「judge matched 40 human labels 85% of the time」,谁和谁一致说清楚了。
- `"Integrated the bot into GitHub Actions` 补上宾语 the bot;「73% usefulness」这种说法很别扭,改成「73% of 52 comments rated useful」,分母也清楚。
- `print(i, len(e.split()), "词", en_check(z, e) or "通过")` 顺便打出词数。

</div>

```bash
uv run python -m part09.en_final
```

```text
1 27 词 通过
2 28 词 通过
3 28 词 通过
4 29 词 通过
5 23 词 通过
6 24 词 通过
```

把这六条写进一份 `resume_en.json`(结构和中文那份一样,`headline` 改成英文,去掉期望城市那类国内习惯),用同一套 `build_resume` 和 `pdf_check` 出 PDF。英文版的 `MUST_READ` 里中文词要换掉,否则会报找不到。

海外 JD 里「面向客户 / 交付」的比例接近一半,很多岗位叫 Forward Deployed Engineer 或 Applied AI Engineer。如果你投这类岗位,英文版要有体现「和客户或业务方一起定需求、交付、迭代」的经历,[Day 512](/blog/agent-zero/day-512-remote-fde/) 会专门讲。

### 零件和最后的流程

| 零件 | 哪个文件 | 管什么 |
| --- | --- | --- |
| 代表项目说明 | `story.md` + `story_check.py` | 四问齐全、长度、数字对账 |
| 简历内容 | `resume_zh.json` | 要点从 Day 499、500 的定稿搬来 |
| 排版 | `build_resume.py` | JSON → HTML,板块顺序 `order` |
| 打印 | Chrome headless | HTML → PDF |
| 机器眼里的简历 | `pdf_check.py` | 一页、链接能点、抽出正常汉字和关键词 |
| 英文版 | `translate_en.py` + `en_check.py` | 动词开头、词数、数字不丢不多 |

每次改了 JSON,三条命令重跑一遍(build、Chrome、pdf_check),绿了再投。

## 动手练习

**练习 1:「效果」里至少两个数字。** 代表项目说明最常见的偷懒,是「效果」那一节写成「效果明显,成本大幅降低」。给 `story_check` 加一条:「效果」小节里至少要有 2 个数字。不要改 `story_check.py` 原文件,写一个新函数包一层,用定稿和一个空话版测试。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part09/ex/ex501_effect.py
from pathlib import Path

from part09.number_check import numbers_in
from part09.story_check import TOKEN_NUM, split_sections, story_check


def story_check2(md: str, known: set[str]) -> list[str]:
    problems = story_check(md, known)
    effect = TOKEN_NUM.sub("", split_sections(md).get("效果", ""))
    if len(numbers_in(effect)) < 2:
        problems.append(f"「效果」里只有 {len(numbers_in(effect))} 个数字,至少要 2 个")
    return problems


known = numbers_in(Path("part09/results.md").read_text(encoding="utf-8"))
good = Path("part09/story.md").read_text(encoding="utf-8")
vague = good.replace(
    good.split("## 效果")[1].split("## 再来一次")[0],
    "\n上线后效果明显,成功率和成本都有大幅改善,安全测试全部通过。\n\n",
)
print("原稿:", story_check2(good, known) or "通过")
print("空话版:", story_check2(vague, known))
```

<div class="line-notes">

- `from part09.story_check import TOKEN_NUM, split_sections, story_check` 复用正则和两个函数。`story_check.py` 有 `if __name__ == "__main__":`,import 时不会去读 `sys.argv[1]`。如果没有这个保护,这里会直接报 `IndexError`。
- `effect = TOKEN_NUM.sub("", split_sections(md).get("效果", ""))` 只取「效果」那一节,同样先抹掉 BM25 这种词。
- `if len(numbers_in(effect)) < 2:` 定稿的效果节有 55%、77.5%、0.021、0.009、24、3、0、40 一共 8 个不同的数。
- `good.split("## 效果")[1].split("## 再来一次")[0]` 取出「效果」标题和「再来一次」标题之间的原文,再用 `replace` 换成一句空话,造一个坏样本。

</div>

```bash
uv run python -m part09.ex.ex501_effect
```

```text
原稿: 通过
空话版: ['汉字 242 个,不在 250–380 之间', '「效果」里只有 0 个数字,至少要 2 个']
```

空话版连字数都不够了。这不是巧合:有数字的句子要写口径,自然就长;空话一句就说完了。

</details>

**练习 2:观察题。板块顺序换一下。** 如果你原来的工作就是做 AI 相关的,工作经历应该放前面。用 `build` 函数出两份 PDF,一份项目在前,一份工作在前,用 pypdf 抽文字,看「项目经历」和「工作经历」两个标题分别在第几个字符。想一想:这个位置对一个按关键词搜人的 HR 有影响吗?对一个只看 6 秒的 HR 呢?

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part09/ex/ex501_order.py
import json
import subprocess
from pathlib import Path

from pypdf import PdfReader

from part09.build_resume import build

CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
data = json.loads(Path("part09/resume_zh.json").read_text(encoding="utf-8"))

for name, order in {
    "proj_first": ["skills", "projects", "work", "education"],
    "work_first": ["skills", "work", "projects", "education"],
}.items():
    html = Path(f"part09/out/{name}.html").resolve()
    html.write_text(build(data, order), encoding="utf-8")
    pdf = html.with_suffix(".pdf")
    pdf.unlink(missing_ok=True)
    subprocess.run(
        [CHROME, "--headless", "--disable-gpu", "--no-pdf-header-footer", f"--print-to-pdf={pdf}", html.as_uri()],
        capture_output=True,
    )
    assert pdf.exists(), "Chrome 没写出 PDF"
    text = PdfReader(pdf).pages[0].extract_text()
    print(f"{name}  项目经历在第 {text.index('项目经历')} 个字符,工作经历在第 {text.index('工作经历')} 个字符")
```

<div class="line-notes">

- `import subprocess` 在 Python 里运行外部命令,相当于 Node 的 `child_process`。
- `html = Path(f"part09/out/{name}.html").resolve()` `resolve()` 变成绝对路径,Chrome 要绝对地址。
- `pdf = html.with_suffix(".pdf")` 换扩展名,`.../proj_first.html` 变 `.../proj_first.pdf`。
- `pdf.unlink(missing_ok=True)` 先删掉旧的 PDF,下面才能用「文件存不存在」判断 Chrome 成没成功。
- `subprocess.run(` 命令和参数写成列表,每个元素是一个参数,路径里有空格也不用加引号。`capture_output=True` 把 Chrome 那行 ERROR 收起来,不打到屏幕上。
- `assert pdf.exists(), "Chrome 没写出 PDF"` 我一开始写的是 `check=True`(退出码不是 0 就抛异常),结果连续跑两次时 Chrome 偶尔返回退出码 2,stderr 里写着 `Teardown watchdog expired`,但 PDF 其实已经写好了。所以改成看文件在不在。
- `text.index('项目经历')` 返回子串第一次出现的位置,找不到会抛 `ValueError`。字体没改对时这里就会炸,因为抽出来的是「项⽬经历」。

</div>

```bash
uv run python -m part09.ex.ex501_order
```

```text
proj_first  项目经历在第 323 个字符,工作经历在第 835 个字符
work_first  项目经历在第 547 个字符,工作经历在第 323 个字符
```

对按关键词搜人的 HR(或者 ATS),没有区别:两份 PDF 里的词一个不少,搜「LangGraph」两份都能搜到。对只扫几秒的 HR,区别很大:第 323 个字符大概是页面的上三分之一,人眼最先看的地方。所以顺序是给人看的,不是给机器看的。转方向的人把项目放在那里,是因为 HR 扫完上三分之一,得知道你会做 Agent。

</details>

**练习 3:修词数统计。** `en_check` 用 `split()` 数词,第 1 条机翻里「LangGraph—classification」被算成一个词。改成同时按空白、破折号(—)和 en dash(–)切,对比 6 条机翻要点的两种词数。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part09/ex/ex501_words.py
import json
import re
from pathlib import Path

WORD_SPLIT = re.compile(r"[\s—–]+")

pair = json.loads(Path("part09/out/bullets_en.json").read_text(encoding="utf-8"))
for i, en in enumerate(pair["en"], 1):
    old = len(en.split())
    new = len([w for w in WORD_SPLIT.split(en) if w])
    flag = "超了" if new > 30 else ""
    print(f"{i}  split()={old:<3} 新算法={new:<3} {flag}")
```

<div class="line-notes">

- `WORD_SPLIT = re.compile(r"[\s—–]+")` 字符集合里放空白、em dash、en dash,`+` 表示连着的几个当一处切。这几个横线和 Day 500 那个 en dash 坑是同一类东西,从这一行复制,别手打。
- `new = len([w for w in WORD_SPLIT.split(en) if w])` 切完可能有空字符串(比如句子以横线开头),`if w` 把它们滤掉。
- `flag = "超了" if new > 30 else ""` 超过 30 个词才标记。

</div>

```bash
uv run python -m part09.ex.ex501_words
```

```text
1  split()=26  新算法=28  
2  split()=28  新算法=28  
3  split()=26  新算法=26  
4  split()=28  新算法=28  
5  split()=23  新算法=23  
6  split()=21  新算法=21  
```

第 1 条从 26 变成 28,两个破折号各藏了一个词。这次没超 30,但模型多用几个破折号就会超而不报。要不要把它合进 `en_check`,看你:我会合,因为英文简历里本来就不该用这么多破折号。

</details>

**验收标准**

- 你的代表项目说明四问齐全,`story_check` 通过,而且「再来一次」里写的是真实的不足。
- 你有一份自己的 `resume_zh.json`,打出来的 PDF 用 `pdf_check` 检查通过:一页、GitHub 链接能点、抽出的文字里没有部首字符,你最关键的五个词都能搜到。
- 你想清楚了证书考不考,如果考,它在简历最下面一行。
- 英文版要点 `en_check` 通过,你逐条读过,改掉了脚本查不出的问题(行话、主语、「等」这类)。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 代表项目说明 | 简历之外单独要的一段项目介绍,常见是「数据从哪来、怎么处理、效果、再来一次怎么改」四问 |
| ATS | Applicant Tracking System,招聘管理系统。收简历后先抽文字入库,HR 按关键词搜和筛 |
| headless | 浏览器不开窗口、在后台运行的模式,常用来截图、打 PDF、跑自动化测试 |
| `@page` | CSS 里只在打印时生效的规则,设纸张大小和页边距 |
| pypdf | 纯 Python 的 PDF 库,能读页数、链接、抽文字 |
| 注释(annotation) | PDF 里盖在页面上的附加对象,可点击的链接就是一种注释,不是文字本身 |
| 康熙部首 | Unicode 里 U+2F00 起的一组部首字符,和常用汉字长得一样但编码不同,搜索时对不上 |
| NFKC | 一种 Unicode 规范化方式,能把康熙部首、全角字母等「长得像」的字符转成标准形式 |
| LCAE | LangChain Certified Agent Engineer,LangChain 官方的 Agent 工程师认证,99 美元 |
| impact | 英文简历里指工作带来的可量化结果 |

## 常见误区

**PDF 看着没问题就是没问题。** 今天的苹方版本,打开看一页、链接是蓝的、字也清楚,机器抽出来却是「⼯程师」。给人看和给机器看是两件事,投之前跑一遍 `pdf_check`。

**链接是蓝色的就能点。** `resume_bad.pdf` 里 GitHub 地址照样印着,注释一个都没有。检查链接要看 PDF 里有没有 `/Link` 注释,或者至少自己点一下。

**两页就缩字号。** 字号压到 9pt、行距压到 1.1,一页是塞下了,HR 也看不下去了。超页是取舍的问题,删掉面试官不会追问的东西。

**代表项目说明只讲好的。** 「再来一次」那一问是故意给你的台阶,说得出不足的人才像做过的人。写不出来,通常说明你没回头看过自己的项目。

**证书能补没有 AI 工作经历的短板。** 880 条 JD 里提证书的十来条,全是云厂商的。先有作品,证书是锦上添花,而且只占简历最下面一行。

**英文版就是翻译。** 「LLM 评审」翻成 LLM review 一个词都没翻错,但不是对方圈子里的说法。用英文 JD 里出现的词,不用你自己的叫法。

**`subprocess.run(..., check=True)` 一定靠得住。** Chrome 无界面模式偶尔在 PDF 已经写好之后返回非零退出码。判断成没成功,看你要的那个结果在不在。

## 学习资料

### 文档与文章

- [Harvard FAS Mignone Center · Create a Strong Resume](https://careerservices.fas.harvard.edu/resources/create-a-strong-resume/):哈佛就业中心的英文简历指南,有动词表和改写前后的例子,写英文版时对照看,30 分钟。
- [LangChain · LCAE 认证页](https://academy.langchain.com/pages/certifications-lcae) 和 [模拟考](https://academy.langchain.com/courses/lcae-practice-exam):考试范围、费用、题量,决定考之前先做一遍模拟考看差多少,1 小时。
- [Anthropic Academy](https://anthropic.skilljar.com/):Anthropic 的免费课程,认证报不了也可以学,挑和 Agent、MCP 相关的。
- [阿里云认证官网](https://edu.aliyun.com/certification/) 和 [大模型 ACP 考试大纲变更公告](https://help.aliyun.com/zh/document_detail/2986614.html):题量和模块比例看公告,费用去认证官网查。
- [pypdf 文档](https://pypdf.readthedocs.io/en/stable/):查「Extract Text」和「Reading PDF annotations」两节,对照今天的 `pdf_check`。
- [Chrome for Developers · Headless Chrome](https://developer.chrome.com/docs/chromium/headless):无界面模式的官方说明,`--print-to-pdf` 等参数在这里。
- [Unicode 康熙部首码表(PDF)](https://www.unicode.org/charts/PDF/U2F00.pdf):翻一下就知道「⼯」「⼈」「⽬」长什么样、编号是多少。
- [Python 文档 · unicodedata](https://docs.python.org/zh-cn/3.12/library/unicodedata.html):`normalize` 函数,NFKC 是什么。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1d6pCzWEP1&autoplay=0&high_quality=1" title="为啥简历被秒挂?ATS机筛系统规则揭秘" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>Melissa职业规划 · 为啥简历被秒挂?ATS机筛系统规则揭秘 · 9 分钟,讲招聘系统怎么解析和筛简历,看完就明白为什么今天要查 PDF 抽出来的文字。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV16t4y1a7jn&autoplay=0&high_quality=1" title="结合哈佛就业中心建议II手把手教你写出完美的英文简历" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>两颗土桃 · 结合哈佛就业中心建议II手把手教你写出完美的英文简历 · 20 分钟,2020 年的视频,讲英文简历的结构、动词开头和量化写法,和上面那份哈佛指南配着看。不是针对技术岗的,挑结构和要点写法那几段。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/ea45OfTx3w0" title="How recruiters actually review your resume | Ask a Recruiter" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Microsoft Learn · How recruiters actually review your resume | Ask a Recruiter · 微软招聘官讲他们实际怎么看简历,适合准备英文版时看,注意他讲的先看哪一块。</figcaption>
</figure>

### 书籍

- Gergely Orosz《The Tech Resume Inside Out》(自出版,2020):讲一页结构、链接、不同资历的写法,今天读版面结构和「side projects」那两章,1 小时。
- Gayle Laakmann McDowell《Cracking the Coding Interview》(第 6 版,CareerCup,2015;中文版《程序员面试金典》,人民邮电出版社):开头讲简历的那一章篇幅不长,讲招聘方几秒钟扫什么,英文简历的写法可以参考,30 分钟。

### 开源项目与代码

- [jsonresume/resume-schema](https://github.com/jsonresume/resume-schema):用 JSON 描述简历的开源格式,思路和今天的 `resume_zh.json` 一样,字段更全,有很多现成主题。
- [rendercv/rendercv](https://github.com/rendercv/rendercv):Python 写的工具,YAML 写内容,一条命令出 PDF,英文简历做得很干净。
- [AmruthPillai/Reactive-Resume](https://github.com/AmruthPillai/Reactive-Resume):开源的简历编辑器,可以自托管,导出的 PDF 记得也用 `pdf_check` 查一遍。

## 自测

1. 代表项目说明的四个问题是什么?为什么最后一问不能省?

<details><summary>答案</summary>

数据从哪来、怎么处理、效果多少、再来一次怎么改。最后一问是主动展示你回头看过自己的项目:说得出真实的不足和下一步(比如「先做错误分析再决定要不要换模型」),面试官会更相信你做过;省掉它,项目听起来完美无缺,反而让人开始找破绽。

</details>

2. `story_check` 第一次把「BM25」里的 25 报成了记录表里没有的数字。为什么?怎么修?修法有什么代价?

<details><summary>答案</summary>

`numbers_in` 的正则 `\d+(?:\.\d+)?%?` 只认数字,不管前面是不是贴着字母,所以 BM25、GPT4 里的数字也被收进来。修法是对账前先用 `[A-Za-z]+\d+` 把这类词替换成空字符串。代价是「Top5」这种写法里的 5 也被抹掉,不再检查。

</details>

3. 一份 PDF 简历打开看完全正常,但用 pypdf 抽出来搜不到「工程师」。最可能是什么原因?怎么确认、怎么修?

<details><summary>答案</summary>

字体的映射把部分常用字形映射到了 Unicode 康熙部首(如「⼯」U+2F2F),长得一样但编码不同。确认方法:把抽出的文字里 U+2E80–U+2FDF 范围的字符找出来,或者直接比较 `"⼯" == "工"`。修法:换一个抽出来是正常汉字的字体(本文实测 macOS 上的 STHeiti 可以),重新打 PDF 再检查。读的一方做 NFKC 规范化也能转回来,但你控制不了对方的系统。

</details>

4. 简历超了半页,你会怎么处理?

<details><summary>答案</summary>

删内容,不压字号行距。按「面试官看到会不会想追问」逐条过:凑数的练习、离目标岗位最远的工作要点先删。今天的坏简历就是删掉「课程练习合集」和两条无关工作经历回到一页的。

</details>

5. (面试题)「你简历上写了 LCAE 认证,说说你考它学到了什么?」怎么答比较好?

<details><summary>答案</summary>

别讲考试本身(题型、分数),讲它对应的能力在你作品里怎么落地:比如「考试四块是构建、测试、部署、监控 Agent,我在 SupportPilot 里对应做了 LangGraph 编排加 interrupt 审批、三层评测接 CI、Docker 化上线、Langfuse 追踪」,再挑一个你最熟的展开。证书是话头,作品才是答案。

</details>

6. 英文版要点 `en_check` 全部通过,为什么还要人工读一遍?举一个今天实跑里的例子。

<details><summary>答案</summary>

脚本只查字面:开头动词、词数、数字。意思和用词它查不了。今天的例子:机翻把「LLM 评审」译成 LLM review,海外的说法是 LLM-as-judge;第 6 条「Wired into GitHub Actions」缺宾语;第 1 条丢了「等」,让九个节点和五个名字对不上。三条都通过了检查。

</details>

## 明天预告

Day 502 · 面试(一):模型、提示词与结构化输出题。简历投出去,第一轮技术面基本是基础概念加项目追问。项目追问你这四天准备得够多了,明天开始刷基础题,先从第二部分学过的模型、提示词和结构化输出开始,每道题限时出声答,再用实跑的小实验给答案找证据。
