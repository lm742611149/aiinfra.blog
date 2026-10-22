---
title: 'Day 465 · 记忆(二):对话太长时压缩'
description: '给 SupportPilot 加第二种记忆:对话摘要。先用真接口校准一个粗估 token 的函数,再写 maybe_compress,超过预算时把早期轮次压成一段摘要、最近几条保留原文;接进图里成为 prepare_context 节点。用假 LLM 写 8 个测试,用真模型对比压缩前后一轮的花费,还踩了「切点把一问一答拆开」和「忘了 summarized_upto」两个坑。'
pubDate: 2026-10-22
regime: none
tags: ['memory', 'context-engineering', 'langgraph', 'supportpilot', 'agent-zero']
series: 'agent-zero'
day: 465
lang: 'zh'
draft: true
---

## 上一课回顾

昨天([Day 464](/blog/agent-zero/day-464-memory-session/))给 SupportPilot 做了第一种记忆:同一张工单里的多轮对话。状态里多了一个用 `operator.add` 追加的 `turns`,每轮开头把上一轮的临时字段清掉,给模型看的文本是「基本信息 → 对话记录 → 客户最新消息」三段,checkpoint 存进了 Postgres。和吴刚聊三轮,中间重启过进程,第三轮还能接上。

昨天末尾也看到了代价:三轮的花费从 0.0054 涨到 0.02 多。每一轮都把全部历史重新发给模型,而且一轮里不止发一次。今天解决这个问题。

## 今天要解决的问题

学完今天你应该能做到:

1. 说清楚对话为什么会越聊越贵,写一个 `estimate_tokens` 粗估函数,并用真接口返回的 `prompt_tokens` 校准它,误差控制在一成左右。
2. 写出 `maybe_compress`:「摘要 + 还没摘要的对话」超过预算,就把早期部分并进摘要,最近几条保留原文;切点永远落在客户消息上,不把一问一答拆开。
3. 把它接进图里成为 `prepare_context` 节点,用假 LLM 写 8 个测试全部通过,再用真模型对比同一轮压缩前后的输入 token 和花费。
4. 讲清楚压缩会丢什么,亲手看一次「被压掉的细节,Agent 答不上来」。

预计用时 2.5 小时。前置:[Day 107](/blog/agent-zero/day-107-tokens-1/)(token 是什么)、[Day 131](/blog/agent-zero/day-131-conversation-cost/)(对话越聊越贵)、[Day 262](/blog/agent-zero/day-262-context-budget/)–[263](/blog/agent-zero/day-263-compaction/)(上下文预算和压缩)、[Day 464](/blog/agent-zero/day-464-memory-session/)。

学法:先对照文章逐行敲一遍(不复制粘贴)并跑通;第二天合上文章,把 `maybe_compress` 和 `_ticket_text` 里多出来的那两段默写出来;做练习,做不出再展开参考答案,看完关掉自己重写一遍。

## 先量一下:一张工单聊到第 8 轮有多长

Day 131 你在玩具聊天机器人上算过:每一轮都要把前面所有轮重发一遍,所以累计花费是按平方涨的。SupportPilot 更夸张,因为一轮里调模型不止一次:分诊一次、调查可能好几次、起草一次、质检一次,每一次的用户消息里都有 `_ticket_text(state)` 拼出来的那一大段。历史长 1000 个 token,一轮就多花三四千。

光说没感觉,先造一段长对话。下面是吴刚这张银行同步工单来回聊了 8 轮的样子(16 条)。这是我手写的演示数据,不是模型生成的;客服那几条故意照着 Day 464 真实回复的样子,带了「参考文章」那几行链接,因为 finalize 存进 turns 的就是这个版本。数据里藏了几样后面要检查的东西:招商银行尾号 6612、发票号 INV-202601-0001、一个承诺「10 月 24 日前答复」、一个细节「10 月 20 号上午十点」。

新建 `scratch/d465/` 目录,放今天所有的演示脚本:

```python
# supportpilot/scratch/d465/long_history.py
"""吴刚一张工单里来回聊了 8 轮(16 条)的对话记录。手写的演示数据,里面故意放了尾号、发票抬头和一个承诺。"""

from supportpilot.agent.state import Ticket

TICKET: Ticket = {"id": "T000153", "customer_email": "wugang@example.com", "subject": "银行流水又同步失败了",
          "body": "银行流水又同步失败了,提示E3001"}

HISTORY: list[dict] = [
    {"role": "customer", "content": "银行流水又同步失败了,提示E3001"},
    {"role": "agent", "content": "您好,E3001 一般是银行授权超过 90 天过期了。请进入「银行账户」点击「重新授权」,授权成功后点「立即同步」[1][2]。授权有效期为 90 天,到期需重新授权,否则会同步失败并提示 E3001 [1]。\n\n参考文章:\n[1] E3001 银行流水同步失败 https://help.cloudledger.example/help/error/005\n[2] 连接银行账户同步流水 https://help.cloudledger.example/help/technical/003"},
    {"role": "customer", "content": "重新授权了还是不行,是招商银行尾号 6612 那个账户"},
    {"role": "agent", "content": "您好,重新授权后仍失败,请确认网银近期没有修改密码或注销,再点一次「立即同步」。如果还不行,请把报错截图和发生时间发给我们,我们会转给技术同事跟进 [1]。\n\n参考文章:\n[1] E3001 银行流水同步失败 https://help.cloudledger.example/help/error/005"},
    {"role": "customer", "content": "网银上周三改过密码。截图发你了,时间是 10 月 20 号上午十点左右"},
    {"role": "agent", "content": "您好,收到截图。网银改密码后旧的授权会失效,需要先在「银行账户」里删除尾号 6612 的账户,再重新添加并授权 [1]。重新添加后第一次同步会拉取最近 90 天的流水,可能需要几分钟 [2]。\n\n参考文章:\n[1] 连接银行账户同步流水 https://help.cloudledger.example/help/technical/003\n[2] E3001 银行流水同步失败 https://help.cloudledger.example/help/error/005"},
    {"role": "customer", "content": "删了重新加,还是 E3001。我们月底要结账,很急"},
    {"role": "agent", "content": "您好,非常理解您的着急。我已经把尾号 6612 的情况转给技术同事排查,会在 2 个工作日内(10 月 24 日前)通过这个工单答复您。"},
    {"role": "customer", "content": "好。顺便问一下,发票抬头要改成刚正财税(上海)有限公司,能改吗"},
    {"role": "agent", "content": "您好,开票后 30 天内可以在「设置 - 发票」在线申请红冲并重开,抬头填刚正财税(上海)有限公司即可 [1]。超过 30 天的需要人工处理 [1]。\n\n参考文章:\n[1] 发票红冲与重开 https://help.cloudledger.example/help/invoice/004"},
    {"role": "customer", "content": "1 月那张发票是 INV-202601-0001,超过 30 天了吗"},
    {"role": "agent", "content": "您好,INV-202601-0001 开票日期是 1 月 10 日,到今天已超过 30 天,需要人工处理,我已经备注给财务同事。"},
    {"role": "customer", "content": "那银行这个,我能先手动导入流水吗"},
    {"role": "agent", "content": "您好,可以。在「银行账户 - 导入」上传招商银行导出的 Excel 流水,系统会自动去重,不会和之后的自动同步重复 [1]。单个文件不超过 5000 行 [1]。\n\n参考文章:\n[1] 手动导入银行流水 https://help.cloudledger.example/help/technical/006"},
    {"role": "customer", "content": "导入成功了,谢谢。技术那边有消息记得告诉我"},
    {"role": "agent", "content": "您好,好的,技术同事有结论会第一时间在这个工单里通知您。"},
]
```

<div class="line-notes">

- `from supportpilot.agent.state import Ticket` 用 Day 457 定义的 `Ticket` 标类型,后面把它塞进图的输入时,basedpyright 才不会报「dict 不能赋给 SupportState」。
- `TICKET: Ticket = {"id": "T000153"` 和 Day 464 那张工单同号同人。这个号只在内存存档里用,不碰业务库的数据。
- `HISTORY: list[dict] = [` 16 条,一条客户一条客服交替。下标从 0 开始,偶数是客户,奇数是客服,后面算切点时要用到这个规律。
- `招商银行尾号 6612 那个账户"` 下标 2。尾号这种编号最怕在压缩时丢。
- `时间是 10 月 20 号上午十点左右"` 下标 4。一个很细的细节,今天最后会专门问它。
- `会在 2 个工作日内(10 月 24 日前)通过这个工单答复您。"` 下标 7,一个带期限的承诺。压缩后丢了它,第十轮 Agent 可能会给出一个互相矛盾的期限。
- `"1 月那张发票是 INV-202601-0001` 这个账单号是种子数据里吴刚真实存在的账单。我第一版写的是一个瞎编的号,真模型跑的时候 act 节点去库里一查,回复客户「系统中查不到这张发票」,演示数据和业务库对不上,只好改成真的。
- `{"role": "agent", "content": "您好,好的,技术同事有结论会第一时间在这个工单里通知您。"},` 下标 15,第 8 轮的回复。

</div>

再写一个不花钱的脚本,看看第 1 到第 8 轮开始时,`_ticket_text` 拼出来的文本有多长:

```python
# supportpilot/scratch/d465/measure_growth.py
"""不调模型:第 1 到第 8 轮时,_ticket_text 拼出来的文本有多长。"""

from typing import cast

from long_history import HISTORY, TICKET

from supportpilot.agent.nodes import _ticket_text
from supportpilot.agent.state import SupportState

for k in range(1, 9):
    turns = HISTORY[: 2 * k - 1]                     # 第 k 轮开始时:前 k-1 轮问答 + 这一轮的客户消息
    text = _ticket_text(cast(SupportState, {"ticket": TICKET, "turns": turns}))
    print(f"第 {k} 轮  {len(turns):>2} 条  {len(text):>4} 字符")
```

<div class="line-notes">

- `from long_history import HISTORY, TICKET` 运行时 Python 会把脚本所在的目录放进模块搜索路径,所以同目录的 `long_history.py` 能直接 import。
- `from supportpilot.agent.nodes import _ticket_text` Day 464 改过的那个函数。名字带下划线表示「模块内部用」,但 Python 不拦你 import,测试和调试时常这么用。
- `for k in range(1, 9):` k 从 1 到 8。`range(1, 9)` 不含 9,相当于 JS 的 `for (let k = 1; k < 9; k++)`。
- `turns = HISTORY[: 2 * k - 1]` 第 k 轮开始时有 2k-1 条:k-1 轮完整的问答,加这一轮客户刚发的那条。k=8 时是 `HISTORY[:15]`。
- `text = _ticket_text(cast(SupportState, {"ticket": TICKET, "turns": turns}))` `cast` 只是告诉类型检查器「把这个字典当 SupportState 看」,运行时什么都不做(Day 463 的 make_deps 里用过)。
- `print(f"第 {k} 轮  {len(turns):>2} 条  {len(text):>4} 字符")` `:>2` 是右对齐占 2 格,相当于 JS 的 `String(n).padStart(2)`。

</div>

在 supportpilot 根目录跑:

```bash
uv run python scratch/d465/measure_growth.py
```

真实输出:

```text
第 1 轮   1 条    64 字符
第 2 轮   3 条   352 字符
第 3 轮   5 条   547 字符
第 4 轮   7 条   817 字符
第 5 轮   9 条   924 字符
第 6 轮  11 条  1110 字符
第 7 轮  13 条  1198 字符
第 8 轮  15 条  1380 字符
```

每轮平均多 190 个字符,其中一小半是参考文章链接。1380 个字符本身不算大,但这一段在一轮里会被发 3 到 5 次,而且会一直涨下去。今天的目标很朴素:让这一段不再无限变长。

## 第一步:粗估 token,并用真接口校准

要判断「该不该压」,得先知道现在有多少 token。精确的办法是用厂商的 tokenizer,但 DeepSeek 没有像 OpenAI 的 tiktoken 那样一个 `pip install` 就能用的官方 Python 包,而且为了一个阈值判断多一个依赖不值得。我们写一个粗估函数,误差一成以内就够用。

DeepSeek 的[官方文档](https://api-docs.deepseek.com/zh-cn/quick_start/token_usage)给了一个经验值:1 个中文字符约 0.6 个 token,1 个英文字符约 0.3 个 token。新建 `memory/compress.py`,先只写这一个函数:

```python
# supportpilot/src/supportpilot/memory/compress.py(先只有这一段,下一步再往里加)
def estimate_tokens(text: str) -> int:
    """粗估 token 数,只用来判断要不要压缩,不用来算钱(算钱看接口返回的 usage)。"""
    cjk = sum(1 for ch in text if "一" <= ch <= "鿿")
    return int(cjk * 0.7 + (len(text) - cjk) / 3) + 1
```

<div class="line-notes">

- `def estimate_tokens(text: str) -> int:` 输入一段文本,输出一个整数。
- `cjk = sum(1 for ch in text if "一" <= ch <= "鿿")` 数一数有几个汉字。字符串可以直接比大小,比的是 Unicode 码点:`一` 是 U+4E00,`鿿` 是 U+9FFF,这个区间是常用汉字。`sum(1 for … if …)` 就是数满足条件的有几个,相当于 JS 的 `[...text].filter(ch => ch >= "一" && ch <= "鿿").length`。
- `return int(cjk * 0.7 + (len(text) - cjk) / 3) + 1` 汉字按 0.7 个 token,其他字符(字母、数字、标点、空格)按三个一个 token。`int()` 向下取整,`+ 1` 保证空字符串也返回 1 而不是 0。实测 `"中" * 100` 返回 71,`"hello world"` 返回 4。

</div>

汉字系数我没用官方的 0.6,而是 0.7,是校准出来的。校准的办法:同一段文本发给真接口,只让模型回 1 个 token(`max_tokens=1`),看返回的 `usage.prompt_tokens`。几乎不花钱。

```python
# supportpilot/scratch/d465/calibrate.py
"""拿真接口返回的 prompt_tokens 校准粗估。每段文本发一次,只让模型回 1 个 token,几乎不花钱。"""

from long_history import HISTORY

from supportpilot.llm import LLMClient
from supportpilot.memory.compress import estimate_tokens
from supportpilot.memory.turns import render_turns

llm = LLMClient()


def real_tokens(text: str) -> int:
    resp = llm.client.chat.completions.create(model=llm.model, max_tokens=1,
                                              messages=[{"role": "user", "content": text}],
                                              extra_body=llm.s.llm_extra_body)
    return resp.usage.prompt_tokens if resp.usage else 0


base = real_tokens("")                                  # 空消息也有几个模板 token,先量出来减掉
samples = {"纯中文": "您好,网银改密码后旧的授权会失效,需要先删除账户再重新添加并授权。" * 5,
           "链接和编号": "https://help.cloudledger.example/help/error/005 INV-202601-0001 T000153 " * 5,
           "16 条对话": render_turns(HISTORY)}
for name, text in samples.items():
    print(f"{name:<6} {len(text):>5} 字符  真实 {real_tokens(text) - base:>4}  粗估 {estimate_tokens(text):>4}")
print("空消息的模板开销:", base)
```

<div class="line-notes">

- `from supportpilot.memory.turns import render_turns` Day 464 写的,把对话渲染成「客户:……」「客服:……」一行一条。今天压缩时也用它,模型看到的格式要和校准时一致。
- `llm = LLMClient()` Day 457 的客户端,从 `.env` 读 base_url、key、模型名。
- `resp = llm.client.chat.completions.create(model=llm.model, max_tokens=1,` 绕过 `LLMClient.chat`,直接用里面的 openai 客户端,因为要设 `max_tokens=1`。`chat` 方法没开放这个参数。
- `extra_body=llm.s.llm_extra_body)` 和正式调用保持一致,关掉思考模式(Day 457 加的配置)。
- `return resp.usage.prompt_tokens if resp.usage else 0` openai SDK 的类型里 `usage` 可能是 None,先判断再取,basedpyright 才不报错。
- `base = real_tokens("")` 实测是 4:哪怕消息是空的,对话模板也会占几个 token(角色标记之类),要减掉才是文本本身的 token 数。
- `"链接和编号": "https://help.cloudledger.example/help/error/005 INV-202601-0001 T000153 " * 5,` 专门测非汉字部分。对话里的链接、账单号都是这种。
- `print(f"{name:<6} {len(text):>5} 字符  真实 {real_tokens(text) - base:>4}  粗估` `:<6` 左对齐。每次循环调一次接口。

</div>

```bash
uv run python scratch/d465/calibrate.py
```

真实输出:

```text
纯中文      165 字符  真实  110  粗估  111
链接和编号    360 字符  真实  116  粗估  121
16 条对话  1362 字符  真实  725  粗估  693
空消息的模板开销: 4
```

纯中文这一段 150 个汉字加 15 个标点,真实 110 个 token,算下来一个汉字约 0.67。我第一版用官方的 0.6,这一行粗估是 96,低了一成多;改成 0.7 后是 111,几乎一样。16 条对话粗估低了 4%,对判断「要不要压」完全够用。

记住一点:这个函数**只用来做判断,不用来算钱**。算钱永远用接口返回的 `usage`,Day 457 的账本就是这么记的。换了模型厂商,系数可能要重新校准一次,脚本留着就行。

## 第二步:maybe_compress,超了预算才压

压缩策略和 Day 263 在玩具聊天机器人上做的一样,只是对象换成了工单对话:

<figure>
<svg viewBox="0 0 640 250" role="img" aria-label="压缩前后给模型看的内容对比">
<g font-family="var(--font-mono)" font-size="11">
<text x="10" y="22" fill="var(--ink)" font-size="12">turns(状态里的原文,一条都不删,17 条)</text>
<g stroke="var(--rule)">
<rect x="10" y="32" width="28" height="26" fill="var(--mem-wash)"/><rect x="42" y="32" width="28" height="26" fill="var(--mem-wash)"/><rect x="74" y="32" width="28" height="26" fill="var(--mem-wash)"/><rect x="106" y="32" width="28" height="26" fill="var(--mem-wash)"/><rect x="138" y="32" width="28" height="26" fill="var(--mem-wash)"/><rect x="170" y="32" width="28" height="26" fill="var(--mem-wash)"/><rect x="202" y="32" width="28" height="26" fill="var(--mem-wash)"/><rect x="234" y="32" width="28" height="26" fill="var(--mem-wash)"/><rect x="266" y="32" width="28" height="26" fill="var(--mem-wash)"/><rect x="298" y="32" width="28" height="26" fill="var(--mem-wash)"/><rect x="330" y="32" width="28" height="26" fill="var(--mem-wash)"/><rect x="362" y="32" width="28" height="26" fill="var(--mem-wash)"/>
<rect x="400" y="32" width="28" height="26" fill="var(--paper-raised)"/><rect x="432" y="32" width="28" height="26" fill="var(--paper-raised)"/><rect x="464" y="32" width="28" height="26" fill="var(--paper-raised)"/><rect x="496" y="32" width="28" height="26" fill="var(--paper-raised)"/><rect x="528" y="32" width="28" height="26" fill="var(--compute-wash)" stroke="var(--compute)"/>
</g>
<text x="24" y="49" text-anchor="middle" fill="var(--ink-soft)">0</text><text x="376" y="49" text-anchor="middle" fill="var(--ink-soft)">11</text>
<text x="414" y="49" text-anchor="middle" fill="var(--ink-soft)">12</text><text x="542" y="49" text-anchor="middle" fill="var(--ink-soft)">16</text>
<line x1="395" y1="26" x2="395" y2="66" stroke="var(--ink)" stroke-dasharray="3 2"/>
<text x="395" y="80" text-anchor="middle" fill="var(--ink)">summarized_upto = 12(切点落在客户消息上)</text>
<text x="190" y="100" text-anchor="middle" fill="var(--mem)">turns[:12] 已被摘要覆盖</text>
<text x="478" y="100" text-anchor="middle" fill="var(--ink-soft)">原文保留</text>
<text x="542" y="116" text-anchor="middle" fill="var(--compute)">最新</text>
<rect x="10" y="140" width="620" height="100" rx="6" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="24" y="162" fill="var(--ink)" font-size="12">_ticket_text 拼给模型看的文本</text>
<text x="24" y="184" fill="var(--ink-soft)">发件邮箱 / 主题</text>
<text x="24" y="204" fill="var(--mem)">早期对话摘要:约 100 字,替代 12 条原文</text>
<text x="24" y="224" fill="var(--ink-soft)">对话记录:turns[12:16] 四条原文      客户最新消息:turns[16]</text>
<text x="500" y="184" fill="var(--ink-faint)">1425 → 437 字符</text>
</g>
</svg>
<figcaption>压缩只改「给模型看什么」,不改「存了什么」。turns 原文一直完整,摘要和 summarized_upto 是两个新状态字段。</figcaption>
</figure>

1. 算「已有摘要 + 还没被摘要的对话」的粗估 token,不超过预算就什么都不做,也不调模型。
2. 超了,把除最后几条以外的部分交给模型压成要点,并进已有的摘要,记下「前多少条已经被摘要覆盖」。
3. 最后几条永远保留原文,因为客户最近说的话措辞很重要,压缩会丢细节。
4. 原文 turns 一条都不删。

第 4 条很关键。Day 263 里讲过「压缩,别直接丢」,这里更进一步:连原文都不丢,只是不再全部发给模型。原文留着,客服同事在工作台上要看完整记录、将来做评测要回放,都用得上。

把 `compress.py` 补全:

```python
# supportpilot/src/supportpilot/memory/compress.py
"""对话太长时压缩:早期轮次并成一段摘要,最近几条保留原文。原文 turns 一条都不删。"""

from ..llm import LLMClient
from .turns import render_turns

SUMMARY_PROMPT = """把下面这段客服工单的早期对话压缩成要点,给接手的同事看。
必须保留:客户的诉求、提到的账户/账单编号和金额、已经给出的答复和承诺(包括期限)、还没解决的问题。
参考文章链接不用保留。用短句列表,不超过 150 字。"""


def estimate_tokens(text: str) -> int:
    """粗估 token 数,只用来判断要不要压缩,不用来算钱(算钱看接口返回的 usage)。"""
    cjk = sum(1 for ch in text if "一" <= ch <= "鿿")
    return int(cjk * 0.7 + (len(text) - cjk) / 3) + 1


def maybe_compress(llm: LLMClient, turns: list[dict], summary: str, upto: int,
                   budget: int = 1200, keep_last: int = 4) -> tuple[str, int]:
    """「摘要 + 还没被摘要的轮次」超过 budget 时,把除最后 keep_last 条以外的部分并进摘要。
    返回新的 (summary, upto):turns[:upto] 已经被摘要覆盖。没超预算就原样返回,不调模型。"""
    pending = turns[upto:]
    if estimate_tokens(summary + render_turns(pending)) <= budget or len(pending) <= keep_last:
        return summary, upto
    cut = len(pending) - keep_last
    while cut > 0 and pending[cut]["role"] != "customer":   # 保留的部分从客户消息开始,别把一问一答拆开
        cut -= 1
    if cut == 0:
        return summary, upto
    to_fold = pending[:cut]
    text = (f"已有摘要:\n{summary}\n\n" if summary else "") + "新增对话:\n" + render_turns(to_fold)
    res = llm.chat([{"role": "system", "content": SUMMARY_PROMPT}, {"role": "user", "content": text}],
                   temperature=0)
    return res.content.strip(), upto + len(to_fold)
```

<div class="line-notes">

- `from ..llm import LLMClient` 只用来写类型注解。真正传进来的是 `deps.small_llm`,测试里是 FakeLLM。
- `from .turns import render_turns` 同一个包里的兄弟模块,一个点表示当前包(Day 33 讲过相对导入)。
- `SUMMARY_PROMPT = """把下面这段客服工单的早期对话压缩成要点,给接手的同事看。` 「给接手的同事看」这个设定很好用,模型会自动写成交接备忘的口吻,而不是给客户的话。
- `必须保留:客户的诉求、提到的账户/账单编号和金额、已经给出的答复和承诺(包括期限)、还没解决的问题。` 把「必须保留」明确列出来。练习 4 会实测:不在清单里的细节(比如报错的具体时间)基本会被丢掉。
- `参考文章链接不用保留。用短句列表,不超过 150 字。` 链接占 token 又没有信息量,摘要里不要。「150 字」模型不一定守,实测摘要在 190 到 250 个字符之间(含标点),不影响用。
- `def maybe_compress(llm: LLMClient, turns: list[dict], summary: str, upto: int,` 输入是完整的 turns、当前摘要、当前切点;不修改 turns,只返回新的 `(summary, upto)`。这种「输入进来、新值出去、不改输入」的函数最好测。
- `budget: int = 1200, keep_last: int = 4) -> tuple[str, int]:` 默认值和 Settings 里的一致。`tuple[str, int]` 是「两个元素的元组」的类型写法,相当于 TS 的 `[string, number]`。
- `pending = turns[upto:]` 还没被摘要覆盖的部分。第一次 upto 是 0,pending 就是全部。
- `if estimate_tokens(summary + render_turns(pending)) <= budget or len(pending) <= keep_last:` 两种情况直接返回:没超预算;或者剩下的不比 keep_last 多,压也没东西可压。实测 16 条对话估算 693,预算 1200 时不压,预算 600 时要压。
- `cut = len(pending) - keep_last` 先按「保留最后 keep_last 条」算出切点。17 条、保留 4 条时 cut=13。
- `while cut > 0 and pending[cut]["role"] != "customer":` 切点落在客服回复上,就往前退一条,让保留的部分从客户消息开始。17 条时 `pending[13]` 是客服回答「可以手动导入」,退到 12,保留 5 条。为什么要这样,第四步实测。
- `if cut == 0:` 退到头了(比如保留区之前全是客服消息),没东西可压,原样返回。
- `to_fold = pending[:cut]` 要并进摘要的那一段。
- `text = (f"已有摘要:\n{summary}\n\n" if summary else "") + "新增对话:\n" + render_turns(to_fold)` 已经有摘要时,把旧摘要和新的一段一起交给模型重写成一份。这叫滚动摘要:状态里永远只有一段摘要,不会越积越多。
- `res = llm.chat([{"role": "system", "content": SUMMARY_PROMPT}, {"role": "user", "content": text}],` 用 Day 457 的 `chat`,它会带上 `extra_body` 关掉思考。
- `temperature=0)` 摘要要稳定,不要发挥。即便这样,两次跑出来的措辞也不完全一样。
- `return res.content.strip(), upto + len(to_fold)` 新切点 = 旧切点 + 这次压掉的条数。第一次压 12 条,返回 `upto=12`。

</div>

先不接图,单独拿真模型压一次看看效果:

```python
# supportpilot/scratch/d465/try_compress.py
"""真模型压一次:16 条对话,预算 600,保留最后 4 条。"""

import time

from long_history import HISTORY

from supportpilot.llm import LLMClient
from supportpilot.memory.compress import estimate_tokens, maybe_compress
from supportpilot.memory.turns import render_turns

llm = LLMClient()
print("压缩前估算:", estimate_tokens(render_turns(HISTORY)))
t0 = time.perf_counter()
summary, upto = maybe_compress(llm, HISTORY, "", 0, budget=600, keep_last=4)
print(f"用时 {time.perf_counter() - t0:.1f}s,upto={upto}")
print(summary)
print("压缩后估算:", estimate_tokens(summary + render_turns(HISTORY[upto:])))
print("调用", llm.ledger.calls, "次,输入", llm.ledger.prompt_tokens, "输出", llm.ledger.completion_tokens,
      f"花费 ¥{llm.ledger.cost_cny(llm.s):.5f}")
```

<div class="line-notes">

- `t0 = time.perf_counter()` 高精度计时器,相当于 JS 的 `performance.now()`,单位是秒。
- `summary, upto = maybe_compress(llm, HISTORY, "", 0, budget=600, keep_last=4)` 第一次压,摘要是空字符串、切点是 0。预算故意设小到 600,这段 16 条估算 693,一定会压。
- `print("压缩后估算:", estimate_tokens(summary + render_turns(HISTORY[upto:])))` 压完以后真正会发给模型的「摘要 + 剩下的原文」有多少。
- `f"花费 ¥{llm.ledger.cost_cny(llm.s):.5f}")` 账本按 `.env` 里的单价算钱,`:.5f` 保留 5 位小数。

</div>

```bash
uv run python scratch/d465/try_compress.py
```

真实输出:

```text
压缩前估算: 693
用时 1.7s,upto=12
- 客户诉求：银行流水同步失败（E3001），月底结账急；另申请改发票抬头为刚正财税（上海）有限公司。
- 账户：招商银行尾号 6612；发票号 INV-202601-0001。
- 已答复：E3001 多为授权超 90 天，需重新授权；改网银密码后需删除账户再添加授权，首次同步拉近 90 天流水。
- 承诺：尾号 6612 已转技术排查，10 月 24 日前工单答复。
- 未解决：重新添加后仍报 E3001；INV-202601-0001 已超 30 天，需人工红冲重开，已备注财务。
压缩后估算: 254
调用 1 次,输入 676 输出 165 花费 ¥0.00267
```

尾号、发票号、承诺的期限、没解决的问题都留下来了,693 压到 254。一次摘要调用 0.0027 元,1.7 秒。

花费按 2026 年 10 月查到的 [DeepSeek 价格](https://api-docs.deepseek.com/zh-cn/quick_start/pricing)算:deepseek-flash 高峰时段输入(缓存未命中)每百万 token 2 元、输出 8 元。676 × 2 / 1,000,000 + 165 × 8 / 1,000,000 = 0.00135 + 0.00132 = 0.00267 元,和账本一致。

### 故意犯错:思考模式没关

我把思考模式显式打开,同一段对话再压一次(`LLM_EXTRA_BODY` 是 Day 457 加的配置,环境变量会覆盖 `.env`):

```bash
LLM_EXTRA_BODY='{"thinking": {"type": "enabled"}}' uv run python scratch/d465/try_compress.py
```

真实输出的最后两行:

```text
压缩后估算: 209
调用 1 次,输入 701 输出 5697 花费 ¥0.04698
```

摘要长度差不多,输出 token 从一百多个变成 5697,花费涨了将近 20 倍。思考过程也按输出计费,写摘要这种活完全不需要思考。我又试了一次 `LLM_EXTRA_BODY='{}'`(什么都不传),实测输出 154 个 token,说明这个模型不传参数时没有开思考;但厂商的默认值会变,显式写上 `disabled` 最稳。

## 第三步:接进图里,成为 prepare_context

压缩要放在哪里?放在 `load_customer` 之后、`classify` 之前。这样后面所有调模型的节点(分诊、调查、起草、质检)看到的都是压缩后的上下文,而且压缩一轮只做一次。

### 状态多两个字段

```python
# supportpilot/src/supportpilot/agent/state.py(SupportState 里 turns 下面加两行)
    turns: Annotated[list[dict], operator.add]      # Day 464:对话记录,每条 {"role": "customer"|"agent", "content": ...}
    summary: str            # Day 465:早期对话的摘要
    summarized_upto: int    # Day 465:turns[:summarized_upto] 已经被摘要覆盖
```

<div class="line-notes">

- `turns: Annotated[list[dict], operator.add]` Day 464 加的,没变。
- `summary: str            # Day 465:早期对话的摘要` 没有 reducer,默认覆盖:prepare_context 每次返回的就是最新的完整摘要。
- `summarized_upto: int    # Day 465:turns[:summarized_upto] 已经被摘要覆盖` 记切点而不是记「摘要了哪几条」,因为被摘要的永远是开头连续的一段。

</div>

这两个字段属于 Day 464 那张表里「跨轮保留」的一列,**不能**放进 load_customer 的重置列表。重置了,每一轮都要从头把全部历史再压一遍,钱白花,摘要还会每轮变一个样。

### 配置多两项

```python
# supportpilot/src/supportpilot/config.py(Settings 的「Agent 行为」那一组末尾加)
    retrieve_k: int = 5
    # Day 465:对话压缩。摘要 + 未摘要的对话粗估超过 context_budget 个 token 就压,最近 keep_last_turns 条保留原文
    context_budget: int = 1200
    keep_last_turns: int = 4
```

<div class="line-notes">

- `retrieve_k: int = 5` 原来就有的最后一项,新的两项接在它后面。
- `context_budget: int = 1200` 预算 1200 大约是一千七百个汉字的对话。对我们的工单,正常聊五六轮不会触发,十轮左右开始压。演示时用环境变量 `CONTEXT_BUDGET=600` 调小,pydantic-settings 会自动把环境变量 `CONTEXT_BUDGET` 对应到这个字段(Day 442)。
- `keep_last_turns: int = 4` 保留最后 4 条,也就是大约两轮原文。

</div>

预算定多少,没有标准答案。太小,压得频繁,每次压缩都是一次模型调用,摘要也一遍遍有损;太大,等于不压。我的思路是:先看正常工单聊几轮(我们的种子数据和 Day 463 的演示里,绝大多数一两轮就结束),让这些工单永远不触发,只处理少数拖得很长的。

### 节点和 _ticket_text

打开 `agent/nodes.py`,导入里加一行:

```python
from ..memory.compress import maybe_compress
```

在 `make_nodes` 里,`load_customer` 和 `classify` 之间加一个节点:

```python
# supportpilot/src/supportpilot/agent/nodes.py(make_nodes 里新增的节点)
    def prepare_context(state: SupportState) -> dict:
        before = deps.spent()
        summary, upto = maybe_compress(deps.small_llm, state.get("turns", []), state.get("summary", ""),
                                       state.get("summarized_upto", 0), budget=deps.settings.context_budget,
                                       keep_last=deps.settings.keep_last_turns)
        _emit({"type": "step", "node": "prepare_context", "summarized_upto": upto})
        return {"summary": summary, "summarized_upto": upto, "cost_cny": deps.spent() - before}
```

<div class="line-notes">

- `before = deps.spent()` 和其他调模型的节点一样,先记账本读数,结束时相减就是这个节点的花费(Day 460)。没压缩时差值是 0。
- `summary, upto = maybe_compress(deps.small_llm, state.get("turns", []), state.get("summary", ""),` 写摘要是简单活,交给 small_llm(现在和主模型是同一个,Day 457 说过以后会分开)。三个状态字段都用 `.get` 带默认值:第一轮还没有 summary 和 summarized_upto。
- `state.get("summarized_upto", 0), budget=deps.settings.context_budget,` 预算从配置读。
- `_emit({"type": "step", "node": "prepare_context", "summarized_upto": upto})` 推一条步骤事件,Day 467 的 SSE 接口会把它原样推给前端。
- `return {"summary": summary, "summarized_upto": upto, "cost_cny": deps.spent() - before}` 两个字段每次都返回,没压缩时就是原值。`cost_cny` 有 `operator.add`,会累加到整张工单的总花费里。

</div>

返回的字典最后要把它注册进去:`make_nodes` 末尾的 `return {...}` 里,在 `"load_customer": load_customer,` 后面加 `"prepare_context": prepare_context,`。

然后改 `_ticket_text`,让它用上摘要:

```python
# supportpilot/src/supportpilot/agent/nodes.py(_ticket_text 整个替换)
def _ticket_text(state: SupportState) -> str:
    """把工单 + 摘要 + 对话记录拼成给模型看的文本。最新一条客户消息单独标出来,放在最后。"""
    t = state["ticket"]
    turns = state.get("turns") or [{"role": "customer", "content": t["body"]}]
    parts = [f"发件邮箱:{t['customer_email']}\n主题:{t['subject']}"]
    summary = state.get("summary")
    if summary:
        parts.append(f"早期对话摘要:\n{summary}")
    history = turns[state.get("summarized_upto", 0):-1]   # 已经被摘要覆盖的部分不再重复给
    if history:
        parts.append(f"对话记录:\n{render_turns(history)}")
    parts.append(f"客户最新消息:{turns[-1]['content']}")
    return "\n\n".join(parts)
```

<div class="line-notes">

- `turns = state.get("turns") or [{"role": "customer", "content": t["body"]}]` 和 Day 464 一样,单测直接调节点时没有 turns 也能用。
- `summary = state.get("summary")` 先取出来放进局部变量。直接写 `state['summary']` 运行时没问题,但 `summary` 在 TypedDict 里不是必有的键,basedpyright 会报 `"summary" is not a required key`。
- `if summary:` 空字符串和 None 都为假,没压缩过就不加这一段,和 Day 464 的输出完全一样。
- `parts.append(f"早期对话摘要:\n{summary}")` 摘要放在基本信息之后、对话记录之前,时间顺序和真实对话一致。
- `history = turns[state.get("summarized_upto", 0):-1]` 这一行是今天改动的核心:从切点开始取,到倒数第二条为止。切点是 12、共 17 条时取 `turns[12:16]`,四条。没压缩过切点是 0,就是 Day 464 的 `turns[:-1]`。
- `parts.append(f"客户最新消息:{turns[-1]['content']}")` 最新消息永远单独放最后,不管压没压缩。

</div>

最后改图,`build_graph` 里把原来 `load_customer → classify` 那条边换成两条:

```python
# supportpilot/src/supportpilot/agent/graph.py(build_graph 里替换一条边)
    g.add_edge(START, "load_customer")
    g.add_edge("load_customer", "prepare_context")   # Day 465
    g.add_edge("prepare_context", "classify")
```

<div class="line-notes">

- `g.add_edge(START, "load_customer")` 原来就有,没变。
- `g.add_edge("load_customer", "prepare_context")   # Day 465` 原来的 `g.add_edge("load_customer", "classify")` 删掉,换成这两行。
- `g.add_edge("prepare_context", "classify")` 后面的条件边一条都不用动。图现在是十个节点,文件开头的 docstring 也顺手把「九个」改成「十个」。

</div>

## 第四步:用假 LLM 测,顺便发现切点的坑

FakeLLM(Day 463 写的)现在收到摘要请求会走到「调查」那个分支,返回 `"调查结论:- 已查清"`。让它认出压缩节点,打开 `tests/fakes.py`,改三处:

```python
# supportpilot/tests/fakes.py(三处改动)
from supportpilot.memory.compress import SUMMARY_PROMPT

        self.ledger = Usage()
        self.summary_inputs: list[str] = []   # Day 465:每次被要求写摘要时收到的材料

    def chat(self, messages: list[dict], tools: list[dict] | None = None, **_: Any) -> ChatResult:
        self.ledger.add(Usage(300, 50, 1))
        if messages[0]["content"] == SUMMARY_PROMPT:   # Day 465:压缩节点在调它
            self.summary_inputs.append(messages[1]["content"])
            return ChatResult(content=f"- 摘要第 {len(self.summary_inputs)} 版")
```

<div class="line-notes">

- `from supportpilot.memory.compress import SUMMARY_PROMPT` 加在文件开头的导入里。和 Day 463 认分诊、质检的办法一样:看系统提示是哪一个。
- `self.summary_inputs: list[str] = []   # Day 465:每次被要求写摘要时收到的材料` 加在 `__init__` 里 `self.ledger = Usage()` 下面。这又是一个 spy(Day 464),记下自己被怎么调用,测试里可以检查「压缩时到底把哪些条交给了模型」。
- `if messages[0]["content"] == SUMMARY_PROMPT:   # Day 465:压缩节点在调它` 加在 `chat` 记账那一行后面、`if not self.act_script:` 前面。
- `return ChatResult(content=f"- 摘要第 {len(self.summary_inputs)} 版")` 返回带编号的假摘要,第几次调用就是第几版,测试能看出调了几次。

</div>

新建 `tests/test_compress.py`:

```python
# supportpilot/tests/test_compress.py
"""对话压缩:没超预算不调模型;超了只压早期部分;摘要滚动更新;给模型的文本不重复已摘要的轮次。"""

from typing import cast

from fakes import FakeLLM, FakeTools, make_deps
from langchain_core.runnables import RunnableConfig
from langgraph.checkpoint.memory import InMemorySaver
from test_memory import DRAFT, TICKET, TRIAGE

from supportpilot.agent.graph import build_graph
from supportpilot.agent.nodes import _ticket_text
from supportpilot.agent.state import SupportState
from supportpilot.config import Settings
from supportpilot.llm import LLMClient
from supportpilot.memory.compress import estimate_tokens, maybe_compress

LONG = [{"role": "customer" if i % 2 == 0 else "agent", "content": f"第{i}条:" + "银行流水同步失败" * 10}
        for i in range(10)]                                   # 10 条,每条 84 个字符


def test_estimate_tokens_rough():
    assert estimate_tokens("中" * 100) == 71
    assert estimate_tokens("") == 1


def test_no_call_when_under_budget():
    llm = FakeLLM(TRIAGE, [], DRAFT)
    assert maybe_compress(cast(LLMClient, llm), LONG[:3], "", 0, budget=600) == ("", 0)
    assert llm.ledger.calls == 0


def test_fold_all_but_last_four():
    llm = FakeLLM(TRIAGE, [], DRAFT)
    summary, upto = maybe_compress(cast(LLMClient, llm), LONG, "", 0, budget=300, keep_last=4)
    assert (summary, upto) == ("- 摘要第 1 版", 6)
    assert "第5条" in llm.summary_inputs[0] and "第6条" not in llm.summary_inputs[0]


def test_cut_never_splits_a_qa_pair():
    llm = FakeLLM(TRIAGE, [], DRAFT)
    _, upto = maybe_compress(cast(LLMClient, llm), LONG[:9], "", 0, budget=300, keep_last=4)
    assert upto == 4                                          # 9-4=5 落在客服回复上,往前退一条
    assert LONG[upto]["role"] == "customer"


def test_rolling_summary_includes_old_one():
    llm = FakeLLM(TRIAGE, [], DRAFT)
    more = LONG + LONG                                        # 又聊了 10 条
    summary, upto = maybe_compress(cast(LLMClient, llm), more, "- 旧摘要", 6, budget=300, keep_last=4)
    assert upto == 16
    assert llm.summary_inputs[0].startswith("已有摘要:\n- 旧摘要")


def test_ticket_text_skips_summarized_turns():
    state = cast(SupportState, {"ticket": TICKET, "turns": LONG, "summary": "- 摘要", "summarized_upto": 6})
    text = _ticket_text(state)
    assert "早期对话摘要:\n- 摘要" in text
    assert "第5条" not in text and "第6条" in text
    assert text.endswith("客户最新消息:" + LONG[-1]["content"])


def test_graph_compresses_long_thread():
    llm = FakeLLM(TRIAGE, [], DRAFT)
    deps = make_deps(llm, FakeTools(customer={"id": "C0010"}))
    deps.settings = Settings(context_budget=300)
    graph = build_graph(deps, checkpointer=InMemorySaver())
    cfg: RunnableConfig = {"configurable": {"thread_id": TICKET["id"]}}
    out = graph.invoke({"ticket": TICKET, "turns": LONG[:9]}, cfg)   # 已经聊了 9 条,来了第 10 条之前的那句
    assert out["summarized_upto"] == 4 and out["summary"] == "- 摘要第 1 版"
    assert len(out["turns"]) == 10                                  # 原文一条没少,还多了这一轮的回复
```

<div class="line-notes">

- `from test_memory import DRAFT, TICKET, TRIAGE` 复用 Day 464 测试里的吴刚工单和剧本。
- `LONG = [{"role": "customer" if i % 2 == 0 else "agent", "content": f"第{i}条:" + "银行流水同步失败" * 10}` 列表推导式造 10 条消息,偶数是客户、奇数是客服。内容带编号「第i条」,方便断言哪几条进了摘要。字符串乘法 `"…" * 10` 重复 10 次,JS 里是 `"…".repeat(10)`。
- `assert estimate_tokens("中" * 100) == 71` 把校准后的系数钉死。以后谁改了系数,这个测试会提醒他重新校准。
- `assert maybe_compress(cast(LLMClient, llm), LONG[:3], "", 0, budget=600) == ("", 0)` 3 条估算 181,不到预算,原样返回。`cast` 让类型检查器把 FakeLLM 当 LLMClient。
- `assert llm.ledger.calls == 0` 没调模型。这是压缩最重要的性质之一:绝大多数工单走这条路,一分钱不多花。
- `assert (summary, upto) == ("- 摘要第 1 版", 6)` 10 条估算 602,超过 300;保留 4 条,切点 6 正好是客户消息,压掉 0 到 5。
- `assert "第5条" in llm.summary_inputs[0] and "第6条" not in llm.summary_inputs[0]` 用 spy 检查交给模型的材料:第 5 条在,第 6 条不在。
- `def test_cut_never_splits_a_qa_pair():` 9 条时 9-4=5,`LONG[5]` 是客服消息,要退到 4。
- `more = LONG + LONG                                        # 又聊了 10 条` 列表相加,20 条。模拟之前已经压到 6、后来又聊了很多的情况。
- `summary, upto = maybe_compress(cast(LLMClient, llm), more, "- 旧摘要", 6, budget=300, keep_last=4)` pending 是后 14 条,切点 14-4=10,对应原列表的 16,是客户消息。
- `assert llm.summary_inputs[0].startswith("已有摘要:\n- 旧摘要")` 滚动摘要:旧摘要和新对话一起交给模型。
- `assert "第5条" not in text and "第6条" in text` 已摘要的第 0 到 5 条不再出现在给模型的文本里。
- `assert text.endswith("客户最新消息:" + LONG[-1]["content"])` 最新消息还在最后。
- `deps.settings = Settings(context_budget=300)` 直接换掉 deps 里的配置。pydantic-settings 的 Settings 也能像普通 pydantic 模型那样传参数构造,传了的字段优先于环境变量。
- `out = graph.invoke({"ticket": TICKET, "turns": LONG[:9]}, cfg)` 第一次 invoke 就带着 9 条 turns,load_customer 看到 turns 不为空,就不会再把 body 放进去。这是造「已经聊了很久」状态的最省事办法。
- `assert len(out["turns"]) == 10` 9 条加上 finalize 追加的回复。压缩没删任何原文。

</div>

```bash
uv run pytest tests/test_compress.py -v
```

真实输出:

```text
tests/test_compress.py::test_estimate_tokens_rough PASSED                [ 14%]
tests/test_compress.py::test_no_call_when_under_budget PASSED            [ 28%]
tests/test_compress.py::test_fold_all_but_last_four PASSED               [ 42%]
tests/test_compress.py::test_cut_never_splits_a_qa_pair PASSED           [ 57%]
tests/test_compress.py::test_rolling_summary_includes_old_one PASSED     [ 71%]
tests/test_compress.py::test_ticket_text_skips_summarized_turns PASSED   [ 85%]
tests/test_compress.py::test_graph_compresses_long_thread PASSED         [100%]

============================== 7 passed in 2.36s ===============================
```

再跑全部(`uv run pytest -q`),确认加了节点没弄坏 Day 463、464 的测试。加上练习 2 的那一个,实测 `44 passed in 4.86s`。

### 切点为什么要退到客户消息

`while cut > 0 and pending[cut]["role"] != "customer"` 这三行,我第一版没写,是真模型跑出来才发现的。

那一版里,17 条(16 条历史加客户刚问的一句)、保留 4 条,切点直接是 13。`HISTORY[12]` 是客户问「我能先手动导入流水吗」,`HISTORY[13]` 是客服回答「可以」。切点 13 正好把这一问一答拆开:问题进了摘要,回答留在原文。真模型压出来的摘要最后一条是:

```text
- 未解决：重加后仍E3001；客户问能否先手动导入流水，待回复
```

「待回复」是错的,下一条原文里就是答复。摘要模型只看到了问题,没看到回答,只能这么写。之后起草的模型同时看到「待回复」和那条答复,运气好会忽略摘要,运气不好会再回答一遍,或者说「关于导入的问题我们还在确认」。

修法就是那三行:切点落在客服消息上,往前退,让保留的原文从客户消息开始。`test_cut_never_splits_a_qa_pair` 把这条规则钉住了。

## 第五步:真模型对比一轮的花费

现在用真模型跑完整的一轮:工单已经聊了 8 轮,客户发来第 9 句。用环境变量控制压不压:

```python
# supportpilot/scratch/d465/long_chat.py
"""真模型跑一轮:工单已经聊了 8 轮,客户发来第 9 句。用环境变量 CONTEXT_BUDGET 控制压不压。"""

import sys

from langchain_core.runnables import RunnableConfig
from langgraph.checkpoint.memory import InMemorySaver
from long_history import HISTORY, TICKET

from supportpilot.agent.deps import Deps
from supportpilot.agent.graph import build_graph
from supportpilot.agent.state import SupportState
from supportpilot.db import connect

ASK = sys.argv[1] if len(sys.argv) > 1 else "技术那边怎么样了?你们之前说哪天前给答复来着?还有我那张发票财务处理了吗"

deps = Deps.from_conn(connect())
graph = build_graph(deps, checkpointer=InMemorySaver())
cfg: RunnableConfig = {"configurable": {"thread_id": TICKET["id"]}}
start: SupportState = {"ticket": TICKET, "turns": [*HISTORY, {"role": "customer", "content": ASK}]}
out = graph.invoke(start, cfg)

print("budget =", deps.settings.context_budget, " summarized_upto =", out.get("summarized_upto"))
print("summary:", out.get("summary") or "(没压缩)")
print("outcome:", out["outcome"], out.get("handoff_reason") or "")
print("--- reply ---\n" + out["reply"].split("\n\n参考文章")[0])
u = deps.llm.ledger
print(f"--- 调用 {u.calls} 次,输入 {u.prompt_tokens},输出 {u.completion_tokens},cost ¥{out['cost_cny']:.4f}")
```

<div class="line-notes">

- `ASK = sys.argv[1] if len(sys.argv) > 1 else` 命令行给了参数就用参数当客户这一句,没给就用默认的那句。`sys.argv` 相当于 Node 的 `process.argv.slice(1)`,第 0 个是脚本名。默认这句故意问的都是早期对话里的事:承诺的期限在下标 7,发票在下标 10、11,压缩后都只在摘要里。
- `deps = Deps.from_conn(connect())` 真依赖:真模型、真检索、真业务库。
- `graph = build_graph(deps, checkpointer=InMemorySaver())` 这里只跑一轮,用内存存档就够,不往 Postgres 里写快照。
- `start: SupportState = {"ticket": TICKET, "turns": [*HISTORY, {"role": "customer", "content": ASK}]}` 16 条历史加这一句,一共 17 条。`[*HISTORY, x]` 是列表展开,和 JS 的 `[...HISTORY, x]` 一样。先标好类型再传进去,basedpyright 才认。
- `print("--- reply ---\n" + out["reply"].split("\n\n参考文章")[0])` 只打印回复正文,参考文章链接那几行切掉。
- `u = deps.llm.ledger` small_llm 和 llm 现在是同一个对象,所以这个账本记了全部调用。

</div>

先不压(预算调到十万,永远不触发),再压(预算 600):

```bash
CONTEXT_BUDGET=100000 uv run python scratch/d465/long_chat.py
CONTEXT_BUDGET=600 uv run python scratch/d465/long_chat.py
```

不压缩,真实输出(这次跑时脚本里还没有打印 outcome 那一行,这一轮是 resolved):

```text
budget = 100000  summarized_upto = 0
summary: (没压缩)
--- reply ---
您好，关于银行流水问题：目前系统内还没有技术排查结论记录，之前承诺的答复时间是 10 月 24 日前，有结论会第一时间在本工单通知您。E3001 最常见的原因是银行授权超过 90 天已过期 [1]，授权有效期为 90 天，到期需重新授权 [2]。关于发票 INV-202601-0001：开票后 30 天内可在线申请红冲重开 [3]，该发票开票日为 1 月 10 日，已超期，需人工处理，目前系统内暂无处理记录，已转财务同事跟进。
--- 调用 6 次,输入 12752,输出 719,cost ¥0.0313
```

压缩(加了切点修复以后),真实输出:

```text
budget = 600  summarized_upto = 12
summary: - 诉求：银行流水同步失败（E3001），月底结账急；另申请改发票抬头为刚正财税（上海）有限公司
- 账户：招商银行尾号 6612；发票 INV-202601-0001
- 已答复：E3001 多为授权超 90 天过期，需重新授权；改密码后旧授权失效，需删除账户重加并授权，首次同步拉最近 90 天流水
- 承诺：尾号 6612 已转技术排查，10 月 24 日前工单答复
- 未解决：删后重加仍报 E3001；INV-202601-0001 已超 30 天，需人工红冲重开，已备注财务
outcome: resolved 
--- reply ---
您好，关于您的问题回复如下：

1. 银行流水同步（E3001）：尾号 6612 的问题已转技术排查，目前尚无技术结论，有结果会第一时间在本工单通知您。此前承诺的答复期限是 10 月 24 日前。E3001 最常见原因是银行授权超过 90 天已过期 [1]，授权有效期 90 天，到期需重新授权 [2]。您已通过手动导入 Excel 流水成功绕过该问题，可继续使用此方式过渡。

2. 发票 INV-202601-0001：已超 30 天，需人工红冲重开，此前已备注财务，目前系统内尚无红冲或重开记录，我会再转财务同事跟进进展。

如有其他问题请随时告知。
--- 调用 7 次,输入 10715,输出 949,cost ¥0.0290
```

两边都答对了「10 月 24 日前」和发票的情况。压缩版还提到了「您已通过手动导入 Excel 流水成功绕过该问题」,这条在保留的原文里。

算账:压缩版多了 1 次调用(写摘要),输入总量从 12752 降到 10715,少了 2037 个 token,大约 16%;花费从 0.0313 降到 0.0290。省得不多,原因是这一轮里大头是帮助中心资料和系统提示,对话历史只占一部分。但这是**第一次压缩那一轮**,摘要的钱已经付过了。下一轮只要没超预算就不再调摘要,每次调用都少发一千来个 token 的历史,再聊下去差距会越拉越大。

还要说一句实话:模型输出有波动。压缩版我一共跑了 3 次,其中一次质检两次没过、转了人工,那次调用 9 次、0.0362 元;切点修复之前那次 0.0277 元。单次比较只能看个方向,真要下结论得在 Day 476 开始的评测集上批量跑。

### 故意犯错:忘了返回 summarized_upto

写 prepare_context 时很容易只返回 summary,忘了 summarized_upto。不报错,测试如果只断言「有摘要」也能过,但 `_ticket_text` 会从 0 开始取历史:摘要加全部原文,比不压缩还长。用一个不花钱的脚本看看:

```python
# supportpilot/scratch/d465/bug_no_upto.py
"""故意犯错:prepare_context 只返回 summary、忘了 summarized_upto。给模型的文本会变成什么样。"""

from typing import cast

from long_history import HISTORY, TICKET

from supportpilot.agent.nodes import _ticket_text
from supportpilot.agent.state import SupportState
from supportpilot.memory.compress import estimate_tokens

SUMMARY = ("- 诉求:招行尾号6612流水同步失败(E3001),月底结账急;发票抬头改刚正财税(上海)有限公司\n"
           "- 已答复:改密码致授权失效,需删除重加;已转技术,承诺10月24日前答复\n"
           "- 未解决:重加后仍E3001;INV-202601-0001已超30天,已备注财务")
turns = [*HISTORY, {"role": "customer", "content": "技术那边怎么样了?"}]
cases = {"不压缩": {}, "正确压缩": {"summary": SUMMARY, "summarized_upto": 12},
         "忘了 upto": {"summary": SUMMARY}}
for name, extra in cases.items():
    text = _ticket_text(cast(SupportState, {"ticket": TICKET, "turns": turns, **extra}))
    print(f"{name:<8} {len(text):>5} 字符  估算 {estimate_tokens(text):>4} token")
```

<div class="line-notes">

- `SUMMARY = ("- 诉求:招行尾号6612流水同步失败(E3001)` 照着真模型的摘要手写一份,不调模型。括号里几个字符串挨着写会自动拼成一个,和 JS 里用 `+` 拼一样。
- `cases = {"不压缩": {}, "正确压缩": {"summary": SUMMARY, "summarized_upto": 12},` 三种状态:没压缩、正确压缩、只写了摘要。
- `text = _ticket_text(cast(SupportState, {"ticket": TICKET, "turns": turns, **extra}))` `**extra` 把字典展开合并进来,相当于 JS 的 `{...extra}`。

</div>

```bash
uv run python scratch/d465/bug_no_upto.py
```

真实输出:

```text
不压缩       1425 字符  估算  727 token
正确压缩       437 字符  估算  235 token
忘了 upto   1566 字符  估算  803 token
```

忘了切点,比不压缩还多 76 个 token,而且每一轮都在白花写摘要的钱。`test_ticket_text_skips_summarized_turns` 和 `test_graph_compresses_long_thread` 里断言了 `summarized_upto`,这个 bug 跑不过测试。

## 第六步:压缩会丢什么

压缩是有损的。摘要提示词列了「必须保留」的四类信息,不在清单里的细节会怎样?客户第 3 轮说过「时间是 10 月 20 号上午十点左右」,这不属于诉求、编号、承诺、未解决问题中的任何一类。现在让客户问这个:

```bash
CONTEXT_BUDGET=600 uv run python scratch/d465/long_chat.py "我最开始给你们发截图的时候,说的报错时间是几点来着?我要跟银行对一下"
```

真实输出的回复部分:

```text
--- reply ---
您好，关于最初截图中的具体报错时间，我这边查询了历史工单记录，摘要中未记录具体时间点，现有系统数据中也查不到截图或报错时间戳，需要转给同事人工调取工单附件或技术排查记录后再回复您。另外提醒一下，E3001 最常见的原因是银行授权超过 90 天已过期 [1]，银行授权有效期为 90 天，到期需重新授权，否则会同步失败并提示 E3001 [2]，您与银行核对时可一并确认授权状态。
--- 调用 7 次,输入 9780,输出 593,cost ¥0.0243
```

摘要里没有这个时间,模型答不上来。好在它没有编一个时间出来,而是老实说查不到、转同事。这是 DRAFT 提示词「资料里没有的,不要猜」在起作用(Day 458)。但从客户的角度看,这很别扭:我明明跟你说过。

缓解办法有三个,各有代价。一是把预算调大、keep_last 调大,少压一些,花费高一点。二是在「必须保留」里加上「时间、日期」,摘要会变长。三是不让模型只看摘要:原文 turns 一直都在状态里,可以给起草节点一个「查看完整对话记录」的工具,需要细节时自己去翻。第三种最彻底,但又多了一次工具调用。对工单这个场景,我选第二种:客服对话里日期时间很常见,值得保留。练习 4 会看提示词对保留内容的影响。

还有一个更隐蔽的风险:**摘要写错了,之后每一轮都会被误导。** 原文是对的,但模型只看摘要。比如摘要把「10 月 24 日前」写成了「10 月 22 日前」,后面所有回复都会跟着错。所以 Day 476 开始做评测时,要专门放几条「长对话 + 问早期细节」的用例。

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1nJ396JEmC&autoplay=0&high_quality=1" title="Claude Code 为什么不会撑爆上下文？深入解析 Agent 上下文压缩与会话恢复机制" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>唐国梁Tommy · Claude Code 为什么不会撑爆上下文?深入解析 Agent 上下文压缩与会话恢复机制 · 15 分钟,讲编码 Agent 怎么判断该压、压完怎么接着干活。和今天对照着看:它压的是工具调用记录,我们压的是客服对话,思路一样。</figcaption>
</figure>

## 零件和大代码的对照

| 零件 | 改了哪个文件 | 作用 |
| --- | --- | --- |
| `estimate_tokens` | `memory/compress.py`(新) | 粗估 token,系数用真接口校准过 |
| `maybe_compress` + `SUMMARY_PROMPT` | `memory/compress.py`(新) | 超预算才压;滚动摘要;切点落在客户消息 |
| `summary`、`summarized_upto` | `agent/state.py` | 跨轮保留,不进重置列表 |
| `context_budget`、`keep_last_turns` | `config.py` | 预算和保留条数可配置 |
| `prepare_context` 节点 | `agent/nodes.py` | load_customer 之后、classify 之前压缩 |
| 新 `_ticket_text` | `agent/nodes.py` | 摘要 + 切点之后的原文 + 最新消息 |
| 两条新边 | `agent/graph.py` | load_customer → prepare_context → classify |
| `summary_inputs` spy | `tests/fakes.py` | 测试能看到交给摘要模型的材料 |
| `test_compress.py` | `tests/`(新) | 7 个测试 |

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/XFCkrYHHfpQ" title="How Agents Use Context Engineering" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>LangChain · How Agents Use Context Engineering · 官方讲上下文工程的几种手段(写出去、挑进来、压缩、隔离),今天做的是其中的「压缩」。英文,开字幕看。</figcaption>
</figure>

## 动手练习

**练习 1:keep_last 取多少。** 不花钱,用 FakeLLM,对 `HISTORY` 分别用 keep_last=2、4、6、8、预算 600 压一次,打印切点、保留条数和压完的估算。

<details><summary>参考答案</summary>

```python
# supportpilot/scratch/d465/ex1_keep_last.py
"""练习 1:keep_last 取 2、4、6、8,同一段 16 条对话会压掉几条、压完还剩多少。假模型,不花钱。"""

import sys
from typing import cast

sys.path.insert(0, "tests")

from fakes import FakeLLM
from long_history import HISTORY

from supportpilot.llm import LLMClient
from supportpilot.memory.compress import estimate_tokens, maybe_compress
from supportpilot.memory.turns import render_turns

for keep in (2, 4, 6, 8):
    llm = FakeLLM({}, [], "")
    summary, upto = maybe_compress(cast(LLMClient, llm), HISTORY, "", 0, budget=600, keep_last=keep)
    after = estimate_tokens(summary + render_turns(HISTORY[upto:]))
    print(f"keep_last={keep}  upto={upto:>2}  保留 {len(HISTORY) - upto:>2} 条  压完估算 {after:>3}")
```

<div class="line-notes">

- `sys.path.insert(0, "tests")` 在根目录运行,把 tests 加进搜索路径才能 import fakes。
- `llm = FakeLLM({}, [], "")` 只用它的摘要分支,分诊剧本和草稿随便给。每次循环新建一个,摘要编号从 1 开始。
- `summary, upto = maybe_compress(cast(LLMClient, llm), HISTORY, "", 0, budget=600, keep_last=keep)` 16 条是偶数,`16 - keep` 都是偶数,都落在客户消息上,不需要往前退。
- `after = estimate_tokens(summary + render_turns(HISTORY[upto:]))` 假摘要只有几个字,真摘要大约多 80 到 90 个 token,看的时候心里加上。

</div>

```bash
uv run python scratch/d465/ex1_keep_last.py
```

```text
keep_last=2  upto=14  保留  2 条  压完估算  41
keep_last=4  upto=12  保留  4 条  压完估算 130
keep_last=6  upto=10  保留  6 条  压完估算 182
keep_last=8  upto= 8  保留  8 条  压完估算 276
```

keep_last=2 压得最狠,但只剩一问一答,客户说「刚才那个不行」时,「刚才」很可能指上上轮。8 条保留了四轮原文,压完 276,再加上真摘要约 360,只比预算的一半多一点,很快又会超。我选 4,两轮原文刚好覆盖「刚才说的」这种指代。

</details>

**练习 2:压过一次以后,下一轮不该再压。** 写一个测试:预算 450,第一轮带 9 条 `LONG` 进去会压一次;第二轮客户只说「好的」,断言摘要调用还是 1 次,summary 和 summarized_upto 原样带过来。再把预算改成 300 跑一次,看会发生什么。

<details><summary>参考答案</summary>

```python
# supportpilot/tests/test_compress_more.py
"""练习 2:压过一次以后,下一轮没超预算就不该再调模型写摘要,摘要原样带到下一轮。"""

from fakes import FakeLLM, FakeTools, make_deps
from langchain_core.runnables import RunnableConfig
from langgraph.checkpoint.memory import InMemorySaver
from test_compress import LONG
from test_memory import DRAFT, TICKET, TRIAGE

from supportpilot.agent.graph import build_graph
from supportpilot.config import Settings


def test_summary_carries_over_without_new_call():
    llm = FakeLLM(TRIAGE, [], DRAFT)
    deps = make_deps(llm, FakeTools(customer={"id": "C0010"}))
    deps.settings = Settings(context_budget=450)
    graph = build_graph(deps, checkpointer=InMemorySaver())
    cfg: RunnableConfig = {"configurable": {"thread_id": TICKET["id"]}}
    first = graph.invoke({"ticket": TICKET, "turns": LONG[:9]}, cfg)
    assert first["summarized_upto"] == 4 and len(llm.summary_inputs) == 1

    second = graph.invoke({"turns": [{"role": "customer", "content": "好的"}]}, cfg)
    assert len(llm.summary_inputs) == 1                      # 没有第二次摘要调用
    assert second["summary"] == "- 摘要第 1 版" and second["summarized_upto"] == 4
```

<div class="line-notes">

- `from test_compress import LONG` 复用正文测试里的 10 条长消息。
- `deps.settings = Settings(context_budget=450)` 9 条估算 541,超过 450,第一轮会压。
- `first = graph.invoke({"ticket": TICKET, "turns": LONG[:9]}, cfg)` 和正文的图测试一样,切点退到 4。
- `second = graph.invoke({"turns": [{"role": "customer", "content": "好的"}]}, cfg)` 第二轮。pending 是第 4 到 8 条、第一轮的回复、「好的」,共 7 条,加上摘要估算在 450 以内。
- `assert len(llm.summary_inputs) == 1` spy 里还是只有一次。
- `assert second["summary"] == "- 摘要第 1 版" and second["summarized_upto"] == 4` 两个字段从存档里原样带过来,load_customer 没有重置它们。

</div>

```bash
uv run pytest tests/test_compress_more.py -q
```

预算 450:`1 passed in 4.19s`。把预算改成 300 再跑:

```text
E       AssertionError: assert 2 == 1
1 failed in 2.22s
```

第二轮又压了一次。7 条估算 332,超过 300。这不是 bug,是预算太小:每次压完剩下的原文本身就接近预算,下一轮多一两条就又超了。经验是预算至少要能装下「摘要 + keep_last 条 + 一两轮新对话」,否则会每轮都调一次摘要。

</details>

**练习 3:看一眼压缩后 draft 节点实际收到了什么。** 用 Day 464 的 Spy 办法,继承 FakeLLM 记下 stream 收到的用户消息,跑正文 `test_graph_compresses_long_thread` 那个场景,打印出来。

<details><summary>参考答案</summary>

```python
# supportpilot/scratch/d465/ex3_spy_draft.py
"""练习 3:压缩以后,draft 节点拿到的材料长什么样。假零件,不花钱。"""

import sys

sys.path[:0] = ["tests"]

from fakes import FakeLLM, FakeTools, make_deps
from langchain_core.runnables import RunnableConfig
from langgraph.checkpoint.memory import InMemorySaver
from test_compress import LONG
from test_memory import DRAFT, TICKET, TRIAGE

from supportpilot.agent.graph import build_graph
from supportpilot.config import Settings


class Spy(FakeLLM):
    last_prompt = ""

    def stream(self, messages, on_token=None, **kw):
        self.last_prompt = messages[1]["content"]
        return super().stream(messages, on_token, **kw)


llm = Spy(TRIAGE, [], DRAFT)
deps = make_deps(llm, FakeTools(customer={"id": "C0010"}))
deps.settings = Settings(context_budget=300)
graph = build_graph(deps, checkpointer=InMemorySaver())
cfg: RunnableConfig = {"configurable": {"thread_id": TICKET["id"]}}
graph.invoke({"ticket": TICKET, "turns": LONG[:9]}, cfg)
print(llm.last_prompt.split("【帮助中心资料】")[0])
```

<div class="line-notes">

- `class Spy(FakeLLM):` 和 Day 464 第四步一模一样的 spy,只覆盖 stream。
- `self.last_prompt = messages[1]["content"]` draft 的第二条消息是拼好的全部材料。
- `print(llm.last_prompt.split("【帮助中心资料】")[0])` 只看工单那一段,资料和调查结论不打印。

</div>

```bash
uv run python scratch/d465/ex3_spy_draft.py
```

```text
【客户工单】
发件邮箱:wugang@example.com
主题:银行流水又不同步了

早期对话摘要:
- 摘要第 1 版

对话记录:
客户:第4条:银行流水同步失败银行流水同步失败银行流水同步失败银行流水同步失败银行流水同步失败银行流水同步失败银行流水同步失败银行流水同步失败银行流水同步失败银行流水同步失败
客服:第5条:银行流水同步失败银行流水同步失败银行流水同步失败银行流水同步失败银行流水同步失败银行流水同步失败银行流水同步失败银行流水同步失败银行流水同步失败银行流水同步失败
客户:第6条:银行流水同步失败银行流水同步失败银行流水同步失败银行流水同步失败银行流水同步失败银行流水同步失败银行流水同步失败银行流水同步失败银行流水同步失败银行流水同步失败
客服:第7条:银行流水同步失败银行流水同步失败银行流水同步失败银行流水同步失败银行流水同步失败银行流水同步失败银行流水同步失败银行流水同步失败银行流水同步失败银行流水同步失败

客户最新消息:第8条:银行流水同步失败银行流水同步失败银行流水同步失败银行流水同步失败银行流水同步失败银行流水同步失败银行流水同步失败银行流水同步失败银行流水同步失败银行流水同步失败
```

第 0 到 3 条被摘要替代,第 4 条从客户消息开始,最新消息在最后。结构和第三步 `_ticket_text` 的设计一致。

</details>

**练习 4(开放题):摘要提示词写不写「必须保留」,差别在哪?** 用一个弱提示词「把下面这段客服对话总结一下,不超过 150 字。」和正文的提示词,对 `HISTORY` 各压 3 次,统计摘要里有没有尾号 6612、发票号、承诺日期 24、报错时间「十点」。

<details><summary>参考答案</summary>

```python
# supportpilot/scratch/d465/ex4_prompt.py
"""练习 4:摘要提示词不写「必须保留」,同一段对话压出来会丢什么。两种提示词各跑 3 次。"""

from long_history import HISTORY

from supportpilot.llm import LLMClient
from supportpilot.memory import compress

STRONG = compress.SUMMARY_PROMPT
WEAK = "把下面这段客服对话总结一下,不超过 150 字。"
KEYS = ["6612", "INV-202601-0001", "24", "十点"]              # 尾号、账单号、承诺的日期、报错时间

llm = LLMClient()
for name, prompt in [("STRONG", STRONG), ("WEAK", WEAK)]:
    compress.SUMMARY_PROMPT = prompt                          # maybe_compress 每次调用时才读这个全局变量
    for i in range(3):
        summary, upto = compress.maybe_compress(llm, HISTORY, "", 0, budget=600)
        kept = [k for k in KEYS if k in summary]
        print(f"{name} #{i + 1}  {len(summary):>3} 字  保留 {kept}")
print(f"花费 ¥{llm.ledger.cost_cny(llm.s):.4f}")
```

<div class="line-notes">

- `from supportpilot.memory import compress` 导入整个模块而不是里面的名字,这样才能在下面改模块里的全局变量。
- `compress.SUMMARY_PROMPT = prompt` 改的是模块对象上的属性。`maybe_compress` 函数体里写的是 `SUMMARY_PROMPT`,每次调用时才去模块里查这个名字,所以能拿到新值。如果写 `from ...compress import SUMMARY_PROMPT` 再赋值,只改了本文件的一个局部名字,不起作用。
- `kept = [k for k in KEYS if k in summary]` 列表推导式,留下出现在摘要里的关键词。`in` 对字符串是子串判断,相当于 JS 的 `summary.includes(k)`。
- `print(f"{name} #{i + 1}  {len(summary):>3} 字` `len` 数的是字符数,含标点和换行。

</div>

```bash
uv run python scratch/d465/ex4_prompt.py
```

```text
STRONG #1  206 字  保留 ['6612', 'INV-202601-0001', '24']
STRONG #2  188 字  保留 ['6612', 'INV-202601-0001', '24']
STRONG #3  229 字  保留 ['6612', 'INV-202601-0001', '24']
WEAK #1  333 字  保留 ['6612', 'INV-202601-0001', '24', '十点']
WEAK #2  255 字  保留 ['6612', 'INV-202601-0001', '24']
WEAK #3  332 字  保留 ['6612', 'INV-202601-0001', '24', '十点']
花费 ¥0.0159
```

结果和我预想的不一样。我以为弱提示词会丢掉编号和承诺,实际上 6 次都留下了,这段对话里的编号太显眼了。差别在别处:强提示词 3 次都在 190 到 230 字,稳定,而且**从不保留**清单外的「十点」;弱提示词长短不一(255 到 333 字),反而有两次留下了「十点」。

示范结论:「必须保留」清单的作用是让摘要稳定、短,代价是清单外的东西基本会丢,第六步那个答不上来的问题就是这么来的。所以清单要按业务定。我在正文的提示词里加上「时间、日期」再跑一次就能留下「十点」,这一改留给你自己做,跑完对比一下摘要长度涨了多少。

</details>

验收标准:`uv run pytest` 全部通过(含 `test_compress.py` 7 个和练习 2 的 1 个);你亲手跑过校准脚本,知道自己用的模型一个汉字大约几个 token;复现过「切点拆开一问一答」和「忘了 summarized_upto」两个坑;真模型对比过一轮压缩前后的输入 token;今天的真模型花费在 0.3 元以内。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 对话压缩 | 把早期的对话轮次换成一段摘要再给模型看,原文还留着。例:16 条对话粗估 693 个 token,压到 254。 |
| 上下文预算 | 给某一部分上下文定的 token 上限,超了就处理。今天是 `context_budget`,默认 1200。 |
| 粗估 token | 不用 tokenizer,按字符类型乘系数估算 token 数,只用来做判断。例:`estimate_tokens("中" * 100)` 是 71。 |
| 校准 | 拿真实值对照估算值调系数。今天用 `max_tokens=1` 的请求读 `usage.prompt_tokens`。 |
| 滚动摘要 | 新的对话和旧摘要一起重写成一份新摘要,状态里永远只有一段。 |
| summarized_upto | 切点,`turns[:summarized_upto]` 已经被摘要覆盖,给模型时从这里往后取原文。 |
| keep_last | 永远保留原文的最近几条,今天是 4。 |
| prepare_context | 今天新加的节点,在 load_customer 和 classify 之间做压缩。 |
| 有损 | 压缩后丢掉了一部分信息,无法从摘要还原原文。例:报错时间「十点」没进摘要。 |
| 思考模式 | 模型先输出一段推理再给答案,推理部分也按输出计费。今天显式打开后摘要花费涨了将近 20 倍。 |

## 常见误区

**以为压缩就是删掉早期对话。** 删掉的话,客服工作台看不到完整记录,评测也没法回放。正确做法是 turns 原文不动,只用 `summary` 加 `summarized_upto` 控制给模型看什么。

**每轮都压一遍。** 摘要是一次模型调用,有钱有延迟,还每压一次丢一点。先判断有没有超预算,绝大多数工单一次都不会触发(`test_no_call_when_under_budget` 断言了 0 次调用)。预算还要留出余量,练习 2 里预算 300 就出现了每轮都压。

**切点按条数硬切。** 第四步实测:17 条保留 4 条,切点把「能手动导入吗」和「可以」拆开,摘要写成「待回复」。切点要退到客户消息。

**只返回 summary,忘了 summarized_upto。** 第五步实测:摘要加全部原文,803 个 token,比不压缩的 727 还多。

**把 summary 放进 load_customer 的重置列表。** 它是跨轮保留的。重置了每轮都要从头压。Day 464 那张「跨轮保留 / 每轮重置」的表要把这两个字段加进左边一列。

**用官方经验值就不校准。** 官方说一个汉字约 0.6 个 token,我实测约 0.67,用 0.6 时纯中文那一段低估了一成多。换模型时花一分钱跑一次校准脚本。

**写摘要没关思考模式。** 实测打开思考后,同一个摘要输出 5697 个 token、0.047 元,关掉是一百多个、0.0027 元左右。

**以为摘要能保留一切。** 第六步实测:报错时间不在「必须保留」清单里,摘要丢了,Agent 答不上来。清单按业务定,答不上来时让 Agent 老实说,别编。

## 学习资料

### 文档与文章

- [Anthropic · Effective context engineering for AI agents](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents):讲上下文腐烂(context rot)和 compaction,读「Long-horizon tasks」那一节,15 分钟。
- [Chroma · Context Rot](https://research.trychroma.com/context-rot):实测上下文越长模型越不准的研究报告,看前几张图就够,能理解为什么窗口有一百万也要压。
- [LangGraph Add memory](https://docs.langchain.com/oss/python/langgraph/add-memory):官方 how-to 里有「Summarize messages」一节,手写版用 RemoveMessage 删掉旧消息,完整版用 langmem 的 SummarizationNode。注意它是真删,我们是原文不动只记切点,对比着看两种取舍。
- [LangChain Short-term memory](https://docs.langchain.com/oss/python/langchain/short-term-memory):介绍 trim(截断)和 summarize(摘要)两种处理长对话的办法。
- [DeepSeek Token 用量计算](https://api-docs.deepseek.com/zh-cn/quick_start/token_usage):官方的字符和 token 换算经验值,今天校准的起点。
- [DeepSeek 模型与价格](https://api-docs.deepseek.com/zh-cn/quick_start/pricing):2026 年 10 月查的单价,算钱用。

### B 站视频

- 唐国梁Tommy《Claude Code 为什么不会撑爆上下文?深入解析 Agent 上下文压缩与会话恢复机制》:上面嵌入的那个。
- CrazyAllen《一条视频看懂:Codex 上下文压缩机制》:22 分钟,讲 Codex 什么时候触发压缩、摘要里留什么,和今天的「必须保留」清单对照着看。

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1WpYT6jEx7&autoplay=0&high_quality=1" title="一条视频看懂:Codex 上下文压缩机制" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>CrazyAllen · 一条视频看懂:Codex 上下文压缩机制 · 22 分钟,重点看触发条件和摘要保留什么那一段。</figcaption>
</figure>

### 其他经典视频

- LangChain《How Agents Use Context Engineering》:上面嵌入的那个。

### 书籍

- Chip Huyen《AI Engineering》(O'Reilly, 2025):第 6 章讲 Agents,里面有一节讲 memory,把记忆的存储和「放不下时怎么取舍」放在一起讲,读这一节约 30 分钟。

### 开源项目与代码

- [langchain-ai/langmem](https://github.com/langchain-ai/langmem):LangChain 官方的记忆库,短期记忆部分有现成的摘要节点,配套文档 [Summarization guide](https://langchain-ai.github.io/langmem/guides/summarization/) 讲它用一个 RunningSummary 记录「已经摘要到哪」,和我们的 summarized_upto 是同一个想法。

## 自测

1. 压缩后 `turns` 里还有几条?为什么不直接删掉早期的?

<details><summary>答案</summary>

一条不少,还会继续追加。压缩只改变给模型看的内容(摘要 + 切点之后的原文),原文要留着给客服工作台看完整记录、给评测回放、给以后需要细节时查。

</details>

2. 为什么 `estimate_tokens` 只用来判断要不要压,不用来算钱?

<details><summary>答案</summary>

它是粗估,实测误差在一成以内,做阈值判断够了,算钱不够。算钱永远用接口返回的 usage,那是厂商真正计费的数字。

</details>

3. 17 条对话、keep_last=4,切点是多少?为什么?

<details><summary>答案</summary>

先算 17-4=13,`turns[13]` 是客服消息,往前退到 12。保留的原文从客户消息开始,不会把一问一答拆到摘要和原文两边。不退的话,摘要会把已经回答过的问题写成「待回复」。

</details>

4. summary 和 summarized_upto 要不要在 load_customer 里每轮重置?

<details><summary>答案</summary>

不要。它们属于跨轮保留的字段,和 turns 一样跟着工单走。重置了,每轮都要从头把全部历史压一遍,多花钱,而且摘要每轮都变一个样。

</details>

5. 面试题:你的客服 Agent 对话很长时怎么处理上下文?有什么副作用?

<details><summary>答案</summary>

示范回答:我在工作流里加了一个 prepare_context 节点,在分诊之前跑。它粗估「已有摘要 + 还没摘要的对话」的 token 数,系数是用接口返回的 usage 校准过的;超过预算(默认 1200)才调一次便宜模型,把除最近 4 条以外的部分并进一段滚动摘要,切点保证落在客户消息上。原文一条不删,状态里记一个切点,给模型时只发摘要和切点之后的原文。摘要提示词明确要求保留诉求、编号金额、已给的承诺和期限、未解决的问题。实测一张 8 轮的工单,第一次压缩那轮输入 token 少了 16%,之后每轮都少发一千来个 token。副作用是有损:清单外的细节会丢,我实测过客户问早期说的报错时间,Agent 答不上来,只能转人工;还有摘要一旦写错会持续误导,所以评测集里专门放了长对话问早期细节的用例。

</details>

6. 预算设得太小会怎样?

<details><summary>答案</summary>

压完剩下的原文本身就接近预算,下一轮多一两条又超了,结果每轮都调一次摘要。练习 2 里预算 300 就是这样。预算至少要装得下「摘要 + keep_last 条 + 一两轮新对话」。

</details>

## 明天预告

明天是 Day 466,记忆(三):跨工单的客户画像和新问题。今天和昨天做的都是「一张工单之内」的记忆,工单关了就结束了。可吴刚这已经是第四次来问银行同步了,每次 Agent 都从「E3001 一般是授权过期」讲起。明天做第三种记忆:把一个客户的订阅和历史工单压成一段 100 字的画像,存在业务库里,只在历史工单变了的时候重建;再讲加了记忆以后多出来的问题,包括客户要求删除数据时,checkpoint、摘要、画像这几处都要删干净。
