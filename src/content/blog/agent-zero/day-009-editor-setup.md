---
title: 'Day 9 · 编辑器准备:Zed/VS Code 的 Python 插件、格式化和类型检查'
description: '写 TS 时编辑器里的红线是 TypeScript 画的,Python 这边换成 basedpyright 和 Ruff 两个程序。今天把它们接进 Zed(或 VS Code),拿 Day 8 那几个故意写错的文件看红线,搞清楚哪些错不用跑就能看出来、哪些看不出来,再把「保存时自动格式化」打开。'
pubDate: 2026-10-22
regime: none
tags: ['python', 'agent-zero']
series: 'agent-zero'
day: 9
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 8](/blog/agent-zero/day-008-python-vs-node/) 装好了 Python 3.12.10,知道了 `python3` 和 `node` 一样是个解释器,写了第一个 `hello.py`,还故意犯了五种错:漏引号、多缩进、中文引号、Python 2 写法的 `print`,以及前端手感写出来的 `console.log`。那天的结论是,语法错一行都不跑,运行时错跑到一半才停。

不管哪一种,那天都是**跑了才知道**。可你写 TS 的时候不是这样:变量名拼错、类型对不上,敲完那一刻编辑器就画上红线了,根本不用等到浏览器里报错。今天就给 Python 也配上这套东西。`~/terminal-practice/day08/` 里那几个报错文件正好留着,今天拿它们当靶子。

## 今天要解决的问题

学完今天,你应该能:

1. 说清楚编辑器里的红线是谁画的:不是编辑器自己,是它在后台启动的「语言服务器」。Python 这边我们用 basedpyright 管类型和名字,用 Ruff 管代码规范和格式,对应前端的 TypeScript、ESLint 和 Prettier。
2. 在 Zed(或 VS Code)里打开 Day 8 的 `syntax_err.py`、`runtime_err.py`、`indent_err.py`,看到红线,能读懂悬停提示里的那句英文,并能说出 `NameError` 这种「运行时错」为什么不跑也能被标出来。
3. 知道类型检查器的边界:哪些错它能提前发现(把字符串当数字减),哪些它看不出来(除以零)。
4. 打开「保存时自动格式化」,把一个排版乱七八糟的文件一保存就排整齐,并用 Ruff 的快速修复删掉没用的 `import`。

预计用时:2 小时。装编辑器和插件 30 分钟,看红线 40 分钟,格式化 20 分钟,剩下做练习。

前置:[Day 7](/blog/agent-zero/day-007-terminal-4/)(PATH、符号链接)、[Day 8](/blog/agent-zero/day-008-python-vs-node/)(`~/terminal-practice/day08/` 里的报错文件、两类报错)。今天不调任何 API,花费 0 元。

学法提示:先对照文章逐条做一遍(代码自己敲,不复制粘贴),每个文件都亲眼看到红线;第二天合上文章,默写出 Zed 那段 `settings.json` 和「红线是谁画的」那张对照表;然后做动手练习,做不出再展开参考答案,看完关掉自己重写一遍。

## 先说清楚我是在哪跑的

我用的是 2026-10-22 这台 2019 款 Intel MacBook Pro 上装着的 **Zed 1.25.2**。Zed 第一次打开 `.py` 文件时自己下载了 basedpyright 1.40.2 和 Ruff 0.17.1,文中所有红线的提示文字,都是我用 Zed 下载的这两个程序在命令行对同一批文件跑出来的原文,和你在编辑器里鼠标悬停看到的那句话一样。编辑器界面我没截图,按钮和菜单的位置按 Zed 官方文档写。

我这台机器上没装 VS Code,所以「用 VS Code 的话」那一节**没实跑**,按 basedpyright 和 Ruff 的官方文档写,会再标一次。

Python 的运行输出和 Day 8 一样,用演示家目录里那个 3.12.13 跑的,家目录显示成 `/Users/你`。

## 红线是谁画的

先回到你熟悉的地方。在 VS Code 里写 TS,把 `user.name` 拼成 `user.nmae`,下面立刻出现红色波浪线,鼠标放上去显示 `Property 'nmae' does not exist on type 'User'`。这句话不是 VS Code 写的。VS Code 在后台启动了一个 TypeScript 的程序(叫 tsserver),把你正在编辑的文件内容交给它,它分析完把「第几行第几列有什么问题」告诉 VS Code,VS Code 只负责把线画出来。ESLint 的黄线也是同样的路子,只是换了一个程序;保存时自动排版,是又一个程序 Prettier 在干活。

这种「编辑器把代码交给一个专门的程序分析,程序把结果送回来」的约定,有个正式的名字叫 **LSP**(Language Server Protocol,语言服务器协议),干活的那个程序叫**语言服务器**(language server)。微软 2016 年为 VS Code 定了这个协议,后来几乎所有编辑器都支持,所以同一个语言服务器,Zed、VS Code、Neovim 都能用。

Python 这边对应的程序是这两个:

- **basedpyright**:类型检查器(type checker),同时也是语言服务器。它读你的代码,检查名字有没有定义、类型对不对得上,还负责悬停提示、跳转到定义、自动补全。它是微软 pyright 的一个社区分支,规则更多一些,完全免费开源。作用相当于 TS 里的 `tsc` 加 tsserver。
- **Ruff**:代码检查器(linter)加格式化工具(formatter)。检查那一半像 ESLint,找出「能跑但写得不好」的地方,比如 import 了没用;格式化那一半像 Prettier,把空格、引号、换行排成统一的样子。它是用 Rust 写的,非常快。

<figure>
<svg viewBox="0 0 640 260" role="img" aria-label="前端:VS Code 把代码交给 tsserver、ESLint、Prettier;Python:Zed 把代码交给 basedpyright 和 Ruff。编辑器只负责画线">
<rect x="0" y="0" width="640" height="260" fill="var(--paper-raised)" rx="6"/>
<g font-family="var(--font-mono)" font-size="12">
<text x="20" y="26" fill="var(--ink-faint)">编辑器(只画线)</text>
<text x="300" y="26" fill="var(--ink-faint)">语言服务器(真正分析代码的程序)</text>
<rect x="20" y="40" width="160" height="80" rx="6" fill="var(--paper)" stroke="var(--rule)"/>
<text x="32" y="64" fill="var(--ink)">VS Code</text>
<text x="32" y="86" fill="var(--ink-soft)">写 TS 时</text>
<line x1="180" y1="80" x2="288" y2="80" stroke="var(--ink-soft)"/><polygon points="288,75 298,80 288,85" fill="var(--ink-soft)"/>
<text x="196" y="72" fill="var(--ink-faint)">LSP</text>
<rect x="300" y="40" width="96" height="80" rx="6" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="310" y="64" fill="var(--ink)">tsserver</text>
<text x="310" y="86" fill="var(--ink-soft)">类型/名字</text>
<rect x="408" y="40" width="96" height="80" rx="6" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="418" y="64" fill="var(--ink)">ESLint</text>
<text x="418" y="86" fill="var(--ink-soft)">代码规范</text>
<rect x="516" y="40" width="104" height="80" rx="6" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="526" y="64" fill="var(--ink)">Prettier</text>
<text x="526" y="86" fill="var(--ink-soft)">格式化</text>
<rect x="20" y="146" width="160" height="80" rx="6" fill="var(--paper)" stroke="var(--rule)"/>
<text x="32" y="170" fill="var(--ink)">Zed / VS Code</text>
<text x="32" y="192" fill="var(--ink-soft)">写 Python 时</text>
<line x1="180" y1="186" x2="288" y2="186" stroke="var(--ink-soft)"/><polygon points="288,181 298,186 288,191" fill="var(--ink-soft)"/>
<text x="196" y="178" fill="var(--ink-faint)">LSP</text>
<rect x="300" y="146" width="96" height="80" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="310" y="170" fill="var(--ink)">basedpyright</text>
<text x="310" y="192" fill="var(--ink-soft)">类型/名字</text>
<rect x="408" y="146" width="212" height="80" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="418" y="170" fill="var(--ink)">Ruff</text>
<text x="418" y="192" fill="var(--ink-soft)">代码规范 + 格式化,一个顶俩</text>
<text x="20" y="250" fill="var(--ink-soft)">换编辑器不换语言服务器:Zed 和 VS Code 里的红线,说的是同一句话</text>
</g>
</svg>
<figcaption>编辑器只是画线的,分析代码的是背后那几个程序。Python 这边只需要两个。</figcaption>
</figure>

| 前端 | Python | 管什么 |
| --- | --- | --- |
| TypeScript(tsc / tsserver) | basedpyright | 名字有没有定义、类型对不对,悬停提示,跳转定义 |
| ESLint | Ruff(`ruff check`) | 能跑但写得不好的地方,比如没用到的 import |
| Prettier | Ruff(`ruff format`) | 空格、引号、换行,排成统一样子 |
| `tsconfig.json` 的 `strict` | basedpyright 的 `typeCheckingMode` | 检查得多严 |

有一点和 TS 很不一样,先记住:**TS 的类型错误会让编译失败,Python 的类型检查器只是提醒**。basedpyright 画了一万条红线,`python3 xxx.py` 照样会去跑,跑到出事那一行才停。红线是给你看的,解释器不看。

## 装 Zed,把 Day 8 的目录打开

这门课默认用 [Zed](https://zed.dev/)。理由很实际:它对 Python 是开箱即用的,不用装插件,打开 `.py` 文件它自己去下载 basedpyright 和 Ruff,后面课里提到「Zed 里会标红」的地方,你看到的就和文中一样。你更习惯 VS Code 也完全可以,往下翻到「用 VS Code 的话」那一节。

到 zed.dev 下载 macOS 版,拖进「应用程序」文件夹,打开。然后做一件 Day 7 学过的事:让终端里能敲 `zed` 这个命令。在 Zed 里按 `cmd-shift-p` 打开命令面板,输入 `cli: install`,回车,输入一次开机密码。装完在终端里看一眼:

```text
$ which zed
/usr/local/bin/zed
$ ls -l /usr/local/bin/zed
lrwxr-xr-x  1 minliu  admin  40 13 May 10:26 /usr/local/bin/zed -> /Applications/Zed.app/Contents/MacOS/cli
$ zed --version
Zed 1.25.2 – /Applications/Zed.app
```

<div class="line-notes">

- `$ which zed` Day 7 的老朋友,看 `zed` 这个命令会运行哪个文件。
- `/usr/local/bin/zed` `/usr/local/bin` 本来就在 PATH 里,所以装完不用改 `.zshrc`。
- `-> /Applications/Zed.app/Contents/MacOS/cli` 它是一个符号链接,指向 Zed 安装包里一个叫 `cli` 的小程序。`cli: install` 这条命令做的事就是建了这个链接,和 Day 7 我们手动建 `~/bin/python3` 那种链接是一回事。日期是我当初装的时间,你那边是今天。
- `Zed 1.25.2 – /Applications/Zed.app` 版本号。2026 年 10 月我用的是 1.25.2,你装到的多半更新,今天讲的设置项在新版本里一样能用。

</div>

VS Code 也有一样的东西:命令面板里的 `Shell Command: Install 'code' command in PATH`,装完能敲 `code .`。

现在用它打开 Day 8 的练习目录:

```text
$ zed ~/terminal-practice/day08
```

<div class="line-notes">

- `$ zed ~/terminal-practice/day08` 打开一个**文件夹**,而不是单个文件。Zed 会把这个文件夹当成一个项目,左边的文件列表就是它里面的文件。以后打开课程仓库也是这样,`zed ~/agent-zero-lab`(Day 10 才建)。和前端里 `code .` 打开整个项目一个道理:语言服务器要知道项目的边界,才能找到同一个项目里的其他文件。

</div>

在左边点开 `hello.py`。第一次打开 Python 文件时,Zed 右下角会短暂显示在下载语言服务器,等十几秒。下载的东西放在这里(这条命令看看就行,不用敲):

```text
$ ls ~/Library/Application\ Support/Zed/languages/
basedpyright
bash-language-server
eslint
json-language-server
package-version-server
ruff
tailwindcss-language-server
typescript-language-server
vscode-css-language-server
vtsls
yaml-language-server
$ cat ~/Library/Application\ Support/Zed/languages/basedpyright/package.json
{
  "dependencies": {
    "basedpyright": "1.40.2"
  }
}
$ ls ~/Library/Application\ Support/Zed/languages/ruff/
ruff-0.17.1
ruff-0.17.metadata
```

<div class="line-notes">

- `$ ls ~/Library/Application\ Support/Zed/languages/` 路径里有空格,所以要用 `\ ` 转义,Day 3 讲过。这个目录是 Zed 存放各个语言服务器的地方。
- `basedpyright` 今天的主角之一。
- `eslint` 你写前端时 Zed 也会下载 ESLint、TypeScript 的语言服务器(`typescript-language-server`、`vtsls`),和 Python 的放在一起。这一列直观说明了「编辑器背后是一堆独立程序」。我这台机器写过前端,所以列表长;你如果是第一次用 Zed,只会有 Python 相关的几个。
- `"basedpyright": "1.40.2"` 有意思的是 basedpyright 是一个 npm 包:pyright 本身是用 TypeScript 写的,跑在 Node 上。Zed 用你机器上的 Node 去运行它。
- `ruff-0.17.1` Ruff 是一个单独的可执行文件,不需要 Node 也不需要 Python。

</div>

你不用管这些文件,Zed 会自己更新。知道它们在哪,出问题的时候心里有数。

## 看红线:Day 8 的报错文件

依次点开 Day 8 留下的几个文件。红色波浪线是 error(错误),黄色是 warning(警告),鼠标悬停在线上会弹出说明。几个快捷键先记下:`F8` 跳到下一个问题,`shift-F8` 跳到上一个,`cmd-shift-m` 打开一个面板,列出整个项目里所有问题。

### syntax_err.py:一个错,三条红线

```python
# terminal-practice/day08/syntax_err.py
print("第 1 步:读工单")
print("第 2 步:分类")
print("第 3 步:写报告)
print("第 4 步:完成")
```

<div class="line-notes">

- `print("第 3 步:写报告)` Day 8 故意漏掉的右引号。

</div>

这个文件里 basedpyright 报了三处,Ruff 也报了三处:

```text
basedpyright:
syntax_err.py:4:6 - error: "(" was not closed
syntax_err.py:4:7 - error: String literal is unterminated
syntax_err.py:6:1 - error: Statements must be separated by newlines or semicolons
Ruff:
syntax_err.py:4:7: invalid-syntax: missing closing quote in string literal
syntax_err.py:5:1: invalid-syntax: Expected `,`, found identifier
syntax_err.py:5:19: invalid-syntax: unexpected EOF while parsing
```

<div class="line-notes">

- `syntax_err.py:4:6 - error: "(" was not closed` 格式是「文件:行:列 - 级别: 说明」。第 4 行第 6 列是 `print` 后面那个左括号:「这个括号没有关上」。
- `syntax_err.py:4:7 - error: String literal is unterminated` 第 7 列是左引号:「字符串没有结束」。这就是真正的病根,和 Day 8 里 Python 自己报的 `unterminated string literal` 是同一个意思。
- `syntax_err.py:6:1 - error: Statements must be separated by newlines or semicolons` 第 6 行,文件最后那个空行。字符串没关上,解释器眼里从第 4 行那个引号起,后面所有内容都成了一锅粥,于是在很后面又冒出一条看起来莫名其妙的错。
- `syntax_err.py:4:7: invalid-syntax: missing closing quote in string literal` Ruff 也认出了同一个病根,说法略有不同:「字符串字面量缺少右引号」。
- `syntax_err.py:5:1: invalid-syntax: Expected `,`, found identifier` 第 5 行本来没错,也被连累了。
- `syntax_err.py:5:19: invalid-syntax: unexpected EOF while parsing` EOF 是文件结尾,Day 8 在退出交互模式时见过这个词。

</div>

在编辑器里,两个程序报的问题会叠在同一处,你会看到第 4 行和第 5 行都有红线。这里有一条很实用的经验:**一个语法错误会带出一串连锁红线,永远先修最上面那一条**。把第 4 行的右引号补上、保存,三条红线同时消失。这和前端里少了一个 `}` 结果后面整个文件都飘红是一回事。

再看 `indent_err.py`,一样的现象:

```text
basedpyright:
indent_err.py:3:1 - error: Unexpected indentation
indent_err.py:4:1 - error: Unindent not expected
indent_err.py:4:1 - error: Expected expression
indent_err.py:4:1 - error: Statements must be separated by newlines or semicolons
Ruff:
indent_err.py:3:1: invalid-syntax: Unexpected indentation
```

<div class="line-notes">

- `indent_err.py:3:1 - error: Unexpected indentation` 第 3 行开头多了两个空格:「意料之外的缩进」,对应 Day 8 里的 `IndentationError: unexpected indent`。
- `indent_err.py:4:1 - error: Unindent not expected` 后面三条都是被连累的。第 4 行是文件末尾的空行,缩进突然又「退回去」了,它也觉得不对。
- `indent_err.py:3:1: invalid-syntax: Unexpected indentation` Ruff 只报一条,说得更干脆。

</div>

修法:把第 3 行开头的两个空格删掉。删完四条红线一起消失。

### runtime_err.py:没跑,也知道 console 不存在

这个是今天最值得看的。Day 8 说过,`NameError` 是运行时错,要执行到那一行才知道。可是打开 `runtime_err.py`,第 4 行的 `console` 下面已经有一条红线了:

```python
# terminal-practice/day08/runtime_err.py
print("第 1 步:读工单")
print("第 2 步:分类")
console.log("第 3 步:写报告")
print("第 4 步:完成")
```

<div class="line-notes">

- `console.log("第 3 步:写报告")` 语法合法,只是 Python 里没有 `console`。

</div>

```text
basedpyright:
runtime_err.py:4:1 - error: "console" is not defined (reportUndefinedVariable)
Ruff:
runtime_err.py:4:1: F821 Undefined name `console`
```

<div class="line-notes">

- `"console" is not defined` 「`console` 没有定义」,和运行时的 `NameError: name 'console' is not defined` 几乎一字不差。后面括号里的 `reportUndefinedVariable` 是规则名。basedpyright 的每条检查都有个名字,以后想查某条规则是干什么的、或者想关掉它,就用这个名字去搜,作用和 ESLint 的 `no-undef` 这种规则名一样。
- `F821 Undefined name `console`` Ruff 的规则用编号,`F821` 是「未定义的名字」。`F` 开头的规则来自一个老牌 Python 检查工具 Pyflakes,Ruff 把它的规则都收了进来。

</div>

为什么不跑也能知道?basedpyright 做的事情和解释器的第一阶段很像:它把整个文件从头读一遍,记下这个文件里定义了哪些名字,再加上 Python 自带的那些(`print`、`round` 这些叫**内置函数**,builtins)。读到 `console` 的时候,它在两张名单里都找不到,就画线。它不需要执行任何一行。

Day 8 练习 1 那个把 `print` 拼成 `prnt` 的 `guess2.py`,也是同样的待遇:

```text
basedpyright:
guess2.py:4:1 - error: "prnt" is not defined (reportUndefinedVariable)
Ruff:
guess2.py:4:1: F821 Undefined name `prnt`
```

<div class="line-notes">

- `"prnt" is not defined` Day 8 里要跑完 A、B 两行才看到的 `NameError`,现在敲完就看到了。

</div>

所以 Day 8 那张「两阶段」的图要补一笔:**有了编辑器,很多运行时错也能提前看到**。只要错误是「看代码就能看出来」的,类型检查器都能抓。哪些是「看代码看不出来」的,下一节就碰到。

剩下两个文件你自己点开看,我把原文放在这里对照:

```text
quote_err.py:2:6 - error: "(" was not closed
quote_err.py:2:7 - error: Expected expression
quote_err.py:3:1 - error: Statements must be separated by newlines or semicolons
py2_err.py:2:1 - warning: Expression value is unused (reportUnusedExpression)
py2_err.py:2:7 - error: Statements must be separated by newlines or semicolons
```

<div class="line-notes">

- `quote_err.py:2:7 - error: Expected expression` 中文引号 `“` 那里,basedpyright 说「这里应该是一个表达式」。它没有像 Python 自己那样直接说 `invalid character '“' (U+201C)`,反而不如运行时的报错好懂。所以看到红线看不懂,跑一下让 Python 自己说一遍,也是个办法。
- `py2_err.py:2:1 - warning: Expression value is unused (reportUnusedExpression)` `print "hello agent"` 被理解成了两句:`print` 是一句(光写一个名字,什么也没干,所以是黄色警告「这个值没被用上」),
- `py2_err.py:2:7 - error: Statements must be separated by newlines or semicolons` 后面的 `"hello agent"` 是另一句,两句挤在一行又没分隔,所以报错。这条说明也比 Python 运行时那句 `Did you mean print(...)?` 难懂。

</div>

这两个例子说明,红线的说明文字是给「已经大概知道哪里错了的人」看的,有时候绕。看不懂就盯住列号,去那个位置看代码,通常一眼就明白了。

### 类型错误:把字符串当数字算

再写一个今天的新文件。在 Zed 左边的文件列表里,先回到 `~/terminal-practice`,新建 `day09` 目录。更简单的是在终端里:

```text
$ mkdir -p ~/terminal-practice/day09
$ zed ~/terminal-practice/day09
```

<div class="line-notes">

- `$ mkdir -p ~/terminal-practice/day09` 今天的文件都放这里。
- `$ zed ~/terminal-practice/day09` 再打开一个 Zed 窗口,项目是 `day09`。

</div>

新建 `types_demo.py`。这里要用一个 Day 12 才正式讲的东西:**变量**。`amount = "299"` 的意思是把 `"299"` 这个值存起来,起名叫 `amount`,相当于 JS 的 `let amount = "299"`,Python 里不用写 `let`、`const`。

```python
# terminal-practice/day09/types_demo.py
amount = "299"
print("多扣了:", amount * 2 - 299, "元")
```

<div class="line-notes">

- `amount = "299"` 注意这里的 299 带引号,是**字符串**,不是数字。从网页表单、从文件里读到的金额,一开始几乎都是字符串,这是后面课里会反复遇到的情况。
- `print("多扣了:", amount * 2 - 299, "元")` 想算 299 × 2 − 299。可 `amount` 是字符串。

</div>

保存之后,`amount * 2 - 299` 下面出现红线:

```text
types_demo.py:3:15 - error: Operator "-" not supported for types "LiteralString" and "Literal[299]" (reportOperatorIssue)
```

<div class="line-notes">

- `types_demo.py:3:15` 第 3 行第 15 列,就是 `amount` 开始的位置,红线从这里画到 `299`。<br>`Operator "-" not supported` 是「减号不支持这两种类型」。`"LiteralString"` 是左边的类型:字符串。这里有个 JS 里没有的知识点:Python 里 `字符串 * 2` 是合法的,意思是把字符串重复两遍,`"299" * 2` 得到 `"299299"`。所以 `*` 那一步没报错,算出来还是一个字符串。`"Literal[299]"` 是右边的类型:数字 299,`Literal[...]` 的意思是「就是这个具体的值」。字符串减数字,Python 不允许。最后的 `reportOperatorIssue` 是规则名:运算符用错了类型。

</div>

跑一下,看它是不是真的会出事:

```text
$ cd ~/terminal-practice/day09
$ python3 types_demo.py
Traceback (most recent call last):
  File "/Users/你/terminal-practice/day09/types_demo.py", line 3, in <module>
    print("多扣了:", amount * 2 - 299, "元")
                     ~~~~~~~~~~~^~~~~
TypeError: unsupported operand type(s) for -: 'str' and 'int'
```

<div class="line-notes">

- `$ python3 types_demo.py` 编辑器里有红线,解释器照样跑,前面说过,红线只是提醒。
- `~~~~~~~~~~~^~~~~` 波浪线标出参与运算的两边,`^` 指着出事的那个减号。
- `TypeError: unsupported operand type(s) for -: 'str' and 'int'` 运行时的**类型错误**:减号不支持 `str`(字符串)和 `int`(整数)。这和 basedpyright 提前说的是同一件事。JS 里 `"299299" - 299` 不会报错,会悄悄算出 `299000`,那才可怕。Python 至少会停下来告诉你。

</div>

basedpyright 怎么知道 `amount` 是字符串?因为它在读代码的时候,会给每个名字、每个表达式推断一个类型,和 TS 的类型推断一样,你不写类型它也能猜出来。想看它猜的是什么,把鼠标放在 `amount` 上悬停就行。还有一个专门用来问它的写法,叫 `reveal_type`:

```python
# terminal-practice/day09/reveal.py
amount = "299"
reveal_type(amount)
reveal_type(299 * 2)
reveal_type(5 / 9 * 100)
reveal_type(print("hi"))
```

<div class="line-notes">

- `reveal_type(amount)` 「把 `amount` 的类型告诉我」。这是写给类型检查器看的,下面马上会看到,它不是给 Python 运行的。
- `reveal_type(299 * 2)` 整数乘整数。
- `reveal_type(5 / 9 * 100)` Day 8 算计费占比用过的式子。
- `reveal_type(print("hi"))` `print(...)` 这个调用本身的值是什么。

</div>

编辑器会在每一行下面显示一条蓝色或灰色的提示(级别是 information,不是错误):

```text
reveal.py:3:13 - information: Type of "amount" is "Literal['299']"
reveal.py:4:13 - information: Type of "299 * 2" is "Literal[598]"
reveal.py:5:13 - information: Type of "5 / 9 * 100" is "float"
reveal.py:6:13 - information: Type of "print("hi")" is "None"
```

<div class="line-notes">

- `Type of "amount" is "Literal['299']"` 一个具体的字符串 `'299'`。
- `Type of "299 * 2" is "Literal[598]"` 它连乘法都替你算好了:598。这种「编译期就算出具体值」的本事,TS 里也有(`const x = 1` 悬停显示 `1` 而不是 `number`)。
- `Type of "5 / 9 * 100" is "float"` 带小数的数叫 `float`(浮点数),Day 12 讲。`/` 除法的结果永远是 float。
- `Type of "print("hi")" is "None"` Day 8 说 `print(...)` 返回 `None`,所以交互模式里不显示 `undefined` 那样的东西。类型检查器也这么认为。

</div>

但是真拿 Python 去跑 `reveal.py`:

```text
$ python3 reveal.py
Traceback (most recent call last):
  File "/Users/你/terminal-practice/day09/reveal.py", line 3, in <module>
    reveal_type(amount)
    ^^^^^^^^^^^
NameError: name 'reveal_type' is not defined
```

<div class="line-notes">

- `NameError: name 'reveal_type' is not defined` 解释器不认识它。`reveal_type` 是类型检查器自己认的一个「暗号」,只在编辑器里起作用。看完类型就把这行删掉,别留在代码里。Ruff 也会提醒你:它对这四行各报一条 `F821 Undefined name `reveal_type``。

</div>

### 类型检查器看不出来的错

红线这么好用,是不是有了它就不用跑了?不是。新建 `guess_red.py`,先别看下面,猜猜哪几行会标红:

```python
# terminal-practice/day09/guess_red.py
print("A")
print(10 / 0)
pirnt("B")
print("299" + 1)
print(int("abc"))
```

<div class="line-notes">

- `print(10 / 0)` 除以零。
- `pirnt("B")` 又一个拼错的 `print`。
- `print("299" + 1)` 字符串加数字。在 JS 里这是 `"2991"`,Python 里呢?
- `print(int("abc"))` `int(...)` 把字符串转成整数,Day 14 讲。`"abc"` 显然转不了。

</div>

basedpyright 的结果:

```text
guess_red.py:4:1 - error: "pirnt" is not defined (reportUndefinedVariable)
guess_red.py:5:7 - error: Operator "+" not supported for types "Literal['299']" and "Literal[1]" (reportOperatorIssue)
```

<div class="line-notes">

- `guess_red.py:4:1` 拼错的名字,抓到了。
- `guess_red.py:5:7` 字符串加数字,也抓到了。Python 不像 JS 那样自动把 1 变成 `"1"` 再拼起来,它直接不允许。

</div>

第 3 行的 `10 / 0` 和第 6 行的 `int("abc")` 没有红线。实际跑:

```text
$ python3 guess_red.py
A
Traceback (most recent call last):
  File "/Users/你/terminal-practice/day09/guess_red.py", line 3, in <module>
    print(10 / 0)
          ~~~^~~
ZeroDivisionError: division by zero
```

<div class="line-notes">

- `A` 第 2 行正常打印。
- `ZeroDivisionError: division by zero` 第 3 行就停了,「除以零」。basedpyright 没管它,因为从类型上看,`int / int` 完全合法,结果是 float,它不去算「这个数会不会刚好是 0」。真实代码里除数通常是一个变量,值要等运行才知道。<br>第 3 行后面的 `pirnt`、`"299" + 1`、`int("abc")` 都没轮到执行。`int("abc")` 跑到的话会报 `ValueError`,这种「类型对但值不对」的错,类型检查器同样看不出来。

</div>

记一条分界线:**类型检查器管「这种东西能不能这么用」,不管「这个具体的值行不行」**。名字拼错、字符串当数字用,是前者;除以零、`"abc"` 转不成数字、文件不存在,是后者,只有跑了才知道,要靠后面学的异常处理(Day 35)和测试(Day 71)来兜。

## Ruff:一个工具顶 ESLint 加 Prettier

basedpyright 管的是「对不对」,Ruff 管的是「好不好」。新建 `messy.py`,故意写得乱一点:

```python
# terminal-practice/day09/messy.py
import sys
import os
print( "工单号:",'T001' )
print("多扣了:" , 299*2-299,'元');
print('有没有金额:',299==None)
```

<div class="line-notes">

- `import sys` `import` 把 Python 自带的一个模块拿进来用,相当于 JS 的 `import`。Day 8 练习 4 见过 `sys`。这里拿进来了,但下面一次都没用。
- `import os` `os` 是另一个自带模块,同样没用。两行顺序也没按字母排。
- `print( "工单号:",'T001' )` 括号里多了空格,逗号后面少了空格,单双引号混着用。
- `print("多扣了:" , 299*2-299,'元');` 逗号前多了空格,运算符两边没空格,行尾还多了个 JS 手感的分号。
- `print('有没有金额:',299==None)` `None` 相当于 JS 的 `null`(Day 14 讲)。拿一个固定的数和 `None` 比,结果永远是 `False`,这一句写了等于没写。

</div>

这个文件能跑,输出也对:

```text
$ python3 messy.py
工单号: T001
多扣了: 299 元
有没有金额: False
```

<div class="line-notes">

- `有没有金额: False` 299 当然不等于 None。Python 的布尔值首字母大写,`True`/`False`,JS 里是 `true`/`false`。

</div>

basedpyright 在 standard 档下对这个文件**一条错都不报**,因为没有用错任何东西。但 Ruff 有意见,编辑器里你会看到几条黄线和一处灰掉的文字(没用到的 import 会显示成淡灰色):

```text
messy.py:2:1: I001 [*] Import block is un-sorted or un-formatted
messy.py:2:8: F401 [*] `sys` imported but unused
messy.py:3:8: F401 [*] `os` imported but unused
messy.py:6:16: PLR0133 Two constants compared in a comparison, consider replacing `299 == None`
Found 4 errors.
[*] 3 fixable with `--fix`.
```

<div class="line-notes">

- `I001 [*] Import block is un-sorted or un-formatted` 「import 那一块没排好」:`os` 应该排在 `sys` 前面,import 块和下面的代码之间要空一行。规则编号 `I` 开头的管 import 排序。`[*]` 表示 Ruff 能自动修。
- `F401 [*] `sys` imported but unused` 「`sys` 导入了但没用」。等于 ESLint 的 `no-unused-vars`。也能自动修(直接删掉)。
- `F401 [*] `os` imported but unused` `os` 同样。
- `PLR0133 Two constants compared in a comparison` 「拿两个常量做比较」,结果在写代码时就确定了,多半是写错了。`PL` 开头的规则来自另一个老牌工具 Pylint。这条没有 `[*]`,得你自己决定怎么改。
- `[*] 3 fixable with `--fix`.` 四条里有三条能自动修。在编辑器里不用敲命令,下面讲。

</div>

Ruff 默认开着的规则,2026 年变化很大。Ruff 0.16(2026 年 7 月)把默认规则从 59 条一下子扩到了 400 多条,[Simon Willison 的博客](https://simonwillison.net/2026/Jul/25/ruff/)写过这件事(他写的是 413 条)。我用 Zed 下载的 0.17.1 数了一下,默认开着 407 条。所以如果你在网上看到一篇老文章说「Ruff 默认只检查很少的东西」,那是 2026 年以前的情况,上面那条 `PLR0133` 在老版本里默认是不报的。

### 格式化:保存时自动排整齐

格式化那一半,先看 Ruff 会把这个文件改成什么样:

```text
--- messy.py
+++ messy.py
@@ -1,6 +1,7 @@
 # terminal-practice/day09/messy.py
 import sys
 import os
-print( "工单号:",'T001' )
-print("多扣了:" , 299*2-299,'元');
-print('有没有金额:',299==None)
+
+print("工单号:", "T001")
+print("多扣了:", 299 * 2 - 299, "元")
+print("有没有金额:", 299 == None)
```

<div class="line-notes">

- `--- messy.py` 这种格式叫 diff,前端用 git 时天天见:`-` 开头是要删的行,`+` 开头是要加的行。
- `+` import 下面加了一个空行。
- `+print("工单号:", "T001")` 括号里的空格去掉,逗号后面统一一个空格,单引号统一换成双引号。和 Prettier 一样,Ruff 默认用双引号。
- `+print("多扣了:", 299 * 2 - 299, "元")` 运算符两边加空格,行尾的分号删掉。
- `+print("有没有金额:", 299 == None)` 格式化只管排版,不改意思,`299 == None` 这个逻辑问题它不碰,那是检查器的事。

</div>

这是我用 `ruff format --diff` 在命令行看的。你不用记这条命令,在编辑器里打开「保存时格式化」就行。**Zed 1.25.2 默认是不在保存时格式化 Python 的**,我查了它自带的默认设置文件,全局的 `format_on_save` 是 `"off"`,Python 这一项也没有单独打开。要自己开。

在 Zed 里按 `cmd-alt-,`(或者命令面板里输入 `zed: open settings file`),会打开你的个人设置文件 `~/.config/zed/settings.json`。在最外层的花括号里加上 `languages` 这一段:

```json
{
  "languages": {
    "Python": {
      "format_on_save": "on"
    }
  }
}
```

<div class="line-notes">

- `"languages": {` 按语言单独设置。这样只对 Python 生效,不会影响你前端项目原来的习惯。
- `"Python": {` 语言名,首字母大写。
- `"format_on_save": "on"` 保存时格式化。Zed 给 Python 默认的格式化工具已经是 Ruff 了,所以不用另外指定。如果你的文件里原来已经有别的设置,把 `"languages"` 这一段加进去,注意上一项末尾要有逗号。Zed 的设置文件允许写 `//` 注释,这点比普通 JSON 宽松。

</div>

存好设置,回到 `messy.py`,随便改一个字再按 `cmd-s` 保存。保存后文件变成这样(我用同一个版本的 Ruff 在命令行按 Zed 的默认步骤复现的):

```python
# terminal-practice/day09/messy.py
import os
import sys

print("工单号:", "T001")
print("多扣了:", 299 * 2 - 299, "元")
print("有没有金额:", 299 == None)
```

<div class="line-notes">

- `import os` 和 `ruff format --diff` 比,多了一步:import 也排好序了,`os` 到了 `sys` 前面。这是因为 Zed 对 Python 默认配置了一个「格式化之前先整理 import」的动作(`source.organizeImports.ruff`),格式化时会一起做。
- `import sys` 但没用到的 import 还在。整理 import 只排序,不删东西。
- `print("有没有金额:", 299 == None)` 逻辑问题还在,它不归格式化管。

</div>

没用的 import 怎么删?把光标放到灰掉的 `sys` 上,按 `cmd-.`,会弹出一个「快速修复」菜单,里面有 Ruff 提供的 `Remove unused import` 一类的选项,选它就删了;同一个菜单里通常还有一项「修复这个文件里所有能自动修的问题」。这个操作和 VS Code 里点小灯泡是一回事。两个都删掉以后,只剩 `PLR0133` 那一条,把最后一行改成你真正想表达的意思就行,比如直接删掉。

最后的样子:

```python
# terminal-practice/day09/messy.py

print("工单号:", "T001")
print("多扣了:", 299 * 2 - 299, "元")
```

<div class="line-notes">

- `# terminal-practice/day09/messy.py` 第一行的注释后面多出一个空行,是删掉两行 import 留下的。不影响什么,想删就删。

</div>

## 检查有多严:standard 和 recommended

`tsconfig.json` 里有个 `strict`,开了以后 TS 会多报一堆问题。basedpyright 也有类似的开关,叫 `typeCheckingMode`,从松到严有 `off`、`basic`、`standard`、`strict`、`recommended`、`all` 几档。

这里有个坑要先说清楚。basedpyright 自己的默认档是 `recommended`,很严;而 [Zed 的 Python 文档](https://zed.dev/docs/languages/python) 写明,Zed 在编辑器里默认用的是更松的 `standard`,和原版 pyright 的行为一致。同一个 `messy.py`,换成 `recommended` 档检查,结果是这样:

```text
messy.py:2:8 - warning: Import "sys" is not accessed (reportUnusedImport)
messy.py:3:8 - warning: Import "os" is not accessed (reportUnusedImport)
messy.py:6:16 - warning: Condition will always evaluate to False since the types "Literal[299]" and "None" have no overlap (reportUnnecessaryComparison)
```

<div class="line-notes">

- `Import "sys" is not accessed (reportUnusedImport)` 在 standard 档,没用的 import 只是灰掉,不算警告;recommended 档会变成黄线。和 Ruff 的 `F401` 是同一件事,两个工具都在说。
- `Condition will always evaluate to False` 「这个比较永远是 False,因为 299 和 None 两种类型根本没有交集」。和 Ruff 的 `PLR0133` 意思一样,说得更直白。

</div>

这门课统一用 **standard**:它管住真正会出事的错误(名字没定义、类型用错),又不会让刚学 Python 的你被几十条警告淹没。Day 45 正式学类型标注时,会把这个设置写进项目的配置文件,让命令行和编辑器说同一套话。今天你什么都不用改,Zed 默认就是 standard。

## 用 VS Code 的话

**这一节我没实跑**(这台机器没装 VS Code),按 [basedpyright 文档的编辑器安装页](https://docs.basedpyright.com/latest/installation/ides/)和 [Ruff 文档的编辑器设置页](https://docs.astral.sh/ruff/editors/setup/)写。

VS Code 不像 Zed 那样内置 Python 支持,要装三个扩展。在扩展面板(`cmd-shift-x`)里搜索:

1. **Python**(作者 Microsoft,ID `ms-python.python`):选 Python 解释器、运行和调试。它会顺带装上微软自己的 Pylance。
2. **basedpyright**(ID `detachhead.basedpyright`):类型检查和语言服务。文档写着它发现装了 Pylance 会自动把 Pylance 停掉,两个不会打架。
3. **Ruff**(作者 Astral,ID `charliermarsh.ruff`):检查和格式化。

然后打开用户设置的 JSON(命令面板里 `Preferences: Open User Settings (JSON)`),加上:

```json
{
  "basedpyright.analysis.typeCheckingMode": "standard",
  "[python]": {
    "editor.defaultFormatter": "charliermarsh.ruff",
    "editor.formatOnSave": true,
    "editor.codeActionsOnSave": {
      "source.organizeImports.ruff": "explicit"
    }
  }
}
```

<div class="line-notes">

- `"basedpyright.analysis.typeCheckingMode": "standard"` 这一行 VS Code 用户一定要加。前面说了,basedpyright 自己的默认是 recommended,不加的话你看到的红黄线会比文章里多得多,也和用 Zed 的同学对不上。
- `"[python]": {` 方括号包着语言名,意思是下面的设置只对 Python 文件生效,相当于 Zed 的 `"languages": { "Python": ... }`。
- `"editor.defaultFormatter": "charliermarsh.ruff"` 格式化交给 Ruff。你前端项目里大概写过 `"esbenp.prettier-vscode"`,是一样的写法。
- `"editor.formatOnSave": true` 保存时格式化。
- `"source.organizeImports.ruff": "explicit"` 保存时顺便整理 import,效果和 Zed 默认的那一步一样。`"explicit"` 表示只在你主动保存时做,自动保存时不做。

</div>

## 拼起来:把一个文件改到零红线

把今天的东西串一遍。新建 `check_me.py`,原样敲进去(四个毛病都是故意的):

```python
# terminal-practice/day09/check_me.py
import sys
print( "工单 T001" )
  print("类别:计费")
console.log("客户:C023")
print("多扣了:", "299" * 2 - 299, "元")
```

<div class="line-notes">

- `import sys` 毛病一:导入了没用。
- `print( "工单 T001" )` 毛病二:排版乱。
- `  print("类别:计费")` 毛病三:多了缩进。
- `console.log("客户:C023")` 毛病四:JS 手感。
- `print("多扣了:", "299" * 2 - 299, "元")` 毛病五:字符串当数字算。

</div>

刚敲完,编辑器里能看到的是这些:

```text
basedpyright:
check_me.py:4:1 - error: Unexpected indentation
check_me.py:5:1 - error: Unindent not expected
check_me.py:5:1 - error: "console" is not defined (reportUndefinedVariable)
check_me.py:6:15 - error: Operator "-" not supported for types "LiteralString" and "Literal[299]" (reportOperatorIssue)
Ruff:
check_me.py:4:1: invalid-syntax: Unexpected indentation
```

<div class="line-notes">

- `check_me.py:4:1 - error: Unexpected indentation` 先修最上面的语法错。
- `check_me.py:5:1 - error: Unindent not expected` 连锁出来的。
- `"console" is not defined` 语法错没修,basedpyright 也照样往下检查了名字和类型。
- `check_me.py:4:1: invalid-syntax: Unexpected indentation` Ruff 这时候**只报语法错**。文件连语法都不对,它就不做别的检查了,所以 `sys` 没用到这件事它暂时没说。这也是「先修语法错」的另一个理由:不修它,别的问题有一半看不见。

</div>

第一步,删掉第 4 行开头的两个空格,保存。红线变成:

```text
basedpyright:
check_me.py:5:1 - error: "console" is not defined (reportUndefinedVariable)
check_me.py:6:15 - error: Operator "-" not supported for types "LiteralString" and "Literal[299]" (reportOperatorIssue)
Ruff:
check_me.py:2:1: I001 [*] Import block is un-sorted or un-formatted
check_me.py:2:8: F401 [*] `sys` imported but unused
check_me.py:5:1: F821 Undefined name `console`
```

<div class="line-notes">

- `check_me.py:2:1: I001` import 后面没空行,格式化时会补上。
- `check_me.py:2:8: F401 [*] `sys` imported but unused` 语法对了,Ruff 的其他检查才出来。

</div>

第二步,`console.log` 改成 `print`,`"299"` 去掉引号,保存。basedpyright 那边清零(`0 errors, 0 warnings, 0 notes`),Ruff 还剩 `I001` 和 `F401`。第三步,在 `sys` 上 `cmd-.` 删掉这个 import,保存(保存时自动格式化)。最后:

```python
# terminal-practice/day09/check_me.py
print("工单 T001")
print("类别:计费")
print("客户:C023")
print("多扣了:", 299 * 2 - 299, "元")
```

<div class="line-notes">

- `print("工单 T001")` 括号里多余的空格被格式化去掉了。

</div>

```text
$ python3 check_me.py
工单 T001
类别:计费
客户:C023
多扣了: 299 元
```

<div class="line-notes">

- `多扣了: 299 元` 一条红线都没有了,跑出来也对。

</div>

| 今天的零件 | 在上面哪一步 |
| --- | --- |
| 红线是语言服务器画的 | `ls ~/Library/Application\ Support/Zed/languages/` |
| 一个语法错带出一串红线,先修第一条 | `syntax_err.py`、`check_me.py` 第一步 |
| 名字没定义,不跑也能看出来 | `runtime_err.py` 的 `console`、`guess2.py` 的 `prnt` |
| 类型检查器推断类型 | `types_demo.py`、`reveal_type` |
| 看不出来的:值不对 | `guess_red.py` 的 `10 / 0` |
| Ruff 检查:没用的 import、可疑写法 | `messy.py` 的 F401、PLR0133 |
| Ruff 格式化 + 保存时自动做 | Zed `settings.json` 的 `format_on_save` |
| 快速修复 | `cmd-.` 删掉 `sys` |

## 动手练习

### 练习 1:先猜红线,再看

在 `day09` 里新建 `guess3.py`,先在纸上写下哪几行会有红线(或黄线)、是哪个工具画的,再在 Zed 里打开看,最后 `python3` 跑一下:

```python
# terminal-practice/day09/guess3.py
print("开始")
print(round(299 * 0.13, 2))
print(len(299))
Print("结束")
```

`len(...)` 是求长度的内置函数,`len("工单")` 是 2,相当于 JS 的 `"工单".length`。

<details><summary>参考答案</summary>

```text
basedpyright:
guess3.py:4:11 - error: Argument of type "Literal[299]" cannot be assigned to parameter "obj" of type "Sized" in function "len"
    "Literal[299]" is incompatible with protocol "Sized"
      "__len__" is not present (reportArgumentType)
guess3.py:5:1 - error: "Print" is not defined (reportUndefinedVariable)
Ruff:
guess3.py:5:1: F821 Undefined name `Print`
$ python3 guess3.py
开始
38.87
Traceback (most recent call last):
  File "/Users/你/terminal-practice/day09/guess3.py", line 4, in <module>
    print(len(299))
          ^^^^^^^^
TypeError: object of type 'int' has no len()
```

<div class="line-notes">

- `guess3.py:4:11 - error: Argument of type "Literal[299]" cannot be assigned to parameter "obj" of type "Sized"` 「299 这个参数不能传给 `len` 的 `obj` 参数,那个参数要求是 `Sized`(有长度的东西)」。数字没有长度。
- `"__len__" is not present (reportArgumentType)` 下面两行是解释原因:数字身上没有「求长度」这个能力。这种多行的说明从上往下读,第一行是结论,后面是理由。
- `guess3.py:5:1 - error: "Print" is not defined` Python 区分大小写,`Print` 和 `print` 是两个名字。
- `38.87` 第 3 行没问题,Day 8 练习 3 算过。
- `TypeError: object of type 'int' has no len()` 第 4 行运行时报错,和 basedpyright 提前说的一致。第 5 行没轮到。

</div>

这一题有两个问题(`len(299)` 和 `Print`),都被红线提前抓到了;第 3 行本身没错。Ruff 只报了 `Print`,因为「数字没有长度」是类型问题,归 basedpyright 管。

</details>

### 练习 2:打开保存时格式化,排一个乱文件

确认 Zed 设置里已经有 `"format_on_save": "on"`,然后新建 `ugly.py`,**按下面的样子原样敲**(故意乱),保存,看它变成什么样,再跑一下。

```python
# terminal-practice/day09/ugly.py
print ('工单号:','T003')
print("客户:"   ,  "C015" ) ; print("问题:","想把月付改成年付")
print(  "差价:",(399-299) *  12 ,'元')
```

<details><summary>参考答案</summary>

保存后:

```python
# terminal-practice/day09/ugly.py
print("工单号:", "T003")
print("客户:", "C015")
print("问题:", "想把月付改成年付")
print("差价:", (399 - 299) * 12, "元")
```

<div class="line-notes">

- `print("工单号:", "T003")` `print` 和左括号之间的空格去掉了,单引号变双引号。
- `print("客户:", "C015")` 原来第 3 行用分号挤了两句,格式化把它拆成了两行。Python 允许用 `;` 在一行写两句,但几乎没人这么写。
- `print("差价:", (399 - 299) * 12, "元")` 括号保留(它改变了计算顺序,不能删),运算符两边各一个空格。

</div>

```text
$ python3 ugly.py
工单号: T003
客户: C015
问题: 想把月付改成年付
差价: 1200 元
```

<div class="line-notes">

- `差价: 1200 元` 格式化前后跑出来完全一样。格式化只改排版,不改意思,这是它敢在每次保存时自动做的前提。

</div>

如果保存后什么都没变:先看右下角有没有报错,再检查 `settings.json` 是不是存上了、`"languages"` 那一段的括号和逗号对不对(设置文件写错时 Zed 会提示)。

</details>

### 练习 3:问问类型检查器

新建 `types_guess.py`,先写下你猜的每个类型,再看编辑器的提示。看完删掉这个文件,`reveal_type` 不能留在要运行的代码里。

```python
# terminal-practice/day09/types_guess.py
reveal_type("T" + "001")
reveal_type(299 * 2 - 299)
reveal_type(299 / 1)
reveal_type(round(299 * 0.13, 2))
reveal_type(299 == None)
```

<details><summary>参考答案</summary>

```text
types_guess.py:2:13 - information: Type of ""T" + "001"" is "Literal['T001']"
types_guess.py:3:13 - information: Type of "299 * 2 - 299" is "Literal[299]"
types_guess.py:4:13 - information: Type of "299 / 1" is "float"
types_guess.py:5:13 - information: Type of "round(299 * 0.13, 2)" is "float"
types_guess.py:6:13 - information: Type of "299 == None" is "bool"
```

<div class="line-notes">

- `Type of ""T" + "001"" is "Literal['T001']"` 字符串加字符串是拼接,和 JS 一样。它直接算出了结果 `'T001'`。
- `Type of "299 * 2 - 299" is "Literal[299]"` 整数运算,也算出了具体值。
- `Type of "299 / 1" is "float"` 很多人猜 299。可 `/` 不管能不能除尽,结果都是 float,`299 / 1` 跑出来是 `299.0`。JS 里只有一种 number,没有这个区别。Day 12 细讲。
- `Type of "round(299 * 0.13, 2)" is "float"` 保留两位小数,还是 float。
- `Type of "299 == None" is "bool"` 比较的结果是布尔值。前面 Ruff 和 recommended 档都提醒过它永远是 False。

</div>

</details>

### 练习 4:把检查调严一档看看

在 `day09` 目录里新建一个文件 `pyrightconfig.json`,内容只有一行 `{"typeCheckingMode": "recommended"}`。basedpyright 会读项目根目录里的这个文件(Zed 文档里也写了)。存好后重新打开 `messy.py` 的**原始版本**(按本文前面那段乱写的样子重新敲一份,叫 `messy2.py`),看看多了哪些黄线。看完**删掉 `pyrightconfig.json`**,回到 standard。

<details><summary>参考答案</summary>

```text
messy2.py:2:8 - warning: Import "sys" is not accessed (reportUnusedImport)
messy2.py:3:8 - warning: Import "os" is not accessed (reportUnusedImport)
messy2.py:6:16 - warning: Condition will always evaluate to False since the types "Literal[299]" and "None" have no overlap (reportUnnecessaryComparison)
```

<div class="line-notes">

- `warning: Import "sys" is not accessed` standard 档下只是灰掉,recommended 下变成黄色警告。
- `Condition will always evaluate to False` 多了一条逻辑上的提醒。

</div>

这三条在 standard 档都不报,但 Ruff 在 standard 档下已经用 F401 和 PLR0133 说过了,所以我们不开 recommended 也没漏掉什么。这就是课里选 standard 的理由:basedpyright 管对错,Ruff 管规范,各管一摊,不重复唠叨。

`pyrightconfig.json` 还有一个用处你以后会碰到:别人的项目里如果有这个文件,编辑器的严格程度就由它说了算,你在自己设置里改什么都不管用。看到红黄线和自己预期不一样,先看看项目根目录有没有它,以及 `pyproject.toml` 里有没有 `[tool.basedpyright]`(Day 45 会加)。

</details>

验收标准:`zed --version` 能打印版本(或 `code --version`);在编辑器里打开 `runtime_err.py`,`console` 下面有红线,悬停能看到 `"console" is not defined`;能说出 `10 / 0` 为什么没有红线;`ugly.py` 保存后自动变整齐;`check_me.py` 改到 basedpyright 和 Ruff 都没有问题,运行输出四行。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 语言服务器(language server) | 编辑器在后台启动的、专门分析某种语言代码的程序。红线、悬停提示、跳转定义都是它算出来的,编辑器只负责显示 |
| LSP(Language Server Protocol) | 编辑器和语言服务器之间说话的约定。有了它,同一个语言服务器可以给 Zed、VS Code 等不同编辑器用 |
| 类型检查器(type checker) | 不运行代码,只读代码,检查名字有没有定义、类型用得对不对的程序。对应前端的 `tsc` |
| basedpyright | 这门课用的 Python 类型检查器和语言服务器,微软 pyright 的社区分支,Zed 默认用它 |
| Ruff | 用 Rust 写的 Python 代码检查器加格式化工具,一个顶 ESLint 加 Prettier |
| linter / 代码检查 | 找出「能跑但写得不好」的地方,比如 import 了没用、拿常量和常量比较 |
| formatter / 格式化 | 只改排版(空格、引号、换行),不改代码的意思 |
| 规则名 / 规则编号 | 每条检查的名字,如 basedpyright 的 `reportUndefinedVariable`、Ruff 的 `F821`、`F401`,用来查文档或关掉某条规则 |
| error / warning / information | 红线是错误,黄线是警告,蓝/灰色提示是信息。没用到的代码会显示成淡灰色 |
| 类型推断 | 你不写类型,检查器也根据值猜出类型,如 `"299"` 是字符串、`5 / 9` 是 float |
| `reveal_type` | 只给类型检查器看的写法,让它告诉你一个表达式的类型;Python 运行时不认识,会报 `NameError` |
| `TypeError` | 运行时的类型错误,如字符串减数字。类型检查器通常能提前标出来 |
| `ZeroDivisionError` | 除以零。属于「值不对」的错,类型检查器看不出来 |
| 内置函数(builtins) | Python 自带、不用 import 就能用的函数,如 `print`、`round`、`len` |
| `typeCheckingMode` | basedpyright 检查的严格程度。这门课统一用 `standard`,Zed 默认就是它 |
| `format_on_save` | Zed 的「保存时格式化」设置,1.25.2 对 Python 默认是关的 |
| 快速修复(code action) | 编辑器里 `cmd-.` 弹出的修复菜单,比如删掉没用的 import |

## 常见误区

**以为有红线程序就不会跑。** TS 的类型错误会让编译失败,Python 不会。basedpyright 标了红,`python3 xxx.py` 照样执行,直到出事那一行才停。红线是提醒你,不是拦住你。

**一个文件十几条红线,从中间开始修。** 一个语法错误(少个引号、多个缩进)会带出一串连锁红线,很多看起来莫名其妙。从最上面那条修起,修完保存,通常一大片同时消失。而且语法错不修,Ruff 连别的检查都不做。

**以为没有红线就没有 bug。** 类型检查器只管「这种东西能不能这么用」。`10 / 0`、`int("abc")`、要读的文件不存在,这些「值不对」的错,只有跑了才知道。

**用单文件方式打开代码。** 直接双击一个 `.py` 文件打开,有些功能(比如找到同一个项目里别的文件)会不灵。养成 `zed 目录` 打开整个文件夹的习惯,和前端 `code .` 一样。

**VS Code 装完 basedpyright 没改 typeCheckingMode。** 它自己的默认档是 recommended,会比课里多出一大堆黄线,你还以为是自己写错了。加上 `"basedpyright.analysis.typeCheckingMode": "standard"`。

**以为 Zed 默认保存就格式化。** 至少到 1.25.2,Zed 全局默认 `format_on_save` 是 `"off"`,Python 也没单独打开。保存后排版没变,先去设置里加 `"format_on_save": "on"`。

**把 `reveal_type` 留在代码里。** 它只对类型检查器有效,运行时会 `NameError: name 'reveal_type' is not defined`。看完类型就删。

**照着老文章配 Ruff。** Ruff 0.16(2026 年 7 月)把默认规则从 59 条扩到了 400 多条,老文章里「默认只开 E 和 F 两类规则」的说法已经过时。以你编辑器里实际看到的为准。

## 学习资料

### 文档与文章

- [Zed 文档 · Python](https://zed.dev/docs/languages/python):英文,Zed 对 Python 的支持全在这一页:默认用 basedpyright + Ruff、默认 standard 档、怎么换语言服务器、怎么选 Python 解释器。今天的 Zed 部分主要依据它。
- [Zed 文档 · Configuring Zed](https://zed.dev/docs/configuring-zed):英文,`settings.json` 在哪、怎么写、和项目级 `.zed/settings.json` 的关系。
- [basedpyright 文档 · 编辑器安装](https://docs.basedpyright.com/latest/installation/ides/):英文,VS Code、Zed、Neovim 等怎么接 basedpyright,和 Pylance 怎么共处。
- [Ruff 文档 · 编辑器设置](https://docs.astral.sh/ruff/editors/setup/):英文,各编辑器怎么接 Ruff、保存时格式化和整理 import 怎么配。
- [Ruff 文档 · The Ruff Formatter](https://docs.astral.sh/ruff/formatter/):英文,格式化的风格(和 Black 兼容、默认双引号、行宽 88)。看开头一节就够。
- [VS Code 文档 · Python in Visual Studio Code](https://code.visualstudio.com/docs/languages/python):英文,VS Code 写 Python 的总入口,选解释器、运行、调试都在这里。
- [LSP 官方介绍](https://microsoft.github.io/language-server-protocol/):英文,首页一张图讲清楚「编辑器 ↔ 语言服务器」,今天第一张图的原型。
- [Simon Willison · Ruff 默认规则扩充](https://simonwillison.net/2026/Jul/25/ruff/):英文,讲 Ruff 0.16 把默认规则从 59 条扩到 413 条。正文那个数字的出处(二手来源,官方说明在 Ruff 的更新日志里)。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1dXCBBkEPg&autoplay=0&high_quality=1" title="【中配】我在Zed中的Python设置超棒 - Indently" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>黑纹白斑马 · 【中配】我在Zed中的Python设置超棒 - Indently · 7 分钟,原视频 2025 年 11 月。英文 Python 博主 Indently 讲他的 Zed 设置,中文配音。重点看开头 00:21 起「设置文件配置」那一段,看真人怎么改 settings.json;里面 Rust 相关的设置跳过。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1XPj4zpE1a&autoplay=0&high_quality=1" title="Ruff使用指南：最新的超快速代码格式化工具（Python五分钟）" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>赛博红兔CyberHongTu · Ruff使用指南:最新的超快速代码格式化工具(Python五分钟) · 10 分钟,2025 年 5 月。讲 Ruff 检查和格式化两种用法,用的是 VS Code。视频里的 Ruff 是 2026 年默认规则扩充之前的版本,默认报出来的问题会比你现在看到的少。</figcaption>
</figure>

另外 [我是刘玉书 · 学python必备的VScode插件](https://www.bilibili.com/video/BV15p1dYvEhE)(10 分钟)适合用 VS Code 的同学,看看 Python 扩展装好之后长什么样。

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/rkmBSgZjfIE" title="I'm a huge Zed fan" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Indently · I'm a huge Zed fan · 英文,可开自动字幕。同一个作者讲他为什么从 PyCharm/VS Code 换到 Zed、写 Python 时哪些地方顺手。不用全看,看他演示红线和悬停提示的部分,和今天对照。</figcaption>
</figure>

### 书籍

- Patrick Viafore《Robust Python》,O'Reilly,2021。整本讲怎么用类型标注和类型检查器写出不容易出错的 Python。今天还用不上,先知道有这本书,Day 45 学类型标注时再读第 1 部分。
- Eric Matthes《Python Crash Course》第 3 版,No Starch Press,2023;中文版《Python 编程:从入门到实践(第 3 版)》,人民邮电出版社。第 1 章里有在 VS Code 里装 Python 扩展、运行第一个程序的步骤,用 VS Code 的同学可以对照。

### 开源项目与代码

- [DetachHead/basedpyright](https://github.com/DetachHead/basedpyright):basedpyright 的源代码和问题跟踪。哪天你觉得某条红线不对,先来这里的 issues 搜一下报错原文。
- [astral-sh/ruff](https://github.com/astral-sh/ruff):Ruff 的源代码。仓库首页的 README 有一张「Ruff 和其他工具速度对比」的图,能直观感受为什么大家都换成了它。
- [zed-industries/zed](https://github.com/zed-industries/zed):Zed 编辑器本身。`assets/settings/default.json` 是全部默认设置,今天「Python 默认不保存格式化」就是在这个文件里查到的,搜 `"Python": {` 能看到 Python 的默认配置。

## 自测

1. 同事说「Zed 的 Python 检查不准,我在 Zed 里标红了,同一个文件在 VS Code 里没红」。最可能是什么原因?

<details><summary>答案</summary>

两边的检查严格程度或者用的语言服务器不一样。最常见的是:VS Code 用的是 Pylance 或者 basedpyright 默认的 recommended 档,Zed 默认 standard;或者项目里有 `pyrightconfig.json` / `pyproject.toml` 的 `[tool.basedpyright]`,两边读到的配置不同。红线是语言服务器画的,同一个服务器、同一份配置,两个编辑器说的话应该一样。先对齐「用哪个语言服务器、哪一档」,再讨论准不准。

</details>

2. 一个文件第 3 行少了一个右括号,编辑器里第 3、4、5、9 行都有红线。你从哪里改起?为什么?

<details><summary>答案</summary>

从第 3 行(最上面那条)改起。一个语法错误会让解释器(和检查器)对后面的代码全都理解错,连带出一串红线。补上第 3 行的括号,保存,后面那些多半同时消失;还剩下的再一条条看。另外语法错不修,Ruff 只报语法错,别的检查都不做。

</details>

3. 下面三行,哪几行 basedpyright 会提前标红?

```python
print(299 - "1")
print(100 / 0)
prinf("hi")
```

<details><summary>答案</summary>

第 1 行和第 3 行。第 1 行是数字减字符串,类型用错了(`reportOperatorIssue`);第 3 行 `prinf` 没有定义(`reportUndefinedVariable`)。第 2 行除以零,类型上是 `int / int`,合法,值不对要跑了才知道,运行时报 `ZeroDivisionError`。

</details>

4. Ruff 的「检查」和「格式化」有什么区别?为什么格式化可以放心地在每次保存时自动做,而 `F401`(没用的 import)不建议每次保存都自动删?

<details><summary>答案</summary>

检查是找「能跑但写得不好、可能有问题」的地方,修复可能改变代码的意思;格式化只动空格、引号、换行这些排版,保证改完运行结果一模一样。所以格式化自动做没有风险。没用的 import 删掉通常没事,但有时候你刚写了 import、下一行代码还没敲,保存时就被删掉了,很烦;所以 Zed 默认保存时只「整理 import 顺序」,不删,删交给你用 `cmd-.` 主动做。

</details>

5. 面试题:你接手一个 Python 项目,同事说「我们有 basedpyright,所以不用写测试」。你怎么回应?

<details><summary>答案</summary>

类型检查和测试管的是两类问题。类型检查器在不运行代码的前提下,保证「东西用对了」:名字存在、参数类型对得上、不会把字符串当数字算,这类错能在写代码时就挡掉一大批。但它不知道具体的值,除以零、解析不了的输入、业务算错了(比如退款金额多算了一倍,类型完全正确),都只能靠运行代码来发现,也就是测试。实际做法是两者都要:类型检查放在编辑器和 CI 里拦低级错误,测试覆盖业务逻辑和边界值。

</details>

## 明天预告

Day 10 · uv(一):init、add、run,对照 npm。今天写的都是一个个孤零零的 `.py` 文件,用的也全是 Python 自带的东西。真正写项目要装别人写的库,就像前端离不开 `npm install`。明天装 uv,用 `uv init` 建这门课的练习仓库 `agent-zero-lab`,用 `uv add` 装第一个第三方库、`uv run` 跑起来,每条命令都和 npm 对照着讲。今天在 Zed 里看到的「解释器选哪个」,明天也会碰到:库装进了项目自己的环境,编辑器要选对环境,import 才不会标红。
