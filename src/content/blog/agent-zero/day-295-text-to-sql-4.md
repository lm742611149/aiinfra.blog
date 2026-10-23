---
title: 'Day 295 · 问数 Agent(四):表多了怎么办,语义层和基准'
description: 'CloudLedger 只有 5 张表,真实公司的数仓是几百张。今天造一个 68 张表的仓库,量出说明书变长的代价:输入 token 变成 3.1 倍,10 道题从 10/10 掉到 9/10。然后试两种办法,embedding 检索表只召回 7/10,让模型从表目录里挑表 10/10;再写一个最小的语义层,让模型只能点指标不能写 SQL;最后讲 BIRD 和 Spider 2.0 两个基准现在的分数。'
pubDate: 2026-10-23
regime: none
tags: ['text-to-sql', 'schema-linking', 'embedding', 'semantic-layer', 'bird', 'spider', 'agent-zero']
series: 'agent-zero'
day: 295
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 294](/blog/agent-zero/day-294-text-to-sql-3/) 把说明书、`safe_db` 和模型接成了问数循环 `part05/text2sql/ask_data.py`:写 SQL、被拒绝或报错带原因重写、结果自检一次、用人话回答,再用 10 道题评测。第一次 8/10,两道错题是评测器错了,放宽比较函数后 10/10;随后又发现第 9 题的标准答案有并列,改了题目;最后拿「哪家公司欠费了,欠了多少钱」说明了 10/10 不等于做完。

那一切都发生在 5 张表的小库上。说明书全贴进去才 2577 个字符。今天问一个绕不开的问题:**表有 68 张、680 张的时候呢?**

## 今天要解决的问题

学完今天,你要能做到:

1. 造出一个 68 张表的仓库,量出把全部表塞进说明书的代价:字符数、输入 token、评测分数各变了多少。
2. 写出 `part05/text2sql/schema_index.py`,用 embedding 给每张表做「名片」并按问题检索;算出检索的**召回率**,说清它为什么只有 7/10。
3. 写出让模型从表目录里挑表的 `table_picker.py`,和前两种办法放在同一份评测上比分数、比 token、比花费。
4. 写出最小的语义层 `semantic.py`,让模型只能「点菜」不能写 SQL,说得出它和直接写 SQL 各自的取舍。
5. 说得出 BIRD 和 Spider 2.0 测什么、2026 年 10 月榜首大概多少分,以及为什么不能直接拿榜单分数估计自己的系统。

预计用时 3 小时。实跑花费约 ¥0.32,算式在「花了多少钱」一节。

前置:[Day 294](/blog/agent-zero/day-294-text-to-sql-3/)(`ask_data.py` 的 `ask()`、`eval_sql.py`、`eval_v1.py` 的 `CASES`)、[Day 291](/blog/agent-zero/day-291-text-to-sql-1/)(`schema.py`)、[Day 292](/blog/agent-zero/day-292-text-to-sql-2/)(`safe_db.py`、sqlglot)、[Day 217](/blog/agent-zero/day-217-embedding-1/)(`common/embed.py` 的 `embed`、`embed_one`)、[Day 218](/blog/agent-zero/day-218-embedding-2/)(余弦相似度)、[Day 23](/blog/agent-zero/day-023-comprehensions/)(推导式)。

学法:先对照文章逐行敲一遍(不复制粘贴)并跑通;第二天合上文章,把 `schema_index.py` 的 `retrieve()` 和 `semantic.py` 的 `compile_query()` 默写出来;做练习,做不出再展开参考答案,看完关掉自己重写一遍。

所有命令在 `agent-zero-lab/` 根目录跑(我的是 `/Users/你/agent-zero-lab`)。`.env` 里除了 `LLM_*`,还要有 [Day 217](/blog/agent-zero/day-217-embedding-1/) 配好的 `EMB_BASE_URL`、`EMB_API_KEY`、`EMB_MODEL`(我用的是硅基流动的 `BAAI/bge-m3`)。先重置业务库:

```bash
cd /Users/你/agent-zero-lab
uv run python cloudledger/seed.py
```

<div class="line-notes">

- `uv run python cloudledger/seed.py` 删库重建,和前几天同一份 30 个客户、123 张发票的数据。

</div>

## 第 0 步:先造一个「表很多」的仓库

要看表多了会怎样,得先有一个表多的库。我不想为此另造一套业务,办法是复制 `cloudledger.db`,再往里加 63 张别的部门的表:销售、市场、人事、产品、客服、财务各十张上下,每张表只有表名、一句话说明和 5 到 8 个列。核心的 5 张表原样保留,10 道评测题的答案一点不变。

加表时我特意留了三张「长得像核心表」的:`invoices_archive`(2024 年以前的发票归档)、`customers_legacy`(旧 CRM 迁移来的客户)、`subscriptions_history`(订阅变更历史),另有 `finance_payments`(收款流水,每张已付发票一笔)。真实的仓库里这种「像但不是」的表特别多,选错一张,得到的是一个看着合理的另一个数。

```python
# agent-zero-lab/part05/text2sql/make_warehouse.py
"""造一个「表很多」的数据仓库:复制 cloudledger.db,再加 63 张别的部门的表,其中 3 张故意和核心表长得像。"""
import shutil
import sqlite3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SRC = ROOT / "cloudledger" / "cloudledger.db"
DST = ROOT / "cloudledger" / "warehouse.db"

# 每张表一行:表名 | 一句话说明 | 列。列名带 _cents/_count/seats/score 的是整数,id 是主键,xxx_id@表 表示外键
TABLES = """
sales_leads | 销售线索,来自市场活动的潜在客户 | id, name, company, email, source, status, owner_id, created_at
sales_opportunities | 销售机会,跟进中的商机 | id, lead_id, name, stage, amount_cents, expected_close, owner_id, created_at
sales_quotes | 销售报价单 | id, opportunity_id, version, total_cents, status, valid_until, created_at
sales_quote_lines | 报价单明细行 | id, quote_id, product, seats, unit_price_cents, discount_pct
sales_contracts | 已签合同 | id, opportunity_id, signed_at, term_months, total_cents, status
sales_reps | 销售人员 | id, name, email, team, region, hired_at
sales_territories | 销售区域划分 | id, name, region, owner_id
sales_commissions | 销售提成 | id, rep_id, contract_id, amount_cents, paid_at
sales_forecasts | 按季度的销售预测 | id, quarter, rep_id, forecast_cents, committed_cents
sales_notes | 销售跟进记录 | id, opportunity_id, rep_id, body, created_at
marketing_campaigns | 市场活动 | id, name, channel, budget_cents, start_date, end_date, status
marketing_channels | 获客渠道字典 | id, name, kind, cost_model
marketing_leads | 市场线索表,还没转给销售 | id, campaign_id, email, company, score, created_at
marketing_events | 线下和线上活动 | id, name, city, held_at, capacity_count
marketing_event_attendees | 活动参会名单 | id, event_id, email, company, attended
marketing_email_sends | 营销邮件发送记录 | id, campaign_id, email, sent_at, status
marketing_email_clicks | 营销邮件点击记录 | id, send_id, url, clicked_at
marketing_landing_pages | 落地页 | id, path, campaign_id, visits_count, signups_count
marketing_ad_spend | 每日广告花费 | id, campaign_id, spend_date, spend_cents, clicks_count
marketing_utm_sessions | 带 UTM 参数的访问会话 | id, utm_source, utm_medium, utm_campaign, landed_at
hr_employees | 员工花名册 | id, name, email, department_id, position_id, hired_at, status
hr_departments | 部门 | id, name, parent_id, manager_id
hr_positions | 岗位和职级 | id, title, level, salary_min_cents, salary_max_cents
hr_leave_requests | 请假申请 | id, employee_id, kind, start_date, end_date, status
hr_attendance | 考勤打卡 | id, employee_id, work_date, check_in, check_out
hr_payroll_runs | 工资批次 | id, month, total_cents, status, run_at
hr_payslips | 工资条 | id, run_id, employee_id, gross_cents, tax_cents, net_cents
hr_reviews | 绩效评估 | id, employee_id, period, score, reviewer_id
hr_openings | 招聘岗位 | id, position_id, department_id, status, opened_at
hr_candidates | 候选人 | id, opening_id, name, email, stage, applied_at
product_features | 产品功能清单 | id, name, module, released_at, plan_required
product_releases | 版本发布记录 | id, version, released_at, notes
product_usage_events | 用户行为埋点 | id, workspace_id, user_id, event_name, occurred_at
product_feature_flags | 功能开关 | id, name, enabled, rollout_pct, updated_at
product_api_keys | 客户的 API 密钥 | id, workspace_id, prefix, created_at, revoked_at
product_api_calls | API 调用日志 | id, api_key_id, endpoint, status_code, called_at
product_workspaces | 客户的工作区 | id, customer_id@customers, name, created_at, storage_mb
product_workspace_members | 工作区成员 | id, workspace_id, email, role, joined_at
product_exports | 报表导出任务 | id, workspace_id, kind, status, created_at, finished_at
product_integrations | 第三方集成配置 | id, workspace_id, provider, status, connected_at
support_agents | 客服人员 | id, name, email, team, hired_at
support_queues | 工单队列 | id, name, priority, owner_team
support_ticket_comments | 工单下的回复 | id, ticket_id@tickets, author, body, created_at
support_ticket_tags | 工单标签 | id, ticket_id@tickets, tag
support_sla_policies | 服务等级协议 | id, name, first_response_min, resolve_min
support_csat_scores | 客户满意度评分 | id, ticket_id@tickets, score, comment, rated_at
support_kb_articles | 帮助中心文章 | id, title, category, updated_at, views_count
support_kb_feedback | 帮助文章的点赞点踩 | id, article_id, helpful, created_at
support_chat_sessions | 在线客服会话 | id, customer_id@customers, agent_id, started_at, ended_at
support_escalations | 工单升级记录 | id, ticket_id@tickets, from_team, to_team, escalated_at
finance_payments | 收款流水,每张已付发票对应一笔 | id, invoice_id@invoices, amount_cents, method, paid_at
finance_refunds | 已经完成的退款 | id, invoice_id@invoices, amount_cents, reason, refunded_at
finance_credit_notes | 贷项通知单 | id, invoice_id@invoices, amount_cents, issued_at
finance_tax_rates | 各地区税率 | id, region, rate_pct, effective_from
finance_currencies | 币种 | id, code, name, minor_units
finance_exchange_rates | 汇率 | id, currency_id, rate_date, rate_micro
finance_ledger_entries | 总账分录 | id, account_id, entry_date, debit_cents, credit_cents, memo
finance_gl_accounts | 会计科目 | id, code, name, kind
finance_budgets | 部门预算 | id, department_id, fiscal_year, budget_cents
finance_expenses | 报销单 | id, employee_id, category, amount_cents, submitted_at, status
invoices_archive | 2024 年以前的发票归档,已不再更新 | id, customer_id, amount_cents, status, issued_at
customers_legacy | 旧 CRM 迁移过来的客户,编号规则不同 | id, name, company, email, migrated_at
subscriptions_history | 订阅的变更历史,每次改套餐或席位加一行 | id, subscription_id@subscriptions, plan, seats, changed_at
""".strip().splitlines()


def column_sql(col: str) -> str:
    name, _, ref = col.partition("@")
    if name == "id":
        return "id TEXT PRIMARY KEY"
    kind = "INTEGER" if name.endswith(("_cents", "_count", "_pct", "_min", "_mb", "_micro")) or name in {"seats", "score", "level", "enabled", "helpful", "attended", "minor_units"} else "TEXT"
    ref_sql = f" REFERENCES {ref}(id)" if ref else ""
    return f"{name} {kind}{ref_sql}"


def create_sql(name: str, desc: str, cols: list[str]) -> str:
    body = ",\n    ".join(column_sql(c) for c in cols)
    return f"CREATE TABLE {name} (  -- {desc}\n    {body}\n)"


def main() -> None:
    DST.unlink(missing_ok=True)
    shutil.copy(SRC, DST)
    conn = sqlite3.connect(DST)
    for line in TABLES:
        name, desc, cols = (p.strip() for p in line.split("|"))
        conn.execute(create_sql(name, desc, [c.strip() for c in cols.split(",")]))
    # 三张长得像核心表的,放一点数据,让选错了会得到「看着合理的另一个数」
    conn.execute("INSERT INTO finance_payments SELECT 'PAY-' || substr(id, 5), id, amount_cents, 'card', paid_at FROM invoices WHERE status = 'paid'")
    conn.executemany("INSERT INTO invoices_archive VALUES (?, ?, ?, ?, ?)", [
        ("OLD-2023-0001", "C001", 4900, "settled", "2023-02-01"),
        ("OLD-2023-0002", "C002", 9900, "settled", "2023-03-01"),
        ("OLD-2023-0003", "C007", 29900, "void", "2023-04-01"),
    ])
    conn.executemany("INSERT INTO customers_legacy VALUES (?, ?, ?, ?, ?)", [
        ("L-001", "王建国", "星河餐饮", "wang@legacy.example.com", "2024-11-01"),
        ("L-002", "周敏", "青木设计", "zhou@legacy.example.com", "2024-11-01"),
    ])
    conn.execute("INSERT INTO subscriptions_history SELECT 'H-' || substr(id, 2), id, plan, seats, started_at FROM subscriptions")
    conn.commit()
    tables = conn.execute("SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").fetchone()[0]
    conn.close()
    print(f"已生成 {DST.name}:{tables} 张表,{DST.stat().st_size // 1024} KB")


if __name__ == "__main__":
    main()
```

<div class="line-notes">

- `ROOT = Path(__file__).resolve().parents[2]` 和 Day 291 的 `bare_schema.py` 一样,从文件位置倒推出 `agent-zero-lab/`。
- `SRC = ROOT / "cloudledger" / "cloudledger.db"` 源是原来的小库,`DST` 是新库 `warehouse.db`,两个文件并排放。
- `TABLES = """` 一张表一行,用 `|` 隔开三段:表名、一句话说明、列。写成一块文本而不是 63 条 `CREATE TABLE`,是因为这些表只是陪跑的,真正有信息量的是它们的名字和说明。
- `product_workspaces | 客户的工作区 | id, customer_id@customers` `customer_id@customers` 是我自己约定的写法,意思是「这一列是外键,指向 customers」,下面的 `column_sql` 会把它翻成 `REFERENCES customers(id)`。
- `support_ticket_comments | 工单下的回复 | id, ticket_id@tickets` 这些带外键的表,等一下检索时会用来演示「补外键」。
- `finance_payments | 收款流水,每张已付发票对应一笔 | id, invoice_id@invoices` 和 `invoices` 长得像的陪跑表,下面会往里塞数据。
- `.strip().splitlines()` 去掉首尾空白,再按行拆成列表,一共 63 行,每行一张表。
- `def column_sql(col: str) -> str:` 把一个列写法翻成 SQL 里的一段。
- `name, _, ref = col.partition("@")` `partition` 在 `@` 处切开:`customer_id@customers` 得到 `("customer_id", "@", "customers")`,没有 `@` 的得到 `(列名, "", "")`,`ref` 是空字符串。
- `if name == "id":` `id` 一律当主键。
- `kind = "INTEGER" if name.endswith(` 按后缀猜类型:`amount_cents`、`visits_count` 是整数,别的一律文本。`endswith` 接受元组,有一个后缀对上就是真。
- `ref_sql = f" REFERENCES {ref}(id)" if ref else ""` 空字符串在 Python 里是假值,所以 `if ref` 就是「有外键」。
- `def create_sql(name: str, desc: str, cols: list[str]) -> str:` 拼一整条 `CREATE TABLE`。
- `return f"CREATE TABLE {name} (  -- {desc}\n    {body}\n)"` 一句话说明写成括号后面的 SQL 注释。SQLite 把建表语句**从 `CREATE` 开始**的原文存进 `sqlite_master`,所以注释要放在括号里面才会被存下来,放在 `CREATE` 前面会丢。Day 291 的 `schema_text()` 取出来给模型的就是这份原文。
- `DST.unlink(missing_ok=True)` 每次重新造,不存在也不报错。
- `shutil.copy(SRC, DST)` 复制整个库文件,等于 `cp`。
- `name, desc, cols = (p.strip() for p in line.split("|"))` 一行切成三段并各自去空白,直接解包给三个变量。
- `conn.execute(create_sql(name, desc, [c.strip() for c in cols.split(",")]))` 列也要按逗号再切一次。
- `INSERT INTO finance_payments SELECT 'PAY-' || substr(id, 5), id, amount_cents, 'card', paid_at FROM invoices WHERE status = 'paid'` `||` 是 SQLite 的字符串拼接。113 张已付发票,每张生成一笔收款流水,编号把 `INV-` 换成 `PAY-`。因为金额和已付发票一一对应,模型就算选了它,算出来的总数也一样,不会改变那 10 题的标准答案。
- `conn.executemany("INSERT INTO invoices_archive VALUES (?, ?, ?, ?, ?)", [` 三张老发票,编号 `OLD-` 开头,状态用的是另一套词 `settled`。选错这张表,问「还没付款的发票」会得到 0。
- `conn.execute("INSERT INTO subscriptions_history SELECT 'H-' || substr(id, 2), id, plan, seats, started_at FROM subscriptions")` 30 行,每个订阅一行历史。
- `print(f"已生成 {DST.name}:{tables} 张表,{DST.stat().st_size // 1024} KB")` `//` 是整除。

</div>

```bash
uv run python -m part05.text2sql.make_warehouse
```

```text
已生成 warehouse.db:68 张表,600 KB
```

68 张表:原来的 5 张加 63 张。数据量几乎没变(多的 600 KB 是空表的页),但说明书会大很多。让问数代码改读这个库不用改一行代码,`bare_schema.py` 的 `DB_PATH` 认环境变量 `CLOUDLEDGER_DB`(Day 291 的约定),在命令前面加上它就行:

```bash
CLOUDLEDGER_DB=cloudledger/warehouse.db uv run python -c "
from part05.text2sql.schema import schema_text
t = schema_text()
print(len(t), '字符', t.count('CREATE TABLE'), '张表')"
```

<div class="line-notes">

- `CLOUDLEDGER_DB=cloudledger/warehouse.db uv run python -c "` 前面这段只对这一条命令生效的环境变量,相当于 Node 里 `CLOUDLEDGER_DB=... node x.js`。`bare_schema.py` 在 import 时读它,所以必须写在命令前,不能在 Python 里事后再设。
- `t.count('CREATE TABLE')` 数一下说明书里有几张表的建表语句。

</div>

```text
12484 字符 68 张表
```

2577 字符变成 12484 字符,约 4.8 倍。这里每张核心表有注释和取值行,陪跑的表只有短短几行,真实的仓库每张表几十列加详细注释,一张表就是一两千字符,几百张表就是几十万字符。

### 全量说明书的代价

把 Day 294 的评测原样跑在这个库上,说明书是全量的 12484 字符,连跑三遍:

```bash
CLOUDLEDGER_DB=cloudledger/warehouse.db uv run python -m part05.text2sql.eval_sql 3
```

输出里 ✓ 的行太多,我只留下 ✗ 和汇总:

```text
== 第 1 遍
✗ [1 次] 年付客户里席位数最多的是哪家公司?有并列的话全部列出
    模型:SELECT c.name AS company, s.seats FROM subscriptions s JOIN customers c ON c.id = s.customer_id WHERE s.billing_cycle = 'yearly' AND s.seats = (SELECT MAX(seats) FROM subscriptions WHERE billing_cycle = 'yearly') ORDER BY c.name
    结果:[('杨娜', 12), ('杨霞', 12)]  标准:[('启明科技',), ('长风汽修二店',)]
执行准确率 9/10
== 第 2 遍
(同样的一题同样地错)
执行准确率 9/10
== 第 3 遍
(同样的一题同样地错)
执行准确率 9/10
每题通过次数: [3, 3, 3, 3, 3, 3, 3, 3, 0, 3]
账单: 90 次调用 | 输入 114940 / 输出 4809 tokens | 约 ¥0.0727
```

(第 2、3 遍的错题内容和第 1 遍完全一样,我写成了括号说明。)

对比 Day 294 同一份评测在小库上的三遍:输入 36602 tokens、¥0.0628、10/10 稳定。现在输入 114940 tokens,是 **3.1 倍**;分数 9/10,而且是**每遍都错同一题**,不是偶然波动。

看错在哪:问「哪家公司」,模型写了 `c.name AS company`,把客户联系人的姓名当成了公司名,真正的 `customers.company` 列没用。小库里它从来没犯过这个错。68 张表里有一大堆表都带 `name` 和 `company` 列(`sales_leads`、`marketing_leads`、`hr_candidates`……),「company」这个词在说明书里出现了几十次,模型把它和 `name` 混了。我没有办法证明这就是原因,但三遍一致地出这个错,而小库里 6 遍都不出,说明和表多有关。

这是「表多了」最典型的两种代价:**输入变长**(更贵、更慢),**注意力被稀释**(更容易选错、用错)。现代模型的上下文窗口很大,DeepSeek 官方价格页写 deepseek-flash 的上下文是 1M token(2026 年 10 月查到),68 张表的说明书远远塞得进去。但「塞得进」不等于「用得好」。

## 第 1 步:给每张表做名片,用 embedding 检索

<figure>
<svg viewBox="0 0 640 250" role="img" aria-label="表多了的三种办法:全量说明书每题带 68 张表;embedding 检索按问题取最相关的几张名片,漏掉业务词对应的表;让模型对着表目录和术语表挑表;最后都把挑中的表加上外键引用的表,拼成说明书交给写 SQL 的模型。另有语义层一条路,模型只点指标不写 SQL">
<rect x="0" y="0" width="640" height="250" fill="var(--paper-raised)"/>
<g font-family="var(--font-mono)" font-size="12">
<rect x="20" y="20" width="110" height="40" rx="4" fill="none" stroke="var(--ink-soft)"/><text x="75" y="45" fill="var(--ink)" text-anchor="middle">用户问题</text>
<rect x="190" y="14" width="170" height="30" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/><text x="275" y="34" fill="var(--ink)" text-anchor="middle">① 全量 68 张表</text>
<rect x="190" y="52" width="170" height="30" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/><text x="275" y="72" fill="var(--ink)" text-anchor="middle">② embedding 取前 k</text>
<rect x="190" y="90" width="170" height="30" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/><text x="275" y="110" fill="var(--ink)" text-anchor="middle">③ 模型看目录挑表</text>
<line x1="130" y1="40" x2="190" y2="29" stroke="var(--ink-soft)"/><line x1="130" y1="40" x2="190" y2="67" stroke="var(--ink-soft)"/><line x1="130" y1="40" x2="190" y2="105" stroke="var(--ink-soft)"/>
<line x1="360" y1="29" x2="420" y2="67" stroke="var(--ink-soft)"/><line x1="360" y1="67" x2="420" y2="67" stroke="var(--ink-soft)"/><line x1="360" y1="105" x2="420" y2="67" stroke="var(--ink-soft)"/>
<rect x="420" y="40" width="200" height="54" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/><text x="520" y="62" fill="var(--ink)" text-anchor="middle">补外键 + 术语表</text><text x="520" y="80" fill="var(--ink-faint)" text-anchor="middle" font-size="11">写 SQL 的模型(Day 294)</text>
<text x="20" y="150" fill="var(--ink-soft)">实测 10 题:① 9/10 · ② 7/10(漏 MRR、欠费、已付款最高) · ③ 10/10</text>
<line x1="20" y1="168" x2="620" y2="168" stroke="var(--rule)"/>
<rect x="190" y="182" width="170" height="30" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/><text x="275" y="202" fill="var(--ink)" text-anchor="middle">④ 模型点指标</text>
<rect x="420" y="182" width="200" height="30" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/><text x="520" y="202" fill="var(--ink)" text-anchor="middle">代码生成 SQL → run_sql</text>
<line x1="360" y1="197" x2="420" y2="197" stroke="var(--ink-soft)"/>
<text x="20" y="200" fill="var(--ink-soft)">语义层</text>
<text x="20" y="236" fill="var(--ink-faint)" font-size="11">①②③ 管「给模型看哪几张表」;④ 管「口径只定义一次」,模型根本不写 SQL</text>
</g>
</svg>
<figcaption>表多了的三种办法(上)和语义层(下)。蓝色是模型的活,琥珀色是代码的活。①②③ 最后都交给 Day 294 的循环,④ 绕过了写 SQL 这一步。</figcaption>
</figure>

常见的办法是**检索**:不把所有表都给模型,先根据问题挑出最相关的几张,只给这几张的说明书。这就是 Day 217 起学的 RAG,只不过检索的对象从「文档段落」换成了「表」。

难点是「拿什么去匹配」。完整的建表语句太长,里面的列名注释会把表的主题冲淡。我的做法是给每张表做一张**名片**:一行字,只有表名、一句话说明、列名。名片短,embedding 才抓得住「这张表是干什么的」。

先改一处旧代码:给 Day 291 的 `schema_text()` 加一个 `only` 参数,只输出指定的几张表:

```python
def schema_text(enums: bool = True, glossary: bool = True, only: set[str] | None = None) -> str:
    parts: list[str] = []
    with connect_ro() as conn:
        for name, sql in table_ddl(conn):
            if only is not None and name not in only:
                continue
            parts.append(sql + ";")
```

<div class="line-notes">

- `def schema_text(enums: bool = True, glossary: bool = True, only: set[str] | None = None) -> str:` 新加的 `only` 默认 `None`,表示全部表,所以 Day 291 到 Day 294 所有调用 `schema_text()` 的地方行为不变。
- `parts: list[str] = []` 这一行和下面的 `with`、`for` 都是原来就有的,只是为了让你看清新增的两行放在哪。
- `if only is not None and name not in only:` 传了 `only` 且这张表不在里面,就跳过。`is not None` 不写成 `if only` 是因为空集合也是假值,「传了个空集合」应该输出零张表而不是全部。
- `continue` 跳过这张表的建表语句,它的枚举值行(下面那行 `if enums` 才加)也跟着跳过,因为它们在同一个循环体里。
- `parts.append(sql + ";")` 原来的一行。

</div>

名片和索引放在 `schema_index.py` 里:

```python
# agent-zero-lab/part05/text2sql/schema_index.py
"""表多了怎么办:给每张表做一张「名片」,用 embedding 按问题检索出最相关的几张表。"""
import json
import re

import numpy as np

from common.embed import embed, embed_one
from part05.text2sql.bare_schema import DB_PATH, connect_ro
from part05.text2sql.schema import schema_text, table_ddl

CORE_DESC = {  # 五张核心表的一句话说明(别的表的说明写在建表语句的注释里)
    "customers": "客户,一个客户对应一家公司的联系人",
    "subscriptions": "订阅,每个客户当前订的套餐、计费周期、席位数和状态",
    "invoices": "发票,每张发票的金额、状态(已付或未付)、开票和付款日期",
    "tickets": "客服工单,客户提的问题和状态",
    "refund_requests": "退款申请,等待审批的退款",
}
INDEX_PATH = DB_PATH.with_suffix(".index.npz")


def card_of(name: str, ddl: str) -> str:
    """一张表的名片:表名 + 一句话说明 + 列名。名片短,embedding 才抓得住这张表是干什么的。"""
    m = re.search(r"--\s*([^\n]+)", ddl.split("\n", 1)[0])
    desc = m.group(1).strip() if m else CORE_DESC.get(name, "")
    cols = re.findall(r"^\s+(\w+)\s+(?:TEXT|INTEGER)", ddl, re.M)
    return f"{name}:{desc}。列:{', '.join(cols)}"


def build_index() -> tuple[list[str], list[str], np.ndarray]:
    with connect_ro() as conn:
        tables = table_ddl(conn)
    names = [n for n, _ in tables]
    cards = [card_of(n, sql) for n, sql in tables]
    if INDEX_PATH.exists():
        saved = np.load(INDEX_PATH, allow_pickle=False)
        if json.loads(str(saved["cards"])) == cards:
            return names, cards, saved["vectors"]
    vectors = embed(cards)
    np.savez(INDEX_PATH, vectors=vectors, cards=json.dumps(cards, ensure_ascii=False))
    return names, cards, vectors


NAMES, CARDS, VECTORS = build_index()


def referenced(name: str) -> set[str]:
    """这张表的外键指向哪些表。JOIN 要用到的键在那些表里,所以要一起带上。"""
    with connect_ro() as conn:
        ddl = next(sql for n, sql in table_ddl(conn) if n == name)
    return set(re.findall(r"REFERENCES\s+(\w+)\(", ddl))


def with_references(names: list[str]) -> list[str]:
    """把每张表外键指向的表也带上(只带一层)。"""
    chosen = list(names)
    for name in names:
        for ref in referenced(name):
            if ref not in chosen:
                chosen.append(ref)
    return chosen


def retrieve(question: str, k: int = 4, expand: bool = True) -> list[str]:
    scores = VECTORS @ embed_one(question)  # 向量已归一化,点积就是余弦相似度
    top = [NAMES[i] for i in np.argsort(-scores)[:k]]
    return with_references(top) if expand else top


def schema_for(question: str, k: int = 4) -> str:
    return schema_text(only=set(retrieve(question, k)))


if __name__ == "__main__":
    print(f"{len(NAMES)} 张表,向量形状 {VECTORS.shape},索引文件 {INDEX_PATH.name}")
    for name, card in list(zip(NAMES, CARDS))[:3]:
        print(card)
```

<div class="line-notes">

- `import json` 索引缓存文件里要存名片列表,用 JSON 序列化。
- `import re` 从建表语句里抠注释和列名用正则。
- `import numpy as np` 向量运算。没装的话先 `uv add numpy`。
- `from common.embed import embed, embed_one` [Day 217](/blog/agent-zero/day-217-embedding-1/) 的两个函数,`embed` 一批文本变一批归一化的向量,`embed_one` 一条。
- `from part05.text2sql.bare_schema import DB_PATH, connect_ro` 库路径和只读连接,还是 Day 291 的老朋友。
- `from part05.text2sql.schema import schema_text, table_ddl` 刚改过的 `schema_text`,以及 Day 291 取建表原文的 `table_ddl`。
- `CORE_DESC = {  # 五张核心表的一句话说明` 五张核心表的建表语句里没有「表级」说明(只有列注释),这里补一句。别的 63 张表的说明写在建表语句括号后面的注释里。
- `INDEX_PATH = DB_PATH.with_suffix(".index.npz")` 索引缓存放在库文件旁边:`warehouse.db` 变成 `warehouse.index.npz`。`with_suffix` 换掉扩展名。每个库一份缓存,互不干扰。
- `def card_of(name: str, ddl: str) -> str:` 一张表的名片。
- `m = re.search(r"--\s*([^\n]+)", ddl.split("\n", 1)[0])` 只看建表语句的第一行(`split("\n", 1)[0]` 取第一个换行之前),找 `--` 后面的文字。陪跑表的第一行是 `CREATE TABLE sales_leads (  -- 销售线索,来自市场活动的潜在客户`,抠出来就是那句说明。核心表第一行是 `CREATE TABLE invoices (`,没有注释,`m` 是 `None`。
- `desc = m.group(1).strip() if m else CORE_DESC.get(name, "")` 有注释就用注释,没有就去 `CORE_DESC` 里找,再没有就是空。
- `cols = re.findall(r"^\s+(\w+)\s+(?:TEXT|INTEGER)", ddl, re.M)` 找所有「行首空白 + 单词 + TEXT 或 INTEGER」的行,第一个单词就是列名。`re.M` 让 `^` 匹配每一行的开头。`(?:...)` 是不捕获的括号。
- `return f"{name}:{desc}。列:{', '.join(cols)}"` 实测 `customers:客户,一个客户对应一家公司的联系人。列:id, name, email, company, created_at`。
- `def build_index() -> tuple[list[str], list[str], np.ndarray]:` 返回三样:表名列表、名片列表、向量矩阵。
- `names = [n for n, _ in tables]` 列表推导式,从 `[(表名, 建表语句), ...]` 里取出所有表名。
- `if INDEX_PATH.exists():` 缓存文件在就试着读。
- `if json.loads(str(saved["cards"])) == cards:` 缓存里存了当时的名片原文,和现在的逐条对比。表加了、改了说明,名片就变了,缓存作废。不对比的话,改了表结构却还在用旧向量,是个很隐蔽的坑。
- `vectors = embed(cards)` 68 张名片一次性变向量,`EMB_BATCH` 是 10,所以分 7 批请求。实测这一步 2200 token。
- `np.savez(INDEX_PATH, vectors=vectors, cards=json.dumps(cards, ensure_ascii=False))` 向量和名片存进同一个 `.npz` 文件。
- `NAMES, CARDS, VECTORS = build_index()` 模块 import 时就建好,后面的脚本直接用这三个。
- `def referenced(name: str) -> set[str]:` 某张表的建表语句里 `REFERENCES xxx(...)` 指向了哪些表。
- `re.findall(r"REFERENCES\s+(\w+)\(", ddl)` 找出所有 `REFERENCES` 后面的表名。`invoices` 的结果是 `{'customers', 'subscriptions'}`。
- `def with_references(names: list[str]) -> list[str]:` 把每张表的外键指向的表也带上,只带一层。为什么要?检索挑出 `invoices`,SQL 想 JOIN `customers` 取公司名,可 `customers` 没被挑中,模型就拿不到它的列。外键是「这两张表一定会一起用」的现成线索。
- `chosen = list(names)` 先拷贝一份,保持原来的顺序。
- `if ref not in chosen:` 已经在里面的不重复加。
- `def retrieve(question: str, k: int = 4, expand: bool = True) -> list[str]:` 检索主函数。
- `scores = VECTORS @ embed_one(question)  # 向量已归一化` `@` 是矩阵乘法:`(68, 1024) @ (1024,)` 得到 68 个分数,每张表一个。向量都归一化过(长度是 1),点积就等于余弦相似度。
- `top = [NAMES[i] for i in np.argsort(-scores)[:k]]` `argsort(-scores)` 给出分数从高到低的下标,取前 `k` 个,再换成表名。
- `return with_references(top) if expand else top` `expand=False` 是为了单独看「补外键」之前的召回。
- `def schema_for(question: str, k: int = 4) -> str:` 检索 + 拼说明书的快捷函数,评测里用。
- `print(f"{len(NAMES)} 张表,向量形状 {VECTORS.shape},索引文件 {INDEX_PATH.name}")` 自检输出。

</div>

```bash
CLOUDLEDGER_DB=cloudledger/warehouse.db uv run python -m part05.text2sql.schema_index
```

```text
68 张表,向量形状 (68, 1024),索引文件 warehouse.index.npz
customers:客户,一个客户对应一家公司的联系人。列:id, name, email, company, created_at
customers_legacy:旧 CRM 迁移过来的客户,编号规则不同。列:id, name, company, email, migrated_at
finance_budgets:部门预算。列:id, department_id, fiscal_year, budget_cents
```

68 个 1024 维的向量。建索引一共用了 2200 个 token,以后每个问题只用 embed 它自己(「现在的 MRR 是多少元?」实测 11 个 token)。bge-m3 在硅基流动上的单价我没有核实到,但用别的平台 0.01 美元每百万 token 的价格估,这点用量连一厘钱都不到,不单算。

### 检索准不准:召回率

检索这一步本身准不准,不需要调写 SQL 的模型就能量:对每道评测题,取标准 SQL 里用到的表(用 sqlglot 找),看检索结果里是不是**全都有**。这叫**召回**:该找回来的找回来多少。

```python
# agent-zero-lab/part05/text2sql/retrieval_recall.py
"""检索这一步本身准不准:标准 SQL 要用到的表,检索结果里是不是都有。不调写 SQL 的模型。"""
import sqlglot
from sqlglot import exp

from part05.text2sql.eval_v1 import CASES
from part05.text2sql.schema_index import NAMES, retrieve


def tables_in(sql: str) -> set[str]:
    return {t.name for t in sqlglot.parse_one(sql, read="sqlite").find_all(exp.Table)}


def main() -> None:
    needs = [(q, tables_in(gold)) for q, gold in CASES]
    print(f"库里共 {len(NAMES)} 张表。每题标准 SQL 要用到的表:")
    for q, need in needs:
        print(f"  {sorted(need)}  ← {q}")
    print()
    print("k | 只取前 k | 补上外键引用的表 | 平均带几张表")
    for k in (1, 2, 3, 4, 5, 6):
        plain = sum(need <= set(retrieve(q, k, expand=False)) for q, need in needs)
        full = sum(need <= set(retrieve(q, k)) for q, need in needs)
        avg = sum(len(retrieve(q, k)) for q, _ in needs) / len(needs)
        print(f"{k} | {plain}/{len(needs)} | {full}/{len(needs)} | {avg:.1f}")
    print()
    print("k=3 时每题检索到的表(补外键之前):")
    for q, need in needs:
        got = retrieve(q, 3, expand=False)
        mark = "✓" if need <= set(got) else "✗ 漏了 " + str(sorted(need - set(got)))
        print(f"  {mark} {got} ← {q}")


if __name__ == "__main__":
    main()
```

<div class="line-notes">

- `import sqlglot` Day 292 的老朋友,这次不是检查而是读,从标准 SQL 里找表。
- `from sqlglot import exp` 节点类型,`exp.Table` 就是表。
- `from part05.text2sql.eval_v1 import CASES` 沿用评测题,不复制第二份。
- `from part05.text2sql.schema_index import NAMES, retrieve` 刚写好的检索。
- `def tables_in(sql: str) -> set[str]:` 一条 SQL 用到了哪些表。
- `return {t.name for t in sqlglot.parse_one(sql, read="sqlite").find_all(exp.Table)}` `find_all(exp.Table)` 找出所有表节点,`t.name` 是表名,集合推导式去重。对 `invoices a JOIN invoices b` 这种自连接,两个节点名字相同,只算一个。
- `needs = [(q, tables_in(gold)) for q, gold in CASES]` 每道题配上它**需要**的表集合。
- `print(f"  {sorted(need)}  ← {q}")` 先把每题需要的表打出来,你自己看看合不合理。
- `for k in (1, 2, 3, 4, 5, 6):` 试六个 k。
- `plain = sum(need <= set(retrieve(q, k, expand=False)) for q, need in needs)` `<=` 在集合上是「子集」:需要的表全部在检索结果里才算召回成功。`sum` 把一串 `True`/`False` 加起来。
- `full = sum(need <= set(retrieve(q, k)) for q, need in needs)` 同样的算,但检索结果已经补过外键。
- `avg = sum(len(retrieve(q, k)) for q, _ in needs) / len(needs)` 平均每题带几张表,是「补外键之后」的数量,说明书的长度和它成正比。
- `mark = "✓" if need <= set(got) else "✗ 漏了 " + str(sorted(need - set(got)))` `need - set(got)` 是集合差,需要却没找到的表。

</div>

```bash
CLOUDLEDGER_DB=cloudledger/warehouse.db uv run python -m part05.text2sql.retrieval_recall
```

```text
库里共 68 张表。每题标准 SQL 要用到的表:
  ['customers']  ← 一共有多少个客户?
  ['subscriptions']  ← 各套餐分别有多少个 active 状态的订阅?
  ['customers', 'subscriptions']  ← 欠费的客户是哪几家公司?
  ['invoices']  ← 2026 年 10 月开出的发票一共多少元?
  ['invoices']  ← 还没付款的发票有几张、合计多少元?
  ['customers', 'invoices']  ← 已付款金额最高的是哪家公司?
  ['subscriptions']  ← 现在的 MRR 是多少元?
  ['invoices']  ← 有没有同一个订阅在同一天开出两张金额相同的已付发票?列出客户编号
  ['customers', 'subscriptions']  ← 年付客户里席位数最多的是哪家公司?有并列的话全部列出
  ['tickets']  ← 最近 7 天新建的工单按主题各有几张?

k | 只取前 k | 补上外键引用的表 | 平均带几张表
1 | 3/10 | 5/10 | 1.6
2 | 5/10 | 7/10 | 3.0
3 | 7/10 | 7/10 | 3.9
4 | 7/10 | 7/10 | 4.9
5 | 7/10 | 7/10 | 6.0
6 | 7/10 | 7/10 | 7.1

k=3 时每题检索到的表(补外键之前):
  ✓ ['customers', 'support_agents', 'subscriptions'] ← 一共有多少个客户?
  ✓ ['subscriptions', 'subscriptions_history', 'sales_contracts'] ← 各套餐分别有多少个 active 状态的订阅?
  ✗ 漏了 ['customers', 'subscriptions'] ['finance_credit_notes', 'finance_refunds', 'invoices_archive'] ← 欠费的客户是哪几家公司?
  ✓ ['invoices_archive', 'invoices', 'finance_expenses'] ← 2026 年 10 月开出的发票一共多少元?
  ✓ ['invoices', 'invoices_archive', 'finance_payments'] ← 还没付款的发票有几张、合计多少元?
  ✗ 漏了 ['customers', 'invoices'] ['sales_contracts', 'sales_commissions', 'finance_credit_notes'] ← 已付款金额最高的是哪家公司?
  ✗ 漏了 ['subscriptions'] ['hr_payroll_runs', 'finance_exchange_rates', 'hr_payslips'] ← 现在的 MRR 是多少元?
  ✓ ['invoices_archive', 'invoices', 'subscriptions'] ← 有没有同一个订阅在同一天开出两张金额相同的已付发票?列出客户编号
  ✓ ['subscriptions', 'sales_quote_lines', 'customers'] ← 年付客户里席位数最多的是哪家公司?有并列的话全部列出
  ✓ ['support_escalations', 'support_ticket_tags', 'tickets'] ← 最近 7 天新建的工单按主题各有几张?
```

这张表有三个读法。

**读法一:k 不是越大越好,而且涨不上去。** 补外键之后,k 从 3 涨到 6 召回一直是 7/10,再大也不动,平均带的表却从 3.9 张涨到 7.1 张。涨 k 买不到更多召回,只是在白白加长说明书。

**读法二:补外键有用,但只补一层。** k=1 时召回从 3/10 涨到 5/10,k=2 时从 5/10 涨到 7/10,涨的是同样两题:「年付客户席位数最多」只检索到 `subscriptions`,外键带上了 `customers`;「最近 7 天的工单」只检索到 `support_escalations`(工单升级记录),它的外键带出了 `tickets`。陪跑表居然成了找到真表的跳板。但补外键只往下补一层:被补进来的表,它自己的外键不再继续补。k=3 以后补外键没有额外收益了,漏掉的三题是整组表都没被找到。

**读法三,也是最重要的一点:漏的三题为什么漏。** 看 k=3 的明细:

- 「现在的 MRR 是多少元?」检索到了 `hr_payroll_runs`、`finance_exchange_rates`、`hr_payslips`,和订阅表没有任何关系。MRR 是一个**业务词**,表名、列名、说明里都不会出现 MRR 三个字。embedding 靠语义相似找东西,「月经常性收入」这个概念,它把它拉向了「工资」「汇率」这些带「钱」味道的表。
- 「欠费的客户是哪几家公司?」检索到了 `finance_refunds`、`finance_credit_notes`、`invoices_archive`,全是「钱」相关的。「欠费」在我们的业务里是订阅状态 `past_due`,这是术语表里的口径,表名里没有。
- 「已付款金额最高的是哪家公司?」被「金额」「最高」拉去了 `sales_contracts`、`sales_commissions`。

也就是说:**问题里的业务词和表的名字、说明对不上,embedding 检索就找不到**。这正是 Day 291 讲的「模型不知道你们公司的口径」,在检索这一步又出现了一次。

补充一点:检索结果里反复出现 `invoices_archive`、`finance_payments` 这些陪跑表,正是我故意造的「长得像」的那几张。它们和 `invoices` 排在一起,即使召回对了,说明书里也带着干扰项。

## 第 2 步:让模型自己从目录里挑表

embedding 不懂业务口径,那就让**懂口径的**来挑:把所有表的名片(表名、说明、列名)做成一份目录,连同术语表一起交给模型,问它「回答这个问题要用哪几张表」。目录比完整说明书短得多(68 张名片共 5052 个字符,术语表 500 字上下),而且术语表里写着「欠费客户 = 订阅 past_due」「MRR 用订阅表」,模型能把业务词和表连起来。

```python
# agent-zero-lab/part05/text2sql/table_picker.py
"""让模型从「表目录」里挑表:目录只有表名、一句话说明和列名,加上术语表,几千个字符。"""
import json

from part05.text2sql.ask_data import llm
from part05.text2sql.schema import GLOSSARY, schema_text
from part05.text2sql.schema_index import CARDS, NAMES, with_references

PICK_PROMPT = """下面是公司数据仓库里所有表的目录(表名:说明。列:列名),以及业务术语。
根据用户的问题,挑出写 SQL 需要用到的表,最多 5 张。
只输出 JSON:{{"tables": ["表名", ...]}}

{catalog}

{glossary}"""
SYSTEM = PICK_PROMPT.format(catalog="\n".join(CARDS), glossary=GLOSSARY)  # 每个问题都一样,放在最前面才吃得到缓存


def pick_tables(question: str) -> list[str]:
    r = llm.chat(
        [{"role": "system", "content": SYSTEM}, {"role": "user", "content": question}],
        response_format={"type": "json_object"},
        temperature=0,
    )
    return [t for t in json.loads(r.content)["tables"] if t in NAMES]  # 模型编出来的表名直接丢掉


def schema_for_picked(question: str) -> str:
    return schema_text(only=set(with_references(pick_tables(question))))


if __name__ == "__main__":
    import sys

    q = sys.argv[1] if len(sys.argv) > 1 else "现在的 MRR 是多少元?"
    picked = pick_tables(q)
    print("挑中:", picked, "→ 补外键后:", with_references(picked))
    print("账单:", llm.ledger)
```

<div class="line-notes">

- `from part05.text2sql.ask_data import llm` 和 `ask()` 共用同一个 `LLMClient`,账本里会同时算进选表这一步,最后总花费一目了然。
- `from part05.text2sql.schema import GLOSSARY, schema_text` 术语表原文,选表时要给模型看。
- `from part05.text2sql.schema_index import CARDS, NAMES, with_references` 名片列表、表名集合、补外键函数,全是刚写好的。
- `PICK_PROMPT = """下面是公司数据仓库里所有表的目录(表名:说明。列:列名),以及业务术语。` 提示词的重点是让模型输出**表名的列表**,最多 5 张,限制数量是防止它偷懒把全部表都列上。
- `只输出 JSON:{{"tables": ["表名", ...]}}` 同样的 JSON mode 写法,双花括号是因为要 `.format`。
- `SYSTEM = PICK_PROMPT.format(catalog="\n".join(CARDS), glossary=GLOSSARY)  # 每个问题都一样` 目录和术语表放在 system 里,而且**模块加载时只拼一次**。每个问题都带着同一段开头,DeepSeek 的前缀缓存才命中。实测单独跑第一次选表输入 2064 tokens,¥0.0042;第二个问题起同样的开头命中缓存,选一次表只要 ¥0.0005。
- `def pick_tables(question: str) -> list[str]:` 挑表主函数。
- `[{"role": "system", "content": SYSTEM}, {"role": "user", "content": question}],` 用户消息里只有问题本身。
- `return [t for t in json.loads(r.content)["tables"] if t in NAMES]  # 模型编出来的表名直接丢掉` 模型可能编出一张不存在的表,不在 `NAMES` 里的统统丢掉,后面 `schema_text(only=...)` 才不会拿到没有的名字。
- `def schema_for_picked(question: str) -> str:` 选表 → 补外键 → 拼说明书。
- `return schema_text(only=set(with_references(pick_tables(question))))` 说明书里始终带着术语表(`glossary` 默认 `True`),它是口径的唯一来源,不能因为只给几张表就丢掉。
- `q = sys.argv[1] if len(sys.argv) > 1 else "现在的 MRR 是多少元?"` 命令行可以传问题。
- `print("挑中:", picked, "→ 补外键后:", with_references(picked))` 看一眼挑了什么、补外键后带几张。

</div>

```bash
CLOUDLEDGER_DB=cloudledger/warehouse.db uv run python -m part05.text2sql.table_picker
```

```text
挑中: ['subscriptions'] → 补外键后: ['subscriptions', 'customers']
账单: 1 次调用 | 输入 2064 / 输出 9 tokens | 约 ¥0.0042
```

MRR 那题,模型挑了 `subscriptions`,补外键后带上 `customers`。embedding 没找到的,它一次就找对了。

## 第 3 步:三种办法放在同一份评测上比

三种给说明书的办法:全量、embedding 取前 4 张(补外键)、让模型挑表。同样的 10 道题,同样的 `ask()`,比分数、比说明书长度、比 token 和花费:

```python
# agent-zero-lab/part05/text2sql/eval_retrieval.py
"""同一份评测,三种给说明书的办法:全量、embedding 检索、让模型挑表。比分数,比 token,比花费。"""
import sys
from collections.abc import Callable

from part05.text2sql.ask_data import ask, llm
from part05.text2sql.eval_sql import matches
from part05.text2sql.eval_v1 import CASES
from part05.text2sql.safe_db import run_sql
from part05.text2sql.schema import schema_text
from part05.text2sql.schema_index import schema_for
from part05.text2sql.table_picker import schema_for_picked

MODES: dict[str, Callable[[str], str]] = {
    "全量": lambda q: schema_text(),
    "embedding 取前 4 张": lambda q: schema_for(q, 4),
    "模型挑表": schema_for_picked,
}


def run_mode(name: str, make_schema: Callable[[str], str]) -> None:
    before = (llm.ledger.prompt_tokens, llm.ledger.cost, llm.ledger.calls)
    passed = 0
    sizes = []
    for q, gold_sql in CASES:
        _, gold = run_sql(gold_sql)
        schema = make_schema(q)
        sizes.append(len(schema))
        r = ask(q, verbose=False, schema=schema)
        ok = r["sql"] is not None and matches(r["rows"], gold)
        passed += ok
        if not ok:
            print(f"  ✗ {q}\n     模型:{r['sql']}\n     结果:{r['rows'][:3]}  标准:{gold[:3]}")
    tokens = llm.ledger.prompt_tokens - before[0]
    cost = llm.ledger.cost - before[1]
    calls = llm.ledger.calls - before[2]
    print(f"{name}:{passed}/{len(CASES)} | 说明书平均 {sum(sizes) // len(sizes)} 字符 | {calls} 次调用 | 输入 {tokens} tokens | ¥{cost:.4f}")


if __name__ == "__main__":
    wanted = sys.argv[1:] or list(MODES)
    for mode in wanted:
        run_mode(mode, MODES[mode])
```

<div class="line-notes">

- `from collections.abc import Callable` 「接收一个字符串、返回一个字符串的函数」的类型。
- `from part05.text2sql.eval_sql import matches` Day 294 的结果集比较,放宽版。
- `MODES: dict[str, Callable[[str], str]] = {` 一个字典,键是模式名,值是「给我问题、还你说明书」的函数。三种办法被统一成同一个形状,下面的循环才能一视同仁。
- `"全量": lambda q: schema_text(),` 不看问题,永远返回全部。
- `"embedding 取前 4 张": lambda q: schema_for(q, 4),` k 取 4。前面算过 k 从 3 到 6 召回不变,取 4 给点余量。
- `"模型挑表": schema_for_picked,` 直接放函数名,不用 lambda。
- `before = (llm.ledger.prompt_tokens, llm.ledger.cost, llm.ledger.calls)` 账本是累计的,先记下跑这个模式之前的数,跑完做减法,就得到这个模式自己的开销。
- `schema = make_schema(q)` 每题现做一份说明书。
- `sizes.append(len(schema))` 记下长度,最后算平均。
- `r = ask(q, verbose=False, schema=schema)` Day 294 为练习留的 `schema` 参数,现在派上用场。
- `print(f"  ✗ {q}` 错题并排打出模型 SQL、结果、标准答案,和 Day 294 一样。
- `print(f"{name}:{passed}/{len(CASES)} | 说明书平均` 一个模式一行汇总。
- `wanted = sys.argv[1:] or list(MODES)` 命令行传模式名就只跑那几个,不传全跑。

</div>

```bash
CLOUDLEDGER_DB=cloudledger/warehouse.db uv run python -m part05.text2sql.eval_retrieval
```

```text
  ✗ 年付客户里席位数最多的是哪家公司?有并列的话全部列出
     模型:SELECT c.name AS company, s.seats FROM subscriptions s JOIN customers c ON c.id = s.customer_id WHERE s.billing_cycle = 'yearly' AND s.seats = (SELECT MAX(seats) FROM subscriptions WHERE billing_cycle = 'yearly') ORDER BY c.name
     结果:[('杨娜', 12), ('杨霞', 12)]  标准:[('启明科技',), ('长风汽修二店',)]
全量:9/10 | 说明书平均 12484 字符 | 30 次调用 | 输入 38302 tokens | ¥0.0242
  ✗ 欠费的客户是哪几家公司?
     模型:SELECT DISTINCT c.name FROM customers c JOIN subscriptions s ON s.customer_id = c.id WHERE s.status = 'past_due'
     结果:[('陈平',), ('张艳',), ('赵伟',)]  标准:[('小满花店',), ('蓝鲸教育二店',), ('北辰贸易二店',)]
  ✗ 已付款金额最高的是哪家公司?
     模型:SELECT c.id AS customer_id, c.name AS customer_name, ROUND(SUM(i.amount_cents) / 100.0, 2) AS paid_amount_yuan FROM invoices i JOIN customers c ON c.id = i.customer_id WHERE i.status = 'paid' GROUP BY c.id, c.name ORDER BY SUM(i.amount_cents) DESC LIMIT 1
     结果:[('C028', '杨娜', 215280.0)]  标准:[('长风汽修二店',)]
  ✗ 现在的 MRR 是多少元?
     模型:SELECT ROUND(SUM(CASE LOWER(TRIM(plan)) WHEN 'basic' THEN 49 WHEN 'pro' THEN 99 WHEN 'professional' THEN 99 WHEN 'enterprise' THEN 299 ELSE 0 END * COALESCE(seats, 0)), 2) AS mrr_yuan FROM subscriptions WHERE LOWER(TRIM(status)) IN ('active', 'past_due')
     结果:[(0.0,)]  标准:[(20273.0,)]
embedding 取前 4 张:7/10 | 说明书平均 1758 字符 | 31 次调用 | 输入 10636 tokens | ¥0.0344
模型挑表:10/10 | 说明书平均 1405 字符 | 40 次调用 | 输入 29479 tokens | ¥0.0277
```

我又跑了第二遍,只看汇总行:

```text
全量:9/10 | 说明书平均 12484 字符 | 31 次调用 | 输入 41978 tokens | ¥0.0260
embedding 取前 4 张:7/10 | 说明书平均 1758 字符 | 31 次调用 | 输入 10686 tokens | ¥0.0246
模型挑表:10/10 | 说明书平均 1405 字符 | 40 次调用 | 输入 29512 tokens | ¥0.0255
```

两遍的分数完全一样,说明差别不是随机波动。逐个看。

**全量,9/10。** 12484 字符,每题都错同一个「company」。

**embedding 取前 4 张,7/10。** 错的三题正好是召回漏掉的那三题,而且错法很有代表性:

- 「欠费」那题,检索结果里是 `finance_credit_notes`、`finance_refunds`、`invoices_archive`、`finance_expenses`,加上被它们的外键带进来的 `invoices`,**没有 `customers` 和 `subscriptions`**。模型没看到这两张表的建表语句,凭空写了它们的 JOIN,条件 `status = 'past_due'` 是从术语表学来的,公司名却只能猜,猜成了 `c.name`(联系人姓名),而不是 `c.company`;
- 「已付款最高」那题,拿到了 `invoices` 却没有 `customers`,同样猜错成姓名;
- 「MRR」那题最有意思:检索结果是 `hr_payroll_runs`、`finance_exchange_rates`、`hr_payslips`、`sales_commissions`,没有 `subscriptions`。术语表每次都带,所以模型知道 MRR 要用订阅,硬写了 `FROM subscriptions`,可这张表的建表语句和取值行(`subscriptions.plan 实际取值:专业版, 企业版, 基础版`)它没看到,套餐名写成了 `'basic'`、`'pro'`、`'enterprise'`,结果 0.0。这又回到了 Day 291 里「只看列名就瞎猜值」的老毛病。**说明书的三层是绑在一起的:漏了表,它的取值行也漏了。**

**模型挑表,10/10。** 说明书平均 1405 字符,最短,而且分数最高。多出来的 10 次调用就是选表那 10 次。

再看钱:第一遍三种模式的花费是 ¥0.0242、¥0.0344、¥0.0277,第二遍是 ¥0.0260、¥0.0246、¥0.0255。**差不多。** embedding 检索输入 token 只有全量的四分之一(10636 对 38302),花费却没少,第一遍还更贵。原因是**前缀缓存**:全量模式每个问题开头那 12484 字符完全一样,后面 9 个问题都能命中缓存,按 0.04 元每百万 token 算,几乎免费;检索模式每个问题的说明书都不一样,开头变了,缓存就失效了,按没命中的 2 元每百万 token 算。

这是个反直觉的结论:**在有前缀缓存的模型上,说明书不大(十几 KB)的时候,把它写死在开头可能比按问题检索更便宜**。检索真正买到的不是便宜,是三样东西:说明书再大就塞不进去时的**可行性**,注意力被几十张无关的表稀释时的**准确率**(「模型挑表」那一行 10/10 比全量的 9/10 高),以及更短的响应时间。

### 外部链接:Schema Linking

学术界把「根据问题找出相关的表和列」这一步叫 **schema linking**。我们今天做的是表一级的,更细的做法会精确到列,甚至把「值」也链接进来(比如问题里的「企业版」链接到 `subscriptions.plan` 这一列的某个值)。想读论文的话,搜 RESDSQL、DIN-SQL 这几篇,下面「学习资料」里有链接。

## 第 4 步:语义层,让模型不写 SQL

前面两种办法解决的是「说明书太长」。还有一类问题检索解决不了:**口径不一致**。前几天看到,模型遇到「MRR」这种词,有口径就对、没口径就编;就算写了术语表,模型也可能这次对、下次又差几个百分点。

**语义层(semantic layer)** 的想法是釜底抽薪:指标的定义**只在一个地方、用代码写一次**,模型不再自己拼 SQL,只能从「菜单」里点:要哪个指标、按哪些维度拆、过滤什么。SQL 由程序按定义生成。生产里常见的工具有 dbt 的 Semantic Layer(底层是 MetricFlow)、Cube 等;下面是自己写的最小版本,100 行以内,把原理看清楚。

```python
# agent-zero-lab/part05/text2sql/semantic.py
"""最小的语义层:指标和维度只在这里定义一次,模型只能「点菜」,SQL 由代码生成。"""
import re
from dataclasses import dataclass, field

PRICE_CASE = "CASE s.plan WHEN '基础版' THEN 49 WHEN '专业版' THEN 99 WHEN '企业版' THEN 299 END"
FROM_SUBS = "subscriptions s JOIN customers c ON c.id = s.customer_id"
FROM_INV = "invoices i JOIN customers c ON c.id = i.customer_id"


@dataclass(frozen=True)
class Metric:
    label: str
    expr: str  # 聚合表达式,结果列叫 value
    source: str  # FROM 子句
    base_where: str  # 这个指标自带的口径,调用方改不了
    dims: dict[str, str] = field(default_factory=dict)  # 维度名 → 列表达式,只有这些能 group by 和过滤


SUBS_DIMS = {"plan": "s.plan", "billing_cycle": "s.billing_cycle", "company": "c.company"}
INV_DIMS = {"company": "c.company", "issued_month": "substr(i.issued_at, 1, 7)"}

METRICS: dict[str, Metric] = {
    "mrr": Metric("MRR 月经常性收入(元)", f"ROUND(SUM({PRICE_CASE} * s.seats), 2)", FROM_SUBS,
                  "s.status IN ('active', 'past_due')", SUBS_DIMS),
    "active_subscriptions": Metric("有效订阅数", "COUNT(*)", FROM_SUBS,
                                   "s.status IN ('active', 'past_due')", SUBS_DIMS),
    "open_invoice_amount": Metric("未付发票金额(元)", "ROUND(SUM(i.amount_cents) / 100.0, 2)", FROM_INV,
                                  "i.status = 'open'", INV_DIMS),
}
SAFE_VALUE = re.compile(r"^[\w一-鿿.\-]+$")


class UnknownMetric(Exception):
    pass


def compile_query(q: dict) -> str:
    """把 {"metric": ..., "group_by": [...], "filters": {...}} 变成 SQL。任何不在定义里的东西都拒绝。"""
    metric = METRICS.get(q.get("metric", ""))
    if metric is None:
        raise UnknownMetric(f"没有这个指标:{q.get('metric')!r},可选:{', '.join(METRICS)}")
    group_by: list[str] = q.get("group_by", [])
    filters: dict[str, str] = q.get("filters", {})
    for name in [*group_by, *filters]:
        if name not in metric.dims:
            raise UnknownMetric(f"指标 {q['metric']} 不能按「{name}」拆分或过滤,可用维度:{', '.join(metric.dims)}")
    wheres = [metric.base_where]
    for name, value in filters.items():
        if not SAFE_VALUE.match(str(value)):
            raise UnknownMetric(f"过滤值 {value!r} 含有不允许的字符")
        wheres.append(f"{metric.dims[name]} = '{value}'")
    dim_sql = [metric.dims[g] for g in group_by]
    select = ", ".join([*(f"{metric.dims[g]} AS {g}" for g in group_by), f"{metric.expr} AS value"])
    sql = f"SELECT {select} FROM {metric.source} WHERE {' AND '.join(wheres)}"
    if dim_sql:
        sql += f" GROUP BY {', '.join(dim_sql)} ORDER BY value DESC"
    return sql


def menu() -> str:
    """给模型看的菜单:有哪些指标、每个指标能按哪些维度拆。"""
    lines = []
    for key, m in METRICS.items():
        lines.append(f"- {key}:{m.label};可用维度:{', '.join(m.dims)}")
    return "\n".join(lines)


if __name__ == "__main__":
    for q in [
        {"metric": "mrr"},
        {"metric": "mrr", "group_by": ["plan"]},
        {"metric": "active_subscriptions", "filters": {"billing_cycle": "yearly"}},
        {"metric": "arpa"},
        {"metric": "mrr", "group_by": ["issued_month"]},
        {"metric": "mrr", "filters": {"plan": "x' OR '1'='1"}},
    ]:
        try:
            print(q, "→", compile_query(q))
        except UnknownMetric as e:
            print(q, "→ 拒绝:", e)
```

<div class="line-notes">

- `import re` 过滤值要用正则检查字符。
- `from dataclasses import dataclass, field` [Day 50](/blog/agent-zero/day-050-dataclass/) 的 dataclass:装数据的类,`field` 用来给可变默认值。
- `PRICE_CASE = "CASE s.plan WHEN '基础版' THEN 49` 套餐单价**只在这里写一次**。MRR、ARPA、欠费月费都用它。以后调价,改这一处。
- `FROM_SUBS = "subscriptions s JOIN customers c ON c.id = s.customer_id"` 订阅和客户怎么 JOIN 也只定义一次,模型不会再忘记关联条件。
- `@dataclass(frozen=True)` `frozen=True` 让实例创建后不能改,指标定义不该被运行时随手改动。
- `expr: str  # 聚合表达式,结果列叫 value` 每个指标的计算公式,统一把结果列命名为 `value`,后面的代码就不用管列名。
- `base_where: str  # 这个指标自带的口径,调用方改不了` 「有效订阅 = active 加 past_due」写在这里,模型的菜单里没有这个选项,它想改也改不了。
- `dims: dict[str, str] = field(default_factory=dict)` 维度名对应 SQL 里的列表达式。`field(default_factory=dict)` 是 dataclass 里给可变默认值的写法,直接写 `= {}` 会报错。
- `SUBS_DIMS = {"plan": "s.plan", "billing_cycle": "s.billing_cycle", "company": "c.company"}` 订阅类指标能按套餐、计费周期、公司拆。注意 `company` 对应的是 `c.company` 而不是 `c.name`,Day 295 开头那个混淆不会再出现。
- `INV_DIMS = {"company": "c.company", "issued_month": "substr(i.issued_at, 1, 7)"}` 发票类指标能按公司和开票月份拆。`substr(i.issued_at, 1, 7)` 取日期的前 7 位,`2026-10-08` 变成 `2026-10`。
- `"mrr": Metric("MRR 月经常性收入(元)"` 三个指标之一。f-string 把 `PRICE_CASE` 嵌进表达式。
- `SAFE_VALUE = re.compile(r"^[\w一-鿿.\-]+$")` 过滤值只允许字母数字下划线、汉字、点和横线。后面会拿一条注入测试它。
- `class UnknownMetric(Exception):` 所有「点的菜不对」都抛它,调用方接一种异常。
- `def compile_query(q: dict) -> str:` 语义层的核心:从结构化的「点菜单」生成 SQL。
- `metric = METRICS.get(q.get("metric", ""))` 找指标定义,找不到是 `None`。
- `raise UnknownMetric(f"没有这个指标:{q.get('metric')!r},可选:{', '.join(METRICS)}")` 报错里列出所有可选指标,模型看到能自己改。和 Day 282 的错误设计是同一个原则。
- `for name in [*group_by, *filters]:` 把拆分维度和过滤维度合到一起检查,`*filters` 展开字典的键。
- `if name not in metric.dims:` 白名单思路,和 Day 292 的授权回调一样:不在定义里的维度一律拒绝。
- `if not SAFE_VALUE.match(str(value)):` 过滤值拼进 SQL 之前先过滤字符。
- `wheres.append(f"{metric.dims[name]} = '{value}'")` 拼 SQL。因为列表达式来自白名单、值过了字符检查,这里的字符串拼接是安全的;但要注意 `run_sql` 之后还有三道闸,这里不是唯一防线。
- `select = ", ".join([*(f"{metric.dims[g]} AS {g}" for g in group_by), f"{metric.expr} AS value"])` 先放拆分列,最后放 `value`。
- `sql += f" GROUP BY {', '.join(dim_sql)} ORDER BY value DESC"` 有拆分维度才加 `GROUP BY`,并且按指标值从大到小排。
- `def menu() -> str:` 生成给模型看的菜单,一个指标一行,带可用维度。
- `{"metric": "mrr", "filters": {"plan": "x' OR '1'='1"}},` 自测里的最后一条是个注入,看它被谁拦。

</div>

先不接模型,自测一下编译器:

```bash
uv run python -m part05.text2sql.semantic
```

```text
{'metric': 'mrr'} → SELECT ROUND(SUM(CASE s.plan WHEN '基础版' THEN 49 WHEN '专业版' THEN 99 WHEN '企业版' THEN 299 END * s.seats), 2) AS value FROM subscriptions s JOIN customers c ON c.id = s.customer_id WHERE s.status IN ('active', 'past_due')
{'metric': 'mrr', 'group_by': ['plan']} → SELECT s.plan AS plan, ROUND(SUM(CASE s.plan WHEN '基础版' THEN 49 WHEN '专业版' THEN 99 WHEN '企业版' THEN 299 END * s.seats), 2) AS value FROM subscriptions s JOIN customers c ON c.id = s.customer_id WHERE s.status IN ('active', 'past_due') GROUP BY s.plan ORDER BY value DESC
{'metric': 'active_subscriptions', 'filters': {'billing_cycle': 'yearly'}} → SELECT COUNT(*) AS value FROM subscriptions s JOIN customers c ON c.id = s.customer_id WHERE s.status IN ('active', 'past_due') AND s.billing_cycle = 'yearly'
{'metric': 'arpa'} → 拒绝: 没有这个指标:'arpa',可选:mrr, active_subscriptions, open_invoice_amount
{'metric': 'mrr', 'group_by': ['issued_month']} → 拒绝: 指标 mrr 不能按「issued_month」拆分或过滤,可用维度:plan, billing_cycle, company
{'metric': 'mrr', 'filters': {'plan': "x' OR '1'='1"}} → 拒绝: 过滤值 "x' OR '1'='1" 含有不允许的字符
```

前三条生成的 SQL,MRR 那条和 Day 294 评测里的标准答案是同一套口径。后三条是该被拒的:没有的指标、不能用的维度、注入字符串。

再接上模型,让它「点菜」:

```python
# agent-zero-lab/part05/text2sql/ask_metric.py
"""走语义层的问数:模型不写 SQL,只从菜单里点指标、维度和过滤条件,SQL 由 semantic.compile_query 生成。"""
import json
import sys

from part05.text2sql.ask_data import llm
from part05.text2sql.safe_db import SQLRejected, run_sql
from part05.text2sql.semantic import UnknownMetric, compile_query, menu

PROMPT = """你是 CloudLedger 的数据助手。你不能写 SQL,只能从下面的指标菜单里点菜。
只输出 JSON,三种形式之一:
{{"metric": "指标名", "group_by": ["维度名"], "filters": {{"维度名": "值"}}}}
{{"unsupported": "菜单里没有这个指标或维度,一句话说明缺什么"}}
- group_by 和 filters 可以省略;值照问题里的原话写(套餐写「企业版」,计费周期写 monthly 或 yearly)
- 问题要的东西菜单里没有,就用 unsupported,不要硬凑

指标菜单:
{menu}"""


def ask_metric(question: str) -> str:
    r = llm.chat(
        [{"role": "system", "content": PROMPT.format(menu=menu())}, {"role": "user", "content": question}],
        response_format={"type": "json_object"},
        temperature=0,
    )
    plan = json.loads(r.content)
    if "unsupported" in plan:
        return f"指标库里没有:{plan['unsupported']}"
    try:
        sql = compile_query(plan)
        cols, rows = run_sql(sql)
    except (UnknownMetric, SQLRejected) as e:
        return f"点菜被拒绝:{e}"
    return f"{plan}\n  SQL:{sql}\n  结果:{cols} {rows[:5]}"


if __name__ == "__main__":
    for q in sys.argv[1:] or ["现在的 MRR 是多少元?"]:
        print(f"问:{q}\n  {ask_metric(q)}")
    print("账单:", llm.ledger)
```

<div class="line-notes">

- `from part05.text2sql.safe_db import SQLRejected, run_sql` 生成的 SQL 照样走 Day 292 的三道闸执行,语义层是**又加了一层**,不是替代。
- `from part05.text2sql.semantic import UnknownMetric, compile_query, menu` 编译器和菜单。
- `PROMPT = """你是 CloudLedger 的数据助手。你不能写 SQL,只能从下面的指标菜单里点菜。` 开头就把权限说清楚。
- `{{"unsupported": "菜单里没有这个指标或维度,一句话说明缺什么"}}` 给模型一条体面的退路。没有它,模型在菜单没有的东西上会硬凑一个最像的指标。
- `- 问题要的东西菜单里没有,就用 unsupported,不要硬凑` 再强调一遍。后面「欠费」那题会看到它不一定管用。
- `指标菜单:` 菜单放在提示词最后。
- `plan = json.loads(r.content)` 模型的输出是点菜单,不是 SQL。
- `if "unsupported" in plan:` 模型说做不了,直接把理由告诉用户,不执行任何东西。
- `sql = compile_query(plan)` 代码生成 SQL。
- `except (UnknownMetric, SQLRejected) as e:` 点错菜和执行失败都转成一句话。
- `return f"{plan}\n  SQL:{sql}\n  结果:{cols} {rows[:5]}"` 把点菜单、生成的 SQL、结果前 5 行一起打出来,方便你核对。
- `for q in sys.argv[1:] or` 命令行传多个问题就逐个问。

</div>

```bash
uv run python -m part05.text2sql.ask_metric "现在的 MRR 是多少元?" "各套餐的 MRR 分别是多少?" "企业版的 MRR 是多少?" "年付的有效订阅有几个?" "未付发票按公司看,金额最高的几家" "ARPA 是多少?" "每个月新增了多少工单?" "哪家公司欠费了,欠了多少钱?"
```

```text
问:现在的 MRR 是多少元?
  {'metric': 'mrr'}
  SQL:SELECT ROUND(SUM(CASE s.plan WHEN '基础版' THEN 49 WHEN '专业版' THEN 99 WHEN '企业版' THEN 299 END * s.seats), 2) AS value FROM subscriptions s JOIN customers c ON c.id = s.customer_id WHERE s.status IN ('active', 'past_due')
  结果:['value'] [(20273.0,)]
问:各套餐的 MRR 分别是多少?
  {'metric': 'mrr', 'group_by': ['plan']}
  SQL:SELECT s.plan AS plan, ROUND(SUM(CASE s.plan WHEN '基础版' THEN 49 WHEN '专业版' THEN 99 WHEN '企业版' THEN 299 END * s.seats), 2) AS value FROM subscriptions s JOIN customers c ON c.id = s.customer_id WHERE s.status IN ('active', 'past_due') GROUP BY s.plan ORDER BY value DESC
  结果:['plan', 'value'] [('企业版', 14950.0), ('专业版', 3069.0), ('基础版', 2254.0)]
问:企业版的 MRR 是多少?
  {'metric': 'mrr', 'filters': {'plan': '企业版'}}
  SQL:SELECT ROUND(SUM(CASE s.plan WHEN '基础版' THEN 49 WHEN '专业版' THEN 99 WHEN '企业版' THEN 299 END * s.seats), 2) AS value FROM subscriptions s JOIN customers c ON c.id = s.customer_id WHERE s.status IN ('active', 'past_due') AND s.plan = '企业版'
  结果:['value'] [(14950.0,)]
问:年付的有效订阅有几个?
  {'metric': 'active_subscriptions', 'filters': {'billing_cycle': 'yearly'}}
  SQL:SELECT COUNT(*) AS value FROM subscriptions s JOIN customers c ON c.id = s.customer_id WHERE s.status IN ('active', 'past_due') AND s.billing_cycle = 'yearly'
  结果:['value'] [(9,)]
问:未付发票按公司看,金额最高的几家
  {'metric': 'open_invoice_amount', 'group_by': ['company']}
  SQL:SELECT c.company AS company, ROUND(SUM(i.amount_cents) / 100.0, 2) AS value FROM invoices i JOIN customers c ON c.id = i.customer_id WHERE i.status = 'open' GROUP BY c.company ORDER BY value DESC
  结果:['company', 'value'] [('白塔印务二店', 9504.0), ('知行咨询', 4704.0), ('远山物流', 2392.0), ('禾丰农业二店', 2392.0), ('长风汽修', 1188.0)]
问:ARPA 是多少?
  指标库里没有:菜单里没有 ARPA 这个指标,无法计算。
问:每个月新增了多少工单?
  指标库里没有:菜单里没有工单相关的指标,无法统计每月新增工单数。
问:哪家公司欠费了,欠了多少钱?
  {'metric': 'open_invoice_amount', 'group_by': ['company']}
  SQL:SELECT c.company AS company, ROUND(SUM(i.amount_cents) / 100.0, 2) AS value FROM invoices i JOIN customers c ON c.id = i.customer_id WHERE i.status = 'open' GROUP BY c.company ORDER BY value DESC
  结果:['company', 'value'] [('白塔印务二店', 9504.0), ('知行咨询', 4704.0), ('远山物流', 2392.0), ('禾丰农业二店', 2392.0), ('长风汽修', 1188.0)]
账单: 8 次调用 | 输入 1828 / 输出 138 tokens | 约 ¥0.0048
```

分几类看:

**前四个、第五个**:点菜点对了,生成的 SQL 口径永远一致。MRR 20273、企业版 14950(和各套餐拆分里的数对得上)、年付有效订阅 9 个,和 Day 291 手算的答案相同。而且口径是**代码**定的:Day 291 里没有术语表时会得到 19089 或 21481 这类数,在这里不可能出现,因为模型根本接触不到 `CASE` 和单价。

**ARPA 和每月新增工单**:菜单里没有,模型老实说「没有」,没有硬凑一个数。这是语义层的核心特征:**宁可不答,不给错数**。ARPA 的数昨天能答对,今天却答不了,代价是你得补指标,练习 3 就是补它。

**最后一题是个陷阱**,它说明语义层不是万能的:问「哪家公司欠费了,欠了多少钱」,模型点了 `open_invoice_amount` 按公司拆。这是一个**合法的指标**,生成的 SQL 也没毛病,但它回答的是「哪些公司有未付发票」,而不是「订阅状态是欠费的公司欠了多少」。列表里排第一的白塔印务二店,根本不在欠费的三家里。SQL 写错的那一类问题被消灭了,**点错菜**的问题还在。语义层把「口径错」变成了「指标选错」,选对的责任回到了菜单设计和模型选择上。练习 4 会补一个「欠费订阅」指标。

语义层和直接写 SQL 各有取舍:

| | 直接写 SQL | 走语义层 |
| --- | --- | --- |
| 灵活性 | 什么都能查 | 只能查定义好的指标和维度 |
| 口径一致 | 靠提示词和术语表,每次可能漂 | 指标只有一个定义,天然一致 |
| 前期投入 | 小,给说明书就行 | 大,要有人先建模、定口径 |
| 出错的方式 | SQL 能跑但数不对 | 查不了就明说,或者点错指标 |
| 加一个新问题 | 不用动 | 要加指标,上线才能问 |
| 适合 | 探索性的、长尾的问题 | 收入、MRR、活跃用户这类要全公司对齐的核心指标 |

我的建议是**核心指标走语义层,长尾的探索性问题允许直接写 SQL,但要在回答里标明「这是临时口径」**。很多公司的问数项目做不成,原因不在模型,而在没人愿意花时间把口径定下来。

## 基准:BIRD 和 Spider 2.0

面试里问到 Text-to-SQL,基本都会问这两个基准。下面的数字是我 2026 年 10 月 23 日从两个官网上读到的。

**BIRD**([官网](https://bird-bench.github.io/))有 12,751 对问题和 SQL,分布在 95 个数据库里,总共 33.4 GB,涵盖 37 个以上的专业领域。它的特点是数据又脏又大,而且很多问题需要**外部知识**才能写对(比如某个字段的编码含义)。榜单按执行准确率(EX)排,测试集上榜首是 GrainSQL,82.95%(榜上列的日期是 2026 年 9 月 26 日);第二名 82.39%,第三名 82.28%,前五名都在 81% 到 83% 之间。人类数据工程师和数据库学生的成绩是 92.96%。另有一个「单模型」赛道,榜首是 Google 的 Gemini-SQL2,测试集 80.04%,但它用了很多候选加自洽投票,不是一次生成。榜单页面写的更新日期是 10 月 9 日,里面却有 10 月 14 日的条目,日期对不上,所以别把这个「最新」看得太精确。

**Spider 2.0**([官网](https://spider2-sql.github.io/))更接近企业真实场景:数据库放在 BigQuery、Snowflake 上,有的 schema 超过一千列,一个任务可能要写好几步查询、读项目文档。它分成几个榜:Lite(547 个任务,分布在 BigQuery 214、Snowflake 198、SQLite 135 个)榜首 76.23%(腾讯的 Tianqiong Data Agent 配 GLM 5.2);Snow(547 个任务,全在 Snowflake)榜首 96.70%;DBT(68 个任务)榜首 65.6%。论文刚发表时(ICLR 2025),用 o1-preview 的代码 Agent 只解出两成左右的任务,这一年多涨得很快。

这两组数字怎么用,有四点要想清楚:

- **榜上是完整的系统,不是裸模型**。几乎都带检索、多轮自修、多候选投票,和我们今天从头搭的东西是同一类,只是工程量大得多。不能说「Claude 在 BIRD 上 80%」,要说「某某系统在 BIRD 上 80%」。
- **榜单分数不能直接估计你自己的系统**。BIRD 的库是公开的,可能被模型训练见过;你们公司的库、你们的口径,榜上没人见过。今天的评测说明了这一点:同一个模型,换一个库、换几十张表,分数就变了。
- **榜首的分数越高,越要看是在哪个榜**。Spider 2.0-Snow 96.70% 和 Lite 76.23% 差了二十个百分点,是同一批 547 个任务换了不同的数据库和评测设置,不是系统差别。
- **人类才 92.96%**。这说明基准里有不少题本身就有歧义或标准答案有争议,和我们 Day 294 发现第 9 题有并列是同一回事。

两个基准共同说明一件事:**单条 SQL 写对已经不难,难的是读懂业务、读懂大 schema、处理脏数据**。这三样,今天的实验里每一样都撞到了。

## 零件 → 大代码对照表

| 今天的零件 | 落在哪个文件 | 它回答什么问题 |
| --- | --- | --- |
| 表很多的仓库 | `make_warehouse.py` | 实验环境:68 张表,3 张和核心表长得像 |
| `schema_text(only=...)` | `schema.py`(改动) | 只输出指定的几张表 |
| 名片 + 向量 + 检索 | `schema_index.py` | 按问题找最相关的表 |
| 召回率 | `retrieval_recall.py` | 检索这一步本身准不准 |
| 模型挑表 | `table_picker.py` | 懂业务口径的来选 |
| 三种办法同台比 | `eval_retrieval.py` | 分数、token、花费 |
| 语义层 | `semantic.py` | 口径只在一处用代码定义 |
| 点菜式问数 | `ask_metric.py` | 模型不写 SQL,只点指标 |

## 花了多少钱

deepseek-flash 的价格:查到的页面写缓存命中、未命中、输出分别是 0.04、2、8 元每百万 token(高峰时段 9:00–12:00 和 14:00–18:00,北京时间工作日),非高峰减半([DeepSeek 定价页](https://api-docs.deepseek.com/zh-cn/quick_start/pricing) 2026 年 10 月查到)。账本按高峰价计。

| 实跑 | 账本 |
| --- | --- |
| 全量说明书的评测,单独一遍 | ¥0.0309 |
| 全量说明书的评测,三遍(114940 输入 tokens) | ¥0.0727 |
| 选表单独一次 | ¥0.0042 |
| 三种办法同台,第一遍 | ¥0.0242 + ¥0.0344 + ¥0.0277 |
| 三种办法同台,第二遍 | ¥0.0260 + ¥0.0246 + ¥0.0255 |
| `ask_metric.py` 八个问题 | ¥0.0048 |
| 练习 3、4 的指标试问 | ¥0.0024 |
| 练习 5 的并集模式 | ¥0.0362 |
| 写文章前试跑的一次选表召回 | ¥0.0083 |
| 合计 | 约 ¥0.32 |

embedding:建 68 张名片的索引用了 2200 个 token(建了两次,我中途换过名片写法),每个问题 11 个 token,和模型调用比可以忽略。每天总花费在 ¥1 以内。

## 动手练习

**练习 1:名片里该写什么。** 名片现在是「表名 + 说明 + 列名」。拆开试:只有表名、表名加列名、表名加说明加列名,三种名片各算一遍召回(k 取 1、3、5、10),看每多写一样东西,召回涨多少。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part05/text2sql/ex295_card_ablation.py
"""练习 1:名片里写什么,对检索召回有多大影响。三种名片,同样的 10 道题,看前 k 张里有没有要用的表。"""
import re

import numpy as np

from common.embed import embed, embed_one
from part05.text2sql.eval_v1 import CASES
from part05.text2sql.retrieval_recall import tables_in
from part05.text2sql.schema_index import CARDS, NAMES


def variant(card: str, kind: str) -> str:
    name, _, rest = card.partition(":")
    desc, _, cols = rest.partition("。列:")
    return {"只有表名": name, "表名加列名": f"{name}:{cols}", "表名加说明加列名": card}[kind]


needs = [(q, tables_in(gold)) for q, gold in CASES]
questions = np.stack([embed_one(q) for q, _ in needs])
print("名片内容 | k=1 | k=3 | k=5 | k=10")
for kind in ("只有表名", "表名加列名", "表名加说明加列名"):
    vectors = embed([variant(c, kind) for c in CARDS])
    ranked = np.argsort(-(questions @ vectors.T), axis=1)
    row = []
    for k in (1, 3, 5, 10):
        hit = sum(need <= {NAMES[i] for i in ranked[n][:k]} for n, (_, need) in enumerate(needs))
        row.append(f"{hit}/10")
    print(f"{kind} | " + " | ".join(row))
```

<div class="line-notes">

- `def variant(card: str, kind: str) -> str:` 把现成的名片拆开,按种类重新拼。
- `name, _, rest = card.partition(":")` 名片是 `表名:说明。列:列名`,先在第一个冒号处切开。
- `desc, _, cols = rest.partition("。列:")` 再在 `。列:` 处切成说明和列名。
- `return {"只有表名": name, "表名加列名": f"{name}:{cols}", "表名加说明加列名": card}[kind]` 先造一个字典,再用 `[kind]` 取出需要的那个。字典的三个值都会被算出来,但都很便宜。
- `questions = np.stack([embed_one(q) for q, _ in needs])` 10 个问题的向量叠成 `(10, 1024)` 的矩阵,只 embed 一次,三种名片共用。
- `vectors = embed([variant(c, kind) for c in CARDS])` 每种名片重新 embed 68 条。
- `ranked = np.argsort(-(questions @ vectors.T), axis=1)` `(10, 1024) @ (1024, 68)` 得到 10×68 的分数矩阵,`axis=1` 在每一行里排序,`ranked[n]` 是第 n 个问题的表下标,从最相关到最不相关。
- `hit = sum(need <= {NAMES[i] for i in ranked[n][:k]} for n, (_, need) in enumerate(needs))` 前 k 个里要用的表全在才算召回。这里没补外键,看的是名片本身的区分力。

</div>

```bash
CLOUDLEDGER_DB=cloudledger/warehouse.db uv run python -m part05.text2sql.ex295_card_ablation
```

```text
名片内容 | k=1 | k=3 | k=5 | k=10
只有表名 | 4/10 | 5/10 | 6/10 | 8/10
表名加列名 | 4/10 | 6/10 | 6/10 | 9/10
表名加说明加列名 | 3/10 | 7/10 | 7/10 | 8/10
```

三个观察。一,每多写一样东西,k=3 的召回都涨一点,5、6、7 分,说明说明和列名确实有用。二,**哪一种都到不了 10/10**,k=10 也只有 8 到 9 道题:再多写也补不上「MRR」「欠费」这种业务词和表之间的鸿沟。三,k=1 时反而是只有表名最高(4/10),写了说明后降到 3/10,因为说明把一些表的向量拉得更「泛」,第一名没那么准。名片内容没有绝对的好坏,要用你自己的评测去量。

</details>

**练习 2:把术语也做成名片。** 召回漏的三题漏在业务词上。试着把术语表里的几条也做成「名片」(术语加它涉及的表),问题检索时,如果最像的术语够像,就把它涉及的表一并带上。看 10 题的召回,再用 5 个**没参与写术语**的新问题检验一遍。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part05/text2sql/ex295_term_cards.py
"""练习 2:把业务术语也做成「名片」,标上它涉及的表。问题里出现 MRR、欠费,就能顺着术语找到表。"""
import numpy as np

from common.embed import embed, embed_one
from part05.text2sql.eval_v1 import CASES
from part05.text2sql.retrieval_recall import tables_in
from part05.text2sql.schema_index import retrieve, with_references

TERMS = {  # 术语 → 它涉及的表。这张对照表是人写的,和术语表一样要维护
    "MRR 月经常性收入:有效订阅的单价乘席位数之和": ["subscriptions"],
    "有效订阅:状态是 active 或 past_due 的订阅;试用 trialing、已取消 canceled 不算": ["subscriptions"],
    "欠费客户:订阅状态是 past_due 的客户,要查客户的公司名": ["subscriptions", "customers"],
    "未付发票:状态是 open 的发票,已付是 paid": ["invoices"],
    "已付款金额、收入:已付发票的金额合计,按客户公司汇总": ["invoices", "customers"],
    "年付、月付、套餐、席位数:订阅的计费周期、套餐和席位": ["subscriptions"],
}
TERM_VECTORS = embed(list(TERMS))


def retrieve_with_terms(question: str, k: int = 3) -> list[str]:
    base = retrieve(question, k, expand=False)
    q = embed_one(question)
    best = int(np.argmax(TERM_VECTORS @ q))
    if float(TERM_VECTORS[best] @ q) > 0.5:  # 术语卡片够像才用
        base = list(dict.fromkeys([*base, *list(TERMS.values())[best]]))
    return with_references(base)


needs = [(question, tables_in(gold)) for question, gold in CASES]
hit = 0
for question, need in needs:
    got = retrieve_with_terms(question)
    ok = need <= set(got)
    hit += ok
    if not ok:
        print(f"✗ 漏了 {sorted(need - set(got))} ← {question}")
print(f"术语卡片加表名名片,k=3:召回 {hit}/{len(needs)}")

# 术语是照着评测题写的,这个 10/10 偏乐观。再拿 5 个没参与写术语的新问题测一次
FRESH = [
    ("上个月新增了几个客户?", {"customers"}),
    ("收入最高的三个客户是谁?", {"invoices", "customers"}),
    ("取消订阅的客户有几家?", {"subscriptions"}),
    ("ARPA 是多少元?", {"subscriptions"}),
    ("登录不了的工单有几张?", {"tickets"}),
]
plain = sum(need <= set(retrieve(q, 3)) for q, need in FRESH)
termed = sum(need <= set(retrieve_with_terms(q)) for q, need in FRESH)
print(f"新问题:只用表名片 {plain}/{len(FRESH)},加术语卡片 {termed}/{len(FRESH)}")
```

<div class="line-notes">

- `import numpy as np` 求最相似的术语用 `argmax`。
- `TERMS = {  # 术语 → 它涉及的表。这张对照表是人写的,和术语表一样要维护` 键是术语的一句话,值是表名列表。这是语义层的雏形:**人来写「某个业务词对应哪几张表」**。
- `"欠费客户:订阅状态是 past_due 的客户,要查客户的公司名": ["subscriptions", "customers"],` 直接对准了「欠费的客户是哪几家公司」那一题缺的两张表。
- `TERM_VECTORS = embed(list(TERMS))` 术语也 embed,6 条。
- `def retrieve_with_terms(question: str, k: int = 3) -> list[str]:` 先正常检索,再看术语。
- `base = retrieve(question, k, expand=False)` 不补外键的前 k 张,术语的表加进去之后再统一补。
- `best = int(np.argmax(TERM_VECTORS @ q))` 和问题最像的那条术语的下标。
- `if float(TERM_VECTORS[best] @ q) > 0.5:  # 术语卡片够像才用` 相似度门槛 0.5,不够像就不理它,免得随便一个问题都被硬塞进几张表。0.5 是我试出来的,没有理论依据,换一个模型要重新试。
- `base = list(dict.fromkeys([*base, *list(TERMS.values())[best]]))` 把术语对应的表追加进去并去重。`dict.fromkeys` 去重的同时保持顺序,是 Python 里常用的小技巧。
- `return with_references(base)` 最后补外键。
- `FRESH = [` 五个新问题,术语表和这些问题**没有关系**:新增客户、收入前三、取消订阅、ARPA、登录不了的工单。
- `plain = sum(need <= set(retrieve(q, 3)) for q, need in FRESH)` 只用表名片的召回。
- `termed = sum(need <= set(retrieve_with_terms(q)) for q, need in FRESH)` 加了术语卡片的召回。

</div>

```bash
CLOUDLEDGER_DB=cloudledger/warehouse.db uv run python -m part05.text2sql.ex295_term_cards
```

```text
术语卡片加表名名片,k=3:召回 10/10
新问题:只用表名片 3/5,加术语卡片 3/5
```

10 题的召回涨到了 10/10,看着很漂亮。但注意:这 6 条术语是我照着这 10 道评测题的口径写的,用同一批题来检验它,等于**拿答案做考卷**。真正的检验是后面那行:5 个没参与的新问题,加不加术语卡片都是 3/5,一点没涨。

这是做评测时最常见的自欺:你为评测集里的问题补了规则,评测集分数立刻涨上去,而它在新问题上没有任何改进。术语卡片要有价值,必须覆盖新问题会用到的业务词,也就是需要业务方长期维护那张「术语到表」的对照表,不是一次性补丁。

</details>

**练习 3:给语义层加 ARPA。** 在不改 `semantic.py` 的前提下(只在脚本里往 `METRICS` 里追加),加一个 `arpa` 指标:有效订阅的月收入除以有效客户数。再问「ARPA 是多少元」「各套餐的 ARPA」,答案应该和 Day 294 一致(779.73)。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part05/text2sql/ex295_metrics.py
"""练习 3、4:给语义层加两个指标,ARPA 和「欠费订阅的月费」,再让模型点菜。"""
from part05.text2sql.ask_data import llm
from part05.text2sql.ask_metric import ask_metric
from part05.text2sql.semantic import FROM_SUBS, METRICS, PRICE_CASE, SUBS_DIMS, Metric

METRICS["arpa"] = Metric(
    "ARPA 每个有效客户平均月收入(元)",
    f"ROUND(SUM({PRICE_CASE} * s.seats) * 1.0 / COUNT(DISTINCT s.customer_id), 2)",
    FROM_SUBS,
    "s.status IN ('active', 'past_due')",
    SUBS_DIMS,
)
METRICS["past_due_mrr"] = Metric(
    "欠费订阅的月费合计(元),即订阅状态是欠费的那些订阅每月应收多少",
    f"ROUND(SUM({PRICE_CASE} * s.seats), 2)",
    FROM_SUBS,
    "s.status = 'past_due'",
    SUBS_DIMS,
)

for q in ["ARPA 是多少元?", "各套餐的 ARPA 分别是多少?", "哪家公司欠费了,每月应收多少?", "欠费的订阅一共多少月费?", "每个套餐有多少个试用中的订阅?"]:
    print(f"问:{q}\n  {ask_metric(q)}")
print("账单:", llm.ledger)
```

<div class="line-notes">

- `from part05.text2sql.semantic import FROM_SUBS, METRICS, PRICE_CASE, SUBS_DIMS, Metric` 把 `semantic.py` 里的积木都导进来。能直接复用 `PRICE_CASE` 和 `FROM_SUBS`,是因为口径只定义了一次。
- `METRICS["arpa"] = Metric(` 往字典里追加一条。`METRICS` 是模块级的字典,别处 `menu()` 和 `compile_query()` 读的是同一个对象,所以追加之后它们立刻认识了新指标。
- `f"ROUND(SUM({PRICE_CASE} * s.seats) * 1.0 / COUNT(DISTINCT s.customer_id), 2)",` 公式:月收入合计除以不同客户数。`* 1.0` 保证是小数除法,和 Day 294 里那个除以 100 的坑无关,这里单价本来就是元。
- `"s.status IN ('active', 'past_due')",` 口径和 MRR 一样,有效订阅。
- `SUBS_DIMS,` 复用订阅类指标的维度,所以能按套餐拆。
- `METRICS["past_due_mrr"] = Metric(` 练习 4 的指标,同一个脚本里一起加。

</div>

```text
问:ARPA 是多少元?
  {'metric': 'arpa'}
  SQL:SELECT ROUND(SUM(CASE s.plan WHEN '基础版' THEN 49 WHEN '专业版' THEN 99 WHEN '企业版' THEN 299 END * s.seats) * 1.0 / COUNT(DISTINCT s.customer_id), 2) AS value FROM subscriptions s JOIN customers c ON c.id = s.customer_id WHERE s.status IN ('active', 'past_due')
  结果:['value'] [(779.73,)]
问:各套餐的 ARPA 分别是多少?
  {'metric': 'arpa', 'group_by': ['plan']}
  SQL:SELECT s.plan AS plan, ROUND(SUM(CASE s.plan WHEN '基础版' THEN 49 WHEN '专业版' THEN 99 WHEN '企业版' THEN 299 END * s.seats) * 1.0 / COUNT(DISTINCT s.customer_id), 2) AS value FROM subscriptions s JOIN customers c ON c.id = s.customer_id WHERE s.status IN ('active', 'past_due') GROUP BY s.plan ORDER BY value DESC
  结果:['plan', 'value'] [('企业版', 1868.75), ('专业版', 383.63), ('基础版', 225.4)]
```

(下面三个问题属于练习 4,在后面的输出里。)779.73,和 Day 294 里自检救回来的那个数一样,但这次没有走「写错、被自检打回、重写」的曲折路线,一次就对,而且以后永远是这个口径。

</details>

**练习 4:补一个「欠费」指标。** 「哪家公司欠费了」被答成了「哪些公司有未付发票」。加一个指标:订阅状态是欠费(`past_due`)的订阅每月应收多少。再问四个问题,看哪些被接住、哪些仍然答不了。

<details><summary>参考答案</summary>

指标已经在练习 3 的脚本里一并加了(`past_due_mrr`),接着看它输出的后三个问题:

```text
问:哪家公司欠费了,每月应收多少?
  {'metric': 'past_due_mrr', 'group_by': ['company']}
  SQL:SELECT c.company AS company, ROUND(SUM(CASE s.plan WHEN '基础版' THEN 49 WHEN '专业版' THEN 99 WHEN '企业版' THEN 299 END * s.seats), 2) AS value FROM subscriptions s JOIN customers c ON c.id = s.customer_id WHERE s.status = 'past_due' GROUP BY c.company ORDER BY value DESC
  结果:['company', 'value'] [('蓝鲸教育二店', 495.0), ('小满花店', 392.0), ('北辰贸易二店', 297.0)]
问:欠费的订阅一共多少月费?
  {'metric': 'past_due_mrr'}
  SQL:SELECT ROUND(SUM(CASE s.plan WHEN '基础版' THEN 49 WHEN '专业版' THEN 99 WHEN '企业版' THEN 299 END * s.seats), 2) AS value FROM subscriptions s JOIN customers c ON c.id = s.customer_id WHERE s.status = 'past_due'
  结果:['value'] [(1184.0,)]
问:每个套餐有多少个试用中的订阅?
  指标库里没有:菜单里没有「试用中的订阅」这个指标,只有有效订阅数(active_subscriptions),无法按试用状态统计。
账单: 5 次调用 | 输入 1481 / 输出 82 tokens | 约 ¥0.0024
```

四个问题的归宿:「欠费」那两题被新指标接住了,三家欠费公司按月费 495、392、297 排好,合计 1184。注意这回答的是「每月应收」,不是「欠了多少钱」:语义层逼你把含糊的词分成两个**明确的**指标,「欠了多少钱」(未付发票金额)和「欠费订阅每月多少」(订阅月费)是两回事,业务方得先商量好用户问「欠了多少钱」时该给哪一个。最后一题「试用中的订阅」菜单里没有,模型诚实拒绝。语义层的日常就是这样:用户问到了菜单上没有的,你补一个指标,以后就能答。

</details>

**练习 5(开放题):两种办法并起来。** embedding 的召回有盲区,模型挑表要多一次调用。取两者并集,再跑同一份评测,看分数、token 和花费。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part05/text2sql/ex295_union.py
"""练习 4:embedding 检索和「模型挑表」取并集,当第四种模式跑同一份评测。"""
from part05.text2sql.eval_retrieval import run_mode
from part05.text2sql.schema import schema_text
from part05.text2sql.schema_index import retrieve, with_references
from part05.text2sql.table_picker import pick_tables


def union_schema(question: str) -> str:
    names = list(dict.fromkeys([*pick_tables(question), *retrieve(question, 3, expand=False)]))
    return schema_text(only=set(with_references(names)))


run_mode("并集", union_schema)
```

<div class="line-notes">

- `from part05.text2sql.eval_retrieval import run_mode` 复用上面的评测函数,新模式只需要提供一个「问题 → 说明书」的函数。
- `names = list(dict.fromkeys([*pick_tables(question), *retrieve(question, 3, expand=False)]))` 模型挑的表在前、embedding 前 3 张在后,去重并保持顺序。
- `return schema_text(only=set(with_references(names)))` 并集再补外键。
- `run_mode("并集", union_schema)` 不用写循环,`run_mode` 已经封装好了。

</div>

```bash
CLOUDLEDGER_DB=cloudledger/warehouse.db uv run python -m part05.text2sql.ex295_union
```

```text
并集:10/10 | 说明书平均 1845 字符 | 40 次调用 | 输入 30757 tokens | ¥0.0362
```

分数还是 10/10,但说明书从 1405 字符涨到 1845 字符,花费 ¥0.0362 比单用模型挑表(¥0.0277、¥0.0255)贵,没有换来任何分数。在这 10 题上,embedding 的结果加进去只是添了干扰表。并集的价值在于**保险**:模型挑漏了的时候,embedding 可能兜底。要不要这个保险,得看你的评测集里有没有「模型挑漏了、embedding 找得回」的题;我这 10 题里一道都没有,所以保险白买了。

</details>

**验收标准**:`make_warehouse` 造出 68 张表,全量说明书 12484 字符;`retrieval_recall.py` 的召回表和正文一致(k=3 是 7/10);`eval_retrieval.py` 里模型挑表 10/10、embedding 7/10;`semantic.py` 自测六条里三条放行三条拒绝;你能讲出「召回漏了为什么说明书也跟着漏取值行」「为什么检索不一定更便宜」「语义层把什么问题消灭了、什么问题留下了」。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| schema 检索 | 问题来了先挑出相关的几张表,只把这几张表的说明书给模型;对表结构做 RAG |
| schema linking | 学术界对「把问题里的词链接到库里的表、列、值」这一步的叫法 |
| 名片(table card) | 给一张表写的一行摘要:表名、一句话说明、列名,用来做 embedding |
| 召回(recall) | 该找回来的东西找回来了多少;这里是「要用的表,检索结果里全不全」 |
| 外键扩展 | 检索到一张表后,把它外键指向的表一并带上,因为 JOIN 会用到 |
| 前缀缓存 | 模型服务对请求开头完全相同的部分按命中价计费;开头每次变就没有这个好处 |
| 语义层(semantic layer) | 把指标和维度的定义集中写在代码或配置里,下游只能引用,不能重新定义 |
| 指标(metric)、维度(dimension) | 指标是要算的数(MRR、订单数),维度是拆分的角度(套餐、月份、公司) |
| NL2SQL、NL2DSL | 模型直接写 SQL,和模型生成语义层的结构化查询(DSL)再由程序翻成 SQL |
| BIRD | 95 个数据库、12,751 对问题和 SQL 的 Text-to-SQL 基准,强调脏数据和外部知识 |
| Spider 2.0 | 面向企业数据库(BigQuery、Snowflake 等,常有上千列)的 Text-to-SQL 基准 |
| 过拟合评测集 | 为了让评测集分数好看专门补规则,在没见过的新问题上却没有改进 |

## 常见误区

**以为检索一定更便宜。** 实测三种办法的花费都在 ¥0.025 上下,embedding 检索把输入 token 压到四分之一,钱却没省,因为每个问题的说明书开头不同,前缀缓存失效了。检索买到的是可行性和准确率。

**以为 k 越大召回越高。** `retrieval_recall.py` 里 k 从 3 涨到 6,召回始终是 7/10,说明书却涨了一倍多。漏掉的是业务词和表名对不上的题,多取几张补不回来。

**用 embedding 匹配业务词。** 「MRR」「欠费」在表名和列名里根本不存在,embedding 把它们拉向「工资」「退款」这类带「钱」味的表。业务词要靠术语表、人写的对照表或懂口径的模型去对应。

**检索漏了表,说明书的三层也漏了。** MRR 那题没选中 `subscriptions`,它的枚举取值行跟着消失,模型又开始瞎猜套餐名,写了 `'basic'`、`'pro'`,结果 0.0。检索的单位要带上表的取值和注释一起走。

**为评测集补规则,分数涨了就收工。** 练习 2 里把术语写成名片,10 题召回涨到 10/10,5 个新问题却一点没涨。要看的是没参与调试的问题上的分数。

**以为语义层能保证答案对。** 它保证口径一致、不写出不存在的列,但管不了模型点错指标。「哪家公司欠费了」被点成了「未付发票金额」,SQL 没毛病,答案不是用户问的那个。

**直接拿榜单分数估计自己的系统。** BIRD 的榜首是 82.95%,但那是带检索、自修、多候选投票的完整系统,库是公开的;你自己的库、你自己的口径,榜上没有人见过。

**把表名片的缓存当永久有效。** 表结构变了、说明改了,旧向量就不对了。`build_index()` 里把缓存的名片原文和当前对比,不一致就重建,就是为了这个。

## 学习资料

### 文档与文章

- [BIRD-bench 官网](https://bird-bench.github.io/):榜单、数据集说明和论文入口。看榜单时注意区分 Dev 和 Test、单模型赛道和完整系统赛道。
- [Spider 2.0 官网](https://spider2-sql.github.io/):三个榜(Lite、Snow、DBT)各自测什么,数据库的规模。
- [Can LLM Already Serve as A Database Interface? A BIg Bench for Large-Scale Database Grounded Text-to-SQLs(BIRD 论文)](https://arxiv.org/abs/2305.03111):为什么脏数据和外部知识让 Text-to-SQL 变难。
- [Spider 2.0: Evaluating Language Models on Real-World Enterprise Text-to-SQL Workflows(论文)](https://arxiv.org/abs/2411.07763):企业场景下 Text-to-SQL 要面对什么。
- [RESDSQL: Decoupling Schema Linking and Skeleton Parsing for Text-to-SQL(论文)](https://arxiv.org/abs/2302.05965):把 schema linking 单独拎出来做的代表作之一,表和列一级的筛选。
- [DIN-SQL: Decomposed In-Context Learning of Text-to-SQL with Self-Correction(论文)](https://arxiv.org/abs/2304.11015):把 schema linking、生成、自修分成几步的早期工作,和今天的循环是同一个思路。
- [dbt · Semantic Layer 文档](https://docs.getdbt.com/docs/use-dbt-semantic-layer/dbt-sl):生产里的语义层长什么样,指标、维度、实体怎么定义。
- [Cube 文档](https://cube.dev/docs):另一个常见的语义层工具,可以对照今天的最小版本看它多做了什么(权限、缓存、预聚合)。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1VbbK6UEg7&autoplay=0&high_quality=1" title="DeepSeek Harness 企业问数实战:接数据库、建语义层、控数据权限" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>又菜又爱玩的糯糯 · DeepSeek Harness 企业问数实战:接数据库、建语义层、控数据权限 · 5 分钟。演示一个现成产品里语义层怎么生成、用户权限怎么影响问数结果,对照今天的 `semantic.py` 看生产版多了哪些东西。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1YsVDzLEwf&autoplay=0&high_quality=1" title="准确率提升90%以上的Text2SQL实践分享" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>但问智能 · 准确率提升90%以上的Text2SQL实践分享 · 45 分钟。讲表多了以后怎么检索、怎么提高准确率,是别人的一套完整方案,听思路不用抠细节。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/K_VPF9URZo4" title="Semantic Layers in the Age of AI are 100% Needed" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Alex The Analyst · Semantic Layers in the Age of AI are 100% Needed · 6 分钟,英文,开字幕。用业务视角讲为什么要有语义层,对应今天「口径只在一处定义」那一节。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/j2G4PWCq10k" title="Text to SQL at 95% Accuracy. Do You NEED a Semantic Layer??" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>superdatabrothers · Text to SQL at 95% Accuracy. Do You NEED a Semantic Layer?? · 1 小时,英文,开字幕。一场对话,讨论加不加语义层对准确率的影响,可以倍速看,重点对照今天表格里「直接写 SQL 对走语义层」的取舍。</figcaption>
</figure>

### 书籍

- Chip Huyen,《AI Engineering: Building Applications with Foundation Models》,O'Reilly,2025。讲 RAG 和 Agent 的那几章里有 Text-to-SQL 的章节,谈到了怎么给大 schema 选表、怎么评测。我没有核实有无中文版,这里只写英文原版。

### 开源项目与代码

- [vanna-ai/vanna](https://github.com/vanna-ai/vanna):开源 Text-to-SQL 框架,核心是把「历史上写对的 问题加 SQL」存成向量库,检索相似的当示例给模型。和今天按表检索是两条互补的路。
- [bird-bench/mini_dev](https://github.com/bird-bench/mini_dev):BIRD 官方的迷你开发集,500 道题,想在自己的系统上试一下基准的感觉,从这个开始比整个 BIRD 现实。
- [taoyds/spider](https://github.com/taoyds/spider):Spider 1.0 的数据和评测脚本,里面的 test-suite 评测思路(多份数据验证 SQL)值得读。

## 自测

1. 表从 5 张涨到 68 张,说明书长了 4.8 倍,输入 token 涨了 3.1 倍。涨到几百张表时,你会先担心什么?

<details><summary>答案</summary>

先担心准确率,其次才是钱。实测 68 张表时说明书只有一万多字符,远没到上下文上限(deepseek-flash 的窗口是 1M token),花费也因前缀缓存没涨多少,但分数已经从 10/10 掉到 9/10,而且是每遍都错同一题:表多了,「company」「name」这类词在说明书里重复出现几十次,模型开始混。上到几百张表,再加上几千列,注意力稀释会更明显,同时说明书才真的会逼近上下文上限、拖慢响应。所以要检索或者让模型先挑表。

</details>

2. 为什么 embedding 检索表只召回 7/10?漏的是哪三题,共同点是什么?

<details><summary>答案</summary>

漏的是「欠费的客户」「已付款金额最高的公司」「现在的 MRR」。共同点是问题里的**业务词**(欠费、MRR、金额最高)在表名、列名、说明里都不存在,embedding 只能按语义相似去找,就被拉去了「退款」「工资」「合同」这种带钱味道的表。涨 k 也补不回来,k 从 3 到 6 召回一直是 7/10。要靠术语表、人写的术语到表的对照,或者让懂口径的模型来选。

</details>

3. 为什么在有前缀缓存的模型上,按问题检索说明书不一定比全量更便宜?

<details><summary>答案</summary>

全量模式每个问题开头那段说明书完全一样,第一次之后都命中缓存,按很低的命中价计费(deepseek-flash 高峰价 0.04 元每百万 token,未命中是 2 元)。检索模式每个问题的说明书不同,开头一变缓存就失效,每次都按未命中价计费。实测输入 token 少了四分之三,花费几乎一样,第一遍还更贵。检索买到的是可行性、准确率和延迟,不是省钱。

</details>

4. 语义层把问数里的哪类错误消灭了,哪类还留着?

<details><summary>答案</summary>

消灭了「口径错」:指标的公式、有效订阅的定义、单价都只在代码里定义一次,模型根本接触不到 `CASE` 和单价,所以没有「这次差几个百分点」的漂移;也消灭了写出不存在的列、拼错关联条件这类 SQL 错误,因为 SQL 是程序生成的。留着的是「点错菜」:「哪家公司欠费了」被点成「未付发票金额」,SQL 完全合法,答案不是用户问的那个。另外它只能答菜单里有的,没有的会拒绝,要靠补指标慢慢覆盖。

</details>

5. 面试题:老板说「BIRD 榜首已经 82.95% 了,我们的问数系统能做到九成吗」,你怎么回答?

<details><summary>答案</summary>

不能直接比。第一,榜上是完整系统不是裸模型,用了检索、多轮自修、多候选投票,工程量很大。第二,BIRD 的库是公开的,可能被模型训练见过;我们的库、口径、业务词,榜上没人见过。我会拿今天的经验说明:同一个模型,库换成 68 张表分数就从 10/10 掉到 9/10,换成几百张表更不好说。第三,基准的标准答案本身有争议,人类也只有 92.96%,所以「九成」这个目标要先问清楚是哪份评测集、谁写的标准答案。我的做法是先建我们自己的评测集:几十到几百道业务方真问过的题,标准答案经过体检(并列、空结果、NULL),分成评测器错、口径没说清、模型真错三类看错题;核心指标走语义层保证口径,长尾问题走直接写 SQL 并标注临时口径;上线后持续把被纠正的问题加进评测集。用我们自己的分数而不是榜单分数来承诺。

</details>

6. `retrieval_recall.py` 里「补外键」为什么在 k=1 和 k=2 时有用,k≥3 以后就没有额外收益了?

<details><summary>答案</summary>

k 小的时候,检索只命中了「核心的那一张」(比如 `invoices`),它的外键指向的表(`customers`、`subscriptions`)正好是问题需要的另一半,补外键把它们带上了,召回从 3/10 涨到 5/10(k=1)、5/10 涨到 7/10(k=2)。k=3 时已经覆盖了能被外键带出来的那些,剩下漏掉的三题是整组表都没被找到,不是漏了某张表的伙伴,补外键没有可补的。

</details>

## 明天预告

Day 296 · Agent Skills(一):Skill 是什么,写一个退款 skill。问数这条线到今天告一段落:说明书、三道闸、循环、评测、表多了怎么办、语义层。接下来换一个话题:你前面写的提示词、术语表、工具说明,有没有可能不是每次都塞进上下文,而是需要时才加载?明天看 Anthropic 提出的 Agent Skills,用一个 `SKILL.md` 文件把「处理退款」这类可复用的工作流打包起来。
