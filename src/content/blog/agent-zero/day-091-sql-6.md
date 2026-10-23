---
title: 'Day 91 · SQL(六):事务、主键外键和约束'
description: '15 号孤儿发票能存进库里,是因为表上没有任何约束挡着。今天用主键、外键、UNIQUE、CHECK、NOT NULL 让数据库自己拒绝脏数据,再用事务把「扣了款、没记账」这种做到一半的事整个撤回,并认出 SQLite 外键默认不开、事务里出错不会自动回滚这两个坑。'
pubDate: 2026-10-23
regime: none
tags: ['sql', 'sqlite', 'transaction', 'constraint', 'foreign-key', 'database', 'agent-zero']
series: 'agent-zero'
day: 91
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 90](/blog/agent-zero/day-090-week13-review/) 是第 13 周的复习日:用一份 `audit.sql` 出了账单审计报表,第 5 条查到了 15 号孤儿发票(客户编号 11,客户表里根本没有这个人),第 6 条对账发现能配上客户的发票合计 99861,比总额 100017 少了 156;又用 JWT 给报表签了名,改一个数就验不过。

那份报表是**事后**发现问题:孤儿发票已经在库里躺着了,没有任何东西在它被写入的那一刻拦住它。今天补上这一课。**约束**(constraint)是写在表定义里的规则,数据库在每次 `INSERT`、`UPDATE` 时自己检查,不满足就拒绝;**事务**(transaction)是把几条语句捆成一件事,要么全做完,要么全撤回,不留一半。前者管「存进去的东西合不合规矩」,后者管「一件事分几步做,中途断了怎么办」。

## 今天要解决的问题

学完今天,你应该能做到:

1. 用 `PRIMARY KEY`、`NOT NULL`、`UNIQUE`、`CHECK`、`FOREIGN KEY ... REFERENCES` 写一张有约束的表,认得出每一种约束被违反时的报错原文。
2. 说清楚 SQLite 的外键默认是**关着**的、每个连接都要自己 `PRAGMA foreign_keys = ON`,不开的话孤儿发票照样存进去,并会用 `PRAGMA foreign_key_check` 查出已有的孤儿。
3. 用 `BEGIN`、`COMMIT`、`ROLLBACK` 把「扣余额、记付款、改发票状态」三步捆成一件事,重现并修好「重试一次,钱被扣了两遍」。
4. 说出事务的 ACID 四个字各自保证什么,并认出两个坑:事务里一条语句出错,事务不会自动回滚;两个人同时写会遇到 `database is locked`。

今天两个新概念:**约束**(含主键、外键)和**事务**。

预计用时:3 小时。花费 ¥0,不写 Python,只用终端。

前置:[Day 85](/blog/agent-zero/day-085-sql-1/) 的 `CREATE TABLE`、`NOT NULL`;[Day 86](/blog/agent-zero/day-086-sql-2/) 的 `INSERT`、`UPDATE`、`DELETE` 和「`UNIQUE constraint failed`」那条报错;[Day 87](/blog/agent-zero/day-087-sql-3/) 的 `invoices` 表、`JOIN` 和孤儿发票;[Day 88](/blog/agent-zero/day-088-sql-4/) 的 `count`、`sum`;[Day 90](/blog/agent-zero/day-090-week13-review/) 的审计报表。

学法:先对照文章逐行敲一遍(不复制粘贴)并跑通;第二天合上文章,默写「带约束的建表」和「一个事务里的三步扣款」;做练习,做不出再展开参考答案,看完关掉自己重写一遍。

## 从前端看:校验可以被绕过,最后一道门要在数据库

前端表单你一定写过校验:`required`、`min`、`pattern`,再加一层 Zod。后端接口也会再校验一遍(Day 80 的 pydantic)。可这两层都有漏的时候:有人绕过页面直接 `curl` 接口;后端某一天少写了一条规则;两个请求同时进来,各自检查都通过,合起来却出了问题(两个人同时抢最后一个名额)。**约束是写在数据库里的最后一道门**:不管数据从哪条路来,都得过这一关。

事务的前端对照,最近的是 `IndexedDB` 的 transaction:一组读写操作要么全部生效,要么全部不生效;或者你写过的「乐观更新」:先在界面上改,请求失败了再整个还原。数据库里的事务是同一个想法,只是更严格,而且处理的是钱和账。

<figure>
<svg viewBox="0 0 640 300" role="img" aria-label="左边是约束:一行新数据要依次过 NOT NULL、UNIQUE、CHECK、外键四道门,任何一道不过就整行被拒绝;右边是事务:三条语句捆在 BEGIN 和 COMMIT 之间,中途出错就 ROLLBACK 全部撤回">
<rect x="0" y="0" width="640" height="300" fill="var(--paper-raised)" rx="6"/>
<g font-family="var(--font-mono)" font-size="12">
<text x="20" y="24" fill="var(--ink)">约束:每行写入前过四道门</text>
<rect x="20" y="36" width="130" height="30" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="85" y="56" fill="var(--ink)" text-anchor="middle">INSERT 一行</text>
<rect x="20" y="82" width="130" height="26" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="85" y="99" fill="var(--ink)" text-anchor="middle">NOT NULL</text>
<rect x="20" y="114" width="130" height="26" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="85" y="131" fill="var(--ink)" text-anchor="middle">UNIQUE</text>
<rect x="20" y="146" width="130" height="26" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="85" y="163" fill="var(--ink)" text-anchor="middle">CHECK</text>
<rect x="20" y="178" width="130" height="26" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="85" y="195" fill="var(--ink)" text-anchor="middle">FOREIGN KEY</text>
<rect x="20" y="214" width="130" height="30" rx="4" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="85" y="234" fill="var(--ink)" text-anchor="middle">全过才写入</text>
<line x1="85" y1="66" x2="85" y2="82" stroke="var(--rule)"/>
<line x1="85" y1="108" x2="85" y2="114" stroke="var(--rule)"/>
<line x1="85" y1="140" x2="85" y2="146" stroke="var(--rule)"/>
<line x1="85" y1="172" x2="85" y2="178" stroke="var(--rule)"/>
<line x1="85" y1="204" x2="85" y2="214" stroke="var(--rule)"/>
<text x="170" y="99" fill="var(--ink-soft)" font-size="11">company 不能空</text>
<text x="170" y="131" fill="var(--ink-soft)" font-size="11">email 不能重复</text>
<text x="170" y="163" fill="var(--ink-soft)" font-size="11">seats &gt; 0,plan 只能三选一</text>
<text x="170" y="195" fill="var(--ink-soft)" font-size="11">customer_id 必须在 customers 里</text>
<text x="170" y="234" fill="var(--ink-faint)" font-size="11">任何一道不过,整行被拒绝,表不变</text>
<line x1="400" y1="20" x2="400" y2="280" stroke="var(--rule)" stroke-dasharray="4 3"/>
<text x="420" y="24" fill="var(--ink)">事务:三步捆成一件事</text>
<rect x="420" y="36" width="200" height="26" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="520" y="53" fill="var(--ink)" text-anchor="middle">BEGIN</text>
<rect x="420" y="70" width="200" height="26" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="520" y="87" fill="var(--ink)" text-anchor="middle">1 扣余额 -1188</text>
<rect x="420" y="104" width="200" height="26" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="520" y="121" fill="var(--ink)" text-anchor="middle">2 记付款(UNIQUE 撞了)</text>
<rect x="420" y="138" width="200" height="26" rx="4" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="520" y="155" fill="var(--ink-faint)" text-anchor="middle">3 改发票状态(没执行)</text>
<rect x="420" y="184" width="95" height="30" rx="4" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="467" y="203" fill="var(--ink-soft)" text-anchor="middle">COMMIT</text>
<rect x="525" y="184" width="95" height="30" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="572" y="203" fill="var(--ink)" text-anchor="middle">ROLLBACK</text>
<text x="420" y="240" fill="var(--ink)">第 2 步出错 → 第 1 步也撤回</text>
<text x="420" y="260" fill="var(--ink-soft)" font-size="11">余额回到 1812,不会少一笔</text>
</g>
</svg>
<figcaption>左边:约束是写入前的四道门,蓝色是门。右边:事务把三步捆在一起,第 2 步撞上唯一约束后整件事撤回(琥珀色的 ROLLBACK),第 1 步扣掉的钱也回来。数字来自第 5 步的实跑。</figcaption>
</figure>

## 第 0 步:现在的表什么都不拦

先回到 `practice.db`。`invoices` 表是 Day 87 建的,只有 `NOT NULL` 和主键,没有别的规矩。看看它能吞下多离谱的数据:

```bash
cd /Users/你/agent-zero-lab/part01/sql
rm -f practice.db
sqlite3 practice.db < customers.sql
sqlite3 practice.db < invoices.sql
sqlite3 -header practice.db "
INSERT INTO invoices (customer_id, amount, status, issued_at) VALUES (999, -5, '随便写', '昨天');
SELECT * FROM invoices WHERE id > 15;"
```

<div class="line-notes">

- `cd /Users/你/agent-zero-lab/part01/sql` 进入放 SQL 文件的目录。
- `rm -f practice.db` 删掉旧库,下面两行重建,保证从干净的 10 家客户加 15 张发票开始。
- `sqlite3 practice.db < invoices.sql` 重建发票表。这张表只规定了 `NOT NULL`,没有别的约束。
- `INSERT INTO invoices (customer_id, amount, status, issued_at) VALUES (999, -5, '随便写', '昨天');` 一条处处错的数据:客户 999 不存在,金额是负数,状态不是三种之一,日期不是日期。
- `SELECT * FROM invoices WHERE id > 15;` 看这行有没有被存进去。

</div>

```text
id|customer_id|amount|status|issued_at
16|999|-5|随便写|昨天
```

四处错误,一个报错都没有,16 号发票就这么存进去了。这是 Day 87 提到过的:**今天的表没有外键约束,所以孤儿发票能存进去**。再往后,Day 88 的汇总、Day 90 的报表会把这行 -5 元的发票一起算进去,而且没有任何提示。

## 第 1 步:带约束的建表

新建 `part01/sql/strict.sql`。它重新定义两张表,字段和之前一样,只是多了约束:

```sql
-- agent-zero-lab/part01/sql/strict.sql
PRAGMA foreign_keys = ON;

DROP TABLE IF EXISTS payments;
DROP TABLE IF EXISTS accounts;
DROP TABLE IF EXISTS invoices;
DROP TABLE IF EXISTS customers;

CREATE TABLE customers (
    id          INTEGER PRIMARY KEY,
    company     TEXT    NOT NULL,
    contact     TEXT    NOT NULL,
    email       TEXT    UNIQUE,
    plan        TEXT    NOT NULL CHECK (plan IN ('基础版', '专业版', '企业版')),
    seats       INTEGER NOT NULL CHECK (seats > 0),
    city        TEXT,
    created_at  TEXT    NOT NULL
);

CREATE TABLE invoices (
    id           INTEGER PRIMARY KEY,
    customer_id  INTEGER NOT NULL REFERENCES customers (id),
    amount       INTEGER NOT NULL CHECK (amount > 0),
    status       TEXT    NOT NULL CHECK (status IN ('paid', 'unpaid', 'refunded')),
    issued_at    TEXT    NOT NULL
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

INSERT INTO invoices VALUES
    (1,  1,  1188,  'paid',     '2026-07-01'),
    (2,  1,  1188,  'paid',     '2026-08-01'),
    (3,  1,  1188,  'unpaid',   '2026-09-01'),
    (4,  2,  117,   'paid',     '2026-08-01'),
    (5,  2,  117,   'paid',     '2026-09-01'),
    (6,  3,  16915, 'paid',     '2026-08-01'),
    (7,  3,  16915, 'unpaid',   '2026-09-01'),
    (8,  4,  1980,  'paid',     '2026-09-01'),
    (9,  5,  27860, 'paid',     '2026-08-01'),
    (10, 5,  27860, 'paid',     '2026-09-01'),
    (11, 7,  78,    'refunded', '2026-09-01'),
    (12, 8,  1782,  'paid',     '2026-08-01'),
    (13, 8,  1782,  'unpaid',   '2026-09-01'),
    (14, 9,  891,   'paid',     '2026-09-01');
```

<div class="line-notes">

- `PRAGMA foreign_keys = ON;` **本课最容易漏的一行**。SQLite 的外键检查默认是关的,而且只对当前这个连接生效。第 3 步会专门演示不开会怎样。
- `DROP TABLE IF EXISTS payments;` 删表的顺序要**先子后父**:`payments` 和 `accounts`(第 4 步建)引用 `invoices` 和 `customers`,`invoices` 又引用 `customers`。先删被引用的父表,在外键开着时可能被拒绝。这两张表这一步还不存在,`IF EXISTS` 让它不报错。
- `id          INTEGER PRIMARY KEY,` **主键**(primary key):每行的唯一编号,不能重复也不能为空。在 SQLite 里 `INTEGER PRIMARY KEY` 还会自动编号(Day 86)。
- `company     TEXT    NOT NULL,` **非空**:必须有值,Day 85 就见过。
- `email       TEXT    UNIQUE,` **唯一**:同一列不允许出现两个相同的值。注意 `UNIQUE` 的列可以有 NULL,而且可以有**多个** NULL(4 号客户的邮箱是 NULL,不冲突),因为 NULL 是「不知道」,不知道和不知道不算相等。
- `plan        TEXT    NOT NULL CHECK (plan IN ('基础版', '专业版', '企业版')),` **检查**(check):括号里写一个条件,新数据必须让它成立。这里限定套餐只能是三个值之一,相当于前端的枚举类型。
- `seats       INTEGER NOT NULL CHECK (seats > 0),` 席位数必须大于 0。
- `customer_id  INTEGER NOT NULL REFERENCES customers (id),` **外键**(foreign key):`REFERENCES customers (id)` 的意思是这一列的值必须是 `customers` 表里某一行的 `id`。`NOT NULL` 另外规定它不能留空,否则外键允许 NULL,发票就可以「没有客户」。
- `amount       INTEGER NOT NULL CHECK (amount > 0),` 发票金额必须是正数。退款是另一个状态,不用负数表示。
- `status       TEXT    NOT NULL CHECK (status IN ('paid', 'unpaid', 'refunded')),` 状态只能是三种,和 Day 87 数据里出现的一样。
- `INSERT INTO customers VALUES` 10 家客户和 Day 85 的完全相同,现在每一行写入时都要过上面的检查。
- `(14, 9,` 注意发票只插了 1 到 14 号,**15 号孤儿发票没有放进来**,因为它过不了外键这一关,下面第 2 步专门演示。

</div>

建库并确认(`strict.sql` 开头的 `PRAGMA` 只对这一次连接生效,用完就没了):

```bash
rm -f strict.db
sqlite3 strict.db < strict.sql && echo loaded
sqlite3 strict.db "SELECT count(*) FROM customers; SELECT count(*) FROM invoices; PRAGMA foreign_keys;"
```

<div class="line-notes">

- `rm -f strict.db` 另用一个库文件 `strict.db`,不动 `practice.db`。
- `sqlite3 strict.db < strict.sql && echo loaded` `&&` 的意思是前一条成功(退出码 0)才执行后一条,脚本里任何一条语句违反约束都会让它失败,就不会打印 `loaded`。
- `SELECT count(*) FROM customers; SELECT count(*) FROM invoices; PRAGMA foreign_keys;` 数一下两张表的行数,10 家客户、14 张发票;最后的 `PRAGMA foreign_keys;` 不带等号,是**查询**当前值,而且这是一个**新的连接**,不是刚才跑 `strict.sql` 的那个。

</div>

```text
loaded
10
14
0
```

10 家客户、14 张发票都进去了。最后一行 `0` 要留意:新开的一个连接里 `foreign_keys` 是 0,也就是**关着**。刚才在 `strict.sql` 里打开的开关,随着那个连接一起结束了。这是第 3 步要讲的坑。

## 第 2 步:一种约束,一种报错

逐个违反约束,看数据库怎么回答。每条命令都在自己的连接里先打开外键:

```bash
t() { sqlite3 strict.db "PRAGMA foreign_keys = ON; $1" 2>&1; }
t "INSERT INTO customers (company, contact, plan, seats, created_at) VALUES (NULL, '甲', '基础版', 1, '2026-10-23');"
t "INSERT INTO customers (company, contact, email, plan, seats, created_at) VALUES ('新客', '乙', 'wangwei@xinghe.example', '基础版', 1, '2026-10-23');"
t "INSERT INTO customers (company, contact, plan, seats, created_at) VALUES ('新客', '乙', '旗舰版', 1, '2026-10-23');"
t "INSERT INTO customers (company, contact, plan, seats, created_at) VALUES ('新客', '乙', '基础版', 0, '2026-10-23');"
t "INSERT INTO invoices VALUES (15, 11, 156, 'unpaid', '2026-10-23');"
t "UPDATE invoices SET amount = -5 WHERE id = 1;"
t "UPDATE invoices SET customer_id = 99 WHERE id = 1;"
t "DELETE FROM customers WHERE id = 1;"
```

<div class="line-notes">

- `t() { sqlite3 strict.db "PRAGMA foreign_keys = ON; $1" 2>&1; }` 定义一个 shell 函数 `t`:把传进来的第一个参数 `$1`(一条 SQL)接在 `PRAGMA foreign_keys = ON;` 后面,交给 `sqlite3`。`2>&1` 把错误输出也合进正常输出,方便阅读。
- `VALUES (NULL, '甲'` 第 1 条:公司名是 NULL,违反 `NOT NULL`。
- `'wangwei@xinghe.example', '基础版', 1` 第 2 条用了 1 号客户已经有的邮箱,违反 `UNIQUE`。
- `'旗舰版', 1` 第 3 条套餐写成「旗舰版」,违反套餐那条 `CHECK`。
- `'基础版', 0` 第 4 条席位数写 0,违反 `seats > 0` 那条 `CHECK`。
- `INSERT INTO invoices VALUES (15, 11, 156, 'unpaid', '2026-10-23');` 正是那张孤儿发票:客户 11 不存在,违反外键。
- `UPDATE invoices SET amount = -5 WHERE id = 1;` 约束不只管 `INSERT`,`UPDATE` 改出来的新值同样要过关。
- `UPDATE invoices SET customer_id = 99 WHERE id = 1;` 把发票改挂到不存在的客户上,违反外键。
- `DELETE FROM customers WHERE id = 1;` 外键也管**删除**:1 号客户还有 3 张发票指着它,删掉会让它们变成孤儿。

</div>

```text
Error: stepping, NOT NULL constraint failed: customers.company (19)
Error: stepping, UNIQUE constraint failed: customers.email (19)
Error: stepping, CHECK constraint failed: plan IN ('基础版', '专业版', '企业版') (19)
Error: stepping, CHECK constraint failed: seats > 0 (19)
Error: stepping, FOREIGN KEY constraint failed (19)
Error: stepping, CHECK constraint failed: amount > 0 (19)
Error: stepping, FOREIGN KEY constraint failed (19)
Error: stepping, FOREIGN KEY constraint failed (19)
```

八次尝试,八次拒绝,表里没有变化。报错格式是「**哪种约束** failed: 哪个字段(或哪条规则)」,结尾的 `(19)` 是 SQLite 内部给「约束违反」的错误码。读法:

- `NOT NULL constraint failed: customers.company`:`customers` 表的 `company` 列不能为空。
- `UNIQUE constraint failed: customers.email`:`email` 列已经有这个值了。
- `CHECK constraint failed: seats > 0`:`CHECK` 的报错直接把你写的条件抄回来,所以**给 CHECK 写得好读一些**,报错就是现成的提示。
- `FOREIGN KEY constraint failed`:外键的报错最不友好,**没有说是哪一列、哪个值**。排查时要自己看:引用的那行存在吗?要删的那行还被引用着吗?(Postgres 的报错详细得多,第 7 步会看到。)

**UNIQUE 允许多个 NULL**,可以验证。往 `customers` 里一次插两个没有邮箱的客户,都成功,再删掉:

```bash
t "INSERT INTO customers (company, contact, email, plan, seats, created_at) VALUES ('新客甲', '乙', NULL, '基础版', 1, '2026-10-23'), ('新客乙', '丙', NULL, '基础版', 1, '2026-10-23'); SELECT count(*) FROM customers;"
sqlite3 strict.db "DELETE FROM customers WHERE id > 10; SELECT count(*) FROM customers;"
```

<div class="line-notes">

- `VALUES ('新客甲', '乙', NULL,` 一条 `INSERT` 带两行,两个邮箱都是 NULL;后面的 `SELECT count(*) FROM customers;` 在同一个连接里数一下。
- `DELETE FROM customers WHERE id > 10;` 清理:把这两个新客户删掉。因为它们没有发票指着,所以可以删。这条命令没用 `t`,在没开外键的连接里跑,删这两行没有影响。

</div>

```text
12
10
```

12 行,说明两个 NULL 邮箱都通过了;删掉后回到 10 行。你想要「邮箱必填且不重复」,要同时写 `NOT NULL UNIQUE`。

## 第 3 步:外键默认是关的

最危险的一条:前面所有外键的保护,都靠每个连接先执行 `PRAGMA foreign_keys = ON`。不执行会怎样?

```bash
sqlite3 strict.db "PRAGMA foreign_keys;"
sqlite3 -header strict.db "INSERT INTO invoices VALUES (15, 11, 156, 'unpaid', '2026-10-23'); SELECT count(*) AS invoices FROM invoices; PRAGMA foreign_key_check;"
```

<div class="line-notes">

- `sqlite3 strict.db "PRAGMA foreign_keys;"` 新连接里查外键开关,0 就是关。
- `INSERT INTO invoices VALUES (15, 11, 156, 'unpaid', '2026-10-23');` 第 2 步被拒绝的那张孤儿发票,这次**没有**先开外键。接着 `SELECT count(*) AS invoices FROM invoices;` 数一下发票,看有没有存进去;最后的 `PRAGMA foreign_key_check;` 是**体检**命令:不管开关开没开,扫描整个库,把所有违反外键的行列出来。

</div>

```text
0
invoices
15
table|rowid|parent|fkid
invoices|15|customers|0
```

开关是 0,孤儿发票**成功插入了**,发票变成 15 张,没有任何警告。但是 `PRAGMA foreign_key_check` 查得出来:`invoices` 表里 `rowid` 为 15 的那行,它的父表 `customers` 里找不到对应的行(`fkid` 是第几条外键)。`foreign_key_check` 是你给已有数据做体检的工具,想知道线上的库里有没有孤儿,就跑它。

这就是 SQLite 的历史包袱:外键功能是后来加的,为了不让老程序出问题,默认关闭。所有用 SQLite 的程序都要**每开一个连接就打开一次**。Python 的 `sqlite3` 模块(Day 92 起学)默认也不开。Postgres 没有这个开关,外键永远生效。

把孤儿删掉,并且在开着外键的连接里再体检一次:

```bash
sqlite3 strict.db "PRAGMA foreign_keys = ON; DELETE FROM invoices WHERE id = 15; PRAGMA foreign_key_check; SELECT count(*) FROM invoices;"
```

<div class="line-notes">

- `DELETE FROM invoices WHERE id = 15;` 删子表里的这一行没有问题,被引用的才受限制。后面的 `PRAGMA foreign_key_check;` 删完再体检,没有输出就是干净;`SELECT count(*) FROM invoices;` 回到 14 张。

</div>

```text
14
```

体检没有输出(干净),发票回到 14 张。

**外键删除时的三种处理。** 第 2 步里 `DELETE FROM customers WHERE id = 1` 被拒绝,是因为外键默认的处理方式叫 `NO ACTION`:「父行被子行引用时不许删」。可以在外键后面写 `ON DELETE ...` 换一种做法。用一个玩具库对比一下:

```bash
rm -f toy.db
sqlite3 toy.db <<'EOF'
PRAGMA foreign_keys = ON;
CREATE TABLE parent (id INTEGER PRIMARY KEY, name TEXT);
CREATE TABLE child_restrict (id INTEGER PRIMARY KEY, parent_id INTEGER REFERENCES parent(id));
CREATE TABLE child_cascade (id INTEGER PRIMARY KEY, parent_id INTEGER REFERENCES parent(id) ON DELETE CASCADE);
CREATE TABLE child_setnull (id INTEGER PRIMARY KEY, parent_id INTEGER REFERENCES parent(id) ON DELETE SET NULL);
INSERT INTO parent VALUES (1,'p1'),(2,'p2');
INSERT INTO child_cascade VALUES (1,1),(2,1),(3,2);
INSERT INTO child_setnull VALUES (1,1),(2,2);
DELETE FROM parent WHERE id = 1;
SELECT 'child_cascade', id, parent_id FROM child_cascade;
SELECT 'child_setnull', id, parent_id FROM child_setnull;
INSERT INTO child_restrict VALUES (1,2);
DELETE FROM parent WHERE id = 2;
EOF
```

<div class="line-notes">

- `sqlite3 toy.db <<'EOF'` here-document(Day 89 用过):把后面直到 `EOF` 的内容当输入。
- `CREATE TABLE child_restrict` 不写 `ON DELETE`,等于默认的 `NO ACTION`:有子行就不许删父行。
- `ON DELETE CASCADE` `CASCADE`(级联):删父行时,指着它的子行**一起删掉**。
- `ON DELETE SET NULL` `SET NULL`:删父行时,子行的外键列被改成 NULL,子行保留。
- `INSERT INTO child_cascade VALUES (1,1),(2,1),(3,2);` 两行指着 1 号父行,一行指着 2 号。
- `DELETE FROM parent WHERE id = 1;` 删 1 号父行,观察两种子表怎么变。
- `INSERT INTO child_restrict VALUES (1,2);` 让 `child_restrict` 的一行指着 2 号父行。
- `DELETE FROM parent WHERE id = 2;` 现在删 2 号父行:`child_restrict` 拦着不让删,最后一行会报错。

</div>

```text
child_cascade|3|2
child_setnull|1|
child_setnull|2|2
Runtime error near line 13: FOREIGN KEY constraint failed (19)
```

删了 1 号父行之后:`child_cascade` 里指着它的两行(id 1、2)**被一起删掉**了,只剩指着 2 号的那一行;`child_setnull` 里的那一行还在,但 `parent_id` 变成了空;最后一条 `DELETE` 被 `child_restrict` 拦住,报外键错误。**`CASCADE` 很方便也很危险**:删一个客户,他的发票、付款、退款全没了,而账单数据通常不能随便消失。所以账单类的表,外键保持默认的「不许删」更稳妥。

补一句限制:SQLite 不支持对**已有的表**用 `ALTER TABLE` 加外键约束。给旧表补约束只有一条路:建一张带约束的新表,把数据搬过去,删旧表,改名。练习 1 会做一遍。


## 第 4 步:没有事务,做到一半就是事故

先看约束管不了的事:**一件事分几步做,中途断了**。设定一个小场景:星河餐饮(1 号客户)在系统里有个预付余额账户,余额 3000 元。付 3 号发票(1188 元)要做三步:

1. 从余额里扣 1188。
2. 在付款记录表里记一笔。
3. 把发票状态改成已付。

后面你要做的 Agent,调用「帮客户付这张发票」这样的工具时,做的就是这三步。建两张表,在 `strict.db` 里加上账户和付款记录。新建 `part01/sql/pay.sql`:

```sql
-- agent-zero-lab/part01/sql/pay.sql
PRAGMA foreign_keys = ON;

DROP TABLE IF EXISTS payments;
DROP TABLE IF EXISTS accounts;

CREATE TABLE accounts (
    customer_id  INTEGER PRIMARY KEY REFERENCES customers (id),
    balance      INTEGER NOT NULL CHECK (balance >= 0)
);

CREATE TABLE payments (
    id          INTEGER PRIMARY KEY,
    invoice_id  INTEGER NOT NULL UNIQUE REFERENCES invoices (id),
    amount      INTEGER NOT NULL CHECK (amount > 0),
    paid_at     TEXT    NOT NULL
);

INSERT INTO accounts VALUES (1, 3000), (2, 500);
```

<div class="line-notes">

- `customer_id  INTEGER PRIMARY KEY REFERENCES customers (id),` 账户表用客户编号当主键,**一个客户只有一个账户**;同时是外键,必须是真实存在的客户。
- `balance      INTEGER NOT NULL CHECK (balance >= 0)` 余额不许为负:想扣的比有的多,数据库直接拒绝,不会让账户透支。
- `invoice_id  INTEGER NOT NULL UNIQUE REFERENCES invoices (id),` `UNIQUE` 加外键:**一张发票只能有一条付款记录**。这一行是今天的关键,它挡住了「同一张发票付两次」。
- `amount      INTEGER NOT NULL CHECK (amount > 0),` 付款金额必须是正数。
- `INSERT INTO accounts VALUES (1, 3000), (2, 500);` 给 1 号客户 3000 元,2 号客户 500 元。

</div>

再写出三步扣款,放在 `part01/sql/pay_invoice3.sql`;和一个看现状的查询 `part01/sql/show_state.sql`:

```sql
-- agent-zero-lab/part01/sql/pay_invoice3.sql
PRAGMA foreign_keys = ON;
UPDATE accounts SET balance = balance - 1188 WHERE customer_id = 1;
INSERT INTO payments (invoice_id, amount, paid_at) VALUES (3, 1188, '2026-10-23');
UPDATE invoices SET status = 'paid' WHERE id = 3;
```

<div class="line-notes">

- `PRAGMA foreign_keys = ON;` 每个连接都要开,这是这一天的口头禅。
- `UPDATE accounts SET balance = balance - 1188 WHERE customer_id = 1;` 第 1 步:扣余额。写成 `balance = balance - 1188`,是让数据库自己算,不是先读出来再写回去(练习 5 会演示读了再写有什么坑)。
- `INSERT INTO payments (invoice_id, amount, paid_at) VALUES (3, 1188, '2026-10-23');` 第 2 步:记付款。如果 3 号发票已经有付款记录,这里会撞上 `UNIQUE`。
- `UPDATE invoices SET status = 'paid' WHERE id = 3;` 第 3 步:改发票状态。

</div>

```sql
-- agent-zero-lab/part01/sql/show_state.sql
SELECT 'balance' AS what, balance AS value FROM accounts WHERE customer_id = 1
UNION ALL
SELECT 'payments', count(*) FROM payments
UNION ALL
SELECT 'invoice 3', status FROM invoices WHERE id = 3;
```

<div class="line-notes">

- `SELECT 'balance' AS what, balance AS value FROM accounts WHERE customer_id = 1` 第一段:1 号客户的余额,第一列是写死的标签文字。
- `UNION ALL` 把上下几段查询的结果**竖着拼在一起**,各段的列数要一样。不用理解得太深,这里只是想一次看三个状态。
- `SELECT 'payments', count(*) FROM payments` 第二段:付款记录有几条。
- `SELECT 'invoice 3', status FROM invoices WHERE id = 3;` 第三段:3 号发票现在的状态。

</div>

先重建库,看初始状态,跑一次扣款,再看:

```bash
sqlite3 strict.db < strict.sql
sqlite3 strict.db < pay.sql
sqlite3 -header strict.db < show_state.sql
sqlite3 strict.db < pay_invoice3.sql
sqlite3 -header strict.db < show_state.sql
```

<div class="line-notes">

- `sqlite3 strict.db < strict.sql` 先把客户和发票表还原成 14 张发票的样子(`strict.sql` 开头会删表重建,包括 `accounts` 和 `payments`)。
- `sqlite3 strict.db < pay.sql` 建账户和付款记录两张表。
- `sqlite3 -header strict.db < show_state.sql` 第一次看现状:还没付过。
- `sqlite3 strict.db < pay_invoice3.sql` 跑一次三步扣款。
- 最后一条 `show_state.sql` 再看一次。

</div>

```text
what|value
balance|3000
payments|0
invoice 3|unpaid
what|value
balance|1812
payments|1
invoice 3|paid
```

第一次一切正常:余额 3000 变 1812(扣了 1188),一条付款记录,发票变已付。现在想象真实场景:**调用方没收到成功的响应,超时了,自动重试一次**(模型调用工具时这种事天天发生)。同一个脚本再跑一遍:

```bash
sqlite3 strict.db < pay_invoice3.sql
sqlite3 -header strict.db < show_state.sql
```

<div class="line-notes">

- `sqlite3 strict.db < pay_invoice3.sql` 第二次执行同一个脚本,模拟重试。
- `sqlite3 -header strict.db < show_state.sql` 看现状。

</div>

```text
Runtime error near line 4: UNIQUE constraint failed: payments.invoice_id (19)
what|value
balance|624
payments|1
invoice 3|paid
```

第 4 行(第 2 步的 `INSERT`)被 `UNIQUE` 拦住了,报错很好。**但第 1 步已经执行完了**:余额从 1812 变成了 624,**又扣了 1188 元**,而付款记录还是 1 条。客户的钱凭空少了一笔,账上没有任何记录说明它去了哪里。第 3 步又把已付的发票改成已付,没有任何变化。约束拦住了第 2 步,却管不了第 1 步,因为第 1 步本身是合法的,约束只检查一条语句自己。

SQLite 命令行默认遇到错误继续往下执行下一条,这里第 3 步还是执行了。换成别的数据库或程序,可能在出错的地方停下来,但**停下来的位置,已经执行过的几步不会自己撤回**,结果同样是做到一半。

## 第 5 步:事务,捆成一件事

**事务**(transaction)是把一串语句包成不可分的一件事:`BEGIN` 开始,`COMMIT` 确认生效,`ROLLBACK` 撤销。三者的行为:

- `BEGIN` 之后到 `COMMIT` 之前做的所有修改,**只有你自己看得到**,别的连接看不到,磁盘上也没有真正确定。
- `COMMIT`:全部修改一起生效。
- `ROLLBACK`:全部修改一起撤销,数据库回到 `BEGIN` 之前的样子。
- 连接在没有 `COMMIT` 的情况下断开或进程死掉,等于 `ROLLBACK`。

没写 `BEGIN` 的时候,SQLite 把**每条语句**当成独立的一个事务,执行完立刻提交,这叫**自动提交**(autocommit)。所以前面第 4 步每一条语句生效后就改不回来了。

先单独感受 `ROLLBACK`。先把数据库还原到「已经付过一次」的状态:

```bash
sqlite3 strict.db < strict.sql
sqlite3 strict.db < pay.sql
sqlite3 strict.db < pay_invoice3.sql
sqlite3 strict.db <<'EOF'
BEGIN;
UPDATE accounts SET balance = balance - 1000 WHERE customer_id = 1;
SELECT '事务里看到' AS where_, balance FROM accounts WHERE customer_id = 1;
ROLLBACK;
SELECT '回滚之后' AS where_, balance FROM accounts WHERE customer_id = 1;
EOF
```

<div class="line-notes">

- `sqlite3 strict.db < pay_invoice3.sql` 前三行把库还原到「付过一次」:余额 1812,发票已付。
- `BEGIN;` 开启一个事务。从这里开始的修改都还没有最终确定。
- `UPDATE accounts SET balance = balance - 1000 WHERE customer_id = 1;` 扣 1000。
- `SELECT '事务里看到' AS where_, balance FROM accounts WHERE customer_id = 1;` 在事务**内部**查,能看到自己刚做的修改:1812 - 1000 = 812。
- `ROLLBACK;` 撤销整个事务,刚才的扣款作废。
- `SELECT '回滚之后' AS where_, balance` 回滚之后再查,余额回到 1812。

</div>

```text
事务里看到|812
回滚之后|1812
```

两个查询,同一个连接,一个 812 一个 1812:`ROLLBACK` 之前,你看到的是「如果提交了会是什么样」;`ROLLBACK` 之后,什么都没有发生过。

再看「忘了 `COMMIT`」和「没有 `BEGIN`」两种情况:

```bash
sqlite3 strict.db "BEGIN; UPDATE accounts SET balance = balance - 1000 WHERE customer_id = 1; SELECT balance FROM accounts WHERE customer_id = 1;"
sqlite3 strict.db "SELECT balance FROM accounts WHERE customer_id = 1;"
sqlite3 strict.db "UPDATE accounts SET balance = balance - 1000 WHERE customer_id = 1;"
sqlite3 strict.db "ROLLBACK;"
sqlite3 strict.db "SELECT balance FROM accounts WHERE customer_id = 1;"
```

<div class="line-notes">

- `sqlite3 strict.db "BEGIN; UPDATE accounts SET balance = balance - 1000 WHERE customer_id = 1; SELECT balance FROM accounts WHERE customer_id = 1;"` 开事务、扣款、查余额,**到最后没写 `COMMIT`**,这个连接随着命令结束而关闭。
- `sqlite3 strict.db "SELECT balance FROM accounts WHERE customer_id = 1;"` 新连接查:刚才那次修改还在不在?
- `sqlite3 strict.db "UPDATE accounts SET balance = balance - 1000 WHERE customer_id = 1;"` 这次**没有写 BEGIN**,直接 UPDATE。
- `sqlite3 strict.db "ROLLBACK;"` 想撤销它。
- 最后一条 `SELECT` 看余额。

</div>

```text
812
1812
Error: stepping, cannot rollback - no transaction is active
812
```

第一行 812 是那个没提交的连接自己看到的;第二行新连接看到 1812:**没写 `COMMIT` 就退出,修改等于没做**。第三条没有 `BEGIN` 就直接 `UPDATE`,自动提交,已经生效;第四条 `ROLLBACK` 报「没有活动的事务」,第五条 812 证明它撤不回来了。

现在把三步扣款放进事务。这里有一个**容易以为已经修好了、其实没修好**的写法。先还原到「付过一次」的状态,然后新建 `part01/sql/pay_tx_naive.sql`:

```sql
-- agent-zero-lab/part01/sql/pay_tx_naive.sql
PRAGMA foreign_keys = ON;
BEGIN;
UPDATE accounts SET balance = balance - 1188 WHERE customer_id = 1;
INSERT INTO payments (invoice_id, amount, paid_at) VALUES (3, 1188, '2026-10-23');
UPDATE invoices SET status = 'paid' WHERE id = 3;
COMMIT;
```

<div class="line-notes">

- `BEGIN;` 开事务。
- `UPDATE accounts SET balance = balance - 1188 WHERE customer_id = 1;` 第 1 步。
- `INSERT INTO payments (invoice_id, amount, paid_at) VALUES (3, 1188, '2026-10-23');` 第 2 步,重试时会撞上 `UNIQUE`。
- `UPDATE invoices SET status = 'paid' WHERE id = 3;` 第 3 步。
- `COMMIT;` 提交。问题就在这里:命令行**读到哪句就执行哪句**,第 2 步报错之后还会继续读到这一行。

</div>

```bash
sqlite3 strict.db < strict.sql
sqlite3 strict.db < pay.sql
sqlite3 strict.db < pay_invoice3.sql
sqlite3 strict.db < pay_tx_naive.sql
sqlite3 -header strict.db < show_state.sql
```

<div class="line-notes">

- 前三行还原到「付过一次」:余额 1812。
- `sqlite3 strict.db < pay_tx_naive.sql` 重试,用的是带 `BEGIN`/`COMMIT` 的版本。
- `sqlite3 -header strict.db < show_state.sql` 看结果。

</div>

```text
Runtime error near line 5: UNIQUE constraint failed: payments.invoice_id (19)
what|value
balance|624
payments|1
invoice 3|paid
```

**余额还是 624,还是扣了两次。** 为什么?SQLite 的一条语句失败时,默认只撤销**这一条语句**自己,事务**继续开着**(这个行为叫 ABORT,见 [SQLite 官方文档](https://sqlite.org/lang_conflict.html))。第 2 步报错后,命令行接着读下一行,执行了第 3 步,又读到 `COMMIT`,把第 1 步的修改一起提交了。**事务本身没有「出错就自动撤回」的能力,要靠写这段代码的人在出错时主动执行 `ROLLBACK`。** 在你以后写的 Python 程序里,这是 `try: ... conn.commit() except: conn.rollback()`(Day 93 学);在命令行脚本里,最简单的办法是 `.bail on`:遇到第一个错误就停下来,不再读后面的行。

新建 `part01/sql/pay_tx.sql`,开头多一行:

```sql
-- agent-zero-lab/part01/sql/pay_tx.sql
.bail on
PRAGMA foreign_keys = ON;
BEGIN;
UPDATE accounts SET balance = balance - 1188 WHERE customer_id = 1;
INSERT INTO payments (invoice_id, amount, paid_at) VALUES (3, 1188, '2026-10-23');
UPDATE invoices SET status = 'paid' WHERE id = 3;
COMMIT;
```

<div class="line-notes">

- `.bail on` sqlite3 的点命令:遇到第一个错误就**停止**读取后面的内容,命令行以非零退出码退出。
- `BEGIN;` 开事务。
- `INSERT INTO payments (invoice_id, amount, paid_at) VALUES (3, 1188, '2026-10-23');` 重试时在这里出错,`.bail on` 让命令行立刻停下,**读不到后面的 `COMMIT`**。
- `COMMIT;` 只有三步都成功才会走到这一行。没走到的话,连接关闭时事务没提交,自动当作 `ROLLBACK`。

</div>

```bash
sqlite3 strict.db < strict.sql
sqlite3 strict.db < pay.sql
sqlite3 strict.db < pay_invoice3.sql
sqlite3 strict.db < pay_tx.sql; echo "退出码 $?"
sqlite3 -header strict.db < show_state.sql
```

<div class="line-notes">

- 前三行还原到「付过一次」。
- `sqlite3 strict.db < pay_tx.sql; echo "退出码 $?"` 重试:用带 `.bail on` 的事务版本。`$?` 是上一条命令的退出码。
- `sqlite3 -header strict.db < show_state.sql` 看结果。

</div>

```text
Runtime error near line 6: UNIQUE constraint failed: payments.invoice_id (19)
退出码 1
what|value
balance|1812
payments|1
invoice 3|paid
```

**余额还是 1812。** 第 1 步扣的钱随着连接结束被撤回了,付款记录还是 1 条,发票还是已付,和重试之前一模一样。重试被拒绝了,而且没有任何副作用,退出码 1 告诉调用方「没成功」。再验证第一次就走事务版本是正常的(用全新的库):

```bash
sqlite3 strict.db < strict.sql
sqlite3 strict.db < pay.sql
sqlite3 strict.db < pay_tx.sql; echo "退出码 $?"
sqlite3 -header strict.db < show_state.sql
```

<div class="line-notes">

- 前两行重建一个干净的库:余额 3000,没有付款。
- `sqlite3 strict.db < pay_tx.sql; echo "退出码 $?"` 第一次付款,走事务版本。
- `sqlite3 -header strict.db < show_state.sql` 看结果。

</div>

```text
退出码 0
what|value
balance|1812
payments|1
invoice 3|paid
```

退出码 0,三步全部生效。**一件事的所有步骤放进同一个事务,成功就 `COMMIT`,任何一步出错就 `ROLLBACK`**,是这一课最要记住的一句话。

## 第 6 步:ACID,以及两个人同时写会怎样

事务提供的保证,有一个流传很广的缩写 **ACID**。每个字母用一句话和今天的实验对上:

| 字母 | 英文 | 意思 | 今天哪里见到 |
| --- | --- | --- | --- |
| A | Atomicity 原子性 | 一个事务里的修改,要么全部生效,要么全部不生效 | 第 5 步:第 2 步出错,第 1 步的扣款一起撤回 |
| C | Consistency 一致性 | 事务前后,数据都满足约束规定的规矩 | 第 2 步:约束挡住不合规的数据;事务提交前所有约束都得满足 |
| I | Isolation 隔离性 | 别人看不到你没提交的中间状态,同时写互不踩踏 | 下面这个实验 |
| D | Durability 持久性 | 提交成功之后,即使马上断电,数据也不会丢 | 没法在终端里演示拔电源,靠数据库写盘前先写日志文件 |

**隔离性**可以在终端里亲眼看一下。用两个连接模拟「两个人同时在操作」:第一个连接开事务扣款,然后停 3 秒再提交;这 3 秒里,另一个连接去读、去写。(先还原到「付过一次」:余额 1812。)

```bash
sqlite3 strict.db < strict.sql
sqlite3 strict.db < pay.sql
sqlite3 strict.db < pay_invoice3.sql
{ echo "BEGIN IMMEDIATE;"; echo "UPDATE accounts SET balance = balance - 100 WHERE customer_id = 1;"; sleep 3; echo "COMMIT;"; } | sqlite3 strict.db &
sleep 1
echo "-- 另一个连接读:"; sqlite3 strict.db "SELECT balance FROM accounts WHERE customer_id = 1;"
echo "-- 另一个连接写:"; sqlite3 strict.db "UPDATE accounts SET balance = balance - 1 WHERE customer_id = 1;"
echo "-- 另一个连接写(最多等 5 秒):"; time sqlite3 strict.db ".timeout 5000" "UPDATE accounts SET balance = balance - 1 WHERE customer_id = 1;"
wait
sqlite3 strict.db "SELECT balance FROM accounts WHERE customer_id = 1; PRAGMA journal_mode;"
```

<div class="line-notes">

- `{ echo "BEGIN IMMEDIATE;"; echo "UPDATE accounts SET balance = balance - 100 WHERE customer_id = 1;"; sleep 3; echo "COMMIT;"; } | sqlite3 strict.db &` 花括号里依次输出四样东西:`BEGIN IMMEDIATE;`(开事务,并**立刻**占住写的权利)、一条扣 100 的 `UPDATE`、停 3 秒、`COMMIT;`。它们通过管道喂给第一个 `sqlite3`;最后的 `&` 让整件事在**后台**跑,终端马上可以继续输入。
- `sleep 1` 等 1 秒,确保后台的事务已经开始、已经扣了 100 但还没提交。
- `echo "-- 另一个连接读:"; sqlite3 strict.db "SELECT balance FROM accounts WHERE customer_id = 1;"` 第二个连接去**读**余额,它看到什么?
- `echo "-- 另一个连接写:"; sqlite3 strict.db "UPDATE accounts SET balance = balance - 1 WHERE customer_id = 1;"` 第二个连接去**写**,默认立刻尝试,不等待。
- `time sqlite3 strict.db ".timeout 5000" "UPDATE accounts SET balance = balance - 1 WHERE customer_id = 1;"` 同样去写,但先 `.timeout 5000`:被占用时最多等 5000 毫秒再试。`time` 报告这条命令花了多久。
- `wait` 等后台那个事务结束。
- `sqlite3 strict.db "SELECT balance FROM accounts WHERE customer_id = 1; PRAGMA journal_mode;"` 最后看余额,并顺便问一下 SQLite 的日志模式。

</div>

```text
-- 另一个连接读:
1812
-- 另一个连接写:
Error: stepping, database is locked (5)
-- 另一个连接写(最多等 5 秒):
sqlite3 strict.db ".timeout 5000"   0.00s user 0.01s system 0% cpu 2.007 total
1711
delete
```

三个现象:

- **读:1812。** 第一个连接已经把余额扣成了 1712,可还没提交,别的连接看到的还是 1812。**别人看不到你没提交的修改**,这就是隔离。
- **写:`database is locked (5)`。** SQLite 同一时刻只允许一个连接写,第一个连接正占着,第二个连接直接被拒绝。
- **等 5 秒的写:成功了,花了约 2 秒。** 它一直在重试,2 秒后第一个连接提交释放了锁,它才拿到并写成功。

最后余额 1711:1812 - 100 - 1。只有那条「等了 2 秒」的写生效了,被拒绝的那条没有。`journal_mode` 是 `delete`,SQLite 默认的日志方式:修改磁盘前,先把原来的数据备份到一个临时的日志文件里;出事时靠它恢复,这就是「持久性」和「原子性」在 SQLite 里的实现(想了解细节:[SQLite 官方 · Atomic Commit](https://sqlite.org/atomiccommit.html))。

在 Agent 里这个现象会真实出现:同一个数据库被两个进程(比如 Web 服务和一个后台任务)同时写,会遇到 `database is locked`。对应的处理是:设置超时(`.timeout`、Python 的 `timeout=` 参数),失败就稍后重试,事务尽量写得**短**,不要在事务里等网络或调模型,否则一个慢请求会把所有写入都堵住。

## 第 7 步:Postgres 里长什么样(看一眼,不用跟着做)

同样的场景放到 Postgres(本机 Postgres 17 实跑,Day 228 起你会装)。建同样的四张表,外键永远生效,不用开开关:

```bash
psql -d w89_tx -f part01/sql/pay_pg.sql
psql -d w89_tx <<'EOF'
INSERT INTO invoices VALUES (15, 11, 156, 'unpaid');
INSERT INTO invoices VALUES (16, 1, -5, 'unpaid');
BEGIN;
UPDATE accounts SET balance = balance - 1188 WHERE customer_id = 1;
INSERT INTO payments (invoice_id, amount) VALUES (3, 1188);
INSERT INTO payments (invoice_id, amount) VALUES (3, 1188);
UPDATE invoices SET status = 'paid' WHERE id = 3;
COMMIT;
SELECT balance FROM accounts WHERE customer_id = 1;
SELECT count(*) FROM payments;
EOF
```

<div class="line-notes">

- `psql -d w89_tx -f part01/sql/pay_pg.sql` 建表脚本,和 SQLite 版几乎一样,只是类型写成 `integer`、`text`,自增主键写 `GENERATED ALWAYS AS IDENTITY`。库里有 1 号客户、3 号发票(1188 元)、1 号账户(余额 3000)。
- `INSERT INTO invoices VALUES (15, 11, 156, 'unpaid');` 孤儿发票:Postgres 不用开任何开关就拒绝。
- `INSERT INTO invoices VALUES (16, 1, -5, 'unpaid');` 负金额,违反 `CHECK`。
- `BEGIN;` 开事务。
- `INSERT INTO payments (invoice_id, amount) VALUES (3, 1188);` 第一次记付款,成功(在事务里)。
- 第二条一模一样的 `INSERT INTO payments`:模拟重试,撞上 `UNIQUE`。
- `COMMIT;` 事务里已经出过错,看这一句会发生什么。
- `SELECT balance FROM accounts WHERE customer_id = 1;` 最后看余额,`SELECT count(*) FROM payments;` 看付款记录数。

</div>

```text
ERROR:  insert or update on table "invoices" violates foreign key constraint "invoices_customer_id_fkey"
DETAIL:  Key (customer_id)=(11) is not present in table "customers".
ERROR:  new row for relation "invoices" violates check constraint "invoices_amount_check"
DETAIL:  Failing row contains (16, 1, -5, unpaid).
BEGIN
UPDATE 1
INSERT 0 1
ERROR:  duplicate key value violates unique constraint "payments_invoice_id_key"
DETAIL:  Key (invoice_id)=(3) already exists.
ERROR:  current transaction is aborted, commands ignored until end of transaction block
ROLLBACK
 balance 
---------
    3000
(1 row)

 count 
-------
     0
(1 row)
```

三个差别:

- **报错详细得多。** `DETAIL: Key (customer_id)=(11) is not present in table "customers"` 直接告诉你是哪一列、哪个值;CHECK 的报错连整行内容都贴出来。让模型读 Postgres 的报错自己修 SQL,比读 SQLite 的「FOREIGN KEY constraint failed」容易得多。
- **事务里出错,整个事务作废。** 第二条 `INSERT` 失败后,Postgres 把这个事务标记为「已中止」,后面的 `UPDATE` 被直接拒绝(`current transaction is aborted, commands ignored until end of transaction block`)。更要紧的是最后那个 `COMMIT`:它**没有提交**,服务器回的是 `ROLLBACK`。结果余额还是 3000,付款记录是 0:**所有修改被整个撤回了**,正好是 SQLite 里要靠 `.bail on` 才能做到的行为。
- **外键没有开关。** 不存在「忘了开」这回事。

这也是为什么学了 SQLite 打底,真正做 Agent 的业务库时一般用 Postgres:这些保护是默认的,不靠自觉。

## 和前端代码对照

| 做什么 | SQL | 前端里最像的东西 |
| --- | --- | --- |
| 必填 | `NOT NULL` | 表单 `required`、Zod 的非可选字段 |
| 取值范围 | `CHECK (seats > 0)` | Zod `.positive()`、`z.enum([...])` |
| 不许重复 | `UNIQUE` | 注册时「用户名已存在」的校验,但数据库版不会被并发绕过 |
| 必须指向真实存在的行 | `REFERENCES customers (id)` | 下拉框的值必须在选项列表里 |
| 删父行时的处理 | `ON DELETE CASCADE / SET NULL / 默认拒绝` | 删文件夹时「连里面的文件一起删」还是「有文件就不让删」 |
| 一组操作要么全做要么全不做 | `BEGIN ... COMMIT / ROLLBACK` | IndexedDB 的 `transaction`;乐观更新失败后整个还原 |
| 出错时撤回 | `ROLLBACK` | `try { ... } catch { 还原状态 }` |
| 没写 BEGIN | 每条语句自动提交 | 每次 `setState` 立刻生效,没有「撤销」 |

## 动手练习

每道题开始前,在 `part01/sql` 目录里按需要重建库:`sqlite3 strict.db < strict.sql` 再 `sqlite3 strict.db < pay.sql`;涉及 `practice.db` 的先 `rm -f practice.db` 再重跑 `customers.sql` 和 `invoices.sql`。

**练习 1:给旧表补上约束。** `practice.db` 里的 `invoices` 是没有任何约束的旧表,里面有 15 号孤儿发票。写一个 `rebuild_invoices.sql`,在**一个事务里**:把孤儿发票先备份到 `invoices_orphans` 表,建一张带外键和 CHECK 的新表 `invoices_new`,把配得上客户的 14 张搬过去,删掉旧表,把新表改名叫 `invoices`。跑完验证:发票 14 张、孤儿被留存、再插孤儿会被拒绝。

<details><summary>参考答案</summary>

```sql
-- agent-zero-lab/part01/sql/rebuild_invoices.sql
.bail on
PRAGMA foreign_keys = ON;
BEGIN;

CREATE TABLE invoices_orphans AS
SELECT i.*
FROM invoices i
LEFT JOIN customers c ON c.id = i.customer_id
WHERE c.id IS NULL;

CREATE TABLE invoices_new (
    id           INTEGER PRIMARY KEY,
    customer_id  INTEGER NOT NULL REFERENCES customers (id),
    amount       INTEGER NOT NULL CHECK (amount > 0),
    status       TEXT    NOT NULL CHECK (status IN ('paid', 'unpaid', 'refunded')),
    issued_at    TEXT    NOT NULL
);

INSERT INTO invoices_new
SELECT i.*
FROM invoices i
JOIN customers c ON c.id = i.customer_id;

DROP TABLE invoices;
ALTER TABLE invoices_new RENAME TO invoices;

COMMIT;
```

<div class="line-notes">

- `.bail on` 出错就停,保证事务不会被半途提交。
- `BEGIN;` 整个搬家放进一个事务:中间任何一步失败都整体撤回,不会出现「旧表删了、新表没建好」的悲剧。
- `CREATE TABLE invoices_orphans AS` `CREATE TABLE ... AS SELECT ...` 用一条查询的结果直接建一张新表,这里用来留存孤儿。
- `LEFT JOIN customers c ON c.id = i.customer_id` Day 87 的找孤儿写法:以发票为主,保住每一张发票。
- `WHERE c.id IS NULL;` 配不上客户的发票,也就是 15 号。
- `CREATE TABLE invoices_new (` 带全部约束的新表。因为外键和 CHECK 在 SQLite 里不能后加,所以重建。
- `INSERT INTO invoices_new` 搬数据:新表有外键和 CHECK 检查,搬进去的每一行都要过关。
- `JOIN customers c ON c.id = i.customer_id;` 用**内连接**,只搬配得上客户的 14 张,孤儿被自然排除在外。
- `DROP TABLE invoices;` 删旧表。
- `ALTER TABLE invoices_new RENAME TO invoices;` 把新表改成旧表的名字,别的代码不用改。
- `COMMIT;` 全部成功才提交。

</div>

```bash
cd /Users/你/agent-zero-lab/part01/sql
rm -f practice.db
sqlite3 practice.db < customers.sql
sqlite3 practice.db < invoices.sql
sqlite3 practice.db < rebuild_invoices.sql; echo "退出码 $?"
sqlite3 -header practice.db "SELECT count(*) AS invoices FROM invoices; SELECT * FROM invoices_orphans;"
sqlite3 practice.db ".schema invoices"
sqlite3 practice.db "PRAGMA foreign_keys = ON; INSERT INTO invoices VALUES (16, 11, 99, 'unpaid', '2026-10-23');"
sqlite3 practice.db "PRAGMA foreign_key_check; PRAGMA integrity_check;"
```

<div class="line-notes">

- `sqlite3 practice.db < rebuild_invoices.sql; echo "退出码 $?"` 执行搬家脚本,退出码 0 就是整个事务提交成功。
- `SELECT count(*) AS invoices FROM invoices; SELECT * FROM invoices_orphans;` 验证新表 14 张,孤儿被存在另一张表里。
- `.schema invoices` 看新表的定义,约束都在。
- `sqlite3 practice.db "PRAGMA foreign_keys = ON; INSERT INTO invoices VALUES (16, 11, 99, 'unpaid', '2026-10-23');"` 开外键再尝试插入一张孤儿发票。
- `PRAGMA foreign_key_check; PRAGMA integrity_check;` 体检:外键没有违反的行,整个数据库文件结构完好(`ok`)。

</div>

实跑输出:

```text
退出码 0
invoices
14
id|customer_id|amount|status|issued_at
15|11|156|unpaid|2026-10-23
CREATE TABLE IF NOT EXISTS "invoices" (
    id           INTEGER PRIMARY KEY,
    customer_id  INTEGER NOT NULL REFERENCES customers (id),
    amount       INTEGER NOT NULL CHECK (amount > 0),
    status       TEXT    NOT NULL CHECK (status IN ('paid', 'unpaid', 'refunded')),
    issued_at    TEXT    NOT NULL
);
Error: stepping, FOREIGN KEY constraint failed (19)
ok
```

14 张发票,15 号孤儿被留在 `invoices_orphans` 里没有丢;新表定义里有外键和两条 `CHECK`(改名之后 SQLite 把定义写成 `CREATE TABLE IF NOT EXISTS "invoices"`,是它改写的,不用管);再插孤儿被拒绝;体检干净。真实业务里,孤儿发票不能悄悄丢,要把它留下来交给人去查是谁的单。

</details>

**练习 2:自己设计约束。** 新建 `refunds.sql`:退款申请表 `refunds`,字段 `id`(主键)、`invoice_id`(必须是真实发票)、`amount`(正数)、`reason`(至少 2 个字)、`status`(只能是 `pending`、`approved`、`rejected`,不写默认 `pending`)。然后用六条 `INSERT` 逐个验证:一条正常(不写 `status`,看默认值)、五条各违反一种约束。

<details><summary>参考答案</summary>

```sql
-- agent-zero-lab/part01/sql/refunds.sql
PRAGMA foreign_keys = ON;
DROP TABLE IF EXISTS refunds;
CREATE TABLE refunds (
    id          INTEGER PRIMARY KEY,
    invoice_id  INTEGER NOT NULL REFERENCES invoices (id),
    amount      INTEGER NOT NULL CHECK (amount > 0),
    reason      TEXT    NOT NULL CHECK (length(reason) >= 2),
    status      TEXT    NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected'))
);
```

<div class="line-notes">

- `invoice_id  INTEGER NOT NULL REFERENCES invoices (id),` 退款必须挂在一张真实存在的发票上。
- `amount      INTEGER NOT NULL CHECK (amount > 0),` 金额为正。
- `reason      TEXT    NOT NULL CHECK (length(reason) >= 2),` `length(文本)` 返回字符数,至少 2 个字,挡住空串。
- `status      TEXT    NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected'))` `DEFAULT 'pending'` 是**默认值**:`INSERT` 不写这一列时自动填 `'pending'`;后面的 `CHECK` 照样检查,不会让「默认值」绕过规矩。

</div>

```bash
cd /Users/你/agent-zero-lab/part01/sql
sqlite3 practice.db < refunds.sql
t() { sqlite3 practice.db "PRAGMA foreign_keys = ON; $1" 2>&1; }
t "INSERT INTO refunds (invoice_id, amount, reason) VALUES (3, 500, '重复扣款'); SELECT * FROM refunds;"
t "INSERT INTO refunds (invoice_id, amount, reason) VALUES (999, 500, '重复扣款');"
t "INSERT INTO refunds (invoice_id, amount, reason) VALUES (3, 0, '重复扣款');"
t "INSERT INTO refunds (invoice_id, amount, reason) VALUES (3, 500, '');"
t "INSERT INTO refunds (invoice_id, amount, reason, status) VALUES (3, 500, '重复扣款', 'done');"
t "INSERT INTO refunds (invoice_id, amount) VALUES (3, 500);"
sqlite3 -header practice.db "SELECT * FROM refunds;"
```

<div class="line-notes">

- `sqlite3 practice.db < refunds.sql` 在**练习 1 搬完家之后**的 `practice.db` 上建退款表(此时 `invoices` 已经是 14 张、带约束的新表)。
- `t() { sqlite3 practice.db` 同第 2 步的小函数,每次先开外键。
- `VALUES (3, 500, '重复扣款'); SELECT * FROM refunds;` 正常的一条,没写 `status`。
- `VALUES (999, 500, '重复扣款');` 发票 999 不存在,违反外键。
- `VALUES (3, 0, '重复扣款');` 金额 0,违反 `amount > 0`。
- `VALUES (3, 500, '');` 理由是空串,违反 `length(reason) >= 2`。
- `'重复扣款', 'done');` 状态 `done` 不在三选一里。
- `INSERT INTO refunds (invoice_id, amount) VALUES (3, 500);` 没写理由这一列,`reason` 是 NOT NULL 又没有默认值,被拒绝。
- 最后 `SELECT * FROM refunds;` 确认表里只有第一条。

</div>

实跑输出:

```text
1|3|500|重复扣款|pending
Error: stepping, FOREIGN KEY constraint failed (19)
Error: stepping, CHECK constraint failed: amount > 0 (19)
Error: stepping, CHECK constraint failed: length(reason) >= 2 (19)
Error: stepping, CHECK constraint failed: status IN ('pending', 'approved', 'rejected') (19)
Error: stepping, NOT NULL constraint failed: refunds.reason (19)
id|invoice_id|amount|reason|status
1|3|500|重复扣款|pending
```

第一条没写 `status`,表里自动填了 `pending`;后面五条各被一种约束拒绝,最终表里只有一行。这张表也是 Day 83 退款申请服务的数据库版:`ticket_id`、`amount_cents` 在 API 层的校验(pydantic),现在在数据库层也有一份。**两层都留着**,谁漏了另一层还能兜底。

</details>

**练习 3(观察题):钱凭空变多。** 新建 `tr.db`,表 `accounts(id, balance)`,`balance` 带 `CHECK (balance >= 0)`,1 号余额 3000、2 号余额 500。把「2 号转 800 给 1 号」写成两条语句:先给 1 号加 800,再从 2 号扣 800。**不用事务**执行一次,看余额和总和;还原后,**用事务加 `.bail on`** 再执行一次,比较。

<details><summary>参考答案</summary>

```bash
cd /Users/你/agent-zero-lab/part01/sql
rm -f tr.db
sqlite3 tr.db "CREATE TABLE accounts (id INTEGER PRIMARY KEY, balance INTEGER NOT NULL CHECK (balance >= 0)); INSERT INTO accounts VALUES (1, 3000), (2, 500);"
cat > transfer_naive.sql <<'EOF'
-- agent-zero-lab/part01/sql/transfer_naive.sql
UPDATE accounts SET balance = balance + 800 WHERE id = 1;
UPDATE accounts SET balance = balance - 800 WHERE id = 2;
EOF
cat > transfer_tx.sql <<'EOF'
-- agent-zero-lab/part01/sql/transfer_tx.sql
.bail on
BEGIN;
UPDATE accounts SET balance = balance + 800 WHERE id = 1;
UPDATE accounts SET balance = balance - 800 WHERE id = 2;
COMMIT;
EOF
sqlite3 tr.db "SELECT id, balance FROM accounts; SELECT sum(balance) AS total FROM accounts;"
sqlite3 tr.db < transfer_naive.sql
sqlite3 tr.db "SELECT id, balance FROM accounts; SELECT sum(balance) AS total FROM accounts;"
sqlite3 tr.db "UPDATE accounts SET balance = 3000 WHERE id = 1;"
sqlite3 tr.db < transfer_tx.sql
sqlite3 tr.db "SELECT id, balance FROM accounts; SELECT sum(balance) AS total FROM accounts;"
```

<div class="line-notes">

- `sqlite3 tr.db "CREATE TABLE accounts (id INTEGER PRIMARY KEY, balance INTEGER NOT NULL CHECK (balance >= 0)); INSERT INTO accounts VALUES (1, 3000), (2, 500);"` 一条命令里建表并放初始数据。
- `cat > transfer_naive.sql <<'EOF'` 用 here-document 写出文件(你也可以用编辑器新建)。这个版本没有事务,先加后减。
- `UPDATE accounts SET balance = balance + 800 WHERE id = 1;` 先给 1 号加 800,这一句不会失败。
- `UPDATE accounts SET balance = balance - 800 WHERE id = 2;` 再从 2 号扣 800:2 号只有 500,扣完是 -300,违反 `CHECK (balance >= 0)`,失败。
- `cat > transfer_tx.sql <<'EOF'` 事务版本:`.bail on`、`BEGIN`、同样两句、`COMMIT`。
- 第一个 `SELECT id, balance FROM accounts; SELECT sum(balance) AS total FROM accounts;` 初始状态:3000 和 500,总和 3500。
- `sqlite3 tr.db < transfer_naive.sql` 不用事务的转账。
- `sqlite3 tr.db "UPDATE accounts SET balance = 3000 WHERE id = 1;"` 把 1 号还原成 3000,准备第二次实验。
- `sqlite3 tr.db < transfer_tx.sql` 用事务的转账。

</div>

实跑输出:

```text
1|3000
2|500
3500
Runtime error near line 3: CHECK constraint failed: balance >= 0 (19)
1|3800
2|500
4300
Runtime error near line 5: CHECK constraint failed: balance >= 0 (19)
1|3000
2|500
3500
```

没有事务:报错之后 1 号已经加了 800(3800),2 号没扣成(500),**总和从 3500 变成 4300,凭空多出 800 元**。用事务加 `.bail on`:同样报错,但 1 号加的 800 被撤回,总和还是 3500。**转账前后总额不变**是金额系统最基本的不变量,事务就是用来守它的。这个例子也说明约束和事务要配合:`CHECK` 负责发现「2 号钱不够」,事务负责让前一步的修改不留痕迹。

</details>

**练习 4:让重试安全。** 回到第 4 步的三步扣款。有两个办法让重试时不扣第二遍:一是把 `INSERT INTO payments`(会撞 `UNIQUE` 的那步)排到第一步,二是整个放进事务。分别写出 `pay_ordered.sql`(只调顺序,不用事务)和 `pay_ordered_tx.sql`(调顺序加事务),在四种场景下比较:A 首次付款 + 重试;B 余额只有 1000(不够)且不用事务;C 余额只有 1000 且用事务;D 余额够,用事务,首次 + 重试。哪种写法才是对的?

<details><summary>参考答案</summary>

```sql
-- agent-zero-lab/part01/sql/pay_ordered.sql
.bail on
PRAGMA foreign_keys = ON;
INSERT INTO payments (invoice_id, amount, paid_at) VALUES (3, 1188, '2026-10-23');
UPDATE accounts SET balance = balance - 1188 WHERE customer_id = 1;
UPDATE invoices SET status = 'paid' WHERE id = 3;
```

```sql
-- agent-zero-lab/part01/sql/pay_ordered_tx.sql
.bail on
PRAGMA foreign_keys = ON;
BEGIN;
INSERT INTO payments (invoice_id, amount, paid_at) VALUES (3, 1188, '2026-10-23');
UPDATE accounts SET balance = balance - 1188 WHERE customer_id = 1;
UPDATE invoices SET status = 'paid' WHERE id = 3;
COMMIT;
```

<div class="line-notes">

- `.bail on` 出错就停。两份文件都有。
- `BEGIN;` 第二份文件多了事务,首尾包住三步。
- `INSERT INTO payments (invoice_id, amount, paid_at) VALUES (3, 1188, '2026-10-23');` 先记付款:重试时第一步就撞上 `UNIQUE`,后面的扣款根本没机会执行。
- `UPDATE accounts SET balance = balance - 1188 WHERE customer_id = 1;` 再扣余额:余额不够时撞上 `CHECK (balance >= 0)`。
- `COMMIT;` 都成功才提交。

</div>

四种场景(每个场景开头都用 `fresh` 重建库):

```bash
fresh() { sqlite3 strict.db < strict.sql; sqlite3 strict.db < pay.sql; }
echo "## A 顺序调整,首次 + 重试"; fresh; sqlite3 strict.db < pay_ordered.sql; sqlite3 -header strict.db < show_state.sql; sqlite3 strict.db < pay_ordered.sql; sqlite3 -header strict.db < show_state.sql
echo "## B 余额不足 无事务"; fresh; sqlite3 strict.db "UPDATE accounts SET balance = 1000 WHERE customer_id = 1;"; sqlite3 strict.db < pay_ordered.sql; sqlite3 -header strict.db < show_state.sql
echo "## C 余额不足 有事务"; fresh; sqlite3 strict.db "UPDATE accounts SET balance = 1000 WHERE customer_id = 1;"; sqlite3 strict.db < pay_ordered_tx.sql; sqlite3 -header strict.db < show_state.sql
echo "## D 余额够 有事务,首次 + 重试"; fresh; sqlite3 strict.db < pay_ordered_tx.sql; sqlite3 strict.db < pay_ordered_tx.sql; sqlite3 -header strict.db < show_state.sql
```

<div class="line-notes">

- `fresh() { sqlite3 strict.db < strict.sql; sqlite3 strict.db < pay.sql; }` 一个还原用的函数:重建四张表,余额 3000,没有付款。
- `echo "## A 顺序调整,首次 + 重试"` 场景 A:不带事务、先记付款的版本,中间各看一次状态。
- `echo "## B 余额不足 无事务"` 场景 B:先 `UPDATE accounts SET balance = 1000` 把余额改成 1000,比发票的 1188 少,再跑不带事务的版本。
- `echo "## C 余额不足 有事务"` 场景 C:同样的余额不足,换成带事务的版本。
- `echo "## D 余额够 有事务,首次 + 重试"` 场景 D:余额够,带事务版本连跑两次。

</div>

实跑输出:

```text
## A 顺序调整,首次 + 重试
what|value
balance|1812
payments|1
invoice 3|paid
Runtime error near line 4: UNIQUE constraint failed: payments.invoice_id (19)
what|value
balance|1812
payments|1
invoice 3|paid
## B 余额不足 无事务
Runtime error near line 5: CHECK constraint failed: balance >= 0 (19)
what|value
balance|1000
payments|1
invoice 3|unpaid
## C 余额不足 有事务
Runtime error near line 6: CHECK constraint failed: balance >= 0 (19)
what|value
balance|1000
payments|0
invoice 3|unpaid
## D 余额够 有事务,首次 + 重试
Runtime error near line 5: UNIQUE constraint failed: payments.invoice_id (19)
what|value
balance|1812
payments|1
invoice 3|paid
```

- **A**:调了顺序,重试时第一步就被 `UNIQUE` 拦住,后面没执行,余额停在 1812,重试安全。
- **B**:顺序调了、没事务,换一种失败(余额不够)就出事:`payments` 已经记了 1 条,但余额没扣、发票还是未付。**付款记录说钱收了,账上其实没收。** 调顺序只能躲过一种失败。
- **C**:加了事务,同样的失败整体撤回:`payments` 是 0,什么都没留下。
- **D**:事务版本重试,安全。

结论:**事务才是根本办法**;顺序调整只是让重试更早失败的小技巧,两个一起用最好。`UNIQUE` 约束在这里扮演了「幂等键」的角色:同一张发票的付款只能记一次,不管调用方重试多少遍,结果只有一次。你后面做的 Agent 工具(Day 190 讲的重试)就要靠这类约束保证「重试不会重复扣款」。

</details>

**练习 5(观察题):先读后写,两个人一起改。** 把 1 号账户余额放一张叫 `lu.db` 的新库里(1812)。模拟两个并发的「程序」:A 和 B 各自先读出余额,再各自算出「余额 - 100」写回去。看最终余额。再换成一条 `UPDATE accounts SET balance = balance - 100`,让两个各执行一次,再看。

<details><summary>参考答案</summary>

```bash
cd /Users/你/agent-zero-lab/part01/sql
rm -f lu.db
sqlite3 lu.db "CREATE TABLE accounts (id INTEGER PRIMARY KEY, balance INTEGER NOT NULL); INSERT INTO accounts VALUES (1, 1812);"
a=$(sqlite3 lu.db "SELECT balance FROM accounts WHERE id = 1;")
b=$(sqlite3 lu.db "SELECT balance FROM accounts WHERE id = 1;")
echo "A 读到 $a, B 读到 $b"
sqlite3 lu.db "UPDATE accounts SET balance = $((a - 100)) WHERE id = 1;"
sqlite3 lu.db "UPDATE accounts SET balance = $((b - 100)) WHERE id = 1;"
sqlite3 lu.db "SELECT balance FROM accounts WHERE id = 1;"
sqlite3 lu.db "UPDATE accounts SET balance = 1812 WHERE id = 1;"
sqlite3 lu.db "UPDATE accounts SET balance = balance - 100 WHERE id = 1;"
sqlite3 lu.db "UPDATE accounts SET balance = balance - 100 WHERE id = 1;"
sqlite3 lu.db "SELECT balance FROM accounts WHERE id = 1;"
```

<div class="line-notes">

- `a=$(sqlite3 lu.db "SELECT balance FROM accounts WHERE id = 1;")` 程序 A 先读:把余额存进 shell 变量 `a`。`$( )` 是「执行里面的命令,把输出拿来用」。
- `b=$(sqlite3 lu.db "SELECT balance FROM accounts WHERE id = 1;")` 程序 B 在 A 写回去**之前**也读了一次,读到的是同一个旧值。这就是「同时」。
- `echo "A 读到 $a, B 读到 $b"` 两个人读到的都是 1812。
- `sqlite3 lu.db "UPDATE accounts SET balance = $((a - 100)) WHERE id = 1;"` A 在自己手里算 `1812 - 100 = 1712`,把**结果**写回去。`$(( ))` 是 shell 里的算术。
- `sqlite3 lu.db "UPDATE accounts SET balance = $((b - 100)) WHERE id = 1;"` B 手里的 `b` 还是旧的 1812,算出同样的 1712,把它写回去,**覆盖了 A 的结果**。
- `sqlite3 lu.db "UPDATE accounts SET balance = 1812 WHERE id = 1;"` 把余额还原,做第二组对照。
- `sqlite3 lu.db "UPDATE accounts SET balance = balance - 100 WHERE id = 1;"` 第二种写法:让数据库自己在写的那一刻算。两个人各执行一次(下一行同样一条)。

</div>

实跑输出:

```text
A 读到 1812, B 读到 1812
1712
1612
```

第一组:两个人各扣了 100,最后余额是 1712,**只扣了一次**,A 的修改被 B 覆盖丢了。这叫**丢失更新**(lost update):「先读出来、在程序里算、再写回去」,读和写之间隔着一段时间,别人可以趁虚而入。第二组:`SET balance = balance - 100` 让数据库在写的那一刻读取当前值再算,两次下来是 1612,**扣了两次**,正确。**能让数据库一句话算完的,就不要读出来自己算**;确实需要读了再写时(比如要根据余额判断能不能扣),要把读和写放进同一个事务,并在读的时候加锁(`BEGIN IMMEDIATE`,Postgres 里是 `SELECT ... FOR UPDATE`)。Agent 里这个坑特别容易出现:模型并行调用两个工具,都先查余额再扣款。

</details>

验收标准:五道题都在自己终端里跑通;能不看文章写出带 `NOT NULL`、`UNIQUE`、`CHECK`、`REFERENCES` 的建表语句;能写出一个 `BEGIN ... COMMIT` 事务并说清「为什么命令行里要配 `.bail on`」;能解释「为什么 SQLite 里孤儿发票插得进去」。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 约束(constraint) | 写在表定义里、数据库自己强制检查的规则,违反就拒绝写入 |
| 主键(`PRIMARY KEY`) | 每行唯一的编号,不能重复也不能为空 |
| `NOT NULL` | 这一列必须有值 |
| `UNIQUE` | 这一列不允许出现两个相同的值,NULL 例外(可以有多个) |
| `CHECK` | 括号里写一个条件,新值必须使它成立 |
| `DEFAULT` | 插入时没写这一列,就自动填的值 |
| 外键(`FOREIGN KEY` / `REFERENCES`) | 这一列的值必须是另一张表里某一行的主键 |
| 父表与子表 | 被引用的表(如 `customers`)叫父表,引用它的表(如 `invoices`)叫子表 |
| `ON DELETE CASCADE` | 删父行时,指着它的子行一起删 |
| `ON DELETE SET NULL` | 删父行时,子行的外键列改成 NULL |
| `PRAGMA foreign_keys` | SQLite 的外键开关,默认关,每个连接要自己打开 |
| `PRAGMA foreign_key_check` | 体检命令,列出所有违反外键的行 |
| 事务(transaction) | 把几条语句捆成不可分的一件事,全部生效或全部撤销 |
| `BEGIN` / `COMMIT` / `ROLLBACK` | 开始事务 / 确认生效 / 全部撤销 |
| 自动提交(autocommit) | 没写 `BEGIN` 时,每条语句自己是一个事务,执行完立刻生效 |
| ACID | 原子性、一致性、隔离性、持久性,事务的四个保证 |
| 孤儿行 | 外键指向的父行不存在的子行,比如 15 号发票 |
| `.bail on` | sqlite3 点命令,遇到第一个错误就停止读取后面的内容 |
| 丢失更新(lost update) | 两个人先读后写,后写的覆盖了先写的,一次修改丢了 |
| `database is locked` | SQLite 同时只许一个连接写,别人正写时你会收到这条 |
| 幂等 | 同一个操作重复执行多次,结果和执行一次相同 |

## 常见误区

**以为 SQLite 的外键默认生效。** 实测不开 `PRAGMA foreign_keys = ON`,孤儿发票照样插进去,没有任何警告;开关只对当前连接有效,每个连接都要开。用 `PRAGMA foreign_key_check` 给已有数据体检。

**事务里出错,以为会自动回滚。** SQLite 里一条语句失败只撤销它自己,事务继续开着,后面的 `COMMIT` 会把前面的修改一起提交(实测余额又扣了一遍,624)。要在出错时主动 `ROLLBACK`,命令行脚本用 `.bail on`。

**只靠 `UNIQUE` 约束就以为重试安全。** 它拦住了重复的付款记录,拦不住前一步已经做完的扣款(实测 1812 变 624)。一件事的几步要放进同一个事务。

**调整语句顺序当成修复。** 先记付款再扣款,能躲过重试这一种失败,换成余额不足就出事(实测付款记了 1 条、钱没扣、发票未付)。事务才是根本办法。

**`UNIQUE` 的列不能有两个 NULL。** 可以,实测两个邮箱为 NULL 的客户都插进去了。想「必填且不重复」就写 `NOT NULL UNIQUE`。

**给账单表的外键随手加 `ON DELETE CASCADE`。** 删一个客户,发票、付款全部跟着消失。账单类数据保持默认的「有子行就不许删」。

**先读出来在程序里算、再写回去。** 两个并发的请求会互相覆盖(实测两个人各扣 100,只扣了一次)。能用 `SET balance = balance - 100` 一句话算完,就别拆成两步。

**在事务里等网络、等模型。** 事务开着的时候,别的连接写不进来(实测 `database is locked`)。事务只放数据库操作,越短越好。

**以为约束可以后加。** SQLite 不能给已有的表直接加外键或 CHECK,要建新表、搬数据、改名(练习 1);Postgres 可以用 `ALTER TABLE ... ADD CONSTRAINT`。所以建表时就要想好。

**把前端校验和后端校验当成够用。** 两层都能被绕过或漏掉,数据库约束是最后一道门。三层都留着。

## 学习资料

### 文档与文章

- [SQLite 官方 · Foreign Key Support(英文)](https://sqlite.org/foreignkeys.html):外键的完整说明,包括「默认关闭、每个连接要开」「`ON DELETE` 的各种动作」「不能用 ADD COLUMN 加带外键的列」。
- [SQLite 官方 · Transaction(英文)](https://sqlite.org/lang_transaction.html):`BEGIN`、`COMMIT`、`ROLLBACK` 和事务的几种开始方式(`DEFERRED`、`IMMEDIATE`、`EXCLUSIVE`)。
- [SQLite 官方 · CREATE TABLE(英文)](https://sqlite.org/lang_createtable.html):所有约束的语法。
- [SQLite 官方 · ON CONFLICT(英文)](https://sqlite.org/lang_conflict.html):语句失败时的几种处理,默认的 `ABORT` 就是今天看到的「只撤销这一条语句」。
- [SQLite 官方 · Atomic Commit In SQLite(英文)](https://sqlite.org/atomiccommit.html):SQLite 怎么靠日志文件做到原子提交,想知道 ACID 的实现可以读。
- [菜鸟教程 · SQLite 约束](https://www.runoob.com/sqlite/sqlite-constraints.html)和 [SQLite 事务](https://www.runoob.com/sqlite/sqlite-transaction.html):中文,语法速查。
- [PostgreSQL 官方教程 · Transactions(英文)](https://www.postgresql.org/docs/current/tutorial-transactions.html)和 [Constraints(英文)](https://www.postgresql.org/docs/current/ddl-constraints.html):第 7 步 Postgres 行为的出处。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1JG4y1Q7BX&autoplay=0&high_quality=1" title="5分钟精通数据库事务-ACID和三大问题" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>猿人林克 · 5分钟精通数据库事务-ACID和三大问题 · 约 7 分钟,播放 5 万,2023 年发布。讲 ACID 四个字和并发时的脏读、不可重复读、幻读,对应第 5、6 步。后三个问题今天没展开,看一眼知道有这回事。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1Vt4y1E7qF&autoplay=0&high_quality=1" title="MySQL数据库：外键约束" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>这丸子 · MySQL 数据库:外键约束 · 约 10 分钟,播放 3.8 万,2022 年发布。用 MySQL 演示,外键的语法和报错和 SQLite 略有不同,但概念完全一致,对应第 1、3 步。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/pomxJOFVcQs" title="Relational Database ACID Transactions (Explained by Example)" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Hussein Nasser · Relational Database ACID Transactions (Explained by Example) · 英文,可开字幕。用具体例子讲 ACID,和今天第 6 步的表对照着看。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/5kiMg7GXAsY" title="What is a Foreign Key Constraint? Understanding Primary & Foreign Keys" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>CockroachDB · What is a Foreign Key Constraint? Understanding Primary &amp; Foreign Keys · 英文,可开字幕。主键和外键的关系,配动画,对应第 1、3 步。</figcaption>
</figure>

### 书籍

- Ben Forta,《SQL必知必会》(第 5 版),人民邮电出版社(原书 *Sams Teach Yourself SQL in 10 Minutes a Day*,5th ed.,2019)。有专门讲「使用事务处理」和「约束」的课,和今天一一对应。
- Martin Kleppmann、Chris Riccomini,《Designing Data-Intensive Applications》(第 2 版,O'Reilly,2026;第 1 版 2017 年只有 Kleppmann 一位作者,中文译本《设计数据密集型应用》由清华大学出版社出版,具体版次以出版社页面为准)。有专门一章讲事务,把 ACID、隔离级别、丢失更新讲得最透,现在读会有点深,以后做多个服务同时写数据时回来看。

### 开源项目与代码

今天这组不需要。想看真实的约束长什么样,Day 94 做 CloudLedger 迷你账单库时,你自己设计的表就会带上今天学的这些约束。

## 自测

1. SQLite 里,下面这条发票插得进去吗?为什么?`INSERT INTO invoices VALUES (20, 999, 100, 'unpaid', '2026-10-23');`(`invoices.customer_id` 有 `REFERENCES customers (id)`,客户 999 不存在。)

<details><summary>答案</summary>

取决于这个连接有没有执行 `PRAGMA foreign_keys = ON`。SQLite 的外键检查默认关闭,而且只对当前连接生效;没开的话这条会成功,变成一张孤儿发票,没有任何警告。开了的话报 `FOREIGN KEY constraint failed`。Postgres 里外键永远生效,没有这个问题。

</details>

2. `UNIQUE` 约束的列里,能不能有两行都是 NULL?想让「邮箱必填且不重复」怎么写?

<details><summary>答案</summary>

可以有多行 NULL:NULL 表示「不知道」,两个不知道不算相等(实测 4 号客户的邮箱是 NULL,另插两个 NULL 邮箱的客户都成功)。要「必填且不重复」写 `email TEXT NOT NULL UNIQUE`。

</details>

3. 一个事务里有三条语句,第二条因为违反约束失败了,命令行没有停下来继续执行了第三条和 `COMMIT`。SQLite 最后会提交哪些修改?

<details><summary>答案</summary>

第一条和第三条的修改会被提交,只有失败的第二条自己被撤销。SQLite 里一条语句失败只撤销这条语句本身,事务继续开着,后面的 `COMMIT` 把剩下的都提交了(实测余额被扣了第二遍)。所以出错时要主动 `ROLLBACK`;命令行脚本里用 `.bail on` 让它在第一个错误处停下,没执行到的 `COMMIT` 等于没提交,连接关闭时自动回滚。

</details>

4. 「两个人同时从余额 1812 里扣 100」,为什么 `UPDATE accounts SET balance = balance - 100` 不会丢失更新,而「先 SELECT 出余额,在程序里减 100,再 UPDATE 写回」会?

<details><summary>答案</summary>

后者在读和写之间有一段间隔,另一个人可以在这段时间里读到同一个旧值,两个人各自算出 1712 写回,后写的覆盖前写的,只扣了一次(实测最终 1712)。前者由数据库在写的那一刻读取当前值并计算,而且同一时刻只有一个连接能写,两次执行自然叠加成 1612。需要「读了再决定」时,要把读写放进同一个事务并加锁(SQLite 用 `BEGIN IMMEDIATE`,Postgres 用 `SELECT ... FOR UPDATE`)。

</details>

5. 面试题:Agent 有个工具 `create_refund_request(invoice_id, amount)`,模型有时会因为超时重试,同一张发票提交两次。你怎么保证不产生两条退款申请?数据库层和应用层各做什么?

<details><summary>答案</summary>

数据库层:退款表上给 `invoice_id`(或「发票加一次业务请求编号」)加 `UNIQUE` 约束,第二条插入必然失败,这是最后一道门,不依赖任何代码路径;`amount`、`status` 加 `CHECK`,`invoice_id` 加外键;如果创建退款还要改发票状态等其他表,所有步骤放进同一个事务。应用层:工具接收一个由调用方生成、重试时不变的**幂等键**(idempotency key),存进有 `UNIQUE` 的列;撞上唯一约束时,不当作错误,而是查出已有的那条申请原样返回,让模型看到「已经提交过,编号是 X」,不要重复创建。这样重试多少次,结果都是一条。Day 190 讲重试时会再提这件事。

</details>

6. 面试题:你做的「问数 Agent」让模型生成 SQL。数据库为什么该用只读账号,以及模型执行的写操作(如果需要)该怎么套事务?

<details><summary>答案</summary>

只读账号是最后一道防线:不管模型写出 `DELETE` 还是 `UPDATE` 忘了 `WHERE`(Day 86 的事故),数据库自己拒绝,不依赖提示词或代码检查。必须有写操作时:把一次工具调用的所有语句放进一个事务,出错就整体 `ROLLBACK`;先在事务里执行,把受影响行数和结果给人或另一个检查步骤看,确认后才 `COMMIT`(「预演后提交」);事务保持短,不要在事务里等模型回复,以免锁住其他写入;表上有约束,模型写出不合规数据时,数据库的报错会成为它能读懂并修正的反馈。

</details>

## 明天预告

Day 92 · Python 操作 SQLite(一):查询和参数化防注入。这三天你一直在 `sqlite3` 命令行里敲 SQL,而 Agent 是用 Python 写的程序在运行时拼出 SQL、查出结果。明天把今天和前面的内容接进 Python:用标准库 `sqlite3` 连接 `practice.db`,把查询结果读成 Python 的列表,并且亲手演示一次「把用户输入直接拼进 SQL」是怎么被 SQL 注入的,再用 `?` 占位符把它堵上。今天讲的外键开关,到明天会是 `conn.execute("PRAGMA foreign_keys = ON")` 这行必写的代码。
