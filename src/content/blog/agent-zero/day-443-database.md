---
title: 'Day 443 · 搭骨架(三):数据库'
description: '写 db/schema.sql,把业务表(客户、订阅、账单、退款申请、工单)和知识库表(文章、文本块、向量列)建进 Postgres,用外键、CHECK、NOT NULL、numeric 让错误数据写不进去。再写 db.py 的 connect(),实测「vector type not found」这个先有鸡还是先有蛋的坑,用 init_db.py 反复建表,最后做一次迁移:表建好之后加一列。'
pubDate: 2026-10-27
regime: none
tags: ['capstone', 'supportpilot', 'postgres', 'pgvector', 'schema', 'psycopg', 'agent-zero']
series: 'agent-zero'
day: 443
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 442](/blog/agent-zero/day-442-config/) 写好了 `Settings`:模型地址、密钥、单价、业务阈值都从环境变量和 `.env` 里读,配错在启动时就炸。里面已经留了两项给今天用:`database_url`(连哪个库)和 `emb_dim`(向量有多少维)。

今天轮到数据。SupportPilot 要记的东西很多:客户是谁、买了什么套餐、开过哪些账单、哪些退款在等人批、历史工单怎么处理的,还有帮助中心的文章和它们的向量。先把装这些东西的表建出来,并且**建得严**:让 Agent 就算犯错,错误的数据也写不进数据库。

## 今天要解决的问题

今天的新东西是两个:**表设计**(哪些列、什么类型、加哪些约束)和**连接封装**(`connect()` 为什么要这么写)。SQL 本身你在 [Day 85](/blog/agent-zero/day-085-sql-1/) 到 [Day 91](/blog/agent-zero/day-091-sql-6/) 学过,Postgres 和 pgvector 在 [Day 228](/blog/agent-zero/day-228-postgres-basics/)、[Day 229](/blog/agent-zero/day-229-pgvector-1/) 学过,今天不重讲语法,只讲为什么这样设计。学完你应该能:

1. 写出 `db/schema.sql`,说清每张表是干什么的、外键和 `CHECK` 各拦住哪一类错误。
2. 用 `init_db.py` 把表建进一个新库,重复运行也不出错;用 `psql` 看到 7 张业务表加 2 张知识库表。
3. 写出 `connect()`,解释 `autocommit`、`dict_row`、`register_vector` 各自的作用,并认出「vector type not found」这个报错的原因。
4. 做一次迁移:表已经建好、里面有数据,要加一列,不删库不丢数据。
5. 写 3 条不连库的表结构测试和 4 条连库的约束测试,后者在连不上库时自动跳过。

预计用时 3 小时。前置:[Day 441](/blog/agent-zero/day-441-repo-init/) 的仓库、[Day 442](/blog/agent-zero/day-442-config/) 的 `Settings`、Day 85–91 的 SQL、Day 228–229 的 Postgres 和 pgvector。今天不调模型,花费 0 元。

学法:先对照逐行敲一遍(不复制粘贴)并跑通;第二天合上文章,把 `connect()` 和 `kb.chunks` 那张表默写出来;做练习,做不出再展开参考答案,看完关掉重写一遍。

**关于环境的一句话。** 本机没有 Docker 的话,用 Postgres.app(Day 228 装过,端口 5432)。我自己就是这样:在 Postgres.app 里新建了一个临时库跑完全部内容,文中命令里写的库名是 `supportpilot`,我实际用的是另一个临时库名,但输出里不出现库名,所以对你没有影响。`docker-compose.yml` 那一节我**没有实跑**(本机没有 Docker),只能保证语法和镜像标签是对的。两条路二选一,不要同时开,它们会抢 5432 端口。

## 先从前端看:表是什么

你的前端里有 TypeScript 的 `interface Customer { id: string; email: string; isVip: boolean }`,它描述数据的形状,但只在编译时有效:运行时从接口拿回来一个缺字段的 JSON,TS 不会拦你。数据库的表是同一种东西,但是**运行时强制执行**的:一行数据只要不符合表的定义,就写不进去。

这一点对 Agent 系统特别重要。模型会编出一个看起来合理的值:套餐叫 `gold`、状态叫 `paid?`、给一个不存在的客户建退款单。你可以在提示词里写一百句「只能用这四种套餐」,但最稳的是让数据库自己拒绝。越底层拦住的错误,越不用指望上层的提示词。

| 前端里的东西 | 数据库里对应的 | 谁来强制 |
| --- | --- | --- |
| `interface` 里的字段类型 | 列类型(`text`、`numeric`、`date`…) | 数据库,运行时 |
| `email: string`(不能为空) | `NOT NULL` | 数据库 |
| `"free" \| "pro"` 字面量联合类型 | `CHECK (plan IN ('free','pro'))` | 数据库 |
| 对象里引用另一个对象的 id | `REFERENCES 另一张表(id)` 外键 | 数据库 |
| 数组里的 id 不能重复 | `PRIMARY KEY` / `UNIQUE` | 数据库 |

## 第一步:准备一个空库

用 Postgres.app 的话,先确认它在跑(菜单栏有大象图标,点 Start),然后建库:

```bash
createdb supportpilot
psql supportpilot -c "SELECT 1"
```

`createdb` 成功时什么都不输出。第二条能返回一行 `1` 就说明连得上了。然后让 `.env` 指到这个库(Day 442 的 `Settings` 默认值是给 Docker 用的,用户名密码都是 `supportpilot`,Postgres.app 的用户是你的系统用户名、没有密码):

```bash
# supportpilot/.env 里把这一行改成(用户名换成你自己的,终端里 whoami 能看到)
DATABASE_URL=postgresql://你的用户名@localhost:5432/supportpilot
```

用 Docker 的话,这一步改成「第四步」里的 `docker compose up -d`,`.env` 不用改。

再装今天要用的一个新依赖。pgvector 的 Python 适配包,让 Python 的列表能直接当向量类型传给数据库(Day 229 你在 SQL 里用过 `vector` 类型,从 Python 传值要靠它):

```bash
uv add pgvector
```

```text
 + pgvector==0.5.1
 ~ supportpilot==0.1.0 (from file:///Users/你/supportpilot)
```

## 第二步:先建两张小表,看约束怎么拦

不急着写完整的表。先用最小的两张,把今天要讲的四种约束各撞一次墙。`scratch/mini.sql`:

```sql
-- supportpilot/scratch/mini.sql  只用来做实验,做完整个 demo 这个 schema 会被删掉
CREATE SCHEMA IF NOT EXISTS demo;

CREATE TABLE IF NOT EXISTS demo.customers (
    id         text PRIMARY KEY,
    name       text NOT NULL,
    email      text NOT NULL UNIQUE,
    is_vip     boolean NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS demo.subscriptions (
    id           text PRIMARY KEY,
    customer_id  text NOT NULL REFERENCES demo.customers(id),
    plan         text NOT NULL CHECK (plan IN ('free', 'standard', 'pro', 'enterprise')),
    price_cny    numeric(10, 2) NOT NULL
);
```

<div class="line-notes">

- `CREATE SCHEMA IF NOT EXISTS demo;` schema 是库里的「文件夹」,把表分组。这里临时建一个叫 `demo` 的,和正式的 `biz`、`kb` 分开,做完实验整个删掉。`IF NOT EXISTS` 的意思是已经有了就跳过,不报错。
- `id         text PRIMARY KEY,` 主键:唯一,而且不能为空。我们用 `C0001` 这种看得懂的文本编号,不用自增数字,Agent 的回复和日志里看到 `C0001` 就知道是客户。
- `name       text NOT NULL,` `NOT NULL`:这一列必须有值。
- `email      text NOT NULL UNIQUE,` `UNIQUE`:不能有两行邮箱相同。后面按邮箱找客户的工具靠它保证最多只找到一个人。
- `is_vip     boolean NOT NULL DEFAULT false` `DEFAULT false`:插入时没写这一列就自动填 `false`。
- `customer_id  text NOT NULL REFERENCES demo.customers(id),` 外键:这一列的值必须是 `customers` 表里某一行的 `id`。
- `plan         text NOT NULL CHECK (plan IN (` `CHECK`:写一个条件,不满足的行写不进去。这里限定只能是四种套餐之一。
- `price_cny    numeric(10, 2) NOT NULL` 金额用 `numeric(10, 2)`:最多 10 位有效数字、其中 2 位小数,精确存储。

</div>

跑两遍建表脚本,看重复运行会怎样:

```bash
psql supportpilot -f scratch/mini.sql
psql supportpilot -f scratch/mini.sql
```

```text
CREATE SCHEMA
CREATE TABLE
CREATE TABLE
psql:scratch/mini.sql:2: NOTICE:  schema "demo" already exists, skipping
CREATE SCHEMA
psql:scratch/mini.sql:9: NOTICE:  relation "customers" already exists, skipping
CREATE TABLE
psql:scratch/mini.sql:16: NOTICE:  relation "subscriptions" already exists, skipping
CREATE TABLE
```

第一遍建成功。第二遍每条都说「已经存在,跳过」(`NOTICE`,不是错误),脚本照样跑完。这就是 `IF NOT EXISTS` 的价值:建表脚本可以随便重复运行,不会因为已经建过就中断。

现在往里面塞坏数据,每次预期一个报错。先插一个正常的客户,然后依次试:邮箱重复、订阅指向不存在的客户、套餐写成 `gold`、客户没写邮箱、金额写了三位小数:

```bash
psql supportpilot -c "INSERT INTO demo.customers (id, name, email) VALUES ('C0001', '张伟', 'zhangwei@example.com')"
psql supportpilot -c "INSERT INTO demo.customers (id, name, email) VALUES ('C0002', '李娜', 'zhangwei@example.com')"
psql supportpilot -c "INSERT INTO demo.subscriptions VALUES ('S0001', 'C9999', 'pro', 99)"
psql supportpilot -c "INSERT INTO demo.subscriptions VALUES ('S0001', 'C0001', 'gold', 99)"
psql supportpilot -c "INSERT INTO demo.subscriptions VALUES ('S0001', 'C0001', 'pro', 99.456)"
psql supportpilot -c "INSERT INTO demo.customers (id, name) VALUES ('C0003', '王芳')"
```

```text
INSERT 0 1
ERROR:  duplicate key value violates unique constraint "customers_email_key"
DETAIL:  Key (email)=(zhangwei@example.com) already exists.
ERROR:  insert or update on table "subscriptions" violates foreign key constraint "subscriptions_customer_id_fkey"
DETAIL:  Key (customer_id)=(C9999) is not present in table "customers".
ERROR:  new row for relation "subscriptions" violates check constraint "subscriptions_plan_check"
DETAIL:  Failing row contains (S0001, C0001, gold, 99.00).
INSERT 0 1
ERROR:  null value in column "email" of relation "customers" violates not-null constraint
DETAIL:  Failing row contains (C0003, 王芳, null, f).
```

逐条看。第一条正常插入成功,`INSERT 0 1` 是「插入了一行」。第二条邮箱重复,被 `UNIQUE` 约束拦下,错误里还带着约束的名字 `customers_email_key`(表名加列名加 `key`,自动生成的)。第三条订阅指向了 `C9999`,不存在,被外键拦下。第四条 `gold` 不在四种套餐里,被 `CHECK` 拦下,报错里把被拒绝的整行都打了出来,方便排查。第五条 `99.456` **没报错**:数据库默默把它四舍五入成了 `99.46`(最后一步查询会看到)。这一点要记住:`numeric(10,2)` 会改你的数据,不会拒绝它。第六条没写邮箱,违反 `NOT NULL`。

再看删除。想删掉 `C0001`,但他还有一张订阅:

```bash
psql supportpilot -c "SELECT * FROM demo.subscriptions"
psql supportpilot -c "DELETE FROM demo.customers WHERE id='C0001'"
psql supportpilot -c "SELECT 0.1::float8 + 0.2::float8 AS float_sum, 0.1::numeric + 0.2::numeric AS numeric_sum"
```

```text
  id   | customer_id | plan | price_cny 
-------+-------------+------+-----------
 S0001 | C0001       | pro  |     99.46
(1 row)

ERROR:  update or delete on table "customers" violates foreign key constraint "subscriptions_customer_id_fkey" on table "subscriptions"
DETAIL:  Key (id)=(C0001) is still referenced from table "subscriptions".
      float_sum      | numeric_sum 
---------------------+-------------
 0.30000000000000004 |         0.3
(1 row)
```

`99.456` 变成了 `99.46`,证实了上面的说法。外键是双向的:不光不能引用不存在的客户,**还在有人引用时不让你删掉那个客户**。最后一条查询回答「为什么金额不用浮点数」:`float8`(浮点数)算 `0.1 + 0.2` 得到 `0.30000000000000004`,`numeric` 精确得到 `0.3`。[Day 12](/blog/agent-zero/day-012-numbers/) 讲过 JS 和 Python 里同样的浮点误差,算钱的地方绝不能用它。

实验做完,把 demo 整个删掉:

```bash
psql supportpilot -c "DROP SCHEMA demo CASCADE"
```

```text
NOTICE:  drop cascades to table demo.subscriptions
```

`CASCADE` 把 schema 里的表一起删掉。后面你会看到另一个 `CASCADE`,在 `kb.chunks` 里。

## 第三步:写完整的 schema.sql

九张表一起写。先看它们的关系:

<figure>
<svg viewBox="0 0 640 330" role="img" aria-label="SupportPilot 数据表关系:业务表和知识库表">
<g font-family="var(--font-mono)" font-size="11">
<rect x="20" y="20" width="140" height="56" rx="5" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="90" y="44" text-anchor="middle" fill="var(--ink)">biz.customers</text>
<text x="90" y="62" text-anchor="middle" fill="var(--ink-soft)">email 唯一</text>
<rect x="250" y="20" width="150" height="56" rx="5" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="325" y="44" text-anchor="middle" fill="var(--ink)">biz.subscriptions</text>
<text x="325" y="62" text-anchor="middle" fill="var(--ink-soft)">套餐 · 月付/年付 · 状态</text>
<rect x="470" y="20" width="150" height="56" rx="5" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="545" y="44" text-anchor="middle" fill="var(--ink)">biz.invoices</text>
<text x="545" y="62" text-anchor="middle" fill="var(--ink-soft)">金额 · 周期 · 是否首购</text>
<rect x="470" y="130" width="150" height="56" rx="5" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="545" y="154" text-anchor="middle" fill="var(--ink)">biz.refund_requests</text>
<text x="545" y="172" text-anchor="middle" fill="var(--ink-soft)">pending → 人审</text>
<rect x="20" y="130" width="140" height="56" rx="5" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="90" y="154" text-anchor="middle" fill="var(--ink)">biz.tickets</text>
<text x="90" y="172" text-anchor="middle" fill="var(--ink-soft)">历史 + 新工单</text>
<rect x="250" y="130" width="150" height="56" rx="5" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="325" y="154" text-anchor="middle" fill="var(--ink)">biz.customer_profiles</text>
<text x="325" y="172" text-anchor="middle" fill="var(--ink-soft)">客户画像 · Day 466</text>
<rect x="250" y="220" width="150" height="40" rx="5" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="325" y="244" text-anchor="middle" fill="var(--ink)">biz.audit_log 写操作记录</text>
<rect x="20" y="250" width="140" height="56" rx="5" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="90" y="274" text-anchor="middle" fill="var(--ink)">kb.docs</text>
<text x="90" y="292" text-anchor="middle" fill="var(--ink-soft)">文章 · content_hash</text>
<rect x="470" y="250" width="150" height="56" rx="5" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="545" y="274" text-anchor="middle" fill="var(--ink)">kb.chunks</text>
<text x="545" y="292" text-anchor="middle" fill="var(--ink-soft)">vector(1024) · HNSW</text>
</g>
<g stroke="var(--ink-faint)" stroke-width="1.3" fill="none">
<line x1="160" y1="48" x2="248" y2="48"/><line x1="400" y1="48" x2="468" y2="48"/>
<line x1="545" y1="76" x2="545" y2="128"/><line x1="90" y1="76" x2="90" y2="128"/>
<line x1="160" y1="158" x2="248" y2="158"/><line x1="160" y1="278" x2="468" y2="278"/>
</g>
</svg>
<figcaption>琥珀色是业务数据(后面的工具会查它),蓝色是知识库(检索会查它)。线表示外键引用。退款申请单独一张表,有状态流转,只有人能把 pending 往后推。</figcaption>
</figure>

业务库(`biz`)和知识库(`kb`)放在**同一个 Postgres 的两个 schema** 里。本地只起一个库,部署也只要一个。文本块多到千万级再拆,现在只有几百块。

```sql
-- supportpilot/db/schema.sql
-- 业务库(biz)和知识库(kb)放同一个 Postgres 的两个 schema 里:本地只起一个容器,演示和部署都省事。
CREATE EXTENSION IF NOT EXISTS vector;
CREATE SCHEMA IF NOT EXISTS biz;
CREATE SCHEMA IF NOT EXISTS kb;

CREATE TABLE IF NOT EXISTS biz.customers (
    id          text PRIMARY KEY,               -- C0001
    name        text NOT NULL,
    email       text NOT NULL UNIQUE,
    company     text,
    region      text,
    is_vip      boolean NOT NULL DEFAULT false,
    created_at  date NOT NULL
);

CREATE TABLE IF NOT EXISTS biz.subscriptions (
    id                  text PRIMARY KEY,       -- S0001
    customer_id         text NOT NULL REFERENCES biz.customers(id),
    plan                text NOT NULL CHECK (plan IN ('free','standard','pro','enterprise')),
    billing_cycle       text NOT NULL CHECK (billing_cycle IN ('monthly','yearly')),
    status              text NOT NULL CHECK (status IN ('trialing','active','past_due','canceled')),
    seats               int  NOT NULL DEFAULT 1,
    price_cny           numeric(10,2) NOT NULL,
    started_at          date NOT NULL,
    current_period_end  date NOT NULL,
    auto_renew          boolean NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS biz.invoices (
    id              text PRIMARY KEY,           -- INV-202609-0001
    customer_id     text NOT NULL REFERENCES biz.customers(id),
    subscription_id text NOT NULL REFERENCES biz.subscriptions(id),
    amount_cny      numeric(10,2) NOT NULL,
    status          text NOT NULL CHECK (status IN ('paid','open','failed','refunded','void')),
    issued_at       date NOT NULL,
    paid_at         date,
    period_start    date NOT NULL,
    period_end      date NOT NULL,
    is_first_purchase boolean NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS biz.refund_requests (
    id          text PRIMARY KEY,               -- RF-T000123-INV-202609-0001
    invoice_id  text NOT NULL REFERENCES biz.invoices(id),
    customer_id text NOT NULL REFERENCES biz.customers(id),
    ticket_id   text,
    amount_cny  numeric(10,2) NOT NULL,
    reason      text NOT NULL,
    rule        text NOT NULL,                  -- 命中的退款规则,审批人要看
    status      text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','executed')),
    created_at  timestamptz NOT NULL DEFAULT now(),
    decided_by  text,
    decided_at  timestamptz,
    note        text
);

CREATE TABLE IF NOT EXISTS biz.tickets (
    id                  text PRIMARY KEY,       -- T000123
    customer_id         text REFERENCES biz.customers(id),
    customer_email      text NOT NULL,
    subject             text NOT NULL,
    body                text NOT NULL,
    category            text,
    status              text NOT NULL DEFAULT 'open' CHECK (status IN ('open','waiting_approval','resolved','escalated')),
    created_at          timestamptz NOT NULL DEFAULT now(),
    resolved_at         timestamptz,
    resolution_summary  text
);

-- Day 466 用:客户画像(历史工单压缩成一段话)
CREATE TABLE IF NOT EXISTS biz.customer_profiles (
    customer_id text PRIMARY KEY REFERENCES biz.customers(id),
    summary     text NOT NULL,
    source_ticket_count int NOT NULL,
    updated_at  timestamptz NOT NULL DEFAULT now()
);

-- 所有写操作都记一笔,出了事故问「它到底干了什么」时查这里
CREATE TABLE IF NOT EXISTS biz.audit_log (
    id          bigserial PRIMARY KEY,
    actor       text NOT NULL,                  -- agent / human:<name> / system
    action      text NOT NULL,
    payload     jsonb NOT NULL,
    created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS kb.docs (
    id            text PRIMARY KEY,             -- KB-refund-002
    title         text NOT NULL,
    category      text NOT NULL,
    url_path      text NOT NULL,
    updated_at    date NOT NULL,
    content_hash  text NOT NULL,
    content       text NOT NULL
);

CREATE TABLE IF NOT EXISTS kb.chunks (
    id           bigserial PRIMARY KEY,
    doc_id       text NOT NULL REFERENCES kb.docs(id) ON DELETE CASCADE,
    chunk_index  int  NOT NULL,
    heading      text NOT NULL,
    content      text NOT NULL,
    embedding    vector(1024) NOT NULL,         -- 维度要和 EMB_DIM 一致,换 embedding 模型要改这里并重建
    UNIQUE (doc_id, chunk_index)
);
CREATE INDEX IF NOT EXISTS chunks_embedding_hnsw ON kb.chunks USING hnsw (embedding vector_cosine_ops);
```

<div class="line-notes">

- `-- supportpilot/db/schema.sql` SQL 的注释符号是两个减号,第一行写文件路径,和课里别的文件一致。
- `CREATE EXTENSION IF NOT EXISTS vector;` 打开 pgvector。Postgres.app 17 里实测版本是 0.8.6。没有这一行,后面的 `vector(1024)` 类型不存在,建表会直接报错。
- `CREATE SCHEMA IF NOT EXISTS biz;` 业务数据的 schema。表名要写成 `biz.customers`,一眼看出属于哪一块。
- `CREATE TABLE IF NOT EXISTS biz.customers (` 客户表。
- `id          text PRIMARY KEY,               -- C0001` 可读编号,不用自增数字。
- `NOT NULL UNIQUE,` 邮箱列,不能为空,也不能重复。Day 452 的工具按邮箱找客户,允许重复就可能找到两个人。
- `is_vip      boolean NOT NULL DEFAULT false,` 大多数客户不是 VIP,不写就是 `false`。
- `created_at  date NOT NULL` 注册日期用 `date`(只有年月日),不需要时分秒。
- `CREATE TABLE IF NOT EXISTS biz.subscriptions (` 订阅表:一个客户可以有多条订阅。
- `customer_id         text NOT NULL REFERENCES biz.customers(id),` 外键。Postgres 默认就强制检查。SQLite 不一样,它默认不检查外键,要单独打开。
- `plan                text NOT NULL CHECK (plan IN` 套餐只能四选一。这一行就是上面第二步里 `gold` 被拒绝的同一种写法。
- `billing_cycle       text NOT NULL CHECK (billing_cycle IN` 月付或年付,退款规则靠它分支。
- `status              text NOT NULL CHECK (status IN` 订阅状态四选一:试用、有效、逾期、已取消。
- `price_cny           numeric(10,2) NOT NULL,` 金额精确存储。psycopg 读出来是 Python 的 `Decimal`,比如 `Decimal('39.00')`。
- `current_period_end  date NOT NULL,` 当前计费周期的结束日,Day 452 算「剩余完整月数」要用。
- `auto_renew          boolean NOT NULL DEFAULT true` 默认自动续费。
- `CREATE TABLE IF NOT EXISTS biz.invoices (` 账单表。
- `subscription_id text NOT NULL REFERENCES biz.subscriptions(id),` 账单同时指向客户和订阅,两条外键。
- `status          text NOT NULL CHECK (status IN` 账单状态五选一:已付、待付、失败、已退款、作废。
- `paid_at         date,` 这一列没有 `NOT NULL`:没付成功的账单就是没有付款日,存 `NULL` 比存一个假日期诚实。
- `is_first_purchase boolean NOT NULL DEFAULT false` 是不是首购。「14 天无理由」只对首购有效,续费单不适用。
- `CREATE TABLE IF NOT EXISTS biz.refund_requests (` 退款申请单。它是独立的表,不是账单上的一个字段,因为它有自己的生命周期。
- `id          text PRIMARY KEY,               -- RF-T000123` 编号由「工单号 + 账单号」拼成。同一张工单对同一张账单只能有一条申请,Agent 重试时再插入会撞主键,天然防重复。
- `rule        text NOT NULL,                  -- 命中的退款规则,审批人要看` 记下命中了哪条规则,审批人看这个字段,不用猜 Agent 为什么建这张单。
- `status      text NOT NULL DEFAULT 'pending' CHECK (status IN` 新建的申请一律是待审批 `pending`。Agent 只建不批,往后走要靠人。
- `created_at  timestamptz NOT NULL DEFAULT now(),` `timestamptz` 是带时区的时间戳,`now()` 由数据库在插入时填,代码不用传。
- `CREATE TABLE IF NOT EXISTS biz.tickets (` 工单表,历史工单和新工单都在这里。
- `customer_id         text REFERENCES biz.customers(id),` 这里没有 `NOT NULL`:陌生邮箱发来的工单还对不上客户。
- `customer_email      text NOT NULL,` 所以另存发件邮箱,认不认识这个人,邮箱总是有的。
- `status              text NOT NULL DEFAULT 'open' CHECK (status IN` 工单状态多了两个:`waiting_approval`(退款等人审)和 `escalated`(转人工)。
- `CREATE TABLE IF NOT EXISTS biz.customer_profiles (` 客户画像,Day 466 才往里写,今天先建空表。
- `customer_id text PRIMARY KEY REFERENCES biz.customers(id),` 主键同时是外键,保证一个客户最多一份画像。
- `CREATE TABLE IF NOT EXISTS biz.audit_log (` 审计日志:所有写操作都记一笔。
- `id          bigserial PRIMARY KEY,` 日志只追加不修改,自增编号正好表示先后顺序。
- `payload     jsonb NOT NULL,` 每种操作的参数不一样,用 `jsonb` 存原样参数,不用为每种操作建列。
- `CREATE TABLE IF NOT EXISTS kb.docs (` 知识库的文章表,在 `kb` schema 里。
- `content_hash  text NOT NULL,` 文章内容的哈希。Day 449 做增量导入时靠它判断文章变没变,没变就不重新做向量化。
- `CREATE TABLE IF NOT EXISTS kb.chunks (` 文本块表:一篇文章切成几块,每块一个向量。
- `doc_id       text NOT NULL REFERENCES kb.docs(id) ON DELETE CASCADE,` `ON DELETE CASCADE`:删掉一篇文章,它的所有文本块跟着删,不会留下孤儿块。第六步会实测。
- `embedding    vector(1024) NOT NULL,` 1024 维的向量列。维度必须和 Day 442 的 `emb_dim` 一致,换 embedding 模型时两处一起改。
- `UNIQUE (doc_id, chunk_index)` 同一篇文章的第几块只能有一条,重复导入时可以靠它更新而不是重复插入。
- `CREATE INDEX IF NOT EXISTS chunks_embedding_hnsw` 向量索引。`vector_cosine_ops` 对应查询时的 `<=>`(余弦距离)运算符,Day 450 检索必须用 `<=>` 才走得到这个索引。

</div>

几个刻意的设计,单独说。

**CHECK 约束是给 Agent 上的最后一道锁。** 套餐、状态这些「只能是几个值之一」的列,全部用 `CHECK` 写死。就算哪天代码出了 bug,或者模型编出一个新状态,数据库会直接拒绝,报错里还带着整行内容。

**退款申请是独立的表,不是账单上的一个字段。** 退款有自己的生命周期(待审批、通过或驳回、已执行),有审批人、审批时间、审批备注、命中的规则。账单只管「收了多少钱」,退款单管「谁批的、为什么批」。

**审计日志。** 出了事故第一个问题永远是「它到底干了什么」。没有 `audit_log`,这个问题答不上来。

**向量维度写死 1024,HNSW 索引现在其实没必要。** bge-m3 输出 1024 维。几百块文本顺序扫一遍也就几毫秒,建索引是因为知识库会长大,也因为面试时被问「向量检索怎么加速」你能说你建过,知道 `vector_cosine_ops` 要和查询用的 `<=>` 对应,运算符类建错了索引不会被用上。

## 第四步:docker-compose.yml(没实跑)

给用 Docker 的人。**这一节我没有实跑**,本机没有 Docker,我只核对了镜像标签存在、YAML 语法合法(pre-commit 的 `check yaml` 会检查,第八步你会看到它通过)。

```yaml
# supportpilot/docker-compose.yml
# 今天只有数据库;后面要加别的服务(Langfuse、应用本身)再往这里加。
services:
  db:
    image: pgvector/pgvector:pg17
    environment:
      POSTGRES_USER: supportpilot
      POSTGRES_PASSWORD: supportpilot
      POSTGRES_DB: supportpilot
    ports:
      - "5432:5432"
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U supportpilot"]
      interval: 5s
      retries: 10
volumes:
  pgdata:
```

<div class="line-notes">

- `# supportpilot/docker-compose.yml` 文件放在仓库根目录。
- `services:` compose 文件里的每个 service 是一个容器。今天只有 `db` 一个,后面要加别的服务再往下加。
- `image: pgvector/pgvector:pg17` 镜像名,冒号后面 `pg17` 是标签:Postgres 17 加上 pgvector 扩展。我 2026 年 10 月 27 日查 Docker Hub,这个标签存在,最近一次更新是 10 月 1 日。
- `POSTGRES_USER: supportpilot` 这三个环境变量只在**第一次**初始化数据卷时生效:建用户、设密码、建同名数据库。数据卷里已经有数据后再改它们没用,要 `docker compose down -v` 删卷重来。
- `- "5432:5432"` 「主机端口:容器端口」。如果 Postgres.app 也在跑,它已经占了主机的 5432,容器会启动失败。两个只开一个,或者把左边改成 `5433`,`DATABASE_URL` 里的端口跟着改。
- `- pgdata:/var/lib/postgresql/data` 把容器里的数据目录挂到命名卷 `pgdata` 上。容器删了重建,数据还在。
- `healthcheck:` 健康检查。`docker compose ps` 里显示 `healthy` 才说明库真的能连了,刚启动的几秒是 `starting`。
- `test: ["CMD-SHELL", "pg_isready -U supportpilot"]` `pg_isready` 是 Postgres 自带的小工具,能接受连接就返回 0。
- `interval: 5s` 每 5 秒检查一次,最多 10 次,也就是最多等 50 秒。
- `pgdata:` 文件末尾顶层的 `volumes:` 声明这个命名卷,只写名字就是用 Docker 默认的本地存储。

</div>

启动是 `docker compose up -d`,`docker compose ps` 看到 `healthy` 就可以了。`pgdata` 是命名卷,`docker compose down` 不删数据,`docker compose down -v` 才删。

## 第五步:db.py,和一个先有鸡还是先有蛋的坑

连接数据库的小工具,所有后面的代码都通过它拿连接。新建 `src/supportpilot/db.py`:

```python
# supportpilot/src/supportpilot/db.py
import psycopg
from pgvector.psycopg import register_vector
from psycopg.rows import DictRow, dict_row

from .config import get_settings


def connect(url: str | None = None) -> psycopg.Connection[DictRow]:
    """拿一条连接。autocommit=True:每条语句自己提交;需要几条一起成败时用 conn.transaction()。"""
    conn = psycopg.Connection[DictRow].connect(
        url or get_settings().database_url, autocommit=True, row_factory=dict_row
    )
    register_vector(conn)  # 让 list / numpy 数组能直接当 vector 类型传进去
    return conn
```

<div class="line-notes">

- `import psycopg` psycopg 第 3 版,Day 441 装的 `psycopg[binary]`,Python 连 Postgres 的主流驱动。
- `from pgvector.psycopg import register_vector` 刚装的 pgvector 适配包。
- `from psycopg.rows import DictRow, dict_row` `dict_row` 让查询结果是字典而不是元组;`DictRow` 是它对应的类型名,给类型检查器用。
- `from .config import get_settings` 开头的点是相对导入([Day 32](/blog/agent-zero/day-032-modules/)):从同一个包里导入 `config`。
- `def connect(url: str | None = None) -> psycopg.Connection[DictRow]:` 不传 `url` 就用配置里的 `database_url`,测试或脚本想连别的库就传一个进来。返回类型写成「行是字典的连接」,这样后面 `row["name"]` 不会被类型检查器报红。
- `conn = psycopg.Connection[DictRow].connect(` 创建连接。这个写法看起来绕,是为了让类型检查器知道行是字典(basedpyright 0 报错);直接 `psycopg.connect(..., row_factory=dict_row)` 运行没问题,但类型会推断成元组行。
- `url or get_settings().database_url, autocommit=True, row_factory=dict_row` `url or ...`:`url` 是 `None` 时取后面的值。`autocommit=True`:每条语句执行完立刻提交,不用手动 `commit()`。需要「几条一起成功或一起失败」时,用 `with conn.transaction():` 包起来。`row_factory=dict_row`:查出来的一行是 `{'id': 'C0001', 'name': '张伟'}`。
- `register_vector(conn)  # 让 list` 告诉这条连接:认识 `vector` 这个类型,Python 列表和数据库的向量互相转换。
- `return conn` 返回连接。用法是 `with connect() as conn:`,`with` 结束时自动关闭。

</div>

这个函数里有一个坑,我第一次写就掉进去了。**数据库是空的时候,直接调用 `connect()`**:

```bash
uv run python -c "from supportpilot.db import connect; connect()" 2>&1 | tail -3
```

```text
  File ".../site-packages/pgvector/psycopg/vector.py", line 49, in register_vector_info
    raise psycopg.ProgrammingError('vector type not found in the database')
psycopg.ProgrammingError: vector type not found in the database
```

原因在 `register_vector(conn)` 那一行:它要去数据库里查 `vector` 这个类型的编号,而类型是 `CREATE EXTENSION vector` 之后才有的。刚建的空库还没执行过 `schema.sql`,`vector` 不存在,注册就失败。可是建表脚本要通过连接去执行,于是:**建表要先有连接,连接要先有 vector 类型,vector 类型要先建表脚本里的第一行**。先有鸡还是先有蛋。

解法是第一次建表用「不注册 vector」的裸连接。下一步的 `init_db.py` 就是这么做的。

## 第六步:init_db.py,建表

```python
# supportpilot/scripts/init_db.py
"""建表。第一次连接时还没有 vector 扩展,所以这里用裸 psycopg,不走 db.connect()。"""

from pathlib import Path
from typing import LiteralString, cast

import psycopg

from supportpilot.config import get_settings

SCHEMA = Path(__file__).resolve().parent.parent / "db" / "schema.sql"

if __name__ == "__main__":
    # 类型检查器只放行「写死在代码里的字符串」当 SQL,这是防 SQL 注入的一道栏。
    # 文件是我们自己仓库里的,所以用 cast 告诉它:放心。
    sql_text = cast(LiteralString, SCHEMA.read_text(encoding="utf-8"))
    with psycopg.connect(get_settings().database_url, autocommit=True) as conn:
        conn.execute(sql_text)
    print("schema ready")
```

<div class="line-notes">

- `from pathlib import Path` 算 `schema.sql` 的路径。
- `from typing import LiteralString, cast` 下面解释 `cast`。
- `import psycopg` 这里直接用 psycopg,不经过 `db.connect()`,原因就是上一步的坑。
- `from supportpilot.config import get_settings` 脚本在 `scripts/` 目录下,不属于 `supportpilot` 包,但包已经可编辑安装到 `.venv`,所以能直接按包名导入。
- `SCHEMA = Path(__file__).resolve().parent.parent / "db" / "schema.sql"` 从脚本自己的位置往上两级到仓库根目录,再拼上 `db/schema.sql`。不管你在哪个目录运行,都找得到文件。
- `if __name__ == "__main__":` 直接运行脚本时才执行下面的建表,被别的文件 import 时什么都不做([Day 32](/blog/agent-zero/day-032-modules/))。
- `sql_text = cast(LiteralString, SCHEMA.read_text(encoding="utf-8"))` 读出 SQL 文本。psycopg 的类型标注只放行「写死在代码里的字符串」当 SQL,这是防 SQL 注入的一道栏;文件内容在类型检查器眼里是任意字符串,会被拦下。文件是我们自己仓库里的,所以用 `cast` 告诉它放心。`cast` 运行时什么都不做。
- `with psycopg.connect(get_settings().database_url, autocommit=True) as conn:` psycopg 3 的连接用在 `with` 里,结束时自动关闭。`autocommit=True` 让 `CREATE EXTENSION` 这类语句立即生效。
- `conn.execute(sql_text)` 一次执行整个文件里的十几条语句。不带参数时 psycopg 用「简单查询协议」,允许一个字符串里有多条用分号分隔的 SQL;带了 `%s` 参数就只能一条一条执行。
- `print("schema ready")` 建好了就打一行。

</div>

这个 `cast` 是我跑 basedpyright 时才发现要加的:不加的话报 `Argument of type "str" cannot be assigned to parameter "query"`,把 `str` 当成了不被允许的类型。运行起来则一切正常,`cast` 纯粹是让类型检查器闭嘴,并且留下一句注释说明为什么可以闭嘴。

建表,运行两次:

```bash
uv run python scripts/init_db.py
uv run python scripts/init_db.py
```

```text
schema ready
schema ready
```

第二遍也是 `schema ready`,因为每条语句都带 `IF NOT EXISTS`。再用 `psql` 看看建出了什么:

```bash
psql supportpilot -c '\dt biz.*'
psql supportpilot -c '\d kb.chunks'
```

```text
              List of relations
 Schema |       Name        | Type  | Owner  
--------+-------------------+-------+--------
 biz    | audit_log         | table | minliu
 biz    | customer_profiles | table | minliu
 biz    | customers         | table | minliu
 biz    | invoices          | table | minliu
 biz    | refund_requests   | table | minliu
 biz    | subscriptions     | table | minliu
 biz    | tickets           | table | minliu
(7 rows)
```

```text
                                     Table "kb.chunks"
   Column    |     Type     | Collation | Nullable |                Default                
-------------+--------------+-----------+----------+---------------------------------------
 id          | bigint       |           | not null | nextval('kb.chunks_id_seq'::regclass)
 doc_id      | text         |           | not null | 
 chunk_index | integer      |           | not null | 
 heading     | text         |           | not null | 
 content     | text         |           | not null | 
 embedding   | vector(1024) |           | not null | 
Indexes:
    "chunks_pkey" PRIMARY KEY, btree (id)
    "chunks_doc_id_chunk_index_key" UNIQUE CONSTRAINT, btree (doc_id, chunk_index)
    "chunks_embedding_hnsw" hnsw (embedding vector_cosine_ops)
Foreign-key constraints:
    "chunks_doc_id_fkey" FOREIGN KEY (doc_id) REFERENCES kb.docs(id) ON DELETE CASCADE
```

(`Owner` 一列是你的系统用户名,我这里是 `minliu`,你的会不一样。)业务库 7 张表,`kb.chunks` 的向量列是 `vector(1024)`,索引是 `hnsw`,外键带 `ON DELETE CASCADE`。

现在用 `connect()` 连一次,同时验证向量列的行为。`scratch/s7.py`:

```python
# supportpilot/scratch/s7.py
from psycopg import errors

from supportpilot.db import connect

with connect() as conn:
    conn.execute("INSERT INTO kb.docs VALUES ('KB-x-001', 't', 'x', '/help/x/001', '2026-09-15', 'h', 'c')")
    try:
        conn.execute("INSERT INTO kb.chunks (doc_id, chunk_index, heading, content, embedding) "
                     "VALUES ('KB-x-001', 0, 'h', 'c', %s)", ([0.1, 0.2, 0.3],))
    except errors.DataException as e:
        print(type(e).__name__, "|", str(e).splitlines()[0])
    conn.execute("INSERT INTO kb.chunks (doc_id, chunk_index, heading, content, embedding) "
                 "VALUES ('KB-x-001', 0, 'h', 'c', %s)", ([0.1] * 1024,))
    print(conn.execute("SELECT count(*) AS n FROM kb.chunks").fetchone())
    conn.execute("DELETE FROM kb.docs WHERE id = 'KB-x-001'")
    print(conn.execute("SELECT count(*) AS n FROM kb.chunks").fetchone())
```

<div class="line-notes">

- `from psycopg import errors` psycopg 把数据库的各种错误分成了不同的异常类,放在 `errors` 里。
- `with connect() as conn:` 用我们的 `connect()` 拿连接,`with` 结束自动关闭。
- `conn.execute("INSERT INTO kb.docs VALUES (` 先插一篇假文章,因为文本块要引用它(外键)。
- `"VALUES ('KB-x-001', 0, 'h', 'c', %s)", ([0.1, 0.2, 0.3],))` `%s` 是参数占位符([Day 92](/blog/agent-zero/day-092-python-sqlite-1/) 讲过为什么要用占位符,不要拼字符串)。传进去的是一个 3 维的 Python 列表,故意传错维度。
- `except errors.DataException as e:` 维度不对会抛这一类异常。
- `print(type(e).__name__, "|", str(e).splitlines()[0])` 只打印异常类型名和报错第一行。
- `conn.execute("INSERT INTO kb.chunks (doc_id, chunk_index, heading, content, embedding) "` 这次传 `[0.1] * 1024`:一个 1024 个 0.1 的列表,维度对了。`[0.1] * 1024` 是 Python 里把列表重复 1024 次的写法。
- `print(conn.execute("SELECT count(*) AS n FROM kb.chunks").fetchone())` 数一下有几块,`dict_row` 让结果是 `{'n': 1}`。
- `conn.execute("DELETE FROM kb.docs WHERE id = 'KB-x-001'")` 删掉那篇文章。
- `print(conn.execute("SELECT count(*) AS n FROM kb.chunks").fetchone())` 再数一次,看文本块是不是跟着没了。

</div>

```bash
uv run python scratch/s7.py
```

```text
DataException | expected 1024 dimensions, not 3
{'n': 1}
{'n': 0}
```

三行对应三件事:传 3 维向量被拒绝(`expected 1024 dimensions, not 3`),传 1024 维成功(1 块),删掉文章后文本块变成 0 个(`CASCADE` 生效)。`row["n"]` 能直接用,说明 `dict_row` 在起作用。再用 `connect()` 去连一个**没有 vector 扩展**的空库,会看到上一步那个报错。`connect()` 在 `init_db.py` 跑过之后才能用,这个顺序要记住。

## 第七步:表结构测试

两个测试文件,一个不连库,一个连库。

先是不连库的 `tests/test_schema.py`:它只把 `schema.sql` 当文本读,检查三条约定。

```python
# supportpilot/tests/test_schema.py
"""表结构测试(不连数据库):只读 schema.sql 这个文本文件,检查几条约定。"""

import re
from pathlib import Path

from supportpilot.config import Settings

SCHEMA = (Path(__file__).resolve().parent.parent / "db" / "schema.sql").read_text(encoding="utf-8")


def test_vector_dim_matches_settings():
    """schema 里的 vector(N) 要和配置里的 emb_dim 一致,换 embedding 模型时两处一起改。"""
    dims = {int(n) for n in re.findall(r"vector\((\d+)\)", SCHEMA)}
    assert dims == {Settings().emb_dim}


def test_every_create_is_rerunnable():
    """每条 CREATE 都带 IF NOT EXISTS,脚本才能反复执行。"""
    kinds = r"CREATE (?:EXTENSION|SCHEMA|TABLE|INDEX)"
    assert re.findall(kinds, SCHEMA)  # 先确认真的找到了语句,免得正则写错时测试空转
    assert not re.findall(kinds + r"\s+(?!IF NOT EXISTS)", SCHEMA)


def test_money_is_numeric_not_float():
    assert "float" not in SCHEMA.lower()
    assert "numeric(10,2)" in SCHEMA
```

<div class="line-notes">

- `import re` 用正则在 SQL 文本里找东西。
- `from pathlib import Path` 算 `schema.sql` 的路径。
- `from supportpilot.config import Settings` 这条测试要拿配置里的 `emb_dim` 对账。
- `SCHEMA = (Path(__file__).resolve().parent.parent / "db" / "schema.sql").read_text(encoding="utf-8")` 测试文件在 `tests/`,往上一级是仓库根目录,读整个 `schema.sql`。放在模块顶层,三个测试共用。
- `def test_vector_dim_matches_settings():` 向量维度对账。
- `dims = {int(n) for n in re.findall(r"vector\((\d+)\)", SCHEMA)}` 正则找出所有 `vector(数字)`,取出数字,放进集合。现在只有一个 1024。
- `assert dims == {Settings().emb_dim}` 和配置里的 `emb_dim` 比较。这里**故意**用真的 `Settings()`、会读你的 `.env`:你在 `.env` 里写了 `EMB_DIM=768`,就应该提醒你同步改 schema。
- `def test_every_create_is_rerunnable():` 每条 `CREATE` 都带 `IF NOT EXISTS`。
- `kinds = r"CREATE (?:EXTENSION|SCHEMA|TABLE|INDEX)"` 四类要检查的语句。`(?:...)` 是「分组但不捕获」,`|` 是「或」。
- `assert re.findall(kinds, SCHEMA)  # 先确认` 先断言真的找到了语句。没有这一行,正则写错时下一行永远找不到东西,测试就空转通过。
- `assert not re.findall(kinds + r"\s+(?!IF NOT EXISTS)", SCHEMA)` `(?!...)` 是「后面不能紧跟」。找「`CREATE TABLE` 后面没有 `IF NOT EXISTS`」的情况,一条都不应该有。
- `def test_money_is_numeric_not_float():` 钱不能用浮点。
- `assert "float" not in SCHEMA.lower()` 整个文件里不出现 `float`。
- `assert "numeric(10,2)" in SCHEMA` 金额列用的是 `numeric(10,2)`。

</div>

然后是连库的 `tests/test_db.py`。它有个设计:连不上库就**跳过**,而不是失败。

```python
# supportpilot/tests/test_db.py
"""连真数据库的测试。连不上就整体跳过(比如在没起 Postgres 的机器上),不让 make test 变红。"""

import psycopg
import pytest
from psycopg import errors

from supportpilot.db import connect

NEW_CUSTOMER = (
    "INSERT INTO biz.customers (id, name, email, created_at) VALUES ('CT001', 'x', 'x@example.com', '2026-01-01')"
)
NEW_SUB = (
    "INSERT INTO biz.subscriptions "
    "(id, customer_id, plan, billing_cycle, status, price_cny, started_at, current_period_end) "
    "VALUES ('ST001', %s, %s, 'monthly', 'active', 99, '2026-01-01', '2026-02-01')"
)


@pytest.fixture
def conn():
    try:
        c = connect()
    except psycopg.OperationalError as e:
        pytest.skip(f"连不上数据库:{str(e).splitlines()[0]}")
    except psycopg.ProgrammingError as e:
        pytest.skip(f"库里还没建表(先 uv run python scripts/init_db.py):{e}")
    with c:
        yield c


def test_rows_are_dicts(conn: psycopg.Connection):
    row = conn.execute("SELECT 1 AS one").fetchone()
    assert row == {"one": 1}


def test_check_constraint_rejects_bad_plan(conn: psycopg.Connection):
    """坏数据放在事务里试,force_rollback=True 让它不管成败最后都回滚,库里不留任何东西。"""
    with pytest.raises(errors.CheckViolation, match="subscriptions_plan_check"):
        with conn.transaction(force_rollback=True):
            conn.execute(NEW_CUSTOMER)
            conn.execute(NEW_SUB, ("CT001", "gold"))


def test_foreign_key_rejects_unknown_customer(conn: psycopg.Connection):
    with pytest.raises(errors.ForeignKeyViolation):
        with conn.transaction(force_rollback=True):
            conn.execute(NEW_SUB, ("NOBODY", "pro"))


def test_wrong_vector_dim_rejected(conn: psycopg.Connection):
    with pytest.raises(errors.DataException, match="1024 dimensions"):
        with conn.transaction(force_rollback=True):
            conn.execute("INSERT INTO kb.docs VALUES ('KB-t-001', 't', 't', '/t', '2026-09-15', 'h', 'c')")
            conn.execute(
                "INSERT INTO kb.chunks (doc_id, chunk_index, heading, content, embedding) "
                "VALUES ('KB-t-001', 0, 'h', 'c', %s)",
                ([0.1, 0.2],),
            )
```

<div class="line-notes">

- `import psycopg` 要捕获它的两种异常。
- `import pytest` `fixture`、`skip`、`raises`。
- `from psycopg import errors` 具体的错误类。
- `from supportpilot.db import connect` 被测的函数。
- `NEW_CUSTOMER = (` 测试用的一个客户,编号以 `CT` 开头,和以后的真实编号(`C0001`)错开。
- `NEW_SUB = (` 一条订阅的插入语句,套餐和客户编号留给 `%s` 占位符,其余字段写死。括号把相邻的几个字符串自动拼成一个。
- `@pytest.fixture` 把下面的函数变成 fixture:测试函数在参数里写 `conn`,pytest 就会先执行它。
- `c = connect()` 试着连库。
- `except psycopg.OperationalError as e:` 连不上(库没起、端口不对),跳过并说明原因。
- `pytest.skip(f"连不上数据库:` `pytest.skip` 让当前测试标记为「跳过」,不算失败。
- `except psycopg.ProgrammingError as e:` 连上了但库里还没建表,上一节那个 `vector type not found`,也是跳过,并提示先跑 `init_db.py`。
- `with c:` 连接用完要关。
- `yield c` fixture 里的 `yield`:把连接交给测试,测试跑完回来继续执行 `with` 的收尾(关闭连接)。
- `def test_rows_are_dicts(conn: psycopg.Connection):` 测试函数参数写 `conn`,pytest 自动注入上面那个 fixture 的值。
- `assert row == {"one": 1}` `dict_row` 生效,行是字典。
- `def test_check_constraint_rejects_bad_plan(` 套餐约束测试。
- `with pytest.raises(errors.CheckViolation, match="subscriptions_plan_check"):` 期望里面抛 `CheckViolation`,并且报错里有约束名。
- `with conn.transaction(force_rollback=True):` 开一个事务,`force_rollback=True` 表示不管里面成功还是失败,结束时一律回滚。这样测试插入的 `CT001` 客户不会留在库里。
- `conn.execute(NEW_CUSTOMER)` 先插客户。
- `conn.execute(NEW_SUB, ("CT001", "gold"))` 再插一条套餐叫 `gold` 的订阅,预期被 `CHECK` 拦下。
- `def test_foreign_key_rejects_unknown_customer(` 外键测试:订阅指向 `NOBODY` 这个不存在的客户。
- `def test_wrong_vector_dim_rejected(` 向量维度测试。
- `"INSERT INTO kb.chunks (doc_id, chunk_index, heading, content, embedding) "` 插入一块,向量只有两维,预期报 `1024 dimensions`。

</div>

```bash
uv run pytest tests/test_schema.py tests/test_db.py -v
```

```text
tests/test_schema.py::test_vector_dim_matches_settings PASSED            [ 14%]
tests/test_schema.py::test_every_create_is_rerunnable PASSED             [ 28%]
tests/test_schema.py::test_money_is_numeric_not_float PASSED             [ 42%]
tests/test_db.py::test_rows_are_dicts PASSED                             [ 57%]
tests/test_db.py::test_check_constraint_rejects_bad_plan PASSED          [ 71%]
tests/test_db.py::test_foreign_key_rejects_unknown_customer PASSED       [ 85%]
tests/test_db.py::test_wrong_vector_dim_rejected PASSED                  [100%]
============================== 7 passed in 0.40s ===============================
```

再看跳过的行为。把 `DATABASE_URL` 临时指向一个没人监听的端口,再指向一个没建过表的空库(我用 `createdb` 建了一个空库,测完删掉):

```bash
DATABASE_URL=postgresql://你的用户名@localhost:5999/x uv run pytest tests/test_db.py -q -rs
createdb empty_db
DATABASE_URL=postgresql://你的用户名@localhost:5432/empty_db uv run pytest tests/test_db.py -q -rs
dropdb empty_db
```

```text
ssss                                                                     [100%]
=========================== short test summary info ============================
SKIPPED [1] tests/test_db.py:32: 连不上数据库:connection failed: connection to server at "127.0.0.1", port 5999 failed: could not receive data from server: Connection refused
SKIPPED [1] tests/test_db.py:37: 连不上数据库:connection failed: connection to server at "127.0.0.1", port 5999 failed: Connection refused
SKIPPED [1] tests/test_db.py:45: 连不上数据库:connection failed: connection to server at "127.0.0.1", port 5999 failed: Connection refused
SKIPPED [1] tests/test_db.py:51: 连不上数据库:connection failed: connection to server at "127.0.0.1", port 5999 failed: could not receive data from server: Connection refused
4 skipped in 0.43s
```

```text
SKIPPED [1] tests/test_db.py:32: 库里还没建表(先 uv run python scripts/init_db.py):vector type not found in the database
SKIPPED [1] tests/test_db.py:37: 库里还没建表(先 uv run python scripts/init_db.py):vector type not found in the database
SKIPPED [1] tests/test_db.py:45: 库里还没建表(先 uv run python scripts/init_db.py):vector type not found in the database
SKIPPED [1] tests/test_db.py:51: 库里还没建表(先 uv run python scripts/init_db.py):vector type not found in the database
4 skipped in 0.65s
```

(报错里的 `127.0.0.1` 是我机器上 `localhost` 解析出来的地址。)四条测试都变成 `s`(skipped),原因写得清楚。这么做有个代价,要老实说:跳过会掩盖问题。如果有一天 CI 里数据库悄悄没起来,这四条测试全部「跳过」,看上去是绿的。所以 `-ra` 选项(Day 441 配的)要留着,让每个被跳过的原因都在汇总里打印出来,CI 里要专门盯一下「跳过数」。

## 第八步:提交,和架构表对账

```bash
uv run ruff check . && uv run ruff format --check .
uv run basedpyright
uv run pytest -q
git add -A
git commit -m "feat: 数据库表结构、连接封装、初始化脚本和测试"
```

```text
All checks passed!
16 files already formatted
0 errors, 0 warnings, 0 notes
......................                                                   [100%]
22 passed in 1.36s
```

```text
trim trailing whitespace.................................................Passed
fix end of files.........................................................Passed
check yaml...............................................................Passed
check toml...............................................................Passed
check for added large files..............................................Passed
detect private key.......................................................Passed
ruff check...............................................................Passed
ruff format..............................................................Passed
```

这次 `check yaml`、`check toml` 都是 `Passed`(不是 `Skipped`):提交里有了 `docker-compose.yml`(YAML)和被改过的 `pyproject.toml`(TOML,多了 `pgvector` 一行)。22 个测试是前一天的 15 个加今天的 7 个。

架构表对账:

```bash
cd ~/agent-zero-lab
uv run python -m part08.check_arch --day 443 ~/supportpilot
uv run python -m part08.check_arch ~/supportpilot | head -1
```

```text
方块有文件: 通过
文件有归属: 通过
依赖方向: 通过
方块有文件: 42 个问题
```

「方块有文件」的问题数从昨天的 45 降到 42:`db.py`、`docker-compose.yml`、`schema.sql` 三个方块今天有了文件。

## 零件和结果的对照

| 文件 | 哪一步 | 作用 |
| --- | --- | --- |
| `db/schema.sql` | 二、三 | 9 张表、外键、CHECK、向量列、HNSW 索引 |
| `docker-compose.yml` | 四 | 给用 Docker 的人起一个带 pgvector 的 Postgres(没实跑) |
| `src/supportpilot/db.py` | 五 | `connect()`:字典行、autocommit、注册 vector |
| `scripts/init_db.py` | 六 | 用裸连接建表,避开「vector type not found」 |
| `tests/test_schema.py` | 七 | 不连库:维度对账、可重复执行、不用浮点 |
| `tests/test_db.py` | 七 | 连库:三种约束各拦一次,连不上就跳过 |
| `pyproject.toml` / `uv.lock` | 一 | 多了 `pgvector` |

## 动手练习

### 练习 1:五种坏数据,在真表上读报错

**题目:** 在真正的业务表上(不是 demo),用一个事务试五种坏数据,最后整体回滚:重复邮箱、账单指向不存在的订阅、退款单状态写成 `done`、工单状态写成 `closed`、工单没写 `body`。每次读报错,说出是哪种约束拦的、约束名叫什么。

<details><summary>参考答案</summary>

写 `scratch/ex1.sql`。用 `SAVEPOINT` 让每条出错后回到保存点,继续试下一条,不然一条出错整个事务就作废了:

```sql
-- supportpilot/scratch/ex1.sql  五条坏数据,每条都在事务里,最后 ROLLBACK
BEGIN;
INSERT INTO biz.customers (id, name, email, created_at) VALUES ('C9001', '测试一', 't1@example.com', '2026-10-01');
SAVEPOINT s1;
INSERT INTO biz.customers (id, name, email, created_at) VALUES ('C9002', '测试二', 't1@example.com', '2026-10-01');
ROLLBACK TO s1;
INSERT INTO biz.invoices (id, customer_id, subscription_id, amount_cny, status, issued_at, period_start, period_end)
VALUES ('INV-X', 'C9001', 'S9999', 99, 'paid', '2026-10-01', '2026-10-01', '2026-11-01');
ROLLBACK TO s1;
INSERT INTO biz.refund_requests (id, invoice_id, customer_id, amount_cny, reason, rule, status)
VALUES ('RF-1', 'INV-X', 'C9001', 10, 'r', 'x', 'done');
ROLLBACK TO s1;
INSERT INTO biz.tickets (id, customer_email, subject, body, status) VALUES ('T1', 'a@b.c', 's', 'b', 'closed');
ROLLBACK TO s1;
INSERT INTO biz.tickets (id, customer_email, subject) VALUES ('T2', 'a@b.c', 's');
ROLLBACK;
```

<div class="line-notes">

- `BEGIN;` 开启事务,之后的改动在 `ROLLBACK` 之前都不算数。
- `INSERT INTO biz.customers (id, name, email, created_at) VALUES ('C9001'` 先插一个正常客户,后面的坏数据要引用它。
- `SAVEPOINT s1;` 打一个保存点。出错之后 `ROLLBACK TO s1` 只退回到这里,`C9001` 还在。
- `VALUES ('C9002', '测试二', 't1@example.com'` 邮箱和 `C9001` 一样,撞 `UNIQUE`。
- `ROLLBACK TO s1;` 退回保存点,事务恢复可用。
- `VALUES ('INV-X', 'C9001', 'S9999', 99, 'paid'` 订阅编号 `S9999` 不存在。
- `VALUES ('RF-1', 'INV-X', 'C9001', 10, 'r', 'x', 'done');` 状态 `done` 不在 `pending/approved/rejected/executed` 里。
- `INSERT INTO biz.tickets (id, customer_email, subject, body, status) VALUES ('T1'` 工单状态 `closed` 不合法。
- `INSERT INTO biz.tickets (id, customer_email, subject) VALUES ('T2'` 没写 `body`。
- `ROLLBACK;` 整个事务作废,库里什么都没留下。

</div>

```bash
psql supportpilot -f scratch/ex1.sql 2>&1 | grep -v "^SAVEPOINT\|^BEGIN\|ROLLBACK\|INSERT 0 1"
```

```text
psql:scratch/ex1.sql:5: ERROR:  duplicate key value violates unique constraint "customers_email_key"
DETAIL:  Key (email)=(t1@example.com) already exists.
psql:scratch/ex1.sql:8: ERROR:  insert or update on table "invoices" violates foreign key constraint "invoices_subscription_id_fkey"
DETAIL:  Key (subscription_id)=(S9999) is not present in table "subscriptions".
psql:scratch/ex1.sql:11: ERROR:  new row for relation "refund_requests" violates check constraint "refund_requests_status_check"
DETAIL:  Failing row contains (RF-1, INV-X, C9001, null, 10.00, r, x, done, 2026-10-27 13:09:14.032868+08, null, null, null).
psql:scratch/ex1.sql:13: ERROR:  new row for relation "tickets" violates check constraint "tickets_status_check"
DETAIL:  Failing row contains (T1, null, a@b.c, s, b, null, closed, 2026-10-27 13:09:14.032868+08, null, null).
psql:scratch/ex1.sql:15: ERROR:  null value in column "body" of relation "tickets" violates not-null constraint
DETAIL:  Failing row contains (T2, null, a@b.c, s, null, null, open, 2026-10-27 13:09:14.032868+08, null, null).
```

五条各被不同的约束拦下:`UNIQUE`(`customers_email_key`)、外键(`invoices_subscription_id_fkey`)、两个 `CHECK`(`refund_requests_status_check`、`tickets_status_check`)、`NOT NULL`。约束名是自动生成的「表名_列名_类型」,所以看到名字就能知道是哪张表哪一列。`Failing row` 里的 `13:09:14.032868+08` 是 `now()` 自动填的时间戳,带着我这边的时区。我没有 `COMMIT`,最后一行 `ROLLBACK` 让这五次尝试一个字都没留在库里。

</details>

### 练习 2:迁移——给客户表加一列手机号

**题目:** 表已经建好了。现在要给 `biz.customers` 加一列 `phone`(可以为空)。先**只改 `CREATE TABLE` 那一段**,重新运行 `init_db.py`,查 `phone` 列,看会发生什么;再用正确的办法(`ALTER TABLE`)让它真的加上,并且重复运行不报错。

<details><summary>参考答案</summary>

先用错的办法。把 `schema.sql` 里 `biz.customers` 的 `CREATE TABLE` 里 `company text,` 后面加一行 `phone       text,`,然后:

```bash
uv run python scripts/init_db.py
psql supportpilot -Atc "select phone from biz.customers"
```

```text
schema ready
ERROR:  column "phone" does not exist
LINE 1: select phone from biz.customers
               ^
```

`init_db.py` 说 `schema ready`,但列根本没有。原因:`CREATE TABLE IF NOT EXISTS` 遇到表已经存在就**整条跳过**,不会去比较列有没有变。`IF NOT EXISTS` 让脚本能重复运行,代价是它对已有的表什么都不改。

正确的办法是迁移:把改动写成 `ALTER TABLE`。先撤销上面对 `CREATE TABLE` 的修改,然后在 `schema.sql` **末尾**追加:

```sql
-- ---- 迁移:表建好以后再加的改动,一律追加在这里,每条都要能重复执行 ----
-- Day 443 练习 2:客户手机号
ALTER TABLE biz.customers ADD COLUMN IF NOT EXISTS phone text;
```

<div class="line-notes">

- `-- ---- 迁移:表建好以后再加的改动` 约定:原来的 `CREATE TABLE` 保持不动,以后每次改表,都往文件最后追加一条 `ALTER`。
- `ALTER TABLE biz.customers ADD COLUMN IF NOT EXISTS phone text;` 给已有的表加一列。`IF NOT EXISTS` 让它重复运行不报错。新列对已有的行是 `NULL`,所以不能加 `NOT NULL`(除非同时给 `DEFAULT`)。

</div>

```bash
uv run python scripts/init_db.py
uv run python scripts/init_db.py
psql supportpilot -Atc "select column_name from information_schema.columns where table_schema='biz' and table_name='customers' order by ordinal_position"
psql supportpilot -Atc "select phone from biz.customers"
```

```text
schema ready
schema ready
id
name
email
company
region
is_vip
created_at
phone
(此处为空,customers 表里还没有数据)
```

最后一条查询返回空,是因为这张表里现在没有任何行,不是出错(列存在,已经不报 `does not exist`)。`phone` 在列表最后,新加的列总是排在最后。跑两遍都是 `schema ready`,可重复执行。做完用 `ALTER TABLE biz.customers DROP COLUMN phone` 删掉、撤销 `schema.sql` 的改动,后面的天不用这一列。

这就是迁移最朴素的形式。真正的项目会用 Alembic 这类工具,给每次改动编号、记录「这个库已经执行到第几号」。我们 Day 466 要给 `biz.customer_profiles` 加一列 `source_hash`,用的就是上面这个写法(一条带 `IF NOT EXISTS` 的 `ALTER`)。

</details>

### 练习 3:每张表都必须有主键

**题目:** 没有主键的表,Agent 重试一次就会悄悄插进两行一样的数据。写一条连库测试 `tests/test_schema_live.py`:查出 `biz` 和 `kb` 两个 schema 里所有的表,断言每张表都有主键。再故意建一张没主键的表看它红。

<details><summary>参考答案</summary>

```python
# supportpilot/tests/test_schema_live.py
"""每张表都得有主键:没有主键的表,Agent 重试时就会悄悄插进重复行。"""

import psycopg
import pytest

from supportpilot.db import connect

ALL_TABLES = """
SELECT table_schema || '.' || table_name AS name FROM information_schema.tables
WHERE table_schema IN ('biz', 'kb') AND table_type = 'BASE TABLE'
"""
WITH_PK = """
SELECT table_schema || '.' || table_name AS name FROM information_schema.table_constraints
WHERE table_schema IN ('biz', 'kb') AND constraint_type = 'PRIMARY KEY'
"""


def test_every_table_has_primary_key():
    try:
        conn = connect()
    except (psycopg.OperationalError, psycopg.ProgrammingError) as e:
        pytest.skip(f"数据库没就绪:{str(e).splitlines()[0]}")
    with conn:
        all_tables = {r["name"] for r in conn.execute(ALL_TABLES)}
        with_pk = {r["name"] for r in conn.execute(WITH_PK)}
    assert all_tables, "一张表都没找到,先跑 init_db.py"
    assert all_tables - with_pk == set()
```

<div class="line-notes">

- `ALL_TABLES = """` 三个引号的多行字符串,放一条查询。`information_schema.tables` 是 Postgres 自带的「所有表的清单」。
- `SELECT table_schema || '.' || table_name AS name` `||` 是字符串拼接,得到 `biz.customers` 这种全名。
- `WHERE table_schema IN ('biz', 'kb') AND table_type = 'BASE TABLE'` 只看我们的两个 schema,并且只要真正的表(不要视图)。
- `WITH_PK = """` 第二条查询:有主键约束的表。`information_schema.table_constraints` 列出所有约束。
- `AND constraint_type = 'PRIMARY KEY'` 只要主键那一类。
- `except (psycopg.OperationalError, psycopg.ProgrammingError) as e:` 一个 `except` 里捕获两种异常,元组写法。
- `all_tables = {r["name"] for r in conn.execute(ALL_TABLES)}` 集合推导式。`conn.execute(...)` 返回的结果可以直接遍历,每一行是字典。
- `assert all_tables, "一张表都没找到,先跑 init_db.py"` 先保证确实查到了表,免得查不到时下一行的「差集为空」空转通过。`assert 条件, 消息` 失败时打印消息。
- `assert all_tables - with_pk == set()` 集合差:有表、没主键的。应该是空集。`set()` 是空集合。

</div>

```bash
uv run pytest tests/test_schema_live.py -q
psql supportpilot -qc "CREATE TABLE biz.notes (txt text)"
uv run pytest tests/test_schema_live.py -q
psql supportpilot -qc "DROP TABLE biz.notes"
```

```text
.                                                                        [100%]
1 passed in 0.51s
E       AssertionError: assert {'biz.notes'} == set()
E         
E         Extra items in the left set:
E         'biz.notes'
E         Use -v to get more diff
1 failed in 0.54s
```

正常状态通过,建了一张没主键的 `biz.notes` 之后红了,并且报错直接说出是哪张表。这条测试我做完没有留在仓库里(为了让后面的天测试数保持一致),你想保留也可以,它不会影响别的文件。

</details>

### 练习 4:换 embedding 模型,维度变了

**题目:** 假设要把 embedding 换成 768 维的模型。把 `.env` 里 `EMB_DIM` 改成 768,跑测试,看哪条红。再把 `schema.sql` 里的 `vector(1024)` 改成 `vector(768)`,重新 `init_db.py`,再往已经存在的 `kb.chunks` 里插一个 768 维向量,看会怎样。怎么才算真正换完?

<details><summary>参考答案</summary>

先只改 `schema.sql` 的 `vector(768)`,不动配置,跑 `uv run pytest tests/test_schema.py -q`:

```text
E       assert {768} == {1024}
E         
E         Extra items in the left set:
E         768
```

维度对账测试红了:schema 说 768,配置说 1024。再把 `.env` 里的 `EMB_DIM` 和默认值都改成 768,测试变绿(`3 passed`)。接着重新建表:

```bash
uv run python scripts/init_db.py
uv run python scratch/s8.py 2>&1 | tail -1
```

`scratch/s8.py` 往 `kb.chunks` 里插一个 768 维向量,代码和 `s7.py` 里插 1024 维那段一样,只是把 `[0.1] * 1024` 换成 `[0.1] * 768`。输出:

```text
schema ready
psycopg.errors.DataException: expected 1024 dimensions, not 768
```

`init_db.py` 说 `schema ready`,但表里的列**还是 1024 维**,插 768 维被拒绝。又是练习 2 里同一个原因:`CREATE TABLE IF NOT EXISTS` 对已经存在的表什么都不改。这次不能用 `ALTER` 简单解决(改向量列的维度会让已有的向量作废),唯一的办法是**删表重建,然后重新做向量化**:

```bash
psql supportpilot -qc "DELETE FROM kb.docs"
psql supportpilot -qc "DROP TABLE kb.chunks"
uv run python scripts/init_db.py
uv run python scratch/s8.py && echo inserted-768-ok
```

```text
schema ready
inserted-768-ok
```

所以「真正换完」是四件事一起做:改 `.env`(`EMB_DIM`)、改 `Settings` 的默认值、改 `schema.sql`、重建 `kb.chunks` 并重新导入全部文章。四处里漏掉任何一处,都会在不同的地方炸:漏了配置会被对账测试抓到;漏了重建表会在插入时报维度错误。所以导入脚本里最好也检查一次向量的长度,不对就拒绝写入。做完把一切改回 1024(`schema.sql`、`.env`、`config.py`),`DROP TABLE kb.chunks` 再 `init_db.py` 一次,后面的天都按 1024 写。

</details>

## 名词解释

| 名词 | 意思 |
| --- | --- |
| schema(模式) | 库里的「文件夹」,把表分组。我们用 `biz` 放业务表、`kb` 放知识库表。 |
| 约束(constraint) | 写在表定义里、由数据库强制执行的规则:`NOT NULL`、`UNIQUE`、`CHECK`、外键、主键。 |
| 外键 | 一列的值必须是另一张表某一行的主键,既不能引用不存在的,也不能删掉被引用的。 |
| `CHECK` | 写一个条件,不满足的行写不进去,比如套餐只能四选一。 |
| `numeric(10,2)` | 精确的小数类型,最多 10 位有效数字、2 位小数。算钱用它,不用浮点。 |
| `timestamptz` | 带时区的时间戳。`now()` 由数据库在插入时填。 |
| `ON DELETE CASCADE` | 外键的一个选项:删掉被引用的行时,引用它的行一起删。 |
| 迁移(migration) | 表建好之后,用一条条可重复的改动(如 `ALTER TABLE`)改变表结构。 |
| `autocommit` | 连接的一种模式:每条语句执行完自动提交,不用手动 `commit()`。 |
| `dict_row` | psycopg 的行工厂,让查询结果的每一行是字典。 |
| `register_vector` | 让一条连接认识 `vector` 类型,Python 列表和向量互转。库里必须已有 vector 扩展才能调用。 |
| `SAVEPOINT` | 事务里的保存点,出错后可以只退回到这里,不用整个事务作废。 |

## 常见误区

**以为 `CREATE TABLE IF NOT EXISTS` 能同步表结构。** 它只回答「这张表有没有」,不比较列。表已经存在,你改了建表语句,它整条跳过,还告诉你 `schema ready`。改已有的表要用 `ALTER TABLE`,练习 2 和练习 4 都撞过。

**以为 `numeric(10,2)` 会拒绝多余的小数位。** 它会悄悄四舍五入。我插了 `99.456`,存进去的是 `99.46`,没有任何提示。需要拒绝的话,要在 `CHECK` 里自己写条件,或者在代码里先校验。

**金额用浮点数。** `0.1 + 0.2` 在 `float8` 里是 `0.30000000000000004`,`numeric` 里是 `0.3`。

**在空库上直接调 `connect()`。** `register_vector` 要去查 `vector` 类型,类型要 `CREATE EXTENSION` 之后才有。第一次建表用裸的 `psycopg.connect`,建好之后再用 `connect()`。我第一次就在这里卡住,报 `vector type not found in the database`,查了半天才反应过来是先有鸡还是先有蛋。

**把外键当成只是「方便 JOIN 的标记」。** 它是强制的:不让引用不存在的行,也不让删掉还被引用的行(第二步我想删 `C0001` 就被拦下了)。清理测试数据时要先删子表再删父表,或者用 `CASCADE`。

**Docker 和 Postgres.app 同时开。** 两个都想占 5432 端口,后启动的那个会失败(`port is already allocated`)。选一个。

**连库测试连不上就算过。** 我给 `test_db.py` 的做法是跳过并说明原因,代价是库悄悄没起来时它们全部「绿」着跳过。别丢掉 `-ra`,CI 里要盯着跳过的数量。

## 学习资料

### 文档与文章

- [PostgreSQL 17 文档 · Constraints](https://www.postgresql.org/docs/17/ddl-constraints.html):`CHECK`、`NOT NULL`、`UNIQUE`、主键、外键一页讲完,每种都有例子。外键那一节里的 `ON DELETE` 各选项(`CASCADE`、`RESTRICT`、`SET NULL`)今天只用了 `CASCADE`,读一下别的怎么选。30 分钟。
- [PostgreSQL 17 文档 · Schemas](https://www.postgresql.org/docs/17/ddl-schemas.html):`biz.customers` 这种写法背后的规则,包括默认的 `public` schema 和搜索路径。15 分钟。
- [PostgreSQL 17 文档 · Numeric Types](https://www.postgresql.org/docs/17/datatype-numeric.html):`numeric(precision, scale)` 的含义和四舍五入规则,对应今天 `99.456` 变成 `99.46` 的那一条。
- [pgvector 仓库 README](https://github.com/pgvector/pgvector):`vector` 类型、距离运算符(`<->`、`<=>`)、HNSW 索引的参数,都在这里。看「Indexing」那一节,理解 `vector_cosine_ops` 为什么要和 `<=>` 配对。
- [psycopg 3 文档 · Transactions management](https://www.psycopg.org/psycopg3/docs/basic/transactions.html):`autocommit`、`conn.transaction()`、嵌套事务和 `force_rollback`,今天测试里用到的都在这一页。
- [Docker 文档 · Compose](https://docs.docker.com/compose/):`docker-compose.yml` 每个键的含义。今天那一节我没实跑,想用 Docker 的话先过一遍快速开始。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1AtQJB4E9o&autoplay=0&high_quality=1" title="PostgreSQL零基础入门课程" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>枫枫知道 · PostgreSQL零基础入门课程 · 约 3 小时 9 分,2026 年,播放 12 万多。Day 228 推荐过。这是一整门课,今天不用全看,挑讲建表、主键、外键、约束的那几节,对照今天 `schema.sql` 里每一种写法在视频里怎么讲。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1Pk8M6rEhm&autoplay=0&high_quality=1" title="有了 PostgreSQL,为什么还要 pgvector?" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>计算机大白话 · 有了 PostgreSQL,为什么还要 pgvector? · 约 4 分钟,2026 年。讲业务数据和向量放在同一个库里的好处,对应我们把 `biz` 和 `kb` 放进同一个 Postgres 的决定。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/t8ZJYlsBQdU" title="SQL Constraints: PRIMARY KEY, UNIQUE, NOT NULL, DEFAULT, CHECK, FOREIGN KEY (PostgreSQL)" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Prateek Goel | GrowAsEngineers · SQL Constraints: PRIMARY KEY, UNIQUE, NOT NULL, DEFAULT, CHECK, FOREIGN KEY (PostgreSQL) · 英文,可开自动字幕。六种约束各演示一遍,正好是今天第二步和练习 1 撞过的那几种。我没有逐分钟核对内容,按标题当作约束的补充看。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/Ua6LDIOVN1s" title="18 Months of Pgvector Learnings in 47 Minutes (Tutorial)" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Tiger Data (creators of TimescaleDB) · 18 Months of Pgvector Learnings in 47 Minutes (Tutorial) · 英文,47 分钟。讲 pgvector 在真实项目里踩过的坑,包括索引选择。今天只看讲 HNSW 和向量列的部分,Day 450 做检索时会回来。</figcaption>
</figure>

### 书籍

- Bill Karwin《SQL Antipatterns: Avoiding the Pitfalls of Database Programming》(Pragmatic Bookshelf,2010)。逻辑设计那一部分讲了很多「表这么设计会出事」的案例,和今天「让错误数据写不进去」是同一个思路。我没查到可靠的中文版信息,只写英文原版。

### 开源项目与代码

- [pgvector/pgvector-python](https://github.com/pgvector/pgvector-python):今天 `uv add pgvector` 装的包。README 里有 psycopg 3 那一节,就是 `register_vector` 的出处。
- [pgvector/pgvector](https://github.com/pgvector/pgvector):扩展本身,C 写的。想看 HNSW 怎么实现可以读 `src/hnsw*.c`。

## 自测

1. 为什么用 `CHECK` 约束限制套餐和状态,而不只是在提示词里告诉模型「只能用这四种」?

<details><summary>答案</summary>

提示词是建议,约束是强制。模型可能编出 `gold` 这样的值,代码也可能有 bug。数据库在最底层拒绝,错误数据根本进不去,而且报错带着整行内容,方便排查。第二步我插了 `plan='gold'`,直接被 `subscriptions_plan_check` 拦下。能在越底层拦住的错误,越不要指望上层。

</details>

2. 外键拦住的两类操作是什么?

<details><summary>答案</summary>

一是插入一行引用不存在的父行(订阅的 `customer_id` 是 `C9999`,客户表里没有),二是删除一个还被引用的父行(想删客户 `C0001`,他还有一张订阅)。我在第二步两种都撞过。

</details>

3. 为什么金额用 `numeric(10,2)` 不用浮点?`numeric(10,2)` 会拒绝 `99.456` 吗?

<details><summary>答案</summary>

浮点有二进制误差,`0.1 + 0.2` 在 `float8` 里是 `0.30000000000000004`,`numeric` 里是精确的 `0.3`。算钱要精确。`numeric(10,2)` **不会拒绝** `99.456`,它悄悄四舍五入成 `99.46`。要拒绝得另外写 `CHECK`,或者在代码里校验。

</details>

4. `register_vector(conn)` 为什么会在空库上报 `vector type not found`?怎么绕?

<details><summary>答案</summary>

它要去数据库里查 `vector` 类型,而这个类型是 `CREATE EXTENSION vector` 之后才存在的。空库还没跑过 `schema.sql`,所以找不到。绕法:第一次建表用裸的 `psycopg.connect`(不注册 vector),建好之后才用 `connect()`,这就是 `init_db.py` 不走 `db.connect()` 的原因。

</details>

5. 给已经存在的表加一列,为什么只改 `CREATE TABLE ... IF NOT EXISTS` 没用?该怎么做?

<details><summary>答案</summary>

`IF NOT EXISTS` 在表已经存在时整条语句跳过,不比较列,所以脚本说「建好了」,列却没加。要用 `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`,追加在 `schema.sql` 末尾,每条都能重复执行。这是迁移最朴素的形式。

</details>

6. **面试题**:「你的 Agent 项目里,怎么防止模型把脏数据写进数据库?」

<details><summary>答案</summary>

分层。最底层是数据库自己:枚举类的列用 `CHECK`,引用关系用外键,必填用 `NOT NULL`,金额用 `numeric`,所以就算模型编出一个不存在的套餐或客户,写入会直接失败,带着整行内容报错。上一层是工具的入参校验(pydantic),再上一层才是提示词。退款这类有风险的操作,表结构也配合:退款申请是独立的表,状态默认 `pending`,Agent 只能建单,往后推进要人来批,每条命中的规则存进 `rule` 字段,所有写操作进审计日志。我还写了连库测试,在事务里故意插坏数据,断言 `CheckViolation`、`ForeignKeyViolation` 真的被抛出,最后回滚,不污染库。

</details>

## 明天预告

明天是 Day 444 · 搭骨架(四):造帮助中心 60+ 篇。表建好了,里面还是空的。明天往 `kb.docs` 的上游造数据:先写一份「事实源」`kb_facts.py`,把价格、退款天数、手续费这些数字只写一次,再写 `gen_kb.py` 把事实渲染成 62 篇 markdown 文章放进 `data/kb/`,再写检查脚本抓断掉的交叉引用。我还会实测一件事:为什么不直接让大模型写这 62 篇,让它写三遍同一篇,三遍的退款政策长得不一样。
