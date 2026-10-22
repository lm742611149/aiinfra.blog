---
title: 'Day 3 · 终端(一):打开终端,pwd、ls、cd 和路径'
description: '从打开 macOS 的「终端」开始,弄懂提示符、命令的三段结构,用 pwd、ls、cd 在目录之间走一圈,分清绝对路径和相对路径,最后用 Node 亲眼看到「相对路径是相对当前目录」这件事。'
pubDate: 2026-10-22
regime: none
tags: ['terminal', 'agent-zero']
series: 'agent-zero'
day: 3
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 2](/blog/agent-zero/day-002-setup-budget/) 列了整门课要装的软件和要注册的账号,定了「用到哪天装哪天」的原则,又学了 token 和「元 / 百万 token」的单价,用 JS 算出整门课的模型 API 大概三百到六百元。那张软件表的第一行就是终端,而且它不用装,macOS 自带。后面装 uv、跑 Python、用 git、起数据库,全都要在终端里敲命令,所以从今天开始,连着几天把终端的基本功练扎实。

## 今天要解决的问题

1. 能打开终端,看懂提示符 `minliu@MinLius-MacBook-Pro ~ %` 每一段是什么意思,知道一条命令由「命令名、选项、参数」三段组成。
2. 会用 `pwd` 看自己在哪,用 `ls`(以及 `-a`、`-l`)看目录里有什么,用 `cd` 换目录,包括 `cd ..`、`cd ~`、`cd` 和 `cd -`。
3. 分清**绝对路径**和**相对路径**,能把同一个位置用两种写法各写一遍;知道 `.`、`..`、`~` 分别是什么。
4. 能解释 Day 2 那个 `'part01/ticket.txt'` 为什么在有的目录下读得到、有的目录下报 `ENOENT`。

预计用时:1.5 到 2 小时。前面 40 分钟一条条敲 `pwd`、`ls`、`cd`,中间半小时讲路径和画目录树,最后半小时做练习。

前置:[Day 2](/blog/agent-zero/day-002-setup-budget/)(知道终端是第一个要用的工具,见过 `count_tokens.mjs` 里的 `'part01/ticket.txt'`)。电脑上装过 Node(你是前端,肯定有),今天有一步会用 `node -e` 跑一行 JS。

学法提示:先对照文章逐条敲一遍命令(不复制粘贴)并对照输出;第二天合上文章,把「从家目录走到 `my-app/src`、再用相对路径和绝对路径各回一次」默写成命令敲出来;然后做动手练习,做不出再展开参考答案,看完关掉自己重写一遍。

## 先说清楚我是在哪跑的

今天所有输出都是我在 2026-10-22 用自己那台 2019 款 Intel MacBook Pro(macOS 14、zsh)真跑出来的。但我的家目录里东西太多,有些还是私人文件,贴出来既乱又不合适,所以我建了一个干净的演示用的家目录:只有 macOS 默认的那几个文件夹,加上 `Documents/my-app`,它是我用 `npm create vite@latest my-app -- --template react` 新建、再 `npm install` 过的一个 Vite + React 项目,和你平时建的前端项目一模一样。输出里的家目录路径统一显示成 `/Users/你`。

你跟着敲的时候,用户名和文件夹会和我不一样,这很正常。你自己电脑上要是还没有一个前端项目,可以找一个你平时在写的项目代替 `my-app`,或者跟着上面那条命令建一个(建完会提示你 `npm install`,装不装都不影响今天)。

## 打开终端,看懂提示符

macOS 打开终端有两种常用办法:按 `Cmd + 空格` 打开聚焦搜索,输入「终端」或者 `Terminal` 回车;或者在访达里进「应用程序 → 实用工具 → 终端」。你在 VS Code 或 Zed 里按 `` Ctrl + ` `` 打开的那个内嵌终端也是同一个东西,今天的命令在哪个窗口敲都一样。

打开以后,窗口里通常只有一行,长这样:

```text
minliu@MinLius-MacBook-Pro ~ %
```

<div class="line-notes">

- `minliu@MinLius-MacBook-Pro ~ %` 这一行叫**提示符**(prompt),意思是「我准备好了,你可以输入命令了」。它是 macOS 在 `/etc/zshrc` 里预设的格式 `%n@%m %1~ %#`,我在自己机器上看过这个文件。拆开读:`minliu` 是当前登录的用户名;`@` 后面的 `MinLius-MacBook-Pro` 是这台电脑的名字;空格后面的 `~` 是**你现在所在的目录**,`~` 代表你的家目录;最后的 `%` 是提示符的结尾,你敲的命令从它后面开始。

</div>

这个窗口背后有一个程序在等你输入,叫 **shell**(壳)。macOS 从 2019 年的 Catalina 开始默认用的 shell 叫 **zsh**,你在网上还会经常看到 **bash**,它是另一个 shell,Linux 服务器上很常见。今天学的命令在两者里写法完全一样,差别等 Day 7 讲配置文件时再说。

终端和 shell 的关系,用前端的话说:终端是那个窗口,像浏览器;shell 是窗口里真正干活的程序,像浏览器里的 JS 引擎。你在窗口里敲一行字按回车,终端把这行字交给 shell,shell 理解它、执行它,把结果打印回窗口。

<figure>
<svg viewBox="0 0 640 230" role="img" aria-label="一条命令的结构:提示符之后是命令名、选项、参数,用空格分开">
<rect x="0" y="0" width="640" height="230" fill="var(--paper-raised)" rx="6"/>
<g font-family="var(--font-mono)">
<text x="30" y="70" font-size="13" fill="var(--ink-faint)">minliu@MinLius-MacBook-Pro ~ %</text>
<rect x="280" y="48" width="44" height="32" rx="5" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="302" y="70" text-anchor="middle" font-size="13" fill="var(--ink)">ls</text>
<rect x="340" y="48" width="44" height="32" rx="5" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="362" y="70" text-anchor="middle" font-size="13" fill="var(--ink)">-la</text>
<rect x="400" y="48" width="200" height="32" rx="5" fill="var(--paper)" stroke="var(--rule)"/>
<text x="500" y="70" text-anchor="middle" font-size="13" fill="var(--ink)">Documents/my-app</text>
<line x1="302" y1="80" x2="302" y2="120" stroke="var(--mem)"/>
<line x1="362" y1="80" x2="362" y2="150" stroke="var(--compute)"/>
<line x1="500" y1="80" x2="500" y2="180" stroke="var(--rule)"/>
<text x="130" y="124" font-size="12" fill="var(--mem)">命令名:要运行哪个程序</text>
<text x="160" y="154" font-size="12" fill="var(--compute)">选项:以 - 开头,改变它的做法</text>
<text x="330" y="196" font-size="12" fill="var(--ink-soft)">参数:让它对谁做(这里是一个目录)</text>
<text x="30" y="222" font-size="11" fill="var(--ink-faint)">三段之间用空格隔开。提示符不用敲,它是终端自己打印的</text>
</g>
</svg>
<figcaption>一条命令的三段结构。和 JS 对照:<code>ls -la Documents/my-app</code> 大致相当于调用 <code>ls({ l: true, a: true }, 'Documents/my-app')</code>。</figcaption>
</figure>

这张图就是今天第一个新概念:**命令的结构**。最前面是**命令名**,决定运行哪个程序;后面以 `-` 开头的是**选项**(option,也叫 flag),改变它的做法;再后面是**参数**(argument),告诉它对谁做。三段之间用空格隔开,所以**空格在命令里是有意义的**,后面你会看到文件夹名字里有空格时会出什么事。你其实天天在用这个结构:`npm install -D vite` 里,`npm` 是命令名,`install` 和 `vite` 是参数,`-D` 是选项。

下面所有代码块里,以 `$ ` 开头的行是我敲的命令(`$` 是文章里代替那一长串提示符的写法,你不用敲 `$`),没有 `$` 的行是终端打印出来的结果。

## pwd:我现在在哪

打开终端第一件事,先问一句「我在哪」。

```text
$ pwd
/Users/你
```

<div class="line-notes">

- `$ pwd` 敲 `pwd` 三个字母,回车。名字来自 print working directory,「打印当前工作目录」。它没有选项也没有参数,是最短的一种命令。
- `/Users/你` 输出:我现在在 `/Users/你` 这个目录。终端刚打开时总是在你的家目录,所以提示符里显示的是 `~`,`pwd` 给出的是它的完整写法。你的输出会是 `/Users/你的用户名`。

</div>

**工作目录**(working directory,也叫当前目录)是终端「站」的位置。你在访达里打开一个文件夹,窗口里显示的就是那个文件夹的内容;终端也一样,任何时候它都「站」在某一个目录里,你敲的命令默认都在这个目录里做事。

前端里你见过它:Node 里 `process.cwd()` 返回的就是这个值,cwd 是 current working directory 的缩写。你在项目根目录跑 `npm run dev` 能成功,在别的目录跑就报找不到 `package.json`,原因就是工作目录不同。今天最后一节会亲手验证。

## ls:这里有什么

知道了在哪,第二个问题是「这里有什么」。`ls` 是 list 的缩写,列出目录里的东西。

```text
$ ls
Desktop         Downloads       Movies          Pictures
Documents       Library         Music           Public
```

<div class="line-notes">

- `$ ls` 不带参数,列的就是当前工作目录,也就是 `/Users/你` 里的东西。
- `Desktop         Downloads       Movies          Pictures` 八个文件夹,分两行排开。它们就是你在访达侧边栏里看到的「桌面」「下载」「影片」「图片」,访达给它们显示了中文名,磁盘上真正的名字是英文。`ls` 默认按字母顺序竖着排,先排满第一列再排第二列,所以要竖着读:`Desktop`、`Documents`、`Downloads`、`Library`……

</div>

光看名字分不出哪个是文件、哪个是文件夹。加上 `-l` 选项(long,长格式),每个东西占一行,带上详细信息:

```text
$ ls -l
total 0
drwxr-xr-x  2 minliu  staff  64 10 22 12:46 Desktop
drwxr-xr-x  3 minliu  staff  96 10 22 12:46 Documents
drwxr-xr-x  2 minliu  staff  64 10 22 12:46 Downloads
drwxr-xr-x  3 minliu  staff  96 10 22 12:46 Library
drwxr-xr-x  2 minliu  staff  64 10 22 12:46 Movies
drwxr-xr-x  2 minliu  staff  64 10 22 12:46 Music
drwxr-xr-x  2 minliu  staff  64 10 22 12:46 Pictures
drwxr-xr-x  2 minliu  staff  64 10 22 12:46 Public
```

<div class="line-notes">

- `$ ls -l` 命令名 `ls`,选项 `-l`,没有参数。
- `total 0` 这些条目一共占了多少磁盘块。今天用不上,可以无视。
- `drwxr-xr-x  2 minliu  staff  64 10 22 12:46 Desktop` 一行七列,从左往右:第一个字母 `d` 表示这是一个目录(directory),如果是普通文件这里是 `-`;后面九个字符 `rwxr-xr-x` 是权限,Day 7 前后再讲;`2` 是链接数,不用管;`minliu` 是这个东西属于哪个用户;`staff` 是属于哪个用户组;`64` 是大小,单位字节,目录的大小只是它自己的记录,不是里面所有文件加起来;`10 22 12:46` 是最后修改时间,10 月 22 日 12:46,系统语言是中文时月份就显示成数字;最后是名字。
- `drwxr-xr-x  3 minliu  staff  96 10 22 12:46 Documents` `Documents` 的大小是 96,比别的大一点,因为它里面放了一个 `my-app`。

</div>

还有一个常用选项 `-a`(all,全部)。在 macOS 和 Linux 里,**名字以 `.` 开头的文件和文件夹默认是隐藏的**,`ls` 不显示,访达也不显示。你一定见过它们:`.gitignore`、`.env`、`.vscode`、`.git`。加 `-a` 才能看到:

```text
$ ls -a
.               Desktop         Library         Pictures
..              Documents       Movies          Public
.zshrc          Downloads       Music
$ ls -la
total 8
drwxr-xr-x  11 minliu  staff  352 10 22 12:46 .
drwxr-xr-x   3 minliu  staff   96 10 22 12:46 ..
-rw-r--r--   1 minliu  staff   42 10 22 12:46 .zshrc
drwxr-xr-x   2 minliu  staff   64 10 22 12:46 Desktop
drwxr-xr-x   3 minliu  staff   96 10 22 12:46 Documents
```

<div class="line-notes">

- `$ ls -a` 多出来三项:`.`、`..` 和 `.zshrc`。
- `.               Desktop` 第一个 `.` 代表**当前目录自己**,第二个 `..` 代表**上一级目录**。每个目录里都有这两项,它们不是真的文件,是系统给每个目录配的两个「指路牌」,下面讲路径时会天天用。
- `.zshrc          Downloads` `.zshrc` 是 zsh 的配置文件,以点开头所以平时看不见。Day 7 会打开它。
- `$ ls -la` 两个选项可以合起来写,`-la` 等于 `-l -a`,我试过 `ls -l -a`,输出一模一样。顺序也无所谓,`-al` 也行。
- `-rw-r--r--   1 minliu  staff   42 10 22 12:46 .zshrc` 第一个字符是 `-`,说明它是普通文件不是目录;大小 42 字节,里面就一行注释。后面我把剩下几行目录截掉了,和上面 `ls -l` 一样。

</div>

`ls` 也可以带参数,告诉它「别列当前目录,列我指定的那个」:

```text
$ ls Documents
my-app
$ ls Documents/my-app
README.md               package-lock.json       src
index.html              package.json            vite.config.js
node_modules            public
```

<div class="line-notes">

- `$ ls Documents` 参数是 `Documents`,列出 `Documents` 里面的东西,只有一个 `my-app`。注意我没有「走进」`Documents`,工作目录还是家目录,只是让 `ls` 去看了一眼别处。
- `$ ls Documents/my-app` 参数可以有好几层,用 `/` 隔开:`Documents` 里面的 `my-app`。
- `README.md               package-lock.json       src` 这就是一个刚 `npm install` 完的 Vite 项目根目录,你应该很眼熟。`.gitignore` 和 `.oxlintrc.json` 这两个隐藏文件没有显示,练习 3 会把它们找出来。

</div>

### 故意敲错两次

命令敲错时,终端会打印一行错误信息。第一次看到英文报错很多人会慌,其实它们写得很直白,读懂了马上就知道哪里错。

```text
$ ls nothere
ls: nothere: No such file or directory
$ ls -z
ls: invalid option -- z
usage: ls [-@ABCFGHILOPRSTUWabcdefghiklmnopqrstuvwxy1%,] [--color=when] [-D format] [file ...]
```

<div class="line-notes">

- `$ ls nothere` 让 `ls` 列一个不存在的东西。
- `ls: nothere: No such file or directory` 报错的格式是「谁报的错:对什么:什么错」。`ls` 说 `nothere` 这个文件或目录不存在。这句 `No such file or directory` 你以后会见几百次,Node 里的 `ENOENT` 是同一个意思(Error NO ENTry,没有这一项)。
- `$ ls -z` 给了一个 `ls` 不认识的选项。
- `ls: invalid option -- z` 无效的选项 `z`。
- `usage: ls [-@ABCFGHILOPRSTUWabcdefghiklmnopqrstuvwxy1%,]` 顺便打印了用法:方括号里是它认识的所有单字母选项,最后的 `[file ...]` 表示可以跟零个或多个文件参数。方括号表示「可写可不写」,这是命令行文档的通用写法。

</div>

## 路径:绝对路径和相对路径

刚才的 `Documents/my-app` 就是一个**路径**(path):从某个起点出发,一层层往下走,经过哪些目录,最后到哪。今天第二个新概念,也是最重要的一个,就是路径的两种写法。

macOS 的所有文件组织成一棵倒着长的树。树根叫**根目录**,写作一个斜杠 `/`。看看根目录里有什么:

```text
$ ls /
Applications    Volumes         etc             sbin
Library         bin             home            tmp
System          cores           opt             usr
Users           dev             private         var
$ ls /Users
Shared  minliu
```

<div class="line-notes">

- `$ ls /` 参数是 `/`,也就是根目录。这一条是在我真实的系统上列的,不是演示目录。
- `Applications    Volumes         etc             sbin` 首字母大写的几个是 macOS 自己的:`Applications` 是「应用程序」,`Users` 放所有用户的家目录,`System` 和 `Library` 是系统文件。小写的 `bin`、`etc`、`usr`、`var`、`tmp` 是从 Unix 继承来的传统目录,Linux 服务器上也有,后面部署那几部分会再碰到。
- `$ ls /Users` 根目录下的 `Users`。
- `Shared  minliu` 一个共享目录,一个是我的家目录。你的电脑上这里是你的用户名。

</div>

**绝对路径**是从根目录 `/` 出发写的路径,所以它一定以 `/` 开头,比如 `/Users/你/Documents/my-app`。不管你现在站在哪里,它指的都是同一个地方,就像一个完整的网址 `https://example.com/assets/logo.svg`,在哪个页面打开都一样。

**相对路径**是从**当前工作目录**出发写的路径,不以 `/` 开头,比如刚才的 `Documents/my-app`。它的意思是「从我现在站的地方往下走」,所以同一个相对路径,站的地方不同,指的就不同。你在 React 里写 `import App from './App.jsx'`,`./` 就是「和当前这个文件同一个目录」,把这个 import 语句挪到另一个目录的文件里,就找不到了,道理一模一样。

相对路径里有两个特殊的名字,就是刚才 `ls -a` 看到的 `.` 和 `..`:

- `.` 是当前目录。`./assets` 和 `assets` 是同一个意思,前面加 `./` 只是写得更明确。
- `..` 是上一级目录。`../public` 是「先退回上一级,再进 `public`」。`../..` 是退两级。

还有一个 `~`,它代表你的家目录,`~/Documents` 等于 `/Users/你/Documents`。严格说 `~` 不是相对路径,它是 shell 帮你做的缩写:你敲 `~`,shell 在执行之前先把它换成 `/Users/你`,所以 `~/Documents` 其实是一个绝对路径。这个「是 shell 替你换的」很重要,后面会看到 Node 就不认识 `~`。

<figure>
<svg viewBox="0 0 640 330" role="img" aria-label="目录树:根目录下 Users、minliu、Documents、my-app、src 和 public,标出从 src 到 public 的相对路径和从根出发的绝对路径">
<rect x="0" y="0" width="640" height="330" fill="var(--paper-raised)" rx="6"/>
<g font-family="var(--font-mono)" font-size="12">
<rect x="40" y="20" width="40" height="26" rx="4" fill="var(--paper)" stroke="var(--rule)"/><text x="60" y="38" text-anchor="middle" fill="var(--ink)">/</text>
<line x1="60" y1="46" x2="60" y2="70" stroke="var(--rule)"/>
<line x1="60" y1="58" x2="180" y2="58" stroke="var(--rule)"/><line x1="180" y1="58" x2="180" y2="70" stroke="var(--rule)"/>
<rect x="20" y="70" width="80" height="26" rx="4" fill="var(--paper)" stroke="var(--rule)"/><text x="60" y="88" text-anchor="middle" fill="var(--ink)">Users</text>
<rect x="130" y="70" width="110" height="26" rx="4" fill="var(--paper)" stroke="var(--rule)"/><text x="185" y="88" text-anchor="middle" fill="var(--ink-soft)">Applications</text>
<line x1="60" y1="96" x2="60" y2="120" stroke="var(--rule)"/>
<rect x="20" y="120" width="80" height="26" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/><text x="60" y="138" text-anchor="middle" fill="var(--ink)">minliu</text>
<text x="110" y="138" fill="var(--mem)">← ~ 家目录</text>
<line x1="60" y1="146" x2="60" y2="170" stroke="var(--rule)"/>
<rect x="15" y="170" width="90" height="26" rx="4" fill="var(--paper)" stroke="var(--rule)"/><text x="60" y="188" text-anchor="middle" fill="var(--ink)">Documents</text>
<line x1="60" y1="196" x2="60" y2="220" stroke="var(--rule)"/>
<rect x="20" y="220" width="80" height="26" rx="4" fill="var(--paper)" stroke="var(--rule)"/><text x="60" y="238" text-anchor="middle" fill="var(--ink)">my-app</text>
<line x1="60" y1="246" x2="60" y2="262" stroke="var(--rule)"/>
<line x1="60" y1="262" x2="230" y2="262" stroke="var(--rule)"/>
<line x1="60" y1="262" x2="60" y2="274" stroke="var(--rule)"/><line x1="230" y1="262" x2="230" y2="274" stroke="var(--rule)"/>
<rect x="20" y="274" width="80" height="26" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/><text x="60" y="292" text-anchor="middle" fill="var(--ink)">src</text>
<rect x="190" y="274" width="80" height="26" rx="4" fill="var(--paper)" stroke="var(--rule)"/><text x="230" y="292" text-anchor="middle" fill="var(--ink)">public</text>
<path d="M100 287 Q145 250 190 287" fill="none" stroke="var(--compute)" stroke-dasharray="4 3"/>
<text x="110" y="320" fill="var(--compute)">站在 src:../public</text>
<text x="330" y="150" fill="var(--ink)">绝对路径(从 / 出发,在哪都一样):</text>
<text x="330" y="172" fill="var(--ink-soft)">/Users/你/Documents/my-app/public</text>
<text x="330" y="210" fill="var(--ink)">用 ~ 缩写(shell 会换成上一行):</text>
<text x="330" y="232" fill="var(--ink-soft)">~/Documents/my-app/public</text>
<text x="330" y="270" fill="var(--ink)">相对路径(要看你站在哪):</text>
<text x="330" y="292" fill="var(--compute)">在 src 里:../public</text>
<text x="330" y="312" fill="var(--ink-soft)">在 my-app 里:public 或 ./public</text>
</g>
</svg>
<figcaption>同一个 <code>public</code> 目录的四种写法。绝对路径和 <code>~</code> 写法在哪都能用;相对路径换个地方站就变了。</figcaption>
</figure>

用 `ls` 把这几种写法都试一遍,先用 `~` 写法:

```text
$ ls ~
Desktop         Downloads       Movies          Pictures
Documents       Library         Music           Public
$ ls ~/Documents/my-app/src
App.css         App.jsx         assets          index.css       main.jsx
```

<div class="line-notes">

- `$ ls ~` 列家目录。因为我本来就在家目录,结果和不带参数的 `ls` 一样。
- `$ ls ~/Documents/my-app/src` shell 先把 `~` 换成 `/Users/你`,实际执行的是 `ls /Users/你/Documents/my-app/src`。
- `App.css         App.jsx         assets          index.css       main.jsx` Vite 模板生成的 `src`:四个文件和一个 `assets` 目录。这一行五个都放得下,所以只有一行。

</div>

## cd:换个地方站

`ls` 只是「看一眼」,`cd` 才是真的「走过去」,改变工作目录。名字来自 change directory。

```text
$ cd Documents
$ pwd
/Users/你/Documents
$ cd my-app
$ pwd
/Users/你/Documents/my-app
$ cd src
$ pwd
/Users/你/Documents/my-app/src
$ cd ..
$ pwd
/Users/你/Documents/my-app
$ cd ../..
$ pwd
/Users/你
```

<div class="line-notes">

- `$ cd Documents` 用相对路径进 `Documents`。**成功的时候 `cd` 什么都不打印**,这是命令行的老规矩:没消息就是好消息。这时提示符会变成 `minliu@MinLius-MacBook-Pro Documents %`,中间那段跟着变了。
- `/Users/你/Documents` `pwd` 确认:工作目录变了。
- `$ cd my-app` 现在站在 `Documents` 里,`my-app` 这个相对路径就是 `Documents/my-app`。
- `$ cd src` 再往下一层。
- `/Users/你/Documents/my-app/src` 走了三步,到了最深处。
- `$ cd ..` 退回上一级。
- `/Users/你/Documents/my-app` 回到 `my-app`。
- `$ cd ../..` 退两级:`my-app` 的上一级是 `Documents`,再上一级是 `minliu`。
- `/Users/你` 回到家目录。

</div>

再试绝对路径和几个快捷写法:

```text
$ cd /Applications
$ pwd
/Applications
$ cd
$ pwd
/Users/你
$ cd /Users/你/Documents/my-app/src
$ pwd
/Users/你/Documents/my-app/src
$ cd ~
$ pwd
/Users/你
```

<div class="line-notes">

- `$ cd /Applications` 绝对路径,直接跳到「应用程序」目录,不管刚才站在哪。
- `$ cd` 只敲 `cd` 不带参数,直接回家目录。这是最快的「回家」。
- `$ cd /Users/你/Documents/my-app/src` 一条绝对路径,从家目录直接跳到最深那层。你自己敲时把 `minliu` 换成你的用户名。
- `$ cd ~` 和只敲 `cd` 效果一样,也是回家。

</div>

还有一个 `cd -`,意思是「回到上一次待的目录」,像浏览器的后退按钮,在两个目录之间来回切特别好用。在交互终端里它会先打印出回到的那个目录,我在自己机器上试过 `cd /tmp` 再 `cd /` 再 `cd -`,它打印了 `/tmp` 并回到了那里。

### 两个省力的键:Tab 和上箭头

路径一长,一个字母一个字母敲又慢又容易错。终端里有两个键一定要养成习惯。

**Tab 补全**:敲出名字的开头,按 `Tab`,shell 会帮你补完。比如在家目录敲 `cd Doc` 再按 `Tab`,会补成 `cd Documents/`。如果开头有好几个候选(比如 `cd D` 同时匹配 `Desktop`、`Documents`、`Downloads`),按一次没反应或者列出候选,你多敲一两个字母再按。Tab 补全不只是省事,**补得出来就说明这个路径真的存在**,补不出来多半是你敲错了或者站错了地方。

**上箭头**:按 `↑` 会把上一条命令翻出来,再按继续往前翻,改一改回车就能再跑一次。

这两个都是键盘交互,没法贴输出,你自己试几次就有感觉了。

### 再故意敲错三次

```text
$ cd Documnets
cd: no such file or directory: Documnets
$ cd Documents/my-app/package.json
cd: not a directory: Documents/my-app/package.json
$ cd ~/Library/Application Support
cd: string not in pwd: /Users/你/Library/Application
$ cd ~/Library/"Application Support"
$ pwd
/Users/你/Library/Application Support
$ cd ~/Library/Application\ Support
$ pwd
/Users/你/Library/Application Support
```

<div class="line-notes">

- `$ cd Documnets` 拼错了,`n` 和 `e` 换了位置。我第一次学的时候这类错误能犯一下午,所以才要用 Tab 补全。
- `cd: no such file or directory: Documnets` 没有这个目录。
- `$ cd Documents/my-app/package.json` 想 `cd` 进一个文件。
- `cd: not a directory: Documents/my-app/package.json` 不是目录。`cd` 只能进目录,文件要用别的命令打开,Day 5 会学怎么看文件内容。
- `$ cd ~/Library/Application Support` macOS 有不少文件夹名里带空格,`Application Support` 就是一个。
- `cd: string not in pwd: /Users/你/Library/Application` 这句报错看着莫名其妙,原因是**空格把命令切成了两段参数**:`~/Library/Application` 和 `Support`。zsh 的 `cd` 碰到两个参数时会做一件很少用的事(在当前路径里把第一个字符串替换成第二个),替换不了就报这个错。读不懂没关系,记住看到它就检查路径里有没有空格。
- `$ cd ~/Library/"Application Support"` 第一种修法:用引号把带空格的那段包起来,引号里的空格不切分。注意 `~` 要放在引号外面,引号里的 `~` 不会被换成家目录。
- `$ cd ~/Library/Application\ Support` 第二种修法:在空格前加一个反斜杠 `\`,意思是「这个空格是名字的一部分」。Tab 补全遇到空格时补出来的就是这种写法。

</div>

这也是为什么**给自己的文件夹起名别用空格和中文**,用 `my-app`、`agent-zero-lab` 这种小写加短横线的名字,终端里省很多麻烦。

## 相对路径到底相对谁:用 Node 看一眼

Day 2 的 `count_tokens.mjs` 里有一行 `fs.readFileSync('part01/ticket.txt', 'utf8')`,我在那里说了「明天你会知道它是相对于哪里」。答案是:**相对于运行程序时的工作目录**,不是相对于 `.mjs` 文件所在的目录。下面用 Node 亲眼看一下。`node -e "..."` 的意思是「直接执行引号里的这行 JS」,不用建文件,`-e` 是 eval。

```text
$ cd ~/Documents/my-app
$ node -e "console.log(process.cwd())"
/Users/你/Documents/my-app
$ node -e "console.log(require('fs').readFileSync('package.json', 'utf8').length)"
456
$ cd src
$ node -e "console.log(process.cwd())"
/Users/你/Documents/my-app/src
$ node -e "console.log(require('fs').readFileSync('package.json', 'utf8').length)"
node:fs:483
    return binding.readFileUtf8(path, stringToFlags(options.flag));
                   ^

Error: ENOENT: no such file or directory, open 'package.json'
    at Object.readFileSync (node:fs:483:20)
$ node -e "console.log(require('fs').readFileSync('../package.json', 'utf8').length)"
456
$ node -e "console.log(require('fs').readFileSync('/Users/你/Documents/my-app/package.json', 'utf8').length)"
456
```

<div class="line-notes">

- `$ cd ~/Documents/my-app` 先站到项目根目录。
- `$ node -e "console.log(process.cwd())"` 让 Node 打印它眼里的工作目录。
- `/Users/你/Documents/my-app` 和 `pwd` 一样。Node 是从这个终端启动的,就继承了终端当时站的位置。
- `$ node -e "console.log(require('fs').readFileSync('package.json', 'utf8').length)"` 用相对路径 `'package.json'` 读文件,打印它有多少个字符。`require('fs')` 是 CommonJS 写法,`-e` 默认按 CommonJS 跑,所以这里不用 `import`。
- `456` 读到了,456 个字符。和 `ls -l` 里看到的 `package.json` 大小一致(全是英文字符,一个字符一个字节)。
- `$ cd src` 往下走一层,文件本身一个字没动。
- `/Users/你/Documents/my-app/src` Node 的工作目录也跟着变了。
- `Error: ENOENT: no such file or directory, open 'package.json'` 同一行代码,换个地方跑就报错了。Node 去找的是 `/Users/你/Documents/my-app/src/package.json`,那里没有这个文件。完整报错还有十来行 `at ...` 调用栈,我截掉了,有用的就是这一行。
- `$ node -e "console.log(require('fs').readFileSync('../package.json', 'utf8').length)"` 第一种修法:相对路径改成 `../package.json`,从 `src` 退一级再找。
- `$ node -e "console.log(require('fs').readFileSync('/Users/你/Documents/my-app/package.json'` 第二种修法:绝对路径,站在哪都能读到。两种都打印 `456`。

</div>

所以 Day 2 那个脚本要在 `agent-zero-lab` 目录里用 `node part01/count_tokens.mjs` 跑,才能读到 `part01/ticket.txt`;你要是先 `cd part01` 再跑 `node count_tokens.mjs`,就会得到一模一样的 `ENOENT`。后面写 Python 时也一样,「在哪个目录跑」会是你最常见的报错来源之一,所以这门课每条命令都会写清楚在哪个目录跑。

再补一个小实验,证明 `~` 是 shell 替你换的,不是所有程序都认识:

```text
$ cd ~/Documents/my-app/src
$ node -e "console.log(require('fs').readFileSync('~/Documents/my-app/package.json', 'utf8').length)"
Error: ENOENT: no such file or directory, open '~/Documents/my-app/package.json'
```

<div class="line-notes">

- `$ cd ~/Documents/my-app/src` 这里的 `~` 在命令行里,shell 会替换,所以 `cd` 成功。
- `$ node -e "console.log(require('fs').readFileSync('~/Documents/my-app/package.json'` 这里的 `~` 在 JS 字符串里,shell 不会去动引号里面 JS 代码的内容,Node 拿到的就是字面上的 `~`。
- `Error: ENOENT: no such file or directory, open '~/Documents/my-app/package.json'` Node 把 `~` 当成一个名叫 `~` 的普通目录去找,当然找不到。前面几行 `node:fs:483` 和后面的调用栈和上一次一样,我只留了这一行。

</div>

结论:在终端命令里随便用 `~`;写进代码里的路径不要用 `~`,要么用相对路径并且搞清楚工作目录,要么用绝对路径。

## 拼起来:一次完整的走动

把今天的零件串起来,从家目录出发,在 `my-app` 里转一圈再回来。这是今天要默写的那一段。

```text
$ pwd
/Users/你
$ ls Documents/my-app
README.md               package-lock.json       src
index.html              package.json            vite.config.js
node_modules            public
$ cd Documents/my-app/src
$ ls ./assets
hero.png        react.svg       vite.svg
$ ls ../public
favicon.svg     icons.svg
$ cd ../../..
$ pwd
/Users/你
$ cd /Users/你/Documents/my-app/src/../../..
$ pwd
/Users/你
```

<div class="line-notes">

- `$ pwd` 起点:家目录。
- `$ ls Documents/my-app` 不走过去,先用相对路径看一眼项目里有什么。
- `$ cd Documents/my-app/src` 一步走到 `src`。
- `$ ls ./assets` `./` 是当前目录,`./assets` 就是 `src` 里的 `assets`。
- `hero.png        react.svg       vite.svg` Vite 模板放的三张图。
- `$ ls ../public` 从 `src` 退一级到 `my-app`,再看 `public`,对应上面目录树那条虚线。
- `favicon.svg     icons.svg` 网站图标放在这里,和你 `index.html` 里 `<link rel="icon" href="/favicon.svg">` 引用的是同一个文件。
- `$ cd ../../..` 从 `src` 退三级:`my-app`、`Documents`、`minliu`。
- `$ cd /Users/你/Documents/my-app/src/../../..` 绝对路径里也能用 `..`,系统从左往右走:先走到 `src`,再退三级,回到家目录。实际没人这么写,这里只是证明 `..` 在哪都是「上一级」。

</div>

| 今天的零件 | 在上面这段里是哪一行 |
| --- | --- |
| `pwd` 看工作目录 | 第一条和 `cd ../../..` 后面那条 |
| `ls` 带参数看别处 | `ls Documents/my-app` |
| `cd` 相对路径往下走 | `cd Documents/my-app/src` |
| `.` 当前目录 | `ls ./assets` |
| `..` 上一级 | `ls ../public`、`cd ../../..` |
| 绝对路径 | 最后那条 `cd /Users/...` |

## 动手练习

### 练习 1:同一个地方,两种走法

从家目录出发,分别用一条相对路径和一条绝对路径的 `cd`,走到 `my-app/src/assets`,每次都用 `pwd` 确认。最后用一条 `cd`(只能用 `..`)退到 `Documents`。

<details><summary>参考答案</summary>

```text
$ cd Documents/my-app/src/assets
$ pwd
/Users/你/Documents/my-app/src/assets
$ cd ~
$ cd /Users/你/Documents/my-app/src/assets
$ pwd
/Users/你/Documents/my-app/src/assets
$ cd ../../..
$ pwd
/Users/你/Documents
```

<div class="line-notes">

- `$ cd Documents/my-app/src/assets` 相对路径:因为终端刚打开在家目录,从家目录往下四层。
- `$ cd ~` 回家,让第二种走法和第一种起点一样。
- `$ cd /Users/你/Documents/my-app/src/assets` 绝对路径,以 `/` 开头。其实这一条在哪站着敲都行,刚才那句 `cd ~` 对它来说是多余的。
- `$ cd ../../..` 从 `assets` 退三级:`src`、`my-app`、`Documents`。
- `/Users/你/Documents` 到了。数 `..` 的个数最容易数错,可以一级一级退、每次 `pwd`,熟了再合并。

</div>

</details>

### 练习 2:站着不动,看三个地方

先 `cd` 到 `~/Documents/my-app/src`。然后**不再 `cd`**,用三条 `ls` 分别列出 `my-app/public`、家目录、`Documents`。最后用 `pwd` 证明你一步没动。

<details><summary>参考答案</summary>

```text
$ cd ~/Documents/my-app/src
$ ls ../public
favicon.svg     icons.svg
$ ls ~
Desktop         Downloads       Movies          Pictures
Documents       Library         Music           Public
$ ls ../..
my-app
$ pwd
/Users/你/Documents/my-app/src
```

<div class="line-notes">

- `$ ls ../public` 退一级进 `public`。
- `$ ls ~` 家目录用 `~` 最省事。用相对路径的话是 `../../..`,也对,但难读。
- `$ ls ../..` 从 `src` 退两级就是 `Documents`,里面只有 `my-app`。
- `/Users/你/Documents/my-app/src` 工作目录还在 `src`。`ls` 只看不走,`cd` 才走。

</div>

</details>

### 练习 3:找出项目里的隐藏文件

进到 `my-app` 根目录,找出所有隐藏文件,再用长格式看它们是文件还是目录、多大。和你自己的前端项目比一比,你的项目里有哪些隐藏文件?

<details><summary>参考答案</summary>

```text
$ cd ~/Documents/my-app
$ ls -a
.                       README.md               package.json
..                      index.html              public
.gitignore              node_modules            src
.oxlintrc.json          package-lock.json       vite.config.js
$ ls -la
total 136
drwxr-xr-x  12 minliu  staff    384 10 22 12:46 .
drwxr-xr-x   3 minliu  staff     96 10 22 12:46 ..
-rw-r--r--   1 minliu  staff    253 10 22 12:46 .gitignore
-rw-r--r--   1 minliu  staff    231 10 22 12:46 .oxlintrc.json
-rw-r--r--   1 minliu  staff   1009 10 22 12:46 README.md
-rw-r--r--   1 minliu  staff    358 10 22 12:46 index.html
drwxr-xr-x  26 minliu  staff    832 10 22 12:46 node_modules
-rw-r--r--   1 minliu  staff  40990 10 22 12:46 package-lock.json
-rw-r--r--   1 minliu  staff    456 10 22 12:46 package.json
drwxr-xr-x   4 minliu  staff    128 10 22 12:46 public
drwxr-xr-x   7 minliu  staff    224 10 22 12:46 src
-rw-r--r--   1 minliu  staff    161 10 22 12:46 vite.config.js
```

<div class="line-notes">

- `$ ls -a` 除了 `.` 和 `..`,隐藏的是 `.gitignore` 和 `.oxlintrc.json` 两个。`.oxlintrc.json` 是这一版 Vite 模板自带的 oxlint 代码检查配置。
- `-rw-r--r--   1 minliu  staff    253 10 22 12:46 .gitignore` 开头是 `-`,普通文件,253 字节。
- `drwxr-xr-x  26 minliu  staff    832 10 22 12:46 node_modules` 开头是 `d`,目录。显示的 832 只是目录本身的记录大小,不是里面 58MB 的依赖加起来,`ls -l` 不会帮你算目录里所有东西的总大小。
- `-rw-r--r--   1 minliu  staff  40990 10 22 12:46 package-lock.json` 锁文件 40990 字节,是这里最大的文件。
- `-rw-r--r--   1 minliu  staff    456 10 22 12:46 package.json` 456 字节,和正文里 Node 读出来的长度一致。

</div>

一个用了几年的前端项目里,常见的隐藏文件还有 `.git`(目录,git 的全部历史都在里面)、`.env`/`.env.local`(环境变量,常放密钥)、`.vscode`、`.prettierrc`、`.eslintrc`、`.nvmrc`。你在访达里看不到它们,在访达里按 `Cmd + Shift + .` 可以切换显示隐藏文件。

</details>

### 练习 4:观察 npm 和 Node 的不同

在 `my-app/src` 里跑 `npm pkg get name`(打印 `package.json` 里的 `name` 字段),再回家目录跑一次。和正文里 Node 读 `package.json` 的结果比:为什么 Node 在 `src` 里读不到,npm 却能?

<details><summary>参考答案</summary>

```text
$ cd ~/Documents/my-app/src
$ npm pkg get name
"my-app"
$ cd ~
$ npm pkg get name
npm error code ENOENT
npm error syscall open
npm error path /Users/你/package.json
npm error errno -2
npm error enoent Could not read package.json: Error: ENOENT: no such file or directory, open '/Users/你/package.json'
```

<div class="line-notes">

- `$ npm pkg get name` 在 `src` 里跑,`src` 里没有 `package.json`。
- `"my-app"` 但 npm 读到了。因为 npm 会**从工作目录开始一级一级往上找** `package.json`,在 `src` 没找到,就去上一级 `my-app` 找,找到了。
- `$ cd ~` 回到家目录,往上一路(`/Users/你`、`/Users`、`/`)都没有 `package.json`。
- `npm error path /Users/你/package.json` 找不到时它报告的是工作目录里的那个路径。后面还有几行 JSON 格式的错误和日志位置,我截掉了。
- `npm error enoent Could not read package.json` 又是 `ENOENT`。

</div>

区别在于:`fs.readFileSync('package.json')` 只认工作目录这一个地方,是最朴素的相对路径;npm 自己额外写了「往上找」的逻辑。所以 `npm run dev` 在项目的任何子目录里都能跑,你以前可能从没注意过。别指望每个工具都这么贴心,Python 里读文件就和 Node 的 `fs` 一样只认工作目录。

</details>

验收标准:不看文章能说出提示符四段的含义和命令的三段结构;能把 `~/Documents/my-app/public` 改写成绝对路径,以及站在 `src` 里时的相对路径;能解释正文里 `node -e` 那一步为什么在 `src` 里报 `ENOENT`、有哪两种修法;四道练习的命令自己敲出来,输出和文中的结构一致(用户名和文件不同没关系)。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 终端(Terminal) | 敲命令的窗口程序。macOS 自带「终端」App,编辑器里的内嵌终端是同一种东西 |
| shell | 终端窗口背后真正理解和执行命令的程序。macOS 默认是 zsh,Linux 服务器上常见 bash |
| zsh / bash | 两种 shell。今天学的命令在两者里写法一样 |
| 提示符(prompt) | 终端等你输入时打印的那一行,如 `minliu@MinLius-MacBook-Pro ~ %`,中间那段是当前目录 |
| 命令名 / 选项 / 参数 | 一条命令的三段:运行哪个程序、以 `-` 开头改变做法、对谁做。用空格分开 |
| 工作目录(当前目录) | 终端此刻「站」的目录,命令默认在这里做事。Node 里是 `process.cwd()` |
| 家目录 | 每个用户自己的目录,macOS 上是 `/Users/用户名`,写作 `~` |
| 根目录 | 整棵目录树的起点,写作 `/` |
| 路径 | 从某个起点出发、一层层用 `/` 隔开的位置写法 |
| 绝对路径 | 以 `/` 开头、从根目录出发的路径,在哪用都指同一个地方 |
| 相对路径 | 不以 `/` 开头、从当前工作目录出发的路径,换个地方站意思就变了 |
| `.` 和 `..` | 当前目录和上一级目录,每个目录里都有这两项 |
| 隐藏文件 | 名字以 `.` 开头的文件或目录,`ls` 和访达默认不显示,`ls -a` 能看到 |
| `ENOENT` | Node 里「没有这个文件或目录」的错误码,对应终端里的 `No such file or directory` |
| Tab 补全 | 敲出名字开头按 Tab,shell 帮你补全路径;补不出来多半是路径错了 |

## 常见误区

**以为 `cd` 成功了会提示点什么。** `cd` 成功时一个字都不打印,失败才说话。不确定的时候看提示符中间那段,或者敲一下 `pwd`。

**相对路径以为是相对「文件所在的目录」。** 正文演示过,`readFileSync('package.json')` 相对的是**运行时的工作目录**。同一个脚本,在项目根目录跑没事,`cd src` 再跑就 `ENOENT`。遇到 `ENOENT` 第一件事是 `pwd`,看看自己站在哪。

**路径里有空格不加引号。** `cd ~/Library/Application Support` 会被切成两个参数,报一句很难懂的 `string not in pwd`。加引号或者在空格前加 `\`,更好的办法是让 Tab 补全帮你写。自己的文件夹别用空格和中文命名。

**把 `~` 写进代码里。** `~` 是 shell 在执行命令之前替你换成家目录的,Node、Python 读文件时不认识它,会报 `ENOENT: ... open '~/Documents/...'`。

**数错 `..` 的个数。** `../../..` 到底退到了哪,心算很容易错一层。不确定就一级一级退,每次 `pwd`,或者干脆用绝对路径。

**把选项和参数的空格省了或者多了。** `ls-l` 会被当成一个叫 `ls-l` 的命令(报 `command not found`),`ls - l` 会把 `-` 和 `l` 当成两个参数。三段之间正好一个空格,选项字母紧跟在 `-` 后面。

## 学习资料

### 文档与文章

- [MDN 命令行速成课](https://developer.mozilla.org/zh-CN/docs/Learn_web_development/Getting_started/Environment_setup/Command_line):中文,MDN 专门写给前端开发者的终端入门,从「为什么前端要学命令行」讲起,今天读前半部分(导航和路径),20 分钟。
- [计算机教育中缺失的一课 · 课程概览与 shell](https://missing-semester-cn.github.io/2020/course-shell/):MIT 那门有名的课的社区中文翻译(2020 版),「在 shell 中导航」一节正好对应今天,10 分钟。
- [The Missing Semester 2026 · Course Overview + Introduction to the Shell](https://missing.csail.mit.edu/2026/course-shell/):英文原版的 2026 新版讲义,「Navigating in the shell」一节讲了 `pwd`、`ls`、`cd`、绝对和相对路径。中文版目前翻译的是 2020 版,内容大同小异。
- [网道 · Bash 简介](https://wangdoc.com/bash/intro):阮一峰维护的中文 Bash 教程第一章,讲 shell 是什么、有哪几种。今天只读这一章,后面几天会用到它别的章节。
- [ss64 · macOS 命令速查](https://ss64.com/mac/):英文,macOS 自带的每个命令一页,例如 [ls](https://ss64.com/mac/ls.html)。想知道某个选项是干嘛的就来这里查。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1Vv4y1T7gQ&autoplay=0&high_quality=1" title="MAC新手适用 | MACOS terminal(终端)开启,配置和常用命令" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>DayDayUp每天向上 · MAC新手适用 | MACOS terminal(终端)开启,配置和常用命令 · 5 分钟。看怎么打开终端、窗口长什么样,今天先看到 cd、ls 这几条为止,讲配置美化的部分可以跳过。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1ca411x7rZ&autoplay=0&high_quality=1" title="绝对路径和相对路径" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>快乐的代码蛋 · 绝对路径和相对路径 · 5 分钟。换一个人的讲法再听一遍两种路径的区别,看完对照正文的目录树图自己讲一遍。</figcaption>
</figure>

另外推荐 B 站的 [麻省理工学院【中英⚡计算机教育中缺失的一课|IAP 2026, Missing Semester】](https://www.bilibili.com/video/BV1CkArz1E4o)(常青藤中英字幕课程搬运,共 9P),今天只看 P1「课程概览与 Shell 入门」的前半段。

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/MSgoeuMqUmU" title="Lecture 1: Course Overview + Introduction to the Shell" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Missing Semester · Lecture 1: Course Overview + Introduction to the Shell · MIT 2026 年 1 月录的新版第一讲,英文,可开自动字幕。和上面 B 站那个是同一讲,能看 YouTube 的二选一。前面是课程介绍,讲到导航的部分对照今天的内容看。</figcaption>
</figure>

### 书籍

- William Shotts《The Linux Command Line》第 2 版,No Starch Press,2019。终端入门最常被推荐的一本书,作者在 [linuxcommand.org](https://linuxcommand.org/) 免费提供英文版 PDF。中文版书名《Linux 命令行大全》,人民邮电出版社出过第 1 版译本(2013);第 2 版中译本我没查到可靠信息,买之前按书名核对版次。网上还有第 1 版的[社区中文翻译](https://billie66.github.io/TLCL/)可以免费读。今天对应第 2 章「导航」和第 3 章「探索系统」,讲得比这篇细,适合想多看几个例子时翻。书里写的是 Linux 和 bash,今天这几条命令在 macOS 的 zsh 里用法相同。

### 开源项目与代码

- [tldr-pages/tldr](https://github.com/tldr-pages/tldr):每个命令一页「最常用的几种写法」,比官方手册短得多,有中文翻译。在仓库的 `pages.zh` 目录里能找到 `ls`、`cd` 的中文页。
- [idank/explainshell](https://github.com/idank/explainshell):把一整条命令贴进去,它会把每一段(命令名、每个选项、每个参数)对应的手册说明标出来,正好用来练今天的「命令三段结构」。在线版是 [explainshell.com](https://explainshell.com/)。

## 自测

1. 提示符 `minliu@MinLius-MacBook-Pro my-app %` 里,你现在在哪个目录?怎么确认它的完整路径?

<details><summary>答案</summary>

在一个叫 `my-app` 的目录里(提示符只显示最后一级)。敲 `pwd` 看完整路径,比如 `/Users/你/Documents/my-app`。

</details>

2. `ls -la src` 这条命令里,哪个是命令名、哪个是选项、哪个是参数?`-la` 等于什么?

<details><summary>答案</summary>

`ls` 是命令名,`-la` 是选项,`src` 是参数。`-la` 等于 `-l -a`:长格式、显示隐藏文件。

</details>

3. 你站在 `/Users/你/Documents/my-app/src`,下面三个路径分别指哪里:`./assets`、`../public`、`~/Documents`?

<details><summary>答案</summary>

`./assets` 是 `/Users/你/Documents/my-app/src/assets`;`../public` 是 `/Users/你/Documents/my-app/public`;`~/Documents` 是 `/Users/你/Documents`,和站在哪无关。

</details>

4. 一个 Node 脚本里写了 `fs.readFileSync('data/a.txt')`,在项目根目录跑没问题,同事在 `scripts` 子目录里跑报 `ENOENT`。为什么?给两种改法。

<details><summary>答案</summary>

相对路径相对的是运行时的工作目录,同事的工作目录是 `scripts`,Node 去找的是 `scripts/data/a.txt`。改法一:回项目根目录再跑;改法二:代码里换成绝对路径(后面学 Python 时还会学「以脚本文件所在目录为基准拼路径」的写法)。只改成 `../data/a.txt` 也能让同事跑通,但在根目录跑又会坏,不推荐。

</details>

5. `cd ~/Library/Application Support` 为什么报错?写出两种正确写法。

<details><summary>答案</summary>

空格把路径切成了两个参数。正确写法:`cd ~/Library/"Application Support"` 或 `cd ~/Library/Application\ Support`。

</details>

## 明天预告

Day 4 · 终端(二):建目录、复制、移动、删除。今天只会「看」和「走」,`ls` 和 `cd` 都不改动任何东西。明天开始动手改:用 `mkdir` 建一个练习目录,用 `cp`、`mv`、`rm` 复制、移动、改名、删除文件,再学通配符 `*`,一次处理一批文件。这些命令都要写路径,今天的绝对路径、相对路径、`..` 明天每条命令都会用上。另外 `rm` 删的东西不进废纸篓,明天会专门讲怎么别删错。
