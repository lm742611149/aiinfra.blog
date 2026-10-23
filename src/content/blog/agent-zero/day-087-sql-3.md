---
title: 'Day 87 · SQL(三):JOIN'
description: '真实的账单系统里,客户和发票是两张表,发票只记「这是几号客户的」。今天新建 invoices 表,用 JOIN 把两张表按编号接起来:内连接只留两边都对得上的行,左连接让没发票的客户也留下;再故意写错 ON、漏写 ON,看它们怎么悄悄给出错的结果。'
pubDate: 2026-10-23
regime: none
tags: ['sql', 'sqlite', 'join', 'database', 'agent-zero']
series: 'agent-zero'
day: 87
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 86](/blog/agent-zero/day-086-sql-2/) 学了往 `customers` 表里写:`INSERT` 加行、`UPDATE` 改行、`DELETE` 删行,用 `changes()` 看影响了几行,又故意在没有 `WHERE` 的情况下把 12 行全改掉、全删光,再用 `.backup` / `.restore` 和重跑 `customers.sql` 把数据找回来。一直都只有 `customers` 一张表。

但你想想云簿 CloudLedger 这样的 SaaS 公司:一家客户每个月出一张发票,一年 12 张,三年 36 张。这 36 张发票总不能都塞进客户那一行里。真实的数据库里,客户一张表,发票一张表,发票上只记一个「它属于几号客户」。今天要学的就是怎么把这两张表在查询的时候重新接起来,这个动作叫 **JOIN**(连接)。

## 今天要解决的问题

学完今天,你应该能做到:

1. 说清楚「一个客户对应多张发票」是怎么靠 `invoices.customer_id` 这一列存下来的,并且新建一张 `invoices` 表。
2. 用 `INNER JOIN ... ON ...` 把发票和客户接起来,查出「每张发票属于哪家公司」,会用表别名(`i`、`c`)和 `表.列` 的写法。
3. 用 `LEFT JOIN` 保住「没有发票的客户」,并用 `WHERE 右表.id IS NULL` 找出「没有」的那些行。
4. 认出三个坑:`ON` 条件写错得到看起来合理的错结果、漏写 `ON` 得到几百行的笛卡尔积、`LEFT JOIN` 后面的 `WHERE` 把它悄悄变回内连接。

今天两个新概念:**一对多关系**(用 id 引用另一张表的行)和 **JOIN**(内连接和左连接)。

预计用时:3 小时。花费 ¥0,不写 Python,只用终端。

前置:[Day 85](/blog/agent-zero/day-085-sql-1/) 的 `customers` 表、`SELECT`、`WHERE`、`IS NULL`;[Day 86](/blog/agent-zero/day-086-sql-2/) 的 `practice.db` 还原方法(重跑 `customers.sql`)和 `INSERT`;[Day 24](/blog/agent-zero/day-024-dicts/) 的字典(对照 JS 的 `find`)。

学法:先对照文章逐行敲一遍(不复制粘贴)并跑通;第二天合上文章,默写 `invoices` 和 `customers` 的内连接、左连接各一条,再默写「找出没有发票的客户」;做练习,做不出再展开参考答案,看完关掉自己重写一遍。

## 为什么要拆成两张表,从前端看

前端拿到的 JSON 常常是嵌套的:

```js
const customers = [
  { id: 1, company: '星河餐饮', invoices: [{ id: 1, amount: 1188 }, { id: 2, amount: 1188 }] },
];
```

一个客户下面挂着自己的发票数组。这样读起来方便,存起来有两个麻烦。一是公司改了名,所有挂着它名字的地方都要改;二是想「查出所有未付的发票」,得先遍历所有客户再遍历每个客户的发票。数据库的做法是**拍平**:客户一张表,发票一张表,发票里不存公司名,只存客户的 id:

```js
const customers = [{ id: 1, company: '星河餐饮' }];
const invoices  = [{ id: 1, customer_id: 1, amount: 1188 }, { id: 2, customer_id: 1, amount: 1188 }];
```

公司改名只改 `customers` 里一处;所有发票放在一起,查未付发票一句 `WHERE status = 'unpaid'` 就行。这种关系叫**一对多**:一个客户(一)对应很多发票(多),「多」的那一边(发票)多出来的 `customer_id` 这一列,指向「一」的那一边(客户)的主键,叫**外键**(foreign key,指向别的表主键的列)。

代价是:想同时看到公司名和金额,就得把两张表按 `customer_id = id` 对上。在 JS 里你会这样做:

```js
invoices.map(i => ({ ...i, company: customers.find(c => c.id === i.customer_id)?.company }));
```

SQL 里这个「按某个条件把两张表的行配对」的动作就是 JOIN。

<figure>
<svg viewBox="0 0 640 270" role="img" aria-label="invoices 表的 customer_id 列指向 customers 表的 id 列,一个客户对应多张发票;15 号发票指向不存在的 11 号客户,6 号客户没有发票">
<rect x="0" y="0" width="640" height="270" fill="var(--paper-raised)" rx="6"/>
<g font-family="var(--font-mono)" font-size="12">
<text x="20" y="24" fill="var(--ink)">customers(一)</text>
<text x="400" y="24" fill="var(--ink)">invoices(多)</text>
<rect x="20" y="36" width="180" height="26" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="30" y="54" fill="var(--ink)">1  星河餐饮</text>
<rect x="20" y="66" width="180" height="26" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="30" y="84" fill="var(--ink)">2  青木设计</text>
<rect x="20" y="96" width="180" height="26" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="30" y="114" fill="var(--ink)">3  远山物流</text>
<rect x="20" y="126" width="180" height="26" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="30" y="144" fill="var(--ink-soft)">6  禾丰农业(无发票)</text>
<rect x="20" y="156" width="180" height="26" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="30" y="174" fill="var(--ink-faint)">… 共 10 家</text>
<rect x="400" y="36" width="220" height="26" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="410" y="54" fill="var(--ink)">发票 1  customer_id=1</text>
<rect x="400" y="66" width="220" height="26" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="410" y="84" fill="var(--ink)">发票 2  customer_id=1</text>
<rect x="400" y="96" width="220" height="26" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="410" y="114" fill="var(--ink)">发票 4  customer_id=2</text>
<rect x="400" y="126" width="220" height="26" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="410" y="144" fill="var(--ink)">发票 6  customer_id=3</text>
<rect x="400" y="156" width="220" height="26" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="410" y="174" fill="var(--ink)">发票 15 customer_id=11</text>
<line x1="200" y1="49" x2="400" y2="49" stroke="var(--compute)"/>
<line x1="200" y1="49" x2="400" y2="79" stroke="var(--compute)"/>
<line x1="200" y1="79" x2="400" y2="109" stroke="var(--compute)"/>
<line x1="200" y1="109" x2="400" y2="139" stroke="var(--compute)"/>
<text x="20" y="208" fill="var(--ink-soft)" font-size="11">琥珀线:invoices.customer_id = customers.id,一个客户可以连出很多张发票。</text>
<text x="20" y="228" fill="var(--ink-soft)" font-size="11">6 号客户没有发票;15 号发票指向的 11 号客户已经不存在(孤儿发票),下面会专门找它们。</text>
<text x="20" y="252" fill="var(--ink-faint)" font-size="11">JOIN 就是沿着这些线把两边的行配成一行。</text>
</g>
</svg>
<figcaption>一对多:右边每张发票用 customer_id 指回左边的一个客户。灰色的两个是故意留的特殊情况,JOIN 对它们的处理正是今天的重点。</figcaption>
</figure>

## 第 0 步:建 invoices 表

在 `part01/sql/` 新建 `invoices.sql`:

```sql
-- agent-zero-lab/part01/sql/invoices.sql
DROP TABLE IF EXISTS invoices;

CREATE TABLE invoices (
    id           INTEGER PRIMARY KEY,
    customer_id  INTEGER NOT NULL,
    amount       INTEGER NOT NULL,
    status       TEXT    NOT NULL,
    issued_at    TEXT    NOT NULL
);

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
    (14, 9,  891,   'paid',     '2026-09-01'),
    (15, 11, 156,   'unpaid',   '2026-10-23');
```

<div class="line-notes">

- `-- agent-zero-lab/part01/sql/invoices.sql` 路径注释,和 `customers.sql` 放在同一个目录。
- `DROP TABLE IF EXISTS invoices;` 和 Day 85 一样,先删后建,脚本可以反复执行。注意它只删 `invoices`,不碰 `customers`。
- `id           INTEGER PRIMARY KEY,` 发票自己的编号,自动分配。
- `customer_id  INTEGER NOT NULL,` **外键列**:这张发票属于几号客户。它的值要对得上 `customers.id`,但今天这个建表语句**没有**让数据库去检查这件事(外键约束 Day 91 才学),所以才可能出现 15 号这样指向不存在客户的行。
- `amount       INTEGER NOT NULL,` 金额,单位是元,存整数。金额是怎么来的:席位数 × 套餐单价(基础版 39、专业版 99、企业版 199 元/月)。星河餐饮 12 席专业版,12 × 99 = 1188。
- `status       TEXT    NOT NULL,` 状态,三种:`paid` 已付、`unpaid` 未付、`refunded` 已退款。
- `issued_at    TEXT    NOT NULL` 开票日期,`YYYY-MM-DD` 文本,和 Day 85 一样。
- `(1,  1,  1188,  'paid',     '2026-07-01'),` 1 号发票,属于 1 号客户星河餐饮,1188 元,已付。1 号客户连续三个月各一张(1、2、3 号发票),这就是「一对多」。
- `(11, 7,  78,    'refunded', '2026-09-01'),` 半岛咖啡 2 席基础版 2 × 39 = 78,已退款。
- `(15, 11, 156,   'unpaid',   '2026-10-23');` 15 号发票属于 **11 号客户**,可 `customers` 表里只有 1 到 10 号。这是故意留的**孤儿发票**:想象一家叫橙子健身的客户在 Day 86 被加进去又删掉了,它的发票却留了下来。6 号禾丰农业和 10 号小满花店则**一张发票都没有**,也是故意的。

</div>

(这张表里一共 15 张发票,金额和上面那一串数字是我手算好的:1188、117、16915、1980、27860、78、1782、891、156。)

先把 `customers` 还原成 10 行干净状态(Day 86 最后一步做过,再做一次无妨),再灌 `invoices`:

```bash
cd /Users/你/agent-zero-lab/part01/sql
sqlite3 practice.db < customers.sql
sqlite3 practice.db < invoices.sql
sqlite3 practice.db ".tables" ".schema invoices"
sqlite3 -box practice.db "SELECT * FROM invoices;"
```

<div class="line-notes">

- `sqlite3 practice.db < customers.sql` 重建 `customers`,10 行。
- `sqlite3 practice.db < invoices.sql` 建 `invoices`,15 行。
- `sqlite3 practice.db ".tables" ".schema invoices"` 两个点命令一次传进去:列出所有表,再看 `invoices` 的建表语句。
- `sqlite3 -box practice.db "SELECT * FROM invoices;"` 用方框画出整张发票表。

</div>

实跑输出:

```text
customers  invoices 
CREATE TABLE invoices (
    id           INTEGER PRIMARY KEY,
    customer_id  INTEGER NOT NULL,
    amount       INTEGER NOT NULL,
    status       TEXT    NOT NULL,
    issued_at    TEXT    NOT NULL
);
┌────┬─────────────┬────────┬──────────┬────────────┐
│ id │ customer_id │ amount │  status  │ issued_at  │
├────┼─────────────┼────────┼──────────┼────────────┤
│ 1  │ 1           │ 1188   │ paid     │ 2026-07-01 │
│ 2  │ 1           │ 1188   │ paid     │ 2026-08-01 │
│ 3  │ 1           │ 1188   │ unpaid   │ 2026-09-01 │
│ 4  │ 2           │ 117    │ paid     │ 2026-08-01 │
│ 5  │ 2           │ 117    │ paid     │ 2026-09-01 │
│ 6  │ 3           │ 16915  │ paid     │ 2026-08-01 │
│ 7  │ 3           │ 16915  │ unpaid   │ 2026-09-01 │
│ 8  │ 4           │ 1980   │ paid     │ 2026-09-01 │
│ 9  │ 5           │ 27860  │ paid     │ 2026-08-01 │
│ 10 │ 5           │ 27860  │ paid     │ 2026-09-01 │
│ 11 │ 7           │ 78     │ refunded │ 2026-09-01 │
│ 12 │ 8           │ 1782   │ paid     │ 2026-08-01 │
│ 13 │ 8           │ 1782   │ unpaid   │ 2026-09-01 │
│ 14 │ 9           │ 891    │ paid     │ 2026-09-01 │
│ 15 │ 11          │ 156    │ unpaid   │ 2026-10-23 │
└────┴─────────────┴────────┴──────────┴────────────┘
```

`.tables` 的输出里有 `customers` 和 `invoices` 两张表。发票表里只有 `customer_id` 一个数字,看不出哪家公司。

`invoices.sql` 要留好:Day 94 的迷你账单库还要接着用它。`practice.db` 会被反复重建,`.sql` 文件才是真正的源头。

## 第 1 步:没有 JOIN,你得查两次

要回答「3 号发票是哪家公司的」,不用 JOIN 只能这样:

```bash
sqlite3 -header practice.db "
SELECT id, customer_id, amount FROM invoices WHERE id = 3;
SELECT id, company, contact FROM customers WHERE id = 1;"
```

<div class="line-notes">

- `SELECT id, customer_id, amount FROM invoices WHERE id = 3;` 第一次查询,拿到 3 号发票,看到 `customer_id` 是 1。
- `SELECT id, company, contact FROM customers WHERE id = 1;` 第二次查询,用刚看到的 1 去查客户。这个 `1` 是**人眼读出来再手敲进去的**。

</div>

```text
id|customer_id|amount
3|1|1188
id|company|contact
1|星河餐饮|王伟
```

查一张发票要两次,查 14 张发票就要 15 次(一次取发票,再一个个取客户)。在后面写 Agent 工具时,如果每张发票都发一次数据库请求,等于循环里发网络请求,慢到不能用。JOIN 让数据库一次把两边配好再返回。

## 第 2 步:INNER JOIN,只留对得上的行

```sql
SELECT invoices.id, customers.company, invoices.amount, invoices.status
FROM invoices
JOIN customers ON invoices.customer_id = customers.id;
```

<div class="line-notes">

- `SELECT invoices.id, customers.company, invoices.amount, invoices.status` 取的列都写成 `表名.列名`。因为两张表现在同时在场,而且**两张表都有 `id` 这一列**,光写 `id` 数据库分不清是谁的(下一步会看到报错)。
- `FROM invoices` 以发票表为主,下面的每一张发票都会去找配对的客户。
- `JOIN customers ON invoices.customer_id = customers.id;` `JOIN 另一张表 ON 配对条件`。`ON` 后面是怎么配对:发票的 `customer_id` 等于客户的 `id`。对每一张发票,数据库到 `customers` 里找 `id` 等于它 `customer_id` 的那一行,把两边拼成一行输出。单写 `JOIN` 就是 `INNER JOIN`(内连接),两种写法等价。

</div>

实跑输出:

```text
┌────┬─────────┬────────┬──────────┐
│ id │ company │ amount │  status  │
├────┼─────────┼────────┼──────────┤
│ 1  │ 星河餐饮    │ 1188   │ paid     │
│ 2  │ 星河餐饮    │ 1188   │ paid     │
│ 3  │ 星河餐饮    │ 1188   │ unpaid   │
│ 4  │ 青木设计    │ 117    │ paid     │
│ 5  │ 青木设计    │ 117    │ paid     │
│ 6  │ 远山物流    │ 16915  │ paid     │
│ 7  │ 远山物流    │ 16915  │ unpaid   │
│ 8  │ 蓝鲸教育    │ 1980   │ paid     │
│ 9  │ 启明科技    │ 27860  │ paid     │
│ 10 │ 启明科技    │ 27860  │ paid     │
│ 11 │ 半岛咖啡    │ 78     │ refunded │
│ 12 │ 云杉律所    │ 1782   │ paid     │
│ 13 │ 云杉律所    │ 1782   │ unpaid   │
│ 14 │ 北辰贸易    │ 891    │ paid     │
└────┴─────────┴────────┴──────────┘
```

每张发票旁边有了公司名。数一下:**14 行,不是 15 行**。15 号发票(指向不存在的 11 号客户)不见了。这就是内连接的规则:**两边都配得上的才留下,配不上的整行丢掉,不报错、不提示**。再看 `customers` 那边:6 号禾丰农业和 10 号小满花店没有发票,也没出现在结果里。

这个「悄悄丢行」会在统计里出大事。比如想算「未付发票总数」:

```bash
sqlite3 practice.db "
SELECT count(*) FROM invoices WHERE status = 'unpaid';
SELECT count(*) FROM invoices i
JOIN customers c ON i.customer_id = c.id
WHERE i.status = 'unpaid';"
```

<div class="line-notes">

- `SELECT count(*) FROM invoices WHERE status = 'unpaid';` 只看发票表,有几张未付。
- `SELECT count(*) FROM invoices i` 先 JOIN 再数。这里 `invoices i` 是给表起的**别名**(下一步细讲),后面直接写 `i.`。
- `JOIN customers c ON i.customer_id = c.id` 配上客户,`c` 是 `customers` 的别名。
- `WHERE i.status = 'unpaid';` 再筛未付。

</div>

```text
4
3
```

直接数是 4 张未付,JOIN 以后只剩 3 张,少的那张就是 15 号孤儿发票。两个答案都「没报错」,只有你知道数据里有孤儿才能解释差别。

## 第 3 步:别名和列名冲突

每次都写 `invoices.customer_id`、`customers.company` 太长。SQL 允许在 `FROM` 或 `JOIN` 后面给表起一个短别名,习惯上取首字母:

```sql
SELECT i.id AS invoice_id, c.company, i.amount, i.status, i.issued_at
FROM invoices AS i
INNER JOIN customers AS c ON i.customer_id = c.id
ORDER BY i.id;
```

<div class="line-notes">

- `SELECT i.id AS invoice_id, c.company, i.amount, i.status, i.issued_at` `i.id` 是发票的编号,`c.company` 是客户公司名。`AS invoice_id` 给结果列改名,不然输出里只有一个 `id`,看不出是谁的。
- `FROM invoices AS i` 把 `invoices` 起别名叫 `i`。`AS` 可以省略,写成 `FROM invoices i` 也行。**一旦起了别名,这条查询里就只能用别名**,再写 `invoices.id` 会报错。
- `INNER JOIN customers AS c ON i.customer_id = c.id` 写全了 `INNER JOIN`,和只写 `JOIN` 一个意思。`c` 是 `customers` 的别名。
- `ORDER BY i.id;` 按发票编号排序。JOIN 的结果顺序不保证,需要稳定顺序就写 `ORDER BY`。

</div>

实跑输出(14 行,数据和上一步相同,多了开票日期):

```text
┌────────────┬─────────┬────────┬──────────┬────────────┐
│ invoice_id │ company │ amount │  status  │ issued_at  │
├────────────┼─────────┼────────┼──────────┼────────────┤
│ 1          │ 星河餐饮    │ 1188   │ paid     │ 2026-07-01 │
│ 2          │ 星河餐饮    │ 1188   │ paid     │ 2026-08-01 │
│ 3          │ 星河餐饮    │ 1188   │ unpaid   │ 2026-09-01 │
│ 4          │ 青木设计    │ 117    │ paid     │ 2026-08-01 │
│ 5          │ 青木设计    │ 117    │ paid     │ 2026-09-01 │
│ 6          │ 远山物流    │ 16915  │ paid     │ 2026-08-01 │
│ 7          │ 远山物流    │ 16915  │ unpaid   │ 2026-09-01 │
│ 8          │ 蓝鲸教育    │ 1980   │ paid     │ 2026-09-01 │
│ 9          │ 启明科技    │ 27860  │ paid     │ 2026-08-01 │
│ 10         │ 启明科技    │ 27860  │ paid     │ 2026-09-01 │
│ 11         │ 半岛咖啡    │ 78     │ refunded │ 2026-09-01 │
│ 12         │ 云杉律所    │ 1782   │ paid     │ 2026-08-01 │
│ 13         │ 云杉律所    │ 1782   │ unpaid   │ 2026-09-01 │
│ 14         │ 北辰贸易    │ 891    │ paid     │ 2026-09-01 │
└────────────┴─────────┴────────┴──────────┴────────────┘
```

现在故意犯第一个错:两张表都有 `id`,不写前缀:

```bash
sqlite3 practice.db "SELECT id, company FROM invoices JOIN customers ON invoices.customer_id = customers.id;"
```

```text
Error: in prepare, ambiguous column name: id
  SELECT id, company FROM invoices JOIN customers ON invoices.customer_id = cust
         ^--- error here
```

`ambiguous column name: id`:`id` 有歧义,不知道你要发票的还是客户的。**多表查询里每个列都写上前缀**,哪怕这个列名只出现在一张表里,以后表里加了同名列也不会突然报错。Postgres 同样会报错,措辞是 `column reference "id" is ambiguous`。

## 第 4 步:ON 写错了会怎样

报错的坑反而好找。更危险的是不报错的。

**错一:`ON` 写了错误的键。** 手滑把 `ON i.customer_id = c.id` 写成 `ON c.id = i.id`,意思就变成了「1 号发票配 1 号客户、2 号发票配 2 号客户」:

```bash
sqlite3 -box practice.db "
SELECT i.id, c.company, i.amount
FROM invoices i
JOIN customers c ON c.id = i.id;"
```

<div class="line-notes">

- `SELECT i.id, c.company, i.amount` 照旧取发票号、公司名、金额。
- `FROM invoices i` 发票表,别名 `i`。
- `JOIN customers c ON c.id = i.id;` 配对条件拿**发票自己的编号**去等客户编号。1 号发票配 1 号客户,碰巧是对的,2 号发票配 2 号客户,可 2 号发票其实属于 1 号客户。

</div>

```text
┌────┬─────────┬────────┐
│ id │ company │ amount │
├────┼─────────┼────────┤
│ 1  │ 星河餐饮    │ 1188   │
│ 2  │ 青木设计    │ 1188   │
│ 3  │ 远山物流    │ 1188   │
│ 4  │ 蓝鲸教育    │ 117    │
│ 5  │ 启明科技    │ 117    │
│ 6  │ 禾丰农业    │ 16915  │
│ 7  │ 半岛咖啡    │ 16915  │
│ 8  │ 云杉律所    │ 1980   │
│ 9  │ 北辰贸易    │ 27860  │
│ 10 │ 小满花店    │ 27860  │
└────┴─────────┴────────┘
```

10 行(发票 11 到 15 号找不到同号的客户,被丢了),每一行看起来都像模像样,实际全是错的:2 号发票的 1188 元被算到了青木设计头上,而青木设计的发票其实是 117 元。注意到没有?没有任何报错,行数也「合理」。**能发现它的唯一办法是拿结果和已知的事实对一遍**(青木设计 3 席基础版,月费 117,不可能开出 1188)。这也是后面给 Agent 做 SQL 工具时要重点评测的地方:模型写的 JOIN 键错了,结果依然像真的。

**错二:漏了 `ON`。** SQLite 里 `JOIN` 后面不写 `ON` 也不报错:

```bash
sqlite3 practice.db "SELECT count(*) FROM invoices JOIN customers;"
sqlite3 practice.db "SELECT i.id, c.id, c.company FROM invoices i JOIN customers c LIMIT 12;"
```

<div class="line-notes">

- `SELECT count(*) FROM invoices JOIN customers;` 没有配对条件,数据库认为「任何一张发票和任何一家客户都能配」。
- `SELECT i.id, c.id, c.company FROM invoices i JOIN customers c LIMIT 12;` 看前 12 行长什么样。`LIMIT` 只是为了不刷屏。

</div>

```text
150
1|1|星河餐饮
1|2|青木设计
1|3|远山物流
1|4|蓝鲸教育
1|5|启明科技
1|6|禾丰农业
1|7|半岛咖啡
1|8|云杉律所
1|9|北辰贸易
1|10|小满花店
2|1|星河餐饮
2|2|青木设计
```

**150 行**:15 张发票 × 10 家客户,每张发票和每家客户都配了一遍,这叫**笛卡尔积**(两张表所有行的两两组合)。1 号发票被配给了全部 10 家公司。表一大(各一万行)结果就是一亿行,把数据库拖死。老式的逗号写法 `FROM invoices, customers` 不写 `WHERE` 也是同样的结果,实测也是 150。Postgres 的行为不同:同样的 `JOIN customers;` 它直接报语法错误 `syntax error at or near ";"`,想要笛卡尔积得明确写 `CROSS JOIN`(实测 2 × 2 的小表得到 4 行)。**SQLite 对你更宽容,所以你得对自己更严格:每个 JOIN 后面都写 ON。**

三条规矩:① `ON` 里写的是「外键列 = 它指向的主键列」,几乎永远是 `子表.xxx_id = 父表.id` 这个形状;② 写完看一下行数,发票表 15 行、内连接得 14 行是合理的,变成 150 行就是漏了 ON;③ 随机抽一两行,拿业务常识核对。

<figure>
<svg viewBox="0 0 640 250" role="img" aria-label="内连接只保留两边配得上的行,左连接保留左表全部行,右边配不上的补 NULL">
<rect x="0" y="0" width="640" height="250" fill="var(--paper-raised)" rx="6"/>
<g font-family="var(--font-mono)" font-size="12">
<text x="20" y="24" fill="var(--ink)">INNER JOIN</text>
<text x="340" y="24" fill="var(--ink)">LEFT JOIN</text>
<rect x="20" y="36" width="130" height="24" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="30" y="53" fill="var(--ink)">客户 3</text>
<rect x="170" y="36" width="130" height="24" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="180" y="53" fill="var(--ink)">发票 6,7</text>
<rect x="20" y="66" width="130" height="24" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="30" y="83" fill="var(--ink-soft)">客户 6(无发票)</text>
<rect x="170" y="66" width="130" height="24" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="180" y="83" fill="var(--ink-soft)">发票 15(无客户)</text>
<text x="20" y="116" fill="var(--ink)">结果:只有配上的</text>
<text x="20" y="136" fill="var(--ink-soft)">3 | 6 号发票</text>
<text x="20" y="154" fill="var(--ink-soft)">3 | 7 号发票</text>
<text x="20" y="172" fill="var(--ink-faint)">(6 号客户、15 号发票消失)</text>
<rect x="340" y="36" width="130" height="24" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="350" y="53" fill="var(--ink)">客户 3</text>
<rect x="490" y="36" width="130" height="24" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="500" y="53" fill="var(--ink)">发票 6,7</text>
<rect x="340" y="66" width="130" height="24" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="350" y="83" fill="var(--ink)">客户 6(无发票)</text>
<rect x="490" y="66" width="130" height="24" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="500" y="83" fill="var(--ink-soft)">发票 15(无客户)</text>
<text x="340" y="116" fill="var(--ink)">结果:左表一个不少</text>
<text x="340" y="136" fill="var(--ink-soft)">3 | 6 号发票</text>
<text x="340" y="154" fill="var(--ink-soft)">3 | 7 号发票</text>
<text x="340" y="172" fill="var(--ink-soft)">6 | NULL</text>
<text x="340" y="190" fill="var(--ink-faint)">(发票 15 仍然没有,它在右表)</text>
<text x="20" y="226" fill="var(--ink-faint)" font-size="11">想保留谁,就把谁放在 LEFT JOIN 的左边(FROM 后面那张表)。</text>
</g>
</svg>
<figcaption>以「客户 LEFT JOIN 发票」为例:左边是 FROM 的表,右边是 JOIN 的表。蓝色是客户,琥珀色是发票,灰色是配不上的行。</figcaption>
</figure>

## 第 5 步:LEFT JOIN,让没发票的客户也留下

运营问:「所有客户列出来,有发票的带上发票,没发票的也别漏。」内连接做不到,它会把 6 号和 10 号丢掉。这时用 **LEFT JOIN**(左连接):以 `FROM` 后面的那张表(左表)为准,**左表的每一行都保留**;右表里配得上的就接上,配不上的,右表那几列全部填 `NULL`。

```sql
SELECT c.id AS cid, c.company, i.id AS invoice_id, i.amount, i.status
FROM customers c
LEFT JOIN invoices i ON i.customer_id = c.id
ORDER BY c.id, i.id;
```

<div class="line-notes">

- `SELECT c.id AS cid, c.company, i.id AS invoice_id, i.amount, i.status` 客户的 id 和公司名,加上发票的几列。给两个 id 起了不同的名字,免得混。
- `FROM customers c` 这次**客户放左边**,因为想保住客户。
- `LEFT JOIN invoices i ON i.customer_id = c.id` 左连接发票。配对条件和内连接完全一样,只是多了「配不上也保留左边」的规则。
- `ORDER BY c.id, i.id;` 先按客户号,再按发票号排,同一个客户的发票挨在一起。

</div>

实跑输出:

```text
┌─────┬─────────┬────────────┬────────┬──────────┐
│ cid │ company │ invoice_id │ amount │  status  │
├─────┼─────────┼────────────┼────────┼──────────┤
│ 1   │ 星河餐饮    │ 1          │ 1188   │ paid     │
│ 1   │ 星河餐饮    │ 2          │ 1188   │ paid     │
│ 1   │ 星河餐饮    │ 3          │ 1188   │ unpaid   │
│ 2   │ 青木设计    │ 4          │ 117    │ paid     │
│ 2   │ 青木设计    │ 5          │ 117    │ paid     │
│ 3   │ 远山物流    │ 6          │ 16915  │ paid     │
│ 3   │ 远山物流    │ 7          │ 16915  │ unpaid   │
│ 4   │ 蓝鲸教育    │ 8          │ 1980   │ paid     │
│ 5   │ 启明科技    │ 9          │ 27860  │ paid     │
│ 5   │ 启明科技    │ 10         │ 27860  │ paid     │
│ 6   │ 禾丰农业    │            │        │          │
│ 7   │ 半岛咖啡    │ 11         │ 78     │ refunded │
│ 8   │ 云杉律所    │ 12         │ 1782   │ paid     │
│ 8   │ 云杉律所    │ 13         │ 1782   │ unpaid   │
│ 9   │ 北辰贸易    │ 14         │ 891    │ paid     │
│ 10  │ 小满花店    │            │        │          │
└─────┴─────────┴────────────┴────────┴──────────┘
```

16 行:有发票的客户有几张发票就出几行(星河餐饮 3 行),没发票的 6 号和 10 号各占一行,右边四列是空的,那是 `NULL`。16 行的算法:内连接的 14 行,加上两个没发票的客户 = 16。15 号孤儿发票依然不在,因为它在右表,左连接只保证左表不丢行。

**一对多的 JOIN 会让左边的行重复**:星河餐饮出现了三次。这不是错,是配对的自然结果,但如果你之后想「数客户有几家」,直接数这个结果会得到 16 而不是 10。这是明天 `GROUP BY` 要解决的问题,先记住这件事。

## 第 6 步:用 LEFT JOIN 找「没有」

左连接最有用的一招:右边是 `NULL` 就说明「没配上」,所以加一个 `WHERE 右表.id IS NULL`,留下来的就全是「没有对应行」的左表行:

```sql
SELECT c.id, c.company
FROM customers c
LEFT JOIN invoices i ON i.customer_id = c.id
WHERE i.id IS NULL;
```

<div class="line-notes">

- `SELECT c.id, c.company` 只要客户的信息。
- `FROM customers c`
- `LEFT JOIN invoices i ON i.customer_id = c.id` 和上一步同样的左连接。
- `WHERE i.id IS NULL;` 筛掉所有「配上了发票」的行。判断 `NULL` 只能用 `IS NULL`(Day 85)。选 `i.id` 来判断是因为它是主键、永远不为 NULL,一旦它是 NULL 就只可能是「没配上」。

</div>

```text
id|company
6|禾丰农业
10|小满花店
```

这两家从没开过发票。运营想知道「谁还没产生过收入」,这就是答案。

反过来,想找「孤儿发票」(没有对应客户的发票),把发票放在左边:

```sql
SELECT i.id, i.customer_id, i.amount
FROM invoices i
LEFT JOIN customers c ON c.id = i.customer_id
WHERE c.id IS NULL;
```

<div class="line-notes">

- `FROM invoices i`
- `LEFT JOIN customers c ON c.id = i.customer_id` 这回**发票在左**,保证每张发票都出现。
- `WHERE c.id IS NULL;` 右边的客户 id 是 NULL,说明发票的 `customer_id` 在客户表里找不到人。

</div>

```text
id|customer_id|amount
15|11|156
```

15 号发票揪出来了。这两个「找没有」的查询,真实工作里会反复用到:发现孤儿数据、对账、找漏掉的关联。

SQLite 还支持右连接和全连接:`RIGHT JOIN` 是反过来保留右表,`FULL JOIN` 是两边都保留。这俩要 SQLite 3.39.0 以上(发布说明里写着 RIGHT and FULL OUTER JOIN 是这一版加的),本机是 3.39.5,所以能用:`invoices i RIGHT JOIN customers c ON ...` 跑出来和 `customers c LEFT JOIN invoices i ON ...` 是同一批行,实测 `WHERE i.id IS NULL` 同样得到 6 号和 10 号;`FULL JOIN` 的总行数是 17,正好是 16(左连接的行)加上 1(孤儿发票)。你的 macOS 版本旧的话可能跑不了。**日常只用 INNER 和 LEFT**,右连接把两张表的顺序对调就能换成左连接,可读性更好。

## 第 7 步:LEFT JOIN 后面的 WHERE 会把它变回内连接

最后一个很容易踩的坑。想要「所有客户,有未付发票的显示那张发票,没有的也留着」。直觉写法:

```sql
SELECT c.id AS cid, c.company, i.id AS invoice_id, i.amount
FROM customers c
LEFT JOIN invoices i ON i.customer_id = c.id
WHERE i.status = 'unpaid'
ORDER BY c.id;
```

<div class="line-notes">

- `LEFT JOIN invoices i ON i.customer_id = c.id` 先左连接,此时 16 行,包括没发票的客户。
- `WHERE i.status = 'unpaid'` 再筛。注意 `WHERE` 是在 JOIN **之后**执行的:没发票的客户,`i.status` 是 NULL,`NULL = 'unpaid'` 是「不知道」,不是真,整行被丢掉。左连接辛苦保下来的行,又被 `WHERE` 扔了。

</div>

```text
┌─────┬─────────┬────────────┬────────┐
│ cid │ company │ invoice_id │ amount │
├─────┼─────────┼────────────┼────────┤
│ 1   │ 星河餐饮    │ 3          │ 1188   │
│ 3   │ 远山物流    │ 7          │ 16915  │
│ 8   │ 云杉律所    │ 13         │ 1782   │
└─────┴─────────┴────────────┴────────┘
```

只剩 3 行,和内连接一模一样,别的客户都消失了。**对右表的列写 WHERE,会把 LEFT JOIN 退化成 INNER JOIN。** 想要的是「先筛发票、再连接」,条件应该挪进 `ON`:

```sql
SELECT c.id AS cid, c.company, i.id AS invoice_id, i.amount
FROM customers c
LEFT JOIN invoices i ON i.customer_id = c.id AND i.status = 'unpaid'
ORDER BY c.id;
```

<div class="line-notes">

- `LEFT JOIN invoices i ON i.customer_id = c.id AND i.status = 'unpaid'` `ON` 里除了配对键,还加了一条「发票必须是未付」。意思变成:每个客户去找**属于它的未付发票**,找不到就右边填 NULL,但客户本身保留。
- `ORDER BY c.id;` 按客户号排序。没有 WHERE 了,10 个客户一个不少。

</div>

```text
┌─────┬─────────┬────────────┬────────┐
│ cid │ company │ invoice_id │ amount │
├─────┼─────────┼────────────┼────────┤
│ 1   │ 星河餐饮    │ 3          │ 1188   │
│ 2   │ 青木设计    │            │        │
│ 3   │ 远山物流    │ 7          │ 16915  │
│ 4   │ 蓝鲸教育    │            │        │
│ 5   │ 启明科技    │            │        │
│ 6   │ 禾丰农业    │            │        │
│ 7   │ 半岛咖啡    │            │        │
│ 8   │ 云杉律所    │ 13         │ 1782   │
│ 9   │ 北辰贸易    │            │        │
│ 10  │ 小满花店    │            │        │
└─────┴─────────┴────────────┴────────┘
```

10 行,一家不少,有未付发票的显示发票,其余右边是空的。记法:**内连接里 `ON` 和 `WHERE` 写哪里效果一样;左连接里,筛右表的条件放 `ON`,筛左表的条件放 `WHERE`。**

## 和前端代码对照

| 做什么 | SQL | JS |
| --- | --- | --- |
| 给发票配上公司名(丢掉对不上的) | `invoices i JOIN customers c ON i.customer_id = c.id` | `invoices.flatMap(i => { const c = customers.find(c => c.id === i.customer_id); return c ? [{...i, company: c.company}] : []; })` |
| 所有客户,配不上的留空 | `customers c LEFT JOIN invoices i ON ...` | `customers.flatMap(c => { const m = invoices.filter(i => i.customer_id === c.id); return m.length ? m.map(i => ({...c, ...i})) : [{...c}]; })` |
| 找没有发票的客户 | `LEFT JOIN ... WHERE i.id IS NULL` | `customers.filter(c => !invoices.some(i => i.customer_id === c.id))` |
| 配对条件 | `ON` | `find`/`filter` 里的回调 |
| 笛卡尔积 | 漏写 `ON` | 两层 `for` 循环不加 `if` |

JS 里每一行都是你自己写的循环,数据多了就是 O(n×m) 的嵌套遍历。SQL 里你只说「怎么配对」,配的方法(甚至加索引走哈希)由数据库决定,Day 89 会讲数据库怎么把这一步变快。

## 动手练习

每道题开始前:`sqlite3 practice.db < customers.sql` 和 `sqlite3 practice.db < invoices.sql`,还原两张表。

**练习 1:已付发票的流水。** 列出所有**已付**(`status = 'paid'`)发票的公司名、金额和开票日期,按开票日期从早到晚排,同一天的按发票号排。

<details><summary>参考答案</summary>

```bash
sqlite3 -header practice.db "
SELECT c.company, i.amount, i.issued_at
FROM invoices i
JOIN customers c ON c.id = i.customer_id
WHERE i.status = 'paid'
ORDER BY i.issued_at, i.id;"
```

<div class="line-notes">

- `SELECT c.company, i.amount, i.issued_at` 公司名来自客户表,金额和日期来自发票表。
- `FROM invoices i`
- `JOIN customers c ON c.id = i.customer_id` 内连接,配对键是 `customer_id = id`。
- `WHERE i.status = 'paid'` 只要已付。内连接里条件放在 `ON` 或 `WHERE` 效果一样,这里放 `WHERE` 读起来更清楚。
- `ORDER BY i.issued_at, i.id;` 先按日期,同一天再按发票号。

</div>

实跑输出:

```text
company|amount|issued_at
星河餐饮|1188|2026-07-01
星河餐饮|1188|2026-08-01
青木设计|117|2026-08-01
远山物流|16915|2026-08-01
启明科技|27860|2026-08-01
云杉律所|1782|2026-08-01
青木设计|117|2026-09-01
蓝鲸教育|1980|2026-09-01
启明科技|27860|2026-09-01
北辰贸易|891|2026-09-01
```

10 行。15 张发票里 4 张未付、1 张已退款,所以已付是 10 张,加起来对得上。

</details>

**练习 2:没有任何「已付」发票的客户。** 找出从来没付过钱的客户(包括完全没发票的,也包括只有退款或只有未付发票的),显示 id 和公司名。

<details><summary>参考答案</summary>

```bash
sqlite3 -header practice.db "
SELECT c.id, c.company
FROM customers c
LEFT JOIN invoices i ON i.customer_id = c.id AND i.status = 'paid'
WHERE i.id IS NULL
ORDER BY c.id;"
```

<div class="line-notes">

- `FROM customers c`
- `LEFT JOIN invoices i ON i.customer_id = c.id AND i.status = 'paid'` 左连接,并且**把「已付」条件放进 `ON`**:每个客户只去找属于自己的已付发票,找不到就是 NULL。
- `WHERE i.id IS NULL` 留下找不到已付发票的客户。如果把 `AND i.status = 'paid'` 写进 `WHERE`,逻辑就反了,得不到想要的结果(第 7 步的坑)。
- `ORDER BY c.id;` 按客户号排。

</div>

实跑输出:

```text
id|company
6|禾丰农业
7|半岛咖啡
10|小满花店
```

6 号和 10 号一张发票都没有;7 号半岛咖啡有一张,但是已退款(`refunded`),不算已付,所以也在里面。

</details>

**练习 3:催款名单。** 运营要给**未付**发票的客户打电话:列出未付发票的发票号、公司名、联系人、邮箱、金额,按金额从大到小排。

<details><summary>参考答案</summary>

```bash
sqlite3 -header practice.db "
SELECT i.id AS invoice_id, c.company, c.contact, c.email, i.amount
FROM invoices i
JOIN customers c ON c.id = i.customer_id
WHERE i.status = 'unpaid'
ORDER BY i.amount DESC;"
```

<div class="line-notes">

- `SELECT i.id AS invoice_id, c.company, c.contact, c.email, i.amount` 取发票号,再从客户表取联系方式,不用再查第二次。
- `FROM invoices i`
- `JOIN customers c ON c.id = i.customer_id` 内连接。
- `WHERE i.status = 'unpaid'` 只要未付。15 号孤儿发票虽然也是未付,但它配不上客户,内连接把它丢了,所以名单里没有它。
- `ORDER BY i.amount DESC;` 金额大的在前。

</div>

实跑输出:

```text
invoice_id|company|contact|email|amount
7|远山物流|张磊|zhanglei@yuanshan.example|16915
13|云杉律所|赵杰|zhaojie@yunshan.example|1782
3|星河餐饮|王伟|wangwei@xinghe.example|1188
```

3 张。没有 15 号:一个催款名单里**应该**有一张 156 元的未付发票,只是不知道找谁收。这种缺口要靠第 6 步的孤儿发票查询单独发现,内连接是发现不了的。

</details>

**练习 4:杭州和上海客户的发票。** 列出城市在杭州或上海的客户的**所有**发票(任何状态),显示发票号、公司名、城市、金额,按发票号排。

<details><summary>参考答案</summary>

```bash
sqlite3 -header practice.db "
SELECT i.id AS invoice_id, c.company, c.city, i.amount
FROM invoices i
JOIN customers c ON c.id = i.customer_id
WHERE c.city IN ('杭州', '上海')
ORDER BY i.id;"
```

<div class="line-notes">

- `SELECT i.id AS invoice_id, c.company, c.city, i.amount` 城市来自客户表。
- `FROM invoices i`
- `JOIN customers c ON c.id = i.customer_id` 先配对,配完以后每一行里既有发票列也有客户列,所以 `WHERE` 里能直接用客户的 `city`。
- `WHERE c.city IN ('杭州', '上海')` Day 85 的 `IN`。条件写在客户的列上,是 JOIN 的一个典型用途:**按另一张表的属性筛这张表的行**。
- `ORDER BY i.id;` 按发票号排。

</div>

实跑输出:

```text
invoice_id|company|city|amount
1|星河餐饮|杭州|1188
2|星河餐饮|杭州|1188
3|星河餐饮|杭州|1188
4|青木设计|上海|117
5|青木设计|上海|117
12|云杉律所|上海|1782
13|云杉律所|上海|1782
```

7 行。小满花店也在杭州,但它没有发票,内连接里自然没有它。

</details>

**练习 5(观察题):给 6 号补一张发票。** 先用 `INSERT` 给 6 号禾丰农业补一张已付发票:`INSERT INTO invoices (customer_id, amount, status, issued_at) VALUES (6, 195, 'paid', '2026-10-23');`,然后重跑练习 2 的查询,看结果有什么变化,解释为什么。做完重跑 `invoices.sql` 还原。

<details><summary>参考答案</summary>

```bash
sqlite3 -header practice.db "
INSERT INTO invoices (customer_id, amount, status, issued_at) VALUES (6, 195, 'paid', '2026-10-23');
SELECT last_insert_rowid() AS new_id;"
sqlite3 -header practice.db "
SELECT c.id, c.company
FROM customers c
LEFT JOIN invoices i ON i.customer_id = c.id AND i.status = 'paid'
WHERE i.id IS NULL
ORDER BY c.id;"
sqlite3 practice.db < invoices.sql
```

<div class="line-notes">

- `INSERT INTO invoices (customer_id, amount, status, issued_at) VALUES (6, 195, 'paid', '2026-10-23');` Day 86 的带列名 INSERT,不给 `id` 让它自动分配。195 是 5 席基础版 5 × 39。
- `SELECT last_insert_rowid() AS new_id;` 查新行的编号(和 INSERT 在同一次连接里才有效)。
- 第二个 `sqlite3` 命令里的 `LEFT JOIN invoices i ON i.customer_id = c.id AND i.status = 'paid'` 和 `WHERE i.id IS NULL` 就是练习 2 的查询,一字未改。
- `sqlite3 practice.db < invoices.sql` 重跑脚本,`DROP TABLE` 之后重建,新加的第 16 号发票消失,表回到 15 行。

</div>

实跑输出:

```text
new_id
16
id|company
7|半岛咖啡
10|小满花店
```

6 号禾丰农业从名单里消失了:它现在有一张已付发票,左连接能为它配上一行,`i.id` 不再是 NULL。同一条查询,数据一变,结果就跟着变,**「没有」是随数据变化的**。7 号和 10 号依然在,因为 7 号的唯一一张是退款。

</details>

验收标准:五道题都在自己终端里跑通;能不看文章写出「发票和客户的内连接」「客户和发票的左连接」「找没有发票的客户」三条查询;能解释「为什么 LEFT JOIN 后面写 `WHERE i.status = 'unpaid'` 会丢掉客户」。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 一对多 | 一行(客户)对应另一张表里的多行(发票) |
| 外键(foreign key) | 一张表里指向另一张表主键的列,如 `invoices.customer_id` 指向 `customers.id` |
| JOIN | 按条件把两张表的行配成一行输出 |
| `ON` | 写在 JOIN 后面的配对条件,通常是 `子表.外键 = 父表.id` |
| `INNER JOIN` | 内连接,只保留两边都配得上的行;单写 `JOIN` 就是它 |
| `LEFT JOIN` | 左连接,保留左表(FROM 后面那张)的所有行,右边配不上就补 NULL |
| `RIGHT JOIN` / `FULL JOIN` | 保留右表 / 保留两边,SQLite 3.39 起支持,日常用 LEFT 就够 |
| 表别名 | `FROM invoices AS i` 里的 `i`,起了以后整条查询只能用别名 |
| `表.列` | 多表查询里给列加上表(或别名)前缀,避免 `ambiguous column name` |
| 笛卡尔积 | 两张表所有行的两两组合,漏写 `ON` 就会得到(150 = 15 × 10) |
| 孤儿行 | 外键指向的行不存在,如 15 号发票指向不存在的 11 号客户 |
| 反连接(找「没有」) | `LEFT JOIN ... WHERE 右表.id IS NULL`,留下左表里没配上的行 |
| `CROSS JOIN` | 明确要笛卡尔积的写法,Postgres 里不写 ON 就必须用它 |
| 结果行数重复 | 一对多 JOIN 之后,「一」那边的行会出现多次 |

## 常见误区

**不写表前缀。** 多表里 `id` 这种同名列直接报 `ambiguous column name: id`。每个列都写 `别名.列`。

**`ON` 写成了别的列。** 实测 `ON c.id = i.id` 不报错,得到 10 行看起来合理但全部错配的结果。用业务常识抽查几行,尤其是金额对不对得上。

**漏写 `ON`。** SQLite 不报错,实测得到 15 × 10 = 150 行的笛卡尔积。Postgres 里会直接报语法错误。

**以为内连接不会丢数据。** 15 号孤儿发票被丢掉了,未付发票从 4 张变成 3 张,没有任何提示。做统计前先想「两边对不上的行去哪了」。

**需要保住左表却用了内连接。** 想列「所有客户」却用 `JOIN`,6 号和 10 号就消失了。想保住谁,谁放左边,用 `LEFT JOIN`。

**LEFT JOIN 后面用 `WHERE` 筛右表。** 实测 `WHERE i.status = 'unpaid'` 把左连接变成了内连接,只剩 3 行。筛右表的条件放进 `ON`。

**把 JOIN 后的行数当成实体数。** 一对多以后星河餐饮出现 3 次,数结果行数得到 16,不是 10 家客户。要按客户统计,明天学 `GROUP BY`。

**忽略 JOIN 的结果顺序。** 不写 `ORDER BY`,顺序没有保证,只是碰巧看起来整齐。要稳定顺序就写。

**外键列不检查。** 今天的表没有外键约束,所以孤儿发票能存进去。Day 91 学约束,让数据库替你挡住这种数据。

## 学习资料

### 文档与文章

- [SQLite 官方 · SELECT(英文)](https://sqlite.org/lang_select.html):JOIN 的完整语法图在「FROM 子句」那一段,看看 INNER/LEFT/CROSS/NATURAL 都能怎么写。
- [SQLite 官方 · 3.39.0 发布说明(英文)](https://sqlite.org/releaselog/3_39_0.html):RIGHT JOIN 和 FULL JOIN 是从这一版开始支持的,今天提到的版本要求出处在这里。
- [SQLite 官方 · Quirks, Caveats, and Gotchas(英文)](https://sqlite.org/quirks.html):SQLite 和别的数据库不一样的地方清单,今天碰到的「宽松」都能在这里找到出处。
- [SQLBolt · 第 6 课:Multi-table queries with JOINs(英文)](https://sqlbolt.com/lesson/select_queries_with_joins)和[第 7 课:OUTER JOINs](https://sqlbolt.com/lesson/select_queries_with_outer_joins):浏览器里练内连接、外连接,每课带习题,做错了当场告诉你。
- [菜鸟教程 · SQLite Joins](https://www.runoob.com/sqlite/sqlite-joins.html):中文,内连接、外连接、交叉连接各给了一个例子,适合当速查。
- [PostgreSQL 官方教程 · Joins Between Tables(英文)](https://www.postgresql.org/docs/current/tutorial-join.html):Postgres 版本的 JOIN 入门,用的是天气和城市两张表,把今天的内容和后面 Day 228 的 Postgres 接起来。
- [Coding Horror · A Visual Explanation of SQL Joins(英文)](https://blog.codinghorror.com/a-visual-explanation-of-sql-joins/):用韦恩图讲各种 JOIN,是很多人入门时看的那篇。韦恩图只能表达「哪些行保留」,表达不了「一对多会让行重复」,所以今天文章里的图以实际行数为准。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1THazzWE6J&autoplay=0&high_quality=1" title="SQL 第5节｜表与表之间关联,Inner Join、Left Join、Full Join的用法～" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>卡卡老师讲数据科学 · SQL 第 5 节 表与表之间关联,Inner Join、Left Join、Full Join 的用法 · 约 6 分半钟,播放 3.5 万,2025 年发布。对应今天第 2、5 步,一边看一边在 practice.db 里自己试。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1R6421f7DQ&autoplay=0&high_quality=1" title="你必须知道的6种SQL连接方式(动画+练习)" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>Yimcode · 你必须知道的 6 种 SQL 连接方式(动画+练习) · 约 10 分钟,播放 2.8 万。用动画演示 6 种连接怎么配行,第 7 步的「为什么 WHERE 会让左连接变内连接」看完动画更好理解。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/aY7z4HcHm5M" title="SQL Joins Basics (Visually Explained) | INNER, LEFT, RIGHT, FULL | #SQL Course 8" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Data with Baraa · SQL Joins Basics (Visually Explained) · 英文,可开字幕。标题里的 INNER、LEFT、RIGHT、FULL 四种连接一条条演示,配了图。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/9yeOJ0ZMUYw" title="SQL Joins Explained |¦| Joins in SQL |¦| SQL Tutorial" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Socratica · SQL Joins Explained · 英文,可开字幕。Socratica 的 SQL 入门系列之一,画面干净,和今天的内容对照着看。</figcaption>
</figure>

### 书籍

- Ben Forta,《SQL必知必会》(第 5 版),人民邮电出版社(原书 *Sams Teach Yourself SQL in 10 Minutes a Day*,5th ed.,2019)。第 12、13 课讲联结(joins)和创建高级联结,正好对应今天的内连接和左连接。
- Alan Beaulieu,《Learning SQL》(第 3 版),O'Reilly,2020(英文)。有两章专门讲多表查询,一章先讲内连接,另一章回头补外连接和交叉连接,想系统补一遍时看。

### 开源项目与代码

今天这组不需要。等 Day 94 做迷你账单库时,今天的 `invoices.sql` 和这些 JOIN 会直接用上。

## 自测

1. `invoices` 表里为什么只存 `customer_id`,不直接把公司名也存进去?

<details><summary>答案</summary>

公司名只应该在 `customers` 里存一份。发票里再存一份,公司改名时就得改所有发票,漏一条就前后不一致;一个客户有几十张发票时空间也浪费。只存 `customer_id`,要看公司名时用 JOIN 查。这种「一份数据只存一处,别处用 id 引用」是关系数据库的基本做法。

</details>

2. 为什么内连接查出 14 行,而发票表有 15 行?15 号发票去哪了?怎么把它找出来?

<details><summary>答案</summary>

15 号发票的 `customer_id` 是 11,`customers` 表里没有 11 号,所以内连接配不上、整行被丢弃,不报错。找出它:把发票放左边做左连接再筛 NULL,`SELECT i.* FROM invoices i LEFT JOIN customers c ON c.id = i.customer_id WHERE c.id IS NULL`,得到 15 号。

</details>

3. 下面这句想列出所有客户,有未付发票的带上,为什么 6 号禾丰农业不见了?怎么改?`SELECT c.company, i.amount FROM customers c LEFT JOIN invoices i ON i.customer_id = c.id WHERE i.status = 'unpaid';`

<details><summary>答案</summary>

6 号没发票,左连接给它的 `i.status` 是 NULL,`WHERE i.status = 'unpaid'` 对 NULL 的判断是「不知道」,这行被筛掉,左连接就退化成了内连接。改成把条件放进 `ON`:`LEFT JOIN invoices i ON i.customer_id = c.id AND i.status = 'unpaid'`,不写 `WHERE`,10 个客户一家不少。

</details>

4. `SELECT count(*) FROM invoices JOIN customers;` 在 SQLite 里返回多少?为什么?在 Postgres 里呢?

<details><summary>答案</summary>

SQLite 返回 150 = 15 × 10:没有 `ON`,每张发票和每家客户都配了一遍(笛卡尔积)。Postgres 把这种写法当语法错误(`syntax error at or near ";"`),要笛卡尔积得写 `CROSS JOIN`。所以每个 JOIN 都要带 `ON`,并且检查行数是不是合理。

</details>

5. 面试题:一个客服 Agent 有「按客户查未付发票」的工具,内部用 SQL。你发现用户问「蓝鲸教育有没有未付款」时模型有时答「没有」,有时答「查不到这家公司」。从今天学的 JOIN 角度,可能出在哪里?

<details><summary>答案</summary>

几种可能:一是工具用了内连接,客户存在但没有未付发票,结果为空,模型把「空结果」理解成「查不到这家公司」,要区分「客户不存在」(先查客户表)和「客户存在但没有未付发票」(空列表),返回结构里要明确;二是 `ON` 写错键或漏写 `ON`,得到错误或重复的行,而结果「看起来合理」;三是左连接加了对右表的 `WHERE`,让客户整个消失;四是孤儿发票(客户已被删)被内连接静默丢掉,账其实对不上。工具应该分步返回明确的状态(客户找到没、发票几张),并用测试数据覆盖这些边界,包括没有发票的客户和孤儿发票。

</details>

## 明天预告

Day 88 · SQL(四):GROUP BY 和聚合函数。今天看到一对多的 JOIN 会让客户重复出现,数行数得不到客户数;而运营真正想问的是「每家客户一共开了多少钱的发票」「每个月收了多少」。明天学 `COUNT`、`SUM` 这类聚合函数、`GROUP BY` 分组和 `HAVING` 筛选,把 15 张发票按客户、按状态、按月份汇总。
