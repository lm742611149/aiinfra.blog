---
title: 'Day 5 · 终端(三):管道、重定向和 grep'
description: '命令的输出不一定要打印在屏幕上:用 > 和 >> 写进文件,用 | 直接交给下一条命令。再学 grep,从一份工单清单里把「计费」类挑出来、数清楚有几张,在一个 React 项目里找出所有用到 useState 的地方。'
pubDate: 2026-10-22
regime: none
tags: ['terminal', 'agent-zero']
series: 'agent-zero'
day: 5
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 4](/blog/agent-zero/day-004-terminal-2/) 在家目录里建了一个练习目录 `terminal-practice`,学了 `mkdir -p`、`touch`、`cp -r`、`mv`、`rm -r` 和 `rmdir`,知道了 `cp`/`mv` 会一声不响地覆盖同名文件、`rm` 删的东西不进废纸篓,还学了通配符 `*` 和 `?`,以及「先 `echo` 预览再动手」。但那天建的文件全是空的,因为还不会往文件里写内容。今天就从这里接着学:命令的输出怎么写进文件,怎么交给下一条命令,怎么在一堆文字里找东西。

## 今天要解决的问题

1. 知道每条命令都有「标准输出」和「标准错误」两个出口,会用 `>` 把输出写进文件(覆盖)、用 `>>` 追加,知道报错为什么不会跟着进文件。
2. 会用管道 `|` 把一条命令的输出交给下一条命令,能用 `ls | wc -l` 数出一个目录里有几个东西。
3. 会用 `grep` 在文件里找包含某个词的行,用上 `-n`、`-c`、`-v`、`-i`、`-r` 这几个选项,能在一个前端项目里搜代码。
4. 能把 `grep`、`|`、`>` 组合起来,从工单清单里挑出一类工单并写成一份小报告。

预计用时:2 小时。重定向 40 分钟,管道 30 分钟,`grep` 30 分钟,练习 20 分钟。

前置:[Day 3](/blog/agent-zero/day-003-terminal-1/)(路径、`ls`、`cd`)、[Day 4](/blog/agent-zero/day-004-terminal-2/)(练习目录 `~/terminal-practice`、`echo`、`cp`、`rm`、通配符)。

学法提示:先对照文章逐条敲一遍命令(不复制粘贴)并对照输出;第二天合上文章,把「写出工单清单 → 用 grep 挑出计费类 → 数个数 → 写进 report.txt」默写成命令敲出来;然后做动手练习,做不出再展开参考答案,看完关掉自己重写一遍。

## 命令的输出去了哪

和前两天一样,下面的输出都是我 2026-10-22 在 2019 款 Intel MacBook Pro(macOS 14、zsh)上用同一个演示家目录真跑的,路径显示成 `/Users/minliu`。以 `$ ` 开头的是我敲的命令。

先想一个问题:`ls` 打印出来的那几行字,是怎么出现在屏幕上的?

每个程序启动时,系统都给它接好了三根「管子」:

- **标准输入**(stdin):程序从这里读数据,默认接的是你的键盘。
- **标准输出**(stdout):程序正常的结果从这里出去,默认接的是终端屏幕。
- **标准错误**(stderr):程序的报错从这里出去,默认也接屏幕。

前端对照:标准输出就是 `console.log`,标准错误就是 `console.error`。在浏览器里两者都显示在 Console 面板,看起来一样,但你可以在 Console 的筛选里只看 Errors,说明它们其实是两条路。终端里也一样,平时两条路都通到屏幕,所以你分不出来;一旦你把其中一条改道,区别就出来了。

**重定向**(redirection)就是给标准输出改道:不打印到屏幕,写进一个文件。**管道**(pipe)是另一种改道:不打印到屏幕,接到下一个程序的标准输入上。今天的两个新概念,一个是这两种改道,一个是 `grep`。

<figure>
<svg viewBox="0 0 640 260" role="img" aria-label="三根管子:标准输入、标准输出、标准错误;重定向把标准输出接到文件,管道把它接到下一个命令的标准输入">
<rect x="0" y="0" width="640" height="260" fill="var(--paper-raised)" rx="6"/>
<g font-family="var(--font-mono)" font-size="12">
<rect x="40" y="30" width="120" height="44" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="100" y="57" text-anchor="middle" fill="var(--ink)">grep 计费</text>
<line x1="10" y1="52" x2="38" y2="52" stroke="var(--ink-soft)"/><text x="10" y="22" fill="var(--ink-faint)">stdin</text>
<line x1="160" y1="44" x2="260" y2="44" stroke="var(--mem)"/><polygon points="260,39 270,44 260,49" fill="var(--mem)"/>
<text x="168" y="36" fill="var(--mem)">stdout</text>
<line x1="160" y1="64" x2="260" y2="94" stroke="var(--compute)"/><polygon points="258,88 270,96 256,98" fill="var(--compute)"/>
<text x="168" y="98" fill="var(--compute)">stderr</text>
<rect x="275" y="26" width="90" height="34" rx="5" fill="var(--paper)" stroke="var(--rule)"/><text x="320" y="48" text-anchor="middle" fill="var(--ink)">屏幕</text>
<rect x="275" y="80" width="90" height="34" rx="5" fill="var(--paper)" stroke="var(--rule)"/><text x="320" y="102" text-anchor="middle" fill="var(--ink)">屏幕</text>
<text x="390" y="48" fill="var(--ink-soft)">默认:两根都通到屏幕</text>
<line x1="20" y1="132" x2="620" y2="132" stroke="var(--rule)"/>
<text x="40" y="160" fill="var(--ink)">grep 计费 tickets.txt  &gt;  billing.txt</text>
<text x="40" y="180" fill="var(--ink-soft)">stdout 改道写进文件,stderr 照样上屏幕</text>
<text x="40" y="214" fill="var(--ink)">grep 计费 tickets.txt  |  wc -l</text>
<text x="40" y="234" fill="var(--ink-soft)">stdout 接到 wc 的 stdin,wc 再把自己的结果打印到屏幕</text>
<rect x="420" y="196" width="80" height="30" rx="5" fill="var(--mem-wash)" stroke="var(--mem)"/><text x="460" y="216" text-anchor="middle" fill="var(--ink)">grep</text>
<line x1="500" y1="211" x2="525" y2="211" stroke="var(--mem)"/><polygon points="525,206 535,211 525,216" fill="var(--mem)"/>
<rect x="537" y="196" width="80" height="30" rx="5" fill="var(--mem-wash)" stroke="var(--mem)"/><text x="577" y="216" text-anchor="middle" fill="var(--ink)">wc -l</text>
</g>
</svg>
<figcaption>每个命令有三根管子。<code>&gt;</code> 把标准输出接到文件,<code>|</code> 把它接到下一个命令;标准错误两种情况下都还是去屏幕。</figcaption>
</figure>

## 重定向:> 写进文件,>> 追加

从最简单的 `echo` 开始(Day 4 学过,把参数原样打印出来):

```text
$ cd ~/terminal-practice
$ echo "hello agent"
hello agent
$ echo "hello agent" > hello.txt
$ ls -l hello.txt
-rw-r--r--  1 minliu  staff  12 10 22 13:10 hello.txt
$ cat hello.txt
hello agent
```

<div class="line-notes">

- `$ cd ~/terminal-practice` 还是在 Day 4 的练习目录里做。
- `$ echo "hello agent"` 输出走标准输出,打印在屏幕上。
- `$ echo "hello agent" > hello.txt` 加上 `> hello.txt`:标准输出改道写进 `hello.txt`。屏幕上**什么都没有**,因为输出都进文件了。文件不存在会自动建一个。`>` 前后的空格可有可无,我习惯留着,好读。
- `-rw-r--r--  1 minliu  staff  12 10 22 13:10 hello.txt` 12 字节:`hello agent` 是 11 个字符,`echo` 还会在末尾加一个换行符,一共 12。Day 4 用 `touch` 建的文件都是 0 字节,这是第一个有内容的。
- `$ cat hello.txt` `cat` 是今天第一个新的小命令,把文件内容打印到标准输出。名字来自 concatenate(连接),它本来的用途是把几个文件首尾相连地打印出来,`cat a.txt b.txt` 就是先打印 a 再打印 b。只给一个文件时,就是「看看这个文件里写了什么」。
- `hello agent` 文件里的内容。

</div>

`>` 有一个和 Day 4 的 `mv` 一样的脾气:**目标文件已经存在时,直接清空重写**,不提示。要往末尾加内容,用两个箭头 `>>`(追加):

```text
$ echo "第二次写入" > hello.txt
$ cat hello.txt
第二次写入
$ echo "第三行,追加" >> hello.txt
$ cat hello.txt
第二次写入
第三行,追加
```

<div class="line-notes">

- `$ echo "第二次写入" > hello.txt` 又用一个 `>` 写同一个文件。
- `第二次写入` 原来的 `hello agent` 没了,整个文件被换成了新内容。
- `$ echo "第三行,追加" >> hello.txt` `>>` 不清空,接在末尾写。
- `第三行,追加` 两行都在。我起名叫「第三行」是因为本来以为会有三行,结果第一行早被 `>` 冲掉了,这正是 `>` 的坑。

</div>

前端对照:`>` 是 `fs.writeFileSync`,`>>` 是 `fs.appendFileSync`。

### 造一份工单清单

用 `>` 和 `>>` 写一份 8 张工单的清单,后面 `grep` 要用。这是虚构公司「云簿 CloudLedger」的客服工单,Day 0 那张「被扣了两次 299 元」的工单就是第一张。每行一张:工单号、类别、客户编号、内容,用空格隔开。

```text
$ echo "T001 计费 C023 10月3日和10月5日各扣了一次299元,被扣了两次" > tickets.txt
$ echo "T002 登录 C007 手机验证码收不到" >> tickets.txt
$ echo "T003 计费 C015 想把月付改成年付,差价怎么算" >> tickets.txt
$ echo "T004 功能 C023 导出发票PDF时中文显示成方框" >> tickets.txt
$ echo "T005 登录 C031 Forgot password email never arrived" >> tickets.txt
$ echo "T006 计费 C007 Refund request for duplicate charge" >> tickets.txt
$ echo "T007 功能 C015 希望发票抬头能改成英文" >> tickets.txt
$ echo "T008 计费 C042 发票金额和订单金额对不上" >> tickets.txt
$ cat tickets.txt
T001 计费 C023 10月3日和10月5日各扣了一次299元,被扣了两次
T002 登录 C007 手机验证码收不到
T003 计费 C015 想把月付改成年付,差价怎么算
T004 功能 C023 导出发票PDF时中文显示成方框
T005 登录 C031 Forgot password email never arrived
T006 计费 C007 Refund request for duplicate charge
T007 功能 C015 希望发票抬头能改成英文
T008 计费 C042 发票金额和订单金额对不上
$ wc -l tickets.txt
       8 tickets.txt
$ head -3 tickets.txt
T001 计费 C023 10月3日和10月5日各扣了一次299元,被扣了两次
T002 登录 C007 手机验证码收不到
T003 计费 C015 想把月付改成年付,差价怎么算
```

<div class="line-notes">

- `$ echo "T001 计费 C023 10月3日和10月5日各扣了一次299元,被扣了两次" > tickets.txt` 第一行用 `>`,保证从一个空文件开始。整句加了双引号,里面的空格和逗号就都是一个参数的一部分。
- `$ echo "T002 登录 C007 手机验证码收不到" >> tickets.txt` 后面七行全用 `>>`。要是哪一行手滑写成了 `>`,前面的就全没了,敲完用 `cat` 检查一下。
- `$ echo "T005 登录 C031 Forgot password email never arrived" >> tickets.txt` 故意放两张英文工单,后面讲 `grep -i` 用。真实的客服系统里中英文混着来很正常。
- `$ cat tickets.txt` 打印整个文件确认。
- `$ wc -l tickets.txt` `wc` 是 word count,统计行数、单词数、字节数。`-l` 只要行数(lines)。
- `       8 tickets.txt` 8 行,后面跟着文件名。前面那串空格是 `wc` 自己的对齐格式,macOS 上就是这样。
- `$ head -3 tickets.txt` `head` 只打印文件开头几行,`-3` 是前 3 行,不写默认是 10 行。它的兄弟 `tail` 打印最后几行,练习 3 会用到。文件很长时用 `head` 先看看格式,比 `cat` 刷一整屏好得多。

</div>

### 坑:报错不会进文件

```text
$ ls nothere > out.txt
ls: nothere: No such file or directory
$ ls -l out.txt
-rw-r--r--  1 minliu  staff  0 10 22 13:10 out.txt
$ cat out.txt
$ ls nothere 2> err.txt
$ cat err.txt
ls: nothere: No such file or directory
$ rm out.txt err.txt
```

<div class="line-notes">

- `$ ls nothere > out.txt` 把一个必然报错的命令重定向到文件。
- `ls: nothere: No such file or directory` 报错还是出现在屏幕上,没进文件。因为 `>` 只改道标准输出,报错走的是标准错误那根管子。
- `-rw-r--r--  1 minliu  staff  0 10 22 13:10 out.txt` 文件建了,但是 0 字节。`ls` 没有正常输出,所以什么也没写进来。
- `$ cat out.txt` 空文件,`cat` 什么也不打印。
- `$ ls nothere 2> err.txt` `2>` 是专门给标准错误改道。2 是标准错误的编号(标准输入是 0,标准输出是 1,`>` 其实是 `1>` 的简写)。这次屏幕上什么都没有。
- `ls: nothere: No such file or directory` 报错进了 `err.txt`。
- `$ rm out.txt err.txt` 清理掉。

</div>

为什么要分两根管子?设想你跑一个构建脚本 `npm run build > build.log`,想把输出存下来慢慢看,如果报错也进了文件,你在屏幕上就什么都看不到,不知道它失败了。分开以后,正常的输出进文件,出错依然在眼前。后面跑 Python 脚本、跑服务时,你会经常看到 `> app.log 2> error.log` 这种写法。今天知道 `2>` 存在就够了。

## 管道:把输出交给下一条命令

重定向是把输出写进文件。很多时候你不需要文件,只想把一条命令的结果马上交给另一条命令接着处理,这就是管道 `|`(键盘上回车键上面那个竖线,要按 `Shift`)。

最经典的例子是数一个目录里有几个东西:

```text
$ ls
archive         inbox           projects        tickets.txt
hello.txt       notes           tickets
$ ls | cat
archive
hello.txt
inbox
notes
projects
tickets
tickets.txt
$ ls | wc -l
       7
```

<div class="line-notes">

- `$ ls` 直接打印到屏幕,`ls` 会排成好几列,方便人看。
- `$ ls | cat` 把 `ls` 的输出接到 `cat` 的标准输入上。`cat` 不给文件名时,就从标准输入读,读到什么打印什么。
- `archive` 输出变成了一行一个。原因是 `ls` 会检查自己的输出是不是直接连着终端屏幕:连着屏幕就排成列;连着管道或文件就一行一个,方便下一个程序处理。所以 `ls | wc -l` 数行数就等于数文件个数。
- `$ ls | wc -l` 把 `ls` 的输出交给 `wc -l` 数行。`wc` 没给文件名时也是从标准输入读。
- `       7` 7 个:五个目录加两个文件。这次没有文件名跟在后面,因为 `wc` 读的是管道,不知道叫什么名字。

</div>

管道可以接到任何「从标准输入读」的命令上:

```text
$ ls ~/Documents/my-app/node_modules | wc -l
      22
$ ls ~/Documents/my-app/node_modules | head -5
@oxc-project
@oxlint
@rolldown
@types
@vitejs
$ cat tickets.txt | head -2
T001 计费 C023 10月3日和10月5日各扣了一次299元,被扣了两次
T002 登录 C007 手机验证码收不到
```

<div class="line-notes">

- `$ ls ~/Documents/my-app/node_modules | wc -l` Day 3 那个 Vite 项目,`npm install` 装出来的 `node_modules` 顶层有几个东西。
- `      22` 22 个。`package.json` 里只写了 7 个依赖,装出来是 22 个,多出来的是这些依赖自己又依赖的包。另外 `ls` 不带 `-a` 不算隐藏的,`node_modules` 里还有 `.bin` 等隐藏项,Day 3 练习 3 里 `ls -la` 看到它的链接数是 26,对得上:22 个加上 `.`、`..` 和两个隐藏项。
- `$ ls ~/Documents/my-app/node_modules | head -5` 只看前 5 个。名字以 `@` 开头的是 npm 的作用域包(scoped package),比如 `@types/react`,你写 TS 时装过。
- `$ cat tickets.txt | head -2` 和 `head -2 tickets.txt` 效果一样。直接给文件名更简洁,但 `cat 文件 | ...` 这种写法你会在网上到处看到,认识它就行。

</div>

前端对照:管道很像数组的链式调用。`ls | head -5` 有点像 `files.slice(0, 5)`,`grep 计费 tickets.txt | wc -l` 像 `lines.filter(l => l.includes('计费')).length`。区别是数组方法在一个程序里传数组,管道是在两个独立的程序之间传一行行的文字。每个命令只做一件小事,用管道拼起来完成大事,这是 Unix 命令行最核心的设计思路。

## grep:在文字里找东西

今天第二个新概念是 `grep`,它在文字里找出**包含某个模式的行**。名字来自老编辑器里的一条命令 `g/re/p`(global / regular expression / print,全局找正则然后打印)。现在你把它理解成「终端里的 Ctrl+F,但会把匹配的整行打印出来」就行。

```text
$ grep 计费 tickets.txt
T001 计费 C023 10月3日和10月5日各扣了一次299元,被扣了两次
T003 计费 C015 想把月付改成年付,差价怎么算
T006 计费 C007 Refund request for duplicate charge
T008 计费 C042 发票金额和订单金额对不上
$ grep -n 计费 tickets.txt
1:T001 计费 C023 10月3日和10月5日各扣了一次299元,被扣了两次
3:T003 计费 C015 想把月付改成年付,差价怎么算
6:T006 计费 C007 Refund request for duplicate charge
8:T008 计费 C042 发票金额和订单金额对不上
$ grep -c 计费 tickets.txt
4
$ grep 计费 tickets.txt | wc -l
       4
$ grep -v 计费 tickets.txt
T002 登录 C007 手机验证码收不到
T004 功能 C023 导出发票PDF时中文显示成方框
T005 登录 C031 Forgot password email never arrived
T007 功能 C015 希望发票抬头能改成英文
```

<div class="line-notes">

- `$ grep 计费 tickets.txt` 格式是 `grep 模式 文件`。找出 `tickets.txt` 里所有包含「计费」的行。
- `T001 计费 C023 10月3日和10月5日各扣了一次299元,被扣了两次` 8 行里挑出了 4 行,原样打印,其他行被过滤掉。
- `$ grep -n 计费 tickets.txt` `-n`(number)在每行前面加上行号和冒号。
- `1:T001 计费 C023` 第 1、3、6、8 行。文件很长时,有行号你才知道去编辑器里跳到第几行。
- `$ grep -c 计费 tickets.txt` `-c`(count)不打印行,只打印匹配了几行。
- `4` 四张计费工单。
- `$ grep 计费 tickets.txt | wc -l` 用管道数,结果一样。`-c` 更短,但「grep 挑出来再交给 wc 数」这个组合更通用,练习 2 你会看到它能接着往下拼。
- `$ grep -v 计费 tickets.txt` `-v`(invert,反选):打印**不**包含「计费」的行。
- `T002 登录 C007 手机验证码收不到` 剩下 4 行:两张登录、两张功能。

</div>

### 大小写、没找到、和空格

```text
$ grep refund tickets.txt
$ grep -i refund tickets.txt
T006 计费 C007 Refund request for duplicate charge
$ grep C023 tickets.txt
T001 计费 C023 10月3日和10月5日各扣了一次299元,被扣了两次
T004 功能 C023 导出发票PDF时中文显示成方框
$ grep 发票 tickets.txt
T004 功能 C023 导出发票PDF时中文显示成方框
T007 功能 C015 希望发票抬头能改成英文
T008 计费 C042 发票金额和订单金额对不上
$ grep 退款 tickets.txt
$ grep 被扣了 两次 tickets.txt
grep: 两次: No such file or directory
tickets.txt:T001 计费 C023 10月3日和10月5日各扣了一次299元,被扣了两次
$ grep "被扣了 两次" tickets.txt
$ grep "被扣了两次" tickets.txt
T001 计费 C023 10月3日和10月5日各扣了一次299元,被扣了两次
```

<div class="line-notes">

- `$ grep refund tickets.txt` 小写的 `refund`。**什么都没打印**。`grep` 默认区分大小写,文件里写的是大写开头的 `Refund`。
- `$ grep -i refund tickets.txt` `-i`(ignore case)忽略大小写,找到了。搜英文时几乎总是该加 `-i`。
- `$ grep C023 tickets.txt` 按客户编号找:C023 这位客户提过两张工单,一张计费、一张功能。
- `$ grep 发票 tickets.txt` 按关键词找,不管在哪一列。注意 T008 是计费类,T004、T007 是功能类,「发票」这个词跨了类别。这就是关键词搜索的局限:它只认字面,不懂意思。
- `$ grep 退款 tickets.txt` 找「退款」,一行都没有,`grep` 也不报错,安静地什么都不打印。可 T001 和 T006 明明都是在要退款,只是用的词是「被扣了两次」和「Refund」。字面搜索漏掉了意思相同、写法不同的内容,第四部分学 RAG 时会专门解决这个问题,到时候你会想起今天这一行。
- `$ grep 被扣了 两次 tickets.txt` 想搜一个带空格的短语,没加引号。
- `grep: 两次: No such file or directory` 空格把参数切开了:`grep` 以为模式是「被扣了」,要搜的文件有两个,`两次` 和 `tickets.txt`。`两次` 这个文件不存在,报错。
- `tickets.txt:T001 计费 C023` 在 `tickets.txt` 里找「被扣了」倒是找到了。因为搜了不止一个文件,`grep` 在每行前面加上了文件名。
- `$ grep "被扣了 两次" tickets.txt` 加了引号,模式是「被扣了 两次」(中间有空格)。文件里写的是「被扣了两次」没有空格,所以一行都没找到。
- `$ grep "被扣了两次" tickets.txt` 模式和原文一字不差,找到了。

</div>

### 在一个项目里搜代码:-r

`grep` 最常用的场景其实是搜代码。加 `-r`(recursive,Day 4 的 `cp -r` 也是这个词),它会钻进目录的每一层,搜所有文件。回到 Day 3 那个 Vite 项目:

```text
$ cd ~/Documents/my-app
$ grep -r useState src
src/App.jsx:import { useState } from 'react'
src/App.jsx:  const [count, setCount] = useState(0)
$ grep -rn useState src
src/App.jsx:1:import { useState } from 'react'
src/App.jsx:8:  const [count, setCount] = useState(0)
$ grep -rl react src
src/main.jsx
src/App.jsx
$ grep -r "count" . | wc -l
     948
$ grep -r --exclude-dir=node_modules "count" . | wc -l
       6
$ grep -rl --exclude-dir=node_modules "count" .
./src/App.css
./src/index.css
./src/App.jsx
```

<div class="line-notes">

- `$ cd ~/Documents/my-app` 站到项目根目录。
- `$ grep -r useState src` 在 `src` 目录里递归搜 `useState`。
- `src/App.jsx:import { useState } from 'react'` 格式是「文件路径:那一行」。模板的 `App.jsx` 里用了两次。
- `$ grep -rn useState src` 加上 `-n`,格式变成「文件:行号:那一行」。很多编辑器能直接识别这种格式,点一下就跳过去。
- `src/App.jsx:8:  const [count, setCount] = useState(0)` 第 8 行,那个计数器按钮的状态。
- `$ grep -rl react src` `-l`(list)只列出哪些文件里有匹配,不打印具体行。
- `src/main.jsx` `main.jsx` 和 `App.jsx` 都 import 了 react。
- `$ grep -r "count" . | wc -l` 在整个项目(`.` 是当前目录)里搜 `count` 并数行数。
- `     948` 948 行。绝大部分来自 `node_modules` 里那些依赖包的源码,不是你写的代码。
- `$ grep -r --exclude-dir=node_modules "count" . | wc -l` `--exclude-dir=node_modules` 告诉 `grep` 跳过 `node_modules` 目录。这是一个用两个短横线开头的长选项,长选项写成完整单词,不能和别的选项合并。
- `       6` 只剩 6 行。
- `./src/App.css` 是哪几个文件:两个 CSS 里有 `count`(两个文件里都有 `.counter` 这个类名,它包含 `count`,所以被算进来),`App.jsx` 里是计数器的代码。

</div>

在前端项目里搜代码,**一定要排除 `node_modules`**,不然结果全是别人的代码,还慢。你在 VS Code 里全局搜索时默认看不到 `node_modules` 的结果,是编辑器帮你排除了,命令行里要自己写。另外有一个更快的替代品叫 ripgrep(命令名 `rg`),默认就跳过 `.gitignore` 里列的目录,VS Code 的全局搜索底层用的就是它。今天不装,学习资料里有链接。

## 拼起来:写一份计费工单小报告

把今天的零件组合起来:从工单清单里挑出计费类,数清楚,连同明细写进一个报告文件。

```text
$ cd ~/terminal-practice
$ echo "计费工单数:" > report.txt
$ grep -c 计费 tickets.txt >> report.txt
$ echo "明细:" >> report.txt
$ grep -n 计费 tickets.txt >> report.txt
$ cat report.txt
计费工单数:
4
明细:
1:T001 计费 C023 10月3日和10月5日各扣了一次299元,被扣了两次
3:T003 计费 C015 想把月付改成年付,差价怎么算
6:T006 计费 C007 Refund request for duplicate charge
8:T008 计费 C042 发票金额和订单金额对不上
$ wc -l report.txt
       7 report.txt
```

<div class="line-notes">

- `$ cd ~/terminal-practice` 回到练习目录,`tickets.txt` 在这里。
- `$ echo "计费工单数:" > report.txt` 第一行用 `>`,不管 `report.txt` 以前有没有、有什么,都从空白开始写。
- `$ grep -c 计费 tickets.txt >> report.txt` `grep` 的输出也能重定向,任何命令的标准输出都行。数出来的 `4` 追加进报告。
- `$ echo "明细:" >> report.txt` 追加一个小标题。
- `$ grep -n 计费 tickets.txt >> report.txt` 把带行号的明细追加进去。
- `$ cat report.txt` 看看成品。
- `       7 report.txt` 7 行:两行标题、一行数字、四行明细。

</div>

| 今天的零件 | 在上面这段里是哪一行 |
| --- | --- |
| `>` 覆盖写入 | `echo "计费工单数:" > report.txt` |
| `>>` 追加 | 后面三条 |
| `grep -c` 数匹配行 | `grep -c 计费 tickets.txt` |
| `grep -n` 带行号 | `grep -n 计费 tickets.txt` |
| `cat` 看文件 | `cat report.txt` |
| `wc -l` 数行 | 最后一条 |
| 管道 `\|` | 这段没用到,练习 1 和 2 用 |

这个小报告其实就是第一部分后面那个「工单分类器」小项目要做的事的雏形:那时候用 Python 读文件、按类别分组、统计。再往后到了第三部分,类别不再靠你在每行里手写「计费」,而是让大模型读工单内容来判断,`grep 退款` 搜不到的那两张,模型也能认出来。

## 动手练习

### 练习 1:数目录里的文件

在 `~/Documents/my-app` 里:(1)数出 `src` 目录里有几个东西;(2)数出项目根目录里连隐藏文件一共有几项,扣掉 `.` 和 `..` 是几个;(3)数出 `src/assets` 和 `public` 两个目录里一共有几个 `.svg` 文件。

<details><summary>参考答案</summary>

```text
$ cd ~/Documents/my-app
$ ls src | wc -l
       5
$ ls -a | wc -l
      12
$ ls src/assets public
public:
favicon.svg     icons.svg

src/assets:
hero.png        react.svg       vite.svg
$ ls src/assets public | grep svg
favicon.svg
icons.svg
react.svg
vite.svg
$ ls src/assets public | grep -c svg
4
```

<div class="line-notes">

- `$ ls src | wc -l` `src` 里有 `App.css`、`App.jsx`、`assets`、`index.css`、`main.jsx`,一共 5 个。目录也算一个。
- `$ ls -a | wc -l` 带隐藏项一共 12 行,扣掉 `.` 和 `..` 就是 10 个。Day 3 练习 3 列过,两个隐藏文件加八个普通的。
- `$ ls src/assets public` `ls` 接两个目录时会打印「目录名:」小标题和空行,直接数行数会把这些也算进去。
- `$ ls src/assets public | grep svg` 所以先用 `grep svg` 过滤,只留名字里有 `svg` 的行,小标题和空行、`hero.png` 都被筛掉了。
- `$ ls src/assets public | grep -c svg` 再用 `-c` 数:4 个。`grep` 不光能读文件,也能读管道传来的标准输入,这时就不用写文件名。

</div>

</details>

### 练习 2:计费类里属于 C007 的有几张

用两个 `grep` 串起来,找出既是计费类、客户又是 C007 的工单,并数出有几张。

<details><summary>参考答案</summary>

```text
$ cd ~/terminal-practice
$ grep 计费 tickets.txt | grep C007
T006 计费 C007 Refund request for duplicate charge
$ grep C007 tickets.txt | grep -c 计费
1
```

<div class="line-notes">

- `$ grep 计费 tickets.txt | grep C007` 第一个 `grep` 挑出 4 张计费工单,交给第二个 `grep` 再挑出含 C007 的。两层过滤相当于「并且」,像 JS 里 `.filter(a).filter(b)`。
- `T006 计费 C007 Refund request for duplicate charge` 只有 T006。C007 还有一张 T002,但那是登录类,第一层就被过滤掉了。
- `$ grep C007 tickets.txt | grep -c 计费` 顺序反过来也一样,最后一个用 `-c` 数,结果 1。

</div>

</details>

### 练习 3:把非计费工单另存,再追加一张新工单

把所有不是计费类的工单存进 `others.txt` 并数行数;然后往 `tickets.txt` 末尾追加一张新工单 `T009 计费 C031 续费后发票没有发到邮箱`,重新数计费工单和总行数,并用 `tail` 看最后一行确认追加成功。

<details><summary>参考答案</summary>

```text
$ cd ~/terminal-practice
$ grep -v 计费 tickets.txt > others.txt
$ wc -l others.txt
       4 others.txt
$ echo "T009 计费 C031 续费后发票没有发到邮箱" >> tickets.txt
$ grep -c 计费 tickets.txt
5
$ wc -l tickets.txt
       9 tickets.txt
$ tail -1 tickets.txt
T009 计费 C031 续费后发票没有发到邮箱
```

<div class="line-notes">

- `$ grep -v 计费 tickets.txt > others.txt` `-v` 反选,结果重定向进新文件。
- `       4 others.txt` 4 张:两张登录、两张功能。
- `$ echo "T009 计费 C031 续费后发票没有发到邮箱" >> tickets.txt` 一定是 `>>`。写成 `>` 的话 `tickets.txt` 就只剩这一行了。
- `5` 计费工单从 4 张变成 5 张。
- `       9 tickets.txt` 总共 9 行。
- `$ tail -1 tickets.txt` `tail` 和 `head` 相反,打印最后几行,`-1` 是最后 1 行。追加完用它确认一下最省事。

</div>

</details>

### 练习 4:观察「读写同一个文件」会发生什么

先把 `tickets.txt` 复制一份 `copy.txt`,然后运行 `grep 计费 copy.txt > copy.txt`,本意是「把 copy.txt 改成只剩计费工单」。观察 `copy.txt` 变成了什么,解释原因,再写出正确的做法。

<details><summary>参考答案</summary>

```text
$ cd ~/terminal-practice
$ cp tickets.txt copy.txt
$ wc -l copy.txt
       9 copy.txt
$ grep 计费 copy.txt > copy.txt
$ wc -l copy.txt
       0 copy.txt
$ ls -l copy.txt
-rw-r--r--  1 minliu  staff  0 10 22 13:11 copy.txt
$ rm copy.txt
$ cp tickets.txt copy.txt
$ grep 计费 copy.txt > billing.txt
$ mv billing.txt copy.txt
$ wc -l copy.txt
       5 copy.txt
$ rm copy.txt
```

<div class="line-notes">

- `$ cp tickets.txt copy.txt` 做练习永远拿副本折腾。
- `       9 copy.txt` 复制过来 9 行(练习 3 追加过 T009)。
- `$ grep 计费 copy.txt > copy.txt` 读和写是同一个文件。
- `       0 copy.txt` 文件被清空了,一行不剩,也没有任何报错。原因在执行顺序:shell 处理 `> copy.txt` 时,**先把 `copy.txt` 清空**,准备好接收输出,然后才启动 `grep`。等 `grep` 去读 `copy.txt` 时,里面已经什么都没有了,于是什么也没找到,什么也没写。
- `-rw-r--r--  1 minliu  staff  0 10 22 13:11 copy.txt` 0 字节确认。
- `$ grep 计费 copy.txt > billing.txt` 正确做法:先写进一个**新文件**。
- `$ mv billing.txt copy.txt` 再用 `mv` 把新文件改名盖掉旧的。Day 4 说 `mv` 覆盖不提示是个坑,这里正好利用它。
- `       5 copy.txt` 只剩 5 张计费工单,对了。
- `$ rm copy.txt` 清理掉副本。

</div>

这个坑在 `sort`、`sed` 等所有「读一个文件、输出到重定向」的命令上都一样。记住一句:**`>` 的目标文件不能是这条命令正在读的文件**。

</details>

验收标准:不看文章能说出标准输出和标准错误的区别,以及 `>`、`>>`、`2>`、`|` 各自把哪根管子接到了哪里;能解释为什么 `ls` 直接打印是多列、接上管道就一行一个;能写出在一个前端项目里排除 `node_modules` 搜某个函数名的命令;正文的计费报告和四道练习自己敲出来,数字和文中一致。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 标准输入(stdin) | 程序读数据的入口,默认接键盘。编号 0 |
| 标准输出(stdout) | 程序正常结果的出口,默认接屏幕,相当于 `console.log`。编号 1 |
| 标准错误(stderr) | 程序报错的出口,默认也接屏幕,相当于 `console.error`。编号 2 |
| 重定向 | 把输出从屏幕改道到文件:`>` 覆盖写,`>>` 追加,`2>` 只改道标准错误 |
| 管道(pipe) | 用 `\|` 把前一个命令的标准输出接到后一个命令的标准输入 |
| `cat` | 把文件内容打印到标准输出;不给文件名时从标准输入读 |
| `wc -l` | 数行数 |
| `head` / `tail` | 只打印开头 / 末尾几行,`-3` 表示 3 行,默认 10 行 |
| `grep` | 找出包含某个模式的行。`-n` 行号,`-c` 计数,`-v` 反选,`-i` 忽略大小写,`-r` 递归搜目录,`-l` 只列文件名 |
| 长选项 | 以两个短横线开头、写成完整单词的选项,如 `--exclude-dir=node_modules`,不能和别的选项合并 |
| 作用域包(scoped package) | npm 里名字以 `@组织名/` 开头的包,如 `@types/react` |
| ripgrep(`rg`) | 一个比 `grep` 更快的搜索工具,默认跳过 `.gitignore` 里的目录,VS Code 搜索底层用它 |

## 常见误区

**以为 `>` 会接在文件后面写。** `>` 是清空重写,`>>` 才是追加。正文里第一行 `hello agent` 就是被第二次的 `>` 冲掉的。往已有文件里加东西时,敲回车前看一眼箭头是一个还是两个。

**读写同一个文件。** `grep 计费 copy.txt > copy.txt` 会把文件清空成 0 字节,而且不报错。练习 4 演示过:shell 先清空目标再启动命令。先写到新文件,再 `mv` 回去。

**以为报错也会进文件。** `>` 只管标准输出,报错走标准错误,照样打在屏幕上,文件里没有。要把报错存下来用 `2>`。

**`grep` 搜英文忘了 `-i`。** `grep refund` 找不到 `Refund`。搜英文单词时加上 `-i`,除非你确实要区分大小写。

**搜带空格的短语不加引号。** `grep 被扣了 两次 tickets.txt` 会把 `两次` 当成一个文件名去找,报 `No such file or directory`。模式里有空格就加引号。

**在前端项目里 `grep -r` 不排除 `node_modules`。** 正文里不排除是 948 行,排除后 6 行。加 `--exclude-dir=node_modules`,或者换用默认会跳过它的 `rg`。

**以为 `grep` 没输出就是出错了。** `grep 退款 tickets.txt` 什么都不打印,是因为确实没有包含「退款」的行,不是命令坏了。没找到时 `grep` 安静退出,不打印任何提示。

## 学习资料

### 文档与文章

- [MDN 命令行速成课](https://developer.mozilla.org/zh-CN/docs/Learn_web_development/Getting_started/Environment_setup/Command_line):中文,前两天读过前面的部分,今天读讲用管道把命令连起来的那一节,它举的也是 `ls | wc -l` 这类例子。
- [计算机教育中缺失的一课 · 数据整理](https://missing-semester-cn.github.io/2020/data-wrangling/):中文,讲怎么用 `grep`、管道和更多工具处理一大坨日志文本。今天读开头到 `grep` 那部分,后面的 `sed`、正则表达式以后再看。
- [The Missing Semester 2026 · Course Overview + Introduction to the Shell](https://missing.csail.mit.edu/2026/course-shell/):英文,Day 3 读过前半段,今天读后面「The shell language」里讲管道和重定向的部分,还有讲 `grep` 的那几段。
- [ss64 · grep](https://ss64.com/mac/grep.html):英文,macOS 自带的 `grep` 的全部选项。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1Vh4y157Z5&autoplay=0&high_quality=1" title="【Linux入坑指南】重定向、标准输入输出、管道 | 进阶篇第3期" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>穆几MuJi · 【Linux入坑指南】重定向、标准输入输出、管道 | 进阶篇第3期 · 8 分钟。正好对应今天前半部分:三个标准流、重定向、管道。看完对照正文那张三根管子的图再讲一遍。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1Bu411G7H3&autoplay=0&high_quality=1" title="每天一个Linux命令-grep" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>Ternurafl · 每天一个Linux命令-grep · 6 分钟。Day 4 推荐过这位 UP 主讲 mv 的那期,这期只讲 grep 的常用选项。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/sz_dsktIjt4" title="Lecture 4: Data Wrangling (2020)" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Missing Semester · Lecture 4: Data Wrangling (2020) · 英文,可开自动字幕。上面「数据整理」讲义对应的录像。讲师拿一份真实的服务器登录日志,用 grep 和管道一步步把有用的信息抠出来,很能体会「每个命令做一件小事、用管道拼起来」是什么意思。今天看前 15 分钟左右。</figcaption>
</figure>

### 书籍

- William Shotts《The Linux Command Line》第 2 版,No Starch Press,2019(中文版《Linux 命令行大全》,人民邮电出版社)。今天对应第 6 章「重定向」,标准输入输出、`>`、`>>`、`2>`、管道、`cat`、`wc`、`grep`、`head`、`tail` 都在这一章。英文版 PDF 作者在 [linuxcommand.org](https://linuxcommand.org/) 免费提供,第 1 版有[社区中文翻译](https://billie66.github.io/TLCL/)。

### 开源项目与代码

- [BurntSushi/ripgrep](https://github.com/BurntSushi/ripgrep):`grep` 的现代替代品 `rg`,用 Rust 写的,默认尊重 `.gitignore`、跳过隐藏文件和二进制文件。README 里有和 `grep` 等工具的速度对比。今天不用装,以后在大项目里搜代码时你会想要它。
- [jlevy/the-art-of-command-line](https://github.com/jlevy/the-art-of-command-line/blob/master/README-zh.md):《命令行的艺术》中文版,一页纸列了日常最常用的命令行技巧,今天看「基础」和「日常使用」两节里关于重定向、管道和 `grep` 的条目,其他的收藏起来以后慢慢看。

## 自测

1. `echo "a" > x.txt` 连续执行三次,`x.txt` 里有几行?换成 `>>` 呢?

<details><summary>答案</summary>

`>` 每次都清空重写,所以只有 1 行 `a`。`>>` 每次追加,有 3 行(前提是一开始 `x.txt` 不存在或为空)。

</details>

2. `ls nothere > out.txt` 之后,报错在哪里?`out.txt` 里有什么?

<details><summary>答案</summary>

报错打印在屏幕上,因为它走标准错误,而 `>` 只改道标准输出。`out.txt` 被建出来了,是 0 字节的空文件。

</details>

3. 为什么 `ls` 直接敲是多列显示,`ls | wc -l` 却能正确数出文件个数?

<details><summary>答案</summary>

`ls` 会检查标准输出连的是不是终端屏幕。连屏幕时排成多列给人看;连管道或文件时一行一个,方便下一个程序处理。所以接上管道后每行就是一个名字,数行数等于数个数。

</details>

4. 在一个 React 项目里,怎么找出所有用到 `useEffect` 的文件(只要文件名),并且不看 `node_modules`?

<details><summary>答案</summary>

`grep -rl --exclude-dir=node_modules useEffect .`(在项目根目录跑)。`-r` 递归,`-l` 只列文件名,`--exclude-dir` 跳过依赖目录。

</details>

5. 面试题:有人想把日志里的报错行留下、其他删掉,写了 `grep ERROR app.log > app.log`,结果日志全没了。为什么?怎么改?

<details><summary>答案</summary>

shell 在启动 `grep` 之前就处理了 `> app.log`,先把 `app.log` 清空,`grep` 读到的是空文件,所以什么也没写进去。改法:先写到新文件 `grep ERROR app.log > errors.log`,确认无误后需要的话再 `mv errors.log app.log`。

</details>

## 明天预告

Day 6 · 第 1 周复习:编程地基(Day 0–5)。这周从「这个岗位做什么」讲到终端的三课,零件已经不少了:命令三段结构、绝对和相对路径、`mkdir`/`cp`/`mv`/`rm`、通配符、重定向、管道、`grep`。明天不学新东西,画一张本周的知识地图,把 Day 3 到 Day 5 的核心命令合上书默写一遍,用这周学的命令从零搭一个小目录、写一份工单报告,再把这几天踩过的坑整理成一张错题清单。
