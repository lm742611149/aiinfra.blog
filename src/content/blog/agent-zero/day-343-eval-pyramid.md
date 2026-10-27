---
title: 'Day 343 · 评测金字塔:三层,越往上越贵'
description: '评测不只有一种打分法。今天给一个会起草回复的小 Agent 依次用代码断言、LLM 评委、人工阅读打分,量出每一层的耗时和花费,并亲眼看到:断言全绿、评委全绿,人工读出来仍有两条回复有问题。'
pubDate: 2026-10-27
regime: none
tags: ['eval', 'python', 'agent-zero']
series: 'agent-zero'
day: 343
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 342](/blog/agent-zero/day-342-week49-review/) 把工具层的三道检查写成了 12 条评测用例,不调模型,免费、毫秒级,用 `compare` 和 `gate` 抓住了三个「写坏了」的版本。[Day 341](/blog/agent-zero/day-341-why-evals/) 的分类评测也是同一个套路:一个相等判断,对就是对,错就是错。

这两处能这样判,是因为答案是「一个词」或者「放行还是拒绝」。可是工单分流 Agent 最后交出去的是一段话:回复里的金额对不对、引用的那篇文章是不是真的支撑了那句话、语气像不像人。这些写不成 `==`。今天回答的就是:判断不了的时候怎么办,以及每多一层判断要多花多少。

## 今天要解决的问题

学完今天,你要能做到:

1. 说出评测金字塔三层(代码断言、LLM 评委、人工)各自适合查什么,以及你亲手量出来的耗时和花费。
2. 给一段客服回复写五个代码断言,并说清它们看不出什么。
3. 写一个 LLM 评委,并且用人工标注去量它:抓到几个、漏报几个、误报几个。
4. 读懂一个反直觉的结果:「和人工一致 26/28」的评委,一个坏回复都没抓到。

预计用时 3 小时。前置:[Day 341](/blog/agent-zero/day-341-why-evals/) 的 `part06/classify.py`(用它的 V3 提示词分类)、`cases.py`、`cases.jsonl`、`extra_cases.jsonl`,[Day 222](/blog/agent-zero/day-222-kb-data/) 的帮助中心 20 篇文章(今天放在 `agent-zero-lab/data/kb/kb-001.md` 到 `kb-020.md`),`common/llm.py`。今天真调模型:生成 28 条回复约 0.04 元,评委三个版本各跑一遍分别约 0.03、0.10、0.06 元,我实跑加起来约 0.33 元(提示词里整份帮助中心约 2500 个 token,未命中价 2 元每百万,命中价 0.04 元每百万,所以第二次以后便宜很多)。

学法提示:先对照文章逐行敲一遍(不复制粘贴)并跑通;第二天合上文章,把 `l1_checks` 的五个断言默写出来;做练习时先自己写,做不出再展开参考答案,看完关掉自己重写一遍。

## 先有一个被测的东西

要评测「一段回复」,先得有会写回复的东西。今天用一个比 Day 339 的图简单得多的版本:读一张工单,用 Day 341 的分类提示词(V3)分类,然后把整份帮助中心(20 篇文章,加起来不到 9000 字节)塞进系统提示词,让模型起草回复。没有工具,没有审批,没有检索:这里的重点是给回复打分,不是让回复写得多好。

```python
# agent-zero-lab/part06/draft_reply.py
"""被测对象:读工单,按帮助中心起草一段回复。简化版(没有工具、没有审批),只为给评测金字塔三层各一份可打分的东西。
运行:uv run python -m part06.draft_reply  (28 条各一次,约 0.05 元,结果存 part06/runs/replies.jsonl)"""
import json
from pathlib import Path

from common.llm import LLMClient
from part06.cases import load_cases
from part06.classify import classify

HERE = Path(__file__).parent
KB_DIR = HERE.parent / "data" / "kb"


def load_kb() -> dict[str, str]:
    """文章编号 → 全文。20 篇加起来不到 9000 字节,直接整份放进提示词。"""
    return {p.stem: p.read_text(encoding="utf-8") for p in sorted(KB_DIR.glob("kb-*.md"))}


KB = load_kb()
SYSTEM = (
    "你是云簿 CloudLedger 的客服专员,根据下面的帮助中心起草对客户的回复。\n"
    "规则:1) 只依据帮助中心回答,不要编造帮助中心里没有的金额、期限、流程;"
    "2) 回答里用 [kb-编号] 的形式引用依据的文章,例如 [kb-002];"
    "3) 帮助中心里没有答案时,说明会转人工客服跟进,不要猜;"
    "4) 不超过 150 字,语气礼貌。\n\n帮助中心:\n" + "\n\n".join(KB.values())
)


def draft(client: LLMClient, body: str, category: str) -> str:
    r = client.chat(
        [{"role": "system", "content": SYSTEM},
         {"role": "user", "content": f"工单类别:{category}\n工单内容:{body}"}],
        temperature=0, max_tokens=400,
    )
    return r.content.strip()


if __name__ == "__main__":
    client = LLMClient()
    out = []
    for case in load_cases("cases.jsonl", "extra_cases.jsonl"):
        category = classify(client, case["body"], "v3")
        out.append({"id": case["id"], "body": case["body"], "category": category,
                    "reply": draft(client, case["body"], category)})
    (HERE / "runs" / "replies.jsonl").write_text(
        "".join(json.dumps(r, ensure_ascii=False) + "\n" for r in out), encoding="utf-8")
    print(f"{len(out)} 条回复已生成。{client.ledger}")
```

<div class="line-notes">

- `KB_DIR = HERE.parent / "data" / "kb"` 帮助中心的 20 个 markdown 文件,Day 222 造的,放在 `agent-zero-lab/data/kb/` 下。
- `def load_kb() -> dict[str, str]:` 读成「文章编号 → 全文」的字典。
- `return {p.stem: p.read_text(encoding="utf-8") for p in sorted(KB_DIR.glob("kb-*.md"))}` 字典推导式。`glob("kb-*.md")` 找出所有匹配的文件,`p.stem` 是不带扩展名的文件名,比如 `kb-002`。
- `KB = load_kb()` 模块一加载就读一次,别的文件 `from part06.draft_reply import KB` 就能拿到。
- `SYSTEM = (` 系统提示词:四条规则加整份帮助中心。
- `"规则:1) 只依据帮助中心回答,不要编造帮助中心里没有的金额、期限、流程;"` 第一条是整个任务的核心,也是后面评测要查的东西。
- `"2) 回答里用 [kb-编号] 的形式引用依据的文章,例如 [kb-002];"` 要求引用,评测才有东西可以核对。
- `"3) 帮助中心里没有答案时,说明会转人工客服跟进,不要猜;"` 给模型一条「不知道时」的出路。
- `"4) 不超过 150 字,语气礼貌。\n\n帮助中心:\n" + "\n\n".join(KB.values())` 字数限制,然后把 20 篇文章接在后面。实测整个系统提示词约 2500 个输入 token。
- `def draft(client: LLMClient, body: str, category: str) -> str:` 输入工单正文和类别,输出一段回复。
- `temperature=0, max_tokens=400,` 温度 0 让同一张工单尽量得到同一段回复,`max_tokens` 防止跑飞。
- `category = classify(client, case["body"], "v3")` 主程序里先分类。用 V3 是因为 Day 341 里它在 28 条上全对。
- `(HERE / "runs" / "replies.jsonl").write_text(` 28 条回复存成 JSONL,后面三层打分都读它,不用重新生成。

</div>

```bash
cd ~/agent-zero-lab
uv run python -m part06.draft_reply
```

```text
28 条回复已生成。56 次调用 | 输入 73252 / 输出 2107 tokens | 约 ¥0.0424
```

56 次调用是 28 次分类加 28 次起草。看两条回复长什么样(其余 26 条都在 `part06/runs/replies.jsonl` 里):

```text
T1003 [billing] 请帮我取消订阅,不要再自动续费了。
您好,取消订阅可在「设置 → 订阅」中操作,取消后当期结束时停止服务、不再续费,当期费用不退 [kb-002]。若您是年付套餐中途取消,可按剩余整月数比例退款 [kb-002],需在「设置 → 订阅 → 申请退款」提交,客服主管 1 个工作日内审批 [kb-003]。如已开发票,需先红冲才能退款 [kb-003]。

T1012 [account] 收到的验证码一直提示过期,已经试了五六次了,急!
您好,非常抱歉给您带来不便。关于验证码过期的问题,帮助中心暂未收录相关处理办法,我会为您转接人工客服进一步跟进,请您稍等。[kb-016]
```

这两条读起来都挺专业,有引用、有礼貌、也说了转人工。先记住它们,后面会回来。

## 金字塔长什么样

<figure>
<svg viewBox="0 0 640 300" role="img" aria-label="评测金字塔:底层代码断言又快又便宜但只能查能写成 if 的东西,中层 LLM 评委能读语义但要被校准,顶层人工最准最贵">
  <rect x="0" y="0" width="640" height="300" fill="var(--paper-raised)"/>
  <g font-family="var(--font-mono)" font-size="12">
    <polygon points="200,28 260,28 300,98 160,98" fill="var(--compute-wash)" stroke="var(--compute)"/>
    <text x="230" y="60" fill="var(--ink)" text-anchor="middle">L3 人工</text>
    <text x="230" y="80" fill="var(--ink-soft)" text-anchor="middle" font-size="11">慢 · 贵 · 当标准</text>
    <polygon points="160,104 300,104 340,174 120,174" fill="var(--mem-wash)" stroke="var(--mem)"/>
    <text x="230" y="136" fill="var(--ink)" text-anchor="middle">L2 LLM 评委</text>
    <text x="230" y="156" fill="var(--ink-soft)" text-anchor="middle" font-size="11">几分钱 · 要被校准</text>
    <polygon points="120,180 340,180 380,250 80,250" fill="none" stroke="var(--ink-soft)"/>
    <text x="230" y="212" fill="var(--ink)" text-anchor="middle">L1 代码断言</text>
    <text x="230" y="232" fill="var(--ink-soft)" text-anchor="middle" font-size="11">免费 · 毫秒 · 确定</text>
    <text x="400" y="64" fill="var(--ink-soft)">抽样读、给评委当标准答案</text>
    <text x="400" y="132" fill="var(--ink-soft)">引用是否支撑那句话、</text>
    <text x="400" y="148" fill="var(--ink-soft)">事实有没有依据</text>
    <text x="400" y="206" fill="var(--ink-soft)">长度、格式、引用编号存在、</text>
    <text x="400" y="222" fill="var(--ink-soft)">有没有承诺词</text>
    <text x="44" y="278" fill="var(--ink-faint)" font-size="11">条数多 → 每次改动都跑</text>
    <text x="44" y="20" fill="var(--ink-faint)" font-size="11">条数少 → 定期抽查</text>
  </g>
</svg>
<figcaption>越往上越能读懂意思,也越贵、越慢、越不稳。能用下一层解决的问题别拿上一层去做;上一层存在的理由,是下一层判断不了的东西,以及反过来校准下一层。</figcaption>
</figure>

Hamel Husain 那篇 [Your AI Product Needs Evals](https://hamel.dev/blog/posts/evals/) 里也是分三个层级(单元测试、模型和人工评估、线上 A/B 测试),说法和这里不完全一样,但「便宜的多跑、贵的少跑」是同一个意思。下面三节各用同一批 28 条回复走一遍。

## L1:代码断言

能写成 `if` 的,一律写成 `if`。今天给回复写五个:

```python
# agent-zero-lab/part06/graders.py(L1 部分)
import re

from common.llm import ChatResult, LLMClient
from part06.draft_reply import KB

PROMISES = ["保证", "一定会", "马上", "立即退款", "已为您退款", "已退款"]


def l1_checks(reply: str, expected_category: str) -> list[str]:
    """返回没通过的检查名,空列表表示全过。"""
    failed = []
    cited = re.findall(r"\[(kb-\d{3})\]", reply)
    if len(reply) > 220:
        failed.append("too_long")
    if any(c not in KB for c in cited):
        failed.append("cite_not_exist")
    if not cited and "转人工" not in reply and "转交人工" not in reply and "转接人工" not in reply:
        failed.append("no_cite_no_handoff")
    if any(p in reply for p in PROMISES):
        failed.append("promise_word")
    if expected_category == "refund" and not any(w in reply for w in ["审批", "人工", "核实"]):
        failed.append("refund_no_approval")
    return failed
```

<div class="line-notes">

- `from common.llm import ChatResult, LLMClient` 后面评委要用,先导入。`ChatResult` 只用来标返回类型。
- `from part06.draft_reply import KB` 帮助中心字典。判断「引用的文章存在不存在」要用它。
- `PROMISES = ["保证", "一定会", "马上", "立即退款", "已为您退款", "已退款"]` 帮助中心里没有任何承诺,回复里就不该出现这些词。这是个「黑名单」,凭经验写的,会漏掉没想到的说法。
- `def l1_checks(reply: str, expected_category: str) -> list[str]:` 输入一段回复和这张工单该有的类别,输出没通过的检查名。返回空列表就是全过,这样一个函数能同时回答「过没过」和「哪条没过」。
- `failed = []` 收集没通过的检查名。
- `cited = re.findall(r"\[(kb-\d{3})\]", reply)` 正则:找出所有形如 `[kb-002]` 的引用,只取括号里的编号。`\d{3}` 是三位数字。T1003 得到 `['kb-002', 'kb-002', 'kb-003', 'kb-003']`。
- `if len(reply) > 220:` 第一个断言:不能太长。系统提示词要求 150 字,放宽到 220,给标点和引用留余地。
- `if any(c not in KB for c in cited):` 第二个:引用的编号必须是真的。模型可能编出 `[kb-099]`。`any(...)` 只要有一个不在就为真。
- `if not cited and "转人工" not in reply and "转交人工" not in reply and "转接人工" not in reply:` 第三个:没引用任何文章时,必须说明转人工。否则这段回复既没依据又没出路。三种说法都要列,因为模型三种都用过。
- `if any(p in reply for p in PROMISES):` 第四个:承诺词黑名单。
- `if expected_category == "refund" and not any(w in reply for w in ["审批", "人工", "核实"]):` 第五个:退款类的回复不能直接说「好了」,必须提到审批、人工或核实。用的是出题人的期望类别,不是模型分类的结果。
- `return failed` 返回没通过的名单。

</div>

先看它「会响」的样子。下面三条是我手写的有问题的回复,不是模型输出:

```python
# agent-zero-lab/part06/l1_demo.py
"""手写三条「有问题的回复」,看 L1 的五个断言各自会不会响。这三条是我编的,不是模型输出。"""
from part06.graders import l1_checks

samples = [
    ("refund", "保证 1 小时内退款到账,详见 [kb-099]。"),
    ("refund", "好的,我已经为您办好了。"),
    ("billing", "您好," + "很抱歉给您带来不便," * 30 + "[kb-004]"),
]
for category, reply in samples:
    print(f"{category:<8} {l1_checks(reply, category)}  <- {reply[:24]}…")
```

```text
refund   ['cite_not_exist', 'promise_word', 'refund_no_approval']  <- 保证 1 小时内退款到账,详见 [kb-099]…
refund   ['no_cite_no_handoff', 'refund_no_approval']  <- 好的,我已经为您办好了。…
billing  ['too_long']  <- 您好,很抱歉给您带来不便,很抱歉给您带来不便,很…
```

第一条同时撞上三个断言,第二条是「没依据又没出路」,第三条太长。五个断言各自都能被触发。现在让它去检查真正的 28 条回复:

```bash
uv run python -m part06.pyramid_run v1
```

```text
L1 28 条用了 0.5 毫秒,花费 ¥0
L2 28 条用了 26 秒,28 次调用 | 输入 70773 / 输出 1199 tokens | 约 ¥0.0244
id    L1      L2    人工    评委的理由(只显示 FAIL)
T1001 pass    PASS  ok    
T1002 pass    PASS  ok    
T1003 pass    PASS  bad   
T1004 pass    PASS  ok    
……
```

(这个脚本下面三节都会用,今天先只看第一行和 L1 那一列。完整的 28 行比较长,后面会摘最关键的几行。)L1 对 28 条全部放行,用时 0.5 毫秒,花费 0。

全过是好消息吗?不一定。T1003 和 T1012 也被放行了。T1003 的引用编号都真实存在(kb-002、kb-003),有「审批」字样,没有承诺词,长度 158 字。T1012 引了 kb-016,编号存在,也说了转人工。五个断言都挑不出毛病,可是 L1 没有任何办法知道:「引用 kb-016 来支撑一句『帮助中心没有收录』」是不是合理,或者「设置 → 订阅」这个入口帮助中心里到底有没有。这些要读懂意思才知道。

## L3:人工,先于评委

金字塔最上面一层是人,但在实践里它是第一个要做的,因为只有人工标注才能回答「评委到底准不准」。顺序是:先人读,再让评委读,最后比。

我(出题人)把 28 条回复逐条读了一遍,标准只有一个:回复里有没有帮助中心不支持的事实,或者没支撑任何内容的引用。标成 `ok` 或 `bad`,`bad` 要写一句理由。标注是在看评委结果之前做的,避免被它带着走。结果放在 `part06/human_labels.jsonl`,每行一条:

```text
{"id": "T1001", "label": "ok", "note": ""}
{"id": "T1003", "label": "bad", "note": "「设置 → 订阅」里取消订阅的入口,帮助中心里没有这句"}
{"id": "T1012", "label": "bad", "note": "引了 kb-016,但那篇讲两步验证和换手机号,和「验证码过期」无关,引用没有支撑任何一句话"}
……(共 28 行,26 个 ok,2 个 bad)
```

28 条里 2 条有问题。每一条我是这样判断的:先看回复里的数字、路径、条件,再回到对应的帮助中心文章找原文。T1003 那个「设置 → 订阅」我用 `grep` 在 20 篇文章里搜了「取消」和「设置 → 订阅」,只找到「设置 → 订阅 → 申请退款」,没有取消订阅的入口,所以是模型编的。

读 28 条花了多久,我没有计时,这里不报数字。一个粗略的估算是每条 30 到 60 秒,28 条在 15 到 30 分钟之间(这是估算,不是实测),而且这只是一个人读一遍,没有找第二个人交叉检查。重点是它不能每次改动都做:`bad` 出现得少,一次人工通常只能抽查。

## L2:让另一次模型调用当评委

L1 和 L3 之间有一块空白:要读懂意思,但是读 28 条、280 条、2800 条人受不了。L2 就是把「读」交给模型。做法是再起一次模型调用,给它帮助中心全文、工单、回复和一份判分标准,让它输出 `PASS` 或 `FAIL` 加一句理由。这个模型调用叫 LLM 评委(LLM-as-judge)。

```python
# agent-zero-lab/part06/graders.py(评委第一版)
JUDGE_SYSTEM = (
    "你是严格的客服质检员。下面是帮助中心全文,然后会给你一张工单和客服的回复。\n"
    "请检查:回复里每一个具体事实(金额、期限、次数、操作路径、条件)是否都能在帮助中心里找到依据;"
    "回复里引用的 [kb-编号] 是否真的支撑了它后面那句话。\n"
    "只输出一行:PASS 或 FAIL,冒号后用一句话说明理由,例如「FAIL:操作路径『设置→X』帮助中心没有」。\n\n帮助中心:\n"
    + "\n\n".join(KB.values())
)


def judge(client: LLMClient, ticket: str, reply: str) -> tuple[str, str, ChatResult]:
    r = client.chat(
        [{"role": "system", "content": JUDGE_SYSTEM},
         {"role": "user", "content": f"工单:{ticket}\n\n客服回复:{reply}"}],
        temperature=0, max_tokens=120,
    )
    text = r.content.strip()
    verdict = "PASS" if text.upper().startswith("PASS") else "FAIL"
    return verdict, text, r
```

<div class="line-notes">

- `JUDGE_SYSTEM = (` 评委的系统提示词。里面也放了整份帮助中心,这样它才能核对原文。
- `"你是严格的客服质检员。下面是帮助中心全文,然后会给你一张工单和客服的回复。\n"` 角色加输入说明。
- `"请检查:回复里每一个具体事实(金额、期限、次数、操作路径、条件)是否都能在帮助中心里找到依据;"` 检查对象列得具体:金额、期限、次数、路径、条件。只说「检查是否准确」评委会很宽松。
- `"回复里引用的 [kb-编号] 是否真的支撑了它后面那句话。\n"` 这一句是针对 T1012 这类问题的:引用存在不等于引用有用。
- `"只输出一行:PASS 或 FAIL,冒号后用一句话说明理由,例如「FAIL:操作路径『设置→X』帮助中心没有」。\n\n帮助中心:\n"` 格式约束加一个例子。一行输出好解析,也省钱。
- `def judge(client: LLMClient, ticket: str, reply: str) -> tuple[str, str, ChatResult]:` 返回三样:裁决、原话、模型调用结果(拿花费用)。
- `temperature=0, max_tokens=120,` 评委也用温度 0,不要它「有创意」。
- `text = r.content.strip()` 去掉首尾空白。
- `verdict = "PASS" if text.upper().startswith("PASS") else "FAIL"` 以 `PASS` 开头算通过,其余都算 `FAIL`。这个解析在练习里会出问题,后面会看到。

</div>

跑一遍:

```bash
uv run python -m part06.pyramid_run v1
uv run python -m part06.judge_stats v1
```

```text
L2 28 条用了 26 秒,28 次调用 | 输入 70773 / 输出 1199 tokens | 约 ¥0.0244
评委 v1:抓到 0,漏报 2,误报 0,和人工一致 26/28
```

`judge_stats.py` 把评委的结论和人工标注对一遍:

```python
# agent-zero-lab/part06/judge_stats.py
"""把评委的结论和人工标注比:抓到几个、漏报几个、误报几个。运行:uv run python -m part06.judge_stats v1 v2 v3"""
import json
import sys
from pathlib import Path

for version in sys.argv[1:]:
    rows = json.loads((Path(__file__).parent / "runs" / f"pyramid-{version}.json").read_text(encoding="utf-8")).values()
    caught = sum(1 for x in rows if x["l2"][0] == "FAIL" and x["human"] == "bad")
    missed = sum(1 for x in rows if x["l2"][0] == "PASS" and x["human"] == "bad")
    false_alarm = sum(1 for x in rows if x["l2"][0] == "FAIL" and x["human"] == "ok")
    agree = sum(1 for x in rows if (x["l2"][0] == "FAIL") == (x["human"] == "bad"))
    print(f"评委 {version}:抓到 {caught},漏报 {missed},误报 {false_alarm},和人工一致 {agree}/{len(rows)}")
```

<div class="line-notes">

- `for version in sys.argv[1:]:` 命令行可以传多个版本名,逐个统计。`sys.argv[1:]` 是第一个参数之后的全部。
- `rows = json.loads(` 读 `pyramid-<版本>.json`,它是「工单号 → {l1, l2, human}」的字典,只要值。
- `caught = sum(1 for x in rows if x["l2"][0] == "FAIL" and x["human"] == "bad")` 抓到:评委判 FAIL,人工也说 bad。`x["l2"]` 是 `[裁决, 原话]`,下标 0 取裁决。`sum(1 for ...)` 是数「满足条件的有几个」。
- `missed = sum(1 for x in rows if x["l2"][0] == "PASS" and x["human"] == "bad")` 漏报:坏的,评委放过了。
- `false_alarm = sum(1 for x in rows if x["l2"][0] == "FAIL" and x["human"] == "ok")` 误报:好的,评委说坏。
- `agree = sum(1 for x in rows if (x["l2"][0] == "FAIL") == (x["human"] == "bad"))` 一致:两边的结论相同。

</div>

26/28 听着不错,可是评委 v1 对两条坏回复一条都没抓到:T1003 和 T1012 它都判了 `PASS`。一致率高,只是因为 26 条好的它也都说好。坏的占 28 条里的 2 条时,闭着眼睛说「全部通过」也有 26/28 的一致率。这个数字没有告诉你评委的价值,**评委要看它抓到了几个坏的**。

第二版:不让它凭印象打分,逼它一步一步来,先拆句子、再逐个找原文、找不到就写「无依据」,最后一行才给裁决。

```python
# agent-zero-lab/part06/graders.py(评委第二、三版)
JUDGE_SYSTEM_V2 = (
    "你是严格的客服质检员。下面是帮助中心全文,然后会给你一张工单和客服的回复。\n"
    "请按步骤做:\n"
    "1. 把回复拆成若干句,挑出每一句里的具体事实(金额、期限、次数、操作路径、条件)和它后面的 [kb-编号] 引用。\n"
    "2. 对每个事实,到它引用的那篇文章里找原文:找得到就摘一小段原文,找不到写「无依据」。没有引用的事实,到全文里找。\n"
    "3. 引用的文章如果和那句话讲的不是一回事,也写「无依据」。\n"
    "最后一行只写 PASS(全部有依据)或 FAIL:加一句话说明哪一条无依据。\n\n帮助中心:\n"
    + "\n\n".join(KB.values())
)


JUDGE_SYSTEM_V3 = JUDGE_SYSTEM_V2.replace(
    "最后一行只写",
    "注意:「转人工客服跟进」「帮助中心没有收录」这类流程性表态,以及礼貌用语和不涉及具体数字、路径的一般性建议,不算需要核对的事实,直接跳过。\n"
    "最后一行只写",
)


def judge_v2(client: LLMClient, ticket: str, reply: str, system: str = JUDGE_SYSTEM_V2) -> tuple[str, str, ChatResult]:
    r = client.chat(
        [{"role": "system", "content": system},
         {"role": "user", "content": f"工单:{ticket}\n\n客服回复:{reply}"}],
        temperature=0, max_tokens=700,
    )
    last = r.content.strip().splitlines()[-1].strip()
    found = re.search(r"PASS|FAIL", last.upper())  # 模型有时会写成「最后一行:PASS」,不能只看开头
    verdict = found.group(0) if found else "FAIL"
    return verdict, last, r
```

<div class="line-notes">

- `JUDGE_SYSTEM_V2 = (` 第二版提示词,多了三步操作说明。
- `"1. 把回复拆成若干句,挑出每一句里的具体事实(金额、期限、次数、操作路径、条件)和它后面的 [kb-编号] 引用。\n"` 第一步:拆句,把事实和引用配成对。
- `"2. 对每个事实,到它引用的那篇文章里找原文:找得到就摘一小段原文,找不到写「无依据」。没有引用的事实,到全文里找。\n"` 第二步:逐个找原文,必须摘出来。要求摘原文,是让它没法含糊过关。
- `"3. 引用的文章如果和那句话讲的不是一回事,也写「无依据」。\n"` 第三步:专门对付「引用存在但不相关」。
- `"最后一行只写 PASS(全部有依据)或 FAIL:加一句话说明哪一条无依据。\n\n帮助中心:\n"` 推理过程写在前面,最后一行才是裁决。推理占了输出的大头,所以输出 token 会多很多。
- `JUDGE_SYSTEM_V3 = JUDGE_SYSTEM_V2.replace(` 第三版是在第二版上改一句话,`replace` 把「最后一行只写」前面插进一段新说明。这是练习 2 的内容,先放在这里。
- `"注意:「转人工客服跟进」「帮助中心没有收录」这类流程性表态,以及礼貌用语和不涉及具体数字、路径的一般性建议,不算需要核对的事实,直接跳过。\n"` 第三版的新规则,为了减少误报,后面会看到它为什么需要。
- `def judge_v2(client: LLMClient, ticket: str, reply: str, system: str = JUDGE_SYSTEM_V2)` 第二、三版共用一个函数,提示词作为参数传进来,默认是第二版。
- `temperature=0, max_tokens=700,` 输出变长了,上限从 120 提到 700。
- `last = r.content.strip().splitlines()[-1].strip()` 只取最后一行当结论。`splitlines()` 按行切,`[-1]` 是最后一个。
- `found = re.search(r"PASS|FAIL", last.upper())` 在最后一行里找第一个 PASS 或 FAIL。不能只看开头,下面「报错」那一节解释为什么。
- `verdict = found.group(0) if found else "FAIL"` 找不到当 FAIL,宁可多报一个,不能把解析失败当成通过。

</div>

```bash
uv run python -m part06.pyramid_run v2
```

```text
L2 28 条用了 67 秒,28 次调用 | 输入 72117 / 输出 10008 tokens | 约 ¥0.0991
id    L1      L2    人工    评委的理由(只显示 FAIL)
T1003 pass    FAIL  bad   FAIL: 第1句「取消订阅可在『设置 → 订阅』中操作」所引 kb-002 未涉及取消路径,全文也无此路径,属无依据。
T1012 pass    FAIL  bad   FAIL: 「帮助中心暂未收录验证码过期处理办法」和「转接人工客服」引用的 kb-016 均无相关内容,属无依据。
T1015 pass    FAIL  ok    FAIL: 「转交人工客服跟进、请保持手机畅通」在帮助中心全文中无依据。
X04   pass    FAIL  ok    FAIL: 「帮助中心暂未收录此类账务差异的处理流程」无依据,kb-002 已规定重复扣款核实后全额退还、kb-003 ……
X07   pass    FAIL  ok    FAIL:句3「建议核对当前套餐与扣款记录」和句4「转人工客服跟进」在帮助中心全文均无对应原文依据。
X10   pass    FAIL  ok    FAIL:回复中「刷新页面或更换浏览器」「保留控制台报错截图」等操作建议在帮助中心全文无依据。
X12   pass    FAIL  ok    FAIL: 「我会为您转接人工客服核实处理」在帮助中心全文中无任何依据(无转接人工客服的流程说明)。
```

(输出里省略了 21 条 `pass / PASS / ok` 的行。)

v2 抓到了 T1003 和 T1012,而且评委的理由读起来和我标注时想的几乎一样。代价有两个:耗时 67 秒、花费 0.0991 元,是 v1 的三到四倍,因为它要把推理写出来;另外多了 5 条误报,它把「我会转人工客服跟进」「刷新页面或更换浏览器」也当成需要在帮助中心找依据的事实。

```bash
uv run python -m part06.judge_stats v1 v2 v3
```

```text
评委 v1:抓到 0,漏报 2,误报 0,和人工一致 26/28
评委 v2:抓到 2,漏报 0,误报 5,和人工一致 23/28
评委 v3:抓到 1,漏报 1,误报 0,和人工一致 27/28
```

三个版本放在一起很有意思。**一致率最高的是 v3(27/28),最低的是 v2(23/28),但抓到的坏回复是 v2 最多(2 个)**。v3 是我在 v2 基础上加了一句「转人工、没有收录这类表态不算事实」,误报没了,同时漏掉了 T1012。每个版本都有代价:v1 不误报但抓不到,v2 抓得到但吵,v3 安静但还是漏一条。没有哪个版本能直接拿去当「标准」。这就是为什么说评委本身也要被评测:拿一批人工标注去量它,而且要分开看抓到和误报,不能只看一个一致率。

## 三层放在一起

| 层 | 28 条的耗时 | 28 条的花费 | 这次抓到了什么 | 看不见什么 |
| --- | --- | --- | --- | --- |
| L1 五个代码断言 | 0.5 毫秒 | 0 | 手写的三条有问题的回复(每个断言都能响);真实 28 条里一条都没有响 | 引用是否支撑那句话;路径是否有依据 |
| L2 评委 v1 | 26 秒 | 约 0.03 元 | 0 个 | 两条坏回复全漏 |
| L2 评委 v2 | 67 秒 | 约 0.10 元 | 2 个,误报 5 个 | 吵,要人再筛一遍 |
| L2 评委 v3 | 41 秒 | 约 0.06 元 | 1 个,误报 0 个 | 漏了 T1012 |
| L3 人工 | 没计时,估算 15 到 30 分钟 | 不折算 | 2 个(定义为标准) | 读得累会漏;一个人有偏见 |

这个表最该留意的是「每多一层,多出来的是什么」。从 L1 到 L3 没有一步是多余的:L1 免费,每次改动都能跑,守住格式和明显的事故;L2 能读语义,但要用 L3 去校准,不然你不知道它是不是在乱判;L3 贵,所以只在两个地方用:建立标准答案,以及定期抽查评委有没有跑偏。

经验上的分配是这样:L1 的断言多、天天跑,放进每次提交的流程;L2 一两个评分器,每次改了提示词或者模型就跑一遍;L3 每周花一两个小时,抽几十条读。别反过来,天天人工看几百条而不写一个断言,那叫体力活不叫评测。

## 抽查到底能抓到多少

L3 贵,所以只能抽。28 条里有 2 个坏的,抽 8 条人工读,能看到至少一个坏回复的概率是多少?这个数不用猜,可以算:

```python
from math import comb

print(1 - comb(26, 8) / comb(28, 8))
```

```text
0.4973544973544973
```

`comb(26, 8)` 是从 26 条好回复里抽 8 条的方法数,`comb(28, 8)` 是从全部 28 条里抽 8 条的方法数,两者相除就是「抽到的 8 条全是好的」的概率,一减就是「至少抽到一个坏的」。结果约 50%。坏回复占 7% 的时候,抽 8 条,一半的机会什么问题都看不到,然后你会得出「没问题」的结论。这是人工抽查的天然局限,也是为什么要让 L1 和 L2 去覆盖全量。

## 出现过的两个错

**评委的输出格式不稳定。** 评委 v2 第一次跑时,我解析最后一行只检查是否以 `PASS` 开头。第三版里有一条 T1014 的最后一行是:

```text
最后一行:PASS
```

模型把「最后一行只写 PASS」当成了要照抄的格式。我的解析判它 `FAIL`,可它其实通过了。人工标注是 `ok`,这条就变成了一次假的误报。改成在最后一行里用 `re.search(r"PASS|FAIL", ...)` 找关键字之后,这条消失了。教训:评委的输出是文字,解析它的代码也要评测;而且解析失败时的默认值要选「宁可多报」(`FAIL`),不要选「默认通过」。

**用「一致率」选评委。** 上面已经看到了:v1 的一致率 26/28,抓到的坏回复是 0。

## 动手练习

1. **再加一个断言:回复里的数字必须能在帮助中心里找到。** 写 `part06/ex343_numbers.py`,对 28 条回复检查,看它有没有抓到 T1003 或 T1012。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part06/ex343_numbers.py
"""练习 1:回复里出现的每个数字,都必须在帮助中心全文里出现过。免费。"""
import json
import re
from pathlib import Path

from part06.draft_reply import KB

KB_TEXT = "\n".join(KB.values())
replies = [json.loads(line) for line in (Path(__file__).parent / "runs" / "replies.jsonl").read_text(encoding="utf-8").splitlines()]
for r in replies:
    text = re.sub(r"\[kb-\d{3}\]", "", r["reply"])  # 引用编号里的数字不算
    missing = [n for n in re.findall(r"\d+", text) if n not in KB_TEXT]
    if missing:
        print(r["id"], "帮助中心里没有的数字:", missing)
print("检查完毕")
```

<div class="line-notes">

- `KB_TEXT = "\n".join(KB.values())` 把 20 篇文章接成一大段,只用来查「某个数字在不在里面」。
- `text = re.sub(r"\[kb-\d{3}\]", "", r["reply"])` 先把引用编号 `[kb-002]` 删掉,免得里面的 `002` 被当成数字。
- `missing = [n for n in re.findall(r"\d+", text) if n not in KB_TEXT]` `\d+` 找出所有连续数字;`n not in KB_TEXT` 是字符串包含判断,不在帮助中心里的留下。
- `if missing:` 有就打印工单号和这些数字。

</div>

```bash
uv run python -m part06.ex343_numbers
```

```text
检查完毕
```

一条都没有报。模型没有编造数字:回复里的 199、1908、10 万、7 天这些都在帮助中心里。T1003 的问题是编了一条「操作路径」,T1012 的问题是引用不相关,这两种都不是数字,这个断言看不见。而且这个断言本身比较松:单个数字(比如 `1`)几乎在任何文章里都会出现,所以它抓不到「把 3 个工作日写成 5 个工作日」这类单位数的错。要查数字,更稳的办法是只检查多位数,或者把数字和它后面的单位一起匹配。

</details>

2. **调评委 v2 的误报。** 把评委 v2 的提示词改一句,让它不再把「转人工」「没有收录」这类表态当成需要核对的事实,看误报是不是消失,同时有没有还能抓到那两条。

<details><summary>参考答案</summary>

这就是上面的 `JUDGE_SYSTEM_V3`(在 v2 基础上加一句「流程性表态、礼貌用语、不涉及数字和路径的一般性建议,不算事实,直接跳过」)。

```bash
uv run python -m part06.pyramid_run v3 | grep -v "pass    PASS  ok"
uv run python -m part06.judge_stats v2 v3
```

```text
L1 28 条用了 0.5 毫秒,花费 ¥0
L2 28 条用了 41 秒,28 次调用 | 输入 73181 / 输出 5948 tokens | 约 ¥0.0605
id    L1      L2    人工    评委的理由(只显示 FAIL)
T1003 pass    FAIL  bad   FAIL: 句1 的取消订阅操作路径「设置 → 订阅」在 kb-002 中无依据(该文只讲退款政策,未涉及取消订阅入口)
T1012 pass    PASS  bad   
评委 v2:抓到 2,漏报 0,误报 5,和人工一致 23/28
评委 v3:抓到 1,漏报 1,误报 0,和人工一致 27/28
```

误报从 5 个降到 0,代价是 T1012 漏了:新加的那句话让评委把「引用了 kb-016 来支撑一句没有收录的话」也当成了「流程性表态」跳过。这是调评委时最典型的拉锯:放宽标准,误报少了,漏报多了;收紧标准反过来。这里没有一个正确答案,取决于你更怕哪一种:漏掉一个坏回复,还是让人多看五条好回复。第一次调的时候,通常先要求「宁可多报」,让人去筛。

</details>

3. **评委的稳定性。** 评委 v1 用温度 0,同一份回复再判一遍,结论会变吗?用 T1003 判 5 次试试。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part06/ex343_stable.py
import json
from pathlib import Path

from common.llm import LLMClient
from part06.graders import judge

replies = {r["id"]: r for r in map(json.loads, (Path(__file__).parent / "runs" / "replies.jsonl").read_text(encoding="utf-8").splitlines())}
client = LLMClient()
r = replies["T1003"]
print([judge(client, r["body"], r["reply"])[0] for _ in range(5)])
```

<div class="line-notes">

- `replies = {r["id"]: r for r in map(json.loads,` `map(json.loads, 行列表)` 把每一行解析成字典,再按工单号建字典。相当于 JS 里 `Object.fromEntries(lines.map(...))`。
- `r = replies["T1003"]` 拿那条被人工标成 `bad` 的回复。
- `print([judge(client, r["body"], r["reply"])[0] for _ in range(5)])` 同一份回复判 5 次,只看第一个返回值(裁决)。

</div>

```bash
uv run python -m part06.ex343_stable
```

```text
['PASS', 'PASS', 'PASS', 'PASS', 'PASS']
```

5 次结论完全一样,而且全是 `PASS`:这条坏回复它稳定地放过了。稳定不等于正确,v1 的问题是稳定地错。判断评委稳不稳的做法是每条多判几次,看有没有结论不一致的用例;判断它对不对,要靠人工标注。这个脚本只在 T1003 一条上跑了 5 次,别的回复稳不稳没有量。

</details>

4. **开放题:给下面这些检查各选一层。** (a) 回复里的退款金额是否等于代码算出的参考值 (b) 语气是否像真人客服 (c) 回复有没有把另一个客户的邮箱写出来 (d) 一段回复对客户的帮助有多大 (e) 回复的 JSON 能不能解析。

<details><summary>参考答案</summary>

(a) L1:金额是个数,算好参考值直接比,这是金额类问题最该写成断言的原因,也是 Day 340 那个年付退款的补救办法。(b) L2,而且要先拿 L3 的标注去校准:语气没有客观标准。(c) L1:用邮箱的正则加「是不是别的客户的」比对,代码就能做。(d) L3 为主:「有多大帮助」是主观判断,可以让评委给个粗分,但标准要由人给。(e) L1:`json.loads` 不报错就行。一个规律:能找出客观标准的,放到更低的层;只有主观判断才往上放。

</details>

5. **算一算:抽多少条才有 90% 的机会看到至少一个坏回复?** 还是 28 条里 2 个坏的,不放回地抽。

<details><summary>参考答案</summary>

```python
from math import comb

for n in range(1, 29):
    p = 1 - comb(26, n) / comb(28, n)
    if p >= 0.9:
        print(n, round(p, 3))
        break
```

<div class="line-notes">

- `for n in range(1, 29):` 从抽 1 条试到抽 28 条。
- `p = 1 - comb(26, n) / comb(28, n)` 抽 n 条,至少有一个坏的概率。
- `if p >= 0.9:` 第一次达到 90% 就打印并停下。`break` 跳出循环,相当于 JS 的 `break`。

</div>

```text
19 0.905
```

要抽 19 条(28 条的三分之二以上)才能有 90% 的把握。也就是说,坏回复本来就稀少时,抽样人工只能算「感觉一下」,别指望靠它抓全。

</details>

验收标准:`part06/runs/` 下有 `replies.jsonl`、`pyramid-v1.json`、`pyramid-v2.json`、`pyramid-v3.json`;你能用自己的话解释为什么评委 v1 的一致率最高(26/28)却一无是处;你有一张自己的「三层各查什么」表。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 评测金字塔 | 把评测分成三层:代码断言、LLM 评委、人工。越往上越懂语义,也越贵、越慢,所以条数越少 |
| 代码断言 | 用 `if` 判断就能得出结论的检查,比如长度、引用编号存不存在、有没有承诺词。免费、毫秒级、确定 |
| LLM 评委(LLM-as-judge) | 再起一次模型调用,按标准给另一次调用的输出打分。便宜灵活,但自己也会错 |
| 校准(calibration) | 拿人工标注去量评委:抓到几个、漏报几个、误报几个。没校准过的评委不能当标准 |
| 漏报 | 坏的,评委放过了。今天评委 v1 漏了 2 个 |
| 误报 | 好的,评委说坏。今天评委 v2 误报了 5 个 |
| 一致率 | 评委和人工结论相同的比例。坏样本稀少时它会虚高,不能单独看 |
| 标注 | 人工读一条输出,给一个标签(ok 或 bad)加一句理由 |
| 黑名单 | 一组「出现就算错」的词,比如承诺词。凭经验写,会漏没想到的说法 |
| 正则表达式 | 描述文字模式的小语言。`\[(kb-\d{3})\]` 的意思是「方括号里 kb- 加三位数字」,前端的正则语法基本一样 |

## 常见误区

**以为断言全绿就是对的。** 五个断言全过,人工仍读出两条有问题的回复。断言只守得住它写成了规则的东西,守不住它没想到的。

**用一致率挑评委。** 坏的占 7% 时,「全部通过」的评委也能拿到 93% 的一致率。看抓到和误报两个数,分开看。

**不校准就用评委当标准。** 评委 v1 对两条坏回复一条没抓。不拿人工标注去量它,你永远不知道这一点。

**评委越严越好。** v2 抓到了全部坏的,同时多了 5 条误报,耗时和花费是 v1 的三四倍。严格是有代价的,而且误报多了,人会学会忽略它。

**解析评委输出时默认通过。** 解析失败应该算 `FAIL`:宁可多一次人工复核,不能让评委没说话就当它通过了。

**把人工抽查当成全覆盖。** 28 条里 2 个坏的,抽 8 条只有约 50% 的机会看到问题。

**先搭评测平台再写用例。** 今天的全部评测是五个 Python 文件加几个 JSONL,足够跑起来。平台等你有了五十条用例、跑过几轮之后再说。

## 学习资料

### 文档与文章

- [Hamel Husain · Your AI Product Needs Evals](https://hamel.dev/blog/posts/evals/):讲评测分层的经典文章,配了一个真实的房产助手案例。和今天的金字塔对着看,30 分钟。
- [Eugene Yan · An LLM-as-Judge Won't Save The Product—Fixing Your Process Will](https://eugeneyan.com/writing/eval-process/):评委不是银弹,流程才是,和今天「评委要被校准」是同一个意思,15 分钟。
- [Hamel Husain & Shreya Shankar · AI Evals FAQ](https://hamel.dev/blog/posts/evals-faq/):很长的问答,今天只读讲 LLM 评委和人工标注的那几个问题,30 分钟。
- [Anthropic · Demystifying evals for AI agents](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents):里面把打分逻辑叫 grader,分代码、模型、人三种,和今天的三层是同一个划分,40 分钟。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1887X65EoB&autoplay=0&high_quality=1" title="从零搭建Agent自动化评估体系,9分钟给你讲明白!" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>AI大模型元元 · 从零搭建Agent自动化评估体系,9分钟给你讲明白! · 9 分钟。看完对照今天的三层,哪个对应 L1、哪个对应 L2,视频里没讲校准的话,你自己补上。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1HTAHebEuj&autoplay=0&high_quality=1" title="吴恩达《评估 AI 代理|Evaluating AI Agents》中英字幕" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>GPT中英字幕课程资源 · 吴恩达《评估 AI 代理|Evaluating AI Agents》中英字幕(deepseek-R1翻译) · 共 14 P。今天看讲「代码评估和 LLM 评委」的几 P,以你看到的目录为准,听他怎么给评委写提示词。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/uiza7wp1KrE" title="AI Evaluations Clearly Explained in 50 Minutes (Real Example) | Hamel Husain" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Peter Yang · AI Evaluations Clearly Explained in 50 Minutes (Real Example) | Hamel Husain · 英文,52 分钟。Hamel 用一个真实产品演示怎么从读数据开始建评测,留意他怎么处理 LLM 评委。</figcaption>
</figure>

### 书籍

- Chip Huyen《AI Engineering: Building Applications with Foundation Models》(O'Reilly,2025):第 3、4 章讲评测方法,包括「用 AI 当评委」的优缺点,英文原版。
- Shreya Shankar、Hamel Husain《Evals for AI Engineers》(O'Reilly,页面标注 2026 年 10 月出版):我只确认了 O'Reilly 有这本书的页面,没读过正文。

### 开源项目与代码

- [promptfoo/promptfoo](https://github.com/promptfoo/promptfoo):配置文件里能同时写断言和模型评分,和今天的 L1、L2 对照看。
- [confident-ai/deepeval](https://github.com/confident-ai/deepeval):pytest 风格,内置了各种评委指标,看它们的提示词怎么写。

## 自测

1. 金字塔三层各适合查什么?一句话。

<details><summary>答案</summary>

L1 代码断言查能写成 `if` 的客观条件(格式、长度、编号存在、有没有承诺词);L2 LLM 评委查需要读懂意思但可以写成标准的东西(事实有没有依据、引用是否支撑);L3 人工查主观的、没有现成标准的东西,并且给 L2 当校准的标准答案。

</details>

2. 今天 L1 五个断言对 28 条真实回复全部放行,是不是说明回复都没问题?

<details><summary>答案</summary>

不是。人工读出 2 条有问题的(T1003 编了取消入口,T1012 的引用不相关),断言只会检查引用编号存在、长度这类写成规则的东西。断言全绿只说明没有踩到已知的雷。

</details>

3. 评委 v1 和人工一致 26/28,为什么说它没用?

<details><summary>答案</summary>

28 条里只有 2 条坏的,一个评委对所有回复都说通过,就有 26/28。评委对两条坏回复一条都没抓到。评委要看抓到几个、误报几个,不能只看一致率。

</details>

4. 评委 v2 比 v3 抓得多,为什么还说 v3 的一致率更高?

<details><summary>答案</summary>

v2 抓到 2 条坏的,同时把 5 条好的也判成了坏(误报),一致率 23/28。v3 误报 0,但漏了 T1012,一致率 27/28。一致率同时惩罚误报和漏报,而且 28 条里好的占大多数,所以少误报就更容易拿高一致率。选评委要拿你更怕的那一种错来衡量。

</details>

5. (面试题)「你怎么评估一个用 LLM 当评委的评分器本身可不可靠?」

<details><summary>答案</summary>

拿一批人工标注的样本去量它。人先标好,标的时候不看评委的结论;再让评委跑同一批;然后分开看抓到几个坏的、漏报几个、误报几个,不只看一致率,因为坏样本稀少时一致率会虚高。还要看稳定性,同一份输入多判几次结论变不变;以及输出格式,解析失败的默认值要选「多报」。我自己的例子:同一批 28 条回复,三个版本的评委抓到 0、2、1 个坏回复,误报 0、5、0 个,一致率 26、23、27 条,选哪个取决于我更怕漏报还是误报。

</details>

6. 为什么人工标注要先于评委做,而且标的时候不看评委的结论?

<details><summary>答案</summary>

人工标注是评委的「标准答案」。如果先看了评委的结论再标,会被它带着走,尤其是评委说 PASS 的时候你会倾向于也觉得没问题,标准就不独立了,量出来的准确率会偏高。

</details>

## 明天预告

明天是 [Day 344 · 几组概念一次分清,评测驱动开发](/blog/agent-zero/day-344-eval-concepts/)。今天的三层讲的是「怎么打分」,没有讲「什么时候跑」:上线前跑还是上线后跑?跑来找新问题还是看旧问题回来没有?明天把离线评测、在线评测、能力评测、回归评测几组概念一次分清,再讲怎么把「先写评测、再改代码」变成习惯。
