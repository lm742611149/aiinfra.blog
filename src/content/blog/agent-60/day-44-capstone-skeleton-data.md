---
title: 'Day 44 · 搭骨架:仓库结构、配置、造数据'
description: '用 uv 建好 SupportPilot 仓库,配上 ruff、pytest、pre-commit,用 pydantic-settings 管配置,Docker 起 Postgres + pgvector。然后造数据:62 篇帮助中心文章、200 个客户的订阅和账单,其中 12 个剧情客户对应 Day 43 访谈里拆出来的退款场景。一条 make data 建好全部。'
pubDate: 2026-10-12
regime: none
tags: ['capstone', 'uv', 'postgres', 'pgvector', 'synthetic-data', 'supportpilot', 'agent-60']
series: 'agent-60'
day: 44
lang: 'zh'
---

## 今天要解决的问题

昨天定了要做什么,今天把地基打好。地基分两半:一半是工程上的(仓库、依赖、配置、数据库、代码检查),一半是数据(帮助中心文章、客户、订阅、账单、历史工单)。

数据这一半比看起来重要得多。SupportPilot 后面每一天都建立在这批数据上:Day 45 的检索要搜帮助中心,Day 46 的退款规则要算账单,Day 50 的评测集要用"剧情客户"出题。数据造得随便,后面所有分数都没有意义。

今天结束时你应该做到:

1. `uv sync` 一次装好全部依赖,`make test` 能跑,提交代码前 ruff 自动检查。
2. 所有配置(模型、密钥、数据库、业务参数)从 `.env` 读,代码里一个密钥都没有。
3. `make up && make data` 建好数据库:62 篇帮助中心 markdown、200 个客户、200 个订阅、459 张账单、152 张历史工单。
4. 说得清楚为什么帮助中心用模板生成而不是让大模型写,为什么要固定随机种子和"今天"。

预计用时 4–6 小时。代码量是 12 天里最多的一天之一,但大部分是数据,逻辑不复杂。前置:Day 2(Python 和 uv)、Day 17(pgvector)、Day 41(Docker)。

## 第一步:建仓库

```bash
uv init --package supportpilot
cd supportpilot
uv python pin 3.12

# 运行时依赖
uv add openai pydantic pydantic-settings "psycopg[binary]" pgvector numpy rank-bm25 jieba httpx \
       langgraph langgraph-checkpoint-postgres mcp fastapi uvicorn sse-starlette streamlit sqlglot
# 开发依赖,放进 dev 组,部署镜像里不装
uv add --dev pytest ruff pre-commit
```

`--package` 会生成 `src/supportpilot/` 这种 src 布局,并且把项目本身以可编辑模式装进虚拟环境。以后在任何目录 `uv run python -c "import supportpilot"` 都能找到,脚本和测试不用再折腾 `sys.path`。

依赖一次装全,虽然有些今天用不到(streamlit 要到 Day 49),但好处是 `uv.lock` 从第一天就锁定了全部版本,后面不会出现"Day 49 装了 streamlit 结果把 numpy 升级了、Day 45 的代码挂了"这种事。uv.lock 要提交进 git。

装完后的 `pyproject.toml` 长这样,我加了 ruff 和 pytest 的配置:

```toml
[project]
name = "supportpilot"
version = "0.1.0"
description = "CloudLedger 智能客服工单 Agent(agent-60 毕业项目)"
requires-python = ">=3.12"
dependencies = [
    "openai>=1.60",
    "pydantic>=2.8",
    "pydantic-settings>=2.4",
    "psycopg[binary]>=3.2",
    "pgvector>=0.3",
    "numpy>=1.26",
    "rank-bm25>=0.2.2",
    "jieba>=0.42",
    "httpx>=0.27",
    "langgraph>=1.0",
    "langgraph-checkpoint-postgres>=2.0",
    "mcp>=2.0",
    "fastapi>=0.115",
    "uvicorn>=0.30",
    "sse-starlette>=2.1",
    "streamlit>=1.40",
    "sqlglot>=25",
]

[dependency-groups]
dev = ["pytest>=8", "ruff>=0.6", "pre-commit>=3.8"]

[build-system]
requires = ["uv_build>=0.11,<0.12"]
build-backend = "uv_build"

[tool.ruff]
line-length = 110
target-version = "py312"

[tool.ruff.lint]
select = ["E", "F", "I", "B", "UP"]
ignore = ["E501"]  # 行长交给 ruff format;中文注释按字符数算很容易超

[tool.pytest.ini_options]
testpaths = ["tests"]
markers = ["db: 需要 docker compose 起好的 Postgres", "llm: 会真的调用大模型 API(花钱)"]
```

几个说明。版本约束用 `>=` 写下限,真正的版本由 uv.lock 锁死。这是应用项目的常规做法:pyproject 表达"我至少需要什么",lock 文件保证"大家装的一模一样"。如果你在写一个给别人用的库,就不该锁死,但 SupportPilot 是应用。

ruff 我关了 E501(行太长)。原因很实际:中文注释一个字算一个字符,110 列放不了几句话,硬卡行长会逼你把注释写得很碎。行长交给 `ruff format` 去管代码部分就行。

pytest 定义了两个标记:`db`(需要真数据库)和 `llm`(会真的调用大模型花钱)。平时 `make test` 只跑既不连库也不花钱的测试,几秒钟跑完,可以每次提交都跑。

`requires = ["uv_build>=0.11,<0.12"]` 是 uv 自己的构建后端,uv init 默认生成的就是它。如果你用的 uv 版本较老,生成的可能是 hatchling,保留生成的就行,不影响后面任何代码。

### pre-commit:让机器替你守规矩

```yaml
# supportpilot/.pre-commit-config.yaml
repos:
  - repo: https://github.com/astral-sh/ruff-pre-commit
    rev: v0.6.9
    hooks:
      - id: ruff
        args: [--fix]
      - id: ruff-format
  - repo: https://github.com/pre-commit/pre-commit-hooks
    rev: v4.6.0
    hooks:
      - id: detect-private-key
      - id: check-added-large-files
```

```bash
uv run pre-commit install    # 装 git hook,以后每次 git commit 自动跑
uv run pre-commit run -a     # 手动对全部文件跑一遍
```

`detect-private-key` 这一条是给自己上的保险。做 Agent 项目要管一堆 API key,总有一天你会手滑把 key 写进代码,这个钩子会在提交时拦下来。我见过有人把 key 推到公开仓库,几个小时后账单上多了几千块,不是吓唬你。

`.gitignore` 里最重要的一行是 `.env`:

```text
.env
.venv/
__pycache__/
.pytest_cache/
.ruff_cache/
evals/reports/*.json
```

评测报告的 json 不提交(太大,每次都变),markdown 版的摘要提交,这样 git 历史里能看到分数怎么变的。

## 第二步:配置

所有可变的东西都进配置:模型地址、密钥、单价、数据库、业务参数。用 pydantic-settings,它会按字段名自动读同名环境变量(不区分大小写),也会读 `.env` 文件,类型不对启动时直接报错。

```python
# supportpilot/src/supportpilot/config.py
from datetime import date
from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """所有配置都从环境变量 / .env 读,代码里不出现任何密钥。"""

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    # 大模型:OpenAI 兼容协议,换厂商只改这三行
    llm_base_url: str = "https://api.deepseek.com"
    llm_api_key: str = ""
    llm_model: str = "deepseek-flash"
    # Day 52 做模型路由时用:分类这类简单活交给它;留空就和 llm_model 一样
    llm_small_model: str = ""
    # 计费单价(元 / 百万 token)。默认值是 2026-10 查到的 deepseek-flash 高峰价,按最贵的算
    price_in_per_m: float = 2.0
    price_out_per_m: float = 8.0

    # Embedding 与 rerank:同样走 OpenAI 兼容接口
    emb_base_url: str = "https://api.siliconflow.cn/v1"
    emb_api_key: str = ""
    emb_model: str = "BAAI/bge-m3"
    emb_dim: int = 1024
    rerank_enabled: bool = False
    rerank_base_url: str = "https://api.siliconflow.cn/v1"
    rerank_api_key: str = ""
    rerank_model: str = "BAAI/bge-reranker-v2-m3"

    database_url: str = "postgresql://supportpilot:supportpilot@localhost:5432/supportpilot"

    # 业务规则相关。sp_today 固定"今天",让退款资格这类按日期算的规则在评测里可复现
    sp_today: date = date(2026, 10, 1)
    refund_review_threshold: float = 1000.0  # 超过这个金额,审批面板上标红提示要财务复核

    # Agent 行为
    max_act_steps: int = 5
    max_revisions: int = 1
    retrieve_k: int = 5


@lru_cache
def get_settings() -> Settings:
    return Settings()
```

```bash
# supportpilot/.env.example  复制成 .env 再填。.env 已在 .gitignore 里,别提交。
LLM_BASE_URL=https://api.deepseek.com
LLM_API_KEY=sk-xxxx
LLM_MODEL=deepseek-flash
LLM_SMALL_MODEL=
PRICE_IN_PER_M=2.0
PRICE_OUT_PER_M=8.0

EMB_BASE_URL=https://api.siliconflow.cn/v1
EMB_API_KEY=sk-xxxx
EMB_MODEL=BAAI/bge-m3
EMB_DIM=1024

RERANK_ENABLED=false
RERANK_BASE_URL=https://api.siliconflow.cn/v1
RERANK_API_KEY=sk-xxxx
RERANK_MODEL=BAAI/bge-reranker-v2-m3

DATABASE_URL=postgresql://supportpilot:supportpilot@localhost:5432/supportpilot
SP_TODAY=2026-10-01
```

这里有个设计值得停下来讲:`sp_today`。

退款规则全是按日期算的:"首购 14 天内""续费 7 天内""剩余完整月份"。如果代码里用 `date.today()`,那今天跑评测,"李娜年付首购第 7 天"是对的;下周再跑,她就变成第 14 天;再过一周变成第 21 天,标准答案从"全额退 950"变成"按月比例退",评测分数莫名其妙掉了,你还以为是自己改坏了什么。

所以"今天"也是配置,默认固定在 2026-10-01。评测、造数据、业务规则都用它。上线真用的时候再把它改成跟着系统时间走(Day 53 部署时处理)。这类"让测试可复现"的小设计,面试官很喜欢听,因为它说明你踩过坑。

`llm_small_model` 现在留空,意思是分诊和质检也用主力模型。Day 52 做模型路由时才分开。先跑通再优化。

`get_settings()` 加了 `@lru_cache`,整个进程只读一次环境变量。测试里想换配置,直接 `Settings(xxx=...)` 新建一个传进去,不要改环境变量,我们后面的代码都支持传 settings。

## 第三步:数据库

```yaml
# supportpilot/docker-compose.yml
# Day 44 只有数据库;Day 52 加 Langfuse,Day 53 加 app 本身。
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

`pgvector/pgvector:pg17` 是 pgvector 官方镜像,Postgres 17 加上 vector 扩展,不用自己编译。数据放在命名卷 `pgdata` 里,`docker compose down` 不会删数据,`docker compose down -v` 才会。

表结构:

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

-- Day 48 用:客户画像(历史工单压缩成一段话)
CREATE TABLE IF NOT EXISTS biz.customer_profiles (
    customer_id text PRIMARY KEY REFERENCES biz.customers(id),
    summary     text NOT NULL,
    source_ticket_count int NOT NULL,
    updated_at  timestamptz NOT NULL DEFAULT now()
);

-- 所有写操作都记一笔,Day 53 做权限审计时查这里
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

<figure>
<svg viewBox="0 0 640 330" role="img" aria-label="SupportPilot 数据表关系">
<g font-family="var(--font-mono)" font-size="11">
<rect x="20" y="20" width="140" height="56" rx="5" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="90" y="44" text-anchor="middle" fill="var(--ink)">biz.customers</text>
<text x="90" y="62" text-anchor="middle" fill="var(--ink-soft)">200 行 · email 唯一</text>
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
<text x="325" y="172" text-anchor="middle" fill="var(--ink-soft)">客户画像 · Day 48</text>
<rect x="250" y="220" width="150" height="40" rx="5" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="325" y="244" text-anchor="middle" fill="var(--ink)">biz.audit_log 所有写操作</text>
<rect x="20" y="250" width="140" height="56" rx="5" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="90" y="274" text-anchor="middle" fill="var(--ink)">kb.docs</text>
<text x="90" y="292" text-anchor="middle" fill="var(--ink-soft)">62 篇 · content_hash</text>
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
<figcaption>琥珀色是业务数据(工具会查),蓝色是知识库(检索会查)。退款申请单独一张表,有状态机:只有人能把 pending 改成 executed。</figcaption>
</figure>

讲几个刻意的设计。

**CHECK 约束是给 Agent 上的最后一道锁。** `status IN ('paid','open','failed','refunded','void')` 这种约束,意味着就算哪天代码出 bug、模型想办法塞了个奇怪的值,数据库也会拒绝。Agent 系统的原则是:能在越底层拦住的错误,越不要指望上层的提示词。

**退款申请是独立的表,不是账单上的一个字段。** 退款有自己的生命周期(待审批 → 通过/驳回 → 已执行),有审批人、审批时间、审批备注、命中的规则。`rule` 字段让审批人一眼看到依据:"annual_first_14_days"还是"duplicate_charge"。审批人不该去猜 Agent 为什么建这个申请。

**审计日志 audit_log。** 所有写操作(建退款申请、转人工、审批)都记一笔,谁、什么时候、做了什么、参数是什么。Day 53 做安全审计时查这里。出了事故第一个问题永远是"它到底干了什么",没有审计日志就答不上来。

**向量维度写死 1024。** bge-m3 输出 1024 维。换 embedding 模型时维度可能变,这时要改这里、删表重建、重新导入。`Embedder` 里会检查维度对不对,不对直接报错,不会悄悄写进去一堆维度错误的向量。

**HNSW 索引对几百行其实没必要**,顺序扫一遍也就几毫秒。建它是因为知识库会长大,而且面试时被问到"向量检索怎么加速"你能说你建过,知道 `vector_cosine_ops` 要和查询时用的 `<=>` 运算符对应,建错了运算符类索引不会被用上。

连接数据库的小工具:

```python
# supportpilot/src/supportpilot/db.py
from collections.abc import Iterator
from contextlib import contextmanager

import psycopg
from pgvector.psycopg import register_vector
from psycopg.rows import dict_row

from .config import get_settings


def connect(url: str | None = None) -> psycopg.Connection:
    """拿一条连接。autocommit=True:每条语句自己提交,需要事务时用 conn.transaction()。"""
    conn = psycopg.connect(url or get_settings().database_url, row_factory=dict_row, autocommit=True)
    register_vector(conn)  # 让 numpy 数组 / list 能直接当 vector 类型传
    return conn


@contextmanager
def session(url: str | None = None) -> Iterator[psycopg.Connection]:
    conn = connect(url)
    try:
        yield conn
    finally:
        conn.close()
```

```python
# supportpilot/scripts/init_db.py
"""建表。第一次连接时还没有 vector 扩展,所以这里用裸 psycopg,不走 db.connect()。"""

from pathlib import Path

import psycopg

from supportpilot.config import get_settings

SCHEMA = Path(__file__).resolve().parent.parent / "db" / "schema.sql"

if __name__ == "__main__":
    with psycopg.connect(get_settings().database_url, autocommit=True) as conn:
        conn.execute(SCHEMA.read_text(encoding="utf-8"))
    print("schema ready")
```

`register_vector` 有个坑:它要求数据库里已经有 vector 扩展。第一次建库时扩展还不存在,所以 `init_db.py` 用裸的 psycopg 连接执行建表脚本,而不是用 `db.connect()`。我第一次就是在这里报了 `vector type not found in the database`,查了半天才反应过来是先有鸡还是先有蛋的问题。

`autocommit=True` 的意思是每条语句执行完立刻提交。需要多条语句一起成功或一起失败时,用 `with conn.transaction():` 包起来。Day 45 导入知识库、Day 46 审批退款都会用到。

## 第四步:造帮助中心

帮助中心是 Agent 回答政策问题的知识来源,也是评测的标准答案来源。这里我做了一个可能和你直觉相反的决定:**不用大模型生成文章,用模板从一份"事实源"渲染出来。**

原因有三个。第一,评测要有标准答案。如果文章是模型写的,"年付退款扣多少手续费"可能这篇写 10%、那篇写 15%,Agent 答哪个都对又都不对。事实只写一次,文章和评测都从同一份事实来,就不会打架。第二,可复现。别人 clone 你的仓库跑 `make data`,得到的文章一字不差,评测分数才能对比。第三,省钱省时间,不用为了造数据先调几百次 API。

代价是文章写得比较板,不像真实帮助中心那样有长有短、有废话有截图。这个代价对我们可以接受:检索和问答的难点在客户的问法千变万化,而不在文章本身。真实项目里你拿到的是公司现成的帮助中心,不用造。

事实源 `kb_facts.py`:

```python
# supportpilot/scripts/kb_facts.py
"""CloudLedger 帮助中心的"事实源"。评测集的标准答案也从这里来,改这里就要重跑造数 + 评测。"""

ENTERPRISE = "企业版按席位计费,每人每月 59 元,最少 5 席,只能年付(起步 3,540 元/年),含专属客户成功经理和 SSO 单点登录。"

# 每篇文章:id、标题、分类、若干 (小标题, 正文)
ARTICLES: list[dict] = [
    # ---------- 套餐与价格 plans ----------
    {"id": "KB-plans-001", "title": "套餐对比:免费版、标准版、专业版、企业版", "category": "plans", "sections": [
        ("价格", "免费版 0 元。标准版 39 元/月,年付 374 元。专业版 99 元/月,年付 950 元。年付相当于月付价格打八折。" + ENTERPRISE),
        ("功能差异", "账套数量:免费版 1 个、标准版 3 个、专业版 10 个。凭证数量:免费版每月 200 笔,付费版不限。"
                    "单次导入上限:免费版 2,000 行、标准版 5 万行、专业版 20 万行。"
                    "银行流水同步:免费版不支持,标准版最多 2 个银行账户,专业版不限。"
                    "开放 API:免费版不开放,标准版 60 次/分钟,专业版 600 次/分钟。多币种只有专业版和企业版有。"),
        ("怎么选", "个人记账或刚起步的小微企业用免费版就够。需要银行流水自动同步选标准版。多主体、多币种或要对接自己系统的选专业版。"),
    ]},
    {"id": "KB-plans-002", "title": "月付和年付有什么区别", "category": "plans", "sections": [
        ("价格", "年付按月付价格的八折计算:标准版年付 374 元,专业版年付 950 元。"),
        ("退款规则不同", "月付不支持退款,只能关闭自动续费,当期到期后停止。年付首次购买 14 天内可无理由全额退款,详见《退款政策总览》。"),
        ("切换", "月付可以随时改成年付,改成年付立即生效,系统按当期剩余天数抵扣。年付不能中途改回月付,只能在到期前关闭自动续费、到期后重新按月购买。"),
    ]},
    {"id": "KB-plans-003", "title": "如何升级套餐", "category": "plans", "sections": [
        ("生效时间", "升级立即生效,新功能马上可用。"),
        ("费用", "系统按当前计费周期剩余天数补差价。例如标准版月付在周期还剩 15 天时升级专业版,补差价约为 (99 - 39) × 15 / 30 = 30 元。"),
        ("操作", "进入「设置 - 订阅与账单 - 更换套餐」,选择目标套餐并支付差价。"),
    ]},
    {"id": "KB-plans-004", "title": "如何降级套餐", "category": "plans", "sections": [
        ("生效时间", "降级在当前计费周期结束后生效,本周期内仍可使用原套餐功能。"),
        ("费用", "降级不退还当前周期的差价。"),
        ("数据影响", "降级后超出新套餐上限的账套会变成只读,不会删除。例如专业版 8 个账套降到标准版,只有 3 个账套可编辑,其余只读。"),
    ]},
    {"id": "KB-plans-005", "title": "企业版与席位", "category": "plans", "sections": [
        ("计费", ENTERPRISE),
        ("增减席位", "增加席位立即生效,按当前周期剩余天数计费。减少席位在下一个计费周期生效。"),
        ("开通方式", "企业版需要联系销售签约,支持对公转账。"),
    ]},
    {"id": "KB-plans-006", "title": "免费版有哪些限制", "category": "plans", "sections": [
        ("限制", "1 个账套,每月 200 笔凭证,单次导入 2,000 行,不支持银行流水同步,不开放 API。"),
        ("超出限制会怎样", "当月凭证超过 200 笔后只能查看不能新增,下个自然月 1 日恢复。"),
    ]},
    {"id": "KB-plans-007", "title": "专业版免费试用规则", "category": "plans", "sections": [
        ("试用", "新注册账户可免费试用专业版 14 天,不需要绑定支付方式。"),
        ("试用结束", "试用结束后自动降为免费版,不会自动扣费。试用期间创建的数据全部保留,超出免费版上限的账套变为只读。"),
    ]},
    {"id": "KB-plans-008", "title": "取消订阅后数据还在吗", "category": "plans", "sections": [
        ("数据保留", "取消订阅或订阅因欠费被取消后,账户降为免费版,数据保留 90 天。90 天内重新订阅可完整恢复。"),
        ("导出", "建议在取消前通过「设置 - 数据导出」导出全部账套,导出格式为 xlsx。"),
    ]},
    # ---------- 账单与扣费 billing ----------
    {"id": "KB-billing-001", "title": "自动续费什么时候扣款", "category": "billing", "sections": [
        ("扣款时间", "开启自动续费的订阅,会在当前计费周期结束前 1 天自动扣款。"),
        ("提醒", "年付订阅在扣款前 7 天会发邮件提醒,月付订阅不单独提醒。"),
    ]},
    {"id": "KB-billing-002", "title": "如何关闭自动续费", "category": "billing", "sections": [
        ("操作", "进入「设置 - 订阅与账单」,点击「关闭自动续费」。关闭后当前周期照常使用,到期后不再扣款。"),
        ("注意", "关闭自动续费不等于退款。已经扣过的款项是否能退,按《退款政策总览》处理。"),
    ]},
    {"id": "KB-billing-003", "title": "扣款失败怎么办", "category": "billing", "sections": [
        ("自动重试", "扣款失败后系统会在第 1、3、7 天各重试一次。"),
        ("逾期状态", "第 7 天仍未成功,订阅进入「逾期」(past_due)状态,所有账套变为只读。"),
        ("取消", "第 14 天仍未支付,订阅自动取消,账户降为免费版,数据保留 90 天。"),
        ("怎么处理", "在「设置 - 订阅与账单」更换支付方式后点击「立即支付」,支付成功后立即恢复。常见失败原因见《E4001 支付失败》。"),
    ]},
    {"id": "KB-billing-004", "title": "被重复扣款怎么办", "category": "billing", "sections": [
        ("自动退回", "系统会在 24 小时内自动检测同一订阅同一周期的重复扣款并原路退回。"),
        ("人工处理", "超过 24 小时仍未退回的,请联系客服提供账单号,核实后全额退还重复扣款的那一笔。"),
    ]},
    {"id": "KB-billing-005", "title": "支持哪些支付方式", "category": "billing", "sections": [
        ("方式", "微信支付、支付宝、Visa / Mastercard 信用卡。对公转账只支持年付订阅和企业版。"),
        ("对公转账", "对公转账到账后 1 个工作日内开通,备注里要写账户邮箱。"),
    ]},
    {"id": "KB-billing-006", "title": "在哪里查看账单", "category": "billing", "sections": [
        ("位置", "「设置 - 订阅与账单 - 账单记录」列出全部账单,每张账单有唯一账单号,格式如 INV-202609-0001。"),
        ("账单状态", "已支付(paid)、待支付(open)、支付失败(failed)、已退款(refunded)、已作废(void)。"),
    ]},
    {"id": "KB-billing-007", "title": "席位变动怎么计费", "category": "billing", "sections": [
        ("增加", "增加席位立即生效,按当前周期剩余天数折算收费。"),
        ("减少", "减少席位在下个计费周期生效,本周期不退费。"),
    ]},
    {"id": "KB-billing-008", "title": "价格调整会影响老用户吗", "category": "billing", "sections": [
        ("规则", "价格调整提前 30 天邮件通知。已经付费的当前周期不受影响,从下一个续费周期开始按新价格。"),
    ]},
    # ---------- 发票 invoice ----------
    {"id": "KB-invoice-001", "title": "如何申请发票", "category": "invoice", "sections": [
        ("时限", "付款后 90 天内可以在「设置 - 发票」在线申请。超过 90 天需要联系客服。"),
        ("类型与时效", "电子普通发票 1 个工作日内开出。增值税专用发票需要先完成企业认证,3 个工作日内开出。"),
        ("接收", "发票发送到账户邮箱,可以在申请时改成其他接收邮箱。"),
    ]},
    {"id": "KB-invoice-002", "title": "普通发票和专用发票怎么选", "category": "invoice", "sections": [
        ("区别", "增值税专用发票可以抵扣进项税,需要企业认证并填写开户行和账号。个人和不需要抵扣的企业选电子普通发票。"),
    ]},
    {"id": "KB-invoice-003", "title": "发票开错了怎么重开", "category": "invoice", "sections": [
        ("30 天内", "开票后 30 天内可在「设置 - 发票」在线申请红冲重开,每张发票只能在线重开一次。"),
        ("超过 30 天", "超过 30 天或已经重开过一次的,请联系客服人工处理。"),
    ]},
    {"id": "KB-invoice-004", "title": "退款后发票怎么处理", "category": "invoice", "sections": [
        ("规则", "全额退款的账单,对应发票由系统自动红冲作废。部分退款的,先红冲原发票,再按实付金额重新开票。"),
    ]},
    {"id": "KB-invoice-005", "title": "境外公司能开发票吗", "category": "invoice", "sections": [
        ("规则", "境外公司可以申请英文形式发票(Commercial Invoice),不含中国增值税发票。在申请发票页选择「境外主体」。"),
    ]},
    {"id": "KB-invoice-006", "title": "发票抬头和税号怎么填", "category": "invoice", "sections": [
        ("要求", "抬头必须和营业执照上的名称完全一致。税号(统一社会信用代码)为 15、18 或 20 位。填错会出现 E4002 校验失败。"),
    ]},
    # ---------- 退款 refund ----------
    {"id": "KB-refund-001", "title": "退款政策总览", "category": "refund", "sections": [
        ("年付首次购买", "年付订阅首次购买后 14 天内(含第 14 天)可无理由申请全额退款。"),
        ("年付超过 14 天", "超过 14 天的年付订阅,按剩余完整月份比例退款,并扣除 10% 手续费:退款金额 = 年付金额 × 剩余完整月数 / 12 × 90%。"),
        ("年付续费", "年付自动续费后 7 天内可申请全额退款。"),
        ("月付", "月付订阅不支持退款,可以关闭自动续费,当期到期后停止。重复扣款和系统错误导致的多扣款除外。"),
        ("审核", "所有退款都要经过人工审核,审核通过后才会发起退款。客服和智能助手不能直接承诺到账。"),
    ]},
    {"id": "KB-refund-002", "title": "年付 14 天无理由退款", "category": "refund", "sections": [
        ("条件", "首次购买的年付订阅,从付款日起 14 天内(含第 14 天)申请,全额退款,不需要说明理由。"),
        ("不适用", "续费订单、企业版合同订单不适用 14 天无理由退款。续费订单按续费 7 天规则处理。"),
    ]},
    {"id": "KB-refund-003", "title": "年付超过 14 天怎么退", "category": "refund", "sections": [
        ("计算方法", "按剩余完整月份比例退款并扣除 10% 手续费。例如 950 元的专业版年付,用了 4 个多月,剩余完整月份 7 个,"
                    "退款 = 950 × 7 / 12 × 0.9 ≈ 498.75 元。"),
        ("退款后", "退款完成后订阅立即取消,账户降为免费版。"),
    ]},
    {"id": "KB-refund-004", "title": "月付可以退款吗", "category": "refund", "sections": [
        ("规则", "月付订阅不支持退款。如果不想继续使用,关闭自动续费即可,当期结束后不再扣款。"),
        ("例外", "被重复扣款或因系统错误多扣的款项,全额退还。"),
    ]},
    {"id": "KB-refund-005", "title": "退款多久到账", "category": "refund", "sections": [
        ("原路返回", "退款审核通过后原路返回:微信支付、支付宝 1–3 个工作日,银行卡 3–7 个工作日,对公转账 5–10 个工作日。"),
    ]},
    {"id": "KB-refund-006", "title": "如何申请退款", "category": "refund", "sections": [
        ("渠道", "通过在线客服或工单提交退款申请,写明账单号和原因。"),
        ("流程", "客服核实账单和退款规则后创建退款申请,财务人工审核,审核结果邮件通知。金额超过 1,000 元的退款需要财务复核,时间可能多 1 个工作日。"),
    ]},
    # ---------- 账户 account ----------
    {"id": "KB-account-001", "title": "收不到验证码怎么办", "category": "account", "sections": [
        ("检查", "确认手机号或邮箱填写正确,邮件验证码检查垃圾邮件箱。"),
        ("频率限制", "验证码 60 秒后可以重新发送,同一手机号每天最多发送 10 次。验证码有效期 5 分钟,过期会提示 E1001。"),
    ]},
    {"id": "KB-account-002", "title": "修改绑定的手机号或邮箱", "category": "account", "sections": [
        ("操作", "「设置 - 账户安全」中修改,需要同时验证旧手机号(或旧邮箱)和新手机号(或新邮箱)。"),
        ("旧手机号不可用", "旧手机号已经停用的,需要提交工单并上传身份证明或营业执照,人工审核 2 个工作日。"),
    ]},
    {"id": "KB-account-003", "title": "忘记密码", "category": "account", "sections": [
        ("重置", "登录页点击「忘记密码」,通过手机或邮箱验证码重置。重置成功后账号锁定状态同时解除。"),
    ]},
    {"id": "KB-account-004", "title": "子账号与权限", "category": "account", "sections": [
        ("子账号", "管理员可以在「设置 - 成员」邀请成员,每个成员占用一个席位(企业版)或计入成员上限(标准版 5 人、专业版 20 人)。"),
        ("角色", "内置三种角色:管理员、会计、只读。只读成员不能新增或修改凭证。"),
    ]},
    {"id": "KB-account-005", "title": "开启两步验证", "category": "account", "sections": [
        ("操作", "「设置 - 账户安全 - 两步验证」,用验证器 App 扫码绑定。开启后每次在新设备登录都要输入 6 位动态码。"),
        ("丢失设备", "丢失验证器设备的,用开启时保存的恢复码登录;恢复码也丢失的,提交工单人工核验身份。"),
    ]},
    {"id": "KB-account-006", "title": "注销账号", "category": "account", "sections": [
        ("条件", "注销前需要先取消所有付费订阅,并且没有待支付账单。"),
        ("后果", "注销后 15 天内可以撤销,超过 15 天所有数据永久删除,无法恢复。"),
    ]},
    # ---------- 使用与技术 technical ----------
    {"id": "KB-technical-001", "title": "导入凭证和科目", "category": "technical", "sections": [
        ("模板", "在「导入」页面下载官方模板,按模板列填写。支持 .xlsx 和 .csv,单个文件不超过 10MB。"),
        ("上限", "单次导入行数上限:免费版 2,000 行、标准版 5 万行、专业版 20 万行。超出会提示 E2002。"),
    ]},
    {"id": "KB-technical-002", "title": "导出账套数据", "category": "technical", "sections": [
        ("操作", "「设置 - 数据导出」,选择账套和期间,导出为 xlsx。大账套导出完成后会发邮件通知下载,下载链接 7 天有效。"),
    ]},
    {"id": "KB-technical-003", "title": "连接银行账户同步流水", "category": "technical", "sections": [
        ("支持", "标准版最多连接 2 个银行账户,专业版不限,免费版不支持。"),
        ("授权有效期", "银行授权有效期 90 天,到期需要重新授权,否则同步失败并提示 E3001。"),
        ("同步频率", "每天自动同步 2 次(8:00 和 20:00),也可以手动点「立即同步」。"),
    ]},
    {"id": "KB-technical-004", "title": "多账套管理", "category": "technical", "sections": [
        ("数量", "免费版 1 个、标准版 3 个、专业版 10 个账套。企业版不限。"),
        ("切换", "左上角账套名称处切换。不同账套之间数据完全隔离。"),
    ]},
    {"id": "KB-technical-005", "title": "期末结账步骤", "category": "technical", "sections": [
        ("步骤", "1. 审核本期全部凭证;2. 结转损益;3. 点击「期末结账」。任一步没完成会提示 E3003。"),
        ("反结账", "管理员可以在「期末处理」中反结账到上一期,反结账会记录操作日志。"),
    ]},
    {"id": "KB-technical-006", "title": "移动端和网页端数据不一致", "category": "technical", "sections": [
        ("原因", "移动端每 5 分钟同步一次,刚在网页端修改的数据可能还没同步。"),
        ("处理", "在移动端下拉刷新。App 版本低于 5.2 的请先升级,旧版本会出现 E3002 同步失败。"),
    ]},
    {"id": "KB-technical-007", "title": "支持哪些浏览器", "category": "technical", "sections": [
        ("支持", "最新两个大版本的 Chrome、Edge、Safari 和 Firefox。不支持 IE。"),
    ]},
    {"id": "KB-technical-008", "title": "多币种与汇率", "category": "technical", "sections": [
        ("范围", "多币种只在专业版和企业版提供,支持 30 种货币。"),
        ("汇率", "每日 9:30 自动更新中国人民银行公布的汇率中间价,也可以手动录入。"),
    ]},
    # ---------- 开放 API api ----------
    {"id": "KB-api-001", "title": "开放 API 入门", "category": "api", "sections": [
        ("开通", "标准版及以上可以在「开放平台」创建 API Key。免费版不开放 API。"),
        ("文档", "接口使用 HTTPS + JSON,鉴权方式是在请求头加 Authorization: Bearer <API Key>。"),
    ]},
    {"id": "KB-api-002", "title": "API 限流规则", "category": "api", "sections": [
        ("额度", "标准版 60 次/分钟,专业版 600 次/分钟,企业版可单独申请。超过会返回 HTTP 429 和错误码 E5001。"),
        ("建议", "收到 429 后读取响应头 Retry-After,按指数退避重试。"),
    ]},
    {"id": "KB-api-003", "title": "API Key 管理", "category": "api", "sections": [
        ("有效期", "API Key 有效期 365 天,到期前 14 天邮件提醒。过期或被重置的 Key 调用会返回 E5002。"),
        ("安全", "Key 只在创建时显示一次。怀疑泄露请立即在开放平台重置。"),
    ]},
    {"id": "KB-api-004", "title": "Webhook 事件通知", "category": "api", "sections": [
        ("事件", "支持凭证创建、凭证审核、期末结账、账单支付四类事件。"),
        ("重试", "推送失败会在 1 分钟、10 分钟、1 小时后重试,共 3 次。签名校验用 HMAC-SHA256。"),
    ]},
]

# 报错码:每个生成一篇文章
ERRORS = [
    ("E1001", "验证码已过期", "account", "验证码有效期 5 分钟,超时后失效。",
     ["重新获取验证码(60 秒后可重发)", "同一手机号每天最多发送 10 次,超出次日再试"]),
    ("E1002", "账号已锁定", "account", "连续 5 次输错密码,账号锁定 30 分钟。",
     ["等待 30 分钟自动解锁", "或者通过「忘记密码」重置,重置后立即解锁"]),
    ("E2001", "导入文件格式不支持", "technical", "只支持 .xlsx 和 .csv,单个文件不超过 10MB。",
     ["用官方模板重新整理数据", ".xls 老格式请另存为 .xlsx", "大于 10MB 的文件拆分后分批导入"]),
    ("E2002", "导入行数超过套餐上限", "technical", "单次导入行数超出当前套餐上限(免费版 2,000 行、标准版 5 万行、专业版 20 万行)。",
     ["把文件拆成多个小文件分批导入", "或者升级套餐提高上限"]),
    ("E3001", "银行流水同步失败", "technical", "最常见的原因是银行授权超过 90 天已过期。",
     ["进入「银行账户」点击「重新授权」", "授权成功后点「立即同步」", "仍失败的,确认网银没有修改密码或注销"]),
    ("E3002", "移动端同步失败", "technical", "App 版本低于 5.2,或网络中断。",
     ["升级 App 到 5.2 及以上", "下拉刷新重试"]),
    ("E3003", "期末结账失败", "technical", "本期存在未审核的凭证,或者损益还没结转。",
     ["在凭证列表筛选「未审核」并审核", "执行「结转损益」", "再次点击「期末结账」"]),
    ("E3004", "报表借贷不平", "technical", "通常是存在跨期凭证或手工修改过期初余额。",
     ["运行「工具 - 数据检查」定位问题凭证", "修正后重新生成报表"]),
    ("E4001", "支付失败,卡被拒绝", "billing", "银行卡余额不足、超出单笔限额或卡已过期。",
     ["换一张卡或改用微信、支付宝", "联系发卡行确认是否限制了境外/网络支付"]),
    ("E4002", "发票税号校验失败", "invoice", "税号位数不对,或者和抬头不匹配。",
     ["税号应为 15、18 或 20 位", "抬头和税号都以营业执照为准"]),
    ("E5001", "API 请求过于频繁", "api", "超出套餐的 API 限流(标准版 60 次/分钟,专业版 600 次/分钟),返回 HTTP 429。",
     ["读取 Retry-After 响应头后再重试", "批量接口合并请求", "需要更高额度可升级专业版"]),
    ("E5002", "API Key 无效", "api", "Key 已过期(有效期 365 天)或已被重置。",
     ["在开放平台重新生成 Key", "更新你系统里保存的 Key"]),
]

ARTICLES += [
    {"id": "KB-account-007", "title": "查看和移除登录设备", "category": "account", "sections": [
        ("查看", "「设置 - 账户安全 - 登录设备」列出最近 30 天登录过的设备、地点和时间。"),
        ("移除", "点击设备右侧「下线」即可强制退出。发现陌生设备请立即修改密码并开启两步验证。"),
    ]},
    {"id": "KB-billing-009", "title": "优惠券怎么用", "category": "billing", "sections": [
        ("使用", "购买或续费时在支付页输入优惠码。每个订单只能用一张优惠券,不能和年付八折以外的活动叠加。"),
        ("退款时", "使用了优惠券的订单退款按实付金额计算,优惠券不退回。"),
    ]},
    {"id": "KB-invoice-007", "title": "修改发票接收邮箱", "category": "invoice", "sections": [
        ("操作", "申请发票时可以填写接收邮箱,默认是账户邮箱。已经开出的发票可以在「设置 - 发票」点「重新发送」到新邮箱。"),
    ]},
    {"id": "KB-technical-009", "title": "凭证打印排版", "category": "technical", "sections": [
        ("纸张", "支持 A4 和 A5 两种纸张,默认 A4 一页打印两张凭证。"),
        ("调整", "在「打印设置」里调整边距和字号,预览满意后再打印。打印偏移通常是浏览器缩放不是 100% 导致的。"),
    ]},
]
```

最后那段 `ARTICLES +=` 是我写完前面 58 篇后补的 4 篇,凑够 60 篇以上,也顺便留着这个痕迹:真实项目里知识库就是这样一点点补的,Day 45 的增量导入就是为这种情况准备的。

渲染脚本:

```python
# supportpilot/scripts/gen_kb.py
"""把 kb_facts 里的事实渲染成帮助中心 markdown,写到 data/kb/。确定性输出,可重复运行。"""

from pathlib import Path

from kb_facts import ARTICLES, ERRORS

OUT = Path(__file__).resolve().parent.parent / "data" / "kb"
UPDATED = "2026-09-15"


def render(doc_id: str, title: str, category: str, sections: list[tuple[str, str]]) -> str:
    num = doc_id.rsplit("-", 1)[1]
    head = (f"---\nid: {doc_id}\ntitle: {title}\ncategory: {category}\n"
            f"updated_at: {UPDATED}\nurl_path: /help/{category}/{num}\n---\n\n# {title}\n")
    body = "".join(f"\n## {h}\n\n{t}\n" for h, t in sections)
    return head + body


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    for old in OUT.glob("*.md"):
        old.unlink()
    docs = [(a["id"], a["title"], a["category"], a["sections"]) for a in ARTICLES]
    for i, (code, name, cat, cause, steps) in enumerate(ERRORS, start=1):
        steps_md = "\n".join(f"{n}. {s}" for n, s in enumerate(steps, start=1))
        docs.append((f"KB-error-{i:03d}", f"{code} {name}", "error", [
            ("报错含义", f"界面提示 {code}「{name}」。"),
            ("原因", cause),
            ("处理步骤", steps_md),
            ("仍未解决", f"请提交工单并附上报错截图、报错码 {code} 和发生时间。所属模块:{cat}。"),
        ]))
    for doc_id, title, cat, sections in docs:
        (OUT / f"{doc_id}.md").write_text(render(doc_id, title, cat, sections), encoding="utf-8")
    print(f"wrote {len(docs)} articles to {OUT}")


if __name__ == "__main__":
    main()
```

跑完 `data/kb/` 下有 62 个文件。看一篇长什么样:

```markdown
---
id: KB-refund-002
title: 年付 14 天无理由退款
category: refund
updated_at: 2026-09-15
url_path: /help/refund/002
---

# 年付 14 天无理由退款

## 条件

首次购买的年付订阅,从付款日起 14 天内(含第 14 天)申请,全额退款,不需要说明理由。

## 不适用

续费订单、企业版合同订单不适用 14 天无理由退款。续费订单按续费 7 天规则处理。
```

frontmatter 里的 `id` 是引用编号,Day 47 的回复里会出现 `[KB-refund-002]` 这样的标注,Day 45 的 `render_sources` 再把它换成客户能点的链接。编号格式 `KB-分类-三位数字` 是刻意定死的,质检时用正则就能检查有没有编造编号。

报错码文章单独一类,12 篇,模板一样:含义、原因、处理步骤、仍未解决怎么办。客户工单里出现 `E3001` 这种字符串时,纯向量检索经常找不准(向量对"一串编号"不敏感),这就是 Day 45 要上混合检索的原因。

## 第五步:造业务库

业务数据分两部分:12 个手工设计的"剧情客户",每个对应一类评测场景;188 个随机客户,让数据看起来像真的,也让检索和查询不至于太容易。

| 客户 | 剧情 | 正确处理 |
| --- | --- | --- |
| C0001 张伟 | 正常的标准版月付 | 用来问政策类问题 |
| C0002 李娜 | 专业版年付首购,9 月 24 日付款,第 7 天 | 全额退 950 |
| C0003 王芳 | 专业版年付首购,5 月 20 日,超过 14 天 | 剩 7 个完整月,退 950 × 7/12 × 0.9 = 498.75 |
| C0004 刘洋 | 标准版月付,9 月 12 日被扣了两次 39 元 | 重复扣款,退一笔 39 |
| C0005 陈静 | 标准版月付,想退本月费用 | 月付不退,建议关闭自动续费 |
| C0006 杨磊 | 专业版月付,9 月 22 日扣款失败,已逾期 | 解释逾期规则,引导更换支付方式 |
| C0007 赵敏 | 标准版年付,9 月 27 日自动续费 | 续费 7 天内,全额退 374 |
| C0008 黄强 | 企业版 10 席,7,080 元,合同单 | 不适用自助退款,转客户成功经理 |
| C0009 周婷 | 免费版 | 问 API 等付费功能 |
| C0010 吴刚 | 专业版 VIP,银行同步 E3001 已经出过 3 次 | Day 48 客户画像要用到 |
| C0011 徐丽 | 标准版年付首购,9 月 17 日,正好第 14 天 | 边界:含第 14 天,全额退 374 |
| C0012 孙浩 | 标准版年付首购,9 月 16 日,第 15 天 | 边界:刚过线,退 374 × 11/12 × 0.9 = 308.55 |

徐丽和孙浩这一对是专门测边界的。"14 天内"到底含不含第 14 天,这种问题模型很容易答错,代码写错一个 `<` 和 `<=` 也会错。有这一对用例,两种错都能被抓到。

```python
# supportpilot/scripts/seed_db.py
"""造 CloudLedger 业务库。前 12 个客户是手工设计的"剧情客户",评测集会用到;其余随机生成。
固定随机种子 + 固定 TODAY,每次跑出来的数据一模一样。"""

import random
from datetime import date, timedelta

from supportpilot.config import get_settings
from supportpilot.db import session

TODAY = get_settings().sp_today  # 默认 2026-10-01
PRICE = {("standard", "monthly"): 39, ("standard", "yearly"): 374,
         ("pro", "monthly"): 99, ("pro", "yearly"): 950, ("free", "monthly"): 0}


def add_months(d: date, n: int) -> date:
    m = d.month - 1 + n
    y, m = d.year + m // 12, m % 12 + 1
    days_in_month = [31, 29 if y % 4 == 0 and (y % 100 or y % 400 == 0) else 28,
                     31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1]
    return date(y, m, min(d.day, days_in_month))


class Builder:
    def __init__(self) -> None:
        self.customers: list[dict] = []
        self.subs: list[dict] = []
        self.invoices: list[dict] = []
        self.tickets: list[dict] = []
        self._inv_seq: dict[str, int] = {}

    def customer(self, cid: str, name: str, email: str, company: str, *, vip: bool = False,
                 created: date = date(2025, 6, 1), region: str = "上海") -> str:
        self.customers.append({"id": cid, "name": name, "email": email, "company": company,
                               "region": region, "is_vip": vip, "created_at": created})
        return cid

    def sub(self, cid: str, plan: str, cycle: str, started: date, *, status: str = "active",
            seats: int = 1, price: float | None = None, period_end: date | None = None) -> str:
        sid = f"S{len(self.subs) + 1:04d}"
        price = PRICE[(plan, cycle)] if price is None else price
        if period_end is None:  # 默认:当前周期包含 TODAY
            step = 1 if cycle == "monthly" else 12
            period_end = started
            while period_end <= TODAY:
                period_end = add_months(period_end, step)
        self.subs.append({"id": sid, "customer_id": cid, "plan": plan, "billing_cycle": cycle,
                          "status": status, "seats": seats, "price_cny": price, "started_at": started,
                          "current_period_end": period_end, "auto_renew": True})
        return sid

    def invoice(self, cid: str, sid: str, amount: float, issued: date, period_start: date, period_end: date,
                *, status: str = "paid", first: bool = False) -> str:
        ym = issued.strftime("%Y%m")
        self._inv_seq[ym] = self._inv_seq.get(ym, 0) + 1
        iid = f"INV-{ym}-{self._inv_seq[ym]:04d}"
        self.invoices.append({"id": iid, "customer_id": cid, "subscription_id": sid, "amount_cny": amount,
                              "status": status, "issued_at": issued,
                              "paid_at": issued if status in ("paid", "refunded") else None,
                              "period_start": period_start, "period_end": period_end,
                              "is_first_purchase": first})
        return iid

    def monthly_history(self, cid: str, sid: str, plan: str, started: date) -> None:
        d, first = started, True
        while d <= TODAY:
            self.invoice(cid, sid, PRICE[(plan, "monthly")], d, d, add_months(d, 1), first=first)
            d, first = add_months(d, 1), False

    def ticket(self, cid: str, email: str, subject: str, body: str, category: str, created: date,
               summary: str) -> None:
        self.tickets.append({"id": f"T{len(self.tickets) + 1:06d}", "customer_id": cid, "customer_email": email,
                             "subject": subject, "body": body, "category": category, "status": "resolved",
                             "created_at": created, "resolved_at": created, "resolution_summary": summary})


def build() -> Builder:
    b = Builder()
    # ---------- 剧情客户 C0001–C0012:每个对应一类评测场景 ----------
    c = b.customer("C0001", "张伟", "zhangwei@example.com", "张伟工作室")       # 正常的标准版月付
    s = b.sub(c, "standard", "monthly", date(2026, 3, 5))
    b.monthly_history(c, s, "standard", date(2026, 3, 5))

    c = b.customer("C0002", "李娜", "lina@example.com", "娜美贸易")            # 年付首购 7 天:全额退
    s = b.sub(c, "pro", "yearly", date(2026, 9, 24))
    b.invoice(c, s, 950, date(2026, 9, 24), date(2026, 9, 24), date(2027, 9, 24), first=True)

    c = b.customer("C0003", "王芳", "wangfang@example.com", "芳华咨询")         # 年付超 14 天:按月比例退
    s = b.sub(c, "pro", "yearly", date(2026, 5, 20))
    b.invoice(c, s, 950, date(2026, 5, 20), date(2026, 5, 20), date(2027, 5, 20), first=True)

    c = b.customer("C0004", "刘洋", "liuyang@example.com", "洋帆科技")          # 9 月被扣了两次
    s = b.sub(c, "standard", "monthly", date(2026, 6, 12))
    b.monthly_history(c, s, "standard", date(2026, 6, 12))
    b.invoice(c, s, 39, date(2026, 9, 12), date(2026, 9, 12), date(2026, 10, 12))  # 重复的那一笔

    c = b.customer("C0005", "陈静", "chenjing@example.com", "静心花艺")         # 月付想退款:不符合
    s = b.sub(c, "standard", "monthly", date(2026, 7, 8))
    b.monthly_history(c, s, "standard", date(2026, 7, 8))

    c = b.customer("C0006", "杨磊", "yanglei@example.com", "磊落物流")          # 扣款失败、已逾期
    s = b.sub(c, "pro", "monthly", date(2026, 4, 22), status="past_due",
              period_end=date(2026, 10, 22))
    for m in range(5):
        d = add_months(date(2026, 4, 22), m)
        b.invoice(c, s, 99, d, d, add_months(d, 1), first=(m == 0))
    b.invoice(c, s, 99, date(2026, 9, 22), date(2026, 9, 22), date(2026, 10, 22), status="failed")

    c = b.customer("C0007", "赵敏", "zhaomin@example.com", "敏思设计")          # 年付续费 4 天:续费 7 天规则
    s = b.sub(c, "standard", "yearly", date(2025, 9, 27))
    b.invoice(c, s, 374, date(2025, 9, 27), date(2025, 9, 27), date(2026, 9, 27), first=True)
    b.invoice(c, s, 374, date(2026, 9, 27), date(2026, 9, 27), date(2027, 9, 27))

    c = b.customer("C0008", "黄强", "huangqiang@example.com", "强盛制造集团", vip=True)  # 企业版合同:不走无理由退款
    s = b.sub(c, "enterprise", "yearly", date(2026, 9, 28), seats=10, price=7080)
    b.invoice(c, s, 7080, date(2026, 9, 28), date(2026, 9, 28), date(2027, 9, 28), first=True)

    c = b.customer("C0009", "周婷", "zhouting@example.com", "")                 # 免费版用户
    b.sub(c, "free", "monthly", date(2026, 8, 1), price=0)

    c = b.customer("C0010", "吴刚", "wugang@example.com", "刚正财税", vip=True)   # 老客户,反复遇到银行同步问题
    s = b.sub(c, "pro", "yearly", date(2026, 1, 10))
    b.invoice(c, s, 950, date(2026, 1, 10), date(2026, 1, 10), date(2027, 1, 10), first=True)
    for d in (date(2026, 4, 11), date(2026, 7, 13), date(2026, 9, 2)):
        b.ticket(c, "wugang@example.com", "银行流水又不同步了", "招商银行账户流水同步失败,提示 E3001。", "technical",
                 d, "银行授权 90 天到期,指导客户重新授权后恢复。客户希望到期前能提醒。")

    c = b.customer("C0011", "徐丽", "xuli@example.com", "丽人美业")             # 年付首购正好第 14 天:边界
    s = b.sub(c, "standard", "yearly", date(2026, 9, 17))
    b.invoice(c, s, 374, date(2026, 9, 17), date(2026, 9, 17), date(2027, 9, 17), first=True)

    c = b.customer("C0012", "孙浩", "sunhao@example.com", "浩瀚电商")           # 年付首购第 15 天:刚过线
    s = b.sub(c, "standard", "yearly", date(2026, 9, 16))
    b.invoice(c, s, 374, date(2026, 9, 16), date(2026, 9, 16), date(2027, 9, 16), first=True)

    # ---------- 随机客户 C0013–C0200 ----------
    rng = random.Random(42)
    surnames = "王李张刘陈杨黄赵吴周徐孙马朱胡郭何林罗高"
    given = ["静", "磊", "婷", "强", "敏", "军", "燕", "杰", "娟", "涛", "明", "超", "霞", "平", "刚", "桂英", "建华", "晓东"]
    shops = ["商贸", "科技", "咨询", "设计", "餐饮", "物流", "电商", "教育", "财税", "传媒"]
    topics = [("怎么开专票", "invoice", "指导客户完成企业认证后申请增值税专用发票。"),
              ("导入提示 E2001", "technical", "客户上传了 .xls 文件,指导另存为 .xlsx 后导入成功。"),
              ("扣款失败", "billing", "客户信用卡过期,更换为支付宝后支付成功。"),
              ("想升级专业版", "plan_change", "说明升级立即生效并按剩余天数补差价,客户已自助升级。"),
              ("收不到验证码", "account", "验证码进了垃圾邮件箱,客户找到后登录成功。")]
    for i in range(13, 201):
        name = rng.choice(surnames) + rng.choice(given)
        cid = b.customer(f"C{i:04d}", name, f"user{i:04d}@example.com", f"{name}{rng.choice(shops)}",
                         created=date(2025, 1, 1) + timedelta(days=rng.randint(0, 600)),
                         region=rng.choice(["北京", "上海", "广州", "深圳", "杭州", "成都", "武汉"]))
        plan = rng.choices(["free", "standard", "pro"], weights=[3, 5, 2])[0]
        cycle = "monthly" if plan == "free" else rng.choice(["monthly", "yearly"])
        started = TODAY - timedelta(days=rng.randint(20, 400))
        sid = b.sub(cid, plan, cycle, started)
        if plan != "free":
            if cycle == "monthly":
                b.monthly_history(cid, sid, plan, started)
            else:
                d, first = started, True
                while d <= TODAY:
                    b.invoice(cid, sid, PRICE[(plan, cycle)], d, d, add_months(d, 12), first=first)
                    d, first = add_months(d, 12), False
        for _ in range(rng.choice([0, 0, 1, 1, 2])):
            subj, cat, summary = rng.choice(topics)
            b.ticket(cid, f"user{i:04d}@example.com", subj, subj, cat,
                     TODAY - timedelta(days=rng.randint(5, 300)), summary)
    return b


def main() -> None:
    b = build()
    with session() as conn, conn.transaction():
        conn.execute("TRUNCATE biz.audit_log, biz.customer_profiles, biz.refund_requests, biz.tickets, "
                     "biz.invoices, biz.subscriptions, biz.customers CASCADE")
        for table, rows in [("customers", b.customers), ("subscriptions", b.subs),
                            ("invoices", b.invoices), ("tickets", b.tickets)]:
            cols = list(rows[0].keys())
            sql = (f"INSERT INTO biz.{table} ({', '.join(cols)}) "
                   f"VALUES ({', '.join('%(' + c + ')s' for c in cols)})")
            with conn.cursor() as cur:
                cur.executemany(sql, rows)
            print(f"{table}: {len(rows)}")


if __name__ == "__main__":
    main()
```

几点说明。

`random.Random(42)` 是一个独立的随机数生成器,固定种子,每次生成的 188 个随机客户一模一样。别用全局的 `random.seed(42)`,别的库也可能调全局随机数,种子会被打乱。

`build()` 和 `main()` 分开,`build()` 只在内存里构造数据,不碰数据库。这样测试可以直接检查造出来的数据对不对,不需要起数据库。这是贯穿整个项目的写法:**纯逻辑和 IO 分开**,纯逻辑的部分随便测。

写库时整个过程在一个事务里,先 TRUNCATE 再插入,中途失败会整体回滚,不会留下一半数据。`executemany` 批量插入,几百行一眨眼的事。

为什么剧情客户的账单号看起来不按日期排(C0002 的 9 月 24 日账单是 `INV-202609-0002`,C0004 的 9 月 12 日账单是 `INV-202609-0003`)?因为序号是按插入顺序发的。真实系统里账单号也不保证和日期严格一致,Agent 不应该依赖账单号的顺序判断先后,应该看日期字段。我故意没修。

## 第六步:Makefile、测试和 README

```makefile
# supportpilot/Makefile
.PHONY: up init seed kb data test eval eval-test api ui mcp

up:            ## 起数据库
	docker compose up -d db
init:          ## 建表
	uv run python scripts/init_db.py
seed:          ## 造业务数据(会清空业务表)
	uv run python scripts/seed_db.py
kb:            ## 生成帮助中心并导入知识库
	cd scripts && uv run python gen_kb.py && cd .. && uv run python scripts/ingest_kb.py
data: init seed kb
test:          ## 单元测试(不连库、不花钱)
	uv run pytest -m "not db and not llm" -q
eval: seed     ## dev 集评测,先重新造数保证起点一致
	uv run python -m evals.run_eval --split dev --label $(or $(LABEL),run)
eval-test: seed
	uv run python -m evals.run_eval --split test --label $(or $(LABEL),run)
api:
	uv run uvicorn supportpilot.api.app:app --reload --port 8000
ui:
	uv run streamlit run src/supportpilot/ui/streamlit_app.py
mcp:
	uv run mcp dev src/supportpilot/tools/mcp_server.py
```

一些目标(eval、api、ui、mcp)要过几天才能用,先写上,README 里的命令就不用天天改。Makefile 要求缩进是 Tab,从网页复制过去的如果变成空格会报 `missing separator`,改回 Tab 就好。

测试先写两个文件:

```python
# supportpilot/tests/conftest.py
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path[:0] = [str(ROOT / "src"), str(ROOT / "tests"), str(ROOT / "scripts"), str(ROOT)]  # 让测试能 import fakes、seed_db、evals
```

```python
# supportpilot/tests/test_seed.py
from seed_db import build


def test_seed_is_deterministic_and_has_story_customers():
    a, b = build(), build()
    assert [i["id"] for i in a.invoices] == [i["id"] for i in b.invoices]   # 固定种子,两次一样
    assert len(a.customers) == 200
    assert len({i["id"] for i in a.invoices}) == len(a.invoices)               # 账单号不重复
    dup = [i for i in a.invoices if i["customer_id"] == "C0004" and str(i["period_start"]) == "2026-09-12"]
    assert len(dup) == 2                                                     # 刘洋的重复扣款剧情还在
```

`conftest.py` 把几个目录加进 import 路径,测试里就能直接 `from seed_db import build`。用 `uv run pytest` 跑时 `src` 已经通过可编辑安装可见,这里再加一次是让你直接用 `python -m pytest` 也能跑。

README 先写个雏形,Day 54 再定稿:

```markdown
# SupportPilot

CloudLedger(虚构的在线记账 SaaS)的智能客服工单 Agent。
政策问题查帮助中心带出处回答;账户问题调工具查账单;退款按规则计算、人工审批后执行;高风险工单转人工。

## 快速开始

    cp .env.example .env      # 填 LLM_API_KEY、EMB_API_KEY
    uv sync
    make up                   # 起 Postgres + pgvector
    make data                 # 建表、造数据、导入知识库(导入知识库在 Day 45 之后可用)
    make test

## 目录
见 docs/PRD.md 和 docs/architecture.md(Day 54)。
```

## 换成真实项目,数据从哪来

上面的数据全是造的。如果你哪天真去一家公司落地客服 Agent(FDE 的日常),数据这件事会麻烦得多,提前知道几个坑。

帮助中心通常是现成的,但质量参差不齐:有的文章三年没更新,有的两篇说法互相矛盾,有的关键规则根本没写进帮助中心,只在老客服的脑子里。第一周的工作往往不是写代码,而是和客服负责人一起把"真实规则"整理出来,Day 43 那张追问清单就是干这个的。整理出来的规则,能写成代码的写成代码,写不成的补进知识库。

业务数据不能直接拿生产库开发。常见做法是从生产库导一份脱敏样本:手机号、邮箱、姓名替换掉,金额和日期保留分布。脱敏要在导出时做,别导出来再处理,中间那份明文数据就是泄漏风险。有些公司根本不允许你碰生产数据,那就只能像我们今天这样,按真实的表结构和业务规则造数据,再找几个真实但脱敏的工单做抽查。

历史工单是最有价值的数据,也是最难拿的。它告诉你客户真实的问法、真实的问题分布、客服当时是怎么答的。Day 50 建评测集时,如果你有真实历史工单,从里面抽一百条比我们手写的场景好得多。拿不到就先手写,上线后从真实流量里补。

## 动手练习

**步骤 1:建仓库并装依赖。** 按第一步的命令执行,确认 `uv run python -c "import supportpilot, langgraph, mcp; print('ok')"` 输出 ok。

**步骤 2:配置。** `cp .env.example .env`,先只填 `LLM_API_KEY` 和 `EMB_API_KEY`(硅基流动注册后在控制台创建,bge-m3 有免费额度,以官网当前说明为准)。今天还用不到 key,但先填好。

**步骤 3:起数据库、建表、造数据。**

```bash
make up
docker compose ps          # db 的状态要是 healthy
make init
make seed
cd scripts && uv run python gen_kb.py && cd ..
```

**步骤 4:用 SQL 核对数据。** 这一步别跳,造数据的 bug 越早发现越便宜。

```bash
docker compose exec db psql -U supportpilot -c "
SELECT (SELECT count(*) FROM biz.customers)     AS customers,
       (SELECT count(*) FROM biz.subscriptions) AS subs,
       (SELECT count(*) FROM biz.invoices)      AS invoices,
       (SELECT count(*) FROM biz.tickets)       AS tickets;"

# 刘洋的重复扣款要能看到两张同周期账单
docker compose exec db psql -U supportpilot -c "
SELECT id, amount_cny, status, period_start FROM biz.invoices
WHERE customer_id = 'C0004' ORDER BY issued_at DESC LIMIT 3;"
```

期望输出:customers 200、subs 200、invoices 459、tickets 152;刘洋最近两张账单的 `period_start` 都是 2026-09-12。如果你改过造数脚本,数字会不同,这没问题,但要确认剧情客户的数据和上面那张表一致。

**步骤 5:跑测试、提交。**

```bash
make test
git add -A && git commit -m "feat: project skeleton, config, schema, seed data"
```

提交时 pre-commit 会跑 ruff,第一次可能自动修几处格式,修完需要再 `git add` 一次。

**验收标准:** `make test` 全绿;SQL 核对的数字和剧情客户数据正确;`git log` 里没有 `.env`;`grep -r "sk-" src scripts` 什么都搜不到。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| uv.lock | 锁定全部依赖精确版本的文件,保证每个人装的一样,要提交进 git |
| dependency group | uv 的依赖分组,dev 组只在开发时装 |
| pydantic-settings | 按字段名从环境变量和 .env 读配置,带类型校验 |
| pre-commit | 在 git commit 前自动运行检查的工具 |
| 命名卷 | Docker 管理的持久化存储,容器删了数据还在 |
| CHECK 约束 | 数据库层面限制某列只能取哪些值 |
| 审计日志 | 记录所有写操作的表,出事时回溯用 |
| 事实源 | 唯一的一份事实定义,文章和评测答案都从它生成 |
| 剧情客户 | 为特定测试场景手工设计的数据 |

## 常见误区

**用大模型批量生成测试数据,然后直接当标准答案。** 模型生成的数据会自相矛盾,你会花大量时间排查"到底是 Agent 错了还是数据错了"。合成数据可以用模型扩充问法(Day 50 会这样做),但事实本身要确定。

**造数据用 `date.today()`。** 今天能过的评测,下周就挂,而且挂得莫名其妙。时间相关的逻辑一律从配置读"今天"。

**把密钥写进代码"先跑起来再说"。** 最常见的泄漏方式就是这么来的。从第一行代码开始就用 `.env`,装 pre-commit 的 detect-private-key。

**依赖不锁版本。** LangGraph、MCP SDK 这一年都有过大版本变化(MCP Python SDK 2.x 把 `FastMCP` 改名成了 `MCPServer`,老代码直接 import 失败)。不锁版本,三个月后你的仓库在面试官电脑上可能跑不起来。

**数据造完不核对。** 剧情客户数据错一点,后面评测就会在莫名其妙的地方失败。SQL 核对五分钟,能省一下午。

## 学习资料

### 文档与文章

- [uv 官方文档](https://docs.astral.sh/uv/):看 "Projects" 一节,搞清楚 `uv init --package`、`uv add --dev`、`uv.lock` 和 `uv sync` 的关系,30 分钟。
- [Ruff 文档](https://docs.astral.sh/ruff/):看规则选择(select/ignore)和 `ruff format`,15 分钟。
- [pre-commit 官网](https://pre-commit.com/):首页的快速开始就够了,10 分钟。
- [pydantic-settings 文档](https://docs.pydantic.dev/latest/concepts/pydantic_settings/):重点看环境变量的优先级和 `.env` 文件支持,20 分钟。
- [pgvector 项目主页](https://github.com/pgvector/pgvector):看 HNSW 索引和距离运算符(`<=>` 余弦、`<->` 欧氏)对应的索引操作符类,20 分钟。

### B 站视频

- 下面嵌的隔壁的程序员老王《从 pip 到 uv:一口气梳理现代 Python 项目管理全流程》:如果 Day 2 学 uv 时没吃透,看这个补。
- 自信膨胀的汤姆《从 Pip 到 UV:驯服 Python 的项目混乱》(BV1ZZnnzdE41,10 分钟):讲 requirements.txt 和 pyproject.toml 的区别,适合 Java/Go 背景的同学理解"Python 为什么有这么多包管理工具"。

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV13WGHz8EEz&autoplay=0&high_quality=1" title="从pip到uv:一口气梳理现代Python项目管理全流程!" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>隔壁的程序员老王 · 从 pip 到 uv:一口气梳理现代 Python 项目管理全流程 · 15 分钟,整段看,重点是项目初始化和锁文件那部分。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1ZZnnzdE41&autoplay=0&high_quality=1" title="从Pip到UV:驯服Python的项目混乱" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>自信膨胀的汤姆 · 从 Pip 到 UV:驯服 Python 的项目混乱 · 10 分钟,看 pyproject.toml 和依赖管理那段。</figcaption>
</figure>

### 其他经典视频

今天这组不需要。工程脚手架的东西看文档比看视频快。

### 书籍

- Chip Huyen《AI Engineering》(O'Reilly,2025)第 8 章 Dataset Engineering:讲数据的质量、覆盖面和合成数据的利弊,读"Data Synthesis"部分,能帮你理解为什么事实源要确定、问法可以合成,约 1 小时。

### 开源项目与代码

- [sierra-research/tau-bench](https://github.com/sierra-research/tau-bench):再看一眼 `envs/retail/data` 目录,它的模拟数据也是固定的 json,不是每次随机生成,原因和我们一样。
- [pgvector/pgvector](https://github.com/pgvector/pgvector):README 里的 Docker 镜像和索引章节。

## 自测

**1. 为什么"今天"要做成配置项 `SP_TODAY`,而不是用 `date.today()`?**

<details><summary>答案</summary>

退款规则按日期计算(首购 14 天、续费 7 天、剩余完整月份)。用真实日期的话,同一条评测用例的标准答案会随时间变化,分数会无缘无故地跳。固定"今天"让评测可复现,上线时再改成跟随系统时间。

</details>

**2. 帮助中心文章为什么用模板渲染,而不是让大模型生成?代价是什么?**

<details><summary>答案</summary>

为了让事实唯一、可复现、不花钱:文章和评测标准答案都从 `kb_facts.py` 来,不会出现两篇文章说法矛盾、或者评测答案和文章不一致。代价是文章风格单调,不像真实帮助中心那样长短不一、表述多样。客户问法的多样性在评测集里用多种说法补上。

</details>

**3. `init_db.py` 为什么不用 `db.connect()`?**

<details><summary>答案</summary>

`db.connect()` 会调 `register_vector`,它要求数据库里已经存在 vector 扩展。第一次建库时扩展还没创建(`CREATE EXTENSION` 就在 schema.sql 里),所以要用裸 psycopg 连接先执行建表脚本。

</details>

**4. 徐丽(第 14 天)和孙浩(第 15 天)这两个剧情客户分别能抓到什么错误?**

<details><summary>答案</summary>

徐丽测"含第 14 天":代码如果写成 `days < 14` 会把她错判成不符合全额退款;模型如果理解成"不到 14 天"也会答错。孙浩测"刚过线":如果把规则写成 `<= 15` 或模型宽松理解,会错误地全额退款。两个一起才能把边界钉死。

</details>

**5. 「面试题」你的项目里为什么在数据库层面加 CHECK 约束?不是已经有代码校验了吗?**

<details><summary>答案</summary>

分层防御。Agent 系统里,写数据的路径可能来自模型生成的参数,代码校验可能有漏洞,提示词约束更不可靠。数据库约束是最底层的保证:不管上层出什么 bug,非法状态都写不进去。同理,退款申请的状态流转、金额都在服务端控制,不依赖模型。

</details>

**6. 「面试题」为什么 `seed_db.py` 要把 `build()` 和写库的 `main()` 分开?**

<details><summary>答案</summary>

纯逻辑和 IO 分离。`build()` 只在内存里生成数据,单元测试可以直接验证数据是否确定、剧情客户是否正确,不需要起数据库,几毫秒跑完;`main()` 只负责写库。整个项目都用这个写法:业务规则、检索融合、评测检查这些纯逻辑都能脱离数据库和大模型测试。

</details>

## 明天预告

Day 45 · 知识库模块:导入、切块、混合检索、引用。把今天生成的 62 篇文章切块、向量化、增量导入 pgvector;实现向量 + BM25 的混合检索和 RRF 融合,可选接 rerank;写引用渲染和"编造编号"检查;最后用评测集里的标准答案跑一份只评检索的基线,看看纯关键词、纯向量和混合检索各能命中多少。
