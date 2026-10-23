---
title: 'Day 58 · git(三):GitHub、push、SSH key 和 PR'
description: '前两天的提交、分支、合并都在你自己的电脑里。今天认识「远程」:用一个本地裸仓库当假 GitHub,把 agent-zero-lab 推上去、让同事的改动拉下来;生成一把 SSH key,搞懂公钥和私钥各放哪;再把真实的 GitHub 建仓库、推送、提 PR 的流程走一遍,最后讲推出去的提交后悔了怎么办。'
pubDate: 2026-10-23
regime: none
tags: ['git', 'agent-zero']
series: 'agent-zero'
day: 58
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 57](/blog/agent-zero/day-057-git-2/) 讲了分支和合并:分支是一张贴在提交上的标签,`git merge` 要么只挪标签(快进),要么生成有两个父提交的合并提交,两边改了同一行就是冲突,改完 `add`、`commit` 收尾。还还了 Day 56 欠的账:没推出去的提交写错了可以 `git reset` 退回去。

到现在为止,所有历史都只存在你这台电脑的 `.git` 目录里。硬盘坏了、笔记本丢了、想在另一台机器上继续写,这些东西全没了。而且你以后要找工作,招聘方也要看你的代码。所以今天把仓库放到一个所有人都能访问的地方,也就是 GitHub。顺便还一笔账:Day 57 末尾说「已经推到网上的提交不要 `reset`,用 `git revert`」,今天会亲眼看到不这么做会出什么事。

## 今天要解决的问题

学完今天,你应该能:

1. 说清**本地仓库、远程仓库、`origin`、`clone`、`push`、`fetch`、`pull`** 各是什么,并会用 `git remote add`、`git push -u origin main` 把一个本地仓库推上去,看懂 `git push` 被拒绝(`rejected ... fetch first`)时该做什么。
2. 生成一把 SSH key,说清**公钥**和**私钥**各自放在哪、哪一个能给别人;知道 `~/.ssh` 下的文件权限不对会报什么错。
3. 在 GitHub 上建一个私有仓库,把 `agent-zero-lab` 推上去,并在网页上确认没有 `.env`(这一步我没法替你实跑,下面会写清楚)。
4. 走一遍 PR(Pull Request,合并请求)流程:开分支、推分支、提 PR、合并、删分支;推出去的提交写错了,会用 `git revert`,并说得出为什么不该 `reset` 再 `push --force`。

预计用时:3 小时(内容比前两天多,SSH 和 GitHub 网页要点点鼠标,留足时间)。前置:[Day 56](/blog/agent-zero/day-056-git-1/) 的提交和历史,[Day 57](/blog/agent-zero/day-057-git-2/) 的分支、合并、冲突、reset。

学法:先对照文章逐行敲一遍(不要复制粘贴)并跑通;第二天合上文章,在一个新目录里把「建裸仓库、`remote add`、`push -u`、clone 到另一个目录改一点再 push、回来 pull」整圈默写出来;再做动手练习,做不出来再展开参考答案,看完关掉自己重写一遍。

今天不写 Python,不调 API,花费 0 元。

先交代两件事。**第一,我没有拿真实的 GitHub 演示。** 推送、拉取、冲突这些命令,我用一个本地的「裸仓库」(下面解释)当作假 GitHub 来跑,命令和输出的形状跟真的一样,区别只是地址:真的是 `git@github.com:你的用户名/agent-zero-lab.git`,我的是 `/Users/你/fake-github/agent-zero-lab.git`。GitHub 网页上的点击步骤,我是对照 GitHub 官方文档(2026 年 10 月查的)写的,没有实跑,到时候在文中会标出「没实跑」。**第二,SSH 那一节**,生成 key、看文件、看权限报错,都是真跑的;而「把公钥贴到 GitHub 上、`ssh -T git@github.com` 验证」没法跑,我在本机另起了一个只听 `127.0.0.1` 的 `sshd`(SSH 服务端),用来演示「key 认证成功」的握手那一段,但它的会话部分在 macOS 上不让普通用户用,所以没能真的通过 SSH 推送,推送是用本地路径跑的。环境:git `2.24.3 (Apple Git-128)`,和前两天一样;名字邮箱 `学习者`、`learner@example.com` 是假家目录里配的演示值,输出里的路径把家目录缩成了 `/Users/你`。

## 先想清楚:远程到底是什么

**远程仓库(remote repository)就是放在别的机器上的另一份仓库**,GitHub 提供的就是这个:它在服务器上替你存了一份 `.git`,外加一个网页界面、权限管理和 PR。git 本身和 GitHub 没有从属关系,git 是工具,GitHub 是托管服务,GitLab、Gitee 做的是同一类事。对 git 来说,远程只不过是「一个地址」。

两份仓库(你的和远程的)之间,靠四个动作传东西:

<figure>
<svg viewBox="0 0 640 270" role="img" aria-label="本地仓库与远程仓库:git push 把本地新提交送到远程;git fetch 把远程新提交取回到本地的 origin/main 标签,不改工作区;git pull 等于 fetch 再 merge;git clone 是第一次把整个远程仓库复制到本地">
<rect x="0" y="0" width="640" height="270" fill="var(--paper-raised)" rx="6"/>
<g font-family="var(--font-mono)" font-size="12">
<rect x="16" y="40" width="250" height="150" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="141" y="62" text-anchor="middle" fill="var(--ink)">你的电脑(本地仓库)</text>
<text x="32" y="90" fill="var(--ink-soft)" font-size="11">main  ← 你自己的分支</text>
<text x="32" y="112" fill="var(--ink-soft)" font-size="11">origin/main  ← 「上次看到的远程」</text>
<text x="32" y="134" fill="var(--ink-soft)" font-size="11">    只是一张本地标签</text>
<text x="32" y="164" fill="var(--ink-soft)" font-size="11">工作区 / 暂存区 / 历史</text>
<rect x="374" y="40" width="250" height="150" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="499" y="62" text-anchor="middle" fill="var(--ink)">GitHub(远程仓库 origin)</text>
<text x="390" y="90" fill="var(--ink-soft)" font-size="11">main  ← 大家共用的主线</text>
<text x="390" y="112" fill="var(--ink-soft)" font-size="11">feature/... 别人推上来的分支</text>
<text x="390" y="164" fill="var(--ink-soft)" font-size="11">只有历史,没有工作区</text>
<line x1="266" y1="76" x2="374" y2="76" stroke="var(--ink-soft)"/>
<text x="320" y="68" text-anchor="middle" fill="var(--ink)" font-size="11">git push →</text>
<line x1="374" y1="110" x2="266" y2="110" stroke="var(--ink-soft)"/>
<text x="320" y="102" text-anchor="middle" fill="var(--ink)" font-size="11">← git fetch</text>
<line x1="374" y1="144" x2="266" y2="144" stroke="var(--ink-soft)"/>
<text x="320" y="136" text-anchor="middle" fill="var(--ink)" font-size="11">← git pull</text>
<text x="320" y="160" text-anchor="middle" fill="var(--ink-faint)" font-size="11">fetch + merge</text>
<text x="320" y="214" text-anchor="middle" fill="var(--ink)" font-size="11">git clone:第一次把整个远程仓库复制到本地</text>
<line x1="374" y1="222" x2="266" y2="222" stroke="var(--ink-soft)" stroke-dasharray="4 3"/>
<text x="16" y="256" fill="var(--ink-faint)" font-size="11">pull 会动你的工作区和分支;fetch 只更新 origin/main 那张标签</text>
</g>
</svg>
<figcaption>你和 GitHub 各有一份仓库,四个命令负责传东西。本地多出来的 <code>origin/main</code> 记录「上次联系时远程 main 在哪」。</figcaption>
</figure>

几个词先立住:

- **origin**:远程仓库的**别名**。一个远程有一长串地址,每次敲太麻烦,git 让你给它起个短名字,约定俗成叫 `origin`。可以有多个远程,各起各的名。
- **`origin/main`**:本地仓库里的一张**只读标签**,记录「上一次和 origin 联系时,它的 `main` 贴在哪次提交上」。它不会自己更新,只有 `fetch`、`pull`、`push` 的时候才会动。
- **clone**:第一次把一个远程仓库整个复制下来,自动设好 `origin`,并检出默认分支。
- **push**:把你本地分支上的新提交送到远程。
- **fetch**:只把远程的新提交**取回来**,更新 `origin/main` 这张标签,不动你的分支和文件,最安全。
- **pull**:`fetch` 加上 `merge`,取回来之后立刻并进你当前分支。(Day 57 的合并规则全部适用:快进、合并提交、冲突都会发生。)

服务器上那份仓库有个特点:**它没有工作区**。没人会在服务器上打开文件编辑,它只负责存历史。这种只有 `.git`、没有文件的仓库叫**裸仓库(bare repository)**,用 `git init --bare` 创建。GitHub 上的每个仓库,背后就是一个裸仓库。我们拿它当假 GitHub。

## 第一步:把 agent-zero-lab 推上去

推之前要先做一件重要的事:**检查整个历史里有没有 key。** Day 56 查的是「这一次要提交的内容」,但一旦推到网上,是**所有历史**都被带上去,以前哪一次提交里混进过 key,现在都跟着公开。所以第一次 push 之前,翻一遍全部历史:

```bash
cd ~/agent-zero-lab
git log -p --all | grep -E "sk-[A-Za-z0-9-]{20,}"
echo "grep exit=$?"
git ls-files | grep env
```

<div class="line-notes">

- `git log -p --all | grep -E "sk-[A-Za-z0-9-]{20,}"` `git log -p` 打印每次提交的完整改动,`--all` 把所有分支都算上,再交给 `grep` 找 `sk-` 开头的长串(Day 56 同一条正则)。这是对**整个历史**的扫描,不是只看暂存区。
- `echo "grep exit=$?"` 退出码 1 是没找到,我们想要的结果。
- `git ls-files | grep env` `git ls-files` 列出 git 正在跟踪的所有文件,再找名字里带 `env` 的。应该只有 `.env.example`。

</div>

实测输出:

```text
grep exit=1
.env.example
```

历史里没有疑似 key,被跟踪的 env 文件只有模板。干净,可以推。(如果这里扫出了东西,先别推,回 Day 56 的处理顺序:先作废 key。)

接下来三件事:给仓库建一个假的「远程」,把本地分支名统一成 `main`,把两边连起来。

```bash
mkdir -p ~/fake-github
git init --bare ~/fake-github/agent-zero-lab.git
git --git-dir=$HOME/fake-github/agent-zero-lab.git symbolic-ref HEAD refs/heads/main
git branch -m master main
git push
git remote add origin ~/fake-github/agent-zero-lab.git
git remote -v
git push -u origin main
git branch -vv
git status
git ls-remote origin
```

<div class="line-notes">

- `mkdir -p ~/fake-github` 放假 GitHub 的目录。
- `git init --bare ~/fake-github/agent-zero-lab.git` `--bare` 建裸仓库。惯例是目录名以 `.git` 结尾,表示这是个纯仓库。
- `git --git-dir=$HOME/fake-github/agent-zero-lab.git symbolic-ref HEAD refs/heads/main` 这一行**只在假 GitHub 上需要**。我的 git 太老,新建裸仓库的默认分支是 `master`,而我们要推的是 `main`,不对上的话别人 clone 时会报 `remote HEAD refers to nonexistent ref`(我第一次就踩了)。真的 GitHub 建仓库时默认分支就是 `main`,什么都不用做。`--git-dir` 是指定「对哪个仓库操作」。
- `git branch -m master main` `-m` 是 move,把当前分支改名。GitHub 的默认分支叫 `main`,所以先把本地的 `master` 改成 `main`。改名只动标签,提交一个没变。
- `git push` 故意在没有远程的时候推一次,看报错。
- `git remote add origin ~/fake-github/agent-zero-lab.git` 登记一个叫 `origin` 的远程,地址是后面那一串。真 GitHub 上这里是 `git@github.com:你的用户名/agent-zero-lab.git`。
- `git remote -v` `-v` 是 verbose,列出所有远程和它们的地址,每个远程会出现两行:`(fetch)` 是从哪拉,`(push)` 是往哪推,通常相同。
- `git push -u origin main` `push` 后面是「远程名 分支名」。`-u` 是 `--set-upstream`:顺便记住「本地 `main` 对应 `origin/main`」,以后在这个分支上直接敲 `git push`、`git pull` 就行,不用再写后面两个词。
- `git branch -vv` 两个 `v` 是更详细,会显示每个分支跟踪哪个远程分支。
- `git status` 现在会多出一句和远程的比较。
- `git ls-remote origin` 直接问远程「你有哪些分支、各在哪次提交」,不下载任何东西。

</div>

实测输出。没有远程就 push:

```text
fatal: No configured push destination.
Either specify the URL from the command-line or configure a remote repository using

    git remote add <name> <url>

and then push using the remote name

    git push <name>

```

建好裸仓库、登记 `origin` 之后:

```text
origin	/Users/你/fake-github/agent-zero-lab.git (fetch)
origin	/Users/你/fake-github/agent-zero-lab.git (push)
```

```text
To /Users/你/fake-github/agent-zero-lab.git
 * [new branch]      main -> main
Branch 'main' set up to track remote branch 'main' from 'origin'.
```

```text
* main d3b72f8 [origin/main] 加 CHANGELOG.md
```

```text
On branch main
Your branch is up to date with 'origin/main'.

nothing to commit, working tree clean
```

```text
d3b72f8eb44fb27285ae8edaa9d514409fadb4a0	refs/heads/main
```

读几处:`* [new branch] main -> main` 说远程原来没有 `main`,这次新建了;`[origin/main]` 是 `-vv` 里的方括号,说明本地 `main` 跟踪 `origin/main`;`Your branch is up to date with 'origin/main'` 是 `status` 在比较本地 `main` 和那张 `origin/main` 标签,一致;`ls-remote` 里远程的 `main` 指向 `d3b72f8...`,和本地 `main` 的提交编号对上。**这条 `ls-remote` 是验证「真的推上去了」最直接的办法,不依赖任何网页。**

## 第二步:同事的改动怎么拿下来

一个人用 GitHub 当备份,另一个人用它协作,区别只在于「远程上会出现你没有的提交」。我们造一个同事:在另一个目录 clone 一份,用另一个名字提交,推上去。

```bash
mkdir ~/colleague
git clone ~/fake-github/agent-zero-lab.git ~/colleague/agent-zero-lab
cd ~/colleague/agent-zero-lab
git config user.name "同事"
git config user.email "colleague@example.com"
git remote -v
git log --oneline --decorate -3
printf '\n## 本地环境\n\n- Python 3.12,用 uv 管理\n' >> README.md
git commit -am "README 写明 Python 版本"
git push
```

<div class="line-notes">

- `git clone ~/fake-github/agent-zero-lab.git ~/colleague/agent-zero-lab` `clone` 后面是「从哪来」和「放到哪」。真实场景里第一个参数是 `git@github.com:某人/仓库.git`。它一次做了四件事:建目录、把整个历史复制下来、登记 `origin`、检出默认分支。
- `git config user.name "同事"` / `git config user.email "colleague@example.com"` 去掉了 `--global`,所以只对**这一个仓库**生效,不会改变你的全局身份(Day 56 里 `--global` 是整台电脑)。这里是为了让同事的提交作者显示成「同事」。
- `git remote -v` clone 出来的仓库已经自带 `origin`,不用再 `remote add`。
- `git log --oneline --decorate -3` 能看到 `origin/main` 和 `origin/HEAD` 两张标签都贴在最新提交上。
- `printf '\n## 本地环境\n\n- Python 3.12,用 uv 管理\n' >> README.md` 在同事这边的 README 末尾追加一节。
- `git commit -am "README 写明 Python 版本"` 同事提交。
- `git push` 不带参数:clone 出来的分支自动跟踪 `origin/main`,所以直接推。

</div>

实测输出:

```text
Cloning into '/Users/你/colleague/agent-zero-lab'...
done.
```

```text
d3b72f8 (HEAD -> main, origin/main, origin/HEAD) 加 CHANGELOG.md
5827ac7 Merge branch 'readme-run-hint'
189048b README 说明 data 目录
```

```text
[main b24efdd] README 写明 Python 版本
 1 file changed, 4 insertions(+)
```

```text
To /Users/你/fake-github/agent-zero-lab.git
   d3b72f8..b24efdd  main -> main
```

最后一块说明远程的 `main` 从 `d3b72f8` 前进到了 `b24efdd`。

回到**你的**仓库。你还不知道同事推了东西。先 `fetch` 看看:

```bash
cd ~/agent-zero-lab
git status
git fetch
git status
git log --oneline --decorate --all -3
git diff main origin/main --stat
git pull
git log -1 --format=%an
```

<div class="line-notes">

- `git status` 第一次:仍然说 `up to date with 'origin/main'`。注意:**`status` 只比较本地那张 `origin/main` 标签,不会联网**,所以它不知道远程已经变了。这是新手最容易被骗的地方,「up to date」不等于「远程没动」。
- `git fetch` 联网,把同事那次提交取回来,更新 `origin/main` 标签,你的 `main` 和文件完全没动。
- `git status` 第二次:现在知道落后了。
- `git log --oneline --decorate --all -3` `--all` 把所有标签都算进来,`origin/main` 比 `main` 多走了一格。
- `git diff main origin/main --stat` 比较两张标签之间的差别,`--stat` 只看统计。在决定要不要合并之前,先看他改了什么。
- `git pull` 这次 `main` 没有新提交,所以是快进。
- `git log -1 --format=%an` `--format=%an` 只打印作者名(author name),确认最新提交是同事写的。

</div>

实测输出:

```text
On branch main
Your branch is up to date with 'origin/main'.

nothing to commit, working tree clean
```

`fetch` 之后:

```text
From /Users/你/fake-github/agent-zero-lab
   d3b72f8..b24efdd  main       -> origin/main
```

```text
On branch main
Your branch is behind 'origin/main' by 1 commit, and can be fast-forwarded.
  (use "git pull" to update your local branch)

nothing to commit, working tree clean
```

```text
 README.md | 4 ++++
 1 file changed, 4 insertions(+)
```

```text
Updating d3b72f8..b24efdd
Fast-forward
 README.md | 4 ++++
 1 file changed, 4 insertions(+)
```

最后一条 `git log -1 --format=%an` 输出 `同事`。这就是「拉下来别人的改动」的完整过程。习惯上 `git pull` 前先 `fetch` 看一眼不是必须,但**不熟的时候更稳**:`pull` 会直接改你的文件和分支,`fetch` 不会。

### 被拒绝:rejected (fetch first)

更常见的情况是你俩同时在干活。同事又推了一次;你这边在不知情的情况下也提交了一次,然后 push:

```bash
git push
git pull --no-edit
git log --oneline --decorate --graph -5
git push
```

<div class="line-notes">

- `git push` 第一次:被拒绝。
- `git pull --no-edit` 先把远程的新提交取回来合并,`--no-edit` 是不弹编辑器、用默认的合并说明。
- `git log --oneline --decorate --graph -5` 看菱形。
- `git push` 第二次:你的 `main` 现在包含了远程所有的提交,又多了自己的,所以是快进,通过。

</div>

(这之前我让同事加了 `NOTES.md` 并推送,你自己加了 `TODO.md` 并提交,两件事互不相干。)

实测输出:

```text
To /Users/你/fake-github/agent-zero-lab.git
 ! [rejected]        main -> main (fetch first)
error: failed to push some refs to '/Users/你/fake-github/agent-zero-lab.git'
hint: Updates were rejected because the remote contains work that you do
hint: not have locally. This is usually caused by another repository pushing
hint: to the same ref. You may want to first integrate the remote changes
hint: (e.g., 'git pull ...') before pushing again.
hint: See the 'Note about fast-forwards' in 'git push --help' for details.
```

```text
From /Users/你/fake-github/agent-zero-lab
   b24efdd..f4ee53b  main       -> origin/main
Merge made by the 'recursive' strategy.
 NOTES.md | 1 +
 1 file changed, 1 insertion(+)
 create mode 100644 NOTES.md
```

```text
*   4632d95 (HEAD -> main) Merge branch 'main' of /Users/你/fake-github/agent-zero-lab into main
|\  
| * f4ee53b (origin/main) 加 NOTES.md
* | b933645 加 TODO.md
|/  
* b24efdd README 写明 Python 版本
* d3b72f8 加 CHANGELOG.md
```

```text
To /Users/你/fake-github/agent-zero-lab.git
   f4ee53b..4632d95  main -> main
```

`! [rejected] main -> main (fetch first)` 翻译成人话:**远程有你没有的提交,git 不让你直接覆盖它。** `fetch first` 是它给的提示:先取回来。解决办法永远是:`git pull`(取回并合并),必要时解决冲突(Day 57 那一套,同一行被改就会有 `<<<<<<<`,练习 2 里会遇到),然后再 `git push`。注意这里 git 在保护同事的工作:如果允许你直接推,同事的那次提交就被你的历史顶掉了。

## 第三步:SSH key,让 GitHub 认得你

推到真 GitHub 时,每次推送它都要确认「你是谁、有没有权限」。有两种方式:

- **HTTPS 地址**(`https://github.com/你的用户名/agent-zero-lab.git`):要输入用户名和**个人访问令牌**(personal access token,一串类似 key 的字符)。GitHub 官方文档写得很明确,基于密码的 git 认证已经取消,输入账号密码不行了,必须用令牌或者凭据管理器。
- **SSH 地址**(`git@github.com:你的用户名/agent-zero-lab.git`):用一对**密钥**,配置一次,以后推拉都不用再输东西。

本课用 SSH。原因不是 HTTPS 不好,而是 SSH 配一次之后最省心,而且你以后连服务器、连别的 git 平台,用的是同一套机制,这是后端工程师的基本功。

### 一对钥匙:公钥和私钥

SSH key 是一对文件,配套生成:

- **私钥**(private key):留在你的电脑上,**永远不给任何人**,不发邮件、不贴聊天、不提交进 git。它相当于你的身份本身。
- **公钥**(public key):可以公开,交给 GitHub。它相当于一把「锁」,装在 GitHub 那边。

登录时的过程:GitHub 拿公钥出一道只有对应私钥才能答出的题,你的电脑用私钥答题,答对了就证明「你有这把私钥」,全程私钥本身不离开你的电脑,**网络上传的从来不是密码**。你熟悉的 JWT 签名验证是同类思路:一边用私钥签,另一边用公钥验。

<figure>
<svg viewBox="0 0 640 250" role="img" aria-label="SSH key 认证:本地电脑保存私钥,永远不外传;公钥通过 GitHub 网页的 Settings 添加到账号;git push 时 GitHub 用公钥出题,本地用私钥作答,答对即通过,私钥不经过网络">
<rect x="0" y="0" width="640" height="250" fill="var(--paper-raised)" rx="6"/>
<g font-family="var(--font-mono)" font-size="12">
<rect x="16" y="40" width="230" height="130" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="131" y="62" text-anchor="middle" fill="var(--ink)">你的电脑 ~/.ssh/</text>
<text x="32" y="92" fill="var(--ink)" font-size="12">id_ed25519</text>
<text x="32" y="110" fill="var(--ink-soft)" font-size="11">私钥:留在这里,不外传</text>
<text x="32" y="138" fill="var(--ink)" font-size="12">id_ed25519.pub</text>
<text x="32" y="156" fill="var(--ink-soft)" font-size="11">公钥:可以贴给 GitHub</text>
<rect x="394" y="40" width="230" height="130" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="509" y="62" text-anchor="middle" fill="var(--ink)">GitHub 你的账号</text>
<text x="410" y="92" fill="var(--ink)" font-size="12">SSH keys 列表</text>
<text x="410" y="110" fill="var(--ink-soft)" font-size="11">里面是你贴的公钥</text>
<line x1="246" y1="144" x2="394" y2="144" stroke="var(--ink-soft)" stroke-dasharray="4 3"/>
<text x="320" y="136" text-anchor="middle" fill="var(--ink)" font-size="11">① 只把公钥交过去</text>
<line x1="246" y1="86" x2="394" y2="86" stroke="var(--ink-soft)"/>
<text x="320" y="78" text-anchor="middle" fill="var(--ink)" font-size="11">② git push</text>
<line x1="394" y1="104" x2="246" y2="104" stroke="var(--ink-soft)"/>
<text x="320" y="122" text-anchor="middle" fill="var(--ink)" font-size="11">③ 用公钥出题,私钥作答</text>
<text x="16" y="210" fill="var(--ink-faint)" font-size="11">私钥从不上网;丢了私钥 = 别人能冒充你,发现就去 GitHub 删掉对应的公钥</text>
</g>
</svg>
<figcaption>一次性配置:生成一对钥匙,把公钥放到 GitHub。之后每次推拉,GitHub 用公钥验证你手里有私钥。</figcaption>
</figure>

### 生成:ssh-keygen

```bash
ssh-keygen -t ed25519 -C "learner@example.com"
```

<div class="line-notes">

- `ssh-keygen -t ed25519 -C "learner@example.com"` `ssh-keygen` 是 macOS 自带的生成密钥的工具,不用额外安装。`-t` 是 type,选算法:`ed25519` 是现在 GitHub 官方文档推荐的算法,key 短、快、安全,老教程里的 `rsa -b 4096` 也能用,但不再是首选。`-C` 是 comment(备注),只是写在公钥末尾的一段文字,方便你以后认出「这是哪把 key」,通常写邮箱,不影响安全。

</div>

敲下去,它会依次问你三件事:存到哪里(直接回车用默认的 `~/.ssh/id_ed25519`),设不设**口令**(passphrase),再确认一次口令。**口令**相当于给私钥再加一把锁,即使私钥文件被偷走,没有口令也用不了。GitHub 官方文档建议设一个。我这里为了让命令能自动跑,用 `-N ""`(口令留空)演示,你自己做的时候建议设口令。macOS 上要不用每次输口令,还可以让 `ssh-agent` 和钥匙串记住它(`ssh-add --apple-use-keychain ~/.ssh/id_ed25519`,配置见官方文档那一页,链接在学习资料里,这一步我没有实跑,因为会碰系统钥匙串)。

如果你**已经有** `~/.ssh/id_ed25519`,它会问 `already exists. Overwrite (y/n)?`,**这里一定要选 n**,覆盖等于永远失去旧私钥。想再建一把就用 `-f` 起别的名字(练习 3 会做)。

我的实测输出(真跑的):

```text
Generating public/private ed25519 key pair.
Your identification has been saved in /Users/你/.ssh/id_ed25519
Your public key has been saved in /Users/你/.ssh/id_ed25519.pub
The key fingerprint is:
SHA256:gG8VEA2GWBUziQ4i8PW4uwVkqu87BWmM/Wzi98UI7gg learner@example.com
The key's randomart image is:
+--[ED25519 256]--+
|o  oo+XB.        |
|o.o.o=.o..       |
|.=.+= o .        |
|. *+.o o         |
| ..++ o S        |
| ...== o         |
|E. +o o o        |
| ooo.o .         |
| .=+o..          |
+----[SHA256]-----+
```

(这是演示用的一次性 key,只存在我的临时目录,没有交给任何服务;你的指纹和图案每个人都不同。)看到的两个文件:

```bash
ls -l ~/.ssh
ssh-keygen -lf ~/.ssh/id_ed25519.pub
cat ~/.ssh/id_ed25519.pub
head -1 ~/.ssh/id_ed25519
```

<div class="line-notes">

- `ls -l ~/.ssh` `-l` 是长格式,最左边一列是权限。这里要看私钥和公钥的权限不同。
- `ssh-keygen -lf ~/.ssh/id_ed25519.pub` `-l` 是 list fingerprint(显示指纹),`-f` 指定文件。指纹是公钥的短摘要,方便肉眼核对「这是不是同一把」。
- `cat ~/.ssh/id_ed25519.pub` 公钥只有一行文字,开头是算法名 `ssh-ed25519`,中间是一长串编码,末尾是备注。**贴给 GitHub 的就是这一整行。**
- `head -1 ~/.ssh/id_ed25519` 只看私钥的第一行,证明它是私钥,**千万不要 `cat` 出整个私钥贴给任何人或任何聊天窗口**。

</div>

实测输出:

```text
-rw-------  1 你  wheel  411 23 Oct 11:52 id_ed25519
-rw-r--r--  1 你  wheel  101 23 Oct 11:52 id_ed25519.pub
```

```text
256 SHA256:gG8VEA2GWBUziQ4i8PW4uwVkqu87BWmM/Wzi98UI7gg learner@example.com (ED25519)
```

```text
ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIAlIjYXrXoUFCl2EvW20MvvYAghXXW4lvAfyXfkq8Nwv learner@example.com
```

```text
-----BEGIN OPENSSH PRIVATE KEY-----
```

权限那一列的读法(Day 4 学过一点):`-rw-------` 是「只有我自己能读写」(也写作 `600`),给私钥;`-rw-r--r--` 是「我能读写,别人只能读」(`644`),公钥无所谓。**私钥权限不对,ssh 会直接拒绝用它**。我把私钥权限改成 `644` 试一下:

```bash
chmod 644 ~/.ssh/id_ed25519_practice
ssh-keygen -y -f ~/.ssh/id_ed25519_practice
chmod 600 ~/.ssh/id_ed25519_practice
```

<div class="line-notes">

- `chmod 644 ~/.ssh/id_ed25519_practice` 用一把练习用的 key(练习 3 里生成)演示。`chmod` 是改权限,`644` 是「所有者读写,其他人只读」。
- `ssh-keygen -y -f ~/.ssh/id_ed25519_practice` `-y` 是「从私钥算出对应的公钥并打印」,它要先读私钥,所以也会触发权限检查。真的连 GitHub 时 `ssh` 会报同样的错。
- `chmod 600 ~/.ssh/id_ed25519_practice` 改回来:`600` 是只有所有者可读写。

</div>

实测输出(路径缩短):

```text
@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@
@         WARNING: UNPROTECTED PRIVATE KEY FILE!          @
@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@
Permissions 0644 for '/Users/你/.ssh/id_ed25519_practice' are too open.
It is required that your private key files are NOT accessible by others.
This private key will be ignored.
```

`too open`(太开放)就是这个意思:别人也能读你的私钥,ssh 觉得不安全,干脆当它不存在。改回 `600` 就好。`~/.ssh` 目录本身也应该是 `700`(只有你能进)。

### 把公钥交给 GitHub(这一段没实跑)

下面是对照 GitHub 官方文档写的网页步骤,我没有登录真实账号操作:

1. 把公钥复制到剪贴板:`pbcopy < ~/.ssh/id_ed25519.pub`(macOS 的 `pbcopy` 把标准输入放进剪贴板)。复制的是**整行**,不要多出换行或空格。
2. 浏览器登录 GitHub,右上角点头像,进 **Settings**,侧栏找到 **SSH and GPG keys**,点 **New SSH key**。
3. **Title** 随便起,写清是哪台电脑,比如 `MacBook 2019`;**Key type** 选 Authentication Key;**Key** 里粘贴刚才复制的那一行。点 **Add SSH key**,如果提示确认密码就确认。

然后验证:

```bash
ssh -T git@github.com
```

第一次连接,ssh 会问你是否信任这台服务器:`The authenticity of host 'github.com (...)' can't be established. ED25519 key fingerprint is SHA256:+DiY3wvvV6TuJJhbpZisF/zLDA0zPMSvHdkr4UvCOqU. Are you sure you want to continue connecting (yes/no)?`。**这时候要把你屏幕上的指纹和 GitHub 官方文档公布的指纹对一遍**(官方文档页面「GitHub's SSH key fingerprints」,链接在学习资料里),一致才输入 `yes`;不一致不要继续,可能是有人在中间冒充。它会把服务器记进 `~/.ssh/known_hosts`,以后不再问。成功时 GitHub 官方文档写的输出是:

```text
Hi 你的用户名! You've successfully authenticated, but GitHub does not provide shell access.
```

`-T` 是不要分配终端(GitHub 本来就不给你 shell),这句「authenticated,但不提供 shell」就是成功。

### 本机上的替代演示:key 认证握手

我没法对 GitHub 真跑 `ssh -T`,所以在本机起了一个只监听 `127.0.0.1:2222` 的 `sshd`,里面只登记了我刚生成的公钥,用同样的 `ssh` 客户端去连,看握手的几行。(为了不碰系统的真实配置,`ssh` 用 `-F` 指定了我自己的配置文件;`ssh` 读配置的位置不跟着 `HOME` 环境变量走,这一点和 git 不一样,所以不能只靠「换个假家目录」隔离它。)

```text
$ ssh -v fake-github true
debug1: Server host key: ssh-ed25519 SHA256:9BqALZs3UCX28NxIH3dL56L4ar4caUkF0YfR5nYg5uo
debug1: Authentications that can continue: publickey
debug1: Offering public key: ~/.ssh/id_ed25519 ED25519 SHA256:gG8VEA2GWBUziQ4i8PW4uwVkqu87BWmM/Wzi98UI7gg explicit
Authenticated to 127.0.0.1 ([127.0.0.1]:2222) using "publickey".
```

<div class="line-notes">

- `ssh -v fake-github true` `-v` 打印调试信息(输出太长,我只摘了关键四行);`fake-github` 是我在 `~/.ssh/config` 里起的别名,指向 `127.0.0.1:2222`;末尾的 `true` 是让远端执行的命令(什么都不做)。
- `Server host key: ssh-ed25519 SHA256:9BqALZs3` 服务器亮出它自己的指纹,就是上面「要核对」的那个东西。第一次连会被写进 `known_hosts`。
- `Authentications that can continue: publickey` 服务器说「我只接受公钥认证」(我在配置里关掉了密码登录)。
- `Offering public key: ~/.ssh/id_ed25519 ED25519 SHA256:gG8VEA2G` 客户端把我的公钥指纹递过去:「我有这把钥匙,你认识吗」,指纹和前面 `ssh-keygen -lf` 打出来的一致。
- `Authenticated to 127.0.0.1 ([127.0.0.1]:2222) using "publickey".` 服务器出题,私钥答对了,认证通过。这一行就是 GitHub 那边 `Hi 你的用户名!` 的前半句。

</div>

用一把没登记过的 key 去连,会得到:

```text
你@127.0.0.1: Permission denied (publickey).
```

真的 GitHub 上,你的公钥没贴对或者用错了 key,报的是 `git@github.com: Permission denied (publickey).`,下面跟一行 `fatal: Could not read from remote repository.`(这两行是我对 GitHub 常见报错形状的了解,没有实跑)。排查顺序:`ssh -T git@github.com` 单独试;`ssh -vT git@github.com` 看 `Offering public key` 递的是不是你以为的那把;再看公钥是不是完整贴上了。

### 国内网络:22 端口被拦怎么办

SSH 默认走 22 端口,有的网络会拦。GitHub 官方文档提供了一个办法:走 **443 端口**(HTTPS 的端口),在 `~/.ssh/config` 里加:

```text
Host github.com
    Hostname ssh.github.com
    Port 443
    User git
```

测试用 `ssh -T -p 443 git@ssh.github.com`,成功输出和上面一样。之后原来的 `git@github.com:...` 地址不用改,ssh 会自己转到 443。这一段我同样没有对真 GitHub 实跑。

## 第四步:在真 GitHub 上建仓库、推送(没实跑)

下面是你要自己做的真实步骤,我对照官方文档写,没有登录操作:

1. 登录 GitHub,右上角 **+**,选 **New repository**。
2. **Repository name** 填 `agent-zero-lab`。可见性选 **Private**(私有,只有你能看)。lab 里有你的练习和配置,私有更稳。
3. **不要**勾选「Add a README」「Add .gitignore」「Choose a license」,因为本地已经有了,勾了会让远程多出一次你没有的提交,第一次 push 就会被拒绝(就是上面 `fetch first` 那个错)。点 **Create repository**。
4. 新建好的空仓库页面会列出「push an existing repository from the command line」那三条命令,用你的用户名替换:

```bash
cd ~/agent-zero-lab
git remote add origin git@github.com:你的用户名/agent-zero-lab.git
git branch -M main
git push -u origin main
```

<div class="line-notes">

- `git remote add origin git@github.com:你的用户名/agent-zero-lab.git` 和第一步一模一样,只是地址换成真的。`git@github.com:` 是 SSH 地址的写法,冒号后面是「用户名/仓库名」。
- `git branch -M main` 大写 `-M` 是「强制改名」,分支已经叫 `main` 时也不会报错,所以网页给的是这一条。我们前面用的小写 `-m` 在已经同名时会报错。
- `git push -u origin main` 第一次推送并建立跟踪。

</div>

推完刷新网页,你应该看到文件列表和提交历史。**最后一步一定要做:在网页的文件列表里确认没有 `.env`。** 有 `.gitignore` 挡着的话它根本不会在这,但看一眼才放心。(GitHub 官方文档说,个人账号默认开着「推送保护」(push protection),往公开仓库推已知格式的密钥会被拦下。但它是最后一道保险,不是你可以省掉本地检查的理由。)

## 第五步:PR,团队怎么往 main 里合代码

一个人的仓库可以随便往 `main` 推。进了团队,`main` 通常被**保护**起来:GitHub 的分支保护规则可以禁止直接往它 push、禁止强制推送、要求至少几个人审阅、要求自动检查通过才能合并。想改 `main` 只有一条路:开分支,推分支,提 **PR**(Pull Request,合并请求):

1. 本地开分支,写代码,提交。
2. `git push -u origin 分支名` 把分支推到远程。
3. 在 GitHub 网页上打开一个 PR:选「把这个分支并进 `main`」,写标题和说明。PR 页面会自动显示两个分支之间的差异(就是 Day 56 学的 diff),别人在上面逐行评论。
4. 评审通过、自动检查(CI,持续集成,比如跑测试)变绿之后,点 **Merge** 按钮。
5. 合并完删掉分支。

<figure>
<svg viewBox="0 0 640 250" role="img" aria-label="PR 流程五步:本地开分支提交,push 分支到 origin,在 GitHub 开 PR,评审和检查通过后点 Merge,最后删分支并在本地 pull 同步 main">
<rect x="0" y="0" width="640" height="250" fill="var(--paper-raised)" rx="6"/>
<g font-family="var(--font-mono)" font-size="12">
<rect x="12" y="50" width="108" height="64" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="66" y="76" text-anchor="middle" fill="var(--ink)">① 本地</text>
<text x="66" y="96" text-anchor="middle" fill="var(--ink-soft)" font-size="11">开分支 提交</text>
<rect x="132" y="50" width="108" height="64" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="186" y="76" text-anchor="middle" fill="var(--ink)">② push</text>
<text x="186" y="96" text-anchor="middle" fill="var(--ink-soft)" font-size="11">推分支</text>
<rect x="252" y="50" width="108" height="64" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="306" y="76" text-anchor="middle" fill="var(--ink)">③ 开 PR</text>
<text x="306" y="96" text-anchor="middle" fill="var(--ink-soft)" font-size="11">看 diff 评论</text>
<rect x="372" y="50" width="108" height="64" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="426" y="76" text-anchor="middle" fill="var(--ink)">④ Merge</text>
<text x="426" y="96" text-anchor="middle" fill="var(--ink-soft)" font-size="11">检查通过后</text>
<rect x="492" y="50" width="136" height="64" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="560" y="76" text-anchor="middle" fill="var(--ink)">⑤ 回本地</text>
<text x="560" y="96" text-anchor="middle" fill="var(--ink-soft)" font-size="11">pull main 删分支</text>
<line x1="120" y1="82" x2="132" y2="82" stroke="var(--ink-soft)"/>
<line x1="240" y1="82" x2="252" y2="82" stroke="var(--ink-soft)"/>
<line x1="360" y1="82" x2="372" y2="82" stroke="var(--ink-soft)"/>
<line x1="480" y1="82" x2="492" y2="82" stroke="var(--ink-soft)"/>
<text x="16" y="150" fill="var(--ink-soft)" font-size="11">蓝色框在 GitHub 网页上发生,琥珀色框在你的终端里发生</text>
<text x="16" y="178" fill="var(--ink)" font-size="11">点 Merge 的时候,GitHub 在服务器上做的就是 Day 57 的 git merge</text>
<text x="16" y="200" fill="var(--ink-soft)" font-size="11">三种合并方式:merge commit / squash / rebase(下面讲)</text>
</g>
</svg>
<figcaption>PR 把「开分支、合并」这件事搬到了网页上,多出来的是评论、检查和评审。</figcaption>
</figure>

### 在本地模拟一遍

PR 的网页部分没法用假 GitHub 实跑,但命令部分都可以。你先开分支、推分支:

```bash
cd ~/agent-zero-lab
git switch -c feature/readme-pr-flow
printf '\n## 提交流程\n\n- 新功能先开分支,推上去提 PR,合并后删分支\n' >> README.md
git commit -am "README 写明提交流程"
git push -u origin feature/readme-pr-flow
git branch -a
git branch -vv
```

<div class="line-notes">

- `git switch -c feature/readme-pr-flow` 分支名里的斜杠是允许的,团队常用 `feature/`、`fix/` 这样的前缀分类。
- `git commit -am "README 写明提交流程"` 提交一次。
- `git push -u origin feature/readme-pr-flow` 推的是**分支**,第一次同样要 `-u`。真 GitHub 在这一步的输出里会多几行 `remote:`,提示「Create a pull request for ... by visiting: https://github.com/…」,点那个链接就是开 PR(这几行我没法在假 GitHub 上复现)。
- `git branch -a` `-a` 是 all,本地分支和远程跟踪标签(`remotes/origin/...`)一起列。
- `git branch -vv` 看每个分支跟踪谁。

</div>

实测输出:

```text
To /Users/你/fake-github/agent-zero-lab.git
 * [new branch]      feature/readme-pr-flow -> feature/readme-pr-flow
Branch 'feature/readme-pr-flow' set up to track remote branch 'feature/readme-pr-flow' from 'origin'.
```

```text
* feature/readme-pr-flow
  main
  remotes/origin/feature/readme-pr-flow
  remotes/origin/main
```

```text
* feature/readme-pr-flow f57ab47 [origin/feature/readme-pr-flow] README 写明提交流程
  main                   4632d95 [origin/main] Merge branch 'main' of /Users/你/fake-github/agent-zero-lab into main
```

开 PR 之前,git 自己有个命令能生成「请对方来拉我的改动」的摘要文本,它是 PR 这个想法的老祖宗(在 GitHub 出现之前,开源项目就是用邮件发这种请求):

```bash
git request-pull origin/main ~/fake-github/agent-zero-lab.git feature/readme-pr-flow
```

<div class="line-notes">

- `git request-pull origin/main ~/fake-github/agent-zero-lab.git feature/readme-pr-flow` 三个参数:从哪次提交算起(`origin/main`)、你的仓库地址、你的分支名。它列出这个分支比起点多了什么。

</div>

实测输出:

```text
The following changes since commit 4632d9599608f15435fc5cda85d9f8572296ca58:

  Merge branch 'main' of /Users/你/fake-github/agent-zero-lab into main (2026-10-23 11:54:08 +0800)

are available in the Git repository at:

  /Users/你/fake-github/agent-zero-lab.git feature/readme-pr-flow

for you to fetch changes up to f57ab4747019aead2ea219ceba5fb4c8e4c76800:

  README 写明提交流程 (2026-10-23 11:54:25 +0800)

----------------------------------------------------------------
学习者 (1):
      README 写明提交流程

 README.md | 4 ++++
 1 file changed, 4 insertions(+)
```

现在扮演评审者和合并者:同事取回分支,看差异,然后做 GitHub 那个 **Merge** 按钮在服务器上做的事,再推到 `main`:

```bash
cd ~/colleague/agent-zero-lab
git fetch
git branch -r
git diff origin/main origin/feature/readme-pr-flow --stat
git pull
git merge --no-ff origin/feature/readme-pr-flow -m "Merge pull request #1 from 你的用户名/feature/readme-pr-flow"
git push
```

<div class="line-notes">

- `git fetch` 取回远程的所有新东西,包括刚推的分支。输出里会有一行 `* [new branch]      feature/readme-pr-flow -> origin/feature/readme-pr-flow`。
- `git branch -r` `-r` 是只列远程跟踪标签。
- `git diff origin/main origin/feature/readme-pr-flow --stat` 评审的本质:看这个分支比 `main` 多了什么。真实 PR 页面的「Files changed」就是它。
- `git pull` 先把同事自己本地的 `main` 更新到最新(这次是快进,带进来我之前推的 `TODO.md`)。
- `git merge --no-ff origin/feature/readme-pr-flow -m` `--no-ff` 是 no fast-forward:**即使可以快进,也强制生成一个合并提交**。GitHub 的「Create a merge commit」就是这个行为,历史里能看出「这里并过一个 PR」。`-m` 直接写合并说明,格式模仿 GitHub 默认的 `Merge pull request #1 from ...`。
- `git push` 把合并结果推上 `main`。

</div>

实测输出(关键几步):

```text
From /Users/你/fake-github/agent-zero-lab
   f4ee53b..4632d95  main                   -> origin/main
 * [new branch]      feature/readme-pr-flow -> origin/feature/readme-pr-flow
```

```text
  origin/HEAD -> origin/main
  origin/feature/readme-pr-flow
  origin/main
```

```text
Merge made by the 'recursive' strategy.
 README.md | 4 ++++
 1 file changed, 4 insertions(+)
```

```text
To /Users/你/fake-github/agent-zero-lab.git
   4632d95..28e7b18  main -> main
```

回到你这边,同步 `main`,删分支(本地和远程各一次):

```bash
cd ~/agent-zero-lab
git switch main
git pull
git log --oneline --decorate --graph -4
git branch -d feature/readme-pr-flow
git push origin --delete feature/readme-pr-flow
git branch -a
```

<div class="line-notes">

- `git switch main` / `git pull` 回到 `main`,取回同事合并的结果,这次是快进。
- `git log --oneline --decorate --graph -4` 能看到那个带「Merge pull request #1」的菱形,和第二个父亲 `f57ab47`。
- `git branch -d feature/readme-pr-flow` 删本地分支;已经被并进 `main`,小写 `-d` 就行。
- `git push origin --delete feature/readme-pr-flow` 删**远程**的分支。GitHub 网页 PR 合并后有个「Delete branch」按钮,做的是同一件事。
- `git branch -a` 现在只剩 `main` 和 `remotes/origin/main`。

</div>

实测输出:

```text
*   28e7b18 (HEAD -> main, origin/main) Merge pull request #1 from 你/feature/readme-pr-flow
|\  
| * f57ab47 (origin/feature/readme-pr-flow, feature/readme-pr-flow) README 写明提交流程
|/  
*   4632d95 Merge branch 'main' of /Users/你/fake-github/agent-zero-lab into main
|\  
| * f4ee53b 加 NOTES.md
```

```text
Deleted branch feature/readme-pr-flow (was f57ab47).
```

```text
To /Users/你/fake-github/agent-zero-lab.git
 - [deleted]         feature/readme-pr-flow
```

```text
* main
  remotes/origin/main
```

这里有一个小尾巴。**同事那边的 `origin/feature/readme-pr-flow` 标签还在**,因为他没有联系远程,不知道分支被删了:

```bash
cd ~/colleague/agent-zero-lab
git branch -r
git fetch --prune
git branch -r
```

实测输出:

```text
  origin/HEAD -> origin/main
  origin/feature/readme-pr-flow
  origin/main
```

```text
From /Users/你/fake-github/agent-zero-lab
 - [deleted]         (none)     -> origin/feature/readme-pr-flow
```

```text
  origin/HEAD -> origin/main
  origin/main
```

`fetch --prune`(`prune` 是修剪)会把远程已经删掉的分支对应的本地标签一并清掉。时间长了仓库里堆满僵尸标签就用它收拾。

### Merge 按钮上的三个选项

GitHub 点 Merge 时,可以选三种方式,官方文档的说法是:

- **Create a merge commit**:保留 PR 分支上的每一次提交,再加一个合并提交标记汇合点。就是上面 `--no-ff` 的效果。
- **Squash and merge**:把 PR 里所有提交压成**一个**提交放进 `main`。
- **Rebase and merge**:把 PR 的提交一个个接到 `main` 后面,没有合并提交,历史是直线。rebase 我们这门课后面才讲,今天只要知道有这个选项。

压成一个提交这件事可以在本地做出来,看它的特点:

```bash
git switch -c feature/squash-demo
echo "- 第一条" >> CHANGELOG.md; git commit -qam "wip 1"
echo "- 第二条" >> CHANGELOG.md; git commit -qam "wip 2"
echo "- 第三条" >> CHANGELOG.md; git commit -qam "fix typo"
git switch main
git merge --squash feature/squash-demo
git status --short
git commit -m "CHANGELOG 补三条记录"
git log --oneline --graph -3
git branch -d feature/squash-demo
git branch -D feature/squash-demo
```

<div class="line-notes">

- `git switch -c feature/squash-demo` 开一个分支,下面三行各提交一次,说明故意写成 `wip`(work in progress,做到一半)和 `fix typo` 这种随手写的样子。`-qam` 是安静模式加 `-a` 加 `-m`。
- `git switch main` 回主线。
- `git merge --squash feature/squash-demo` 把分支的**全部改动**放进暂存区,但**不提交**。
- `git status --short` 能看到一行 `M  CHANGELOG.md`,已暂存。
- `git commit -m "CHANGELOG 补三条记录"` 你自己提交,三次提交变成一次,说明由你重写。
- `git log --oneline --graph -3` 历史里没有菱形,也看不到 `wip 1`。
- `git branch -d feature/squash-demo` 会被拒绝。
- `git branch -D feature/squash-demo` squash 之后 git 认为分支上的提交**没有被合并**(它们没有以原样出现在 `main` 里),所以小写 `-d` 拒绝,要大写 `-D`。GitHub 的 Squash 按钮之后「Delete branch」能直接删,是因为网页知道这个 PR 已经合了。

</div>

实测输出:

```text
Squash commit -- not updating HEAD
 CHANGELOG.md | 3 +++
 1 file changed, 3 insertions(+)
```

```text
M  CHANGELOG.md
```

```text
* 12969bd CHANGELOG 补三条记录
*   28e7b18 Merge pull request #1 from 你/feature/readme-pr-flow
|\  
| * f57ab47 README 写明提交流程
|/  
```

```text
error: The branch 'feature/squash-demo' is not fully merged.
If you are sure you want to delete it, run 'git branch -D feature/squash-demo'.
```

选哪个是团队约定:个人项目通常 squash,历史最干净;想保留每一步细节的选 merge commit。你的 `agent-zero-lab` 以后推 GitHub,你自己说了算。

## 推出去了才发现错了:revert,不要 reset

Day 57 说过:已经推到网上的提交,别 `reset`。现在看真实后果。先做**正确的**办法 `git revert`:它不删历史,而是**新增一次提交,内容是把那次的改动反过来**。

```bash
echo "OOPS" >> TODO.md
git commit -am "TODO 加一行(错的)"
git push
git revert HEAD --no-edit
git log --oneline -3
git push
cat TODO.md
```

<div class="line-notes">

- `echo "OOPS" >> TODO.md` / `git commit -am "TODO 加一行(错的)"` / `git push` 造一个已经推出去的错误提交。
- `git revert HEAD --no-edit` 对最新那次提交生成一次「反向提交」,说明默认是 `Revert "原说明"`;`--no-edit` 不弹编辑器。想撤销更早的某一次,把 `HEAD` 换成它的编号即可(练习 5)。
- `git log --oneline -3` 看到错误提交**还在**,上面多了一条 revert。
- `git push` 正常推,是快进。
- `cat TODO.md` 内容回到了 `OOPS` 之前。

</div>

实测输出:

```text
[main 0f62356] Revert "TODO 加一行(错的)"
 Date: Fri Oct 23 11:54:28 2026 +0800
 1 file changed, 1 deletion(-)
```

```text
0f62356 Revert "TODO 加一行(错的)"
80ec1d6 TODO 加一行(错的)
12969bd CHANGELOG 补三条记录
```

```text
To /Users/你/fake-github/agent-zero-lab.git
   80ec1d6..0f62356  main -> main
```

`TODO.md` 里只剩 `# 我这边加的`。历史里错误的提交和它的撤销都留着,是一份诚实的记录,别人拉取时完全没有麻烦,这是 `revert` 的好处。

再看**错误的做法**,理解为什么不推荐。在另一个练习仓库里重现:我推了一个有问题的 `bad.txt`,同事已经拉到手。我反悔,`reset` 回去再推:

```bash
git reset --hard HEAD~1
git push
git push --force
```

<div class="line-notes">

- `git reset --hard HEAD~1` 本地退一格,`bad.txt` 的提交从我的 `main` 上消失。
- `git push` 被拒绝:远程的 `main` 比我的本地多了一次提交,我的历史成了「落后的」。这条拒绝是 git 在保护远程。
- `git push --force` `--force` 强制推送:不管远程有什么,强行让它和我的一致。远程的 `main` 被改写。**这就是改写公共历史。**

</div>

实测输出:

```text
HEAD is now at 550c55e Revert "加 c.txt(有问题)"
```

```text
 ! [rejected]        main -> main (non-fast-forward)
error: failed to push some refs to '/Users/你/fake-github/push-practice.git'
hint: Updates were rejected because the tip of your current branch is behind
hint: its remote counterpart. Integrate the remote changes (e.g.
hint: 'git pull ...') before pushing again.
hint: See the 'Note about fast-forwards' in 'git push --help' for details.
```

```text
 + daa8876...550c55e main -> main (forced update)
```

现在在**同事**那边,他不知道发生了什么,只是照常写了一个文件、提交、推送:

```text
To /Users/你/fake-github/push-practice.git
   550c55e..83c17f2  main -> main
```

```text
* 83c17f2 (HEAD -> main, origin/main, origin/HEAD) 同事加 work.txt
* daa8876 加 bad.txt
* 550c55e Revert "加 c.txt(有问题)"
```

**推送成功了,而且被我删掉的 `bad.txt` 那次提交 `daa8876` 又回到了远程的 `main` 上。** 因为同事本地的历史里有它,他往上接了一次新提交再推,在远程看来这是一次合法的快进。我以为撤销了的东西,经过同事的手重新活了过来,更糟的是没人会发现,直到出问题。这就是「别改写已经共享的历史」的原因:历史是大家共有的,你改写了你的那份,别人手里的旧版本还会把它带回来。`--force` 只在极少数场合用(比如你确定只有自己用的分支),真要用也该用更安全的 `--force-with-lease`,今天不展开。

结论:**推出去的错误,用 `revert`;没推出去的,才用 `reset`。**

## 零件对照表

| 命令 | 做什么 | 今天在哪里用到 |
| --- | --- | --- |
| `git init --bare` | 建没有工作区的裸仓库(服务器上存的那种) | 假 GitHub |
| `git remote add origin 地址` | 登记远程,起别名 `origin` | 第一步;第四步换成真地址 |
| `git remote -v` | 列出远程和地址 | 第一步、clone 之后 |
| `git push -u origin 分支` | 推送并记住跟踪关系,之后可直接 `git push` | 第一步、推分支 |
| `git clone 地址 目录` | 第一次把整个远程复制下来 | 同事的仓库 |
| `git fetch` | 只取回远程新提交,更新 `origin/xxx` 标签 | 第二步 |
| `git pull` | `fetch` 加 `merge` | 第二步、被拒绝之后 |
| `git branch -vv` / `-a` / `-r` | 看跟踪关系 / 所有分支 / 只看远程标签 | 各处 |
| `git ls-remote origin` | 直接问远程有什么,验证推送成功 | 第一步 |
| `git push origin --delete 分支` | 删远程分支 | PR 合并之后 |
| `git fetch --prune` | 清掉远程已删的分支留下的标签 | 同事那边 |
| `git merge --no-ff` | 强制生成合并提交 | 模拟 Merge 按钮 |
| `git merge --squash` | 把分支所有改动压成暂存区里的一次提交 | Squash 演示 |
| `git revert 提交` | 生成一次反向提交,撤销推出去的错误 | 推出去之后 |
| `ssh-keygen -t ed25519 -C 备注` | 生成一对 SSH key | SSH 一节 |
| `ssh-keygen -lf 公钥文件` | 看指纹 | SSH 一节 |
| `ssh -T git@github.com` | 测试和 GitHub 的 SSH 连接 | 没实跑 |

## 动手练习

练习 1 到 5 全部用本地的假 GitHub(`~/fake-github`)完成,断网也能做,不碰任何真实账号。真实的 GitHub 推送放在最后的验收标准里。

### 练习 1:把一个新仓库推到假 GitHub

在 `~/push-practice` 里建仓库,写一个 `a.txt`(一行「第一行」),提交。先故意不加远程就 `git push`,看报错;再建裸仓库 `~/fake-github/push-practice.git`,登记 `origin`,推上去,最后用两种方式证明远程真的收到了。

<details>
<summary>参考答案</summary>

```bash
mkdir ~/push-practice
cd ~/push-practice
git init
echo "第一行" > a.txt
git add .
git commit -m "初始"
git push
git init --bare ~/fake-github/push-practice.git
git --git-dir=$HOME/fake-github/push-practice.git symbolic-ref HEAD refs/heads/main
git branch -m master main
git remote add origin ~/fake-github/push-practice.git
git push -u origin main
git branch -vv
git ls-remote origin
```

<div class="line-notes">

- `git push` 第一次:还没有远程,必然失败。
- `git init --bare ~/fake-github/push-practice.git` 建假 GitHub 上的仓库。`~/fake-github` 是上面正文里建过的目录;没建过就先 `mkdir -p ~/fake-github`。
- `git --git-dir=$HOME/fake-github/push-practice.git symbolic-ref HEAD refs/heads/main` 把裸仓库的默认分支设成 `main`。你的 git 如果比较新,默认已经是 `main`(或者 `git init --bare --initial-branch=main`),这行可以跳过。
- `git branch -m master main` 把本地分支改名。如果你的 git 新,本来就是 `main`,这条会报错说没有 `master`,忽略即可。
- `git remote add origin ~/fake-github/push-practice.git` 登记远程。
- `git push -u origin main` 推送并建立跟踪。
- `git branch -vv` 第一种证明:本地 `main` 跟踪了 `origin/main`。
- `git ls-remote origin` 第二种证明:直接问远程,它的 `main` 指向的提交和本地对得上。

</div>

实测输出:

```text
fatal: No configured push destination.
Either specify the URL from the command-line or configure a remote repository using

    git remote add <name> <url>

and then push using the remote name

    git push <name>

```

```text
To /Users/你/fake-github/push-practice.git
 * [new branch]      main -> main
Branch 'main' set up to track remote branch 'main' from 'origin'.
```

```text
* main c7b4c90 [origin/main] 初始
```

```text
c7b4c90ece7095c82a5bffbf7c96b6871f220b22	HEAD
c7b4c90ece7095c82a5bffbf7c96b6871f220b22	refs/heads/main
```

`ls-remote` 多出一行 `HEAD`,因为我把裸仓库的默认分支设成了 `main`,`HEAD` 指向的就是它,编号和 `refs/heads/main` 相同。

</details>

### 练习 2:push 被拒绝,pull 里还冲突了

在 `~/other/push-practice` 再 clone 一份当作同事,同事在 `a.txt` 末尾加一行「第二行(同事)」提交并推送。你这边在**同一位置**加「第二行(我)」提交,然后 push,看到被拒绝。用 `git pull` 取回来,这次会冲突,把文件解决成「第二行(我和同事商量后的版本)」,提交,再推送。

<details>
<summary>参考答案</summary>

```bash
mkdir ~/other
git clone ~/fake-github/push-practice.git ~/other/push-practice
cd ~/other/push-practice
git config user.name "同事"
git config user.email "colleague@example.com"
echo "第二行(同事)" >> a.txt
git commit -am "同事改第二行"
git push
cd ~/push-practice
echo "第二行(我)" >> a.txt
git commit -am "我改第二行"
git push
git pull --no-edit
cat a.txt
printf '第一行\n第二行(我和同事商量后的版本)\n' > a.txt
grep -n -E '^(<<<<<<<|=======|>>>>>>>)' a.txt
echo "grep exit=$?"
git add a.txt
git commit --no-edit
git push
git log --oneline --graph --decorate
```

<div class="line-notes">

- `git clone ~/fake-github/push-practice.git ~/other/push-practice` 同事的那份。
- `git config user.name "同事"` / `git config user.email "colleague@example.com"` 只对这个仓库生效。
- `echo "第二行(同事)" >> a.txt` / `git commit -am "同事改第二行"` / `git push` 同事先推,远程多了一次你没有的提交。
- `cd ~/push-practice` 换回你自己的仓库。
- `echo "第二行(我)" >> a.txt` / `git commit -am "我改第二行"` 你在同一个位置也追加了一行,和同事的内容不同。
- `git push` 被拒绝,`fetch first`。
- `git pull --no-edit` 取回同事的提交并合并,同一位置两边都新增了不同的行,冲突。
- `cat a.txt` 看冲突标记。**注意 `>>>>>>>` 后面跟的是一串提交编号**,而不是分支名,因为 `pull` 合并的是 `origin/main` 取回来的提交。
- `printf '第一行\n第二行(我和同事商量后的版本)\n' > a.txt` 写成最终版本。
- `grep -n -E '^(<<<<<<<|=======|>>>>>>>)' a.txt` / `echo "grep exit=$?"` 确认没有残留标记,期望退出码 1。
- `git add a.txt` / `git commit --no-edit` 收尾合并。
- `git push` 这次是快进,通过。
- `git log --oneline --graph --decorate` 看菱形,`origin/main` 和 `main` 在同一个位置。

</div>

实测输出(被拒绝的部分):

```text
 ! [rejected]        main -> main (fetch first)
error: failed to push some refs to '/Users/你/fake-github/push-practice.git'
hint: Updates were rejected because the remote contains work that you do
hint: not have locally. This is usually caused by another repository pushing
hint: to the same ref. You may want to first integrate the remote changes
hint: (e.g., 'git pull ...') before pushing again.
hint: See the 'Note about fast-forwards' in 'git push --help' for details.
```

```text
From /Users/你/fake-github/push-practice
   c7b4c90..67ecc57  main       -> origin/main
Auto-merging a.txt
CONFLICT (content): Merge conflict in a.txt
Automatic merge failed; fix conflicts and then commit the result.
```

```text
第一行
<<<<<<< HEAD
第二行(我)
=======
第二行(同事)
>>>>>>> 67ecc57b419dd59dd73c50796e2688d4216654fa
```

```text
grep exit=1
```

```text
[main 8b7398e] Merge branch 'main' of /Users/你/fake-github/push-practice into main
```

```text
To /Users/你/fake-github/push-practice.git
   67ecc57..8b7398e  main -> main
```

```text
*   8b7398e (HEAD -> main, origin/main) Merge branch 'main' of /Users/你/fake-github/push-practice into main
|\  
| * 67ecc57 同事改第二行
* | 885a1cf 我改第二行
|/  
* c7b4c90 初始
```

结论:`push` 被拒绝不是出错,是 git 提醒「远程有新东西」。`pull` 就是 `fetch` 加 `merge`,所以会遇到 Day 57 一模一样的冲突,处理办法也一样。

</details>

### 练习 3:再生成一把 key,并让它「权限太开放」

不要动你已有的 `~/.ssh/id_ed25519`。用 `-f` 生成一把叫 `id_ed25519_practice` 的练习 key(口令留空,仅练习),然后:(1)用 `ls -l` 看两个文件的权限;(2)看公钥指纹;(3)再生成一次同名 key,看 git 怎么保护你;(4)把私钥改成 `644`,用 `ssh-keygen -y -f` 触发报错,再改回。

<details>
<summary>参考答案</summary>

```bash
ssh-keygen -t ed25519 -C "learner@example.com" -f ~/.ssh/id_ed25519_practice -N ""
ls -l ~/.ssh/id_ed25519_practice*
ssh-keygen -lf ~/.ssh/id_ed25519_practice.pub
ssh-keygen -t ed25519 -C "learner@example.com" -f ~/.ssh/id_ed25519_practice -N ""
chmod 644 ~/.ssh/id_ed25519_practice
ssh-keygen -y -f ~/.ssh/id_ed25519_practice
chmod 600 ~/.ssh/id_ed25519_practice
ssh-keygen -y -f ~/.ssh/id_ed25519_practice
```

<div class="line-notes">

- `ssh-keygen -t ed25519 -C "learner@example.com" -f ~/.ssh/id_ed25519_practice -N ""` `-f` 指定文件名,这样不会覆盖默认的 `id_ed25519`;`-N ""` 是口令留空,省得交互。真正自己用的 key 请设口令。会生成 `id_ed25519_practice` 和 `id_ed25519_practice.pub` 两个文件。
- `ls -l ~/.ssh/id_ed25519_practice*` 星号通配(Day 4),一次看两个文件。
- `ssh-keygen -lf ~/.ssh/id_ed25519_practice.pub` 看指纹。
- `ssh-keygen -t ed25519 -C "learner@example.com" -f ~/.ssh/id_ed25519_practice -N ""` 第二次同名生成,它会停下来问要不要覆盖。
- `chmod 644 ~/.ssh/id_ed25519_practice` 把私钥改成别人也能读。
- `ssh-keygen -y -f ~/.ssh/id_ed25519_practice` 触发 `UNPROTECTED PRIVATE KEY FILE` 警告。
- `chmod 600 ~/.ssh/id_ed25519_practice` 改回。
- `ssh-keygen -y -f ~/.ssh/id_ed25519_practice` 最后一次:现在能正常算出公钥了(输出的那一行和 `.pub` 文件里一致)。

</div>

实测输出(指纹每个人不同):

```text
-rw-------  1 你  wheel  411 23 Oct 11:55 id_ed25519_practice
-rw-r--r--  1 你  wheel  101 23 Oct 11:55 id_ed25519_practice.pub
```

```text
256 SHA256:NkhaM0VP7cj7JHuam2nTI7Fr1h52lGLH1bIjcnUFM/I learner@example.com (ED25519)
```

第二次生成,git 的保护(实际是 `ssh-keygen` 的):

```text
Generating public/private ed25519 key pair.
id_ed25519_practice already exists.
Overwrite (y/n)? 
```

(我这里是脚本环境没有终端可输入,它停在这一行;你在终端里回答 `n`。)权限报错:

```text
@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@
@         WARNING: UNPROTECTED PRIVATE KEY FILE!          @
@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@
Permissions 0644 for '/Users/你/.ssh/id_ed25519_practice' are too open.
It is required that your private key files are NOT accessible by others.
This private key will be ignored.
```

改回 `600` 之后最后一条命令输出 `ssh-ed25519 AAAA…` 开头的一整行,和 `.pub` 文件里的内容相同。练习完把练习 key 删掉:`rm ~/.ssh/id_ed25519_practice ~/.ssh/id_ed25519_practice.pub`。

</details>

### 练习 4:完整走一遍 PR 流程

在 `~/push-practice` 里:开 `feature/hello` 分支,加 `hello.txt` 并提交,推到远程。在同事的 `~/other/push-practice` 里 `fetch`,用 `--no-ff` 合并那个分支到 `main` 并推送。你这边回 `main`、`pull`、删本地和远程的分支;同事用 `fetch --prune` 清理。最后看历史。

<details>
<summary>参考答案</summary>

```bash
cd ~/push-practice
git switch -c feature/hello
echo "hello" > hello.txt
git add hello.txt
git commit -m "加 hello.txt"
git push -u origin feature/hello
cd ~/other/push-practice
git fetch
git switch main
git pull
git merge --no-ff origin/feature/hello -m "Merge pull request #1 from 你/feature/hello"
git push
cd ~/push-practice
git switch main
git pull
git branch -d feature/hello
git push origin --delete feature/hello
cd ~/other/push-practice
git fetch --prune
git branch -r
git log --oneline --graph -4
```

<div class="line-notes">

- `git switch -c feature/hello` 开分支。
- `git push -u origin feature/hello` 第一次推分支要 `-u`。
- `git fetch` 在同事这边,取回刚推的分支,输出里有 `* [new branch] feature/hello -> origin/feature/hello`。
- `git switch main` / `git pull` 先保证同事的 `main` 是最新的,这次已经是最新,输出 `Already up to date.`。
- `git merge --no-ff origin/feature/hello -m "Merge pull request #1 from 你/feature/hello"` 模拟 GitHub 的 Merge 按钮。
- `git push` 推 `main`,同事的 `main` 前进了一次。
- `git switch main` 你自己切回 `main`。
- `git pull` 取回同事合并的结果,快进。
- `git branch -d feature/hello` / `git push origin --delete feature/hello` 本地、远程各删一次。
- `git fetch --prune` 同事清理已经被删的远程分支标签。
- `git branch -r` 确认只剩 `origin/main`。
- `git log --oneline --graph -4` 看合并提交那个菱形。

</div>

实测输出:

```text
To /Users/你/fake-github/push-practice.git
 * [new branch]      feature/hello -> feature/hello
Branch 'feature/hello' set up to track remote branch 'feature/hello' from 'origin'.
```

```text
From /Users/你/fake-github/push-practice
 * [new branch]      feature/hello -> origin/feature/hello
```

```text
Merge made by the 'recursive' strategy.
 hello.txt | 1 +
 1 file changed, 1 insertion(+)
 create mode 100644 hello.txt
```

```text
Deleted branch feature/hello (was 1ce4770).
```

```text
 - [deleted]         (none)     -> origin/feature/hello
```

```text
  origin/HEAD -> origin/main
  origin/main
```

```text
*   0d1a202 Merge pull request #1 from 你/feature/hello
|\  
| * 1ce4770 加 hello.txt
|/  
* 83c17f2 同事加 work.txt
* daa8876 加 bad.txt
```

(下面两行历史是我这个练习仓库里之前其他实验留下的,你的会是你自己的提交。)

</details>

### 练习 5:撤销中间的一次提交

在练习仓库里连续推三次提交:加 `b.txt`、加 `c.txt`(**有问题**)、给 `b.txt` 加一行。想撤销的是**中间**那次,最新的不要动。用 `revert` 完成并推送,说明最后文件里剩什么。

<details>
<summary>参考答案</summary>

```bash
echo "ok-1" > b.txt
git add b.txt
git commit -m "加 b.txt"
echo "bad" > c.txt
git add c.txt
git commit -m "加 c.txt(有问题)"
echo "ok-2" >> b.txt
git commit -am "b.txt 加一行"
git push
git log --oneline -4
git revert HEAD~1 --no-edit
git log --oneline -5
ls
git push
```

<div class="line-notes">

- `echo "ok-1" > b.txt` / `git add b.txt` / `git commit -m "加 b.txt"` 第一次提交。
- `echo "bad" > c.txt` / `git add c.txt` / `git commit -m "加 c.txt(有问题)"` 有问题的那一次,在中间。
- `echo "ok-2" >> b.txt` / `git commit -am "b.txt 加一行"` 最新一次,只改了 `b.txt`。
- `git push` 三次一起推出去。
- `git revert HEAD~1 --no-edit` `HEAD~1` 是「HEAD 的上一次」,也就是有问题的那次,为它生成反向提交。最新那次不受影响,因为它们改的不是同一个文件。
- `ls` 看工作区:`c.txt` 没有了,`b.txt` 还在。
- `git push` 推出反向提交。

</div>

实测输出:

```text
fa74a05 b.txt 加一行
051c994 加 c.txt(有问题)
8ced149 加 b.txt
8b7398e Merge branch 'main' of /Users/你/fake-github/push-practice into main
```

```text
Removing c.txt
[main 550c55e] Revert "加 c.txt(有问题)"
 Date: Fri Oct 23 11:55:14 2026 +0800
 1 file changed, 1 deletion(-)
 delete mode 100644 c.txt
```

```text
550c55e Revert "加 c.txt(有问题)"
fa74a05 b.txt 加一行
051c994 加 c.txt(有问题)
8ced149 加 b.txt
8b7398e Merge branch 'main' of /Users/你/fake-github/push-practice into main
```

`ls` 输出 `a.txt` 和 `b.txt`。`b.txt` 里是两行(`ok-1`、`ok-2`),`c.txt` 没了。如果被撤销的提交和后面的提交改了同一处,`revert` 会像 `merge` 一样产生冲突,解决办法同 Day 57。

</details>

验收标准:练习 1 到 5 的输出和参考答案一致;你已经按第四步在 GitHub 上建了**私有**的 `agent-zero-lab` 仓库,并且 `git ls-remote origin` 能显示 `refs/heads/main`,网页文件列表里没有 `.env`;你能不看文章,在一个新目录里把「建裸仓库、`remote add`、`push -u`、clone 到另一个目录改一点再 push、回来 pull」默写一遍。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 远程仓库(remote) | 放在别的机器上的另一份仓库,GitHub 上的每个仓库就是一个 |
| origin | 远程仓库的默认别名,`git remote add origin 地址` 起的 |
| 裸仓库(bare) | 只有 `.git`、没有工作区的仓库,服务器上存的就是这种 |
| clone | 第一次把整个远程仓库复制到本地,自动设好 `origin` |
| push | 把本地分支的新提交送到远程 |
| fetch | 只把远程的新提交取回来,更新 `origin/xxx` 标签,不动你的分支 |
| pull | `fetch` 加 `merge` |
| 上游(upstream) / 跟踪分支 | 本地分支对应哪个远程分支,`push -u` 建立,之后不用再写 |
| `origin/main` | 本地的一张只读标签,记录「上次联系时远程 main 在哪」 |
| 被拒绝(rejected) | 远程有你没有的提交,git 不让你直接覆盖,先 pull |
| 强制推送(force push) | `git push --force`,不管远程有什么都让它和你一致,会改写公共历史 |
| SSH key | 一对文件(私钥、公钥),用来证明「你是你」,不用每次输密码 |
| 私钥 / 公钥 | 私钥留在电脑上不外传;公钥可以公开,交给 GitHub |
| 口令(passphrase) | 给私钥再加的一把锁 |
| 指纹(fingerprint) | 公钥或服务器密钥的短摘要,用来肉眼核对 |
| known_hosts | `~/.ssh` 里记录「我信任过哪些服务器」的文件 |
| 个人访问令牌(PAT) | HTTPS 方式推拉时代替密码的一串字符 |
| PR(Pull Request) | 请求把一个分支并进另一个分支的网页对象,带差异、评论、检查 |
| 分支保护 | 规则:禁止直接推 `main`、要求评审和检查通过才能合并 |
| revert | 新增一次「反向」提交撤销某次改动,不改历史,可用于已推送的提交 |
| squash | 把多次提交压成一次 |

## 常见误区

**把 `git` 和 GitHub 当成一回事。** git 是本地工具,没网照样用;GitHub 只是托管。你把仓库搬到 GitLab 或自己的服务器,命令一个字都不用改,只换 `origin` 的地址。

**以为 `git status` 说 `up to date` 就是远程没变。** 它比较的是本地那张 `origin/main` 标签,不联网。要知道远程现在的情况,先 `git fetch`。

**GitHub 上建仓库时勾了 README。** 远程多出一次你没有的提交,第一次 `push` 就被拒绝。本地已经有仓库,就建**空**仓库。

**私钥发给别人,或者传进 git。** 只能给 `.pub`。`id_ed25519`(没有后缀的那个)永远不离开你的电脑。万一泄露了,去 GitHub 的 SSH keys 页面把对应公钥删掉,再生成新的。

**`ssh -T` 第一次问「Are you sure you want to continue connecting」,闭眼输 yes。** 先把屏幕上的指纹和 GitHub 官方文档公布的对一遍。

**`~/.ssh/id_ed25519` 已经有了还直接 `ssh-keygen`,在询问覆盖时按了 y。** 旧私钥永远丢了,所有用它登录的地方都进不去。先 `ls ~/.ssh` 看一眼。

**用 HTTPS 地址,GitHub 要密码,输了账号密码报错。** 基于密码的 git 认证已经取消,要用个人访问令牌或凭据管理器。更省事的做法就是改用 SSH 地址:`git remote set-url origin git@github.com:你的用户名/agent-zero-lab.git`。

**推出去的错误提交用 `reset` 再 `push --force`。** 同事手里还有那次提交,他再推一次就让它回来了(正文演示了)。推出去的用 `revert`。

**提了 PR 就一直在 PR 分支上堆无关改动。** 一个 PR 一件事,评审的人才看得懂,出问题也好撤。

**删了远程分支,本地分支标签还在,以为没删干净。** 本地分支和远程分支是两回事,各删各的;别人那边的 `origin/xxx` 标签要靠 `fetch --prune` 清。

## 学习资料

### 文档与文章

- [Pro Git 中文版 · 远程仓库的使用](https://git-scm.com/book/zh/v2/Git-%E5%9F%BA%E7%A1%80-%E8%BF%9C%E7%A8%8B%E4%BB%93%E5%BA%93%E7%9A%84%E4%BD%BF%E7%94%A8):`remote`、`fetch`、`pull`、`push` 的权威讲法,和今天前两步一一对应。
- [GitHub 文档 · Generating a new SSH key and adding it to the ssh-agent](https://docs.github.com/en/authentication/connecting-to-github-with-ssh/generating-a-new-ssh-key-and-adding-it-to-the-ssh-agent):生成 key、macOS 上用钥匙串记住口令的官方步骤(英文,有中文版可在页面右上角切换语言)。
- [GitHub 文档 · Adding a new SSH key to your GitHub account](https://docs.github.com/en/authentication/connecting-to-github-with-ssh/adding-a-new-ssh-key-to-your-github-account):把公钥贴到网页上的每一步。
- [GitHub 文档 · Testing your SSH connection](https://docs.github.com/en/authentication/connecting-to-github-with-ssh/testing-your-ssh-connection):`ssh -T git@github.com` 的预期输出和指纹核对。
- [GitHub 文档 · GitHub's SSH key fingerprints](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/githubs-ssh-key-fingerprints):核对第一次连接时指纹用的官方清单。
- [GitHub 文档 · Using SSH over the HTTPS port](https://docs.github.com/en/authentication/troubleshooting-ssh/using-ssh-over-the-https-port):22 端口被拦时的 443 端口配置。
- [GitHub 文档 · About pull request merges](https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/incorporating-changes-from-a-pull-request/about-pull-request-merges):三种合并方式的官方说明。
- [GitHub 文档 · About protected branches](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches):为什么团队的 `main` 不能直接推。
- [git-push 官方手册](https://git-scm.com/docs/git-push):搜 `Note about fast-forwards`,就是被拒绝时提示里让你看的那一节。
- [git-revert 官方手册](https://git-scm.com/docs/git-revert):撤销已推送提交的命令全貌。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1dV411G77N&autoplay=0&high_quality=1" title="ssh密钥进行github身份验证,ssh公私密钥使用详解,github密钥配置与使用,git密钥使用详解,git入门教程" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>迷斯特航 · ssh密钥进行github身份验证,ssh公私密钥使用详解 · 约 12 分钟,2023 年。对照今天第三步看一遍公钥私钥怎么配;视频里的界面可能和现在的 GitHub 有细微差别,以官方文档为准。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1bd4y1J7Vt&autoplay=0&high_quality=1" title="github仓库的fork与pr,github仓库分叉,pull request,github仓库fork全流程,2023年git最新实用教程" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>迷斯特航 · github仓库的fork与pr · 约 8 分钟,2023 年。讲的是向别人的开源仓库提 PR(先 fork 一份),团队内用同仓库分支,流程相同。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/hK2DQ6kd-PM" title="How to configure GitHub SSH CORRECTLY" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Luke Nobel · How to configure GitHub SSH CORRECTLY · 英文。SSH key 配置的演示,可开字幕。我只核对了标题,没有逐分钟看过。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/Rxn0tBNyQBw" title="Git Remote Operations Explained | push, pull, fetch & GitHub Workflow" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>DheerajTechInsight · Git Remote Operations Explained | push, pull, fetch &amp; GitHub Workflow · 英文。对应第一、二步。同样只核对了标题,没有逐分钟看过。</figcaption>
</figure>

### 书籍

- 《Pro Git》(第二版),Scott Chacon 和 Ben Straub 著,Apress 出版,作者在 git-scm.com 上免费公开全文,有中文版。第 2 章「Git 基础」里的「远程仓库的使用」对应今天;第 5 章「分布式 Git」讲多人协作的几种工作流。

### 开源项目与代码

- [github/gitignore](https://github.com/github/gitignore):GitHub 官方维护的各语言 `.gitignore` 模板合集。新建仓库时可以拿来对照,看看 Python 项目一般要忽略什么。

## 自测

1. `git fetch` 和 `git pull` 的区别是什么?`git status` 显示 `up to date with 'origin/main'`,能说明远程没有新提交吗?

<details><summary>答案</summary>

`fetch` 只把远程的新提交取回来,更新本地的 `origin/main` 标签,不动你的分支和文件;`pull` 是 `fetch` 加 `merge`,会改你当前的分支。不能。`status` 比较的是本地那张 `origin/main` 标签,不联网,远程可能早就变了,要先 `fetch`。

</details>

2. `git push` 提示 `! [rejected] main -> main (fetch first)`,是什么意思?怎么办?

<details><summary>答案</summary>

远程有你本地没有的提交,git 拒绝你直接覆盖它。先 `git pull`(取回并合并,冲突就按 Day 57 的方法解决),再 `git push`。

</details>

3. SSH key 的公钥和私钥,哪个能发给别人?把私钥权限改成 `644` 会怎样?

<details><summary>答案</summary>

公钥(`.pub`)能给,也就是贴到 GitHub 上;私钥永远不能给。私钥权限改成别人可读,`ssh` 会警告 `UNPROTECTED PRIVATE KEY FILE` 并拒绝使用它,要改回只有自己能读写(`600`)。

</details>

4. 为什么第一次在 GitHub 建仓库时不要勾「Add a README」?

<details><summary>答案</summary>

勾了以后远程仓库里就多了一次你本地没有的提交,你第一次 `git push` 会被拒绝(`fetch first`)。本地已经有仓库时应该建空仓库。

</details>

5. 一次错误的提交已经推到 `main` 上,同事也拉走了。你该用 `reset` 加 `push --force` 还是 `revert`?为什么?

<details><summary>答案</summary>

用 `revert`。它新增一次反向提交,不改历史,同事 `pull` 时只是多拿一次提交。`reset` 加 `push --force` 改写了共享历史,同事本地还有那次错误提交,他下一次 `push` 会让它重新回到远程(今天演示过),而且没人会立刻发现。

</details>

6. (面试题)团队里 `main` 被设成保护分支,你要改一行配置。完整说出你从本地到合并的步骤,并说明 PR 比「直接推 `main`」多提供了什么。

<details><summary>答案</summary>

`git switch -c fix/xxx` 开分支,改动,`git commit`,`git push -u origin fix/xxx`,在 GitHub 开 PR,等评审和 CI 通过,点 Merge,删分支,本地 `git switch main` 加 `git pull` 同步。PR 多提供了:变更的集中展示(diff)和逐行评论、自动检查(跑测试、静态检查)在合并前把关、评审记录留档、可以随时回滚的单位(一个 PR 一次合并)。

</details>

## 明天预告

明天是 [Day 59 · HTTP(一):URL、方法和一次请求的样子](/blog/agent-zero/day-059-http-1/)。今天你已经在不知不觉里用到了网络:`git push` 通过 SSH 或 HTTPS 和 GitHub 说话。接下来的几天要换一个更常见的场景,搞清你前端每天在 DevTools 的 Network 面板里看到的那些请求:一次请求到底长什么样,URL 的每一段是什么意思,GET 和 POST 有什么区别。这是后面写 FastAPI 服务、调大模型 API 的基础,因为大模型的 API 说到底就是一条 HTTP 请求。
