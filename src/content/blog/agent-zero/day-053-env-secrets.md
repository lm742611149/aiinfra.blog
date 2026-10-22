---
title: 'Day 53 · 环境变量和密钥:.env、python-dotenv、.gitignore'
description: 'API key 等于钱包密码,不能写进代码,也不能进 git。今天用 os.environ 读环境变量(≈process.env),用 python-dotenv 把 .env 文件读进来,弄清它往哪找文件、谁覆盖谁、哪些写法会让 key 悄悄变样;再改 .gitignore 让 .env 永远不进仓库。最后用 pydantic 写一个会校验、打印时自动打码的配置模型 settings.py。'
pubDate: 2026-10-23
regime: none
tags: ['python', 'security', 'agent-zero']
series: 'agent-zero'
day: 53
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 51](/blog/agent-zero/day-051-pydantic-1/) 和 [Day 52](/blog/agent-zero/day-052-pydantic-2/) 两天都在讲一件事:外面进来的数据不能信,要在门口用 pydantic 校验。Day 52 的 `ticket_pd.py` 给工单加上了「金额必须为正」「工单号像 T-1004」这些规则,读写 JSON 都走 `model_validate` 和 `model_dump`。

程序还有一类外来数据:配置。服务地址、模型名,还有最要命的 API key。[Day 2](/blog/agent-zero/day-002-setup-budget/) 那段 Node 代码已经用 `process.env.LLM_API_KEY` 读过 key,当时没细讲。[Day 120](/blog/agent-zero/day-120-api-register/) 你会去 DeepSeek 注册、充值、拿到一串真的 `sk-` 开头的 key,在那之前,今天先把「key 放哪、怎么读、怎么保证不泄露」这套规矩立好。今天全程用假 key,不需要任何账号。

## 今天要解决的问题

学完今天,你应该能:

1. 用 `os.environ` 读环境变量,说清 `os.environ["X"]` 和 `os.environ.get("X")` 在变量没设置时的区别,知道为什么配置类的值要用前者。
2. 用 python-dotenv 的 `load_dotenv()` 把 `.env` 读进环境变量;知道它从哪个目录开始找文件、什么时候返回 False,`override` 参数决定谁覆盖谁;认得几种会让 key 悄悄变样的 `.env` 写法。
3. 在 `.gitignore` 里写好 `.env` 的规则,用 `git check-ignore -v` 验证生效,再提交一份不含真 key 的 `.env.example`。
4. 写出 `part01/settings.py`:读三个 `LLM_*` 变量,用 pydantic 校验,key 打印出来自动变成星号。

预计用时:2 小时。前置:[Day 7](/blog/agent-zero/day-007-terminal-4/) 的环境变量和 export、[Day 10](/blog/agent-zero/day-010-uv-1/) 的 `uv add`(uv init 时顺手建了 `.git` 和 `.gitignore`)、[Day 37](/blog/agent-zero/day-037-pathlib/) 的「从哪个目录运行」、[Day 52](/blog/agent-zero/day-052-pydantic-2/) 的 Field。

学法:先对照文章逐行敲一遍(不要复制粘贴)并跑通;第二天合上文章,把 `settings.py` 的 `load_settings` 和 `.gitignore` 里那三行默写出来;再做动手练习,做不出来再展开参考答案,看完关掉自己重写一遍。

命令都在项目根目录 `agent-zero-lab` 里跑,新脚本放进 `part01/`,`.env` 这类配置文件放在**项目根目录**。今天装一个包 python-dotenv,不调 API,花费 0 元。下面输出里的长路径我缩短了,家目录写成 `/Users/你`。

## 先说为什么:key 写进代码会怎样

最省事的写法当然是把 key 直接写在代码里:

```python
# agent-zero-lab/part01/leaky.py  反面教材:key 直接写在代码里(这是假 key)
API_KEY = "sk-fake-leaked-9f8e7d6c5b4a"
```

<div class="line-notes">

- `API_KEY = "sk-fake-leaked-9f8e7d6c5b4a"` 一个假 key,长得和 DeepSeek、OpenAI 的 key 一样以 `sk-` 开头。今天的练习 2 会写个脚本把它找出来,所以请照样建这个文件。

</div>

这样写的问题不在这一行本身,在于代码会去很多地方:你会把它 push 到 GitHub(Day 58),会截图发给别人问问题,会把整个文件贴给 AI 助手让它帮忙改,会分享给同事。每一处都会把 key 一起带出去。而且 git 会记住每一次提交,哪天你发现了、把这一行删掉再提交,历史记录里那个版本还在,别人翻历史照样能看到。

key 泄露的后果很直接:别人拿你的 key 调接口,花的是你充进去的钱。公开仓库里一旦出现 key,会有人用脚本专门扫这种东西,时间以分钟计。GitHub 自己也有「secret scanning」功能,发现推上去的代码里有已知格式的密钥会报警或直接拦下推送,但它只认识一部分厂商的格式,不能指望它兜底。

前端同学对这件事应该有一点体感。Vite 项目里只有 `VITE_` 开头的环境变量会被打包进浏览器代码,打包进去的东西任何人打开 DevTools 都看得到,所以 Vite 文档专门提醒别把密钥放进 `VITE_` 变量。后端这边规矩是一样的:**密钥只存在于运行程序的那台机器的环境里,不出现在代码文件中**。

## 第一步:os.environ,Python 版的 process.env

[Day 7](/blog/agent-zero/day-007-terminal-4/) 讲过,环境变量是每个程序启动时从父进程(通常是终端)那里继承的一组「名字=值」,Node 里是 `process.env`。Python 里叫 `os.environ`,用起来像一个字典。新建 `part01/env_basic.py`:

```python
# agent-zero-lab/part01/env_basic.py
import os

print(os.environ["HOME"])
print(os.environ.get("LLM_MODEL"))
print(os.getenv("LLM_MODEL", "没设置"))
print(os.environ["LLM_API_KEY"])
```

<div class="line-notes">

- `import os` 标准库,os 是 operating system(操作系统)的缩写,和系统打交道的东西都在这里。
- `print(os.environ["HOME"])` 方括号取值,和字典一样。HOME 是家目录,每台 Mac 都有。≈ `process.env.HOME`。
- `print(os.environ.get("LLM_MODEL"))` `.get` 取不到时返回 None,不报错(Day 24 字典的 get)。
- `print(os.getenv("LLM_MODEL", "没设置"))` `os.getenv` 是 `os.environ.get` 的简写,第二个参数是取不到时的默认值。
- `print(os.environ["LLM_API_KEY"])` 方括号取一个肯定没有的变量,看会怎样。

</div>

先直接跑,再在命令前面临时加一个变量跑一次:

```bash
uv run python part01/env_basic.py
LLM_MODEL=deepseek-flash uv run python part01/env_basic.py
```

第一次的实测输出:

```text
/Users/你
None
没设置
Traceback (most recent call last):
  File "/Users/你/agent-zero-lab/part01/env_basic.py", line 7, in <module>
    print(os.environ["LLM_API_KEY"])
          ~~~~~~~~~~^^^^^^^^^^^^^^^
  File "<frozen os>", line 714, in __getitem__
KeyError: 'LLM_API_KEY'
```

第二次的前三行变成了:

```text
/Users/你
deepseek-flash
deepseek-flash
```

最后的 KeyError 两次都一样。

`LLM_MODEL=deepseek-flash uv run ...` 这种写法是在**这一条命令**前面临时设一个环境变量,只对这次运行有效,跑完就没了。和 Day 7 的 `export` 不同,export 是对整个终端窗口有效。

再看 `[]` 和 `.get` 的区别。没设置的变量,`.get` 安静地给你 None,`[]` 当场抛 KeyError,而且报错里写着变量名 `'LLM_API_KEY'`。对于 API key 这种**程序没它就没法干活**的配置,我推荐用 `[]`。拿到 None 不报错,程序会继续往下跑,一直跑到真正发请求时,服务器回一个 401「未授权」,那时你得倒推半天才想到「哦,key 根本没读到」。用 `[]`,问题在第一行就暴露,报错直接告诉你缺的是哪个变量。

`.get` 留给真正可选的配置,比如「日志级别,不设就用 INFO」。

## 第二步:.env 文件和 python-dotenv

每次跑程序都在命令前面敲一长串 `LLM_API_KEY=sk-...` 不现实,写进 `~/.zshrc` 又会让所有项目共用一套配置。通行的做法是在项目根目录放一个叫 `.env` 的文本文件,一行一个 `名字=值`,程序启动时把它读进环境变量。前端你肯定见过:Vite 会自动读 `.env`,Node 20.6 起可以 `node --env-file=.env`,Day 2 那段代码就是这么跑的。Python 这边最常用的是 python-dotenv 这个库。

### 装 python-dotenv,写 .env

```bash
uv add python-dotenv
```

实测输出:

```text
Resolved 9 packages in 2.26s
Installed 1 package in 13ms
 + python-dotenv==1.2.4
```

2026 年 10 月 PyPI 上的最新版是 1.2.4。包名叫 python-dotenv,但 import 时写 `dotenv`,这两个对不上是正常的。

然后在**项目根目录**(和 `pyproject.toml` 同一层)新建一个文件,名字就叫 `.env`,前面有个点,没有扩展名:

```bash
# agent-zero-lab/.env  这里的 key 是假的,Day 120 换成真的
LLM_BASE_URL=https://api.deepseek.com
LLM_API_KEY=sk-fake-day53-0123456789abcdef
LLM_MODEL=deepseek-flash
```

三个变量名是这门课的约定,第二部分起所有调大模型的代码都读它们:`LLM_BASE_URL` 是接口地址,`LLM_API_KEY` 是密钥,`LLM_MODEL` 是模型名。`#` 开头的行是注释。

以点开头的文件在 Finder 里默认看不见,按 `Cmd + Shift + .` 显示,终端里用 `ls -a`(Day 3)。编辑器的文件树一般能直接看到。用 macOS 自带的「文本编辑」建这个文件要小心:它可能自动加上 `.txt` 后缀,还可能把直引号换成弯引号,这两个坑下面都会实测。

### load_dotenv:把 .env 读进来

新建 `part01/dotenv_basic.py`:

```python
# agent-zero-lab/part01/dotenv_basic.py
import os

from dotenv import find_dotenv, load_dotenv

print("读之前:", "LLM_API_KEY" in os.environ)
print("找到的文件:", find_dotenv())
print("load_dotenv 返回:", load_dotenv())
print("读之后:", "LLM_API_KEY" in os.environ)
key = os.environ["LLM_API_KEY"]
print("key 前 6 位:", key[:6], "长度:", len(key))
print("模型:", os.environ["LLM_MODEL"])
```

<div class="line-notes">

- `from dotenv import find_dotenv, load_dotenv` load_dotenv 读文件并设环境变量;find_dotenv 只负责找文件,返回找到的路径。
- `print("读之前:", "LLM_API_KEY" in os.environ)` `in` 判断有没有这个键,和字典一样。
- `print("找到的文件:", find_dotenv())` 看它找到的是哪个 .env。找不到返回空字符串。
- `print("load_dotenv 返回:", load_dotenv())` 读进来。返回 True 表示找到并读了文件,False 表示没找到。
- `key = os.environ["LLM_API_KEY"]` 读完以后,.env 里的值就和普通环境变量一样从 os.environ 取。
- `print("key 前 6 位:", key[:6], "长度:", len(key))` **不要把完整的 key 打印出来**。终端输出会被截图、会进日志。只看开头几位和长度,足够判断读对了没有。

</div>

在项目根目录跑一次,再进 `part01` 目录跑一次:

```bash
uv run python part01/dotenv_basic.py
cd part01 && uv run python dotenv_basic.py && cd ..
```

两次的实测输出完全一样:

```text
读之前: False
找到的文件: /Users/你/agent-zero-lab/.env
load_dotenv 返回: True
读之后: True
key 前 6 位: sk-fak 长度: 30
模型: deepseek-flash
```

读之前没有,读之后有了,`load_dotenv()` 返回 True。key 长度 30,和 `.env` 里写的 `sk-fake-day53-0123456789abcdef` 一致。

两次都找到了根目录的 `.env`,这一点值得多说一句。[Day 37](/blog/agent-zero/day-037-pathlib/) 讲相对路径时提过:「`.env` 放在项目根目录,你在子目录里跑脚本,读不到 API key」。那是相对路径的通病。不带参数的 `load_dotenv()` 没这个问题,它不是从当前目录找,而是**从调用它的那个脚本文件所在的目录开始,一级一级往上找**,`part01/dotenv_basic.py` 在 part01 里没找到 `.env`,就去上一级 `agent-zero-lab` 找,找到了。所以 `.env` 放在项目根目录,项目里任何子目录的脚本都能读到。

### 找不到的时候

现在模拟一个常见事故:用「文本编辑」建文件,它悄悄存成了 `.env.txt`;或者你手滑写成了 `env`。用终端把 `.env` 改个名试试:

```bash
mv .env env
uv run python part01/dotenv_basic.py
mv env .env
```

实测输出(只留关键几行):

```text
读之前: False
找到的文件: 
load_dotenv 返回: False
读之后: False
Traceback (most recent call last):
  File "/Users/你/agent-zero-lab/part01/dotenv_basic.py", line 10, in <module>
    key = os.environ["LLM_API_KEY"]
          ~~~~~~~~~~^^^^^^^^^^^^^^^
KeyError: 'LLM_API_KEY'
```

`load_dotenv()` 找不到文件时**不报错**,只是安静地返回 False。如果后面用的是 `.get`,程序会带着一个 None 继续跑;幸好我们用的是 `[]`,第 10 行当场 KeyError。这就是第一步推荐 `[]` 的原因。看到 `KeyError: 'LLM_...'`,先查三件事:`.env` 文件在不在项目根目录、文件名是不是正好叫 `.env`、里面的变量名有没有拼错。

uv 自己也能读 `.env`:`uv run --env-file .env python 脚本.py`,效果类似,我实测能读到。这门课统一在代码里用 `load_dotenv()`,这样不管用什么命令启动,代码自己负责加载配置,不依赖启动方式。

### 谁覆盖谁:override

如果终端里已经设了 `LLM_MODEL`,`.env` 里又写了一个不同的值,听谁的?新建 `part01/dotenv_override.py`:

```python
# agent-zero-lab/part01/dotenv_override.py
import os

from dotenv import load_dotenv

print("启动时:", os.environ.get("LLM_MODEL"))
load_dotenv()
print("load_dotenv() 之后:", os.environ["LLM_MODEL"])
load_dotenv(override=True)
print("override=True 之后:", os.environ["LLM_MODEL"])
```

<div class="line-notes">

- `print("启动时:", os.environ.get("LLM_MODEL"))` 还没读 .env 时有没有这个变量。这里用 .get,因为「没有」也是我们想看的结果。
- `load_dotenv()` 默认参数 override=False:环境里已经有的变量,不覆盖。
- `load_dotenv(override=True)` 再读一次,这次让 .env 里的值覆盖已有的。

</div>

不带变量跑一次,临时设一个 `LLM_MODEL=qwen-plus` 再跑一次:

```bash
uv run python part01/dotenv_override.py
LLM_MODEL=qwen-plus uv run python part01/dotenv_override.py
```

实测输出:

```text
启动时: None
load_dotenv() 之后: deepseek-flash
override=True 之后: deepseek-flash
启动时: qwen-plus
load_dotenv() 之后: qwen-plus
override=True 之后: deepseek-flash
```

默认情况下**已有的环境变量优先,`.env` 只兜底**。第二次运行时终端传进来的 qwen-plus 没被 `.env` 覆盖;加了 `override=True` 才被换成 deepseek-flash。

默认不覆盖是有道理的。以后程序部署到服务器上,配置是由服务器的环境变量直接给的,万一项目目录里还躺着一个开发用的 `.env`,也不该把服务器的配置顶掉。写测试时也一样:Day 82 会在测试里用 monkeypatch 设一个假 key,本地 `.env` 里的真 key 不会把它顶掉,测试也就不会真去调 API 花钱。

什么时候用 `override=True`?当你**明确指定**要读某一个文件时,比如 `load_dotenv(".env.test", override=True)`:你点名要这份配置,就该以它为准。最后的 settings.py 就是这么设计的,第二部分的 LLMClient 也是。

### .env 的几种写法,哪些会让 key 变样

`.env` 不是 Python 也不是 JSON,它有自己的一套松散规则。与其背规则,不如喂一份乱七八糟的文件看它怎么解析。新建 `part01/data/messy.env`(注意 E 那一行末尾有三个空格,K 那一行是中文的弯引号):

```bash
A=sk-abc
B = sk-abc
C="sk-abc"
D='sk-abc'
E=sk-abc   
F=sk-abc # 我的 key
G="sk-abc # 不是注释"
export H=sk-abc
I=
J
K=“sk-abc”
```

再新建 `part01/dotenv_messy.py`:

```python
# agent-zero-lab/part01/dotenv_messy.py
from pathlib import Path

from dotenv import dotenv_values

path = Path(__file__).resolve().parent / "data" / "messy.env"
for name, value in dotenv_values(path).items():
    print(f"{name}: {value!r}")
```

<div class="line-notes">

- `from dotenv import dotenv_values` dotenv_values 只解析文件、返回一个字典,**不**写进环境变量。用来检查文件内容很合适,不会污染当前进程。
- `path = Path(__file__).resolve().parent / "data" / "messy.env"` Day 37 的写法,定位到 part01/data/messy.env。
- `print(f"{name}: {value!r}")` `!r` 打印 repr,字符串带引号,首尾的空格、引号都看得一清二楚。

</div>

```bash
uv run python part01/dotenv_messy.py
```

实测输出:

```text
A: 'sk-abc'
B: 'sk-abc'
C: 'sk-abc'
D: 'sk-abc'
E: 'sk-abc'
F: 'sk-abc'
G: 'sk-abc # 不是注释'
H: 'sk-abc'
I: ''
J: None
K: '“sk-abc”'
```

python-dotenv 相当宽容:等号两边的空格(B)、直引号(C、D)、行尾空格(E)、行尾注释(F)、`export` 前缀(H,方便同一个文件也能在终端里 `source`)都处理掉了,值都是干净的 `sk-abc`。引号里的 `#` 不算注释(G)。

有三行要注意:

- I 写了等号没写值,得到空字符串 `''`。它**存在**,所以 `os.environ["I"]` 不会 KeyError,但值是空的,拿去调接口会得到 401。
- J 连等号都没有,值是 None,真正读进环境变量时它会被跳过。
- K 用的是中文弯引号 `“ ”`,dotenv 不认识,原样当成了 key 的一部分。key 变成了 `“sk-abc”`,一个字符都没少,但服务器不会认。macOS「文本编辑」和一些聊天软件会自动把直引号换成弯引号,我见过不止一个人因为这个卡半天。

最稳的写法就是第一行那样:`名字=值`,不加空格,不加引号。值里有空格或 `#` 时再用直引号包起来。

<figure>
<svg viewBox="0 0 640 250" role="img" aria-label="key 的流向:真 key 只写在项目根目录的 .env 里,.gitignore 让 git 忽略它;程序启动时 load_dotenv 把 .env 读进 os.environ,代码从 os.environ 取值;提交进 git 仓库的只有 .env.example(占位符)和代码,里面都没有真 key">
<rect x="0" y="0" width="640" height="250" fill="var(--paper-raised)" rx="6"/>
<g font-family="var(--font-mono)" font-size="12">
<text x="20" y="26" fill="var(--ink-faint)" font-size="11">你的电脑(只在这里有真 key)</text>
<rect x="20" y="36" width="160" height="56" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="100" y="60" text-anchor="middle" fill="var(--ink)">.env</text>
<text x="100" y="80" text-anchor="middle" fill="var(--ink-soft)" font-size="11">LLM_API_KEY=sk-…</text>
<line x1="180" y1="64" x2="240" y2="64" stroke="var(--rule)"/>
<text x="210" y="56" text-anchor="middle" fill="var(--ink-faint)" font-size="11">读入</text>
<rect x="240" y="36" width="160" height="56" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="320" y="60" text-anchor="middle" fill="var(--ink)">load_dotenv()</text>
<text x="320" y="80" text-anchor="middle" fill="var(--ink-soft)" font-size="11">已有的不覆盖</text>
<line x1="400" y1="64" x2="460" y2="64" stroke="var(--rule)"/>
<rect x="460" y="36" width="160" height="56" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="540" y="60" text-anchor="middle" fill="var(--ink)">os.environ</text>
<text x="540" y="80" text-anchor="middle" fill="var(--ink-soft)" font-size="11">代码从这里取</text>
<line x1="100" y1="92" x2="100" y2="140" stroke="var(--rule)" stroke-dasharray="4 3"/>
<text x="110" y="122" fill="var(--ink-faint)" font-size="11">.gitignore 挡住</text>
<rect x="20" y="140" width="600" height="90" rx="4" fill="none" stroke="var(--rule)"/>
<text x="36" y="164" fill="var(--ink-faint)" font-size="11">git 仓库 → GitHub(谁都可能看到)</text>
<text x="36" y="190" fill="var(--ink)">.env.example</text>
<text x="200" y="190" fill="var(--ink-soft)" font-size="11">LLM_API_KEY=sk-你的key(占位符)</text>
<text x="36" y="214" fill="var(--ink)">part01/*.py</text>
<text x="200" y="214" fill="var(--ink-soft)" font-size="11">只写 os.environ["LLM_API_KEY"],不写值</text>
</g>
</svg>
<figcaption>真 key 只存在于一个地方:你本机项目根目录的 .env。进仓库的代码只知道「去环境变量里取 LLM_API_KEY」,进仓库的 .env.example 只告诉别人「需要哪几个变量」。</figcaption>
</figure>

## 第三步:.gitignore,让 .env 永远不进仓库

key 从代码里搬到了 `.env`,但 `.env` 也是项目目录里的一个文件,git 照样能把它提交上去。git 的系统学习在 [Day 56](/blog/agent-zero/day-056-git-1/),今天只需要知道两件事:Day 10 的 `uv init` 已经在项目里建好了一个 git 仓库(那个 `.git` 目录);仓库根目录的 `.gitignore` 文件列出了「git 不要管的文件」,Day 11 看过里面有 `.venv`。

先看现状。`git check-ignore -v 文件名` 用来问 git「这个文件是不是被忽略了,被哪一行规则忽略的」;`git status --short` 列出 git 看得到的新文件,`??` 表示「还没被 git 管理的新文件」:

```bash
git check-ignore -v .env
echo "exit=$?"
git status --short
```

实测输出:

```text
exit=1
?? .env
?? .gitignore
?? .python-version
?? README.md
?? main.py
?? part01/
?? pyproject.toml
?? uv.lock
```

`check-ignore` 什么都没打印,`echo "exit=$?"` 显示它的退出码是 1。`$?` 是 shell 里的一个特殊变量,存着**上一条命令的退出码**:0 表示成功,非 0 表示失败或「没有」。这是第一次用到它,对 `check-ignore` 来说,1 的意思是「没被忽略」。`git status` 列表里赫然有 `.env`。uv 生成的 `.gitignore` 只管 Python 的缓存和 `.venv`,**不管 `.env`**,这一步必须自己加。不加的话,Day 56 你第一次 `git add .` 时,key 就进了仓库。

用编辑器打开项目根目录的 `.gitignore`,在末尾加上这几行:

```bash
# 密钥:真实配置不进仓库,只提交 .env.example
.env
.env.*
!.env.example
```

- `.env`:忽略这个文件。
- `.env.*`:忽略所有 `.env.` 开头的文件。以后你会有 `.env.test`、`.env.sf` 这种按厂商、按用途分的配置,一条规则全管住。`*` 是通配符,和 Day 4 终端里的意思一样。
- `!.env.example`:感叹号表示「例外,不要忽略」。`.env.example` 也匹配 `.env.*`,这一行把它捞回来。规则从上往下读,后面的覆盖前面的,所以例外要写在后面。

`.env.example` 是一份「配置说明书」:和 `.env` 有一样的变量名,但值换成占位符,提交进仓库,别人(包括以后看你作品的面试官)clone 下来,复制一份改名成 `.env`、填上自己的 key 就能跑。在项目根目录新建它:

```bash
# agent-zero-lab/.env.example  复制成 .env 再填真 key
LLM_BASE_URL=https://api.deepseek.com
LLM_API_KEY=sk-你的key
LLM_MODEL=deepseek-flash
```

再顺手建一个测试用的 `.env.test`,后面 settings.py 和练习 3 要用:

```bash
# agent-zero-lab/.env.test  测试用,假 key,调不通任何接口
LLM_BASE_URL=http://127.0.0.1:9999
LLM_API_KEY=sk-test-not-real
LLM_MODEL=fake-model
```

`127.0.0.1` 是本机自己,9999 端口上什么都没有,用这个地址就算代码真的发了请求也到不了任何厂商。现在再检查一遍:

```bash
git check-ignore -v .env .env.test .env.example
echo "exit=$?"
git status --short
```

实测输出:

```text
.gitignore:13:.env	.env
.gitignore:14:.env.*	.env.test
.gitignore:15:!.env.example	.env.example
exit=0
?? .env.example
?? .gitignore
?? .python-version
?? README.md
?? main.py
?? part01/
?? pyproject.toml
?? uv.lock
```

`-v` 让它说出是哪个文件(`.gitignore`)第几行的哪条规则命中的。`.env` 被第 13 行忽略,`.env.test` 被第 14 行忽略,`.env.example` 命中的是第 15 行那条带 `!` 的例外,意思是「明确不忽略」。行号取决于你的 `.gitignore` 原来有几行,对不上没关系,规则对上就行。

`git status` 的列表里,`.env` 不见了,`.env.example` 出现了。这就是我们要的结果。

**`.gitignore` 只对还没被 git 管理的文件有效。** 如果 `.env` 已经被提交过一次,再往 `.gitignore` 里加规则也没用,git 会继续跟踪它的修改;而且就算删掉,历史里那次提交还在。真遇到这种情况,第一件事是去厂商后台**把这个 key 作废、换一个新的**,然后才是清理仓库。key 作废了,历史里那串字符就没用了。Day 56 讲 git 时会再演示怎么让 git 停止跟踪一个文件。

## 把零件拼起来:settings.py

现在把今天的东西拼成一个以后每天都能用的配置模块。它要做四件事:读 `.env`(默认兜底,指定文件就以它为准)、缺变量时说清缺哪个、用 Day 52 的 pydantic 校验格式、打印时不暴露 key。新建 `part01/settings.py`:

```python
# agent-zero-lab/part01/settings.py
import os

from dotenv import load_dotenv
from pydantic import BaseModel, Field, SecretStr, ValidationError

NAMES = ("LLM_BASE_URL", "LLM_API_KEY", "LLM_MODEL")


class Settings(BaseModel):
    base_url: str = Field(pattern=r"^https?://")
    api_key: SecretStr = Field(min_length=10)
    model: str = Field(min_length=1)


class SettingsError(Exception):
    pass


def load_settings(env_file: str | None = None) -> Settings:
    if env_file:
        load_dotenv(env_file, override=True)
    else:
        load_dotenv()
    missing = [name for name in NAMES if name not in os.environ]
    if missing:
        raise SettingsError(f"缺少环境变量 {', '.join(missing)}:检查 .env 是否在项目根目录、文件名是不是 .env")
    try:
        return Settings(
            base_url=os.environ["LLM_BASE_URL"],
            api_key=SecretStr(os.environ["LLM_API_KEY"]),
            model=os.environ["LLM_MODEL"],
        )
    except ValidationError as e:
        problems = [f"{err['loc'][0]}: {err['msg']}" for err in e.errors()]
        raise SettingsError("环境变量格式不对 -> " + ";".join(problems)) from None


if __name__ == "__main__":
    s = load_settings()
    print(s)
    print(repr(s.api_key), s.api_key.get_secret_value()[:6] + "…")
    print(s.model_dump())

    t = load_settings(".env.test")
    print(t.base_url, t.model)
```

<div class="line-notes">

- `from pydantic import BaseModel, Field, SecretStr, ValidationError` SecretStr 是 pydantic 自带的「秘密字符串」类型,今天唯一的新零件,下面讲。
- `NAMES = ("LLM_BASE_URL", "LLM_API_KEY", "LLM_MODEL")` 三个必需变量,用元组(Day 22)放在一起,检查缺失时遍历它。
- `base_url: str = Field(pattern=r"^https?://")` 地址必须以 `http://` 或 `https://` 开头。`s?` 表示 s 可有可无。漏写协议是很常见的错。
- `api_key: SecretStr = Field(min_length=10)` key 用 SecretStr 装。min_length 防住 `.env` 里写了 `LLM_API_KEY=` 却没填值的情况(前面 messy.env 的 I 行)。
- `model: str = Field(min_length=1)` 模型名不能空。
- `class SettingsError(Exception):` 自己的异常类(Day 36),调用方看到它就知道是配置问题。
- `def load_settings(env_file: str | None = None) -> Settings:` 不传参数:用默认的 .env;传一个文件名:以那个文件为准。
- `load_dotenv(env_file, override=True)` 点名要的文件,覆盖已有的值。注意 env_file 是**相对于当前目录**的路径,不像无参数时那样从脚本所在目录往上找,练习 3 会撞上这一点。
- `load_dotenv()` 没点名,.env 只兜底,终端里设的变量优先。
- `missing = [name for name in NAMES if name not in os.environ]` Day 23 的列表推导式,挑出没设置的变量。一次列全,不要缺一个报一个。
- `raise SettingsError(f"缺少环境变量 {', '.join(missing)}:检查` 报错直接给出排查方向,比裸的 KeyError 更好懂。
- `api_key=SecretStr(os.environ["LLM_API_KEY"]),` 把字符串包进 SecretStr 再交给模型。直接传字符串运行时也行(pydantic 会转),但检查器会画红线,因为标注要的是 SecretStr。
- `except ValidationError as e:` 格式不对时,把 Day 51 学的 errors() 压成一句话。
- `raise SettingsError("环境变量格式不对 -> " + ";".join(problems)) from None` Day 36 学过 `raise ... from e` 保留原始错误;`from None` 正好相反,**不**附带原来那一大段 ValidationError,报错只剩我们这一句。原始报错里的 input 字段会带上收到的值,对 key 来说这正是不想打印的东西。
- `print(s)` 打印整个配置对象。
- `print(repr(s.api_key), s.api_key.get_secret_value()[:6] + "…")` 要拿到真正的 key 字符串,必须显式调用 `get_secret_value()`。这里只取前 6 位演示。
- `print(s.model_dump())` 导出成字典,看 key 还是不是星号。
- `t = load_settings(".env.test")` 点名读测试配置。

</div>

```bash
uv run basedpyright part01/settings.py
uv run python part01/settings.py
```

实测输出:

```text
0 errors, 0 warnings, 0 notes
base_url='https://api.deepseek.com' api_key=SecretStr('**********') model='deepseek-flash'
SecretStr('**********') sk-fak…
{'base_url': 'https://api.deepseek.com', 'api_key': SecretStr('**********'), 'model': 'deepseek-flash'}
http://127.0.0.1:9999 fake-model
```

key 在打印、repr、model_dump 里都是 10 个星号,不管真 key 多长。只有写明 `get_secret_value()` 才拿得到原文。这样以后你在日志里 `print(settings)` 排查问题、或者把配置对象整个打出来给别人看,都不会把 key 带出去。真正发请求时,在那一行调用 `get_secret_value()` 取出来用。

最后一行说明点名读 `.env.test` 生效了,三个值全换成了测试配置。

再看两个出错的样子。临时把 key 设成空、把地址的协议去掉:

```bash
LLM_API_KEY= uv run python part01/settings.py
LLM_BASE_URL=api.deepseek.com uv run python part01/settings.py
```

实测输出(各留最后一行):

```text
SettingsError: 环境变量格式不对 -> api_key: Value should have at least 10 items after validation, not 0
SettingsError: 环境变量格式不对 -> base_url: String should match pattern '^https?://'
```

终端里设的空值优先于 `.env`(默认不覆盖),于是 key 是空字符串,被 min_length 拦下。SecretStr 的长度报错措辞是「at least 10 items」,有点怪,意思就是至少 10 个字符。第二条地址没写 `https://`,被 pattern 拦下。两种错都在程序启动的第一行暴露,而不是等到发请求时收到一个莫名其妙的错误。

把 `.env` 改名成 `.env.txt` 再跑(跑完记得改回来),实测最后一行:

```text
SettingsError: 缺少环境变量 LLM_BASE_URL, LLM_API_KEY, LLM_MODEL:检查 .env 是否在项目根目录、文件名是不是 .env
```

三个变量一起报缺,提示直接指向文件名问题。

### 一张报错对照表

第二部分你第一次调真接口时,下面这些报错迟早会碰到一两个。前三行今天已经实测过,后两行要等 Day 120 有了真 key 才会出现,先放在这里,到时候回来查:

| 报错 | 原因 | 怎么办 |
| --- | --- | --- |
| `KeyError: 'LLM_API_KEY'` 或 settings.py 的「缺少环境变量」 | 没读到 `.env`:不在项目根目录、文件名不对(`env`、`.env.txt`)、变量名拼错 | `ls -a` 看根目录有没有 `.env`,对一下变量名 |
| 「格式不对 -> api_key」 | `.env` 里写了 `LLM_API_KEY=` 没填值,或者终端里设了空值 | 填上 key;检查终端有没有 export 过同名变量 |
| 「格式不对 -> base_url」 | 地址漏了 `https://` | 补上协议 |
| `Error code: 401`(Day 120) | key 不对:复制时少了字符、多了弯引号、key 已被作废 | 用练习 1 的检查脚本看首尾;不行就去厂商后台重建一个 |
| `Error code: 402 ... Insufficient Balance`(Day 120) | 账户没钱。key 和代码其实都对了 | 去开放平台充值 |

| 今天的零件 | 在 settings.py 里是哪一段 |
| --- | --- |
| 第一步 `os.environ[...]` | `os.environ["LLM_API_KEY"]` 等三处 |
| 第一步 缺变量要早报 | `missing` 列表和第一个 SettingsError |
| 第二步 `load_dotenv()` 往上找 | 不传参数时的 `load_dotenv()` |
| 第二步 `override=True` | 点名文件时 `load_dotenv(env_file, override=True)` |
| 第二步 空值、弯引号 | `Field(min_length=10)` 拦空值;弯引号见练习 1 |
| 第三步 `.gitignore` | `.env`、`.env.test` 不进仓库,`.env.example` 进 |
| Day 52 Field 约束 | `pattern=r"^https?://"`、`min_length` |
| 新零件 `SecretStr` | `api_key` 字段,打印自动打码 |

## 动手练习

### 练习 1:配置体检脚本

写一个 `part01/ex53_doctor.py`,不读进环境变量、只做检查:找到 `.env` 的位置;对三个 `LLM_*` 变量,分别说出值从哪来(终端环境变量优先,其次 `.env`)、值是什么(key 要打码,只露前 3 位和后 4 位)、有没有问题(空的、首尾有空白、带了直引号或弯引号)。正常跑一次,再用 `LLM_MODEL=qwen-plus LLM_API_KEY='“sk-abc123456789”'` 跑一次。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part01/ex53_doctor.py
import os

from dotenv import dotenv_values, find_dotenv

NAMES = ("LLM_BASE_URL", "LLM_API_KEY", "LLM_MODEL")


def mask(value: str) -> str:
    if len(value) <= 8:
        return "*" * len(value)
    return value[:3] + "*" * (len(value) - 7) + value[-4:]


def problems(value: str) -> list[str]:
    found: list[str] = []
    if value == "":
        found.append("是空的")
    if value != value.strip():
        found.append("首尾有空白")
    if any(q in value for q in "\"'“”‘’"):
        found.append("带了引号")
    return found


path = find_dotenv()
print(".env 位置:", path or "没找到")
in_file = dotenv_values(path) if path else {}
for name in NAMES:
    from_shell = os.environ.get(name)
    from_file = in_file.get(name)
    value = from_shell if from_shell is not None else from_file
    if value is None:
        print(f"{name}: 没设置")
        continue
    source = "终端环境变量" if from_shell is not None else ".env"
    shown = mask(value) if name == "LLM_API_KEY" else value
    issues = problems(value)
    print(f"{name}: {shown}(来自{source})" + (" 问题: " + "、".join(issues) if issues else ""))
```

<div class="line-notes">

- `from dotenv import dotenv_values, find_dotenv` 只找、只解析,不调用 load_dotenv,所以 os.environ 里只有终端传进来的变量,能分清来源。
- `def mask(value: str) -> str:` 打码:太短的全打码,长的留前 3 后 4。
- `return value[:3] + "*" * (len(value) - 7) + value[-4:]` 字符串乘整数就是重复几遍,`"*" * 3` 得到 `"***"`;中间星号数 = 总长 - 3 - 4,打码后长度不变,能顺便看出长度对不对。
- `if value != value.strip():` 去掉首尾空白后和原值不同,说明首尾有空白。
- `if any(q in value for q in "\"'“”‘’"):` any 只要有一个为真就是真。遍历字符串就是逐个字符,这里列了直双引号(要用 `\"` 转义)、直单引号和四个弯引号。
- `in_file = dotenv_values(path) if path else {}` 没找到 .env 时用空字典,避免 dotenv_values 去解析空路径。
- `value = from_shell if from_shell is not None else from_file` 和 load_dotenv 默认行为一致:终端的优先。
- `print(f"{name}: {shown}(来自{source})" + (" 问题: " + "、".join(issues) if issues else ""))` 有问题才拼上问题清单。

</div>

```bash
uv run basedpyright part01/ex53_doctor.py
uv run python part01/ex53_doctor.py
LLM_MODEL=qwen-plus LLM_API_KEY='“sk-abc123456789”' uv run python part01/ex53_doctor.py
```

实测输出:

```text
0 errors, 0 warnings, 0 notes
.env 位置: /Users/你/agent-zero-lab/.env
LLM_BASE_URL: https://api.deepseek.com(来自.env)
LLM_API_KEY: sk-***********************cdef(来自.env)
LLM_MODEL: deepseek-flash(来自.env)
.env 位置: /Users/你/agent-zero-lab/.env
LLM_BASE_URL: https://api.deepseek.com(来自.env)
LLM_API_KEY: “sk**********789”(来自终端环境变量) 问题: 带了引号
LLM_MODEL: qwen-plus(来自终端环境变量)
```

第二次运行,key 打码后开头是 `“sk`,一眼能看出前面多了个弯引号。打码时保留首尾几位,就是为了排查这种问题。Day 120 碰到 401 时先跑一下这个脚本。

</details>

### 练习 2:扫一遍项目里有没有 key

写 `part01/ex53_find_keys.py`:遍历项目根目录下所有文件(跳过 `.venv`、`.git`、`__pycache__`),找出包含 `sk-` 且后面跟着一长串(总长至少 16 个字符)的地方,打印「文件:行号」和打码后的开头;占位符 `sk-你的key` 不算。先猜它会找到哪几个文件,哪个才是真正的问题。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part01/ex53_find_keys.py
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SKIP_DIRS = {".venv", ".git", "__pycache__"}
PLACEHOLDER = "sk-你的key"


def scan(root: Path) -> list[str]:
    hits: list[str] = []
    for path in sorted(root.rglob("*")):
        if not path.is_file() or SKIP_DIRS & set(path.parts):
            continue
        try:
            text = path.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            continue
        for n, line in enumerate(text.splitlines(), start=1):
            start = line.find("sk-")
            if start == -1 or PLACEHOLDER in line:
                continue
            word = line[start:].split()[0].strip("\"'")
            if len(word) >= 16:
                hits.append(f"{path.relative_to(root)}:{n}  {word[:6]}…(长 {len(word)})")
    return hits


for hit in scan(ROOT):
    print(hit)
```

<div class="line-notes">

- `ROOT = Path(__file__).resolve().parent.parent` 脚本在 part01,上两级的 parent 就是项目根目录。
- `SKIP_DIRS = {".venv", ".git", "__pycache__"}` 集合(Day 25)。`.venv` 里是第三方包,文件成千上万,跳过。
- `for path in sorted(root.rglob("*")):` Day 37 的 rglob 递归列出所有文件和目录,sorted 让输出顺序固定。
- `if not path.is_file() or SKIP_DIRS & set(path.parts):` `path.parts` 是路径拆成的各段,`&` 是集合的交集:只要路径里有一段是要跳过的目录,交集就不为空,算作真。
- `except UnicodeDecodeError:` 二进制文件(比如 .pyc)按 utf-8 读会报这个错(Day 38),跳过。
- `start = line.find("sk-")` find 找不到返回 -1,找到返回位置。
- `if start == -1 or PLACEHOLDER in line:` 没有 sk- 或者是占位符,跳过。
- `word = line[start:].split()[0].strip("\"'")` 从 sk- 开始切到行尾,按空白分开取第一段,再去掉首尾的引号,得到 key 本身。
- `if len(word) >= 16:` 太短的(比如这个脚本自己代码里的 `"sk-"`)不算。
- `hits.append(f"{path.relative_to(root)}:{n}  {word[:6]}…(长 {len(word)})")` 只露前 6 位。扫描工具自己也不能把 key 打印出来。

</div>

```bash
uv run basedpyright part01/ex53_find_keys.py
uv run python part01/ex53_find_keys.py
```

实测输出:

```text
0 errors, 0 warnings, 0 notes
.env:3  sk-fak…(长 30)
.env.test:3  sk-tes…(长 16)
part01/leaky.py:2  sk-fak…(长 27)
```

找到三处。`.env` 和 `.env.test` 本来就是放 key 的地方,而且被 `.gitignore` 挡着,没问题。真正的问题是 `part01/leaky.py`:它是普通代码文件,没被忽略,Day 56 一 `git add .` 就进仓库了。删掉它(或者改成从 os.environ 读),再跑一次脚本确认只剩两个 `.env` 文件。

这个脚本很粗糙,只认 `sk-` 开头的。真实项目里有现成的工具做这件事,比如 gitleaks、GitHub 的 secret scanning,规则多得多,还能扫 git 历史。思路和这个脚本一样。

</details>

### 练习 3:观察配置的加载顺序

新建 `part01/ex53_order.py`,依次调用 `load_settings()`、`load_settings(".env.test")`、`load_settings()`,每次打印 model。在项目根目录跑一次;再用 `LLM_MODEL=qwen-plus` 跑一次;最后 `cd part01` 进子目录跑一次。先猜三次运行各打印什么,再跑。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part01/ex53_order.py
from settings import load_settings

print("1", load_settings().model)
print("2", load_settings(".env.test").model)
print("3", load_settings().model)
```

<div class="line-notes">

- `from settings import load_settings` 正文写好的模块,演示代码在 main guard 里,import 不会执行。
- `print("1", load_settings().model)` 默认:.env 兜底。
- `print("2", load_settings(".env.test").model)` 点名测试配置,override=True。
- `print("3", load_settings().model)` 再按默认方式读一次。

</div>

```bash
uv run python part01/ex53_order.py
LLM_MODEL=qwen-plus uv run python part01/ex53_order.py
cd part01 && uv run python ex53_order.py && cd ..
```

实测输出:

```text
1 deepseek-flash
2 fake-model
3 fake-model
1 qwen-plus
2 fake-model
3 fake-model
1 deepseek-flash
2 deepseek-flash
3 deepseek-flash
```

三个现象:

第一次运行的第 3 行还是 fake-model,不是 deepseek-flash。环境变量是**整个进程共享的一份**,第 2 次调用 override 进去的测试值留在了 os.environ 里;第 3 次的 `load_dotenv()` 默认不覆盖已有值,于是读到的还是测试配置。结论:一个进程里只加载一次配置,开头决定好用哪份,别中途切来切去。

第二次运行,终端给的 qwen-plus 赢了 .env,但输给了点名的 .env.test(override=True)。

第三次在 part01 里运行,第 2 行**没有**变成 fake-model,而且没有任何报错。`load_dotenv(".env.test", ...)` 里的 `.env.test` 是相对路径,相对的是当前目录 part01,那里没有这个文件,load_dotenv 安静地返回了 False;而三个变量早被第 1 次调用从根目录的 .env 读进来了,所以检查也全部通过。这比报错更危险:你以为在用测试配置,其实在用正式配置。修法是在 settings.py 里把相对路径换算成相对项目根目录的绝对路径(比如 `Path(__file__).resolve().parent.parent / env_file`),或者在 load_dotenv 返回 False 时抛错。这是 Day 37 那个「从哪个目录运行」的坑又一次出现。

</details>

### 练习 4:再忽略一类文件

Day 52 练习 2 生成的 `part01/data/refunds.jsonl` 是随时能重新生成的练习数据,不想进仓库。在 `.gitignore` 里加一条规则忽略 `part01/data/` 下所有 `.jsonl` 文件,用 `git check-ignore -v` 确认它被忽略、而 `notebook.json` 没被忽略。

<details><summary>参考答案</summary>

在 `.gitignore` 末尾加:

```bash
# 练习生成的数据,随时能重新生成
part01/data/*.jsonl
```

验证:

```bash
git check-ignore -v part01/data/refunds.jsonl part01/data/notebook.json
echo "exit=$?"
```

实测输出(加规则之前我先跑过一次,refunds.jsonl 那次没有输出、exit=1):

```text
.gitignore:18:part01/data/*.jsonl	part01/data/refunds.jsonl
exit=0
```

只打印了 refunds.jsonl,notebook.json 没出现在输出里,说明它没被忽略。一次查多个文件时,只要有一个被忽略,退出码就是 0,所以要看打印出来的是哪几个,不能只看退出码。规则里带了 `/`,所以它是相对 `.gitignore` 所在目录的路径,只管 `part01/data/` 这一个目录;如果写成 `*.jsonl`,项目里任何地方的 .jsonl 都会被忽略。

</details>

验收标准:`git check-ignore -v .env` 有输出、`git status --short` 列表里没有 `.env` 但有 `.env.example`;`uv run python part01/settings.py` 的输出里 key 是星号;`uv run basedpyright part01/settings.py part01/ex53_doctor.py part01/ex53_find_keys.py` 输出 `0 errors`;不看文章能写出 `.gitignore` 那三行和 `load_settings` 的 if/else 两种 load_dotenv;能说出 `os.environ["X"]` 和 `.get("X")` 各适合什么配置、`load_dotenv()` 默认谁覆盖谁;练习 2 的扫描结果里只剩两个被忽略的 `.env` 文件。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| `os.environ` | 当前 Python 进程的环境变量,用法像字典,≈ Node 的 `process.env`;`[]` 取不到抛 KeyError,`.get` 取不到给 None |
| `os.getenv` | `os.environ.get` 的简写,可以给默认值 |
| API key / 密钥 | 调用付费接口的凭证,一串字符,谁拿到谁就能用你的额度;今天的都是假的,Day 120 才有真的 |
| `.env` 文件 | 项目根目录的配置文件,一行一个 `名字=值`,放本机的真实配置,不进仓库 |
| python-dotenv | 读 `.env` 的库,包名 python-dotenv,import 名 `dotenv` |
| `load_dotenv()` | 把 `.env` 读进环境变量;不传路径时从调用它的脚本所在目录往上找;找到返回 True,找不到返回 False 不报错 |
| `override` | load_dotenv 的参数,默认 False(已有的环境变量优先),True 时用文件里的值覆盖 |
| `dotenv_values()` | 只解析文件返回字典,不写进环境变量 |
| `.gitignore` | 列出 git 不要管的文件的规则文件;`*` 通配,`!` 表示例外,后面的规则覆盖前面的 |
| `git check-ignore -v` | 查某个文件是否被忽略、被哪个文件哪一行规则命中 |
| `$?` | shell 变量,上一条命令的退出码,0 表示成功 |
| `.env.example` | 只有变量名和占位符的配置模板,提交进仓库,告诉别人需要哪些变量 |
| `SecretStr` | pydantic 的秘密字符串类型,打印、repr、model_dump 都显示星号,`get_secret_value()` 才拿到原文 |
| secret scanning | 代码托管平台扫描提交内容里有没有密钥的功能,GitHub 有,只认部分已知格式 |

## 常见误区

**以为 `load_dotenv()` 找不到文件会报错。** 实测文件名写成 `env` 时它只是返回 False,程序照常往下走。后面用 `.get` 取值的话会拿到 None,一直到发请求才以 401 的形式爆出来。配置类的值用 `os.environ[...]`,或者像 settings.py 那样统一检查缺失。

**用文本编辑器建 `.env`,结果是 `.env.txt` 或者引号变弯了。** 前者 load_dotenv 找不到;后者实测 `K=“sk-abc”` 读出来是 `'“sk-abc”'`,引号成了 key 的一部分。用代码编辑器(Zed、VS Code)建,或者在终端里用 `touch .env` 建空文件再编辑。

**以为 `.env` 里的值总会生效。** 默认不覆盖,终端里 export 过同名变量,`.env` 就不起作用。实测 `LLM_MODEL=qwen-plus` 在命令前面时,`.env` 里的 deepseek-flash 被无视。改了 `.env` 却没效果,先 `echo $LLM_MODEL` 看看终端里是不是已经有一个。

**以为点名的 env 文件路径相对于脚本。** 不带参数的 `load_dotenv()` 从脚本所在目录往上找;带路径的 `load_dotenv(".env.test")` 是相对**当前目录**的。实测在 part01 里运行时 `.env.test` 没被读到,也不报错,悄悄用了正式配置。

**uv 生成的 `.gitignore` 里没有 `.env`。** uv init 只写了 Python 缓存和 `.venv`,实测 `git status` 里 `.env` 是待提交状态。新项目建好第一件事就是加上 `.env` 那三行。

**`.env` 已经提交过,以为补一行 `.gitignore` 就安全了。** `.gitignore` 只管还没被 git 跟踪的文件,而且历史记录删不掉。真泄露了,第一步是去厂商后台作废这个 key、重建一个,其他补救都排在后面。

**把完整的 key 打印出来调试。** `print(os.environ["LLM_API_KEY"])` 的输出会被截图、进日志、贴给别人。只打印前几位和长度,或者用 SecretStr 让它自动变星号。

**以为 `.env` 放在 part01 里也一样。** 放在 part01 里,part01 的脚本能往上找到它,但根目录和别的目录的脚本找不到。按约定,`.env` 只放项目根目录,和 `pyproject.toml` 同一层。

## 学习资料

### 文档与文章

- [python-dotenv 的 PyPI 页面](https://pypi.org/project/python-dotenv/):官方说明,英文。看「Getting Started」和「File format」两节,今天 messy.env 测的那些写法规则都在 File format 里;「Variable expansion」讲 `${HOME}` 这种引用其他变量的写法,今天没用到。
- [Python 标准库 · os.environ(中文)](https://docs.python.org/zh-cn/3.12/library/os.html):在页面里搜 `os.environ`,看它和 `os.getenv` 的说明。
- [十二要素应用 · III. 配置(中文)](https://12factor.net/zh_cn/config):一篇很短的经典文章,讲为什么配置要和代码分开、要放在环境变量里。里面有个判断标准:你的代码能不能马上开源而不泄露任何凭证。
- [GitHub 文档 · 忽略文件(中文)](https://docs.github.com/zh/get-started/git-basics/ignoring-files):`.gitignore` 的写法,以及「已经提交了的文件怎么停止跟踪」。
- [GitHub 文档 · 关于机密扫描(中文)](https://docs.github.com/zh/code-security/secret-scanning/introduction/about-secret-scanning):GitHub 怎么发现推上去的密钥,推送保护是怎么拦的。读完你会明白它为什么不能当唯一的防线。
- [Vite 文档 · 环境变量和模式](https://vite.dev/guide/env-and-mode):前端视角的对照。注意它对 `VITE_` 前缀变量会进入浏览器代码的提醒,和今天「密钥不出本机」是同一个道理。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1oYphecETh&autoplay=0&high_quality=1" title="Python使用dotenv库管理敏感信息（Python五分钟）" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>赛博红兔CyberHongTu · Python 使用 dotenv 库管理敏感信息(Python 五分钟) · 约 7 分钟,2024 年。从「key 写在代码里有什么问题」讲到 .env 和 load_dotenv,对应今天第一、二步。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1VJp9zUEmg&autoplay=0&high_quality=1" title="Python教程：使用DotEnv安全管理密码和API密钥" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>小书包AIGC · Python 教程:使用 DotEnv 安全管理密码和 API 密钥 · 约 17 分钟,2025 年。比上一个更细,演示了多份配置文件的切换,看完可以对照今天的 override 和练习 3。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1fp4y1u7aK&autoplay=0&high_quality=1" title="开发者必知：.gitignore 文件的魔法，助你管理项目文件如虎添翼！" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>SI斗罗 · 开发者必知:.gitignore 文件的魔法 · 约 6 分钟,2023 年。讲 .gitignore 的通配符和例外规则,对应第三步;里面提到的 git 命令 Day 56 会系统学。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/DVVYHlGYIHY" title="Store &amp; manage secrets like API keys in Python - Tech Tip Tuesdays" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>GitGuardian · Store &amp; manage secrets like API keys in Python · 英文。GitGuardian 是专门做密钥泄露检测的公司,视频从「为什么不能硬编码」讲到 .env 和 .gitignore,和今天的顺序一致,也提到了练习 2 那类扫描工具。</figcaption>
</figure>

### 书籍

- 《Pro Git(第 2 版)》,Scott Chacon、Ben Straub 著,Apress,2014。官方免费在线中文版在 [git-scm.com/book/zh/v2](https://git-scm.com/book/zh/v2)。今天读第 2 章「Git 基础」里「记录每次更新到仓库」一节中的「忽略文件」部分,`.gitignore` 的规则写法讲得最全;整本书留到 Day 56 学 git 时再从头读。

### 开源项目与代码

- [openai/openai-python 的 `src/openai/_client.py`](https://github.com/openai/openai-python/blob/main/src/openai/_client.py):OpenAI 官方 SDK 的客户端。在页面里搜 `os.environ`,能看到 `api_key = os.environ.get("OPENAI_API_KEY")`,下面紧跟着一段:没传 api_key 又没设环境变量时,直接抛错说「Missing credentials ... set the OPENAI_API_KEY ... environment variable」。和今天 settings.py 的思路一样:没有 key 就在构造客户端时立刻报错,不等到发请求。
- [github/gitignore 的 `Python.gitignore`](https://github.com/github/gitignore/blob/main/Python.gitignore):GitHub 官方维护的 Python 项目 .gitignore 模板。搜 `.env`,能看到它把 `.env` 列在「Environments」那一段。新项目可以拿它做起点。

## 自测

1. `os.environ["LLM_API_KEY"]` 和 `os.environ.get("LLM_API_KEY")` 在变量没设置时分别发生什么?API key 为什么建议用前者?

<details><summary>答案</summary>

前者抛 `KeyError: 'LLM_API_KEY'`,后者返回 None。key 是必需配置,用前者能在读取那一行就暴露问题,报错里还带着变量名;用后者会拿着 None 继续跑,到发请求时才收到 401,离真正的原因很远。

</details>

2. 终端里 `export LLM_MODEL=qwen-plus`,`.env` 里写的是 `LLM_MODEL=deepseek-flash`,程序里调用 `load_dotenv()` 后 `os.environ["LLM_MODEL"]` 是什么?想让 `.env` 生效怎么办?

<details><summary>答案</summary>

是 qwen-plus。load_dotenv 默认 override=False,已有的环境变量优先。想让 .env 生效,要么 `unset LLM_MODEL` 去掉终端里的那个,要么调用 `load_dotenv(override=True)`。

</details>

3. 下面的 `.gitignore`,`.env.example` 会被忽略吗?为什么?

```bash
!.env.example
.env
.env.*
```

<details><summary>答案</summary>

会被忽略。规则从上往下读,后面的覆盖前面的。`!.env.example` 写在最前面,接着又被 `.env.*` 匹配成「忽略」。例外规则要写在它要推翻的那条规则后面。

</details>

4. `.env` 已经被 git 提交并推到了 GitHub 公开仓库,第一件事做什么?

<details><summary>答案</summary>

去厂商后台把这个 key 作废并重建一个新的。git 历史里的内容删不干净,而且公开仓库里的 key 可能几分钟内就被别人扫到。key 作废以后,泄露出去的那串字符就没用了;之后再补 `.gitignore`、让 git 停止跟踪 `.env`。

</details>

5. 面试题:你的 Agent 服务要用好几个第三方服务的 key(大模型、向量库、邮件),开发、测试、生产三套环境配置都不一样。你会怎么管理这些配置和密钥?

<details><summary>答案</summary>

原则是配置和代码分开,密钥不进仓库。代码里只通过环境变量读配置,启动时用一个配置模型(比如 pydantic,或者 pydantic-settings)统一读取并校验,缺了或格式不对就在启动时直接失败,密钥字段用 SecretStr 这类类型保证不会被打进日志。本地开发用 `.env`,由 `.gitignore` 挡在仓库外,仓库里只放 `.env.example` 说明需要哪些变量;测试用单独的假配置,测试代码里显式设置,不依赖开发者本机的 `.env`;生产环境的密钥不放文件,由部署平台的环境变量或专门的密钥管理服务(云厂商的 Secrets Manager 一类)注入。加载顺序上,平台注入的环境变量优先于任何文件。再加两道保险:提交前和 CI 里用 gitleaks 之类的工具扫描密钥;每个 key 只给最小权限、设用量上限,并且定期轮换,一旦怀疑泄露立刻作废。

</details>

## 明天预告

[Day 54 · 小项目:带校验的工单录入工具](/blog/agent-zero/day-054-intake-project/)。这三天学了 pydantic 守大门、Field 和校验器写业务规则、model_validate 和 model_dump 读写 JSON,今天又学会了把配置放进 `.env`。明天把它们拼成一个命令行小工具:一条条录入工单,不合格的当场拦下并给出中文提示,合格的存进 JSON 文件,录 5 条、拦 1 条。
