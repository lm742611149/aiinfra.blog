---
title: 'Day 263 · 上下文工程(二):压缩,别直接丢,先总结'
description: '历史超预算,与其整轮丢掉,不如压缩。先写零成本的一档:把旧工具结果换成一行占位,24 轮历史从 3176 降到 2078 token;再写要花一次模型调用的一档:把较早几轮总结成摘要,16 条消息压成 5 条。然后用七条事实打分,量「随手总结」和「列清保留项」两种摘要提示词,看压缩有没有把关键信息压丢。'
pubDate: 2026-10-23
regime: none
tags: ['context-engineering', 'compaction', 'python', 'agent-zero']
series: 'agent-zero'
day: 263
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 262](/blog/agent-zero/day-262-context-budget/) 把一次客服调用的上下文拆成六块,给每块定了上限,出了预算表。对话历史那一块超了,用 `trim_by_turn` 整轮整轮地丢最早的,不拆散工具调用。练习 2 还查出一件事:64 条历史消息里,8 条工具结果占了一半的 token。

按轮裁有两个问题。一是丢了就没了:客户第 1 轮说「我们是年付企业版」,第 20 轮问「那我能退多少」,第 1 轮早被裁掉了,Agent 不知道他是什么套餐。二是粒度粗:预算还剩 244,但下一轮有 285,整轮进不去,那 244 就白白空着。今天换一种思路,不丢,先压。

## 今天要解决的问题

学完你应该能做到:

1. 说清楚三档手段(清理旧工具结果、按轮裁剪、总结压缩)各花多少钱、丢什么,以及为什么按这个顺序用。
2. 写出 `part04/tool_clearing.py`:不调模型,把旧的大块工具结果换成一行占位,并验证消息结构还是成对的。
3. 写出 `part04/compaction.py` 的 `compact()`:超过 `trigger_tokens` 才压缩,最近 `keep_last_turns` 轮保留原文,旧摘要合并进新摘要,多次压缩摘要始终只有一条。
4. 会**量**压缩的效果:用七条事实给摘要打分,再问一个只有早期对话才答得出的问题,看压缩后答不答得对。

预计用时 2.5 小时。API 花费:主线实验合计约 ¥0.1(每个脚本的花费写在文里),练习约 ¥0.05。价格同 Day 262:deepseek-flash 输入缓存命中 0.04 元、未命中 2 元、输出 8 元每百万 token。

前置:[Day 262](/blog/agent-zero/day-262-context-budget/) 的 `ctx_blocks.py`、`ctx_budget.py`(`message_tokens`)、`trim_turns.py`(`split_turns`、`check_pairs`);[Day 158](/blog/agent-zero/day-158-fc-first-run/) 的 `tool_calls` 和 `tool` 消息;[Day 24](/blog/agent-zero/day-024-dicts/) 的字典和 `**` 展开;`common/llm.py` 的 `LLMClient`。

学法:先对照文章把每个脚本逐行敲一遍(不要复制粘贴)并跑通;明天合上文章,把 `compact` 默写出来;然后做动手练习,做不出来再展开参考答案,看完关掉重写一遍。

## 三档手段:按代价从低到高

今天要写两档,算上昨天的按轮裁一共三档。先放在一起比:

| 手段 | 花不花钱 | 丢什么 | 什么时候用 |
| --- | --- | --- | --- |
| 清理旧工具结果 | 不调模型,零成本 | 旧工具返回的原文 | 工具调用多的 Agent,每一步都可以做 |
| 按轮裁剪(Day 262) | 零成本 | 最早几轮的全部内容 | 早期对话确实不重要 |
| 总结压缩 | 一次模型调用 | 摘要没写到的细节 | 接近预算上限,而且早期信息还有用 |

顺序是按代价排的:能零成本解决的先做,不够再花钱。Anthropic 在 [《Effective context engineering for AI agents》](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents) 里把清理旧工具结果叫做最轻量的一种压缩:工具在历史深处被调用过之后,原始结果通常不会再被用到。把整段历史总结成摘要(compaction)是另一档,它在 Claude Code 里的做法是:对话接近窗口上限时,总结前文、开一个新窗口接着干,摘要里留下架构决策、没解决的 bug 和实现细节,丢掉冗余的工具输出。

JetBrains 研究院在 2025 年底发了一篇 [Cutting Through the Noise](https://blog.jetbrains.com/research/2025/12/efficient-context-management/),在 SWE-bench Verified 上比较了这两类做法(他们的叫法是 observation masking,把旧的观察结果换成占位,和我们今天第一档是一回事;以及 LLM summarization)。我没有复现这个实验,下面是博客里的结论:两种都比不管上下文便宜一半以上;用 Qwen3-Coder 480B 时,换占位比不管上下文便宜 52%,解题率还高 2.6 个百分点;总结压缩的 Agent 平均多跑了约 15% 的步数,博客的猜测是摘要把「该停了」的信号抹平了。这是二手资料,别当成定论,只当「为什么第一档要先做」的一个佐证。

## 第一步:清理旧工具结果

### 做法

回忆 Day 262 练习 2 的结果:8 条 `tool` 消息每条 206 个 token,占了历史的一半。一个 `list_invoices` 返回的五张发票,模型第 3 轮读过、答完以后,到第 20 轮多半用不上了。那就把旧的那些换成一行:

```text
(早先的工具结果已清理以节省上下文。需要的话可以重新调用该工具。)
```

有两条约束,和按轮裁一样:消息的条数和结构不能变。assistant 消息里的 `tool_calls` 要留着,`tool` 消息也要留着,只把 `content` 换短。这样接口的「成对」检查不会报错,模型也还能看到「当时调过什么工具、传了什么参数」。需要的话,它可以自己再调一次。

新建 `part04/tool_clearing.py`:

```python
# agent-zero-lab/part04/tool_clearing.py  清理旧工具结果:不调模型、不花钱,把旧的大块 tool 内容换成一行占位
from typing import Any

PLACEHOLDER = "(早先的工具结果已清理以节省上下文。需要的话可以重新调用该工具。)"


def clear_old_tool_results(messages: list[dict[str, Any]], keep_recent: int = 2, min_chars: int = 200) -> list[dict[str, Any]]:
    """只保留最近 keep_recent 次工具结果的原文,更早的、而且超过 min_chars 个字符的,换成占位。
    assistant 的 tool_calls 和 tool 消息本身都保留,所以成对关系不会被破坏。"""
    tool_idx = [i for i, m in enumerate(messages) if m["role"] == "tool"]
    old = set(tool_idx[:len(tool_idx) - keep_recent]) if keep_recent < len(tool_idx) else set()
    out = []
    for i, m in enumerate(messages):
        if i in old and len(str(m.get("content") or "")) > min_chars:  # 很短的结果清了也省不了多少,留着
            m = {**m, "content": PLACEHOLDER}
        out.append(m)
    return out
```

<div class="line-notes">

- `from typing import Any` 类型提示里的「任意类型」,消息字典里的值有字符串、列表、`None`,写 `Any` 最省事。
- `PLACEHOLDER = "(早先的工具结果已清理以节省上下文。需要的话可以重新调用该工具。)"` 占位文字要告诉模型两件事:这里原来有内容,被清了;想要的话可以再调。只写「已清理」,模型可能误以为工具查不到东西。
- `def clear_old_tool_results(messages: list[dict[str, Any]], keep_recent: int = 2, min_chars: int = 200)` 两个参数:`keep_recent` 保留最近几次工具结果的原文,`min_chars` 短于它的结果不清。
- `tool_idx = [i for i, m in enumerate(messages) if m["role"] == "tool"]` 所有 `tool` 消息的下标。以 `make_history(9)` 为例,24 条消息里 tool 在下标 6、14、22,所以 `tool_idx = [6, 14, 22]`。
- `old = set(tool_idx[:len(tool_idx) - keep_recent]) if keep_recent < len(tool_idx) else set()` 要清理的是「除了最近 keep_recent 个以外的」。`keep_recent=2` 时 `len(tool_idx) - 2 = 1`,切片 `[:1]` 得到 `[6]`,转成集合 `{6}`:只有下标 6 的那条是旧的。后面半句 `if keep_recent < len(tool_idx) else set()` 处理「保留的比总数还多」,这时一条都不清,返回空集合。为什么不直接写 `tool_idx[:-keep_recent]`?`keep_recent=0` 时 `[:-0]` 就是 `[:0]`,是空列表,一条都不清,和「保留 0 个、全清」的本意正好相反,练习 1 会让你亲眼看到。
- `out = []` 装结果的新列表。原来的 `messages` 不改。
- `for i, m in enumerate(messages):` 逐条看。
- `if i in old and len(str(m.get("content") or "")) > min_chars:` 是旧的 tool 消息,而且内容超过 200 个字符才清。`str(...)` 和 `or ""` 防 `None`。这三条 tool 消息各 445 个字符,所以下标 6 满足条件。
- `m = {**m, "content": PLACEHOLDER}` 字典展开(Day 24),相当于 JS 的 `{...m, content: PLACEHOLDER}`。**新建**一个字典,`role` 和 `tool_call_id` 原样保留,只换 `content`;原来列表里的那个字典没被改。
- `out.append(m)` 换没换都追加,所以条数不变。
- `return out` 返回新列表。

</div>

再写一个演示,看清理前后 token、结构,以及模型还能不能接着答。新建 `part04/tool_clearing_demo.py`:

```python
# agent-zero-lab/part04/tool_clearing_demo.py  清理前后对比:token 少多少、结构还成不成对、模型还能不能接着答
from common.llm import LLMClient
from part04.ctx_blocks import SYSTEM, TOOLS, make_history
from part04.ctx_budget import message_tokens
from part04.tool_clearing import clear_old_tool_results
from part04.trim_turns import check_pairs

history = make_history(24)  # 24 轮,里面 8 次工具调用,每个工具结果 206 token
before = sum(message_tokens(m) for m in history)
for keep in (2, 0):
    cleaned = clear_old_tool_results(history, keep_recent=keep)
    after = sum(message_tokens(m) for m in cleaned)
    changed = sum(a is not b for a, b in zip(history, cleaned))
    print(f"keep_recent={keep}: {before} → {after} token,换掉 {changed} 条,条数 {len(history)} → {len(cleaned)},成对检查:{check_pairs(cleaned)}")

cleaned = clear_old_tool_results(history, keep_recent=2)
tool_msgs = [m for m in cleaned if m["role"] == "tool"]
print("第 1 条 tool:", tool_msgs[0]["content"])
print("最后一条 tool:", tool_msgs[-1]["content"][:60], "…")

messages = [{"role": "system", "content": SYSTEM}, *cleaned, {"role": "user", "content": "我最近一张发票是哪张?"}]
r = LLMClient().chat(messages, tools=TOOLS, max_tokens=200)
print("发给 API 的输入", r.prompt_tokens, "token;模型这一步:", r.content[:50] or [c["function"]["name"] for c in r.message["tool_calls"]])
```

<div class="line-notes">

- `from part04.ctx_blocks import SYSTEM, TOOLS, make_history` 用 Day 262 造数据的函数。
- `from part04.trim_turns import check_pairs` Day 262 写的成对检查,清理之后要用它确认结构没坏。
- `history = make_history(24)` 24 轮,64 条消息,8 次工具调用,工具结果每条 206 token,历史共 3176。
- `before = sum(message_tokens(m) for m in history)` 清理前的总数。
- `for keep in (2, 0):` 比较两种力度:保留最近 2 个,和一个都不留。
- `cleaned = clear_old_tool_results(history, keep_recent=keep)` 清理。
- `changed = sum(a is not b for a, b in zip(history, cleaned))` `zip` 把清理前后的两个列表逐条配对,`is not` 判断是不是**同一个对象**:被换掉的消息是新字典,所以 `is not` 为真;没换的还是原来那个对象。`sum` 把真假当 1 和 0 加,得到「换了几条」。
- `print(f"keep_recent={keep}:` 打印 token 变化、条数变化和 `check_pairs` 的结果。
- `cleaned = clear_old_tool_results(history, keep_recent=2)` 用保留 2 个的版本继续看细节。
- `tool_msgs = [m for m in cleaned if m["role"] == "tool"]` 取出清理后的所有 tool 消息,共 8 条。
- `print("第 1 条 tool:", tool_msgs[0]["content"])` 最早的那条已经是占位。
- `print("最后一条 tool:", tool_msgs[-1]["content"][:60], "…")` 最后一条还是原文,只看前 60 个字符。
- `messages = [{"role": "system", "content": SYSTEM}, *cleaned, {"role": "user", "content": "我最近一张发票是哪张?"}]` 拼成请求,问一个要用到最近一次工具结果的问题。
- `r = LLMClient().chat(messages, tools=TOOLS, max_tokens=200)` 真发一次,带工具定义。
- `print("发给 API 的输入", r.prompt_tokens,` 打印输入多少 token,以及模型这一步做了什么:要么直接回答(`r.content` 非空),要么调工具(`r.content` 为空串,`or` 取后面的工具名列表)。

</div>

```bash
uv run python -m part04.tool_clearing_demo
```

实跑输出:

```text
keep_recent=2: 3176 → 2078 token,换掉 6 条,条数 64 → 64,成对检查:None
keep_recent=0: 3176 → 1712 token,换掉 8 条,条数 64 → 64,成对检查:None
第 1 条 tool: (早先的工具结果已清理以节省上下文。需要的话可以重新调用该工具。)
最后一条 tool: [{"invoice_no": "INV-2026-2401", "amount": 468.0, "date": "2 …
发给 API 的输入 3100 token;模型这一步: ['list_invoices']
```

保留最近 2 个:3176 → 2078,少了 1098 个 token,换掉 6 条;一个都不留:3176 → 1712,换掉 8 条。条数都是 64 → 64,`check_pairs` 都是 `None`,结构没坏。**一个模型调用都没有,一分钱没花**。

最后一问我跑了两次,两次模型的动作不一样。第一次它直接用留着的最近一次结果回答:「最近一张发票是 INV-2026-2405,金额 468 元」;这一次它又调了一遍 `list_invoices`。这是个有意思的现象:占位文字里写了「需要的话可以重新调用该工具」,模型有时会把它当成邀请。没有对错,但如果你的工具调用要花钱或有副作用,就要在清理策略里把那类工具排除掉。Anthropic 的 API 里有一个现成的同类功能,叫 context editing,策略名是 `clear_tool_uses_20250919`,配置里有一个 `exclude_tools` 列表,可以指定哪些工具的结果不清理(2026 年 10 月读文档确认,我没有实跑)。

### 哪些结果不该清

`min_chars=200` 是个朴素的判断:太短的结果清了也省不了多少。拿 Day 262 没用到的手写对话 `CONVO` 举例(后面第二步会正式用它),里面有三条工具结果,长度分别是 75、228、536 个字符。保留最近 1 个时:75 字符的 `find_customer` 结果虽然是旧的,但太短,原样留着;228 字符的 `get_subscription` 结果被换成占位;最后一条 536 字符的是最近的,保留。

还有一类不该清的是结果里含有后面要用的编号或金额的。比如工具返回了 `customer_id: C-0001`,后面每一步都要用它。清掉了,模型要么重新调用,要么凭印象编。更稳妥的办法是清理之前把这类关键信息提到摘要或记忆里,这正是明天的内容。

Anthropic 在 2025 年 9 月 29 日的 [博客](https://claude.com/blog/context-management) 里报告,在他们自己的评测里,context editing 单独用把一个 100 轮的网页搜索任务的 token 用量降了 84%,和 memory tool 一起用把 agentic search 评测的表现提高了 39%(没加的话是 29% 的提升)。这是厂商自己的数字,我没有复现。我们今天的数字在另一种数据上,别拿来对比。

## 第二步:总结压缩

### 先造一段能反复用的对话

压缩要调模型,每次调用都有随机性。为了能前后对比,先手写一段固定的对话。新建 `part04/convo.py`:四轮已经聊完,第五轮是客户刚发来的新问题。

```python
# agent-zero-lab/part04/convo.py  一段手写的客服对话:四轮已经聊完,第五轮是客户刚发来的新问题。压缩实验都用它
import json

SYSTEM_LINE = "你是云簿 CloudLedger 的客服助手。"


def call(call_id: str, name: str, args: dict) -> dict:
    """造一条 assistant 发起工具调用的消息。"""
    return {"role": "assistant", "content": None, "tool_calls": [{
        "id": call_id, "type": "function",
        "function": {"name": name, "arguments": json.dumps(args, ensure_ascii=False)}}]}


def result(call_id: str, data: object) -> dict:
    """造一条工具结果消息,编号要和 call 的一致。"""
    return {"role": "tool", "tool_call_id": call_id, "content": json.dumps(data, ensure_ascii=False)}


SUBSCRIPTION = {"customer_id": "C-0001", "company": "星河记账", "plan": "企业版", "billing": "年付", "seats": 10,
                "status": "active", "started_at": "2026-03-15", "next_charge_date": "2027-03-15",
                "amount": 1908.0, "currency": "CNY", "auto_renew": True}
INVOICES = [{"invoice_no": f"INV-2026-{n:04d}", "amount": 1908.0 if n == 3 else 199.0, "date": f"2026-0{n}-15",
             "status": "已付款", "type": "电子普通发票"} for n in range(1, 6)]

CONVO: list[dict] = [
    {"role": "user", "content": "你好,我们公司是星河记账,用的年付企业版,10 个席位。导入招商银行流水一直报 E1043。"},
    call("call_1", "find_customer", {"query": "星河记账"}),
    result("call_1", {"customer_id": "C-0001", "company": "星河记账", "email": "ops@xinghe.example"}),
    {"role": "assistant", "content": "查到了。E1043 是文件编码不是 UTF-8,请在 Excel 里另存为「CSV UTF-8」,或者直接上传 XLSX。"},

    {"role": "user", "content": "换了 XLSX 还是报错。另外这个月我们想把席位从 10 个加到 15 个。"},
    call("call_2", "get_subscription", {"customer_id": "C-0001"}),
    result("call_2", SUBSCRIPTION),
    {"role": "assistant", "content": "您现在是年付企业版,加席位按剩余月数补差价。导入的问题,方便把完整的报错文字发我吗?"},

    {"role": "user", "content": "报错就是 E1043。还有,下个月起想降级到专业版,年付的话能退多少?"},
    call("call_3", "list_invoices", {"customer_id": "C-0001", "limit": 5}),
    result("call_3", INVOICES),
    {"role": "assistant", "content": "年付按剩余整月比例退款,已用月份和当前所在的月份不退。具体金额要提交退款申请,由客服主管审批。"},

    {"role": "user", "content": "先别提交,我再想想。招商银行导出流水时能直接选 UTF-8 吗?"},
    {"role": "assistant", "content": "网银导出一般是 GBK,没有 UTF-8 选项,导出后用 Excel 另存为 CSV UTF-8 即可。"},
]

QUESTION = "我上次说的导入问题还是没解决,换了 XLSX 也报错,你们是不是系统有问题?我很不满意。"
```

<div class="line-notes">

- `import json` 工具调用的参数和结果都要转成 JSON 字符串。
- `SYSTEM_LINE = "你是云簿 CloudLedger 的客服助手。"` 一句话的系统提示词。今天的重点是历史,不需要 Day 262 那份长的。
- `def call(call_id: str, name: str, args: dict) -> dict:` 造一条「assistant 发起工具调用」的消息。后面要反复写,抽成函数。
- `return {"role": "assistant", "content": None, "tool_calls": [{` 文字内容是 `None`,只有 `tool_calls`。`arguments` 要用 `json.dumps` 转成字符串,`ensure_ascii=False` 让汉字不被转义成 `\uXXXX`。
- `def result(call_id: str, data: object) -> dict:` 造一条工具结果。
- `return {"role": "tool", "tool_call_id": call_id,` `tool_call_id` 要和上面的 `call_id` 一致。
- `SUBSCRIPTION = {` 订阅信息:星河记账,企业版,年付,10 个席位,2026-03-15 开始,金额 1908 元。后面摘要里会出现这些数字。
- `INVOICES = [` 5 张发票的列表推导式。`n == 3` 那张是 1908 元(年付),其余 199 元(月付)。`f"2026-0{n}-15"` 把 n 嵌进日期。
- `CONVO: list[dict] = [` 整段对话:14 条消息。
- `{"role": "user", "content": "你好,我们公司是星河记账,用的年付企业版,10 个席位。导入招商银行流水一直报 E1043。"},` 第 1 轮开头。关键事实都在这一句:公司、套餐、周期、席位、报错码、银行。
- `call("call_1", "find_customer", {"query": "星河记账"}),` assistant 先查客户。
- `result("call_1", {"customer_id": "C-0001",` 工具返回客户编号,这条只有 75 个字符,清理时不会被换掉。
- `{"role": "assistant", "content": "查到了。` 回答:E1043 是编码问题。
- `{"role": "user", "content": "换了 XLSX` 第 2 轮:还是报错,另外想加席位。
- `call("call_2", "get_subscription", {"customer_id": "C-0001"}),` 查订阅。
- `result("call_2", SUBSCRIPTION),` 订阅信息,228 个字符。
- `{"role": "assistant", "content": "您现在是年付企业版,` 回答,并追问完整报错。
- `{"role": "user", "content": "报错就是 E1043。` 第 3 轮:想降级到专业版,问年付能退多少。
- `call("call_3", "list_invoices"` 查发票。
- `result("call_3", INVOICES),` 536 个字符,是对话里最大的一条工具结果。
- `{"role": "assistant", "content": "年付按剩余整月` 回答:按剩余整月比例退,要提交申请由主管审批。
- `{"role": "user", "content": "先别提交,` 第 4 轮:客户说先别提交,又问招商银行能不能选 UTF-8。
- `{"role": "assistant", "content": "网银导出一般是 GBK,` 回答。
- `QUESTION = ` 第 5 轮:客户的新问题,语气不满。它不放进 `CONVO`,实验里单独追加。

</div>

四轮里,和客户身份有关的信息只在第 1、2 轮出现:星河记账、年付企业版、10 个席位、招商银行。到第 5 轮,这些都已经离得很远了。

### 写 compact

思路:历史快超预算的时候,把较早的几轮交给模型总结成一段摘要,最近几轮保留原文,摘要放在 system 消息后面。新建 `part04/compaction.py`:

```python
# agent-zero-lab/part04/compaction.py  总结压缩:历史太长时,把较早的几轮交给模型总结成一段摘要,最近几轮留原文
from typing import Any

from common.llm import LLMClient
from part04.ctx_budget import message_tokens
from part04.trim_turns import split_turns

SUMMARY_TAG = "【之前对话的摘要】"
SUMMARY_PROMPT = """把下面这段客服对话压缩成一段摘要,给接手的客服看。
必须保留:客户的身份信息(公司、套餐、付费周期、席位数)、客户提出的每个问题和诉求、已经给出的结论、还没解决的事项、客户明确表达的偏好或不满。
可以丢掉:寒暄、重复的话、已经被纠正的错误信息。
如果开头有更早的摘要,把它的要点合并进来。用第三人称,不超过 200 字。"""


def is_summary(m: dict[str, Any]) -> bool:
    """这条是不是以前压缩出来的摘要。"""
    return m["role"] == "system" and str(m.get("content", "")).startswith(SUMMARY_TAG)


def render(m: dict[str, Any]) -> str:
    """把一条消息写成一行文字,给总结用的模型看。"""
    if m.get("tool_calls"):
        c = m["tool_calls"][0]["function"]
        return f"assistant: (调用工具 {c['name']},参数 {c['arguments']})"
    return f"{m['role']}: {m.get('content') or ''}"


def compact(client: LLMClient, messages: list[dict[str, Any]], keep_last_turns: int = 3,
            trigger_tokens: int = 3000, prompt: str = SUMMARY_PROMPT) -> list[dict[str, Any]]:
    """总量超过 trigger_tokens 时压缩。返回:真正的 system + 一条摘要 + 最近 keep_last_turns 轮原文。"""
    if sum(message_tokens(m) for m in messages) <= trigger_tokens:
        return messages  # 没超就原样返回,不调模型,每一轮都可以先调它

    summaries = [m for m in messages if is_summary(m)]
    system = [m for m in messages if m["role"] == "system" and not is_summary(m)]
    turns = split_turns([m for m in messages if m["role"] != "system"])
    if len(turns) <= keep_last_turns:
        return messages  # 轮数不够,没有「较早的」可压

    cut = len(turns) - keep_last_turns  # 前 cut 轮压缩,后面的留原文
    old = [m for turn in turns[:cut] for m in turn]
    recent = [m for turn in turns[cut:] for m in turn]

    # 旧摘要也放进去一起总结,否则压缩多次会叠出好几段摘要
    lines = [s["content"] for s in summaries] + [render(m) for m in old]
    reply = client.chat([{"role": "system", "content": prompt},
                         {"role": "user", "content": "\n".join(lines)}], temperature=0)
    note = {"role": "system", "content": f"{SUMMARY_TAG}\n{reply.content}"}
    return [*system, note, *recent]
```

<div class="line-notes">

- `from typing import Any` 同上。
- `from common.llm import LLMClient` 写摘要要调一次模型,这是压缩的成本。
- `from part04.ctx_budget import message_tokens` Day 262 的函数,判断总量要不要触发压缩。
- `from part04.trim_turns import split_turns` Day 262 的函数,把消息切成「轮」。今天按轮切,理由和昨天一样:不拆散工具调用。
- `SUMMARY_TAG = "【之前对话的摘要】"` 摘要消息的固定开头。下次压缩时靠它认出「这条 system 是以前压缩出来的摘要」。
- `SUMMARY_PROMPT = """把下面这段客服对话压缩成一段摘要,给接手的客服看。` 写给「做总结的那个模型」的指令,是整段代码最要紧的地方。
- `必须保留:客户的身份信息(公司、套餐、付费周期、席位数)` 按客服业务列出不能丢的东西。套餐和付费周期排第一,因为后面问「能不能退」全靠它。如果只写「保留重要信息」,模型对「什么重要」的判断和你不一样。
- `可以丢掉:寒暄、重复的话、已经被纠正的错误信息。` 明确说哪些可以丢。
- `如果开头有更早的摘要,把它的要点合并进来。用第三人称,不超过 200 字。` 前半句处理多次压缩:旧摘要和新的旧对话一起再总结一次。后半句给摘要设上限,不设的话,压缩完可能比原文还长。注意这个上限是**建议**,模型不一定守,练习 2 会量。
- `def is_summary(m: dict[str, Any]) -> bool:` 判断一条消息是不是以前的摘要。
- `return m["role"] == "system" and str(m.get("content", "")).startswith(SUMMARY_TAG)` role 是 system,并且内容以标签开头。`str(...)` 防 `content` 是 `None` 时 `.startswith` 报错。
- `def render(m: dict[str, Any]) -> str:` 把一条消息写成一行文字,给总结用的模型读。
- `if m.get("tool_calls"):` 发起工具调用的 assistant 消息,`content` 是 `None`,要单独处理。
- `c = m["tool_calls"][0]["function"]` 只取第一个调用,够今天用。并行调用多个工具时(Day 162)要遍历,留作改进。
- `return f"assistant: (调用工具 {c['name']},参数 {c['arguments']})"` 比如 `assistant: (调用工具 find_customer,参数 {"query": "星河记账"})`。比「(调用了工具)」信息多,总结的模型能看出当时查了谁。
- `return f"{m['role']}: {m.get('content') or ''}"` 其他消息是 `角色: 内容`,`tool` 消息的内容就是 JSON 原文。
- `def compact(client: LLMClient, messages: list[dict[str, Any]], keep_last_turns: int = 3,` 三个参数:`keep_last_turns` 最近几轮保留原文,默认 3。
- `trigger_tokens: int = 3000, prompt: str = SUMMARY_PROMPT) -> list[dict[str, Any]]:` `trigger_tokens` 超过多少才压缩;`prompt` 能换摘要提示词,下面做实验要用。
- `if sum(message_tokens(m) for m in messages) <= trigger_tokens:` 总量没超就什么都不做。演示数据 16 条共 734 token,默认的 3000 远没到。
- `return messages  # 没超就原样返回` 返回的就是传进来的**同一个列表**,连拷贝都没做,没超时零成本,这个函数可以每一轮都先调一下。
- `summaries = [m for m in messages if is_summary(m)]` 挑出旧摘要。第一次压缩时是空列表。
- `system = [m for m in messages if m["role"] == "system" and not is_summary(m)]` 真正的 system(人设和规则),不含摘要。
- `turns = split_turns([m for m in messages if m["role"] != "system"])` 去掉所有 system 消息,剩下的按轮切。演示数据切出 5 轮。
- `if len(turns) <= keep_last_turns:` 总轮数不比要保留的多,没有「较早的」可压。
- `return messages  # 轮数不够` 原样返回。
- `cut = len(turns) - keep_last_turns` 前 `cut` 轮压缩,后面的留原文。`keep_last_turns=2` 时 `cut = 3`。写成「总数减去保留数」,而不是 `turns[:-keep_last_turns]`,是为了避开 `-0` 的坑:`keep_last_turns=0` 时 `[:-0]` 是空列表,变成「什么都不压」,和「全压」相反。
- `old = [m for turn in turns[:cut] for m in turn]` 前 3 轮摊平成消息列表,12 条:三个 user、三次调用、三个结果、三个回答。
- `recent = [m for turn in turns[cut:] for m in turn]` 后 2 轮摊平:第 4 轮的 user 和 assistant,加上第 5 轮的 user,共 3 条。
- `lines = [s["content"] for s in summaries] + [render(m) for m in old]` 旧摘要排在最前面,然后是每条旧消息的一行文字。第一次压缩没有旧摘要,`lines` 就是 12 行。
- `reply = client.chat([{"role": "system", "content": prompt},` 总结的调用:system 放摘要提示词。
- `{"role": "user", "content": "\n".join(lines)}], temperature=0)` user 放整段旧对话,用换行连起来。`temperature=0` 让摘要尽量稳定。
- `note = {"role": "system", "content": f"{SUMMARY_TAG}\n{reply.content}"}` 摘要包成一条 system 消息,开头带标签。
- `return [*system, note, *recent]` 拼回去:真 system、摘要、最近几轮原文。演示数据:1 + 1 + 3 = 5 条。

</div>

演示一次。新建 `part04/compaction_demo.py`:

```python
# agent-zero-lab/part04/compaction_demo.py  压缩一次、再压缩一次,看摘要长什么样、消息变成什么
from common.llm import LLMClient
from part04.compaction import compact, is_summary
from part04.convo import CONVO, QUESTION, SYSTEM_LINE
from part04.ctx_budget import message_tokens

client = LLMClient()
messages = [{"role": "system", "content": SYSTEM_LINE}, *CONVO, {"role": "user", "content": QUESTION}]
total = sum(message_tokens(m) for m in messages)
print(f"压缩前:{len(messages)} 条,{total} token")

same = compact(client, messages)  # 默认 trigger_tokens=3000,远没到
print("默认阈值 3000:原样返回?", same is messages, "  调用模型次数:", client.ledger.calls)

once = compact(client, messages, keep_last_turns=2, trigger_tokens=100)
print(f"\n压缩后:{len(once)} 条,{sum(message_tokens(m) for m in once)} token,调用模型 {client.ledger.calls} 次")
print([m["role"] if not is_summary(m) else "摘要" for m in once])
print(once[1]["content"])

# 再聊两轮,再压一次
more = [*once,
        {"role": "assistant", "content": "理解您的心情,我先帮您把导入问题记下来转给技术同事。方便发一份出问题的文件吗?"},
        {"role": "user", "content": "文件是 2026 年 9 月的招商银行流水,CSV 格式。你们尽快给个说法。"}]
twice = compact(client, more, keep_last_turns=1, trigger_tokens=100)
print(f"\n再压一次:{len(twice)} 条,摘要 {sum(is_summary(m) for m in twice)} 条")
print(twice[1]["content"])
print(client.ledger)
```

<div class="line-notes">

- `from part04.compaction import compact, is_summary` 取压缩函数。
- `from part04.convo import CONVO, QUESTION, SYSTEM_LINE` 取那段手写对话。
- `messages = [{"role": "system", "content": SYSTEM_LINE}, *CONVO, {"role": "user", "content": QUESTION}]` 1 条 system、14 条对话、1 条新问题,共 16 条。
- `total = sum(message_tokens(m) for m in messages)` 总量,734。
- `print(f"压缩前:` 打印条数和 token。
- `same = compact(client, messages)` 用默认的阈值 3000。
- `print("默认阈值 3000:原样返回?", same is messages,` `is` 判断是不是同一个对象。`True` 说明函数在没超阈值时返回了原列表本身。`client.ledger.calls` 是 0,没调模型。
- `once = compact(client, messages, keep_last_turns=2, trigger_tokens=100)` 为了看到效果,把阈值压到 100,保留最近 2 轮。
- `print(f"\n压缩后:` 打印条数、token、调用次数。
- `print([m["role"] if not is_summary(m) else "摘要" for m in once])` 看结构:把摘要那条标成「摘要」。
- `print(once[1]["content"])` 摘要原文,在下标 1(system 之后)。
- `more = [*once,` 在压缩过的列表后面再接两条:assistant 一句安抚,用户补充信息。
- `{"role": "assistant", "content": "理解您的心情,` 新增的 assistant。
- `{"role": "user", "content": "文件是` 新增的 user。
- `twice = compact(client, more, keep_last_turns=1, trigger_tokens=100)` 再压一次,这次只留最后一轮。旧摘要会和被压的几轮合并。
- `print(f"\n再压一次:` 打印条数和摘要个数。
- `print(twice[1]["content"])` 新摘要。
- `print(client.ledger)` 两次压缩的总账。

</div>

```bash
uv run python -m part04.compaction_demo
```

实跑输出:

```text
压缩前:16 条,734 token
默认阈值 3000:原样返回? True   调用模型次数: 0

压缩后:5 条,245 token,调用模型 1 次
['system', '摘要', 'user', 'assistant', 'user']
【之前对话的摘要】
星河记账（C-0001，ops@xinghe.example）为年付企业版、10席位，现反映导入招商银行流水持续报E1043，已建议另存为CSV UTF-8或上传XLSX，客户改用XLSX后仍报错，已请其提供完整报错文字，问题未解决。客户提出本月席位由10增至15，已告知按剩余月数补差价；又提出下月起降级为专业版并询问年付退款金额，已告知按剩余整月比例退款、已用及当前月份不退，需提交退款申请由主管审批。

再压一次:3 条,摘要 1 条
【之前对话的摘要】
星河记账（C-0001，ops@xinghe.example）年付企业版10席位，导入招行流水报E1043，改XLSX仍报错，已请其提供完整报错文字及问题文件转技术，未解决；客户不满，质疑系统。客户问招行导出能否选UTF-8，已告知一般GBK，需Excel另存CSV UTF-8。客户提出本月席位10增至15，已告知按剩余月数补差价；又提出下月起降专业版并询问年付退款，已告知按剩余整月比例退、已用及当前月不退，需提交申请主管审批；客户表示先不提交，再想想。
2 次调用 | 输入 1084 / 输出 283 tokens | 约 ¥0.0034
```

**第一次压缩**:16 条 734 token 压成 5 条 245 token。结构是 `system、摘要、user、assistant、user`:摘要替换了前 3 轮的 12 条消息,第 4 轮和第 5 轮原样保留。摘要只有两句话,两百来字,「星河记账、年付企业版、10 席位」都在,「E1043 没解决」「想降级专业版」「已告知按剩余整月比例退」也在。

**第二次压缩**:5 条加新增的 2 条,压成 3 条:system、摘要、最后一个 user。摘要仍然只有 **1 条**,不是 2 条:旧摘要被合并进新摘要。新摘要里多出了「客户不满」「客户表示先不提交」,这两件事第一次摘要里没有,因为当时它们在被保留的原文里。

两次压缩一共 2 次调用,输入 1084、输出 283 个 token,花 ¥0.0034。

<figure>
<svg viewBox="0 0 640 230" role="img" aria-label="总结压缩前后对比:前三轮 12 条消息被一条摘要替换,最近两轮保留原文">
<rect x="0" y="0" width="640" height="230" fill="var(--paper-raised)"/>
<g font-family="var(--font-mono)" font-size="12">
<text x="20" y="26" fill="var(--ink-soft)">压缩前 16 条 / 734 token</text>
<rect x="20" y="36" width="44" height="34" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="42" y="58" text-anchor="middle" fill="var(--ink)">sys</text>
<rect x="68" y="36" width="150" height="34" fill="none" stroke="var(--ink-soft)"/>
<text x="143" y="58" text-anchor="middle" fill="var(--ink)">第 1 轮 4 条</text>
<rect x="222" y="36" width="150" height="34" fill="none" stroke="var(--ink-soft)"/>
<text x="297" y="58" text-anchor="middle" fill="var(--ink)">第 2 轮 4 条</text>
<rect x="376" y="36" width="150" height="34" fill="none" stroke="var(--ink-soft)"/>
<text x="451" y="58" text-anchor="middle" fill="var(--ink)">第 3 轮 4 条</text>
<rect x="530" y="36" width="44" height="34" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="552" y="58" text-anchor="middle" fill="var(--ink)">T4</text>
<rect x="578" y="36" width="42" height="34" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="599" y="58" text-anchor="middle" fill="var(--ink)">T5</text>
<line x1="68" y1="84" x2="526" y2="84" stroke="var(--ink-faint)"/>
<text x="297" y="104" text-anchor="middle" fill="var(--ink-soft)">交给模型总结(一次调用)</text>
<line x1="297" y1="110" x2="297" y2="130" stroke="var(--ink-faint)"/>
<text x="20" y="152" fill="var(--ink-soft)">压缩后 5 条 / 245 token</text>
<rect x="20" y="162" width="44" height="34" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="42" y="184" text-anchor="middle" fill="var(--ink)">sys</text>
<rect x="68" y="162" width="300" height="34" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="218" y="184" text-anchor="middle" fill="var(--ink)">摘要:一条 system 消息</text>
<rect x="372" y="162" width="44" height="34" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="394" y="184" text-anchor="middle" fill="var(--ink)">T4</text>
<rect x="420" y="162" width="44" height="34" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="442" y="184" text-anchor="middle" fill="var(--ink)">T4</text>
<rect x="468" y="162" width="44" height="34" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="490" y="184" text-anchor="middle" fill="var(--ink)">T5</text>
<text x="20" y="218" fill="var(--ink-faint)" font-size="11">琥珀 = 保留原文的最近 2 轮(T4 两条、T5 一条)。T 是 turn,轮的意思</text>
</g>
</svg>
<figcaption>keep_last_turns=2 时的压缩:前三轮 12 条消息整体换成一条摘要,最近两轮原样保留,所以工具调用和结果不会被拆开。</figcaption>
</figure>

### 摘要放在 system 里,为什么

摘要用 `system` 角色,放在真正的 system 消息后面。这是常见做法,好处是模型把它当作「背景」而不是「刚才有人说了这句话」。也有人把摘要放进一条 `user` 消息里,效果没有统一结论,我没有对比过。重要的是**位置固定、有标签、能被下次压缩认出来**。

要提醒一点:压缩会改变前缀。Day 262 讲过,固定内容放最前面,缓存才命中;摘要一变,摘要后面的全部内容缓存都失效,下一步按未命中的价钱付一次。练习 3 会算这笔账。

## 第三步:压缩得好不好,要量

旧课里我写过一句:「我最初只写了『总结一下这段对话』,结果模型总结得很流畅,但把『用户是年付』这种关键信息当成细节省略了,压缩后 Agent 开始答错。」今天重新测一遍这句话,在 deepseek-flash 上、用我们这段对话。

做法:

1. 列七条「摘要里必须有」的事实:公司名、企业版、年付、10 个席位、报错码 E1043、要降级、招商银行。每条写一个正则(宽一点,模型常把「招商银行」缩成「招行」)。
2. 压缩 5 次,数每次摘要里有几条事实;再往压缩后的历史里追加一个**只有早期对话才答得出**的问题:「我们现在是什么套餐来着?几个席位?」,看回答里有没有「年付」「企业」「10」。
3. 两种摘要提示词对比:「随手总结」就是 `总结一下这段对话。`;「列清保留项」就是 `SUMMARY_PROMPT`。

新建 `part04/compaction_eval.py`:

```python
# agent-zero-lab/part04/compaction_eval.py  压缩得好不好,要量:摘要里保住了几条关键事实,压缩后答不答得对依赖早期信息的问题
import re
import sys

from common.llm import LLMClient
from part04.compaction import SUMMARY_PROMPT, compact
from part04.convo import CONVO, SYSTEM_LINE
from part04.ctx_blocks import make_history

NAIVE_PROMPT = "总结一下这段对话。"
RUNS = 5

# 摘要里应该留下的七条事实。每条是一个正则,写宽一点(「招商银行」常被缩成「招行」)
FACTS = {"公司": r"星河", "企业版": r"企业版", "年付": r"年付", "10 个席位": r"10\s*(个)?席", "报错码": r"E1043",
         "要降级": r"降级|专业版", "招商银行": r"招"}
PROBE = "对了,我们现在是什么套餐来着?几个席位?"  # 答案只在被压缩掉的早期对话里

if __name__ == "__main__":
    noise = int(sys.argv[1]) if len(sys.argv) > 1 else 0  # 在那四轮后面再接几十轮不相干的闲聊,让关键事实被埋得更深
    client = LLMClient()
    base = [{"role": "system", "content": SYSTEM_LINE}, *CONVO, *make_history(noise)]
    keep = 1 if noise == 0 else 3
    print(f"对话 {len(base)} 条,保留最近 {keep} 轮原文,其余压缩")

    for name, prompt in (("随手总结", NAIVE_PROMPT), ("列清保留项", SUMMARY_PROMPT)):
        kept_counts, lengths, right = [], [], 0
        for _ in range(RUNS):
            compacted = compact(client, base, keep_last_turns=keep, trigger_tokens=100, prompt=prompt)
            summary = compacted[1]["content"]
            kept_counts.append(sum(bool(re.search(p, summary)) for p in FACTS.values()))
            lengths.append(len(summary))
            answer = client.chat([*compacted, {"role": "user", "content": PROBE}], temperature=0).content
            right += bool(re.search(r"年付", answer) and re.search(r"企业", answer) and re.search(r"10", answer))
        print(f"{name}: 摘要保住 {kept_counts}(满分 {len(FACTS)}),摘要长 {lengths} 字;答对套餐和席位 {right}/{RUNS}")
    print(client.ledger)
```

<div class="line-notes">

- `import re` 正则。
- `import sys` 读命令行参数。
- `from part04.compaction import SUMMARY_PROMPT, compact` 取压缩函数和那份详细的提示词。
- `from part04.ctx_blocks import make_history` Day 262 造的假历史,这里当「不相干的闲聊」往后面接,把早期的关键事实埋得更深。
- `NAIVE_PROMPT = "总结一下这段对话。"` 随手写的那版。
- `RUNS = 5` 每种提示词压 5 次。单次没有意义,上面 Day 262 已经看到,同一份输入结果会变。
- `FACTS = {` 七条事实,键是名字,值是正则。「招商银行」那条写成 `r"招"`,宽松到只要出现「招」字就算(「招商」「招行」都算)。「要降级」写成 `降级|专业版`,`|` 表示或。
- `PROBE = "对了,我们现在是什么套餐来着?几个席位?"` 压缩后追加的问题,答案只在被压缩掉的早期对话里。
- `noise = int(sys.argv[1]) if len(sys.argv) > 1 else 0` 命令行第一个参数是要接多少轮闲聊,默认 0。
- `base = [{"role": "system", "content": SYSTEM_LINE}, *CONVO, *make_history(noise)]` 1 条 system、14 条对话,加 `noise` 轮闲聊。`noise=0` 时共 15 条,`noise=20` 时共 67 条。
- `keep = 1 if noise == 0 else 3` 没有闲聊时只保留最后 1 轮,有闲聊时保留最近 3 轮(都是闲聊)。这样早期那 4 轮的关键事实**一定**在被压缩的部分里。
- `for name, prompt in (("随手总结", NAIVE_PROMPT), ("列清保留项", SUMMARY_PROMPT)):` 两种提示词各做一遍。
- `kept_counts, lengths, right = [], [], 0` 三个统计量:每次保住几条事实、摘要多少字、答对几次。
- `for _ in range(RUNS):` 循环 5 次。`_` 表示循环变量不用。
- `compacted = compact(client, base, keep_last_turns=keep, trigger_tokens=100, prompt=prompt)` 压缩。`trigger_tokens=100` 让它必然触发。
- `summary = compacted[1]["content"]` 摘要在下标 1。
- `kept_counts.append(sum(bool(re.search(p, summary)) for p in FACTS.values()))` 每条正则搜一遍摘要,搜到了是 `True`,`bool(...)` 把匹配对象变成真假,`sum` 数出几条。
- `lengths.append(len(summary))` 摘要的字数,含开头的标签 10 个字。
- `answer = client.chat([*compacted, {"role": "user", "content": PROBE}], temperature=0).content` 往压缩后的历史追加问题,取回答。
- `right += bool(` 回答里同时有「年付」「企业」「10」才算答对。
- `print(f"{name}: 摘要保住` 打印每次保住的条数、每次的字数和答对次数。

</div>

```bash
uv run python -m part04.compaction_eval 0
uv run python -m part04.compaction_eval 20
```

实跑输出(第一个命令,只有那四轮):

```text
对话 15 条,保留最近 1 轮原文,其余压缩
随手总结: 摘要保住 [6, 7, 6, 6, 6](满分 7),摘要长 [530, 795, 431, 662, 712] 字;答对套餐和席位 5/5
列清保留项: 摘要保住 [7, 7, 7, 7, 7](满分 7),摘要长 [217, 213, 224, 227, 224] 字;答对套餐和席位 5/5
20 次调用 | 输入 10363 / 输出 3101 tokens | 约 ¥0.0355
```

第二个命令,四轮之后接 20 轮闲聊(67 条消息):

```text
对话 67 条,保留最近 3 轮原文,其余压缩
随手总结: 摘要保住 [6, 7, 6, 7, 6](满分 7),摘要长 [1061, 984, 1136, 1079, 1153] 字;答对套餐和席位 5/5
列清保留项: 摘要保住 [7, 7, 7, 7, 7](满分 7),摘要长 [217, 237, 235, 231, 234] 字;答对套餐和席位 5/5
20 次调用 | 输入 36948 / 输出 5046 tokens | 约 ¥0.0704
```

**结果和我的预期不一样。** 两种提示词压缩后都能答对套餐和席位,两个命令加起来每种 10 次,20 次全对,「随手总结」没有把「年付」当细节省略。旧课里那句话,至少在这个模型、这段对话上,不成立。事实上这个现象本身值得记一笔:**别人的经验、旧文章里的结论,换一个模型就可能不对,要自己量**。

但两种提示词不是没有差别,差别在两处:

- **保住的事实**:随手总结 6~7 条(满分 7),列清保留项每次都是 7 条。漏的是哪条,我没有逐次去看,猜是「招商银行」或「要降级」这类不在「身份信息」里的细节。这是猜测。
- **摘要长度**:随手总结 430~800 字,埋了 20 轮闲聊后涨到 1000 多字,而且带 Markdown 的编号和加粗;列清保留项稳定在 210~240 字。摘要本身要占上下文,1000 字约 700 个 token,下一步、再下一步都要带着它。我们花了一次调用压缩,是为了省 token,不是为了换一份更长的摘要。

所以「列清保留项」的价值不在这一次答对了,而在**稳**:该留的每次都留,长度可控。

还有一个坑在评估本身:`FACTS` 里的正则要写宽。看第二次压缩的摘要(上面的演示)把「招商银行」写成了「招行」,如果我的正则写成 `招商银行`,就会把一份没问题的摘要判成丢了信息。反过来,正则写得太宽(比如 `10` 单独当一条),会被日期里的 `2026-10` 蒙混过关。我的 `10\s*(个)?席` 是在这两头之间找的平衡。

Factory 公司发过一篇 [Evaluating Context Compression for AI Agents](https://factory.ai/news/evaluating-compression),他们的做法值得借鉴:压缩后不去比摘要和原文像不像(ROUGE 之类),而是**往压缩后的上下文里问问题**,看 Agent 答得对不对,问题分四类:回忆具体细节、追踪改了哪些文件、能否接着干、能否解释决策原因。这和我们的 `PROBE` 是同一个思路,只是他们做得更全。我没有复现他们的结果,这里只借思路。

## 今天的文件

| 文件 | 作用 |
| --- | --- |
| `part04/tool_clearing.py` | `clear_old_tool_results`:旧的大块工具结果换成占位,不调模型 |
| `part04/tool_clearing_demo.py` | 清理前后对比:token、成对检查、模型还能不能答 |
| `part04/convo.py` | 手写的五轮客服对话,`call`/`result` 两个造消息的小函数 |
| `part04/compaction.py` | `compact`:超阈值才压缩,旧摘要并入新摘要,最近几轮留原文 |
| `part04/compaction_demo.py` | 压缩一次、再压缩一次 |
| `part04/compaction_eval.py` | 七条事实打分 + 追问只有早期对话才答得出的问题 |

## 动手练习

先自己做,做不出来再展开参考答案。

### 练习 1:keep_recent 取不同的值

`keep_recent` 分别取 0、1、2、5、8、20,对 `make_history(24)` 看清掉几条、token 怎么变。再单独验证:为什么不能直接写 `tool_idx[:-keep_recent]`?

<details><summary>参考答案</summary>

新建 `part04/ex263_1.py`:

```python
# agent-zero-lab/part04/ex263_1.py  练习 1:keep_recent 取 0、1、2、5,清理掉几条、省多少;再看「[:-0]」那个坑
from part04.ctx_blocks import make_history
from part04.ctx_budget import message_tokens
from part04.tool_clearing import PLACEHOLDER, clear_old_tool_results

history = make_history(24)  # 8 次工具调用
before = sum(message_tokens(m) for m in history)
for keep in (0, 1, 2, 5, 8, 20):
    cleaned = clear_old_tool_results(history, keep_recent=keep)
    after = sum(message_tokens(m) for m in cleaned)
    n = sum(m.get("content") == PLACEHOLDER for m in cleaned)
    print(f"keep_recent={keep:>2}: 清掉 {n} 条,{before} → {after} token")

idx = [3, 5, 7, 9]
print("\n[:-2] =", idx[:-2], "  [:-0] =", idx[:-0], "  [:len(idx) - 0] =", idx[:len(idx) - 0])
```

<div class="line-notes">

- `history = make_history(24)` 24 轮历史,里面有 8 次工具调用。
- `before = sum(message_tokens(m) for m in history)` 清理前的总数 3176。
- `for keep in (0, 1, 2, 5, 8, 20):` 六种保留数。8 刚好等于工具调用的总次数,20 比总次数还多。
- `cleaned = clear_old_tool_results(history, keep_recent=keep)` 清理。
- `after = sum(message_tokens(m) for m in cleaned)` 清理后的总数。
- `n = sum(m.get("content") == PLACEHOLDER for m in cleaned)` 数内容等于占位的消息有几条,就是被清理的条数。
- `print(f"keep_recent={keep:>2}:` 打印。`:>2` 右对齐宽 2,让 0 和 20 对齐。
- `idx = [3, 5, 7, 9]` 一个假的下标列表,代表 4 条 tool 消息的位置。
- `print("\n[:-2] =", idx[:-2],` 同一个列表上三种切片:`[:-2]` 去掉最后两个,得到 `[3, 5]`;`[:-0]` 因为 `-0` 就是 `0`,等于 `[:0]`,是空列表;`[:len(idx) - 0]` 才是想要的「去掉最后 0 个」,得到整个列表。

</div>

```bash
uv run python -m part04.ex263_1
```

实跑输出:

```text
keep_recent= 0: 清掉 8 条,3176 → 1712 token
keep_recent= 1: 清掉 7 条,3176 → 1895 token
keep_recent= 2: 清掉 6 条,3176 → 2078 token
keep_recent= 5: 清掉 3 条,3176 → 2627 token
keep_recent= 8: 清掉 0 条,3176 → 3176 token
keep_recent=20: 清掉 0 条,3176 → 3176 token

[:-2] = [3, 5]   [:-0] = []   [:len(idx) - 0] = [3, 5, 7, 9]
```

每清一条省约 183 个 token(一条 206 减去占位的 23)。`keep_recent=8` 等于总次数,一条都不清;`keep_recent=20` 也一样。最后一行就是那个坑:`idx[:-0]` 是 `[]`,如果 `clear_old_tool_results` 里写 `tool_idx[:-keep_recent]`,传 `keep_recent=0` 时会「一条都不清」,而参数的意思是「一个原文都不保留」,正好反了。这种 bug 不会报错,只是省的 token 没省下来,很难发现。我在写旧课的时候就踩过。

</details>

### 练习 2:摘要字数上限换成 50、100、200、400

在 `convo[4]`(第 2 轮客户那句话)后面追加一个路过提的细节:「以后发票抬头请写成『星河科技(上海)有限公司』」。把 `SUMMARY_PROMPT` 里的「不超过 200 字」分别换成 50、100、200、400,每个压 5 次,数摘要的实际长度,以及八条事实(原来七条加这条新抬头)保住几条。

<details><summary>参考答案</summary>

新建 `part04/ex263_2.py`:

```python
# agent-zero-lab/part04/ex263_2.py  练习 2:摘要限制的字数越小越省,又会丢多少?字数上限换成 50、100、200、400 各压 5 次
import re

from common.llm import LLMClient
from part04.compaction import SUMMARY_PROMPT, compact
from part04.compaction_eval import FACTS
from part04.convo import CONVO, SYSTEM_LINE

client = LLMClient()
convo = [dict(m) for m in CONVO]  # 复制一份,别改原来的
convo[4]["content"] += "对了,以后发票抬头请写成「星河科技(上海)有限公司」,别用旧的名字。"
base = [{"role": "system", "content": SYSTEM_LINE}, *convo]
facts = {**FACTS, "新抬头": r"星河科技"}  # 7 条老事实加上这条路过提的,共 8 条

for limit in (50, 100, 200, 400):
    prompt = SUMMARY_PROMPT.replace("不超过 200 字", f"不超过 {limit} 字")
    counts, lengths = [], []
    for _ in range(5):
        summary = compact(client, base, keep_last_turns=1, trigger_tokens=100, prompt=prompt)[1]["content"]
        counts.append(sum(bool(re.search(p, summary)) for p in facts.values()))
        lengths.append(len(summary))
    print(f"上限 {limit:>3} 字: 实际长 {min(lengths)}~{max(lengths)} 字,保住 {counts}(满分 {len(facts)}),平均 {sum(counts) / 5:.1f}")
```

<div class="line-notes">

- `convo = [dict(m) for m in CONVO]` 复制一份,每条消息都 `dict(m)` 浅拷贝一次。因为下一行要改其中一条,不能改到 `CONVO` 本身,不然后面的脚本都被污染。
- `convo[4]["content"] += "对了,以后发票抬头请写成「星河科技(上海)有限公司」,别用旧的名字。"` 下标 4 是第 2 轮的 user 消息,在末尾追加一句。`+=` 对字符串是拼接。
- `base = [{"role": "system", "content": SYSTEM_LINE}, *convo]` 拼上 system。
- `facts = {**FACTS, "新抬头": r"星河科技"}` 字典展开再加一个键,共 8 条事实。
- `for limit in (50, 100, 200, 400):` 四种上限。
- `prompt = SUMMARY_PROMPT.replace("不超过 200 字", f"不超过 {limit} 字")` 字符串替换,生成这一档的提示词。
- `counts, lengths = [], []` 每次保住几条、每次多长。
- `for _ in range(5):` 每档 5 次。
- `summary = compact(client, base, keep_last_turns=1, trigger_tokens=100, prompt=prompt)[1]["content"]` 压缩,直接取摘要那条的内容。
- `counts.append(sum(bool(re.search(p, summary)) for p in facts.values()))` 数保住的条数。
- `lengths.append(len(summary))` 摘要字数,含标签 10 个字。
- `print(f"上限 {limit:>3} 字:` 打印最短到最长的字数、五次的条数和平均。

</div>

```bash
uv run python -m part04.ex263_2
```

实跑输出:

```text
上限  50 字: 实际长 69~127 字,保住 [7, 8, 8, 8, 8](满分 8),平均 7.8
上限 100 字: 实际长 123~141 字,保住 [8, 8, 8, 8, 8](满分 8),平均 8.0
上限 200 字: 实际长 208~261 字,保住 [8, 8, 8, 8, 8](满分 8),平均 8.0
上限 400 字: 实际长 315~336 字,保住 [8, 8, 8, 8, 8](满分 8),平均 8.0
```

两个发现。第一,**字数上限只是建议**:要 50 字,实际给了 69 到 127 字(含标签 10 个字,仍然超);要 200 字,给 208 到 261。别指望提示词里的数字能卡死长度,真要卡就在代码里截断、或者超了重来一次。第二,在这段短对话里,字数压到 50 字也只丢了一次事实(5 次里有 1 次是 7 条),几乎没影响。这并不说明 50 字够用:对话里的信息量太小,八条事实压成一句话也塞得下。换成一段长得多、事实多得多的真实对话,结果会不同。**要验证自己的场景,得用自己的对话和自己的事实清单。**

</details>

### 练习 3:压缩一次到底划不划算

对「4 轮手写对话 + 20 轮闲聊」(67 条)压缩一次(保留最近 3 轮),算:压缩本身花多少钱、压缩后每一步省多少、几步回本。分「以后每步都没缓存」和「以前每步都全命中缓存」两种情况算,再考虑「压缩改了前缀,缓存会失效」。

<details><summary>参考答案</summary>

新建 `part04/ex263_3.py`:

```python
# agent-zero-lab/part04/ex263_3.py  练习 3:压缩一次花多少钱,每一步省多少,几步回本?分「没缓存」和「全命中缓存」两种算
from common.llm import LLMClient
from part04.compaction import compact
from part04.convo import CONVO, SYSTEM_LINE
from part04.ctx_blocks import make_history
from part04.ctx_budget import message_tokens

HIT, MISS = 0.04, 2.0  # 元 / 百万输入 token

client = LLMClient()
base = [{"role": "system", "content": SYSTEM_LINE}, *CONVO, *make_history(20)]
compacted = compact(client, base, keep_last_turns=3, trigger_tokens=100)
before = sum(message_tokens(m) for m in base)
after = sum(message_tokens(m) for m in compacted)
ledger = client.ledger
print(f"压缩前 {len(base)} 条 {before} token → 压缩后 {len(compacted)} 条 {after} token,少 {before - after}")
print(f"这次压缩本身:输入 {ledger.prompt_tokens} 输出 {ledger.completion_tokens} token,花 ¥{ledger.cost:.4f}")
for name, price in (("以后每步都没缓存", MISS), ("以前每步都全命中缓存", HIT)):
    saved = (before - after) * price / 1_000_000
    print(f"{name}: 每步省 ¥{saved:.5f},{ledger.cost / saved:.1f} 步回本")
extra = after * (MISS - HIT) / 1_000_000
print(f"但压缩改了前缀,压缩后第一步缓存全部失效,一次性多付 ¥{extra:.5f}")
```

<div class="line-notes">

- `HIT, MISS = 0.04, 2.0` 缓存命中价和未命中价,元每百万 token。
- `base = [{"role": "system", "content": SYSTEM_LINE}, *CONVO, *make_history(20)]` 67 条消息。
- `compacted = compact(client, base, keep_last_turns=3, trigger_tokens=100)` 压缩一次,这是唯一一次调用模型。
- `before = sum(message_tokens(m) for m in base)` 压缩前 3198。
- `after = sum(message_tokens(m) for m in compacted)` 压缩后 582。
- `ledger = client.ledger` 这个客户端只调了一次模型,账本上就是压缩本身的花费。
- `print(f"压缩前 {len(base)} 条` 少了 2616 个 token。
- `print(f"这次压缩本身:` 输入 2880、输出 160,合计 ¥0.0018:输入 2880 × 2 / 百万 = 0.00576,输出 160 × 8 / 百万 = 0.00128,两项加起来 0.00704,这个数比账本上的 ¥0.0018 大得多,说明 2880 个输入 token 绝大部分命中了缓存(前面的脚本刚发过同样的内容),按 0.04 算。
- `for name, price in (("以后每步都没缓存", MISS), ("以前每步都全命中缓存", HIT)):` 两种情景,价格不同。
- `saved = (before - after) * price / 1_000_000` 每一步少付的钱:没缓存时是 2616 × 2 / 百万 = ¥0.00523;全命中时是 2616 × 0.04 / 百万 = ¥0.000105。
- `print(f"{name}: 每步省` `ledger.cost / saved` 就是回本的步数:0.0018 / 0.00523 = 0.3 步;0.0018 / 0.000105 = 16.9 步。
- `extra = after * (MISS - HIT) / 1_000_000` 压缩改了前缀,压缩后第一步这 582 个 token 都不命中缓存,每个多付 1.96 元每百万,一共一次性多付 ¥0.00114。
- `print(f"但压缩改了前缀,` 打印这笔一次性的额外开销。

</div>

```bash
uv run python -m part04.ex263_3
```

实跑输出:

```text
压缩前 67 条 3198 token → 压缩后 10 条 582 token,少 2616
这次压缩本身:输入 2880 输出 160 token,花 ¥0.0018
以后每步都没缓存: 每步省 ¥0.00523,0.3 步回本
以前每步都全命中缓存: 每步省 ¥0.00010,16.9 步回本
但压缩改了前缀,压缩后第一步缓存全部失效,一次性多付 ¥0.00114
```

没有缓存的情况下,压缩一次只要 0.3 步就回本,几乎是白赚。但 Agent 的正常状态是**前缀大部分命中缓存**。那时每步只省 ¥0.0001,加上压缩本身的 ¥0.0018 和失效缓存的一次性 ¥0.0011,总共要多付约 ¥0.0029,要 28 步才回本。这就是说:在缓存做得好的 Agent 里,**压缩主要不是为了省钱,是为了不撑爆窗口、让模型注意力集中、让每一步更快**。Manus 在他们的 [博客](https://manus.im/blog/Context-Engineering-for-AI-Agents-Lessons-from-Building-Manus) 里把 KV 缓存命中率称作生产级 Agent 最重要的指标,所以他们倾向「只追加、不改前缀」;它和「压缩要改前缀」是矛盾的,这也是为什么压缩的触发阈值不要设得太低:**到了不压就要出问题的时候再压**,而且一次压狠一点,别每几步压一回。

注意压缩本身的 ¥0.0018 是偏乐观的:那段 2880 token 的输入绝大部分命中了缓存(前面刚发过同样的内容),第一次发的话没有命中,会是 ¥0.007 上下。

</details>

### 练习 4:两档叠起来

写一个 `shrink(client, messages)`:先 `clear_old_tool_results`(保留最近 2 个),清完如果还超过 3000 token,再 `compact`(保留最近 5 轮)。对 `make_history(24)` 和 `make_history(40)` 各跑一次,看各走到哪一档。

<details><summary>参考答案</summary>

新建 `part04/ex263_4.py`:

```python
# agent-zero-lab/part04/ex263_4.py  练习 4:两档叠起来用,先清工具结果,还超再总结。24 轮和 40 轮各会走到哪一档?
from typing import Any

from common.llm import LLMClient
from part04.compaction import compact
from part04.convo import SYSTEM_LINE
from part04.ctx_blocks import make_history
from part04.ctx_budget import message_tokens
from part04.tool_clearing import clear_old_tool_results

TRIGGER = 3000


def tokens(messages: list[dict[str, Any]]) -> int:
    return sum(message_tokens(m) for m in messages)


def shrink(client: LLMClient, messages: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """先零成本的清理旧工具结果;清完还超,再花一次模型调用做摘要。"""
    step1 = clear_old_tool_results(messages, keep_recent=2)
    print(f"  清理工具结果:{tokens(messages)} → {tokens(step1)}")
    if tokens(step1) <= TRIGGER:
        print("  已经够了,不用总结")
        return step1
    step2 = compact(client, step1, keep_last_turns=5, trigger_tokens=TRIGGER)
    print(f"  总结压缩:{tokens(step1)} → {tokens(step2)},{len(step1)} 条 → {len(step2)} 条")
    return step2


client = LLMClient()
for turns in (24, 40):
    print(f"{turns} 轮历史:")
    shrink(client, [{"role": "system", "content": SYSTEM_LINE}, *make_history(turns)])
print("总共调用模型", client.ledger.calls, "次,花", f"¥{client.ledger.cost:.4f}")
```

<div class="line-notes">

- `TRIGGER = 3000` 阈值,写成常量,清理后和压缩共用。
- `def tokens(messages: list[dict[str, Any]]) -> int:` 小工具函数,反复用到的求和抽出来。
- `return sum(message_tokens(m) for m in messages)` 一行求和。
- `def shrink(client: LLMClient, messages: list[dict[str, Any]]) -> list[dict[str, Any]]:` 两档叠起来。
- `step1 = clear_old_tool_results(messages, keep_recent=2)` 第一档,零成本。
- `print(f"  清理工具结果:{tokens(messages)} → {tokens(step1)}")` 24 轮:3191 → 2093;40 轮:5232 → 3219。
- `if tokens(step1) <= TRIGGER:` 清完够了就不往下走。24 轮的 2093 小于 3000。
- `print("  已经够了,不用总结")` 提示。
- `return step1` 直接返回,没调模型。
- `step2 = compact(client, step1, keep_last_turns=5, trigger_tokens=TRIGGER)` 第二档,只有第一档不够才走到这里。这里 `trigger_tokens` 传同一个 3000,`compact` 里还会自己判断一次,不会重复触发。
- `print(f"  总结压缩:` 40 轮:3219 → 831,107 条消息变成 16 条。
- `return step2` 返回压缩后的。
- `client = LLMClient()` 一个客户端,用它的账本数总共调了几次模型。
- `for turns in (24, 40):` 两个长度。
- `print(f"{turns} 轮历史:")` 打印标题。
- `shrink(client, [{"role": "system", "content": SYSTEM_LINE}, *make_history(turns)])` 加上 system 再调。
- `print("总共调用模型", client.ledger.calls, "次,花", f"¥{client.ledger.cost:.4f}")` 总共 1 次(只有 40 轮那个走到第二档),¥0.0057。

</div>

```bash
uv run python -m part04.ex263_4
```

实跑输出:

```text
24 轮历史:
  清理工具结果:3191 → 2093
  已经够了,不用总结
40 轮历史:
  清理工具结果:5232 → 3219
  总结压缩:3219 → 831,107 条 → 16 条
总共调用模型 1 次,花 ¥0.0057
```

24 轮只用第一档就够了,3191 降到 2093,一次模型调用都没有。40 轮清完是 3219,还是超 3000,才走第二档,调一次模型压成 831 个 token。**一半以上的情况第一档就能解决,这是先做第一档的理由。**

</details>

### 练习 5:`compact` 的边界

用 5 轮的 `messages`(`CONVO` 加 `QUESTION`),看 `keep_last_turns=0`、`5`、`9` 各返回什么,调了几次模型。

<details><summary>参考答案</summary>

新建 `part04/ex263_5.py`:

```python
# agent-zero-lab/part04/ex263_5.py  练习 5:compact 的边界。keep_last_turns 取 0、取得比总轮数还大,会返回什么
from common.llm import LLMClient
from part04.compaction import compact
from part04.convo import CONVO, QUESTION, SYSTEM_LINE

client = LLMClient()
messages = [{"role": "system", "content": SYSTEM_LINE}, *CONVO, {"role": "user", "content": QUESTION}]  # 5 轮

zero = compact(client, messages, keep_last_turns=0, trigger_tokens=100)
print("keep_last_turns=0:", [m["role"] for m in zero], "← 最后一条不是 user")
big = compact(client, messages, keep_last_turns=5, trigger_tokens=100)
print("keep_last_turns=5(等于总轮数):原样返回?", big is messages)
big = compact(client, messages, keep_last_turns=9, trigger_tokens=100)
print("keep_last_turns=9(比总轮数大):原样返回?", big is messages)
print("调用模型", client.ledger.calls, "次")
```

<div class="line-notes">

- `messages = [{"role": "system", "content": SYSTEM_LINE}, *CONVO, {"role": "user", "content": QUESTION}]` 5 轮。
- `zero = compact(client, messages, keep_last_turns=0, trigger_tokens=100)` 保留 0 轮,`cut = 5 - 0 = 5`,5 轮全进 `old`,`recent` 是空的。调用一次模型。
- `print("keep_last_turns=0:", [m["role"] for m in zero],` 返回的是 `['system', 'system']`:真 system 加摘要,**最后一条不是 user**。调用方要先把新问题追加进去再发给模型。
- `big = compact(client, messages, keep_last_turns=5, trigger_tokens=100)` 保留 5 轮等于总轮数,`len(turns) <= keep_last_turns` 成立,原样返回。
- `print("keep_last_turns=5` `big is messages` 为 `True`,返回的就是传进去的同一个列表,没调模型。
- `big = compact(client, messages, keep_last_turns=9, trigger_tokens=100)` 比总轮数还大,同样原样返回。
- `print("keep_last_turns=9` 同上,`True`。
- `print("调用模型", client.ledger.calls, "次")` 总共 1 次,只有第一个调用走到了总结。

</div>

```bash
uv run python -m part04.ex263_5
```

实跑输出:

```text
keep_last_turns=0: ['system', 'system'] ← 最后一条不是 user
keep_last_turns=5(等于总轮数):原样返回? True
keep_last_turns=9(比总轮数大):原样返回? True
调用模型 1 次
```

三种情况都没报错,而且都符合预期。`keep_last_turns=0` 是最容易出错的:若 `cut` 写成 `turns[:-keep_last_turns]`,它会变成「什么都不压、白调一次模型」;现在是全压,调用方负责补上新问题。

</details>

验收标准:练习 1 到 5 都能解释每个数字;`uv run basedpyright part04` 没有红线。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 压缩(compaction) | 把较长的上下文变短,同时尽量保住有用信息。今天的两档:清理旧工具结果、总结 |
| 清理旧工具结果(tool result clearing) | 把早先工具返回的大块内容换成一行占位,保留调用和结构。不调模型 |
| observation masking | JetBrains 研究里对同一件事的叫法:把旧的「观察结果」(工具输出)换成占位 |
| 摘要(summary) | 让模型把一段旧对话写成短文。今天放在一条以 `【之前对话的摘要】` 开头的 system 消息里 |
| `keep_last_turns` | 压缩时最近几轮保留原文不动 |
| `trigger_tokens` | 总量超过这个值才触发压缩,没超就原样返回 |
| 占位(placeholder) | 被清理的内容换成的那一行文字,告诉模型「这里原来有内容,需要可以再调」 |
| 前缀(prefix) | 一次请求最前面不变的那一段,缓存按前缀匹配,所以改前缀会让缓存失效 |
| 探针评估(probe-based evaluation) | 压缩后往上下文里问具体问题,看 Agent 答不答得对,而不是比摘要和原文像不像 |

## 常见误区

**以为总结压缩是第一选择。** 它要花一次调用,会丢细节,还会让缓存失效。工具结果一般是大头,先清理它,通常就够了(练习 4:24 轮不用总结)。

**占位文字只写「已清理」。** 模型会以为那个工具什么都没返回。要写明原来有内容、可以重新调用。

**不排除有副作用的工具。** 占位里的「可以重新调用」可能让模型又调一次。今天的演示里就出现了。对会扣费、会写库的工具,要么不清理,要么占位里写清楚不要重复调用。

**`[:-keep_recent]` 在 0 上出错。** `[:-0]` 等于 `[:0]`,是空列表,「保留 0 个」变成了「一个都不清」。用 `[:len(x) - keep]`。

**摘要提示词里没写「必须保留」什么。** 今天的实验里随手总结没有答错,但漏事实、长度翻倍。别人的结论换个模型可能不成立,自己用事实清单量一下。

**字数上限当成硬规定。** 要 50 字给了 127 字。真要卡长度,代码里检查,超了重来。

**用关键词判断摘要质量,正则写得太窄或太宽。** 「招商银行」会被缩成「招行」;`10` 会在 `2026-10` 里蒙混过关。写完正则先拿几份真实摘要试一遍。

**压缩了就不管。** 压缩后第一步缓存全部失效,而且摘要本身要占 token。触发阈值太低会频繁压缩,反而更贵。

**压缩完发现最后一条不是 user。** `keep_last_turns=0` 时没有保留任何原文,调用方要先把新问题追加进去。

## 学习资料

### 文档与文章

- [Anthropic · Effective context engineering for AI agents](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents):今天两档手段的出处,看「Compaction」和「Tool result clearing」两小节,15 分钟。
- [Claude 文档 · Context editing](https://platform.claude.com/docs/en/build-with-claude/context-editing):API 层的清理旧工具结果,`clear_tool_uses_20250919`、`exclude_tools`、`clear_at_least` 这些参数,和我们手写的 `clear_old_tool_results` 逐项对照。
- [Anthropic · Managing context on the Claude Developer Platform](https://claude.com/blog/context-management):2025 年 9 月 29 日的发布文章,有那两个数字(84% 和 39%)的出处。
- [JetBrains Research · Cutting Through the Noise: Smarter Context Management for LLM-Powered Agents](https://blog.jetbrains.com/research/2025/12/efficient-context-management/):observation masking 对 LLM summarization 的实验,看图和「Surprisingly」那一节的结论,20 分钟。
- [Factory · Evaluating Context Compression for AI Agents](https://factory.ai/news/evaluating-compression):用探针问题评估压缩,表格里能看到三种压缩方式的得分,20 分钟。
- [Manus · Context Engineering for AI Agents](https://manus.im/blog/Context-Engineering-for-AI-Agents-Lessons-from-Building-Manus):缓存命中率、把文件系统当上下文、可恢复的压缩,和练习 3 的结论互相印证。
- [LangChain · Context Engineering for Agents](https://blog.langchain.com/context-engineering-for-agents/):「压缩」那一类里还有哪些做法。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1nJ396JEmC&autoplay=0&high_quality=1" title="Claude Code 为什么不会撑爆上下文?深入解析 Agent 上下文压缩与会话恢复机制" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>唐国梁Tommy · Claude Code 为什么不会撑爆上下文?深入解析 Agent 上下文压缩与会话恢复机制 · 15 分钟,从 Claude Code 的角度讲压缩、缓存和会话恢复,和今天的两档手段对着看。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1kNY76BEEh&autoplay=0&high_quality=1" title="【Agent 上下文工程】高质量上下文应该怎么组织?从稳定前缀到历史压缩" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>AI架构师Leo · 【Agent 上下文工程】高质量上下文应该怎么组织?从稳定前缀到历史压缩 · 25 分钟,标题里的「稳定前缀」对应练习 3 里缓存的问题,「历史压缩」对应今天。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/esY99nYXxR4" title="How we solved Context Management in Agents — Sally-Ann Delucia" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>AI Engineer · How we solved Context Management in Agents — Sally-Ann Delucia · 英文,一个团队讲自己的 Agent 怎么管上下文,开自动字幕。</figcaption>
</figure>

### 书籍

- John Berryman & Albert Ziegler《Prompt Engineering for LLMs》(O'Reilly,2024):其中讲怎么在有限的提示空间里挑内容、排顺序、做摘要的几章,和今天压缩的取舍是一个问题。

### 开源项目与代码

- [All-Hands-AI/OpenHands](https://github.com/All-Hands-AI/OpenHands):JetBrains 研究里「LLM summarization」那一方的实现来源,仓库里有 condenser(压缩器)相关的代码,值得翻一翻它怎么触发。
- [SWE-agent/SWE-agent](https://github.com/SWE-agent/SWE-agent):研究里「observation masking」那一方的实现来源,按滚动窗口把旧观察结果换成占位。

## 自测

**1. 为什么先做「清理旧工具结果」,再考虑总结压缩?**

<details><summary>答案</summary>

三个原因:不调模型,零成本;工具结果往往是历史里最大的部分(今天的数据里 8 条占了一半 token);而且它只换内容、不动消息结构,不会让接口报 400,也不会丢掉「当时调过什么」。练习 4 里 24 轮历史只清理就从 3191 降到 2093,不需要总结。

</details>

**2. `clear_old_tool_results` 里为什么不直接把旧的 `tool` 消息删掉?**

<details><summary>答案</summary>

因为前面 assistant 消息里的 `tool_calls` 要求后面必须跟一条对应的 `tool` 消息,删了会得到 400 `An assistant message with 'tool_calls' must be followed by tool messages responding to each 'tool_call_id'`。所以只换 `content`,保留消息本身。

</details>

**3. 多次压缩,摘要为什么始终只有一条?**

<details><summary>答案</summary>

`compact` 开头用 `is_summary` 找出旧摘要,把它的内容放在要总结的材料最前面,和被压的几轮一起交给模型,提示词里还写了「如果开头有更早的摘要,把它的要点合并进来」。返回时只放新摘要一条。不这样做,压缩几次就会叠出几条摘要,越叠越长。

</details>

**4. 摘要压缩和缓存有什么冲突?**

<details><summary>答案</summary>

缓存按前缀匹配。压缩把前面的很多条消息换成一条新摘要,这条摘要之后的内容和压缩前不一样,缓存全部失效,压缩后第一步要按未命中的价钱付。练习 3 算的是 ¥0.0011。而在缓存命中率高的 Agent 里,压缩每一步省得很少,要几十步才回本,所以压缩的触发阈值别设太低,压的时候一次压狠一点。

</details>

**5.(面试题)Agent 跑几十步之后上下文太长,你怎么处理?**

<details><summary>答案</summary>

按代价从低到高叠着用。先清理旧的工具结果:把超过一定长度、不在最近几次里的结果换成一行占位,保留调用和结构,不调模型。还超的话,按轮裁,不拆散工具调用。再不够,才让模型把较早几轮总结成一段摘要,最近几轮保留原文,摘要放在固定位置、带标签,多次压缩时旧摘要合并进新摘要。摘要提示词要按业务写清楚必须保留什么(身份、诉求、结论、未解决的事),我们实测这样摘要更稳更短。压缩好不好要量:列一批关键事实,压缩后检查摘要里有没有,再问一个只有早期信息才能回答的问题。还要说清代价:总结压缩多一次调用、会丢细节、会让缓存失效。

</details>

## 明天预告

Day 264 · 上下文工程(三):短期记忆和长期记忆。今天压缩的摘要,只活在这一次对话里,会话结束就没了。下周这位客户再来,Agent 还是不知道他是年付企业版、上次因为 E1043 导入失败、喜欢邮件联系。明天讲怎么把这类信息存到窗口外面:从对话里抽取事实,写进 Postgres 的 `user_memories` 表,下次对话按相关性取回来。
