---
title: 'Day 37 · 路径:pathlib'
description: '读文件之前先得找到文件。今天用标准库 pathlib 拼路径、拆路径、判断文件和目录存不存在、列出一个目录下所有 .json,并弄清「相对路径到底相对谁」这个最常见的坑。全程对照 Node 的 path 模块和 __dirname。'
pubDate: 2026-10-22
regime: none
tags: ['python', 'pathlib', 'agent-zero']
series: 'agent-zero'
day: 37
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 36](/blog/agent-zero/day-036-exceptions-2/) 学了自己抛异常:用 `raise` 拦下金额为负数的工单,定义了自己的 `TicketError`,用 `raise ... from e` 把底层的 `ValueError` 翻译成业务错误,还用 `finally` 保证批处理的汇总一定会打印。

不过那批工单是写死在代码里的列表。真实系统里工单存在文件里,一张工单一个 `.json` 文件,放在某个目录下。要读它们,第一步是找到它们:目录在哪、文件叫什么、存不存在、一共有几个。这就是今天的 pathlib。明天才真正打开文件读内容,今天只管「找」。

## 今天要解决的问题

学完今天,你应该能:

1. 用 `Path` 和 `/` 拼出一个路径,并用 `.name`、`.stem`、`.suffix`、`.parent` 把路径拆开。
2. 用 `.exists()`、`.is_file()`、`.is_dir()` 判断路径存不存在、是文件还是目录。
3. 用 `.glob()` 和 `.rglob()` 列出一个目录下所有 `.json` 文件,并且知道为什么要套一层 `sorted()`。
4. 说清楚「相对路径相对的是当前工作目录,不是脚本所在目录」,会用 `Path(__file__).resolve().parent` 写出在哪里运行都不出错的路径。

预计用时:2 小时。前置:[Day 3](/blog/agent-zero/day-003-terminal-1/) 的绝对路径和相对路径、[Day 4](/blog/agent-zero/day-004-terminal-2/) 的 mkdir、[Day 36](/blog/agent-zero/day-036-exceptions-2/) 的 raise。

学法:先对照文章逐行敲一遍(不要复制粘贴)并跑通;第二天合上文章,把最后的 `find_tickets.py` 默写出来;再做动手练习,做不出来再展开参考答案,看完关掉自己重写一遍。

今天的命令都在项目根目录 `agent-zero-lab` 里跑([Day 10](/blog/agent-zero/day-010-uv-1/) 用 `uv init` 建的),新文件放进 `part01/`。不调 API,花费 0 元。

## 先准备几个练习文件

为了有东西可找,先在终端里造一个小目录。`touch` 是今天新见的命令:文件不存在就建一个空文件,存在就只更新它的修改时间。建空文件就够了,今天不看内容。

```bash
mkdir -p part01/tickets/archive
touch part01/tickets/T-1001.json part01/tickets/T-1002.json part01/tickets/notes.txt
touch part01/tickets/archive/T-0901.json
ls -R part01/tickets
```

<div class="line-notes">

- `mkdir -p part01/tickets/archive` Day 4 学过,`-p` 让中间缺的目录一起建出来,已经存在也不报错。
- `touch part01/tickets/T-1001.json` 一次建三个空文件:两张工单,一个不是 json 的 `notes.txt`(后面用来测试筛选)。
- `touch part01/tickets/archive/T-0901.json` 子目录里放一张归档工单,后面用来区分 glob 和 rglob。
- `ls -R part01/tickets` `-R` 是递归列出,子目录里的东西也会列。

</div>

实测输出:

```text
T-1001.json	T-1002.json	archive		notes.txt

part01/tickets/archive:
T-0901.json
```

目录结构就是这样:

```text
agent-zero-lab/
└── part01/
    └── tickets/
        ├── T-1001.json
        ├── T-1002.json
        ├── notes.txt
        └── archive/
            └── T-0901.json
```

## 和 Node 对一下表

你在 Node 里处理路径用的是 `node:path` 模块,判断文件存在用 `fs`。Python 把这两件事合进了一个 `Path` 对象里。

| Node / JS | Python pathlib | 说明 |
| --- | --- | --- |
| `path.join("part01", "tickets")` | `Path("part01") / "tickets"` | 用 `/` 运算符拼路径 |
| `path.basename(p)` | `p.name` | 最后一段,`T-1001.json` |
| `path.basename(p, ".json")` | `p.stem` | 去掉扩展名,`T-1001` |
| `path.extname(p)` | `p.suffix` | 扩展名,`.json` |
| `path.dirname(p)` | `p.parent` | 上一级 |
| `__dirname` | `Path(__file__).resolve().parent` | 脚本自己所在的目录 |
| `process.cwd()` | `Path.cwd()` | 当前工作目录 |
| `fs.existsSync(p)` | `p.exists()` | 存不存在 |
| `fs.readdirSync(dir)` | `dir.iterdir()` | 列出目录里的东西 |

最大的区别是:Node 的路径就是字符串,`path.join` 返回的也是字符串;Python 的 `Path` 是一个对象,带着一堆属性和方法。你会觉得多了一层,但好处是不用再到处 `import path` 和 `import fs`,拿着一个 Path 想干什么就点什么。

## 第一步:用 / 拼路径,再把它拆开

新建 `part01/path_basics.py`:

```python
# agent-zero-lab/part01/path_basics.py
from pathlib import Path

folder = Path("part01") / "tickets"
p = folder / "T-1001.json"

print(p)
print(type(p).__name__)
print(p.name)
print(p.stem)
print(p.suffix)
print(p.parent)
print(p.parent.parent)
print(p.with_suffix(".txt"))
print(str(p))
```

<div class="line-notes">

- `from pathlib import Path` pathlib 是标准库,不用 `uv add`。`from ... import` 是 Day 32 学的写法,只把 `Path` 这一个名字拿进来。
- `folder = Path("part01") / "tickets"` 先用字符串造一个 Path 对象,然后用 `/` 接上 `"tickets"`。这里的 `/` 不是除法,Path 对象把这个运算符重新定义成了「拼一段路径」。左边是 Path、右边是字符串就行,结果还是 Path。
- `p = folder / "T-1001.json"` 可以一直往后接。现在 `p` 代表 `part01/tickets/T-1001.json`。注意这只是**一个路径的描述**,Python 这时候根本没去硬盘上看文件在不在。
- `print(p)` 实测打印 `part01/tickets/T-1001.json`。
- `print(type(p).__name__)` 实测 `PosixPath`。Mac 和 Linux 上 `Path(...)` 实际造出来的是 `PosixPath`,Windows 上是 `WindowsPath`,打印出来会是反斜杠 `part01\tickets\T-1001.json`。你写代码时一律写 `Path`,它自己会挑对的那种,所以同一份代码两个系统都能跑。
- `print(p.name)` 实测 `T-1001.json`,路径的最后一段。
- `print(p.stem)` 实测 `T-1001`,去掉最后一个扩展名。工单号正好就是文件名,所以 `.stem` 以后会常用。
- `print(p.suffix)` 实测 `.json`,带点。
- `print(p.parent)` 实测 `part01/tickets`,往上一级。
- `print(p.parent.parent)` 实测 `part01`,`.parent` 返回的还是 Path,所以能一直点下去。
- `print(p.with_suffix(".txt"))` 实测 `part01/tickets/T-1001.txt`。换扩展名,得到一个**新的** Path,原来的 `p` 不变。
- `print(str(p))` 实测 `part01/tickets/T-1001.json`。有些老库只收字符串不收 Path,这时候用 `str()` 转一下。

</div>

```bash
uv run python part01/path_basics.py
```

实测输出:

```text
part01/tickets/T-1001.json
PosixPath
T-1001.json
T-1001
.json
part01/tickets
part01
part01/tickets/T-1001.txt
part01/tickets/T-1001.json
```

这些属性放在一张图上看更清楚:

<figure>
<svg viewBox="0 0 640 170" role="img" aria-label="路径 part01/tickets/T-1001.json 拆成 parent、name、stem、suffix 四个部分">
<rect x="0" y="0" width="640" height="170" fill="var(--paper-raised)" rx="6"/>
<g font-family="var(--font-mono)" font-size="13">
<text x="60" y="70" fill="var(--ink)">part01/tickets/</text>
<text x="200" y="70" fill="var(--ink)">T-1001</text>
<text x="252" y="70" fill="var(--ink)">.json</text>
<line x1="60" y1="80" x2="190" y2="80" stroke="var(--mem)" stroke-width="2"/>
<text x="125" y="100" text-anchor="middle" fill="var(--mem)" font-size="12">.parent</text>
<line x1="200" y1="80" x2="292" y2="80" stroke="var(--compute)" stroke-width="2"/>
<text x="246" y="120" text-anchor="middle" fill="var(--compute)" font-size="12">.name</text>
<line x1="200" y1="42" x2="248" y2="42" stroke="var(--compute)"/>
<text x="224" y="34" text-anchor="middle" fill="var(--ink-soft)" font-size="12">.stem</text>
<line x1="252" y1="52" x2="292" y2="52" stroke="var(--compute)"/>
<text x="290" y="34" fill="var(--ink-soft)" font-size="12">.suffix</text>
<text x="340" y="70" fill="var(--ink-soft)" font-size="12">Path("part01") / "tickets" / "T-1001.json"</text>
<text x="60" y="150" fill="var(--ink-faint)" font-size="11">.parent 是 Path,能继续点;.name / .stem / .suffix 是字符串。</text>
</g>
</svg>
<figcaption>一个 Path 的四个常用部分。工单号 T-1001 就是 .stem。</figcaption>
</figure>

### 先踩一个坑:Path 不能用 + 拼

从 JS 过来,第一反应常常是用 `+` 拼字符串。新建 `part01/path_add.py` 试一下:

```python
# agent-zero-lab/part01/path_add.py
from pathlib import Path

p = Path("part01") + "/tickets"
```

<div class="line-notes">

- `p = Path("part01") + "/tickets"` Path 对象没有定义 `+`,只定义了 `/`。

</div>

实测报错(路径前面一截我换成了 `.../`):

```text
Traceback (most recent call last):
  File ".../agent-zero-lab/part01/path_add.py", line 4, in <module>
    p = Path("part01") + "/tickets"
        ~~~~~~~~~~~~~~~^~~~~~~~~~~~
TypeError: unsupported operand type(s) for +: 'PosixPath' and 'str'
```

「`+` 不支持 PosixPath 和 str 这两种类型」。编辑器里 basedpyright 也会提前画红线:`Operator "+" not supported for types "Path" and "Literal['/tickets']"`。改成 `Path("part01") / "tickets"` 就好。反过来,两个**字符串**之间也不能用 `/`,`"part01" / "tickets"` 会报 `TypeError: unsupported operand type(s) for /: 'str' and 'str'`,最左边至少得有一个 Path。

为什么不干脆用字符串拼 `"part01" + "/" + "tickets"`?在 Mac 上确实能用,但到了 Windows 分隔符是反斜杠;再加上斜杠多一个少一个(`"part01/" + "/tickets"`)的问题,手拼迟早出错。交给 Path,这些它都管。

## 第二步:相对路径到底相对谁

这是今天最重要的一节,也是我见过新手问得最多的问题:「文件明明就在那儿,为什么说找不到?」

[Day 3](/blog/agent-zero/day-003-terminal-1/) 学过,相对路径是从「当前所在的目录」开始算的。在终端里,当前目录就是 `pwd` 打印出来的那个。Python 程序运行时也有一个当前目录,叫**当前工作目录**(current working directory,简称 cwd),它等于你**在哪个目录敲的运行命令**,和脚本文件放在哪里无关。

新建 `part01/path_where.py`:

```python
# agent-zero-lab/part01/path_where.py
from pathlib import Path

print("当前工作目录:", Path.cwd())
print("这个脚本在:", Path(__file__).resolve().parent)

relative = Path("part01") / "tickets"
here = Path(__file__).resolve().parent / "tickets"

print("相对路径版本:", relative, relative.exists())
print("脚本目录版本:", here, here.exists())
```

<div class="line-notes">

- `print("当前工作目录:", Path.cwd())` `Path.cwd()` 返回当前工作目录,是绝对路径。下面会在两个不同目录各跑一次,这一行的值会变。
- `print("这个脚本在:", Path(__file__).resolve().parent)` 三步:`__file__` 是 Python 自动给每个脚本准备的变量,值是这个脚本文件的路径;`Path(...)` 把它变成 Path;`.resolve()` 把它变成完整的绝对路径(顺便把 `..` 之类的东西算掉);`.parent` 取它所在的目录。这一整串就是 Node 里的 `__dirname`。两次运行这一行的值都一样,都是 `.../agent-zero-lab/part01`。
- `relative = Path("part01") / "tickets"` 相对路径版本,从 cwd 开始算。
- `here = Path(__file__).resolve().parent / "tickets"` 从脚本所在目录开始算,得到绝对路径。
- `print("相对路径版本:", relative, relative.exists())` `.exists()` 这一刻才真正去硬盘上看。在项目根目录跑,`part01/tickets` 存在,实测 `True`;到 `part01` 里面去跑,它会去找 `part01/part01/tickets`,实测 `False`。
- `print("脚本目录版本:", here, here.exists())` 两次运行都是 `True`。

</div>

第一次,在项目根目录跑:

```bash
uv run python part01/path_where.py
```

实测输出:

```text
当前工作目录: .../agent-zero-lab
这个脚本在: .../agent-zero-lab/part01
相对路径版本: part01/tickets True
脚本目录版本: .../agent-zero-lab/part01/tickets True
```

第二次,先进到 `part01` 里再跑:

```bash
cd part01
uv run python path_where.py
cd ..
```

实测输出:

```text
当前工作目录: .../agent-zero-lab/part01
这个脚本在: .../agent-zero-lab/part01
相对路径版本: part01/tickets False
脚本目录版本: .../agent-zero-lab/part01/tickets True
```

同一个脚本,一行代码没改,相对路径版本从 `True` 变成了 `False`。因为 cwd 变了,`part01/tickets` 被解释成了 `.../agent-zero-lab/part01/part01/tickets`,那里什么都没有。

<figure>
<svg viewBox="0 0 640 220" role="img" aria-label="同一个相对路径 part01/tickets 在两个不同的当前工作目录下指向不同的位置,而基于 __file__ 的路径始终指向同一个位置">
<rect x="0" y="0" width="640" height="220" fill="var(--paper-raised)" rx="6"/>
<g font-family="var(--font-mono)" font-size="12">
<text x="20" y="30" fill="var(--ink)">在 agent-zero-lab/ 里运行</text>
<rect x="20" y="42" width="160" height="26" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="100" y="60" text-anchor="middle" fill="var(--ink)">cwd = agent-zero-lab</text>
<line x1="180" y1="55" x2="230" y2="55" stroke="var(--rule)"/>
<text x="240" y="60" fill="var(--ink)">+ part01/tickets → agent-zero-lab/part01/tickets  ✓</text>
<text x="20" y="105" fill="var(--ink)">在 agent-zero-lab/part01/ 里运行</text>
<rect x="20" y="117" width="160" height="26" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="100" y="135" text-anchor="middle" fill="var(--ink)">cwd = part01</text>
<line x1="180" y1="130" x2="230" y2="130" stroke="var(--rule)"/>
<text x="240" y="135" fill="var(--ink)">+ part01/tickets → part01/part01/tickets  ✗</text>
<rect x="20" y="166" width="160" height="26" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="100" y="184" text-anchor="middle" fill="var(--ink)">__file__ 的目录</text>
<line x1="180" y1="179" x2="230" y2="179" stroke="var(--rule)"/>
<text x="240" y="184" fill="var(--ink)">+ tickets → 永远是 part01/tickets  ✓</text>
</g>
</svg>
<figcaption>相对路径跟着「你在哪敲命令」走;Path(__file__).resolve().parent 跟着「脚本放在哪」走。</figcaption>
</figure>

结论很简单:**脚本要找和自己放在一起的文件,用 `Path(__file__).resolve().parent` 当起点**。用户传进来的路径(比如命令行参数里写的文件)则应该按 cwd 解释,那是用户的意思。这两种情况分清楚,「找不到文件」的问题能少一大半。

这个坑在第二部分会换个样子再出现:`.env` 文件放在项目根目录,你在子目录里跑脚本,读不到 API key。原理一模一样。

## 第三步:判断存不存在,列出目录内容

`.exists()` 上一步用过了,它只回答「有没有」。很多时候还得知道是文件还是目录。新建 `part01/path_check.py`:

```python
# agent-zero-lab/part01/path_check.py
from pathlib import Path

base = Path(__file__).resolve().parent / "tickets"

for name in ["T-1001.json", "archive", "T-9999.json"]:
    p = base / name
    print(f"{name:12} exists={p.exists()} is_file={p.is_file()} is_dir={p.is_dir()}")

for child in base.iterdir():
    print("目录里有:", child.name)

missing = base / "no-such-dir"
for child in missing.iterdir():
    print(child)
```

<div class="line-notes">

- `base = Path(__file__).resolve().parent / "tickets"` 第二步学的写法,`base` 是 `.../agent-zero-lab/part01/tickets` 的绝对路径。
- `for name in ["T-1001.json", "archive", "T-9999.json"]:` 三个名字:一个文件、一个目录、一个根本不存在的。
- `p = base / name` 拼出完整路径。
- `print(f"{name:12} exists=` `{name:12}` 是 f-string 的宽度写法,不足 12 个字符用空格补齐,让三行对齐。实测三行分别是:<br>`T-1001.json  exists=True is_file=True is_dir=False`<br>`archive      exists=True is_file=False is_dir=True`<br>`T-9999.json  exists=False is_file=False is_dir=False`<br>不存在的路径三个都是 False,不会报错。
- `for child in base.iterdir():` `.iterdir()` 列出目录下一层的所有东西,文件和子目录都有,不往子目录里钻。每个 `child` 都是 Path。
- `print("目录里有:", child.name)` 实测打印了四行:`archive`、`notes.txt`、`T-1002.json`、`T-1001.json`。注意顺序**既不是字母序也不是创建顺序**,是文件系统内部存的顺序,换台电脑可能就不一样。要固定顺序就得自己排,下一步讲。
- `missing = base / "no-such-dir"` 一个不存在的目录。造 Path 对象本身不会报错。
- `for child in missing.iterdir():` 真正去列的时候才报 `FileNotFoundError`,就是 [Day 35](/blog/agent-zero/day-035-exceptions-1/) 见过的那个异常。

</div>

实测输出:

```text
T-1001.json  exists=True is_file=True is_dir=False
archive      exists=True is_file=False is_dir=True
T-9999.json  exists=False is_file=False is_dir=False
目录里有: archive
目录里有: notes.txt
目录里有: T-1002.json
目录里有: T-1001.json
Traceback (most recent call last):
  File ".../agent-zero-lab/part01/path_check.py", line 14, in <module>
    for child in missing.iterdir():
                 ^^^^^^^^^^^^^^^^^
  File ".../uv/python/cpython-3.12.13-macos-x86_64-none/lib/python3.12/pathlib.py", line 1056, in iterdir
    for name in os.listdir(self):
                ^^^^^^^^^^^^^^^^
FileNotFoundError: [Errno 2] No such file or directory: '.../agent-zero-lab/part01/tickets/no-such-dir'
```

这个 traceback 比之前的多了一层:`pathlib.py, line 1056, in iterdir`。这是 Python 自己的标准库代码。用 Day 35 的读法,从下往上找到**第一个属于你自己的文件**,也就是 `path_check.py, line 14`,那才是你要改的地方。标准库那一层告诉你的是「它内部调用了 `os.listdir`」,一般不用管。

`[Errno 2]` 是操作系统给的错误编号,2 就是「没有这个文件或目录」。以后在终端里看到 `No such file or directory`,意思一样。

这里有个值得想一想的取舍:是先 `if p.exists():` 再操作,还是直接操作、用 try 接 `FileNotFoundError`?两种都行。简单脚本里先判断更好读;但判断和操作之间有一小段时间差,别的程序可能刚好在这时候把文件删了,所以真正读写文件的地方,try 才是靠得住的那一个。今天的最终脚本两种都用了,你可以对比着看。

## 第四步:glob 和 rglob,按模式找文件

`iterdir` 是全部列出来,我们只想要 `.json`。可以在循环里写 `if child.suffix == ".json"`,但 pathlib 直接提供了按模式找的方法。新建 `part01/path_glob.py`:

```python
# agent-zero-lab/part01/path_glob.py
from pathlib import Path

base = Path(__file__).resolve().parent / "tickets"

print("glob:")
for p in sorted(base.glob("*.json")):
    print(" ", p.name)

print("rglob:")
for p in sorted(base.rglob("*.json")):
    print(" ", p.relative_to(base))

print(base.glob("*.json"))
print(len(list(base.glob("*.json"))))
```

<div class="line-notes">

- `for p in sorted(base.glob("*.json")):` `glob` 的模式和 [Day 4](/blog/agent-zero/day-004-terminal-2/) 终端里的通配符一样,`*` 代表任意多个字符,`*.json` 就是「所有以 .json 结尾的」。只找当前这一层。外面套 `sorted()` 按路径字母序排好,顺序就固定了。
- `print(" ", p.name)` 实测两行:`T-1001.json`、`T-1002.json`。`notes.txt` 被筛掉了,`archive` 子目录里的 `T-0901.json` 也没有,因为 glob 不往下钻。
- `for p in sorted(base.rglob("*.json")):` `rglob` 的 r 是 recursive(递归),所有子目录、子目录的子目录都会找。
- `print(" ", p.relative_to(base))` `.relative_to(base)` 算出「相对于 base 的路径」,把前面那一长串绝对路径去掉。实测三行:`T-1001.json`、`T-1002.json`、`archive/T-0901.json`。
- `print(base.glob("*.json"))` 直接打印 glob 的返回值,实测是 `<generator object Path.glob at 0x1103d2ac0>`(最后的地址每次不同)。它不是列表,是一个**生成器**:你可以先把它理解成「一个只能从头到尾走一遍的序列」,for 循环能用,但不能 `len()`、不能用下标取。生成器 [Day 99](/blog/agent-zero/day-099-generators/) 会专门讲。
- `print(len(list(base.glob("*.json"))))` 想要个数,先用 `list()` 把它变成列表。实测 `2`。

</div>

实测输出:

```text
glob:
  T-1001.json
  T-1002.json
rglob:
  T-1001.json
  T-1002.json
  archive/T-0901.json
<generator object Path.glob at 0x1103d2ac0>
2
```

还有一个写法:`base.glob("**/*.json")`,`**` 代表「任意多层目录」,效果和 `rglob("*.json")` 一样。我建议直接用 rglob,意思一眼就能看出来。

## 把零件拼起来:找出所有工单文件

最后拼一个下周还会用到的小工具:给一个目录,返回里面所有工单文件(包括子目录),目录不存在或者不是目录就抛异常。新建 `part01/find_tickets.py`:

```python
# agent-zero-lab/part01/find_tickets.py
from pathlib import Path

HERE = Path(__file__).resolve().parent


def find_ticket_files(folder: Path) -> list[Path]:
    if not folder.exists():
        raise FileNotFoundError(f"工单目录不存在: {folder}")
    if not folder.is_dir():
        raise NotADirectoryError(f"这不是目录: {folder}")
    return sorted(folder.rglob("*.json"))


files = find_ticket_files(HERE / "tickets")
print(f"找到 {len(files)} 个工单文件")
for f in files:
    print(f"  {f.stem:8} 在 {f.parent.relative_to(HERE)}")

try:
    find_ticket_files(HERE / "tickets" / "T-1001.json")
except NotADirectoryError as e:
    print("出错:", e)

find_ticket_files(HERE / "ticket")
```

<div class="line-notes">

- `HERE = Path(__file__).resolve().parent` 脚本所在目录,全大写是 Python 的习惯:表示「这是个常量,定下来就不改」,和 JS 里大写的 `const API_BASE` 一个意思。
- `def find_ticket_files(folder: Path) -> list[Path]:` 参数类型是 `Path`,返回「Path 组成的列表」。
- `if not folder.exists():` 先判断存不存在。
- `raise FileNotFoundError(f"工单目录不存在: {folder}")` Day 36 的 raise,这次借用内置的 `FileNotFoundError`,换上一句中文说明。为什么不让 rglob 自己报错?实测 Python 3.12 里对不存在的目录调 `rglob`,不报错,直接返回空,结果就是「找到 0 个工单文件」,你会以为目录是空的。自己先检查,错误才说得清楚。
- `if not folder.is_dir():` 存在但不是目录,比如传进来的是一个文件。
- `raise NotADirectoryError(f"这不是目录: {folder}")` 内置异常里正好有这个类型。
- `return sorted(folder.rglob("*.json"))` `sorted()` 收一个生成器,返回的是列表,所以返回类型能写 `list[Path]`。
- `files = find_ticket_files(HERE / "tickets")` 正常情况。实测 `files` 里有 3 个 Path。
- `print(f"找到 {len(files)} 个工单文件")` 实测 `找到 3 个工单文件`。
- `for f in files:` 逐个打印。
- `print(f"  {f.stem:8} 在 {f.parent.relative_to(HERE)}")` 工单号补齐到 8 个字符宽,后面是相对于 `part01/` 的所在目录。实测三行:`T-1001   在 tickets`、`T-1002   在 tickets`、`T-0901   在 tickets/archive`。按路径字母序,`archive/T-0901.json` 排在 `T-1001.json` 之后,因为排序比较的是整条路径的每一段。
- `find_ticket_files(HERE / "tickets" / "T-1001.json")` 故意传一个文件进去。
- `except NotADirectoryError as e:` 接住。
- `print("出错:", e)` 实测 `出错: 这不是目录: .../agent-zero-lab/part01/tickets/T-1001.json`。
- `find_ticket_files(HERE / "ticket")` 故意把 `tickets` 少写一个 s,没有 try,程序会崩。

</div>

```bash
uv run python part01/find_tickets.py
```

实测输出:

```text
找到 3 个工单文件
  T-1001   在 tickets
  T-1002   在 tickets
  T-0901   在 tickets/archive
出错: 这不是目录: .../agent-zero-lab/part01/tickets/T-1001.json
Traceback (most recent call last):
  File ".../agent-zero-lab/part01/find_tickets.py", line 25, in <module>
    find_ticket_files(HERE / "ticket")
  File ".../agent-zero-lab/part01/find_tickets.py", line 9, in find_ticket_files
    raise FileNotFoundError(f"工单目录不存在: {folder}")
FileNotFoundError: 工单目录不存在: .../agent-zero-lab/part01/ticket
```

最后一行的报错把拼错的完整路径打了出来,一眼就能看到是 `ticket` 少了个 s。如果只写「目录不存在」不带路径,你得回去翻代码才知道它找的是哪。**报错信息里带上出错的那个值**,这个习惯在 Agent 开发里特别值钱:工具调用失败时,报错信息是要回传给模型看的,模型能不能自己改对,就看你的报错写得清不清楚。

我还在根目录以外的地方(`cd /` 之后用完整路径运行)跑了一次,前四行输出完全一样,因为所有路径都从 `HERE` 出发,和 cwd 无关。

零件对照:

| 前面的零件 | 在 find_tickets.py 里是哪一段 |
| --- | --- |
| 第一步:`/` 拼路径,`.stem`、`.parent` | `HERE / "tickets"`,打印时的 `f.stem` 和 `f.parent` |
| 第二步:`Path(__file__).resolve().parent` | 第一行的 `HERE` |
| 第三步:`.exists()`、`.is_dir()` | 函数里的两道检查 |
| 第四步:`rglob` + `sorted` | 函数最后的 `return` |

明天读文件内容时,这个 `find_ticket_files` 会直接拿来用。

## 动手练习

**练习 1:拆路径。** 对路径 `part01/tickets/archive/T-0901.json`,分别打印它的 name、stem、suffix、上一级目录的名字,把扩展名换成 `.bak` 的新路径,以及 `.parts`(把路径拆成每一段)。文件名 `part01/ex37_parts.py`。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part01/ex37_parts.py
from pathlib import Path

p = Path("part01") / "tickets" / "archive" / "T-0901.json"
print("name:", p.name)
print("stem:", p.stem)
print("suffix:", p.suffix)
print("上一级目录名:", p.parent.name)
print("改成 .bak:", p.with_suffix(".bak"))
print("拆开:", p.parts)
```

<div class="line-notes">

- `p = Path("part01") / "tickets" / "archive" / "T-0901.json"` 一路拼下去。这个练习不碰硬盘,所以不用 `__file__`。
- `print("name:", p.name)` 实测 `name: T-0901.json`。
- `print("stem:", p.stem)` 实测 `stem: T-0901`。
- `print("suffix:", p.suffix)` 实测 `suffix: .json`。
- `print("上一级目录名:", p.parent.name)` `.parent` 是 `part01/tickets/archive`,再取 `.name` 就是最后一段,实测 `上一级目录名: archive`。
- `print("改成 .bak:", p.with_suffix(".bak"))` 实测 `改成 .bak: part01/tickets/archive/T-0901.bak`。
- `print("拆开:", p.parts)` `.parts` 是一个元组(Day 22 学的 tuple),实测 `拆开: ('part01', 'tickets', 'archive', 'T-0901.json')`。

</div>

实测输出:

```text
name: T-0901.json
stem: T-0901
suffix: .json
上一级目录名: archive
改成 .bak: part01/tickets/archive/T-0901.bak
拆开: ('part01', 'tickets', 'archive', 'T-0901.json')
```

</details>

**练习 2:按扩展名计数。** 统计 `part01/tickets` 及其所有子目录里,每种扩展名的文件各有几个,结果存在一个字典里打印出来。目录不算。文件名 `part01/ex37_count.py`。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part01/ex37_count.py
from pathlib import Path

base = Path(__file__).resolve().parent / "tickets"

counts: dict[str, int] = {}
for p in base.rglob("*"):
    if p.is_file():
        counts[p.suffix] = counts.get(p.suffix, 0) + 1

print(counts)
```

<div class="line-notes">

- `base = Path(__file__).resolve().parent / "tickets"` 用脚本目录当起点,在哪运行都行。
- `counts: dict[str, int] = {}` 空字典,键是扩展名,值是个数。
- `for p in base.rglob("*"):` `*` 匹配所有东西,rglob 会把每一层都列出来,包括 `archive` 这个目录本身。
- `if p.is_file():` 把目录过滤掉。不加这一行,`archive` 的 suffix 是空字符串 `""`,会多出一项 `'': 1`。
- `counts[p.suffix] = counts.get(p.suffix, 0) + 1` Day 24 的计数写法:没见过的扩展名先当 0,再加 1。
- `print(counts)` 实测 `{'.txt': 1, '.json': 3}`。键的顺序取决于 rglob 先碰到谁,这里先碰到了 `notes.txt`。

</div>

实测输出:

```text
{'.txt': 1, '.json': 3}
```

</details>

**练习 3:建按月份的目录。** 用 pathlib 在 `part01/tickets/` 下建 `2026/10` 两层目录(中间的 `2026` 也不存在),要求重复运行不报错。然后在同一个脚本最后,故意不带参数再调一次 `mkdir()`,看看报什么错。文件名 `part01/ex37_mkdir.py`。提示:`Path.mkdir` 有两个参数 `parents` 和 `exist_ok`,对应终端 `mkdir -p` 的两个效果。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part01/ex37_mkdir.py
from pathlib import Path

month = Path(__file__).resolve().parent / "tickets" / "2026" / "10"
month.mkdir(parents=True, exist_ok=True)
print(month.relative_to(Path(__file__).resolve().parent), month.is_dir())

month.mkdir()
```

<div class="line-notes">

- `month = Path(__file__).resolve().parent / "tickets" / "2026" / "10"` 目标目录。
- `month.mkdir(parents=True, exist_ok=True)` `parents=True`:中间缺的 `2026` 一起建;`exist_ok=True`:已经存在就算了,不报错。合起来就是终端里的 `mkdir -p`。这是 Day 29 学的关键字参数写法。
- `print(month.relative_to(` 实测 `tickets/2026/10 True`,目录建好了。
- `month.mkdir()` 不带参数,默认 `exist_ok=False`,目录已经存在就报错。

</div>

实测输出:

```text
tickets/2026/10 True
Traceback (most recent call last):
  File ".../agent-zero-lab/part01/ex37_mkdir.py", line 8, in <module>
    month.mkdir()
  File ".../lib/python3.12/pathlib.py", line 1311, in mkdir
    os.mkdir(self, mode)
FileExistsError: [Errno 17] File exists: '.../agent-zero-lab/part01/tickets/2026/10'
```

`FileExistsError` 是 `FileNotFoundError` 的兄弟,`[Errno 17]` 是操作系统的「文件已存在」。如果第一次就不带 `parents=True` 去建 `2026/10`,会报 `FileNotFoundError`,因为上一级 `2026` 不存在。你可以先 `rm -r part01/tickets/2026` 删掉再试一次。

</details>

**练习 4:观察会发生什么。** 把第三步的 `path_check.py` 里 `base` 那一行改成相对路径 `base = Path("part01") / "tickets"`,先在项目根目录跑,再 `cd part01` 进去跑一次。猜一下第二次三行 `exists=` 分别是什么,`iterdir` 那里会怎样。

<details><summary>参考答案</summary>

在项目根目录跑,结果和正文一模一样。进到 `part01` 里跑,`base` 被解释成 `part01/part01/tickets`,三个名字全都 `exists=False is_file=False is_dir=False`,然后第一个 `iterdir()` 就崩了,报 `FileNotFoundError: [Errno 2] No such file or directory: 'part01/tickets'`。注意报错里的路径是相对路径 `part01/tickets`,它不告诉你 cwd 是什么,这正是这类 bug 难查的原因。正文 `path_where.py` 第二次运行的 `相对路径版本: part01/tickets False` 就是同一个现象。改回 `Path(__file__).resolve().parent / "tickets"` 后,两个目录下跑结果一致。

</details>

验收标准:四个练习都能跑出和上面一致的结果;能不看文章写出 `Path(__file__).resolve().parent` 并说出每一段在干什么;能解释为什么 `iterdir()` 的输出要 `sorted()`。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| pathlib | Python 标准库里处理路径的模块,核心是 `Path` 类 |
| Path | 表示一个文件或目录路径的对象,用 `/` 拼接,带 `.name`、`.parent` 等属性。造出来时不会检查硬盘 |
| PosixPath / WindowsPath | `Path` 在 Mac/Linux 和 Windows 上实际变成的两种类型,分隔符分别是 `/` 和 `\` |
| name / stem / suffix | 路径最后一段 / 去掉扩展名的最后一段 / 扩展名(带点) |
| parent | 上一级目录,结果还是 Path |
| 当前工作目录(cwd) | 程序运行时的「当前所在目录」,等于你在哪敲的运行命令。相对路径从这里开始算 |
| `__file__` | Python 自动给每个脚本准备的变量,值是脚本文件自己的路径 |
| resolve() | 把路径变成完整的绝对路径,顺便算掉 `..` 和符号链接 |
| iterdir() | 列出目录下一层的所有文件和子目录,顺序不固定 |
| glob / rglob | 按通配符模式找文件;glob 只找当前层,rglob 递归找所有子目录 |
| 生成器(generator) | 一种只能从头到尾走一遍的序列,能 for 循环,不能 len();glob 返回的就是它 |
| relative_to() | 算出一个路径相对于另一个路径的那一截 |
| touch | 终端命令,文件不存在就建一个空文件 |

## 常见误区

**用 + 拼 Path。** 实测报 `TypeError: unsupported operand type(s) for +: 'PosixPath' and 'str'`。Path 用 `/` 拼。两个字符串之间用 `/` 也不行,最左边至少要有一个 Path。

**以为相对路径相对的是脚本所在目录。** 相对的是 cwd。同一个脚本在根目录跑能找到文件,进子目录跑就找不到,`path_where.py` 实测演示过。脚本找自己身边的文件,用 `Path(__file__).resolve().parent` 当起点。

**觉得 resolve() 可有可无。** Python 3.9 起,直接运行的脚本 `__file__` 已经是绝对路径,所以 `Path(__file__).parent` 多数时候也能用。但我实测在 `part01` 里用 `uv run python ../part01/whereami.py` 运行时,`__file__` 打印出来是 `.../agent-zero-lab/part01/../part01/whereami.py`,中间夹着一个 `..`;拿它去拼路径、打印报错、比较两个路径是否相同,都容易出岔子。加上 `.resolve()` 把这些都算掉,成本为零,养成习惯。

**依赖 iterdir() 或 glob() 的顺序。** 实测 `iterdir()` 给出的是 `archive, notes.txt, T-1002.json, T-1001.json`,不是字母序,在别人的电脑上可能又不一样。凡是顺序会影响结果的(打印给人看、写测试、取第一个),都套一层 `sorted()`。

**对 glob 的结果调 len()。** glob 返回生成器,`len(base.glob("*.json"))` 会报 `TypeError: object of type 'generator' has no len()`。先 `list()` 再 `len()`。

**以为 Path 对象造出来就说明文件存在。** `Path("T-9999.json")` 完全合法,只是一个描述。只有调 `.exists()`、`.iterdir()` 这种方法时才真正去硬盘上看。

**对不存在的目录 rglob,以为会报错。** 实测 Python 3.12 里 `Path("no-such-dir").rglob("*.json")` 不报错,返回空,结果「找到 0 个」很像目录是空的。要区分「空目录」和「目录不存在」,先自己 `.exists()` 检查,像 `find_ticket_files` 那样。

## 学习资料

### 文档与文章

- [Python 标准库 · pathlib(中文)](https://docs.python.org/zh-cn/3.12/library/pathlib.html):官方文档,前面那张类关系图可以跳过,直接看「基础使用」和「方法和属性」。页面最后有一张 os.path 和 pathlib 的对照表,以后读老代码看到 `os.path.join` 时回来查。
- [Node.js 文档 · path](https://nodejs.org/api/path.html):前端那边的对照,`path.join`、`path.basename`、`path.extname` 和今天的表一一对得上。
- [PEP 428 · The pathlib module](https://peps.python.org/pep-0428/):pathlib 当年为什么要设计成对象而不是字符串函数,英文,读前两节「Why an object-oriented API」就够了。
- [Automate the Boring Stuff with Python 第 3 版 · 第 10 章](https://automatetheboringstuff.com/3e/chapter10.html):英文,免费在线。前半章用 pathlib 讲路径、cwd、绝对和相对路径,图很多,和今天的内容几乎一一对应。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1JaTg62E54&autoplay=0&high_quality=1" title="6分钟学会用 pathlib 优雅搞定文件路径" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>IT阿杰 · 6分钟学会用 pathlib 优雅搞定文件路径 · 6 分钟,快速过一遍拼路径和常用属性,适合先看。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV113ixBqEcS&autoplay=0&high_quality=1" title="新手必看!Python 用 pathlib 读取文件,简单到离谱" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>水哥澎湃 · 新手必看!Python 用 pathlib 读取文件,简单到离谱 · 16 分钟,用 pathlib 找文件和读文件,读文件的部分留到明天对照看。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/yxa-DJuuTBI" title="Python Tutorial: Pathlib - The Modern Way to Handle File Paths" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Corey Schafer · Python Tutorial: Pathlib - The Modern Way to Handle File Paths · 英文,把 pathlib 常用的属性和方法系统过一遍,开英文字幕能跟上。</figcaption>
</figure>

### 书籍

- 《Python 编程:从入门到实践(第 3 版)》,Eric Matthes 著,人民邮电出版社。第 3 版的第 10 章改用 pathlib 讲文件路径,和今天的写法一致,可以当第二份讲解看。
- 《Automate the Boring Stuff with Python, 3rd Edition》,Al Sweigart 著,No Starch Press。上面「文档与文章」里的第 10 章就是这本书的在线版,英文。

### 开源项目与代码

- [CPython 3.12 的 `Lib/pathlib.py`](https://github.com/python/cpython/blob/3.12/Lib/pathlib.py):pathlib 的源码,一个文件。搜 `def __truediv__` 就能看到 `/` 是怎么被重新定义成「拼路径」的,只有几行;搜 `def iterdir` 能看到正文 traceback 里那行 `os.listdir(self)`。现在看不懂类的写法没关系,Day 40 之后回来再看。

## 自测

1. `Path("part01") / "tickets" / "T-1001.json"` 的 `.stem`、`.suffix`、`.parent` 分别是什么?

<details><summary>答案</summary>

`.stem` 是 `T-1001`,`.suffix` 是 `.json`,`.parent` 是 `part01/tickets`(一个 Path)。

</details>

2. 一个脚本在项目根目录 `uv run python part01/x.py` 能读到 `part01/data.txt`,`cd part01` 之后再跑就报 `FileNotFoundError`。最可能的原因是什么,怎么改?

<details><summary>答案</summary>

代码里用的是相对路径 `Path("part01/data.txt")`,它相对的是当前工作目录。进到 `part01` 之后,它变成了找 `part01/part01/data.txt`。改成 `Path(__file__).resolve().parent / "data.txt"`,从脚本所在目录出发。

</details>

3. `glob("*.json")` 和 `rglob("*.json")` 有什么区别?在今天的 `tickets` 目录下各找到几个?

<details><summary>答案</summary>

glob 只找当前这一层,rglob 递归找所有子目录。今天的目录里 glob 找到 2 个(T-1001、T-1002),rglob 找到 3 个(多了 archive/T-0901)。

</details>

4. 为什么 `print(base.glob("*.json"))` 打印出来不是文件列表?怎么得到个数?

<details><summary>答案</summary>

glob 返回的是生成器,打印出来是 `<generator object Path.glob at 0x...>`。用 `len(list(base.glob("*.json")))` 先转成列表再数。

</details>

5. `Path("T-9999.json")` 这一行会因为文件不存在而报错吗?

<details><summary>答案</summary>

不会。造 Path 对象只是描述一个路径,不碰硬盘。`.exists()` 会返回 False;只有像 `.iterdir()`、打开文件这种真正要访问它的操作才会报 `FileNotFoundError`。

</details>

## 明天预告

[Day 38 · 读写文件和 with](/blog/agent-zero/day-038-files-with/)。今天找到了文件,但它们还是空的。明天用 `open` 把工单写进文本文件再读回来,学会用 `with` 自动关文件。`with` 背后其实就是 Day 36 学的 `finally`,所以这两天正好接上。
