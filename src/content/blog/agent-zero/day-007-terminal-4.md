---
title: 'Day 7 · 终端(四):PATH、which 和 shell 配置文件'
description: '你敲 node,终端是去哪找到这个程序的?今天讲 PATH 环境变量和 which,看懂「装了新 Node,node -v 还是旧的」「vite 在 npm run 里能跑、直接敲却 command not found」;再打开 ~/.zshrc,先备份再追加,做一个自己的命令 hello-agent,在哪个目录都能敲。'
pubDate: 2026-10-22
regime: none
tags: ['terminal', 'agent-zero']
series: 'agent-zero'
day: 7
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 6](/blog/agent-zero/day-006-week01-review/) 把第一周串了一遍:默写了从家目录走一圈、建目录搬文件、计费报告三段命令,又只用本周的东西给 9 张工单出了一份周报,`~/terminal-practice/weekly/` 里现在有按类别拆好的三个文件和一份 `report.txt`。那份周报里算占比用的是 `node -e`。

这一周敲过的命令,`ls`、`grep`、`node`,你都只写了一个名字。可 `ls` 是一个程序,`node` 也是一个程序,它们躺在硬盘上的某个目录里。终端怎么知道去哪找?今天就讲这件事。下一周开始装 Python,装完能不能敲出 `python3`,敲出来的是哪一个 `python3`,全靠今天这一课。

## 今天要解决的问题

1. 知道 **PATH** 是什么:一个写着一串目录的环境变量,终端按顺序在这些目录里找你敲的命令名;会用 `echo $PATH` 看它,会用 `which` 和 `which -a` 查一个命令到底是哪个文件。
2. 能解释三个常见现象:`zsh: command not found`、装了新版 Node 但 `node -v` 还是旧的、`vite` 在 `npm run dev` 里能跑但直接敲找不到。
3. 知道 `~/.zshrc` 是什么、什么时候被读,会**先备份再用 `>>` 追加**一行配置,用 `source` 让它立刻生效。
4. 做一个自己的命令 `hello-agent`,放进 `~/bin`,加进 PATH,在任何目录都能直接敲。

预计用时:2 小时。PATH 和 `which` 40 分钟,npm 那段对照 20 分钟,`.zshrc` 30 分钟,剩下的做练习。

前置:[Day 3](/blog/agent-zero/day-003-terminal-1/)(绝对路径、`~`、`node -e`)、[Day 4](/blog/agent-zero/day-004-terminal-2/)(`cp` 备份、`mkdir -p`、`ls -l` 里那串权限)、[Day 5](/blog/agent-zero/day-005-terminal-3/)(`>` 和 `>>` 的区别、管道)。

学法提示:先对照文章逐条敲一遍命令(不复制粘贴)并对照输出;第二天合上文章,把「建 `~/bin`、写 `hello-agent`、加权限、改 `.zshrc`、`source`、`which`」默写成命令敲出来;然后做动手练习,做不出再展开参考答案,看完关掉自己重写一遍。

## 先说清楚我是在哪跑的

和前几天一样,输出是我 2026-10-22 在 2019 款 Intel MacBook Pro(macOS 14、zsh)上用演示家目录真跑的,家目录显示成 `/Users/你`。演示家目录里只有一个空的 `.zshrc`(只写了一行注释)、Day 3 的 `my-app` 和 Day 6 结束时的 `terminal-practice`。

但今天有一点和前几天不一样:`/usr/local/bin`、`/usr/bin` 这些**系统目录是我这台真机器上的**,演示家目录替换不了它们。这台机器用了好几年,`/usr/local/bin` 里装过不少东西,包括一个 2020 年装的老 Node 和一个 Python 3.10。所以你跑同样的命令,`which node` 的结果很可能和我不同。这反而是今天要讲的重点:**同一条命令,在不同的机器上找到的可能是不同的程序**。我会在每个结果后面说清楚「你那边大概会看到什么」。

还有一个小差别:为了把命令和输出原样记下来,我是把命令一条条交给 zsh 执行的,这时 `ls` 的输出没连着屏幕,会一行一个(Day 5 讲过这个规则)。你在终端窗口里敲,同样的内容会排成几列,名字是一样的。

## 命令是怎么被找到的

先看 `ls` 本人在哪:

```text
$ which ls
/bin/ls
$ ls /bin | wc -l
      37
$ ls /bin
[               dd              launchctl       pwd             tcsh
bash            df              link            realpath        test
cat             echo            ln              rm              unlink
chmod           ed              ls              rmdir           wait4path
cp              expr            mkdir           sh              zsh
csh             hostname        mv              sleep
dash            kill            pax             stty
date            ksh             ps              sync
```

<div class="line-notes">

- `$ which ls` `which` 是今天的主角:告诉你敲 `ls` 时实际运行的是哪个文件。
- `/bin/ls` 一个绝对路径。`ls` 就是 `/bin` 目录里一个叫 `ls` 的文件,和你项目里的 `package.json` 一样是个普通文件,只不过它是能运行的程序。
- `$ ls /bin | wc -l` Day 5 的老组合,数 `/bin` 里有几样东西。
- `      37` macOS 14 的 `/bin` 里有 37 个。
- `cat             echo            ln` 这一周用过的 `cat`、`cp`、`ls`、`mkdir`、`mv`、`rm`、`rmdir` 都在这里。`zsh` 和 `bash` 也在,shell 本身也是一个程序。这一行里还有一个 `echo`,下面会看到,你敲 `echo` 时用的其实不是它。

</div>

你敲 `ls` 回车,shell 拿着 `ls` 这个名字,去一串目录里挨个找有没有叫 `ls` 的可运行文件,找到第一个就运行它。这一串目录写在一个叫 **PATH** 的变量里。

```text
$ echo $PATH
/usr/local/bin:/System/Cryptexes/App/usr/bin:/usr/bin:/bin:/usr/sbin:/sbin:/var/run/com.apple.security.cryptexd/codex.system/bootstrap/usr/local/bin:/var/run/com.apple.security.cryptexd/codex.system/bootstrap/usr/bin:/var/run/com.apple.security.cryptexd/codex.system/bootstrap/usr/appleinternal/bin:/Library/Apple/usr/bin
$ echo $PATH | tr ':' '\n'
/usr/local/bin
/System/Cryptexes/App/usr/bin
/usr/bin
/bin
/usr/sbin
/sbin
/var/run/com.apple.security.cryptexd/codex.system/bootstrap/usr/local/bin
/var/run/com.apple.security.cryptexd/codex.system/bootstrap/usr/bin
/var/run/com.apple.security.cryptexd/codex.system/bootstrap/usr/appleinternal/bin
/Library/Apple/usr/bin
```

<div class="line-notes">

- `$ echo $PATH` 变量名前面加 `$`,shell 会先把它换成变量的值,再交给 `echo` 打印。这和 Day 3 的 `~`、Day 4 的通配符一样,是 shell 在命令运行前做的替换。
- `/usr/local/bin:/System/Cryptexes/App/usr/bin:/usr/bin:/bin:` 一长串目录,用冒号 `:` 隔开。这是一台 macOS 14 的终端新开窗口时的默认值,`.zshrc` 里什么都没写的情况下就是这样。
- `$ echo $PATH | tr ':' '\n'` 一行太长不好读。`tr` 是一个小工具,把第一个参数里的字符换成第二个参数里的字符,这里把每个冒号换成换行(`\n`)。今天只用它这一个用法。
- `/usr/local/bin` 第一个目录。你自己装的命令行工具(Node 官方安装包、Homebrew 在 Intel Mac 上)默认放这里,所以它排在系统目录前面。
- `/usr/bin` 系统自带的大部分命令,`git`、`grep`、`python3` 都在这。
- `/bin` 最基本的那 37 个。
- `/usr/sbin` `sbin` 是放系统管理命令的,平时用不上。
- `/var/run/com.apple.security.cryptexd/codex.system/bootstrap/usr/local/bin` 后面这几个长得很怪的是 macOS 自己的内部目录,不用管。

</div>

**环境变量**(environment variable)就是「每个程序启动时都会从父进程那里拿到一份的一组名字和值」。PATH 是其中一个,还有 HOME(家目录)、USER(用户名)等。你在 Node 里见过它们:

```text
$ echo $HOME
/Users/你
$ node -e "console.log(process.env.PATH)"
/usr/local/bin:/System/Cryptexes/App/usr/bin:/usr/bin:/bin:/usr/sbin:/sbin:/var/run/com.apple.security.cryptexd/codex.system/bootstrap/usr/local/bin:/var/run/com.apple.security.cryptexd/codex.system/bootstrap/usr/bin:/var/run/com.apple.security.cryptexd/codex.system/bootstrap/usr/appleinternal/bin:/Library/Apple/usr/bin
$ node -e "console.log(process.env.HOME)"
/Users/你
```

<div class="line-notes">

- `$ echo $HOME` HOME 存的就是家目录。Day 3 说 `~` 会被 shell 换成家目录,换成的值就是从这里来的。
- `$ node -e "console.log(process.env.PATH)"` 你写前端时用过 `process.env.NODE_ENV`、`process.env.VITE_API_URL`,`process.env` 就是 Node 进程拿到的那份环境变量。
- `/usr/local/bin:/System/Cryptexes/App/usr/bin:/usr/bin:/bin:` 和 shell 里 `echo $PATH` 一字不差。Node 是从这个终端启动的,终端把自己的环境变量整份传给了它,就像 Day 3 里 Node 继承了终端的工作目录一样。

</div>

<figure>
<svg viewBox="0 0 640 270" role="img" aria-label="敲 node 回车后,shell 按 PATH 里目录的顺序逐个查找,找到第一个就运行,后面的不再看">
<rect x="0" y="0" width="640" height="270" fill="var(--paper-raised)" rx="6"/>
<g font-family="var(--font-mono)" font-size="12">
<rect x="20" y="20" width="110" height="34" rx="5" fill="var(--paper)" stroke="var(--rule)"/>
<text x="75" y="42" text-anchor="middle" fill="var(--ink)">$ node -v</text>
<line x1="130" y1="37" x2="160" y2="37" stroke="var(--ink-soft)"/><polygon points="160,32 170,37 160,42" fill="var(--ink-soft)"/>
<text x="178" y="42" fill="var(--ink-soft)">shell 按 PATH 顺序一个个目录找「node」</text>
<rect x="40" y="76" width="300" height="32" rx="5" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="52" y="97" fill="var(--ink)">① ~/.nvm/versions/node/v24.22.0/bin</text>
<text x="352" y="97" fill="var(--compute)">有 node → 运行它,停</text>
<rect x="40" y="118" width="300" height="32" rx="5" fill="var(--paper)" stroke="var(--rule)"/>
<text x="52" y="139" fill="var(--ink-faint)">② /usr/local/bin</text>
<text x="352" y="139" fill="var(--ink-faint)">也有 node(v12),但轮不到</text>
<rect x="40" y="160" width="300" height="32" rx="5" fill="var(--paper)" stroke="var(--rule)"/>
<text x="52" y="181" fill="var(--ink-faint)">③ /usr/bin  ④ /bin  ……</text>
<text x="352" y="181" fill="var(--ink-faint)">不再看</text>
<line x1="20" y1="210" x2="620" y2="210" stroke="var(--rule)"/>
<text x="20" y="234" fill="var(--ink)">所有目录都没有 → zsh: command not found: node</text>
<text x="20" y="256" fill="var(--ink-soft)">which -a node 列出所有找得到的;which node 只给第一个,也就是真正会运行的那个</text>
</g>
</svg>
<figcaption>PATH 查找:按顺序找,第一个命中的胜出。改 PATH 的顺序,就能改变 <code>node</code> 指的是哪一个。</figcaption>
</figure>

## which:这个命令到底是哪个文件

```text
$ which node
/usr/local/bin/node
$ which python3
/usr/local/bin/python3
$ which -a python3
/usr/local/bin/python3
/usr/bin/python3
$ python3 --version
Python 3.10.0
$ /usr/bin/python3 --version
Python 3.8.2
$ ls -l /usr/local/bin/python3
lrwxr-xr-x  1 root  wheel  70 11  5  2021 /usr/local/bin/python3 -> ../../../Library/Frameworks/Python.framework/Versions/3.10/bin/python3
```

<div class="line-notes">

- `$ which node` 在默认 PATH 下,`node` 是哪个。
- `/usr/local/bin/node` 我这台机器上是 `/usr/local/bin` 里那个。你要是用 Node 官方安装包装的 Node,也会是这个路径;用 nvm 装的,而且 `.zshrc` 里已经配好了,会是 `/Users/你/.nvm/versions/node/某个版本/bin/node`;用 Homebrew 装的,Intel Mac 上是 `/usr/local/bin/node`,Apple 芯片 Mac 上是 `/opt/homebrew/bin/node`。
- `$ which python3` 同样问 `python3`。
- `/usr/local/bin/python3` 我机器上 PATH 第一个目录里就有一个。全新的 Mac 上这里没有,你会看到 `/usr/bin/python3`。
- `$ which -a python3` `-a`(all):不止给第一个,把 PATH 里**所有**能找到的都列出来,排在前面的就是会运行的那个。
- `/usr/bin/python3` 第二个,被第一个挡住了。
- `Python 3.10.0` 直接敲 `python3`,跑的是第一个,3.10。
- `$ /usr/bin/python3 --version` **写出完整路径,就不经过 PATH 查找**,指哪个跑哪个。
- `Python 3.8.2` 苹果自带的那个,版本老得多。它其实是苹果「命令行开发者工具」(Command Line Tools)的一部分,你装 git 的时候顺带装上了,版本取决于你装的工具版本,新一点的机器上是 3.9.x。
- `lrwxr-xr-x  1 root  wheel  70 11  5  2021 /usr/local/bin/python3 -> ../../../Library/Frameworks/Python.framework/Versions/3.10/bin/python3` 第一个字母是 `l`,不是 Day 3 见过的 `-`(文件)或 `d`(目录),而是 **link**,符号链接,相当于访达里的「替身」。箭头后面是它真正指向的文件。这个 `Python.framework` 是 2021 年我用 python.org 官方安装包装 Python 3.10 时留下的。明天装 Python 你会看到同样的结构。

</div>

一台机器上同时有两个、三个 Python 是常态,不是事故。要紧的是你每次都知道自己用的是哪一个。以后遇到「我明明装了某个包,运行时却说找不到」,第一件事就是 `which python3`,十有八九是装进了一个 Python、运行的是另一个。

再看三种特殊情况:

```text
$ which cd
cd: shell built-in command
$ which echo pwd
echo: shell built-in command
pwd: shell built-in command
$ which python
python not found
$ python
zsh: command not found: python
```

<div class="line-notes">

- `$ which cd` `cd` 不在任何目录里。
- `cd: shell built-in command` 它是 shell **内置**的命令,写在 zsh 程序自己身上,不用去 PATH 里找。`cd` 必须是内置的:它要改的是 shell 自己的工作目录,一个外部程序改不了启动它的那个 shell。
- `$ which echo pwd` 一次问两个。
- `echo: shell built-in command` `/bin` 里明明有个 `echo`,但 zsh 自己也内置了一个,**内置的优先**,根本轮不到去 PATH 里找。这对你没有影响,两个用法一样。
- `$ which python` macOS 上没有叫 `python` 的命令,只有 `python3`。
- `python not found` `which` 找遍 PATH 也没有。
- `zsh: command not found: python` 直接敲就是这句报错。网上很多教程写 `python xxx.py`,那是 Windows 或者装了别的东西的机器,在 macOS 上一律写 `python3`。

</div>

`zsh: command not found: xxx` 的意思只有一个:**PATH 里的每个目录都找过了,没有叫这个名字的可运行文件**。可能是没装,可能是名字敲错了,也可能是装了但装进的目录不在 PATH 里。最后这种情况最折腾人,下面就有一个。

## 前端对照:node_modules/.bin 和 npm 全局命令

你每天都在用 PATH,只是 npm 替你藏起来了。回到 Day 3 那个 Vite 项目:

```text
$ cd ~/Documents/my-app
$ vite --version
zsh: command not found: vite
$ ls node_modules/.bin
nanoid
oxlint
rolldown
vite
$ ./node_modules/.bin/vite --version
(node:54212) ExperimentalWarning: The ESM module loader is experimental.
file:///Users/你/Documents/my-app/node_modules/vite/bin/vite.js:53
    module.enableCompileCache?.()
                              ^

SyntaxError: Unexpected token '.'
    at Loader.moduleStrategy (internal/modules/esm/translators.js:88:18)
    at async link (internal/modules/esm/module_job.js:41:21)
```

<div class="line-notes">

- `$ vite --version` `package.json` 的 `scripts` 里写的就是 `"dev": "vite"`,那直接敲 `vite` 呢?
- `zsh: command not found: vite` 找不到。`vite` 装在项目的 `node_modules/.bin` 里,这个目录不在 PATH 里。
- `$ ls node_modules/.bin` `.bin` 是 Day 3 提过的那个隐藏目录,npm 把每个包提供的命令都放在这里。
- `vite` 找到了,就在这。
- `$ ./node_modules/.bin/vite --version` 写出路径直接运行,绕过 PATH。`./` 开头表示当前目录下的相对路径;**只要命令名里带 `/`,shell 就不去 PATH 里找**,直接按路径运行。
- `(node:54212) ExperimentalWarning: The ESM module loader is experimental.` 跑起来了,但冒出一个奇怪的警告,紧接着报错。
- `module.enableCompileCache?.()` 报错指着 Vite 源码第 53 行的 `?.()`,也就是可选链调用。
- `SyntaxError: Unexpected token '.'` 这台机器上的 Node 不认识 `?.` 语法。可选链是 Node 14 才支持的,而上一节 `which node` 找到的是 `/usr/local/bin/node`,版本是 v12.18.2。**Vite 8 是被一个太老的 Node 运行的。**

</div>

这个报错我没有故意制造,它是这台机器真实的样子:我早年用安装包装过 Node 12,后来改用 nvm 管理 Node,新版本装在 `~/.nvm` 里。但我这个演示家目录的 `.zshrc` 是空的,没有告诉 shell 去 `~/.nvm` 找 Node,于是 PATH 里第一个 `node` 就是那个 v12。真实的项目里,这类「代码没问题,是跑代码的 Node 版本不对」的报错,前端同学大概都见过。

### nvm 的那两行,和 .zshrc

nvm 是管理多个 Node 版本的工具,它的安装脚本会往你的 `~/.zshrc` 里写几行。我把这几行加进演示家目录的 `.zshrc`,看看会发生什么。你自己的机器**不要照抄这一段**,除非你确实用 nvm 装过 Node:这里是在演示我的问题,你自己动手的部分在后面的 `hello-agent`。

先认识今天第二个新概念:**`~/.zshrc`** 是 zsh 的配置文件。每次你打开一个新的终端窗口(或新标签页),zsh 启动时会把它从头到尾执行一遍,就像网页每次加载都会执行一遍 `<script>` 里的代码。你想让每个新窗口都有的设置,比如 PATH 里多一个目录,就写在这里。名字以 `.` 开头,所以 Day 3 里要 `ls -a` 才看得见它;`rc` 是 run commands 的缩写,很多工具的配置文件都叫 `.xxxrc`,比如你见过的 `.npmrc`、`.prettierrc`。

```text
$ cd ~
$ node -v
v12.18.2
$ ls ~/.nvm/versions/node
v16.14.0
v22.21.1
v24.22.0
$ cat ~/.zshrc
# 我的 zsh 配置,现在还什么都没写
$ cp ~/.zshrc ~/.zshrc.bak
$ echo 'export NVM_DIR="$HOME/.nvm"' >> ~/.zshrc
$ echo '[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"' >> ~/.zshrc
$ cat ~/.zshrc
# 我的 zsh 配置,现在还什么都没写
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
$ node -v
v12.18.2
$ source ~/.zshrc
$ node -v
v24.22.0
$ which -a node
/Users/你/.nvm/versions/node/v24.22.0/bin/node
/usr/local/bin/node
$ echo $PATH | tr ':' '\n' | head -3
/Users/你/.nvm/versions/node/v24.22.0/bin
/usr/local/bin
/System/Cryptexes/App/usr/bin
```

<div class="line-notes">

- `$ node -v` 改之前:v12。
- `$ ls ~/.nvm/versions/node` nvm 装过的三个版本都在硬盘上,只是 shell 不知道去这里找。
- `$ cat ~/.zshrc` 改之前先看一眼里面有什么。你自己的 `.zshrc` 可能已经有几十行了(装 nvm、Homebrew、oh-my-zsh 时写进去的),那更要看。
- `$ cp ~/.zshrc ~/.zshrc.bak` **改配置文件之前先备份**,Day 4 学的招。改坏了 `cp ~/.zshrc.bak ~/.zshrc` 就能恢复。
- `$ echo 'export NVM_DIR="$HOME/.nvm"' >> ~/.zshrc` 用 `>>` 追加一行。**这里写成一个 `>` 就把整个 `.zshrc` 清空了**,原来的配置全没。Day 5 那个坑,在这里的代价最大。<br>外面用单引号:单引号里的 `$HOME` 不会被替换,原样写进文件;等 `.zshrc` 被执行时才替换。要是用双引号,写进文件的就是 `/Users/你/.nvm` 这个写死的路径。这一行的意思是定义一个叫 `NVM_DIR` 的变量,`export` 表示把它也传给以后启动的程序。
- `$ echo '[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"' >> ~/.zshrc` nvm 官方让你加的第二行,意思是「如果 `nvm.sh` 这个文件存在而且不是空的,就执行它」。`nvm.sh` 执行时会把它的 Node 目录加到 PATH 最前面。这一行的语法今天不用懂,知道它在做什么就行。
- `$ node -v` 文件改了,但**当前这个窗口不会自动重新读它**,还是 v12。`.zshrc` 只在 shell 启动的时候读一次。
- `$ source ~/.zshrc` `source` 是 zsh 的内置命令:在**当前**这个 shell 里把文件执行一遍。另一个办法是关掉窗口重开一个。
- `v24.22.0` 变了。
- `/Users/你/.nvm/versions/node/v24.22.0/bin/node` `which -a` 列出两个,nvm 的排在前面,所以它赢。`/usr/local/bin/node` 还在,只是轮不到了。
- `/Users/你/.nvm/versions/node/v24.22.0/bin` PATH 最前面多了一个目录,就是 `nvm.sh` 加的。

</div>

再回到 `my-app` 试一次:

```text
$ cd ~/Documents/my-app
$ npx vite --version
vite/8.3.5 darwin-x64 node-v24.22.0
$ npm pkg set scripts.where="which vite"
$ npm run where

> my-app@0.0.0 where
> which vite

/Users/你/Documents/my-app/node_modules/.bin/vite
$ npm pkg delete scripts.where
```

<div class="line-notes">

- `$ npx vite --version` `npx` 会先去当前项目的 `node_modules/.bin` 里找命令,所以不用写完整路径。
- `vite/8.3.5 darwin-x64 node-v24.22.0` 这次跑通了,最后一段说明它是被 Node 24 运行的。`package.json` 里写的是 `^8.3.4`,实际装上的是 8.3.5,`^` 允许装更新的小版本。
- `$ npm pkg set scripts.where="which vite"` 临时往 `package.json` 的 `scripts` 里加一个叫 `where` 的脚本,内容是 `which vite`。`npm pkg` 是专门改 `package.json` 字段的命令,省得开编辑器。
- `$ npm run where` 用 `npm run` 跑它。
- `/Users/你/Documents/my-app/node_modules/.bin/vite` 同样是 `which vite`,在终端里直接敲找不到,在 `npm run` 里却找到了。原因是 **`npm run` 在执行脚本之前,把项目的 `node_modules/.bin` 加到了 PATH 前面**(npm 文档 `npm run` 那一页写着这条规则)。这就是 `"dev": "vite"` 能跑的全部秘密。
- `$ npm pkg delete scripts.where` 把临时加的脚本删掉,`package.json` 恢复原样。

</div>

npm 的**全局命令**是另一种做法。`npm install -g` 装的东西放在 npm 的全局目录里,而那个目录的 `bin` 恰好在 PATH 上:

```text
$ npm prefix -g
/Users/你/.nvm/versions/node/v24.22.0
$ ls -l /usr/local/bin/npm
lrwxr-xr-x  1 minliu  wheel  38  7 13  2020 /usr/local/bin/npm -> ../lib/node_modules/npm/bin/npm-cli.js
$ head -1 /usr/local/lib/node_modules/npm/bin/npm-cli.js
#!/usr/bin/env node
```

<div class="line-notes">

- `$ npm prefix -g` npm 的全局目录。用 nvm 时,每个 Node 版本有自己的一份,这也是为什么切了 Node 版本以后,以前 `-g` 装的命令会「消失」。
- `/Users/你/.nvm/versions/node/v24.22.0` 全局命令放在它下面的 `bin` 里,也就是 PATH 最前面那个目录。你 `npm install -g` 一个工具,它就会出现在那里,所以马上能敲。
- `$ ls -l /usr/local/bin/npm` 再看 Node 12 那一套里的 `npm`,它是怎么做成一个「命令」的。
- `lrwxr-xr-x  1 minliu  wheel  38  7 13  2020 /usr/local/bin/npm -> ../lib/node_modules/npm/bin/npm-cli.js` 又是一个符号链接:`/usr/local/bin` 里的 `npm` 只是个替身,真身是一个 `.js` 文件。
- `$ head -1 /usr/local/lib/node_modules/npm/bin/npm-cli.js` 看那个 `.js` 文件的第一行。
- `#!/usr/bin/env node` 这一行叫 **shebang**(读作 she-bang,`#!` 两个字符的俗称)。系统运行一个文本文件时,看到第一行是 `#!`,就用后面写的程序去执行它。`/usr/bin/env node` 的意思是「去 PATH 里找 `node`,用它来执行我」。所以 `npm` 用哪个 Node 跑,也是 PATH 说了算。

</div>

一个命令行工具,说穿了就是三件事:一个第一行写着 `#!` 的脚本文件、它有「可执行」权限、它所在的目录在 PATH 里。下面我们自己做一个。

## 拼起来:做一个自己的命令 hello-agent

这一段你要自己动手做。目标:建 `~/bin` 目录,在里面放一个 Node 脚本 `hello-agent`,让它在任何目录下都能直接敲。

```text
$ mkdir -p ~/bin
$ echo '#!/usr/bin/env node' > ~/bin/hello-agent
$ echo 'console.log("hello agent, node " + process.version)' >> ~/bin/hello-agent
$ cat ~/bin/hello-agent
#!/usr/bin/env node
console.log("hello agent, node " + process.version)
$ hello-agent
zsh: command not found: hello-agent
$ ~/bin/hello-agent
zsh: permission denied: /Users/你/bin/hello-agent
$ ls -l ~/bin/hello-agent
-rw-r--r--  1 minliu  staff  72 10 22 13:41 /Users/你/bin/hello-agent
$ chmod +x ~/bin/hello-agent
$ ls -l ~/bin/hello-agent
-rwxr-xr-x  1 minliu  staff  72 10 22 13:41 /Users/你/bin/hello-agent
$ ~/bin/hello-agent
hello agent, node v24.22.0
```

<div class="line-notes">

- `$ mkdir -p ~/bin` 在家目录下建一个 `bin`,专门放自己写的小命令。叫 `bin` 是惯例(binary 的缩写,历史上放编译好的程序),很多人的家目录里都有一个。
- `$ echo '#!/usr/bin/env node' > ~/bin/hello-agent` 第一行 shebang,新文件用 `>`。必须用单引号:zsh 里双引号中的 `!` 会被当成「历史命令」的特殊符号,惹出莫名其妙的报错。没有扩展名也没关系,系统看的是第一行,不是名字。
- `$ echo 'console.log("hello agent, node " + process.version)' >> ~/bin/hello-agent` 第二行是一句普通的 JS,用 `>>` 追加。外面单引号,里面 JS 的字符串用双引号,不会打架。
- `$ hello-agent` 直接敲名字。
- `zsh: command not found: hello-agent` `~/bin` 还不在 PATH 里,预料之中。
- `$ ~/bin/hello-agent` 用路径运行,绕过 PATH。
- `zsh: permission denied: /Users/你/bin/hello-agent` 权限被拒绝。文件找到了,但不让运行。
- `-rw-r--r--  1 minliu  staff  72 10 22 13:41 /Users/你/bin/hello-agent` Day 3 说过权限那九个字符以后再讲,现在讲一点点:`rw-` 是你自己能读(r)、能写(w),第三位是 `-`,意思是**不能执行**(x)。`echo` 写出来的文件默认都是这样。
- `$ chmod +x ~/bin/hello-agent` `chmod` 是 change mode,改权限;`+x` 是加上「可执行」。
- `-rwxr-xr-x  1 minliu  staff  72 10 22 13:41 /Users/你/bin/hello-agent` 三组里都多了 `x`。和 `/bin/ls` 的权限一样了。
- `hello agent, node v24.22.0` 跑起来了。系统读到 shebang,用 PATH 里的 `node` 执行了第二行。

</div>

能用路径运行了,最后一步是让 `hello-agent` 三个字就够。先演示一个**一定会有人犯**的错:

```text
$ cd ~/terminal-practice
$ hello-agent
zsh: command not found: hello-agent
$ export PATH=~/bin
$ hello-agent
env: node: No such file or directory
$ ls
zsh: command not found: ls
$ which ls
ls not found
$ /bin/ls
archive
hello.txt
inbox
notes
projects
tickets
tickets.txt
weekly
```

<div class="line-notes">

- `$ cd ~/terminal-practice` 换到别的目录,证明我们要的是「在哪都能敲」。
- `$ export PATH=~/bin` 想把 `~/bin` 加进 PATH,结果写成了**把 PATH 整个换成** `~/bin`。`export 名字=值` 是给环境变量赋值,等号两边不能有空格。
- `$ hello-agent` 这回 `hello-agent` 找到了(它就在 `~/bin` 里)。
- `env: node: No such file or directory` 但 shebang 里的 `/usr/bin/env node` 要去 PATH 里找 `node`,而 PATH 里现在只剩 `~/bin`,哪来的 `node`。
- `zsh: command not found: ls` 连 `ls` 都没了。`/bin` 已经不在 PATH 里。
- `$ /bin/ls` 用完整路径还能救急。(输出一行一个,是因为我这段是交给 zsh 当脚本跑的,`ls` 没连着屏幕,Day 5 讲过;你在终端里敲是多列。)这时候最简单的修法是**关掉这个窗口,开一个新的**:`export` 只影响当前这个 shell,新窗口会重新读 `.zshrc`,PATH 恢复正常。

</div>

`export` 写在命令行里只管当前窗口,关了就没了,所以敲错了不要紧。可要是把这行写进了 `.zshrc`,每个新窗口都会坏,那时就得用 `/bin/cp ~/.zshrc.bak ~/.zshrc` 恢复备份(注意 `cp` 也得写全路径)。这就是备份的意义。

正确的写法是**在原来的 PATH 前面加上新目录**,并且写进 `.zshrc`。下面这段是我关掉坏窗口、开了新窗口之后接着做的:

```text
$ echo $PATH | tr ':' '\n' | head -3
/Users/你/.nvm/versions/node/v24.22.0/bin
/usr/local/bin
/System/Cryptexes/App/usr/bin
$ echo 'export PATH="$HOME/bin:$PATH"' >> ~/.zshrc
$ tail -3 ~/.zshrc
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
export PATH="$HOME/bin:$PATH"
$ source ~/.zshrc
$ which hello-agent
/Users/你/bin/hello-agent
$ cd ~/terminal-practice
$ hello-agent
hello agent, node v24.22.0
$ echo $PATH | tr ':' '\n' | head -3
/Users/你/bin
/Users/你/.nvm/versions/node/v24.22.0/bin
/usr/local/bin
```

<div class="line-notes">

- `$ echo $PATH | tr ':' '\n' | head -3` 新窗口,PATH 恢复了(新窗口读了 `.zshrc`,nvm 的目录在最前面)。三段管道:打印、换行、只看前 3 行。
- `$ echo 'export PATH="$HOME/bin:$PATH"' >> ~/.zshrc` 关键是等号右边:`$HOME/bin` + 冒号 + **原来的 `$PATH`**。用 JS 说就是 `PATH = HOME + '/bin:' + PATH`,在字符串前面拼一段,而不是整个替换。还是 `>>`,还是外层单引号。
- `$ tail -3 ~/.zshrc` 看最后 3 行确认追加成功。Day 5 学的 `tail`。
- `$ source ~/.zshrc` 让当前窗口立即生效。
- `/Users/你/bin/hello-agent` `which` 找到了。
- `$ hello-agent` 在 `terminal-practice` 里,只敲名字。
- `hello agent, node v24.22.0` 成功。
- `/Users/你/bin` 现在 PATH 第一个是 `~/bin`。为什么放最前面?你自己写的命令通常希望优先。代价是练习 3 会演示的:放在最前面的目录,能「冒充」后面目录里的任何命令。

</div>

如果你用的不是 nvm,你的 PATH 前三个会是 `/Users/你/bin`、`/usr/local/bin`、`/System/Cryptexes/App/usr/bin`,`hello-agent` 打印的是你自己那个 Node 的版本号。只要最后一行打印出来了,就是对的。

| 今天的零件 | 在上面哪一步 |
| --- | --- |
| PATH 是一串用冒号隔开的目录 | `echo $PATH \| tr ':' '\n'` |
| 按顺序找、第一个胜出 | `which -a node` 两个结果,nvm 的在前 |
| 带 `/` 的命令名不查 PATH | `~/bin/hello-agent`、`/bin/ls` |
| shebang | `hello-agent` 的第一行 |
| 可执行权限 | `chmod +x` |
| `.zshrc` 每个新窗口执行一次 | 改完不生效,`source` 或开新窗口 |
| 追加而不是替换 | `$HOME/bin:$PATH`;`>>` 而不是 `>` |

### .zshrc、.zprofile 和 .bashrc

网上的教程里你还会看到另外几个文件,简单分一下:

- `~/.zprofile`:zsh 作为**登录 shell** 启动时读,比 `.zshrc` 先读。macOS 的「终端」App 每个新窗口都是登录 shell,所以两个都会读。python.org 的 Python 安装包会往这里写 PATH,我机器上就有这么一段,是 2021 年装 Python 3.10 时安装包自动加的:

```text
# Setting PATH for Python 3.10
# The original version is saved in .zprofile.pysave
PATH="/Library/Frameworks/Python.framework/Versions/3.10/bin:${PATH}"
export PATH
```

<div class="line-notes">

- `# Setting PATH for Python 3.10` `#` 开头是注释,shell 不执行。安装包写清了是谁加的。
- `# The original version is saved in .zprofile.pysave` 它改之前先把原文件备份成 `.zprofile.pysave`,和我们刚才 `cp ~/.zshrc ~/.zshrc.bak` 是同一个思路。
- `PATH="/Library/Frameworks/Python.framework/Versions/3.10/bin:${PATH}"` 同样是「新目录 + 冒号 + 原来的 PATH」。`${PATH}` 和 `$PATH` 一个意思,花括号只是把变量名框清楚。
- `export PATH` 先赋值、再单独 `export`,和我们一行写完效果一样。

</div>

- `~/.bashrc`、`~/.bash_profile`:bash 的配置文件。macOS 从 2019 年的 Catalina 起默认 shell 换成了 zsh,这两个文件 zsh 不读。照着老教程往 `.bashrc` 里加东西,然后发现「怎么不生效」,原因就在这。

自己加 PATH,写 `.zshrc` 就够了。

## 动手练习

### 练习 1:常用命令都住在哪

用 `which` 查出 `git`、`grep`、`npm`、`npx` 分别是哪个文件,`echo` 和 `pwd` 是什么。说说哪些是 macOS 自带的,哪些是你装 Node 时装上的。

<details><summary>参考答案</summary>

```text
$ which -a git
/usr/bin/git
$ which -a grep
/usr/bin/grep
$ which npm npx
/Users/你/.nvm/versions/node/v24.22.0/bin/npm
/Users/你/.nvm/versions/node/v24.22.0/bin/npx
$ which echo pwd
echo: shell built-in command
pwd: shell built-in command
```

<div class="line-notes">

- `/usr/bin/git` `git` 和 `grep` 在 `/usr/bin`,是系统自带的(`git` 准确地说是苹果命令行开发者工具带的)。你要是用 Homebrew 装过新版 git,`which -a git` 会列出两个,排第一的是 `/usr/local/bin/git` 或 `/opt/homebrew/bin/git`。
- `$ which npm npx` `which` 可以一次接好几个参数。
- `/Users/你/.nvm/versions/node/v24.22.0/bin/npm` `npm`、`npx` 和 `node` 住在同一个目录,它们是一起装的。你那边如果是官方安装包,就是 `/usr/local/bin/npm`。
- `echo: shell built-in command` `echo` 和 `pwd` 是 zsh 内置的。

</div>

</details>

### 练习 2:一个在哪都能用的 tickets-count

在 `~/bin` 里用你的编辑器(VS Code、Zed 都行)新建一个文件 `tickets-count`,写一个 Node 脚本:读 `~/terminal-practice/tickets.txt`,打印「计费 N 张 / 共 M 张」。加上可执行权限,在 `~/terminal-practice` 和 `~/Documents` 两个目录里各跑一次,都要成功。

提示:Day 3 讲过,代码里的相对路径相对的是运行时的工作目录,`~` 在代码里也不认。

<details><summary>参考答案</summary>

```js
#!/usr/bin/env node
// ~/bin/tickets-count
const fs = require('fs');
const file = process.env.HOME + '/terminal-practice/tickets.txt';
const lines = fs.readFileSync(file, 'utf8').trim().split('\n');
const billing = lines.filter((line) => line.includes('计费'));
console.log(`计费 ${billing.length} 张 / 共 ${lines.length} 张`);
```

<div class="line-notes">

- `#!/usr/bin/env node` 必须是文件的第一行,前面不能有空行或注释。
- `const fs = require('fs');` 没有 `.mjs` 扩展名、`package.json` 里也没说是 ES module,Node 就按 CommonJS 跑,用 `require`。
- `const file = process.env.HOME + '/terminal-practice/tickets.txt';` 用环境变量 HOME 拼出绝对路径 `/Users/你/terminal-practice/tickets.txt`。不能写 `'~/terminal-practice/tickets.txt'`,Node 不认 `~`;也不能写 `'tickets.txt'`,那样只有站在 `terminal-practice` 里才读得到。
- `.trim().split('\n')` 先去掉文件末尾的换行,再按行切成数组,9 个元素。不 `trim` 的话最后会多一个空字符串,总数变成 10。
- `lines.filter((line) => line.includes('计费'))` 相当于 `grep 计费`。
- `console.log(` 模板字符串打印结果。

</div>

```text
$ chmod +x ~/bin/tickets-count
$ cd ~/terminal-practice
$ tickets-count
计费 5 张 / 共 9 张
$ cd ~/Documents
$ tickets-count
计费 5 张 / 共 9 张
```

<div class="line-notes">

- `$ chmod +x ~/bin/tickets-count` 编辑器新建的文件也没有 `x` 权限,要自己加。
- `计费 5 张 / 共 9 张` 和 Day 6 周报里的数一致。
- `$ cd ~/Documents` 换一个完全不相干的目录。
- `计费 5 张 / 共 9 张` 照样成功,因为路径是绝对的。

</div>

我还写了一个用相对路径 `fs.readFileSync('tickets.txt', 'utf8')` 的版本 `tickets-count-bad` 对比。它在 `~/terminal-practice` 里打印 `9`,到了 `~/Documents` 就报错:

```text
$ tickets-count-bad
node:fs:483
    return binding.readFileUtf8(path, stringToFlags(options.flag));
                   ^

Error: ENOENT: no such file or directory, open 'tickets.txt'
    at Object.readFileSync (node:fs:483:20)
    at Object.<anonymous> (/Users/你/bin/tickets-count-bad:3:18)
```

<div class="line-notes">

- `Error: ENOENT: no such file or directory, open 'tickets.txt'` 和 Day 3 那个 `package.json` 一模一样的错。命令放进 PATH,只是让你能在任何地方**启动**它;它读文件时的相对路径,依旧相对你站的地方。
- `at Object.<anonymous> (/Users/你/bin/tickets-count-bad:3:18)` 调用栈指出是脚本第 3 行第 18 列。后面还有七八行 Node 内部的调用栈,我截掉了。

</div>

</details>

### 练习 3:观察「冒充」会发生什么

在 `~/bin` 里放一个也叫 `ls` 的脚本,内容只打印一句「我不是真的 ls」,加上可执行权限。在 `~/terminal-practice` 里敲 `ls`,观察结果,用 `which -a ls` 解释,再用真正的 `ls` 列出目录。最后删掉这个冒牌货,确认 `ls` 恢复正常。

<details><summary>参考答案</summary>

```text
$ cd ~/terminal-practice
$ echo '#!/usr/bin/env node' > ~/bin/ls
$ echo 'console.log("我不是真的 ls")' >> ~/bin/ls
$ chmod +x ~/bin/ls
$ ls
我不是真的 ls
$ which -a ls
/Users/你/bin/ls
/bin/ls
$ /bin/ls
archive
hello.txt
inbox
notes
projects
tickets
tickets.txt
weekly
$ rm ~/bin/ls
$ ls
archive
hello.txt
inbox
notes
projects
tickets
tickets.txt
weekly
$ which -a ls
/bin/ls
```

<div class="line-notes">

- `$ echo '#!/usr/bin/env node' > ~/bin/ls` 冒牌 `ls` 的第一行。
- `我不是真的 ls` 敲 `ls`,运行的是冒牌货。
- `/Users/你/bin/ls` `which -a` 一目了然:`~/bin` 在 PATH 最前面,它里面的 `ls` 先被找到,`/bin/ls` 轮不到。
- `$ /bin/ls` 写全路径,绕过 PATH,还能用真的。
- `$ rm ~/bin/ls` 删掉冒牌货。
- `archive` `ls` 恢复了。(这里一行一个名字,是因为我这几条命令是交给 zsh 当脚本跑的,`ls` 的输出没连着屏幕,Day 5 讲过这个规则;你在终端里敲会看到多列。)

</div>

这个练习想让你记住一件事:**PATH 前面的目录有很大的权力**。谁能往那个目录里放文件,谁就能让你敲的 `ls`、`git`、`node` 变成别的程序。所以只往 PATH 里加你自己控制的目录,不要加 `.`(当前目录)之类的东西,也别随手把来路不明的脚本放进 `~/bin`。后面讲 Agent 安全时,「让模型能执行命令」这件事为什么必须关在沙箱里,道理是相通的。

</details>

### 练习 4:用 `>` 写 `.zshrc` 会怎样

不要拿真的 `.zshrc` 试。先复制一份 `zshrc-copy`,对它用**一个** `>` 写入 `export PATH="$HOME/bin:$PATH"`,看看剩下什么,再说说如果这是真的 `.zshrc`、你又刚好没备份,会出什么事,怎么补救。

<details><summary>参考答案</summary>

```text
$ cd ~/terminal-practice
$ cp ~/.zshrc zshrc-copy
$ echo 'export PATH="$HOME/bin:$PATH"' > zshrc-copy
$ cat zshrc-copy
export PATH="$HOME/bin:$PATH"
$ rm zshrc-copy
```

<div class="line-notes">

- `$ cp ~/.zshrc zshrc-copy` 副本放在练习目录里,名字不以点开头,好找。
- `$ echo 'export PATH="$HOME/bin:$PATH"' > zshrc-copy` 单箭头。
- `export PATH="$HOME/bin:$PATH"` 只剩这一行,注释和 nvm 的两行都没了,没有任何提示。
- `$ rm zshrc-copy` 清理。

</div>

如果是真的 `.zshrc`:下一个新窗口里 nvm 没加载,`node -v` 又变回了 v12(或者干脆 `command not found`),你会以为 Node 坏了。补救:有 `.zshrc.bak` 就 `cp ~/.zshrc.bak ~/.zshrc`;没备份,就得回忆当初装过哪些工具,去它们的官方文档里把要加的几行找回来,一个个重新加。备份只要一条命令,补救可能要一个小时。

</details>

验收标准:不看文章能说出 PATH 是什么、`which` 和 `which -a` 的区别、为什么带 `/` 的命令名不查 PATH;能解释 `npm run dev` 里 `vite` 为什么找得到;`~/bin/hello-agent` 和 `~/bin/tickets-count` 在任意目录都能直接敲;`~/.zshrc` 里多出的是 `export PATH="$HOME/bin:$PATH"` 这一行,而且旁边有一份 `.zshrc.bak`。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 环境变量 | 每个程序启动时从启动它的程序那里继承的一组「名字=值」,如 PATH、HOME。Node 里是 `process.env` |
| PATH | 一个环境变量,值是用冒号隔开的一串目录。敲命令名时 shell 按顺序在这些目录里找,第一个找到的胜出 |
| `$变量名` | 在命令里取变量的值,shell 在运行命令前替换,如 `echo $PATH`。`${PATH}` 同义 |
| `which` / `which -a` | 查一个命令名实际对应哪个文件 / 列出 PATH 里所有同名的 |
| 内置命令(built-in) | 写在 shell 自身里的命令,如 `cd`、`echo`、`source`,不去 PATH 里找 |
| `command not found` | PATH 里每个目录都没有这个名字的可运行文件 |
| `export` | 给变量赋值并让以后启动的程序也能拿到它,如 `export PATH="$HOME/bin:$PATH"` |
| `~/.zshrc` | zsh 的配置文件,每个新的终端窗口启动时执行一遍 |
| `~/.zprofile` | zsh 登录时读的配置文件,比 `.zshrc` 先读;python.org 安装包往这里写 PATH |
| `source` | 在当前 shell 里执行一个文件,改完 `.zshrc` 用它立即生效 |
| 符号链接(symlink) | 指向另一个文件的「替身」,`ls -l` 第一个字母是 `l`,箭头后是真身 |
| shebang | 脚本第一行的 `#!...`,告诉系统用什么程序执行这个文件,如 `#!/usr/bin/env node` |
| `chmod +x` | 给文件加上可执行权限,`ls -l` 里会多出 `x` |
| `node_modules/.bin` | npm 放项目内命令的目录;`npm run` 和 `npx` 会把它加进 PATH |
| `tr` | 把输入里的某些字符换成另一些字符,今天只用 `tr ':' '\n'` 把冒号换成换行 |

## 常见误区

**改完 `.zshrc` 以为马上生效。** `.zshrc` 只在 shell 启动时读一次。改完要 `source ~/.zshrc`,或者开一个新窗口。正文里改完 nvm 那两行,`node -v` 还是 v12,`source` 以后才变。

**`export PATH=新目录`,把 PATH 整个覆盖了。** 正文演示过:`ls` 都找不到了,`hello-agent` 里的 `node` 也找不到。永远写成 `export PATH="新目录:$PATH"`。命令行里敲错关掉窗口就好,写进 `.zshrc` 就要靠备份。

**往 `.zshrc` 里写东西用了 `>`。** 整个文件被清空。Day 5 的坑在这里最贵。改之前 `cp ~/.zshrc ~/.zshrc.bak`,追加只用 `>>`。

**照着老教程改 `.bashrc` 或 `.bash_profile`。** macOS 从 Catalina 起默认是 zsh,不读这两个文件。先 `echo $SHELL` 看自己用的是哪个 shell(新 Mac 上是 `/bin/zsh`)。

**`python` 和 `python3` 混用。** macOS 上没有 `python` 这个命令,敲了就是 `command not found: python`。这门课里一律写 `python3`,到 Day 10 用 uv 以后写 `uv run python`,那时 `python` 才可用。

**装了新版本,运行的还是旧的。** 正文里 Node 24 已经在硬盘上了,`node -v` 还是 v12,Vite 8 报 `SyntaxError: Unexpected token '.'`。遇到「版本不对」或者「明明装了却说没有」,第一件事 `which -a 命令名`,看看 PATH 里有几个、谁排在前面。

**脚本写好了直接运行,报 `permission denied`。** 新文件默认没有执行权限,`chmod +x` 一下。报错说的是「权限」,不是「找不到」,说明 PATH 和路径都对了。

## 学习资料

### 文档与文章

- [网道 · Bash 变量](https://wangdoc.com/bash/variable):中文,讲环境变量、`$` 取值、`export`。今天读「简介」和「创建变量」「读取变量」「export 命令」这几节,15 分钟。讲的是 bash,今天用到的这部分在 zsh 里写法一样。
- [计算机教育中缺失的一课 · Shell 工具和脚本](https://missing-semester-cn.github.io/2020/shell-tools/):中文,前半部分讲 shell 脚本里的变量、引号的区别(单引号不替换 `$`,双引号替换),正好对应今天往 `.zshrc` 里写东西时为什么用单引号。脚本函数那些后面的内容暂时跳过。
- [The Missing Semester 2026 · Course Overview + Introduction to the Shell](https://missing.csail.mit.edu/2026/course-shell/):英文,Day 3 读过前半段,今天读讲 `$PATH`、`which` 的那几段,它举的例子就是「shell 怎么找到 `echo` 这个程序」。
- [zsh 官方手册 · Startup/Shutdown Files](https://zsh.sourceforge.io/Doc/Release/Files.html):英文,zsh 启动时按什么顺序读 `.zshenv`、`.zprofile`、`.zshrc`、`.zlogin`。短短一页,想弄清「到底该写在哪个文件」时来查。
- [npm 文档 · npm run](https://docs.npmjs.com/cli/v11/commands/npm-run):英文,看「Description」里讲 `node_modules/.bin` 被加进 PATH 的那一段,就是正文 `npm run where` 的出处。
- [ss64 · which](https://ss64.com/mac/which.html)、[chmod](https://ss64.com/mac/chmod.html):英文,两个命令的 macOS 版选项。`chmod` 的数字写法(`755` 之类)今天不用学。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1Y4Jy6wEbJ&autoplay=0&high_quality=1" title="为什么代码还没写,就要先配环境变量?【什么是环境变量 | 技术寻源】" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>让水烧开 · 为什么代码还没写,就要先配环境变量?【什么是环境变量 | 技术寻源】 · 8 分钟,2026 年 10 月刚发的。从「系统怎么找到一个程序」讲 PATH 的来历,和今天正文那张查找顺序图是一回事,看完换个角度再理解一遍。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1XE41177Te&autoplay=0&high_quality=1" title="【zsh和bash的区别】MacOS升级10.15Catalina,zsh成为系统默认shell,bash被弃用?" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>不去便利店的少少 · 【zsh和bash的区别】MacOS升级10.15Catalina,zsh成为系统默认shell,bash被弃用? · 3 分钟,2020 年。讲清楚为什么 Mac 上要改 <code>.zshrc</code> 而不是 <code>.bashrc</code>。</figcaption>
</figure>

另外 [倾染qrs · macOS环境变量配置](https://www.bilibili.com/video/BV1r94y1K77F)(8 分钟)演示了在 Mac 上编辑配置文件加 PATH 的全过程,可以对照着看别人怎么操作,但它用的编辑方式和这里不同,以正文的「先备份、再 `>>` 追加」为准。

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/ADh_OFBfdEE" title="What are Environment Variables, and how do I use them? (get,set)" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Jacob Sorber · What are Environment Variables, and how do I use them? (get,set) · 英文,可开自动字幕。一位大学教授讲环境变量:父进程怎么把它们传给子进程、程序里怎么读。今天看前半段讲 PATH 和 export 的部分,后面用 C 语言读环境变量的部分可以跳过。</figcaption>
</figure>

### 书籍

- William Shotts《The Linux Command Line》第 2 版,No Starch Press,2019,第 11 章「The Environment」专讲环境变量、PATH 和启动文件,第 9 章「Permissions」讲 `chmod`。作者在 [linuxcommand.org](https://linuxcommand.org/) 免费提供英文 PDF;第 1 版社区中文翻译里对应的是[第十二章 shell 环境](https://billie66.github.io/TLCL/book/chap12.html)。书里讲的是 bash 的 `.bashrc`,换成 zsh 就是 `.zshrc`,道理一样。

### 开源项目与代码

- [nvm-sh/nvm](https://github.com/nvm-sh/nvm):正文那两行配置的来源。README 的「Install & Update Script」一节写了安装脚本会往哪个配置文件里加什么,以及「装完 `nvm` 命令找不到」该怎么查,读完你会发现问题几乎都和今天讲的 PATH、`.zshrc` 有关。今天只读不装。
- [ohmyzsh/ohmyzsh](https://github.com/ohmyzsh/ohmyzsh):最流行的 zsh 配置框架,你可能在同事电脑上见过那种花哨的提示符。它就是往 `.zshrc` 里写了一大段配置。这门课不需要装它,看看它的 `templates/zshrc.zsh-template`,感受一下一个复杂的 `.zshrc` 长什么样。

## 自测

1. `echo $PATH` 打印出 `/Users/你/bin:/usr/local/bin:/usr/bin:/bin`,`~/bin` 和 `/usr/local/bin` 里都有一个叫 `node` 的程序。敲 `node` 运行的是哪个?怎么确认?

<details><summary>答案</summary>

`~/bin` 里的那个,因为它在 PATH 里排第一。用 `which node` 确认会运行哪个,`which -a node` 能看到两个都在、谁在前面。

</details>

2. 一个前端项目里 `npm run dev` 能启动,直接敲 `vite` 却报 `command not found`。为什么?不改 PATH,有哪几种办法直接运行它?

<details><summary>答案</summary>

`vite` 装在项目的 `node_modules/.bin` 里,这个目录不在 PATH 里;`npm run` 执行脚本前会临时把它加到 PATH 前面,所以能找到。直接运行的办法:`npx vite`,或者写路径 `./node_modules/.bin/vite`(带 `/` 的命令名不查 PATH)。

</details>

3. 你在 `.zshrc` 末尾加了一行 `export PATH="$HOME/bin:$PATH"`,在当前窗口敲自己的命令还是 `command not found`。为什么?怎么办?

<details><summary>答案</summary>

`.zshrc` 只在 shell 启动时读一次,改了文件不会影响已经打开的窗口。执行 `source ~/.zshrc`,或者开一个新窗口。

</details>

4. `~/bin/hello-agent` 报 `zsh: permission denied`,而直接敲 `hello-agent` 报 `zsh: command not found`。这两句话分别说明了什么?

<details><summary>答案</summary>

`permission denied`:文件找到了,但没有执行权限,要 `chmod +x`。`command not found`:在 PATH 的所有目录里都没找到这个名字,说明 `~/bin` 还不在 PATH 里(或名字敲错了)。前者是权限问题,后者是查找问题。

</details>

5. 面试题:同事说「我 `pip install` 了一个包,运行脚本时却报找不到这个模块」。你会让他先跑哪两条命令?为什么?

<details><summary>答案</summary>

`which -a python3`(或 `which -a python`)和 `which -a pip3`(或 `pip`)。一台机器上常有好几个 Python,`pip` 可能属于其中一个 Python,运行脚本的却是另一个,包装进了 A、代码跑在 B 上。看两条命令找到的是不是同一个目录下的,就能定位。更稳妥的做法是用 `python3 -m pip install ...`,保证装进的就是正在用的那个 Python;这门课后面用 uv,会把这个问题整个绕开。

</details>

## 明天预告

Day 8 · 第一个 Python 程序:和 Node 比,Python 怎么跑。今天你已经看到,我这台机器上有两个 `python3`,一个 3.10、一个 3.8,而这门课要的是新版本。明天先装一个 Python(今天的 PATH 知识决定了装完怎么验证你敲的是不是它),然后写第一个 `hello.py`,和 `hello.js` 并排对照:`python3` 和 `node` 一样是一个解释器,交互模式和跑脚本两种用法,报错长什么样,语法错和运行时错有什么不同。
