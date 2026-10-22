---
title: 'Day 133 · 工具多了怎么办:Tool Search、延迟加载与工具检索'
description: '给云簿后台造 60 个工具,实测一次全挂上要 4539 个 prompt token,只挂一个搜索工具是 482。今天讲 Anthropic 和 OpenAI 原生的 Tool Search、Claude Code 的 MCP 延迟加载,再在 Day 9 的循环里自己实现一个:BM25 和 embedding 两种检索、30 条用例测选工具的召回率,最后看一次真实轨迹里检索漏掉工具时模型会怎么错。'
pubDate: 2026-10-22
regime: none
tags: ['tool-use', 'tool-search', 'context-engineering', 'cloudledger', 'agent-60']
series: 'agent-60'
day: 133
lang: 'zh'
---

## 今天要解决的问题

这是专题篇,可以跳着读。**建议在 [Day 11 · 好工具怎么设计](/blog/agent-60/day-11-tool-design/) 之后读**,最好也学过 Day 15(embedding)和 Day 18(BM25)。Day 11 末尾有一节「工具太多怎么办」,只列了几条思路,今天把其中的「工具搜索」从头做一遍。

真实系统的工具数量涨得很快。云簿的客服后台,客户、订阅、发票、退款、工单、帮助中心、账号安全、报表、通知、计费,每个领域五六个操作,加起来就是六十个。再接一个 GitHub MCP server、一个 Jira server,上百个不稀奇。工具一多,会同时出现两个问题:每次请求都要把所有工具定义发一遍,很贵;模型要在一长串相似的工具里挑一个,容易挑错。

学完今天,你要能做到:

1. 实测出「全部工具都挂上」和「按需加载」在 prompt token 上的差距,并说清楚差距从哪来。
2. 会用 Anthropic 的 Tool Search(`defer_loading`)和知道 OpenAI `tool_search` 的用法,知道 Claude Code 里 MCP 工具默认就是延迟加载的。
3. 在 Day 9 的 Agent 循环里自己实现工具检索:开局只挂一个 `search_tools`,搜到什么再挂什么。
4. 用一份离线测试集比较 BM25 和 embedding 两种检索的选工具召回率。
5. 知道工具检索特有的失败方式(检索漏掉 → 模型以为没这个能力)以及怎么防。

预计用时 3–4 小时。前置:Day 9(`Agent`、`ToolRegistry`)、Day 11、Day 15(`w3/embed.py`)、Day 18(jieba + `rank_bm25`)、Day 23(`cloudledger.db`)。代码放在 `agent-60-lab/topics/tool_search/`。

## 先量一下:60 个工具有多贵

先造工具。今天只关心「选不选得对」,所以 60 个工具里只有查客户、查订阅、查发票三个真的连 Day 23 的业务库,其余都是返回「演示桩」的空壳。

```python
# agent-60-lab/topics/tool_search/catalog.py
"""CloudLedger 后台的 60 个工具。只有查客户、查订阅、查发票三个接了真库,其余是桩,今天只关心「选不选得对」。"""
import json
import os
import sqlite3
from typing import Any

DB = os.environ.get("CLOUDLEDGER_DB", "w4/cloudledger/cloudledger.db")

# (工具名, 描述, {参数名: 参数说明})。命名统一「领域_动作」,方便按前缀分组
SPECS: list[tuple[str, str, dict[str, str]]] = [
    ("customer_find", "按邮箱、公司名或客户 ID 查找客户,返回客户 ID、姓名、公司。", {"query": "邮箱、公司名或 C 开头的客户 ID"}),
    ("customer_update_contact", "修改客户的联系人姓名、电话或邮箱。", {"customer_id": "客户 ID", "field": "要改的字段", "value": "新值"}),
    ("customer_merge", "把两个重复注册的客户账号合并成一个。", {"keep_id": "保留的客户 ID", "drop_id": "被合并的客户 ID"}),
    ("customer_tags", "给客户打标签或去掉标签,比如 VIP、流失风险。", {"customer_id": "客户 ID", "tag": "标签名"}),
    ("customer_notes", "读取或追加客服对这个客户的备注。", {"customer_id": "客户 ID"}),
    ("customer_delete_request", "登记客户的注销账号和删除个人数据申请。", {"customer_id": "客户 ID"}),
    ("subscription_get", "查询客户当前订阅:套餐、席位数、月付还是年付、状态、本期结束日。", {"customer_id": "客户 ID"}),
    ("subscription_change_plan", "升级或降级套餐,返回差价预估。", {"customer_id": "客户 ID", "new_plan": "基础版/专业版/企业版"}),
    ("subscription_change_seats", "增加或减少席位数量。", {"customer_id": "客户 ID", "seats": "新的席位数"}),
    ("subscription_cancel", "取消订阅,当期结束后不再续费。", {"customer_id": "客户 ID"}),
    ("subscription_pause", "暂停订阅最多 3 个月,暂停期间不扣费。", {"customer_id": "客户 ID", "months": "暂停几个月"}),
    ("subscription_toggle_autorenew", "打开或关闭自动续费。", {"customer_id": "客户 ID", "on": "true 打开 false 关闭"}),
    ("invoice_list", "列出客户最近的发票:发票号、金额、状态、开票日期。查重复扣款先用它。", {"customer_id": "客户 ID"}),
    ("invoice_get_pdf", "生成某张发票的 PDF 下载链接。", {"invoice_id": "发票号,如 INV-2026-0123"}),
    ("invoice_change_title", "修改发票抬头或税号,超过 90 天的发票不能改。", {"invoice_id": "发票号", "title": "新抬头"}),
    ("invoice_void", "作废(红冲)一张发票。", {"invoice_id": "发票号"}),
    ("invoice_resend", "把发票重新发送到客户邮箱。", {"invoice_id": "发票号"}),
    ("invoice_mark_paid", "线下转账到账后,手工把发票标为已付。", {"invoice_id": "发票号"}),
    ("refund_submit", "提交退款申请,需要主管审批,不会立即退钱。", {"invoice_id": "发票号", "amount_yuan": "退款金额(元)", "reason": "原因"}),
    ("refund_status", "查询退款申请的审批和到账进度。", {"refund_id": "退款申请编号"}),
    ("refund_cancel", "撤回一条还没审批的退款申请。", {"refund_id": "退款申请编号"}),
    ("refund_calc_annual", "计算年付中途取消能退多少钱。", {"customer_id": "客户 ID"}),
    ("refund_list_pending", "列出所有等待主管审批的退款申请。", {}),
    ("refund_approve", "主管审批通过一条退款申请。", {"refund_id": "退款申请编号"}),
    ("ticket_create", "新建一张客服工单。", {"customer_id": "客户 ID", "title": "标题", "body": "内容"}),
    ("ticket_get", "查看工单详情和往来记录。", {"ticket_id": "工单号"}),
    ("ticket_reply", "以客服身份回复工单。", {"ticket_id": "工单号", "text": "回复内容"}),
    ("ticket_assign", "把工单转给某个客服或某个组。", {"ticket_id": "工单号", "assignee": "客服或组名"}),
    ("ticket_close", "关闭工单并记录解决方式。", {"ticket_id": "工单号"}),
    ("ticket_search", "按关键词搜索历史工单,看以前有没有人遇到过同样的问题。", {"query": "关键词"}),
    ("kb_search", "搜索帮助中心文章,回答产品功能、计费规则、报错码等问题。", {"query": "问题或关键词"}),
    ("kb_get_article", "按文章 ID 读取帮助中心全文。", {"article_id": "kb- 开头的文章 ID"}),
    ("kb_suggest_edit", "给帮助中心文章提修改建议。", {"article_id": "文章 ID", "suggestion": "建议"}),
    ("kb_list_categories", "列出帮助中心的分类目录。", {}),
    ("kb_popular", "本周浏览最多的帮助文章。", {}),
    ("kb_feedback_stats", "某篇文章的有用/没用投票统计。", {"article_id": "文章 ID"}),
    ("account_reset_password", "给客户发重置密码邮件。", {"customer_id": "客户 ID"}),
    ("account_disable_2fa", "核实身份后关闭客户的两步验证。", {"customer_id": "客户 ID"}),
    ("account_login_history", "查看最近 30 天的登录记录:时间、IP、设备、是否失败。", {"customer_id": "客户 ID"}),
    ("account_unlock", "解锁因多次输错密码被锁定的账号。", {"customer_id": "客户 ID"}),
    ("account_list_members", "列出这个公司账号下的成员和角色。", {"customer_id": "客户 ID"}),
    ("account_transfer_owner", "把账号所有者转给另一个成员。", {"customer_id": "客户 ID", "new_owner_email": "新所有者邮箱"}),
    ("report_export_status", "查询报表导出任务的状态和失败原因,导出报错时用。", {"customer_id": "客户 ID"}),
    ("report_rerun_export", "重新执行一次失败的报表导出。", {"task_id": "导出任务 ID"}),
    ("report_revenue_monthly", "公司每月收入汇总(内部财务用)。", {"month": "YYYY-MM"}),
    ("report_churn", "统计某个月的流失客户数和流失率。", {"month": "YYYY-MM"}),
    ("report_seat_usage", "席位使用率:买了多少席位、实际有多少人在用。", {"customer_id": "客户 ID"}),
    ("report_import_errors", "查看银行流水导入失败的明细和错误码(如 E1042、E1043)。", {"customer_id": "客户 ID"}),
    ("notify_email", "给客户发一封邮件。", {"customer_id": "客户 ID", "subject": "主题", "body": "正文"}),
    ("notify_sms", "给客户发短信验证码或提醒。", {"customer_id": "客户 ID", "text": "短信内容"}),
    ("notify_slack_oncall", "在内部 Slack 值班频道报警。", {"text": "报警内容"}),
    ("notify_schedule", "预约一条将来某个时间发出的提醒。", {"customer_id": "客户 ID", "when": "时间", "text": "内容"}),
    ("notify_unsubscribe", "把客户从营销邮件列表里移除。", {"customer_id": "客户 ID"}),
    ("notify_history", "查询发给客户的历史通知。", {"customer_id": "客户 ID"}),
    ("billing_apply_coupon", "给客户的下一张发票套用优惠券。", {"customer_id": "客户 ID", "code": "优惠码"}),
    ("billing_credit_balance", "查询客户的账户余额和抵扣额度。", {"customer_id": "客户 ID"}),
    ("billing_update_payment_method", "生成更换绑定银行卡或支付宝的链接。", {"customer_id": "客户 ID"}),
    ("billing_retry_charge", "对扣款失败的发票重新发起扣款。", {"invoice_id": "发票号"}),
    ("billing_tax_rate", "查询某个地区适用的税率。", {"region": "省份或国家"}),
    ("billing_currency_convert", "按今天的汇率换算金额,多币种账本用。", {"amount": "金额", "from_ccy": "原币种", "to_ccy": "目标币种"}),
]


def _schema(name: str, desc: str, params: dict[str, str]) -> dict[str, Any]:
    return {
        "type": "function",
        "function": {
            "name": name,
            "description": desc,
            "parameters": {
                "type": "object",
                "properties": {k: {"type": "string", "description": v} for k, v in params.items()},
                "required": list(params),
            },
        },
    }


SCHEMAS = {name: _schema(name, desc, params) for name, desc, params in SPECS}


def _q(sql: str, *args: Any) -> list[dict]:
    conn = sqlite3.connect(f"file:{DB}?mode=ro", uri=True)
    conn.row_factory = sqlite3.Row
    return [dict(r) for r in conn.execute(sql, args)]


def call(name: str, arguments: str) -> str:
    args = json.loads(arguments or "{}")
    if name == "customer_find":
        q = args["query"]
        rows = _q("SELECT id, name, company, email FROM customers WHERE id = ? OR email = ? OR company LIKE ?", q, q, f"%{q}%")
    elif name == "subscription_get":
        rows = _q("SELECT plan, billing_cycle, seats, status, current_period_end FROM subscriptions WHERE customer_id = ?", args["customer_id"])
    elif name == "invoice_list":
        rows = _q("SELECT id, amount_cents, status, issued_at FROM invoices WHERE customer_id = ? ORDER BY issued_at DESC LIMIT 6", args["customer_id"])
    elif name in SCHEMAS:
        rows = [{"ok": True, "note": f"{name} 是演示桩,没有真的执行"}]
    else:
        rows = [{"error": f"没有工具 {name}"}]
    return json.dumps(rows, ensure_ascii=False)
```

<div class="line-notes">

- `DB = os.environ.get("CLOUDLEDGER_DB"` 和 Day 23 的 server 同一个约定,默认在 `agent-60-lab` 根目录下运行。
- `SPECS: list[tuple[str, str, dict[str, str]]] = [` 用数据描述工具,而不是像 Day 9 那样一个个写函数。60 个工具都写成函数太长,而且今天的重点是 schema 和检索。
- `("customer_find", "按邮箱、公司名或客户 ID 查找客户` 命名统一成「领域_动作」。Day 11 讲过命名空间的好处,今天它还多了一个作用:检索时英文名拆开后也能当关键词。
- `("invoice_list", "列出客户最近的发票:` 描述里专门写了「查重复扣款先用它」。这句话对检索很重要,后面会看到用户说「被扣了两次钱」时,embedding 能靠它找到这个工具。
- `("refund_submit", "提交退款申请,需要主管审批` 对应 Day 23 的 `create_refund_request`。记住这个描述的用词是「提交退款申请」,后面实测会出问题。
- `("report_import_errors", "查看银行流水导入失败的明细和错误码(如 E1042、E1043)。"` 把错误码写进描述。Day 18 讲过,错误码这种精确字符串是 BM25 的强项。
- `def _schema(name: str, desc: str, params: dict[str, str]) -> dict[str, Any]:` 把三元组转成 OpenAI 兼容的 function schema,结构和 Day 8 手写的一样。参数类型偷懒全写成 string。
- `"required": list(params),` 所有参数都必填。`list(dict)` 取的是 key 列表。
- `SCHEMAS = {name: _schema(name, desc, params) for name, desc, params in SPECS}` 按名字索引的字典。实测 `len(SCHEMAS)` 是 60,`json.dumps(list(SCHEMAS.values()), ensure_ascii=False)` 是 15571 个字符。
- `conn = sqlite3.connect(f"file:{DB}?mode=ro", uri=True)` 只读打开,演示用的工具不改库。
- `rows = _q("SELECT id, name, company, email FROM customers WHERE id = ? OR email = ? OR company LIKE ?"` 实测 `call("customer_find", '{"query":"user007@example.com"}')` 返回 `[{"id": "C007", "name": "刘静", "company": "半岛咖啡", "email": "user007@example.com"}]`。
- `rows = _q("SELECT id, amount_cents, status, issued_at FROM invoices WHERE customer_id = ? ORDER BY issued_at DESC LIMIT 6"` 实测 C007 返回 5 张,最前面两张是 `INV-2026-0026` 和 `INV-2026-0123`,都是 2026-10-08、239200 分、paid,这就是 Day 23 故意造的重复扣款。
- `rows = [{"ok": True, "note": f"{name} 是演示桩,没有真的执行"}]` 其余 57 个工具一律返回这句。模型调到它们时会在回答里如实说「这个接口是演示桩」,不会编数据。

</div>

然后用同一个问题、`max_tokens=1` 发三次请求,只看 `prompt_tokens`(DeepSeek `deepseek-flash`,2026-10-22 实测):

| 请求里挂了什么工具 | prompt_tokens |
| --- | --- |
| 不挂工具 | 81 |
| `search_tools` + `customer_find` 两个 | 482 |
| 全部 60 个 | 4539 |

60 个工具的定义约 4460 token,平均每个 74 token。我的描述已经写得很短了,真实的 MCP server 工具描述动辄几百字,GitHub 官方 server 的一个工具定义就可能上千 token。Anthropic 的 [Tool Search 文档](https://platform.claude.com/docs/en/agents-and-tools/tool-use/tool-search-tool)里举的例子是 GitHub、Slack、Sentry、Grafana、Splunk 五个 server 一起接,光工具定义就约 55k token。

而且这是**单次请求**的数字。Agent 每一步都要重发全部工具,做一个四步的任务,工具定义就被发了四遍。后面的实测里,同一个核实重复扣款的任务,全挂 60 个工具四步一共 19478 个 prompt token,按需加载是 4683。

<figure>
<svg viewBox="0 0 640 230" role="img" aria-label="条形图:单次请求全挂60个工具4539 token,按需482;四步任务全挂19478,按需4683">
  <rect x="0" y="0" width="640" height="230" fill="var(--paper-raised)"/>
  <text x="20" y="26" font-family="var(--font-mono)" font-size="13" fill="var(--ink)">prompt_tokens 实测(deepseek-flash,同一个问题)</text>
  <text x="20" y="62" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">单次 · 全挂 60</text>
  <rect x="150" y="50" width="105" height="18" fill="var(--compute)"/>
  <text x="262" y="64" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">4539</text>
  <text x="20" y="92" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">单次 · 按需</text>
  <rect x="150" y="80" width="11" height="18" fill="var(--mem)"/>
  <text x="168" y="94" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">482</text>
  <text x="20" y="142" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">四步 · 全挂 60</text>
  <rect x="150" y="130" width="450" height="18" fill="var(--compute)"/>
  <text x="560" y="124" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">19478</text>
  <text x="20" y="172" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">四步 · 按需</text>
  <rect x="150" y="160" width="108" height="18" fill="var(--mem)"/>
  <text x="265" y="174" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">4683</text>
  <text x="20" y="212" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">条长按 19478 = 450px 等比例画。按需加载的四步里,工具从 2 个涨到 8 个</text>
</svg>
<figcaption>工具定义每一步都要重发,步数越多差距越大。只算输入、按 lab 里 `LLM_PRICE` 配的 2 元/百万 token 未命中价粗算,四步任务全挂约 0.039 元、按需约 0.009 元,一天一万张工单就是三百元的差距(价格以 DeepSeek 定价页为准)。</figcaption>
</figure>

钱只是一半。另一半是选错率。Anthropic 的文档里说,工具超过 30–50 个之后 Claude 选工具的准确率会明显下降。2025 年 5 月的论文 [RAG-MCP](https://arxiv.org/abs/2505.03275) 做了一个更极端的实验:在大量 MCP 工具里选一个,全部塞给模型时选对率只有 13.62%,先检索再给模型时是 43.13%,prompt token 也少了一半以上。这个实验的设置比较极端,具体数字不用记,方向是清楚的:**工具越多,先帮模型缩小范围越值。**

## 先试便宜的办法

工具检索不是第一选择。在动手写检索之前,先问三个问题,这三个都是 Day 11 和 Day 13 讲过的:

- **能不能删和合并?** 「打开自动续费」和「关闭自动续费」合成一个带参数的 `subscription_toggle_autorenew`;内部财务用的 `report_revenue_monthly` 根本不该给客服 Agent。我的 60 个工具里,真认真审一遍能砍掉三分之一。
- **能不能按场景只挂子集?** 客服 Agent 和财务 Agent 是两个应用,各挂各的。
- **能不能先路由?** Day 13 的 routing 模式:先用一次便宜的分类调用判断工单属于哪个领域,再只挂这个领域的五六个工具。领域边界清楚时,这比检索更稳。

这三条都做了,工具还是有几十上百个,而且一个任务经常跨好几个领域(查客户、查发票、提交退款就跨了三个),那就该上工具检索了。

## 厂商原生的 Tool Search

### Anthropic:defer_loading

Anthropic 的做法是:你仍然在 `tools` 里发送**所有**工具的完整定义,但给不常用的工具加上 `defer_loading: true`,再加一个搜索工具。被延迟的工具不进上下文,模型需要时先调用搜索工具,API 在服务端执行搜索,把匹配的工具以 `tool_reference` 的形式展开成完整定义,模型下一步就能直接调用。下面的信息来自 2026 年 10 月的 [Claude 文档](https://platform.claude.com/docs/en/agents-and-tools/tool-use/tool-search-tool):

- 搜索工具有两种:`tool_search_tool_regex_20251119`(模型写 Python 正则,最长 200 字符,不区分大小写)和 `tool_search_tool_bm25_20251119`(模型写自然语言查询,最长 500 字符)。两种都会搜工具名、描述、参数名和参数描述。
- 每次搜索默认返回 5 个,模型可以在搜索参数里设 `limit`。每个请求最多 10000 个延迟工具。
- 至少要有一个工具不延迟,通常就是搜索工具本身;所有工具都延迟会返回 400。文档建议把最常用的 3–5 个工具保持不延迟。
- 被延迟的工具不在系统前缀里,发现后以 `tool_reference` 块追加在对话里,所以**前缀不变,prompt 缓存不受影响**。
- 搜索不单独计费,搜出来展开的工具定义按普通输入 token 算。
- 文档给的适用场景:10 个以上工具、工具定义超过 10k token、接了多个 MCP server。10 个以下工具、每次都全用到的,直接挂就行。

用法大致是这样(课程的 lab 里没装 `anthropic` SDK,这段只读不跑;模型名按文档里的支持列表选一个,写进环境变量):

```python
# agent-60-lab/topics/tool_search/anthropic_native.py  只读示例,需要 uv add anthropic 和 Claude 的 key
import os

import anthropic

from topics.tool_search.catalog import SCHEMAS

ALWAYS = {"customer_find", "invoice_list"}

tools = [{"type": "tool_search_tool_bm25_20251119", "name": "tool_search_tool_bm25"}]
for name, s in SCHEMAS.items():
    f = s["function"]
    tools.append({
        "name": name,
        "description": f["description"],
        "input_schema": f["parameters"],
        "defer_loading": name not in ALWAYS,
    })

client = anthropic.Anthropic()
resp = client.messages.create(
    model=os.environ["ANTHROPIC_MODEL"],
    max_tokens=1024,
    system="你是云簿 CloudLedger 的客服助手,先用工具核实事实再回答。",
    messages=[{"role": "user", "content": "C023 想把年付取消掉,能退多少?"}],
    tools=tools,
)
for block in resp.content:
    print(block.type, getattr(block, "name", ""), getattr(block, "input", ""))
```

<div class="line-notes">

- `ALWAYS = {"customer_find", "invoice_list"}` 不延迟的工具。文档建议留 3–5 个最常用的,这里留两个,几乎每张工单都要先查客户。
- `tools = [{"type": "tool_search_tool_bm25_20251119"` 搜索工具本身,注意它不能设 `defer_loading`。
- `"input_schema": f["parameters"],` Anthropic 的工具格式和 OpenAI 兼容格式差在字段名:`parameters` 在这里叫 `input_schema`,而且外面没有 `{"type": "function", "function": ...}` 那一层(Day 8 讲过两家格式的对照)。
- `"defer_loading": name not in ALWAYS,` 其余 58 个工具都延迟加载。它们的完整定义仍然随请求发出去,只是不进模型的上下文。
- `for block in resp.content:` 按文档,返回内容里会依次出现 `server_tool_use`(模型调用搜索工具)、`tool_search_tool_result`(里面是 `tool_reference` 列表)、`tool_use`(模型调用搜到的工具)。下一轮请求要把这些块原样放回历史,而且**不要**给 `srvtoolu_` 开头的那个搜索调用回 `tool_result`,否则 API 会拒绝。

</div>

### OpenAI:tool_search 和 namespace

OpenAI 在 Responses API 里也有一个 `tool_search` 工具,写法是在 `tools` 里加 `{"type": "tool_search"}`,给要延迟的函数加 `defer_loading: true`。和 Anthropic 不同的几点(2026 年 10 月查的 [OpenAI 文档](https://developers.openai.com/api/docs/guides/tools-tool-search)):

- 推荐把函数放进 `namespace`(一组相关函数),每个 namespace 建议少于 10 个函数;`defer_loading` 加在 namespace 里的函数上,不是加在 namespace 本身。文档说模型主要是在 namespace 和 MCP server 这两种形态上训练搜索的,用它们效果更好。
- 有两种执行方式:hosted(OpenAI 在服务端搜你声明过的工具)和 client(模型发出 `tool_search_call`,你的程序自己查,返回 `tool_search_output`)。工具集合在发请求时就确定的用 hosted;要根据租户、项目状态动态决定有哪些工具的用 client。
- 只有 `gpt-5.4` 及以后的模型支持。
- 文档明确写了:加载的工具集合变化后,从那一点往后缓存就失效了。

我们的 60 个工具按前缀天然就能分成 10 个 namespace,每个 6 个函数,正好符合建议。这也是为什么我一开始就坚持「领域_动作」的命名。

### Claude Code:MCP 工具默认就是延迟的

如果你在 Claude Code 里接了很多 MCP server,其实已经在用 Tool Search 了。按 2026 年 10 月的 [Claude Code 文档](https://code.claude.com/docs/en/mcp),Tool Search 默认开启:启动时只加载 MCP 工具的名字和 server instructions,工具定义在需要时通过 `ToolSearch` 工具加载。用环境变量 `ENABLE_TOOL_SEARCH` 控制:

| 值 | 行为 |
| --- | --- |
| 不设 / `true` | 所有 MCP 工具延迟加载(较老的模型除外) |
| `auto` | 工具定义总量低于上下文窗口 10% 时直接全部加载,超过才开启搜索 |
| `auto:N` | 同上,阈值改成 N% |
| `false` | 全部直接加载,不延迟 |

几个对写 MCP server 的人有用的细节:server instructions 变得更重要了,它相当于 skill 的 description,告诉模型什么时候该来搜你的工具;Claude Code 会截断过长的描述,直接加载的工具描述和 server instructions 上限 4096 字符,通过搜索加载的工具描述上限 16384 字符,而且**搜索匹配时只看前面那段较短的部分**,所以关键词要写在描述开头;某个工具必须常驻的话,可以在工具的 `_meta` 里设 `"anthropic/alwaysLoad": true`,用户也可以在 `.mcp.json` 里给整个 server 设 `"alwaysLoad": true`。

## 自己实现工具检索

DeepSeek、通义这些模型没有原生的 Tool Search,而且就算有,你也可能想用自己的检索(比如用公司内部的 embedding 服务,或者按租户权限过滤)。自己实现的思路和 Anthropic 的一样,只是全在客户端做:

<figure>
<svg viewBox="0 0 640 260" role="img" aria-label="自己实现的工具检索流程:开局只挂search_tools和customer_find;模型调search_tools,检索器从60个工具里找top-k追加到已加载列表;下一步请求带上新工具">
  <rect x="0" y="0" width="640" height="260" fill="var(--paper-raised)"/>
  <rect x="20" y="30" width="190" height="80" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
  <text x="115" y="56" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">第 1 步请求的 tools</text>
  <text x="115" y="78" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">search_tools</text>
  <text x="115" y="96" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">customer_find</text>
  <rect x="245" y="30" width="150" height="80" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
  <text x="320" y="56" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">模型</text>
  <text x="320" y="80" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">search_tools(</text>
  <text x="320" y="96" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">"查客户的发票")</text>
  <line x1="210" y1="70" x2="245" y2="70" stroke="var(--ink-soft)"/>
  <rect x="430" y="30" width="190" height="80" rx="6" fill="var(--compute-wash)" stroke="var(--compute)"/>
  <text x="525" y="56" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">检索器</text>
  <text x="525" y="78" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">60 个工具描述</text>
  <text x="525" y="96" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">BM25 或 embedding</text>
  <line x1="395" y1="70" x2="430" y2="70" stroke="var(--ink-soft)"/>
  <rect x="430" y="150" width="190" height="80" rx="6" fill="var(--compute-wash)" stroke="var(--compute)"/>
  <text x="525" y="176" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">loaded 列表</text>
  <text x="525" y="198" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">追加 top-k,不删除</text>
  <line x1="525" y1="110" x2="525" y2="150" stroke="var(--ink-soft)"/>
  <rect x="20" y="150" width="370" height="80" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
  <text x="205" y="176" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">第 2 步请求的 tools</text>
  <text x="205" y="198" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">search_tools, customer_find,</text>
  <text x="205" y="216" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">invoice_list, billing_credit_balance, ...</text>
  <line x1="430" y1="190" x2="390" y2="190" stroke="var(--ink-soft)"/>
</svg>
<figcaption>客户端版的工具检索:检索结果追加到已加载列表,下一步请求就带上新工具的完整定义。只追加不删除,让请求开头那段尽量保持不变。</figcaption>
</figure>

### 检索器:BM25 和 embedding 各一个

每个工具当成一篇「文档」,内容是工具名、描述和参数说明拼起来。BM25 复用 Day 18 的 jieba 分词思路,embedding 复用 Day 15 的 `w3/embed.py`:

```python
# agent-60-lab/topics/tool_search/searcher.py
"""工具检索:把每个工具的名字、描述、参数说明当成一篇「文档」,用 BM25 或 embedding 检索。"""
import logging
import re

import jieba
import numpy as np
from rank_bm25 import BM25Okapi

from topics.tool_search.catalog import SPECS

jieba.setLogLevel(logging.WARNING)
for w in ["年付", "月付", "红冲", "两步验证", "自动续费", "席位", "抬头", "优惠券", "重复扣款"]:
    jieba.add_word(w)
STOPWORDS = {"的", "了", "是", "吗", "呢", "我", "他", "她", "怎么", "一下", "帮", "能", "想", "要", "这个", "客户"}
WORD = re.compile(r"[\w一-鿿]+")


def tokenize(text: str) -> list[str]:
    text = text.replace("_", " ")  # invoice_void 拆成 invoice / void,英文名也能命中
    return [t.lower() for t in jieba.lcut(text) if WORD.fullmatch(t) and t not in STOPWORDS]


def tool_doc(name: str, desc: str, params: dict[str, str]) -> str:
    return f"{name} {desc} " + " ".join(f"{k} {v}" for k, v in params.items())


DOCS = [tool_doc(*s) for s in SPECS]
NAMES = [s[0] for s in SPECS]
_bm25 = BM25Okapi([tokenize(d) for d in DOCS])


def search_bm25(query: str, k: int = 5) -> list[str]:
    scores = _bm25.get_scores(tokenize(query))
    return [NAMES[i] for i in np.argsort(-scores)[:k]]


_vecs: np.ndarray | None = None


def search_embed(query: str, k: int = 5) -> list[str]:
    from w3.embed import embed, embed_one  # 用到时才导入,不用 embedding 的人不需要配 EMB_*

    global _vecs
    if _vecs is None:
        _vecs = embed(DOCS)  # 60 个工具,一次性向量化后缓存
    sims = _vecs @ embed_one(query)
    return [NAMES[i] for i in np.argsort(-sims)[:k]]
```

<div class="line-notes">

- `for w in ["年付", "月付", "红冲", "两步验证"` 业务词典,和 Day 18 同一个做法。后面会看到「两步验证」加了还是有问题。
- `STOPWORDS = {"的", "了", "是"` 停用词里专门加了「客户」:60 个工具里有一大半的参数说明都是「客户 ID」,这个词区分不了任何工具,留着反而会让每个带客户 ID 参数的工具都得一点分。
- `text = text.replace("_", " ")` 实测 `account_disable_2fa` 的文档切词后是 `['account', 'disable', '2fa', '核实', '身份', '后', '关闭', '两步验证', 'customer', 'id', 'id']`,英文名被拆成了三个词。
- `return [t.lower() for t in jieba.lcut(text)` 实测 `tokenize("导入银行流水提示 E1043")` 得到 `['导入', '银行', '流水', '提示', 'e1043']`,和 Day 18 的结果一致。
- `def tool_doc(name: str, desc: str, params: dict[str, str]) -> str:` 名字、描述、参数说明拼成一段。Anthropic 的原生搜索也是搜这四样。
- `DOCS = [tool_doc(*s) for s in SPECS]` `*s` 把三元组拆成三个位置参数,相当于 `tool_doc(s[0], s[1], s[2])`。
- `_bm25 = BM25Okapi([tokenize(d) for d in DOCS])` 模块导入时就建好索引,60 篇文档一瞬间。
- `return [NAMES[i] for i in np.argsort(-scores)[:k]]` `argsort` 是从小到大排的下标,取负号就变成从大到小。实测 `search_bm25("导入银行流水提示 E1043", 3)` 返回 `['report_import_errors', 'customer_find', 'customer_merge']`,第一个对了,后两个其实是 0 分随便排的。
- `from w3.embed import embed, embed_one` 放在函数里导入。`w3/embed.py` 一导入就要读 `EMB_BASE_URL`,只跑 BM25 的人没配这个变量也不会报错。
- `_vecs = embed(DOCS)` 60 段文本按 `EMB_BATCH=10` 分 6 批发给硅基流动的 bge-m3,只在第一次搜索时做一次。工具集合变了要重新算,生产里应该缓存到文件或者向量库。
- `sims = _vecs @ embed_one(query)` 向量都归一化过,矩阵乘一个向量就是 60 个余弦相似度(Day 15)。实测 `search_embed("user007 说 10 月被扣了两次钱", 3)` 返回 `['invoice_list', 'refund_calc_annual', 'billing_retry_charge']`。

</div>

### 离线测召回率

检索好不好,别靠跑 Agent 看感觉。写 30 条客服的真实说法,每条标上「应该用到的那个工具」,看检索的 top-k 里有没有它。这一步完全不调大模型,BM25 版本一分钱不花:

```python
# agent-60-lab/topics/tool_search/eval_select.py
"""选工具的评测:30 个客服真实说法,各自应该用到的工具,看检索 top-k 有没有把它捞回来。"""
import sys

from topics.tool_search.searcher import search_bm25, search_embed

CASES = [
    ("user007 说 10 月被扣了两次钱", "invoice_list"),
    ("我们想从专业版升到企业版", "subscription_change_plan"),
    ("公司又来了三个同事,要加人", "subscription_change_seats"),
    ("下个月起不用了,帮我停掉", "subscription_cancel"),
    ("年付用了两个月想退,能退多少", "refund_calc_annual"),
    ("我上周申请的退款到哪一步了", "refund_status"),
    ("发票上公司名字写错了", "invoice_change_title"),
    ("把 9 月那张发票再发我一次", "invoice_resend"),
    ("要一份发票的 PDF 报销用", "invoice_get_pdf"),
    ("对公转账已经打过去了,系统还显示没付", "invoice_mark_paid"),
    ("登录不上去,密码忘了", "account_reset_password"),
    ("手机换了,收不到两步验证码", "account_disable_2fa"),
    ("账号被锁了,说输错太多次", "account_unlock"),
    ("怀疑有人盗号,看看最近谁登录过", "account_login_history"),
    ("原来的管理员离职了,要换负责人", "account_transfer_owner"),
    ("导出报表一直失败", "report_export_status"),
    ("导入银行流水提示 E1043", "report_import_errors"),
    ("我们买了 20 个席位,好像没几个人在用", "report_seat_usage"),
    ("别再给我发促销邮件了", "notify_unsubscribe"),
    ("信用卡过期了要换一张", "billing_update_payment_method"),
    ("这个月扣款失败了,能再扣一次吗", "billing_retry_charge"),
    ("有个优惠码 SAVE20 怎么用", "billing_apply_coupon"),
    ("账户里还有多少余额可以抵扣", "billing_credit_balance"),
    ("我注册了两个号,能合成一个吗", "customer_merge"),
    ("帮我把联系电话改成新号码", "customer_update_contact"),
    ("我要注销账号,把我的数据删掉", "customer_delete_request"),
    ("多币种账本里美元怎么换算成人民币", "billing_currency_convert"),
    ("以前有没有人问过同样的导入问题", "ticket_search"),
    ("暂停三个月,淡季不用", "subscription_pause"),
    ("不想自动续费", "subscription_toggle_autorenew"),
]


def recall(search, k: int) -> tuple[float, list[str]]:
    misses = []
    for q, want in CASES:
        if want not in search(q, k):
            misses.append(q)
    return 1 - len(misses) / len(CASES), misses


if __name__ == "__main__":
    methods = {"bm25": search_bm25}
    if "--embed" in sys.argv:
        methods["embed"] = search_embed
    for name, fn in methods.items():
        for k in (1, 3, 5):
            r, misses = recall(fn, k)
            print(f"{name:6} recall@{k} = {r:.2f}  漏掉 {len(misses)} 条")
        print("  top-5 仍漏掉的:", misses)
```

<div class="line-notes">

- `CASES = [` 每条是「用户原话 → 期望工具」。说法故意写得口语化,很多条和工具描述没有一个字重合,比如「公司又来了三个同事」和「增加或减少席位数量」。真实的测试集应该从历史工单里抽,不要自己编。
- `("user007 说 10 月被扣了两次钱", "invoice_list"),` 有的问题要用好几个工具,这里只标「第一个必须找到的」。
- `def recall(search, k: int) -> tuple[float, list[str]]:` `search` 是一个函数参数,BM25 和 embedding 两个检索函数签名一样,可以直接传进来比较。
- `if want not in search(q, k):` 期望工具在 top-k 里就算命中。这个指标叫 recall@k,Day 19 评 RAG 检索时用过同一个。
- `methods = {"bm25": search_bm25}` 默认只跑 BM25,加 `--embed` 才跑 embedding,因为后者要调硅基流动的接口(60 个工具 + 30 条查询,token 数很少,按 bge-m3 的价格几乎可以忽略)。
- `print(f"{name:6} recall@{k} = {r:.2f}` 实测结果见下面的表。
- `print("  top-5 仍漏掉的:", misses)` BM25 漏掉的 8 条是:被扣了两次钱、又来了三个同事、帮我停掉、公司名字写错了、收不到两步验证码、管理员离职、信用卡过期、改联系电话。embedding 的列表是空的。

</div>

根目录运行 `uv run python -m topics.tool_search.eval_select --embed`,2026-10-22 实测:

| 检索方式 | recall@1 | recall@3 | recall@5 |
| --- | --- | --- | --- |
| BM25(jieba) | 0.63 | 0.73 | 0.73 |
| embedding(bge-m3) | 0.80 | 1.00 | 1.00 |

和 Day 18 检索帮助中心文章时的结论不太一样。那时候 BM25 在错误码上明显有优势;到了选工具这件事上,embedding 几乎全面胜出。原因看 BM25 漏掉的那几条就明白了:

- 「user007 说 10 月被扣了两次钱」切词后是 `['user007', '说', '10', '月', '被扣', '两次', '钱']`,没有一个词出现在 `invoice_list` 的描述里。描述写的是「查重复扣款」,「被扣」和「扣款」在 jieba 眼里是两个词。BM25 给出的前三是 `subscription_pause`、`refund_calc_annual`、`report_churn`,全错。embedding 把 `invoice_list` 排第一。
- 「手机换了,收不到两步验证码」切成了 `['手机', '换', '收不到', '两步', '验证码']`,而工具描述里加了自定义词典的「两步验证」是一个整词。**查询和文档切法不一致,自定义词典反而帮了倒忙。** BM25 排第一的是 `notify_sms`(描述里有「验证码」)。
- 「发票上公司名字写错了」BM25 前三全错;embedding 排第三找到了 `invoice_change_title`,但第一是 `billing_retry_charge`,说明 embedding 的 top-1 也不那么可靠。

用户描述问题的方式和工具描述的写法差得很远,这正是语义检索擅长、关键词检索吃亏的场景。错误码那一条(E1043)两种方式都找对了。实际系统里我会两种都用,像 Day 18 那样用 RRF 融合;但如果只能选一个,工具检索我选 embedding,k 取 3 到 5。

### 接进 Agent 循环

检索器有了,接进 Day 9 的 `Agent`。`Agent.run` 每一步都会读 `self.registry.schemas`,所以只要写一个 `ToolRegistry` 的子类,让 `schemas` 这个列表随着搜索结果变化,`Agent` 本身一行都不用改:

```python
# agent-60-lab/topics/tool_search/search_agent.py
"""给 Day 9 的 Agent 加工具检索:开局只挂 search_tools 和一个常用工具,搜到什么再挂什么。
根目录运行:uv run python -m topics.tool_search.search_agent [--all]"""
import json
import sys

from dotenv import load_dotenv

from topics.tool_search import catalog
from topics.tool_search.searcher import search_embed
from w2.agent_loop import Agent, ToolRegistry

load_dotenv()

SEARCH_TOOL = {
    "type": "function",
    "function": {
        "name": "search_tools",
        "description": "按功能搜索可用的后台工具。手头的工具不够用时先调它,搜到的工具下一步就能直接调用。"
        "工具覆盖:客户、订阅、发票、退款、工单、帮助中心、账号安全、报表、通知、计费。",
        "parameters": {
            "type": "object",
            "properties": {"query": {"type": "string", "description": "要做的事,用一句话描述,如「查客户的发票」"}},
            "required": ["query"],
        },
    },
}


class SearchableRegistry(ToolRegistry):
    def __init__(self, always: list[str], k: int = 3) -> None:
        super().__init__()
        self.k = k
        self.loaded: list[str] = list(always)
        self._refresh()

    def _refresh(self) -> None:
        # 原地改列表:Agent 每一步都读 registry.schemas,改完下一步就生效
        self.schemas[:] = [SEARCH_TOOL] + [catalog.SCHEMAS[n] for n in self.loaded]

    def call(self, name: str, arguments: str) -> str:
        if name == "search_tools":
            hits = search_embed(json.loads(arguments)["query"], self.k)
            new = [h for h in hits if h not in self.loaded]
            self.loaded += new  # 只追加不删除,前面的工具定义保持不动
            self._refresh()
            found = [{"name": h, "description": catalog.SCHEMAS[h]["function"]["description"]} for h in hits]
            return json.dumps({"found": found, "newly_loaded": new}, ensure_ascii=False)
        if name not in self.loaded:
            return json.dumps({"error": f"{name} 还没加载,先用 search_tools 搜一下"}, ensure_ascii=False)
        return catalog.call(name, arguments)


class FullRegistry(ToolRegistry):
    """对照组:60 个工具一次全挂上。"""

    def __init__(self) -> None:
        super().__init__()
        self.schemas[:] = list(catalog.SCHEMAS.values())

    def call(self, name: str, arguments: str) -> str:
        return catalog.call(name, arguments)


SYSTEM = "你是云簿 CloudLedger 的客服助手,先用工具核实事实再回答。金额字段单位是分,回答时换算成元。"

if __name__ == "__main__":
    reg = FullRegistry() if "--all" in sys.argv else SearchableRegistry(always=["customer_find"])
    agent = Agent(reg, SYSTEM)
    print(agent.run("user007@example.com 说 10 月被扣了两次款,帮我核实一下。"))
    print(agent.usage, "最后挂着的工具数:", len(reg.schemas))
```

<div class="line-notes">

- `"description": "按功能搜索可用的后台工具。` 搜索工具的描述决定了模型什么时候想起来用它。「手头的工具不够用时先调它」是在教它用法。
- `"工具覆盖:客户、订阅、发票、退款、工单` 把有哪些领域列出来。Anthropic 文档也建议在 system prompt 里写一句「你可以搜索 xx、xx、xx 相关的工具」。没有这句,模型不知道后台有没有退款类的工具,可能直接放弃。
- `"description": "要做的事,用一句话描述,如「查客户的发票」"` 给查询的写法举个例子。实测模型第一次搜的是「查客户的扣款/支付记录和发票」,确实是一句话描述。
- `class SearchableRegistry(ToolRegistry):` 继承 Day 9 的注册表,复用 `schemas` 列表,重写 `call`。`funcs` 用不上,留空。
- `def __init__(self, always: list[str], k: int = 3) -> None:` `always` 是开局就挂上的工具,`k` 是每次搜索返回几个。k=3 这个默认值后面会出问题。
- `self.loaded: list[str] = list(always)` 用 list 而不是 set,因为要保持追加的顺序。
- `self.schemas[:] = [SEARCH_TOOL] + [catalog.SCHEMAS[n] for n in self.loaded]` 切片赋值 `[:] =` 是原地替换列表内容,`Agent` 手里拿的还是同一个列表对象。如果写成 `self.schemas = [...]`,只是让 `self.schemas` 指向一个新列表,在这个设计里效果一样,但原地改更不容易在别处出现「拿着旧列表」的 bug。
- `hits = search_embed(json.loads(arguments)["query"], self.k)` 实测第一次搜索「查客户的扣款/支付记录和发票」返回 `['invoice_list', 'billing_credit_balance', 'billing_update_payment_method']`。
- `new = [h for h in hits if h not in self.loaded]` 已经加载过的不重复追加。
- `self.loaded += new  # 只追加不删除` 为什么不删:工具定义在请求开头那一段,删掉一个会让后面所有内容的位置都变,前缀缓存从那一点开始失效。只追加的话,至少前面已有的那部分不变。代价是工具只增不减,长任务里可能慢慢涨回去,这时候可以设一个上限,超过就清空重来。
- `found = [{"name": h, "description":` 把搜到的工具名和描述返回给模型,让它知道现在多了什么可用。完整定义已经通过 `schemas` 在下一步请求里给它了,这里不用重复。
- `if name not in self.loaded:` 防止模型调用一个还没加载的工具。比如它在别的对话里见过某个工具名就直接调,这里给一句能纠正它的错误信息。今天的实测里没触发过这个分支,但防御代码不能等出事再加。
- `class FullRegistry(ToolRegistry):` 对照组,60 个全挂。
- `reg = FullRegistry() if "--all" in sys.argv else SearchableRegistry(always=["customer_find"])` 同一个问题跑两遍,只差注册表。
- `print(agent.usage, "最后挂着的工具数:", len(reg.schemas))` 实测按需版 `{'prompt_tokens': 4683, 'completion_tokens': 1298} 最后挂着的工具数: 8`;全挂版 `{'prompt_tokens': 19478, 'completion_tokens': 818} 最后挂着的工具数: 60`。

</div>

### 一次真实轨迹:检索漏了一个工具

按需版的实测轨迹(deepseek-flash,2026-10-22):

```text
[step 1] 调用 customer_find({"query": "user007@example.com"})
[step 1] 调用 search_tools({"query": "查客户的扣款/支付记录和发票"})
           结果 {"found": [{"name": "invoice_list", ...}, {"name": "billing_credit_balance", ...}, ...]}
[step 2] 调用 invoice_list({"customer_id": "C007"})
[step 2] 调用 billing_credit_balance({"customer_id": "C007"})
[step 3] 调用 search_tools({"query": "给客户办理退款"})
           结果 {"found": [{"name": "refund_cancel", ...}, {"name": "refund_approve", ...}, {"name": "refund_calc_annual", ...}]}
[step 4] 完成 (4.0s)
```

前两步很漂亮:模型在第一步就并行调用了查客户和搜索工具,第二步拿到 `invoice_list` 查出了 10 月 8 日两张同金额的发票,结论是确认重复扣款、应退 2392 元。和全挂 60 个工具的对照组结论完全一致。

问题在第三步。模型想顺手提交退款申请,搜了「给客户办理退款」,k=3 返回的是撤回申请、审批申请、计算年付退款,**偏偏没有 `refund_submit`**。我单独查了一下,`search_embed("给客户办理退款", 5)` 的结果是 `['refund_cancel', 'refund_approve', 'refund_calc_annual', 'refund_submit', 'refund_status']`,它排第四,刚好被 k=3 截掉了。

然后模型在回答里写:「我这边没有『新建退款申请』的权限工具(现有工具只能撤回未审批的申请、审批通过、以及计算年付中途取消的退款额)。所以这笔重复扣款需要走财务/主管的退款流程建单。」

这是工具检索最典型的失败方式:**检索漏掉一个工具,模型会认为这个能力不存在**,然后很合理地绕开它。它没有编造,也没有报错,回答看起来完全正常,只是该做的事没做。全挂 60 个工具时不会出这个问题,对照组最后主动问「要我直接提交这笔退款申请吗」。

几个防法,按成本从低到高:

1. **k 别取太小。** 3 个太紧,5 个更稳。多出来的两个工具定义也就一两百 token。
2. **描述里写上用户会怎么说。** `refund_submit` 的描述是「提交退款申请」,用户和模型说的是「办理退款」「给客户退钱」。描述加一句「客户要退款、要退钱时用」,和 Day 131 写 skill description 是同一件事。
3. **在搜索工具的描述里告诉模型「搜不到就换个说法再搜」。** 比如加一句「没找到合适的工具时,换一种说法再搜一次,不要直接认为没有这个功能」。
4. **按领域整组加载。** 搜到一个 `refund_` 开头的工具,就把整个 `refund_` 组都挂上。OpenAI 的方案也是以 namespace 为单位组织延迟加载的,命名规范在这里变成了实打实的召回率。
5. **对高风险的「没有这个能力」做兜底。** 模型说「没有某工具」时,评测里要能发现。端到端评测除了看答案对不对,还要看该调用的写操作有没有被调用(Day 33 的轨迹评测)。

练习第 4、5 题会让你把这几种防法挨个试一遍。

## 怎么评测工具检索

和 RAG 一样分两层看:

- **检索层**:离线 recall@k,就是上面那张表。不花钱、跑得快,每次改描述、改分词都先跑它。注意一条用例可能需要多个工具,严格一点的版本要检查「这条任务需要的所有工具都被召回了」。
- **端到端**:让 Agent 真跑一批任务,看成功率、步数、prompt token,还有「本该调用的工具最后有没有被调用」。上面那次 `refund_submit` 的漏召回,只看最终回答是发现不了的,因为回答本身很合理。

还有一个容易忽略的对比:工具检索会多出搜索的那一两步。上面按需版比全挂版多了一次搜索调用,输出 token 也更多(1298 对 818)。工具很少时这笔额外开销不划算,这也是 Anthropic 文档说 10 个以下工具不用搜索的原因。我自己的经验线是:工具定义加起来超过上下文的 10%,或者工具数过了 30,就值得做;低于这个就先裁剪和路由。

## 动手练习

1. 建好 `catalog.py`,用 `max_tokens=1` 分别测「不挂工具」「挂 2 个」「全挂 60 个」的 prompt_tokens,和上面的表对比。你用的模型不同,数字会不一样,但比例应该接近。
2. 跑 `eval_select.py --embed`,得到你自己的 recall 表。把 BM25 漏掉的条目挑三条,用 `tokenize()` 打印查询和期望工具文档的切词结果,写下每条漏掉的原因。
3. 跑 `search_agent.py` 和 `search_agent.py --all`,记录两边的步数、prompt_tokens、最终结论。看你的轨迹里有没有出现「检索漏掉工具 → 模型说没有这个能力」。
4. 把 `SearchableRegistry` 的 k 改成 5,再给 `refund_submit` 的描述加一句「客户要退款、要退钱时用」,重跑第 3 题,看 `refund_submit` 有没有被搜到、模型有没有主动提出提交申请。
5. 实现「按前缀整组加载」:搜到的工具如果是 `refund_` 开头,就把所有 `refund_` 工具都追加进 `loaded`。重新跑第 3 题,对比 prompt_tokens 和是否找到了 `refund_submit`。
6. 选做:用 Day 18 的 RRF 把 BM25 和 embedding 融合,跑 `eval_select.py` 看 recall@1 能不能超过 0.80。

**验收标准**:第 1 题有三行实测数字;第 2 题写出至少三条漏召回的具体原因(切词结果为证);第 3 题两种模式的对比表;第 4、5 题至少一种改法让 `refund_submit` 被召回,并说明多花了多少 prompt token;第 6 题如果做了,给出融合前后的 recall 表。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| Tool Search | 让模型先搜索、再加载需要的工具,而不是一开始就把所有工具定义放进上下文 |
| 延迟加载(`defer_loading`) | Anthropic 和 OpenAI 工具定义上的标记,设为 true 的工具不进上下文,被搜到才展开 |
| `tool_reference` | Anthropic Tool Search 返回的「工具引用」块,API 会把它展开成完整的工具定义 |
| namespace | OpenAI 里把一组相关函数归在一起的结构,建议每组少于 10 个函数 |
| `ENABLE_TOOL_SEARCH` | Claude Code 控制 MCP 工具是否延迟加载的环境变量,默认开启 |
| recall@k | 期望的结果出现在检索前 k 个里的比例 |
| 前缀缓存 | 请求开头一段和上次完全相同时,服务端复用之前的计算,这部分输入更便宜更快(Day 38) |
| 漏召回 | 应该被检索到的东西没有被检索到 |

## 常见误区

**工具一多就上检索。** 先删、先合并、先按场景拆、先路由。检索本身有成本:多出来的搜索步骤、漏召回的风险、要维护的检索索引。10 个以下工具基本不需要。

**只看单次请求省了多少 token。** Agent 每一步都重发工具定义,省下的是「每步的开销 × 步数」。反过来,搜索也多了步骤和输出 token。要用端到端任务的总 token 来比。

**以为检索漏了模型会报错。** 不会。它会认为这个功能不存在,然后给出一个看起来完全合理、但没有完成任务的回答。这种失败只有轨迹评测能发现。

**工具描述只写给人看。** 加了检索以后,描述同时是检索的「文档」。用户怎么说、模型怎么搜,就得在描述里出现相近的词。Claude Code 里搜索匹配只看描述开头的一段,关键词还得往前放。

**每次搜索都把旧工具换掉。** 工具列表频繁变化会让前缀缓存一直失效,还可能让模型在第 5 步想调第 2 步用过的工具时发现它不见了。只追加、设上限,比每次替换稳。

**BM25 一定比 embedding 适合精确匹配,所以选工具用 BM25。** 选工具时用户的说法和工具描述差得很远,今天的实测是 embedding recall@3 = 1.00、BM25 = 0.73。错误码这类精确字符串 BM25 依然有用,最好两路融合。

## 学习资料

### 文档与文章

- [Claude 文档 · Tool search tool](https://platform.claude.com/docs/en/agents-and-tools/tool-use/tool-search-tool):今天最核心的文档,regex 和 BM25 两种变体、`defer_loading`、返回格式、限制、和 prompt 缓存的关系、自己实现检索时怎么返回 `tool_reference`,40 分钟。
- [Anthropic · Introducing advanced tool use](https://www.anthropic.com/engineering/advanced-tool-use):Tool Search 和 Programmatic Tool Calling 的设计背景,20 分钟。
- [OpenAI 文档 · Tool search](https://developers.openai.com/api/docs/guides/tools-tool-search):namespace、hosted 和 client 两种模式,和 Anthropic 的方案对照看,20 分钟。
- [Claude Code 文档 · MCP](https://code.claude.com/docs/en/mcp):找到「Scale with MCP tool search」那一节,`ENABLE_TOOL_SEARCH` 的取值、描述截断长度、`alwaysLoad`,写 MCP server 的人必读,15 分钟。
- [RAG-MCP 论文](https://arxiv.org/abs/2505.03275):用检索缓解 MCP 工具过多问题的实验,看摘要和实验设置就够了,15 分钟。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1CzmJB5Eem&autoplay=0&high_quality=1" title="claude新解决方案，mcp工具过多提示词爆炸" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>Token杰-自然智群 · claude新解决方案,mcp工具过多提示词爆炸 · 5 分钟,讲 Anthropic 的 Tool Search 解决的是什么问题。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1ZK7N6sEiU&autoplay=0&high_quality=1" title="建议所有人：关注你的Agent上下文占用率" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>一启-AI · 建议所有人:关注你的Agent上下文占用率 · 15 分钟,从使用者角度看 MCP 工具、skill 各占了多少上下文,和今天第一节「先量一下」是一个意思。</figcaption>
</figure>

- 朱老师AI课堂《工具越多,Agent越傻?「工具过载」怎么解决?》(BV1ePKb6REi4,2 分钟):问题的快速版。

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/F375CZ6g6p8" title="Exploring Claude Opus 4.5 new advanced tool use" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Letta · Exploring Claude Opus 4.5 new advanced tool use · Letta 是做 Agent 记忆和运行时的团队,这期是他们对 Anthropic 高级工具调用功能(包括 Tool Search)的试用。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/y7n1PZc8p9s" title="98% Token Savings: Claude's Tool Search & Code Execution (2026)" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Prompt Circle AI · 98% Token Savings: Claude's Tool Search & Code Execution (2026) · 标题里的 98% 是特定场景的数字,看他怎么配置和测量就行,别把数字当结论。</figcaption>
</figure>

- digma《Your AI Agent Has Too Many Tools — Use the L.E.A.S.T. Protocol》(YouTube `0hJMQX2BRFY`):讲怎么从源头减少工具数量,对应「先试便宜的办法」那一节。

### 书籍

- Chip Huyen《AI Engineering》(O'Reilly, 2025):第 6 章 Agents 的「Tools」一节,讲工具清单太长时模型为什么会变差、怎么选工具集合。
- Jay Alammar、Maarten Grootendorst《Hands-On Large Language Models》(O'Reilly, 2024):第 8 章 Semantic Search and Retrieval-Augmented Generation,dense retrieval 和 rerank 的基础,今天的 embedding 检索就是它的一个应用。

### 开源项目与代码

- [Claude Cookbook · Tool search with embeddings](https://platform.claude.com/cookbook/tool-use-tool-search-with-embeddings):官方的自定义工具检索示例,用 embedding 检索后返回 `tool_reference`,和我们的客户端版对照看,40 分钟。
- [dorianbrown/rank_bm25](https://github.com/dorianbrown/rank_bm25):今天用的 BM25 实现,源码就一个文件,想知道打分细节可以读一遍。
- [modelcontextprotocol/servers](https://github.com/modelcontextprotocol/servers):官方和社区 MCP server 列表,挑一两个工具多的 server 看它们的描述写法,想想放进检索里能不能被搜到。

## 自测

1. 工具多了会带来哪两类问题?为什么在 Agent 场景里第一个问题会被放大?

<details><summary>答案</summary>

一是成本,每次请求都要发送所有工具的定义;二是准确率,工具越多、越相似,模型越容易选错。Agent 每一步都要重发完整的工具列表,所以工具定义的开销要乘以步数。今天的实测里,单次请求全挂 60 个工具是 4539 token,四步任务累计到 19478。

</details>

2. Anthropic 的 `defer_loading` 工具还要不要在请求里发完整定义?被搜到的工具为什么不影响 prompt 缓存?

<details><summary>答案</summary>

要发。完整定义仍然放在 `tools` 数组里,API 需要它们在服务端搜索和展开;`defer_loading` 控制的是进不进模型的上下文。被延迟的工具不在系统前缀里,搜到后以 `tool_reference` 块追加在对话中间再展开,前缀本身没变,所以缓存还能命中。

</details>

3. 为什么今天的实测里 embedding 选工具的召回率比 BM25 高那么多?举一个具体例子。

<details><summary>答案</summary>

用户描述问题的说法和工具描述的写法差别很大,关键词往往对不上。比如「user007 说 10 月被扣了两次钱」切词后没有一个词出现在 invoice_list 的描述「查重复扣款先用它」里(「被扣」和「扣款」是不同的词),BM25 前三全错,embedding 把 invoice_list 排第一。又比如「两步验证码」被切成「两步 / 验证码」,和文档里的整词「两步验证」对不上。

</details>

4. 搜索工具的描述里为什么要列出「工具覆盖哪些领域」?

<details><summary>答案</summary>

模型只看得见已加载的工具,不知道后台还有什么。不告诉它有退款类工具,它可能根本不会去搜,而是直接回答「无法办理」。列出领域相当于给它一张目录,和 skill 的第一层目录是同一个思路。Anthropic 文档也建议在 system prompt 里写清可以搜索哪些类别的工具。

</details>

5. (面试题)「你们的 Agent 接了 200 个 MCP 工具,加了工具检索之后 token 降了,但业务方说有些单子 Agent 说『系统不支持』,其实是支持的。你怎么排查和修?」

<details><summary>答案</summary>

这是典型的漏召回:检索没返回对应工具,模型认为能力不存在并绕开了。排查:从线上 trace 里找出「说不支持」的会话,看当时的搜索查询和返回结果,确认期望工具是否在候选里、排第几;离线把这些查询加进选工具测试集,算 recall@k。修法按成本:调大 k;改写工具描述,加入用户和模型的常见说法,把关键词放到描述开头;搜索工具的描述里列出能力领域,并要求搜不到时换说法再搜;按命名空间整组加载;检索用 BM25 + embedding 融合。最后在端到端评测里加一项检查「该调用的工具是否被调用」,防止回归。还要看是不是有权限过滤把工具挡掉了。

</details>

6. (面试题)工具检索和 Day 13 的路由(routing)都能缩小工具范围,怎么选?

<details><summary>答案</summary>

路由是在任务开始前,用一次分类决定属于哪个领域,只挂这个领域的工具,适合领域边界清楚、一个任务基本只在一个领域内的场景,行为可预测、好评测。工具检索是在任务进行中由模型按需去找,适合一个任务跨多个领域、工具多到路由分不过来、或者工具集合经常变化的场景,更灵活,但多了搜索步骤和漏召回风险。两者可以组合:先路由到大类,大类里工具仍然多的再用检索。

</details>

## 明天预告

专题篇可以跳着读,按编号下一篇是 Day 134 · **推理模型与 test-time compute**:thinking 预算、自洽投票、树搜索。今天模型在第三步搜「给客户办理退款」时,只搜了一次就放弃了;推理模型会不会多想一步、换个说法再搜?花多少思考 token 值得?明天我们拿一批难工单,在不同的 thinking 预算下比较准确率、成本和延迟,再把 self-consistency 投票和 best-of-N 加验证器的骨架各写一遍。
