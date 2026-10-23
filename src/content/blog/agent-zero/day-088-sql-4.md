---
title: 'Day 88 · SQL(四):GROUP BY 和聚合函数'
description: '15 张发票放在表里,老板问的却是「总共收了多少钱」「每家客户欠多少」「哪个月收得最多」。今天学聚合函数 count、sum、avg、min、max 和 GROUP BY 分组、HAVING 筛组,再踩一遍 count(*) 数出假数字、WHERE 里放聚合报错、整数除法吞小数这几个坑。'
pubDate: 2026-10-23
regime: none
tags: ['sql', 'sqlite', 'group-by', 'database', 'agent-zero']
series: 'agent-zero'
day: 88
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 87](/blog/agent-zero/day-087-sql-3/) 新建了 `invoices` 表,用 `JOIN` 把发票和客户接起来:内连接只留两边都对得上的行,所以 15 号孤儿发票被悄悄丢掉;左连接保住左表的每一行,配不上的右边补 `NULL`,再用 `WHERE 右表.id IS NULL` 找出「没有发票的客户」。最后还看到一对多的 JOIN 会让客户重复出现,星河餐饮有 3 张发票就占 3 行,所以直接数结果的行数得不到客户数。

这些查询返回的都是「一行行的明细」。可是业务上更常被问到的是汇总:一共收了多少钱,每家客户欠多少,每个月开了几张发票。这就是今天的内容:把很多行**压缩成一个数字**(聚合函数),再按某一列把行**分成几堆,每堆各算一个数字**(`GROUP BY`)。

## 今天要解决的问题

学完今天,你应该能做到:

1. 用 `count`、`sum`、`avg`、`min`、`max` 对整张表求汇总,说得清 `count(*)`、`count(列)`、`count(DISTINCT 列)` 三者的区别,知道聚合函数会跳过 `NULL`。
2. 用 `GROUP BY` 按一列或两列分组,例如按发票状态、按套餐、按月份,并且能把 `GROUP BY` 和 `JOIN` 配合起来做「每家客户的发票合计」。
3. 分清 `WHERE` 和 `HAVING`:`WHERE` 在分组前筛行,`HAVING` 在分组后筛组;知道为什么 `WHERE sum(...) > 3000` 会报错。
4. 认出几个坑:`LEFT JOIN` 之后 `count(*)` 给没发票的客户数出 1、`sum` 对空集返回 `NULL`、整数相除吞掉小数、SQLite 允许 `SELECT` 里放不在分组里的「裸列」而 Postgres 不允许。

今天两个新概念:**聚合函数**(多行变一个值)和 **GROUP BY**(分组后各自聚合,配套的 `HAVING` 筛组)。

预计用时:3 小时。花费 ¥0,不写 Python,只用终端。

前置:[Day 85](/blog/agent-zero/day-085-sql-1/) 的 `SELECT`、`WHERE`、`NULL`、`ORDER BY`;[Day 86](/blog/agent-zero/day-086-sql-2/) 的重建 `practice.db`;[Day 87](/blog/agent-zero/day-087-sql-3/) 的 `invoices` 表和 `JOIN`、`LEFT JOIN`;[Day 24](/blog/agent-zero/day-024-dicts/) 的字典计数(对照 `GROUP BY`)。

学法:先对照文章逐行敲一遍(不复制粘贴)并跑通;第二天合上文章,默写「按状态统计张数和金额」「每家客户的发票合计」「合计超过 3000 的客户」三条查询;做练习,做不出再展开参考答案,看完关掉自己重写一遍。

## 从前端看:汇总就是 reduce,分组就是按 key 归堆

前端算总额,你会写:

```js
const total = invoices.reduce((sum, i) => sum + i.amount, 0);   // 多个值压成一个
```

按状态分组统计,你会写一个对象当桶:

```js
const byStatus = {};
for (const i of invoices) {
  byStatus[i.status] ??= { n: 0, total: 0 };   // 这个状态第一次出现,开一个新桶
  byStatus[i.status].n += 1;
  byStatus[i.status].total += i.amount;
}
```

SQL 把这两件事都做成了关键字:`sum(amount)` 是第一段的 `reduce`,`GROUP BY status` 是第二段的「按 key 开桶」,而且每个桶里算什么(`count(*)`、`sum(amount)`)由 `SELECT` 里写的聚合函数决定。你只说「按 status 分组,每组数个数、加金额」,数据库自己去循环。

<figure>
<svg viewBox="0 0 640 260" role="img" aria-label="GROUP BY 的过程:15 行发票按 status 分成 paid、unpaid、refunded 三堆,每堆各算 count 和 sum,得到三行结果">
<rect x="0" y="0" width="640" height="260" fill="var(--paper-raised)" rx="6"/>
<g font-family="var(--font-mono)" font-size="12">
<text x="20" y="24" fill="var(--ink)">invoices(15 行)</text>
<text x="250" y="24" fill="var(--ink)">按 status 分堆</text>
<text x="470" y="24" fill="var(--ink)">每堆算一行</text>
<rect x="20" y="36" width="170" height="26" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="30" y="54" fill="var(--ink-soft)">1  paid     1188</text>
<rect x="20" y="66" width="170" height="26" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="30" y="84" fill="var(--ink-soft)">3  unpaid   1188</text>
<rect x="20" y="96" width="170" height="26" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="30" y="114" fill="var(--ink-soft)">11 refunded 78</text>
<rect x="20" y="126" width="170" height="26" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="30" y="144" fill="var(--ink-soft)">… 共 15 行</text>
<rect x="250" y="36" width="170" height="52" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="260" y="56" fill="var(--ink)">paid 堆:10 行</text>
<text x="260" y="76" fill="var(--ink-soft)">1,2,4,5,6,8,9,10,12,14</text>
<rect x="250" y="98" width="170" height="40" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="260" y="116" fill="var(--ink)">unpaid 堆:4 行</text>
<text x="260" y="132" fill="var(--ink-soft)">3,7,13,15</text>
<rect x="250" y="148" width="170" height="30" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="260" y="168" fill="var(--ink)">refunded 堆:1 行</text>
<rect x="470" y="36" width="150" height="52" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="480" y="56" fill="var(--ink)">paid</text>
<text x="480" y="76" fill="var(--ink-soft)">n=10 total=79898</text>
<rect x="470" y="98" width="150" height="40" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="480" y="116" fill="var(--ink)">unpaid</text>
<text x="480" y="132" fill="var(--ink-soft)">n=4 total=20041</text>
<rect x="470" y="148" width="150" height="30" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="480" y="168" fill="var(--ink)">refunded 1 / 78</text>
<line x1="190" y1="80" x2="250" y2="80" stroke="var(--rule)"/>
<line x1="420" y1="80" x2="470" y2="80" stroke="var(--rule)"/>
<text x="20" y="208" fill="var(--ink)">WHERE 在「分堆之前」筛掉行;HAVING 在「算完每堆」之后筛掉整堆。</text>
<text x="20" y="232" fill="var(--ink-faint)" font-size="11">一堆在结果里只占一行,结果的行数 = 堆数,不再是原来的发票数。</text>
</g>
</svg>
<figcaption>GROUP BY 先把行按分组列的值分成几堆(蓝色),每堆再套聚合函数算出一行(琥珀色)。数字是下面第 3 步的实跑结果。</figcaption>
</figure>

## 第 0 步:准备环境

确认两张表都在、数据是干净的(Day 86 说过,做完写入类练习要还原):

```bash
cd /Users/你/agent-zero-lab/part01/sql
sqlite3 practice.db < customers.sql
sqlite3 practice.db < invoices.sql
sqlite3 practice.db "SELECT count(*) FROM customers; SELECT count(*) FROM invoices;"
```

<div class="line-notes">

- `cd /Users/你/agent-zero-lab/part01/sql` 进入 SQL 目录。
- `sqlite3 practice.db < customers.sql` 重建客户表,10 行(`DROP TABLE IF EXISTS` 让它可以反复跑)。
- `sqlite3 practice.db < invoices.sql` 重建发票表,15 行,包含故意留的孤儿发票(15 号)、没有发票的客户(6、10 号)。
- 最后一条命令一次跑两个 `SELECT count(*)`:`count(*)` 就是「数行数」,今天要细讲,先用它确认数据。

</div>

```text
10
15
```

下面所有查询都带 `-header`(结果带列名)。

## 第 1 步:聚合函数,多行压成一个值

**聚合函数**(aggregate function)吃进一批行,吐出**一个**值。最常用的五个:`count`(数个数)、`sum`(求和)、`avg`(平均)、`min`(最小)、`max`(最大)。对整张发票表一起算:

```sql
SELECT count(*)      AS n,
       sum(amount)   AS total,
       avg(amount)   AS average,
       min(amount)   AS smallest,
       max(amount)   AS biggest
FROM invoices;
```

<div class="line-notes">

- `SELECT count(*)      AS n,` `count(*)` 数这张表一共有几行,`AS n` 给结果列起名。
- `sum(amount)   AS total,` 把所有发票的 `amount` 加起来。
- `avg(amount)   AS average,` 平均值,总额除以张数。
- `min(amount)   AS smallest,` 最小的一张,是 11 号半岛咖啡的 78 元。
- `max(amount)   AS biggest` 最大的一张,是启明科技的 27860 元。
- `FROM invoices;` 数据来源是整张发票表。不写 `WHERE` 就是 15 行都参与。

</div>

实跑输出:

```text
n|total|average|smallest|biggest
15|100017|6667.8|78|27860
```

15 张发票,总额 100017 元,平均每张 6667.8 元。你会发现结果只有**一行**:不管原来多少行,没有 `GROUP BY` 的聚合,整张表被压成一行。

聚合函数可以和 `WHERE` 配合,`WHERE` 先筛行,筛完的行再聚合。只算已付的:

```sql
SELECT count(*) AS n, sum(amount) AS total
FROM invoices
WHERE status = 'paid';
```

<div class="line-notes">

- `SELECT count(*) AS n, sum(amount) AS total` 数张数、求总额。
- `FROM invoices` 来源是发票表。
- `WHERE status = 'paid';` 先把已付的 10 行挑出来,聚合只在这 10 行上算。

</div>

```text
n|total
10|79898
```

10 张已付,合计 79898 元。**顺序要记住:先 WHERE 筛行,再聚合。**

## 第 2 步:count 的三种写法,NULL 会被跳过

`count` 有三种常用写法,在有 `NULL` 的 `customers` 表上看区别:

```sql
SELECT count(*)              AS all_rows,
       count(email)          AS has_email,
       count(city)           AS has_city,
       count(DISTINCT plan)  AS plans,
       count(DISTINCT city)  AS cities
FROM customers;
```

<div class="line-notes">

- `SELECT count(*)              AS all_rows,` `count(*)` 数**行数**,不管列里是不是 NULL。customers 有 10 行。
- `count(email)          AS has_email,` `count(列)` 数这一列**不是 NULL** 的行数。4 号蓝鲸教育没有邮箱,所以是 9。
- `count(city)           AS has_city,` 6 号禾丰农业没填城市,也是 9。
- `count(DISTINCT plan)  AS plans,` `DISTINCT` 是「去重」,数有几种不同的套餐:基础版、专业版、企业版,3 种。
- `count(DISTINCT city)  AS cities` 不同的城市有几个:杭州、上海、成都、北京、深圳、青岛、天津,7 个(NULL 不算一个城市)。
- `FROM customers;` 来源是客户表。

</div>

实跑输出:

```text
all_rows|has_email|has_city|plans|cities
10|9|9|3|7
```

三种写法的口诀:`count(*)` 数行;`count(列)` 数非空;`count(DISTINCT 列)` 数不同的非空值。**除了 `count(*)`,其他聚合函数都会跳过 NULL**:`sum`、`avg`、`min`、`max` 对一列求值时,NULL 的行不参与,`avg` 的分母也不包含它们。这和 Day 85 学的「NULL 是不知道」一脉相承:不知道的值没法加。

## 第 3 步:GROUP BY,分堆再各自聚合

想要「每种状态各有几张、金额多少」,就是把第 1 步的整表聚合,拆成每种状态各算一次:

```sql
SELECT status, count(*) AS n, sum(amount) AS total
FROM invoices
GROUP BY status;
```

<div class="line-notes">

- `SELECT status, count(*) AS n, sum(amount) AS total` 三列:分组的依据 `status`,这一堆里的行数,这一堆的金额合计。**`SELECT` 里允许直接写的普通列,应该就是 `GROUP BY` 里的列**,其他列必须包在聚合函数里。
- `FROM invoices` 来源。
- `GROUP BY status;` 按 `status` 的值分堆:值相同的行进同一堆。`status` 有 3 个取值,所以结果有 3 行。

</div>

实跑输出(用 `-box` 画的表格):

```text
┌──────────┬────┬───────┐
│  status  │ n  │ total │
├──────────┼────┼───────┤
│ paid     │ 10 │ 79898 │
│ refunded │ 1  │ 78    │
│ unpaid   │ 4  │ 20041 │
└──────────┴────┴───────┘
```

3 个状态 3 行:已付 10 张共 79898,已退款 1 张共 78,未付 4 张共 20041。三个金额加起来 79898 + 78 + 20041 = 100017,和第 1 步的总额一致,这是核对分组有没有漏行的好办法。结果的顺序没有保证,想按金额排,在最后加 `ORDER BY total DESC`(`ORDER BY` 可以直接用 `SELECT` 里起的别名,Day 85 讲过)。

再换几个分组。客户表按套餐分,看每种套餐的客户数和席位数:

```sql
SELECT plan, count(*) AS customers, sum(seats) AS seats
FROM customers
GROUP BY plan
ORDER BY seats DESC;
```

<div class="line-notes">

- `SELECT plan, count(*) AS customers, sum(seats) AS seats` 套餐名、这个套餐有几家客户、这些客户的席位总数。
- `GROUP BY plan` 按套餐分三堆。
- `ORDER BY seats DESC;` 席位多的排前面。排序发生在分组之后,所以能用聚合的结果。

</div>

```text
┌──────┬───────────┬───────┐
│ plan │ customers │ seats │
├──────┼───────────┼───────┤
│ 企业版  │ 2         │ 225   │
│ 专业版  │ 4         │ 59    │
│ 基础版  │ 4         │ 11    │
└──────┴───────────┴───────┘
```

企业版只有 2 家,席位却占了 225,是最大的一块:远山物流 85 加启明科技 140。专业版 4 家(12、20、18、9 席,共 59)。这类「按套餐汇总」在后面 Day 228 的 Postgres 练习里还会再做一次。

按月份汇总已付发票,分组的依据是日期的前 7 个字符:

```sql
SELECT substr(issued_at, 1, 7) AS month, count(*) AS n, sum(amount) AS paid_total
FROM invoices
WHERE status = 'paid'
GROUP BY month
ORDER BY month;
```

<div class="line-notes">

- `SELECT substr(issued_at, 1, 7) AS month, count(*) AS n, sum(amount) AS paid_total` `substr(文本, 起点, 长度)` 从第 1 个字符开始取 7 个字符,`'2026-08-01'` 变成 `'2026-08'`,也就是「年-月」。起个别名 `month`。因为日期是固定格式的文本(Day 85),直接截就行。
- `WHERE status = 'paid'` 先只留已付。
- `GROUP BY month` 可以直接按别名分组(SQLite 和 Postgres 都允许)。
- `ORDER BY month;` 按月份排。

</div>

```text
month|n|paid_total
2026-07|1|1188
2026-08|5|47862
2026-09|4|30848
```

7 月 1 张,8 月 5 张共 47862,9 月 4 张共 30848。10 月只有一张未付的,被 `WHERE` 筛掉,所以没有出现。

可以同时按**两列**分组,每一对不同的取值组合是一堆:

```sql
SELECT substr(issued_at, 1, 7) AS month, status, count(*) AS n, sum(amount) AS total
FROM invoices
GROUP BY month, status
ORDER BY month, status;
```

<div class="line-notes">

- `SELECT substr(issued_at, 1, 7) AS month, status, count(*) AS n, sum(amount) AS total` 两个分组依据 `month` 和 `status`,加两个聚合。
- `GROUP BY month, status` 「月份和状态都相同」才算一堆。
- `ORDER BY month, status;` 先按月再按状态排。

</div>

```text
month|status|n|total
2026-07|paid|1|1188
2026-08|paid|5|47862
2026-09|paid|4|30848
2026-09|refunded|1|78
2026-09|unpaid|3|19885
2026-10|unpaid|1|156
```

6 堆。9 月出现了三种状态:4 张已付、1 张退款、3 张未付(共 8 张)。10 月只有 1 张,就是孤儿发票 15 号,156 元。

## 第 4 步:GROUP BY 配合 JOIN,每家客户的合计

「每家客户总共开了多少钱的发票」,公司名在 `customers`,金额在 `invoices`,得先 JOIN 再分组:

```sql
SELECT c.id, c.company, count(i.id) AS invoices, sum(i.amount) AS total
FROM customers c
JOIN invoices i ON i.customer_id = c.id
GROUP BY c.id, c.company
ORDER BY total DESC, c.id;
```

<div class="line-notes">

- `SELECT c.id, c.company, count(i.id) AS invoices, sum(i.amount) AS total` 客户的 id 和公司名,这个客户的发票张数,发票金额合计。`count(i.id)` 数发票的 id,下一步会解释为什么不写 `count(*)`。
- `FROM customers c` 以客户表为主。
- `JOIN invoices i ON i.customer_id = c.id` Day 87 的内连接,每张发票配上它的客户,一对多。
- `GROUP BY c.id, c.company` 按客户分堆。写 `c.id` 保证唯一;`c.company` 也写上,是因为 `SELECT` 里要显示它,Postgres 要求显示的列必须出现在 `GROUP BY` 里。
- `ORDER BY total DESC, c.id;` 金额大的在前;金额相同(星河餐饮和云杉律所都是 3564)再按 id 排,让输出顺序稳定。

</div>

实跑输出:

```text
┌────┬─────────┬──────────┬───────┐
│ id │ company │ invoices │ total │
├────┼─────────┼──────────┼───────┤
│ 5  │ 启明科技    │ 2        │ 55720 │
│ 3  │ 远山物流    │ 2        │ 33830 │
│ 1  │ 星河餐饮    │ 3        │ 3564  │
│ 8  │ 云杉律所    │ 2        │ 3564  │
│ 4  │ 蓝鲸教育    │ 1        │ 1980  │
│ 9  │ 北辰贸易    │ 1        │ 891   │
│ 2  │ 青木设计    │ 2        │ 234   │
│ 7  │ 半岛咖啡    │ 1        │ 78    │
└────┴─────────┴──────────┴───────┘
```

8 行,只有 8 家客户,因为是内连接:6 号禾丰农业和 10 号小满花店没有发票,被丢掉了。启明科技两张各 27860,共 55720。星河餐饮三张各 1188,共 3564。这也解决了昨天留下的问题:一对多 JOIN 让客户重复出现,`GROUP BY` 一分组,每家客户又只剩一行。

## 第 5 步:LEFT JOIN 后的 count(*),数出假数字

运营说:「没发票的客户也要在名单里,显示 0 张、0 元。」顺手把内连接改成左连接,保住 6 号和 10 号:

```sql
SELECT c.id, c.company, count(*) AS invoices, sum(i.amount) AS total
FROM customers c
LEFT JOIN invoices i ON i.customer_id = c.id
WHERE c.id IN (1, 6, 10)
GROUP BY c.id, c.company
ORDER BY c.id;
```

<div class="line-notes">

- `SELECT c.id, c.company, count(*) AS invoices, sum(i.amount) AS total` 这次故意写 `count(*)`。
- `LEFT JOIN invoices i ON i.customer_id = c.id` 左连接,6 号和 10 号各留一行,右边全是 NULL。
- `WHERE c.id IN (1, 6, 10)` 只看三家方便对比:星河餐饮(有 3 张)、禾丰农业和小满花店(没有)。
- `GROUP BY c.id, c.company` 按客户分组。

</div>

```text
┌────┬─────────┬──────────┬───────┐
│ id │ company │ invoices │ total │
├────┼─────────┼──────────┼───────┤
│ 1  │ 星河餐饮    │ 3        │ 3564  │
│ 6  │ 禾丰农业    │ 1        │       │
│ 10 │ 小满花店    │ 1        │       │
└────┴─────────┴──────────┴───────┘
```

禾丰农业**一张发票都没有**,却显示「1 张」,而且 `total` 是空的(NULL)。原因:左连接给它留了一行(右边全是 NULL),`count(*)` 数的是「这一堆有几行」,这一堆就是那一行,所以是 1。**`count(*)` 数的是行,不是「真正的发票」。** 改成数右表的主键 `count(i.id)`:这一行里 `i.id` 是 NULL,`count(列)` 跳过 NULL,就得到 0 了。再用 `coalesce(x, 0)` 把 `sum` 的 NULL 换成 0。`coalesce(a, b)` 的意思是「`a` 不是 NULL 就用 `a`,否则用 `b`」:

```sql
SELECT c.id, c.company,
       count(i.id)                 AS invoices,
       coalesce(sum(i.amount), 0)  AS total
FROM customers c
LEFT JOIN invoices i ON i.customer_id = c.id
GROUP BY c.id, c.company
ORDER BY total DESC, c.id;
```

<div class="line-notes">

- `SELECT c.id, c.company,` 客户的两列,逗号结尾,下面接着写聚合。
- `count(i.id)                 AS invoices,` 数右表的 `id`,配不上的客户 `i.id` 是 NULL,不被数,得 0。
- `coalesce(sum(i.amount), 0)  AS total` 先 `sum`,没有发票时 `sum` 的结果是 NULL(下面第 7 步细讲),`coalesce` 把它换成 0。
- `LEFT JOIN invoices i ON i.customer_id = c.id` 保住所有客户。
- `GROUP BY c.id, c.company` 每家客户一堆。
- `ORDER BY total DESC, c.id;` 金额降序,同额按 id 排。

</div>

```text
┌────┬─────────┬──────────┬───────┐
│ id │ company │ invoices │ total │
├────┼─────────┼──────────┼───────┤
│ 5  │ 启明科技    │ 2        │ 55720 │
│ 3  │ 远山物流    │ 2        │ 33830 │
│ 1  │ 星河餐饮    │ 3        │ 3564  │
│ 8  │ 云杉律所    │ 2        │ 3564  │
│ 4  │ 蓝鲸教育    │ 1        │ 1980  │
│ 9  │ 北辰贸易    │ 1        │ 891   │
│ 2  │ 青木设计    │ 2        │ 234   │
│ 7  │ 半岛咖啡    │ 1        │ 78    │
│ 6  │ 禾丰农业    │ 0        │ 0     │
│ 10 │ 小满花店    │ 0        │ 0     │
└────┴─────────┴──────────┴───────┘
```

10 家客户一个不少,6 号和 10 号是 0 张、0 元。这是**今天最容易出事的一个坑**:左连接加 `count(*)` 不报错、数字还「像模像样」(1),没人发现就会被一路用下去。规矩是:**LEFT JOIN 之后数右表,一定数右表的主键列。**

## 第 6 步:HAVING,筛的是分好的组

问题:「哪些客户发票合计超过 3000 元?」你会想在 `WHERE` 里写 `sum(amount) > 3000`。试一下:

```sql
SELECT c.company, sum(i.amount) AS total
FROM customers c
JOIN invoices i ON i.customer_id = c.id
WHERE sum(i.amount) > 3000
GROUP BY c.id, c.company;
```

```text
Error: in prepare, misuse of aggregate: sum()
  s c JOIN invoices i ON i.customer_id = c.id WHERE sum(i.amount) > 3000 GROUP B
                                      error here ---^
```

`misuse of aggregate: sum()`:聚合函数用错地方了。原因在执行顺序:**`WHERE` 是在分组之前、一行一行筛的**,这时候还没分堆,没有「这个客户的合计」可以比较。要筛「分好堆以后每堆的结果」,用 `HAVING`:

```sql
SELECT c.company, sum(i.amount) AS total
FROM customers c
JOIN invoices i ON i.customer_id = c.id
GROUP BY c.id, c.company
HAVING sum(i.amount) > 3000
ORDER BY total DESC;
```

<div class="line-notes">

- `SELECT c.company, sum(i.amount) AS total` 公司名和它的发票合计。
- `JOIN invoices i ON i.customer_id = c.id` 先配对。
- `GROUP BY c.id, c.company` 先分堆,每家客户一堆。
- `HAVING sum(i.amount) > 3000` 对**每一堆算出的合计**做判断,不满足的整堆丢掉。`HAVING` 里可以写聚合函数,位置必须在 `GROUP BY` 之后。注意这里要重写 `sum(i.amount)`,在 SQLite 里用别名 `total` 也行,但 Postgres 不认,所以养成写完整表达式的习惯。
- `ORDER BY total DESC;` 最后排序。

</div>

```text
company|total
启明科技|55720
远山物流|33830
星河餐饮|3564
云杉律所|3564
```

4 家客户超过 3000,其余 4 家(蓝鲸 1980、北辰 891、青木 234、半岛 78)被筛掉。Postgres 的报错更直白:`aggregate functions are not allowed in WHERE`。

`WHERE` 和 `HAVING` 可以同时出现,各管各的:`WHERE` 先筛原始行,`HAVING` 再筛分好的组。「只看未付发票,合计超过 1500 的客户」:

```sql
SELECT c.company, count(*) AS unpaid_n, sum(i.amount) AS unpaid_total
FROM customers c
JOIN invoices i ON i.customer_id = c.id
WHERE i.status = 'unpaid'
GROUP BY c.id, c.company
HAVING sum(i.amount) > 1500
ORDER BY unpaid_total DESC;
```

<div class="line-notes">

- `SELECT c.company, count(*) AS unpaid_n, sum(i.amount) AS unpaid_total` 公司名、未付张数、未付金额。这里内连接,不会有「没发票的客户」,用 `count(*)` 是安全的。
- `WHERE i.status = 'unpaid'` **分组之前**只留未付的发票:3、7、13 号(15 号是孤儿,被内连接丢了),三张。
- `GROUP BY c.id, c.company` 按客户分堆:星河餐饮 1 张 1188,远山物流 1 张 16915,云杉律所 1 张 1782。
- `HAVING sum(i.amount) > 1500` **分组之后**筛合计:1188 不到 1500,星河餐饮整堆被丢。
- `ORDER BY unpaid_total DESC;` 金额降序。

</div>

```text
company|unpaid_n|unpaid_total
远山物流|1|16915
云杉律所|1|1782
```

整体顺序一句话:`FROM / JOIN` 配表 → `WHERE` 筛行 → `GROUP BY` 分堆 → 聚合函数计算 → `HAVING` 筛堆 → `SELECT` 取列 → `ORDER BY` 排序 → `LIMIT` 截断。**能在分组之前筛掉的条件放 `WHERE`,不要全堆在 `HAVING` 里**,数据多时前者快得多,因为要分堆的行少了。

`HAVING count(*) > 1` 是一个很常用的组合:**找重复**。哪些客户开了不止一张发票?

```sql
SELECT customer_id, count(*) AS n
FROM invoices
GROUP BY customer_id
HAVING count(*) >= 2
ORDER BY customer_id;
```

<div class="line-notes">

- `SELECT customer_id, count(*) AS n` 客户编号和它的发票张数。
- `FROM invoices` 只用发票表,不用 JOIN。
- `GROUP BY customer_id` 同一个客户的发票进一堆。
- `HAVING count(*) >= 2` 只留张数不少于 2 的堆。
- `ORDER BY customer_id;` 按编号排。

</div>

```text
customer_id|n
1|3
2|2
3|2
5|2
8|2
```

5 家开了 2 张及以上。把 `count(*) >= 2` 换成按「同一客户同一天」分组再 `HAVING count(*) > 1`,就是查「重复开票」,练习 5 会做。

## 第 7 步:三个静悄悄的坑

**坑一:整数相除吞小数。** SQLite 里两个整数相除,结果还是整数:

```sql
SELECT sum(amount) / count(*)               AS int_div,
       sum(amount) * 1.0 / count(*)         AS real_div,
       round(sum(amount) * 1.0 / count(*), 2) AS rounded,
       avg(amount)                          AS av
FROM invoices;
```

<div class="line-notes">

- `SELECT sum(amount) / count(*)               AS int_div,` `sum` 是整数 100017,`count` 是整数 15,整数除整数,SQLite 丢掉小数部分,得 6667。
- `sum(amount) * 1.0 / count(*)         AS real_div,` 乘一个 `1.0` 让它变成小数再除,保留小数 6667.8。
- `round(sum(amount) * 1.0 / count(*), 2) AS rounded,` `round(数, 位数)` 四舍五入到小数点后两位。这里刚好是 6667.8。
- `avg(amount)                          AS av` `avg` 自己就返回小数,和第 1 步一样 6667.8。
- `FROM invoices;` 来源。

</div>

```text
int_div|real_div|rounded|av
6667|6667.8|6667.8|6667.8
```

`int_div` 是 6667,小数 0.8 被吞掉了。算「平均值」一律用 `avg(...)`,或者先乘 `1.0`。要算比例、百分比时更要当心:`paid_count / total_count` 两个整数相除永远得 0 或 1。Postgres 里 `sum(整数列)` 和 `count(*)` 都是 bigint,bigint 除 bigint 同样取整,这一点两边一致。

**坑二:没有行可算的时候,`sum` 给的是 NULL,不是 0。** 找一个不存在的状态 `void`:

```sql
SELECT sum(amount)          AS s,
       total(amount)        AS t,
       count(*)             AS n,
       typeof(sum(amount))  AS type_of_sum
FROM invoices
WHERE status = 'void';
```

<div class="line-notes">

- `SELECT sum(amount)          AS s,` `WHERE` 筛完一行都不剩,对空集求和,SQL 规定结果是 `NULL`(「没有数据可加」,不是「合计是 0」)。
- `total(amount)        AS t,` `total` 是 SQLite 自己的聚合函数,跟 `sum` 一样求和,但空集返回 `0.0`,而且永远返回小数。Postgres 里没有它。
- `count(*)             AS n,` 数行数,空集是 0。`count` 对空集返回 0,不是 NULL。
- `typeof(sum(amount))  AS type_of_sum` Day 86 的 `typeof`,确认 `sum` 返回的类型是 `null`。
- `WHERE status = 'void';` 没有任何发票是 `void`,所以是空集。

</div>

```text
s|t|n|type_of_sum
|0.0|0|null
```

第一格是空的(NULL),`total` 给 `0.0`,`count` 给 0。这就是为什么第 5 步要写 `coalesce(sum(...), 0)`:没有数据时 `sum` 是 NULL,拿 NULL 去做加减或者给前端显示,会变成 `null`、`NaN`、「undefined」。可移植的写法是:

```sql
SELECT coalesce(sum(amount), 0) AS s
FROM invoices
WHERE status = 'void';
```

<div class="line-notes">

- `SELECT coalesce(sum(amount), 0) AS s` `sum` 为 NULL 时用 0 顶替。Postgres、MySQL 里同样能用。
- `FROM invoices` 来源。
- `WHERE status = 'void';` 空集,和上一条一样。

</div>

```text
s
0
```

**坑三:SQLite 允许「裸列」。** 在 `GROUP BY status` 的查询里,`SELECT` 写了一个不在分组里、也没包在聚合函数里的列 `amount`:

```bash
sqlite3 -header practice.db "SELECT status, amount FROM invoices GROUP BY status;"
```

<div class="line-notes">

- `SELECT status, amount FROM invoices GROUP BY status;` `status` 是分组依据,没问题;`amount` 既不在 `GROUP BY` 里,也没有 `sum`、`max` 这样的聚合包着。一个堆里有好几行,每行 `amount` 都不同,该显示哪个?

</div>

```text
status|amount
paid|1188
refunded|78
unpaid|1188
```

SQLite **不报错**,从每堆里随便挑一行的值给你(官方文档把这种用法叫 bare column,说明了一种特例:只有用了 `min()` 或 `max()` 时,裸列取的才是那一行,见 [SELECT 文档里的「Bare columns in an aggregate query」](https://sqlite.org/lang_select.html#bareagg))。这里 `paid` 堆里有 10 张发票,金额从 117 到 27860 都有,它偏偏给了 1188,毫无意义,而且换一个版本可能就变了。Postgres 对这种写法直接拒绝:`column "invoices.amount" must appear in the GROUP BY clause or be used in an aggregate function`。**SQLite 里自己要守这条规矩:SELECT 里的每一列,要么在 GROUP BY 里,要么在聚合函数里。** 这条也是模型写 SQL 时最容易漏的,Day 291 开始做「问数 Agent」时要靠评测把它抓出来。

## 和前端代码对照

| 做什么 | SQL | JS |
| --- | --- | --- |
| 总额 | `SELECT sum(amount) FROM invoices` | `invoices.reduce((s, i) => s + i.amount, 0)` |
| 张数 | `count(*)` | `invoices.length` |
| 非空个数 | `count(email)` | `customers.filter(c => c.email != null).length` |
| 去重个数 | `count(DISTINCT plan)` | `new Set(customers.map(c => c.plan)).size` |
| 按状态分组统计 | `GROUP BY status` | `Object.groupBy(invoices, i => i.status)`,再对每组 `reduce` |
| 筛分好的组 | `HAVING sum(amount) > 3000` | 分组后再 `Object.entries(...).filter(...)` |
| 先筛行再分组 | `WHERE ... GROUP BY ...` | `invoices.filter(...)` 之后再分组 |
| 空集求和 | `sum` → `NULL` | `[].reduce(..., 0)` 得到初始值 0 |

`Object.groupBy` 是 2024 年进入 JS 标准的新方法,较老的 Node 里没有,用的话先查你的版本。重点是对照关系:SQL 的 `sum` 要自己处理空集,JS 的 `reduce` 的初始值帮你兜了底。

## 动手练习

每道题开始前先还原两张表:`sqlite3 practice.db < customers.sql` 和 `sqlite3 practice.db < invoices.sql`。

**练习 1:各套餐的已付收入。** 按客户的套餐(基础版/专业版/企业版)统计已付发票的张数和金额合计,金额从高到低排。

<details><summary>参考答案</summary>

```bash
sqlite3 -header practice.db "
SELECT c.plan, count(*) AS paid_invoices, sum(i.amount) AS paid_total
FROM customers c
JOIN invoices i ON i.customer_id = c.id
WHERE i.status = 'paid'
GROUP BY c.plan
ORDER BY paid_total DESC;"
```

<div class="line-notes">

- `SELECT c.plan, count(*) AS paid_invoices, sum(i.amount) AS paid_total` 分组依据是客户的 `plan`,聚合是发票的张数和金额。
- `FROM customers c` 套餐在客户表里。
- `JOIN invoices i ON i.customer_id = c.id` 配上发票。
- `WHERE i.status = 'paid'` 分组之前只留已付。
- `GROUP BY c.plan` 按套餐分三堆。
- `ORDER BY paid_total DESC;` 收入高的在前。

</div>

实跑输出:

```text
plan|paid_invoices|paid_total
企业版|3|72635
专业版|5|7029
基础版|2|234
```

企业版 3 张共 72635(远山 16915 + 启明 27860 × 2),专业版 5 张共 7029,基础版 2 张共 234(都是青木设计)。三个数加起来 72635 + 7029 + 234 = 79898,和第 1 步已付总额一致。半岛咖啡(基础版)只有一张退款发票,不是 `paid`,所以基础版里没有它。

</details>

**练习 2:大客户名单。** 已付发票合计**超过 10000 元**的客户,显示公司名和已付合计,金额高的在前。

<details><summary>参考答案</summary>

```bash
sqlite3 -header practice.db "
SELECT c.company, sum(i.amount) AS paid_total
FROM customers c
JOIN invoices i ON i.customer_id = c.id
WHERE i.status = 'paid'
GROUP BY c.id, c.company
HAVING sum(i.amount) > 10000
ORDER BY paid_total DESC;"
```

<div class="line-notes">

- `SELECT c.company, sum(i.amount) AS paid_total` 公司名和已付合计。
- `JOIN invoices i ON i.customer_id = c.id` 先配对。
- `WHERE i.status = 'paid'` 分组之前筛已付发票,这一步放 `WHERE` 而不是 `HAVING`,先把行数减下来。
- `GROUP BY c.id, c.company` 每家客户一堆。
- `HAVING sum(i.amount) > 10000` 分组之后筛合计,条件是「合计」,所以只能放 `HAVING`。
- `ORDER BY paid_total DESC;` 金额降序。

</div>

实跑输出:

```text
company|paid_total
启明科技|55720
远山物流|16915
```

只有两家。星河餐饮虽然总发票 3564,已付只有两张 2376,不够。

</details>

**练习 3:每个城市的客户数。** 按城市统计客户数和席位总数,客户数多的在前,客户数相同的按城市名排。注意观察没填城市的客户去了哪里。

<details><summary>参考答案</summary>

```bash
sqlite3 -header practice.db "
SELECT city, count(*) AS customers, sum(seats) AS seats
FROM customers
GROUP BY city
ORDER BY customers DESC, city;"
```

<div class="line-notes">

- `SELECT city, count(*) AS customers, sum(seats) AS seats` 城市、这个城市有几家客户、席位合计。
- `FROM customers` 只用客户表。
- `GROUP BY city` 按城市分堆。
- `ORDER BY customers DESC, city;` 先按客户数降序,同数再按城市名排。

</div>

实跑输出:

```text
city|customers|seats
上海|2|21
杭州|2|13
|1|5
北京|1|20
天津|1|9
成都|1|85
深圳|1|140
青岛|1|2
```

8 行:上海、杭州各 2 家。第三行城市是空的,那是 6 号禾丰农业(5 席),**NULL 被 `GROUP BY` 当成了一堆**,它自己成一组。所以第 2 步 `count(DISTINCT city)` 是 7(不数 NULL),这里分组是 8 堆。在「同数按城市名排」里,NULL 排在有值的前面(Day 85 说过,SQLite 里 NULL 最小)。

</details>

**练习 4:哪个月开的发票最多。** 按开票月份统计发票张数,只显示张数最多的那个月。

<details><summary>参考答案</summary>

```bash
sqlite3 -header practice.db "
SELECT substr(issued_at, 1, 7) AS month, count(*) AS n
FROM invoices
GROUP BY month
ORDER BY n DESC
LIMIT 1;"
```

<div class="line-notes">

- `SELECT substr(issued_at, 1, 7) AS month, count(*) AS n` 取 `YYYY-MM` 作为月份,数每个月的张数。
- `FROM invoices` 全部 15 张,不筛状态。
- `GROUP BY month` 按月分堆:7 月 1 张,8 月 5 张,9 月 8 张,10 月 1 张。
- `ORDER BY n DESC` 张数多的在前。
- `LIMIT 1;` 只取第一行,Day 85 的「前几名」。

</div>

实跑输出:

```text
month|n
2026-09|8
```

2026 年 9 月最多,8 张(4 张已付、1 张退款、3 张未付,第 3 步的两列分组里看到过)。如果有两个月并列最多,`LIMIT 1` 只会给其中一个,要看并列得另外处理。

</details>

**练习 5(观察题):抓重复开票。** 先查「同一个客户在同一天开了不止一张发票」的情况,应该是空的;然后手工往 `invoices` 里再插一张 1 号客户 2026-09-01 的发票,制造重复;重跑同一条查询,观察变化;最后重跑 `invoices.sql` 还原。

<details><summary>参考答案</summary>

```bash
sqlite3 -header practice.db "
SELECT customer_id, issued_at, count(*) AS n
FROM invoices
GROUP BY customer_id, issued_at
HAVING count(*) > 1;"
sqlite3 practice.db "INSERT INTO invoices (customer_id, amount, status, issued_at) VALUES (1, 1188, 'paid', '2026-09-01');"
sqlite3 -header practice.db "
SELECT customer_id, issued_at, count(*) AS n
FROM invoices
GROUP BY customer_id, issued_at
HAVING count(*) > 1;"
sqlite3 practice.db < invoices.sql
```

<div class="line-notes">

- `SELECT customer_id, issued_at, count(*) AS n` 客户、日期、这一对出现了几次。
- `GROUP BY customer_id, issued_at` 「同客户同一天」为一堆。
- `HAVING count(*) > 1;` 只留出现超过 1 次的堆,也就是重复。
- `sqlite3 practice.db "INSERT INTO invoices (customer_id, amount, status, issued_at) VALUES (1, 1188, 'paid', '2026-09-01');"` Day 86 的带列名 INSERT,故意制造一条重复(1 号客户 9 月 1 日已经有 3 号发票)。
- 第二次的 `SELECT ... HAVING count(*) > 1;` 同一条查询,一字未改。
- `sqlite3 practice.db < invoices.sql` 重建发票表,重复的那一张消失。

</div>

实跑输出(第一次查询没有任何输出,因为没有重复):

```text
customer_id|issued_at|n
1|2026-09-01|2
```

没造重复时结果是空的;插入之后出现 `1|2026-09-01|2`,说明 1 号客户 9 月 1 日有两张。这就是「`GROUP BY` + `HAVING count(*) > 1`」找重复数据的标准写法,后面做账单排查(Day 682)会再用到。

</details>

验收标准:五道题都在自己终端里跑通;能不看文章写出「按状态统计张数和金额」「每家客户的发票合计(含 0 张的)」「合计超过某个数的客户」三条查询;能解释「为什么 LEFT JOIN 之后要数 `count(i.id)` 而不是 `count(*)`」和「`WHERE` 与 `HAVING` 的区别」。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 聚合函数 | 吃进多行、吐出一个值的函数:`count`、`sum`、`avg`、`min`、`max` |
| `count(*)` | 数行数,不管列是不是 NULL |
| `count(列)` | 数这一列不是 NULL 的行数 |
| `DISTINCT` | 去重,`count(DISTINCT 列)` 数不同的非空值有几种 |
| `GROUP BY` | 按一列或几列的值把行分成若干堆,每堆各算一次聚合 |
| `HAVING` | 对分好的组、算好的聚合结果再筛,位置在 `GROUP BY` 之后 |
| `WHERE` 与 `HAVING` | `WHERE` 在分组之前筛行,不能写聚合函数;`HAVING` 在分组之后筛组 |
| `coalesce(a, b)` | `a` 不是 NULL 就取 `a`,否则取 `b`,常用来把聚合的 NULL 换成 0 |
| `substr(文本, 起点, 长度)` | 截取字符串的一段,`substr('2026-08-01', 1, 7)` 得到 `'2026-08'` |
| `round(数, 位数)` | 四舍五入到指定的小数位 |
| 整数相除 | 两个整数相除结果取整,`sum / count` 吞掉小数,先乘 `1.0` 或用 `avg` |
| `total()` | SQLite 专有的求和,空集返回 `0.0` 而不是 NULL |
| 裸列(bare column) | `SELECT` 里既不在 `GROUP BY` 里、也没被聚合包住的列,SQLite 允许、Postgres 报错 |
| 空集 | 一行都没筛出来的结果,`sum` 给 NULL,`count` 给 0 |

## 常见误区

**`LEFT JOIN` 之后用 `count(*)`。** 没发票的客户被数成 1 张(实测禾丰农业显示 1,total 是空)。数右表的主键,`count(i.id)`。

**把聚合函数写进 `WHERE`。** 报 `misuse of aggregate: sum()`(Postgres:`aggregate functions are not allowed in WHERE`)。筛合计、筛张数要用 `HAVING`。

**所有条件都堆进 `HAVING`。** 能在分组之前筛掉的行(比如 `status = 'paid'`)放 `WHERE`,少分堆、少算。

**忘了 `sum` 对空集是 NULL。** 前端拿到 `null` 变成 `NaN` 或空白。需要 0 就写 `coalesce(sum(x), 0)`。

**整数相除。** `sum(amount) / count(*)` 得到 6667,不是 6667.8。算平均值用 `avg`,或者乘 `1.0`。

**`SELECT` 里放不在分组里的列。** SQLite 不报错,随手给一行的值(实测 paid 堆给了 1188),Postgres 直接拒绝。要么放进 `GROUP BY`,要么套聚合函数。

**以为 `count(列)` 和 `count(*)` 一样。** 有 NULL 的列差一个数(实测邮箱 9,总行数 10)。统计「有邮箱的客户」要用前者,统计「有几行」用后者。

**忘了 NULL 也能成组。** `GROUP BY city` 会给没填城市的客户单独一堆,结果里有一行城市为空。

**用 JOIN 之后的行数当实体数。** 一对多 JOIN 后数行得不到客户数(16 不是 10),要数客户就 `count(DISTINCT c.id)` 或者先分组。

## 学习资料

### 文档与文章

- [SQLite 官方 · Aggregate Functions(英文)](https://sqlite.org/lang_aggfunc.html):`count`、`sum`、`total`、`avg` 等所有聚合函数的定义,`sum` 和 `total` 的区别写在这里。
- [SQLite 官方 · SELECT(英文)](https://sqlite.org/lang_select.html):`GROUP BY`、`HAVING` 在整条语句里的位置,锚点 `#bareagg` 是裸列的规则。
- [SQLite 官方 · Core Functions(英文)](https://sqlite.org/lang_corefunc.html):`substr`、`round`、`coalesce`、`typeof` 等普通函数一览。
- [SQLite 官方 · NULL Handling(英文)](https://sqlite.org/nulls.html):各数据库对 NULL 处理的差异,包括聚合时的行为。
- [SQLite 官方 · Quirks, Caveats, and Gotchas(英文)](https://sqlite.org/quirks.html):SQLite 的怪脾气清单,和今天「裸列」同类的坑能在这里找到。
- [菜鸟教程 · SQLite GROUP BY](https://www.runoob.com/sqlite/sqlite-group-by.html)和 [HAVING 子句](https://www.runoob.com/sqlite/sqlite-having-clause.html):中文,每页一个小例子,适合当速查。
- [SQLBolt · 第 10 课:Queries with aggregates (Pt. 1)](https://sqlbolt.com/lesson/select_queries_with_aggregates)和[第 11 课(Pt. 2)](https://sqlbolt.com/lesson/select_queries_with_aggregates_pt_2):浏览器里练聚合函数、GROUP BY、HAVING,带习题。
- [PostgreSQL 官方教程 · Aggregate Functions(英文)](https://www.postgresql.org/docs/current/tutorial-agg.html):用 Postgres 讲聚合,里面专门解释了为什么 `WHERE` 里不能用聚合,和今天第 6 步是同一件事。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1Tre8ziEek&autoplay=0&high_quality=1" title="SQL第4节｜Group By分组函数的用法" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>卡卡老师讲数据科学 · SQL 第 4 节 Group By 分组函数的用法 · 约 6 分钟,播放 2.2 万,2025 年发布。和 Day 87 看过的第 5 节是同一个系列,对应今天第 3、4 步。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1F34y147xV&autoplay=0&high_quality=1" title="【从0到1学SQL】SQL的复杂查询之group by和having用法" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>bili_1622637386 · 【从 0 到 1 学 SQL】SQL 的复杂查询之 group by 和 having 用法 · 约 3 分半钟,播放 1 万。短,专门讲 group by 和 having 怎么配合,看完对照第 6 步。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/dCNjUOc1cBY" title="Having vs Where in MySQL | Beginner MySQL Series" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Alex The Analyst · Having vs Where in MySQL · 英文,可开字幕。专门讲 WHERE 和 HAVING 的区别,用的是 MySQL,语法和今天的一致。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/x2_mOJ3skSc" title="SQL Group By: An Explanation and How To Use It" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Database Star · SQL Group By: An Explanation and How To Use It · 英文,可开字幕。从「为什么需要分组」讲起,配示意图。</figcaption>
</figure>

### 书籍

- Ben Forta,《SQL必知必会》(第 5 版),人民邮电出版社(原书 *Sams Teach Yourself SQL in 10 Minutes a Day*,5th ed.,2019)。第 9 课汇总数据、第 10 课分组数据,和今天一一对应。
- Alan Beaulieu,《Learning SQL》(第 3 版),O'Reilly,2020(英文)。有一章专门讲 Grouping and Aggregates,把 `WHERE` 与 `HAVING` 的执行顺序讲得很细。

### 开源项目与代码

今天这组不需要。想看分组聚合在真实的数据分析里怎么用,可以等做 Day 94 迷你账单库时回头对照。

## 自测

1. `count(*)`、`count(email)`、`count(DISTINCT city)` 对 `customers` 表分别返回多少?为什么不一样?

<details><summary>答案</summary>

10、9、7。`count(*)` 数行数,表有 10 行;`count(email)` 数 `email` 不是 NULL 的行,4 号没有邮箱所以是 9;`count(DISTINCT city)` 数不同的非空城市,6 号城市是 NULL 不算,剩下 7 个不同的城市。

</details>

2. 下面这句想列出所有客户和各自的发票张数,哪里不对?改成什么?`SELECT c.company, count(*) FROM customers c LEFT JOIN invoices i ON i.customer_id = c.id GROUP BY c.id, c.company;`

<details><summary>答案</summary>

没有发票的客户(禾丰农业、小满花店)在左连接后仍有一行(右边是 NULL),`count(*)` 数的是行,所以会显示 1 张,是错的。改成 `count(i.id)`:`i.id` 是 NULL 时不被数,得到 0。

</details>

3. 为什么 `WHERE sum(amount) > 3000 GROUP BY customer_id` 报错?应该怎么写?

<details><summary>答案</summary>

`WHERE` 在分组之前、对每一行单独判断,这时还没有「每个客户的合计」,所以聚合函数不能用在 `WHERE` 里(SQLite 报 `misuse of aggregate: sum()`,Postgres 报 `aggregate functions are not allowed in WHERE`)。要筛分好组之后的合计,写在 `GROUP BY customer_id` 之后的 `HAVING sum(amount) > 3000`。

</details>

4. 查未付发票的总额,恰好没有任何未付发票时,`SELECT sum(amount) FROM invoices WHERE status = 'unpaid'` 返回什么?前端拿到会怎样?怎么改才稳?

<details><summary>答案</summary>

返回 NULL(空集求和),不是 0。接口序列化后是 `null`,前端显示成空白或者 `NaN`。改成 `SELECT coalesce(sum(amount), 0) ...`,没有数据就得 0。

</details>

5. 面试题:一个「问数 Agent」把用户的问题翻译成 SQL,用户问「每个城市有多少客户」,模型写了 `SELECT city, name, count(*) FROM customers GROUP BY city`。这条 SQL 在 SQLite 和 Postgres 里分别会怎样?你会在系统里加什么防线?

<details><summary>答案</summary>

`name` 不在 `GROUP BY` 里也没有聚合包着。SQLite 不报错,每个城市随手给一个客户的名字,看起来像一个合理的结果,数据其实不对,而且没人会发现;Postgres 会直接报 `must appear in the GROUP BY clause or be used in an aggregate function`,模型可以看到错误自己修。所以防线是:在评测集里加这类「SELECT 里有非聚合裸列」的用例;执行前用 SQL 解析器(Day 292 会用 sqlglot)检查 SELECT 列是否都在 GROUP BY 或聚合里;在能选的时候让 Agent 查的库用 Postgres,或者统一在 SQLite 里只允许规范写法;返回结果时附带 SQL 本身,让人能复核。

</details>

## 明天预告

Day 89 · SQL(五):索引和 EXPLAIN。今天的 15 张发票,不管怎么查都是瞬间出结果,但真实账单表有几百万行,同样的 `WHERE customer_id = 5` 可能要几秒。明天会造一张十万行的大表,用 `EXPLAIN QUERY PLAN` 看数据库到底是怎么找数据的,再建一个索引,对比加索引前后的耗时,也看看索引为什么不是越多越好。
