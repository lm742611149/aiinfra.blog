---
title: 'Day 41 · 第 6 周复习:编程地基(Day 35–40)'
description: '这一周从异常学到类:try/except 接住错误、raise 和自定义异常、finally 收尾、pathlib 找文件、with 读写文件、JSON 互转、class 和 self。今天默写三段核心代码,再只用本周学过的东西拼一个「工单目录体检」脚本,把一个混着坏文件的目录查一遍。'
pubDate: 2026-10-22
regime: none
tags: ['python', 'review', 'agent-zero']
series: 'agent-zero'
day: 41
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 40](/blog/agent-zero/day-040-classes-1/) 学了 class:`__init__` 就是 JS 的 constructor,`self` 就是 `this`,只是要写在参数列表里;`t.summary()` 就是 `Ticket.summary(t)` 的简写。最后把 Day 36 的校验搬进了 `__init__`,不合格的工单根本造不出来,再配一个 `to_dict`,让 Ticket 能存成 JSON 又读回成对象。

这周的六课其实在讲同一件事:**程序碰到外面的世界时怎么不出事**。外面的世界就是硬盘上的文件、别人写的数据、格式不对的文本。今天停一天,把它们串起来。

## 今天要解决的问题

学完今天,你应该能:

1. 合上文章默写出 Day 36 的 `check_ticket`(raise、`raise ... from e`、自定义异常),跑出和文中一致的结果。
2. 默写出带 try 的 JSON 读写函数(with + json.load + 位置信息),以及带校验和 `to_dict` 的 Ticket 类。
3. 用本周的知识拼出 `ticket_checkup.py`:扫一个目录里所有 `.json` 工单,合格的打印摘要,坏的说清楚坏在哪,不管怎样都打印汇总,并把报告存成 JSON。
4. 说出本周每一个报错对应的病因,看到报错不用翻文章就知道往哪查。

预计用时:3 小时。默写三段各 25 分钟左右,小项目 1 小时,剩下的时间做练习和自测。前置:[Day 35](/blog/agent-zero/day-035-exceptions-1/) 到 [Day 40](/blog/agent-zero/day-040-classes-1/) 全部,以及 [Day 32](/blog/agent-zero/day-032-modules/) 的 import 和 `__name__`。今天不调 API,花费 0 元。

学法和平时一样:先对照文章逐行敲一遍(不复制粘贴)并跑通;明天合上文章,把三段默写代码和 `checkup` 函数再写一遍;做练习时先自己写,做不出再展开参考答案,看完关掉自己重写一遍。

命令都在项目根目录 `agent-zero-lab` 里跑,文件放进 `part01/`。小项目要 import Day 40 的 `part01/ticket_model.py`,先确认它在,而且最下面的演示代码包在 `if __name__ == "__main__":` 里。

## 本周知识地图

先看一张图。小项目要做的事从左往右走一遍,每一步用的是哪一天的知识,出错时又是哪一天的知识在兜底:

<figure>
<svg viewBox="0 0 640 260" role="img" aria-label="工单目录体检的流程:rglob 找文件、with open 打开、json.load 解析、Ticket 构造,每一步出错都由 try except、raise from 和 finally 兜底">
<rect x="0" y="0" width="640" height="260" fill="var(--paper-raised)" rx="6"/>
<g font-family="var(--font-mono)" font-size="12">
<rect x="15" y="40" width="135" height="56" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="82" y="62" text-anchor="middle" fill="var(--ink)">找文件</text>
<text x="82" y="82" text-anchor="middle" fill="var(--ink-soft)" font-size="11">rglob · Day 37</text>
<rect x="170" y="40" width="135" height="56" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="237" y="62" text-anchor="middle" fill="var(--ink)">打开文件</text>
<text x="237" y="82" text-anchor="middle" fill="var(--ink-soft)" font-size="11">with open · Day 38</text>
<rect x="325" y="40" width="135" height="56" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="392" y="62" text-anchor="middle" fill="var(--ink)">解析</text>
<text x="392" y="82" text-anchor="middle" fill="var(--ink-soft)" font-size="11">json.load · Day 39</text>
<rect x="480" y="40" width="145" height="56" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="552" y="62" text-anchor="middle" fill="var(--ink)">造对象</text>
<text x="552" y="82" text-anchor="middle" fill="var(--ink-soft)" font-size="11">Ticket(...) · Day 40</text>
<line x1="150" y1="68" x2="170" y2="68" stroke="var(--rule)"/>
<line x1="305" y1="68" x2="325" y2="68" stroke="var(--rule)"/>
<line x1="460" y1="68" x2="480" y2="68" stroke="var(--rule)"/>
<text x="82" y="122" text-anchor="middle" fill="var(--ink-faint)" font-size="11">目录不存在</text>
<text x="237" y="122" text-anchor="middle" fill="var(--ink-faint)" font-size="11">编码不对</text>
<text x="392" y="122" text-anchor="middle" fill="var(--ink-faint)" font-size="11">JSONDecodeError</text>
<text x="552" y="122" text-anchor="middle" fill="var(--ink-faint)" font-size="11">负数 / 缺字段</text>
<line x1="82" y1="130" x2="82" y2="160" stroke="var(--rule)" stroke-dasharray="4 3"/>
<line x1="237" y1="130" x2="237" y2="160" stroke="var(--rule)" stroke-dasharray="4 3"/>
<line x1="392" y1="130" x2="392" y2="160" stroke="var(--rule)" stroke-dasharray="4 3"/>
<line x1="552" y1="130" x2="552" y2="160" stroke="var(--rule)" stroke-dasharray="4 3"/>
<rect x="15" y="160" width="610" height="36" rx="4" fill="none" stroke="var(--rule)"/>
<text x="320" y="183" text-anchor="middle" fill="var(--ink)">except 接住 · Day 35    raise TicketError(...) from e · Day 36</text>
<rect x="15" y="208" width="610" height="36" rx="4" fill="none" stroke="var(--rule)"/>
<text x="320" y="231" text-anchor="middle" fill="var(--ink)">finally:不管出没出错,都打印汇总 · Day 36</text>
</g>
</svg>
<figcaption>上面一排是「正常路线」,下面两条是「出错路线」。这周的六天,一半在教怎么做事,一半在教做事出错时怎么办。</figcaption>
</figure>

## 本周每天一句话

- [Day 35](/blog/agent-zero/day-035-exceptions-1/):traceback 从下往上读,最后一行是异常类型和原因,往上找自己文件的那一行;用 `try` / `except 某种异常 as e:` 接住,程序就不会整个崩掉。
- [Day 36](/blog/agent-zero/day-036-exceptions-2/):自己 `raise`,定义 `class TicketError(Exception): pass` 让调用方只接业务错误,`raise ... from e` 换名字但保留原因,`finally` 里的代码不管发生什么都会执行。
- [Day 37](/blog/agent-zero/day-037-pathlib/):Path 用 `/` 拼,`.name`、`.stem`、`.parent` 拆;相对路径相对的是 cwd,脚本找身边的文件用 `Path(__file__).resolve().parent`;`rglob("*.json")` 找子目录里所有 JSON,记得套 `sorted()`。
- [Day 38](/blog/agent-zero/day-038-files-with/):`open(path, 模式, encoding="utf-8")`,`"w"` 先清空、`"a"` 接在末尾;没 close 内容可能还在缓冲区里;一律用 `with`,它等于 try/finally。
- [Day 39](/blog/agent-zero/day-039-json/):`dumps`/`loads` 管字符串,`dump`/`load` 管文件;中文加 `ensure_ascii=False`;loads 外面包 try 接 `JSONDecodeError`;JSON 文件不能用 `"a"` 追加。
- [Day 40](/blog/agent-zero/day-040-classes-1/):`class` 是图纸,`Ticket(...)` 造实例,`__init__` 里 `self.x = x` 存属性,方法第一个参数是 self;对象要存 JSON 得先 `to_dict()`。

## 默写一:check_ticket

默写的规矩:先只看下面这段要求,在空文件里写,写完跑,跑通了再展开对照。

**要求**:定义 `TicketError`;写 `check_ticket(ticket)`,收一个值全是字符串的工单字典,依次检查标题不能为空、金额能转成数字(转不了就 `raise TicketError(...) from e`)、金额不能是负数,都过了返回金额。用三张工单测试,每张都用 try/except/finally,except 里把 `e.__cause__` 也打出来。文件名 `part01/recall_check.py`。

<details><summary>对照答案</summary>

```python
# agent-zero-lab/part01/recall_check.py
class TicketError(Exception):
    pass


def check_ticket(ticket: dict[str, str]) -> float:
    if ticket["title"].strip() == "":
        raise TicketError(f"{ticket['id']} 标题是空的")
    try:
        amount = float(ticket["amount"])
    except ValueError as e:
        raise TicketError(f"{ticket['id']} 金额不是数字: {ticket['amount']}") from e
    if amount < 0:
        raise TicketError(f"{ticket['id']} 金额不能是负数: {amount}")
    return amount


for t in [
    {"id": "T-1001", "title": "发票抬头开错了", "amount": "199"},
    {"id": "T-1002", "title": "申请退款", "amount": "-50"},
    {"id": "T-1004", "title": "扣费两次", "amount": "abc"},
]:
    try:
        print("合格", check_ticket(t))
    except TicketError as e:
        print("不合格", e, "| 原因:", repr(e.__cause__))
    finally:
        print("  查完", t["id"])
```

<div class="line-notes">

- `class TicketError(Exception):` 自定义异常最少就这两行,Day 36 第二步。
- `if ticket["title"].strip() == "":` 第一道:标题去掉空白后为空就不行。
- `try:` 第二道检查要包 try,因为 `float()` 自己会抛 ValueError。
- `amount = float(ticket["amount"])` T-1004 的 `"abc"` 在这里抛 `ValueError: could not convert string to float: 'abc'`。
- `raise TicketError(f"{ticket['id']} 金额不是数字: {ticket['amount']}") from e` 翻译成业务异常,`from e` 把原来的 ValueError 挂在新异常的 `__cause__` 上。
- `if amount < 0:` 第三道:T-1002 的 -50.0 在这里被拦。
- `return amount` T-1001 返回 `199.0`。
- `print("合格", check_ticket(t))` 实测 `合格 199.0`。
- `print("不合格", e, "| 原因:", repr(e.__cause__))` T-1002 实测 `原因: None`,因为负数是我们自己直接 raise 的,没有 from;T-1004 实测 `原因: ValueError("could not convert string to float: 'abc'")`,原始错误还在。
- `finally:` 三张工单每张都会走到这里。
- `print("  查完", t["id"])` 实测每张后面都有一行「查完」,合格的、不合格的都有。

</div>

实测输出:

```text
合格 199.0
  查完 T-1001
不合格 T-1002 金额不能是负数: -50.0 | 原因: None
  查完 T-1002
不合格 T-1004 金额不是数字: abc | 原因: ValueError("could not convert string to float: 'abc'")
  查完 T-1004
```

</details>

自查:三道检查的顺序记对了没有?如果把金额检查放在标题检查前面,空标题、金额也坏的工单会报金额错误,结果不一样但都算对;只要 `from e` 写在 `except ValueError as e` 里面,`e` 才有定义。

## 默写二:JSON 读写

**要求**:写 `save(path, items)` 用 with + `json.dump` 把列表写成带缩进、中文原样的 JSON;写 `load(path)` 用 with + `json.load` 读回,解析失败时 `raise ValueError(...) from e` 并在信息里带上文件名、行号和列号,最外层不是列表也报错。先存一张工单读回来,再故意写一个带尾逗号的坏文件读一次。文件名 `part01/recall_json.py`。

<details><summary>对照答案</summary>

```python
# agent-zero-lab/part01/recall_json.py
import json
from pathlib import Path

PATH = Path(__file__).resolve().parent / "data" / "recall.json"


def save(path: Path, items: list[dict[str, object]]) -> None:
    with open(path, "w", encoding="utf-8") as f:
        json.dump(items, f, ensure_ascii=False, indent=2)


def load(path: Path) -> list[dict[str, object]]:
    with open(path, encoding="utf-8") as f:
        try:
            data = json.load(f)
        except json.JSONDecodeError as e:
            raise ValueError(f"{path.name} 第 {e.lineno} 行第 {e.colno} 列: {e.msg}") from e
    if not isinstance(data, list):
        raise ValueError(f"{path.name} 最外层不是列表")
    return data


save(PATH, [{"id": "T-1001", "title": "发票抬头开错了", "amount": 199}])
print(load(PATH))
print(PATH.read_text(encoding="utf-8"))
PATH.write_text('[{"id": "T-1001",}]', encoding="utf-8")
try:
    load(PATH)
except ValueError as e:
    print("读不了:", e)
```

<div class="line-notes">

- `PATH = Path(__file__).resolve().parent / "data" / "recall.json"` Day 37 的定位写法,`data/` 是 Day 38 建的目录。
- `def save(path: Path, items: list[dict[str, object]]) -> None:` 这里值的类型写成 `object`(任何值都是 object),不用 import Any。两种写法今天都行。
- `with open(path, "w", encoding="utf-8") as f:` Day 38:写模式、UTF-8、with 自动关。
- `json.dump(items, f, ensure_ascii=False, indent=2)` Day 39:不带 s,直接写进文件对象。
- `with open(path, encoding="utf-8") as f:` 读模式是默认值。
- `data = json.load(f)` 解析。
- `raise ValueError(f"{path.name} 第 {e.lineno} 行第 {e.colno} 列: {e.msg}") from e` 这次直接用内置的 ValueError,不定义新异常也可以。JSONDecodeError 本来就是 ValueError 的子类,换成父类再加上文件名,调用方看得更明白。
- `if not isinstance(data, list):` 合法 JSON 不等于形状对。
- `print(load(PATH))` 实测 `[{'id': 'T-1001', 'title': '发票抬头开错了', 'amount': 199}]`,金额是整数。
- `PATH.write_text('[{"id": "T-1001",}]', encoding="utf-8")` 写一个尾逗号的坏文件。
- `print("读不了:", e)` 实测 `读不了: recall.json 第 1 行第 18 列: Expecting property name enclosed in double quotes`。第 18 列是尾逗号后面那个 `}`。

</div>

实测输出:

```text
[{'id': 'T-1001', 'title': '发票抬头开错了', 'amount': 199}]
[
  {
    "id": "T-1001",
    "title": "发票抬头开错了",
    "amount": 199
  }
]
读不了: recall.json 第 1 行第 18 列: Expecting property name enclosed in double quotes
```

</details>

自查:`json.dump` 的第二个参数是文件对象 `f` 而不是路径;`encoding="utf-8"` 两处都写了;try 只包住 `json.load` 那一行,没有把整个函数都包进去。try 包得越小,接到的异常越确定是你预料的那一种。

## 默写三:Ticket 类

**要求**:写 `Ticket` 类,`__init__` 收 id、title、amount、status(默认 `"open"`),金额为负就 `raise ValueError`;有 `close()` 和 `to_dict()` 两个方法。造一张工单、关闭、打印 `to_dict()`,再验证 `Ticket.to_dict(t)` 和 `t.to_dict()` 结果相同。文件名 `part01/recall_class.py`。

<details><summary>对照答案</summary>

```python
# agent-zero-lab/part01/recall_class.py
class Ticket:
    def __init__(self, id: str, title: str, amount: float, status: str = "open"):
        if amount < 0:
            raise ValueError(f"{id} 金额不能是负数: {amount}")
        self.id = id
        self.title = title
        self.amount = amount
        self.status = status

    def close(self) -> None:
        self.status = "closed"

    def to_dict(self) -> dict[str, object]:
        return {"id": self.id, "title": self.title, "amount": self.amount, "status": self.status}


t = Ticket("T-1001", "发票抬头开错了", 199)
t.close()
print(t.to_dict())
print(Ticket.to_dict(t) == t.to_dict())
```

<div class="line-notes">

- `def __init__(self, id: str, title: str, amount: float, status: str = "open"):` self 第一个,带默认值的参数放最后。
- `if amount < 0:` 校验写在存属性之前,不合格就造不出来。
- `self.id = id` 四个属性都要写 `self.`,少写一个就是 Day 40 第三步的 AttributeError。
- `def close(self) -> None:` 改状态的方法,第一个参数照样是 self。
- `def to_dict(self) -> dict[str, object]:` 对象 → 字典,json.dumps 才认识。
- `t.close()` 关闭。
- `print(t.to_dict())` 实测 `{'id': 'T-1001', 'title': '发票抬头开错了', 'amount': 199, 'status': 'closed'}`。
- `print(Ticket.to_dict(t) == t.to_dict())` 实测 `True`,self 就是 t。

</div>

实测输出:

```text
{'id': 'T-1001', 'title': '发票抬头开错了', 'amount': 199, 'status': 'closed'}
True
```

</details>

自查:self 有没有漏写(`__init__`、`close`、`to_dict` 三处);默认参数 `status="open"` 有没有放在没默认值的参数后面,放前面会直接报 `SyntaxError: parameter without a default follows parameter with a default`。

## 小项目:工单目录体检

场景:客服系统每天往一个 `inbox/` 目录里丢工单 JSON 文件,有人手改过、有程序写坏过,也有字段不全的。你要写一个脚本把整个目录查一遍:合格的打印摘要,有问题的说清楚是哪个文件、什么问题,不管中途发生什么都要打印汇总,最后把报告存成 JSON,并往日志里追加一行。只用本周学的东西。

### 先造一个待体检的目录

新建 `part01/make_inbox.py`,一次造出各种情况:

```python
# agent-zero-lab/part01/make_inbox.py
import json
from pathlib import Path

inbox = Path(__file__).resolve().parent / "inbox"
(inbox / "old").mkdir(parents=True, exist_ok=True)

good = [
    {"id": "T-2001", "title": "发票抬头开错了", "amount": 199},
    {"id": "T-2002", "title": "升级套餐 | 年付", "amount": 399, "status": "closed"},
]
for t in good:
    (inbox / f"{t['id']}.json").write_text(json.dumps(t, ensure_ascii=False), encoding="utf-8")

(inbox / "old" / "T-1901.json").write_text('{"id": "T-1901", "title": "旧工单", "amount": 50}', encoding="utf-8")
(inbox / "T-2003.json").write_text('{"id": "T-2003", "title": "申请退款", "amount": -80}', encoding="utf-8")
(inbox / "T-2004.json").write_text("{'id': 'T-2004', 'title': '扣费两次', 'amount': 99}", encoding="utf-8")
(inbox / "T-2005.json").write_text("", encoding="utf-8")
(inbox / "T-2006.json").write_text('{"id": "T-2006", "title": "没写金额"}', encoding="utf-8")
(inbox / "readme.txt").write_text("这个目录放待处理的工单\n", encoding="utf-8")

for p in sorted(inbox.rglob("*")):
    print(p.relative_to(inbox))
```

<div class="line-notes">

- `(inbox / "old").mkdir(parents=True, exist_ok=True)` 连 `inbox/` 带子目录 `old/` 一起建,已存在也不报错。
- `good = [` 两张合格工单,第二张标题带竖线、状态是 closed。
- `(inbox / f"{t['id']}.json").write_text(json.dumps(t, ensure_ascii=False), encoding="utf-8")` 文件名用工单号拼出来,`T-2001.json`、`T-2002.json`。
- `(inbox / "old" / "T-1901.json")` 子目录里一张合格的旧工单,测试 rglob 能不能找到。
- `(inbox / "T-2003.json")` 金额是负数,JSON 合法,但 Ticket 造不出来。
- `(inbox / "T-2004.json")` 单引号,不是合法 JSON。
- `(inbox / "T-2005.json")` 空文件。
- `(inbox / "T-2006.json")` 缺 amount 字段。
- `(inbox / "readme.txt")` 不是 JSON,体检时应该被忽略。
- `for p in sorted(inbox.rglob("*")):` `"*"` 匹配所有东西,包括目录。
- `print(p.relative_to(inbox))` 打印相对 inbox 的路径。

</div>

```bash
uv run python part01/make_inbox.py
```

实测输出:

```text
T-2001.json
T-2002.json
T-2003.json
T-2004.json
T-2005.json
T-2006.json
old
old/T-1901.json
readme.txt
```

七个 JSON 文件里,三个合格(T-2001、T-2002、old/T-1901),四个各有各的毛病。体检脚本应该正好挑出这四个。

### 体检脚本

新建 `part01/ticket_checkup.py`:

```python
# agent-zero-lab/part01/ticket_checkup.py
import json
from pathlib import Path

from ticket_model import Ticket, TicketError, ticket_from_dict

HERE = Path(__file__).resolve().parent


def find_ticket_files(folder: Path) -> list[Path]:
    if not folder.exists():
        raise FileNotFoundError(f"工单目录不存在: {folder}")
    if not folder.is_dir():
        raise NotADirectoryError(f"这不是目录: {folder}")
    return sorted(folder.rglob("*.json"))


def load_one(path: Path) -> Ticket:
    with open(path, encoding="utf-8") as f:
        try:
            data = json.load(f)
        except json.JSONDecodeError as e:
            raise TicketError(f"不是合法 JSON: {e.msg}") from e
    try:
        return ticket_from_dict(data)
    except KeyError as e:
        raise TicketError(f"缺字段 {e}") from e


def checkup(folder: Path) -> dict[str, list[str]]:
    ok: list[str] = []
    bad: list[str] = []
    try:
        for path in find_ticket_files(folder):
            name = str(path.relative_to(folder))
            try:
                t = load_one(path)
            except TicketError as e:
                bad.append(f"{name}: {e}")
                continue
            ok.append(f"{name}: {t.summary()}")
    finally:
        print(f"体检完成:合格 {len(ok)} 个,有问题 {len(bad)} 个")
    return {"ok": ok, "bad": bad}


if __name__ == "__main__":
    inbox = HERE / "inbox"
    report = checkup(inbox)
    for line in report["ok"]:
        print("  OK ", line)
    for line in report["bad"]:
        print("  BAD", line)

    report_path = HERE / "data" / "checkup_report.json"
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")

    with open(HERE / "data" / "checkup.log", "a", encoding="utf-8") as log:
        log.write(f"ok={len(report['ok'])} bad={len(report['bad'])}\n")
    print("报告写到", report_path.relative_to(HERE))
```

<div class="line-notes">

- `from ticket_model import Ticket, TicketError, ticket_from_dict` 复用 Day 40 的 Ticket 类、异常和「字典 → 对象」函数。Ticket 的 `__init__` 已经会拦空标题和负数金额。
- `HERE = Path(__file__).resolve().parent` 所有路径都从脚本所在目录出发,在哪里运行都一样。
- `def find_ticket_files(folder: Path) -> list[Path]:` Day 37 的原样,默写过就该能直接写出来。
- `return sorted(folder.rglob("*.json"))` 只要 `.json`,`readme.txt` 自然被排除。
- `def load_one(path: Path) -> Ticket:` 读一个文件,要么返回合格的 Ticket,要么抛 TicketError。**把所有「这个文件有问题」都统一成 TicketError**,是这个脚本最关键的设计:调用方只需要接一种异常。
- `with open(path, encoding="utf-8") as f:` Day 38。
- `data = json.load(f)` Day 39。T-2004 和 T-2005 会在这里抛 JSONDecodeError。
- `raise TicketError(f"不是合法 JSON: {e.msg}") from e` Day 36 的翻译。T-2004 得到 `不是合法 JSON: Expecting property name enclosed in double quotes`,T-2005 得到 `不是合法 JSON: Expecting value`。
- `return ticket_from_dict(data)` 造 Ticket。T-2003 的负数在 Ticket 的 `__init__` 里抛 TicketError,它本来就是 TicketError,直接往外飞,不用翻译。
- `except KeyError as e:` T-2006 没有 amount,`d["amount"]` 抛 KeyError。
- `raise TicketError(f"缺字段 {e}") from e` KeyError 的 `str(e)` 是带引号的键名,实测得到 `缺字段 'amount'`。
- `def checkup(folder: Path) -> dict[str, list[str]]:` 返回一个字典,两个键 ok 和 bad,值都是字符串列表。
- `try:` 外层 try 只配 finally,保证汇总一定打印,Day 36 `process_batch` 的同款结构。
- `for path in find_ticket_files(folder):` 七个 JSON 文件。
- `name = str(path.relative_to(folder))` 相对 inbox 的路径,比如 `old/T-1901.json`。`str()` 把 Path 变成字符串,后面要存进 JSON,JSON 不认识 Path。
- `t = load_one(path)` 内层 try:单个文件出错只影响它自己。
- `bad.append(f"{name}: {e}")` 记下哪个文件、什么问题。
- `continue` 跳到下一个文件。
- `ok.append(f"{name}: {t.summary()}")` 合格的记下摘要。summary 是 Day 40 写的方法。
- `print(f"体检完成:合格 {len(ok)} 个,有问题 {len(bad)} 个")` 实测 `体检完成:合格 3 个,有问题 4 个`。
- `if __name__ == "__main__":` 被别的文件 import 时下面不执行,练习里要用到。
- `report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")` 报告存成 JSON。整个文件每次重写,用的是 write_text(相当于 `"w"`)。
- `with open(HERE / "data" / "checkup.log", "a", encoding="utf-8") as log:` 日志要留历史,用 `"a"`。日志是纯文本一行一条,不是 JSON 文件,所以追加没问题。
- `log.write(f"ok={len(report['ok'])} bad={len(report['bad'])}\n")` 记一行,别忘了 `\n`。
- `print("报告写到", report_path.relative_to(HERE))` 实测 `报告写到 data/checkup_report.json`。

</div>

```bash
uv run python part01/ticket_checkup.py
```

实测输出:

```text
体检完成:合格 3 个,有问题 4 个
  OK  T-2001.json: [open] T-2001 发票抬头开错了 ¥199
  OK  T-2002.json: [closed] T-2002 升级套餐 | 年付 ¥399
  OK  old/T-1901.json: [open] T-1901 旧工单 ¥50
  BAD T-2003.json: T-2003 金额不能是负数: -80
  BAD T-2004.json: 不是合法 JSON: Expecting property name enclosed in double quotes
  BAD T-2005.json: 不是合法 JSON: Expecting value
  BAD T-2006.json: 缺字段 'amount'
报告写到 data/checkup_report.json
```

四个坏文件一个不漏,每个都说清了原因,`readme.txt` 被忽略。看一下两个输出文件:

```bash
cat part01/data/checkup_report.json
cat part01/data/checkup.log
```

`checkup_report.json` 实测是一个带缩进的 JSON 对象,`"ok"` 下三行、`"bad"` 下四行,中文原样。我连跑了两次,`checkup.log` 实测有两行,每行都是 `ok=3 bad=4`,`"a"` 模式没有清空第一次的记录。

零件对照:

| 本周的零件 | 在 ticket_checkup.py 里是哪一段 |
| --- | --- |
| Day 35 `except ... as e` | `checkup` 内层 try、`load_one` 两个 try |
| Day 36 TicketError、`raise ... from e`、finally | `load_one` 把 JSONDecodeError 和 KeyError 翻译成 TicketError;`checkup` 外层 finally 打汇总 |
| Day 37 Path、rglob、relative_to | `find_ticket_files`、`name = str(path.relative_to(folder))` |
| Day 38 with open、`"a"` 模式 | `load_one` 打开文件、最后追加日志 |
| Day 39 json.load、dumps、ensure_ascii | 解析工单、写报告 |
| Day 40 Ticket、summary | `ticket_from_dict` 造对象、`t.summary()` 拼摘要 |

这个脚本就是 Agent 里「工具」的雏形:输入一个目录,输出一份结构化的报告,出错时不崩,而是把每个错误说清楚。第三部分写工具函数时,你会发现套路几乎一样,区别只是调用它的从你变成了模型。

## 本周错题与坑清单

这周所有实测过的报错放在一起。看到左边,就该想到右边:

| 报错(实测原文) | 哪天 | 病因和修法 |
| --- | --- | --- |
| `ValueError: could not convert string to float: 'abc'` | 35、36 | 字符串转不成数字;要么 try 接住,要么翻译成业务异常 |
| `KeyError: 'amount'` | 36、41 | 字典缺键;能缺就用 `.get()`,不能缺就翻译成 TicketError |
| `The above exception was the direct cause of the following exception` | 36、39 | 不是新错误,是 `raise ... from e` 把两段 traceback 连在了一起,先读下面那段 |
| `TypeError: unsupported operand type(s) for +: 'PosixPath' and 'str'` | 37 | Path 不能用 + 拼,用 `/` |
| `FileNotFoundError: [Errno 2] No such file or directory` | 37、38 | 路径错了,或者相对路径相对的是 cwd 而不是脚本所在目录 |
| `ValueError: I/O operation on closed file.` | 38 | 在 with 块外面读写,多半是少缩进了一格 |
| `UnicodeDecodeError: 'gbk' codec can't decode byte 0xac` | 38 | 写和读的编码不一致,两边都写 `encoding="utf-8"` |
| `Expecting property name enclosed in double quotes` | 39 | 单引号或尾逗号,常见于 `str(字典)` 写出来的「假 JSON」 |
| `Expecting value: line 1 column 1 (char 0)` | 39、41 | 空文件、空响应,或者 JSON 前面多了别的文字 |
| `Extra data` | 39 | JSON 后面还有东西,多半是用 `"a"` 往 JSON 文件追加了 |
| `TypeError: Object of type set is not JSON serializable` | 39、40 | dumps 遇到 set 或自己的类,先转成 list 或 `to_dict()` |
| `AttributeError: 'Ticket' object has no attribute 'title'` | 40 | `__init__` 里少写了 `self.`,或者属性名拼错 |
| `takes 0 positional arguments but 1 was given` | 40 | 方法定义少写了 self |

还有两个不报错但结果错的坑,比报错更难发现:**用 `"w"` 写日志**(每次只剩最后一次的记录)和**可变默认值 `tags=[]`**(所有实例共用一个列表)。遇到「数据莫名其妙丢了」或「改一个全变了」,先想这两个。

## 动手练习

**练习 1:找出重复的工单号。** 两个文件可能是同一张工单(比如一张被复制进了 `old/`)。在 `old/` 里放一个 `T-2001-copy.json`,内容和 T-2001 相同;然后扫一遍 inbox,能解析的文件按工单号记下来,遇到重复就打印两个文件名;最后打印一共有几个不同的工单号,并把复制的文件删掉,不影响后面再跑体检。复用 `ticket_checkup.py` 里的 `find_ticket_files`。文件名 `part01/ex41_dupes.py`。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part01/ex41_dupes.py
import json
from pathlib import Path

from ticket_checkup import find_ticket_files

inbox = Path(__file__).resolve().parent / "inbox"
copy = inbox / "old" / "T-2001-copy.json"
copy.write_text(
    json.dumps({"id": "T-2001", "title": "发票抬头开错了", "amount": 199}, ensure_ascii=False),
    encoding="utf-8",
)

seen: dict[str, str] = {}
for path in find_ticket_files(inbox):
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        continue
    name = str(path.relative_to(inbox))
    tid = data["id"]
    if tid in seen:
        print(f"重复工单号 {tid}: {seen[tid]} 和 {name}")
    else:
        seen[tid] = name
print("一共", len(seen), "个不同的工单号")
copy.unlink()
```

<div class="line-notes">

- `from ticket_checkup import find_ticket_files` 因为 ticket_checkup 的演示代码在 `if __name__ == "__main__":` 里,import 时不会跑体检。
- `copy = inbox / "old" / "T-2001-copy.json"` 复制品的路径,最后要删,所以存进变量。
- `seen: dict[str, str] = {}` 工单号 → 第一次见到它的文件名。
- `data = json.loads(path.read_text(encoding="utf-8"))` 一行读完再解析,Day 39 第五步说的另一种写法。
- `except json.JSONDecodeError:` 只想找重复,坏文件直接跳过。不需要用到异常对象时,`as e` 可以不写。
- `tid = data["id"]` 这批文件里能解析的都有 id。
- `if tid in seen:` Day 24 的 `in` 判断字典里有没有这个键。
- `print(f"重复工单号 {tid}: {seen[tid]} 和 {name}")` 实测 `重复工单号 T-2001: T-2001.json 和 old/T-2001-copy.json`。排序后 `T-2001.json` 在前,`old/...` 在后(大写 T 排在小写 o 前面)。
- `seen[tid] = name` 第一次见到就记下。
- `print("一共", len(seen), "个不同的工单号")` 实测 `一共 5 个不同的工单号`:T-2001、T-2002、T-2003、T-2006、T-1901。T-2004 和 T-2005 解析不了,没算进去。
- `copy.unlink()` 删掉复制品,Day 39 练习 2 见过 unlink。

</div>

实测输出:

```text
重复工单号 T-2001: T-2001.json 和 old/T-2001-copy.json
一共 5 个不同的工单号
```

</details>

**练习 2:观察会发生什么,再修好。** 新建一个目录 `part01/inbox_extra/`,放两个文件:`T-2007.json` 的金额写成了字符串 `"199"`,`T-2008.json` 的最外层是数组 `[{"id": "T-2008"}]`。先猜对这个目录跑 `checkup` 会怎样,再新建 `part01/ex41_types_crash.py` 跑一下。然后写一个更严格的 `load_one_strict`,让这两个文件都变成 TicketError。

```python
# agent-zero-lab/part01/ex41_types_crash.py
from pathlib import Path

from ticket_checkup import checkup

checkup(Path(__file__).resolve().parent / "inbox_extra")
```

<div class="line-notes">

- `checkup(Path(__file__).resolve().parent / "inbox_extra")` 对新目录体检。两个文件先手动建好,或者先跑下面参考答案里的脚本(它会建这两个文件)。

</div>

<details><summary>参考答案</summary>

实测输出(先跑过下面的 `ex41_types.py` 建好文件):

```text
体检完成:合格 0 个,有问题 0 个
Traceback (most recent call last):
  File ".../agent-zero-lab/part01/ex41_types_crash.py", line 6, in <module>
    checkup(Path(__file__).resolve().parent / "inbox_extra")
  File ".../agent-zero-lab/part01/ticket_checkup.py", line 37, in checkup
    t = load_one(path)
        ^^^^^^^^^^^^^^
  File ".../agent-zero-lab/part01/ticket_checkup.py", line 25, in load_one
    return ticket_from_dict(data)
           ^^^^^^^^^^^^^^^^^^^^^^
  File ".../agent-zero-lab/part01/ticket_model.py", line 35, in ticket_from_dict
    return Ticket(d["id"], d["title"], d["amount"], d.get("status", "open"))
           ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
  File ".../agent-zero-lab/part01/ticket_model.py", line 17, in __init__
    if amount < 0:
       ^^^^^^^^^^
TypeError: '<' not supported between instances of 'str' and 'int'
```

从下往上读:Ticket 的 `__init__` 拿字符串 `"199"` 和 0 比大小,Python 不允许,抛了 TypeError。TypeError 不是 TicketError,体检里的 except 接不住,一路飞出去,程序崩了;外层 finally 在崩溃前照样打了汇总,但那句「合格 0 个,有问题 0 个」是错的,第一个文件就崩了,后面的根本没查。这正是 Day 36 说的:我们没预料到的错误不会被悄悄吞掉,它会崩出来提醒你补一道检查。

修法是在 load_one 里先检查数据的形状和类型,再交给 Ticket。新建 `part01/ex41_types.py`:

```python
# agent-zero-lab/part01/ex41_types.py
import json
from pathlib import Path

from ticket_model import Ticket, TicketError, ticket_from_dict

extra = Path(__file__).resolve().parent / "inbox_extra"
extra.mkdir(exist_ok=True)
(extra / "T-2007.json").write_text('{"id": "T-2007", "title": "金额写成了字符串", "amount": "199"}', encoding="utf-8")
(extra / "T-2008.json").write_text('[{"id": "T-2008"}]', encoding="utf-8")


def load_one_strict(path: Path) -> Ticket:
    with open(path, encoding="utf-8") as f:
        try:
            data = json.load(f)
        except json.JSONDecodeError as e:
            raise TicketError(f"不是合法 JSON: {e.msg}") from e
    if not isinstance(data, dict):
        raise TicketError(f"最外层应该是对象,实际是 {type(data).__name__}")
    if not isinstance(data.get("amount"), (int, float)):
        raise TicketError(f"金额应该是数字,实际是 {repr(data.get('amount'))}")
    try:
        return ticket_from_dict(data)
    except KeyError as e:
        raise TicketError(f"缺字段 {e}") from e


for path in sorted(extra.glob("*.json")):
    try:
        print("OK ", load_one_strict(path).summary())
    except TicketError as e:
        print("BAD", path.name, e)
```

<div class="line-notes">

- `extra.mkdir(exist_ok=True)` 只有一层,不用 `parents=True`。
- `(extra / "T-2007.json").write_text(` 金额是带引号的 `"199"`,JSON 里这就是字符串。
- `(extra / "T-2008.json").write_text('[{"id": "T-2008"}]', encoding="utf-8")` 合法 JSON,但最外层是数组。
- `if not isinstance(data, dict):` 第一道:最外层必须是对象(读回来是字典)。T-2008 读回来是列表,在这里拦下。如果不拦,`d["id"]` 对列表取字符串下标会抛另一种 TypeError。
- `raise TicketError(f"最外层应该是对象,实际是 {type(data).__name__}")` 实测 `最外层应该是对象,实际是 list`。
- `if not isinstance(data.get("amount"), (int, float)):` 第二道:金额必须是数字。`isinstance` 的第二个参数可以是一个元组,意思是「是其中任何一种就算」。用 `.get` 而不是 `["amount"]`:缺字段时 get 返回 None,None 不是数字,也会在这里拦下。
- `raise TicketError(f"金额应该是数字,实际是 {repr(data.get('amount'))}")` 用 `repr` 打印,字符串会带引号,一眼看出是 `'199'` 而不是 199。实测 `金额应该是数字,实际是 '199'`。
- `for path in sorted(extra.glob("*.json")):` 只有一层,用 glob 就够。
- `print("BAD", path.name, e)` 实测两行都是 BAD。

</div>

实测输出:

```text
BAD T-2007.json 金额应该是数字,实际是 '199'
BAD T-2008.json 最外层应该是对象,实际是 list
```

这种「先查形状、再查类型、最后查业务规则」的检查,手写一遍就知道有多啰嗦。[Day 51](/blog/agent-zero/day-051-pydantic-1/) 的 pydantic 会把这些全部变成字段声明,报错也会像这样逐条列出来。

</details>

**练习 3:目录不存在时,汇总在说谎。** 对一个不存在的目录 `inboxx` 跑 `checkup`,会先打印「体检完成:合格 0 个,有问题 0 个」再崩溃。这句汇总是误导人的:不是查了 0 个,而是根本没开始查。改写 checkup,让目录不存在时直接抛 FileNotFoundError、不打印汇总,调用方接住后打印一句「没法体检」。文件名 `part01/ex41_fixed.py`。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part01/ex41_fixed.py
from pathlib import Path

from ticket_checkup import find_ticket_files, load_one
from ticket_model import TicketError


def checkup(folder: Path) -> dict[str, list[str]]:
    files = find_ticket_files(folder)
    ok: list[str] = []
    bad: list[str] = []
    try:
        for path in files:
            name = str(path.relative_to(folder))
            try:
                t = load_one(path)
            except TicketError as e:
                bad.append(f"{name}: {e}")
                continue
            ok.append(f"{name}: {t.summary()}")
    finally:
        print(f"体检完成:合格 {len(ok)} 个,有问题 {len(bad)} 个")
    return {"ok": ok, "bad": bad}


here = Path(__file__).resolve().parent
checkup(here / "inbox")
try:
    checkup(here / "inboxx")
except FileNotFoundError as e:
    print("没法体检:", e)
```

<div class="line-notes">

- `from ticket_checkup import find_ticket_files, load_one` 复用原来的两个函数,只重写 checkup。
- `files = find_ticket_files(folder)` 唯一的改动:找文件挪到 try **外面**。目录不存在时异常在这里就飞出去了,还没进 try,所以 finally 不会执行,也就不会打那句误导人的汇总。
- `for path in files:` 遍历已经找好的列表。
- `finally:` 只有真正开始查了,才打印汇总。
- `checkup(here / "inbox")` 正常目录,实测 `体检完成:合格 3 个,有问题 4 个`,和原版一样。
- `checkup(here / "inboxx")` 拼错的目录。
- `except FileNotFoundError as e:` 调用方接住。
- `print("没法体检:", e)` 实测 `没法体检: 工单目录不存在: .../agent-zero-lab/part01/inboxx`。

</div>

实测输出:

```text
体检完成:合格 3 个,有问题 4 个
没法体检: 工单目录不存在: .../agent-zero-lab/part01/inboxx
```

finally 的位置决定了它「保证」的是什么。放在整个函数外围,保证的是「函数结束前一定执行」;只包住循环,保证的是「开始查了就一定汇总」。写 finally 之前先想清楚你要保证哪件事。

</details>

验收标准:三段默写都能不看文章写出来并跑出一致的结果;`ticket_checkup.py` 对 inbox 跑出「合格 3 个,有问题 4 个」,四个问题的原因和文中一致;三个练习的输出和参考答案一致;错题清单里随便挑一行报错,能说出病因。

## 名词解释

今天没有新概念,只有小项目里第一次正式用到的两个写法:

| 名词 | 意思 |
| --- | --- |
| `isinstance(x, (int, float))` | 第二个参数写元组,表示「是其中任何一种类型都算」 |
| `except 某异常:`(不写 as) | 只想接住、用不到异常对象时,可以不写 `as e` |
| `e.__cause__` | `raise ... from e` 之后,新异常身上挂着的原始异常;没有 from 时是 None(Day 36 讲过) |
| 体检脚本 | 本课的说法:扫一批数据,逐条检查,汇总成报告,出错不崩 |

本周的其他术语都在各天的名词解释里:traceback、try/except([Day 35](/blog/agent-zero/day-035-exceptions-1/)),raise、自定义异常、finally([Day 36](/blog/agent-zero/day-036-exceptions-2/)),Path、cwd、rglob([Day 37](/blog/agent-zero/day-037-pathlib/)),文件对象、缓冲区、with([Day 38](/blog/agent-zero/day-038-files-with/)),序列化、ensure_ascii、JSONDecodeError([Day 39](/blog/agent-zero/day-039-json/)),类、实例、self([Day 40](/blog/agent-zero/day-040-classes-1/))。

## 常见误区

**try 包得太大。** 把整个函数体都放进 try,再 `except Exception`,什么错都接住了,包括你写错的变量名。体检脚本里每个 try 只包住一两行,except 只接预料到的那一种(JSONDecodeError、KeyError、TicketError),练习 2 里没预料到的 TypeError 就会崩出来提醒你。

**以为 finally 里的汇总一定可信。** finally 只保证「会执行」,不保证执行时数据是完整的。练习 2 和练习 3 都实测打出了「合格 0 个,有问题 0 个」,其实一个都没查完。汇总里要么只写确定的事,要么像练习 3 那样调整 finally 的范围。

**合法 JSON 就当成合格数据。** `[{"id": "T-2008"}]` 和 `{"amount": "199"}` 都是合法 JSON,`json.load` 不会报错,但都不是一张合格的工单。解析只是第一道关,形状、类型、业务规则还要各查一遍。

**import 一个文件,它的演示代码也跟着跑了。** 被 import 的文件如果没有 `if __name__ == "__main__":`,顶层的代码在 import 时全部执行,Day 37 的 `find_tickets.py` 最后那行故意的崩溃就会在你 import 时发生。要被复用的文件,演示代码一律包进 main 判断。

**复习日只看不写。** 看懂和写对之间差得很远。拿默写三举例,凭印象写很容易把 `status: str = "open"` 写到 amount 前面,我故意这么写跑了一次,实测连运行都到不了,直接报 `SyntaxError: parameter without a default follows parameter with a default`,指向 `amount: float` 那个参数。这种错只有自己动手写才会撞上,一定合上文章写。

## 学习资料

### 文档与文章

- [Python 官方教程 · 8. 错误和异常(中文)](https://docs.python.org/zh-cn/3.12/tutorial/errors.html):Day 35、36 的官方版本,8.3 到 8.7 节把 try/except、raise、自定义异常、finally 依次讲完,今天用来查漏。
- [Python 官方教程 · 7. 输入与输出(中文)](https://docs.python.org/zh-cn/3.12/tutorial/inputoutput.html):7.2 读写文件和 7.2.2 json 两节,对应 Day 38、39。
- [Python 官方教程 · 9. 类(中文)](https://docs.python.org/zh-cn/3.12/tutorial/classes.html):9.3「初探类」对应 Day 40。
- [Python 标准库 · json(中文)](https://docs.python.org/zh-cn/3.12/library/json.html):小项目里 JSONDecodeError 的 `msg`、`lineno`、`colno` 三个属性,在这页的「异常」一节有说明。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1XPzTBuE9z&autoplay=0&high_quality=1" title="Python 异常处理核心!raise 和 try-except 保姆级教程" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>水哥澎湃 · Python 异常处理核心!raise 和 try-except 保姆级教程 · 约 15 分钟,2026 年的视频,把 Day 35、36 的内容串着讲一遍,复习用正合适。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1H4411o7j8&autoplay=0&high_quality=1" title="十分钟搞定 python try except 异常处理和异常回溯" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>东仔兔 · 十分钟搞定 python try except 异常处理和异常回溯 · 约 15 分钟,标题里的「异常回溯」就是 traceback,try/except 和读回溯都讲了,配合今天的错题清单看。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/NIWwJbo-9_8" title="Python Tutorial: Using Try/Except Blocks for Error Handling" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Corey Schafer · Python Tutorial: Using Try/Except Blocks for Error Handling · 英文,try / except / else / finally 和自定义 raise 一集讲完,例子就是打开文件,和本周的主线完全重合。</figcaption>
</figure>

### 书籍

- 《Python 编程:从入门到实践(第 3 版)》,Eric Matthes 著,人民邮电出版社。第 9 章「类」和第 10 章「文件和异常」正好覆盖本周,章末的练习可以当额外的复习题。

### 开源项目与代码

- [python-dotenv 的 `main.py`](https://github.com/theskumar/python-dotenv/blob/main/src/dotenv/main.py):这周看了它两次,今天把它当一次「综合阅读」:`class DotEnv` 是 Day 40 的类,`with open(...)` 是 Day 38,开头的 `import pathlib` 是 Day 37,往下翻还能找到 `except FileNotFoundError:` 这样的写法,是 Day 35 的捕获。挑一个函数,试着把每一行对应到本周的哪一天。

## 自测

1. 下面这段代码运行后打印什么?

```python
def f() -> str:
    try:
        raise KeyError("x")
    except ValueError:
        return "接住了"
    finally:
        print("finally")
```

调用 `f()` 会怎样?

<details><summary>答案</summary>

先打印 `finally`,然后程序因为 `KeyError: 'x'` 崩溃。except 只接 ValueError,KeyError 接不住,但飞出函数前 finally 照样执行。

</details>

2. `json.load(Path("a.json"))` 会报什么错?怎么改?

<details><summary>答案</summary>

`AttributeError: 'PosixPath' object has no attribute 'read'`。json.load 要的是打开的文件对象。改成 `with open(Path("a.json"), encoding="utf-8") as f: data = json.load(f)`,或者 `json.loads(Path("a.json").read_text(encoding="utf-8"))`。

</details>

3. 体检脚本里,为什么要把 JSONDecodeError 和 KeyError 都翻译成 TicketError,而不是在 checkup 里分别 except 它们?

<details><summary>答案</summary>

load_one 的调用方只关心「这个文件能不能用、不能用的原因是什么」,不关心底层是哪种错误。统一成 TicketError 后,checkup 只需要一个 except,以后 load_one 里加新的检查(比如练习 2 的类型检查),checkup 一行都不用改;`from e` 又保证了需要排查时原始错误还在。

</details>

4. 一个日志文件每次运行只剩一行,一个 JSON 文件读的时候报 `Extra data`。分别是哪里写错了?

<details><summary>答案</summary>

日志文件用了 `"w"` 模式,每次打开都先清空,应该用 `"a"`。JSON 文件被人用 `"a"` 往后追加了内容,整个文件不再是一个合法的 JSON 值;JSON 文件要读出、修改、整体重写,要追加就改用 JSON Lines。

</details>

5. 面试题:你写了一个给 Agent 用的「读取工单文件」工具,文件可能不存在、可能不是合法 JSON、可能缺字段。这个工具出错时应该返回什么给模型?

<details><summary>答案</summary>

不要让异常直接把整个 Agent 崩掉,也不要返回一句笼统的「出错了」。应该在工具内部把各种底层异常统一接住,返回一个结构化的结果,写清楚是哪个文件、哪一类问题、具体原因(比如「T-2006.json 缺字段 'amount'」「T-2004.json 不是合法 JSON,第 1 行第 2 列」),必要时附上能让模型自己修正的提示。模型拿到具体的报错,才能决定是换个文件、换个参数重试,还是告诉用户。和体检脚本的 bad 列表是同一个思路。

</details>

## 明天预告

[Day 42 · 类(二):继承和组合](/blog/agent-zero/day-042-classes-2/)。今天的 TicketError 写着 `class TicketError(Exception)`,括号里的 Exception 就是继承。明天讲清楚继承是怎么回事,再用「邮件通知」和「短信通知」两种渠道类对比继承和组合两种写法,看看什么时候该用哪个。
