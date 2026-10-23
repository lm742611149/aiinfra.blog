---
title: 'Day 56 · git(一):仓库、add、commit、log 和 diff'
description: '先弄清 git 的三个地方:工作区、暂存区、仓库。用一个练习仓库反复走一遍「改文件、看 diff、add、commit、看 log」,再在 agent-zero-lab 里完成第一次提交。提交前用 add -n 和 diff --cached 确认 .env 没混进去;最后故意把一把假 key 提交进去,看它为什么删不掉。'
pubDate: 2026-10-23
regime: none
tags: ['git', 'agent-zero']
series: 'agent-zero'
day: 56
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 55](/blog/agent-zero/day-055-week08-review/) 是第 8 周的复习日。到这一步 `agent-zero-lab` 里已经躺着几十个文件:`.env`、`.env.example`、一堆 `part01/*.py`、几份 JSON 数据。可是翻到 [Day 53](/blog/agent-zero/day-053-env-secrets/) 当时的 `git status`,它一直是一排 `??`:uv 在 Day 10 替你建好了仓库,但**一次都没有提交过**,所有文件对 git 来说都是「新来的、没登记的」。

那天你改了 `.gitignore`,保证 `.env` 不会被 git 看见。今天就用上它:先学 git 最小的一套命令,再在 lab 里完成第一次提交。你前端写了这么多年,也许用 VS Code 的源代码管理面板点过提交按钮,今天全部换成命令行,一步一步看清按钮背后到底发生了什么。

## 今天要解决的问题

学完今天,你应该能:

1. 用 `git init`、`git status`、`git add`、`git commit`、`git log` 在一个新目录里建仓库、登记文件、提交、看历史,并说清 **工作区、暂存区、仓库** 三个地方各放什么。
2. 分得清 `git diff`、`git diff --cached`、`git diff HEAD` 各自比较的是谁和谁,知道 `git add` 之后又改了文件会怎样。
3. 在 `agent-zero-lab` 里完成第一次提交,提交前用 `git add -n .` 和 `git diff --cached` 确认 `.env` 没有混进去。
4. 手滑 `add` 了不该提交的文件,知道怎么撤回;知道 key 一旦**提交进历史**,只删文件为什么没用。

预计用时:2.5 小时。前置:[Day 3](/blog/agent-zero/day-003-terminal-1/) 到 [Day 5](/blog/agent-zero/day-005-terminal-3/) 的终端基本功(cd、ls、echo、`>`、`>>`、管道)、[Day 10](/blog/agent-zero/day-010-uv-1/) 的 `uv init`(顺手建了 `.git`)、[Day 53](/blog/agent-zero/day-053-env-secrets/) 的 `.gitignore` 和 `git check-ignore`。

学法:先对照文章逐行敲一遍(不要复制粘贴)并跑通;第二天合上文章,在一个新目录里把「init、建文件、add、commit、改文件、diff、add、commit、log」这一整圈默写出来;再做动手练习,做不出来再展开参考答案,看完关掉自己重写一遍。

今天不写 Python,不装 Python 依赖,花费 0 元。会用到两个目录:一个新的练习目录 `~/git-practice`(用来放心犯错),和你的 `~/agent-zero-lab`。

关于环境说明几句。我在一台 Mac 上跑的,git 是系统自带的 `2.24.3 (Apple Git-128)`,你的版本可能更新,命令用法一样,个别提示的措辞会有细微差别。**提交编号(那串 7 位十六进制)每个人都不同,时间也不同,对上命令的行为就行。** 为了不碰我自己机器上的 git 配置,我给每条命令都指定了一个假的家目录,全局配置写进了那里,所以下面的名字 `学习者` 和邮箱 `learner@example.com` 是演示用的,你要换成自己的。输出里的长路径缩短了,家目录写成 `/Users/你`。没实跑的有一点:第一次在一台没装过 git 的 Mac 上敲 `git`,系统会弹出「安装命令行开发者工具」的提示,点安装等几分钟即可,这一步我没法在已装好的机器上复现。

## 先想清楚:git 到底在管什么

你把一个项目目录想象成一个文件夹,里面每天都在改。git 做的事是:**每当你说「就这样,存一份」,它把当时所有被登记过的文件的样子完整记下来,贴上你写的一句说明和时间,串成一条时间线。** 这一份记录叫一次**提交**(commit)。以后想看三天前的样子、想知道哪一行是什么时候被改的、想撤销一个改坏的文件,都靠这条时间线。前端熟悉的 `package.json` 版本号、Figma 的版本历史,是类似的东西,只是 git 管的是任意文件,而且在你本机就能用,不需要联网(联网、GitHub 是 Day 58 的事)。

关键是它设计了**三个地方**,很多初学者的困惑都来自没分清它们:

<figure>
<svg viewBox="0 0 640 290" role="img" aria-label="git 的三个地方:工作区是你正在编辑的文件;git add 把改动放进暂存区;git commit 把暂存区的内容永久记入仓库历史。git diff 比较工作区和暂存区,git diff --cached 比较暂存区和仓库最新一次提交,git diff HEAD 比较工作区和最新提交">
<rect x="0" y="0" width="640" height="290" fill="var(--paper-raised)" rx="6"/>
<g font-family="var(--font-mono)" font-size="12">
<rect x="16" y="40" width="168" height="84" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="100" y="66" text-anchor="middle" fill="var(--ink)">工作区</text>
<text x="100" y="86" text-anchor="middle" fill="var(--ink-soft)" font-size="11">你正在编辑的文件</text>
<text x="100" y="104" text-anchor="middle" fill="var(--ink-soft)" font-size="11">notes.txt 改成什么就是什么</text>
<rect x="236" y="40" width="168" height="84" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="320" y="66" text-anchor="middle" fill="var(--ink)">暂存区</text>
<text x="320" y="86" text-anchor="middle" fill="var(--ink-soft)" font-size="11">「下一次提交要带上的」</text>
<text x="320" y="104" text-anchor="middle" fill="var(--ink-soft)" font-size="11">add 那一刻的样子</text>
<rect x="456" y="40" width="168" height="84" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="540" y="66" text-anchor="middle" fill="var(--ink)">仓库(历史)</text>
<text x="540" y="86" text-anchor="middle" fill="var(--ink-soft)" font-size="11">一次次提交串成时间线</text>
<text x="540" y="104" text-anchor="middle" fill="var(--ink-soft)" font-size="11">最新那次叫 HEAD</text>
<line x1="184" y1="82" x2="236" y2="82" stroke="var(--ink-soft)"/>
<text x="210" y="74" text-anchor="middle" fill="var(--ink)" font-size="11">git add</text>
<line x1="404" y1="82" x2="456" y2="82" stroke="var(--ink-soft)"/>
<text x="430" y="74" text-anchor="middle" fill="var(--ink)" font-size="11">git commit</text>
<line x1="100" y1="124" x2="100" y2="170" stroke="var(--rule)" stroke-dasharray="4 3"/>
<line x1="320" y1="124" x2="320" y2="170" stroke="var(--rule)" stroke-dasharray="4 3"/>
<line x1="540" y1="124" x2="540" y2="170" stroke="var(--rule)" stroke-dasharray="4 3"/>
<line x1="100" y1="170" x2="320" y2="170" stroke="var(--ink-soft)"/>
<text x="210" y="188" text-anchor="middle" fill="var(--ink)" font-size="11">git diff</text>
<line x1="320" y1="210" x2="540" y2="210" stroke="var(--ink-soft)"/>
<text x="430" y="228" text-anchor="middle" fill="var(--ink)" font-size="11">git diff --cached</text>
<line x1="100" y1="250" x2="540" y2="250" stroke="var(--ink-soft)"/>
<text x="320" y="270" text-anchor="middle" fill="var(--ink)" font-size="11">git diff HEAD</text>
<text x="16" y="24" fill="var(--ink-faint)" font-size="11">改文件 → 挑出要提交的 → 存档</text>
</g>
</svg>
<figcaption>三个地方和三种 diff。diff 画的线连接哪两个地方,就是在比较那两个地方的内容。</figcaption>
</figure>

为什么中间要多一个暂存区,直接「改完就提交」不行吗?因为实际工作里你常常同时改了好几处,但想把它们**分成两次、各自一句说明**记下来。暂存区就是那个「把这次要记的东西先挑出来放一边」的托盘。第四步会实际演示。

## 第一步:确认 git 装好了,告诉它你是谁

先看版本:

```bash
git --version
```

实测输出:

```text
git version 2.24.3 (Apple Git-128)
```

能打出版本号就行。每一次提交都会记下是谁提交的,所以先告诉 git 你的名字和邮箱。这是**全局**配置,整台电脑只用设一次:

```bash
git config --global user.name "你的名字"
git config --global user.email "你的邮箱"
git config --global --list
```

<div class="line-notes">

- `git config --global user.name "你的名字"` `--global` 表示对这台电脑上所有仓库生效,写在 `~/.gitconfig` 这个文件里。名字用什么都行,会出现在每次提交里,以后推到 GitHub 别人也能看到。我演示用的是 `学习者`。
- `git config --global user.email "你的邮箱"` 邮箱同理。推到 GitHub 时,你可以用 GitHub 提供的 `xxx@users.noreply.github.com` 隐私邮箱(Day 58 讲)。
- `git config --global --list` 列出全局配置,确认写进去了。

</div>

我这边实测输出:

```text
user.name=学习者
user.email=learner@example.com
```

不设会怎样?macOS 上的 git 往往不会拦你,它会根据你的用户名和电脑名**自动猜**一个,第一次提交时给一段警告。实测的警告是这样的(我把真实的用户名和电脑名换成了占位符):

```text
 Committer: 你的用户名 <你的用户名@你的电脑名.local>
Your name and email address were configured automatically based
on your username and hostname. Please check that they are accurate.
You can suppress this message by setting them explicitly. Run the
following command and follow the instructions in your editor to edit
your configuration file:

    git config --global --edit

After doing this, you may fix the identity used for this commit with:

    git commit --amend --reset-author
```

提交其实成功了,但留下了一个你不想要的邮箱。看到这段话,就回头把上面两行 `git config` 补上。(有的系统猜不出来,会报 `Please tell me who you are` 然后拒绝提交,处理办法一样。)

## 第二步:一个练习仓库,走完第一圈

不要拿真项目练手。在家目录下新建一个练习目录:

```bash
mkdir ~/git-practice
cd ~/git-practice
git init
```

<div class="line-notes">

- `mkdir ~/git-practice` Day 4 的命令,在家目录建一个新目录。`~` 是家目录(Day 3)。
- `cd ~/git-practice` 进去。后面的 git 命令都要在这个目录里敲:git 根据**当前所在的目录**判断你在管哪个仓库。
- `git init` initialize(初始化)的缩写:在当前目录里建一个 `.git` 子目录,仓库的全部历史就存在那里面。建完这个目录才算「受 git 管理」。

</div>

实测输出:

```text
Initialized empty Git repository in /Users/你/git-practice/.git/
```

`.git` 是个以点开头的隐藏目录(Day 3 的 `ls -a` 能看到)。**别手动改它里面的东西,更别删它**:删了,这个目录的全部历史就没了,变回普通文件夹。你的 `agent-zero-lab` 里 uv 帮你建的就是这个东西。

### status:随时问「现在什么情况」

`git status` 是用得最多的命令,每做一步都敲一下:

```bash
git status
```

实测输出:

```text
On branch master

No commits yet

nothing to commit (create/copy files and use "git add" to track)
```

第一行是当前**分支**,叫 `master`(你的 git 版本可能默认叫 `main`,没区别,分支是 Day 57 的内容)。`No commits yet` 是还没有任何提交。现在建一个文件再问一次:

```bash
echo "第一行:云簿工单备忘" > notes.txt
git status
```

实测输出:

```text
On branch master

No commits yet

Untracked files:
  (use "git add <file>..." to include in what will be committed)
	notes.txt

nothing added to commit but untracked files present (use "git add" to track)
```

`Untracked files` 是「未跟踪的文件」:git 看见了它,但还没登记,不会记进历史。括号里还贴心地告诉你下一步用 `git add`。

### add:放进暂存区

```bash
git add notes.txt
git status
```

实测输出:

```text
On branch master

No commits yet

Changes to be committed:
  (use "git rm --cached <file>..." to unstage)
	new file:   notes.txt

```

现在 `notes.txt` 出现在 `Changes to be committed`(「待提交的改动」)下面,说明它进了暂存区。注意括号里的提示 `git rm --cached <file>` 用来撤回:它只出现在**还没有任何提交**的仓库里,有了提交以后提示会变成别的命令(第六步会遇到)。

### commit:存档

```bash
git commit -m "第一次提交:加入 notes.txt"
```

<div class="line-notes">

- `git commit -m "第一次提交:加入 notes.txt"` `git commit` 把暂存区里的内容存成一次提交,放进仓库历史。`-m` 是 message(说明),引号里是这次提交的一句话说明,写给将来的你和同事看的。不加 `-m` 的话 git 会打开一个文本编辑器让你写,下面「常见误区」会讲怎么逃出来。

</div>

实测输出:

```text
[master (root-commit) 2de4003] 第一次提交:加入 notes.txt
 1 file changed, 1 insertion(+)
 create mode 100644 notes.txt
```

第一行里 `root-commit` 表示这是整个仓库的第一次提交(没有上一次),`2de4003` 是这次提交的**编号**(其实是一串 40 位的哈希值,这里显示前 7 位);下面说这次改了 1 个文件、加了 1 行。`100644` 是文件权限,先不管。

### log:看历史

```bash
git log
git log --oneline
```

实测输出:

```text
commit 2de40030e2767f32206b5e30a288e26d5238c9ed
Author: 学习者 <learner@example.com>
Date:   Fri Oct 23 11:32:00 2026 +0800

    第一次提交:加入 notes.txt
```

```text
2de4003 第一次提交:加入 notes.txt
```

`git log` 每次提交一个块:完整编号、作者、时间、说明。`--oneline` 压成一行,只留前 7 位编号和说明,日常看历史基本都用它。

到这里你已经走完了一圈:**建文件 → add → commit → log**。接下来第二圈,加上 diff。

## 第三步:diff,看到底改了什么

给 `notes.txt` 追加一行(`>>` 是追加,Day 5),然后问 git:

```bash
echo "第二行:退款 3 个工作日到账" >> notes.txt
git status
git diff
```

实测输出:

```text
On branch master
Changes not staged for commit:
  (use "git add <file>..." to update what will be committed)
  (use "git restore <file>..." to discard changes in working directory)
	modified:   notes.txt

no changes added to commit (use "git add" and/or "git commit -a")
```

```text
diff --git a/notes.txt b/notes.txt
index 40a2777..6b8fd25 100644
--- a/notes.txt
+++ b/notes.txt
@@ -1 +1,2 @@
 第一行:云簿工单备忘
+第二行:退款 3 个工作日到账
```

`Changes not staged for commit` 是「改了,但还没放进暂存区」,`modified` 表示这个文件在上一次提交里就有,现在被改过了。

`git diff` 的输出读法(这个格式你会在 GitHub 的 PR 页面反复看到):

- `--- a/notes.txt` 和 `+++ b/notes.txt`:`---` 是旧版本,`+++` 是新版本。
- `@@ -1 +1,2 @@`:旧版本从第 1 行起共 1 行,新版本从第 1 行起共 2 行。
- 前面是空格的行是没变的上下文,`+` 开头的是新加的,`-` 开头的(这里没有)是删掉的。

现在把它放进暂存区,再看三种 diff:

```bash
git add notes.txt
git diff
git diff --cached
```

实测输出:`git diff` 什么都没有;`git diff --cached` 是:

```text
diff --git a/notes.txt b/notes.txt
index 40a2777..6b8fd25 100644
--- a/notes.txt
+++ b/notes.txt
@@ -1 +1,2 @@
 第一行:云簿工单备忘
+第二行:退款 3 个工作日到账
```

对照上面的图:`git diff` 比较的是**工作区和暂存区**。刚刚 `add` 过,两边一样,所以什么都没有。`git diff --cached` 比较**暂存区和最新一次提交**,这时候两边不一样,差别就是我们刚加的那一行。**「diff 没东西」不等于「没改」,可能是你已经 add 了。** 这是新手最常迷惑的地方。

第三种 `git diff HEAD` 直接比较工作区和最新提交,不管有没有暂存,一眼看到「从上次提交到现在总共改了什么」。(`HEAD` 是 git 里「最新那次提交」的名字。)

提交,并看历史:

```bash
git commit -m "notes 加一行退款说明"
git log --oneline
```

实测输出:

```text
[master 856312e] notes 加一行退款说明
 1 file changed, 1 insertion(+)
```

```text
856312e notes 加一行退款说明
2de4003 第一次提交:加入 notes.txt
```

历史里有两条了,新的在上面。

## 第四步:暂存区的用处,以及一个陷阱

### 挑着提交

场景:你同时改了两个文件,一个是文档,一个是代码,想各记一笔。新建 `app.py`,同时再改 `notes.txt`:

```bash
printf 'def hello():\n    return "你好"\n' > app.py
echo "第三行:发票可以重开" >> notes.txt
git status --short
```

`--short` 是简短格式,每个文件一行,行首有**两个字符**:第一个管暂存区,第二个管工作区。实测输出:

```text
 M notes.txt
?? app.py
```

` M` 是「暂存区没动、工作区改了」(第一个字符是空格);`??` 是未跟踪。只把 `notes.txt` 放进暂存区,提交,再看状态:

```bash
git add notes.txt
git status --short
git commit -m "notes 加发票说明"
git status --short
```

实测输出:

```text
M  notes.txt
?? app.py
```

```text
[master 6cb1ee9] notes 加发票说明
 1 file changed, 1 insertion(+)
```

```text
?? app.py
```

`M ` 是「已暂存的修改」(第一个字符是 M,第二个是空格)。提交之后只有 `app.py` 还留在外面,它没有被连带记进去。接着给它单独一次提交:

```bash
git add app.py
git commit -m "加入 app.py"
```

```text
[master 00f05c2] 加入 app.py
 1 file changed, 2 insertions(+)
 create mode 100644 app.py
```

两个不相干的改动,两次提交,各有各的说明。以后回头看,想找「发票说明是哪次加的」一眼就找到;想撤销其中一个,也不会连累另一个。

### 陷阱:add 之后又改了

`git add` 记下的是**add 那一刻**文件的样子,不是文件本身。看真实情况:

```bash
echo "第四行:发票抬头可改" >> notes.txt
git add notes.txt
echo "第五行:这一行 add 之后才写" >> notes.txt
git status
```

实测输出:

```text
On branch master
Changes to be committed:
  (use "git restore --staged <file>..." to unstage)
	modified:   notes.txt

Changes not staged for commit:
  (use "git add <file>..." to update what will be committed)
  (use "git restore <file>..." to discard changes in working directory)
	modified:   notes.txt

```

同一个文件出现了**两次**:一次在待提交里,一次在未暂存里。两个 diff 分别告诉你各是什么:

```bash
git diff --cached
git diff
```

实测输出(各取关键部分):`--cached` 的最后一行是 `+第四行:发票抬头可改`,而不带 `--cached` 的 `git diff` 里是 `+第五行:这一行 add 之后才写`。提交一下:

```bash
git commit -m "notes 第四行"
git status --short
git log --oneline
```

实测输出:

```text
[master c4d5c72] notes 第四行
 1 file changed, 1 insertion(+)
```

```text
 M notes.txt
```

```text
c4d5c72 notes 第四行
00f05c2 加入 app.py
6cb1ee9 notes 加发票说明
856312e notes 加一行退款说明
2de4003 第一次提交:加入 notes.txt
```

提交里只有第四行,第五行没有被带上。提交后 `notes.txt` 又是 ` M`:第五行还躺在工作区。教训是:**add 之后又改了的文件,要再 add 一次,否则这一次改动不会进提交。** 养成习惯:提交前 `git status`,看有没有同一个文件出现两次。

## 第五步:在 agent-zero-lab 里完成第一次提交

练习仓库走熟了,回到真项目。进入 `agent-zero-lab`,第一件事是看现状:

```bash
cd ~/agent-zero-lab
git status
```

实测输出(这是 Day 53 以后的样子,你的文件列表可能略有不同):

```text
On branch master

No commits yet

Untracked files:
  (use "git add <file>..." to include in what will be committed)
	.env.example
	.gitignore
	.python-version
	README.md
	main.py
	part01/
	pyproject.toml
	uv.lock

nothing added to commit but untracked files present (use "git add" to track)
```

逐项看一下这份清单:

- **没有 `.env`**。这正是 Day 53 那三行 `.gitignore` 的功劳,git 根本看不见它。
- **没有 `.venv/`**,uv 生成的 `.gitignore` 里本来就挡着它(虚拟环境装了几百个文件,不该进仓库,uv 随时能重建,Day 11)。
- `part01/` 只显示一个目录名,git 没有展开里面的文件,下面会展开看。
- `uv.lock`、`pyproject.toml`、`.python-version` 要提交:别人拿到你的仓库,靠它们就能 `uv sync` 复现出一模一样的环境(Day 11)。

### 提交前的三道检查

按下 `git add .` 之前,我习惯做三件事。这三件事的顺序和旧课里「先 add 再查」的做法是同一个思路:**查的是暂存区里将要提交的内容,不是你以为的内容。**

**第一道,看 `.gitignore` 生效没有。**

```bash
git check-ignore -v .env .env.test .env.example
```

实测输出:

```text
.gitignore:13:.env	.env
.gitignore:14:.env.*	.env.test
.gitignore:15:!.env.example	.env.example
```

和 Day 53 一样。`.env` 和 `.env.test` 被忽略,`.env.example` 被例外规则放行。

**第二道,用 `git add -n .` 预演。** `-n` 是 dry-run,只列出「如果真 add 会加哪些」,不真加。

```bash
git add -n . | wc -l
git add -n . | grep -E "env|venv|pycache"
```

<div class="line-notes">

- `git add -n . | wc -l` `.` 表示当前目录下的所有改动。`-n` 让 add 只说不做,输出里每个文件一行 `add '路径'`。管道交给 `wc -l`(Day 5)数行,就是将要加入的文件个数。
- `git add -n . | grep -E "env|venv|pycache"` 在预演的清单里找三个不该出现的词。`-E` 是扩展正则(Day 5),`|` 在引号里面表示「或者」,不是管道符。

</div>

实测输出:

```text
      44
add '.env.example'
```

一共 44 个文件(你的数字取决于你做了多少练习,不会和我一样)。命中的只有 `.env.example`,它是模板,里面是占位符 `sk-你的key`,就该提交。`.env` 不在、`.venv` 不在、`__pycache__` 不在。

**第三道,真 add 之后查暂存区的内容。** 前两道查的是「文件名」,key 也可能藏在别的文件里:你调试时随手贴进某个 `.py` 或某份 JSON 里。所以真 add 之后,在即将提交的**内容**里找长得像 key 的字符串:

```bash
git add .
git status --short | head -5
git diff --cached | grep -E "sk-[A-Za-z0-9-]{20,}"
echo "grep exit=$?"
```

<div class="line-notes">

- `git add .` 这回是真的了:当前目录下所有没被忽略的新文件和改动,全部放进暂存区。
- `git status --short | head -5` 简短格式只看前 5 行,确认开头的 `A ` 都是预期的文件(`A` 是 added,新加入)。
- `git diff --cached | grep -E "sk-[A-Za-z0-9-]{20,}"` 暂存区相对于「上一次提交」的全部差异,这里因为没有提交过,就是所有文件的全部内容。正则的意思:`sk-` 后面跟 20 个以上的字母、数字或横杠。这是 DeepSeek 和 OpenAI 类 key 的大致样子,能抓到真 key,又不会误报 `.env.example` 里的 `sk-你的key`(中文不匹配,长度也不够)。
- `echo "grep exit=$?"` Day 53 讲的 `$?`:上一条命令的退出码。`grep` 找到了是 0,**没找到是 1**,所以这里期望看到的是 `1`。

</div>

实测输出:

```text
A  .env.example
A  .gitignore
A  .python-version
A  README.md
A  main.py
grep exit=1
```

`grep` 什么都没打印,退出码是 1,表示暂存区里没有疑似 key。如果它打印出了一行 `+LLM_API_KEY=sk-...`,就要在提交前处理:下一节讲怎么撤回。

### 提交

```bash
git commit -m "agent-zero-lab 第一次提交:part01 的练习和配置模板"
git log --oneline
git status
```

实测输出(创建的文件清单很长,我只留开头和结尾):

```text
[master (root-commit) c1550cb] agent-zero-lab 第一次提交:part01 的练习和配置模板
 44 files changed, 1445 insertions(+)
 create mode 100644 .env.example
 create mode 100644 .gitignore
 ...
 create mode 100644 pyproject.toml
 create mode 100644 uv.lock
```

```text
c1550cb agent-zero-lab 第一次提交:part01 的练习和配置模板
```

```text
On branch master
nothing to commit, working tree clean
```

最后一句 `working tree clean`(工作区干净):没有任何未提交的改动,也没有未跟踪的文件。这就是第一次提交完成的标志。`.env` 这个文件还好好躺在目录里(你可以 `ls -a` 确认),只是 git 不管它。

接着做第二次提交,练习一下平时的循环。`uv init` 建的 `README.md` 是空的,写几行:

```bash
printf '# agent-zero-lab\n\n《AI Agent 工程师:从零到资深》的练习仓库。\n\n- part01/:Python 基础和第一个小项目\n- 配置放在根目录 .env(不进仓库),模板见 .env.example\n' > README.md
git status --short
git diff
```

实测输出:

```text
 M README.md
```

```text
diff --git a/README.md b/README.md
index e69de29..c1e0090 100644
--- a/README.md
+++ b/README.md
@@ -0,0 +1,6 @@
+# agent-zero-lab
+
+《AI Agent 工程师:从零到资深》的练习仓库。
+
+- part01/:Python 基础和第一个小项目
+- 配置放在根目录 .env(不进仓库),模板见 .env.example
```

`@@ -0,0 +1,6 @@` 是「旧版本 0 行,新版本 6 行」,因为原来是空文件。提交,再看历史和这次提交到底改了什么:

```bash
git add README.md
git commit -m "README 写清仓库用途和配置方式"
git log --stat -1
```

实测输出:

```text
[master 9422019] README 写清仓库用途和配置方式
 1 file changed, 6 insertions(+)
```

```text
commit 9422019b23b4d26c55be19910bc85ba2a350d04c
Author: 学习者 <learner@example.com>
Date:   Fri Oct 23 11:32:47 2026 +0800

    README 写清仓库用途和配置方式

 README.md | 6 ++++++
 1 file changed, 6 insertions(+)
```

`git log --stat -1` 里,`-1` 是「只看最近 1 次」,`--stat` 在每次提交下面列出改了哪些文件、各改了多少行。这样你不用打开 diff 也能看出这次提交的范围。

## 手滑了怎么办

### 还没提交:撤回暂存

把不该提交的文件 `git add` 进了暂存区,但还没 commit,这是最常见的手滑,而且撤回方法**取决于仓库里有没有过提交**。

在 `agent-zero-lab` 现在这样**已经有了提交**的仓库里,用 `git restore --staged`。我故意强行把 `.env` 加进去演示(`-f` 是 force,强制加入被忽略的文件,平时千万别这么做):

```bash
git add -f .env
git status --short
git restore --staged .env
git status --short
```

实测输出:

```text
A  .env
```

第二次 `git status --short` 什么都没有。`A  .env` 是「已暂存的新文件」,撤回之后它又回到被忽略的状态,git 看不见了。`restore --staged` 只把它从暂存区拿走,文件本身一个字没动。

**但是**,如果仓库里还**没有任何提交**(也就是你第一次提交之前),同一条命令会失败。在练习用的另一个全新仓库里实测:

```bash
git init
echo 'print("hello")' > app.py
echo "LLM_API_KEY=sk-fake-day56-0123456789abcdefghij" > .env
git add .
git restore --staged .env
```

```text
fatal: could not resolve HEAD
```

`HEAD` 是「最新一次提交」,没有提交就没有 HEAD,`restore --staged` 不知道要恢复成什么样。这种时候用 git 自己在 `status` 里提示的那条:

```bash
git rm --cached .env
git status --short
```

实测输出:

```text
rm '.env'
A  app.py
?? .env
```

`git rm --cached` 的意思是「把它从 git 的登记里去掉,但**留着磁盘上的文件**」。`.env` 退回到 `??`(未跟踪),`app.py` 仍在暂存区。记住那个「cached」:不加它,`git rm` 会把磁盘上的文件也一起删掉。

### 已经提交了:key 进了历史

最糟的情况是 key 已经 commit 了。接着上面那个演示仓库,假设没有做第三道检查,直接提交了,然后才发现 `.env` 不该进去,补了 `.gitignore` 想把它删掉:

```bash
git add .
git commit -m "first"
echo ".env" > .gitignore
git rm --cached .env
git add .gitignore
git commit -m "stop tracking .env"
git log --oneline
git show HEAD~1:.env
```

<div class="line-notes">

- `git add .` / `git commit -m "first"` 手滑的那一次:`.env` 跟着 `app.py` 进了第一次提交。
- `echo ".env" > .gitignore` 补上忽略规则。注意 `>` 是覆盖,这里 `.gitignore` 原来不存在,没关系;你的真项目里该用 `>>` 追加。
- `git rm --cached .env` 让 git 不再跟踪它,磁盘上的文件保留。这就是 Day 53 承诺的「怎么让 git 停止跟踪一个文件」。
- `git add .gitignore` / `git commit -m "stop tracking .env"` 把「停止跟踪」这个动作本身也提交。
- `git show HEAD~1:.env` `HEAD~1` 是「HEAD 往前数 1 次」,即上一次提交。冒号后面是文件路径。意思是:显示**上一次提交里**的 `.env` 内容。

</div>

实测输出:

```text
9ae0f99 stop tracking .env
7f816cd first
```

```text
LLM_API_KEY=sk-fake-day56-0123456789abcdefghij
```

现在 `git ls-files`(列出 git 跟踪的所有文件)里只剩 `.gitignore` 和 `app.py`,最新状态里 `.env` 确实没了。可是 `git show HEAD~1:.env` 照样把整个 key 吐了出来:**历史是不可改的时间线,每一次提交都被完整保存,删文件只是新增了一次「这个文件没了」的提交,旧提交里的内容原封不动。** 只要这个仓库(或它的任何副本)被别人拿到,翻一下历史就能看到。

所以真遇到这种事,处理顺序是固定的:

1. **立刻去厂商后台把这个 key 作废,换新的**(DeepSeek 的 API keys 页面可以删除某个 key)。这一步让历史里那串字符失去价值,它是唯一真正解决问题的一步。
2. 然后才是清理仓库:改写历史的办法(`git filter-repo` 之类)存在,但是它很危险、而且在仓库已经推到网上时几乎来不及,作废 key 比清理快得多、可靠得多。
3. 检查厂商后台的用量,看有没有陌生调用。

如果这次是在**还没推到网上**的本地仓库里发现,而且就是刚刚那一次提交,有补救办法:用 Day 57 会讲的 reset 回退到上一次提交再重来。今天先记住:**提交之前的三道检查,比提交之后的任何补救都便宜。**

## 零件对照表

| 命令 | 做什么 | 今天在哪里用到 |
| --- | --- | --- |
| `git init` | 在当前目录建仓库(`.git`) | `~/git-practice`;lab 里 uv 早就替你做了 |
| `git status` / `git status --short` | 看三个地方现在的差异 | 每一步之后 |
| `git add 文件` / `git add .` | 放进暂存区 | 挑着提交;lab 第一次提交 |
| `git add -n .` | 预演,不真加 | 提交前第二道检查 |
| `git commit -m "说明"` | 把暂存区存成一次提交 | 全程 |
| `git log` / `--oneline` / `--stat -1` | 看历史 | 每次提交之后 |
| `git diff` | 工作区和暂存区 | 第三步 |
| `git diff --cached` | 暂存区和最新提交 | 第三步;提交前第三道检查 |
| `git diff HEAD` | 工作区和最新提交 | 练习 3 |
| `git restore --staged 文件` | 撤回暂存(有过提交的仓库) | 手滑 |
| `git rm --cached 文件` | 不再跟踪,保留文件;或撤回暂存(没有提交的仓库) | 手滑;练习 4 |
| `git show 提交:路径` | 看某次提交里某个文件的内容 | 演示 key 进了历史 |

## 动手练习

### 练习 1:拆成两次提交

在 `agent-zero-lab` 里同时改两个文件:把 `part01/intake.py` 里的 `USAGE` 开头 `用法: intake.py [list]` 改成 `用法: uv run python part01/intake.py [list]`;再把 `part01/intake_msgs.py` 里 `"list_type": "要填标签列表",` 改成 `"list_type": "标签要写成列表",`。要求分成**两次提交**,每次一个文件、各有一句贴切的说明,最后用 `git log --oneline` 确认历史。

<details>
<summary>参考答案</summary>

用编辑器改完两个文件,然后:

```bash
git status --short
git diff
git add part01/intake.py
git status --short
git commit -m "intake 的用法提示写全命令"
git add part01/intake_msgs.py
git commit -m "把标签的提示改得更口语"
git log --oneline
```

<div class="line-notes">

- `git status --short` 先确认只有这两个文件有改动。
- `git diff` 逐个看改动内容。这是好习惯:提交的是什么,自己要读过一遍。
- `git add part01/intake.py` 只放第一个文件。
- `git status --short` 再看:第一个是 `M `(已暂存),第二个是 ` M`(没暂存),分得清清楚楚。
- `git commit -m "intake 的用法提示写全命令"` 第一次提交只带第一个文件。
- `git add part01/intake_msgs.py` 第二个文件。
- `git commit -m "把标签的提示改得更口语"` 第二次提交。

</div>

实测输出(`git diff` 部分只留两个文件的关键行):

```text
 M part01/intake.py
 M part01/intake_msgs.py
```

`git diff` 里能看到:

```text
-USAGE = "用法: intake.py [list]\n  不带参数: 一张一张录入,标题直接回车结束\n  list: 列出已录入的工单"
+USAGE = "用法: uv run python part01/intake.py [list]\n  不带参数: 一张一张录入,标题直接回车结束\n  list: 列出已录入的工单"
```

```text
-    "list_type": "要填标签列表",
+    "list_type": "标签要写成列表",
```

接着是:

```text
M  part01/intake.py
 M part01/intake_msgs.py
```

```text
[master ad862c3] intake 的用法提示写全命令
 1 file changed, 1 insertion(+), 1 deletion(-)
[master a1d47aa] 把标签的提示改得更口语
 1 file changed, 1 insertion(+), 1 deletion(-)
```

```text
a1d47aa 把标签的提示改得更口语
ad862c3 intake 的用法提示写全命令
9422019 README 写清仓库用途和配置方式
c1550cb agent-zero-lab 第一次提交:part01 的练习和配置模板
```

一次修改一行显示成 `1 insertion(+), 1 deletion(-)`:git 把「改一行」看成「删一行再加一行」。

</details>

### 练习 2:手滑 add 了 .env

在 lab 里(已有提交)用 `git add -f .env` 模拟手滑,先确认它在暂存区,再撤回,最后确认 `git status` 又干净了;然后回答:如果这是第一次提交之前,撤回命令要怎么换?

<details>
<summary>参考答案</summary>

```bash
git add -f .env
git status --short
git restore --staged .env
git status --short
```

实测输出:

```text
A  .env
```

撤回之后 `git status --short` 什么也没打印。因为 `.env` 被 `.gitignore` 忽略,没了暂存区里的那条记录,git 就又看不见它了。

如果还没有任何提交,`git restore --staged` 会报 `fatal: could not resolve HEAD`,要用 `git rm --cached .env`(正文「手滑了怎么办」演示过)。两条命令撤回的都是暂存区,文件本身都没动。

</details>

### 练习 3:查历史

用 `git log` 家族回答三个问题:`part01/intake_msgs.py` 一共被几次提交改过(各是哪次)?第一次提交里那个文件的 `list_type` 那行是什么样?从第一次提交到最新,这个文件总共改了几行?

<details>
<summary>参考答案</summary>

```bash
git log --oneline -- part01/intake_msgs.py
git show c1550cb:part01/intake_msgs.py | grep list_type
git diff c1550cb a1d47aa --stat -- part01/intake_msgs.py
```

<div class="line-notes">

- `git log --oneline -- part01/intake_msgs.py` 双横线 `--` 后面跟路径,表示「只看动过这个文件的提交」。双横线把选项和路径隔开,避免路径被当成选项。
- `git show c1550cb:part01/intake_msgs.py | grep list_type` `c1550cb` 是第一次提交的编号(换成你自己 `git log --oneline` 里最下面那条),冒号后面接路径,显示那次提交里该文件的完整内容,再用管道交给 grep 找出那一行。
- `git diff c1550cb a1d47aa --stat -- part01/intake_msgs.py` `git diff` 后面给两个提交编号,就是比较这两次提交。`--stat` 只统计行数,不打印内容。

</div>

实测输出:

```text
a1d47aa 把标签的提示改得更口语
c1550cb agent-zero-lab 第一次提交:part01 的练习和配置模板
```

```text
    "list_type": "要填标签列表",
```

```text
 part01/intake_msgs.py | 2 +-
 1 file changed, 1 insertion(+), 1 deletion(-)
```

两次提交碰过这个文件(第一次是创建它,第二次是我们改提示);第一次的那一行是「要填标签列表」;总共改了 1 行(显示成一加一减)。

</details>

### 练习 4:运行时生成的文件不该进仓库

Day 54 的 `intake.json`、`intake_rejected.jsonl`、Day 55 的 `report.txt`、`customers_ok.json` 这些都是运行脚本时生成、每次都会变的数据,但第一次提交时被一起提交了。把它们改成不再被 git 管理(磁盘上的文件要保留),并提交这个决定。

<details>
<summary>参考答案</summary>

分两步:先在 `.gitignore` 里写规则,再让 git 放弃已经登记的文件。因为 `.gitignore` 对**已经被跟踪**的文件没用(Day 53 说过)。

```bash
echo "# 运行时生成的数据,每次跑都会变,不进仓库" >> .gitignore
printf 'part01/data/intake.json\npart01/data/*_rejected.jsonl\npart01/data/report.txt\npart01/data/customers_ok.json\npart01/data/customers_rejected.jsonl\npart01/data/recall_tickets.json\n' >> .gitignore
git check-ignore -v part01/data/report.txt part01/data/intake.json
git rm --cached part01/data/report.txt part01/data/intake.json part01/data/intake_rejected.jsonl part01/data/customers_ok.json part01/data/customers_rejected.jsonl part01/data/recall_tickets.json
git add .gitignore
git status --short
git commit -m "生成的数据文件不再进仓库"
git status --short
ls part01/data
```

<div class="line-notes">

- `echo "# 运行时生成的数据,每次跑都会变,不进仓库" >> .gitignore` `>>` 追加。`#` 开头是注释行,写给将来的自己。
- `printf 'part01/data/intake.json` 用 printf 一次追加六行规则。其中 `part01/data/*_rejected.jsonl` 用通配符,Day 4 学过,`intake_rejected.jsonl` 和以后的同类文件都被它管住。
- `git check-ignore -v part01/data/report.txt part01/data/intake.json` 问 git 这两个文件被忽略了吗。
- `git rm --cached part01/data/report.txt` 一次列出六个文件,让 git 放弃登记,磁盘上的保留。
- `git add .gitignore` 规则文件本身要提交,别人才能共用这些规则。
- `git status --short` 提交前看一眼。
- `git commit -m "生成的数据文件不再进仓库"` 这一次提交里包含「六个文件被删除登记」和「`.gitignore` 的修改」。
- `ls part01/data` 确认磁盘上文件还在。

</div>

实测输出(`git check-ignore` 这一条是一个坑,放后面讲):

```text
rm 'part01/data/customers_ok.json'
rm 'part01/data/customers_rejected.jsonl'
rm 'part01/data/intake.json'
rm 'part01/data/intake_rejected.jsonl'
rm 'part01/data/recall_tickets.json'
rm 'part01/data/report.txt'
```

提交前的 `git status --short`:

```text
M  .gitignore
D  part01/data/customers_ok.json
D  part01/data/customers_rejected.jsonl
D  part01/data/intake.json
D  part01/data/intake_rejected.jsonl
D  part01/data/recall_tickets.json
D  part01/data/report.txt
```

`D ` 是「已暂存的删除」,意思是「从 git 的登记里删除」,不是从磁盘删除。提交之后:

```text
[master f0c55c2] 生成的数据文件不再进仓库
 7 files changed, 7 insertions(+), 137 deletions(-)
 delete mode 100644 part01/data/customers_ok.json
 ...
```

之后 `git status --short` 什么都没有,`ls part01/data` 里这些文件全都还在,而且你再运行脚本改动它们,`git status` 也不会提它们了。

那条 `git check-ignore -v` 在提交之前**什么也没打印**,哪怕规则已经写进了 `.gitignore`。原因是 `check-ignore` 默认不看已经被跟踪的文件:这些文件当时还在登记簿里,规则对它们不起作用,所以它不报告。想知道「规则本身有没有写对」,要加 `--no-index`。这是 `.gitignore` 只对未跟踪文件起作用的又一个表现。

</details>

验收标准:`git log --oneline` 里能看到你的第一次提交;`git status` 是 `working tree clean`;`git ls-files | grep env` 只列出 `.env.example`;练习 1 到 4 的输出和参考答案一致;你能在 `~/git-practice` 里不看文章,把「init → 建文件 → add → commit → 改 → diff → add → commit → log」整圈默写一遍。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 仓库(repository,repo) | 一个目录加上它的全部历史,历史存在里面的 `.git` 目录中。`git init` 就是建它 |
| 工作区 | 你平时编辑的那些文件本身 |
| 暂存区(staging area / index) | 「下一次提交要带上的内容」的托盘。`git add` 放进去,`git commit` 把里面的内容存档 |
| 提交(commit) | 历史上的一个存档点:所有被登记文件在那一刻的样子,加作者、时间和一句说明 |
| 提交编号(哈希) | 每次提交的唯一编号,40 位十六进制,平时只看前 7 位。每个人的都不同 |
| HEAD | 最新一次提交的名字。`HEAD~1` 是它的上一次 |
| 未跟踪(untracked) | git 看见了但没登记的文件,`status` 里显示 `??` |
| 已暂存(staged) | 已经 `add` 进暂存区的改动 |
| diff | 两个版本之间的差异,`+` 是新加的,`-` 是删掉的 |
| `git status --short` | 简短格式,每个文件一行,第一个字符是暂存区状态,第二个是工作区状态 |
| dry run / `-n` | 只预演、不真做,命令会说出「会做什么」 |
| `.git` 目录 | 仓库的数据库,别手动改,别删 |
| 分支(branch) | 一条提交时间线,`master` 或 `main` 是默认的那条。Day 57 详讲 |

## 常见误区

**不带 `-m` 提交,掉进编辑器出不来。** `git commit` 不写说明,git 会打开系统默认的文本编辑器(很多机器上是 vim)让你写。vim 里什么键都打不出字,不是你的错:按 `i` 进入输入模式,写完按 `Esc`,再输入 `:wq` 回车保存退出;想放弃就 `:q!`。说明留空时提交会被拒绝,实测(我把编辑器换成了一个什么都不写的命令来模拟):`Aborting commit due to empty commit message.`,退出码 1。新手阶段就一直用 `-m`。

**`git add .` 前不看 status。** `.` 是「当前目录下所有」。在 Day 53 之前的 lab 里,一个 `git add .` 就能把 `.env` 带进暂存区。今天的三道检查是养成的习惯,不是一次性的。

**以为 `.gitignore` 能把已经提交的文件「忽略掉」。** 它只对**还没被跟踪**的文件起作用。已经提交过的文件,要先 `git rm --cached` 让 git 放弃登记,再靠 `.gitignore` 防止它回来。

**提交后才发现 key 进去了,只删文件。** 历史里那一次的内容还在,`git show 旧提交:文件` 就能看到。key 作废才是第一步。

**add 之后又改文件,以为改动会跟着进提交。** 提交带的是 add 那一刻的样子。同一个文件在 `status` 里出现两次就是这个信号,再 add 一次。

**提交说明写成「修改」「更新」「aaa」。** 三个月后你看 `git log` 的时候,每一条都是废话。一句话写清「改了什么、为什么」,比如「intake 的用法提示写全命令」,中文完全可以。

**`git restore 文件`(不带 `--staged`)。** 它是丢弃工作区的改动,把文件恢复成暂存区或最新提交的样子,**没有后悔药**。`--staged` 只动暂存区,安全得多。用 `git restore 文件` 前先 `git diff` 看一眼,你要丢掉的到底是什么。

## 学习资料

### 文档与文章

- [Pro Git 中文版 · Git 基础 - 记录每次更新到仓库](https://git-scm.com/book/zh/v2/Git-%E5%9F%BA%E7%A1%80-%E8%AE%B0%E5%BD%95%E6%AF%8F%E6%AC%A1%E6%9B%B4%E6%96%B0%E5%88%B0%E4%BB%93%E5%BA%93):今天内容的权威版本,讲 status、add、diff、commit 和「文件的四种状态」,图画得很清楚。整本书是免费在线的。
- [Pro Git 中文版 · 起步 - Git 是什么?](https://git-scm.com/book/zh/v2/%E8%B5%B7%E6%AD%A5-Git-%E6%98%AF%E4%BB%80%E4%B9%88%EF%BC%9F):讲 git 为什么保存的是「快照」而不是一串差异,以及「三种状态」的由来,对应今天的三个地方。
- [Pro Git 中文版 · 初次运行 Git 前的配置](https://git-scm.com/book/zh/v2/%E8%B5%B7%E6%AD%A5-%E5%88%9D%E6%AC%A1%E8%BF%90%E8%A1%8C-Git-%E5%89%8D%E7%9A%84%E9%85%8D%E7%BD%AE):`user.name`、`user.email`、默认编辑器的设置。
- [git-diff 官方手册](https://git-scm.com/docs/git-diff):页首的 SYNOPSIS 把 `git diff`、`--cached`、`HEAD` 的各种组合列得很全,今天那张图的所有线都能在这里找到出处。
- [gitignore 官方手册](https://git-scm.com/docs/gitignore):规则语法的完整说明,`!`、`*`、`**`、目录和文件的区别都在这里。
- [Oh Shit, Git!?!](https://ohshitgit.com/zh):「做错了怎么办」的速查,按场景列出命令,有中文版。读一遍有个印象,出事了回来查。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1zrnc6dEXb&autoplay=0&high_quality=1" title="不会 Git 也能学会：Git 零基础入门教程" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>AI算法工程师Power · 不会 Git 也能学会:Git 零基础入门教程 · 约 16 分钟,2026 年。短,适合第一遍,看它怎么讲暂存区。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1HM411377j&autoplay=0&high_quality=1" title="【GeekHour】一小时Git教程" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>GeekHour · 一小时 Git 教程 · 时长约 2 小时,2023 年。讲得系统。今天只看开头 init、add、commit、log、diff 那几节;分支、远程是后两天的内容,到时候再回来看。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/mAFoROnOfHs" title="Git & GitHub Crash Course for Beginners [2026]" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>freeCodeCamp.org · Git & GitHub Crash Course for Beginners [2026] · 英文。有英文字幕可以开。看到 commit 和 log 的部分就够,GitHub 部分留给 Day 58。</figcaption>
</figure>

### 书籍

- 《Pro Git》(第二版),Scott Chacon 和 Ben Straub 著,Apress 出版,作者在 git-scm.com 上免费公开全文,有中文版(上面链接的就是)。第 2 章「Git 基础」对应今天,第 3 章「Git 分支」对应明天。不用买纸书,在线读就行。

### 开源项目与代码

- [git/git](https://github.com/git/git):git 本身的源码仓库。不是让你读 C 代码,而是看它的 `Documentation/` 目录里每个命令的原始手册,以及仓库本身的 `git log` 是什么样的:几十万次提交,每条说明都是一句话。

## 自测

1. 你改了 `notes.txt`,敲 `git diff` 什么都没有,但 `git status` 说它是 `modified`。可能发生了什么?

<details><summary>答案</summary>

这个文件已经 `git add` 过了。`git diff` 比较的是工作区和暂存区,两边一样,所以没有输出。改动在暂存区里,要用 `git diff --cached` 才看得到(暂存区对最新提交)。

</details>

2. `git add` 一个文件之后,又改了这个文件,然后 `git commit`。提交里有第二次的改动吗?

<details><summary>答案</summary>

没有。提交带的是 add 那一刻的样子。第二次的改动还留在工作区,`git status` 里这个文件会出现两次(待提交一次、未暂存一次)。要再 `git add` 一次才会进下一次提交。

</details>

3. 为什么要先 `git add -n .` 或者 `git status` 看一眼,再 `git add .`?

<details><summary>答案</summary>

`.` 会把当前目录下所有没被忽略的新文件和改动都放进暂存区。如果 `.gitignore` 没挡住 `.env` 或别的敏感文件,就会被一起带进下一次提交。预演和 status 能提前看到会加什么。

</details>

4. 不小心把 `.env` `add` 进了暂存区,还没 commit。在有过提交的仓库里怎么撤回?在一个还没有任何提交的新仓库里呢?

<details><summary>答案</summary>

有过提交:`git restore --staged .env`。没有任何提交:`git restore --staged` 会报 `fatal: could not resolve HEAD`,改用 `git rm --cached .env`。两条都只动暂存区,磁盘上的文件不受影响。

</details>

5. (面试题)线上发现有人把 API key 提交进了 git 仓库,第二天已经用 `git rm` 删掉并提交了。这样就安全了吗?你会怎么处理?

<details><summary>答案</summary>

不安全。历史里的旧提交仍然保存着那个 key,任何拿到仓库(或 fork、clone)的人用 `git log -p` 或 `git show 旧提交:文件` 都能看到。处理顺序:第一,立刻去厂商后台把这个 key 作废并换新的;第二,检查用量和调用来源有没有异常;第三,按需用 `git filter-repo` 等工具改写历史清理,并通知所有已经 clone 过的人。同时补上 `.gitignore`,以及在提交前或 CI 里加上密钥扫描,防止再发生。

</details>

6. `git log --oneline -- part01/intake.py` 里的 `--` 是干什么的?

<details><summary>答案</summary>

双横线是「选项到此结束,后面全是路径」的约定,避免路径被误当成选项或分支名。这条命令的意思是只显示改动过 `part01/intake.py` 的那些提交。

</details>

## 明天预告

明天是 [Day 57 · git(二):分支、合并和冲突](/blog/agent-zero/day-057-git-2/)。今天的历史是一条直线,每次提交接在上一次后面。可实际开发常常要「先试一个想法,不行就扔,行再并回来」,或者两个人同时改了同一个文件。这时候就要分支,以及合并时那个人人都怕的东西:冲突。明天会故意制造一次冲突,看清楚它长什么样,再把它解决掉。
