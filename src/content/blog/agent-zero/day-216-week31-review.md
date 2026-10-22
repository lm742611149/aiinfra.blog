---
title: 'Day 216 · 第 31 周复习:RAG 与上下文(Day 210–215)'
description: '这一周前两天学怎么用 Coding Agent 干活(AGENTS.md、hooks),后四天从关键词搜索失败走到向量、numpy 和余弦相似度。今天默写两段核心代码,再拼一个「关键词搜索和向量搜索并排比」的小项目,全程不调模型、不花钱。'
pubDate: 2026-10-22
regime: none
tags: ['review', 'rag', 'cosine-similarity', 'hooks', 'agent-zero']
series: 'agent-zero'
day: 216
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 215](/blog/agent-zero/day-215-cosine/) 我们手算了余弦相似度,用纯 Python 和 numpy 各验算一遍,学会了归一化,还踩了一次零向量的坑:numpy 遇到 0 除以 0 只打一行警告,返回 `nan`,然后 `np.argmax` 会把这个 `nan` 当成最大值选出来。

到这里,第四部分最底层的那块数学已经齐了。明天就要调真正的 embedding 服务,拿到模型给的 1024 个数。在那之前停一天,把这一周六课串起来:前两天是用 Coding Agent 干活的规矩,后四天是「为什么要向量、向量怎么比」。这两件事看起来不搭界,复习时你会发现它们都在回答同一个问题:**怎么让机器少犯那种不报错的错**。

## 今天要解决的问题

学完今天,你应该能做到:

1. 合上文章,默写出 Day 212 的关键词搜索函数,并用一句客服问题说明它为什么会返回空列表。
2. 默写出 Day 211 那个 PreToolUse 钩子的精简版,用 `echo` 把三段假 JSON 喂给它,分别得到 deny、ask 和什么都不输出。
3. 用本周学过的东西拼一个 `w31_search.py`:同一组问题,左边跑关键词搜索,右边跑余弦相似度 top-2,索引时跳过零向量,并能讲清楚两边结果为什么不一样。
4. 不看笔记说出本周至少五个坑,每个坑能说出它的症状(报错还是不报错)和修法。

预计用时 3 小时:知识地图和一句话回顾 20 分钟,两段默写各 30 分钟,小项目 1 小时,剩下做练习和自测。前置:[Day 210](/blog/agent-zero/day-210-coding-agent-1/) 到 [Day 215](/blog/agent-zero/day-215-cosine/) 全部。今天所有脚本都不调模型,API 花费 0 元。

学法和平时一样:先对照文章逐行敲一遍(不复制粘贴)并跑通;明天合上文章把两段默写代码和 `w31_search.py` 再写一遍;做练习时先自己写,做不出再展开参考答案,看完关掉自己重写一遍。

## 本周知识地图

先看一张图,把这周六课放回它们各自的位置。

<figure>
<svg viewBox="0 0 640 310" role="img" aria-label="第 31 周知识地图:左边是 Coding Agent 的两层控制,右边是从关键词搜索到余弦相似度的四步">
<rect x="0" y="0" width="640" height="310" fill="var(--paper-raised)"/>
<g font-family="var(--font-mono)" font-size="12">
<text x="20" y="26" fill="var(--ink)">用 Coding Agent 干活</text>
<rect x="20" y="40" width="200" height="52" rx="5" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="30" y="61" fill="var(--ink)">Day 210 AGENTS.md</text>
<text x="30" y="80" fill="var(--ink-soft)" font-size="11">给模型看的说明:是建议</text>
<rect x="20" y="112" width="200" height="52" rx="5" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="30" y="133" fill="var(--ink)">Day 211 hooks</text>
<text x="30" y="152" fill="var(--ink-soft)" font-size="11">你写的程序:是强制</text>
<line x1="120" y1="92" x2="120" y2="112" stroke="var(--ink-faint)" marker-end="url(#m216)"/>
<text x="20" y="190" fill="var(--ink-soft)" font-size="11">「请不要读 .env」写进 AGENTS.md</text>
<text x="20" y="208" fill="var(--ink-soft)" font-size="11">真正拦住它的是 PreToolUse 钩子</text>
<line x1="248" y1="30" x2="248" y2="290" stroke="var(--rule)" stroke-dasharray="4 4"/>
<text x="270" y="26" fill="var(--ink)">从关键词到向量</text>
<rect x="270" y="40" width="168" height="52" rx="5" fill="none" stroke="var(--ink-soft)"/>
<text x="280" y="61" fill="var(--ink)">Day 212 关键词</text>
<text x="280" y="80" fill="var(--ink-soft)" font-size="11">同义说法搜不到</text>
<rect x="456" y="40" width="168" height="52" rx="5" fill="none" stroke="var(--ink-soft)"/>
<text x="466" y="61" fill="var(--ink)">Day 213 向量</text>
<text x="466" y="80" fill="var(--ink-soft)" font-size="11">意思变成位置、距离</text>
<rect x="456" y="112" width="168" height="52" rx="5" fill="none" stroke="var(--ink-soft)"/>
<text x="466" y="133" fill="var(--ink)">Day 214 numpy</text>
<text x="466" y="152" fill="var(--ink-soft)" font-size="11">ndarray、@、norm</text>
<rect x="270" y="112" width="168" height="52" rx="5" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="280" y="133" fill="var(--ink)">Day 215 余弦</text>
<text x="280" y="152" fill="var(--ink-soft)" font-size="11">只看方向;归一化</text>
<line x1="438" y1="66" x2="456" y2="66" stroke="var(--ink-faint)" marker-end="url(#m216)"/>
<line x1="540" y1="92" x2="540" y2="112" stroke="var(--ink-faint)" marker-end="url(#m216)"/>
<line x1="456" y1="138" x2="438" y2="138" stroke="var(--ink-faint)" marker-end="url(#m216)"/>
<rect x="270" y="196" width="354" height="52" rx="5" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="280" y="217" fill="var(--ink)">今天的 w31_search.py</text>
<text x="280" y="236" fill="var(--ink-soft)" font-size="11">关键词 vs 余弦 top-2,跳过零向量</text>
<line x1="354" y1="164" x2="354" y2="196" stroke="var(--ink-faint)" marker-end="url(#m216)"/>
<text x="270" y="280" fill="var(--ink-soft)" font-size="11">明天 Day 217:把手工编的 4 个数换成模型给的 1024 个数</text>
<defs><marker id="m216" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L8,4 L0,8 z" fill="var(--ink-faint)"/></marker></defs>
</g>
</svg>
<figcaption>左边两课讲的是「模型会不会照你说的做」:写在指令文件里的是建议,写成钩子的才是强制。右边四课是一条直线,每一课都在补上一课留下的洞:关键词搜不到同义句,于是要向量;距离会被长度带偏,于是要余弦。</figcaption>
</figure>

## 本周每天一句话

- [Day 210 · 用 Coding Agent 干活(一):AGENTS.md 和 CLAUDE.md](/blog/agent-zero/day-210-coding-agent-1/):给 Coding Agent 一份短小的项目说明,写命令、约定和不要做的事;它是每次对话都会读进上下文的「建议」,写长了反而稀释重点。
- [Day 211 · 用 Coding Agent 干活(二):hooks、权限、无人值守和规格驱动](/blog/agent-zero/day-211-coding-agent-2/):钩子是 Claude Code 在工具调用前后调用的你自己的程序,把「请不要」变成「不能」;退出码 1 拦不住任何东西,要么 exit 2,要么 exit 0 加一段写明 deny 的 JSON。
- [Day 212 · 关键词搜索为什么不够](/blog/agent-zero/day-212-why-vectors/):客户问「买错了能把钱要回来吗」,《退款政策》一个字都对不上,逐字比对的搜索返回空;我们需要按「意思」而不是按「字」找。
- [Day 213 · 向量是什么:先从二维说起](/blog/agent-zero/day-213-vectors-2d/):向量就是一串有顺序的数字,意思相近的文字放在相近的位置;距离用勾股定理算,但长文章和短问题方向一样,距离却可能很远。
- [Day 214 · numpy 够用版:数组、点积和范数](/blog/agent-zero/day-214-numpy-basics/):`ndarray` 让一行代码处理整串数字,`a @ b` 是点积,`np.linalg.norm(a)` 是长度;整数数组塞小数会被悄悄截掉。
- [Day 215 · 余弦相似度:手算一遍](/blog/agent-zero/day-215-cosine/):余弦 = 点积 ÷ 两个长度,只看方向;归一化以后余弦就等于点积;零向量会变成 `nan`,要在入库和计算两处拦住。

读完哪一句想不起对应的代码,先回那一天把代码扫一眼再往下做。

## 默写一:关键词搜索

这是 Day 212 的核心,也是今天小项目的左半边。合上 Day 212,自己写一个函数:输入一句问题,按空格拆成几个词,返回「正文里每个词都出现了」的文章标题。写完再对照下面这份。

新建 `part04/w31_keyword.py`(在 `agent-zero-lab` 根目录下,和 Day 213–215 的脚本放一起):

```python
# agent-zero-lab/part04/w31_keyword.py
ARTICLES = {
    "退款政策": "年付套餐中途取消的,按剩余的整月数比例退款。月付套餐当月不退。",
    "开发票指南": "在账单页点申请发票,抬头填错可以作废后重开。",
    "重置密码": "在登录页点忘记密码,重置邮件 10 分钟内送达。",
}


def keyword_search(query: str) -> list[str]:
    words = query.split()
    return [title for title, body in ARTICLES.items() if all(w in body for w in words)]


for q in ["退款", "发票 作废", "买错了能把钱要回来吗", "登不上去了"]:
    print(f"{q!r:<16} -> {keyword_search(q)}")
```

<div class="line-notes">

- `ARTICLES = {` 三篇帮助文章,标题当 key、正文当 value,相当于 JS 的 `{ "退款政策": "...", ... }`。和 Day 213 的三篇是同一组。
- `def keyword_search(query: str) -> list[str]:` 输入一句问题,输出命中的标题列表。
- `words = query.split()` 不带参数的 `split()` 按任意空白切,相当于 JS 的 `query.trim().split(/\s+/)`。`"发票 作废"` 切成 `["发票", "作废"]`;中文句子里没有空格,`"买错了能把钱要回来吗"` 整句就是一个词。
- `all(w in body for w in words)` 整行是一个带过滤条件的列表推导式,相当于 `Object.entries(ARTICLES).filter(...).map(([t]) => t)`。过滤条件里 `w in body` 判断子串是否出现,相当于 JS 的 `body.includes(w)`;`all(...)` 要求每个词都出现,相当于 `words.every(w => body.includes(w))`。
- `print(f"{q!r:<16} -> {keyword_search(q)}")` `!r` 打印带引号的字符串(相当于 `JSON.stringify(q)`),`:<16` 左对齐占 16 格。

</div>

```bash
cd agent-zero-lab
uv run python part04/w31_keyword.py
```

真实输出:

```text
'退款'             -> ['退款政策']
'发票 作废'          -> ['开发票指南']
'买错了能把钱要回来吗'     -> []
'登不上去了'          -> []
```

前两行说明关键词搜索不是没用:客户用了文章里的原词,它又快又准。后两行就是 Day 212 的老问题。「买错了能把钱要回来吗」这十个字没有一个连续的片段出现在《退款政策》里,「登不上去了」和「忘记密码」也对不上。列宽对得不齐是因为中文字符在终端里占两格,`:<16` 按字符数补空格,这不是 bug。

默写时最常见的错误是把 `all` 写成 `any`。写成 `any` 以后「发票 作废」只要出现一个词就命中,结果会变多,在只有三篇文章的时候你看不出来,文章一多就会捞上来一堆不相干的。

## 默写二:拦截钩子的精简版

Day 211 讲过,Claude Code 每次要调工具之前,会新起一个进程跑你的 PreToolUse 钩子,把这次调用的 JSON 从标准输入(stdin)交给它。钩子读完决定放行、拒绝还是要人确认。今天默写一个只有三条规则的精简版:拦读写 `.env`、拦 `rm -rf`、`git push` 要人点头。

先自己写,写完对照:

```python
# agent-zero-lab/part04/w31_guard.py
import json
import re
import sys

event = json.load(sys.stdin)
tool = event.get("tool_name", "")
args = event.get("tool_input", {})


def decide(decision: str, reason: str) -> None:
    out = {
        "hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": decision,
            "permissionDecisionReason": reason,
        }
    }
    print(json.dumps(out, ensure_ascii=False))
    sys.exit(0)


path = args.get("file_path", "")
if tool in {"Read", "Edit", "Write"} and path.endswith(".env"):
    decide("deny", f"{path} 里是密钥,不许读也不许改")

if tool == "Bash":
    cmd = args.get("command", "")
    if re.search(r"\brm\s+-[a-z]*r[a-z]*f", cmd):
        decide("deny", f"危险命令:{cmd}")
    if re.search(r"\bgit\s+push\b", cmd):
        decide("ask", "要推到远程,先让人看一眼")

sys.exit(0)
```

<div class="line-notes">

- `event = json.load(sys.stdin)` 从标准输入读一整段 JSON 并解析成字典。相当于 Node 里把 `process.stdin` 读完再 `JSON.parse`。拿第一个测试输入代入,得到 `{"tool_name": "Read", "tool_input": {"file_path": "/x/agent-zero-lab/.env"}}`。
- `tool = event.get("tool_name", "")` 代入后是 `"Read"`。用 `.get` 带默认值,事件里少了字段钩子也不会崩。
- `args = event.get("tool_input", {})` 工具参数。文件类工具里是 `file_path`,Bash 里是 `command`。
- `def decide(decision: str, reason: str) -> None:` 把决定写成 JSON 打印到标准输出(stdout),然后退出。
- `"permissionDecision": decision,` 可以是 allow、deny、ask。deny 直接拒绝,ask 弹窗让人确认。
- `"permissionDecisionReason": reason,` 理由会被模型看到,写清楚它才知道下一步该怎么办,而不是换个姿势再试一次。
- `print(json.dumps(out, ensure_ascii=False))` `ensure_ascii=False` 让中文原样输出,不变成 `密` 这种转义。
- `sys.exit(0)` 打印完决定后用 0 退出。Claude Code 按 JSON 里写的决定办。这里写成 `exit(1)` 是本周最大的坑:非 0、非 2 的退出码都被当成「钩子自己出错了」,操作照常执行。
- `if tool in {"Read", "Edit", "Write"} and path.endswith(".env"):` 精简版只认以 `.env` 结尾的路径。Day 211 的完整版用正则连 `.env.deepseek` 也拦住,并单独放行 `.env.example`。
- `cmd = args.get("command", "")` 第二个测试输入代入后是 `"rm -rf part04"`。
- `re.search(r"\brm\s+-[a-z]*r[a-z]*f", cmd)` `\b` 是单词边界,`\s+` 是至少一个空白,`-[a-z]*r[a-z]*f` 要求先出现 `r` 再出现 `f`,中间可以夹别的小写字母。我实测了五种写法:`rm -rf`、`rm -rvf` 命中;`rm -fr`、`rm -Rf`(大写 R)、`rm -r` 都**不命中**。所以这条规则是有洞的,练习 2 之后你可以自己把它补全(提示:`[a-zA-Z]*` 加上「r 和 f 都出现、顺序不限」)。相当于 JS 的 `/\brm\s+-[a-z]*r[a-z]*f/.test(cmd)`。
- `re.search(r"\bgit\s+push\b", cmd)` 第三个测试 `git push origin main` 命中,返回 ask。
- `sys.exit(0)` 最后一行:什么规则都没命中,什么都不打印,exit 0,走正常的权限流程。

</div>

钩子是普通程序,不用打开 Claude Code 就能测:把 JSON 用管道喂进去。在 `agent-zero-lab` 根目录跑:

```bash
echo '{"tool_name":"Read","tool_input":{"file_path":"/x/agent-zero-lab/.env"}}' | uv run python part04/w31_guard.py; echo "exit $?"
echo '{"tool_name":"Bash","tool_input":{"command":"rm -rf part04"}}' | uv run python part04/w31_guard.py; echo "exit $?"
echo '{"tool_name":"Bash","tool_input":{"command":"git push origin main"}}' | uv run python part04/w31_guard.py; echo "exit $?"
echo '{"tool_name":"Bash","tool_input":{"command":"uv run python part04/cos_table.py"}}' | uv run python part04/w31_guard.py; echo "exit $?"
```

真实输出:

```text
{"hookSpecificOutput": {"hookEventName": "PreToolUse", "permissionDecision": "deny", "permissionDecisionReason": "/x/agent-zero-lab/.env 里是密钥,不许读也不许改"}}
exit 0
{"hookSpecificOutput": {"hookEventName": "PreToolUse", "permissionDecision": "deny", "permissionDecisionReason": "危险命令:rm -rf part04"}}
exit 0
{"hookSpecificOutput": {"hookEventName": "PreToolUse", "permissionDecision": "ask", "permissionDecisionReason": "要推到远程,先让人看一眼"}}
exit 0
exit 0
```

四次退出码都是 0,区别全在 stdout 上有没有那段 JSON、JSON 里写的是什么。最后一条是正常命令,什么都没打印,放行。`echo "exit $?"` 里的 `$?` 是 shell 变量,代表上一条命令的退出码,前端同学在 `npm test` 失败后 `echo $?` 看到 1 就是它。

这段默写和左边那张图对上了:Day 210 的 AGENTS.md 里可以写一句「不要读 .env」,模型多数时候会照做;这个钩子保证它照做。

## 小项目:关键词和余弦并排比

现在把本周后四天拼起来。给 CloudLedger 帮助中心五篇文章,每篇配一个手工编的四维向量(四维还是 Day 213 那套:钱、发票、登录、情绪),再准备三个问题,每个问题同时跑一次关键词搜索和一次余弦 top-2。

第五篇文章是故意放的坑:《价格页》还没写正文,向量是全 0。它模拟的是真实知识库里常见的「空页面」,Day 215 说过,零向量不拦住,`argmax` 会把它排到第一。

新建 `part04/w31_search.py`:

```python
# agent-zero-lab/part04/w31_search.py
import numpy as np

TITLES = ["退款政策", "开发票指南", "重置密码", "账号被锁", "价格页(空)"]
BODIES = [
    "年付套餐中途取消的,按剩余的整月数比例退款。月付套餐当月不退。",
    "在账单页点申请发票,抬头填错可以作废后重开。",
    "在登录页点忘记密码,重置邮件 10 分钟内送达。",
    "连续输错 5 次密码账号会锁 30 分钟,也可以联系客服解锁。",
    "",
]
VECS = np.array([
    [0.9, 0.2, 0.0, 0.1],
    [0.3, 0.9, 0.0, 0.0],
    [0.0, 0.0, 0.9, 0.1],
    [0.0, 0.0, 0.7, 0.5],
    [0.0, 0.0, 0.0, 0.0],
])
QUESTIONS = {
    "退款": np.array([0.9, 0.1, 0.0, 0.1]),
    "买错了能把钱要回来吗": np.array([0.8, 0.1, 0.0, 0.4]),
    "登不上去了气死": np.array([0.0, 0.0, 0.8, 0.9]),
}


def keyword_search(query: str) -> list[str]:
    words = query.split()
    return [t for t, b in zip(TITLES, BODIES, strict=True) if b and all(w in b for w in words)]


def normalize(v: np.ndarray) -> np.ndarray:
    n = np.linalg.norm(v)
    if n == 0:
        raise ValueError("零向量没有方向,不能归一化")
    return v / n


index: list[tuple[str, np.ndarray]] = []
for title, vec in zip(TITLES, VECS, strict=True):
    try:
        index.append((title, normalize(vec)))
    except ValueError as e:
        print(f"跳过《{title}》:{e}")


def vector_search(q: np.ndarray, k: int = 2) -> list[tuple[str, float]]:
    q_unit = normalize(q)
    scored = [(title, float(unit @ q_unit)) for title, unit in index]
    scored.sort(key=lambda pair: pair[1], reverse=True)
    return [(title, round(score, 4)) for title, score in scored[:k]]


print("索引里有", len(index), "篇")
for text, vec in QUESTIONS.items():
    print(f"问题:{text}")
    print("  关键词:", keyword_search(text))
    print("  向量 top-2:", vector_search(vec))
```

<div class="line-notes">

- `TITLES = [` 五个标题。这次标题、正文、向量分成三个列表,用同一个下标对应,和 Day 214 `np_table.py` 的 `titles` 加 `articles` 是同一个写法。
- `BODIES = [` 五段正文,最后一段是空字符串。
- `VECS = np.array([` `(5, 4)` 的表,一行一篇。前三行和 Day 215 `cos_table.py` 一样;第四行《账号被锁》登录 0.7、情绪 0.5(被锁的人一般都不太高兴);第五行全 0。
- `QUESTIONS = {` 三个问题,值是问题向量。第一个是能被关键词搜到的,后两个是 Day 212 的老难题。
- `def keyword_search(query: str) -> list[str]:` 默写一的函数,改成从两个列表里取。
- `zip(TITLES, BODIES, strict=True)` Day 213 的规矩:`zip` 一律加 `strict=True`,两个列表长度不同就报错,不会悄悄截断。同一行后半段多了一个 `if b and`:空正文直接跳过。空字符串在 Python 里算「假」,和 JS 一样。
- `def normalize(v: np.ndarray) -> np.ndarray:` Day 215 练习 2 的安全版归一化。
- `n = np.linalg.norm(v)` 向量长度。第一行 `[0.9, 0.2, 0.0, 0.1]` 是 √0.86 ≈ 0.9274。
- `if n == 0:` 全 0 向量的长度精确等于 0.0,这里用 `==` 没有浮点误差的问题。
- `raise ValueError("零向量没有方向,不能归一化")` 不返回 `nan`,直接抛异常,调用方必须处理。
- `return v / n` 每一位除以长度,方向不变,长度变成 1。
- `index: list[tuple[str, np.ndarray]] = []` 「索引」:一个列表,每项是 `(标题, 归一化后的向量)`。这就是向量库最朴素的样子,Day 225 会把它存成文件。
- `for title, vec in zip(TITLES, VECS, strict=True):` 遍历二维数组时每次拿到一行,和标题配对。
- `try:` [Day 35](/blog/agent-zero/day-035-exceptions-1/) 学的异常捕获,相当于 JS 的 `try { } catch (e) { }`。
- `index.append((title, normalize(vec)))` 正常的四篇进索引。
- `except ValueError as e:` 第五篇走到这里。
- `print(f"跳过《{title}》:{e}")` 入库时就把零向量拦下,并打一行日志。这是 Day 215 说的第一层拦截。
- `def vector_search(q: np.ndarray, k: int = 2) -> list[tuple[str, float]]:` 输入问题向量,返回前 k 篇的标题和分数。
- `q_unit = normalize(q)` 问题也归一化。问题向量是零向量时这里会抛异常,这是第二层拦截。
- `scored = [(title, float(unit @ q_unit)) for title, unit in index]` 两个单位向量的点积就是余弦。「买错了能把钱要回来吗」和《退款政策》:原始点积 0.78,除以 0.9274 × 0.9 得 0.9346,和 Day 215 的结果一样。`float()` 把 `np.float64` 转成普通小数。
- `scored.sort(key=lambda pair: pair[1], reverse=True)` 按分数从大到小原地排序。`lambda pair: pair[1]` 就是 JS 的 `pair => pair[1]`,整句相当于 `scored.sort((a, b) => b[1] - a[1])`。
- `return [(title, round(score, 4)) for title, score in scored[:k]]` 取前 k 个,分数保留 4 位小数方便看。
- `print("索引里有", len(index), "篇")` 应该是 4 篇,空页面被跳过了。
- `for text, vec in QUESTIONS.items():` 逐个问题跑两种搜索。

</div>

```bash
uv run python part04/w31_search.py
```

真实输出:

```text
跳过《价格页(空)》:零向量没有方向,不能归一化
索引里有 4 篇
问题:退款
  关键词: ['退款政策']
  向量 top-2: [('退款政策', 0.9942), ('开发票指南', 0.4165)]
问题:买错了能把钱要回来吗
  关键词: []
  向量 top-2: [('退款政策', 0.9346), ('开发票指南', 0.3865)]
问题:登不上去了气死
  关键词: []
  向量 top-2: [('账号被锁', 0.975), ('重置密码', 0.7428)]
```

一行一行读。第一行是入库时的拦截,空页面没有进索引,后面三个问题都不会被它干扰。

「退款」两边都对。关键词精确命中,向量给《退款政策》0.9942,第二名《开发票指南》只有 0.4165,差得很开。

「买错了能把钱要回来吗」关键词返回空,向量把《退款政策》排第一。这一行就是这一周后四课存在的理由。

「登不上去了气死」最有意思。关键词还是空。向量给《账号被锁》0.975,比《重置密码》的 0.7428 高。原因在第四维「情绪」:问题的情绪分是 0.9,《账号被锁》是 0.5,《重置密码》只有 0.1。这几个数是我手工编的,真实模型会不会也这样判断,要等 Day 217 拿到真向量才知道。这也提醒你一件事:向量搜索的结果完全取决于向量怎么来,手工编的数字能演示机制,不能证明效果。

还有一处容易忽略。三个问题的第二名分数都不低(0.39 到 0.74),向量搜索永远会返回 k 个结果,哪怕没有一篇真正相关。关键词搜索返回空的时候至少诚实地告诉你「没找到」。这两种搜索各有短板,后面 [Day 235](/blog/agent-zero/day-235-bm25/) 讲 BM25、[Day 236](/blog/agent-zero/day-236-rrf/) 讲 RRF,就是把两边合起来用。

零件和大代码的对照:

| 零件 | 来自哪天 | 在 `w31_search.py` 的哪一段 |
| --- | --- | --- |
| 关键词搜索 `keyword_search` | Day 212,今天默写一 | 第一个函数 |
| 向量就是一行数字,表是 `(N, 4)` | Day 213、214 | `VECS = np.array([...])` |
| `zip(..., strict=True)` | Day 213 | 两处 `zip` |
| 范数 `np.linalg.norm` | Day 214 | `normalize` 里 |
| 安全归一化 | Day 215 练习 2 | `normalize` |
| 单位向量点积 = 余弦 | Day 215 | `unit @ q_unit` |
| 零向量入库时拦截 | Day 215 | 建 `index` 的那个 `for` 循环 |

把这个脚本留着,Day 217 拿到真的 embedding 以后,你可以把 `VECS` 换成模型的输出再跑一遍,看结论还成不成立。

## 本周错题与坑清单

按「真踩过」的程度排。每一条后面括号里写的是症状:报错的坑好查,不报错的坑才要命。

**钩子用 `exit 1` 表示拒绝。**(不报错,操作照常执行)Unix 习惯里失败就 exit 1,但 Claude Code 把 1 当成钩子自己出错。要拦就 exit 2,或者 exit 0 加 deny 的 JSON。

**只在 AGENTS.md 里写「不要读 .env」。**(不报错,偶尔被违反)指令文件是上下文,不是配置。模型在认真排查问题时可能照样 `cat .env`。要强制就写钩子。

**AGENTS.md 写成长篇文档。**(不报错,模型越来越不听)它每次对话都会被读进上下文,写得越长,真正重要的几条越不显眼。练习 3 写了个检查脚本。

**中文句子直接拿去做关键词搜索。**(不报错,返回空)`split()` 按空白切,中文没空格,整句话成了一个「词」。这是关键词搜索在中文上更难用的原因之一,真正的中文关键词检索要先分词,Day 235 讲 BM25 时会碰到。

**`zip` 不加 `strict=True`。**(不报错,数据被截断)维度对不上时悄悄扔掉多出来的那一位,算出的距离和余弦看起来完全正常。

**往整数数组里填小数。**(不报错,小数被截掉)`np.array([0, 0, 0])` 是 `int64`,塞进 0.93 变成 0。建全零小数数组用 `np.zeros(3)`。

**对方阵按行归一化忘了 `keepdims=True`。**(不报错,结果全错)`(3, 4)` 除以 `(3,)` 会报 broadcast 错误,这还算幸运;`(2, 2)` 除以 `(2,)` 不报错,把每一列除了。练习 4 会让你亲眼看到。

**零向量没拦。**(只有一行警告)`nan` 让 `argmax` 选错文章。入库拦一次,计算时再拦一次。

**拿余弦当概率、设固定阈值。**(不报错,换模型就失灵)0.8 不是「80% 相关」。Day 218 会用真实矩阵让你看到分数挤在一个窄区间里。

一共九条,七条不报错。这一周的主线其实就是这个:向量检索的 bug 大多数不会抛异常,只会给你一个看起来正常的错数字。钩子那两条也是,规则写错了不会崩,只会悄悄放行。

## 动手练习

**练习 1:往小项目里加一篇文章。** 新增《改发票抬头》,正文「发票开出后 30 天内可以改抬头,在发票详情页点修改。」,向量 `[0.2, 0.9, 0.0, 0.2]`;再加一个问题「抬头写错了」,向量 `[0.1, 0.9, 0.0, 0.3]`。跑一遍,看看四个问题的结果有没有变化,解释为什么「抬头写错了」关键词搜不到。

<details><summary>参考答案</summary>

把 `w31_search.py` 复制成 `part04/ex_w31_more.py`,只改四处,下面只列出改动的部分,其余和 `w31_search.py` 完全一样:

```python
# agent-zero-lab/part04/ex_w31_more.py
TITLES = ["退款政策", "开发票指南", "重置密码", "账号被锁", "价格页(空)", "改发票抬头"]
BODIES = [
    "",
    "发票开出后 30 天内可以改抬头,在发票详情页点修改。",
]
VECS = np.array([
    [0.0, 0.0, 0.0, 0.0],
    [0.2, 0.9, 0.0, 0.2],
])
QUESTIONS = {
    "登不上去了气死": np.array([0.0, 0.0, 0.8, 0.9]),
    "抬头写错了": np.array([0.1, 0.9, 0.0, 0.3]),
}
```

<div class="line-notes">

- `TITLES = [` 末尾加一个标题,变成 6 篇。
- `BODIES = [` 在空字符串那一项后面加新正文。三个列表都要加,少加一个,`zip(..., strict=True)` 会直接报错,这正是 `strict` 的用处。
- `VECS = np.array([` 在全 0 那一行后面加 `[0.2, 0.9, 0.0, 0.2]`,表变成 `(6, 4)`。
- `QUESTIONS = {` 在最后加一个问题。

</div>

```bash
uv run python part04/ex_w31_more.py
```

真实输出:

```text
跳过《价格页(空)》:零向量没有方向,不能归一化
索引里有 5 篇
问题:退款
  关键词: ['退款政策']
  向量 top-2: [('退款政策', 0.9942), ('开发票指南', 0.4165)]
问题:买错了能把钱要回来吗
  关键词: []
  向量 top-2: [('退款政策', 0.9346), ('改发票抬头', 0.3887)]
问题:登不上去了气死
  关键词: []
  向量 top-2: [('账号被锁', 0.975), ('重置密码', 0.7428)]
问题:抬头写错了
  关键词: []
  向量 top-2: [('改发票抬头', 0.9889), ('开发票指南', 0.9282)]
```

「抬头写错了」整句是一个词,正文里只有「改抬头」「抬头填错」,没有「抬头写错了」这个连续片段,所以关键词搜不到。向量把《改发票抬头》排第一(0.9889),《开发票指南》第二(0.9282),两篇都是发票主题,分数很接近。「买错了能把钱要回来吗」的第二名从《开发票指南》换成了《改发票抬头》(0.3887 比 0.3865 高一点点),第一名没变。

</details>

**练习 2:给钩子加一条规则。** `git reset --hard` 会丢掉没提交的改动,给 `w31_guard.py` 加一条 deny 规则。用三个命令测试:`git reset --hard HEAD~1` 要被拒,`git reset HEAD part04/x.py`(只是把文件移出暂存区,不危险)要放行,`git push origin main` 仍然是 ask。

<details><summary>参考答案</summary>

复制成 `part04/ex_guard_reset.py`,在 `if tool == "Bash":` 那段里、`git push` 规则之前加两行:

```python
# agent-zero-lab/part04/ex_guard_reset.py
    if re.search(r"\bgit\s+reset\s+--hard\b", cmd):
        decide("deny", f"会丢掉没提交的改动:{cmd}")
```

<div class="line-notes">

- `re.search(r"\bgit\s+reset\s+--hard\b", cmd)` 要求 `git`、`reset`、`--hard` 依次出现,中间至少一个空白。`git reset HEAD part04/x.py` 里没有 `--hard`,不命中。
- `decide("deny", f"会丢掉没提交的改动:{cmd}")` 理由里写清楚后果,模型看到以后会改用 `git stash` 之类更安全的办法,或者停下来问你。

</div>

```bash
for c in "git reset --hard HEAD~1" "git reset HEAD part04/x.py" "git push origin main"; do
  echo "{\"tool_name\":\"Bash\",\"tool_input\":{\"command\":\"$c\"}}" | uv run python part04/ex_guard_reset.py
  echo "[$c] exit $?"
done
```

真实输出:

```text
{"hookSpecificOutput": {"hookEventName": "PreToolUse", "permissionDecision": "deny", "permissionDecisionReason": "会丢掉没提交的改动:git reset --hard HEAD~1"}}
[git reset --hard HEAD~1] exit 0
[git reset HEAD part04/x.py] exit 0
{"hookSpecificOutput": {"hookEventName": "PreToolUse", "permissionDecision": "ask", "permissionDecisionReason": "要推到远程,先让人看一眼"}}
[git push origin main] exit 0
```

第二条什么都没打印,放行。顺序也有讲究:deny 规则放在 ask 规则前面,一条命令里如果既有 `reset --hard` 又有 `push`,先命中 deny 就直接退出了。

</details>

**练习 3:写一个 AGENTS.md 体检脚本。** Day 210 说 AGENTS.md 要短、要有命令、约定、不要做三块。写 `part04/check_agents_md.py`:读一个 Markdown 文件,超过 60 行报问题,缺 `## 命令`、`## 约定`、`## 不要做` 任何一节报问题,有问题时退出码 1(给 CI 用,不是给钩子用)。再给 `agent-zero-lab` 写一份能通过体检的 `AGENTS.md`。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part04/check_agents_md.py
import sys
from pathlib import Path

MAX_LINES = 60
MUST_HAVE = ["## 命令", "## 约定", "## 不要做"]

path = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("AGENTS.md")
if not path.exists():
    print(f"没找到 {path}")
    sys.exit(1)

lines = path.read_text(encoding="utf-8").splitlines()
problems = []
if len(lines) > MAX_LINES:
    problems.append(f"有 {len(lines)} 行,超过 {MAX_LINES} 行,模型每次都要读,写短点")
for head in MUST_HAVE:
    if head not in lines:
        problems.append(f"缺少小节:{head}")

print(f"{path}:{len(lines)} 行")
for p in problems:
    print("  问题:", p)
print("通过" if not problems else f"{len(problems)} 个问题")
sys.exit(1 if problems else 0)
```

<div class="line-notes">

- `MAX_LINES = 60` 行数上限是我拍的,团队可以自己定。官方文档没有给硬性数字,只是反复强调要短。
- `MUST_HAVE = ["## 命令", "## 约定", "## 不要做"]` 三个必须有的小节标题。
- `path = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("AGENTS.md")` `sys.argv` 是命令行参数列表,相当于 Node 的 `process.argv.slice(1)`;给了参数就检查那个文件,没给就检查当前目录的 `AGENTS.md`。`Path` 是 [Day 37](/blog/agent-zero/day-037-pathlib/) 学的。
- `if not path.exists():` 文件不存在就直接失败。
- `lines = path.read_text(encoding="utf-8").splitlines()` 读成字符串再按行切。下面拿坏样本测时这里是 7 行。
- `if len(lines) > MAX_LINES:` 超长报一条。
- `if head not in lines:` 判断某一行是否**整行等于**这个标题。写成 `## 命令(常用)` 就不算,这是故意的,标题统一才好找。
- `sys.exit(1 if problems else 0)` 有问题退出码 1,CI 会把这一步标红。注意这和钩子相反:CI 里非 0 就是失败,钩子里 1 却拦不住东西。

</div>

一份能过体检的 `agent-zero-lab/AGENTS.md`:

```markdown
# agent-zero-lab

AI Agent 课程的练习仓库,Python 3.12 + uv。每部分一个目录(part04/ 是 RAG)。

## 命令

- 装依赖:`uv add <包名>`(不要用 pip)
- 跑单个脚本:在仓库根目录 `uv run python part04/<文件>.py`
- 导入 common/ 的脚本用 `uv run python -m part04.<文件名>`

## 约定

- 代码第一行注释写完整路径,如 `# agent-zero-lab/part04/cos_table.py`
- 向量先归一化再点积;遇到零向量抛 ValueError,不要返回 nan
- zip 一律写 strict=True

## 不要做

- 不要读、改、打印 .env
- 不要改 common/ 下的公共接口,要改先说
```

再准备一份坏样本 `scratch/AGENTS_bad.md`,只有标题、一句介绍和 `## 命令` 一节,两份都测:

```bash
uv run python part04/check_agents_md.py scratch/AGENTS_bad.md; echo "exit $?"
uv run python part04/check_agents_md.py; echo "exit $?"
```

真实输出:

```text
scratch/AGENTS_bad.md:7 行
  问题: 缺少小节:## 约定
  问题: 缺少小节:## 不要做
2 个问题
exit 1
AGENTS.md:20 行
通过
exit 0
```

这份 AGENTS.md 里「向量先归一化」「zip 写 strict」两条,正是这一周踩的坑。把自己踩过的坑写进指令文件,是它最有价值的用法。

</details>

**练习 4(预测题):先写下你认为的输出,再跑。**

```python
# agent-zero-lab/part04/ex_w31_predict.py
import numpy as np

a = (1.0, 2.0, 2.0)
b = (2.0, 1.0)
print("1.", sum(x * y for x, y in zip(a, b)))

scores = np.array([0, 0, 0])
scores[0] = 0.93
print("2.", scores)

m = np.array([[3.0, 4.0], [6.0, 8.0]])
print("3.", (m / np.linalg.norm(m, axis=1)).round(2).tolist())

sims = np.array([0.71, np.nan, 0.88])
print("4.", int(np.argmax(sims)))
```

<div class="line-notes">

- `print("1.", sum(x * y for x, y in zip(a, b)))` 三维和二维做点积,`zip` 没加 `strict`。
- `scores = np.array([0, 0, 0])` 整数数组。
- `scores[0] = 0.93` 往里塞小数。
- `m = np.array([[3.0, 4.0], [6.0, 8.0]])` 两行,长度分别是 5 和 10。
- `m / np.linalg.norm(m, axis=1)` 按行归一化,但没写 `keepdims=True`。
- `sims = np.array([0.71, np.nan, 0.88])` 中间那篇是零向量算出来的 `nan`。

</div>

<details><summary>参考答案</summary>

```bash
uv run python part04/ex_w31_predict.py
```

真实输出:

```text
1. 4.0
2. [0 0 0]
3. [[0.6, 0.4], [1.2, 0.8]]
4. 1
```

四个都不报错,四个都是错的。

第 1 个:`zip` 只配了两对,1×2 + 2×1 = 4.0,第三维的 2.0 被扔了。加上 `strict=True` 会报 `zip() argument 2 is shorter than argument 1`。

第 2 个:0.93 被截成 0。改成 `np.zeros(3)`。

第 3 个:两行的长度是 `[5, 10]`,形状 `(2,)`。numpy 把它当成「每一列除以一个数」:第一列除以 5,第二列除以 10。第一行本该是 `[0.6, 0.8]`,结果成了 `[0.6, 0.4]`;第二行本该也是 `[0.6, 0.8]`,结果成了 `[1.2, 0.8]`,长度都不是 1 了。因为矩阵恰好是方的,形状对得上,一声不吭。加上 `keepdims=True` 就对了。

第 4 个:`argmax` 把 `nan` 当最大值,返回下标 1,而不是 0.88 所在的 2。

</details>

**验收标准:** 合上文章能写出 `keyword_search` 和 `w31_guard.py`,用 `echo` 测出 deny、ask、放行三种结果;`w31_search.py` 能跑出和上面一样的输出,并且能指着输出说出「跳过」那一行是哪一层拦截;练习 4 四个预测至少对三个,错的那个能说清原因。

## 名词解释

今天是复习日,下面多数是本周学过的词,括号里写首次出现的那一天。

| 名词 | 意思 |
| --- | --- |
| AGENTS.md(Day 210) | 写给 Coding Agent 看的项目说明,每次对话都会读进上下文。是建议,不是强制 |
| hook / 钩子(Day 211) | Claude Code 在固定时刻(比如工具调用前)调用的你自己的程序,可以拒绝、放行或要求确认 |
| PreToolUse(Day 211) | 工具调用执行之前触发的钩子事件,拦危险操作就挂在这里 |
| stdin / stdout | 标准输入、标准输出。钩子从 stdin 读事件 JSON,往 stdout 写决定 |
| 退出码(exit code) | 程序结束时返回给调用方的数字,`$?` 能看到。0 表示成功;对 Claude Code 钩子,2 才是阻断 |
| 关键词搜索(Day 212) | 逐字比对,问题里的词必须原样出现在正文里才算命中 |
| 向量(Day 213) | 一串有顺序的数字,可以看成点或从原点出发的箭头 |
| 点积、范数(Day 214) | 点积是逐位相乘再求和;范数是向量的长度 |
| 余弦相似度(Day 215) | 点积除以两个长度,只看方向,1 同向、0 垂直、-1 反向 |
| 归一化(Day 215) | 向量除以自己的长度,变成长度 1 的单位向量 |
| 索引 | 提前算好、存起来供检索用的数据。今天的 `index` 是一个 `(标题, 单位向量)` 列表 |
| top-k | 按分数从高到低取前 k 个结果 |

## 常见误区

**以为复习日就是重读一遍。** 重读的感觉是「都懂」,默写的感觉是「原来这里不会」。今天两段默写一定要先合上文章写,写错的地方才是你真正要复习的。

**以为向量搜索能完全替代关键词搜索。** 小项目里「退款」两边都对;而且向量搜索永远返回 k 个结果,没有相关文章时也会硬凑。客户报一个错误码 E1042 时,关键词反而更准,这件事 Day 219 会用真实向量证明。

**以为手工编的向量能说明模型效果。** 「登不上去了气死」排出《账号被锁》第一,是因为我给情绪维编了数。今天的向量只用来演示机制,Day 217 之后才轮到真实数据说话。

**钩子测一次就挂上去。** 钩子是普通程序,应该像今天这样先用 `echo` 喂假 JSON,把每条规则的命中和不命中都测一遍,再配进 `.claude/settings.json`。挂上去以后出了问题,你很难分清是钩子错了还是模型错了。

**把 CI 和钩子的退出码规则混了。** CI 脚本(练习 3)里退出码 1 就是失败;Claude Code 钩子里退出码 1 等于「钩子出错,操作继续」。同一个数字,两个地方意思相反。

## 学习资料

### 文档与文章

- [Claude Code · Hooks reference](https://code.claude.com/docs/en/hooks):复习默写二时对照看 PreToolUse 一节的输入 JSON 字段和 `permissionDecision` 的几种取值,再看一眼 exit code 那张表,确认「2 才是阻断」。
- [AGENTS.md](https://agents.md/):多家 Coding Agent 共同约定的指令文件格式,首页的示例很短,可以和练习 3 那份对比。
- [Claude Code · Memory](https://code.claude.com/docs/en/memory):讲 CLAUDE.md 放在哪几层、怎么被加载,Day 210 的内容在官方文档里的出处。
- [numpy.allclose 文档](https://numpy.org/doc/stable/reference/generated/numpy.allclose.html):比较两个小数数组是否「几乎相等」。Day 215 用过,明天比较两次 embedding 结果时还会用到同样的思路。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1CWV6zKEBn&autoplay=0&high_quality=1" title="从词袋法到词嵌入,词向量是如何演进的? BGE | TF-IDF | 词袋法 | WordEmbedding" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>费曼学徒冬瓜 · 从词袋法到词嵌入,词向量是如何演进的? · 15 分钟。从数词出现次数讲到词嵌入,正好是 Day 212 到 Day 215 这条线的另一种讲法;标题里提到的 BGE 就是明天要用的模型家族。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1yDLG6DE39&autoplay=0&high_quality=1" title="Hooks入门只需5分钟" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>Yin_Code · Hooks入门只需5分钟 · 5 分钟左右。复习 Day 211 用,看别人怎么配置和触发一个钩子,和默写二对照。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/CEODfvJLIGQ" title="Claude Code Hooks: MUST KNOW to Keep Claude Agent in Control!" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Mervin Praison · Claude Code Hooks: MUST KNOW to Keep Claude Agent in Control! · 英文。演示几种常见钩子的配置,看的时候留意它用的是哪个事件、用退出码还是 JSON 表达决定。</figcaption>
</figure>

### 书籍

- Jay Alammar、Maarten Grootendorst《Hands-On Large Language Models》(O'Reilly,2024),中文版《图解大模型:生成式AI原理与实践》(人民邮电出版社,2025)。第 2 章讲 token 和 embedding,图很多,适合在 Day 217 开始调真模型之前通读一遍,把这周的向量直觉和模型里的 embedding 连起来。
- 平冈和幸、堀玄《程序员的数学 3:线性代数》(卢晓南译,人民邮电出版社,2016)。复习点积和长度时翻讲内积的那几节。

### 开源项目与代码

- [github/spec-kit](https://github.com/github/spec-kit):Day 211 讲的规格驱动开发工具,README 里的命令列表可以快速回忆那一课的流程。
- [FlagOpen/FlagEmbedding](https://github.com/FlagOpen/FlagEmbedding):bge 系列 embedding 模型的官方仓库,明天用的 bge-m3 就出自这里,先认个门。

## 自测

**1. 下面的钩子想拒绝 `rm -rf`,为什么拦不住?怎么改?**

```python
if "rm -rf" in cmd:
    print("危险命令")
    sys.exit(1)
```

<details><summary>答案</summary>

Claude Code 只把退出码 2 当成阻断,退出码 1 被当成「钩子自己出错」,操作照常执行;而且 `print` 的那句普通文字也不是它认识的决定格式。改法二选一:`sys.exit(2)` 并把理由写到 stderr;或者像默写二那样打印 `permissionDecision: "deny"` 的 JSON 再 `sys.exit(0)`。

</details>

**2. 客户问「买错了能把钱要回来吗」,关键词搜索为什么返回空?换成向量搜索为什么能找到?**

<details><summary>答案</summary>

关键词搜索要求问题里的词原样出现在正文里,中文句子没空格,`split()` 后整句是一个词,《退款政策》里没有这个片段。向量搜索比的是方向:问题和《退款政策》在「钱」那一维都很高,余弦 0.9346,所以排第一。前提是向量本身能表达意思,今天是手工编的,明天换成模型给的。

</details>

**3. 小项目里为什么要在建索引时就把零向量拦下,而不是等检索时再处理?**

<details><summary>答案</summary>

零向量没有方向,和任何问题的余弦都是 0/0 = `nan`。如果它进了索引,每次检索都要算出一个 `nan`,再靠排序逻辑祈祷它不被选中,而 `argmax` 恰好会选中它。入库时拦下,问题在源头只出现一次,还能打日志告诉你哪篇文章是空的。检索时对问题向量再做一次检查,是第二层保险。

</details>

**4. `m` 是一个 `(2, 2)` 的矩阵,`m / np.linalg.norm(m, axis=1)` 不报错,结果对吗?**

<details><summary>答案</summary>

不对。`np.linalg.norm(m, axis=1)` 的形状是 `(2,)`,numpy 会把它当成一行,去除每一**列**,而不是每一行。只有形状恰好匹配才不报错,所以方阵最危险。要按行除,写 `np.linalg.norm(m, axis=1, keepdims=True)`,形状变成 `(2, 1)`。

</details>

**5. 面试题:「你们团队用 Claude Code 写代码,怎么保证它不会读到生产密钥、不会强推 main?」**

<details><summary>答案</summary>

分两层说。第一层是指令文件:在 AGENTS.md 或 CLAUDE.md 里写明「不要读 .env、不要强推」,让模型知道规矩,多数情况下它会照做,但这只是上下文里的建议。第二层是强制:配一个 PreToolUse 钩子,对读写密钥文件、`rm -rf`、`git push --force` 返回 deny,对普通 `git push` 返回 ask 让人确认;钩子是普通程序,先用假 JSON 测通每条规则再挂上去,并且注意退出码 1 拦不住。最后再加一层不依赖 Agent 的兜底:密钥不放在开发机的仓库里、CI 里跑密钥扫描、主分支开保护规则禁止强推。能讲出「建议和强制是两回事」并举出退出码这种细节,比只说「我们会让它小心点」有说服力得多。

</details>

## 明天预告

明天是 [Day 217 · 选 embedding 服务,写 embed 函数](/blog/agent-zero/day-217-embed-service/)。这一周的向量全是手工编的四个数,明天要换成模型算出来的 1024 个数。你会先撞上一个意外:默认用的 DeepSeek 没有 embedding 接口,得另配一家;然后用 bge-m3 跑出第一个真向量,学会一次请求发一批文本,最后把这些写成以后每天都要用的 `common/embed.py`。今天小项目里的 `normalize` 和「零向量入库前拦住」两条规矩,会原样写进那个函数里。
