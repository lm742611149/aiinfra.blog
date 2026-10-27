---
title: 'Day 201 · 模式五:评估者-优化者'
description: '第五种 workflow 模式:一个模型生成,另一个按标准评估并指出问题,生成的一方带着问题重写,循环到通过。今天的重点是评估者本身靠不靠谱:纯模型评估者把两条合格回复全判成不及格;改成「能用代码查的用代码,只有语气和下一步交给模型」后,10 条人工回复各评 6 遍共 60 次全部评对。循环要有三种停法;实测里一张重复扣费工单 2 到 3 轮能过,多件事的工单因为字数上限不合理 4 遍全部用完 3 轮。'
pubDate: 2026-10-27
regime: none
tags: ['workflow', 'evaluator-optimizer', 'reflection', 'agent-zero']
series: 'agent-zero'
day: 201
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 200](/blog/agent-zero/day-200-orchestrator/) 做了编排者-工作者:模型看了工单决定拆成几个子任务,一批工作者并行写各自那一段,综合者合成一封回复。实测里它比「一个提示词写完」贵三到四倍,但多件事的工单过回复门 26/32,一个提示词只有 5/32,多出来的那一遍改写把承诺句滤掉了。回复里还留着一个漏洞:「已为您核实订单……」这种客服根本没查过的说法,工作者会写,综合者会抄,回复门不管。

今天的模式正好是冲着这类问题去的:**评估者-优化者**。一个模型写,另一个按标准挑毛病,写的一方带着毛病重写,再评,直到过关。这是五种 workflow 模式里唯一带「循环」的,所以会冒出前四个都没有的新问题:评估者自己靠不靠谱,循环什么时候该停。

## 今天要解决的问题

学完今天,你应该能:

1. 说出评估者-优化者适合什么任务,以及它和 Day 197 的提示链(门不过就重写)有什么不同。
2. 设计评估标准:哪几条交给代码,哪几条才交给模型,并用带标准答案的样本测一测评估者本身。
3. 写出生成-评估循环,带三种停法(通过、用完轮数、同样的问题出现两次),没通过的稿子不发给客户。
4. 用实测说清循环什么时候收敛、什么时候不收敛,以及生成的一方怎么「钻评估者的空子」。

今天两个新概念:**评估者-优化者**(evaluator-optimizer)和**评估标准**(rubric)。

预计用时 3 小时。前置:[Day 196](/blog/agent-zero/day-196-workflow-vs-agent/)(`wf_common.py`)、[Day 197](/blog/agent-zero/day-197-chaining/)(`wf1_gates.py` 的 `check_reply`、`ORDER_RE`)、[Day 198](/blog/agent-zero/day-198-routing/)(`.env` 里的 `LLM_BIG_MODEL`,「不信任模型输出」的解析写法)、[Day 199](/blog/agent-zero/day-199-parallelization/)(`gather` 的用法)、[Day 200](/blog/agent-zero/day-200-orchestrator/)(`wf4_tickets.py` 里的三张多件事工单)、[Day 74](/blog/agent-zero/day-074-pytest-4/)(monkeypatch)。代码在 `agent-zero-lab/part03/` 和 `tests/`,命令都在 `agent-zero-lab/` 根目录跑。今天不用装新东西。真调模型,按文中命令跑一遍约 ¥0.5(`wf5_judge_raw` 里用了贵一档的模型,占了一半),算法见文末「花费」。

学法:先对照文章逐行敲一遍(不复制粘贴)并跑通;第二天合上文章,默写 `code_checks`(代码关)和 `evaluate_optimize`(循环,含三种停法);做练习时先自己写,做不出再展开参考答案,看完关掉自己重写一遍。

## 评估者-优化者是什么

流程只有四步:生成一稿;评估者按标准检查,给出「通过」或「问题清单」;没通过就把问题清单交给生成的一方重写;再评,直到通过或者放弃。

<br>

<figure>
<svg viewBox="0 0 640 260" role="img" aria-label="评估者-优化者:生成一稿,评估者先过代码关再过模型关,通过就出,没通过带着问题重写,最多几轮,连续相同问题就停">
  <rect x="14" y="40" width="84" height="40" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
  <text x="56" y="64" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">生成一稿</text>
  <rect x="150" y="14" width="120" height="30" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
  <text x="210" y="33" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">代码关:订单号/承诺/字数</text>
  <rect x="150" y="76" width="120" height="30" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
  <text x="210" y="95" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">模型关:下一步/推卸/编造</text>
  <rect x="330" y="40" width="96" height="40" rx="4" fill="var(--paper-raised)" stroke="var(--rule)"/>
  <text x="378" y="58" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">全过了?</text>
  <text x="378" y="73" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">问题清单</text>
  <rect x="500" y="40" width="126" height="40" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
  <text x="563" y="64" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">通过:才能发</text>
  <rect x="330" y="150" width="130" height="40" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
  <text x="395" y="167" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">优化者重写</text>
  <text x="395" y="182" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">带着具体问题</text>
  <rect x="500" y="150" width="126" height="40" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
  <text x="563" y="167" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">停:3 轮用完 / 同样</text>
  <text x="563" y="182" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">的问题出现两次</text>
  <line x1="98" y1="60" x2="150" y2="30" stroke="var(--rule)"/><line x1="98" y1="60" x2="150" y2="91" stroke="var(--rule)"/>
  <line x1="270" y1="30" x2="330" y2="52" stroke="var(--rule)"/><line x1="270" y1="91" x2="330" y2="68" stroke="var(--rule)"/>
  <line x1="426" y1="60" x2="500" y2="60" stroke="var(--rule)"/>
  <text x="456" y="54" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">是</text>
  <line x1="378" y1="80" x2="395" y2="150" stroke="var(--rule)"/>
  <text x="372" y="118" text-anchor="end" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">否</text>
  <line x1="460" y1="170" x2="500" y2="170" stroke="var(--rule)"/>
  <path d="M330 170 L56 170 L56 80" fill="none" stroke="var(--rule)"/>
  <text x="190" y="164" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">新稿回到评估</text>
  <text x="14" y="240" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">蓝色 = 模型调用,琥珀色 = 代码。代码关先跑,没过就不必花钱请模型评。没通过的稿子不发给客户。</text>
</svg>
<figcaption>评估者-优化者:workflow 里唯一有循环的模式。能用代码查的放前面,模型只评代码查不了的;循环要有三种停法。</figcaption>
</figure>

Anthropic 那篇文章给了两个判断「该不该用它」的信号:一是人给出反馈之后模型的输出能明显变好,二是模型自己也能给出那样的反馈。文学翻译是典型例子:评估者能指出「这个词的细微含义没翻出来」,优化者拿到这句话确实能改好。

它和 [Day 197](/blog/agent-zero/day-197-chaining/) 提示链里「门不过就带着原因重写一次」很像,区别在两点:提示链的门是写死的代码规则,评估者可以是一个会判断的模型,标准可以更模糊;提示链最多重写一次,评估者-优化者是循环,可以改好几轮。能力更强,出问题的地方也更多。

今天的素材还是客服回复,但这次**标准是我们自己定的**,所以要先把标准写清楚。五条:

1. 提到工单里的每个订单号。
2. 不承诺具体的到账日期或处理时限。
3. 不说「已核实」「已确认」「已查到」(客服只是起草,没查过系统)。
4. 给出明确的下一步:我们会做什么,或客户要做什么。
5. 语气诚恳,不推卸责任,不超过 150 字。

## 评估者本身靠不靠谱:先拿样本测

评估者是模型的话,它自己也会错:太松,把坏稿放过去;太严,把好稿也打回,循环永远不收敛。所以写循环之前,先单独测评估者。办法和 [Day 198](/blog/agent-zero/day-198-routing/) 测分类器一样:准备一批带标准答案的样本。

我手写了 10 条针对陈先生那张工单的回复,每条标了「该不该通过」:两条合格的,八条各犯一种错(承诺时限、漏订单号、谎称已核实、推卸责任、没下一步、编造原因、编造补偿、太长)。新建 `part03/wf5_samples.py`:

```python
# agent-zero-lab/part03/wf5_samples.py  Day 201:评估者测试用的 10 条回复,针对 Day 196 那张重复扣费工单,人工写的,每条标了「该不该通过」
SAMPLES: list[tuple[str, str, bool]] = [
    ("好", "陈先生您好,抱歉让您遇到这个问题。您反馈的订单 CL-20931 和 CL-20932 重复扣款,我们会提交退款核查,结果出来后邮件通知您。到账时间取决于发卡银行,我们无法承诺具体日期。", True),
    ("好2", "陈先生您好,抱歉给您添麻烦了。关于订单 CL-20931 和 CL-20932 被扣两次的情况,我们会提交退款核查并邮件告知结果。您不需要再做什么,到账时间看发卡银行。", True),
    ("承诺时限", "陈先生您好,抱歉。订单 CL-20931 和 CL-20932 重复扣款,我们将在 3 个工作日内为您退款。", False),
    ("漏订单号", "陈先生您好,抱歉让您久等。多扣的那一笔我们会提交退款申请,请您留意银行通知。", False),
    ("谎称已核实", "陈先生您好,我们已核实您的订单 CL-20931 和 CL-20932 确实被重复扣款,退款申请已提交。到账时间取决于银行。", False),
    ("推卸", "陈先生,重复扣费一般是银行或支付渠道的问题,和我们系统无关,订单 CL-20931 和 CL-20932 请您自行联系发卡行处理。", False),
    ("没下一步", "陈先生您好,非常抱歉给您带来不便,订单 CL-20931 和 CL-20932 的情况我们已经收到,感谢您的理解与支持。", False),
    ("编造原因", "陈先生您好,抱歉。订单 CL-20931 和 CL-20932 重复扣款,是因为支付回调重复触发,技术已经修复。我们会提交退款核查,结果出来后邮件通知您。", False),
    ("编造补偿", "陈先生您好,抱歉。关于订单 CL-20931 和 CL-20932 重复扣款,我们会提交退款核查并邮件告知结果。为表歉意,还会为您的账号延长 1 个月专业版有效期。", False),
    ("太长", "陈先生您好!首先非常抱歉让您在续费的时候遇到这样不愉快的经历,这确实不应该发生,我们对此深表歉意。您反馈的订单 CL-20931 和 CL-20932 在 9 月 28 日被扣了两次 1188 元,我们非常理解您此刻的心情,也理解您对我们产品的信任被动摇。关于这件事,我们会第一时间把您的情况提交给负责退款核查的同事,由同事逐笔核对支付记录,并根据核查的结果决定后续的处理方式。核查结果出来之后,我们会通过您注册时使用的邮箱把结果完整地告诉您。到账时间取决于您的发卡银行,我们没有办法替银行承诺具体的日期,还请您谅解。再次为这次的不便向您致歉,感谢您一直以来对云簿的支持。", False),
]
```

<div class="line-notes">

- `SAMPLES: list[tuple[str, str, bool]] = [` 每项三个值:名字、回复文字、该不该通过。
- `("好", "陈先生您好,抱歉让您遇到这个问题。您反馈的订单 CL-20931 和 CL-20932 重复扣款,我们会提交退款核查,结果出来后邮件通知您。到账时间取决于发卡银行,我们无法承诺具体日期。", True),` 合格样本 1:两个订单号都在,下一步明确(提交核查加邮件通知),把「到账时间取决于银行」说成事实而不是推卸,明说不承诺日期。
- `("好2",` 合格样本 2:更短,同样合格。
- `("承诺时限", "陈先生您好,抱歉。订单 CL-20931 和 CL-20932 重复扣款,我们将在 3 个工作日内为您退款。", False),` 犯第 2 条:写了「3 个工作日内」。
- `("漏订单号", "陈先生您好,抱歉让您久等。多扣的那一笔我们会提交退款申请,请您留意银行通知。", False),` 犯第 1 条:一个订单号都没提。
- `("谎称已核实", "陈先生您好,我们已核实您的订单 CL-20931 和 CL-20932 确实被重复扣款` 犯第 3 条。
- `("推卸", "陈先生,重复扣费一般是银行或支付渠道的问题,和我们系统无关` 犯第 5 条里的推卸。
- `("没下一步", "陈先生您好,非常抱歉给您带来不便,订单 CL-20931 和 CL-20932 的情况我们已经收到,感谢您的理解与支持。", False),` 犯第 4 条:什么动作都没说。
- `("编造原因", "陈先生您好,抱歉。订单 CL-20931 和 CL-20932 重复扣款,是因为支付回调重复触发,技术已经修复。` 这条是我跑了几遍循环之后补进去的,第一版标准里没有「不编造」。下面「循环」一节会讲为什么要补。
- `("编造补偿", "陈先生您好,抱歉。关于订单 CL-20931 和 CL-20932 重复扣款,我们会提交退款核查并邮件告知结果。为表歉意,还会为您的账号延长 1 个月专业版有效期。", False),` 客服没有权力承诺的补偿。
- `("太长", "陈先生您好!首先非常抱歉让您在续费的时候遇到这样不愉快的经历` 一条 286 个字的回复,犯第 5 条的字数。

</div>

第一个评估者最朴素:把五条标准全交给模型,让它逐条检查。这一版就是 Anthropic 例子里的写法。新建 `part03/wf5_judge_raw.py`,每条样本评 6 遍,同时测默认的小模型和贵一档的大模型(`.env` 里的 `LLM_BIG_MODEL`,[Day 198](/blog/agent-zero/day-198-routing/) 配过):

```python
# agent-zero-lab/part03/wf5_judge_raw.py  Day 201:先单独测评估者本身。10 条人工写的回复,每条让纯模型评估者评 N 遍,看它抓得住几条
import asyncio

from part03.wf5_samples import SAMPLES
from part03.wf_common import BIG_MODEL, MODEL, allm_json, total_cost

N = 6
TICKET_SHORT = "陈先生(customer_id 10086)9 月 28 日被扣两次 1188 元,订单号 CL-20931 和 CL-20932,要求退多扣的那笔并给解释。"
RUBRIC = """评审标准(全部满足才 PASS):
1. 回复里提到工单中的每一个订单号
2. 没有承诺具体的到账日期或处理时限
3. 没有声称「已核实」「已确认」「已查到」(客服只是起草,没有查过系统)
4. 给出了明确的下一步(客户要做什么,或者我们会做什么)
5. 语气诚恳,不推卸责任,不超过 150 字"""
JUDGE_PROMPT = RUBRIC + "\n\n工单:{ticket}\n\n待评审的回复:\n{reply}\n\n逐条检查。输出 JSON:{{\"verdict\": \"PASS\" 或 \"FAIL\", \"problems\": [\"...\"]}}"


async def run(model: str) -> None:
    sem = asyncio.Semaphore(10)

    async def one(reply: str) -> str:
        async with sem:
            raw = await allm_json(JUDGE_PROMPT.format(ticket=TICKET_SHORT, reply=reply), model=model)
            return str(raw.get("verdict"))

    print(f"评估者 = {model}")
    for name, reply, should_pass in SAMPLES:
        verdicts = await asyncio.gather(*[one(reply) for _ in range(N)])
        passed = verdicts.count("PASS")
        right = passed if should_pass else N - passed
        print(f"  {name:<6} 标准={'PASS' if should_pass else 'FAIL'}  评对 {right}/{N}")


async def main() -> None:
    await run(MODEL)
    await run(BIG_MODEL)
    print(f"花费 {total_cost():.4f} 元")


if __name__ == "__main__":
    asyncio.run(main())
```

<div class="line-notes">

- `from part03.wf_common import BIG_MODEL, MODEL, allm_json, total_cost` `MODEL` 是默认小模型(`deepseek-flash`),`BIG_MODEL` 是贵一档的(`deepseek-v4-pro`),都是 [Day 198](/blog/agent-zero/day-198-routing/) 之后 `wf_common` 里就有的。
- `N = 6` 每条样本评 6 遍,看评估者稳不稳。
- `TICKET_SHORT = "陈先生(customer_id 10086)9 月 28 日被扣两次 1188 元,订单号 CL-20931 和 CL-20932,要求退多扣的那笔并给解释。"` 工单的缩写版,评估者要知道订单号是哪两个。
- `RUBRIC = """评审标准(全部满足才 PASS):` 就是上面那五条。三引号字符串,保留换行。
- `JUDGE_PROMPT = RUBRIC + "\n\n工单:{ticket}\n\n待评审的回复:\n{reply}\n\n逐条检查。输出 JSON:{{\"verdict\": \"PASS\" 或 \"FAIL\", \"problems\": [\"...\"]}}"` 用 `+` 把标准和后半段拼起来。`{{` 和 `}}` 是 `.format` 里字面花括号的写法。
- `async def run(model: str) -> None:` 对一个模型测全部样本。
- `sem = asyncio.Semaphore(10)` 限制并发,免得被限流。
- `raw = await allm_json(JUDGE_PROMPT.format(ticket=TICKET_SHORT, reply=reply), model=model)` `allm_json` 有 `model` 参数,可以指定用哪个模型。
- `return str(raw.get("verdict"))` 只取 `verdict`,转成字符串。`problems` 这个脚本不用。
- `verdicts = await asyncio.gather(*[one(reply) for _ in range(N)])` 同一条回复同时评 6 遍。
- `passed = verdicts.count("PASS")` 6 遍里判了几次 PASS。
- `right = passed if should_pass else N - passed` 该通过的,判 PASS 是对;不该通过的,判 FAIL 是对。
- `await run(MODEL)` 小模型测一遍。
- `await run(BIG_MODEL)` 大模型再测一遍。

</div>

```bash
uv run python -m part03.wf5_judge_raw
```

我实跑的输出:

```text
评估者 = deepseek-flash
  好      标准=PASS  评对 0/6
  好2     标准=PASS  评对 0/6
  承诺时限   标准=FAIL  评对 6/6
  漏订单号   标准=FAIL  评对 6/6
  谎称已核实  标准=FAIL  评对 6/6
  推卸     标准=FAIL  评对 6/6
  没下一步   标准=FAIL  评对 6/6
  编造原因   标准=FAIL  评对 6/6
  编造补偿   标准=FAIL  评对 6/6
  太长     标准=FAIL  评对 6/6
评估者 = deepseek-v4-pro
  好      标准=PASS  评对 4/6
  好2     标准=PASS  评对 0/6
  承诺时限   标准=FAIL  评对 6/6
  漏订单号   标准=FAIL  评对 6/6
  谎称已核实  标准=FAIL  评对 6/6
  推卸     标准=FAIL  评对 6/6
  没下一步   标准=FAIL  评对 6/6
  编造原因   标准=FAIL  评对 6/6
  编造补偿   标准=FAIL  评对 6/6
  太长     标准=FAIL  评对 6/6
花费 0.2504 元
```

读这张表。八条有毛病的稿子,两个评估者都是 6/6 全抓住。但是**两条合格的稿子,小模型 12 次评审全判不及格**,大模型 12 次里判对了 4 次。这个评估者太严了。

太严意味着什么?循环永远不收敛:每一稿都被打回,生成的一方不停地改,直到用完轮数。为什么会这样?我把小模型对「好」那条的 problems 拿出来看了(同一条回复评三遍):

```text
['缺少明确的下一步:仅说“会提交退款核查、结果邮件通知”,但没有说明客户需要做什么,也没有明确我们会做什么具体动作……']
['缺少明确的下一步:未说明客户需要做什么,也未说明我们会具体做什么(仅“提交退款核查”不够具体,未说明向谁提交、何时提交……)']
['语气略显推卸责任:“到账时间取决于发卡银行,我们无法承诺具体日期”有将责任推给银行之嫌', ...]
```

这条回复明明写了「我们会提交退款核查,结果邮件通知您」,评估者却说「下一步不明确」,还要求写出「何时提交」。要是生成的一方听了它的话,就会写出「在 3 个工作日内提交」,直接违反第 2 条。第三遍更有意思,它把「到账时间取决于发卡银行」说成推卸责任,而这句话是事实。

问题出在标准本身:「明确的下一步」「不推卸」是模糊的词,模型会用自己的严格程度去解读,而且每次不一样。这是评估者-优化者最常见的坑:**标准写得越模糊,评估者越不稳**。

## 改进:能用代码查的用代码,模型只评代码查不了的

回头看五条标准:订单号有没有、有没有承诺时限、有没有说「已核实」、字数超没超,这四件事都能用代码查。需要模型判断的只有两件:有没有下一步、有没有推卸。再加一条前面样本暴露的:有没有编造(工单里没有的事实)。

代码关的好处:一是完全确定,同一条回复永远得到同一个结论;二是免费、瞬间;三是**能给出具体到数字的反馈**:「回复 286 个字,超过 150 字,至少要删掉 136 个字」比「太长了」好改得多。模型关只管三个明确定义过的问题,每个问题的判定边界都写进提示词里,比如「如实说明『到账时间取决于发卡银行』不算推卸」。

新建 `part03/wf5_evaluate.py`:

```python
# agent-zero-lab/part03/wf5_evaluate.py  Day 201:评估者。能用代码查的用代码(订单号、承诺、「已核实」、字数),只有语气和下一步交给模型
import re
from dataclasses import dataclass, field
from typing import Any

from part03.wf1_gates import ORDER_RE, check_reply
from part03.wf_common import llm_json

MAX_CHARS = 150
CLAIMED_CHECK_RE = re.compile(r"(?:已(?:经)?|经)(?:核实|核查|确认|查到|查明|核对|查证)")  # 客服只是起草,没查过系统,不能说查过
TIME_LIMIT_RE = re.compile(r"(?:\d+|[一二三四五六七八九十两]+)\s*(?:个)?(?:工作日|自然日|天|小时|分钟)内")  # 「24 小时内」「三天内」这类时限

SOFT_PROMPT = (
    "你在评审一封客服回复。只检查下面三点,其他方面不要管:\n"
    "A. 回复里有没有说明接下来的动作:我们会做什么(比如提交核查、转给同事、邮件通知结果),或者客户需要做什么。"
    "只要有这样一句话就算有,不要求写出具体时间或细节。\n"
    "B. 回复有没有把责任推给银行、客户或其他第三方。如实说明「到账时间取决于发卡银行」不算推卸;"
    "说「是银行的问题,和我们无关」才算。\n"
    "C. 回复里有没有出现工单里没写、客服也不可能知道的事实:比如编造的故障原因、说「已修复」、编造的补偿(延长有效期、送优惠)。"
    "说「我们会提交退款核查」这类客服确实能做的动作不算。\n"
    "输出 JSON:{{\"has_next_step\": true 或 false, \"blames_others\": true 或 false, \"invents_facts\": true 或 false, \"reason\": \"一句话\"}}\n\n"
    "工单:\n{ticket}\n\n待评审的回复:\n{reply}"
)


@dataclass
class Verdict:
    passed: bool
    problems: list[str] = field(default_factory=list)


def code_checks(reply: str, ticket: str) -> list[str]:
    """能用代码判断的几条。返回问题列表,空列表表示全部通过。"""
    problems: list[str] = []
    gate = check_reply(reply, ORDER_RE.findall(ticket))  # Day 197 的回复门:订单号不能漏,不能有承诺
    if gate:
        problems.append(gate)
    if CLAIMED_CHECK_RE.search(reply):
        problems.append("回复里说了「已核实/已确认」,但客服没有查过系统,不能这么写")
    m = TIME_LIMIT_RE.search(reply)
    if m:
        problems.append(f"回复里有时限:「{m.group(0)}」")
    if len(reply) > MAX_CHARS:
        problems.append(f"回复 {len(reply)} 个字,超过 {MAX_CHARS} 字,至少要删掉 {len(reply) - MAX_CHARS} 个字,优先删客套话和重复的内容")
    return problems


def parse_soft(raw: dict[str, Any]) -> list[str]:
    """模型评估者的输出不信任:字段不是真正的布尔值就按「没通过」处理。"""
    problems: list[str] = []
    reason = str(raw.get("reason", ""))
    if raw.get("has_next_step") is not True:
        problems.append(f"没有说明接下来的动作({reason})")
    if raw.get("blames_others") is not False:
        problems.append(f"把责任推给了别人({reason})")
    if raw.get("invents_facts") is not False:
        problems.append(f"出现了工单里没有的事实({reason})")
    return problems


def evaluate(ticket: str, reply: str) -> Verdict:
    problems = code_checks(reply, ticket)
    if problems:  # 代码这关都没过,不必再花钱请模型
        return Verdict(False, problems)
    problems = parse_soft(llm_json(SOFT_PROMPT.format(ticket=ticket, reply=reply)))
    return Verdict(not problems, problems)
```

<div class="line-notes">

- `from part03.wf1_gates import ORDER_RE, check_reply` [Day 197](/blog/agent-zero/day-197-chaining/) 的回复门直接拿来当代码关的一部分:订单号不能漏,不能有承诺。不重写,是因为同一条规则在两个地方各写一份,迟早改了一边忘了另一边。
- `MAX_CHARS = 150` 字数上限,放在模块顶部做成常量,练习 2 会在运行时改它。
- `CLAIMED_CHECK_RE = re.compile(r"(?:已(?:经)?|经)(?:核实|核查|确认|查到|查明|核对|查证)")` 抓「已核实」「已经确认」「经核实」「经核查」这一类。`(?:...)` 是不捕获的分组,`|` 是「或」,`(?:经)?` 的 `?` 表示可有可无。我的第一版只写了 `已(?:经)?(?:核实|确认|查到|查明|核对)`,没有「经核实」和「经核查」,吃了亏,下面循环那一节会讲。
- `TIME_LIMIT_RE = re.compile(r"(?:\d+|[一二三四五六七八九十两]+)\s*(?:个)?(?:工作日|自然日|天|小时|分钟)内")` 抓「24 小时内」「三天内」「3 个工作日内」。这是 Day 197 的 `PROMISE_RE` 没覆盖到的:`PROMISE_RE` 要求后面跟着「到账、退回、退款、处理、解决、完成」这些词,「24 小时内补充回复」里的「回复」不在其中,漏过去了。
- `SOFT_PROMPT = (` 模型关的提示词。只检查三点,开头就写「其他方面不要管」,防止它自由发挥。
- `"A. 回复里有没有说明接下来的动作:` 第一点:有没有下一步。「只要有这样一句话就算有,不要求写出具体时间或细节」,这一句直接针对上一节的毛病(评估者要求写出「何时提交」)。
- `"B. 回复有没有把责任推给银行、客户或其他第三方。如实说明「到账时间取决于发卡银行」不算推卸;"` 第二点:推卸。划清边界:陈述事实不算。
- `"C. 回复里有没有出现工单里没写、客服也不可能知道的事实:` 第三点:编造。举了三个例子(故障原因、已修复、补偿),并且说明「我们会提交退款核查」这类客服真能做的动作不算。
- `"输出 JSON:{{\"has_next_step\": true 或 false, \"blames_others\": true 或 false, \"invents_facts\": true 或 false` 三个布尔字段,不再是 PASS/FAIL 加一个自由发挥的问题列表。布尔字段好校验,也不会被模型的措辞带偏。
- `class Verdict:` 一次评估的结论。
- `passed: bool` 过没过。
- `problems: list[str] = field(default_factory=list)` 问题清单,过了的话是空列表。
- `def code_checks(reply: str, ticket: str) -> list[str]:` 代码关。
- `problems: list[str] = []` 先准备一个空清单。
- `gate = check_reply(reply, ORDER_RE.findall(ticket))  # Day 197 的回复门:订单号不能漏,不能有承诺` `ORDER_RE.findall(ticket)` 从工单里找出所有订单号。`check_reply` 返回 `None` 或一句原因。
- `if gate:` 有原因(是非空字符串)就加进清单。
- `if CLAIMED_CHECK_RE.search(reply):` 搜到「已核实」一类的说法。
- `m = TIME_LIMIT_RE.search(reply)` 搜时限,存下来是为了在提示里引用原文。
- `problems.append(f"回复里有时限:「{m.group(0)}」")` `m.group(0)` 是匹配到的原文,例如「24 小时内」。
- `if len(reply) > MAX_CHARS:` 超字数。`len` 数的是字符个数,一个汉字算一个。
- `problems.append(f"回复 {len(reply)} 个字,超过 {MAX_CHARS} 字,至少要删掉 {len(reply) - MAX_CHARS} 个字,优先删客套话和重复的内容")` 反馈里带上具体数字。286 字的样本会得到「回复 286 个字,超过 150 字,至少要删掉 136 个字……」。
- `def parse_soft(raw: dict[str, Any]) -> list[str]:` 模型关输出的解析,和前几天一样不信任。
- `if raw.get("has_next_step") is not True:` 必须是真的 `True` 才算有下一步。缺字段、字符串 `"true"`、`None` 都按「没有」处理。
- `if raw.get("blames_others") is not False:` 必须是真的 `False` 才算没推卸。注意方向相反:这两个字段「好」的值不同,但读不懂时都按「有问题」处理。
- `if raw.get("invents_facts") is not False:` 同理。
- `def evaluate(ticket: str, reply: str) -> Verdict:` 对外的入口:先代码关,再模型关。
- `if problems:  # 代码这关都没过,不必再花钱请模型` 代码关有问题就直接返回,**不调模型**。这是省钱的关键,也让最常见的毛病(字数、承诺)的反馈来得又快又准。
- `problems = parse_soft(llm_json(SOFT_PROMPT.format(ticket=ticket, reply=reply)))` 代码关全过了,才请模型看那三点。
- `return Verdict(not problems, problems)` 清单为空才算通过。

</div>

再测一遍这个新评估者。代码关是确定的,所以每条样本只在模型关上有随机性。新建 `part03/wf5_judge_check.py`:

```python
# agent-zero-lab/part03/wf5_judge_check.py  Day 201:把 10 条样本交给新的评估者,代码那几关不花钱,模型那关每条评 N 遍
from part03.wf5_evaluate import code_checks, evaluate
from part03.wf5_judge_raw import TICKET_SHORT
from part03.wf5_samples import SAMPLES
from part03.wf_common import total_cost

N = 6

for name, reply, should_pass in SAMPLES:
    code_problems = code_checks(reply, TICKET_SHORT)
    results = [evaluate(TICKET_SHORT, reply).passed for _ in range(N)]
    right = sum(r == should_pass for r in results)
    print(f"{name:<6} 标准={'PASS' if should_pass else 'FAIL'}  评对 {right}/{N}  代码关:{code_problems or '通过'}")
print(f"花费 {total_cost():.4f} 元")
```

<div class="line-notes">

- `from part03.wf5_judge_raw import TICKET_SHORT` 沿用上一个脚本里的工单缩写。导入它不会触发测试,因为那个文件的 `run` 在 `if __name__ == "__main__":` 保护里。
- `code_problems = code_checks(reply, TICKET_SHORT)` 单独算一遍代码关,只为了打印出来给你看。
- `results = [evaluate(TICKET_SHORT, reply).passed for _ in range(N)]` 同一条评 6 遍,取每遍的 `passed`。代码关没过的样本,这 6 遍都不会调模型。
- `right = sum(r == should_pass for r in results)` 评对的遍数。
- `print(f"{name:<6} 标准={'PASS' if should_pass else 'FAIL'}  评对 {right}/{N}  代码关:{code_problems or '通过'}")` 最后一列:代码关有问题就打印问题,没有就打印「通过」。`or` 在左边是空列表(假值)时取右边。

</div>

```bash
uv run python -m part03.wf5_judge_check
```

我实跑的输出:

```text
好      标准=PASS  评对 6/6  代码关:通过
好2     标准=PASS  评对 6/6  代码关:通过
承诺时限   标准=FAIL  评对 6/6  代码关:['回复里有承诺:「3 个工作日内为您退款」', '回复里有时限:「3 个工作日内」']
漏订单号   标准=FAIL  评对 6/6  代码关:['回复里漏了订单号 CL-20932']
谎称已核实  标准=FAIL  评对 6/6  代码关:['回复里说了「已核实/已确认」,但客服没有查过系统,不能这么写']
推卸     标准=FAIL  评对 6/6  代码关:通过
没下一步   标准=FAIL  评对 6/6  代码关:通过
编造原因   标准=FAIL  评对 6/6  代码关:通过
编造补偿   标准=FAIL  评对 6/6  代码关:通过
太长     标准=FAIL  评对 6/6  代码关:['回复 286 个字,超过 150 字,至少要删掉 136 个字,优先删客套话和重复的内容']
花费 0.0317 元
```

10 条样本各评 6 遍,60 次全部评对,两条好稿不再被冤枉。八条坏稿里,四条被代码关直接拦下(承诺、漏订单号、谎称已核实、太长,不花钱),另外四条(推卸、没下一步、编造原因、编造补偿)靠模型关。整个测试 ¥0.0317,而上一版只用大小两个模型评 10 条样本花了 ¥0.25,新版便宜了将近 8 倍,而且更准。

诚实地说一下这个结果的限度:这是我手写的样本,每条只犯一种很明显的错,比真实的模型生成稿容易判断得多。真正上线要拿线上真实生成的稿子做样本,而且要持续补:今天的「编造原因」「编造补偿」这两条,就是我跑了几遍循环之后才补进来的。

## 循环:生成、评估、带着问题重写

评估者靠得住了,现在写循环。关键设计:

- **第一稿故意不加任何要求**,只给身份和工单,这样循环才有事可做(Day 197 的做法是把规则写进第一稿的提示词,那是另一种选择)。
- **重写时把问题清单原文交给生成的一方**,不是「请改好一点」。
- **三种停法**:通过;用完轮数(`max_rounds`);连续两轮的问题清单一模一样(`stuck`,再改也没用)。
- **没通过的稿子不发给客户**。`status` 不是 `passed` 时,调用方转人工。

新建 `part03/wf5_loop.py`:

```python
# agent-zero-lab/part03/wf5_loop.py  Day 201 模式五:生成,评估,带着问题重写,循环到通过;三种停法:通过、卡住、用完轮数
import time
from dataclasses import dataclass, field

from part03.wf5_evaluate import Verdict, evaluate
from part03.wf_common import llm, total_calls, total_cost

FIRST_PROMPT = "你是云簿客服,回复这张工单:\n{ticket}"
REWRITE_PROMPT = (
    "你是云簿客服。下面是一张工单、你之前写的回复,和审核人指出的问题。请改好后重新写一封完整的回复,"
    "只输出回复正文,不要解释。\n\n工单:\n{ticket}\n\n之前的回复:\n{reply}\n\n审核人指出的问题:\n{problems}"
)


@dataclass
class LoopResult:
    status: str  # "passed" / "max_rounds" / "stuck"
    reply: str  # 最后一版回复(没通过的不要发给客户)
    history: list[Verdict] = field(default_factory=list)  # 每一轮的评审结果
    seconds: float = 0.0
    calls: int = 0
    cost: float = 0.0


def evaluate_optimize(ticket: str, max_rounds: int = 3) -> LoopResult:
    t0, c0, n0 = time.perf_counter(), total_cost(), total_calls()
    reply = llm(FIRST_PROMPT.format(ticket=ticket))
    history: list[Verdict] = []
    status = "max_rounds"
    for round_no in range(1, max_rounds + 1):
        verdict = evaluate(ticket, reply)
        history.append(verdict)
        if verdict.passed:
            status = "passed"
            break
        if round_no == max_rounds:
            break  # 用完轮数,不再改了
        if len(history) >= 2 and verdict.problems == history[-2].problems:
            status = "stuck"  # 连着两轮同样的问题,再改也没用
            break
        reply = llm(REWRITE_PROMPT.format(ticket=ticket, reply=reply, problems="\n".join(f"- {p}" for p in verdict.problems)))
    return LoopResult(status, reply, history, time.perf_counter() - t0, total_calls() - n0, total_cost() - c0)


if __name__ == "__main__":
    from part03.wf_common import TICKET

    r = evaluate_optimize(TICKET)
    for i, v in enumerate(r.history, 1):
        print(f"第 {i} 轮:{'PASS' if v.passed else 'FAIL'} {v.problems}")
    print(f"{r.status},{r.calls} 次调用,{r.seconds:.1f} 秒,¥{r.cost:.4f}")
    print(r.reply)
```

<div class="line-notes">

- `from part03.wf5_evaluate import Verdict, evaluate` 上一节的评估者。
- `FIRST_PROMPT = "你是云簿客服,回复这张工单:\n{ticket}"` 第一稿的提示词,没有任何规则,模型怎么写就怎么写。
- `REWRITE_PROMPT = (` 重写的提示词:工单、之前的回复、审核人指出的问题,三样一起给。
- `"只输出回复正文,不要解释。` 要求只输出正文。不写这句,模型常常在前面加一句「好的,以下是修改后的回复:」,那句话会混进下一轮的评审。
- `class LoopResult:` 整个循环的结果。
- `status: str  # "passed" / "max_rounds" / "stuck"` 三种结局。
- `reply: str  # 最后一版回复(没通过的不要发给客户)` 注释是写给调用方看的:只有 `status == "passed"` 时才能用这个字段。
- `history: list[Verdict] = field(default_factory=list)  # 每一轮的评审结果` 每一轮评审的结论都留着,事后能看循环是怎么收敛的。
- `def evaluate_optimize(ticket: str, max_rounds: int = 3) -> LoopResult:` 同步函数,因为循环里每一步都依赖上一步,没有可并行的。`max_rounds` 默认 3。
- `reply = llm(FIRST_PROMPT.format(ticket=ticket))` 第一稿,第 1 次模型调用。
- `status = "max_rounds"` 先假设最坏的结局,下面碰到通过或卡住再改。
- `for round_no in range(1, max_rounds + 1):` 第 1 轮到第 3 轮。`range(1, 4)` 产生 1、2、3。
- `verdict = evaluate(ticket, reply)` 评估这一稿。
- `history.append(verdict)` 记下来。
- `if verdict.passed:` 通过了。
- `status = "passed"` 改结局。
- `break` 跳出循环,不再改。
- `if round_no == max_rounds:` 已经是最后一轮还没过,不要再重写一稿(重写了也没机会评了)。
- `break  # 用完轮数,不再改了` 这时 `status` 保持最初的 `"max_rounds"`。
- `if len(history) >= 2 and verdict.problems == history[-2].problems:` 这一轮的问题清单和上一轮完全一样。`history[-2]` 是倒数第二个元素,即上一轮。
- `status = "stuck"  # 连着两轮同样的问题,再改也没用` 卡住了。生成的一方听了反馈没有改,或者改了但评估者给了同样的反馈,继续下去只是烧钱。
- `reply = llm(REWRITE_PROMPT.format(ticket=ticket, reply=reply, problems="\n".join(f"- {p}" for p in verdict.problems)))` 带着问题重写。`"\n".join(f"- {p}" ...)` 把问题清单变成一行一条、前面加「- 」的文本。新稿覆盖 `reply`,回到循环顶部再评。
- `return LoopResult(status, reply, history, time.perf_counter() - t0, total_calls() - n0, total_cost() - c0)` 打包返回。
- `r = evaluate_optimize(TICKET)` 最下面的演示用 Day 196 的陈先生那张工单。
- `print(f"第 {i} 轮:{'PASS' if v.passed else 'FAIL'} {v.problems}")` 打印每一轮的结论和问题。

</div>

```bash
uv run python -m part03.wf5_loop
```

我跑了三遍,三种结局都碰到了。

**第一遍,第 3 轮通过:**

```text
第 1 轮:FAIL ['回复里有承诺:「3 个工作日到账」', '回复里有时限:「24 小时内」', '回复 340 个字,超过 150 字,至少要删掉 190 个字,优先删客套话和重复的内容']
第 2 轮:FAIL ['回复里说了「已核实/已确认」,但客服没有查过系统,不能这么写', '回复 157 个字,超过 150 字,至少要删掉 7 个字,优先删客套话和重复的内容']
第 3 轮:PASS []
passed,4 次调用,4.6 秒,¥0.0052
陈先生您好，关于您反馈的重复扣费问题，我们已记录并转交相关部门核查 CL-20931 与 CL-20932 两笔订单。如确认为同一续费周期重复扣费，将为您发起多扣款项的退款，原路退回付款银行卡，到账时间以银行处理为准。核查结果及处理进展会及时同步给您。
```

第一稿 340 字,既写了「3 个工作日到账」又写了「24 小时内」;改到第二稿,承诺和时限都去掉了,但冒出「已核实」,还有 7 个字超标;第三稿全过。4 次调用:生成 1 次、重写 2 次、模型关 1 次(代码关没过的轮次不调模型)。

**第二遍,第 2 轮通过:**

```text
第 1 轮:FAIL ['回复里有承诺:「3 个工作日到账,退款」', '回复里说了「已核实/已确认」,但客服没有查过系统,不能这么写', '回复里有时限:「24 小时内」', '回复 374 个字,超过 150 字,至少要删掉 224 个字,优先删客套话和重复的内容']
第 2 轮:PASS []
passed,3 次调用,4.5 秒,¥0.0043
```

第一稿四条毛病一起犯,改一次就全过了。

**第三遍,3 轮用完没通过:**

```text
第 1 轮:FAIL ['回复里有承诺:「3 个工作日到账」', '回复里说了「已核实/已确认」,但客服没有查过系统,不能这么写', '回复 264 个字,超过 150 字,至少要删掉 114 个字,优先删客套话和重复的内容']
第 2 轮:FAIL ['回复里漏了订单号 CL-20931']
第 3 轮:FAIL ['回复里说了「已核实/已确认」,但客服没有查过系统,不能这么写', '回复 153 个字,超过 150 字,至少要删掉 3 个字,优先删客套话和重复的内容']
max_rounds,3 次调用,3.7 秒,¥0.0037
陈先生您好，非常抱歉给您带来困扰。关于您反馈的重复扣费问题,我们已核实订单 CL-20931 与 CL-20932 存在重复扣款情况,并已为您提交退款申请,多扣的1188元将原路退回,具体到账时间以银行处理为准。同时,我们已将问题升级至技术团队核查重复扣费原因,后续进展会及时与您同步。感谢您的理解与耐心。
```

第三遍很有教学价值。第 2 轮的问题清单里只剩一条:漏了订单号(为了压字数,生成的一方把订单号删了);第 3 轮订单号补回来了,「已核实」又回来了,还差 3 个字。**改了 A 就坏了 B,几条标准互相拉扯**,在 3 轮里没有找到同时满足的稿子。注意最后这一稿:「我们已核实……」「已将问题升级至技术团队」是编造的,**绝对不能发给客户**。所以 `LoopResult.reply` 在 `status` 不是 `passed` 时只是「最后一稿」,不是「可以发的稿」,调用方要转人工。

### 我吃过的一个亏:评估者没写到的地方,生成的一方会钻进去

上面这些输出是评估者补全之后的。我第一版的代码关没有 `TIME_LIMIT_RE`,`CLAIMED_CHECK_RE` 里也没有「经核实」,模型关也没有「编造」那一条。拿同一张工单跑循环,得到的是这样一个「通过」:

```text
passed,4 次调用,5.3 秒,¥0.0058
陈先生您好，非常抱歉。经核实，您9月28日确有两笔1188元扣款（CL-20931、CL-20932），多扣的CL-20932已提交退款，将原路退回您的银行卡。重复扣费初步判断为支付回调异常，非您操作问题，详细结论我们会在24小时内补充回复。感谢您的耐心，如有疑问请随时回复本工单。
```

字数、订单号、没写具体到账天数,评估者全部满意。但是「经核实」是假的,「支付回调异常」是编的,「24 小时内补充回复」是客服没权力给的承诺。另一遍里生成的一方还写出「技术侧已修复并加重复核」「为表歉意延长 1 个月专业版有效期」。

这不是模型坏,是它在按评估者的反馈优化:你说不能写 A、不能写 B、要短,它就找到一条不碰这几条线、但同样不该写的路。**评估者只会拦它知道要拦的**。所以评估标准是一个要持续补的东西:每发现一种新的「钻空子」,就加一条规则和一条样本,这就是为什么 `wf5_samples.py` 里有「编造原因」「编造补偿」这两条,以及为什么评估者自己要有带标准答案的测试集。

## 批量跑:循环到底多久收敛

单次运行不说明问题。四张工单(重复扣费、不是重复扣费、三件事、五件事)各跑 4 遍,数「通过的轮次分布」「结局」「平均调用」「平均花费」,以及没通过的几遍最后一轮的主要原因。新建 `part03/wf5_batch.py`:

```python
# agent-zero-lab/part03/wf5_batch.py  Day 201:四张工单各跑 N 遍生成-评估循环,看停在哪、用了几轮、花多少
import asyncio
import statistics
from collections import Counter

from part03.ticket_tools import TICKET_NOT_DUP
from part03.wf4_tickets import TICKET_FIVE, TICKET_ONE, TICKET_THREE
from part03.wf5_loop import LoopResult, evaluate_optimize

N = 4
TICKETS = {"重复扣费": TICKET_ONE, "不是重复扣费": TICKET_NOT_DUP, "三件事": TICKET_THREE, "五件事": TICKET_FIVE}


async def main() -> None:
    sem = asyncio.Semaphore(1)  # 一遍一遍串行跑:total_calls/total_cost 是全局计数,并发跑会互相串

    async def one(ticket: str) -> LoopResult:
        async with sem:
            return await asyncio.to_thread(evaluate_optimize, ticket)

    print(f"{'工单':<8} {'通过轮次分布':<14} {'状态':<30} {'平均调用':>6} {'平均¥':>8}  最后一轮没过的原因")
    for name, ticket in TICKETS.items():
        rs = await asyncio.gather(*[one(ticket) for _ in range(N)])
        rounds = Counter(len(r.history) for r in rs if r.status == "passed")
        status = Counter(r.status for r in rs)
        why = Counter(p.split("(")[0].split(":")[0][:12] for r in rs if r.status != "passed" for p in r.history[-1].problems)
        print(f"{name:<8} {str(dict(sorted(rounds.items()))):<14} {str(dict(status)):<30} "
              f"{statistics.mean(r.calls for r in rs):>6.1f} {statistics.mean(r.cost for r in rs):>8.4f}  {dict(why)}")


if __name__ == "__main__":
    asyncio.run(main())
```

<div class="line-notes">

- `from part03.ticket_tools import TICKET_NOT_DUP` [Day 196](/blog/agent-zero/day-196-workflow-vs-agent/) 的第三张工单:李女士要退一笔正常订单,不是重复扣费。
- `from part03.wf4_tickets import TICKET_FIVE, TICKET_ONE, TICKET_THREE` [Day 200](/blog/agent-zero/day-200-orchestrator/) 的三张。
- `N = 4` 每张工单跑 4 遍。
- `sem = asyncio.Semaphore(1)  # 一遍一遍串行跑:total_calls/total_cost 是全局计数,并发跑会互相串` 名额只有 1,等于串行。这是一个我踩过的坑:我第一版用 `Semaphore(6)` 并发跑,算出来「平均调用 8 到 11 次」,明显偏高,因为 `total_calls()` 是全局计数,几个循环同时跑会把彼此的调用数都算进自己头上。
- `return await asyncio.to_thread(evaluate_optimize, ticket)` `evaluate_optimize` 是同步函数,放进线程里跑。
- `rs = await asyncio.gather(*[one(ticket) for _ in range(N)])` 4 遍同时「提交」,但因为 `Semaphore(1)`,实际是一个接一个跑。
- `rounds = Counter(len(r.history) for r in rs if r.status == "passed")` 通过的几遍里,各用了几轮(`len(r.history)` 就是评估了几次)。
- `status = Counter(r.status for r in rs)` 四种结局各几遍。
- `why = Counter(p.split("(")[0].split(":")[0][:12] for r in rs if r.status != "passed" for p in r.history[-1].problems)` 没通过的那几遍,最后一轮的每条问题取前 12 个字作为类别,数各类各几次。`.split("(")[0]` 去掉括号后面的理由,`.split(":")[0]` 去掉冒号后面的内容。双层 `for` 的推导式从左往右读:先遍历没通过的结果,再遍历它最后一轮的问题。
- `print(f"{name:<8} {str(dict(sorted(rounds.items()))):<14} {str(dict(status)):<30} "` 一行末尾的 `"` 后面不加逗号,下一行紧接着的 f-string 会自动连起来,这是 Python 的「相邻字符串自动拼接」。

</div>

```bash
uv run python -m part03.wf5_batch
```

我实跑的输出:

```text
工单       通过轮次分布         状态                               平均调用      平均¥  最后一轮没过的原因
重复扣费     {3: 1}         {'max_rounds': 3, 'passed': 1}    3.2   0.0050  {'回复 156 个字,超过': 1, '回复 153 个字,超过': 1, '回复 154 个字,超过': 1}
不是重复扣费   {2: 2}         {'passed': 2, 'max_rounds': 2}    3.2   0.0045  {'回复 170 个字,超过': 1, '回复 180 个字,超过': 1}
三件事      {3: 2}         {'max_rounds': 2, 'passed': 2}    3.5   0.0068  {'回复 192 个字,超过': 1, '回复里漏了订单号 CL-': 1, '回复 176 个字,超过': 1}
五件事      {}             {'max_rounds': 4}                 3.0   0.0076  {'回复 211 个字,超过': 1, '回复 202 个字,超过': 1, '回复 190 个字,超过': 1, '回复 217 个字,超过': 1}
```

读这张表,三个观察:

1. **一半左右能在 2 到 3 轮内通过**。一件事的工单 4 遍里通过 1 到 2 遍,另一半用完 3 轮。每遍平均 3 次调用,不到半分钱。
2. **没通过的几乎全败在字数上,而且差得不多**:156 字、153 字、154 字,都只超几个字。字数是循环里最难收敛的一条,因为模型改写时不会数字数。
3. **五件事的工单 4 遍全部没通过,没有一遍例外。** 评估标准里的「150 字以内」对五件事根本不现实:五件事每件至少一句话,加上问候,不可能 150 字。这不是模型的问题,是标准和任务不匹配。练习 2 就来修这个。

## 用剧本测试评估者和循环

代码关的每一条、`parse_soft` 的不信任、循环的三种停法,都不需要真调模型。新建 `tests/test_wf5.py`:

```python
# agent-zero-lab/tests/test_wf5.py  Day 201:不调真模型,测评估者的代码关、模型输出的解析和循环的三种停法
import pytest

from part03 import wf5_evaluate, wf5_loop
from part03.wf5_evaluate import Verdict, code_checks, parse_soft

TICKET = "订单号 CL-20931 和 CL-20932 被扣了两次"
GOOD = "您好,订单 CL-20931 和 CL-20932 的情况我们会提交核查,结果邮件通知您。到账时间取决于发卡银行。"


def test_good_reply_passes_code_checks():
    assert code_checks(GOOD, TICKET) == []


@pytest.mark.parametrize(
    "reply, keyword",
    [
        ("订单 CL-20931 会处理。", "漏了订单号 CL-20932"),
        ("订单 CL-20931 和 CL-20932 将在 3 个工作日内退回。", "承诺"),
        ("经核实,订单 CL-20931 和 CL-20932 重复扣款。", "已核实"),
        ("订单 CL-20931 和 CL-20932,我们会在 24 小时内回复。", "时限"),
        ("订单 CL-20931 和 CL-20932。" + "客套" * 100, "超过"),
    ],
)
def test_code_checks_catch(reply, keyword):
    assert any(keyword in p for p in code_checks(reply, TICKET))


def test_parse_soft_distrusts_bad_output():
    ok = {"has_next_step": True, "blames_others": False, "invents_facts": False, "reason": ""}
    assert parse_soft(ok) == []
    assert len(parse_soft({**ok, "has_next_step": "true"})) == 1  # 字符串不算真正的布尔值
    assert len(parse_soft({})) == 3  # 字段全缺:三条都算没通过


def script(monkeypatch, verdicts: list[Verdict]):
    """假的 llm 每次返回「稿N」;假的 evaluate 按顺序给 verdicts。"""
    drafts = iter(f"稿{i}" for i in range(1, 20))
    seen: list[str] = []
    vs = iter(verdicts)
    monkeypatch.setattr(wf5_loop, "llm", lambda prompt, **kw: next(drafts))
    monkeypatch.setattr(wf5_loop, "evaluate", lambda t, r: (seen.append(r), next(vs))[1])
    return seen


def test_passes_in_round_two(monkeypatch):
    seen = script(monkeypatch, [Verdict(False, ["太长"]), Verdict(True)])
    r = wf5_loop.evaluate_optimize("x")
    assert (r.status, r.reply, seen) == ("passed", "稿2", ["稿1", "稿2"])


def test_max_rounds(monkeypatch):
    script(monkeypatch, [Verdict(False, ["a"]), Verdict(False, ["b"]), Verdict(False, ["c"])])
    r = wf5_loop.evaluate_optimize("x", max_rounds=3)
    assert r.status == "max_rounds" and len(r.history) == 3 and r.reply == "稿3"


def test_stuck_when_same_problems_twice(monkeypatch):
    script(monkeypatch, [Verdict(False, ["同一个问题"]), Verdict(False, ["同一个问题"]), Verdict(True)])
    r = wf5_loop.evaluate_optimize("x", max_rounds=5)
    assert r.status == "stuck" and len(r.history) == 2  # 第三次评审根本没发生


def test_evaluate_skips_model_when_code_fails(monkeypatch):
    def boom(prompt):
        raise AssertionError("代码关没过,不该调模型")

    monkeypatch.setattr(wf5_evaluate, "llm_json", boom)
    v = wf5_evaluate.evaluate(TICKET, "订单 CL-20931 会处理。")
    assert not v.passed
```

<div class="line-notes">

- `from part03 import wf5_evaluate, wf5_loop` 导入模块,测试里才能换里面的函数。
- `TICKET = "订单号 CL-20931 和 CL-20932 被扣了两次"` 测试用的最短工单,只要含两个订单号。
- `GOOD = "您好,订单 CL-20931 和 CL-20932 的情况我们会提交核查,结果邮件通知您。到账时间取决于发卡银行。"` 一条能过代码关的回复。
- `def test_good_reply_passes_code_checks():` 好稿的代码关结果是空列表。
- `@pytest.mark.parametrize(` 下面五组各针对一条规则。
- `("订单 CL-20931 会处理。", "漏了订单号 CL-20932"),` 少了一个订单号,问题里要含「漏了订单号 CL-20932」。
- `("经核实,订单 CL-20931 和 CL-20932 重复扣款。", "已核实"),` 钉住「经核实」会被抓,这正是我第一版漏掉的。
- `("订单 CL-20931 和 CL-20932,我们会在 24 小时内回复。", "时限"),` 钉住「24 小时内回复」会被抓,这是 `PROMISE_RE` 漏掉的那一类。
- `("订单 CL-20931 和 CL-20932。" + "客套" * 100, "超过"),` 字符串乘整数是重复:`"客套" * 100` 是 200 个字,超过 150。
- `assert any(keyword in p for p in code_checks(reply, TICKET))` 问题清单里只要有一条含这个关键词就行。
- `def test_parse_soft_distrusts_bad_output():` 模型关输出的解析。
- `assert len(parse_soft({**ok, "has_next_step": "true"})) == 1  # 字符串不算真正的布尔值` `{**ok, "has_next_step": "true"}` 先展开 `ok`,再用新值覆盖一个字段。字符串 `"true"` 不是 `True`,所以报一条问题。
- `assert len(parse_soft({})) == 3  # 字段全缺:三条都算没通过` 空字典:三个字段都缺,三条问题。
- `def script(monkeypatch, verdicts: list[Verdict]):` 辅助函数:把循环里的 `llm` 换成「按顺序返回稿 1、稿 2……」,把 `evaluate` 换成「按顺序返回给定的评审结果」。
- `drafts = iter(f"稿{i}" for i in range(1, 20))` `iter` 加生成器,每次 `next` 给下一个稿。
- `monkeypatch.setattr(wf5_loop, "llm", lambda prompt, **kw: next(drafts))` 假的 `llm`,忽略提示词,只管吐稿。`lambda` 是匿名函数,相当于 JS 的箭头函数。
- `monkeypatch.setattr(wf5_loop, "evaluate", lambda t, r: (seen.append(r), next(vs))[1])` 假的 `evaluate`:先把收到的稿记进 `seen`,再返回下一个预设结论。元组 `(a, b)[1]` 取第二个,是个「先做一件事再返回另一个值」的小技巧。
- `def test_passes_in_round_two(monkeypatch):` 第 1 轮不过、第 2 轮过:`status` 是 `passed`,最终稿是「稿2」,评审过的稿依次是「稿1」「稿2」。
- `def test_max_rounds(monkeypatch):` 三轮都不过,三个问题还不一样:`max_rounds`,评了 3 轮,最后稿是「稿3」。
- `def test_stuck_when_same_problems_twice(monkeypatch):` 前两轮问题一样,第三轮预设了「通过」:`stuck`,只评了 2 轮,第三轮的评审根本没发生。这个测试证明「卡住」是在重写之前就停下的。
- `def test_evaluate_skips_model_when_code_fails(monkeypatch):` 钉住省钱的行为:代码关没过时,`llm_json` 不能被调用。
- `def boom(prompt):` 函数体是 `raise AssertionError(...)`,一旦被调用就让测试失败。

</div>

```bash
uv run pytest -q tests/test_wf5.py
```

```text
...........                                                              [100%]
11 passed in 0.72s
```

11 个全绿。其中三种停法各有一个测试,代码关的规则每一条都有测试。我第一版漏掉的「经核实」「24 小时内回复」,现在有测试钉着,以后不会再漏回去。

## 评估者是模型,上限就在这里

今天的评估者里,真正「模型来判断」的只剩三点(下一步、推卸、编造),它们是模糊的,不得不交给模型。但你应该注意到一个不舒服的事实:模型评估模型,有它判断不了的东西。

比如「编造」这一条。评估者能抓到「支付回调异常」这种明显的编造,是因为它(和你一样)能看出这是客服不可能知道的。可如果回复里写的是一个看起来合理的具体数字(「您的订单已于 9 月 28 日 10:02 重复扣款」),评估者没有数据库可对,没法知道对不对。同一类模型评估同一类模型,它漏掉的东西,优化者多半也意识不到。

出路是把评估者换成**能执行的东西**:写代码就跑测试,写 SQL 就在只读库上执行,回复里提到订单号就去查订单系统。这类反馈来自外部,不会和生成的一方犯同一种错。后天的 [Day 203](/blog/agent-zero/day-203-external-feedback/) 会专门讲这个,用数据库当评估者,同样的任务,「空结果」这种干巴巴的反馈和「带着表里真实样例」的反馈,差别很大。今天先记住这个方向。

## 动手练习

### 练习 1:找一句话骗过代码关,再补上

我们的代码关有 `TIME_LIMIT_RE`,只抓「N 小时内」这种带数字的时限。写一句不带数字、但依然是时间承诺的回复,让它骗过 `code_checks`。再补一条正则,并检查它不会误伤好回复。

<details><summary>参考答案</summary>

新建 `part03/ex201_bypass.py`:

```python
# agent-zero-lab/part03/ex201_bypass.py  Day 201 练习 1:找一句话骗过代码关,再补上正则(不调模型)
from part03.wf5_evaluate import code_checks

TICKET = "订单号 CL-20931 和 CL-20932 被扣了两次"
BYPASS = "您好,订单 CL-20931 和 CL-20932 我们会提交核查,预计下周一前给您结果。"
print("原来的代码关:", code_checks(BYPASS, TICKET) or "通过(漏网了)")

import re  # noqa: E402

from part03 import wf5_evaluate  # noqa: E402

WEEKDAY_RE = re.compile(r"(?:今天|明天|后天|本周|下周|周[一二三四五六日天]|星期[一二三四五六日天]|月底|月初)[^。!?\n]{0,6}(?:前|内|之前|给您)")
original = wf5_evaluate.code_checks


def patched(reply: str, ticket: str) -> list[str]:
    problems = original(reply, ticket)
    m = WEEKDAY_RE.search(reply)
    if m:
        problems.append(f"回复里有时间承诺:「{m.group(0)}」")
    return problems


print("补丁之后:", patched(BYPASS, TICKET))
print("好回复误伤吗:", patched("您好,订单 CL-20931 和 CL-20932 我们会提交核查,结果邮件通知您。到账时间取决于发卡银行。", TICKET) or "没有")
```

<div class="line-notes">

- `BYPASS = "您好,订单 CL-20931 和 CL-20932 我们会提交核查,预计下周一前给您结果。"` 「预计下周一前给您结果」是时间承诺,但没有数字加「小时/天内」,`TIME_LIMIT_RE` 抓不到。
- `print("原来的代码关:", code_checks(BYPASS, TICKET) or "通过(漏网了)")` 空列表是假值,所以 `or` 取右边的字符串。
- `import re  # noqa: E402` 这个文件为了讲解顺序,把 import 放在了中间,`# noqa: E402` 告诉代码检查工具「这里的 import 位置我是故意的」。真实项目里 import 都放最上面。
- `WEEKDAY_RE = re.compile(r"(?:今天|明天|后天|本周|下周|周[一二三四五六日天]|星期[一二三四五六日天]|月底|月初)[^。!?\n]{0,6}(?:前|内|之前|给您)")` 抓「时间词 + 最多 6 个非标点字符 + 前/内/之前/给您」。「下周一前给您」匹配:`下周` 是时间词,`一` 是中间的 1 个字符,`前` 是后缀。`[^。!?\n]{0,6}` 表示除了句号、感叹号、问号、换行以外的字符,0 到 6 个。
- `original = wf5_evaluate.code_checks` 先存下原来的函数。
- `def patched(reply: str, ticket: str) -> list[str]:` 新函数:先跑原来的所有检查,再多跑一条。
- `problems.append(f"回复里有时间承诺:「{m.group(0)}」")` 匹配到的原文是「下周一前给您」。
- `print("好回复误伤吗:", patched("您好,订单 CL-20931 和 CL-20932 我们会提交核查,结果邮件通知您。到账时间取决于发卡银行。", TICKET) or "没有")` 拿一条好回复验证没有误伤。

</div>

```bash
uv run python -m part03.ex201_bypass
```

```text
原来的代码关: 通过(漏网了)
补丁之后: ['回复里有时间承诺:「下周一前给您」']
好回复误伤吗: 没有
```

这条正则会不会有别的漏洞?肯定有。「过两天给您答复」「周末前」(「周末」不在词表里)都抓不到。正则永远补不完,这就是为什么上一节说评估标准是要持续补的东西:每发现一个钻空子的说法,加一条规则和一条测试样本,而不是指望一次写全。

</details>

### 练习 2:字数上限按诉求数放宽

`wf5_batch` 里五件事的工单 4 遍全败在字数上。把字数上限改成 `150 + 80 × (诉求数 − 1)`,三件事是 310 字,五件事是 470 字,再各跑 4 遍。

<details><summary>参考答案</summary>

新建 `part03/ex201_maxchars.py`:

```python
# agent-zero-lab/part03/ex201_maxchars.py  Day 201 练习 2:字数上限按诉求数放宽(每多一件事加 80 字),再跑三件事和五件事
import statistics
from collections import Counter

from part03 import wf5_evaluate
from part03.wf4_tickets import TICKET_FIVE, TICKET_THREE
from part03.wf5_loop import evaluate_optimize

N = 4
ITEMS = {"三件事": (TICKET_THREE, 3), "五件事": (TICKET_FIVE, 5)}

for name, (ticket, items) in ITEMS.items():
    wf5_evaluate.MAX_CHARS = 150 + 80 * (items - 1)  # code_checks 运行时才读这个全局变量,所以改了立刻生效
    rs = [evaluate_optimize(ticket) for _ in range(N)]
    status = Counter(r.status for r in rs)
    rounds = Counter(len(r.history) for r in rs if r.status == "passed")
    print(f"{name}: 上限 {wf5_evaluate.MAX_CHARS} 字,状态 {dict(status)},通过的轮次 {dict(sorted(rounds.items()))},平均 ¥{statistics.mean(r.cost for r in rs):.4f}")
```

<div class="line-notes">

- `from part03 import wf5_evaluate` 导入模块本身,才能改它的变量。
- `ITEMS = {"三件事": (TICKET_THREE, 3), "五件事": (TICKET_FIVE, 5)}` 每项:工单加诉求数。
- `wf5_evaluate.MAX_CHARS = 150 + 80 * (items - 1)  # code_checks 运行时才读这个全局变量,所以改了立刻生效` 三件事 `150 + 80×2 = 310`,五件事 `150 + 80×4 = 470`。`code_checks` 里的 `MAX_CHARS` 是函数执行到那一行时才去模块里查的,所以在循环开始前改好就对后面所有评审生效。
- `rs = [evaluate_optimize(ticket) for _ in range(N)]` 同样一遍接一遍跑。
- `print(f"{name}: 上限 {wf5_evaluate.MAX_CHARS} 字,状态 {dict(status)},通过的轮次 {dict(sorted(rounds.items()))},平均 ¥{statistics.mean(r.cost for r in rs):.4f}")` 一行汇总。

</div>

```bash
uv run python -m part03.ex201_maxchars
```

```text
三件事: 上限 310 字,状态 {'passed': 2, 'max_rounds': 2},通过的轮次 {2: 1, 3: 1},平均 ¥0.0078
五件事: 上限 470 字,状态 {'passed': 2, 'max_rounds': 2},通过的轮次 {3: 2},平均 ¥0.0118
```

放宽以后五件事从 4 遍全败变成 4 遍里通过 2 遍,三件事也是 2 遍。仍然有一半没过,是因为模型写多件事的回复习惯写得很长(我看到过 590 字、467 字),重写时压缩的幅度不够。反馈里带了「至少要删掉多少个字」这个具体数字,收敛比光说「太长了」好得多,但依然不稳定。

这个练习的重点不是把通过率拉到 100%,而是看清:**循环不收敛时,先怀疑标准,再怀疑模型**。五件事 150 字这个标准本身就不合理,换多少次提示词、多少轮循环都没用。

</details>

### 练习 3:评估者在两种问题之间来回挑刺

有时候评估者会在两种问题之间来回:第 1 轮「太长」,第 2 轮「漏订单号」,第 3 轮又「太长」……现在的「连续两轮相同」拦不住这种。用假模型造出这个序列,写一个修好的版本:只要见过同样的问题清单就算兜圈子。

<details><summary>参考答案</summary>

新建 `part03/ex201_oscillation.py`:

```python
# agent-zero-lab/part03/ex201_oscillation.py  Day 201 练习 3:评估者在两种问题之间来回挑刺(A、B、A、B),原来的「连续两轮相同」拦不住。用假模型演示并修好
from part03 import wf5_loop
from part03.wf5_evaluate import Verdict

SEQUENCE = [Verdict(False, ["太长"]), Verdict(False, ["漏订单号"]), Verdict(False, ["太长"]), Verdict(False, ["漏订单号"]), Verdict(False, ["太长"])]


def fake_setup() -> None:
    drafts = iter(f"稿{i}" for i in range(1, 20))
    verdicts = iter(SEQUENCE)
    wf5_loop.llm = lambda prompt, **kw: next(drafts)
    wf5_loop.evaluate = lambda ticket, reply: next(verdicts)


fake_setup()
r = wf5_loop.evaluate_optimize("x", max_rounds=5)
print("原来:", r.status, "评了", len(r.history), "轮")  # 没拦住,白白评了 5 轮


def evaluate_optimize_v2(ticket: str, max_rounds: int = 5) -> wf5_loop.LoopResult:
    reply = wf5_loop.llm(wf5_loop.FIRST_PROMPT.format(ticket=ticket))
    history: list[Verdict] = []
    seen: set[tuple[str, ...]] = set()  # 出现过的「问题集合」,再见到同一种就是在兜圈子
    status = "max_rounds"
    for round_no in range(1, max_rounds + 1):
        verdict = wf5_loop.evaluate(ticket, reply)
        history.append(verdict)
        if verdict.passed:
            status = "passed"
            break
        key = tuple(sorted(verdict.problems))
        if key in seen:
            status = "stuck"
            break
        seen.add(key)
        if round_no == max_rounds:
            break
        reply = wf5_loop.llm(wf5_loop.REWRITE_PROMPT.format(ticket=ticket, reply=reply, problems="\n".join(verdict.problems)))
    return wf5_loop.LoopResult(status, reply, history)


fake_setup()
r2 = evaluate_optimize_v2("x")
print("修好:", r2.status, "评了", len(r2.history), "轮")
```

<div class="line-notes">

- `SEQUENCE = [Verdict(False, ["太长"]), Verdict(False, ["漏订单号"]), Verdict(False, ["太长"]), Verdict(False, ["漏订单号"]), Verdict(False, ["太长"])]` 预设的评审结果:太长、漏订单号、太长、漏订单号、太长,来回摆,而且永远不通过。
- `def fake_setup() -> None:` 每次测试前重新准备「新的」假稿和假评审,因为迭代器用过就空了。
- `wf5_loop.llm = lambda prompt, **kw: next(drafts)` 直接改模块里的名字,和 `monkeypatch` 是一回事,只是这里不在 pytest 里,没有自动还原。
- `r = wf5_loop.evaluate_optimize("x", max_rounds=5)` 用原来的循环,最多 5 轮。
- `print("原来:", r.status, "评了", len(r.history), "轮")  # 没拦住,白白评了 5 轮` 「连续两轮相同」只比相邻两轮,A、B、A、B 里相邻的永远不同,拦不住。
- `def evaluate_optimize_v2(ticket: str, max_rounds: int = 5) -> wf5_loop.LoopResult:` 修好的版本。
- `seen: set[tuple[str, ...]] = set()  # 出现过的「问题集合」,再见到同一种就是在兜圈子` 一个集合,存见过的问题清单。清单是列表,列表不能放进集合(不可哈希),所以转成元组。`tuple[str, ...]` 表示「任意长度的字符串元组」。
- `key = tuple(sorted(verdict.problems))` 先排序再转元组,这样「A、B」和「B、A」算同一种。
- `if key in seen:` 以前见过。
- `status = "stuck"` 兜圈子。
- `seen.add(key)` 没见过的,记下来。
- `reply = wf5_loop.llm(wf5_loop.REWRITE_PROMPT.format(ticket=ticket, reply=reply, problems="\n".join(verdict.problems)))` 重写,这里省略了问题前面的「- 」,不影响演示。
- `return wf5_loop.LoopResult(status, reply, history)` 只填前三个字段,后面的统计字段用默认值。

</div>

```bash
uv run python -m part03.ex201_oscillation
```

```text
原来: max_rounds 评了 5 轮
修好: stuck 评了 3 轮
```

原来的循环走满 5 轮才停,修好的版本在第 3 轮(第二次见到「太长」)就停了,省下两轮。这是模型调用里最贵的两轮。

注意一个取舍:`stuck` 可能误伤「先后两次碰巧同样的问题,但这次改好了」的情形。要不要更宽松(见到同样的问题三次才停),看你的任务能不能容忍多烧几轮。

</details>

验收标准:`tests/test_wf5.py` 的 11 个测试全绿;你能不看文章写出 `code_checks` 和带三种停法的 `evaluate_optimize`;能说出「为什么评估标准里能用代码查的要放在模型前面」和「为什么没通过的稿子不能发」。

## 花费

文中命令跑一遍的大致花费:`wf5_judge_raw` ¥0.2504(大小两个模型各评 10 条 × 6 遍,大模型占大头,是今天最贵的一条),`wf5_judge_check` ¥0.0317,`wf5_loop` 三遍共约 ¥0.013,`wf5_batch`(16 遍循环)约 ¥0.09,练习 2 约 ¥0.07,练习 1 和练习 3 不调模型,测试不调模型。我写这篇时还试过几个版本的评估标准,以及第一版并发跑 `wf5_batch`,多花了约 ¥0.3。合计约 ¥0.75。价格按 `.env` 里的 `LLM_PRICE=0.04,2,8`(deepseek-flash 缓存命中、未命中、输出,元每百万 token)和 `LLM_BIG_PRICE=0.3,9,27`(deepseek-v4-pro),2026 年 10 月查过 DeepSeek 价格页。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 评估者-优化者(evaluator-optimizer) | 一个调用生成,另一个按标准评估并给反馈,生成的一方带着反馈重写,循环到通过。例:今天的客服回复循环 |
| 评估标准(rubric) | 评估者检查的几条规则,越具体越稳。例:「不超过 150 字」比「回复要简洁」稳 |
| 代码关 | 评估标准里能用代码判断的部分,确定、免费、瞬间。例:订单号有没有、字数超没超 |
| 模型关 | 评估标准里只能交给模型判断的部分。例:有没有说明下一步 |
| 收敛 | 循环里的稿子越改越接近通过。不收敛是指一直改不好 |
| `stuck` | 循环的一种停法:连着两轮(或见过同样的)问题清单,再改也没用 |
| `max_rounds` | 循环的另一种停法:轮数用完,不再改。没通过的稿子不能发 |
| 钻空子 | 生成的一方按评估者的反馈优化,找到一条评估者没写到、但同样不该写的路 |
| reflection(反思) | 学术上对「生成后让模型自己检查再改」这一类做法的统称。Reflexion、Self-Refine 是代表论文 |
| LLM-as-judge | 用大模型给输出打分或判断。今天的模型关就是一种 |
| 外部反馈 | 评估者不是模型而是真的去执行:测试、数据库、接口返回码。Day 203 会讲 |
| 相邻字符串自动拼接 | Python 里两个字符串字面量紧挨着写(中间只有空白或换行),会被自动拼成一个 |

## 常见误区

**评估标准写得模糊。** 「下一步要明确」「不要推卸」交给模型,它会用自己的严格程度去读。我实测小模型把两条合格的回复 12 次全判不及格,理由是「没写出何时提交」「把到账时间推给银行」。每条标准要写清楚边界,还要拿带标准答案的样本测一遍评估者。

**能用代码查的交给模型查。** 订单号有没有、字数超没超、有没有「已核实」,代码查又快又准又免费。把它们放在模型前面,代码关没过就不调模型,反馈还能带上具体数字(「至少要删掉 136 个字」)。

**循环没有上限,或者只有一种停法。** 只有「轮数用完」会白烧钱,只有「通过」会死循环。要三种:通过、用完轮数、同样的问题出现两次。

**没通过的稿子当最终稿发出去。** 我的第三遍循环用完 3 轮没通过,最后一稿里有「已核实」和编造的「已升级至技术团队」。`status` 不是 `passed` 就转人工,稿子只当线索给同事看。

**以为评估者拦不住的东西就是没问题。** 我第一版评估者没有「编造」和「经核实」两条,循环给了一个「通过」:「经核实……支付回调异常……24 小时内补充回复」。评估者只会拦它知道要拦的,每发现一种钻空子的写法,都要补一条规则和一条测试样本。

**标准和任务不匹配,却去怪模型。** 五件事的工单要求 150 字以内,4 遍全败。这是标准的问题。循环不收敛时,先看标准合不合理。

**并发跑实验却用全局计数。** 我第一版 `wf5_batch` 并发跑,「平均调用 8 到 11 次」比实际多三倍,因为 `total_calls()` 是全局的,几个循环同时跑会互相串。要么串行,要么每个循环自己记账。

**让评估者既评又改。** 评估者的输出只是「过不过」和「问题清单」,改稿的是另一个调用。把两件事混在一个提示词里,评估者会倾向于直接帮你改好,你就失去了对评审过程的观察。

## 学习资料

### 文档与文章

- [Anthropic · Building effective agents](https://www.anthropic.com/engineering/building-effective-agents):读「Workflow: Evaluator-optimizer」一节,两个适用信号(人给反馈有用、模型也能给反馈)今天都对着做了。英文。
- [claude-cookbooks · evaluator_optimizer.ipynb](https://github.com/anthropics/claude-cookbooks/blob/main/patterns/agents/evaluator_optimizer.ipynb):官方的参考实现,生成者和评估者用 XML 标签输出,循环到评估者说 PASS。和今天的写法对照,看它有没有轮数上限。英文。
- [Dylan Castillo · Evaluator-optimizer workflow with Pydantic AI](https://dylancastillo.co/til/evaluator-optimizer-pydantic-ai.html):用 Pydantic AI 写同一个模式,生成者和修复者是两个角色。英文。
- [DeepLearning.AI The Batch · Agentic Design Patterns Part 2: Reflection](https://www.deeplearning.ai/the-batch/agentic-design-patterns-part-2-reflection/):吴恩达讲反思模式,为什么让模型检查自己的输出能变好。英文。
- [Self-Refine 论文 · Iterative Refinement with Self-Feedback](https://arxiv.org/abs/2303.17651):同一个模型生成、反馈、改写。看摘要和实验结论里「哪些任务有提升」。英文。
- [Reflexion 论文 · Language Agents with Verbal Reinforcement Learning](https://arxiv.org/abs/2303.11366):把反馈写成文字存起来,下一轮带着它再做。英文。
- [Judging LLM-as-a-Judge 论文 · MT-Bench 和 Chatbot Arena](https://arxiv.org/abs/2306.05685):系统地研究用大模型当评估者的偏差(偏向长回答、偏向自己的输出等)。读摘要就够。英文。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1XwWizcEE5&autoplay=0&high_quality=1" title="【半小时总结】吴恩达最新 Agentic AI 智能体设计模式课程" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>安如衫 · 【半小时总结】吴恩达最新 Agentic AI 智能体设计模式课程 · 23 分钟,里面有反思(Reflection)这一类模式的讲解,看完对照今天的「是什么」和「评估者本身靠不靠谱」两节。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/sal78ACtGTc" title="What's next for AI agentic workflows ft. Andrew Ng of AI Fund" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Sequoia Capital · What's next for AI agentic workflows ft. Andrew Ng of AI Fund · 吴恩达讲 agentic workflow 为什么比一次生成强,反思是他举的第一个模式,英文。</figcaption>
</figure>

### 书籍

- Antonio Gulli《Agentic Design Patterns: A Hands-On Guide to Building Intelligent Systems》(Springer, 2025):有一章专讲反思(Reflection),带代码,英文。
- Chip Huyen《AI Engineering》(O'Reilly, 2025):讲用 AI 当评估者(AI as a judge)的优缺点和偏差,今天「评估者本身要测」的做法可以对着读,英文。

### 开源项目与代码

- [anthropics/claude-cookbooks](https://github.com/anthropics/claude-cookbooks):`patterns/agents/` 下是五种 workflow 模式的官方 notebook,今天把最后一个也补齐了。
- [langchain-ai/langgraph](https://github.com/langchain-ai/langgraph):第五部分会学。LangGraph 的图天然能表达「评估节点不通过就回到生成节点」的循环,轮数上限在图里叫 `recursion_limit`,现在有印象就行。

## 自测

1. 评估者-优化者和 Day 197 的提示链,「重写」的触发条件有什么不同?

<details><summary>答案</summary>

提示链里「门」是写死的代码规则,没过就带着原因重写,最多一次。评估者-优化者里评估者可以是模型,标准可以更模糊,而且是循环,可以评好几轮。能力更强,同时多了评估者自己靠不靠谱、循环什么时候停这两个问题。今天的做法其实是两者的混合:评估者的前半截(代码关)就是提示链里的门。

</details>

2. 为什么要把标准里的订单号、字数、「已核实」放在代码里查,而不是都交给模型?

<details><summary>答案</summary>

三个理由。一是确定性:代码对同一条回复永远给同一个结论,模型有随机性;二是成本:代码免费且瞬间,代码关没过时根本不用调模型;三是反馈质量:代码能给出具体到数字的反馈,比如「至少要删掉 136 个字」,生成的一方能照着改,模糊的「太长了」就难收敛。实测纯模型评估者把两条合格回复 12 次全判成不及格(小模型),改成代码加三条明确定义的模型判断后,10 条样本 60 次评审全对,而且便宜 8 倍。

</details>

3. 循环有哪三种停法?为什么「连着两轮问题一样」要单独算一种?

<details><summary>答案</summary>

通过、用完轮数、连续出现同样的问题。第三种单独算,是因为它说明「继续改也没用」:生成的一方没有听进反馈,或者评估者一直给同样的反馈,多跑的轮数只是烧钱。更严格的版本是只要见过同样的问题清单就停(练习 3),能拦住「太长、漏订单号、太长……」这种来回摆的情形。

</details>

4. 你的循环最后 `status` 是 `max_rounds`,`reply` 里有一段写得挺好的回复。能发给客户吗?

<details><summary>答案</summary>

不能。`max_rounds` 的意思是评估者最后一轮仍然不满意,这一稿没通过检查。实测里有一次这样的稿子里含有「已核实」和编造的「已升级至技术团队」。没通过的稿子只能当线索交给人工,由同事决定改不改、发不发。调用方要显式检查 `status == "passed"`,别只取 `reply` 就发。

</details>

5. 面试题:你做了一个让模型写代码、再让另一个模型评审代码的循环,上线后发现评审总是说 PASS,但代码经常有 bug。你怎么改?

<details><summary>答案</summary>

根本问题是评估者和生成者是同一类模型,犯同一种错,评审形同虚设。改法按优先级:一,把评估者换成能执行的东西:跑单元测试、类型检查、lint、在沙箱里实际运行,这些是外部反馈,不会和生成者共享盲区;二,让评估者的输出结构化(每条测试用例是否通过、哪一行报错),而不是一句 PASS;三,拿一批已知有 bug 和没 bug 的代码做样本,量评估者的召回率和误报率,就像今天对 10 条回复做的;四,评估者的提示里写清具体检查项和边界,不要「检查代码是否正确」这种模糊指令;五,循环要有上限和卡住检测,没通过的代码不能合并;六,模型评审留给测试覆盖不到的部分(可读性、命名),且人工抽查。还要监控线上:被评审通过的代码事后被发现的 bug 率,是评估者质量的真实指标。

</details>

## 明天预告

明天是 **Day 202 · 第 29 周复习:工具与 Agent 循环(Day 196–201)**。这一周把五种 workflow 模式各做了一遍:提示链、路由、并行、编排者-工作者、评估者-优化者,加上开头的「workflow 还是 agent」。明天不学新东西:画一张知识地图把五个模式和它们各自的门、停法对上,默写本周核心代码,把这周踩过的坑(「经核实」漏网、一致地错、「最多 5 个」写进提示词、并发乱记账)整理成错题清单。后天 Day 203 回到今天末尾留的话头:让数据库当评估者。
