---
title: 'Day 57 · git(二):分支、合并和冲突'
description: '分支不是复制文件夹,只是一个会跟着提交走的名字。先在练习目录里建分支、切分支、快进合并、生成合并提交,再故意制造一次冲突并解决,然后在 agent-zero-lab 里走一遍真的。最后还上 Day 56 欠的账:把提交错的东西用 reset 退回去。'
pubDate: 2026-10-23
regime: none
tags: ['git', 'agent-zero']
series: 'agent-zero'
day: 57
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 56](/blog/agent-zero/day-056-git-1/) 把 git 最小的一圈走通了:工作区改文件,`git add` 放进暂存区,`git commit` 存进历史,`git log` 看历史,`git diff` 看差别。`agent-zero-lab` 也完成了第一次提交,提交前还做了三道检查,保证 `.env` 没混进去。那一天的历史是一条直线,每次提交都接在上一次后面。

直线只够一个人、一件事、一路往前。真实的开发很少这么干净:你写到一半,想先试一个不确定的想法;或者临时要修一个小问题,不想把写了一半的东西带进去;或者两个人同时改了同一个文件。这些全靠**分支**。今天讲分支怎么建、怎么切、怎么合,以及合的时候最让新手发怵的**冲突**。Day 56 末尾还欠了一笔账:提交错了怎么退回去,我说留到今天,放在最后还。

## 今天要解决的问题

学完今天,你应该能:

1. 说清分支到底是什么(一个指向某次提交的名字),会用 `git switch -c` 新建分支、`git switch` 来回切、`git branch` 看有哪些,并解释切换时工作区的文件为什么会跟着变。
2. 用 `git merge` 把分支合回 `master`,分得清**快进合并**和**合并提交**两种结果,并在 `git log --graph` 里认出它们。
3. 故意制造一次冲突,看懂 `<<<<<<<`、`=======`、`>>>>>>>` 三行标记各是谁的内容,把它改成想要的样子并完成合并;中途想放弃,会用 `git merge --abort`。
4. 在 `agent-zero-lab` 里完成一次带冲突的合并;提交错了(还没推到网上)的时候,会用 `git reset` 退回去。

预计用时:2.5 小时。前置:[Day 56](/blog/agent-zero/day-056-git-1/) 的 add、commit、log、diff、status,以及 [Day 3](/blog/agent-zero/day-003-terminal-1/) 到 [Day 5](/blog/agent-zero/day-005-terminal-3/) 的终端基本功。

学法:先对照文章逐行敲一遍(不要复制粘贴)并跑通;第二天合上文章,在一个新目录里把「建分支、两边各提交一次、合并、制造冲突、解决冲突」整圈默写出来;再做动手练习,做不出来再展开参考答案,看完关掉自己重写一遍。

今天不写 Python(只有练习 4 里有一个很短的文件),不调 API,花费 0 元。会用到两个目录:新的练习目录 `~/branch-practice`,和你的 `~/agent-zero-lab`。

先交代环境。我这台 Mac 上 git 是系统自带的 `2.24.3 (Apple Git-128)`。三点要知道。第一,切分支我用的是 `git switch`,它从 git 2.23 才有;你的版本更新,当然有;如果比 2.23 旧,把 `git switch` 换成 `git checkout`,把 `git switch -c` 换成 `git checkout -b`,效果一样,网上大量老教程用的就是 checkout。第二,默认分支在我的版本里叫 `master`,新版 git 的默认名可能是 `main`,下面看到 `master` 就换成你自己的那个,逻辑不变(Day 58 推 GitHub 时会把它统一成 `main`)。第三,为了不碰我自己机器上的 git 配置,所有命令都用一个假的家目录,里面配了名字 `学习者` 和邮箱 `learner@example.com`;你的配置是 Day 56 设好的,不用重设。输出里的长路径缩短了,家目录写成 `/Users/你`,提交编号(7 位十六进制)每个人都不同,看结构别对数字。

## 先想清楚:分支到底是什么

很多人第一次听到分支,脑子里是「把整个项目文件夹复制一份」。不是。git 里的分支小得多:**一个分支就是一个名字,指向某一次提交**。就这么多。

回忆一下,每次提交都记着「我的上一次提交是谁」,所以提交天然串成一条链。分支名只是贴在链上某个位置的一张标签。`master` 这张标签贴在最新那次提交上,你每提交一次,git 就把标签往前挪一格。再多一个 `HEAD`:它指的是「你现在站在哪个分支上」,Day 56 说过 `HEAD` 是最新一次提交的名字,更准确的说法是,`HEAD` 先指向一个分支名,分支名再指向提交。

<figure>
<svg viewBox="0 0 640 250" role="img" aria-label="分支是标签:四次提交 c1 到 c4 串成一条链;master 标签贴在 c2,feature-faq 标签贴在 c4,HEAD 指向 feature-faq;c3 和 c4 只属于 feature-faq">
<rect x="0" y="0" width="640" height="250" fill="var(--paper-raised)" rx="6"/>
<g font-family="var(--font-mono)" font-size="12">
<line x1="86" y1="130" x2="226" y2="130" stroke="var(--ink-soft)"/>
<line x1="266" y1="130" x2="406" y2="130" stroke="var(--ink-soft)"/>
<line x1="446" y1="130" x2="566" y2="130" stroke="var(--ink-soft)"/>
<circle cx="66" cy="130" r="20" fill="var(--paper-raised)" stroke="var(--ink)"/>
<text x="66" y="134" text-anchor="middle" fill="var(--ink)">c1</text>
<circle cx="246" cy="130" r="20" fill="var(--paper-raised)" stroke="var(--ink)"/>
<text x="246" y="134" text-anchor="middle" fill="var(--ink)">c2</text>
<circle cx="426" cy="130" r="20" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="426" y="134" text-anchor="middle" fill="var(--ink)">c3</text>
<circle cx="586" cy="130" r="20" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="586" y="134" text-anchor="middle" fill="var(--ink)">c4</text>
<text x="156" y="122" text-anchor="middle" fill="var(--ink-faint)" font-size="11">上一次是</text>
<rect x="196" y="40" width="100" height="30" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="246" y="60" text-anchor="middle" fill="var(--ink)">master</text>
<line x1="246" y1="70" x2="246" y2="108" stroke="var(--mem)"/>
<rect x="520" y="40" width="132" height="30" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="586" y="60" text-anchor="middle" fill="var(--ink)">feature-faq</text>
<line x1="586" y1="70" x2="586" y2="108" stroke="var(--compute)"/>
<rect x="520" y="190" width="132" height="30" rx="4" fill="var(--paper-raised)" stroke="var(--ink)"/>
<text x="586" y="210" text-anchor="middle" fill="var(--ink)">HEAD</text>
<line x1="586" y1="190" x2="586" y2="152" stroke="var(--ink)"/>
<text x="578" y="176" text-anchor="end" fill="var(--ink-faint)" font-size="11">我在这个分支上</text>
<text x="16" y="24" fill="var(--ink-faint)" font-size="11">圆点是提交,方框是标签,标签只是指针</text>
</g>
</svg>
<figcaption>master 贴在 c2,feature-faq 贴在 c4,HEAD 站在 feature-faq 上。c3、c4 只在 feature-faq 这条线上,master 看不见它们。</figcaption>
</figure>

这张图对应下面第一步要做的事。有两个推论先记住:

**新建分支几乎不花时间,也不占地方**,因为只是多贴一张标签,没有复制任何文件。所以 git 鼓励你随手开分支:试个想法开一个,修个小问题开一个,不要了就删。

**切换分支时工作区的文件会变**,这一点最让前端同学意外。你站在 `feature-faq` 上,目录里有 `faq.txt`;切回 `master`,这个文件会**消失**,因为 `master` 指向的那次提交里没有它。不是被删了,是 git 按目标提交的样子把工作区重新摆了一遍,切回来它又在了。

## 第一步:建分支、切分支

在家目录新建练习目录,放两次提交打底:

```bash
mkdir ~/branch-practice
cd ~/branch-practice
git init
printf '第一行:云簿工单备忘\n第二行:退款 3 个工作日到账\n' > notes.txt
git add notes.txt
git commit -m "第一次提交:加入 notes.txt"
printf 'def hello():\n    return "你好"\n' > app.py
git add app.py
git commit -m "加入 app.py"
git log --oneline --decorate
```

<div class="line-notes">

- `mkdir ~/branch-practice` 新目录,和 Day 56 的 `~/git-practice` 分开,这样今天怎么折腾都不影响昨天的。
- `printf '第一行:云簿工单备忘\n第二行:退款 3 个工作日到账\n' > notes.txt` 一次写两行。`\n` 是换行,`>` 是覆盖写入(Day 5)。这个文件今天会反复被改,是冲突演示的主角。
- `git log --oneline --decorate` `--decorate` 的意思是「把标签画出来」。你在真终端里敲,`--oneline` 默认就会带括号标签;我这里的输出是脚本抓下来的,不是终端,所以要手动写上这个开关,才能和你屏幕上一致。

</div>

实测输出:

```text
Initialized empty Git repository in /Users/你/branch-practice/.git/
e28327e (HEAD -> master) 加入 app.py
478fe37 第一次提交:加入 notes.txt
```

最后两行里的 `(HEAD -> master)` 就是图里的样子:`HEAD` 指向 `master`,`master` 贴在最新一次提交上。

现在看有哪些分支,再新建一个。我们要加一份常见问题 `faq.txt`,先开个分支专门干这件事:

```bash
git branch
git switch -c feature-faq
git branch
git log --oneline --decorate
```

<div class="line-notes">

- `git branch` 不带参数就是列出所有本地分支,前面带 `*` 的是你现在站的这个。
- `git switch -c feature-faq` `switch` 是切换,`-c` 是 create(创建):新建一个叫 `feature-faq` 的分支并立刻站上去。名字随便起,习惯用「类型-内容」的短横线风格。
- `git log --oneline --decorate` 看看新标签贴在哪。

</div>

实测输出:

```text
* master
```

```text
Switched to a new branch 'feature-faq'
```

```text
* feature-faq
  master
```

```text
e28327e (HEAD -> feature-faq, master) 加入 app.py
478fe37 第一次提交:加入 notes.txt
```

第四段说得很清楚:新分支一建好,`master` 和 `feature-faq` **贴在同一次提交上**,没有任何新东西产生。`HEAD` 现在指向 `feature-faq`。接着在这个分支上干活:给 `notes.txt` 加一行,再新建 `faq.txt`,分两次提交。

```bash
echo "第三行:发票可以重开" >> notes.txt
printf '常见问题\n1. 退款几天到账?3 个工作日\n' > faq.txt
git status --short
git commit -am "notes 加发票说明"
git status --short
git add faq.txt
git commit -m "加入 faq.txt"
git log --oneline --decorate
```

<div class="line-notes">

- `echo "第三行:发票可以重开" >> notes.txt` `>>` 是追加(Day 5),`notes.txt` 变成三行。
- `git status --short` 第一次会看到两行:` M notes.txt`(已跟踪的文件被改了)和 `?? faq.txt`(新文件,还没登记)。
- `git commit -am "notes 加发票说明"` `-a` 是「把所有**已跟踪**文件的改动自动放进暂存区再提交」,相当于省掉一次 `git add notes.txt`。注意它只管已经登记过的文件,不会碰 `faq.txt`。`-am` 是 `-a` 和 `-m` 连写。
- `git status --short` 第二次只剩 `?? faq.txt`,证明 `-a` 没有把新文件带进去。
- `git add faq.txt` 新文件必须手动 add。
- `git commit -m "加入 faq.txt"` 第二次提交。分支标签随着每次提交往前挪了一格。

</div>

实测输出:

```text
 M notes.txt
?? faq.txt
```

```text
[feature-faq 3dae528] notes 加发票说明
 1 file changed, 1 insertion(+)
```

```text
?? faq.txt
```

```text
[feature-faq 689c62d] 加入 faq.txt
 1 file changed, 2 insertions(+)
 create mode 100644 faq.txt
```

```text
689c62d (HEAD -> feature-faq) 加入 faq.txt
3dae528 notes 加发票说明
e28327e (master) 加入 app.py
478fe37 第一次提交:加入 notes.txt
```

对照图:`feature-faq` 往前走了两格(`3dae528`、`689c62d`),`master` 还留在 `e28327e`,标签没动。现在验证「切分支,文件跟着变」:

```bash
ls
git switch master
ls
git log --oneline --decorate --all
```

<div class="line-notes">

- `ls` 在 `feature-faq` 上看目录,应该有 `app.py`、`faq.txt`、`notes.txt` 三个文件。
- `git switch master` 切回 `master`。
- `ls` 再看一次,`faq.txt` 应该不见了。
- `git log --oneline --decorate --all` `--all` 是「把所有分支上的提交都列出来」,不加的话只显示你当前这个分支能走到的。

</div>

实测输出:

```text
app.py
faq.txt
notes.txt
```

```text
Switched to branch 'master'
```

```text
app.py
notes.txt
```

```text
689c62d (feature-faq) 加入 faq.txt
e28327e (HEAD -> master) 加入 app.py
3dae528 notes 加发票说明
478fe37 第一次提交:加入 notes.txt
```

`faq.txt` 真的没了。再看一眼 `notes.txt` 里有没有「第三行」,有兴趣的话自己 `cat` 一下:`master` 上它只有两行,因为发票那次提交只属于 `feature-faq`。最后一段输出里 `e28327e` 排在 `3dae528` 前面看着别扭,这是因为这几次提交发生在同一秒,`--oneline` 按时间排序时分不出先后,加 `--graph` 就会按连接关系画(下一步用)。

标签真的只是指针,你可以亲眼看到它存在哪:

```bash
cat .git/HEAD
cat .git/refs/heads/master
cat .git/refs/heads/feature-faq
```

实测输出:

```text
ref: refs/heads/master
```

```text
e28327e11c9eee77316aa20f5117ebf1129eb90b
```

```text
689c62d460f62a86230c933bc6f708451e17b23a
```

`.git/HEAD` 里写着「我指向 `refs/heads/master` 这个分支」;`refs/heads/` 目录下每个分支是一个小文件,**文件内容就是它指向的那次提交的完整编号**(40 位,前 7 位对得上上面的 `e28327e` 和 `689c62d`)。所谓「新建分支」,就是在这个目录里新建一个只有 41 个字符的文件。别手动改它们,看一眼知道原理就够了。

## 第二步:合并(一):快进

`feature-faq` 上的活干完了,要把它并回 `master`。规则是:**站在要接收的分支上,执行 `git merge 要并进来的分支`**。所以先站在 `master`(上一步已经切回来了),然后:

```bash
git merge feature-faq
git log --oneline --decorate --graph --all
```

<div class="line-notes">

- `git merge feature-faq` 把 `feature-faq` 的内容并进当前分支(`master`)。方向要想清楚:谁在 `HEAD` 上,谁就是被并入的那一个。
- `git log --oneline --decorate --graph --all` `--graph` 在左边用字符画出分支的连接关系,一眼看出分叉和合并。

</div>

实测输出:

```text
Updating e28327e..689c62d
Fast-forward
 faq.txt   | 2 ++
 notes.txt | 1 +
 2 files changed, 3 insertions(+)
 create mode 100644 faq.txt
```

```text
* 689c62d (HEAD -> master, feature-faq) 加入 faq.txt
* 3dae528 notes 加发票说明
* e28327e 加入 app.py
* 478fe37 第一次提交:加入 notes.txt
```

输出里的 `Fast-forward`(快进)是关键词。道理很简单:`master` 自从 `feature-faq` 分出去以后**一次提交都没有多**,它和 `feature-faq` 在同一条直线上,只是落后了两格。这种情况下合并不需要「合」,git 只要把 `master` 这张标签往前挪两格,贴到 `689c62d` 上就行,没有产生任何新提交。看最后的图,两个标签现在贴在同一次提交上,历史仍然是一条直线。

分支的任务完成了,可以删掉标签(提交本身一个都不会丢,因为 `master` 也指着它们):

```bash
git branch -d feature-faq
git branch
```

实测输出:

```text
Deleted branch feature-faq (was 689c62d).
```

```text
* master
```

`-d` 是 delete。`was 689c62d` 告诉你被删的标签原来贴在哪,万一删错了,拿这个编号 `git branch 名字 689c62d` 就能重新贴回去。

## 第三步:合并(二):两边都有新提交

快进只发生在一边没动的时候。更常见的情形是你开了分支做事,这段时间 `master` 上也有了新提交。造一个:先开 `feature-greeting` 把 `hello` 函数改成接收名字,再切回 `master` 改 `notes.txt`,两边各提交一次。

```bash
git switch -c feature-greeting
printf 'def hello(name):\n    return f"你好,{name}"\n' > app.py
git commit -am "hello 改成接收名字"
git switch master
echo "第四行:发票抬头可改" >> notes.txt
git commit -am "notes 加抬头说明"
git log --oneline --decorate --graph --all
```

<div class="line-notes">

- `git switch -c feature-greeting` 从当前的 `master`(此时在 `689c62d`)分出新分支。
- `printf 'def hello(name):\n    return f"你好,{name}"\n' > app.py` 把 `app.py` 整个重写成新版本。`f"你好,{name}"` 是 f-string([Day 15](/blog/agent-zero/day-015-strings-1/) 讲过),把 `name` 的值嵌进字符串。今天只关心这个文件被整个改了,不关心内容。
- `git commit -am "hello 改成接收名字"` 提交在 `feature-greeting` 上。`app.py` 是已跟踪文件,`-a` 够用。
- `git switch master` 切回去。此时 `app.py` 自动变回旧版本。
- `echo "第四行:发票抬头可改" >> notes.txt` 在 `master` 上改的是**另一个文件**,和分支那边不相干。
- `git commit -am "notes 加抬头说明"` 提交在 `master` 上,所以现在 `master` 也往前走了一格。

</div>

实测输出(中间的提交回显略去):

```text
* 562b7d8 (feature-greeting) hello 改成接收名字
| * 43dad01 (HEAD -> master) notes 加抬头说明
|/  
* 689c62d 加入 faq.txt
* 3dae528 notes 加发票说明
* e28327e 加入 app.py
* 478fe37 第一次提交:加入 notes.txt
```

历史**分叉**了:从 `689c62d` 往下分出两条线,各自多了一次提交。现在合并:

```bash
git merge feature-greeting
git log --oneline --decorate --graph
```

实测输出:

```text
Merge made by the 'recursive' strategy.
 app.py | 4 ++--
 1 file changed, 2 insertions(+), 2 deletions(-)
```

```text
*   36c728a (HEAD -> master) Merge branch 'feature-greeting'
|\  
| * 562b7d8 (feature-greeting) hello 改成接收名字
* | 43dad01 notes 加抬头说明
|/  
* 689c62d 加入 faq.txt
* 3dae528 notes 加发票说明
* e28327e 加入 app.py
* 478fe37 第一次提交:加入 notes.txt
```

这次没有 `Fast-forward`。git 找到两条线分叉的地方(`689c62d`,叫**共同祖先**),看两边各自改了什么:一边改了 `app.py`,另一边改了 `notes.txt`,互不相干,就**自动把两边的改动都套上去**,存成一次**新的提交** `36c728a`,这叫**合并提交**。它的说明是 git 自动写的 `Merge branch 'feature-greeting'`。在真终端里敲 `git merge`,git 会先弹出编辑器让你确认这句说明(vim 的话 `:wq` 保存退出),我这边是脚本环境没有弹;想跳过确认就加 `--no-edit`。

合并提交特殊在哪?看它的内容:

```bash
git cat-file -p HEAD
```

<div class="line-notes">

- `git cat-file -p HEAD` `cat-file` 是 git 的底层命令,`-p` 是 pretty-print(漂亮地打印),`HEAD` 是要看的对象。普通提交有一个 `parent`,这条会让你看到合并提交有两个。

</div>

实测输出:

```text
tree 39b403e32b1df45b56fcb87c59d02a5e68b83faa
parent 43dad013feb42ab3bcb5f3444ded4ea24d1cd94a
parent 562b7d8ce5b40db98c1225e9d7c915777cac757c
author 学习者 <learner@example.com> 1792727141 +0800
committer 学习者 <learner@example.com> 1792727141 +0800

Merge branch 'feature-greeting'
```

两行 `parent`:合并提交有**两个上一次**,一个是 `master` 那边的 `43dad01`,一个是分支那边的 `562b7d8`。图里那个小菱形,就是这个意思。

<figure>
<svg viewBox="0 0 640 300" role="img" aria-label="两种合并。上图快进:master 落后于 feature,合并只是把 master 标签向前挪到 c4,没有新提交。下图合并提交:master 和 feature 各有新提交,合并生成一个有两个父提交的新提交 M">
<rect x="0" y="0" width="640" height="300" fill="var(--paper-raised)" rx="6"/>
<g font-family="var(--font-mono)" font-size="12">
<text x="16" y="22" fill="var(--ink-faint)" font-size="11">快进:master 没有新提交,只挪标签</text>
<line x1="60" y1="62" x2="120" y2="62" stroke="var(--ink-soft)"/>
<line x1="150" y1="62" x2="210" y2="62" stroke="var(--ink-soft)"/>
<line x1="240" y1="62" x2="300" y2="62" stroke="var(--ink-soft)"/>
<circle cx="40" cy="62" r="18" fill="var(--paper-raised)" stroke="var(--ink)"/><text x="40" y="66" text-anchor="middle" fill="var(--ink)">c1</text>
<circle cx="135" cy="62" r="18" fill="var(--paper-raised)" stroke="var(--ink)"/><text x="135" y="66" text-anchor="middle" fill="var(--ink)">c2</text>
<circle cx="225" cy="62" r="18" fill="var(--compute-wash)" stroke="var(--compute)"/><text x="225" y="66" text-anchor="middle" fill="var(--ink)">c3</text>
<circle cx="315" cy="62" r="18" fill="var(--compute-wash)" stroke="var(--compute)"/><text x="315" y="66" text-anchor="middle" fill="var(--ink)">c4</text>
<rect x="95" y="94" width="80" height="24" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/><text x="135" y="110" text-anchor="middle" fill="var(--ink)">master</text>
<rect x="265" y="94" width="100" height="24" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/><text x="315" y="110" text-anchor="middle" fill="var(--ink)">feature</text>
<text x="400" y="66" fill="var(--ink)">merge →</text>
<line x1="500" y1="62" x2="540" y2="62" stroke="var(--ink-soft)"/>
<circle cx="480" cy="62" r="14" fill="var(--paper-raised)" stroke="var(--ink)"/><text x="480" y="66" text-anchor="middle" fill="var(--ink)" font-size="11">c3</text>
<circle cx="560" cy="62" r="14" fill="var(--compute-wash)" stroke="var(--compute)"/><text x="560" y="66" text-anchor="middle" fill="var(--ink)" font-size="11">c4</text>
<rect x="520" y="90" width="120" height="24" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/><text x="580" y="106" text-anchor="middle" fill="var(--ink)" font-size="11">master,feature</text>
<line x1="16" y1="146" x2="624" y2="146" stroke="var(--rule)" stroke-dasharray="4 3"/>
<text x="16" y="170" fill="var(--ink-faint)" font-size="11">合并提交:两边都有新提交,生成一个有两个父亲的 M</text>
<circle cx="60" cy="230" r="18" fill="var(--paper-raised)" stroke="var(--ink)"/><text x="60" y="234" text-anchor="middle" fill="var(--ink)">c2</text>
<line x1="78" y1="226" x2="162" y2="198" stroke="var(--ink-soft)"/>
<line x1="78" y1="234" x2="162" y2="262" stroke="var(--ink-soft)"/>
<circle cx="180" cy="196" r="18" fill="var(--mem-wash)" stroke="var(--mem)"/><text x="180" y="200" text-anchor="middle" fill="var(--ink)">c3</text>
<circle cx="180" cy="264" r="18" fill="var(--compute-wash)" stroke="var(--compute)"/><text x="180" y="268" text-anchor="middle" fill="var(--ink)">f1</text>
<line x1="198" y1="198" x2="282" y2="224" stroke="var(--ink-soft)"/>
<line x1="198" y1="262" x2="282" y2="236" stroke="var(--ink-soft)"/>
<circle cx="300" cy="230" r="20" fill="var(--paper-raised)" stroke="var(--ink)" stroke-width="2"/><text x="300" y="234" text-anchor="middle" fill="var(--ink)">M</text>
<rect x="250" y="262" width="100" height="24" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/><text x="300" y="278" text-anchor="middle" fill="var(--ink)">master</text>
<text x="380" y="200" fill="var(--ink-soft)" font-size="11">c3 是 master 那边的新提交</text>
<text x="380" y="222" fill="var(--ink-soft)" font-size="11">f1 是分支那边的新提交</text>
<text x="380" y="244" fill="var(--ink-soft)" font-size="11">M 的两个 parent 就是 c3 和 f1</text>
<text x="380" y="266" fill="var(--ink-soft)" font-size="11">c2 叫共同祖先</text>
</g>
</svg>
<figcaption>上:快进只挪标签,没有新提交,历史还是直线。下:两边都有新提交时,git 生成一次有两个 parent 的合并提交 M,历史里留下一个菱形。</figcaption>
</figure>

看合并结果,两边的改动都在:

```bash
cat app.py
git branch -d feature-greeting
```

实测输出:

```text
def hello(name):
    return f"你好,{name}"
```

```text
Deleted branch feature-greeting (was 562b7d8).
```

`app.py` 是分支那边的新版本,`notes.txt` 里有 `master` 那边加的第四行,各自的改动都保留了。这个自动合并之所以成功,是因为**两边改的不是同一处**。下面要演示的就是同一处被改的时候。

## 第四步:删不掉的分支,和切不过去的分支

两个小坑放在冲突之前讲,因为你一定会遇到。

**坑一:`-d` 拒绝删除没合并过的分支。** 开一个试验分支,提交一次,切回 `master`,再删它:

```bash
git switch -c scratch-idea
echo "实验:一个没想好的功能" > idea.txt
git add idea.txt
git commit -m "试一个想法"
git switch master
git branch -d scratch-idea
git branch -D scratch-idea
```

<div class="line-notes">

- `git switch -c scratch-idea` 开一条试验分支。
- `echo "实验:一个没想好的功能" > idea.txt` / `git add idea.txt` / `git commit -m "试一个想法"` 在分支上提交一个新文件,这次提交**只属于**这条分支。
- `git switch master` 回到 `master`,它和 `scratch-idea` 现在是分叉的,没合并过。
- `git branch -d scratch-idea` 小写 `-d` 是安全删除:git 检查这个分支的提交是不是都已经在别的分支里了,不是就拒绝。
- `git branch -D scratch-idea` 大写 `-D` 是强制删除,不检查。

</div>

实测输出:

```text
error: The branch 'scratch-idea' is not fully merged.
If you are sure you want to delete it, run 'git branch -D scratch-idea'.
```

```text
Deleted branch scratch-idea (was 24e263c).
```

`not fully merged` 的意思是:这个分支上有提交,是别的分支里没有的,直接删标签会让这次提交变得没人指着,以后很难找回。git 在保护你。确定这个想法不要了,再用大写 `-D`。(`-D` 之后那次提交也不是立刻消失,下面讲 reflog 时会看到它还留一阵子。)

**坑二:带着没提交的改动切分支。** 在两条分支之间切换,git 要把工作区重新摆一遍。如果你有没提交的改动,会怎样?分两种情况。先造一个场景:`feature-x` 分支里改了 `notes.txt` 并提交,切回 `master`,然后在 `master` 上**也**改 `notes.txt`,不提交,再想切过去:

```bash
git switch -c feature-x
echo "第五行:feature-x 的改动" >> notes.txt
git commit -am "feature-x 改 notes"
git switch master
echo "第五行:master 上没提交的改动" >> notes.txt
git switch feature-x
```

实测输出(只留最后一条命令的):

```text
error: Your local changes to the following files would be overwritten by checkout:
	notes.txt
Please commit your changes or stash them before you switch branches.
Aborting
```

git 拒绝了:切过去会把你没提交的那一行**覆盖掉**,而且没有后悔药,所以它不让。提示里说「commit 或者 stash」。先提交是最朴素的办法;`stash` 是把改动临时收进抽屉,以后再学,今天不用。

第二种情况:你没提交的改动在一个**两条分支里都没差别**的文件上。先把刚才那行丢掉(`git restore notes.txt`,Day 56 讲过这条没有后悔药),然后改 `app.py`(`feature-x` 没碰过它),再切:

```bash
git restore notes.txt
echo "# 草稿" >> app.py
git switch feature-x
git status --short
```

实测输出:

```text
Switched to branch 'feature-x'
M	app.py
```

```text
 M app.py
```

这次切成功了,而且你的改动**跟着你过去了**:`M app.py` 是 git 在告诉你「这个文件带着未提交的改动一起切过来了」。因为两条分支上的 `app.py` 一样,没有东西会被覆盖。所以更准确的规则是:**切分支会带走没提交的改动,除非这些改动会被目标分支的内容覆盖**。更省心的习惯是:切分支之前先 `git status`,有改动要么提交要么丢掉,再切。(演示完收拾一下:`git restore app.py`,`git switch master`,`git branch -D feature-x`。)

## 第五步:冲突

终于到冲突了。先把它想明白,就没那么吓人。

git 合并时的做法是**三方比较**:找到两边的共同祖先,看「祖先 → 这边」改了哪些行,再看「祖先 → 那边」改了哪些行。两边改的行不重叠,就自动都套上去(上一步的结果)。**两边改了同一行,而且改成了不一样的内容**,git 没法替你判断该听谁的,就停下来,把问题交还给你。这就是冲突。它不是出错,是 git 在问你:这一行到底要什么?

造一个。`notes.txt` 里第二行现在是「退款 3 个工作日到账」。开分支 `refund-5days` 把它改成 5 天;再回 `master` 把同一行改成「3 个工作日,信用卡 7 天」。

```bash
git switch -c refund-5days
sed -i '' 's/^第二行.*/第二行:退款 5 个工作日到账(含节假日)/' notes.txt
git commit -am "退款时间改成 5 个工作日"
git switch master
sed -i '' 's/^第二行.*/第二行:退款 3 个工作日到账,信用卡 7 天/' notes.txt
git commit -am "补充信用卡退款时间"
git log --oneline --decorate --graph --all -5
git merge-base master refund-5days
```

<div class="line-notes">

- `sed -i '' 's/^第二行.*/第二行:退款 5 个工作日到账(含节假日)/' notes.txt` `sed` 是按规则改文本的命令,这里的意思是「找到以 `第二行` 开头的那一行,整行换成斜杠后面那句」。`-i ''` 表示直接改文件本身;macOS 的 sed 要求 `-i` 后面必须跟一个备份后缀,给空字符串就是不备份,Linux 上写成 `sed -i`。你也可以直接用编辑器改,效果一样。
- `git commit -am "退款时间改成 5 个工作日"` 提交在分支上。
- `git switch master` 回来。
- `sed -i '' 's/^第二行.*/第二行:退款 3 个工作日到账,信用卡 7 天/' notes.txt` 在 `master` 上把**同一行**改成了不同内容。
- `git log --oneline --decorate --graph --all -5` 最后的 `-5` 是只看最近 5 行。
- `git merge-base master refund-5days` 打印两个分支的共同祖先,也就是 git 做三方比较的起点。

</div>

实测输出:

```text
* b349460 (HEAD -> master) 补充信用卡退款时间
| * f17e994 (refund-5days) 退款时间改成 5 个工作日
|/  
*   36c728a Merge branch 'feature-greeting'
|\  
| * 562b7d8 hello 改成接收名字
* | 43dad01 notes 加抬头说明
|/  
```

```text
36c728acf7f9ed125029094223d23f5270730215
```

共同祖先是上一步那次合并提交 `36c728a`,两边都从它出发,各改了第二行。现在合并:

```bash
git merge refund-5days
git status
git status --short
```

实测输出:

```text
Auto-merging notes.txt
CONFLICT (content): Merge conflict in notes.txt
Automatic merge failed; fix conflicts and then commit the result.
```

```text
On branch master
You have unmerged paths.
  (fix conflicts and run "git commit")
  (use "git merge --abort" to abort the merge)

Unmerged paths:
  (use "git add <file>..." to mark resolution)
	both modified:   notes.txt

no changes added to commit (use "git add" and/or "git commit -a")
```

```text
UU notes.txt
```

三个信息:`CONFLICT (content): Merge conflict in notes.txt` 说哪个文件冲突;`Automatic merge failed` 说合并停在半路,**没有完成**;`status` 里 `both modified` 是「两边都改过」,简短格式是 `UU`(Unmerged 两个字符都是 U)。重要的是此刻仓库处于「正在合并」的中间状态,别的文件已经合好放进暂存区了,只有冲突的这个等你处理。

### 打开文件,看标记

git 把两边的内容都写进了文件,中间用三种标记隔开:

```bash
cat notes.txt
```

实测输出:

```text
第一行:云簿工单备忘
<<<<<<< HEAD
第二行:退款 3 个工作日到账,信用卡 7 天
=======
第二行:退款 5 个工作日到账(含节假日)
>>>>>>> refund-5days
第三行:发票可以重开
第四行:发票抬头可改
```

<figure>
<svg viewBox="0 0 640 250" role="img" aria-label="冲突标记的结构:HEAD 到等号线之间是当前分支 master 的版本;等号线到 refund-5days 之间是被并入分支的版本;标记之外的行两边相同";>
<rect x="0" y="0" width="640" height="250" fill="var(--paper-raised)" rx="6"/>
<g font-family="var(--font-mono)" font-size="12">
<rect x="16" y="20" width="360" height="210" rx="4" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="28" y="44" fill="var(--ink-soft)">第一行:云簿工单备忘</text>
<rect x="16" y="56" width="360" height="22" fill="var(--mem-wash)"/>
<text x="28" y="72" fill="var(--ink)">&lt;&lt;&lt;&lt;&lt;&lt;&lt; HEAD</text>
<rect x="16" y="78" width="360" height="26" fill="var(--mem-wash)"/>
<text x="28" y="96" fill="var(--ink)">第二行:退款 3 个工作日到账,信用卡 7 天</text>
<rect x="16" y="104" width="360" height="22" fill="var(--paper-raised)"/>
<text x="28" y="120" fill="var(--ink)">=======</text>
<rect x="16" y="126" width="360" height="26" fill="var(--compute-wash)"/>
<text x="28" y="144" fill="var(--ink)">第二行:退款 5 个工作日到账(含节假日)</text>
<rect x="16" y="152" width="360" height="22" fill="var(--compute-wash)"/>
<text x="28" y="168" fill="var(--ink)">&gt;&gt;&gt;&gt;&gt;&gt;&gt; refund-5days</text>
<text x="28" y="196" fill="var(--ink-soft)">第三行:发票可以重开</text>
<text x="28" y="216" fill="var(--ink-soft)">第四行:发票抬头可改</text>
<line x1="376" y1="90" x2="410" y2="90" stroke="var(--mem)"/>
<text x="416" y="86" fill="var(--ink)" font-size="12">上半:我这边</text>
<text x="416" y="104" fill="var(--ink-soft)" font-size="11">当前所在分支 master 的版本</text>
<line x1="376" y1="140" x2="410" y2="140" stroke="var(--compute)"/>
<text x="416" y="136" fill="var(--ink)" font-size="12">下半:对方</text>
<text x="416" y="154" fill="var(--ink-soft)" font-size="11">被并进来的分支的版本</text>
<text x="416" y="196" fill="var(--ink-soft)" font-size="11">标记之外的行,两边一致</text>
<text x="416" y="214" fill="var(--ink-soft)" font-size="11">不用管,git 已经合好了</text>
</g>
</svg>
<figcaption>三种标记把冲突那一块圈出来:<code>&lt;&lt;&lt;&lt;&lt;&lt;&lt;</code> 开头,<code>=======</code> 分隔,<code>&gt;&gt;&gt;&gt;&gt;&gt;&gt;</code> 结尾。</figcaption>
</figure>

读法:`<<<<<<< HEAD` 和 `=======` 之间是**你现在所在分支**(`HEAD` 指的就是 `master`)的版本;`=======` 和 `>>>>>>> refund-5days` 之间是**要并进来的那个分支**的版本。标记以外的行(第一、三、四行)两边相同,没有问题。

此刻 `git diff` 也变了样,它用一种叫「合并差异」的格式显示冲突,两列加号分别代表两边:

```text
diff --cc notes.txt
index a7084d3,a86313b..0000000
--- a/notes.txt
+++ b/notes.txt
@@@ -1,4 -1,4 +1,8 @@@
  第一行:云簿工单备忘
++<<<<<<< HEAD
 +第二行:退款 3 个工作日到账,信用卡 7 天
++=======
+ 第二行:退款 5 个工作日到账(含节假日)
++>>>>>>> refund-5days
  第三行:发票可以重开
  第四行:发票抬头可改
```

初学者不用深究这种格式,知道「命令能看,但读起来费劲,直接看文件更直观」就行。

### 想放弃:--abort

看到冲突不想处理,或者发现合错了分支,一条命令回到合并之前:

```bash
git merge --abort
git status
```

实测输出:

```text
On branch master
nothing to commit, working tree clean
```

`master` 回到了没合并时的样子,一切都像没发生过。放心,冲突可以随时重来:再敲一次 `git merge refund-5days`,冲突又摆在你面前。

### 解决:改文件,add,commit

解决冲突就是三件事。**第一件,把文件改成你想要的样子**:删掉三种标记,保留(或改写)内容。这里我选「退款 3 到 5 个工作日,信用卡 7 天」,既不是 3 也不是 5,是两边综合的。**这一步 git 不管你怎么改,标记删干净、文件里是你想要的就行**,用编辑器改,或者直接重写整个文件:

```bash
git merge refund-5days
printf '第一行:云簿工单备忘\n第二行:退款 3-5 个工作日到账,信用卡 7 天\n第三行:发票可以重开\n第四行:发票抬头可改\n' > notes.txt
grep -n -E '^(<<<<<<<|=======|>>>>>>>)' notes.txt
echo "grep exit=$?"
```

<div class="line-notes">

- `git merge refund-5days` 重新进入冲突状态(刚才 `--abort` 过了)。
- `printf '第一行:云簿工单备忘\n第二行:退款 3-5 个工作日到账` 用 `>` 覆盖整个文件,四行都是我想要的最终内容,没有任何标记。真实工作里你多半是在编辑器里改那一小块。
- `grep -n -E '^(<<<<<<<|=======|>>>>>>>)' notes.txt` 找文件里有没有残留的标记。`^` 表示行首,括号里三种标记任意一种;`-n` 让它打出行号。**提交前跑这一条是个好习惯**,标记漏删一行,它就会跟着提交进历史,Python 文件里还会直接语法错误。
- `echo "grep exit=$?"` Day 53 讲过的 `$?`:`grep` 一行都没找到,退出码是 1,这是我们想要的。

</div>

实测输出:

```text
grep exit=1
```

没有任何匹配行,退出码 1,标记删干净了。**第二件,`git add` 告诉 git「这个文件我处理好了」**;**第三件,`git commit` 完成合并**:

```bash
git add notes.txt
git status
git commit --no-edit
git log --oneline --decorate --graph -5
git branch -d refund-5days
```

<div class="line-notes">

- `git add notes.txt` 在冲突状态下,`add` 的意思不是「新增」,而是「标记为已解决」。
- `git status` 看一眼,状态应该从 `You have unmerged paths` 变成「所有冲突已修复,但你还在合并中」。
- `git commit --no-edit` 提交,并且直接用 git 准备好的默认说明,不弹编辑器。在真终端里你也可以只敲 `git commit`,编辑器里会预先填好 `Merge branch 'refund-5days'`,还带着 `# Conflicts: notes.txt` 这样的注释行。
- `git log --oneline --decorate --graph -5` 看合并结果。
- `git branch -d refund-5days` 合并完成,这次小写 `-d` 能删了,因为分支的提交现在都在 `master` 里。

</div>

实测输出:

```text
On branch master
All conflicts fixed but you are still merging.
  (use "git commit" to conclude merge)

Changes to be committed:
	modified:   notes.txt

```

```text
[master 956b51b] Merge branch 'refund-5days'
```

```text
*   956b51b (HEAD -> master) Merge branch 'refund-5days'
|\  
| * f17e994 (refund-5days) 退款时间改成 5 个工作日
* | b349460 补充信用卡退款时间
|/  
*   36c728a Merge branch 'feature-greeting'
|\  
| * 562b7d8 hello 改成接收名字
```

```text
Deleted branch refund-5days (was f17e994).
```

冲突这件事到此结束:一个菱形的合并提交,历史里两边的原始提交都完整保留着。回头看,处理冲突没有任何魔法,就是「看两边各写了什么 → 决定最终要什么 → 写进文件 → add → commit」。你要是用 VS Code 这类编辑器,它会在每块冲突上方显示「接受当前更改 / 接受传入更改 / 保留双方更改」之类的按钮,点一下就是替你改了这个文件,最后一样要 `git add` 和 `git commit`;这一块的界面我没有实跑。

## 第六步:在 agent-zero-lab 里走一遍

练习仓库熟了,回真项目。场景很常见:你开分支写文档,中途 `master` 上也有人(或者你自己临时)改了同一个地方。`agent-zero-lab` 的 `README.md` 现在是 Day 56 写的那六行,最后一行是 `- 配置放在根目录 .env(不进仓库),模板见 .env.example`。两边都往文件末尾**追加**一行,追加的位置是同一个,git 就分不清谁先谁后。

先确认起点干净,开分支:

```bash
cd ~/agent-zero-lab
git status
git branch
git switch -c readme-run-hint
printf -- '- 脚本都从仓库根目录运行,例如 `uv run python part01/intake.py`\n' >> README.md
git commit -am "README 写明脚本从根目录运行"
git switch master
printf -- '- part01/data/ 里是运行时生成的数据,不进仓库\n' >> README.md
git commit -am "README 说明 data 目录"
git merge readme-run-hint
git status --short
cat README.md
```

<div class="line-notes">

- `git status` 开分支前先看一眼:必须是 `nothing to commit, working tree clean`,没有未提交的改动。养成习惯。
- `git switch -c readme-run-hint` 从 `master` 开分支,专门写这一行说明。
- `printf -- '- 脚本都从仓库根目录运行` `printf` 的格式串以 `-` 开头会被当成选项,所以前面加 `--` 告诉它「后面不再是选项」(Day 56 讲 `git log -- 路径` 的双横线是同一个约定)。`>>` 追加到 README 末尾。
- `git commit -am "README 写明脚本从根目录运行"` 提交在分支上。
- `git switch master` 回 `master`,此时 README 又只有原来的六行(新增的那一行只在分支上)。
- `printf -- '- part01/data/ 里是运行时生成的数据` 在 `master` 上也往**同一个位置**追加了一行。
- `git merge readme-run-hint` 合并时 git 发现两边都在同一个位置加了不同的内容,触发冲突。
- `git status --short` 应该是 `UU README.md`。

</div>

实测输出(合并那一步):

```text
Auto-merging README.md
CONFLICT (content): Merge conflict in README.md
Automatic merge failed; fix conflicts and then commit the result.
```

```text
UU README.md
```

```text
# agent-zero-lab

《AI Agent 工程师:从零到资深》的练习仓库。

- part01/:Python 基础和第一个小项目
- 配置放在根目录 .env(不进仓库),模板见 .env.example
<<<<<<< HEAD
- part01/data/ 里是运行时生成的数据,不进仓库
=======
- 脚本都从仓库根目录运行,例如 `uv run python part01/intake.py`
>>>>>>> readme-run-hint
```

这次两边的内容不是互斥的,都想要,保留两行就好:只要删掉三行标记。三行标记各占一整行,而且都以固定的字符开头,用 `sed` 一条命令就能删:

```bash
sed -i '' -e '/^<<<<<<< /d' -e '/^=======$/d' -e '/^>>>>>>> /d' README.md
cat README.md
grep -n -E '^(<<<<<<<|=======|>>>>>>>)' README.md
echo "grep exit=$?"
git add README.md
git commit --no-edit
git log --oneline --graph -5
git branch -d readme-run-hint
```

<div class="line-notes">

- `sed -i '' -e '/^<<<<<<< /d'` `/正则/d` 是 sed 的「删除匹配的行」。三个 `-e` 一次处理三种标记:`^<<<<<<< ` 是以七个 `<` 加一个空格开头的行;`^=======$` 是七个 `=` 并且到此结束的行(`$` 是行尾),必须加 `$`,否则正文里恰好以 `=======` 开头的行也会被误删;`^>>>>>>> ` 是七个 `>` 加空格开头的行。删完,两边的内容都留下。
- `cat README.md` 看结果:两行新内容都在。
- `grep -n -E '^(<<<<<<<|=======|>>>>>>>)' README.md` 再次确认没有残留标记。
- `echo "grep exit=$?"` 期望看到 `1`。
- `git add README.md` 标记已解决。
- `git commit --no-edit` 完成合并提交。
- `git log --oneline --graph -5` 看菱形。
- `git branch -d readme-run-hint` 清理分支。

</div>

实测输出:

```text
# agent-zero-lab

《AI Agent 工程师:从零到资深》的练习仓库。

- part01/:Python 基础和第一个小项目
- 配置放在根目录 .env(不进仓库),模板见 .env.example
- part01/data/ 里是运行时生成的数据,不进仓库
- 脚本都从仓库根目录运行,例如 `uv run python part01/intake.py`
```

```text
grep exit=1
```

```text
[master 5827ac7] Merge branch 'readme-run-hint'
```

```text
*   5827ac7 Merge branch 'readme-run-hint'
|\  
| * 7660168 README 写明脚本从根目录运行
* | 189048b README 说明 data 目录
|/  
* f0c55c2 生成的数据文件不再进仓库
* a1d47aa 把标签的提示改得更口语
```

这条 `git log` 我没加 `--decorate`,所以没有括号标签,你在真终端里会自动看到。`agent-zero-lab` 到这里有了第一次真的分叉和合并。`sed` 这招只在「两边都要」的时候用得上;如果冲突内容是互斥的,老老实实在编辑器里改。

## 还一笔账:提交错了,用 reset 退回去

Day 56 讲 key 进了历史时我说过:如果还没推到网上,而且就是刚才那一次提交,有补救办法,放到 Day 57。就是 `git reset`。它的本质和分支是一回事:**把当前分支这张标签挪到别的提交上**。`reset` 有三档,区别在于「标签挪走以后,暂存区和工作区怎么办」。

先演示最常用的一档。假设你在 `app.py` 里写了个 `ask` 函数,**手滑把 key 直接写在代码里**,而且已经提交了:

```bash
git commit -am "加 ask 函数"
git log --oneline --decorate -3
git reset --soft HEAD~1
git log --oneline --decorate -3
git status --short
```

<div class="line-notes">

- `git commit -am "加 ask 函数"` 把含有 key 的版本提交了。这就是「手滑」。
- `git log --oneline --decorate -3` 最新一条是 `cbef64a 加 ask 函数`,`master` 指在它身上。
- `git reset --soft HEAD~1` `reset` 是把当前分支挪到指定提交,`HEAD~1` 是「HEAD 的上一次」,所以是**往回挪一格**。`--soft` 表示只挪标签,别的什么都不动。
- `git log --oneline --decorate -3` 再看:`加 ask 函数` 那条不见了,`master` 回到了 `956b51b`。
- `git status --short` 看那次提交的内容去哪了。

</div>

(提交前我用编辑器把 `app.py` 改成了:第一行 `API_KEY = "sk-fake-day57-0123456789abcdefghij"`,下面是 `hello` 和一个用到 `API_KEY` 的 `ask` 函数,这个 key 是假的。)

实测输出:

```text
cbef64a (HEAD -> master) 加 ask 函数
956b51b Merge branch 'refund-5days'
b349460 补充信用卡退款时间
```

```text
956b51b (HEAD -> master) Merge branch 'refund-5days'
b349460 补充信用卡退款时间
f17e994 退款时间改成 5 个工作日
```

```text
M  app.py
```

第三段的 `M  app.py`(`M` 在第一列)说明那次提交的改动**原封不动地回到了暂存区**,文件内容也没变。这时把 `app.py` 改好(把 key 换成从环境变量读),再 add,再 commit:

```bash
git status --short
git add app.py
git commit -m "加 ask 函数,key 从环境变量读"
git log -p | grep -c "sk-fake"
```

<div class="line-notes">

- `git status --short` 改完文件后看状态。
- `git add app.py` 把新版本放进暂存区,覆盖掉暂存区里带 key 的旧版本。
- `git commit -m "加 ask 函数,key 从环境变量读"` 这次提交里 key 已经换成了从环境变量读。
- `git log -p | grep -c "sk-fake"` `git log -p` 把每次提交的完整改动打印出来;`grep -c` 是 count,只数匹配了几行。`0` 就是一行都没找到(此时 `grep` 的退出码是 1,这里我们只看计数)。

</div>

(修改时我把前几行换成了 `import os` 和 `API_KEY = os.environ.get("LLM_API_KEY", "")`。)实测输出:`git status --short` 先显示 `MM app.py`(第一列 `M` 说明暂存区里还躺着带 key 的旧版本,第二列 `M` 说明工作区已经改成新版本),`add` 之后提交,最后的计数是 `0`:当前分支的历史里没有 key 了。

但是,**key 真的消失了吗?** 看 `reflog`,它记录了 `HEAD` 每一次移动:

```bash
git reflog -5
git show 'HEAD@{2}' | grep sk-fake
```

实测输出:

```text
351afe1 HEAD@{0}: commit: 加 ask 函数,key 从环境变量读
956b51b HEAD@{1}: reset: moving to HEAD~1
cbef64a HEAD@{2}: commit: 加 ask 函数
956b51b HEAD@{3}: commit (merge): Merge branch 'refund-5days'
b349460 HEAD@{4}: reset: moving to HEAD
```

```text
+API_KEY = "sk-fake-day57-0123456789abcdefghij"
```

那次含 key 的提交 `cbef64a` **还在**,只是没有任何分支指着它了。你本机的 `.git` 里它还会躺一阵子:reflog 里的记录默认保留 90 天,没有分支指着的提交默认 30 天(出处是 git 官方手册 `git-gc` 页的 `gc.reflogExpire` 和 `gc.reflogExpireUnreachable`),过期后才会被清理。

所以要分清两件事。这个办法适合**还没推出去**的提交:key 没有离开过你的电脑,就没有泄露,退回去重做就够了。一旦推到了网上,别人 clone 一下就拿得到,`reset` 帮不了你,得走 Day 56 那套「先作废 key」。另外,**提交被 reset 掉不等于从磁盘上抹掉了**,`reflog` 是 git 给你的后悔药,同时也是敏感数据的残渣。

### 三档 reset

| 命令 | 分支标签 | 暂存区 | 工作区(文件内容) | 什么时候用 |
| --- | --- | --- | --- | --- |
| `git reset --soft HEAD~1` | 退一格 | 保留(改动回到暂存区) | 不动 | 提交说明写错、想改一下再提交 |
| `git reset HEAD~1`(默认 `--mixed`) | 退一格 | 清空(改动退出暂存区) | 不动 | 想重新挑选要提交什么 |
| `git reset --hard HEAD~1` | 退一格 | 清空 | **改回去(没提交的改动会丢)** | 彻底丢掉这次提交和它的内容 |

演示默认那一档。再提交一次,然后 `reset HEAD~1`:

```bash
echo "第五行:价格表见 pricing.md" >> notes.txt
git commit -am "notes 加第五行"
git reset HEAD~1
git status --short
```

实测输出:

```text
Unstaged changes after reset:
M	notes.txt
```

```text
 M notes.txt
```

提交没了,标签退了一格,改动还在文件里(` M`,第一列是空格,表示没在暂存区),这是 `--mixed`。最危险的是 `--hard`:

```bash
git reset --hard
git status --short
```

实测输出:

```text
HEAD is now at 351afe1 加 ask 函数,key 从环境变量读
```

`git status --short` 什么都没有。刚才工作区里那行「第五行」**永远消失了**:没提交过的东西,git 里没有它的任何记录,`--hard` 把它从文件里抹掉,没有后悔药。(`git reset --hard` 不带提交编号,是「回到 HEAD」,意思是丢掉所有没提交的改动。)

那已经提交了的呢?提交过的东西,有 reflog 兜底。再造一次:

```bash
echo "第五行:价格表见 pricing.md" >> notes.txt
git commit -am "notes 加第五行"
git reset --hard HEAD~1
git reflog -3
git reset --hard 'HEAD@{1}'
```

<div class="line-notes">

- `git commit -am "notes 加第五行"` 再提交一次。
- `git reset --hard HEAD~1` 手滑,把刚提交的整个丢了:文件、标签一起退一格。
- `git reflog -3` 看最近 3 次 `HEAD` 的移动,第二条 `0b314a1 HEAD@{1}: commit: notes 加第五行` 就是刚才被丢掉的那次提交。
- `git reset --hard 'HEAD@{1}'` `HEAD@{1}` 是「HEAD 上一次所在的位置」,让标签回到那里。大括号在有的 shell 里有特殊含义,外面加单引号最保险。

</div>

实测输出:

```text
HEAD is now at 351afe1 加 ask 函数,key 从环境变量读
```

```text
351afe1 HEAD@{0}: reset: moving to HEAD~1
0b314a1 HEAD@{1}: commit: notes 加第五行
351afe1 HEAD@{2}: reset: moving to HEAD
```

```text
HEAD is now at 0b314a1 notes 加第五行
```

整个提交又回来了。口诀:**提交过的,reflog 能救;没提交过的,`--hard` 之后就没了**。所以 `--hard` 之前先 `git status` 和 `git diff` 看一眼,你要丢的到底是什么。最后一点,也是 Day 58 会展开的:**已经推到网上、别人可能拉走的提交,不要 `reset`**,因为你改写了大家共有的历史,会让同事的仓库对不上。那种场景用 `git revert`(再提交一次「反向改动」),下一课讲。

## 零件对照表

| 命令 | 做什么 | 今天在哪里用到 |
| --- | --- | --- |
| `git branch` | 列出本地分支,`*` 是当前所在 | 第一步 |
| `git switch -c 名字` | 新建分支并切过去(旧写法 `git checkout -b`) | 每次开分支 |
| `git switch 名字` | 切换到已有的分支 | 来回切 |
| `git commit -am "说明"` | 已跟踪文件自动 add 再提交(不含新文件) | 第一步起 |
| `git merge 分支` | 把那个分支并进当前分支;快进或合并提交 | 第二、三步 |
| `git log --oneline --decorate --graph --all` | 把所有分支画成图 | 每次合并前后 |
| `git branch -d` / `-D` | 删除已合并 / 强制删除分支 | 第四步 |
| `git merge-base A B` | 找两个分支的共同祖先 | 冲突前 |
| `git merge --abort` | 放弃正在进行的合并 | 第五步 |
| `git add 文件` | 冲突时的意思是「这个文件我解决了」 | 第五步 |
| `git commit --no-edit` | 用默认说明提交(合并时常用) | 解决冲突之后 |
| `git reset --soft / --mixed / --hard HEAD~1` | 当前分支退一格,三档处理暂存区和工作区 | 还账一节 |
| `git reflog` | 记录 HEAD 每次移动,找回「丢掉」的提交 | 还账一节 |

## 动手练习

### 练习 1:开分支加一个文件,快进合并

在 `agent-zero-lab` 里:开一个叫 `add-changelog` 的分支,新建 `CHANGELOG.md`(写三行:标题、空行、一条「第一个版本:part01 的练习和录入工具」),提交;切回 `master` 确认这个文件**不在**;合并,确认这次是快进;删掉分支。

<details>
<summary>参考答案</summary>

```bash
cd ~/agent-zero-lab
git switch -c add-changelog
printf '# 变更记录\n\n- 第一个版本:part01 的练习和录入工具\n' > CHANGELOG.md
git add CHANGELOG.md
git commit -m "加 CHANGELOG.md"
git switch master
ls
git merge add-changelog
ls
git log --oneline --graph -4
git branch -d add-changelog
```

<div class="line-notes">

- `git switch -c add-changelog` 从 `master` 开分支并站上去。
- `printf '# 变更记录\n\n- 第一个版本:part01 的练习和录入工具\n' > CHANGELOG.md` 三行内容:标题、空行(两个 `\n` 连在一起)、一条记录。
- `git add CHANGELOG.md` / `git commit -m "加 CHANGELOG.md"` 新文件要先 add。
- `git switch master` 回到 `master`。
- `ls` 第一次:目录里没有 `CHANGELOG.md`,因为它的提交只在分支上。
- `git merge add-changelog` `master` 自从分支分出去以后没有新提交,所以是快进。
- `ls` 第二次:文件出现了。
- `git log --oneline --graph -4` 历史是一条直线,没有菱形。
- `git branch -d add-changelog` 已合并,小写 `-d` 就能删。

</div>

实测输出:

```text
[add-changelog d3b72f8] 加 CHANGELOG.md
 1 file changed, 3 insertions(+)
 create mode 100644 CHANGELOG.md
```

第一次 `ls`:

```text
README.md
main.py
part01
pyproject.toml
uv.lock
```

合并:

```text
Updating 5827ac7..d3b72f8
Fast-forward
 CHANGELOG.md | 3 +++
 1 file changed, 3 insertions(+)
 create mode 100644 CHANGELOG.md
```

第二次 `ls` 多了 `CHANGELOG.md`。历史:

```text
* d3b72f8 加 CHANGELOG.md
*   5827ac7 Merge branch 'readme-run-hint'
|\  
| * 7660168 README 写明脚本从根目录运行
* | 189048b README 说明 data 目录
|/  
```

最后 `git branch -d` 输出 `Deleted branch add-changelog (was d3b72f8).`。`Fast-forward` 和图里的一条直线,说明这次没有产生合并提交。

</details>

### 练习 2:带着没提交的改动切分支

在 `~/branch-practice2`(新目录)里建一个仓库,有 `a.txt`(写「第一行」)和 `b.txt`(写「甲」)两个文件并提交。再开分支 `other`,在 `other` 上改 `a.txt` 并提交,切回 `master`。然后分两种情况试:(1)在 `master` 上改 `b.txt` 不提交,切到 `other`;(2)提交那次 `b.txt`,再在 `master` 上改 `a.txt` 不提交,切到 `other`。每一种写出现象,并解释为什么。

<details>
<summary>参考答案</summary>

```bash
mkdir ~/branch-practice2
cd ~/branch-practice2
git init
printf '第一行\n' > a.txt
printf '甲\n' > b.txt
git add .
git commit -m "初始"
git switch -c other
echo "other 改了 a" >> a.txt
git commit -am "other 改 a.txt"
git switch master
echo "master 上没提交的 b" >> b.txt
git status --short
git switch other
git status --short
git switch master
git commit -am "b 提交"
echo "master 上没提交的 a" >> a.txt
git switch other
cat a.txt
```

<div class="line-notes">

- `git add .` / `git commit -m "初始"` 两个文件一起作为第一次提交。
- `git switch -c other` / `echo "other 改了 a" >> a.txt` / `git commit -am "other 改 a.txt"` `other` 分支上 `a.txt` 和 `master` 不一样,`b.txt` 一样。
- `echo "master 上没提交的 b" >> b.txt` 情况一:在 `master` 上改 `b.txt`,不提交。
- `git switch other` 目标分支的 `b.txt` 和当前一样,没有东西会被覆盖,切换成功,改动跟过去。
- `git switch master` 再切回来,改动又跟回来。
- `git commit -am "b 提交"` 把这行 `b.txt` 提交掉,工作区干净了。
- `echo "master 上没提交的 a" >> a.txt` 情况二:改的是 `other` 上也改过的 `a.txt`。
- `git switch other` 切过去会覆盖没提交的那一行,git 拒绝。
- `cat a.txt` 确认还在 `master`,文件内容没丢。

</div>

实测输出。情况一:

```text
 M b.txt
```

```text
Switched to branch 'other'
M	b.txt
```

```text
 M b.txt
```

切回 `master` 时:

```text
Switched to branch 'master'
M	b.txt
```

情况二:

```text
error: Your local changes to the following files would be overwritten by checkout:
	a.txt
Please commit your changes or stash them before you switch branches.
Aborting
```

`cat a.txt` 的输出:

```text
第一行
master 上没提交的 a
```

解释:切分支时 git 只会改动「两个分支里内容不一样」的文件。`b.txt` 两边相同,没提交的改动可以原样带过去;`a.txt` 两边不同,要换成另一个分支的版本,就会把你没提交的那一行盖掉,git 为了保护你直接拒绝。解决办法是先提交,或者丢弃(`git restore a.txt`)。

</details>

### 练习 3:自己造一次冲突并解决

在新目录 `~/conflict-practice` 里写一份 `faq.txt`(三行:标题 `常见问题`,`1. 退款几天到账?3 个工作日`,`2. 发票能重开吗?能`)提交。开分支 `edit-a`,把第 2 行改成「能,开票后 90 天内」;回 `master`,把第 2 行改成「能,需要先作废原发票」。合并,**先放弃一次**(`--abort`),再合并一次并解决成「能,需要先作废原发票,开票后 90 天内可重开」,提交,最后确认文件里没有残留标记。

<details>
<summary>参考答案</summary>

```bash
mkdir ~/conflict-practice
cd ~/conflict-practice
git init
printf '常见问题\n1. 退款几天到账?3 个工作日\n2. 发票能重开吗?能\n' > faq.txt
git add .
git commit -m "faq 初版"
git switch -c edit-a
sed -i '' 's/^2\. .*/2. 发票能重开吗?能,开票后 90 天内/' faq.txt
git commit -am "a: 补发票期限"
git switch master
sed -i '' 's/^2\. .*/2. 发票能重开吗?能,需要先作废原发票/' faq.txt
git commit -am "master: 补作废要求"
git merge edit-a
git merge --abort
git status --short
git merge edit-a
cat faq.txt
printf '常见问题\n1. 退款几天到账?3 个工作日\n2. 发票能重开吗?能,需要先作废原发票,开票后 90 天内可重开\n' > faq.txt
grep -n -E '^(<<<<<<<|=======|>>>>>>>)' faq.txt
echo "grep exit=$?"
git add faq.txt
git commit --no-edit
cat faq.txt
git log --oneline --graph
```

<div class="line-notes">

- `sed -i '' 's/^2\. .*/2. 发票能重开吗?能,开票后 90 天内/' faq.txt` 正则 `^2\. ` 匹配以「2. 」开头的行(`\.` 是把点当成普通字符),`.*` 是后面的任意内容,整行换掉。分支和 `master` 各改了这一行,改得不同。
- `git commit -am "a: 补发票期限"` 在分支上提交。
- `git commit -am "master: 补作废要求"` 在 `master` 上提交。
- `git merge edit-a` 第一次合并,冲突。
- `git merge --abort` 放弃,回到合并前。
- `git status --short` 没有输出:放弃之后工作区是干净的。
- `git merge edit-a` 第二次合并,同样的冲突再来一次。
- `cat faq.txt` 看冲突标记长什么样。
- `printf '常见问题\n1. 退款几天到账?3 个工作日\n2. 发票能重开吗?能,需要先作废原发票,开票后 90 天内可重开\n' > faq.txt` 整个重写成最终版本,标记自然没了。
- `grep -n -E '^(<<<<<<<|=======|>>>>>>>)' faq.txt` / `echo "grep exit=$?"` 退出码 1 才算干净。
- `git add faq.txt` 标记为已解决。
- `git commit --no-edit` 完成合并。

</div>

实测输出(两次合并都是这样):

```text
Auto-merging faq.txt
CONFLICT (content): Merge conflict in faq.txt
Automatic merge failed; fix conflicts and then commit the result.
```

`--abort` 之后 `git status --short` 没有输出。第二次冲突后 `cat faq.txt`:

```text
常见问题
1. 退款几天到账?3 个工作日
<<<<<<< HEAD
2. 发票能重开吗?能,需要先作废原发票
=======
2. 发票能重开吗?能,开票后 90 天内
>>>>>>> edit-a
```

重写文件之后:

```text
grep exit=1
```

提交与最终内容:

```text
[master 2a17bf7] Merge branch 'edit-a'
```

```text
常见问题
1. 退款几天到账?3 个工作日
2. 发票能重开吗?能,需要先作废原发票,开票后 90 天内可重开
```

```text
*   2a17bf7 Merge branch 'edit-a'
|\  
| * 5ac9cc9 a: 补发票期限
* | 64574ae master: 补作废要求
|/  
* a793775 faq 初版
```

</details>

### 练习 4:合并成功了,代码却是错的

两个分支各自在 `util.py` 里加了一个同名函数 `fee`,但位置不同,合并之后**没有冲突**。请造出这个情形,合并,然后:(1)用 Python 调用 `fee(100)`,看返回的是哪一边的版本;(2)用 `basedpyright` 看它怎么提示;(3)修好并提交。回答:为什么 git 没报冲突?

<details>
<summary>参考答案</summary>

在新目录 `~/dup-practice` 里,先建仓库并提交 `util.py`(买卖价格的小文件):

```python
# ~/dup-practice/util.py
def base_price(seats: int) -> float:
    return seats * 49.0


def total(seats: int) -> float:
    return base_price(seats)


if __name__ == "__main__":
    print(total(10))
```

```bash
mkdir ~/dup-practice
cd ~/dup-practice
git init
git add util.py
git commit -m "util 初版"
git switch -c fee-a
```

在 `fee-a` 分支上,用编辑器把下面这段加在文件**最开头**(`base_price` 的前面),保存后提交:

```python
def fee(amount: float) -> float:
    return amount * 0.05
```

```bash
git commit -am "a: 在文件开头加 fee(5%)"
git switch master
```

回到 `master`,用编辑器把另一个版本的 `fee` 加在 `total` 的后面、`if __name__` 的前面,保存后提交并合并:

```python
def fee(amount: float) -> float:
    return amount * 0.03
```

```bash
git commit -am "master: 在 total 后面加 fee(3%)"
git merge fee-a --no-edit
python3 -c "import util; print(util.fee(100))"
grep -n "def fee" util.py
uv run --project ~/agent-zero-lab basedpyright util.py
```

<div class="line-notes">

- `git merge fee-a --no-edit` 合并。两边改的位置不同(一个在文件开头,一个在中间),git 逐行比较没有重叠,自动合并成功。
- `python3 -c "import util; print(util.fee(100))"` `-c` 是直接执行一句 Python。`import util` 加载这个文件,`util.fee(100)` 调用函数。
- `grep -n "def fee" util.py` 看有几处定义。
- `uv run --project ~/agent-zero-lab basedpyright util.py` 借用 `agent-zero-lab` 里装好的 `basedpyright` 检查这个文件(Day 9 配的类型检查)。

</div>

实测输出:

```text
Auto-merging util.py
Merge made by the 'recursive' strategy.
 util.py | 4 ++++
 1 file changed, 4 insertions(+)
```

```text
3.0
```

```text
1:def fee(amount: float) -> float:
13:def fee(amount: float) -> float:
```

```text
util.py:1:5 - warning: Function declaration "fee" is obscured by a declaration of the same name (reportRedeclaration)
0 errors, 1 warning, 0 notes
```

合并之后的 `util.py`:

```python
# ~/dup-practice/util.py
def fee(amount: float) -> float:
    return amount * 0.05


def base_price(seats: int) -> float:
    return seats * 49.0


def total(seats: int) -> float:
    return base_price(seats)


def fee(amount: float) -> float:
    return amount * 0.03


if __name__ == "__main__":
    print(total(10))
```

<div class="line-notes">

- `def fee(amount: float) -> float:` 第 1 行,`fee-a` 那边的版本:乘 `0.05`。Python 是从上往下执行的,执行到这里先把 `fee` 绑定到这个函数。
- `return amount * 0.05` 如果只有这一个定义,`fee(100)` 是 `100 * 0.05 = 5.0`。
- `def fee(amount: float) -> float:` 第 13 行,`master` 那边的版本。Python 执行到这里,把名字 `fee` **重新绑定**成这个新函数,上面那个被盖掉了(Python 里 `def` 是把名字绑到一个函数上,同名再绑一次就盖掉前一个,[Day 28](/blog/agent-zero/day-028-functions-1/) 讲函数时会细讲)。
- `return amount * 0.03` `fee(100)` 实际算出 `100 * 0.03 = 3.0`,所以输出是 `3.0`,`fee-a` 分支的作者以为得到的 `5.0` 悄悄消失了。

</div>

答:git 只比较「文本行」,它不懂 Python。两边的新增位置不同,在它眼里是两处互不相干的新增,自动合并成功;而「同名函数后者盖掉前者」是**程序语义**,git 看不见。这是合并后一定要**跑一遍测试或类型检查**的原因。`basedpyright` 的 `reportRedeclaration` 警告正好抓到了这个问题(它说第 1 行的 `fee` 被同名声明盖掉了)。

修:两个版本其实服务于不同场景,把 `master` 那一个改名成 `card_fee`,再检查、提交:

```bash
sed -i '' '13s/def fee/def card_fee/' util.py
python3 -c "import util; print(util.fee(100), util.card_fee(100))"
uv run --project ~/agent-zero-lab basedpyright util.py
git commit -am "改名 card_fee"
```

实测输出:

```text
5.0 3.0
```

```text
0 errors, 0 warnings, 0 notes
```

`sed -i '' '13s/def fee/def card_fee/'` 里开头的 `13` 是「只改第 13 行」,避开第 1 行那个。两个函数各自生效,警告消失。

</details>

### 练习 5:提交到错的分支上了

你本来想在 `feature-rescue` 分支上写新功能,结果直接在 `master` 上提交了一次。还没有推到任何地方。请在新目录里造出这个情形,然后把这次提交**挪**到新分支 `feature-rescue` 上,让 `master` 回到提交之前。

<details>
<summary>参考答案</summary>

```bash
mkdir ~/oops-practice
cd ~/oops-practice
git init
echo "v1" > app.txt
git add .
git commit -m "v1"
echo "新功能写了一半" >> app.txt
git commit -am "新功能(提交错地方了)"
git branch feature-rescue
git reset --hard HEAD~1
git log --oneline --decorate --all
cat app.txt
git switch feature-rescue
cat app.txt
```

<div class="line-notes">

- `git commit -am "新功能(提交错地方了)"` 手滑:提交在 `master` 上。
- `git branch feature-rescue` 注意是 `branch`,不是 `switch -c`。这条命令**新建一个标签但不切过去**,标签贴在当前提交(也就是那次错提交)上。此刻 `master` 和 `feature-rescue` 指着同一次提交。
- `git reset --hard HEAD~1` 让 `master` 这张标签退回一格,工作区也跟着退。`feature-rescue` 不受影响,那次提交仍然被它指着,所以不会丢。
- `git log --oneline --decorate --all` 看两条标签现在分别在哪。
- `cat app.txt` 在 `master` 上看,只有 `v1`。
- `git switch feature-rescue` / `cat app.txt` 切过去,「新功能写了一半」那行回来了。

</div>

实测输出(`git log` 里 `--decorate` 的括号这里我没单独录,下面是两次 `cat` 和 `git log --oneline`):

```text
v1
```

```text
Switched to branch 'feature-rescue'
```

```text
v1
新功能写了一半
```

```text
c9a8ea7 新功能(提交错地方了)
981b5fc v1
```

关键是**先建标签再 reset**:要是先 `reset --hard`,那次提交就没人指着了,只能靠 `reflog` 找回。先 `git branch` 给它一个名字,等于提前买了保险。这也是 `reset` 和分支是一回事的直接体现:提交没动,动的只是标签。

</details>

验收标准:`agent-zero-lab` 里 `git log --oneline --graph` 能看到 README 冲突产生的那个菱形和练习 1 的 `CHANGELOG.md` 提交,`git status` 是 `working tree clean`,`git branch` 只剩 `master`;练习 2 到 5 的输出和参考答案一致;你能不看文章,在一个新目录里把「建分支、两边各提交、合并、造冲突、解决」整圈默写一遍。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 分支(branch) | 一个指向某次提交的名字,提交时它跟着往前挪。不是复制文件夹 |
| HEAD | 你现在站在哪个分支(或哪次提交)上。切分支就是改 `HEAD` 的指向 |
| 切换(switch) | 把 `HEAD` 换到另一个分支,工作区的文件按目标分支的样子重新摆一遍 |
| 合并(merge) | 把另一个分支的改动并进当前分支 |
| 快进(fast-forward) | 当前分支没有新提交时,合并只需要把标签往前挪,不产生新提交 |
| 合并提交(merge commit) | 两边都有新提交时 git 生成的、有两个 parent 的提交 |
| 父提交(parent) | 一次提交的「上一次」。普通提交一个,合并提交两个 |
| 共同祖先(merge base) | 两个分支分叉前的最后一次共同提交,git 三方比较的起点 |
| 冲突(conflict) | 两边改了同一处并且改得不一样,git 无法自动选,停下来让你决定 |
| 冲突标记 | 文件里的 `<<<<<<<`、`=======`、`>>>>>>>` 三行,圈出两边各自的版本 |
| `UU` | `git status --short` 里的「两边都改过、尚未解决」 |
| reset | 把当前分支标签挪到别的提交,分 `--soft`、`--mixed`(默认)、`--hard` 三档 |
| reflog | 记录 `HEAD` 每一次移动的本地日志,是找回「丢掉的提交」的后悔药 |
| `HEAD~1` | `HEAD` 的上一次提交,`HEAD~2` 是上上次 |
| `stash` | 把没提交的改动临时收起来的功能。今天只提到名字,没有用 |

## 常见误区

**以为分支是复制了一份项目。** 分支只是一张标签,新建不占地方、不花时间。所以放心多开,不要再因为怕麻烦在 `master` 上直接试验。

**合并前不看工作区是否干净。** 带着没提交的改动 `git merge` 容易让局面变复杂。养成习惯:开分支、合并之前先 `git status`,干净了再动手。

**看到冲突就慌,把整个文件删了重来。** 冲突只发生在标记圈出来的那几行,其他行 git 已经合好了。不想处理就 `git merge --abort`,一条命令回到合并之前。

**解决完冲突忘了删标记。** `<<<<<<<` 漏了一行,会跟着提交进历史。提交前用 `grep -n -E '^(<<<<<<<|=======|>>>>>>>)' 文件` 查一遍,退出码 1 才算干净。Python 文件里残留标记会直接 `SyntaxError`。

**以为合并没冲突就一定对。** 练习 4 就是例子:git 只看文本行,同名函数、重复的配置项、两边都改了 import,这些语义上的冲突它看不见。合并之后跑一遍测试或类型检查。

**把 `-d` 报 `not fully merged` 当成故障。** 它是在保护你,说明这个分支上有别处没有的提交。想清楚真不要了再用 `-D`。

**`git reset --hard` 不看就敲。** 没提交的改动会永远丢失,`reflog` 也救不回,因为它们从来没进过 git。敲之前先 `git status`、`git diff`。

**在已经推到网上的历史上 `reset`。** 别人已经拿走的提交你又把它抹掉,会让大家的仓库对不上。推出去的改动要撤销,用 `git revert`(Day 58)。

**切分支时顺手把脚本跑了。** 分支切换会把文件换成另一个版本,你在 A 分支改的东西跑在 B 分支的代码上,出的 bug 令人摸不着头脑。切完先 `git branch` 看一眼自己在哪。

## 学习资料

### 文档与文章

- [Pro Git 中文版 · 分支简介](https://git-scm.com/book/zh/v2/Git-%E5%88%86%E6%94%AF-%E5%88%86%E6%94%AF%E7%AE%80%E4%BB%8B):今天「分支是指针」的权威讲法,配图比我的图细得多,有 `HEAD`、提交对象和 `.git/refs` 的关系。
- [Pro Git 中文版 · 分支的新建与合并](https://git-scm.com/book/zh/v2/Git-%E5%88%86%E6%94%AF-%E5%88%86%E6%94%AF%E7%9A%84%E6%96%B0%E5%BB%BA%E4%B8%8E%E5%90%88%E5%B9%B6):快进、合并提交、冲突的基础用法,和今天的顺序几乎一致,最后的冲突一节可以对照读。
- [Pro Git 中文版 · 重置揭密](https://git-scm.com/book/zh/v2/Git-%E5%B7%A5%E5%85%B7-%E9%87%8D%E7%BD%AE%E6%8F%AD%E5%AF%86):三档 reset 背后的「三棵树」原理,偏深,第一遍读到 `reset` 三个选项的比较就行。
- [git-merge 官方手册](https://git-scm.com/docs/git-merge):查「冲突是怎么标记的」「`--abort`」「`--no-ff`」的出处。
- [git-reset 官方手册](https://git-scm.com/docs/git-reset):页尾有一张表,列出每一档 `reset` 对暂存区和工作区的影响,和今天的对照表是同一个意思。
- [Learn Git Branching](https://learngitbranching.js.org/?locale=zh_CN):可以在浏览器里点着玩的分支动画教程,有中文。把「分支是指针」看一遍动画,比读文字直观,前几关做完就够。
- [Oh Shit, Git!?!](https://ohshitgit.com/zh):Day 56 推荐过,这次读「我提交到了错的分支」「我想撤销最近的提交」两节,正好对应练习 5 和 reset。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1rC411V7uJ&autoplay=0&high_quality=1" title="Git分支与合并" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>廿一日船 · Git分支与合并 · 约 11 分钟,2024 年。用动画讲分支和快进、合并提交,正好是今天第一到第三步。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1ax421U7eZ&autoplay=0&high_quality=1" title="Git处理合并冲突" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>廿一日船 · Git处理合并冲突 · 约 11 分钟,2024 年。同一个作者的下一集,讲冲突标记和解决步骤,对应第五步。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1ne4y1S7S9&autoplay=0&high_quality=1" title="十分钟学会常用git撤销操作,全面掌握git的时光机" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>码农高天 · 十分钟学会常用git撤销操作,全面掌握git的时光机 · 约 9 分钟,2022 年。对应「还一笔账」:reset 三档、reflog 找回。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/XX-Kct0PfFc" title="Git & GitHub Tutorial for Beginners #9 - Merging Branches (& conflicts)" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Net Ninja · Git & GitHub Tutorial for Beginners #9 · Merging Branches (& conflicts) · 英文,可开字幕。看他在编辑器里怎么解决冲突,和第五步对照。</figcaption>
</figure>

### 书籍

- 《Pro Git》(第二版),Scott Chacon 和 Ben Straub 著,Apress 出版,作者在 git-scm.com 上免费公开全文,有中文版。第 3 章「Git 分支」对应今天,第 7 章「Git 工具」里的「重置揭密」对应还账那一节。

### 开源项目与代码

- [git/git](https://github.com/git/git):git 自己的源码仓库。它的提交历史里有大量 `Merge branch 'xx/yy'` 这样的合并提交,正是今天第三步生成的那种菱形,拿它的历史当真实样本看看。

## 自测

1. 新建一个分支,git 复制了项目文件吗?它到底存了什么?

<details><summary>答案</summary>

没有复制。新建分支只是在 `.git/refs/heads/` 下多一个小文件,内容是它指向的那次提交的编号(40 位)。所以新建几乎不花时间,也不占地方。

</details>

2. 你在 `feature-faq` 上建了 `faq.txt` 并提交,切回 `master` 后 `ls` 里没有它。文件被删了吗?

<details><summary>答案</summary>

没有。切换分支时 git 按目标分支那次提交的样子重新摆工作区,`master` 指向的提交里没有 `faq.txt`,所以看不到;切回 `feature-faq` 它就回来了。

</details>

3. `git merge` 输出 `Fast-forward` 和 `Merge made by the 'recursive' strategy` 有什么区别?各发生在什么条件下?

<details><summary>答案</summary>

`Fast-forward`:当前分支自从分叉后没有新提交,git 只把标签向前挪,不产生新提交,历史是直线。`Merge made by the 'recursive' strategy`:两边都有新提交,git 做三方比较,自动合并后生成一个有两个 parent 的合并提交,历史里留下菱形。

</details>

4. 合并时出现冲突,文件里 `<<<<<<< HEAD` 和 `=======` 之间是谁的内容?想放弃这次合并用什么命令?

<details><summary>答案</summary>

是你当前所在分支(`HEAD` 指向的分支)的版本;`=======` 到 `>>>>>>>` 之间是要并进来的分支的版本。放弃用 `git merge --abort`,回到合并之前的状态。

</details>

5. 你提交了一次,马上发现说明写错了,而且漏了一个文件没加。还没推到网上。用 reset 怎么办?`--soft` 和 `--hard` 的区别是什么?

<details><summary>答案</summary>

`git reset --soft HEAD~1`:标签退一格,那次提交的改动留在暂存区,把漏的文件 `git add` 进去再重新 `git commit`,说明写对。`--soft` 只动标签,暂存区和文件都保留;`--hard` 还会把工作区和暂存区改回目标提交的样子,没提交的改动会丢,所以这里不能用。

</details>

6. (面试题)同事说「我合并没报冲突,但上线后功能坏了」。你觉得可能是怎么发生的?你会在流程里加什么?

<details><summary>答案</summary>

git 只看文本行,没有冲突只代表「两边改的行没重叠」,不代表逻辑兼容。比如两边在不同位置加了同名函数,后面的会盖掉前面的;或者一边改了函数签名,另一边新增了旧签名的调用。要在流程里加:合并后在本地跑测试和类型检查,CI 在合并前对「合并后的结果」跑一遍(PR 检查),并且代码评审时看合并之后的整体而不是只看自己分支的改动。

</details>

## 明天预告

明天是 [Day 58 · git(三):GitHub、push、SSH key 和 PR](/blog/agent-zero/day-058-git-3/)。到今天为止,所有的提交、分支、合并都只发生在你这台电脑上。明天把仓库推到 GitHub:认识「远程」,装一把 SSH key 让 GitHub 认得你,第一次 `git push`,再走一遍团队里最常见的流程,开分支、推上去、提 PR、合并。今天的分支和合并是明天的基础,PR 页面上那个「Merge」按钮,按下去发生的事就是你今天做的 `git merge`。
