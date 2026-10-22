---
title: 'Day 399 · 成本(三):模型路由'
description: '分类只要挑一个词,起草要写一段不乱承诺的回复,它们不必用同一个模型。今天先按节点给工单 worker 指定模型,把起草换成 deepseek-v4-pro,算出单工单成本涨到 3 倍;再写一个规则检查器给草稿打分,比较 flash、pro 和「flash 先写、不合格再交给 pro」的级联。实测级联在我们的系统里几乎不省钱,反而是改一句提示词让 flash 从 3/8 提到 7/8。'
pubDate: 2026-10-23
regime: none
tags: ['cost', 'routing', 'deepseek', 'agent-zero']
series: 'agent-zero'
day: 399
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 398](/blog/agent-zero/day-398-week57-review/) 把这一周拼成了一个 70 行的批量起草脚本:总时限防卡死,进度文件让崩溃后接着跑,调用一返回就记账,规范放在最前面命中缓存。成本这条线到目前为止做了两件事:[Day 396](/blog/agent-zero/day-396-cost-1/) 把每次调用的钱算清楚,[Day 397](/blog/agent-zero/day-397-prompt-caching/) 让长规范按 1/50 的价格收。还有一个变量一直没动过:**用哪个模型**。整个 worker 从 classify 到 draft 都用 `deepseek-flash`。今天回答两个问题:不同的节点该不该用不同的模型;能不能先让便宜模型试,不行再换贵的。

## 今天要解决的问题

今天结束时你应该能:

1. 写一个按节点选模型的 `routing.py`,让工单 worker 的 classify 和 draft 各用各的模型,并且能从环境变量切换;知道这个配置是在 import 时读的。
2. 改造报表,按每次调用实际用的模型算钱,算出「起草换成 pro」后单工单成本变成多少。
3. 写一个规则检查器给草稿打分,用同一组 8 张工单比较 flash 和 pro 的通过率与花费。
4. 实现「便宜模型先写、不合格再交给贵模型」的级联,并能算出它在什么升级比例下才比直接用贵模型便宜。

预计用时 2.5 小时。前置:[Day 394](/blog/agent-zero/day-394-ticket-worker/) 的工单 worker、[Day 396](/blog/agent-zero/day-396-cost-1/) 的 `pricing.py` 和 usage 日志、[Day 397](/blog/agent-zero/day-397-prompt-caching/) 的 `policy.py`、`ask_metered(..., system=...)` 和 `cache_report.py`。

学法:先对照逐行敲一遍(不复制粘贴)并跑通;第二天合上文章默写核心部分;做练习,做不出再展开参考答案,看完关掉重写一遍。

## 先从前端看:图片的 srcset

前端做图片优化时,你不会给所有设备都发 4K 大图。`<img srcset>` 让浏览器按屏幕宽度和像素密度挑一张合适的:手机拿 640 宽的,视网膜大屏拿 2560 宽的。图片质量够用就行,多出来的像素是白花的流量。

模型路由是同一个思路:**按活的难度挑模型**。我们的工单 worker 有两个调模型的节点,难度差得很远:

- classify:从 billing / tech / other 三个词里挑一个,输出 1–2 个 token。
- draft:读事实、守规范,写一段不超过 80 字、不乱承诺的回复。

让它们用同一个模型,要么是 classify 在用大炮打蚊子,要么是 draft 在用小刀砍树。今天讲两种分工的办法:**静态路由**(按节点写死用哪个模型)和**级联**(cascade,先便宜后贵,看结果决定要不要升级)。

先看价格差多少。Day 396 抄的 DeepSeek 价格表(元/百万 token,高峰价;空闲价全部减半):

| 模型 | 缓存命中输入 | 未命中输入 | 输出 |
| --- | --- | --- | --- |
| `deepseek-flash` | 0.04 | 2 | 8 |
| `deepseek-v4-pro` | 0.30 | 9 | 27 |
| pro ÷ flash | 7.5 倍 | 4.5 倍 | 3.4 倍 |

注意第一列:命中缓存的输入,pro 贵了 7.5 倍,比其他两列差得都多。我们的 draft 九成输入都是命中缓存的规范,这个倍数后面会体现在账单上。

## 第一步:按节点选模型

最简单的路由就是一张表:节点名 → 模型名。

```python
# agent-zero-lab/part07/routing.py
import os

# 每个节点用哪个模型。默认全是便宜模型,评测证明需要时再升级某一个节点
NODE_MODELS = {
    "classify": os.getenv("MODEL_CLASSIFY", "deepseek-flash"),
    "draft": os.getenv("MODEL_DRAFT", "deepseek-flash"),
}


def model_for(node: str) -> str:
    return NODE_MODELS.get(node, os.getenv("LLM_MODEL", "deepseek-flash"))
```

<div class="line-notes">

- `# 每个节点用哪个模型。默认全是便宜模型,评测证明需要时再升级某一个节点` 默认值的选择本身就是一个立场:先全部用便宜的,哪个节点质量不够、有数据证明换了能好,再单独升级它。反过来「全用最好的,哪里贵了再降」,你很难找到降级的理由。
- `NODE_MODELS = {` 键要和 `ticket_agent.py` 里调 `ask_metered` 时传的节点名一致,也就是 `"classify"` 和 `"draft"`。
- `"classify": os.getenv("MODEL_CLASSIFY", "deepseek-flash"),` 环境变量 `MODEL_CLASSIFY` 设了就用它,没设用 flash。上线后想换模型改环境变量、重启 worker 就行,不用改代码。
- `def model_for(node: str) -> str:` 调模型前问一句:这个节点该用谁。
- `return NODE_MODELS.get(node, os.getenv("LLM_MODEL", "deepseek-flash"))` 表里没有的节点(比如 Day 395 Temporal 那边调 `ask` 时传的 `"ask"`)用全局默认,也就是 `.env` 里的 `LLM_MODEL`。`dict.get(键, 默认值)` 相当于 JS 的 `map[k] ?? 默认值`。

</div>

这个文件有个容易踩的坑,先演示一下:

```python
# agent-zero-lab/part07/routing_peek.py
import os

from part07.routing import NODE_MODELS, model_for

print("启动时:", NODE_MODELS)
print("draft →", model_for("draft"), "  lookup →", model_for("lookup"))
os.environ["MODEL_DRAFT"] = "deepseek-v4-pro"
print("改了环境变量以后 draft →", model_for("draft"))
```

<div class="line-notes">

- `print("draft →", model_for("draft"), "  lookup →", model_for("lookup"))` `lookup` 不在表里,看它是不是走了默认值。
- `os.environ["MODEL_DRAFT"] = "deepseek-v4-pro"` 在程序运行中改环境变量。`os.environ` 像一个字典,相当于 Node 的 `process.env`。
- `print("改了环境变量以后 draft →", model_for("draft"))` 看改动有没有生效。

</div>

```bash
cd agent-zero-lab
uv run python -m part07.routing_peek
MODEL_DRAFT=deepseek-v4-pro uv run python -m part07.routing_peek
```

```text
启动时: {'classify': 'deepseek-flash', 'draft': 'deepseek-flash'}
draft → deepseek-flash   lookup → deepseek-flash
改了环境变量以后 draft → deepseek-flash
启动时: {'classify': 'deepseek-flash', 'draft': 'deepseek-v4-pro'}
draft → deepseek-v4-pro   lookup → deepseek-flash
改了环境变量以后 draft → deepseek-v4-pro
```

第一次运行,程序里改了 `MODEL_DRAFT`,`model_for("draft")` 还是 flash。原因是 `NODE_MODELS` 是模块级的字典,`os.getenv` 只在 **import 那一刻**执行一次,之后它就是一个普通的字典,不会再去读环境变量。第二次在命令行前面设好环境变量再启动,才生效。

这正好对应 Day 394 那条坑:「改了代码不重启 worker」。配置也一样,worker 是常驻进程,换模型要重启。如果你需要不重启就能切(比如线上出事要立刻把 draft 降级),就得让 `model_for` 每次都去读一个能变的地方(环境变量、Redis 里的一个键、配置中心),代价是每次调用多一次读取。今天不需要,知道有这个取舍就行。

## 第二步:让 worker 按节点选模型

`ticket_agent.py` 改两处。`ask_metered` 不再用全局的 `MODEL`,而是问 `model_for(node)`;另外加一个 `model` 参数,允许调用方临时指定(第五步的级联要用):

```python
# agent-zero-lab/part07/ticket_agent.py(改动部分)
from part07.routing import model_for


async def ask_metered(
    node: str, prompt: str, max_tokens: int, ticket_id: str = "", system: str = "", model: str = ""
) -> tuple[str, dict]:
    messages: list[ChatCompletionMessageParam] = [{"role": "system", "content": system}] if system else []
    messages.append({"role": "user", "content": prompt})
    resp = await llm.chat.completions.create(
        model=model or model_for(node),
        messages=messages,
        max_tokens=max_tokens,
        extra_body=EXTRA,
    )
    # 下面记 usage、写日志的部分和 Day 396 完全一样
```

<div class="line-notes">

- `from part07.routing import model_for` 加在文件开头的 import 区。
- `node: str, prompt: str, max_tokens: int, ticket_id: str = "", system: str = "", model: str = ""` 新参数 `model` 默认空字符串,不传就走路由表。classify 和 draft 两个节点的调用都不用改。
- `model=model or model_for(node),` `or` 在这里是「前面是空的就用后面的」,相当于 JS 的 `model || modelFor(node)`。空字符串在 Python 里也算假值,和 JS 一样。
- `extra_body=EXTRA,` 还是 `.env` 里那个关掉思考模式的参数。我试过 `deepseek-v4-pro` 也接受 `{"thinking": {"type": "disabled"}}`,两个模型可以共用。

</div>

记账那部分不用改,Day 396 写的时候就用的是 `resp.model`(响应里实际的模型名),当时说的理由就是「以后做模型路由」。但报表要改:`cache_report.py` 里算钱时模型名是写死的 `"deepseek-flash"`,pro 的调用会按 flash 的价格算,少算好几倍。改成用每条记录自己的模型:

```python
# agent-zero-lab/part07/cache_report.py(改两行)
        real += call_cost(c["model"], c["prompt"], c["hit"], c["completion"], period)
        full += call_cost(c["model"], c["prompt"], 0, c["completion"], period)
```

<div class="line-notes">

- `real += call_cost(c["model"], c["prompt"], c["hit"], c["completion"], period)` 日志里的 `model` 是 `deepseek-flash` 或 `deepseek-v4-pro`,和 `PRICES` 的键一模一样,直接查得到。如果哪天厂商返回的模型名带了版本后缀(比如 `deepseek-v4-pro-0813`),这里会 `KeyError`,Day 396 说过这是故意的:宁可报错,也不要按错的价格算。
- `full += call_cost(c["model"], c["prompt"], 0, c["completion"], period)` 「不算缓存」的原价也要按各自的模型算。

</div>

## 第三步:起草换成 pro,一张工单贵多少

worker 不用改任何代码,启动时设环境变量就行。新开一批 S,和 Day 397 定稿的 R 批(全部 flash)对比:

```bash
uv run python -m part07.ticket_intake S 8
MODEL_DRAFT=deepseek-v4-pro uv run arq --burst part07.ticket_worker.WorkerSettings
uv run python -m part07.cache_report S
uv run python -m part07.cache_report R
```

```text
classify  调用  8 次  输入    290  命中      0(0%)  实付 0.0346 分  不算缓存 0.0346 分
draft     调用  6 次  输入  14530  命中  13824(95%)  实付 0.8437 分  不算缓存 6.8571 分
合计 实付 0.8783 分,不算缓存 6.8917 分,省了 87%
classify  调用  8 次  输入    290  命中      0(0%)  实付 0.0346 分  不算缓存 0.0346 分
draft     调用  6 次  输入  14536  命中  13312(92%)  实付 0.2622 分  不算缓存 1.5668 分
合计 实付 0.2968 分,不算缓存 1.6014 分,省了 81%
```

(两批都是凌晨跑的,空闲价。)

classify 两批一模一样,说明路由表起作用了:只有 draft 换了模型。draft 从 0.26 分涨到 0.84 分,**3.2 倍**;整批从 0.30 分涨到 0.88 分,**3 倍**。

为什么不是表上的 4.5 倍或 7.5 倍?因为 draft 的钱由三块组成,各自的倍数不同。拿同一种工单的两次 draft 手算(空闲价,pro 是 0.15 / 4.5 / 13.5,flash 是 0.02 / 1 / 4)。日志里 S-01(pro)输入 2447、命中 2304、输出 44;R-01(flash)输入 2448、命中 2304、输出 58:

```text
pro:   2304 × 0.15 + 143 × 4.5 + 44 × 13.5 = 345.6  + 643.5 + 594 = 1583.1
flash: 2304 × 0.02 + 144 × 1   + 58 × 4    =  46.08 + 144   + 232 =  422.08
```

1583.1 ÷ 422.08 ≈ 3.75 倍。三块里命中部分贵 7.5 倍,但它本来就便宜,占的钱不多;真正的大头是没命中的那 143 个 token 和输出,它们只贵 4.5 倍和 3.4 倍。再加上这次 pro 的回复比 flash 短(44 对 58),整批平均下来就是 3.2 倍。

还有一件事:S 批的 6 次 draft 全部命中了 2304 个 token。这是因为我在跑 S 之前已经用 pro 调过几次同样的规范(下一步的实验)。**每个模型的缓存是分开的**,flash 上建好的规范缓存,pro 用不上。第一次把某个节点换到新模型,前几次调用是按原价付的,下一步的实验里能直接看到。

<figure>
<svg viewBox="0 0 640 250" role="img" aria-label="两种路由方式:静态路由按节点查表,classify 用 flash,draft 用 pro;级联是 draft 先用 flash 写,规则检查通过就直接用,不通过再交给 pro 重写">
<text x="20" y="24" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">两种分工</text>
<text x="20" y="54" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">静态路由:按节点查表</text>
<rect x="20" y="66" width="110" height="30" rx="6" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="75" y="86" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">classify</text>
<rect x="170" y="66" width="130" height="30" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="235" y="86" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">flash</text>
<line x1="130" y1="81" x2="170" y2="81" stroke="var(--ink-soft)" stroke-width="1.5"/>
<rect x="340" y="66" width="110" height="30" rx="6" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="395" y="86" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">draft</text>
<rect x="490" y="66" width="130" height="30" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="555" y="86" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">pro</text>
<line x1="450" y1="81" x2="490" y2="81" stroke="var(--ink-soft)" stroke-width="1.5"/>
<text x="20" y="134" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">级联:先便宜,不合格再升级</text>
<rect x="20" y="146" width="130" height="30" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="85" y="166" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">flash 写草稿</text>
<rect x="190" y="146" width="140" height="30" rx="6" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="260" y="166" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">check_draft</text>
<line x1="150" y1="161" x2="190" y2="161" stroke="var(--ink-soft)" stroke-width="1.5"/>
<rect x="390" y="146" width="100" height="30" rx="6" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="440" y="166" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">直接用</text>
<line x1="330" y1="161" x2="390" y2="161" stroke="var(--ink-soft)" stroke-width="1.5"/>
<text x="340" y="154" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">通过</text>
<rect x="390" y="200" width="130" height="30" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="455" y="220" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">pro 重写</text>
<path d="M 260 176 L 260 215 L 390 215" fill="none" stroke="var(--ink-soft)" stroke-width="1.5"/>
<text x="270" y="208" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">不通过(升级)</text>
<text x="530" y="220" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">付两次钱</text>
</svg>
<figcaption>静态路由在调用前就决定用谁,按节点查表;级联在调用后看结果再决定,便宜模型的结果过了检查就用,没过就交给贵模型重写,升级的那一条要付两次钱。蓝色是模型,琥珀色是我们自己写的规则检查。</figcaption>
</figure>

## 第四步:贵了 3 倍,换来了什么

钱的那一半算清楚了,另一半是质量。Day 396 说过「要不要用 pro,取决于它能不能把质量提上去,这要用评测去量」。第六部分讲的是完整的评测体系,今天先用一个最小的版本:几条规则,自动检查草稿有没有犯明确的错。

规则从前几天的真实草稿里来:Day 394 见过模型写「三个工作日内到账」这种事实里没有的承诺,Day 398 见过它编工单号,规范里还要求不用「亲」、不超过 80 字。

```python
# agent-zero-lab/part07/draft_check.py
import re

MAX_CHARS = 80
BAD = {
    "承诺到账时间": r"\d+\s*(个)?(工作日|天|小时)",
    "编出工单号": r"工单号\s*(为|是|:|：)?\s*[A-Za-z0-9]",
    "称呼用亲": r"亲[,，!！]",
}


def check_draft(text: str) -> list[str]:
    problems = [name for name, pattern in BAD.items() if re.search(pattern, text)]
    if len(text) > MAX_CHARS:
        problems.append(f"超过 {MAX_CHARS} 字({len(text)})")
    return problems


if __name__ == "__main__":
    for t in ["退款预计 3 个工作日内到账,请您留意。", "已转技术团队,工单号：TC202406。", "亲,已为您提交退款申请,等主管审批。"]:
        print(check_draft(t), t)
```

<div class="line-notes">

- `import re` 正则模块,Day 394 用它找过发票号。
- `MAX_CHARS = 80` 规范要求的字数上限。`len` 对中文字符串数的是字符个数,标点也算,和 JS 的 `str.length` 对中文的结果一样(都不涉及 emoji 这种特殊情况)。
- `BAD = {` 「问题名 → 正则」。以后加规则只加一行。
- `"承诺到账时间": r"\d+\s*(个)?(工作日|天|小时)",` 匹配「3 个工作日」「7 天」「24 小时」这种。`\d+` 是一个或多个数字,`\s*` 是任意个空白,`(个)?` 表示「个」可有可无,`(工作日|天|小时)` 三选一。这条规则很粗:客户自己说的「三天内不退我就投诉」用的是汉字「三」,不会误伤;但如果回复里写「您 3 天前提交的」也会被判错。规则检查就是这样,便宜、快,但会有误判,下面看结果时要人工过一眼。
- `"编出工单号": r"工单号\s*(为|是|:|：)?\s*[A-Za-z0-9]",` 「工单号」后面紧跟字母或数字就算编造,因为我们给模型的事实里从来没有工单号。`：` 是全角冒号「:」的编码,模型输出用的是全角标点,写成转义是为了在代码里一眼分清全角半角。「工单号我们会核实后提供」这种不会被判错。
- `"称呼用亲": r"亲[,，!！]",` 「亲」后面跟逗号或感叹号(半角全角都算)。只写「亲」会误伤「亲自」。
- `problems = [name for name, pattern in BAD.items() if re.search(pattern, text)]` 列表推导式加条件:每条规则匹配上就把名字放进列表。`re.search` 在整段文字里找,找到返回匹配对象,没找到返回 None,相当于 JS 的 `pattern.test(text)`。
- `problems.append(f"超过 {MAX_CHARS} 字({len(text)})")` 超长的把实际字数也写上,方便看超了多少。
- `return problems` 空列表就是通过。

</div>

```bash
uv run python -m part07.draft_check
```

```text
['承诺到账时间'] 退款预计 3 个工作日内到账,请您留意。
['编出工单号'] 已转技术团队,工单号:TC202406。
['称呼用亲'] 亲,已为您提交退款申请,等主管审批。
```

三条规则各抓到一个。然后准备 8 张工单,四张账单、两张技术、两张其他,事实按 worker 里 `facts_for_model` 的格式手写好,这样不用跑整个 worker,能快速换模型重复实验:

```python
# agent-zero-lab/part07/route_compare.py
import asyncio
import json
import sys
from datetime import datetime

from part07.draft_check import check_draft
from part07.policy import SYSTEM
from part07.pricing import call_cost, period_at
from part07.ticket_agent import ask_metered

REFUND = "已提交,单号 R-{n},等主管审批,批准前不会到账"
CASES = [
    ("10 月 8 号被扣了两次款,INV-0123 那笔麻烦退给我", {"分类": "billing", "发票": "INV-0123,金额 2392.00 元", "退款申请": REFUND.format(n="5bdfb7fb")}),
    ("INV-0456 是重复扣费,申请退款", {"分类": "billing", "发票": "INV-0456,金额 99.00 元", "退款申请": REFUND.format(n="0c41aa12")}),
    ("退款什么时候到账?INV-0789 那笔", {"分类": "billing", "发票": "INV-0789,金额 5.00 元", "退款申请": REFUND.format(n="9e27d310")}),
    ("急!INV-0123 重复扣款,三天内不退我就投诉", {"分类": "billing", "发票": "INV-0123,金额 2392.00 元", "退款申请": REFUND.format(n="5bdfb7fb")}),
    ("导出 PDF 发票的时候页面一直转圈", {"分类": "tech"}),
    ("登录以后看不到上个月的账单", {"分类": "tech"}),
    ("怎么把发票抬头改成公司名", {"分类": "other"}),
    ("年付能不能开两张发票", {"分类": "other"}),
]


def draft_prompt(text: str, facts: dict[str, str]) -> str:
    return (
        "根据事实写一段不超过 80 字的中文回复,事实里没有的不要承诺。\n"
        f"工单:{text}\n事实:{json.dumps(facts, ensure_ascii=False)}"
    )


def cost_of(c: dict) -> float:
    return call_cost(c["model"], c["prompt"], c["hit"], c["completion"], period_at(datetime.fromisoformat(c["at"])))


async def main(model: str, tag: str):
    passed, total = 0, 0.0
    for i, (text, facts) in enumerate(CASES, start=1):
        draft, c = await ask_metered("draft", draft_prompt(text, facts), 200, f"{tag}-{i:02d}", system=SYSTEM, model=model)
        problems = check_draft(draft)
        passed += not problems
        total += cost_of(c)
        print(f"{i:02d} {'通过' if not problems else '不过'} {problems} {draft[:30]}")
    print(f"{model}: 通过 {passed}/{len(CASES)},平均每条 {total / len(CASES) * 100:.4f} 分")


if __name__ == "__main__":
    asyncio.run(main(sys.argv[1], sys.argv[2]))
```

<div class="line-notes">

- `REFUND = "已提交,单号 R-{n},等主管审批,批准前不会到账"` 和 worker 里 `facts_for_model` 写的退款事实一字不差,只是单号用 `{n}` 占位。
- `CASES = [` 每条是「工单正文, 事实字典」。第 3、4 条是新加的:客户直接问「什么时候到账」、客户自己说了「三天内」,专门引诱模型承诺时间。
- `REFUND.format(n="5bdfb7fb")` `str.format` 把 `{n}` 换成给的值,相当于一个小模板。f-string 是写的时候就填好,`format` 可以先写模板后填。
- `def draft_prompt(text: str, facts: dict[str, str]) -> str:` 和 Day 397 定稿的 draft 节点用的用户消息一模一样,单独拎出来是为了练习 2 能替换它。
- `def cost_of(c: dict) -> float:` 一条日志记录值多少钱。按记录自己的模型和时间算,不写死。
- `draft, c = await ask_metered("draft", draft_prompt(text, facts), 200, f"{tag}-{i:02d}", system=SYSTEM, model=model)` 节点名还是 `draft`,但用 `model=` 强行指定模型,绕过路由表。工单号带上实验标签,比如 `F1-03`,日志里能分清是哪次实验。
- `passed += not problems` `not []` 是 True,True 加到整数上等于加 1。这是 Python 里常见的计数写法,JS 里 `true + 1` 也等于 2,道理一样。
- `print(f"{i:02d} {'通过' if not problems else '不过'} {problems} {draft[:30]}")` f-string 的花括号里可以写三元表达式。

</div>

先 flash、再 pro,各跑一遍:

```bash
uv run python -m part07.route_compare deepseek-flash F1
uv run python -m part07.route_compare deepseek-v4-pro P1
```

```text
01 不过 ['超过 80 字(91)'] 您反馈的重复扣款问题已收到。INV-0123 金额 2392
02 不过 ['超过 80 字(85)'] 您反馈的重复扣费工单 INV-0456(金额 99.00 元
03 不过 ['超过 80 字(82)'] 您的退款申请(单号 R-9e27d310)已提交,涉及发票 
04 不过 ['超过 80 字(93)'] 您的问题我们已记录:发票 INV-0123 金额为 2392
05 通过 [] 您好,您反馈的导出 PDF 发票时页面一直转圈的问题,已转给
06 不过 ['编出工单号'] 您反馈的登录后看不到上个月账单的问题,已转给技术团队处理,工
07 通过 [] 您的问题我们已收到,会核实后回复您,并告知具体处理进度。感谢
08 通过 [] 您的问题我们已记录。关于年付能否开两张发票,我们会核实后回复
deepseek-flash: 通过 3/8,平均每条 0.0422 分
01 通过 [] 您好,INV-0123 的退款申请已提交,单号 R-5bdf
02 通过 [] 已为您提交退款申请,单号 R-0c41aa12,对应发票 I
03 通过 [] 您好,INV-0789 金额为 5.00 元,退款申请已提交
04 通过 [] 非常抱歉给您带来困扰。您的退款申请已提交,需主管审批,批准前
05 通过 [] 非常抱歉给您带来不便。您反馈的问题已转给技术团队处理,工单号
06 通过 [] 您的技术问题已转给技术团队处理,工单号我们会核实后提供。请您
07 通过 [] 您好,我们会核实后回复您。
08 通过 [] 我们会核实后回复您。
deepseek-v4-pro: 通过 8/8,平均每条 0.3720 分
```

flash 3/8,pro 8/8。差距很大,但先别急着下结论,有两处要细看。

**flash 的错主要是超长。** 5 次不过里 4 次是超过 80 字,而且只超了 2 到 13 个字;还有 1 次是编工单号。它没有承诺到账时间,第 3、4 条的诱导都没上当。也就是说 flash 的「不会写」主要是「写得啰嗦」。

**pro 的 0.3720 分里有原价的部分。** 看日志里这 8 次的命中:

```text
2448 0 48
2435 0 43
2435 2304 52
2441 2304 26
2384 2304 25
2381 2304 22
2382 2304 8
2381 2304 6
```

(每行是输入、命中、输出。)前两次命中 0,第三次起才命中 2304。这就是上一步说的:pro 的缓存要单独建,flash 上的缓存帮不了它。另外看最后两行,输出只有 8 个和 6 个 token,对应「您好,我们会核实后回复您。」这种回复。规则检查判它通过,可客户问的是「怎么改发票抬头」,这句话等于没回答。**规则只能抓明确的错,抓不到「没帮上忙」**,这要靠第六部分的 LLM 评审或人工抽查。

同一组再各跑一遍,看看稳不稳:

```bash
uv run python -m part07.route_compare deepseek-flash F2 | tail -1
uv run python -m part07.route_compare deepseek-v4-pro P2 | tail -1
```

```text
deepseek-flash: 通过 4/8,平均每条 0.0376 分
deepseek-v4-pro: 通过 6/8,平均每条 0.1024 分
```

flash 从 3/8 变成 4/8,pro 从 8/8 变成 6/8。8 条样本,一两条的波动就是 12% 到 25%,所以「pro 100% 通过」这种话不能说。能说的是:在这组样本上,pro 的通过率明显高一截;缓存热了以后,pro 每条 0.1024 分,是 flash 的 2.7 倍。真要决定上线用哪个,得用第六部分那样上百条的测试集去量。

## 第五步:级联,先便宜后贵

静态路由是「draft 一律用 pro」,每条都付 2.7 倍。可 flash 也能过一半左右,那一半为什么要付 pro 的钱?级联的想法是:先让 flash 写,用 `check_draft` 检查,过了就用,没过再交给 pro 重写。

```python
# agent-zero-lab/part07/cascade.py
import asyncio
import sys

from part07.draft_check import check_draft
from part07.policy import SYSTEM
from part07.route_compare import CASES, cost_of, draft_prompt
from part07.ticket_agent import ask_metered

CHEAP, STRONG = "deepseek-flash", "deepseek-v4-pro"


async def draft_cascade(prompt: str, ticket_id: str) -> tuple[str, list[str], list[dict]]:
    draft, c1 = await ask_metered("draft", prompt, 200, ticket_id, system=SYSTEM, model=CHEAP)
    problems = check_draft(draft)
    if not problems:
        return draft, [], [c1]
    draft, c2 = await ask_metered("draft", prompt, 200, ticket_id, system=SYSTEM, model=STRONG)
    return draft, problems, [c1, c2]


async def main(tag: str):
    passed, escalated, total = 0, 0, 0.0
    for i, (text, facts) in enumerate(CASES, start=1):
        draft, why, calls = await draft_cascade(draft_prompt(text, facts), f"{tag}-{i:02d}")
        final_problems = check_draft(draft)
        passed += not final_problems
        escalated += len(calls) > 1
        total += sum(cost_of(c) for c in calls)
        route = f"升级({why[0]})" if len(calls) > 1 else "flash 一次过"
        print(f"{i:02d} {route:<16} 最终{'通过' if not final_problems else '不过' + str(final_problems)}")
    print(f"级联: 通过 {passed}/{len(CASES)},升级 {escalated} 次,平均每条 {total / len(CASES) * 100:.4f} 分")


if __name__ == "__main__":
    asyncio.run(main(sys.argv[1]))
```

<div class="line-notes">

- `from part07.route_compare import CASES, cost_of, draft_prompt` 同一组工单、同一个提示词、同一个算钱函数,结果才能和上一步直接比。`route_compare.py` 有 main guard,import 它不会把对比实验也跑一遍。
- `CHEAP, STRONG = "deepseek-flash", "deepseek-v4-pro"` 一行给两个变量赋值,其实是元组解包,Day 22 学过。
- `async def draft_cascade(prompt: str, ticket_id: str) -> tuple[str, list[str], list[dict]]:` 返回三样:最终的草稿、升级的原因(没升级就是空列表)、这次一共发生的调用记录。调用记录要全部返回,因为升级时两次都要付钱。
- `draft, c1 = await ask_metered("draft", prompt, 200, ticket_id, system=SYSTEM, model=CHEAP)` 第一次,便宜模型。
- `if not problems:` 过了检查就直接返回,只付一次 flash 的钱。
- `draft, c2 = await ask_metered("draft", prompt, 200, ticket_id, system=SYSTEM, model=STRONG)` 没过,用同样的提示词交给 pro 重写。注意这里没有把 flash 的草稿和「哪里不对」告诉 pro,它是从头写。把失败原因一起传过去也是一种做法,练习 4 讨论。
- `return draft, problems, [c1, c2]` 返回 pro 的草稿、flash 失败的原因、两次调用。pro 写的不一定能过,下面 `main` 里会再检查一次。
- `escalated += len(calls) > 1` 两次调用就是升级了。
- `total += sum(cost_of(c) for c in calls)` 两次的钱都算上。这是级联最容易漏算的地方:升级的那条,flash 那一次的钱没有白给,也是付了的。
- `route = f"升级({why[0]})" if len(calls) > 1 else "flash 一次过"` 只显示第一个失败原因,一行放得下。
- `print(f"{i:02d} {route:<16} 最终{'通过' if not final_problems else '不过' + str(final_problems)}")` `str(列表)` 把列表转成字符串才能和「不过」拼在一起。

</div>

```bash
uv run python -m part07.cascade C1
uv run python -m part07.cascade C2
```

```text
01 升级(超过 80 字(81))  最终通过
02 flash 一次过        最终通过
03 升级(超过 80 字(82))  最终通过
04 升级(超过 80 字(96))  最终不过['超过 80 字(81)']
05 升级(编出工单号)        最终不过['编出工单号']
06 升级(编出工单号)        最终通过
07 flash 一次过        最终通过
08 flash 一次过        最终通过
级联: 通过 6/8,升级 5 次,平均每条 0.1032 分
01 升级(超过 80 字(105)) 最终通过
02 flash 一次过        最终通过
03 升级(编出工单号)        最终通过
04 flash 一次过        最终通过
05 升级(编出工单号)        最终通过
06 flash 一次过        最终通过
07 flash 一次过        最终通过
08 flash 一次过        最终通过
级联: 通过 8/8,升级 3 次,平均每条 0.0834 分
```

把四种做法放在一起(都是 8 条、空闲价、缓存已热;flash 和 pro 取第二轮 F2、P2 的数):

| 做法 | 通过 | 每条花费(分) |
| --- | --- | --- |
| 全用 flash | 4/8 | 0.0376 |
| 全用 pro | 6/8 | 0.1024 |
| 级联第一轮 C1 | 6/8(升级 5 次) | 0.1032 |
| 级联第二轮 C2 | 8/8(升级 3 次) | 0.0834 |

级联的质量和全用 pro 差不多,可花费也差不多:C1 甚至比全用 pro 还贵一点。

原因在升级比例。级联每条的钱 ≈ flash 的钱 + 升级比例 × pro 的钱。它要比全用 pro 便宜,需要:

```text
0.0376 + p × 0.1024 < 0.1024
p < 1 − 0.0376 / 0.1024 ≈ 63%
```

C1 升级了 5/8 = 62.5%,刚好卡在线上,于是和 pro 一样贵;C2 升级 3/8 = 37.5%,便宜了约 19%。而且升级的那几条要等两次模型调用,延迟也翻倍。

级联真正划算,要同时满足两个条件:**便宜模型大部分时候能过**(升级比例低)、**两个模型的价差大**。练习 3 会算:价差 15 倍、便宜模型能过 85% 时,级联能省近八成。我们这里 pro 缓存热了以后只贵 2.7 倍、flash 只能过一半,级联就不值得。

那 flash 只能过一半,能不能让它多过一些?它的错大多是「超长几个字」和「编工单号」,这像是提示词没说清楚,而不是模型能力不够。练习 2 只改了一句提示词,flash 就从 3/8、4/8 提到了 7/8,每条还是 0.036 分。这比任何路由都便宜。**升级模型之前,先看看失败的样本,很多时候该改的是提示词。**

## 第六步:定下来用哪个

今天的数据支持这样的结论:

- classify 用 flash。它的输出只有一个词,今天几批工单里它的分类结果和工单内容都对得上(四种样本工单走的路径和 Day 394 一致),换 pro 没有能量出来的收益。
- draft 先改提示词(练习 2 的版本),继续用 flash。路由表不用动,默认值就是 flash。
- 级联的代码留着,等第六部分的测试集建起来、能可靠地量出升级比例后再决定开不开。

所以今天改完的 worker,行为上和 Day 397 定稿完全一样,只是多了「随时能按节点换模型」的能力和一个按模型算钱的报表。这不是白忙:下次产品说「起草质量不行,换最好的模型」,你能在半小时内跑出「换了贵 3 倍、通过率从多少到多少」,再决定。

至于更聪明的动态路由:训练一个小分类器,看输入就预测这条该给哪个模型(开源的 RouteLLM 就是做这个的);或者用网关服务(LiteLLM、OpenRouter 的自动路由)帮你选。它们解决的是「路由规则怎么写得比人更好」,前提是你已经能量出每个模型在你的任务上的质量和成本,也就是今天做的事。明天的 Advisor 模式是另一种分工:不是挑一个模型干活,而是便宜模型干活、遇到难题时去问贵模型。

## 零件和完整改造的对照

| 今天的零件 | 放在哪 | 回答什么问题 |
| --- | --- | --- |
| `routing.py` 的 `NODE_MODELS` / `model_for` | 独立模块 | 这个节点用哪个模型 |
| `ask_metered(..., model=...)` | `ticket_agent.py` | 默认走路由表,需要时临时指定 |
| `cache_report.py` 用 `c["model"]` 算钱 | 离线报表 | 混用模型后每个节点花多少 |
| `draft_check.py` | 规则检查 | 草稿有没有犯明确的错 |
| `route_compare.py` | 实验 | 同一组工单,某个模型的通过率和花费 |
| `cascade.py` | 实验 | 先便宜后贵,升级比例和花费 |

## 动手练习

### 练习 1:不重启就生效?

`routing_peek.py` 的第一次运行里,程序中途改了 `MODEL_DRAFT` 却没生效。把 `model_for` 改成每次调用都重新读环境变量,再跑一次 `routing_peek`,看第三行变成什么。改完以后 `NODE_MODELS` 还有用吗?

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part07/routing_live.py
import os

DEFAULTS = {"classify": "deepseek-flash", "draft": "deepseek-flash"}


def model_for(node: str) -> str:
    env_name = f"MODEL_{node.upper()}"
    return os.getenv(env_name) or DEFAULTS.get(node) or os.getenv("LLM_MODEL", "deepseek-flash")


if __name__ == "__main__":
    print("draft →", model_for("draft"))
    os.environ["MODEL_DRAFT"] = "deepseek-v4-pro"
    print("改了环境变量以后 draft →", model_for("draft"))
    print("lookup →", model_for("lookup"))
```

<div class="line-notes">

- `DEFAULTS = {"classify": "deepseek-flash", "draft": "deepseek-flash"}` 表里只放默认值,不再在 import 时读环境变量。
- `env_name = f"MODEL_{node.upper()}"` 节点名转大写拼出环境变量名,`draft` → `MODEL_DRAFT`。`.upper()` 相当于 JS 的 `toUpperCase()`。
- `return os.getenv(env_name) or DEFAULTS.get(node) or os.getenv("LLM_MODEL", "deepseek-flash")` 三级兜底:节点专属的环境变量 → 默认表 → 全局模型。每次调用都执行,所以运行中改了环境变量,下一次调用就生效。

</div>

```bash
uv run python -m part07.routing_live
```

```text
draft → deepseek-flash
改了环境变量以后 draft → deepseek-v4-pro
lookup → deepseek-flash
```

生效了。`NODE_MODELS` 那种「import 时读好」的字典在这个版本里就没有了,换成了 `DEFAULTS`。

但要知道,在 worker 里这个改法用处有限:`os.environ` 只是**这个进程自己**的环境变量副本,你在另一个终端里 `export MODEL_DRAFT=...` 改不到正在跑的 worker。真想不重启就切模型,要读一个外部能改的地方,比如 Redis 里的一个键(Day 383 学的 `GET`/`SET`),每次调用多一次网络往返。大多数团队选择接受「换模型要重启」,发版本来就会重启。

</details>

### 练习 2:先改提示词,再考虑换模型

看 F1 里 flash 的失败:主要是超出 80 字几个字,还有一次编工单号。改 `draft_prompt`:字数要求写成「60 字以内」留出余量,再加一句「事实里没有工单号就不要提工单号」。不改 `route_compare.py`,写一个小脚本替换掉它的 `draft_prompt` 再跑,用 flash 跑两轮。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part07/prompt_fix.py
import asyncio
import sys

import part07.route_compare as rc


def draft_prompt_v2(text: str, facts: dict[str, str]) -> str:
    return (
        "根据事实写一段 60 字以内的中文回复,事实里没有的不要承诺。"
        "事实里没有工单号就不要提工单号。\n"
        f"工单:{text}\n事实:{rc.json.dumps(facts, ensure_ascii=False)}"
    )


rc.draft_prompt = draft_prompt_v2
asyncio.run(rc.main(sys.argv[1], sys.argv[2]))
```

<div class="line-notes">

- `import part07.route_compare as rc` 导入整个模块并起个短名字,相当于 JS 的 `import * as rc from "./route_compare"`。
- `"根据事实写一段 60 字以内的中文回复,事实里没有的不要承诺。"` 检查器的上限还是 80,提示词里要求 60,给模型留 20 个字的误差。模型对字数的把握一向不准,要求和底线写成同一个数,它经常就超几个。
- `"事实里没有工单号就不要提工单号。\n"` 正面回应规范第 6 条和事实之间的矛盾。更好的做法是把真正的工单号放进事实里,Day 398 说过「规范要求给的信息,提示词里就得真的给」,这里先用最小改动。
- `f"工单:{text}\n事实:{rc.json.dumps(facts, ensure_ascii=False)}"` `rc.json` 就是 `route_compare.py` 里 import 的那个 `json` 模块,模块里 import 进来的名字也能这样取。
- `rc.draft_prompt = draft_prompt_v2` 把 `route_compare` 模块里的 `draft_prompt` 换成新函数。`rc.main` 里调 `draft_prompt(...)` 时,是到模块里按名字去找的,所以会找到新的那个。这种替换叫 monkey patch,做实验很方便,正式代码里不要这么写,改原文件或者把提示词做成参数。

</div>

```bash
uv run python -m part07.prompt_fix deepseek-flash G1
uv run python -m part07.prompt_fix deepseek-flash G2 | tail -1
```

```text
01 不过 ['超过 80 字(84)'] 您提到的 10 月 8 号重复扣款和 INV-0123(金额
02 通过 [] 您反馈的 INV-0456 重复扣费,金额为人民币 99.0
03 通过 [] 您这笔 INV-0789 金额为人民币 5.00 元的退款申
04 通过 [] 您别着急,先向您致歉。INV-0123 的 2392.00 
05 通过 [] 您反馈的导出 PDF 发票页面一直转圈的问题,我们已经转给技
06 通过 [] 您反馈的登录后看不到上个月账单的问题,我们已收到并转给技术团
07 通过 [] 您关于修改发票抬头的问题我们已收到,会尽快核实后回复您。
08 通过 [] 您好,关于年付开具发票的问题,我们会核实后回复您。
deepseek-flash: 通过 7/8,平均每条 0.0363 分
deepseek-flash: 通过 7/8,平均每条 0.0366 分
```

两轮都是 7/8,花费和原来的 flash 一样。比全用 pro(6/8,0.1024 分)和级联都好,只花了它们三分之一的钱。第 1 条要求写 60 字它还是写了 84 字,说明字数这类要求光靠提示词管不住,真要卡死,可以在代码里截断或者让它重写一次(那就是级联的思路,只不过升级到的是同一个模型)。

</details>

### 练习 3:级联在什么条件下划算

假设一个系统里便宜模型每条 0.04 分,贵模型每条 0.6 分(贵 15 倍),便宜模型能过 85%。

1. 级联每条多少钱?比全用贵模型省多少?
2. 升级比例到多少时,级联和全用贵模型一样贵?
3. 用今天实测的数(flash 0.0376、pro 0.1024)算,升级比例要低于多少才划算?

<details><summary>参考答案</summary>

```text
1. 0.04 + 0.15 × 0.6 = 0.04 + 0.09 = 0.13 分;比 0.6 分省 78%
2. 0.04 + p × 0.6 = 0.6 → p = 0.56 / 0.6 ≈ 93%
3. 0.0376 + p × 0.1024 < 0.1024 → p < 63%
```

价差 15 倍时,升级比例到 93% 级联才不划算,几乎怎么用都省;价差 2.7 倍时,63% 就是线,我们的 C1 实测 62.5%,正好卡在线上。这道题是纸面计算。它说明级联省不省钱,主要看价差和便宜模型的通过率,和「级联」这个想法本身没关系。还要记得把延迟算进去:升级的那部分请求要等两次。

</details>

### 练习 4:把失败原因告诉贵模型

`draft_cascade` 升级时让 pro 从头写,没告诉它 flash 哪里错了。说说把「上一版草稿 + 失败原因」一起传给 pro 的好处和代价,不用写代码。

<details><summary>参考答案</summary>

好处:pro 知道具体要避开什么(比如「上一版超了 80 字」「不要提工单号」),一次改对的概率更高;有时甚至不需要 pro,把失败原因告诉 flash 让它自己改一次就够了(练习 2 里提到的「升级到同一个模型」)。

代价:用户消息变长了几十到一百多个 token,而且每次都不一样,但它们在消息的最后,不影响规范前缀的缓存(Day 397 的规矩一)。另外 pro 看到一份有问题的草稿,可能会照着改而不是重新组织,把 flash 的其他小毛病也带过来。

哪个更好要用测试集量,不能凭感觉。这道题是开放讨论,没有实跑。第六部分讲过的 LLM 评审,和「带失败原因重写」组合起来,就是很多系统里的「自我修正」环节。

</details>

**验收标准**:能讲清为什么 `routing_peek.py` 第一次运行时改环境变量不生效;能跑出 S 批和 R 批的 `cache_report`,说出起草换 pro 后单工单成本是几倍以及为什么不是价格表上的倍数;能跑出 flash、pro、级联三组对比,并用升级比例算出级联在今天的数据上为什么省不了多少钱;能说出练习 2 为什么比换模型更划算。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 模型路由 | 按任务挑模型,不同的活交给不同价位、不同能力的模型 |
| 静态路由 | 调用前按固定规则(比如节点名)决定用哪个模型,今天的 `NODE_MODELS` |
| 级联(cascade) | 先用便宜模型,检查结果不合格再交给贵模型,升级的那条付两次钱 |
| 升级比例 | 级联里需要交给贵模型的比例。今天实测 3/8 到 5/8 |
| 规则检查 | 用正则、长度这类确定的规则判断输出有没有明确的错。便宜、快,但会误判,抓不到「没帮上忙」 |
| 动态路由 / 路由器 | 根据输入内容临时决定用哪个模型,常用一个训练过的小分类器来做,比如 RouteLLM |
| monkey patch | 运行时替换模块或对象里的函数,做实验方便,正式代码里少用 |

## 常见误区

**一上来就给难的节点换最好的模型。** 先看失败的样本。今天 flash 的失败大多是超几个字、编工单号,改一句提示词就从 3/8 提到 7/8,钱一分没多花。

**以为换模型的成本倍数就是价格表上的倍数。** draft 的输入九成命中缓存,pro 的命中价贵 7.5 倍,未命中贵 4.5 倍,输出贵 3.4 倍,而 pro 的回复又更短,实测整体是 3.2 倍。用自己的日志算,不要用价格表心算。

**换了模型忘了缓存要重建。** 每个模型的缓存是分开的,P1 前两次 pro 调用命中 0。线上切模型的头几分钟账单会跳一下。

**报表里把模型名写死。** 混用模型后,pro 的调用按 flash 的价格算会少算好几倍。用日志里每条记录自己的 `model`。

**级联只算 pro 那一次的钱。** 升级的那条,flash 那一次也付了钱,还多等了一次。

**用 8 条样本下结论。** flash 两轮是 3/8 和 4/8,pro 是 8/8 和 6/8,一条的差别就是 12.5%。正式决定要用第六部分那样的测试集。

**以为规则检查通过就是好回复。** pro 写的「我们会核实后回复您。」过了所有规则,可客户问的问题一个字都没回答。

**改了路由配置不重启 worker。** `NODE_MODELS` 在 import 时就读好了,运行中改环境变量不生效。

## 学习资料

### 文档与文章

- [LMSYS · RouteLLM: An Open-Source Framework for Cost-Effective LLM Routing](https://lmsys.org/blog/2024-07-01-routellm/):训练路由器在强弱两个模型之间分流的代表工作,博客里的「成本-质量曲线」和今天的四行对比表是一个意思。英文,15 分钟。
- [LiteLLM · Router 文档](https://docs.litellm.ai/docs/routing):一个统一调用各家模型的库,自带负载均衡、失败回退和按策略路由,真实项目里 `routing.py` 这件事常交给它。英文,先看开头的 Quick Start。
- [OpenRouter · Auto Model Selection](https://openrouter.ai/docs/guides/routing/auto-model-selection):网关服务帮你自动选模型的做法,知道有这种产品形态即可。英文,5 分钟。
- [DeepSeek API 文档 · 模型与价格](https://api-docs.deepseek.com/zh-cn/quick_start/pricing):flash 和 pro 两个模型的价格,第一张表的出处。中文,5 分钟。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1Ny5V6DEFy&autoplay=0&high_quality=1" title="LLM Router 深度解析:AI 应用如何从押注一个模型进化到管理一组模型" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>福菲门特 · LLM Router 深度解析:AI 应用如何从「押注一个模型」进化到「管理一组模型」 · 约 8 分钟,2026 年。把静态路由、级联、训练路由器几种做法放在一起讲,看完再回头看今天第六步的取舍。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV18HhWz5EX7&autoplay=0&high_quality=1" title="RouteLLM:服务和评估LLM路由器开源框架" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>swanmsg · RouteLLM:服务和评估LLM路由器开源框架 · 约 10 分钟。中文介绍 RouteLLM 怎么训练路由器、怎么评估「省了多少钱、掉了多少质量」,对应第六步最后一段。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/CinFq9I81m4" title="Your LLM Cost Dashboard Is Lying (Cheaper Routing, 7× the Cost)" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>tokensandtraces · Your LLM Cost Dashboard Is Lying (Cheaper Routing, 7× the Cost) · 英文。讲「路由到便宜模型」反而让总成本变高的情况,和今天级联 C1 比全用 pro 还贵是同一类现象,看它是怎么把账算全的。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/GhXQKz5WKSA" title="RouteLLM achieves 90% GPT4o Quality AND 80% CHEAPER" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Matthew Berman · RouteLLM achieves 90% GPT4o Quality AND 80% CHEAPER · 英文,2024 年。RouteLLM 刚发布时的解读,标题里的数字是论文在它们的测试集上的结果,换到你的任务上要自己量。</figcaption>
</figure>

### 书籍

- 《AI Engineering: Building Applications with Foundation Models》,Chip Huyen,O'Reilly,2025。讲 AI 应用架构的那一章专门有一节讲路由器和网关(router、gateway):为什么要路由、路由器怎么做、和缓存怎么配合。英文原版,我没查到正式出版的中译本。

### 开源项目与代码

- [lm-sys/RouteLLM](https://github.com/lm-sys/RouteLLM):RouteLLM 的代码和预训练好的路由器,README 里有在 OpenAI 兼容接口上直接用的例子。对应论文 [RouteLLM: Learning to Route LLMs with Preference Data](https://arxiv.org/abs/2406.18665)。
- [FrugalGPT 论文](https://arxiv.org/abs/2305.05176):《FrugalGPT: How to Use Large Language Models While Reducing Cost and Improving Performance》,级联做法最常被引用的论文,用一个打分器决定要不要升级到下一个模型,和今天的 `check_draft` 是同一个结构。
- [BerriAI/litellm](https://github.com/BerriAI/litellm):上面 Router 文档对应的代码,`router.py` 里能看到各种路由策略的实现。

## 自测

1. `NODE_MODELS` 里写 `os.getenv("MODEL_DRAFT", "deepseek-flash")`,worker 跑起来以后你在另一个终端 `export MODEL_DRAFT=deepseek-v4-pro`,下一张工单会用 pro 吗?

<details><summary>答案</summary>

不会,有两个原因。一是 `NODE_MODELS` 在 import 时就读好了,之后不再读环境变量;二是就算改成每次都读,另一个终端的 `export` 只影响那个终端,改不到已经在跑的 worker 进程。要换模型,带着新的环境变量重启 worker。

</details>

2. 起草换成 pro 以后,draft 的花费是 3.2 倍,不是价格表上输入未命中的 4.5 倍。为什么?

<details><summary>答案</summary>

draft 的钱由命中输入、未命中输入、输出三块组成,pro 在这三块上分别贵 7.5、4.5、3.4 倍,加权以后是 4 倍左右;再加上 pro 的回复普遍更短,输出少,实测是 3.2 倍。成本倍数要用自己的日志算。

</details>

3. 级联的每条成本怎么估算?今天的数据上为什么省不了多少钱?

<details><summary>答案</summary>

每条 ≈ 便宜模型的钱 + 升级比例 × 贵模型的钱。今天 flash 每条 0.0376 分、pro 0.1024 分,升级比例要低于约 63% 才比全用 pro 便宜;实测升级 37.5% 到 62.5%,所以最多省两成,有一轮和全用 pro 一样贵。级联要在价差大、便宜模型通过率高时才划算。

</details>

4. 第一次把 draft 切到 pro,前两次调用命中 0。为什么?

<details><summary>答案</summary>

每个模型的 prompt cache 是分开的,flash 上建好的规范缓存 pro 用不上,pro 要自己从第一次调用开始建。线上切模型后的头几次调用都按原价付。

</details>

5. (面试题)产品经理说「客服回复质量不行,把所有调用都换成最贵的模型」。你会怎么回应?

<details><summary>答案</summary>

参考答法:先不急着换,分三步。第一,看数据:按节点拆开,质量问题出在哪一步。分类这种简单节点换模型没收益,只会多花钱。第二,看失败样本:如果失败是「超字数」「编造信息」这类,先改提示词、补全事实,我在一个项目里只改一句提示词就把便宜模型的通过率从 3/8 提到 7/8,一分钱没多花。第三,如果确实是能力问题,只升级那个节点,用测试集量「贵多少、好多少」:我们实测起草换贵模型后单工单成本是 3 倍,要看通过率提升值不值。如果便宜模型能过大部分,可以做级联,但要算升级比例,价差小的时候级联省不了钱。最后,所有这些都靠按模型记账的用量日志和一套能重复跑的测试集,没有它们,换不换模型只能凭感觉。

</details>

## 明天预告

Day 400 · 成本(四):Advisor 模式,便宜模型执行、强模型当顾问。今天的级联是「便宜模型干不好,整个交给贵模型重干」,升级的那条要付两次钱。Advisor 换了个分工:活始终由便宜模型干,它在拿不准的时候去问一次贵模型,只为那个问题付贵模型的钱。明天用 Pydantic AI 跑一个 advisor 工具,看它和级联比哪个更省。
