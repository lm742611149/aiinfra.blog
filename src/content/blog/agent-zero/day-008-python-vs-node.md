---
title: 'Day 8 · 第一个 Python 程序:和 Node 比,Python 怎么跑'
description: '先装一个 Python 3.12,用昨天学的 which 确认敲出来的是它;再把 python3 和 node 并排放:都是解释器,都有交互模式和跑脚本两种用法。写第一个 hello.py,故意犯五种错,看清语法错和运行时错的区别,最后把它做成一个在哪都能敲的命令。'
pubDate: 2026-10-22
regime: none
tags: ['python', 'agent-zero']
series: 'agent-zero'
day: 8
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 7](/blog/agent-zero/day-007-terminal-4/) 讲了命令是怎么被找到的:shell 拿着命令名,按 PATH 里目录的顺序一个个找,第一个找到的就运行;`which` 告诉你会运行哪一个,`which -a` 列出所有同名的。我们还做了 `~/bin/hello-agent`:第一行 `#!/usr/bin/env node`,加上可执行权限,`~/bin` 加进 PATH,在哪都能敲。

那天 `which -a python3` 在我机器上找到了两个,一个 3.10、一个 3.8,都不是这门课要的版本。今天先装对版本,然后写第一个 Python 程序。你写了好几年 JS,会发现 `python3` 和 `node` 的用法几乎一一对应,真正要适应的地方只有几处,今天都会撞一遍。

## 今天要解决的问题

学完今天,你应该能:

1. 装好 Python 3.12,用 `which -a python3` 和 `python3 --version` 证明你敲的就是它。
2. 说清楚「解释器」是什么:`python3` 和 `node` 一样,是一个读你的代码并执行它的程序;会用它的两种模式,交互模式(敲一行跑一行)和跑脚本(`python3 hello.py`)。
3. 写出 `hello.py`,和 `hello.js` 对照着说出三处写法差别;看到 `SyntaxError` 和 `NameError` 时,知道哪个是「一行都没跑」,哪个是「跑到一半停下」。
4. 给 Python 脚本加上 shebang,做成 `~/bin/hello-py`,在任何目录都能直接敲。

预计用时:2.5 小时。装 Python 30 分钟,交互模式 20 分钟,脚本和五种报错 1 小时,剩下做练习。

前置:[Day 3](/blog/agent-zero/day-003-terminal-1/)(相对路径相对工作目录、`node -e`)、[Day 5](/blog/agent-zero/day-005-terminal-3/)(标准输出)、[Day 7](/blog/agent-zero/day-007-terminal-4/)(PATH、`which -a`、符号链接、shebang、`chmod +x`、`.zprofile`)。今天不调任何 API,花费 0 元。

学法提示:先对照文章逐条敲一遍(代码自己敲,不复制粘贴)并跑通;第二天合上文章,把 `hello.py`、`hello-py` 和「语法错 / 运行时错」两个小文件默写出来再跑;然后做动手练习,做不出再展开参考答案,看完关掉自己重写一遍。

## 先说清楚我是在哪跑的

输出和前几天一样,是我 2026-10-22 在 2019 款 Intel MacBook Pro(macOS 14、zsh)上用演示家目录真跑的,家目录显示成 `/Users/你`。演示家目录的状态接着 Day 7:`~/bin` 里有 `hello-agent`、`tickets-count`,`.zshrc` 里有 nvm 那两行和 `export PATH="$HOME/bin:$PATH"`。

有一步我没有实跑:**运行 Python 安装包**。安装包要用管理员密码往 `/Library` 和 `/usr/local/bin` 里写东西,这两个是我这台真机器的系统目录,演示家目录替换不了,而且 `/usr/local/bin/python3` 现在指着的那个 3.10 还有别的老项目在用。所以安装那一节,我把安装包下载下来,拆开看了它会往哪装、会改什么文件(这部分是真跑的),装完以后你应该看到的输出,我按安装包里的内容和 Python 官方文档写,会标明「没实跑」。

后面所有 Python 的运行输出,用的是这台机器上已经有的一个 Python 3.12.13(它是 Day 10 要学的 uv 装的,到时你就知道它怎么来的)。为了让文中的命令和你那边一样都写 `python3`,我在演示家目录的 `~/bin` 里放了一个叫 `python3` 的符号链接指向它,原理就是 Day 7 练习 3 的「冒充」:`~/bin` 在 PATH 最前面。你不用做这一步。你装的是 3.12.10,今天所有输出里,除了开头那行版本号,别的都一样。

## 解释器:node 是什么,python3 就是什么

你每天都在敲 `node xxx.js`,但可能没细想过 `node` 本身是什么。Day 7 我们用 `which` 看过,它是 `~/.nvm/versions/node/v24.22.0/bin/node` 这么一个文件。它的工作是:读一个写着 JS 的文本文件,按 JS 的规则理解它,然后执行。这样的程序叫**解释器**(interpreter)。浏览器里那个执行 JS 的东西(Chrome 的 V8)也是干这个的,Node 就是把 V8 拿出来,装进一个能在终端里跑的程序。

`python3` 也是一个解释器,只不过它读的是 Python 代码。`hello.py` 本身就是个纯文本文件,和 `hello.js`、`tickets.txt` 没有本质区别,不经过 `python3` 它什么也做不了。

<figure>
<svg viewBox="0 0 640 230" role="img" aria-label="node 读 hello.js 执行,python3 读 hello.py 执行;两者都是解释器程序,文件本身只是文本">
<rect x="0" y="0" width="640" height="230" fill="var(--paper-raised)" rx="6"/>
<g font-family="var(--font-mono)" font-size="12">
<text x="20" y="28" fill="var(--ink-faint)">文本文件(你写的)</text>
<text x="250" y="28" fill="var(--ink-faint)">解释器(一个程序)</text>
<text x="470" y="28" fill="var(--ink-faint)">结果</text>
<rect x="20" y="42" width="170" height="56" rx="6" fill="var(--paper)" stroke="var(--rule)"/>
<text x="32" y="64" fill="var(--ink)">hello.js</text>
<text x="32" y="84" fill="var(--ink-soft)">console.log("hi");</text>
<line x1="190" y1="70" x2="238" y2="70" stroke="var(--ink-soft)"/><polygon points="238,65 248,70 238,75" fill="var(--ink-soft)"/>
<rect x="250" y="42" width="170" height="56" rx="6" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="262" y="64" fill="var(--ink)">node</text>
<text x="262" y="84" fill="var(--ink-soft)">~/.nvm/.../bin/node</text>
<line x1="420" y1="70" x2="458" y2="70" stroke="var(--ink-soft)"/><polygon points="458,65 468,70 458,75" fill="var(--ink-soft)"/>
<text x="470" y="75" fill="var(--ink)">终端里打印 hi</text>
<rect x="20" y="118" width="170" height="56" rx="6" fill="var(--paper)" stroke="var(--rule)"/>
<text x="32" y="140" fill="var(--ink)">hello.py</text>
<text x="32" y="160" fill="var(--ink-soft)">print("hi")</text>
<line x1="190" y1="146" x2="238" y2="146" stroke="var(--ink-soft)"/><polygon points="238,141 248,146 238,151" fill="var(--ink-soft)"/>
<rect x="250" y="118" width="170" height="56" rx="6" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="262" y="140" fill="var(--ink)">python3</text>
<text x="262" y="160" fill="var(--ink-soft)">PATH 里找到的那个</text>
<line x1="420" y1="146" x2="458" y2="146" stroke="var(--ink-soft)"/><polygon points="458,141 468,146 458,151" fill="var(--ink-soft)"/>
<text x="470" y="151" fill="var(--ink)">终端里打印 hi</text>
<line x1="20" y1="192" x2="620" y2="192" stroke="var(--rule)"/>
<text x="20" y="214" fill="var(--ink-soft)">同一个 hello.py,交给 3.12 和交给 3.8 跑,结果可能不同:版本是解释器的,不是文件的</text>
</g>
</svg>
<figcaption>文件只是文本,解释器才是干活的程序。所以「你用的是哪个 python3」比「你写了什么」更先决定结果。</figcaption>
</figure>

图最下面那句是今天装 Python 的理由。先看我这台机器现在的样子:

```text
$ which -a python3
/usr/local/bin/python3
/usr/bin/python3
$ python3 --version
Python 3.10.0
$ /usr/bin/python3 --version
Python 3.8.2
$ which -a node
/Users/你/.nvm/versions/node/v24.22.0/bin/node
/usr/local/bin/node
$ node --version
v24.22.0
```

<div class="line-notes">

- `$ which -a python3` 和 Day 7 一样,两个 `python3`。
- `/usr/local/bin/python3` 排第一的这个会被运行。它是 2021 年 python.org 安装包装的。
- `/usr/bin/python3` 苹果命令行开发者工具带的那个,被挡在后面。
- `Python 3.10.0` 默认跑的是 3.10。Python 官方的版本表上,3.10 在 2026-10-01 停止支持,也就是三周前,从此不再出安全修复。
- `Python 3.8.2` 苹果那个更老,3.8 在 2024 年就停止支持了。你的 Mac 上这里多半是 3.9.6,3.9 也在 2025 年 10 月停了。
- `/Users/你/.nvm/versions/node/v24.22.0/bin/node` 对照一下 Node:Day 7 把 nvm 配好以后,`node` 已经是 24 了。Python 这边也要做到同样的状态,新版本排在 PATH 前面。

</div>

所以不管你的 Mac 上现在有没有 `python3`,今天都要装一个新的。

## 装 Python 3.12

### 为什么是 3.12,为什么用官网安装包

这门课统一用 Python 3.12。后面要用的库(openai SDK、FastAPI、LangGraph、MCP SDK 这些)都支持它,它也还在官方支持期内:2026 年 10 月我查 Python 官方的版本表,3.12 处在「只修安全问题」阶段,支持到 2028 年 10 月。更新的 3.13、3.14 当然也能用,但课里所有代码都是在 3.12 上跑的,版本一致,你遇到的报错和文中才对得上。

装的办法有好几种:python.org 官网安装包、Homebrew、uv。这门课的项目从 Day 10 起会交给 uv 管,它能按项目自动下载需要的 Python 版本。今天先用官网安装包,原因是它最直白:下载、双击、下一步,装完的东西放在哪、改了哪个配置文件都看得见,正好拿 Day 7 学的东西去验证。

有一个细节要知道:**python.org 给 3.12 出的最后一个 Mac 安装包是 3.12.10**(2025 年 4 月)。3.12 进入「只修安全问题」阶段以后,官方只发源码,不再做安装包,所以你在下载页上找不到 3.12.15 的 `.pkg`。学习用 3.12.10 完全够;Day 10 起 uv 管项目时,会用它自己下载的最新 3.12 小版本。

### 安装包里有什么

装之前,我先把安装包下载下来拆开看了一眼。下面这些命令你不用敲,看结果就行:

```text
$ shasum -a 256 python-3.12.10-macos11.pkg
8373e58da4ea146b3eb1c1f9834f19a319440b6b679b06050b1f9ee3237aa8e4  python-3.12.10-macos11.pkg
$ pkgutil --check-signature python-3.12.10-macos11.pkg
Package "python-3.12.10-macos11.pkg":
   Status: signed by a developer certificate issued by Apple for distribution
   Signed with a trusted timestamp on: 2025-04-08 13:06:14 +0000
   Certificate Chain:
    1. Developer ID Installer: Python Software Foundation (BMM5U3QVKW)
$ pkgutil --expand python-3.12.10-macos11.pkg x
$ ls x
Distribution
Python_Applications.pkg
Python_Command_Line_Tools.pkg
Python_Documentation.pkg
Python_Framework.pkg
Python_Install_Pip.pkg
Python_Shell_Profile_Updater.pkg
Resources
```

<div class="line-notes">

- `$ shasum -a 256 python-3.12.10-macos11.pkg` 算文件的 SHA-256 指纹。文件哪怕改了一个字节,这串字符就完全不同,用来确认下载的文件没被动过。
- `8373e58da4ea146b3eb1c1f9834f19a319440b6b679b06050b1f9ee3237aa8e4` 我 2026-10-22 下载到的那个文件的指纹,43.6 MB。
- `$ pkgutil --check-signature python-3.12.10-macos11.pkg` `pkgutil` 是 macOS 自带的安装包工具,这里查签名。
- `Developer ID Installer: Python Software Foundation (BMM5U3QVKW)` 签名的是 Python 软件基金会,苹果认证过的证书。从官网下的就应该是这个名字。
- `$ pkgutil --expand python-3.12.10-macos11.pkg x` 把安装包拆开放进 `x` 目录,只拆不装。
- `Python_Applications.pkg` 拆出来是六个小包:图形界面程序(IDLE 编辑器等,放进「应用程序」文件夹)。
- `Python_Command_Line_Tools.pkg` 命令行工具,往 `/usr/local/bin` 里放 `python3` 这些名字。下面细看。
- `Python_Framework.pkg` 解释器本体和标准库,装到 `/Library/Frameworks/Python.framework/Versions/3.12/`。
- `Python_Install_Pip.pkg` pip,Python 的老牌包管理器。这门课用 uv,不用它。
- `Python_Shell_Profile_Updater.pkg` 改你的 shell 配置文件,把 Python 的目录加进 PATH。这个也细看。

</div>

命令行工具那个小包,解出来是 13 个符号链接,挑两个看:

```text
$ ls -l python3 python3.12
lrwxr-xr-x  1 minliu  wheel  70 22 Oct 18:51 python3 -> ../../../Library/Frameworks/Python.framework/Versions/3.12/bin/python3
lrwxr-xr-x  1 minliu  wheel  73 22 Oct 18:51 python3.12 -> ../../../Library/Frameworks/Python.framework/Versions/3.12/bin/python3.12
```

<div class="line-notes">

- `python3 -> ../../../Library/Frameworks/Python.framework/Versions/3.12/bin/python3` 和 Day 7 里我机器上那个 3.10 的 `/usr/local/bin/python3` 一模一样的结构,只是版本号从 3.10 变成了 3.12。这个链接会被装进 `/usr/local/bin/`,**覆盖掉原来同名的 `python3`**。所以在我这台机器上装完,`/usr/local/bin/python3` 就不再指向 3.10 了。
- `python3.12` 还有一个带版本号的名字。以后机器上装了好几个版本,写 `python3.12` 就能明确要哪个,不受 `python3` 指向谁的影响。

</div>

改 shell 配置的那个小包里有一个脚本,最后几行是真正动手的地方(原文,我只截了 zsh 相关的部分):

```text
zsh)
        PR="${HOME}/.zprofile"
        ;;
...
if [ -f "${PR}" ]; then
	cp -fp "${PR}" "${PR}.pysave"
fi
echo "" >> "${PR}"
echo "# Setting PATH for Python ${PYVER}" >> "${PR}"
echo "# The original version is saved in `basename ${PR}`.pysave" >> "${PR}"
echo 'PATH="'"${PYTHON_ROOT}/bin"':${PATH}"' >> "${PR}"
echo 'export PATH' >> "${PR}"
```

<div class="line-notes">

- `PR="${HOME}/.zprofile"` 你用的是 zsh,它要改的文件是 `~/.zprofile`。Day 7 讲过,这个文件比 `.zshrc` 先读,终端每个新窗口都会读。
- `cp -fp "${PR}" "${PR}.pysave"` 改之前先备份成 `.zprofile.pysave`。和我们 Day 7 的 `cp ~/.zshrc ~/.zshrc.bak` 是一个习惯。
- `echo "" >> "${PR}"` 全部用 `>>` 追加,一个 `>` 都没有。Day 5、Day 7 反复强调的那件事,写安装包的人也是这么做的。
- `echo 'PATH="'"${PYTHON_ROOT}/bin"':${PATH}"' >> "${PR}"` 写进去的是 `PATH="/Library/Frameworks/Python.framework/Versions/3.12/bin:${PATH}"`,新目录 + 冒号 + 原来的 PATH,还是 Day 7 那个拼法。
- `echo 'export PATH' >> "${PR}"` 再 `export`。

</div>

看完你应该放心了:这个安装包做的事,每一步你都学过。

### 动手装

下面是你要做的。我没在自己机器上点这几步,原因前面说了。

1. 浏览器打开 Python 3.12.10 的发布页 `https://www.python.org/downloads/release/python-31210/`,拉到底部的 Files 表格,点 **macOS 64-bit universal2 installer**,下载下来的文件叫 `python-3.12.10-macos11.pkg`。universal2 的意思是 Intel 和 Apple 芯片的 Mac 都能用,不用挑;表格里写着支持 macOS 10.13 及以上。
2. 双击它,一路「继续」。到「安装类型」那一步,点「自定」可以看到上面拆出来的那六项,保持默认全选,别取消「Shell profile updater」。要输一次开机密码,因为它要往系统目录里写。
3. 装完会弹出一个 Finder 窗口,里面有 `Install Certificates.command`,双击运行一下。它给这个 Python 装上一份网站证书清单,以后用 Python 访问 `https://` 网址才不报证书错误。今天用不上,但一并做了省得以后忘。
4. **关掉所有终端窗口,重新开一个。** `.zprofile` 刚被改过,已经开着的窗口不会重新读它,Day 7 讲过。

然后验证。下面是你应该看到的(这一段没实跑,按安装包内容和[官方文档《在 Mac 上使用 Python》](https://docs.python.org/zh-cn/3.12/using/mac.html)写的):

```text
$ which -a python3
/Library/Frameworks/Python.framework/Versions/3.12/bin/python3
/usr/local/bin/python3
/usr/bin/python3
$ python3 --version
Python 3.12.10
$ tail -4 ~/.zprofile
# Setting PATH for Python 3.12
# The original version is saved in .zprofile.pysave
PATH="/Library/Frameworks/Python.framework/Versions/3.12/bin:${PATH}"
export PATH
```

<div class="line-notes">

- `/Library/Frameworks/Python.framework/Versions/3.12/bin/python3` 排第一的是安装包加进 PATH 的那个目录。
- `/usr/local/bin/python3` 第二个是命令行工具小包放的符号链接,它也指向 3.12,所以这两个其实是同一个解释器,哪个排前面都一样。
- `/usr/bin/python3` 苹果那个还在,被挡在后面。不要删它,也删不掉,它归系统管。
- `Python 3.12.10` 版本对了,今天的安装就算成功。
- `$ tail -4 ~/.zprofile` 看安装包追加的那四行。如果你以前没有 `.zprofile`,这就是它的全部内容。

</div>

要是 `python3 --version` 还是老版本,按 Day 7 的思路查:先确认是不是新开的窗口,再 `which -a python3` 看 3.12 的目录在不在、排第几,最后 `cat ~/.zprofile` 看那四行有没有写进去。

我这边从这里开始,用的是前面说的那个 3.12.13:

```text
$ which -a python3
/Users/你/bin/python3
/usr/local/bin/python3
/usr/bin/python3
$ python3 --version
Python 3.12.13
$ python3.12 --version
Python 3.12.13
```

<div class="line-notes">

- `/Users/你/bin/python3` 我演示家目录里那个指向 3.12.13 的符号链接,排在第一。你那边这一行是 `/Library/Frameworks/...` 那个。
- `/usr/local/bin/python3` 我的 3.10 还在,轮不到了。
- `Python 3.12.13` 3.12 的一个更新的小版本。今天的代码在 3.12.10 和 3.12.13 上表现一样。

</div>

## 交互模式:敲一行,跑一行

解释器有两种用法。第一种是不给它文件,直接敲 `python3` 回车,它会进入**交互模式**,也叫 REPL(Read-Eval-Print Loop,读一行、算出来、打印结果、再等下一行)。你在 Chrome DevTools 的 Console 里敲 JS 就是在用 REPL;终端里敲 `node` 不带参数也是。

先看熟悉的那个:

```text
$ node
Welcome to Node.js v24.22.0.
Type ".help" for more information.
> 1 + 2
3
> "hello"
'hello'
> console.log("hello agent")
hello agent
undefined
> print("hi")
Uncaught ReferenceError: print is not defined
> .exit
```

<div class="line-notes">

- `$ node` 不带文件名,进入 Node 的 REPL。
- `> 1 + 2` 提示符是 `>`,表示「等你输入」。敲一个表达式,回车。
- `3` REPL 会把表达式的值自动打印出来,不用 `console.log`。
- `'hello'` 字符串的值打印出来带引号,表示这是一个字符串。
- `hello agent` `console.log` 打印的内容。
- `undefined` 紧接着又打印了一个 `undefined`:那是 `console.log(...)` 这个调用的返回值。DevTools Console 里你也天天见到它。
- `Uncaught ReferenceError: print is not defined` JS 里没有 `print`。
- `> .exit` Node REPL 用 `.exit` 或者按两次 Ctrl+C 退出。

</div>

再看 Python 的:

```text
$ python3
Python 3.12.13 (main, Jun 23 2026, 15:54:40) [Clang 22.1.3 ] on darwin
Type "help", "copyright", "credits" or "license" for more information.
>>> 1 + 2
3
>>> "hello"
'hello'
>>> print("hello agent")
hello agent
>>> 5 / 9 * 100
55.55555555555556
>>> console.log("hi")
Traceback (most recent call last):
  File "<stdin>", line 1, in <module>
NameError: name 'console' is not defined
>>> exit()
```

<div class="line-notes">

- `$ python3` 不带文件名,进入 Python 的交互模式。
- `Python 3.12.13 (main, Jun 23 2026, 15:54:40) [Clang 22.1.3 ] on darwin` 欢迎信息第一句就是版本号,还有这个解释器是哪天、用什么编译器编出来的。你那边是 `Python 3.12.10`,后面的日期和编译器不同。`darwin` 是 macOS 系统内核的名字。
- `>>> 1 + 2` Python 的提示符是三个大于号 `>>>`。在文章或教程里看到 `>>>` 开头的代码,意思就是「在交互模式里敲」。
- `3` 和 Node 一样,表达式的值自动打印。
- `'hello'` 字符串也一样带引号显示。
- `>>> print("hello agent")` `print` 是 Python 里的 `console.log`,把东西打印到标准输出。
- `hello agent` 打印出来了,但后面**没有**跟一个 `undefined`。Python 的 `print(...)` 返回的是 `None`(相当于 JS 的 `null`/`undefined`,Day 14 讲),交互模式遇到 `None` 就不打印。这是两个 REPL 最明显的一处不同。
- `55.55555555555556` 拿它当计算器算 Day 6 周报里那个计费占比:5 ÷ 9 × 100。最后一位 6 是浮点数的舍入,和 JS 算出来的一模一样,Day 12 讲为什么。
- `NameError: name 'console' is not defined` 前端手感最容易犯的错:Python 里没有 `console`。三行报错叫 traceback,后面细讲。
- `>>> exit()` 退出用 `exit()`,带括号。或者按 Ctrl+D。

</div>

交互模式适合试一两行:一个写法对不对、一个函数返回什么。我写 Python 好几年了,还是每天都开它,用法和你开 DevTools Console 试一句 JS 一样。它的缺点也一样:关掉窗口,敲过的东西就没了。要留下来、要反复跑的,就写进文件。

有两个退出时的小坑,我实际敲出来是这样:

```text
>>> quit
Use quit() or Ctrl-D (i.e. EOF) to exit
>>> exit
Use exit() or Ctrl-D (i.e. EOF) to exit
>>> python3 hello.py
  File "<stdin>", line 1
    python3 hello.py
            ^^^^^
SyntaxError: invalid syntax
```

<div class="line-notes">

- `>>> quit` 不带括号,Python 不会退出,只提示你正确写法。
- `Use exit() or Ctrl-D (i.e. EOF) to exit` `exit` 同理。EOF 是 end of file,Ctrl+D 就是告诉它「输入结束了」。
- `>>> python3 hello.py` 这是另一个特别常见的错:人已经在 `>>>` 里了,却敲了一条终端命令。
- `SyntaxError: invalid syntax` Python 把它当成 Python 代码来读,当然读不懂。记住一条:**看到 `>>>`,你在和 Python 说话;看到 `$`(或者 `%`),你在和 zsh 说话。** 先看提示符,再敲。

</div>

还有一种介于两者之间的用法:`python3 -c "代码"`,直接执行引号里的这一行,不进交互模式。它对应 Day 3 学过的 `node -e`:

```text
$ python3 -c "print('hello agent')"
hello agent
$ node -e "console.log('hello agent')"
hello agent
$ python3 -c "print(5 / 9 * 100)"
55.55555555555556
$ node -e "console.log(5 / 9 * 100)"
55.55555555555556
$ python3 -c "print(round(5 / 9 * 100, 1))"
55.6
```

<div class="line-notes">

- `$ python3 -c "print('hello agent')"` `-c` 是 command。外层双引号给 zsh 看,里面的字符串用单引号,和 Day 6 写 `node -e` 时的规矩一样。
- `$ node -e "console.log(5 / 9 * 100)"` 同一个算式,两个解释器给出的数字完全相同。
- `$ python3 -c "print(round(5 / 9 * 100, 1))"` `round(数, 1)` 四舍五入到一位小数,相当于 JS 的 `Number(x.toFixed(1))`。
- `55.6` 和 Day 6 周报里 `node -e` 算出的 `55.6%` 一致。以后周报里这一步可以换成 Python。

</div>

## 第一个脚本:hello.py 和 hello.js 并排

解释器的第二种用法是给它一个文件:`python3 hello.py`,和 `node hello.js` 一样。

在 `~/terminal-practice` 里建一个 `day08` 目录放今天的文件:

```text
$ mkdir -p ~/terminal-practice/day08
$ cd ~/terminal-practice/day08
```

<div class="line-notes">

- `$ mkdir -p ~/terminal-practice/day08` 接着用这一周的练习目录。Day 10 才建正式的课程仓库 `agent-zero-lab`,在那之前的 Python 小文件都先放这里。
- `$ cd ~/terminal-practice/day08` 下面的命令都在这里跑。

</div>

用你的编辑器(VS Code 或 Zed,直接用你写前端那个,明天再装 Python 插件)在这个目录里新建两个文件。先写你熟悉的:

```js
// terminal-practice/day08/hello.js
console.log("hello agent");
console.log("1 + 2 =", 1 + 2);
console.log("工单 T001 来自客户 C023");
```

<div class="line-notes">

- `// terminal-practice/day08/hello.js` 第一行注释写文件路径,这门课每个代码文件都这么写,方便你知道它该放哪。
- `console.log("1 + 2 =", 1 + 2);` 给 `console.log` 两个参数,打印时中间用空格隔开。

</div>

再写 Python 版,一行对一行:

```python
# terminal-practice/day08/hello.py
print("hello agent")
print("1 + 2 =", 1 + 2)
print("工单 T001 来自客户 C023")
```

<div class="line-notes">

- `# terminal-practice/day08/hello.py` Python 的注释用 `#`,相当于 JS 的 `//`。到行尾为止都是注释,解释器不管。
- `print("hello agent")` `print` 对应 `console.log`。行尾**没有分号**,Python 里一行就是一句,换行就是结束。写上分号其实也不报错,但没人这么写,明天装的格式化工具会把它删掉。
- `print("1 + 2 =", 1 + 2)` 两个参数,打印时中间也是一个空格,行为和 `console.log` 一样。
- `print("工单 T001 来自客户 C023")` 中文直接写,Python 3 的字符串默认就是 Unicode,文件存成 UTF-8(编辑器默认就是)就没问题。Day 16 讲编码。

</div>

两个都跑一下:

```text
$ ls
hello.js
hello.py
$ node hello.js
hello agent
1 + 2 = 3
工单 T001 来自客户 C023
$ python3 hello.py
hello agent
1 + 2 = 3
工单 T001 来自客户 C023
```

<div class="line-notes">

- `$ ls` 确认两个文件都在。我这里一行一个是因为命令交给 zsh 当脚本跑,`ls` 没连着屏幕;你在终端里敲会排成两列。
- `$ node hello.js` 用 node 解释器跑 JS 文件。
- `$ python3 hello.py` 用 python3 解释器跑 Python 文件。命令的结构一模一样:解释器名 + 文件路径。
- `工单 T001 来自客户 C023` 三行输出完全一致,走的都是标准输出,所以 Day 5 学的 `>`、`|` 对它一样有效,比如 `python3 hello.py | grep 工单`。

</div>

把今天见到的对应关系放在一张表里:

| JS / Node | Python | 说明 |
| --- | --- | --- |
| `node` | `python3` | 解释器。macOS 上写 `python3`,不写 `python`(Day 7) |
| `node`(不带参数) | `python3`(不带参数) | 交互模式,提示符 `>` 对 `>>>` |
| `.exit` | `exit()` 或 Ctrl+D | 退出交互模式 |
| `node -e "..."` | `python3 -c "..."` | 执行一行代码 |
| `node hello.js` | `python3 hello.py` | 跑一个脚本文件 |
| `console.log(a, b)` | `print(a, b)` | 打印,多个参数用空格隔开 |
| `// 注释` | `# 注释` | 单行注释 |
| 行尾 `;` | 不写 | Python 换行就是一句结束 |
| `{ }` 包住代码块 | 缩进 | 下面马上会撞到 |

### 在别的目录跑

Day 3 那条规矩在 Python 里一样成立:命令里的相对路径,相对的是你现在站的目录。

```text
$ cd ~
$ python3 hello.py
python3: can't open file '/Users/你/hello.py': [Errno 2] No such file or directory
$ python3 terminal-practice/day08/hello.py
hello agent
1 + 2 = 3
工单 T001 来自客户 C023
```

<div class="line-notes">

- `$ cd ~` 回家目录。
- `python3: can't open file '/Users/你/hello.py': [Errno 2] No such file or directory` 报错的是 `python3` 自己,它把 `hello.py` 接在工作目录后面,拼出 `/Users/你/hello.py`,那里没有这个文件。`Errno 2` 就是 Node 报的 `ENOENT`,同一个系统错误,两种叫法。
- `$ python3 terminal-practice/day08/hello.py` 写对路径就行。用 `~/terminal-practice/day08/hello.py` 也可以,那样在哪都对。

</div>

## 两种报错:一行都没跑,和跑到一半

下面故意写错。第一类错是**语法错误**(SyntaxError):代码写得不符合语言规则,解释器根本读不懂。第二类是**运行时错误**:语法没问题,解释器读懂了,执行到某一行时出了事。在 Python 里运行时错误叫**异常**(exception),`NameError` 就是其中一种。

为了看清区别,两个文件都写四步,只在第 3 步出错。先看语法错,第 3 行少了一个右引号:

```python
# terminal-practice/day08/syntax_err.py
print("第 1 步:读工单")
print("第 2 步:分类")
print("第 3 步:写报告)
print("第 4 步:完成")
```

<div class="line-notes">

- `print("第 1 步:读工单")` 第 1、2 步都是对的。
- `print("第 3 步:写报告)` 字符串的右引号漏了。
- `print("第 4 步:完成")` 第 4 步也是对的。

</div>

```text
$ cd ~/terminal-practice/day08
$ python3 syntax_err.py
  File "/Users/你/terminal-practice/day08/syntax_err.py", line 4
    print("第 3 步:写报告)
          ^
SyntaxError: unterminated string literal (detected at line 4)
```

<div class="line-notes">

- `$ python3 syntax_err.py` 跑它。
- `File "/Users/你/terminal-practice/day08/syntax_err.py", line 4` 出错的文件和行号。第 4 行,因为第 1 行是注释,`print("第 3 步...` 在文件的第 4 行。
- `^` 小尖角指着出问题的位置:从这个引号开始的字符串没有结束。
- `SyntaxError: unterminated string literal (detected at line 4)` 「字符串字面量没有结束」。**注意上面一行输出都没有**,第 1 步、第 2 步明明是对的,也没打印。

</div>

再看运行时错,第 3 步用了前端手感写的 `console.log`:

```python
# terminal-practice/day08/runtime_err.py
print("第 1 步:读工单")
print("第 2 步:分类")
console.log("第 3 步:写报告")
print("第 4 步:完成")
```

<div class="line-notes">

- `console.log("第 3 步:写报告")` 语法上没毛病:`名字.名字(参数)` 是合法的 Python 写法,只是 Python 里没有叫 `console` 的东西。

</div>

```text
$ python3 runtime_err.py
第 1 步:读工单
第 2 步:分类
Traceback (most recent call last):
  File "/Users/你/terminal-practice/day08/runtime_err.py", line 4, in <module>
    console.log("第 3 步:写报告")
    ^^^^^^^
NameError: name 'console' is not defined
```

<div class="line-notes">

- `第 1 步:读工单` 这次前两步**打印出来了**。
- `Traceback (most recent call last):` traceback 是 Python 的报错调用栈,相当于 JS 报错下面那串 `at ...`。「most recent call last」的意思是越往下越接近出事的地方,所以**读 traceback 从最后一行往上读**。Day 35 专门讲怎么读长的。
- `File "/Users/你/terminal-practice/day08/runtime_err.py", line 4, in <module>` 第 4 行出的事。`<module>` 表示这行代码写在文件最外层,不在任何函数里。
- `^^^^^^^` 一排尖角标出是 `console` 这个名字出了问题。3.11 起才有这么细的标记,老版本没有。
- `NameError: name 'console' is not defined` 异常的类型 `NameError` + 说明:名字 `console` 没有定义过。第 4 步没打印,程序在第 3 步就停了。

</div>

为什么一个一行没跑、一个跑到一半?因为解释器拿到文件后分两个阶段干活:先把**整个文件**从头读到尾,检查是不是合法的 Python,翻译成它内部能执行的形式;检查通过了,再从第一行开始一行行执行。语法错在第一阶段就被发现,第二阶段根本没开始;`console` 不存在这件事,只有执行到那一行、真去找这个名字的时候才知道。

<figure>
<svg viewBox="0 0 640 250" role="img" aria-label="解释器两个阶段:先读完整个文件检查语法,语法错在这里停下,一行都不执行;再逐行执行,运行时错误在执行到那一行时停下,前面的行已经执行了">
<rect x="0" y="0" width="640" height="250" fill="var(--paper-raised)" rx="6"/>
<g font-family="var(--font-mono)" font-size="12">
<rect x="20" y="24" width="270" height="70" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="32" y="48" fill="var(--ink)">阶段一:读完整个文件,查语法</text>
<text x="32" y="72" fill="var(--ink-soft)">漏引号、漏括号、缩进不对</text>
<line x1="290" y1="59" x2="338" y2="59" stroke="var(--ink-soft)"/><polygon points="338,54 348,59 338,64" fill="var(--ink-soft)"/>
<rect x="350" y="24" width="270" height="70" rx="6" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="362" y="48" fill="var(--ink)">阶段二:从第 1 行起逐行执行</text>
<text x="362" y="72" fill="var(--ink-soft)">执行到哪,才知道那一行行不行</text>
<line x1="155" y1="94" x2="155" y2="122" stroke="var(--mem)"/>
<text x="32" y="142" fill="var(--ink)">SyntaxError 在这里停</text>
<text x="32" y="164" fill="var(--ink-soft)">输出:一行都没有</text>
<text x="32" y="186" fill="var(--ink-soft)">syntax_err.py</text>
<line x1="485" y1="94" x2="485" y2="122" stroke="var(--compute)"/>
<text x="362" y="142" fill="var(--ink)">NameError 在第 4 行停</text>
<text x="362" y="164" fill="var(--ink-soft)">输出:第 1 步、第 2 步</text>
<text x="362" y="186" fill="var(--ink-soft)">runtime_err.py</text>
<line x1="20" y1="206" x2="620" y2="206" stroke="var(--rule)"/>
<text x="20" y="230" fill="var(--ink-soft)">Node 也是这两个阶段:SyntaxError 一行不跑,ReferenceError 跑到一半</text>
</g>
</svg>
<figcaption>两个阶段。报错之前有没有输出,能帮你一眼判断是哪一类错。</figcaption>
</figure>

Node 也是这样,你可以对照着跑一下 JS 版(两个文件和 Python 版一样,只是把 `print` 和 `console.log` 换过来,JS 版第 3 行写的是 `print(...)`):

```text
$ node syntax_err.js
/Users/你/terminal-practice/day08/syntax_err.js:4
console.log("第 3 步:写报告);
            ^^^^^^^^^^^^

SyntaxError: Invalid or unexpected token
    at wrapSafe (node:internal/modules/cjs/loader:1861:18)
$ node runtime_err.js
第 1 步:读工单
第 2 步:分类
/Users/你/terminal-practice/day08/runtime_err.js:4
print("第 3 步:写报告");
^

ReferenceError: print is not defined
    at Object.<anonymous> (/Users/你/terminal-practice/day08/runtime_err.js:4:1)
```

<div class="line-notes">

- `$ node syntax_err.js` JS 版漏了引号。
- `SyntaxError: Invalid or unexpected token` 同样一行都没打印。下面还有七行 Node 内部的 `at ...`,我截掉了,最后一行是 `Node.js v24.22.0`。
- `$ node runtime_err.js` JS 版第 3 行写成了 Python 的 `print`。
- `第 1 步:读工单` 同样先打印了两步。
- `ReferenceError: print is not defined` JS 里「名字没定义」叫 `ReferenceError`,Python 里叫 `NameError`,是同一种错。

</div>

两边的道理完全一样,区别只在报错的格式:Python 把最重要的那句放在**最后一行**,Node 放在中间,下面跟一长串内部调用栈。读 Python 报错,眼睛先去最后一行。

### 再撞三个前端同学最常撞的错

这三个都是语法错,我都实际跑过。第一个是 Python 和 JS 最大的不同:**缩进是语法的一部分**。JS 用 `{ }` 圈出一块代码,缩进只是为了好看;Python 不用花括号,靠缩进判断哪几行是一块(Day 17 学 `if` 时你会天天用到)。所以最外层的代码不能随便缩进:

```python
# terminal-practice/day08/indent_err.py
print("hello agent")
  print("多了两个空格")
```

<div class="line-notes">

- `  print("多了两个空格")` 这一行前面多了两个空格。在 JS 里这完全没关系。

</div>

```text
$ python3 indent_err.py
  File "/Users/你/terminal-practice/day08/indent_err.py", line 3
    print("多了两个空格")
IndentationError: unexpected indent
```

<div class="line-notes">

- `line 3` 第 3 行。
- `IndentationError: unexpected indent` 「意料之外的缩进」。`IndentationError` 是语法错的一种,所以第 2 行的 `hello agent` 也没打印。从网页上复制代码时最容易带进多余的空格,这也是这门课让你自己敲的原因之一。

</div>

第二个是中文输入法的引号。中文输入法下打的 `“ ”` 是中文引号,长得像,但在 Python 眼里是两个完全不同的字符:

```python
# terminal-practice/day08/quote_err.py
print(“hello agent”)
```

```text
$ python3 quote_err.py
  File "/Users/你/terminal-practice/day08/quote_err.py", line 2
    print(“hello agent”)
          ^
SyntaxError: invalid character '“' (U+201C)
```

<div class="line-notes">

- `SyntaxError: invalid character '“' (U+201C)` 「无效字符」,后面括号里是这个字符的 Unicode 编号。看到 `U+201C`、`U+201D`(中文双引号)、`U+FF08`(中文括号)、`U+FF1A`(中文冒号)这类报错,就是输入法没切回英文。写代码时把输入法切成英文,或者在输入法设置里打开「中文状态下使用英文标点」。

</div>

第三个来自网上的老教程。Python 2 时代 `print` 不用括号,很多十几年前的文章还是这么写的:

```python
# terminal-practice/day08/py2_err.py
print "hello agent"
```

```text
$ python3 py2_err.py
  File "/Users/你/terminal-practice/day08/py2_err.py", line 2
    print "hello agent"
    ^^^^^^^^^^^^^^^^^^^
SyntaxError: Missing parentheses in call to 'print'. Did you mean print(...)?
```

<div class="line-notes">

- `SyntaxError: Missing parentheses in call to 'print'. Did you mean print(...)?` 解释器认出了这是 Python 2 的写法,直接告诉你要加括号。Python 2 在 2020 年就停止维护了,教程里看到 `print` 后面不带括号,说明这篇教程太老,换一篇。

</div>

顺带看一眼新版本好在哪。同样的 `syntax_err.py`,交给我机器上苹果那个 3.8 跑:

```text
$ /usr/bin/python3 syntax_err.py
  File "syntax_err.py", line 4
    print("第 3 步:写报告)
                     ^
SyntaxError: EOL while scanning string literal
```

<div class="line-notes">

- `SyntaxError: EOL while scanning string literal` 3.8 的说法是「扫描字符串时遇到了行尾(EOL, end of line)」,意思一样,但对新手来说比 3.12 的「字符串没有结束」难懂得多,尖角也没指到引号上。Python 从 3.10 起花了很大力气改进报错信息,`NameError` 后面那句 `Did you mean` 也是新版本才有的(练习 1 会看到)。这是用新版本学的又一个理由。

</div>

还有一个反方向的错:人在 zsh 里,却敲了 Python 代码。

```text
$ print("hello agent")
zsh: unknown file attribute: h
```

<div class="line-notes">

- `zsh: unknown file attribute: h` 报错的是 zsh,它把括号当成了自己的语法,说的话完全看不懂。看到 `zsh:` 开头的奇怪报错,先看看自己是不是在 `$` 后面敲了 Python。和前面 `>>> python3 hello.py` 正好是一对。

</div>

## 拼起来:做一个 Python 命令 hello-py

Day 7 用 Node 做了 `hello-agent`。同样的三件事(shebang、可执行权限、在 PATH 里的目录)换成 Python 也成立。这次的 shebang 写 `#!/usr/bin/env python3`,意思是「去 PATH 里找 `python3`,用它执行我」:

```text
$ echo '#!/usr/bin/env python3' > ~/bin/hello-py
$ echo 'print("hello agent, from python")' >> ~/bin/hello-py
$ cat ~/bin/hello-py
#!/usr/bin/env python3
print("hello agent, from python")
$ chmod +x ~/bin/hello-py
$ cd ~/Documents
$ hello-py
hello agent, from python
$ which hello-py
/Users/你/bin/hello-py
```

<div class="line-notes">

- `$ echo '#!/usr/bin/env python3' > ~/bin/hello-py` 第一行 shebang,新文件用 `>`,外面单引号(Day 7 说过双引号里的 `!` 会惹事)。文件名不带 `.py` 也行,系统看的是第一行。
- `$ echo 'print("hello agent, from python")' >> ~/bin/hello-py` 第二行是普通的 Python 代码,追加用 `>>`。
- `#!/usr/bin/env python3` `#` 在 Python 里是注释,所以 Python 执行这个文件时会跳过 shebang 这一行,不会报错。JS 不认 `#` 注释,Node 是专门给第一行的 `#!` 开了特例。
- `$ chmod +x ~/bin/hello-py` 加可执行权限。忘了这一步就是 Day 7 那个 `permission denied`。
- `$ cd ~/Documents` 换到一个不相干的目录。
- `hello agent, from python` 系统读到 shebang,去 PATH 里找到 `python3`(就是今天装的 3.12),用它执行了第二行。
- `/Users/你/bin/hello-py` `~/bin` 早在 Day 7 就加进 PATH 了,所以不用再改 `.zshrc`。

</div>

| 今天的零件 | 在上面哪一步 |
| --- | --- |
| 解释器是一个程序,版本归它管 | `which -a python3`、`python3 --version` |
| 安装包改 `.zprofile`,新窗口才生效 | 装完关掉重开终端 |
| 交互模式 `>>>` | 试 `print`、拿它当计算器 |
| `python3 -c` ≈ `node -e` | `round(5 / 9 * 100, 1)` |
| `python3 文件` ≈ `node 文件` | `python3 hello.py` |
| 语法错一行不跑,运行时错跑到一半 | `syntax_err.py` 对 `runtime_err.py` |
| shebang + `chmod +x` + PATH | `~/bin/hello-py` |

## 动手练习

### 练习 1:先猜,再跑

在 `day08` 里建两个文件,先在纸上写下每个会打印什么,再跑:

```python
# terminal-practice/day08/guess1.py
print("A")
print("B")
print("C"
```

```python
# terminal-practice/day08/guess2.py
print("A")
print("B")
prnt("C")
print("D")
```

<details><summary>参考答案</summary>

```text
$ cd ~/terminal-practice/day08
$ python3 guess1.py
  File "/Users/你/terminal-practice/day08/guess1.py", line 4
    print("C"
         ^
SyntaxError: '(' was never closed
$ python3 guess2.py
A
B
Traceback (most recent call last):
  File "/Users/你/terminal-practice/day08/guess2.py", line 4, in <module>
    prnt("C")
    ^^^^
NameError: name 'prnt' is not defined. Did you mean: 'print'?
```

<div class="line-notes">

- `$ python3 guess1.py` 最后一行少了右括号,是语法错。
- `SyntaxError: '(' was never closed` 「这个左括号一直没有关上」,尖角指着那个 `(`。A 和 B 都没打印,因为第一阶段就失败了。猜「A、B 打印出来再报错」的,回去再看一遍那张两阶段的图。
- `$ python3 guess2.py` `print` 拼成了 `prnt`。语法上 `prnt("C")` 和 `print("C")` 一样合法,只是这个名字不存在。
- `A` A、B 打印了,因为这是运行时错。
- `NameError: name 'prnt' is not defined. Did you mean: 'print'?` 3.12 还猜到了你想写什么。D 没打印。

</div>

</details>

### 练习 2:一张工单的信息,在哪都能打印

在 `day08` 里写 `ticket.py`,打印 Day 3 起就在用的那张 T001 工单:工单号、类别、客户,再用 Python 算出「多扣了多少钱」(工单里说 299 元被扣了两次)。先在 `day08` 里跑,再到 `~/Documents` 里跑,两次都要成功。

<details><summary>参考答案</summary>

```python
# terminal-practice/day08/ticket.py
print("工单号:", "T001")
print("类别:", "计费")
print("客户:", "C023")
print("多扣了:", 299 * 2 - 299, "元")
```

<div class="line-notes">

- `print("工单号:", "T001")` 两个参数,打印时中间自动加一个空格,所以输出是 `工单号: T001`。
- `print("多扣了:", 299 * 2 - 299, "元")` 中间那个参数是一个算式,Python 先算出 598 − 299 = 299,再打印。三个参数之间各一个空格。

</div>

```text
$ cd ~/terminal-practice/day08
$ python3 ticket.py
工单号: T001
类别: 计费
客户: C023
多扣了: 299 元
$ cd ~/Documents
$ python3 ~/terminal-practice/day08/ticket.py
工单号: T001
类别: 计费
客户: C023
多扣了: 299 元
```

<div class="line-notes">

- `多扣了: 299 元` 数字前后各有一个空格,是 `print` 加的。想要 `299元` 紧挨着,要用 Day 15 的 f-string。
- `$ python3 ~/terminal-practice/day08/ticket.py` 换了目录就写完整路径。`~` 在这里能用,因为它是 zsh 在命令运行前替换的,`python3` 拿到的已经是 `/Users/你/terminal-practice/day08/ticket.py`。

</div>

</details>

### 练习 3:交互模式当计算器

打开 `python3` 交互模式,算三件事:Day 6 周报的计费占比(5 张 ÷ 9 张,保留一位小数);C023 被多扣的 299 元如果按 13% 的税算,税是多少;最后用正确的方式退出。再试一下在 `>>>` 里敲 `exit`(不带括号)会怎样。

<details><summary>参考答案</summary>

```text
$ python3
Python 3.12.13 (main, Jun 23 2026, 15:54:40) [Clang 22.1.3 ] on darwin
Type "help", "copyright", "credits" or "license" for more information.
>>> round(5 / 9 * 100, 1)
55.6
>>> 299 * 0.13
38.870000000000005
>>> round(299 * 0.13, 2)
38.87
>>> exit
Use exit() or Ctrl-D (i.e. EOF) to exit
>>> exit()
```

<div class="line-notes">

- `>>> round(5 / 9 * 100, 1)` 交互模式里不用 `print`,值会自动显示。
- `55.6` 和 Day 6 的结果一致。
- `>>> 299 * 0.13` 小数乘法。
- `38.870000000000005` 我第一次跑也愣了一下:手算明明是 38.87。这是浮点数的舍入误差,JS 里 `299 * 0.13` 也是这个数。钱的计算用小数有坑,Day 12 会用 `0.1 + 0.2` 讲清楚为什么。
- `>>> round(299 * 0.13, 2)` 先用 `round` 保留两位小数凑合一下。正经算钱的办法在后面的课里。
- `38.87` 这回是想要的数。
- `Use exit() or Ctrl-D (i.e. EOF) to exit` 不带括号不会退出。
- `>>> exit()` 带括号才退出,回到 `$`。

</div>

</details>

### 练习 4:shebang 写死路径会怎样

在 `~/bin` 里写一个 `which-py`,让它打印「我是被哪个 Python 执行的、版本多少」。再复制一份叫 `which-py-old`,只把第一行改成 `#!/usr/bin/python3`。两个都加上可执行权限,各跑一次,解释为什么结果不同。

要用到两行今天没讲的代码,先照抄:`import sys` 把 Python 自带的 `sys` 模块拿进来(相当于 JS 的 `import`,Day 32 讲),`sys.executable` 是当前解释器文件的路径,`sys.version` 是它的版本。

<details><summary>参考答案</summary>

```python
#!/usr/bin/env python3
import sys
print("我是", sys.executable)
print("版本", sys.version)
```

<div class="line-notes">

- `#!/usr/bin/env python3` 去 PATH 里找 `python3`。这是 `~/bin/which-py` 的内容。
- `import sys` 引入标准库里的 `sys` 模块,装 Python 时就有,不用另外装。
- `print("我是", sys.executable)` 打印正在执行这个文件的解释器的路径。
- `print("版本", sys.version)` 打印完整版本信息。

</div>

`which-py-old` 和它只差第一行,用编辑器把 `which-py` 另存一份,改掉第一行就行:

```text
$ chmod +x ~/bin/which-py ~/bin/which-py-old
$ cat ~/bin/which-py-old
#!/usr/bin/python3
import sys
print("我是", sys.executable)
print("版本", sys.version)
$ which-py
我是 /Users/你/bin/python3
版本 3.12.13 (main, Jun 23 2026, 15:54:40) [Clang 22.1.3 ]
$ which-py-old
我是 /Library/Developer/CommandLineTools/usr/bin/python3
版本 3.8.2 (default, Nov  4 2020, 21:23:28) 
[Clang 12.0.0 (clang-1200.0.32.28)]
```

<div class="line-notes">

- `$ chmod +x ~/bin/which-py ~/bin/which-py-old` 两个一起加权限,`chmod` 可以接多个文件。
- `#!/usr/bin/python3` 第一行写死了一个具体文件,不经过 PATH。
- `我是 /Users/你/bin/python3` `env` 在 PATH 里找到的第一个 `python3`。我这里是演示家目录那个链接,你那边是 `/Library/Frameworks/Python.framework/Versions/3.12/bin/python3`。
- `版本 3.12.13` 跑的是 3.12。
- `我是 /Library/Developer/CommandLineTools/usr/bin/python3` 写死的 `/usr/bin/python3` 其实又转去了命令行开发者工具里的那个 Python,不管你 PATH 怎么配都是它。
- `版本 3.8.2` 于是你的脚本被一个老得多的 Python 执行了。今天的 `print` 写法 3.8 也认,所以没报错;要是脚本里用了新版本才有的写法,就会莫名其妙地 `SyntaxError`。

</div>

结论:shebang 写 `#!/usr/bin/env python3`,让 PATH 决定用哪个 Python,你在一处(`.zprofile`)管好版本,所有脚本都跟着走。写死路径的脚本换一台机器、或者你升级了 Python,就可能跑在别的版本上。做完把两个文件删掉:`rm ~/bin/which-py ~/bin/which-py-old`。

</details>

验收标准:`python3 --version` 打印 `Python 3.12.x`;`which -a python3` 第一行是你装的那个 3.12;`~/terminal-practice/day08/` 里有 `hello.py`、`hello.js` 和几个报错文件,`hello.py` 在家目录用完整路径能跑;看到一段报错,能先根据「报错前有没有输出」说出是语法错还是运行时错,再从最后一行读出错误类型;`hello-py` 在 `~/Documents` 里能直接敲。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 解释器(interpreter) | 读源代码并执行它的程序。`node` 是 JS 的解释器,`python3` 是 Python 的。版本是解释器的属性,不是代码文件的 |
| Python 3.12 / 3.12.10 | 前两段 3.12 是大版本,决定有哪些语法;最后一段是修 bug 和安全问题的小版本 |
| python.org 安装包 | 官网的 `.pkg` 文件,把 Python 装进 `/Library/Frameworks/Python.framework`,在 `/usr/local/bin` 放符号链接,并往 `~/.zprofile` 追加 PATH |
| 交互模式 / REPL | 不给文件直接运行解释器,敲一行执行一行,表达式的值自动显示。Python 的提示符是 `>>>`,Node 是 `>`,DevTools Console 也是一个 REPL |
| `python3 -c` | 执行引号里的一行 Python 代码,对应 `node -e` |
| 脚本 | 存在文件里、交给解释器从头执行的代码,如 `python3 hello.py` |
| `print` | Python 的打印函数,对应 `console.log`,多个参数之间加一个空格 |
| `#` 注释 | Python 的单行注释,对应 JS 的 `//` |
| 语法错误(SyntaxError) | 代码不符合语言规则,解释器在执行前检查整个文件时发现,一行都不执行 |
| `IndentationError` | 语法错误的一种,缩进不对。Python 用缩进而不是 `{ }` 划分代码块 |
| 异常(exception) | Python 对运行时错误的叫法,执行到那一行才发生,前面的行已经执行过了 |
| `NameError` | 用了一个没定义的名字,如 `console`、`prnt`。对应 JS 的 `ReferenceError` |
| traceback | Python 的报错调用栈。越往下越接近出事的地方,最后一行是错误类型和说明,先读它 |
| `#!/usr/bin/env python3` | Python 脚本的 shebang([Day 7](/blog/agent-zero/day-007-terminal-4/)),在 PATH 里找 `python3` 来执行 |

## 常见误区

**以为 Mac 自带的 Python 就够用。** 苹果的 `/usr/bin/python3` 是命令行开发者工具附带的,我这台是 3.8.2,新一些的 Mac 上是 3.9.x,两个版本都已经停止支持了。它是给系统和开发工具用的,不归你管,也不该删。自己学习和做项目,装一个自己的新版本。

**装完 Python,在原来的窗口里验证。** 安装包改的是 `~/.zprofile`,已经开着的窗口不会重读它,`python3 --version` 还是老版本,你会以为没装上。关掉终端重开再看。这和 Day 7 改完 `.zshrc` 不生效是同一件事。

**在 `>>>` 里敲终端命令,或者在 `$` 里敲 Python 代码。** 前者报 `SyntaxError: invalid syntax`,后者报 `zsh: unknown file attribute` 这种看不懂的话。敲之前先看提示符。

**前端手感写出 `console.log`。** Python 里报 `NameError: name 'console' is not defined`。反过来,在 JS 里写 `print` 报 `ReferenceError: print is not defined`。这两个错一个星期内你多半会各犯一次,看到就知道是手比脑子快了。

**最外层代码前面多了空格。** 报 `IndentationError: unexpected indent`。JS 里缩进随便,Python 里缩进就是语法。从网页、聊天窗口复制代码最容易带进多余空格。

**中文引号、中文括号。** 报 `SyntaxError: invalid character '“' (U+201C)`。写代码时切英文输入法,或者打开输入法的「中文状态下使用英文标点」。

**照着老教程写 `print "hello"`。** 那是 Python 2 的写法,报 `Missing parentheses in call to 'print'`。不带括号的 `print`、`raw_input`、`python xxx.py` 这些字眼,都说明那篇教程是 2020 年以前的,换一篇。

**`python3 hello.py` 报 `can't open file`。** 不是 Python 坏了,是你站的目录不对,和 Day 3 那个 `ENOENT` 一回事。`pwd` 看一眼,或者写完整路径。

**shebang 写死成 `#!/usr/bin/python3`。** 脚本会被苹果那个老 Python 执行,不管你 PATH 怎么配。写 `#!/usr/bin/env python3`。

## 学习资料

### 文档与文章

- [Python 官方教程 · 2. 使用 Python 解释器](https://docs.python.org/zh-cn/3.12/tutorial/interpreter.html):中文,官方 3.12 文档。讲怎么启动解释器、交互模式、`-c`、源文件编码。很短,今天读完,和正文对照。
- [Python 官方文档 · 5. 在 Mac 上使用 Python](https://docs.python.org/zh-cn/3.12/using/mac.html):中文,讲 python.org 安装包装了哪三样东西、苹果自带的 Python 不要动。正文「装完你应该看到」那一段就是按这页和安装包内容写的。
- [Python 官方教程 · 8. 错误和异常](https://docs.python.org/zh-cn/3.12/tutorial/errors.html):中文,今天只读 8.1「语法错误」和 8.2「异常」两小节,就是正文两种报错的官方说法。后面的 `try` 等 Day 35 再读。
- [廖雪峰 · 第一个 Python 程序](https://liaoxuefeng.com/books/python/first-program/index.html):中文,国内很多人入门 Python 读的教程。这一节讲交互模式和命令行模式的区别,正好是今天的内容,换个人的讲法再看一遍。
- [Python Tutor](https://pythontutor.com/):在网页里一步步执行 Python 代码,看每一步发生了什么。今天把 `runtime_err.py` 的四行粘进去点「Next」,看它怎么执行到第 3 行停下。
- [Python 官方 · 版本状态表](https://devguide.python.org/versions/):英文,每个大版本的支持截止日期。正文「3.10 在 2026-10-01 停止支持」「3.12 支持到 2028 年 10 月」出自这里。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1anXaBCE4C&autoplay=0&high_quality=1" title="在macOS上安装python-通过官网与miniconda" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>李勃老师 · 在macOS上安装python-通过官网与miniconda · 12 分钟,2026 年 3 月。只看前半段「通过官网」的部分,看一遍下载页和安装界面长什么样再自己动手。后半段的 miniconda 这门课不用,跳过。视频里装的版本可能和这里不同,以正文的 3.12.10 为准。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV13Q4y1i7DB&autoplay=0&high_quality=1" title="[13] Python交互模式 | 输入一行执行一行" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>林粒粒呀 · [13] Python交互模式 | 输入一行执行一行 · 不到 3 分钟。讲交互模式和写文件运行有什么不同、各自适合什么时候用,和正文「交互模式」那一节是一回事。</figcaption>
</figure>

另外 [程序员陈雷雷 · 两分钟搞懂python解释器到底是什么](https://www.bilibili.com/video/BV1P64y1V7WM)(不到 2 分钟)可以当正文第一节的补充。

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/YYXdXT2l-Gg" title="Python Tutorial for Beginners 1: Install and Setup for Mac and Windows" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Corey Schafer · Python Tutorial for Beginners 1: Install and Setup for Mac and Windows · 英文,可开自动字幕。Corey Schafer 的 Python 入门系列是英文世界里被推荐最多的之一。这期是 2017 年的,装的版本很老,但讲 Mac 上「系统自带的 Python 和你自己装的 Python 是两个」「交互模式和跑脚本」的部分没有过时。只看 Mac 那一半。</figcaption>
</figure>

### 书籍

- Eric Matthes《Python Crash Course》第 3 版,No Starch Press,2023;中文版《Python 编程:从入门到实践(第 3 版)》,人民邮电出版社。Day 2 提过它。今天读第 1 章「起步」,讲在三种系统上装 Python、在终端运行 `hello_world.py`、遇到问题怎么办,和今天一一对应。
- Al Sweigart《Automate the Boring Stuff with Python》第 3 版,No Starch Press,2025,作者在 [automatetheboringstuff.com](https://automatetheboringstuff.com/) 免费提供英文全文。写给完全没编程经验的人的。第 1 章用交互模式当计算器开始讲,可以接着今天的练习 3 读。

### 开源项目与代码

- [python/cpython](https://github.com/python/cpython):`python3` 这个解释器的源代码,今天装的就是它编译出来的。今天不用读代码,点进 `Lib/` 目录看一眼:装 Python 时一起装上的「标准库」有几百个模块,其中大部分就是一个个 `.py` 文件,以后你想知道某个自带函数怎么实现的,会来这里查。
- [ehmatthes/pcc_3e 的 chapter_01](https://github.com/ehmatthes/pcc_3e/tree/main/chapter_01):上面那本书第 1 章的代码,就一个 `hello_world.py`。看看别人的第一个 Python 文件,和你的 `hello.py` 比一比。

## 自测

1. 你敲 `python3 --version`,打印 `Python 3.9.6`,可你刚装完 3.12。最可能的原因是什么?按顺序查哪几样?

<details><summary>答案</summary>

最可能是还在装之前开的那个终端窗口里,`~/.zprofile` 被安装包改了但这个窗口没重读。查的顺序:先关掉终端重开再敲一次;还不对就 `which -a python3`,看 `/Library/Frameworks/Python.framework/Versions/3.12/bin/python3` 在不在、排第几;再 `cat ~/.zprofile` 看安装包追加的四行有没有写进去(安装时如果取消了「Shell profile updater」就不会有)。

</details>

2. 一个 Python 文件第 10 行有语法错,前 9 行都是 `print`。运行它会打印几行?换成第 10 行是 `NameError` 呢?

<details><summary>答案</summary>

语法错:一行都不打印。解释器先检查整个文件,第 10 行不合法,执行阶段根本不开始。`NameError`:前 9 行都打印,执行到第 10 行才发现名字不存在,程序停下,第 10 行之后的也不执行。

</details>

3. 屏幕上的提示符是 `>>>`,你想运行 `hello.py`,应该怎么做?

<details><summary>答案</summary>

你现在在 Python 的交互模式里,`python3 hello.py` 是终端命令,在这里敲会报 `SyntaxError`。先用 `exit()` 或 Ctrl+D 退出,回到 `$` 提示符,再敲 `python3 hello.py`(确认工作目录对,或者写完整路径)。

</details>

4. 下面这段 traceback,出错的是哪个文件第几行、什么错?你会怎么改?

```text
Traceback (most recent call last):
  File "/Users/你/terminal-practice/day08/report.py", line 7, in <module>
    console.log(total)
    ^^^^^^^
NameError: name 'console' is not defined
```

<details><summary>答案</summary>

`report.py` 第 7 行,`NameError`:用了 Python 里不存在的 `console`。这是 JS 手感写出来的,改成 `print(total)`。读的时候先看最后一行知道是什么错,再往上一行看是哪个文件哪一行。

</details>

5. 面试题:同事写了一个 Python 脚本,第一行是 `#!/usr/bin/python3`,在他电脑上好好的,部署到服务器上报 `SyntaxError`,而代码一个字没改。你会怀疑什么?怎么改?

<details><summary>答案</summary>

怀疑两台机器上 `/usr/bin/python3` 不是同一个版本:服务器上那个更老,不认识脚本里用到的新语法(语法错是在解析阶段按解释器自己的版本判断的,同一份代码新版本合法、老版本不合法很常见)。先在服务器上跑 `/usr/bin/python3 --version` 确认。改法:shebang 改成 `#!/usr/bin/env python3`,并保证服务器 PATH 里排第一的是需要的版本;更稳的做法是用项目级的工具锁定版本(这门课从 Day 10 起用 uv),用 `uv run` 运行,而不是靠系统里碰巧有的那个 Python。

</details>

## 明天预告

Day 9 · 编辑器准备:Zed/VS Code 的 Python 插件、格式化和类型检查。今天的五种报错,都是跑了才知道。明天给编辑器装上 Python 支持,很多错在你敲完那一刻就会画上红线:少了引号、多了缩进、把 `print` 拼成 `prnt`。还会装一个格式化工具,保存时自动把代码排成统一的样子,作用相当于你前端项目里的 Prettier。今天 `day08` 里这几个故意写错的文件,明天正好拿来看红线。
