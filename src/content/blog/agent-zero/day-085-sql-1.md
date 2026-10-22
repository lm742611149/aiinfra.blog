---
title: 'Day 85 · SQL(一):SQLite、建表和 SELECT'
description: '数据放在 Python 列表里,进程一重启就没了。今天用 macOS 自带的 sqlite3 命令行建一个数据库文件,写一张 CloudLedger 的 customers 表装进 10 个客户,然后学 SQL 里最常用的一句话:SELECT 取列、WHERE 筛行、ORDER BY 排序、LIMIT 截断,顺带踩一遍 NULL、引号和中文排序这几个坑。'
pubDate: 2026-10-23
regime: none
tags: ['sql', 'sqlite', 'database', 'agent-zero']
series: 'agent-zero'
day: 85
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 84](/blog/agent-zero/day-084-auth-2/) 学了 JWT:三段 base64url 编码的文本,前两段谁都能读,第三段是只有服务端密钥算得出来的 HMAC 签名;手工拼的令牌和 pyjwt 生成的一字不差;在 FastAPI 里用它登录,服务端不用存表,代价是退出以后旧令牌照样能用,想让退出生效又得加回一张作废名单。

回头看这两周,工单、退款申请、session 表、作废名单,全都放在 Python 的列表、字典、集合里。[Day 80](/blog/agent-zero/day-080-fastapi-2/) 第 7 步就撞上了:改一下代码,`--reload` 重启一次,新建的工单全没了。要把数据长期存下来,还能按条件快速查,就需要**数据库**。接下来六天学 SQL,今天是第一天:建一张表,把它查明白。

## 今天要解决的问题

学完今天,你应该能做到:

1. 用 `sqlite3` 命令行打开(或新建)一个数据库文件,分清「点命令」和 SQL 语句,会用 `.tables`、`.schema`、`.quit`。
2. 读懂并写出一条 `CREATE TABLE`:表名、列名、类型(`INTEGER`、`TEXT`)、`PRIMARY KEY`、`NOT NULL`,知道 NULL 是什么。
3. 用 `SELECT ... FROM ... WHERE ... ORDER BY ... LIMIT` 从 `customers` 表里查出想要的行和列,会用 `AND`/`OR`/`IN`/`LIKE`/`IS NULL`。
4. 认出四个坑:`= NULL` 查不到东西、`!=` 会漏掉 NULL 的行、字符串用了双引号、中文按编码排序而不是按拼音。

今天两个新概念:**表**(建表、列和类型)和 **SELECT 查询**(取列、筛行、排序)。增删改是明天的事,今天的数据用一个现成的脚本灌进去。

预计用时:2.5 小时。花费 ¥0,不写 Python,只用终端。

前置:[Day 3](/blog/agent-zero/day-003-terminal-1/)、[Day 4](/blog/agent-zero/day-004-terminal-2/) 的 `cd`、`mkdir`、`ls`;[Day 5](/blog/agent-zero/day-005-terminal-3/) 的重定向 `<`;[Day 77](/blog/agent-zero/day-077-server-1/) 的进程和端口(用来对比 SQLite 为什么没有端口);[Day 23](/blog/agent-zero/day-023-comprehensions/) 的列表推导式(用来和 SELECT 对照)。

学法:先对照文章逐行敲一遍(不复制粘贴)并跑通;第二天合上文章,把 `customers.sql` 里的 `CREATE TABLE` 和今天的五类查询(取列、WHERE、IN/LIKE、IS NULL、ORDER BY + LIMIT)默写出来;做练习,做不出再展开参考答案,看完关掉自己重写一遍。

## 数据库是什么,从前端看

你在前端存过数据:变量里的数组,刷新就没了;`localStorage`,刷新还在,但只能整个读出来、整个存回去,想「找出所有专业版客户」得先 `JSON.parse` 出整个数组再 `filter`。数据一多、一复杂,这两样都不够用。

**数据库**是专门干这件事的程序:把数据持久地存在磁盘上,并且让你用一种专门的语言说「我要什么」,它负责高效地找出来。这种语言就是 **SQL**(Structured Query Language,结构化查询语言,读作 S-Q-L 或者 sequel 都行)。它和 Python、JS 不一样:你不写「怎么找」(循环、if),只写「要什么」(哪张表、哪些列、满足什么条件、怎么排),怎么找由数据库自己决定。

数据库里的数据放在**表**(table)里。一张表就像一张 Excel 工作表:每一**列**(column)是一个字段,有名字和类型;每一**行**(row)是一条记录。用前端的话说,一张表 ≈ 一个对象数组,每一行是一个对象,每一列是对象上的一个键,区别是:表的列是事先定死的,每一行都必须有这些列(值可以是空的),类型也被约束着。

数据库有很多种。后面做 Agent 的知识库会用 Postgres(Day 228 开始),它是一个独立运行的服务进程,监听 5432 端口,和 Day 77 讲的后端服务一样。今天用的 **SQLite** 不一样:它没有服务进程、不占端口,**整个数据库就是一个文件**,程序直接读写这个文件。你手机里的 App、浏览器的历史记录、很多桌面软件,底下都是 SQLite。学 SQL 用它最合适:不用装、不用配、删掉文件就清空了。SQL 语法在 SQLite 和 Postgres 之间大部分通用,今天学的 `SELECT` 到了 Postgres 照样能用。

## 第 1 步:打开 sqlite3

macOS 自带 `sqlite3` 命令行工具。先看版本:

```bash
sqlite3 --version
```

我这台 2019 款 MacBook(macOS 14)实跑输出:

```text
3.39.5 2022-10-14 20:58:05 554764a6e721fab307c63a4f98cd958c8428a5d9d8edfde951858d6fd02daapl
```

3.39.5 是 2022 年的版本,有点老,但今天用到的东西它全都支持。你的 macOS 新一些的话版本号会更高,不影响今天的内容。Windows 用户去 [sqlite.org 的下载页](https://sqlite.org/download.html) 下「sqlite-tools」那个压缩包,解压出 `sqlite3.exe`。

进练习仓库,建一个放 SQL 文件的目录,然后打开一个数据库文件:

```bash
cd /Users/你/agent-zero-lab
mkdir -p part01/sql
sqlite3 part01/sql/practice.db
```

<div class="line-notes">

- `mkdir -p part01/sql` SQL 这几天的文件都放这里。`-p` 表示上级目录不存在就一起建,已经存在也不报错(Day 4)。
- `sqlite3 part01/sql/practice.db` 打开这个数据库文件;文件不存在就新建一个。`.db` 只是习惯的扩展名,叫 `.sqlite` 也行。

</div>

屏幕上出现:

```text
SQLite version 3.39.5 2022-10-14 20:58:05
Enter ".help" for usage hints.
sqlite>
```

`sqlite>` 是提示符,和 Day 3 的 shell 提示符、Python 的 `>>>` 一样,表示「等你输入」。这里能输入两类东西:

- **点命令**:以 `.` 开头,是 sqlite3 这个工具自己的命令,不是 SQL,**不用分号结尾**。比如 `.tables` 列出所有表,`.schema` 看建表语句,`.quit` 退出。
- **SQL 语句**:比如 `SELECT ...`、`CREATE TABLE ...`,**必须以分号 `;` 结尾**才会执行。忘了分号回车,提示符会变成 `   ...>`,意思是「这句还没完,继续输」,补一个 `;` 回车就行。

输入 `.tables` 回车,什么都没有输出,因为还没有表。输入 `.quit` 退出,然后看看文件:

```bash
ls -l part01/sql/
```

实跑输出:

```text
total 0
-rw-r--r--  1 minliu  wheel  0 22 Oct 23:52 practice.db
```

一个 0 字节的文件。SQLite 打开时只是创建了一个空文件,真正写东西要等建表。

## 第 2 步:建一张表

再打开 `sqlite3 part01/sql/practice.db`,先手敲一个只有两列的小表,感受一下:

```sql
CREATE TABLE customers (
  id INTEGER PRIMARY KEY,
  company TEXT NOT NULL
);
```

<div class="line-notes">

- `CREATE TABLE customers (` 建一张叫 `customers` 的表。SQL 的关键字(`CREATE`、`TABLE`)不区分大小写,写成 `create table` 也行;习惯上关键字大写,表名列名小写,读起来分得清。
- `id INTEGER PRIMARY KEY,` 第一列:名字 `id`,类型 `INTEGER`(整数),`PRIMARY KEY` 是**主键**,每一行的唯一编号,不能重复。列和列之间用逗号隔开。
- `company TEXT NOT NULL` 第二列:`TEXT` 是文本,`NOT NULL` 表示这一列不能空着。最后一列后面**不能有逗号**,和 JSON 一样。
- `);` 括号收尾,分号结束这条语句。在 sqlite3 里可以分多行输入,看到分号才执行。

</div>

回车后没有任何输出,在 SQL 里没消息就是好消息。接着输入:

```text
.tables
.schema customers
```

实跑输出:

```text
customers
CREATE TABLE customers (
  id INTEGER PRIMARY KEY,
  company TEXT NOT NULL
);
```

`.tables` 列出了表名,`.schema` 把建表语句原样还给你。**schema**(模式)指的就是「数据库里有哪些表、每张表有哪些列、什么类型、什么约束」这套结构定义,相当于 TS 里的 `interface Customer { id: number; company: string }`。

再故意犯两个错。同样的表再建一次,然后把 SELECT 拼错:

```sql
CREATE TABLE customers (id INTEGER);
SELEC * FROM customers;
```

实跑输出:

```text
Parse error: table customers already exists
  CREATE TABLE customers (id INTEGER);
               ^--- error here
Parse error: near "SELEC": syntax error
  SELEC * FROM customers;
  ^--- error here
```

SQLite 的报错会用 `^---` 指出出错的位置。第一个是表已经存在;第二个是 `SELEC` 不认识。SQL 报错都是这种格式:`near "某个词": syntax error`,意思是「读到这个词的时候读不下去了」,问题通常就在这个词或者它前面一点。

`.quit` 退出。手敲适合试一两句,真正的建表和数据应该写成文件,方便改、方便重来、能放进 git。新建 `part01/sql/customers.sql`:

```sql
-- agent-zero-lab/part01/sql/customers.sql
DROP TABLE IF EXISTS customers;

CREATE TABLE customers (
    id          INTEGER PRIMARY KEY,
    company     TEXT    NOT NULL,
    contact     TEXT    NOT NULL,
    email       TEXT,
    plan        TEXT    NOT NULL,
    seats       INTEGER NOT NULL,
    city        TEXT,
    created_at  TEXT    NOT NULL
);

INSERT INTO customers VALUES
    (1,  '星河餐饮', '王伟', 'wangwei@xinghe.example',    '专业版', 12,  '杭州', '2025-03-14'),
    (2,  '青木设计', '李芳', 'lifang@qingmu.example',     '基础版', 3,   '上海', '2025-06-02'),
    (3,  '远山物流', '张磊', 'zhanglei@yuanshan.example', '企业版', 85,  '成都', '2024-11-20'),
    (4,  '蓝鲸教育', '刘洋', NULL,                        '专业版', 20,  '北京', '2025-01-08'),
    (5,  '启明科技', '陈静', 'chenjing@qiming.example',   '企业版', 140, '深圳', '2024-08-30'),
    (6,  '禾丰农业', '杨勇', 'yangyong@hefeng.example',   '基础版', 5,   NULL,   '2025-09-12'),
    (7,  '半岛咖啡', '黄敏', 'huangmin@bandao.example',   '基础版', 2,   '青岛', '2026-02-19'),
    (8,  '云杉律所', '赵杰', 'zhaojie@yunshan.example',   '专业版', 18,  '上海', '2025-11-03'),
    (9,  '北辰贸易', '吴涛', 'wutao@beichen.example',     '专业版', 9,   '天津', '2026-04-27'),
    (10, '小满花店', '周霞', 'zhouxia@xiaoman.example',   '基础版', 1,   '杭州', '2026-07-15');
```

<div class="line-notes">

- `-- agent-zero-lab/part01/sql/customers.sql` SQL 的单行注释是两个横线 `--`,相当于 Python 的 `#`、JS 的 `//`。
- `DROP TABLE IF EXISTS customers;` 先删掉同名的表(连同里面的数据),`IF EXISTS` 表示不存在也不报错。有了这一行,这个脚本可以反复执行,每次都从干净的状态开始。刚才手敲的那张两列小表也会被它删掉。**真实数据库里慎用 DROP**,删了就没了。
- `id          INTEGER PRIMARY KEY,` 客户编号。在 SQLite 里,`INTEGER PRIMARY KEY` 还有一个特殊作用:插入时不给值,它会自动分配下一个编号,明天会用到。
- `company     TEXT    NOT NULL,` 公司名,必填。中间那些空格只是为了对齐好看,SQL 不在乎。
- `contact     TEXT    NOT NULL,` 联系人。
- `email       TEXT,` 邮箱,**没写 `NOT NULL`,可以空着**。真实业务里总有客户没留邮箱。
- `plan        TEXT    NOT NULL,` 套餐:基础版、专业版、企业版。
- `seats       INTEGER NOT NULL,` 席位数,也就是这家公司买了几个账号。
- `city        TEXT,` 城市,可以空着。
- `created_at  TEXT    NOT NULL` 签约日期。SQLite 没有专门的日期类型,习惯上存成 `YYYY-MM-DD` 格式的文本,第 5 步会看到这种格式为什么排序正好是对的。
- `INSERT INTO customers VALUES` 往表里插数据,明天细讲。今天只要知道:每个括号是一行,值的顺序和建表时列的顺序一一对应。
- `(1,  '星河餐饮', '王伟', 'wangwei@xinghe.example',    '专业版', 12,  '杭州', '2025-03-14'),` 第 1 行。**SQL 里字符串用单引号**,数字不加引号。邮箱用的是 `.example` 结尾的域名,这是专门留给文档和示例用的,不会是真实的人。
- `(4,  '蓝鲸教育', '刘洋', NULL,` 4 号客户没有邮箱。`NULL` 是 SQL 里「没有值」的意思,≈JS 的 `null`、Python 的 `None`,**不是空字符串 `''`,也不是 0**。
- `(6,  '禾丰农业', '杨勇', 'yangyong@hefeng.example',   '基础版', 5,   NULL,` 6 号客户没填城市。这两个 NULL 是故意留的,第 4 步要用。
- `(10, '小满花店', '周霞', 'zhouxia@xiaoman.example',   '基础版', 1,   '杭州', '2026-07-15');` 最后一行后面是分号,不是逗号。

</div>

用 Day 5 的输入重定向 `<` 把这个文件喂给 sqlite3 执行:

```bash
sqlite3 part01/sql/practice.db < part01/sql/customers.sql
ls -l part01/sql/
```

<div class="line-notes">

- `sqlite3 part01/sql/practice.db < part01/sql/customers.sql` `<` 把文件内容当作键盘输入交给 sqlite3,效果和你把这些语句一条条粘贴进去一样,执行完自动退出。在 `sqlite>` 提示符里也可以用点命令 `.read part01/sql/customers.sql` 做同一件事。

</div>

实跑输出:

```text
total 24
-rw-r--r--  1 minliu  wheel  1452 22 Oct 23:52 customers.sql
-rw-r--r--  1 minliu  wheel  8192 22 Oct 23:52 practice.db
```

没有报错就是成功了。数据库文件从 0 字节变成了 8192 字节(SQLite 按 4096 字节一页来存,现在用了两页)。

`practice.db` 是从 `customers.sql` 生成出来的,随时能重新生成,所以 `.sql` 文件要进 git,`.db` 文件不要。在仓库根目录的 `.gitignore` 里加一行 `*.db`。

<figure>
<svg viewBox="0 0 640 270" role="img" aria-label="customers 表的结构:列有名字和类型,每一行是一个客户,id 是主键;右边是同样的数据写成 JS 对象数组">
<rect x="0" y="0" width="640" height="270" fill="var(--paper-raised)" rx="6"/>
<g font-family="var(--font-mono)" font-size="12">
<text x="20" y="26" fill="var(--ink)">表 customers</text>
<rect x="20" y="38" width="370" height="30" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="30" y="58" fill="var(--ink)">id</text>
<text x="70" y="58" fill="var(--ink)">company</text>
<text x="160" y="58" fill="var(--ink)">plan</text>
<text x="230" y="58" fill="var(--ink)">seats</text>
<text x="290" y="58" fill="var(--ink)">city</text>
<text x="20" y="84" fill="var(--ink-faint)" font-size="11">INTEGER  TEXT      TEXT    INTEGER TEXT(可空)</text>
<rect x="20" y="92" width="370" height="26" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="30" y="110" fill="var(--ink)">1</text>
<text x="70" y="110" fill="var(--ink-soft)">星河餐饮</text>
<text x="160" y="110" fill="var(--ink-soft)">专业版</text>
<text x="230" y="110" fill="var(--ink-soft)">12</text>
<text x="290" y="110" fill="var(--ink-soft)">杭州</text>
<rect x="20" y="118" width="370" height="26" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="30" y="136" fill="var(--ink)">6</text>
<text x="70" y="136" fill="var(--ink-soft)">禾丰农业</text>
<text x="160" y="136" fill="var(--ink-soft)">基础版</text>
<text x="230" y="136" fill="var(--ink-soft)">5</text>
<text x="290" y="136" fill="var(--ink-faint)">NULL</text>
<rect x="20" y="144" width="370" height="26" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="30" y="162" fill="var(--ink)">…</text>
<text x="70" y="162" fill="var(--ink-faint)">共 10 行</text>
<line x1="60" y1="38" x2="60" y2="170" stroke="var(--rule)"/>
<text x="20" y="196" fill="var(--mem)" font-size="11">↑ 主键列:每行唯一</text>
<text x="200" y="196" fill="var(--compute)" font-size="11">↑ 一行 = 一条记录</text>
<text x="20" y="226" fill="var(--ink-soft)" font-size="11">表头 = schema(列名 + 类型 + 约束),事先定死</text>
<rect x="420" y="38" width="200" height="132" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="430" y="58" fill="var(--ink)">// 前端里的样子</text>
<text x="430" y="80" fill="var(--ink-soft)">[</text>
<text x="440" y="100" fill="var(--ink-soft)">{id: 1, company:</text>
<text x="450" y="118" fill="var(--ink-soft)">'星河餐饮', ...},</text>
<text x="440" y="138" fill="var(--ink-soft)">{id: 6, city: null},</text>
<text x="430" y="158" fill="var(--ink-soft)">]</text>
<text x="420" y="196" fill="var(--ink-soft)" font-size="11">数组 ≈ 表,对象 ≈ 行</text>
<text x="420" y="214" fill="var(--ink-soft)" font-size="11">键 ≈ 列,null ≈ NULL</text>
<text x="20" y="254" fill="var(--ink-faint)" font-size="11">区别:表的列和类型由 CREATE TABLE 约束,每行都有全部的列;数据在磁盘文件里,重启不丢。</text>
</g>
</svg>
<figcaption>琥珀色是表头,也就是 schema;下面每一行是一个客户。右边是你熟悉的写法,概念一一对应,差别在于约束和持久化。</figcaption>
</figure>

## 第 3 步:SELECT,把数据取出来

**SELECT** 是 SQL 里用得最多的语句,意思是「查询」。最简单的形式:

```sql
SELECT * FROM customers;
```

<div class="line-notes">

- `SELECT * FROM customers;` 从 `customers` 表里取出所有列(`*` 表示所有列)、所有行。读法:「select 星 from customers」。

</div>

不进交互界面也能执行一条 SQL:把它作为第二个参数传给 sqlite3。顺便加一个 `-box` 参数,让结果画成表格:

```bash
cd part01/sql
sqlite3 -box practice.db "SELECT * FROM customers;"
```

<div class="line-notes">

- `cd part01/sql` 后面的命令都在这个目录里跑,数据库路径能短一点。
- `sqlite3 -box practice.db "SELECT * FROM customers;"` `-box` 用方框字符画表格。SQL 用双引号包起来交给 shell,SQL 内部的字符串用单引号,两种引号正好不冲突。

</div>

我这台 3.39.5 的实跑输出:

```text
┌────┬─────────┬─────────┬───────────────────────────┬──────┬───────┬──────┬────────────┐
│ id │ company │ contact │           email           │ plan │ seats │ city │ created_at │
├────┼─────────┼─────────┼───────────────────────────┼──────┼───────┼──────┼────────────┤
│ 1  │ 星河餐饮    │ 王伟      │ wangwei@xinghe.example    │ 专业版  │ 12    │ 杭州   │ 2025-03-14 │
│ 2  │ 青木设计    │ 李芳      │ lifang@qingmu.example     │ 基础版  │ 3     │ 上海   │ 2025-06-02 │
│ 3  │ 远山物流    │ 张磊      │ zhanglei@yuanshan.example │ 企业版  │ 85    │ 成都   │ 2024-11-20 │
│ 4  │ 蓝鲸教育    │ 刘洋      │                           │ 专业版  │ 20    │ 北京   │ 2025-01-08 │
│ 5  │ 启明科技    │ 陈静      │ chenjing@qiming.example   │ 企业版  │ 140   │ 深圳   │ 2024-08-30 │
│ 6  │ 禾丰农业    │ 杨勇      │ yangyong@hefeng.example   │ 基础版  │ 5     │      │ 2025-09-12 │
│ 7  │ 半岛咖啡    │ 黄敏      │ huangmin@bandao.example   │ 基础版  │ 2     │ 青岛   │ 2026-02-19 │
│ 8  │ 云杉律所    │ 赵杰      │ zhaojie@yunshan.example   │ 专业版  │ 18    │ 上海   │ 2025-11-03 │
│ 9  │ 北辰贸易    │ 吴涛      │ wutao@beichen.example     │ 专业版  │ 9     │ 天津   │ 2026-04-27 │
│ 10 │ 小满花店    │ 周霞      │ zhouxia@xiaoman.example   │ 基础版  │ 1     │ 杭州   │ 2026-07-15 │
└────┴─────────┴─────────┴───────────────────────────┴──────┴───────┴──────┴────────────┘
```

十行全在。有两件事要说。

一是**中文列对不齐**。这个老版本按「字符个数」算列宽,可一个汉字在终端里占两个英文字符宽,于是含中文的列都往右凸出来。SQLite 的更新日志里有一条「box 和 column 模式处理双宽字符」的改进,新版本可能已经对齐了,以你自己的实跑为准。数据本身没有问题。为了在文章里好看,下面我改用 `-header`:每行的值用 `|` 隔开,第一行是列名,不画框,也就不存在对不齐。

二是 **NULL 显示成了空白**:4 号的邮箱、6 号的城市。光看分不出是 NULL 还是空字符串。想看清楚可以加 `-nullvalue NULL`,让 NULL 显示成字面上的 `NULL`。

真实工作里很少 `SELECT *`,通常只要几列:

```bash
sqlite3 -header practice.db "SELECT company, plan, seats FROM customers;"
sqlite3 -header practice.db "SELECT count(*) FROM customers;"
```

<div class="line-notes">

- `SELECT company, plan, seats FROM customers;` 列名用逗号隔开,结果的列按你写的顺序排。这一步叫**投影**,只拿需要的列,和 Day 80 只挑几个字段返回给前端是一个道理。
- `SELECT count(*) FROM customers;` `count(*)` 是一个**聚合函数**,数有几行。Day 88 专门讲聚合,这里先用它确认数据都进去了。

</div>

实跑输出:

```text
company|plan|seats
星河餐饮|专业版|12
青木设计|基础版|3
远山物流|企业版|85
蓝鲸教育|专业版|20
启明科技|企业版|140
禾丰农业|基础版|5
半岛咖啡|基础版|2
云杉律所|专业版|18
北辰贸易|专业版|9
小满花店|基础版|1
count(*)
10
```

列名不存在、表名写错,各是什么报错,也看一眼:

```bash
sqlite3 -header practice.db "SELECT compnay FROM customers;"
sqlite3 -header practice.db "SELECT company, seats FROM customer;"
```

实跑输出:

```text
Error: in prepare, no such column: compnay
  SELECT compnay FROM customers;
         ^--- error here
Error: in prepare, no such table: customer
```

`no such column` 和 `no such table`,一眼就能看懂。表名少了个 s 是我自己最常犯的。

## 第 4 步:WHERE,只要满足条件的行

`WHERE` 后面写一个条件,只有让条件为真的行才会被选出来。相当于 JS 的 `filter`,或者 Day 23 列表推导式里的 `if`。

```bash
sqlite3 -header practice.db "SELECT company, plan, seats FROM customers WHERE plan = '专业版';"
sqlite3 -header practice.db "SELECT company, seats FROM customers WHERE seats >= 20;"
```

<div class="line-notes">

- `WHERE plan = '专业版';` 判断相等用**一个等号** `=`,不是 Python/JS 的 `==`(SQLite 其实也认 `==`,但标准 SQL 和 Postgres 只认 `=`,养成写一个的习惯)。字符串用单引号。
- `WHERE seats >= 20;` 数字比较:`>`、`>=`、`<`、`<=`;不等于写 `!=` 或 `<>`,两个都行。

</div>

实跑输出:

```text
company|plan|seats
星河餐饮|专业版|12
蓝鲸教育|专业版|20
云杉律所|专业版|18
北辰贸易|专业版|9
company|seats
远山物流|85
蓝鲸教育|20
启明科技|140
```

多个条件用 `AND`(并且)和 `OR`(或者)组合,≈JS 的 `&&` 和 `||`。同一列「等于这几个值之一」可以用 `IN`:

```bash
sqlite3 -header practice.db "SELECT company, plan, city FROM customers WHERE plan = '基础版' AND city = '杭州';"
sqlite3 -header practice.db "SELECT company, plan, city FROM customers WHERE city = '上海' OR city = '杭州';"
sqlite3 -header practice.db "SELECT company, plan, city FROM customers WHERE city IN ('上海', '杭州');"
```

<div class="line-notes">

- `WHERE plan = '基础版' AND city = '杭州';` 两个条件都满足。
- `WHERE city = '上海' OR city = '杭州';` 满足一个就行。
- `WHERE city IN ('上海', '杭州');` 和上一句完全等价,值多的时候省事得多,≈JS 的 `['上海', '杭州'].includes(city)`。

</div>

实跑输出:

```text
company|plan|city
小满花店|基础版|杭州
company|plan|city
星河餐饮|专业版|杭州
青木设计|基础版|上海
云杉律所|专业版|上海
小满花店|基础版|杭州
company|plan|city
星河餐饮|专业版|杭州
青木设计|基础版|上海
云杉律所|专业版|上海
小满花店|基础版|杭州
```

后两条结果一模一样。

### AND 比 OR 先算

需求:「上海的专业版或企业版客户」。直觉写法:

```bash
sqlite3 -header practice.db "SELECT company, plan, city FROM customers WHERE plan = '专业版' OR plan = '企业版' AND city = '上海';"
```

实跑输出:

```text
company|plan|city
星河餐饮|专业版|杭州
蓝鲸教育|专业版|北京
云杉律所|专业版|上海
北辰贸易|专业版|天津
```

杭州、北京、天津都混进来了。原因和 JS 里 `a || b && c` 一样:**AND 的优先级比 OR 高**,所以这句实际上是 `plan = '专业版' OR (plan = '企业版' AND city = '上海')`,意思变成了「所有专业版,外加上海的企业版」。上海没有企业版客户,于是剩下的是所有专业版。加括号:

```bash
sqlite3 -header practice.db "SELECT company, plan, city FROM customers WHERE (plan = '专业版' OR plan = '企业版') AND city = '上海';"
```

实跑输出:

```text
company|plan|city
云杉律所|专业版|上海
```

这才对。**AND 和 OR 混用时一律加括号**,别指望自己或者读代码的人记得优先级。更省事的写法是 `plan IN ('专业版', '企业版') AND city = '上海'`,根本不会有歧义。

### LIKE:模糊匹配

```bash
sqlite3 -header practice.db "SELECT company FROM customers WHERE company LIKE '%咖啡%';"
sqlite3 -header practice.db "SELECT company, email FROM customers WHERE email LIKE '%XINGHE%';"
sqlite3 -header practice.db "SELECT company, email FROM customers WHERE email = 'WANGWEI@xinghe.example';"
```

<div class="line-notes">

- `WHERE company LIKE '%咖啡%';` `%` 匹配任意多个(包括零个)字符。`'%咖啡%'` 就是「包含咖啡」,≈JS 的 `company.includes('咖啡')`。`'咖啡%'` 是以咖啡开头,`'%咖啡'` 是以咖啡结尾。另有 `_` 匹配正好一个字符。
- `WHERE email LIKE '%XINGHE%';` 用大写去模糊匹配小写的邮箱。
- `WHERE email = 'WANGWEI@xinghe.example';` 用大写去精确匹配。

</div>

实跑输出:

```text
company
半岛咖啡
company|email
星河餐饮|wangwei@xinghe.example
```

第三条什么都没有输出(一行结果都没有时,`-header` 连列名都不打)。SQLite 里 **`LIKE` 对英文字母不区分大小写,`=` 区分**。这一点不同数据库不一样,Postgres 的 `LIKE` 是区分大小写的,不区分要用 `ILIKE`。用户输入的邮箱经常大小写混着来,存之前统一转成小写是更稳的做法。

### NULL:它不等于任何东西,包括它自己

找出没填邮箱的客户。按直觉写 `= NULL`:

```bash
sqlite3 -header practice.db "SELECT id, company, email FROM customers WHERE email = NULL;"
sqlite3 -header practice.db "SELECT id, company, email FROM customers WHERE email IS NULL;"
```

实跑输出:

```text
id|company|email
4|蓝鲸教育|
```

第一条什么都没有,没有报错,就是空的。第二条才找到 4 号。

原因是 SQL 里的 NULL 表示「不知道」。「不知道的值等于 NULL 吗?」答案还是「不知道」,而 WHERE 只留下答案为「真」的行,「不知道」不算真,所以一行都选不出来。判断是不是 NULL 只能用 **`IS NULL`**,反过来是 **`IS NOT NULL`**。

这个规则还有一个更隐蔽的后果。找「不在上海的客户」:

```bash
sqlite3 -header practice.db "SELECT id, company FROM customers WHERE city != '上海';"
```

实跑输出:

```text
id|company
1|星河餐饮
3|远山物流
4|蓝鲸教育
5|启明科技
7|半岛咖啡
9|北辰贸易
10|小满花店
```

10 个客户,上海有 2 个,应该剩 8 个,这里只有 7 个。**6 号禾丰农业不见了**:它的城市是 NULL,「不知道的城市不等于上海吗?」还是「不知道」,被筛掉了。这种 bug 不报错,数字只是差了一点点,很难发现。练习 4 让你把它找回来。

<figure>
<svg viewBox="0 0 640 200" role="img" aria-label="NULL 的比较结果:city 等于上海、不等于上海、IS NULL 三种条件对 NULL 行的判断">
<rect x="0" y="0" width="640" height="200" fill="var(--paper-raised)" rx="6"/>
<g font-family="var(--font-mono)" font-size="12">
<text x="20" y="28" fill="var(--ink)">city 的值</text>
<text x="170" y="28" fill="var(--ink)">city = '上海'</text>
<text x="320" y="28" fill="var(--ink)">city != '上海'</text>
<text x="480" y="28" fill="var(--ink)">city IS NULL</text>
<line x1="20" y1="38" x2="620" y2="38" stroke="var(--rule)"/>
<text x="20" y="64" fill="var(--ink-soft)">'上海'</text>
<text x="170" y="64" fill="var(--compute)">真 → 留</text>
<text x="320" y="64" fill="var(--ink-faint)">假 → 丢</text>
<text x="480" y="64" fill="var(--ink-faint)">假 → 丢</text>
<text x="20" y="94" fill="var(--ink-soft)">'杭州'</text>
<text x="170" y="94" fill="var(--ink-faint)">假 → 丢</text>
<text x="320" y="94" fill="var(--compute)">真 → 留</text>
<text x="480" y="94" fill="var(--ink-faint)">假 → 丢</text>
<rect x="14" y="106" width="612" height="30" fill="var(--mem-wash)" stroke="var(--mem)" rx="3"/>
<text x="20" y="126" fill="var(--ink)">NULL</text>
<text x="170" y="126" fill="var(--ink)">不知道 → 丢</text>
<text x="320" y="126" fill="var(--ink)">不知道 → 丢</text>
<text x="480" y="126" fill="var(--compute)">真 → 留</text>
<text x="20" y="166" fill="var(--ink-soft)" font-size="11">WHERE 只留「真」的行。NULL 和任何值比较(包括 = NULL)都得到「不知道」,</text>
<text x="20" y="184" fill="var(--ink-soft)" font-size="11">所以 = 和 != 两边都会把它丢掉,只有 IS NULL / IS NOT NULL 能正面回答。</text>
</g>
</svg>
<figcaption>蓝色那一行是坑所在:NULL 在 `=` 和 `!=` 下都被丢掉,两个条件加起来并不是「全部」。</figcaption>
</figure>

### 字符串要用单引号

在 SQL 里,**单引号是字符串,双引号是名字**(表名、列名)。写成双引号会怎样?

```bash
sqlite3 -header practice.db 'SELECT company, plan FROM customers WHERE plan = "plan";'
```

<div class="line-notes">

- `sqlite3 -header practice.db 'SELECT company, plan FROM customers WHERE plan = "plan";'` 这次外面换成单引号,里面才能写双引号。`"plan"` 本意是想查「套餐叫 plan 的客户」(当然一个都不该有)。

</div>

实跑输出:

```text
company|plan
星河餐饮|专业版
青木设计|基础版
远山物流|企业版
蓝鲸教育|专业版
启明科技|企业版
禾丰农业|基础版
半岛咖啡|基础版
云杉律所|专业版
北辰贸易|专业版
小满花店|基础版
```

十行全出来了。`"plan"` 被当成了**列名** plan,条件变成「plan 列等于 plan 列」,每一行都成立。如果双引号里写的东西不是列名,比如 `"专业版"`,SQLite 为了兼容老代码会退一步把它当成字符串,结果又碰巧是对的,于是你永远发现不了这个习惯有问题,直到某天字符串正好和某个列同名。SQLite 官方文档的「怪癖」一页专门把这一条列为历史遗留的设计失误。Postgres 不会退这一步,直接报 `column "专业版" does not exist`。**字符串一律单引号。**

还有一种引号错误是少了一个:

```bash
sqlite3 -header practice.db "SELECT company FROM customers WHERE plan = '专业版"
```

实跑输出:

```text
Error: in prepare, unrecognized token: "'专业版"
  SELECT company FROM customers WHERE plan = '专业版
                               error here ---^
```

`unrecognized token` 加一个以单引号开头的片段,基本就是字符串没闭合。在交互界面里少写一个引号,表现是提示符一直是 `   ...>`,输什么都没反应,因为它以为你的字符串还没写完;输入一个 `'` 再加 `;` 回车,就能跳出来。

## 第 5 步:ORDER BY 和 LIMIT

`ORDER BY` 按某一列排序,默认从小到大(`ASC`,ascending),加 `DESC`(descending)从大到小。`LIMIT n` 只要前 n 行。合起来就是最常见的「前几名」查询:

```bash
sqlite3 -header practice.db "SELECT company, seats FROM customers ORDER BY seats DESC LIMIT 3;"
sqlite3 -header practice.db "SELECT company, created_at FROM customers ORDER BY created_at LIMIT 3;"
sqlite3 -header practice.db "SELECT company, plan, seats FROM customers ORDER BY plan, seats DESC;"
```

<div class="line-notes">

- `ORDER BY seats DESC LIMIT 3;` 席位最多的三家。
- `ORDER BY created_at LIMIT 3;` 最早签约的三家。日期存成 `2024-08-30` 这种「年-月-日、位数固定」的文本,按字符串从小到大排,正好就是时间先后。如果存成 `8/30/2024`,字符串排序就全乱了。
- `ORDER BY plan, seats DESC;` 先按 plan 排,plan 相同的再按 seats 从大到小。`DESC` 只管紧挨着它的那一列,`plan` 还是从小到大。

</div>

实跑输出:

```text
company|seats
启明科技|140
远山物流|85
蓝鲸教育|20
company|created_at
启明科技|2024-08-30
远山物流|2024-11-20
蓝鲸教育|2025-01-08
company|plan|seats
蓝鲸教育|专业版|20
云杉律所|专业版|18
星河餐饮|专业版|12
北辰贸易|专业版|9
启明科技|企业版|140
远山物流|企业版|85
禾丰农业|基础版|5
青木设计|基础版|3
半岛咖啡|基础版|2
小满花店|基础版|1
```

第三条里套餐的顺序是专业版、企业版、基础版。既不是按业务上「基础 → 专业 → 企业」,也不是按拼音(拼音是 jī、qǐ、zhuān,应该基础版在前)。SQLite 默认按字符的 Unicode 编码排序,我查了一下这三个字的编码:

```bash
sqlite3 practice.db "SELECT plan, unicode(plan) FROM customers GROUP BY plan ORDER BY plan;"
```

<div class="line-notes">

- `SELECT plan, unicode(plan)` `unicode(...)` 返回字符串第一个字符的编码数字。`GROUP BY plan` 把相同的 plan 合成一行,这样每种套餐只出现一次。分组是 Day 88 的内容,这里借来用一下。

</div>

实跑输出:

```text
专业版|19987
企业版|20225
基础版|22522
```

「专」19987 最小,「基」22522 最大,所以排出来就是这个顺序。和 JS 里 `['基础版','专业版','企业版'].sort()` 得到的顺序一样,JS 默认排序也是比编码。想按业务顺序排,要么存一个数字列(比如 `plan_level` 1/2/3)按它排,要么用 Day 88 之后会见到的 `CASE` 表达式。城市按 `ORDER BY city` 排出来也是「上海、北京、天津、成都、杭州、深圳、青岛」这种看起来毫无规律的顺序,原因相同。

NULL 排在哪?

```bash
sqlite3 -header practice.db "SELECT company, city FROM customers ORDER BY city;"
```

实跑输出:

```text
company|city
禾丰农业|
青木设计|上海
云杉律所|上海
蓝鲸教育|北京
北辰贸易|天津
远山物流|成都
星河餐饮|杭州
小满花店|杭州
启明科技|深圳
半岛咖啡|青岛
```

SQLite 把 NULL 当成最小的值,从小到大排时它在最前面。Postgres 正好相反,默认放在最后。两边都可以用 `NULLS FIRST` / `NULLS LAST` 明确指定,写跨数据库的代码时最好写明。

分页用 `LIMIT` 加 `OFFSET`(跳过前几行):

```bash
sqlite3 -header practice.db "SELECT company, seats FROM customers ORDER BY seats DESC LIMIT 3 OFFSET 3;"
```

实跑输出:

```text
company|seats
云杉律所|18
星河餐饮|12
北辰贸易|9
```

跳过前三名,取第 4 到第 6 名。Day 79 给工单接口写过 `limit` 查询参数,到了数据库这一层就是这个 `LIMIT`。

### 子句的顺序是固定的

把 WHERE、ORDER BY、LIMIT 放进同一句:

```bash
sqlite3 -header practice.db "SELECT company, seats FROM customers WHERE plan = '专业版' ORDER BY seats DESC LIMIT 2;"
sqlite3 -header practice.db "SELECT company, seats FROM customers LIMIT 2 WHERE plan = '专业版';"
```

实跑输出:

```text
company|seats
蓝鲸教育|20
云杉律所|18
Error: in prepare, near "WHERE": syntax error
  SELECT company, seats FROM customers LIMIT 2 WHERE plan = '专业版';
                                 error here ---^
```

第二条把 LIMIT 写到了 WHERE 前面,语法错误。SELECT 的各个子句**必须按固定顺序写**:

```text
SELECT 列 FROM 表 WHERE 条件 ORDER BY 排序 LIMIT 数量
```

但数据库**执行**的顺序和写的顺序不一样,理解了执行顺序,很多规则就不用死记了:

<figure>
<svg viewBox="0 0 640 210" role="img" aria-label="SELECT 的书写顺序和执行顺序:写的时候 SELECT 在最前,执行时先 FROM、再 WHERE、再 SELECT、再 ORDER BY、最后 LIMIT,并和 JS 数组方法对照">
<rect x="0" y="0" width="640" height="210" fill="var(--paper-raised)" rx="6"/>
<g font-family="var(--font-mono)" font-size="12">
<text x="20" y="26" fill="var(--ink)">执行顺序</text>
<rect x="20" y="40" width="100" height="44" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="70" y="60" fill="var(--ink)" text-anchor="middle">① FROM</text>
<text x="70" y="76" fill="var(--ink-soft)" text-anchor="middle" font-size="11">拿到整张表</text>
<rect x="145" y="40" width="100" height="44" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="195" y="60" fill="var(--ink)" text-anchor="middle">② WHERE</text>
<text x="195" y="76" fill="var(--ink-soft)" text-anchor="middle" font-size="11">筛行</text>
<rect x="270" y="40" width="100" height="44" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="320" y="60" fill="var(--ink)" text-anchor="middle">③ SELECT</text>
<text x="320" y="76" fill="var(--ink-soft)" text-anchor="middle" font-size="11">取列、算表达式</text>
<rect x="395" y="40" width="100" height="44" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="445" y="60" fill="var(--ink)" text-anchor="middle">④ ORDER BY</text>
<text x="445" y="76" fill="var(--ink-soft)" text-anchor="middle" font-size="11">排序</text>
<rect x="520" y="40" width="100" height="44" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="570" y="60" fill="var(--ink)" text-anchor="middle">⑤ LIMIT</text>
<text x="570" y="76" fill="var(--ink-soft)" text-anchor="middle" font-size="11">截前几行</text>
<line x1="120" y1="62" x2="145" y2="62" stroke="var(--rule)" stroke-width="2"/>
<line x1="245" y1="62" x2="270" y2="62" stroke="var(--rule)" stroke-width="2"/>
<line x1="370" y1="62" x2="395" y2="62" stroke="var(--rule)" stroke-width="2"/>
<line x1="495" y1="62" x2="520" y2="62" stroke="var(--rule)" stroke-width="2"/>
<text x="20" y="118" fill="var(--ink)">JS 对照</text>
<rect x="20" y="128" width="600" height="34" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="30" y="150" fill="var(--ink)">customers.filter(…).map(c =&gt; ({…})).sort(…).slice(0, n)</text>
<text x="20" y="188" fill="var(--ink-soft)" font-size="11">写法顺序:SELECT 列 FROM 表 WHERE 条件 ORDER BY 列 LIMIT n(不能换)</text>
</g>
</svg>
<figcaption>数据库先确定从哪张表拿、筛掉哪些行,再决定要哪些列,最后排序和截断。和 JS 的数组方法链一一对应,只是 SQL 规定了「写的时候 SELECT 放最前面」。</figcaption>
</figure>

从这张图能推出两条规则:WHERE 先于 SELECT 执行,所以 **WHERE 里不能用 SELECT 里起的别名**;ORDER BY 在 SELECT 之后,所以 **ORDER BY 可以用别名**。试一下别名和计算列:

```bash
sqlite3 -header practice.db "SELECT company AS 公司, seats * 99 AS 月费 FROM customers WHERE plan = '专业版' ORDER BY 月费 DESC;"
```

<div class="line-notes">

- `SELECT company AS 公司, seats * 99 AS 月费` `AS` 给结果列起别名,结果的表头就变成了「公司」「月费」。`seats * 99` 是**计算列**:假设专业版每席位每月 99 元,直接在 SELECT 里乘出来,表里并没有这一列。`ORDER BY 月费 DESC` 按别名排序,能用,因为 ORDER BY 在 SELECT 之后执行。

</div>

实跑输出:

```text
公司|月费
蓝鲸教育|1980
云杉律所|1782
星河餐饮|1188
北辰贸易|891
```

蓝鲸教育 20 席 × 99 = 1980,对得上。

## 和前端代码对照

最后把今天的一条完整查询和 JS 写法放在一起。「专业版里席位最多的两家,只要公司名和席位」:

| SQL | JS(数组 `customers`) | Python(Day 23 的推导式) |
| --- | --- | --- |
| `FROM customers` | `customers` | `customers` |
| `WHERE plan = '专业版'` | `.filter(c => c.plan === '专业版')` | `[c for c in customers if c["plan"] == "专业版"]` |
| `SELECT company, seats` | `.map(c => ({company: c.company, seats: c.seats}))` | `{"company": c["company"], "seats": c["seats"]}` |
| `ORDER BY seats DESC` | `.sort((a, b) => b.seats - a.seats)` | `sorted(..., key=lambda c: c["seats"], reverse=True)` |
| `LIMIT 2` | `.slice(0, 2)` | `[:2]` |

做的事情一样,差别在于:JS 和 Python 要先把全部数据读进内存再一步步处理,SQL 是把「要什么」告诉数据库,由它在磁盘上直接找。10 行看不出区别,一百万行的时候差别就出来了,Day 89 讲索引时会实测。

## 动手练习

**练习 1:2025 年签约的客户。** 查出 2025 年内(1 月 1 日到 12 月 31 日)签约的所有客户的公司名和签约日期,按日期从早到晚排。至少写出两种不同的 WHERE。

<details><summary>参考答案</summary>

```bash
sqlite3 -header practice.db "SELECT company, created_at FROM customers WHERE created_at BETWEEN '2025-01-01' AND '2025-12-31' ORDER BY created_at;"
sqlite3 -header practice.db "SELECT company, created_at FROM customers WHERE created_at LIKE '2025-%' ORDER BY created_at;"
```

<div class="line-notes">

- `WHERE created_at BETWEEN '2025-01-01' AND '2025-12-31'` `BETWEEN a AND b` 等于 `>= a AND <= b`,**两头都包含**。日期是固定格式的文本,字符串比较大小正好就是时间先后。
- `WHERE created_at LIKE '2025-%'` 以 `2025-` 开头的。更直观,但下面说它的缺点。

</div>

两条的实跑输出相同:

```text
company|created_at
蓝鲸教育|2025-01-08
星河餐饮|2025-03-14
青木设计|2025-06-02
禾丰农业|2025-09-12
云杉律所|2025-11-03
```

5 家。两种写法我更推荐 `BETWEEN`(或者 `>= '2025-01-01' AND < '2026-01-01'`):Day 89 会讲到,对日期列建了索引以后,范围比较能用上索引,而某些 `LIKE` 写法用不上。另外要当心,如果以后 `created_at` 存的是带时间的 `2025-12-31 15:30:00`,`BETWEEN ... AND '2025-12-31'` 会把 12 月 31 日当天下午的记录漏掉,因为 `'2025-12-31 15:30:00'` 比 `'2025-12-31'` 大。写成 `< '2026-01-01'` 就没有这个问题。

</details>

**练习 2:资料不全的客户。** 运营要给资料不全的客户发提醒:查出邮箱**或者**城市没填的客户,显示 id、公司、邮箱、城市。

<details><summary>参考答案</summary>

```bash
sqlite3 -header practice.db "SELECT id, company, email, city FROM customers WHERE email IS NULL OR city IS NULL;"
```

<div class="line-notes">

- `WHERE email IS NULL OR city IS NULL;` 判断 NULL 只能用 `IS NULL`。写成 `email = NULL OR city = NULL` 会是空结果。

</div>

实跑输出:

```text
id|company|email|city
4|蓝鲸教育||北京
6|禾丰农业|yangyong@hefeng.example|
```

4 号缺邮箱,6 号缺城市。注意 4 号连邮箱都没有,真要「发提醒」只能打电话找刘洋了。

</details>

**练习 3:第二名。** 在专业版和企业版客户里,找出席位数**第二多**的那一家。

<details><summary>参考答案</summary>

```bash
sqlite3 -header practice.db "SELECT company, plan, seats FROM customers WHERE plan IN ('专业版', '企业版') ORDER BY seats DESC LIMIT 1 OFFSET 1;"
```

<div class="line-notes">

- `WHERE plan IN ('专业版', '企业版')` 先筛出两种套餐。`ORDER BY seats DESC LIMIT 1 OFFSET 1` 从大到小排,跳过第一名,取一个。

</div>

实跑输出:

```text
company|plan|seats
远山物流|企业版|85
```

第一名是启明科技 140 席,第二名远山物流 85 席。如果有两家并列第一,这个写法会把并列的另一家当成「第二名」,题目没要求处理并列,真实需求里要先问清楚「并列怎么算」。

</details>

**练习 4(观察题):把禾丰农业找回来。** 第 4 步「不在上海的客户」少了 6 号禾丰农业。改写查询,让城市没填的客户也算「不在上海」,应该得到 8 行。

<details><summary>参考答案</summary>

```bash
sqlite3 -header practice.db "SELECT id, company, city FROM customers WHERE city != '上海' OR city IS NULL;"
```

<div class="line-notes">

- `WHERE city != '上海' OR city IS NULL;` 把 NULL 的情况单独补上。对 6 号来说,`city != '上海'` 是「不知道」,`city IS NULL` 是「真」,「不知道 OR 真」结果是「真」,于是留下来了。

</div>

实跑输出:

```text
id|company|city
1|星河餐饮|杭州
3|远山物流|成都
4|蓝鲸教育|北京
5|启明科技|深圳
6|禾丰农业|
7|半岛咖啡|青岛
9|北辰贸易|天津
10|小满花店|杭州
```

8 行。每次对一个**允许 NULL 的列**写 `!=`、`NOT IN` 时,都问自己一句:NULL 的行要不要?要就补一个 `OR ... IS NULL`。

</details>

**练习 5(观察题):约束在起作用。** 把 `customers.sql` 复制一份叫 `strict_try.sql`,把 `email` 那一列改成 `TEXT NOT NULL`,用它建一个新库 `try.db`。观察报错,然后查 `try.db` 里有几个客户,解释为什么。做完删掉这两个文件。

<details><summary>参考答案</summary>

```bash
sed 's/email       TEXT,/email       TEXT    NOT NULL,/' customers.sql > strict_try.sql
grep -n 'email ' strict_try.sql
sqlite3 try.db < strict_try.sql; echo "exit=$?"
sqlite3 try.db "SELECT count(*) FROM customers;"
rm try.db strict_try.sql
```

<div class="line-notes">

- `sed 's/email       TEXT,/email       TEXT    NOT NULL,/' customers.sql > strict_try.sql` `sed` 按「s/旧/新/」替换文本,结果重定向到新文件(Day 5 的 `>`)。手动复制再用编辑器改也一样。
- `grep -n 'email ' strict_try.sql` 确认改上了。
- `sqlite3 try.db < strict_try.sql; echo "exit=$?"` 执行,再打印退出码。
- `sqlite3 try.db "SELECT count(*) FROM customers;"` 数一下进去了几行。

</div>

实跑输出:

```text
8:    email       TEXT    NOT NULL,
Runtime error near line 15: NOT NULL constraint failed: customers.email (19)
exit=1
0
```

`NOT NULL constraint failed: customers.email`:4 号蓝鲸教育的邮箱是 NULL,违反了约束。`near line 15` 指的是 `INSERT` 那条语句开始的行。有意思的是最后那个 **0**:表建好了,但**一个客户都没进去**,连排在 4 号前面、完全合法的 1 到 3 号也没有。因为这 10 行是**同一条** `INSERT` 语句插的,一条语句要么全部成功,要么全部不生效,不会插一半。这是数据库「事务」的一个最小体现,Day 91 会专门讲。

约束的意义就在这:规则写进表结构里以后,不管是谁、用什么程序往里写,都绕不过去。和 Day 80 用 pydantic 在接口层挡住坏数据是同一个思路,只是这一道防线在数据库里,是最后一道。

</details>

**验收标准:** `part01/sql/customers.sql` 能反复执行,每次都得到 10 行;能不看文章写出 `customers` 的 `CREATE TABLE`;能写出「某套餐的客户」「席位前 N 名」「某城市或某几个城市」「某列为空」「某日期范围,按日期排序」这五类查询并得到正确结果;能说清 `= NULL` 为什么查不到、`!=` 为什么会漏行、字符串为什么要单引号、中文为什么不按拼音排。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 数据库 | 把数据持久存在磁盘上、并能按条件高效查询的程序 |
| SQL | 和数据库对话的语言,只写「要什么」,不写「怎么找」 |
| SQLite | 没有服务进程、整个库就是一个文件的数据库,macOS 自带 `sqlite3` 命令行 |
| 表(table) | 数据库里存数据的地方,≈对象数组 |
| 行(row) | 表里的一条记录,≈数组里的一个对象 |
| 列(column) | 表的一个字段,有名字和类型,≈对象的键 |
| schema | 表结构的定义:有哪些表、哪些列、什么类型和约束,`.schema` 查看 |
| `CREATE TABLE` | 建表语句 |
| `DROP TABLE IF EXISTS` | 删表(连数据),不存在也不报错 |
| `INTEGER` / `TEXT` | SQLite 的整数类型 / 文本类型 |
| 主键(PRIMARY KEY) | 每行唯一的编号列;SQLite 里 `INTEGER PRIMARY KEY` 不给值会自动编号 |
| 约束(constraint) | 写在表结构里的规则,如 `NOT NULL`、`PRIMARY KEY`,违反了语句就失败 |
| `NOT NULL` | 这一列不能没有值 |
| NULL | 「没有值 / 不知道」,不是空字符串也不是 0;和任何值比较结果都是「不知道」 |
| `IS NULL` / `IS NOT NULL` | 判断是不是 NULL 的唯一正确写法 |
| 点命令 | sqlite3 工具自己的命令,以 `.` 开头,不用分号,如 `.tables`、`.schema`、`.quit` |
| `SELECT` | 查询语句,从表里取数据 |
| `*` | 所有列 |
| `WHERE` | 筛选行的条件,≈`filter` |
| `AND` / `OR` | 并且 / 或者,AND 优先级更高,混用要加括号 |
| `IN (...)` | 等于括号里的任意一个值 |
| `LIKE` | 模糊匹配,`%` 任意多个字符、`_` 一个字符;SQLite 里对英文不区分大小写 |
| `BETWEEN a AND b` | `>= a AND <= b`,两头都包含 |
| `ORDER BY ... ASC/DESC` | 按列排序,默认从小到大 |
| `LIMIT n OFFSET m` | 跳过 m 行后取 n 行,用于「前几名」和分页 |
| 别名(`AS`) | 给结果列起名字;ORDER BY 能用,WHERE 不能用 |
| 计算列 | SELECT 里用表达式算出来的列,如 `seats * 99`,表里并不存在 |
| `count(*)` | 数行数的聚合函数,Day 88 细讲 |

## 常见误区

**用 `= NULL` 判断空值。** 不报错,结果永远是空的。用 `IS NULL`。

**对可空的列写 `!=` 或 `NOT IN`。** NULL 的行会被悄悄丢掉,实测「不在上海」少了禾丰农业。需要它们时补 `OR 列 IS NULL`。

**字符串用双引号。** SQLite 里双引号是名字,`WHERE plan = "plan"` 实测返回全部 10 行。字符串一律单引号。

**AND 和 OR 混用不加括号。** AND 先算,实测查「上海的专业版或企业版」混进了杭州、北京、天津。加括号,或者改用 `IN`。

**以为中文会按拼音排。** 实测按 Unicode 编码排,套餐顺序是专业、企业、基础。业务顺序要存一个数字列来排。

**以为不同数据库行为都一样。** 今天就碰到三处:`LIKE` 是否区分大小写、NULL 排在前面还是后面、双引号里写字符串报不报错,SQLite 和 Postgres 都不同。换数据库时先查这几条。

**SQL 语句忘了分号。** 在交互界面里提示符变成 `   ...>` 一直等你,补一个 `;` 回车。

**子句顺序写乱。** `LIMIT` 写在 `WHERE` 前面是 `syntax error`。固定顺序:SELECT、FROM、WHERE、ORDER BY、LIMIT。

**日期存成 `8/30/2024` 这种格式。** 字符串排序和比较就全乱了。存 `YYYY-MM-DD`(带时间就是 `YYYY-MM-DD HH:MM:SS`),位数固定,字符串顺序就是时间顺序。

**把 `.db` 文件提交进 git。** 它是二进制文件,每次改动都是整个替换,还可能带着测试数据。提交生成它的 `.sql`,`.gitignore` 里加 `*.db`。

## 学习资料

### 文档与文章

- [SQLite 官方 · Command Line Shell For SQLite(英文)](https://sqlite.org/cli.html):`sqlite3` 命令行的全部点命令和启动参数(`-box`、`-header`、`-nullvalue`),今天用到的都在这里。
- [SQLite 官方 · SELECT(英文)](https://sqlite.org/lang_select.html):SELECT 的完整语法图。现在看会觉得很复杂,先找到今天学的 WHERE、ORDER BY、LIMIT 在图上的位置。
- [SQLite 官方 · CREATE TABLE(英文)](https://sqlite.org/lang_createtable.html):建表语法和各种约束。
- [SQLite 官方 · Quirks, Caveats, and Gotchas(英文)](https://sqlite.org/quirks.html):SQLite 的怪癖清单。「双引号字符串」那一条就是今天第 4 步的坑,还有「类型很宽松」等几条,明天会碰到。
- [SQLite 官方 · Datatypes In SQLite(英文)](https://sqlite.org/datatype3.html):SQLite 的类型系统和别的数据库很不一样,往 `INTEGER` 列里存文本它也不一定拦,这一页讲为什么。
- [SQLite 官方 · NULL Handling(英文)](https://sqlite.org/nulls.html):各种数据库处理 NULL 的差异对照表。
- [菜鸟教程 · SQLite 教程](https://www.runoob.com/sqlite/sqlite-tutorial.html):中文,一条命令一页,适合当速查手册。
- [SQLBolt(英文)](https://sqlbolt.com/):浏览器里直接练 SQL 的交互教程,前 4 课正好是今天的内容,每课有练习题,做错了当场告诉你。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1bQxMehETa&autoplay=0&high_quality=1" title="SQL 十四分钟速成班!没错不要怀疑,资料库语法比中午决定吃什么还要简单!" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>PAPAYA 电脑教室 · SQL 十四分钟速成班 · 约 14 分钟,播放 58 万。用一张示例表把 SELECT、WHERE、ORDER BY 演示了一遍,节奏快、图做得清楚,适合今天学之前先看一遍建立印象。后半段讲到的增删改和连表是 Day 86–87 的内容。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1Pw4m1k7uo&autoplay=0&high_quality=1" title="世界上装机量最大的数据库SQLite,低调但不小众" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>技术爬爬虾 · 世界上装机量最大的数据库 SQLite,低调但不小众 · 约 9 分钟,播放 26 万。讲 SQLite 为什么「一个文件就是一个数据库」、它适合和不适合什么场景,对应今天开头那一节。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/zsjvFFKOm3c" title="SQL Explained in 100 Seconds" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Fireship · SQL Explained in 100 Seconds · 英文,两分钟。SQL 是什么、表和查询长什么样,一口气讲完。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/27axs9dO7AE" title="What is SQL? [in 4 minutes for beginners]" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Danielle Thé · What is SQL? [in 4 minutes for beginners] · 英文,4 分钟。从「为什么不用 Excel」讲起,和今天「从前端看数据库」那一节是同一个角度。</figcaption>
</figure>

### 书籍

- Ben Forta,《SQL必知必会》(第 5 版),人民邮电出版社(原书 *Sams Teach Yourself SQL in 10 Minutes a Day*,5th ed.,2019)。很薄,每课十分钟,第 2–5 课正好是检索、排序、过滤,和今天一一对应。接下来五天的 SQL 课都可以拿它当配套练习。
- Alan Beaulieu,《Learning SQL》(第 3 版),O'Reilly,2020(英文)。比上一本系统,讲到了 NULL、排序规则这些今天点到为止的细节,想深入时再看。

### 开源项目与代码

- [sqlitebrowser/sqlitebrowser](https://github.com/sqlitebrowser/sqlitebrowser)([官网 DB Browser for SQLite](https://sqlitebrowser.org/)):开源的 SQLite 图形界面,能像 Excel 一样看表、点表头排序、写 SQL。命令行看着累的时候,用它打开 `practice.db` 对照着看,但练习请先用命令行写。
- [simonw/datasette](https://github.com/simonw/datasette)([官网](https://datasette.io/)):把一个 SQLite 文件变成可以在浏览器里浏览和查询的网站,作者是 Django 的联合创始人。看看 SQLite 在真实的数据工作里能被用到什么程度。

## 自测

1. SQLite 和 Day 77 那种后端服务(比如 uvicorn 起的工单服务)相比,最大的结构差别是什么?

<details><summary>答案</summary>

SQLite 没有服务进程,也不监听端口,整个数据库就是一个文件(今天的 `practice.db`),程序直接读写这个文件。Postgres、MySQL 这类数据库和工单服务一样,是一个一直在跑的进程,占一个端口(Postgres 默认 5432),程序通过网络连接去请求它。

</details>

2. 下面这句为什么查不到 4 号蓝鲸教育?怎么改?`SELECT * FROM customers WHERE email = NULL;`

<details><summary>答案</summary>

NULL 表示「不知道」,任何值和 NULL 比较(包括 `= NULL`)的结果都是「不知道」,WHERE 只留下结果为「真」的行,所以一行都选不出来。改成 `WHERE email IS NULL`。

</details>

3. `SELECT company FROM customers WHERE plan = '基础版' OR plan = '专业版' AND seats > 10;` 会返回哪些客户?想要的是「席位超过 10 的基础版或专业版」,应该怎么写?

<details><summary>答案</summary>

AND 先算,这句等于「所有基础版,外加席位超过 10 的专业版」,会返回 4 家基础版(青木设计、禾丰农业、半岛咖啡、小满花店)和 3 家超过 10 席的专业版(星河餐饮、蓝鲸教育、云杉律所)。想要的写法:`WHERE (plan = '基础版' OR plan = '专业版') AND seats > 10`,或者 `WHERE plan IN ('基础版', '专业版') AND seats > 10`,结果是星河餐饮、蓝鲸教育、云杉律所 3 家(基础版没有超过 10 席的)。

</details>

4. 为什么 `created_at` 存成 `'2025-03-14'` 这样的文本,`ORDER BY created_at` 就能按时间排对?存成 `'3/14/2025'` 会怎样?

<details><summary>答案</summary>

`YYYY-MM-DD` 是年在前、位数固定(月和日都补零),字符串从左往右逐个字符比较,先比年、再比月、再比日,正好就是时间先后。`'3/14/2025'` 先比的是月份的第一个字符,而且位数不固定,`'12/1/2024'` 会排在 `'3/14/2025'` 前面(因为 `'1'` 小于 `'3'`),`'10/...'` 又会排在 `'9/...'` 前面,顺序全乱。

</details>

5. 面试题:你在给一个客服 Agent 设计「查客户」工具,工具内部会拼一条 SQL 去查 customers 表。今天学到的哪些 SQL 细节会直接影响 Agent 拿到的结果是否正确?

<details><summary>答案</summary>

几条最直接的:可空列上的 `!=`、`NOT IN` 会漏掉 NULL 的行,Agent 回答「不在上海的客户有 7 家」其实是 8 家,而且没有报错,很难发现,所以工具里要么显式处理 NULL,要么在 schema 上尽量用 `NOT NULL`;字符串匹配的大小写规则因数据库而异(SQLite 的 `LIKE` 不区分英文大小写、`=` 区分,Postgres 的 `LIKE` 区分),用户说「查 XINGHE」时工具要统一大小写;排序规则是按编码不是按拼音或业务顺序,「按套餐等级排」要用数字列;`LIMIT` 一定要有,而且要配 `ORDER BY`,否则「前 5 个」是哪 5 个不确定,Agent 每次看到的可能不一样,上下文也可能被一次塞进几万行;AND/OR 混用要加括号。再往后还要考虑注入问题:SQL 不能靠字符串拼接用户输入,Day 92 讲参数化查询。

</details>

## 明天预告

Day 86 · SQL(二):INSERT、UPDATE 和 DELETE。今天的 10 个客户是用一个现成的 `INSERT` 灌进去的,而且只看不改。明天学怎么往表里加一行、改一行、删一行,以及 SQL 里最吓人的一个坑:`UPDATE` 或 `DELETE` 忘了写 `WHERE`,整张表一起被改掉。我们会故意在 `practice.db` 上犯一次这个错,再用今天的 `customers.sql` 把数据恢复回来,这也是为什么建表和数据要写成能反复执行的脚本。
