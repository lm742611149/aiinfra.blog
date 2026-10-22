---
title: 'Day 44 · 小项目:命令行工单记事本'
description: '把这两周学的类、组合、property、JSON 和异常拼成一个真能用的命令行工具:add、list、show、close、delete、search 六个命令,工单存在 JSON 文件里,关掉终端再打开数据还在。顺带认识 sys.argv 和退出码,并亲手踩一次「删了一张再加一张,工单号重复了」的坑。'
pubDate: 2026-10-22
regime: none
tags: ['python', 'project', 'agent-zero']
series: 'agent-zero'
day: 44
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 43](/blog/agent-zero/day-043-classes-3/) 把 `ticket_model.py` 打磨了一遍:`__repr__` 让 Ticket 打印成 `Ticket(id='T-1001', ...)`,`__str__` 给人看的版本复用 summary;amount 换成 property,造完再改成负数也会被 setter 拦下;`is_closed` 是只读 property;`Ticket.from_dict` 是类方法,旧的 `ticket_from_dict` 保留成一行转发。改完以后 Day 41 的体检脚本重跑,结果一字不差。

到这里,一张工单该有的本事都有了。今天不学新概念,做一个小项目:命令行工单记事本。用 [Day 42](/blog/agent-zero/day-042-classes-2/) 的组合写一个「记事本」类,让它**有**一堆 Ticket 和一个 JSON 文件;再写一层命令分发,让你在终端里敲 `add`、`list`、`close` 就能管工单。

## 今天要解决的问题

学完今天,你应该能:

1. 用 `sys.argv` 读到命令行参数,说清带空格的参数为什么要加引号;用 `sys.exit` 让程序出错时返回非 0 的退出码。
2. 写一个用组合的 `TicketBook` 类:持有工单列表和文件路径,负责读、存、加、查、关、删、搜。
3. 解释「用张数加一生成工单号」为什么会在删除后撞号,并改成「取最大号加一」。
4. 拼出 `notebook.py`,六个命令全部跑通,每种错误输入都给出一句清楚的提示而不是一屏 traceback。

预计用时:3.5 小时。项目日比平时长,建议分两段:前三步 1.5 小时,拼大代码和练习 2 小时。前置:[Day 32](/blog/agent-zero/day-032-modules/) 的 import 和 `__name__`、[Day 36](/blog/agent-zero/day-036-exceptions-2/) 的 `raise ... from e`、[Day 37](/blog/agent-zero/day-037-pathlib/) 的 Path、[Day 39](/blog/agent-zero/day-039-json/) 的 JSON、[Day 42](/blog/agent-zero/day-042-classes-2/) 的组合、[Day 43](/blog/agent-zero/day-043-classes-3/) 改好的 `ticket_model.py`。

学法:先对照文章逐行敲一遍(不要复制粘贴)并跑通;第二天合上文章,把 `TicketBook` 类和 `run` 函数默写出来;再做动手练习,做不出来再展开参考答案,看完关掉自己重写一遍。

命令都在项目根目录 `agent-zero-lab` 里跑,新文件放进 `part01/`。会 import Day 43 改好的 `part01/ticket_model.py`(用到 `Ticket`、`TicketError`、`ticket_from_dict`、`is_closed`、`__str__`、`__repr__`),先确认它是 Day 43 的版本:`uv run python part01/ticket_model.py` 第一行应该打印出 `[Ticket(id='T-1001', ...`。今天不装新依赖,不调 API,花费 0 元。

## 先想清楚要做成什么样

动手前先把「用起来长什么样」写下来,这一步省不得。做前端时你也是先画原型再写组件。

| 命令 | 例子 | 做什么 |
| --- | --- | --- |
| add | `add 发票抬头开错了 199` | 新建一张工单,自动编号 |
| list | `list` | 列出全部,最后一行是汇总 |
| show | `show T-1005` | 看一张工单的全部字段 |
| close | `close T-1001` | 关闭,已关闭的不能再关 |
| delete | `delete T-1003` | 删除 |
| search | `search 套餐` | 按标题搜,不分大小写 |

数据存在 `part01/data/notebook.json`,格式和 Day 40 的 `tickets_v2.json` 一样,是一个工单字典组成的数组。每个命令跑完程序就结束,下一次运行从文件里读回来,所以**每个会改数据的命令最后都要存一次**。

出错时的规矩:不打印 traceback,打印一行「出错了: 原因」,退出码是 1。退出码是什么,第一步就讲。

<figure>
<svg viewBox="0 0 640 230" role="img" aria-label="终端参数经过 sys.argv 进入 main 和 run,run 调用 TicketBook 的方法,TicketBook 持有 Ticket 列表并读写 notebook.json">
<rect x="0" y="0" width="640" height="230" fill="var(--paper-raised)" rx="6"/>
<g font-family="var(--font-mono)" font-size="12">
<rect x="20" y="20" width="600" height="36" rx="4" fill="none" stroke="var(--rule)"/>
<text x="35" y="43" fill="var(--ink)">$ uv run python part01/notebook.py close T-1001</text>
<rect x="20" y="80" width="170" height="60" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="105" y="104" text-anchor="middle" fill="var(--ink)">main()</text>
<text x="105" y="124" text-anchor="middle" fill="var(--ink-soft)" font-size="11">接 TicketError,定退出码</text>
<rect x="235" y="80" width="170" height="60" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="320" y="104" text-anchor="middle" fill="var(--ink)">run(args, book)</text>
<text x="320" y="124" text-anchor="middle" fill="var(--ink-soft)" font-size="11">按命令分发</text>
<rect x="450" y="80" width="170" height="60" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="535" y="104" text-anchor="middle" fill="var(--ink)">TicketBook</text>
<text x="535" y="124" text-anchor="middle" fill="var(--ink-soft)" font-size="11">有 tickets 和 path</text>
<rect x="380" y="170" width="120" height="40" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="440" y="195" text-anchor="middle" fill="var(--ink)">Ticket × N</text>
<rect x="520" y="170" width="100" height="40" rx="4" fill="none" stroke="var(--rule)"/>
<text x="570" y="195" text-anchor="middle" fill="var(--ink-soft)" font-size="11">notebook.json</text>
<line x1="105" y1="56" x2="105" y2="80" stroke="var(--rule)"/>
<text x="115" y="72" fill="var(--ink-faint)" font-size="11">sys.argv[1:]</text>
<line x1="190" y1="110" x2="235" y2="110" stroke="var(--rule)"/>
<line x1="405" y1="110" x2="450" y2="110" stroke="var(--rule)"/>
<line x1="500" y1="140" x2="450" y2="170" stroke="var(--rule)"/>
<line x1="560" y1="140" x2="570" y2="170" stroke="var(--rule)"/>
</g>
</svg>
<figcaption>四层各管一件事:main 管退出码和报错,run 管「哪个命令做什么」,TicketBook 管工单列表和文件,Ticket 管一张工单自己的校验。</figcaption>
</figure>

## 第一步:sys.argv,程序怎么拿到命令行参数

今天唯一的新东西。你在 Node 里用过 `process.argv`:`node app.js add 发票 199` 跑起来,`process.argv` 是 `['/usr/local/bin/node', '/path/app.js', 'add', '发票', '199']`。Python 的对应物是 `sys` 模块里的 `argv`,`sys` 是 Python 自带的模块,管「和运行环境打交道」的事。新建 `part01/argv_demo.py`:

```python
# agent-zero-lab/part01/argv_demo.py
import sys

print(sys.argv)
print("一共", len(sys.argv), "项")
print("命令:", sys.argv[1:2])
print("参数:", sys.argv[2:])
```

<div class="line-notes">

- `import sys` 自带模块,不用 `uv add`。
- `print(sys.argv)` `sys.argv` 是一个字符串列表,第 0 项是脚本路径,后面是你在命令行上写的每一项。
- `print("一共", len(sys.argv), "项")` 项数。
- `print("命令:", sys.argv[1:2])` 用切片取第 1 项。用切片而不是 `sys.argv[1]`,是因为没给参数时 `[1]` 会抛 IndexError,切片只会得到空列表。
- `print("参数:", sys.argv[2:])` 第 2 项往后全部。

</div>

在项目根目录连跑四次,注意第二次和第三次的区别:

```bash
uv run python part01/argv_demo.py add 发票抬头开错了 199
uv run python part01/argv_demo.py add 升级套餐 年付 399
uv run python part01/argv_demo.py add "升级套餐 年付" 399
uv run python part01/argv_demo.py
```

实测输出:

```text
['part01/argv_demo.py', 'add', '发票抬头开错了', '199']
一共 4 项
命令: ['add']
参数: ['发票抬头开错了', '199']
['part01/argv_demo.py', 'add', '升级套餐', '年付', '399']
一共 5 项
命令: ['add']
参数: ['升级套餐', '年付', '399']
['part01/argv_demo.py', 'add', '升级套餐 年付', '399']
一共 4 项
命令: ['add']
参数: ['升级套餐 年付', '399']
['part01/argv_demo.py']
一共 1 项
命令: []
参数: []
```

三件事记下来:

- 和 Node 比,Python 的 argv 少了解释器那一项,第 0 项直接是脚本路径,所以真正的参数从 `sys.argv[1:]` 开始。
- **按空格切开的是终端(shell),不是 Python**。第二次「升级套餐 年付」被切成了两项,加上引号才是一项。[Day 3](/blog/agent-zero/day-003-terminal-1/) 学终端时见过,路径里有空格也要加引号,同一回事。
- 所有参数都是**字符串**,`'199'` 不是数字,要自己转。

再看退出码。每个程序结束时都会交给终端一个整数,0 表示成功,非 0 表示失败,`$?` 能看上一个命令的退出码。CI 流水线、脚本里的 `&&` 都靠它判断成没成功。Node 里写 `process.exit(1)`,Python 写 `sys.exit(1)`。新建 `part01/exit_demo.py`:

```python
# agent-zero-lab/part01/exit_demo.py
import sys

if len(sys.argv) < 2:
    print("缺参数")
    sys.exit(1)
print("收到", sys.argv[1])
```

<div class="line-notes">

- `if len(sys.argv) < 2:` 只有脚本路径一项,说明没给参数。
- `sys.exit(1)` 立刻结束程序,退出码 1。后面的 print 不会执行。
- `print("收到", sys.argv[1])` 程序正常走完,退出码默认是 0。

</div>

```bash
uv run python part01/exit_demo.py; echo "退出码 $?"
uv run python part01/exit_demo.py hi; echo "退出码 $?"
uv run python part01/exit_demo.py && echo "上一步成功才会跑我"
uv run python part01/exit_demo.py hi && echo "上一步成功才会跑我"
```

实测输出:

```text
缺参数
退出码 1
收到 hi
退出码 0
缺参数
收到 hi
上一步成功才会跑我
```

第三行命令后面的 echo 没执行,因为 `&&` 只在前一个命令退出码为 0 时才继续。你在 package.json 里写过 `"build": "tsc && vite build"`,tsc 报错时 vite 不会跑,原理一模一样。

## 第二步:TicketBook,一个用组合的记事本类

先不管命令行,也先不管文件,只做「一堆工单的增删查」。按 Day 42 的说法,记事本**有**很多工单,所以 TicketBook 不继承 Ticket,而是把工单列表存成自己的属性。新建 `part01/book_v1.py`:

```python
# agent-zero-lab/part01/book_v1.py
from ticket_model import Ticket, TicketError


class TicketBook:
    def __init__(self):
        self.tickets: list[Ticket] = []

    def next_id(self) -> str:
        return f"T-{1001 + len(self.tickets)}"

    def add(self, title: str, amount: float) -> Ticket:
        t = Ticket(self.next_id(), title, amount)
        self.tickets.append(t)
        return t

    def find(self, id: str) -> Ticket:
        for t in self.tickets:
            if t.id == id:
                return t
        raise TicketError(f"没有这张工单: {id}")

    def delete(self, id: str) -> Ticket:
        t = self.find(id)
        self.tickets.remove(t)
        return t


book = TicketBook()
book.add("发票抬头开错了", 199)
book.add("申请退款", 50)
book.add("升级套餐", 399)
print(book.tickets)

print("删掉", book.delete("T-1002").id)
print("新加", book.add("扣费两次", 99).id)
print([t.id for t in book.tickets])
print(book.find("T-1003"))
```

<div class="line-notes">

- `from ticket_model import Ticket, TicketError` Day 43 改好的版本。
- `self.tickets: list[Ticket] = []` 组合:记事本有一个工单列表。
- `def next_id(self) -> str:` 生成下一个工单号。
- `return f"T-{1001 + len(self.tickets)}"` 第一版的想法很直接:已经有几张,就编到 1001 加几。没有工单时是 T-1001,有 3 张时是 T-1004。
- `t = Ticket(self.next_id(), title, amount)` 造工单。标题空、金额负数都会在 Ticket 里被拦下,TicketBook 不用再查一遍。
- `self.tickets.append(t)` 校验通过才放进列表。
- `return t` 把新工单还给调用方,方便它打印。
- `def find(self, id: str) -> Ticket:` 按工单号找。
- `raise TicketError(f"没有这张工单: {id}")` 找不到就抛业务异常,而不是返回 None,调用方不用每次判断「是不是 None」。
- `self.tickets.remove(t)` Day 21 的 remove,按值删掉列表里的这个对象。
- `print(book.tickets)` 打印列表走 `__repr__`,三张工单都能看清。
- `print("删掉", book.delete("T-1002").id)` 删中间那张,实测 `删掉 T-1002`。
- `print("新加", book.add("扣费两次", 99).id)` 现在剩 2 张,`1001 + 2` 是 1003。实测 `新加 T-1003`。
- `print([t.id for t in book.tickets])` 实测 `['T-1001', 'T-1003', 'T-1003']`,**两张 T-1003**。
- `print(book.find("T-1003"))` find 返回第一个找到的,实测 `[open] T-1003 升级套餐 ¥399`。新加的「扣费两次」永远找不到,也关不掉、删不掉。

</div>

```bash
uv run python part01/book_v1.py
```

实测输出:

```text
[Ticket(id='T-1001', title='发票抬头开错了', amount=199, status='open'), Ticket(id='T-1002', title='申请退款', amount=50, status='open'), Ticket(id='T-1003', title='升级套餐', amount=399, status='open')]
删掉 T-1002
新加 T-1003
['T-1001', 'T-1003', 'T-1003']
[open] T-1003 升级套餐 ¥399
```

这个坑很典型,而且不报错。「张数加一」这个算法默认了一个前提:编号从来不会中间缺一个。只要支持删除,前提就不成立。

## 第三步:编号改成「最大号加一」

修法是每次看现有工单里最大的编号,在它上面加一。删掉的号就让它空着,不回收。数据库里的自增主键也是这么干的,[Day 91](/blog/agent-zero/day-091-sql-6/) 学主键时会再见到。先用几行验证一下要用的写法,新建 `part01/id_demo.py`:

```python
# agent-zero-lab/part01/id_demo.py
ids = ["T-1001", "T-1003"]
print("T-1003"[2:], int("T-1003"[2:]) + 1)
print(f"T-{1001 + len(ids)}")
biggest = max(int(i[2:]) for i in ids)
print(f"T-{biggest + 1}")
print(float("199").is_integer(), float("99.5").is_integer())
```

<div class="line-notes">

- `ids = ["T-1001", "T-1003"]` 删掉 T-1002 之后剩下的两个号。
- `print("T-1003"[2:], int("T-1003"[2:]) + 1)` Day 15 的切片,`[2:]` 去掉前两个字符 `T-`,得到 `'1003'`,`int()` 转成数字再加一。实测 `1003 1004`。
- `print(f"T-{1001 + len(ids)}")` 旧算法,实测 `T-1003`,撞号。
- `biggest = max(int(i[2:]) for i in ids)` 每个号都转成数字,取最大。`max(... for ...)` 是把推导式直接放进 max 的括号里,Day 40 练习 4 的 `sum(t.amount for t in good)` 是同一种写法。
- `print(f"T-{biggest + 1}")` 新算法,实测 `T-1004`。
- `print(float("199").is_integer(), float("99.5").is_integer())` 后面要用:命令行传进来的金额是字符串,`float()` 转完 199 会变成 199.0,Day 43 练习 4 就看到过 `amount=199.0`。`is_integer()` 是 float 的方法,问「这个小数是不是整数」,实测 `True False`。是整数就转回 int,显示成 `¥199` 而不是 `¥199.0`。

</div>

```bash
uv run python part01/id_demo.py
```

实测输出:

```text
1003 1004
T-1003
T-1004
True False
```

## 把零件拼起来:notebook.py

现在把 TicketBook 补全(加上读写文件、关闭、搜索),再写命令分发和 main。新建 `part01/notebook.py`:

```python
# agent-zero-lab/part01/notebook.py
import json
import sys
from pathlib import Path

from ticket_model import Ticket, TicketError, ticket_from_dict

BOOK = Path(__file__).resolve().parent / "data" / "notebook.json"

USAGE = """用法: uv run python part01/notebook.py 命令 [参数]
  add 标题 金额      新建工单
  list               列出全部
  show 工单号        看一张的全部字段
  close 工单号       关闭
  delete 工单号      删除
  search 关键词      按标题搜索"""


class TicketBook:
    def __init__(self, path: Path):
        self.path = path
        self.tickets: list[Ticket] = []
        if path.exists():
            self.load()

    def load(self) -> None:
        try:
            data = json.loads(self.path.read_text(encoding="utf-8"))
        except json.JSONDecodeError as e:
            raise TicketError(f"记事本文件坏了({self.path.name}): {e.msg}") from e
        self.tickets = [ticket_from_dict(d) for d in data]

    def save(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        data = [t.to_dict() for t in self.tickets]
        self.path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")

    def next_id(self) -> str:
        if not self.tickets:
            return "T-1001"
        biggest = max(int(t.id[2:]) for t in self.tickets)
        return f"T-{biggest + 1}"

    def add(self, title: str, amount: float) -> Ticket:
        t = Ticket(self.next_id(), title, amount)
        self.tickets.append(t)
        return t

    def find(self, id: str) -> Ticket:
        for t in self.tickets:
            if t.id == id:
                return t
        raise TicketError(f"没有这张工单: {id}")

    def close(self, id: str) -> Ticket:
        t = self.find(id)
        if t.is_closed:
            raise TicketError(f"{id} 已经关闭过了")
        t.close()
        return t

    def delete(self, id: str) -> Ticket:
        t = self.find(id)
        self.tickets.remove(t)
        return t

    def search(self, word: str) -> list[Ticket]:
        return [t for t in self.tickets if word.lower() in t.title.lower()]


def parse_amount(text: str) -> float:
    try:
        amount = float(text)
    except ValueError as e:
        raise TicketError(f"金额不是数字: {text!r}") from e
    return int(amount) if amount.is_integer() else amount


def need(args: list[str], n: int, usage: str) -> None:
    if len(args) != n:
        raise TicketError(f"参数个数不对,应该是: {usage}")


def run(args: list[str], book: TicketBook) -> str:
    if not args:
        return USAGE
    cmd, rest = args[0], args[1:]
    if cmd == "add":
        need(rest, 2, "add 标题 金额")
        t = book.add(rest[0], parse_amount(rest[1]))
        book.save()
        return f"已添加 {t}"
    if cmd == "list":
        need(rest, 0, "list")
        if not book.tickets:
            return "记事本是空的"
        lines = [str(t) for t in book.tickets]
        total = sum(t.amount for t in book.tickets)
        open_count = len([t for t in book.tickets if not t.is_closed])
        lines.append(f"共 {len(book.tickets)} 张,未关闭 {open_count} 张,金额合计 ¥{total}")
        return "\n".join(lines)
    if cmd == "show":
        need(rest, 1, "show 工单号")
        return repr(book.find(rest[0]))
    if cmd == "close":
        need(rest, 1, "close 工单号")
        t = book.close(rest[0])
        book.save()
        return f"已关闭 {t}"
    if cmd == "delete":
        need(rest, 1, "delete 工单号")
        t = book.delete(rest[0])
        book.save()
        return f"已删除 {t}"
    if cmd == "search":
        need(rest, 1, "search 关键词")
        found = book.search(rest[0])
        if not found:
            return f"没有标题包含「{rest[0]}」的工单"
        return "\n".join(str(t) for t in found)
    raise TicketError(f"不认识的命令: {cmd}\n{USAGE}")


def main() -> int:
    try:
        book = TicketBook(BOOK)
        print(run(sys.argv[1:], book))
    except TicketError as e:
        print("出错了:", e)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

<div class="line-notes">

- `from ticket_model import Ticket, TicketError, ticket_from_dict` 三个名字都是 Day 40 起就有的,Day 43 改造时特意保留了。
- `BOOK = Path(__file__).resolve().parent / "data" / "notebook.json"` Day 37 的写法,不管在哪个目录运行,文件都在 `part01/data/` 下面。
- `USAGE = """用法:` 三个引号的字符串可以跨多行,换行原样保留,相当于 JS 的反引号模板字符串(只是不能插值)。
- `def __init__(self, path: Path):` 造记事本时传文件路径进来,而不是在类里写死 BOOK。练习 3 会用另一个路径造一个记事本,就靠这个。
- `self.tickets: list[Ticket] = []` 先给一个空列表。
- `if path.exists():` 第一次运行时文件还不存在,不读,直接当空记事本。
- `self.load()` 文件在就读进来。
- `data = json.loads(self.path.read_text(encoding="utf-8"))` Day 39 的读法。
- `except json.JSONDecodeError as e:` 文件被人手改坏了。
- `raise TicketError(f"记事本文件坏了({self.path.name}): {e.msg}") from e` Day 36 的翻译:把 JSON 的错误变成我们的业务异常,main 只需要接 TicketError 一种。`self.path.name` 是文件名 `notebook.json`。
- `self.tickets = [ticket_from_dict(d) for d in data]` 每个字典变回 Ticket,金额、标题都会再过一遍校验。
- `self.path.parent.mkdir(parents=True, exist_ok=True)` 存之前确保 `data/` 目录在,Day 37 学的。
- `data = [t.to_dict() for t in self.tickets]` 对外格式只认 to_dict,Day 43 讲过别用 vars。
- `self.path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")` 整个文件重写,用 write_text(`"w"`)而不是 `"a"`,Day 39 讲过往 JSON 文件追加会得到 `Extra data`。
- `if not self.tickets:` 空列表在 if 里算假,Day 17 学的真值。
- `return "T-1001"` 空记事本从 T-1001 开始。
- `biggest = max(int(t.id[2:]) for t in self.tickets)` 第三步验证过的写法。
- `return f"T-{biggest + 1}"` 删了 T-1003 后再加,得到的是 T-1005 而不是 T-1004。
- `def close(self, id: str) -> Ticket:` 比 Ticket 自己的 close 多一道检查。
- `if t.is_closed:` Day 43 的只读 property,不加括号。
- `raise TicketError(f"{id} 已经关闭过了")` 重复关闭当成错误,和 Day 42 的 NotifyCenter 一个思路。
- `t.close()` 真正改状态的还是 Ticket 自己。
- `return [t for t in self.tickets if word.lower() in t.title.lower()]` Day 23 的推导式加筛选。两边都 `.lower()`,搜 `api` 也能找到 `API 调用超额`。中文没有大小写,lower 对中文不起作用,也不会出错。
- `def parse_amount(text: str) -> float:` 命令行进来的金额是字符串,这里转成数字。
- `amount = float(text)` `"五十"` 会抛 ValueError。
- `raise TicketError(f"金额不是数字: {text!r}") from e` `!r` 给原文加上引号,看得出用户到底输了什么。
- `return int(amount) if amount.is_integer() else amount` 整数就转回 int。返回类型写 float,是因为类型检查器认为 int 可以当 float 用。负数在这里不管,交给 Ticket 的 setter。
- `def need(args: list[str], n: int, usage: str) -> None:` 检查参数个数的小函数,六个命令都要用,抽出来只写一次。
- `raise TicketError(f"参数个数不对,应该是: {usage}")` 顺便告诉用户正确的写法。
- `def run(args: list[str], book: TicketBook) -> str:` 收参数列表和记事本,**返回**要打印的文字,自己不 print。这样练习里可以在别的文件调它,也方便以后写测试。
- `if not args:` 什么命令都没给。
- `return USAGE` 打印用法,这不算错误,退出码 0。
- `cmd, rest = args[0], args[1:]` Day 22 的解包,第一项是命令,剩下的是参数。
- `need(rest, 2, "add 标题 金额")` add 必须正好两个参数。标题带空格要加引号,第一步讲过。
- `t = book.add(rest[0], parse_amount(rest[1]))` 先转金额,再交给记事本。
- `book.save()` 会改数据的命令,最后都要存。
- `return f"已添加 {t}"` f-string 里的 `{t}` 走 `__str__`。
- `need(rest, 0, "list")` list 不收参数。少了这一行,`list --by-title` 这种写错的命令会被悄悄当成 list 执行,练习 4 会遇到。
- `lines = [str(t) for t in book.tickets]` 每张一行,`str(t)` 走 `__str__`。
- `total = sum(t.amount for t in book.tickets)` 金额合计。
- `open_count = len([t for t in book.tickets if not t.is_closed])` 未关闭的张数。
- `return "\n".join(lines)` Day 16 的 join,用换行把多行拼成一个字符串。
- `return repr(book.find(rest[0]))` show 要看全部字段,用 `__repr__` 正合适。
- `t = book.close(rest[0])` 找不到或已关闭都会抛 TicketError。
- `t = book.delete(rest[0])` 删除。
- `found = book.search(rest[0])` 搜索。
- `return f"没有标题包含「{rest[0]}」的工单"` 搜不到不算错误,给一句提示。
- `raise TicketError(f"不认识的命令: {cmd}\n{USAGE}")` 命令拼错了,报错后面附上用法。
- `def main() -> int:` 返回退出码。
- `book = TicketBook(BOOK)` 文件坏了会在这里抛,所以它也放在 try 里面。
- `print(run(sys.argv[1:], book))` 去掉脚本路径那一项,剩下的交给 run。
- `except TicketError as e:` 所有业务错误统一在这里接住。别的异常(比如程序 bug)不接,让它照常打出 traceback,方便你修。
- `print("出错了:", e)` 一行说清楚。
- `return 1` 出错退出码 1。
- `sys.exit(main())` main 返回几,程序就以几退出。

</div>

### 从空记事本开始跑一遍

先确认没有旧文件,然后按顺序敲(建议一条一条敲,看着文件一点点变化):

```bash
rm -f part01/data/notebook.json
uv run python part01/notebook.py add 发票抬头开错了 199
uv run python part01/notebook.py add "升级套餐 年付" 399
uv run python part01/notebook.py add 申请退款 50
uv run python part01/notebook.py add 扣费两次 99.5
uv run python part01/notebook.py list
uv run python part01/notebook.py delete T-1003
uv run python part01/notebook.py add "API 调用超额" 120
uv run python part01/notebook.py close T-1001
uv run python part01/notebook.py close T-1001; echo "exit=$?"
uv run python part01/notebook.py search 套餐
uv run python part01/notebook.py search api
uv run python part01/notebook.py show T-1005
uv run python part01/notebook.py list
```

实测输出:

```text
已添加 [open] T-1001 发票抬头开错了 ¥199
已添加 [open] T-1002 升级套餐 年付 ¥399
已添加 [open] T-1003 申请退款 ¥50
已添加 [open] T-1004 扣费两次 ¥99.5
[open] T-1001 发票抬头开错了 ¥199
[open] T-1002 升级套餐 年付 ¥399
[open] T-1003 申请退款 ¥50
[open] T-1004 扣费两次 ¥99.5
共 4 张,未关闭 4 张,金额合计 ¥747.5
已删除 [open] T-1003 申请退款 ¥50
已添加 [open] T-1005 API 调用超额 ¥120
已关闭 [closed] T-1001 发票抬头开错了 ¥199
出错了: T-1001 已经关闭过了
exit=1
[open] T-1002 升级套餐 年付 ¥399
[open] T-1005 API 调用超额 ¥120
Ticket(id='T-1005', title='API 调用超额', amount=120, status='open')
[closed] T-1001 发票抬头开错了 ¥199
[open] T-1002 升级套餐 年付 ¥399
[open] T-1004 扣费两次 ¥99.5
[open] T-1005 API 调用超额 ¥120
共 4 张,未关闭 3 张,金额合计 ¥817.5
```

几个地方对一下:删掉 T-1003 后新加的是 **T-1005**,第三步的修复生效了;199 显示成 `¥199` 而 99.5 保留小数,`parse_amount` 起作用了;`search api` 找到了大写的 API;第二次关闭 T-1001 退出码是 1。每条命令都是一次独立运行,数据全靠文件串起来。看看文件:

```bash
cat part01/data/notebook.json
```

实测是四个工单对象组成的数组,T-1001 的 status 是 `"closed"`,T-1004 的 amount 是 `99.5`,其余金额是整数,中文原样(`ensure_ascii=False`)。不带参数运行 `uv run python part01/notebook.py` 会打印 USAGE 那段用法,实测退出码 0。

### 故意输错,看提示

这个工具的一半价值在于出错时说人话。挨个试:

```bash
uv run python part01/notebook.py add 申请退款 五十
uv run python part01/notebook.py add 申请退款 -50
uv run python part01/notebook.py add "   " 50
uv run python part01/notebook.py add 申请退款
uv run python part01/notebook.py show T-9999
uv run python part01/notebook.py remove T-1002
```

实测输出(每一条的退出码都是 1):

```text
出错了: 金额不是数字: '五十'
出错了: T-1006 金额不能是负数: -50
出错了: T-1006 标题是空的
出错了: 参数个数不对,应该是: add 标题 金额
出错了: 没有这张工单: T-9999
出错了: 不认识的命令: remove
用法: uv run python part01/notebook.py 命令 [参数]
  add 标题 金额      新建工单
  list               列出全部
  show 工单号        看一张的全部字段
  close 工单号       关闭
  delete 工单号      删除
  search 关键词      按标题搜索
```

负数和空标题是 Day 43 的 Ticket 拦下的,notebook.py 里一行校验都没写。报错里的 T-1006 是「本来要分给它的号」,工单没造出来,文件里也没有它,下一次 add 照样拿到 T-1006。

最后试一下文件坏了的情况。先备份,再往文件里写一个带尾逗号的假 JSON:

```bash
cp part01/data/notebook.json part01/data/notebook.bak
printf '[{"id": "T-1001", "title": "发票抬头开错了", "amount": 199,}]' > part01/data/notebook.json
uv run python part01/notebook.py list
cp part01/data/notebook.bak part01/data/notebook.json
```

实测输出:

```text
出错了: 记事本文件坏了(notebook.json): Expecting property name enclosed in double quotes
```

`printf` 和 [Day 5](/blog/agent-zero/day-005-terminal-3/) 的 `>` 重定向配合,把一段文字原样写进文件。最后一行把备份拷回来,后面的练习要用这份数据。

零件对照:

| 这两周的零件 | 在 notebook.py 里是哪一段 |
| --- | --- |
| 第一步 sys.argv、sys.exit | `run(sys.argv[1:], book)`、`sys.exit(main())` |
| 第二、三步 TicketBook、最大号加一 | `class TicketBook`、`next_id` |
| Day 42 组合 | TicketBook 持有 `self.tickets` 和 `self.path` |
| Day 43 `__str__` / `__repr__` | list 和 add 的输出用 str,show 用 repr |
| Day 43 property | close 里的 `t.is_closed`;负数金额由 setter 拦 |
| Day 43 / Day 40 from_dict、to_dict | load 和 save |
| Day 39 JSON、Day 37 Path | load、save、BOOK |
| Day 36 TicketError、`raise ... from e` | load 和 parse_amount 把底层错误翻译成 TicketError |
| Day 32 `__name__` | 最后的 main guard,练习里要 import 这个文件 |

## 动手练习

四道题都不改 `notebook.py`,而是新建一个文件 import 它的 `run`,在它前面加自己的命令,不认识的再交给原来的 run。这也是一种组合:新代码用旧代码,而不是去改它。做之前确认 `part01/data/notebook.json` 是上面跑完的那四张工单。

**练习 1:stats 命令。** 加一个 `stats` 命令,打印未关闭和已关闭各几张、各多少钱,以及金额最大的那张。文件名 `part01/ex44_stats.py`。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part01/ex44_stats.py
import sys

from notebook import BOOK, TicketBook, run
from ticket_model import TicketError


def stats(book: TicketBook) -> str:
    if not book.tickets:
        return "记事本是空的"
    open_list = [t for t in book.tickets if not t.is_closed]
    closed_list = [t for t in book.tickets if t.is_closed]
    biggest = max(book.tickets, key=lambda t: t.amount)
    return (
        f"未关闭 {len(open_list)} 张 ¥{sum(t.amount for t in open_list)}\n"
        f"已关闭 {len(closed_list)} 张 ¥{sum(t.amount for t in closed_list)}\n"
        f"金额最大: {biggest}"
    )


def run2(args: list[str], book: TicketBook) -> str:
    if args and args[0] == "stats":
        return stats(book)
    return run(args, book)


if __name__ == "__main__":
    try:
        print(run2(sys.argv[1:], TicketBook(BOOK)))
    except TicketError as e:
        print("出错了:", e)
        sys.exit(1)
```

<div class="line-notes">

- `from notebook import BOOK, TicketBook, run` 复用正文的三样东西。notebook.py 有 main guard,import 时不会执行它的 main。
- `open_list = [t for t in book.tickets if not t.is_closed]` 未关闭的。
- `closed_list = [t for t in book.tickets if t.is_closed]` 已关闭的。
- `biggest = max(book.tickets, key=lambda t: t.amount)` Day 40 练习 2 用过的 `max(..., key=...)`,按金额比,返回的是那张 Ticket 本身。
- `return (` 括号里几个 f-string 挨着写,Python 会自动把它们拼成一个字符串,方便分行写长字符串。
- `f"金额最大: {biggest}"` 走 `__str__`。
- `if args and args[0] == "stats":` 先确认 args 不是空的,再看第一项。顺序不能反,空列表取 `[0]` 会抛 IndexError,`and` 前面为假时后面不会执行。
- `return run(args, book)` 不是 stats 就交给原来的 run,原来的六个命令照常能用。
- `print(run2(sys.argv[1:], TicketBook(BOOK)))` 和正文 main 一样的结构。
- `sys.exit(1)` 出错退出码 1。

</div>

```bash
uv run python part01/ex44_stats.py stats
uv run python part01/ex44_stats.py list
```

实测输出:

```text
未关闭 3 张 ¥618.5
已关闭 1 张 ¥199
金额最大: [open] T-1002 升级套餐 年付 ¥399
[closed] T-1001 发票抬头开错了 ¥199
[open] T-1002 升级套餐 年付 ¥399
[open] T-1004 扣费两次 ¥99.5
[open] T-1005 API 调用超额 ¥120
共 4 张,未关闭 3 张,金额合计 ¥817.5
```

399 + 99.5 + 120 = 618.5,加上已关闭的 199 就是 817.5,和 list 的合计对得上。

</details>

**练习 2:改金额。** 加一个 `amount 工单号 新金额` 命令,打印「旧金额 -> 新金额」并存盘。再试一次改成 -1,确认会被拦住、文件里的金额没变。文件名 `part01/ex44_amount.py`。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part01/ex44_amount.py
import sys

from notebook import BOOK, TicketBook, parse_amount, run
from ticket_model import TicketError


def run2(args: list[str], book: TicketBook) -> str:
    if args and args[0] == "amount":
        if len(args) != 3:
            raise TicketError("参数个数不对,应该是: amount 工单号 新金额")
        t = book.find(args[1])
        old = t.amount
        t.amount = parse_amount(args[2])
        book.save()
        return f"{t.id} 金额 ¥{old} -> ¥{t.amount}"
    return run(args, book)


if __name__ == "__main__":
    try:
        print(run2(sys.argv[1:], TicketBook(BOOK)))
    except TicketError as e:
        print("出错了:", e)
        sys.exit(1)
```

<div class="line-notes">

- `from notebook import BOOK, TicketBook, parse_amount, run` parse_amount 也复用。
- `if len(args) != 3:` 命令本身加两个参数,一共 3 项。
- `t = book.find(args[1])` 找不到会抛 TicketError。
- `old = t.amount` 先记下旧值。
- `t.amount = parse_amount(args[2])` 这一行走 Day 43 的 setter。负数在这里就抛异常,下面的 save 不会执行,文件不会被改。
- `book.save()` 改成功才存。
- `return f"{t.id} 金额 ¥{old} -> ¥{t.amount}"` T-1004 改成 89.5,实测 `T-1004 金额 ¥99.5 -> ¥89.5`。

</div>

```bash
uv run python part01/ex44_amount.py amount T-1004 89.5
uv run python part01/ex44_amount.py amount T-1004 -1; echo "exit=$?"
uv run python part01/notebook.py show T-1004
```

实测输出:

```text
T-1004 金额 ¥99.5 -> ¥89.5
出错了: T-1004 金额不能是负数: -1
exit=1
Ticket(id='T-1004', title='扣费两次', amount=89.5, status='open')
```

如果 Day 43 没有把 amount 换成 property,第二条命令会把 -1 存进文件,下次一读,`ticket_from_dict` 就会抛 TicketError,整个记事本都打不开。setter 把这种坏数据挡在了写入之前。

</details>

**练习 3:观察会发生什么,然后修好。** 有人手改 notebook.json 时删掉了一个 amount 字段。先猜 `list` 会输出什么,再用下面的命令试(先备份,试完还原):

```bash
cp part01/data/notebook.json part01/data/notebook.bak
printf '[{"id": "T-1001", "title": "发票抬头开错了"}]' > part01/data/notebook.json
uv run python part01/notebook.py list
cp part01/data/notebook.bak part01/data/notebook.json
```

然后不改 notebook.py,写一个继承 TicketBook 的 `SafeBook`,让缺字段也变成一句「出错了」。文件名 `part01/ex44_safe.py`,它用一个单独的 `part01/data/notebook_broken.json` 来演示,不碰正式数据。

<details><summary>参考答案</summary>

实测 `list` 的输出是一屏 traceback:

```text
Traceback (most recent call last):
  File ".../agent-zero-lab/part01/notebook.py", line 135, in <module>
    sys.exit(main())
             ^^^^^^
  File ".../agent-zero-lab/part01/notebook.py", line 126, in main
    book = TicketBook(BOOK)
           ^^^^^^^^^^^^^^^^
  File ".../agent-zero-lab/part01/notebook.py", line 24, in __init__
    self.load()
  File ".../agent-zero-lab/part01/notebook.py", line 31, in load
    self.tickets = [ticket_from_dict(d) for d in data]
                    ^^^^^^^^^^^^^^^^^^^
  File ".../agent-zero-lab/part01/ticket_model.py", line 57, in ticket_from_dict
    return Ticket.from_dict(d)
           ^^^^^^^^^^^^^^^^^^^
  File ".../agent-zero-lab/part01/ticket_model.py", line 53, in from_dict
    return cls(d["id"], d["title"], d["amount"], d.get("status", "open"))
                                    ~^^^^^^^^^^
KeyError: 'amount'
```

main 只接 TicketError,KeyError 没人接,一路飞到最外面。从下往上读(Day 35 教的读法):最底下是 from_dict 里 `d["amount"]` 取不到,往上是 load。Day 41 的体检脚本处理过同样的问题,办法是在读的地方把 KeyError 翻译成 TicketError。

```python
# agent-zero-lab/part01/ex44_safe.py
import sys
from pathlib import Path

from notebook import TicketBook, run
from ticket_model import TicketError

BROKEN = Path(__file__).resolve().parent / "data" / "notebook_broken.json"


class SafeBook(TicketBook):
    def load(self) -> None:
        try:
            super().load()
        except KeyError as e:
            raise TicketError(f"记事本文件缺字段 {e}({self.path.name})") from e


if __name__ == "__main__":
    BROKEN.write_text('[{"id": "T-1001", "title": "发票抬头开错了"}]', encoding="utf-8")
    try:
        print(run(sys.argv[1:], SafeBook(BROKEN)))
    except TicketError as e:
        print("出错了:", e)
        sys.exit(1)
```

<div class="line-notes">

- `BROKEN = Path(__file__).resolve().parent / "data" / "notebook_broken.json"` 单独一个文件,不碰正式数据。这里就用上了 TicketBook 收 path 参数的好处。
- `class SafeBook(TicketBook):` 「安全的记事本是一种记事本」,用继承,只重写 load。
- `def load(self) -> None:` 重写父类的 load。TicketBook 的 `__init__` 里调的是 `self.load()`,self 是 SafeBook,所以会调到这个版本(Day 42 练习 2 的道理)。
- `super().load()` 读文件和解析的活还交给父类,不复制代码。
- `except KeyError as e:` 只多接一种异常。
- `raise TicketError(f"记事本文件缺字段 {e}({self.path.name})") from e` `str(e)` 是带引号的键名,实测得到 `记事本文件缺字段 'amount'(notebook_broken.json)`。
- `BROKEN.write_text(` 每次运行先造一个坏文件。
- `print(run(sys.argv[1:], SafeBook(BROKEN)))` 换成 SafeBook,run 一行不用改,它只要求传进来的东西有 tickets、add、find 这些。

</div>

```bash
uv run python part01/ex44_safe.py list; echo "exit=$?"
```

实测输出:

```text
出错了: 记事本文件缺字段 'amount'(notebook_broken.json)
exit=1
```

真要修正式代码,把 `except KeyError` 这一段直接加进 notebook.py 的 load 里就行,和 json.JSONDecodeError 那段并排。

</details>

**练习 4:按金额排序。** 加一个 `list --by-amount`,按金额从大到小列出,金额右对齐。再试一下 `list --by-title`(没实现的写法),看看会发生什么。文件名 `part01/ex44_sort.py`。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part01/ex44_sort.py
import sys

from notebook import BOOK, TicketBook, run
from ticket_model import TicketError


def run2(args: list[str], book: TicketBook) -> str:
    if args == ["list", "--by-amount"]:
        ordered = sorted(book.tickets, key=lambda t: t.amount, reverse=True)
        return "\n".join(f"¥{t.amount:>6}  {t.id} {t.title}" for t in ordered)
    return run(args, book)


if __name__ == "__main__":
    try:
        print(run2(sys.argv[1:], TicketBook(BOOK)))
    except TicketError as e:
        print("出错了:", e)
        sys.exit(1)
```

<div class="line-notes">

- `if args == ["list", "--by-amount"]:` 列表可以直接用 `==` 比较内容,两项都对上才算。JS 里 `[1] === [1]` 是 false,Python 的 `==` 比的是内容。
- `ordered = sorted(book.tickets, key=lambda t: t.amount, reverse=True)` Day 21 的 sorted,按金额,`reverse=True` 从大到小。sorted 返回新列表,不改 book.tickets 的顺序,所以不需要存盘。
- `f"¥{t.amount:>6}  {t.id} {t.title}"` f-string 里冒号后面是格式说明,`>6` 表示「占 6 格、靠右」,金额就对齐了。
- `return run(args, book)` 其他情况交给原来的 run,`list --by-title` 也会走到这里。

</div>

```bash
uv run python part01/ex44_sort.py list --by-amount
uv run python part01/ex44_sort.py list --by-title; echo "exit=$?"
```

实测输出(T-1004 是练习 2 改过的 89.5):

```text
¥   399  T-1002 升级套餐 年付
¥   199  T-1001 发票抬头开错了
¥   120  T-1005 API 调用超额
¥  89.5  T-1004 扣费两次
出错了: 参数个数不对,应该是: list
exit=1
```

`--by-title` 被正文 run 里的 `need(rest, 0, "list")` 拦下了。我第一版写 notebook.py 时没有这一行,结果 `list --by-title` 实测原样打出了普通列表、退出码 0,用户会以为排过序了。**多余的参数要报错,不能悄悄忽略**,这条在以后写 Agent 工具时同样适用:模型传了你不认识的参数,默默吞掉比报错更难查。

</details>

验收标准:正文那一串命令从空文件开始跑,输出和上面逐行一致;四个练习的输出和上面一致;不看文章能写出 TicketBook 的 `__init__`、load、save、next_id;能说清删除后为什么不能用「张数加一」编号;能说出退出码 0 和 1 分别代表什么,以及 `&&` 怎么用它。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 命令行参数 | 运行程序时写在后面的那些词,`notebook.py add 发票 199` 里的 add、发票、199 |
| sys | Python 自带模块,管和运行环境有关的事,今天用了 argv 和 exit |
| sys.argv | 命令行参数组成的字符串列表,第 0 项是脚本路径,≈ Node 的 `process.argv`(少了解释器那一项) |
| 退出码(exit code) | 程序结束时交给终端的整数,0 成功、非 0 失败,`echo $?` 查看 |
| sys.exit | 立刻结束程序并给出退出码,≈ Node 的 `process.exit` |
| `&&` | 终端里「前一个成功(退出码 0)才执行后一个」 |
| 命令分发 | 根据第一个参数决定调哪段代码,今天的 run 函数 |
| 自增编号 | 新记录的编号取已有最大号加一,删掉的号不回收 |
| `"""..."""` | 三引号字符串,可以跨多行 |
| `is_integer()` | float 的方法,判断小数是不是整数,`99.5` 是 False |
| `:>6` | f-string 格式说明,占 6 格靠右对齐 |
| printf | 终端命令,把一段文字原样输出,配合 `>` 写文件 |

## 常见误区

**用张数加一生成编号。** 删掉中间一张再加,实测得到 `['T-1001', 'T-1003', 'T-1003']`,新工单永远找不到。用最大号加一。

**标题带空格不加引号。** `add 升级套餐 年付 399` 实测被切成三个参数,报「参数个数不对」。切参数的是终端,要整体传就加引号。

**忘了参数都是字符串。** `sys.argv` 里的 `'199'` 不能直接比大小、做加法,先 `float()`,转不了的翻译成 TicketError。

**改了数据忘了 save。** 每次命令都是一次新运行,内存里的改动程序一退出就没了。练习 2 的改金额就是先改后存,而且只在改成功后存。

**在 except 里什么异常都接。** main 只接 TicketError,真正的程序 bug(比如练习 3 的 KeyError)会照常打出 traceback,你才知道哪里要补。全写成 `except Exception` 会把 bug 也藏成一句「出错了」。

**多余的参数悄悄忽略。** `list --by-title` 被当成 list 执行,用户以为排过序了。每个命令都检查参数个数。

**出错了退出码还是 0。** 只 print 一句「出错了」不够,脚本和 CI 是看退出码判断成败的,`return 1` 加 `sys.exit(main())` 才完整。

**手改 JSON 文件不备份。** 今天演示坏文件时都先 `cp` 了一份。数据文件在以后的项目里会换成数据库,但「动数据前先备份」这个习惯一直有用。

## 学习资料

### 文档与文章

- [Python 标准库 · sys(中文)](https://docs.python.org/zh-cn/3.12/library/sys.html):看 `sys.argv` 和 `sys.exit` 两条,exit 那条原话是「shell 等将 0 视为“成功终止”,非零值视为“异常终止”」,还提到 Unix 程序通常用 2 表示命令行语法错误、用 1 表示其他错误。
- [Node.js 文档 · process.argv](https://nodejs.org/api/process.html#processargv):你熟悉的那一边,对照着看两者第 0 项的区别。
- [Python 官方教程 · 10.3 命令行参数(中文)](https://docs.python.org/zh-cn/3.12/tutorial/stdlib.html):标准库简介里讲 sys.argv 的一小节,结尾提到了 argparse。参数一多,手写 `need` 会越来越累,那时就该换 argparse。
- [Real Python · Python Command-Line Arguments](https://realpython.com/python-command-line-arguments/):英文长文,从 sys.argv 讲到 argparse,今天看前三分之一就够(对爬虫返回 403,需浏览器打开)。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1Kg411U7Uw&autoplay=0&high_quality=1" title="python基础-命令行及sys.argv" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>阿尔卑斯面 · python基础-命令行及sys.argv · 约 7 分钟,专讲第一步的 sys.argv。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1Wf4y1R7W4&autoplay=0&high_quality=1" title="Python基础之标准库sys" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>程序员在思考 · Python基础之标准库sys · 约 17 分钟,sys 模块的概览,argv 和 exit 之外的部分了解即可。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/rJCl7t3IIbA" title="Run Python Scripts With Command Line Arguments Using sys.argv (With Examples)" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Fabio Musanni · Run Python Scripts With Command Line Arguments Using sys.argv (With Examples) · 英文,用几个小脚本演示 sys.argv,和第一步的 argv_demo 是同一个套路。</figcaption>
</figure>

### 书籍

- 《Python 编程快速上手:让繁琐工作自动化(第 2 版)》,Al Sweigart 著,人民邮电出版社。书里好几个小项目都是「读 sys.argv、做一件事、退出」的命令行小工具,比如第 6 章末尾的多重剪贴板,和今天的记事本是同一种形状,可以拿来对照着再做一个。
- 《Python 编程:从入门到实践(第 3 版)》,Eric Matthes 著,人民邮电出版社。第 10 章「文件和异常」最后用 JSON 存用户数据那一段,和今天 load / save 的思路一样,可以当复习。

### 开源项目与代码

- [CPython · `Lib/json/tool.py`](https://github.com/python/cpython/blob/3.12/Lib/json/tool.py):你敲 `python -m json.tool 文件名` 格式化 JSON 时跑的就是它。不到 100 行,结构和今天一样:一个 main 读命令行参数、做事、出错时给一句提示并以非 0 退出。它读参数用的是 argparse(`argparse.ArgumentParser`),正好看看参数多了以后正规的写法长什么样。

## 自测

1. 运行 `uv run python part01/notebook.py add "API 调用超额" 120` 时,`sys.argv` 是什么?`sys.argv[1:]` 是什么?

<details><summary>答案</summary>

`sys.argv` 是 `['part01/notebook.py', 'add', 'API 调用超额', '120']`,`sys.argv[1:]` 是 `['add', 'API 调用超额', '120']`。引号让「API 调用超额」成为一项,120 是字符串。

</details>

2. 现有工单 T-1001、T-1002、T-1004,用正文的 next_id 加一张新的,编号是多少?用 Day 44 第二步那个旧算法呢?

<details><summary>答案</summary>

新算法:最大号 1004 加一,得到 T-1005。旧算法:3 张,1001 + 3 得到 T-1004,和已有的撞号。

</details>

3. run 函数为什么返回字符串,而不是自己直接 print?

<details><summary>答案</summary>

返回字符串,调用方就能决定怎么处理结果:main 打印它,练习里的 run2 可以先拦截自己的命令再交给 run,以后写测试可以直接比较返回值。run 里自己 print 的话,这些都做不了。打印和退出码属于 main 这一层的事。

</details>

4. 脚本里写着 `uv run python part01/notebook.py close T-1001 && echo 已关闭`,T-1001 已经关过了,`已关闭` 会不会打印?

<details><summary>答案</summary>

不会。第二次关闭时 notebook.py 打印「出错了: T-1001 已经关闭过了」并以退出码 1 结束,`&&` 看到非 0 就不再执行后面的 echo。

</details>

5. 面试题:你给 Agent 写一个「关闭工单」的工具,模型可能传错工单号、重复关闭、或者多传一个你不认识的参数。你会怎么设计这个工具的错误处理?

<details><summary>答案</summary>

参考今天的记事本:业务错误(找不到工单、已经关闭、参数不对)都转成一种业务异常,在工具的最外层接住,返回一句清楚的错误文字,让模型读到以后能自己改正再调一次,比如「没有这张工单: T-9999」;多余或不认识的参数要明确报错,不能悄悄忽略;重复关闭要么报错要么设计成幂等(第二次直接返回「已是关闭状态」),但要说清楚;真正的程序 bug 不吞掉,让它照常抛出并记录下来,方便开发者修。会改数据的操作在校验全部通过之后才写入。

</details>

## 明天预告

[Day 45 · 类型标注(一):基础写法和编辑器红线](/blog/agent-zero/day-045-type-hints-1/)。这三周的代码里一直写着 `title: str`、`-> list[Ticket]`,一直没正式讲。明天对照 TypeScript 把类型标注的基础写法讲清楚,再故意写错几处,看 basedpyright 在编辑器里画出的红线分别是什么意思。
