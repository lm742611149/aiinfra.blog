---
title: 'Day 371 · 自动优化提示词(三):ACE 和怎么上生产'
description: '整段重写的优化器会把规则写宽,也会把「重复扣款」这种细节写丢。ACE 的做法是基础说明不动,手册里一条条加规则,每条记帮了几次、害了几次,整理交给普通代码。今天写一个最小版,实跑两个起点;再写一道「手册 PR 门禁」,实测它拦下了一条写太宽的规则和一次丢规则的改动。'
pubDate: 2026-10-27
regime: none
tags: ['prompt-optimization', 'ace', 'eval', 'agent-zero']
series: 'agent-zero'
day: 371
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 369](/blog/agent-zero/day-369-prompt-opt-2/) 写了 60 行的反思循环,又用 DSPy 跑了 GEPA。两条结论要带到今天:一是优化器会把规则写宽,「钱优先」把 t33 带错了;二是 GEPA 那次整段重写,把 refund 定义里最关键的「重复扣款」四个字改丢了,验证集涨了 5 个点,测试集一条没多对。[Day 370](/blog/agent-zero/day-370-week53-review/) 复习了这一周,没有新东西。

两个毛病有同一个根:每一轮都让大模型把整段 prompt 重新写一遍。今天看 ACE 怎么绕开这件事,然后回答一个很实际的问题:优化器给出的东西,你敢不敢上线?

## 今天要解决的问题

学完今天你应该能:

1. 说清 ACE 是什么、它指出的「简短偏好」和「上下文坍塌」各是什么,以及它和 GEPA 的区别在哪。
2. 写出 `ace_lite.py`:基础说明不动,手册里的每条规则有编号、有「帮/害」计数,新增、去重、淘汰都由普通代码完成。
3. 写出 `playbook_gate.py`:对一份新手册打印 diff,检查关键词没丢,在测试集加关键用例上和旧手册比分,不过就拦下。
4. 看懂一张对比表,知道「验证集涨了」在 20 条数据上能说明多少。

今天两个新概念:**ACE 的手册(playbook)**,和**把优化结果当成 PR 来审**。

预计用时 2.5 小时。实跑花费:ACE 两个起点各一次共约 0.084 元,手册门禁三个候选约 0.082 元,练习 3 约 0.028 元,加上调试时多跑的几遍,合计约 0.30 元,算式在各段末尾。前置:[Day 368](/blog/agent-zero/day-368-prompt-opt-1/) 的 `opt_tickets.jsonl` 和 `opt_task.py`(数据、BASE/BARE 两个起点、`evaluate`);[Day 369](/blog/agent-zero/day-369-prompt-opt-2/) 的反思循环(今天的 `REFLECT` 是它的小号版);[Day 136](/blog/agent-zero/day-136-llm-client-2/) 的 `LLMClient`;[Day 71](/blog/agent-zero/day-071-pytest-1/) 起学的 pytest。

学法:先对照文章逐行敲一遍(不复制粘贴)并跑通;明天合上文章,把 `curate()` 和 `prune()` 默写出来;做练习时先自己写,做不出再展开参考答案,看完关掉重写一遍。

## 第一步:ACE 说了什么

ACE 全称 Agentic Context Engineering,论文是 Stanford、SambaNova 等机构的一批人写的,arXiv 编号 2510.04618,2025 年 10 月放出第一版,2026 年 3 月 29 日是现在的 v3,已被 ICLR 2026 接收(2026 年 10 月查到)。它和 GEPA 要解决的是同一类问题:模型权重不动,靠改写喂给模型的上下文变好。区别在怎么改。

论文开头点了前人方法的两个病,我们在 Day 369 已经亲眼见过。

**简短偏好(brevity bias)**:优化器总倾向于把规则写得短而抽象。论文点名说 GEPA 把简洁当成优点,但抽象会丢掉领域里的具体经验。Day 369 里 refund 行写成「退款请求或退款流程」,「重复扣款」没了,就是这个病。

**上下文坍塌(context collapse)**:每次都让大模型整段重写,上下文会越写越短、越写越空。论文给了一组数:某个对比方法在第 60 步时上下文有 18,282 个 token,准确率 66.7;下一步一次重写把它压成了 122 个 token,准确率掉到 57.1,比完全没做适配的 63.7 还差(论文 Figure 2 的说明,我没复现,这是二手数字)。我们的手册只有几百字,碰不到这么夸张的坍塌,但「改一次丢一点」是同一回事。

ACE 的解法是把上下文当成一本不断增长的**手册(playbook)**:一条条带编号的规则,每次只增删改条目,不重写整本。它拆成三个角色:

- **Generator(生成者)**:拿着当前手册去做任务,产出过程和结果。对我们就是分类器。
- **Reflector(反思者)**:看生成者的结果,总结哪里对了、哪里错了,并给用到的条目记「帮了」或「害了」。
- **Curator(整理者)**:把反思者的结论变成一小条一小条的增量(delta),用**不调大模型的普通代码**合并进手册:去重、淘汰、更新计数。

<figure>
<svg viewBox="0 0 640 230" role="img" aria-label="ACE 循环:Generator 用手册做任务,Reflector 总结得失,Curator 用普通代码把增量合并回手册,手册再交给 Generator">
<rect x="0" y="0" width="640" height="230" fill="var(--paper-raised)"/>
<g font-family="var(--font-mono)" font-size="12">
<rect x="20" y="30" width="130" height="56" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="34" y="54" fill="var(--ink)">Generator</text>
<text x="34" y="72" fill="var(--ink-faint)" font-size="11">带手册做分类</text>
<rect x="255" y="30" width="130" height="56" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="269" y="54" fill="var(--ink)">Reflector</text>
<text x="269" y="72" fill="var(--ink-faint)" font-size="11">错例 → 一条规则</text>
<rect x="490" y="30" width="130" height="56" rx="6" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="504" y="54" fill="var(--ink)">Curator</text>
<text x="504" y="72" fill="var(--ink-faint)" font-size="11">普通代码,不调模型</text>
<rect x="200" y="150" width="240" height="56" rx="6" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="214" y="174" fill="var(--ink)">手册 playbook</text>
<text x="214" y="192" fill="var(--ink-faint)" font-size="11">[1] 帮3/害0  [2] 帮1/害0 ...</text>
<line x1="150" y1="58" x2="253" y2="58" stroke="var(--ink-soft)"/>
<line x1="385" y1="58" x2="488" y2="58" stroke="var(--ink-soft)"/>
<line x1="555" y1="88" x2="440" y2="165" stroke="var(--ink-soft)"/>
<line x1="200" y1="170" x2="85" y2="90" stroke="var(--ink-soft)"/>
<text x="165" y="50" fill="var(--ink-faint)" font-size="11">答案</text>
<text x="395" y="50" fill="var(--ink-faint)" font-size="11">增量</text>
<text x="490" y="140" fill="var(--ink-faint)" font-size="11">只加/改一条</text>
<text x="60" y="140" fill="var(--ink-faint)" font-size="11">整本交回去</text>
</g>
</svg>
<figcaption>和 GEPA 最大的不同在右下那条线:手册不是被谁重写的,是被一小段确定的代码一条一条改的。</figcaption>
</figure>

论文里还有一个机制叫 grow-and-refine:新条目用新编号追加,已有的条目原地更新(比如把计数加一),再周期性地用 embedding 比较语义去重。官方的实现在 GitHub 的 `ace-agent/ace`,Apache-2.0 协议,2026 年 10 月查到约 1.4k 星,最近一次提交是 2026 年 8 月 24 日(并行化多个提案再合并),README 里「给工具调用扩展 ACE」的教程仍标着「Coming Soon」,算是还在早期。它的手册条目长这样:`[str-00001] helpful=5 harmful=0 :: 具体规则……`,和我们今天要写的形状一样。

论文自报的结果是在智能体基准上比强基线高 10.6%,金融任务上高 8.6%(论文摘要,没有复现)。我们的任务是 60 条工单,和论文里的任务不是一个量级,所以今天不拿它复现论文的数字,只拿它的**结构**:增量、计数、确定性整理。官方仓库我没有跑,今天的代码是自己写的最小版。

## 第二步:手册的数据结构

先写不调模型的那部分:一条规则长什么样,怎么拼进 prompt。

```python
# agent-zero-lab/part06/ace_lite.py
"""Day 371:ACE 的最小版。基础说明不动,手册里一条条加规则;每条规则记帮了几次、害了几次;整理由代码做。
用法: uv run python -m part06.ace_lite [bare]   结果存到 part06/playbook_<起点>.json"""
from __future__ import annotations

import difflib
import json
import sys
from dataclasses import asdict, dataclass
from pathlib import Path

from common.llm import LLMClient
from part06.opt_task import BARE_PROMPT, BASE_PROMPT, LABELS, evaluate, load

REFLECT = """客服工单分类器分错了一条。请总结出一条能避免这类错误的规则:
- 一句话,不超过 50 字
- 必须保留能触发这条规则的关键词(比如「重复扣款」「验证码」),不要只写抽象原则
- 只覆盖这一类情况,不要写成「涉及钱一律……」这种大范围规则
只输出 JSON:{{"rule": "..."}}

工单:{ticket}
模型答:{pred}
正确:{label}
标注理由:{why}"""

CITE_RULE = '只输出 JSON:{"category": "<类别>", "used": [<你用到的补充规则编号,没用到就空列表>]}'


@dataclass
class Bullet:
    id: int
    text: str
    helpful: int = 0
    harmful: int = 0


def render(base: str, book: list[Bullet]) -> str:
    if not book:
        return base
    return base + "\n\n补充规则(来自历史错例):\n" + "\n".join(f"[{b.id}] {b.text}" for b in book)


```

<div class="line-notes">

- `from dataclasses import asdict, dataclass` `dataclass` 是 Python 里「只装字段的类」,相当于 TS 的 `interface` 加上自动生成的构造函数。`asdict` 把它转回字典,存 JSON 时用。
- `REFLECT = """客服工单分类器分错了一条。` 反思 prompt,每次只看一条错例,只要一条规则。粒度小,改动就小。
- `- 必须保留能触发这条规则的关键词(比如「重复扣款」「验证码」),不要只写抽象原则` 专门对付简短偏好:告诉反思模型别只写抽象原则。
- `- 只覆盖这一类情况,不要写成「涉及钱一律……」这种大范围规则` 专门对付写太宽:把 Day 368 手调时踩过的那个坑直接写进提示词。这两条到底有没有用,练习 3 会量。
- `只输出 JSON:{{"rule": "..."}}` 双花括号是因为后面要用 `str.format` 填空,单个花括号会被当成占位符,Day 369 的反思 prompt 也是这样。
- `CITE_RULE = '只输出 JSON:{"category": "<类别>", "used": [<你用到的补充规则编号,没用到就空列表>]}'` 训练时让分类器顺便报告「我用到了哪几条补充规则」,这是帮/害计数的来源。验证和测试时不用它,用的还是 `opt_task.py` 里的原版输出格式,所以分数和前两天能直接比。
- `class Bullet:` 手册里的一条:编号、文字、帮了几次、害了几次。`helpful: int = 0` 的 `= 0` 是默认值,新规则刚加进来时两个计数都是 0。
- `if not book:` 手册为空时原样返回基础说明,第一条错例出现之前分类器看到的就是起点本身。
- `return base + "\n\n补充规则(来自历史错例):\n" + "\n".join(f"[{b.id}] {b.text}" for b in book)` 基础说明永远排在前面、永远不动,手册接在后面。`[3]` 这样的编号让日志里能指着某一条说「是它害的」。实测 5 条规则时,拼出来的 prompt 比 BARE 多出约 200 个汉字。

</div>

这里的设计选择值得说一句。GEPA 的做法是「拿到一整段 prompt,返回一整段新 prompt」,所以什么都可能被改。ACE 把 prompt 拆成两块:基础说明由人写、机器不碰;手册由机器维护、人可以逐条审。**能被机器改的范围缩小了,出错时的损失就小了。**

## 第三步:去重、淘汰、计数

整理者是下面这几十行普通代码。先看分类时怎么拿到「用了哪几条」,再看怎么整理。

```python
# agent-zero-lab/part06/ace_lite.py(第 43 行起,接着上一段)
def classify_cited(client: LLMClient, prompt: str, ticket: str) -> tuple[str, list[int]]:
    r = client.chat(
        [{"role": "system", "content": f"{prompt}\n\n{CITE_RULE}"}, {"role": "user", "content": ticket}],
        temperature=0, response_format={"type": "json_object"},
    )
    try:
        data = json.loads(r.content)
    except json.JSONDecodeError:
        return "<bad-json>", []
    cat = data.get("category", "")
    used = [i for i in data.get("used", []) if isinstance(i, int)]
    return (cat if cat in LABELS else f"<{cat}>"), used


def too_similar(rule: str, book: list[Bullet]) -> bool:
    return any(difflib.SequenceMatcher(None, rule, b.text).ratio() > 0.6 for b in book)


def curate(book: list[Bullet], rule: str, limit: int = 12) -> str:
    """整理:去重、加新条目、超限淘汰。全是普通代码,不调模型。返回发生了什么。"""
    if too_similar(rule, book):
        return "重复,没加"
    book.append(Bullet(id=max((b.id for b in book), default=0) + 1, text=rule))
    if len(book) > limit:
        worst = min(book[:-1], key=lambda b: b.helpful - b.harmful)
        book.remove(worst)
        return f"超限,淘汰 [{worst.id}]"
    return "加入"


def prune(book: list[Bullet]) -> list[int]:
    """害的次数比帮的次数多 2 次以上的条目删掉。"""
    dead = [b.id for b in book if b.harmful - b.helpful >= 2]
    book[:] = [b for b in book if b.id not in dead]
    return dead


```

<div class="line-notes">

- `def classify_cited(client: LLMClient, prompt: str, ticket: str) -> tuple[str, list[int]]:` 和 `opt_task.classify` 几乎一样,多返回一个「用了哪些规则编号」的列表。`tuple[str, list[int]]` 是返回类型标注,相当于 TS 的 `[string, number[]]`。
- `[{"role": "system", "content": f"{prompt}\n\n{CITE_RULE}"}, {"role": "user", "content": ticket}],` 输出格式换成带 `used` 的那个。
- `used = [i for i in data.get("used", []) if isinstance(i, int)]` 模型有时会把编号写成字符串 `"1"`,或者写成 `[1]` 外面再套一层。只收整数,别的一律丢掉,宁可少计也不要让一个 `KeyError` 打断整个训练。
- `return (cat if cat in LABELS else f"<{cat}>"), used` 类别不在六类里就加尖括号标出来,和 Day 368 的写法一致。
- `def too_similar(rule: str, book: list[Bullet]) -> bool:` 去重用标准库 `difflib` 的字符串相似度,比例超过 0.6 就算重复。0.6 是我定的,没有道理可讲。论文里是用 embedding 比语义,[Day 373](/blog/agent-zero/day-373-feedback-2/) 做聚类时会真的用上 embedding;这里先不多装依赖。
- `if too_similar(rule, book):` 整理的第一步:太像就不加,返回一句「发生了什么」,训练日志里能看到。
- `book.append(Bullet(id=max((b.id for b in book), default=0) + 1, text=rule))` 新编号是现有最大编号加一,手册为空时 `default=0`,所以第一条编号是 1。编号只增不复用,被淘汰的编号不会重新分给别的规则,日志里的 `[3]` 永远指同一条。
- `if len(book) > limit:` 手册上限 12 条。手册会一直变长,不设上限的话,每次分类都带着越来越长的 prompt。
- `worst = min(book[:-1], key=lambda b: b.helpful - b.harmful)` 淘汰净分(帮减害)最低的那条。`book[:-1]` 把刚加进去的那条排除在外,否则新规则一进来计数全是 0,会第一个被淘汰。`min(..., key=...)` 相当于 JS 里 `reduce` 找最小值。
- `dead = [b.id for b in book if b.harmful - b.helpful >= 2]` 害的次数比帮的次数多 2 次或以上,直接删。这个「2」是留一点容错:害一次可能是模型自己抖了一下(Day 368 看过,t14 同一个 prompt 会换答案)。

</div>

这些全是确定的:同样的输入,永远得到同样的整理结果,可以写单元测试。练习 1 就是让你给 `curate` 和 `prune` 写测试。**整理者不是大模型**,这是 ACE 最值钱的一点,因为「删什么、留什么」这件事一旦交给大模型,简短偏好和坍塌就又回来了。

## 第四步:训练循环

最后把三个角色接起来。训练集按顺序过一遍,相当于「上线以后一条条遇到工单」,答对就跳过,答错就让反思者出一条规则,整理者决定收不收。

```python
# agent-zero-lab/part06/ace_lite.py(第 80 行起,接着上一段)
def train(client: LLMClient, base: str, epochs: int = 2) -> list[Bullet]:
    book: list[Bullet] = []
    for ep in range(epochs):
        for row in load("train"):
            pred, used = classify_cited(client, render(base, book), row["ticket"])
            ok = pred == row["label"]
            for b in book:
                if b.id in used:
                    b.helpful += ok
                    b.harmful += not ok
            if ok:
                continue
            r = client.chat([{"role": "user", "content": REFLECT.format(pred=pred, **row)}],
                            response_format={"type": "json_object"})
            rule = str(json.loads(r.content).get("rule", "")).strip()
            if rule:
                print(f"ep{ep} {row['id']}:{row['label']}←{pred}  {curate(book, rule)}  {rule}")
        dead = prune(book)
        if dead:
            print(f"ep{ep} 淘汰:{dead}")
    return book


def save(book: list[Bullet], path: Path) -> None:
    path.write_text(json.dumps([asdict(b) for b in book], ensure_ascii=False, indent=2), encoding="utf-8")


def load_book(path: Path) -> list[Bullet]:
    return [Bullet(**d) for d in json.loads(path.read_text(encoding="utf-8"))]


if __name__ == "__main__":
    client = LLMClient()
    name = "bare" if "bare" in sys.argv[1:] else "base"
    base = BARE_PROMPT if name == "bare" else BASE_PROMPT
    book = train(client, base)
    for b in book:
        print(f"[{b.id}] 帮{b.helpful}/害{b.harmful}  {b.text}")
    save(book, Path(__file__).with_name(f"playbook_{name}.json"))
    for split in ["val", "test"]:
        acc, err = evaluate(client, render(base, book), load(split))
        print(f"{split}: {acc:.0%}", [f"{e['id']} {e['label']}→{e['pred']}" for e in err])
    print(client.ledger)
```

<div class="line-notes">

- `def train(client: LLMClient, base: str, epochs: int = 2) -> list[Bullet]:` 训练 2 轮:第二轮的目的是让第一轮攒下的规则有机会被「再引用」一次,计数才会涨。
- `for row in load("train"):` 只用训练集 20 条。验证集和测试集这里不碰。
- `pred, used = classify_cited(client, render(base, book), row["ticket"])` 带着当前手册答一次,同时拿到用了哪些规则。
- `for b in book:` 给被引用的规则记账。
- `b.helpful += ok` `ok` 是布尔值,Python 里 `True` 当 1 用,所以答对了就是 `+= 1`,答错了加 0。
- `b.harmful += not ok` 答错了,被引用的每一条都记一次「害」。这是最粗的归因:一条错例里引用了三条规则,三条都记害。论文里反思者会更细致地判断是哪条的责任,我们的最小版没做。
- `if ok:` 答对了就不反思,不花这笔钱。
- `r = client.chat([{"role": "user", "content": REFLECT.format(pred=pred, **row)}],` `**row` 把这条工单的 `ticket`、`label`、`why` 一次填进模板,多余的字段(`id`)`format` 会忽略。
- `rule = str(json.loads(r.content).get("rule", "")).strip()` 取出规则文字,去掉首尾空白。
- `print(f"ep{ep} {row['id']}:{row['label']}←{pred}  {curate(book, rule)}  {rule}")` 打印「第几轮 哪条工单 正确←模型答 整理结果 规则」。注意 `curate(...)` 是在这行里被调用的,打印的同时就已经改了手册。
- `dead = prune(book)` 每一轮结束整理一次:删掉害多于帮的条目。
- `def save(book: list[Bullet], path: Path) -> None:` 手册存成 JSON 文件,下一步的门禁要读它。手册是「数据」不是「代码」,所以能放进版本库、能做 diff。
- `return [Bullet(**d) for d in json.loads(path.read_text(encoding="utf-8"))]` `**d` 把字典展开成关键字参数,相当于 JS 的 `new Bullet({...d})`。
- `name = "bare" if "bare" in sys.argv[1:] else "base"` 和 `opt_task.py` 一样:命令行带 `bare` 用 BARE 起步。
- `for split in ["val", "test"]:` 训练结束,在验证集和测试集上各量一次,用的是 `opt_task.evaluate`,和 Day 368、369 的尺子是同一把。

</div>

在 `agent-zero-lab` 根目录先故意错跑一次,看一个常见报错:

```bash
uv run python part06/ace_lite.py
```

```text
Traceback (most recent call last):
  File "/Users/你/agent-zero-lab/part06/ace_lite.py", line 14, in <module>
    from common.llm import LLMClient
ModuleNotFoundError: No module named 'common'
```

直接 `python part06/ace_lite.py` 时,Python 只把脚本所在的目录 `part06/` 放进模块搜索路径,找不到上一级的 `common/`。要用 `-m` 当模块跑,让仓库根目录进搜索路径,和 Day 368 的写法一样:

```bash
uv run python -m part06.ace_lite bare
```

实测输出:

```text
ep0 t01:refund←billing  加入  出现「重复扣款」一词即归类为 refund，即使客户未明确要求退款。
ep0 t13:refund←account  加入  用户问注销账号时余额或钱怎么退回，出现「余额」「退」等词就判 refund，不判 account。
ep0 t22:billing←bug  加入  工单出现「PAY_TIMEOUT」「钱没扣」「订单没成功」等支付失败描述时，归 billing 而非 bug。
ep0 t31:account←bug  加入  登录失败、跳回登录页即使带错误码E1101也归account，不算bug。
ep0 t52:account←other  加入  涉及「设置」「只能看不能改」等权限配置的工单，应归为account而非other。
[1] 帮3/害0  出现「重复扣款」一词即归类为 refund，即使客户未明确要求退款。
[2] 帮1/害0  用户问注销账号时余额或钱怎么退回，出现「余额」「退」等词就判 refund，不判 account。
[3] 帮2/害0  工单出现「PAY_TIMEOUT」「钱没扣」「订单没成功」等支付失败描述时，归 billing 而非 bug。
[4] 帮1/害0  登录失败、跳回登录页即使带错误码E1101也归account，不算bug。
[5] 帮3/害0  涉及「设置」「只能看不能改」等权限配置的工单，应归为account而非other。
val: 90% ['t11 billing→invoice', 't35 billing→other']
test: 85% ['t12 bug→invoice', 't33 bug→billing', 't57 billing→other']
85 次调用 | 输入 18048 / 输出 865 tokens | 约 ¥0.0430
```

怎么读。第一轮 20 条训练工单里错了 5 条,每条出一条规则,没有重复、没有冲突;第二轮没有新错例,只是计数在涨(`[1]` 帮了 3 次)。五条规则都带着具体的触发词(「重复扣款」「PAY_TIMEOUT」),这正是 `REFLECT` 里要求的,Day 369 那次 GEPA 丢掉的细节,这里在手册第 1 条原样保住了。

测试集从 BARE 的 80% 到 85%,验证集 85% 到 90%。别高兴太早,看那三条错的:t12、t57 是 BARE 起点和 BASE 起点都错的老问题,新冒出来的是 **t33(「订阅页面下次扣款日期是 11 月 31 日」,该是 bug,被答成 billing)**。是谁害的?我的推测是规则 [3],它说「钱没扣」之类归 billing,t33 里有「扣款」两个字。注意上面的计数是只在训练集上记的,t33 在测试集,训练时没机会让 [3] 记上这笔「害」,所以 [3] 还是帮2/害0。**计数只反映训练集里见过的情况**,这是最小版的局限,真实系统里要让手册在上线后的流量上继续计数,这正是明天开始讲的反馈闭环。

再注意 [3] 抄了工单原文里的 `PAY_TIMEOUT`,[4] 抄了 `E1101`。它们在训练集上有用,换一个错误码就用不上了,这是一种变相的过拟合。人审手册时,看到这种条目要改成更通用的说法(「付款过程中失败、钱没扣」),或者留着但别指望它帮上别的情况。

从 BASE 起步再跑一次:

```bash
uv run python -m part06.ace_lite
```

```text
ep0 t13:refund←account  加入  注销账号时提到余额退回，如「余额怎么退」，应归refund而非account。
ep0 t22:billing←bug  加入  支付宝付款报错但「钱没扣」订单未成功，归 billing 不归 bug
ep0 t31:account←bug  加入  出现「跳回登录页」「登录失败」，即使带错误码 E1101，也归 account 而非 bug。
[1] 帮1/害0  注销账号时提到余额退回，如「余额怎么退」，应归refund而非account。
[2] 帮1/害0  支付宝付款报错但「钱没扣」订单未成功，归 billing 不归 bug
[3] 帮1/害0  出现「跳回登录页」「登录失败」，即使带错误码 E1101，也归 account 而非 bug。
val: 90% ['t11 billing→invoice', 't35 billing→other']
test: 90% ['t12 bug→invoice', 't57 billing→other']
83 次调用 | 输入 17330 / 输出 792 tokens | 约 ¥0.0410
```

BASE 本来就写得不错,训练集只错 3 条,学到 3 条规则。验证集 90%(起点 80% 到 85%),测试集 90%(起点 90%),没变。**起点写得好的时候,ACE 也没让测试集变好**,和 GEPA、自写反思循环的结论一致。

花费。BARE 起步:18048 个输入 token、865 个输出 token,全按未命中价算是 18048 × 2 / 100 万 + 865 × 8 / 100 万 ≈ 0.0361 + 0.0069 = 0.043 元,和账本一致。BASE 起步:17330 × 2 / 100 万 + 792 × 8 / 100 万 ≈ 0.0410 元。两次一共约 0.084 元,比 GEPA 的 0.22 到 0.25 元便宜很多,原因是 ACE 只在答错时才调一次反思模型,答对的就不管。

## 第五步:把手册改动当成一个 PR 来审

现在你有了一份 `playbook_bare.json`,5 条规则。真上线之前还差一步,**谁来保证下一次改手册不会把它改坏?** 不管改动是 ACE 自己加的,还是哪个同事好心补了一条,都该走同一道门。思路就是软件工程里的 PR:先看 diff,再过 CI。

门禁分三层,从便宜到贵:

1. **看 diff**:加了什么、删了什么、改了什么,打印出来给人看。纯文本比较,不花钱。
2. **查关键词**:一份「手册里必须还有这些词」的清单,没了就拦。不花钱。这是对付简短偏好的:Day 369 的 GEPA 丢了「重复扣款」,一条 `MUST_KEEP` 就能抓到。
3. **跑分**:在测试集加一组关键用例上,新旧手册各答一遍,比总分,再看有没有关键用例被带坏。要花钱,所以放最后。

```python
# agent-zero-lab/part06/playbook_gate.py
"""Day 371:把手册改动当成一个 PR 来审。先打印 diff,再查关键词没丢,最后在测试集加关键用例上比分。
用法: uv run python -m part06.playbook_gate part06/playbook_bare.json part06/candidate.json"""
from __future__ import annotations

import sys
from pathlib import Path
from typing import Any

from common.llm import LLMClient
from part06.ace_lite import Bullet, load_book, render
from part06.opt_task import BARE_PROMPT, classify, load

MUST_KEEP = ["重复扣款"]                      # 手册里必须还有的关键词
# 关键用例分两组:该是 refund 的(重复扣款、取消后又扣款),和「涉及钱但不是 refund」的(Day 368 手调时被「钱优先」带坏的那几条)
CRITICAL = ["t01", "t16", "t21", "t32", "t60", "t08", "t19", "t39", "t41", "t49"]


def diff(old: list[Bullet], new: list[Bullet]) -> list[str]:
    old_by, new_by = {b.id: b for b in old}, {b.id: b for b in new}
    lines = [f"- [{i}] {b.text}" for i, b in old_by.items() if i not in new_by]
    lines += [f"+ [{i}] {b.text}" for i, b in new_by.items() if i not in old_by]
    lines += [f"~ [{i}] {old_by[i].text}  →  {b.text}" for i, b in new_by.items() if i in old_by and old_by[i].text != b.text]
    return lines


def predict(client: LLMClient, book: list[Bullet], rows: list[dict[str, Any]]) -> dict[str, str]:
    prompt = render(BARE_PROMPT, book)
    return {r["id"]: classify(client, prompt, r["ticket"]) for r in rows}


def main(old_path: str, new_path: str) -> int:
    old, new = load_book(Path(old_path)), load_book(Path(new_path))
    print("== diff ==")
    print("\n".join(diff(old, new)) or "(没有改动)")
    problems: list[str] = []
    text = "\n".join(b.text for b in new)
    for kw in MUST_KEEP:
        if kw not in text:
            problems.append(f"手册里没有「{kw}」了")
    every = {r["id"]: r for s in ("train", "val", "test") for r in load(s)}
    rows = [every[i] for i in sorted({r["id"] for r in load("test")} | set(CRITICAL))]
    client = LLMClient()
    before, after = predict(client, old, rows), predict(client, new, rows)
    gold = {r["id"]: r["label"] for r in rows}
    broke = [f"{i} {gold[i]}→{after[i]}" for i in gold if before[i] == gold[i] and after[i] != gold[i]]
    fixed = [i for i in gold if before[i] != gold[i] and after[i] == gold[i]]
    def acc(p: dict[str, str]) -> float:
        return sum(p[i] == gold[i] for i in gold) / len(gold)

    print(f"== 比分({len(rows)} 条:测试集 + 关键用例)== 旧 {acc(before):.0%}  新 {acc(after):.0%}")
    print("新修好:", fixed, "  新带坏:", broke)
    problems += [f"关键用例带坏:{b}" for b in broke if b.split()[0] in CRITICAL]
    if acc(after) < acc(before):
        problems.append("总分下降")
    print("门禁:", "通过" if not problems else "不通过 " + ";".join(problems))
    print(client.ledger)
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1], sys.argv[2]))
```

<div class="line-notes">

- `MUST_KEEP = ["重复扣款"]` 手册里必须还有的关键词。这份清单是人维护的:你在人审时发现「这个词丢了不行」,就往里加一个。
- `# 关键用例分两组:该是 refund 的` 关键用例是你从历史事故里挑出来的「绝不能再错」的几条。分两组是因为 Day 368 手调时踩的坑有两面:既不能把重复扣款答成别的,也不能把「涉及钱但不是退款」的工单答成 refund。
- `CRITICAL = ["t01", "t16", "t21", "t32", "t60", "t08", "t19", "t39", "t41", "t49"]` 前 5 条是该 refund 的(t01 重复扣款、t16 取消后又扣、t21 同一张发票扣两笔、t32 试用期后被扣、t60 年费扣两次),后 5 条是涉及钱但不是 refund 的(t08 怎么关自动续费、t19 余额不足续费失败、t39 报表差 0.01、t41 微信付款状态没更新、t49 扣款短信对不上账单)。Day 368 的「钱优先」正是把这后 5 条带坏的。
- `old_by, new_by = {b.id: b for b in old}, {b.id: b for b in new}` 按编号建字典,方便按编号找到「同一条」。
- `lines = [f"- [{i}] {b.text}" for i, b in old_by.items() if i not in new_by]` 旧手册有、新手册没有的,前面画 `-`,和 `git diff` 一样。
- `lines += [f"~ [{i}]` 编号相同、文字变了,画 `~`。整段重写的优化器,这种行会很多;ACE 式的增量更新,这种行应该几乎没有。
- `prompt = render(BARE_PROMPT, book)` 门禁拿 BARE 当基础说明,和生产里用的一致。
- `return {r["id"]: classify(client, prompt, r["ticket"]) for r in rows}` 每条工单答一次,返回「编号 → 答案」。
- `if kw not in text:` 第二层:直接在手册文字里找关键词,找不到就记一个问题。
- `every = {r["id"]: r for s in ("train", "val", "test") for r in load(s)}` 把三份数据合到一个字典里,按编号取。关键用例散在三份里,所以要合起来。
- `rows = [every[i] for i in sorted({r["id"] for r in load("test")} | set(CRITICAL))]` 测试集的 20 条加上 10 个关键用例,重叠的只算一次,`|` 是集合的并。实测一共 27 条。
- `broke = [f"{i} {gold[i]}→{after[i]}" for i in gold if before[i] == gold[i] and after[i] != gold[i]]` 旧手册答对、新手册答错的,就是被这次改动带坏的。
- `problems += [f"关键用例带坏:{b}" for b in broke if b.split()[0] in CRITICAL]` 带坏的里面如果有关键用例,就是硬伤,直接记问题。其他用例带坏则只在总分里体现。
- `if acc(after) < acc(before):` 总分下降也拦。
- `return 1 if problems else 0` 退出码:通过是 0,不通过是 1。CI 看的就是这个数字,[Day 375](/blog/agent-zero/day-375-eval-project-2/) 会把它接进 GitHub Actions。

</div>

准备三个候选手册,分别模拟三种改动(`cand_good.json` 等放在 `part06/` 下,都是在 `playbook_bare.json` 的基础上改的):

- `cand_good.json`:补一条「教育优惠、学校之类的优惠咨询归 billing,不归 other」。这是想修 t57 的一条正常规则。
- `cand_wide.json`:补一条「凡是涉及钱的问题(扣款、金额、余额),一律归 refund」。这是 Day 368 手调时写过的那句话,反思模型一旦写宽,就会写出这样的东西。
- `cand_lost.json`:把第 1 条「重复扣款」删掉。模拟整段重写时丢细节。

这三个文件你用文本编辑器照上面的描述改 `playbook_bare.json` 就行(在末尾加一条编号 6 的规则,或者删掉第 1 条),文章后面的练习 4 也会用到。跑门禁:

```bash
uv run python -m part06.playbook_gate part06/playbook_bare.json part06/cand_good.json
uv run python -m part06.playbook_gate part06/playbook_bare.json part06/cand_wide.json
uv run python -m part06.playbook_gate part06/playbook_bare.json part06/cand_lost.json
```

实测输出(去掉了每次相同的账本行,只留门禁部分):

```text
== diff ==
+ [6] 出现「教育优惠」「学校」等优惠咨询,归 billing,不归 other。
== 比分(27 条:测试集 + 关键用例)== 旧 89%  新 93%
新修好: ['t57']   新带坏: []
门禁: 通过

== diff ==
+ [6] 凡是涉及钱的问题(扣款、金额、余额),一律归 refund。
== 比分(27 条:测试集 + 关键用例)== 旧 85%  新 81%
新修好: []   新带坏: ['t49 billing→refund']
门禁: 不通过 关键用例带坏:t49 billing→refund;总分下降

== diff ==
- [1] 出现「重复扣款」一词即归类为 refund，即使客户未明确要求退款。
== 比分(27 条:测试集 + 关键用例)== 旧 85%  新 81%
新修好: ['t39']   新带坏: ['t01 refund→billing', 't21 refund→invoice']
门禁: 不通过 手册里没有「重复扣款」了;关键用例带坏:t01 refund→billing;关键用例带坏:t21 refund→invoice;总分下降
```

三个结果和预期一致:好规则过了,修好了 t57,没带坏别的;写太宽的规则被 t49 拦住;丢掉第 1 条被三道检查一起拦住,关键词检查和关键用例都报了警。每次门禁约 0.026 到 0.028 元(54 次调用,输入约 12000 token,12618 × 2 / 100 万 + 353 × 8 / 100 万 ≈ 0.028 元)。

**但是请看「旧」那一列:89%、85%、85%。** 同一份旧手册、同一批 27 条工单,三次跑出来的总分不一样。原因在 t39(「报表合计和明细差 0.01」,该是 bug):它在旧手册下有时答对、有时答错,temperature 是 0 也一样。Day 368 看到的 t14 是同一种现象。这不是门禁写错了,是**模型本身的随机性**。它带来两个后果。

第一,在 27 条上,一条工单就是 3.7 个百分点,「总分下降」这个检查很容易被噪声触发。cand_lost 那一行里 t39 显示「新修好」,其实是旧手册那次碰巧答错了。所以门禁里**真正可靠的是「关键用例没被带坏」和「关键词没丢」**,总分只当辅助。

第二,我最初写的版本里,关键用例只有前 5 条(该 refund 的),没有后 5 条。那一版跑 cand_wide,有一次通过了:旧 83%、新 83%,因为那一次 t39 在两边都答错,被「钱优先」带坏的那条恰好没人看。后来我把 Day 368 里被「钱优先」带坏的几条补进关键用例,门禁才稳定地拦住它。这就是明天要讲的飞轮在小范围里的样子:**一次事故,变成一条关键用例,下一次同样的错就过不了门禁。**

## 第六步:数字放在一张表里,以及真要上生产怎么用

把前两天和今天的结果放在一起(都是单次运行;前几行来自 Day 368、369 的实测):

| 做法 | 起点 | 验证集 | 测试集 | 花费(约) |
| --- | --- | --- | --- | --- |
| 手拼 prompt 不优化 | BASE | 80–85% | 90% | 0.018 元/次 |
| 自写反思循环 | BASE | 85% → 95% | 90% | 0.065 元 |
| GEPA(300 次评分) | BASE | 95%(选回起点) | 95% | 0.22 元 |
| ACE 最小版 | BASE | 90% | 90% | 0.041 元 |
| 手拼 prompt 不优化 | BARE | 85% | 80% | 0.012 元/次 |
| 自写反思循环 | BARE | 85% → 85% | 90% | 0.080 元 |
| GEPA(300 次评分) | BARE | 90% → 95% | 75%(读回再量 80%) | 0.25 元 |
| ACE 最小版 | BARE | 85% → 90% | 85% | 0.043 元 |

(ACE 起点那个验证集分数用的是 Day 368 同一份 BARE 起点,验证集 85%。)

能下的结论很少。测试集 20 条,一条工单 5 个百分点,所以表里 85%、90%、95% 之间的差距都在噪声里。我敢说的三件事:

第一,**起点写得好的时候,没有一种方法让测试集变好**,ACE 也一样。第二,**起点很粗的时候,从错例和标注理由里学规则是真的有效**:BARE 的测试集 80%,自写循环 90%,ACE 85%,GEPA 75% 到 80%。第三,**ACE 最大的好处不是分数,是它的产物能审**。GEPA 给你一段重写过的指令,你得整段看;ACE 给你一份 5 行的清单,每行带计数,diff 只有几行。出事了可以直接指着某一条说「删掉它」,不用回头去怪整个优化器。

所以真要上生产,我会这么用,把优化器当成「提 PR 的同事」,而不是自动发布:

- **优化跑在离线环境。** 输入是你的测试集(训练和验证用 dev 部分),输出是一个候选手册文件,不直接改线上。
- **候选手册走 `playbook_gate`。** 先看 diff,有 `~` 行(整条被改写)的格外仔细;关键词清单和关键用例是人维护的,每出一次事故往里加一条。
- **人逐条审。** 看到抄了工单原文的条目(今天的 `PAY_TIMEOUT`、`E1101`)改成通用说法;看到写得太宽的收窄。
- **合并以后它就是一个版本。** 手册 JSON 进版本库,有版本号,能回滚。线上日志里记下「这次回复用的是手册哪个版本」,[Day 372](/blog/agent-zero/day-372-feedback-1/) 的反馈表里就有这个字段。
- **反思模型尽量比执行模型强。** 它的任务是总结规律,能力不够就会把规则写宽或写丢。今天的两个模型是同一个,所以练习里的「宽规则」是我手写的,不是反思模型生成的。
- **测试集要比验证集大,而且要持续补新样本。** 这条是明天后天两天的主题:新样本从线上来。

## 动手练习

1. **给整理者写单元测试。** 为 `curate` 和 `prune` 各写一两个测试:重复规则不收、超上限淘汰净分最低的、淘汰时新加的那条不能被淘汰、害多帮少的被 `prune` 删掉。不调模型。
2. **手册变长也是风险。** 在门禁里加一层「大小检查」:条目超过 12 条或总字数超过 600 字就不通过。写成一个不调模型的函数,用一份塞满的手册验证。
3. **反思提示词里那两条约束有没有用?** 把 `REFLECT` 里「保留关键词」「只覆盖这一类」两条去掉,从 BARE 起步重新训练,和正文比规则的写法和测试集分数。
4. **写一份手册 PR 的说明。** 假设你要把 `cand_good.json` 合进生产,用 5 句话写 PR 描述:改了什么、为什么、证据是什么、风险是什么、怎么回滚。

### 参考答案

**练习 1**

```python
# agent-zero-lab/part06/test_ace_lite.py
from part06.ace_lite import Bullet, curate, prune, render


def test_curate_dedupe_and_limit():
    book = [Bullet(1, "出现「重复扣款」归 refund", helpful=3), Bullet(2, "登录失败归 account", helpful=0, harmful=1)]
    assert curate(book, "出现「重复扣款」就归 refund") == "重复,没加"
    assert len(book) == 2
    assert curate(book, "发票抬头相关归 invoice", limit=2) == "超限,淘汰 [2]"
    assert [b.id for b in book] == [1, 3]


def test_prune_needs_two_more_harms():
    book = [Bullet(1, "甲", helpful=1, harmful=2), Bullet(2, "乙", helpful=0, harmful=2), Bullet(3, "丙")]
    assert prune(book) == [2]
    assert [b.id for b in book] == [1, 3]


def test_render_keeps_base_untouched():
    assert render("基础", []) == "基础"
    assert render("基础", [Bullet(4, "规则")]).startswith("基础\n\n补充规则")
```

<div class="line-notes">

- `book = [Bullet(1, "出现「重复扣款」归 refund", helpful=3), Bullet(2, "登录失败归 account", helpful=0, harmful=1)]` 两条手册规则:[1] 净分 3,[2] 净分 -1。
- `assert curate(book, "出现「重复扣款」就归 refund") == "重复,没加"` 这句话和 [1] 只差一个字,相似度远超 0.6,所以返回「重复,没加」,手册还是 2 条。
- `assert curate(book, "发票抬头相关归 invoice", limit=2) == "超限,淘汰 [2]"` 把上限压到 2,加第三条就超了;淘汰的是净分最低的 [2],不是刚加进来的。
- `assert [b.id for b in book] == [1, 3]` 淘汰后剩下 1 和 3,编号 2 不会被复用。
- `Bullet(1, "甲", helpful=1, harmful=2)` 害减帮是 1,不到 2,留下。`Bullet(2, "乙", helpful=0, harmful=2)` 害减帮是 2,删。
- `assert prune(book) == [2]` `prune` 返回被删的编号列表。
- `assert render("基础", []) == "基础"` 手册为空,prompt 就是基础说明本身。

</div>

在仓库根目录跑 `uv run python -m pytest -q part06/test_ace_lite.py`,实测 `3 passed in 0.68s`。

**练习 2**

```python
# agent-zero-lab/part06/ex_size_check.py
"""Day 371 练习 2:手册变长也算风险。条数和总字数超限,门禁直接不通过(不调模型)。"""
from __future__ import annotations

from pathlib import Path

from part06.ace_lite import Bullet, load_book

MAX_BULLETS = 12
MAX_CHARS = 600


def size_problems(book: list[Bullet]) -> list[str]:
    problems: list[str] = []
    if len(book) > MAX_BULLETS:
        problems.append(f"条目 {len(book)} 条,超过 {MAX_BULLETS}")
    total = sum(len(b.text) for b in book)
    if total > MAX_CHARS:
        problems.append(f"总字数 {total},超过 {MAX_CHARS}")
    return problems


if __name__ == "__main__":
    book = load_book(Path(__file__).with_name("playbook_bare.json"))
    print("现在:", len(book), "条,", sum(len(b.text) for b in book), "字,", size_problems(book) or "没问题")
    fat = book + [Bullet(100 + i, "这是一条很长很长的规则" * 5) for i in range(8)]
    print("塞 8 条长规则:", size_problems(fat))
```

<div class="line-notes">

- `MAX_BULLETS = 12` 和 `curate` 的 `limit` 默认值一致。门禁是最后一道,所以限制要比整理时更严或至少一样。
- `if len(book) > MAX_BULLETS:` 条目数超了。
- `total = sum(len(b.text) for b in book)` 所有规则文字的字数合计。`len` 对中文字符串数的是字数,不是字节数。
- `book = load_book(Path(__file__).with_name("playbook_bare.json"))` 读正文里存下来的手册。
- `fat = book + [Bullet(100 + i, "这是一条很长很长的规则" * 5) for i in range(8)]` 凑 8 条长规则:`"……" * 5` 是把字符串重复 5 遍,Python 里字符串可以直接乘整数。

</div>

实测输出:

```text
现在: 5 条, 216 字, 没问题
塞 8 条长规则: ['条目 13 条,超过 12', '总字数 656,超过 600']
```

5 条 216 字,平均每条 43 字。塞进 8 条之后 13 条、656 字,两条都报了警。真要用,把 `size_problems(new)` 的返回值接到 `playbook_gate.main` 的 `problems` 里就行。

**练习 3**

```python
# agent-zero-lab/part06/ex_reflect_plain.py
"""Day 371 练习 3:把反思提示词里「保留关键词」「只覆盖这一类」两条去掉,看规则变成什么样。"""
from __future__ import annotations

from common.llm import LLMClient
from part06 import ace_lite
from part06.opt_task import BARE_PROMPT, evaluate, load

ace_lite.REFLECT = """客服工单分类器分错了一条。请总结出一条能避免这类错误的通用规则(一句话,不超过 40 字,不要抄工单原文)。
只输出 JSON:{{"rule": "..."}}

工单:{ticket}
模型答:{pred}
正确:{label}
标注理由:{why}"""

client = LLMClient()
book = ace_lite.train(client, BARE_PROMPT)
for b in book:
    print(f"[{b.id}] 帮{b.helpful}/害{b.harmful}  {b.text}")
acc, err = evaluate(client, ace_lite.render(BARE_PROMPT, book), load("test"))
print(f"test: {acc:.0%}", [f"{e['id']} {e['label']}→{e['pred']}" for e in err])
print(client.ledger)
```

<div class="line-notes">

- `ace_lite.REFLECT = """客服工单分类器分错了一条。` 直接换掉 `ace_lite` 模块里的变量。`train()` 每次调用时才去读 `REFLECT`,所以换了以后它用的就是新的。这叫猴子补丁(Day 369 用过),练习里可以用,正式代码别这么干。
- `book = ace_lite.train(client, BARE_PROMPT)` 从 BARE 起步训练,和正文第四步同条件。
- `acc, err = evaluate(client, ace_lite.render(BARE_PROMPT, book), load("test"))` 只量测试集。

</div>

实测输出:

```text
ep0 t01:refund←billing  加入  涉及重复扣款、多扣费用的工单一律归为退款类，不论客户是否明确提出退款。
ep0 t13:refund←account  加入  涉及退款或退钱诉求时，退款类优先于账户类。
ep0 t22:billing←bug  加入  付款或扣款未成功类问题归为billing，不要误判为bug
ep0 t31:account←bug  加入  登录、鉴权类问题一律归 account，勿因含错误码或异常现象判为 bug。
[1] 帮3/害0  涉及重复扣款、多扣费用的工单一律归为退款类，不论客户是否明确提出退款。
[2] 帮3/害0  涉及退款或退钱诉求时，退款类优先于账户类。
[3] 帮4/害0  付款或扣款未成功类问题归为billing，不要误判为bug
[4] 帮2/害0  登录、鉴权类问题一律归 account，勿因含错误码或异常现象判为 bug。
test: 90% ['t12 bug→invoice', 't57 billing→other']
64 次调用 | 输入 11178 / 输出 692 tokens | 约 ¥0.0279
```

观察:去掉两条约束以后,规则反而更通用了一点(没有抄 `PAY_TIMEOUT`、`E1101`),重复扣款照样保住了,测试集 90%(正文那次 85%,差在 t33)。但这是单次运行,t33 本来就是个会抖动的用例,不能据此说「约束没用」。更合理的结论是:**在这个模型和这份数据上,看不出这两条约束的作用**。想真的验证,要多跑几次、用更大的测试集,或者换一个更弱的反思模型再试。这个练习的价值是养成习惯:提示词里每一句「约束」,都该问一句有没有数据能证明它有用。

**练习 4**(开放题,没有标准答案,给一个示范)

```text
标题:手册 v1 → v2:补「教育优惠归 billing」

改了什么:playbook_bare.json 新增第 6 条,「出现「教育优惠」「学校」等优惠咨询,归 billing,不归 other」。没有改动或删除已有条目。
为什么:测试集 t57(教育优惠)一直被答成 other,标注理由是优惠咨询算价格问题。
证据:playbook_gate 在 27 条(测试集 + 10 条关键用例)上,旧 89% → 新 93%,修好 t57,没有新带坏的;MUST_KEEP 没丢;手册现 6 条 / 约 250 字。
风险:规则里写了「学校」二字,可能误伤「学校账号被盗」这类 account 工单,目前测试集里没有这样的用例,上线后看反馈表里 billing 类的点踩。
回滚:手册是 JSON 文件,git revert 这一次提交即可。
```

好的 PR 描述,别人不用问你就能决定合不合。注意「风险」那一句要写自己真的担心的东西,不要写「无」。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| ACE | Agentic Context Engineering,把上下文当成一本不断增长的手册,只增量修改、不整段重写的方法 |
| 手册(playbook) | 一组带编号的规则,每条规则有「帮/害」计数,接在不变的基础说明后面 |
| Generator / Reflector / Curator | ACE 的三个角色:带手册做事的、总结得失的、把总结合并进手册的 |
| delta | 增量,一次只加或改的那一小条,而不是整本手册 |
| 简短偏好(brevity bias) | 优化器倾向于把规则写得短而抽象,具体细节被丢掉 |
| 上下文坍塌(context collapse) | 反复整段重写后,上下文越变越短、越变越空,效果掉下去 |
| grow-and-refine | 新条目追加、旧条目原地更新计数,再周期性去重 |
| 帮/害计数(helpful/harmful) | 每条规则被引用且答对/答错的次数,用来决定留不留 |
| 门禁(gate) | 改动进入生产前必须通过的自动检查,不通过就拦下,退出码非 0 |
| 关键用例 | 从历史事故里挑出来的「绝不能再错」的用例,比普通测试集用例权重高 |
| MUST_KEEP | 人维护的关键词清单,新手册里必须还有,专门防细节被丢 |
| 数据类(dataclass) | Python 里只装字段的类,自动生成构造函数,相当于带构造函数的 TS 接口 |

## 常见误区

**以为 ACE 一定比 GEPA 分高。** 今天的数据里两者在测试集上的差距都在一两条工单以内。ACE 的优势是产物能审、能增量改、更便宜,不是分数。论文里的提升是在智能体基准上量的,和 60 条工单的分类不是同一回事。

**把「帮/害」计数当成因果。** 我们的最小版只要分类器引用了某条规则、最后答错了,就给这条记一次「害」。一条错例引用三条规则,三条都挨了一次。真正的因果要靠反思者逐条判断,或者在线上流量里长期累计。

**手册里留着抄来的原文。** `PAY_TIMEOUT`、`E1101` 这类条目在训练集上有用,换一个错误码就失效。审手册时把它们改写成通用说法。

**门禁的总分一降就拦。** 27 条上一条工单是 3.7 个百分点,同一份手册三次跑出 89%、85%、85%。门禁里最可靠的是关键用例和关键词,总分只当参考。关键用例数量不够时,多跑几遍取多数,比单次可信。

**关键用例只收「该答对」的,不收「容易被带坏」的。** 我第一版门禁只放了该 refund 的 5 条,写太宽的规则就漏过去了一次。每次出事故,正反两面都要补。

**手册只增不减。** 不设条目上限、不清理害多帮少的条目,手册会越来越长,每次调用都带着一堆没用的规则。`curate` 的上限和 `prune` 的淘汰都要有。

## 学习资料

### 文档与文章

- [ACE 论文(arXiv 2510.04618)](https://arxiv.org/abs/2510.04618):英文。读摘要、第 3 节(三个角色和增量更新、grow-and-refine)和 Figure 2(上下文坍塌那张图),1 小时。
- [ACE 官方实现 ace-agent/ace](https://github.com/ace-agent/ace):英文。README 里手册条目的格式和 `ace/` 目录下三个角色的结构,看完再对照今天的最小版,30 分钟。
- [DSPy · GEPA API 文档](https://dspy.ai/api/optimizers/GEPA/overview/):英文,回头对照 GEPA 和 ACE 的接口差别,20 分钟。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV12h1TB5EhN&autoplay=0&high_quality=1" title="ACE-用智能体上下文工程构建程序化知识：用于自我改进语言模型的演化上下文" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>AI论文小小编 · ACE-用智能体上下文工程构建程序化知识:用于自我改进语言模型的演化上下文 · 24 分钟,中文论文讲解。对照第一步的三个角色和简短偏好、坍塌两个问题看。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/lZwV_kgzEjg" title="ACE Explained: Building Self-Correcting Agents in Python" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Latent Space TV · ACE Explained: Building Self-Correcting Agents in Python · 英文,用 Python 把手册、反思者、整理者跑一遍,和今天第二到第四步对得上。</figcaption>
</figure>

### 书籍

- Chip Huyen《AI Engineering》(O'Reilly,2025):第 4 章讲评测设计,第 5 章讲 prompt 工程和自动优化的局限,读完更清楚为什么「门禁」比「优化器」重要,英文。
- Titus Winters 等《Software Engineering at Google》(O'Reilly,2020):第 23 章讲持续集成,门禁的思路可以对照,英文。

### 开源项目与代码

- [ace-agent/ace](https://github.com/ace-agent/ace):`ace/` 下三个角色的实现和 `playbook_utils.py`,看它怎么解析 `[str-00001] helpful=5 harmful=0 :: ...` 这种条目。
- 今天的 `part06/ace_lite.py`、`playbook_gate.py`、`test_ace_lite.py`:一共约 250 行,是最小版,可以直接改。

## 自测

1. ACE 说的「简短偏好」和「上下文坍塌」各是什么?Day 369 的 GEPA 实验里,哪一个出现了?

<details><summary>答案</summary>

简短偏好是优化器倾向于把规则写得短而抽象,丢掉具体的领域细节;上下文坍塌是反复整段重写后,上下文越来越短、信息越来越少。Day 369 的 GEPA 把 refund 定义里的「重复扣款」改丢了,是简短偏好的例子;坍塌需要多轮反复重写才明显,我们只有几轮,没有碰到。

</details>

2. ACE 里谁来决定「去重、淘汰」?为什么不让大模型做?

<details><summary>答案</summary>

整理者(Curator)用普通代码做,不调大模型。让大模型做「删什么、留什么」,就又回到整段重写:它会为了简洁顺手删掉看起来啰嗦、其实关键的细节。确定性的代码可以写单元测试,同样输入永远得到同样结果,出事了能查。

</details>

3. 今天的门禁为什么要有「关键词清单」和「关键用例」,不能只比总分?

<details><summary>答案</summary>

总分有噪声:27 条上一条工单是 3.7 个百分点,同一份手册三次跑出 89%、85%、85%。关键词清单不花钱,能直接抓到「重复扣款」被删;关键用例是历史事故变成的回归点,不管总分涨没涨,被带坏就拦。总分只当辅助。

</details>

4. `curate` 淘汰时为什么用 `book[:-1]` 排除刚加的那条?

<details><summary>答案</summary>

新规则刚进来,帮和害都是 0,净分 0。别的规则只要有一条净分是正数,新规则就几乎一定是「最低」之一(多条为 0 时 `min` 取第一个遇到的,可能就是它)。不排除的话,新规则会在还没被用过的时候就被淘汰,永远没机会积累计数。

</details>

5. 帮/害计数在最小版里有什么局限?

<details><summary>答案</summary>

一是粗归因:一条错例里引用了几条规则,每条都记一次害。二是只在训练集上计数:t33 被规则 [3] 带坏发生在测试集,计数里看不见。要让计数有意义,得在上线后的真实流量里持续记,这是反馈闭环要解决的事。

</details>

6. **面试题**:公司想让大模型自动优化客服 Agent 的 prompt,你怎么保证优化结果能安全上线?

<details><summary>答案</summary>

优化跑在离线,产物是候选版本而不是直接发布。结构上尽量让产物可审:基础说明人写,机器只维护一份带编号、带计数的条目清单,diff 只有几行(ACE 的思路),而不是整段重写。候选版本走门禁:先看 diff,再查人维护的关键词清单,再在测试集加关键用例上和旧版本比,关键用例被带坏就拦,总分只当辅助,因为小测试集有噪声,同一份 prompt 跑几次分数也会晃。通过后人逐条审,合并成带版本号的文件,线上日志记版本号,能回滚。上线后用线上反馈补充测试集和关键用例。可以补一句我的实测:在 20 条的测试集上,几种优化方法的差距都在噪声内,所以我更看重产物能不能审、改动能不能回滚。

</details>

## 明天预告

Day 372 · 反馈闭环(一):显式和隐式反馈怎么采。今天说到测试集要持续从线上补新样本,手册的计数也要在线上流量里累计,可线上的「对」和「错」是谁告诉你的?明天从客服点踩、客服改写了多少、工单转人工这几种信号讲起,建一张反馈表和一个收反馈的接口。
