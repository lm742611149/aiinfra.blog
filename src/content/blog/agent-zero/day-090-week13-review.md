---
title: 'Day 90 · 第 13 周复习:编程地基(Day 84–89)'
description: '这一周前半讲 JWT 怎么用签名防篡改,后半讲 SQL 从建表、增删改、JOIN、分组一路到索引。今天把六天画成一张图,再用一个小项目把它们接起来:用 SQL 出一份账单审计报表,再给报表签上 JWT,改一个字就验不过。'
pubDate: 2026-10-23
regime: none
tags: ['review', 'sql', 'jwt', 'sqlite', 'python', 'agent-zero']
series: 'agent-zero'
day: 90
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 89](/blog/agent-zero/day-089-sql-5/) 造了一张十万行的 `big_invoices`,用 `EXPLAIN QUERY PLAN` 看到没有索引时是 `SCAN`(从头扫到尾),给 `customer_id` 建索引后变成 `SEARCH ... USING INDEX`,一次查询从约 5 毫秒降到 0.06 毫秒。也看到了索引没用上的几种写法(给列套函数、`LIKE '%xx'`、`OR` 连无索引的列、区分度低的列)、索引拖慢写入的代价(3 个索引让插入 10 万行慢了 4 倍多)、组合索引的最左前缀,以及 `ORDER BY` 遇上并列值时,加了索引结果行会换。

这是第 13 周的最后一天。这一周分成两半:前半天讲 JWT,让你看清「令牌不用存表,靠签名防篡改」;后面五天把数据库从零搭起来,从 `CREATE TABLE` 一直讲到索引。今天不学新东西,把这六天串成一条线,再从空文件开始做一个小项目,检验自己是真会了还是只是看懂了。

## 今天要解决的问题

1. 对着一张图说出这周两条线各自的顺序:JWT 是 base64url、HMAC、三段结构、`pyjwt`、FastAPI 登录;SQL 是建表查询、增删改、JOIN、分组、索引。每个坑发生在哪一天。
2. 合上文章默写两段核心:Day 84 的 `make_token` 和 `check_token`(手工签发校验 JWT),Day 88 的「每家客户的发票合计,含 0 张的」查询。
3. 完成本周小项目:`part01/sql/audit.sql` 出一份账单审计报表,`part01/sign_report.py` 给报表签名并验证,配一套 pytest 测试;练习里再加一个撤销功能。

预计用时 3.5 小时。花费 ¥0,不调模型,不联网。

前置:本周的 [Day 84](/blog/agent-zero/day-084-auth-2/) 到 [Day 89](/blog/agent-zero/day-089-sql-5/)。仓库里应该已经有 Day 84 装好的 `pyjwt`、`part01/sql/` 目录下的 `customers.sql` 和 `invoices.sql`(Day 85、87 建的)。开始前先在 `part01/sql` 目录里跑 `sqlite3 practice.db < customers.sql` 和 `sqlite3 practice.db < invoices.sql`,确认 `practice.db` 是干净的 10 家客户加 15 张发票。

学法:先对照逐行敲一遍(不复制粘贴)并跑通;第二天合上文章默写核心部分;做练习,做不出再展开参考答案,看完关掉重写一遍。复习日的默写最要紧:练习 1 和练习 2 请真的把文章关掉写,写完再展开答案对。

## 本周知识地图

这一周的两条线,上面是 JWT,下面是 SQL。右边那个「小项目」把两条线接在了一起:SQL 出报表,JWT 给报表签名。

<figure>
<svg viewBox="0 0 640 360" role="img" aria-label="第 13 周知识地图:上面一行是 Day 84 的 JWT,从 base64url 到 HMAC 到三段结构再到 FastAPI 登录;下面一行是 Day 85 到 Day 89 的 SQL,从建表查询到增删改、JOIN、分组聚合和索引;右侧小项目把 SQL 报表和 JWT 签名接起来">
<rect x="0" y="0" width="640" height="360" fill="var(--paper-raised)" rx="6"/>
<g font-family="var(--font-mono)" font-size="12">
<text x="16" y="24" fill="var(--ink)">Day 84 · JWT</text>
<rect x="16" y="34" width="100" height="44" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="66" y="54" fill="var(--ink)" text-anchor="middle">base64url</text>
<text x="66" y="70" fill="var(--ink-soft)" text-anchor="middle" font-size="11">不是加密</text>
<rect x="136" y="34" width="100" height="44" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="186" y="54" fill="var(--ink)" text-anchor="middle">HMAC</text>
<text x="186" y="70" fill="var(--ink-soft)" text-anchor="middle" font-size="11">密钥签名</text>
<rect x="256" y="34" width="100" height="44" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="306" y="54" fill="var(--ink)" text-anchor="middle">三段结构</text>
<text x="306" y="70" fill="var(--ink-soft)" text-anchor="middle" font-size="11">头.内容.签名</text>
<rect x="376" y="34" width="100" height="44" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="426" y="54" fill="var(--ink)" text-anchor="middle">pyjwt</text>
<text x="426" y="70" fill="var(--ink-soft)" text-anchor="middle" font-size="11">algorithms 白名单</text>
<line x1="116" y1="56" x2="136" y2="56" stroke="var(--rule)"/>
<line x1="236" y1="56" x2="256" y2="56" stroke="var(--rule)"/>
<line x1="356" y1="56" x2="376" y2="56" stroke="var(--rule)"/>
<text x="16" y="116" fill="var(--ink)">Day 85–89 · SQL</text>
<rect x="16" y="126" width="100" height="44" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="66" y="146" fill="var(--ink)" text-anchor="middle">85 建表查询</text>
<text x="66" y="162" fill="var(--ink-soft)" text-anchor="middle" font-size="11">SELECT WHERE</text>
<rect x="136" y="126" width="100" height="44" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="186" y="146" fill="var(--ink)" text-anchor="middle">86 增删改</text>
<text x="186" y="162" fill="var(--ink-soft)" text-anchor="middle" font-size="11">忘写 WHERE</text>
<rect x="256" y="126" width="100" height="44" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="306" y="146" fill="var(--ink)" text-anchor="middle">87 JOIN</text>
<text x="306" y="162" fill="var(--ink-soft)" text-anchor="middle" font-size="11">内连接 左连接</text>
<rect x="376" y="126" width="100" height="44" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="426" y="146" fill="var(--ink)" text-anchor="middle">88 分组聚合</text>
<text x="426" y="162" fill="var(--ink-soft)" text-anchor="middle" font-size="11">GROUP BY HAVING</text>
<rect x="136" y="190" width="100" height="44" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="186" y="210" fill="var(--ink)" text-anchor="middle">89 索引</text>
<text x="186" y="226" fill="var(--ink-soft)" text-anchor="middle" font-size="11">EXPLAIN</text>
<line x1="116" y1="148" x2="136" y2="148" stroke="var(--rule)"/>
<line x1="236" y1="148" x2="256" y2="148" stroke="var(--rule)"/>
<line x1="356" y1="148" x2="376" y2="148" stroke="var(--rule)"/>
<line x1="426" y1="170" x2="236" y2="212" stroke="var(--rule)" stroke-dasharray="4 3"/>
<rect x="504" y="34" width="124" height="136" rx="4" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="566" y="56" fill="var(--ink)" text-anchor="middle">小项目</text>
<text x="566" y="80" fill="var(--ink-soft)" text-anchor="middle" font-size="11">audit.sql</text>
<text x="566" y="96" fill="var(--ink-soft)" text-anchor="middle" font-size="11">↓ report.txt</text>
<text x="566" y="112" fill="var(--ink-soft)" text-anchor="middle" font-size="11">sha256</text>
<text x="566" y="128" fill="var(--ink-soft)" text-anchor="middle" font-size="11">↓ JWT 签名</text>
<text x="566" y="152" fill="var(--ink-soft)" text-anchor="middle" font-size="11">report.txt.jwt</text>
<line x1="476" y1="56" x2="504" y2="80" stroke="var(--rule)"/>
<line x1="476" y1="148" x2="504" y2="120" stroke="var(--rule)"/>
<text x="16" y="274" fill="var(--ink)">这一周共同的主题:没报错,但结果不对</text>
<text x="16" y="298" fill="var(--ink-soft)" font-size="11">JWT:decode 不写 algorithms、关掉验签,伪造的令牌照样通过</text>
<text x="16" y="316" fill="var(--ink-soft)" font-size="11">SQL:UPDATE 忘了 WHERE、ON 写错、LEFT JOIN 后 count(*)、索引没用上,都不报错</text>
<text x="16" y="338" fill="var(--ink-faint)" font-size="11">所以每一步都要有「证据」:EXPLAIN 看计划、核对合计、测试钉住行为。</text>
</g>
</svg>
<figcaption>琥珀色是 Day 84 的 JWT(只会前端的你熟悉的「令牌」),蓝色是 Day 85–89 的 SQL。右边的小项目把两条线接起来:SQL 出报表,JWT 给报表签名。</figcaption>
</figure>

再按「想做什么就写什么」排一遍,这是一张默写时当提纲的速查表:

| 想做什么 | 写什么 | 哪天 |
| --- | --- | --- |
| 不用库解出令牌的内容 | 按 `.` 拆三段,第二段补 `=` 后 `base64.urlsafe_b64decode` 再 `json.loads` | 84 |
| 不用库签发令牌 | `hmac.new(SECRET, 前两段, sha256)`,再 base64url | 84 |
| 用 pyjwt 签发、校验 | `jwt.encode(claims, secret, algorithm="HS256")`、`jwt.decode(token, secret, algorithms=["HS256"])` | 84 |
| 建表 | `CREATE TABLE ... (id INTEGER PRIMARY KEY, ...)` | 85 |
| 取数据 | `SELECT ... FROM ... WHERE ... ORDER BY ... LIMIT` | 85 |
| 加、改、删一行 | `INSERT INTO t (列) VALUES (...)`、`UPDATE ... SET ... WHERE`、`DELETE ... WHERE` | 86 |
| 把两张表的行配对 | `JOIN ... ON a.x = b.y`,要保住左表用 `LEFT JOIN` | 87 |
| 找「没有」 | `LEFT JOIN ... WHERE 右表.id IS NULL` | 87 |
| 汇总 | `count`、`sum`、`avg`,配 `GROUP BY`,筛组用 `HAVING` | 88 |
| 没有数据时给 0 | `coalesce(sum(x), 0)` | 88 |
| 看数据库怎么执行 | `EXPLAIN QUERY PLAN SELECT ...` | 89 |
| 让大表查得快 | `CREATE INDEX idx_x ON t (col)` | 89 |

## 本周每天一句话

- [Day 84](/blog/agent-zero/day-084-auth-2/) JWT 是「头.内容.签名」三段,前两段只是 base64url 编码,谁都能读;签名是服务端用密钥对前两段做的 HMAC-SHA256,改一个字就对不上;`decode` 必须写 `algorithms` 白名单,令牌签发后服务端没法让它提前作废。
- [Day 85](/blog/agent-zero/day-085-sql-1/) 用 `sqlite3` 建 `customers` 表和 `SELECT`、`WHERE`、`ORDER BY`、`LIMIT`;NULL 要用 `IS NULL`,字符串用单引号,AND 比 OR 先算。
- [Day 86](/blog/agent-zero/day-086-sql-2/) `INSERT`、`UPDATE`、`DELETE` 的写法和 `UPDATE`/`DELETE` 忘写 `WHERE` 的事故:语法合法、不报错、命中全部行;改之前先写同条件的 `SELECT`,重要的改动先备份。
- [Day 87](/blog/agent-zero/day-087-sql-3/) 新建 `invoices` 表,`JOIN` 把发票和客户配对;内连接丢掉对不上的行(15 号孤儿发票),`LEFT JOIN` 保住左表,后面再用 `WHERE` 筛右表会把它变回内连接。
- [Day 88](/blog/agent-zero/day-088-sql-4/) `count`、`sum`、`avg`、`min`、`max` 把多行压成一个值,`GROUP BY` 分堆各算一次;`WHERE` 筛行、`HAVING` 筛组;`LEFT JOIN` 后数右表要用 `count(i.id)`,`sum` 对空集是 NULL。
- [Day 89](/blog/agent-zero/day-089-sql-5/) 索引是一份排好序的目录,`EXPLAIN QUERY PLAN` 里 `SCAN` 是全表扫、`SEARCH ... USING INDEX` 是走索引;列上套函数会让索引失效,索引占空间、拖慢写入,组合索引只能用最左前缀。

## 本周小项目:给账单审计报表签名

Agent 课后面你要让模型替客户查账、出结论,这些结论最终会变成一份份「导出的报告」:发给财务,存进工单,拿去对账。报告发出去之后有人悄悄改了其中一个数怎么办?今天做一个最小的版本:**用 SQL 出一份审计报表,再给这份报表签一个 JWT,验证时内容有一个字符不一样就拒绝**。需求:

- `part01/sql/audit.sql`:对 `practice.db` 跑六条查询(总览、按状态汇总、每家客户含 0 张的合计、合计超过 3000 的客户、孤儿发票、对账),每条前面用 `.print` 打一个小标题,输出存成 `report.txt`。
- `part01/sign_report.py`:`sign` 给 `report.txt` 算 SHA-256,把「文件名、摘要、签发时间、过期时间」装进一个 JWT,存到 `report.txt.jwt`;`verify` 校验签名、有没有过期、文件名对不对、内容摘要对不对。密钥从环境变量 `REPORT_SECRET` 读,少于 32 个字符就拒绝(fail closed,Day 84)。
- `tests/test_sign_report.py`:七个测试,钉住上面这些行为。

**先别往下看。** 先自己在 `audit.sql` 里把六条查询写出来,再对照下面的参考。重点看你有没有漏掉:`LEFT JOIN` 后用 `count(i.id)` 而不是 `count(*)`、`sum` 外面套 `coalesce`、`HAVING` 里重写聚合表达式。

### 第一部分:audit.sql

```sql
-- agent-zero-lab/part01/sql/audit.sql
.print == 1. 总览:一共多少张发票、多少钱
SELECT count(*) AS invoices, sum(amount) AS total
FROM invoices;

.print == 2. 按状态:张数和金额
SELECT status, count(*) AS n, sum(amount) AS total
FROM invoices
GROUP BY status
ORDER BY total DESC;

.print == 3. 每家客户的发票(包括 0 张的)
SELECT c.id, c.company, count(i.id) AS invoices, coalesce(sum(i.amount), 0) AS total
FROM customers c
LEFT JOIN invoices i ON i.customer_id = c.id
GROUP BY c.id, c.company
ORDER BY total DESC, c.id;

.print == 4. 发票合计超过 3000 的客户
SELECT c.company, sum(i.amount) AS total
FROM customers c
JOIN invoices i ON i.customer_id = c.id
GROUP BY c.id, c.company
HAVING sum(i.amount) > 3000
ORDER BY total DESC;

.print == 5. 孤儿发票:客户表里找不到买主
SELECT i.id, i.customer_id, i.amount
FROM invoices i
LEFT JOIN customers c ON c.id = i.customer_id
WHERE c.id IS NULL;

.print == 6. 对账:能对上客户的发票合计(和第 1 项的总额相差多少,就是孤儿发票的钱)
SELECT sum(i.amount) AS matched_total
FROM invoices i
JOIN customers c ON c.id = i.customer_id;
```

<div class="line-notes">

- `.print == 1. 总览:一共多少张发票、多少钱` `.print` 是 sqlite3 的点命令(Day 89 用过),把后面的文字原样打印出来,当报表里的小标题。它不是 SQL,所以不用分号。
- `SELECT count(*) AS invoices, sum(amount) AS total` Day 88 的整表聚合,结果只有一行:15 张,100017 元。
- `GROUP BY status` 按状态分三堆:paid 10 张 79898,unpaid 4 张 20041,refunded 1 张 78。
- `ORDER BY total DESC;` 排序发生在分组之后,所以能用聚合的别名 `total`。
- `SELECT c.id, c.company, count(i.id) AS invoices, coalesce(sum(i.amount), 0) AS total` 第 3 条是今天最容易写错的:数右表的主键 `count(i.id)`,没发票的客户得 0;`coalesce` 把 `sum` 的 NULL 换成 0。
- `LEFT JOIN invoices i ON i.customer_id = c.id` 左连接保住 6 号禾丰农业和 10 号小满花店。
- `GROUP BY c.id, c.company` 每家客户一堆,共 10 堆。
- `ORDER BY total DESC, c.id;` 金额降序;星河餐饮和云杉律所都是 3564,再按 id 排,让顺序稳定,因为后面要给文件算摘要,顺序一变摘要就变。
- `HAVING sum(i.amount) > 3000` 对每家客户的合计做判断,4 家过线。注意这里内连接,所以没发票的两家不会出现。
- `LEFT JOIN customers c ON c.id = i.customer_id` 第 5 条把方向反过来:以发票为主,保住每一张发票。
- `WHERE c.id IS NULL;` 配不上客户的发票,右边的 `c.id` 是 NULL。结果就是 15 号发票,客户编号 11,156 元。
- `SELECT sum(i.amount) AS matched_total` 第 6 条:只算能配上客户的发票,是 99861。和第 1 条的 100017 差 156,正好是孤儿发票。

</div>

跑一遍,把输出存成 `report.txt`(在 `part01/sql` 目录):

```bash
cd /Users/你/agent-zero-lab/part01/sql
rm -f practice.db
sqlite3 practice.db < customers.sql
sqlite3 practice.db < invoices.sql
sqlite3 -header practice.db < audit.sql > report.txt
cat report.txt
shasum -a 256 report.txt
```

<div class="line-notes">

- `rm -f practice.db` 从干净的库开始,不带着之前练习的残留。
- `sqlite3 practice.db < customers.sql` 重建客户表,接着 `invoices.sql` 重建发票表。
- `sqlite3 -header practice.db < audit.sql > report.txt` 三个符号各管一件事:`-header` 让每条查询带列名;`< audit.sql` 把文件当输入喂进去;`> report.txt` 把所有输出写进文件而不是打印在屏幕上(Day 5 的重定向)。
- `cat report.txt` 看内容。
- `shasum -a 256 report.txt` macOS 自带的命令,算文件的 SHA-256。待会儿 Python 里算出来的摘要应该和它一样。

</div>

```text
== 1. 总览:一共多少张发票、多少钱
invoices|total
15|100017
== 2. 按状态:张数和金额
status|n|total
paid|10|79898
unpaid|4|20041
refunded|1|78
== 3. 每家客户的发票(包括 0 张的)
id|company|invoices|total
5|启明科技|2|55720
3|远山物流|2|33830
1|星河餐饮|3|3564
8|云杉律所|2|3564
4|蓝鲸教育|1|1980
9|北辰贸易|1|891
2|青木设计|2|234
7|半岛咖啡|1|78
6|禾丰农业|0|0
10|小满花店|0|0
== 4. 发票合计超过 3000 的客户
company|total
启明科技|55720
远山物流|33830
星河餐饮|3564
云杉律所|3564
== 5. 孤儿发票:客户表里找不到买主
id|customer_id|amount
15|11|156
== 6. 对账:能对上客户的发票合计(和第 1 项的总额相差多少,就是孤儿发票的钱)
matched_total
99861
7aaa094a5cf947651b9d2f6de7652d164563874b8581e3af4d840ec82193d47f  report.txt
```

六段对得上:总额 100017 = 已付 79898 + 未付 20041 + 已退款 78;每家客户的合计之和加上孤儿发票 156,等于 100017(第 6 条 99861 + 156)。最后一行是文件的 SHA-256,64 个十六进制字符,后面签名就签这个值。

### 第二部分:sign_report.py

新建 `part01/sign_report.py`。思路和 Day 84 的 `jwt_api.py` 一脉相承:密钥从环境变量读、不够长就拒绝;不同的是这次令牌不是用来登录,而是**签一份文件的「指纹」**。

```python
# agent-zero-lab/part01/sign_report.py
import hashlib
import os
import sys
import time
from pathlib import Path

import jwt

TTL_SECONDS = 7 * 24 * 3600


def secret() -> str:
    value = os.environ.get("REPORT_SECRET", "")
    if len(value) < 32:
        raise RuntimeError("REPORT_SECRET 没配置,或者不够 32 个字符")
    return value


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def token_path(path: Path) -> Path:
    return path.with_name(path.name + ".jwt")


def sign(path: Path, ttl: int = TTL_SECONDS) -> Path:
    now = int(time.time())
    claims = {"file": path.name, "sha256": digest(path), "iat": now, "exp": now + ttl}
    token = jwt.encode(claims, secret(), algorithm="HS256")
    out = token_path(path)
    out.write_text(token + "\n", encoding="utf-8")
    return out


def verify(path: Path) -> tuple[bool, str]:
    tp = token_path(path)
    if not tp.exists():
        return False, "找不到签名文件 " + tp.name
    token = tp.read_text(encoding="utf-8").strip()
    try:
        claims = jwt.decode(token, secret(), algorithms=["HS256"])
    except jwt.ExpiredSignatureError:
        return False, "签名已过期"
    except jwt.InvalidTokenError:
        return False, "签名无效:令牌被改过,或者不是我们签的"
    if claims.get("file") != path.name:
        return False, "这份签名属于另一个文件:" + str(claims.get("file"))
    if claims.get("sha256") != digest(path):
        return False, "报表内容和签名时不一样,被改过"
    return True, "报表完好,签发于 " + time.strftime("%Y-%m-%d %H:%M", time.localtime(claims["iat"]))


def main(argv: list[str]) -> int:
    if len(argv) != 3 or argv[1] not in ("sign", "verify"):
        print("用法: python -m part01.sign_report sign|verify 报表文件")
        return 2
    path = Path(argv[2])
    if not path.is_file():
        print("找不到文件:", path)
        return 2
    if argv[1] == "sign":
        print("已签名 →", sign(path))
        return 0
    ok, reason = verify(path)
    print(("通过:" if ok else "拒绝:") + reason)
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv))
```

<div class="line-notes">

- `import hashlib` 标准库的哈希,Day 84 用过 `hashlib.sha256`。这次拿它算整份文件的指纹,不是算签名。
- `import os` 读环境变量。
- `import sys` 要用 `sys.argv`(命令行参数,Day 44 见过)和 `sys.exit`(带退出码结束)。
- `from pathlib import Path` Day 37 学的路径对象,文件读写都走它。
- `import jwt` pyjwt,Day 84 装的。
- `TTL_SECONDS = 7 * 24 * 3600` 报表签名一周有效:7 天 × 24 小时 × 3600 秒 = 604800。JWT 的时间一律是**秒**,不是毫秒。
- `def secret() -> str:` 和 Day 84 的 `jwt_secret()` 一样的思路。
- `value = os.environ.get("REPORT_SECRET", "")` 没配置就得到空串,不会 `KeyError`。
- `if len(value) < 32:` 太短也拒绝。32 个字符是 HS256 推荐下限(Day 84)。
- `raise RuntimeError("REPORT_SECRET 没配置,或者不够 32 个字符")` 这里**不是返回**,是直接抛异常:没有密钥时,签名和验证都不该「悄悄通过」。
- `return hashlib.sha256(path.read_bytes()).hexdigest()` `read_bytes()` 把整个文件读成 bytes,`sha256(...)` 算摘要,`hexdigest()` 转成 64 个字符的十六进制。文件里改一个字符,摘要就面目全非。
- `return path.with_name(path.name + ".jwt")` `with_name` 换掉文件名那一段:`report.txt` 变成 `report.txt.jwt`,目录不变。
- `def sign(path: Path, ttl: int = TTL_SECONDS) -> Path:` `ttl` 默认一周,测试里会传负数造一个「已过期」的令牌。
- `now = int(time.time())` 当前时间,秒,取整(实跑时是 1792727109)。
- `claims = {"file": path.name, "sha256": digest(path), "iat": now, "exp": now + ttl}` 令牌里装四样:文件名(防止把 A 的签名贴到 B 上)、文件摘要、签发时间 `iat`、过期时间 `exp`。`exp` 是 pyjwt 认的标准字段,`decode` 自动检查。
- `token = jwt.encode(claims, secret(), algorithm="HS256")` 签名,和 Day 84 一样。
- `out.write_text(token + "\n", encoding="utf-8")` 令牌是一行文本,存成 `.jwt` 文件,末尾加换行。
- `tp = token_path(path)` 验证时先找到对应的签名文件。
- `if not tp.exists():` 没有签名文件,直接拒绝,说清楚是「找不到」,不要和「签名不对」混成一句话。
- `token = tp.read_text(encoding="utf-8").strip()` 读出令牌,`strip()` 去掉末尾换行,否则最后一段会多一个字符。
- `claims = jwt.decode(token, secret(), algorithms=["HS256"])` 一行做完验签名和验过期,`algorithms` 是白名单(Day 84 的坑一)。
- `except jwt.ExpiredSignatureError:` 子类写在前面(Day 84 的误区),过期给单独的提示。
- `except jwt.InvalidTokenError:` 其他所有问题:签名对不上、格式坏了,统一一句话,不细说是哪种。
- `if claims.get("file") != path.name:` 签名通过之后,还要核对令牌里的文件名。有人把 A 报表的 `.jwt` 复制成 B 报表的,签名本身是真的,但对不上 B。
- `if claims.get("sha256") != digest(path):` 核心一行:重新算现在这个文件的摘要,和签名时记下的比。内容被改过,这里就对不上。
- `return True, "报表完好,签发于 "` `time.localtime(claims["iat"])` 把签发秒数转成本地时间,`strftime` 排版成 `2026-10-23 11:45`。
- `def main(argv: list[str]) -> int:` 命令行入口,返回的整数就是进程的退出码。
- `if len(argv) != 3 or argv[1] not in ("sign", "verify"):` `argv[0]` 是脚本名,`argv[1]` 是子命令,`argv[2]` 是文件,所以正常是 3 个。
- `return 2` 用法错误,退出码 2。约定:0 成功,1 业务上的失败(验不过),2 命令用错了。
- `path = Path(argv[2])` 把命令行里的字符串变成路径对象。
- `if not path.is_file():` 文件不存在也退出码 2。
- `print("已签名 →", sign(path))` 签名成功时打印生成的 `.jwt` 文件路径。
- `ok, reason = verify(path)` 把 `(是否通过, 原因)` 这个元组拆成两个变量。
- `print(("通过:" if ok else "拒绝:") + reason)` 条件表达式,相当于 JS 的 `ok ? "通过:" : "拒绝:"`。
- `return 0 if ok else 1` 验不过,退出码 1,别的程序(比如部署脚本)可以据此判断。
- `sys.exit(main(sys.argv))` 把 `main` 的返回值当退出码。

</div>

basedpyright 检查 0 错误。生成密钥,签名,验证,再故意改一个数:

```bash
cd /Users/你/agent-zero-lab
export REPORT_SECRET=$(uv run python -c "import secrets; print(secrets.token_urlsafe(32))")
uv run python -m part01.sign_report verify part01/sql/report.txt; echo "退出码 $?"
uv run python -m part01.sign_report sign part01/sql/report.txt; echo "退出码 $?"
uv run python -m part01.sign_report verify part01/sql/report.txt; echo "退出码 $?"
sed -i '' 's/|100017/|900017/' part01/sql/report.txt
uv run python -m part01.sign_report verify part01/sql/report.txt; echo "退出码 $?"
```

<div class="line-notes">

- `export REPORT_SECRET=$(uv run python -c "import secrets; print(secrets.token_urlsafe(32))")` 生成 43 个字符的随机密钥并放进环境变量(只对当前终端窗口有效)。`$( )` 是「执行里面的命令,把输出拿来用」。
- `uv run python -m part01.sign_report verify part01/sql/report.txt; echo "退出码 $?"` 还没有签名就先验证一次,看它怎么拒绝。`$?` 是上一条命令的退出码。
- `uv run python -m part01.sign_report sign part01/sql/report.txt; echo "退出码 $?"` 签名,生成 `report.txt.jwt`。
- `sed -i '' 's/|100017/|900017/' part01/sql/report.txt` 用 `sed` 把报表里的 `|100017` 改成 `|900017`:总额多了一个 8 万。macOS 的 `sed -i` 要在后面跟一个空字符串 `''`。
- 最后一条 `verify`:同一个命令,内容已经变了。

</div>

实跑输出:

```text
拒绝:找不到签名文件 report.txt.jwt
退出码 1
已签名 → part01/sql/report.txt.jwt
退出码 0
通过:报表完好,签发于 2026-10-23 11:45
退出码 0
拒绝:报表内容和签名时不一样,被改过
退出码 1
```

四步依次是:没签名先拒绝;签名;验证通过;改了一个数(100017 变成 900017),验证拒绝。看一眼 `.jwt` 里装了什么(这是 Day 84 的「base64 不是加密」的复习,谁都能读):

```bash
cut -c1-60 part01/sql/report.txt.jwt
uv run python -c "
import jwt
t = open('part01/sql/report.txt.jwt').read().strip()
print(jwt.decode(t, options={'verify_signature': False}))"
```

<div class="line-notes">

- `cut -c1-60 part01/sql/report.txt.jwt` 只显示每行前 60 个字符,令牌整条有 257 个字符。
- `t = open('part01/sql/report.txt.jwt').read().strip()` 读出令牌文本。
- `print(jwt.decode(t, options={'verify_signature': False}))` 不验签名,只偷看内容。这是 Day 84 说过的,**只在调试脚本里这样用**,验证的地方绝不能关。

</div>

```text
eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJmaWxlIjoicmVwb3J0LnR
{'file': 'report.txt', 'sha256': '7aaa094a5cf947651b9d2f6de7652d164563874b8581e3af4d840ec82193d47f', 'iat': 1792727109, 'exp': 1793331909}
```

`sha256` 和刚才 `shasum` 算出来的一模一样;`exp - iat = 1793331909 - 1792727109 = 604800`,正好一周。`eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9` 是 Day 84 里见过的 `{"alg":"HS256","typ":"JWT"}`。

把报表改回去(重新跑一遍 `audit.sql`,查询是确定的,输出一字不差),验证又过了:

```bash
sqlite3 -header part01/sql/practice.db < part01/sql/audit.sql > part01/sql/report.txt
uv run python -m part01.sign_report verify part01/sql/report.txt; echo "退出码 $?"
```

<div class="line-notes">

- `sqlite3 -header part01/sql/practice.db < part01/sql/audit.sql > part01/sql/report.txt` 从仓库根目录跑,三个路径都写全了。同一个库同一份查询,输出一字不差,所以摘要和签名时一样。注意第 3 条查询里的 `ORDER BY total DESC, c.id` 就是为了这里:不写 `c.id` 兜底,并列的两行顺序没有保证,摘要就可能变。
- `uv run python -m part01.sign_report verify part01/sql/report.txt; echo "退出码 $?"` 同一份签名文件,再验一次。

</div>

```text
通过:报表完好,签发于 2026-10-23 11:45
退出码 0
```

没配密钥或密钥太短时,`sign` 和 `verify` 都直接抛异常(最后几行,省略了前面的 traceback):

```text
    raise RuntimeError("REPORT_SECRET 没配置,或者不够 32 个字符")
RuntimeError: REPORT_SECRET 没配置,或者不够 32 个字符
```

<figure>
<svg viewBox="0 0 640 250" role="img" aria-label="签名和验证流程:sqlite3 用 audit.sql 出 report.txt,算 SHA-256,装进 JWT 的 claims 用 REPORT_SECRET 签名成 report.txt.jwt;验证时重新算文件摘要,和令牌里的比,再检查签名和过期">
<rect x="0" y="0" width="640" height="250" fill="var(--paper-raised)" rx="6"/>
<g font-family="var(--font-mono)" font-size="12">
<text x="16" y="22" fill="var(--ink)">签发</text>
<rect x="16" y="32" width="110" height="40" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="71" y="56" fill="var(--ink)" text-anchor="middle">audit.sql</text>
<rect x="150" y="32" width="110" height="40" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="205" y="56" fill="var(--ink)" text-anchor="middle">report.txt</text>
<rect x="284" y="32" width="150" height="40" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="359" y="50" fill="var(--ink)" text-anchor="middle">sha256 + 文件名</text>
<text x="359" y="64" fill="var(--ink-soft)" text-anchor="middle" font-size="11">+ iat、exp</text>
<rect x="458" y="32" width="166" height="40" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="541" y="50" fill="var(--ink)" text-anchor="middle">HMAC(REPORT_SECRET)</text>
<text x="541" y="64" fill="var(--ink-soft)" text-anchor="middle" font-size="11">→ report.txt.jwt</text>
<line x1="126" y1="52" x2="150" y2="52" stroke="var(--rule)"/>
<line x1="260" y1="52" x2="284" y2="52" stroke="var(--rule)"/>
<line x1="434" y1="52" x2="458" y2="52" stroke="var(--rule)"/>
<text x="16" y="112" fill="var(--ink)">验证(从上到下,一步不过就拒绝)</text>
<rect x="16" y="122" width="300" height="24" rx="4" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="26" y="139" fill="var(--ink-soft)">1 有没有 .jwt 文件</text>
<rect x="16" y="150" width="300" height="24" rx="4" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="26" y="167" fill="var(--ink-soft)">2 jwt.decode:签名对不对、过期没有</text>
<rect x="16" y="178" width="300" height="24" rx="4" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="26" y="195" fill="var(--ink-soft)">3 令牌里的文件名 = 这个文件的名字</text>
<rect x="16" y="206" width="300" height="24" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="26" y="223" fill="var(--ink)">4 令牌里的 sha256 = 现在重算的 sha256</text>
<text x="340" y="139" fill="var(--ink-soft)" font-size="11">缺文件 → 找不到签名文件</text>
<text x="340" y="167" fill="var(--ink-soft)" font-size="11">改令牌/过期 → 无效/过期</text>
<text x="340" y="195" fill="var(--ink-soft)" font-size="11">张冠李戴 → 属于另一个文件</text>
<text x="340" y="223" fill="var(--ink)" font-size="11">改了报表一个字 → 被改过</text>
</g>
</svg>
<figcaption>签发时把文件的 SHA-256 装进令牌再签名;验证时重新算文件的摘要和令牌里的比。令牌保证摘要没被改,摘要保证文件没被改,两环扣在一起。</figcaption>
</figure>

### 第三部分:测试

和 Day 83 一样,每个行为配一个测试钉住。新建 `tests/test_sign_report.py`:

```python
# agent-zero-lab/tests/test_sign_report.py
from pathlib import Path

import pytest

from part01.sign_report import sign, token_path, verify

SECRET = "report-secret-for-tests-0123456789-abcdef"


@pytest.fixture
def report(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    monkeypatch.setenv("REPORT_SECRET", SECRET)
    path = tmp_path / "report.txt"
    path.write_text("invoices|total\n15|100017\n", encoding="utf-8")
    return path


def test_sign_then_verify_ok(report: Path):
    sign(report)
    ok, reason = verify(report)
    assert ok, reason


def test_changed_report_is_rejected(report: Path):
    sign(report)
    report.write_text("invoices|total\n15|900017\n", encoding="utf-8")
    ok, reason = verify(report)
    assert not ok
    assert "被改过" in reason


def test_signature_of_other_file_is_rejected(report: Path, tmp_path: Path):
    sign(report)
    other = tmp_path / "other.txt"
    other.write_text("invoices|total\n15|100017\n", encoding="utf-8")
    token_path(other).write_text(token_path(report).read_text(encoding="utf-8"), encoding="utf-8")
    ok, reason = verify(other)
    assert not ok
    assert "另一个文件" in reason


def test_forged_token_is_rejected(report: Path):
    sign(report)
    tp = token_path(report)
    header, payload, sig = tp.read_text(encoding="utf-8").strip().split(".")
    tp.write_text(f"{header}.{payload}.{sig[:-2]}AA\n", encoding="utf-8")
    ok, reason = verify(report)
    assert not ok
    assert "无效" in reason


def test_expired_signature_is_rejected(report: Path):
    sign(report, ttl=-10)
    ok, reason = verify(report)
    assert not ok
    assert "过期" in reason


def test_missing_signature_file(report: Path):
    ok, reason = verify(report)
    assert not ok
    assert "找不到" in reason


def test_no_secret_refuses_to_sign(report: Path, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.delenv("REPORT_SECRET")
    with pytest.raises(RuntimeError):
        sign(report)
```

<div class="line-notes">

- `from part01.sign_report import sign, token_path, verify` 能这样导入,靠 Day 72 在 `pyproject.toml` 里写的 `pythonpath = ["."]`。
- `SECRET = "report-secret-for-tests-0123456789-abcdef"` 测试专用密钥,41 个字符,够 32。
- `def report(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:` fixture(Day 73):每个测试拿到一个新的临时目录和一份干净的环境变量。
- `monkeypatch.setenv("REPORT_SECRET", SECRET)` Day 74 的 monkeypatch:只在这个测试里设环境变量,测完自动还原,不会污染你终端里 `export` 的那个真密钥。
- `path.write_text("invoices|total\n15|100017\n", encoding="utf-8")` 报表内容用两行小样本,和真实的 `report.txt` 无关,测试不依赖 sqlite3。
- `sign(report)` 签发。下一行 `ok, reason = verify(report)` 验证,`assert ok, reason` 失败时把原因一起打印出来。
- `report.write_text("invoices|total\n15|900017\n", encoding="utf-8")` 签名之后改文件内容:100017 变成 900017。
- `assert "被改过" in reason` 断言原因里有这句话,把「是因为内容被改」和别的拒绝原因分开。
- `token_path(other).write_text(token_path(report).read_text(encoding="utf-8"), encoding="utf-8")` 把 `report.txt.jwt` 复制成 `other.txt.jwt`:令牌是真的,但它属于另一个文件。
- `header, payload, sig = tp.read_text(encoding="utf-8").strip().split(".")` 把令牌拆成三段。
- `tp.write_text(f"{header}.{payload}.{sig[:-2]}AA\n", encoding="utf-8")` 把签名最后两个字符换成 `AA`:伪造。签名对不上,`decode` 抛 `InvalidTokenError`。
- `sign(report, ttl=-10)` `exp` 比 `iat` 早 10 秒,令牌一出生就是过期的,不用等。
- `monkeypatch.delenv("REPORT_SECRET")` 删掉环境变量,模拟服务端没配置。
- `with pytest.raises(RuntimeError):` 断言这一段会抛 `RuntimeError`,没抛就算测试失败(Day 71)。

</div>

```bash
uv run pytest -q
```

<div class="line-notes">

- `uv run pytest -q` 在仓库根目录跑,`-q` 安静模式,每个测试一个点。

</div>

```text
.......                                                                  [100%]
7 passed in 0.13s
```

七个都过。再让它「变红」一次,确认这些测试真的在守着东西:把 `sign_report.py` 里 `verify` 的 `if claims.get("sha256") != digest(path):` 那两行暂时注释掉,重新跑:`test_changed_report_is_rejected` 会失败,因为内容改了、签名还是对的,验证却通过了。其余六个照样绿。这就是「没报错但结果不对」的典型,只有测试能抓到。注释掉的两行记得恢复。

### 小项目用到了本周哪一天

| 小项目里的东西 | 来自 |
| --- | --- |
| `jwt.encode`、`jwt.decode(..., algorithms=["HS256"])`、`exp`、`iat` | Day 84 |
| `ExpiredSignatureError` 写在 `InvalidTokenError` 前面 | Day 84 |
| 密钥从环境变量读、不够长就拒绝 | Day 84(fail closed 来自 Day 82) |
| `hashlib.sha256` 算指纹、`hexdigest()` | Day 84 的 HMAC 一节 |
| `CREATE TABLE`、`SELECT`、`WHERE`、`ORDER BY` | Day 85 |
| 重建 `practice.db`、改数据后还原 | Day 86 |
| `JOIN`、`LEFT JOIN`、`WHERE 右表.id IS NULL` 找孤儿 | Day 87 |
| `count(i.id)`、`coalesce`、`GROUP BY`、`HAVING` | Day 88 |
| `ORDER BY total DESC, c.id` 让顺序稳定(并列时没有保证) | Day 88、89 |
| `EXPLAIN QUERY PLAN`(练习 3) | Day 89 |
| fixture、`monkeypatch.setenv`、`pytest.raises` | Day 73–74 |

## 本周错题与坑清单

这一周踩过的坑,按「看到什么现象 → 真正的原因 → 怎么改」排在一起。

| 看到的现象 | 真正的原因 | 怎么改 | 哪天 |
| --- | --- | --- | --- |
| `DecodeError ... you pass in a value for the "algorithms" argument` | pyjwt 2 强制要求写算法白名单 | `jwt.decode(token, key, algorithms=["HS256"])` | 84 |
| 伪造的 `role: admin` 令牌被服务端接受了 | 服务端用了 `verify_signature: False` | 只在调试脚本里偷看内容时用 | 84 |
| 过期的令牌只提示「令牌无效」 | `except InvalidTokenError` 写在 `ExpiredSignatureError` 前面,父类先接走 | 子类写前面 | 84 |
| `binascii.Error: Incorrect padding` | base64url 去掉了末尾的 `=`,解码前没补 | 补 `"=" * (-len(s) % 4)` | 84 |
| 退出登录后旧令牌照样 200 | JWT 不存服务端,没有「删记录」这回事 | 设短有效期,或者加作废名单 | 84 |
| `WHERE email = NULL` 一行也查不到 | NULL 不等于任何东西,包括它自己 | `IS NULL` | 85 |
| `WHERE plan = "plan"` 返回了全部行 | 双引号在 SQLite 里是列名,不是字符串 | 字符串用单引号 | 85 |
| 查「上海的专业版或企业版」混进了杭州的 | AND 比 OR 先算 | 加括号或改用 `IN` | 85 |
| 整张表的 plan 都变成了专业版 / 整张表被清空 | `UPDATE`、`DELETE` 忘写 `WHERE`,语法合法 | 先写同条件的 `SELECT` 预览;重要改动先备份 | 86 |
| `SET a = 1 AND b = 2` 之后 `a` 变成了 0 | 多列赋值要用逗号,`AND` 把它当成了布尔表达式 | 逗号分隔 | 86 |
| 重跑 `customers.sql` 之后手工加的行不见了 | 脚本只能还原到脚本里写的状态 | 重要数据用 `.backup` | 86 |
| `ambiguous column name: id` | 两张表都有 `id`,没写表前缀 | `别名.列` | 87 |
| 漏写 `ON` 得到 150 行 | 笛卡尔积:15 × 10 | 补 `ON` | 87 |
| 内连接后未付发票从 4 张变成 3 张 | 15 号孤儿发票配不上客户,被丢了 | 想保住谁就让谁放左边,用 `LEFT JOIN` | 87 |
| `LEFT JOIN` 加 `WHERE i.status = ...` 后没发票的客户消失了 | `WHERE` 把右边的 NULL 行筛掉,变回内连接 | 条件放进 `ON` | 87 |
| 没有发票的客户显示「1 张」 | `LEFT JOIN` 后 `count(*)` 数的是行,不是发票 | `count(i.id)` | 88 |
| `misuse of aggregate: sum()` | 聚合函数写进了 `WHERE`,那时还没分组 | 改用 `HAVING` | 88 |
| 平均值 6667 而不是 6667.8 | 整数除整数吞小数 | 用 `avg`,或先乘 `1.0` | 88 |
| `sum` 的结果前端拿到 `null` | 空集求和是 NULL,不是 0 | `coalesce(sum(x), 0)` | 88 |
| 建了索引,计划里还是 `SCAN` | 列被函数或运算包住,或 `LIKE` 以通配符开头 | 让列单独出现在比较的一边 | 89 |
| 有索引的查询比没索引还慢 | 命中了 70% 的行,区分度太低 | 别给只有几种取值的列单独建索引 | 89 |
| 同一条 `ORDER BY ... LIMIT` 加索引后结果行变了 | 排序键有并列,并列行的顺序没有保证 | 再加一个唯一列(`id`)兜底 | 89 |
| 只写 `WHERE status = ...`,组合索引 `(customer_id, status)` 没用上 | 跳过了最左边的列 | 等值条件的列放前面,按最左前缀写 | 89 |

这张表里同样有一半的坑是「**没报错,但结果不对**」,而且比上周更隐蔽:SQL 的坑常常「结果看起来很合理」(1 张发票、6667 元),JWT 的坑是伪造的令牌被当真。对付它们只有三个办法:**核对合计**(分状态的合计加起来要等于总额)、**用 EXPLAIN 看计划**、**写测试钉住行为**。今天的小项目里的第 6 条「对账」就是第一个办法的缩影。

还有一个做法值得养成:**每写一条聚合查询,先心算一下结果应该是什么量级**。15 张发票总额 100017,每张平均 6667,最大的 27860。如果算出来 1000 万,不用看别的,一定是 JOIN 把行乘多了。


## 动手练习

**练习 1(默写):手工 JWT。** 合上文章,不看 Day 84,新建 `part01/jwt_by_hand.py`,写出 `b64url`、`b64url_decode`、`to_part`、`make_token`、`check_token`。要求:签名用 HMAC-SHA256,`check_token` 签名对不上抛 `ValueError`。再写 `tests/test_jwt_by_hand.py` 四个测试:往返一致;和 pyjwt 签出来的令牌一字不差;把第二段换成 `role: admin` 要被拒绝;base64url 没有 `=` 且能还原。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part01/jwt_by_hand.py
import base64
import hashlib
import hmac
import json
from typing import Any

SECRET = b"only-the-server-knows-this-0123456789"


def b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def b64url_decode(text: str) -> bytes:
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


def to_part(obj: dict[str, Any]) -> str:
    return b64url(json.dumps(obj, separators=(",", ":")).encode())


def make_token(payload: dict[str, Any]) -> str:
    signing_input = to_part({"alg": "HS256", "typ": "JWT"}) + "." + to_part(payload)
    sig = hmac.new(SECRET, signing_input.encode(), hashlib.sha256).digest()
    return signing_input + "." + b64url(sig)


def check_token(token: str) -> dict[str, Any]:
    header_part, payload_part, sig_part = token.split(".")
    signing_input = header_part + "." + payload_part
    expected = hmac.new(SECRET, signing_input.encode(), hashlib.sha256).digest()
    if not hmac.compare_digest(b64url_decode(sig_part), expected):
        raise ValueError("签名对不上,令牌被改过或者不是我们签的")
    return json.loads(b64url_decode(payload_part))
```

<div class="line-notes">

- `SECRET = b"only-the-server-knows-this-0123456789"` 密钥是 bytes(字面量前面的 `b`),`hmac.new` 要 bytes。
- `return base64.urlsafe_b64encode(data).rstrip(b"=").decode()` 编码成 base64url,去掉末尾的 `=`(JWT 规定不带),再从 bytes 转回 str。`b"\xfb\xff"` 编出来是 `-_8=`,去掉 `=` 后是 `-_8`。
- `return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))` 解码前补回 `=`。`-len(text) % 4` 是「还差几个字符凑够 4 的倍数」:`-_8` 长 3,`-3 % 4 = 1`,补 1 个。忘了这一步就是 `Incorrect padding`。
- `return b64url(json.dumps(obj, separators=(",", ":")).encode())` 先转成紧凑的 JSON(没有空格),再编码。紧凑格式是为了和 pyjwt 一字不差。
- `signing_input = to_part({"alg": "HS256", "typ": "JWT"}) + "." + to_part(payload)` 要签名的就是「第一段.第二段」这个字符串。
- `sig = hmac.new(SECRET, signing_input.encode(), hashlib.sha256).digest()` 对它做 HMAC,取原始字节。
- `return signing_input + "." + b64url(sig)` 第三段是签名的 base64url。
- `header_part, payload_part, sig_part = token.split(".")` 按点拆成三段。令牌少于或多于三段这里会直接抛 `ValueError`。
- `expected = hmac.new(SECRET, signing_input.encode(), hashlib.sha256).digest()` 校验方**重新算一遍**签名,不是去「解开」令牌里的签名。
- `if not hmac.compare_digest(b64url_decode(sig_part), expected):` 用恒定时间比较(Day 82),不用 `==`。
- `return json.loads(b64url_decode(payload_part))` 签名对上了,才把第二段解开返回。

</div>

```python
# agent-zero-lab/tests/test_jwt_by_hand.py
import jwt
import pytest

from part01.jwt_by_hand import SECRET, b64url, b64url_decode, check_token, make_token

PAYLOAD = {"sub": "alice", "role": "support"}


def test_round_trip():
    assert check_token(make_token(PAYLOAD)) == PAYLOAD


def test_same_as_pyjwt():
    assert make_token(PAYLOAD) == jwt.encode(PAYLOAD, SECRET.decode(), algorithm="HS256")


def test_changed_payload_is_rejected():
    header, payload, sig = make_token(PAYLOAD).split(".")
    fake = b64url(b'{"sub":"alice","role":"admin"}')
    with pytest.raises(ValueError):
        check_token(f"{header}.{fake}.{sig}")


def test_base64url_round_trip_needs_padding():
    raw = b"\xfb\xff"
    assert "=" not in b64url(raw)
    assert b64url_decode(b64url(raw)) == raw
```

<div class="line-notes">

- `import jwt` 用 pyjwt 当「标准答案」来对照你手写的。
- `PAYLOAD = {"sub": "alice", "role": "support"}` 和 Day 84 同一份内容。
- `assert make_token(PAYLOAD) == jwt.encode(PAYLOAD, SECRET.decode(), algorithm="HS256")` 手写的令牌和 pyjwt 签出来的完全相同,一个字符都不差。`SECRET.decode()` 因为 `jwt.encode` 收 str。
- `header, payload, sig = make_token(PAYLOAD).split(".")` 拆开,保留真的头和真的签名。
- `fake = b64url(b'{"sub":"alice","role":"admin"}')` alice 自己造的新内容,编码成第二段。
- `with pytest.raises(ValueError):` 真签名配假内容,必须被拒绝。
- `raw = b"\xfb\xff"` 两个字节,编出来要补 `=` 的最短例子。
- `assert "=" not in b64url(raw)` 编码结果没有 `=`。
- `assert b64url_decode(b64url(raw)) == raw` 补回 `=` 之后能还原成原来的字节。

</div>

```bash
uv run pytest -q tests/test_jwt_by_hand.py -v
```

<div class="line-notes">

- `-v` 让 pytest 把每个测试的名字都列出来,而不是一串点。

</div>

实跑输出:

```text
============================= test session starts ==============================
platform darwin -- Python 3.12.13, pytest-9.1.1, pluggy-1.7.0
rootdir: /Users/你/agent-zero-lab
configfile: pyproject.toml
collected 4 items

tests/test_jwt_by_hand.py ....                                           [100%]

============================== 4 passed in 0.06s ===============================
```

四个都过,包括「和 pyjwt 一字不差」。默写时最常漏的两处:`rstrip(b"=")` 之后解码忘了补 `=`;`check_token` 里用 `==` 比较签名而不是 `compare_digest`(功能对,安全上留了时序攻击的口子)。

</details>

**练习 2(默写):三条 SQL。** 合上文章,对 `practice.db` 写三条查询:①每家客户的发票张数和合计,**没发票的客户也要显示 0 和 0**,金额从高到低,同额按客户 id 排;②发票合计超过 3000 的客户;③没有任何发票的客户的公司名。

<details><summary>参考答案</summary>

```bash
cd /Users/你/agent-zero-lab/part01/sql
rm -f practice.db
sqlite3 practice.db < customers.sql
sqlite3 practice.db < invoices.sql
sqlite3 -header practice.db "
SELECT c.id, c.company, count(i.id) AS invoices, coalesce(sum(i.amount), 0) AS total
FROM customers c
LEFT JOIN invoices i ON i.customer_id = c.id
GROUP BY c.id, c.company
ORDER BY total DESC, c.id;"
sqlite3 -header practice.db "
SELECT c.company, sum(i.amount) AS total
FROM customers c
JOIN invoices i ON i.customer_id = c.id
GROUP BY c.id, c.company
HAVING sum(i.amount) > 3000
ORDER BY total DESC;"
sqlite3 -header practice.db "
SELECT c.company
FROM customers c
LEFT JOIN invoices i ON i.customer_id = c.id
WHERE i.id IS NULL;"
```

<div class="line-notes">

- `sqlite3 practice.db < invoices.sql` 前面三行是还原:先删掉旧库,再重建两张表。
- `SELECT c.id, c.company, count(i.id) AS invoices, coalesce(sum(i.amount), 0) AS total` ①:`count(i.id)` 数右表主键,没发票得 0,而不是 `count(*)` 的 1;`coalesce(sum(...), 0)` 把 NULL 换成 0。
- `LEFT JOIN invoices i ON i.customer_id = c.id` 保住所有 10 家客户。
- `GROUP BY c.id, c.company` 每家客户一堆。
- `ORDER BY total DESC, c.id;` 金额降序,同额按 id。
- `JOIN invoices i ON i.customer_id = c.id` ②:这里是内连接,没发票的客户本来就不会过 3000,不用保住。
- `HAVING sum(i.amount) > 3000` 筛分好的组,聚合函数不能写进 `WHERE`。
- `LEFT JOIN invoices i ON i.customer_id = c.id` ③:找「没有」,还是左连接。
- `WHERE i.id IS NULL;` 右表主键是 NULL,说明这家客户一张发票也没配上。

</div>

实跑输出:

```text
id|company|invoices|total
5|启明科技|2|55720
3|远山物流|2|33830
1|星河餐饮|3|3564
8|云杉律所|2|3564
4|蓝鲸教育|1|1980
9|北辰贸易|1|891
2|青木设计|2|234
7|半岛咖啡|1|78
6|禾丰农业|0|0
10|小满花店|0|0
company|total
启明科技|55720
远山物流|33830
星河餐饮|3564
云杉律所|3564
company
禾丰农业
小满花店
```

三条和 Day 87、88 的结果一致。默写时最常漏的是:①里的 `count(i.id)` 写成 `count(*)`(禾丰农业会显示 1);①里忘了 `coalesce`(total 变成空);②里把 `sum(...) > 3000` 写进 `WHERE`(报 `misuse of aggregate`)。

</details>

**练习 3(观察题):数据一变,签名就失效。** 在 `practice.db` 里把 3 号发票改成已付(`UPDATE invoices SET status = 'paid' WHERE id = 3;`),重新生成报表,对比新旧报表的差别,再用**旧签名**验证新报表,然后重新签名再验证,最后还原数据库。

<details><summary>参考答案</summary>

(沿用前面 `export` 过的 `REPORT_SECRET`;如果是新开的终端窗口,先重新 `export` 一次。)

```bash
cd /Users/你/agent-zero-lab
sqlite3 part01/sql/practice.db < part01/sql/customers.sql
sqlite3 part01/sql/practice.db < part01/sql/invoices.sql
sqlite3 -header part01/sql/practice.db < part01/sql/audit.sql > part01/sql/report.txt
uv run python -m part01.sign_report sign part01/sql/report.txt
sqlite3 part01/sql/practice.db "UPDATE invoices SET status = 'paid' WHERE id = 3;"
cp part01/sql/report.txt part01/sql/report_old.txt
sqlite3 -header part01/sql/practice.db < part01/sql/audit.sql > part01/sql/report.txt
diff part01/sql/report_old.txt part01/sql/report.txt
uv run python -m part01.sign_report verify part01/sql/report.txt; echo "退出码 $?"
uv run python -m part01.sign_report sign part01/sql/report.txt
uv run python -m part01.sign_report verify part01/sql/report.txt; echo "退出码 $?"
sqlite3 part01/sql/practice.db < part01/sql/invoices.sql
```

<div class="line-notes">

- `sqlite3 part01/sql/practice.db < part01/sql/customers.sql` 前两行还原数据库,接着第三行生成原始报表,第四行签名。
- `sqlite3 part01/sql/practice.db "UPDATE invoices SET status = 'paid' WHERE id = 3;"` Day 86 的带 `WHERE` 的 `UPDATE`:3 号发票(星河餐饮 9 月 1 日,1188 元)从未付变已付。
- `cp part01/sql/report.txt part01/sql/report_old.txt` 把旧报表留一份,方便对比。
- `diff part01/sql/report_old.txt part01/sql/report.txt` `diff` 逐行比较两个文件,只打印不同的行。`6,7c6,7` 的意思是「旧文件的第 6、7 行被改成了新文件的第 6、7 行」,`<` 开头是旧的,`>` 开头是新的。
- `uv run python -m part01.sign_report verify part01/sql/report.txt; echo "退出码 $?"` 第一次验证用的还是**旧报表的签名**。
- `uv run python -m part01.sign_report sign part01/sql/report.txt` 对新报表重新签名,覆盖旧的 `.jwt`。
- 第二次 `verify` 这次应当通过。
- 最后一行 `sqlite3 part01/sql/practice.db < part01/sql/invoices.sql` 把数据库还原成 3 号发票是未付的样子。

</div>

实跑输出:

```text
已签名 → part01/sql/report.txt.jwt
6,7c6,7
< paid|10|79898
< unpaid|4|20041
---
> paid|11|81086
> unpaid|3|18853
拒绝:报表内容和签名时不一样,被改过
退出码 1
已签名 → part01/sql/report.txt.jwt
通过:报表完好,签发于 2026-10-23 11:45
退出码 0
```

`diff` 只报了两行:已付从 10 张 79898 变成 11 张 81086(多了 1188),未付从 4 张 20041 变成 3 张 18853(少了 1188);其他段落没动,因为每家客户的发票总额和总数没变,只是状态变了。旧签名当然验不过:报表内容变了,摘要就不是签名时那个。**这是签名想要的行为,也是它的限制:它只能说「这份文件和签名时不一样」,没法区分「有人恶意篡改」和「数据本来就更新了」。** 要给数据正常更新留出路,办法是数据变了就重新出报表、重新签名,验证方永远只认最新那份。

</details>

**练习 4(找 bug):四处「没报错但不对」。** 下面四处,每一处先预测会发生什么,再跑一遍确认,并改对。①`SELECT c.company, count(*) AS invoices FROM customers c LEFT JOIN invoices i ON i.customer_id = c.id WHERE c.id IN (6, 10) GROUP BY c.id, c.company;`(想数发票张数)②`SELECT customer_id, sum(amount) FROM invoices WHERE sum(amount) > 3000 GROUP BY customer_id;` ③`jwt.decode(token, secret)`(想校验一个令牌)④10 万行的 `big_invoices` 上有 `issued_at` 的索引,查 `WHERE substr(issued_at, 1, 7) = '2026-09'`。

<details><summary>参考答案</summary>

①②在 `part01/sql` 目录跑:

```bash
cd /Users/你/agent-zero-lab/part01/sql
sqlite3 -header practice.db "SELECT c.company, count(*) AS invoices FROM customers c LEFT JOIN invoices i ON i.customer_id = c.id WHERE c.id IN (6, 10) GROUP BY c.id, c.company;"
sqlite3 practice.db "SELECT customer_id, sum(amount) FROM invoices WHERE sum(amount) > 3000 GROUP BY customer_id;"
```

<div class="line-notes">

- `LEFT JOIN invoices i ON i.customer_id = c.id WHERE c.id IN (6, 10)` ①:只看没有发票的 6 号和 10 号客户,`count(*)` 数的是行。
- `WHERE sum(amount) > 3000 GROUP BY customer_id;` ②:聚合函数写在了 `WHERE` 里。

</div>

```text
company|invoices
禾丰农业|1
小满花店|1
Error: in prepare, misuse of aggregate: sum()
  LECT customer_id, sum(amount) FROM invoices WHERE sum(amount) > 3000 GROUP BY 
                                      error here ---^
```

① 没有发票的两家客户显示「1 张」。左连接给它们各留了一行,`count(*)` 数的是行。改成 `count(i.id)` 就是 0。② `WHERE` 在分组之前一行行筛,那时还没有「这个客户的合计」。改成 `GROUP BY customer_id HAVING sum(amount) > 3000`。

③④在仓库根目录跑(④先按 Day 89 造一个 10 万行的库):

```bash
cd /Users/你/agent-zero-lab
uv run python -c "
import jwt
t = jwt.encode({'sub': 'alice'}, 'only-the-server-knows-this-0123456789', algorithm='HS256')
try:
    jwt.decode(t, 'only-the-server-knows-this-0123456789')
except jwt.InvalidTokenError as e:
    print(type(e).__name__, e)
"
cd part01/sql
rm -f ex.db
sqlite3 ex.db ".parameter set @rows 100000" ".read make_big.sql"
sqlite3 ex.db "CREATE INDEX idx_issued ON big_invoices (issued_at); EXPLAIN QUERY PLAN SELECT count(*), sum(amount) FROM big_invoices WHERE substr(issued_at, 1, 7) = '2026-09';"
sqlite3 ex.db "EXPLAIN QUERY PLAN SELECT count(*), sum(amount) FROM big_invoices WHERE issued_at >= '2026-09-01' AND issued_at < '2026-10-01';"
```

<div class="line-notes">

- `uv run python -c "` 用 `-c` 在命令行里直接跑几行 Python,多行字符串里的缩进要保留。
- `t = jwt.encode({'sub': 'alice'}, 'only-the-server-knows-this-0123456789', algorithm='HS256')` 先签一个正常的令牌。
- `jwt.decode(t, 'only-the-server-knows-this-0123456789')` ③:忘了写 `algorithms`。
- `print(type(e).__name__, e)` 打印异常的类名和消息。
- `sqlite3 ex.db ".parameter set @rows 100000" ".read make_big.sql"` ④:Day 89 的造数文件,库里没有任何索引。
- `CREATE INDEX idx_issued ON big_invoices (issued_at);` 同一条命令里先建好索引,再用 `EXPLAIN QUERY PLAN` 看套了 `substr` 的查询怎么走。
- 最后一条把条件改写成范围:`>= '2026-09-01' AND < '2026-10-01'`。

</div>

```text
DecodeError It is required that you pass in a value for the "algorithms" argument when calling decode().
QUERY PLAN
`--SCAN big_invoices
QUERY PLAN
`--SEARCH big_invoices USING INDEX idx_issued (issued_at>? AND issued_at<?)
```

③ pyjwt 2 以后不写 `algorithms` 直接抛 `DecodeError`(这算好的:不报错而悄悄放行才是真危险,比如关掉验签)。改成 `jwt.decode(t, secret, algorithms=["HS256"])`。④ 套了 `substr` 的写法是 `SCAN`,索引白建;改写成范围条件,计划变成 `SEARCH ... (issued_at>? AND issued_at<?)`。

</details>

**练习 5(开放题):让报表能被撤销。** JWT 签发之后没法让它提前作废(Day 84)。可是报表签出去之后,发现这一份有问题,想宣布它作废,哪怕签名还在有效期内。给项目加一个撤销功能:新建 `part01/revoke.py`,有 `revoke(path, revoked_file)` 把报表的摘要记进一个撤销清单文件,和 `verify_not_revoked(path, revoked_file)`:先做原来的 `verify`,通过之后再查摘要是不是在清单里。配三个测试。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part01/revoke.py
from pathlib import Path

from part01.sign_report import digest, verify


def revoke(path: Path, revoked_file: Path) -> None:
    with revoked_file.open("a", encoding="utf-8") as f:
        _ = f.write(digest(path) + "\n")


def verify_not_revoked(path: Path, revoked_file: Path) -> tuple[bool, str]:
    ok, reason = verify(path)
    if not ok:
        return ok, reason
    revoked = set(revoked_file.read_text(encoding="utf-8").split()) if revoked_file.exists() else set()
    if digest(path) in revoked:
        return False, "这份报表已经被撤销"
    return True, reason
```

<div class="line-notes">

- `from part01.sign_report import digest, verify` 直接复用小项目里的两个函数,不复制代码。
- `with revoked_file.open("a", encoding="utf-8") as f:` `"a"` 是追加模式(append),文件不存在会新建,已有内容不动。撤销清单只增不减。
- `_ = f.write(digest(path) + "\n")` 记下这份报表当前的摘要,一行一个。前面的 `_ =` 是把 `write` 返回的字符数丢掉,让类型检查器不抱怨「结果没用上」。
- `ok, reason = verify(path)` 先走原来的全部检查:签名、过期、文件名、摘要。
- `if not ok:` 没通过就原样返回,不用再查清单。
- `revoked = set(revoked_file.read_text(encoding="utf-8").split()) if revoked_file.exists() else set()` 清单文件存在就读出所有摘要变成集合(`split()` 按空白拆成列表),不存在就是空集合。集合查成员很快,相当于 JS 的 `Set.has`。
- `if digest(path) in revoked:` 摘要在清单里,就是被撤销的。
- `return False, "这份报表已经被撤销"` 注意撤销记的是**摘要**:同一份内容无论签几次都被拒绝;内容一变(重新出报表),摘要不同,就不在清单里了。

</div>

```python
# agent-zero-lab/tests/test_revoke.py
from pathlib import Path

import pytest

from part01.revoke import revoke, verify_not_revoked
from part01.sign_report import sign

SECRET = "report-secret-for-tests-0123456789-abcdef"


@pytest.fixture
def signed(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    monkeypatch.setenv("REPORT_SECRET", SECRET)
    path = tmp_path / "report.txt"
    path.write_text("invoices|total\n15|100017\n", encoding="utf-8")
    sign(path)
    return path


def test_not_revoked_passes(signed: Path, tmp_path: Path):
    ok, _ = verify_not_revoked(signed, tmp_path / "revoked.txt")
    assert ok


def test_revoked_is_rejected(signed: Path, tmp_path: Path):
    revoked_file = tmp_path / "revoked.txt"
    revoke(signed, revoked_file)
    ok, reason = verify_not_revoked(signed, revoked_file)
    assert not ok
    assert "撤销" in reason


def test_revoke_only_affects_that_content(signed: Path, tmp_path: Path):
    revoked_file = tmp_path / "revoked.txt"
    revoke(signed, revoked_file)
    signed.write_text("invoices|total\n15|100018\n", encoding="utf-8")
    sign(signed)
    ok, _ = verify_not_revoked(signed, revoked_file)
    assert ok
```

<div class="line-notes">

- `def signed(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:` 这个 fixture 直接给出一份**已经签好名**的报表。
- `sign(path)` 签发,放在 fixture 里,各测试都不用重复。
- `ok, _ = verify_not_revoked(signed, tmp_path / "revoked.txt")` 第一个测试:清单文件根本不存在,应当通过。`_` 表示不关心原因。
- `revoke(signed, revoked_file)` 撤销这份报表。
- `assert "撤销" in reason` 确认被拒绝的原因就是撤销,不是别的。
- `signed.write_text("invoices|total\n15|100018\n", encoding="utf-8")` 第三个测试:内容改了一个数(100017 变成 100018)再重新签名,摘要变了,不受旧撤销影响。

</div>

```bash
uv run pytest -q
uv run basedpyright
```

<div class="line-notes">

- `uv run pytest -q` 跑全部测试,包括今天前面写的 4 个加 7 个和这里的 3 个。
- `uv run basedpyright` 类型检查整个项目。

</div>

```text
..............                                                           [100%]
14 passed in 0.10s
0 errors, 0 warnings, 0 notes
```

14 个测试(JWT 手写 4 个、报表签名 7 个、撤销 3 个)全部通过,类型检查 0 错误。这个方案的代价要说清:撤销清单是**服务端要保存的状态**,正是 Day 84 里 JWT「不存表」的反面。现实里的选择永远是这样的取舍:要么令牌有效期设短、接受它无法提前作废;要么加一份清单,接受它带来的存储和同步。清单还可以只保留「尚未过期的」那些摘要,过期的令牌本来就验不过,不用再记。

</details>

验收标准:五道题都在自己终端里跑通;练习 1、练习 2 是**合上文章**写出来并跑通的;能解释「为什么签名要同时核对文件名和摘要」「为什么 `GROUP BY` 之后还要加 `ORDER BY ..., c.id` 才能保证摘要不变」「为什么撤销要记摘要而不是记令牌」。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 摘要(digest) | 对文件算出的固定长度「指纹」,今天用 SHA-256,64 个十六进制字符 |
| `shasum -a 256` | macOS 自带命令,算文件的 SHA-256,用来和 Python 算的对照 |
| 审计报表 | 把账单数据汇总成给人对账的表格,今天的 `report.txt` |
| 对账 | 把两种算法得到的合计放在一起比,对不上就说明有数据遗漏或重复 |
| 孤儿发票 | 客户编号在客户表里找不到买主的发票(15 号) |
| 重定向(`>`) | 把命令的输出写进文件而不是打印在屏幕上 |
| `sqlite3 -header` | 让查询结果带上列名 |
| `.print` | sqlite3 的点命令,打印一行文字,用作报表小标题 |
| `diff` | 比较两个文件、只显示不同的行的命令 |
| 退出码 | 程序结束时返回给调用者的数字,0 表示成功,非 0 表示失败 |
| `sys.argv` | Python 里命令行参数的列表,`argv[0]` 是脚本名 |
| `claims` | JWT 第二段里的那些键值,今天装了 `file`、`sha256`、`iat`、`exp` |
| `iat` / `exp` | JWT 标准字段:签发时间、过期时间,都是 Unix 秒 |
| 撤销清单(denylist) | 服务端保存的「已作废」记录,让不存状态的令牌也能被提前作废 |
| 追加模式(`"a"`) | 打开文件往末尾写,不覆盖原有内容 |

## 常见误区

**报表输出的顺序没有保证就拿去算摘要。** 并列的两行(星河餐饮和云杉律所都是 3564)不写 `c.id` 兜底,执行方式一变顺序可能就变,摘要跟着变,验证莫名其妙失败。要给文件算摘要的查询,`ORDER BY` 要排到「没有并列」为止。

**只签摘要不签文件名。** 签名是真的,但可以把 A 报表的 `.jwt` 复制给 B 报表。令牌里要带文件名,验证时核对(测试里有)。

**以为签名能防止「别人看到」。** `.jwt` 的第二段谁都能解出来(实测 `sha256`、`file`、`iat`、`exp` 一览无余)。它防的是**篡改**,不是**偷看**。需要保密的内容不要放进 claims。

**验证只看签名,不核对文件内容。** 内容改了,令牌本身还是真的。令牌保证的是「摘要没被改」,要靠重算文件摘要才能保证「文件没被改」,少一环都不行。

**签名密钥写进代码。** 实测 `REPORT_SECRET` 没配或短于 32 个字符,`sign` 和 `verify` 都抛 `RuntimeError`。fail closed:不要「没密钥就先放行」。

**`verify` 里 `except` 的顺序。** `ExpiredSignatureError` 是 `InvalidTokenError` 的子类,必须写在前面,否则过期的提示永远出不来。

**把「改一个数就验不过」当成数据一变就坏了。** 练习 3 看到:数据正常更新后旧签名就失效,这是预期。要「更新」就重新出报表、重新签名。

**复习日只看不写。** 看懂和写出来是两回事,练习 1 和练习 2 请真的合上文章默写。写不出的那几行,就是你这周真正的薄弱点。

## 学习资料

### 文档与文章

- [PyJWT 官方文档 · Usage Examples(英文)](https://pyjwt.readthedocs.io/en/stable/usage.html):`encode`、`decode`、过期时间 `exp`、`iat`、`algorithms` 白名单的官方例子,对照今天的 `sign_report.py`。
- [JWT 官网 · jwt.io 介绍(英文)](https://jwt.io/introduction):三段结构的图文说明,页面里可以直接粘贴令牌看内容(演示用,生产环境的令牌别贴)。
- [Python 标准库 · hashlib(英文)](https://docs.python.org/3/library/hashlib.html):`sha256`、`hexdigest` 的用法。
- [SQLite 官方 · Aggregate Functions(英文)](https://sqlite.org/lang_aggfunc.html):Day 88 的聚合函数,默写前可以回看。
- [SQLite 官方 · The SQLite Query Planner(英文)](https://sqlite.org/queryplanner.html):Day 89 的索引和执行计划的官方版本。
- [SQLBolt](https://sqlbolt.com/):浏览器里做的 SQL 练习,按课顺序做完,可以当作本周的复习题库。
- [菜鸟教程 · SQLite 教程](https://www.runoob.com/sqlite/sqlite-tutorial.html):中文,语法速查,把这一周用到的语句都能找到。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1yw4m1S7Be&autoplay=0&high_quality=1" title="【SQL数据库】SQL两小时半快速入门到精通 建议反复观看 学不会自我反省" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>程序不打烊 · 【SQL数据库】SQL 两小时半快速入门到精通 · 约 2 小时 46 分,播放 76 万,2024 年发布。长,不用一次看完:复习时挑查询、分组、连接几章回看,对照这周的第 3、4 步。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1iG4k6JE41&autoplay=0&high_quality=1" title="普通用户改一个字段变管理员？JWT 签名验证缺陷" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>网络安全视野 · 普通用户改一个字段变管理员?JWT 签名验证缺陷 · 约 3 分钟,播放 1000 多。短,专门演示「服务端不验签名、改个字段变管理员」,和 Day 84 第 5 步的坑三、今天练习里的伪造令牌是同一个问题。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/HXV3zeQKqGY" title="SQL Tutorial - Full Database Course for Beginners" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>freeCodeCamp.org · SQL Tutorial - Full Database Course for Beginners · 英文,可开字幕,约 4 小时。完整课程,同样不用一次看完,挑建表、查询、连接、聚合回看。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/vdzB5Rraeb4" title="HMAC & Message Authentication Codes (MACs) - Why Hashing alone is NOT ENOUGH for data integrity" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>JayPMedia · HMAC &amp; Message Authentication Codes (MACs) - Why Hashing alone is NOT ENOUGH for data integrity · 英文,可开字幕。讲清楚为什么只有哈希不够、要带密钥,是 Day 84 第 2 步和今天小项目的原理。</figcaption>
</figure>

### 书籍

- Ben Forta,《SQL必知必会》(第 5 版),人民邮电出版社(原书 *Sams Teach Yourself SQL in 10 Minutes a Day*,5th ed.,2019)。薄,每课十分钟,这周 SQL 的全部语句都能在里面按顺序对上。
- Markus Winand,《SQL Performance Explained》,2012 年自出版(英文)。Day 89 索引一节想深入时读。

### 开源项目与代码

今天这组不需要。复习日读自己写的代码就够了:把 `sign_report.py` 和 Day 84 的 `jwt_api.py` 放在一起看,两者是同一个套路(密钥从环境变量读、fail closed、`decode` 带 `algorithms`),只是令牌里装的东西不同。

## 自测

1. JWT 三段里,哪两段是「谁都能读」的,签名保护的是什么?

<details><summary>答案</summary>

前两段(header 和 payload)只是 base64url 编码,谁都能解出来读。签名是服务端用密钥对前两段做 HMAC-SHA256 的结果,保护的是「前两段一个字都没被改过」,不保护「别人看不到」。所以不能往 payload 里放敏感信息。

</details>

2. 想列出所有客户和各自的发票张数(没发票的显示 0),SQL 里要用哪几个关键点?为什么?

<details><summary>答案</summary>

`LEFT JOIN`(保住没有发票的客户)、`count(i.id)`(数右表主键,没配上时是 NULL 不被数,得 0;写 `count(*)` 会数成 1)、`GROUP BY c.id, c.company`(每家客户一堆)。要显示金额还要 `coalesce(sum(i.amount), 0)`,因为 `sum` 对没有行的组返回 NULL。

</details>

3. 报表脚本里验证为什么要同时核对「令牌里的文件名」和「令牌里的 sha256 与重新算出的 sha256」?各挡住什么?

<details><summary>答案</summary>

核对文件名挡住「张冠李戴」:把 A 报表合法的签名复制给 B 报表。核对摘要挡住「内容被改」:文件改了一个字,重新算的摘要就变了。只核对签名本身,这两种都防不住,因为令牌是真的。

</details>

4. 一条按客户汇总的查询在 `ORDER BY total DESC` 之后输出顺序偶尔会变,会给今天的项目造成什么问题?怎么修?

<details><summary>答案</summary>

如果两家客户合计相同(星河餐饮和云杉律所都是 3564),它们的先后没有保证。顺序一变,报表文件内容变了,SHA-256 摘要也变,签名验证就莫名失败。修法:在 `ORDER BY` 里加一个唯一列兜底:`ORDER BY total DESC, c.id`。

</details>

5. 面试题:你的系统给每份导出报表签了 JWT,有效期 7 天。运营发现今天发出去的一份报表数据有误,要立刻让它作废。JWT 不存服务端,怎么办?各方案的代价是什么?

<details><summary>答案</summary>

三条路。一是接受它,等 7 天过期:代价是这 7 天里有人拿旧报表当真,所以有效期应当设短。二是加撤销清单:服务端保存已撤销报表的摘要(或 JWT 的 `jti` 编号),验证时查一下(今天练习 5),代价是多了服务端状态、要保证清单在多台机器上同步,清单可以只保留尚未过期的条目来控制大小。三是不让令牌承担「是否有效」的判断,验证方每次回源查数据库里这份报表的状态,代价是失去了「不用查表」的好处,又回到 session 的做法。多数场景选一加二的组合:有效期设短,加一份小清单应对紧急撤销。

</details>

6. 面试题:你写了一个「问数 Agent」,模型会生成 SQL 并执行。结合这周学的,你会在执行前后各加哪些检查?

<details><summary>答案</summary>

执行前:用只读账号;跑 `EXPLAIN`,计划里对大表有 `SCAN`/`Seq Scan` 就拒绝并把计划反馈给模型改写(Day 89 练习 5);用 SQL 解析器检查 `SELECT` 里有没有不在 `GROUP BY` 里的裸列(Day 88);拒绝 `UPDATE`/`DELETE`(Day 86 的忘写 `WHERE` 事故);加 `LIMIT` 和超时。执行后:核对合计(分状态的合计加起来要等于总额,今天报表的第 6 条);对 `LEFT JOIN` 加 `count(*)` 这种「数字像模像样但不对」的写法,在评测集里放专门的用例;把 SQL 本身连同结果一起返回,让人能复核。Day 291 起会真的做这个 Agent。

</details>

## 明天预告

Day 91 · SQL(六):事务、主键外键和约束。今天的报表里第 5 条找出了 15 号孤儿发票,客户编号 11 在客户表里根本不存在,却能存进库里,因为 `invoices` 表没有任何约束挡着它。明天先补上这一块:主键、外键、`UNIQUE`、`CHECK` 这些约束怎么让数据库替你挡住脏数据(顺便踩一个 SQLite 默认不开外键检查的坑);再学事务,一次转账扣了款却没入账,中途出错怎么用 `BEGIN`、`COMMIT`、`ROLLBACK` 整个撤回。
