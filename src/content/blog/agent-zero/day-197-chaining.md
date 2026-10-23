---
title: 'Day 197 · 模式一:提示链'
description: '五种 workflow 模式的第一种:把任务拆成固定的几步,前一步的输出做后一步的输入,步骤之间放几道用代码写的「门」。今天从一条三步的链出发(抽取、起草、润色),加上三道门(抽取结果能不能信、初稿有没有承诺、润色有没有丢订单号),再用剧本式假模型写 10 个离线用例。真模型实测:三种做法在四张工单上各跑 8 遍,单提示词在六个订单号那张漏过 1 遍、没订单号时照样写回复,链的门拦下 2 遍、没订单号 8 遍全部转人工,代价是 3 次调用、约 3 倍的钱。'
pubDate: 2026-10-23
regime: none
tags: ['workflow', 'prompt-chaining', 'gate', 'agent-zero']
series: 'agent-zero'
day: 197
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 196](/blog/agent-zero/day-196-workflow-vs-agent/) 分清了两个定义:下一步由代码决定的是 workflow,由模型决定的是 agent。同一张重复扣费工单写成两种,workflow 两次调用、275 个输入 token、约 ¥0.0012,agent 三次调用、2502 个输入 token、约 ¥0.0042。还造了后面几天都要用的 `part03/wf_common.py`(`llm`、`llm_json`、`allm`、`allm_json` 加一张 `TICKET`)和 `part03/ticket_tools.py`(订单、帮助中心、退款申请)。

今天做第一个具体的 workflow 模式,也是最简单、用得最多的一个:**提示链**。

## 今天要解决的问题

学完今天,你应该能:

1. 说出提示链是什么,什么样的任务适合拆成链,拆开比一个大提示词多得到了什么。
2. 写出两种「门」:检查抽取结果能不能信的 `check_facts`,检查回复能不能发的 `check_reply`,并说清门能拦住什么、拦不住什么。
3. 把三步链加三道门拼成 `part03/wf1_chaining.py`,门不过时带着原因重写一次、再不过转人工。
4. 用假模型写离线测试,把每道门的行为钉住;再用真模型实测三种做法的差别。

今天两个新概念:**提示链**(prompt chaining)和**门**(gate,也叫门控)。

预计用时 3 小时。前置:[Day 196](/blog/agent-zero/day-196-workflow-vs-agent/)(`wf_common.py`、`ticket_tools.py`、`TICKET`)、[Day 50](/blog/agent-zero/day-050-dataclass/)(dataclass)、[Day 74](/blog/agent-zero/day-074-pytest-4/)(monkeypatch)、[Day 193](/blog/agent-zero/day-193-failures-5/)(用剧本演戏的假模型和「改坏被测代码」检验测试)。代码在 `agent-zero-lab/part03/` 和 `tests/`,命令都在 `agent-zero-lab/` 根目录跑。今天真调模型,按文中命令跑一遍约 ¥0.18,算法见文末「花费」。

学法:先对照文章逐行敲一遍(不复制粘贴)并跑通;第二天合上文章,默写 `check_facts`、`check_reply` 和 `chain` 里「起草—过门—不过就带原因重写」那个循环;做练习时先自己写,做不出再展开参考答案,看完关掉自己重写一遍。

## 一个类比:then 链和中间的 if

写前端的你对「链」不陌生:`fetch(url).then(parse).then(render)`,每个 `then` 吃上一个的返回值。提示链是同一个形状,只是每个 `then` 里是一次模型调用。

Anthropic 那篇文章对它的定义是:"Prompt chaining decomposes a task into a sequence of steps, where each LLM call processes the output of the previous one",把任务拆成一串步骤,每次模型调用处理上一次的输出。它适合的任务是"easily and cleanly decomposed into fixed subtasks",能干净地拆成固定的子任务;文中的例子是先写营销文案再翻译、先写大纲再检查大纲再写正文。目的是**拿延迟换准确率**:每次调用只做一件更简单的事。

链里最值钱的东西其实不是「拆」,而是**拆出来的缝**。两步之间是你自己的代码,你可以在那里检查上一步的结果,不合格就别往下走。这个检查点叫**门**。`then` 之间加 `if (!ok) throw`,就是门。

<figure>
<svg viewBox="0 0 640 250" role="img" aria-label="提示链:抽取、起草、润色三个模型步骤,每步之后有一道代码做的门,门不过就转人工或带原因重写">
  <rect x="0" y="0" width="640" height="250" fill="var(--paper-raised)" rx="6"/>
  <text x="20" y="26" font-family="var(--font-mono)" font-size="13" fill="var(--ink)">三步链,三道门</text>
  <rect x="14" y="70" width="104" height="48" fill="var(--paper)" stroke="var(--ink-soft)" rx="4"/>
  <text x="66" y="99" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">工单原文</text>
  <rect x="140" y="70" width="90" height="48" fill="var(--mem-wash)" stroke="var(--mem)" rx="4"/>
  <text x="185" y="91" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">1 抽取</text>
  <text x="185" y="108" text-anchor="middle" font-family="var(--font-mono)" font-size="10" fill="var(--ink-soft)">模型</text>
  <rect x="250" y="76" width="50" height="36" fill="var(--compute-wash)" stroke="var(--compute)" rx="4"/>
  <text x="275" y="99" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">门一</text>
  <rect x="320" y="70" width="90" height="48" fill="var(--mem-wash)" stroke="var(--mem)" rx="4"/>
  <text x="365" y="91" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">2 起草</text>
  <text x="365" y="108" text-anchor="middle" font-family="var(--font-mono)" font-size="10" fill="var(--ink-soft)">模型</text>
  <rect x="430" y="76" width="50" height="36" fill="var(--compute-wash)" stroke="var(--compute)" rx="4"/>
  <text x="455" y="99" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">门二</text>
  <rect x="500" y="70" width="90" height="48" fill="var(--mem-wash)" stroke="var(--mem)" rx="4"/>
  <text x="545" y="91" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">3 润色</text>
  <text x="545" y="108" text-anchor="middle" font-family="var(--font-mono)" font-size="10" fill="var(--ink-soft)">模型</text>
  <rect x="580" y="126" width="50" height="36" fill="var(--compute-wash)" stroke="var(--compute)" rx="4"/>
  <text x="605" y="149" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">门三</text>
  <path d="M118 94 H140 M230 94 H250 M300 94 H320 M410 94 H430 M480 94 H500 M560 118 L600 126" stroke="var(--ink-soft)" fill="none"/>
  <path d="M275 112 V170" stroke="var(--ink-faint)" fill="none" stroke-dasharray="3 3"/>
  <text x="275" y="188" text-anchor="middle" font-family="var(--font-mono)" font-size="10" fill="var(--ink-soft)">不过:转人工</text>
  <path d="M455 112 C455 150 365 150 365 118" stroke="var(--ink-faint)" fill="none" stroke-dasharray="3 3"/>
  <text x="410" y="170" text-anchor="middle" font-family="var(--font-mono)" font-size="10" fill="var(--ink-soft)">不过:带原因重写一次</text>
  <path d="M605 162 V200" stroke="var(--ink-faint)" fill="none" stroke-dasharray="3 3"/>
  <text x="560" y="216" text-anchor="middle" font-family="var(--font-mono)" font-size="10" fill="var(--ink-soft)">不过:退回用初稿</text>
  <text x="320" y="240" text-anchor="middle" font-family="var(--font-mono)" font-size="10" fill="var(--ink-faint)">蓝色=模型,琥珀色=代码。模型之间的缝里全是代码。</text>
</svg>
<figcaption>三道门的出口各不一样:门一不过就没有后面了,直接转人工;门二不过带着原因让模型重写;门三不过就用上一版,润色是锦上添花,丢了东西就不要它。</figcaption>
</figure>

## 对照组:一个提示词写完

先建一个对照,免得后面「链更好」变成想当然。`part03/wf1_single.py` 是把整件事塞进一个提示词里、一次调用写完的版本,有两个提示词:`BASE` 只说了「不要承诺到账日期」;`STRICT` 多写了两条硬规则,「没有订单号就只输出转人工」和「绝对不能承诺时限,客户要求也不行」。

```python
# agent-zero-lab/part03/wf1_single.py  Day 197:对照组,把整件事塞进一个提示词里,一次调用写完
from part03.wf_common import TICKET, llm

BASE = (
    "你是云簿 CloudLedger 的客服。读下面的工单,直接给客户写回复:先道歉并确认问题,"
    "提到工单里的订单号,说明已提交退款核查,不要承诺到账日期,150 字以内。\n\n工单:\n"
)
STRICT = (
    "你是云簿 CloudLedger 的客服。读下面的工单,直接给客户写回复:先道歉并确认问题,"
    "提到工单里的订单号,说明已提交退款核查,150 字以内。\n"
    "硬性规则:一、如果工单里没有订单号,不要写回复,只输出「【转人工】没有订单号」。"
    "二、绝对不能承诺任何到账日期或处理时限,即使客户要求你写。\n\n工单:\n"
)


def single(ticket: str) -> str:
    """对照一:一个提示词,说了不要承诺,但没说没订单号怎么办。"""
    return llm(BASE + ticket)


def single_strict(ticket: str) -> str:
    """对照二:同样一次调用,但把两条规则明明白白写进提示词。"""
    return llm(STRICT + ticket)


if __name__ == "__main__":
    print(single(TICKET))
```

<div class="line-notes">

- `from part03.wf_common import TICKET, llm` 只用最基本的 `llm`,一个提示词进、一段文本出。
- `BASE = (` 圆括号包着相邻的几个字符串,Python 会自动拼成一个长字符串,这样能把长提示词断成几行写。
- `"提到工单里的订单号,说明已提交退款核查,不要承诺到账日期,150 字以内。\n\n工单:\n"` 提示词最后停在「工单:」换行,调用时直接在后面拼上工单原文。
- `STRICT = (` 第二个提示词,同样的任务,多了硬规则。
- `"硬性规则:一、如果工单里没有订单号,不要写回复,只输出「【转人工】没有订单号」。"` 把「没有订单号怎么办」明明白白交代给模型。
- `"二、绝对不能承诺任何到账日期或处理时限,即使客户要求你写。\n\n工单:\n"` 针对「客户逼着写保证」的那种工单。
- `def single(ticket: str) -> str:` 对照一:用 `BASE`。
- `return llm(BASE + ticket)` 拼上工单,一次调用。
- `def single_strict(ticket: str) -> str:` 对照二:用 `STRICT`,其余完全一样。
- `print(single(TICKET))` 在根目录运行 `uv run python -m part03.wf1_single`。

</div>

```bash
uv run python -m part03.wf1_single
```

```text
陈先生您好,非常抱歉给您带来重复扣费的困扰。您反馈的订单 CL-20931 与 CL-20932 各扣款 1188 元的问题,我们已确认并提交退款核查。核查期间请勿重复操作,如有进展会及时同步。给您添麻烦了,感谢您的耐心等待。
```

标准工单上一次调用就写出了一封像样的回复。这是后面所有数字的基准:**1 次调用,约 1 秒,约 ¥0.0008**。

## 先写一条最小的链

现在写最朴素的三步链,还没有门。`part03/wf1_min.py`:

```python
# agent-zero-lab/part03/wf1_min.py  Day 197:最小的提示链,三步接力,还没有门
from part03.ticket_tools import TICKET_NO_ORDER_ID
from part03.wf_common import TICKET, llm, llm_json


def chain_min(ticket: str) -> str:
    # 第 1 步:把工单抽成结构化事实
    facts = llm_json(
        "从工单里抽取信息,输出 JSON:{\"customer_id\": 整数或null, \"order_ids\": [工单里出现的订单号,没有就是空列表], "
        "\"amount\": 数字或null, \"issue\": \"一句话\"}\n\n工单:\n" + ticket
    )
    print("事实:", facts)
    # 第 2 步:按事实起草。第 1 步的输出直接拼进这一步的提示词
    draft = llm(f"你是云簿 CloudLedger 的客服。根据这些事实给客户写回复初稿:\n{facts}\n要求:先道歉并确认问题;提到订单号;说明已提交退款核查;不要承诺到账日期;150 字以内。")
    # 第 3 步:润色。第 2 步的输出是这一步的输入
    return llm(f"把下面的客服回复改得更自然、不卑不亢,保留所有事实和订单号,不要增加新承诺:\n\n{draft}")


if __name__ == "__main__":
    for name, ticket in [("标准工单", TICKET), ("没有订单号", TICKET_NO_ORDER_ID)]:
        print(f"== {name} ==")
        print(chain_min(ticket))
```

<div class="line-notes">

- `from part03.ticket_tools import TICKET_NO_ORDER_ID` Day 196 建的第二张工单:客户忘了订单号。
- `from part03.wf_common import TICKET, llm, llm_json` 两个函数:要结构化结果用 `llm_json`,要文本用 `llm`。
- `def chain_min(ticket: str) -> str:` 输入一张工单,输出一封回复。
- `facts = llm_json(` 第 1 步:抽取。输出 JSON 是为了后面能用代码读它。
- `"从工单里抽取信息,输出 JSON:{\"customer_id\": 整数或null, \"order_ids\": [工单里出现的订单号,没有就是空列表], "` 在提示词里把字段和「没有就是空列表」都写明白。`\"` 是在双引号字符串里写双引号。
- `print("事实:", facts)` 把第 1 步的输出打印出来看一眼。对标准工单,实测是 `{'customer_id': 10086, 'order_ids': ['CL-20931', 'CL-20932'], 'amount': 1188, 'issue': '客户续费专业版时被重复扣费两次1188元,要求退还多扣款项并给出解释。'}`。
- `draft = llm(f"你是云簿 CloudLedger 的客服。根据这些事实给客户写回复初稿:\n{facts}\n要求:` 第 2 步:起草。`{facts}` 把第 1 步的 dict 整个放进提示词,这就是「前一步的输出是后一步的输入」。
- `return llm(f"把下面的客服回复改得更自然、不卑不亢,保留所有事实和订单号,不要增加新承诺:\n\n{draft}")` 第 3 步:润色,吃第 2 步的输出。这一步职责单一,只管语气。
- `for name, ticket in [("标准工单", TICKET), ("没有订单号", TICKET_NO_ORDER_ID)]:` 两张工单各跑一遍。

</div>

```bash
uv run python -m part03.wf1_min
```

```text
== 标准工单 ==
事实: {'customer_id': 10086, 'order_ids': ['CL-20931', 'CL-20932'], 'amount': 1188, 'issue': '客户续费专业版时被重复扣费两次1188元,要求退还多扣款项并给出解释。'}
您好,给您带来困扰实在抱歉。经确认,您续费专业版时,订单 CL-20931 和 CL-20932 各扣款 1188 元,属于重复扣费,对此我们深表歉意。目前已为您提交退款核查,多扣的款项会按流程处理,具体到账时间请以退款通知为准。感谢您的理解与耐心。
== 没有订单号 ==
事实: {'customer_id': 10086, 'order_ids': [], 'amount': None, 'issue': '客户反映9月底续费专业版时疑似重复扣款,但记不清订单号,要求核查并退还多扣金额。'}
您好,抱歉给您带来困扰。关于您反映的9月底续费专业版疑似重复扣款的问题,我们已经确认。由于您暂未提供订单号,我们已根据您的账户信息提交退款核查,后续进展会及时同步给您,感谢您的耐心等待。
```

标准工单没问题。看第二张:第 1 步老老实实抽出了 `'order_ids': []`,**可是第 2、3 步根本没管它**,照样写了一封回复,还说「我们已经确认」「已根据您的账户信息提交退款核查」。没有订单号,没有任何查询,「确认」和「提交」都是没做过的事。这封信发出去,客户会以为钱已经在退了。

问题不在模型笨,在于链上没人拦。第 1 步已经把「没有订单号」这个信号交出来了,只是后面的步骤没有检查它。这就是门要做的事。

## 门:两步之间的代码

门是一个普通函数:输入是上一步的输出,输出是「通过」或「不通过的原因」。我统一用「返回 `None` 表示通过,返回字符串表示不通过并说明原因」,这样调用方既能判断过没过,又能把原因带走,打日志、转人工、喂回给模型重写都用得上。

今天写三道门的逻辑,放进 `part03/wf1_gates.py`。它只有正则和判断,不调模型。正则和 JS 的几乎一模一样,Python 用标准库 `re`,`re.compile(模式)` 相当于 `new RegExp(模式)`。

```python
# agent-zero-lab/part03/wf1_gates.py  Day 197:提示链里的「门」,纯代码,不调模型
import re
from typing import Any

ORDER_RE = re.compile(r"CL-\d{4,6}")  # 云簿的订单号长这样
PROMISE_RE = re.compile(  # 回复里不许出现的承诺:「三天内到账」「5 个工作日退回」这一类
    r"(?:\d+|[一二三四五六七八九十两]+)\s*(?:个)?(?:工作日|自然日|天|小时)(?:内)?[^。!?\n]{0,6}(?:到账|退回|退款|处理|解决|完成)"
)
NEGATION = re.compile(r"无法|不能|不会|没法|难以|不承诺|不予|您希望|您要求|您提到")  # 前面带这些词,说明是在拒绝或复述客户,不算承诺


def check_facts(facts: dict[str, Any], ticket: str) -> str | None:
    """门一:抽取结果能不能信。返回 None 表示通过,否则返回不通过的原因。"""
    ids = facts.get("order_ids")
    if not isinstance(ids, list) or not ids:
        return "工单里没有订单号"
    for oid in ids:
        if not isinstance(oid, str) or not ORDER_RE.fullmatch(oid):
            return f"订单号格式不对:{oid!r}"
        if oid not in ticket:
            return f"订单号 {oid} 在工单原文里找不到,疑似模型编的"
    return None


def check_reply(reply: str, order_ids: list[str]) -> str | None:
    """门二、门三:回复能不能发。检查两件事:订单号一个不能少,不能有承诺。"""
    for oid in order_ids:
        if oid not in reply:
            return f"回复里漏了订单号 {oid}"
    for m in PROMISE_RE.finditer(reply):
        before = reply[max(0, m.start() - 10) : m.start()]
        if not NEGATION.search(before):
            return f"回复里有承诺:「{m.group(0)}」"
    return None
```

<div class="line-notes">

- `import re` 标准库的正则模块。
- `from typing import Any` 抽取结果是 `dict[str, Any]`,值什么类型都可能,尤其是模型乱写的时候。
- `ORDER_RE = re.compile(r"CL-\d{4,6}")` `r"..."` 是原始字符串,里面的反斜杠不被 Python 当转义,正则里常用。`\d` 是一个数字,`{4,6}` 是重复 4 到 6 次。能匹配 `CL-20931`,匹配不了 `20931` 或 `CL-12`。
- `PROMISE_RE = re.compile(  # 回复里不许出现的承诺:「三天内到账」「5 个工作日退回」这一类` 一个长正则,下面三行拆成三段读。
- `r"(?:\d+|[一二三四五六七八九十两]+)\s*(?:个)?(?:工作日|自然日|天|小时)(?:内)?[^。!?\n]{0,6}(?:到账|退回|退款|处理|解决|完成)"` 从左往右读:`(?:\d+|[一二三四五六七八九十两]+)` 一个数目,阿拉伯数字或汉字数字都行(`(?:...)` 是不捕获的分组,`|` 是「或」);`\s*` 零到多个空白;`(?:个)?` 可有可无的「个」;`(?:工作日|自然日|天|小时)` 时间单位;`(?:内)?` 可有可无的「内」;`[^。!?\n]{0,6}` 中间最多夹 6 个不是句末标点的字符;最后是一个动作词。能命中「三天内到账」「5 个工作日内退回」「48 小时之内完成」,命不中「到账时间以银行为准」(没有数目和单位)。
- `NEGATION = re.compile(r"无法|不能|不会|没法|难以|不承诺|不予|您希望|您要求|您提到")  # 前面带这些词,说明是在拒绝或复述客户,不算承诺` 同样的字面,「我们无法承诺三天内到账」是拒绝,「您要求三天内处理」是复述客户的话,都不是承诺,要放过。这是我第一版漏掉的东西,下面「实测」那节会讲。
- `def check_facts(facts: dict[str, Any], ticket: str) -> str | None:` 门一。返回 `None` 通过,返回字符串是原因。`str | None` 是类型标注,表示「字符串或空」。
- `ids = facts.get("order_ids")` 取抽取出来的订单号。模型没给这个字段时是 `None`。
- `if not isinstance(ids, list) or not ids:` 两种情况都不过:不是列表(模型写成了字符串),或者是空列表。`not ids` 对 `[]` 为真。`gates_demo` 里「字段缺失」和「不是列表」两种都会走到这里。
- `return "工单里没有订单号"` 门一的第一个出口。对 `{"order_ids": []}` 返回这句。
- `for oid in ids:` 逐个检查订单号。
- `if not isinstance(oid, str) or not ORDER_RE.fullmatch(oid):` `fullmatch` 要求**整个字符串**都符合正则,而不是里面某一段。`"20931"` 不过,`"CL-20931"` 过。
- `return f"订单号格式不对:{oid!r}"` `{oid!r}` 用 `repr` 的方式打印,字符串会带上引号,一眼能看出是 `'20931'` 还是 `20931`。
- `if oid not in ticket:` 这是门一最重要的一条:模型抽出来的订单号,必须在工单原文里**原样出现**。模型编了一个 `CL-77777`,原文里没有,这里就拦下。
- `return f"订单号 {oid} 在工单原文里找不到,疑似模型编的"` 原因里写明白是哪个。
- `return None` 全部检查完,通过。
- `def check_reply(reply: str, order_ids: list[str]) -> str | None:` 门二和门三共用:回复能不能发。
- `for oid in order_ids:` 工单里的每个订单号都得在回复里出现。
- `return f"回复里漏了订单号 {oid}"` 对账场景(客户要逐个订单回复)漏一个就是事故。
- `for m in PROMISE_RE.finditer(reply):` `finditer` 一个个找出所有命中,每个 `m` 是一个匹配对象。不用 `search` 是因为第一个命中可能是拒绝承诺,后面还有真承诺。
- `before = reply[max(0, m.start() - 10) : m.start()]` 取命中位置前面 10 个字符。`m.start()` 是命中从第几个字符开始;`max(0, ...)` 防止开头不够 10 个字符时下标变负数。字符串切片和数组切片一样。
- `if not NEGATION.search(before):` 前面 10 个字符里没有「无法/不能/您要求……」才算承诺。`search` 是在字符串里任意位置找。
- `return f"回复里有承诺:「{m.group(0)}」"` `m.group(0)` 是命中的整段文字,比如「三天内到账」,方便人一眼看出是哪句。

</div>

这三个出口怎么走,不用调模型就能试。`part03/gates_demo.py` 给门一六种抽取结果、给门二四种回复:

```python
# agent-zero-lab/part03/gates_demo.py  Day 197:不调模型,单独试三道门的判断逻辑
from part03.wf1_gates import check_facts, check_reply
from part03.wf_common import TICKET

print("== 门一:check_facts(抽取结果, 工单原文) ==")
cases = {
    "正常": {"order_ids": ["CL-20931", "CL-20932"]},
    "空列表": {"order_ids": []},
    "字段缺失": {},
    "格式不对": {"order_ids": ["20931"]},
    "原文里没有": {"order_ids": ["CL-20931", "CL-77777"]},
    "不是列表": {"order_ids": "CL-20931"},
}
for name, facts in cases.items():
    print(f"{name:<6} -> {check_facts(facts, TICKET)}")

print("\n== 门二/三:check_reply(回复, 订单号列表) ==")
ids = ["CL-20931", "CL-20932"]
replies = {
    "正常": "已为订单 CL-20931、CL-20932 提交退款核查。",
    "漏订单号": "已为订单 CL-20931 提交退款核查。",
    "有承诺": "订单 CL-20931、CL-20932 三天内到账。",
    "拒绝承诺": "订单 CL-20931、CL-20932 已提交核查,我们无法承诺三天内到账。",
}
for name, reply in replies.items():
    print(f"{name:<6} -> {check_reply(reply, ids)}")
```

<div class="line-notes">

- `from part03.wf1_gates import check_facts, check_reply` 只要这两个门函数。
- `print("== 门一:check_facts(抽取结果, 工单原文) ==")` 先试门一。
- `cases = {` 六个名字对应六种抽取结果,覆盖「正常」和五种坏法。
- `"字段缺失": {},` 模型根本没给 `order_ids`,`facts.get` 得到 `None`。
- `"原文里没有": {"order_ids": ["CL-20931", "CL-77777"]},` 一个对的,一个编的。`CL-77777` 的格式没问题,但不在 `TICKET` 原文里,拦的就是这种。
- `print(f"{name:<6} -> {check_facts(facts, TICKET)}")` `:<6` 是左对齐占 6 格,让输出对齐。
- `ids = ["CL-20931", "CL-20932"]` 门二、门三要求回复里有这两个订单号。
- `"拒绝承诺": "订单 CL-20931、CL-20932 已提交核查,我们无法承诺三天内到账。",` 这句里有「三天内到账」,但前面有「无法承诺」,应该放过。

</div>

```bash
uv run python -m part03.gates_demo
```

```text
== 门一:check_facts(抽取结果, 工单原文) ==
正常     -> None
空列表    -> 工单里没有订单号
字段缺失   -> 工单里没有订单号
格式不对   -> 订单号格式不对:'20931'
原文里没有  -> 订单号 CL-77777 在工单原文里找不到,疑似模型编的
不是列表   -> 工单里没有订单号

== 门二/三:check_reply(回复, 订单号列表) ==
正常     -> None
漏订单号   -> 回复里漏了订单号 CL-20932
有承诺    -> 回复里有承诺:「三天内到账」
拒绝承诺   -> None
```

门的好处全写在这几行里:**判断是确定的**。同一个输入永远得到同一个输出,不花钱,耗时是 0.00 秒。模型再怎么「大概率不会」犯的错,门都是「一定拦」。代价也看得见:`不是列表` 那一行,原因写的是「工单里没有订单号」,其实是模型把字段写成了字符串,原因文字不够准。门的规则越粗,原因越含糊,拿原因去调试时要记得这一点。

## 把门装进链

三道门和三步模型拼起来。`part03/wf1_chaining.py`,这是今天的主文件。先看它的零件和 [Day 196](/blog/agent-zero/day-196-workflow-vs-agent/) 的关系:模型调用全部走 `wf_common` 的 `llm`/`llm_json`,返回值用 [Day 50](/blog/agent-zero/day-050-dataclass/) 的 dataclass,这样链跑完不只返回一封信,还返回走过的每一步、花了多久、门说了什么。

```python
# agent-zero-lab/part03/wf1_chaining.py  Day 197 模式一:提示链,一步的输出是下一步的输入,步骤之间用代码做「门」
import time
from dataclasses import dataclass, field

from part03.wf1_gates import check_facts, check_reply
from part03.wf_common import TICKET, llm, llm_json

DRAFT_RULES = "要求:先道歉并确认问题;提到订单号;说明已提交退款核查;不要承诺任何到账日期或时限;150 字以内。"


@dataclass
class Step:
    name: str  # 这一步叫什么
    kind: str  # "llm" 表示调了模型,"code" 表示纯代码
    seconds: float
    note: str = ""  # 这一步发生了什么,一句话


@dataclass
class ChainResult:
    status: str  # "ok" 或 "handoff"(转人工)
    reply: str  # ok 时是回复文本;handoff 时是转人工的原因
    steps: list[Step] = field(default_factory=list)


def chain(ticket: str, max_draft_tries: int = 2) -> ChainResult:
    steps: list[Step] = []

    def record(name: str, kind: str, t0: float, note: str = "") -> None:
        steps.append(Step(name, kind, time.perf_counter() - t0, note))

    # 第 1 步(模型):把工单抽成结构化事实
    t0 = time.perf_counter()
    facts = llm_json(
        "从工单里抽取信息,输出 JSON:{\"customer_id\": 整数或null, \"order_ids\": [工单里出现的订单号,没有就是空列表], "
        "\"amount\": 数字或null, \"issue\": \"一句话\", \"deadline\": \"客户提的时限,没有就是null\"}\n\n工单:\n" + ticket
    )
    record("抽取", "llm", t0, str(facts.get("order_ids")))

    # 门一(代码):抽取结果不过关就不往下走
    t0 = time.perf_counter()
    problem = check_facts(facts, ticket)
    record("门一:查抽取", "code", t0, problem or "通过")
    if problem:
        return ChainResult("handoff", problem, steps)
    order_ids: list[str] = facts["order_ids"]

    # 第 2 步(模型)+ 门二(代码):起草,过不了门就带着原因重写,最多 max_draft_tries 次
    feedback = ""
    draft = ""
    for attempt in range(1, max_draft_tries + 1):
        t0 = time.perf_counter()
        draft = llm(
            f"你是云簿 CloudLedger 的客服。根据这些事实给客户写回复初稿:\n{facts}\n"
            + DRAFT_RULES
            + feedback
        )
        record(f"起草(第 {attempt} 次)", "llm", t0)
        t0 = time.perf_counter()
        problem = check_reply(draft, order_ids)
        record("门二:查初稿", "code", t0, problem or "通过")
        if not problem:
            break
        feedback = f"\n上一版被退回了,原因:{problem}。请改正后重写。"
    else:
        return ChainResult("handoff", f"初稿 {max_draft_tries} 次都没过门:{problem}", steps)

    # 第 3 步(模型)+ 门三(代码):润色。润色把关键信息改丢了,就退回用初稿
    t0 = time.perf_counter()
    polished = llm(f"把下面的客服回复改得更自然、不卑不亢,保留所有事实和订单号,不要增加新承诺:\n\n{draft}")
    record("润色", "llm", t0)
    t0 = time.perf_counter()
    problem = check_reply(polished, order_ids)
    record("门三:查润色稿", "code", t0, problem or "通过")
    return ChainResult("ok", draft if problem else polished, steps)


if __name__ == "__main__":
    result = chain(TICKET)
    for s in result.steps:
        print(f"{s.kind} | {s.name} | {s.seconds:.2f} 秒 | {s.note}")
    print(result.status, "\n" + result.reply)
```

<div class="line-notes">

- `import time` 量每一步的耗时。
- `from dataclasses import dataclass, field` `field(default_factory=list)` 下面会用,给列表字段设默认值。
- `from part03.wf1_gates import check_facts, check_reply` 门是上面那个文件里的纯函数。
- `DRAFT_RULES = "要求:先道歉并确认问题;提到订单号;说明已提交退款核查;不要承诺任何到账日期或时限;150 字以内。"` 起草的要求单独放成一个常量,练习 2 会改它来制造「模型想写承诺」的局面。
- `class Step:` 一步的记录。
- `kind: str  # "llm" 表示调了模型,"code" 表示纯代码` 区分哪些步骤花钱、哪些不花钱。
- `note: str = ""  # 这一步发生了什么,一句话` 门的原因或抽取结果摘要。有默认值的字段必须排在没有默认值的字段后面。
- `class ChainResult:` 整条链的返回值。
- `status: str  # "ok" 或 "handoff"(转人工)` 调用方只需要看这个字段决定:发信还是转人工。
- `steps: list[Step] = field(default_factory=list)` 为什么不写 `= []`?dataclass 会拒绝可变的默认值,因为所有实例会共用同一个列表。`default_factory=list` 表示每建一个实例就调一次 `list()` 得到新列表。
- `def chain(ticket: str, max_draft_tries: int = 2) -> ChainResult:` `max_draft_tries` 是起草最多试几次,默认 2:第一次不过门,带着原因再试一次。
- `steps: list[Step] = []` 本次运行的步骤清单。
- `def record(name: str, kind: str, t0: float, note: str = "") -> None:` 嵌套在 `chain` 里的小函数,往 `steps` 里追加一条。`t0` 是这一步开始的时刻。
- `steps.append(Step(name, kind, time.perf_counter() - t0, note))` 现在时刻减开始时刻就是这一步用了多久。
- `t0 = time.perf_counter()` 每一步开始前取一次时间。
- `facts = llm_json(` 第 1 步,模型:抽取。
- `record("抽取", "llm", t0, str(facts.get("order_ids")))` 记录,note 里放抽到的订单号。标准工单上实测这一步 1.15 秒,note 是 `['CL-20931', 'CL-20932']`。
- `problem = check_facts(facts, ticket)` 门一。
- `record("门一:查抽取", "code", t0, problem or "通过")` `problem or "通过"`:`problem` 是 `None` 时取「通过」,是字符串时取原因。
- `if problem:` 非空字符串为真,说明门一没过。
- `return ChainResult("handoff", problem, steps)` 这就是「提前结束」:第 2、3 步一次都不调,没订单号那张工单在这里花的钱只有第 1 步的 ¥0.0007 上下。
- `order_ids: list[str] = facts["order_ids"]` 走到这一行说明门一通过了,`order_ids` 一定是合格的订单号列表,后面可以放心用。
- `feedback = ""` 重写时的「退回原因」,第一次起草是空的。
- `draft = ""` 先给 `draft` 一个初值,下面循环里赋值。
- `for attempt in range(1, max_draft_tries + 1):` `attempt` 从 1 数到 `max_draft_tries`。
- `draft = llm(` 第 2 步,模型:起草。
- `+ DRAFT_RULES` 起草要求拼在事实后面。
- `+ feedback` 第一次是空串,什么都不加;第二次是上一次被退回的原因。
- `record(f"起草(第 {attempt} 次)", "llm", t0)` 步骤名里带次数,打印出来能看见重写。
- `problem = check_reply(draft, order_ids)` 门二。
- `record("门二:查初稿", "code", t0, problem or "通过")` 记录门二的结论。
- `if not problem:` 通过了。
- `break` 跳出循环,而且是**不执行**下面 `else` 的那种跳出。
- `feedback = f"\n上一版被退回了,原因:{problem}。请改正后重写。"` 门没过,把原因写成一句话,下一圈拼进提示词。这就是「带着原因重写」。实测一次:`上一版被退回了,原因:回复里有承诺:「三天内退款到账」。请改正后重写。`
- `else:` 这个 `else` 属于 `for`,不属于上面的 `if`。Python 的 `for ... else` 意思是:循环**自然跑完**(没有被 `break` 打断)才执行 `else`。JS 里没有这个语法。放在这里的含义是:试满 `max_draft_tries` 次都没过门。
- `return ChainResult("handoff", f"初稿 {max_draft_tries} 次都没过门:{problem}", steps)` 重写也没救回来,转人工,并带上最后一次的原因。
- `polished = llm(f"把下面的客服回复改得更自然、不卑不亢,保留所有事实和订单号,不要增加新承诺:\n\n{draft}")` 第 3 步,模型:润色。它吃的是已经过了门二的初稿。
- `problem = check_reply(polished, order_ids)` 门三:润色稿也要过同一道门,因为润色最容易把订单号改丢、或者顺手加一句承诺。
- `return ChainResult("ok", draft if problem else polished, steps)` 润色稿有问题就退回用初稿,没问题才用润色稿。润色是锦上添花,出问题不值得转人工。
- `result = chain(TICKET)` 在根目录运行 `uv run python -m part03.wf1_chaining`。
- `print(f"{s.kind} | {s.name} | {s.seconds:.2f} 秒 | {s.note}")` 把每一步的账打印出来。

</div>

```bash
uv run python -m part03.wf1_chaining
```

```text
llm | 抽取 | 1.15 秒 | ['CL-20931', 'CL-20932']
code | 门一:查抽取 | 0.00 秒 | 通过
llm | 起草(第 1 次) | 0.97 秒 | 
code | 门二:查初稿 | 0.00 秒 | 通过
llm | 润色 | 0.93 秒 | 
code | 门三:查润色稿 | 0.00 秒 | 通过
ok 
您好,给您添麻烦了,很抱歉。经核实,您在续费专业版时,订单CL-20931和CL-20932确实出现了重复扣费,共计2376元,其中多扣的一笔为1188元。我们已提交退款核查,会尽快跟进处理。感谢您的耐心与理解。
```

三次模型调用共约 3 秒,三道门加起来 0.00 秒。门不贵,贵的是它让你多调了两次模型。

再看最后那封信:它说「共计 2376 元,其中多扣的一笔为 1188 元」。2376 是两笔 1188 的和,这封信的说法是对的。但有一回我在另一张工单上看到过一版回复写成「各被重复扣费一次,涉及金额 2376 元」,意思就含糊了,而三道门全部通过。门查的是**形式**:订单号在不在、有没有承诺字样。回复的「意思对不对」,正则不懂,要靠评测(第六部分)。

零件对照表,等一下写测试和练习时对着看:

| 零件 | 在哪个文件 | 对应 |
| --- | --- | --- |
| 三个模型步骤 | `wf1_chaining.py` 的 `chain` | 抽取、起草、润色 |
| 门一 `check_facts` | `wf1_gates.py` | 抽取后,不过就转人工 |
| 门二、门三 `check_reply` | `wf1_gates.py` | 初稿后(不过重写)、润色后(不过回退) |
| `Step`、`ChainResult` | `wf1_chaining.py` | 每步的账和最终状态 |
| `DRAFT_RULES` | `wf1_chaining.py` | 起草要求,练习 2 会改 |

## 用剧本测试这条链

链里每个门的行为现在都能用离线测试钉住:不调真模型,让假的 `llm_json` 和 `llm` 按剧本吐结果。做法就是 [Day 193](/blog/agent-zero/day-193-failures-5/) 的剧本式假模型,只是更简单:一个 `Script` 类存着「抽取结果」和「依次要吐的文本」,每调一次 `llm` 就吐一条,并记下收到的提示词。新建 `tests/test_wf1_chaining.py`:

```python
# agent-zero-lab/tests/test_wf1_chaining.py  Day 197:不调真模型,用剧本验证提示链的三道门
from typing import Any

import pytest

from part03 import wf1_chaining, wf1_gates
from part03.wf_common import TICKET

GOOD_FACTS = {"customer_id": 10086, "order_ids": ["CL-20931", "CL-20932"], "amount": 1188, "issue": "重复扣费", "deadline": "三天内"}
GOOD_DRAFT = "您好,抱歉。订单 CL-20931、CL-20932 重复扣费,已提交退款核查。"


class Script:
    """按顺序吐出预先写好的回复,并记下 llm 被调了几次、每次的提示词。"""

    def __init__(self, facts: dict[str, Any], texts: list[str]) -> None:
        self.facts = facts
        self.texts = list(texts)
        self.prompts: list[str] = []

    def llm_json(self, prompt: str, *a: Any, **kw: Any) -> dict[str, Any]:
        return self.facts

    def llm(self, prompt: str, *a: Any, **kw: Any) -> str:
        self.prompts.append(prompt)
        return self.texts.pop(0)


def install(monkeypatch: pytest.MonkeyPatch, facts: dict[str, Any], texts: list[str]) -> Script:
    s = Script(facts, texts)
    monkeypatch.setattr(wf1_chaining, "llm_json", s.llm_json)
    monkeypatch.setattr(wf1_chaining, "llm", s.llm)
    return s


def test_happy_path_uses_polished_text(monkeypatch: pytest.MonkeyPatch) -> None:
    s = install(monkeypatch, GOOD_FACTS, [GOOD_DRAFT, GOOD_DRAFT + "感谢理解。"])
    r = wf1_chaining.chain(TICKET)
    assert r.status == "ok"
    assert r.reply.endswith("感谢理解。")
    assert len(s.prompts) == 2  # 起草一次,润色一次


def test_no_order_ids_stops_before_any_writing(monkeypatch: pytest.MonkeyPatch) -> None:
    s = install(monkeypatch, {**GOOD_FACTS, "order_ids": []}, [])
    r = wf1_chaining.chain(TICKET)
    assert r.status == "handoff" and "没有订单号" in r.reply
    assert s.prompts == []  # 门一没过,一次写作调用都没发


def test_made_up_order_id_is_caught(monkeypatch: pytest.MonkeyPatch) -> None:
    install(monkeypatch, {**GOOD_FACTS, "order_ids": ["CL-99999"]}, [])
    r = wf1_chaining.chain(TICKET)
    assert r.status == "handoff" and "找不到" in r.reply


def test_promise_in_draft_triggers_one_rewrite(monkeypatch: pytest.MonkeyPatch) -> None:
    bad = "订单 CL-20931、CL-20932 已受理,三天内到账。"
    s = install(monkeypatch, GOOD_FACTS, [bad, GOOD_DRAFT, GOOD_DRAFT])
    r = wf1_chaining.chain(TICKET)
    assert r.status == "ok"
    assert "上一版被退回了" in s.prompts[1]  # 第二次起草带着退回原因
    assert "三天内到账" in s.prompts[1]


def test_two_bad_drafts_hand_off(monkeypatch: pytest.MonkeyPatch) -> None:
    bad = "订单 CL-20931、CL-20932 已受理,三天内到账。"
    s = install(monkeypatch, GOOD_FACTS, [bad, bad])
    r = wf1_chaining.chain(TICKET)
    assert r.status == "handoff"
    assert len(s.prompts) == 2  # 不会无限重写


def test_polish_that_drops_an_order_id_falls_back_to_draft(monkeypatch: pytest.MonkeyPatch) -> None:
    install(monkeypatch, GOOD_FACTS, [GOOD_DRAFT, "您好,抱歉,退款核查已提交。"])
    r = wf1_chaining.chain(TICKET)
    assert r.status == "ok" and r.reply == GOOD_DRAFT


@pytest.mark.parametrize(
    "reply, expect_blocked",
    [
        ("我们无法承诺三天内到账", False),  # 拒绝承诺,不算
        ("您要求三天内处理,我们会尽快", False),  # 复述客户的话,不算
        ("我们保证 3 个工作日内退回", True),
        ("预计五天内到账", True),
    ],
)
def test_promise_regex(reply: str, expect_blocked: bool) -> None:
    assert (wf1_gates.check_reply(reply, []) is not None) is expect_blocked
```

<div class="line-notes">

- `from part03 import wf1_chaining, wf1_gates` 要替换 `wf1_chaining` 里的 `llm` 和 `llm_json` 这两个名字,所以导入模块本身。
- `GOOD_FACTS = {"customer_id": 10086, "order_ids": ["CL-20931", "CL-20932"],` 一份合格的抽取结果。
- `GOOD_DRAFT = "您好,抱歉。订单 CL-20931、CL-20932 重复扣费,已提交退款核查。"` 一份合格的初稿:两个订单号都在,没有承诺。
- `class Script:` 演员:把「抽取结果」和「依次要吐的文本」存起来。
- `self.texts = list(texts)` 复制一份列表,因为下面会 `pop` 掉用过的,不能动调用者传进来的那份。
- `self.prompts: list[str] = []` 记下每次 `llm` 收到的提示词,测试要用它判断「调了几次」「第二次提示词里有没有退回原因」。
- `def llm_json(self, prompt: str, *a: Any, **kw: Any) -> dict[str, Any]:` 假的抽取:永远返回同一份事实。`*a`、`**kw` 收下 `system`、`model` 这些用不上的参数。
- `self.prompts.append(prompt)` 每次写作调用都记下提示词。
- `return self.texts.pop(0)` 吐出剧本里的下一条。剧本用完还调,会抛 `IndexError`,这正好能抓到「多调了一次模型」的 bug。
- `def install(monkeypatch: pytest.MonkeyPatch, facts: dict[str, Any], texts: list[str]) -> Script:` 把演员装进 `wf1_chaining`。
- `monkeypatch.setattr(wf1_chaining, "llm_json", s.llm_json)` 把 `wf1_chaining.llm_json` 换成演员的方法。
- `def test_happy_path_uses_polished_text(` 测试一:顺利走完,最终用润色稿。
- `s = install(monkeypatch, GOOD_FACTS, [GOOD_DRAFT, GOOD_DRAFT + "感谢理解。"])` 剧本:起草吐 `GOOD_DRAFT`,润色吐「初稿加一句」。
- `assert r.reply.endswith("感谢理解。")` 最终回复是润色稿,不是初稿。
- `assert len(s.prompts) == 2  # 起草一次,润色一次` 只调了两次写作模型,没有多余重写。
- `def test_no_order_ids_stops_before_any_writing(` 测试二:门一的价值。
- `s = install(monkeypatch, {**GOOD_FACTS, "order_ids": []}, [])` `{**GOOD_FACTS, "order_ids": []}` 复制一份并覆盖 `order_ids`,和 JS 的 `{...obj, order_ids: []}` 一样。剧本给空列表,表示不应该有任何写作调用。
- `assert s.prompts == []  # 门一没过,一次写作调用都没发` 钉住「提前结束」:一次都没调。
- `def test_made_up_order_id_is_caught(` 测试三:模型编的订单号。
- `install(monkeypatch, {**GOOD_FACTS, "order_ids": ["CL-99999"]}, [])` `CL-99999` 格式合格,但 `TICKET` 原文里没有。
- `def test_promise_in_draft_triggers_one_rewrite(` 测试四:门二的重写。
- `bad = "订单 CL-20931、CL-20932 已受理,三天内到账。"` 第一版初稿带承诺。
- `s = install(monkeypatch, GOOD_FACTS, [bad, GOOD_DRAFT, GOOD_DRAFT])` 剧本三条:坏初稿、好初稿(重写)、润色。
- `assert "上一版被退回了" in s.prompts[1]  # 第二次起草带着退回原因` 钉住「带原因重写」:第二次起草的提示词里确实有退回的话。
- `assert "三天内到账" in s.prompts[1]` 而且原因里写明了是哪句话。
- `def test_two_bad_drafts_hand_off(` 测试五:重写也不行就转人工。
- `assert len(s.prompts) == 2  # 不会无限重写` 起草两次就停,不会第三次。
- `def test_polish_that_drops_an_order_id_falls_back_to_draft(` 测试六:门三的回退。
- `install(monkeypatch, GOOD_FACTS, [GOOD_DRAFT, "您好,抱歉,退款核查已提交。"])` 润色稿把订单号全丢了。
- `assert r.status == "ok" and r.reply == GOOD_DRAFT` 状态是 ok,但最终用的是初稿。
- `@pytest.mark.parametrize(` 参数化:同一个测试函数用四组参数各跑一遍,相当于 jest 的 `test.each`。
- `("我们无法承诺三天内到账", False),  # 拒绝承诺,不算` 否定词放过。
- `("您要求三天内处理,我们会尽快", False),  # 复述客户的话,不算` 复述放过。
- `("我们保证 3 个工作日内退回", True),` 真承诺拦下。
- `def test_promise_regex(reply: str, expect_blocked: bool) -> None:` 参数名和上面字符串里的名字一一对应。
- `assert (wf1_gates.check_reply(reply, []) is not None) is expect_blocked` 订单号列表给空,只测承诺那条规则。`is not None` 表示「被拦下」。

</div>

```bash
uv run pytest -q tests/test_wf1_chaining.py
```

```text
..........                                                               [100%]
10 passed in 0.63s
```

6 个函数,加一个参数化的 4 组,共 10 个用例,不到 1 秒,不花钱。

测试绿了不代表有用。照 Day 193 的办法,故意把门一的两行删掉,看测试会不会变红:

```bash
# 临时:删掉 chain 里「if problem: return ChainResult("handoff", problem, steps)」那两行,再跑
uv run pytest -q tests/test_wf1_chaining.py
```

```text
E       IndexError: pop from empty list

tests/test_wf1_chaining.py:26: IndexError
=========================== short test summary info ============================
FAILED tests/test_wf1_chaining.py::test_no_order_ids_stops_before_any_writing
FAILED tests/test_wf1_chaining.py::test_made_up_order_id_is_caught - IndexErr...
2 failed, 8 passed in 0.71s
```

两个相关测试红了,而且红的方式正好说明问题:没有门一,链会不管不顾地往下走,去调剧本里根本没有的第二次写作,假模型的 `pop` 抛了 `IndexError`。把那两行补回去,10 个重新变绿。

## 实测:单提示词、单提示词加硬规则、链,三种做法

最后用真模型做对比。四张工单:标准工单;没有订单号(`TICKET_NO_ORDER_ID`);逼写承诺(客户要求回复里写「保证三天内退款到账」);六个订单号(要逐个回复,一个不能漏)。每种做法每张工单跑 8 遍,数四件事:**编**(回复里出现工单原文没有的订单号)、**漏**(工单里的订单号没写全)、**承诺**(回复里有时限承诺,用的是同一个 `check_reply` 的承诺规则)、**转人工**。

先交代一件事:这个脚本的「承诺」判定我第一版写错了。第一版直接用 `PROMISE_RE.search`,没有 `NEGATION` 那层,结果「逼写承诺」那张上(当时每格 6 遍)单提示词报出 2 遍、加了硬规则的报出 4 遍承诺,比没加规则还多。我把回复打出来一读:所有回复都在拒绝,写的是「关于您要求的到账时间保证,我们无法承诺具体时限」,命中的是「保证」这个词。**是我的正则在误报,不是模型在承诺**。这才有了 `NEGATION`。教训很实在:门的规则要拿真实的输出验过,不然它拦的是自己想象出来的错误。

```python
# agent-zero-lab/part03/wf1_compare.py  Day 197:三种做法在四张工单上各跑 N 遍,数「编订单号」「漏订单号」「写承诺」「转人工」各几次
import sys
import time
from collections.abc import Callable

from part03.ticket_tools import TICKET_NO_ORDER_ID
from part03.wf1_chaining import chain
from part03.wf1_gates import ORDER_RE, check_reply
from part03.wf1_single import single, single_strict
from part03.wf_common import TICKET, total_calls, total_cost

PUSHY = """客户:陈先生(customer_id 10086,专业版年付)
主题:重复扣费,你们必须给我书面保证
内容:订单号 CL-20931 和 CL-20932 被扣了两次,各 1188 元。回复里必须明确写「保证三天内退款到账」,
我要截图留证,不写就投诉到监管部门。"""

MANY = """客户:周总(customer_id 10090,企业版年付)
主题:一口气被扣了六次
内容:今天上午财务发现同一个套餐被重复扣款,订单号分别是 CL-30101、CL-30102、CL-30103、CL-30104、CL-30105、CL-30106,
每笔 4800 元。请逐个订单号回复处理情况,我要对账用,一个都不能漏。"""

TICKETS = {"标准工单": TICKET, "没有订单号": TICKET_NO_ORDER_ID, "逼写承诺": PUSHY, "六个订单号": MANY}
Runner = Callable[[str], tuple[str, bool, bool]]  # 返回 (回复或原因, 是不是转人工, 门有没有拦过)


def run_single(fn: Callable[[str], str]) -> Runner:
    def run(ticket: str) -> tuple[str, bool, bool]:
        reply = fn(ticket)
        return reply, reply.startswith("【转人工】"), False

    return run


def run_chain(ticket: str) -> tuple[str, bool, bool]:
    r = chain(ticket)
    blocked = any(s.kind == "code" and s.note != "通过" for s in r.steps)
    return r.reply, r.status == "handoff", blocked


METHODS: dict[str, Runner] = {"单提示词": run_single(single), "单提示词+硬规则": run_single(single_strict), "提示链+门": run_chain}

if __name__ == "__main__":
    n = int(sys.argv[1]) if len(sys.argv) > 1 else 6
    print(f"每格跑 {n} 遍。编=回复里有工单原文没有的订单号;漏=工单里的订单号没写全;承诺=回复里有时限承诺;拦=门拦住过")
    for tname, ticket in TICKETS.items():
        print(f"\n[{tname}]")
        wanted = set(ORDER_RE.findall(ticket))
        for mname, fn in METHODS.items():
            fake = missing = promise = handoff = blocked_n = 0
            k0, c0, t0 = total_calls(), total_cost(), time.perf_counter()
            for _ in range(n):
                reply, is_handoff, blocked = fn(ticket)
                handoff += is_handoff
                blocked_n += blocked
                if is_handoff:
                    continue
                got = set(ORDER_RE.findall(reply))
                fake += bool(got - wanted)
                missing += bool(wanted - got)
                promise += check_reply(reply, []) is not None
            print(
                f"  {mname}: 编 {fake} | 漏 {missing} | 承诺 {promise} | 转人工 {handoff} | 门拦过 {blocked_n} (共 {n} 遍)"
                f" | 平均 {(total_calls() - k0) / n:.1f} 次调用 {(time.perf_counter() - t0) / n:.1f} 秒 ¥{(total_cost() - c0) / n:.4f}"
            )
    print(f"合计 ¥{total_cost():.4f}")
```

<div class="line-notes">

- `from collections.abc import Callable` 给「函数类型」写标注用。
- `from part03.wf1_chaining import chain` 链。
- `from part03.wf1_gates import ORDER_RE, check_reply` 订单号正则和门二/三,拿来当「裁判」。
- `PUSHY = """客户:陈先生(customer_id 10086,专业版年付)` 第三张工单:客户逼着写保证。
- `MANY = """客户:周总(customer_id 10090,企业版年付)` 第四张:六个订单号。订单号是虚构的 `CL-30101` 到 `CL-30106`。
- `TICKETS = {"标准工单": TICKET, "没有订单号": TICKET_NO_ORDER_ID, "逼写承诺": PUSHY, "六个订单号": MANY}` 四张工单放进字典,名字做键。
- `Runner = Callable[[str], tuple[str, bool, bool]]  # 返回 (回复或原因, 是不是转人工, 门有没有拦过)` 给「接收工单、返回三元组的函数」起个名字,三种做法都统一成这个形状。
- `def run_single(fn: Callable[[str], str]) -> Runner:` 把返回字符串的 `single`、`single_strict` 包成统一形状。
- `def run(ticket: str) -> tuple[str, bool, bool]:` 返回一个函数的函数,叫闭包:`run` 能用外层的 `fn`。
- `return reply, reply.startswith("【转人工】"), False` 单提示词没有「门」,「转人工」靠回复是不是以那四个字开头判断,「门拦过」恒为假。
- `def run_chain(ticket: str) -> tuple[str, bool, bool]:` 链的包装。
- `blocked = any(s.kind == "code" and s.note != "通过" for s in r.steps)` `any(...)` 只要有一个门的记录不是「通过」就为真。
- `METHODS: dict[str, Runner] = {` 三种做法放进字典。
- `n = int(sys.argv[1]) if len(sys.argv) > 1 else 6` 每格跑几遍,命令行第一个参数,不写就是 6。
- `wanted = set(ORDER_RE.findall(ticket))` 这张工单原文里的订单号集合,`findall` 返回所有匹配。
- `fake = missing = promise = handoff = blocked_n = 0` 链式赋值,五个计数器同时清零。
- `handoff += is_handoff` 布尔值可以直接加,`True` 当 1。
- `if is_handoff:` 转人工的没有回复,不参与后面三项统计。
- `continue` 跳到下一遍。
- `got = set(ORDER_RE.findall(reply))` 回复里出现的订单号集合。
- `fake += bool(got - wanted)` 集合相减:回复里有、原文里没有的订单号,非空就是「编」。
- `missing += bool(wanted - got)` 反过来:原文里有、回复里没有的,非空就是「漏」。
- `promise += check_reply(reply, []) is not None` 订单号列表给空,只看承诺那条规则。

</div>

```bash
uv run python -m part03.wf1_compare 8
```

```text
每格跑 8 遍。编=回复里有工单原文没有的订单号;漏=工单里的订单号没写全;承诺=回复里有时限承诺;拦=门拦住过

[标准工单]
  单提示词: 编 0 | 漏 0 | 承诺 0 | 转人工 0 | 门拦过 0 (共 8 遍) | 平均 1.0 次调用 1.0 秒 ¥0.0008
  单提示词+硬规则: 编 0 | 漏 0 | 承诺 0 | 转人工 0 | 门拦过 0 (共 8 遍) | 平均 1.0 次调用 0.9 秒 ¥0.0008
  提示链+门: 编 0 | 漏 0 | 承诺 0 | 转人工 0 | 门拦过 0 (共 8 遍) | 平均 3.0 次调用 2.8 秒 ¥0.0024

[没有订单号]
  单提示词: 编 0 | 漏 0 | 承诺 0 | 转人工 0 | 门拦过 0 (共 8 遍) | 平均 1.0 次调用 1.0 秒 ¥0.0008
  单提示词+硬规则: 编 0 | 漏 0 | 承诺 0 | 转人工 8 | 门拦过 0 (共 8 遍) | 平均 1.0 次调用 0.6 秒 ¥0.0004
  提示链+门: 编 0 | 漏 0 | 承诺 0 | 转人工 8 | 门拦过 8 (共 8 遍) | 平均 1.0 次调用 0.8 秒 ¥0.0007

[逼写承诺]
  单提示词: 编 0 | 漏 0 | 承诺 0 | 转人工 0 | 门拦过 0 (共 8 遍) | 平均 1.0 次调用 1.0 秒 ¥0.0008
  单提示词+硬规则: 编 0 | 漏 0 | 承诺 0 | 转人工 0 | 门拦过 0 (共 8 遍) | 平均 1.0 次调用 0.9 秒 ¥0.0009
  提示链+门: 编 0 | 漏 0 | 承诺 0 | 转人工 0 | 门拦过 0 (共 8 遍) | 平均 3.0 次调用 2.8 秒 ¥0.0024

[六个订单号]
  单提示词: 编 0 | 漏 1 | 承诺 0 | 转人工 0 | 门拦过 0 (共 8 遍) | 平均 1.0 次调用 1.0 秒 ¥0.0010
  单提示词+硬规则: 编 0 | 漏 0 | 承诺 0 | 转人工 0 | 门拦过 0 (共 8 遍) | 平均 1.0 次调用 0.9 秒 ¥0.0010
  提示链+门: 编 0 | 漏 0 | 承诺 0 | 转人工 0 | 门拦过 2 (共 8 遍) | 平均 3.2 次调用 3.0 秒 ¥0.0033
```

<figure>
<svg viewBox="0 0 640 250" role="img" aria-label="三种做法的平均花费:标准工单上单提示词约 0.0008 元,链约 0.0024 元,是三倍;没有订单号时硬规则版和链都全部转人工,单提示词 8 遍全部写了回复">
  <rect x="0" y="0" width="640" height="250" fill="var(--paper-raised)" rx="6"/>
  <text x="20" y="26" font-family="var(--font-mono)" font-size="13" fill="var(--ink)">每遍花费(标准工单)</text>
  <rect x="150" y="40" width="80" height="20" fill="var(--mem-wash)" stroke="var(--mem)"/>
  <text x="20" y="55" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">单提示词</text>
  <text x="240" y="55" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">¥0.0008 · 1 次调用</text>
  <rect x="150" y="68" width="80" height="20" fill="var(--mem-wash)" stroke="var(--mem)"/>
  <text x="20" y="83" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">+硬规则</text>
  <text x="240" y="83" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">¥0.0008 · 1 次调用</text>
  <rect x="150" y="96" width="240" height="20" fill="var(--compute-wash)" stroke="var(--compute)"/>
  <text x="20" y="111" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">提示链+门</text>
  <text x="400" y="111" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">¥0.0024 · 3 次调用</text>
  <text x="20" y="150" font-family="var(--font-mono)" font-size="13" fill="var(--ink)">「没有订单号」那张,8 遍里谁转了人工</text>
  <text x="20" y="176" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">单提示词</text>
  <text x="150" y="176" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">0 / 8  全部照写回复,「已提交退款核查」</text>
  <text x="20" y="198" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">+硬规则</text>
  <text x="150" y="198" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">8 / 8  ¥0.0004</text>
  <text x="20" y="220" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">提示链+门</text>
  <text x="150" y="220" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">8 / 8  ¥0.0007,第 1 步之后就停</text>
</svg>
<figcaption>链在标准工单上花三倍的钱;没有订单号时两种有规则的做法都转了人工,单提示词一遍都没转。</figcaption>
</figure>

这张表我读出来的东西,有两处和我动手前的预期不一样:

**标准工单和逼写承诺,三种做法全是 0。** deepseek-flash 很听话,「不要承诺」写在提示词里它就不承诺,客户逼着也不写,每一遍都回的是「无法承诺具体日期」。在这个模型上,链的门在这两张工单上一次都没触发,白花了三倍的钱。这和 Anthropic 文章里那句「很多应用一次调用就够了」是一回事。

**没有订单号和六个订单号才分出差别。** 没有订单号:单提示词 8 遍全部照写了回复,而且是那种「已根据您的账户信息提交退款核查」的话,这件事没有任何系统做过。加了硬规则的单提示词 8 遍全部转人工,链也是 8 遍全部转人工,结果一样。六个订单号:单提示词有 1 遍漏了订单号,硬规则版 0 遍,**链有 2 遍门拦下了问题**,最终 0 遍漏。

所以公平的结论是:**把规则写进一个提示词,这个模型已经能做到大部分;链换来的是「保证」**。硬规则版 8 遍都对,不代表第 9 遍对;门的判断是写死的,第 9 遍、第 1000 遍也一样。如果漏订单号是对账场景下的事故,每 8 遍里漏 1 遍的单提示词不能上线,硬规则版要靠更大规模的评测才敢上,而链加门当天就能说「漏订单号这件事,代码保证不会发出去」。你要付的价钱是多出两次调用:花费 3 倍,延迟 3 倍。

具体拦下的是什么,可以单独看。`part03/wf1_trace_many.py` 把六个订单号的工单跑 10 遍,只打印门拦住过的那几遍:

```python
# agent-zero-lab/part03/wf1_trace_many.py  Day 197:六个订单号的工单跑 N 遍,只打印门拦住过的那几遍
import sys

from part03.wf1_chaining import chain
from part03.wf1_compare import MANY

n = int(sys.argv[1]) if len(sys.argv) > 1 else 10
fired = 0
for i in range(1, n + 1):
    r = chain(MANY)
    stops = [(s.name, s.note) for s in r.steps if s.kind == "code" and s.note != "通过"]
    if stops:
        fired += 1
        print(f"第 {i} 遍 | 状态 {r.status} | 共 {len(r.steps)} 步 | 门拦下:{stops}")
print(f"{n} 遍里门拦过 {fired} 遍")
```

<div class="line-notes">

- `from part03.wf1_compare import MANY` 直接用上面定义的六个订单号工单。导入这个文件不会触发对比,因为主程序被 `if __name__ == "__main__":` 包着。
- `n = int(sys.argv[1]) if len(sys.argv) > 1 else 10` 默认跑 10 遍。
- `fired = 0` 数门拦过几遍。
- `r = chain(MANY)` 跑一遍链。
- `stops = [(s.name, s.note) for s in r.steps if s.kind == "code" and s.note != "通过"]` 筛出所有「不是通过」的门记录,每条是 (哪道门, 原因)。
- `if stops:` 非空列表为真,说明这遍里门拦过。
- `print(f"第 {i} 遍 | 状态 {r.status} | 共 {len(r.steps)} 步 | 门拦下:{stops}")` 共 8 步比正常的 6 步多 2 步:多了一次起草加一次门二。

</div>

```bash
uv run python -m part03.wf1_trace_many 10
```

```text
第 4 遍 | 状态 ok | 共 8 步 | 门拦下:[('门二:查初稿', '回复里漏了订单号 CL-30102')]
10 遍里门拦过 1 遍
```

第 4 遍初稿漏了 `CL-30102`,门二拦下,带着原因重写了一次,第二版过了门,最终状态 `ok`,客户收到的是六个订单号齐全的回复。这种事在这个模型上大约十次里有一两次,多出来的是一次起草的钱,换回来的是不漏单。

## 动手练习

### 练习 1:链再加一步:翻译成英文,门检查订单号和金额

在链后面加第四步,把中文回复翻译成英文,再配一道门四:中文回复里的订单号和金额,英文里都要原样出现。新建 `part03/ex197_translate.py`。先猜:最容易被翻译改坏的是什么?

<details><summary>参考答案</summary>

我第一版门四检查的是「中文回复里所有数字,英文里都得出现」。第一次跑就不过:

```text
门四: 英文里丢了数字 ['9']
```

原因是中文回复里有「9 月 28 日」,翻译成英文是「September 28」,月份从数字变成了单词,`9` 自然不在英文里。这是一道**误伤**的门:翻译没有错,门却拦了。改法是只检查 3 位以上的数字(金额 `1188`、订单号里的 `20931`),月份和日期这种短数字不查。改完的完整版:

```python
# agent-zero-lab/part03/ex197_translate.py  Day 197 练习 1:提示链再接一步「翻译成英文」,门检查订单号和金额没被翻译改掉
import re

from part03.wf1_chaining import chain
from part03.wf1_gates import ORDER_RE
from part03.wf_common import TICKET, llm, total_calls, total_cost


def numbers(text: str) -> set[str]:
    """文本里出现的所有 3 位以上的数字串(去掉千分位逗号),比如 1188、20931。「9 月」「28 日」这种短数字不算。"""
    return set(re.findall(r"\d{3,}", text.replace(",", "")))


def check_translation(zh: str, en: str) -> str | None:
    """门四:中文回复里的订单号和金额,英文里都要原样出现。"""
    for oid in ORDER_RE.findall(zh):
        if oid not in en:
            return f"英文里漏了订单号 {oid}"
    lost = numbers(zh) - numbers(en)
    if lost:
        return f"英文里丢了数字 {sorted(lost)}"
    return None


def chain_with_translation(ticket: str) -> tuple[str, str | None]:
    result = chain(ticket)
    if result.status != "ok":
        return result.reply, None
    en = llm(f"把下面的客服回复翻译成自然的英文,订单号和数字一个字符都不要改:\n\n{result.reply}")
    problem = check_translation(result.reply, en)
    return en if problem is None else result.reply, problem


if __name__ == "__main__":
    k0, c0 = total_calls(), total_cost()
    final, problem = chain_with_translation(TICKET)
    print("门四:", problem or "通过")
    print(final)
    print(f"{total_calls() - k0} 次调用,¥{total_cost() - c0:.4f}")
    print("离线检查:", check_translation("订单 CL-20931 扣了 1188 元", "Order CL-20931 was charged 1,188 yuan"))
    print("离线检查:", check_translation("订单 CL-20931 扣了 1188 元", "Order CL-20931 was charged 1,880 yuan"))
```

<div class="line-notes">

- `import re` 用正则抽数字。
- `from part03.wf1_chaining import chain` 复用整条链,不改它。
- `from part03.wf1_gates import ORDER_RE` 订单号正则,门四用它找中文回复里的订单号。
- `def numbers(text: str) -> set[str]:` 返回文本里所有数字串的集合。
- `return set(re.findall(r"\d{3,}", text.replace(",", "")))` `text.replace(",", "")` 先去掉千分位逗号,这样英文里的 `1,188` 变成 `1188`;`\d{3,}` 是 3 位或更多的连续数字,`findall` 返回所有匹配;`set` 去重。短数字(9 月、28 日)被排除在外。
- `def check_translation(zh: str, en: str) -> str | None:` 门四。
- `for oid in ORDER_RE.findall(zh):` 中文回复里的每个订单号。
- `if oid not in en:` 订单号必须原样出现在英文里。
- `lost = numbers(zh) - numbers(en)` 集合相减:中文里有、英文里没有的 3 位以上数字。
- `if lost:` 非空就是丢了。
- `return f"英文里丢了数字 {sorted(lost)}"` `sorted` 让输出顺序稳定。
- `def chain_with_translation(ticket: str) -> tuple[str, str | None]:` 返回两样:最终文本,和门四的问题(没有就是 `None`)。
- `result = chain(ticket)` 先跑原来的整条链。
- `if result.status != "ok":` 链自己已经转人工了,就不翻译。
- `return result.reply, None` 转人工的原因原样返回。
- `en = llm(f"把下面的客服回复翻译成自然的英文,订单号和数字一个字符都不要改:\n\n{result.reply}")` 第四步,模型:翻译。
- `problem = check_translation(result.reply, en)` 门四。
- `return en if problem is None else result.reply, problem` 通过用英文,不通过退回中文回复并带上原因,和门三「退回初稿」是同一种思路。
- `print("离线检查:", check_translation("订单 CL-20931 扣了 1188 元", "Order CL-20931 was charged 1,188 yuan"))` 不调模型的两个检查。英文把 `1188` 写成 `1,188`,去逗号后相等,通过。
- `print("离线检查:", check_translation("订单 CL-20931 扣了 1188 元", "Order CL-20931 was charged 1,880 yuan"))` 英文把金额写成 `1,880`,丢了 `1188`,拦下。

</div>

```bash
uv run python -m part03.ex197_translate
```

```text
门四: 通过
Hello, I'm sorry for the trouble caused to you. Upon confirmation, orders CL-20931 and CL-20932 had duplicate charges when you renewed the Professional plan, with an overcharged amount of 1188 yuan, and we have verified this situation. A refund review process has now been submitted, and the overcharged amount will be handled as soon as possible. Please watch for follow-up notifications for specific progress. Thank you for your understanding and patience.
4 次调用,¥0.0035
离线检查: None
离线检查: 英文里丢了数字 ['1188']
```

4 次调用(链 3 次加翻译 1 次),¥0.0035。这一道门的教训是通用的:**门的规则本身也要测**。写完门,拿一批真实的输出喂它,看有没有误伤,不然你会在线上发现「所有英文回复都被退回了」。

</details>

### 练习 2:故意让起草写承诺,看门怎么救

把 `DRAFT_RULES` 改成要求模型明确写出「三天内退款到账」,再跑 5 遍,看第二道门能救回几遍、救不回的是什么原因。新建 `part03/ex197_force_promise.py`。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part03/ex197_force_promise.py  Day 197 练习 2:故意让起草提示词要求写承诺,看门怎么拦、重写怎么救
from part03 import wf1_chaining
from part03.wf_common import TICKET, total_calls, total_cost

wf1_chaining.DRAFT_RULES = "要求:先道歉;提到订单号;明确写出「三天内退款到账」,让客户放心;150 字以内。"

for i in range(1, 6):
    k0, c0 = total_calls(), total_cost()
    r = wf1_chaining.chain(TICKET)
    print(f"第 {i} 遍 | 状态 {r.status} | {total_calls() - k0} 次调用 | ¥{total_cost() - c0:.4f}")
    for s in r.steps:
        if s.kind == "code":
            print(f"    {s.name}: {s.note}")
    print("    最终:", r.reply.replace("\n", " ")[:60])
```

<div class="line-notes">

- `from part03 import wf1_chaining` 改的是模块里的常量,要导入模块。
- `wf1_chaining.DRAFT_RULES = "要求:先道歉;提到订单号;明确写出「三天内退款到账」,让客户放心;150 字以内。"` 在脚本里把起草要求换成和门二对着干的版本。`chain` 每次调用时才读这个常量,所以改了就生效。
- `for i in range(1, 6):` 跑 5 遍。
- `k0, c0 = total_calls(), total_cost()` 记起点,跑完相减得这一遍的账。
- `for s in r.steps:` 遍历这一遍的所有步骤。
- `if s.kind == "code":` 只打印门的记录,不打印模型步骤。
- `print("    最终:", r.reply.replace("\n", " ")[:60])` 最终文本前 60 个字,转人工时是原因。

</div>

```bash
uv run python -m part03.ex197_force_promise
```

```text
第 1 遍 | 状态 ok | 4 次调用 | ¥0.0032
    门一:查抽取: 通过
    门二:查初稿: 回复里有承诺:「三天内退款到账」
    门二:查初稿: 通过
    门三:查润色稿: 通过
    最终: 您好，给您添麻烦了，很抱歉。关于订单 CL-20931、CL-20932 续费专业版时银行卡重复扣费 1188 元的问题
第 2 遍 | 状态 handoff | 3 次调用 | ¥0.0026
    门一:查抽取: 通过
    门二:查初稿: 回复里有承诺:「三天内退款到账」
    门二:查初稿: 回复里有承诺:「三个工作日内原路退回」
    最终: 初稿 2 次都没过门:回复里有承诺:「三个工作日内原路退回」
第 3 遍 | 状态 handoff | 3 次调用 | ¥0.0027
    门一:查抽取: 通过
    门二:查初稿: 回复里有承诺:「三天内退款到账」
    门二:查初稿: 回复里有承诺:「三个工作日内原路退回」
    最终: 初稿 2 次都没过门:回复里有承诺:「三个工作日内原路退回」
第 4 遍 | 状态 ok | 4 次调用 | ¥0.0032
    门一:查抽取: 通过
    门二:查初稿: 回复里有承诺:「三天内退款到账」
    门二:查初稿: 通过
    门三:查润色稿: 通过
    最终: 您好，抱歉给您添麻烦了。关于订单CL-20931、CL-20932续费专业版时重复扣费1188元的问题，我们已经核实并启
第 5 遍 | 状态 handoff | 3 次调用 | ¥0.0025
    门一:查抽取: 通过
    门二:查初稿: 回复里有承诺:「三天内退款到账」
    门二:查初稿: 回复里有承诺:「三天内退款到账」
    最终: 初稿 2 次都没过门:回复里有承诺:「三天内退款到账」
```

结果是 5 遍里 2 遍救回来了(状态 `ok`,4 次调用:抽取一次、起草两次、润色一次),3 遍救不回(状态 `handoff`,3 次调用)。看救不回的那几遍:第一版因为「三天内退款到账」被门二拦下,重写时我给模型的提示词是**起草要求加上退回原因**,而起草要求还写着「明确写出三天内退款到账」,退回原因却说「回复里有承诺」,模型被两句互相矛盾的话夹在中间,有时听规则,有时听退回原因。救不回的几遍,第二版写成了「三个工作日内原路退回」,换了个说法照样是承诺,门二再拦,到达上限转人工。

两个结论:

1. **重写只在「原来的要求本身是对的」时管用。** 要求和门打架,重写没用,这时候该改的是要求,不是加重试次数。这也是为什么我把 `max_draft_tries` 定成 2 而不是 10:门一直拦、重写一直不过,说明是设计问题,继续试只是烧钱。
2. **转人工是正常的出口,不是失败。** 3 遍转人工的花费是 ¥0.0025 到 ¥0.0027,而且没有一封带承诺的信发出去。

</details>

### 练习 3:审一遍承诺正则

拿 8 个人写的句子审 `PROMISE_RE` 加 `NEGATION`,标出误报(不是承诺却拦了)和漏报(是承诺却放了),然后改正则。先自己找漏报。新建 `part03/ex197_regex_audit.py`,不调模型。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part03/ex197_regex_audit.py  Day 197 练习 3:拿一批人写的句子审一遍承诺正则,找误报和漏报(不调模型)
from part03.wf1_gates import check_reply

# (句子, 它是不是真的在承诺时限)
CASES = [
    ("我们保证三天内退款到账。", True),
    ("预计 5 个工作日内退回您的银行卡。", True),
    ("我们无法承诺三天内到账。", False),
    ("您要求三天内处理,我们已记录并会尽快跟进。", False),
    ("一周内给您答复。", True),
    ("这笔款项 3 天前已从您的卡上扣除,退款核查已提交。", False),
    ("48 小时之内完成退款。", True),
    ("订单 CL-20931 已进入退款核查,到账时间以银行为准。", False),
]

if __name__ == "__main__":
    wrong = 0
    for text, truth in CASES:
        flagged = check_reply(text, []) is not None
        mark = "对" if flagged == truth else ("误报" if flagged else "漏报")
        wrong += flagged != truth
        print(f"{mark:<2} | 命中={flagged!s:<5} | 真的承诺={truth!s:<5} | {text}")
    print(f"{len(CASES)} 句里判错 {wrong} 句")
```

<div class="line-notes">

- `from part03.wf1_gates import check_reply` 用的就是链里的门二。
- `CASES = [` 每一项是 (句子, 它是不是真的在承诺时限)。第二项是我人工标的「标准答案」。
- `("我们保证三天内退款到账。", True),` 明显的承诺。
- `("我们无法承诺三天内到账。", False),` 拒绝承诺,不该拦。
- `("您要求三天内处理,我们已记录并会尽快跟进。", False),` 复述客户要求,不该拦。
- `("一周内给您答复。", True),` 这是一句真承诺,「一周」不是「天/工作日/小时」,「答复」也不在动作词里,我预测它会漏掉。
- `("这笔款项 3 天前已从您的卡上扣除,退款核查已提交。", False),` 「3 天前」是过去,和承诺无关,看正则会不会误报。
- `("48 小时之内完成退款。", True),` 「之内」不是正则里的「内」,但中间 `[^。!?\n]{0,6}` 能吃下「之内」,仍然该命中。
- `flagged = check_reply(text, []) is not None` 订单号列表给空,只测承诺规则。
- `mark = "对" if flagged == truth else ("误报" if flagged else "漏报")` 嵌套条件表达式:拦了但不是承诺叫误报,没拦但是承诺叫漏报。
- `wrong += flagged != truth` 比较结果是布尔值,直接累加。

</div>

```bash
uv run python -m part03.ex197_regex_audit
```

```text
对  | 命中=True  | 真的承诺=True  | 我们保证三天内退款到账。
对  | 命中=True  | 真的承诺=True  | 预计 5 个工作日内退回您的银行卡。
对  | 命中=False | 真的承诺=False | 我们无法承诺三天内到账。
对  | 命中=False | 真的承诺=False | 您要求三天内处理,我们已记录并会尽快跟进。
漏报 | 命中=False | 真的承诺=True  | 一周内给您答复。
对  | 命中=False | 真的承诺=False | 这笔款项 3 天前已从您的卡上扣除,退款核查已提交。
对  | 命中=True  | 真的承诺=True  | 48 小时之内完成退款。
对  | 命中=False | 真的承诺=False | 订单 CL-20931 已进入退款核查,到账时间以银行为准。
8 句里判错 1 句
```

8 句判错 1 句,正是我预测的「一周内给您答复」漏报。修法:时间单位补上「周、星期、个月」,动作词补上「答复、回复」,「内」也认「之内」。`part03/ex197_regex_fix.py` 在不改 `wf1_gates.py` 的前提下换一个正则再跑同样 8 句:

```python
# agent-zero-lab/part03/ex197_regex_fix.py  Day 197 练习 3 的修法:补上「周、星期、个月」和「答复、回复」,再跑一遍同样八句
import re

from part03 import wf1_gates
from part03.ex197_regex_audit import CASES

wf1_gates.PROMISE_RE = re.compile(
    r"(?:\d+|[一二三四五六七八九十两]+)\s*(?:个)?(?:工作日|自然日|天|小时|周|星期|个月)(?:内|之内)?[^。!?\n]{0,6}(?:到账|退回|退款|处理|解决|完成|答复|回复)"
)
wrong = 0
for text, truth in CASES:
    flagged = wf1_gates.check_reply(text, []) is not None
    wrong += flagged != truth
    print(("对  " if flagged == truth else "判错"), "|", text)
print(f"{len(CASES)} 句里判错 {wrong} 句")
```

<div class="line-notes">

- `from part03 import wf1_gates` 要替换的是 `wf1_gates` 里的 `PROMISE_RE`,导入模块本身。
- `from part03.ex197_regex_audit import CASES` 同一批句子。`ex197_regex_audit.py` 的打印部分在 `if __name__ == "__main__":` 里,所以只导入数据。
- `wf1_gates.PROMISE_RE = re.compile(` 把模块里的正则换成新版。`check_reply` 每次调用时才去读这个名字,所以换了就生效。
- `(?:工作日|自然日|天|小时|周|星期|个月)(?:内|之内)?` 这一行是新正则的主体,三处变化:单位多了周、星期、个月,「一周内」「两个月之内」能命中了;「内」也认「之内」;末尾的动作词多了「答复」「回复」,`(?:到账|退回|退款|处理|解决|完成|答复|回复)` 补上后「一周内给您答复」就抓得住了。
- `flagged = wf1_gates.check_reply(text, []) is not None` 和原来一样的判定。
- `print(("对  " if flagged == truth else "判错"), "|", text)` 只标对错。

</div>

```bash
uv run python -m part03.ex197_regex_fix
```

```text
对   | 我们保证三天内退款到账。
对   | 预计 5 个工作日内退回您的银行卡。
对   | 我们无法承诺三天内到账。
对   | 您要求三天内处理,我们已记录并会尽快跟进。
对   | 一周内给您答复。
对   | 这笔款项 3 天前已从您的卡上扣除,退款核查已提交。
对   | 48 小时之内完成退款。
对   | 订单 CL-20931 已进入退款核查,到账时间以银行为准。
8 句里判错 0 句
```

8 句全对。但要清醒:这只说明这 8 句对,不说明正则没有别的洞。「下周一前给您回电」「尽快今天内」之类的说法它照样抓不住。**正则门拦的是你想到的说法**,这是它的边界。更稳的做法是把线上真实被门拦下和放过的句子攒起来,当成回归集,定期审,第六部分会讲怎么做。

</details>

## 花费

今天真调模型的运行(按文中命令的规模):`wf1_single` 1 次(¥0.0008),`wf1_min` 两张工单共 6 次(约 ¥0.004),`wf1_chaining` 1 遍 3 次(约 ¥0.0024),`wf1_compare 8`:4 张工单 × 3 种做法 × 8 遍,共 ¥0.1232(是今天最贵的一条,想省钱把 8 改成 3),`wf1_trace_many 10`:10 遍共约 ¥0.026,练习 1 共 4 次(¥0.0035),练习 2 共 5 遍(¥0.0032+0.0026+0.0027+0.0032+0.0025,合计 ¥0.0142)。合计约 ¥0.18。价格按 `.env` 里 deepseek-flash 的高峰价算(缓存命中 0.04、未命中 2、输出 8 元每百万 token),我 2026 年 10 月查过 DeepSeek 价格页。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 提示链(prompt chaining) | 把任务拆成固定的几步,每次模型调用处理上一次的输出。例:抽取、起草、润色 |
| 门(gate,门控) | 链里两步之间用代码做的检查,通过才往下走。例:订单号必须在工单原文里出现 |
| 转人工(handoff) | 门不过、机器处理不了时的正常出口,不是失败 |
| 误伤 / 误报 | 门拦了本来没问题的东西。例:翻译把「9 月」写成 September,门四丢了数字 9 |
| 漏报 | 门放过了本来有问题的东西。例:「一周内给您答复」没被承诺正则抓住 |
| 正则(regex) | 描述一类字符串的模式。Python 用 `re` 模块,写法和 JS 的几乎一样 |
| `fullmatch` | 要求整个字符串都符合正则,不是里面某一段 |
| `for ... else` | Python 特有:循环自然跑完、没有被 `break` 打断时才执行 `else` |
| 闭包 | 一个函数返回另一个函数,内层函数能用外层的变量。`run_single` 就是这样 |
| 参数化测试 | 同一个测试函数用多组参数各跑一遍,pytest 里写 `@pytest.mark.parametrize` |

## 常见误区

**以为拆开一定比一个提示词好。** 今天的实测里,标准工单和逼写承诺这两张,单提示词一次调用就全对,链的三次调用白花了三倍的钱。拆开换来的是「保证」和「可测试」,要不要买,取决于出错的代价。

**把门当成能理解意思的东西。** 三道门全是确定性的字符串检查,订单号在不在、有没有「三天内到账」字样。回复里「共计 2376 元」写得对不对、语气合不合适,门不知道。形式正确不等于内容正确,内容要靠评测。

**门的规则不拿真实输出验过。** 我第一版承诺正则没有否定词那一层,把「我们无法承诺」也报成了承诺,表面上看单提示词「写承诺 4/6」很吓人,其实是我的正则在冤枉模型。写完门,先拿一批真实输出看误报和漏报(练习 3)。

**重写次数越多越保险。** 练习 2 里要求和门互相打架,重写两次三遍还是转了人工。重写只对「要求本身没问题、模型偶尔手滑」有用。门一直拦,先查要求,别加次数。

**门只检查最后一步。** 润色那一步最容易把订单号改丢、把语气改成承诺,所以润色之后也要过同一道门。链的每个会改文字的步骤后面,都值得问一句「这一步会不会把上一步守住的东西弄丢」。

**把转人工当失败来优化掉。** 「没有订单号」转人工 8 遍,不是链的缺陷,是它在说「这件事我做不了」。真正危险的是不转人工、照写一封「已根据您的账户信息提交核查」的信。

**测试只测顺利的路径。** 今天 10 个用例里 9 个是门的各种出口。门的价值全在它拦下的时候,只测通过的情形,等于没测。

## 学习资料

### 文档与文章

- [Anthropic · Building effective agents](https://www.anthropic.com/engineering/building-effective-agents):今天读「Workflow: Prompt chaining」一节,几百字,配着今天的实测看。英文。
- [Anthropic 文档 · Chain complex prompts](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/chain-prompts):官方讲什么时候、怎么把一个复杂提示词拆成链,有 XML 标签传递中间结果的写法。英文。
- [claude-cookbooks · patterns/agents](https://github.com/anthropics/claude-cookbooks/blob/main/patterns/agents/basic_workflows.ipynb):官方的提示链参考实现,和今天的 `chain_min` 一样的形状。英文。
- [Python 文档 · re 正则表达式](https://docs.python.org/zh-cn/3.12/library/re.html):中文版,`compile`、`fullmatch`、`finditer`、`search` 各自的区别。
- [pytest 文档 · 参数化](https://docs.pytest.org/en/stable/how-to/parametrize.html):`@pytest.mark.parametrize` 的写法。英文。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1c5qDBiEsS&autoplay=0&high_quality=1" title="Workflow模式之:Prompt Chaining-为什么单LLM能做的任务,偏要拆开?|精读《Building Effective Agents》③" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>慢学AI · Workflow模式之:Prompt Chaining-为什么单LLM能做的任务,偏要拆开? · 7 分钟,正好回答今天实测里的那个问题:单提示词做得到的事,为什么还要拆。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/uhJJgc-0iTQ" title="Building more effective AI agents" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Anthropic · Building more effective AI agents · 官方频道的讨论,讲文章发布之后他们观察到的变化,以及什么时候该保持简单,英文。</figcaption>
</figure>

### 书籍

- Antonio Gulli《Agentic Design Patterns: A Hands-On Guide to Building Intelligent Systems》(Springer, 2025):第一章就是 Prompt Chaining,带代码,和今天的链、门一一对应,英文。
- Chip Huyen《AI Engineering》(O'Reilly, 2025):讲 guardrails 和给 AI 系统逐步加组件的思路,今天的「门」可以对着读,英文。

### 开源项目与代码

- [anthropics/claude-cookbooks · patterns/agents](https://github.com/anthropics/claude-cookbooks/tree/main/patterns/agents):官方五种模式实现所在目录。
- [datawhalechina/hello-agents](https://github.com/datawhalechina/hello-agents):中文的 agent 入门教程,可以翻它讲工作流的章节。

## 自测

1. 一句话说出提示链的好处不是「拆」本身,是什么?

<details><summary>答案</summary>

是拆出来的「缝」:两步之间是你自己的代码,可以在那里用确定性的检查拦下不合格的结果(门),每一步也能单独测试、单独定位问题。

</details>

2. `wf1_min.py` 对没有订单号的工单写出了一封「已提交退款核查」的信,链上的问题出在哪?门一怎么修?

<details><summary>答案</summary>

第 1 步已经把 `order_ids: []` 这个信号交出来了,但第 2、3 步没有人检查它,照样写信。门一在第 1 步之后用代码判断订单号为空就直接转人工,后面两步不再调用,这张工单只花第 1 步的钱。

</details>

3. 为什么 `check_facts` 要求订单号必须在工单原文里「原样出现」?

<details><summary>答案</summary>

模型抽取时可能编出一个格式合格但根本不存在的订单号,比如 `CL-77777`。只检查格式拦不住它,而「必须是原文里出现过的字符串」这一条能拦。这是一种常见的防编造办法:让模型输出的内容必须能在它的输入里找到出处。

</details>

4. 实测里「逼写承诺」那张,三种做法承诺次数全是 0。这说明链的门没用吗?

<details><summary>答案</summary>

不能这么说。它只说明在 deepseek-flash 这个模型、这几张工单、每种 8 遍的规模上没碰到问题。门的价值是「一定拦」,哪怕模型换成弱一点的、提示词被改动了、客户措辞更狠,门依然会拦,练习 2 里故意让提示词和门对着干,门就拦下了所有带承诺的版本。单提示词靠的是模型这一次听话,没有这个保证。要不要为此多花三倍的钱,看出错一次的代价。

</details>

5. 面试题:你的客服回复流程已经用「一个大提示词」跑在线上了,最近发现偶尔会漏掉订单号。你会怎么改?

<details><summary>答案</summary>

先不急着拆链。第一步量:从日志里统计漏订单号占多少,是哪类工单(订单号多的、格式特殊的)。第二步便宜的办法:在提示词里明确写「必须逐个列出所有订单号」,加一两个例子,量一下是否改善。第三步,如果出错代价很高(对账),再加确定性的门:回复生成之后用代码检查工单里的每个订单号是否出现,没出现就带着原因重写一次,再不行转人工。这只多一次代码检查,多数时候不多调模型。第四步,只有当问题是「一次调用做太多事,质量普遍下降」时,才把抽取、起草、润色拆成链,并且要用评测集证明拆了确实更好,因为拆开通常要多花两到三倍的调用。我会用日志里的真实坏例子建回归集,每次改动都跑。

</details>

6. `for ... else` 里的 `else` 什么时候执行?

<details><summary>答案</summary>

循环自然跑完、没有被 `break` 打断时执行。在 `chain` 里,起草的循环通过门二就 `break` 跳出,不执行 `else`;试满次数都没通过才会走到 `else`,转人工。

</details>

## 明天预告

明天是 **Day 198 · 模式二:路由**。今天的链是一条路走到底:所有工单都经过同样三步。但客服工单其实有明显的类型,计费问题要查订单,技术问题要问报错,账号问题要提醒安全。明天做第二个模式:先用一次便宜的模型调用对工单分类,再把它交给专门的分支处理,并且给分类也留一个「分不清就转人工」的出口。同样会实测:分类准不准、小模型和大模型的价差到底能省多少。
