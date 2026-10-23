---
title: 'Day 86 · SQL(二):INSERT、UPDATE 和 DELETE'
description: '昨天的 customers 表只能看不能改。今天学三句改数据的 SQL:INSERT 加一行、UPDATE 改几行、DELETE 删几行,用真实报错认清约束、NULL 和类型宽松这几个坑,然后故意在没有 WHERE 的情况下把整张表改掉、删光,再用备份和脚本恢复。'
pubDate: 2026-10-23
regime: none
tags: ['sql', 'sqlite', 'database', 'agent-zero']
series: 'agent-zero'
day: 86
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 85](/blog/agent-zero/day-085-sql-1/) 用 macOS 自带的 `sqlite3` 建了 `practice.db`,里面有一张 `customers` 表、10 个客户,学了 `SELECT ... FROM ... WHERE ... ORDER BY ... LIMIT`,还踩了几个坑:`= NULL` 查不到空值,`!=` 会漏掉 NULL 的行,字符串要用单引号,中文按编码而不是拼音排序。那一天数据是用一个现成的脚本灌进去的,表只读不改。

真实的业务里数据天天在变:新客户签约要加一行,客户升级套餐要改一行,客户注销要删一行。今天学这三句,也就是 SQL 里「写」的那一半。写比读危险得多,读错了顶多是结果不对,写错了数据就变了,而且数据库不会问你「确定吗」。所以今天后半段会专门故意出一次事故,看清楚它是怎么发生的,以及怎么回头。

## 今天要解决的问题

学完今天,你应该能做到:

1. 用 `INSERT INTO ... (列名) VALUES (...)` 加一行或多行,说得清为什么要写列名,知道 `id` 不写会自动分配,看得懂三种常见的插入失败(缺必填列、主键重复、列数对不上)。
2. 用 `UPDATE ... SET ... WHERE ...` 改一行或一批行,用 `changes()` 确认到底改了几行,避开两个坑:`WHERE 列 = NULL` 一行都改不到、`SET a = 1 AND b = 2` 悄悄改坏数据。
3. 用 `DELETE FROM ... WHERE ...` 删行,并且亲眼看一次不带 `WHERE` 的 `UPDATE` 和 `DELETE` 会发生什么。
4. 会用 `.backup` / `.restore` 给数据库文件做备份和恢复,养成「改之前先用同样的 WHERE 跑一遍 SELECT」的习惯。

今天两个新概念:**写入语句**(INSERT、UPDATE、DELETE 三句)和**备份恢复**(出了事怎么回到改之前)。

预计用时:2.5 小时。花费 ¥0,不写 Python,只用终端。

前置:[Day 85](/blog/agent-zero/day-085-sql-1/) 的 `practice.db`、`customers.sql` 和 `WHERE`、`NULL`;[Day 5](/blog/agent-zero/day-005-terminal-3/) 的重定向 `<`;[Day 23](/blog/agent-zero/day-023-comprehensions/) 的列表推导式(对照用)。

学法:先对照文章逐行敲一遍(不复制粘贴)并跑通;第二天合上文章,默写 INSERT(带列名)、UPDATE 带 WHERE、DELETE 带 WHERE 各一句,再默写 `.backup`、`.restore` 两个命令;做练习,做不出再展开参考答案,看完关掉自己重写一遍。

## 先对照前端:三句话就是数组的三个动作

你在前端里改一个客户列表,无非三件事:

```js
customers.push({ company: '橙子健身', plan: '基础版' });                 // 加一行
customers.filter(c => c.id === 7).forEach(c => { c.plan = '专业版'; });   // 改满足条件的行
customers = customers.filter(c => c.id !== 13);                          // 删满足条件的行
```

SQL 里分别叫 `INSERT`、`UPDATE`、`DELETE`,再加上昨天的 `SELECT`,合起来俗称 **CRUD**(Create、Read、Update、Delete,增查改删),几乎所有后端接口最终都落到这四个动作上。[Day 79](/blog/agent-zero/day-079-fastapi-1/) 的 `GET /tickets` 是 Read,[Day 80](/blog/agent-zero/day-080-fastapi-2/) 的 `POST /tickets` 是 Create,Update 和 Delete 对应的是改一张工单、撤一张工单。工单现在还存在 Python 列表里,以后换成存在数据库里,接口的形状不变。

<figure>
<svg viewBox="0 0 640 250" role="img" aria-label="INSERT、UPDATE、DELETE 对应数组的 push、按条件修改、按条件过滤;右侧提示 UPDATE 和 DELETE 的 WHERE 一旦漏掉,命中的是全部行">
<rect x="0" y="0" width="640" height="250" fill="var(--paper-raised)" rx="6"/>
<g font-family="var(--font-mono)" font-size="12">
<text x="20" y="26" fill="var(--ink)">SQL</text>
<text x="230" y="26" fill="var(--ink)">前端里的样子</text>
<text x="450" y="26" fill="var(--ink)">命中范围</text>
<rect x="20" y="40" width="190" height="34" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="30" y="62" fill="var(--ink)">INSERT INTO ... VALUES</text>
<rect x="230" y="40" width="190" height="34" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="240" y="62" fill="var(--ink-soft)">list.push(obj)</text>
<text x="450" y="62" fill="var(--ink-soft)">新增 1 行(或几行)</text>
<rect x="20" y="92" width="190" height="34" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="30" y="114" fill="var(--ink)">UPDATE ... SET ... WHERE</text>
<rect x="230" y="92" width="190" height="34" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="240" y="114" fill="var(--ink-soft)">filter(...).forEach(改)</text>
<text x="450" y="114" fill="var(--ink-soft)">WHERE 命中的行</text>
<rect x="20" y="144" width="190" height="34" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="30" y="166" fill="var(--ink)">DELETE FROM ... WHERE</text>
<rect x="230" y="144" width="190" height="34" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="240" y="166" fill="var(--ink-soft)">list = list.filter(留下)</text>
<text x="450" y="166" fill="var(--ink-soft)">WHERE 命中的行</text>
<line x1="20" y1="196" x2="620" y2="196" stroke="var(--rule)"/>
<text x="20" y="218" fill="var(--ink)">WHERE 一漏:UPDATE 改全部行,DELETE 删全部行,不报错、不确认。</text>
<text x="20" y="238" fill="var(--ink-faint)" font-size="11">下面的第 6 步会在 practice.db 上亲手做一次。</text>
</g>
</svg>
<figcaption>左边琥珀色是 SQL,中间蓝色是前端里的等价写法。UPDATE 和 DELETE 作用在 WHERE 命中的那些行上,没有 WHERE 就是整张表。</figcaption>
</figure>

最大的区别有两个。一是数组里「改」和「删」写错了,刷新页面就回来了,数据库里写进去的是磁盘上的文件,改了就是改了。二是前端的 `filter` 是你自己写条件,条件漏了通常报错或者结果明显不对;SQL 的 `WHERE` 整个漏掉**完全合法**,数据库会认为你就是想改全部。

## 第 0 步:准备环境

今天的所有操作都在昨天建的 `practice.db` 上做。先确认它还在、数据是 10 行;不在或者被改过,就用 `customers.sql` 重建(昨天说过,这个脚本能反复执行):

```bash
cd /Users/你/agent-zero-lab/part01/sql
sqlite3 practice.db < customers.sql
sqlite3 practice.db "SELECT count(*) FROM customers;"
```

<div class="line-notes">

- `cd /Users/你/agent-zero-lab/part01/sql` 进入昨天建的 SQL 目录,后面所有命令都在这里跑,路径可以写短。
- `sqlite3 practice.db < customers.sql` 把 `customers.sql` 重新执行一遍:先 `DROP TABLE IF EXISTS customers` 删掉旧表,再建表、灌入 10 行。这一行执行完,数据一定回到昨天的初始状态。
- `sqlite3 practice.db "SELECT count(*) FROM customers;"` 数一下行数,是 10 就对了。

</div>

实跑输出:

```text
10
```

从下一步开始,我会按「进入 `sqlite3 practice.db`,在 `sqlite>` 提示符后一句一句输入」的方式讲(昨天说过,SQL 语句要以分号结尾)。也可以像我一样,把几句话用 `sqlite3 -header practice.db` 一次性喂进去,效果一样,下面贴的输出都是这样跑出来的。`-header` 参数会让查询结果带上列名那一行。

## 第 1 步:INSERT,加一行

昨天 `customers.sql` 里已经出现过 `INSERT INTO customers VALUES (...)`,当时只说「每个括号是一行」。今天来细看它。假设橙子健身今天签约了,要把它加进表里:

```sql
INSERT INTO customers (company, contact, email, plan, seats, city, created_at)
VALUES ('橙子健身', '孙亮', 'sunliang@chengzi.example', '基础版', 4, '杭州', '2026-10-23');

SELECT last_insert_rowid() AS new_id;
```

<div class="line-notes">

- `INSERT INTO customers (company, contact, email, plan, seats, city, created_at)` 往 `customers` 表插入,括号里是**列名清单**:我要给这 7 个列赋值。注意清单里**没有 `id`**。
- `VALUES ('橙子健身', '孙亮', 'sunliang@chengzi.example', '基础版', 4, '杭州', '2026-10-23');` 值的清单,和上面的列名一一按顺序对应:第 1 个值给 `company`,第 2 个给 `contact`,第 5 个 `4` 给 `seats`……个数必须相等。字符串用单引号,数字 `4` 不加引号。
- `SELECT last_insert_rowid() AS new_id;` `last_insert_rowid()` 是 SQLite 自带的函数,返回**当前这个连接**上最近一次插入的那一行的 `id`。`AS new_id` 给结果列起个名字。

</div>

实跑输出:

```text
new_id
11
```

没写 `id`,SQLite 自己给了 11:昨天说过,`INTEGER PRIMARY KEY` 这一列不给值就会自动取「当前最大 id + 1」,现在最大是 10,所以是 11。真实业务里几乎都让数据库分配 id,自己编号容易撞车。

为什么一定要写列名清单?昨天的脚本里写的是 `INSERT INTO customers VALUES (...)`,不写清单。那种写法要求你按**表里列的顺序**把**所有 8 列**都给齐,包括 `id`。两个问题:一是你得记住顺序,而且 8 个值里夹着 `NULL` 谁是谁很难看;二是将来给表加一列,所有这种 INSERT 全部报错。带列名的写法不依赖顺序、可以省略有默认值或可空的列,**平时一律写列名**,昨天脚本里那种写法只适合「灌初始数据」这种一次性的场合。

一条 `INSERT` 也可以带多行,多个括号之间用逗号隔开,昨天的 10 个客户就是这样进去的。再加两家,其中木子书店没有邮箱:

```sql
INSERT INTO customers (company, contact, email, plan, seats, city, created_at) VALUES
    ('木子书店', '郑洁', NULL, '基础版', 2, '苏州', '2026-10-23'),
    ('山海茶业', '冯琳', 'fenglin@shanhai.example', '专业版', 8, '厦门', '2026-10-23');

SELECT id, company, email, plan, seats, city FROM customers WHERE id > 10;
```

<div class="line-notes">

- `INSERT INTO customers (company, contact, email, plan, seats, city, created_at) VALUES` 同样的列名清单,后面不是一个括号,而是两个。
- `('木子书店', '郑洁', NULL, '基础版', 2, '苏州', '2026-10-23'),` 第一行,`email` 位置写 `NULL`,表示这家没有邮箱。末尾是**逗号**,说明后面还有。
- `('山海茶业', '冯琳', 'fenglin@shanhai.example', '专业版', 8, '厦门', '2026-10-23');` 第二行,末尾是**分号**,整条语句结束。
- `SELECT id, company, email, plan, seats, city FROM customers WHERE id > 10;` 查 id 大于 10 的行,看看新加进去的。

</div>

(我用 `-box` 画表格跑的,输出里 11 号是上一步加的橙子健身。)

```text
┌────┬─────────┬──────────────────────────┬──────┬───────┬──────┐
│ id │ company │          email           │ plan │ seats │ city │
├────┼─────────┼──────────────────────────┼──────┼───────┼──────┤
│ 11 │ 橙子健身    │ sunliang@chengzi.example │ 基础版  │ 4     │ 杭州   │
│ 12 │ 木子书店    │                          │ 基础版  │ 2     │ 苏州   │
│ 13 │ 山海茶业    │ fenglin@shanhai.example  │ 专业版  │ 8     │ 厦门   │
└────┴─────────┴──────────────────────────┴──────┴───────┴──────┘
```

12、13 是自动编的。木子书店的邮箱那一格是空的,那是 `NULL`,不是空字符串,昨天讲过。

## 第 2 步:INSERT 失败的几种样子

SQL 的错误信息比 JS 的直白很多,因为约束都是你自己在建表时写下的规则。故意各犯一次。**第一种,漏掉必填列。** `contact` 是 `NOT NULL`,不给它值:

```bash
sqlite3 practice.db "INSERT INTO customers (company, plan, seats, created_at) VALUES ('测试公司', '基础版', 2, '2026-10-23');"
```

<div class="line-notes">

- `INSERT INTO customers (company, plan, seats, created_at)` 列名清单里只有 4 列,漏了 `contact`。`email`、`city` 可空,不写没关系,会自动成为 `NULL`;`contact` 是 `NOT NULL`,必须有值。后面 `VALUES ('测试公司', '基础版', 2, '2026-10-23')` 的 4 个值对应这 4 个列。

</div>

```text
Error: stepping, NOT NULL constraint failed: customers.contact (19)
```

读法:`NOT NULL constraint failed: customers.contact`,「customers 表的 contact 列违反了非空约束」。后面括号里的 19 是 SQLite 内部的错误码(`SQLITE_CONSTRAINT`),命令行退出码也是它,脚本里想判断成败可以看 `echo $?`。这条语句整条没有生效。

**第二种,主键重复。** 故意手写一个已经存在的 id:

```bash
sqlite3 practice.db "INSERT INTO customers (id, company, contact, plan, seats, created_at) VALUES (1, '重复公司', '某人', '基础版', 1, '2026-10-23');"
```

<div class="line-notes">

- `INSERT INTO customers (id, company, contact, plan, seats, created_at)` 这次列名清单里有 `id`,自己指定编号。后面 `VALUES (1, '重复公司', ...` 编号写 1,可 1 号已经是星河餐饮了。

</div>

```text
Error: stepping, UNIQUE constraint failed: customers.id (19)
```

`UNIQUE constraint failed: customers.id`:主键要求每行唯一,1 已经有人用了。这就是不要自己编号的原因。

**第三种,不写列名,值的个数又对不上。** 用昨天脚本里那种省略列名的写法,只给 5 个值:

```bash
sqlite3 practice.db "INSERT INTO customers VALUES ('木子书店', '郑洁', '基础版', 2, '2026-10-23');"
```

<div class="line-notes">

- `INSERT INTO customers VALUES ('木子书店', '郑洁', '基础版', 2, '2026-10-23')` 没有列名清单,SQLite 就认为你要按表的列顺序给全 8 列,可括号里只有 5 个值,少了 3 个。

</div>

```text
Error: in prepare, table customers has 8 columns but 5 values were supplied
```

这个报错最直白:表有 8 列,你给了 5 个值。注意前两种是 `stepping`(语句已经开始执行,执行到某一行时被约束拦下),这一种是 `in prepare`(语句根本没通过检查)。两种都没有改动数据。三种失败之后表里还是 13 行。

### SQLite 的类型很宽松

还有一个昨天没提的怪脾气。`seats` 列声明成 `INTEGER`,往里写一个中文字符串,SQLite 会拦吗?用一张临时表试:

```sql
CREATE TEMP TABLE t (seats INTEGER);
INSERT INTO t VALUES (3), ('3'), ('两个'), (2.5);
SELECT seats, typeof(seats) AS type FROM t;
```

<div class="line-notes">

- `CREATE TEMP TABLE t (seats INTEGER);` `TEMP` 表示临时表,只在这次连接里存在,退出就消失,不会碰到 `practice.db` 的内容。只有一列 `seats`,类型 `INTEGER`。
- `INSERT INTO t VALUES (3), ('3'), ('两个'), (2.5);` 四行:整数 3、字符串 `'3'`、字符串 `'两个'`、小数 2.5。
- `SELECT seats, typeof(seats) AS type FROM t;` `typeof(...)` 是 SQLite 的函数,返回这个值**实际存的**类型。

</div>

```text
seats|type
3|integer
3|integer
两个|text
2.5|real
```

全部存进去了。逐行看:`3` 就是整数;`'3'` 是字符串,但「长得像整数」,SQLite 帮你转成了整数 3;`'两个'` 转不了,就原样当文本存了,**没有报错**;`2.5` 存的是小数。SQLite 官方管这套规则叫类型亲和性(type affinity),列类型更像是一个「倾向」,不是铁律。后面如果有人往 `seats` 里写了 `'两个'`,下面 `SUM(seats)` 时就是一团乱。

想要严格的类型检查,建表时在末尾加 `STRICT`(SQLite 3.37 起支持,本机 3.39.5 可以):

```sql
CREATE TABLE seats_test (id INTEGER PRIMARY KEY, seats INTEGER NOT NULL) STRICT;
INSERT INTO seats_test (seats) VALUES (3);
INSERT INTO seats_test (seats) VALUES ('两个');
SELECT count(*) FROM seats_test;
DROP TABLE seats_test;
```

<div class="line-notes">

- `CREATE TABLE seats_test (id INTEGER PRIMARY KEY, seats INTEGER NOT NULL) STRICT;` 括号后面多了一个 `STRICT`,这张表就启用严格类型。
- `INSERT INTO seats_test (seats) VALUES (3);` 整数,正常进去。
- `INSERT INTO seats_test (seats) VALUES ('两个');` 往整数列写中文。
- `SELECT count(*) FROM seats_test;` 数一下表里有几行。
- `DROP TABLE seats_test;` 用完就删,别留着。

</div>

```text
Runtime error near line 3: cannot store TEXT value in INTEGER column seats_test.seats (19)
1
```

这次被拦下了:`cannot store TEXT value in INTEGER column seats_test.seats`。`count(*)` 是 1,说明第一行 3 进去了,第二行没有。Postgres 默认就是严格的,同样的操作直接报 `invalid input syntax for type integer: "两个"`,后面会对比。今天的 `customers` 表是昨天用普通方式建的,不是 STRICT,所以**往里写数据的程序自己要负责检查类型**,这也是 Day 92 之后用 Python 写数据库时要加校验的原因之一。

## 第 3 步:UPDATE,改几行

半岛咖啡(7 号)升级了,从基础版 2 席换成专业版 6 席。UPDATE 的写法:

```sql
SELECT id, company, plan, seats FROM customers WHERE id = 7;

UPDATE customers SET plan = '专业版', seats = 6 WHERE id = 7;
SELECT changes() AS changed;

SELECT id, company, plan, seats FROM customers WHERE id = 7;
```

<div class="line-notes">

- `SELECT id, company, plan, seats FROM customers WHERE id = 7;` **改之前先看一眼**:用和 UPDATE 完全相同的 `WHERE` 查,确认命中的就是想改的那一行。
- `UPDATE customers SET plan = '专业版', seats = 6 WHERE id = 7;` `UPDATE 表名 SET 列 = 新值, 列 = 新值 WHERE 条件`。`SET` 后面是要改的列,**多个列之间用逗号隔开**;`WHERE id = 7` 只改 7 号这一行。
- `SELECT changes() AS changed;` `changes()` 返回**上一条**增删改语句影响的行数,这是改完以后第一件要看的数字。
- 最后一个 `SELECT` 再看改后的结果。

</div>

实跑输出:

```text
id|company|plan|seats
7|半岛咖啡|基础版|2
changed
1
id|company|plan|seats
7|半岛咖啡|专业版|6
```

`changed` 是 1,和预期的一行一致。养成这个习惯:**每次 UPDATE 和 DELETE 以后看 `changes()`,数字和你预期不一样就立刻停手**。

`SET` 的右边可以用表达式,包括这一列原来的值。杭州的客户都送 5 个席位:

```sql
SELECT id, company, seats FROM customers WHERE city = '杭州';
UPDATE customers SET seats = seats + 5 WHERE city = '杭州';
SELECT changes() AS changed;
SELECT id, company, seats FROM customers WHERE city = '杭州';
```

<div class="line-notes">

- `SELECT id, company, seats FROM customers WHERE city = '杭州';` 改之前先看,命中三行:1 号星河餐饮 12 席,10 号小满花店 1 席,11 号橙子健身 4 席(11 号是第 1 步加的)。
- `UPDATE customers SET seats = seats + 5 WHERE city = '杭州';` `seats = seats + 5`:右边的 `seats` 是这一行**改之前**的值,算出新值再写回去。相当于 JS 里的 `c.seats += 5`,对三行各做一次:12→17,1→6,4→9。
- `SELECT changes() AS changed;` 应该是 3。
- 最后一句再查一遍,核对每一行的新值。

</div>

```text
id|company|seats
1|星河餐饮|12
10|小满花店|1
11|橙子健身|4
changed
3
id|company|seats
1|星河餐饮|17
10|小满花店|6
11|橙子健身|9
```

再注意一个很容易被忽略的事实:`WHERE` 没命中任何行时,UPDATE **不报错**,只是改了 0 行:

```sql
UPDATE customers SET plan = '企业版' WHERE id = 999;
SELECT changes() AS changed;
```

<div class="line-notes">

- `UPDATE customers SET plan = '企业版' WHERE id = 999;` 表里没有 999 号,什么也没改到,而且**没有任何报错**。
- `SELECT changes() AS changed;` 这才是你发现「根本没改成」的唯一线索。

</div>

```text
changed
0
```

后面写 Python 接口时(Day 93)这一点很重要:「改成功」不等于「改到了东西」,接口要自己检查影响行数,0 行就该回 404,而不是回 200。列名写错倒会报错,比如把 `seats` 写成 `seat`,得到 `Error: in prepare, no such column: seat`。

## 第 4 步:UPDATE 的两个坑

**坑一:`WHERE email = NULL`。** 昨天已经学过,和 NULL 比较永远是「不知道」。想给 4 号蓝鲸教育补上邮箱,写成:

```sql
UPDATE customers SET email = 'liuyang@lanjing.example' WHERE email = NULL;
SELECT changes() AS changed;
```

```text
changed
0
```

没报错,改了 0 行。正确写法是 `IS NULL`。但直接换成 `WHERE email IS NULL` 还有一个陷阱,先看一眼它会命中谁:

```sql
SELECT id, company, email FROM customers WHERE email IS NULL;
UPDATE customers SET email = 'liuyang@lanjing.example' WHERE email IS NULL AND id = 4;
SELECT changes() AS changed;
SELECT id, company, email FROM customers WHERE id IN (4, 12);
```

<div class="line-notes">

- `SELECT id, company, email FROM customers WHERE email IS NULL;` 先预览。命中两行:4 号蓝鲸教育,还有第 1 步加的 12 号木子书店,它也没邮箱。如果直接 `UPDATE ... WHERE email IS NULL`,12 号会被一起写上蓝鲸教育刘洋的邮箱。
- `UPDATE customers SET email = 'liuyang@lanjing.example' WHERE email IS NULL AND id = 4;` 再加一个 `id = 4` 把范围缩到一行。这里 `AND` 没有和 `OR` 混用,不用加括号。
- `SELECT changes() AS changed;` 应该是 1。
- `SELECT id, company, email FROM customers WHERE id IN (4, 12);` 核对 4 号有了,12 号还是空。

</div>

```text
id|company|email
4|蓝鲸教育|
12|木子书店|
changed
1
id|company|email
4|蓝鲸教育|liuyang@lanjing.example
12|木子书店|
```

这就是「先用同样的 WHERE 跑 SELECT」的价值:预览出了两行,你才会意识到一个条件不够用。

**坑二:`SET` 里用 `AND` 代替逗号。** 从其他语言过来的人很容易这么写:想让 9 号北辰贸易改成企业版、50 席。

```sql
SELECT id, company, plan, seats FROM customers WHERE id = 9;
UPDATE customers SET plan = '企业版' AND seats = 50 WHERE id = 9;
SELECT id, company, plan, typeof(plan) AS t, seats FROM customers WHERE id = 9;
```

<div class="line-notes">

- `SELECT id, company, plan, seats FROM customers WHERE id = 9;` 改之前:9 号是专业版 9 席。
- `UPDATE customers SET plan = '企业版' AND seats = 50 WHERE id = 9;` 本意是同时改两列,但 SQL 里 `SET` 的多个赋值要用**逗号**分开。这里写了 `AND`,SQLite 就把 `'企业版' AND seats = 50` 整个当成**一个逻辑表达式**,算出来是真/假(0 或 1),赋给了 `plan`。SQLite 对此不报错。
- `SELECT id, company, plan, typeof(plan) AS t, seats FROM customers WHERE id = 9;` 看结果。

</div>

```text
id|company|plan|seats
9|北辰贸易|专业版|9
id|company|plan|t|seats
9|北辰贸易|0|text|9
```

套餐变成了 `0`(被转成文本存进了 `plan` 列),席位**一点没变**。`'企业版'` 在这里被当成数字是 0,`0 AND ...` 就是假,也就是 0。数据被悄悄改坏了,没有任何错误提示。同样的语句在 Postgres 里会报 `invalid input syntax for type boolean: "企业版"`,至少会拦下。SQLite 不拦,所以更要靠预览加 `changes()`:这一条 `changes()` 是 1,看起来正常,只有再 SELECT 一遍才发现不对。

先把 9 号改回原样。这次只改一个列,用不着逗号:

```sql
UPDATE customers SET plan = '专业版' WHERE id = 9;
SELECT id, company, plan, seats FROM customers WHERE id = 9;
```

```text
id|company|plan|seats
9|北辰贸易|专业版|9
```

要同时改两列,正确写法是 `SET plan = '企业版', seats = 50`,逗号隔开,这个写法第 3 步用过了。

## 第 5 步:DELETE,删几行

山海茶业(13 号)签约后反悔了,要把它删掉。DELETE 的写法和 UPDATE 很像,只是没有 `SET`:

```sql
SELECT id, company FROM customers WHERE id = 13;
DELETE FROM customers WHERE id = 13 RETURNING id, company;
SELECT count(*) AS n FROM customers;
```

<div class="line-notes">

- `SELECT id, company FROM customers WHERE id = 13;` 照例先预览,命中的是 13 号山海茶业,一行。
- `DELETE FROM customers WHERE id = 13 RETURNING id, company;` `DELETE FROM 表名 WHERE 条件`,删除 WHERE 命中的行。结尾的 `RETURNING id, company` 是 SQLite 3.35 起支持的写法:把被删掉的那些行的指定列直接返回给你,UPDATE 和 INSERT 也能用。它相当于「删之前最后看一眼」,谁被删了一清二楚。
- `SELECT count(*) AS n FROM customers;` 数一下剩多少行:13 减 1 是 12。

</div>

```text
id|company
13|山海茶业
id|company
13|山海茶业
n
12
```

第一段是预览,第二段是 `RETURNING` 吐出来的被删行,两段一致说明删对了。`RETURNING` 在 Postgres 里也能用,形式一样。

顺便看一个小细节,会影响你以后怎么看 id。刚删掉了最大的 13 号,现在再加一家会得到什么 id?

```sql
INSERT INTO customers (company, contact, plan, seats, created_at)
VALUES ('临时公司', '某人', '基础版', 1, '2026-10-23');
SELECT max(id) FROM customers;
DELETE FROM customers WHERE id = 13;
```

<div class="line-notes">

- `INSERT INTO customers (company, contact, plan, seats, created_at)` 只给必填的 5 列,不给 `id`。
- `VALUES ('临时公司', '某人', '基础版', 1, '2026-10-23');` 插入一行。
- `SELECT max(id) FROM customers;` 看新行拿到了几号。`max(...)` 取最大值,是聚合函数,Day 88 讲。
- `DELETE FROM customers WHERE id = 13;` 把这个临时行删掉,后面还要接着用 12 行的状态。

</div>

```text
max(id)
13
```

新行又拿到了 **13**,就是刚刚被删掉的山海茶业用过的号。原因是 `INTEGER PRIMARY KEY` 的分配规则是「当前最大值 + 1」,最大的删了,这个号就空出来了。如果别的地方(比如发票表)还记着「13 号客户」,而这时来了个新客户顶了 13 号,旧发票就会指向一个完全不相干的新客户。SQLite 想让编号永不复用,要在列上写 `AUTOINCREMENT`,代价是多一张记账表、稍慢一点。更常见的做法是业务上**不真删,只打一个「已注销」标记**(软删除),这样 id 永远不会被释放,后面做账单系统时会用到。

## 第 6 步:不带 WHERE 的事故

铺垫够了,现在做这一课最重要的实验。前面五步里每一条 UPDATE、DELETE 都有 `WHERE`,现在把它拿掉。**先备份。**

```bash
sqlite3 practice.db ".backup practice.bak.db"
ls -l practice.db practice.bak.db
sqlite3 practice.db "SELECT count(*) FROM customers;"
```

<div class="line-notes">

- `sqlite3 practice.db ".backup practice.bak.db"` `.backup` 是 sqlite3 的点命令,把当前数据库完整复制成另一个文件 `practice.bak.db`。它比直接 `cp` 更稳:拷贝过程中如果有别的程序正在写库,`cp` 可能拷出半新半旧的坏文件,`.backup` 会保证拿到一致的快照。
- `ls -l practice.db practice.bak.db` 看两个文件,大小应该一样。
- `sqlite3 practice.db "SELECT count(*) FROM customers;"` 确认备份那一刻库里是 12 行。

</div>

实跑输出:

```text
-rw-r--r--  1 你  staff  8192 23 Oct 11:14 practice.bak.db
-rw-r--r--  1 你  staff  8192 23 Oct 11:14 practice.db
12
```

备份有了。**第一次事故:UPDATE 漏了 WHERE。** 想把杭州的客户改成专业版,手一抖,条件没写:

```sql
UPDATE customers SET plan = '专业版';
SELECT changes() AS changed;
SELECT id, company, plan FROM customers WHERE id IN (1, 2, 3, 7, 12);
SELECT count(*) AS n FROM customers WHERE plan = '专业版';
```

<div class="line-notes">

- `UPDATE customers SET plan = '专业版';` 没有 `WHERE`,语法完全合法。SQL 的规则是:**没有 WHERE 就是所有行**。
- `SELECT changes() AS changed;` 影响了多少行。
- `SELECT id, company, plan FROM customers WHERE id IN (1, 2, 3, 7, 12);` 抽几个看,其中 2 号青木设计和 12 号木子书店原本都是基础版。
- `SELECT count(*) AS n FROM customers WHERE plan = '专业版';` 现在有多少家专业版。

</div>

```text
changed
12
id|company|plan
1|星河餐饮|专业版
2|青木设计|专业版
3|远山物流|专业版
7|半岛咖啡|专业版
12|木子书店|专业版
n
12
```

12 行全部变成了专业版,包括原来的 3 号、5 号企业版客户。没有警告、没有确认、没有「你确定吗」。唯一的线索是 `changed` 是 12,而你本来想改的只有几行。

**第二次事故:DELETE 漏了 WHERE。** 接着(假装没发现上一个错)又来一个:

```sql
DELETE FROM customers;
SELECT changes() AS changed;
SELECT count(*) AS n FROM customers;
```

<div class="line-notes">

- `DELETE FROM customers;` 没有 `WHERE`,删除表里**所有行**。注意它只删数据,表本身还在(那是 `DROP TABLE` 的事)。
- `SELECT changes() AS changed;` 12 行。
- `SELECT count(*) AS n FROM customers;` 表空了。

</div>

```text
changed
12
n
0
```

再看文件和表结构:

```bash
ls -l practice.db
sqlite3 practice.db ".tables" ".schema customers"
```

```text
-rw-r--r--  1 你  staff  8192 23 Oct 11:14 practice.db
customers
CREATE TABLE customers (
    id          INTEGER PRIMARY KEY,
    company     TEXT    NOT NULL,
    ...
```

(`.schema` 的输出我只截了前几行。)表还在,结构完整,文件大小一个字节都没变,还是 8192:SQLite 删了数据只是把那些页标记成「空闲」留着下次用,不会缩小文件。这里有两层意思。好消息是,这样的文件从技术上说「还有一点痕迹」,但**不要指望靠它找回数据**,普通人做不到。坏消息是,如果没有备份,这 12 个客户就是没了。

<figure>
<svg viewBox="0 0 640 230" role="img" aria-label="事故时间线:12 行数据,先备份,然后 UPDATE 无 WHERE 全改、DELETE 无 WHERE 全删,两条恢复路径:重跑 customers.sql 回到 10 行丢失手工数据,restore 备份回到 12 行">
<rect x="0" y="0" width="640" height="230" fill="var(--paper-raised)" rx="6"/>
<g font-family="var(--font-mono)" font-size="12">
<rect x="20" y="30" width="110" height="44" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="30" y="50" fill="var(--ink)">practice.db</text>
<text x="30" y="66" fill="var(--ink-soft)">12 行</text>
<line x1="130" y1="52" x2="170" y2="52" stroke="var(--rule)"/>
<rect x="170" y="30" width="120" height="44" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="180" y="50" fill="var(--ink)">.backup</text>
<text x="180" y="66" fill="var(--ink-soft)">得到 bak.db</text>
<line x1="290" y1="52" x2="330" y2="52" stroke="var(--rule)"/>
<rect x="330" y="30" width="130" height="44" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="340" y="50" fill="var(--ink)">UPDATE 无 WHERE</text>
<text x="340" y="66" fill="var(--ink-soft)">12 行全改</text>
<line x1="460" y1="52" x2="490" y2="52" stroke="var(--rule)"/>
<rect x="490" y="30" width="130" height="44" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="500" y="50" fill="var(--ink)">DELETE 无 WHERE</text>
<text x="500" y="66" fill="var(--ink-soft)">0 行</text>
<line x1="555" y1="74" x2="555" y2="110" stroke="var(--rule)"/>
<rect x="20" y="110" width="290" height="50" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="30" y="130" fill="var(--ink)">路径 A:重跑 customers.sql</text>
<text x="30" y="148" fill="var(--ink-soft)">回到 10 行,今天加的 2 家丢了</text>
<rect x="330" y="110" width="290" height="50" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="340" y="130" fill="var(--ink)">路径 B:.restore bak.db</text>
<text x="340" y="148" fill="var(--ink-soft)">回到 12 行,备份那一刻的状态</text>
<text x="20" y="196" fill="var(--ink-faint)" font-size="11">备份是在出事前做的才有用;脚本只能还原脚本里写过的数据。</text>
</g>
</svg>
<figcaption>从备份到事故再到两条恢复路径。琥珀色是对数据库的操作,蓝色是数据的两个「好状态」。</figcaption>
</figure>

**恢复路径 A:重跑 `customers.sql`。** 这是昨天说的那个能反复执行的脚本:

```bash
sqlite3 practice.db < customers.sql
sqlite3 -header practice.db "SELECT count(*) AS n FROM customers; SELECT id, company FROM customers WHERE id > 10;"
```

<div class="line-notes">

- `sqlite3 practice.db < customers.sql` 先 `DROP TABLE IF EXISTS customers`,再按脚本重建并灌入 10 行。
- 后面那句里,第一条 `SELECT count(*) AS n FROM customers;` 数出 10 行,回来了;第二条 `SELECT id, company FROM customers WHERE id > 10;` 查大于 10 的行,**什么也没有**:11 号橙子健身、12 号木子书店是今天手工加的,不在脚本里,丢了,连同 7 号升级专业版、杭州加席位这些修改。

</div>

```text
n
10
```

(第二条查询没有结果,所以没有任何输出,连列名行都没有。)脚本只能把你带回**脚本里写着的那个状态**。今天手工 INSERT 的数据在脚本里没有,就找不回来了。

**恢复路径 B:从备份还原。** 备份是出事之前做的,里面有今天的全部改动:

```bash
sqlite3 practice.db ".restore practice.bak.db"
sqlite3 -header practice.db "SELECT count(*) AS n FROM customers; SELECT id, company, plan, seats FROM customers WHERE id IN (7, 11, 12);"
```

<div class="line-notes">

- `sqlite3 practice.db ".restore practice.bak.db"` `.restore` 是 `.backup` 的反向操作:用 `practice.bak.db` 的内容**整个覆盖** `practice.db`。覆盖的是当前库,所以先确认备份文件是对的。
- 后面那句里,第一条 `SELECT count(*) AS n FROM customers;` 数出 12 行,回来了;第二条 `SELECT id, company, plan, seats FROM customers WHERE id IN (7, 11, 12);` 抽查:7 号的升级、11 号加席位后的 9 席、12 号木子书店,都在。

</div>

```text
n
12
id|company|plan|seats
7|半岛咖啡|专业版|6
11|橙子健身|基础版|9
12|木子书店|基础版|2
```

12 行、今天的改动全在。**备份的价值取决于它离事故有多近**:今天备份是在事故前一分钟,所以几乎没丢东西。真实的系统里,备份是一直在跑的(Postgres 有持续归档,云数据库有每日快照),你要关心的问题是「最近一次备份是多久之前」和「真的能还原吗」。

2017 年 GitLab 有一次著名的事故,他们公开了复盘报告。一位工程师本想清空备用库的数据目录,却在主库上执行了删除,发现时已经删了大约 300 GB。更糟的是,几套常规备份当时都没有可用的产出,最后靠一份约 6 小时前**手工做的**快照才恢复回来,网站停了大约 18 小时,那 6 小时里的数据丢了。注意这起事故删的是服务器上的文件目录,不是 SQL 的 `DELETE`,但教训相通:操作的是哪台机器、哪张表要核对清楚,备份要真的验证过能还原。原文在[GitLab 官方的复盘报告](https://about.gitlab.com/blog/2017/02/10/postmortem-of-database-outage-of-january-31/)里,事实来自它(2017-01-31 的事故,报告 2017-02-10 发布)。

## 第 7 步:养成几个防呆习惯

事故做完,总结成几条能落地的做法,每条都在今天的步骤里用过:

- **先 SELECT,再 UPDATE/DELETE。** 把要执行的语句里 `WHERE` 之后的部分原样粘到一条 `SELECT` 里,看命中几行、是不是预期的行。第 4 步靠它发现了木子书店。
- **执行完看 `changes()`。** 数字和预期不同立刻停手。
- **删除时用 `RETURNING`。** 被删的内容当场留一份,日志里能查到。
- **危险操作前先备份。** `.backup` 一条命令,几十毫秒的事。数据库文件小的时候,手工多备份一份比事后后悔便宜。
- **改库的语句写成文件,不要在 `sqlite>` 里临时敲。** 文件能 review、能存 git、能重跑,第 6 步路径 A 能成立就是因为 `customers.sql` 是文件。
- **别在生产库的命令行里手写 UPDATE/DELETE。** 真实公司里这类操作要走审批和脚本,脚本先过评审再执行。MySQL 的命令行有一个 `--safe-updates` 选项(别名叫 `--i-am-a-dummy`),打开后不带 `WHERE`(或不带能用上索引的条件)的 UPDATE 和 DELETE 会被直接拒绝,见 [MySQL 官方文档](https://dev.mysql.com/doc/refman/8.4/en/mysql-tips.html)(我用 curl 访问这个站返回 403,需要在浏览器里打开)。SQLite 没有这个开关,所以得靠你自己的习惯。
- **事务**(`BEGIN` ... `ROLLBACK`)可以让一批修改「先试试再决定要不要」,是更根本的办法,留到 [Day 91](/blog/agent-zero/day-091-sql-6/) 学。

最后,和 Postgres 对照两个坑。我在本机 Postgres 里新建了一个测试库跑了同样的语句(用完已删):往 `integer` 列写 `'两个'`,得到 `ERROR:  invalid input syntax for type integer: "两个"`;`SET plan = '企业版' AND seats = 50`,得到 `ERROR:  invalid input syntax for type boolean: "企业版"`;`UPDATE ... RETURNING *` 则和 SQLite 一样能用。**同样的坏语句,Postgres 当场拦下,SQLite 悄悄放过。**用 SQLite 学习没问题,但别拿它的「没报错」当成「写对了」。

收尾:把 `practice.db` 还原到干净的 10 行,明天要用,同时删掉备份文件(`*.bak.db` 也别进 git,`.gitignore` 里已经有 `*.db`):

```bash
sqlite3 practice.db < customers.sql
rm practice.bak.db
sqlite3 practice.db "SELECT count(*) FROM customers;"
```

```text
10
```

## 和前端代码对照

| 动作 | SQL | JS 数组 |
| --- | --- | --- |
| 加一行 | `INSERT INTO customers (...) VALUES (...)` | `customers.push({...})` |
| 改满足条件的行 | `UPDATE customers SET seats = seats + 5 WHERE city = '杭州'` | `customers.filter(c => c.city === '杭州').forEach(c => { c.seats += 5; })` |
| 删满足条件的行 | `DELETE FROM customers WHERE id = 13` | `customers = customers.filter(c => c.id !== 13)` |
| 影响了几行 | `SELECT changes()` | 自己数,没有内置 |
| 条件漏掉 | 命中全部行,不报错 | `filter` 少写条件通常是语法错或结果明显错 |
| 回到改之前 | `.restore` 备份 / 重跑脚本 | 刷新页面(数据没存过) |

## 动手练习

先把库还原:`sqlite3 practice.db < customers.sql`,每道题开始前都是 10 行的干净状态(题目会说明依赖前一题)。

**练习 1:一条语句加两家客户。** 用一条带列名的 `INSERT` 一次加入:橙子健身(联系人孙亮,邮箱 sunliang@chengzi.example,基础版 4 席,杭州,2026-10-23)和木子书店(联系人郑洁,没有邮箱,基础版 2 席,苏州,2026-10-23)。查出 id 大于 10 的行确认。

<details><summary>参考答案</summary>

```bash
sqlite3 -header practice.db "
INSERT INTO customers (company, contact, email, plan, seats, city, created_at) VALUES
    ('橙子健身', '孙亮', 'sunliang@chengzi.example', '基础版', 4, '杭州', '2026-10-23'),
    ('木子书店', '郑洁', NULL, '基础版', 2, '苏州', '2026-10-23');
SELECT id, company, email, city FROM customers WHERE id > 10;"
```

<div class="line-notes">

- `INSERT INTO customers (company, contact, email, plan, seats, city, created_at) VALUES` 带列名清单,不给 `id`,让它自动分配。
- `('橙子健身', '孙亮', 'sunliang@chengzi.example', '基础版', 4, '杭州', '2026-10-23'),` 第一家,行尾逗号。
- `('木子书店', '郑洁', NULL, '基础版', 2, '苏州', '2026-10-23');` 第二家,邮箱位置写 `NULL`,行尾分号。
- `SELECT id, company, email, city FROM customers WHERE id > 10;` 核对:应该是 11、12 号。

</div>

实跑输出:

```text
id|company|email|city
11|橙子健身|sunliang@chengzi.example|杭州
12|木子书店||苏州
```

11、12 号是自动分配的。木子书店的邮箱那格是空的,即 NULL。

</details>

**练习 2:杭州的基础版升专业版。** 接着练习 1 的状态(12 行)。把所有在杭州的基础版客户升级成专业版:先预览,再改,再用 `changes()` 确认改了几行。

<details><summary>参考答案</summary>

```bash
sqlite3 -header practice.db "
SELECT id, company, plan FROM customers WHERE city = '杭州' AND plan = '基础版';
UPDATE customers SET plan = '专业版' WHERE city = '杭州' AND plan = '基础版';
SELECT changes() AS changed;
SELECT id, company, plan FROM customers WHERE city = '杭州';"
```

<div class="line-notes">

- `SELECT id, company, plan FROM customers WHERE city = '杭州' AND plan = '基础版';` 预览:命中 10 号小满花店和 11 号橙子健身。1 号星河餐饮在杭州但已经是专业版,不在里面。
- `UPDATE customers SET plan = '专业版' WHERE city = '杭州' AND plan = '基础版';` 同样的 WHERE 做更新。
- `SELECT changes() AS changed;` 应该是 2,和预览行数一致。
- 最后一句看杭州三家的 plan 现在都是专业版。

</div>

实跑输出:

```text
id|company|plan
10|小满花店|基础版
11|橙子健身|基础版
changed
2
id|company|plan
1|星河餐饮|专业版
10|小满花店|专业版
11|橙子健身|专业版
```

预览 2 行,改了 2 行,对得上。

</details>

**练习 3:误删再恢复。** 接着练习 2。先 `.backup` 成 `practice.bak.db`,然后删掉「2026 年以后签约的基础版客户」,看 `changes()` 和剩余行数;再用 `.restore` 回到删之前,确认行数。

<details><summary>参考答案</summary>

```bash
sqlite3 practice.db ".backup practice.bak.db"
sqlite3 -header practice.db "
SELECT id, company, plan, created_at FROM customers WHERE plan = '基础版' AND created_at >= '2026-01-01';
DELETE FROM customers WHERE plan = '基础版' AND created_at >= '2026-01-01';
SELECT changes() AS changed;
SELECT count(*) AS n FROM customers;"
sqlite3 practice.db ".restore practice.bak.db"
sqlite3 -header practice.db "SELECT count(*) AS n FROM customers;"
```

<div class="line-notes">

- `sqlite3 practice.db ".backup practice.bak.db"` 删之前先备份。
- `SELECT id, company, plan, created_at FROM customers WHERE plan = '基础版' AND created_at >= '2026-01-01';` 预览:命中 7 号半岛咖啡(2026-02-19)和 12 号木子书店(2026-10-23)。10、11 号现在已经是专业版,不命中。`created_at` 是 `YYYY-MM-DD` 文本,直接用字符串比较就是日期比较(Day 85)。
- `DELETE FROM customers WHERE plan = '基础版' AND created_at >= '2026-01-01';` 同样的条件做删除。
- `SELECT changes() AS changed;` 和 `SELECT count(*) AS n FROM customers;` 删了 2 行,剩 10 行。
- `sqlite3 practice.db ".restore practice.bak.db"` 用备份覆盖回去。
- 最后的 `SELECT count(*)` 确认回到 12 行。

</div>

实跑输出:

```text
id|company|plan|created_at
7|半岛咖啡|基础版|2026-02-19
12|木子书店|基础版|2026-10-23
changed
2
n
10
n
12
```

最后一个 `n` 是 12,恢复成功。做完用 `rm practice.bak.db` 删掉备份。

</details>

**练习 4:企业版席位翻倍,并看结果。** 把所有企业版客户的席位乘以 2,并用 `RETURNING` 直接看到改后的值,不要再单独 SELECT。

<details><summary>参考答案</summary>

```bash
sqlite3 -header practice.db "UPDATE customers SET seats = seats * 2 WHERE plan = '企业版' RETURNING id, company, seats;"
```

<div class="line-notes">

- `UPDATE customers SET seats = seats * 2 WHERE plan = '企业版'` 右边的 `seats` 是旧值,3 号远山物流 85 席、5 号启明科技 140 席,各乘 2。后面的 `RETURNING id, company, seats;` 把**被改的行的新值**直接返回:这样一条语句里既改又看,不需要再 SELECT。

</div>

实跑输出:

```text
id|company|seats
3|远山物流|170
5|启明科技|280
```

85×2=170,140×2=280,只返回被改的 2 行,没有碰别的客户。

</details>

**练习 5(观察题):多行 INSERT 里有一行错了。** 先 `sqlite3 practice.db < customers.sql` 还原到 10 行,然后用一条 INSERT 插 3 行,其中第 2 行的 `id` 写成已存在的 1。执行后第 1、3 行进去了吗?解释原因。

<details><summary>参考答案</summary>

```bash
sqlite3 practice.db < customers.sql
sqlite3 practice.db "
INSERT INTO customers (id, company, contact, plan, seats, created_at) VALUES
    (20, '甲公司', '甲', '基础版', 1, '2026-10-23'),
    (1,  '乙公司', '乙', '基础版', 1, '2026-10-23'),
    (21, '丙公司', '丙', '基础版', 1, '2026-10-23');
SELECT count(*) FROM customers WHERE id >= 20;"
```

<div class="line-notes">

- `sqlite3 practice.db < customers.sql` 回到 10 行的干净状态。
- `(20, '甲公司', '甲', '基础版', 1, '2026-10-23'),` 第 1 行,合法,id 20。
- `(1,  '乙公司', '乙', '基础版', 1, '2026-10-23'),` 第 2 行,id 1 已经是星河餐饮,会撞主键。
- `(21, '丙公司', '丙', '基础版', 1, '2026-10-23');` 第 3 行,合法。
- `SELECT count(*) FROM customers WHERE id >= 20;` 数一下 20 号以上的有几行。

</div>

实跑输出:

```text
Runtime error near line 1: UNIQUE constraint failed: customers.id (19)
0
```

那一行是 0:合法的第 1、3 行**也没进去**。一条 `INSERT` 语句是一个整体,要么全成,要么全不生效,和昨天练习 5 看到的一样。这是数据库「事务」的最小形态,Day 91 会讲到一次改多条语句怎么也做到整体成败。

</details>

验收标准:五道题都在自己的终端里跑通;能不看文章默写出带列名的 `INSERT`、带 `WHERE` 的 `UPDATE`、带 `WHERE` 的 `DELETE`,以及 `.backup`、`.restore` 两个命令;解释得出「为什么 UPDATE 前要先写一条同条件的 SELECT」。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| CRUD | Create、Read、Update、Delete,增查改删四个基本动作,对应 INSERT、SELECT、UPDATE、DELETE |
| `INSERT INTO ... VALUES` | 往表里加一行或多行,平时写上列名清单 |
| 列名清单 | `INSERT INTO 表 (列1, 列2)` 里括号中的列名,值按它的顺序一一对应 |
| 自动编号 | SQLite 里 `INTEGER PRIMARY KEY` 不给值就取「当前最大值 + 1」,最大的被删后号会复用 |
| `last_insert_rowid()` | 返回当前连接上最近一次插入的行的 id |
| `UPDATE ... SET ... WHERE` | 改 WHERE 命中的行,多列赋值用逗号隔开 |
| `DELETE FROM ... WHERE` | 删 WHERE 命中的行,不写 WHERE 就是删全表(表结构还在) |
| `changes()` | 上一条增删改语句影响的行数,改完第一件事看它 |
| `RETURNING` | INSERT/UPDATE/DELETE 后面加的子句,把受影响的行直接返回,SQLite 3.35 起支持,Postgres 也有 |
| 约束失败 | `NOT NULL constraint failed`、`UNIQUE constraint failed` 这类错,语句整条不生效 |
| 类型亲和性 | SQLite 的宽松类型规则:`INTEGER` 列里存 `'两个'` 不报错,实际存成文本 |
| `STRICT` | 建表时加在末尾,让 SQLite 严格检查列类型(3.37 起) |
| `typeof()` | 返回一个值在 SQLite 里实际存的类型 |
| 临时表(`TEMP`) | 只在当前连接存在的表,退出即消失 |
| `.backup` / `.restore` | sqlite3 点命令:把库完整复制成备份文件 / 用备份文件覆盖当前库 |
| 软删除 | 不真删行,只用一个标记列表示已注销,id 不会被复用 |

## 常见误区

**UPDATE 或 DELETE 忘了 WHERE。** 语法合法,不报错,命中全部行。实测 12 行全被改成专业版、又全被删光,文件大小都没变。写之前先写同条件的 SELECT。

**以为「没报错」就是「改成功了」。** `WHERE id = 999` 这种没命中的 UPDATE 不报错,只是 `changes()` 为 0。接口代码要自己检查影响行数。

**`WHERE email = NULL`。** 改 0 行,不报错,要写 `IS NULL`。而且 `IS NULL` 可能命中比你想的更多的行,实测 4 号和 12 号都命中,先 SELECT 预览。

**`SET a = 1 AND b = 2`。** 多列赋值要用逗号。写成 `AND` 后实测 `plan` 被改成了 `0`,另一列纹丝不动,SQLite 不报错,Postgres 会拦。

**不写列名的 INSERT。** 依赖列的顺序和个数,表一加列就全部报错,值一多还容易错位。平时一律写列名清单。

**自己给 id 编号。** 实测手写 1 就报 `UNIQUE constraint failed: customers.id`。让数据库分配。另外最大的 id 被删后,下一个新行会拿到同一个号,和别的表里的引用对不上就出乱子。

**以为 INTEGER 列只能放整数。** SQLite 里 `'两个'` 能存进去,变成文本。需要严格类型时建表用 `STRICT`,或者换 Postgres。

**脚本能还原所有东西。** 重跑 `customers.sql` 只能回到脚本里写着的状态,今天手工 INSERT 的行实测丢了。重要的改动要先 `.backup`。

**把备份放在改动之后。** 备份只有在出事**之前**做才有用,而且要真的试过能还原,GitLab 那次的教训就是几套备份都不能用。

## 学习资料

### 文档与文章

- [SQLite 官方 · INSERT(英文)](https://sqlite.org/lang_insert.html):INSERT 的完整语法,包括多行 VALUES 和 DEFAULT VALUES。
- [SQLite 官方 · UPDATE(英文)](https://sqlite.org/lang_update.html):UPDATE 语法图,看 SET 后面能跟什么。
- [SQLite 官方 · DELETE(英文)](https://sqlite.org/lang_delete.html):DELETE 语法,页面里有一节讲不带 WHERE 的 DELETE 在 SQLite 内部是怎么优化的。
- [SQLite 官方 · RETURNING(英文)](https://sqlite.org/lang_returning.html):今天用的 `RETURNING` 的完整规则和限制。
- [SQLite 官方 · STRICT Tables(英文)](https://sqlite.org/stricttables.html):严格类型表的说明,以及允许的类型清单。
- [SQLite 官方 · Command Line Shell(英文)](https://sqlite.org/cli.html):`.backup`、`.restore`、`.changes` 等点命令的出处。
- [菜鸟教程 · SQLite INSERT](https://www.runoob.com/sqlite/sqlite-insert.html)、[UPDATE](https://www.runoob.com/sqlite/sqlite-update.html)、[DELETE](https://www.runoob.com/sqlite/sqlite-delete.html):中文,一句一页的速查,适合当手册。
- [SQLBolt · 第 13 到 15 课(英文)](https://sqlbolt.com/lesson/inserting_rows):浏览器里直接练 INSERT、UPDATE、DELETE,每课有习题。后两课是 [updating_rows](https://sqlbolt.com/lesson/updating_rows) 和 [deleting_rows](https://sqlbolt.com/lesson/deleting_rows)。
- [PostgreSQL 官方教程 · Data Manipulation(英文)](https://www.postgresql.org/docs/current/dml.html):Postgres 的写入语句总览,里面也有 [RETURNING 的说明](https://www.postgresql.org/docs/current/dml-returning.html),后面 Day 228 开始用它。
- [GitLab · 2017-01-31 数据库事故复盘(英文)](https://about.gitlab.com/blog/2017/02/10/postmortem-of-database-outage-of-january-31/):今天讲的那次事故的原文,读备份为什么失效那几节。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1nHYv6DE1v&autoplay=0&high_quality=1" title="最吓人的数据库事故不是删库，是 update 少写了个 where" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>java程序员爱发明 · 最吓人的数据库事故不是删库,是 update 少写了个 where · 约 2 分钟,2026 年 9 月发布。直接对应今天第 6 步的事故。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV17b4y1f7L3&autoplay=0&high_quality=1" title="第九节-SQL基础教程INSERT INTO插入语句" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>咖啡的味道88 · 第九节 SQL 基础教程 INSERT INTO 插入语句 · 约 8 分钟,播放 1.3 万。把 INSERT 的写法一步步演示一遍,适合对照第 1、2 步。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1fq4y177Ro&autoplay=0&high_quality=1" title="第十节-SQL基础教程UPDATE 修改语句" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>咖啡的味道88 · 第十节 SQL 基础教程 UPDATE 修改语句 · 约 9 分钟。看 SET 和 WHERE 怎么配合,对照第 3、4 步。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/YOjy9rpneNY" title="SQL Data Manipulation: INSERT, UPDATE, DELETE Explained - SQL Tutorial for Beginners" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Data with Baraa · SQL Data Manipulation: INSERT, UPDATE, DELETE Explained · 英文,可开字幕。三句写入语句放在一个视频里讲完,适合学完今天以后再看一遍。</figcaption>
</figure>

### 书籍

- Ben Forta,《SQL必知必会》(第 5 版),人民邮电出版社(原书 *Sams Teach Yourself SQL in 10 Minutes a Day*,5th ed.,2019)。第 15、16 课讲插入、更新和删除,书里提醒过更新和删除一定要带 WHERE。
- Alan Beaulieu,《Learning SQL》(第 3 版),O'Reilly,2020(英文)。第 12 章是事务(Transactions),Day 91 学完以后可以回来对着看。

### 开源项目与代码

今天这组不需要。想看看真实的数据库迁移和数据修复脚本长什么样,可以等 Day 91 学完事务再回头看。

## 自测

1. `INSERT INTO customers VALUES (...)` 和 `INSERT INTO customers (company, contact, ...) VALUES (...)` 有什么区别?为什么平时推荐后者?

<details><summary>答案</summary>

前者没有列名清单,必须按表里列的顺序给齐**所有列**(包括 `id`),个数不对就报 `table customers has 8 columns but 5 values were supplied`;后者明确说明每个值给哪一列,可以省略可空列和自动编号的 `id`。表以后加了一列,前者全部报错,后者不受影响。所以平时写列名,前者只在灌初始数据的脚本里用。

</details>

2. `UPDATE customers SET plan = '企业版' WHERE id = 999;` 执行后没有报错,怎么知道它有没有改到东西?

<details><summary>答案</summary>

看 `SELECT changes();`,它返回上一条增删改语句影响的行数。没有 999 号客户,所以是 0。数据库认为「改了 0 行」是正常结果,不是错误。写接口时要检查影响行数,0 行应当回 404。

</details>

3. 下面这句想把 5 号改成专业版 100 席,有什么问题?结果会是什么?`UPDATE customers SET plan = '专业版' AND seats = 100 WHERE id = 5;`

<details><summary>答案</summary>

多个列赋值要用逗号,写成了 `AND`。SQLite 会把 `'专业版' AND seats = 100` 当作一个逻辑表达式,算出 0 或 1 赋给 `plan`:实测 plan 变成文本 `'0'`,`seats` 不变,而且没有任何报错。正确写法是 `SET plan = '专业版', seats = 100`。Postgres 会直接报 `invalid input syntax for type boolean`。

</details>

4. 同事在生产库里手滑执行了 `DELETE FROM customers;`,没有备份。说出两个今天学过的、事前就该做的预防动作。

<details><summary>答案</summary>

一是危险操作之前先 `.backup`(真实系统里是确认最近一次自动备份有多新,而且试过能还原);二是执行前先把同样的 `WHERE` 写成 SELECT 预览命中几行,执行后看 `changes()`,这一条语句如果漏了 `WHERE`,会一次命中全部行,`changes()` 和预期差距巨大。更根本的还有:不要在生产库手敲写入语句,改走脚本加评审,以及用事务(Day 91)让错误操作能回滚。

</details>

5. 面试题:你要给客服 Agent 做一个「修改客户套餐」的工具,Agent 会根据用户的话自己决定调用。结合今天学的,你会怎样设计这个工具,避免出现整表被改的事故?

<details><summary>答案</summary>

不要把 SQL 交给模型自己写,只开放一个参数固定的函数,比如 `change_plan(customer_id, new_plan)`,内部拼 `UPDATE ... WHERE id = ?`(参数化,Day 92),`WHERE` 是写死在代码里的,模型没有机会漏掉。`new_plan` 限定在枚举值里,防止写进 `'0'` 这种脏数据。执行后检查影响行数必须恰好是 1,是 0 就回「客户不存在」,多于 1 就回滚并报警。改之前把旧值记入日志或审计表,出问题能追溯;高风险操作(降级、批量)让人确认后再执行。

</details>

## 明天预告

Day 87 · SQL(三):JOIN。今天只有 `customers` 一张表,可真实的账单系统里,客户、发票、订阅是分开放的,发票表里只记「这是 7 号客户的发票」,要同时看到公司名和金额就得把两张表接起来。明天会新建 `invoices.sql`,往库里放一张发票表,学内连接和左连接,看清楚它们为什么有时会悄悄丢行。
