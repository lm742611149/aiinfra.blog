---
title: 'Day 96 · 装饰器:@ 到底干了什么'
description: '你已经照着用过六个 @ 了。今天打开它:@ 只是「把下面的函数交给上面的函数,用返回值换掉原函数」的缩写,背后是函数可以当值传来传去。亲手写一个计时装饰器,看到忘了 functools.wraps 会让函数名变成 wrapper、签名变成 (*args, **kwargs);写一个带参数的 @retry;再写一个像 MCP 和 LangChain 那样「登记工具、顺手生成 JSON Schema」的 @tool,把昨天的 schema 和今天的装饰器接在一起。'
pubDate: 2026-10-23
regime: none
tags: ['python', 'decorator', 'functools', 'closure', 'agent-zero']
series: 'agent-zero'
day: 96
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 95](/blog/agent-zero/day-095-json-schema/) 学了 JSON Schema:用 `type`、`properties`、`required`、`enum`、`pattern`、`additionalProperties` 把「数据应该长什么样」写成一份 JSON,用 `jsonschema` 库的 `iter_errors` 一次拿到全部错误;看到 pydantic 的 `model_json_schema()` 导出的就是同一种东西,只是 pydantic 会转换、jsonschema 只判断;最后把 schema 塞进了一份工具定义的 `parameters` 里,那是模型以后读的东西。

那份工具定义是手写的。真实框架里没人手写:MCP SDK 是 `@mcp.tool()`,LangChain 是 `@tool`,FastAPI 是 `@app.get("/")`,写在函数上面一行,函数就被登记好了,schema 也自动生成了。这门课前面已经出现过六次 `@`,每次都说「先照着用,Day 96 讲原理」。今天就是 Day 96。

## 今天要解决的问题

学完今天,你应该能做到:

1. 说出 `@deco` 写在 `def f` 上面等价于 `f = deco(f)`,并用一个会打印的装饰器证明它在**定义时**执行、不是调用时;说清这件事能成立的前提:函数是一个值,能当参数传、能被返回。
2. 写一个能用在任何函数上的计时装饰器 `timed`:用 `*args, **kwargs` 透传参数,把返回值原样交回,函数抛异常也要打印耗时。
3. 说出不加 `functools.wraps` 会丢什么(`__name__`、`__doc__`、签名),并演示两个最常见的 bug 各自报什么错(忘了 `return func(...)`、忘了 `return wrapper`)。
4. 写一个带参数的装饰器 `@retry(times=3, on=(ConnectionError,))`,数清它有三层;再写一个登记型的 `@tool`,从类型标注生成 Day 95 那样的 JSON Schema。

今天两个新概念:**函数是值**(高阶函数和闭包)和**装饰器语法**(`@`、`functools.wraps`)。带参数的装饰器是前两个的组合,不算新东西,但第一次见会绕。预计用时:3 小时。花费 ¥0,不调 API。

前置:[Day 28](/blog/agent-zero/day-028-functions-1/) 的 `def` 和返回值;[Day 30](/blog/agent-zero/day-030-functions-3/) 的 `*args`、`**kwargs` 和作用域;[Day 36](/blog/agent-zero/day-036-exceptions-2/) 的 `finally` 和 `raise`;[Day 43](/blog/agent-zero/day-043-classes-3/) 的 `@property`(今天会拆开它);[Day 93](/blog/agent-zero/day-093-python-sqlite-2/) 的 `@contextmanager` 和 `commit_cost.py`(今天拿它当计时的例子);[Day 95](/blog/agent-zero/day-095-json-schema/) 的 schema 关键字。

学法:先对照文章逐行敲一遍(不复制粘贴)并跑通;第二天合上文章,默写「带 `functools.wraps` 的 `timed`」和「`@f` 等价于 `f = deco(f)`」;做练习,做不出再展开参考答案,看完关掉自己重写一遍。

## 从前端看:高阶组件就是装饰器

JS 里函数本来就是值,这一点你比大多数 Python 初学者有优势。React 的高阶组件 `withRouter(Component)` 收一个组件、吐一个加了功能的新组件;Express 的中间件 `app.use(fn)` 把处理函数登记进一张表;`const withLog = fn => (...args) => { console.log(args); return fn(...args); }` 更是和今天第 2 步一模一样。JS 也有 `@decorator` 语法(TC39 已进入 stage 3,TS 里早就能开 `experimentalDecorators` 用),只是前端日常用得少。

Python 这边不同的只有三点:`@` 是语言内置、天天用;参数透传写成 `*args, **kwargs` 而不是 `...args`;包装之后要用 `functools.wraps` 把原函数的名字和签名抄过来,JS 里通常没人管这个。

| JS / 前端 | Python 今天的对应 | 说明 |
| --- | --- | --- |
| `const g = f;` `arr.map(f)` | `g = f`、`apply_twice(f, x)` | 函数当值 |
| `const make = p => s => p + s` | `def make_prefixer(prefix): def add_prefix(text): ...` | 返回函数,内层记住外层变量(闭包) |
| `const withLog = fn => (...args) => fn(...args)` | `def log_calls(func): def wrapper(*args, **kwargs): ...` | 包一层 |
| `f = withLog(f)` | `@log_calls` 写在 `def f` 上面 | 同一件事,`@` 是缩写 |
| `withRouter(Component)`、`memo(Component)` | `@timed`、`@functools.cache` | 高阶组件 ≈ 装饰器 |
| `app.get("/x", handler)` | `@app.get("/x")` 写在 `def handler` 上面 | 带参数的装饰器 |
| `fn.name` 变成 `"anonymous"` | `f.__name__` 变成 `"wrapper"` | 都会丢名字,Python 用 `wraps` 补回来 |

## 第 1 步:函数是一个值

装饰器能成立,全靠一件事:**函数在 Python 里是普通的值**,和数字、字符串、列表一样,能赋给变量、能当参数传、能被别的函数造出来再返回。新建 `part01/func_values.py`:

```python
# agent-zero-lab/part01/func_values.py
from collections.abc import Callable


def shout(text: str) -> str:
    return text.upper() + "!"


def whisper(text: str) -> str:
    return text.lower() + "..."


print("1. 函数是一个值:", type(shout).__name__, shout.__name__)
say = shout
print("2. 赋给别的名字还是它:", say("hello"), say is shout)


def apply_twice(func: Callable[[str], str], text: str) -> str:
    return func(func(text))


print("3. 当参数传:", apply_twice(shout, "hi"), "|", apply_twice(whisper, "HI"))


def make_prefixer(prefix: str) -> Callable[[str], str]:
    def add_prefix(text: str) -> str:
        return prefix + text

    return add_prefix


ticket = make_prefixer("[工单] ")
alert = make_prefixer("[告警] ")
print("4. 函数造函数:", ticket("发票抬头开错了"), "|", alert("磁盘快满了"))
cells = ticket.__closure__ or ()
print("   add_prefix 记住了自己的 prefix:", [c.cell_contents for c in cells], "| alert 记住的:", [c.cell_contents for c in alert.__closure__ or ()])
print("5. 放进字典按名字找:", {"shout": shout, "whisper": whisper}["whisper"]("SURE"))
```

<div class="line-notes">

- `from collections.abc import Callable` `Callable` 是「可以调用的东西」的类型。`Callable[[str], str]` 读作「收一个 `str`、返回 `str` 的函数」:方括号里第一项是参数类型列表,第二项是返回类型。Day 93 的 `run(label, pay)` 用过一次。
- `def shout(text: str) -> str:` 两个普通函数,一个变大写一个变小写,下面当「值」来摆弄。
- `print("1. 函数是一个值:", type(shout).__name__, shout.__name__)` `type(shout)` 是 `function`,说明它和 `int`、`str` 一样是某种类型的对象;`shout.__name__` 是它的名字 `'shout'`。**注意没有括号**:`shout` 是函数本身,`shout("hi")` 才是调用它得到的字符串。
- `say = shout` 赋给另一个变量,没有复制,两个名字指着同一个函数。
- `print("2. 赋给别的名字还是它:", say("hello"), say is shout)` `say("hello")` 照常能调,`say is shout` 实测 `True`。
- `def apply_twice(func: Callable[[str], str], text: str) -> str:` 收一个函数当参数。
- `return func(func(text))` 调两次。代入 `apply_twice(shout, "hi")`:先 `shout("hi")` 得 `"HI!"`,再 `shout("HI!")` 得 `"HI!!"`。
- `def make_prefixer(prefix: str) -> Callable[[str], str]:` **函数造函数**:返回类型是一个函数。
- `def add_prefix(text: str) -> str:` 在函数里面定义函数。`add_prefix` 用到了外层的 `prefix`,但自己没有这个参数。
- `return add_prefix` 把内层函数当值返回出去。**没有括号**,返回的是函数本身,不是调用结果。
- `ticket = make_prefixer("[工单] ")` 造一个前缀是「[工单] 」的函数。`make_prefixer` 已经执行完返回了,按理说它的局部变量 `prefix` 该消失了。
- `print("4. 函数造函数:", ticket("发票抬头开错了"), "|", alert("磁盘快满了"))` 可 `ticket("...")` 实测还是加上了「[工单] 」。内层函数**记住了**外层的变量,这种「带着出生环境的函数」叫**闭包**(closure)。两个闭包各记各的:`ticket` 记的是「[工单] 」,`alert` 记的是「[告警] 」。
- `cells = ticket.__closure__ or ()` 闭包记住的变量真的存在函数对象上,`__closure__` 能看到。普通函数(没记住任何外层变量)的 `__closure__` 是 `None`,所以 `or ()` 兜底成空元组,类型检查器才不报红线。
- `print("   add_prefix 记住了自己的 prefix:",` 实测 `['[工单] ']` 和 `['[告警] ']`,每个闭包带着自己的那份。
- `print("5. 放进字典按名字找:", {"shout": shout, "whisper": whisper}["whisper"]("SURE"))` 函数能当字典的值。按名字取出来再调用,Day 94 的 `__main__.py` 如果用字典分发命令就是这个写法;第三部分「模型说调 `get_weather`,你按名字找到函数调用」也是这个写法。

</div>

```bash
cd /Users/你/agent-zero-lab
uv run python -m part01.func_values
```

```text
1. 函数是一个值: function shout
2. 赋给别的名字还是它: HELLO! True
3. 当参数传: HI!! | hi......
4. 函数造函数: [工单] 发票抬头开错了 | [告警] 磁盘快满了
   add_prefix 记住了自己的 prefix: ['[工单] '] | alert 记住的: ['[告警] ']
5. 放进字典按名字找: sure...
```

五件事里第 3 和第 4 最重要:**收函数当参数**和**造函数返回出去**。把这两件事合在一起,就是「收一个函数,返回一个新函数」,这就是装饰器的全部。接受或返回函数的函数有个名字叫**高阶函数**(higher-order function),`map`、`sorted(key=...)`、`apply_twice` 都是。

## 第 2 步:手工包一层,再换成 `@`

先不用 `@`,用第 1 步的办法手工做一次「给函数加一层打印」。新建 `part01/deco_by_hand.py`:

```python
# agent-zero-lab/part01/deco_by_hand.py
from collections.abc import Callable


def log_calls(func: Callable) -> Callable:
    print(f"   (log_calls 正在包装 {func.__name__})")

    def wrapper(*args, **kwargs):
        print(f"-> 调用 {func.__name__},参数 {args} {kwargs}")
        result = func(*args, **kwargs)
        print(f"<- {func.__name__} 返回 {result!r}")
        return result

    return wrapper


print("== 第一种:手工包 ==")


def add(a: int, b: int) -> int:
    return a + b


add = log_calls(add)
print("add 现在是:", add.__name__)
print("结果:", add(2, 3))

print("== 第二种:@ 语法,做的是同一件事 ==")


@log_calls
def seats_total(plan: str, *, seats: int) -> int:
    return seats * {"基础版": 39, "专业版": 99, "企业版": 199}[plan]


print("(定义完了,还没调用)")
print("结果:", seats_total("专业版", seats=12))
print("seats_total 现在是:", seats_total.__name__)
```

<div class="line-notes">

- `def log_calls(func: Callable) -> Callable:` 装饰器本身:收一个函数,返回一个函数。只写 `Callable` 不带方括号表示「随便什么可调用的东西」,因为它要能包任何函数。
- `print(f"   (log_calls 正在包装 {func.__name__})")` 故意加一行打印,下面用它证明装饰器**什么时候执行**。
- `def wrapper(*args, **kwargs):` 新函数。`*args` 收所有位置参数成元组,`**kwargs` 收所有关键字参数成字典(Day 30),所以不管原函数要几个参数,`wrapper` 都接得住。
- `print(f"-> 调用 {func.__name__},参数 {args} {kwargs}")` 加的功能:调用前打印。`func` 是外层的参数,`wrapper` 能用它,这就是第 1 步的闭包。
- `result = func(*args, **kwargs)` 把收到的参数**原样拆开**传给原函数:`*args` 把元组拆回位置参数,`**kwargs` 把字典拆回关键字参数。
- `return result` 原函数的返回值要交回去,不然调用方拿到的是 `None`(第 4 步演示忘了会怎样)。
- `return wrapper` 把新函数返回出去,替换原来的。
- `add = log_calls(add)` **手工装饰**:把 `add` 传进去,返回的 `wrapper` 赋回 `add` 这个名字。从此 `add` 指的是 `wrapper`,原来那个函数只有 `wrapper` 闭包里的 `func` 还指着它。
- `print("add 现在是:", add.__name__)` 实测 `wrapper`:名字变了。先记住这个现象,第 3 步修。
- `print("结果:", add(2, 3))` 调用 `add(2, 3)` 其实是调用 `wrapper(2, 3)`:`args` 是 `(2, 3)`,`kwargs` 是 `{}`,打印一行,调原函数得 5,打印一行,返回 5。
- `@log_calls` **`@` 语法**:写在 `def` 上面一行,意思就是「这个 `def` 执行完之后,立刻做 `seats_total = log_calls(seats_total)`」。和上面手工那一行完全等价,只是省得把名字写三遍。
- `def seats_total(plan: str, *, seats: int) -> int:` 一个带关键字参数的函数,用来验证 `**kwargs` 透传得对。`*` 后面的 `seats` 只能用关键字传。
- `print("(定义完了,还没调用)")` 看输出顺序:这一行**之前**已经打印了「正在包装 seats_total」。说明 `@` 在定义时就执行了,不等你调用。这也是为什么 `import` 一个模块,里面所有 `@app.get` 的路由就已经登记好了。
- `print("结果:", seats_total("专业版", seats=12))` 调用时 `args` 是 `('专业版',)`,`kwargs` 是 `{'seats': 12}`,透传给原函数算出 12 × 99 = 1188。
- `print("seats_total 现在是:", seats_total.__name__)` 还是 `wrapper`。

</div>

```bash
uv run python -m part01.deco_by_hand
```

```text
== 第一种:手工包 ==
   (log_calls 正在包装 add)
add 现在是: wrapper
-> 调用 add,参数 (2, 3) {}
<- add 返回 5
结果: 5
== 第二种:@ 语法,做的是同一件事 ==
   (log_calls 正在包装 seats_total)
(定义完了,还没调用)
-> 调用 seats_total,参数 ('专业版',) {'seats': 12}
<- seats_total 返回 1188
结果: 1188
seats_total 现在是: wrapper
```

两段输出一模一样的结构,证明 `@log_calls` 和 `seats_total = log_calls(seats_total)` 是同一件事。「正在包装」那行出现在「定义完了,还没调用」之前,证明装饰发生在定义时。

<figure>
<svg viewBox="0 0 640 300" role="img" aria-label="装饰器的两个时刻:定义时,@log_calls 把 seats_total 传给 log_calls,返回 wrapper,名字 seats_total 从此指向 wrapper,原函数只被 wrapper 闭包里的 func 引用;调用时,seats_total 的参数进入 wrapper,wrapper 打印后调用 func,拿到返回值再交回调用方">
<rect x="0" y="0" width="640" height="300" fill="var(--paper-raised)" rx="6"/>
<g font-family="var(--font-mono)" font-size="12">
<text x="20" y="26" fill="var(--ink)">① 定义时(def 执行完立刻发生)</text>
<rect x="20" y="40" width="170" height="40" rx="4" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="105" y="64" fill="var(--ink)" text-anchor="middle">def seats_total</text>
<line x1="190" y1="60" x2="240" y2="60" stroke="var(--rule)"/>
<text x="215" y="52" fill="var(--ink-faint)" text-anchor="middle" font-size="11">传入</text>
<rect x="240" y="40" width="150" height="40" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="315" y="64" fill="var(--ink)" text-anchor="middle">log_calls(func)</text>
<line x1="390" y1="60" x2="440" y2="60" stroke="var(--rule)"/>
<text x="415" y="52" fill="var(--ink-faint)" text-anchor="middle" font-size="11">返回</text>
<rect x="440" y="40" width="180" height="40" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="530" y="64" fill="var(--ink)" text-anchor="middle">wrapper(闭包里有 func)</text>
<text x="20" y="108" fill="var(--ink-soft)" font-size="11">名字 seats_total 从此指向 wrapper;原函数只剩 wrapper 的 func 还指着它</text>
<text x="20" y="150" fill="var(--ink)">② 调用时(seats_total("专业版", seats=12))</text>
<rect x="20" y="166" width="120" height="40" rx="4" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="80" y="190" fill="var(--ink)" text-anchor="middle">调用方</text>
<line x1="140" y1="186" x2="190" y2="186" stroke="var(--rule)"/>
<rect x="190" y="166" width="260" height="110" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="320" y="186" fill="var(--ink)" text-anchor="middle">wrapper(*args, **kwargs)</text>
<text x="320" y="206" fill="var(--ink-soft)" text-anchor="middle" font-size="11">打印「-> 调用」</text>
<rect x="230" y="216" width="180" height="30" rx="4" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="320" y="236" fill="var(--ink)" text-anchor="middle" font-size="11">func(*args, **kwargs) → 1188</text>
<text x="320" y="266" fill="var(--ink-soft)" text-anchor="middle" font-size="11">打印「<- 返回」,return 1188</text>
<line x1="450" y1="186" x2="500" y2="186" stroke="var(--rule)"/>
<text x="560" y="190" fill="var(--ink)" text-anchor="middle">拿到 1188</text>
<text x="20" y="292" fill="var(--ink-faint)" font-size="11">装饰器只在①跑一次;②每次调用都经过 wrapper。</text>
</g>
</svg>
<figcaption>装饰器的两个时刻。琥珀色的 log_calls 只在定义时执行一次,蓝色的 wrapper 是每次调用都走的那层壳,原函数藏在壳里的 func 变量上。</figcaption>
</figure>

## 第 3 步:计时装饰器,以及 `functools.wraps`

写一个真正会反复用的装饰器:给任何函数计时。它要满足三条:参数原样透传;返回值原样交回;函数抛异常也要打印耗时(不然你永远不知道失败的调用花了多久)。新建 `part01/timing.py`,这个文件以后会被 import:

```python
# agent-zero-lab/part01/timing.py
import functools
import time
from collections.abc import Callable


def timed(func: Callable) -> Callable:
    """装饰器:打印被装饰函数每次调用的耗时(毫秒),返回值原样交回。"""

    @functools.wraps(func)
    def wrapper(*args, **kwargs):
        t0 = time.perf_counter()
        try:
            return func(*args, **kwargs)
        finally:
            ms = (time.perf_counter() - t0) * 1000
            print(f"[timed] {func.__name__} 用了 {ms:.1f} 毫秒")

    return wrapper
```

<div class="line-notes">

- `import functools` 标准库里「操作函数的函数」工具箱,今天要用它的 `wraps`,练习 4 用它的 `cache`。
- `def timed(func: Callable) -> Callable:` 和 `log_calls` 一样的外形。
- `"""装饰器:打印被装饰函数每次调用的耗时(毫秒),返回值原样交回。"""` 装饰器也值得写 docstring,别人悬停就知道它干什么。
- `@functools.wraps(func)` **新东西**:这是一个装饰器,装饰的是 `wrapper`。它做的事是把 `func` 的 `__name__`、`__doc__`、`__module__`、类型标注等「名牌」复制到 `wrapper` 上,并在 `wrapper` 上挂一个 `__wrapped__` 指回原函数。第 2 步里名字变成 `wrapper` 的问题,就靠它修。注意它带括号、带参数,下一节讲为什么。
- `t0 = time.perf_counter()` 开始计时(Day 93 用过)。
- `try:` 原函数可能抛异常,所以放进 `try`。
- `return func(*args, **kwargs)` 调原函数并**直接返回**。`return` 写在 `try` 里是允许的,Python 会先执行 `finally` 再真正返回。
- `finally:` 不管成功还是抛异常都执行(Day 36)。
- `ms = (time.perf_counter() - t0) * 1000` 秒换成毫秒。
- `print(f"[timed] {func.__name__} 用了 {ms:.1f} 毫秒")` 打印。用 `func.__name__` 而不是 `wrapper.__name__`,前者永远是原函数的名字。
- `return wrapper` 别忘了。

</div>

拿 Day 93 第 4 步那个实验来用它:500 条插入,「每条都 commit」和「最后 commit 一次」各计一次时;再给 Day 94 的 `build` 计个时。新建 `part01/timing_demo.py`:

```python
# agent-zero-lab/part01/timing_demo.py
import sqlite3
from pathlib import Path

from part01.ledger.seed import build
from part01.timing import timed

TMP_DB = Path(__file__).parent / "sql" / "timing_demo.db"
N = 500


def fresh() -> sqlite3.Connection:
    TMP_DB.unlink(missing_ok=True)
    conn = sqlite3.connect(TMP_DB)
    conn.execute("CREATE TABLE logs (id INTEGER PRIMARY KEY, msg TEXT NOT NULL)")
    conn.commit()
    return conn


@timed
def insert_each_commit(conn: sqlite3.Connection) -> int:
    for i in range(N):
        conn.execute("INSERT INTO logs (msg) VALUES (?)", (f"第 {i} 条",))
        conn.commit()
    return conn.execute("SELECT count(*) FROM logs").fetchone()[0]


@timed
def insert_one_commit(conn: sqlite3.Connection) -> int:
    for i in range(N):
        conn.execute("INSERT INTO logs (msg) VALUES (?)", (f"第 {i} 条",))
    conn.commit()
    return conn.execute("SELECT count(*) FROM logs").fetchone()[0]


timed_build = timed(build)

print("插入了", insert_each_commit(fresh()), "条")
print("插入了", insert_one_commit(fresh()), "条")
print("建库结果", timed_build())
TMP_DB.unlink()
```

<div class="line-notes">

- `from part01.ledger.seed import build` Day 94 的建库函数,拿来当「别人写的、我不想改源码」的例子。
- `from part01.timing import timed` 刚写的装饰器。
- `def fresh() -> sqlite3.Connection:` 每次实验前重建一张空表,返回连接。
- `@timed` 两个被测函数的上面各加一行,函数体和 Day 93 的 `each_commit`、`one_commit` 几乎一样,只是把计时的那几行拿掉了,因为装饰器替它们做了。
- `def insert_each_commit(conn: sqlite3.Connection) -> int:` 每插一条就 `commit` 一次。
- `return conn.execute("SELECT count(*) FROM logs").fetchone()[0]` 返回插入的条数,用来验证返回值真的透传回来了。
- `def insert_one_commit(conn: sqlite3.Connection) -> int:` 插完再 `commit` 一次。
- `timed_build = timed(build)` **不想改 `seed.py`**,就用第 2 步的手工写法:`timed(build)` 得到一个带计时的新函数,起个新名字。装饰器对「别人的函数」也能用,这是 `@` 做不到的(`@` 只能写在 `def` 上面)。
- `print("插入了", insert_each_commit(fresh()), "条")` 调用时先打印 `[timed]` 那行(在函数返回前),再打印这一行。

</div>

```bash
uv run python -m part01.timing_demo
```

```text
[timed] insert_each_commit 用了 366.8 毫秒
插入了 500 条
[timed] insert_one_commit 用了 1.8 毫秒
插入了 500 条
[timed] build 用了 6.0 毫秒
建库结果 {'customers': 10, 'invoices': 14, 'orphans': 1}
```

数字和 Day 93 同一个量级(每条提交比一次提交慢两百倍左右,具体数字每次不同),返回值 500 和建库统计都原样回来了,而且 `[timed]` 行里的名字是 `insert_each_commit`、`build`,不是 `wrapper`。

### 不加 `wraps` 会丢什么

把 `wraps` 去掉对比一下,不只是名字的事。新建 `part01/wraps_demo.py`:

```python
# agent-zero-lab/part01/wraps_demo.py
import functools
import inspect
from collections.abc import Callable


def plain(func: Callable) -> Callable:
    def wrapper(*args, **kwargs):
        return func(*args, **kwargs)

    return wrapper


def with_wraps(func: Callable) -> Callable:
    @functools.wraps(func)
    def wrapper(*args, **kwargs):
        return func(*args, **kwargs)

    return wrapper


@plain
def area_a(width: float, height: float = 1.0) -> float:
    """长方形面积。"""
    return width * height


@with_wraps
def area_b(width: float, height: float = 1.0) -> float:
    """长方形面积。"""
    return width * height


for f in (area_a, area_b):
    print(f"__name__={f.__name__!r:10} __doc__={f.__doc__!r:12} signature={inspect.signature(f)}")
print("有 __wrapped__ 吗:", hasattr(area_a, "__wrapped__"), hasattr(area_b, "__wrapped__"))
original = getattr(area_b, "__wrapped__")
print("顺着 __wrapped__ 拿回原函数:", original(3, 4), original is not area_b, original.__name__)
print("两个都能正常算:", area_a(3, 4), area_b(3, height=4))
```

<div class="line-notes">

- `import inspect` 标准库里「看一个函数长什么样」的模块,`inspect.signature` 能取出参数列表和默认值。第 6 步生成 schema 也靠它。
- `def plain(func: Callable) -> Callable:` 没有 `wraps` 的装饰器。
- `def with_wraps(func: Callable) -> Callable:` 有 `wraps` 的,其他一样。
- `@plain` / `@with_wraps` 两个一模一样的函数,各被一种装饰。
- `print(f"__name__={f.__name__!r:10} __doc__={f.__doc__!r:12} signature={inspect.signature(f)}")` 三样东西对比:名字、docstring、签名。
- `print("有 __wrapped__ 吗:", hasattr(area_a, "__wrapped__"), hasattr(area_b, "__wrapped__"))` `wraps` 还会在 `wrapper` 上挂 `__wrapped__`,指回原函数。
- `original = getattr(area_b, "__wrapped__")` 用 `getattr` 而不是 `area_b.__wrapped__`,因为类型检查器从函数类型上看不出这个属性,直接写会有红线;`getattr(对象, "属性名")` 是按字符串取属性,检查器就不管了。
- `print("顺着 __wrapped__ 拿回原函数:", original(3, 4), original is not area_b, original.__name__)` 原函数还能直接调,它不是 `area_b`(`area_b` 是壳),名字也是 `area_b`。测试时想绕过装饰器直接测原函数,就走这条路。
- `print("两个都能正常算:", area_a(3, 4), area_b(3, height=4))` 两个都能算,功能上没差别。差别全在「名牌」上。

</div>

```bash
uv run python -m part01.wraps_demo
```

```text
__name__='wrapper'  __doc__=None         signature=(*args, **kwargs)
__name__='area_b'   __doc__='长方形面积。'     signature=(width: float, height: float = 1.0) -> float
有 __wrapped__ 吗: False True
顺着 __wrapped__ 拿回原函数: 12 True area_b
两个都能正常算: 12 12
```

不加 `wraps`,函数对外变成了一个叫 `wrapper`、没有文档、参数是 `(*args, **kwargs)` 的东西。这三样丢了会在哪里疼:日志和报错里全是 `wrapper`,分不清是哪个函数;编辑器悬停没有提示;pytest 的参数化 id、FastAPI 的自动文档、以及第 6 步「从签名生成 schema」全部拿不到参数名。所以规矩只有一条:**写装饰器,`wrapper` 上面永远加 `@functools.wraps(func)`**,别去想「这次要不要」。

## 第 4 步:两个最常见的 bug,各报什么错

装饰器一共两个 `return`,漏掉任何一个都不会在定义时报错,要到用的时候才炸,而且报的错看起来和装饰器无关。故意各漏一次,新建 `part01/deco_bugs.py`:

```python
# agent-zero-lab/part01/deco_bugs.py
import functools
from collections.abc import Callable


def forgot_return_value(func: Callable) -> Callable:
    @functools.wraps(func)
    def wrapper(*args, **kwargs):
        func(*args, **kwargs)  # 忘了 return

    return wrapper


def forgot_return_wrapper(func: Callable) -> Callable:
    @functools.wraps(func)
    def wrapper(*args, **kwargs):
        return func(*args, **kwargs)
    # 忘了 return wrapper


@forgot_return_value
def total(prices: list[int]) -> int:
    return sum(prices)


print("1. wrapper 忘了 return:", total([1188, 117]))
try:
    print(total([1188, 117]) + 1)
except TypeError as e:
    print("   下游报:", type(e).__name__ + ":", e)


@forgot_return_wrapper
def double(n: int) -> int:
    return n * 2


print("2. 装饰器忘了 return wrapper,double 变成了:", double)
try:
    double(3)
except TypeError as e:
    print("   调用时报:", type(e).__name__ + ":", e)
```

<div class="line-notes">

- `func(*args, **kwargs)  # 忘了 return` 第一种:`wrapper` 调了原函数,但没把结果 `return` 出去。Python 里函数没写 `return` 就返回 `None`。
- `return func(*args, **kwargs)` 第二种的 `wrapper` 是对的……
- `# 忘了 return wrapper` 但装饰器本身没有 `return wrapper`,于是装饰器返回 `None`。
- `print("1. wrapper 忘了 return:", total([1188, 117]))` 实测打印 `None`,而不是 1305。**没有任何报错**,只是结果悄悄变成了 `None`。
- `except TypeError as e:` 要到有人拿这个 `None` 去做加法,才报 `unsupported operand type(s) for +: 'NoneType' and 'int'`。报错的位置离装饰器很远。
- `print("2. 装饰器忘了 return wrapper,double 变成了:", double)` `@forgot_return_wrapper` 等于 `double = forgot_return_wrapper(double)`,右边返回 `None`,所以 `double` 这个名字现在指着 `None`。
- `double(3)` 调一个 `None`,报 `'NoneType' object is not callable`。看到这句报错,先去查函数上面的装饰器有没有 `return wrapper`。

</div>

```bash
uv run python -m part01.deco_bugs
```

```text
1. wrapper 忘了 return: None
   下游报: TypeError: unsupported operand type(s) for +: 'NoneType' and 'int'
2. 装饰器忘了 return wrapper,double 变成了: None
   调用时报: TypeError: 'NoneType' object is not callable
```

这个文件是故意写错的,Zed 里会有红线:`forgot_return_wrapper` 那行报 `Function with declared return type "(...) -> Unknown" must return value on all code paths`。这正是 Day 45 装类型检查的回报:第二种 bug 根本不用跑就能发现。第一种它抓不到,因为 `wrapper` 没写返回类型;养成习惯之后这两种都不会再犯。

## 第 5 步:带参数的装饰器,三层

`@timed` 不带参数。可 Day 79 的 `@app.get("/")`、Day 50 的 `@dataclass(frozen=True)` 都带括号和参数。参数从哪进去?`@` 后面跟的必须是「收函数返回函数」的东西,`retry(times=3)` 是一次**调用**,它的返回值才是装饰器。所以带参数的装饰器是「造装饰器的函数」,一共三层。写一个重试装饰器,新建 `part01/retry_deco.py`:

```python
# agent-zero-lab/part01/retry_deco.py
import functools
from collections.abc import Callable


def retry(times: int = 3, on: tuple[type[BaseException], ...] = (Exception,)) -> Callable[[Callable], Callable]:
    """带参数的装饰器:失败了最多再试 times - 1 次,只重试 on 里列出的异常。"""

    def decorator(func: Callable) -> Callable:
        @functools.wraps(func)
        def wrapper(*args, **kwargs):
            for attempt in range(1, times + 1):
                try:
                    return func(*args, **kwargs)
                except on as e:
                    print(f"   第 {attempt} 次失败:{type(e).__name__}: {e}")
                    if attempt == times:
                        raise
            return None  # 走不到这里,让类型检查器安心

        return wrapper

    return decorator


calls = {"n": 0}


@retry(times=3, on=(ConnectionError,))
def fetch_rate() -> float:
    calls["n"] += 1
    if calls["n"] < 3:
        raise ConnectionError(f"第 {calls['n']} 次连接被拒")
    return 7.12


print("== 前两次失败,第三次成功 ==")
print("结果:", fetch_rate(), "| 一共调了", calls["n"], "次")

print("== 不在 on 列表里的异常,不重试 ==")


@retry(times=3, on=(ConnectionError,))
def bad_json() -> dict:
    raise ValueError("不是合法的 JSON")


try:
    bad_json()
except ValueError as e:
    print("直接抛出:", e)

print("== 三次都失败 ==")


@retry(times=3, on=(ConnectionError,))
def always_down() -> None:
    raise ConnectionError("服务没起来")


try:
    always_down()
except ConnectionError as e:
    print("最后抛出:", e)
print("retry(times=3) 本身返回的是:", retry(times=3).__name__)
```

<div class="line-notes">

- `def retry(times: int = 3, on: tuple[type[BaseException], ...] = (Exception,)) -> Callable[[Callable], Callable]:` **第一层**:收装饰器的参数(最多试几次、哪些异常才重试),返回一个装饰器。返回类型 `Callable[[Callable], Callable]` 读作「收一个函数、返回一个函数的函数」,就是装饰器的类型。`on` 的类型 `tuple[type[BaseException], ...]` 是「异常类组成的元组」,`except` 后面正好能接这种元组(Day 93 练习 2 用过 `except (LookupError, ValueError)`)。
- `def decorator(func: Callable) -> Callable:` **第二层**:真正的装饰器,长得和 `timed` 一样。它能用到第一层的 `times` 和 `on`,靠的还是闭包。
- `@functools.wraps(func)` 规矩不变。
- `def wrapper(*args, **kwargs):` **第三层**:每次调用都走的壳。
- `for attempt in range(1, times + 1):` 最多试 `times` 次。Day 19 用 `while` 写过「重试三次」,这里换成 `for`。
- `return func(*args, **kwargs)` 成功就直接返回,循环自然结束。
- `except on as e:` 只接 `on` 里列出的异常类型。`on` 是元组,`except` 接受元组。
- `if attempt == times:` 最后一次也失败了就把异常原样抛出去(`raise` 不带参数,Day 36),不吞。
- `return None  # 走不到这里,让类型检查器安心` 循环里要么 `return` 要么 `raise`,这行永远执行不到;写上是因为类型检查器看不出这一点,会提示「不是所有路径都有返回值」。
- `return wrapper` 第二层的返回。
- `return decorator` 第一层的返回。三个 `return` 一个不能少。
- `calls = {"n": 0}` 用字典记调用次数(函数内部改外层变量,用可变对象最省事;练习 2 讲另一种写法 `nonlocal`)。
- `@retry(times=3, on=(ConnectionError,))` 读法:先执行 `retry(times=3, on=(ConnectionError,))`,得到 `decorator`;再 `fetch_rate = decorator(fetch_rate)`。`(ConnectionError,)` 的逗号别漏,单元素元组。
- `if calls["n"] < 3:` 前两次抛 `ConnectionError`,第三次返回 7.12。
- `def bad_json() -> dict:` 抛的是 `ValueError`,不在 `on` 里。
- `print("直接抛出:", e)` 实测没有「第 N 次失败」的打印,第一次就穿出来了:**不该重试的错误不重试**(JSON 解析失败重试一百次也一样失败)。
- `def always_down() -> None:` 永远失败,三次之后抛出。
- `print("retry(times=3) 本身返回的是:", retry(times=3).__name__)` 验证第一层返回的真是那个叫 `decorator` 的函数。

</div>

```bash
uv run python -m part01.retry_deco
```

```text
== 前两次失败,第三次成功 ==
   第 1 次失败:ConnectionError: 第 1 次连接被拒
   第 2 次失败:ConnectionError: 第 2 次连接被拒
结果: 7.12 | 一共调了 3 次
== 不在 on 列表里的异常,不重试 ==
直接抛出: 不是合法的 JSON
== 三次都失败 ==
   第 1 次失败:ConnectionError: 服务没起来
   第 2 次失败:ConnectionError: 服务没起来
   第 3 次失败:ConnectionError: 服务没起来
最后抛出: 服务没起来
retry(times=3) 本身返回的是: decorator
```

三层的名字我故意用了最直白的 `retry` → `decorator` → `wrapper`,读别人代码时常见的是 `outer`/`inner` 或者全叫 `_`。认结构不认名字:带括号的 `@xxx(...)` 一定是三层,不带括号的 `@xxx` 是两层。这个 `retry` 还很粗糙,没有等待、没有退避,真要用的版本在 [Day 127](/blog/agent-zero/day-127-retry-backoff/)。

## 第 6 步:登记型装饰器,把 Day 95 接上

前面的装饰器都是「包一层」。还有一类装饰器**不包**,只是趁 `def` 执行的那一刻把函数登记到某张表里,然后原样返回。`@pytest.fixture`、`@app.get`、MCP 的 `@mcp.tool()` 都是这一类。写一个最小的工具注册表,顺手用 `inspect` 从类型标注生成 Day 95 那样的 schema。新建 `part01/tool_registry_mini.py`:

```python
# agent-zero-lab/part01/tool_registry_mini.py
import inspect
import json
from collections.abc import Callable

TOOLS: dict[str, Callable] = {}
SCHEMAS: list[dict] = []
PY2JSON = {str: "string", int: "integer", float: "number", bool: "boolean"}


def tool(func: Callable) -> Callable:
    """注册型装饰器:登记函数,并从类型标注和 docstring 生成 JSON Schema。原函数原样返回。"""
    props, required = {}, []
    for name, p in inspect.signature(func).parameters.items():
        props[name] = {"type": PY2JSON.get(p.annotation, "string")}
        if p.default is inspect.Parameter.empty:
            required.append(name)
    TOOLS[func.__name__] = func
    SCHEMAS.append({
        "type": "function",
        "function": {
            "name": func.__name__,
            "description": inspect.getdoc(func) or "",
            "parameters": {"type": "object", "properties": props, "required": required, "additionalProperties": False},
        },
    })
    return func


def call(name: str, arguments: str) -> str:
    """按名字调用工具,参数是 JSON 字符串,返回也是 JSON 字符串(出错不抛,写进 error)。"""
    if name not in TOOLS:
        return json.dumps({"error": f"没有叫 {name} 的工具,可用的有 {list(TOOLS)}"}, ensure_ascii=False)
    try:
        result = TOOLS[name](**json.loads(arguments))
    except Exception as e:
        return json.dumps({"error": f"{type(e).__name__}: {e}"}, ensure_ascii=False)
    return json.dumps(result, ensure_ascii=False, default=str)


@tool
def seats_price(plan: str, seats: int) -> dict:
    """按套餐和席位数算每月应收金额(元)。"""
    return {"plan": plan, "seats": seats, "monthly": seats * {"基础版": 39, "专业版": 99, "企业版": 199}[plan]}


@tool
def is_vip(monthly: float, threshold: float = 10000) -> bool:
    """月费超过阈值就算 VIP 客户。"""
    return monthly >= threshold


if __name__ == "__main__":
    print(json.dumps(SCHEMAS, ensure_ascii=False, indent=2))
    print(call("seats_price", '{"plan": "专业版", "seats": 12}'))
    print(call("is_vip", '{"monthly": 16915}'))
    print(call("seats_price", '{"plan": "旗舰版", "seats": 1}'))
    print(call("nope", "{}"))
    print("seats_price 还是原来的函数吗:", seats_price("基础版", 3))
```

<div class="line-notes">

- `TOOLS: dict[str, Callable] = {}` 注册表:名字 → 函数。第 1 步第 5 件事「函数放进字典按名字找」的正式版。
- `SCHEMAS: list[dict] = []` 给模型看的工具定义列表,每个和 Day 95 第 6 步的 `CREATE_TICKET_TOOL` 一个形状。
- `PY2JSON = {str: "string", int: "integer", float: "number", bool: "boolean"}` Python 类型 → JSON Schema 类型名的对照表。键是类型本身(`str` 这个类,不是字符串 `"str"`),Day 95 说过 schema 用的是 JSON 的叫法。
- `def tool(func: Callable) -> Callable:` 装饰器。注意它**没有** `wrapper`。
- `props, required = {}, []` 一行初始化两个变量(Day 22 的解包)。
- `for name, p in inspect.signature(func).parameters.items():` `inspect.signature(func).parameters` 是参数名 → 参数对象的有序字典。代入 `seats_price`:两轮,`name` 依次是 `'plan'`、`'seats'`。
- `props[name] = {"type": PY2JSON.get(p.annotation, "string")}` `p.annotation` 是类型标注,`plan: str` 的就是 `str`,查表得 `"string"`;表里没有的类型一律当字符串(`dict.get` 的默认值)。
- `if p.default is inspect.Parameter.empty:` 没有默认值的参数才必填。`inspect.Parameter.empty` 是一个专门表示「没有默认值」的哨兵对象,用 `is` 比。`is_vip` 的 `threshold` 有默认值 10000,所以不进 `required`。
- `TOOLS[func.__name__] = func` 登记。
- `SCHEMAS.append({` 拼出和 Day 95 一样形状的工具定义。
- `"description": inspect.getdoc(func) or "",` docstring 当描述。`getdoc` 会把缩进清理干净,没写 docstring 时返回 `None`,`or ""` 兜底。
- `"parameters": {"type": "object", "properties": props, "required": required, "additionalProperties": False},` Day 95 的关键字全在这:`type`、`properties`、`required`、`additionalProperties`。
- `return func` **原样返回**。被装饰后的 `seats_price` 还是原来那个函数,直接调用一点不受影响。这类装饰器不需要 `wraps`,因为没造新函数。
- `def call(name: str, arguments: str) -> str:` 执行入口:两个字符串进,一个字符串出,这是以后 Agent 循环里「模型说调哪个、我就调哪个」那一步的形状。
- `if name not in TOOLS:` 查无此工具时把可用的列出来回去,模型下一轮能改对。
- `result = TOOLS[name](**json.loads(arguments))` 按名字取函数,JSON 字符串转字典,`**` 拆成关键字参数(Day 52 的 `**` 解包)。
- `except Exception as e:` 工具里出的任何错都转成一条 `error`,不让它炸掉外面的循环。这是 Agent 的惯例:错误交给模型处理,而不是让程序崩。
- `return json.dumps(result, ensure_ascii=False, default=str)` 结果转 JSON。`default=str`:结果里有 JSON 不认识的对象(日期、`Path`)就先转字符串。
- `@tool` 登记 `seats_price`。此时 `TOOLS` 和 `SCHEMAS` 都多了一项,这是 import 这个模块时就完成的。
- `def seats_price(plan: str, seats: int) -> dict:` 两个参数、都没默认值、类型是 `str` 和 `int`,看下面生成的 schema 是不是对得上。
- `def is_vip(monthly: float, threshold: float = 10000) -> bool:` 一个必填一个可选。
- `print(json.dumps(SCHEMAS, ensure_ascii=False, indent=2))` 看生成的两份定义。
- `print(call("seats_price", '{"plan": "旗舰版", "seats": 1}'))` 套餐不存在,函数里 `KeyError`,被 `call` 转成 error。
- `print("seats_price 还是原来的函数吗:", seats_price("基础版", 3))` 直接调用,不经过 `call`,证明没被包。

</div>

```bash
uv run python -m part01.tool_registry_mini
```

```text
[
  {
    "type": "function",
    "function": {
      "name": "seats_price",
      "description": "按套餐和席位数算每月应收金额(元)。",
      "parameters": {
        "type": "object",
        "properties": {
          "plan": {
            "type": "string"
          },
          "seats": {
            "type": "integer"
          }
        },
        "required": [
          "plan",
          "seats"
        ],
        "additionalProperties": false
      }
    }
  },
  {
    "type": "function",
    "function": {
      "name": "is_vip",
      "description": "月费超过阈值就算 VIP 客户。",
      "parameters": {
        "type": "object",
        "properties": {
          "monthly": {
            "type": "number"
          },
          "threshold": {
            "type": "number"
          }
        },
        "required": [
          "monthly"
        ],
        "additionalProperties": false
      }
    }
  }
]
{"plan": "专业版", "seats": 12, "monthly": 1188}
true
{"error": "KeyError: '旗舰版'"}
{"error": "没有叫 nope 的工具,可用的有 ['seats_price', 'is_vip']"}
seats_price 还是原来的函数吗: {'plan': '基础版', 'seats': 3, 'monthly': 117}
```

你没有手写一行 schema,`plan: str` 变成了 `"type": "string"`,`seats: int` 变成了 `"integer"`,有默认值的 `threshold` 没进 `required`,docstring 成了 `description`。这就是「装饰器 + 类型标注 + docstring」三样东西在 Agent 框架里的分工,[Day 168](/blog/agent-zero/day-168-tool-registry-1/) 和 [Day 169](/blog/agent-zero/day-169-tool-registry-2/) 会把它做完整(`Literal` 变 `enum`、`Annotated` 带说明、嵌套的 pydantic 模型)。它的 `description` 还没有每个参数的说明、`PY2JSON` 查不到的类型一律当字符串,这些都是故意留的简化。

<figure>
<svg viewBox="0 0 640 260" role="img" aria-label="两类装饰器对比:包一层的 timed、retry 返回 wrapper,调用时多走一层壳,需要 functools.wraps 抄名牌;登记型的 tool、pytest.fixture、app.get 只在定义时把函数写进一张表,原样返回函数,调用不受影响">
<rect x="0" y="0" width="640" height="260" fill="var(--paper-raised)" rx="6"/>
<g font-family="var(--font-mono)" font-size="12">
<text x="20" y="28" fill="var(--ink)">包一层(timed · retry · log_calls)</text>
<rect x="20" y="40" width="290" height="110" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="32" y="62" fill="var(--ink)">def deco(func):</text>
<text x="44" y="82" fill="var(--ink)">@functools.wraps(func)  ← 抄名牌</text>
<text x="44" y="102" fill="var(--ink)">def wrapper(*a, **kw): ...func(*a, **kw)</text>
<text x="44" y="122" fill="var(--ink)">return wrapper          ← 换掉原函数</text>
<text x="32" y="142" fill="var(--ink-soft)" font-size="11">每次调用都多走一层</text>
<text x="330" y="28" fill="var(--ink)">只登记(tool · pytest.fixture · app.get)</text>
<rect x="330" y="40" width="290" height="110" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="342" y="62" fill="var(--ink)">def tool(func):</text>
<text x="354" y="82" fill="var(--ink)">TOOLS[func.__name__] = func</text>
<text x="354" y="102" fill="var(--ink)">SCHEMAS.append(从签名生成)</text>
<text x="354" y="122" fill="var(--ink)">return func             ← 原样还回去</text>
<text x="342" y="142" fill="var(--ink-soft)" font-size="11">只在定义时跑一次,调用不受影响</text>
<text x="20" y="186" fill="var(--ink)">带参数的(retry(times=3) · app.get("/x") · dataclass(frozen=True))</text>
<rect x="20" y="198" width="600" height="46" rx="4" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="32" y="218" fill="var(--ink)">外层收参数 → 返回上面两种之一的装饰器 → 装饰器收函数 → 返回 wrapper 或 func</text>
<text x="32" y="236" fill="var(--ink-soft)" font-size="11">@ 后面带括号,先调用再装饰;一共三层</text>
</g>
</svg>
<figcaption>装饰器只有两种做法:包一层(蓝)或只登记(琥珀),带参数的只是在外面再套一层「收参数」。认清是哪种,读框架源码就不绕。</figcaption>
</figure>

## 回头看你用过的那六个 `@`

现在可以把前面六个「先照着用」的 `@` 逐个说清了。Day 79 的 `@app.get("/")` 带括号,是三层里的「只登记」型:`app.get("/")` 返回一个装饰器,装饰器把函数记进路由表,原样返回。Day 43 的 `@property` 是 Python 内置的类,`property(fn)` 把一个方法变成「读起来像属性」的描述符对象;它是「包一层」型,返回的不是函数而是一个 `property` 对象。写一个最小的 `MiniApp` 和手工 `property(...)` 验证这两件事,新建 `part01/seen_decorators.py`:

```python
# agent-zero-lab/part01/seen_decorators.py
from collections.abc import Callable


class MiniApp:
    """FastAPI 的 @app.get 背后大致就是这个形状。"""

    def __init__(self) -> None:
        self.routes: dict[tuple[str, str], Callable] = {}

    def get(self, path: str) -> Callable:
        def register(func: Callable) -> Callable:
            self.routes[("GET", path)] = func
            return func

        return register


app = MiniApp()


@app.get("/tickets")
def list_tickets() -> list[str]:
    return ["T-1001", "T-1002"]


print("路由表:", {k: v.__name__ for k, v in app.routes.items()})
print("app.get('/x') 返回的是一个函数:", app.get("/x").__name__)
print("模拟一次请求:", app.routes[("GET", "/tickets")]())


class Ticket:
    def __init__(self, status: str) -> None:
        self.status = status

    def _is_closed(self) -> bool:
        return self.status == "closed"

    is_closed = property(_is_closed)


t = Ticket("closed")
print("手工写 property(...) 和 @property 一样:", t.is_closed, type(Ticket.is_closed).__name__)
```

<div class="line-notes">

- `class MiniApp:` 一个最小的「应用」类,只有一张路由表。
- `self.routes: dict[tuple[str, str], Callable] = {}` 键是 `("GET", "/tickets")` 这样的元组,值是处理函数。
- `def get(self, path: str) -> Callable:` **第一层**是一个方法:收路径,返回装饰器。
- `def register(func: Callable) -> Callable:` **第二层**:登记型装饰器,把函数记进表,原样返回。`self` 和 `path` 都靠闭包记着。
- `@app.get("/tickets")` 和 Day 79 一模一样的写法:先调用 `app.get("/tickets")` 得到 `register`,再 `list_tickets = register(list_tickets)`。
- `print("路由表:", {k: v.__name__ for k, v in app.routes.items()})` 定义完,表里已经有了。
- `print("app.get('/x') 返回的是一个函数:", app.get("/x").__name__)` 验证第一层返回的是装饰器 `register`。
- `print("模拟一次请求:", app.routes[("GET", "/tickets")]())` 框架收到请求时做的事:按方法和路径查表,调用。
- `def _is_closed(self) -> bool:` 一个普通方法,名字前加下划线,因为下面要用 `is_closed` 这个名字放 property。
- `is_closed = property(_is_closed)` **手工写 `@property` 做的事**:`property(方法)` 返回一个 `property` 对象,赋给类属性 `is_closed`。Day 43 写 `@property` 在 `def is_closed` 上面,就是这一行的缩写。
- `print("手工写 property(...) 和 @property 一样:", t.is_closed, type(Ticket.is_closed).__name__)` `t.is_closed` 不带括号就能读到 `True`,从类上取它的类型是 `property`,和 Day 43 实测的一样。

</div>

```bash
uv run python -m part01.seen_decorators
```

```text
路由表: {('GET', '/tickets'): 'list_tickets'}
app.get('/x') 返回的是一个函数: register
模拟一次请求: ['T-1001', 'T-1002']
手工写 property(...) 和 @property 一样: True property
```

剩下几个一句话就够:Day 50 的 `@dataclass` 收一个**类**(类也是值),往类上添 `__init__` 等方法后把类返回,带参数时 `@dataclass(frozen=True)` 是三层;Day 52 的 `@field_validator("title")` 是带参数的登记型,把方法记到模型的校验表里;Day 73 的 `@pytest.fixture` 是登记型,给函数打个标记让 pytest 认出它;Day 93 的 `@contextmanager` 是包一层型,把「只 `yield` 一次的函数」包成一个能进 `with` 的对象,具体怎么包 [Day 98](/blog/agent-zero/day-098-context-managers/) 讲。

## 用测试钉住装饰器

给 `timed`、`retry` 和注册表配测试。新建 `tests/test_decorators.py`:

```python
# agent-zero-lab/tests/test_decorators.py
import inspect

import pytest

from part01.retry_deco import retry
from part01.timing import timed
from part01.tool_registry_mini import SCHEMAS, call


def test_timed_keeps_name_doc_signature_and_result(capsys: pytest.CaptureFixture[str]):
    @timed
    def area(width: float, height: float = 1.0) -> float:
        """面积。"""
        return width * height

    assert area(3, 4) == 12
    assert area.__name__ == "area" and area.__doc__ == "面积。"
    assert str(inspect.signature(area)) == "(width: float, height: float = 1.0) -> float"
    assert "[timed] area 用了" in capsys.readouterr().out


def test_timed_prints_even_when_function_raises(capsys: pytest.CaptureFixture[str]):
    @timed
    def boom() -> None:
        raise RuntimeError("x")

    with pytest.raises(RuntimeError):
        boom()
    assert "[timed] boom 用了" in capsys.readouterr().out


def test_retry_stops_after_success():
    seen = []

    @retry(times=5, on=(ConnectionError,))
    def flaky() -> str:
        seen.append(1)
        if len(seen) < 3:
            raise ConnectionError("no")
        return "ok"

    assert flaky() == "ok"
    assert len(seen) == 3


def test_retry_gives_up_and_reraises():
    seen = []

    @retry(times=3, on=(ConnectionError,))
    def down() -> None:
        seen.append(1)
        raise ConnectionError("still down")

    with pytest.raises(ConnectionError, match="still down"):
        down()
    assert len(seen) == 3


def test_retry_ignores_other_exceptions():
    seen = []

    @retry(times=3, on=(ConnectionError,))
    def wrong() -> None:
        seen.append(1)
        raise ValueError("bad")

    with pytest.raises(ValueError):
        wrong()
    assert len(seen) == 1


def test_tool_registry_schema_and_call():
    names = [s["function"]["name"] for s in SCHEMAS]
    assert "seats_price" in names
    params = next(s for s in SCHEMAS if s["function"]["name"] == "seats_price")["function"]["parameters"]
    assert params["properties"] == {"plan": {"type": "string"}, "seats": {"type": "integer"}}
    assert params["required"] == ["plan", "seats"]
    assert call("seats_price", '{"plan": "专业版", "seats": 12}') == '{"plan": "专业版", "seats": 12, "monthly": 1188}'
    assert '"error"' in call("seats_price", '{"plan": "旗舰版", "seats": 1}')
```

<div class="line-notes">

- `def test_timed_keeps_name_doc_signature_and_result(capsys: pytest.CaptureFixture[str]):` `capsys` 是 pytest 自带的 fixture,能把测试期间打印到屏幕的内容抓下来(Day 73 的 fixture 机制)。
- `@timed` 在测试函数里面定义一个被装饰的函数,只在这个测试里用。
- `assert area.__name__ == "area" and area.__doc__ == "面积。"` `wraps` 生效:名字和文档都在。把 `timing.py` 里的 `@functools.wraps(func)` 删掉,这一行会红。
- `assert str(inspect.signature(area)) == "(width: float, height: float = 1.0) -> float"` 签名也在。
- `assert "[timed] area 用了" in capsys.readouterr().out` `readouterr().out` 是抓到的标准输出,里面应该有计时那行。
- `with pytest.raises(RuntimeError):` 函数抛异常时,异常要照常传出来……
- `assert "[timed] boom 用了" in capsys.readouterr().out` ……而且耗时照样打印,`finally` 的功劳。
- `seen = []` 用列表记调用次数,每调一次 `append` 一个。
- `assert len(seen) == 3` 前两次失败、第三次成功,一共三次,没有多试。
- `with pytest.raises(ConnectionError, match="still down"):` 三次都失败时抛出的就是最后那个异常,消息不变。
- `assert len(seen) == 1` `ValueError` 不在 `on` 里,只调一次。
- `params = next(s for s in SCHEMAS if s["function"]["name"] == "seats_price")["function"]["parameters"]` 从列表里找名字匹配的那份定义。`next(生成器)` 取第一个满足条件的。
- `assert params["properties"] == {"plan": {"type": "string"}, "seats": {"type": "integer"}}` 从类型标注生成的 schema 要对。

</div>

```bash
uv run pytest -q
```

```text
.............................................                            [100%]
45 passed in 0.43s
```

45 个是今天的 6 个加 Day 92 到 95 的 39 个。

## 动手练习

运行方式都是在 `agent-zero-lab` 根目录 `uv run python -m part01.文件名`。练习 1 和 5 会重建 Day 94 的 `ledger.db`。

**练习 1:`log_calls` 的正式版。** 第 2 步的 `log_calls` 没有 `wraps`,也没处理异常。重写它:加 `functools.wraps`;参数打印成 `monthly('专业版', seats=12)` 这种可读的样子;原函数抛异常时打印「抛出 XXX」再把异常原样抛出去。用它装饰一个会 `KeyError` 的函数,再用手工写法 `log_calls(queries.invoices_of)` 包一个 Day 94 的查询函数。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part01/ex96_1_log_calls.py
import functools
from collections.abc import Callable

from part01.db import db
from part01.ledger import queries
from part01.ledger.seed import LEDGER_DB, build


def log_calls(func: Callable) -> Callable:
    """打印每次调用的参数和返回值(或异常),然后原样交回。"""

    @functools.wraps(func)
    def wrapper(*args, **kwargs):
        shown = ", ".join([repr(a) for a in args] + [f"{k}={v!r}" for k, v in kwargs.items()])
        print(f"-> {func.__name__}({shown})")
        try:
            result = func(*args, **kwargs)
        except Exception as e:
            print(f"<- {func.__name__} 抛出 {type(e).__name__}: {e}")
            raise
        print(f"<- {func.__name__} 返回 {result!r}")
        return result

    return wrapper


@log_calls
def monthly(plan: str, seats: int = 1) -> int:
    return seats * {"基础版": 39, "专业版": 99, "企业版": 199}[plan]


monthly("专业版", seats=12)
try:
    monthly("旗舰版")
except KeyError:
    pass

build()
invoices_of = log_calls(queries.invoices_of)
with db(LEDGER_DB, read_only=True) as conn:
    rows = invoices_of(conn, 1, status="unpaid")
print("返回值的类型是", type(rows[0]).__name__, "所以 repr 看不出内容:", [dict(r) for r in rows])
print("装饰后的名字:", invoices_of.__name__)
```

<div class="line-notes">

- `shown = ", ".join([repr(a) for a in args] + [f"{k}={v!r}" for k, v in kwargs.items()])` 位置参数用 `repr` 打印(字符串带引号),关键字参数打成 `k=v`,两个列表拼起来用逗号连。
- `except Exception as e:` 接住任何异常,打印一行,然后 `raise` 原样抛出,不吞。
- `invoices_of = log_calls(queries.invoices_of)` 手工装饰别人模块里的函数,不改 `queries.py`。
- `print("返回值的类型是", type(rows[0]).__name__,` 打印出来的返回值是 `[<sqlite3.Row object at 0x...>]`,因为 `Row` 的 `repr` 不显示内容(Day 93 提过),所以日志装饰器对这类返回值帮助有限,要看内容得 `dict(r)`。

</div>

```text
-> monthly('专业版', seats=12)
<- monthly 返回 1188
-> monthly('旗舰版')
<- monthly 抛出 KeyError: '旗舰版'
-> invoices_of(<sqlite3.Connection object at 0x10c9a3a60>, 1, status='unpaid')
<- invoices_of 返回 [<sqlite3.Row object at 0x10caa71f0>]
返回值的类型是 Row 所以 repr 看不出内容: [{'id': 3, 'amount': 1188, 'status': 'unpaid', 'issued_at': '2026-09-01'}]
装饰后的名字: invoices_of
```

`0x10c9a3a60` 这种地址每次运行不一样。

</details>

**练习 2:数调用次数。** 写两种计数装饰器:一种把计数器放在闭包变量里,用 `nonlocal` 改它,每次调用打印「第 N 次」;另一种用**类**当装饰器(`__init__` 收函数,`__call__` 负责调用),计数器是实例属性,外面能读、能清零。用后一种数一数朴素递归的 `fib(20)` 调了多少次。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part01/ex96_2_count_calls.py
import functools
from collections.abc import Callable


def count_calls(func: Callable) -> Callable:
    """闭包计数:每次调用打印第几次。计数器藏在闭包里,外面读不到。"""
    n = 0

    @functools.wraps(func)
    def wrapper(*args, **kwargs):
        nonlocal n
        n += 1
        print(f"   {func.__name__} 第 {n} 次调用")
        return func(*args, **kwargs)

    return wrapper


class CountCalls:
    """类当装饰器:实例替换原函数,计数器是实例属性,外面随时能读、能清零。"""

    def __init__(self, func: Callable) -> None:
        functools.update_wrapper(self, func)
        self.func = func
        self.calls = 0

    def __call__(self, *args, **kwargs):
        self.calls += 1
        return self.func(*args, **kwargs)


@count_calls
def square(x: int) -> int:
    return x * x


@CountCalls
def fib(n: int) -> int:
    return n if n < 2 else fib(n - 1) + fib(n - 2)


for i in range(3):
    square(i)

print("fib(10) =", fib(10), "| fib 被调用了", fib.calls, "次")
fib.calls = 0
print("fib(20) =", fib(20), "| fib 被调用了", fib.calls, "次")
print("fib 现在是什么:", type(fib).__name__, "| 名字还在:", getattr(fib, "__name__"))
```

<div class="line-notes">

- `n = 0` 计数器是装饰器的局部变量,`wrapper` 的闭包记着它。
- `nonlocal n` **新关键字**:在内层函数里要**改**外层函数的变量,必须先声明 `nonlocal`,否则 `n += 1` 会被当成在 `wrapper` 里新建一个局部变量 `n`,报 `UnboundLocalError`。只读不用声明(第 1 步的 `prefix` 就没声明)。`nonlocal` 对应 Day 30 讲的作用域,`global` 是改模块级变量,`nonlocal` 是改外层函数的。
- `class CountCalls:` 装饰器不一定是函数,**任何能被调用的东西**都行。`@CountCalls` 等于 `fib = CountCalls(fib)`,得到一个实例。
- `functools.update_wrapper(self, func)` `wraps` 的「非装饰器版」:把 `func` 的名牌抄到 `self` 上。
- `def __call__(self, *args, **kwargs):` **魔术方法**(Day 43 讲过 `__repr__`):定义了它,实例就能像函数一样加括号调用。`fib(10)` 其实是 `fib.__call__(10)`。
- `self.calls += 1` 计数器是实例属性,外面 `fib.calls` 直接读。
- `return n if n < 2 else fib(n - 1) + fib(n - 2)` 朴素递归,里面调的 `fib` 已经是装饰后的实例,所以每次递归都计数。
- `fib.calls = 0` 从外面清零,闭包版做不到这一点。
- `getattr(fib, "__name__")` 用 `getattr` 而不是 `fib.__name__`,原因和第 3 步的 `__wrapped__` 一样:类型检查器不知道 `update_wrapper` 往实例上加了这个属性。

</div>

```text
   square 第 1 次调用
   square 第 2 次调用
   square 第 3 次调用
fib(10) = 55 | fib 被调用了 177 次
fib(20) = 6765 | fib 被调用了 21891 次
fib 现在是什么: CountCalls | 名字还在: fib
```

`fib(20)` 调了 21891 次,这就是练习 4 要解决的问题。

</details>

**练习 3(观察题):两个装饰器叠起来,谁先谁后?** 写一个带标签的装饰器 `@tag("A")`,装饰时和调用前后各打印一行。把 `@tag("外层 A")` 和 `@tag("内层 B")` 叠在同一个函数上,先猜定义阶段和调用阶段的打印顺序,再跑;最后用手工写法写出等价的一行。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part01/ex96_3_stack_order.py
import functools
from collections.abc import Callable


def tag(label: str) -> Callable[[Callable], Callable]:
    def decorator(func: Callable) -> Callable:
        print(f"   装饰:{label} 包住 {func.__name__}")

        @functools.wraps(func)
        def wrapper(*args, **kwargs):
            print(f"进 {label}")
            result = func(*args, **kwargs)
            print(f"出 {label}")
            return result

        return wrapper

    return decorator


print("== 定义阶段 ==")


@tag("外层 A")
@tag("内层 B")
def work() -> str:
    print("   干活")
    return "done"


print("== 调用阶段 ==")
work()
print("== 等价写法 ==")


def work2() -> str:
    print("   干活")
    return "done"


work2 = tag("外层 A")(tag("内层 B")(work2))
work2()
```

<div class="line-notes">

- `print(f"   装饰:{label} 包住 {func.__name__}")` 装饰时打印。因为有 `wraps`,被外层包时 `func.__name__` 还是 `work`,不是 `wrapper`。
- `@tag("外层 A")` / `@tag("内层 B")` 叠两个。**离 `def` 近的先装饰**:先 B 包住 `work`,再 A 包住「B 包过的」。
- `work2 = tag("外层 A")(tag("内层 B")(work2))` 等价写法从里往外读:最里面 `tag("内层 B")(work2)` 先执行。

</div>

```text
== 定义阶段 ==
   装饰:内层 B 包住 work
   装饰:外层 A 包住 work
== 调用阶段 ==
进 外层 A
进 内层 B
   干活
出 内层 B
出 外层 A
== 等价写法 ==
   装饰:内层 B 包住 work2
   装饰:外层 A 包住 work2
进 外层 A
进 内层 B
   干活
出 内层 B
出 外层 A
```

定义时**从下往上**(B 先),调用时**从上往下**(A 先进、A 最后出),像洋葱。顺序有时很要紧:`@timed` 放在 `@retry` 外面,计的是三次重试的总时间;放里面,每次尝试各计一次。

</details>

**练习 4:自己写一个缓存装饰器。** 写 `@memo`:用字典记「参数 → 结果」,同样的参数第二次直接返回。拿它和标准库的 `functools.cache` 各装饰一个 `fib`,与朴素版比 `fib(30)` 的耗时。再试试给一个参数是列表的函数加 `@memo`,看报什么错,想想为什么。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part01/ex96_4_memo.py
import functools
import time
from collections.abc import Callable

CACHES: dict[str, dict] = {}


def memo(func: Callable) -> Callable:
    """最简单的缓存装饰器:同样的参数只算一次。缓存按函数名登记在 CACHES 里,方便查看。"""
    cache: dict = {}
    CACHES[func.__name__] = cache

    @functools.wraps(func)
    def wrapper(*args):
        if args not in cache:
            cache[args] = func(*args)
        return cache[args]

    return wrapper


def fib_plain(n: int) -> int:
    return n if n < 2 else fib_plain(n - 1) + fib_plain(n - 2)


@memo
def fib_memo(n: int) -> int:
    return n if n < 2 else fib_memo(n - 1) + fib_memo(n - 2)


@functools.cache
def fib_std(n: int) -> int:
    return n if n < 2 else fib_std(n - 1) + fib_std(n - 2)


for f in (fib_plain, fib_memo, fib_std):
    t0 = time.perf_counter()
    value = f(30)
    print(f"{f.__name__:<9} fib(30) = {value}  用时 {(time.perf_counter() - t0) * 1000:8.1f} 毫秒")
print("memo 里存了", len(CACHES["fib_memo"]), "个结果;functools.cache 的统计:", fib_std.cache_info())


@memo
def total(prices: list[int]) -> int:
    return sum(prices)


try:
    total([1, 2, 3])
except TypeError as e:
    print("列表当参数:", type(e).__name__ + ":", e)
```

<div class="line-notes">

- `CACHES: dict[str, dict] = {}` 把每个函数的缓存按名字登记在模块级字典里,外面能看;直接往 `wrapper` 上挂属性类型检查器会报红线。
- `cache: dict = {}` 每个被装饰的函数一份自己的缓存,闭包记着。
- `def wrapper(*args):` 只收位置参数,简化版;`functools.cache` 连关键字参数也管。
- `if args not in cache:` `args` 是元组,元组能当字典的键(Day 24:键必须是不可变的)。
- `@functools.cache` 标准库的现成版本,Python 3.9 起有;`lru_cache(maxsize=...)` 是带上限的版本。
- `fib_std.cache_info()` 标准库版自带统计:命中多少次、没命中多少次。
- `total([1, 2, 3])` 列表是可变的,不能当字典的键,报 `unhashable type: 'list'`。所以缓存装饰器只能用在参数都是不可变值的函数上。

</div>

```text
fib_plain fib(30) = 832040  用时    144.3 毫秒
fib_memo  fib(30) = 832040  用时      0.0 毫秒
fib_std   fib(30) = 832040  用时      0.0 毫秒
memo 里存了 31 个结果;functools.cache 的统计: CacheInfo(hits=28, misses=31, maxsize=None, currsize=31)
列表当参数: TypeError: unhashable type: 'list'
```

朴素版 140 多毫秒,两个缓存版都不到 0.1 毫秒,只算了 31 次。

</details>

**练习 5(开放题):把 `with db()` 做成装饰器。** Day 94 的函数都长成 `f(conn, ...)`,每次调用外面都要套一个 `with db(path) as conn:`。写一个带参数的装饰器 `@with_db(path, read_only=False)`:调用时自动开连接、把 `conn` 当第一个参数塞进去、离开时按 `db()` 的规矩提交或回滚。用它包 `bill_month` 和 `queries.invoices_of`,再写一个「插入后故意抛异常」的函数验证回滚,最后试试在只读连接里写。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part01/ex96_5_with_db.py
import functools
import sqlite3
from collections.abc import Callable
from pathlib import Path

from part01.db import db
from part01.ledger import queries
from part01.ledger.billing import bill_month
from part01.ledger.seed import LEDGER_DB, build


def with_db(path: Path, read_only: bool = False) -> Callable[[Callable], Callable]:
    """带参数的装饰器:调用时自动开 with db(path),把连接当第一个参数塞给被装饰函数。"""

    def decorator(func: Callable) -> Callable:
        @functools.wraps(func)
        def wrapper(*args, **kwargs):
            with db(path, read_only=read_only) as conn:
                return func(conn, *args, **kwargs)

        return wrapper

    return decorator


build()
bill = with_db(LEDGER_DB)(bill_month)
invoices_of = with_db(LEDGER_DB, read_only=True)(queries.invoices_of)


@with_db(LEDGER_DB)
def add_then_fail(conn: sqlite3.Connection) -> None:
    conn.execute("INSERT INTO invoices (customer_id, amount, status, issued_at) VALUES (1, 1, 'unpaid', '2030-01-01')")
    raise RuntimeError("插完以后出事了")


@with_db(LEDGER_DB, read_only=True)
def count_invoices(conn: sqlite3.Connection) -> int:
    return conn.execute("SELECT count(*) FROM invoices").fetchone()[0]


print("开 2026-11 的票:", bill("2026-11"), "张;再开一次:", bill("2026-11"), "张")
print("1 号客户的发票:", [(r["issued_at"], r["amount"]) for r in invoices_of(1)])
print("现在共", count_invoices(), "张")
try:
    add_then_fail()
except RuntimeError as e:
    print("抛出:", e)
print("失败之后还是", count_invoices(), "张(插入被回滚)")
print("只读连接里写:", end=" ")
try:
    with_db(LEDGER_DB, read_only=True)(lambda conn: conn.execute("DELETE FROM invoices"))()
except sqlite3.OperationalError as e:
    print(type(e).__name__ + ":", e)
```

<div class="line-notes">

- `def with_db(path: Path, read_only: bool = False) -> Callable[[Callable], Callable]:` 三层的第一层,收路径和只读开关。返回类型要写全 `Callable[[Callable], Callable]`,只写 `Callable` 的话类型检查器会以为装饰后的函数还要 `conn` 参数,调用处全是红线。
- `with db(path, read_only=read_only) as conn:` Day 93 的 `db()`,成功提交、失败回滚、一定关闭。
- `return func(conn, *args, **kwargs)` **把连接塞到第一个位置**,后面接调用方传的参数。`with` 块里 `return` 是允许的。
- `bill = with_db(LEDGER_DB)(bill_month)` 手工装饰 Day 94 的函数:`bill("2026-11")` 不用再管连接。
- `def add_then_fail(conn: sqlite3.Connection) -> None:` 先插一张发票再抛异常,验证回滚。
- `print("失败之后还是", count_invoices(), "张(插入被回滚)")` 实测还是 24 张,插入被 `db()` 回滚了。
- `with_db(LEDGER_DB, read_only=True)(lambda conn: conn.execute("DELETE FROM invoices"))()` 一行写完:只读装饰器包一个 `lambda`,立刻调用。只读连接拒绝写,报 `attempt to write a readonly database`。

</div>

```text
开 2026-11 的票: 10 张;再开一次: 0 张
1 号客户的发票: [('2026-07-01', 1188), ('2026-08-01', 1188), ('2026-09-01', 1188), ('2026-11-01', 1188)]
现在共 24 张
抛出: 插完以后出事了
失败之后还是 24 张(插入被回滚)
只读连接里写: OperationalError: attempt to write a readonly database
```

这个装饰器把「谁开连接、谁提交」的决定从调用方挪到了函数定义处。好处是调用方干净;代价是事务边界被藏起来了,两个被装饰的函数互相调用时会各开各的连接、各提各的事务,不再是「一件事」。Day 97 的小项目会用这个思路,但把 `with db()` 写在函数体里,而不是藏进装饰器,就是为了让事务边界一眼能看见。

</details>

验收标准:五道题都在自己终端里跑通;能不看文章写出带 `functools.wraps`、透传 `*args, **kwargs`、返回值原样交回的 `timed`;能说出 `@f` 等价于什么、什么时候执行;能数清 `@retry(times=3)` 有几层、每层收什么返回什么;能说出「包一层」和「只登记」两类装饰器的区别;`uv run pytest` 全部通过(45 个)。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 函数是值(first-class function) | 函数能赋给变量、当参数传、被返回、放进容器,和数字字符串一样 |
| 高阶函数(higher-order function) | 接受函数当参数或返回函数的函数,`map`、`sorted(key=)`、所有装饰器 |
| 闭包(closure) | 内层函数记住了定义它时外层的变量,外层函数返回后那些变量还活着;`__closure__` 能看到 |
| `nonlocal` | 内层函数要**改**外层函数的变量时的声明;只读不用声明 |
| 装饰器(decorator) | 收一个函数(或类)、返回一个函数(或类)的东西;`@deco` 写在 `def f` 上面等价于 `f = deco(f)`,在定义时执行 |
| `wrapper` | 装饰器返回的那个新函数,习惯叫这个名字;用 `*args, **kwargs` 透传参数 |
| `*args` / `**kwargs` | 收任意位置参数成元组 / 任意关键字参数成字典;调用时 `*`、`**` 再拆开 |
| `functools.wraps` | 把原函数的 `__name__`、`__doc__`、签名等抄到 `wrapper` 上,并挂 `__wrapped__`;写在 `wrapper` 上面 |
| `__wrapped__` | `wraps` 挂上的属性,指回原函数;测试想绕过装饰器时用 |
| `functools.update_wrapper` | `wraps` 的函数版,把名牌抄到任意对象上(类装饰器里用) |
| 带参数的装饰器 | `@deco(参数)`:先调用得到装饰器,再装饰;一共三层(收参数 → 收函数 → wrapper) |
| 登记型装饰器 | 不包新函数,只在定义时把函数记进某张表再原样返回;`@pytest.fixture`、`@app.get`、`@tool` |
| 包一层型装饰器 | 返回 `wrapper` 替换原函数,每次调用多走一层;`@timed`、`@retry`、`@property` |
| 类装饰器(两种意思) | 用类当装饰器(定义 `__call__`);或装饰一个类的装饰器(`@dataclass`) |
| `__call__` | 魔术方法,定义了它实例就能加括号调用 |
| `inspect.signature` | 取函数的参数列表、默认值、类型标注 |
| `inspect.Parameter.empty` | 「没有默认值」的哨兵,用 `is` 比 |
| `functools.cache` / `lru_cache` | 标准库的缓存装饰器;参数必须可哈希 |
| 哨兵(sentinel) | 一个专门表示「特殊状态」的对象,用 `is` 比较身份,如 `inspect.Parameter.empty` |

## 常见误区

**以为 `@` 在调用时才执行。** 实测「正在包装」在「定义完了,还没调用」之前打印。`import` 一个模块,里面的装饰器就全跑完了,这就是路由、工具、fixture 在 import 时登记好的原因。

**`wrapper` 忘了 `return func(...)`。** 实测函数返回 `None`,没有报错,下游做运算时才报 `unsupported operand type(s) for +: 'NoneType' and 'int'`。

**装饰器忘了 `return wrapper`。** 实测被装饰的名字变成 `None`,调用报 `'NoneType' object is not callable`。看到这句先查装饰器。

**不写 `functools.wraps`。** 实测名字变 `wrapper`、docstring 变 `None`、签名变 `(*args, **kwargs)`。日志、文档、从签名生成 schema 全坏。永远写。

**`@retry` 和 `@retry()` 混用。** 第 5 步的 `retry` 是三层,必须带括号 `@retry()`;写成 `@retry` 会把函数当成 `times` 传进去,`times + 1` 时报 `TypeError`。反过来,`@timed()` 也不行。看定义数层数。

**在 `wrapper` 里改外层变量不加 `nonlocal`。** `n += 1` 报 `UnboundLocalError: cannot access local variable 'n'`。只读不用声明,要改就声明。

**叠放顺序想反了。** 定义时从下往上,调用时从上往下。`@timed` 在 `@retry` 外面计的是总时间。

**给参数是列表的函数加缓存。** `unhashable type: 'list'`。缓存只能用在参数都是不可变值的函数上。

**把单元素元组写成 `(ConnectionError)`。** 没有逗号就只是加了括号的类,`on=(ConnectionError)` 传进 `except` 也能用,但 `on=(A)` 和 `on=(A, B)` 行为不一致容易出事,统一写 `(A,)`。

**用装饰器藏掉事务边界。** 练习 5 的 `with_db` 很省事,但两个被包的函数互相调用就是两个事务。要「一件事」的地方,`with db()` 还是写在看得见的位置。

## 学习资料

### 文档与文章

- [Python 官方文档 · functools(中文)](https://docs.python.org/zh-cn/3/library/functools.html):`wraps`、`update_wrapper`、`cache`、`lru_cache` 都在这一页。
- [Python 官方术语表 · decorator(中文)](https://docs.python.org/zh-cn/3/glossary.html):官方对装饰器的一句话定义,就是「`f = deco(f)` 的语法糖」。
- [PEP 318 · Decorators for Functions and Methods(英文)](https://peps.python.org/pep-0318/):2003 年引入装饰器语法的提案,里面有当年讨论过的其他写法,看完会明白为什么最后选了 `@`。
- [廖雪峰 · 装饰器(中文)](https://www.liaoxuefeng.com/wiki/1016959663602400/1017451662295584):中文入门,从「函数是对象」讲到带参数的装饰器和 `wraps`,和今天的顺序一样。
- [Real Python · Primer on Python Decorators(英文,需浏览器打开)](https://realpython.com/primer-on-python-decorators/):最完整的装饰器教程,今天没讲的类装饰器、装饰类、状态装饰器都有。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1Gu411Q7JV&autoplay=0&high_quality=1" title="【python】装饰器超详细教学,用尽毕生所学给你解释清楚,以后再也不迷茫了!" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>码农高天 · 【python】装饰器超详细教学 · 11 分钟,播放 16 万,2022 年发布。从「函数是对象」一路讲到带参数的装饰器,和今天第 1 到第 5 步一一对应,先看它再敲代码。内容没有逐段核对,以文章实测为准。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV11s411V7Dt&autoplay=0&high_quality=1" title="Python小技巧:装饰器(Decorator)" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>正月点灯笼 · Python小技巧:装饰器(Decorator) · 约 11 分钟,播放 11 万,2018 年发布。年头久一点,但讲得慢,`@` 等价于什么这一点讲得很清楚。同样没有逐段核对。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/FsAPt_9Bf3U" title="Python Tutorial: Decorators - Dynamically Alter The Functionality Of Your Functions" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Corey Schafer · Python Tutorial: Decorators · 英文,可开字幕。从闭包讲起的经典教程,中间有 `wraps` 和叠放顺序的演示,对应第 3 步和练习 3。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/QH5fw9kxDQA" title="Python Decorators: The Complete Guide" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>ArjanCodes · Python Decorators: The Complete Guide · 英文,可开字幕。偏工程实践,讲什么时候该用装饰器、什么时候别用,看完第 6 步再看它。</figcaption>
</figure>

### 书籍

- Luciano Ramalho,《Fluent Python》第二版,O'Reilly,2022;中文版《流畅的 Python(第 2 版)》,安道译,人民邮电出版社,2023。第 9 章「装饰器和闭包」是我见过把闭包、`nonlocal`、`wraps`、带参数装饰器讲得最透的一章,今天学完直接读那一章正好。

### 开源项目与代码

- [python-jsonschema/jsonschema](https://github.com/python-jsonschema/jsonschema):昨天用的库,它的 `validators.py` 里用 `@_validates("draft2020-12")` 这样的带参数装饰器登记各版本的校验器,和第 6 步的登记型是一个思路。
- [fastapi/fastapi](https://github.com/fastapi/fastapi):`routing.py` 里搜 `def get(`,能看到 `@app.get` 的第一层;它返回的 `decorator` 把函数加进路由表后原样返回,和今天的 `MiniApp` 一个形状。

## 自测

1. 下面两段代码等价吗?`seats_total` 最终指向谁?

```python
@log_calls
def seats_total(plan, *, seats): ...

def seats_total(plan, *, seats): ...
seats_total = log_calls(seats_total)
```

<details><summary>答案</summary>

等价。`@log_calls` 就是「`def` 执行完立刻做 `seats_total = log_calls(seats_total)`」。最终 `seats_total` 指向 `log_calls` 返回的 `wrapper`,原函数只被 `wrapper` 闭包里的 `func` 引用着。两段都在定义时执行装饰,不等调用。

</details>

2. 一个被 `@timed` 装饰的函数,打印出来 `__name__` 是 `wrapper`,`inspect.signature` 是 `(*args, **kwargs)`。少了什么?会影响什么?

<details><summary>答案</summary>

`wrapper` 上面少了 `@functools.wraps(func)`。影响:日志和报错里全是 `wrapper` 分不清是谁;编辑器悬停没有文档;pytest 参数化 id、FastAPI 自动文档、从签名生成 JSON Schema(第 6 步)都拿不到真实的参数名;也没有 `__wrapped__` 可以拿回原函数。

</details>

3. `@retry(times=3)` 和 `@timed` 分别有几层?把 `@retry` 不带括号写在函数上会发生什么?

<details><summary>答案</summary>

`@retry(times=3)` 三层:`retry` 收参数返回 `decorator`,`decorator` 收函数返回 `wrapper`,`wrapper` 每次调用执行。`@timed` 两层:`timed` 收函数返回 `wrapper`。`@retry` 不带括号等于 `f = retry(f)`,函数被当成 `times` 传进去,返回的是 `decorator`;之后调用 `f(...)` 其实是在调 `decorator(...)`,参数对不上或者 `times + 1` 时报 `TypeError`。

</details>

4. 第 6 步的 `@tool` 没有 `wrapper`,为什么被装饰的函数还能直接调用?它和 `@timed` 的区别是什么?

<details><summary>答案</summary>

`@tool` 是登记型:它只在定义时把函数记进 `TOOLS`、生成 schema 放进 `SCHEMAS`,然后 `return func` 原样返回,所以名字还指着原函数,调用不经过任何壳。`@timed` 是包一层型:返回新函数 `wrapper` 替换原函数,每次调用都多走一层。登记型不需要 `wraps`,因为没有新函数。

</details>

5. 面试题:你要给 Agent 的二十个工具函数统一加「记录调用耗时和参数」的功能,又不想改每个函数的函数体。你会怎么做?要注意什么?

<details><summary>答案</summary>

写一个装饰器(或者把它合进工具注册装饰器里),用 `*args, **kwargs` 透传参数,`try/finally` 保证异常时也记录,`functools.wraps` 保留名字和签名(注册表要靠签名生成 schema,报错要靠名字定位)。注意:返回值要原样交回;异常要原样抛出不吞;参数里可能有敏感信息(邮箱、密钥),记录前要脱敏(Day 194 讲);装饰器叠放顺序要定好,比如重试在内、计时在外计总时间;记录本身别太慢,不然每次调用都多一笔开销。

</details>

6. 面试题:同事写了个 `@with_db` 装饰器,所有数据库函数都用它自动开关连接,代码确实干净了很多。你看到「付款」函数内部调了「扣余额」和「记付款」两个也被 `@with_db` 装饰的函数。有什么问题?

<details><summary>答案</summary>

三个函数各开各的连接、各自一个事务:「扣余额」提交了,「记付款」失败,扣掉的钱不会回滚,这正是 Day 91 和 93 里「余额 624」那种事故。装饰器把事务边界藏起来了,看代码看不出三步不在一个事务里。改法:事务边界放在最外层的业务函数上,内层函数只收 `conn` 不自己开连接(Day 93 的 `pay_invoice` 就是这么设计的);装饰器可以留给「只读查询」这类不需要和别人共享事务的函数。

</details>

## 明天预告

Day 97 · 第 14 周复习:编程地基(Day 91–96)。这一周从 SQL 的约束和事务开始,到 Python 操作 SQLite、账单库项目,再到 JSON Schema 和装饰器,正好是「数据怎么守、怎么传、怎么描述、怎么包」一条线。明天不学新东西,把六天画成一张图,默写 `db()`、`timed` 和一份工单 schema,然后做一个只用本周知识的小项目:给账单库加一层「能给 Agent 用的工具」,每个工具用装饰器登记、用 schema 验参数、用 `db()` 管事务,参数错、库拒绝、找不到都变成一条 `error` 回给调用方。
