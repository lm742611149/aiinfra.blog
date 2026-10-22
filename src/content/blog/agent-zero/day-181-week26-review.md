---
title: 'Day 181 · 第 26 周复习:工具与 Agent 循环(Day 175–180)'
description: '这一周从 ReAct 的 Thought 去哪了讲起,经过 Plan-and-Execute、待办清单和反思、思考档位、自洽投票和验证器,最后落到「工具不是 API」。今天画一张知识地图,默写 effort_sweep 的 run_config 和验证器的 unused_months,再只用本周的东西拼一个「先便宜地问三次,意见不一致才开思考」的计费答题器,实测它到底省不省钱。'
pubDate: 2026-10-22
regime: none
tags: ['review', 'reasoning', 'self-consistency', 'agent-zero']
series: 'agent-zero'
day: 181
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 180](/blog/agent-zero/day-180-tool-design-1/) 写了一组把 `ls`、`cat`、`grep` 包了一层的工具,功能完全正确,让 Agent 去找一条会议决定。三遍都答对了,但同一个问题的输入 token 从 15,474 到 78,708 不等,真正有用的信息只有 46 个字符。那一课的结论是:判断工具好不好,看的是模型拿着它干活的代价和稳定性,不是功能对不对。

这一周六课看起来很散,其实一直在问同一个问题:**让模型把事做对,力气该花在哪?** 花在提示词的格式上(ReAct),花在代码结构上(先列计划、待办清单、做完检查),花在模型内部的思考上(思考档位),花在多问几遍上(投票、验证器),最后发现很多时候该花在工具上。今天停一天,把这条线理清楚。

## 今天要解决的问题

学完今天,你应该能:

1. 不看文章,用一张图讲清本周六课各自在哪一层「多花力气」,以及各自的代价。
2. 合上文章默写 Day 178 `effort_sweep.py` 里的 `run_config` 和 Day 179 `verifier.py` 里的 `unused_months`,跑出和文中一致的结果。
3. 用本周的知识拼出 `escalate.py`:关思考先问三次,三票一致就收,不一致再开思考问一次;并且能读懂它的账单,说清它为什么没有比「每题都开 low」更便宜。
4. 说出本周每一个坑(全角冒号、空票 `IndexError`、温度在思考模式下不生效、`medium` 等于 `high`)的现象和修法。

预计用时 3 小时:默写两段各 30 分钟,小项目 1 小时,剩下做练习和自测。前置:[Day 175](/blog/agent-zero/day-175-react-3/) 到 [Day 180](/blog/agent-zero/day-180-tool-design-1/) 全部,代码在 `agent-zero-lab/part03/`,命令都在 `agent-zero-lab/` 根目录跑。今天的实跑按高峰价一共约 ¥0.45(默写一 ¥0.17,小项目 ¥0.17,练习 ¥0.11)。

学法:先对照文章逐行敲一遍(不复制粘贴)并跑通;第二天合上文章,把 `run_config`、`unused_months` 和 `escalate.py` 的 `solve` 再默写一遍;做练习时先自己写,做不出再展开参考答案,看完关掉自己重写一遍。

## 本周知识地图

先看图。横着的是一次 Agent 任务从「模型想」到「工具做」的几层,每一课都在其中一层多加了一点东西。

<figure>
<svg viewBox="0 0 640 330" role="img" aria-label="第 26 周知识地图:六课分别在哪一层多花力气">
  <rect x="0" y="0" width="640" height="330" fill="var(--paper-raised)" rx="6"/>
  <text x="20" y="26" font-family="var(--font-mono)" font-size="13" fill="var(--ink)">让模型把事做对,力气花在哪一层</text>
  <rect x="20" y="44" width="290" height="58" fill="var(--mem-wash)" stroke="var(--mem)" rx="4"/>
  <text x="32" y="64" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">模型内部:想多久</text>
  <text x="32" y="82" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">175 Thought 搬进思维链</text>
  <text x="32" y="96" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">178 thinking 档位 low/high/max</text>
  <rect x="330" y="44" width="290" height="58" fill="var(--mem-wash)" stroke="var(--mem)" rx="4"/>
  <text x="342" y="64" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">模型外部:问几遍</text>
  <text x="342" y="82" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">179 自洽投票 ×N</text>
  <text x="342" y="96" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">179 验证器先筛再投</text>
  <rect x="20" y="122" width="600" height="58" fill="var(--paper)" stroke="var(--rule)" rx="4"/>
  <text x="32" y="142" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">代码结构:怎么排步骤</text>
  <text x="32" y="160" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">176 Plan-and-Execute:先列计划,再逐步执行</text>
  <text x="32" y="174" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">177 待办清单工具 + 做完再检查(反思)</text>
  <rect x="20" y="200" width="600" height="58" fill="var(--compute-wash)" stroke="var(--compute)" rx="4"/>
  <text x="32" y="220" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">工具:模型手里拿的是什么</text>
  <text x="32" y="238" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">180 ACI:使用者是模型,难用 = 贵 + 不稳</text>
  <text x="32" y="252" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">(182–183 改造工具,184 起工具多了怎么办)</text>
  <line x1="20" y1="278" x2="620" y2="278" stroke="var(--rule)"/>
  <text x="20" y="298" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">蓝:每次调用多花输出 token 或调用次数,按次付钱</text>
  <text x="20" y="316" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">琥珀:写一次工具,之后每次调用都省;能用程序算的,最终都该落到这一层</text>
</svg>
<figcaption>本周六课的位置。上面两层(蓝色)是「每次多花一点算力」,代价按次计;最下面一层(琥珀色)是「一次性把模型手里的东西做好」,代价是你写代码的时间。</figcaption>
</figure>

这张图想让你记住一个顺序。Day 178 和 Day 179 的实验都在说:能用程序精确算的东西,与其让模型想得更久、问得更多,不如做成一个工具。Day 180 又补了一句:工具本身也要按「使用者是模型」来设计,否则工具也会让 Agent 又贵又不稳。

## 本周每天一句话

- [Day 175](/blog/agent-zero/day-175-react-3/) · ReAct(三):原生工具调用里看不到 `Thought:` 那一行,它搬去了三个地方:`content` 里那句「我先查一下」、推理模型的思维链、以及你代码里显式的规划步骤。
- [Day 176](/blog/agent-zero/day-176-plan-execute/) · Plan-and-Execute:规划器只调用一次,先把整个计划写出来,执行器按步骤做,解决长任务「走着走着忘了目标」和「每一步都用最贵的模型」两个毛病。
- [Day 177](/blog/agent-zero/day-177-todo-reflection/) · 待办清单和反思:把计划做成一个工具让 Agent 自己维护,返回值里直接告诉它「下一项是什么」;做完再检查一遍。三步以内的任务不需要这些,步骤固定的流程直接用代码写死。
- [Day 178](/blog/agent-zero/day-178-thinking-budget/) · 推理预算:DeepSeek 的 `thinking` 开关和 `reasoning_effort` 档位,思考 token 算在 `completion_tokens` 里按输出价收钱;在云簿计费难题上 low 就到顶,max 贵了将近一倍却没有更准。
- [Day 179](/blog/agent-zero/day-179-self-consistency/) · 自洽投票和 best-of-N:同一题问五遍按答案计票,或者先用程序验证器筛掉错的再投;实测加一句「先写推导」比投五票便宜得多,投票真正的用处是给出置信度。
- [Day 180](/blog/agent-zero/day-180-tool-design-1/) · 好工具(一):工具的使用者从程序员变成了模型,ACI 的视角是看模型拿着它能不能又快又省地办成事;读轨迹,不只看最终回答。

如果哪一句你读完没反应过来是什么意思,回到那一天把正文最后一节再看一遍,今天后面的内容都要用到。

## 默写一:effort_sweep 的 run_config

第一段默写的是 [Day 178](/blog/agent-zero/day-178-thinking-budget/) 那个实验的核心:一套带标准答案的题,用某一种思考配置全部问一遍,统计对了几道、平均输出多少 token、其中多少是思考、平均耗时、花了多少钱。上线前给自己的任务选档,就是把这个函数换几种配置各跑一遍。

先合上 Day 178,自己在空白处写出 `run_config` 函数体,写完再对照下面的版本。文件开头的 `import`、`SYSTEM`、`CONFIGS`、`parse`、`is_right` 不用默写,直接用 Day 178 的。

```python
# agent-zero-lab/part03/effort_sweep.py  (Day 178 建的,默写的是 run_config 这一段)
def run_config(name: str, kw: dict[str, Any]) -> None:
    llm = LLMClient()

    def ask(q: str) -> ChatResult:
        return llm.chat([{"role": "system", "content": SYSTEM}, {"role": "user", "content": q}], **kw)

    with ThreadPoolExecutor(max_workers=4) as pool:
        results = list(pool.map(ask, [q for q, _ in QUESTIONS]))
    wrong = [i for i, (r, (_, gold)) in enumerate(zip(results, QUESTIONS), 1) if not is_right(r, gold)]
    n = len(QUESTIONS)
    out = sum(r.completion_tokens for r in results) / n
    think = sum(r.reasoning_tokens for r in results) / n
    lat = sum(r.latency for r in results) / n
    print(f"{name:6} 对 {n - len(wrong)}/{n} | 输出 {out:5.0f} tok(思考 {think:5.0f})"
          f" | 耗时 {lat:4.1f}s | ¥{llm.ledger.cost:.4f} | 错题 {wrong}")
```

<div class="line-notes">

- `def run_config(name: str, kw: dict[str, Any]) -> None:` `name` 只用来打印,`kw` 是要透传给 `chat` 的参数,比如 low 那一档是 `{"extra_body": {"thinking": {"type": "enabled"}}, "reasoning_effort": "low"}`。
- `llm = LLMClient()` 每种配置新建一个客户端,账本 `ledger` 从 0 开始,最后打印的花费就只是这一档的。我第一次默写时把它放到函数外面,结果第二档的花费把第一档也算进去了。
- `def ask(q: str) -> ChatResult:` 函数里面再定义一个函数,它能直接用外层的 `llm` 和 `kw`,相当于 JS 里在函数里写一个箭头函数用外层变量(闭包)。
- `return llm.chat([{"role": "system", "content": SYSTEM}, {"role": "user", "content": q}], **kw)` `**kw` 把字典拆成关键字参数,相当于 JS 的展开 `{...kw}` 再按名字传进去。忘了写这两个星号,所有配置都会跑成 `.env` 里默认的关思考,五行结果的思考 token 全是 0,这是默写时最容易犯的错。
- `with ThreadPoolExecutor(max_workers=4) as pool:` 最多 4 道题同时问,总耗时接近最慢的那几道,不是全部加起来。
- `results = list(pool.map(ask, [q for q, _ in QUESTIONS]))` `pool.map` 保证结果顺序和题目顺序一致,下一行才能按位置对上标准答案。`[q for q, _ in QUESTIONS]` 只取每个二元组的题目,`_` 是「这个位置我不要」的习惯写法。
- `wrong = [i for i, (r, (_, gold)) in enumerate(zip(results, QUESTIONS), 1) if not is_right(r, gold)]` 一行里三件事:`zip` 把结果和题目一对一配好,`enumerate(..., 1)` 加上从 1 开始的题号,`if not is_right` 只留下错题号。今天难题这一档跑出来是 `[]`。
- `out = sum(r.completion_tokens for r in results) / n` 平均每题输出 token,思考也算在里面。今天难题上关思考是 320,low 是 1124。
- `think = sum(r.reasoning_tokens for r in results) / n` 输出里有多少是思考,用的是 Day 178 给 `ChatResult` 加的字段。关思考是 0,low 是 1002。
- `lat = sum(r.latency for r in results) / n` 平均每题耗时,关思考 2.0 秒,low 5.6 秒。
- `print(f"{name:6} 对 {n - len(wrong)}/{n}` `{name:6}` 把名字补到 6 个字符宽,几行对齐好读。注意中文字符也只按 1 个宽度算,所以「关思考」那行看起来会比别的行宽一点。

</div>

默写完先跑语法检查 `uv run basedpyright part03/effort_sweep.py`,应该是 `0 errors`。然后在难题和陷阱题上各跑关思考和 low 两档:

```bash
# 在 agent-zero-lab/ 下跑
QUIZ=hard uv run python -m part03.effort_sweep 关思考 low
QUIZ=trap uv run python -m part03.effort_sweep 关思考 low
```

<div class="line-notes">

- `QUIZ=hard uv run python -m part03.effort_sweep 关思考 low` 命令前面的 `QUIZ=hard` 只对这一条命令设置环境变量,脚本里 `os.environ.get("QUIZ", "basic")` 读到它就选难题。后面两个词进 `sys.argv[1:]`,只跑这两档。
- `QUIZ=trap uv run python -m part03.effort_sweep 关思考 low` 陷阱题是 Day 179 加的 6 道退款题。

</div>

今天的输出:

```text
关思考    对 8/8 | 输出   320 tok(思考     0) | 耗时  2.0s | ¥0.0239 | 错题 []
low    对 8/8 | 输出  1124 tok(思考  1002) | 耗时  5.6s | ¥0.0757 | 错题 []
关思考    对 6/6 | 输出   320 tok(思考     0) | 耗时  2.0s | ¥0.0177 | 错题 []
low    对 6/6 | 输出   970 tok(思考   855) | 耗时  4.9s | ¥0.0492 | 错题 []
```

和 Day 178 的表比,数字都落在当时量出的范围里:关思考每题输出 271–384,low 919–1,041(这次 1124 略高一点,档位是倾向不是上限)。这次关思考两套题全对,但 Day 178 五遍里有三遍不是 8/8。**只跑一遍就说「关思考够用」是不行的**,这一点下面的小项目会再碰到一次。

## 默写二:验证器的 unused_months

第二段是 [Day 179](/blog/agent-zero/day-179-self-consistency/) 的规则验证器。它只做一件事:根据题目里的两个日期,用程序数出「未使用的整月数」,再去检查模型写的那一行对不对。这段代码不调模型,默写错了马上就能看出来。

```python
# agent-zero-lab/part03/verifier.py  (Day 179 建的,默写这三个函数)
DATE_RE = re.compile(r"(\d{4})-(\d{2})-\d{2}")
MONTHS_RE = re.compile(r"未使用月数[:：]\s*(\d+)")


def month_index(year: int, month: int) -> int:
    return year * 12 + (month - 1)  # 把年月压成一个整数,相减就是差几个月


def unused_months(question: str) -> int:
    dates = [(int(y), int(m)) for y, m in DATE_RE.findall(question)]
    start, apply = dates[0], dates[-1]  # 第一个日期是开始,最后一个是申请退款
    end = month_index(*start) + 12  # 年付覆盖 12 个月,end 是下一年同月(不含)
    return max(0, end - month_index(*apply) - 1)  # 申请当月不算


def check(question: str, text: str) -> bool:
    found = MONTHS_RE.findall(text)
    return bool(found) and int(found[-1]) == unused_months(question)
```

<div class="line-notes">

- `DATE_RE = re.compile(r"(\d{4})-(\d{2})-\d{2}")` 匹配 `2026-03-01` 这种日期,只把年和月放进括号(捕获组),日不要,因为退款只按整月算。
- `MONTHS_RE = re.compile(r"未使用月数[:：]\s*(\d+)")` 方括号里一个半角冒号、一个全角冒号。Day 179 第一次只写了半角,验证器把对的答案当错的拒掉,这就是本周最隐蔽的坑。
- `return year * 12 + (month - 1)` 把「哪年哪月」换成「从公元 0 年 1 月起第几个月」。实测 `month_index(2026, 3)` 是 24314,`month_index(2026, 11)` 是 24322,差 8 个月。
- `dates = [(int(y), int(m)) for y, m in DATE_RE.findall(question)]` `findall` 有两个捕获组时,每个匹配返回一个二元组,比如 `[('2026', '03'), ('2026', '11')]`,再转成整数。
- `start, apply = dates[0], dates[-1]` `[-1]` 是最后一个,相当于 JS 的 `arr.at(-1)`。陷阱题第 6 题里有三个日期(开始、申请降级、申请退款),所以要取最后一个而不是第二个。
- `end = month_index(*start) + 12` `*start` 把二元组拆成两个位置参数,相当于 JS 的 `monthIndex(...start)`。
- `return max(0, end - month_index(*apply) - 1)` 3 月开始、11 月申请:24326 − 24322 − 1 = 3,未使用的是 12 月、1 月、2 月。`max(0, ...)` 防止申请日期已经过了一年时算出负数。
- `return bool(found) and int(found[-1]) == unused_months(question)` 没写这一行(`found` 是空列表)直接 `False`;写了好几次就看最后一次。

</div>

运行 `uv run python -m part03.verifier`,跑的是文件底部 `if __name__ == "__main__":` 那段自检(Day 179 写的,不用默写):

```text
3 792.35 专业版年付,2026-03-01 开始,2026-11-15
5 4412.25 企业版年付,2026-07-01 开始,2027-01-10
11 4938.98 专业版年付 2 个席位,首年用了 85 折券,2026-05
0 0.0 企业版年付,2026-10-01 开始,2027-09-30
0 0.0 专业版年付,用了 9 折券,2026-01-01 开始,20
6 10589.4 企业版年付 2 个席位,2026-04-01 开始。2026
True False False
```

每行第一个数是程序数出的未使用月数,第二个是标准答案。最后一行三个布尔值是对第 5 题的三种回答的检查结果:写对月数 0 通过,写成 1 不通过,没写月数这一行也不通过。和 Day 179 对得上,默写就过关了。

## 小项目:先便宜地问三次,不一致再开思考

### 想法

Day 178 和 Day 179 各自得出了一个结论,放在一起就是一个很自然的想法:

- 关思考便宜,大部分题单次就对,但偶尔在陷阱题上错;
- 投票的票型本身是一个置信度信号,3 票全中和 2 比 1 是两回事。

那能不能**先用关思考问三次,三票一致就直接收,不一致说明这题模型拿不准,再开思考问一次**?这种「先用便宜的方案,拿不准再升级到贵的」的做法有个通用的名字,叫**级联**(cascade),客服系统里「机器人答不了转人工」也是同一个思路。我们期望它准确率接近每题都开思考,花费接近关思考。

只用本周的零件就能拼出来:Day 178 的 `SYSTEM`、`parse`、`CONFIGS`,Day 179 的 `Counter` 计票,Day 179 题库里的难题和陷阱题。

### 代码

```python
# agent-zero-lab/part03/escalate.py  第 26 周小项目:先关思考问 3 次,意见一致就收,不一致再开思考问一次
from collections import Counter
from concurrent.futures import ThreadPoolExecutor

from common.llm import LLMClient
from part03.billing_quiz import QUIZ_HARD, QUIZ_TRAP
from part03.effort_sweep import CONFIGS, SYSTEM, parse

QUESTIONS = QUIZ_HARD + QUIZ_TRAP
cheap, smart = LLMClient(), LLMClient()  # 两个账本分开记,最后能看出钱花在哪


def ask(llm: LLMClient, q: str, **kw: object) -> float | None:
    msgs = [{"role": "system", "content": SYSTEM}, {"role": "user", "content": q}]
    return parse(llm.chat(msgs, **kw).content)


def solve(q: str) -> tuple[float | None, str]:
    answers = [ask(cheap, q, temperature=1.0) for _ in range(3)]
    votes = Counter(round(a, 2) for a in answers if a is not None)
    top = votes.most_common(1)
    if top and top[0][1] == 3:
        return top[0][0], "3 票一致"
    return ask(smart, q, **CONFIGS["low"]), f"升级 low,关思考给的是 {answers}"


if __name__ == "__main__":
    with ThreadPoolExecutor(max_workers=7) as pool:
        rows = list(pool.map(solve, [q for q, _ in QUESTIONS]))
    right = 0
    for i, ((_, gold), (got, how)) in enumerate(zip(QUESTIONS, rows), 1):
        ok = got is not None and abs(got - gold) < 0.011
        right += ok
        print(f"第 {i:2} 题 {'对' if ok else '错'} | 标准 {gold} 得到 {got} | {how}")
    print(f"对 {right}/{len(QUESTIONS)}")
    print("关思考:", cheap.ledger)
    print("开思考:", smart.ledger)
    print(f"合计 ¥{cheap.ledger.cost + smart.ledger.cost:.4f}")
```

<div class="line-notes">

- `from part03.effort_sweep import CONFIGS, SYSTEM, parse` 三个零件都是 Day 178 的:`CONFIGS` 里有 low 那一档的参数,`SYSTEM` 是计费规则加「最后一行写答案:金额」,`parse` 从正文里抠最后一个答案。
- `QUESTIONS = QUIZ_HARD + QUIZ_TRAP` 两个列表相加就是拼接,相当于 JS 的 `[...a, ...b]`。8 道难题加 6 道陷阱题,一共 14 道。
- `cheap, smart = LLMClient(), LLMClient()  # 两个账本分开记` 两个客户端用的是同一个模型、同一个 key,区别只在于各自的 `ledger`。这样最后能分开看「投票花了多少」「升级花了多少」。
- `def ask(llm: LLMClient, q: str, **kw: object) -> float | None:` `**kw` 收下所有额外的关键字参数(比如 `temperature=1.0`),原样转交给 `chat`。返回解析出的金额,抠不出来是 `None`。
- `answers = [ask(cheap, q, temperature=1.0) for _ in range(3)]` 关思考、温度 1 问三次。这三次是顺序发的,外面已经有 7 道题在并发,里面再并发就太乱了。温度只在关思考时有效,Day 178 练习 4 实测过。
- `votes = Counter(round(a, 2) for a in answers if a is not None)` 去掉 `None` 再计票,`round(a, 2)` 防止 `4938.98` 和 `4938.980000001` 被当成两个答案。
- `top = votes.most_common(1)` 不直接写 `[0]`。三次全是 `None` 时 `most_common(1)` 是空列表,取 `[0]` 会 `IndexError`,练习 3 会故意演示一次。
- `if top and top[0][1] == 3:` `top[0]` 是 `(答案, 票数)`,`[1]` 取票数。必须三票全中才收,2 比 1 也算「拿不准」。
- `return ask(smart, q, **CONFIGS["low"]), f"升级 low,关思考给的是 {answers}"` 拿不准就用 low 档再问一次,直接用它的答案,不再参考那三票。返回第二个值是一句说明,打印出来方便读轨迹。
- `with ThreadPoolExecutor(max_workers=7) as pool:` 7 道题同时跑,14 道两批就完了。
- `right += ok` 布尔值可以直接加,`True` 当 1,`False` 当 0,和 JS 里 `true + 0 === 1` 一样。
- `print(f"合计 ¥{cheap.ledger.cost + smart.ledger.cost:.4f}")` 两个账本加起来才是这个方案的总花费。

</div>

运行 `uv run python -m part03.escalate`:

```text
第  1 题 对 | 标准 1347.37 得到 1347.37 | 3 票一致
第  2 题 对 | 标准 18531.45 得到 18531.45 | 3 票一致
第  3 题 对 | 标准 65.65 得到 65.65 | 3 票一致
第  4 题 对 | 标准 2377.05 得到 2377.05 | 升级 low,关思考给的是 [2377.05, 2641.17, 2377.05]
第  5 题 对 | 标准 1500.17 得到 1500.17 | 3 票一致
第  6 题 对 | 标准 791.47 得到 791.47 | 升级 low,关思考给的是 [791.47, 791.47, 226.7]
第  7 题 对 | 标准 1031.14 得到 1031.14 | 3 票一致
第  8 题 对 | 标准 1954.75 得到 1954.75 | 3 票一致
第  9 题 对 | 标准 792.35 得到 792.35 | 升级 low,关思考给的是 [792.35, 1056.47, 792.35]
第 10 题 对 | 标准 4412.25 得到 4412.25 | 3 票一致
第 11 题 对 | 标准 4938.98 得到 4938.98 | 升级 low,关思考给的是 [4938.98, 4940.22, 4939.04]
第 12 题 对 | 标准 0.0 得到 0.0 | 升级 low,关思考给的是 [0.0, 0.0, 9706.95]
第 13 题 对 | 标准 0.0 得到 0.0 | 升级 low,关思考给的是 [237.71, 0.0, 0.0]
第 14 题 对 | 标准 10589.4 得到 10589.4 | 3 票一致
对 14/14
关思考: 42 次调用 | 输入 13845 / 输出 13744 tokens | 约 ¥0.1271
开思考: 6 次调用 | 输入 2108 / 输出 5264 tokens | 约 ¥0.0448
合计 ¥0.1719
```

### 读结果:准了,但没省钱

准确率是 14/14,而且升级的 6 道题里,关思考三票中多数票其实都是对的(第 4、6、9、12、13 题都是 2 比 1 对),只有第 11 题三个答案各不相同。所以这一遍里升级没有「救回」任何一道题,它只是在模型拿不准的时候多上了一道保险。

再看钱。把同样 14 道题「每题都开 low 问一次」的花费从默写一的输出里加起来:¥0.0757 + ¥0.0492 = ¥0.1249。我们的级联方案花了 ¥0.1719,**反而贵了 38%**。

为什么?算一下每次调用的输出就清楚了。关思考那 42 次一共输出 13,744 个 token,平均每次 327 个;low 那 6 次平均每次 877 个。三次关思考的输出加起来(约 980)已经和一次 low(约 900 到 1,100)差不多了,再加上一半的题还要升级,当然更贵。输入那边也是三倍:每次都要把 300 多 token 的计费规则再发一遍。

这个结果和我开工前的直觉相反,但它把 Day 179 的结论又验证了一遍:**投票的成本是线性的,问三次就是三倍**。只有在单次调用很便宜、而升级档很贵的时候(比如便宜的是一个小模型,贵的是旗舰模型,单价差十几倍),级联才省钱。同一个模型里,关思考和 low 的单价是一样的,差别只在输出长度,投三票就把这个差距吃掉了。

那这个方案就没用了吗?也不是。它多给了你一样东西:**每道题都带着一个「拿不准」的标记**。第 11 题三个答案各不相同,这种题在真实客服里应该直接转人工复核,而不是悄悄换个档位给出一个答案。练习 2 会把投票次数压到两次,看看能省多少。

### 零件对照

| 零件 | 出自 | 在 escalate.py 的哪一段 |
| --- | --- | --- |
| `SYSTEM`、`parse`、答案的全角半角冒号 | Day 178 `effort_sweep.py` | `ask` |
| `CONFIGS["low"]`(`extra_body` 开思考 + `reasoning_effort`) | Day 178 | `solve` 的最后一行 |
| 关思考才能用温度制造差异 | Day 178 练习 4 | `ask(cheap, q, temperature=1.0)` |
| `Counter` 计票、`round` 归一 | Day 179 `vote_min.py` | `votes = Counter(...)` |
| 空票不能直接取 `[0]` | Day 179 `vote_min.py` 的说明 | `top = votes.most_common(1)` 和 `if top` |
| 投票的票型当置信度 | Day 179「和思考档位放在一起比」 | `top[0][1] == 3` |
| 两个账本分开算钱 | Day 124、Day 178 | `cheap`、`smart` |

## 本周错题与坑清单

| 现象 | 病因 | 修法 | 出处 |
| --- | --- | --- | --- |
| 原生工具调用的日志里找不到 `Thought:` | Thought 搬到了 `content`、思维链和你的规划代码里 | 想看理由就在 system 里要求「调用工具前用一句话说明理由」 | Day 175 |
| 关思考配 `reasoning_effort="high"` 一点都不想 | `thinking` 开关和档位冲突时以开关为准 | 上线前用最便宜的问题把每种组合跑一遍,看 `reasoning_tokens` | Day 178 |
| 传 `medium` 和 `high` 的思考长度一样 | DeepSeek 只有 low/high/max 三档,`medium` 被映射成 `high` | 换厂商重跑 sweep,别按名字推断效果 | Day 178 |
| `AttributeError: 'NoneType' object has no attribute 'reasoning_tokens'` | 关思考时 `usage.completion_tokens_details` 是 `None` | 先判空再取,写成 `_reasoning_tokens` | Day 178 |
| 开思考时设 `temperature=0`,三次输出还是不一样 | 思考模式下温度可以传但不生效 | 投票一律在关思考下做 | Day 178 练习 4 |
| 验证器只放行 2/5,可答案全对 | 正则只认半角冒号,模型写了全角「：」还加了 `**` | 方括号里写两个冒号;结果反直觉时先打印被拒的原文 | Day 179 |
| `IndexError: list index out of range` | 全部答案解析失败,`most_common(1)` 是空列表 | 先判断列表非空 | Day 179、今天练习 3 |
| 只多要一行「未使用月数」,准确率从 83% 掉到 44% | 模型把推导省了 | 提示词改一句就重跑评测 | Day 179 |
| 坏工具三遍都答对,输入 token 差五倍 | 工具成本取决于模型碰巧怎么用它 | 读轨迹;多跑几遍看范围 | Day 180 |
| 搜「30天」搜不到「30 天」 | 逐字匹配,描述里也没说 | 搜索做空格宽容,并在描述里写清匹配方式(Day 182) | Day 180 |
| 级联方案准确率够了,却比每题开 low 还贵 | 同一个模型里投三票的输出已经抵得上一次 low | 投票留给「要置信度」的场景;省钱要靠单价差大的两档 | 今天 |

## 动手练习

### 练习 1:默写 parse,再测三个边界

不看 Day 178,默写 `ANS_RE` 和 `parse`,然后用下面三段文字测一下:`'答案：1,500.17'`(全角冒号加千分位)、`'**答案:1500.17**'`(markdown 加粗)、`'退款 1500.17 元'`(没按格式写)。先猜每个会解析出什么,再运行。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part03/effort_sweep.py  (Day 178 建的,默写这两处)
ANS_RE = re.compile(r"答案[:：]\s*(-?[\d.]+)")


def parse(text: str) -> float | None:
    found = ANS_RE.findall(text.replace(",", ""))
    return float(found[-1]) if found else None
```

<div class="line-notes">

- `ANS_RE = re.compile(r"答案[:：]\s*(-?[\d.]+)")` `[:：]` 两种冒号都认;`\s*` 允许冒号后面有空格;`-?` 允许负数;`[\d.]+` 是数字和小数点组成的一串。
- `found = ANS_RE.findall(text.replace(",", ""))` 先把千分位逗号去掉,`1,500.17` 变成 `1500.17` 才能被 `[\d.]+` 整个匹配到。不去掉的话只会抠出 `1`。
- `return float(found[-1]) if found else None` 取最后一个,因为推导过程里可能出现「答案:先算月价」之类的字样,最后一行才是最终答案。

</div>

在 `agent-zero-lab/` 下运行:

```bash
uv run python -c "
from part03.effort_sweep import parse
print(parse('答案：1,500.17'), parse('**答案:1500.17**'), parse('退款 1500.17 元'))"
```

<div class="line-notes">

- `from part03.effort_sweep import parse` 导入时 `effort_sweep.py` 顶层代码会执行一遍,但真正跑实验的部分在 `if __name__ == "__main__":` 里面,不会被触发,所以不花钱。

</div>

```text
1500.17 1500.17 None
```

全角冒号加千分位、markdown 加粗都能解析,因为 `**` 在「答案」前面和数字后面,不挡正则。没按格式写的返回 `None`,在投票里会被过滤掉,在 `run_config` 里会被判成错题。这正是我们想要的:格式不对宁可判错,也不去猜文中哪个数字是答案。

</details>

### 练习 2:只问两次的级联

把 `escalate.py` 的 `solve` 改成只问两次:两次答案一样就收,不一样直接升级 low。写成 `escalate_ex1.py`,复用 `escalate.py` 里的 `ask`、`cheap`、`smart`。跑一遍,和三票版、每题开 low 比一下花费。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part03/escalate_ex1.py  练习 2:只问 2 次,两次一样就收,不一样直接升级
from concurrent.futures import ThreadPoolExecutor

from part03.billing_quiz import QUIZ_HARD, QUIZ_TRAP
from part03.effort_sweep import CONFIGS
from part03.escalate import ask, cheap, smart

QUESTIONS = QUIZ_HARD + QUIZ_TRAP


def solve2(q: str) -> tuple[float | None, str]:
    a, b = ask(cheap, q, temperature=1.0), ask(cheap, q, temperature=1.0)
    if a is not None and b is not None and round(a, 2) == round(b, 2):
        return a, "2 票一致"
    return ask(smart, q, **CONFIGS["low"]), f"升级 low,关思考给的是 {[a, b]}"


if __name__ == "__main__":
    with ThreadPoolExecutor(max_workers=7) as pool:
        rows = list(pool.map(solve2, [q for q, _ in QUESTIONS]))
    right = sum(got is not None and abs(got - gold) < 0.011 for (_, gold), (got, _) in zip(QUESTIONS, rows))
    up = sum(how.startswith("升级") for _, how in rows)
    print(f"对 {right}/{len(QUESTIONS)} | 升级 {up} 题")
    print("关思考:", cheap.ledger)
    print("开思考:", smart.ledger)
    print(f"合计 ¥{cheap.ledger.cost + smart.ledger.cost:.4f}")
```

<div class="line-notes">

- `from part03.escalate import ask, cheap, smart` 导入的是同一个模块里的对象,所以 `cheap` 和 `smart` 的账本也是那两个。`escalate.py` 的主程序在 `if __name__` 里,导入时不会跑。
- `a, b = ask(cheap, q, temperature=1.0), ask(cheap, q, temperature=1.0)` 两次就够判断「一不一样」,三票版第三票的作用只是分出 2 比 1,而我们本来就把 2 比 1 当成拿不准。
- `if a is not None and b is not None and round(a, 2) == round(b, 2):` 两个都解析成功并且相等才收。`None == None` 在 Python 里是 `True`,所以必须先排除 `None`,否则两次都没按格式写也会被当成「一致」。
- `right = sum(got is not None and abs(got - gold) < 0.011 for (_, gold), (got, _) in zip(QUESTIONS, rows))` 生成器表达式里直接对布尔值求和,数出对了几道。
- `up = sum(how.startswith("升级") for _, how in rows)` 数一下升级了几道题,`startswith` 相当于 JS 的同名方法。

</div>

运行 `uv run python -m part03.escalate_ex1`:

```text
对 14/14 | 升级 4 题
关思考: 28 次调用 | 输入 9230 / 输出 8692 tokens | 约 ¥0.0810
开思考: 4 次调用 | 输入 1390 / 输出 3705 tokens | 约 ¥0.0314
合计 ¥0.1124
```

三种做法放在一起:

| 做法 | 对 | 花费 | 能给出「拿不准」标记吗 |
| --- | --- | --- | --- |
| 三票级联(escalate.py) | 14/14 | ¥0.1719 | 能,6 题 |
| 两票级联(escalate_ex1.py) | 14/14 | ¥0.1124 | 能,4 题 |
| 每题开 low 一次(默写一的两行相加) | 14/14 | ¥0.1249 | 不能 |

两票版比每题开 low 便宜了大约 10%,还多了「拿不准」的标记,这才算是一个说得过去的方案。差距很小,换一套题或者多跑几遍就可能反过来,所以结论不是「两票级联更省」,而是:**级联在同一个模型的两档之间,省不了多少钱,它的价值在置信度。**

</details>

### 练习 3:故意让投票崩一次

把 [Day 179](/blog/agent-zero/day-179-self-consistency/) `vote_min.py` 里 `winner, count = votes.most_common(1)[0]` 这一行单独拿出来,喂给它三个 `None`(模拟三次都没按格式写答案),看报什么错。然后写一个不会崩的 `majority`,空票时返回 `None`。

<details><summary>参考答案</summary>

先制造报错,在 `agent-zero-lab/` 下运行:

```bash
uv run python -c "
from collections import Counter
votes = Counter(a for a in [None, None, None] if a is not None)
print(votes.most_common(1))
winner, count = votes.most_common(1)[0]
"
```

<div class="line-notes">

- `votes = Counter(a for a in [None, None, None] if a is not None)` 三个 `None` 全被过滤掉,`votes` 是空的 `Counter()`。
- `print(votes.most_common(1))` 先把中间结果打出来,看清楚它是空列表,而不是 `None`。
- `winner, count = votes.most_common(1)[0]` 对空列表取 `[0]`。

</div>

```text
[]
Traceback (most recent call last):
  File "<string>", line 5, in <module>
    winner, count = votes.most_common(1)[0]
                    ~~~~~~~~~~~~~~~~~~~~^^^
IndexError: list index out of range
```

`list index out of range` 就是 JS 里 `arr[0]` 拿到 `undefined`,只是 Python 直接抛错而不是悄悄给你一个空值。修法就是 Day 179 `vote_sweep.py` 里那个 `majority`:

```python
# agent-zero-lab/part03/vote_sweep.py  (Day 179 建的 majority,默写一遍)
def majority(answers: list[float | None]) -> float | None:
    votes = Counter(round(a, 2) for a in answers if a is not None)
    return votes.most_common(1)[0][0] if votes else None
```

<div class="line-notes">

- `votes = Counter(round(a, 2) for a in answers if a is not None)` 和上面一样先过滤再计票。
- `return votes.most_common(1)[0][0] if votes else None` 空的 `Counter` 在 `if` 里当假,相当于 JS 里先判断 `map.size > 0`。有票才取 `[0][0]`(第一项的答案),没票返回 `None`,交给调用方决定怎么办,比如升级或者转人工。

</div>

用 `uv run python -c "from part03.vote_sweep import majority; print(majority([None, None]), majority([1.0, 2.0, 2.0]))"` 验证,输出 `None 2.0`。注意 `vote_sweep.py` 顶层会创建一个 `LLMClient`,但不会发请求,不花钱。

</details>

**验收标准:** 默写的 `run_config` 跑出和文中同一量级的四行结果;`unused_months` 自检七行和文中一致;`escalate.py` 和 `escalate_ex1.py` 都能跑通,并且你能用一句话说清「三票级联为什么比每题开 low 贵」(三次关思考的输出 token 已经和一次 low 差不多)。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 级联(cascade) | 先用便宜的方案处理,判断拿不准时再交给贵的方案。今天是「关思考投三票,不一致再开 low」,客服里「机器人答不了转人工」也是级联 |
| 置信度 | 对一个答案有多大把握。投票里 3 票全中比 2 比 1 置信度高,可以用它决定要不要升级或转人工 |
| 升级 | 级联里从便宜那一档换到贵的那一档 |
| 闭包 | 函数里定义的函数能用外层函数的变量,`run_config` 里的 `ask` 用了外层的 `llm` 和 `kw`。JS 里的闭包是同一个东西 |
| `**kw` | 定义函数时收下所有额外的关键字参数,调用时把字典拆成关键字参数,类似 JS 的对象展开 |
| 自检段 | 写在 `if __name__ == "__main__":` 下面的几行测试,直接运行文件才执行,被别的文件导入时不执行([Day 32](/blog/agent-zero/day-032-modules/)) |

本周第一次出现、现在要会的术语(推理预算、`reasoning_tokens`、档位映射、自洽投票、best-of-N、验证器、假阴性、ACI、读轨迹)都在对应那一天的名词表里,复习时回去对一遍。

## 常见误区

**以为级联一定省钱。** 今天的三票级联比每题开 low 贵了 38%。级联省钱的前提是两档的单价差得够大,比如小模型和旗舰模型;同一个模型的关思考和 low 单价一样,投三票就把差距吃掉了。

**升级后把三票和新答案再合起来投。** 升级就是因为三票不可信,再把它们拉进来一起投,等于让不可信的票去推翻思考过的答案。升级后直接用新答案,三票只用来当「拿不准」的信号。

**默写时漏了 `**kw`。** 漏了不报错,所有配置都会跑成 `.env` 里默认的关思考,五行的思考 token 全是 0。看到这种结果先查参数有没有传进去。

**把 `LLMClient()` 放在循环外面共用。** 账本会累加,第二档打印的花费包含了第一档。想分开算钱就分开建客户端,或者每档开始前记下账本的数。

**只跑一遍就下结论。** 今天关思考在难题上 8/8,Day 178 五遍里有三遍不是。今天级联里升级的 6 道题,换一遍可能是另外 4 道。说一个方案好不好,至少跑三遍看范围。

**复习只看不写。** 本周的代码看着都不长,但 `zip` 套 `enumerate` 套解包那一行,`month_index` 为什么要减 1,不自己写一遍是记不住的。默写写不出来的地方,就是明天要回去重看的地方。

## 学习资料

### 文档与文章

- [Anthropic · Building effective agents](https://www.anthropic.com/research/building-effective-agents):讲 workflow 和 agent 的区别、evaluator-optimizer 等模式,正好把本周的规划、反思和明天的工具设计串起来。复习日重读一遍,20 分钟,英文。
- [Self-Consistency 论文](https://arxiv.org/abs/2203.11171)(Wang 等,2022):Day 179 投票的出处,只看摘要和第 2 节的方法图就够,英文。
- [ReAct 论文](https://arxiv.org/abs/2210.03629)(Yao 等,2022):这一部分 ReAct 三课的原始材料,复习时看第 2 节的 Thought/Action/Observation 例子,对照 Day 175 讲的「Thought 搬去哪了」,英文。
- [Reflexion 论文](https://arxiv.org/abs/2303.11366)(Shinn 等,2023):Day 177 反思那一节提到的论文,看摘要知道「失败后写一段反思再试」是怎么回事就行,英文。
- [DeepSeek · 思考模式](https://api-docs.deepseek.com/zh-cn/guides/thinking_mode):开关、档位映射、思考模式下哪些参数不生效。复习本周坑清单时对照着看,中文。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV15aoYBfEor&autoplay=0&high_quality=1" title="《浅入深出》Agent系列之五：ReAct, plan and Execute, Reflection" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>奇创喵 · 《浅入深出》Agent系列之五:ReAct, plan and Execute, Reflection · 19 分钟,把本周前半段的三种做法放在一起讲,适合复习日从头看一遍,对照今天的知识地图。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV18opC6YEkD&autoplay=0&high_quality=1" title="思维链CoT的增强方案,Self-Consistency怎么做?" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>图灵AI大模型 · 思维链CoT的增强方案,Self-Consistency怎么做? · 5 分钟,Day 179 推荐过,复习时再看一遍,重点是投票什么时候失效。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/MG9oqntiJKg" title="AI Won’t Plateau — if We Give It Time To Think | Noam Brown | TED" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>TED · Noam Brown · AI Won't Plateau — if We Give It Time To Think · 十几分钟,讲「推理时多花算力」从扑克 AI 到推理模型的来历,把 Day 178 和 Day 179 两种花算力的方式放到一个更大的背景里,英文可开字幕。</figcaption>
</figure>

### 书籍

- Chip Huyen《AI Engineering》(O'Reilly, 2025):第 6 章 Agents 里讲规划、反思和工具选择的部分,本周六课的内容在这一章里都有,复习日适合整章读一遍,英文。

### 开源项目与代码

- [SWE-agent/mini-swe-agent](https://github.com/SWE-agent/mini-swe-agent):一百来行的 Agent 循环,复习完本周后看它的主循环,对照 Day 170 的 `run_agent` 和 Day 180 的 ACI 视角,看它给模型的工具和反馈有多简单。

## 自测

1. 本周六课分别在哪一层多花力气?哪两课的代价是按每次调用计的?

<details><summary>答案</summary>

模型内部想多久:Day 175(Thought 搬进思维链)、Day 178(思考档位);模型外部问几遍:Day 179(投票、验证器);代码结构:Day 176(先列计划)、Day 177(待办清单和反思);工具:Day 180(ACI)。按每次调用计价的是思考档位(多出来的思考 token)和投票(多出来的调用次数),工具改好之后是每次都省。

</details>

2. `run_config` 里漏写 `**kw` 会怎样?怎么一眼看出来?

<details><summary>答案</summary>

不报错,但所有配置都只发了 `messages`,按 `.env` 里默认的关思考跑。结果是五行的「思考」都是 0,输出 token 都在三四百,看起来五种配置一模一样。看到这种结果先检查参数有没有传进 `chat`。

</details>

3. `unused_months` 为什么要 `dates[-1]` 而不是 `dates[1]`?

<details><summary>答案</summary>

有的题里不止两个日期,比如陷阱题第 6 题有开始、申请降级、申请退款三个日期,退款按最后一个申请日算。取 `[1]` 会拿成降级日期,算出来的月数就错了。

</details>

4. 今天的三票级联准确率 14/14,为什么说它没达到目的?

<details><summary>答案</summary>

目的是「准确率接近每题开思考,花费接近关思考」。准确率达到了,花费却是 ¥0.1719,比每题开 low 的 ¥0.1249 还贵。原因是同一个模型里关思考和 low 单价一样,三次关思考的输出 token(约 980)已经和一次 low 差不多,再加上 6 道题还要升级。

</details>

5. (面试题)你们的客服 Agent 要回答退款金额,老板说「准确率要 99%,但别太贵」。用本周学的东西,你会怎么设计?

<details><summary>答案</summary>

要点:①先别加推理时算力,把退款金额做成一个按规则精确计算的工具,模型只负责从对话里抽出套餐、日期、优惠券这些参数,这一步能直接把准确率拉满,成本最低(Day 180 起的工具设计);②抽参数这一步本身没把握时,用投票的票型做置信度,票数不一致就转人工复核,而不是悄悄给一个答案;③思考档位从关思考开始,在自己的评测集上往上加到准确率不再涨为止,今天这类题 low 就到顶;④级联只有在两档单价差很大时才省钱,同一个模型里主要是为了置信度;⑤所有结论都要在带标准答案的题集上跑三遍以上,看范围不看单次。

</details>

## 明天预告

明天是 **Day 182 · 好工具(二):六条原则**。Day 180 那张难用工具清单一直留着没动:按命令设计、名字是黑话、描述 9 个字、参数叫 `f` 和 `p`、返回值没有上限、报错看不懂。明天按六条原则一条一条改,每改一条就用同一组输入探一次,看返回值从 70,454 个字符一步步缩到 95 个。今天小项目的结论也是明天的动机:与其在模型那边多花算力,不如把它手里的工具做好。
