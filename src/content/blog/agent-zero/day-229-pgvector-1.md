---
title: 'Day 229 · pgvector(一):为什么选它,扩展和建表'
description: '在昨天的 agentzero 库里执行 CREATE EXTENSION vector,让 Postgres 多出一种 vector 列类型。先用一张 3 维的玩具表摸清它:维度写错直接拒、每个向量占 4×维度+8 字节、超过 2000 维建不了索引。再从 Python 写入读出向量(register_vector 和 Vector 对象),最后写 part04/pg_store.py,建好存 42 块的 kb_chunks 表。'
pubDate: 2026-10-22
regime: none
tags: ['pgvector', 'postgres', 'vector-database', 'psycopg', 'agent-zero']
series: 'agent-zero'
day: 229
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 228](/blog/agent-zero/day-228-postgres-basics/) 装好了 Postgres.app,建了 `agentzero` 库,在 psql 里建了 `customers` 表,又用 `psycopg` 从 Python 连上去,踩了 `?` 占位符、连错端口、忘了提交三个坑。最重要的收获是一个认识:Postgres 是一个一直在跑的服务,多个客户端可以同时连同一份数据,类型是硬约束。

但现在这个库只认识数字、文字、时间这些普通类型,没法存 `(1024,)` 的 embedding。今天给它装上 pgvector,让它多出一种 `vector` 列类型,然后建好以后几天都要用的知识库表 `kb_chunks`。今天只建表,不往里写真数据:把 42 块写进去、只更新改过的块,是 [Day 231](/blog/agent-zero/day-231-pgvector-2/) 的事。

## 今天要解决的问题

学完今天,你应该能做到:

1. 说出课程选 pgvector 的理由:比 Day 225 的 `.npy` 文件多了什么,比 Milvus、Qdrant 这类专门的向量数据库少了什么麻烦。
2. 说清**扩展**是什么、和表有什么区别,会用 `CREATE EXTENSION vector` 在一个库里启用它、用 `\dx` 查看;知道每个库要单独启用,没启用就建表会报 `type "vector" does not exist`。
3. 会写 `vector(3)` 这样的列和 `'[0.9, 0.1, 0.0]'` 这样的向量值,能用实测说出三件事:维度不对直接报错,1024 维每个约占 4104 字节,超过 2000 维的列建不了 HNSW 索引(`halfvec` 可以到 4000)。
4. 写出 `part04/pg_store.py`:`connect()` 里先启用扩展再 `register_vector`,`SCHEMA` 用 `sql.SQL(...).format(dim=sql.Literal(DIM))` 拼出 `vector(1024)`,`init_schema()` 跑几次都不报错。

预计用时 2.5 小时:为什么选 pgvector 20 分钟,扩展和玩具表 50 分钟,Python 里读写向量 30 分钟,`pg_store.py` 30 分钟,剩下做练习。前置:[Day 228](/blog/agent-zero/day-228-postgres-basics/) 的 `agentzero` 库、`.env` 里的 `PG_DSN`、`psycopg`;[Day 225](/blog/agent-zero/day-225-numpy-index/) 的 `index/` 和 `load_index()`;[Day 224](/blog/agent-zero/day-224-chunking/) 的 `Chunk` 六个字段;[Day 220](/blog/agent-zero/day-220-embed-cost/) 讲的「4×维度+8」和 2000 维上限;[Day 215](/blog/agent-zero/day-215-cosine/) 的余弦距离 `<=>`。

今天不调任何模型接口,也不算 embedding(练习 1 用的是 Day 225 已经存好的向量),API 花费 0 元。

学法:先对照文章逐行敲一遍(不复制粘贴)并跑通;第二天合上文章默写 `pg_store.py` 的 `SCHEMA` 和 `connect()`;做练习,做不出再展开参考答案,看完关掉自己重写一遍。

## 为什么选 pgvector

先说清楚 Day 225 那套 `.npy + JSON` 到底差在哪。42 块、一次矩阵乘法零点几毫秒,当学习工具它其实很好。可一旦想把它变成客服系统的后端,下面几件事它一件都做不到:

改了一篇文章,只想重算那两块的向量,但 `.npy` 是一整个数组,只能整体重写,两个文件还得同时换(Day 225 演示过只换一个会安静地取错块)。产品说「这个问题只在退款类里找」,你得自己写过滤代码。三台服务器都要查,每台各放一份文件,怎么同步、怎么保证同时切换,都得自己操心。知识库涨到几十万块,每次查询都把整个矩阵乘一遍,内存和时间都扛不住。

这些事数据库早就解决了:按主键更新一行、`WHERE category = '退款'`、多个客户端连同一个服务、索引。所以我们需要一个**能存向量、能按相似度查的数据库**,也就是向量数据库。

市面上有两类做法。一类是专门的向量数据库,比如 Milvus、Qdrant、Chroma,从头为向量检索设计。另一类是给现成的数据库加上向量能力,pgvector 就是这一类:它不是一个新的数据库,而是 Postgres 的一个**扩展**,装上之后 Postgres 多了一种 `vector` 列类型、几个距离运算符和两种向量索引,其余一切照旧,事务、备份、权限、SQL 都是原来那套。

课程选 pgvector,理由很实际。第一,你昨天刚学会 Postgres,pgvector 的学习成本几乎只有「多了一种列类型」。第二,CloudLedger 的客户、订阅、发票这些业务数据本来就该放在关系库里,知识库放进同一个 Postgres,少维护一套系统,一条 SQL 就能把「文章相似度」和「这个客户是什么套餐」关联起来。第三,Postgres.app 自带 pgvector,不用另外装。至于规模,几百万量级的向量 pgvector 加 HNSW 索引跑得很好,大多数公司的知识库远没到需要换专门系统的地步。

当然它也有边界:上亿条、要分布式、要 GPU 加速时,专门的向量数据库更合适。面试官问「为什么不用 Milvus」时要能讲出取舍,这个放到 [Day 234](/blog/agent-zero/day-234-filter-pitfall/) 和过滤的坑一起讲,今天先把它用起来。

## 第一步:扩展是什么,先踩一次坑

**扩展**(extension)是给 Postgres 加功能的插件:一包代码,装进去之后数据库多出新的类型、函数、运算符或索引方式。类比前端:扩展像 `npm install` 一个库,装好以后才能 `import` 里面的类型;表像你用这些类型装数据的数组。两者完全不是一类东西,扩展装的是代码,表装的是一行行数据。

扩展的文件已经随 Postgres.app 装在你电脑上了,但它不会自动生效。`CREATE EXTENSION` 的作用是把它**启用到当前这个库**。我们先故意不启用,直接建一张带向量列的表,看会怎样。打开 psql:

```bash
psql -d agentzero
```

在里面依次敲:

```sql
CREATE TABLE toy (id integer PRIMARY KEY, label text NOT NULL, embedding vector(3));
\dx
SELECT name, default_version, installed_version FROM pg_available_extensions WHERE name = 'vector';
```

<div class="line-notes">

- `CREATE TABLE toy (id integer PRIMARY KEY, label text NOT NULL, embedding vector(3));` 一张玩具表,三列。`embedding vector(3)` 想声明一个 3 维向量列。用 3 维是为了眼睛看得过来,原理和 1024 维一样。
- `\dx` 昨天没讲的一个元命令:列出当前库已经启用的扩展,`x` 是 extension。
- `SELECT name, default_version, installed_version FROM pg_available_extensions WHERE name = 'vector';` `pg_available_extensions` 是一张系统视图,列出这台服务上**能装**的扩展。`default_version` 是可装的版本,`installed_version` 是当前库装了的版本。

</div>

我的输出:

```text
ERROR:  type "vector" does not exist
LINE 1: ...teger PRIMARY KEY, label text NOT NULL, embedding vector(3))...
                                                             ^
                 List of installed extensions
  Name   | Version |   Schema   |         Description
---------+---------+------------+------------------------------
 plpgsql | 1.0     | pg_catalog | PL/pgSQL procedural language
(1 row)

  name  | default_version | installed_version
--------+-----------------+-------------------
 vector | 0.8.6           |
(1 row)
```

三段输出连起来就是完整的诊断:建表失败,因为不认识 `vector` 这个类型;`\dx` 里只有一个自带的 `plpgsql`,没有 vector;但 `pg_available_extensions` 说 vector 0.8.6 是**能装**的,`installed_version` 是空的,也就是还没在这个库里启用。Postgres.app 2.9.6 带的是 pgvector 0.8.6,2026 年 10 月 pgvector 最新发布的是 0.8.7,差一个小版本,今天和后面几天用到的功能两个版本都有。

现在启用它,再建一次:

```sql
CREATE EXTENSION IF NOT EXISTS vector;
\dx
SELECT '[1, 2, 3]'::vector;
CREATE TABLE toy (id integer PRIMARY KEY, label text NOT NULL, embedding vector(3));
```

<div class="line-notes">

- `CREATE EXTENSION IF NOT EXISTS vector;` 在当前库启用 pgvector。扩展的名字叫 `vector`,不叫 pgvector。`IF NOT EXISTS` 让这句重复执行也不报错,后面写进代码里时很重要。
- `\dx` 再看一次已启用的扩展。
- `SELECT '[1, 2, 3]'::vector;` 先单独试一个向量值。`'[1, 2, 3]'` 是一个普通字符串,`::vector` 是把它转成 vector 类型(Day 228 练习 4 用过 `::float8`)。向量的文字写法就是方括号加逗号,和 JSON 数组一样。
- `CREATE TABLE toy (` 同一句建表,这次应该成功。

</div>

```text
CREATE EXTENSION
                             List of installed extensions
  Name   | Version |   Schema   |                     Description
---------+---------+------------+------------------------------------------------------
 plpgsql | 1.0     | pg_catalog | PL/pgSQL procedural language
 vector  | 0.8.6   | public     | vector data type and ivfflat and hnsw access methods
(2 rows)

 vector
---------
 [1,2,3]
(1 row)

CREATE TABLE
```

vector 的描述写得很直白:「向量数据类型,以及 ivfflat 和 hnsw 两种访问方法」。访问方法就是索引的实现方式,HNSW 在 [Day 233](/blog/agent-zero/day-233-hnsw/) 专门讲。

**扩展是按库启用的。** 刚才只在 `agentzero` 里启用了,别的库照样不认识 `vector`。练习 4 会建一个空库验证。这也是为什么后面的 Python 代码每次连接都要先执行一遍 `CREATE EXTENSION IF NOT EXISTS vector`:换一个新库它也能跑。

## 第二步:vector 类型长什么样

往玩具表里放三个「假 embedding」,假装第一维代表退款、第二维代表发票、第三维代表登录:

```sql
INSERT INTO toy VALUES
    (1, '退款', '[0.9, 0.1, 0.0]'),
    (2, '发票', '[0.1, 0.9, 0.1]'),
    (3, '登录', '[0.0, 0.2, 0.9]');
SELECT * FROM toy;
INSERT INTO toy VALUES (4, '两维的', '[0.5, 0.5]');
INSERT INTO toy VALUES (5, '字母', '[a, b, c]');
\d toy
```

<div class="line-notes">

- `INSERT INTO toy VALUES` 插三行。向量值就写成字符串,列是 `vector(3)` 类型,Postgres 会自动转换,不用写 `::vector`。
- `(1, '退款', '[0.9, 0.1, 0.0]'),` 退款这一行几乎全在第一维上。
- `SELECT * FROM toy;` 读出来看看。
- `INSERT INTO toy VALUES (4, '两维的', '[0.5, 0.5]');` 故意少一维。
- `INSERT INTO toy VALUES (5, '字母', '[a, b, c]');` 故意塞非数字。
- `\d toy` 看表结构。

</div>

```text
INSERT 0 3
 id | label |   embedding
----+-------+---------------
  1 | 退款  | [0.9,0.1,0]
  2 | 发票  | [0.1,0.9,0.1]
  3 | 登录  | [0,0.2,0.9]
(3 rows)

ERROR:  expected 3 dimensions, not 2
ERROR:  invalid input syntax for type vector: "[a, b, c]"
LINE 1: INSERT INTO toy VALUES (5, '字母', '[a, b, c]');
                                           ^
                   Table "public.toy"
  Column   |   Type    | Collation | Nullable | Default
-----------+-----------+-----------+----------+---------
 id        | integer   |           | not null |
 label     | text      |           | not null |
 embedding | vector(3) |           |          |
Indexes:
    "toy_pkey" PRIMARY KEY, btree (id)
```

读出来的 `0.0` 显示成了 `0`,空格也没了,只是显示格式,值没变。两条故意出错的 INSERT 都被拒了。第一条最值得记住:**`vector(3)` 里的 3 是硬约束**,维度不对直接报 `expected 3 dimensions, not 2`。

这个报错在 RAG 里是好事。还记得 [Day 217](/blog/agent-zero/day-217-embed-service/) 说过建索引和查询必须用同一个 embedding 模型吗?不同模型的维度经常不一样(bge-m3 是 1024,OpenAI 的 text-embedding-3-small 是 1536),混用时 numpy 那边要么报一个看不懂的形状错误,要么维度碰巧一样就安静地给出接近随机的分数。在 pgvector 里,列声明成 `vector(1024)`,1536 维的向量根本写不进去。昨天说 Postgres 的类型是硬约束,用在这里正合适。

声明列时括号里的维度可以不写(`embedding vector`),那样什么维度都能存。别这么做:一来失去了上面这道检查,二来没有固定维度的列建不了向量索引。

### 一个向量占多大

[Day 220](/blog/agent-zero/day-220-embed-cost/) 按 pgvector 文档算过,每个向量占 `4 × 维度 + 8` 字节:每个数是 4 字节的 float32,再加 8 字节的头信息(记录维度等)。现在可以在数据库里亲自量一下,`pg_column_size()` 返回一个值占多少字节,`vector_dims()` 返回向量的维度:

```sql
SELECT pg_column_size('[1,2,3]'::vector) AS v3,
       pg_column_size(array_fill(0.1, ARRAY[1024])::vector) AS v1024;
SELECT vector_dims(embedding), embedding FROM toy WHERE id = 1;
```

<div class="line-notes">

- `SELECT pg_column_size('[1,2,3]'::vector) AS v3,` 一个 3 维向量的大小。公式算是 4×3+8=20。
- `pg_column_size(array_fill(0.1, ARRAY[1024])::vector) AS v1024;` `array_fill(0.1, ARRAY[1024])` 造一个 1024 个 0.1 的 Postgres 数组,再转成 vector,省得手写 1024 个数。公式算是 4×1024+8=4104。
- `SELECT vector_dims(embedding), embedding FROM toy WHERE id = 1;` 从表里读出退款那一行的维度。

</div>

```text
 v3 | v1024
----+-------
 20 |  4104
(1 row)

 vector_dims |  embedding
-------------+-------------
           3 | [0.9,0.1,0]
(1 row)
```

20 和 4104,和公式一模一样。顺带说一个我量的时候发现的小出入:同样的向量**存进表里以后**再量,3 维是 17 字节、1024 维是 4100 字节,比公式少几个字节,这是 Postgres 存储层对头部的压缩处理,我没再往下深究。估算存储时用文档公式就够了,只会略微偏大。42 块 × 4104 字节约 168 KB,和 Day 225 的 `vectors.npy` 172 KB 是一个量级。

### 2000 维的线和 halfvec

Day 220 提过一个硬限制:`vector` 类型最多能存 16000 维,但 HNSW 和 IVFFlat 两种向量索引最多只支持 2000 维。今天用一个 2001 维的列验证一下,顺便看半精度的 `halfvec`:

```sql
CREATE TABLE big (id integer PRIMARY KEY, e vector(2001));
CREATE INDEX ON big USING hnsw (e vector_cosine_ops);
CREATE TABLE big_half (id integer PRIMARY KEY, e halfvec(2001));
CREATE INDEX ON big_half USING hnsw (e halfvec_cosine_ops);
DROP TABLE big, big_half;
```

<div class="line-notes">

- `CREATE TABLE big (id integer PRIMARY KEY, e vector(2001));` 2001 维的列,建表本身没问题。
- `CREATE INDEX ON big USING hnsw (e vector_cosine_ops);` 在这一列上建 HNSW 索引。这句语法今天不用细究,`USING hnsw` 是索引类型,`vector_cosine_ops` 表示按余弦距离建,Day 233 会讲。
- `CREATE TABLE big_half (id integer PRIMARY KEY, e halfvec(2001));` 同样 2001 维,类型换成 `halfvec`:每个数用 2 字节的半精度浮点数。
- `CREATE INDEX ON big_half USING hnsw (e halfvec_cosine_ops);` 对应的运算符类也要换成 `halfvec_cosine_ops`。
- `DROP TABLE big, big_half;` 实验完删掉,别留垃圾表。

</div>

```text
CREATE TABLE
ERROR:  column cannot have more than 2000 dimensions for hnsw index
CREATE TABLE
CREATE INDEX
DROP TABLE
```

`vector(2001)` 的表能建,索引建不了;`halfvec(2001)` 两样都行。所以如果你选了一个默认 4096 维的模型(Day 220 提到的 Qwen3-Embedding-8B),要么让接口返回更低的维度,要么用 `halfvec`。我们用的 bge-m3 是 1024 维,两条线都碰不到,课程里一直用 `vector`。halfvec 省一半空间,代价是精度,练习 2 会量。

## 第三步:从 Python 读写向量

psql 里能玩了,接下来让 Python 代码写入一个 numpy 向量。新建 `part04/pg_vec_noreg.py`,先用昨天的写法直接传:

```python
# agent-zero-lab/part04/pg_vec_noreg.py
import os

import numpy as np
import psycopg
from dotenv import load_dotenv

load_dotenv()
v = np.array([0.8, 0.2, 0.1], dtype=np.float32)
with psycopg.connect(os.environ["PG_DSN"]) as conn:
    conn.execute("INSERT INTO toy VALUES (%s, %s, %s)", (4, "改密码", v))
```

<div class="line-notes">

- `v = np.array([0.8, 0.2, 0.1], dtype=np.float32)` 一个 3 维的 float32 数组,和 `embed_one()` 返回的东西是同一种,只是短。
- `conn.execute("INSERT INTO toy VALUES (%s, %s, %s)", (4, "改密码", v))` 第三个参数直接传 numpy 数组。

</div>

```bash
cd /Users/你/agent-zero-lab
uv run python -m part04.pg_vec_noreg
```

```text
psycopg.ProgrammingError: cannot adapt type 'ndarray' using placeholder '%s' (format: AUTO)
```

psycopg 不知道怎么把一个 `ndarray` 变成 SQL 参数。「adapt」是驱动的术语:把 Python 对象转换成数据库认识的格式,叫适配。整数、字符串、`Decimal` 它都内置了适配规则,numpy 数组和 `vector` 类型它不认识。

pgvector 官方提供了一个 Python 包专门干这件事:

```bash
uv add pgvector
```

我装到的是 pgvector 0.5.1(2026 年 10 月)。注意 Python 包叫 `pgvector`,和数据库扩展同名但是两样东西:扩展装在 Postgres 里,Python 包装在你的 `.venv` 里,负责两边之间的翻译。新建 `part04/pg_vec.py`:

```python
# agent-zero-lab/part04/pg_vec.py
import os

import numpy as np
import psycopg
from dotenv import load_dotenv
from pgvector.psycopg import register_vector

load_dotenv()
v = np.array([0.8, 0.2, 0.1], dtype=np.float32)
with psycopg.connect(os.environ["PG_DSN"]) as conn:
    register_vector(conn)
    conn.execute("INSERT INTO toy VALUES (%s, %s, %s)", (4, "改密码", v))
    row = conn.execute("SELECT label, embedding FROM toy WHERE id = %s", (4,)).fetchone()
    assert row is not None
    label, emb = row
    print(label, type(emb).__name__, emb)
    arr = emb.to_numpy()
    print("转回 numpy:", arr.dtype, arr.shape, "和存进去的一样:", bool(np.allclose(arr, v)))
```

<div class="line-notes">

- `from pgvector.psycopg import register_vector` pgvector 包里给 psycopg 用的那部分。它也支持 SQLAlchemy、Django 等别的库,各有各的子模块。
- `register_vector(conn)` 在这条连接上注册「numpy 数组 ↔ vector」的转换规则。它要去数据库里查 `vector` 类型的内部编号,所以**必须在扩展启用之后调用**,下面会演示反过来的后果。
- `conn.execute("INSERT INTO toy VALUES (%s, %s, %s)", (4, "改密码", v))` 和刚才一模一样的一句,这次能写进去了。
- `row = conn.execute("SELECT label, embedding FROM toy WHERE id = %s", (4,)).fetchone()` 读回刚写的那行。
- `assert row is not None` `fetchone()` 可能返回 `None`,`assert` 告诉类型检查器(也告诉读代码的人)这里一定有行,不然直接报错停下。
- `label, emb = row` 解包成两个变量。
- `print(label, type(emb).__name__, emb)` 实测打印 `改密码 Vector Vector([0.800000011920929, 0.20000000298023224, 0.10000000149011612])`。读回来的不是 numpy 数组,是 pgvector 包自己的 `Vector` 对象。
- `arr = emb.to_numpy()` 转成 numpy 数组。
- `print("转回 numpy:", arr.dtype, arr.shape,` 实测 `float32 (3,)`,`np.allclose` 比较为 `True`。

</div>

```text
改密码 Vector Vector([0.800000011920929, 0.20000000298023224, 0.10000000149011612])
转回 numpy: float32 (3,) 和存进去的一样: True
```

两个细节。第一,0.8 打印成了 `0.800000011920929`,不是 bug:0.8 存成 float32 本来就是这个最接近的近似值,`Vector` 打印时用的是 Python 的 float(64 位)把它完整显示了出来。[Day 220](/blog/agent-zero/day-220-embed-cost/) 说过 embedding 用 float32 存就够了,这点误差对检索没影响。在 psql 里 `SELECT * FROM toy` 看到的还是 `[0.8,0.2,0.1]`,因为 Postgres 按 float32 的精度显示。第二,写入可以直接传 numpy 数组,读出来却是 `Vector` 对象,要 `.to_numpy()` 才是数组。我第一版直接写 `emb.dtype`,报了 `AttributeError: 'Vector' object has no attribute 'dtype'`。Day 232 从库里取向量做对比时会用到这个转换。

### 故意踩坑:先注册、后启用扩展

`register_vector` 必须在 `CREATE EXTENSION` 之后,这个顺序很容易写反。建一个从没启用过扩展的空库试试:

```bash
createdb agentzero_empty
```

新建 `part04/pg_reg_first.py`:

```python
# agent-zero-lab/part04/pg_reg_first.py
import psycopg
from pgvector.psycopg import register_vector

with psycopg.connect("postgresql://localhost:5432/agentzero_empty") as conn:
    register_vector(conn)
```

<div class="line-notes">

- `with psycopg.connect("postgresql://localhost:5432/agentzero_empty") as conn:` 连那个刚建的空库。连接串里没写用户名,psycopg 默认用你的 Mac 用户名,和 psql 一样。
- `register_vector(conn)` 在没有 vector 扩展的库里注册。

</div>

```bash
uv run python -m part04.pg_reg_first
dropdb agentzero_empty
```

```text
psycopg.ProgrammingError: vector type not found in the database
```

`vector type not found in the database`:它去库里找 vector 类型,找不到。修法就是先执行 `CREATE EXTENSION IF NOT EXISTS vector` 再注册,下面的 `connect()` 就是这么写的。实验完用 `dropdb` 把空库删掉。

## 第四步:pg_store.py,建 kb_chunks 表

玩具摸清了,现在建真正的知识库表。它要存 Day 224 的 42 个 `Chunk`,每块一行。先对一下 `Chunk` 的六个字段:`id`(kb-002#3)、`doc_id`(kb-002)、`title`、`category`、`section`、`text`。表里除了这六样,还要加三列:向量本身、内容指纹、更新时间。

<figure>
<svg viewBox="0 0 640 330" role="img" aria-label="左边是 Day 224 的 Chunk 六个字段和 Day 225 的 vectors.npy 一行,右边是 kb_chunks 表的九列,箭头表示一一对应,content_hash 和 updated_at 是新增列">
<rect x="0" y="0" width="640" height="330" fill="var(--paper-raised)"/>
<g font-family="var(--font-mono)" font-size="12">
<text x="20" y="24" fill="var(--ink)">Day 224/225 的产物</text>
<rect x="20" y="36" width="200" height="164" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="32" y="56" fill="var(--ink)">Chunk(chunks.json)</text>
<text x="32" y="80" fill="var(--ink-soft)">id       kb-002#3</text>
<text x="32" y="100" fill="var(--ink-soft)">doc_id   kb-002</text>
<text x="32" y="120" fill="var(--ink-soft)">title</text>
<text x="32" y="140" fill="var(--ink-soft)">category</text>
<text x="32" y="160" fill="var(--ink-soft)">section</text>
<text x="32" y="180" fill="var(--ink-soft)">text</text>
<rect x="20" y="214" width="200" height="40" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="32" y="238" fill="var(--ink)">vectors.npy 第 i 行</text>
<text x="360" y="24" fill="var(--ink)">kb_chunks 表</text>
<rect x="360" y="36" width="260" height="264" rx="6" fill="none" stroke="var(--ink-soft)"/>
<text x="372" y="80" fill="var(--ink)">id  text PRIMARY KEY</text>
<text x="372" y="100" fill="var(--ink)">doc_id  text</text>
<text x="372" y="120" fill="var(--ink)">title  text</text>
<text x="372" y="140" fill="var(--ink)">category  text</text>
<text x="372" y="160" fill="var(--ink)">section  text</text>
<text x="372" y="180" fill="var(--ink)">content  text</text>
<rect x="366" y="222" width="248" height="24" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="372" y="238" fill="var(--ink)">embedding  vector(1024)</text>
<text x="372" y="268" fill="var(--ink-soft)">content_hash  Day 231 用</text>
<text x="372" y="288" fill="var(--ink-soft)">updated_at  默认 now()</text>
<line x1="220" y1="76" x2="360" y2="76" stroke="var(--ink-faint)" marker-end="url(#m229)"/>
<line x1="220" y1="96" x2="360" y2="96" stroke="var(--ink-faint)" marker-end="url(#m229)"/>
<line x1="220" y1="116" x2="360" y2="116" stroke="var(--ink-faint)" marker-end="url(#m229)"/>
<line x1="220" y1="136" x2="360" y2="136" stroke="var(--ink-faint)" marker-end="url(#m229)"/>
<line x1="220" y1="156" x2="360" y2="156" stroke="var(--ink-faint)" marker-end="url(#m229)"/>
<line x1="220" y1="176" x2="360" y2="176" stroke="var(--ink-faint)" marker-end="url(#m229)"/>
<line x1="220" y1="234" x2="366" y2="234" stroke="var(--ink-faint)" marker-end="url(#m229)"/>
<text x="20" y="290" fill="var(--ink-soft)" font-size="11">两个文件靠下标对齐 → 一行里放在一起</text>
<defs><marker id="m229" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L8,4 L0,8 z" fill="var(--ink-faint)"/></marker></defs>
</g>
</svg>
<figcaption>Day 225 把块的文字存在 chunks.json、向量存在 vectors.npy,两边靠行号对齐。kb_chunks 把它们放进同一行:块和自己的向量再也不会错位。琥珀色那一列的类型来自 pgvector 扩展,最后两列是为增量更新准备的。</figcaption>
</figure>

建表语句要放进代码里,让程序自己建,而不是让每个人手动敲一遍 SQL。新建 `part04/pg_store.py`,今天先写连接和建表两部分,Day 231 往里加写入,Day 232 加检索:

```python
# agent-zero-lab/part04/pg_store.py
"""知识库的 pgvector 存储。Day 229 先建表;Day 231 加写入,Day 232 加检索。"""
import os

import psycopg
from dotenv import load_dotenv
from pgvector.psycopg import register_vector
from psycopg import sql

load_dotenv()
DSN = os.environ["PG_DSN"]
DIM = int(os.environ.get("EMB_DIM", "1024"))

SCHEMA = sql.SQL("""
CREATE EXTENSION IF NOT EXISTS vector;
CREATE TABLE IF NOT EXISTS kb_chunks (
    id            text PRIMARY KEY,
    doc_id        text NOT NULL,
    title         text NOT NULL,
    category      text NOT NULL,
    section       text NOT NULL,
    content       text NOT NULL,
    content_hash  text NOT NULL,
    embedding     vector({dim}) NOT NULL,
    updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS kb_chunks_category_idx ON kb_chunks (category);
CREATE INDEX IF NOT EXISTS kb_chunks_embedding_hnsw
    ON kb_chunks USING hnsw (embedding vector_cosine_ops);
""").format(dim=sql.Literal(DIM))


def connect() -> psycopg.Connection:
    conn = psycopg.connect(DSN, autocommit=True)
    conn.execute("CREATE EXTENSION IF NOT EXISTS vector")
    register_vector(conn)
    return conn


def init_schema(conn: psycopg.Connection) -> None:
    conn.execute(SCHEMA)


if __name__ == "__main__":
    with connect() as conn:
        line = next(ln for ln in SCHEMA.as_string(conn).splitlines() if "vector(" in ln)
        print("拼好的那一行:", line.strip())
        init_schema(conn)
        init_schema(conn)
        row = conn.execute("SELECT count(*) FROM kb_chunks").fetchone()
        print("kb_chunks 建好了,现在有", row[0] if row else 0, "行")
```

<div class="line-notes">

- `from psycopg import sql` psycopg 的 SQL 拼接工具模块,专门用来安全地拼那些不能用 `%s` 传的部分。为什么需要它,代码后面细讲。
- `DSN = os.environ["PG_DSN"]` 昨天加进 `.env` 的那一行,实测 `postgresql://minliu@localhost:5432/agentzero`。
- `DIM = int(os.environ.get("EMB_DIM", "1024"))` 维度从 `.env` 的 `EMB_DIM` 读([Day 217](/blog/agent-zero/day-217-embed-service/) 配的),没配就用 1024。环境变量读出来一定是字符串 `"1024"`,`int()` 转成整数。把维度写在一个地方,换模型时只改 `.env`。
- `CREATE EXTENSION IF NOT EXISTS vector;` 建表前先确保扩展已启用,这样这段 SQL 单独贴进 psql 也能跑。
- `CREATE TABLE IF NOT EXISTS kb_chunks (` `IF NOT EXISTS`:表已经有了就跳过,第二次运行不报错。
- `id            text PRIMARY KEY,` 块编号 `kb-002#3`,对应 `Chunk.id`。主键:不能重复,以后「更新某一块」就是按它找到那一行。
- `doc_id        text NOT NULL,` 文章编号 `kb-002`,以后「这篇文章改了,把它的块全换掉」用它。
- `category      text NOT NULL,` 分类,`WHERE category = '退款'` 过滤用,Day 234 讲。
- `content       text NOT NULL,` 块的正文,对应 `Chunk.text`,也就是带「标题 > 小节」前缀、送去算 embedding 的那段文字。列名改叫 `content`,是因为 `text` 在 SQL 里是类型名,当列名读起来容易混。
- `content_hash  text NOT NULL,` 内容指纹,Day 231 用它判断「这块改没改」,没改就不重算 embedding。今天先留好位置。
- `embedding     vector({dim}) NOT NULL,` 向量列。`{dim}` 是占位符,下面 `.format()` 把它换成 1024。实测拼完是 `embedding     vector(1024) NOT NULL,`。
- `updated_at    timestamptz NOT NULL DEFAULT now()` `timestamptz` 是带时区的时间,相当于 JS 的 `Date`;`DEFAULT now()` 插入时不填就用当前时间。排查「这块是什么时候更新的」用。
- `CREATE INDEX IF NOT EXISTS kb_chunks_category_idx ON kb_chunks (category);` 分类列的普通索引,[Day 89](/blog/agent-zero/day-089-sql-5/) 学过的那种,按分类过滤时不用逐行找。
- `CREATE INDEX IF NOT EXISTS kb_chunks_embedding_hnsw` 向量列上的 HNSW 索引。它是让相似度查询变快的那个东西,为什么快、为什么会漏,Day 233 专门讲,今天只要知道表上有它。
- `ON kb_chunks USING hnsw (embedding vector_cosine_ops);` `vector_cosine_ops` 表示这个索引按**余弦距离**组织,和我们一直用的余弦对应。
- `""").format(dim=sql.Literal(DIM))` 把 `{dim}` 换成 `sql.Literal(1024)`。`Literal` 会把值按 SQL 的规矩变成一段字面量文本,整数就是 `1024`,字符串会加引号并转义。
- `conn = psycopg.connect(DSN, autocommit=True)` 每条语句执行完立刻生效。建表、建索引这种一句一句的操作用它最省事,不用操心提交(Day 228 的坑三)。
- `conn.execute("CREATE EXTENSION IF NOT EXISTS vector")` `connect()` 总是最先被调用,它自己先确保扩展存在,下一行的 `register_vector` 才不会报 `vector type not found`。
- `register_vector(conn)` 注册转换规则。以后所有从 `connect()` 拿到的连接,都能直接传 numpy 数组。
- `return conn` 把准备好的连接交给调用方。返回类型标成 `psycopg.Connection`。
- `def init_schema(conn: psycopg.Connection) -> None:` 建表函数,单独拆出来,因为查询的程序只需要 `connect()`,不需要每次都建表。
- `conn.execute(SCHEMA)` 一次执行四条语句(扩展、表、两个索引)。psycopg 在不带参数时允许一次发多条。
- `line = next(ln for ln in SCHEMA.as_string(conn).splitlines() if "vector(" in ln)` `as_string(conn)` 把拼好的 SQL 变回普通文本,方便检查。`next(生成器)` 取第一个包含 `vector(` 的行,相当于 JS 的 `lines.find(...)`。
- `init_schema(conn)` 跑一次建表。
- `init_schema(conn)` 故意再跑一次,验证 `IF NOT EXISTS` 让它不报错。
- `row = conn.execute("SELECT count(*) FROM kb_chunks").fetchone()` 数一下行数,实测 `(0,)`。

</div>

```bash
uv run python -m part04.pg_store
uv run python -m part04.pg_store
psql -d agentzero -c '\d kb_chunks'
```

我的输出:

```text
拼好的那一行: embedding     vector(1024) NOT NULL,
kb_chunks 建好了,现在有 0 行
拼好的那一行: embedding     vector(1024) NOT NULL,
kb_chunks 建好了,现在有 0 行
                         Table "public.kb_chunks"
    Column    |           Type           | Collation | Nullable | Default
--------------+--------------------------+-----------+----------+---------
 id           | text                     |           | not null |
 doc_id       | text                     |           | not null |
 title        | text                     |           | not null |
 category     | text                     |           | not null |
 section      | text                     |           | not null |
 content      | text                     |           | not null |
 content_hash | text                     |           | not null |
 embedding    | vector(1024)             |           | not null |
 updated_at   | timestamp with time zone |           | not null | now()
Indexes:
    "kb_chunks_pkey" PRIMARY KEY, btree (id)
    "kb_chunks_category_idx" btree (category)
    "kb_chunks_embedding_hnsw" hnsw (embedding vector_cosine_ops)
```

脚本跑了两遍(脚本里每遍还调了两次 `init_schema`),一共四次建表,一次都没报错,这就是 `IF NOT EXISTS` 的作用。这种「执行一次和执行多次结果一样」的写法叫**幂等**。初始化代码尽量都写成幂等的,就不用操心「是不是已经跑过了」。表结构里三个索引:主键自带的、分类的、向量的。

### 为什么不用 f-string 拼维度

`vector({dim})` 这里,最直觉的写法是 f-string:`f"... vector({DIM}) ..."`。它能跑,但我不这么写。新建 `part04/pg_fstring.py` 试一下:

```python
# agent-zero-lab/part04/pg_fstring.py
import psycopg

DIM = 1024
with psycopg.connect("postgresql://localhost:5432/agentzero") as conn:
    print(conn.execute(f"SELECT vector_dims(array_fill(0, ARRAY[{DIM}])::vector)").fetchone())
```

<div class="line-notes">

- `print(conn.execute(f"SELECT vector_dims(array_fill(0, ARRAY[{DIM}])::vector)").fetchone())` 用 f-string 把 1024 拼进 SQL,造一个 1024 维的零向量,再问它的维度。

</div>

```bash
uv run python -m part04.pg_fstring
uvx basedpyright part04/pg_fstring.py
```

```text
(1024,)
part04/pg_fstring.py
  part04/pg_fstring.py:6:11 - error: No overloads for "execute" match the provided arguments (reportCallIssue)
  part04/pg_fstring.py:6:24 - error: Argument of type "str" cannot be assigned to parameter "query" of type "Template" in function "execute"
    "str" is not assignable to "Template" (reportArgumentType)
2 errors, 0 warnings, 0 notes
```

程序照样打印 `(1024,)`,但类型检查报了两个错,Zed 里会看到红线。psycopg 的类型标注**故意**只接受写死在代码里的 SQL 字面量(或者 `sql.SQL` 这类对象):用变量拼出来的字符串,类型检查器没法保证里面没混进用户输入,而那正是 SQL 注入的来源。报错里提到的 `Template` 是 Python 3.14 新增的模板字符串,psycopg 3.3 也支持,我们用 3.12,不用管它。

那为什么不能像 INSERT 的值那样用 `%s`?因为建表语句不支持参数占位符,`vector(1024)` 里的维度必须是写死的文本。`sql.Literal` 就是为这种位置准备的:它在 Python 这边把值拼进去,但会按 SQL 的规矩转义。拿一段恶意文本对比一下(我在 `uv run python` 里实跑的):

```text
sql.Literal:  WHERE title = 'x''; DROP TABLE kb_chunks; --'
str.format:   WHERE title = x'; DROP TABLE kb_chunks; --
```

前者整段加了引号、里面的单引号被转义成两个,数据库只把它当成一个字符串值;后者原样拼进去,`DROP TABLE` 就成了一条真命令。三种写法整理成一张表:

| 写法 | 在哪替换 | 用在哪 | 安全吗 |
| --- | --- | --- | --- |
| `%s` | 数据库那边,值单独传 | INSERT 的值、WHERE 比较的值 | 安全,首选 |
| `sql.SQL(...).format(x=sql.Literal(...))` | Python 这边,会转义 | 不能用参数的位置,如维度 | 安全 |
| f-string / `str.format` | Python 这边,不转义 | 不要用来拼 SQL | 不安全 |

我们的 `DIM` 来自自己的 `.env`,就算用 f-string 也不会真出事。但养成「SQL 里的变量部分一律走前两种」的习惯,以后在别处碰到用户输入时就不会犯错。

## 动手练习

**练习 1:把一块真数据写进 kb_chunks。** 用 Day 225 的 `load_index()` 读出第 0 块和它的向量,手写一条 INSERT 写进 `kb_chunks`(`content_hash` 先填 `'demo'`),读出这一行的 id、分类、维度、占用字节、更新时间。再试着写一个 3 维向量进去,看报错。最后清空表,把 Day 231 的活留给 Day 231。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part04/ex_pg_one_chunk.py
import numpy as np

from part04.build_index import load_index
from part04.pg_store import connect, init_schema

chunks, vectors = load_index()
c, v = chunks[0], vectors[0]
with connect() as conn:
    init_schema(conn)
    conn.execute(
        "INSERT INTO kb_chunks (id, doc_id, title, category, section, content, content_hash, embedding)"
        " VALUES (%s, %s, %s, %s, %s, %s, %s, %s)",
        (c.id, c.doc_id, c.title, c.category, c.section, c.text, "demo", v),
    )
    row = conn.execute(
        "SELECT id, category, vector_dims(embedding), pg_column_size(embedding), updated_at FROM kb_chunks"
    ).fetchone()
    print(row)
    try:
        conn.execute(
            "INSERT INTO kb_chunks VALUES (%s, %s, %s, %s, %s, %s, %s, %s)",
            ("kb-x#1", "kb-x", "t", "c", "s", "x", "demo", np.array([0.1, 0.2, 0.3], dtype=np.float32)),
        )
    except Exception as e:
        print(type(e).__name__, e)
    conn.execute("DELETE FROM kb_chunks")
    print("清空后:", conn.execute("SELECT count(*) FROM kb_chunks").fetchone())
```

<div class="line-notes">

- `from part04.build_index import load_index` Day 225 写的读索引函数,会检查模型名和行数。这里不调 embedding 接口,向量直接从 `index/vectors.npy` 读。
- `from part04.pg_store import connect, init_schema` 今天写的两个函数。
- `c, v = chunks[0], vectors[0]` 第 0 块是 `kb-001#1`,向量形状 `(1024,)`。
- `init_schema(conn)` 保险起见先建表,幂等,建过就跳过。
- `"INSERT INTO kb_chunks (id, doc_id, title, category, section, content, content_hash, embedding)"` 列名写全,`updated_at` 不写,用默认值 `now()`。两行字符串相邻会被 Python 自动拼成一个,和 JS 里要用 `+` 不一样。
- `(c.id, c.doc_id, c.title, c.category, c.section, c.text, "demo", v),` 八个值对应八列。`c.text` 进的是 `content` 列;`v` 是 numpy 数组,因为 `connect()` 里注册过,可以直接传。
- `"SELECT id, category, vector_dims(embedding), pg_column_size(embedding), updated_at FROM kb_chunks"` 读出关键信息。
- `print(row)` 实测 `('kb-001#1', '套餐与计费', 1024, 4100, datetime.datetime(2026, 10, 22, 23, 52, 12, ..., tzinfo=zoneinfo.ZoneInfo(key='Asia/Shanghai')))`。`timestamptz` 读出来是带时区的 `datetime`,时区是你电脑的时区。
- `"INSERT INTO kb_chunks VALUES (%s, %s, %s, %s, %s, %s, %s, %s)",` 不写列名时按表里的列顺序填,九列只给八个值,最后的 `updated_at` 用默认值。
- `("kb-x#1", "kb-x", "t", "c", "s", "x", "demo", np.array([0.1, 0.2, 0.3], dtype=np.float32)),` 一个 3 维向量。
- `print(type(e).__name__, e)` 实测 `DataException expected 1024 dimensions, not 3`。`connect()` 用了 `autocommit=True`,这条失败不影响前面已经写进去的那行。
- `conn.execute("DELETE FROM kb_chunks")` 清空。不带 WHERE 的 DELETE 删全表,[Day 86](/blog/agent-zero/day-086-sql-2/) 说过它的危险,这里是故意的。
- `print("清空后:",` 实测 `(0,)`。

</div>

```bash
uv run python -m part04.ex_pg_one_chunk
```

```text
('kb-001#1', '套餐与计费', 1024, 4100, datetime.datetime(2026, 10, 22, 23, 52, 12, 980597, tzinfo=zoneinfo.ZoneInfo(key='Asia/Shanghai')))
DataException expected 1024 dimensions, not 3
清空后: (0,)
```

真实的 1024 维向量写进去了,3 维的被拒。`pg_column_size` 是 4100,就是正文里说的「存进表以后比公式少 4 字节」。

</details>

**练习 2:halfvec 省多少、丢多少。** 在 psql 里分别量 1024 维的 `vector` 和 `halfvec` 各占多少字节,再把 `0.1234567` 分别转成两种类型,看精度差多少。

<details><summary>参考答案</summary>

```sql
SELECT pg_column_size(array_fill(0.1, ARRAY[1024])::vector) AS vector_1024,
       pg_column_size(array_fill(0.1, ARRAY[1024])::halfvec) AS halfvec_1024,
       pg_column_size(array_fill(0.1, ARRAY[3])::halfvec) AS halfvec_3;
SELECT '[0.1234567, 1]'::halfvec, '[0.1234567, 1]'::vector;
```

<div class="line-notes">

- `SELECT pg_column_size(array_fill(0.1, ARRAY[1024])::vector) AS vector_1024,` 1024 维 vector,公式 4×1024+8。
- `pg_column_size(array_fill(0.1, ARRAY[1024])::halfvec) AS halfvec_1024,` 1024 维 halfvec,文档公式 2×维度+8。
- `pg_column_size(array_fill(0.1, ARRAY[3])::halfvec) AS halfvec_3;` 3 维 halfvec,公式算是 14。
- `SELECT '[0.1234567, 1]'::halfvec, '[0.1234567, 1]'::vector;` 同一个数两种精度。

</div>

```text
 vector_1024 | halfvec_1024 | halfvec_3
-------------+--------------+-----------
        4104 |         2056 |        14
(1 row)

    halfvec     |    vector
----------------+---------------
 [0.12347412,1] | [0.1234567,1]
(1 row)
```

halfvec 正好省一半(2056 = 2×1024+8)。精度上,`0.1234567` 存成半精度变成了 `0.12347412`,从小数点后第五位开始就不准了;float32 的 vector 原样保住。对检索排序来说,这种误差通常影响很小,但「通常」要靠自己的评估集验证([Day 255](/blog/agent-zero/day-255-rag-eval-1/) 起建)。我们是 1024 维,没必要省这一半。

</details>

**练习 3:先看一眼 <=>。** [Day 215](/blog/agent-zero/day-215-cosine/) 说过 pgvector 的 `<=>` 是余弦距离(1 减余弦相似度,越小越近)。在玩具表上算每一行和 `[1, 0, 0]`(「纯退款」方向)的距离,按距离从小到大排。只是预览,正式的检索 SQL 在 Day 232。

<details><summary>参考答案</summary>

```sql
SELECT label, embedding <=> '[1, 0, 0]' AS distance FROM toy ORDER BY distance;
```

<div class="line-notes">

- `SELECT label, embedding <=> '[1, 0, 0]' AS distance FROM toy ORDER BY distance;` `<=>` 左边是表里的向量列,右边是一个向量值,结果是一个数。`ORDER BY distance` 默认从小到大,最近的排最前。

</div>

```text
 label  |       distance
--------+----------------------
 退款   | 0.006116251198662548
 改密码 |   0.0369132008962616
 发票   |    0.890235733329906
 登录   |                    1
(4 rows)
```

退款那行几乎就在 `[1, 0, 0]` 方向上,距离 0.006;正文 `pg_vec.py` 写进去的「改密码」`[0.8, 0.2, 0.1]` 也偏第一维,0.037 排第二;登录 `[0, 0.2, 0.9]` 第一维是 0,和 `[1, 0, 0]` 垂直,余弦是 0,距离正好是 1。和 Day 215 用 numpy 算余弦是同一回事,只是这次是数据库算的。

</details>

**练习 4:验证扩展是按库启用的。** 建一个新库 `agentzero_empty`,在里面 `\dx`,再试一次 `SELECT '[1,2,3]'::vector`,最后删掉这个库,并确认 `agentzero` 里的 vector 还在。

<details><summary>参考答案</summary>

```bash
createdb agentzero_empty
psql -d agentzero_empty -c '\dx'
psql -d agentzero_empty -c "SELECT '[1,2,3]'::vector"
dropdb agentzero_empty
psql -d agentzero -c "\dx vector"
```

<div class="line-notes">

- `createdb agentzero_empty` 新建一个空库(正文踩坑那一段如果你没删,先 `dropdb agentzero_empty` 再建)。
- `psql -d agentzero_empty -c '\dx'` 看新库启用了哪些扩展。
- `psql -d agentzero_empty -c "SELECT '[1,2,3]'::vector"` 在新库里用 vector 类型。
- `dropdb agentzero_empty` 删掉。
- `psql -d agentzero -c "\dx vector"` `\dx` 后面跟名字,只看这一个扩展。

</div>

```text
                 List of installed extensions
  Name   | Version |   Schema   |         Description
---------+---------+------------+------------------------------
 plpgsql | 1.0     | pg_catalog | PL/pgSQL procedural language
(1 row)

ERROR:  type "vector" does not exist
LINE 1: SELECT '[1,2,3]'::vector
                          ^
                           List of installed extensions
  Name  | Version | Schema |                     Description
--------+---------+--------+------------------------------------------------------
 vector | 0.8.6   | public | vector data type and ivfflat and hnsw access methods
(1 row)
```

新库里只有 `plpgsql`,不认识 vector;`agentzero` 里的 vector 好好的。扩展的程序文件全服务共用一份,但「启用」是每个库各自的事。部署到新环境、或者测试时临时建库,第一件事都是 `CREATE EXTENSION`,这也是 `connect()` 自己先执行一遍的原因。

</details>

验收标准:`psql -d agentzero -c '\d kb_chunks'` 能看到 `embedding | vector(1024)` 和三个索引;`uv run python -m part04.pg_store` 连跑两次都不报错;`uvx basedpyright part04/pg_store.py` 0 错误;能不看文章说出「扩展和表的区别」「为什么先 CREATE EXTENSION 再 register_vector」「为什么维度不用 f-string 拼」。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 向量数据库 | 能存向量、能按相似度检索的数据库。有专门的(Milvus、Qdrant、Chroma),也有给现成数据库加能力的(pgvector) |
| pgvector | Postgres 的扩展,提供 `vector` 类型、距离运算符和 HNSW / IVFFlat 两种向量索引 |
| 扩展(extension) | 给 Postgres 加功能的代码包,装的是类型、函数、运算符,不是数据。按库启用 |
| CREATE EXTENSION | 在当前库启用一个扩展。pgvector 的扩展名是 `vector` |
| `\dx` | psql 元命令,列出当前库已启用的扩展 |
| vector(n) | pgvector 的向量列类型,n 是维度,写错维度直接拒绝 |
| halfvec | 半精度向量类型,每个数 2 字节,省一半空间,索引上限 4000 维 |
| `::` | Postgres 的类型转换写法,`'[1,2,3]'::vector` 把字符串转成向量 |
| 适配(adapt) | 驱动把 Python 对象转换成数据库认识的格式。numpy 数组要靠 `register_vector` 才能适配 |
| register_vector | pgvector Python 包里的函数,在一条连接上注册 numpy 数组和 vector 之间的转换 |
| Vector 对象 | 从库里读出的向量在 Python 里的类型,`.to_numpy()` 转成数组 |
| sql.Literal | psycopg 的工具,把一个值按 SQL 规矩转义后拼进语句,用在不能用 `%s` 的位置 |
| 幂等 | 执行一次和执行多次结果一样。建表语句加 `IF NOT EXISTS` 就是幂等的 |
| timestamptz | 带时区的时间类型,Python 里读出来是带时区的 `datetime` |

## 常见误区

**先建表、后启用扩展。** 报 `type "vector" does not exist`。建表 SQL 第一句就写 `CREATE EXTENSION IF NOT EXISTS vector`。

**以为启用一次全服务生效。** 扩展是按库启用的,换个库(测试库、新环境)又会报类型不存在。连接时先执行一遍 `CREATE EXTENSION IF NOT EXISTS`,幂等,不怕重复。

**`register_vector` 写在 `CREATE EXTENSION` 前面。** 报 `vector type not found in the database`。顺序是先启用、再注册,`connect()` 里固定这么写。

**以为读出来就是 numpy 数组。** 读出来是 `Vector` 对象,直接 `.dtype`、`@` 会报错。要数组就 `.to_numpy()`。

**向量列不写维度。** `embedding vector` 什么维度都能存,换模型时的维度错误就漏过去了,而且没有固定维度的列建不了向量索引。写成 `vector(1024)`,维度从 `.env` 的 `EMB_DIM` 来。

**用 f-string 拼 SQL。** 能跑,但类型检查报错,换个地方就是 SQL 注入。值用 `%s`;维度、表名这种不能当参数的,用 `sql.SQL` 加 `sql.Literal` / `sql.Identifier`。

**选了 4096 维的模型才发现建不了索引。** `vector` 的 HNSW / IVFFlat 索引最多 2000 维。选模型时先看维度,超了就降维或用 `halfvec`。

**把 Python 包 pgvector 和数据库扩展 pgvector 当成一个东西。** 扩展在 Postgres 里(Postgres.app 自带),Python 包要 `uv add pgvector` 装进 `.venv`,两个都要有。

## 学习资料

### 文档与文章

- [pgvector 官方 README](https://github.com/pgvector/pgvector):今天所有 SQL 的出处。读 Getting Started、Storing 两节和 Half-Precision Vectors 一节,再在页面里搜「2,000」找到索引的维度上限,30 分钟。后面几天还会回来读 HNSW 和 Filtering。
- [pgvector-python](https://github.com/pgvector/pgvector-python):Python 包的说明,psycopg 3 那一段就是今天 `register_vector` 的用法;还有 SQLAlchemy、Django 的写法,以后用到框架时查。
- [PostgreSQL 文档 · CREATE EXTENSION](https://www.postgresql.org/docs/17/sql-createextension.html):扩展的官方说明,看开头两段知道「按库安装」就够了。
- [psycopg 3 · sql 模块](https://www.psycopg.org/psycopg3/docs/api/sql.html):`sql.SQL`、`sql.Literal`、`sql.Identifier` 的说明和例子。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1Pk8M6rEhm&autoplay=0&high_quality=1" title="有了 PostgreSQL,为什么还要 pgvector?" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>计算机大白话 · 有了 PostgreSQL,为什么还要 pgvector? · 4 分钟,正好对应今天第一节,先看它建立直觉。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1AtQJB4E9o&p=24&autoplay=0&high_quality=1" title="PostgreSQL零基础入门课程" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>枫枫知道 · PostgreSQL零基础入门课程 · 昨天看过前几集,今天看第 24 集「扩展-向量数据库」(6 分多钟),它也是从 CREATE EXTENSION 和建表讲起。</figcaption>
</figure>

- 六六科技笔记《RAG向量数据库怎么选?PgVector/Milvus/Qdrant 与中文 Embedding 对比》(BV1KrNH6pEuS,4 分钟):选型的快速版,Day 234 讲选型前先有个印象。

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/dN0lsF2cvm4" title="Vector Databases simply explained! (Embeddings & Indexes)" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>AssemblyAI · Vector Databases simply explained! (Embeddings & Indexes) · 英文,4 分钟,向量数据库是什么、为什么要索引,和今天的「为什么选 pgvector」一起看。</figcaption>
</figure>

### 书籍

- Chip Huyen《AI Engineering》(O'Reilly,2025)第 6 章讲 RAG 检索的部分,对向量数据库和近似检索有一段简洁的综述,适合读完这几天的 pgvector 再看。
- Regina Obe、Leo Hsu《PostgreSQL: Up and Running》第 3 版(O'Reilly,2017)第 2 章有一节专讲扩展怎么装、怎么查,书比 pgvector 老,扩展机制本身没变。

### 开源项目与代码

- [pgvector/pgvector](https://github.com/pgvector/pgvector):扩展本体,C 写的,`sql/vector.sql` 里能看到 `vector` 类型和 `<=>` 运算符是怎么注册进 Postgres 的。
- [pgvector/pgvector-python](https://github.com/pgvector/pgvector-python):今天装的 Python 包,`pgvector/psycopg/` 目录下就是 `register_vector` 的实现,几个小文件加起来两百来行,能看出它就是在查类型编号、注册转换函数。

## 自测

**1. 扩展和表有什么区别?为什么 `CREATE EXTENSION vector` 必须在建 `kb_chunks` 之前?**

<details><summary>答案</summary>

扩展装的是代码(新类型、函数、运算符、索引方式),表装的是一行行数据。`kb_chunks` 有一列是 `vector(1024)`,这个类型是扩展提供的,不先启用扩展,建表就报 `type "vector" does not exist`。

</details>

**2. 往 `vector(1024)` 的列里写一个 1536 维的向量会怎样?这在 RAG 里为什么是好事?**

<details><summary>答案</summary>

直接报错 `expected 1024 dimensions, not 1536`,写不进去。这能挡住「建索引和查询用了不同的 embedding 模型」这类事故:在 numpy 方案里它要么报一个形状错误,要么维度碰巧一样时安静地给出接近随机的分数。

</details>

**3. 下面的 `connect()` 有什么问题?在一个全新的库上运行会报什么?**

```python
def connect():
    conn = psycopg.connect(DSN, autocommit=True)
    register_vector(conn)
    conn.execute("CREATE EXTENSION IF NOT EXISTS vector")
    return conn
```

<details><summary>答案</summary>

顺序反了。`register_vector` 要去库里查 vector 类型,全新的库还没启用扩展,会报 `psycopg.ProgrammingError: vector type not found in the database`。把 `CREATE EXTENSION` 那一行挪到 `register_vector` 前面。

</details>

**4. 1 万块、bge-m3 1024 维,向量部分在 pgvector 里大约占多少空间?如果换成默认 4096 维的模型,会碰到什么问题?**

<details><summary>答案</summary>

10000 × (4×1024+8) = 41,040,000 字节,约 39 MB(这只是向量列本身,不算正文和索引)。4096 维的话每个向量约 16 KB,存得下(vector 最多 16000 维),但超过 HNSW / IVFFlat 索引的 2000 维上限,建索引会报 `column cannot have more than 2000 dimensions for hnsw index`;要么让接口返回 2000 维以内,要么用 `halfvec`(索引上限 4000,4096 还是超,需要降维)。

</details>

**5. 面试题:你们已经有 Postgres 存业务数据,现在要做一个几万篇文档的知识库问答。你会选 pgvector 还是单独上一个 Milvus?说出理由和什么情况下你会改主意。**

<details><summary>答案</summary>

选 pgvector。几万篇切块后大概几十万块,远在 pgvector 加 HNSW 能轻松应对的范围内;复用现有 Postgres 的备份、监控、权限和高可用,不用多运维一套系统;知识库和业务数据在一个库里,可以用一条 SQL 做过滤和关联(比如按客户套餐限定能看的文章),写入还有事务保证。会改主意的情况:向量规模到上亿、需要分布式和水平扩展、对查询延迟和吞吐有 Postgres 单机扛不住的要求,或者需要 GPU 加速检索,这时再评估 Milvus 这类专门系统,并用自己的评估集和压测数据做决定。

</details>

## 明天预告

明天是 [Day 230 · 第 33 周复习:RAG 与上下文(Day 224–229)](/blog/agent-zero/day-230-week33-review/)。这一周从切块走到了数据库:切块、存 `.npy`、检索拼 prompt、引用和拒答,最后装好 Postgres 和 pgvector。明天先默写切块和检索的核心代码,再做一个小项目,把 Day 225 的 42 块原样搬进今天建好的 `kb_chunks`,和 `.npy` 逐行对账,为 Day 231 的增量同步打底。
