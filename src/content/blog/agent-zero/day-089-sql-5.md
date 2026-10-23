---
title: 'Day 89 · SQL(五):索引和 EXPLAIN'
description: '15 张发票随便怎么查都是瞬间,真实账单表有几百万行。今天造一张十万行的大表,用 EXPLAIN QUERY PLAN 看数据库怎么找数据,建一个索引把 5 毫秒变成 0.06 毫秒,再认出索引没用上的写法、索引拖慢写入的代价和组合索引的最左前缀。'
pubDate: 2026-10-23
regime: none
tags: ['sql', 'sqlite', 'index', 'explain', 'database', 'agent-zero']
series: 'agent-zero'
day: 89
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 88](/blog/agent-zero/day-088-sql-4/) 学了聚合和分组:`count`、`sum`、`avg` 把多行压成一个值,`GROUP BY` 把行分成几堆各算一次,`WHERE` 在分堆前筛行、`HAVING` 在分堆后筛组。还踩了几个静悄悄的坑:`LEFT JOIN` 之后用 `count(*)` 会把没有发票的客户数成 1 张,`sum` 对空集返回 `NULL`,整数相除吞小数。

那一整天用的都是 15 张发票、10 家客户。每条查询都是瞬间出结果,你根本感觉不到数据库在「找」。真实的账单表不是这样:一家做了几年的 SaaS,发票表轻松过百万行,同一句 `WHERE customer_id = 5` 在小表上看不出差别,在大表上可能拖到几秒。今天补上这一块:数据库到底是怎么找一行数据的,以及**索引**(index)怎么让它少找很多。

## 今天要解决的问题

学完今天,你应该能做到:

1. 用 `EXPLAIN QUERY PLAN` 看一条查询的执行计划,认出 `SCAN`(从头到尾扫一遍)和 `SEARCH ... USING INDEX`(顺着索引直接定位)的区别。
2. 给一张十万行的表建索引,自己用计时量出加索引前后的差距,并说得清索引为什么快(它是一份排好序的「目录」)。
3. 认出几种「建了索引也用不上」的写法:对列套函数、`LIKE` 以通配符开头、`OR` 连两个列、区分度太低的列。
4. 说出索引的代价:占磁盘、拖慢写入;并会用「组合索引」和它的最左前缀规则。

今天两个新概念:**索引**(index)和**执行计划**(`EXPLAIN`)。组合索引是索引的一个变种,放在第 7 步。

预计用时:3 小时。花费 ¥0,不写 Python,只用终端(有一小段 Node 对照,可选)。

前置:[Day 85](/blog/agent-zero/day-085-sql-1/) 的 `CREATE TABLE`、`SELECT`、`WHERE`、`ORDER BY`;[Day 86](/blog/agent-zero/day-086-sql-2/) 的 `practice.db` 重建;[Day 87](/blog/agent-zero/day-087-sql-3/) 的 `JOIN`;[Day 88](/blog/agent-zero/day-088-sql-4/) 的 `count`、`sum`、`GROUP BY`。第 0 步造大表会用到一小段你没学过的 SQL(`WITH RECURSIVE`),把它当「造数据的配方」抄下来就行,不要求看懂。

学法:先对照文章逐行敲一遍(不复制粘贴)并跑通;第二天合上文章,默写「建索引」「看执行计划」「组合索引的最左前缀」三件事;做练习,做不出再展开参考答案,看完关掉自己重写一遍。

## 从前端看:索引就是你早就会用的 Map

前端里有个很熟的场景:一个有 10 万个对象的数组,要找 `customer_id === 1234` 的所有行。你会写 `rows.filter(...)`,它从头到尾每个元素看一遍。如果这个查询要执行很多次,你多半会先花一次功夫,按 `customer_id` 把数组归成一个 `Map`,之后每次直接 `map.get(1234)`。

数据库里的索引就是这个 `Map`,只是它存在磁盘上、按顺序排好、数据变了会自动更新。先在 Node 里把差距看一眼(这一段是对照用的,不做也行)。新建 `part01/sql/index_js_demo.mjs`:

```js
// agent-zero-lab/part01/sql/index_js_demo.mjs
const rows = [];
for (let x = 1; x <= 100000; x++) {
  rows.push({ id: x, customer_id: ((x * 7919) % 5000) + 1, amount: ((x * 37) % 5000) + 50 });
}

// 没有索引:每次查询都把 10 万行从头扫一遍
let t0 = performance.now();
let hit = 0;
for (let k = 0; k < 200; k++) {
  hit += rows.filter((r) => r.customer_id === 1234).length;
}
const scanMs = performance.now() - t0;

// 有索引:先花一次功夫,按 customer_id 把行归好堆
t0 = performance.now();
const byCustomer = new Map();
for (const r of rows) {
  const list = byCustomer.get(r.customer_id) ?? [];
  list.push(r);
  byCustomer.set(r.customer_id, list);
}
const buildMs = performance.now() - t0;

// 之后每次查询只是一次 Map 取值
t0 = performance.now();
let hit2 = 0;
for (let k = 0; k < 200; k++) {
  hit2 += (byCustomer.get(1234) ?? []).length;
}
const lookupMs = performance.now() - t0;

console.log(`扫描:200 次查询共 ${scanMs.toFixed(1)} ms,每次命中 ${hit / 200} 行`);
console.log(`建 Map:${buildMs.toFixed(1)} ms(只做一次)`);
console.log(`查 Map:200 次查询共 ${lookupMs.toFixed(3)} ms,每次命中 ${hit2 / 200} 行`);
```

<div class="line-notes">

- `rows.push({ id: x, customer_id:` 造 10 万行。`customer_id` 用一个固定公式算,x=1 时是 `7919 % 5000 + 1 = 2920`,x=2 时是 `15838 % 5000 + 1 = 839`。公式固定,每次跑数据都一样;5000 个客户各占 20 行,后面 SQL 里造的表用的是同一个公式。
- `hit += rows.filter((r) => r.customer_id === 1234).length;` 没有索引的查法:`filter` 把 10 万个元素逐个看一遍,只有 20 个符合。这个循环做 200 次,模拟「同一种查询被反复执行」。
- `const byCustomer = new Map();` 这就是「索引」:键是 `customer_id`,值是这个客户的所有行。
- `const list = byCustomer.get(r.customer_id) ?? [];` 这个客户第一次出现就开一个空数组。
- `hit2 += (byCustomer.get(1234) ?? []).length;` 有索引的查法:不再看那 10 万行,直接按键取。

</div>

在 `agent-zero-lab` 目录下运行 `node part01/sql/index_js_demo.mjs`,实跑输出(你的数字会不一样,多跑几次也有波动,看量级):

```text
扫描:200 次查询共 1040.0 ms,每次命中 20 行
建 Map:66.7 ms(只做一次)
查 Map:200 次查询共 0.043 ms,每次命中 20 行
```

200 次扫描用了约 1 秒,每次约 5 毫秒;建 Map 花了 67 毫秒,之后 200 次查询加起来不到 0.1 毫秒。**建索引是一次性的投入,之后每次查询都便宜。** 这也说明索引天然有两个代价:建的时候要花时间花空间,数据一变(新增、修改)还得同步改这个 Map。第 6 步会实测。

<figure>
<svg viewBox="0 0 640 270" role="img" aria-label="没有索引时数据库从第一行扫到最后一行,有索引时先在排好序的目录里定位到 customer_id 等于 1234 的位置,再回表取出对应的行">
<rect x="0" y="0" width="640" height="270" fill="var(--paper-raised)" rx="6"/>
<g font-family="var(--font-mono)" font-size="12">
<text x="20" y="24" fill="var(--ink)">没有索引:SCAN,逐行看</text>
<text x="350" y="24" fill="var(--ink)">有索引:SEARCH,先查目录</text>
<rect x="20" y="36" width="270" height="22" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="30" y="52" fill="var(--ink-soft)">id=1   customer_id=2920</text>
<rect x="20" y="60" width="270" height="22" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="30" y="76" fill="var(--ink-soft)">id=2   customer_id=839</text>
<rect x="20" y="84" width="270" height="22" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="30" y="100" fill="var(--ink-soft)">id=3   customer_id=3758</text>
<text x="30" y="124" fill="var(--ink-faint)">…… 一直看到第 100000 行</text>
<rect x="20" y="136" width="270" height="22" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="30" y="152" fill="var(--ink)">id=3207 customer_id=1234 命中</text>
<text x="20" y="190" fill="var(--ink)">读 757 个数据页(实测,第 3 步)</text>
<rect x="350" y="36" width="270" height="22" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="360" y="52" fill="var(--ink)">目录根页:1234 在哪一段?</text>
<rect x="350" y="72" width="270" height="22" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="360" y="88" fill="var(--ink)">目录叶页:1234 → 20 个行号</text>
<line x1="485" y1="58" x2="485" y2="72" stroke="var(--rule)"/>
<rect x="350" y="116" width="270" height="22" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="360" y="132" fill="var(--ink)">按行号去表里取这 20 行</text>
<line x1="485" y1="94" x2="485" y2="116" stroke="var(--rule)"/>
<text x="350" y="170" fill="var(--ink)">读 2 个目录页 + 取 20 行</text>
<text x="20" y="232" fill="var(--ink-soft)">目录是按 customer_id 排好序的,所以能像查字典一样一步步缩小范围。</text>
<text x="20" y="252" fill="var(--ink-faint)" font-size="11">页数来自 dbstat 实测(第 3 步),图里的 id 来自第 0 步造的表。</text>
</g>
</svg>
<figcaption>左边是 SCAN:从第一行读到最后一行。右边是 SEARCH:先在排好序的目录(蓝色)里定位,再按行号回表取行(琥珀色)。</figcaption>
</figure>

## 第 0 步:造一张十万行的表

`practice.db` 里的 15 张发票太少,看不出差别。我们另造一个库 `big.db`,里面放 10 万张发票,结构和 `invoices` 一模一样,只是表名叫 `big_invoices`。新建 `part01/sql/make_big.sql`:

```sql
-- agent-zero-lab/part01/sql/make_big.sql
DROP TABLE IF EXISTS big_invoices;

CREATE TABLE big_invoices (
    id           INTEGER PRIMARY KEY,
    customer_id  INTEGER NOT NULL,
    amount       INTEGER NOT NULL,
    status       TEXT    NOT NULL,
    issued_at    TEXT    NOT NULL
);

WITH RECURSIVE n(x) AS (
    SELECT 1
    UNION ALL
    SELECT x + 1 FROM n WHERE x < @rows
)
INSERT INTO big_invoices (customer_id, amount, status, issued_at)
SELECT (x * 7919) % 5000 + 1,
       (x * 37) % 5000 + 50,
       CASE WHEN x % 10 < 7 THEN 'paid' WHEN x % 10 < 9 THEN 'unpaid' ELSE 'refunded' END,
       date('2026-01-01', '+' || (x % 300) || ' days')
FROM n;
```

<div class="line-notes">

- `DROP TABLE IF EXISTS big_invoices;` 和 Day 85 的习惯一样:表已经存在就先删掉,脚本能反复跑。
- `CREATE TABLE big_invoices (` 五列和 Day 87 的 `invoices` 完全相同。`id INTEGER PRIMARY KEY` 是主键,SQLite 让它直接充当行号(叫 rowid),记住这一点,第 4 步要用。
- `WITH RECURSIVE n(x) AS (` 一个「造数字」的配方,**不要求你现在看懂**。意思是:先有一行 `x = 1`,再不断用上一行造出下一行 `x + 1`,直到 `x` 达到 `@rows`,得到 1、2、3……这些数字,当成一张临时的数字表 `n`。
- `SELECT x + 1 FROM n WHERE x < @rows` `@rows` 是一个**参数**,运行时由命令行 `.parameter set @rows 100000` 传进来,所以同一个文件既能造 10 万行,也能造 100 万行。
- `INSERT INTO big_invoices (customer_id, amount, status, issued_at)` 带列名的 INSERT(Day 86),`id` 不写,让 SQLite 自己分配 1、2、3……
- `SELECT (x * 7919) % 5000 + 1,` 客户编号,和上面 Node 里是同一个公式:x 从 1 到 100000,编号落在 1 到 5000,每个客户恰好 20 行。
- `(x * 37) % 5000 + 50,` 金额,50 到 5049 之间。
- `CASE WHEN x % 10 < 7 THEN 'paid'` `x % 10` 是 x 除以 10 的余数,0 到 6 是已付(70%),7、8 是未付(20%),9 是已退款(10%)。这个比例留着,第 5 步要用。
- `date('2026-01-01', '+' || (x % 300) || ' days')` 从 2026-01-01 起往后加 0 到 299 天,`||` 是 SQLite 的字符串拼接。x=1 时是 `'+1 days'`,所以第一行是 2026-01-02。
- `FROM n;` 数据来自那张临时数字表,10 万个 x 就插入 10 万行。

</div>

造库并确认数据。目录是 `part01/sql`:

```bash
cd /Users/你/agent-zero-lab/part01/sql
rm -f big.db
sqlite3 big.db ".parameter set @rows 100000" ".read make_big.sql"
sqlite3 -header big.db "SELECT count(*) AS n, count(DISTINCT customer_id) AS customers, min(amount), max(amount), min(issued_at), max(issued_at) FROM big_invoices;"
sqlite3 -header big.db "SELECT * FROM big_invoices LIMIT 5;"
sqlite3 -header big.db "SELECT status, count(*) AS n FROM big_invoices GROUP BY status;"
ls -l big.db | awk '{print $5, $9}'
```

<div class="line-notes">

- `cd /Users/你/agent-zero-lab/part01/sql` 进入放 SQL 文件的目录。
- `rm -f big.db` 删掉旧库,`-f` 让文件不存在时不报错。
- `sqlite3 big.db ".parameter set @rows 100000" ".read make_big.sql"` `sqlite3` 可以一次接好几条点命令:先设参数 `@rows` 为 100000,再 `.read` 执行文件。`big.db` 不存在会自动新建。
- `count(DISTINCT customer_id) AS customers` Day 88 学的「数不同的值」,验证 5000 个客户。
- `GROUP BY status` Day 88 的分组,验证 70/20/10 的比例。
- `ls -l big.db | awk '{print $5, $9}'` `ls -l` 的第 5 列是文件字节数,第 9 列是文件名。只取这两列,是为了不把文件属主打印出来。

</div>

实跑输出:

```text
n|customers|min(amount)|max(amount)|min(issued_at)|max(issued_at)
100000|5000|50|5049|2026-01-01|2026-10-27
id|customer_id|amount|status|issued_at
1|2920|87|paid|2026-01-02
2|839|124|paid|2026-01-03
3|3758|161|paid|2026-01-04
4|1677|198|paid|2026-01-05
5|4596|235|paid|2026-01-06
status|count(*)
paid|70000
refunded|10000
unpaid|20000
3104768 big.db
```

10 万行、5000 个客户;第 1 行 `customer_id` 是 2920,和前面 Node 里算的一样;已付、未付、退款分别 7 万、2 万、1 万。文件 3104768 字节,约 3 MB。(日期最大到 10 月 27 日,是因为公式最多往后加 299 天,不用管它。)

## 第 1 步:没有索引,数据库只能从头扫

查客户 1234 的发票张数和金额,开计时(`.timer on` 会在每条语句后打印耗时):

```bash
sqlite3 big.db <<'EOF'
.timer on
.mode list
SELECT count(*), sum(amount) FROM big_invoices WHERE customer_id = 1234;
SELECT count(*), sum(amount) FROM big_invoices WHERE customer_id = 1234;
SELECT count(*), sum(amount) FROM big_invoices WHERE customer_id = 1234;
EOF
```

<div class="line-notes">

- `sqlite3 big.db <<'EOF'` 这是 shell 的「here-document」写法:从这一行到单独一行的 `EOF` 之间的内容,原样当作键盘输入喂给 `sqlite3`。好处是可以连着敲很多条命令。
- `.timer on` sqlite3 的点命令,之后每条 SQL 执行完都会打印一行 `Run Time: real ... user ... sys ...`。`real` 是墙上时钟时间,只精确到毫秒;`user` 是 CPU 花在这条查询上的时间,精确到微秒,**下面比较时看 `user`**。
- `.mode list` 输出格式回到默认的竖线分隔。
- `SELECT count(*), sum(amount) FROM big_invoices WHERE customer_id = 1234;` 同一条查询连跑三次,是因为第一次可能要从磁盘读,后两次文件已经在操作系统缓存里,数字更稳。

</div>

```text
20|74180
Run Time: real 0.008 user 0.005725 sys 0.002428
20|74180
Run Time: real 0.005 user 0.005036 sys 0.000107
20|74180
Run Time: real 0.006 user 0.005083 sys 0.000092
```

客户 1234 有 20 张发票,合计 74180 元;每次约 5 毫秒(`user 0.005` 秒)。5 毫秒不算慢,但注意这是 10 万行、一个人一次查询。行数涨 10 倍,或者每秒来几百个这样的查询,就不是这个数了(第 2 步会量)。

数据库为什么用了 5 毫秒?让它自己说。在查询前面加 `EXPLAIN QUERY PLAN`,数据库不执行,而是告诉你它**打算怎么执行**:

```bash
sqlite3 big.db "EXPLAIN QUERY PLAN SELECT count(*), sum(amount) FROM big_invoices WHERE customer_id = 1234;"
```

<div class="line-notes">

- `EXPLAIN QUERY PLAN SELECT count(*), sum(amount) FROM big_invoices WHERE customer_id = 1234;` 前缀 `EXPLAIN QUERY PLAN` 是今天的第二个新概念:不跑查询,只返回「执行计划」。后面的 SELECT 就是上一条,一个字没改。

</div>

```text
QUERY PLAN
`--SCAN big_invoices
```

`SCAN big_invoices`:**扫描整张表**,从第 1 行一直读到第 100000 行,每行检查 `customer_id` 是不是 1234。找到 20 行也得读完全部 10 万行,因为它没法提前知道后面还有没有。这就是前面 Node 里的 `rows.filter`。

怎么读执行计划:每一行是一个步骤,最常见的两个词是 `SCAN`(扫整张表或整个索引)和 `SEARCH`(利用索引或主键直接定位)。看到大表上出现 `SCAN`,就要问一句:这条查询能不能避免?

## 第 2 步:建索引,再查一次

给 `customer_id` 建一个索引。语法是 `CREATE INDEX 索引名 ON 表名 (列名)`:

```bash
sqlite3 big.db <<'EOF'
.timer on
.mode list
CREATE INDEX idx_big_customer ON big_invoices (customer_id);
EXPLAIN QUERY PLAN SELECT count(*), sum(amount) FROM big_invoices WHERE customer_id = 1234;
SELECT count(*), sum(amount) FROM big_invoices WHERE customer_id = 1234;
SELECT count(*), sum(amount) FROM big_invoices WHERE customer_id = 1234;
SELECT count(*), sum(amount) FROM big_invoices WHERE customer_id = 1234;
EOF
ls -l big.db | awk '{print $5, $9}'
```

<div class="line-notes">

- `CREATE INDEX idx_big_customer ON big_invoices (customer_id);` 在 `big_invoices` 表的 `customer_id` 列上建一个索引,名字叫 `idx_big_customer`。命名习惯 `idx_表_列`,以后一眼知道它是哪个表哪一列的。建的时候数据库把 10 万行的 `customer_id` 读一遍、排好序,存成另一份东西。
- `EXPLAIN QUERY PLAN SELECT count(*), sum(amount)` 同一条查询再问一次计划,看有什么变化。
- `ls -l big.db | awk '{print $5, $9}'` 看文件大小,索引是要占空间的。

</div>

```text
Run Time: real 0.045 user 0.038585 sys 0.004189
QUERY PLAN
`--SEARCH big_invoices USING INDEX idx_big_customer (customer_id=?)
20|74180
Run Time: real 0.000 user 0.000105 sys 0.000062
20|74180
Run Time: real 0.001 user 0.000059 sys 0.000038
20|74180
Run Time: real 0.000 user 0.000055 sys 0.000036
4177920 big.db
```

三次 `SELECT` 和第 1 步完全相同,一个字没改。**索引不改变你写的 SQL**,只改变数据库执行它的方式。对比:

| | 计划 | 一次查询的 CPU 时间(`user`) |
| --- | --- | --- |
| 没有索引 | `SCAN big_invoices` | 约 0.0050 秒(5 毫秒) |
| 有索引 | `SEARCH ... USING INDEX idx_big_customer (customer_id=?)` | 约 0.00006 秒(0.06 毫秒) |

结果还是 `20|74180`,**答案没变,只是快了接近 100 倍**。建索引那一次花了 0.039 秒,文件从 3104768 字节涨到 4177920,多了约 1 MB,这就是索引占的空间。计划里 `customer_id=?` 的意思是:用索引按 `customer_id` 的等值条件去找(问号代表你写的那个具体值 1234)。

再看数据量翻 10 倍会怎样。把表改造成 100 万行(同样的公式,每个客户变成 200 行),在建索引前后各量一次:

```bash
rm -f big1m.db
sqlite3 big1m.db ".parameter set @rows 1000000" ".read make_big.sql"
sqlite3 big1m.db <<'EOF'
.timer on
.mode list
SELECT count(*), sum(amount) FROM big_invoices WHERE customer_id = 1234;
SELECT count(*), sum(amount) FROM big_invoices WHERE customer_id = 1234;
CREATE INDEX idx_big_customer ON big_invoices (customer_id);
SELECT count(*), sum(amount) FROM big_invoices WHERE customer_id = 1234;
SELECT count(*), sum(amount) FROM big_invoices WHERE customer_id = 1234;
EOF
ls -l big1m.db | awk '{print $5, $9}'
```

<div class="line-notes">

- `rm -f big1m.db` 另用一个文件,不动前面的 `big.db`。
- `sqlite3 big1m.db ".parameter set @rows 1000000" ".read make_big.sql"` 同一个造数据文件,参数改成一百万,大约要一两秒。
- `CREATE INDEX idx_big_customer ON big_invoices (customer_id);` 前面两条 `SELECT` 没有索引,这一句之后的两条有索引。
- `ls -l big1m.db | awk '{print $5, $9}'` 这个库没建索引时的大小我没量,只看建完索引后的大小。

</div>

```text
200|741800
Run Time: real 0.066 user 0.050426 sys 0.013970
200|741800
Run Time: real 0.067 user 0.051644 sys 0.012501
Run Time: real 0.807 user 0.533699 sys 0.165941
200|741800
Run Time: real 0.001 user 0.000453 sys 0.000399
200|741800
Run Time: real 0.000 user 0.000200 sys 0.000026
42131456 big1m.db
```

数据变成 10 倍,没有索引的查询从约 5 毫秒变成约 50 毫秒,也涨了 10 倍:扫描的工作量和行数成正比。有索引的查询只要 0.2 到 0.45 毫秒,比 10 万行时略慢,是因为每个客户现在有 200 行要取回来,而不是 20 行。建索引本身用了 0.53 秒,整个库 42 MB(造完没索引时是 31 MB,我另外量过,索引占了 11 MB 左右)。

## 第 3 步:索引到底是什么,为什么快

索引是**另一份排好序的数据**:每一条是「列的值 + 对应行的行号」,整体按列的值排序。`idx_big_customer` 里,10 万条记录按 `customer_id` 从小到大排,1 号客户的 20 条挨在一起,2 号客户的 20 条挨在一起……要找 1234 号,就像在字典里按拼音查字:翻到中间,发现太小就往后翻,太大就往前翻,几步就缩小到一小段,而不是从第一页一页页看。

数据库里这份排序数据通常存成 **B 树**(B-tree)的形状:很多条记录装进一页(SQLite 默认一页 4096 字节),上一层的页记录「某个值以下的在哪一页」,层层往下指。因为一页能装几百条,所以即使十万、百万条,树也只有两三层。SQLite 有一张内部虚拟表 `dbstat`,可以直接查每个对象占了多少页、树有几层:

```bash
sqlite3 big.db <<'EOF'
PRAGMA page_size;
SELECT name, pagetype, count(*) AS pages FROM dbstat GROUP BY name, pagetype ORDER BY name, pagetype;
SELECT name, max(length(path)) / 4 AS levels FROM dbstat GROUP BY name;
EOF
```

<div class="line-notes">

- `PRAGMA page_size;` `PRAGMA` 是 SQLite 查看和设置内部参数的语句,这里问「一页多少字节」。
- `SELECT name, pagetype, count(*) AS pages FROM dbstat GROUP BY name, pagetype` `dbstat` 每一行是一页。`name` 是这一页属于哪张表或哪个索引,`pagetype` 是 `leaf`(叶子页,真正存数据)还是 `internal`(内部页,只存「指路」信息)。按这两列分组数页数,用的是 Day 88 的 `GROUP BY`。
- `max(length(path)) / 4 AS levels` `path` 是这一页在树里的路径,形如 `/001/18e/`,每往下一层多 4 个字符(`/` 加 3 位十六进制)。路径最长的那一页有多深,根页下面就有几层。粗略但够用。

</div>

```text
4096
big_invoices|internal|3
big_invoices|leaf|754
idx_big_customer|internal|1
idx_big_customer|leaf|261
sqlite_schema|leaf|1
big_invoices|2
idx_big_customer|1
sqlite_schema|0
```

(这是第 2 步建好索引的 `big.db`。)表本身有 757 页(754 个叶子页,3 个内部页),根页下面还有 2 层;索引有 262 页(1 个根页加 261 个叶子页),根页下面只有 1 层,也就是两层。**查客户 1234:先读索引的根页,它告诉你 1234 在第几个叶子页;再读那个叶子页,里面有 20 个行号;然后按每个行号去表里取一行(表本身也是一棵按 id 排的树,几页就到)。** 总共读不到 100 页。没有索引时,SCAN 要把 757 页全读一遍。这就是前面那张图。

用 SQLite 自带的命令可以看到有哪些索引、每个索引覆盖哪些列:

```bash
sqlite3 -header big.db <<'EOF'
.indexes
PRAGMA index_list(big_invoices);
PRAGMA index_info(idx_big_customer);
SELECT type, name, tbl_name FROM sqlite_master;
EOF
```

<div class="line-notes">

- `.indexes` 点命令,列出所有索引的名字。
- `PRAGMA index_list(big_invoices);` 这张表上的所有索引:`unique` 是不是唯一索引(Day 91 讲),`origin` 里的 `c` 表示是你用 `CREATE INDEX` 建的。
- `PRAGMA index_info(idx_big_customer);` 这个索引里有哪些列,`cid` 是列在表里的序号:`customer_id` 是第 2 列,序号从 0 数起所以是 1。
- `SELECT type, name, tbl_name FROM sqlite_master;` `sqlite_master` 是 SQLite 的「目录表」,所有表、索引的定义都在这里,Day 85 用 `.schema` 看到的就是它的内容。

</div>

```text
idx_big_customer
seq|name|unique|origin|partial
0|idx_big_customer|0|c|0
seqno|cid|name
0|1|customer_id
type|name|tbl_name
table|big_invoices|big_invoices
index|idx_big_customer|big_invoices
```

索引和表一样,是数据库里一个独立的对象,在 `sqlite_master` 里占一行。查询时用不用它,**由数据库自己的「查询优化器」决定**,你写的 SQL 里不需要指明「请用 idx_big_customer」。优化器会看你的 `WHERE`、手头有哪些索引,挑它认为最省事的办法,`EXPLAIN QUERY PLAN` 就是让你看它的选择。

## 第 4 步:主键自带索引,JOIN 也靠它

回到 `practice.db` 的小表。每张表的 `id INTEGER PRIMARY KEY` 其实已经是一个「索引」了:SQLite 把整张表按这个 id 排成一棵树,按 id 找一行非常快。先重建小库,再让它解释四条查询:

```bash
rm -f practice.db
sqlite3 practice.db < customers.sql
sqlite3 practice.db < invoices.sql
sqlite3 practice.db <<'EOF'
EXPLAIN QUERY PLAN SELECT * FROM invoices WHERE id = 5;
EXPLAIN QUERY PLAN SELECT * FROM invoices WHERE customer_id = 5;
EXPLAIN QUERY PLAN SELECT c.company, i.amount FROM customers c JOIN invoices i ON i.customer_id = c.id;
EXPLAIN QUERY PLAN SELECT c.company, i.amount FROM invoices i JOIN customers c ON c.id = i.customer_id;
EOF
```

<div class="line-notes">

- `sqlite3 practice.db < customers.sql` Day 86 起每次练习前的老动作,重建客户表,接着 `invoices.sql` 重建发票表。
- `WHERE id = 5;` 按主键查。
- `WHERE customer_id = 5;` 按一个没建索引的普通列查。
- `FROM customers c JOIN invoices i ON i.customer_id = c.id;` Day 87 的内连接,客户在前、发票在后。
- `FROM invoices i JOIN customers c ON c.id = i.customer_id;` 同一个 JOIN,把两张表的顺序写反。

</div>

```text
QUERY PLAN
`--SEARCH invoices USING INTEGER PRIMARY KEY (rowid=?)
QUERY PLAN
`--SCAN invoices
QUERY PLAN
|--SCAN i
`--SEARCH c USING INTEGER PRIMARY KEY (rowid=?)
QUERY PLAN
|--SCAN i
`--SEARCH c USING INTEGER PRIMARY KEY (rowid=?)
```

前两条:按 `id` 找是 `SEARCH ... USING INTEGER PRIMARY KEY (rowid=?)`,主键就是行号,直接定位;按 `customer_id` 找是 `SCAN invoices`,没建索引只能扫。

后两条是同一个 JOIN 的两种写法,**计划一模一样**:`SCAN i` 然后 `SEARCH c`。你先写的是 `FROM customers c JOIN invoices i`,数据库却选了先扫发票表 `i`(外层循环),对每一张发票,去客户表里按主键 `SEARCH c`。理由很实在:发票的 `customer_id` 没索引,客户的 `id` 是主键,按主键找很便宜,所以让「有索引的那张表」当内层。**优化器会重排 JOIN 的顺序,你写在前面的表不一定先被处理。** 这也解释了一个常识:外键列(这里是 `invoices.customer_id`)经常要建索引,它是 JOIN 和「按客户查发票」的入口。

把这条 JOIN 放到大表上看效果。`join.db` 里有 10 万行的 `big_invoices` 和 10 行的 `customers`,统计每家客户的发票:

```bash
rm -f join.db
sqlite3 join.db ".parameter set @rows 100000" ".read make_big.sql"
sqlite3 join.db < customers.sql
sqlite3 join.db <<'EOF'
.timer on
.mode list
EXPLAIN QUERY PLAN SELECT c.company, count(*), sum(i.amount) FROM customers c JOIN big_invoices i ON i.customer_id = c.id GROUP BY c.id;
SELECT c.company, count(*), sum(i.amount) FROM customers c JOIN big_invoices i ON i.customer_id = c.id GROUP BY c.id;
CREATE INDEX idx_big_customer ON big_invoices (customer_id);
EXPLAIN QUERY PLAN SELECT c.company, count(*), sum(i.amount) FROM customers c JOIN big_invoices i ON i.customer_id = c.id GROUP BY c.id;
SELECT c.company, count(*), sum(i.amount) FROM customers c JOIN big_invoices i ON i.customer_id = c.id GROUP BY c.id;
EOF
```

<div class="line-notes">

- `sqlite3 join.db < customers.sql` 把 10 家客户也放进这个库,客户 id 是 1 到 10;大表里的 `customer_id` 有 5000 个,只有 1 到 10 号对得上。
- `EXPLAIN QUERY PLAN SELECT c.company, count(*), sum(i.amount)` 第一次:没建索引时的计划。
- `GROUP BY c.id;` Day 88 的分组,每家客户一行。
- `CREATE INDEX idx_big_customer ON big_invoices (customer_id);` 现在给 JOIN 的入口列建索引。
- `EXPLAIN QUERY PLAN SELECT c.company, count(*), sum(i.amount)` 第二次:同样的查询,建完索引再问一遍,下面紧跟着再跑一次真查询。

</div>

```text
QUERY PLAN
|--SCAN i
|--SEARCH c USING INTEGER PRIMARY KEY (rowid=?)
`--USE TEMP B-TREE FOR GROUP BY
Run Time: real 0.000 user 0.000208 sys 0.000131
星河餐饮|20|1000
青木设计|20|83460
远山物流|20|65920
蓝鲸教育|20|48380
启明科技|20|30840
禾丰农业|20|13300
半岛咖啡|20|95760
云杉律所|20|78220
北辰贸易|20|60680
小满花店|20|43140
Run Time: real 0.011 user 0.008488 sys 0.002169
Run Time: real 0.045 user 0.036716 sys 0.006378
QUERY PLAN
|--SCAN c
`--SEARCH i USING INDEX idx_big_customer (customer_id=?)
Run Time: real 0.000 user 0.000058 sys 0.000019
星河餐饮|20|1000
青木设计|20|83460
远山物流|20|65920
蓝鲸教育|20|48380
启明科技|20|30840
禾丰农业|20|13300
半岛咖啡|20|95760
云杉律所|20|78220
北辰贸易|20|60680
小满花店|20|43140
Run Time: real 0.000 user 0.000347 sys 0.000107
```

建索引前,数据库只能把 10 万行发票全扫一遍(`SCAN i`),每张去客户表查一下,最后用临时的树做分组,约 8.5 毫秒。建索引后,计划**整个翻了过来**:外层变成只有 10 行的 `SCAN c`,内层对每家客户用 `SEARCH i USING INDEX` 直接取走它那 20 张发票,没有临时分组了,约 0.35 毫秒。同一个 JOIN,索引让优化器换了一种完全不同的做法,结果一模一样。

顺便认一下 `USE TEMP B-TREE FOR GROUP BY`(用临时树做分组)。后面还会见到 `USE TEMP B-TREE FOR ORDER BY`(用临时树排序),是同一类信号:数据库手里没有现成排好序的东西,得临时排一遍。

## 第 5 步:建了索引也用不上的几种写法

最容易让新手失望的情况是:明明建了索引,查询还是慢,`EXPLAIN` 里还是 `SCAN`。先给 `big_invoices` 的日期和状态也建上索引,再逐个试(回到第 2 步的 `big.db`,它已经有 `idx_big_customer`):

```bash
sqlite3 big.db <<'EOF'
CREATE INDEX idx_big_issued ON big_invoices (issued_at);
CREATE INDEX idx_big_status ON big_invoices (status);
.timer on
.mode list
.print --- A 等值
EXPLAIN QUERY PLAN SELECT count(*), sum(amount) FROM big_invoices WHERE issued_at = '2026-03-15';
SELECT count(*), sum(amount) FROM big_invoices WHERE issued_at = '2026-03-15';
.print --- B 范围
EXPLAIN QUERY PLAN SELECT count(*), sum(amount) FROM big_invoices WHERE issued_at >= '2026-03-01' AND issued_at < '2026-04-01';
SELECT count(*), sum(amount) FROM big_invoices WHERE issued_at >= '2026-03-01' AND issued_at < '2026-04-01';
.print --- C 函数包住列
EXPLAIN QUERY PLAN SELECT count(*), sum(amount) FROM big_invoices WHERE substr(issued_at,1,7) = '2026-03';
SELECT count(*), sum(amount) FROM big_invoices WHERE substr(issued_at,1,7) = '2026-03';
EOF
```

<div class="line-notes">

- `CREATE INDEX idx_big_issued ON big_invoices (issued_at);` 日期列的索引。日期是 `'2026-03-15'` 这样的文本,按文本排序刚好等于按时间排序(Day 85)。
- `CREATE INDEX idx_big_status ON big_invoices (status);` 状态列的索引,等会儿的 H 项要用。
- `.print --- A 等值` `.print` 往输出里打印一行字,当小标题。
- `WHERE issued_at = '2026-03-15'` 等值查询,3 月 15 日当天的发票。
- `WHERE issued_at >= '2026-03-01' AND issued_at < '2026-04-01'` **范围查询**,3 月整月。索引是排好序的,所以「从某个值开始往后读到某个值」也能用。
- `WHERE substr(issued_at,1,7) = '2026-03'` 表达同样的意思(3 月整月),但把列放进了 `substr()` 函数里。

</div>

```text
--- A 等值
QUERY PLAN
`--SEARCH big_invoices USING INDEX idx_big_issued (issued_at=?)
Run Time: real 0.001 user 0.000220 sys 0.000143
334|840934
Run Time: real 0.002 user 0.000910 sys 0.001096
--- B 范围
QUERY PLAN
`--SEARCH big_invoices USING INDEX idx_big_issued (issued_at>? AND issued_at<?)
Run Time: real 0.000 user 0.000042 sys 0.000004
10354|26472052
Run Time: real 0.007 user 0.006468 sys 0.000578
--- C 函数包住列
QUERY PLAN
`--SCAN big_invoices
Run Time: real 0.000 user 0.000044 sys 0.000008
10354|26472052
Run Time: real 0.015 user 0.012634 sys 0.001453
```

A、B 都用上了索引。**B 和 C 查的是同一批 10354 行,结果也相同(`10354|26472052`),但 C 是 `SCAN`**,耗时 12.6 毫秒,约是 B 的两倍。原因:索引里存的是 `issued_at` 本身的值,按它排序;`substr(issued_at,1,7)` 是另一个值,索引里没有按它排好的数据,数据库只能把每一行都取出来、套一遍函数再比较。**规矩:把列单独放在比较的一边,不要用函数、运算包住它;条件要变形,就把变形做到另一边的常量上**(B 就是把「3 月」写成了「大于等于 3 月 1 日、小于 4 月 1 日」)。

也留意一下,B 只比 C 快一倍,A 却比扫描快几十倍:B 要命中 10% 的行,每一行都要回表取一次,这部分工作量也不小。**索引最擅长的是「只命中很少几行」。**

再看另外几种写法:

```bash
sqlite3 big.db <<'EOF'
.timer on
.mode list
.print --- D LIKE 前缀
EXPLAIN QUERY PLAN SELECT count(*), sum(amount) FROM big_invoices WHERE issued_at LIKE '2026-03%';
SELECT count(*), sum(amount) FROM big_invoices WHERE issued_at LIKE '2026-03%';
.print --- E LIKE 开头通配
EXPLAIN QUERY PLAN SELECT count(*), sum(amount) FROM big_invoices WHERE issued_at LIKE '%-03-15';
SELECT count(*), sum(amount) FROM big_invoices WHERE issued_at LIKE '%-03-15';
.print --- F 对列做运算
EXPLAIN QUERY PLAN SELECT count(*), sum(amount) FROM big_invoices WHERE customer_id + 0 = 1234;
SELECT count(*), sum(amount) FROM big_invoices WHERE customer_id + 0 = 1234;
.print --- G OR 连两个不同的列
EXPLAIN QUERY PLAN SELECT count(*), sum(amount) FROM big_invoices WHERE customer_id = 1234 OR amount = 100;
SELECT count(*), sum(amount) FROM big_invoices WHERE customer_id = 1234 OR amount = 100;
EOF
```

<div class="line-notes">

- `WHERE issued_at LIKE '2026-03%';` D:`LIKE` 的模式不以通配符开头,看上去应该能用索引。
- `WHERE issued_at LIKE '%-03-15';` E:模式以 `%` 开头,「前面是什么都行」。
- `WHERE customer_id + 0 = 1234;` F:`customer_id + 0` 值没变,但数据库看到的是一个表达式,不是裸列。
- `WHERE customer_id = 1234 OR amount = 100;` G:`OR` 连着两个不同的列,`customer_id` 有索引,`amount` 没有。

</div>

```text
--- D LIKE 前缀
QUERY PLAN
`--SCAN big_invoices
Run Time: real 0.000 user 0.000049 sys 0.000012
10354|26472052
Run Time: real 0.011 user 0.010837 sys 0.000202
--- E LIKE 开头通配
QUERY PLAN
`--SCAN big_invoices
Run Time: real 0.000 user 0.000038 sys 0.000001
334|840934
Run Time: real 0.015 user 0.014198 sys 0.000284
--- F 对列做运算
QUERY PLAN
`--SCAN big_invoices
Run Time: real 0.000 user 0.000040 sys 0.000005
20|74180
Run Time: real 0.007 user 0.006310 sys 0.000080
--- G OR 连两个不同的列
QUERY PLAN
`--SCAN big_invoices
Run Time: real 0.000 user 0.000036 sys 0.000000
40|76180
Run Time: real 0.009 user 0.008419 sys 0.000311
```

四条全是 `SCAN`。

- **D**:模式不带前导通配符,我第一次也以为能走索引,结果不行。SQLite 里 `LIKE` 默认不区分大小写,而这个索引是按区分大小写的方式排的,两边对不上,优化器不敢用。[SQLite 官方的优化说明](https://sqlite.org/optoverview.html)列了条件:模式必须是不以通配符开头的字符串,并且要么打开 `case_sensitive_like`,要么给列建 `NOCASE` 排序规则的索引。**初学阶段的建议:查日期范围就老老实实写 `>=` 和 `<`,别用 LIKE。**
- **E**:模式以 `%` 开头,索引完全帮不上忙。索引是按开头的字符排序的,「结尾是 -03-15」的行在里面散落各处。任何数据库都一样。
- **F**:`customer_id + 0` 把裸列变成了表达式。没人会真写 `+ 0`,但 `WHERE amount * 1.13 > 1000`、`WHERE lower(email) = ...` 是同一类问题,办法是把运算挪到常量那边:`amount > 1000 / 1.13`。(SQLite 官方文档甚至把「在列名前加一个一元加号 `+customer_id`」列为故意让某个条件不使用索引的办法。)
- **G**:`OR` 的两边只有一边有索引,另一边 `amount = 100` 无论如何要扫全表,既然要扫,就一次扫完。给 `amount` 也建一个索引,优化器才可能两边各走索引再合并。

还有最后一个坑,**区分度太低的列**:

```bash
sqlite3 big.db <<'EOF'
.timer on
.mode list
.print --- H 70% 的行都是 paid
EXPLAIN QUERY PLAN SELECT count(*), sum(amount) FROM big_invoices WHERE status = 'paid';
SELECT count(*), sum(amount) FROM big_invoices WHERE status = 'paid';
SELECT count(*), sum(amount) FROM big_invoices WHERE status = 'paid';
SELECT count(*), sum(amount) FROM big_invoices NOT INDEXED WHERE status = 'paid';
SELECT count(*), sum(amount) FROM big_invoices NOT INDEXED WHERE status = 'paid';
.print --- I 只有 10% 是 refunded
SELECT count(*), sum(amount) FROM big_invoices WHERE status = 'refunded';
SELECT count(*), sum(amount) FROM big_invoices NOT INDEXED WHERE status = 'refunded';
EOF
```

<div class="line-notes">

- `EXPLAIN QUERY PLAN SELECT count(*), sum(amount) FROM big_invoices WHERE status = 'paid';` 先看优化器自己的选择。
- `SELECT count(*), sum(amount) FROM big_invoices WHERE status = 'paid';` 两条让优化器自己选(它会用 `idx_big_status`)。
- `FROM big_invoices NOT INDEXED WHERE status = 'paid';` `NOT INDEXED` 是 SQLite 的一个小语法,**强制这条查询不用任何索引**,用来做对照实验。真实代码里别写它。
- `.print --- I 只有 10% 是 refunded` 换一个稀有的值再比一遍。

</div>

```text
--- H 70% 的行都是 paid
QUERY PLAN
`--SEARCH big_invoices USING INDEX idx_big_status (status=?)
Run Time: real 0.000 user 0.000044 sys 0.000005
70000|178420000
Run Time: real 0.016 user 0.014451 sys 0.001355
70000|178420000
Run Time: real 0.015 user 0.014358 sys 0.000265
70000|178420000
Run Time: real 0.011 user 0.010097 sys 0.000207
70000|178420000
Run Time: real 0.011 user 0.010306 sys 0.000229
--- I 只有 10% 是 refunded
10000|25480000
Run Time: real 0.006 user 0.005679 sys 0.000386
10000|25480000
Run Time: real 0.009 user 0.009007 sys 0.000237
```

H 里,优化器**用了**索引(`SEARCH ... idx_big_status`),用索引的两次约 14.4 毫秒,强制不用索引的两次反而约 10.2 毫秒,**用了索引更慢**。因为 70% 的行都要取回来,每一行先查目录再回表,比闷头从头到尾顺序扫一遍还累。I 里只命中 10%,有索引约 5.7 毫秒、没索引约 9 毫秒,开始占便宜,但远没有第 2 步的 100 倍。

这就是**区分度**(选择性)的概念:一列有多少种不同的值、每个值平均命中多少比例的行。`customer_id` 有 5000 种值,每个值命中万分之二,索引很值;`status` 只有 3 种值,最大的一种占 70%,索引几乎没用。(SQLite 还有一个 `ANALYZE` 命令,收集各列的区分度统计,帮优化器判断得更准,这里先不展开;Postgres 里这件事会自动做。)

## 第 6 步:索引的代价,写得越来越慢

索引不是白送的。每多一个索引,每次 `INSERT`、`UPDATE`(改了被索引的列)、`DELETE` 都要多改一份。量一下往空表里插 10 万行,表上有 0、1、3 个索引时的耗时。三个文件各管一部分,最后用一个循环拼起来。先是建表:

```sql
-- agent-zero-lab/part01/sql/cost_table.sql
DROP TABLE IF EXISTS cost_test;
CREATE TABLE cost_test (
    id           INTEGER PRIMARY KEY,
    customer_id  INTEGER NOT NULL,
    amount       INTEGER NOT NULL,
    status       TEXT    NOT NULL,
    issued_at    TEXT    NOT NULL
);
```

<div class="line-notes">

- `DROP TABLE IF EXISTS cost_test;` 每次先清掉旧表。
- `CREATE TABLE cost_test (` 结构和 `big_invoices` 相同的一张空表,只是名字不同。

</div>

再是三个索引,一行一个:

```sql
-- agent-zero-lab/part01/sql/cost_indexes.sql
CREATE INDEX cost_customer ON cost_test (customer_id);
CREATE INDEX cost_status   ON cost_test (status);
CREATE INDEX cost_issued   ON cost_test (issued_at);
```

<div class="line-notes">

- `CREATE INDEX cost_customer ON cost_test (customer_id);` 第一个索引。注意文件**第一行是注释**,所以下面拼接的时候要把它算进去。
- `CREATE INDEX cost_status   ON cost_test (status);` 第二个。
- `CREATE INDEX cost_issued   ON cost_test (issued_at);` 第三个。

</div>

最后是插入 10 万行并计时:

```sql
-- agent-zero-lab/part01/sql/cost_insert.sql
.timer on
WITH RECURSIVE n(x) AS (
    SELECT 1
    UNION ALL
    SELECT x + 1 FROM n WHERE x < 100000
)
INSERT INTO cost_test (customer_id, amount, status, issued_at)
SELECT (x * 7919) % 5000 + 1,
       (x * 37) % 5000 + 50,
       CASE WHEN x % 10 < 7 THEN 'paid' WHEN x % 10 < 9 THEN 'unpaid' ELSE 'refunded' END,
       date('2026-01-01', '+' || (x % 300) || ' days')
FROM n;
.timer off
```

<div class="line-notes">

- `.timer on` 写在文件里也行,点命令在 `.read` 或管道喂进去时都认。
- `WITH RECURSIVE n(x) AS (` 和 `make_big.sql` 一样的造数据配方,只是行数写死成 100000。
- `INSERT INTO cost_test (customer_id, amount, status, issued_at)` 往 `cost_test` 插入,表上有几个索引,每插一行就要同步改几份。
- `.timer off` 关掉计时,所以只有这一条 INSERT 的耗时被打印。

</div>

拼起来跑三轮:

```bash
cd /Users/你/agent-zero-lab/part01/sql
for n in 0 1 3; do
  echo "== $n 个索引"
  rm -f cost.db
  { cat cost_table.sql; head -n $((n+1)) cost_indexes.sql | tail -n $n; cat cost_insert.sql; } | sqlite3 cost.db | grep Run
  ls -l cost.db | awk '{print $5}'
done
```

<div class="line-notes">

- `for n in 0 1 3; do` shell 的循环,`n` 依次取 0、1、3,代表索引个数。
- `rm -f cost.db` 每轮换一个新库。
- `{ cat cost_table.sql; head -n $((n+1))` 花括号把几段输出拼成一股,一起喂给 `sqlite3 cost.db`:先建表,再放索引,最后插数据。中间那段 `head -n $((n+1)) cost_indexes.sql | tail -n $n` 取索引文件里「第 2 行起共 n 行」:n=3 时 `head -n 4` 取前 4 行,`tail -n 3` 留最后 3 行;n=0 时 `tail -n 0` 什么也不留,表上就没有索引。`$(( ))` 是 shell 里做加法的写法。最后 `| sqlite3 cost.db | grep Run` 的 `grep Run` 只留下计时那一行。
- `ls -l cost.db | awk '{print $5}'` 打印文件字节数。

</div>

```text
== 0 个索引
Run Time: real 0.176 user 0.135006 sys 0.021511
3104768
== 1 个索引
Run Time: real 0.366 user 0.278868 sys 0.033255
4284416
== 3 个索引
Run Time: real 0.712 user 0.556858 sys 0.060563
7958528
```

| 索引个数 | 插入 10 万行的 CPU 时间 | 文件大小 |
| --- | --- | --- |
| 0 | 0.135 秒 | 3.1 MB |
| 1 | 0.279 秒 | 4.3 MB |
| 3 | 0.557 秒 | 8.0 MB |

每多一个索引,写入时间就多出大约一份基础开销,文件也越来越大(三个索引加起来比表本身还大)。读得快、写得慢,是一个**取舍**。经验是:不要「所有列都建个索引以防万一」。**只给你真的会用来筛选、连接、排序的列建索引,而且要先用 `EXPLAIN` 看看它有没有被用上。** 读多写少的表(比如查询用的报表库)可以建得多一些;写入非常频繁的表(日志、流水)索引越少越好。

## 第 7 步:组合索引和最左前缀

一个索引可以放多列,叫**组合索引**(也叫复合索引、联合索引)。它先按第一列排序,第一列相同的再按第二列排,以此类推,像电话簿先按姓、同姓再按名。这决定了它的使用规则:**能用到索引的,是从最左边的列开始连续的那几列**,叫**最左前缀**。用一个干净的 10 万行库试,先不带任何索引:

```bash
rm -f combo.db
sqlite3 combo.db ".parameter set @rows 100000" ".read make_big.sql"
sqlite3 combo.db <<'EOF'
.mode list
.print --- 没有索引
EXPLAIN QUERY PLAN SELECT * FROM big_invoices WHERE customer_id = 1234 AND status = 'paid' ORDER BY issued_at;
CREATE INDEX idx_c_s ON big_invoices (customer_id, status);
.print --- 组合索引 (customer_id, status)
EXPLAIN QUERY PLAN SELECT * FROM big_invoices WHERE customer_id = 1234 AND status = 'paid' ORDER BY issued_at;
EXPLAIN QUERY PLAN SELECT * FROM big_invoices WHERE customer_id = 1234;
EXPLAIN QUERY PLAN SELECT * FROM big_invoices WHERE status = 'paid';
CREATE INDEX idx_c_s_i ON big_invoices (customer_id, status, issued_at);
.print --- 三列 (customer_id, status, issued_at)
EXPLAIN QUERY PLAN SELECT * FROM big_invoices WHERE customer_id = 1234 AND status = 'paid' ORDER BY issued_at;
EXPLAIN QUERY PLAN SELECT issued_at, status FROM big_invoices WHERE customer_id = 1234;
EOF
```

<div class="line-notes">

- `rm -f combo.db` 全新的库,上面没有任何索引。
- `WHERE customer_id = 1234 AND status = 'paid' ORDER BY issued_at;` 同时筛客户和状态,再按日期排。
- `CREATE INDEX idx_c_s ON big_invoices (customer_id, status);` 两列的组合索引:先按 `customer_id` 排,同一个客户内再按 `status` 排。列的**顺序**很重要,`(status, customer_id)` 是另一个索引。
- `WHERE customer_id = 1234;` 只用最左的一列。
- `WHERE status = 'paid';` 跳过最左的列,只用第二列。
- `CREATE INDEX idx_c_s_i ON big_invoices (customer_id, status, issued_at);` 再加第三列 `issued_at`,让排序也能被索引包办。
- `SELECT issued_at, status FROM big_invoices WHERE customer_id = 1234;` 只要索引里有的列,不用回表。

</div>

```text
--- 没有索引
QUERY PLAN
|--SCAN big_invoices
`--USE TEMP B-TREE FOR ORDER BY
--- 组合索引 (customer_id, status)
QUERY PLAN
|--SEARCH big_invoices USING INDEX idx_c_s (customer_id=? AND status=?)
`--USE TEMP B-TREE FOR ORDER BY
QUERY PLAN
`--SEARCH big_invoices USING INDEX idx_c_s (customer_id=?)
QUERY PLAN
`--SCAN big_invoices
--- 三列 (customer_id, status, issued_at)
QUERY PLAN
`--SEARCH big_invoices USING INDEX idx_c_s_i (customer_id=? AND status=?)
QUERY PLAN
`--SEARCH big_invoices USING COVERING INDEX idx_c_s_i (customer_id=?)
```

逐条读:

- 没有索引:全表 `SCAN`,最后还要 `USE TEMP B-TREE FOR ORDER BY`(临时排序)。
- `(customer_id, status)`:两个条件都在索引里,`SEARCH ... (customer_id=? AND status=?)`;只写 `customer_id` 也行(最左一列);**只写 `status` 就是 `SCAN`**,因为索引是先按客户排的,不同客户里的 `paid` 散在各处,和「在电话簿里找所有名字叫明的人」一个道理。这就是最左前缀。
- 两列索引时排序还有一行 `USE TEMP B-TREE FOR ORDER BY`:索引里没有 `issued_at`,数据库得把找出来的行再排一遍。
- 三列索引:`ORDER BY issued_at` 那一行**临时排序消失了**:客户和状态固定之后,索引里剩下的行正好是按 `issued_at` 排好的,读出来就是有序的。
- 最后一条出现新词 **`COVERING INDEX`**(覆盖索引):查询要的列(`issued_at`、`status`)和条件列都在索引里,数据库**连表都不用回去读**,只读索引就够了。

建组合索引的顺序口诀:**等值条件的列放前面,范围条件或排序的列放后面**。比如「某个客户的、某段时间的发票」写成 `(customer_id, issued_at)`,练习 1 会让你试。

## 第 8 步:Postgres 里长什么样(看一眼,不用跟着做)

你现在的练习库用 SQLite,可是后面第四部分起你会用 Postgres(Day 228 装)。两边原理一样,只是计划的写法不同。我在本机的 Postgres 17 里用同样的公式造了一张 10 万行的表,下面是实际输出,读一读就行,不用现在装:

```bash
psql -d w89_idx -f part01/sql/make_big_pg.sql
psql -d w89_idx <<'EOF'
EXPLAIN (ANALYZE, COSTS OFF) SELECT count(*), sum(amount) FROM big_invoices WHERE customer_id = 1234;
CREATE INDEX idx_big_customer ON big_invoices (customer_id);
EXPLAIN (ANALYZE, COSTS OFF) SELECT count(*), sum(amount) FROM big_invoices WHERE customer_id = 1234;
EOF
```

<div class="line-notes">

- `psql -d w89_idx -f part01/sql/make_big_pg.sql` `psql` 是 Postgres 的命令行工具,`-d` 指定库,`-f` 执行文件。这个文件用 `generate_series(1, 100000)` 造数,和 SQLite 的 `WITH RECURSIVE` 做同样的事,公式一样,所以也是 5000 个客户各 20 行。
- `EXPLAIN (ANALYZE, COSTS OFF) SELECT count(*)` Postgres 的 `EXPLAIN` 加 `ANALYZE` 会**真的执行**这条查询并把实际耗时一起报告;`COSTS OFF` 关掉估算成本的数字,让输出短一些。SQLite 里对应的是 `EXPLAIN QUERY PLAN` 加上 `.timer`。
- `CREATE INDEX idx_big_customer ON big_invoices (customer_id);` 建索引的语法和 SQLite 一字不差。

</div>

```text
                                 QUERY PLAN
----------------------------------------------------------------------------
 Aggregate (actual time=49.226..49.227 rows=1 loops=1)
   ->  Seq Scan on big_invoices (actual time=0.486..49.168 rows=20 loops=1)
         Filter: (customer_id = 1234)
         Rows Removed by Filter: 99980
 Planning Time: 0.089 ms
 Execution Time: 49.272 ms

CREATE INDEX
                                          QUERY PLAN
----------------------------------------------------------------------------------------------
 Aggregate (actual time=0.201..0.202 rows=1 loops=1)
   ->  Bitmap Heap Scan on big_invoices (actual time=0.070..0.190 rows=20 loops=1)
         Recheck Cond: (customer_id = 1234)
         Heap Blocks: exact=20
         ->  Bitmap Index Scan on idx_big_customer (actual time=0.057..0.057 rows=20 loops=1)
               Index Cond: (customer_id = 1234)
 Planning Time: 0.333 ms
 Execution Time: 0.240 ms
```

Postgres 把「扫整张表」叫 `Seq Scan`(顺序扫描),还告诉你 `Rows Removed by Filter: 99980`:读了 10 万行,丢掉 99980 行,只留下 20 行,一眼就能看出浪费。建索引后变成 `Bitmap Index Scan`(先在索引里找出 20 个位置)加 `Bitmap Heap Scan`(再按位置去表里取行),总耗时从 49 毫秒降到 0.24 毫秒。(我这台机器当时在同时跑别的任务,Postgres 的绝对时间偏大,看比例。)词不同,思路完全一样:**`Seq Scan` 对应 SQLite 的 `SCAN`;`Index Scan` 和 `Bitmap Index Scan` 对应 `SEARCH ... USING INDEX`**。以后你让模型帮你写查询,看到 `Seq Scan on 大表` 就是警报。

## 和前端代码对照

| 做什么 | SQL | JS |
| --- | --- | --- |
| 没索引的查找 | `SCAN` | `rows.filter(r => r.customer_id === 1234)` |
| 建索引 | `CREATE INDEX idx_x ON t (col)` | `const m = Map.groupBy(rows, r => r.customer_id)`(Node 21 起,较老的版本自己写循环) |
| 用索引的查找 | `SEARCH ... USING INDEX` | `m.get(1234)` |
| 数据变了索引要同步 | 每次 `INSERT/UPDATE/DELETE` 自动维护 | 你得自己在 `push`、删除时同步更新 `Map` |
| 看计划 | `EXPLAIN QUERY PLAN ...` | 浏览器 DevTools 的 Performance 面板(看时间花在哪) |
| 组合索引 | `(customer_id, status)` | 嵌套的 `Map<customer_id, Map<status, rows>>`,只能先按外层查 |
| 覆盖索引 | 只读索引就够 | `Map` 的值里直接存了你要的字段,不用再回数组查 |

## 动手练习

下面的练习都在 `part01/sql` 目录里做。每道题自己建库,不依赖前面步骤留下的状态。

**练习 1:组合索引。** 用 `make_big.sql` 新造一个 10 万行的库 `ex1.db`。查询「客户 1234 在 2026-06-01 之后的发票」(`WHERE customer_id = 1234 AND issued_at >= '2026-06-01'`)。先看没有索引的计划,再建一个合适的组合索引,对比计划和耗时。列顺序为什么这样排?

<details><summary>参考答案</summary>

```bash
rm -f ex1.db
sqlite3 ex1.db ".parameter set @rows 100000" ".read make_big.sql"
sqlite3 ex1.db <<'EOF'
.timer on
.mode list
EXPLAIN QUERY PLAN SELECT * FROM big_invoices WHERE customer_id = 1234 AND issued_at >= '2026-06-01';
SELECT count(*) FROM big_invoices WHERE customer_id = 1234 AND issued_at >= '2026-06-01';
CREATE INDEX idx_c_issued ON big_invoices (customer_id, issued_at);
EXPLAIN QUERY PLAN SELECT * FROM big_invoices WHERE customer_id = 1234 AND issued_at >= '2026-06-01';
SELECT count(*) FROM big_invoices WHERE customer_id = 1234 AND issued_at >= '2026-06-01';
EOF
```

<div class="line-notes">

- `sqlite3 ex1.db ".parameter set @rows 100000" ".read make_big.sql"` 新造库,10 万行,没有任何索引。
- `EXPLAIN QUERY PLAN SELECT * FROM big_invoices WHERE customer_id = 1234 AND issued_at >= '2026-06-01';` 建索引前的计划。
- `SELECT count(*) FROM big_invoices WHERE customer_id = 1234 AND issued_at >= '2026-06-01';` 数一下命中几行,同时计时。
- `CREATE INDEX idx_c_issued ON big_invoices (customer_id, issued_at);` 等值条件的列 `customer_id` 放前面,范围条件的列 `issued_at` 放后面。
- 第二次 `EXPLAIN QUERY PLAN` 和 `SELECT count(*)` 和上面一字不差,看变化。

</div>

实跑输出:

```text
QUERY PLAN
`--SCAN big_invoices
Run Time: real 0.000 user 0.000199 sys 0.000117
7
Run Time: real 0.009 user 0.006481 sys 0.002328
Run Time: real 0.085 user 0.066472 sys 0.015187
QUERY PLAN
`--SEARCH big_invoices USING INDEX idx_c_issued (customer_id=? AND issued_at>?)
Run Time: real 0.000 user 0.000054 sys 0.000016
7
Run Time: real 0.001 user 0.000054 sys 0.000047
```

没有索引时 `SCAN`,约 6.5 毫秒;组合索引后 `SEARCH ... (customer_id=? AND issued_at>?)`,约 0.05 毫秒,命中的 7 行不变。列顺序的理由:先按客户排,同一个客户内再按日期排,所以「客户等于 1234」圈出一小段,段里的日期是有序的,`>=` 只要从中间某处读到段尾。反过来写成 `(issued_at, customer_id)`,先按日期排,6 月 1 日之后的 4 成多行都得看一遍,再逐行判断客户,索引的作用小得多。

</details>

**练习 2:把运算挪到常量那边。** 业务问「含 13% 税后金额超过 5000 的发票有几张,合计多少」,有人写成 `WHERE amount * 1.13 > 5000`。在 `amount` 上建索引,看这条的计划;再改写成索引能用的形式,确认结果一样、计划和耗时变了。

<details><summary>参考答案</summary>

```bash
rm -f ex2.db
sqlite3 ex2.db ".parameter set @rows 100000" ".read make_big.sql"
sqlite3 ex2.db <<'EOF'
.timer on
.mode list
CREATE INDEX idx_amount ON big_invoices (amount);
SELECT count(*), sum(amount) FROM big_invoices WHERE amount * 1.13 > 5000;
SELECT count(*), sum(amount) FROM big_invoices WHERE amount > 5000 / 1.13;
EXPLAIN QUERY PLAN SELECT count(*), sum(amount) FROM big_invoices WHERE amount * 1.13 > 5000;
EXPLAIN QUERY PLAN SELECT count(*), sum(amount) FROM big_invoices WHERE amount > 5000 / 1.13;
EOF
```

<div class="line-notes">

- `CREATE INDEX idx_amount ON big_invoices (amount);` 给 `amount` 建索引。
- `WHERE amount * 1.13 > 5000;` 原写法:列被乘法包住。
- `WHERE amount > 5000 / 1.13;` 改写:两边同时除以 1.13,运算挪到常量 `5000` 上,列 `amount` 单独留在左边。`5000 / 1.13` 是 4424.77(注意 1.13 是小数,不是整数相除)。
- 两条 `EXPLAIN QUERY PLAN` 对应上面两种写法,看计划里是 `SCAN` 还是 `SEARCH`。

</div>

实跑输出:

```text
Run Time: real 0.056 user 0.040725 sys 0.012069
12500|59212500
Run Time: real 0.007 user 0.006594 sys 0.000859
12500|59212500
Run Time: real 0.001 user 0.000662 sys 0.000028
QUERY PLAN
`--SCAN big_invoices USING COVERING INDEX idx_amount
Run Time: real 0.000 user 0.000024 sys 0.000003
QUERY PLAN
`--SEARCH big_invoices USING COVERING INDEX idx_amount (amount>?)
Run Time: real 0.000 user 0.000016 sys 0.000001
```

两种写法结果都是 `12500|59212500`。原写法是 `SCAN`(把整个 `idx_amount` 从头读到尾,每个值乘 1.13 再比),约 6.6 毫秒;改写后是 `SEARCH ... (amount>?)`,直接在索引里找到起点往后读,约 0.66 毫秒。注意计划里写的是 `COVERING INDEX`:这条查询只用到 `amount`,索引里就有,所以不用回表,才会这么快。

</details>

**练习 3(观察题):ORDER BY 加索引之后,结果行变了。** 在 10 万行库 `ex3.db` 上执行 `SELECT id, issued_at FROM big_invoices ORDER BY issued_at DESC LIMIT 5`,记下 5 个 id;建 `issued_at` 的索引后再执行,比较 id 和耗时,并解释;再试试怎样让结果稳定。

<details><summary>参考答案</summary>

```bash
rm -f ex3.db
sqlite3 ex3.db ".parameter set @rows 100000" ".read make_big.sql"
sqlite3 -header ex3.db <<'EOF'
.timer on
EXPLAIN QUERY PLAN SELECT id, issued_at FROM big_invoices ORDER BY issued_at DESC LIMIT 5;
SELECT id, issued_at FROM big_invoices ORDER BY issued_at DESC LIMIT 5;
CREATE INDEX idx_issued ON big_invoices (issued_at);
EXPLAIN QUERY PLAN SELECT id, issued_at FROM big_invoices ORDER BY issued_at DESC LIMIT 5;
SELECT id, issued_at FROM big_invoices ORDER BY issued_at DESC LIMIT 5;
SELECT id, issued_at FROM big_invoices ORDER BY issued_at DESC, id DESC LIMIT 5;
EOF
```

<div class="line-notes">

- `ORDER BY issued_at DESC LIMIT 5;` 取日期最晚的 5 张发票。日期只有 300 种取值,10 万行里同一天有 334 行,**排序键重复(并列)**。
- `CREATE INDEX idx_issued ON big_invoices (issued_at);` 建索引。
- 第二次 `EXPLAIN QUERY PLAN` 和 `SELECT`:同样的查询,看计划和 id 有没有变。
- `ORDER BY issued_at DESC, id DESC LIMIT 5;` 多加一个排序键 `id`,让并列的行有确定的先后。

</div>

实跑输出:

```text
QUERY PLAN
|--SCAN big_invoices
`--USE TEMP B-TREE FOR ORDER BY
Run Time: real 0.001 user 0.000315 sys 0.000207
id|issued_at
299|2026-10-27
599|2026-10-27
899|2026-10-27
1199|2026-10-27
1499|2026-10-27
Run Time: real 0.032 user 0.024920 sys 0.005316
Run Time: real 0.130 user 0.090656 sys 0.023239
QUERY PLAN
`--SCAN big_invoices USING COVERING INDEX idx_issued
Run Time: real 0.000 user 0.000078 sys 0.000009
id|issued_at
99899|2026-10-27
99599|2026-10-27
99299|2026-10-27
98999|2026-10-27
98699|2026-10-27
Run Time: real 0.000 user 0.000066 sys 0.000059
id|issued_at
99899|2026-10-27
99599|2026-10-27
99299|2026-10-27
98999|2026-10-27
98699|2026-10-27
Run Time: real 0.000 user 0.000051 sys 0.000039
```

没有索引:`SCAN` 加临时排序,约 25 毫秒;建索引后:顺着索引从最大端读 5 条就停,约 0.07 毫秒。**但两次拿到的 5 个 id 完全不同**(299、599…对 99899、99599…),因为 2026-10-27 这一天有 334 张发票,它们排序键相同,SQL 只保证「按日期倒序」,并列之间谁先谁后**没有任何保证**,换了执行方式就换了顺序。真实业务里「最新的 5 张」经常这样,翻页时同一行会出现两次或消失。**修法:在 ORDER BY 里再加一个唯一的列(通常是 `id`)作为兜底。** 最后一条加了 `id DESC` 之后结果是确定的(99899 起),并且这个例子里计划仍然只读索引(`issued_at` 加隐含的 rowid 已经够了)。

</details>

**练习 4:小表要不要建索引。** 在 `practice.db`(15 张发票)上给 `invoices.customer_id` 建索引,看计划有没有变;再想一想:15 行的表建这个索引有没有意义?做完记得删掉索引。

<details><summary>参考答案</summary>

```bash
rm -f practice.db
sqlite3 practice.db < customers.sql
sqlite3 practice.db < invoices.sql
sqlite3 practice.db "CREATE INDEX idx_inv_customer ON invoices (customer_id); PRAGMA index_list(invoices);"
sqlite3 practice.db "EXPLAIN QUERY PLAN SELECT * FROM invoices WHERE customer_id = 5; EXPLAIN QUERY PLAN SELECT * FROM invoices WHERE status = 'paid';"
sqlite3 practice.db "DROP INDEX idx_inv_customer;"
```

<div class="line-notes">

- `CREATE INDEX idx_inv_customer ON invoices (customer_id); PRAGMA index_list(invoices);` 在小表上建索引,同一条命令里再用 `PRAGMA index_list` 确认索引建成了。
- 第一条 `EXPLAIN QUERY PLAN` 查有索引的 `customer_id`,第二条查没有索引的 `status`。
- `DROP INDEX idx_inv_customer;` 删索引的语法,删掉后表恢复原样。

</div>

实跑输出:

```text
0|idx_inv_customer|0|c|0
QUERY PLAN
`--SEARCH invoices USING INDEX idx_inv_customer (customer_id=?)
QUERY PLAN
`--SCAN invoices
```

计划会变:按 `customer_id` 查是 `SEARCH`,按 `status` 查仍是 `SCAN`。但 15 行的表只有 1 页,整张表一次读完,和「读目录再回表」差不多,**用不用索引肉眼看不出差别**。小表建索引没有收益,只有写入时多一份维护。需要索引的是会长大的表,而且是**已经能用 `EXPLAIN` 证明慢**的查询。给这类小表建索引的唯一理由是它以后会变大,那就等它真的变大再说。

</details>

**练习 5(开放题):让工具拒绝全表扫描。** 以后你让模型写 SQL 并自动执行,一条慢查询就能拖垮数据库。写一个 shell 脚本 `check_plan.sh`:接收库文件、表名、SQL 三个参数,先用 `EXPLAIN QUERY PLAN` 看计划,发现对指定表的 `SCAN` 就拒绝执行并报出计划,否则才真执行。

<details><summary>参考答案</summary>

```bash
#!/bin/bash
# agent-zero-lab/part01/sql/check_plan.sh
# 用法: ./check_plan.sh 库文件 表名 "SQL"
db="$1"
table="$2"
sql="$3"

plan=$(sqlite3 "$db" "EXPLAIN QUERY PLAN $sql")

if echo "$plan" | grep -Eq "SCAN $table( |$)"; then
  echo "拒绝执行:对 $table 做全表扫描"
  echo "$plan"
  exit 1
fi

echo "计划通过,开始执行"
sqlite3 -header "$db" "$sql"
```

<div class="line-notes">

- `#!/bin/bash` 第一行告诉系统用 bash 解释这个脚本。要先 `chmod +x check_plan.sh` 才能直接运行。
- `db="$1"` `$1`、`$2`、`$3` 是命令行的第 1、2、3 个参数。比如 `./check_plan.sh ex5.db big_invoices "SELECT ..."` 里,`$1` 是 `ex5.db`。
- `plan=$(sqlite3 "$db" "EXPLAIN QUERY PLAN $sql")` 运行 `EXPLAIN QUERY PLAN` 加上传进来的 SQL,把输出存进变量 `plan`。`$( )` 的意思是「执行里面的命令,把输出拿来用」。
- `if echo "$plan" | grep -Eq "SCAN $table( |$)"; then` 在计划文字里找「`SCAN` 加表名」,`-E` 用扩展正则,`( |$)` 表示表名后面是空格或行尾(避免 `big_invoices_2` 被误判),`-q` 不打印、只返回有没有找到。
- `echo "拒绝执行:对 $table 做全表扫描"` 找到了就拒绝,并把计划原样打印出来,方便人或者模型看出该怎么改。
- `exit 1` 以非零退出码结束,程序调用它时能据此判断失败。
- `sqlite3 -header "$db" "$sql"` 没有 `SCAN` 才真的执行原 SQL。

</div>

用 `ex5.db`(10 万行,只建了 `customer_id` 索引)试三条:

```bash
chmod +x check_plan.sh
rm -f ex5.db
sqlite3 ex5.db ".parameter set @rows 100000" ".read make_big.sql"
sqlite3 ex5.db "CREATE INDEX idx_big_customer ON big_invoices (customer_id);"
./check_plan.sh ex5.db big_invoices "SELECT * FROM big_invoices WHERE amount = 100 LIMIT 2"; echo "退出码 $?"
./check_plan.sh ex5.db big_invoices "SELECT * FROM big_invoices WHERE customer_id = 1234 LIMIT 2"; echo "退出码 $?"
./check_plan.sh ex5.db big_invoices "SELECT count(*) FROM big_invoices"; echo "退出码 $?"
```

<div class="line-notes">

- `chmod +x check_plan.sh` 给脚本加上「可执行」权限(Day 4 的 `chmod`)。
- `./check_plan.sh ex5.db big_invoices "SELECT * FROM big_invoices WHERE amount = 100 LIMIT 2"; echo "退出码 $?"` `amount` 没有索引。`$?` 是上一条命令的退出码。
- `./check_plan.sh ex5.db big_invoices "SELECT * FROM big_invoices WHERE customer_id = 1234 LIMIT 2"` 走索引的查询。
- `./check_plan.sh ex5.db big_invoices "SELECT count(*) FROM big_invoices"` 不带条件的 `count(*)`,看脚本怎么判。

</div>

实跑输出:

```text
拒绝执行:对 big_invoices 做全表扫描
QUERY PLAN
`--SCAN big_invoices
退出码 1
计划通过,开始执行
id|customer_id|amount|status|issued_at
3207|1234|3709|unpaid|2026-07-27
8207|1234|3709|unpaid|2026-04-18
退出码 0
拒绝执行:对 big_invoices 做全表扫描
QUERY PLAN
`--SCAN big_invoices USING COVERING INDEX idx_big_customer
退出码 1
```

第一条被拦下,第二条走索引放行,第三条 `count(*)` 也被拦:数全表确实要读整个索引(`SCAN ... USING COVERING INDEX`),这是**保守的**拦法,不会放过真正的慢查询,但可能误杀。真实系统里这一步通常交给解析 SQL 的库(Day 292 会用 sqlglot)和数据库自己的代价估算(Postgres 的 `EXPLAIN` 会给出估算的行数和成本,可以设一个上限)。思路和今天一样:**让执行计划当守门员,而不是等查询跑慢了再发现。**

</details>

验收标准:五道题都在自己终端里跑通;能不看文章写出 `CREATE INDEX`、`EXPLAIN QUERY PLAN` 和一个组合索引;能解释「`SCAN` 和 `SEARCH` 的区别」「为什么 `substr(列)` 会让索引失效」「为什么索引不是越多越好」。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 索引(index) | 另一份按某几列排好序的数据,每条记录「列值 + 行号」,让数据库不用扫全表就能定位 |
| 执行计划 | 数据库决定怎么执行一条查询的方案,`EXPLAIN` 让你看到它 |
| `EXPLAIN QUERY PLAN` | SQLite 里查看执行计划的前缀,不真的执行查询 |
| `SCAN` | 计划里的「扫描」,从头到尾读整张表或整个索引 |
| `SEARCH` | 计划里的「搜索」,用主键或索引直接定位 |
| 全表扫描 | 为了找几行,把整张表都读一遍,大表上通常是慢的原因 |
| B 树(B-tree) | 索引常用的数据结构,多层的页,一页装很多条,查找只需读几页 |
| 页(page) | 数据库读写的最小单位,SQLite 默认 4096 字节 |
| rowid | SQLite 给每行的隐含编号,`INTEGER PRIMARY KEY` 就是它的别名 |
| 查询优化器 | 数据库里挑执行计划的那部分,会选索引、重排 JOIN 顺序 |
| 区分度(选择性) | 一列有多少种不同值、每个值命中多少比例的行,越分散索引越有用 |
| 组合索引 | 放多列的索引,先按第一列排、再按第二列排 |
| 最左前缀 | 组合索引只能用到从最左边开始连续的那几列 |
| 覆盖索引(`COVERING INDEX`) | 查询要的所有列都在索引里,不用回表读数据行 |
| 回表 | 从索引找到行号后,再去表里取整行 |
| `USE TEMP B-TREE FOR ORDER BY` | 计划里的信号,没有现成有序的数据,要临时排一遍 |
| `NOT INDEXED` | SQLite 的语法,强制某条查询不使用索引,只用来做对照 |
| `.timer on` | sqlite3 点命令,每条语句后打印 `real/user/sys` 耗时 |
| `Seq Scan` | Postgres 里的顺序扫描,相当于 SQLite 的 `SCAN` |

## 常见误区

**以为「列上有索引」就等于「查询用上了索引」。** 套函数(`substr(issued_at,1,7)`)、做运算(`customer_id + 0`)、`LIKE '%xx'`、`OR` 连无索引的列,实测全是 `SCAN`。每次改查询、建索引之后都用 `EXPLAIN QUERY PLAN` 确认。

**所有列都建索引。** 实测 3 个索引让插入 10 万行从 0.135 秒变成 0.557 秒,文件从 3.1 MB 变成 8.0 MB。只给真正筛选、连接、排序的列建。

**给 `status` 这类只有几种取值的列建索引。** 实测 70% 的行是 `paid`,有索引 14.4 毫秒,不用索引反而 10.2 毫秒。区分度低的列单独建索引几乎没用。

**只看「快了」,不看结果有没有变。** 加索引改变了执行方式,`ORDER BY` 的并列行顺序跟着变了(实测前 5 个 id 全换了)。需要稳定顺序就加一个唯一列兜底。

**组合索引的列随便排。** `(customer_id, status)` 只能给「客户」或「客户加状态」的查询用,单查 `status` 是 `SCAN`。等值条件的列放前面。

**以为你写在前面的表先被处理。** JOIN 的顺序由优化器决定,实测写成 `customers JOIN invoices` 也是先扫发票表。外键列(`invoices.customer_id`)要建索引。

**用 `EXPLAIN` 之前先下结论「这里要加索引」。** 小表(15 行)建了也看不出差别。先在接近真实的数据量上用 `EXPLAIN` 和计时证明慢,再建。

**拿一次计时当结论。** 第一次要从磁盘读,可能慢几倍;同一条查询多跑几次,看 `user` 时间,量级对就行。

## 学习资料

### 文档与文章

- [SQLite 官方 · The SQLite Query Planner(英文)](https://sqlite.org/queryplanner.html):用一个小例子讲索引怎么让查询更快、组合索引、覆盖索引、`SEARCH` 和 `SCAN` 的含义,是今天内容的官方版。
- [SQLite 官方 · EXPLAIN QUERY PLAN(英文)](https://sqlite.org/eqp.html):计划输出每一种写法的含义,包括 `USE TEMP B-TREE`。
- [SQLite 官方 · The SQLite Query Optimizer Overview(英文)](https://sqlite.org/optoverview.html):`LIKE` 优化的条件、什么样的 `WHERE` 能用到索引。第 5 步 D 项的出处。
- [SQLite 官方 · CREATE INDEX(英文)](https://sqlite.org/lang_createindex.html):语法,包括 Day 91 会用的 `UNIQUE` 索引和部分索引。
- [SQLite 官方 · ANALYZE(英文)](https://sqlite.org/lang_analyze.html):收集统计信息让优化器选得更准,第 5 步末尾提到过。
- [菜鸟教程 · SQLite 索引(Index)](https://www.runoob.com/sqlite/sqlite-index.html):中文,语法速查,有「应该避免使用索引的情况」。
- [PostgreSQL 官方教程 · Indexes 简介(英文)](https://www.postgresql.org/docs/current/indexes-intro.html)和[使用 EXPLAIN(英文)](https://www.postgresql.org/docs/current/using-explain.html):第 8 步里 `Seq Scan`、`Bitmap Index Scan` 的出处,后者把执行计划每个词都解释了一遍。
- [Use The Index, Luke(英文)](https://use-the-index-luke.com/):Markus Winand 写的免费在线教程,专门讲「写 SQL 的人需要知道的索引知识」,各数据库通用。先读前两章(Anatomy of an Index、The Where Clause)就够。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1Kc411b7ny&autoplay=0&high_quality=1" title="5分钟讲透索引" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>涛哥编程日记 · 5分钟讲透索引 · 约 7 分钟,播放 2.2 万,2024 年发布。用最短的时间讲「索引为什么快、代价是什么」,对应第 2、3、6 步。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1Hh9dYBEbH&autoplay=0&high_quality=1" title="彻底搞懂MySQL联合索引+最左前缀原则" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>代码记录栈 · 彻底搞懂 MySQL 联合索引 + 最左前缀原则 · 约 14 分钟,播放 3400,2025 年发布。用的是 MySQL,但联合索引和最左前缀的规则和今天第 7 步完全一致。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/NZgfYbAmge8" title="SQL Indexes - Definition, Examples, and Tips" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Database Star · SQL Indexes - Definition, Examples, and Tips · 英文,可开字幕。定义加例子加使用建议,可以和第 5、6 步对照看。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/BIlFTFrEFOI" title="SQL indexing best practices | How to make your database FASTER!" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>CockroachDB · SQL indexing best practices | How to make your database FASTER! · 英文,可开字幕。实践建议清单,可以和第 5、6、7 步对照。</figcaption>
</figure>

### 书籍

- Markus Winand,《SQL Performance Explained》,2012 年自出版(英文)。整本书就讲索引和 SQL 性能,B 树、组合索引、各种 `WHERE` 写法对索引的影响,和「Use The Index, Luke」是同一作者同一套内容。
- Silvia Botros、Jeremy Tinley,《High Performance MySQL》(第 4 版),O'Reilly,2021(英文)。讲 MySQL,索引和查询优化各有专章,有性能需求时当参考书。

### 开源项目与代码

今天这组不需要。想看「索引」在别的地方的样子,Day 229 会在 Postgres 里给向量建 HNSW 索引,那是同一个想法的另一种形态:先建一份便于查找的结构,换查询变快。

## 自测

1. `EXPLAIN QUERY PLAN` 里的 `SCAN big_invoices` 和 `SEARCH big_invoices USING INDEX idx_big_customer (customer_id=?)` 各是什么意思?哪个更快?

<details><summary>答案</summary>

`SCAN` 是把整张表从头读到尾,每行都检查条件;`SEARCH ... USING INDEX` 是利用 `customer_id` 上排好序的索引直接定位到符合条件的位置,只读相关的几页。在「命中行很少」的查询上后者快得多(今天实测 5 毫秒对 0.06 毫秒,约 100 倍),而且差距随表变大而变大。

</details>

2. 为什么 `WHERE substr(issued_at, 1, 7) = '2026-03'` 用不上 `issued_at` 上的索引?怎么改?

<details><summary>答案</summary>

索引里存的是 `issued_at` 原始值并按它排序,`substr(...)` 得到的是另一个值,索引里没有按它排好的数据,数据库只能逐行取出来套函数再比较(`SCAN`)。改成不动列的范围写法:`WHERE issued_at >= '2026-03-01' AND issued_at < '2026-04-01'`,实测计划变成 `SEARCH ... (issued_at>? AND issued_at<?)`。

</details>

3. 表里有 `status` 一列,只有 `paid`、`unpaid`、`refunded` 三种值,其中 70% 是 `paid`。给它建索引值得吗?为什么?

<details><summary>答案</summary>

基本不值得。区分度低:查 `status = 'paid'` 要回表取 70% 的行,每行先查目录再取数据,比直接顺序扫一遍还慢(实测有索引 14.4 毫秒,强制不用索引 10.2 毫秒)。它还白白占空间、拖慢写入。想按状态查的话,通常把它放进组合索引的后面(比如 `(customer_id, status)`),而不是单独建。

</details>

4. 组合索引 `(customer_id, status)` 能加速下面哪几条?(a) `WHERE customer_id = 5` (b) `WHERE status = 'paid'` (c) `WHERE customer_id = 5 AND status = 'paid'` (d) `WHERE status = 'paid' AND customer_id = 5`

<details><summary>答案</summary>

(a)、(c)、(d)。(a) 用最左一列;(c) 和 (d) 两列都用上,条件写的先后顺序不影响,优化器会自己对上。只有 (b) 不行:跳过了最左的 `customer_id`,索引里不同客户的 `paid` 散落各处,实测是 `SCAN`。

</details>

5. 面试题:线上一张 500 万行的工单表,有个接口越来越慢,SQL 是 `SELECT * FROM tickets WHERE customer_id = ? AND status = 'open' ORDER BY created_at DESC LIMIT 20`。你怎么排查和优化?加索引有什么副作用?

<details><summary>答案</summary>

先在接近线上的数据上跑 `EXPLAIN`(Postgres 用 `EXPLAIN (ANALYZE)`),确认是 `Seq Scan` 还是已经走了索引但回表太多、或者有额外的排序。如果是全表扫描,建组合索引 `(customer_id, status, created_at)`:两个等值条件放前面,排序列放最后,读出来的行本身就是按 `created_at` 排好的,`LIMIT 20` 读到 20 条就停,计划里的 `USE TEMP B-TREE FOR ORDER BY` 也会消失。建完再 `EXPLAIN` 确认确实用上了。副作用:每次插入、改 `status` 或 `created_at`、删除工单都要多维护一份索引,写入变慢、占磁盘;生产大表上建索引还要考虑锁表时间(Postgres 用 `CREATE INDEX CONCURRENTLY`)。另外 `SELECT *` 要回表,如果列表页只要几列,可以让索引覆盖它们。

</details>

6. 面试题:你做了一个让模型写 SQL 回答问题的 Agent(「问数 Agent」)。怎么防止模型写出的 SQL 把数据库拖死?

<details><summary>答案</summary>

几道防线叠加:一是只给只读账号;二是执行前先跑 `EXPLAIN`,计划里对大表有 `Seq Scan` 或估算行数、成本超过上限就拒绝,把计划文字反馈给模型让它改写(练习 5 的思路);三是给每条查询加超时(`statement_timeout`)和 `LIMIT`;四是把大表的常用筛选列建好索引,并在提示词的表结构说明里告诉模型哪些列有索引、鼓励用这些列筛选;五是记录慢查询,加进评测集。Day 291 起会做这个 Agent。

</details>

## 明天预告

Day 90 · 第 13 周复习:编程地基(Day 84–89)。今天是这周的第六个内容日,下一天按规矩是复习日:这一周前半讲 JWT(Day 84),后半讲 SQL 的建表、增删改、JOIN、分组聚合和索引(Day 85–89)。明天不学新东西,把这周画成一张知识地图,合上文章默写一段 JWT 签发校验和一条「每家客户发票合计」的查询,再用一个小项目把 HMAC 签名和 SQL 报表接在一起:给导出的账单报表加一个防篡改的签名。
