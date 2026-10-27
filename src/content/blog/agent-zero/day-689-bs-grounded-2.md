---
title: 'Day 689 · BillSleuth(九):写作-校验-重写,校验器管不到的地方'
description: '把校验器的问题清单原样交回模型重写,最多两次,三稿都不过就用只含已验证内容的模板兜底,再接进调查图的 write_up 节点。去掉提示词里「不要自己算」给重写循环加压,16 个场景里 11 个一稿过、3 个重写一次、1 个重写两次、1 个兜底,并因此抓出 grounding.py 里一个把「同样数值的两条证据」当成一条的 bug。最后用真草稿做盲区实验:数字是真的、用在了错的地方,通用校验器 10 份全放行,专门检查 10 份全拦下。'
pubDate: 2026-10-27
regime: none
tags: ['billsleuth', 'grounding', 'langgraph', 'rewrite-loop', 'agent-zero']
series: 'agent-zero'
day: 689
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 688](/blog/agent-zero/day-688-bs-grounded-1/) 写了两份解释和数字溯源校验器:`explain.py` 让模型按规则各写一份给客户和给同事的,`grounding.py` 把里面的金额、百分比拿去证据链里找出处。16 份真实草稿里,客户版 16/16 通过,内部版 14/16 通过,另外两份里的 8 处孤儿数字(包括编出来的 360.00)一个不漏地被抓了出来。

但抓出来以后呢?今天做三件事:把问题清单交回模型重写,三次不过就用模板兜底;把这一整套接进调查图;最后承认一件事,这个校验器只管「数是不是从证据来的」,管不了「数用在了对的地方没有」,用真草稿做一个实验量一量这个盲区有多大,再补上最要紧的那一块。

## 今天要解决的问题

1. 写出 `explain()`:写、校验、带着问题清单重写,最多重写两次,还不过就用模板兜底,并说清楚兜底里为什么不能放任何没过校验的内容。
2. 用假写手写 10 条不花钱的测试,覆盖一稿过、重写后过、三稿不过走兜底、兜底不泄露模型写的东西。
3. 把 `write_up` 节点接进调查图,先看接完以后红了哪几条测试、为什么,再改好,用真模型跑 4 个场景。
4. 给重写循环加压:去掉提示词里「不要自己算」那一条,16 个场景各走一遍,看稿数分布;顺着一次兜底查出 `grounding.py` 里的一个 bug。
5. 做盲区实验,写出 `key_fact_problems`,并列出校验器依然管不到的几件事。

预计用时 4 小时。前置:[Day 688](/blog/agent-zero/day-688-bs-grounded-1/)(`explain.py`、`grounding.py`)、[Day 687](/blog/agent-zero/day-687-bs-run/)(`ScriptedLLM`、`run.py`)、[Day 686](/blog/agent-zero/day-686-bs-evidence/)(`graph.py`)。今天调真模型约 ¥0.5:写作共 31 次(重写循环加压 23 次、看每一稿 8 次)按每次约 ¥0.0105 算约 ¥0.33,加上端到端 4 个场景(调查 ¥0.1153、intake 4 × ¥0.0014、写作 4 次约 ¥0.04)约 ¥0.16。

学法提示:先对照文章逐行敲一遍(不复制粘贴)并跑通;第二天合上文章,把 `explain()` 的循环和 `_fallback` 默写出来;做练习,做不出再展开参考答案,看完关掉自己重写一遍。

## 概念一:写作、校验、重写

### 把问题清单原样交回去

昨天的 `check()` 返回一串问题,每条都写清了是哪个数、哪句话、为什么不行:「金额 360.00 在证据里找不到出处:……税额差 6.48 系订阅基数被抬高所致(360.00 的 9% 的差异)……」。怎么用它?

最省事的办法是让模型再写一遍,把这串问题原样附在提示词后面。模型不知道自己哪句错了的时候,重写往往换一种措辞犯同样的错;告诉它「哪个数、哪句话、为什么不行」,它通常能一次改对。这和 [Day 150](/blog/agent-zero/day-150-structured-4/) 结构化输出里「校验不过就把错误带回去重试」是同一个道理,只不过这次的错误信息由我们自己的校验器产生。

<figure>
<svg viewBox="0 0 640 270" role="img" aria-label="写作-校验-重写循环:模型写两份,客户版内部版和专门检查一起校验,有问题就把问题清单附在提示词后面重写,最多重写两次,三稿都不过用模板兜底,通过则去掉客户版编号返回">
  <rect x="0" y="0" width="640" height="270" fill="var(--paper-raised)" rx="6"/>
  <defs><marker id="a689" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0 L10 5 L0 10 z" fill="var(--ink-soft)"/></marker></defs>
  <g font-family="var(--font-mono)" font-size="11">
    <rect x="16" y="40" width="150" height="56" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
    <text x="91" y="62" text-anchor="middle" fill="var(--mem)" font-size="12">模型写两份</text>
    <text x="91" y="80" text-anchor="middle" fill="var(--mem)">带 [E#]</text>
    <line x1="166" y1="68" x2="206" y2="68" stroke="var(--ink-soft)" marker-end="url(#a689)"/>
    <rect x="208" y="24" width="250" height="90" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
    <text x="333" y="44" text-anchor="middle" fill="var(--compute)" font-size="12">校验(纯代码)</text>
    <text x="220" y="66" fill="var(--compute)">客户版 check(customer_view=True)</text>
    <text x="220" y="84" fill="var(--compute)">内部版 check()</text>
    <text x="220" y="102" fill="var(--compute)">key_fact_problems(关键数)</text>
    <line x1="458" y1="68" x2="498" y2="68" stroke="var(--ink-soft)" marker-end="url(#a689)"/>
    <rect x="500" y="40" width="124" height="56" rx="4" fill="none" stroke="var(--ink)"/>
    <text x="562" y="62" text-anchor="middle" fill="var(--ink)">没有问题</text>
    <text x="562" y="80" text-anchor="middle" fill="var(--ink-soft)">客户版去掉编号</text>
    <path d="M333 114 L333 156 L91 156 L91 96" fill="none" stroke="var(--compute)" marker-end="url(#a689)"/>
    <text x="104" y="148" fill="var(--compute)">有问题:问题清单附在提示词后面重写(最多 2 次)</text>
    <path d="M333 156 L333 196" fill="none" stroke="var(--ink-soft)" marker-end="url(#a689)"/>
    <rect x="208" y="198" width="250" height="52" rx="4" fill="none" stroke="var(--ink-faint)" stroke-dasharray="5 3"/>
    <text x="333" y="220" text-anchor="middle" fill="var(--ink-soft)">三稿都不过:模板兜底</text>
    <text x="333" y="238" text-anchor="middle" fill="var(--ink-faint)">只含结论和证据里的数,标记人工复核</text>
  </g>
</svg>
<figcaption>琥珀色是纯代码。重写是模型的事,放不放行始终是校验器说了算。</figcaption>
</figure>

### 兜底里放什么

三稿都不过怎么办?再写第四稿没有意义,模型在同一个坑里已经掉了三次。这时候用一个固定模板,它的价值只有一条:**里面的东西都可信**。所以它不能包含任何没过校验的内容。

这条规矩来自一个很容易犯的错。第一版模板想「信息量大一点」,顺手把模型在 `SubmitFindings` 里写的 `reasoning` 拼进了内部版。结果一次三稿都没过的运行里,兜底的内部版出现了 `156.00×1.09=170.04` 这样的算式,而这些数字恰恰是没经过校验的,三稿失败的原因可能就是它们。兜底等于绕过了校验器。现在的模板只有:发票号、多收金额(取自结论,并且 `write_up` 在写之前已经确认它在证据里有出处)、证据编号和「请人工复核」几个字。练习 1 会把这个错误故意写回去,看你现有的测试能不能发现。

### explain.py 追加

`explain.py` 今天有三处改动。文件开头的 import 加上了四行:

```python
import re
from decimal import Decimal
from typing import Any

from pydantic import BaseModel, Field

from billsleuth import grounding
from billsleuth.evidence import render
from billsleuth.grounding import amounts
```

<div class="line-notes">

- `import re` 今天的专门检查要用正则。
- `from decimal import Decimal` 比较金额用 `Decimal`,不用浮点数(Day 680)。
- `from billsleuth import grounding` 要调 `grounding.check` 和 `grounding.strip_citations`,用模块名调用,读代码时一眼知道这个函数从哪来。
- `from billsleuth.grounding import amounts` `amounts` 要单独用到,直接导进来。

</div>

昨天的 `write_once` 拆成两层:一个只管「拿提示词调模型」,一个管「拼提示词」。重写时提示词是在原来的后面追加问题清单,所以需要能直接传提示词的版本:

```python
def write_once_with(llm: Any, prompt: str) -> Explanation:
    writer = llm.with_structured_output(Explanation, method="function_calling")
    return Explanation.model_validate(writer.invoke(prompt))


def write_once(llm: Any, question: str, findings: dict, evidence: list[dict]) -> Explanation:
    return write_once_with(llm, writer_prompt(question, findings, evidence))
```

<div class="line-notes">

- `def write_once_with(llm: Any, prompt: str) -> Explanation:` 收一个现成的提示词。
- `writer = llm.with_structured_output(Explanation, method="function_calling")` 和昨天一样的结构化输出。
- `return Explanation.model_validate(writer.invoke(prompt))` 调模型、校验格式。
- `def write_once(llm: Any, question: str, findings: dict, evidence: list[dict]) -> Explanation:` 昨天的函数签名不变,`try_writer.py` 之类的老脚本照常能跑。
- `return write_once_with(llm, writer_prompt(question, findings, evidence))` 先拼提示词,再交给下一层。

</div>

然后在文件末尾追加今天的主体:

```python
MAX_REWRITES = 2
CLAIMS_OVERCHARGE = re.compile(r"(多收|多扣|多付|多算)[^。\n]{0,8}?(\d+\.\d{2})")


def key_fact_problems(findings: dict, customer_message: str) -> list[str]:
    """通用校验器管「数是不是从证据来的」,管不了「这个数用在了对的地方没有」。结论里最要紧的那个数单独查一遍。"""
    over = Decimal(findings.get("overcharge", "0.00"))
    problems = []
    if findings.get("expected_action") == "credit_note" and over not in amounts(customer_message):
        problems.append(f"客户版没有写明多收金额 {over}")
    if findings.get("expected_action") == "explain_only":
        for m in CLAIMS_OVERCHARGE.finditer(customer_message):
            if Decimal(m.group(2)) != 0 and not re.search("没|不|无", customer_message[max(0, m.start() - 4):m.start()]):
                problems.append(f"结论是账没有错,客户版却写了「{m.group(0)}」")
    return problems


def _fallback(findings: dict, evidence: list[dict]) -> Explanation:
    """模型写不出合格答案时的模板。宁可干巴巴,也不能有错数字,更不能混进没过校验的内容。"""
    inv = "、".join(findings.get("invoice_ids", []))
    over = findings.get("overcharge", "0.00")
    src = next((e["id"] for e in evidence if e["value"] == over and "多收" in e["claim"]), None)
    tag = f" [{src}]" if src else ""
    if findings.get("expected_action") == "credit_note":
        msg = (f"您好,我们核对了发票 {inv},确认多收了 {over} 美元{tag}。"
               "已提交更正申请,审核通过后会把多收的金额退回或抵扣,处理结果会邮件通知您。")
    else:
        msg = f"您好,我们核对了发票 {inv},金额按规则计算没有错误。具体明细我们的同事会再跟您说明。"
    return Explanation(customer_message=msg,
                       internal_note=f"模板兜底:模型 {MAX_REWRITES + 1} 稿都没写出合格解释,请人工复核。"
                                     f"根因 {findings.get('root_cause')},多收 {over}{tag}。")


def explain(llm: Any, question: str, findings: dict, evidence: list[dict]) -> dict:
    """写 → 校验 → 带着问题清单重写,最多重写 MAX_REWRITES 次;还不过就用模板兜底。"""
    prompt = writer_prompt(question, findings, evidence)
    feedback, attempts = "", []
    for _ in range(MAX_REWRITES + 1):
        exp = write_once_with(llm, prompt + feedback)
        cust = grounding.check(exp.customer_message, evidence, customer_view=True)
        internal = grounding.check(exp.internal_note, evidence)
        facts = key_fact_problems(findings, exp.customer_message)
        problems = cust.problems + facts + internal.problems
        attempts.append({"problems": problems, "warnings": cust.warnings + internal.warnings})
        if not problems:
            return {"customer_message": grounding.strip_citations(exp.customer_message),
                    "internal_note": exp.internal_note, "derived": cust.derived + internal.derived,
                    "warnings": cust.warnings + internal.warnings, "attempts": attempts, "fallback": False}
        feedback = "\n\n上一版没通过校验,问题如下,请改正后重写:\n- " + "\n- ".join(problems)
    fb = _fallback(findings, evidence)
    return {"customer_message": grounding.strip_citations(fb.customer_message), "internal_note": fb.internal_note,
            "derived": [], "warnings": [], "attempts": attempts, "fallback": True}


def overcharge_is_grounded(findings: dict, evidence: list[dict]) -> bool:
    """结论里的多收金额本身也要有出处:要么是 0.00,要么等于某条证据的值。"""
    over = findings.get("overcharge")
    return over == "0.00" or any(e["value"] == over for e in evidence)
```

<div class="line-notes">

- `MAX_REWRITES = 2` 最多重写两次,加第一稿一共最多三稿。
- `CLAIMS_OVERCHARGE = re.compile(r"(多收|多扣|多付|多算)[^。\n]{0,8}?(\d+\.\d{2})")` 「多收了 26.02」这种说法:动词,后面不超过 8 个非句号字符,再跟一个两位小数。`{0,8}?` 里的问号表示尽量少匹配。这条正则给下面的「账没错却说多收」检查用。
- `def key_fact_problems(findings: dict, customer_message: str) -> list[str]:` 专门检查。它依赖调查结论,所以不放在通用的 `grounding.py` 里。下一节讲为什么要有它。
- `over = Decimal(findings.get("overcharge", "0.00"))` 结论里的多收金额。
- `if findings.get("expected_action") == "credit_note" and over not in amounts(customer_message):` 结论要冲正,客户版里提取出的金额里必须有这个数。用 `amounts()` 取出的 `Decimal` 比较,而不是在字符串里找子串,否则「126.02」里也能找到「26.02」。
- `problems.append(f"客户版没有写明多收金额 {over}")` 问题里写出缺哪个数。
- `if findings.get("expected_action") == "explain_only":` 结论是账没错。
- `for m in CLAIMS_OVERCHARGE.finditer(customer_message):` 找客户版里每一处「多收了某某」。
- `if Decimal(m.group(2)) != 0 and not re.search("没|不|无", customer_message[max(0, m.start() - 4):m.start()]):` 金额不是 0,而且前面四个字符里没有「没、不、无」,才算「声称多收了」。第二个条件是防误伤「这不是额外多收的 189.87 美元」这类否定句。`max(0, ...)` 防止切片下标变成负数。
- `problems.append(f"结论是账没有错,客户版却写了「{m.group(0)}」")` 问题里带上那一小段原文。
- `def _fallback(findings: dict, evidence: list[dict]) -> Explanation:` 模板兜底。
- `inv = "、".join(findings.get("invoice_ids", []))` 发票号,多张用顿号连。
- `over = findings.get("overcharge", "0.00")` 多收金额直接取结论,不是模型写的 reasoning。
- `src = next((e["id"] for e in evidence if e["value"] == over and "多收" in e["claim"]), None)` 找「多收」那条证据的编号,找不到就是 None。
- `tag = f" [{src}]" if src else ""` 有编号就带上,方便同事核对。
- `if findings.get("expected_action") == "credit_note":` 要冲正的模板。
- `"已提交更正申请,审核通过后会把多收的金额退回或抵扣,处理结果会邮件通知您。")` 固定话术,不承诺时间和结果。
- `msg = f"您好,我们核对了发票 {inv},金额按规则计算没有错误。具体明细我们的同事会再跟您说明。"` 账没错的模板里没有任何金额。
- `internal_note=f"模板兜底:模型 {MAX_REWRITES + 1} 稿都没写出合格解释,请人工复核。"` 内部版只有几个字段:根因、多收金额、编号和「请人工复核」,没有 `reasoning`。
- `def explain(llm: Any, question: str, findings: dict, evidence: list[dict]) -> dict:` 主函数,返回一个字典(两份文字、记录、是否兜底)。
- `prompt = writer_prompt(question, findings, evidence)` 基础提示词,循环里不变。
- `feedback, attempts = "", []` `feedback` 是要追加的问题清单,第一稿为空;`attempts` 记每一稿的问题,调试和评测用。
- `for _ in range(MAX_REWRITES + 1):` 最多三稿。
- `exp = write_once_with(llm, prompt + feedback)` 写一稿。
- `cust = grounding.check(exp.customer_message, evidence, customer_view=True)` 客户版过严的校验。
- `internal = grounding.check(exp.internal_note, evidence)` 内部版过宽的校验。
- `facts = key_fact_problems(findings, exp.customer_message)` 专门检查。
- `problems = cust.problems + facts + internal.problems` 三路问题合并,客户版的排前面。
- `attempts.append({"problems": problems, "warnings": cust.warnings + internal.warnings})` 每一稿都记下来,通过的那一稿问题列表是空的。
- `if not problems:` 没有问题就返回。警告不阻断。
- `"internal_note": exp.internal_note, "derived": cust.derived + internal.derived,` 客户版去掉编号,内部版保留;推导数记下来供同事复核。
- `feedback = "\n\n上一版没通过校验,问题如下,请改正后重写:\n- " + "\n- ".join(problems)` 把问题清单拼成要追加的话。下一轮 `prompt + feedback` 就带着它。
- `fb = _fallback(findings, evidence)` 循环跑完还没返回,说明三稿都不过,用模板。
- `"derived": [], "warnings": [], "attempts": attempts, "fallback": True}` 兜底的结果里没有推导数和警告,因为模板里没有可推导的东西。`fallback` 为 True,后面的审批流程要靠它判断「这份需要人看」。
- `def overcharge_is_grounded(findings: dict, evidence: list[dict]) -> bool:` 写之前先问一句:结论里的多收金额本身有没有出处。
- `return over == "0.00" or any(e["value"] == over for e in evidence)` 0.00 永远允许,否则必须等于某条证据的值。结论里的数要是证据里都找不到,说明调查本身就有问题,不该进入写作。

</div>

### 不花钱的测试

写作环节的每个分支都能用假写手测。假写手和昨天的假模型一个思路:有 `with_structured_output` 和 `invoke`,按剧本出稿,并记下收到的提示词。新建 `tests/test_explain.py`:

```python
# billsleuth/tests/test_explain.py  写作-校验-重写:专门检查、模板兜底、重写循环,都不调模型
import pytest

from billsleuth.explain import MAX_REWRITES, Explanation, _fallback, explain, key_fact_problems, overcharge_is_grounded

EV = [
    {"id": "E1", "claim": "INV-0011-03 按规则应收", "source_tool": "recompute_invoice", "source_ref": "INV-0011-03", "value": "1412.42"},
    {"id": "E2", "claim": "INV-0011-03 实际开票金额", "source_tool": "recompute_invoice", "source_ref": "INV-0011-03", "value": "1438.44"},
    {"id": "E3", "claim": "INV-0011-03 多收(实际 - 应收)", "source_tool": "recompute_invoice", "source_ref": "INV-0011-03", "value": "26.02"},
]
CREDIT = {"root_cause": "timezone_change_date", "invoice_ids": ["INV-0011-03"], "overcharge": "26.02",
          "expected_action": "credit_note", "reasoning": "x"}
EXPLAIN = {"root_cause": "no_error", "invoice_ids": ["INV-0011-03"], "overcharge": "0.00",
           "expected_action": "explain_only", "reasoning": "x"}
GOOD = Explanation(customer_message="这张发票多收了 26.02 美元 [E3],已提交更正申请。", internal_note="多收 26.02 [E3]。")


class Writer:
    """按剧本出稿的假写手:每次 invoke 出下一份草稿,并记下收到的提示词。"""

    def __init__(self, drafts):
        self.drafts, self.prompts = list(drafts), []

    def with_structured_output(self, schema, method=None):
        return self

    def invoke(self, prompt):
        self.prompts.append(prompt)
        return self.drafts.pop(0)


def test_key_fact_requires_the_overcharge_for_credit_note():
    assert key_fact_problems(CREDIT, "多收了 26.02 美元。") == []
    assert key_fact_problems(CREDIT, "这张发票确实有问题。") == ["客户版没有写明多收金额 26.02"]
    assert key_fact_problems(CREDIT, "多收了 1412.42 美元。")  # 应收当成多收:数是真的,位置错了
    assert key_fact_problems(CREDIT, "多收了 126.02 美元。")  # 子串里有 26.02,但不是这个数


def test_key_fact_blocks_overcharge_claim_when_account_is_correct():
    assert key_fact_problems(EXPLAIN, "没有多收,多收金额为 0.00 美元。") == []
    assert key_fact_problems(EXPLAIN, "这不是额外多收的 189.87 美元。") == []  # 否定句不误伤
    assert key_fact_problems(EXPLAIN, "这张发票确实多收了 26.02 美元。")


def test_rewrite_gets_the_problem_list_then_passes():
    bad = Explanation(customer_message="这张发票确实有问题,已提交更正申请。", internal_note="多收 26.02 [E3]。")
    w = Writer([bad, GOOD])
    out = explain(w, "为什么多收", CREDIT, EV)
    assert out["fallback"] is False and len(out["attempts"]) == 2
    assert out["attempts"][0]["problems"] == ["客户版没有写明多收金额 26.02"]
    assert "客户版没有写明多收金额 26.02" in w.prompts[1] and "客户版没有写明多收金额" not in w.prompts[0]
    assert out["customer_message"] == "这张发票多收了 26.02 美元,已提交更正申请。"  # 编号已去掉


def test_three_failures_use_the_template_and_nothing_unverified():
    bad = Explanation(customer_message="多收了 25.80 美元。", internal_note="算式 156.00×1.09=170.04,多收 26.02 [E3]。")
    out = explain(Writer([bad] * (MAX_REWRITES + 1)), "为什么多收", CREDIT, EV)
    assert out["fallback"] is True and len(out["attempts"]) == MAX_REWRITES + 1
    assert "26.02" in out["customer_message"] and "25.80" not in out["customer_message"]
    assert "156.00" not in out["internal_note"] and "请人工复核" in out["internal_note"]  # 模板里没有模型写的任何数字


def test_fallback_for_explain_only_has_no_amounts():
    fb = _fallback(EXPLAIN, EV)
    assert "没有错误" in fb.customer_message and "美元" not in fb.customer_message


def test_overcharge_must_come_from_evidence():
    assert overcharge_is_grounded(CREDIT, EV)
    assert overcharge_is_grounded(EXPLAIN, EV)  # 0.00 永远允许
    assert not overcharge_is_grounded({**CREDIT, "overcharge": "170.00"}, EV)


@pytest.mark.parametrize("n_bad", [0, 1, 2])
def test_attempt_count_matches_number_of_bad_drafts(n_bad):
    bad = Explanation(customer_message="多收了 25.80 美元。", internal_note="x")
    out = explain(Writer([bad] * n_bad + [GOOD]), "q", CREDIT, EV)
    assert len(out["attempts"]) == n_bad + 1 and out["fallback"] is False


def test_fallback_never_includes_model_reasoning():
    findings = {**CREDIT, "reasoning": "折算 156.00×1.09=170.04,多收 26.02"}
    bad = Explanation(customer_message="多收了 25.80 美元。", internal_note="x")
    out = explain(Writer([bad] * (MAX_REWRITES + 1)), "q", findings, EV)
    assert "156.00" not in out["internal_note"] and "170.04" not in out["internal_note"]
```

<div class="line-notes">

- `from billsleuth.explain import MAX_REWRITES, Explanation, _fallback, explain, key_fact_problems, overcharge_is_grounded` 连下划线开头的 `_fallback` 也导进来直接测,这是 Python 里「约定不对外用,测试可以碰」的惯例。
- `EV = [` 三条手写证据:应收 1412.42、实收 1438.44、多收 26.02。
- `CREDIT = {"root_cause": "timezone_change_date",` 一个要冲正的结论,`EXPLAIN` 是账没错的结论。
- `GOOD = Explanation(customer_message="这张发票多收了 26.02 美元 [E3],已提交更正申请。", internal_note="多收 26.02 [E3]。")` 一份合格的草稿。
- `class Writer:` 假写手。`drafts` 是台词,`prompts` 记下每次收到的提示词,后面要检查「第二稿的提示词里有没有带上第一稿的问题」。
- `self.drafts, self.prompts = list(drafts), []` 复制一份台词。
- `def with_structured_output(self, schema, method=None):` 返回自己,`explain` 调这个方法拿到「写手」。
- `return self.drafts.pop(0)` 出下一份草稿。
- `assert key_fact_problems(CREDIT, "多收了 26.02 美元。") == []` 写明了多收金额:没有问题。
- `assert key_fact_problems(CREDIT, "这张发票确实有问题。") == ["客户版没有写明多收金额 26.02"]` 含糊其辞:问题里写出缺哪个数。
- `assert key_fact_problems(CREDIT, "多收了 1412.42 美元。")  # 应收当成多收:数是真的,位置错了` 本课盲区实验的缩影,通用校验器放行的这句,专门检查拦下。
- `assert key_fact_problems(CREDIT, "多收了 126.02 美元。")  # 子串里有 26.02,但不是这个数` 防「子串里找到就算」。
- `assert key_fact_problems(EXPLAIN, "没有多收,多收金额为 0.00 美元。") == []` 账没错的正常说法。
- `assert key_fact_problems(EXPLAIN, "这不是额外多收的 189.87 美元。") == []  # 否定句不误伤` 防误伤。
- `assert key_fact_problems(EXPLAIN, "这张发票确实多收了 26.02 美元。")` 账没错,却说多收:问题。
- `bad = Explanation(customer_message="这张发票确实有问题,已提交更正申请。", internal_note="多收 26.02 [E3]。")` 第一稿含糊,内部版没问题。
- `assert out["attempts"][0]["problems"] == ["客户版没有写明多收金额 26.02"]` 第一稿记录里只有这一条问题。
- `assert "客户版没有写明多收金额 26.02" in w.prompts[1] and "客户版没有写明多收金额" not in w.prompts[0]` 第二稿的提示词里带着问题,第一稿没有。这条断言证明了「问题清单真的交回去了」,而不只是循环转了两圈。
- `assert out["customer_message"] == "这张发票多收了 26.02 美元,已提交更正申请。"  # 编号已去掉` 返回的客户版不带 `[E3]`。
- `bad = Explanation(customer_message="多收了 25.80 美元。", internal_note="算式 156.00×1.09=170.04,多收 26.02 [E3]。")` 一份满是没出处的数字的草稿,内部版里的算式是兜底必须挡在外面的东西。
- `out = explain(Writer([bad] * (MAX_REWRITES + 1)), "为什么多收", CREDIT, EV)` 三稿都是同一份坏稿,必然兜底。`[bad] * 3` 是把列表重复 3 遍。
- `assert "26.02" in out["customer_message"] and "25.80" not in out["customer_message"]` 兜底里有证据里的 26.02,没有编的 25.80。
- `assert "156.00" not in out["internal_note"] and "请人工复核" in out["internal_note"]  # 模板里没有模型写的任何数字` 兜底的内部版里没有模型写的算式。
- `assert "没有错误" in fb.customer_message and "美元" not in fb.customer_message` 账没错的模板里没有金额。
- `assert overcharge_is_grounded(EXPLAIN, EV)  # 0.00 永远允许` 0.00 不需要出处。
- `assert not overcharge_is_grounded({**CREDIT, "overcharge": "170.00"}, EV)` 结论里的数在证据里没有:不放行。
- `@pytest.mark.parametrize("n_bad", [0, 1, 2])` 坏稿 0、1、2 份,后面都跟一份好稿。
- `assert len(out["attempts"]) == n_bad + 1 and out["fallback"] is False` 稿数等于坏稿数加一,没走兜底。边界:坏稿 2 份时第三稿是最后一次机会,过了就不兜底。
- `def test_fallback_never_includes_model_reasoning():` 练习 1 要补的测试,已经放在文件最后,先看看它在守什么。
- `findings = {**CREDIT, "reasoning": "折算 156.00×1.09=170.04,多收 26.02"}` 结论里的 reasoning 故意带一个没出处的算式。
- `assert "156.00" not in out["internal_note"] and "170.04" not in out["internal_note"]` 兜底的内部版里不能出现它。

</div>

```bash
uv run pytest tests/test_explain.py -q
```

```text
..........                                                               [100%]
10 passed in 0.03s
```

## 接进调查图

### write_up 节点

昨天说过 `write_up` 放在 `conclude` 之后。`graph.py` 有三处改动:导入两个函数,状态里加一个 `reply` 字段,`build_graph` 里加节点、改边:

```python
from billsleuth.explain import explain, overcharge_is_grounded   # 新增,放在 from billsleuth import evidence as ev 的下一行

class CaseState(CaseInput, total=False):
    ...
    escalated: bool
    reply: dict                                                    # 新增

    # build_graph 里,conclude 函数后面新增:
    def write_up(state: CaseState) -> dict:
        """Day 689 新增:结论里的多收金额先过溯源检查,再写两份解释。结论没出来就不写。"""
        findings, evidence = state.get("findings", {}), state.get("evidence", [])
        if state.get("escalated") or not overcharge_is_grounded(findings, evidence):
            return {"escalated": True, "reply": {}}
        return {"reply": explain(llm, state["question"], findings, evidence)}

    # 注册节点的列表里加一项 ("write_up", write_up),末尾的边改成:
    g.add_edge("conclude", "write_up")
    g.add_edge("write_up", END)
```

<div class="line-notes">

- `from billsleuth.explain import explain, overcharge_is_grounded   # 新增,放在 from billsleuth import evidence as ev 的下一行` 导入两个函数。
- `escalated: bool` 状态里已有的字段。
- `reply: dict                                                    # 新增` 解释的结果,字典:两份文字、稿数记录、是否兜底。没有 reducer,覆盖就行,只写一次。
- `def write_up(state: CaseState) -> dict:` 新节点。
- `findings, evidence = state.get("findings", {}), state.get("evidence", [])` 取结论和证据链。
- `if state.get("escalated") or not overcharge_is_grounded(findings, evidence):` 两种情况不写:结论已经转人工(没交卷、格式错);或者结论里的多收金额在证据里找不到出处。
- `return {"escalated": True, "reply": {}}` 都转人工,`reply` 留空。第二种情况是 `write_up` 新增的转人工原因,以前图里不会因为「金额没出处」转人工。
- `return {"reply": explain(llm, state["question"], findings, evidence)}` 写作用的是和调查同一个模型对象 `llm`,所以假模型测试里同一个演员既念调查的台词也念写作的台词。
- `g.add_edge("conclude", "write_up")` `conclude` 以后不再直接结束。
- `g.add_edge("write_up", END)` 写完结束。

</div>

写作的 token 不计进 `state["tokens"]`(它们在 `explain` 里没有往回传),费用在 `run.py` 里不显示,下面的花费是我按每次约 ¥0.0105 单独估的。想把它也记进去,要让 `explain` 返回用量,是 Day 693 评测之前值得做的小改造。

### 接完以后红了五条

改完马上跑全部测试,不要先改测试:

```bash
uv run pytest -q
```

```text
FAILED tests/test_graph.py::test_happy_path_collects_evidence_and_findings - ...
FAILED tests/test_graph.py::test_parallel_calls_each_get_a_tool_message - pyd...
FAILED tests/test_graph.py::test_nudge_then_submit_is_not_escalated - pydanti...
FAILED tests/test_graph.py::test_system_prompt_is_rebuilt_each_round_and_tokens_add_up
FAILED tests/test_graph_parts.py::test_graph_shape - AssertionError: assert {...
5 failed, 274 passed in 8.27s
```

红了五条,原因有两种,而且都在意料之中。`test_graph_shape` 是节点集合多了一个 `write_up`,把期望集合改一下:

```python
    assert set(g.nodes) == {"__start__", "intake", "locate", "investigate", "tools", "nudge", "conclude", "write_up", "__end__"}
```

<div class="line-notes">

- `assert set(g.nodes) == {"__start__", "intake", "locate", "investigate", "tools", "nudge", "conclude", "write_up", "__end__"}` Day 686 的图形状测试,节点多了 `write_up`。三条条件边都还从 `investigate` 出发,没有变,下面一行不用改。

</div>

另外四条是 Day 687 的假模型测试,原因是同一个:图现在会走到 `write_up`,而假模型的 `with_structured_output` 不管被问什么都返回 intake 那份对象。看失败原文:

```text
E   pydantic_core._pydantic_core.ValidationError: 1 validation error for Explanation
E     Input should be a valid dictionary or instance of Explanation [type=model_type, input_value=Intake(complaint='取消...mount='174.90', month=9), input_type=Intake]
E   During task with name 'write_up' and id 'cb8f6e0d-1616-a553-7d3b-247f17203687'
```

(中间几行省略,id 每次不同。)`write_up` 要 `Explanation`,假模型递过来一个 `Intake`。另外几条走转人工的测试没红,因为转人工时 `write_up` 直接跳过,根本不调模型。改假模型:让它看 `with_structured_output` 收到的 `schema` 是谁,intake 就返回 intake,写作就从「写解释的台词」里取下一份。

```python
class ScriptedLLM:
    """只实现图里用到的三个方法:bind_tools、with_structured_output、invoke。回话按剧本一条条出。"""

    def __init__(self, intake: Intake, script: list[AIMessage], drafts: list[Explanation] | None = None):
        self.intake, self.script, self.seen = intake, list(script), []
        self.drafts = list(drafts) if drafts is not None else [GOOD] * 5  # 写解释的台词,默认五份都合格
        self.writer_prompts: list[str] = []

    def bind_tools(self, tools):
        return self

    def with_structured_output(self, schema, method=None):
        outer = self

        class _S:
            def invoke(self, prompt):
                if schema is Intake:
                    return outer.intake
                outer.writer_prompts.append(prompt)  # 写解释那一步:念下一份草稿
                return outer.drafts.pop(0)
        return _S()

    def invoke(self, messages):
        self.seen.append(messages)
        return self.script.pop(0)
```

<div class="line-notes">

- `def __init__(self, intake: Intake, script: list[AIMessage], drafts: list[Explanation] | None = None):` 多收一个 `drafts` 参数,默认 `None`。这样 Day 687 写的七处 `ScriptedLLM(INTAKE, [...])` 调用不用改。
- `self.drafts = list(drafts) if drafts is not None else [GOOD] * 5  # 写解释的台词,默认五份都合格` 没给就默认五份合格的草稿。`GOOD` 在文件后面定义,`__init__` 运行时它已经存在。
- `self.writer_prompts: list[str] = []` 记下写作那一步收到的提示词,后面的测试要看。
- `def invoke(self, prompt):` 那个临时小类 `_S` 的 `invoke` 现在收到的就是提示词。
- `if schema is Intake:` 按 schema 分流:建图时 `intake_llm = llm.with_structured_output(Intake, ...)` 传的就是 `Intake` 这个类。
- `outer.writer_prompts.append(prompt)  # 写解释那一步:念下一份草稿` 写作那一步,记下提示词。
- `return outer.drafts.pop(0)` 念下一份草稿。

</div>

`GOOD` 放在 `INTAKE` 后面:

```python
INTAKE = Intake(complaint="取消后仍扣款", amount="174.90", month=9)
GOOD = Explanation(customer_message="您好,订阅在 9 月到期后不应再开票,这张发票多收了 174.90 美元。已提交更正申请,审核通过后会把多收的金额退回或抵扣。",
                   internal_note="取消后仍扣款:INV-0001-05 多收 174.90。")
```

<div class="line-notes">

- `INTAKE = Intake(complaint="取消后仍扣款", amount="174.90", month=9)` 昨天就有的 S001 的 intake。
- `GOOD = Explanation(customer_message="您好,订阅在 9 月到期后不应再开票,这张发票多收了 174.90 美元。已提交更正申请,审核通过后会把多收的金额退回或抵扣。",` 一份能通过校验的客户版。174.90 在 S001 的证据里:locate 取回的发票列表里每张发票总额都是 174.90,所以连只调了 `get_customer` 的测试里也有这个出处。
- `internal_note="取消后仍扣款:INV-0001-05 多收 174.90。")` 内部版同理。

</div>

再在 `test_happy_path_collects_evidence_and_findings` 末尾补一行断言,并在文件末尾加三条新测试:

```python
    assert out["reply"]["fallback"] is False and len(out["reply"]["attempts"]) == 1   # 加在 happy path 最后
```

```python
def test_bad_draft_is_rewritten_with_problem_list():
    bad = Explanation(customer_message="多收了 170.00 美元。", internal_note="多收 174.90。")
    llm = ScriptedLLM(INTAKE, [AIMessage("", tool_calls=[submit(1)])], drafts=[bad, GOOD])
    out = run(llm)
    assert out["reply"]["fallback"] is False and len(out["reply"]["attempts"]) == 2
    assert "金额 170.00 在证据里找不到出处" in llm.writer_prompts[1]  # 第二稿的提示词里带着第一稿的问题清单
    assert "170.00" not in out["reply"]["customer_message"]


def test_three_bad_drafts_fall_back_to_template():
    bad = Explanation(customer_message="多收了 170.00 美元 [E9]。", internal_note="多收 170.00。")
    out = run(ScriptedLLM(INTAKE, [AIMessage("", tool_calls=[submit(1)])], drafts=[bad, bad, bad]))
    assert out["reply"]["fallback"] is True and out["escalated"] is False
    assert "174.90" in out["reply"]["customer_message"] and "[E" not in out["reply"]["customer_message"]
    assert "请人工复核" in out["reply"]["internal_note"]


def test_overcharge_without_evidence_is_escalated_before_writing():
    llm = ScriptedLLM(INTAKE, [AIMessage("", tool_calls=[submit(1, overcharge="170.00")])])
    out = run(llm)
    assert out["escalated"] is True and out["reply"] == {}
    assert llm.writer_prompts == []  # 连写都没写
```

<div class="line-notes">

- `bad = Explanation(customer_message="多收了 170.00 美元。", internal_note="多收 174.90。")` 第一稿里有一个编的数。
- `llm = ScriptedLLM(INTAKE, [AIMessage("", tool_calls=[submit(1)])], drafts=[bad, GOOD])` 调查只有一句台词(直接交卷),写作两份草稿:一坏一好。
- `assert out["reply"]["fallback"] is False and len(out["reply"]["attempts"]) == 2` 重写一次后通过。
- `assert "金额 170.00 在证据里找不到出处" in llm.writer_prompts[1]  # 第二稿的提示词里带着第一稿的问题清单` 整个图里也验证了问题清单交回去了。
- `assert "170.00" not in out["reply"]["customer_message"]` 最终发出去的客户版没有那个数。
- `bad = Explanation(customer_message="多收了 170.00 美元 [E9]。", internal_note="多收 170.00。")` 另一份坏稿,三次都念它。
- `drafts=[bad, bad, bad]))` 三稿全坏。
- `assert out["reply"]["fallback"] is True and out["escalated"] is False` 走兜底,但没有转人工:兜底的文字本身可信,是否需要人看由 `reply["fallback"]` 这个标记告诉下游。
- `assert "174.90" in out["reply"]["customer_message"] and "[E" not in out["reply"]["customer_message"]` 兜底里是证据里的 174.90,没有编号残留。
- `assert "请人工复核" in out["reply"]["internal_note"]` 内部版标明了要复核。
- `llm = ScriptedLLM(INTAKE, [AIMessage("", tool_calls=[submit(1, overcharge="170.00")])])` 交卷时多收金额写成 170.00,证据里没有这个数。
- `assert out["escalated"] is True and out["reply"] == {}` 转人工,而且没有解释。
- `assert llm.writer_prompts == []  # 连写都没写` 写作那一步一次都没调用,没有花钱。

</div>

```bash
uv run pytest -q
```

```text
.....................................................................
294 passed in 7.05s
```

(省略了前面的进度点。)294 条全绿。这个数是今天所有改动之后的总数:Day 688 结束时 279 条,今天加了 10 条写作测试(`test_explain.py`)、三条图测试、一条 `grounding.py` 的测试(后面会讲为什么)和一条时间承诺的测试。

### run.py 打印解释

在 `run.py` 里,把 `print(f"  结论:...` 前面加上这一段,让它把两份解释、每一稿的问题打出来:

```python
    reply = s.get("reply") or {}
    if reply:
        print(f"  客户版:{reply['customer_message']}")
        print(f"  内部版:{reply['internal_note']}")
        for n, a in enumerate(reply["attempts"], start=1):
            for prob in a["problems"]:
                print(f"    第 {n} 稿问题:{prob[:110]}")
        print(f"  写作:{len(reply['attempts'])} 稿,兜底={reply['fallback']},推导数 {len(reply['derived'])} 个,警告 {len(reply['warnings'])} 条")
```

<div class="line-notes">

- `reply = s.get("reply") or {}` 转人工的场景没有 `reply`,取不到就当空。
- `print(f"  客户版:{reply['customer_message']}")` 客户版,编号已去掉。
- `for n, a in enumerate(reply["attempts"], start=1):` 每一稿,序号从 1 开始。
- `print(f"    第 {n} 稿问题:{prob[:110]}")` 没通过的稿子打出问题,通过的稿子问题列表是空的,什么都不打。
- `print(f"  写作:{len(reply['attempts'])} 稿,兜底={reply['fallback']},推导数 {len(reply['derived'])} 个,警告 {len(reply['warnings'])} 条")` 一行汇总。

</div>

同时把返回字典加两个字段(`"writes"` 和 `"fallback"`),最后的汇总行加上写作稿数和兜底次数。完整改动是 `return` 那几行多了 `"writes": len(reply.get("attempts", [])), "fallback": bool(reply.get("fallback"))`,汇总行多了 `写作共 N 稿、兜底 M`,照着 `run.py` 现有的写法加就行。

### 真模型跑 4 个场景

```bash
uv run python -m billsleuth.run S011 S009 S017 S023
```

下面是 S011 的完整输出(其他三个的写作情况在后面):

```text
=== S011 C-0011:8 月这张发票金额 1438.44,我们财务对不上账,麻烦查一下。
  [intake] {'complaint': '金额不对', 'amount': '1438.44', 'month': 8}
  [locate] 候选 ['INV-0011-03']
  [investigate] → get_customer({"customer_id": "C-0011"})
  [investigate] → get_invoice({"invoice_id": "INV-0011-03"})
  [investigate] → get_subscription_timeline({"customer_id": "C-0011"})
  [investigate] → recompute_invoice({"invoice_id": "INV-0011-03"})
  [investigate] → get_tax_rate({"region": "SG", "on": "2026-08-01"})
  [investigate] → list_payments({"customer_id": "C-0011", "invoice_id": "INV-0011-03"})
  [investigate] → SubmitFindings({"root_cause": "timezone_change_date", "invoice_ids": ["INV-0011-03"], "overcharge": "26.02", "expected_action)
  5 次模型调用(含 intake),调查阶段输入 13943 / 输出 801 token,约 ¥0.0343
  客户版:您好,我们核对过了:8 月这张发票确实多收了 26.02 美元。

原因是升级生效的日期按本地时间算应该是 7 月 15 日,但发票里两笔按天折算的费用是从 7 月 14 日开始算的,多算了一天,所以折算部分和对应的税都偏高了一点。发票总额 1438.44 美元,按规则应为 1412.42 美元。

我们已提交更正申请,审核通过后会把多收的金额退回或抵扣。给您对账添了麻烦,后续有进展我们会同步。
  内部版:根因类别:timezone_change_date(时区导致的生效日期错位)。

关键事实:客户时区 Asia/Singapore [E7],税务地区 SG [E6]。升级事件 EV-0011-2 的 UTC 时间为 2026-07-14T22:50:00+00:00,对应本地日期 2026-07-15 [E20],proration 应从本地 07-15 起算;但 INV-0011-03 两条 proration 行均写成 2026-07-14 至 2026-08-01 [E12][E13],多算一天。

金额核对(recompute_invoice INV-0011-03):
- 应收合计 1412.42 [E22],实际开票 1438.44 [E23],多收 26.02 [E24]。
- recurring:应收 890.00 [E26] = 实收 890.00 [E27],差额 0.00 [E28],无问题。
- proration:应收 405.80 [E29] vs 实收 429.67 [E30],差额 23.87 [E31]。
  明细:第1行 应收 -82.26 [E35] vs 实收 -87.10 [E39];第2行 应收 488.06 [E36] vs 实收 516.77 [E40]。
- tax:应收 116.62 [E32] vs 实收 118.77 [E33],差额 2.15 [E34],即 proration 差额按 9% 计:23.87 × 0.09 = 2.15。
- 合计差额:23.87 + 2.15 = 26.02 [E24]。

排除项:税率 SG-GST9 = 0.09,2026-08-01 有效 [E43][E45],无过期/错地区;扣款仅 1 笔 succeeded 1438.44 [E46][E25],无重复扣款;同期无其他发票 [E1][E2][E4][E5] 重复开票。

处理动作:credit_note,按 26.02 出具更正/贷记,冲减 proration 23.87 与 tax 2.15。客户侧仅告知"已提交更正申请,审核通过后退回或抵扣",不承诺时间与结果。
  写作:1 稿,兜底=False,推导数 0 个,警告 0 条
  结论:timezone_change_date ['INV-0011-03'] 多收 26.02  标准答案:timezone_change_date ['INV-0011-03'] 多收 26.02  ✓
```

最后一行汇总:

```text
4/4 命中,发票号一致 3/4,转人工 0,写作共 4 稿、兜底 0,调查共 ¥0.1153(不含 intake 和写作)
```

4 个场景都是一稿通过,没有走兜底,没有推导数,没有警告。内部版写得很详细:S011 那份把每个金额的编号都标了,还把「23.87 × 0.09 = 2.15」这样的算式写了出来,而 0.09 是证据里的税率,23.87 和 2.15 都是现成的差额,所以也没触发任何问题。

客户版在去掉编号以后读起来是干净的。S017 的客户版节选:

```text
=== S017 (节选)
  客户版:您好，经核对，9 月 14 日这两笔 123.60 美元的扣款确实重复了，多收了 123.60 美元。

原因是同一张 9 月账单被系统扣了两次：账单本身金额没有问题，应收 123.60 美元，实际开票也是 123.60 美元，但当天先后成功扣款两笔，各 123.60 美元，合计 247.20 美元。

我们已提交更正申请，审核通过后会把多收的金额退回或抵扣。后续进展会再与您同步，感谢您的耐心。
  ……(内部版略)
  写作:1 稿,兜底=False,推导数 0 个,警告 0 条
  结论:duplicate_charge ['INV-0017-05'] 多收 123.60  标准答案:duplicate_charge ['INV-0017-05'] 多收 123.60  ✓
```

S023 的发票号还是两张(`['INV-0023-04', 'INV-0023-04D']`),和 Day 687 一样,口径留给 Day 693。花费:调查 ¥0.1153(不含 intake),intake 约 ¥0.0056,写作 4 次约 ¥0.04,合计约 ¥0.16。

## 给重写循环加压

### 4 个都一稿过,说明不了循环有用

昨天说过,提示词里有「不要自己算」时,16 份草稿里只有两份内部版有问题。端到端 4 个场景又全是一稿过。这样的话重写循环和兜底一次都没被用到,我没法说它们是对的。所以故意给它加压:提示词里去掉「不要自己算」那一条,温度调到 1,16 个场景各走一遍 `explain()`:

```python
# billsleuth/scratch/loop_stress.py  给重写循环加压:提示词里去掉「不要自己算」,温度 1,16 个场景各走一遍 explain()
from collections import Counter

from billsleuth import explain as ex
from billsleuth.llm import get_llm
from scratch.case_kit import load_case

IDS = "S001 S002 S003 S004 S005 S006 S009 S011 S012 S017 S018 S019 S020 S021 S023 S031".split()
LINE = "- 需要算的数(差额、合计)不要自己算,证据清单里有现成的就用现成的;没有就不要写这个数。\n"
ex.WRITER_RULES = ex.WRITER_RULES.replace(LINE, "")
llm = get_llm(temperature=1.0)
hist: Counter[int] = Counter()
for sid in IDS:
    q, findings, ev = load_case(sid)
    out = ex.explain(llm, q, findings, ev)
    n = len(out["attempts"])
    hist[n] += 1
    first = out["attempts"][0]["problems"]
    print(f"{sid}: {n} 稿,兜底={out['fallback']},第一稿问题 {len(first)} 条" + (f":{first[0][:60]}" if first else ""))
print("稿数分布:", dict(sorted(hist.items())))
```

<div class="line-notes">

- `from billsleuth import explain as ex` 导入模块本身,为了能改它里面的 `WRITER_RULES`。
- `LINE = "- 需要算的数(差额、合计)不要自己算,证据清单里有现成的就用现成的;没有就不要写这个数。\n"` 要去掉的那一条,昨天练习 3 用过。
- `ex.WRITER_RULES = ex.WRITER_RULES.replace(LINE, "")` 去掉。`writer_prompt` 每次调用时读这个全局变量,所以对后面所有调用生效。
- `llm = get_llm(temperature=1.0)` 温度 1,让模型更容易出错。
- `hist: Counter[int] = Counter()` 数「几个场景用了几稿」。
- `q, findings, ev = load_case(sid)` 昨天的 `case_kit.py`,用标准答案造结论和证据。
- `out = ex.explain(llm, q, findings, ev)` 走完整的写、校验、重写、兜底。
- `first = out["attempts"][0]["problems"]` 第一稿有哪些问题。
- `print(f"{sid}: {n} 稿,兜底={out['fallback']},第一稿问题 {len(first)} 条" + (f":{first[0][:60]}" if first else ""))` 一行汇总,有问题的把第一条问题的前 60 个字打出来。

</div>

```bash
uv run python -m scratch.loop_stress
```

```text
S001: 1 稿,兜底=False,第一稿问题 0 条
S002: 1 稿,兜底=False,第一稿问题 0 条
S003: 1 稿,兜底=False,第一稿问题 0 条
S004: 1 稿,兜底=False,第一稿问题 0 条
S005: 1 稿,兜底=False,第一稿问题 0 条
S006: 1 稿,兜底=False,第一稿问题 0 条
S009: 2 稿,兜底=False,第一稿问题 4 条:金额 1.09 在证据里找不到出处:- 原价：195.00 [E16] × 1.09 = 212.55，与 INV-00
S011: 1 稿,兜底=False,第一稿问题 0 条
S012: 3 稿,兜底=False,第一稿问题 1 条:金额 5.26 在证据里找不到出处:另 858.40 - 830.71 = 27.69 [E14][E13]，27.69
S017: 1 稿,兜底=False,第一稿问题 0 条
S018: 1 稿,兜底=False,第一稿问题 0 条
S019: 1 稿,兜底=False,第一稿问题 0 条
S020: 1 稿,兜底=False,第一稿问题 0 条
S021: 2 稿,兜底=False,第一稿问题 5 条:金额 6.00 在证据里找不到出处:根因类别:wrong_plan_price(订阅费单价比价目表每席位多 6.00)。
S023: 3 稿,兜底=True,第一稿问题 1 条:金额 279.06 在证据里找不到出处:故该周期合计扣款 = 139.05 + 139.05 = 279.06,其中一张
S031: 2 稿,兜底=False,第一稿问题 1 条:金额 0.19 在证据里找不到出处:- 实收:120.00 × (1 + 19%) = 142.80 [E18][E19
稿数分布: {1: 11, 2: 3, 3: 2}
```

(这一轮跑的时候 `grounding.py` 还是昨天的版本,下面会看到这一点为什么重要。)

16 个场景:11 个一稿过,3 个(S009、S021、S031)重写一次就过,S012 重写两次才过,S023 三稿都没过,走了兜底。一次运行、16 个样本,不要当成精确比例,但看得出几件事:

- **重写确实有用。** 第一稿有问题的 5 个场景里,4 个在两三稿内改对了。
- **问题清单越具体,改得越快。** S009 第一稿的问题是「金额 1.09 在证据里找不到出处」(模型算了 195.00 × 1.09),S031 是「0.19 找不到」(写了 120.00 × (1 + 19%)),它们一次重写就改对了。
- **兜底是真的会发生的。** 16 个里有 1 个,不是理论上的。

### S023 为什么三稿都没过

S023 是重复开票:同一个周期开了两张 139.05 的发票,各扣了一笔 139.05。看看这一个场景里每一稿的问题。(同样的加压设置,单跑 S023,打印每一稿的问题清单。这是另一次运行,模型的输出和上面那一轮不完全一样,但撞上的是同一类问题。)

```python
# billsleuth/scratch/show_attempts.py  同样的加压设置只跑一个场景,把每一稿的问题清单全打出来
import sys

from billsleuth import explain as ex
from billsleuth.llm import get_llm
from scratch.case_kit import load_case

LINE = "- 需要算的数(差额、合计)不要自己算,证据清单里有现成的就用现成的;没有就不要写这个数。\n"
ex.WRITER_RULES = ex.WRITER_RULES.replace(LINE, "")
q, findings, ev = load_case(sys.argv[1])
out = ex.explain(get_llm(temperature=1.0), q, findings, ev)
for n, a in enumerate(out["attempts"], start=1):
    print(f"第 {n} 稿:{'通过' if not a['problems'] else str(len(a['problems'])) + ' 条问题'}")
    for p in a["problems"]:
        print("   ", p[:150])
print("兜底:", out["fallback"])
print("客户版:", out["customer_message"])
```

<div class="line-notes">

- `q, findings, ev = load_case(sys.argv[1])` 命令行给场景号。
- `out = ex.explain(get_llm(temperature=1.0), q, findings, ev)` 同样的加压设置。
- `for n, a in enumerate(out["attempts"], start=1):` 每一稿一行,有问题的把问题全列出来。
- `print(f"第 {n} 稿:{'通过' if not a['problems'] else str(len(a['problems'])) + ' 条问题'}")` 通过或几条问题。
- `print("兜底:", out["fallback"])` 是否走了模板。
- `print("客户版:", out["customer_message"])` 最终发出去的客户版,兜底的话就是模板那句。

</div>

```bash
uv run python -m scratch.show_attempts S023
```

```text
第 1 稿:1 条问题
    金额 278.10 在证据里找不到出处:另一张 INV-0023-04 同周期同额 139.05 [E3],合计重复扣款 139.05 + 139.05 = 278.10,其中多收部分 = 139.05 [E10]。
第 2 稿:2 条问题
    金额 278.10 在证据里找不到出处:算式:同一周期应只扣 139.05 [E7],实际两张各扣 139.05 [E10] + 139.05 [E3 同额] = 278.10,多收部分 = 278.10 - 139.05 = 139.05 [E10]。
    金额 278.10 在证据里找不到出处:算式:同一周期应只扣 139.05 [E7],实际两张各扣 139.05 [E10] + 139.05 [E3 同额] = 278.10,多收部分 = 278.10 - 139.05 = 139.05 [E10]。
第 3 稿:1 条问题
    金额 278.10 在证据里找不到出处:注意：两笔扣款合计的 278.10 在证据清单里没有直接出处，客户沟通与内部单据中不要写这个合计数，只写多收的 139.05。
兜底: True
客户版: 您好,我们核对了发票 INV-0023-04D,确认多收了 139.05 美元。已提交更正申请,审核通过后会把多收的金额退回或抵扣,处理结果会邮件通知您。
```

这三稿里模型的毛病完全一样:它想写「两笔各 139.05,合计 278.10」。278.10 不在证据里,但它是 139.05 + 139.05,按理该算「由两条证据相加得到」的推导数,内部版应该放行才对。为什么没放行?

回去看 `grounding.py` 里推导数那一行:`combinations(money, 2)`,而 `money` 是一个**集合**。集合会把相同的值合并成一个,所以两笔 139.05 的扣款在 `money` 里只剩一个 139.05,「任取两个不同的值」永远配不出 139.05 + 139.05。第三稿更荒唐,模型写了「注意:两笔扣款合计的 278.10 在证据清单里没有直接出处,客户沟通与内部单据中不要写这个合计数」,为了说「不要写」把这个数又写了一遍,校验器忠实地又拦了一次。

这是校验器的 bug,不是模型的错,而且是真实运行抓出来的。我昨天的 13 条测试里没有一条是「两条证据数值相同」的情形。修法是让「证据」而不是「数值」参与配对:

```python
def _money_list(evidence: list[dict]) -> list[Decimal]:
    """证据里「形状是金额」的值,一条证据一个,重复的不去重:两笔 139.05 的扣款就是两个 139.05。"""
    vals = []
    for e in evidence:
        d = _dec(e["value"])
        if d is not None and d == d.quantize(CENT):
            vals.append(d.quantize(CENT))
    return vals


def _derivable(vals: list[Decimal]) -> set[Decimal]:
    """任取两条证据(不是两个不同的值),它们的和与差的绝对值。"""
    out: set[Decimal] = set()
    for x, y in combinations(vals, 2):
        out.add(abs(x - y))
        out.add(abs(x) + abs(y))
    return out
```

<div class="line-notes">

- `def _money_list(evidence: list[dict]) -> list[Decimal]:` 昨天的 `_money_values` 改名并改成返回列表。改名要同步改所有用到它的地方,Day 688 练习 2 的脚本里那句要写成 `set(grounding._money_list(ev))`。
- `vals = []` 空列表,不是 `set()`。
- `vals.append(d.quantize(CENT))` 追加,同样的值出现几次就有几个。
- `def _derivable(vals: list[Decimal]) -> set[Decimal]:` 先把所有可能的和与差一次算出来,放进集合。
- `for x, y in combinations(vals, 2):` 配对的是列表里的**位置**,不是值,所以两个 139.05 能配成一对。
- `out.add(abs(x - y))` 差的绝对值。
- `out.add(abs(x) + abs(y))` 绝对值之和。
- `return out` 返回集合,后面判断 `q in derivable` 是一次哈希查找。

</div>

`check()` 里相应改三处:

```python
    money_list = _money_list(evidence)
    money = set(money_list)
    derivable = _derivable(money_list)
    ...
            elif q in derivable:
```

<div class="line-notes">

- `money_list = _money_list(evidence)` 带重复的列表,只用来算推导数。
- `money = set(money_list)` 判断「金额等于某条证据」只需要知道有没有,用集合。
- `derivable = _derivable(money_list)` 每次 `check` 算一次。证据 60 条左右时配对不到两千对,算得起。
- `elif q in derivable:` 取代昨天那一长串 `any(abs(x - y) == q or ... for x, y in combinations(money, 2))`,同时每个金额不用再重新配对一遍。

</div>

补一条测试放在 `tests/test_grounding.py`,先红后绿:

```python
def test_same_amount_twice_is_derivable_when_two_evidences_have_it():
    pay = {"source_tool": "list_payments", "source_ref": "INV-0023-04", "value": "139.05"}
    two = [{"id": "E1", "claim": "扣款 PAY-0023-04", **pay}, {"id": "E2", "claim": "扣款 PAY-0023-04D", **pay}]
    assert check("两笔各 139.05 美元,合计 278.10 美元。", two).derived  # 内部版:两条证据相加
    assert not check("合计 278.10 美元。", two[:1]).ok  # 只有一笔,不能凭空加倍
```

<div class="line-notes">

- `pay = {"source_tool": "list_payments", "source_ref": "INV-0023-04", "value": "139.05"}` 两笔扣款共用的字段。
- `two = [{"id": "E1", "claim": "扣款 PAY-0023-04", **pay}, {"id": "E2", "claim": "扣款 PAY-0023-04D", **pay}]` 两条证据,值相同、编号和 claim 不同。
- `assert check("两笔各 139.05 美元,合计 278.10 美元。", two).derived  # 内部版:两条证据相加` 内部版放行,记成推导数。修之前这条是红的。
- `assert not check("合计 278.10 美元。", two[:1]).ok  # 只有一笔,不能凭空加倍` 只给一条证据,278.10 配不出来,仍然是问题。这条是防止修过头。

</div>

修完重新跑 S023(同样的加压设置,又一次独立的运行,所以输出不同):

```text
第 1 稿:1 条问题
    金额 15.00 在证据里找不到出处:- 订阅侧参数:create 事件 2026-06-15、plan_id=starter、quantity=9 [E23][E24][E25],与 9 席位 × 15.00 = 135.00 一致,排除席位/套餐变更导致的价差。
第 2 稿:1 条问题
    金额 15.00 在证据里找不到出处:- 不含 15.00 单价等无法在证据清单中找到出处的数字。
第 3 稿:通过
兜底: False
客户版: 您好,核对后确认:2026-09-15 至 2026-10-15 这个周期确实被重复计费了一次,金额 139.05 美元 是您多付的部分。

原因是同一段服务周期里出了两张内容相同的账单,两张都实际扣了款,所以您账上对不上。

下一步:我们已提交更正申请,审核通过后会把多收的 139.05 美元 退回或抵扣到您后续账单;审核结果我们会同步给您。
```

这一次是另一类问题:模型写了「9 席位 × 15.00 = 135.00」,15.00 是单价,这一回调查没有取到单价这一行。三稿里的第三稿通过了,没有走兜底。注意第二稿的问题:「不含 15.00 单价等无法在证据清单中找到出处的数字」,模型在一句「我不会用这个数」的话里又把它写了出来。**校验器是字面的**,它不懂「说不用它」和「用它」的区别。这一类也是真实的盲区,在后面列出来。

S012 的一次重写则是另一种样子:第一稿写「27.69×19%≈5.26,与实际 5.27 的 0.01 差异为四舍五入」,5.26 和 0.01 都是模型自己算的,被拦了两条,第二稿换了说法就过了。

```text
第 1 稿:2 条问题
    金额 5.26 在证据里找不到出处:差额来自 proration 基数偏高,27.69×19%≈5.26,与实际 5.27 [E18] 的 0.01 差异为四舍五入。
    金额 0.01 在证据里找不到出处:差额来自 proration 基数偏高,27.69×19%≈5.26,与实际 5.27 [E18] 的 0.01 差异为四舍五入。
第 2 稿:通过
兜底: False
客户版: 您好,我们核对后确认,8 月这张发票(INV-0012-03)确实多收了 32.96 美元。

这张发票按规则应该是 2259.46 美元,实际开票并扣款是 2292.42 美元。原因是您 7 月 7 日从入门版升级到商业版时,按剩余天数折算的那部分费用,我们把周期天数算多了一天,导致这部分金额偏高;多出来的金额里也包含了随之多算的税。

我们已提交更正申请,审核通过后会把多收的 32.96 美元 以退回或抵扣的方式处理。给您财务对账添麻烦了,后续有结果会及时同步。
```

## 校验器管不到的地方

### 数是真的,用错了地方

数字溯源校验器只回答一个问题:这个数是不是从证据来的。它回答不了:这个数是不是用在了对的地方。

举个例子。证据里有 E1「按规则应收 = 1412.42」。如果模型写「这张发票多收了 1412.42 美元 [E1]」,校验器放行:1412.42 确实在证据里,编号也对得上。可这句话是错的,多收的是 26.02。这类错误在研究里叫「引用了真实来源,却支持了错误的论断」。ALCE 那篇论文专门把「引用是否支持这句话」作为一个单独的指标来评测,FActScore 把长文本拆成原子事实逐个核对。

先量一量这个盲区有多大。用昨天那 16 份真草稿做实验:挑出结论要冲正的,把客户版里的多收金额换成应收金额(「多收了 26.02 美元」变「多收了 1412.42 美元」),再分别交给通用校验器和 `key_fact_problems`:

```python
# billsleuth/scratch/blind_spot.py  盲区实验:把真草稿客户版里的多收金额换成应收金额(数是真的,用错了地方),谁能拦住
import json
import re

from billsleuth.explain import key_fact_problems
from billsleuth.grounding import check
from scratch.case_kit import load_case

drafts = json.load(open("out/drafts.json"))
n = passed_general = caught_key = clean_flagged = clean_total = 0
for sid, d in drafts.items():
    _, findings, ev = load_case(sid)
    over = findings["overcharge"]
    expected = next(e["value"] for e in ev if e["claim"].endswith("按规则应收"))
    clean_total += 1
    clean_flagged += bool(key_fact_problems(findings, d["customer"]))  # 原样草稿,不该被拦
    if findings["expected_action"] != "credit_note" or expected == over:
        continue
    bad = d["customer"].replace(over, expected)  # 多收 26.02 变成多收 1412.42
    n += 1
    passed_general += check(bad, ev, customer_view=True).ok
    caught_key += bool(key_fact_problems(findings, bad))
print(f"原样草稿被专门检查拦下:{clean_flagged}/{clean_total}")
print(f"{n} 份改过的草稿:通用校验器放行 {passed_general} 份,专门检查拦下 {caught_key} 份")
```

<div class="line-notes">

- `n = passed_general = caught_key = clean_flagged = clean_total = 0` 一行给五个计数器赋同一个初值 0。
- `_, findings, ev = load_case(sid)` 结论和证据。
- `over = findings["overcharge"]` 真正的多收金额,比如 `"26.02"`。
- `expected = next(e["value"] for e in ev if e["claim"].endswith("按规则应收"))` 证据里「按规则应收」那条的值,比如 `"1412.42"`。
- `clean_flagged += bool(key_fact_problems(findings, d["customer"]))  # 原样草稿,不该被拦` 先看原样草稿:专门检查误伤了几份。
- `if findings["expected_action"] != "credit_note" or expected == over:` 只改要冲正的;重复扣款、重复开票这两类应收和多收恰好相等,换了等于没换,跳过。
- `bad = d["customer"].replace(over, expected)  # 多收 26.02 变成多收 1412.42` 把文字里的多收金额替换成应收金额,其他一字不动。
- `passed_general += check(bad, ev, customer_view=True).ok` 通用校验器放行了几份。
- `caught_key += bool(key_fact_problems(findings, bad))` 专门检查拦下几份。

</div>

```bash
uv run python -m scratch.blind_spot
```

```text
原样草稿被专门检查拦下:0/16
10 份改过的草稿:通用校验器放行 10 份,专门检查拦下 10 份
```

结论要冲正的 12 份里有 10 份可以这样改(另外 2 份是重复扣款和重复开票,应收和多收本来就相等)。改完以后:通用校验器 10 份**全部放行**(数都在证据里),专门检查 10 份**全部拦下**,而且在 16 份原样草稿上没有误伤。这和 Day 686 说的「结论是要冲正的,客户版里就必须出现结论里的多收金额」是同一条规则,今天写进了 `key_fact_problems`。它挡不住所有语义错误,但能挡住这类最伤人的错误里的绝大部分:模型要是写错了金额,正确的多收金额就不会出现在文字里。

「通用检查加一条针对最关键字段的专门检查」在生产系统里很常见,也很划算:通用的管广度,专门的管深度。

### 还管不到的几件事

专门检查补上了最要紧的一块,下面这些还是漏的,都是今天实际碰到的:

<figure>
<svg viewBox="0 0 640 250" role="img" aria-label="校验分三层:数字溯源由代码保证;关键数和承诺词由专门检查保证;原因讲得对不对、语气是否得体、引用是否支持句子,靠评测集上的 LLM judge 和人工抽检">
  <rect x="0" y="0" width="640" height="250" fill="var(--paper-raised)" rx="6"/>
  <g font-family="var(--font-mono)" font-size="11">
    <rect x="16" y="20" width="608" height="64" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
    <text x="30" y="42" fill="var(--compute)" font-size="12">第一层:通用校验,硬保证(grounding.py)</text>
    <text x="30" y="62" fill="var(--compute)">金额和百分比有出处 / 符号对 / 引用编号存在 / 客户版没有内部用语、退款承诺、时限承诺</text>
    <rect x="16" y="96" width="608" height="64" rx="4" fill="none" stroke="var(--ink)"/>
    <text x="30" y="118" fill="var(--ink)" font-size="12">第二层:专门检查,硬保证(key_fact_problems)</text>
    <text x="30" y="138" fill="var(--ink-soft)">冲正时客户版必须写明多收金额 / 账没错时客户版不能说多收了某个数</text>
    <rect x="16" y="172" width="608" height="64" rx="4" fill="var(--mem-wash)" stroke="var(--mem)" stroke-dasharray="5 3"/>
    <text x="30" y="194" fill="var(--mem)" font-size="12">第三层:语义,没有硬保证(Day 693 起的评测)</text>
    <text x="30" y="214" fill="var(--mem)">原因讲得对不对 / 引用是否真的支持那句话 / 语气是否得体 / 「说不用这个数」</text>
  </g>
</svg>
<figcaption>前两层是确定的代码,放不放行有定论;第三层只能靠 LLM judge 和人工抽检,给出的是错误率,不是保证。</figcaption>
</figure>

**引错编号只记警告。** S017 的内部版里「overcharge = 123.60 [E10]」,E10 是扣款合计 247.20。123.60 在证据里(是账单应收 [E7]),所以不是编造,只是引用错了位置。内部版同事点开 E10 会发现对不上。把它升级成问题,会让很多合理的算式因为同一个数出现在几条证据里而被误拦;目前只警告,留给评测去量它多常见。

**原因讲错了。** 校验器只看数字。模型可以把 S011 的原因说成「税率用错了」,所有数字照样对得上证据,校验器放行。这类错误要靠评测集(Day 693 起)里的 LLM judge 或人工抽检,没有便宜的代码办法。

**提了一个数,但说的是「不要用它」。** 刚才 S023 的第二稿就是,校验器是字面的。

**日期。** 昨天练习 4 量过:94 个 ISO 日期全对,14 个「7 月 16 日」写法没法直接核对,先没加规则。

**承诺词表是手列的。** `BANNED` 只有八个词。客户版里「我们会在 3 个工作日内退回」没有数字对不上、没有禁用词,会被放行。这个洞很容易补,而且我写测试的时候,第一版又漏了一处,看下面。

### 补时间承诺

在 `grounding.py` 加一个正则,客户版里出现「几个工作日内、几天内、几小时内」这类处理时限,直接算问题:

```python
TIME_PROMISE = re.compile(r"(?:\d+|[一二两三四五六七八九十几]+)\s*个?(?:工作日|天|小时)内")   # 放在 BANNED 附近

        if m := TIME_PROMISE.search(text):   # 放在 check() 里 if customer_view: 的下面
            rep.problems.append(f"客户版不能承诺处理时限「{m.group(0)}」:审批要多久不是 Agent 说了算")
```

<div class="line-notes">

- `TIME_PROMISE = re.compile(` 数字(阿拉伯数字或中文数字,「几」也算),可以带「个」,单位是工作日、天、小时,后面必须跟「内」。末尾的「内」是关键:「折算了 17 天的费用」是在说计费天数,不会命中。
- `if m := TIME_PROMISE.search(text):` 放在 `if customer_view:` 里面,只检查客户版。
- `rep.problems.append(f"客户版不能承诺处理时限「{m.group(0)}」:审批要多久不是 Agent 说了算")` 问题里写出命中的那一小段原文,模型重写时看得到。

</div>

测试放在 `tests/test_grounding.py` 末尾:

```python
def test_customer_view_forbids_time_promises():
    r = check("已提交更正申请,我们会在 3 个工作日内退回多收的 26.02 美元。", EV, customer_view=True)
    assert not r.ok and any("处理时限" in p for p in r.problems)
    assert not check("预计两天内到账。", EV, customer_view=True).ok
    assert check("您 7 月 15 日升级,折算了 17 天的费用。", EV, customer_view=True).ok  # 「17 天」后面没有「内」,是在说计费天数
    assert check("三天内到账。", EV).ok  # 内部版不管这条
```

<div class="line-notes">

- `r = check("已提交更正申请,我们会在 3 个工作日内退回多收的 26.02 美元。", EV, customer_view=True)` 典型的越权承诺。
- `assert not r.ok and any("处理时限" in p for p in r.problems)` 被拦,而且问题里点明了是时限。
- `assert not check("预计两天内到账。", EV, customer_view=True).ok` 中文数字。我第一版的字符类里没有「两」,这一行当场红了:`AssertionError: assert not True`,「两天内」被放过了。人写「两天」比「二天」多得多,补上「两」和「几」才绿。
- `assert check("您 7 月 15 日升级,折算了 17 天的费用。", EV, customer_view=True).ok  # 「17 天」后面没有「内」,是在说计费天数` 防误伤,计费天数在解释里很常见。
- `assert check("三天内到账。", EV).ok  # 内部版不管这条` 这条规矩只在客户版里。

</div>

16 份真草稿里一份都没有命中,所以不影响昨天的数字。全部测试:

```bash
uv run pytest -q
```

```text
294 passed in 7.05s
```

## 今天的文件

| 零件 | 文件 | 新建还是修改 | 后面哪天用到 |
| --- | --- | --- | --- |
| 重写循环、兜底、专门检查 | `billsleuth/explain.py` | 修改 | Day 690 起草贷记单前要用 `reply["fallback"]` |
| 推导数按证据配对、时间承诺 | `billsleuth/grounding.py` | 修改 | Day 693 评测 |
| `write_up` 节点 | `billsleuth/graph.py` | 修改 | Day 690 在它之后加审批 |
| 打印解释 | `billsleuth/run.py` | 修改 | Day 693 |
| 写作测试 | `tests/test_explain.py` | 新建 | 每次改写作 |
| 假模型多念写作台词、三条图测试 | `tests/test_graph.py` | 修改 | 每次改图 |
| 图形状测试 | `tests/test_graph_parts.py` | 修改(多一个节点) | |
| 校验器测试 | `tests/test_grounding.py` | 修改(多两条) | |
| 草稿 | `scratch/loop_stress.py`、`show_attempts.py`、`blind_spot.py`、`ex1`~`ex4` | 新建 | |

今天花费:见开头的算式,合计约 ¥0.5。三天合计(Day 687 约 ¥0.67、Day 688 约 ¥0.5、今天约 ¥0.5)约 ¥1.7。

## 动手练习

**练习 1:把兜底里混进 reasoning,看你现有的测试能不能发现。** 把 `_fallback` 里内部版的字符串末尾加上 `{findings.get('reasoning', '')}`,跑全部测试,再写一条能抓住它的测试。

<details><summary>参考答案</summary>

```python
# billsleuth/scratch/ex1_fallback_leak.py  练习 1:有人为了「信息量大一点」,把模型写的 reasoning 拼进了兜底的内部版
from billsleuth import explain as ex
from tests.test_explain import CREDIT, EV, Writer

findings = {**CREDIT, "reasoning": "折算 156.00×1.09=170.04,多收 26.02"}
bad = ex.Explanation(customer_message="多收了 25.80 美元。", internal_note="x")
note = ex.explain(Writer([bad] * 3), "q", findings, EV)["internal_note"]
print(note)
```

<div class="line-notes">

- `from tests.test_explain import CREDIT, EV, Writer` 复用测试文件里的结论、证据和假写手。
- `findings = {**CREDIT, "reasoning": "折算 156.00×1.09=170.04,多收 26.02"}` 在要冲正的结论上加一个带没出处算式的 reasoning。
- `note = ex.explain(Writer([bad] * 3), "q", findings, EV)["internal_note"]` 三稿全坏,走兜底,取兜底的内部版。

</div>

```text
模板兜底:模型 3 稿都没写出合格解释,请人工复核。根因 timezone_change_date,多收 26.02 [E3]。
```

这是正确的版本。现在改 `_fallback`,在内部版字符串末尾加 `{findings.get('reasoning', '')}`:

```text
模板兜底:模型 3 稿都没写出合格解释,请人工复核。根因 timezone_change_date,多收 26.02 [E3]。折算 156.00×1.09=170.04,多收 26.02
```

没校验过的算式混进来了。然后跑昨天写的 `test_three_failures_use_the_template_and_nothing_unverified`:**它是绿的**。因为那条测试里 `CREDIT` 的 `reasoning` 是 `"x"`,拼进去也没有数字,测试看不出区别。这是我自己的测试盲区,一条测试「通过」不等于它守住了规则。补一条 reasoning 带数字的:

```python
def test_fallback_never_includes_model_reasoning():
    findings = {**CREDIT, "reasoning": "折算 156.00×1.09=170.04,多收 26.02"}
    bad = Explanation(customer_message="多收了 25.80 美元。", internal_note="x")
    out = explain(Writer([bad] * (MAX_REWRITES + 1)), "q", findings, EV)
    assert "156.00" not in out["internal_note"] and "170.04" not in out["internal_note"]
```

在错误版本上这条红(`1 failed, 9 passed`),改回正确版本全绿(`10 passed`)。**测试要拿坏代码试一试**:守规则的测试,删掉被守的那行以后必须会红,否则它只是看起来在守。

</details>

**练习 2:加一条「结论要冲正,客户版却说没有多收」的自相矛盾检查。** 先在 16 份草稿里量一量这类句子有几份,再决定要不要加。

<details><summary>参考答案</summary>

```python
# billsleuth/scratch/ex2_contradiction.py  练习 2:结论要冲正,客户版却说「没有多收」,这种自相矛盾能不能抓
import json
import re

from billsleuth.explain import key_fact_problems
from scratch.case_kit import load_case

DENY = re.compile(r"没有多收|没多收|未多收|不存在多收|没有多扣|没有多付")
drafts = json.load(open("out/drafts.json"))
hits = credit = 0
for sid, d in drafts.items():
    _, findings, _ = load_case(sid)
    if findings["expected_action"] == "credit_note":
        credit += 1
        hits += bool(DENY.search(d["customer"]))
print(f"要冲正的 {credit} 份客户版里,写了「没有多收」的:{hits} 份")

findings = {"root_cause": "x", "invoice_ids": ["INV-0011-03"], "overcharge": "26.02", "expected_action": "credit_note"}
text = "您好,这张发票没有多收,不过多收了 26.02 美元。"
print("规则加入之前:", key_fact_problems(findings, text))
```

<div class="line-notes">

- `DENY = re.compile(r"没有多收|没多收|未多收|不存在多收|没有多扣|没有多付")` 常见的几种否定说法。
- `if findings["expected_action"] == "credit_note":` 只数要冲正的。
- `hits += bool(DENY.search(d["customer"]))` 命中就加 1。
- `text = "您好,这张发票没有多收,不过多收了 26.02 美元。"` 一句自己打自己脸的话。
- `print("规则加入之前:", key_fact_problems(findings, text))` 现有的专门检查看不出问题,因为它只查「冲正时多收金额出现没出现」,26.02 出现了。

</div>

```bash
uv run python -m scratch.ex2_contradiction
```

```text
要冲正的 12 份客户版里,写了「没有多收」的:1 份
规则加入之前: []
```

12 份里有 1 份命中,看它是哪一份:S011 的客户版里写的是「常规的席位费用本身没有多收」,这是一句**局部**的、完全合理的话(固定席位费确实没多收,多收在折算和税上)。所以这条规则上线以后第一个动作就是误伤一份正常草稿,逼模型白白重写,而且重写时的问题清单会让它困惑。结论:不加成「问题」。要加的话降成**警告**记下来,留给评测去数,或者把规则收窄成「整段话里没有任何其他多收金额」。这再次说明:**不是每一个能想到的检查都值得加,先拿真数据量误伤率。**

</details>

**练习 3:时间承诺的正则,拿一批句子试试。** 用 8 个句子测一测 `TIME_PROMISE`,看哪些误伤、哪些漏掉,怎么改。

<details><summary>参考答案</summary>

```python
# billsleuth/scratch/ex3_time_promise.py  练习 3:时间承诺的正则,拿一批句子试试会不会误伤、会不会漏
from billsleuth.grounding import TIME_PROMISE

samples = [
    "我们会在 3 个工作日内退回。",
    "预计两天内到账。",
    "一周内给您答复。",
    "7 天内会有结果。",
    "您 7 月 15 日升级,折算了 17 天的费用。",
    "这张发票的计费周期是 30 天内的一个自然月。",
    "审核通过后尽快退回。",
    "24 小时内处理完毕。",
]
for s in samples:
    m = TIME_PROMISE.search(s)
    print(f"{'拦' if m else '放'}  {s}" + (f"   命中「{m.group(0)}」" if m else ""))
```

<div class="line-notes">

- `samples = [` 八个句子:五个真承诺(含一个「一周内」用了「周」)、一个计费天数、一个「30 天内的一个自然月」(不是承诺)、一个「尽快」(模糊承诺)。
- `m = TIME_PROMISE.search(s)` 命中就拿到 match 对象,没命中是 None。
- `print(f"{'拦' if m else '放'}  {s}" + (f"   命中「{m.group(0)}」" if m else ""))` 一行打出拦还是放,拦的把命中的片段也打出来。

</div>

```bash
uv run python -m scratch.ex3_time_promise
```

```text
拦  我们会在 3 个工作日内退回。   命中「3 个工作日内」
拦  预计两天内到账。   命中「两天内」
放  一周内给您答复。
拦  7 天内会有结果。   命中「7 天内」
放  您 7 月 15 日升级,折算了 17 天的费用。
拦  这张发票的计费周期是 30 天内的一个自然月。   命中「30 天内」
放  审核通过后尽快退回。
拦  24 小时内处理完毕。   命中「24 小时内」
```

三个问题。漏:「一周内」,单位里没有「周」,补上 `周|星期` 就行。误伤:「30 天内的一个自然月」,是在描述计费周期而不是在承诺,这个句子在账单解释里不算稀有,只靠正则没法区分,办法是让模型的提示词里就别写「X 天内」这种说法,或者拦下来以后让重写,代价是偶尔白重写一次。模糊承诺「尽快退回」放过了:它没有给出具体时限,风险小很多,但同样是 Agent 替审批流程说话,要不要禁是业务决定。我的选择是时限类硬拦、模糊类放行并留给评测抽检。

</details>

**练习 4:S012 里 0.01 为什么也被拦了?该不该拦?** 第一稿里「与实际 5.27 的 0.01 差异为四舍五入」被拦了两条(5.26 和 0.01),跑一下看看具体是哪条规则起的作用。

<details><summary>参考答案</summary>

```python
# billsleuth/scratch/ex4_rounding.py  练习 4:S012 的第一稿里「四舍五入差 0.01」被拦了两条,想想该不该拦
from billsleuth.grounding import check
from scratch.case_kit import load_case

_, _, ev = load_case("S012")
text = "差额来自 proration 基数偏高,27.69×19%≈5.26,与实际 5.27 [E18] 的 0.01 差异为四舍五入。"
r = check(text, ev)
print(f"ok={r.ok}")
for p in r.problems:
    print(" ", p[:40])
print([e for e in ev if e["id"] == "E18"][0]["claim"], "=", [e for e in ev if e["id"] == "E18"][0]["value"])
```

<div class="line-notes">

- `text = "差额来自 proration 基数偏高,27.69×19%≈5.26,与实际 5.27 [E18] 的 0.01 差异为四舍五入。"` 第一稿里的那句话。
- `r = check(text, ev)` 按内部版的规矩检查。
- `for p in r.problems:` 把问题打出来,每条截 40 个字符。
- `print([e for e in ev if e["id"] == "E18"][0]["claim"]` 查证据 E18 是什么,验证 5.27 确实在证据里。

</div>

```bash
uv run python -m scratch.ex4_rounding
```

```text
ok=False
  金额 5.26 在证据里找不到出处:差额来自 proration 基数偏高,27
  金额 0.01 在证据里找不到出处:差额来自 proration 基数偏高,27
INV-0012-03 tax 差额 = 5.27
```

5.27 是证据(E18,税差额),5.26 是模型自己算的 27.69 × 19%,0.01 是 5.27 减 5.26,两个数都是模型自己算出来的,不在证据里,也不是任意两条证据的和或差,所以按第 4 档被拦。该不该拦?这句话是模型在「验算时发现差一分钱,解释成四舍五入」。内容也许是对的,但这是在**给自己的推理找台阶**,同事要复核的是 5.27 对不对,不需要这句话。第二稿模型换了说法,不再提这个差,通过了,内部说明还更干净。所以我认为该拦,而且问题清单足够具体,模型一次就改对了。有人会觉得「0.01 的四舍五入差」也要拦太苛刻,那就是把「金额下限」(比如 0.05 以下不查)写进规则,代价是漏掉小额编造。取舍由你们的业务风险决定,但要有意识地做。

</details>

**验收标准:** `uv run pytest -q` 全绿(294 条左右);`tests/test_explain.py` 10 条能不看文章说出每条守的规则;`run.py` 跑 S011 能看到客户版、内部版、「写作:1 稿」;能解释为什么 S023 的三稿都没过、`grounding.py` 里的 bug 在哪、怎么修;练习 1 能说明为什么原来的兜底测试是绿的;能说出校验器的三层保证里哪些是硬的、哪些不是。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 写作-校验-重写 | 生成后用代码检查,把问题清单交回模型重写的循环,例子:`explain()` 最多三稿 |
| 模板兜底 | 重写几次仍不合格时,用只含已验证内容的固定模板输出,并标记人工复核 |
| 专门检查 | 针对结论里最关键的字段单独写的检查,依赖具体结论,例子:`key_fact_problems` |
| 盲区 | 校验器看不见的错误类型,例子:数是真的、用在了错的地方 |
| 引用支持度 | 被引用的证据是否真的支持那句话,和「编号存在」不是一回事 |
| 假写手 | 按剧本出草稿的假模型,用来不花钱地测重写循环,例子:`Writer` |
| 一稿过 | 第一稿就通过校验,不需要重写,例子:16 个场景里 11 个 |
| 加压 | 故意把条件弄得更容易出错(去掉提示词一条规则、调高温度),看补救机制是否起作用 |
| 字面的 | 校验器只看文字里有没有这个数,不懂语义,例子:「不要写 15.00」里的 15.00 照样被拦 |
| 时间承诺 | 客户版里「几个工作日内退回」这类处理时限,审批要多久不由 Agent 决定 |
| 抽检 | 不是每一份都查,按比例人工抽查,用来估计校验器管不到的那一层的错误率 |

## 常见误区

**校验器抓到问题,就丢给用户一句「出错了」。** 抓到问题的价值在于把具体的问题清单交回模型,实测 5 个第一稿有问题的场景里 4 个在两三稿内改对了。

**兜底模板写得越详细越好。** 兜底的价值是里面的东西都可信,任何没过校验的内容(哪怕是模型的 reasoning)混进去都会毁掉它。而且你的测试可能发现不了:练习 1 里原来的兜底测试在错误版本上也是绿的。

**4 个场景都一稿过,重写循环就没问题。** 它一次都没被用到。加压以后才看到重写、兜底和校验器自己的 bug。

**用集合去重再配对。** `combinations(set(...), 2)` 把两笔 139.05 的扣款合并成一个数,配不出 139.05 + 139.05。要配对的是证据,不是数值。这个 bug 昨天的 13 条测试一条都没碰到,是真实运行抓出来的。

**通用校验器通过了,就说明回答是对的。** 盲区实验里 10 份把多收写成应收的草稿,通用校验器全部放行。最要紧的字段要单独查。

**每想到一个检查就加一条规则。** 练习 2 里「说了没有多收」的规则在 12 份里就误伤了 1 份正常草稿。先量误伤率,再决定是问题、警告还是不加。

**测试绿了就守住了。** 把被守的那行改坏,测试必须会红。昨天那条兜底测试就没有这个能力。

## 学习资料

### 文档与文章

- [Chain-of-Verification 论文](https://arxiv.org/abs/2309.11495):先生成、再自己提出核查问题、逐个回答后修正,和我们「写作-校验-重写」思路相近,区别是我们的核查由代码完成,20 分钟。
- [ALCE:让大模型生成带引用的文本](https://arxiv.org/abs/2305.14627):把「引用是否支持这句话」作为单独指标,对应今天的盲区,30 分钟。
- [FActScore 论文](https://arxiv.org/abs/2305.14251):把长文本拆成原子事实逐个核对,想做第三层语义检查时从这里入手,30 分钟。
- [Hamel Husain · Your AI Product Needs Evals](https://hamel.dev/blog/posts/evals/):怎么用评测集持续监控校验器管不到的那一层,25 分钟。
- [Python 文档 · itertools.combinations](https://docs.python.org/zh-cn/3.12/library/itertools.html#itertools.combinations):配对按位置不按值,和今天那个 bug 直接相关,中文,5 分钟。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1E8pz6vEaB&autoplay=0&high_quality=1" title="RAG为什么有引用也会答错?从检索到评估,讲清原理与工程取舍" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>萌力相变 · RAG为什么有引用也会答错?从检索到评估,讲清原理与工程取舍 · 8 分钟,讲「有引用不等于对」,对应今天的盲区实验。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1Uy411i7eQ&autoplay=0&high_quality=1" title="什么是大模型幻觉?为什么会产生幻觉?" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>AI老兵文哲 · 什么是大模型幻觉?为什么会产生幻觉? · 5 分钟,回看幻觉的成因,想一想为什么「提示词里写了不要编」消除不了它。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/Lar3K2gN454" title="Chain-of-Verification (COVE) Reduces Hallucination in Large Language Models - Paper Explained" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>DataMListic · Chain-of-Verification (COVE) Reduces Hallucination in Large Language Models - Paper Explained · 讲 CoVe 四个步骤,看它和我们「代码做核查、问题清单交回重写」的差别。</figcaption>
</figure>

### 书籍

- Chip Huyen《AI Engineering》(O'Reilly, 2025):第 4 章评估方法讲事实一致性和用模型做评判(AI as a judge),对应第三层语义检查。
- John Berryman、Albert Ziegler《Prompt Engineering for LLMs》(O'Reilly, 2024):讲怎么组织给模型的参考资料和让它按要求引用,对照我们把证据清单交给写手的做法。

### 开源项目与代码

- [shmsw25/FActScore](https://github.com/shmsw25/FActScore):FActScore 的实现,看它怎么拆原子事实、怎么判断支持与否。
- [princeton-nlp/ALCE](https://github.com/princeton-nlp/ALCE):带引用生成的评测代码,看引用精确度怎么用 NLI 模型判断。
- [explodinggradients/ragas](https://github.com/explodinggradients/ragas):RAG 评测库里的 faithfulness 指标,是今天第三层的通用工具。

## 自测

1. 为什么把问题清单原样交回模型,比只说「请重写」有效?

<details><summary>答案</summary>

只说重写,模型不知道哪里错了,常常换个措辞重复同样的错。具体到「哪个数、哪句话、为什么不行」的反馈,模型通常一次就能改对,重写次数少,既省钱又少走兜底。实测加压的 16 个场景里,5 个第一稿有问题的有 4 个在两三稿内改对了。

</details>

2. 兜底模板为什么不能包含模型写的 reasoning?

<details><summary>答案</summary>

兜底只在三稿都没通过校验时才用,它唯一的价值是里面的内容都可信。reasoning 没经过校验,里面的数字可能正是让三稿失败的那些。拼进去等于绕过了校验器。模板只能放结论里的多收金额(已经确认有出处)、证据编号和「请人工复核」。

</details>

3. S023 三稿都没过,根因是什么?怎么修?

<details><summary>答案</summary>

模型想写「两笔各 139.05,合计 278.10」,按理是两条证据相加得到的推导数,但 `grounding.py` 把证据的值放进了集合,相同的值被合并成一个,`combinations` 配不出 139.05 + 139.05。修法是用列表保留重复,按证据配对,并补一条两条证据数值相同的测试。

</details>

4. 「这张发票多收了 1412.42 美元 [E1]」,E1 是应收。通用校验器放行吗?怎么拦下?

<details><summary>答案</summary>

放行,因为 1412.42 在证据里、编号也存在,最多记一条「引用的值不对」的警告。拦下它的是 `key_fact_problems`:结论要冲正时,客户版里必须出现结论里的多收金额 26.02,没出现就是问题。实验里 10 份这样改过的草稿通用校验器全放行、专门检查全拦下,原样草稿没有误伤。

</details>

5. 列出三件今天校验器仍然管不到的事,各说一个处理办法。

<details><summary>答案</summary>

原因讲错了(数字全对、归因错):靠评测集里的 LLM judge 和人工抽检。「说不用这个数」却把数写出来:校验器是字面的,只能靠提示词引导和重写后再看。引用的编号对不对只记警告:靠评测统计出现频率,频率高了再升级成问题。另外,中文日期写法、模糊的时间承诺(「尽快」)也属于没有覆盖的。

</details>

6. 面试题:你的生成系统用「校验失败就带着问题清单重写,最多三次,否则用模板」。上线前领导问你:怎么知道这套机制有没有用、会不会拖慢或烧钱?你怎么回答?

<details><summary>答案</summary>

不凭感觉,用评测集量。记录每个请求的稿数、兜底与否和每一稿的问题类型,统计一稿过比例、平均稿数、兜底比例,以及重写后通过的比例(重写有用的证据);故意加压(去掉提示词的一条规则、调高温度)检查补救机制真的起作用,而不是一次都没被用到。成本是稿数乘以单次写作费用,稿数有上限(这里最多 3 次),所以最坏情况可估:正常一次约 ¥0.01,最坏三次约 ¥0.03。同时要抽检校验器放行的那部分,估计它管不到的语义错误的比例;兜底比例升高或某类问题突然变多,说明提示词或数据出了问题,要告警。

</details>

## 明天预告

明天是 Day 690 · BillSleuth(十):贷记单、退款、作废重开,谁来起草,状态机。今天的图结论、解释都有了,下一步是「动钱」:结论要冲正时,Agent 起草一张贷记单,但签发要人批。明天先把贷记单、退款、作废重开三种冲正方式的区别讲清楚,决定谁来起草,再把贷记单的生命周期画成一个状态机。今天写好的 `reply["fallback"]` 会在那里用上:兜底出来的解释,不该自动进入起草。
