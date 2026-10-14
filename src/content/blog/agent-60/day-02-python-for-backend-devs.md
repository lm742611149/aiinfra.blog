---
title: 'Day 2 · 写给后端工程师的 Python 速成：uv、类型标注、async、pydantic'
description: '你已经会写 Java、Go 或 JS，只是不熟 Python。今天用对照的方式补上写 Agent 够用的那部分：uv 管项目、类型标注、dataclass 和 pydantic、async/await 并发、httpx、.env 管密钥、pytest。最后写一个并发抓取 + 数据校验 + 单测的小程序。'
pubDate: 2026-10-12
regime: none
tags: ['python', 'uv', 'asyncio', 'pydantic', 'agent-60']
series: 'agent-60'
day: 2
lang: 'zh'
---

## 今天要解决的问题

Agent 岗的 JD 十份里有九份写 Python。原因不复杂：各家模型的 SDK、LangGraph、MCP、评测工具，第一个支持的都是 Python。你用 Java 或 Go 也能做 Agent（Spring AI、LangChain4j 都有），但生态和资料差一截，面试时也难免被问「Python 熟不熟」。

好消息是，对有经验的工程师来说，Python 一天就能上手到「能写 Agent」的程度。今天不讲语法大全，只讲后面 58 天会反复用到的东西。学完你应该能：

1. 用 uv 建项目、加依赖、跑脚本，知道 `pyproject.toml` 和 `uv.lock` 各是干什么的。
2. 读懂和写出带类型标注的 Python，知道类型标注在运行时不做检查。
3. 分清 dataclass 和 pydantic 的用途，用 pydantic 校验外部数据。
4. 用 async/await 和 `asyncio.gather` 并发发请求，知道它和 Java 线程、Go goroutine 的区别。
5. 用 pytest 写和跑测试。
6. 用 Coding Agent 辅助学习和写代码，并能按一张清单审查它生成的代码。

预计用时：4 到 5 小时。如果你已经熟悉 Python，快速扫一遍「常见误区」和练习就行。

如果你是前端出身，今天会比后端同学轻松一些：Python 的 async/await 和 JS 几乎是同一套心智模型，pydantic 的角色和 zod 很像，uv 的体验也接近 pnpm。要多花时间的反而是类型标注和测试的习惯。如果你是 Java 出身，最不习惯的大概是「没有编译期检查」，代码写错了要跑到那一行才知道。这也是为什么我们第二天就把测试和类型标注一起讲。

## 先建立对照表

把你熟悉的东西映射过来，学得最快：

| 你熟悉的 | Python 里对应的 | 一句话说明 |
| --- | --- | --- |
| Maven / Gradle / npm / go mod | uv（+ `pyproject.toml`） | 管依赖、管虚拟环境、管 Python 版本 |
| `package.json` / `pom.xml` | `pyproject.toml` | 项目元数据和依赖声明 |
| `package-lock.json` / `go.sum` | `uv.lock` | 锁定精确版本，要提交进 git |
| `node_modules` | `.venv/` 目录 | 每个项目独立的依赖环境，不提交 |
| Java POJO / Go struct | `@dataclass` | 纯数据容器 |
| Bean Validation / zod | pydantic | 带校验的数据模型 |
| `CompletableFuture` / goroutine / Promise | `async def` + `await` + `asyncio` | 单线程事件循环的并发 |
| OkHttp / net/http / axios | httpx | HTTP 客户端，同步异步都支持 |
| JUnit / go test / Jest | pytest | 测试框架 |
| `.env` + dotenv | python-dotenv | 从 `.env` 加载环境变量 |

## uv：一个工具管完 Python 项目

几年前 Python 的依赖管理是出了名的乱：pip、virtualenv、pipenv、poetry、conda 各有一批用户。2024 年之后 uv 迅速成了事实标准，它是用 Rust 写的，装依赖比 pip 快一个数量级，而且把「装 Python」「建虚拟环境」「装依赖」「锁版本」「跑脚本」全包了。

Day 0 你已经 `uv init` 过一个项目。常用的命令就这几个：

```bash
uv init my-project --python 3.12   # 新建项目
uv add httpx pydantic               # 加依赖，自动写进 pyproject.toml 并更新 uv.lock
uv add --dev pytest                 # 加开发依赖（测试、lint 工具）
uv remove httpx                     # 删依赖
uv run python main.py               # 在项目的虚拟环境里跑
uv run pytest                       # 跑测试
uv sync                             # 别人 clone 了你的仓库，一条命令按 uv.lock 装好全部依赖
```

你几乎不需要手动「激活虚拟环境」。`uv run` 会自动用项目下的 `.venv`。这一点比 Java 和 Node 都省心。

`pyproject.toml` 长这样：

```toml
[project]
name = "agent-60-lab"
version = "0.1.0"
requires-python = ">=3.12"
dependencies = [
    "openai>=1.0",
    "python-dotenv>=1.0",
]

[dependency-groups]
dev = ["pytest>=8"]
```

记住两条：`pyproject.toml` 和 `uv.lock` 都提交进 git；`.venv/` 不提交（uv 生成的 `.gitignore` 默认已经忽略了）。

## 类型标注：写给人和工具看的，运行时不管

Python 是动态类型语言，但 3.5 之后支持类型标注，现在写正经项目基本都标。语法：

```python
def total_cost(prompt_tokens: int, completion_tokens: int, price_in: float, price_out: float) -> float:
    return (prompt_tokens * price_in + completion_tokens * price_out) / 1_000_000


# 常用类型
names: list[str] = ["deepseek", "qwen"]
prices: dict[str, float] = {"in": 2.0, "out": 8.0}
maybe_id: str | None = None          # 可能为空，相当于 Java 的 @Nullable / TS 的 string | null
pair: tuple[int, int] = (3, 4)
```

和 Java、Go 最大的不同：**这些标注在运行时不做任何检查**。你声明了 `int`，传个字符串进去照样能跑，直到某一行真正用错了才炸。类型标注的价值在于：编辑器能补全和提示、mypy / pyright 这类工具能静态检查、读代码的人一眼看懂。

### tuple（元组）和解包：后面每天都会用

上面最后一行的 `tuple` 后面几课会频繁出现，单独讲一下。tuple 就是**用圆括号写的、长度固定、不能改的 list**，相当于 TS 的元组类型 `[number, number]`：

```python
pair: tuple[int, int] = (3, 4)            # TS: const pair: [number, number] = [3, 4]
price: tuple[float, float, float] = (0.2, 2.0, 3.0)   # 三个位置，各自含义固定
pair[0]          # 3，和 list 一样按下标取
pair[0] = 5      # 报错：tuple 不能改
```

它最常见的两种用法，都和**解包**有关（相当于 TS 的数组解构 `const [a, b] = ...`）：

```python
# 1. 函数一次返回多个值：return 后面用逗号隔开，其实就是返回一个 tuple
def run() -> tuple[float, list[str]]:
    return 0.9, ["错例1"]          # 等价于 return (0.9, ["错例1"])

acc, wrong = run()                 # 解包：acc=0.9，wrong=["错例1"]

# 2. 一条数据由几个固定字段组成，懒得为它定义 class
TICKETS: list[tuple[str, str]] = [  # 每个元素是 (工单文本, 正确类别)
    ("扣了两次钱", "billing"),
    ("忘记密码", "account"),
]
for ticket, gold in TICKETS:        # 遍历时直接解包成两个变量
    print(ticket, gold)
```

类型标注里 `tuple[str, str]` 读作「两个字符串组成的元组」，`list[tuple[str, str]]` 读作「元组的列表」。字段一多（超过三四个）或者要起名字时，就改用下面讲的 dataclass。

### dict（字典）：遍历要用 .items()

dict 就是键值对，相当于 TS 的对象字面量或 `Map`。课程里存「版本名 → 提示词」「价格名 → 单价」都用它：

```python
VERSIONS: dict[str, str] = {"v1": "你是客服…", "v2": "你是客服，规则如下…"}
VERSIONS["v1"]               # 取值，键不存在会抛 KeyError
VERSIONS.get("v9")           # 键不存在返回 None，不报错（像 TS 里 obj.v9 拿到 undefined）
VERSIONS["v3"] = "新版本"     # 加一项
"v1" in VERSIONS             # 判断键在不在，TS: "v1" in obj
```

**遍历是最容易卡住的地方**：直接 `for x in 字典` 只拿到键。要键和值一起拿，用 `.items()`：

```python
for name in VERSIONS:                   # 只有键：v1, v2
    ...
for name, system in VERSIONS.items():   # 键和值，TS: for (const [name, system] of Object.entries(VERSIONS))
    ...
```

`.keys()` / `.values()` / `.items()` 分别对应 TS 的 `Object.keys` / `Object.values` / `Object.entries`。`.items()` 每次给出一个 `(键, 值)` 的 tuple，`for` 顺手把它解包成两个变量，就是上面讲的解包。

### set（集合）：只关心「在不在」

set 是不重复、无序的一组值，相当于 TS 的 `Set`。Day 5 用它装合法的分类标签：

```python
LABELS: set[str] = {"billing", "technical", "account", "other"}
"billing" in LABELS          # True，TS: LABELS.has("billing")
LABELS[0]                    # 报错：set 无序，没有下标
```

用 set 不用 list，是因为它查「在不在」很快（哈希查找），而且自动去重。

注意 set 和 dict 都用花括号，**有冒号是 dict，没冒号是 set**；空的 `{}` 是 dict，空 set 要写 `set()`。

四种容器放一起对照：

| Python | 字面量 | 类型标注 | TS 里对应 | 什么时候用 |
| --- | --- | --- | --- | --- |
| list | `[1, 2]` | `list[int]` | `number[]` | 一串同类数据，要按顺序、会增删 |
| tuple | `(1, 2)` | `tuple[int, int]` | `[number, number]`（只读） | 几个位置固定的字段、函数返回多个值 |
| dict | `{"k": 1}` | `dict[str, int]` | 对象 / `Map` | 按名字查值 |
| set | `{1, 2}` | `set[int]` | `Set<number>` | 去重、判断在不在 |

### Literal：只能取这几个值

有些字段只能取固定的几个值，比如工单分类。用 `Literal` 写：

```python
from typing import Literal

category: Literal["billing", "technical", "account", "other"] = "billing"
# TS: category: "billing" | "technical" | "account" | "other"
```

`str` 是什么字符串都行，`Literal[...]` 只认列出来的这几个。光是类型标注，运行时照样不检查（`category = "payment"` 能跑，只是编辑器画红线）；放进 pydantic 模型里就会真校验：

```python
from pydantic import BaseModel

class Ticket(BaseModel):
    category: Literal["billing", "technical", "account", "other"]

Ticket(category="billing")   # 通过
Ticket(category="Billing")   # ValidationError：大小写不对也不行
```

它还会进 `model_json_schema()`，变成 `{"enum": ["billing", "technical", "account", "other"], "type": "string"}`，把 schema 写进提示词，模型就能直接看到只有这几个选项。Day 6 的结构化抽取就是靠这个把模型的输出限制住：Day 5 是自己写 `if word in LABELS` 检查，Day 6 把规则写进类型里，交给 pydantic。

回到类型标注：它和 Agent 有什么关系？关系很大。Day 9 我们会写一个装饰器，**读取函数的类型标注，自动生成给模型看的工具 JSON Schema**。LangChain、MCP 的 Python SDK、OpenAI Agents SDK 全是这么干的。你写：

```python
def get_invoice(invoice_id: str, include_lines: bool = False) -> dict:
    """按发票号查询发票详情。"""
```

框架就能自动生成「这个工具叫 get_invoice，有一个必填字符串参数 invoice_id 和一个可选布尔参数 include_lines」的描述。类型标注在这里就是接口契约。

## dataclass 和 pydantic：一个装数据，一个守大门

**dataclass** 就是 Java 的 record 或 Go 的 struct，自动生成构造函数、`__repr__`、`__eq__`：

```python
from dataclasses import dataclass, field


@dataclass
class Usage:
    prompt_tokens: int
    completion_tokens: int
    tags: list[str] = field(default_factory=list)   # 可变默认值必须这么写


u = Usage(prompt_tokens=120, completion_tokens=30)
print(u)  # Usage(prompt_tokens=120, completion_tokens=30, tags=[])
```

dataclass 不校验。`Usage(prompt_tokens="abc", completion_tokens=None)` 照样能建出来。

**pydantic** 是带校验的数据模型，会按类型标注检查并转换输入：

```python
from pydantic import BaseModel, Field, ValidationError


class Ticket(BaseModel):
    ticket_id: str
    customer_email: str
    category: str = Field(description="billing / technical / account / other")
    priority: int = Field(ge=1, le=5)


t = Ticket.model_validate({"ticket_id": "T-1001", "customer_email": "a@b.com",
                           "category": "billing", "priority": "3"})
print(t.priority, type(t.priority))   # 3 <class 'int'>，字符串 "3" 被转成了 int

try:
    Ticket.model_validate({"ticket_id": "T-1002", "customer_email": "x", "category": "billing", "priority": 9})
except ValidationError as e:
    print(e)   # 会指出 priority 必须 <= 5
```

我的选择规则很简单：**数据从外部来（HTTP 请求、模型输出、配置文件），用 pydantic；纯内部传来传去，用 dataclass 或者也用 pydantic 都行**。Agent 里最常见的「外部数据」就是模型的输出。模型说它返回了 JSON，你不能信，必须校验。Day 6 整天都在讲这件事，主角就是 pydantic。

pydantic 还有一个后面会反复用的能力：`Ticket.model_json_schema()` 能直接导出 JSON Schema。这就是 Structured Outputs 和工具定义的原料。

### 小写 field 和大写 Field：两个库，别用混

上面两段代码里，一个用小写 `field`，一个用大写 `Field`。它们来自不同的库，只是名字碰巧一样：

```python
from dataclasses import field   # 标准库，给 @dataclass 用
from pydantic import Field      # pydantic 的，给 BaseModel 用
```

用哪个看类是什么：`@dataclass` 的类用小写 `field`，继承 `BaseModel` 的类用大写 `Field`。两者都写在 `=` 右边，也就是放默认值的位置：

```python
@dataclass
class FakeClient:
    seen: list[str] = field(default_factory=list)

class TicketInfo(BaseModel):
    customer_name: str | None = Field(None, description="工单中没有就填 null")
    invoice_ids: list[str] = Field(default_factory=list, description="原样抄写发票号")
    urgency: int = Field(ge=1, le=5)
```

- `Field(None, ...)` 的第一个参数是**默认值**：字段没给就填 `None`，所以这个字段是可选的。注意它和类型里的 `str | None` 管的不是一回事，类型说「值可以是空」，默认值说「不给就当空」。
- `Field(ge=1, le=5)` 没给默认值，字段就是**必填**的。
- 大写 `Field` 比小写 `field` 多了 `description`（会进 `model_json_schema()`，模型能看到）和 `ge`/`le`/`max_length` 这类校验，因为 pydantic 本来就是做校验和生成 schema 的。小写 `field` 只管默认值。

大小写的来历：Python 习惯类名大写开头、函数小写。pydantic 的 `Field` 写成了类的样子，标准库的 `field` 就是个普通函数。用混了编辑器会画红线，比如在 BaseModel 里写 `field(description=...)`，小写 `field` 根本没有这个参数。

## async/await：等网络的时候别闲着

Agent 程序的时间大头花在等网络：等模型 API 返回（几秒到几十秒）、等数据库、等外部 API。如果有 5 个工具调用可以同时做，一个一个串行等就很浪费。

Python 的异步模型和 JS 几乎一样：**单线程事件循环**。`async def` 定义协程函数，`await` 表示「这里要等 IO，先去干别的」。和 Java 线程池、Go goroutine 不同，它不会让 CPU 计算并行起来，只是让等待重叠。对 Agent 这种 IO 密集的程序，这正好够用。

<figure>
<svg viewBox="0 0 640 230" role="img" aria-label="串行等待和并发等待的时间线对比">
<rect x="0" y="0" width="640" height="230" fill="var(--paper-raised)" rx="6"/>
<g font-family="var(--font-mono)" font-size="12">
<text x="20" y="28" fill="var(--ink)">串行：for 循环里逐个 await</text>
<rect x="20" y="40" width="120" height="20" fill="var(--compute-wash)" stroke="var(--compute)"/><text x="80" y="55" text-anchor="middle" fill="var(--ink)">请求 A 1.2s</text>
<rect x="140" y="40" width="80" height="20" fill="var(--compute-wash)" stroke="var(--compute)"/><text x="180" y="55" text-anchor="middle" fill="var(--ink)">B 0.8s</text>
<rect x="220" y="40" width="150" height="20" fill="var(--compute-wash)" stroke="var(--compute)"/><text x="295" y="55" text-anchor="middle" fill="var(--ink)">C 1.5s</text>
<text x="380" y="55" fill="var(--ink-soft)">总耗时 ≈ 3.5s</text>
<text x="20" y="100" fill="var(--ink)">并发：asyncio.gather(A, B, C)</text>
<rect x="20" y="112" width="120" height="20" fill="var(--mem-wash)" stroke="var(--mem)"/><text x="80" y="127" text-anchor="middle" fill="var(--ink)">请求 A</text>
<rect x="20" y="136" width="80" height="20" fill="var(--mem-wash)" stroke="var(--mem)"/><text x="60" y="151" text-anchor="middle" fill="var(--ink)">B</text>
<rect x="20" y="160" width="150" height="20" fill="var(--mem-wash)" stroke="var(--mem)"/><text x="95" y="175" text-anchor="middle" fill="var(--ink)">请求 C</text>
<text x="190" y="151" fill="var(--ink-soft)">总耗时 ≈ 最慢的那个 1.5s</text>
<line x1="20" y1="200" x2="620" y2="200" stroke="var(--rule)"/>
<text x="20" y="218" fill="var(--ink-faint)">横轴是时间，1 秒 ≈ 100 像素。数字是示意。</text>
</g>
</svg>
<figcaption>三个互不依赖的网络请求，串行等待的总时间是三者之和，并发等待的总时间约等于最慢的那一个。Agent 里一次要调多个工具时，这个差别非常明显。</figcaption>
</figure>

最小例子：

```python
import asyncio
import time


async def fake_call(name: str, seconds: float) -> str:
    await asyncio.sleep(seconds)          # 模拟等网络
    return f"{name} done"


async def main() -> None:
    start = time.perf_counter()
    results = await asyncio.gather(
        fake_call("A", 1.2), fake_call("B", 0.8), fake_call("C", 1.5)
    )
    print(results, f"{time.perf_counter() - start:.1f}s")   # 约 1.5s


asyncio.run(main())
```

三个容易踩的坑，我都踩过：

- **在 async 函数里调用了同步的阻塞函数**，比如 `time.sleep(1)` 或者同步版的 `requests.get()`。整个事件循环会被卡住，所有协程一起等。异步代码里要用 `asyncio.sleep`、`httpx.AsyncClient`、`AsyncOpenAI`。
- **忘了 await**。`fake_call("A", 1)` 不加 await 只会得到一个协程对象，什么也没执行，Python 会给一个 `RuntimeWarning: coroutine ... was never awaited`。
- **在普通函数里想调 async 函数**。顶层用 `asyncio.run(main())`；如果你在 Jupyter 里，事件循环已经在跑了，直接 `await main()`。

`gather` 默认是「一个失败全部失败」。如果你希望某个工具失败了其他照常返回，加 `return_exceptions=True`，然后逐个检查结果是不是异常。Day 12 讲 Agent 失败处理时会用到。

## httpx：同步异步一套 API

`requests` 很经典但只有同步版。httpx 的接口几乎和 requests 一样，同时支持异步，而且 OpenAI 官方 Python SDK 底层用的就是它。

```python
import httpx

# 同步
r = httpx.get("https://api.github.com/repos/astral-sh/uv", timeout=10)
print(r.status_code, r.json()["stargazers_count"])


# 异步
async def stars(repo: str, client: httpx.AsyncClient) -> int:
    r = await client.get(f"https://api.github.com/repos/{repo}", timeout=10)
    r.raise_for_status()
    return r.json()["stargazers_count"]
```

注意 `timeout`。httpx 默认超时是 5 秒，模型 API 动辄几十秒，直接用 httpx 调模型时要把超时调大。用 OpenAI SDK 的话它自己有更长的默认值。

## 读框架源码前要认识的几个写法

后面读 LangGraph、MCP SDK 的示例代码时，有几种 Python 写法会反复出现。Java 和 Go 里没有完全对应的东西，第一次见容易卡住，这里提前过一遍。

**装饰器。** 函数上面那一行 `@xxx`，本质是「把下面这个函数传给 xxx，用它的返回值替换原函数」。它在 Agent 框架里到处都是：MCP SDK 用 `@mcp.tool()` 把普通函数注册成工具，LangChain 用 `@tool`，FastAPI 用 `@app.get("/")` 注册路由。你可以把它理解成 Java 的注解加上一段在类加载时执行的处理逻辑，只不过 Python 里它就是一个普通函数。

```python
TOOLS: dict[str, callable] = {}


def tool(func):
    """最简单的注册型装饰器：把函数登记到 TOOLS 里，原样返回。"""
    TOOLS[func.__name__] = func
    return func


@tool
def get_weather(city: str) -> str:
    """查询城市天气。"""
    return f"{city}：晴，22 度"


print(TOOLS)                      # {'get_weather': <function get_weather ...>}
print(get_weather.__doc__)        # 查询城市天气。
print(get_weather.__annotations__)  # {'city': <class 'str'>, 'return': <class 'str'>}
```

最后两行很关键：函数的文档字符串和类型标注在运行时都能读到。Day 9 的工具注册器就是用这两样东西，自动拼出给模型看的工具描述。

**上下文管理器（with）。** `with open(...) as f:`、`async with httpx.AsyncClient() as client:` 这种写法，保证代码块结束时资源一定被释放，哪怕中间抛了异常。相当于 Java 的 try-with-resources 或 Go 的 defer。用 httpx 时记得放进 with 里，不然连接池不会被关闭。

**推导式和 f-string。** `[m["content"] for m in messages if m["role"] == "user"]` 是列表推导，一行完成过滤和映射，相当于 Java Stream 的 filter + map。`f"花费 {cost:.4f} 元"` 是格式化字符串，冒号后面是格式说明。这两个在 Python 代码里出现频率极高，看几次就熟了。

**真值判断。** 空列表、空字符串、0、`None` 在 if 里都是假。`if messages:` 就是「列表非空」。这很方便，但也有坑：一个工具返回了 `0`（比如余额为零），你写 `if result:` 会把它当成「没有结果」。需要区分「没有」和「是零」时，写 `if result is not None:`。

**异常。** Python 用异常处理错误，没有 Go 那种多返回值的 err。`try / except 具体异常类型 as e`，尽量捕获具体类型，不要一个光秃秃的 `except:` 把所有错误都吞掉，那样调试时你会完全不知道发生了什么。Agent 里有一个特殊情况：工具执行出错时，通常不让程序崩溃，而是把错误信息转成字符串交给模型，让它自己决定换个参数重试。Day 12 会专门讲。

**字典就是 JSON。** Python 的 dict 和 list 跟 JSON 一一对应，`json.loads` 把字符串变成 dict，`json.dumps(obj, ensure_ascii=False)` 变回字符串。`ensure_ascii=False` 记得加，不然中文会变成 `云簿` 这种转义，日志里没法看，发给模型也白白多占 token。

**type[X]：传「类本身」。** 平时 `x: TicketInfo` 表示 x 是一个**实例**；`model: type[TicketInfo]` 表示传进来的是**类本身**：

```python
def schema_prompt(model: type[BaseModel]) -> str:
    return json.dumps(model.model_json_schema(), ensure_ascii=False)

schema_prompt(TicketInfo)                 # 传类，没有括号
schema_prompt(TicketInfo(category=...))   # 错：这是实例
```

为什么要传类：`model_json_schema()` 读的是类上定义的字段、类型和 description，这时候还没有任何数据，谈不上实例。TS 里接近 `typeof TicketInfo` 或 `new (...args: any) => BaseModel`。Day 6 的 `extract(client, TicketInfo, ...)` 也是传类进去，函数内部拿它生成 schema、校验模型输出，最后返回一个实例。

**泛型（TypeVar）。** 想让函数「传进什么类、就返回什么类的实例」时用。Day 6 的 `extract()` 就是这样：

```python
from typing import TypeVar
from pydantic import BaseModel

T = TypeVar("T", bound=BaseModel)      # TS: <T extends BaseModel>

def extract(model: type[T], text: str) -> T:   # type[T] 是「类本身」，T 是「它的实例」
    return model.model_validate_json(text)

info = extract(TicketInfo, raw)        # 编辑器知道 info 是 TicketInfo，能补全字段
```

`bound=BaseModel` 就是 TS 的 `extends`，限定 T 必须是某个 pydantic 模型。返回类型如果只写 `-> BaseModel`，编辑器就不知道 `info` 有哪些字段了。Python 3.12 起也可以写成和 TS 更像的 `def extract[T: BaseModel](model: type[T], text: str) -> T:`，效果一样；不过库和框架的代码里大多还是 `TypeVar` 老写法，两种都要认识。

## 密钥：.env + python-dotenv

Day 0 已经用过了。原则再说一遍：密钥只放在 `.env` 或者系统环境变量里，代码里用 `os.environ["LLM_API_KEY"]` 读。用 `os.environ[...]` 而不是 `os.getenv(...)`，前者没配置时会立刻报 `KeyError`，比拿到一个 `None` 跑到一半再报奇怪的 401 好排查得多。

再提交一个 `.env.example` 进 git，列出需要哪些变量但不写真实值，方便别人（和面试官）跑你的项目。

## pytest：最省事的测试框架

pytest 不需要写测试类，函数名以 `test_` 开头、文件名以 `test_` 开头就行，断言直接用 `assert`。

先把上面类型标注那节的 `total_cost` 存成项目根目录的 `cost.py`（测试要 import 它，没这个文件会报 `ModuleNotFoundError: No module named 'cost'`），再在 `pyproject.toml` 末尾加两行，让 pytest 从项目根目录找模块：

```toml
[tool.pytest.ini_options]
pythonpath = ["."]
```

然后写测试：

```python
# tests/test_cost.py
from cost import total_cost


def test_total_cost():
    assert total_cost(1_000_000, 0, 2.0, 8.0) == 2.0
    assert total_cost(0, 500_000, 2.0, 8.0) == 4.0
```

`uv run pytest -q` 跑全部测试。测异步函数需要装 `pytest-asyncio` 或者 `anyio` 插件，今天先不碰，用 `asyncio.run` 包一下也能测。

为什么第二天就讲测试？因为 W5 的评测体系就是建在 pytest 上的。模型输出不确定，但你的工具函数、解析逻辑、成本计算都是确定的，这些必须有单元测试。面试官看你的 GitHub，有没有 `tests/` 目录是第一眼就会注意的。

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV13WGHz8EEz&autoplay=0&high_quality=1" title="从pip到uv：一口气梳理现代Python项目管理全流程！" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>隔壁的程序员老王 · 从pip到uv：一口气梳理现代Python项目管理全流程！ · 16 分钟，把 Python 依赖管理的历史和 uv 的用法讲得很清楚，今天必看。</figcaption>
</figure>

## 日志：别只用 print

练习里用 `print` 没问题，但从 W2 开始 Agent 一次要跑十几步，满屏 print 会让你分不清哪行是模型说的、哪行是工具返回的、哪行是调试信息。标准库的 `logging` 够用了：

```python
import logging

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s | %(message)s")
log = logging.getLogger("agent")

log.info("调用工具 %s 参数=%s", "get_invoice", {"invoice_id": "INV-1"})
log.warning("工具返回过长，已截断到 %d 字符", 2000)
```

用 `%s` 占位而不是 f-string，是 logging 的惯例：日志级别不够时字符串根本不会被拼接，省一点开销。调试时把 level 改成 `DEBUG`，上线时改回 `INFO`。W5 会把日志升级成 trace，那时你会感谢现在养成的习惯。

上面的 `getLogger("agent")` 是手动起名。写在公共模块里时，惯用写法是：

```python
log = logging.getLogger(__name__)
```

`__name__` 是 Python 自动给每个文件的变量，值是模块名，比如在 `common/structured.py` 里就是 `"common.structured"`。用它当 logger 名，日志里（格式串的 `%(name)s`）就能看出是哪个文件打的，也能单独调某个模块的级别。分工记住一句：**每个模块开头写 `getLogger(__name__)` 只管打日志，入口脚本里写一次 `basicConfig` 决定日志往哪输出、什么格式**。顺带一提，文件直接运行时 `__name__` 是 `"__main__"`，所以脚本末尾的 `if __name__ == "__main__":` 意思是「只有直接运行这个文件才执行，被别人 import 时不执行」。

## 课程仓库的目录约定

从今天起，这门课的所有代码都放在一个仓库 `agent-60-lab` 里，每周一个目录。提前说好约定，后面的文章就不再重复：

```
agent-60-lab/
├── .env                 # 你的密钥，不提交
├── .env.example         # 变量清单，不含真实值，提交
├── pyproject.toml
├── uv.lock
├── common/              # Day 4 开始放跨周复用的代码，比如 LLMClient
├── w1/ … w6/            # 每周的练习和小项目
└── tests/               # 所有测试
```

几条习惯，越早养成越省事。每个练习都能用 `uv run python w1/xxx.py` 从仓库根目录直接跑，不要依赖「先 cd 到某个目录」。复用的代码放进 `common/`，别在每个文件里复制一遍客户端初始化。每完成一天提交一次 git，提交信息写清楚「Day 3: ask.py 支持多厂商切换」，几十个提交记录本身就是你学习过程的证据，面试时有人真的会点进去看。

写练习代码时可以用 AI 编程工具帮忙，怎么用、怎么审查它写的东西，下一节专门讲。

## 用 Coding Agent 学 Python、写代码，以及怎么审查它

这一节是根据 JD 调研加的。国内 120 条 Agent 岗位 JD 里有 26% 点名要求熟练使用 Claude Code、Cursor 或 Codex 这类 Coding Agent，有的写得很直白：「熟练使用 Codex / Claude Code / Cursor 等工具，并能把控生成代码的质量」。后半句才是重点。会让它生成代码谁都会，能判断它生成的东西对不对、该不该合进去，才是招聘方要的能力。

先说怎么拿它学 Python。对有经验的工程师，Coding Agent 是非常好的语言老师，因为你可以用自己熟悉的语言去问。几种我常用的问法：「这段 Python 如果用 Java 写是什么样，逐行对照着解释」；「`async with` 和 Go 的 defer 有什么异同」；「我写了一个函数，帮我指出哪里不够 Pythonic，但先别改，只列问题」。最后这种「只指出不改」的用法特别适合学习，自己动手改一遍印象深得多。

再说怎么用它写课程代码。我的建议是给它小而清楚的任务，一次一个函数或一个文件，而不是「帮我把今天的练习全写了」。任务越大，它越容易自作主张加一堆你没要的东西，你也越难审查。Claude Code 和 Codex 都支持在仓库根目录放一个说明文件（Claude Code 读 `CLAUDE.md`，Codex 读 `AGENTS.md`），把这门课的约定写进去，比如「用 uv 管依赖」「密钥只从环境变量读」「每个功能都要有 pytest 测试」「模型名从 LLM_MODEL 读，不要写死」，它每次都会照着做。这个说明文件本身就是一种提示词，Day 5 讲的原则全部适用。

最重要的是审查。它写完之后，我会按这张清单过一遍：

| 检查项 | 为什么要查 |
| --- | --- |
| 能不能跑、测试过没过 | 让它自己跑一遍 `uv run pytest`，别信「我已经写好了」 |
| 有没有加你没要求的依赖 | 它很喜欢顺手装个库，每个新依赖都是以后的维护负担 |
| 模型名、API 写法是不是过时的 | 它的训练数据有截止时间，经常写出 `gpt-3.5-turbo` 或者已经改名的参数 |
| 密钥有没有写死在代码里 | 为了「先跑起来」，它有时会把 key 直接填进去 |
| 异常是不是被吞掉了 | `except Exception: pass` 是它最常见的坏习惯之一 |
| async 函数里有没有同步阻塞调用 | 比如在 async 函数里用 `requests` 或 `time.sleep` |
| 改动范围是不是比任务大 | 用 `git diff --stat` 看它动了哪些文件，多动的要问清楚为什么 |
| 你能不能逐行解释 | 解释不了的那几行，就是面试时会被问倒的地方 |

最后一条最关键。我的标准是：合进仓库的每一行，你都要能讲清楚它在干什么、为什么这么写。做不到就让它解释，或者删掉自己重写。Agent 岗的面试官自己天天用这些工具，他们最擅长分辨「我理解这段代码」和「这段代码是 AI 写的，我也不太清楚」。

还有一个更深的理由要认真对待 Coding Agent：它本身就是目前最成熟的 Agent 产品。它的工作方式（读文件、调工具、跑命令、看结果、再改）和你 W2 要手写的 Agent 循环是同一个东西。用的时候多留意它在什么情况下会犯错：上下文太长时忘了前面的约定，工具用错了地方，多轮修改后越改越偏。这些失败模式 Day 12 会系统地讲，到时候你会发现自己早就见过了。

## 动手练习

写一个小程序：并发查询几个 GitHub 仓库的信息，用 pydantic 校验返回数据，统计耗时，再写测试。这正好是 Agent 里「并发调用多个工具、校验结果」的雏形。

**第 1 步：加依赖。**

```bash
cd agent-60-lab
uv add httpx pydantic
uv add --dev pytest
mkdir -p w1 tests
```

**第 2 步：写主程序。**

```python
# agent-60-lab/w1/repo_stats.py
import asyncio
import time

import httpx
from pydantic import BaseModel, Field, ValidationError

REPOS = [
    "astral-sh/uv",
    "pydantic/pydantic",
    "encode/httpx",
    "openai/openai-python",
    "this-owner/does-not-exist-404",   # 故意放一个不存在的，练习错误处理
]


class RepoInfo(BaseModel):
    full_name: str
    stars: int = Field(alias="stargazers_count", ge=0)
    language: str | None = None
    open_issues: int = Field(alias="open_issues_count", ge=0)


async def fetch_repo(client: httpx.AsyncClient, repo: str) -> RepoInfo:
    r = await client.get(f"https://api.github.com/repos/{repo}")
    r.raise_for_status()
    return RepoInfo.model_validate(r.json())


async def fetch_all(repos: list[str]) -> list[RepoInfo | BaseException]:
    async with httpx.AsyncClient(timeout=15, headers={"User-Agent": "agent-60-lab"}) as client:
        return await asyncio.gather(*(fetch_repo(client, r) for r in repos), return_exceptions=True)


def summarize(results: list[RepoInfo | BaseException], repos: list[str]) -> tuple[list[RepoInfo], list[str]]:
    ok: list[RepoInfo] = []
    failed: list[str] = []
    for repo, res in zip(repos, results):
        if isinstance(res, RepoInfo):
            ok.append(res)
        elif isinstance(res, httpx.HTTPStatusError):
            failed.append(f"{repo}: HTTP {res.response.status_code}")
        elif isinstance(res, ValidationError):
            failed.append(f"{repo}: 返回数据不合法 {res.error_count()} 处")
        else:
            failed.append(f"{repo}: {type(res).__name__} {res}")
    return ok, failed


def main() -> None:
    start = time.perf_counter()
    results = asyncio.run(fetch_all(REPOS))
    ok, failed = summarize(results, REPOS)
    for info in sorted(ok, key=lambda x: x.stars, reverse=True):
        print(f"{info.full_name:<28} ⭐ {info.stars:>7}  {info.language or '-'}")
    for f in failed:
        print("失败:", f)
    print(f"耗时 {time.perf_counter() - start:.2f}s")


if __name__ == "__main__":
    main()
```

```bash
uv run python w1/repo_stats.py
```

返回值类型写的是 `BaseException`，不是 `Exception`，这是故意的。`gather(..., return_exceptions=True)` 在类型上声明的返回值是 `list[结果 | BaseException]`，因为它连 `KeyboardInterrupt`、`CancelledError` 这类不属于 `Exception` 的异常也会收进列表。如果写成 `Exception`，Zed、VS Code 会在 `return await asyncio.gather(...)` 下面画红线，提示类型对不上。代码照样能跑，但标注应该说实话。

输出大致是：四行仓库信息按星数从高到低排列，一行「失败: this-owner/does-not-exist-404: HTTP 404」，最后是总耗时。GitHub 匿名访问每小时有 60 次的限额，频繁跑可能遇到 403，那也会被当作失败打印出来，不会让程序崩溃。

**第 3 步：改成串行对比耗时。** 把 `fetch_all` 里的 `gather` 改成一个 for 循环逐个 await，再跑一次，比较总耗时。差多少倍？记下来。如果差距没有你预期的大，想想是不是某个请求特别慢，把整体时间拖住了，这正是并发的上限所在。

**第 4 步：写测试。** 不访问网络，只测纯逻辑：

```python
# agent-60-lab/tests/test_repo_stats.py
import httpx
import pytest
from pydantic import ValidationError

from w1.repo_stats import RepoInfo, summarize


def test_repo_info_parses_github_fields():
    info = RepoInfo.model_validate(
        {"full_name": "a/b", "stargazers_count": 10, "language": "Python", "open_issues_count": 2}
    )
    assert info.stars == 10
    assert info.open_issues == 2


def test_repo_info_rejects_negative_stars():
    with pytest.raises(ValidationError):
        RepoInfo.model_validate({"full_name": "a/b", "stargazers_count": -1, "open_issues_count": 0})


def test_summarize_separates_ok_and_failed():
    req = httpx.Request("GET", "https://example.invalid/repos/x/y")
    err = httpx.HTTPStatusError("not found", request=req, response=httpx.Response(404, request=req))
    good = RepoInfo.model_validate({"full_name": "a/b", "stargazers_count": 1, "open_issues_count": 0})
    ok, failed = summarize([good, err], ["a/b", "x/y"])
    assert ok == [good]
    assert failed == ["x/y: HTTP 404"]
```

为了让 `from w1.repo_stats import ...` 能找到模块，在项目根目录建一个空的 `w1/__init__.py`，并在 `pyproject.toml` 里加上：

```toml
[tool.pytest.ini_options]
pythonpath = ["."]
```

```bash
touch w1/__init__.py
uv run pytest -q
```

应该看到 `3 passed`。

**第 5 步（建议做）：让 Coding Agent 写一版再审查。** 把这个练习的需求原样交给 Claude Code、Cursor 或 Codex，让它在另一个分支上写一版。然后用上面那张审查清单逐项过一遍，把发现的问题记下来，再和你自己写的版本对比。你很可能会发现它多装了依赖、或者把异常处理写得很粗糙。这份「AI 代码审查记录」留着，面试被问到「怎么用 AI 写代码」时就是现成的素材。

**验收标准：** 程序能并发跑完并正确打印失败项；你记录了串行和并发的耗时对比；3 个测试全部通过。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| uv | Rust 写的 Python 项目管理工具，管 Python 版本、虚拟环境、依赖、锁文件 |
| pyproject.toml | Python 项目的配置文件，声明依赖和工具配置 |
| uv.lock | 锁定所有依赖精确版本的文件，提交进 git |
| 虚拟环境（.venv） | 项目独立的 Python 和依赖目录，互不干扰 |
| 类型标注（type hints） | 给变量和函数标注类型的语法，运行时不检查 |
| dataclass | 自动生成构造函数等方法的数据类，不做校验 |
| pydantic | 带类型校验和转换的数据模型库，能导出 JSON Schema |
| 协程（coroutine） | `async def` 定义的函数，调用后要 await 才执行 |
| 事件循环 | 调度协程的单线程循环，遇到 await 就切去执行别的协程 |
| asyncio.gather | 并发运行多个协程并收集结果 |
| httpx | 支持同步和异步的 HTTP 客户端 |
| pytest | Python 最常用的测试框架 |

## 常见误区

**以为类型标注会在运行时报错。** 不会。想要运行时检查用 pydantic，想要静态检查用 mypy 或 pyright。

**在 async 函数里调用同步阻塞的库。** `requests`、`time.sleep`、同步版的 OpenAI 客户端都会卡死整个事件循环。异步代码要配异步库。

**把 dataclass 当成校验工具。** dataclass 只是数据容器，外部数据进系统那一刻要用 pydantic 把关。

**直接用 pip install 往系统 Python 里装包。** 多个项目依赖冲突、换台电脑就跑不起来。全部用 uv 管，`uv sync` 一条命令复现环境。

**用 `os.getenv` 读密钥。** 变量没配置时 `os.getenv` 返回 `None`，程序继续往下跑，直到调用 API 时才报一个莫名其妙的 401 或者「api_key 不能为空」。用 `os.environ["KEY"]`，启动时就报 `KeyError: 'LLM_API_KEY'`，一眼知道少配了什么。

**捕获异常后什么都不打印。** `except Exception: pass` 是排查问题的噩梦。Agent 系统本来就有很多不确定性，再把错误吞掉，你会花一下午去猜到底哪一步出了问题。至少打一行日志，写清楚是哪个工具、什么参数、什么错误。

**在 Jupyter 里调用 `asyncio.run`。** Jupyter 自己已经有一个事件循环在跑，再调用会报「asyncio.run() cannot be called from a running event loop」。在 Notebook 里直接写 `await main()` 就行，在 `.py` 脚本里才用 `asyncio.run(main())`。

**可变默认参数。** Python 经典坑，写 TS 的人尤其容易踩：

```python
def add_tag(tag: str, tags: list[str] = []) -> list[str]:
    tags.append(tag)
    return tags

add_tag("a")   # ['a']
add_tag("b")   # ['a', 'b']   ← 上一次的 'a' 还在
```

原因是 Python 的默认值**只在定义函数时算一次**，那个 `[]` 从头到尾只有一个，每次调用拿到的都是同一个列表。TS 的 `tags: string[] = []` 每次调用都会重新算，所以不会这样。list、dict、set 这种建好后还能改的「可变对象」都有这个问题；数字、字符串、`None`、tuple 改不了，当默认值没事。

正确写法：

```python
def add_tag(tag: str, tags: list[str] | None = None) -> list[str]:
    if tags is None:
        tags = []              # 每次调用新建一个
    tags.append(tag)
    return tags
```

类里的字段也一样：

- **dataclass**：写 `tags: list[str] = []` 运行时直接报 `ValueError: mutable default`，必须写 `field(default_factory=list)`。`default_factory` 是「默认值的工厂函数」，每创建一个实例就调用一次 `list()`，得到一个新的空列表。
- **pydantic**：直接写 `= []` 其实没问题，pydantic 会给每个实例复制一份；但习惯上也写 `Field(default_factory=list)`，和 dataclass 保持一致，不用记两套规则。

## 学习资料

### 文档与文章

- [uv 文档](https://docs.astral.sh/uv/)：重点看 Getting started 和 Working on projects 两节。30 分钟。
- [pydantic 文档：Models](https://docs.pydantic.dev/latest/concepts/models/)：看 Basic model usage 和 Validating data 两部分。30 分钟。
- [Python 官方 asyncio 文档](https://docs.python.org/3/library/asyncio.html)：当参考手册查，不用通读。
- [FastAPI 文档：并发和 async/await（中文）](https://fastapi.tiangolo.com/zh/async/)：FastAPI 作者用汉堡店排队的比喻讲异步，是我见过最好懂的解释，W6 也会用到 FastAPI。**必看**，20 分钟。
- [httpx 文档](https://www.python-httpx.org/)：看 QuickStart 和 Async Support。
- [pytest 文档](https://docs.pytest.org/)：Get Started 一页就够。
- [Learn X in Y minutes: Python](https://learnxinyminutes.com/python/)：一页纸过完 Python 语法，适合有其他语言经验的人当速查表。
- [Claude Code 文档](https://code.claude.com/docs/en/overview)、[OpenAI Codex 文档](https://developers.openai.com/codex)、[Cursor 文档](https://cursor.com/docs)：三个主流 Coding Agent 的官方文档，挑你用的那个看入门部分，重点找「项目说明文件」（CLAUDE.md / AGENTS.md / rules）怎么写。
- [AGENTS.md](https://agents.md/)：一个给 Coding Agent 写项目说明的通用约定，多家工具都支持，10 分钟看完。
- [Python 官方教程（中文）](https://docs.python.org/zh-cn/3/tutorial/index.html)：语法细节查漏补缺。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1oa411b7c9&autoplay=0&high_quality=1" title="asyncio的理解与入门，搞不明白协程？看这个视频就够了。" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>码农高天 · 【python】asyncio的理解与入门，搞不明白协程？看这个视频就够了。 · 15 分钟。作者是 CPython 核心开发者，讲事件循环和 task 的关系讲得很透，看完再回来读上面的 async 一节。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1JKmeY9ED2&autoplay=0&high_quality=1" title="Pydantic 让数据结构与验证融为一体" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>隔壁的程序员老王 · [Python] Pydantic 让数据结构与验证融为一体 · 10 分钟，pydantic 基本用法，看完能直接上手今天的练习。</figcaption>
</figure>

- 武沛齐《python async 异步编程》（B 站搜标题，3 小时）：想系统学异步的可以看，今天不要求。

### 其他经典视频

- 这一天的内容 B 站资源已经足够。如果你更喜欢英文，YouTube 上搜「ArjanCodes pydantic」和「mCoding asyncio」，这两个频道讲 Python 工程实践很扎实。
- DeepLearning.AI 短课《Pydantic for LLM Workflows》（[课程页](https://www.deeplearning.ai/short-courses/pydantic-for-llm-workflows/)）：Day 6 讲结构化输出时会用，今天可以先看前三节了解 pydantic 在大模型场景的用法。

### 书籍

- 《流畅的 Python（第 2 版）》（Luciano Ramalho 著，人民邮电出版社，2023）：有经验的程序员学 Python 最好的书。今天读第 5 章「数据类构建器」（讲 dataclass 等），异步那章（第 21 章）留到 W6。
- 《Python 编程：从入门到实践（第 3 版）》（Eric Matthes 著，人民邮电出版社，2023）：如果你完全没碰过 Python，先花两小时翻前 8 章。

### 开源项目与代码

- [openai/openai-python](https://github.com/openai/openai-python)：OpenAI 官方 SDK 源码，看它怎么用 httpx 和 pydantic 构建的，是很好的 Python 工程范本。不用今天看，知道有这个参照。
- [pydantic/pydantic](https://github.com/pydantic/pydantic)：今天练习抓的仓库之一。

## 自测

1. `pyproject.toml`、`uv.lock`、`.venv/` 三个哪些该提交进 git？

<details><summary>答案</summary>

`pyproject.toml` 和 `uv.lock` 提交；`.venv/` 不提交。别人 clone 后运行 `uv sync` 会按 `uv.lock` 重新生成 `.venv`。

</details>

2. 下面这段代码运行时会报错吗？为什么？

```python
def add(a: int, b: int) -> int:
    return a + b

print(add("1", "2"))
```

<details><summary>答案</summary>

不会报错，输出 `12`。类型标注在运行时不做检查，两个字符串相加就是拼接。mypy 这类静态检查工具会提示类型不匹配。

</details>

3. 一个 Agent 一步里要调用三个互不依赖的工具，各耗时 2 秒、3 秒、1 秒。串行和用 `asyncio.gather` 并发，总耗时大概各是多少？

<details><summary>答案</summary>

串行约 6 秒，并发约 3 秒（最慢的那个）。前提是三个工具都是真正的异步 IO，如果其中一个内部调用了同步阻塞函数，会拖住其他协程。

</details>

4. 你在 async 函数里写了 `requests.get(url)`，程序能跑，但并发效果完全没出来。为什么？

<details><summary>答案</summary>

`requests` 是同步阻塞的，调用时整个事件循环被卡住，其他协程无法执行，等于又变成了串行。应该换成 `httpx.AsyncClient` 并 `await`。

</details>

5. 什么时候用 dataclass，什么时候用 pydantic？

<details><summary>答案</summary>

数据来自外部、不可信（HTTP 请求、模型输出、配置文件、第三方 API）时用 pydantic，它会校验并转换类型、给出清楚的错误。纯内部数据结构用 dataclass 就够，轻量、没有额外依赖。很多项目为了统一也全部用 pydantic。

</details>

6. 面试题：「Python 有 GIL，为什么 Agent 服务还能处理很多并发请求？」

<details><summary>答案</summary>

GIL 限制的是同一时刻只有一个线程执行 Python 字节码，影响的是 CPU 密集任务的并行。Agent 服务的时间绝大部分在等网络（模型 API、数据库、外部工具），属于 IO 密集。用 asyncio 时，一个协程在等 IO 的时候事件循环会去执行其他协程，所以单进程也能同时挂起成百上千个请求。真正需要 CPU 并行的部分（比如本地跑 embedding 模型）可以用多进程或交给外部服务。

</details>

7. 面试题：「你平时怎么用 Claude Code 或 Cursor 写代码？怎么保证它写的代码质量？」

<details><summary>答案</summary>

参考思路：给它小而明确的任务，一次一个函数或模块；在项目说明文件（CLAUDE.md / AGENTS.md）里写清楚约定（依赖管理、密钥、测试要求）；让它先写测试或者写完必须跑通测试；合并前按清单审查，重点看新增依赖、过时的 API、写死的密钥、被吞掉的异常、超出任务范围的改动；每一行都要能自己解释。最好举一个真实的例子：它写错了什么，你是怎么发现的。

</details>

## 明天预告

Day 3 · 第一次调用大模型 API：OpenAI 兼容协议，一份代码切换 DeepSeek、通义和 Claude。把一次 chat completions 请求和响应逐字段拆开讲，弄清楚 usage 怎么换算成钱、401 和 429 分别意味着什么、为什么几乎所有国产模型都兼容 OpenAI 的格式。
