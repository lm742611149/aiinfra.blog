---
title: 'Day 262 · 上下文工程(一):窗口大不等于该塞满,做预算'
description: '模型窗口有 100 万 token,不代表该往里塞满。今天先做两个实验:2.8 万 token 里找一条公告,DeepSeek 15 次全对;让它数一数有几条,错 15% 到 26%。然后把一次客服调用拆成六块,每块定上限、出预算表,超了按轮裁历史,不拆散工具调用,最后和 API 返回的 token 数对账,差 4.3%。'
pubDate: 2026-10-23
regime: none
tags: ['context-engineering', 'token-budget', 'python', 'agent-zero']
series: 'agent-zero'
day: 262
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 261](/blog/agent-zero/day-261-rag-eval-6/) 拿评估集做了第一次正式实验:只把检索条数 k 从 4 改成 8,q17 从「不完整」变成了「完整」,同时每次调用的输入 token 多了 46%。当时只是顺口提了一句「贵了」,没有展开。

今天就从这句话接着往下。RAG 评估这一段结束了,接下来三天讲**上下文工程**:模型每次被调用,它能看到的全部东西(系统提示词、工具定义、检索到的资料、对话历史、关于用户的记忆)到底该放什么、放多少。今天先讲「放多少」,也就是给上下文做预算。

## 今天要解决的问题

学完你应该能做到:

1. 说清楚什么是上下文工程,以及它的四类手段:写出去、选进来、压缩、隔离。
2. 用两个实验讲明白「窗口大不等于该塞满」:在 2.8 万 token 里**找一条**,模型很稳;让它**数一数**,就不准了。
3. 把一次客服调用的上下文拆成六块,用 `part04/ctx_budget.py` 数出每块占多少 token,和 API 返回的 `prompt_tokens` 对账,知道差在哪。
4. 给每块定上限,写出 `part04/ctx_report.py` 的预算表;写出 `part04/trim_turns.py` 的按轮裁剪,并亲眼看到「按条裁」会让接口返回 400。

预计用时 2.5 小时。API 花费:今天所有实验合计约 ¥0.2,每个脚本的花费都写在文里。价格按 2026 年 10 月查到的 [DeepSeek 定价页](https://api-docs.deepseek.com/zh-cn/quick_start/pricing):deepseek-flash 输入缓存命中 0.04 元、未命中 2 元、输出 8 元每百万 token(Day 261 同一份价目)。

前置:[Day 108](/blog/agent-zero/day-108-tokens-2/) 的分词器和 `tokenizers`,以及 `data/deepseek_v4_tokenizer/tokenizer.json`;[Day 109](/blog/agent-zero/day-109-context-window/) 的窗口和「丢最早的消息」那个截断函数;[Day 124](/blog/agent-zero/day-124-cost/) 从 usage 算钱;[Day 156](/blog/agent-zero/day-156-fc-idea/)–[158](/blog/agent-zero/day-158-fc-first-run/) 的 function calling(`tool_calls` 和 `tool` 消息);[Day 222](/blog/agent-zero/day-222-kb-data/) 建的 20 篇帮助文章 `data/kb/`;`common/llm.py` 的 `LLMClient`(Day 135 建)。

学法:先对照文章把每个脚本逐行敲一遍(不要复制粘贴)并跑通;明天合上文章,把 `trim_by_turn` 默写出来;然后做动手练习,做不出来再展开参考答案,看完关掉重写一遍。

## 先给这件事起个名字:上下文工程

你可能已经听过「提示词工程」,意思是怎么把指令写好。到了 Agent 这里,光写好指令不够。一个 Agent 跑一次任务要调模型十几次,每次调用的输入都是这几样东西拼起来的:

- 系统提示词(它是谁,守什么规矩)
- 工具定义(它能调哪些函数,每个函数的参数是什么)
- 检索到的资料(RAG 取回来的几篇文章)
- 关于用户的记忆(这位客户是年付企业版)
- 对话历史(前面聊过的所有轮,包括调用工具的记录和工具返回的结果)
- 这一轮用户新问的话

这些东西加起来,就是模型这一次调用「能看到的全部世界」。**上下文工程(context engineering)**管的就是这一整堆:每次调用之前,决定哪些进去、哪些不进去、按什么顺序、各占多少。Anthropic 在 [《Effective context engineering for AI agents》](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents) 里给的定义大意是:在推理的时候,筛选并维护那一组最合适的 token。它和提示词工程的区别在于,提示词是写一次,上下文是**每一次调用都要重新决定一遍**。

做法大致分四类,这是 LangChain 的 Lance Martin 在 [《Context Engineering for Agents》](https://blog.langchain.com/context-engineering-for-agents/) 里的分法,我觉得好记:

| 手段 | 意思 | 本周哪天讲 |
| --- | --- | --- |
| 写出去(write) | 把信息存到窗口外面,以后需要再取:笔记、长期记忆 | [Day 264](/blog/agent-zero/day-264-memory-short-long/) |
| 选进来(select) | 需要时只把相关的取进窗口:RAG、记忆召回 | 前面几十天已经做了很多 |
| 压缩(compress) | 把长的变短:对话摘要、清理旧工具结果 | [Day 263](/blog/agent-zero/day-263-compaction/) |
| 隔离(isolate) | 脏活交给另一个窗口的子 Agent,只带结果回来 | [Day 267](/blog/agent-zero/day-267-subagent-isolation/) |

今天不动手做这四类里的任何一类。今天做的是它们共同的前提:**先搞清楚窗口里现在装着什么、各占多少**。不量,压缩和记忆都没有依据,你不知道该压哪一块。

## 窗口大不等于该塞满

[Day 109](/blog/agent-zero/day-109-context-window/) 讲过,DeepSeek 的窗口是 1,048,576 个 token。那很自然会想:反正装得下,把整个知识库、全部历史都塞进去,还检索什么、裁什么?

Day 109 给了三个理由:贵、慢、塞多了模型会看漏。前两条算一下账就明白,第三条光听别人说不踏实。Day 109 引用的两篇研究([Lost in the Middle](https://arxiv.org/abs/2307.03172) 和 Chroma 的 [Context Rot](https://research.trychroma.com/context-rot))都是别人用别的模型测的,我当时说「没有在 DeepSeek 上复现」。今天自己测一下,用的就是我们课程里一直在用的 deepseek-flash。

### 实验一:在一堆公告里找一条

先造一批互相很像的公告。每条长这样:

```text
【公告 N-0001】兰州地区的月付个人版客户,红字发票的申请期限为开票后 28 天内提交,逾期不予受理。
```

40 个地区、4 种套餐、5 类事项一共能排出 800 种组合,每种组合一条,期限天数在 5 到 45 之间随机。公告之间只有地区、套餐、事项和天数不同,别的都一样,所以很像,不是那种「混进一篇完全无关的文章」的简单情况。然后按公告的位置(开头、四分之一、中间、四分之三、结尾)挑一条,问它的期限是多少天。

新建 `part04/long_ctx.py`:

```python
# agent-zero-lab/part04/long_ctx.py  大海捞针:公告越堆越多,答案放在不同位置,看模型还找不找得对
import random
import sys

from common.llm import LLMClient

REGIONS = ["北京", "上海", "深圳", "杭州", "成都", "武汉", "西安", "南京", "苏州", "广州",
           "重庆", "天津", "长沙", "郑州", "青岛", "厦门", "合肥", "济南", "福州", "昆明",
           "沈阳", "大连", "宁波", "无锡", "佛山", "东莞", "南昌", "石家庄", "太原", "贵阳",
           "南宁", "兰州", "乌鲁木齐", "呼和浩特", "海口", "银川", "西宁", "拉萨", "珠海", "烟台"]
PLANS = ["月付个人版", "月付团队版", "年付团队版", "年付企业版"]
ITEMS = ["发票补开", "抬头修改", "重复扣款退款", "红字发票", "对公转账核销"]

SYSTEM = "你是云簿 CloudLedger 的客服。只根据下面的公告回答,只回答一个数字(天数),不要解释。\n\n"


def make_notices(n: int) -> list[tuple[str, str]]:
    """生成 n 条互相很像的公告。返回 [(公告正文, 该条的正确天数), ...]"""
    rng = random.Random(262)  # 固定种子,每次生成的公告一模一样
    combos = [(r, p, i) for r in REGIONS for p in PLANS for i in ITEMS]
    rng.shuffle(combos)
    out = []
    for k, (r, p, i) in enumerate(combos[:n], start=1):
        days = rng.choice(range(5, 46))  # 5~45 天
        text = f"【公告 N-{k:04d}】{r}地区的{p}客户,{i}的申请期限为开票后 {days} 天内提交,逾期不予受理。"
        out.append((text, str(days)))
    return out


def ask(client: LLMClient, notices: list[tuple[str, str]], depth: float) -> dict:
    """问排在 depth 位置(0 开头 … 1 结尾)的那条公告的期限。"""
    idx = round(depth * (len(notices) - 1))
    text, answer = notices[idx]
    # 从公告正文里把地区、套餐、事项拆出来,拼成问题
    head = text.split("】")[1].split(" 天内")[0]
    where, rest = head.split("地区的")
    plan, rest = rest.split("客户,")
    item = rest.split("的申请期限")[0]
    question = f"{where}地区的{plan}客户,{item}的申请期限是开票后多少天?"
    docs = "\n".join(t for t, _ in notices)
    r = client.chat([{"role": "system", "content": SYSTEM + docs}, {"role": "user", "content": question}],
                    temperature=0, max_tokens=20)
    return {"idx": idx, "answer": answer, "reply": r.content.strip(), "ok": r.content.strip() == answer,
            "prompt_tokens": r.prompt_tokens, "hit": r.cache_hit_tokens, "latency": r.latency, "cost": r.cost}


if __name__ == "__main__":
    client = LLMClient()
    sizes = [int(x) for x in sys.argv[1:]] or [80, 320]
    for n in sizes:
        notices = make_notices(n)
        for depth in (0, 0.25, 0.5, 0.75, 1):
            d = ask(client, notices, depth)
            print(f"{n:>4} 条 位置 {depth:<4} 第 {d['idx'] + 1:>3} 条 期望 {d['answer']:>2} 回答 {d['reply']:<4} "
                  f"{'对' if d['ok'] else '错'} 输入 {d['prompt_tokens']:>6} 命中 {d['hit']:>6} 耗时 {d['latency']:.1f}s ¥{d['cost']:.4f}")
    print(client.ledger)
```

<div class="line-notes">

- `import random` 标准库里的随机数。后面要用它造数据,但要求每次造出来的一模一样,所以会用固定种子。
- `import sys` 为了读命令行参数,下面 `sys.argv` 要用。
- `from common.llm import LLMClient` Day 135 建的客户端。`client.chat(messages, **kw)` 返回的结果里有 `content`、`prompt_tokens`、`cache_hit_tokens`、`cost`、`latency`。
- `REGIONS = [` 40 个地区名,写成一个列表。列表可以跨多行写,方括号没闭合之前 Python 不会认为这条语句结束,所以换行不用加续行符。
- `PLANS = [` 四种套餐,是这个实验自己编的,和知识库里的三档套餐没关系。
- `ITEMS = [` 五类事项。三个列表相乘:40 × 4 × 5 = 800 种组合。
- `SYSTEM = ` 给模型的规矩:只根据下面的公告回答,只回答一个数字。结尾两个 `\n` 是留出空行,后面会把公告正文直接接在它后面。
- `def make_notices(n: int) -> list[tuple[str, str]]:` 返回 n 条公告,每条是一个二元组:(公告正文, 正确天数)。`tuple[str, str]` 是类型提示,二元组两个元素都是字符串,Day 22 讲过元组。
- `rng = random.Random(262)` 造一个自己专用的随机数发生器,种子是 262。同样的种子,每次产生的「随机」序列完全一样,这样你和我生成的 800 条公告逐字相同,实验才能对得上。
- `combos = [(r, p, i) for r in REGIONS for p in PLANS for i in ITEMS]` 三层的列表推导式(Day 23),相当于 JS 里三层嵌套 `for` 往数组里 `push`。结果是 800 个三元组,比如 `("北京", "月付个人版", "发票补开")`。
- `rng.shuffle(combos)` 原地打乱顺序。不打乱的话,前 80 条全是同一个地区,小规模的测试就不像样。
- `out = []` 准备装结果。
- `for k, (r, p, i) in enumerate(combos[:n], start=1):` 只取前 n 个组合。`enumerate(..., start=1)` 在每个元素前面配一个从 1 开始的序号 `k`,同时把三元组拆成 `r, p, i`(Day 22 的解包)。`combos[:n]` 是切片,n=80 时就是前 80 个。
- `days = rng.choice(range(5, 46))` 从 5 到 45 里随机挑一个整数。`range(5, 46)` 左闭右开,包含 5 不包含 46。
- `text = f"【公告 N-{k:04d}】` f-string 里的 `{k:04d}` 是格式:整数、补零到 4 位,所以 1 变成 `0001`。
- `out.append((text, str(days)))` 把一个二元组追加进去。注意是两层括号,外层是 `append` 的括号,里层是元组的括号。天数转成字符串,后面和模型的回答直接比字符串。
- `def ask(client: LLMClient, notices: list[tuple[str, str]], depth: float) -> dict:` `depth` 是 0 到 1 的小数,0 表示开头那条,1 表示最后一条。
- `idx = round(depth * (len(notices) - 1))` 把位置换成下标。n=80、depth=0.25 时:0.25 × 79 = 19.75,四舍五入是 20,也就是第 21 条,输出里「第 21 条」就是这么来的。
- `text, answer = notices[idx]` 取出这条公告的正文和正确天数。
- `head = text.split("】")[1].split(" 天内")[0]` 下面几行是在把公告正文拆成地区、套餐、事项,好拼出问题。这一行以 `N-0021` 那条为例,`text.split("】")` 把字符串按「】」切开得到两段,取第二段(下标 1),再按「 天内」切,取第一段,得到 `某某地区的某某客户,某某的申请期限为开票后 7`。
- `where, rest = head.split("地区的")` 按「地区的」切成两半,前半是地区名,后半留着继续切。
- `plan, rest = rest.split("客户,")` 同理,切出套餐名,剩下事项那一截。
- `item = rest.split("的申请期限")[0]` 取出事项名。
- `question = f"{where}地区的{plan}客户,{item}的申请期限是开票后多少天?"` 拼成一个口语化的问题。
- `docs = "\n".join(t for t, _ in notices)` 把所有公告正文用换行连成一大段。生成器表达式里的 `_` 是约定俗成的「这个值我不要」,元组的第二项(天数)这里用不上。
- `r = client.chat([{"role": "system", "content": SYSTEM + docs}, ` 系统提示词加上全部公告放在 system 消息里,问题放 user 消息。
- `temperature=0, max_tokens=20` 温度 0 让回答尽量固定,最多输出 20 个 token,因为只要一个数字。注意:温度 0 也不保证每次完全一样,下面实验二会看到。
- `return {"idx": idx,` 返回一个字典,把后面打印要用的东西都带上:是否答对用 `r.content.strip() == answer` 判断,`strip()` 去掉首尾空白。
- `sizes = [int(x) for x in sys.argv[1:]] or [80, 320]` 命令行里跟的数字就是公告条数。`sys.argv[1:]` 是第一个之后的所有参数(`sys.argv[0]` 是脚本名),`or [80, 320]` 是没给参数时的默认值,空列表是假值所以会走 `or` 后面。
- `for depth in (0, 0.25, 0.5, 0.75, 1):` 五个位置。
- `d = ask(client, notices, depth)` 每个位置问一次。
- `print(f"{n:>4} 条 位置 ` 一行打印:`:>4` 是右对齐宽 4,`:<4` 是左对齐。`'对' if d['ok'] else '错'` 是三元表达式,相当于 JS 的 `d.ok ? '对' : '错'`。
- `print(client.ledger)` 最后打印这次运行的总账:几次调用、输入输出多少 token、花了多少钱。

</div>

运行(在 `agent-zero-lab` 根目录):

```bash
uv run python -m part04.long_ctx 80 320 800
```

实跑输出:

```text
  80 条 位置 0    第   1 条 期望 28 回答 28   对 输入   2876 命中   2688 耗时 0.9s ¥0.0005
  80 条 位置 0.25 第  21 条 期望  7 回答 7    对 输入   2875 命中   2688 耗时 0.8s ¥0.0005
  80 条 位置 0.5  第  41 条 期望 45 回答 45   对 输入   2878 命中   2688 耗时 0.8s ¥0.0005
  80 条 位置 0.75 第  60 条 期望 24 回答 24   对 输入   2875 命中   2688 耗时 0.7s ¥0.0005
  80 条 位置 1    第  80 条 期望  5 回答 5    对 输入   2875 命中   2688 耗时 0.9s ¥0.0005
 320 条 位置 0    第   1 条 期望 28 回答 28   对 输入  11323 命中  11136 耗时 0.7s ¥0.0008
 320 条 位置 0.25 第  81 条 期望 28 回答 28   对 输入  11323 命中  11136 耗时 0.4s ¥0.0008
 320 条 位置 0.5  第 161 条 期望  5 回答 5    对 输入  11322 命中  11136 耗时 0.7s ¥0.0008
 320 条 位置 0.75 第 240 条 期望 32 回答 32   对 输入  11322 命中  11136 耗时 0.7s ¥0.0008
 320 条 位置 1    第 320 条 期望 20 回答 20   对 输入  11324 命中  11136 耗时 1.0s ¥0.0008
 800 条 位置 0    第   1 条 期望 28 回答 28   对 输入  28252 命中  28032 耗时 0.7s ¥0.0016
 800 条 位置 0.25 第 201 条 期望 20 回答 20   对 输入  28252 命中  28032 耗时 1.0s ¥0.0016
 800 条 位置 0.5  第 401 条 期望 32 回答 32   对 输入  28251 命中  28032 耗时 0.5s ¥0.0016
 800 条 位置 0.75 第 600 条 期望 36 回答 36   对 输入  28251 命中  28032 耗时 0.7s ¥0.0016
 800 条 位置 1    第 800 条 期望 34 回答 34   对 输入  28251 命中  28032 耗时 0.8s ¥0.0016
15 次调用 | 输入 212250 / 输出 15 tokens | 约 ¥0.0144
```

80 条是 2,876 个 token,320 条是 11,323 个,800 条是 28,252 个。**15 次全对,第一条、中间、最后一条都找得到**。这是一个很重要的事实:对 deepseek-flash,在 2.8 万 token 里按「地区+套餐+事项」精确找一条很像的公告,位置不影响结果。

「命中」那一列是缓存。五次提问的公告完全一样,只有最后的问题不同,所以前缀都命中了缓存,每次只花 ¥0.0005 到 ¥0.0016(Day 124 讲过缓存价是未命中的五十分之一)。不命中的话,28,252 个 token × 2 元 / 百万 = ¥0.0565,一次调用五分钱。

所以只做到这里,结论会是「长上下文没问题,随便塞」。接着看第二个实验。

### 实验二:让它数一数

同一批公告,换一种问法:不是找一条,而是问「一共有多少条公告是写给年付企业版客户的」。答案用普通代码就能数出来,拿它当标准。

新建 `part04/long_ctx_count.py`:

```python
# agent-zero-lab/part04/long_ctx_count.py  再难一档:数数。找一条做得到,把散在各处的几百条数清楚就未必
import re
import sys

from common.llm import LLMClient
from part04.long_ctx import PLANS, SYSTEM, make_notices

if __name__ == "__main__":
    client = LLMClient()
    sizes = [int(x) for x in sys.argv[1:]] or [80, 320, 800]
    for n in sizes:
        notices = make_notices(n)
        docs = "\n".join(t for t, _ in notices)
        for plan in PLANS:
            real = sum(f"的{plan}客户" in t for t, _ in notices)  # 用代码数出标准答案
            q = f"一共有多少条公告是写给「{plan}」客户的?只回答一个数字。"
            r = client.chat([{"role": "system", "content": SYSTEM + docs}, {"role": "user", "content": q}],
                            temperature=0, max_tokens=20)
            nums = re.findall(r"\d+", r.content)  # 从回答里抠出数字
            got = int(nums[0]) if nums else -1
            print(f"{n:>4} 条 {plan} 实际 {real:>3} 回答 {got:>3} 差 {got - real:>+4} ({abs(got - real) / real:.0%}) 输入 {r.prompt_tokens}")
    print(client.ledger)
```

<div class="line-notes">

- `import re` 正则模块,下面要从模型的回答里抠数字。
- `from part04.long_ctx import PLANS, SYSTEM, make_notices` 复用上一个脚本的东西。因为在 `agent-zero-lab` 根目录用 `-m` 运行,所以能这样按包路径导入(Day 32 讲过模块)。
- `sizes = [int(x) for x in sys.argv[1:]] or [80, 320, 800]` 默认三个规模都跑。
- `docs = "\n".join(t for t, _ in notices)` 公告拼成一整段,同上一个脚本。
- `for plan in PLANS:` 四种套餐各问一次。
- `real = sum(f"的{plan}客户" in t for t, _ in notices)` 用普通代码数出标准答案。`"的年付企业版客户" in t` 是子串判断,结果是 True 或 False;`sum` 把 True 当 1、False 当 0 加起来。这和 JS 里 `notices.filter(...).length` 一样。
- `q = f"一共有多少条公告是写给「{plan}」客户的?只回答一个数字。"` 问题。
- `nums = re.findall(r"\d+", r.content)` 找出回答里所有连续数字。`\d+` 表示一个或多个数字。模型有时会多说一句话,抠出来更稳。
- `got = int(nums[0]) if nums else -1` 取第一个数字;一个数字都没有就记成 -1,免得后面报错。
- `print(f"{n:>4} 条 {plan} 实际` `{got - real:>+4}` 里的 `+` 表示正数也显示加号;`abs(got - real) / real:.0%` 是误差百分比,`:.0%` 把小数格式化成整数百分比。

</div>

```bash
uv run python -m part04.long_ctx_count
```

实跑输出:

```text
  80 条 月付个人版 实际  21 回答  20 差   -1 (5%) 输入 2874
  80 条 月付团队版 实际  24 回答  20 差   -4 (17%) 输入 2874
  80 条 年付团队版 实际  18 回答  18 差   +0 (0%) 输入 2874
  80 条 年付企业版 实际  17 回答  20 差   +3 (18%) 输入 2874
 320 条 月付个人版 实际  81 回答  62 差  -19 (23%) 输入 11321
 320 条 月付团队版 实际  83 回答  62 差  -21 (25%) 输入 11321
 320 条 年付团队版 实际  73 回答  62 差  -11 (15%) 输入 11321
 320 条 年付企业版 实际  83 回答  62 差  -21 (25%) 输入 11321
 800 条 月付个人版 实际 200 回答 191 差   -9 (4%) 输入 28250
 800 条 月付团队版 实际 200 回答 200 差   +0 (0%) 输入 28250
 800 条 年付团队版 实际 200 回答 148 差  -52 (26%) 输入 28250
 800 条 年付企业版 实际 200 回答 148 差  -52 (26%) 输入 28250
12 次调用 | 输入 169780 / 输出 12 tokens | 约 ¥0.0115
```

80 条的时候还凑合,最多差 4 条(17%、18%)。到了 320 条,四个答案**一模一样都是 62**,实际是 81、83、73、83,差了 15% 到 25%。到了 800 条,实际每种都是 200,模型回答了 191、200、148、148。这是在 28,250 个 token 里的结果,离 100 万的窗口还差得很远。

还有一件事要说实话:我把这个脚本跑了三遍。`temperature=0` 并不保证每次一样,800 条的「月付个人版」三次分别回答了 172、207、191,「月付团队版」是 161、161、200。上面贴的是第三遍的输出。**同一个问题,答案会变**,所以「单次对了」没法说明什么,这件事我们在 Day 261 已经吃过亏,就是为什么要先测噪声。

这两个实验放在一起,给的是一个有边界的结论:

- 找一条:窗口里东西再多,只要答案是一小段、问法能对上,deepseek-flash 在 2.8 万 token 里没出错。
- 数几百条:需要同时关注几百处,模型不是完全不会,但会少数,而且前后不一致。

这个结论只对「这个模型、这种公告、2.8 万 token」成立。我没测更长的,也没测别的模型。Chroma 的报告测了 18 个模型,说的也是类似的方向:输入变长,表现变得不可靠,而且不均匀。**别拿「窗口装得下」当「能用好」的证据**。

对写 Agent 的人,后果是实打实的。客服 Agent 面对的往往不是「找一条」,而是「这位客户这三年的发票里有没有重复扣款」「对比一下这五篇文章哪个更新」,这类题要把很多处信息合到一起。把东西全塞进去再指望模型自己理清,不如先用代码把能算的算好(这里的 `real` 就是代码算的),或者只给它相关的几条。

再算算钱。一个 Agent 一次任务跑 20 步,每一步都要把前面所有内容重新发一遍。假如每步都带着 2.8 万 token 的上下文,没有缓存命中的话:20 × 28,252 × 2 元 / 百万 = ¥1.13,一次任务一块多。窗口里每多一块东西,要在每一步里付一次钱。这就是为什么要做预算。

## 一次调用里到底装了什么

回到那个客服 Agent。用户问「我们是年付企业版,买错了想退款,能退多少?」,代码在发请求之前拼出来的东西,按来源分是这六块,加上给回答留的位置:

<figure>
<svg viewBox="0 0 640 250" role="img" aria-label="一次客服调用的上下文分成六块加输出预留,每块有自己的上限和谁在控制它的大小">
<rect x="0" y="0" width="640" height="250" fill="var(--paper-raised)"/>
<g font-family="var(--font-mono)" font-size="12">
<text x="20" y="26" fill="var(--ink)">一次调用的输入 = 六块拼起来(token 为今天实测)</text>
<rect x="20" y="40" width="64" height="40" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="52" y="64" text-anchor="middle" fill="var(--ink)">系统 172</text>
<rect x="84" y="40" width="92" height="40" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="130" y="64" text-anchor="middle" fill="var(--ink)">工具 599</text>
<rect x="176" y="40" width="30" height="40" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="191" y="64" text-anchor="middle" fill="var(--ink)" font-size="11">记</text>
<rect x="206" y="40" width="110" height="40" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="261" y="64" text-anchor="middle" fill="var(--ink)">资料 609</text>
<rect x="316" y="40" width="200" height="40" fill="none" stroke="var(--ink-soft)"/>
<text x="416" y="64" text-anchor="middle" fill="var(--ink)">对话历史 1092(会越聊越长)</text>
<rect x="516" y="40" width="20" height="40" fill="var(--mem-wash)" stroke="var(--mem)"/>
<rect x="540" y="40" width="80" height="40" fill="none" stroke="var(--rule)" stroke-dasharray="4 3"/>
<text x="580" y="64" text-anchor="middle" fill="var(--ink-soft)">输出预留</text>
<text x="20" y="112" fill="var(--mem)">蓝:每次调用都一样(系统、工具),放前面能吃缓存</text>
<text x="20" y="132" fill="var(--compute)">琥珀:这一轮按需选进来的(记忆、检索资料)</text>
<text x="20" y="152" fill="var(--ink-soft)">灰框:唯一会无限增长的,必须设上限、超了就裁</text>
<text x="20" y="172" fill="var(--ink-faint)">虚线:max_tokens 要从这里扣,输入塞太满回答会被截断</text>
<text x="20" y="206" fill="var(--ink-faint)" font-size="11">宽度只是示意,不按比例。数字来自今天 ctx_count.py:9 轮历史、4 篇资料</text>
<text x="20" y="226" fill="var(--ink-faint)" font-size="11">右边小蓝块是本轮用户问题(15 token)</text>
</g>
</svg>
<figcaption>六块各自由不同的东西控制大小:系统提示词和工具定义是你写的,记忆和检索资料是 top-k 和块大小决定的,对话历史是用户聊多久决定的。要管的先是最后那块。</figcaption>
</figure>

这张图的意义是逼你回答每一块的三个问题:它是什么、谁决定它的大小、超了怎么办。系统提示词和工具定义是你自己写的,超了就是改提示词,运行时没法裁。检索资料由 top-k 和块大小决定,超了可以少取几篇。对话历史是用户聊出来的,没有上限,所以必须有人给它设上限。

今天的数据先造好。新建 `part04/ctx_blocks.py`,里面放这一次调用的各种原料,后面三个脚本、明后天的脚本都从这里取:

```python
# agent-zero-lab/part04/ctx_blocks.py  一次客服调用的上下文,按来源拆成几块;今天和后两天的脚本都从这里取数据
import json
from pathlib import Path

SYSTEM = """你是云簿 CloudLedger 的客服助手,服务对象是用 CloudLedger 记账的小企业主。
规则:
1. 只根据【资料】和工具返回的内容回答。资料里没有的,直接说「这个我没查到,建议转人工客服」,不要编。
2. 涉及退款、扣款、发票作废的操作,先用工具查清订阅和发票,再告诉客户结论;真要退款,调用 create_refund_request 提交,由客服主管审批,不要承诺一定能退。
3. 回答先给结论,再给一两句理由。金额写清单位(元),日期写清年月日。
4. 不要向客户索要或复述银行卡号、密码、验证码。
5. 客户情绪激动时,先用一句话道歉或共情,再解决问题。"""

TOOLS = [
    {"type": "function", "function": {
        "name": "find_customer",
        "description": "按公司名或邮箱查客户,返回客户编号 customer_id、公司名、邮箱。",
        "parameters": {"type": "object", "properties": {
            "query": {"type": "string", "description": "公司名或邮箱,支持模糊匹配"}}, "required": ["query"]}}},
    {"type": "function", "function": {
        "name": "get_subscription",
        "description": "查客户当前的订阅:套餐、付费周期(月付/年付)、状态、下次扣款日期、金额。",
        "parameters": {"type": "object", "properties": {
            "customer_id": {"type": "string", "description": "find_customer 返回的客户编号,如 C-0001"}}, "required": ["customer_id"]}}},
    {"type": "function", "function": {
        "name": "list_invoices",
        "description": "列出客户最近的发票,返回发票号、金额、开票日期、状态(已开/已红冲/已付款)。",
        "parameters": {"type": "object", "properties": {
            "customer_id": {"type": "string", "description": "客户编号"},
            "limit": {"type": "integer", "description": "最多返回几张,默认 5"}}, "required": ["customer_id"]}}},
    {"type": "function", "function": {
        "name": "create_refund_request",
        "description": "提交一张退款申请,进入客服主管审批。不会立刻退款。",
        "parameters": {"type": "object", "properties": {
            "customer_id": {"type": "string"},
            "invoice_no": {"type": "string", "description": "要退款的发票号"},
            "amount": {"type": "number", "description": "退款金额,单位元"},
            "reason": {"type": "string", "description": "退款原因,一句话"}}, "required": ["customer_id", "invoice_no", "amount", "reason"]}}},
]

MEMORY = [
    "客户 C-0001(星河记账),年付企业版,10 个席位",
    "偏好:用邮件联系,不要打电话",
    "2026-10 导入招商银行流水报过 E1043,另存为 CSV UTF-8 后解决",
]


def load_kb(ids: list[str]) -> list[str]:
    """读 data/kb/ 下指定编号的文章,去掉开头的 frontmatter(--- 包起来的元数据),只留正文。"""
    out = []
    for i in ids:
        text = Path(f"data/kb/{i}.md").read_text(encoding="utf-8")
        out.append(text.split("---\n", 2)[2].strip())
    return out


def retrieved_block(ids: list[str]) -> str:
    """把检索到的文章拼成一段【资料】,每篇前面标上编号,方便以后加引用。"""
    docs = load_kb(ids)
    return "【资料】\n" + "\n\n".join(f"[{i}]\n{d}" for i, d in zip(ids, docs))


def make_history(turns: int) -> list[dict]:
    """造一段客服对话历史:每三轮里有一轮调了工具。内容是写死的,不调模型,方便反复跑。"""
    out: list[dict] = []
    for n in range(1, turns + 1):
        out.append({"role": "user", "content": f"第 {n} 个问题:我们星河记账的订阅和发票,想确认一下第 {n} 项。"})
        if n % 3 == 0:
            call_id = f"call_{n}"
            out.append({"role": "assistant", "content": None, "tool_calls": [{
                "id": call_id, "type": "function",
                "function": {"name": "list_invoices", "arguments": json.dumps({"customer_id": "C-0001", "limit": 5})}}]})
            rows = [{"invoice_no": f"INV-2026-{n:02d}{k:02d}", "amount": 468.0, "date": f"2026-0{k + 1}-15",
                     "status": "已付款"} for k in range(1, 6)]
            out.append({"role": "tool", "tool_call_id": call_id, "content": json.dumps(rows, ensure_ascii=False)})
        out.append({"role": "assistant", "content": f"第 {n} 项已确认:订阅正常,发票状态都是已付款。如还有疑问请继续问我。"})
    return out
```

<div class="line-notes">

- `import json` 工具调用的 `arguments` 要求是 JSON **字符串**,不是对象,所以造数据时要 `json.dumps`;`tool` 消息的内容也用它转成字符串。
- `from pathlib import Path` Day 37 的路径对象,下面读 `data/kb/kb-002.md` 用。
- `SYSTEM = """你是云簿 CloudLedger 的客服助手,` 三引号字符串可以直接跨多行写。五条规矩:只根据资料回答、退款先查再提交、先结论后理由、不要银行卡密码、情绪激动先共情。实测这段 289 个字符,真分词器数出 172 个 token。
- `TOOLS = [` 四个工具定义,格式是 Day 157 讲过的 OpenAI 兼容 function calling 的 JSON Schema。名字用课程里固定的四个:`find_customer`、`get_subscription`、`list_invoices`、`create_refund_request`。这个列表每次调用都要发给模型,模型靠它知道能调什么,所以它也占 token。
- `"name": "find_customer",` 第一个工具:按公司名或邮箱查客户,返回 `customer_id`。`required` 里只有 `query`。
- `"name": "get_subscription",` 查订阅,参数是 `customer_id`。`description` 里写清了返回哪些字段,模型看这句话决定要不要调它。
- `"name": "list_invoices",` 列发票,多一个可选参数 `limit`(不在 `required` 里)。
- `"name": "create_refund_request",` 提交退款申请,四个参数都必填。描述里写了「不会立刻退款」,这是让模型别向客户承诺已经退了。
- `MEMORY = [` 三条关于这位客户的记忆,明天和后天会讲它们是怎么来的。今天当成现成的字符串用。
- `def load_kb(ids: list[str]) -> list[str]:` 读指定编号的文章。
- `text = Path(f"data/kb/{i}.md").read_text(encoding="utf-8")` 比如 `i = "kb-002"` 就读 `data/kb/kb-002.md`。所以要在 `agent-zero-lab` 根目录运行。
- `out.append(text.split("---\n", 2)[2].strip())` 文章开头有一段用 `---` 包起来的元数据(id、title、category)。`text.split("---\n", 2)` 最多切两刀,得到三段:空串、元数据、正文,下标 2 就是正文。`.strip()` 去掉首尾空白。
- `def retrieved_block(ids: list[str]) -> str:` 把检索到的文章拼成一段「资料」。
- `docs = load_kb(ids)` 比如传 `["kb-002", "kb-001"]`,得到两篇正文。
- `return "【资料】\n" + "\n\n".join(f"[{i}]\n{d}" for i, d in zip(ids, docs))` `zip` 把编号和正文配成对,每篇前面标上 `[kb-002]` 这样的编号,篇与篇之间空一行。编号现在没用,后面做引用出处时要用。
- `def make_history(turns: int) -> list[dict]:` 造一段假的客服对话历史,内容写死,不调模型,这样每次跑结果一样、不花钱。
- `out: list[dict] = []` 装消息的列表。
- `for n in range(1, turns + 1):` 一轮一轮造,`turns=9` 时 n 从 1 到 9。
- `out.append({"role": "user", "content": f"第 {n} 个问题:` 每轮先来一条用户消息。
- `if n % 3 == 0:` 每三轮有一轮调用了工具:第 3、6、9 轮。`%` 是取余数,和 JS 一样。
- `call_id = f"call_{n}"` 工具调用的编号,比如 `call_3`。assistant 消息里的调用和后面 tool 消息的结果靠这个编号配对。
- `"tool_calls": [{` assistant 消息这一条没有文字(`content` 是 `None`),只有一个 `tool_calls`:调 `list_invoices`,参数 `{"customer_id": "C-0001", "limit": 5}`。
- `rows = [{"invoice_no": ` 造 5 张假发票,每张是个字典。
- `out.append({"role": "tool", "tool_call_id": call_id,` 工具返回的结果,`tool_call_id` 要和上面的 `call_id` 一致。内容是 5 张发票的 JSON 字符串,`ensure_ascii=False` 让汉字原样输出而不是 `\uXXXX`。这条消息实测 206 个 token,比一条普通回答大得多。
- `out.append({"role": "assistant", "content": f"第 {n} 项已确认` 最后是 assistant 的文字回答。`turns=9` 时一共 9 个 user、9 个 assistant 回答、3 对调用和结果,24 条消息。
- `return out` 返回整个历史。

</div>

数 token 的工具放在 `part04/ctx_budget.py`:

```python
# agent-zero-lab/part04/ctx_budget.py  数每一块占多少 token:粗估、真分词器、API 返回的 usage 三种数对着看
import json

from tokenizers import Tokenizer

TOK = Tokenizer.from_file("data/deepseek_v4_tokenizer/tokenizer.json")
PER_MESSAGE = 4  # 每条消息的格式开销,Day 109 测过:故意往多了估


def estimate_tokens(text: str) -> int:
    """粗估,不依赖任何分词器:非 ASCII 字符(汉字、中文标点)每个 0.8 个 token,ASCII 字符每个 0.35 个。"""
    wide = sum(ord(ch) > 127 for ch in text)
    return int(wide * 0.8 + (len(text) - wide) * 0.35) + 1


def count_tokens(text: str) -> int:
    """用 DeepSeek 官方分词器数,和 API 的 prompt_tokens 只差格式开销。"""
    return len(TOK.encode(text, add_special_tokens=False).ids)


def message_text(m: dict) -> str:
    """一条消息里会被模型看到的全部文字:正文,加上 tool_calls 里的函数名和参数。"""
    text = str(m.get("content") or "")
    for call in m.get("tool_calls") or []:
        text += call["function"]["name"] + call["function"]["arguments"]
    return text


def message_tokens(m: dict) -> int:
    return count_tokens(message_text(m)) + PER_MESSAGE


def tools_tokens(tools: list[dict]) -> int:
    """工具定义占多少。API 会把 JSON Schema 换成自己的文本格式,比直接数 JSON 多。
    2026 年 10 月在 DeepSeek 实测:数 JSON 428,API 多收 598,所以乘 1.4。换模型要重测。"""
    return int(count_tokens(json.dumps(tools, ensure_ascii=False)) * 1.4)
```

<div class="line-notes">

- `import json` 数工具定义要先把它转成字符串。
- `from tokenizers import Tokenizer` Day 108 装的 Hugging Face `tokenizers`,专门读 `tokenizer.json`。
- `TOK = Tokenizer.from_file("data/deepseek_v4_tokenizer/tokenizer.json")` Day 107 下载的 DeepSeek 官方分词器。模块一导入就加载一次,约 6.4 MB,以后每次数 token 都用它。
- `PER_MESSAGE = 4` 每条消息在接口那边要多收的格式开销。Day 109 实测过,平均每条两三个,取 4 是往多了估。
- `def estimate_tokens(text: str) -> int:` 第一种数法:**粗估**,不加载任何分词器。什么时候用?在没有对应分词器的场合(换了别家模型、前端里、不想装 6 MB 的文件)。
- `wide = sum(ord(ch) > 127 for ch in text)` `ord(ch)` 是字符的编码,汉字和中文标点都大于 127,英文字母、数字、半角符号都不大于。比如「年付企业版,退款」这 8 个字符(含一个半角逗号)里,7 个汉字编码大于 127,`wide = 7`。
- `return int(wide * 0.8 + (len(text) - wide) * 0.35) + 1` 非 ASCII 每个算 0.8 个 token,ASCII 每个算 0.35 个。这两个系数是我在今天的几块文本上拟合出来的:汉字 + 中文标点平均略低于 1 个 token,英文和 JSON 符号大约 3 个字符一个。上面例子:7 × 0.8 + 1 × 0.35 = 5.95,`int` 取整得 5,再加 1,估算 6。`+ 1` 保证空字符串以外的文本至少算 1 个。
- `def count_tokens(text: str) -> int:` 第二种数法:用真分词器数。
- `return len(TOK.encode(text, add_special_tokens=False).ids)` `encode` 把文字切成 token,`.ids` 是 token 编号列表,`len` 就是个数。`add_special_tokens=False` 不加开头结尾的特殊标记,只数文本本身。
- `def message_text(m: dict) -> str:` 一条消息里模型会看到的全部文字。
- `text = str(m.get("content") or "")` assistant 调工具时 `content` 是 `None`,`or ""` 换成空串。`m.get("content")` 在键不存在时返回 `None`,不会像 `m["content"]` 那样抛 `KeyError`。
- `for call in m.get("tool_calls") or []:` 没有 `tool_calls` 就当空列表,循环不执行。
- `text += call["function"]["name"] + call["function"]["arguments"]` 把函数名和参数字符串也算进去,比如 `list_invoices{"customer_id": "C-0001", "limit": 5}`。
- `def message_tokens(m: dict) -> int:` 一条消息的总数。
- `return count_tokens(message_text(m)) + PER_MESSAGE` 内容的 token 数加上格式开销。
- `def tools_tokens(tools: list[dict]) -> int:` 工具定义占多少。
- `return int(count_tokens(json.dumps(tools, ensure_ascii=False)) * 1.4)` 先转成 JSON 字符串数,再乘 1.4。为什么要乘?因为 API 不是把你的 JSON 原样发给模型,而是换成它自己的文本格式,通常更长。我在 DeepSeek 上用同一条消息发两次,一次不带 `tools`、一次带,两次的 `prompt_tokens` 之差是 598,而直接数 JSON 只有 428,比值 1.4。**这个 1.4 是同一组数据上量出来的,所以它在这组数据上准是理所当然的**,下面练习 5 会换一批工具检验。

</div>

三种数法放在一起看。新建 `part04/ctx_count.py`:

```python
# agent-zero-lab/part04/ctx_count.py  同一次调用,三种数对着看:粗估、真分词器、API 返回的 prompt_tokens
import json

from common.llm import LLMClient
from part04.ctx_blocks import MEMORY, SYSTEM, TOOLS, make_history, retrieved_block
from part04.ctx_budget import PER_MESSAGE, count_tokens, estimate_tokens, message_text, tools_tokens

question = "我们是年付企业版,买错了想退款,能退多少?"
memory = "【关于这位客户的记忆】\n" + "\n".join(f"- {m}" for m in MEMORY)
retrieved = retrieved_block(["kb-002", "kb-001", "kb-003", "kb-005"])
history = make_history(9)

# 三块文字合在一条 system 消息里,历史和问题各是自己的消息
system_all = SYSTEM + "\n\n" + memory + "\n\n" + retrieved
messages = [{"role": "system", "content": system_all}, *history, {"role": "user", "content": question}]

blocks = {
    "系统提示词": SYSTEM,
    "记忆": memory,
    "检索资料": retrieved,
    "对话历史": "".join(message_text(m) for m in history),
    "本轮问题": question,
}
print(f"{'块':<8}{'粗估':>6}{'真分词器':>9}")
ours = PER_MESSAGE  # system 那条消息的开销
for name, text in blocks.items():
    print(f"{name:<8}{estimate_tokens(text):>6}{count_tokens(text):>9}")
    ours += count_tokens(text)
ours += PER_MESSAGE * (len(history) + 1)  # 历史每条、再加最后的 user,各一份开销
tools_est = tools_tokens(TOOLS)
print(f"{'工具定义':<8}{estimate_tokens(json.dumps(TOOLS, ensure_ascii=False)):>6}{tools_est:>9}")

client = LLMClient()
no_tools = client.chat(messages, max_tokens=5)
with_tools = client.chat(messages, tools=TOOLS, max_tokens=5)
print(f"\n我们算的总数(不含工具): {ours}   API 的 prompt_tokens: {no_tools.prompt_tokens}   差 {no_tools.prompt_tokens - ours:+d}")
print(f"带上工具后 API 的 prompt_tokens: {with_tools.prompt_tokens}   工具实际多收 {with_tools.prompt_tokens - no_tools.prompt_tokens}  我们估 {tools_est}")
print(client.ledger)
```

<div class="line-notes">

- `import json` 数工具定义粗估要用。
- `from part04.ctx_blocks import MEMORY, SYSTEM, TOOLS, make_history, retrieved_block` 取上面造好的原料。
- `from part04.ctx_budget import PER_MESSAGE, count_tokens, estimate_tokens, message_text, tools_tokens` 取三种数 token 的工具。
- `question = "我们是年付企业版,买错了想退款,能退多少?"` 本轮用户的问题。
- `memory = "【关于这位客户的记忆】\n" + "\n".join(f"- {m}" for m in MEMORY)` 三条记忆变成一段文字,每条前面加 `- `,类似 Markdown 的列表。
- `retrieved = retrieved_block(["kb-002", "kb-001", "kb-003", "kb-005"])` 假装检索返回了 4 篇:退款政策、套餐价格、如何申请退款、自动续费(`kb-005`)。真实 RAG 里 id 是 `retrieve()` 返回的,今天固定下来方便反复跑。
- `history = make_history(9)` 9 轮历史,24 条消息。
- `system_all = SYSTEM + "\n\n" + memory + "\n\n" + retrieved` 系统提示词、记忆、资料合成一条 system 消息。三块放在同一条里,是常见做法,也方便让缓存命中:前面不变的部分在最前面。
- `messages = [{"role": "system", "content": system_all}, *history, {"role": "user", "content": question}]` 最终的消息列表:1 条 system,24 条历史,1 条 user,共 26 条。`*history` 是展开,相当于 JS 的 `...history`。
- `blocks = {` 五块文字(工具定义单独处理)。对话历史那一块用 `"".join(message_text(m) for m in history)` 把每条消息的文字接起来。
- `print(f"{'块':<8}{'粗估':>6}{'真分词器':>9}")` 打印表头。`:<8` 左对齐宽 8。
- `ours = PER_MESSAGE` 要算「我们自己算出来的总数」,先把 system 那条消息的开销 4 记上。
- `for name, text in blocks.items():` 字典的 `.items()`(Day 24)同时给出键和值。
- `print(f"{name:<8}{estimate_tokens(text):>6}{count_tokens(text):>9}")` 每块打印粗估和真分词器两个数。比如系统提示词:粗估 193,真 172,粗估多了 12%。
- `ours += count_tokens(text)` 把真分词器数出来的加进总数。
- `ours += PER_MESSAGE * (len(history) + 1)` 历史的 24 条再加最后的 1 条 user,每条一份格式开销:25 × 4 = 100。
- `tools_est = tools_tokens(TOOLS)` 工具定义的估计值,599。
- `no_tools = client.chat(messages, max_tokens=5)` 发一次真请求,不带工具。`max_tokens=5` 让它最多输出 5 个 token,我们只要 usage,不要回答,几乎不花钱。
- `with_tools = client.chat(messages, tools=TOOLS, max_tokens=5)` 同样的消息,再发一次,这次带 `tools`。
- `print(f"\n我们算的总数(不含工具):` `:+d` 让正数也带加号。API 报 2148,我们算 2057,差 +91,也就是 API 多收了 4.2%。
- `print(f"带上工具后 API 的 prompt_tokens:` 带工具后 2746,比不带多 598,这就是工具定义的真实开销。我们估 599。

</div>

```bash
uv run python -m part04.ctx_count
```

实跑输出:

```text
块           粗估     真分词器
系统提示词      193      172
记忆          61       65
检索资料       634      609
对话历史       970     1092
本轮问题        16       15
工具定义       526      599

我们算的总数(不含工具): 2057   API 的 prompt_tokens: 2148   差 +91
带上工具后 API 的 prompt_tokens: 2746   工具实际多收 598  我们估 599
2 次调用 | 输入 4894 / 输出 10 tokens | 约 ¥0.0011
```

这张表有四个发现。

**粗估和真分词器差在 ±15% 左右,单块有时多有时少。** 系统提示词粗估多了 12%,对话历史少了 11%。对话历史里有大量 JSON(ASCII 符号多),我拟合系数时把它和中文混在一起算了平均,所以单块不准。粗估的用处是「估个量级、不加载分词器」,**不是替代它**。

**真分词器数出来的总数比 API 少 91(4.2%)。** 少的是哪里?Day 109 说格式开销大约每条两三个,这里 `PER_MESSAGE = 4` 已经往多了估,按理不该少。下面一节专门查。

**工具定义占了 599,是系统提示词的三倍多。** 很多人写上下文预算,只数系统提示词和历史,忘了工具定义。四个工具就 600 个 token,工具多到几十个时(MCP 一接就是几十个),这一块能到几千。而且它每次调用都在。

**换一个模型,所有数字都要重测。** 分词器是 DeepSeek 的,工具定义的 1.4 倍是 DeepSeek 接口的行为。换成别家模型,分词器、格式开销、工具的展开方式都可能不同。所以预算脚本里的系数只代表「我现在用的这个模型」。

### 少算的那 91 个 token 在哪

我的怀疑是带 `tool_calls` 的那几条消息:调用编号、`function` 这类结构字段,`message_text` 只数了函数名和参数。验证的办法是做一个对照:同一段历史,一份原样,一份把工具调用和工具结果去掉,各自对一次账。新建 `part04/ctx_gap.py`:

```python
# agent-zero-lab/part04/ctx_gap.py  我们少算的那 91 个 token 到底在哪:对比有没有工具调用的两段历史
from common.llm import LLMClient
from part04.ctx_blocks import SYSTEM, make_history
from part04.ctx_budget import message_tokens

client = LLMClient()
full = make_history(9)
plain = [m for m in full if m["role"] == "user" or (m["role"] == "assistant" and not m.get("tool_calls"))]

for name, history in (("带工具调用", full), ("去掉工具调用", plain)):
    messages = [{"role": "system", "content": SYSTEM}, *history, {"role": "user", "content": "好"}]
    ours = sum(message_tokens(m) for m in messages)
    real = client.chat(messages, max_tokens=1).prompt_tokens
    print(f"{name}: {len(messages)} 条,我们算 {ours},API 报 {real},差 {real - ours:+d}")
```

<div class="line-notes">

- `full = make_history(9)` 原样的 9 轮历史,24 条消息,里面有 3 对工具调用和工具结果。
- `plain = [m for m in full if m["role"] == "user" or (m["role"] == "assistant" and not m.get("tool_calls"))]` 列表推导式加过滤:只留 user 消息,和不带 `tool_calls` 的 assistant 消息。`tool` 消息和发起调用的 assistant 消息都不满足条件,被丢掉。24 条里去掉 3 × 2 = 6 条,剩 18 条。注意括号:`or` 前后是两个条件,后一个里 `and` 要整体括起来,不括的话 `and` 的优先级虽然更高,读起来也容易看错。
- `for name, history in (("带工具调用", full), ("去掉工具调用", plain)):` 对两份历史各做一遍。外层括号里是两个二元组,循环变量一次拆成 `name` 和 `history`。
- `messages = [{"role": "system", "content": SYSTEM}, *history, {"role": "user", "content": "好"}]` 前后各加一条 system 和 user,总数分别是 26 条和 20 条。
- `ours = sum(message_tokens(m) for m in messages)` 我们的算法:每条的内容 token 加 4,`message_tokens` 会把 `tool_calls` 里的函数名和参数也算进去。
- `real = client.chat(messages, max_tokens=1).prompt_tokens` 真发一次,拿 API 的数。`max_tokens=1` 只要一个输出 token,几乎不花钱。

</div>

```bash
uv run python -m part04.ctx_gap
```

实跑输出:

```text
带工具调用: 26 条,我们算 1372,API 报 1459,差 +87
去掉工具调用: 20 条,我们算 685,API 报 646,差 -39
```

没有工具调用的 20 条,我们**多算**了 39:每条 4 个的开销比实际大。带上那 6 条工具相关消息,变成**少算** 87。两个数相差 126,平均每条工具相关消息多收约 21 个 token,调用编号、字段名、工具消息的角色标记都在里面。所以结论是:`message_tokens` 对普通消息偏多、对工具调用偏少,总数混在一起看就是差几个百分点。**做预算要留余量,但也别以为余量能解释所有差距,最好像这样做对照找出原因。**

### 为什么不每次都问 API

看到这里你可能会想:为什么不干脆每次都调一遍 API 看 `prompt_tokens`?因为你要在**发之前**知道它超不超。发出去才知道,钱已经花了,超窗口的话还会收到 400。本地能数的就在本地数,API 的 `usage` 用来对账、校准系数。这和 Day 109 的思路一样。

## 第二步:给每块定上限,出预算表

数清楚之后,下一步是给每块定一个上限。这个上限是**我们自己定的预算**,不是模型的限制(模型的窗口是 1,048,576 个 token,我们离用满差得很远)。怎么定?先看每块平时占多少,再考虑它的性质:

- 系统提示词和工具定义是自己写的,平时 172 和 599,上限给到 300 和 700,留一点改提示词时加规则的余地。超了的话,不是运行时裁,是要回去改提示词,所以脚本里超了会直接报错。
- 记忆给 200。记忆是几条短事实,太长说明记忆写得有问题。
- 检索资料给 800。4 篇平时 609,到 k=8 就是 991,超了。这个值不是拍脑袋:Day 261 说 k 从 4 改 8 多了 46% 的输入,要不要为这点付钱,是拿评估集去量的。预算表给的是「默认不超过多少」,改它之前先跑一次实验。
- 对话历史给 2500。它是唯一会无限长的。
- 本轮问题给 300,够一段正常的话。

六块加起来 4800,再给输出留 1000(调用时 `max_tokens=1000`)。算算钱:4800 个输入 token 全部不命中缓存,是 4800 × 2 元 / 百万 = ¥0.0096,一次不到一分钱,Agent 跑 20 步最多两毛。这就是预算的价值:它让「一次任务最贵多少」有了上界。

新建 `part04/ctx_report.py`:

```python
# agent-zero-lab/part04/ctx_report.py  预算表:每一块定上限,实际占多少,哪块超了
from part04.ctx_blocks import MEMORY, SYSTEM, TOOLS, make_history, retrieved_block
from part04.ctx_budget import count_tokens, message_tokens, tools_tokens

# 每块的上限(token)。这是我们自己定的预算,不是模型的限制,模型窗口是 1,048,576
LIMITS = {"系统提示词": 300, "工具定义": 700, "记忆": 200, "检索资料": 800, "对话历史": 2500, "本轮问题": 300}
OUTPUT_RESERVE = 1000  # 给回答留的位置,调用时把 max_tokens 设成它


def block_counts(system: str, tools: list[dict], memory: str, retrieved: str,
                 history: list[dict], question: str) -> dict[str, int]:
    """六块各占多少 token。"""
    return {
        "系统提示词": count_tokens(system),
        "工具定义": tools_tokens(tools),
        "记忆": count_tokens(memory),
        "检索资料": count_tokens(retrieved),
        "对话历史": sum(message_tokens(m) for m in history),
        "本轮问题": count_tokens(question),
    }


def print_report(counts: dict[str, int]) -> list[str]:
    """打印预算表,返回超限的块名。"""
    over = []
    print(f"{'块':<8}{'占用':>6}{'上限':>6}  状态")
    for name, used in counts.items():
        limit = LIMITS[name]
        flag = "超了" if used > limit else "ok"
        if used > limit:
            over.append(name)
        print(f"{name:<8}{used:>6}{limit:>6}  {flag}" + (f"(多 {used - limit})" if used > limit else ""))
    total, budget = sum(counts.values()), sum(LIMITS.values())
    print(f"{'合计':<8}{total:>6}{budget:>6}  输出另留 {OUTPUT_RESERVE}")
    return over


if __name__ == "__main__":
    memory = "【关于这位客户的记忆】\n" + "\n".join(f"- {m}" for m in MEMORY)
    ids = ["kb-002", "kb-001", "kb-003", "kb-005", "kb-004", "kb-009", "kb-006", "kb-007"]  # 假装 k=8
    counts = block_counts(SYSTEM, TOOLS, memory, retrieved_block(ids), make_history(24), "我们是年付企业版,能退多少?")
    over = print_report(counts)
    print("超限的块:", over)
```

<div class="line-notes">

- `from part04.ctx_blocks import MEMORY, SYSTEM, TOOLS, make_history, retrieved_block` 取原料。
- `from part04.ctx_budget import count_tokens, message_tokens, tools_tokens` 取数 token 的工具。
- `LIMITS = {"系统提示词": 300,` 六块的上限,一个字典,键是块名。写成一处,后面的预算表、裁剪、检查都读它,改预算只改这一行。
- `OUTPUT_RESERVE = 1000` 给回答留的位置。调用时 `max_tokens` 用它。
- `def block_counts(system: str, tools: list[dict], memory: str, retrieved: str,` 六块原料进,六个数出。参数换行写,续行缩进对齐括号。
- `"系统提示词": count_tokens(system),` 文字用真分词器数,实测 172。
- `"工具定义": tools_tokens(tools),` 工具定义用上面那个乘 1.4 的函数,实测 599。
- `"记忆": count_tokens(memory),` 实测 65。
- `"检索资料": count_tokens(retrieved),` 4 篇时 609,8 篇时 991。
- `"对话历史": sum(message_tokens(m) for m in history),` 每条消息各自加开销再求和,24 轮历史(64 条消息)是 3176。
- `"本轮问题": count_tokens(question),` 一句话,几十个 token 以内。
- `def print_report(counts: dict[str, int]) -> list[str]:` 打印预算表,同时返回超限的块名,方便调用方决定怎么处理。
- `over = []` 收集超限的块名。
- `print(f"{'块':<8}{'占用':>6}{'上限':>6}  状态")` 表头。中文在终端里一个字占两格宽,所以 `:<8` 对中文的对齐只是大概,不严格。
- `for name, used in counts.items():` 逐块过。
- `limit = LIMITS[name]` 取这一块的上限,键名要和 `block_counts` 里的一致,拼错会抛 `KeyError`。
- `flag = "超了" if used > limit else "ok"` 三元表达式。
- `if used > limit:` 超限的记下来。
- `over.append(name)` 对「检索资料」这行来说,`used = 991`、`limit = 800`,`991 > 800` 成立,`over` 变成 `["检索资料"]`。
- `print(f"{name:<8}{used:>6}{limit:>6}  {flag}"` 一行输出,超了的在后面补一个「(多 N)」。
- `total, budget = sum(counts.values()), sum(LIMITS.values())` 一行给两个变量赋值。`counts.values()` 是所有占用,加起来是 5013;`LIMITS.values()` 加起来是 4800。
- `print(f"{'合计':<8}` 合计行,最后写明输出另留 1000。
- `return over` 返回超限的块。
- `if __name__ == "__main__":` 直接运行这个文件才执行下面,被别的文件导入时不执行(Day 32 讲过)。
- `memory = "【关于这位客户的记忆】\n"` 和 `ctx_count.py` 里一样的拼法。
- `ids = [` 假装检索 k=8 返回了 8 篇。
- `counts = block_counts(` 24 轮历史,8 篇资料。
- `over = print_report(counts)` 打印表,拿到超限名单。
- `print("超限的块:", over)` 打印名单。

</div>

```bash
uv run python -m part04.ctx_report
```

实跑输出:

```text
块           占用    上限  状态
系统提示词      172   300  ok
工具定义       599   700  ok
记忆          65   200  ok
检索资料       991   800  超了(多 191)
对话历史      3176  2500  超了(多 676)
本轮问题        10   300  ok
合计        5013  4800  输出另留 1000
超限的块: ['检索资料', '对话历史']
```

两块超了:检索资料多 191,对话历史多 676。合计 5013,比 4800 多 213。**表里最该看的是「谁超了」,不是合计**。合计超了 213,但检索资料那块只要去掉一篇,历史那块裁掉几轮,就都回来了。

## 第三步:对话历史会一直长,要按「轮」裁

检索资料超了,少取几篇就行,取的是排名最低的。对话历史怎么裁?Day 109 的办法是 `rest.pop(0)`,一条一条丢最早的。那个办法在只有 user 和 assistant 两种消息时没问题。今天历史里多了工具调用,就出事了。

### 为什么按条裁会出事

回忆 [Day 158](/blog/agent-zero/day-158-fc-first-run/) 学的:模型要调工具时,assistant 消息里带 `tool_calls`,里面有每个调用的编号 `id`;你执行完工具,要追加一条 `role` 为 `tool` 的消息,`tool_call_id` 写同一个编号。接口会检查这两样东西是不是**成对**。

一条一条往前丢的时候,有可能正好把带 `tool_calls` 的 assistant 消息丢了,而它后面的 `tool` 消息还在。拿 `make_history(4)` 当小例子,10 条消息,每条的 token 数是:

| 下标 | 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| role | user | assistant | user | assistant | user | assistant(调工具) | **tool** | assistant | user | assistant |
| token | 28 | 28 | 28 | 28 | 28 | 23 | 206 | 28 | 28 | 28 |

总共 453。预算 300 时,`trim_by_message` 从头丢:丢下标 0 剩 425,丢 1 剩 397,2 → 369,3 → 341,4 → 313,5 → 290,这时 290 ≤ 300,停。剩下的是下标 6 开始的 4 条,**第一条正好是 tool 消息,而发起这个调用的 assistant 消息(下标 5)被丢了**。

新建 `part04/trim_turns.py`,先把「检查是否成对」写出来,再写两种裁法:

```python
# agent-zero-lab/part04/trim_turns.py  按条裁会把工具调用拆散;按轮裁才安全
from part04.ctx_blocks import make_history
from part04.ctx_budget import message_tokens


def check_pairs(messages: list[dict]) -> str | None:
    """检查工具调用是不是成对的。没问题返回 None,有问题返回一句话说明。"""
    pending: set[str] = set()  # 已经发出、还在等结果的 tool_call id
    for i, m in enumerate(messages):
        if m["role"] == "tool":
            if m["tool_call_id"] not in pending:
                return f"第 {i} 条是 tool 消息,但前面没有对应的 tool_calls"
            pending.discard(m["tool_call_id"])
        elif pending:
            return f"第 {i} 条之前还有 {len(pending)} 个工具调用没等到结果"
        if m.get("tool_calls"):
            pending = {c["id"] for c in m["tool_calls"]}
    return f"最后还有 {len(pending)} 个工具调用没等到结果" if pending else None


def trim_by_message(history: list[dict], budget: int) -> list[dict]:
    """Day 109 的写法:超预算就从最早的一条开始丢。"""
    rest = list(history)
    while rest and sum(message_tokens(m) for m in rest) > budget:
        rest.pop(0)
    return rest


def split_turns(history: list[dict]) -> list[list[dict]]:
    """切成「轮」:遇到 user 消息就开新的一轮,其余消息(assistant、tool)跟在它后面。"""
    turns: list[list[dict]] = []
    for m in history:
        if m["role"] == "user" or not turns:
            turns.append([m])
        else:
            turns[-1].append(m)
    return turns


def trim_by_turn(history: list[dict], budget: int) -> list[dict]:
    """从最新的一轮往回装,装不下就停;整轮要么全留要么全丢。最新一轮无论多大都留。"""
    kept: list[list[dict]] = []
    used = 0
    for turn in reversed(split_turns(history)):
        cost = sum(message_tokens(m) for m in turn)
        if used + cost > budget and kept:
            break
        kept.append(turn)
        used += cost
    return [m for turn in reversed(kept) for m in turn]


if __name__ == "__main__":
    history = make_history(24)
    print(f"原始历史 {len(history)} 条,{sum(message_tokens(m) for m in history)} token,成对检查:{check_pairs(history)}")
    bad = 0
    budgets = range(500, 3001, 50)
    for b in budgets:
        if check_pairs(trim_by_message(history, b)):
            bad += 1
    print(f"预算从 500 到 3000(每 50 一档,共 {len(budgets)} 档):按条裁有 {bad} 档把工具调用拆坏了")
    for b in (1000, 1050, 1100):
        out = trim_by_message(history, b)
        print(f"预算 {b}: 按条裁留 {len(out)} 条,第一条是 {out[0]['role']},检查:{check_pairs(out)}")
    bad2 = sum(1 for b in budgets if check_pairs(trim_by_turn(history, b)))
    print(f"同样 {len(budgets)} 档,按轮裁拆坏了 {bad2} 档")
    out = trim_by_turn(history, 1000)
    print(f"预算 1000: 按轮裁留 {len(out)} 条 {sum(message_tokens(m) for m in out)} token,第一条是 {out[0]['role']},检查:{check_pairs(out)}")
```

<div class="line-notes">

- `from part04.ctx_blocks import make_history` 下面 `__main__` 里造测试数据。
- `from part04.ctx_budget import message_tokens` 每条消息多少 token。
- `def check_pairs(messages: list[dict]) -> str | None:` 检查工具调用是否成对。没问题返回 `None`,有问题返回一句话。`str | None` 是类型提示,意思是「要么字符串要么 None」,相当于 TS 的 `string | null`。
- `pending: set[str] = set()` 一个集合(Day 25),装「已经发出调用、还在等结果」的编号。用集合是因为一条 assistant 消息可以并行调多个工具(Day 162),要等多个结果。
- `for i, m in enumerate(messages):` 从头往后扫,`i` 是下标。
- `if m["role"] == "tool":` 遇到工具结果消息。
- `if m["tool_call_id"] not in pending:` 它的编号不在等待名单里,说明前面没有人发过这个调用,就是我们要抓的情况。
- `return f"第 {i} 条是 tool 消息,但前面没有对应的 tool_calls"` 比如上面预算 300 的结果,第 0 条就是 tool,`pending` 是空集,条件成立,报「第 0 条是 tool 消息」。
- `pending.discard(m["tool_call_id"])` 正常的话,收到结果就把编号从等待名单里划掉。`discard` 在编号不存在时不报错,`remove` 会报。
- `elif pending:` 这条不是 tool 消息,但名单里还有没等到结果的调用:说明调用发出后,不是紧跟着结果。空集是假值,所以只有名单非空才进来。
- `return f"第 {i} 条之前还有 {len(pending)} 个工具调用没等到结果"` 反方向的错:有调用没结果。DeepSeek 对这种情况也会返回 400,下面会看到原文。
- `if m.get("tool_calls"):` 这条是发起调用的 assistant 消息。放在 `elif` 之后检查,是因为调用消息本身不是 tool、也要先判断前面有没有悬空的调用。
- `pending = {c["id"] for c in m["tool_calls"]}` 集合推导式,用花括号,把这条消息发起的所有调用编号收进等待名单。
- `return f"最后还有 {len(pending)} 个工具调用没等到结果" if pending else None` 扫完了,名单不空就是最后一条调用没有结果。整句是一个三元表达式。
- `def trim_by_message(history: list[dict], budget: int) -> list[dict]:` Day 109 的按条裁,原样搬来。
- `rest = list(history)` 复制一份,不要改调用方的列表。
- `while rest and sum(message_tokens(m) for m in rest) > budget:` 还有消息、总数还超,就继续。
- `rest.pop(0)` 丢掉第一条,相当于 JS 的 `rest.shift()`。
- `return rest` 返回剩下的。
- `def split_turns(history: list[dict]) -> list[list[dict]]:` 把平铺的消息切成「轮」。
- `turns: list[list[dict]] = []` 列表的列表。
- `for m in history:` 逐条看。
- `if m["role"] == "user" or not turns:` 遇到 user 就开一个新的轮。`or not turns` 是兜底:历史不是以 user 开头时,也要先开一轮,否则下面 `turns[-1]` 在空列表上会抛 `IndexError`。
- `turns.append([m])` 开新轮:新增一个只含这条消息的小列表。
- `turns[-1].append(m)` 其余消息(assistant、tool)追加到最后一轮。`[-1]` 是最后一个元素,相当于 JS 的 `.at(-1)`。比如 `make_history(4)` 的第 3 轮会变成 `[user, assistant(调工具), tool, assistant]` 四条一组。
- `return turns` 返回切好的轮。
- `def trim_by_turn(history: list[dict], budget: int) -> list[dict]:` 按轮裁。
- `kept: list[list[dict]] = []` 装要留的轮。
- `used = 0` 目前留下的轮占了多少。
- `for turn in reversed(split_turns(history)):` 从最新的一轮往回看,最近的对话最重要。
- `cost = sum(message_tokens(m) for m in turn)` 这一轮总共多少。以 `make_history(4)` 为例,从新到旧四轮分别是 56、285、56、56。
- `if used + cost > budget and kept:` 装下这一轮会超,并且已经装了至少一轮,就停。`and kept` 的意思:`kept` 还是空的时候,超了也要装,**最新一轮无论多大都必须留**,否则用户刚问的话都没了。
- `break` 跳出循环,更早的轮都不要了。
- `kept.append(turn)` 装下这一轮。
- `used += cost` 更新占用。
- `return [m for turn in reversed(kept) for m in turn]` `kept` 是从新到旧存的,`reversed` 翻回时间顺序,双层推导式把「轮的列表」摊平成「消息的列表」,相当于 JS 的 `kept.reverse().flat()`。
- `if __name__ == "__main__":` 下面是演示。
- `history = make_history(24)` 24 轮,64 条消息。
- `print(f"原始历史` 先检查原始历史本身没有问题,`check_pairs` 返回 `None`。
- `bad = 0` 计数:按条裁有多少个预算会把它弄坏。
- `budgets = range(500, 3001, 50)` 从 500 到 3000,每 50 一档,共 51 档。
- `for b in budgets:` 逐档试。
- `if check_pairs(trim_by_message(history, b)):` 裁完检查,返回的是字符串(非空,真值)就说明坏了。
- `bad += 1` 计一次。
- `print(f"预算从 500` 打印结果。
- `for b in (1000, 1050, 1100):` 挑三个预算,看按条裁的具体样子。
- `out = trim_by_message(history, b)` 按条裁。
- `print(f"预算 {b}: 按条裁` 打印留了几条、第一条是谁、检查结果。
- `bad2 = sum(` 同样 51 档,换成按轮裁,统计坏的个数。`sum` 把布尔值当 0/1 加起来。
- `print(f"同样 {len(budgets)} 档` 打印。
- `out = trim_by_turn(history, 1000)` 预算 1000 时按轮裁。
- `print(f"预算 1000: 按轮裁` 打印。

</div>

```bash
uv run python -m part04.trim_turns
```

实跑输出:

```text
原始历史 64 条,3176 token,成对检查:None
预算从 500 到 3000(每 50 一档,共 51 档):按条裁有 2 档把工具调用拆坏了
预算 1000: 按条裁留 17 条,第一条是 assistant,检查:None
预算 1050: 按条裁留 18 条,第一条是 tool,检查:第 0 条是 tool 消息,但前面没有对应的 tool_calls
预算 1100: 按条裁留 20 条,第一条是 user,检查:None
同样 51 档,按轮裁拆坏了 0 档
预算 1000: 按轮裁留 16 条 794 token,第一条是 user,检查:None
```

51 档预算里,按条裁有 2 档把工具调用拆坏了。看起来不多,我挑的是其中的 1050:留 18 条,第一条是 `tool`。同样的 51 档,按轮裁一档都没坏。

再看预算 1000 那行,按条裁留了 17 条,第一条是 `assistant`,`check_pairs` 说没问题。但它没有「拆坏」之外的毛病吗?有:留下的第一条是一句 assistant 的回答,**它回答的那个问题已经被丢了**。接口不会报错,模型看到的却是一段从半截开始的对话。按轮裁没有这个问题,第一条永远是 user。

2/51 这个比例是怎么来的?历史里只有 8 条 tool 消息,占 64 条的八分之一,预算落在「刚好切在调用和结果之间」的窗口很窄。窄不等于不会发生:Agent 每走一步历史就长一点,跑几百个会话,一定有几次撞上。**线上第一次撞上的时候,用户那边看到的就是整个对话突然 400**。

### 真发给 API 看看

新建 `part04/trim_naive_400.py`,把预算 1050 下按条裁和按轮裁出来的两份历史,各发一次:

```python
# agent-zero-lab/part04/trim_naive_400.py  按条裁出的坏历史,真发给 API 会怎样
from common.llm import LLMClient
from part04.ctx_blocks import SYSTEM, TOOLS, make_history
from part04.trim_turns import check_pairs, trim_by_message, trim_by_turn

client = LLMClient()
history = make_history(24)
question = {"role": "user", "content": "那我这单年付的能退多少?"}

for name, fn in (("按条裁", trim_by_message), ("按轮裁", trim_by_turn)):
    kept = fn(history, 1050)
    messages = [{"role": "system", "content": SYSTEM}, *kept, question]
    print(f"{name}: 留 {len(kept)} 条,第一条是 {kept[0]['role']},检查结果:{check_pairs(kept)}")
    try:
        r = client.chat(messages, tools=TOOLS, max_tokens=200)
        calls = [c["function"]["name"] for c in r.message.get("tool_calls", [])]
        print(f"  → 成功,finish_reason={r.finish_reason},调用工具:{calls},输入 {r.prompt_tokens} token")
    except Exception as e:  # 400 会抛 openai.BadRequestError,这里只想看报错原文
        print(f"  → {type(e).__name__}: {e}")
```

<div class="line-notes">

- `from part04.trim_turns import check_pairs, trim_by_message, trim_by_turn` 取上面写好的三个函数。
- `client = LLMClient()` 一个客户端。
- `history = make_history(24)` 24 轮历史。
- `question = {"role": "user", "content": "那我这单年付的能退多少?"}` 本轮问题,放在最后。
- `for name, fn in (("按条裁", trim_by_message), ("按轮裁", trim_by_turn)):` 把函数当值放进元组里循环,Python 里函数是一等公民,和 JS 一样。`fn` 先是 `trim_by_message`,再是 `trim_by_turn`。
- `kept = fn(history, 1050)` 调当前这一种裁法,预算 1050。
- `messages = [{"role": "system", "content": SYSTEM}, *kept, question]` 拼成请求。
- `print(f"{name}: 留 {len(kept)} 条` 先本地检查并打印:按条裁留 18 条第一条是 tool;按轮裁留 16 条第一条是 user。
- `r = client.chat(messages, tools=TOOLS, max_tokens=200)` 真发。带上工具定义,因为历史里有工具调用。我第一次没带,模型的回答里混进了一段 `<｜｜DSML｜｜` 开头的原始调用标记,明显不对。
- `calls = [c["function"]["name"] for c in r.message.get("tool_calls", [])]` 如果模型这一步又要调工具,把工具名收集起来。`r.message` 是整条 assistant 消息(字典),`.get("tool_calls", [])` 没有就当空列表。
- `print(f"  → 成功,finish_reason=` 成功就打印结束原因和调用了什么工具。
- `except Exception as e:` 400 会抛 `openai.BadRequestError`。这里为了看报错原文,捕获所有异常再打印类型名和消息。真实代码里不该这么宽泛地捕获,Day 35–36 讲过。

</div>

```bash
uv run python -m part04.trim_naive_400
```

实跑输出:

```text
按条裁: 留 18 条,第一条是 tool,检查结果:第 0 条是 tool 消息,但前面没有对应的 tool_calls
  → BadRequestError: Error code: 400 - {'error': {'message': "Messages with role 'tool' must be a response to a preceding message with 'tool_calls' (request_id: c796b95b-bf33-46ab-9cca-4776798c20bf)", 'type': 'invalid_request_error', 'param': None, 'code': 'invalid_request_error'}}
按轮裁: 留 16 条,第一条是 user,检查结果:None
  → 成功,finish_reason=tool_calls,调用工具:['find_customer'],输入 1639 token
```

按条裁的那份,接口直接回 400:`Messages with role 'tool' must be a response to a preceding message with 'tool_calls'`。意思是:有一条 `tool` 消息,它前面没有带 `tool_calls` 的消息。按轮裁的那份正常,模型回了一个 `find_customer` 的调用,输入 1639 个 token。

反过来的错也能复现(留着带 `tool_calls` 的 assistant,却把后面的 `tool` 丢了),DeepSeek 报的是:`An assistant message with 'tool_calls' must be followed by tool messages responding to each 'tool_call_id'`。我单独发了一份这样的消息确认过,两种都是 400,不是静默忽略。

### 按轮裁的代价

别以为按轮裁没有缺点。回头看 `make_history(4)` 那个例子,四轮是 56、56、285、56。预算 300 时,从新往旧:第 4 轮 56,装下;第 3 轮 285,56 + 285 = 341 超了,停。结果只剩最后一轮,2 条消息,56 个 token,**预算还剩 244 没用**。那个大的工具轮整个被丢了,更早两个 56 的小轮也跟着没了。

这是按轮的代价:粒度粗,整轮进出。好处是简单、不会出错。粒度的问题,明天用另一种办法解决:不丢整轮,只把工具返回的大块内容换成一行占位。回头看练习 2 的结果就明白为什么明天要这么做:这 64 条消息里,8 条 `tool` 消息占了一半的 token。

## 第四步:拼起来,和 API 对账

零件都有了,拼成一个函数:给它六块原料,它按预算裁好、拼成 `messages` 返回。新建 `part04/ctx_fit.py`:

```python
# agent-zero-lab/part04/ctx_fit.py  把预算接进真实调用:超限的块先裁,再拼成 messages,最后和 API 的 usage 对账
from common.llm import LLMClient
from part04.ctx_blocks import MEMORY, SYSTEM, TOOLS, make_history, retrieved_block
from part04.ctx_budget import PER_MESSAGE, count_tokens
from part04.ctx_report import LIMITS, OUTPUT_RESERVE, block_counts, print_report
from part04.trim_turns import trim_by_turn


def fit_context(system: str, tools: list[dict], memory_lines: list[str], chunk_ids: list[str],
                history: list[dict], question: str) -> tuple[list[dict], dict[str, int]]:
    """按预算拼出 messages。固定块超限直接报错(那是改提示词的事),检索资料和历史超限就裁。"""
    memory = "【关于这位客户的记忆】\n" + "\n".join(f"- {m}" for m in memory_lines)

    # 检索资料:排在后面的是不太相关的,从尾巴开始一篇一篇去掉,直到不超限。至少留 1 篇
    ids = list(chunk_ids)
    while len(ids) > 1 and count_tokens(retrieved_block(ids)) > LIMITS["检索资料"]:
        dropped = ids.pop()
        print(f"  检索资料超限,去掉排在最后的 {dropped}")
    retrieved = retrieved_block(ids)

    # 对话历史:按轮裁
    kept = trim_by_turn(history, LIMITS["对话历史"])
    if len(kept) < len(history):
        print(f"  对话历史超限,{len(history)} 条裁成 {len(kept)} 条")

    counts = block_counts(system, tools, memory, retrieved, kept, question)
    for name in ("系统提示词", "工具定义", "记忆", "本轮问题"):
        if counts[name] > LIMITS[name]:
            raise ValueError(f"{name}占 {counts[name]},超过上限 {LIMITS[name]},要改提示词本身,运行时裁不了")
    system_all = system + "\n\n" + memory + "\n\n" + retrieved
    messages = [{"role": "system", "content": system_all}, *kept, {"role": "user", "content": question}]
    return messages, counts


if __name__ == "__main__":
    ids = ["kb-002", "kb-001", "kb-003", "kb-005", "kb-004", "kb-009", "kb-006", "kb-007"]
    history = make_history(24)
    question = "我们是年付企业版,买错了想退款,能退多少?"

    print("裁之前:")
    full_memory = "【关于这位客户的记忆】\n" + "\n".join(f"- {m}" for m in MEMORY)
    print_report(block_counts(SYSTEM, TOOLS, full_memory, retrieved_block(ids), history, question))

    print("\n裁:")
    messages, counts = fit_context(SYSTEM, TOOLS, MEMORY, ids, history, question)

    print("\n裁之后:")
    print_report(counts)

    predicted = sum(counts.values()) + 2 * PER_MESSAGE  # 历史每条的开销已经算在 counts 里了,再补 system 和最后那条 user 的
    r = LLMClient().chat(messages, tools=TOOLS, max_tokens=OUTPUT_RESERVE)
    print(f"\n我们预测输入 {predicted},API 的 prompt_tokens {r.prompt_tokens},差 {r.prompt_tokens - predicted:+d}({(r.prompt_tokens - predicted) / r.prompt_tokens:.1%})")
    print(f"回答:{r.content[:60]!r} 工具调用:{[c['function']['name'] for c in r.message.get('tool_calls', [])]}  ¥{r.cost:.4f}")
```

<div class="line-notes">

- `from part04.ctx_report import LIMITS, OUTPUT_RESERVE, block_counts, print_report` 预算和预算表。
- `from part04.trim_turns import trim_by_turn` 按轮裁。
- `def fit_context(system: str, tools: list[dict], memory_lines: list[str], chunk_ids: list[str],` 六块原料:系统提示词、工具定义、记忆(一行一条)、检索到的文章 id(**按相关度从高到低排好**)、历史、本轮问题。返回 `(messages, counts)` 两样东西,一个二元组。
- `memory = "【关于这位客户的记忆】\n"` 记忆拼成一段文字。
- `ids = list(chunk_ids)` 复制一份,下面要 `pop`,不能改调用方的列表。
- `while len(ids) > 1 and count_tokens(retrieved_block(ids)) > LIMITS["检索资料"]:` 还有不止一篇、并且这几篇拼出来的资料超限,就继续去掉。`len(ids) > 1` 保证至少留一篇。
- `dropped = ids.pop()` `pop()` 不带参数是取走**最后一个**,也就是排名最低的那篇。相当于 JS 的 `ids.pop()`。
- `print(f"  检索资料超限,去掉排在最后的 {dropped}")` 打印去掉了谁。输出里依次去掉 `kb-007`、`kb-006`、`kb-009`:传进来的顺序是 `kb-002, 001, 003, 005, 004, 009, 006, 007`,从尾巴往前去。8 篇 991 → 去掉 3 篇 → 5 篇 723,不超 800,停。
- `retrieved = retrieved_block(ids)` 用剩下的拼出资料块。
- `kept = trim_by_turn(history, LIMITS["对话历史"])` 历史按轮裁到 2500 以内。
- `if len(kept) < len(history):` 裁掉了东西才提示。
- `print(f"  对话历史超限,{len(history)} 条裁成 {len(kept)} 条")` 实跑:64 条裁成 48 条。
- `counts = block_counts(system, tools, memory, retrieved, kept, question)` 裁完后重新数一遍。
- `for name in ("系统提示词", "工具定义", "记忆", "本轮问题"):` 这四块不裁,只检查。
- `raise ValueError(f"{name}占 {counts[name]},超过上限` 超了就抛错,错误里写清楚是哪块、占多少、上限多少。这类问题要回去改提示词,不是运行时能糊弄过去的。
- `system_all = system + "\n\n" + memory + "\n\n" + retrieved` 三块文字拼成一条 system 消息。
- `messages = [{"role": "system", "content": system_all}, *kept, {"role": "user", "content": question}]` 最终的请求。
- `return messages, counts` 返回消息和各块的占用。
- `ids = ["kb-002", "kb-001", "kb-003", "kb-005", "kb-004", "kb-009", "kb-006", "kb-007"]` 下面是演示:k=8。
- `history = make_history(24)` 24 轮。
- `print("裁之前:")` 先打印裁之前的预算表(检索资料 991、对话历史 3176 超限)。
- `messages, counts = fit_context(SYSTEM, TOOLS, MEMORY, ids, history, question)` 一个函数调用完成所有裁剪。
- `print_report(counts)` 打印裁之后的表:检索资料 723、对话历史 2382,合计 3956。
- `predicted = sum(counts.values()) + 2 * PER_MESSAGE` 预测的输入 token 数。历史每条的开销已经在 `counts["对话历史"]` 里了,再补 system 和最后那条 user 各 4 个,共 3956 + 8 = 3964。
- `r = LLMClient().chat(messages, tools=TOOLS, max_tokens=OUTPUT_RESERVE)` 真发一次,`max_tokens` 用预算里留的 1000。
- `print(f"\n我们预测输入 {predicted},API 的 prompt_tokens` 对账:API 报 4141,我们预测 3964,差 +177,占 4.3%。方向和 `ctx_count.py` 一致:稳定偏小,原因是上面查过的工具调用消息。
- `print(f"回答:` 看模型怎么答:这次没有文字回答,它先调了 `get_subscription` 和 `list_invoices` 两个工具。

</div>

```bash
uv run python -m part04.ctx_fit
```

实跑输出:

```text
裁之前:
块           占用    上限  状态
系统提示词      172   300  ok
工具定义       599   700  ok
记忆          65   200  ok
检索资料       991   800  超了(多 191)
对话历史      3176  2500  超了(多 676)
本轮问题        15   300  ok
合计        5018  4800  输出另留 1000

裁:
  检索资料超限,去掉排在最后的 kb-007
  检索资料超限,去掉排在最后的 kb-006
  检索资料超限,去掉排在最后的 kb-009
  对话历史超限,64 条裁成 48 条

裁之后:
块           占用    上限  状态
系统提示词      172   300  ok
工具定义       599   700  ok
记忆          65   200  ok
检索资料       723   800  ok
对话历史      2382  2500  ok
本轮问题        15   300  ok
合计        3956  4800  输出另留 1000

我们预测输入 3964,API 的 prompt_tokens 4141,差 +177(4.3%)
回答:'' 工具调用:['get_subscription', 'list_invoices']  ¥0.0012
```

从 5018 裁到 3956,模型收到的请求比预测的大 4.3%,在留的余量之内;回答是调用两个工具去查订阅和发票,这正是我们的系统提示词要求它「先查清再答」的行为。

前面各节的代码,在 `ctx_fit.py` 里对应这几处:

| 零件 | 在哪个脚本 | 在 `fit_context` 里的哪一段 |
| --- | --- | --- |
| 六块分别数 token | `ctx_report.block_counts` | 裁完后「重新数一遍」那行 |
| 每块的上限 | `ctx_report.LIMITS` | 两处 `LIMITS[...]` 和固定块的检查 |
| 从排名最低的开始去掉资料 | `ctx_fit.py` 自己 | `while len(ids) > 1 ...` 那个循环 |
| 对话历史按轮裁 | `trim_turns.trim_by_turn` | `kept = trim_by_turn(...)` |
| 预算表 | `ctx_report.print_report` | `__main__` 里裁前裁后各打印一次 |

## 今天的文件

| 文件 | 作用 |
| --- | --- |
| `part04/long_ctx.py` | 实验一:在公告里找一条,看位置和长度有没有影响 |
| `part04/long_ctx_count.py` | 实验二:数数,看误差 |
| `part04/ctx_blocks.py` | 一次客服调用的原料:系统提示词、四个工具、记忆、资料、造历史 |
| `part04/ctx_budget.py` | 粗估、真分词器、消息和工具的 token 数 |
| `part04/ctx_count.py` | 三种数法对账 |
| `part04/ctx_gap.py` | 查少算的 91 个 token 在哪 |
| `part04/ctx_report.py` | 每块上限和预算表 |
| `part04/trim_turns.py` | `check_pairs`、按条裁、`split_turns`、按轮裁 |
| `part04/trim_naive_400.py` | 把坏历史真发出去,看 400 |
| `part04/ctx_fit.py` | `fit_context`:按预算裁剪并拼成 `messages` |

## 动手练习

先自己做,做不出来再展开参考答案。每道题都在 `agent-zero-lab` 根目录运行。

### 练习 1:k 改成 12、历史拉到 40 轮

把 `fit_context` 的输入换成:检索 12 篇(`kb-002, 001, 003, 005, 004, 009, 006, 007, 008, 010, 011, 012`)和 40 轮历史,问题改成「年付能退吗?」。预测一下会去掉几篇资料、历史裁成几条、合计多少 token,再跑。

<details><summary>参考答案</summary>

新建 `part04/ex262_1.py`:

```python
# agent-zero-lab/part04/ex262_1.py  练习 1:k 改成 12、历史拉到 40 轮,预算表怎么变,fit_context 裁掉什么
from part04.ctx_blocks import MEMORY, SYSTEM, TOOLS, make_history
from part04.ctx_fit import fit_context

ids = [f"kb-{n:03d}" for n in (2, 1, 3, 5, 4, 9, 6, 7, 8, 10, 11, 12)]  # 假装 k=12
messages, counts = fit_context(SYSTEM, TOOLS, MEMORY, ids, make_history(40), "年付能退吗?")
print(len(messages), "条消息,合计", sum(counts.values()), "token")
print("历史里最早保留的一条:", messages[1]["role"], str(messages[1]["content"])[:20])
```

<div class="line-notes">

- `ids = [f"kb-{n:03d}" for n in (2, 1, 3, 5, 4, 9, 6, 7, 8, 10, 11, 12)]` 列表推导式生成编号:`{n:03d}` 把 2 补成 `002`,所以得到 `kb-002`、`kb-001` 这样的字符串,顺序就是传进去的这个数字顺序。
- `messages, counts = fit_context(SYSTEM, TOOLS, MEMORY, ids, make_history(40), "年付能退吗?")` 40 轮历史有 106 条消息(40 个问题、40 个回答、13 对工具调用共 26 条)。
- `print(len(messages), "条消息,合计", sum(counts.values()), "token")` 52 条消息 = 1 条 system + 50 条历史 + 1 条 user。
- `print("历史里最早保留的一条:", messages[1]["role"], str(messages[1]["content"])[:20])` `messages[0]` 是 system,`messages[1]` 就是保留下来的历史里最早的一条。`str(...)` 是因为 content 有可能是 `None`。

</div>

```bash
uv run python -m part04.ex262_1
```

实跑输出:

```text
  检索资料超限,去掉排在最后的 kb-012
  检索资料超限,去掉排在最后的 kb-011
  检索资料超限,去掉排在最后的 kb-010
  检索资料超限,去掉排在最后的 kb-008
  检索资料超限,去掉排在最后的 kb-007
  检索资料超限,去掉排在最后的 kb-006
  检索资料超限,去掉排在最后的 kb-009
  对话历史超限,106 条裁成 50 条
52 条消息,合计 4003 token
历史里最早保留的一条: user 第 22 个问题:我们星河记账的订阅和发
```

12 篇去掉了 7 篇,剩下 5 篇,和 k=8 时留下的是同一批(`kb-002, 001, 003, 005, 004`):再多取几篇,在 800 的上限下也进不来,白白检索。这是个信号:如果评估显示你需要 k=8 才答得对,就该改上限或改块的大小,而不是让 `fit_context` 每次悄悄把它裁掉。

历史 106 条裁成 50 条,保留的最早一条是第 22 个问题:前 21 轮都没了。合计 4003 token,和 24 轮历史时的 3956 差不多,这就是上限的作用:历史再长,发出去的量不会变。

</details>

### 练习 2:历史里哪几条消息最吃 token

对 `make_history(24)`,找出 token 最多的 4 条消息,再按 role 统计 user、assistant、tool 各占多少。

<details><summary>参考答案</summary>

新建 `part04/ex262_2.py`:

```python
# agent-zero-lab/part04/ex262_2.py  练习 2:对话历史里,哪几条消息最吃 token
from part04.ctx_blocks import make_history
from part04.ctx_budget import message_tokens

history = make_history(24)
ranked = sorted(enumerate(history), key=lambda p: message_tokens(p[1]), reverse=True)
for i, m in ranked[:4]:
    print(f"第 {i:>2} 条 {m['role']:<9}{message_tokens(m):>4} token")
by_role: dict[str, int] = {}
for m in history:
    by_role[m["role"]] = by_role.get(m["role"], 0) + message_tokens(m)
print(by_role)
```

<div class="line-notes">

- `ranked = sorted(enumerate(history), key=lambda p: message_tokens(p[1]), reverse=True)` `enumerate` 给每条消息配上下标,变成 `(下标, 消息)` 的二元组;`sorted` 的 `key` 是一个匿名函数 `lambda p: ...`(Day 30),`p[1]` 是二元组里的消息,按它的 token 数排;`reverse=True` 从大到小。
- `for i, m in ranked[:4]:` 取最大的 4 个。
- `print(f"第 {i:>2} 条 {m['role']:<9}` 打印下标和角色。
- `by_role: dict[str, int] = {}` 空字典,准备按角色累加。
- `for m in history:` 逐条累加。
- `by_role[m["role"]] = by_role.get(m["role"], 0) + message_tokens(m)` `get(键, 0)` 键不存在时返回 0,所以第一次遇到某个角色也能直接加。相当于 JS 里 `by[role] = (by[role] ?? 0) + n`。

</div>

```bash
uv run python -m part04.ex262_2
```

实跑输出:

```text
第  6 条 tool      206 token
第 14 条 tool      206 token
第 22 条 tool      206 token
第 30 条 tool      206 token
{'user': 672, 'assistant': 856, 'tool': 1648}
```

最大的四条全是 `tool` 消息,每条 206 个 token,是一条普通回答(28)的七倍多。按角色加起来,tool 占 1648,user 和 assistant 加起来才 1528。**64 条消息里只有 8 条是工具结果,占了一半的 token。**

这条结论决定了压缩从哪下手:要省 token,先动这 8 条,不是平均地裁所有消息。明天 Day 263 就从这里开始。

</details>

### 练习 3:数不准,让模型先把编号列出来再数

把 `long_ctx_count.py` 的问法改成「先把符合条件的公告编号一行一个全部列出来,最后一行写共 N 条」,只跑 320 条这一档。数得准一些吗?多花了什么?

<details><summary>参考答案</summary>

新建 `part04/ex262_3.py`:

```python
# agent-zero-lab/part04/ex262_3.py  练习 3:数不准,那让模型先把符合条件的编号一条条写出来,最后再数,准不准?
import re

from common.llm import LLMClient
from part04.long_ctx import PLANS, SYSTEM, make_notices

client = LLMClient()
notices = make_notices(320)
docs = "\n".join(t for t, _ in notices)
for plan in PLANS:
    real = sum(f"的{plan}客户" in t for t, _ in notices)
    q = (f"一共有多少条公告是写给「{plan}」客户的?先把符合条件的公告编号(如 N-0007)一行一个全部列出来,"
         "最后一行写「共 N 条」。")
    r = client.chat([{"role": "system", "content": SYSTEM.replace("只回答一个数字(天数),不要解释。", "") + docs},
                     {"role": "user", "content": q}], temperature=0, max_tokens=2000)
    listed = re.findall(r"N-\d{4}", r.content)
    last = re.findall(r"共\s*(\d+)\s*条", r.content)
    right_ids = {t[4:10] for t, _ in notices if f"的{plan}客户" in t}
    hit = len(set(listed) & right_ids)
    print(f"{plan} 实际 {real} 列出 {len(listed)}(其中真符合的 {hit}) 最后一行写 {last[-1] if last else '没写'} 输出 {r.completion_tokens} token")
print(client.ledger)
```

<div class="line-notes">

- `notices = make_notices(320)` 只测 320 条这一档(11,321 个 token),上一个实验里这档四个答案都是 62。
- `q = (f"一共有多少条公告是写给「{plan}」客户的?先把符合条件的公告编号` 两个相邻的字符串字面量会自动拼成一个,外层括号让它可以跨行。
- `SYSTEM.replace("只回答一个数字(天数),不要解释。", "")` 系统提示词里原来有「只回答一个数字,不要解释」,和这次要模型列清单矛盾,把它去掉。字符串的 `replace` 把前一个子串换成后一个(这里换成空串)。
- `max_tokens=2000` 要给它列清单的空间,上一个实验只给了 20。
- `listed = re.findall(r"N-\d{4}", r.content)` 找出回答里所有形如 `N-0007` 的编号,`\d{4}` 是恰好 4 个数字。
- `last = re.findall(r"共\s*(\d+)\s*条", r.content)` 找「共 N 条」,括号是捕获组,只取中间的数字。`\s*` 允许数字两边有空格。
- `right_ids = {t[4:10] for t, _ in notices if f"的{plan}客户" in t}` 集合推导式,把真正符合条件的公告编号收成集合。`t[4:10]` 是切片,公告正文 `【公告 N-0001】…` 的第 4 到第 9 个字符正好是 `N-0001`。
- `hit = len(set(listed) & right_ids)` 两个集合取交集 `&`(Day 25):模型列出来的编号里,真符合的有几个。

</div>

```bash
uv run python -m part04.ex262_3
```

实跑输出:

```text
月付个人版 实际 81 列出 80(其中真符合的 80) 最后一行写 80 输出 405 token
月付团队版 实际 83 列出 92(其中真符合的 82) 最后一行写 92 输出 465 token
年付团队版 实际 73 列出 72(其中真符合的 71) 最后一行写 72 输出 365 token
年付企业版 实际 83 列出 80(其中真符合的 80) 最后一行写 80 输出 405 token
4 次调用 | 输入 45328 / 输出 1640 tokens | 约 ¥0.0165
```

和不让它列的时候(四个答案全是 62,差 15% 到 25%)比,误差缩小了:最后一行写的数字是 80、92、72、80,对应实际 81、83、73、83,差 -1、+9、-1、-3。代价是输出多了 365 到 465 个 token,按 8 元每百万算,每次多花不到 ¥0.004。

但还是不准,而且问题出在清单本身:月付团队版列出 92 条,其中只有 82 条是真符合的,**10 条是它自己加进来的**;还漏了一条。这个脚本我跑了两遍,上一遍的数字是 80、86、80、80,同一个题两次不一样。

结论:让模型「写出来再数」能把误差压下来,说明给它一点草稿空间有用。但要精确的数字,别让模型数,用工具:代码里一行 `sum(...)` 就是 100% 对。这也是 Agent 要有工具的原因之一。

</details>

### 练习 4:`trim_by_turn` 的边界

不跑,先预测:传进去的历史是空列表,会返回什么?预算只有 10(比任何一轮都小),会返回什么?预算是 0 呢?再跑验证。

<details><summary>参考答案</summary>

新建 `part04/ex262_4.py`:

```python
# agent-zero-lab/part04/ex262_4.py  练习 4:trim_by_turn 的边界:历史为空、预算小得离谱、最新一轮自己就超预算
from part04.ctx_blocks import make_history
from part04.trim_turns import trim_by_turn

print("空历史:", trim_by_turn([], 1000))
history = make_history(6)
out = trim_by_turn(history, 10)
print("预算 10:", len(out), "条,第一条", out[0]["role"], str(out[0]["content"])[:12])
out = trim_by_turn(history, 0)
print("预算 0:", len(out), "条")
```

<div class="line-notes">

- `print("空历史:", trim_by_turn([], 1000))` 空列表里没有任何轮,`split_turns` 返回 `[]`,`for` 循环一次都不执行,`kept` 是空的,最后推导式也是空,返回 `[]`。不报错。
- `history = make_history(6)` 6 轮,第 6 轮是调工具的一轮,四条消息:user、assistant(调工具)、tool、assistant。
- `out = trim_by_turn(history, 10)` 预算 10。第一圈:最新一轮(那个有 tool 的)占 285,`used + cost > budget` 成立,但 `and kept` 里 `kept` 是空列表(假值),所以不停,照样装下。第二圈:`used` 已经是 285,再装任何一轮都超,并且 `kept` 非空,`break`。
- `print("预算 10:", len(out), "条,第一条", out[0]["role"], str(out[0]["content"])[:12])` 留下 4 条,第一条是 user:第 6 个问题。
- `out = trim_by_turn(history, 0)` 预算 0,结果相同:最新一轮还是保留。

</div>

```bash
uv run python -m part04.ex262_4
```

实跑输出:

```text
空历史: []
预算 10: 4 条,第一条 user 第 6 个问题:我们星河
预算 0: 4 条
```

三种情况都没有报错。预算 10 和预算 0 都返回最新一轮的 4 条消息,约 285 个 token,**比预算大得多**。这是设计出来的:用户刚问的问题和对应的工具结果,不能因为预算紧就不要了,否则模型根本不知道在回答什么。代价是这时候 `trim_by_turn` 不再保证不超预算,所以 `fit_context` 之后一定要用 `block_counts` 重新数一遍(它确实这么做了),并在日志里报警:预算小到装不下一轮,说明预算本身定得有问题。

</details>

### 练习 5:1.4 这个系数,换一批工具还准吗

`tools_tokens` 里的 1.4 是在原来四个工具上量出来的。换一批新工具(保留原来的前两个,新增 `cancel_subscription` 和 `export_report`),预测值和 API 实际多收的差多少?

<details><summary>参考答案</summary>

新建 `part04/ex262_5.py`,新增的两个工具的结构和原来的一样,只是名字、描述、参数不同:

```python
# agent-zero-lab/part04/ex262_5.py  练习 5:工具定义的系数 1.4 是不是只对那四个工具成立?换一批新工具再测
from common.llm import LLMClient
from part04.ctx_blocks import TOOLS
from part04.ctx_budget import tools_tokens

NEW_TOOLS = TOOLS[:2] + [
    {"type": "function", "function": {
        "name": "cancel_subscription",
        "description": "取消客户的订阅。年付按剩余整月退款,月付当期结束后停止。调用前必须先向客户确认。",
        "parameters": {"type": "object", "properties": {
            "customer_id": {"type": "string", "description": "客户编号"},
            "effective": {"type": "string", "enum": ["now", "period_end"], "description": "立即生效还是当期结束时生效"},
            "reason": {"type": "string", "description": "取消原因"}}, "required": ["customer_id", "effective"]}}},
    {"type": "function", "function": {
        "name": "export_report",
        "description": "导出某个账本某段时间的流水报表,返回下载链接,链接 24 小时有效。",
        "parameters": {"type": "object", "properties": {
            "ledger_id": {"type": "string"},
            "start": {"type": "string", "description": "开始日期 YYYY-MM-DD"},
            "end": {"type": "string", "description": "结束日期 YYYY-MM-DD"},
            "format": {"type": "string", "enum": ["csv", "xlsx", "pdf"]}}, "required": ["ledger_id", "start", "end"]}}},
]

client = LLMClient()
msgs = [{"role": "user", "content": "你好"}]
base = client.chat(msgs, max_tokens=1).prompt_tokens
for name, tools in (("原来四个", TOOLS), ("新的四个", NEW_TOOLS)):
    real = client.chat(msgs, tools=tools, max_tokens=1).prompt_tokens - base
    print(f"{name}: 我们估 {tools_tokens(tools)},API 实际多收 {real},差 {real - tools_tokens(tools):+d}")
```

<div class="line-notes">

- `NEW_TOOLS = TOOLS[:2] + [` 取原来列表的前两个(切片),再拼上新的两个。两个列表用 `+` 连起来,相当于 JS 的 `[...a, ...b]`。
- `"enum": ["now", "period_end"],` 新工具里用了枚举参数,原来的四个里没有,这是故意的:换一批结构不太一样的。
- `msgs = [{"role": "user", "content": "你好"}]` 用一条最短的消息当底,`prompt_tokens` 的变化就都来自工具定义。
- `base = client.chat(msgs, max_tokens=1).prompt_tokens` 不带工具时的输入 token 数。
- `for name, tools in (("原来四个", TOOLS), ("新的四个", NEW_TOOLS)):` 两批各测一次。
- `real = client.chat(msgs, tools=tools, max_tokens=1).prompt_tokens - base` 带工具的 `prompt_tokens` 减去不带的,就是工具定义真实多收的。

</div>

```bash
uv run python -m part04.ex262_5
```

实跑输出:

```text
原来四个: 我们估 599,API 实际多收 600,差 +1
新的四个: 我们估 652,API 实际多收 638,差 -14
```

原来那四个差 +1(它是量出来的,当然准),新的四个差 -14:我们估 652,API 实际 638,多估了 2%。**换一批结构不完全一样的工具,系数 1.4 还是能用,误差两个百分点**。但我只测了两批,没有拿更多的工具、更多的模型试,所以这条只能当「对这个接口大致成立」,换模型必须重测。

</details>

### 练习 6:老板说一次任务最多花 5 分钱

一次任务 20 步,每步输出约 150 个 token。倒推每一步的输入最多能是多少 token?分别按缓存命中 0%、50%、90% 算。

<details><summary>参考答案</summary>

新建 `part04/ex262_6.py`:

```python
# agent-zero-lab/part04/ex262_6.py  练习 6:老板说一次任务最多花 5 分钱,倒推每一步的输入预算
HIT, MISS, OUT = 0.04, 2.0, 8.0  # 元 / 百万 token,deepseek-flash 2026 年 10 月


def max_input_per_step(max_yuan: float, steps: int, hit_ratio: float, out_tokens: int) -> int:
    """每一步最多能发多少输入 token。hit_ratio 是缓存命中的比例(0~1)。"""
    per_step = max_yuan / steps                      # 每步能花多少元
    out_cost = out_tokens * OUT / 1_000_000          # 输出那部分先扣掉
    unit = (hit_ratio * HIT + (1 - hit_ratio) * MISS) / 1_000_000  # 每个输入 token 的平均价
    return int((per_step - out_cost) / unit)


for ratio in (0.0, 0.5, 0.9):
    print(f"缓存命中 {ratio:.0%}: 每步输入最多 {max_input_per_step(0.05, 20, ratio, 150):>6} token")
```

<div class="line-notes">

- `HIT, MISS, OUT = 0.04, 2.0, 8.0` 三个价格一行赋值,单位是元每百万 token。
- `per_step = max_yuan / steps` 5 分钱分给 20 步,每步 0.0025 元。
- `out_cost = out_tokens * OUT / 1_000_000` 输出先扣掉:150 × 8 / 1,000,000 = 0.0012 元。数字里的下划线只是方便阅读,Python 里 `1_000_000` 就是 1000000。
- `unit = (hit_ratio * HIT + (1 - hit_ratio) * MISS) / 1_000_000` 每个输入 token 的平均价。命中率 0 时是 2 / 1,000,000;命中率 90% 时是 (0.9 × 0.04 + 0.1 × 2) / 1,000,000 = 0.236 / 1,000,000。
- `return int((per_step - out_cost) / unit)` 剩下的钱除以单价,就是输入的上限。命中率 0:(0.0025 − 0.0012) / 0.000002 = 650。
- `for ratio in (0.0, 0.5, 0.9):` 三种命中率。

</div>

```bash
uv run python -m part04.ex262_6
```

实跑输出:

```text
缓存命中 0%: 每步输入最多    650 token
缓存命中 50%: 每步输入最多   1274 token
缓存命中 90%: 每步输入最多   5508 token
```

命中率 0 时,每步只能发 650 个 token,连今天的系统提示词加工具定义都装不下(172 + 599)。命中率到 90%,每步能发 5508。同样的预算,**缓存命中率不同,上限差了八倍**。所以「系统提示词和工具定义放最前面、内容固定」不只是习惯,它直接决定了你能负担多大的上下文。缓存这件事,后面讲成本优化时会专门做。

</details>

验收标准:练习 1 到 6 都能解释每一个数字从哪来;`uv run basedpyright part04` 没有红线。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 上下文工程(context engineering) | 每次调用模型之前,决定窗口里放哪些东西、放多少、什么顺序。比提示词工程大,管的是整个窗口 |
| 上下文预算 | 给窗口里的每一块定一个 token 上限,让一次调用最多花多少钱有个上界 |
| context rot(上下文腐烂) | 输入越长,模型表现越不稳定。今天的数数实验是个例子 |
| 大海捞针(needle in a haystack) | 在一大段文字里藏一句话,看模型找不找得到。今天的实验一是它的变体 |
| 工具定义 | 发给模型的函数列表(名字、描述、参数的 JSON Schema),每次调用都占 token |
| `tool_calls` / `tool` 消息 | assistant 想调工具时带的字段,和你执行后追加的 `role` 为 `tool` 的消息,必须成对 |
| 一轮(turn) | 一条 user 消息和它后面的 assistant、tool 消息,今天用「遇到 user 开新一轮」来切 |
| 按轮裁剪 | 超预算时整轮整轮地丢最早的,不把一轮拆开,避免拆散工具调用 |
| 粗估 | 不加载分词器,用字符数乘经验系数估 token。今天的误差在 ±15% 上下 |
| `prompt_tokens` | API 返回的输入 token 数,最终以它为准 |
| `max_tokens` | 本次最多输出多少 token,要从预算里预留出来 |

## 常见误区

**以为窗口有多大就能放多少。** 窗口是装得下的上限,不是用得好的上限。今天的实验:找一条,2.8 万 token 里 15 次全对;数几百条,同一份材料错 15% 到 26%。

**一次实验对了就下结论。** `temperature=0` 也不保证两次一样。800 条公告里数月付个人版,三遍分别回答 172、207、191。要看就看多次、看趋势。

**只数系统提示词和历史,忘了工具定义。** 四个工具就 599 个 token,是系统提示词的 3.5 倍。工具多了(MCP 接上就是几十个),这块最大。

**直接拿别人的系数。** 工具定义乘 1.4 是 DeepSeek 接口的行为,粗估的 0.8 和 0.35 是我在今天几段文本上拟合的。换模型要重新量,量法就是同一条消息发两次对差。

**按条裁历史。** `rest.pop(0)` 在有工具调用时,有可能留下孤零零的 `tool` 消息,接口直接 400:`Messages with role 'tool' must be a response to a preceding message with 'tool_calls'`。

**裁完不再数一遍。** `trim_by_turn` 为了保住最新一轮,可能超预算(练习 4)。裁之后要重新数。

**预算只写在文档里,代码里没有。** 预算要是常量、要有检查、要有预算表。写在文档里的数字,三个月后没人记得。

**用预算去裁系统提示词。** 固定块超了是提示词写长了,运行时一裁,规矩就缺了一半。`fit_context` 对固定块是直接抛错。

## 学习资料

### 文档与文章

- [Anthropic · Effective context engineering for AI agents](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents):上下文工程的定义、注意力预算、压缩、清理工具结果、笔记和子 Agent,今天只用了前半,后两天会接着用,40 分钟。
- [LangChain · Context Engineering for Agents](https://blog.langchain.com/context-engineering-for-agents/):写出去、选进来、压缩、隔离四类手段的出处,配图清楚,30 分钟。
- [Chroma · Context Rot](https://research.trychroma.com/context-rot):18 个模型在输入变长时的表现,和我们今天的数数实验对照看,看摘要和图就行。
- [Lost in the Middle(arXiv 2307.03172)](https://arxiv.org/abs/2307.03172):答案放在长上下文中间时模型表现最差的那篇论文,看摘要和第 2 节的实验设计。
- [Drew Breunig · How Long Contexts Fail](https://www.dbreunig.com/2025/06/22/how-contexts-fail-and-how-to-fix-them.html):把长上下文的失败归成中毒、分心、混淆、冲突四类,和下面那个 B 站视频讲的是同一套,20 分钟。
- [Manus · Context Engineering for AI Agents: Lessons from Building Manus](https://manus.im/blog/Context-Engineering-for-AI-Agents-Lessons-from-Building-Manus):一个真实 Agent 产品的经验,从 KV 缓存命中率讲起,和练习 6 的结论是一回事。
- [DeepSeek API 文档 · 多轮对话](https://api-docs.deepseek.com/zh-cn/guides/multi_round_chat):API 无状态,每轮要把历史重新发一遍,今天所有预算问题的源头。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1w3GNzeEHb&autoplay=0&high_quality=1" title="🗃️ 上下文工程:优化 Agent 效能的关键技术 🔑" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>沧海九粟 · 上下文工程:优化 Agent 效能的关键技术 · 22 分钟,2025 年 7 月的视频,把上下文工程的概念和几类手段过一遍,看完对照今天开头那张四类手段的表。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1S2ni6uEkh&autoplay=0&high_quality=1" title="AI Agent 上下文工程:解析上下文腐烂、中毒等4大失效模式与优化策略" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>赛博门外憨 · AI Agent 上下文工程:解析上下文腐烂、中毒等 4 大失效模式与优化策略 · 9 分钟,短,讲上下文长了会出的几类问题,和今天两个实验的结论放在一起看。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/MJScoDgIcXg" title="Chroma | Context Engineering Episode 3 - Lance Martin - LangChain" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Chroma · Context Engineering Episode 3 - Lance Martin - LangChain · 四类手段那篇文章的作者本人讲,英文,开自动字幕,看他怎么讲「为什么 Agent 的上下文会越来越长」。</figcaption>
</figure>

### 书籍

- Chip Huyen《AI Engineering》(O'Reilly,2025)第 6 章 RAG and Agents:讲检索和 Agent 的上下文构造,前面几天的内容在这里有系统的版本。今天的预算和它在讲的「怎么把有限的上下文用在刀刃上」是同一个问题。

### 开源项目与代码

- [humanlayer/12-factor-agents](https://github.com/humanlayer/12-factor-agents):Agent 工程的十二条原则,其中有一条专门讲「自己掌控上下文窗口」,读那一条就够,15 分钟。
- [huggingface/tokenizers](https://github.com/huggingface/tokenizers):今天数 token 用的库,看 README 里 `Tokenizer.from_file` 和 `encode` 的例子。

## 自测

**1. 在 2.8 万 token 的公告里找一条,和数出一类公告有几条,为什么结果差这么多?**

<details><summary>答案</summary>

找一条只需要关注窗口里的一小块,问法和那一条公告的字面几乎重合,模型靠匹配就能找到。数一类公告要同时关注分散在各处的几百条,漏一条、多一条都会错,而且漏的多半不是随机的。实测前者 15 次全对,后者同一份材料错 15% 到 26%。要精确的数字应该用代码算。

</details>

**2. 工具定义要不要算进上下文预算?怎么量它?**

<details><summary>答案</summary>

要算。它每次调用都发,四个工具就占 599 个 token。量法:同一条消息发两次,一次带 `tools` 一次不带,两次 `prompt_tokens` 之差就是真实开销;直接数 JSON 会偏少,因为接口会把它换成自己的文本格式,今天实测 DeepSeek 是 1.4 倍。换模型要重新量。

</details>

**3. 把历史丢最早的一条一条删,为什么会 400?按轮裁怎么避免?**

<details><summary>答案</summary>

带 `tool_calls` 的 assistant 消息和它后面的 `tool` 消息必须成对。一条一条删,可能删掉前者留下后者,接口报 `Messages with role 'tool' must be a response to a preceding message with 'tool_calls'`。按轮裁把「一个 user 消息和后面所有 assistant、tool 消息」当一整块,要么全留要么全丢,不会拆开。

</details>

**4. `trim_by_turn` 里的 `and kept` 是干什么的?**

<details><summary>答案</summary>

保证最新一轮无论多大都留下来。`kept` 还是空列表时,即使这一轮超预算,条件 `used + cost > budget and kept` 也是假的,不会 `break`。没有它,预算比最新一轮还小的时候会返回空历史,用户刚问的问题都丢了。

</details>

**5.(面试题)你们的 Agent 上下文怎么管?**

<details><summary>答案</summary>

可以这么答:先把一次调用的上下文拆成几块,系统提示词、工具定义、记忆、检索资料、对话历史、当前问题,分别数 token,每块定一个上限,汇总成一张预算表,输出另外留位置。固定的块放前面,吃缓存。能裁的两块,检索资料从排名最低的开始少取,对话历史按轮裁,不拆散工具调用,最新一轮一定留。裁完再数一遍,和 API 返回的 `prompt_tokens` 对账,我们实测本地数比 API 少 4% 左右,所以留 10% 余量。预算上限不是拍脑袋,按「一次任务最多花多少钱」倒推,再用评估集验证改小之后效果掉不掉。更进一步还要做压缩和长期记忆,那是下一步。

</details>

## 明天预告

Day 263 · 上下文工程(二):压缩,别直接丢,先总结。今天练习 2 查出来一件事:64 条历史消息里,8 条工具结果占了一半 token;按轮裁又只能整轮进出,预算有剩也浪费。明天换一种思路,不丢,先压:把旧的工具结果换成一行占位(不花钱),历史快超的时候再让模型把前面的对话总结成一段摘要,最近几轮保留原文。
