---
title: 'Day 228 · Postgres 入门:装 Postgres.app、psql 和建库'
description: 'numpy 文件当索引已经到头了,接下来要换成数据库。今天先不碰向量,只把 Postgres 装起来:它和 Day 85 的 SQLite 最大的不同是「一个一直在跑的服务」,你的程序是连上去的客户端。用 Postgres.app 装好、createdb 建库、psql 里建表查数,再用 psycopg 从 Python 连上去,顺手踩三个坑:占位符写成 ?、连错端口、忘了提交。'
pubDate: 2026-10-22
regime: none
tags: ['postgres', 'psql', 'psycopg', 'database', 'agent-zero']
series: 'agent-zero'
day: 228
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 227](/blog/agent-zero/day-227-rag-prompt/) 把 RAG 的 `SYSTEM` 补成了六句,用 10 道题的拒答测试证明每句有没有用,最后算了一笔账:资料只有几万 token 时,全塞进 prompt 加缓存比 RAG 还省事。

但我们的索引一直是两个文件:`index/vectors.npy` 和 `index/chunks.json`。[Day 225](/blog/agent-zero/day-225-numpy-index/) 已经看到它的软肋,两个文件靠下标对齐,只重建一个就会安静地取错块。再往后还有几件它做不到的事:改了一篇文章只想更新那几块、只在「退款」类里找、几台服务器同时读同一份索引、和客户表放在一起查。这些事数据库早就解决了。所以接下来几天换成 Postgres 加 pgvector。今天先只装 Postgres、学会建库和连上去,向量的事明天再说。

## 今天要解决的问题

学完今天,你应该能做到:

1. 说清 Postgres 和 [Day 85](/blog/agent-zero/day-085-sql-1/) 学的 SQLite 最根本的区别:SQLite 是你程序里打开的一个文件,Postgres 是一个一直在跑、监听 5432 端口的服务,你的程序是连上去的客户端。能用 `lsof` 和 `ps` 亲眼看到这个服务。
2. 装好 Postgres.app,把命令行工具加进 PATH,会用 `createdb` / `dropdb` 建库删库,会在 `psql` 里建表、插数据、查数据,认得 `\l`、`\dt`、`\d 表名`、`\q` 这几个反斜杠命令。
3. 用 `psycopg` 从 Python 连上 Postgres,知道它和 `sqlite3` 写法上的三处不同:占位符是 `%s` 不是 `?`,`with psycopg.connect()` 退出时自动提交,`numeric` 列读出来是 `Decimal`。
4. 遇到「连不上」「库不存在」「类型不对」这几种报错,能看懂原文并知道去哪查。

预计用时 2.5 小时:装软件和看服务 40 分钟,psql 建库建表 40 分钟,Python 连上和三个坑 40 分钟,剩下做练习。前置:[Day 7](/blog/agent-zero/day-007-terminal-4/) 的 PATH 和 `.zshrc`,[Day 53](/blog/agent-zero/day-053-env-secrets/) 的 `.env` 和 `load_dotenv`,[Day 77](/blog/agent-zero/day-077-server-1/) 的进程、端口和 `lsof`,[Day 85](/blog/agent-zero/day-085-sql-1/) 到 [Day 91](/blog/agent-zero/day-091-sql-6/) 的 SQL,[Day 92](/blog/agent-zero/day-092-python-sqlite-1/)、[Day 93](/blog/agent-zero/day-093-python-sqlite-2/) 的 Python 操作 SQLite(参数化、commit)。

今天不调任何模型接口,API 花费 0 元。要下载的只有 Postgres.app 一个安装包,约 114 MB。

学法:先对照文章逐行敲一遍(不复制粘贴)并跑通;第二天合上文章,默写建库、建表那几条命令和 `pg_hello.py`;做练习,做不出再展开参考答案,看完关掉自己重写一遍。

## SQLite 是文件,Postgres 是服务

先把最大的那个区别讲透,后面所有操作都是从它来的。

[Day 92](/blog/agent-zero/day-092-python-sqlite-1/) 用 SQLite 时,你写的是 `sqlite3.connect("billing.db")`。这一行做的事情其实是「打开一个文件」:SQLite 的整个数据库引擎就是一个函数库,被装进了你的 Python 进程里,读写都直接操作磁盘上那个 `.db` 文件。程序不跑,数据库也就不存在「运行中」这回事,它只是一个文件。

Postgres 不一样。它是一个**数据库服务器**:装好以后有一个叫 `postgres` 的进程一直在后台运行,监听 5432 端口,数据文件由它一个人管。你的 Python 程序、命令行工具 `psql`、图形界面客户端,统统是**客户端**,通过网络连接(本机时走一个叫 Unix socket 的本地通道)把 SQL 发给它,它执行完再把结果发回来。

用前端的话说:SQLite 像 `localStorage`,数据就在你自己这边,读写是一个函数调用;Postgres 像你在 DevTools Network 面板里看到的那个 API 服务器,你 `fetch` 过去,它处理完返回 JSON。[Day 77](/blog/agent-zero/day-077-server-1/) 讲过的「进程」「端口」「localhost」,今天全部用得上。

<figure>
<svg viewBox="0 0 640 300" role="img" aria-label="左边 SQLite:Python 进程里直接装着数据库引擎,读写一个文件;右边 Postgres:psql 和 Python 两个客户端通过 5432 端口连到同一个 postgres 服务进程,服务进程管数据目录">
<rect x="0" y="0" width="640" height="300" fill="var(--paper-raised)"/>
<g font-family="var(--font-mono)" font-size="12">
<text x="20" y="24" fill="var(--ink)">SQLite:库在你的进程里</text>
<rect x="20" y="40" width="250" height="120" rx="6" fill="none" stroke="var(--ink-soft)"/>
<text x="32" y="60" fill="var(--ink-soft)" font-size="11">python 进程</text>
<rect x="36" y="72" width="100" height="40" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="46" y="96" fill="var(--ink)">你的代码</text>
<rect x="150" y="72" width="106" height="40" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="158" y="96" fill="var(--ink)">sqlite 引擎</text>
<line x1="136" y1="92" x2="150" y2="92" stroke="var(--ink-faint)"/>
<rect x="150" y="196" width="106" height="40" rx="4" fill="none" stroke="var(--ink-soft)"/>
<text x="160" y="220" fill="var(--ink)">billing.db</text>
<line x1="203" y1="112" x2="203" y2="196" stroke="var(--ink-faint)" marker-end="url(#m228)"/>
<text x="20" y="270" fill="var(--ink-soft)" font-size="11">程序不跑,数据库就只是个文件</text>
<text x="330" y="24" fill="var(--ink)">Postgres:库是一个服务</text>
<rect x="330" y="40" width="110" height="40" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="345" y="64" fill="var(--ink)">psql</text>
<rect x="330" y="96" width="110" height="40" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="345" y="120" fill="var(--ink)">python</text>
<rect x="490" y="56" width="130" height="64" rx="6" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="502" y="80" fill="var(--ink)">postgres 服务</text>
<text x="502" y="100" fill="var(--ink-soft)" font-size="11">监听 :5432</text>
<line x1="440" y1="60" x2="490" y2="78" stroke="var(--ink-faint)" marker-end="url(#m228)"/>
<line x1="440" y1="116" x2="490" y2="100" stroke="var(--ink-faint)" marker-end="url(#m228)"/>
<rect x="490" y="196" width="130" height="40" rx="4" fill="none" stroke="var(--ink-soft)"/>
<text x="502" y="220" fill="var(--ink)">var-17/ 数据目录</text>
<line x1="555" y1="120" x2="555" y2="196" stroke="var(--ink-faint)" marker-end="url(#m228)"/>
<text x="330" y="270" fill="var(--ink-soft)" font-size="11">客户端只发 SQL,数据文件只有服务碰</text>
<defs><marker id="m228" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L8,4 L0,8 z" fill="var(--ink-faint)"/></marker></defs>
</g>
</svg>
<figcaption>SQLite 的引擎被装进你自己的进程,直接读写一个文件。Postgres 的引擎是单独一个服务进程,psql 和 Python 都只是客户端,把 SQL 发过去、把结果拿回来。</figcaption>
</figure>

这个区别带来一串后果,今天会一个个亲手碰到:服务没开时客户端连不上;一个服务里可以有很多个库,要先建库再用;连接需要地址、端口、用户名;多个程序可以同时连、同时读写同一份数据;客户端自己不碰数据文件,所以「删掉一个文件就清空数据库」这种事在 Postgres 里不存在。

为什么 RAG 要用 Postgres 而不是继续用 SQLite?SQLite 也有向量扩展,玩具项目完全够用。课程选 Postgres 有两个实际理由:后面的毕业项目 SupportPilot 要多个进程同时读写(API 服务、后台 worker、评测脚本),这正是服务型数据库擅长的;招聘 JD 里写的也基本是 Postgres、MySQL 这类服务型数据库,pgvector 又是 Postgres 上最常用的向量方案。明天会细讲选它的理由。

## 第一步:装 Postgres.app

Mac 上装 Postgres 有三种常见办法:Docker、Homebrew、Postgres.app。我推荐 Postgres.app,理由很具体。Docker Desktop 在 Mac 上要先起一个虚拟机,常驻占 2 GB 左右内存,老电脑会明显变卡,[Day 102](/blog/agent-zero/day-102-docker-3/) 学 compose 时用它起过 Postgres,但日常学习没必要一直开着。Homebrew 的 `brew install postgresql@17` 在较老的 macOS 上可能要从源码编译依赖,我在一台 2019 款 Intel MacBook 上就卡在这一步。Postgres.app 是一个普通的 Mac 应用,拖进「应用程序」就能用,**自带 pgvector**,明天不用再装任何东西,空闲时只占十几 MB 内存。

步骤:

1. 打开 [Postgres.app 的 GitHub Releases](https://github.com/PostgresApp/PostgresApp/releases/tag/v2.9.6),下载 `Postgres-2.9.6-17.dmg`。2026 年 10 月我查到的正式版是 2.9.6(8 月 13 日发布),这个包只含 PostgreSQL 17,114 MB,Intel 和 Apple 芯片通用。Releases 页面最上面那几个 `v3beta1`、`v3alpha10` 是测试版,别下。
2. 打开 dmg,把 Postgres.app 拖进「应用程序」,然后从「应用程序」里打开它(别直接在 dmg 里双击运行)。
3. 窗口里点 **Initialize**。它会建一个数据目录并启动服务,看到绿色的「Running」就是起来了。
4. 菜单栏会多一个大象图标。不学的时候可以点它选 Stop 停掉服务,省电;下次用之前记得再 Start。

为什么选 17 而不是 18?两个都是正式版,课程里的代码在 17 上实跑过,换 18 大概率也没问题。我的取舍是跟着自己实测过的版本走,省得读者踩到我没见过的坑。PostgreSQL 每个大版本官方维护 5 年,17 用到 2029 年没问题,具体日期见 [官方版本政策](https://www.postgresql.org/support/versioning/)。

**这一步我没有在本机重装**:我的电脑之前已经按上面的步骤装好了 Postgres.app 2.9.6,今天没卸载重来,所以安装界面没有截图。下面从命令行开始的每一条输出都是今天实跑的。

## 第二步:把命令行工具加进 PATH

Postgres.app 自带一整套命令行工具(`psql`、`createdb`、`dropdb`……),放在应用包里面一个很深的目录。要在终端里直接敲 `psql`,得把这个目录加进 PATH。[Day 7](/blog/agent-zero/day-007-terminal-4/) 讲过 PATH 就是「终端去哪些目录里找命令」,和 `npm i -g` 装的命令能直接敲是一个道理。

```bash
echo 'export PATH="/Applications/Postgres.app/Contents/Versions/latest/bin:$PATH"' >> ~/.zshrc
source ~/.zshrc
which psql createdb
psql --version
```

<div class="line-notes">

- `echo 'export PATH=` 往 `~/.zshrc` 末尾追加一行。`>>` 是追加,写成一个 `>` 会把整个 `.zshrc` 清空只剩这一行([Day 5](/blog/agent-zero/day-005-terminal-3/) 的重定向)。`latest` 是 Postgres.app 建的一个快捷方式,指向当前版本 17 的目录。
- `source ~/.zshrc` 让当前这个终端窗口立刻读一遍新配置。新开的终端会自动读,不用再 source。
- `which psql createdb` 问终端这两个命令分别在哪。能打印出路径就说明 PATH 生效了。
- `psql --version` 打印版本,实测 `17.11`。

</div>

我的输出:

```text
/Applications/Postgres.app/Contents/Versions/latest/bin/psql
/Applications/Postgres.app/Contents/Versions/latest/bin/createdb
psql (PostgreSQL) 17.11 (Postgres.app)
```

如果 `which psql` 什么都不打印,或者 `psql` 报 `command not found`,先检查两件事:那一行是不是真的写进了 `~/.zshrc`(`tail -1 ~/.zshrc` 看一眼),以及你是不是在另一个早就开着的终端窗口里敲的(那个窗口没 source 过)。

## 亲眼看一下这个服务

装好以后,我们先别急着建库,去看看那个「一直在跑的服务」到底在哪。[Day 77](/blog/agent-zero/day-077-server-1/) 用 `lsof` 查过 `python -m http.server` 占的 8000 端口,今天同样查 5432:

```bash
lsof -nP -iTCP:5432 -sTCP:LISTEN
ps aux | grep "[p]ostgres" | head -6
```

<div class="line-notes">

- `lsof -nP -iTCP:5432 -sTCP:LISTEN` 列出正在监听 TCP 5432 端口的进程。`-n` 和 `-P` 让地址和端口用数字显示,不去反查名字,快一些。
- `ps aux | grep "[p]ostgres" | head -6` 列出所有进程,筛出名字里带 postgres 的。`[p]ostgres` 这个写法是个小技巧:正则 `[p]` 匹配字母 p,但 grep 自己这一行的命令文本里是 `[p]ostgres`,不含连续的 `postgres`,就不会把 grep 自己也列出来。

</div>

我的输出(`ps` 那几行很长,只保留了关键部分):

```text
COMMAND    PID   USER   FD   TYPE             DEVICE SIZE/OFF NODE NAME
postgres 29027 minliu    7u  IPv6 0x563949572de8ca6f      0t0  TCP [::1]:5432 (LISTEN)
postgres 29027 minliu    8u  IPv4 0x56394943ffb97777      0t0  TCP 127.0.0.1:5432 (LISTEN)

minliu  29033  ... postgres: logical replication launcher
minliu  29032  ... postgres: autovacuum launcher
minliu  29031  ... postgres: walwriter
minliu  29029  ... postgres: background writer
minliu  29028  ... postgres: checkpointer
minliu  29027  ... /Applications/Postgres.app/Contents/Versions/17/bin/postgres -D /Users/minliu/Library/Application Support/Postgres/var-17
```

几个看点。监听 5432 的是 PID 29027 那个进程,它同时听了 IPv6 的 `[::1]` 和 IPv4 的 `127.0.0.1`,两个都是「本机」的意思,外面的电脑连不进来。它的启动命令里 `-D` 后面那串就是**数据目录**,所有库、所有表的数据都在这个目录下面,你的路径会是 `/Users/你/Library/Application Support/Postgres/var-17`。其余几个 `postgres: xxx` 是它派生出来的后台帮手,分别负责写日志、刷盘、清理旧数据,今天不用管它们。

数据目录里长这样(只列前几项):

```text
PG_VERSION  base  global  pg_hba.conf  pg_wal  postgresql.conf  postgresql.log  postmaster.pid ...
```

`base/` 下面是每个库的数据文件,`postgresql.conf` 是服务的配置,`postgresql.log` 是服务的日志,连不上的时候来这里看。**这个目录别手动改、别手动删里面的文件**,它只归 postgres 服务管。想清空一个库,用下面的 `dropdb`。

## 第三步:createdb 建一个库

一个 Postgres 服务里可以装很多个**库**(database),库和库之间互相看不见。类比前端:服务像一台装了很多个项目的开发机,每个库是一个独立项目。SQLite 里「一个文件就是一个库」,在 Postgres 里要先建库才能往里建表。

课程从今天起用一个叫 `agentzero` 的库,和练习仓库 `agent-zero-lab` 对应:

```bash
createdb agentzero
createdb agentzero
psql -l
```

<div class="line-notes">

- `createdb agentzero` 让服务建一个新库。成功时什么都不打印,这是命令行工具的习惯:没消息就是好消息。
- `createdb agentzero` 故意再敲一次,看重名时会怎样。
- `psql -l` 列出这个服务里所有的库,`-l` 是 list。

</div>

```text
createdb: error: database creation failed: ERROR:  database "agentzero" already exists
                                                       List of databases
     Name      |  Owner   | Encoding | Locale Provider |   Collate   |    Ctype    | ...
---------------+----------+----------+-----------------+-------------+-------------+----
 agent60       | minliu   | UTF8     | icu             | en_US.UTF-8 | en_US.UTF-8 | ...
 agentzero     | minliu   | UTF8     | icu             | en_US.UTF-8 | en_US.UTF-8 | ...
 minliu        | minliu   | UTF8     | icu             | en_US.UTF-8 | en_US.UTF-8 | ...
 postgres      | postgres | UTF8     | icu             | en_US.UTF-8 | en_US.UTF-8 | ...
 template0     | postgres | UTF8     | icu             | en_US.UTF-8 | en_US.UTF-8 | ...
 template1     | postgres | UTF8     | icu             | en_US.UTF-8 | en_US.UTF-8 | ...
```

第一次成功(没输出),第二次报 `already exists`。列表里除了 `agentzero`,我的机器上还有几个以前建的库,你的列表会少一些。`postgres`、`template0`、`template1` 三个是服务自带的,`createdb` 新建库其实就是复制一份 `template1`,别删它们。和你 Mac 用户名同名的那个库(我这里是 `minliu`)是 Postgres.app 点 Initialize 时顺手建的。

**用户和密码去哪了?** 没输入任何账号就建好了库,是因为 Postgres.app 初始化时建了一个和你 Mac 用户名同名的数据库用户,并且配置成「从本机连接不需要密码」。命令行工具不指定用户时默认用当前登录名,刚好对上。这是本机开发的便利设置,线上服务器绝不会这样配,第七部分部署时会讲密码和权限。

## 第四步:psql 里建表、查数

`psql` 是 Postgres 官方的命令行客户端,相当于一个专门和数据库对话的终端:你敲 SQL,它发给服务,把结果画成表格。

```bash
psql -d agentzero
```

`-d agentzero` 指定连哪个库。进去以后提示符变成 `agentzero=#`,说明已经连上了。现在敲的东西分两类:以分号结尾的 SQL 发给服务执行;以反斜杠开头的是 psql 自己的命令(叫**元命令**),只在 psql 里有效。先认识几个最常用的:

| 元命令 | 作用 | 类比 |
| --- | --- | --- |
| `\l` | 列出所有库 | 同 `psql -l` |
| `\c 库名` | 切换到另一个库 | `cd` |
| `\dt` | 列出当前库的所有表 | `ls` |
| `\d 表名` | 看一张表的结构:列、类型、索引 | 看 TS 的 interface 定义 |
| `\conninfo` | 现在连的是哪个库、哪个用户、什么端口 | — |
| `\q` | 退出 psql | `exit` |

`\conninfo` 先敲一下,我的输出:

```text
You are connected to database "agentzero" as user "minliu" via socket in "/tmp" at port "5432".
```

注意 `via socket in "/tmp"`:本机连接默认走 `/tmp` 下面一个叫 `.s.PGSQL.5432` 的 Unix socket 文件,而不是网络,更快。端口号 5432 还是要对,它也是这个 socket 文件名的一部分。

接着把 [Day 85](/blog/agent-zero/day-085-sql-1/) 的客户表在 Postgres 里建一遍,SQL 几乎原样照搬:

```sql
CREATE TABLE customers (
    id      integer PRIMARY KEY,
    name    text NOT NULL,
    plan    text NOT NULL,
    mrr     numeric(10, 2) NOT NULL
);
INSERT INTO customers VALUES
    (1, '星河咖啡', 'pro', 39.00),
    (2, '北辰物流', 'enterprise', 299.00),
    (3, '小鹿书店', 'free', 0);
SELECT * FROM customers WHERE mrr > 10 ORDER BY mrr DESC;
```

<div class="line-notes">

- `CREATE TABLE customers (` 建表语法和 SQLite 一样。psql 里可以分多行敲,它会一直等到看见分号才发出去,中间提示符变成 `agentzero-#`。
- `id      integer PRIMARY KEY,` `integer` 是 4 字节整数,最大约 21 亿。主键不能重复,下面会故意撞一次。
- `name    text NOT NULL,` `text` 是不限长度的字符串,相当于 TS 的 `string`。Postgres 里存中文没有任何特别设置,库的编码是 UTF8(上面 `\l` 那一列)。
- `mrr     numeric(10, 2) NOT NULL` MRR 是「月经常性收入」,每个客户每月付多少钱。`numeric(10, 2)` 是精确小数:一共最多 10 位数字,其中 2 位在小数点后。金额一律用它,不用浮点数,练习 4 会看到为什么。
- `INSERT INTO customers VALUES` 一条 INSERT 插三行,每行一对括号,逗号隔开。
- `(3, '小鹿书店', 'free', 0);` 字符串用单引号。写成双引号 `"小鹿书店"` 在 Postgres 里是「列名」的意思,会报列不存在,这是从 JS 过来最常犯的错。
- `SELECT * FROM customers WHERE mrr > 10 ORDER BY mrr DESC;` 查月收入超过 10 的客户,按金额从大到小。

</div>

我的输出:

```text
CREATE TABLE
INSERT 0 3
 id |   name   |    plan    |  mrr
----+----------+------------+--------
  2 | 北辰物流 | enterprise | 299.00
  1 | 星河咖啡 | pro        |  39.00
(2 rows)
```

`CREATE TABLE` 和 `INSERT 0 3` 是服务的回执,`INSERT 0 3` 里的 3 是插了 3 行(前面那个 0 是历史遗留字段,永远是 0,不用管)。`0` 存进 `numeric(10, 2)` 以后显示成了 `0.00`,小数位数由列的定义说了算。

再用元命令看看表:

```text
agentzero=# \dt
          List of relations
 Schema |   Name    | Type  | Owner
--------+-----------+-------+--------
 public | customers | table | minliu
(1 row)

agentzero=# \d customers
                Table "public.customers"
 Column |     Type      | Collation | Nullable | Default
--------+---------------+-----------+----------+---------
 id     | integer       |           | not null |
 name   | text          |           | not null |
 plan   | text          |           | not null |
 mrr    | numeric(10,2) |           | not null |
Indexes:
    "customers_pkey" PRIMARY KEY, btree (id)
```

`Schema` 那一列的 `public` 是库里默认的命名空间,今天的表都在它下面,可以先忽略。`\d customers` 最后一段说明主键自动带了一个索引 `customers_pkey`,[Day 89](/blog/agent-zero/day-089-sql-5/) 讲过索引为什么让查找变快,Postgres 建主键时会自动给你建。

### 故意踩坑:类型不对、主键重复

```sql
INSERT INTO customers VALUES (4, '青柠工作室', 'pro', 'abc');
INSERT INTO customers VALUES (1, '重复的', 'pro', 39);
SELECT count(*) FROM customers;
```

```text
ERROR:  invalid input syntax for type numeric: "abc"
LINE 1: ...NSERT INTO customers VALUES (4, '青柠工作室', 'pro', 'abc');
                                                                ^
ERROR:  duplicate key value violates unique constraint "customers_pkey"
DETAIL:  Key (id)=(1) already exists.
 count
-------
     3
(1 row)
```

两条都被拒了,表里还是 3 行。第一条是金额列塞了个字符串 `'abc'`,Postgres 直接说「这不是合法的 numeric」,还用 `^` 指出是哪个位置。第二条是主键 1 已经有了,`DETAIL` 一行写清楚是哪个值撞了。读 Postgres 报错的习惯:先看 `ERROR:` 后面那句,再看 `DETAIL:` 和 `LINE` 指的位置。

主键重复 SQLite 也会拒([Day 91](/blog/agent-zero/day-091-sql-6/) 演示过约束)。但第一条,SQLite 的表现不一样。在 `agent-zero-lab` 里新建 `part04/sqlite_loose.py` 对照一下:

```python
# agent-zero-lab/part04/sqlite_loose.py
import sqlite3

conn = sqlite3.connect(":memory:")
conn.execute("CREATE TABLE customers (id INTEGER PRIMARY KEY, name TEXT NOT NULL, mrr NUMERIC NOT NULL)")
conn.execute("INSERT INTO customers VALUES (?, ?, ?)", (4, "青柠工作室", "abc"))
row = conn.execute("SELECT mrr, typeof(mrr) FROM customers").fetchone()
print("SQLite 存进去的:", row)
```

<div class="line-notes">

- `conn = sqlite3.connect(":memory:")` `:memory:` 是 SQLite 的特殊文件名,库建在内存里,程序结束就没了,做实验正合适。
- `conn.execute("CREATE TABLE customers (` 同样把 `mrr` 声明成 `NUMERIC`。
- `conn.execute("INSERT INTO customers VALUES (?, ?, ?)", (4, "青柠工作室", "abc"))` 往数字列塞字符串 `"abc"`。这里用的是 SQLite 的 `?` 占位符,下面 Postgres 会换成 `%s`。
- `row = conn.execute("SELECT mrr, typeof(mrr) FROM customers").fetchone()` `typeof()` 是 SQLite 的函数,返回这一格实际存的是什么类型。
- `print("SQLite 存进去的:", row)` 实测 `('abc', 'text')`:SQLite 没报错,把字符串原样存进了「数字列」。

</div>

```bash
cd /Users/你/agent-zero-lab
uv run python -m part04.sqlite_loose
```

```text
SQLite 存进去的: ('abc', 'text')
```

SQLite 的列类型只是「建议」,它叫类型亲和性(type affinity),塞不进去就按原样存。Postgres 的类型是**硬约束**,不符合就拒绝。在 RAG 里这个区别很实际:明天会建一个 `vector(1024)` 的列,往里塞 1023 维的向量会被直接拒掉,这能挡住「建索引和查询用了不同的 embedding 模型」这种安静的事故。Day 225 那个「两个文件不是同一次建的」坑,就是因为 `.npy` 文件没人替你检查。

做完这一段,敲 `\q` 退出 psql。

## 第五步:用 Python 连上去

psql 是给人用的,程序要连 Postgres 得用**驱动**:一个 Python 包,负责建立连接、把 SQL 发过去、把结果转成 Python 对象。SQLite 的驱动 `sqlite3` 是 Python 自带的,Postgres 的要自己装。课程用 `psycopg`(第 3 版,包名就叫 psycopg,老教程里的 `psycopg2` 是上一代),它是 Postgres 社区最常用的 Python 驱动。

```bash
cd /Users/你/agent-zero-lab
uv add "psycopg[binary]"
```

`[binary]` 的意思是顺带装一个预编译好的 C 扩展 `psycopg-binary`,这样不需要你电脑上有编译器和 Postgres 的开发头文件。2026 年 10 月我装到的是 psycopg 3.3.6。uv 的输出最后几行:

```text
 + psycopg==3.3.6
 + psycopg-binary==3.3.6
```

连接需要一个地址,写成一行**连接串**(DSN),格式和你在前端见过的 URL 一模一样:

```text
postgresql://用户名:密码@主机:端口/库名
```

Postgres.app 本机不要密码,用户名是你的 Mac 用户名(终端里 `whoami` 能看到)。把它加到 `.env` 里([Day 53](/blog/agent-zero/day-053-env-secrets/) 建的那个,和 `LLM_*`、`EMB_*` 放在一起):

```bash
# agent-zero-lab/.env  新增一行,把 minliu 换成你自己的 whoami
PG_DSN=postgresql://minliu@localhost:5432/agentzero
```

为什么连接串也放 `.env`?部署到服务器以后,数据库在别的机器上、有密码,代码不改,只改这一行。

新建 `part04/pg_hello.py`:

```python
# agent-zero-lab/part04/pg_hello.py
import os

import psycopg
from dotenv import load_dotenv

load_dotenv()
DSN = os.environ["PG_DSN"]

with psycopg.connect(DSN) as conn:
    print("连上了:", conn.info.dbname, "用户", conn.info.user, "端口", conn.info.port)
    row = conn.execute("SELECT version()").fetchone()
    print("服务端:", row[0][:32] if row else None)
    rows = conn.execute(
        "SELECT id, name, mrr FROM customers WHERE plan = %s ORDER BY id", ("pro",)
    ).fetchall()
    print("pro 套餐:", rows)
```

<div class="line-notes">

- `import psycopg` 刚装的驱动。
- `load_dotenv()` 把 `.env` 读进环境变量,Day 53 学过。
- `DSN = os.environ["PG_DSN"]` 用方括号取:没配这一行就直接 `KeyError: 'PG_DSN'`,比拿到 `None` 再报一个看不懂的连接错误好排查。实测值 `postgresql://minliu@localhost:5432/agentzero`。
- `with psycopg.connect(DSN) as conn:` 建立连接。`with` 块结束时,psycopg 会先**提交**(块里没出异常的话)再关闭连接;出了异常就回滚。这和 `sqlite3` 的 `with conn:` 只管提交、不管关闭不一样,下面专门演示。
- `print("连上了:", conn.info.dbname, "用户", conn.info.user, "端口", conn.info.port)` `conn.info` 里是这条连接的信息,实测打印 `agentzero`、`minliu`、`5432`。
- `row = conn.execute("SELECT version()").fetchone()` 让服务报一下版本。`conn.execute` 返回一个游标,`.fetchone()` 取第一行,是一个元组;没有行时返回 `None`。
- `print("服务端:", row[0][:32] if row else None)` 取元组第 0 个元素,只打印前 32 个字符。写 `if row else None` 是因为类型检查器知道 `fetchone()` 可能返回 `None`,不处理的话 Zed 里会画红线。
- `"SELECT id, name, mrr FROM customers WHERE plan = %s ORDER BY id", ("pro",)` **占位符是 `%s`**,不是 SQLite 的 `?`。值放在后面的元组里由驱动单独传给服务,和 Day 92 讲的参数化防注入是同一回事。`("pro",)` 末尾的逗号不能省,不然它只是一个带括号的字符串,不是元组。
- `print("pro 套餐:", rows)` `fetchall()` 返回元组列表。实测 `[(1, '星河咖啡', Decimal('39.00'))]`。

</div>

```bash
uv run python -m part04.pg_hello
```

```text
连上了: agentzero 用户 minliu 端口 5432
服务端: PostgreSQL 17.11 (Postgres.app)
pro 套餐: [(1, '星河咖啡', Decimal('39.00'))]
```

刚才在 psql 里插的数据,Python 这边原样读到了。这就是「服务」的意思:数据不属于任何一个客户端。

注意 `mrr` 读出来是 `Decimal('39.00')`,不是 `39.0`。`Decimal` 是 Python 标准库里的精确小数类型,psycopg 把 `numeric` 列转成它,保证金额一分不差。JS 里没有对应的内置类型(前端处理金额一般用「分」存整数,或者 decimal.js 这类库),思路是一样的。要交给前端或者 `json.dumps` 时,用 `float()` 或 `str()` 转一下,练习 2 会用到。

### 故意踩坑一:占位符写成 ?

从 SQLite 过来,手会自动写 `?`。新建 `part04/pg_qmark.py` 看看会怎样:

```python
# agent-zero-lab/part04/pg_qmark.py
import os

import psycopg
from dotenv import load_dotenv

load_dotenv()
with psycopg.connect(os.environ["PG_DSN"]) as conn:
    conn.execute("SELECT name FROM customers WHERE plan = ?", ("pro",))
```

<div class="line-notes">

- `conn.execute("SELECT name FROM customers WHERE plan = ?", ("pro",))` 唯一的改动:`%s` 换成了 `?`。

</div>

```text
psycopg.ProgrammingError: the query has 0 placeholders but 1 parameters were passed
```

psycopg 不认识 `?`,在它眼里这条 SQL 一个占位符都没有,你却传了 1 个参数,对不上。看到 `has 0 placeholders but N parameters` 就去检查占位符。顺便记一下:SQL 里要写一个真正的百分号(比如 `LIKE '退款%'`)并且同时用了参数时,得写成 `%%`,因为单个 `%` 被 psycopg 当成占位符的开头。

### 故意踩坑二:连不上

最常见的情况是 Postgres.app 被停了(菜单栏大象点了 Stop,或者重启电脑后没自动开)。我不想停掉本机的服务,就用一个没人监听的端口 5433 模拟同样的现象。新建 `part04/pg_port.py`:

```python
# agent-zero-lab/part04/pg_port.py
import psycopg

psycopg.connect("postgresql://localhost:5433/agentzero", connect_timeout=3)
```

<div class="line-notes">

- `psycopg.connect("postgresql://localhost:5433/agentzero", connect_timeout=3)` 端口故意写成 5433。`connect_timeout=3` 是最多等 3 秒,不然连一台不响应的远程机器时会等很久。

</div>

```text
psycopg.OperationalError: connection failed: connection to server at "127.0.0.1", port 5433 failed: could not receive data from server: Connection refused
```

完整报错前面还有几行 `Multiple connection attempts failed`,因为 `localhost` 同时对应 IPv6 的 `::1` 和 IPv4 的 `127.0.0.1`,它两个都试了。关键词是 **`Connection refused`**:那个端口上没有服务在听。排查顺序:菜单栏大象是不是 Running → 端口是不是 5432(`lsof` 那条命令)→ 连接串有没有拼错。还有一种报错长得很像但原因不同:`FATAL:  database "xxx" does not exist`,那是服务连上了,只是库名写错了,练习 3 会碰到。

### 故意踩坑三:忘了提交

psycopg 默认把你执行的语句放在一个**事务**里,不提交就不算数。[Day 93](/blog/agent-zero/day-093-python-sqlite-2/) 在 SQLite 里讲过 commit 和 rollback,这里看看 psycopg 的表现。新建 `part04/pg_commit.py`:

```python
# agent-zero-lab/part04/pg_commit.py
import os

import psycopg
from dotenv import load_dotenv

load_dotenv()
DSN = os.environ["PG_DSN"]

conn = psycopg.connect(DSN)
conn.execute("INSERT INTO customers VALUES (4, '青柠工作室', 'pro', 39)")
print("同一个连接里看:", conn.execute("SELECT count(*) FROM customers").fetchone())
conn.close()

with psycopg.connect(DSN) as conn2:
    print("关掉重连再看:", conn2.execute("SELECT count(*) FROM customers").fetchone())
    conn2.execute("INSERT INTO customers VALUES (4, '青柠工作室', 'pro', 39)")

with psycopg.connect(DSN) as conn3:
    print("用 with 写完再看:", conn3.execute("SELECT count(*) FROM customers").fetchone())
```

<div class="line-notes">

- `conn = psycopg.connect(DSN)` 这次不用 `with`,手动管连接。
- `conn.execute("INSERT INTO customers VALUES (4, '青柠工作室', 'pro', 39)")` 插一行。这条语句自动开始了一个事务,但没人提交它。
- `print("同一个连接里看:",` 在同一个连接里数行数,实测 `(4,)`:自己的事务里看得到自己没提交的改动。
- `conn.close()` 直接关连接,没有 `conn.commit()`。没提交的事务随连接一起被服务端丢弃。
- `print("关掉重连再看:",` 新连接里数,实测 `(3,)`,刚才那行没了。
- `conn2.execute("INSERT INTO customers VALUES (4, '青柠工作室', 'pro', 39)")` 同样一句,这次写在 `with` 块里。
- `print("用 with 写完再看:",` 第三个连接里数,实测 `(4,)`:`with` 块正常结束时替你提交了。

</div>

```text
同一个连接里看: (4,)
关掉重连再看: (3,)
用 with 写完再看: (4,)
```

这是最隐蔽的一种坑:程序不报错,打印出来的数字也对(第一行 4),数据却没进库。记一条规矩就够:**连接一律用 `with psycopg.connect(...) as conn:`**,要么就自己在最后写 `conn.commit()`。明天还会见到第三种写法 `autocommit=True`,每条语句执行完立刻生效,适合建表这类一句一句的操作。

## 两个客户端同时连

最后验证一下「服务」最实用的那个性质:多个客户端同时连同一个库,一边改了,另一边马上看得到。这正是 numpy 文件做不到的。新建 `part04/pg_two_clients.py`:

```python
# agent-zero-lab/part04/pg_two_clients.py
import os

import psycopg
from dotenv import load_dotenv

load_dotenv()
DSN = os.environ["PG_DSN"]

a = psycopg.connect(DSN, application_name="client-A", autocommit=True)
b = psycopg.connect(DSN, application_name="client-B", autocommit=True)
print("A 的服务端进程号:", a.info.backend_pid, " B 的:", b.info.backend_pid)

a.execute("UPDATE customers SET mrr = 49 WHERE id = 1")
print("A 改完,B 立刻读到:", b.execute("SELECT mrr FROM customers WHERE id = 1").fetchone())

rows = b.execute(
    "SELECT pid, application_name FROM pg_stat_activity WHERE datname = current_database() ORDER BY pid"
).fetchall()
print("服务器上正连着这个库的:", rows)
a.close()
b.close()
```

<div class="line-notes">

- `a = psycopg.connect(DSN, application_name="client-A", autocommit=True)` 第一个连接。`application_name` 是给连接起个名字,服务端能看到,排查「谁连着我」时有用。`autocommit=True` 让每条语句立刻生效,省得这个演示里还要管提交。
- `b = psycopg.connect(DSN, application_name="client-B", autocommit=True)` 第二个连接,同一个程序里开两个,效果和两台服务器各连一个一样。
- `print("A 的服务端进程号:", a.info.backend_pid,` Postgres 给**每个连接派一个专门的服务端进程**。实测 A 是 36484,B 是 36487,两个不同的进程。
- `a.execute("UPDATE customers SET mrr = 49 WHERE id = 1")` A 把星河咖啡的月费改成 49。
- `print("A 改完,B 立刻读到:",` B 去读,实测 `(Decimal('49.00'),)`。
- `"SELECT pid, application_name FROM pg_stat_activity WHERE datname = current_database() ORDER BY pid"` `pg_stat_activity` 是服务自带的一张「系统视图」,每个连接一行。`current_database()` 返回当前库名 `agentzero`。
- `print("服务器上正连着这个库的:", rows)` 实测 `[(36484, 'client-A'), (36487, 'client-B')]`。
- `a.close()` 用完关掉。连接是服务端的资源,默认一个服务最多 100 个连接,程序里开了不关会慢慢耗光。

</div>

```text
A 的服务端进程号: 36484  B 的: 36487
A 改完,B 立刻读到: (Decimal('49.00'),)
服务器上正连着这个库的: [(36484, 'client-A'), (36487, 'client-B')]
```

`application_name` 我一开始写的是中文「客户端A」,`pg_stat_activity` 里显示成了 `\xe5\xae\xa2...` 这样的转义字节,所以改成了英文。这个名字最好只用英文和数字。

「每个连接一个进程」这一点以后会反复用到:连接不是免费的,建立一次要几毫秒,服务端还要多养一个进程。第七部分做生产化时会讲**连接池**,就是为了复用连接。

## Postgres 和 SQLite 的区别,一张表

把今天碰到的区别收拢一下:

| | SQLite | Postgres |
| --- | --- | --- |
| 形态 | 一个库文件,引擎装在你的进程里 | 一个一直在跑的服务,程序是客户端 |
| 建库 | `connect("x.db")` 文件不存在就新建 | 先 `createdb`,连不存在的库报错 |
| 连接 | 文件路径 | 连接串:用户、主机、端口、库名 |
| 类型 | 只是建议,`'abc'` 能进数字列 | 硬约束,不符合直接拒绝 |
| Python 驱动 | 自带 `sqlite3`,占位符 `?` | 装 `psycopg`,占位符 `%s` |
| 多个程序同时写 | 同一时刻只能一个写 | 每个连接一个进程,并发读写 |
| 扩展 | 少 | 多,明天的 pgvector 就是一个扩展 |
| 适合 | 单机小工具、测试、手机 App | 网站和 Agent 服务的主数据库 |

SQLite 并不差,它是全世界装机量最大的数据库,手机里每个 App 几乎都在用。选哪个看场景:一个人用的命令行工具、单元测试,SQLite 省事;多个进程、多台机器要共享同一份数据,用 Postgres。SQL 语法两边九成一样,[Day 85](/blog/agent-zero/day-085-sql-1/) 到 [Day 91](/blog/agent-zero/day-091-sql-6/) 学的东西全部能用。

## 动手练习

**练习 1:建一个练习库再删掉。** 用 `createdb` 建一个叫 `agentzero_play` 的库,`psql -l` 确认它在,用 `psql -d agentzero_play -c "SELECT current_database()"` 连进去问一句,最后用 `dropdb` 删掉并确认它没了。

<details><summary>参考答案</summary>

```bash
createdb agentzero_play
psql -l | grep agentzero
psql -d agentzero_play -c "SELECT current_database()"
dropdb agentzero_play
psql -l | grep agentzero
```

<div class="line-notes">

- `createdb agentzero_play` 建库,成功不打印。
- `psql -l | grep agentzero` 列出所有库,用 [Day 5](/blog/agent-zero/day-005-terminal-3/) 的管道和 grep 只看名字带 agentzero 的。
- `psql -d agentzero_play -c "SELECT current_database()"` `-c` 是执行一句 SQL 就退出,不进交互界面,写脚本时常用。
- `dropdb agentzero_play` 删库,连同里面所有表和数据,**没有回收站**。删之前确认库名,别手滑删成 `agentzero`。
- `psql -l | grep agentzero` 再看一遍,`agentzero_play` 应该没了。

</div>

我的输出(删除前后两次 grep,中间是 `-c` 那句的结果;我机器上还有几个以前别的练习留下的库,你的列表会更短):

```text
 agentzero      | minliu   | UTF8     | icu             | en_US.UTF-8 | ...
 agentzero_play | minliu   | UTF8     | icu             | en_US.UTF-8 | ...
 current_database
------------------
 agentzero_play
(1 row)

 agentzero      | minliu   | UTF8     | icu             | en_US.UTF-8 | ...
```

如果 `dropdb` 报 `database "agentzero_play" is being accessed by other users`,说明还有一个 psql 窗口连着它,先在那边 `\q`。

</details>

**练习 2:从命令行插一个客户。** 写 `part04/ex_pg_insert.py`,从命令行接收 id、名字、套餐、月费四个参数插进 `customers`,然后打印这个套餐一共几家、月费合计多少,以及合计值的类型。用一个带单引号的名字 `O'Brien 咖啡` 试一次,再用月费 `abc` 试一次。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part04/ex_pg_insert.py
import os
import sys

import psycopg
from dotenv import load_dotenv

load_dotenv()

new_id, name, plan, mrr = int(sys.argv[1]), sys.argv[2], sys.argv[3], sys.argv[4]
with psycopg.connect(os.environ["PG_DSN"]) as conn:
    conn.execute("INSERT INTO customers VALUES (%s, %s, %s, %s)", (new_id, name, plan, mrr))
    rows = conn.execute("SELECT name, mrr FROM customers WHERE plan = %s ORDER BY id", (plan,)).fetchall()
    total = sum(m for _, m in rows)
    print(f"{plan} 套餐 {len(rows)} 家,月收入合计 {total},类型 {type(total).__name__}")
    print("转成 float 给前端:", float(total))
```

<div class="line-notes">

- `new_id, name, plan, mrr = int(sys.argv[1]), sys.argv[2], sys.argv[3], sys.argv[4]` `sys.argv` 是命令行参数列表,第 0 个是脚本名。id 转成整数;月费故意保持字符串 `"39.9"`,交给 Postgres 转成 numeric。
- `conn.execute("INSERT INTO customers VALUES (%s, %s, %s, %s)", (new_id, name, plan, mrr))` 四个占位符对应四个值。名字里的单引号由驱动处理,不会把 SQL 弄断。
- `rows = conn.execute("SELECT name, mrr FROM customers WHERE plan = %s ORDER BY id", (plan,)).fetchall()` 查这个套餐的所有客户。注意这一句和上面的 INSERT 在同一个事务里,能看到刚插的那行。
- `total = sum(m for _, m in rows)` 把每行的月费加起来。`for _, m in rows` 是解包([Day 22](/blog/agent-zero/day-022-tuples-unpack/)),`_` 表示名字不要。实测 pro 套餐三行:49.00(Day 228 正文里被 client-A 改过)、39.00、39.90。
- `print(f"{plan} 套餐 {len(rows)} 家,月收入合计 {total},类型 {type(total).__name__}")` 实测 `127.90`,类型 `Decimal`。几个 Decimal 相加还是 Decimal,不会出现 0.1+0.2 那种尾巴。
- `print("转成 float 给前端:", float(total))` 实测 `127.9`。`json.dumps` 不认识 Decimal,交出去之前要转。

</div>

```bash
uv run python -m part04.ex_pg_insert 5 "O'Brien 咖啡" pro 39.9
uv run python -m part04.ex_pg_insert 6 "坏数据" pro abc
```

```text
pro 套餐 3 家,月收入合计 127.90,类型 Decimal
转成 float 给前端: 127.9
...
psycopg.errors.InvalidTextRepresentation: invalid input syntax for type numeric: "abc"
CONTEXT:  unnamed portal parameter $4 = '...'
```

第一次成功,`O'Brien` 里的单引号没惹任何麻烦,这就是参数化的好处。第二次被 Postgres 拒了,`parameter $4` 指的是第 4 个参数。因为出了异常,`with` 块回滚,6 号客户一行都没写进去。

</details>

**练习 3:观察库名拼错时的报错。** 故意把库名拼错,运行 `psql -d agentzero_paly -c "select 1"`,把报错和「踩坑二」里的 `Connection refused` 对比,说出两者各说明了什么。

<details><summary>参考答案</summary>

```text
psql: error: connection to server on socket "/tmp/.s.PGSQL.5432" failed: FATAL:  database "agentzero_paly" does not exist
```

这条报错说明:**服务是连上了的**(`on socket "/tmp/.s.PGSQL.5432"`,它找到了 5432 的 socket 并且对话了),服务端检查库名时发现没有这个库,回了一个 `FATAL`。踩坑二的 `Connection refused` 则是根本没人接电话,服务没开或者端口错了。一个是「门开着,但你找的房间不存在」,一个是「门都没开」。排查方向完全不同:前者查库名(`psql -l`),后者查服务和端口。

</details>

**练习 4:为什么金额用 numeric。** 在 psql 里用 `GROUP BY`([Day 88](/blog/agent-zero/day-088-sql-4/))按套餐统计家数和月收入合计;再分别用 `numeric` 和浮点数 `float8` 算一次 `0.1 + 0.2`,对比结果。

<details><summary>参考答案</summary>

```sql
SELECT plan, count(*) AS 家数, sum(mrr) AS 月收入 FROM customers
GROUP BY plan ORDER BY 月收入 DESC;
SELECT 0.1 + 0.2 AS numeric_sum,
       0.1::float8 + 0.2::float8 AS float_sum;
```

<div class="line-notes">

- `SELECT plan, count(*) AS 家数, sum(mrr) AS 月收入 FROM customers` 按套餐分组,每组数行数、加月费。`AS 家数` 给结果列起名,中文列名可以用(不加双引号时 Postgres 会把英文列名转小写,中文不受影响)。
- `GROUP BY plan ORDER BY 月收入 DESC;` 按套餐分组后,按合计从大到小排。
- `SELECT 0.1 + 0.2 AS numeric_sum,` Postgres 里不带类型的小数字面量默认就是 `numeric`。
- `0.1::float8 + 0.2::float8 AS float_sum;` `::float8` 是把值转成 8 字节浮点数,和 JS 的 number 是同一种格式。

</div>

```text
    plan    | 家数 | 月收入
------------+------+--------
 enterprise |    1 | 299.00
 pro        |    3 | 127.90
 free       |    1 |   0.00
(3 rows)

 numeric_sum |      float_sum
-------------+---------------------
         0.3 | 0.30000000000000004
(1 row)
```

`float8` 算出了 [Day 12](/blog/agent-zero/day-012-numbers/) 见过的那个 `0.30000000000000004`,和 JS 里 `0.1 + 0.2` 一模一样,因为它们是同一种二进制浮点格式。`numeric` 是十进制精确计算,结果就是 0.3。钱一律用 `numeric`,向量明天会用 `vector`(里面是 4 字节浮点数,精度对检索够用)。

</details>

验收标准:`psql -d agentzero -c '\dt'` 能看到 `customers` 表;`uv run python -m part04.pg_hello` 三行输出和文中结构一致;能不看文章说出 `?` 和 `%s`、`Connection refused` 和 `does not exist` 各自的含义;`.env` 里有 `PG_DSN`。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| PostgreSQL / Postgres | 开源的服务型关系数据库,一直在后台运行,客户端连上去发 SQL |
| 数据库服务器 | 一个常驻进程,管数据文件、接受连接、执行 SQL。Postgres 默认监听 5432 端口 |
| 客户端 | 连到服务器上发 SQL 的程序,psql、Python 脚本、图形界面工具都是 |
| Postgres.app | Mac 上的 Postgres 安装包,一个普通应用,自带 pgvector 和命令行工具 |
| 数据目录 | 服务存放所有数据的目录,Postgres.app 17 是 `~/Library/Application Support/Postgres/var-17`,只归服务管 |
| 库(database) | 一个服务里可以有多个库,互相隔离,先 `createdb` 再用 |
| createdb / dropdb | 建库、删库的命令行工具。删库不可恢复 |
| psql | Postgres 官方命令行客户端,敲 SQL 看表格 |
| 元命令 | psql 里以反斜杠开头的命令,如 `\dt`、`\d 表名`、`\q`,只在 psql 里有效 |
| Unix socket | 本机进程间通信的通道,长得像一个文件(`/tmp/.s.PGSQL.5432`),本机连 Postgres 默认走它 |
| 驱动 | 让程序能连某种数据库的库。Postgres 的 Python 驱动用 psycopg |
| psycopg | Postgres 的 Python 驱动(第 3 版),占位符 `%s` |
| 连接串(DSN) | 一行写清连哪:`postgresql://用户@主机:端口/库名` |
| numeric | Postgres 的精确小数类型,存金额用;Python 里读出来是 `Decimal` |
| Decimal | Python 标准库的精确小数类型,不会有浮点误差 |
| 类型亲和性 | SQLite 的列类型只是建议,不符合也能存进去;Postgres 没有这一套,类型是硬约束 |
| pg_stat_activity | Postgres 自带的系统视图,每个连接一行,看谁连着服务 |

## 常见误区

**以为 Postgres 也是「一个文件」。** 想清空数据去删 `var-17` 里的文件,结果服务起不来。数据目录只归服务管,删库用 `dropdb`,删表用 `DROP TABLE`。

**SQL 里字符串用双引号。** `WHERE plan = "pro"` 在 Postgres 里报 `column "pro" does not exist`,因为双引号括起来的是列名或表名。字符串一律单引号。

**从 SQLite 带过来的 `?` 占位符。** psycopg 报 `the query has 0 placeholders but 1 parameters were passed`。Postgres 的 Python 驱动用 `%s`;SQL 里真要写百分号时写 `%%`。

**不用 `with`、也不 `commit()`。** 程序不报错,同一个连接里查得到,关掉以后数据没了。连接一律 `with psycopg.connect(...) as conn:`,或者明确写 `conn.commit()`。

**把 `Decimal` 直接交给 `json.dumps`。** 报 `Object of type Decimal is not JSON serializable`。出 Python 之前 `float()` 或 `str()`;要绝对精确就用字符串传给前端。

**`Connection refused` 去改代码。** 这个报错和代码无关,是服务没开或者端口不对。先看菜单栏大象是不是 Running,再 `lsof -nP -iTCP:5432 -sTCP:LISTEN`。

**以为本机不要密码,服务器上也不要。** Postgres.app 的「本机免密」是开发便利设置。部署时数据库一定有密码,密码写在 `.env` 的 `PG_DSN` 里,不进代码、不进 git。

**手滑 `dropdb` 删错库。** 没有回收站。删库前 `psql -l` 看清楚,名字差一个字母的库(`agentzero` 和 `agentzero_play`)最危险。

## 学习资料

### 文档与文章

- [PostgreSQL 官方教程 · Getting Started](https://www.postgresql.org/docs/17/tutorial-start.html):官方文档的第一章,讲了服务端和客户端的架构、建库、用 psql,正好对应今天。英文,20 分钟。
- [Postgres.app 官网](https://postgresapp.com/):安装步骤和常见问题,PATH 的另一种配置方法(`/etc/paths.d`)也写在这里。
- [psql 文档](https://www.postgresql.org/docs/17/app-psql.html):所有元命令的列表。不用读完,遇到想看的东西时按 `\d` 搜一下。
- [psycopg 3 · Basic module usage](https://www.psycopg.org/psycopg3/docs/basic/usage.html):`connect`、`execute`、`with` 块提交规则的官方说明,和今天的 `pg_commit.py` 对照读。
- [psycopg 3 · Passing parameters to SQL queries](https://www.psycopg.org/psycopg3/docs/basic/params.html):`%s`、`%(name)s` 和为什么永远不要自己拼字符串。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1AtQJB4E9o&p=4&autoplay=0&high_quality=1" title="PostgreSQL零基础入门课程" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>枫枫知道 · PostgreSQL零基础入门课程 · 2026 年的新课,共 24 集。今天看第 4 集「pgsql 的层级结构」(4 分钟,讲服务、库、模式、表的关系)和第 5 集「库和模式操作」;它用的是图形化安装和 Docker,装法跟着本文走 Postgres.app。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1FHHyzYEbA&autoplay=0&high_quality=1" title="为什么PostgreSQL能超越MySQL,有哪些优势?登顶最受欢迎的数据库" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>技术爬爬虾 · 为什么PostgreSQL能超越MySQL,有哪些优势?登顶最受欢迎的数据库 · 19 分钟,讲 Postgres 的扩展生态(里面也提到向量),帮你理解为什么 AI 应用爱用它。</figcaption>
</figure>

- HDAlex_John《PostgreSQL快速上手》(BV1MrKpzLE2t,17 分钟):想再看一遍命令行建库建表的,看这个短的。

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/n2Fluyr3lbc" title="PostgreSQL in 100 Seconds" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Fireship · PostgreSQL in 100 Seconds · 英文,两分多钟,Postgres 是什么、和别的数据库比有什么特点,节奏很快,适合开始前建立印象。</figcaption>
</figure>

### 书籍

- Regina Obe、Leo Hsu《PostgreSQL: Up and Running》第 3 版(O'Reilly,2017):薄,面向「会一点 SQL、第一次用 Postgres」的人,第 1 章讲安装和连接、第 4 章讲 psql。版本老了几个,基础部分不过时。
- 唐成《PostgreSQL 修炼之道:从小工到专家》第 2 版(机械工业出版社,2020):中文,「准备篇」是给没有数据库基础的读者写的,今天这些内容在前几章。

### 开源项目与代码

- [psycopg/psycopg](https://github.com/psycopg/psycopg):今天装的驱动。
- [PostgresApp/PostgresApp](https://github.com/PostgresApp/PostgresApp):Postgres.app 本身也是开源的,Releases 页就是今天的下载地址。

## 自测

**1. Postgres 和 SQLite 最根本的区别是什么?从这个区别出发,说出两个今天亲手碰到的后果。**

<details><summary>答案</summary>

SQLite 是装在你进程里的引擎加一个文件;Postgres 是一个独立运行、监听 5432 端口的服务,你的程序是客户端。后果举两个:服务没开时客户端报 `Connection refused`;要先 `createdb` 建库才能连;连接要用连接串写清用户、主机、端口、库名;多个客户端可以同时连,A 改了 B 立刻读到;每个连接在服务端对应一个进程(`backend_pid` 不同)。

</details>

**2. 下面这段代码运行后,`customers` 表里会多一行吗?为什么?**

```python
conn = psycopg.connect(DSN)
conn.execute("INSERT INTO customers VALUES (9, 'x', 'pro', 1)")
conn.close()
```

<details><summary>答案</summary>

不会。psycopg 默认把语句放在一个事务里,没有 `conn.commit()` 就关闭连接,事务被丢弃。改法:用 `with psycopg.connect(DSN) as conn:`(块结束自动提交),或者关闭前 `conn.commit()`,或者连接时加 `autocommit=True`。

</details>

**3. 看到 `FATAL:  database "agentzro" does not exist` 和 `Connection refused`,你分别先查什么?**

<details><summary>答案</summary>

前者服务已经连上了,只是库名不对,先 `psql -l` 看库名、检查 `.env` 里的 `PG_DSN`。后者是没有服务在那个端口监听,先看 Postgres.app 是不是 Running,再用 `lsof -nP -iTCP:5432 -sTCP:LISTEN` 确认端口。

</details>

**4. 为什么同样往数字列里写 `'abc'`,SQLite 存进去了、Postgres 拒绝了?这对明天存向量有什么好处?**

<details><summary>答案</summary>

SQLite 的列类型只是「亲和性」建议,塞不进就按原样存;Postgres 的类型是硬约束,不符合直接报 `invalid input syntax`。明天的 `vector(1024)` 列同样是硬约束,维度不对的向量写不进去,能挡住「索引和查询用了不同 embedding 模型」这类安静的错误。

</details>

**5. 面试题:你的 Agent 服务要部署三台机器,每台都要查同一份知识库。为什么 Day 225 的 `.npy` 文件方案在这里不合适,换成 Postgres 解决了什么?**

<details><summary>答案</summary>

`.npy` 方案每台机器各有一份文件,更新时要把文件同步到三台、还要保证同时切换,中间会有机器读到旧版本或半新半旧(Day 225 的两个文件对不上);也没有并发写入和事务。Postgres 是一个独立服务,三台机器都作为客户端连同一个库,数据只有一份,一边更新、其他连接马上读到(今天 client-A 改、client-B 立刻读到),写入有事务保证要么全成要么全不成。代价是多了一个要运维的服务,以及每次查询多一次网络往返。

</details>

## 明天预告

明天是 [Day 229 · pgvector(一):为什么选它,扩展和建表](/blog/agent-zero/day-229-pgvector-1/)。今天的 `agentzero` 库只能存数字和文字,明天在它上面执行一句 `CREATE EXTENSION vector`,让它多出一种 `vector` 列类型,再建好存 42 块的 `kb_chunks` 表。Postgres.app 已经自带 pgvector,不用再装任何东西。
