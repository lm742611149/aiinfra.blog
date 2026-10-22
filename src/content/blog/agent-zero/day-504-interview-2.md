---
title: 'Day 504 · 面试(二):工具调用与 RAG 题'
description: '面试基础题的第二套:工具调用 7 题、RAG 8 题,这两块在国内 JD 里分别出现在 55% 和 51% 的岗位上。先让自测脚本能切换题库,顺手修一个真实的 KeyError;再跑四个几分钱的实验:模型返回的 tool_calls 原样长什么样、参数错了怎么喂回去、500 条工具结果把模型算糊涂、错误码查询为什么要混合检索。'
pubDate: 2026-10-22
regime: none
tags: ['interview', 'tool-calling', 'rag', 'hybrid-search', 'agent-zero']
series: 'agent-zero'
day: 504
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 503](/blog/agent-zero/day-503-week72-review/) 是复习日:画了这一周的知识地图,默写了关键词匹配、数字收集和门槛判断三段代码,把整周的脚本拼成了一个「投递前体检」。再往前一天,[Day 502](/blog/agent-zero/day-502-interview-1/) 刷了第一套面试题(模型、提示词、结构化输出),写了计时自测的 `quiz.py` 和挑回炉题的 `weak.py`。

今天是第二套:工具调用和 RAG。站长 10 月整理的 880 条 JD 里,国内有正文的 334 条,写到「Function Calling / Tool Use」的占 55%,写到「RAG / 检索」的占 51%,是国内 JD 里除了 Python 之外出现最多的两项。换句话说,一面里这两块几乎一定会问,而且问得比第一套细。

## 今天要解决的问题

学完今天,你应该能做到:

1. 让 `quiz.py` 能选题库,让 `weak.py` 能同时看几套题库的日志;过程中会撞上一个真实的 `KeyError`,你要能说清它为什么出现。
2. 跑四个小实验,给「模型执行了函数吗」「参数错了怎么办」「工具结果太长怎么办」「为什么要混合检索」这四类题准备自己测出来的数字和现象。
3. 把今天 15 道题(第 14 到 28 题)每道计时出声答一遍,每道都能在概念之后接一句「我测过」或「SupportPilot 里是这样做的」。

预计用时 2.5–3 小时,题目部分建议分两次做。前置:第三部分(Day 156–211)的工具调用和 Agent 循环,第四部分(Day 212–270)的 RAG;[Day 502](/blog/agent-zero/day-502-interview-1/) 的 `quiz.py`、`weak.py`;[Day 217](/blog/agent-zero/day-217-embed-service/) 的 `common/embed.py`。

学法提示:先对照文章逐行敲一遍(不复制粘贴)并跑通;第二天合上文章,把 `load_all` 和实验二的 `check` 函数默写出来;做练习,做不出再展开参考答案,看完关掉重写一遍。题目部分还是老规矩:先计时出声答,再看答案。

## 这一套题,面试官在看什么

第一套题考的是「你懂不懂模型」,答案大多是概念。今天这套不一样,工具调用和 RAG 是 Agent 工程师每天写的东西,面试官问这两块,其实是在判断你有没有真写过。判断方法很朴素:追问细节。

比如你答「function calling 就是模型调用函数」,面试官会接一句「那函数在哪执行?」;你答「RAG 就是先检索再生成」,他会接「检索不准你怎么查?」。答不上追问,前面背得再顺也没用。所以今天四个实验挑的都是最容易被追问的地方,每个实验都会留下一个你能当场说出来的现象或数字。

<figure>
<svg viewBox="0 0 640 260" role="img" aria-label="一次工具调用里模型和应用各做什么:模型只输出工具名和参数,应用负责校验、执行、回传">
  <rect x="0" y="0" width="640" height="260" fill="var(--paper-raised)"/>
  <rect x="20" y="40" width="180" height="180" fill="var(--mem-wash)" stroke="var(--mem)"/>
  <text x="34" y="64" font-family="var(--font-mono)" font-size="13" fill="var(--ink)">模型(DeepSeek)</text>
  <text x="34" y="96" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">读 messages + tools</text>
  <text x="34" y="120" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">输出 tool_calls:</text>
  <text x="34" y="140" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">名字 + 参数字符串</text>
  <text x="34" y="172" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">看到 tool 结果后</text>
  <text x="34" y="192" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">再决定下一步</text>
  <rect x="300" y="40" width="320" height="180" fill="var(--compute-wash)" stroke="var(--compute)"/>
  <text x="314" y="64" font-family="var(--font-mono)" font-size="13" fill="var(--ink)">你的应用(Python)</text>
  <text x="314" y="96" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">1 工具名存在吗?参数合法吗?(实验二)</text>
  <text x="314" y="120" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">2 有没有权限?要不要人审批?</text>
  <text x="314" y="144" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">3 真正执行:查库、调接口</text>
  <text x="314" y="168" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">4 结果裁短,按 tool_call_id 回传(实验三)</text>
  <text x="314" y="192" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">5 记日志、算步数和花费</text>
  <line x1="200" y1="110" x2="300" y2="110" stroke="var(--ink-faint)"/>
  <text x="212" y="102" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">tool_calls</text>
  <line x1="300" y1="170" x2="200" y2="170" stroke="var(--ink-faint)"/>
  <text x="212" y="162" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">role=tool</text>
  <text x="20" y="246" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">左边一行代码都不执行。权限、校验、安全的抓手全在右边</text>
</svg>
<figcaption>工具调用题的核心图。第 14、16、18、19、20 题其实都是在问右边那五步,答题时把这张图在脑子里过一遍就不会漏。</figcaption>
</figure>

## 第一步:第二套题库

和 [Day 502](/blog/agent-zero/day-502-interview-1/) 的 `bank1.json` 格式一模一样:编号、题目、对应哪几天、几条要点。编号接着第一套往下排,从 14 到 28。这一点很重要,下一步就会用到:如果两套题库都从 1 开始编号,日志里的 `"id": "3"` 就分不清是哪一套的第 3 题。

```bash
cd agent-zero-lab
```

`part09/interview/bank2.json` 是数据,可以直接复制:

```json
[
 {"id": "14", "q": "function calling 的原理是什么?模型真的「执行」了函数吗?", "day": [156, 159, 164], "points": ["模型只输出工具名 + 参数 JSON", "应用执行,结果作为 tool 消息回传", "执行、权限、校验都在应用侧"]},
 {"id": "15", "q": "不用框架,手写一个 Agent 循环,说说关键结构。", "day": [166, 170], "points": ["while:调模型,没 tool_calls 就结束", "执行工具,结果按 id 追加", "步数、超时、异常、预算四道保护"]},
 {"id": "16", "q": "工具描述应该怎么写?", "day": [157, 182], "points": ["写给模型:何时用、何时不用", "参数含义、枚举、示例", "返回精简,报错能指导改正"]},
 {"id": "17", "q": "工具有上百个时怎么办?", "day": [184, 185], "points": ["全塞:选错、贵", "合并、分组路由、工具检索", "动态工具列表会破坏缓存"]},
 {"id": "18", "q": "并行工具调用要注意什么?", "day": [162], "points": ["只并行互不依赖的", "有副作用的要幂等", "按 tool_call_id 对回结果"]},
 {"id": "19", "q": "模型调用了不存在的工具,或者参数格式错了,怎么处理?", "day": [189, 193], "points": ["执行前 schema 校验", "错误作为 tool 结果喂回", "限次数,记进指标"]},
 {"id": "20", "q": "工具返回结果太长(比如 500 条记录)怎么办?", "day": [191, 183], "points": ["工具层分页、限条数、裁字段", "返回摘要统计或引用 ID", "长结果贵且干扰"]},
 {"id": "21", "q": "讲一下 RAG 的完整流程。", "day": [221, 226, 240], "points": ["离线:解析、切块、向量化、建索引", "在线:改写、混合召回、rerank、拼 prompt、引用", "评测和增量更新"]},
 {"id": "22", "q": "切块大小怎么定?有哪些策略?", "day": [224, 448], "points": ["太小缺上下文,太大噪音多", "固定长度+重叠 / 按结构 / 按语义", "用 recall 比,块带标题路径"]},
 {"id": "23", "q": "为什么要做混合检索?", "day": [219, 235, 236], "points": ["向量管语义,BM25 管精确字符串", "错误码、发票号靠关键词", "RRF 融合"]},
 {"id": "24", "q": "rerank 是做什么的?为什么不直接用 rerank 模型做检索?", "day": [238], "points": ["交叉编码器,query 和文档一起打分", "不能预建索引,全库太慢", "先粗召回几十条再精排"]},
 {"id": "25", "q": "RAG 回答不准,怎么排查?", "day": [255, 259], "points": ["检索和生成分开看", "没召回查切块/embedding/过滤", "召回了查排序、上下文、prompt"]},
 {"id": "26", "q": "RAG 怎么评估?", "day": [256, 260], "points": ["检索:recall@k、MRR、nDCG", "生成:忠实度、相关性、引用", "要有无答案题"]},
 {"id": "27", "q": "向量库怎么选?", "day": [229, 234], "points": ["规模、运维、过滤、混合检索", "已有 Postgres 先 pgvector", "讲理由比讲名字重要"]},
 {"id": "28", "q": "RAG、长上下文、Agentic RAG 怎么取舍?", "day": [227, 266], "points": ["小而固定:放上下文 + 缓存", "大或常变:RAG", "多跳、要判断查不查:Agentic RAG,更贵"]}
]
```

检查一下 JSON 没写坏、题数对:

```bash
python3 -c "import json;print(len(json.load(open('part09/interview/bank2.json'))))"
```

```text
15
```

## 第二步:让自测脚本能选题库

Day 502 的 `quiz.py` 把题库路径写死了:`BANK = Path("part09/interview/bank1.json")`。今天有了第二套,后面两天还有第三、第四套,得让它能选。改法是把「哪个文件」变成函数参数,命令行多收一个参数。

打开 `part09/quiz.py`(Day 502 建的),改三处。改完的相关部分长这样:

```python
# agent-zero-lab/part09/quiz.py(只列改动的部分)
BANKS = Path("part09/interview")
LOG = Path("part09/interview/log.jsonl")
LIMIT = 120


def load_bank(name: str = "bank1") -> list[dict]:
    return json.loads((BANKS / f"{name}.json").read_text(encoding="utf-8"))


if __name__ == "__main__":
    n = int(sys.argv[1]) if len(sys.argv) > 1 else 5
    name = sys.argv[2] if len(sys.argv) > 2 else "bank1"
    picked = random.sample(load_bank(name), n)
```

<div class="line-notes">

- `BANKS = Path("part09/interview")` 原来存的是一个文件,现在存题库所在的目录。名字从 `BANK` 改成 `BANKS`,读代码的人一眼知道它不是单个文件。
- `def load_bank(name: str = "bank1") -> list[dict]:` 加了一个参数,默认值是 `"bank1"`。有默认值的好处是旧代码不用改:Day 502 练习 1 的 `ex502_weak_quiz.py` 里写的是 `load_bank()`,不传参数,照样读第一套。相当于 JS 里 `function loadBank(name = "bank1")`。
- `return json.loads((BANKS / f"{name}.json").read_text(encoding="utf-8"))` `BANKS / "bank2.json"` 用 `/` 拼路径,这是 `pathlib` 的写法,相当于 Node 的 `path.join(BANKS, "bank2.json")`。外面那层括号不能省,否则 `.read_text` 会先作用在字符串 `"bank2.json"` 上,报 `AttributeError`。
- `name = sys.argv[2] if len(sys.argv) > 2 else "bank1"` `sys.argv` 是命令行参数列表,`sys.argv[0]` 是脚本自己,`[1]` 是题数,`[2]` 是题库名。没给就用第一套。相当于 Node 的 `process.argv`,只是 Node 前面还多一个 `node` 本身。

</div>

抽两道第二套的题。和 Day 502 一样,为了把输出贴进文章,我用管道模拟按键;你自己练的时候直接运行 `uv run python -m part09.quiz 5 bank2`,真的出声答。

```bash
( sleep 3; echo; echo 1; sleep 2; echo; echo 0 ) | uv run python -m part09.quiz 2 bank2
```

```text

【24】rerank 是做什么的?为什么不直接用 rerank 模型做检索?
出声答完按回车 > 用时 1.6 秒
  要点: 交叉编码器,query 和文档一起打分
  要点: 不能预建索引,全库太慢
  要点: 先粗召回几十条再精排
自评 0 没答出 / 1 答了一半 / 2 都答到 > 
【25】RAG 回答不准,怎么排查?
出声答完按回车 > 用时 2.0 秒
  要点: 检索和生成分开看
  要点: 没召回查切块/embedding/过滤
  要点: 召回了查排序、上下文、prompt
自评 0 没答出 / 1 答了一半 / 2 都答到 > 
已记录 2 题到 part09/interview/log.jsonl
```

第一题用时 1.6 秒而不是 3 秒,是因为 `sleep 3` 从管道开始就在计时,Python 启动、读题库也花了一点时间,题目打印出来时已经过去一秒多了。这只是模拟按键的副作用,你自己答的时候不会这样。

### 撞上一个 KeyError

日志里现在有第二套的题了。像平时一样跑一下 `weak.py`,看哪些题要回炉:

```bash
uv run python -m part09.weak
```

```text
题库 17 题,答过 6 题,要回炉 3 题
Traceback (most recent call last):
  File "<frozen runpy>", line 203, in _run_module_as_main
  File "<frozen runpy>", line 88, in _run_code
  File "/.../agent-zero-lab/part09/weak.py", line 16, in <module>
    item = bank[r["id"]]
           ~~~~^^^^^^^^^
KeyError: '25'
```

(终端里 Traceback 和第一行的先后顺序可能不一样,因为报错走的是另一条输出通道 stderr,我这里按逻辑顺序排了。)

读报错要从最后一行往上读。`KeyError: '25'` 说的是:字典里没有 `'25'` 这个键。出事的那行是 `item = bank[r["id"]]`。`bank` 是 `weak.py` 用 `load_bank()` 建的「编号 → 题目」字典,`load_bank()` 不传参数,只读了第一套,里面是 1 到 13 加四道加题,一共 17 题,第一行输出的「题库 17 题」就是这么来的。日志却是两套题共用的,第 25 题 0 分要回炉,拿 `'25'` 去第一套里查,当然查不到。

JS 里同样的写法 `bank["25"]` 会安静地返回 `undefined`,然后在下一行 `item.day` 才报 `Cannot read properties of undefined`。Python 的字典用方括号取不存在的键,当场就抛 `KeyError`,出错位置更准。

为什么排在前面的 `加2`(1 分)没出事?因为 `sorted(todo, key=lambda r: r["score"])` 按分数排序,0 分的第 25 题排在最前,第一次循环就炸了。

修法:让 `weak.py` 看到所有题库。在 `quiz.py` 的 `load_bank` 下面加一个函数:

```python
def load_all() -> list[dict]:
    items: list[dict] = []
    for path in sorted(BANKS.glob("bank*.json")):
        items += load_bank(path.stem)
    return items
```

<div class="line-notes">

- `items: list[dict] = []` 先建一个空列表装所有题。冒号后面的类型标注是给类型检查器看的,不写也能跑,但 Zed 里会提示 `items` 的类型推不出来。
- `for path in sorted(BANKS.glob("bank*.json")):` `glob("bank*.json")` 找出目录里所有名字以 bank 开头、以 .json 结尾的文件,今天找到的是 `bank1.json` 和 `bank2.json`,后两天加了 `bank3.json`、`bank4.json` 会自动被找到,不用再改代码。`sorted` 让顺序固定,不同系统上 `glob` 返回的顺序可能不一样。
- `items += load_bank(path.stem)` `path.stem` 是去掉扩展名的文件名,`bank2.json` 的 stem 是 `bank2`,正好是 `load_bank` 要的参数。`+=` 在列表上是把另一个列表的元素全部加进来,相当于 JS 的 `items.push(...other)`。

</div>

`weak.py` 里改两处:import 那行的 `load_bank` 换成 `load_all`,建字典那行的 `load_bank()` 换成 `load_all()`:

```python
from part09.quiz import LIMIT, LOG, load_all
...
bank = {item["id"]: item for item in load_all()}
```

再跑一次:

```bash
uv run python -m part09.weak
```

```text
题库 32 题,答过 6 题,要回炉 3 题
  [0分 2.0秒] 25. RAG 回答不准,怎么排查?… → 回去看 Day 255、Day 259
  [1分 2.0秒] 加2. 注意力里的 Q、K、V 是什么?多头有什… → 回去看 Day 116
  [1分 1.6秒] 24. rerank 是做什么的?为什么不直接用… → 回去看 Day 238
还没抽到过:['1', '2', '3', '4', '5', '加1', '加3', '加4', '8', '9', '10', '11', '12', '14', '15', '16', '17', '18', '19', '20', '21', '22', '23', '26', '27', '28']
```

32 = 17 + 15,两套都进来了。回炉清单里第一套和第二套的题混在一起按分数排,这正是想要的:错题本不分科目,哪道最差先补哪道。

这个 bug 本身也是一道好面试题的素材。「两套数据共用一个日志,却只用一套数据去查」,和 RAG 里「索引更新了一半,检索时查的还是旧索引」是同一类错误。

## 第三步:给答案找证据

下面四个实验,前三个对应工具调用题,最后一个对应 RAG 题。都放在 `part09/interview/`,都在 `agent-zero-lab/` 目录下用 `-m` 运行。前三个调 DeepSeek,最后一个调硅基流动的 embedding(bge-m3 在硅基流动价格页上标的是免费,[Day 217](/blog/agent-zero/day-217-embed-service/) 查过)。

先把三个实验共用的工具定义单独放一个文件。工具名和 [Day 280](/blog/agent-zero/day-280-mcp-seed/) 起写的 CloudLedger MCP server 一致,只是这里直接写成 OpenAI 格式,今天不需要真的执行它们:

```python
# agent-zero-lab/part09/interview/tools2.py
TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "find_customer",
            "description": "按邮箱、姓名、公司名或客户编号查找客户,返回 customer_id。查订阅和发票前先用它拿到 customer_id。",
            "parameters": {
                "type": "object",
                "properties": {"query": {"type": "string", "description": "邮箱、姓名、公司或编号"}},
                "required": ["query"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_subscription",
            "description": "查询客户当前订阅:套餐、计费周期、席位数、状态。",
            "parameters": {
                "type": "object",
                "properties": {"customer_id": {"type": "string", "description": "客户编号,如 C007"}},
                "required": ["customer_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "list_invoices",
            "description": "列出客户最近的发票,可按状态过滤。",
            "parameters": {
                "type": "object",
                "properties": {
                    "customer_id": {"type": "string", "description": "客户编号,如 C007"},
                    "status": {"type": "string", "enum": ["paid", "open", "void", "refunded"]},
                },
                "required": ["customer_id"],
            },
        },
    },
]
```

<div class="line-notes">

- `"type": "function",` OpenAI 兼容协议里每个工具外面都包一层 `type: function`,[Day 157](/blog/agent-zero/day-157-tool-schema/) 讲过这个结构。
- `"description": "按邮箱、姓名、公司名或客户编号查找客户,返回 customer_id。查订阅和发票前先用它拿到 customer_id。",` 描述的后半句是写给模型的「使用顺序」,实验一会看到它起作用。
- `"required": ["query"],` 必填参数列表。注意它和 `properties` 同级,不在某个参数里面。
- `"status": {"type": "string", "enum": ["paid", "open", "void", "refunded"]},` 用 `enum` 把取值限定成四个。实验二会看到,即使 schema 里写了 enum,应用层也还要校验一次。

</div>

### 实验一:模型到底「执行」了什么(第 14、18 题)

第 14 题问「模型真的执行了函数吗」。最有说服力的答法是把模型返回的原始内容拿出来看。顺便问一个能并行的问题和一个有依赖的问题,第 18 题也就有了证据。

```python
# agent-zero-lab/part09/interview/evidence_toolcall.py
from common.llm import LLMClient
from part09.interview.tools2 import TOOLS

SYSTEM = "你是云簿的客服助手,用工具查数据,不要编。"
QUESTIONS = [
    "客户 C001 现在是什么套餐?最近有哪些发票?",
    "邮箱 user002@example.com 的客户,最近有没有没付的发票?",
]

llm = LLMClient()
for q in QUESTIONS:
    r = llm.chat([{"role": "system", "content": SYSTEM}, {"role": "user", "content": q}], tools=TOOLS)
    print(f"\n问:{q}")
    print(f"finish_reason={r.finish_reason}  content={r.content!r}")
    for call in r.message.get("tool_calls", []):
        fn = call["function"]
        print(f"  {call['id']}  {fn['name']}  arguments={fn['arguments']!r}  ({type(fn['arguments']).__name__})")
print(llm.ledger)
```

<div class="line-notes">

- `"客户 C001 现在是什么套餐?最近有哪些发票?",` 第一个问题:套餐和发票互不依赖,都只要 C001 这个编号,可以同时查。
- `"邮箱 user002@example.com 的客户,最近有没有没付的发票?",` 第二个问题:只给了邮箱,要先 `find_customer` 拿到编号才能查发票,有先后依赖。
- `r = llm.chat([{"role": "system", "content": SYSTEM}, {"role": "user", "content": q}], tools=TOOLS)` `LLMClient` 是 [Day 135](/blog/agent-zero/day-135-llm-client-1/) 写的封装,`tools=` 原样透传给 openai SDK。
- `print(f"finish_reason={r.finish_reason}  content={r.content!r}")` `!r` 让 f-string 用 `repr` 打印,空字符串会显示成 `''`,一眼能看出「没有文字回答」。
- `for call in r.message.get("tool_calls", []):` `r.message` 是模型返回的那条 assistant 消息(字典)。没有工具调用时它没有 `tool_calls` 这个键,`.get(..., [])` 给一个空列表兜底。
- `print(f"  {call['id']}  {fn['name']}  arguments={fn['arguments']!r}  ({type(fn['arguments']).__name__})")` 最后打印参数的类型名。重点就在这:它是字符串还是字典?

</div>

```bash
uv run python -m part09.interview.evidence_toolcall
```

```text

问:客户 C001 现在是什么套餐?最近有哪些发票?
finish_reason=tool_calls  content=''
  call_00_Sc4CQua871zfzw2zMspC8639  get_subscription  arguments='{"customer_id": "C001"}'  (str)
  call_01_Q1T4ojs8hTwJBUtX1OSW0142  list_invoices  arguments='{"customer_id": "C001"}'  (str)

问:邮箱 user002@example.com 的客户,最近有没有没付的发票?
finish_reason=tool_calls  content='我先查一下这个客户的信息。'
  call_00_rUdvS16QXIWA3jagjREH5854  find_customer  arguments='{"query": "user002@example.com"}'  (str)
2 次调用 | 输入 977 / 输出 119 tokens | 约 ¥0.0024
```

三件事可以直接拿去答题。

**模型什么都没执行。** 它返回的是 `finish_reason=tool_calls` 加一段文本:工具名和一个**字符串**形式的参数 `'{"customer_id": "C001"}'`。注意类型是 `str`,不是字典,你要自己 `json.loads` 才能用,而且这个字符串理论上可能不是合法 JSON。我们这个脚本里根本没有 `get_subscription` 这个 Python 函数,模型照样「调用」了它,这就是最直接的证明:函数在不在、怎么执行、能不能执行,模型完全不知道,全在应用这一侧。

**能并行时它会并行。** 第一个问题一次返回了两个调用,编号分别是 `call_00_...` 和 `call_01_...`。你回传结果时要按这两个 id 一一对上,练习 2 会故意弄错一次看看会怎样。

**有依赖时它会串行。** 第二个问题只调了 `find_customer`,没有冒险去猜客户编号。工具描述里那句「查订阅和发票前先用它拿到 customer_id」起了作用。同时它还在 `content` 里说了一句「我先查一下这个客户的信息」,有的模型在调工具时会带一段文字,有的不带,前端渲染时两种情况都要处理。

花费 ¥0.0024,两次调用。

### 实验二:参数错了,把错误喂回去(第 19 题)

第 19 题的标准答案是「执行前校验,错误作为 tool 结果回传,让模型自己改」。这和 Day 502 实验四的 schema 重试是一个思路,只是从「输出 JSON」换到了「工具参数」。为了每次都能复现,模型第一次的两个错误调用我直接写死:一个调了不存在的工具,一个给了 enum 之外的状态值。

```python
# agent-zero-lab/part09/interview/evidence_badargs.py
from typing import Literal

from pydantic import BaseModel, ValidationError

from common.llm import LLMClient
from part09.interview.tools2 import TOOLS


class ListInvoicesArgs(BaseModel):
    customer_id: str
    status: Literal["paid", "open", "void", "refunded"] | None = None


KNOWN = {t["function"]["name"] for t in TOOLS}


def check(name: str, arguments: str) -> str | None:
    if name not in KNOWN:
        return f"没有叫 {name} 的工具,可用的只有:{sorted(KNOWN)}"
    if name == "list_invoices":
        try:
            ListInvoicesArgs.model_validate_json(arguments)
        except ValidationError as e:
            return f"参数没通过校验,请改正后重新调用:\n{e}"
    return None


fake_calls = [
    {"id": "call_x1", "type": "function", "function": {"name": "list_unpaid_invoices", "arguments": '{"customer_id": "C002"}'}},
    {"id": "call_x2", "type": "function", "function": {"name": "list_invoices", "arguments": '{"customer_id": "C002", "status": "unpaid"}'}},
]
messages: list[dict] = [
    {"role": "system", "content": "你是云簿的客服助手,用工具查数据,不要编。"},
    {"role": "user", "content": "客户 C002 最近有没有没付的发票?"},
    {"role": "assistant", "content": "", "tool_calls": fake_calls},
]
for call in fake_calls:
    err = check(call["function"]["name"], call["function"]["arguments"])
    print(f"{call['function']['name']}: {err}")
    messages.append({"role": "tool", "tool_call_id": call["id"], "content": err or "[]"})

llm = LLMClient()
r = llm.chat(messages, tools=TOOLS)
for call in r.message.get("tool_calls", []):
    fn = call["function"]
    print("改正后:", fn["name"], fn["arguments"], "→ 校验", check(fn["name"], fn["arguments"]) or "通过")
print(f"content={r.content!r} | ¥{r.cost:.5f}")
```

<div class="line-notes">

- `class ListInvoicesArgs(BaseModel):` 用 pydantic 把 `list_invoices` 的参数再声明一遍。为什么 JSON Schema 里写过 enum 还要再写?因为 schema 是发给模型的「建议」,模型不一定遵守;pydantic 是你自己这一侧的「检查」,一定执行。
- `status: Literal["paid", "open", "void", "refunded"] | None = None` 状态只能是四个值之一,或者不传。`X | None = None` 相当于 TS 里的可选属性 `status?: "paid" | "open" | ...`。
- `KNOWN = {t["function"]["name"] for t in TOOLS}` 集合推导式,得到 `{"find_customer", "get_subscription", "list_invoices"}`,用来判断工具名存不存在。
- `def check(name: str, arguments: str) -> str | None:` 校验通过返回 `None`,不通过返回一段给模型看的错误说明。返回字符串而不是抛异常,因为这段文字要原样塞进 tool 消息。
- `return f"没有叫 {name} 的工具,可用的只有:{sorted(KNOWN)}"` 报错里直接列出可用的工具名。只说「工具不存在」,模型可能再猜一个错的;把正确选项给它,它基本一次就改对。这条是 [Day 182](/blog/agent-zero/day-182-tool-design-2/) 六条原则里的「报错要能指导改正」。
- `ListInvoicesArgs.model_validate_json(arguments)` 直接校验 JSON 字符串,省掉一步 `json.loads`。参数字符串不是合法 JSON 时也会抛 `ValidationError`,一并处理了。
- `{"id": "call_x2", "type": "function", "function": {"name": "list_invoices", "arguments": '{"customer_id": "C002", "status": "unpaid"}'}},` 「没付」被直译成了 `unpaid`,而我们的状态里叫 `open`。这是真实项目里最常见的错:业务词和字段值对不上。
- `{"role": "assistant", "content": "", "tool_calls": fake_calls},` 把这两个错误调用当成模型上一轮的输出放进历史。
- `messages.append({"role": "tool", "tool_call_id": call["id"], "content": err or "[]"})` 每个调用都回一条 tool 消息,`tool_call_id` 对上。校验通过的情况这里不会出现,写 `"[]"` 只是占位。
- `print("改正后:", fn["name"], fn["arguments"], "→ 校验", check(fn["name"], fn["arguments"]) or "通过")` 模型改正后的调用,再过一遍同一个 `check`。改了不等于改对,还得验。

</div>

```bash
uv run python -m part09.interview.evidence_badargs
```

```text
list_unpaid_invoices: 没有叫 list_unpaid_invoices 的工具,可用的只有:['find_customer', 'get_subscription', 'list_invoices']
list_invoices: 参数没通过校验,请改正后重新调用:
1 validation error for ListInvoicesArgs
status
  Input should be 'paid', 'open', 'void' or 'refunded' [type=literal_error, input_value='unpaid', input_type=str]
    For further information visit https://errors.pydantic.dev/2.14/v/literal_error
改正后: list_invoices {"customer_id": "C002", "status": "open"} → 校验 通过
content='' | ¥0.00110
```

两个错误都回传后,模型只发了一个调用,工具名对了,`unpaid` 也改成了 `open`,再校验通过。花了 ¥0.0011。

面试时可以这样讲第 4 步:「我在自己的工具层做过两道校验:工具名不在注册表里,返回可用工具列表;参数用 pydantic 校验,把报错原文作为 tool 结果回传。实测模型把 unpaid 改成了 open,一次就对。真实代码里还要限制重试次数,超过两次就终止并转人工,并且把这类错误记进指标,它就是评测里的工具调用错误率。」

### 实验三:工具结果太长会怎样(第 20 题)

第 20 题大家都会答「分页、摘要」,但很少有人说得出「不这么做具体会坏成什么样」。实验:造 500 张发票,问「open 状态的有几张、合计多少」,一次把 500 条原样塞给模型,一次只给摘要。答案我们自己用 Python 先算好。

```python
# agent-zero-lab/part09/interview/evidence_long.py
import json
import random
from collections import Counter

from common.llm import LLMClient


def make_rows() -> list[dict]:
    random.seed(504)
    return [
        {"id": f"INV-2026-{i:04d}", "amount_yuan": random.choice([98, 298, 980, 2980]),
         "status": random.choices(["paid", "open", "void"], weights=[85, 10, 5])[0],
         "issued_at": f"2026-{random.randint(1, 10):02d}-{random.randint(1, 28):02d}"}
        for i in range(1, 501)
    ]


QUESTION = "这个客户 open 状态的发票有几张?合计多少元?只回答两个数字。"

if __name__ == "__main__":
    rows = make_rows()
    open_rows = [r for r in rows if r["status"] == "open"]
    truth = (len(open_rows), sum(r["amount_yuan"] for r in open_rows))
    print(f"真实答案:open {truth[0]} 张,合计 {truth[1]} 元")
    summary = {
        "total": len(rows),
        "by_status": dict(Counter(r["status"] for r in rows)),
        "open_amount_yuan": truth[1],
        "latest_open": sorted(open_rows, key=lambda r: r["issued_at"], reverse=True)[:5],
        "note": "只列了最新 5 张 open 发票;要全部明细请用 page 参数翻页",
    }
    llm = LLMClient()
    for name, payload in [("原样 500 条", rows), ("摘要", summary)]:
        content = json.dumps(payload, ensure_ascii=False)
        messages = [
            {"role": "user", "content": QUESTION},
            {"role": "assistant", "content": "", "tool_calls": [
                {"id": "call_1", "type": "function", "function": {"name": "list_invoices", "arguments": '{"customer_id": "C002"}'}}]},
            {"role": "tool", "tool_call_id": "call_1", "content": content},
        ]
        r = llm.chat(messages, temperature=0)
        print(f"{name}: 结果 {len(content)} 个字符,prompt_tokens {r.prompt_tokens},¥{r.cost:.5f},{r.latency:.1f}s → {r.content.strip()}")
```

<div class="line-notes">

- `random.seed(504)` 固定随机种子,每次生成的 500 条完全一样,你跑出来的「真实答案」应该和我一样是 43 张、50936 元。放进函数里,是为了练习 3 能 import 同一份数据。
- `"status": random.choices(["paid", "open", "void"], weights=[85, 10, 5])[0],` 按 85:10:5 的比例随机给状态。`choices` 返回列表,`[0]` 取出那一个。
- `QUESTION = "这个客户 open 状态的发票有几张?合计多少元?只回答两个数字。"` 放在 `if __name__` 外面,练习 3 也要用这句。
- `if __name__ == "__main__":` 有了这一行,别的脚本 import `make_rows` 时不会把下面的两次请求也发一遍。Day 502 练习 2 吃过这个亏。
- `truth = (len(open_rows), sum(r["amount_yuan"] for r in open_rows))` 用代码算出标准答案。数数、求和是确定性计算,本来就该代码做。
- `"by_status": dict(Counter(r["status"] for r in rows)),` 摘要里放每种状态的张数,`Counter` 数完转成普通字典,方便 `json.dumps`。
- `"note": "只列了最新 5 张 open 发票;要全部明细请用 page 参数翻页",` 摘要要告诉模型「这不是全部」,否则它可能以为只有 5 张。
- `{"role": "tool", "tool_call_id": "call_1", "content": content},` 和实验二一样,伪造一轮「模型调了 list_invoices,工具返回了这些」,只看模型怎么读结果。
- `r = llm.chat(messages, temperature=0)` 这次没传 `tools`,模型只能直接回答,不能再调工具。温度 0,让结果尽量稳定。

</div>

```bash
uv run python -m part09.interview.evidence_long
```

```text
真实答案:open 43 张,合计 50936 元
原样 500 条: 结果 45007 个字符,prompt_tokens 19704,¥0.03944,1.5s → 34 35394
摘要: 结果 608 个字符,prompt_tokens 342,¥0.00072,0.8s → 43 50936
```

我又跑了一次,看看稳不稳:

```text
真实答案:open 43 张,合计 50936 元
原样 500 条: 结果 45007 个字符,prompt_tokens 19704,¥0.00131,1.6s → 24 21452
摘要: 结果 608 个字符,prompt_tokens 342,¥0.00047,1.0s → 43，50936
```

这组数字比任何解释都直接。

**原样 500 条,两次都答错了,而且错得不一样。** 真实是 43 张、50936 元,第一次答 34 张、35394 元,第二次答 24 张、21452 元。温度 0 也没用。让模型在两万 token 里数数、求和,本来就是在用它最不擅长的方式干活;它不会报错,只会很自信地给你一个错数。客服 Agent 要是把这个数告诉客户,就是事故。

**摘要版两次都对,便宜 50 多倍。** 第一次运行时,原样版输入 19704 个 token,花 ¥0.03944;摘要版 342 个 token,¥0.00072,差了 55 倍。第二次原样版只花了 ¥0.00131,因为和第一次的输入一字不差,命中了 [Day 502](/blog/agent-zero/day-502-interview-1/) 实验三讲过的前缀缓存;真实场景里每个客户的发票不同,不会这么巧。

**延迟这一项看不出多大差别**,1.5 秒对 0.8 秒。两万 token 的 prefill 在 DeepSeek 上还很快,别在面试时说「长结果让延迟翻了几倍」,这个我没测出来。

所以第 20 题的第 4 步可以这样说:「我测过,500 张发票原样塞进去问 open 有几张,两次分别答 34 和 24,真实是 43;改成工具层返回统计摘要后两次都对,输入 token 从 19704 降到 342。结论是计数、求和这类确定性计算在工具层用代码做,模型只负责理解和表达。」练习 3 会把这个改成真正的分页工具,让模型自己调。

### 实验四:错误码为什么要混合检索(第 23、24 题)

[Day 219](/blog/agent-zero/day-219-embed-limits/) 讲过 embedding 的短板之一是错误码。面试时只说「向量对精确字符串不敏感」有点空,今天造一个它真会排错的例子。五条帮助中心文档,四条是错误码,其中 E1042 和 E2042 只差一位;用户的提问是「开票报 E1042」,把「开票」和错误码搭在了一起(真实客服里用户经常把场景说错,但错误码是从截图上抄的,反而最可靠)。

关键词那一侧我没有写完整的 BM25,只写了一个「错误码出现几次」的计数,够说明问题;完整的 BM25 在 [Day 235](/blog/agent-zero/day-235-bm25/)。

```python
# agent-zero-lab/part09/interview/evidence_hybrid.py
import re

from common.embed import embed, embed_one, usage

DOCS = [
    "错误码 E1024:导入银行流水时文件编码不是 UTF-8,用记事本另存为 UTF-8 后重新上传。",
    "错误码 E1042:银行流水里有重复的交易流水号,删掉重复行后再导入。",
    "错误码 E1043:流水的日期格式不对,日期列要写成 2026-10-22 这种格式。",
    "导入银行流水失败的常见原因:文件太大、列名不对、银行模板版本太旧。",
    "错误码 E2042:开发票时税号校验失败,检查纳税人识别号是否为 18 位。",
]
QUERY = "开票报 E1042"


def keyword_score(query: str, doc: str) -> int:
    codes = re.findall(r"[A-Z]\d{4}", query)
    return sum(doc.count(c) for c in codes)


def rrf(*rankings: list[int], k: int = 60) -> list[int]:
    score: dict[int, float] = {}
    for ranking in rankings:
        for rank, i in enumerate(ranking, 1):
            score[i] = score.get(i, 0.0) + 1 / (k + rank)
    return sorted(score, key=lambda i: -score[i])


if __name__ == "__main__":
    vecs = embed(DOCS)
    q = embed_one(QUERY)
    by_vec = sorted(range(len(DOCS)), key=lambda i: -float(vecs[i] @ q))
    by_kw = sorted(range(len(DOCS)), key=lambda i: -keyword_score(QUERY, DOCS[i]))
    print("向量排序:")
    for rank, i in enumerate(by_vec, 1):
        print(f"  {rank}. {float(vecs[i] @ q):.4f}  {DOCS[i][:22]}")
    print("关键词排序:")
    for rank, i in enumerate(by_kw, 1):
        print(f"  {rank}. {keyword_score(QUERY, DOCS[i])}  {DOCS[i][:22]}")
    print("RRF 融合:", [DOCS[i][:9] for i in rrf(by_vec, by_kw)])
    print("embedding 用量:", usage)
```

<div class="line-notes">

- `from common.embed import embed, embed_one, usage` Day 217 写的 embedding 封装:`embed` 一次算一批并归一化,`embed_one` 算一条,`usage` 记请求次数和 token。
- `"错误码 E2042:开发票时税号校验失败,检查纳税人识别号是否为 18 位。",` 干扰项:错误码和 E1042 只差第二位,内容又正好讲「开发票」,和用户提问里的「开票」语义很近。
- `QUERY = "开票报 E1042"` 我一共试了六种问法,只有这一种让向量排错了。其余五种(比如「导入流水的时候弹出 E1042」「流水号重复了怎么办」)bge-m3 都把 E1042 排在第一。这一点在面试时要说实话:向量检索在错误码上不是总错,而是「语义上有更像的干扰项时会错」。
- `codes = re.findall(r"[A-Z]\d{4}", query)` 正则抽出查询里所有「一个大写字母加四位数字」的错误码,这里得到 `["E1042"]`。
- `return sum(doc.count(c) for c in codes)` 文档里每出现一次错误码记一分。E2042 不含 E1042 这个子串,得 0 分。关键词匹配是逐字符比的,差一位就是不匹配,这正是它的长处。
- `def rrf(*rankings: list[int], k: int = 60) -> list[int]:` RRF(倒数排名融合,[Day 236](/blog/agent-zero/day-236-rrf/))。`*rankings` 表示可以传任意多个排序列表,相当于 JS 的剩余参数 `...rankings`。
- `score[i] = score.get(i, 0.0) + 1 / (k + rank)` 每一路里排第 rank 名,就加 `1 / (60 + rank)` 分。只看名次不看原始分数,所以向量的 0.64 和关键词的 1 分不用换算到同一个尺度。
- `by_vec = sorted(range(len(DOCS)), key=lambda i: -float(vecs[i] @ q))` 向量都归一化过,点积就是余弦相似度。按相似度从高到低排出文档下标。
- `by_kw = sorted(range(len(DOCS)), key=lambda i: -keyword_score(QUERY, DOCS[i]))` 关键词得分相同(都是 0)的文档,`sorted` 是稳定排序,保持原来的顺序。

</div>

```bash
uv run python -m part09.interview.evidence_hybrid
```

```text
向量排序:
  1. 0.6441  错误码 E2042:开发票时税号校验失败,检
  2. 0.6187  错误码 E1042:银行流水里有重复的交易流
  3. 0.5674  错误码 E1043:流水的日期格式不对,日期
  4. 0.5265  错误码 E1024:导入银行流水时文件编码不
  5. 0.4091  导入银行流水失败的常见原因:文件太大、列名不
关键词排序:
  1. 1  错误码 E1042:银行流水里有重复的交易流
  2. 0  错误码 E1024:导入银行流水时文件编码不
  3. 0  错误码 E1043:流水的日期格式不对,日期
  4. 0  导入银行流水失败的常见原因:文件太大、列名不
  5. 0  错误码 E2042:开发票时税号校验失败,检
RRF 融合: ['错误码 E1042', '错误码 E2042', '错误码 E1024', '错误码 E1043', '导入银行流水失败的']
embedding 用量: {'requests': 2, 'tokens': 163}
```

向量检索把 E2042 排在第一(0.6441),正确的 E1042 第二(0.6187),只差 0.025。「开票」这个词把它带偏了。关键词那一路正好相反:只有 E1042 得 1 分,E2042 因为差一位,和其他文档一样是 0 分,排到了最后。

RRF 怎么算出 E1042 第一的?E1042 在向量里第 2、关键词里第 1:1/62 + 1/61 ≈ 0.0325。E2042 在向量里第 1、关键词里第 5:1/61 + 1/65 ≈ 0.0318。两者很接近,E1042 险胜。这也说明 RRF 不是魔法,它只是让「两路都排得靠前」的文档胜出。如果只取 top-1 给模型,融合前向量检索会把税号的答案给用户;融合后给的是对的。

你自己跑,相似度的小数后几位可能和我不一样,同一段文本两次 embedding 的结果会有极小差别(我两次跑出来的 E2042 分别是 0.6439 和 0.6441),排序不会变。两次请求 163 个 token,bge-m3 免费,花费 ¥0。

面试第 4 步:「我在帮助中心数据上测过,用户问『开票报 E1042』,bge-m3 把只差一位的 E2042 排第一,因为它讲的正好是开发票;加上关键词一路做 RRF 后 E1042 回到第一。客服场景用户常贴错误码和发票号,所以 SupportPilot 用的是混合检索。」练习 1 会再加一层 rerank,看看精排模型怎么判。

四个实验加起来:实验一 ¥0.0024,实验二 ¥0.0011,实验三两次运行 ¥0.0401 + ¥0.0018,实验四 ¥0,合计约 ¥0.045,都按 `.env` 里 DeepSeek 高峰价 0.04/2/8 元每百万 token(缓存命中/未命中/输出)记账,2026 年 10 月对过 [DeepSeek 定价页](https://api-docs.deepseek.com/zh-cn/quick_start/pricing)。

## 题库(二):工具调用与 RAG

下面 15 道题,每道先计时出声答,再展开看要点。答案是要点,不是标准答案,用你自己的话和自己的例子讲。题目后面的 Day 是答不上来时该回去看的那一天。

### 工具调用

**14. function calling 的原理是什么?模型真的「执行」了函数吗?([Day 156](/blog/agent-zero/day-156-fc-idea/)、[Day 159](/blog/agent-zero/day-159-tool-roundtrip/)、[Day 164](/blog/agent-zero/day-164-anthropic-tools/))**

<details><summary>答案</summary>

没有。应用把工具的名称、描述、参数 JSON Schema 随请求发给模型;模型判断需要调用时,返回 `finish_reason=tool_calls` 和一段结构化的调用请求(工具名、参数字符串、调用 id);应用自己解析参数、执行函数,把结果作为 `role: tool` 的消息(带对应的 `tool_call_id`)追加进 messages,再请求一次,模型据此继续。模型能稳定输出这种格式,是后训练学会的。所以执行、权限、校验全部在应用侧,这也是安全设计的抓手。第 4 步用实验一:我的脚本里根本没有 `get_subscription` 这个函数,模型照样「调用」了它,参数是字符串 `'{"customer_id": "C001"}'`,要自己 `json.loads`。

</details>

**15. 不用框架,手写一个 Agent 循环,说说关键结构。([Day 166](/blog/agent-zero/day-166-agent-min/)、[Day 170](/blog/agent-zero/day-170-agent-full/))**

<details><summary>答案</summary>

一个循环:把 messages 和 tools 发给模型;返回里没有工具调用,就输出最终回答并结束;有,就逐个解析参数、校验、执行,把结果作为 tool 消息按 id 追加,继续下一轮。必须有的保护:最大步数、单个工具超时、工具异常转成可读错误回传而不是让程序崩、总 token 或花费上限、每一步写日志。骨架 15 到 30 行就能写完,面试官让你现场写时,重点是边写边说清这些保护各防什么。[Day 507](/blog/agent-zero/day-507-live-coding/) 会专门练 10 分钟手写。

</details>

**16. 工具描述应该怎么写?([Day 157](/blog/agent-zero/day-157-tool-schema/)、[Day 182](/blog/agent-zero/day-182-tool-design-2/))**

<details><summary>答案</summary>

工具描述是写给模型看的,要说清楚什么时候用、什么时候不用、参数的含义和取值范围、返回什么;名字有区分度,不要两个工具功能重叠;能用枚举约束的参数就用枚举;必要时在描述里给一个参数示例。返回值要精简,只给模型需要的字段;报错信息要能指导模型改正,比如「日期格式应为 YYYY-MM-DD」。例子:实验一里 `find_customer` 描述的那句「查订阅和发票前先用它拿到 customer_id」,让模型在只有邮箱时没有去猜编号;实验二里报错直接列出可用工具名,模型一次就改对了。

</details>

**17. 工具有上百个时怎么办?([Day 184](/blog/agent-zero/day-184-tool-search-1/)、[Day 185](/blog/agent-zero/day-185-tool-search-2/))**

<details><summary>答案</summary>

全部塞给模型有三个问题:相似工具多了容易选错;工具定义本身很占 token,每次请求都要付;模型注意力被分散。做法:合并功能相近的工具;按领域分组,先路由到某一组;按需检索工具,根据任务语义找出最相关的几个再暴露给模型;或者让不同子 Agent 各持一组工具。取舍要说出来:动态改变工具列表会破坏前缀缓存(工具定义通常在请求最前面),所以要在「少给工具省 token」和「固定工具吃缓存」之间算账。Day 184 量过 60 个工具的定义有多贵,把那个数说出来。

</details>

**18. 并行工具调用要注意什么?([Day 162](/blog/agent-zero/day-162-parallel-tools/))**

<details><summary>答案</summary>

只有互不依赖的调用才能并行,比如同时查订阅和查发票;有依赖的(先按邮箱找客户,再查他的发票)必须串行,实验一里模型自己也是这么做的。有副作用的工具要幂等,避免并行或重试导致重复执行,比如重复创建退款申请。结果要按 `tool_call_id` 一一回传,顺序无所谓,但一个都不能漏,漏了 DeepSeek 直接返回 400(练习 2 实测)。并行能降低延迟,但也可能同时打到同一个外部系统触发限流。

</details>

**19. 模型调用了不存在的工具,或者参数格式错了,怎么处理?([Day 189](/blog/agent-zero/day-189-failures-1/)、[Day 193](/blog/agent-zero/day-193-failures-5/))**

<details><summary>答案</summary>

执行前在应用侧校验:工具名查注册表,参数用 pydantic 或 JSON Schema 校验类型和取值。校验失败不要抛异常让程序崩,而是把一条清晰的错误作为 tool 结果回传,让模型自己改;限制重试次数,超过就终止或转人工。从源头减少:参数用枚举、描述里给示例、减少工具数量。把这类错误记进 trace 和指标,就是评测里的工具调用错误率。实验二:`status="unpaid"` 被 pydantic 拦下,报错原文回传后模型改成了 `open`,花了 ¥0.0011。

</details>

**20. 工具返回结果太长(比如查出 500 条记录)怎么办?([Day 191](/blog/agent-zero/day-191-failures-3/)、[Day 183](/blog/agent-zero/day-183-tool-design-3/))**

<details><summary>答案</summary>

在工具层就控制:分页、限制条数、只返回必要字段;能用代码算的统计(张数、合计)在工具里算好直接返回;或者返回一个引用 ID,让模型需要时再取详情。最后兜底是截断,并在结果里注明「已截断,共 N 条」。长结果直接塞进上下文既贵,又会让模型算错。实验三:500 张发票原样塞进去,问 open 有几张,两次分别答 34 和 24(真实 43),输入 19704 token;换成摘要两次都对,342 token,便宜 55 倍。

</details>

### RAG

**21. 讲一下 RAG 的完整流程。([Day 221](/blog/agent-zero/day-221-why-rag/)、[Day 226](/blog/agent-zero/day-226-retrieve-answer/)、[Day 240](/blog/agent-zero/day-240-retrieval-pipeline/))**

<details><summary>答案</summary>

两条流水线。离线:文档解析(PDF、网页)、清洗、切块、向量化,写入索引,通常是向量索引加关键词索引,再带上元数据(来源、更新时间、权限)。在线:用户问题先做改写或扩展,两路召回候选,融合后 rerank 精排,取前 k 段按 token 预算拼进 prompt,要求模型只根据资料回答并标注来源,最后可以校验引用是否真的出自资料。还有一条容易被忘的:评测和更新,文档变了要增量更新索引,检索和生成都要有评测集。SupportPilot 的例子:帮助中心 60 多篇文章按小标题切块,pgvector 加 BM25 混合召回,回复里带引用。

</details>

**22. 切块大小怎么定?有哪些策略?([Day 224](/blog/agent-zero/day-224-chunking/)、[Day 448](/blog/agent-zero/day-448-kb-chunk/))**

<details><summary>答案</summary>

块太小,上下文不完整,一段话被切成两半就答不全;块太大,一块里混了好几个主题,噪音多,检索也不精准。策略有固定长度加重叠、按标题或段落等文档结构切、按语义边界切。没有通用最佳值,要用检索评测集比较几种配置的 recall@k。帮助中心这类有清晰标题的文档,按标题层级切通常效果好,并且在每块前面加上「文章标题 > 小标题」这样的路径,也就是 Day 448 说的「给每块戴帽子」,检索时块虽然短,但不丢上下文。

</details>

**23. 为什么要做混合检索?([Day 219](/blog/agent-zero/day-219-embed-limits/)、[Day 235](/blog/agent-zero/day-235-bm25/)、[Day 236](/blog/agent-zero/day-236-rrf/))**

<details><summary>答案</summary>

向量检索擅长语义相似(「买错了想退钱」能找到「退款政策」),但对错误码、发票号、产品型号这类精确字符串不敏感;BM25 关键词检索正好相反,逐字匹配,差一个字符就不算。两路召回后用 RRF 按名次融合,通常比单路更稳。实验四:用户问「开票报 E1042」,bge-m3 把只差一位、讲开发票的 E2042 排第一,关键词一路只有 E1042 命中,RRF 融合后 E1042 回到第一。要补一句实话:我试了六种问法,向量只在这一种上排错,所以混合检索是防「有相似干扰项」的那部分情况。

</details>

**24. rerank 是做什么的?为什么不直接用 rerank 模型做检索?([Day 238](/blog/agent-zero/day-238-rerank/))**

<details><summary>答案</summary>

rerank 模型通常是交叉编码器:把 query 和一个候选文档拼在一起输入,直接输出相关度分数,因为两者在模型里能逐词互相「看到」,比各自算向量再比相似度更准。但它必须对每一对(query, 文档)单独算一次,没法像向量那样提前把文档算好建索引,对全库每条都算一遍太慢太贵。所以两段式:先用便宜的召回(向量 + 关键词)拿几十个候选,再用 rerank 精排取前几个。练习 1 实测:bge-reranker-v2-m3 给 E1042 打 0.93 分,E2042 只有 0.11,差距比向量检索的 0.62 对 0.64 清楚得多。

</details>

**25. RAG 回答不准,怎么排查?([Day 255](/blog/agent-zero/day-255-rag-eval-1/)、[Day 259](/blog/agent-zero/day-259-rag-eval-4/))**

<details><summary>答案</summary>

先把检索和生成分开看。用检索评测集看 recall@k:相关文档有没有被召回。没召回,依次查切块(答案是不是被切断了)、embedding 模型(对这类内容是否敏感,比如错误码)、query 改写有没有把关键词改丢、元数据过滤条件是不是写错了(过滤太严时 HNSW 甚至会返回不够 k 条,[Day 234](/blog/agent-zero/day-234-filter-pitfall/))。召回了但答错,看它是不是排在后面没进上下文、上下文太长被淹没,或者 prompt 没要求只依据资料回答。全程用 trace 看具体样本,不要凭感觉改。下面这张图是排查顺序。

</details>

<figure>
<svg viewBox="0 0 640 230" role="img" aria-label="RAG 答不准的排查顺序:先看相关文档有没有召回,没召回查切块、embedding、改写、过滤;召回了查排序、上下文长度、prompt">
  <rect x="0" y="0" width="640" height="230" fill="var(--paper-raised)"/>
  <rect x="220" y="14" width="200" height="40" fill="var(--paper-raised)" stroke="var(--rule)"/>
  <text x="236" y="39" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">一条答错的样本 + trace</text>
  <line x1="320" y1="54" x2="320" y2="74" stroke="var(--ink-faint)"/>
  <rect x="200" y="74" width="240" height="40" fill="var(--paper-raised)" stroke="var(--rule)"/>
  <text x="214" y="99" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">相关文档在 top-k 里吗?</text>
  <line x1="260" y1="114" x2="160" y2="140" stroke="var(--ink-faint)"/>
  <line x1="380" y1="114" x2="480" y2="140" stroke="var(--ink-faint)"/>
  <text x="170" y="134" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">不在</text>
  <text x="440" y="134" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">在</text>
  <rect x="20" y="140" width="280" height="76" fill="var(--compute-wash)" stroke="var(--compute)"/>
  <text x="32" y="162" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">检索问题</text>
  <text x="32" y="182" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">切块断了?embedding 不敏感?</text>
  <text x="32" y="202" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">改写丢词?过滤写错?</text>
  <rect x="340" y="140" width="280" height="76" fill="var(--mem-wash)" stroke="var(--mem)"/>
  <text x="352" y="162" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">生成问题</text>
  <text x="352" y="182" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">排太后没进上下文?太长被淹?</text>
  <text x="352" y="202" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">prompt 没要求只依据资料?</text>
</svg>
<figcaption>第 25 题的答题骨架。先一刀切开检索和生成,再分别查。面试官最想听到的就是第一刀:recall@k 看召回,而不是一上来就改 prompt。</figcaption>
</figure>

**26. RAG 怎么评估?([Day 256](/blog/agent-zero/day-256-rag-eval-2/)、[Day 260](/blog/agent-zero/day-260-rag-eval-5/))**

<details><summary>答案</summary>

分两层。检索层:recall@k(相关文档有没有进前 k)、MRR(第一个相关文档排第几,取倒数的平均)、nDCG(考虑排序位置和相关程度),前提是给每个问题标注相关文档。生成层:忠实度(回答里的每句话能不能在检索内容里找到依据)、答案相关性、引用正确率,通常用 LLM-as-judge 打分,再用一批人工标注校准评委。测试集一定要有「资料里没有答案」的题,检查模型会不会编;Day 257 那 30 条评估集分了五种题型,无答案题是其中一种。

</details>

**27. 向量库怎么选?([Day 229](/blog/agent-zero/day-229-pgvector-1/)、[Day 234](/blog/agent-zero/day-234-filter-pitfall/))**

<details><summary>答案</summary>

看数据规模、团队运维能力、是否需要强元数据过滤和混合检索、是否已经有数据库。百万级以内、已经在用 Postgres 的团队,pgvector 最省事:向量和业务数据在一个库里,事务、权限过滤、备份都能复用,混合检索也能在 SQL 里做。更大规模、高并发的专用检索场景再考虑 Milvus、Qdrant 这类专门的向量库;已经有 Elasticsearch 的团队可以直接用它的向量检索加全文检索。面试官要听的是选型理由,而不是你知道多少个名字。SupportPilot 选 pgvector 的理由:数据只有几千块,业务库本来就在 Postgres,要按客户和权限过滤。

</details>

**28. RAG、长上下文、Agentic RAG 怎么取舍?([Day 227](/blog/agent-zero/day-227-rag-prompt/)、[Day 266](/blog/agent-zero/day-266-agentic-rag/))**

<details><summary>答案</summary>

知识量小而且相对固定(比如一份几千字的退款政策),直接放进 system prompt,配合前缀缓存,又简单又准;知识量大或经常更新,用 RAG;问题需要多跳(先查 A 才知道要查 B)、需要判断要不要查和查什么,用 Agentic RAG,把检索做成工具,让 Agent 决定何时调用、可以调多次。Agentic RAG 更灵活,但多了模型调用轮次,更慢更贵,也更难评测,所以只在固定流水线确实答不好的那类问题上用。Day 502 实验三的数可以拿来佐证第一种:两千多 token 的规则放前缀,缓存命中后单次花费降到九分之一。

</details>

## 动手练习

**练习 1:给实验四加一层 rerank。** 硅基流动也提供 rerank 接口,模型名在 `.env` 的 `RERANK_MODEL` 里(Day 238 配过,`BAAI/bge-reranker-v2-m3`)。用同一个 `QUERY` 和 `DOCS` 调它,看它怎么排这五条。要求 import 实验四的数据,不要复制粘贴。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part09/ex/ex504_rerank.py
import os

import httpx
from dotenv import load_dotenv

from part09.interview.evidence_hybrid import DOCS, QUERY

load_dotenv()
resp = httpx.post(
    f"{os.environ['EMB_BASE_URL']}/rerank",
    headers={"Authorization": f"Bearer {os.environ['EMB_API_KEY']}"},
    json={"model": os.environ["RERANK_MODEL"], "query": QUERY, "documents": DOCS},
    timeout=60,
)
resp.raise_for_status()
data = resp.json()
print("rerank 排序:")
for r in data["results"]:
    print(f"  {r['relevance_score']:.4f}  {DOCS[r['index']][:22]}")
print("用量:", data.get("meta", {}).get("tokens"))
```

<div class="line-notes">

- `import httpx` openai SDK 没有 rerank 方法,直接发 HTTP 请求。httpx 是 openai SDK 自带的依赖,不用另装,用法和 `fetch` 差不多。
- `from part09.interview.evidence_hybrid import DOCS, QUERY` 实验四把运行部分放在了 `if __name__ == "__main__":` 下面,所以这里 import 只拿到数据,不会把两次 embedding 请求再发一遍。我第一版没加这行保护,跑练习时屏幕上先把实验四的输出又打了一遍。
- `f"{os.environ['EMB_BASE_URL']}/rerank",` 和 embedding 是同一家,地址是 `https://api.siliconflow.cn/v1/rerank`。
- `json={"model": os.environ["RERANK_MODEL"], "query": QUERY, "documents": DOCS},` 一个 query 加一组文档,一次请求把五对都打分。注意这正是 rerank 不能做全库检索的原因:文档要随请求一起发,全库几万条每次都发一遍不现实。
- `resp.raise_for_status()` 状态码不是 2xx 就抛异常,相当于 `fetch` 之后自己检查 `res.ok`。不写的话 key 错了会在下一行解析 JSON 时报一个看不懂的错。
- `for r in data["results"]:` 返回结果已经按 `relevance_score` 从高到低排好,`index` 是文档在原列表里的下标。

</div>

```bash
uv run python -m part09.ex.ex504_rerank
```

```text
rerank 排序:
  0.9275  错误码 E1042:银行流水里有重复的交易流
  0.1093  错误码 E2042:开发票时税号校验失败,检
  0.0708  错误码 E1024:导入银行流水时文件编码不
  0.0621  错误码 E1043:流水的日期格式不对,日期
  0.0099  导入银行流水失败的常见原因:文件太大、列名不
用量: {'input_tokens': 199, 'output_tokens': 0, 'image_tokens': 0}
```

rerank 把 E1042 排第一,0.93 分,第二名 E2042 只有 0.11。向量检索里这两条差 0.025,而且排反了;交叉编码器把 query 和文档放在一起读,「E1042」和「E1042」逐词对上了,所以判得很清楚。199 个 token,单价看硅基流动价格页,这个量级花费可以忽略。

这个结果正好用来答第 24 题的后半句:rerank 准,但每次都要把候选文档随请求发过去逐对打分。5 条无所谓,全库 5000 条就是每次请求都打 5000 对,所以只能放在召回之后做精排。

</details>

**练习 2:观察题。并行调用的结果,倒序回传会怎样?漏回一个会怎样?** 用实验一的第一个问题拿到两个真实的并行调用,假装执行完,分别按「倒序回传两条」和「只回传第一条」两种方式发回去,看模型和接口的反应。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part09/ex/ex504_order.py
import openai

from common.llm import LLMClient
from part09.interview.tools2 import TOOLS

FAKE = {
    "get_subscription": '{"plan": "基础版", "billing_cycle": "monthly", "status": "trialing"}',
    "list_invoices": '[{"id": "INV-2026-0001", "amount_yuan": "98.00", "status": "paid"}]',
}
llm = LLMClient()
base = [
    {"role": "system", "content": "你是云簿的客服助手,用工具查数据,不要编。"},
    {"role": "user", "content": "客户 C001 现在是什么套餐?最近有哪些发票?"},
]
first = llm.chat(base, tools=TOOLS)
calls = first.message["tool_calls"]
print("模型要调:", [c["function"]["name"] for c in calls])
results = [{"role": "tool", "tool_call_id": c["id"], "content": FAKE[c["function"]["name"]]} for c in calls]

for name, tool_msgs in [("倒序回传", results[::-1]), ("只回一个", results[:1])]:
    try:
        r = llm.chat(base + [first.message] + tool_msgs, tools=TOOLS)
        print(f"{name}: {r.content[:60]!r}")
    except openai.BadRequestError as e:
        print(f"{name}: BadRequestError {e.status_code} {str(e)[:300]}")
print(llm.ledger)
```

<div class="line-notes">

- `FAKE = {` 假的工具结果,内容取自 CloudLedger 业务库里 C001 的真实数据(基础版、月付、试用中,一张 98 元的发票),但这里不连库。
- `calls = first.message["tool_calls"]` 这里我直接用方括号取,因为实验一已经确认这个问题会触发并行调用。如果模型这次没调工具,这行会报 `KeyError`,那就再跑一次。
- `results = [{"role": "tool", "tool_call_id": c["id"], "content": FAKE[c["function"]["name"]]} for c in calls]` 按调用顺序做好两条 tool 消息,`tool_call_id` 一一对上。
- `for name, tool_msgs in [("倒序回传", results[::-1]), ("只回一个", results[:1])]:` `[::-1]` 是倒序切片,相当于 JS 的 `[...arr].reverse()`(不改原列表);`[:1]` 只取第一条。
- `r = llm.chat(base + [first.message] + tool_msgs, tools=TOOLS)` 历史 = 原来两条 + 模型那条带 tool_calls 的 assistant 消息 + 回传的 tool 消息。列表用 `+` 拼接,相当于 JS 的 `[...a, ...b]`。
- `except openai.BadRequestError as e:` 接口返回 400 时 openai SDK 抛这个异常。只接这一种,别的错误(比如网络)照常抛出。

</div>

```bash
uv run python -m part09.ex.ex504_order
```

```text
模型要调: ['get_subscription', 'list_invoices']
倒序回传: '客户 C001 的信息如下：\n\n**当前订阅**\n- 套餐：基础版\n- 计费周期：按月\n- 状态：试用中（trialin'
只回一个: BadRequestError 400 Error code: 400 - {'error': {'message': "An assistant message with 'tool_calls' must be followed by tool messages responding to each 'tool_call_id'. (insufficient tool messages following tool_calls message) (request_id: f433a614-c09c-41eb-8f32-3eaf9c9cee75)", 'type': 'invalid_request_error', 'param'
2 次调用 | 输入 1129 / 输出 172 tokens | 约 ¥0.0024
```

倒序回传完全没问题,模型靠 `tool_call_id` 对结果,不靠顺序。只回一个,接口直接拒绝:「带 tool_calls 的 assistant 消息后面,必须跟着回应每一个 tool_call_id 的 tool 消息」。这和 [Day 161](/blog/agent-zero/day-161-missing-result/) 讲的漏回 tool 消息是同一个错。

工程上的结论:并行执行时某个工具失败或超时了,也要回一条 tool 消息(内容写错误说明),不能因为没结果就不回。第 18 题答到这一层,面试官就知道你真处理过并行调用。

</details>

**练习 3:开放题。把实验三的「摘要」做成一个真正的分页工具,让模型自己调。** 实验三里的摘要是我们替模型准备好的。真实系统里应该是工具自己返回统计和分页。写一个 `list_invoices(customer_id, status, page)`:返回总张数、总金额、当前页最多 10 条和 `has_more`;再写一个最多 4 步的小循环让模型自己去调,问同一个问题。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part09/ex/ex504_paged.py
import json

from common.llm import LLMClient
from part09.interview.evidence_long import QUESTION, make_rows

ROWS = make_rows()
PAGE_SIZE = 10


def list_invoices(customer_id: str, status: str | None = None, page: int = 1) -> dict:
    hits = [r for r in ROWS if status is None or r["status"] == status]
    start = (page - 1) * PAGE_SIZE
    return {
        "customer_id": customer_id,
        "total": len(hits),
        "sum_yuan": sum(r["amount_yuan"] for r in hits),
        "page": page,
        "has_more": start + PAGE_SIZE < len(hits),
        "items": hits[start : start + PAGE_SIZE],
    }


TOOL = {
    "type": "function",
    "function": {
        "name": "list_invoices",
        "description": "按状态列客户发票。返回 total(总张数)和 sum_yuan(总金额)是全部结果的统计;items 每页最多 10 条,has_more 为真时用 page 翻页。只要数量和金额时不用翻页。",
        "parameters": {
            "type": "object",
            "properties": {
                "customer_id": {"type": "string"},
                "status": {"type": "string", "enum": ["paid", "open", "void"]},
                "page": {"type": "integer", "minimum": 1},
            },
            "required": ["customer_id"],
        },
    },
}

llm = LLMClient()
messages: list[dict] = [{"role": "user", "content": "客户 C002:" + QUESTION}]
for step in range(1, 5):
    r = llm.chat(messages, tools=[TOOL], temperature=0)
    messages.append(r.message)
    calls = r.message.get("tool_calls", [])
    if not calls:
        print(f"第 {step} 步回答:{r.content.strip()}")
        break
    for c in calls:
        args = json.loads(c["function"]["arguments"])
        out = list_invoices(**args)
        print(f"第 {step} 步调用 {args} → total={out['total']} sum={out['sum_yuan']} 本页 {len(out['items'])} 条")
        messages.append({"role": "tool", "tool_call_id": c["id"], "content": json.dumps(out, ensure_ascii=False)})
print(llm.ledger)
```

<div class="line-notes">

- `from part09.interview.evidence_long import QUESTION, make_rows` 用和实验三一模一样的 500 条数据和问题,结果才能比。
- `hits = [r for r in ROWS if status is None or r["status"] == status]` 不传状态就是全部,传了就过滤。真实工具里这一步是 SQL 的 `WHERE`。
- `start = (page - 1) * PAGE_SIZE` 第 1 页从下标 0 开始,第 2 页从 10 开始。和前端写分页组件的算法一样。
- `"sum_yuan": sum(r["amount_yuan"] for r in hits),` 统计在工具里用代码算好,这是这道题的关键。模型不用自己数。
- `"has_more": start + PAGE_SIZE < len(hits),` 告诉模型后面还有没有,它需要明细时知道该不该翻页。
- `"description": "按状态列客户发票。返回 total(总张数)和 sum_yuan(总金额)是全部结果的统计;` 描述里写清 total 和 sum_yuan 是「全部结果」的统计,不是当前页的。不写清楚,模型可能以为只有 10 张,然后去翻 5 页自己加。
- `for step in range(1, 5):` 最多 4 步,这就是第 15 题说的「最大步数」保护,最小版。
- `messages.append(r.message)` 模型的回复(含 tool_calls)要先进历史,再追加 tool 结果,顺序反了接口会报错。
- `out = list_invoices(**args)` `**args` 把字典展开成关键字参数,`{"customer_id": "C002", "status": "open"}` 变成 `list_invoices(customer_id="C002", status="open")`,相当于 JS 里把对象解构传进去。这里我没做校验,生产代码要先过实验二那样的 `check`。

</div>

```bash
uv run python -m part09.ex.ex504_paged
```

```text
第 1 步调用 {'customer_id': 'C002', 'status': 'open'} → total=43 sum=50936 本页 10 条
第 2 步回答:43，50936
2 次调用 | 输入 1254 / 输出 60 tokens | 约 ¥0.0022
```

模型第一步就带上了 `status: "open"`,拿到 total 和 sum 后直接回答,没有翻页,答案对。两次调用一共 1254 个输入 token、¥0.0022。对比实验三原样塞 500 条:一次 19704 个 token、¥0.039,而且答错。

改造前后放在一起,就是第 20 题最好的第 4 步:「同一个问题,原样返回 500 条,模型两次答错,花 ¥0.039;改成工具层分页加统计,模型一步就对,花 ¥0.0022。」

</details>

**验收标准**

- `quiz.py` 能用 `bank2` 抽题,`weak.py` 显示「题库 32 题」,两套题的回炉题混在一起按分数排。
- 你能不看文章说清那个 `KeyError: '25'` 是怎么来的。
- 四个实验和三道练习都自己跑过,记下了自己的数字。实验三和实验四的数字和我不一样很正常,但现象应该一样:原样塞 500 条会算错,「开票报 E1042」会让向量检索排错或者分数非常接近。
- 第 14 到 28 题每道都计时出声答过一遍,`weak.py` 的回炉清单里剩下的题,你都回对应那天重看过。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| `tool_calls` | 模型返回的 assistant 消息里的工具调用列表,每项有 id、工具名和字符串形式的参数 |
| `tool_call_id` | tool 结果消息里的字段,必须和对应调用的 id 一致,模型靠它把结果和调用对上 |
| `KeyError` | Python 字典用方括号取不存在的键时抛的异常,JS 里同样的写法会返回 `undefined` |
| `glob` | 按通配符找文件,`bank*.json` 匹配所有 bank 开头、.json 结尾的文件名 |
| `path.stem` | 去掉扩展名的文件名,`bank2.json` 的 stem 是 `bank2` |
| 参数校验回传 | 工具参数不合法时,不让程序崩,而是把报错原文作为 tool 结果发回给模型,让它自己改 |
| 工具层摘要 | 工具不返回原始明细,而是用代码算好张数、合计等统计再返回,明细靠分页取 |
| 交叉编码器 | rerank 模型的结构,把 query 和文档拼在一起输入、直接输出相关度分数,准但不能预建索引 |
| RRF | 倒数排名融合,每一路按名次加 `1/(k+名次)` 分再相加,不用管各路原始分数的尺度 |

## 常见误区

**说「模型调用了函数」。** 模型只输出了工具名和参数字符串,执行的是你的代码。实验一里脚本根本没有那个函数,模型照样「调用」了。面试时用词要准:模型「请求调用」,应用「执行」。

**把 `arguments` 当字典用。** 它是 JSON 字符串,要 `json.loads`,而且可能不合法。直接 `call["function"]["arguments"]["customer_id"]` 会报 `TypeError: string indices must be integers`。

**schema 里写了 enum,就不在应用侧校验。** schema 是给模型的建议,不是保证。实验二里 `unpaid` 就是这么来的,真实模型也会这样犯错。

**并行调用里某个工具失败了,就不回它的 tool 消息。** 接口直接 400,整轮对话废掉。失败也要回一条,内容写错误原因。

**让模型在长结果里数数和求和。** 实验三两次温度 0 的运行分别答 34 和 24,真实是 43。确定性计算交给代码。

**相信「向量检索对错误码完全没用」。** 我试的六种问法里它五种排对了,只有语义上有更像的干扰项时才排错。说过头的结论,面试官一个反例就能问倒你。

**新增一套数据,只改了写入的地方,忘了读取的地方。** 今天的 `KeyError: '25'` 就是:日志里有了第二套题,`weak.py` 还只读第一套。RAG 里文档加了、索引没重建,是同一类错。

## 学习资料

### 文档与文章

- [OpenAI · Function calling](https://platform.openai.com/docs/guides/function-calling):tool_calls 的完整结构、并行调用、strict 模式,第 14、18 题的原始出处。
- [DeepSeek · Function Calling](https://api-docs.deepseek.com/zh-cn/guides/function_calling):DeepSeek 的写法和示例,中文,十分钟能看完。
- [Anthropic · Writing effective tools for agents](https://www.anthropic.com/engineering/writing-tools-for-agents):第 16、17、20 题的底子,讲工具描述、返回值裁剪和「报错要能指导改正」,面试前读一遍。
- [Anthropic · Contextual Retrieval](https://www.anthropic.com/news/contextual-retrieval):讲混合检索加 rerank 能把检索失败率降多少,第 22 到 24 题都能引用里面的数字。
- [Cormack 等 · Reciprocal Rank Fusion(SIGIR 2009)](https://plg.uwaterloo.ca/~gvcormac/cormacksigir09-rrf.pdf):RRF 的原论文,只有两页,k=60 就是从这来的。
- [pgvector](https://github.com/pgvector/pgvector):第 27 题,README 里的过滤、HNSW 参数和混合检索示例。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1wPEm6DEzS&autoplay=0&high_quality=1" title="从原理到代码，将清楚大模型的Tool Use和Function Calling" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>懂点AI的H先生 · 从原理到代码,将清楚大模型的Tool Use和Function Calling · 17 分钟,2026 年 6 月。从原理讲到代码,看完对着实验一的输出再答一遍第 14 题。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1SafMYFE9j&autoplay=0&high_quality=1" title="RAG 效果不理想 ？ “混合搜索” 来帮忙" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>Jim大表哥2025 · RAG 效果不理想?「混合搜索」来帮忙 · 约 6 分钟,一万多播放。讲向量和关键词各自的短板,第 23 题的直观版本。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1jttm6qEmG&autoplay=0&high_quality=1" title="RAG混合检索 多路召回 RRF融合 原理和流程拆解" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>AI罐装知识 · RAG混合检索 多路召回 RRF融合 原理和流程拆解 · 3 分半,2026 年 9 月。看完自己按实验四的数手算一遍 RRF。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/sVcwVQRHIc8" title="Learn RAG From Scratch – Python AI Tutorial from a LangChain Engineer" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>freeCodeCamp.org · Learn RAG From Scratch(LangChain 的 Lance Martin 主讲)· 两个半小时,今天不用全看。query 改写、路由、索引和 rerank 几段对应第 21、22、24、28 题,挑着看。</figcaption>
</figure>

### 书籍

- Chip Huyen《AI Engineering》(O'Reilly,2025):第 6 章 RAG and Agents,前半讲检索(切块、混合检索、rerank),后半讲工具和规划,正好是今天这一套题的范围。
- Jay Alammar、Maarten Grootendorst《Hands-On Large Language Models》(O'Reilly,2024):第 8 章 Semantic Search and Retrieval-Augmented Generation,图多,交叉编码器 rerank 那一节把第 24 题讲得很清楚。

### 开源项目与代码

- [datawhalechina/all-in-rag](https://github.com/datawhalechina/all-in-rag):Datawhale 的中文 RAG 教程,从切块到混合检索、评估都有代码,当第 21 到 28 题的中文复习材料。
- [explodinggradients/ragas](https://github.com/explodinggradients/ragas):RAG 评估框架,第 26 题提到的忠实度、答案相关性等指标的实现都在里面。

## 自测

1. 实验一里模型返回的 `arguments` 是什么类型?这对你写执行代码有什么影响?

<details><summary>答案</summary>

是字符串(`str`),内容是 JSON。执行前要 `json.loads`,而且要处理它不是合法 JSON 的情况;解析后还要校验字段和取值,不能直接把它展开传给函数。

</details>

2. `weak.py` 为什么会报 `KeyError: '25'`?为什么不是先在 `加2` 那里报?

<details><summary>答案</summary>

日志里有第二套题(第 25 题),而 `weak.py` 的 `bank` 字典只用 `load_bank()` 读了第一套,里面没有 `'25'` 这个键。回炉清单按分数从低到高排序,第 25 题 0 分排在最前,第一次循环就去查它;`加2` 在第一套里,查得到,不会报错。

</details>

3. 实验三里原样塞 500 条时,第二次运行的花费从 ¥0.039 降到了 ¥0.0013,是因为什么?能不能据此说「长结果不贵」?

<details><summary>答案</summary>

第二次的输入和第一次一字不差,命中了 DeepSeek 的前缀缓存,命中部分单价只有未命中的五十分之一。不能据此说长结果不贵:真实场景里每个客户、每次查询的结果都不一样,不会命中缓存;而且两次都答错了,贵不贵是次要的。

</details>

4. 实验四里 RRF 怎么让 E1042 排到第一?把 k 从 60 改成 1 会怎样?

<details><summary>答案</summary>

E1042 向量第 2、关键词第 1,得 1/62 + 1/61 ≈ 0.0325;E2042 向量第 1、关键词第 5,得 1/61 + 1/65 ≈ 0.0318,E1042 略高。k=1 时,E1042 得 1/3 + 1/2 ≈ 0.833,E2042 得 1/2 + 1/6 ≈ 0.667,差距变大,排在前面的名次权重更重。k 越小越看重头几名,k 越大各名次之间的差别越平。

</details>

5. (面试题)「你们的 Agent 调用工具时,模型给的参数经常不对,你怎么处理?」用四步结构答。

<details><summary>答案</summary>

定义:这是工具参数合规问题,模型只是请求调用,参数对不对要应用侧把关。机制:执行前校验,工具名查注册表,参数用 pydantic 校验类型和取值;不通过就把报错原文作为 tool 结果回传,让模型自己改,限制最多重试两次,再错就终止转人工。取舍:重试增加一轮调用的延迟和花费,所以先从源头减少,参数用枚举、描述里写清业务词对应的取值;校验错误要记进指标,作为工具调用错误率持续看。例子:我测过模型把「没付」翻成 `status="unpaid"`,而我们的取值是 `open`,pydantic 报错原文回传后一次改对,花了 ¥0.0011。

</details>

6. (面试题)「既然 rerank 比向量检索准,为什么不直接用 rerank 模型做检索?」

<details><summary>答案</summary>

rerank 是交叉编码器,每个(query, 文档)对都要单独过一遍模型,文档不能提前算好建索引。全库几万条,每次查询都要算几万次,延迟和花费都扛不住。向量检索的文档向量是离线算好的,查询时只算一次 query 向量,再用 HNSW 这类索引近似查找,毫秒级。所以先用向量加关键词粗召回几十条,再用 rerank 精排。我测过一个错误码的例子,rerank 给正确文档 0.93、干扰项 0.11,而向量检索两者只差 0.025 还排反了,但它是在 5 条候选上做的。

</details>

## 明天预告

Day 505 · 面试(三):Agent 架构、框架原理与上下文工程题。今天两套题考的是「零件」:工具怎么调、检索怎么做。明天第三套往上一层,问这些零件怎么组成一个 Agent:Workflow 和 Agent 怎么选、LangGraph 底层的状态和 reducer 是怎么回事、上下文越来越长时怎么压缩。题库换成 `bank3.json`,`load_all` 会自动把它读进来,实验会用一个不调模型的 LangGraph 小图把「reducer」和「超步」跑给你看。
