---
title: 'Day 6 · 第 1 周复习:编程地基(Day 0–5)'
description: '这周从「AI Agent 工程师做什么」讲到终端的三课。今天不学新命令:画一张本周知识地图,合上文章默写三段核心命令,再只用本周学过的东西,把 9 张工单整理成一份分类文件加一份周报,最后把这几天踩过的坑列成一张错题表。'
pubDate: 2026-10-22
regime: none
tags: ['terminal', 'review', 'agent-zero']
series: 'agent-zero'
day: 6
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 5](/blog/agent-zero/day-005-terminal-3/) 学了每个命令都有标准输出和标准错误两根管子,`>` 把标准输出写进文件(覆盖),`>>` 追加,`2>` 只接报错;`|` 把一条命令的输出交给下一条;`grep` 按字面找行,带上 `-n`、`-c`、`-v`、`-i`、`-r`。那天最后,`~/terminal-practice/tickets.txt` 里攒到了 9 张工单,还写出了第一份 `report.txt`。

这一周前三天在讲「这个岗位是什么、值多少钱、要准备什么」,后三天在练终端。看起来是两块不相干的东西,其实后三天就是在给前三天说的那条路铺第一块砖:往后装 uv、跑 Python、起数据库、部署服务,每一步都在终端里敲。今天停一天,把这一周串起来。

## 今天要解决的问题

学完今天,你应该能:

1. 合上文章默写出三段核心命令:从家目录到 `my-app/src` 再回来的一圈(Day 3)、建目录搬文件再删备份(Day 4)、计费工单小报告(Day 5),跑出和文中一样的结果。
2. 只用本周的命令完成一个小项目:把 9 张工单按类别拆成三个文件,再写一份带总数、各类数量、计费占比和「疑似重复扣款」的周报。
3. 看到本周出现过的每一句报错,不翻文章就能说出病因和改法。

预计用时:3 小时。默写三段各 20 分钟,小项目 1 小时,剩下的时间做练习、自测、整理错题。

前置:[Day 0](/blog/agent-zero/day-000-overview/) 到 [Day 5](/blog/agent-zero/day-005-terminal-3/) 全部。今天不调任何 API,花费 0 元。

学法提示:先对照文章逐条敲一遍命令(不复制粘贴)并对照输出;明天合上文章,把小项目的周报从空目录开始默写一遍;做练习时先自己写,做不出再展开参考答案,看完关掉自己重写一遍。

和前几天一样,下面的输出是我 2026-10-22 在 2019 款 Intel MacBook Pro(macOS 14、zsh)上用同一个演示家目录真跑的,家目录显示成 `/Users/你`。`~/terminal-practice` 的内容和 Day 5 结束时一模一样:我把 Day 4、Day 5 正文和练习里的命令按顺序重放了一遍,才开始写今天的。你那边如果中途跳过了哪道练习,文件数量可能和我不同,先对一下 `tickets.txt` 是不是 9 行。

## 本周知识地图

先看这一周学过的东西放在一起是什么样子。左边三天是「为什么学、学到哪」,右边三天是终端的三层能力:看、改、连。

<figure>
<svg viewBox="0 0 640 300" role="img" aria-label="第 1 周知识地图:Day 0 到 2 讲岗位、薪资和预算;Day 3 看和走,Day 4 改,Day 5 连接;今天的小项目把 Day 3 到 5 全用上">
<rect x="0" y="0" width="640" height="300" fill="var(--paper-raised)" rx="6"/>
<g font-family="var(--font-mono)" font-size="12">
<text x="20" y="26" fill="var(--ink-faint)">为什么学、学到哪</text>
<rect x="20" y="36" width="180" height="54" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="30" y="58" fill="var(--ink)">Day 0 岗位和学法</text>
<text x="30" y="78" fill="var(--ink-soft)">Agent = 模型 + 工具 + 循环</text>
<rect x="20" y="102" width="180" height="54" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="30" y="124" fill="var(--ink)">Day 1 薪资口径</text>
<text x="30" y="144" fill="var(--ink-soft)">中位数,不看平均数</text>
<rect x="20" y="168" width="180" height="54" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="30" y="190" fill="var(--ink)">Day 2 软件和预算</text>
<text x="30" y="210" fill="var(--ink-soft)">token × 单价 ÷ 百万</text>
<text x="240" y="26" fill="var(--ink-faint)">终端:看 → 改 → 连</text>
<rect x="240" y="36" width="170" height="54" rx="6" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="250" y="58" fill="var(--ink)">Day 3 看和走</text>
<text x="250" y="78" fill="var(--ink-soft)">pwd ls cd 路径</text>
<rect x="240" y="102" width="170" height="54" rx="6" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="250" y="124" fill="var(--ink)">Day 4 改</text>
<text x="250" y="144" fill="var(--ink-soft)">mkdir cp mv rm  * ?</text>
<rect x="240" y="168" width="170" height="54" rx="6" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="250" y="190" fill="var(--ink)">Day 5 连</text>
<text x="250" y="210" fill="var(--ink-soft)">&gt; &gt;&gt; | grep</text>
<line x1="325" y1="90" x2="325" y2="102" stroke="var(--compute)"/>
<line x1="325" y1="156" x2="325" y2="168" stroke="var(--compute)"/>
<line x1="410" y1="129" x2="450" y2="129" stroke="var(--ink-soft)"/>
<polygon points="450,124 460,129 450,134" fill="var(--ink-soft)"/>
<rect x="462" y="80" width="160" height="100" rx="6" fill="var(--paper)" stroke="var(--rule)"/>
<text x="472" y="104" fill="var(--ink)">Day 6 小项目</text>
<text x="472" y="126" fill="var(--ink-soft)">tickets.txt 9 张</text>
<text x="472" y="146" fill="var(--ink-soft)">→ 按类拆 3 个文件</text>
<text x="472" y="166" fill="var(--ink-soft)">→ 一份周报</text>
<line x1="20" y1="244" x2="620" y2="244" stroke="var(--rule)"/>
<text x="20" y="266" fill="var(--ink)">贯穿全周的一件事:命令在「哪个目录」跑,决定了相对路径指向哪</text>
<text x="20" y="286" fill="var(--ink-faint)">Day 7 接着讲:命令名本身(ls、node、python3)又是怎么被找到的</text>
</g>
</svg>
<figcaption>第 1 周知识地图。蓝色三天定方向,琥珀色三天练手;今天的小项目只用右边三块。</figcaption>
</figure>

右边那一列,每一天都建立在前一天上:Day 3 只会看,Day 4 能动手改,但造出来的文件都是空的;Day 5 学会了往文件里写东西、在文字里找东西,终端才第一次能「干活」。今天的小项目就是第一次拿它干一件完整的小活。

## 本周每天一句话

- [Day 0](/blog/agent-zero/day-000-overview/):AI Agent 工程师写的是后端那一侧的程序,让模型决定下一步、调用你写的工具、一轮一轮把事办完;每课三步学法,敲一遍、第二天默写、做练习。
- [Day 1](/blog/agent-zero/day-001-salary-honest/):看薪资先折算口径(月薪 × 薪数),用中位数不用平均数,样本少的结论别信。
- [Day 2](/blog/agent-zero/day-002-setup-budget/):软件用到哪天装哪天;模型按 token 收钱,费用 = token 数 × 单价 ÷ 1,000,000,整门课 API 大概三百到六百元。
- [Day 3](/blog/agent-zero/day-003-terminal-1/):命令分命令名、选项、参数三段;`pwd`、`ls`、`cd`;绝对路径以 `/` 开头,相对路径从当前工作目录出发,`~` 是 shell 替你换成家目录的。
- [Day 4](/blog/agent-zero/day-004-terminal-2/):`mkdir -p`、`touch`、`cp -r`、`mv`、`rm -r`、`rmdir`;覆盖不提示、删除不进废纸篓;通配符由 shell 展开,先 `echo` 预览。
- [Day 5](/blog/agent-zero/day-005-terminal-3/):标准输出和标准错误是两根管子;`>` 覆盖、`>>` 追加、`|` 接下一条命令;`grep` 按字面找行。

## 默写一:从家目录走一圈

这是 Day 3 要求默写的那一段。合上文章,从家目录出发:先不走过去看一眼 `my-app`,再走到 `src`,用相对路径看 `assets` 和隔壁的 `public`,最后退回家目录。写完再对答案。

```text
$ cd ~
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
```

<div class="line-notes">

- `$ cd ~` 先回家目录,保证起点确定。只敲 `cd` 效果一样。
- `/Users/你` `pwd` 打印的是绝对路径。你那边是 `/Users/你的用户名`。
- `$ ls Documents/my-app` 带参数的 `ls` 只看不走,工作目录还在家目录。`Documents/my-app` 不以 `/` 开头,是相对路径。
- `$ cd Documents/my-app/src` 一条 `cd` 走三层。拿不准名字时按 Tab 补全,补得出来说明路径存在。
- `$ ls ./assets` `.` 是当前目录 `src`,所以这是 `src/assets`。
- `$ ls ../public` `..` 退到 `my-app`,再进 `public`。
- `$ cd ../../..` 从 `src` 退三级:`my-app`、`Documents`、家目录。默写时最容易数错的就是这里,数错了就用 `pwd` 看自己到了哪。
- `/Users/你` 回到起点。

</div>

默写的时候我建议你别看 `ls` 的输出,先写命令,再跑,让终端告诉你对不对。输出排成几列跟窗口宽度有关,对不上列数不要紧,对的是名字。

## 默写二:建、复制、改名、批量搬、删

Day 4 的五个命令加通配符,压缩成十来条。这一段在 `~/terminal-practice` 里新建一个 `drill` 目录来做,做完练习 4 会把它整个删掉。

```text
$ cd ~/terminal-practice
$ mkdir -p drill/inbox
$ cd drill
$ touch inbox/a-001.txt inbox/a-002.txt inbox/b-001.md
$ cp -r inbox inbox-copy
$ mv inbox-copy backup
$ mkdir done
$ echo inbox/a-00?.txt
inbox/a-001.txt inbox/a-002.txt
$ mv inbox/a-00?.txt done/
$ ls inbox done backup
backup:
a-001.txt       a-002.txt       b-001.md

done:
a-001.txt       a-002.txt

inbox:
b-001.md
$ rm -r backup
$ ls
done    inbox
```

<div class="line-notes">

- `$ cd ~/terminal-practice` 每一段开头先站到一个确定的地方,这是防删错的第一道保险。
- `$ mkdir -p drill/inbox` 两层一起建。没有 `-p` 会报 `No such file or directory`,因为 `drill` 还不存在。
- `$ touch inbox/a-001.txt inbox/a-002.txt inbox/b-001.md` 一次建三个空文件,两个 `a-` 开头的 `.txt`,一个 `.md`。
- `$ cp -r inbox inbox-copy` 复制目录要 `-r`,不加报 `inbox is a directory (not copied).`。
- `$ mv inbox-copy backup` `backup` 不存在,所以这是改名。`mv` 动目录不需要 `-r`。
- `$ echo inbox/a-00?.txt` 动手之前先预览:`?` 正好一个字符,匹配到两个,`b-001.md` 不在里面。
- `$ mv inbox/a-00?.txt done/` 预览没问题,把 `echo` 换成 `mv`,最后一个参数是目标目录,末尾的 `/` 明确说「这是目录」。
- `backup:` `ls` 接三个目录参数,按名字排序,每个目录先打印「名字:」再列内容。`backup` 里是复制时的三个文件,复制之后 `inbox` 里怎么搬都不影响它。
- `inbox:` 原来的 `inbox` 只剩 `b-001.md`。
- `$ rm -r backup` 删备份。回车前看一眼:是 `backup`,不是 `inbox`。
- `done    inbox` 剩两个目录。

</div>

这十几条里有三个地方是 Day 4 专门提醒过的坑:`cp` 目录忘了 `-r`、通配符不先 `echo`、`rm -r` 删错名字。默写时这三处写对了,Day 4 就算过关了。

## 默写三:计费工单小报告

Day 5 的收尾那段。这次报告写进 `drill/report.txt`,不去碰 Day 5 留下的 `report.txt`。

```text
$ cd ~/terminal-practice
$ echo "计费工单数:" > drill/report.txt
$ grep -c 计费 tickets.txt >> drill/report.txt
$ echo "明细:" >> drill/report.txt
$ grep -n 计费 tickets.txt >> drill/report.txt
$ cat drill/report.txt
计费工单数:
5
明细:
1:T001 计费 C023 10月3日和10月5日各扣了一次299元,被扣了两次
3:T003 计费 C015 想把月付改成年付,差价怎么算
6:T006 计费 C007 Refund request for duplicate charge
8:T008 计费 C042 发票金额和订单金额对不上
9:T009 计费 C031 续费后发票没有发到邮箱
```

<div class="line-notes">

- `$ echo "计费工单数:" > drill/report.txt` 第一行用一个箭头 `>`,从空文件开始。路径 `drill/report.txt` 是相对 `~/terminal-practice` 的。
- `$ grep -c 计费 tickets.txt >> drill/report.txt` `-c` 只打印个数,两个箭头追加进去。
- `$ grep -n 计费 tickets.txt >> drill/report.txt` `-n` 带行号的明细,也是追加。
- `5` 和 Day 5 正文那份不一样:那时只有 8 张工单、4 张计费;练习 3 追加了 T009,现在是 5 张。
- `9:T009 计费 C031 续费后发票没有发到邮箱` 第 9 行就是练习 3 追加的那张。

</div>

如果你写出来的数是 4,说明你的 `tickets.txt` 停在了 8 行,回 Day 5 练习 3 补上 T009 这一行(用 `>>`!)。

## 小项目:给 9 张工单出一份周报

假设你是云簿 CloudLedger 的客服组长,周五下班前要交一份本周工单情况。要求两样东西:

1. 一个 `weekly/by-type/` 目录,里面按类别拆成三个文件:`billing.txt`(计费)、`login.txt`(登录)、`feature.txt`(功能),每个文件里是这一类的原始工单行。
2. 一份 `weekly/report.txt`,写清工单总数、三类各几张、计费占比、哪几张「疑似重复扣款」要优先处理、有几张提到了发票。

只准用本周学过的东西。先别往下看,自己想想每一项用哪条命令。

### 第一步:按类别拆文件

我第一条命令就写错了,而且是一个很典型的错:

```text
$ cd ~/terminal-practice
$ grep 计费 tickets.txt > weekly/by-type/billing.txt
zsh: no such file or directory: weekly/by-type/billing.txt
$ mkdir -p weekly/by-type
$ grep 计费 tickets.txt > weekly/by-type/billing.txt
$ grep 登录 tickets.txt > weekly/by-type/login.txt
$ grep 功能 tickets.txt > weekly/by-type/feature.txt
$ wc -l weekly/by-type/*
       5 weekly/by-type/billing.txt
       2 weekly/by-type/feature.txt
       2 weekly/by-type/login.txt
       9 total
```

<div class="line-notes">

- `$ grep 计费 tickets.txt > weekly/by-type/billing.txt` 目录还没建,就想往里面写文件。
- `zsh: no such file or directory: weekly/by-type/billing.txt` 报错的是 `zsh`,不是 `grep`。处理 `>` 是 shell 的活,它要先打开目标文件,`>` 只会新建文件,不会替你建目录,打不开就直接报错,`grep` 根本没启动。Day 5 练习 4 里那个「先清空再启动命令」的顺序,这里又出现了一次。
- `$ mkdir -p weekly/by-type` 先把两层目录建出来。
- `$ grep 计费 tickets.txt > weekly/by-type/billing.txt` 再写就成功了,成功时什么都不打印。
- `$ grep 登录 tickets.txt > weekly/by-type/login.txt` 登录类和功能类同理,每个文件用一个 `>`,因为每个都是新文件。
- `$ wc -l weekly/by-type/*` 通配符展开成三个文件名,`wc -l` 一次数三个。
- `       9 total` 给好几个文件时,`wc` 会在最后多打一行合计。5 + 2 + 2 = 9,和 `tickets.txt` 的行数对得上,说明三类分得不重不漏。这一行用来对账正合适。

</div>

「拆完了再加起来对一遍账」这个习惯值得留下来。后面用 Python 分类、用大模型分类时也一样:分完先看总数对不对,对不上就说明有工单被分进了两类,或者哪类都没进。

### 第二步:算总数和占比

总数要一个干净的数字,不要后面跟着文件名。Day 5 讲过 `wc` 从管道读时不知道文件叫什么,正好用上。占比要算除法,终端里没学过怎么算,但 Day 3 学过 `node -e` 直接跑一行 JS:

```text
$ cat tickets.txt | wc -l
       9
$ node -e "console.log((5 / 9 * 100).toFixed(1) + '%')"
55.6%
```

<div class="line-notes">

- `$ cat tickets.txt | wc -l` `cat` 把文件内容送进管道,`wc -l` 从标准输入数行,所以输出只有数字,没有 `tickets.txt` 这个名字。前面那串空格是 macOS 上 `wc` 的对齐格式,去不掉,今天不管它。
- `$ node -e "console.log((5 / 9 * 100).toFixed(1) + '%')"` 一行 JS:5 张计费除以 9 张总数,乘 100,`toFixed(1)` 保留一位小数,再拼上百分号。外面用双引号包住整段 JS,里面的字符串就用单引号,不然 shell 会把引号配错对。
- `55.6%` 5 ÷ 9 = 0.5555…,四舍五入到一位小数是 55.6。

</div>

这里的 5 和 9 是我手抄上去的,换一批工单就得改代码。能不能让程序自己读文件、自己数、自己除?能,但那是 Python 的活,第一部分后面的「工单分类器」小项目就做这件事。今天手抄是诚实的做法:知道哪一步是人在做。

### 第三步:拼周报

把所有零件按顺序写进 `weekly/report.txt`。第一行 `>`,后面全部 `>>`:

```text
$ echo "== 云簿 CloudLedger 工单周报 ==" > weekly/report.txt
$ echo "工单总数:" >> weekly/report.txt
$ cat tickets.txt | wc -l >> weekly/report.txt
$ echo "计费 / 登录 / 功能:" >> weekly/report.txt
$ grep -c 计费 tickets.txt >> weekly/report.txt
$ grep -c 登录 tickets.txt >> weekly/report.txt
$ grep -c 功能 tickets.txt >> weekly/report.txt
$ echo "计费占比:" >> weekly/report.txt
$ node -e "console.log((5 / 9 * 100).toFixed(1) + '%')" >> weekly/report.txt
$ echo "疑似重复扣款(优先处理):" >> weekly/report.txt
$ grep 扣了两次 tickets.txt >> weekly/report.txt
$ grep -i duplicate tickets.txt >> weekly/report.txt
$ echo "提到发票的工单:" >> weekly/report.txt
$ grep -c 发票 tickets.txt >> weekly/report.txt
$ cat weekly/report.txt
== 云簿 CloudLedger 工单周报 ==
工单总数:
       9
计费 / 登录 / 功能:
5
2
2
计费占比:
55.6%
疑似重复扣款(优先处理):
T001 计费 C023 10月3日和10月5日各扣了一次299元,被扣了两次
T006 计费 C007 Refund request for duplicate charge
提到发票的工单:
4
$ wc -l weekly/report.txt
      14 weekly/report.txt
```

<div class="line-notes">

- `$ echo "== 云簿 CloudLedger 工单周报 ==" > weekly/report.txt` 唯一一个单箭头。不管这个文件以前有没有,都从空白开始,这样重跑一遍也不会把上次的内容叠上去。
- `$ cat tickets.txt | wc -l >> weekly/report.txt` 管道和重定向可以写在同一条里:`cat` 的输出进管道给 `wc`,`wc` 的输出再追加进文件。从左往右读就行。
- `$ grep -c 计费 tickets.txt >> weekly/report.txt` 三类各数一次。
- `$ node -e "console.log((5 / 9 * 100).toFixed(1) + '%')" >> weekly/report.txt` Node 的 `console.log` 走的也是标准输出,一样能重定向。终端不在乎输出是哪个程序打出来的。
- `$ grep 扣了两次 tickets.txt >> weekly/report.txt` 中文工单里写「扣了两次」的。
- `$ grep -i duplicate tickets.txt >> weekly/report.txt` 英文工单写的是 Duplicate 还是 duplicate 说不准,加 `-i`。这两条加起来,就是 Day 5 里 `grep 退款` 一张都没搜到的那两张工单:同一个意思,三种写法,我得一个个猜关键词。
- `$ grep -c 发票 tickets.txt >> weekly/report.txt` T004、T007、T008、T009 四张。注意它跨了两个类别,有功能类也有计费类。
- `       9` 这一行前面有空格,因为 `wc` 的格式就是这样。周报里看着不整齐,但数字是对的。
- `      14 weekly/report.txt` 14 行:5 行小标题加一行大标题,8 行数据。

</div>

| 本周的零件 | 在小项目里是哪一步 |
| --- | --- |
| `cd`、相对路径(Day 3) | 每条命令里的 `weekly/...`、`tickets.txt` 都相对 `~/terminal-practice` |
| `mkdir -p`(Day 4) | 第一步建 `weekly/by-type` |
| 通配符 `*`(Day 4) | `wc -l weekly/by-type/*` |
| `>` 覆盖、`>>` 追加(Day 5) | 拆文件用 `>`,拼周报第一行 `>`、其余 `>>` |
| `\|` 管道(Day 5) | `cat tickets.txt \| wc -l` |
| `grep -c`、`grep -i`(Day 5) | 各类计数、找 duplicate |
| `node -e`(Day 3) | 算计费占比 |
| 预算算式的思路(Day 2) | 占比也是「数量 ÷ 总量」,手抄的数要写清楚从哪来 |

做完以后回头看,这份周报最不靠谱的是「疑似重复扣款」那一节:它完全靠我猜对关键词。如果下周来一张「同一笔钱收了我两回」,两条 `grep` 都抓不到。这正是 Day 0 讲的那个场景里让大模型读工单的原因,也是 Day 5 说第四部分 RAG 要解决的问题。今天你先记住这个痛点,到时候会更明白那些技术在解决什么。

## 本周错题与坑清单

把这一周真实见过的报错和坑放在一张表里。左边一列是你会在屏幕上看到的原文,看到它就来这张表里查。

| 你看到的 | 病因 | 改法 | 出处 |
| --- | --- | --- | --- |
| `ls: nothere: No such file or directory` | 路径不存在,多半是拼错或站错目录 | `pwd` 看自己在哪,用 Tab 补全 | Day 3 |
| `Error: ENOENT: no such file or directory, open 'package.json'` | Node 的相对路径相对的是运行时的工作目录 | 回到对的目录再跑,或用绝对路径 | Day 3 |
| `cd: string not in pwd: ...` | 路径里有空格,被切成了两个参数 | 加引号或 `\ `,或者别给文件夹起带空格的名字 | Day 3 |
| `cd: not a directory: ...` | 想 `cd` 进一个文件 | `cd` 只能进目录 | Day 3 |
| `mkdir: projects/demo: No such file or directory` | 上层目录不存在 | `mkdir -p` | Day 4 |
| `cp: projects is a directory (not copied).` | 复制目录没加 `-r` | `cp -r` | Day 4 |
| 文件被一声不响地覆盖 | `cp`、`mv` 目标已存在时直接覆盖 | 重要文件加 `-i`,或先 `ls` 看目标 | Day 4 |
| `rm` 删的文件找不回 | 不进废纸篓 | 先 `echo` 预览,想留后路就 `mv` 到 `~/.Trash/` | Day 4 |
| `zsh: no matches found: ...` | 通配符一个都没匹配到,或网址里的 `?` 被当成通配符 | 检查模式;网址加双引号 | Day 4 |
| `mv: rename invoices to invoices/invoices: Invalid argument` | 通配符写太宽,把目标目录自己也匹配进去了 | 模式带上分隔符和扩展名,如 `invoice-*.pdf` | Day 4 |
| 报错没进文件 | `>` 只改道标准输出 | 报错用 `2>` | Day 5 |
| 文件变成 0 字节 | `>` 的目标正是这条命令在读的文件 | 先写新文件,再 `mv` 回去 | Day 5 |
| `grep: 两次: No such file or directory` | 模式里有空格没加引号,后半截被当成文件名 | 给模式加引号 | Day 5 |
| `grep` 什么都不打印 | 确实没有匹配的行,或者大小写不对 | 英文加 `-i` | Day 5 |
| `zsh: no such file or directory: weekly/by-type/billing.txt` | `>` 的目标目录不存在,shell 不会替你建目录 | 先 `mkdir -p` | Day 6 |
| `[80, 100, 9].sort()` 得到 `[ 100, 80, 9 ]` | JS 默认按字符串排序 | 传比较函数 `(a, b) => a - b` | Day 1 |
| 一次调用算出 1728 元 | 单价是「每百万 token」,忘了除以 1,000,000 | 抄单价时连单位一起抄 | Day 2 |

这张表建议你抄一份到自己的笔记里,以后每周往下加。等到第三部分开始调模型、写 Agent,报错会多到你记不住,有一张自己整理的表,比每次去搜好用得多。

## 动手练习

### 练习 1:站在深处,用两种路径看 public

先 `cd` 到 `~/terminal-practice/drill/done`(默写二建的目录),不再 `cd`,分别用一条相对路径和一条 `~` 写法的 `ls`,列出 `my-app` 里的 `public`。最后用 `pwd` 证明你没动。

<details><summary>参考答案</summary>

```text
$ cd ~/terminal-practice/drill/done
$ ls ../../../Documents/my-app/public
favicon.svg     icons.svg
$ ls ~/Documents/my-app/public
favicon.svg     icons.svg
$ pwd
/Users/你/terminal-practice/drill/done
```

<div class="line-notes">

- `$ cd ~/terminal-practice/drill/done` 站到第三层:家目录 → `terminal-practice` → `drill` → `done`。
- `$ ls ../../../Documents/my-app/public` 退三级到家目录,再往下走。数 `..` 的办法:从 `done` 到家目录中间隔着 `done`、`drill`、`terminal-practice` 三层,所以是三个 `..`。
- `$ ls ~/Documents/my-app/public` `~` 写法不管站在哪都一样,也好读得多。实际干活我用这种。
- `/Users/你/terminal-practice/drill/done` `ls` 只看不走。

</div>

</details>

### 练习 2:哪些客户提了不止一张工单

用 `grep -c` 数出 C023、C007、C015、C031、C042 每个客户各有几张工单;再找出 C031 的两张分别是什么,用管道数出其中计费类有几张。

<details><summary>参考答案</summary>

```text
$ cd ~/terminal-practice
$ grep -c C023 tickets.txt
2
$ grep -c C007 tickets.txt
2
$ grep -c C015 tickets.txt
2
$ grep -c C031 tickets.txt
2
$ grep -c C042 tickets.txt
1
$ grep C031 tickets.txt
T005 登录 C031 Forgot password email never arrived
T009 计费 C031 续费后发票没有发到邮箱
$ grep 计费 tickets.txt | grep -c C031
1
```

<div class="line-notes">

- `$ grep -c C023 tickets.txt` 一个客户一条命令。结果是 C023、C007、C015、C031 各 2 张,C042 只有 1 张,加起来 2 × 4 + 1 = 9,又对上了总数。
- `$ grep C031 tickets.txt` C031 的两张:一张登录(英文写的忘记密码邮件没收到),一张计费(续费后发票没收到)。两张都是「邮件没到」,客服看到这种组合会去查这个客户的邮箱地址是不是填错了。这是关键词统计看不出来、要人读内容才能发现的东西。
- `$ grep 计费 tickets.txt | grep -c C031` 两层过滤相当于「并且」,最后一个用 `-c` 数。

</div>

五个客户要敲五条命令,有点笨。终端里其实有一次数完所有客户的办法(要用到 `sort` 和 `uniq`),本周没学,不用。到 Python 那几天,你会用一个字典几行搞定。

</details>

### 练习 3:先猜,再跑

下面五条命令每条都有问题。先在纸上写下你认为会看到什么,再到 `~/terminal-practice` 里实际跑。为了不弄坏 `tickets.txt`,先复制一份 `try.txt`,前三条都对 `try.txt` 做。

1. `grep 扣了 两次 try.txt`
2. `grep refund try.txt`
3. `echo "T010 登录 C042 换了手机号登不上" > try.txt`,然后 `cat try.txt`
4. `rm weekly/by-type`
5. `ls weekly/*.pdf`

<details><summary>参考答案</summary>

```text
$ cd ~/terminal-practice
$ cp tickets.txt try.txt
$ grep 扣了 两次 try.txt
grep: 两次: No such file or directory
try.txt:T001 计费 C023 10月3日和10月5日各扣了一次299元,被扣了两次
$ grep refund try.txt
$ echo "T010 登录 C042 换了手机号登不上" > try.txt
$ cat try.txt
T010 登录 C042 换了手机号登不上
$ rm weekly/by-type
rm: weekly/by-type: is a directory
$ ls weekly/*.pdf
zsh: no matches found: weekly/*.pdf
$ rm try.txt
```

<div class="line-notes">

- `$ cp tickets.txt try.txt` 拿副本折腾,Day 5 练习 4 的老规矩。
- `grep: 两次: No such file or directory` 没加引号,`两次` 被当成了要搜的文件。
- `try.txt:T001 计费 C023` 它在 `try.txt` 里搜「扣了」倒是搜到了,而且因为参数里有两个「文件」,每行前面带上了文件名。
- `$ grep refund try.txt` 没有任何输出。文件里是大写开头的 `Refund`,要加 `-i`。
- `$ echo "T010 登录 C042 换了手机号登不上" > try.txt` 本意是加一张工单,用了单箭头。
- `T010 登录 C042 换了手机号登不上` 9 张工单全没了,只剩新加的这一行。幸好是副本。
- `rm: weekly/by-type: is a directory` `rm` 不加 `-r` 不删目录。这是好事:它拦了你一下。
- `zsh: no matches found: weekly/*.pdf` `weekly` 里没有 PDF,zsh 匹配不到直接报错,`ls` 根本没运行。
- `$ rm try.txt` 清理掉副本。

</div>

五条里你猜对了几条?第 3 条要是没猜对,说明 `>` 和 `>>` 还没变成肌肉记忆,今天睡前再把 Day 5 的重定向那一节敲一遍。

</details>

### 练习 4:归档旧报告,收拾练习目录

把 Day 5 留下的 `report.txt` 和 `others.txt` 挪进 `weekly/old/`,确认 `terminal-practice` 根目录干净了;然后安全地删掉默写时建的 `drill` 目录。

<details><summary>参考答案</summary>

```text
$ cd ~/terminal-practice
$ ls *.txt
hello.txt       others.txt      report.txt      tickets.txt
$ mkdir -p weekly/old
$ mv report.txt others.txt weekly/old/
$ ls
archive         hello.txt       notes           tickets         weekly
drill           inbox           projects        tickets.txt
$ ls weekly weekly/old
weekly:
by-type         old             report.txt

weekly/old:
others.txt      report.txt
$ echo drill/*
drill/done drill/inbox drill/report.txt
$ rm -r drill
$ ls
archive         inbox           projects        tickets.txt
hello.txt       notes           tickets         weekly
```

<div class="line-notes">

- `$ ls *.txt` 先看根目录有哪些 `.txt`。四个里只有 `report.txt` 和 `others.txt` 要搬,所以这里**不能**用 `mv *.txt`,那会把 `tickets.txt` 也搬走。
- `$ mkdir -p weekly/old` 有 `-p`,`weekly` 已经在了也不报错。
- `$ mv report.txt others.txt weekly/old/` 两个源、一个目标目录。名字写全,不用通配符。
- `weekly:` `weekly` 里有 `by-type`、`old` 两个目录和这周的 `report.txt`。
- `weekly/old:` 旧报告进了 `old`。两个目录里都有叫 `report.txt` 的文件,它们在不同目录,互不影响,这就是为什么归档要放进子目录,而不是挪到同一层。
- `$ echo drill/*` `rm -r` 之前看一眼里面有什么:两个目录和默写三的报告,都是可以扔的。
- `$ rm -r drill` 删掉。
- `archive         inbox           projects        tickets.txt` 根目录只剩 Day 4 的几个目录、`hello.txt`、工单清单和 `weekly`。

</div>

</details>

验收标准:三段默写不看文章能写出来,结果和文中一致(计费是 5 张);小项目的 `weekly/by-type/` 三个文件加起来 9 行,`weekly/report.txt` 是 14 行;错题表里每一句报错,能不看右边几列说出病因。

## 名词解释

今天没有新命令,只有两个学习方法上的词,外加本周几个最容易混的词放在一起对比一遍。

| 名词 | 意思 |
| --- | --- |
| 知识地图 | 把一周学的东西画成一张图,看清哪天依赖哪天。每个复习日都从一张知识地图开始 |
| 默写 | 合上文章,凭记忆把核心代码或命令写出来再跑。写不出来的地方就是没真懂的地方 |
| 对账 | 拆分或统计以后,把各部分加起来和总数比一遍,对不上就说明有遗漏或重复。如 `wc -l` 的 `total` 行 |
| `>` 和 `>>` | 覆盖写入和追加写入([Day 5](/blog/agent-zero/day-005-terminal-3/)) |
| 绝对路径和相对路径 | 以 `/` 开头、在哪都一样,和从当前工作目录出发([Day 3](/blog/agent-zero/day-003-terminal-1/)) |
| 通配符和 `grep` 模式 | 通配符 `*`、`?` 匹配**文件名**,由 shell 展开([Day 4](/blog/agent-zero/day-004-terminal-2/));`grep` 的模式匹配**文件内容里的行**,由 `grep` 自己处理([Day 5](/blog/agent-zero/day-005-terminal-3/)) |

最后一行是这周最容易混的一对。`ls *.txt` 里的 `*` 是 shell 在找文件名;`grep 计费 tickets.txt` 里的「计费」是 `grep` 在文件里找行。一个看名字,一个看内容。

## 常见误区

**复习日只看不敲。** 复习日最省事的过法是把文章扫一遍,觉得「都会」。默写一下就知道:`cd ../../..` 到底几个点点、`mkdir` 要不要 `-p`、第一行是 `>` 还是 `>>`,看的时候都觉得显然,合上文章写的时候才会犹豫。不敲出来,你不会知道自己哪里只是眼熟。

**往一个不存在的目录里重定向。** `grep 计费 tickets.txt > weekly/by-type/billing.txt` 报 `zsh: no such file or directory`。`>` 只建文件,不建目录。养成习惯:写文件之前先 `mkdir -p` 它所在的目录。

**拆完不对账。** 小项目里 `wc -l weekly/by-type/*` 的 `9 total` 和总数一致,才说明三类不重不漏。如果某张工单写的是「计费登录都有问题」,它会同时进两个文件,合计就会变成 10。

**用通配符批量搬时把不该搬的也带上。** 练习 4 里根目录有四个 `.txt`,只搬两个。这种时候名字一个个写全,比想一个聪明的通配符可靠。

**把手抄的数字当成算出来的。** 周报里的 `55.6%` 是我把 5 和 9 手抄进 `node -e` 算的,`tickets.txt` 一变它就错了,而且不会报错。手抄的数要在旁边写清楚是从哪条命令的结果抄来的。

**以为关键词统计就是分类。** 「疑似重复扣款」那节靠两个关键词,第三种说法就漏了。关键词能做粗筛,不能当结论,Day 0 拿关键词判断 JD 时也是同一个教训。

## 学习资料

### 文档与文章

- [计算机教育中缺失的一课 · 课程概览与 shell](https://missing-semester-cn.github.io/2020/course-shell/):中文,Day 3 读过前半段。今天把整篇从头到尾读一遍,对照本周的三课,看看还有哪几段没读懂,圈出来。
- [MDN 命令行速成课](https://developer.mozilla.org/zh-CN/docs/Learn_web_development/Getting_started/Environment_setup/Command_line):中文,这周分三天读完了。今天只看文末那几道小练习,自己在 `~/terminal-practice` 里做一遍。
- [网道 · Bash 简介](https://wangdoc.com/bash/intro):中文,Day 3 读过。今天顺着目录往后读「基本语法」一章里讲 `echo`、引号、分号的几节,和本周踩过的引号坑对照着看。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1AGp26cEDP&autoplay=0&high_quality=1" title="小白也能听懂的20条Linux常用命令,从零开始手把手教你学会" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>IT课程学长 · 小白也能听懂的20条Linux常用命令,从零开始手把手教你学会 · 共 20 P,每 P 三到五分钟。今天只看本周学过的几个当复习:P1 cat、P2 cd、P3 cp、P7 grep、P10 ls、P11 mkdir、P12 mv、P14 rm、P17 tail。在 Linux 服务器上演示,和 macOS 用法基本一样;其余讲网络、磁盘、远程登录的以后再说。</figcaption>
</figure>

另外 [程序员良许 · 速学150个Linux常用命令](https://www.bilibili.com/video/BV12L411a7Ne)(150 P,播放 35 万)可以收藏当字典:以后遇到一个没见过的命令,在分 P 列表里搜一下名字,看那一集几分钟就够了。

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/ogWoUU2DXBU" title="macOS Terminal (zsh) - The Beginners' Guide" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Academind · macOS Terminal (zsh) - The Beginners' Guide · 英文,可开自动字幕。Academind 是做前端课程很有名的频道,这期专讲 macOS 上的 zsh,从打开终端讲到文件操作。今天用它把这周的内容快速过一遍,听到没学过的地方(比如后半段的配置)先跳过,明天 Day 7 正好讲。</figcaption>
</figure>

### 书籍

- William Shotts《The Linux Command Line》第 2 版,No Starch Press,2019,作者在 [linuxcommand.org](https://linuxcommand.org/) 免费提供英文 PDF,第 1 版有[社区中文翻译](https://billie66.github.io/TLCL/)。这周三课对应第 2、3、4、6 章(导航、探索系统、操作文件和目录、重定向)。复习日适合把这几章的章末小结读一遍,书里的例子和这里不同,换个场景再看一遍印象更深。

### 开源项目与代码

- [tldr-pages/tldr](https://github.com/tldr-pages/tldr):每个命令一页常用写法。今天挑本周学过的 `ls`、`cp`、`mv`、`rm`、`grep`,在仓库 `pages.zh/common/` 里读中文页,看有没有你没见过的用法。
- [idank/explainshell](https://github.com/idank/explainshell):把一条命令贴进 [explainshell.com](https://explainshell.com/),它会把每一段对应的手册说明标出来。把小项目里的 `cat tickets.txt | wc -l >> weekly/report.txt` 贴进去试试,看它怎么拆。

## 自测

1. 默写二里,为什么 `rm -r backup` 之后,`done` 里的 `a-001.txt` 还在?

<details><summary>答案</summary>

`backup` 是 `cp -r` 复制出来的,里面的文件是独立的副本,和 `inbox`、`done` 里的文件没有关系。删掉 `backup` 只删副本。反过来,如果当初用的是 `mv inbox backup`,那就没有副本,只有一份,删了就真没了。

</details>

2. `grep 计费 tickets.txt > weekly/by-type/billing.txt` 报 `zsh: no such file or directory`,报错的为什么是 zsh 而不是 grep?

<details><summary>答案</summary>

`>` 是 shell 处理的。shell 要先打开(或新建)目标文件,再启动 `grep`;目标所在的目录 `weekly/by-type` 不存在,文件建不出来,shell 直接报错,`grep` 根本没有运行。修法是先 `mkdir -p weekly/by-type`。

</details>

3. 为什么周报里的总数要写成 `cat tickets.txt | wc -l`,而不是 `wc -l tickets.txt`?

<details><summary>答案</summary>

`wc -l tickets.txt` 会在数字后面带上文件名,写进周报就成了 `9 tickets.txt`。从管道读的时候 `wc` 不知道文件名,只输出数字。

</details>

4. `ls *.txt` 和 `grep txt tickets.txt` 里,`*.txt` 和 `txt` 分别是谁在处理、匹配的是什么?

<details><summary>答案</summary>

`*.txt` 是通配符,由 shell 在命令运行前展开,匹配的是当前目录里的文件名。`grep` 的 `txt` 是 `grep` 自己的模式,匹配的是 `tickets.txt` 这个文件内容里的每一行,和文件名无关。

</details>

5. 面试题:你写了一个脚本把工单分成三类,分别存进三个文件。你怎么快速确认没有工单被漏掉或者分进了两类?

<details><summary>答案</summary>

对账:三个文件的行数加起来应该等于原始工单数。用 `wc -l` 一次数三个文件,看 `total` 行和 `wc -l 原始文件` 是否相等。大于说明有工单进了多个类,小于说明有工单哪类都没进。相等也不能百分之百保证(可能一个多一个少刚好抵消),要更严格就逐张核对工单号,后面学了 Python 可以用集合来比。

</details>

## 明天预告

Day 7 · 终端(四):PATH、which 和 shell 配置文件。这周你敲了几十条 `ls`、`grep`、`node`,有没有想过:你只写了一个名字 `node`,终端是去哪个目录找到这个程序的?明天讲 PATH 这个环境变量和 `which` 命令,弄明白「装了新版 Node,`node -v` 还是旧的」「`vite` 在 `npm run dev` 里能用、直接敲却 `command not found`」是怎么回事,再打开 `~/.zshrc`,学会安全地改它。下一周就要装 Python 了,装完能不能敲得出 `python3`,靠的就是明天这一课。
