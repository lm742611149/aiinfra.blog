---
title: 'Day 38 · 读写文件和 with'
description: '用 open 把工单写进文本文件再读回来:写模式和追加模式的区别、为什么一定要写 encoding="utf-8"、忘了 close 会丢数据,再用 with 让 Python 自动关文件。with 背后就是 Day 36 学的 finally。'
pubDate: 2026-10-22
regime: none
tags: ['python', 'files', 'agent-zero']
series: 'agent-zero'
day: 38
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 37](/blog/agent-zero/day-037-pathlib/) 学了 pathlib:用 `/` 拼路径,用 `.name`、`.stem`、`.parent` 拆路径,用 `.exists()`、`.is_dir()` 判断,用 `rglob("*.json")` 找出目录下所有工单文件,还弄清了相对路径相对的是当前工作目录,脚本找身边的文件要用 `Path(__file__).resolve().parent` 当起点。

昨天找到的文件都是 `touch` 出来的空文件。今天往文件里写东西、再把它读回来。在浏览器里你几乎没有机会碰本地文件(最多是 `<input type="file">` 或者 `localStorage`),但在后端和 Agent 里,读写文件天天发生:读配置、读提示词模板、把对话记录存下来、把工具的输出写成日志。

## 今天要解决的问题

学完今天,你应该能:

1. 用 `open(path, "w", encoding="utf-8")` 写文件、用 `open(path, encoding="utf-8")` 读文件,说出 `"w"`、`"a"`、`"r"` 三种模式各做什么。
2. 解释「忘了 close」为什么会让写进去的内容读不出来,并亲手复现一次。
3. 用 `with open(...) as f:` 改写,知道它等价于 [Day 36](/blog/agent-zero/day-036-exceptions-2/) 学的 try/finally。
4. 逐行读文件,把「一行一张工单」的文本文件解析成字典列表。

预计用时:2.5 小时。前置:[Day 16](/blog/agent-zero/day-016-strings-2/) 的字符串方法和 UTF-8、[Day 36](/blog/agent-zero/day-036-exceptions-2/) 的 finally、[Day 37](/blog/agent-zero/day-037-pathlib/) 的 Path。

学法:先对照文章逐行敲一遍(不要复制粘贴)并跑通;第二天合上文章,把最后的 `ticket_store.py` 默写出来;再做动手练习,做不出来再展开参考答案,看完关掉自己重写一遍。

命令都在项目根目录 `agent-zero-lab` 里跑,新文件放进 `part01/`。先建一个放数据的目录:

```bash
mkdir -p part01/data
```

今天不调 API,花费 0 元。

## 先和 Node 对一下表

Node 里读写文件最常见的是 `fs.readFileSync` / `fs.writeFileSync`,一行搞定,不用管「打开」和「关闭」。Python 也有这种一行版本(本文最后会讲),但基础写法是先打开、再读写、最后关闭,和 Node 的 `fs.openSync` + `fs.closeSync` 那一套对应。

| Node | Python | 说明 |
| --- | --- | --- |
| `fs.openSync(p, "w")` | `open(p, "w", encoding="utf-8")` | 打开,得到一个文件对象 |
| `fs.writeSync(fd, s)` | `f.write(s)` | 写入 |
| `fs.closeSync(fd)` | `f.close()` | 关闭 |
| `fs.readFileSync(p, "utf8")` | `Path(p).read_text(encoding="utf-8")` | 一行读完 |
| `fs.writeFileSync(p, s)` | `Path(p).write_text(s, encoding="utf-8")` | 一行写完 |
| `fs.appendFileSync(p, s)` | `open(p, "a", encoding="utf-8")` 再 write | 追加到末尾 |
| `try { } finally { fs.closeSync(fd) }` | `with open(...) as f:` | 保证关闭 |

## 第一步:open、write、read、close

新建 `part01/open_basic.py`:

```python
# agent-zero-lab/part01/open_basic.py
from pathlib import Path

path = Path(__file__).resolve().parent / "data" / "hello.txt"

f = open(path, "w", encoding="utf-8")
n = f.write("T-1001 发票抬头开错了\n")
print("写入字符数:", n)
f.close()

f = open(path, "r", encoding="utf-8")
text = f.read()
f.close()
print(repr(text))
print("文件字节数:", path.stat().st_size)
```

<div class="line-notes">

- `path = Path(__file__).resolve().parent / "data" / "hello.txt"` 昨天学的写法,指向 `part01/data/hello.txt`。文件现在还不存在,没关系。
- `f = open(path, "w", encoding="utf-8")` `open` 是内置函数,不用 import。三个参数:路径(Path 和字符串都行);模式 `"w"` 表示 write,写;`encoding="utf-8"` 表示用 UTF-8 编码把文字变成字节。`"w"` 模式下文件不存在就新建,**存在就先清空**。返回的 `f` 是一个**文件对象**,后面读写都通过它。
- `n = f.write("T-1001 发票抬头开错了\n")` 写一行文字。`\n` 是换行符,`write` 不会自动帮你加,要自己写。返回值是写入的**字符**数,实测 `n` 是 `15`:`T-1001 ` 7 个、`发票抬头开错了` 7 个、`\n` 1 个。
- `print("写入字符数:", n)` 实测 `写入字符数: 15`。
- `f.close()` 关闭文件。这一步会把还没真正写到硬盘的内容「冲」下去,并把文件交还给操作系统。下一步会演示不 close 会怎样。
- `f = open(path, "r", encoding="utf-8")` 用 `"r"`(read,读)模式重新打开。`"r"` 是默认值,不写也一样,但 `encoding` 一定要写。
- `text = f.read()` 一次把整个文件读成一个字符串。
- `f.close()` 读完也要关。
- `print(repr(text))` `repr()` 会把字符串的引号和看不见的字符都显示出来。实测 `'T-1001 发票抬头开错了\n'`,末尾的 `\n` 就是我们写进去的换行。直接 `print(text)` 的话你只会看到文字和一个空行,看不出来那是换行符。
- `print("文件字节数:", path.stat().st_size)` `.stat()` 是 Path 的方法,拿到文件的元信息,`.st_size` 是文件大小,单位字节。实测 `29`。为什么是 29 不是 15?UTF-8 里一个英文字母或数字占 1 个字节,一个汉字占 3 个字节:7 + 7×3 + 1 = 29。这就是 Day 16 讲的「字符」和「字节」的区别。

</div>

```bash
uv run python part01/open_basic.py
```

实测输出:

```text
写入字符数: 15
'T-1001 发票抬头开错了\n'
文件字节数: 29
```

在终端里也看一眼,确认文件真的写到了硬盘上:

```bash
cat part01/data/hello.txt
```

实测输出:

```text
T-1001 发票抬头开错了
```

`encoding="utf-8"` 为什么每次都要写?因为不写的时候,Python 会用「操作系统的默认编码」。Mac 和 Linux 上默认编码基本都是 UTF-8,不写也不会出错;但在中文版 Windows 上,默认编码往往是 GBK。你在 Mac 上写的文件,同事在 Windows 上用不带 encoding 的代码去读,就会乱码或者报错。第五步会故意制造一次这个报错。

## 第二步:忘了 close 会怎样

上一步说「close 会把还没写到硬盘的内容冲下去」,这句话听起来很抽象。直接复现。新建 `part01/forgot_close.py`:

```python
# agent-zero-lab/part01/forgot_close.py
from pathlib import Path

path = Path(__file__).resolve().parent / "data" / "unflushed.txt"

f = open(path, "w", encoding="utf-8")
f.write("T-1002 申请退款\n")

reader = open(path, "r", encoding="utf-8")
print("没 close 时读到:", repr(reader.read()))
reader.close()

f.close()
reader = open(path, "r", encoding="utf-8")
print("close 之后读到:", repr(reader.read()))
reader.close()
```

<div class="line-notes">

- `f = open(path, "w", encoding="utf-8")` 打开一个新文件准备写。
- `f.write("T-1002 申请退款\n")` 写了一行,但**没有 close**。
- `reader = open(path, "r", encoding="utf-8")` 同一个文件,再开一个读的文件对象。
- `print("没 close 时读到:", repr(reader.read()))` 实测读到的是空字符串 `''`。刚才写的那行去哪了?还在 `f` 的**缓冲区**里,没到硬盘上。
- `reader.close()` 关掉读的那个。
- `f.close()` 现在把写的那个关掉,缓冲区里的内容被冲到硬盘。
- `print("close 之后读到:", repr(reader.read()))` 重新打开再读,实测 `'T-1002 申请退款\n'`,内容出现了。

</div>

实测输出:

```text
没 close 时读到: ''
close 之后读到: 'T-1002 申请退款\n'
```

这就是**缓冲区**(buffer)的作用。每次 `write` 都直接写硬盘太慢了,所以文件对象先在内存里攒着,攒够一批(或者 close 的时候)再一次性写下去。这个设计本身没问题,问题出在「忘了 close」:如果程序在 close 之前崩了,缓冲区里的东西就永远丢了。

<figure>
<svg viewBox="0 0 640 200" role="img" aria-label="write 先写到内存里的缓冲区,close 时才冲到硬盘上的文件,没 close 时另一个读者看到的是空文件">
<rect x="0" y="0" width="640" height="200" fill="var(--paper-raised)" rx="6"/>
<g font-family="var(--font-mono)" font-size="12">
<rect x="20" y="60" width="120" height="40" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="80" y="85" text-anchor="middle" fill="var(--ink)">f.write(...)</text>
<line x1="140" y1="80" x2="210" y2="80" stroke="var(--rule)"/>
<text x="175" y="72" text-anchor="middle" fill="var(--ink-faint)" font-size="11">很快</text>
<rect x="210" y="50" width="150" height="60" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="285" y="74" text-anchor="middle" fill="var(--ink)">缓冲区(内存)</text>
<text x="285" y="94" text-anchor="middle" fill="var(--ink-soft)" font-size="11">"T-1002 申请退款\n"</text>
<line x1="360" y1="80" x2="440" y2="80" stroke="var(--compute)" stroke-dasharray="5 3"/>
<text x="400" y="72" text-anchor="middle" fill="var(--ink-soft)" font-size="11">close 时</text>
<rect x="440" y="50" width="170" height="60" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="525" y="74" text-anchor="middle" fill="var(--ink)">硬盘上的文件</text>
<text x="525" y="94" text-anchor="middle" fill="var(--ink-soft)" font-size="11">unflushed.txt</text>
<line x1="525" y1="110" x2="525" y2="145" stroke="var(--rule)"/>
<text x="525" y="162" text-anchor="middle" fill="var(--ink)">reader.read()</text>
<text x="525" y="182" text-anchor="middle" fill="var(--ink-faint)" font-size="11">只能读到硬盘上有的</text>
<text x="20" y="150" fill="var(--ink-soft)" font-size="11">没 close:内容还在左边的缓冲区,</text>
<text x="20" y="168" fill="var(--ink-soft)" font-size="11">读者读到 '';程序这时崩了,内容就没了。</text>
</g>
</svg>
<figcaption>write 不等于写到硬盘。close(或者下一步的 with)才保证内容真正落地。</figcaption>
</figure>

## 第三步:with,让 Python 替你 close

每次都记得 close 是不现实的,而且就算记得写,中间一旦抛了异常,`f.close()` 那一行就被跳过了。Day 36 讲 finally 时说过:「打开文件和关闭文件」这种必须成对出现的动作就是 finally 的主场。Python 为此专门准备了一个更短的写法:`with`。

新建 `part01/with_basic.py`:

```python
# agent-zero-lab/part01/with_basic.py
from pathlib import Path

path = Path(__file__).resolve().parent / "data" / "hello.txt"

with open(path, "w", encoding="utf-8") as f:
    f.write("T-1001 发票抬头开错了\n")
    print("with 里面 closed =", f.closed)
print("with 外面 closed =", f.closed)

with open(path, encoding="utf-8") as f:
    text = f.read()
print(repr(text))

f.read()
```

<div class="line-notes">

- `with open(path, "w", encoding="utf-8") as f:` 读作「打开这个文件,叫它 f,在下面这块缩进里用」。`open(...)` 的返回值被绑定到 `as` 后面的名字 `f` 上。结尾有冒号,下面要缩进,和 if、for 一样。
- `f.write("T-1001 发票抬头开错了\n")` 缩进块里正常读写。
- `print("with 里面 closed =", f.closed)` `.closed` 是文件对象的属性,告诉你它关了没有。实测 `with 里面 closed = False`。
- `print("with 外面 closed =", f.closed)` 这一行没有缩进,已经离开了 with 块。离开的那一刻 Python 自动调了 `f.close()`。实测 `with 外面 closed = True`。注意 `f` 这个变量在 with 外面还能用,只是它代表的文件已经关了。
- `with open(path, encoding="utf-8") as f:` 读文件时省略了模式,默认就是 `"r"`。
- `text = f.read()` 在块里读完。
- `print(repr(text))` 在块外打印读到的字符串。字符串已经在内存里了,和文件关没关无关。实测 `'T-1001 发票抬头开错了\n'`。
- `f.read()` 故意在文件关了之后再读一次,实测报 `ValueError: I/O operation on closed file.`,「对已关闭的文件做读写操作」。

</div>

实测输出:

```text
with 里面 closed = False
with 外面 closed = True
'T-1001 发票抬头开错了\n'
Traceback (most recent call last):
  File ".../agent-zero-lab/part01/with_basic.py", line 15, in <module>
    f.read()
ValueError: I/O operation on closed file.
```

最后这个报错以后你会见到:读写的代码一不小心少缩进了一格,跑到了 with 块外面,就是这个错。看到 `closed file`,先去检查缩进。

### with 到底等于什么

我说 with 就是 finally,口说无凭。新建 `part01/with_vs_finally.py`,同样的事用两种写法各做一遍,而且都在中途抛异常:

```python
# agent-zero-lab/part01/with_vs_finally.py
from pathlib import Path

path = Path(__file__).resolve().parent / "data" / "hello.txt"

f = open(path, encoding="utf-8")
try:
    print("try 版本:", f.read().strip())
    raise ValueError("读到一半出错了")
except ValueError as e:
    print("接住:", e)
finally:
    f.close()
print("try 版本 closed =", f.closed)

g = open(path, encoding="utf-8")
try:
    with g:
        print("with 版本:", g.read().strip())
        raise ValueError("读到一半出错了")
except ValueError as e:
    print("接住:", e)
print("with 版本 closed =", g.closed)
```

<div class="line-notes">

- `f = open(path, encoding="utf-8")` try 版本:先打开。
- `print("try 版本:", f.read().strip())` `.strip()` 去掉末尾的换行,实测打印 `try 版本: T-1001 发票抬头开错了`。
- `raise ValueError("读到一半出错了")` 模拟「读到一半出错」,比如内容格式不对。
- `except ValueError as e:` 接住,实测 `接住: 读到一半出错了`。
- `finally:` 不管出没出错都关。
- `f.close()` 就是这一行保证了文件被关闭。
- `print("try 版本 closed =", f.closed)` 实测 `True`。
- `g = open(path, encoding="utf-8")` with 版本。为了在块外还能看到 `g`,这里先打开,再把文件对象交给 `with g:`。平时都写成 `with open(...) as g:`,效果一样。
- `with g:` 进入 with 块。
- `print("with 版本:", g.read().strip())` 实测 `with 版本: T-1001 发票抬头开错了`。
- `raise ValueError("读到一半出错了")` 同样中途抛异常。异常飞出 with 块的时候,with 先把文件关掉,再让异常继续往外飞。
- `except ValueError as e:` 外层接住,实测 `接住: 读到一半出错了`。
- `print("with 版本 closed =", g.closed)` 实测 `True`。异常发生了,文件照样关了,没写一行 close。

</div>

实测输出:

```text
try 版本: T-1001 发票抬头开错了
接住: 读到一半出错了
try 版本 closed = True
with 版本: T-1001 发票抬头开错了
接住: 读到一半出错了
with 版本 closed = True
```

<figure>
<svg viewBox="0 0 640 200" role="img" aria-label="with open 的写法和 try finally 写法逐段对应:open 对应进入,块内代码对应 try,自动 close 对应 finally">
<rect x="0" y="0" width="640" height="200" fill="var(--paper-raised)" rx="6"/>
<g font-family="var(--font-mono)" font-size="12">
<text x="20" y="28" fill="var(--ink)">with 写法</text>
<text x="340" y="28" fill="var(--ink)">等价的 try / finally</text>
<rect x="20" y="40" width="280" height="30" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="30" y="60" fill="var(--ink)">with open(p) as f:</text>
<rect x="340" y="40" width="280" height="30" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="350" y="60" fill="var(--ink)">f = open(p)</text>
<rect x="20" y="80" width="280" height="30" rx="4" fill="none" stroke="var(--rule)"/>
<text x="30" y="100" fill="var(--ink)">    text = f.read()</text>
<rect x="340" y="80" width="280" height="30" rx="4" fill="none" stroke="var(--rule)"/>
<text x="350" y="100" fill="var(--ink)">try:  text = f.read()</text>
<rect x="20" y="120" width="280" height="30" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="30" y="140" fill="var(--ink-soft)">(离开缩进块,自动关闭)</text>
<rect x="340" y="120" width="280" height="30" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="350" y="140" fill="var(--ink)">finally:  f.close()</text>
<line x1="300" y1="55" x2="340" y2="55" stroke="var(--rule)"/>
<line x1="300" y1="95" x2="340" y2="95" stroke="var(--rule)"/>
<line x1="300" y1="135" x2="340" y2="135" stroke="var(--rule)"/>
<text x="20" y="180" fill="var(--ink-faint)" font-size="11">正常结束、中途 return、中途抛异常,三种离开方式都会触发关闭。</text>
</g>
</svg>
<figcaption>with open(...) 和 try/finally 逐段对应。with 少写三行,而且不会忘。</figcaption>
</figure>

结论:**读写文件一律用 with**。我写了这么多年代码,手动 `open` 再手动 `close` 的写法只在教学里用过。with 背后的机制叫上下文管理器(context manager),不止文件能用,数据库连接、锁、计时器都能用;它是怎么做到「离开时自动收尾」的,[Day 98](/blog/agent-zero/day-098-context-managers/) 会拆开讲。今天你只要知道它等于 try/finally 就够了。

## 第四步:三种模式,w 会清空,a 会追加

`"w"` 模式有个很要命的特点:打开的那一刻就把文件清空了,不管你后面写没写。新建 `part01/modes.py`:

```python
# agent-zero-lab/part01/modes.py
from pathlib import Path

path = Path(__file__).resolve().parent / "data" / "log.txt"

with open(path, "w", encoding="utf-8") as f:
    f.write("第一次写\n")
with open(path, "w", encoding="utf-8") as f:
    f.write("第二次写\n")
print("用 w 写两次:", repr(path.read_text(encoding="utf-8")))

with open(path, "a", encoding="utf-8") as f:
    f.write("追加一行\n")
with open(path, "a", encoding="utf-8") as f:
    f.write("再追加一行\n")
print("再用 a 写两次:", repr(path.read_text(encoding="utf-8")))

with open(path.parent / "nope.txt", encoding="utf-8") as f:
    print(f.read())
```

<div class="line-notes">

- `with open(path, "w", encoding="utf-8") as f:` 第一次用 `"w"` 打开并写一行。
- `with open(path, "w", encoding="utf-8") as f:` 第二次又用 `"w"` 打开,这一刻第一次写的内容被清空了。
- `print("用 w 写两次:", repr(path.read_text(encoding="utf-8")))` `path.read_text(...)` 是 Path 的一行读完的方法,内部也是 open + read + close。实测 `'第二次写\n'`,第一次写的没了。
- `with open(path, "a", encoding="utf-8") as f:` `"a"` 是 append,追加。打开时不清空,写的内容接在文件末尾。文件不存在也会新建。
- `with open(path, "a", encoding="utf-8") as f:` 再追加一次。
- `print("再用 a 写两次:", repr(path.read_text(encoding="utf-8")))` 实测 `'第二次写\n追加一行\n再追加一行\n'`,三行都在。
- `with open(path.parent / "nope.txt", encoding="utf-8") as f:` 用 `"r"` 读一个不存在的文件。`"r"` 不会帮你新建,直接报错。
- `print(f.read())` 根本没执行到。

</div>

实测输出:

```text
用 w 写两次: '第二次写\n'
再用 a 写两次: '第二次写\n追加一行\n再追加一行\n'
Traceback (most recent call last):
  File ".../agent-zero-lab/part01/modes.py", line 18, in <module>
    with open(path.parent / "nope.txt", encoding="utf-8") as f:
         ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
FileNotFoundError: [Errno 2] No such file or directory: '.../agent-zero-lab/part01/data/nope.txt'
```

三种模式整理成表:

| 模式 | 文件不存在 | 文件已存在 | 典型用途 |
| --- | --- | --- | --- |
| `"r"`(默认) | 报 FileNotFoundError | 从头读 | 读配置、读数据 |
| `"w"` | 新建 | **先清空**,再从头写 | 每次重新生成的文件,比如导出结果 |
| `"a"` | 新建 | 接在末尾写 | 日志、对话记录 |

我第一次写日志功能就用了 `"w"`,每跑一次脚本日志就只剩最后一次的,查了半天才发现。凡是「历史要留着」的文件,用 `"a"`。

## 第五步:一行一行地读

`f.read()` 一次读完整个文件,文件小的时候没问题。但工单、日志这种「一行一条」的文件,通常要一行一行处理。文件对象可以直接放进 for 循环。新建 `part01/read_lines.py`(读的是上一步留下的 `log.txt`):

```python
# agent-zero-lab/part01/read_lines.py
from pathlib import Path

path = Path(__file__).resolve().parent / "data" / "log.txt"

with open(path, encoding="utf-8") as f:
    for line in f:
        print(repr(line))

with open(path, encoding="utf-8") as f:
    for number, line in enumerate(f, start=1):
        print(number, line.rstrip("\n"))
```

<div class="line-notes">

- `for line in f:` 文件对象每次给出一行,相当于 JS 里用 `readline` 模块的 `for await (const line of rl)`,只是 Python 这里是同步的。它不会一次把整个文件读进内存,所以几个 GB 的日志文件也能这样处理。
- `print(repr(line))` 实测三行:`'第二次写\n'`、`'追加一行\n'`、`'再追加一行\n'`。**每一行末尾都带着 `\n`**,这是新手最容易忽略的一点。
- `for number, line in enumerate(f, start=1):` Day 18 学的 enumerate,`start=1` 让行号从 1 开始,和编辑器里的行号一致。
- `print(number, line.rstrip("\n"))` `.rstrip("\n")` 只去掉右边的换行符。实测 `1 第二次写`、`2 追加一行`、`3 再追加一行`。为什么不用 `.strip()`?`.strip()` 会把行首行尾的空格也一起去掉,如果行首的空格是有意义的(比如缩进),就被误删了。只想去换行就用 `rstrip("\n")`。

</div>

实测输出:

```text
'第二次写\n'
'追加一行\n'
'再追加一行\n'
1 第二次写
2 追加一行
3 再追加一行
```

如果第二个 print 直接 `print(number, line)` 不去换行,你会看到每行后面多一个空行:`line` 自带一个 `\n`,`print` 再加一个。这是另一个高频小坑。

### 故意制造一次编码错误

前面一直强调 `encoding="utf-8"`,现在看看编码对不上会怎样。中文 Windows 上不写 encoding 时,Python 默认用的就是 GBK,我用 `encoding="gbk"` 来模拟那个场景。新建 `part01/encoding_error.py`:

```python
# agent-zero-lab/part01/encoding_error.py
from pathlib import Path

path = Path(__file__).resolve().parent / "data" / "hello.txt"

print(path.read_bytes())
with open(path, encoding="gbk") as f:
    print(f.read())
```

<div class="line-notes">

- `print(path.read_bytes())` `.read_bytes()` 不解码,直接读出原始字节。实测 `b'T-1001 \xe5\x8f\x91\xe7\xa5\xa8\xe6\x8a\xac\xe5\xa4\xb4\xe5\xbc\x80\xe9\x94\x99\xe4\xba\x86\n'`。前面的 `b` 表示这是 bytes(字节串)而不是字符串;英文字母原样显示,每个汉字变成了三个 `\x..`,比如「发」是 `\xe5\x8f\x91`。这就是 UTF-8 存在硬盘上的样子。
- `with open(path, encoding="gbk") as f:` 用 GBK 的规则去解释这些字节。
- `print(f.read())` GBK 里一个汉字是两个字节,它按两个两个地去拼,拼到第 15 个字节 `0xac` 时拼不出合法的字,报错。

</div>

实测输出:

```text
b'T-1001 \xe5\x8f\x91\xe7\xa5\xa8\xe6\x8a\xac\xe5\xa4\xb4\xe5\xbc\x80\xe9\x94\x99\xe4\xba\x86\n'
Traceback (most recent call last):
  File ".../agent-zero-lab/part01/encoding_error.py", line 8, in <module>
    print(f.read())
          ^^^^^^^^
UnicodeDecodeError: 'gbk' codec can't decode byte 0xac in position 15: illegal multibyte sequence
```

`UnicodeDecodeError` 就是「解码失败」:字节是按一种编码写的,你按另一种去读。有时候运气不好,字节恰好能按错的编码拼出字来,那就不报错,而是变成一堆乱码,更难发现。办法只有一个:写和读都明确写 `encoding="utf-8"`。

我在本机查了一下,`locale.getpreferredencoding(False)` 是 `UTF-8`,所以 Mac 上不写 encoding 也是 UTF-8,这正是很多人在 Mac 上一直不写、换到 Windows 才出事的原因。顺带一提,PEP 686 已经定稿,从 Python 3.15 开始所有平台默认都用 UTF-8 了;但这门课用的是 3.12,读者和同事的电脑上也可能是更老的版本,所以 encoding 照写不误,一个参数换来到哪都不出错。

## 把零件拼起来:工单存成文本再读回

最后拼一个小工具:把工单列表存成文本文件,一行一张,字段之间用竖线 `|` 隔开;能追加新工单;能把文件读回成字典列表,遇到格式不对的行就抛 Day 36 的 `TicketError`,并指出是第几行。新建 `part01/ticket_store.py`:

```python
# agent-zero-lab/part01/ticket_store.py
from pathlib import Path

DATA = Path(__file__).resolve().parent / "data" / "tickets.txt"


class TicketError(Exception):
    pass


def save_tickets(path: Path, tickets: list[dict[str, str]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        for t in tickets:
            f.write(f"{t['id']}|{t['title']}|{t['amount']}\n")


def append_ticket(path: Path, ticket: dict[str, str]) -> None:
    with open(path, "a", encoding="utf-8") as f:
        f.write(f"{ticket['id']}|{ticket['title']}|{ticket['amount']}\n")


def load_tickets(path: Path) -> list[dict[str, str]]:
    tickets: list[dict[str, str]] = []
    with open(path, encoding="utf-8") as f:
        for number, line in enumerate(f, start=1):
            line = line.rstrip("\n")
            if line == "":
                continue
            parts = line.split("|")
            if len(parts) != 3:
                raise TicketError(f"{path.name} 第 {number} 行格式不对: {line}")
            tickets.append({"id": parts[0], "title": parts[1], "amount": parts[2]})
    return tickets


save_tickets(DATA, [
    {"id": "T-1001", "title": "发票抬头开错了", "amount": "199"},
    {"id": "T-1005", "title": "升级套餐", "amount": "399"},
])
append_ticket(DATA, {"id": "T-1007", "title": "发票邮件没收到", "amount": "0"})

for t in load_tickets(DATA):
    print(t)
print(DATA.read_text(encoding="utf-8"), end="")

with open(DATA, "a", encoding="utf-8") as f:
    f.write("T-1008 少了竖线\n")
load_tickets(DATA)
```

<div class="line-notes">

- `DATA = Path(__file__).resolve().parent / "data" / "tickets.txt"` 数据文件位置,全大写表示常量(昨天讲过)。
- `class TicketError(Exception):` Day 36 的模板。
- `def save_tickets(path: Path, tickets: list[dict[str, str]]) -> None:` 把整批工单写进文件,每次都重写,所以下面用 `"w"`。
- `path.parent.mkdir(parents=True, exist_ok=True)` 昨天练习 3 学的:目录不存在就建。`open` 的 `"w"` 只会新建文件,不会新建目录,目录不存在会报 `FileNotFoundError`。
- `with open(path, "w", encoding="utf-8") as f:` 写模式打开。
- `for t in tickets:` 逐张写。
- `f.write(f"{t['id']}|{t['title']}|{t['amount']}\n")` 拼成一行,代入第一张就是 `T-1001|发票抬头开错了|199\n`。别忘了末尾的 `\n`,不然所有工单挤成一行(练习 4 会看到)。
- `def append_ticket(path: Path, ticket: dict[str, str]) -> None:` 只加一张,不动已有的。
- `with open(path, "a", encoding="utf-8") as f:` 追加模式。
- `f.write(f"{ticket['id']}|{ticket['title']}|{ticket['amount']}\n")` 代入 T-1007,写入 `T-1007|发票邮件没收到|0\n`。
- `def load_tickets(path: Path) -> list[dict[str, str]]:` 读回来,返回字典列表,和 Day 36 `process_batch` 收的参数类型一模一样,所以两段代码能直接接起来。
- `tickets: list[dict[str, str]] = []` 结果列表。
- `with open(path, encoding="utf-8") as f:` 读模式。
- `for number, line in enumerate(f, start=1):` 逐行读,带行号。
- `line = line.rstrip("\n")` 去掉换行符。第一行变成 `T-1001|发票抬头开错了|199`。
- `if line == "":` 空行跳过。文件末尾多敲了一个回车、或者人手改文件时留了空行,都不该算错误。
- `continue` Day 19 学的,跳过本次循环剩下的部分。
- `parts = line.split("|")` Day 16 的 split,按竖线切开。第一行得到 `['T-1001', '发票抬头开错了', '199']`。
- `if len(parts) != 3:` 不是正好三段就是格式坏了。
- `raise TicketError(f"{path.name} 第 {number} 行格式不对: {line}")` 报错里带上文件名、行号和整行内容。最后那行 `T-1008 少了竖线` 用空格分隔,split 出来只有 1 段,实测报 `TicketError: tickets.txt 第 4 行格式不对: T-1008 少了竖线`。
- `tickets.append({"id": parts[0], "title": parts[1], "amount": parts[2]})` 三段放进字典。
- `return tickets` 实测前三行解析出 3 个字典。
- `save_tickets(DATA, [` 先存两张。
- `append_ticket(DATA, {"id": "T-1007",` 再追加一张,文件里有三行。
- `for t in load_tickets(DATA):` 读回来逐个打印。
- `print(t)` 实测三行:`{'id': 'T-1001', 'title': '发票抬头开错了', 'amount': '199'}` 等。
- `print(DATA.read_text(encoding="utf-8"), end="")` 把文件原样打出来看看它在硬盘上长什么样。`end=""` 让 print 不再额外加换行,因为文件最后一行已经有 `\n` 了。
- `with open(DATA, "a", encoding="utf-8") as f:` 模拟有人手动往文件里加了一行格式不对的。
- `f.write("T-1008 少了竖线\n")` 用了空格而不是竖线。
- `load_tickets(DATA)` 再读一次,第 4 行触发 TicketError,程序崩溃,看看报错是不是能直接告诉你问题在哪。

</div>

```bash
uv run python part01/ticket_store.py
```

实测输出:

```text
{'id': 'T-1001', 'title': '发票抬头开错了', 'amount': '199'}
{'id': 'T-1005', 'title': '升级套餐', 'amount': '399'}
{'id': 'T-1007', 'title': '发票邮件没收到', 'amount': '0'}
T-1001|发票抬头开错了|199
T-1005|升级套餐|399
T-1007|发票邮件没收到|0
Traceback (most recent call last):
  File ".../agent-zero-lab/part01/ticket_store.py", line 49, in <module>
    load_tickets(DATA)
  File ".../agent-zero-lab/part01/ticket_store.py", line 32, in load_tickets
    raise TicketError(f"{path.name} 第 {number} 行格式不对: {line}")
TicketError: tickets.txt 第 4 行格式不对: T-1008 少了竖线
```

报错直接告诉你「tickets.txt 第 4 行」,打开文件看第 4 行就能改,不用猜。

每次运行 `save_tickets` 都会用 `"w"` 把文件重写,所以第二次运行时那行坏数据会被冲掉,结果和第一次完全一样。你可以连跑两次验证一下。

用竖线分字段有个明显的问题:工单标题里要是本身就有 `|`,一切就乱了。这正是明天要讲 JSON 的原因,它把「怎么分隔字段、怎么处理特殊字符」这些麻烦全包了。

零件对照:

| 前面的零件 | 在 ticket_store.py 里是哪一段 |
| --- | --- |
| 第一步 open + write + `encoding` | `save_tickets` 里的 `f.write(...)` |
| 第三步 with 自动关闭 | 三个函数里的 `with open(...) as f:` |
| 第四步 `"w"` 和 `"a"` | `save_tickets` 用 `"w"` 重写,`append_ticket` 用 `"a"` 追加 |
| 第五步 逐行读 + `rstrip("\n")` | `load_tickets` 的 for 循环 |
| Day 36 TicketError | `load_tickets` 里格式不对时抛出 |
| Day 37 Path | `DATA` 和 `path.parent.mkdir(...)` |

### 一行版本:read_text 和 write_text

上面已经用过 `path.read_text(encoding="utf-8")`。Path 还有一个 `write_text`,对应的就是 Node 的 `writeFileSync`:

```python
from pathlib import Path

p = Path("part01/data/hello.txt")
p.write_text("T-1001 发票抬头开错了\n", encoding="utf-8")
print(p.read_text(encoding="utf-8"))
```

它们内部就是 `with open(...)` 加一次读或写。整个文件一次读写完用它们最省事;要追加、要逐行处理,还是用 `with open`。注意 `write_text` 相当于 `"w"` 模式,同样会先清空文件。

## 动手练习

**练习 1:写三行再数行数。** 用一个 with 块往 `part01/data/three.txt` 写三张工单(每张一行),再用另一个 with 块逐行读回来,打印行号和内容,最后打印一共几行。不准用 `len(f.readlines())`,要在 for 循环里自己数。文件名 `part01/ex38_count.py`。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part01/ex38_count.py
from pathlib import Path

path = Path(__file__).resolve().parent / "data" / "three.txt"

with open(path, "w", encoding="utf-8") as f:
    f.write("T-1001 发票抬头开错了\n")
    f.write("T-1002 申请退款\n")
    f.write("T-1003 扣费两次\n")

count = 0
with open(path, encoding="utf-8") as f:
    for line in f:
        count += 1
        print(count, line.strip())
print("一共", count, "行")
```

<div class="line-notes">

- `with open(path, "w", encoding="utf-8") as f:` 写模式,每次运行都重写,所以无论跑几次结果都一样。
- `f.write("T-1001 发票抬头开错了\n")` 三次 write 在同一个 with 块里,共用一个打开的文件,依次接在后面。
- `count = 0` 计数器,放在 with 外面。
- `with open(path, encoding="utf-8") as f:` 重新打开来读。上一个 with 已经关闭并冲到了硬盘,所以这里读得到。
- `count += 1` 每读一行加一。
- `print(count, line.strip())` 实测 `1 T-1001 发票抬头开错了`、`2 T-1002 申请退款`、`3 T-1003 扣费两次`。这里行首没有空格,用 `strip()` 也没问题。
- `print("一共", count, "行")` 实测 `一共 3 行`。

</div>

实测输出:

```text
1 T-1001 发票抬头开错了
2 T-1002 申请退款
3 T-1003 扣费两次
一共 3 行
```

</details>

**练习 2:每跑一次记一笔日志。** 写一个脚本,每运行一次就往 `part01/data/run.log` 末尾追加一行 `脚本又跑了一次`,然后打印日志现在有几行。连续跑两次,确认第二次的行数比第一次多 1。文件名 `part01/ex38_log.py`。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part01/ex38_log.py
from pathlib import Path

log = Path(__file__).resolve().parent / "data" / "run.log"

with open(log, "a", encoding="utf-8") as f:
    f.write("脚本又跑了一次\n")

with open(log, encoding="utf-8") as f:
    lines = f.read().splitlines()
print(f"run.log 现在有 {len(lines)} 行")
```

<div class="line-notes">

- `with open(log, "a", encoding="utf-8") as f:` 追加模式,第一次运行时文件不存在,`"a"` 会新建。
- `f.write("脚本又跑了一次\n")` 每次运行加一行。
- `lines = f.read().splitlines()` `.splitlines()` 是字符串方法,按换行切成列表,并且**不带** `\n`。这是一次读完再切的写法,和 for 逐行读是两种思路,小文件用哪个都行。
- `print(f"run.log 现在有 {len(lines)} 行")` 第一次运行实测 `run.log 现在有 1 行`,第二次实测 `run.log 现在有 2 行`。

</div>

连续跑两次的实测输出:

```text
run.log 现在有 1 行
run.log 现在有 2 行
```

把 `"a"` 改成 `"w"` 再跑几次,行数会一直是 1,这就是正文第四步讲的「w 会清空」。

</details>

**练习 3:一个 with 同时开两个文件。** 把练习 1 生成的 `three.txt` 逐行读出来,把每行里的 `T-` 换成 `TICKET-`,写进 `three_upper.txt`。要求用**一个** with 语句同时打开两个文件。最后打印新文件内容,并确认两个文件对象都已关闭。文件名 `part01/ex38_copy.py`。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part01/ex38_copy.py
from pathlib import Path

data = Path(__file__).resolve().parent / "data"
src_path = data / "three.txt"
dst_path = data / "three_upper.txt"

with open(src_path, encoding="utf-8") as src, open(dst_path, "w", encoding="utf-8") as dst:
    for line in src:
        dst.write(line.replace("T-", "TICKET-"))

print(dst_path.read_text(encoding="utf-8"), end="")
print(src.closed, dst.closed)
```

<div class="line-notes">

- `src_path = data / "three.txt"` 源文件,练习 1 生成的。先跑练习 1 再跑这个。
- `with open(src_path, encoding="utf-8") as src, open(dst_path, "w", encoding="utf-8") as dst:` 一个 with 后面用逗号隔开两个 `open(...) as 名字`,离开时两个都会被关闭。
- `for line in src:` 逐行读源文件。
- `dst.write(line.replace("T-", "TICKET-"))` Day 16 的 replace。`line` 自带 `\n`,原样写过去,所以不用自己加换行。
- `print(dst_path.read_text(encoding="utf-8"), end="")` 实测三行:`TICKET-1001 发票抬头开错了`、`TICKET-1002 申请退款`、`TICKET-1003 扣费两次`。
- `print(src.closed, dst.closed)` 实测 `True True`。

</div>

实测输出:

```text
TICKET-1001 发票抬头开错了
TICKET-1002 申请退款
TICKET-1003 扣费两次
True True
```

</details>

**练习 4:观察会发生什么。** 下面这段代码写了两次,但都没加 `\n`。先猜读回来时 for 循环会打印几行,再新建 `part01/ex38_newline.py` 跑一下。

```python
# agent-zero-lab/part01/ex38_newline.py
from pathlib import Path

path = Path(__file__).resolve().parent / "data" / "glued.txt"

with open(path, "w", encoding="utf-8") as f:
    f.write("T-1001 发票抬头开错了")
    f.write("T-1002 申请退款")

with open(path, encoding="utf-8") as f:
    for line in f:
        print(repr(line))
```

<div class="line-notes">

- `f.write("T-1001 发票抬头开错了")` 没有 `\n`。
- `f.write("T-1002 申请退款")` 也没有,直接接在上一句后面。
- `for line in f:` 文件里根本没有换行符,所以整个文件就是「一行」。
- `print(repr(line))` 实测只打印一次:`'T-1001 发票抬头开错了T-1002 申请退款'`,而且末尾没有 `\n`。

</div>

<details><summary>参考答案</summary>

实测输出只有一行:

```text
'T-1001 发票抬头开错了T-1002 申请退款'
```

`write` 和 `print` 不一样,`print` 会自动在末尾加换行,`write` 写什么就是什么。两张工单粘成了一行,用 `load_tickets` 那种按行解析的代码去读,就会变成一条格式错误的记录。凡是「一行一条」的文件,每次 write 都自己带上 `\n`。

</details>

验收标准:四个练习都跑出和上面一致的结果;能不看文章写出 `with open(path, "a", encoding="utf-8") as f:` 并解释每个部分;能说出 `"w"` 和 `"a"` 的区别,以及为什么不 close 可能丢数据。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| open | 内置函数,打开文件,返回文件对象。`open(路径, 模式, encoding=...)` |
| 文件对象 | open 返回的东西,通过它 `read`、`write`、`close`,能直接放进 for 循环逐行读 |
| 模式 r / w / a | 读(默认,文件必须存在)/ 写(先清空)/ 追加(接在末尾);w 和 a 在文件不存在时都会新建 |
| encoding | 文字和字节之间的转换规则。课程里一律写 `encoding="utf-8"` |
| 缓冲区(buffer) | 文件对象在内存里攒数据的地方,攒够或 close 时才写到硬盘 |
| close | 关闭文件:把缓冲区冲到硬盘,并把文件交还给操作系统 |
| with 语句 | `with open(...) as f:`,离开缩进块时自动关闭文件,等价于 try/finally |
| 上下文管理器 | 能放在 with 后面的东西的统称,文件对象是其中一种。Day 98 详细讲 |
| `\n` | 换行符。write 不会自动加,逐行读出来的每行末尾都带着它 |
| rstrip("\n") | 只去掉字符串右边的换行符,不动其他空白 |
| bytes(字节串) | `b'...'` 开头的值,是文件在硬盘上的原始字节,没有按编码解释成文字 |
| UnicodeDecodeError | 用错误的编码去解释字节时抛的异常 |
| read_text / write_text | Path 的一行读完、一行写完的方法,内部就是 with open |

## 常见误区

**不写 encoding。** Mac 上不写也是 UTF-8,所以你一直不会发现问题;换到中文 Windows 上默认变成 GBK,实测报 `UnicodeDecodeError: 'gbk' codec can't decode byte 0xac in position 15: illegal multibyte sequence`。每个 open、read_text、write_text 都写上 `encoding="utf-8"`。

**用 "w" 写日志。** 每次打开都会先清空,日志永远只剩最后一次。要留历史用 `"a"`。

**忘了 close,或者 close 写在可能被跳过的地方。** 实测没 close 时另一个读者读到的是空字符串 `''`。手动 close 写在 try 里,中间一抛异常就跳过了。一律用 with。

**在 with 块外面继续读写。** 少缩进一格就会掉出 with 块,实测报 `ValueError: I/O operation on closed file.`。看到 `closed file` 先查缩进。

**忘了每行带的 `\n`。** 逐行读出来的 `line` 末尾都有 `\n`,直接拿去比较 `line == "T-1001"` 永远是 False,直接 print 会多出空行。先 `rstrip("\n")`。反过来,write 时忘了加 `\n`,所有内容会粘成一行(练习 4)。

**用 "r" 打开不存在的文件,以为会自动新建。** 只有 `"w"` 和 `"a"` 会新建文件,而且它们只建文件、不建目录。目录不存在时先 `path.parent.mkdir(parents=True, exist_ok=True)`。

## 学习资料

### 文档与文章

- [Python 官方教程 · 7.2 读写文件(中文)](https://docs.python.org/zh-cn/3.12/tutorial/inputoutput.html#reading-and-writing-files):open 的模式、with 的推荐写法、逐行读,今天的内容这一节都有,篇幅不长。
- [Python 内置函数 · open(中文)](https://docs.python.org/zh-cn/3.12/library/functions.html#open):所有模式的完整表格在这里,还有 `"x"`(文件已存在就报错)、`"b"`(二进制)等今天没讲的模式。
- [菜鸟教程 · Python3 File 方法](https://www.runoob.com/python3/python3-file-methods.html):中文速查表,文件对象的每个方法一行说明。
- [PEP 343 · The "with" Statement](https://peps.python.org/pep-0343/):with 语句的设计文档,英文。不用全读,看「Motivation and Summary」那一节,作者解释了为什么 try/finally 太啰嗦。
- [PEP 686 · Make UTF-8 mode default](https://peps.python.org/pep-0686/):Python 3.15 起默认 UTF-8 的那个提案,看开头的 Abstract 和 Motivation,里面有 Windows 上编码出问题的真实例子。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1N84y1B7kL&autoplay=0&high_quality=1" title="python open函数" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>罗方炜lfw2565295 · python open函数 · 约 11 分钟,把 open 的几种模式挨个演示了一遍,适合配合第四步的模式表看。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1NjQqYEEaM&autoplay=0&high_quality=1" title="【Python基础】第九章 文件处理(上)- open和with" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>平哥教你写BUG · 【Python基础】第九章 文件处理(上)- open和with · 35 分钟,讲得细,open 和 with 都覆盖了,适合想再听一遍完整讲解的时候看。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/Uh2ebFW8OYM" title="Python Tutorial: File Objects - Reading and Writing to Files" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Corey Schafer · Python Tutorial: File Objects - Reading and Writing to Files · 英文,从手动 close 讲到 with、逐行读和复制文件,顺序和今天差不多。</figcaption>
</figure>

### 书籍

- 《Python 编程:从入门到实践(第 3 版)》,Eric Matthes 著,人民邮电出版社。第 10 章「文件和异常」,第 3 版用的是 `Path.read_text` / `write_text`,可以和今天最后那一节对照着看。
- 《Automate the Boring Stuff with Python, 3rd Edition》,Al Sweigart 著,No Starch Press。第 10 章后半讲读写文件,[在线免费版](https://automatetheboringstuff.com/3e/chapter10.html),英文。

### 开源项目与代码

- [python-dotenv 的 `main.py`](https://github.com/theskumar/python-dotenv/blob/main/src/dotenv/main.py):第二部分会用它从 `.env` 文件读 API key。在页面里搜 `with open(`,能看到它读 `.env` 的那一行,写法就是 `with open(self.dotenv_path, encoding=self.encoding) as stream:`,和今天学的一模一样,只是变量名换了。

## 自测

1. `open(path, "w", encoding="utf-8")` 打开一个已经有内容的文件,还没 write 任何东西就 close 了,文件现在是什么样?

<details><summary>答案</summary>

文件变成空的。`"w"` 模式在打开的那一刻就清空文件,和后面写没写无关。

</details>

2. 为什么正文 `forgot_close.py` 里,没 close 时另一个文件对象读到的是空字符串?

<details><summary>答案</summary>

write 的内容先放在写入方文件对象的缓冲区(内存)里,还没写到硬盘;另一个文件对象只能读到硬盘上已有的内容。close 时缓冲区才被冲到硬盘。

</details>

3. 把下面的代码改写成 with 写法,并说明改写前后在「中途抛异常」时有什么区别。

```python
f = open("a.txt", encoding="utf-8")
text = f.read()
f.close()
```

<details><summary>答案</summary>

```python
with open("a.txt", encoding="utf-8") as f:
    text = f.read()
```

原写法里 `f.read()` 一旦抛异常,`f.close()` 就被跳过,文件不会关闭;with 写法等价于 try/finally,不管块里是否抛异常,离开时都会关闭文件。

</details>

4. 逐行读一个文件,`if line == "T-1001":` 一直不成立,但打印出来明明就是 `T-1001`。最可能的原因是什么?

<details><summary>答案</summary>

逐行读出来的 `line` 末尾带着换行符,实际值是 `"T-1001\n"`。比较之前先 `line.rstrip("\n")`。用 `print(repr(line))` 可以直接看到那个 `\n`。

</details>

5. 什么场景用 `"a"` 模式?举一个 Agent 开发里的例子。

<details><summary>答案</summary>

需要保留历史、在末尾不断添加的文件。比如把 Agent 每一轮对话或每次工具调用的结果追加写进一个日志文件,排查问题时能看到完整过程;用 `"w"` 的话每次运行都会把之前的记录清空。

</details>

## 明天预告

[Day 39 · JSON:Python 和 JSON 互转](/blog/agent-zero/day-039-json/)。今天用竖线 `|` 分字段,标题里要是带竖线就全乱了,而且读回来的金额全是字符串。明天换成 JSON:用 `json.dumps` / `json.loads` 在 Python 字典和 JSON 文本之间互转,对照你熟悉的 `JSON.stringify` / `JSON.parse`,再把今天的工单改存成 JSON 文件。大模型 API 收发的全是 JSON,这一课以后天天用得上。
