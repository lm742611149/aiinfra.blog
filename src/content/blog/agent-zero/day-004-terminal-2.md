---
title: 'Day 4 · 终端(二):建目录、复制、移动、删除'
description: '在家目录里建一个练习目录,用 mkdir、touch、cp、mv、rm 把文件建出来、复制、改名、搬家、删掉,每个命令都故意踩一次坑;再学通配符 * 和 ?,先用 echo 预览再动手,最后把一个乱糟糟的下载目录整理干净。'
pubDate: 2026-10-22
regime: none
tags: ['terminal', 'agent-zero']
series: 'agent-zero'
day: 4
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 3](/blog/agent-zero/day-003-terminal-1/) 学了看懂提示符、命令的三段结构(命令名、选项、参数),用 `pwd` 看自己在哪、`ls` 看有什么、`cd` 换地方站,还分清了绝对路径(以 `/` 开头,在哪都一样)和相对路径(从当前工作目录出发),以及 `.`、`..`、`~`。那几条命令都只看不改。今天开始真正动手改文件:建、复制、移动、删除。每条命令都要写路径,昨天的东西今天每一行都用得上。

## 今天要解决的问题

1. 会用 `mkdir`(含 `-p`)建目录、`touch` 建空文件,`cp`(含 `-r`)复制,`mv` 移动和改名,`rm`(含 `-r`)和 `rmdir` 删除。
2. 知道这几个命令最危险的两个地方:`mv` 和 `cp` 会**一声不吭地覆盖**同名文件,`rm` 删的东西**不进废纸篓**;会用 `-i` 让它们先问你。
3. 会用通配符 `*` 和 `?` 一次选中一批文件,知道是 shell 在命令执行前把它展开的,并且养成「先 `echo` 预览、再真的动手」的习惯。
4. 能用今天的命令把一个乱糟糟的目录按类型整理好。

预计用时:2 小时。前 70 分钟一条条敲五个命令和它们的坑,20 分钟学通配符,剩下的时间做练习。

前置:[Day 3](/blog/agent-zero/day-003-terminal-1/)(`pwd`、`ls -l`、`cd`,绝对路径和相对路径,`~` 是 shell 替你换的)。

学法提示:先对照文章逐条敲一遍命令(不复制粘贴)并对照输出;第二天合上文章,从空目录开始把「建目录 → 建文件 → 复制 → 改名 → 搬家 → 用通配符批量搬 → 删掉」默写成命令敲出来;然后做动手练习,做不出再展开参考答案,看完关掉自己重写一遍。

## 先建一个可以随便折腾的地方

今天的命令会改动磁盘上的文件,`rm` 还会真删东西。所以第一件事是在家目录里建一个专门的练习目录,**所有操作都只在它里面做**,弄乱了大不了整个删掉重来。

和 Day 3 一样,下面的输出是我 2026-10-22 在自己的 2019 款 Intel MacBook Pro(macOS 14、zsh)上真跑的,用的是同一个演示用的家目录,路径显示成 `/Users/minliu`,里面有 Day 3 那个 `Documents/my-app`。以 `$ ` 开头的是我敲的命令,你不用敲 `$`。

```text
$ cd ~
$ mkdir terminal-practice
$ ls
Desktop                 Library                 Pictures
Documents               Movies                  Public
Downloads               Music                   terminal-practice
$ cd terminal-practice
$ pwd
/Users/minliu/terminal-practice
```

<div class="line-notes">

- `$ cd ~` 先回家目录,确认起点。今天每一段开头我都会先 `cd` 到一个确定的地方,你也这么做,这是防止在错误目录里删东西的第一道保险。
- `$ mkdir terminal-practice` `mkdir` 是 make directory,建一个目录。参数是要建的目录名,这里是相对路径,所以建在当前目录(家目录)下面。和 `cd` 一样,成功时什么都不打印。
- `Downloads               Music                   terminal-practice` 多了一个 `terminal-practice`。你在访达里打开家目录也能看到它,在终端里敲 `open .` 会用访达打开当前目录,两边对照着看很直观(`open` 是 macOS 专有的命令,`.` 是 Day 3 学的当前目录)。
- `$ cd terminal-practice` 走进去,后面都在这里做。
- `/Users/minliu/terminal-practice` 确认站对了地方。

</div>

## mkdir:建目录

`mkdir` 可以一次建好几个,也可以一次建好几层。

```text
$ mkdir tickets notes
$ ls
notes   tickets
$ mkdir tickets
mkdir: tickets: File exists
$ mkdir projects/demo/src
mkdir: projects/demo: No such file or directory
$ mkdir -p projects/demo/src
$ ls projects/demo
src
```

<div class="line-notes">

- `$ mkdir tickets notes` 两个参数,建两个目录。很多命令都能一次接好几个参数,用空格隔开。
- `notes   tickets` 两个都建好了,按字母排序。
- `$ mkdir tickets` 故意再建一次已经有的。
- `mkdir: tickets: File exists` 已经存在,不让建。报错里说的是 File,但在 Unix 系统里目录也算一种文件,不用纠结。
- `$ mkdir projects/demo/src` 想一次建三层,但 `projects` 和 `demo` 都还不存在。
- `mkdir: projects/demo: No such file or directory` `mkdir` 默认只建最后一层,要求上面几层已经在了。
- `$ mkdir -p projects/demo/src` 加 `-p`(parents,父目录),缺的上层目录一起建好。而且加了 `-p` 以后,目录已经存在也不报错。写脚本时几乎总是用 `mkdir -p`,这个习惯后面写 Python 时也会再见到:Python 里有一个几乎一模一样的 `parents=True`。
- `src` 三层都在了。

</div>

前端对照一下:`mkdir -p` 相当于 Node 里的 `fs.mkdirSync('projects/demo/src', { recursive: true })`,你可能在构建脚本里写过。

## touch:建一个空文件

练习需要一些文件,`touch` 是最快的造文件办法。

```text
$ touch tickets/ticket-001.txt
$ touch tickets/ticket-002.txt tickets/ticket-003.txt
$ ls -l tickets
total 0
-rw-r--r--  1 minliu  staff  0 10 22 13:05 ticket-001.txt
-rw-r--r--  1 minliu  staff  0 10 22 13:05 ticket-002.txt
-rw-r--r--  1 minliu  staff  0 10 22 13:05 ticket-003.txt
$ touch notes/day4.md
$ ls notes
day4.md
```

<div class="line-notes">

- `$ touch tickets/ticket-001.txt` 在 `tickets` 目录里建一个叫 `ticket-001.txt` 的空文件。`touch` 本来的用途是「摸一下」:文件存在就把它的修改时间更新成现在,不存在才新建一个空的。我们今天只用它建文件。
- `$ touch tickets/ticket-002.txt tickets/ticket-003.txt` 一次建两个。
- `-rw-r--r--  1 minliu  staff  0 10 22 13:05 ticket-001.txt` 开头 `-` 是普通文件,大小 `0` 字节,确实是空的。文件里写内容要用重定向,明天(Day 5)学。
- `$ touch notes/day4.md` 再建一个笔记文件,后面拿它练改名。

</div>

## cp:复制

`cp` 是 copy,格式是 `cp 源 目标`:把「源」复制一份到「目标」。空文件看不出复制有没有成功,所以我从 Day 3 那个 `my-app` 里复制两个有内容、大小不一样的文件过来,后面靠 `ls -l` 的大小一栏就能看出发生了什么。

```text
$ cp ~/Documents/my-app/package.json notes/
$ cp ~/Documents/my-app/.gitignore notes/gitignore-sample.txt
$ ls -l notes
total 16
-rw-r--r--  1 minliu  staff    0 10 22 13:05 day4.md
-rw-r--r--  1 minliu  staff  253 10 22 13:05 gitignore-sample.txt
-rw-r--r--  1 minliu  staff  456 10 22 13:05 package.json
$ cp notes/package.json notes/package.backup.json
$ ls notes
day4.md                 package.backup.json
gitignore-sample.txt    package.json
```

<div class="line-notes">

- `$ cp ~/Documents/my-app/package.json notes/` 源是一个用 `~` 写的路径,目标是 `notes/`。**目标是一个已经存在的目录时**,文件会被复制进去,名字不变。目标末尾的 `/` 是在明确说「我指的是目录」,练习 3 会看到它的作用。
- `$ cp ~/Documents/my-app/.gitignore notes/gitignore-sample.txt` 目标是一个不存在的名字时,就复制过去**并用这个新名字**。顺手把隐藏文件变成了一个看得见的名字。
- `-rw-r--r--  1 minliu  staff  253 10 22 13:05 gitignore-sample.txt` 253 字节,和 Day 3 里 `ls -la` 看到的 `.gitignore` 大小一样,复制没走样。
- `-rw-r--r--  1 minliu  staff  456 10 22 13:05 package.json` 456 字节,也和原件一样。原件还在 `my-app` 里,一个字没动,这就是复制。
- `$ cp notes/package.json notes/package.backup.json` 同一个目录里复制一份,换个名字。改配置文件之前先备份一份,是最常用的一招。

</div>

复制目录要多一个选项:

```text
$ cp projects projects-copy
cp: projects is a directory (not copied).
$ cp -r projects projects-copy
$ ls
notes           projects        projects-copy   tickets
$ ls projects-copy/demo
src
```

<div class="line-notes">

- `$ cp projects projects-copy` 不加选项直接复制目录。
- `cp: projects is a directory (not copied).` 这是目录,不复制。`cp` 默认只复制文件。
- `$ cp -r projects projects-copy` 加 `-r`(recursive,递归):把目录连同里面所有层的东西全部复制。「递归」在这里的意思是一层层往里钻,里面还有目录就继续钻,直到最底层。
- `src` 里面三层结构都复制过来了。

</div>

## mv:移动,也是改名

`mv` 是 move,格式和 `cp` 一样是 `mv 源 目标`,区别是**源不留了**。终端里没有单独的「改名」命令,改名就是「在同一个目录里移动成另一个名字」。

<figure>
<svg viewBox="0 0 640 220" role="img" aria-label="cp 和 mv 的区别:cp 之后源和目标都在,mv 之后只剩目标">
<rect x="0" y="0" width="640" height="220" fill="var(--paper-raised)" rx="6"/>
<g font-family="var(--font-mono)" font-size="12">
<text x="30" y="34" fill="var(--ink)">cp a.json b.json</text>
<rect x="30" y="50" width="100" height="34" rx="5" fill="var(--mem-wash)" stroke="var(--mem)"/><text x="80" y="72" text-anchor="middle" fill="var(--ink)">a.json</text>
<line x1="135" y1="67" x2="200" y2="67" stroke="var(--ink-soft)"/><polygon points="200,62 210,67 200,72" fill="var(--ink-soft)"/>
<rect x="215" y="50" width="100" height="34" rx="5" fill="var(--mem-wash)" stroke="var(--mem)"/><text x="265" y="72" text-anchor="middle" fill="var(--ink)">b.json</text>
<text x="30" y="106" fill="var(--ink-soft)">之后:a 还在,多了一个 b</text>
<text x="350" y="34" fill="var(--ink)">mv a.json b.json</text>
<rect x="350" y="50" width="100" height="34" rx="5" fill="var(--paper)" stroke="var(--rule)" stroke-dasharray="4 3"/><text x="400" y="72" text-anchor="middle" fill="var(--ink-faint)">a.json</text>
<line x1="455" y1="67" x2="510" y2="67" stroke="var(--ink-soft)"/><polygon points="510,62 520,67 510,72" fill="var(--ink-soft)"/>
<rect x="525" y="50" width="100" height="34" rx="5" fill="var(--mem-wash)" stroke="var(--mem)"/><text x="575" y="72" text-anchor="middle" fill="var(--ink)">b.json</text>
<text x="350" y="106" fill="var(--ink-soft)">之后:a 没了,只剩 b(改名)</text>
<line x1="20" y1="126" x2="620" y2="126" stroke="var(--rule)"/>
<text x="30" y="152" fill="var(--compute)">如果 b.json 原本就存在:</text>
<text x="30" y="176" fill="var(--ink)">两个命令都会直接覆盖它,不提示、不备份、找不回来</text>
<text x="30" y="200" fill="var(--ink-soft)">加 -i 才会先问:overwrite b.json? (y/n [n])</text>
</g>
</svg>
<figcaption>cp 留着源,mv 不留。两者共同的坑在下半部分:目标已经存在时默认直接覆盖。</figcaption>
</figure>

```text
$ mv notes/day4.md notes/day04.md
$ ls notes
day04.md                package.backup.json
gitignore-sample.txt    package.json
$ mv notes/package.backup.json projects/demo/
$ ls notes
day04.md                gitignore-sample.txt    package.json
$ ls projects/demo
package.backup.json     src
$ mv projects-copy archive
$ ls
archive         notes           projects        tickets
```

<div class="line-notes">

- `$ mv notes/day4.md notes/day04.md` 源和目标在同一个目录,只是名字不同,效果就是改名。`day4.md` 变成了 `day04.md`。
- `day04.md                package.backup.json` 原来的 `day4.md` 没了。
- `$ mv notes/package.backup.json projects/demo/` 目标是一个已经存在的目录,文件就被搬进去,名字不变。
- `day04.md                gitignore-sample.txt    package.json` `notes` 里少了备份文件。
- `package.backup.json     src` 它到了 `projects/demo` 里。
- `$ mv projects-copy archive` `mv` 移动目录**不需要** `-r`,这一点和 `cp`、`rm` 不一样。这里 `archive` 不存在,所以效果是把 `projects-copy` 改名成 `archive`。
- `archive         notes           projects        tickets` 改名成功。

</div>

### 坑:同名文件会被直接覆盖

这是今天最需要记住的一件事。现在 `notes` 里有一个 253 字节的 `gitignore-sample.txt` 和一个 456 字节的 `package.json`。我把前者 `mv` 成后者的名字:

```text
$ cd ~/terminal-practice/notes
$ ls -l
total 16
-rw-r--r--  1 minliu  staff    0 10 22 13:05 day04.md
-rw-r--r--  1 minliu  staff  253 10 22 13:05 gitignore-sample.txt
-rw-r--r--  1 minliu  staff  456 10 22 13:05 package.json
$ mv gitignore-sample.txt package.json
$ ls -l
total 8
-rw-r--r--  1 minliu  staff    0 10 22 13:05 day04.md
-rw-r--r--  1 minliu  staff  253 10 22 13:05 package.json
```

<div class="line-notes">

- `$ cd ~/terminal-practice/notes` 先站到 `notes` 里,后面的路径就短了。
- `-rw-r--r--  1 minliu  staff  456 10 22 13:05 package.json` 移动之前,`package.json` 是 456 字节的那个。
- `$ mv gitignore-sample.txt package.json` 目标 `package.json` 已经存在。`mv` 没有任何提示,回车就完事了。
- `-rw-r--r--  1 minliu  staff  253 10 22 13:05 package.json` 现在叫 `package.json` 的文件是 253 字节,也就是原来那个 gitignore 的内容。原来 456 字节的 `package.json` **已经没了**,不在废纸篓,也没有撤销。`cp` 覆盖时也是一样的一声不吭。

</div>

想象一下这是你项目里真的 `package.json`。修法是给 `mv` 和 `cp` 加 `-i`(interactive,交互),目标存在时先问你。我把两个文件从 `my-app` 重新复制回来,恢复原样,再试一次:

```text
$ cp ~/Documents/my-app/package.json .
$ cp ~/Documents/my-app/.gitignore gitignore-sample.txt
$ mv -i gitignore-sample.txt package.json
overwrite package.json? (y/n [n]) n
not overwritten
```

<div class="line-notes">

- `$ cp ~/Documents/my-app/package.json .` 目标是 `.`,当前目录。把原件复制回来,名字不变。这里同样会覆盖掉那个 253 字节的冒牌 `package.json`,这次是我想要的。
- `$ cp ~/Documents/my-app/.gitignore gitignore-sample.txt` 把被搬走的那个也恢复。
- `$ mv -i gitignore-sample.txt package.json` 加了 `-i`。
- `overwrite package.json? (y/n [n]) n` 它先问「要覆盖 package.json 吗」。`(y/n [n])` 的意思是可以回答 y 或 n,方括号里的 `n` 是默认值,直接回车就等于 n。我敲了 `n` 回车。
- `not overwritten` 没覆盖,两个文件都还在。

</div>

## 通配符:一次选一批

到这里每条命令都只处理一两个文件。实际干活时经常要「把所有 `.txt` 移走」「把 001 到 009 的工单都备份」,一个个敲太慢。今天第二个新概念就是**通配符**(wildcard),也叫 glob:用特殊字符写一个「模式」,一次匹配一批名字。

两个最常用的:

- `*` 匹配任意多个任意字符(包括零个)。`*.txt` 是所有以 `.txt` 结尾的,`ticket-*` 是所有以 `ticket-` 开头的。
- `?` 匹配正好一个任意字符。`ticket-00?.txt` 能匹配 `ticket-001.txt` 到 `ticket-009.txt`,但匹配不到 `ticket-010.txt`。

前端里你见过它们:`.gitignore` 里的 `*.log`、`tsconfig.json` 里 `"include": ["src/**/*"]`、Vite 的 `import.meta.glob('./pages/*.jsx')`,写法是同一个思路。

最关键的一点:**通配符是 shell 展开的,不是命令自己处理的**。你敲 `ls *.txt`,shell 先去当前目录里找所有匹配的名字,把 `*.txt` 替换成 `a.txt b.txt c.txt`,然后才运行 `ls a.txt b.txt c.txt`。`ls` 根本没见过星号。这和昨天 `~` 被 shell 替换是同一回事。

<figure>
<svg viewBox="0 0 640 200" role="img" aria-label="通配符展开:shell 先把 tickets/*.txt 替换成匹配到的文件名列表,再交给 mv">
<rect x="0" y="0" width="640" height="200" fill="var(--paper-raised)" rx="6"/>
<g font-family="var(--font-mono)" font-size="12">
<text x="30" y="36" fill="var(--ink-faint)">① 你敲的</text>
<rect x="30" y="46" width="300" height="30" rx="5" fill="var(--paper)" stroke="var(--rule)"/>
<text x="42" y="66" fill="var(--ink)">mv tickets/ticket-00?.txt old/</text>
<line x1="180" y1="78" x2="180" y2="102" stroke="var(--mem)"/><polygon points="175,100 180,110 185,100" fill="var(--mem)"/>
<text x="195" y="98" fill="var(--mem)">shell 在 tickets 目录里找名字,替换掉模式</text>
<text x="30" y="128" fill="var(--ink-faint)">② 命令真正收到的</text>
<rect x="30" y="138" width="590" height="30" rx="5" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="42" y="158" fill="var(--ink)">mv tickets/ticket-001.txt tickets/ticket-002.txt tickets/ticket-003.txt … old/</text>
<text x="30" y="190" fill="var(--ink-soft)">mv 从头到尾没见过 ?。所以先用 echo 看 ② 长什么样,再真的执行</text>
</g>
</svg>
<figcaption>通配符在命令运行之前就被 shell 换成了一串文件名。这是「先 echo 预览」这招能成立的原因。</figcaption>
</figure>

既然展开发生在命令运行之前,就有一个非常好用的办法预览:**用 `echo` 代替真正的命令**。`echo` 是最简单的命令,把收到的参数原样打印出来。

```text
$ cd ~/terminal-practice
$ touch tickets/ticket-004.txt tickets/ticket-010.txt tickets/ticket-011.md
$ ls tickets
ticket-001.txt  ticket-003.txt  ticket-010.txt
ticket-002.txt  ticket-004.txt  ticket-011.md
$ echo hello agent
hello agent
$ echo tickets/*
tickets/ticket-001.txt tickets/ticket-002.txt tickets/ticket-003.txt tickets/ticket-004.txt tickets/ticket-010.txt tickets/ticket-011.md
$ echo tickets/*.txt
tickets/ticket-001.txt tickets/ticket-002.txt tickets/ticket-003.txt tickets/ticket-004.txt tickets/ticket-010.txt
$ echo tickets/ticket-00?.txt
tickets/ticket-001.txt tickets/ticket-002.txt tickets/ticket-003.txt tickets/ticket-004.txt
$ echo tickets/ticket-01*
tickets/ticket-010.txt tickets/ticket-011.md
$ ls tickets/*.md
tickets/ticket-011.md
```

<div class="line-notes">

- `$ touch tickets/ticket-004.txt tickets/ticket-010.txt tickets/ticket-011.md` 再造三个文件,让模式有东西可匹配:一个 004,两个 01 开头的,其中一个是 `.md`。
- `ticket-001.txt  ticket-003.txt  ticket-010.txt` 现在 `tickets` 里有六个文件。
- `$ echo hello agent` 先看 `echo` 本身:收到两个参数 `hello` 和 `agent`,原样打印,中间一个空格。相当于 JS 的 `console.log('hello', 'agent')`。
- `$ echo tickets/*` `*` 匹配所有名字,shell 把它展开成六个路径交给 `echo`。
- `$ echo tickets/*.txt` 只要 `.txt` 结尾的,`ticket-011.md` 被排除了,剩五个。
- `$ echo tickets/ticket-00?.txt` `?` 只占一个字符,所以 `00` 后面跟一个字符再接 `.txt`:001 到 004。`ticket-010.txt` 的 `00` 后面不是一个字符而是 `10`,不匹配。
- `$ echo tickets/ticket-01*` 以 `ticket-01` 开头,不管后缀。
- `$ ls tickets/*.md` 通配符可以和任何命令一起用。这里 `ls` 收到的参数就是 `tickets/ticket-011.md`,所以它只打印这一个。

</div>

预览确认没问题,再把 `echo` 换成真正的命令:

```text
$ mkdir tickets/old
$ echo tickets/ticket-00?.txt
tickets/ticket-001.txt tickets/ticket-002.txt tickets/ticket-003.txt tickets/ticket-004.txt
$ mv tickets/ticket-00?.txt tickets/old/
$ ls tickets
old             ticket-010.txt  ticket-011.md
$ ls tickets/old
ticket-001.txt  ticket-002.txt  ticket-003.txt  ticket-004.txt
$ cp tickets/old/* archive/
$ ls archive
demo            ticket-001.txt  ticket-002.txt  ticket-003.txt  ticket-004.txt
```

<div class="line-notes">

- `$ mkdir tickets/old` 建一个放旧工单的目录。
- `$ echo tickets/ticket-00?.txt` 先预览:四个文件。
- `$ mv tickets/ticket-00?.txt tickets/old/` 确认无误,把 `echo` 换成 `mv`,末尾加上目标目录。`mv` 收到五个参数,**最后一个是目标,前面的全是源**。多个源时目标必须是一个已存在的目录。
- `old             ticket-010.txt  ticket-011.md` 四个文件搬走了。
- `$ cp tickets/old/* archive/` 把 `old` 里所有东西复制一份到 `archive`(就是上面 `projects-copy` 改名来的那个)。
- `demo            ticket-001.txt  ticket-002.txt  ticket-003.txt  ticket-004.txt` `archive` 里原来的 `demo` 加上四个工单。

</div>

## rm 和 rmdir:删除

通配符学完,现在 `tickets` 里有一个 `old` 目录和两个 01 开头的工单,正好拿来练删除。`rm` 是 remove。先说最重要的:**`rm` 删掉的文件不会进废纸篓,删了就没了**。访达里删文件是「移到废纸篓」,还能拖回来;`rm` 是直接从磁盘上抹掉记录,没有撤销。

```text
$ cd ~/terminal-practice
$ rm tickets/ticket-011.md
$ ls tickets
old             ticket-010.txt
$ rm tickets/old
rm: tickets/old: is a directory
$ rmdir tickets/old
rmdir: tickets/old: Directory not empty
$ rm -r tickets/old
$ ls tickets
ticket-010.txt
$ rmdir projects/demo/src
$ ls projects/demo
package.backup.json
```

<div class="line-notes">

- `$ rm tickets/ticket-011.md` 删一个文件,就是上面用 `touch` 造的那个 `.md` 工单。
- `$ rm tickets/old` 想用 `rm` 删目录。
- `rm: tickets/old: is a directory` 和 `cp` 一样,默认不处理目录。
- `$ rmdir tickets/old` `rmdir` 是专门删目录的命令,但它只删**空**目录。
- `rmdir: tickets/old: Directory not empty` 里面还有文件,拒绝。`rmdir` 的这个「胆小」是好事,它不可能误删一堆文件。
- `$ rm -r tickets/old` `-r` 递归:目录和里面所有东西一起删。这条命令是今天最危险的一条,敲回车之前看清楚路径。
- `$ rmdir projects/demo/src` `src` 是空的,`rmdir` 删得掉。

</div>

`rm` 也有 `-i`,每删一个文件先问一句:

```text
$ cd ~/terminal-practice/notes
$ rm -i day04.md
remove day04.md? n
```

<div class="line-notes">

- `$ rm -i day04.md` 加 `-i`,先问再删。
- `remove day04.md? n` 我回答 `n`,文件留下了。

</div>

关于 `rm -rf`:网上你会经常看到这条命令,`-f` 是 force(强制),意思是「不存在也不报错、只读文件也不问、直接删」。它和 `-r` 合起来就是「不管三七二十一全删掉」。很多事故就是 `rm -rf` 后面的路径写错了一点,比如多了个空格把 `rm -rf ./build` 写成了 `rm -rf ./ build`,删掉的就是整个当前目录。我的建议是:**学这门课期间不要用 `-f`**,让 `rm` 报错拦你一下是好事。

还有一个更安全的选择:不用 `rm`,把东西移到废纸篓。macOS 的废纸篓就是家目录下的隐藏目录 `~/.Trash`,`mv 文件 ~/.Trash/` 就等于在访达里删除。另外我查到 macOS 15 开始自带一个 `trash` 命令,能直接把文件移进废纸篓(这是二手信息,出处是 [Michael Tsai 博客 2025 年 8 月的讨论](https://mjtsai.com/blog/?p=49039),里面引用了系统手册页);我这台是 macOS 14,`ls /usr/bin/trash` 报 `No such file or directory`,确实没有。

最后用通配符删一批。刚才 `archive` 里复制进去了四张工单,删掉它们:

```text
$ echo archive/ticket-*
archive/ticket-001.txt archive/ticket-002.txt archive/ticket-003.txt archive/ticket-004.txt
$ rm archive/ticket-*
$ ls archive
demo
```

<div class="line-notes">

- `$ echo archive/ticket-*` 删之前先预览。**`rm` 加通配符之前必须先 `echo`**,这一条请当成规矩。
- `$ rm archive/ticket-*` 四个一起删掉。
- `demo` 只剩 `demo`。

</div>

## 通配符的坑:匹配不到时 zsh 会报错

如果模式一个都没匹配到会怎样?我在 `terminal-practice` 里找 `.pdf`,一个都没有:

```text
$ echo tickets/*.pdf
zsh:1: no matches found: tickets/*.pdf
```

<div class="line-notes">

- `$ echo tickets/*.pdf` `tickets` 里没有 `.pdf` 文件。
- `zsh:1: no matches found: tickets/*.pdf` zsh 发现没匹配到,**直接报错,命令根本没有运行**。我是用 `zsh -f -c '...'` 单独跑的这一条,所以前缀是 `zsh:1:`(第 1 行),你在终端里敲看到的是 `zsh: no matches found: tickets/*.pdf`。

</div>

这里要知道 zsh 和 bash 的一个区别:同样的命令我用 `bash -c 'echo tickets/*.pdf'` 跑,它打印的是原样的 `tickets/*.pdf`,bash 在匹配不到时把模式原封不动交给命令。你在网上看到的教程很多是按 bash 写的,遇到这种行为不一致就想想这一条。

这个报错最常见的出处根本不是找文件,而是**网址**。网址里经常有 `?`,比如 `https://example.com/search?q=agent`,zsh 会把 `?` 当通配符:

```text
$ echo https://example.com/search?q=agent
zsh:1: no matches found: https://example.com/search?q=agent
$ echo "https://example.com/search?q=agent"
https://example.com/search?q=agent
```

<div class="line-notes">

- `$ echo https://example.com/search?q=agent` 没加引号。
- `zsh:1: no matches found: https://example.com/search?q=agent` zsh 想找一个叫 `https:` 目录下的、名字像 `search` 加一个字符加 `q=agent` 的文件,当然没有。我写这篇时用 `curl` 检查外链,一条带 `?p=` 的网址就是这样报错的。
- `$ echo "https://example.com/search?q=agent"` 加上双引号,引号里的 `*` 和 `?` 不会被展开。

</div>

规矩:**命令里的网址一律加引号**。后面用 `curl` 调接口时这条会天天用到。反过来,你想让通配符生效时就别加引号,`"*.txt"` 只会被当成一个名字叫 `*.txt` 的文件。

## 拼起来:今天的命令一张表

| 想做的事 | 命令 | 最容易踩的坑 |
| --- | --- | --- |
| 建目录 | `mkdir 名字`,多层用 `mkdir -p a/b/c` | 已存在报 `File exists`;上层不存在要 `-p` |
| 建空文件 | `touch 名字` | 文件已存在时只更新时间,不清空内容 |
| 复制文件 | `cp 源 目标` | 目标已存在会被直接覆盖,用 `-i` |
| 复制目录 | `cp -r 源目录 目标` | 不加 `-r` 报 `is a directory (not copied)` |
| 移动 / 改名 | `mv 源 目标` | 目标已存在会被直接覆盖,用 `-i`;移动目录不需要 `-r` |
| 删文件 | `rm 文件` | 不进废纸篓,找不回来 |
| 删空目录 | `rmdir 目录` | 非空报 `Directory not empty` |
| 删目录和里面所有东西 | `rm -r 目录` | 最危险的一条,先确认路径 |
| 选一批文件 | `*` 任意多个字符,`?` 一个字符 | 先 `echo` 预览;zsh 匹配不到就报错;网址要加引号 |

## 动手练习

### 练习 1:整理一个乱糟糟的下载目录

先用下面这几条命令造一个「下载目录」,模拟你的 `~/Downloads`:两张发票 PDF、三个工单、两张名字里带空格的截图、两个笔记。

```text
$ cd ~/terminal-practice
$ mkdir inbox
$ cd inbox
$ touch invoice-2026-09.pdf invoice-2026-10.pdf ticket-101.txt ticket-102.txt ticket-103.txt notes.md old-notes.md
$ touch "screenshot 1.png" "screenshot 2.png"
$ ls
invoice-2026-09.pdf     old-notes.md            ticket-101.txt
invoice-2026-10.pdf     screenshot 1.png        ticket-102.txt
notes.md                screenshot 2.png        ticket-103.txt
```

<div class="line-notes">

- `$ touch invoice-2026-09.pdf invoice-2026-10.pdf ticket-101.txt` 一条命令建七个空文件。
- `$ touch "screenshot 1.png" "screenshot 2.png"` 名字带空格,所以必须加引号,否则会建出 `screenshot`、`1.png`、`2.png` 三个文件。Day 3 讲过空格会把参数切开。
- `notes.md                screenshot 2.png        ticket-103.txt` 九个文件都在。

</div>

任务:在 `inbox` 里建 `invoices`、`tickets`、`images` 三个目录,用通配符把发票、工单、截图分别搬进去,删掉 `old-notes.md`,`notes.md` 留在原地。

<details><summary>参考答案</summary>

```text
$ cd ~/terminal-practice/inbox
$ mkdir invoices tickets images
$ mv invoice-*.pdf invoices/
$ mv ticket-*.txt tickets/
$ mv screenshot*.png images/
$ rm old-notes.md
$ ls
images          invoices        notes.md        tickets
$ ls invoices tickets images
images:
screenshot 1.png        screenshot 2.png

invoices:
invoice-2026-09.pdf     invoice-2026-10.pdf

tickets:
ticket-101.txt  ticket-102.txt  ticket-103.txt
```

<div class="line-notes">

- `$ mkdir invoices tickets images` 一次建三个目录。
- `$ mv invoice-*.pdf invoices/` `invoice-` 开头、`.pdf` 结尾的两个文件。如果你不放心,先 `echo invoice-*.pdf` 看一眼。注意不能写 `invoice*`,那样会把刚建的 `invoices` 目录也匹配进去。我在一个临时目录里试过 `mv invoice* invoices/`,PDF 是搬进去了,但多了一行报错 `mv: rename invoices to invoices/invoices: Invalid argument`,意思是不能把一个目录移进它自己里面。
- `$ mv ticket-*.txt tickets/` 三个工单。同理,写 `ticket*` 会匹配到 `tickets` 目录,所以带上 `-` 和 `.txt`。
- `$ mv screenshot*.png images/` 名字里有空格的文件,用通配符反而不用操心引号:shell 展开出来的每个名字是一个完整的参数,空格不会再切。
- `$ rm old-notes.md` 删一个文件,不需要通配符。
- `$ ls invoices tickets images` `ls` 接好几个目录参数时,会分别打印「目录名:」和它的内容,顺序按名字排。

</div>

</details>

### 练习 2:备份,确认,再删掉备份

把整个 `inbox` 复制一份叫 `inbox-backup`,确认里面东西都在,然后用安全的方式把备份删掉。

<details><summary>参考答案</summary>

```text
$ cd ~/terminal-practice
$ cp -r inbox inbox-backup
$ ls inbox-backup
images          invoices        notes.md        tickets
$ echo inbox-backup/*
inbox-backup/images inbox-backup/invoices inbox-backup/notes.md inbox-backup/tickets
$ rm -r inbox-backup
$ ls
archive         inbox           notes           projects        tickets
```

<div class="line-notes">

- `$ cp -r inbox inbox-backup` 复制目录要 `-r`。
- `$ ls inbox-backup` 四项都在,和原目录一样。
- `$ echo inbox-backup/*` 删之前用 `echo` 看看要删的是哪些。这一步对 `rm -r 一个目录名` 本身不是必需的,但养成习惯,在 `rm` 前面先看一眼。
- `$ rm -r inbox-backup` 删除整个备份。注意是 `inbox-backup`,不是 `inbox`,Tab 补全时尤其要看清补出来的是哪个。
- `archive         inbox           notes           projects        tickets` 备份没了,原件 `inbox` 还在。

</div>

</details>

### 练习 3:目标末尾的 `/` 有什么用

在 `terminal-practice` 里分别运行 `cp notes/package.json backup` 和 `cp notes/package.json backup2/`(这两个名字事先都不存在),观察结果有什么不同,解释为什么。

<details><summary>参考答案</summary>

```text
$ cd ~/terminal-practice
$ cp notes/package.json backup
$ ls -l
total 8
drwxr-xr-x  3 minliu  staff   96 10 22 13:05 archive
-rw-r--r--  1 minliu  staff  456 10 22 13:05 backup
drwxr-xr-x  6 minliu  staff  192 10 22 13:05 inbox
drwxr-xr-x  5 minliu  staff  160 10 22 13:05 notes
drwxr-xr-x  3 minliu  staff   96 10 22 13:05 projects
drwxr-xr-x  3 minliu  staff   96 10 22 13:05 tickets
$ cp notes/package.json backup2/
cp: directory backup2 does not exist
$ mkdir backup2
$ cp notes/package.json backup2/
$ ls backup2
package.json
$ rm backup
$ rm -r backup2
```

<div class="line-notes">

- `$ cp notes/package.json backup` 目标没有 `/`,而且 `backup` 不存在,`cp` 就理解成「复制成一个叫 backup 的文件」。
- `-rw-r--r--  1 minliu  staff  456 10 22 13:05 backup` 开头是 `-`:一个 456 字节、没有扩展名的普通文件。你本来可能想把它放进一个叫 `backup` 的目录,结果得到了一个文件,而且没有任何提示。
- `$ cp notes/package.json backup2/` 目标末尾有 `/`,明确说「这是一个目录」。
- `cp: directory backup2 does not exist` 目录不存在,`cp` 报错,不会自作主张建一个文件。
- `$ mkdir backup2` 先把目录建出来。
- `$ cp notes/package.json backup2/` 这次复制进去了。
- `$ rm backup` 清理掉误建的文件。
- `$ rm -r backup2` 清理掉目录。

</div>

结论:**往目录里复制或移动时,目标末尾加上 `/`**。目录存在时加不加效果一样;目录不存在时,加了会报错提醒你,不加会默默地给你造一个同名文件。

</details>

### 练习 4:观察 `-i` 在通配符批量操作里的表现

在 `notes` 目录里运行 `rm -i *`,对每个问题都回答 `n`。数一数它问了几次,和 `echo *` 打印出来的个数比较。

<details><summary>参考答案</summary>

我用一个模拟终端跑了 `echo *`、`rm -i *`、`ls` 三条,每个问题都回答 `n`:

```text
$ cd ~/terminal-practice/notes
$ echo *
day04.md gitignore-sample.txt package.json
$ rm -i *
remove day04.md? n
remove gitignore-sample.txt? n
remove package.json? n
$ ls
day04.md                gitignore-sample.txt    package.json
```

<div class="line-notes">

- `$ echo *` 先预览:三个名字。
- `$ rm -i *` shell 把 `*` 换成这三个名字,`rm` 收到三个参数。
- `remove day04.md? n` 第一问,答 `n`。
- `remove package.json? n` 一共问了三次,和 `echo *` 的个数一样。
- `day04.md                gitignore-sample.txt    package.json` 全答 `n`,一个都没删。

</div>

道理还是同一条:shell 先把 `*` 展开成三个文件名,`-i` 对每个参数各问一次。所以 `-i` 在批量删除时很啰嗦,但能救命。实际用法是:文件少就 `rm -i`,文件多就先 `echo` 预览,确认后用不带 `-i` 的 `rm`。

</details>

验收标准:不看文章能写出建多层目录、复制目录、改名、批量移动的命令;能说出 `cp`/`mv` 覆盖和 `rm` 不进废纸篓这两个坑,以及各自用什么办法防;能解释为什么 `echo` 能预览通配符;练习 1 到 3 的命令自己敲出来,最后 `ls` 的结果和文中一致。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| `mkdir` / `mkdir -p` | 建目录;`-p` 把缺的上层目录一起建好,已存在也不报错 |
| `touch` | 文件不存在就建一个空的,存在就把修改时间更新成现在 |
| `cp` / `cp -r` | 复制;复制目录要加 `-r` |
| `mv` | 移动;同一目录里移动成另一个名字就是改名 |
| `rm` / `rm -r` / `rmdir` | 删文件 / 删目录及其全部内容 / 只删空目录。都不进废纸篓 |
| 递归(recursive) | 一层层往目录里钻,把里面所有层都处理到。`-r` 选项就是这个意思 |
| `-i`(interactive) | 让 `cp`、`mv`、`rm` 在覆盖或删除前先问你 |
| `-f`(force) | 强制,不提示也不报错。`rm -rf` 是最危险的组合 |
| 覆盖 | 目标位置已经有同名文件时,用新内容替换掉旧的,旧的找不回来 |
| 通配符(glob) | 用 `*`(任意多个字符)、`?`(一个字符)写的文件名模式,由 shell 在命令运行前展开 |
| 展开(expansion) | shell 在执行命令前把 `~`、通配符等替换成实际内容的过程 |
| `echo` | 把收到的参数原样打印出来,用来预览通配符会展开成什么 |
| `~/.Trash` | macOS 废纸篓在磁盘上的位置,`mv` 进去等于在访达里删除 |

## 常见误区

**以为 `rm` 删的东西在废纸篓里。** 不在。`rm` 没有撤销,想留后路就 `mv 文件 ~/.Trash/`。

**`mv` 和 `cp` 覆盖时不提示。** 正文里 456 字节的 `package.json` 被 253 字节的文件一声不响地顶掉了。重要文件操作加 `-i`,或者动手前先 `ls` 看一眼目标位置有没有同名文件。

**通配符写得太宽。** 练习 1 里如果写 `mv invoice* invoices/`,`invoice*` 会把 `invoices` 目录本身也匹配进去。模式尽量带上分隔符和扩展名,比如 `invoice-*.pdf`,并且先 `echo`。

**网址不加引号。** zsh 把 `?` 当通配符,`curl https://...?q=1` 会报 `no matches found`。命令里的网址一律加双引号。

**照着 bash 教程以为匹配不到会原样传下去。** bash 是这样,zsh 默认直接报错不执行。macOS 默认是 zsh,看教程时留意它是按哪个 shell 写的。

**Tab 补全没看清就回车。** `rm -r inbox` 和 `rm -r inbox-backup` 只差几个字母,补全时补到哪一个要看清楚。删除类命令敲完先停一秒,再按回车。

## 学习资料

### 文档与文章

- [MDN 命令行速成课](https://developer.mozilla.org/zh-CN/docs/Learn_web_development/Getting_started/Environment_setup/Command_line):中文,Day 3 读过前半部分,今天读讲创建、复制、移动、删除文件的那几段,还有它对 `rm` 的警告,15 分钟。
- [网道 · Bash 的模式扩展](https://wangdoc.com/bash/expansion):中文,把 `~`、`*`、`?` 这些「扩展」系统讲了一遍,今天读开头的总述和「`?` 字符扩展」「`*` 字符扩展」两节就够,后面的方括号、大括号扩展以后用到再看。它讲的是 bash,zsh 在匹配不到时的行为不一样(正文讲过)。
- [ss64 · cp](https://ss64.com/mac/cp.html)、[mv](https://ss64.com/mac/mv.html)、[rm](https://ss64.com/mac/rm.html)、[mkdir](https://ss64.com/mac/mkdir.html):英文,macOS 版本的选项列表。macOS 的命令和 Linux 上的同名命令选项略有差异,查 macOS 的以这里为准。
- [计算机教育中缺失的一课 · 课程概览与 shell](https://missing-semester-cn.github.io/2020/course-shell/):中文,Day 3 读过「在 shell 中导航」,今天接着读后面提到 `mv`、`cp`、`mkdir` 的那几段。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1fm4y1n7Z4&autoplay=0&high_quality=1" title="每天一个Linux命令-mv" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>Ternurafl · 每天一个Linux命令-mv · 8 分钟。一个视频只讲 mv,移动和改名两种用法都有。视频在 Linux 上演示,和 macOS 用法基本一样。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1j54y1W7vp&autoplay=0&high_quality=1" title="【Linux视频教程】#11 cp命令详解" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>杜远超官方频道 · 【Linux视频教程】#11 cp命令详解 · 10 分钟。讲 cp 的常用选项,里面有些选项(比如保留属性的)今天用不上,知道有就行。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1Ls41167ix&autoplay=0&high_quality=1" title="【作死实录】rm -rf自毁命令" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>数字云糕-lkyear · 【作死实录】rm -rf自毁命令 · 4 分钟。2016 年的老视频,UP 主在一台 Mac 上执行了删除全部文件的命令,看系统是怎么一点点坏掉的。只看,千万别模仿,看完你会对 rm -rf 有敬畏心。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/Z56Jmr9Z34Q" title="Lecture 1: Course Overview + The Shell (2020)" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Missing Semester · Lecture 1: Course Overview + The Shell (2020) · 英文,可开自动字幕。2020 版第一讲,上面那个中文讲义就是它的翻译。和 Day 3 推荐的 2026 版相比,这一讲里对 mv、cp、mkdir 的演示更多,今天看后半段。</figcaption>
</figure>

### 书籍

- William Shotts《The Linux Command Line》第 2 版,No Starch Press,2019(中文版《Linux 命令行大全》,人民邮电出版社)。今天对应第 4 章「操作文件和目录」,通配符、`mkdir`、`cp`、`mv`、`rm` 都在这一章,每个选项列得比这篇全。英文版 PDF 作者在 [linuxcommand.org](https://linuxcommand.org/) 免费提供,第 1 版有[社区中文翻译](https://billie66.github.io/TLCL/)。

### 开源项目与代码

- [ali-rantakari/trash](https://github.com/ali-rantakari/trash):一个把文件移到 macOS 废纸篓的小命令行工具,比 `rm` 多一层后悔药。macOS 15 之前的系统没有自带的 `trash` 命令,很多人用它。今天不用装(装它要用 Homebrew,还没讲),点进去看看 README 里的用法,知道有这种选择。
- [tldr-pages/tldr](https://github.com/tldr-pages/tldr):Day 3 推荐过,今天去看 `cp`、`mv`、`rm` 的中文页,每页只有五六个最常用的例子。

## 自测

1. 你想建 `a/b/c` 三层目录,`a` 还不存在。写出命令。

<details><summary>答案</summary>

`mkdir -p a/b/c`。不加 `-p` 会报 `No such file or directory`。

</details>

2. `mv report.md archive` 这条命令,在 `archive` 存在和不存在时分别会发生什么?

<details><summary>答案</summary>

`archive` 是一个已存在的目录时,`report.md` 被移进去;不存在时,`report.md` 被改名成 `archive`(一个没有扩展名的文件)。想明确表达「移进目录」就写 `archive/`,目录不存在时会报错提醒。

</details>

3. 为什么 `echo *.txt` 能用来预览 `rm *.txt` 会删掉哪些文件?

<details><summary>答案</summary>

因为通配符是 shell 在命令运行之前展开的。`echo` 和 `rm` 收到的参数是同一串文件名,`echo` 只是把它们打印出来而不做事。

</details>

4. 在 zsh 里敲 `curl https://api.example.com/items?page=2` 报 `no matches found`,为什么?怎么改?

<details><summary>答案</summary>

zsh 把网址里的 `?` 当成了通配符,去找匹配的文件,一个都没找到就报错,`curl` 根本没运行。给网址加上双引号:`curl "https://api.example.com/items?page=2"`。

</details>

5. 删除一个非空目录有哪两种方式?哪种更安全?

<details><summary>答案</summary>

一种是 `rm -r 目录`,直接删除目录和里面所有东西,找不回来;另一种是 `mv 目录 ~/.Trash/`,移进废纸篓,后悔了还能拖回来。后者更安全。`rmdir` 只能删空目录,非空会拒绝。

</details>

## 明天预告

Day 5 · 终端(三):管道、重定向和 grep。今天的文件全是空的,因为还不会往文件里写东西。明天学 `>` 和 `>>` 把命令的输出写进文件,学 `|` 把一条命令的输出直接交给下一条命令(比如 `ls | wc -l` 数一个目录里有几个文件),再学 `grep` 在一堆文本里找出包含某个词的行。还是在 `terminal-practice` 里练,会往今天建的 `tickets` 目录里写几张有内容的工单,然后从里面把「计费」类的挑出来。
