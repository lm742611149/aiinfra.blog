---
title: 'Day 269 · 小项目(二):引用出处和拒答校准'
description: '给 Day 268 的 DocQA 补两件事:回答里的 [kb-xxx#n] 逐个核对是不是本轮给过的资料,40 个回答实测 0 个编号出错,但引用写法有五种会被正则漏掉;拒答靠阈值、prompt 规则还是寒暄规则,用 14 道没答案的题实测:阈值 0.01 只拦下 7 道,沾边但没写的问题分数高到 0.59,拦不住。'
pubDate: 2026-10-27
regime: none
tags: ['rag', 'project', 'citation', 'refusal', 'python', 'agent-zero']
series: 'agent-zero'
day: 269
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 268](/blog/agent-zero/day-268-docqa-1/) 把零件接成了 `DocQA`:追问先改写,检索四块,拼 prompt,回答,历史里只存问答文本,超过 2000 token 才压缩。读文件的地方上了两道锁。那天跑六轮对话时留下两个观察:一句「好的谢谢」,回答里居然跟着四个毫不相干的引用;「你们有学生优惠吗」靠模型看完四块不相关的资料后自己悟出来才拒答,多花了一次检索和一次生成。

今天把这两个洞补上:引用要核对,该拒答的要在生成之前就拦下,寒暄不该走检索。

## 今天要解决的问题

学完你应该能做到:

1. 写出 `part04/citations.py`(`check_citations`、`strip_bad`、`format_sources`),说清楚「引用编号合格」和「这一块真的支持这句话」是两回事,并知道正则会漏掉哪几种写法。
2. 用 `part04/calibrate.py` 在四组问题上量出 rerank 最高分的分布,说出阈值 0.01 拦住了什么、拦不住什么(沾边但没写的问题分数高到 0.59),以及它的代价。
3. 用 `part04/refusal_ablate.py` 实测「只靠阈值、只靠 prompt 规则、两个都要」三种配置,知道各自负责什么;写出寒暄分流 `part04/small_talk.py`,并用一个真实的误伤例子说明为什么规则要两个方向都测。
4. 把这些接进 `DocQA` v2 和命令行,重跑昨天那段六轮对话。

预计用时 3 小时。API 花费约 ¥0.19:引用扫描 ¥0.0395,拒答对比 ¥0.0862,七轮对话 ¥0.0148,练习 3 的 26 次改写 ¥0.0142,练习 4 的核对 ¥0.0326,其余是几个零碎脚本。价格按 2026 年 10 月 [DeepSeek 定价页](https://api-docs.deepseek.com/zh-cn/quick_start/pricing)。embedding 和 rerank 用硅基流动的免费模型。

前置:[Day 268](/blog/agent-zero/day-268-docqa-1/) 的 `part04/docqa.py`、`docqa_cli.py`、`kb_jail.py`;[Day 227](/blog/agent-zero/day-227-rag-prompt/) 的 `part04/prompts.py`(`SYSTEM`、`build_messages`);[Day 257](/blog/agent-zero/day-257-rag-eval-3/) 的评估集 `data/eval/rag_eval.jsonl`(30 条,其中 4 条没答案);[Day 238](/blog/agent-zero/day-238-rerank/) 的 rerank 分数。数据、检索、历史压缩的零件和昨天一样,我是把旧课的同名模块搬进 `part04/` 实跑的,你的数字会有出入。

学法:先对照逐行敲一遍(不复制粘贴)并跑通;第二天合上文章默写 `check_citations`;做练习,做不出再展开参考答案,看完关掉重写一遍。

## 昨天留下的两个问题

先回放昨天命令行里的两轮。

「你们有学生优惠吗」,最高分 0.006,答案是那句拒答话术,没有编。但流程是:改写一次、检索、拼 prompt、调模型,模型看完四块毫不相关的资料(发票、模板字段……)才说「没找到」。这一步完全可以在调模型之前就拦下。

「好的谢谢」更糟:

```text
客服:不客气。如果后续还有账号安全、数据备份、流水导入或团队成员方面的问题,可以随时问我。[kb-016#1][kb-018#2][kb-009#1][kb-015#3]
```

一句寒暄,后面挂着四个引用,指向四篇毫不相干的文章。用户点进去看,只会觉得这个系统不靠谱。引用是整个文档问答产品的信用凭证,凭证里掺假,比没有凭证还糟。所以先从引用校验做起。

## 引用校验:编号对不对

提示词里要求模型「每个事实后面标出处」,但提示词只是请求,不是保证。程序要自己核对。核对的东西有三层,难度递增:

1. **格式**:是不是 `kb-002#1` 这种形状。模型偶尔会写出 `kb-003#2#1` 这样多一截的编号(Day 227 的提示词里专门加了一句「不要在后面再加编号」就是因为这个)。
2. **来源**:这个编号是不是本轮真的给过模型的块。资料里只有 `kb-002#1`,它写了 `kb-002#4`,是编的。
3. **支持**:编号对、也给过,这一块的内容真的支持那句话吗。

前两层一个正则加一次集合比较就能做,今天写。第三层要模型当裁判,成本高,放到练习 4 里实测一次。

新建 `part04/citations.py`:

```python
# agent-zero-lab/part04/citations.py  引用校验:回答里的 [kb-xxx#n] 逐个核对是不是本轮给过模型的资料
import re
from dataclasses import dataclass, field

from part04.chunking import Chunk

BRACKET = re.compile(r"\[(kb-[^\]\s]*)\]")  # 凡是 [kb-开头 的方括号,不管后面写得对不对
VALID = re.compile(r"kb-\d{3}#\d+")  # 合格的编号长这样:kb-002#1
SENTENCE = re.compile(r"(?<=。)(?!\[kb-)|\n")  # 在句号后面或换行处切;句号后面紧跟着 [kb- 的不切,引用要跟着前一句
HANZI = re.compile(r"[一-鿿]")


@dataclass
class CiteReport:
    ok: list[str] = field(default_factory=list)  # 格式对,且是本轮给过的(去重,按出现顺序)
    unknown: list[str] = field(default_factory=list)  # 格式对,但本轮没给过这一块
    malformed: list[str] = field(default_factory=list)  # 格式不对,比如 kb-003#2#1
    uncited: list[str] = field(default_factory=list)  # 看起来是在陈述事实、却没带任何引用的句子

    @property
    def bad(self) -> list[str]:
        return self.unknown + self.malformed


def check_citations(answer: str, given: set[str]) -> CiteReport:
    rep = CiteReport()
    for tag in BRACKET.findall(answer):
        if not VALID.fullmatch(tag):
            bucket = rep.malformed
        elif tag not in given:
            bucket = rep.unknown
        else:
            bucket = rep.ok
        if tag not in bucket:
            bucket.append(tag)
    for piece in SENTENCE.split(answer):
        piece = piece.strip()
        if len(HANZI.findall(piece)) >= 8 and not piece.endswith((":", "：", "?", "？")) and "[kb-" not in piece:
            rep.uncited.append(piece)
    return rep


def strip_bad(answer: str, rep: CiteReport) -> str:
    """把不合格的引用从正文里删掉,免得读者点进去发现对不上。"""
    for tag in rep.bad:
        answer = answer.replace(f"[{tag}]", "")
    return answer


def format_sources(ids: list[str], chunks: dict[str, Chunk]) -> str:
    return ";".join(f"{i} {chunks[i].title} > {chunks[i].section}" for i in ids if i in chunks)
```

<div class="line-notes">

- `import re` 标准库的正则。
- `from dataclasses import dataclass, field` `field` 是 dataclass 里给字段设「默认值工厂」用的,下面会解释为什么列表字段必须用它。
- `from part04.chunking import Chunk` Day 224 的块类型,`format_sources` 的类型标注用。
- `BRACKET = re.compile(r"\[(kb-[^\]\s]*)\]")  # 凡是 [kb-开头 的方括号,不管后面写得对不对` 方括号在正则里有特殊含义,要写成 `\[`、`\]`。圆括号是分组,`findall` 只返回括号里的部分,所以拿到的是 `kb-002#1`,不带方括号。`[^\]\s]*` 的意思是「不是右括号、也不是空白的任意多个字符」,所以 `[kb-003#2#1]` 也能匹配上,交给下一步判断格式对不对。
- `VALID = re.compile(r"kb-\d{3}#\d+")  # 合格的编号长这样:kb-002#1` `\d{3}` 恰好三位数字,`#` 在正则里就是普通字符,`\d+` 一位或多位数字。`kb-003#2#1` 用 `fullmatch`(整串必须匹配)会失败,因为多了 `#1`。
- `SENTENCE = re.compile(r"(?<=。)(?!\[kb-)|\n")  # 在句号后面或换行处切;句号后面紧跟着 [kb- 的不切,引用要跟着前一句` 这个正则是在「切句子」,有个细节:模型常把引用写在句号后面(`……退款。[kb-002#1]`)。如果直接按句号切,引用就跑到下一句开头去了,上一句会被误判成「没引用」。`(?<=。)` 是「前面是句号」,`(?!\[kb-)` 是「后面不是 `[kb-`」,两个条件同时成立才切;`|\n` 是换行处也切。第一版我写的是 `re.split(r"[。\n]", ...)`,四段假回答里「全对」那条被误报成有一句没引用,就是这个原因。
- `HANZI = re.compile(r"[一-鿿]")` 匹配一个汉字(Unicode 区间),用来数一句话里有几个汉字。
- `class CiteReport:` 一次核对的结果。
- `ok: list[str] = field(default_factory=list)  # 格式对,且是本轮给过的(去重,按出现顺序)` 为什么不写 `= []`:dataclass 会拒绝可变的默认值(所有实例会共用同一个列表,改一个全变),直接报 `ValueError: mutable default <class 'list'> for field ok is not allowed`。`default_factory=list` 的意思是「每次新建实例时调一次 `list()` 得到一个新空列表」。
- `unknown: list[str] = field(default_factory=list)  # 格式对,但本轮没给过这一块` 就是模型编出来的块。
- `malformed: list[str] = field(default_factory=list)  # 格式不对,比如 kb-003#2#1` 多了一截的、少了井号的。
- `uncited: list[str] = field(default_factory=list)  # 看起来是在陈述事实、却没带任何引用的句子` 这一类只是提示,不拦截,后面解释为什么。
- `@property` Day 43 学的:把方法当属性用,`rep.bad` 不用加括号。
- `def bad(self) -> list[str]:` 不合格的引用 = 没给过的 + 格式不对的,两种都要处理。
- `def check_citations(answer: str, given: set[str]) -> CiteReport:` 核心函数:回答文本加「本轮给过的块编号集合」,返回报告。`given` 用 `set` 是因为 `in` 判断在集合上是 O(1)。
- `for tag in BRACKET.findall(answer):` 回答里每个 `[kb-…]` 取出里面的编号。
- `if not VALID.fullmatch(tag):` 先判格式,格式错的直接归 `malformed`。顺序有讲究:格式都不对的编号,再去问「给没给过」没有意义。
- `elif tag not in given:` 格式对但不在本轮的块里,归 `unknown`。
- `if tag not in bucket:` 同一个编号出现几次只记一次。`bucket` 是上面选中的那个列表,`append` 会改到 `rep` 里对应的字段(列表是引用,不是拷贝)。
- `for piece in SENTENCE.split(answer):` 把回答切成句子,逐句看。
- `if len(HANZI.findall(piece)) >= 8 and not piece.endswith((":", "：", "?", "？")) and "[kb-" not in piece:` 三个条件都满足才算「没引用的事实句」:汉字不少于 8 个(太短的多半是「好的」「可以」);不以冒号或问号结尾(「规则如下:」后面的列表项才是事实);不含 `[kb-`。`endswith` 可以传元组,任何一个后缀匹配就行。
- `def strip_bad(answer: str, rep: CiteReport) -> str:` 把不合格的引用从正文里删掉。
- `answer = answer.replace(f"[{tag}]", "")` 逐个删,删完句子还在,只是少了一个假出处。
- `def format_sources(ids: list[str], chunks: dict[str, Chunk]) -> str:` 把编号换成「编号 文章标题 > 小节」,给界面显示。
- `return ";".join(f"{i} {chunks[i].title} > {chunks[i].section}" for i in ids if i in chunks)` `if i in chunks` 防止编号不在字典里时 `KeyError`。生成器表达式直接传给 `join`,不用先建列表。

</div>

先拿四段手写的假回答试,别急着调模型。新建 `part04/citations_demo.py`:

```python
# agent-zero-lab/part04/citations_demo.py  拿四段手写的「假回答」试 check_citations。本轮只给过模型 kb-002#1 和 kb-003#2
from part04.citations import check_citations, strip_bad

GIVEN = {"kb-002#1", "kb-003#2"}
FAKES = {
    "全对": "年付套餐中途取消,按剩余整月数比例退款。[kb-002#1] 已开发票的要先红冲再退款。[kb-003#2]",
    "引用了没给的块": "年付套餐按剩余整月数退款。[kb-002#1] 审批通常在一个工作日内完成。[kb-002#4]",
    "编号格式错": "已开发票的要先红冲再退款。[kb-003#2#1] 电子普通发票红冲一般当天完成。[kb-003#2]",
    "有句子没引用": "年付套餐按剩余整月数退款。[kb-002#1]\n你们买了十天,属于当前月份,这个月不退\n具体金额建议转人工客服核算。",
}
for name, text in FAKES.items():
    rep = check_citations(text, GIVEN)
    print(f"[{name}]")
    print(f"  ok={rep.ok} unknown={rep.unknown} malformed={rep.malformed}")
    print(f"  uncited={rep.uncited}")
    if rep.bad:
        print(f"  清理后:{strip_bad(text, rep)}")
```

<div class="line-notes">

- `GIVEN = {"kb-002#1", "kb-003#2"}` 假设本轮只给过模型这两块。
- `"引用了没给的块": "年付套餐按剩余整月数退款。[kb-002#1] 审批通常在一个工作日内完成。[kb-002#4]",` 第二句引用了 `kb-002#4`,本轮没给过,是编的。
- `"编号格式错": "已开发票的要先红冲再退款。[kb-003#2#1] 电子普通发票红冲一般当天完成。[kb-003#2]",` 多了 `#1` 的那种。
- `"有句子没引用": "年付套餐按剩余整月数退款。[kb-002#1]\n你们买了十天,属于当前月份,这个月不退\n具体金额建议转人工客服核算。",` 后两句是模型自己的推论,没带引用。注意这里的 `\n` 是换行。
- `rep = check_citations(text, GIVEN)` 对每段假回答跑一遍核对。
- `if rep.bad:` 有不合格引用才演示清理。
- `print(f"  清理后:{strip_bad(text, rep)}")` 看删掉之后正文长什么样。

</div>

```bash
uv run python -m part04.citations_demo
```

```text
[全对]
  ok=['kb-002#1', 'kb-003#2'] unknown=[] malformed=[]
  uncited=[]
[引用了没给的块]
  ok=['kb-002#1'] unknown=['kb-002#4'] malformed=[]
  uncited=[]
  清理后:年付套餐按剩余整月数退款。[kb-002#1] 审批通常在一个工作日内完成。
[编号格式错]
  ok=['kb-003#2'] unknown=[] malformed=['kb-003#2#1']
  uncited=[]
  清理后:已开发票的要先红冲再退款。 电子普通发票红冲一般当天完成。[kb-003#2]
[有句子没引用]
  ok=['kb-002#1'] unknown=[] malformed=[]
  uncited=['你们买了十天,属于当前月份,这个月不退', '具体金额建议转人工客服核算。']
```

四种情况都分对了。第三段里,`[kb-003#2#1]` 被归进 `malformed`、清理后只剩 `[kb-003#2]`。第四段里模型的两句推论被标进 `uncited`:「你们买了十天,属于当前月份,这个月不退」是它把规则套到用户情况上得出的话,确实不是帮助中心原文,标出来是对的。

再看真实的模型。给 40 个问题各问一遍(30 条评估集加 10 条补的无答案题,下一节讲怎么补的),统计引用合格情况。新建 `part04/cite_scan.py`,先把那 10 条题造出来(下一节的 `make_extra_cases.py`),再回来跑它:

```python
# agent-zero-lab/part04/cite_scan.py  给 40 个问题(30 条评估集 + 10 条补的无答案题)各问一遍,统计回答里的引用合格率
import json
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from common.llm import LLMClient
from part04.citations import check_citations
from part04.docqa import DocQA
from part04.prompts import REFUSAL

client = LLMClient()
rows = [json.loads(l) for l in Path("data/eval/rag_eval.jsonl").read_text(encoding="utf-8").splitlines()]
extra = [json.loads(l) for l in Path("data/eval/extra_cases.jsonl").read_text(encoding="utf-8").splitlines()]
rows += [r for r in extra if r["kind"] == "unanswerable"]
questions = [r["question"] for r in rows]
unanswerable = {r["question"] for r in rows if not r["expected_docs"]}  # 帮助中心里确实没有答案的 14 题


def one(q: str):
    t = DocQA(client).ask(q)  # 每题一个新 DocQA,没有历史
    return q, t, check_citations(t.answer, {c.id for c, _ in t.hits})


with ThreadPoolExecutor(4) as pool:
    results = list(pool.map(one, questions))

n_cite = sum(bool(r.ok or r.bad) for _, _, r in results)
bad = [(q, r) for q, _, r in results if r.bad]
unc = [(q, r) for q, _, r in results if r.uncited]
print(f"共 {len(results)} 个回答,带引用的 {n_cite} 个,没带引用的 {len(results) - n_cite} 个")
print(f"引用不合格的回答 {len(bad)} 个:")
for q, r in bad:
    print(f"  {q}  unknown={r.unknown} malformed={r.malformed}")
no_cite = [(q, t.answer) for q, t, r in results if not (r.ok or r.bad)]
silent = [(q, a) for q, a in no_cite if REFUSAL.rstrip("。") not in a]
print(f"没带引用的 {len(no_cite)} 个里,说了拒答话术的 {len(no_cite) - len(silent)} 个,既没拒答也没引用的 {len(silent)} 个:")
for q, a in silent:
    print(f"  {q}  ->  {a[:50]}")
leaked = [(q, t.answer) for q, t, _ in results if q in unanswerable and REFUSAL.rstrip("。") not in t.answer]
print(f"14 道没答案的题,模型自己没拒答的 {len(leaked)} 道:")
for q, a in leaked:
    print(f"  {q}  ->  {a[:90]}")
print(f"含「没引用的句子」的回答 {len(unc)} 个,举 4 例:")
for q, r in unc[:4]:
    print(f"  {q}  ->  {r.uncited[:2]}")
print(f"花费 ¥{client.ledger.cost:.4f}")
```

<div class="line-notes">

- `from concurrent.futures import ThreadPoolExecutor` 标准库的线程池。调 API 大部分时间在等网络,开 4 个线程同时发,40 个问题的总耗时大约是单线程的四分之一。相当于 JS 里 `Promise.all` 的味道,但这里用的是线程。
- `rows = [json.loads(l) for l in Path("data/eval/rag_eval.jsonl").read_text(encoding="utf-8").splitlines()]` 评估集 30 行,一行一个 JSON 对象。
- `rows += [r for r in extra if r["kind"] == "unanswerable"]` 再加补的 10 条没答案的题。`+=` 对列表是原地追加。
- `unanswerable = {r["question"] for r in rows if not r["expected_docs"]}  # 帮助中心里确实没有答案的 14 题` 评估集里原本 4 条,加上补的 10 条,一共 14 道。空列表是假值,`not []` 为真。
- `t = DocQA(client).ask(q)  # 每题一个新 DocQA,没有历史` 40 道题互相独立,不能串历史,所以每题新建一个 `DocQA`;共用同一个 `client` 是为了账本累加。
- `return q, t, check_citations(t.answer, {c.id for c, _ in t.hits})` 核对用的集合就是这一轮检索到的四块的编号。
- `with ThreadPoolExecutor(4) as pool:` 开 4 个线程。`with` 退出时自动等所有线程做完。
- `results = list(pool.map(one, questions))` `map` 按输入顺序返回结果。
- `n_cite = sum(bool(r.ok or r.bad) for _, _, r in results)` 带了任何引用(不管合不合格)的回答个数。
- `bad = [(q, r) for q, _, r in results if r.bad]` 引用不合格的回答。
- `silent = [(q, a) for q, a in no_cite if REFUSAL.rstrip("。") not in a]` 没引用、也没说拒答话术的回答。一个正常回答不该出现这种情况,这是最该盯的一类。`rstrip("。")` 去掉末尾句号再比,因为模型有时把句号写成别的。
- `leaked = [(q, t.answer) for q, t, _ in results if q in unanswerable and REFUSAL.rstrip("。") not in t.answer]` 没答案的题里,回答没有拒答话术的。

</div>

```bash
uv run python -m part04.cite_scan
```

```text
共 40 个回答,带引用的 28 个,没带引用的 12 个
引用不合格的回答 0 个:
没带引用的 12 个里,说了拒答话术的 12 个,既没拒答也没引用的 0 个:
14 道没答案的题,模型自己没拒答的 0 道:
含「没引用的句子」的回答 20 个,举 4 例:
  年付专业版用了两个月,想退款可以吗  ->  ['可以退,但只退剩余整月部分。', '- 按你的情况:已用 2 个月,加上当前所在月份共 3 个月不退,退剩余 9 个月。']
  这个月被扣了两次钱  ->  ['建议您先确认两次扣款是否属于同一笔订阅,然后联系客服核实处理。']
  Excel 存的 csv 传上去说格式不对,好像是乱码  ->  ['这是错误码 E1043:文件不是 UTF-8 编码。']
  发票抬头写错了,而且我想退款  ->  ['发票抬头写错可以申请红冲重开，但退款要先完成发票红冲才能办理。', '建议顺序：先在「账单 → 发票」申请红冲，红冲完成后再到「设置 → 订阅 → 申请退款」提交退款。']
花费 ¥0.0395
```

40 个回答,**0 个引用不合格**。没有编出来的块,也没有 `kb-003#2#1` 这种怪编号。带引用的 28 个、没带引用的 12 个,这 12 个全是拒答话术,没有「既没拒答也没引用」的回答。14 道没答案的题,模型没有一道不拒答。

这个结果要老实解读:**在这份 42 块的小知识库、DeepSeek、Day 227 那六句提示词的组合下,编号核对是一道从没触发过的保险**。它仍然值得写,有三个理由:换模型、换提示词、知识库变大以后,没有人能保证它还不触发;校验几乎不花钱;而且引用出错一次的代价,远高于写这二十行代码的成本。但也别把「0 个出错」当成「引用没问题」,看下面两点。

第一,`uncited` 那一栏有 20 个回答被标出「没引用的句子」,看举的例子,大多是开头的总结句(「可以退,但只退剩余整月部分。」,后面的列表项带了引用)或收尾的建议(「建议你先确认两次扣款是否属于同一笔订阅」)。**所以 `uncited` 只能当提示、不能当拦截条件**:拦下去,误伤率是一半。我的做法是只在日志里记数,不改回答。

第二,编号合格不等于这一块真的支持那句话,练习 4 会量。

## 补评估集:三类缺的题

接下来做拒答校准,需要的数据比现有评估集多。30 条评估集里没答案的只有 4 条,太少,而且全是「八竿子打不着」的(微信支付、手机 App、学生优惠、客服电话),真实用户常问的是**沾边但帮助中心没写**的:「两步验证的备份码丢了怎么办」(帮助中心讲了两步验证,没讲备份码)。另外还缺两种:寒暄,和要靠历史才懂的追问(单轮的评估集量不出多轮的分数)。

新建 `part04/make_extra_cases.py`:

```python
# agent-zero-lab/part04/make_extra_cases.py  补评估集的缺口:再造 10 条帮助中心里确实没有的问题、4 句寒暄、6 个要靠历史才懂的追问
import json
from pathlib import Path

OUT = Path("data/eval/extra_cases.jsonl")

UNANSWERABLE = [  # 前 5 条是八竿子打不着,后 5 条是「沾边但帮助中心没写」,后者更难拦
    "能不能对接钉钉", "有没有英文界面", "你们公司在哪个城市办公", "有 Windows 桌面客户端吗", "怎么给员工发工资",
    "年付能改成按季度付吗", "可以开美元发票吗", "你们的 API 有 Python SDK 吗", "两步验证的备份码丢了怎么办", "免费版能试用企业版吗",
]
CHITCHAT = ["你好", "好的谢谢", "再见", "明白了,我再看看"]


def turn(q: str, a: str) -> list[dict]:
    return [{"role": "user", "content": q}, {"role": "assistant", "content": a}]


FOLLOWUPS = [  # (历史, 追问, 期望的文章)
    (turn("月付的能退款吗", "月付套餐不支持中途退款,当期结束后停止服务。[kb-002#2]"), "那年付的呢", ["kb-002"]),
    (turn("我想申请退款", "可以在「设置 → 订阅 → 申请退款」提交。[kb-003#1]"), "那退款前要做什么准备吗", ["kb-003"]),
    (turn("自动扣款失败了会怎样", "会自动重试,多次失败后账号降级。[kb-004#1]"), "那数据会丢吗", ["kb-004", "kb-005"]),
    (turn("能开增值税专用发票吗", "仅限企业版,或年付的专业版。[kb-006#1]"), "怎么申请", ["kb-006"]),
    (turn("导入流水报 E1043", "文件不是 UTF-8 编码。[kb-011#1]"), "Excel 里怎么改", ["kb-011"]),
    (turn("免费版能建几个账本", "1 个账本。[kb-001#1]"), "那专业版呢", ["kb-001"]),
]

rows = []
for i, q in enumerate(UNANSWERABLE, 1):
    rows.append({"id": f"u{i:02d}", "kind": "unanswerable", "question": q, "history": [], "expected_docs": []})
for i, q in enumerate(CHITCHAT, 1):
    rows.append({"id": f"c{i:02d}", "kind": "chitchat", "question": q, "history": [], "expected_docs": []})
for i, (h, q, docs) in enumerate(FOLLOWUPS, 1):
    rows.append({"id": f"f{i:02d}", "kind": "followup", "question": q, "history": h, "expected_docs": docs})

OUT.write_text("\n".join(json.dumps(r, ensure_ascii=False) for r in rows) + "\n", encoding="utf-8")
print(f"写入 {len(rows)} 条到 {OUT}")
```

<div class="line-notes">

- `OUT = Path("data/eval/extra_cases.jsonl")` 单独存一个文件,不去改 Day 257 建的 `rag_eval.jsonl`,评估集是「冻结的尺子」,今天用的补充题不混进去。
- `UNANSWERABLE = [` 前 5 条八竿子打不着,后 5 条沾边但帮助中心没写,理论上后者更难拦(实测分数见下一节,并不都高)。每一条我都用 `grep` 在 `data/kb/` 里搜过关键词(钉钉、英文、办公、Windows、季度、美元、工资、SDK、备份码、试用),20 篇文章里一个都没有,才敢说「帮助中心里没有答案」。
- `"年付能改成按季度付吗", "可以开美元发票吗", "你们的 API 有 Python SDK 吗", "两步验证的备份码丢了怎么办", "免费版能试用企业版吗",` 这五条各自挨着一篇真实存在的文章:付费周期、发票、开放 API、两步验证、套餐。检索会找到这些文章,但文章里没有答案。
- `CHITCHAT = ["你好", "好的谢谢", "再见", "明白了,我再看看"]` 四句寒暄。
- `def turn(q: str, a: str) -> list[dict]:` 辅助函数:一问一答拼成两条消息,免得下面重复写字典。
- `FOLLOWUPS = [  # (历史, 追问, 期望的文章)` 六个追问,每个配一段手写的前一轮对话。回答里的引用编号(`[kb-002#2]` 等)是我照着知识库写的。
- `rows.append({"id": f"u{i:02d}", "kind": "unanswerable"` `f"u{i:02d}"` 补零到两位,`u01`、`u02`。`kind` 字段用来分组,`expected_docs` 为空列表表示没答案。
- `OUT.write_text("\n".join(json.dumps(r, ensure_ascii=False) for r in rows) + "\n", encoding="utf-8")` JSONL 格式:一行一个 JSON。`ensure_ascii=False` 让中文保持原样不转成 `\uXXXX`。

</div>

```bash
uv run python -m part04.make_extra_cases
```

```text
写入 20 条到 data/eval/extra_cases.jsonl
```

## 拒答校准:阈值怎么定

拒答的思路是:检索回来的第一名 rerank 分数太低,说明帮助中心里多半没有答案,就别调模型了,直接说「没找到,建议转人工」。省钱,省时间,也从源头上断掉了「资料不相关、模型硬编」的可能。

阈值设多少?不能拍脑袋,也不能照抄别人的数字。rerank 分数的分布取决于 rerank 模型和你的数据。办法是:拿「该答的」和「不该答的」两类问题,分别量第一名的分数落在哪,再扫一遍候选阈值,数它误拒了多少个该答的、漏过了多少个不该答的。

新建 `part04/calibrate.py`:

```python
# agent-zero-lab/part04/calibrate.py  拒答阈值怎么定:四组问题的 rerank 最高分各落在哪,再扫一遍候选阈值数误拒和漏拒
import json
from pathlib import Path

from part04.retrieve import retrieve
from part04.rewrite import rewrite


def load(path: str) -> list[dict]:
    return [json.loads(line) for line in Path(path).read_text(encoding="utf-8").splitlines() if line.strip()]


def top_score(question: str, history: list[dict]) -> float:
    """和 DocQA.ask 同一条路:有历史就先改写,再检索,取第一名的 rerank 分。"""
    queries = [question]
    if history:
        queries += [q for q in rewrite(question, history) if q != question]
    hits = retrieve(question, k=4, history=history, queries=queries)
    return hits[0][1] if hits else 0.0


def collect() -> list[tuple[str, str, float]]:
    out: list[tuple[str, str, float]] = []
    for r in load("data/eval/rag_eval.jsonl"):
        kind = "unanswerable" if not r["expected_docs"] else "answerable"
        out.append((kind, r["question"], top_score(r["question"], [])))
    for r in load("data/eval/extra_cases.jsonl"):
        out.append((r["kind"], r["question"], top_score(r["question"], r["history"])))
    return out


if __name__ == "__main__":
    rows = collect()
    Path("data/eval/scores.json").write_text(json.dumps(rows, ensure_ascii=False), encoding="utf-8")
    for kind in ["answerable", "followup", "unanswerable", "chitchat"]:
        scores = sorted(s for k, _, s in rows if k == kind)
        print(f"{kind:<13}共 {len(scores):>2} 条  最低 {scores[0]:.3f}  中位 {scores[len(scores) // 2]:.3f}  最高 {scores[-1]:.3f}")
    print("\n分数最低的 8 条「该答的」:")
    for k, q, s in sorted((r for r in rows if r[0] in ("answerable", "followup")), key=lambda r: r[2])[:8]:
        print(f"  {s:.3f}  {k:<10} {q}")
    print("\n分数最高的 8 条「不该答的」(含寒暄):")
    for k, q, s in sorted((r for r in rows if r[0] in ("unanswerable", "chitchat")), key=lambda r: -r[2])[:8]:
        print(f"  {s:.3f}  {k:<12} {q}")
    print(f"\n{'阈值':>6}  {'该答的被误拒':>12}  {'不该答的漏过去':>14}")
    should = [r for r in rows if r[0] in ("answerable", "followup")]
    shouldnt = [r for r in rows if r[0] == "unanswerable"]
    for th in [0.002, 0.005, 0.01, 0.02, 0.05, 0.1, 0.2]:
        fr = sum(s < th for _, _, s in should)
        fa = sum(s >= th for _, _, s in shouldnt)
        print(f"{th:>6}  {fr:>6}/{len(should)}  {fa:>10}/{len(shouldnt)}")
```

<div class="line-notes">

- `from part04.rewrite import rewrite` 追问要先改写再检索,和 `DocQA.ask` 走同一条路,量出来的分数才和线上一致。
- `def load(path: str) -> list[dict]:` 读 JSONL 的小工具。`if line.strip()` 跳过空行。
- `def top_score(question: str, history: list[dict]) -> float:` 给一个问题和一段历史,返回第一名的 rerank 分。
- `queries = [question]` 先放原话。
- `if history:` 有历史才改写,和 `ask` 一致。第一轮的问题不改写。
- `hits = retrieve(question, k=4, history=history, queries=queries)` 昨天加的 `queries` 参数。
- `return hits[0][1] if hits else 0.0` 没检索到东西就当 0 分。
- `def collect() -> list[tuple[str, str, float]]:` 收集四组分数,每条是 `(组名, 问题, 分数)`。
- `kind = "unanswerable" if not r["expected_docs"] else "answerable"` 评估集里的题,按有没有期望文章分成「该答」和「没答案」。
- `out.append((r["kind"], r["question"], top_score(r["question"], r["history"])))` 补充题自带 `kind`,追问还带着自己的 `history`。
- `Path("data/eval/scores.json").write_text(json.dumps(rows, ensure_ascii=False), encoding="utf-8")` 把分数存下来,后面两个脚本(拒答对比和练习 5)直接读,不用重新检索。
- `scores = sorted(s for k, _, s in rows if k == kind)` 一组的分数从小到大排。
- `scores[len(scores) // 2]` 取中位数:排好序后站在中间的那个。`//` 整除。
- `for k, q, s in sorted((r for r in rows if r[0] in ("answerable", "followup")), key=lambda r: r[2])[:8]:` 该答的按分数从低到高取前 8 个,这些是最危险的:阈值定高了,最先被误拒的就是它们。`key=lambda r: r[2]` 按元组的第三项(分数)排。
- `key=lambda r: -r[2]` 不该答的按分数从高到低排,取前 8 个:这些是最容易漏过去的。负号让大的排前面。
- `should = [r for r in rows if r[0] in ("answerable", "followup")]` 该答的 32 条:26 条单轮加 6 条追问。
- `shouldnt = [r for r in rows if r[0] == "unanswerable"]` 不该答的 14 条。寒暄不算在里面,它们有自己的规则(下一节)。
- `fr = sum(s < th for _, _, s in should)` 误拒数:该答的里分数低于阈值的。`sum` 对布尔值求和,`True` 当 1。
- `fa = sum(s >= th for _, _, s in shouldnt)` 漏过数:不该答的里分数不低于阈值的。

</div>

```bash
uv run python -m part04.calibrate
```

```text
answerable   共 26 条  最低 0.006  中位 0.961  最高 0.995
followup     共  6 条  最低 0.180  中位 0.846  最高 0.989
unanswerable 共 14 条  最低 0.001  中位 0.011  最高 0.593
chitchat     共  4 条  最低 0.005  中位 0.039  最高 0.041

分数最低的 8 条「该答的」:
  0.006  answerable 老板想看所有账但不能让他改
  0.043  answerable 买错了能把钱要回来吗
  0.180  followup   那退款前要做什么准备吗
  0.423  answerable 这个月被扣了两次钱
  0.428  answerable 外币的账怎么记
  0.596  answerable 连续付款失败被锁了,多久能再付
  0.598  followup   那专业版呢
  0.630  answerable Excel 存的 csv 传上去说格式不对,好像是乱码

分数最高的 8 条「不该答的」(含寒暄):
  0.593  unanswerable 两步验证的备份码丢了怎么办
  0.587  unanswerable 免费版能试用企业版吗
  0.283  unanswerable 可以开美元发票吗
  0.104  unanswerable 有没有手机 App
  0.075  unanswerable 你们支持微信支付吗
  0.062  unanswerable 怎么给员工发工资
  0.041  chitchat     你好
  0.039  chitchat     再见

    阈值        该答的被误拒         不该答的漏过去
 0.002       0/32          11/14
 0.005       0/32          10/14
  0.01       1/32           7/14
  0.02       1/32           6/14
  0.05       2/32           6/14
   0.1       2/32           4/14
   0.2       3/32           3/14
```

把四组分数画在一条对数轴上(横轴是分数,从 0.001 到 1,每格十倍;每个点是一道题):

<figure>
<svg viewBox="0 0 640 300" role="img" aria-label="四组问题的 rerank 最高分在对数坐标上的分布:该答的单轮和追问大多在 0.4 以上,没答案的从 0.001 到 0.59 铺开,最高两个是沾边但没写的问题,寒暄在 0.005 到 0.04">
<rect x="0" y="0" width="640" height="300" fill="var(--paper-raised)"/>
<g font-family="var(--font-mono)" font-size="11">
<text x="10" y="54" fill="var(--ink)">该答 单轮</text>
<line x1="110" y1="50" x2="620" y2="50" stroke="var(--rule)"/>
<circle cx="247.3" cy="43" r="4" fill="var(--mem)" fill-opacity="0.75"/>
<circle cx="387.7" cy="50" r="4" fill="var(--mem)" fill-opacity="0.75"/>
<circle cx="556.4" cy="57" r="4" fill="var(--mem)" fill-opacity="0.75"/>
<circle cx="557.3" cy="43" r="4" fill="var(--mem)" fill-opacity="0.75"/>
<circle cx="581.8" cy="50" r="4" fill="var(--mem)" fill-opacity="0.75"/>
<circle cx="585.9" cy="57" r="4" fill="var(--mem)" fill-opacity="0.75"/>
<circle cx="603.5" cy="43" r="4" fill="var(--mem)" fill-opacity="0.75"/>
<circle cx="605.2" cy="50" r="4" fill="var(--mem)" fill-opacity="0.75"/>
<circle cx="610.6" cy="57" r="4" fill="var(--mem)" fill-opacity="0.75"/>
<circle cx="612.7" cy="43" r="4" fill="var(--mem)" fill-opacity="0.75"/>
<circle cx="614.6" cy="50" r="4" fill="var(--mem)" fill-opacity="0.75"/>
<circle cx="615.9" cy="57" r="4" fill="var(--mem)" fill-opacity="0.75"/>
<circle cx="617.0" cy="43" r="4" fill="var(--mem)" fill-opacity="0.75"/>
<circle cx="617.1" cy="50" r="4" fill="var(--mem)" fill-opacity="0.75"/>
<circle cx="617.3" cy="57" r="4" fill="var(--mem)" fill-opacity="0.75"/>
<circle cx="617.4" cy="43" r="4" fill="var(--mem)" fill-opacity="0.75"/>
<circle cx="618.0" cy="50" r="4" fill="var(--mem)" fill-opacity="0.75"/>
<circle cx="618.3" cy="57" r="4" fill="var(--mem)" fill-opacity="0.75"/>
<circle cx="618.5" cy="43" r="4" fill="var(--mem)" fill-opacity="0.75"/>
<circle cx="618.8" cy="50" r="4" fill="var(--mem)" fill-opacity="0.75"/>
<circle cx="619.0" cy="57" r="4" fill="var(--mem)" fill-opacity="0.75"/>
<circle cx="619.1" cy="43" r="4" fill="var(--mem)" fill-opacity="0.75"/>
<circle cx="619.2" cy="50" r="4" fill="var(--mem)" fill-opacity="0.75"/>
<circle cx="619.3" cy="57" r="4" fill="var(--mem)" fill-opacity="0.75"/>
<circle cx="619.5" cy="43" r="4" fill="var(--mem)" fill-opacity="0.75"/>
<circle cx="619.6" cy="50" r="4" fill="var(--mem)" fill-opacity="0.75"/>
<text x="10" y="109" fill="var(--ink)">该答 追问</text>
<line x1="110" y1="105" x2="620" y2="105" stroke="var(--rule)"/>
<circle cx="493.4" cy="98" r="4" fill="var(--mem)" fill-opacity="0.75"/>
<circle cx="582.0" cy="105" r="4" fill="var(--mem)" fill-opacity="0.75"/>
<circle cx="594.7" cy="112" r="4" fill="var(--mem)" fill-opacity="0.75"/>
<circle cx="607.7" cy="98" r="4" fill="var(--mem)" fill-opacity="0.75"/>
<circle cx="616.3" cy="105" r="4" fill="var(--mem)" fill-opacity="0.75"/>
<circle cx="619.2" cy="112" r="4" fill="var(--mem)" fill-opacity="0.75"/>
<text x="10" y="164" fill="var(--ink)">没答案</text>
<line x1="110" y1="160" x2="620" y2="160" stroke="var(--rule)"/>
<circle cx="110.0" cy="153" r="4" fill="var(--compute)" fill-opacity="0.75"/>
<circle cx="156.6" cy="160" r="4" fill="var(--compute)" fill-opacity="0.75"/>
<circle cx="158.2" cy="167" r="4" fill="var(--compute)" fill-opacity="0.75"/>
<circle cx="213.9" cy="153" r="4" fill="var(--compute)" fill-opacity="0.75"/>
<circle cx="247.2" cy="160" r="4" fill="var(--compute)" fill-opacity="0.75"/>
<circle cx="257.9" cy="167" r="4" fill="var(--compute)" fill-opacity="0.75"/>
<circle cx="262.0" cy="153" r="4" fill="var(--compute)" fill-opacity="0.75"/>
<circle cx="285.6" cy="160" r="4" fill="var(--compute)" fill-opacity="0.75"/>
<circle cx="415.2" cy="167" r="4" fill="var(--compute)" fill-opacity="0.75"/>
<circle cx="429.0" cy="153" r="4" fill="var(--compute)" fill-opacity="0.75"/>
<circle cx="453.1" cy="160" r="4" fill="var(--compute)" fill-opacity="0.75"/>
<circle cx="526.9" cy="167" r="4" fill="var(--compute)" fill-opacity="0.75"/>
<circle cx="580.7" cy="153" r="4" fill="var(--compute)" fill-opacity="0.75"/>
<circle cx="581.4" cy="160" r="4" fill="var(--compute)" fill-opacity="0.75"/>
<text x="10" y="219" fill="var(--ink)">寒暄</text>
<line x1="110" y1="215" x2="620" y2="215" stroke="var(--rule)"/>
<circle cx="227.6" cy="208" r="4" fill="var(--ink-faint)" fill-opacity="0.75"/>
<circle cx="242.0" cy="215" r="4" fill="var(--ink-faint)" fill-opacity="0.75"/>
<circle cx="379.9" cy="222" r="4" fill="var(--ink-faint)" fill-opacity="0.75"/>
<circle cx="384.6" cy="208" r="4" fill="var(--ink-faint)" fill-opacity="0.75"/>
<line x1="110.0" y1="268" x2="110.0" y2="274" stroke="var(--ink-soft)"/>
<text x="110.0" y="288" text-anchor="middle" fill="var(--ink-soft)">0.001</text>
<line x1="280.0" y1="268" x2="280.0" y2="274" stroke="var(--ink-soft)"/>
<text x="280.0" y="288" text-anchor="middle" fill="var(--ink-soft)">0.01</text>
<line x1="450.0" y1="268" x2="450.0" y2="274" stroke="var(--ink-soft)"/>
<text x="450.0" y="288" text-anchor="middle" fill="var(--ink-soft)">0.1</text>
<line x1="620.0" y1="268" x2="620.0" y2="274" stroke="var(--ink-soft)"/>
<text x="620.0" y="288" text-anchor="middle" fill="var(--ink-soft)">1</text>
<line x1="280.0" y1="22" x2="280.0" y2="268" stroke="var(--compute)" stroke-dasharray="5 4"/>
<text x="284.0" y="30" fill="var(--compute)">阈值 0.01</text>
<line x1="110" y1="268" x2="620" y2="268" stroke="var(--ink-soft)"/>
<text x="573.4" y="146" text-anchor="end" fill="var(--ink-soft)">备份码 0.593、试用 0.587</text>
<text x="244.3" y="36" fill="var(--ink-soft)">老板只读 0.006</text>
</g></svg>
<figcaption>四组问题第一名 rerank 分数的分布。蓝色是该答的,琥珀色是没答案的。没答案的那一行从 0.001 一直铺到 0.59,最右边两个点(备份码、试用)和该答的那些点挤在一起,阈值线划不开它们。</figcaption>
</figure>

读这张图和上面的表,有四个结论。

**第一,大多数该答的题分数很高。** 单轮的 26 条,中位数 0.961;追问 6 条,中位数 0.846。阈值在 0.01 到 0.1 之间怎么选,对它们影响都很小。

**第二,没答案的题分成三档。** 七条在 0.01 以下:「API 有 Python SDK 吗」0.001、公司在哪个城市办公和客服电话 0.002、学生优惠 0.004、英文界面 0.006、按季度付 0.007、Windows 客户端 0.008。四条在 0.011 到 0.104 之间:对接钉钉 0.011、给员工发工资 0.062、微信支付 0.075、手机 App 0.104,八竿子打不着,可是多少还有一点分。三条是沾边但没写的:「可以开美元发票吗」0.283,「免费版能试用企业版吗」0.587,「两步验证的备份码丢了怎么办」0.593。最后这一档的分数,和该答的最低几条(0.18、0.42、0.43……)已经重叠了。**rerank 分数衡量的是「这段话和问题像不像」,不是「这段话能不能回答问题」**。备份码这个问题和两步验证那一节当然像,但那一节没写备份码。

**第三,阈值 0.01 的账。** 从表里读:误拒 1/32,漏过 7/14。也就是说它拦下了一半没答案的题(就是上面分数在 0.01 以下的那七条),代价是误拒一道该答的:「老板想看所有账但不能让他改」,分数只有 0.006,这是个口语化的绕弯说法,rerank 没看懂。再往上调,0.05 误拒 2 个,0.2 误拒 3 个,而漏过的数量只从 7 降到 3,换得不划算。

**第四,别信「刚好卡在缝里」的阈值。** 表里 0.005 能做到「误拒 0」,可是它卡在数据里最低的 0.006 前面,缝只有 0.001 宽,换一批题多半就破了,这种数是对着评估集调出来的。练习 5 会让程序自己找最优阈值,你会看到它给出 0.006,就是这个问题。

我定 0.01:拦住明显无关的,留一点余量。剩下的沾边问题,交给下一道防线。

### 第二道防线:prompt 里那句规则

阈值拦不住沾边的问题,那些问题会进入生成。这时候就靠 `SYSTEM` 里那一句:「如果资料里没有足够的信息回答,就直接说『帮助中心里没有找到……』,不要猜」。它到底管不管用,量一下。新建 `part04/refusal_ablate.py`,四种配置对比:

```python
# agent-zero-lab/part04/refusal_ablate.py  拒答靠谁:阈值、prompt 里那句规则、两个都要,各自拦住几个、误伤几个、少调几次模型
import json
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from common.llm import LLMClient
from part04.prompts import REFUSAL, SYSTEM, build_messages
from part04.retrieve import retrieve

TH = 0.01  # 本课校准出来的阈值,下一节讲怎么定的
client = LLMClient()
rows = [json.loads(l) for l in Path("data/eval/rag_eval.jsonl").read_text(encoding="utf-8").splitlines()]
rows += [r for r in map(json.loads, Path("data/eval/extra_cases.jsonl").read_text(encoding="utf-8").splitlines())
         if r["kind"] == "unanswerable"]
scores = {q: s for _, q, s in json.loads(Path("data/eval/scores.json").read_text(encoding="utf-8"))}

# 把 SYSTEM 里「资料不够就拒答」那一句去掉,得到一个没有拒答规则的版本
NO_RULE = "\n".join(line for line in SYSTEM.splitlines() if "没有找到这个问题的说明" not in line)
assert NO_RULE != SYSTEM


def generate(args: tuple[str, str]) -> str:
    q, system = args
    chunks = [c for c, _ in retrieve(q, k=4)]
    user = build_messages(q, chunks)[1]
    return client.chat([{"role": "system", "content": system}, user], temperature=0).content


LOOSE = ["没有找到这个问题", "没有关于", "无法回答", "无法确认", "没有提到", "没有相关", "未提及"]


def refused(answer: str) -> bool:
    """严格:开头是固定话术。程序里分流(转人工按钮、统计、存历史)只能认这个。"""
    return answer.startswith(REFUSAL.rstrip("。"))


def refused_loose(answer: str) -> bool:
    """宽松:开头 40 个字里出现任何一种「没有」的说法。模型不按固定话术说时,人看还是拒答。"""
    return any(k in answer[:40] for k in LOOSE)


with ThreadPoolExecutor(4) as pool:
    with_rule = list(pool.map(generate, [(r["question"], SYSTEM) for r in rows]))
    without_rule = list(pool.map(generate, [(r["question"], NO_RULE) for r in rows]))

n_no = sum(not r["expected_docs"] for r in rows)
n_yes = len(rows) - n_no
print(f"{'配置':<20}{'漏答(严格)':>9}{'漏答(宽松)':>9}{'误拒':>7}{'模型调用':>9}")
for name, answers, use_th in [("只靠阈值", without_rule, True), ("只靠 prompt 规则", with_rule, False),
                               ("阈值 + prompt 规则", with_rule, True), ("两个都不要", without_rule, False)]:
    leak = leak_loose = wrong = calls = 0
    for r, a in zip(rows, answers):
        gated = use_th and scores[r["question"]] < TH
        calls += 0 if gated else 1
        said_no = gated or refused(a)
        if not r["expected_docs"] and not said_no:
            leak += 1
            leak_loose += not refused_loose(a)
        if r["expected_docs"] and said_no:
            wrong += 1
    print(f"{name:<20}{leak:>6}/{n_no}{leak_loose:>8}/{n_no}{wrong:>5}/{n_yes}{calls:>6}/{len(rows)}")

print("\n没有规则、也没被阈值拦住,模型实际答了什么(没答案的题):")
for r, a in zip(rows, without_rule):
    if not r["expected_docs"] and scores[r["question"]] >= TH and not refused(a):
        print(f"  [{scores[r['question']]:.3f}] {r['question']}  ->  {a.replace(chr(10), ' ')[:80]}")
print(f"花费 ¥{client.ledger.cost:.4f}")
```

<div class="line-notes">

- `TH = 0.01  # 本课校准出来的阈值,下一节讲怎么定的` 注释写的是上一步的结论。
- `scores = {q: s for _, q, s in json.loads(` 把上一个脚本存的分数读回来,做成「问题 → 分数」的字典,不用再检索一遍。
- `NO_RULE = "\n".join(line for line in SYSTEM.splitlines() if "没有找到这个问题的说明" not in line)` 把 `SYSTEM` 按行拆开,丢掉含「没有找到这个问题的说明」的那一行,再拼回去:得到一个**没有拒答规则**的版本。其他五句话原样保留。
- `assert NO_RULE != SYSTEM` 保险:如果以后有人改了 `SYSTEM` 的措辞,这一行就匹配不上了,`NO_RULE` 会和原版一样,实验就白做了;这个断言会在那时报错。
- `def generate(args: tuple[str, str]) -> str:` 参数收一个元组,是因为 `pool.map` 只能传一个参数。
- `chunks = [c for c, _ in retrieve(q, k=4)]` 每道题都按单轮检索四块。
- `user = build_messages(q, chunks)[1]` 只要第二条(user 消息),system 自己换。
- `return client.chat([{"role": "system", "content": system}, user], temperature=0).content` 同一批资料、同一个问题,只换 system。
- `LOOSE = ["没有找到这个问题", "没有关于", "无法回答", "无法确认", "没有提到", "没有相关", "未提及"]` 一组「没有」的各种说法,后面解释为什么要它。
- `def refused(answer: str) -> bool:` 严格判断:开头是不是固定话术。
- `def refused_loose(answer: str) -> bool:` 宽松判断:开头 40 个字里出现任何一种「没有」的说法就算。
- `with_rule = list(pool.map(generate, [(r["question"], SYSTEM) for r in rows]))` 40 道题用原版 system 各答一遍。
- `without_rule = list(pool.map(generate, [(r["question"], NO_RULE) for r in rows]))` 再用去掉规则的版本各答一遍。80 次调用。
- `for name, answers, use_th in [("只靠阈值", without_rule, True),` 四种配置:阈值开不开、规则有没有,两两组合。阈值不用重新调模型,算的时候直接按分数「如果低于 0.01,就当作被拦下」。
- `gated = use_th and scores[r["question"]] < TH` 这一题是不是被阈值拦下。
- `calls += 0 if gated else 1` 被拦下就少一次模型调用。
- `said_no = gated or refused(a)` 最终这一题是不是被拒答了:被阈值拦下,或者模型自己用固定话术拒答。
- `leak_loose += not refused_loose(a)` `not` 的结果是布尔值,加到整数上当 0 或 1。这一列统计的是:严格口径下算「漏过」的题里,宽松口径也算漏过的有几道,也就是模型真的在顺着往下答、而不是在用自己的话拒答。
- `if not r["expected_docs"] and scores[r["question"]] >= TH and not refused(a):` 最后一段:把「没有规则、也没被阈值拦住」的没答案的题,模型实际答了什么打出来。

</div>

```bash
uv run python -m part04.refusal_ablate
```

```text
配置                     漏答(严格)   漏答(宽松)     误拒     模型调用
只靠阈值                     7/14       0/14    1/26    32/40
只靠 prompt 规则             0/14       0/14    0/26    40/40
阈值 + prompt 规则           0/14       0/14    1/26    32/40
两个都不要                   14/14       0/14    0/26    40/40

没有规则、也没被阈值拦住,模型实际答了什么(没答案的题):
  [0.075] 你们支持微信支付吗  ->  资料里没有关于支付方式的信息,无法确认是否支持微信支付。建议你联系人工客服核实。
  [0.104] 有没有手机 App  ->  资料里没有关于手机 App 的信息,我无法回答这个问题。建议你咨询人工客服确认。
  [0.011] 能不能对接钉钉  ->  根据现有资料，无法确认 CloudLedger 是否支持对接钉钉，资料中没有相关说明。  资料中只提到：需要对接自己系统、或者成员超过 3 人的，选企业版 [k
  [0.062] 怎么给员工发工资  ->  CloudLedger 的客服资料里没有关于"给员工发工资"的内容,我无法根据现有资料回答这个问题。  现有资料只涉及以下内容,供你参考: - 导入银行流水时,
  [0.283] 可以开美元发票吗  ->  资料里没有关于发票币种（能否开美元发票）的说明，无法回答这个问题。[kb-006#1][kb-006#2]  如果你问的是多币种记账：专业版和企业版支持多币种记
  [0.593] 两步验证的备份码丢了怎么办  ->  根据现有资料，无法回答这个问题。<资料>中没有关于两步验证备份码的任何说明，只提到两步验证支持短信验证码和验证器 App 两种方式，建议开启 [kb-016#1
  [0.587] 免费版能试用企业版吗  ->  资料里没有关于免费版试用企业版的内容，我无法回答这个问题。建议你联系客服确认。[kb-001#1]
花费 ¥0.0862
```

这张表要小心读。先看「漏答(严格)」那一列:没有规则时 14/14 全漏。如果只看这一列,你会得出「prompt 里那句规则救了命」的结论。但下面打印出来的七条实际回答一眼看过去,模型根本没在编:「资料里没有关于手机 App 的信息,我无法回答这个问题」「根据现有资料,无法回答这个问题」。它**用自己的话拒答了**,只是没用我们规定的那句固定话术。所以我又加了一列「漏答(宽松)」,按「没有」的各种说法算,结果所有配置都是 0/14。

所以实测结论是这样:

- **在这个模型、这份知识库上,没有那句规则,模型也不编。** 一道没答案的题都没编出来,包括沾边的备份码和试用。我没想到。换更弱的模型、更大更杂的知识库,不一定还这样,所以这是「这次实测」,不是定理。
- **规则的价值是让拒答变成一个程序认得的东西。** 严格列的 14/14 vs 0/14 差的就是这个:UI 要在拒答时显示「转人工」按钮,统计要数拒答率,历史里要标记「上一句没答上来」,这些全靠程序判断「这是不是拒答」。模型每次换一种说法,这个判断就做不了。固定话术是给代码看的,不是给模型看的。
- **阈值的账:** 少调 8 次模型(40 次降到 32 次),省了五分之一的生成调用,代价是误拒 1 道该答的(0 变 1)。这份数据上账面不赚,但它在另外两件事上有用:一是不依赖模型的自觉(换模型时它还在),二是对完全无关的问题省掉生成的延迟。如果误拒一道题的代价很高,就把阈值再调低,甚至不设阈值,只靠规则;这是个业务取舍,不是技术问题。
- 还有个小细节:没有规则时,有一条回答里出现了「<资料>中没有关于两步验证备份码的任何说明」,把我们 prompt 里的标签 `<资料>` 说出来了。用户看到这种话会困惑,这也是固定话术的好处之一:拒答时只让模型说那一句,不让它自由发挥。

## 寒暄:不查资料

回到昨天那句「好的谢谢」。表里寒暄四条的最高分是 0.005 到 0.041:「好的谢谢」「明白了我再看看」低于 0.01,会被阈值拦下,可是被拦下回的是「帮助中心里没有找到这个问题的说明,建议转人工客服」,对一句谢谢回这个显然不对;「你好」(0.041)和「再见」(0.039)分数高过阈值,会被放进生成,模型看着四块无关资料硬标引用,正是昨天那个 bug。

寒暄需要单独的分支:不检索、不调模型,回固定的话。判断「是不是寒暄」怎么做?可以让模型分类,但那又多一次调用;寒暄的集合很小很固定,先用规则。新建 `part04/small_talk.py`,先写一个最直接的版本:

```python
# agent-zero-lab/part04/small_talk.py  寒暄不查资料:短、以寒暄词开头、不带疑问词的话,直接用固定回复,不检索也不调模型
import re

PUNCT = re.compile(r"[\s,.!?~。,!?、~…]+")
QUESTION_WORDS = ("吗", "怎么", "如何", "什么", "为什么", "能不能", "可以", "多少", "哪", "是否")
RULES = [  # (开头的词, 固定回复),从上到下第一个匹配的生效
    (("你好", "您好", "hi", "hello", "在吗"), "你好,我是 CloudLedger 帮助中心的客服助手,有什么可以帮你?"),
    (("谢谢", "多谢", "感谢", "好的", "明白", "知道了", "收到", "嗯"), "不客气,还有别的问题随时问我。"),
    (("再见", "拜拜", "没事了"), "好的,再见。"),
]


def small_talk(text: str) -> str | None:
    """是寒暄就返回固定回复,不是就返回 None。"""
    t = PUNCT.sub("", text.lower())
    if not t or len(t) > 12 or any(w in t for w in QUESTION_WORDS):
        return None
    for starts, reply in RULES:
        if t.startswith(starts):
            return reply
    return None
```

<div class="line-notes">

- `PUNCT = re.compile(r"[\s,.!?~。,!?、~…]+")` 匹配标点和空白,一个或多个连着。中英文标点都放进去。
- `QUESTION_WORDS = ("吗", "怎么", "如何", "什么", "为什么", "能不能", "可以", "多少", "哪", "是否")` 带这些词的多半是真问题,不是寒暄。
- `RULES = [  # (开头的词, 固定回复),从上到下第一个匹配的生效` 三类寒暄,每类一组开头词和一句固定回复。回复里的话不带任何帮助中心的事实,不会和知识库冲突。
- `def small_talk(text: str) -> str | None:` 是寒暄就返回回复,不是就返回 `None`。
- `t = PUNCT.sub("", text.lower())` 去掉所有标点和空白,并转成小写(`Hello` 也认)。`"明白了,我再看看"` 变成 `"明白了我再看看"`。
- `if not t or len(t) > 12 or any(w in t for w in QUESTION_WORDS):` 三种情况不当寒暄:空的;超过 12 个字(寒暄都很短);带疑问词。
- `if t.startswith(starts):` 以寒暄词开头就认。`startswith` 可以传元组。

</div>

规则写出来,最容易犯的错是**只测「该拦的拦住了没有」,忘了测「不该拦的有没有被误伤」**。新建 `part04/small_talk_test.py`,两个方向都测:

```python
# agent-zero-lab/part04/small_talk_test.py  寒暄规则的两个方向都要测:该拦的拦住,不该拦的一句都别误伤
import json
from pathlib import Path

from part04.small_talk import small_talk

rows = [json.loads(l) for l in Path("data/eval/rag_eval.jsonl").read_text(encoding="utf-8").splitlines()]
rows += [json.loads(l) for l in Path("data/eval/extra_cases.jsonl").read_text(encoding="utf-8").splitlines()]

caught = [r["question"] for r in rows if small_talk(r["question"])]
should = [r["question"] for r in rows if r.get("kind") == "chitchat"]
print("规则拦下:", caught)
print("应该拦下:", should)
assert caught == should, "规则和期望对不上"

TRICKY = [("好的,那退款怎么办", False), ("好的", True), ("嗯嗯", True), ("谢谢你,顺便问下能开专票吗", False),
          ("你好,我想退款", False), ("你好!", True), ("hello", True), ("好的好的明白了谢谢", True), ("没事了", True)]
for text, want in TRICKY:
    got = small_talk(text) is not None
    print(f"{'通过' if got == want else '不符'}  期望{'拦' if want else '放'}  {text!r}")
```

<div class="line-notes">

- `rows += [json.loads(l) for l in Path("data/eval/extra_cases.jsonl")` 把评估集的 30 条和补充的 20 条合在一起,共 50 条,其中只有 4 条是寒暄。
- `caught = [r["question"] for r in rows if small_talk(r["question"])]` 规则拦下的问题。`small_talk` 返回字符串(真值)或 `None`(假值)。
- `should = [r["question"] for r in rows if r.get("kind") == "chitchat"]` 应该拦下的。评估集的 30 条没有 `kind` 字段,所以用 `r.get("kind")`,没有就返回 `None`,不会 `KeyError`。
- `assert caught == should, "规则和期望对不上"` 50 条里,不多拦也不少拦。这一条最重要的是「不多拦」:另外 46 条里一句真问题都不能被当成寒暄。
- `TRICKY = [("好的,那退款怎么办", False), ("好的", True),` 我另外手写的九个刁钻的,每个标明期望:拦(`True`)还是放(`False`)。
- `print(f"{'通过' if got == want else '不符'}  期望{'拦' if want else '放'}  {text!r}")` `!r` 带引号,看得清标点。

</div>

v1 的输出:

```text
规则拦下: ['你好', '好的谢谢', '再见', '明白了,我再看看']
应该拦下: ['你好', '好的谢谢', '再见', '明白了,我再看看']
通过  期望放  '好的,那退款怎么办'
通过  期望拦  '好的'
通过  期望拦  '嗯嗯'
通过  期望放  '谢谢你,顺便问下能开专票吗'
不符  期望放  '你好,我想退款'
通过  期望拦  '你好!'
通过  期望拦  'hello'
通过  期望拦  '好的好的明白了谢谢'
通过  期望拦  '没事了'
```

50 条评估数据全对,但手写的刁钻例子里有一个不符:**「你好,我想退款」被当成寒暄拦下了**。一个真实的退款请求,被回了一句「不客气,还有别的问题随时问我」。原因看代码就明白:`t = "你好我想退款"`,长度 7,不超 12,没有疑问词,以「你好」开头,规则就认了。「以寒暄词开头」这个判断太松了。

修法是把判断反过来:**把寒暄词和语气词都去掉以后,什么实质内容都不剩,才算寒暄**。「你好,我想退款」去掉「你好」「我」,剩下「想退款」,有内容,放行。新版:

```python
# agent-zero-lab/part04/small_talk.py  寒暄不查资料:去掉寒暄词和语气词之后,什么实质内容都不剩,才算寒暄,直接用固定回复,不检索也不调模型
import re

PUNCT = re.compile(r"[\s,.!?~。,!?、~…]+")
QUESTION_WORDS = ("吗", "怎么", "如何", "什么", "为什么", "能不能", "可以", "多少", "哪", "是否")
RULES = [  # (寒暄词, 固定回复),从上到下第一个匹配的生效
    (("你好", "您好", "hi", "hello", "在吗"), "你好,我是 CloudLedger 帮助中心的客服助手,有什么可以帮你?"),
    (("谢谢", "多谢", "感谢", "好的", "明白", "知道了", "收到", "嗯"), "不客气,还有别的问题随时问我。"),
    (("再见", "拜拜", "没事了"), "好的,再见。"),
]
FILLER = ("看看", "一下", "我", "再", "了", "啦", "呀", "啊", "吧", "哦", "的", "你", "您", "先")  # 不带信息的语气词和代词


def small_talk(text: str) -> str | None:
    """是寒暄就返回固定回复,不是就返回 None。"""
    t = PUNCT.sub("", text.lower())
    if not t or len(t) > 12 or any(w in t for w in QUESTION_WORDS):
        return None
    rest = t
    for words, _ in RULES:
        for w in words:
            rest = rest.replace(w, "")
    for w in FILLER:
        rest = rest.replace(w, "")
    if rest:  # 去掉寒暄词之后还剩东西,比如「你好,我想退款」剩下「想退款」:那是真问题,不拦
        return None
    for words, reply in RULES:
        if any(w in t for w in words):
            return reply
    return None
```

<div class="line-notes">

- `FILLER = ("看看", "一下", "我", "再", "了", "啦", "呀", "啊", "吧", "哦", "的", "你", "您", "先")  # 不带信息的语气词和代词` 这些字本身不带「要办什么事」的信息。注意把「看看」「一下」放在单字的前面:先删长的、后删短的,不然「看看」里的字被别的规则拆开,剩一个「看」。
- `rest = t` 复制一份去掉寒暄词后的结果。
- `for words, _ in RULES:` 遍历三类寒暄词。元组解包时用 `_` 丢掉回复。
- `rest = rest.replace(w, "")` 把每个寒暄词从整句里删掉。
- `for w in FILLER:` 再删语气词。
- `if rest:  # 去掉寒暄词之后还剩东西,比如「你好,我想退款」剩下「想退款」:那是真问题,不拦` 空字符串是假值,`rest` 非空就返回 `None`,让这句话继续走检索。
- `for words, reply in RULES:` 确定是寒暄之后,再找该回哪一句。
- `if any(w in t for w in words):` 句子里含有这一类的任何一个词就用这一类的回复。`"好的好的明白了谢谢"` 先匹配到第二类(谢谢、好的、明白),回「不客气」。

</div>

```text
规则拦下: ['你好', '好的谢谢', '再见', '明白了,我再看看']
应该拦下: ['你好', '好的谢谢', '再见', '明白了,我再看看']
通过  期望放  '好的,那退款怎么办'
通过  期望拦  '好的'
通过  期望拦  '嗯嗯'
通过  期望放  '谢谢你,顺便问下能开专票吗'
通过  期望放  '你好,我想退款'
通过  期望拦  '你好!'
通过  期望拦  'hello'
通过  期望拦  '好的好的明白了谢谢'
通过  期望拦  '没事了'
```

九个刁钻例子现在全过了。这个规则比较土,会漏掉很多说法(「麻烦了」「辛苦」「okk」),也可能误伤。真要用,把误伤的例子补进测试集,每改一次规则就跑一遍。寒暄的集合是开放的,规则做到「宁可漏拦、不要误伤」:漏拦的寒暄会走到下面的低分拒答,回一句「没找到」,难看但不出错;误伤的真问题被回一句「不客气」,用户的问题就丢了。

## 接进 DocQA v2

先给 `prompts.py` 加一个常量。拒答的话术在 `SYSTEM` 里写过一遍,代码里认拒答也要用,两处必须一致,所以定义一个常量放在旁边:

```python
# agent-zero-lab/part04/prompts.py  只给新增的这一行:放在 SYSTEM 后面、build_messages 前面
REFUSAL = "帮助中心里没有找到这个问题的说明,建议转人工客服。"  # 和 SYSTEM 里要求模型说的那句保持一致,代码里认拒答只认它
```

<div class="line-notes">

- `REFUSAL = "帮助中心里没有找到这个问题的说明,建议转人工客服。"` 一个字符串常量,大写命名表示「别改它」。逗号是半角,和 `SYSTEM` 里那句完全一样;两处差一个标点,`startswith` 就匹配不上了。行尾注释把「必须和 SYSTEM 一致」的约定写了下来。更稳的做法是让 `SYSTEM` 用 f-string 引用这个常量,只维护一处,留给你当小练习。

</div>

然后是 `docqa.py` v2。**完整文件如下,下面的 line-notes 只讲新增和改动的行**,没讲到的行和昨天一样:

```python
# agent-zero-lab/part04/docqa.py  文档问答骨架 v2(Day 269):加了寒暄分流、低分拒答、引用校验
import time
from dataclasses import dataclass, field

from common.llm import LLMClient
from part04.chunking import Chunk
from part04.citations import CiteReport, check_citations, strip_bad
from part04.compaction import compact
from part04.prompts import REFUSAL, build_messages
from part04.retrieve import retrieve
from part04.rewrite import rewrite
from part04.small_talk import small_talk


@dataclass
class Turn:
    question: str
    answer: str
    queries: list[str]  # 实际拿去检索的查询(第一条永远是用户原话)
    hits: list[tuple[Chunk, float]]  # (块, rerank 分数),按分数从高到低
    cost: float  # 这一轮花的钱(元),含改写、回答、压缩
    seconds: float
    kind: str = "answer"  # answer 正常回答 / refused 拒答(低分拦下或模型自己拒) / small_talk 寒暄
    cite: CiteReport = field(default_factory=CiteReport)  # 引用校验结果


class DocQA:
    def __init__(self, client: LLMClient | None = None, k: int = 4, keep_last_turns: int = 3,
                 trigger_tokens: int = 2000, min_score: float = 0.01) -> None:
        self.client = client or LLMClient()
        self.k = k
        self.keep_last_turns = keep_last_turns
        self.trigger_tokens = trigger_tokens
        self.min_score = min_score  # 第一名 rerank 分低于它就不生成,直接拒答
        self.history: list[dict] = []  # 只存问答文本,不存检索资料

    def reset(self) -> None:
        self.history = []

    def ask(self, question: str) -> Turn:
        start, cost0 = time.perf_counter(), self.client.ledger.cost

        def done(answer: str, kind: str, queries: list[str], hits: list[tuple[Chunk, float]],
                 cite: CiteReport | None = None) -> Turn:
            return Turn(question, answer, queries, hits, self.client.ledger.cost - cost0,
                        time.perf_counter() - start, kind, cite or CiteReport())

        greeting = small_talk(question)
        if greeting:  # 寒暄:不检索、不调模型,也不进历史
            return done(greeting, "small_talk", [], [])

        queries = [question]
        if self.history:  # 第一轮没有指代,不用改写
            queries += [q for q in rewrite(question, self.history, self.client) if q != question]
        hits = retrieve(question, k=self.k, history=self.history, queries=queries)

        if not hits or hits[0][1] < self.min_score:  # 低分:帮助中心里多半没有,不调生成模型
            answer, kind, cite = REFUSAL, "refused", None
        else:
            system, user = build_messages(question, [c for c, _ in hits])
            reply = self.client.chat([system, *self.history, user], temperature=0)
            cite = check_citations(reply.content, {c.id for c, _ in hits})
            answer = strip_bad(reply.content, cite)  # 不合格的引用删掉,免得读者点进去对不上
            kind = "refused" if answer.startswith(REFUSAL.rstrip("。")) else "answer"

        self.history += [{"role": "user", "content": question},
                         {"role": "assistant", "content": answer}]
        self.history = compact(self.client, self.history,
                               keep_last_turns=self.keep_last_turns,
                               trigger_tokens=self.trigger_tokens)
        return done(answer, kind, queries, hits, cite)
```

<div class="line-notes">

- `from dataclasses import dataclass, field` 多引入 `field`,给 `cite` 字段设默认值用。
- `from part04.citations import CiteReport, check_citations, strip_bad` 今天写的三个东西。
- `from part04.prompts import REFUSAL, build_messages` 多引入刚加的常量。
- `from part04.small_talk import small_talk` 寒暄分流。
- `kind: str = "answer"  # answer 正常回答 / refused 拒答(低分拦下或模型自己拒) / small_talk 寒暄` `Turn` 新增字段,带默认值,所以昨天写的 `Turn(...)` 调用不用改。界面和统计按 `kind` 分流,不用靠检查答案文字。
- `cite: CiteReport = field(default_factory=CiteReport)  # 引用校验结果` 每个 `Turn` 一个新的空报告。
- `trigger_tokens: int = 2000, min_score: float = 0.01) -> None:` 构造参数多了 `min_score`,默认 0.01。评估时可以传不同的值对比。
- `self.min_score = min_score  # 第一名 rerank 分低于它就不生成,直接拒答` 存下来。
- `def done(answer: str, kind: str, queries: list[str], hits: list[tuple[Chunk, float]],` 在 `ask` 里面定义的内部函数:各个出口都要构造一个 `Turn`,字段都差不多,提出来省得重复四遍。它能直接用外面的 `question`、`start`、`cost0`,这叫闭包。
- `cite: CiteReport | None = None) -> Turn:` 默认 `None`,下一行用 `cite or CiteReport()` 换成一个空报告。
- `greeting = small_talk(question)` 第一件事:先看是不是寒暄,在改写和检索之前。
- `if greeting:  # 寒暄:不检索、不调模型,也不进历史` 返回固定回复,`kind` 是 `small_talk`,`queries` 和 `hits` 都是空的。不进历史是故意的:寒暄对后面的回答没帮助,反而占上下文。
- `if not hits or hits[0][1] < self.min_score:  # 低分:帮助中心里多半没有,不调生成模型` `not hits` 是检索一块都没回来;`hits[0][1]` 是第一名的分数。两个条件任一成立就拦。
- `answer, kind, cite = REFUSAL, "refused", None` 直接用固定话术,不调模型,`cite` 留空。「你们有学生优惠吗」这一轮因此只剩改写那一次的 ¥0.0006,昨天是 ¥0.0022。
- `cite = check_citations(reply.content, {c.id for c, _ in hits})` 模型回答后立刻核对。集合推导式取这一轮四块的编号。
- `answer = strip_bad(reply.content, cite)  # 不合格的引用删掉,免得读者点进去对不上` 存进历史和返回给用户的,都是清理后的版本。
- `kind = "refused" if answer.startswith(REFUSAL.rstrip("。")) else "answer"` 模型自己用固定话术拒答的,也标成 `refused`。「可以开美元发票吗」就是这样:最高分 0.287 过了阈值,模型自己拒答了。
- `return done(answer, kind, queries, hits, cite)` 最后一个出口,把清理后的答案、类型、检索词、命中块和引用报告一起交出去。

</div>

命令行外壳 `docqa_cli.py` 也要改一下(回答后面带来源,拒答和寒暄单独标出来)。完整文件:

```python
# agent-zero-lab/part04/docqa_cli.py  命令行外壳 v2:回答后面带来源,拒答和寒暄单独标出来
from part04.citations import format_sources
from part04.docqa import DocQA, Turn
from part04.kb_jail import JailError, read_article
from part04.retrieve import CHUNKS


def show_sources(turn: Turn | None) -> None:
    if turn is None or not turn.hits:
        print("(上一轮没有检索结果)")
        return
    for c, s in turn.hits:
        print(f"  {s:.3f}  [{c.id}] {c.title} > {c.section}")


def main() -> None:
    qa = DocQA()
    last: Turn | None = None
    print("CloudLedger 帮助中心问答。/sources 看来源  /open kb-002.md 读整篇  /reset 清空  /quit 退出")
    while True:
        try:
            q = input("\n你:").strip()
        except (EOFError, KeyboardInterrupt):
            break
        if not q:
            continue
        if q == "/quit":
            break
        if q == "/reset":
            qa.reset()
            last = None
            print("(对话已清空)")
        elif q == "/sources":
            show_sources(last)
        elif q.startswith("/open "):
            try:
                print(read_article(q.removeprefix("/open ").strip())[:300])
            except JailError as e:
                print(f"(拒绝:{e})")
        else:
            last = qa.ask(q)
            print(f"客服:{last.answer}")
            if last.cite.ok:
                print("来源:" + format_sources(last.cite.ok, CHUNKS))
            if last.cite.bad:
                print(f"(已删掉不合格的引用:{last.cite.bad})")
            top = f"{last.hits[0][1]:.3f}" if last.hits else "-"
            print(f"  [{last.kind}  检索词 {last.queries}  最高分 {top}  ¥{last.cost:.4f}  {last.seconds:.1f}s]")
    print(f"\n本次会话共花 ¥{qa.client.ledger.cost:.4f}")


if __name__ == "__main__":
    main()
```

<div class="line-notes">

- `from part04.citations import format_sources` 把引用编号换成标题和小节。
- `from part04.retrieve import CHUNKS` `retrieve.py` 顶层那个 `{块 id: Chunk}` 字典,`format_sources` 要用它查标题。
- `if turn is None or not turn.hits:` 寒暄和被拦下的拒答,`hits` 可能是空的。`/sources` 要先判断。
- `if last.cite.ok:` 引用报告里有合格引用才打印「来源」那一行。
- `print("来源:" + format_sources(last.cite.ok, CHUNKS))` 例如 `来源:kb-002#1 退款政策 > 年付套餐`。读者看的是文章名,不是内部编号。
- `if last.cite.bad:` 如果有被删掉的假引用,打一行提示。这一行真实的使用场景里也该写日志。
- `top = f"{last.hits[0][1]:.3f}" if last.hits else "-"` 没有命中块时显示 `-`,不然 `hits[0]` 会 `IndexError`。
- `print(f"  [{last.kind}  检索词 {last.queries}  最高分 {top}  ¥{last.cost:.4f}  {last.seconds:.1f}s]")` 调试行多了 `kind`。

</div>

重跑昨天那段对话,再加两个问题:「可以开美元发票吗」(沾边但没写),「老板想看所有账但不能让他改」(昨天单轮测被误拒的那条)。整个进程还是在昨天的沙箱里跑:

```bash
printf '%s\n' "我们是年付的专业版,买了十天,能退吗" "那退款前要做什么准备吗" "发票抬头也写错了,一起处理" "你们有学生优惠吗" "好的谢谢" "可以开美元发票吗" "老板想看所有账但不能让他改" "/quit" > /tmp/in.txt
sandbox-exec -f sandbox/docqa.sb .venv/bin/python -m part04.docqa_cli < /tmp/in.txt
```

```text
CloudLedger 帮助中心问答。/sources 看来源  /open kb-002.md 读整篇  /reset 清空  /quit 退出

你:我们是年付的专业版,买了十天,能退吗
客服:可以退，但按年付套餐的规则只能退剩余整月部分，已使用的月份和当前所在月份不退 [kb-002#1]。

- 适用条件：年付套餐（专业版和企业版）中途取消，按剩余整月数比例退款 [kb-002#1]。
- 计算方式：已使用的月份和当前所在月份不退，只退剩余整月 [kb-002#1]。
- 举例：年付专业版 468 元，折合每月 39 元；第 3 个月中途取消，前 2 个月加当月共 3 个月不退，退剩余 9 个月，即 351 元 [kb-002#1]。

你买了十天，属于当前所在月份，按上述规则该月不退，具体可退金额需按剩余整月数计算 [kb-002#1]。
来源:kb-002#1 退款政策 > 年付套餐
  [answer  检索词 ['我们是年付的专业版,买了十天,能退吗']  最高分 0.703  ¥0.0019  2.5s]

你:那退款前要做什么准备吗
客服:退款前需要确认两件事：

1. 如果这笔订单已经开具发票，需要先申请发票红冲（作废），红冲完成后才能退款；电子普通发票红冲一般当天完成，增值税专用发票需要你方配合退回或开具红字信息表 [kb-003#2]。
2. 然后进入「设置 → 订阅 → 申请退款」，选择退款原因并提交，客服主管会在 1 个工作日内审批 [kb-003#1]。

审批通过后进入退款流程，退款金额和到账时间见《退款政策》[kb-003#1]。
来源:kb-003#2 如何申请退款 > 已经开了发票怎么办;kb-003#1 如何申请退款 > 操作步骤
  [answer  检索词 ['那退款前要做什么准备吗', '年付专业版退款前需要准备什么']  最高分 0.074  ¥0.0031  1.9s]

你:发票抬头也写错了,一起处理
客服:发票抬头写错可以和退款一起处理，但要注意时限和次数：

- 发票开具后 30 天内，可以在「账单 → 发票」里申请红冲并重新开具，每张发票只能重开一次 [kb-007#1]。
- 超过 30 天的，需要联系客服，并提供加盖公章的情况说明 [kb-007#1]。

结合退款流程：这笔订单如果已开发票，需要先完成发票红冲（作废）才能退款 [kb-003#2]。所以你可以先在「账单 → 发票」里申请红冲，把抬头一并改正重开，红冲完成后再走「设置 → 订阅 → 申请退款」[kb-003#2][kb-007#1]。电子普通发票红冲一般当天完成，增值税专用发票需要你方配合退回或开具红字信息表 [kb-003#2]。
来源:kb-007#1 修改发票抬头 > 开错了怎么办;kb-003#2 如何申请退款 > 已经开了发票怎么办
  [answer  检索词 ['发票抬头也写错了,一起处理', '发票抬头填写错误如何修改', '退款前发票红冲如何办理']  最高分 0.985  ¥0.0034  2.7s]

你:你们有学生优惠吗
客服:帮助中心里没有找到这个问题的说明,建议转人工客服。
  [refused  检索词 ['你们有学生优惠吗', '学生优惠']  最高分 0.006  ¥0.0006  1.1s]

你:好的谢谢
客服:不客气,还有别的问题随时问我。
  [small_talk  检索词 []  最高分 -  ¥0.0000  0.0s]

你:可以开美元发票吗
客服:帮助中心里没有找到这个问题的说明,建议转人工客服。

资料里只说明：所有付费订单都可以开电子普通发票，增值税专用发票仅限企业版或年付的专业版 [kb-006#1]；付款后 90 天内在「账单 → 发票」提交申请，填写抬头和税号，1 到 2 个工作日内开出 [kb-006#2]。没有提到发票币种。
来源:kb-006#1 发票类型与开具 > 可以开哪种发票;kb-006#2 发票类型与开具 > 怎么申请
  [refused  检索词 ['可以开美元发票吗', '可以开具美元发票吗']  最高分 0.287  ¥0.0031  1.8s]

你:老板想看所有账但不能让他改
客服:可以，给老板分配「只读成员」角色即可：只读成员只能查看和导出，不能修改流水 [kb-015#1]。

需要注意人数上限：免费版只有 1 名成员，专业版最多 3 名，企业版不限 [kb-015#2]。如果你们是专业版且成员名额已满，需要先调整成员或升级套餐。
来源:kb-015#1 团队成员与权限 > 角色;kb-015#2 团队成员与权限 > 人数上限
  [answer  检索词 ['老板想看所有账但不能让他改', '如何设置成员只读权限查看所有账单', '如何限制成员修改账单']  最高分 0.594  ¥0.0028  2.6s]

你:/quit
本次会话共花 ¥0.0148
```

逐轮对照昨天:

- 前三轮和昨天一样,多了一行「来源」,是文章标题和小节,不是编号。
- **「你们有学生优惠吗」**:`[refused ... ¥0.0006 1.1s]`,没调生成模型,只剩改写那一次调用的钱(昨天是 ¥0.0022)。因为已经有历史,所以改写还是做了。
- **「好的谢谢」**:`[small_talk ... ¥0.0000 0.0s]`,0 秒、0 元,回固定的话,没有四个假引用了。
- **「可以开美元发票吗」**:最高分 0.287,过了阈值,进入生成。模型先说了固定话术,后面又补了一段:「资料里只说明……没有提到发票币种」,带着 `kb-006#1`、`kb-006#2` 两个引用。`kind` 是 `refused`(开头是固定话术),所以界面可以显示转人工;引用也通过了核对,所以下面照常列出了「来源」。这是阈值拦不住、靠 prompt 规则拦下的一例,花了 ¥0.0031。
- **「老板想看所有账但不能让他改」**:单轮时这道题分数是 0.006(上一节说的会被误拒的那条),在这段对话里最高分是 0.594,回答正确,引用了 `kb-015#1`(只读成员)和 `kb-015#2`(人数上限)。差别在哪?因为现在是第 7 轮,**有历史,所以走了改写**,改写出「如何设置成员只读权限查看所有账单」「如何限制成员修改账单」两条,而且 rerank 是拿改写后的话去打分的。单轮、第一轮的话不改写,rerank 用的是原话。练习 3 专门量这件事。

## 把今天写的东西对到文件上

| 零件 | 对应哪里 | 文件 |
| --- | --- | --- |
| 引用核对(格式、来源) | `check_citations` | `part04/citations.py` |
| 删掉假引用 | `strip_bad` | `part04/citations.py` |
| 编号换标题 | `format_sources` | `part04/citations.py` |
| 补的评估题 | 10 条无答案、4 句寒暄、6 个追问 | `part04/make_extra_cases.py`,`data/eval/extra_cases.jsonl` |
| 阈值校准 | `collect`、阈值扫描表 | `part04/calibrate.py` |
| 拒答来自谁 | 四种配置对比 | `part04/refusal_ablate.py` |
| 寒暄分流 | `small_talk` | `part04/small_talk.py` |
| 固定话术 | `REFUSAL` | `part04/prompts.py` |
| 低分拒答、寒暄分流、引用清理 | `DocQA.ask` 里三处 | `part04/docqa.py` |
| 展示来源 | `format_sources` 调用处 | `part04/docqa_cli.py` |

## 动手练习

### 练习 1:模型还会用哪些写法标引用

用六种手写的变体测 `check_citations`:标准写法、两个编号合在一个括号里(`[kb-002#1, kb-003#2]`)、全角括号、大写、括号里有空格、一个不存在的编号。记下哪些被识别、哪些被漏掉。再改一版把漏掉的补上。

<details><summary>参考答案</summary>

先看现状:

```python
# agent-zero-lab/part04/ex269_1.py  练习 1:模型还会用哪些写法标引用?拿六种手写的「变体」试 check_citations,看哪些被漏掉了
from part04.citations import check_citations

GIVEN = {"kb-002#1", "kb-003#2"}
VARIANTS = {
    "标准": "按剩余整月退款。[kb-002#1]",
    "合并写": "按剩余整月退款,已开票要先红冲。[kb-002#1, kb-003#2]",
    "全角括号": "按剩余整月退款。【kb-002#1】",
    "大写": "按剩余整月退款。[KB-002#1]",
    "括号里有空格": "按剩余整月退款。[kb-002 #1]",
    "编了个不存在的块": "审批在一个工作日内完成。[kb-002#9]",
}
if __name__ == "__main__":
    for name, text in VARIANTS.items():
        rep = check_citations(text, GIVEN)
        seen = bool(rep.ok or rep.bad)
        print(f"{name:<10} 识别到引用={seen!s:<5} ok={rep.ok} bad={rep.bad}")
```

<div class="line-notes">

- `GIVEN = {"kb-002#1", "kb-003#2"}` 本轮给过的两块。
- `"合并写": "按剩余整月退款,已开票要先红冲。[kb-002#1, kb-003#2]",` 模型常见的写法:几个出处合在一个括号里,用逗号隔开。
- `"全角括号": "按剩余整月退款。【kb-002#1】",` 中文输入法打出来的方括号。
- `"大写": "按剩余整月退款。[KB-002#1]",` 大写的前缀。
- `"括号里有空格": "按剩余整月退款。[kb-002 #1]",` 多一个空格。
- `if __name__ == "__main__":` 让别的文件 import 这里的 `GIVEN` 和 `VARIANTS` 时不会顺带执行下面的打印。第一次写这个练习时我没加这一行,下面的修复脚本 import 它,屏幕上先冒出一堆旧输出。
- `seen = bool(rep.ok or rep.bad)` 有没有识别到任何引用。

</div>

```text
标准         识别到引用=True  ok=['kb-002#1'] bad=[]
合并写        识别到引用=False ok=[] bad=[]
全角括号       识别到引用=False ok=[] bad=[]
大写         识别到引用=False ok=[] bad=[]
括号里有空格     识别到引用=False ok=[] bad=[]
编了个不存在的块   识别到引用=True  ok=[] bad=['kb-002#9']
```

六种里只有「标准」和「编了个不存在的块」被识别,**另外四种引用整个被漏掉了**,而且是静默的:没报错,`ok` 和 `bad` 都是空,看起来就像「回答没带引用」。合并写、全角括号、大写、有空格,这四种恰好是模型最常见的变体。

修法:先把各种写法统一成 `kb-002#1`,再核对。

```python
# agent-zero-lab/part04/ex269_1_fix.py  练习 1 参考答案:先把各种写法统一成 kb-002#1 再核对。方括号全角半角都认,逗号分隔的拆开,大小写和空格抹平
import re

from part04.citations import VALID, CiteReport
from part04.ex269_1 import GIVEN, VARIANTS

GROUP = re.compile(r"[\[【]([^\]】]*kb[^\]】]*)[\]】]", re.I)  # 方括号里只要出现 kb 就当成引用组


def extract_tags(answer: str) -> list[str]:
    tags: list[str] = []
    for group in GROUP.findall(answer):
        for part in re.split(r"[,,、;;]", group):  # 半角逗号、全角逗号、顿号、分号都当分隔
            tag = part.replace(" ", "").lower()
            if tag:
                tags.append(tag)
    return tags


def check_v2(answer: str, given: set[str]) -> CiteReport:
    rep = CiteReport()
    for tag in extract_tags(answer):
        bucket = rep.malformed if not VALID.fullmatch(tag) else rep.unknown if tag not in given else rep.ok
        if tag not in bucket:
            bucket.append(tag)
    return rep


if __name__ == "__main__":
    for name, text in VARIANTS.items():
        rep = check_v2(text, GIVEN)
        print(f"{name:<10} ok={rep.ok} bad={rep.bad}")
```

<div class="line-notes">

- `from part04.citations import VALID, CiteReport` 复用昨天的格式正则和报告类型。
- `from part04.ex269_1 import GIVEN, VARIANTS` 复用上面那个脚本里的测试数据。
- `GROUP = re.compile(r"[\[【]([^\]】]*kb[^\]】]*)[\]】]", re.I)  # 方括号里只要出现 kb 就当成引用组` `[\[【]` 左括号半角或全角都行;`[^\]】]*` 里面不是右括号的任意字符;`kb` 中间必须出现;`re.I` 忽略大小写,`KB` 也认。
- `for group in GROUP.findall(answer):` 每一个括号里的内容。
- `for part in re.split(r"[,,、;;]", group):  # 半角逗号、全角逗号、顿号、分号都当分隔` 一个括号里可能有好几个编号,用各种逗号隔开。
- `tag = part.replace(" ", "").lower()` 抹平空格和大小写:`KB-002 #1` 变成 `kb-002#1`。
- `bucket = rep.malformed if not VALID.fullmatch(tag) else rep.unknown if tag not in given else rep.ok` 嵌套的条件表达式,三选一:格式不对、本轮没给过、合格。和昨天的 `if/elif/else` 一个意思,写成一行。

</div>

```text
标准         ok=['kb-002#1'] bad=[]
合并写        ok=['kb-002#1', 'kb-003#2'] bad=[]
全角括号       ok=['kb-002#1'] bad=[]
大写         ok=['kb-002#1'] bad=[]
括号里有空格     ok=['kb-002#1'] bad=[]
编了个不存在的块   ok=[] bad=['kb-002#9']
```

六种全部识别。「合并写」被拆成了两个合格编号,「大写」「全角」「有空格」都被抹平。真正放进项目时,把 `citations.py` 里的 `BRACKET` 循环换成 `extract_tags` 的版本。但**回答里原来的那些写法并没有被改**,只是核对时认得了;要在界面上把它们都换成统一格式,得另外做替换。

</details>

### 练习 2:追问不带历史、带历史,分数差多少

对补充题里的六个追问,各算两个分数:不带历史直接检索,和带手写的历史先改写再检索。放在一张表里。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part04/ex269_2.py  练习 2:同样六个追问,不带历史直接检索 vs 带历史先改写,第一名的 rerank 分差多少
import json
from pathlib import Path

from part04.calibrate import top_score

rows = [json.loads(l) for l in Path("data/eval/extra_cases.jsonl").read_text(encoding="utf-8").splitlines()]
print(f"{'追问':<16}{'不带历史':>8}{'带历史改写':>11}")
for r in (r for r in rows if r["kind"] == "followup"):
    raw = top_score(r["question"], [])
    fixed = top_score(r["question"], r["history"])
    print(f"{r['question']:<16}{raw:>8.3f}{fixed:>11.3f}")
```

<div class="line-notes">

- `from part04.calibrate import top_score` 直接复用校准脚本里的函数。
- `for r in (r for r in rows if r["kind"] == "followup"):` 外层括号里是生成器表达式,筛出追问。
- `raw = top_score(r["question"], [])` 历史传空列表,等于当成第一轮来问。
- `fixed = top_score(r["question"], r["history"])` 带着手写的历史,走改写。
- `{r['question']:<16}{raw:>8.3f}{fixed:>11.3f}` 格式化对齐,中文字符占的宽度和数字不一样,所以左边对不整齐是正常的。

</div>

```text
追问                  不带历史      带历史改写
那年付的呢              0.074      0.989
那退款前要做什么准备吗        0.037      0.180
那数据会丢吗             0.082      0.890
怎么申请               0.639      0.710
Excel 里怎么改         0.079      0.948
那专业版呢              0.667      0.598
```

「那年付的呢」从 0.074 变成 0.989,「Excel 里怎么改」0.079 变成 0.948,「那数据会丢吗」0.082 变成 0.890,补全之后分数涨了十几倍。**不带历史时这三个都在 0.1 以下,如果阈值定得高一些,它们会被当成没答案拒掉。** 另外两个追问(「怎么申请」0.639、「那专业版呢」0.667)不带历史也有不错的分,因为它们本身带着「申请」「专业版」这类有分量的词。最后一个例外:「那专业版呢」带历史之后反而降了(0.667 到 0.598),改写出的检索词不一定比原话好。

</details>

### 练习 3:第一轮也改写,能把误拒的口语题救回来吗

26 道有答案的单轮题,每道算三个分数:① 不改写(现在的做法);② 改写了,检索时多几个检索词,但 rerank 还是用原话打分;③ 改写了,rerank 也拿改写后的话打分。看分数最低的几道。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part04/ex269_3.py  练习 3:第一轮也改写,能把被阈值误拒的口语题救回来吗?26 道有答案的题各算三遍,看分数最低的几道
import json
from pathlib import Path

from part04.retrieve import retrieve
from part04.rewrite import default_client as client, rewrite

rows = [json.loads(l) for l in Path("data/eval/rag_eval.jsonl").read_text(encoding="utf-8").splitlines()]
rows = [r for r in rows if r["expected_docs"]]
DUMMY = [{"role": "user", "content": "(占位)"}]  # retrieve 里「有历史且有改写」才拿改写后的话去 rerank 打分,传个占位历史触发它
out = []
for r in rows:
    q = r["question"]
    a = retrieve(q, k=4)[0][1]  # ① 现在的做法:第一轮不改写
    queries = [q] + [x for x in rewrite(q, []) if x != q]  # 第一轮也改写
    b = retrieve(q, k=4, history=[], queries=queries)[0][1]  # ② 改写了,但 rerank 还是用原话打分
    c = retrieve(q, k=4, history=DUMMY, queries=queries)[0][1]  # ③ 改写了,rerank 也用改写后的话打分
    out.append((a, b, c, q, queries[1:]))
print(f"{'①不改写':>8}{'②只检索':>8}{'③连打分':>8}  问题 -> 改写出的检索词")
for a, b, c, q, qs in sorted(out)[:4]:
    print(f"{a:>8.3f}{b:>8.3f}{c:>8.3f}  {q} -> {qs}")
print(f"\n第一名分数低于 0.01 的题:① {sum(o[0] < 0.01 for o in out)} 道  ② {sum(o[1] < 0.01 for o in out)} 道  ③ {sum(o[2] < 0.01 for o in out)} 道")
print(f"26 次改写花费 ¥{client.ledger.cost:.4f}")
```

<div class="line-notes">

- `DUMMY = [{"role": "user", "content": "(占位)"}]  # retrieve 里「有历史且有改写」才拿改写后的话去 rerank 打分,传个占位历史触发它` `retrieve` 里有一行:`rerank_q = "；".join(queries[1:]) if history and len(queries) > 1 else question`。只有 `history` 非空时才用改写后的话打分。这里没有真实历史,传一个占位的就能触发这条分支。这是在借 `retrieve` 的实现细节,真要做这个功能,应该给 `retrieve` 加一个明确的开关,而不是靠占位。
- `a = retrieve(q, k=4)[0][1]  # ① 现在的做法:第一轮不改写` 没传 `queries`、没传 `history`,就是单轮默认行为。
- `queries = [q] + [x for x in rewrite(q, []) if x != q]  # 第一轮也改写` `rewrite` 传空历史,也能把口语改成帮助中心的说法。
- `b = retrieve(q, k=4, history=[], queries=queries)[0][1]` 多了几个检索词,但 `history=[]` 是空的,所以 rerank 还是用原话。
- `c = retrieve(q, k=4, history=DUMMY, queries=queries)[0][1]` 占位历史触发,rerank 用改写后的话。
- `for a, b, c, q, qs in sorted(out)[:4]:` 元组按第一项(①的分数)排序,取最低的 4 道。

</div>

```text
    ①不改写    ②只检索    ③连打分  问题 -> 改写出的检索词
   0.006   0.006   0.163  老板想看所有账但不能让他改 -> ['如何设置只读权限查看所有账目', '如何限制成员编辑账目']
   0.042   0.041   0.066  买错了能把钱要回来吗 -> ['买错了可以退款吗']
   0.423   0.421   0.045  这个月被扣了两次钱 -> ['本月被扣款两次的原因']
   0.428   0.431   0.329  外币的账怎么记 -> ['外币账务处理']

第一名分数低于 0.01 的题:① 1 道  ② 1 道  ③ 0 道
26 次改写花费 ¥0.0142
```

**只改写检索词(②)不够。** 最低的「老板想看所有账但不能让他改」在 ① ② 都是 0.006,因为 rerank 看的还是那句原话。**连 rerank 打分也换成改写后的话(③),它变成 0.163,被救回来了。** 第一名低于 0.01 的题:①②各 1 道,③ 0 道。

但有代价:「这个月被扣了两次钱」从 0.423 掉到 0.045,因为改写把它变成「本月被扣款两次的原因」,「扣了两次」的重复扣款含义被稀释了;「外币的账怎么记」也从 0.428 降到 0.329。③ 救了一条,压低了好几条。再加上每道题多一次改写调用,26 次共 ¥0.0142。所以我没有把「第一轮也改写」做进 `ask`:一个口语题被救回来,几个本来好好的题变差,账不划算。更稳的办法是把改写和原话两路的 rerank 分数取较大值,留给你试。

</details>

### 练习 4(开放题):编号对,这一块真的支持这句话吗

对前 12 个有答案的问题,每个问一遍,取出所有带引用的句子,把这句话引用的**全部**块合在一起,让模型判「出处原文里有没有直接写明这句话的事实」,统计有几句被判不支持。

<details><summary>参考答案(示范解法,不是唯一答案)</summary>

```python
# agent-zero-lab/part04/ex269_4.py  练习 4(开放题):引用的编号对,不等于那一块真的支持这句话。取 12 个问题,每个带引用的句子,把它引用的块合在一起,让模型判一次「资料支不支持」
import json
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from common.llm import LLMClient
from part04.citations import BRACKET, SENTENCE, VALID
from part04.docqa import DocQA
from part04.retrieve import CHUNKS

client = LLMClient()
rows = [json.loads(l) for l in Path("data/eval/rag_eval.jsonl").read_text(encoding="utf-8").splitlines()]
questions = [r["question"] for r in rows if r["expected_docs"]][:12]
JUDGE = '你是核对员。给你一句回答和它标注的出处原文。只判断:这句话的事实,出处原文里有没有直接写明。输出 JSON:{"supported": true或false, "reason": "一句话"}'


def pairs(q: str) -> list[tuple[str, str, list[str]]]:
    """问一遍,把回答里每个带引用的句子和它引用的全部块配成一组。"""
    ans = DocQA(client).ask(q).answer
    out = []
    for sent in SENTENCE.split(ans):
        tags = [t for t in BRACKET.findall(sent) if VALID.fullmatch(t) and t in CHUNKS]
        if tags:
            out.append((q, sent.strip(), tags))
    return out


def judge(item: tuple[str, str, list[str]]) -> dict:
    q, sent, tags = item
    source = "\n\n".join(f"[{t}]\n{CHUNKS[t].text}" for t in tags)
    msg = f"回答:{BRACKET.sub('', sent)}\n出处原文:\n{source}"
    raw = client.chat([{"role": "system", "content": JUDGE}, {"role": "user", "content": msg}],
                      temperature=0, response_format={"type": "json_object"}).content
    return {**json.loads(raw), "q": q, "sent": sent, "tags": tags}


with ThreadPoolExecutor(4) as pool:
    items = [p for ps in pool.map(pairs, questions) for p in ps]
    verdicts = list(pool.map(judge, items))

bad = [v for v in verdicts if not v["supported"]]
print(f"{len(questions)} 个问题,共 {len(verdicts)} 个带引用的句子,模型判为不支持的 {len(bad)} 个")
for v in bad:
    print(f"  {v['tags']} {v['sent'][:50]}\n      问题:{v['q']}\n      理由:{v['reason']}")
print(f"花费 ¥{client.ledger.cost:.4f}")
```

<div class="line-notes">

- `JUDGE = '你是核对员。给你一句回答和它标注的出处原文。只判断:这句话的事实,出处原文里有没有直接写明。输出 JSON:{"supported": true或false, "reason": "一句话"}'` 裁判提示词。只让它判一件事,而且强调「直接写明」,防止它自己脑补「应该是支持的」。要求输出 JSON,方便程序读。
- `tags = [t for t in BRACKET.findall(sent) if VALID.fullmatch(t) and t in CHUNKS]` 句子里引用的、格式对、真实存在的块编号。`CHUNKS` 是 `retrieve.py` 里的 `{id: Chunk}`。
- `if tags:` 有引用的句子才送去核对。
- `source = "\n\n".join(f"[{t}]\n{CHUNKS[t].text}" for t in tags)` 把这句话引用的所有块的原文拼在一起。
- `msg = f"回答:{BRACKET.sub('', sent)}\n出处原文:\n{source}"` 送给裁判的句子里要把 `[kb-…]` 去掉,不然裁判会被编号干扰。`BRACKET.sub('', sent)` 把匹配到的部分替换成空。
- `response_format={"type": "json_object"}` 让接口保证返回合法 JSON。
- `return {**json.loads(raw), "q": q, "sent": sent, "tags": tags}` `**` 把裁判返回的字典展开,再加上我们自己的字段。
- `bad = [v for v in verdicts if not v["supported"]]` 被判不支持的。

</div>

```text
12 个问题,共 30 个带引用的句子,模型判为不支持的 0 个
花费 ¥0.0326
```

12 个问题里共 30 个带引用的句子,**被判不支持的 0 个**。引用编号对,内容也确实对得上。

我第一次写的版本不是这样的。第一版按「句子加单个引用」逐对判,31 对里有 4 对判为不支持。去看那 4 对的内容,全是一句话同时引了两块(比如「所有退款都需要客服主管审批后执行 [kb-002#4];申请入口在……[kb-003#1]」),拆成单块去核对,每一块当然只支持一半。是我的核对方法错了,不是模型的引用错了。改成把一句话引用的所有块合在一起判,就是 0/30。这一类方法设计里的错,比模型的错更容易误导你,别人看到的「不支持 4 个」会变成「模型引用不可靠」。

也别因为 0/30 就放心:裁判本身也是模型,12 道题 30 句话的样本很小,而且这些题都是评估集里的标准问法。这个核对太贵,不适合每次回答都跑(30 次核对 ¥0.0326,约为回答成本的一倍),适合抽样,或者在评估集上跑。

</details>

### 练习 5(开放题):误拒的代价比漏过大得多时,阈值该是多少

给「误拒该答的」和「漏过不该答的」两种错误设不同的权重,让程序遍历数据里出现过的分数,找总代价最小的阈值。试四组权重,看阈值怎么变。

<details><summary>参考答案(示范解法,不是唯一答案)</summary>

```python
# agent-zero-lab/part04/ex269_5.py  练习 5(开放题):误拒一个该答的,比漏过一个不该答的糟得多。给两种错误不同的权重,让程序自己找最合适的阈值。不调接口,读 calibrate.py 存下的 scores.json
import json
from pathlib import Path

rows = json.loads(Path("data/eval/scores.json").read_text(encoding="utf-8"))
should = [s for k, _, s in rows if k in ("answerable", "followup")]  # 该答的:低于阈值就是误拒
shouldnt = [s for k, _, s in rows if k == "unanswerable"]  # 不该答的:不低于阈值就是漏过去


def cost(th: float, w_wrong: float, w_leak: float) -> float:
    return w_wrong * sum(s < th for s in should) + w_leak * sum(s >= th for s in shouldnt)


def best_threshold(w_wrong: float, w_leak: float) -> tuple[float, float]:
    candidates = sorted({0.0, *should, *shouldnt})  # 只有数据里出现过的分数才可能是分界点
    best = min(candidates, key=lambda th: (cost(th, w_wrong, w_leak), th))
    return best, cost(best, w_wrong, w_leak)


for w_wrong, w_leak in [(1, 1), (3, 1), (10, 1), (1, 3)]:
    th, c = best_threshold(w_wrong, w_leak)
    wrong = sum(s < th for s in should)
    leak = sum(s >= th for s in shouldnt)
    print(f"误拒权重 {w_wrong:>2}、漏过权重 {w_leak}:阈值 {th:.3f},误拒 {wrong}/{len(should)},漏过 {leak}/{len(shouldnt)},总代价 {c:g}")
```

<div class="line-notes">

- `should = [s for k, _, s in rows if k in ("answerable", "followup")]  # 该答的:低于阈值就是误拒` 只取分数。
- `shouldnt = [s for k, _, s in rows if k == "unanswerable"]  # 不该答的:不低于阈值就是漏过去` 寒暄不算。
- `def cost(th: float, w_wrong: float, w_leak: float) -> float:` 阈值 `th` 下的总代价 = 误拒数乘权重 + 漏过数乘权重。
- `candidates = sorted({0.0, *should, *shouldnt})  # 只有数据里出现过的分数才可能是分界点` 集合推导加 `*` 展开,把所有分数去重排序。阈值只可能落在这些点上,在两个相邻分数之间任取都一样。
- `best = min(candidates, key=lambda th: (cost(th, w_wrong, w_leak), th))` 找代价最小的;代价一样时取小的阈值(元组比较先比第一项再比第二项),也就是更宽松、少拒答的那个。
- `print(f"误拒权重 {w_wrong:>2}、漏过权重 {w_leak}:阈值 {th:.3f},` 打印阈值、两种错误的个数和总代价。`{c:g}` 去掉没必要的小数点后的零。

</div>

```text
误拒权重  1、漏过权重 1:阈值 0.180,误拒 2/32,漏过 3/14,总代价 5
误拒权重  3、漏过权重 1:阈值 0.006,误拒 0/32,漏过 9/14,总代价 9
误拒权重 10、漏过权重 1:阈值 0.006,误拒 0/32,漏过 9/14,总代价 9
误拒权重  1、漏过权重 3:阈值 0.596,误拒 5/32,漏过 0/14,总代价 5
```

权重 1:1 时,最优阈值是 0.180(误拒 2、漏过 3,总代价 5)。**误拒权重放大到 3 倍或 10 倍,最优阈值都落到 0.006**:误拒 0 个、漏过 9 个。反过来,漏过权重放大 3 倍,阈值跳到 0.596,误拒 5 个、漏过 0 个。

这四行说明了几件事。阈值不是技术问题,是业务选择:客服场景里误拒一个真问题(用户被推给人工,体验差,人工成本涨),和漏过一个没答案的问题(模型可能答错)哪个更贵,你得先回答这个问题。再说,0.006 恰好等于数据里最低的该答分数,它是「在这 32 条上刚好不误拒」的数,不是「稳」的数,和上面讲的「别信刚好卡在缝里的阈值」是同一个现象。实际定值我留了一点余量,用 0.01,而且要在更大的评估集上复测。还有一点,漏过 9 个听着吓人,但上一节实测了:这些漏过的,模型自己大多会拒答,所以真正的「错答率」比这里的「漏过率」低得多。

</details>

**验收标准:**

- `citations_demo.py` 的四段假回答分类正确;`cite_scan.py` 跑完能报出「引用不合格」「既没拒答也没引用」「没答案却答了」三个数。
- `calibrate.py` 的分布和阈值表你自己跑出来了,能说出 0.01 拦下了什么、漏掉了什么、误拒了哪一条。
- `small_talk_test.py` 全部通过,包括「你好,我想退款」不被拦。
- `DocQA` v2 在命令行里重跑 7 轮:寒暄 0 元 0 秒、低分题不调生成模型、回答后面带文章标题。
- 练习 1 到 3 的数字和参考答案同量级。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 引用核对 | 回答里的出处编号,逐个检查格式对不对、是不是本轮真的给过模型的资料。和「这一块真的支持这句话」是两回事 |
| 引用错位 | 编号合法、也给过,但那一块的内容并不支持这句话。核对要靠模型当裁判,成本高 |
| 拒答 | 资料不够时,明确说「没找到」而不是编。可以在调模型之前拦(阈值),也可以让模型自己说(prompt 规则) |
| 阈值(threshold) | 一个分界数字,分数低于它就拒答。要在自己的数据上量出来,不能照抄 |
| 误拒 | 该答的问题被拒答了。用户被推给人工,体验差 |
| 漏过(漏拒) | 不该答的问题进了生成。可能得到编造的回答 |
| 校准(calibration) | 用有标注的数据量出阈值、权衡两种错误的过程 |
| 近似但没写(near-miss) | 问题和某篇文章很像,但文章里没有答案。rerank 分数很高,阈值拦不住 |
| 固定话术 | 拒答时规定模型只说的那一句。让程序能识别「这是拒答」,而不是让模型自由发挥 |
| 严格 vs 宽松判断 | 严格:按固定话术匹配;宽松:按「没有」这类意思匹配。统计拒答时两种口径差别可以很大 |
| 寒暄分流 | 「你好」「谢谢」这类话不检索、不调模型,直接用固定回复 |
| 闭包 | 函数里定义的函数可以直接使用外层函数的变量。`ask` 里的 `done` 就用了外面的 `start`、`cost0` |
| `default_factory` | dataclass 里给可变默认值(列表、字典)用的写法,每个实例单独生成一个新的,不共享 |
| JSONL | 一行一个 JSON 对象的文本格式,适合追加和逐行读取 |

## 常见误区

**把 `uncited`(没引用的句子)当成拦截条件。** 实测 40 个回答里有 20 个被标出,多是开头的总结句和结尾的建议,误伤率一半。只能当提示,在日志里计数。

**只写 `[kb-…]` 一种引用的正则。** 合并写(`[kb-002#1, kb-003#2]`)、全角括号、大写、括号里带空格,四种写法被静默漏掉,看起来像「回答没带引用」。核对的第一步是把写法统一。

**用逐对(句子加单个引用)去核对一句引了两块的话。** 每一块只支持一半,会得出一堆「不支持」。要把一句话引用的所有块合在一起判。

**把 0.006 这种刚好卡在数据缝里的阈值当成答案。** 它是对着评估集调出来的,换一批题就破。留余量,并在更大的数据上复测。

**以为阈值能拦住所有没答案的问题。** rerank 分数量的是「像不像」,不是「能不能回答」。「备份码丢了怎么办」0.593、「试用企业版」0.587,和该答的最低几条重叠。这类问题只能靠 prompt 规则或更强的核对。

**统计拒答率时只按固定话术匹配。** 没有规则时,严格口径算 14/14 全漏,宽松口径是 0/14。别拿一个口径下的数字去下「模型在编」的结论,先看实际回答。

**寒暄规则只测「该拦的拦住了」。** 「你好,我想退款」被当成寒暄,真问题就丢了。规则要两个方向都测,而且把每个误伤例子补进测试。

**第一轮不改写,后面又拿第一轮的分数去定阈值。** 单轮分数和多轮分数分布不同(练习 2 追问分数差十几倍)。阈值要在两种场景下都量,别只用评估集那 30 条。

**以为 `temperature=0` 就每次答案一样。** 我这三天跑同样的脚本,拒答话术的开头、引用的句子位置都会有细微差别;「没引用的句子」的个数 19、20、21 都出现过。对比时看量级。

## 学习资料

### 文档与文章

- [Anthropic · Reduce hallucinations](https://docs.anthropic.com/en/docs/test-and-evaluate/strengthen-guardrails/reduce-hallucinations):官方给的降低幻觉的办法清单,里面「允许模型说不知道」「要求引用并核对」两条和今天对得上。
- [Anthropic · Citations](https://docs.anthropic.com/en/docs/build-with-claude/citations):模型接口自带的引用功能,引用指向原文的具体位置,而不是靠提示词让模型自己写编号。看它怎么设计,和我们手写的编号核对对照。
- [Python 文档 · re 正则表达式](https://docs.python.org/zh-cn/3.12/library/re.html):中文,今天用到的 `fullmatch`、`findall`、`split`、零宽断言 `(?<=…)`、`(?!…)` 都在里面。
- [Ragas · Faithfulness](https://docs.ragas.io/en/stable/concepts/metrics/available_metrics/faithfulness/):评估框架里「忠实度」指标的定义,思路和练习 4 的核对一样:把回答拆成一条条陈述,逐条看资料能不能推出来。
- [Cohere · Rerank](https://docs.cohere.com/docs/rerank-overview):rerank 接口的说明,可以对照看分数的含义,以及为什么不同模型的分数不能直接比。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV112421N7Mp&autoplay=0&high_quality=1" title="动手学RAG:Part8 意图识别/关键词/扩展词" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>Coggle数据科学 · 动手学RAG:Part8 意图识别/关键词/扩展词 · 11 分钟,讲检索前先判断用户想干什么、再决定怎么查,和今天「寒暄不查资料」同一个思路。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1b69gB5E3h&autoplay=0&high_quality=1" title="面试官问:如何评估RAG系统的效果?" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>面试官问:如何评估RAG系统的效果? · 短视频,把检索指标、生成指标和「拒答」这类场景怎么评估过一遍,Day 270 的面试题和这条是同一路。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/SLxjDcT1NaM" title="RAG Failure Modes: 7 Reasons Your AI Chatbot Gives Bad Answers" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Zero 2 Concept · RAG Failure Modes: 7 Reasons Your AI Chatbot Gives Bad Answers · 英文,开自动字幕,过一遍 RAG 出错的七种原因,对照今天实测的分数重叠、近似但没写、引用错位几种。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/beVPEvMkjwE" title="Why Your RAG Chatbot Fails (and How to Evaluate It)" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>CodeStoa · Why Your RAG Chatbot Fails (and How to Evaluate It) · 英文,讲 RAG 聊天机器人为什么答不好、怎么评估,Day 270 做成绩单之前先看看。</figcaption>
</figure>

### 书籍

- Chip Huyen《AI Engineering》(O'Reilly,2025):讲评估、幻觉和 RAG 的章节,可以对照今天「拒答要量、阈值要校准」的做法。
- Jay Alammar、Maarten Grootendorst《Hands-On Large Language Models》(O'Reilly,2024):语义搜索和 RAG 那几章,配大量图解。

### 开源项目与代码

- [explodinggradients/ragas](https://github.com/explodinggradients/ragas):RAG 评估框架,里面的 faithfulness、answer relevancy 等指标的实现可以读,对照练习 4。
- [stanfordnlp/dspy](https://github.com/stanfordnlp/dspy):可以看它的 `Assert` 和 `Suggest`,是「回答不合格就自动重试」的框架化写法,今天的 `strip_bad` 是最朴素的一版。

## 自测

1. 引用核对的三层分别是什么?今天实现了哪几层?

<details><summary>答案</summary>

格式(是不是 `kb-002#1` 形状)、来源(是不是本轮给过模型的块)、支持(这一块的内容是否真的支持那句话)。今天的 `check_citations` 做前两层,第三层要模型当裁判,放在练习 4。

</details>

2. 阈值 0.01 在数据上的账是什么?它拦不住什么?

<details><summary>答案</summary>

32 条该答的里误拒 1 条(「老板想看所有账但不能让他改」0.006),14 条没答案的里拦下 7 条(分数都在 0.01 以下)。拦不住「沾边但没写」的问题,比如「备份码丢了怎么办」0.593、「试用企业版」0.587,分数和该答的最低几条重叠,因为 rerank 分数衡量的是「像不像」不是「能不能回答」。

</details>

3. 实测里去掉 prompt 里的拒答规则,模型还会不会编?那句规则还有什么用?

<details><summary>答案</summary>

这份知识库、这个模型上,去掉规则也没有编,14 道没答案的题都用自己的话说了「没有关于……」。规则的用处是让拒答变成固定话术,程序才能识别:界面要显示转人工、统计要数拒答率、历史里要标记没答上。严格按话术匹配,没规则时是 14/14 漏、有规则 0/14;宽松按意思匹配,两边都是 0/14。换更弱的模型不一定还这样,所以要用自己的数据测。

</details>

4. 「你好,我想退款」被寒暄规则当成寒暄拦下,根因是什么?怎么改?

<details><summary>答案</summary>

根因是「以寒暄词开头、短、没有疑问词」就算寒暄,判断太松。改法是反过来判断:去掉寒暄词和语气词后什么实质内容都不剩,才算寒暄;「你好,我想退款」去掉后剩「想退款」,放行。测试要两个方向都覆盖,每个误伤例子补进测试集。

</details>

5. (面试题)你的文档问答系统上线后,用户反馈「它有时候会编」。你怎么系统地排查和加固?

<details><summary>答案</summary>

分层排查,每层都量数字:先拿一批真实的坏例子,看检索是否把对的块找回来了(找不回来是检索问题,不是模型编);检索对了,看回答有没有被资料支持(引用核对加模型裁判抽样)。加固三层:生成前,低分直接拒答,阈值要在自己的数据上校准,同时量误拒和漏过,不能只看一个;生成时,提示词要求「资料没写就说没找到」并规定固定话术,让程序能识别;生成后,引用编号逐个核对(格式、是否本轮给过),不合格的删掉或打回重试。同时补评估集:要有沾边但没写的问题,因为这类问题分数高、阈值拦不住,最容易出错。每个措施上线前后,用同一批题对比,而不是凭感觉。

</details>

6. 为什么 `ask` 里把寒暄和低分拒答的结果,分别标成 `small_talk` 和 `refused`,不都标成「拒答」?

<details><summary>答案</summary>

两者含义不同、后续处理不同:寒暄是正常交流,界面不该显示「转人工」,也不该计入拒答率,也不该进历史;拒答表示帮助中心里没有答案,要显示转人工、计入拒答率、进历史让下一轮知道上一句没答上。混在一起,统计和界面都会错。

</details>

## 明天预告

[Day 270](/blog/agent-zero/day-270-docqa-3/):知识地图、面试题和坑清单。项目到今天功能齐了,明天做复盘:先拿 30 条评估集加补的题跑一遍完整的 `DocQA`,出一张成绩单(检索、拒答、引用、费用),再把第四部分(Day 212 到 269)的知识画成一张地图,整理一份面试题和一份真实踩过的坑清单,最后写一段能放进简历的项目说明。
