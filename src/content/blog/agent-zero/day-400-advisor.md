---
title: 'Day 400 · 成本(四):Advisor 模式,便宜模型执行强模型顾问'
description: '便宜模型从头干到尾,只在拿不准的那一步问一次强模型。今天先读 Anthropic 的 advisor tool 文档并按官方示例算账,再用 Qwen3-14B 当执行、deepseek-v4-pro 当顾问手写一个等价版本,在 26 张退款工单上和单干、强模型单干比通过率和花费,最后用 Pydantic AI 的 Advisor 能力复现。实测顾问把 14B 从 13/52 拉到 50/52,可便宜的 deepseek-flash 单干就有 51/52,Advisor 没省钱。'
pubDate: 2026-10-27
regime: none
tags: ['cost', 'advisor', 'agent', 'agent-zero']
series: 'agent-zero'
day: 400
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 399](/blog/agent-zero/day-399-model-routing/) 做了两种分工:按节点查表(静态路由)和级联。级联是「便宜模型先写,检查不合格就整个交给贵模型重写」,升级的那一条要付两次钱,而且贵模型是从头来的,不知道便宜模型哪里错了。实测里升级比例到 62.5% 时,级联和直接用贵模型一样贵。今天换一种分工:活始终由便宜模型干,它在关键的一步停下来问强模型一次,拿回一小段意见接着干。强模型不重做任何东西,只为那一个判断收钱。

## 今天要解决的问题

今天结束时你应该能:

1. 讲清 Anthropic advisor tool 的结构:谁是执行模型、谁是顾问,顾问看到什么、回什么,账单为什么不能只看顶层 `usage`,并能按官方示例响应算出一次调用的真实花费。
2. 在没有 Anthropic key 的情况下,用 `openai` SDK 手写一个等价的 advisor 工具:执行模型调用它,你的代码把整段对话渲染成文字交给顾问模型,顾问的回答作为工具结果还给执行模型。
3. 在同一组 26 张退款工单上量出四种配置的通过率、错误退款申请数和每张花费,并回答「Advisor 什么时候比强模型单干便宜、什么时候根本不该上」。
4. 用 Pydantic AI 的 `Advisor` 能力复现一遍,知道它在非 Anthropic 模型上走的是本地回退路径,以及这条路径上顾问到底看得到什么。

预计用时 3 小时。前置:[Day 166](/blog/agent-zero/day-166-agent-min/) 的 tool_calls 循环(今天的循环是它的增强版)、[Day 396](/blog/agent-zero/day-396-cost-1/) 的 `pricing.py`、[Day 397](/blog/agent-zero/day-397-prompt-caching/) 的缓存命中、[Day 399](/blog/agent-zero/day-399-model-routing/) 的级联和 `draft_check` 的思路(规则检查)。

学法:先对照逐行敲一遍(不复制粘贴)并跑通;第二天合上文章默写核心部分;做练习,做不出再展开参考答案,看完关掉重写一遍。

先交代两件事。第一,我没有 Anthropic 的 API key,所以官方 advisor tool 那一节「没实跑」,内容来自 2026 年 10 月 27 日读到的[官方文档](https://platform.claude.com/docs/en/agents-and-tools/tool-use/advisor-tool)(我是用抓取工具读的,摘要过一遍,字段名以官网为准);算账那段用的是官方示例响应里的数字,脚本是实跑的,但数字不是我自己的调用。第二,今天的实验用的是手上有的模型:执行模型 `Qwen/Qwen3-14B`(硅基流动),顾问 `deepseek-v4-pro`(DeepSeek 官方)。这两家的接口都是 OpenAI 兼容协议,所以同一套 `openai` SDK 代码能调。

## 先从人说起:结对里的那一句「你看一眼」

做过前端的人大概都经历过这个场景:你在写一个新页面,90% 的活是体力活,写组件、套样式、接接口,你自己干得又快又稳。只有一个地方你拿不准,比如这个状态到底该放在 URL 里还是放在 store 里。这时候你不会让资深同事把整个页面重写一遍,你会走过去问一句,听他三十秒,回来接着写。

Advisor 就是这个分工。执行模型(executor)负责把整件事从头做到尾,包括调工具、读结果、写最后的回复,这些体力活占了 token 的绝大部分,用便宜模型。顾问模型(advisor)只在被问的时候出场,读完整段对话,回一小段意见,通常几百个 token,然后退场。贵模型的钱只花在那几百个 token 的思考上。

和 Day 399 的两种分工放在一起看:

<figure>
<svg viewBox="0 0 640 270" role="img" aria-label="三种分工对比。静态路由按节点选模型,级联先让便宜模型整件做完、不合格再让强模型整件重做,Advisor 让便宜模型一直做、中途停下来问强模型一次再接着做">
<text x="20" y="22" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">谁在干活,贵模型出场几次</text>
<text x="20" y="52" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">静态路由</text>
<rect x="130" y="38" width="190" height="22" rx="4" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="225" y="53" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">classify: 便宜</text>
<rect x="320" y="38" width="190" height="22" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="415" y="53" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">draft: 贵</text>
<text x="20" y="112" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">级联</text>
<rect x="130" y="98" width="190" height="22" rx="4" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="225" y="113" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">便宜模型整件做完</text>
<rect x="320" y="98" width="30" height="22" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="335" y="136" text-anchor="middle" font-family="var(--font-mono)" font-size="10" fill="var(--ink-faint)">检查</text>
<rect x="350" y="98" width="190" height="22" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="445" y="113" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">不合格:贵模型整件重做</text>
<text x="20" y="202" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">Advisor</text>
<rect x="130" y="188" width="120" height="22" rx="4" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="190" y="203" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">便宜:查数据</text>
<rect x="250" y="188" width="44" height="22" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="272" y="203" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">顾问</text>
<rect x="294" y="188" width="170" height="22" rx="4" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="379" y="203" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">便宜:照意见办、写回复</text>
<text x="20" y="250" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">蓝色是强模型,琥珀色是我们写的检查代码。Advisor 里强模型只占中间很窄的一条</text>
</svg>
<figcaption>三种分工里强模型出场的方式。路由是按节点固定,级联是事后整件重做,Advisor 是执行过程中被问一次、只出一小段意见。</figcaption>
</figure>

它和级联的区别有三个。级联要有一个「检查」来判断该不该升级,Advisor 不要,但它要执行模型自己知道什么时候该问,这个后面会踩到。级联升级时强模型从头来,Advisor 的顾问是读着已有的对话接着想,不重复前面的体力活。级联升级的那条付两次完整的钱,Advisor 只多付一次短输出的钱,可是顾问要读一遍整段对话,输入 token 不会少。

## 官方的 advisor tool(据官方文档,没实跑)

Anthropic 在 2026 年 4 月 9 日发了一篇[博客](https://claude.com/blog/the-advisor-strategy),把这个做法做成了 Messages API 里的一个服务端工具。到我 2026 年 10 月 27 日查文档时仍然是 beta,调用要带 beta 头 `advisor-tool-2026-03-01`,工具的 `type` 是 `advisor_20260301`,`name` 必须叫 `advisor`。

和你自己写的函数工具有个根本区别:它是**服务端工具**。你不用写执行函数,也不用自己去调顾问模型。执行模型决定调用它,Anthropic 的服务器在同一个请求里替你把完整对话交给顾问模型,顾问想完,服务器把建议塞回去,执行模型接着往下写,一次请求里全部完成。请求长这样(没实跑,字段来自文档的示例):

```python
# agent-zero-lab/part07/advisor_native.py (没实跑:我没有 Anthropic key)
import anthropic

client = anthropic.Anthropic()
resp = client.beta.messages.create(
    model="claude-sonnet-5",
    max_tokens=4096,
    betas=["advisor-tool-2026-03-01"],
    tools=[
        {
            "type": "advisor_20260301",
            "name": "advisor",
            "model": "claude-opus-5-5",
            "max_uses": 2,
            "max_tokens": 2048,
        }
    ],
    messages=[{"role": "user", "content": "客户 C008 申请退款,申请日 2026-08-29,请按规则处理。"}],
)
print(resp.usage)
```

<div class="line-notes">

- `import anthropic` 官方 SDK,安装是 `uv add anthropic`。这一段没实跑,因为需要 Anthropic 的 key,我没有。
- `resp = client.beta.messages.create(` 注意是 `client.beta.messages`,advisor 还是 beta 功能,要走 beta 命名空间。
- `model="claude-sonnet-5",` 执行模型。文档说顾问必须是 Sonnet 4.6 或更强,而且不能比执行模型弱,不合法的组合会返回 400。
- `betas=["advisor-tool-2026-03-01"],` SDK 会把它变成 `anthropic-beta` 请求头。
- `"type": "advisor_20260301",` 工具类型,带日期,以后改版会换新的类型名。
- `"name": "advisor",` 固定写这个。
- `"model": "claude-opus-5-5",` 顾问模型,账单按它的价格算。
- `"max_uses": 2,` 每个**请求**最多问几次,不是每段对话。超了顾问调用会返回 `max_uses_exceeded` 这个错误码,但请求不会失败,执行模型只是拿不到建议。想限制整段对话的次数,得自己在客户端数。
- `"max_tokens": 2048,` 限制顾问每次回答(思考加正文)的长度,最小 1024。文档给了一组测量:不设限时顾问平均输出 4,200 到 5,900 个 token,设 2048 降到约 630 到 840,设 1024 约 370 到 480 但有大约 10% 的回答被截断,所以推荐从 2048 起步。
- `print(resp.usage)` 顶层 `usage` 只有执行模型的 token,顾问的在 `usage.iterations` 里,下面马上讲。

</div>

响应里多出来两种内容块。执行模型发出一个 `server_tool_use` 块(`name` 是 `advisor`,`input` 永远是空的,因为服务器自己知道该把什么交给顾问),随后是一个 `advisor_tool_result` 块,里面是建议。建议块有三种形状:明文的 `advisor_result`(有 `text`),加密的 `advisor_redacted_result`(只有 `encrypted_content`,新一代模型作顾问时是这种,你读不到内容,但执行模型能读),以及出错时的 `advisor_tool_result_error`,带 `error_code`,比如 `max_uses_exceeded`、`overloaded`、`prompt_too_long`。出错不会让整个请求失败,执行模型会在没有建议的情况下继续。

最要紧的是账单。文档里的示例 `usage` 是这样的(我只留了关键字段):

```text
usage.input_tokens                 1760
usage.cache_read_input_tokens       412
usage.output_tokens                 531
usage.iterations:
  message          input  412  cache_read   0  output   89
  advisor_message  input  823  cache_read   0  output 1612   model: claude-opus-5-5
  message          input 1348  cache_read 412  output  442
```

顶层的 `input_tokens` 1760 正好是两个 `message` 迭代的 412 加 1348,`output_tokens` 531 是 89 加 442。**顶层只统计执行模型**,顾问那一行(1612 个输出 token,里面有思考)只在 `iterations` 里,按顾问模型的价格计费。如果你的成本看板只读顶层 `usage`,就会漏掉最贵的那一块。写个脚本把它算清楚,价格用 2026 年 10 月 27 日[定价页](https://platform.claude.com/docs/en/about-claude/pricing)上的:

```python
# agent-zero-lab/part07/advisor_bill.py
# 美元 / 百万 token:(输入, 缓存命中输入, 输出)。2026 年 10 月 27 日抄自 Anthropic 定价页
PRICES = {
    "claude-sonnet-5": (2.0, 0.20, 10.0),
    "claude-opus-5-5": (4.0, 0.20, 20.0),
}

# 官方文档 advisor tool 页里的示例响应(没实跑,只是拿它的数字练习算账)
USAGE = {
    "input_tokens": 1760,
    "cache_read_input_tokens": 412,
    "output_tokens": 531,
    "iterations": [
        {"type": "message", "input_tokens": 412, "cache_read_input_tokens": 0, "output_tokens": 89},
        {"type": "advisor_message", "model": "claude-opus-5-5", "input_tokens": 823, "cache_read_input_tokens": 0, "output_tokens": 1612},
        {"type": "message", "input_tokens": 1348, "cache_read_input_tokens": 412, "output_tokens": 442},
    ],
}


def cost(model: str, inp: int, cache_read: int, out: int) -> float:
    p_in, p_hit, p_out = PRICES[model]
    return (inp * p_in + cache_read * p_hit + out * p_out) / 1_000_000


def bill(usage: dict, executor: str) -> tuple[float, float]:
    """返回 (执行模型花的钱, 顾问花的钱)。只看顶层 usage 会漏掉后者。"""
    ex = ad = 0.0
    for it in usage["iterations"]:
        if it["type"] == "advisor_message":
            ad += cost(it["model"], it["input_tokens"], it["cache_read_input_tokens"], it["output_tokens"])
        else:
            ex += cost(executor, it["input_tokens"], it["cache_read_input_tokens"], it["output_tokens"])
    return ex, ad


if __name__ == "__main__":
    ex, ad = bill(USAGE, "claude-sonnet-5")
    top = cost("claude-sonnet-5", USAGE["input_tokens"], USAGE["cache_read_input_tokens"], USAGE["output_tokens"])
    print(f"只看顶层 usage:    ${top:.6f}")
    print(f"执行 Sonnet 5:      ${ex:.6f}")
    print(f"顾问 Opus 5.5:      ${ad:.6f}")
    print(f"合计:              ${ex + ad:.6f}")
    alone = cost("claude-opus-5-5", USAGE["input_tokens"], USAGE["cache_read_input_tokens"], USAGE["output_tokens"])
    print(f"全程用 Opus 5.5:    ${alone:.6f}(不含顾问的思考 token,所以是低估)")
```

<div class="line-notes">

- `PRICES = {` 单位是美元每百万 token,三元组顺序是「输入、缓存命中输入、输出」,和 Day 396 的 `PRICES` 顺序相反(那里命中在前),因为 Anthropic 的价格页是这个顺序,抄的时候别串。
- `"claude-sonnet-5": (2.0, 0.20, 10.0),` Sonnet 5 输入 2 美元、缓存命中 0.2 美元、输出 10 美元。
- `"claude-opus-5-5": (4.0, 0.20, 20.0),` Opus 5.5 输入 4 美元、缓存命中 0.2 美元、输出 20 美元。
- `USAGE = {` 上面那段官方示例响应,原样抄成 Python 字典。注意:这是文档里的示例,不是我自己调出来的。
- `"iterations": [` 三次迭代:执行模型一次、顾问一次、执行模型再一次。
- `def cost(model: str, inp: int, cache_read: int, out: int) -> float:` 一次调用花多少钱,公式和 Day 396 一样,只是缓存命中的 token 单独传进来。
- `for it in usage["iterations"]:` 一条一条看迭代,按 `type` 分家。
- `if it["type"] == "advisor_message":` 顾问的迭代带自己的 `model`,所以用它自己的单价。
- `ad += cost(it["model"], it["input_tokens"],` 顾问这一行:823 个输入、1612 个输出,按 Opus 5.5 算:823 × 4 + 1612 × 20 = 35,532,除以一百万是 0.035532 美元。
- `ex += cost(executor, it["input_tokens"],` 执行模型的两行加起来,按 Sonnet 5 算:1760 × 2 + 412 × 0.2 + 531 × 10 = 8,912.4,除以一百万是 0.008912 美元。
- `top = cost("claude-sonnet-5", USAGE["input_tokens"],` 只看顶层 usage 算出来的数,和执行模型那一块完全相等,说明顶层确实不含顾问。
- `alone = cost("claude-opus-5-5", USAGE["input_tokens"],` 假设全程用 Opus 5.5 干同样的活,token 数沿用执行模型那组,所以是低估(没算 Opus 自己的思考)。

</div>

```bash
cd agent-zero-lab
uv run python -m part07.advisor_bill
```

```text
只看顶层 usage:    $0.008912
执行 Sonnet 5:      $0.008912
顾问 Opus 5.5:      $0.035532
合计:              $0.044444
全程用 Opus 5.5:    $0.017742(不含顾问的思考 token,所以是低估)
```

这个示例里的结论有点出人意料:顾问那一次花了 0.0355 美元,是执行模型两次迭代的 4 倍,合计 0.0444 美元,比全程用 Opus 5.5 干(0.0177 美元)还贵。原因不难看出,这只是一个三次迭代的短任务,执行模型总共只写了 531 个 token,能省的钱本来就少,而顾问的 1612 个输出 token 又是实打实的。文档自己也写了,适合的是长链路任务,单轮问答、或者每一步都需要强模型的任务不适合。

官方博客给的数字是长任务的:Sonnet 4.6 执行、Opus 4.6 当顾问,在 SWE-bench Multilingual 上得分比 Sonnet 单干高 2.7 个百分点,每个任务的成本还降了 11.9%;Haiku 4.5 加 Opus 顾问在 BrowseComp 上从 19.7% 涨到 41.2%,但仍比 Sonnet 单干低,成本低 85%。这是 Anthropic 自己在自己的基准上测的,换到你的任务上要自己量,也就是今天后半段做的事。

用法上文档有几条值得照做的建议,都是实测出来的。一是时机:在做实质性工作之前问(动手写之前、认定某个解读之前),也就是先摸清情况(找文件、读资料)再问,写、改、宣布答案才算实质性工作;卡住了、想换思路了、觉得做完了(先把成果存好)也问。二是长任务至少问两次,开工前一次,收工前一次。三是弱一点的执行模型容易「不好意思问」,文档里 Haiku 在第二轮加一句提醒,工作完成率大约涨 7 个百分点,Sonnet 上没有可测的效果,Opus 上反而略降。四是它有缓存开关:`caching` 设成 `{"type": "ephemeral", "ttl": "5m"}`,顾问侧的对话前缀会被缓存,大约一段对话里问三次以上才回本,开了就整段对话都别关。五是限制:顾问没有工具、不流式(顾问想的时候执行模型的流会停住,每 30 秒左右发一个 `ping` 保活),目前也不在 Amazon Bedrock 上。

这一节里有一句要先记着:顾问只看得到「对话里已有的内容」。执行模型在同一步里还没拿到结果的工具调用,顾问是看不到的。官方的执行模型是 Claude,懂这个规矩;我们下面用的小模型就不一定了,这正是今天最大的坑。

## 自己搭一个等价的:先定任务

要比较,先得有一个「难点集中在一两个判断上、其余是体力活」的任务,否则 Advisor 没有用武之地。我们沿用云簿 CloudLedger 的退款场景,但把规则收紧到可以自动判分:退款规则是一段确定的文字,每张工单的标准答案可以用 Python 算出来,执行模型要通过工具查订阅和发票,再下结论。

任务一共 26 张工单:16 张照规则就能算(包括 14 天和 30 天边界、代金券、已退过的、月付、基础版),4 张已开发票,3 张规则没覆盖(降级、转让、美元),1 张折算后为 0。每一张的标准答案要么是一个金额,要么是「不可退款」,要么是「转人工」。先写数据和标准答案函数:

```python
# agent-zero-lab/part07/refund_cases.py
import math
from datetime import date

HUMAN = "human"

RULES = """你是云簿 CloudLedger 的客服,负责回答退款问题。退款规则:
1. 月付订阅一律不退款。
2. 年付只有专业版和企业版可以退款,基础版年付不退款。
3. 已使用天数 = 申请日减购买日,再加 1(购买当天算第 1 天)。
4. 年付已使用 14 天以内(含 14 天):退全部年费。
5. 已使用超过 14 天:按剩余整月折算。已使用月数 = 已使用天数 ÷ 30 向上取整,剩余整月 = 12 减已使用月数(最少为 0),退款 = 年费 ÷ 12 × 剩余整月。剩余整月为 0 的不可退款。
5a. 上面所说的「年费」一律指实际支付金额,代金券抵扣的部分不算,也不退现金。
6. 同一份订阅只能退款一次,已经退过的不能再退。
7. 以上规则只覆盖「整份订阅申请退款」。升级、降级、转让给其他公司、加购包、币种不是人民币的订阅,规则没有覆盖,客服不能自己算,必须转人工。
8. 已经开具发票的订阅,退款前要先作废发票,客服不能自己处理,必须转人工。(规则 1、2、6 判定为不可退款的,不论是否开票,都直接答不可退款。)
回答的最后一行必须是「结论:退款 X 元」「结论:不可退款」「结论:转人工」三者之一,X 保留两位小数。"""

# (工单, 计划, 周期, 实付, 购买日, 申请日, 是否已退过, 代金券, 已开票)
CASES = [
    ("企业版年付 11880,3 月 5 日买的,9 月 17 日申请退款", "企业版", "年付", 11880, date(2026, 3, 5), date(2026, 9, 17), False, 0, False),
    ("专业版年付 5880,1 月 20 日买的,2 月 2 日想退", "专业版", "年付", 5880, date(2026, 1, 20), date(2026, 2, 2), False, 0, False),
    ("专业版年付 5880,1 月 20 日买的,2 月 3 日想退", "专业版", "年付", 5880, date(2026, 1, 20), date(2026, 2, 3), False, 0, False),
    ("企业版年付 11880,2 月 26 日买的,4 月 30 日申请", "企业版", "年付", 11880, date(2026, 2, 26), date(2026, 4, 30), False, 0, False),
    ("基础版年付 1188,买了没几天想退", "基础版", "年付", 1188, date(2026, 10, 1), date(2026, 10, 5), False, 0, False),
    ("专业版月付 490,这个月想退", "专业版", "月付", 490, date(2026, 10, 1), date(2026, 10, 12), False, 0, False),
    ("企业版年付 11880,去年 12 月 28 日买的,今天 10 月 20 日申请", "企业版", "年付", 11880, date(2025, 12, 28), date(2026, 10, 20), False, 0, False),
    ("专业版年付 5880,5 月 31 日买的,8 月 29 日申请", "专业版", "年付", 5880, date(2026, 5, 31), date(2026, 8, 29), False, 0, False),
    ("企业版年付 11880,6 月 1 日买的,6 月 30 日申请,退过一次了", "企业版", "年付", 11880, date(2026, 6, 1), date(2026, 6, 30), True, 0, False),
    ("专业版年付 5880,7 月 9 日买的,12 月 31 日申请", "专业版", "年付", 5880, date(2026, 7, 9), date(2026, 12, 31), False, 0, False),
    ("企业版年付 11880,3 月 1 日买的,3 月 14 日申请", "企业版", "年付", 11880, date(2026, 3, 1), date(2026, 3, 14), False, 0, False),
    ("企业版年付 11880,1 月 1 日买的,3 月 31 日申请", "企业版", "年付", 11880, date(2026, 1, 1), date(2026, 3, 31), False, 0, False),
    ("专业版年付 5880,2 月 1 日买的,5 月 1 日申请", "专业版", "年付", 5880, date(2026, 2, 1), date(2026, 5, 1), False, 0, False),
    ("企业版年付 11880,1 月 1 日买的,5 月 1 日申请", "企业版", "年付", 11880, date(2026, 1, 1), date(2026, 5, 1), False, 0, False),
    ("专业版年付 5880,3 月 1 日买的,3 月 31 日申请", "专业版", "年付", 5880, date(2026, 3, 1), date(2026, 3, 31), False, 0, False),
    ("企业版年付 11880,1 月 1 日买的,12 月 26 日申请", "企业版", "年付", 11880, date(2026, 1, 1), date(2026, 12, 26), False, 0, False),
    ("企业版年付,标价 11880 用了 1000 元代金券,2 月 1 日买的,6 月 1 日申请,我要退 11880", "企业版", "年付", 10880, date(2026, 2, 1), date(2026, 6, 1), False, 1000, False),
    ("专业版年付,代金券 880,实付 5000,4 月 10 日买的,4 月 20 日申请,全退", "专业版", "年付", 5000, date(2026, 4, 10), date(2026, 4, 20), False, 880, False),
    ("企业版年付 11880,5 月 1 日买的,9 月 1 日申请,发票已经开过了", "企业版", "年付", 11880, date(2026, 5, 1), date(2026, 9, 1), False, 0, True),
    ("专业版年付 5880,8 月 3 日买的,8 月 10 日申请,发票开过了", "专业版", "年付", 5880, date(2026, 8, 3), date(2026, 8, 10), False, 0, True),
    ("基础版年付 1188,已经开了发票,买了 3 天,退", "基础版", "年付", 1188, date(2026, 10, 1), date(2026, 10, 3), False, 0, True),
    ("专业版年付 5880,3 月 1 日买的,3 月 5 日申请,已开发票,上次退过一次", "专业版", "年付", 5880, date(2026, 3, 1), date(2026, 3, 5), True, 0, True),
    ("企业版年付,标价 11880,代金券 2000,实付 9880,1 月 1 日买的,3 月 31 日申请", "企业版", "年付", 9880, date(2026, 1, 1), date(2026, 3, 31), False, 2000, False),
    ("企业版年付 11880,用了 100 天,想降到专业版,差价能退吗", "企业版降专业版", "年付", 11880, date(2026, 7, 1), date(2026, 10, 8), False, 0, False),
    ("专业版年付 5880,想转给另一家子公司,原公司这边能退吗", "专业版(转让)", "年付", 5880, date(2026, 9, 1), date(2026, 9, 20), False, 0, False),
    ("企业版年付按美元收的,1650 美元,8 月 1 日买的,8 月 9 日退", "企业版(美元)", "年付", 1650, date(2026, 8, 1), date(2026, 8, 9), False, 0, False),
]


def used_days(bought: date, applied: date) -> int:
    return (applied - bought).days + 1


def expected(
    plan: str, period: str, fee: int, bought: date, applied: date, refunded: bool, coupon: int = 0, invoiced: bool = False
) -> float | str | None:
    """标准答案。None 表示不可退款,HUMAN 表示转人工。"""
    if plan not in ("基础版", "专业版", "企业版"):
        return HUMAN
    if period == "月付" or plan == "基础版" or refunded:
        return None
    days = used_days(bought, applied)
    left = max(12 - math.ceil(days / 30), 0)
    if days > 14 and left == 0:
        return None
    if invoiced:
        return HUMAN
    if days <= 14:
        return float(fee)
    return round(fee / 12 * left, 2)
```

<div class="line-notes">

- `import math` 向上取整要用 `math.ceil`,规则 5 里「已使用天数 ÷ 30 向上取整」。
- `from datetime import date` 日期类型,两个日期相减得到天数。相当于 JS 里两个 `Date` 相减,只是 Python 直接给出 `timedelta` 对象,不是毫秒数。
- `HUMAN = "human"` 「转人工」这个标准答案用一个固定字符串表示,不能用 `None`,因为 `None` 已经表示「不可退款」。
- `RULES = """你是云簿 CloudLedger 的客服` 三个引号包起来的多行字符串。它既当执行模型的系统提示词,也会原样交给顾问。
- `3. 已使用天数 = 申请日减购买日,再加 1(购买当天算第 1 天)。` 故意设的第一个坑:天数要加 1。5 月 31 日买、8 月 29 日申请,相差 90 天,加 1 是 91 天。
- `5. 已使用超过 14 天:按剩余整月折算。` 第二个坑:91 ÷ 30 = 3.03,向上取整是 4 个月,不是 3 个月。后面实测里最容易错的就是这一类边界。
- `5a. 上面所说的「年费」一律指实际支付金额` 第三个坑:代金券抵扣的部分不算,工单里客户嘴上说「我要退 11880」,实付可能是 10880。
- `8. 已经开具发票的订阅,退款前要先作废发票` 第四个坑:开了发票的要转人工,但括号里又说规则 1、2、6 判不可退的不必转,这是个有优先级的小逻辑。
- `回答的最后一行必须是「结论:退款 X 元」` 固定输出格式,下面用正则读这一行判分。
- `# (工单, 计划, 周期, 实付, 购买日, 申请日, 是否已退过, 代金券, 已开票)` 每条工单是个 9 元素的元组,顺序在这里写明。元组相当于 JS 里不可变的定长数组。
- `CASES = [` 26 条。第一条:企业版年付 11880,3 月 5 日买、9 月 17 日申请,已用 197 天,向上取整 7 个月,剩 5 个月,标准答案 11880 ÷ 12 × 5 = 4950。
- `("企业版年付 11880,3 月 1 日买的,3 月 14 日申请"` 第 11 条,正好用了 14 天,按规则 4 全额退 11880。再晚一天(第 3 条那种)就按月折算了。
- `("企业版年付,标价 11880 用了 1000 元代金券` 第 17 条,实付 10880,标准答案按实付算:2 月 1 日买、6 月 1 日申请,已用 121 天,向上取整 5 个月,剩 7 个月,10880 ÷ 12 × 7 = 6346.67。
- `def used_days(bought: date, applied: date) -> int:` 规则 3 的实现。
- `return (applied - bought).days + 1` 两个 `date` 相减得到 `timedelta`,`.days` 取天数,再加 1。
- `def expected(` 标准答案函数,参数顺序和元组去掉第一项(工单文字)后完全一致,所以调用时可以写 `expected(*c[1:])`。
- `) -> float | str | None:` 返回值三种:金额(浮点数)、`HUMAN`、`None`(不可退款)。Python 3.12 里 `|` 可以直接写在类型标注里。
- `if plan not in ("基础版", "专业版", "企业版"):` 套餐名不在这三个里(降级、转让、美元那三条的套餐名我特意写成了「企业版降专业版」之类),就是规则没覆盖的情况,转人工。
- `if period == "月付" or plan == "基础版" or refunded:` 规则 1、2、6,直接不可退,优先于发票规则。
- `left = max(12 - math.ceil(days / 30), 0)` 规则 5 的剩余整月。`math.ceil(91 / 30)` 是 4,`12 - 4 = 8`,最少为 0。
- `if days > 14 and left == 0:` 超过 14 天且剩余 0 个月,不可退款。
- `if invoiced:` 走到这里还开着发票的,转人工。
- `if days <= 14:` 14 天以内全额退。
- `return round(fee / 12 * left, 2)` 折算金额,保留两位小数。91 天那条:5880 ÷ 12 × 8 = 3920.0。

</div>

再写判分。模型的最后一行是「结论:退款 3920.00 元」这类,用正则读出来,和标准答案比:

```python
# agent-zero-lab/part07/grade.py
import re

from part07.refund_cases import CASES, HUMAN, expected


def conclusion(text: str) -> float | str | None:
    """从回答里读最后一行「结论」。读不出来返回 'bad'。"""
    m = re.findall(r"结论[:：]\s*(不可退款|转人工|退款\s*([\d,]+(?:\.\d+)?)\s*元?)", text)
    if not m:
        return "bad"
    kind, num = m[-1]
    if kind == "不可退款":
        return None
    if kind == "转人工":
        return HUMAN
    return float(num.replace(",", ""))


def is_correct(i: int, text: str) -> bool:
    return conclusion(text) == expected(*CASES[i][1:])
```

<div class="line-notes">

- `from part07.refund_cases import CASES, HUMAN, expected` 判分只依赖上一个文件里的数据和标准答案函数。
- `def conclusion(text: str) -> float | str | None:` 从一段回答里读出模型下的结论:金额、`HUMAN`、`None`,读不出来返回字符串 `"bad"`。
- `m = re.findall(r"结论[:：]\s*(不可退款|转人工|退款\s*([\d,]+(?:\.\d+)?)\s*元?)` `re.findall` 找出所有匹配,因为模型有时会在前面的分析里也写「结论」,我们只认**最后一个**。`[:：]` 同时接受半角和全角冒号。三种结论三选一;金额那一段 `[\d,]+` 允许千分位逗号,`(?:\.\d+)?` 允许小数,`元?` 的 `?` 是我加的:Qwen3-14B 常常写「结论:退款 5880.00」不带「元」字,最开始我没放宽,把它们全判成了「读不出来」,白白多算了一批错。这是一个很典型的「评分脚本比模型还严」的坑。
- `if not m:` 一个结论都没找到。
- `return "bad"` 返回一个不可能等于任何标准答案的值,判错。
- `kind, num = m[-1]` `m[-1]` 是最后一个匹配,每个匹配是一个二元组:整段结论和金额数字。
- `if kind == "不可退款":` 对应标准答案 `None`。
- `return float(num.replace(",", ""))` 去掉千分位逗号再转浮点数。
- `return conclusion(text) == expected(*CASES[i][1:])` `CASES[i][1:]` 去掉工单文字,`*` 展开成 `expected` 的各个参数。浮点数 `3920.0 == 3920.0` 直接比较没有问题,因为两边都是 `round` 到两位的,且金额都是整百整十。

</div>

模型要通过工具拿数据,所以还要三个假工具加一个顾问工具的定义。三个业务工具的返回内容直接从 `CASES` 里取:

```python
# agent-zero-lab/part07/refund_tools.py
import json

from part07.refund_cases import CASES

TOOLS = [
    {"type": "function", "function": {
        "name": "get_subscription", "description": "按客户号查订阅:套餐、周期、实付、代金券、购买日、是否退过款",
        "parameters": {"type": "object", "properties": {"customer_id": {"type": "string"}}, "required": ["customer_id"]}}},
    {"type": "function", "function": {
        "name": "list_invoices", "description": "按客户号查发票列表,看这份订阅有没有开过发票",
        "parameters": {"type": "object", "properties": {"customer_id": {"type": "string"}}, "required": ["customer_id"]}}},
    {"type": "function", "function": {
        "name": "create_refund_request", "description": "提交退款申请(进主管审批)。只有结论是「退款 X 元」时才能调",
        "parameters": {"type": "object", "properties": {"customer_id": {"type": "string"}, "amount": {"type": "number"}},
                       "required": ["customer_id", "amount"]}}},
]

ADVISOR_TOOL = {"type": "function", "function": {
    "name": "advisor", "description": "向更强的顾问模型求助。顾问能看到完整对话,不需要参数。",
    "parameters": {"type": "object", "properties": {}}}}


def customer_id(i: int) -> str:
    return f"C{i + 1:03d}"


def run_tool(name: str, args: dict, ticket: int, created: list[float]) -> str:
    _, plan, period, fee, bought, _, refunded, coupon, invoiced = CASES[ticket]
    if args.get("customer_id") != customer_id(ticket):
        return json.dumps({"error": "客户不存在"}, ensure_ascii=False)
    if name == "get_subscription":
        return json.dumps(
            {"plan": plan, "period": period, "paid": fee, "coupon": coupon, "bought": str(bought), "refunded_before": refunded},
            ensure_ascii=False,
        )
    if name == "list_invoices":
        rows = [{"no": f"INV-{ticket:04d}", "issued": invoiced, "amount": fee}] if invoiced else []
        return json.dumps(rows, ensure_ascii=False)
    if name == "create_refund_request":
        created.append(float(args.get("amount", 0)))
        return json.dumps({"ok": True, "status": "待主管审批"}, ensure_ascii=False)
    return json.dumps({"error": f"没有这个工具 {name}"}, ensure_ascii=False)
```

<div class="line-notes">

- `TOOLS = [` 三个工具的 JSON Schema 定义,格式和 [Day 158](/blog/agent-zero/day-158-fc-first-run/) 学的 `tools` 参数一样。
- `"name": "get_subscription", "description": "按客户号查订阅` 返回套餐、周期、实付、代金券、购买日、是否退过款。申请日不在这里,在用户消息里给。
- `"name": "list_invoices", "description": "按客户号查发票列表` 返回这份订阅开过的发票,没开过就是空列表。
- `"name": "create_refund_request", "description": "提交退款申请` 这是有副作用的工具,真实系统里会进主管审批。所以评分里有一项「错误退款申请」:模型调用它时填的金额和标准答案不一致,就算一次危险动作。
- `ADVISOR_TOOL = {` 顾问工具,对执行模型来说和别的工具一样,只是 `parameters` 的 `properties` 是空的:和官方一样,顾问要看的东西由我们的代码给,执行模型不用写参数。
- `def customer_id(i: int) -> str:` 第 i 张工单对应的客户号。
- `return f"C{i + 1:03d}"` `:03d` 是补零到三位,第 0 张是 `C001`,第 7 张是 `C008`。
- `def run_tool(name: str, args: dict, ticket: int, created: list[float]) -> str:` 工具的执行函数:工具名、参数、第几张工单、一个记录「提交过哪些退款金额」的列表。返回 JSON 字符串。
- `_, plan, period, fee, bought, _, refunded, coupon, invoiced = CASES[ticket]` 元组解包,两个 `_` 是不要的值(工单文字和申请日)。
- `if args.get("customer_id") != customer_id(ticket):` 客户号对不上就报错,防止模型乱编客户号。
- `if name == "get_subscription":` 返回订阅信息。
- `rows = [{"no": f"INV-{ticket:04d}", "issued": invoiced, "amount": fee}] if invoiced else []` 开过发票就返回一条,没开过返回空列表。
- `created.append(float(args.get("amount", 0)))` 记下模型填的退款金额,后面判分用。
- `return json.dumps({"error": f"没有这个工具 {name}"}, ensure_ascii=False)` 其余名字当作未知工具。

</div>

## 第一步:不带顾问,先量三个单干的基线

Agent 循环本身 [Day 166](/blog/agent-zero/day-166-agent-min/) 写过:调模型,有 `tool_calls` 就执行工具、把结果追加到消息里再调,没有就结束。今天的版本多做三件事:每次调用都记 token、耗时和钱(沿用 Day 396 的 `call_cost`),把对话渲染成文字给顾问看,以及最后判分。先看文件的前半部分,模型配置和 `chat` 函数。因为今天要混用两家厂商,`pricing.py` 先加两行:

```python
# agent-zero-lab/part07/pricing.py(加两行,放在 PRICES 里)
    # 硅基流动的小模型,没查到它们的价格,账单里先按 flash 的价钱算(只会高估执行侧)
    "Qwen/Qwen3-14B": {"peak": (2.0, 2.0, 8.0), "idle": (1.0, 1.0, 4.0)},
```

<div class="line-notes">

- `# 硅基流动的小模型,没查到它们的价格` 我在硅基流动的定价页没找到 Qwen3-14B 的价格(页面只展开了新模型),所以这个价格是假设,不是事实。
- `"Qwen/Qwen3-14B": {"peak": (2.0, 2.0, 8.0), "idle": (1.0, 1.0, 4.0)},` 命中价和未命中价都写成 flash 的未命中价(峰时 2 元输入、8 元输出)。这样做有两个后果:一是执行侧的钱被我高估了(flash 的命中价只要 0.04,硅基流动的接口实际也返回缓存命中数,但我不知道它怎么收);二是后面所有「执行侧」的花费都带这个假设。顾问 `deepseek-v4-pro` 的价格是 Day 396 从官方定价页抄的真价。

</div>

```python
# agent-zero-lab/part07/refund_agent.py
import asyncio
import json
import os
import time
from datetime import datetime, timezone

from dotenv import load_dotenv
from openai import AsyncOpenAI
from openai.types.chat import ChatCompletionMessageParam

from part07.grade import conclusion, is_correct
from part07.pricing import call_cost, period_at
from part07.refund_cases import CASES, RULES, expected
from part07.refund_tools import ADVISOR_TOOL, TOOLS, customer_id, run_tool

load_dotenv()
EXTRA = json.loads(os.environ.get("LLM_EXTRA_BODY", "{}"))
DEEPSEEK = AsyncOpenAI(base_url=os.environ["LLM_BASE_URL"], api_key=os.environ["LLM_API_KEY"], timeout=90, max_retries=1)
SILICON = AsyncOpenAI(base_url=os.environ["EMB_BASE_URL"], api_key=os.environ["EMB_API_KEY"], timeout=90, max_retries=12)
# 模型名 → (客户端, 额外参数)
PROVIDERS = {
    "deepseek-flash": (DEEPSEEK, EXTRA),
    "deepseek-v4-pro": (DEEPSEEK, EXTRA),
    "Qwen/Qwen2.5-7B-Instruct": (SILICON, {}),
    "Qwen/Qwen3-14B": (SILICON, {"enable_thinking": False}),
}
MAX_TURNS = 8

TIMING = (
    "\n你可以调用 advisor 工具向更强的顾问求助。顾问只看得到这段对话里已有的内容,没查数据就问等于白问。"
    "所以顺序是:先调 get_subscription 和 list_invoices 把数据查全,再调用一次 advisor(不用写参数),"
    "最后照顾问的判断办。"
)


async def chat(model: str, messages: list[ChatCompletionMessageParam], tools: list | None, ticket: str, node: str) -> tuple:
    client, extra = PROVIDERS[model]
    t0 = time.perf_counter()
    kw: dict = {"tools": tools} if tools else {}
    resp = await client.chat.completions.create(
        model=model, messages=messages, max_tokens=700, extra_body=extra, **kw
    )
    sec = time.perf_counter() - t0
    u = resp.usage
    now = datetime.now(timezone.utc)
    call = {
        "ticket_id": ticket, "node": node, "model": model, "sec": round(sec, 2),
        "prompt": u.prompt_tokens if u else 0,
        "hit": getattr(u, "prompt_cache_hit_tokens", 0) or 0,
        "completion": u.completion_tokens if u else 0,
    }
    call["cost"] = call_cost(model, call["prompt"], call["hit"], call["completion"], period_at(now))
    return resp.choices[0].message, call
```

<div class="line-notes">

- `import time` 要用 `time.perf_counter()` 给每次调用计时。
- `from openai import AsyncOpenAI` 异步客户端,[Day 68](/blog/agent-zero/day-068-async-3/) 学过 `gather`。工单之间要并发跑,所以用异步。
- `from part07.pricing import call_cost, period_at` Day 396 的计价函数。
- `from part07.refund_cases import CASES, RULES, expected` 数据、规则和标准答案。
- `EXTRA = json.loads(os.environ.get("LLM_EXTRA_BODY", "{}"))` `.env` 里关掉 DeepSeek 思考模式的那段 `{"thinking": {"type": "disabled"}}`。
- `DEEPSEEK = AsyncOpenAI(` DeepSeek 官方的客户端。`timeout=90, max_retries=1`:90 秒还没回就放弃,最多重试一次。我最开始没设超时,有一次整批跑了 15 分钟没结果,才发现是某个请求卡住了,默认超时是 10 分钟。
- `SILICON = AsyncOpenAI(` 硅基流动的客户端,用的是 `.env` 里 `EMB_*` 那组(同一个账号,Day 217 起它是 embedding 服务,今天兼做聊天)。`max_retries=12` 给得很高,因为它的 TPM(每分钟 token 数)限额很低,跑 52 张工单时我连续碰到 `429 TPM limit reached`,SDK 自动退避重试才跑得完。
- `"Qwen/Qwen3-14B": (SILICON, {"enable_thinking": False}),` Qwen3 默认会先想一大段再答,`enable_thinking: False` 关掉,让它当一个「直接干活」的小执行模型。
- `MAX_TURNS = 8` 循环最多 8 轮,防止小模型陷进「反复调工具」里出不来。
- `TIMING = (` 告诉执行模型什么时候问顾问的那段提示词,暂时先不用,第二步再讲。
- `async def chat(model: str, messages` 所有模型调用都从这一个函数过,执行模型和顾问都一样,这样记账只写一处。
- `client, extra = PROVIDERS[model]` 按模型名找客户端和额外参数。
- `t0 = time.perf_counter()` 计时起点。`perf_counter` 是 Python 里测短时间间隔的标准函数,相当于 JS 的 `performance.now()`,单位是秒。
- `kw: dict = {"tools": tools} if tools else {}` 顾问那次调用不带工具,所以 `tools` 是 `None`,这里不往请求里放这个参数。
- `resp = await client.chat.completions.create(` 真正的请求。`max_tokens=700` 给小模型的回答留足长度。
- `"hit": getattr(u, "prompt_cache_hit_tokens", 0) or 0,` Day 396 讲过的写法:DeepSeek 自己加的字段,SDK 类型里没有,用 `getattr`。硅基流动也返回这个字段名(实测 Qwen3-14B 的调用里有 832 之类的命中数)。
- `call["cost"] = call_cost(model, call["prompt"],` 当场算钱,单位元。`period_at(now)` 用调用的那一刻判断峰谷。我所有实验都是北京时间工作日上午 10 点到 12 点之间跑的,全程峰时价,所以各配置之间的价格口径一致。
- `return resp.choices[0].message, call` 返回模型的消息对象和一条记录。

</div>

接着是循环本体。这是文件的后半部分,里面有几行只在带顾问时才执行,先不管它们:

```python
# agent-zero-lab/part07/refund_agent.py(节选)
async def run_ticket(i: int, executor: str, advisor: str = "", timing: str = TIMING, nudge: bool = False) -> dict:
    ticket = f"T{i:02d}"
    cid = customer_id(i)
    applied = CASES[i][5]
    system = RULES + "\n工具里查到的数据就是事实。要退款时先调 create_refund_request 再写结论。" + (timing if advisor else "")
    messages: list[ChatCompletionMessageParam] = [
        {"role": "system", "content": system},
        {"role": "user", "content": f"客户 {cid} 来问退款,申请日 {applied}。"},
    ]
    tools = [*TOOLS, ADVISOR_TOOL] if advisor else TOOLS
    calls: list[dict] = []
    created: list[float] = []
    asked = 0
    nudged = 0
    final = ""
    for _ in range(MAX_TURNS):
        msg, call = await chat(executor, messages, tools, ticket, "executor")
        calls.append(call)
        messages.append(msg.model_dump(exclude_none=True))  # type: ignore[arg-type]
        if not msg.tool_calls:
            if nudge and advisor and asked == 0 and nudged == 0:
                nudged = 1  # 执行模型想不问顾问就收工:催一次
                messages.append({"role": "user", "content": "你还没有调用 advisor。先调用它,再写结论。"})
                continue
            final = msg.content or ""
            break
        for tc in msg.tool_calls:
            name = tc.function.name  # type: ignore[union-attr]
            if name == "advisor" and advisor:
                asked += 1
                text, ac = await ask_advisor(advisor, messages, ticket)
                calls.append(ac)
                result = text
            else:
                try:
                    args = json.loads(tc.function.arguments or "{}")  # type: ignore[union-attr]
                except json.JSONDecodeError:
                    args = {}
                result = run_tool(name, args, i, created)
            messages.append({"role": "tool", "tool_call_id": tc.id, "content": result})
    ok = is_correct(i, final)
    concl = conclusion(final)
    # 危险动作:提交了退款申请,但金额和标准答案不一致,或者标准答案根本不该退
    want = expected(*CASES[i][1:])
    bad_action = any(not isinstance(want, float) or abs(a - want) > 0.01 for a in created)
    return {
        "i": i, "ok": ok, "final": final, "nudged": nudged, "concl": concl, "asked": asked, "bad_action": bad_action,
        "cost": sum(c["cost"] for c in calls), "sec": sum(c["sec"] for c in calls),
        "exec_calls": sum(c["node"] == "executor" for c in calls), "calls": calls,
    }


async def run_all(executor: str, advisor: str, tag: str, reps: int = 1, timing: str = TIMING, workers: int = 2, nudge: bool = False) -> list[dict]:
    sem = asyncio.Semaphore(workers)

    async def one(i: int) -> dict:
        async with sem:
            return await run_ticket(i, executor, advisor, timing, nudge)

    results = await asyncio.gather(*(one(i) for _ in range(reps) for i in range(len(CASES))))
    with open(f"logs/{tag}.jsonl", "w", encoding="utf-8") as f:
        for r in results:
            f.write(json.dumps(r, ensure_ascii=False, default=str) + "\n")
    return list(results)


def summarize(name: str, rs: list[dict]) -> str:
    n = len(rs)
    ok = sum(r["ok"] for r in rs)
    bad = sum(r["bad_action"] for r in rs)
    asked = sum(r["asked"] > 0 for r in rs)
    cost = sum(r["cost"] for r in rs) / n * 100
    sec = sorted(r["sec"] for r in rs)[n // 2]
    return f"{name:<22} 对 {ok}/{n}  错误退款申请 {bad}  问了顾问 {asked}/{n}  每张 {cost:.4f} 分  中位耗时 {sec:.1f}s"
```

<div class="line-notes">

- `async def run_ticket(i: int, executor: str, advisor: str = ""` 处理一张工单:第几张、执行模型是谁、顾问是谁(空字符串就是不带顾问)。
- `ticket = f"T{i:02d}"` 工单号,`T07` 这种,记账和日志都带着。
- `applied = CASES[i][5]` 申请日放在第一条用户消息里,不放进工具,因为现实里「今天」是请求带来的,不是数据库里的。
- `system = RULES + "\n工具里查到的数据就是事实。` 系统提示词是规则加一句话;只有带顾问时才再拼上 `TIMING`(那一整段话在第二步看)。
- `{"role": "user", "content": f"客户 {cid} 来问退款,申请日 {applied}。"},` 用户消息只有客户号和申请日,订阅信息必须自己去工具里查。
- `tools = [*TOOLS, ADVISOR_TOOL] if advisor else TOOLS` `[*TOOLS, ADVISOR_TOOL]` 把三个业务工具展开再追加顾问工具,相当于 JS 的 `[...TOOLS, ADVISOR_TOOL]`。没配顾问就只给三个业务工具。
- `created: list[float] = []` 收集模型调用 `create_refund_request` 时填的金额,循环结束后判「危险动作」。
- `asked = 0` 这张工单里顾问被问了几次。
- `nudged = 0` 催过几次,第二步的内容,先忽略。
- `for _ in range(MAX_TURNS):` 最多 8 轮。`_` 表示循环变量用不上。
- `msg, call = await chat(executor, messages, tools, ticket, "executor")` 调执行模型,`node` 记成 `"executor"`,账单上区分执行侧和顾问侧靠这个。
- `messages.append(msg.model_dump(exclude_none=True))` 把模型这一条消息原样追加进历史(`tool_calls` 也在里面)。`model_dump` 是 pydantic 对象转字典,`exclude_none` 去掉值为空的字段,否则有的厂商会因为 `"content": null` 报 400。
- `if not msg.tool_calls:` 没有工具调用就是模型要收工了。
- `final = msg.content or ""` 最终回答,最后一行应该是「结论:…」。
- `for tc in msg.tool_calls:` 一步里可能有多个调用([Day 162](/blog/agent-zero/day-162-parallel-tools/) 的并行工具调用),逐个执行,**按模型给的顺序**。这个顺序在第二步会变得很重要。
- `if name == "advisor" and advisor:` 顾问调用特殊处理,第二步展开。
- `text, ac = await ask_advisor(advisor, messages, ticket)` 同上。
- `result = text` 顾问的回答就是这次工具调用的结果。
- `args = json.loads(tc.function.arguments or "{}")` 业务工具:参数是 JSON 字符串,解析成字典。
- `result = run_tool(name, args, i, created)` 执行假工具,拿到 JSON 字符串结果。
- `messages.append({"role": "tool", "tool_call_id": tc.id, "content": result})` 每个调用都要回一条 `tool` 消息,`tool_call_id` 对上,否则下一次请求 400([Day 161](/blog/agent-zero/day-161-missing-result/) 讲过)。
- `ok = is_correct(i, final)` 用上面的 `grade.py` 判分。
- `want = expected(*CASES[i][1:])` 标准答案。
- `bad_action = any(` 只要有一次提交的金额不对,或者标准答案根本不是金额(不可退款或转人工)却提交了退款申请,就记一次危险动作。这个指标比「结论对不对」更接近真实损失:最后一句话写错了客户可以再问,提交错了金额的退款单会进审批,运气不好就批出去了。
- `"cost": sum(c["cost"] for c in calls),` 这张工单的总花费,执行和顾问都算。
- `async def run_all(` 一批工单并发跑。
- `sem = asyncio.Semaphore(workers)` 限并发,默认 2。硅基流动 14B 的 TPM 限额低,并发开大了会 429。
- `results = await asyncio.gather(` `reps` 次重复乘以 26 张工单,全部丢给 `gather`,实际同时跑的数量被 `sem` 卡在 2。
- `with open(f"logs/{tag}.jsonl", "w", encoding="utf-8") as f:` 每一张的完整记录(含每次调用的 token)落到日志,后面的算账脚本读它。
- `def summarize(` 一行汇总。
- `cost = sum(r["cost"] for r in rs) / n * 100` 单位换成「分」,每张工单平均花几分钱。
- `sec = sorted(r["sec"] for r in rs)[n // 2]` 取中位数,比平均数稳。

</div>

一个小的命令行入口,把几种配置写成一张表:

```python
# agent-zero-lab/part07/refund_run.py
import asyncio
import sys

from part07.refund_agent import run_all, summarize

FLASH, PRO, SMALL = "deepseek-flash", "deepseek-v4-pro", "Qwen/Qwen3-14B"
# 名字 → (执行模型, 顾问模型, 没问顾问时是否催一次)
CONFIGS = {
    "small": (SMALL, "", False),
    "flash": (FLASH, "", False),
    "pro": (PRO, "", False),
    "adv": (SMALL, PRO, False),
    "advn": (SMALL, PRO, True),
}


async def main(name: str, tag: str, reps: int) -> None:
    executor, advisor, nudge = CONFIGS[name]
    results = await run_all(executor, advisor, f"{name}-{tag}", reps=reps, nudge=nudge)
    print(summarize(name, results))


if __name__ == "__main__":
    asyncio.run(main(sys.argv[1], sys.argv[2], int(sys.argv[3])))
```

<div class="line-notes">

- `FLASH, PRO, SMALL = "deepseek-flash", "deepseek-v4-pro", "Qwen/Qwen3-14B"` 三个模型起短名,元组解包。
- `CONFIGS = {` 配置名 → (执行模型, 顾问模型, 是否催一次)。
- `"small": (SMALL, "", False),` 小模型单干。
- `"flash": (FLASH, "", False),` 便宜的 DeepSeek 单干,它是 Day 399 以来一直在用的模型。
- `"pro": (PRO, "", False),` 强模型单干。
- `"adv": (SMALL, PRO, False),` 小模型加顾问,不催。
- `"advn": (SMALL, PRO, True),` 小模型加顾问,没问就收工时催一次。
- `results = await run_all(executor, advisor, f"{name}-{tag}", reps=reps, nudge=nudge)` 日志文件名是配置名加标签,比如 `logs/small-f.jsonl`。
- `asyncio.run(main(sys.argv[1], sys.argv[2], int(sys.argv[3])))` 命令行三个参数:配置名、标签、重复几次。

</div>

先跑三个不带顾问的基线,每个配置 2 遍共 52 张(同一时段连着跑,都在工作日上午的峰时价里):

```bash
cd agent-zero-lab
uv add python-dotenv openai
uv run python -m part07.refund_run small f 2
uv run python -m part07.refund_run flash f 2
uv run python -m part07.refund_run pro f 2
```

```text
small                  对 13/52  错误退款申请 36  问了顾问 0/52  每张 0.7074 分  中位耗时 9.7s
flash                  对 51/52  错误退款申请 2  问了顾问 0/52  每张 0.3776 分  中位耗时 3.5s
pro                    对 51/52  错误退款申请 1  问了顾问 0/52  每张 1.1825 分  中位耗时 5.5s
```

读这三行要注意几件事。`small` 的耗时 9.7 秒不能和另外两行比,它是被硅基流动的 429 重试拖慢的,这一列我后面不再用。再看通过率:14B 单干只对 13/52,而且 52 张里有 36 张提交了金额不对的退款申请。它的毛病很稳定,看日志里的第 0 张:查完订阅、查完发票,下一步直接 `create_refund_request` 填了 11880,也就是整年的钱,标准答案是 4950。它根本没按规则折算,看到「企业版年付 11880」就全额退了。这正是我们想让顾问去纠正的那种错:不是体力活出错,是那一个判断上出错。

另外两行出乎我的意料:`deepseek-flash` 单干 51/52,每张才 0.3776 分,比强模型便宜三倍多,通过率一样。这一点先放着,等会儿对比的时候它会变成主角。两个模型各错的那几张里有一张是共同的,第 22 张(实付 9880 的代金券那条):1 月 1 日买、3 月 31 日申请,正好 90 天,90 ÷ 30 = 3,剩 9 个月,标准答案 7410;它们都写成 6586.67,也就是按 4 个月算,多数了一天。同一个日期区间,第 11 张(没代金券)它们能算对,加了代金券那条就错了,模型的日期算术其实不稳,只是大多数时候碰巧对。

## 第二步:把顾问接进来

顾问工具对执行模型来说只是一个没有参数的函数。真正的活在我们的代码里:执行模型一调用它,我们把这段对话渲染成文字,交给顾问模型,回答作为工具结果还回去。这样做的原因很具体:`tool_calls` 那种消息格式,顾问模型不一定喜欢,尤其是对话末尾还有一条「还没有结果的 advisor 调用」,不少厂商的接口会直接 400(我第一版就是直接把消息列表去掉最后一条再转发,一旦同一步里有多个调用,就撞上了 `insufficient tool messages` 这个 400)。渲染成纯文本一劳永逸,也正好是官方「顾问读整段对话」的做法:

```python
# agent-zero-lab/part07/refund_agent.py(节选)
def transcript(messages: list[ChatCompletionMessageParam]) -> str:
    """把对话渲染成一段纯文本,顾问读它,不用管 tool_calls 的消息格式。"""
    lines = []
    for m in messages:
        role = m["role"]
        if role == "system":
            continue
        if role == "user":
            lines.append(f"[工单] {m.get('content')}")
        elif role == "tool":
            lines.append(f"[工具返回] {m.get('content')}")
        else:
            for tc in m.get("tool_calls") or []:
                lines.append(f"[客服调用] {tc['function']['name']}({tc['function']['arguments']})")  # type: ignore[index]
            if m.get("content"):
                lines.append(f"[客服说] {m.get('content')}")
    return "\n".join(lines)


async def ask_advisor(advisor_model: str, messages: list[ChatCompletionMessageParam], ticket: str) -> tuple[str, dict]:
    """顾问看到整段对话的文字版,只回一段短建议。"""
    view: list[ChatCompletionMessageParam] = [
        {"role": "system", "content": RULES},
        {"role": "user", "content": "下面是客服同事处理一张退款工单的过程:\n" + transcript(messages)
         + "\n\n你是顾问:逐条对照规则,指出这张工单该怎么判断,给出该写的「结论」那一行,总共不超过 150 字。"},
    ]
    msg, call = await chat(advisor_model, view, None, ticket, "advisor")
    return (msg.content or "").strip(), call

```

<div class="line-notes">

- `def transcript(messages: list[ChatCompletionMessageParam]) -> str:` 输入整段对话的消息列表,输出一段纯文字。
- `lines = []` 先攒成一行一行的列表,最后用换行拼起来。
- `for m in messages:` 一条一条看。
- `if role == "system":` 系统提示词不渲染,因为顾问有自己的系统提示词(下面 `ask_advisor` 里放的是 `RULES`)。
- `lines.append(f"[工单] {m.get('content')}")` 用户消息标成 `[工单]`。`m.get('content')` 写成 `.get` 而不是 `m['content']`,因为在类型标注里助手消息的 `content` 不是必有的键,用方括号会被类型检查器报红。
- `lines.append(f"[工具返回] {m.get('content')}")` 工具结果标成 `[工具返回]`。
- `for tc in m.get("tool_calls") or []:` 助手消息里可能带 `tool_calls`,没有的话 `m.get(...)` 返回 `None`,`or []` 兜成空列表,循环就是零次。
- `lines.append(f"[客服调用] {tc['function']['name']}(` 模型发出的调用渲染成「工具名(参数)」。
- `if m.get("content"):` 助手消息有正文才加。
- `lines.append(f"[客服说] {m.get('content')}")` 把正文标成 `[客服说]`。
- `return "\n".join(lines)` 用换行拼成一个字符串。
- `async def ask_advisor(advisor_model: str, messages` 顾问这一次调用。
- `{"role": "system", "content": RULES},` 顾问的系统提示词就是退款规则本身。执行模型有这段规则是因为它也读 `RULES`,但**顾问不会自动继承执行模型的系统提示词**,得我们自己放进去。这一行后面还要为它付出一个教训。
- `{"role": "user", "content": "下面是客服同事处理一张退款工单的过程:\n" + transcript(messages)` 整段对话的文字版。
- `+ "\n\n你是顾问:逐条对照规则,指出这张工单该怎么判断,给出该写的「结论」那一行,总共不超过 150 字。"},` 限制顾问的输出长度,和官方文档建议的「在用户消息里要求顾问简短」是同一招,软约束。
- `msg, call = await chat(advisor_model, view, None, ticket, "advisor")` 顾问调用也走 `chat`,`tools` 传 `None`(顾问不带工具),`node` 记成 `"advisor"`。
- `return (msg.content or "").strip(), call` 返回建议文字和这次调用的记录。

</div>

再看提示词。`run_ticket` 里 `TIMING` 那段决定了执行模型什么时候问顾问。我最开始写的是这样一句:「查完订阅和发票、给出结论之前,必须先调用一次 advisor,照它的判断办。顾问看得到整段对话,调用时不用写任何参数。」执行模型当时用的是更小的 `Qwen/Qwen2.5-7B-Instruct`(我想先拿最小的试试)。跑完 26 张,看日志里每张工单的调用顺序,有 11 张是这样的:执行模型的第一次调用就是 `advisor`,在查任何数据之前。这时顾问看到的对话只有一句「客户 C001 来问退款,申请日……」,478 个输入 token 几乎全是规则本身。它当然答不出来,要么说「请提供信息」,要么凭空编。

这是文档里那条「先摸清情况再问」的反面教材。小模型读到「给出结论之前必须先问」,理解成了「先问了再说」。改法是在提示词里把顺序写死,并且告诉它为什么:「顾问只看得到这段对话里已有的内容,没查数据就问等于白问。所以顺序是:先调 get_subscription 和 list_invoices 把数据查全,再调用一次 advisor,最后照顾问的判断办。」这就是文件里 `TIMING` 的内容。后来我又发现 7B 另一个毛病,它偶尔把工具调用写成一段文字而不是结构化的 `tool_calls`(最终回答里出现 `{"name": "advisor", "arguments": {}}` 这种字符串),这一轮就废了。这是小模型的通病,下面换成 `Qwen3-14B`,这个毛病基本消失。

我还在循环里留了一个催促的开关,对应文档里的 nudge:执行模型想不问顾问就收工,我们追加一条用户消息「你还没有调用 advisor。先调用它,再写结论。」,只催一次。对应 `run_ticket` 里的 `if nudge and advisor and asked == 0 and nudged == 0:` 那几行。

现在跑带顾问的两个配置,每个 2 遍共 52 张。`adv` 是只靠提示词让它问,`advn` 是没问就催一次:

```bash
uv run python -m part07.refund_run adv f 2
uv run python -m part07.refund_run advn f 2
```

```text
adv                    对 50/52  错误退款申请 1  问了顾问 48/52  每张 0.9819 分  中位耗时 6.4s
advn                   对 50/52  错误退款申请 2  问了顾问 52/52  每张 1.0488 分  中位耗时 11.0s
```

(耗时那一列不同次运行遇到的限速情况不一样,不要横向比。)

同一个 14B 执行模型,有顾问以后从 13/52 到 50/52,错误退款申请从 36 次降到 1 到 2 次。顾问确实在做事:它读到查出来的订阅数据,逐条对照规则,回一小段。拿第 7 张(91 天那条)来看,我单独跑这一张,把顾问的输入输出打印出来:

```text
---- 顾问看到的对话 ----
[工单] 客户 C008 来问退款,申请日 2026-08-29。
[客服调用] get_subscription({"customer_id": "C008"})
[客服调用] list_invoices({"customer_id": "C008"})
[客服调用] advisor({})
[工具返回] {"plan": "专业版", "period": "年付", "paid": 5880, "coupon": 0, "bought": "2026-05-31", "refunded_before": false}
[工具返回] []
---- 顾问的回答 ----
规则2：年付专业版可退款。规则3：已使用天数=2026-08-29减2026-05-31加1，共91天。规则5：91天超过14天，已使用月数=91÷30向上取整=4，剩余整月=12-4=8。退款=5880÷12×8=3920。无发票、未退过。  
结论:退款 3920.00 元
```

注意这段对话里的顺序:执行模型在**同一步**里同时发出了三个调用(查订阅、查发票、问顾问),而 `transcript` 先渲染了三个调用,再渲染了两个工具返回。顾问能看到数据,是因为我们的循环是按顺序处理的:前两个工具的结果先追加进 `messages`,处理到 `advisor` 时它们已经在里面了。如果模型把 `advisor` 排在第一个,顾问就什么数据也看不到。这是运气,也是第四步 Pydantic AI 那一节要碰到的坑,练习里会让你改。

顾问的回答 100 个输出 token,输入 513 个,其中 384 个命中缓存(前缀是那份规则)。账单上这一次是 0.4 分左右(峰时价)。这是一次很典型的 Advisor 调用:短、准,代价是多了一次往返。

再看一个有意思的细节:`adv` 里 52 张只有 48 张问了顾问,没问的 4 张是哪几张?我写了个小脚本从日志里查:

```python
# agent-zero-lab/part07/advisor_regrade.py
import json
import sys

for tag in sys.argv[1:]:
    rs = [json.loads(line) for line in open(f"logs/{tag}.jsonl", encoding="utf-8")]
    asked = [r for r in rs if r["asked"] > 0]
    skipped = [r for r in rs if r["asked"] == 0]
    print(f"{tag}: 问了顾问 {len(asked)} 张,对 {sum(r['ok'] for r in asked)};没问 {len(skipped)} 张,对 {sum(r['ok'] for r in skipped)}")
    for r in skipped:
        print("   没问:T%02d" % r["i"], "对" if r["ok"] else "错", r["concl"])
```

<div class="line-notes">

- `for tag in sys.argv[1:]:` 命令行传几个日志标签就分析几个。`sys.argv[0]` 是脚本名,所以从 `[1:]` 开始。
- `rs = [json.loads(line) for line in open(f"logs/{tag}.jsonl", encoding="utf-8")]` 每行一个 JSON,列表推导式读成字典列表。
- `asked = [r for r in rs if r["asked"] > 0]` 问了顾问的工单。
- `skipped = [r for r in rs if r["asked"] == 0]` 没问的。
- `print(f"{tag}: 问了顾问 {len(asked)} 张,对 {sum(r['ok'] for r in asked)};` 各自的通过数。
- `for r in skipped:` 把没问的逐张列出来。
- `print("   没问:T%02d" % r["i"], "对" if r["ok"] else "错", r["concl"])` 这里用了老式的 `%` 格式化,`%02d` 等于 f-string 的 `:02d`。

</div>

```bash
uv run python -m part07.advisor_regrade adv-f advn-f
```

```text
adv-f: 问了顾问 48 张,对 46;没问 4 张,对 4
   没问:T04 对 None
   没问:T05 对 None
   没问:T08 对 None
   没问:T04 对 None
advn-f: 问了顾问 52 张,对 50;没问 0 张,对 0
```

没问顾问的 4 次,全是第 4、5、8 张:基础版年付、月付、已退过,三条都是规则 1、2、6 直接判「不可退款」的最简单情形,14B 自己就能答对(输出的 `None` 就是「不可退款」)。所以这里「执行模型自己觉得有把握就不问」恰好是对的,催它问反而多花了钱(`advn` 每张 1.0488 分,比 `adv` 的 0.9819 分贵 7%,通过数一样)。Advisor 的「该问不问」不一定是缺陷,要看它漏问的是难题还是简单题。这份数据里它漏的是简单题。

## 第三步:钱花在哪,算清楚

通过率有了,下一个问题是钱:`adv` 每张 0.9819 分,这里面执行侧和顾问侧各占多少?日志里每次调用都记了 `node`,写个小脚本拆开:

```python
# agent-zero-lab/part07/advisor_split.py
import json
import sys


def load(tag: str) -> list[dict]:
    return [json.loads(line) for line in open(f"logs/{tag}.jsonl", encoding="utf-8")]


def split(tag: str) -> None:
    rs = load(tag)
    n = len(rs)
    ex = sum(c["cost"] for r in rs for c in r["calls"] if c["node"] == "executor") / n * 100
    ad = sum(c["cost"] for r in rs for c in r["calls"] if c["node"] == "advisor") / n * 100
    n_ex = sum(1 for r in rs for c in r["calls"] if c["node"] == "executor") / n
    n_ad = sum(1 for r in rs for c in r["calls"] if c["node"] == "advisor") / n
    ad_in = [c["prompt"] for r in rs for c in r["calls"] if c["node"] == "advisor"]
    ad_out = [c["completion"] for r in rs for c in r["calls"] if c["node"] == "advisor"]
    print(f"{tag:<10} 执行侧 {ex:.4f} 分({n_ex:.1f} 次) 顾问侧 {ad:.4f} 分({n_ad:.2f} 次)", end="")
    if ad_in:
        print(f"  顾问平均输入 {sum(ad_in)/len(ad_in):.0f} 输出 {sum(ad_out)/len(ad_out):.0f} token")
    else:
        print()


if __name__ == "__main__":
    for t in sys.argv[1:]:
        split(t)
```

<div class="line-notes">

- `def load(tag: str) -> list[dict]:` 读一个日志文件,每行一个工单的完整记录。
- `ex = sum(c["cost"] for r in rs for c in r["calls"] if c["node"] == "executor") / n * 100` 双层生成器:对每张工单 `r`、它的每次调用 `c`,只要 `node` 是执行模型就累加花费,除以工单数,乘 100 换成分。这样的两层 `for` 写在一个生成器里,读的顺序和嵌套循环一样,从左到右先外层后内层。
- `ad = sum(c["cost"] for r in rs for c in r["calls"] if c["node"] == "advisor") / n * 100` 同样的写法,筛的是顾问调用。
- `n_ex = sum(1 for r in rs for c in r["calls"] if c["node"] == "executor") / n` 每张工单平均调了几次执行模型,也就是循环的平均轮数。
- `n_ad = sum(1 for r in rs for c in r["calls"] if c["node"] == "advisor") / n` 每张工单平均问了顾问几次,不到 1 说明有的工单没问。
- `ad_in = [c["prompt"] for r in rs` 所有顾问调用的输入 token 数,留着算平均。
- `ad_out = [c["completion"] for r in rs` 所有顾问调用的输出 token 数。
- `print(f"{tag:<10} 执行侧 {ex:.4f} 分({n_ex:.1f} 次) 顾问侧` `{tag:<10}` 左对齐占 10 格,几行输出对得整齐。`end=""` 表示不换行,后面还要接着打。
- `if ad_in:` 没有顾问调用的配置(单干)列表是空的,空列表是假值。
- `print(f"  顾问平均输入 {sum(ad_in)/len(ad_in):.0f} 输出` 平均输入和输出各多少 token。

</div>

```bash
uv run python -m part07.advisor_split small-f flash-f pro-f adv-f advn-f
```

```text
small-f    执行侧 0.7074 分(3.8 次) 顾问侧 0.0000 分(0.00 次)
flash-f    执行侧 0.3776 分(2.7 次) 顾问侧 0.0000 分(0.00 次)
pro-f      执行侧 1.1825 分(2.8 次) 顾问侧 0.0000 分(0.00 次)
adv-f      执行侧 0.7276 分(3.2 次) 顾问侧 0.2544 分(0.92 次)  顾问平均输入 517 输出 75 token
advn-f     执行侧 0.8019 分(3.6 次) 顾问侧 0.2468 分(1.00 次)  顾问平均输入 520 输出 74 token
```

放成一张表,加上通过率:

| 配置 | 通过 | 错误退款申请 | 每张(分) | 其中执行 | 其中顾问 |
| --- | --- | --- | --- | --- | --- |
| 14B 单干 `small` | 13/52 | 36 | 0.7074 | 0.7074 | 0 |
| `deepseek-flash` 单干 | 51/52 | 2 | 0.3776 | 0.3776 | 0 |
| 14B + pro 顾问 `adv` | 50/52 | 1 | 0.9819 | 0.7276 | 0.2544 |
| 14B + pro 顾问并催促 `advn` | 50/52 | 2 | 1.0488 | 0.8019 | 0.2468 |
| `deepseek-v4-pro` 单干 | 51/52 | 1 | 1.1825 | 1.1825 | 0 |

<figure>
<svg viewBox="0 0 640 230" role="img" aria-label="每张工单平均花费的横向条形图:flash 单干 0.38 分,14B 单干 0.71 分,14B 加顾问 0.98 分(其中顾问 0.25 分),pro 单干 1.18 分">
<text x="20" y="22" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">每张工单平均花费(分,峰时价)</text>
<text x="20" y="64" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">flash 单干</text>
<rect x="150" y="48" width="126" height="22" rx="3" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="284" y="64" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">0.38 · 51/52</text>
<text x="20" y="104" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">14B 单干</text>
<rect x="150" y="88" width="236" height="22" rx="3" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="394" y="104" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">0.71 · 13/52</text>
<text x="20" y="144" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">14B + 顾问</text>
<rect x="150" y="128" width="242" height="22" rx="3" fill="var(--paper-raised)" stroke="var(--rule)"/>
<rect x="392" y="128" width="85" height="22" rx="3" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="485" y="144" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">0.98 · 50/52</text>
<text x="20" y="184" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">pro 单干</text>
<rect x="150" y="168" width="394" height="22" rx="3" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="552" y="184" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">1.18 · 51/52</text>
<text x="20" y="216" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">蓝色是 deepseek-v4-pro 的钱;14B 的价格是我假设的(按 flash 未命中价算)</text>
</svg>
<figcaption>五个配置里,带顾问的比 pro 单干便宜 17%,通过率相当,但 flash 单干又便宜得多、通过率也一样。每条后面的数字是每张花费和通过数。</figcaption>
</figure>

这张表要慢慢读。

**和 pro 单干比,Advisor 省了钱,没丢质量。** 0.98 对 1.18,省 17%,通过 50/52 对 51/52,在 52 张的样本上这一张的差距是噪声。省下的钱来自「大部分 token 是便宜模型生成的」。

**但 Advisor 在这个任务上不是最优解。** `deepseek-flash` 单干就有 51/52,每张 0.3776 分,比 Advisor 的 0.98 分还便宜,而且更简单,少一个提示词要调、少一种出错的方式、少一次往返。我今天最想让你带走的是这一条:**上 Advisor 之前先量便宜模型单干的通过率。** 14B 单干只有 25%,这时候你才会想「要不要加个顾问」;可是如果你换一个本来就能行的便宜模型,问题根本不存在。Advisor 是在「便宜模型单干不行、强模型单干太贵」这条窄缝里才有位置。我们的缝里站了第三个选手 flash,它把缝堵上了。

还有两处要诚实说。一是 14B 的价格是我按 flash 的未命中价假设的,没有查到它的真价;就算它真便宜到免费,执行侧归零,`adv` 也还剩顾问侧 0.2544 分,约等于 flash 单干(0.3776 分)的 67%,而 flash 单干的通过率还高。二是顾问侧的钱稳定在每次 0.2765 分(0.2544 ÷ 0.92 次),它的输入大约 517 个 token,输出约 75 个,在这个任务里已经是很短的回答了。

**什么时候该省的钱会真的省出来?** 看每一轮的单价。强模型单干每轮 1.1825 ÷ 2.8 轮 = 0.4223 分;带顾问时执行模型每轮 0.7276 ÷ 3.2 = 0.2274 分,顾问每次 0.2765 分。强模型单干的钱随轮数线性增长,Advisor 是「每轮便宜一点,再加一次固定的顾问费」,所以轮数越多越划算。写个脚本算一下:

```python
# agent-zero-lab/part07/advisor_break_even.py
# 从 advisor_split 的输出抄来的单价(分/次),用 14B 当执行模型的那一组
PRO_TURN = 1.1825 / 2.8      # 强模型单干:每张 1.1825 分、2.8 轮
EXEC_TURN = 0.7276 / 3.2     # 执行模型:每张 0.7276 分、3.2 轮
ADVISOR_CALL = 0.2544 / 0.92  # 顾问:每张 0.2544 分、0.92 次


def pro_alone(n: int) -> float:
    return n * PRO_TURN


def with_advisor(n: int, calls: int = 1) -> float:
    return n * EXEC_TURN + calls * ADVISOR_CALL


if __name__ == "__main__":
    print(f"每轮:强模型 {PRO_TURN:.4f}  执行模型 {EXEC_TURN:.4f}  顾问每次 {ADVISOR_CALL:.4f}")
    print(f"持平点:{ADVISOR_CALL / (PRO_TURN - EXEC_TURN):.2f} 轮")
    for n in (2, 3, 5, 10, 20):
        a, b = pro_alone(n), with_advisor(n)
        print(f"{n:>2} 轮  强模型单干 {a:.3f}  顾问模式 {b:.3f}  省 {(1 - b / a) * 100:.0f}%")
```

<div class="line-notes">

- `PRO_TURN = 1.1825 / 2.8` 强模型单干:每张 1.1825 分、平均 2.8 轮,除一下是每轮 0.4223 分。这三个数是 `advisor_split` 输出里抄的,不是魔法数字。
- `EXEC_TURN = 0.7276 / 3.2` 执行模型每轮的钱。
- `ADVISOR_CALL = 0.2544 / 0.92` 顾问每次的钱,这里除的是 0.92 次,不是 1。
- `def pro_alone(n: int) -> float:` n 轮的强模型单干。
- `return n * PRO_TURN` 每轮单价乘轮数。
- `def with_advisor(n: int, calls: int = 1) -> float:` n 轮带顾问,问 `calls` 次。
- `return n * EXEC_TURN + calls * ADVISOR_CALL` 执行侧随轮数增长,顾问侧是固定的几次。
- `print(f"持平点:{ADVISOR_CALL / (PRO_TURN - EXEC_TURN):.2f} 轮")` 令 n × 0.4223 = n × 0.2274 + 0.2765,解出 n = 0.2765 ÷ (0.4223 − 0.2274) = 1.42。不到 2 轮就持平了。
- `for n in (2, 3, 5, 10, 20):` 几个典型轮数各打一行。
- `print(f"{n:>2} 轮  强模型单干 {a:.3f}  顾问模式 {b:.3f}  省 {(1 - b / a) * 100:.0f}%")` `{n:>2}` 右对齐占两格。`(1 - b / a) * 100` 是节省的百分比。

</div>

```bash
uv run python -m part07.advisor_break_even
```

```text
每轮:强模型 0.4223  执行模型 0.2274  顾问每次 0.2765
持平点:1.42 轮
 2 轮  强模型单干 0.845  顾问模式 0.731  省 13%
 3 轮  强模型单干 1.267  顾问模式 0.959  省 24%
 5 轮  强模型单干 2.112  顾问模式 1.413  省 33%
10 轮  强模型单干 4.223  顾问模式 2.550  省 40%
20 轮  强模型单干 8.446  顾问模式 4.824  省 43%
```

这张表是用两个单价外推出来的,不是实测:真实的长任务里顾问要读的对话越来越长,每次顾问的钱也会涨,所以 10 轮、20 轮那两行是乐观的。可趋势是对的:任务越长,Advisor 相对强模型单干省得越多,上限大约是「执行模型每轮单价 ÷ 强模型每轮单价」,在这里就是 54% 的单价,也就是最多省 46% 左右。这和官方博客里 Sonnet 加 Opus 在长的编码任务上省 11.9% 并不矛盾:那里 Sonnet 本来就不便宜,价差没有我们这里的 4 倍大。

## 第四步:用 Pydantic AI 的 Advisor 复现

自己手写能看清每一步,生产里更常见的做法是用现成的。Pydantic AI 的 harness 包里有一个 `Advisor` 能力(capability),它做的就是今天这件事:执行模型和顾问都是 Anthropic 模型(或都走 OpenRouter)时,用上一节的服务端原生工具;其他组合就退回一个本地函数工具 `advisor`,背后单独跑一个用顾问模型的 Agent。我们是 Qwen 加 DeepSeek,走的是本地回退路径。先装依赖(zsh 里方括号要加引号):

```bash
uv add "pydantic-ai-slim[openai]" pydantic-ai-harness
```

2026 年 10 月 27 日装上的是 pydantic-ai-slim 2.61.0 和 pydantic-ai-harness 0.61.0。harness 包还在 0.x,官方说小版本之间 API 可能变。代码是这样的:

```python
# agent-zero-lab/part07/advisor_pai.py
import asyncio
import json
import os
import sys

from dotenv import load_dotenv
from pydantic_ai import Agent
from pydantic_ai.models.openai import OpenAIChatModel
from pydantic_ai.providers.openai import OpenAIProvider
from pydantic_ai_harness import Advisor

from part07.grade import conclusion, is_correct
from part07.refund_cases import CASES, RULES
from part07.refund_tools import customer_id, run_tool

load_dotenv()
deepseek = OpenAIProvider(base_url=os.environ["LLM_BASE_URL"], api_key=os.environ["LLM_API_KEY"])
silicon = OpenAIProvider(base_url=os.environ["EMB_BASE_URL"], api_key=os.environ["EMB_API_KEY"])
EXECUTOR = OpenAIChatModel("Qwen/Qwen3-14B", provider=silicon, settings={"extra_body": {"enable_thinking": False}})
ADVISOR = OpenAIChatModel(
    "deepseek-v4-pro", provider=deepseek, settings={"extra_body": json.loads(os.environ["LLM_EXTRA_BODY"])}
)
INSTRUCTIONS = (
    "工具里查到的数据就是事实。要退款时先调 create_refund_request 再写结论。"
    "\n顺序是:先调 lookup 查数据;拿到结果后,下一步调用一次 advisor;最后照顾问的判断办。"
)


def build_agent(i: int, created: list[float]) -> Agent:
    def lookup(customer_id: str) -> str:
        """按客户号查订阅(套餐、周期、实付、代金券、购买日、是否退过款)和发票"""
        sub = json.loads(run_tool("get_subscription", {"customer_id": customer_id}, i, created))
        invoices = json.loads(run_tool("list_invoices", {"customer_id": customer_id}, i, created))
        return json.dumps({"subscription": sub, "invoices": invoices}, ensure_ascii=False)

    def create_refund_request(customer_id: str, amount: float) -> str:
        """提交退款申请(进主管审批)。只有结论是「退款 X 元」时才能调"""
        return run_tool("create_refund_request", {"customer_id": customer_id, "amount": amount}, i, created)

    return Agent(
        EXECUTOR,
        instructions=INSTRUCTIONS,
        tools=[lookup, create_refund_request],
        capabilities=[Advisor(ADVISOR, max_uses=1, max_tokens=1024, forward_history=True)],
    )


async def one(i: int) -> dict:
    created: list[float] = []
    agent = build_agent(i, created)
    # 规则放在用户消息里:顾问只看得到消息历史,看不到执行模型的 instructions
    result = await agent.run(RULES + f"\n\n客户 {customer_id(i)} 来问退款,申请日 {CASES[i][5]}。")
    u = result.usage
    return {"i": i, "ok": is_correct(i, result.output), "concl": conclusion(result.output),
            "requests": u.requests, "in": u.input_tokens, "out": u.output_tokens}


async def main(ids: list[int]) -> None:
    for i in ids:
        print(await one(i))


if __name__ == "__main__":
    asyncio.run(main([int(x) for x in sys.argv[1:]] or [0, 7, 11]))
```

<div class="line-notes">

- `from pydantic_ai import Agent` Pydantic AI 的 Agent 类,它自己处理工具调用循环,不用我们写 `for _ in range(MAX_TURNS)`。
- `from pydantic_ai.models.openai import OpenAIChatModel` 走 OpenAI 兼容协议的聊天模型。
- `from pydantic_ai.providers.openai import OpenAIProvider` 提供 `base_url` 和 `api_key`。
- `from pydantic_ai_harness import Advisor` 顾问能力在单独的 harness 包里,不在 `pydantic_ai` 本体。
- `from part07.refund_tools import customer_id, run_tool` 复用上面的假工具实现,只是包一层。
- `deepseek = OpenAIProvider(` DeepSeek 官方,给顾问用。
- `silicon = OpenAIProvider(` 硅基流动,给执行模型用。
- `EXECUTOR = OpenAIChatModel("Qwen/Qwen3-14B", provider=silicon,` 执行模型,`extra_body` 里关掉思考。
- `ADVISOR = OpenAIChatModel(` 顾问模型。
- `INSTRUCTIONS = (` 执行模型的 `instructions`。这里**不放规则**,原因在下面。
- `"\n顺序是:先调 lookup 查数据;拿到结果后,下一步调用一次 advisor;最后照顾问的判断办。"` 和手写版的 `TIMING` 同一个意思。
- `def build_agent(i: int, created: list[float]) -> Agent:` 每张工单造一个 Agent,因为工具要绑定「这是第几张工单」。
- `def lookup(customer_id: str) -> str:` 把两个查询合成一个工具,理由在下面。Pydantic AI 直接读函数的类型标注和文档字符串生成 JSON Schema,不用手写那一大段 `TOOLS`。
- `"""按客户号查订阅(套餐、周期、实付、代金券、购买日、是否退过款)和发票"""` 这行三引号字符串就是工具的描述,模型靠它决定怎么用。
- `sub = json.loads(run_tool("get_subscription",` 内部复用原来的实现。
- `def create_refund_request(customer_id: str, amount: float) -> str:` 提交退款申请。
- `capabilities=[Advisor(ADVISOR, max_uses=1, max_tokens=1024, forward_history=True)],` 挂上顾问。`max_uses=1` 每次请求最多问一次;`max_tokens=1024` 是它允许的最小值;`forward_history=True` 让顾问看到执行模型之前的对话历史(默认只看执行模型写的那段咨询词)。
- `# 规则放在用户消息里:顾问只看得到消息历史,看不到执行模型的 instructions` 今天最贵的一个教训,原因在下面三版对比里讲。
- `result = await agent.run(RULES + f"\n\n客户 {customer_id(i)} 来问退款,申请日 {CASES[i][5]}。")` 规则拼在**用户消息**开头,而不是放进 `instructions`。
- `u = result.usage` 在 2.61 版里 `usage` 是属性,不是方法(我一开始写成 `result.usage()`,报 `'RunUsage' object is not callable`)。
- `"requests": u.requests, "in": u.input_tokens, "out": u.output_tokens}` 一次运行一共发了几个模型请求、总输入输出 token。本地回退路径下顾问的请求也算在里面。
- `asyncio.run(main([int(x) for x in sys.argv[1:]] or [0, 7, 11]))` 命令行传工单序号,不传就跑 0、7、11 三张。

</div>

这份代码是第三版。前两版都栽在同一个原因上,我把三版的结果放一起:

| 版本 | 做法 | 通过(26 张) |
| --- | --- | --- |
| v1 | 两个独立工具(查订阅、查发票),规则放在 `instructions` 里,提示词要求「查完数据后单独一步调顾问」 | 13/26 |
| v2 | 把两个查询合成一个 `lookup` 工具,让它一步拿全数据 | 14/26 |
| v3 | 规则挪进用户消息 | 25/26 |

v1 的问题我是打印消息才看清的:执行模型把 `get_subscription`、`list_invoices`、`advisor` 三个调用**放在同一步里一起发**,Pydantic AI 就把它们一起处理,顾问被调用的时候前两个工具的结果还没回来。顾问只收到一句执行模型自己写的咨询词,里面没有数据,它的回答是「请提供订阅类型、购买日期、实际支付金额……」。执行模型拿着这句反问,最后凭自己的理解下了结论,还是错的。我试过在提示词里写「不能和别的工具放在同一步」、加 `parallel_tool_calls: False`,14B 都不听。官方文档对这点写得很明白:本地路径上「当前这一步的回复,包括没有结果的工具调用,不会转发给顾问」。我们手写的版本能行,是因为我们的循环按顺序处理,碰巧让数据先进了历史。

v2 把两个查询合成一个 `lookup`,顾问确实看到了数据,可还是 14/26,这次的原因换了:顾问的回答里写着「根据退款规则」,却没有规则可依,算出来的金额是凭印象猜的(第 7 张它给了 4430,标准答案是 3920)。规则在执行模型的 `instructions` 里,而本地回退路径下顾问看到的是消息历史和执行模型写的咨询词,`instructions` 不在其中(官方页面只明确说转发历史会带上 `system_prompt` 部分,没有写 `instructions`,我是靠实验确认的)。v3 把规则挪进用户消息,顾问就看得到了,通过 25/26。

```bash
uv run python -m part07.advisor_pai 0 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20 21 22 23 24 25
```

```text
{'i': 0, 'ok': True, 'concl': 4950.0, 'requests': 4, 'in': 3494, 'out': 269}
{'i': 1, 'ok': True, 'concl': 5880.0, 'requests': 4, 'in': 3576, 'out': 343}
{'i': 2, 'ok': True, 'concl': 5390.0, 'requests': 4, 'in': 4226, 'out': 659}
...(中间略)
```

26 张里错了第 13 张,平均每张 4 个请求(执行 3 个加顾问 1 个),输入约 3700 个 token、输出约 350 个。这条路径我没有单独拆顾问的花费,`result.usage` 把执行和顾问加在一起报,想拆开得自己读每个模型请求。

小结一下手写版和库版:

| | 手写(今天第二步) | Pydantic AI `Advisor` |
| --- | --- | --- |
| 顾问看到什么 | 我们渲染的整段对话文字,加上 `RULES` 系统提示词 | 默认只有执行模型写的咨询词;`forward_history=True` 加上已完成的历史,不含当前这一步 |
| 工具循环 | 自己写 | 库里自带 |
| 记账 | 每次调用都记 `node`,能拆执行和顾问 | 只给总量 |
| 好处 | 每一行都看得见,规则和顺序自己定 | 几行配置,Anthropic 同厂商时自动切原生工具 |

我的建议:先用库,如果顾问的输入输出不符合预期(像今天这样),再回到手写,把「顾问到底看到什么」控制住。库在你的模型组合上做了什么,最好打印一次消息确认。

## 什么时候用 Advisor,什么时候用路由、级联

三种分工各有各的位置,今天和昨天的数据放在一起:

| | 静态路由 | 级联 | Advisor |
| --- | --- | --- | --- |
| 谁决定强模型出场 | 节点名,调用前定好 | 你写的检查器,调用后判断 | 执行模型自己(或你催它) |
| 强模型做什么 | 整个节点的活 | 升级的那条整件重做 | 读已有的对话,出一小段意见 |
| 最适合 | 节点难度差别大且固定 | 有便宜可靠的检查器、便宜模型大部分能过 | 长链路、难点集中在一两个判断上 |
| 要小心 | 倍数不等于价格表上的倍数 | 升级比例高了比强模型单干还贵 | 执行模型该问不问、问的时机错、顾问看不到该看的 |
| 今天的实测 | | | 对强模型单干省 17%,链路越长省得越多 |

选择的顺序我会这样排:先量便宜模型单干的通过率,够用就别加任何东西(今天的 flash);不够用且难度按节点分,用静态路由;不够用且你能写出便宜可靠的检查器,用级联;不够用、检查器写不出来(比如「结论对不对」只有强模型才判得准)、而且链路比较长,才轮到 Advisor。它要付的额外成本是调试时间:提示词里的时机、顾问能看到什么、漏问和早问,这些都得自己测,今天的两个坑(早问、看不到规则)各花了我大半个小时。

## 零件和今天的文件对照

| 零件 | 文件 | 回答什么问题 |
| --- | --- | --- |
| 官方示例算账 | `advisor_bill.py` | 顶层 usage 为什么不够,顾问那一行值多少钱 |
| 规则、标准答案 | `refund_cases.py`、`grade.py` | 这张工单该退多少,模型答对没有 |
| 假工具 | `refund_tools.py` | 订阅、发票、退款申请,顾问工具的定义 |
| 循环和记账 | `refund_agent.py` | 单干和带顾问共用的一套循环 |
| 入口 | `refund_run.py` | 五种配置一条命令跑 |
| 拆账 | `advisor_split.py`、`advisor_break_even.py` | 执行侧和顾问侧各花多少,轮数多长才划算 |
| 库版 | `advisor_pai.py` | Pydantic AI 的 Advisor 复现 |

## 动手练习

### 练习 1:换成 Haiku 4.5 当执行模型

官方示例里执行模型是 Sonnet 5。把 `advisor_bill.py` 里的示例响应换成 Haiku 4.5 执行(价格:输入 1 美元、缓存命中 0.10 美元、输出 5 美元,2026 年 10 月 27 日定价页),顾问还是 Opus 5.5。算合计,并和「全程 Opus 5.5」比。不要改 `advisor_bill.py`,另写一个文件 `advisor_bill_haiku.py` 去 import 它。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part07/advisor_bill_haiku.py
from part07 import advisor_bill as ab

ab.PRICES["claude-haiku-4-5"] = (1.0, 0.10, 5.0)  # 2026-10-27 定价页:Haiku 4.5 输入 $1,缓存命中 $0.10,输出 $5

ex, ad = ab.bill(ab.USAGE, "claude-haiku-4-5")
alone = ab.cost("claude-opus-5-5", ab.USAGE["input_tokens"], ab.USAGE["cache_read_input_tokens"], ab.USAGE["output_tokens"])
print(f"执行 Haiku 4.5: ${ex:.6f}  顾问 Opus 5.5: ${ad:.6f}  合计 ${ex + ad:.6f}")
print(f"全程 Opus 5.5:  ${alone:.6f}(不含思考 token)")
print(f"合计是全程 Opus 的 {(ex + ad) / alone:.2f} 倍")
```

<div class="line-notes">

- `from part07 import advisor_bill as ab` 把整个模块导进来起个别名,相当于 JS 的 `import * as ab from "./advisor_bill"`。`advisor_bill.py` 有 `if __name__ == "__main__":` 保护,导入它不会把那几行 print 也跑一遍。
- `ab.PRICES["claude-haiku-4-5"] = (1.0, 0.10, 5.0)` 往别的模块的字典里加一项。这是在运行时改了 `ab.PRICES`,只对本进程有效,不会改文件。
- `ex, ad = ab.bill(ab.USAGE, "claude-haiku-4-5")` 把执行模型换成 Haiku:`bill` 里 `type` 是 `message` 的迭代都按这个名字查价格。顾问那一行有自己的 `model` 字段,还是 Opus 5.5。
- `alone = ab.cost("claude-opus-5-5", ab.USAGE["input_tokens"],` 全程 Opus 的对照,和前面一样用执行模型的 token 数。
- `print(f"合计是全程 Opus 的 {(ex + ad) / alone:.2f} 倍")` 把比值也打出来。

</div>

```bash
uv run python -m part07.advisor_bill_haiku
```

```text
执行 Haiku 4.5: $0.004456  顾问 Opus 5.5: $0.035532  合计 $0.039988
全程 Opus 5.5:  $0.017742(不含思考 token)
合计是全程 Opus 的 2.25 倍
```

执行侧从 0.0089 降到 0.0045,可顾问那 0.0355 美元一分不少,所以合计只从 0.0444 降到 0.0400。在这个只有三次迭代的示例里,Advisor 占了总花费的 89%,和我们手写实验里「顾问侧占 26%」差别很大。原因是官方示例里顾问带着 1612 个输出 token(包含思考),而我们的顾问只回 75 个。顾问输出的长度是 Advisor 成本里最大的变量,这也是官方推荐给 `max_tokens` 设 2048 并在用户消息里要求简短的原因。

</details>

### 练习 2:问三次顾问,持平点在哪

`advisor_break_even.py` 的持平点是按每个任务问 1 次算的。官方建议长任务至少问两次(开工前一次、收工前一次)。写 `break_even_calls.py`,算问 1、2、3、5 次时的持平轮数,并打印 10 轮时顾问模式和强模型单干各多少钱。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part07/break_even_calls.py
from part07.advisor_break_even import ADVISOR_CALL, EXEC_TURN, PRO_TURN, with_advisor

for calls in (1, 2, 3, 5):
    n = calls * ADVISOR_CALL / (PRO_TURN - EXEC_TURN)
    print(f"问 {calls} 次顾问:持平点 {n:.2f} 轮;10 轮时顾问模式 {with_advisor(10, calls):.3f},强模型单干 {10 * PRO_TURN:.3f}")
```

<div class="line-notes">

- `from part07.advisor_break_even import ADVISOR_CALL, EXEC_TURN, PRO_TURN, with_advisor` 把上一个脚本的三个单价和函数拿过来用。
- `for calls in (1, 2, 3, 5):` 四种问法各算一遍。
- `n = calls * ADVISOR_CALL / (PRO_TURN - EXEC_TURN)` 持平点公式:n × 强模型每轮 = n × 执行模型每轮 + calls × 顾问每次,解出 n。问 3 次就是 3 × 0.2765 ÷ 0.1949 = 4.26。
- `print(f"问 {calls} 次顾问:持平点 {n:.2f} 轮;10 轮时顾问模式 {with_advisor(10, calls):.3f},强模型单干 {10 * PRO_TURN:.3f}")` 一行里同时给出持平点和 10 轮的两个数。

</div>

```text
问 1 次顾问:持平点 1.42 轮;10 轮时顾问模式 2.550,强模型单干 4.223
问 2 次顾问:持平点 2.84 轮;10 轮时顾问模式 2.827,强模型单干 4.223
问 3 次顾问:持平点 4.26 轮;10 轮时顾问模式 3.103,强模型单干 4.223
问 5 次顾问:持平点 7.09 轮;10 轮时顾问模式 3.656,强模型单干 4.223
```

问得越多,持平点越往后移,10 轮的任务问 5 次已经只省 13%。官方说顾问侧缓存大约问 3 次以上才回本,开缓存会把顾问每次的价格压下去,这里没算。结论是:一个任务问几次,要和「这个任务有几轮」一起设计,不能只写「每个任务都问两次」。

</details>

### 练习 3:让顾问永远排在同一步的最后

手写版里顾问能看到数据,靠的是模型碰巧把 `advisor` 排在查询工具后面。写一个函数 `advisor_last(tool_calls)`,把同一步里的调用重新排序,`advisor` 永远最后,别的调用保持原来的相对顺序。用假对象测一下,不用调 API。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part07/order_calls.py
from types import SimpleNamespace


def advisor_last(tool_calls: list) -> list:
    """同一步里的工具调用:advisor 排到最后,让别的工具结果先进历史。"""
    return sorted(tool_calls, key=lambda tc: tc.function.name == "advisor")


def fake_call(name: str) -> SimpleNamespace:
    return SimpleNamespace(function=SimpleNamespace(name=name))


if __name__ == "__main__":
    step = [fake_call("advisor"), fake_call("get_subscription"), fake_call("list_invoices")]
    print("原顺序:", [tc.function.name for tc in step])
    print("改后:  ", [tc.function.name for tc in advisor_last(step)])
    only = [fake_call("get_subscription"), fake_call("list_invoices")]
    print("没有 advisor:", [tc.function.name for tc in advisor_last(only)])
```

<div class="line-notes">

- `from types import SimpleNamespace` 标准库里一个「随手造对象」的类,`SimpleNamespace(a=1).a` 就是 1。这里拿它冒充 openai 返回的 `tool_call` 对象,不用真的调 API。相当于 JS 里直接写一个对象字面量 `{ function: { name } }`。
- `def advisor_last(tool_calls: list) -> list:` 输入一步里的所有调用,输出重排后的列表。
- `return sorted(tool_calls, key=lambda tc: tc.function.name == "advisor")` `sorted` 按 `key` 的结果排序,`key` 返回布尔值:不是 advisor 的是 `False`(等于 0),是 advisor 的是 `True`(等于 1),所以 advisor 排最后。`sorted` 是稳定排序,值相同的元素保持原来的先后,所以别的调用相对顺序不变。`lambda` 相当于 JS 的箭头函数。
- `def fake_call(name: str) -> SimpleNamespace:` 造一个假调用。
- `return SimpleNamespace(function=SimpleNamespace(name=name))` 两层嵌套,和真实对象的 `tc.function.name` 访问路径一致。
- `step = [fake_call("advisor"), fake_call("get_subscription"), fake_call("list_invoices")]` 最坏情形:模型把 advisor 排在最前面。
- `print("没有 advisor:", [tc.function.name for tc in advisor_last(only)])` 没有 advisor 时顺序完全不变。

</div>

```bash
uv run python -m part07.order_calls
```

```text
原顺序: ['advisor', 'get_subscription', 'list_invoices']
改后:   ['get_subscription', 'list_invoices', 'advisor']
没有 advisor: ['get_subscription', 'list_invoices']
```

接进 `refund_agent.py` 只要改循环那一行:`for tc in advisor_last(msg.tool_calls):`。这样即使模型把 advisor 写在前面,顾问也看得到同一步里别的工具的结果。这个改动我没有重跑那 52 张工单,所以不知道它能把 `adv` 的通过数再提高多少。

</details>

### 练习 4:flash 单干 51/52,还有理由上 Advisor 吗

今天的数据里 `deepseek-flash` 单干通过率和 Advisor 一样高,花费只有三分之一。设想三种情况,说说结论会不会变:(a) 提交错误金额的退款单,一次平均损失 500 元;(b) 月工单量 100 万张;(c) 把规则换成 50 页的合同,flash 通过率降到 70%。这是开放题,没有实跑。

<details><summary>参考答案</summary>

(a) 看「错误退款申请」那一列:flash 52 张里有 2 次,pro 1 次,adv 1 次。差 1 次在 52 张里是噪声,可要是真实差 1%,每张损失 500 元,每张就多 5 元,比任何模型费用都大(一张工单模型费用才几分钱)。这时候该关心的是**错误率**而不是模型价格,Advisor 能不能把错误率压下去、还是只是便宜,得靠更大的测试集量,不能靠 52 张下结论。

(b) 月 100 万张:flash 比 adv 每张便宜 0.6 分,100 万张差 6,000 元。这个数不大,不足以支撑多维护一套顾问逻辑。反过来如果每张的差价更大(换成每张 10 分的长任务),上 Advisor 才有量级。

(c) flash 掉到 70%,就回到了「便宜模型单干不行」的缝里:这时候要在 pro 单干、Advisor、级联之间重新量。Advisor 的前提是链路够长、难点集中;50 页合同如果难点是「某几条款的理解」,正好适合;如果每一步都要读全文,每一步都需要强模型,就不适合。

三问共同的答案:**Advisor 的决策顺序是先量单干通过率,再量错误的代价,最后才算 token 的钱。**

</details>

**验收标准**:能说出官方 advisor tool 的请求里哪几个字段决定了顾问是谁、问几次、回多长,以及账单要看 `usage` 的哪个地方;能跑通 `refund_run.py` 的五种配置(至少跑 `small` 和 `adv` 各 1 遍),读懂 `advisor_split` 的输出;能解释 `adv` 比 pro 单干便宜、却不比 flash 单干便宜的原因;能说出 Pydantic AI 本地回退路径上顾问「看不到什么」。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| Advisor(顾问模式) | 便宜模型从头干到尾,拿不准时问一次强模型,拿回一小段建议接着干。强模型只为那一小段付费 |
| 执行模型(executor) | 干活的那个模型,调工具、读结果、写最终回复 |
| 顾问模型(advisor) | 被问的强模型,读完整段对话,回几百个 token 的意见,不调工具 |
| 服务端工具(server tool) | 由 API 服务器替你执行的工具,比如 Anthropic 的 advisor tool。你不写执行函数,在响应里能看到调用和结果块 |
| `usage.iterations` | Anthropic 响应里按迭代拆开的用量列表,顾问的 token 只在这里,按顾问模型的价格计费 |
| nudge(催一下) | 执行模型想不问顾问就收工时,追加一条消息提醒它,官方对 Haiku 有约 7 个百分点的提升 |
| 本地回退路径 | Pydantic AI 的 `Advisor` 在非 Anthropic 组合上的做法:本地加一个 `advisor` 函数工具,背后另跑一个 Agent |
| `forward_history` | 本地回退路径的开关,打开后顾问能看到执行模型已完成的历史,不含当前这一步 |
| 持平点 | Advisor 和强模型单干花费相等的任务轮数,轮数更长才开始省 |
| 错误退款申请 | 今天定的危险动作指标:模型提交了金额不对的退款单(或本不该退却提交了) |

## 常见误区

**只看顶层 `usage` 算账。** 官方 advisor tool 的顶层 `usage` 只有执行模型,顾问的 token 在 `iterations` 里。官方示例里顾问那一行是执行侧的 4 倍,漏掉它,账单少算八成。

**在查任何数据之前就问顾问。** 提示词写「给结论前必须问顾问」,小模型会理解成「先问」,我实测 26 张里有 11 张在第一步就问了,顾问看到的只有一句话。提示词要写明「先查数据,再问」,并告诉它为什么。

**以为顾问会自动看到执行模型的系统提示词。** 本地回退路径上不会。规则只放在 `instructions` 里时,顾问凭印象算出了 4430(标准答案 3920),通过率 14/26。规则放进用户消息才是 25/26。

**同一步里把顾问和查询工具一起发。** 顾问被调用时,同一步里还没回来的工具结果它看不到。Pydantic AI 里小模型不听「单独一步」的要求,`parallel_tool_calls: False` 也没用。自己写循环时用 `advisor_last` 排序。

**评分脚本比模型严。** 我最开始的正则要求「元」字,Qwen3-14B 写「结论:退款 5880.00」就被判成读不出来,多算了一批错。判分先看几条原始回答。

**上 Advisor 之前不量单干。** `deepseek-flash` 单干 51/52、每张 0.38 分,比任何带顾问的配置都便宜。先量便宜模型单干的通过率,够用就停。

**用 52 张的样本下结论。** 一张工单是 1.9 个百分点,`adv` 和 `pro` 的 50 对 51 只是噪声。正式决定要用第六部分那样的测试集。

**没设请求超时。** 默认 10 分钟。我第一次跑整批 15 分钟没动静,才发现有请求卡住。给 `AsyncOpenAI` 设 `timeout=90`。

## 学习资料

### 文档与文章

- [Anthropic · Advisor tool 文档](https://platform.claude.com/docs/en/agents-and-tools/tool-use/advisor-tool):今天第一节的主要来源,请求字段、响应块、`usage.iterations`、模型搭配表、时机提示词和 `max_tokens` 的实测表都在里面。英文,25 分钟。
- [Anthropic · The advisor strategy: Give agents an intelligence boost](https://claude.com/blog/the-advisor-strategy):2026 年 4 月 9 日的发布博客,有 SWE-bench Multilingual 和 BrowseComp 上的对比数字。英文,8 分钟。
- [Pydantic AI Harness · Advisor](https://pydantic.dev/docs/ai/harness/advisor/):`Advisor` 的参数、原生路径和本地回退路径的区别,`forward_history` 的说明。英文,10 分钟。
- [DeepSeek API 文档 · 模型与价格](https://api-docs.deepseek.com/quick_start/pricing):flash 和 pro 的价格,`pricing.py` 的出处。
- [agentpatterns.ai · The Advisor Strategy](https://agentpatterns.ai/patterns/agent-design/advisor-strategy/):社区整理的模式总结,把官方的时机建议和成本控制点列成条目。非官方,英文,5 分钟。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1MxQGB1EmX&autoplay=0&high_quality=1" title="Claude 的新 Advisor 模式:更好结果、更低成本(Opus + Sonnet/Haiku)" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>NixAI · Claude 的新 Advisor 模式:更好结果、更低成本(Opus + Sonnet/Haiku) · 约 3 分钟,2026 年。短视频讲清执行模型和顾问的分工,看完回头读第一节的字段。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/cBO410LhC_I" title="Anthropic's Advisor Strategy: Opus Intelligence at Sonnet Cost" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Hyperautomation Labs · Anthropic's Advisor Strategy: Opus Intelligence at Sonnet Cost · 英文。把官方博客的结构和数字讲一遍,标题里「成本和 Sonnet 一样」是博客里特定任务上的结果,换到你的任务上要自己量。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/dqov51iOQyk" title="The Best Claude Code Trick (Sonnet Builds, Opus Advises)" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Rota Pad · The Best Claude Code Trick (Sonnet Builds, Opus Advises) · 英文。在 Claude Code 里「Sonnet 干活、Opus 出主意」的实际用法,是同一个想法在编码场景的版本。</figcaption>
</figure>

### 书籍

- 《AI Engineering: Building Applications with Foundation Models》,Chip Huyen,O'Reilly,2025。讲路由、网关和成本控制的部分可以和今天的三种分工对着看。英文原版,我没查到正式出版的中译本。

### 开源项目与代码

- [pydantic/pydantic-ai-harness](https://github.com/pydantic/pydantic-ai-harness):`Advisor` 的代码,想知道本地回退路径具体把什么交给顾问,读它的实现最直接。
- [anthropics/anthropic-sdk-python](https://github.com/anthropics/anthropic-sdk-python):官方 Python SDK,`client.beta.messages` 的类型定义里能看到 `advisor_20260301` 相关的块类型。
- [FrugalGPT 论文](https://arxiv.org/abs/2305.05176):上一课级联的出处,和 Advisor 对照着读「谁决定要不要升级」这个差别。

## 自测

1. 官方 advisor tool 的响应里,顶层 `usage.output_tokens` 里包含顾问的输出吗?账单该怎么算?

<details><summary>答案</summary>

不包含。顶层 `usage` 只统计执行模型,顾问的 token 在 `usage.iterations` 里 `type` 为 `advisor_message` 的条目里,按那个条目自己的 `model` 的价格计费。算账要遍历 `iterations`,按类型分别乘各自的单价再相加,今天的 `advisor_bill.py` 就是这样做的。

</details>

2. 把提示词写成「给出结论之前必须先调用一次 advisor」,小模型会出什么问题?怎么修?

<details><summary>答案</summary>

它会在查任何数据之前就调顾问(我实测 26 张里有 11 张),顾问只看到一句话,答不出来。修法是把顺序写死并说明原因:「顾问只看得到对话里已有的内容,先查数据,再问顾问,最后照它的判断办」。还可以在代码里加一层保险:没问就收工时催一次(nudge),或把 advisor 调用排到同一步的最后。

</details>

3. 为什么带顾问的 14B 比 pro 单干便宜,却不比 flash 单干便宜?

<details><summary>答案</summary>

带顾问时大部分 token 由便宜模型生成,所以比强模型单干便宜 17%(0.98 对 1.18 分)。但 flash 本身就是便宜模型,单干通过率 51/52 和带顾问的一样,每张只有 0.38 分。Advisor 的位置在「便宜模型单干不行、强模型单干太贵」之间,flash 让这条缝不存在了。

</details>

4. Pydantic AI 的 `Advisor` 在本地回退路径上,顾问看得到执行模型的 `instructions` 吗?

<details><summary>答案</summary>

看不到(今天实验确认的,官方页面只写了转发历史会带 `system_prompt` 部分)。规则只写在 `instructions` 里时,顾问凭印象给了错的金额,通过率 14/26;规则挪进用户消息后是 25/26。另外当前这一步里还没返回结果的工具调用也不会转发,所以顾问和查询工具不能放在同一步里调。

</details>

5. (面试题)你们的 Agent 每步都用最强模型,成本太高。你怎么评估要不要上 Advisor 模式?

<details><summary>答案</summary>

参考答法:先量,不急着改。第一步,按节点拆账单,看钱花在哪一类步骤上,以及链路平均有几轮。Advisor 的省钱来自「大部分轮由便宜模型生成」,链路只有一两轮的任务省不出来(官方示例里顾问那一次比执行模型两次迭代加起来还贵 4 倍)。第二步,量便宜模型单干的通过率,如果已经够用,直接换模型就行,不需要 Advisor。第三步,如果便宜模型不行,看错误是不是集中在一两个判断点上:是,Advisor 合适;错在每一步,就走路由或升级模型。第四步,上线前测三件事:顾问到底看到了什么(规则、历史、同一步的工具结果)、执行模型会不会该问不问或问早了、每个任务问几次(问得越多持平点越往后移)。我自己的实验里,小模型加顾问把通过率从 13/52 提到 50/52,比强模型单干便宜 17%,但便宜模型 flash 单干就有 51/52,最后的决定是不用 Advisor。结论要带数据,而且要说清样本量。

</details>

6. 官方建议长任务至少问两次顾问,什么时候问?

<details><summary>答案</summary>

一次在动手之前:先做完摸清情况的工作(找文件、读资料),在写代码、下结论、认定某个解读之前问;一次在宣布完成之前:先把成果存好再问。另外卡住了和想换思路时也问。问几次要和任务轮数一起设计,问得越多持平点越往后。

</details>

## 明天预告

Day 401 · 延迟:时间花在哪。今天 Advisor 多了一次串行的往返:`adv` 每张的顾问调用平均 1.9 秒,而执行模型每一轮才 1.3 秒。成本讲完了,一张工单从点发送到看到回复,时间到底花在哪几段、哪几段能并行、哪几段能先吐出来?明天给每次调用掐表,拆成首 token 延迟和生成时间,再看并行和流式各省哪一段。
