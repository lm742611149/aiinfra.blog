---
title: 'Day 184 · 工具多了怎么办(一):先量一下 60 个工具有多贵'
description: '给云簿客服后台造 60 个工具,用 max_tokens=1 量出「全挂上」一次请求要 4,485 个 prompt token,每多一个工具约 71 个;同一个核实重复扣款的任务,全挂 60 个四步花 19,132 个输入 token,只挂真正要用的 3 个是 1,943 个。再试三种最便宜的办法:砍掉用不上的、合并相近的、先分类再挂,并亲眼看到路由把「扣款」分错领域后,模型一本正经地说「我没有查发票的工具」。'
pubDate: 2026-10-22
regime: none
tags: ['tool-use', 'context-engineering', 'cost', 'agent-zero']
series: 'agent-zero'
day: 184
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 183](/blog/agent-zero/day-183-tool-design-3/) 用五个带程序判卷的任务,让 Agent 拿 Day 180 的坏工具和 Day 182 的好工具各跑两遍。成功率都是 10/10,但好工具平均输入 token 只有坏工具的九分之一左右,而且波动小得多;读轨迹改了两句描述,留出任务 T5 也跟着变好。

这三天我们一直只有两三个工具。可真实的 Agent 接一个 MCP server 就是几十个工具,再接几个系统就上百个。[Day 180](/blog/agent-zero/day-180-tool-design-1/) 的练习 1 量过 3 个坏工具的定义就占了 328 个 token,工具一多,这笔钱每一步都要付一遍。今天先把这笔账量清楚,再看几种不用写新代码就能省下来的办法。

## 今天要解决的问题

学完你应该能:

1. 用 `max_tokens=1` 的小请求量出「挂 N 个工具」的 prompt token,说清楚固定开销和每个工具的边际开销分别是多少。
2. 算出一个多步任务里工具定义总共被发了几遍、占了多少钱,知道前缀缓存能帮多少、帮不了什么。
3. 用三种便宜办法给工具瘦身:砍掉、合并、先分类再挂(路由),并说出每种的代价。
4. 看懂路由分错时 Agent 的典型表现:它不会报错,会很合理地告诉你「我没有这个能力」。

预计用时 2 小时。前置:[Day 124](/blog/agent-zero/day-124-cost/)(从 usage 算钱、缓存价)、[Day 148](/blog/agent-zero/day-148-structured-2/)(JSON mode)、[Day 168](/blog/agent-zero/day-168-tool-registry-1/) 到 [Day 170](/blog/agent-zero/day-170-agent-full/)(`ToolRegistry` 和 `run_agent`)、[Day 182](/blog/agent-zero/day-182-tool-design-2/)(命名空间)。代码在 `agent-zero-lab/part03/`,命令都在 `agent-zero-lab/` 根目录跑。正文和练习全部实跑一遍,按 `.env` 里的高峰价算一共约 ¥0.07。

学法:先对照文章逐行敲一遍(不复制粘贴)并跑通;第二天合上文章,默写 `measure_tools.py` 和 `route()` 函数;做练习,做不出再展开参考答案,看完关掉自己重写一遍。

## 工具为什么会越来越多

先想一个前端里很熟悉的场景。你在做一个管理后台,一开始只有「用户列表」一个页面,接口就三五个;做了一年,订单、发票、退款、报表、通知、权限,每个模块五六个接口,`api/` 目录下几十个文件。没人刻意让它变多,它就是会变多。

Agent 的工具也一样。云簿 CloudLedger 的客服后台,按领域数一下:客户、订阅、发票、退款、工单、帮助中心、账号安全、报表、通知、计费,一共十个领域,每个领域五六个操作,就是六十个。这还只是自家系统。再接一个 GitHub 的 MCP server(第五部分会学 MCP,现在你只要知道「一个 server 一下子给你一大包工具」)、一个 Jira server,上百个不稀奇。

工具一多,会同时冒出两个问题:

- **贵**。[Day 157](/blog/agent-zero/day-157-tool-schema/) 学过,工具定义(名字、描述、参数的 JSON Schema)是随着每次请求一起发给模型的,模型要读完它们才知道自己能干什么。你挂了 60 个,哪怕这一步只用到 1 个,另外 59 个的说明书也得一起读。
- **容易选错**。功能相近的工具挤在一起,`refund_status` 和 `refund_list_pending`,`invoice_resend` 和 `notify_email`,模型挑的时候会犹豫。Anthropic 的 [Tool Search 文档](https://platform.claude.com/docs/en/agents-and-tools/tool-use/tool-search-tool)原话是:工具超过 30 到 50 个之后,Claude 选对工具的能力会下降。

今天先解决「贵」到底有多贵。量清楚了,才知道值不值得为它动脑筋。

## 第一步:造 60 个工具

今天只关心「挂多少个工具、花多少 token」,所以 60 个工具里只有查客户、查订阅、查发票三个真的返回数据,其余 57 个是「演示桩」:调用它只会返回一句「没有真的执行」。前端写 mock 接口时也常这么干,先把接口形状定下来,实现以后再补。

CloudLedger 的业务库要到第五部分([Day 280](/blog/agent-zero/day-280-mcp-seed/))才建,今天先在文件里手写几行小样本数据:两个客户,其中 C007 刘静在 2026 年 10 月 8 日被同一笔年费扣了两次。

还有一个写法上的变化。前几天的工具都是用 `@reg.tool` 装饰器一个函数一个函数登记的,60 个都写成函数太长了,而且 57 个是空壳。所以今天换一种写法:**用一张表(列表)描述所有工具**,每行是「名字、描述、参数说明」三样,再用一个小函数把每行转成 schema。这就像前端里用一份路由配置数组生成所有路由,而不是一个个手写 `<Route>`。

```python
# agent-zero-lab/part03/catalog.py  云簿后台的 60 个工具:3 个接了小样本数据,其余是演示桩
import json
from typing import Any

from part03.agent_loop import ToolRegistry

# (工具名, 描述, {参数名: 参数说明})。命名统一「领域_动作」
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

# 小样本数据:CloudLedger 业务库要到第五部分才建,今天先手写几行
CUSTOMERS = [
    {"id": "C007", "name": "刘静", "company": "半岛咖啡", "email": "user007@example.com"},
    {"id": "C023", "name": "王磊", "company": "青禾设计", "email": "user023@example.com"},
]
SUBSCRIPTIONS = {
    "C007": {"plan": "专业版", "billing_cycle": "年付", "seats": 8, "status": "active", "current_period_end": "2027-10-07"},
    "C023": {"plan": "企业版", "billing_cycle": "年付", "seats": 20, "status": "active", "current_period_end": "2027-03-31"},
}
INVOICES = {
    "C007": [
        {"id": "INV-2026-0123", "amount_cents": 239200, "status": "paid", "issued_at": "2026-10-08"},
        {"id": "INV-2026-0026", "amount_cents": 239200, "status": "paid", "issued_at": "2026-10-08"},
        {"id": "INV-2025-0871", "amount_cents": 239200, "status": "paid", "issued_at": "2025-10-08"},
    ],
    "C023": [{"id": "INV-2026-0050", "amount_cents": 958000, "status": "paid", "issued_at": "2026-04-01"}],
}


def run_tool(name: str, args: dict[str, Any]) -> Any:
    if name == "customer_find":
        q = args.get("query", "")
        return [c for c in CUSTOMERS if q in (c["id"], c["email"]) or (q and q in c["company"])]
    if name == "subscription_get":
        return SUBSCRIPTIONS.get(args.get("customer_id", ""), {"error": "没有这个客户 ID"})
    if name == "invoice_list":
        return INVOICES.get(args.get("customer_id", ""), [])
    if name in SCHEMAS:
        return {"ok": True, "note": f"{name} 是演示桩,没有真的执行"}
    return {"error": f"没有工具 {name}"}


class Catalog(ToolRegistry):
    """只挂 names 里的那些工具。run_agent 只用到 schemas 和 call,所以换成它不用改循环。"""

    def __init__(self, names: list[str]) -> None:
        super().__init__()
        self.schemas = [SCHEMAS[n] for n in names]

    def call(self, name: str, arguments: str) -> str:
        return json.dumps(run_tool(name, json.loads(arguments or "{}")), ensure_ascii=False)


if __name__ == "__main__":
    text = json.dumps(list(SCHEMAS.values()), ensure_ascii=False)
    print("工具数", len(SCHEMAS), "| 全部定义的 JSON 字符数", len(text))
    print(Catalog(["customer_find"]).call("customer_find", '{"query": "user007@example.com"}'))
```

<div class="line-notes">

- `from part03.agent_loop import ToolRegistry` 这是 [Day 168](/blog/agent-zero/day-168-tool-registry-1/)–[Day 170](/blog/agent-zero/day-170-agent-full/) 建的 `agent_loop.py`,今天要继承它的 `ToolRegistry`,让 `run_agent` 不用改一行就能用上 60 个工具。
- `SPECS: list[tuple[str, str, dict[str, str]]] = [` 类型标注读作「一个列表,每个元素是 (字符串, 字符串, 字典) 三元组」。tuple 相当于 TS 里的元组类型 `[string, string, Record<string, string>]`。
- `("customer_find", "按邮箱、公司名或客户 ID 查找客户` 名字统一「领域_动作」,这是 [Day 182](/blog/agent-zero/day-182-tool-design-2/) 原则二的命名空间。今天它还会多一个用处:路由时按前缀把工具分组。
- `("invoice_list", "列出客户最近的发票:` 描述里写了「查重复扣款先用它」。记住这句,后面路由分错领域时就是它所在的 invoice 组没被挂上。
- `("refund_submit", "提交退款申请,需要主管审批` 退款领域里唯一一个「新建申请」的工具。明天检索漏掉它会出事。
- `("report_revenue_monthly", "公司每月收入汇总(内部财务用)。"` 括号里的「内部财务用」是故意留的:客服 Agent 根本不该有这个工具,第三步会把它砍掉。
- `def _schema(name: str, desc: str, params: dict[str, str]) -> dict[str, Any]:` 把三元组转成 OpenAI 兼容格式的 function schema,结构和 [Day 157](/blog/agent-zero/day-157-tool-schema/) 手写的一样。函数名前面的下划线是 Python 的约定,表示「模块内部用」,相当于 JS 里不 export 的函数。
- `"properties": {k: {"type": "string", "description": v} for k, v in params.items()},` 字典推导式([Day 26](/blog/agent-zero/day-026-nested-data/) 学过),把每个参数都写成 string 类型。偷懒了,今天不关心参数类型。
- `"required": list(params),` 对字典调用 `list()` 得到的是 key 的列表,相当于 JS 的 `Object.keys(params)`。所有参数都必填。
- `SCHEMAS = {name: _schema(name, desc, params) for name, desc, params in SPECS}` 按名字索引的字典,`SCHEMAS["invoice_list"]` 就能拿到那个工具的 schema。Python 3.7 起字典保持插入顺序,所以遍历时顺序和 `SPECS` 一样。
- `CUSTOMERS = [` 两个客户的小样本。邮箱 `user007@example.com` 是今天任务里用户报上来的那个。
- `INVOICES = {` C007 有三张发票:两张 2026-10-08 同金额 239200 分(2,392 元),这就是重复扣款;一张是去年的正常年费。金额单位是分,这是计费系统的常见做法,避免小数误差。
- `def run_tool(name: str, args: dict[str, Any]) -> Any:` 真正「执行」工具的地方。三个有数据的工具各写一个分支,其余一律返回演示桩。
- `return [c for c in CUSTOMERS if q in (c["id"], c["email"]) or (q and q in c["company"])]` `q in (a, b)` 是判断 q 是否等于其中之一,相当于 JS 的 `[a, b].includes(q)`;后半句是公司名模糊匹配,`q and` 防止空字符串匹配所有公司。
- `return SUBSCRIPTIONS.get(args.get("customer_id", ""), {"error": "没有这个客户 ID"})` `dict.get(键, 默认值)` 找不到时返回默认值,不抛异常,相当于 `obj[key] ?? 默认值`。
- `return {"ok": True, "note": f"{name} 是演示桩,没有真的执行"}` 其余 57 个工具都返回这句。模型调到它们时会在回答里如实说「这个接口是演示桩」,下面的实跑里能看到。
- `class Catalog(ToolRegistry):` 继承 `ToolRegistry`,但不再用装饰器登记函数,而是直接把指定名字的 schema 塞进 `self.schemas`。`run_agent` 只用到注册表的 `schemas` 和 `call` 两样,所以它分不出这是哪种注册表。
- `self.schemas = [SCHEMAS[n] for n in names]` 只挂 `names` 里的那些。`Catalog(list(SCHEMAS))` 就是 60 个全挂,`Catalog(["customer_find"])` 就只挂一个。
- `return json.dumps(run_tool(name, json.loads(arguments or "{}")), ensure_ascii=False)` 和 `ToolRegistry.call` 一样:参数是 JSON 字符串,返回也是 JSON 字符串。`ensure_ascii=False` 让中文原样输出,不变成 `刘` 这种转义,省 token 也方便看。
- `print("工具数", len(SCHEMAS), "| 全部定义的 JSON 字符数", len(text))` 实测 60 个工具,15,571 个字符。

</div>

运行:

```bash
# 在 agent-zero-lab/ 下跑
uv run python -m part03.catalog
```

```text
工具数 60 | 全部定义的 JSON 字符数 15571
[{"id": "C007", "name": "刘静", "company": "半岛咖啡", "email": "user007@example.com"}]
```

一万五千多个字符,这就是每一步都要随请求发出去的「说明书」。字符数不等于 token 数,下一步让 DeepSeek 自己数。

## 第二步:量一下,挂 0 个、1 个、2 个、6 个、60 个

[Day 180](/blog/agent-zero/day-180-tool-design-1/) 用过一个很准的量法:发一个 `max_tokens=1` 的请求,只让模型吐 1 个 token,看响应里的 `prompt_tokens`。输出几乎为零,花的钱几乎全是输入,而 `prompt_tokens` 是服务端数的,比本机任何 tokenizer 都准。

今天同一句话发五次,每次挂的工具不一样:

```python
# agent-zero-lab/part03/measure_tools.py  同一句话,挂不同数量的工具,看 prompt_tokens 涨多少
from common.llm import LLMClient
from part03.catalog import SCHEMAS

QUESTION = "user007@example.com 说 10 月被扣了两次款,帮我核实一下。"
SETS = {
    "不挂工具": [],
    "挂 1 个": ["customer_find"],
    "挂 2 个": ["customer_find", "invoice_list"],
    "挂 invoice_ 一组 6 个": [n for n in SCHEMAS if n.startswith("invoice_")],
    "全挂 60 个": list(SCHEMAS),
}
llm = LLMClient()
base = 0
for label, names in SETS.items():
    tools = [SCHEMAS[n] for n in names]
    kw = {"tools": tools} if tools else {}
    r = llm.chat([{"role": "user", "content": QUESTION}], max_tokens=1, **kw)
    if not names:
        base = r.prompt_tokens
    extra = r.prompt_tokens - base
    per = f"平均每个 {extra / len(names):.0f}" if names else ""
    print(f"{label:<18} prompt_tokens {r.prompt_tokens:5} | 工具定义约 {extra:5} {per}")
print(llm.ledger)
```

<div class="line-notes">

- `QUESTION = "user007@example.com 说 10 月被扣了两次款,帮我核实一下。"` 今天整天都用这个任务。五次请求问的都是它,只有工具在变。
- `SETS = {` 五组对照。字典的 key 是标签,value 是要挂的工具名列表。
- `"挂 invoice_ 一组 6 个": [n for n in SCHEMAS if n.startswith("invoice_")],` 用前缀挑出发票领域的 6 个。`str.startswith` 和 JS 的 `startsWith` 一样。
- `"全挂 60 个": list(SCHEMAS),` 对字典 `list()` 得到全部 key,也就是 60 个名字。
- `kw = {"tools": tools} if tools else {}` 不挂工具时干脆不传 `tools` 参数。传一个空列表 `tools=[]` 有的厂商会报 400,不如不传。
- `r = llm.chat([{"role": "user", "content": QUESTION}], max_tokens=1, **kw)` `**kw` 把字典展开成关键字参数,`kw` 是 `{"tools": [...]}` 时就等于写了 `tools=[...]`,相当于 JS 里的对象展开 `{...kw}` 传进函数。
- `base = r.prompt_tokens` 第一组「不挂工具」的读数当基准,后面每组减掉它,就是工具定义本身占的 token。
- `per = f"平均每个 {extra / len(names):.0f}" if names else ""` `:.0f` 是格式化成没有小数的数字,相当于 JS 的 `toFixed(0)`。
- `print(llm.ledger)` [Day 135](/blog/agent-zero/day-135-llm-client-1/) 起 `LLMClient` 自带的账本,打印总调用次数、token 和花费。

</div>

```bash
uv run python -m part03.measure_tools
```

DeepSeek `deepseek-flash`,2026 年 10 月 22 日实测:

```text
不挂工具               prompt_tokens    25 | 工具定义约     0 
挂 1 个              prompt_tokens   316 | 工具定义约   291 平均每个 291
挂 2 个              prompt_tokens   389 | 工具定义约   364 平均每个 182
挂 invoice_ 一组 6 个  prompt_tokens   654 | 工具定义约   629 平均每个 105
全挂 60 个            prompt_tokens  4485 | 工具定义约  4460 平均每个 74
5 次调用 | 输入 5869 / 输出 5 tokens | 约 ¥0.0110
```

先看最奇怪的一行:**挂 1 个工具就多了 291 个 token**,可是挂 2 个只多 364,第二个工具只多花了 73。说明这 291 里有一大块和「挂几个」无关,是只要挂了工具就要付的固定开销。合理的猜测是服务端会把工具列表包进一段固定格式的说明文字里再交给模型(各家都这么做,只是不公开具体格式),这段包装就是固定开销。练习 1 会多量几个点,算出固定开销约 220 个 token,之后**每多一个工具约 71 个 token**。

再看 60 个:4,460 个 token,平均 74 个一个。我的描述已经写得很短了,一句话加一两个参数。真实的 MCP server 描述动辄几百字,参数也多。Anthropic 那篇文档里举的例子是 GitHub、Slack、Sentry、Grafana、Splunk 五个 server 一起接,光工具定义就约 55k token,是我们的十二倍。

4,460 个 token 单看不多,高峰价每百万 2 元,一次是 0.009 元。可 Agent 不是只发一次。

## 第三步:一个四步任务里,说明书被发了几遍

[Day 131](/blog/agent-zero/day-131-conversation-cost/) 讲过「对话越聊越贵」:每一轮都要把整个历史重发一遍。Agent 循环是同一回事,而且工具定义永远在请求最前面,**每一步都要重发一遍**。四步的任务,60 个工具的说明书就被读了四遍。

写一个脚本,让同一个任务分别在「全挂 60 个」和「只挂它真正用得到的 3 个」下跑一遍。后者是作弊:现实里你事先不知道用户会问什么,不可能每次都正好挂对。但它告诉我们「最理想能省到多少」,是一个下限。

```python
# agent-zero-lab/part03/run_catalog.py  同一个任务:全挂 60 个工具 vs 只挂它真正用到的 3 个
import sys

from part03.agent_loop import run_agent
from part03.catalog import SCHEMAS, Catalog

SYSTEM = "你是云簿 CloudLedger 的客服助手,先用工具核实事实再回答。金额字段单位是分,回答时换算成元。"
TASK = "user007@example.com 说 10 月被扣了两次款,帮我核实一下。"

names = list(SCHEMAS) if "--all" in sys.argv else ["customer_find", "invoice_list", "refund_submit"]
answer, llm = run_agent(Catalog(names), SYSTEM, TASK, max_steps=8)
print("== 回答\n" + answer)
print(f"挂了 {len(names)} 个工具 |", llm.ledger)
```

<div class="line-notes">

- `from part03.agent_loop import run_agent` [Day 170](/blog/agent-zero/day-170-agent-full/) 的循环,每一步打印输入输出 token 和工具调用。它每一步都会重新读 `registry.schemas`。
- `SYSTEM = "你是云簿 CloudLedger 的客服助手,先用工具核实事实再回答。金额字段单位是分,回答时换算成元。"` 提醒金额单位,否则模型可能直接把 239200 当成元报给客户。
- `names = list(SCHEMAS) if "--all" in sys.argv else ["customer_find", "invoice_list", "refund_submit"]` 命令行带 `--all` 就全挂;不带就只挂三个。`sys.argv` 是命令行参数列表,相当于 Node 的 `process.argv`。
- `answer, llm = run_agent(Catalog(names), SYSTEM, TASK, max_steps=8)` 换成 `Catalog`,循环一行没改。`run_agent` 返回最终回答和它内部用的 `LLMClient`,账本在后者身上。

</div>

```bash
uv run python -m part03.run_catalog --all
uv run python -m part03.run_catalog
```

全挂 60 个(回答比较长,只保留开头和结尾):

```text
[step 1] 输入 4514 tok | 输出 51 tok
    调用 customer_find({"query": "user007@example.com"}) -> 返回 81 字符
[step 2] 输入 4609 tok | 输出 70 tok
    调用 invoice_list({"customer_id": "C007"}) -> 返回 282 字符
    调用 subscription_get({"customer_id": "C007"}) -> 返回 106 字符
[step 3] 输入 4864 tok | 输出 153 tok
    调用 invoice_get_pdf({"invoice_id": "INV-2026-0123"}) -> 返回 51 字符
    调用 invoice_get_pdf({"invoice_id": "INV-2026-0026"}) -> 返回 51 字符
    调用 refund_calc_annual({"customer_id": "C007"}) -> 返回 54 字符
    调用 billing_credit_balance({"customer_id": "C007"}) -> 返回 58 字符
[step 4] 输入 5145 tok | 输出 329 tok
== 回答
核实结果:**确实重复扣款了**。
……
2026-10-08 这一天开了两张金额、状态都相同的年费发票,各 2,392.00 元,属于同一天重复扣款。
……
要我先提交退款吗?请告诉我保留哪一张发票(一般建议保留 INV-2026-0123,作废 INV-2026-0026),以及退款金额是否就是全额 2,392.00 元。
挂了 60 个工具 | 4 次调用 | 输入 19132 / 输出 603 tokens | 约 ¥0.0157
```

只挂 3 个:

```text
[step 1] 输入 527 tok | 输出 51 tok
    调用 customer_find({"query": "user007@example.com"}) -> 返回 81 字符
[step 2] 输入 622 tok | 输出 39 tok
    调用 invoice_list({"customer_id": "C007"}) -> 返回 282 字符
[step 3] 输入 794 tok | 输出 280 tok
== 回答
……
**结论**:客户反映的情况属实。2026 年 10 月 8 日同一客户名下有两张金额完全相同(各 2,392.00 元)的发票,且均已支付,看起来是重复开票并重复扣款。
……
挂了 3 个工具 | 3 次调用 | 输入 1943 / 输出 370 tokens | 约 ¥0.0046
```

两边结论一样,都找到了 10 月 8 日那两张 2,392 元的发票。差别在三个地方。

**输入 token 差了将近十倍:19,132 对 1,943。** 全挂那边每一步的输入都在 4,500 以上,其中 4,460 是工具说明书,真正的对话内容只有几百个 token。这和 Day 180 坏工具「一次搜索灌进三万 token」是两种不同的浪费:那次是工具**返回**太大,这次是工具**定义**太多。

**全挂那边多走了一步,多调了 5 个工具。** 第三步它调了两次 `invoice_get_pdf`、一次 `refund_calc_annual`、一次 `billing_credit_balance`。这些对「核实是否重复扣款」都没用,模型只是看见手边有这些工具,就顺手都调了一下。工具越多,模型越容易「既然有,那就看看」。这是选择变多的另一个代价:不一定选错,但会多走路。

**钱的差距没有 token 那么大:¥0.0157 对 ¥0.0046,三倍多一点。** 原因是前缀缓存。[Day 124](/blog/agent-zero/day-124-cost/) 学过,DeepSeek 对「和之前某次请求开头一模一样的那部分」按缓存价收,`deepseek-flash` 高峰时缓存命中每百万 0.04 元,没命中 2 元,差五十倍。工具定义恰好放在每次请求的最前面,而且每一步都不变,所以从第二步开始,它们大多会命中缓存。

用账本反推一下。设命中缓存的输入是 h 个 token,输出 603 个:

```text
h × 0.04 + (19132 − h) × 2 + 603 × 8 = 15,700   (单位:百万分之一元)
38,264 − 1.96h + 4,824 = 15,700
h ≈ 14,000
```

19,132 个输入里约 1.4 万个命中了缓存。缓存把钱省下来了,但**省不掉上下文**:那 4,460 个 token 照样占着模型的注意力和上下文窗口,也照样让模型在 60 个选项里挑。而且缓存要求开头一个字都不能变,下一节的路由、明天的检索都会让工具列表变来变去,缓存就没那么好命中了。这是一个要一直记着的取舍。

<figure>
<svg viewBox="0 0 640 250" role="img" aria-label="四步任务里每一步的输入token构成:全挂60个工具时每步约4460是工具定义,只挂3个工具时每步约450">
  <rect x="0" y="0" width="640" height="250" fill="var(--paper-raised)" rx="6"/>
  <text x="20" y="26" font-family="var(--font-mono)" font-size="13" fill="var(--ink)">每一步的输入 token(琥珀 = 工具定义,蓝 = 对话和工具结果)</text>
  <text x="20" y="56" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">全挂 60 个</text>
  <text x="20" y="80" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">step 1</text>
  <rect x="80" y="70" width="401" height="14" fill="var(--compute-wash)" stroke="var(--compute)"/>
  <rect x="481" y="70" width="5" height="14" fill="var(--mem-wash)" stroke="var(--mem)"/>
  <text x="494" y="81" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">4,514</text>
  <text x="20" y="100" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">step 2</text>
  <rect x="80" y="90" width="401" height="14" fill="var(--compute-wash)" stroke="var(--compute)"/>
  <rect x="481" y="90" width="13" height="14" fill="var(--mem-wash)" stroke="var(--mem)"/>
  <text x="502" y="101" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">4,609</text>
  <text x="20" y="120" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">step 3</text>
  <rect x="80" y="110" width="401" height="14" fill="var(--compute-wash)" stroke="var(--compute)"/>
  <rect x="481" y="110" width="36" height="14" fill="var(--mem-wash)" stroke="var(--mem)"/>
  <text x="525" y="121" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">4,864</text>
  <text x="20" y="140" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">step 4</text>
  <rect x="80" y="130" width="401" height="14" fill="var(--compute-wash)" stroke="var(--compute)"/>
  <rect x="481" y="130" width="62" height="14" fill="var(--mem-wash)" stroke="var(--mem)"/>
  <text x="551" y="141" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">5,145</text>
  <text x="20" y="176" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">只挂 3 个</text>
  <text x="20" y="200" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">step 1</text>
  <rect x="80" y="190" width="40" height="14" fill="var(--compute-wash)" stroke="var(--compute)"/>
  <rect x="120" y="190" width="7" height="14" fill="var(--mem-wash)" stroke="var(--mem)"/>
  <text x="135" y="201" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">527</text>
  <text x="20" y="220" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">step 3</text>
  <rect x="80" y="210" width="40" height="14" fill="var(--compute-wash)" stroke="var(--compute)"/>
  <rect x="120" y="210" width="31" height="14" fill="var(--mem-wash)" stroke="var(--mem)"/>
  <text x="159" y="221" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">794</text>
  <text x="20" y="243" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">条长按每 11 个 token 1 像素画;工具定义部分按第二步量出的数估算</text>
</svg>
<figcaption>全挂 60 个时,每一步的输入里九成以上是工具说明书,真正在变的只有右边那一小截蓝色。说明书每一步都要重发,步数越多,浪费越多。</figcaption>
</figure>

放大到一天看。假设云簿每天 1 万张工单,每张平均四步,按全挂 60 个、全部没命中缓存的最坏情况:

```text
工具定义:4,460 token × 4 步 × 10,000 张 = 1.78 亿 token
最坏(全没命中):1.78 亿 × 2 元 / 百万 ≈ 357 元 / 天
最好(全命中):  1.78 亿 × 0.04 元 / 百万 ≈ 7 元 / 天
```

真实情况在两者之间。几十到几百块一天,算不上天价,但它买来的东西是负的:更多的无效调用、更挤的上下文、更高的选错率。所以值得想办法。下面三个办法都不需要新技术,今天就能用。

## 便宜办法一:砍掉用不上的

最便宜的办法是问一句:**这个 Agent 真的需要这个工具吗?**

我把 60 个工具逐个过了一遍,站在「客服 Agent」的角度,至少 10 个不该出现在它手里:

```python
# agent-zero-lab/part03/prune.py  便宜办法一:客服 Agent 用不上的工具先砍掉
from part03.catalog import SCHEMAS

DROP = {
    "refund_approve": "主管审批,客服不能自己批",
    "refund_list_pending": "主管的待办列表",
    "report_revenue_monthly": "内部财务报表",
    "report_churn": "内部经营指标",
    "notify_slack_oncall": "内部报警,不该由客服对话触发",
    "kb_suggest_edit": "运营改文档用",
    "kb_feedback_stats": "运营看数据用",
    "kb_popular": "运营看数据用",
    "kb_list_categories": "有 kb_search 就够了",
    "billing_currency_convert": "云簿只有人民币客户",
}
KEPT = [n for n in SCHEMAS if n not in DROP]

if __name__ == "__main__":
    print("砍掉", len(DROP), "个,剩", len(KEPT), "个")
    for name, why in DROP.items():
        print(f"  - {name:<26} {why}")
```

<div class="line-notes">

- `DROP = {` 键是工具名,值是砍掉的理由。理由写进代码,半年后有人问「为什么客服 Agent 不能审批退款」时一查就知道。
- `"refund_approve": "主管审批,客服不能自己批",` 这一条不光是省 token,还是权限问题。客服 Agent 手里有审批工具,就意味着一句「帮我把这笔退款批了」可能真的被执行。第七部分讲安全时会专门讲「最小权限」,今天先在这里种个印象。
- `"billing_currency_convert": "云簿只有人民币客户",` 这种是「某天某人觉得以后可能用得上」加进来的工具,实际没人用。
- `KEPT = [n for n in SCHEMAS if n not in DROP]` 留下的工具名列表。`n not in DROP` 对字典判断的是 key,相当于 JS 的 `!(n in DROP)`。后面的路由会用它。
- `print(f"  - {name:<26} {why}")` `:<26` 是左对齐、补到 26 个字符宽,让输出排成整齐的两列,相当于 JS 的 `padEnd(26)`。

</div>

```bash
uv run python -m part03.prune
```

```text
砍掉 10 个,剩 50 个
  - refund_approve             主管审批,客服不能自己批
  - refund_list_pending        主管的待办列表
  - report_revenue_monthly     内部财务报表
  - report_churn               内部经营指标
  - notify_slack_oncall        内部报警,不该由客服对话触发
  - kb_suggest_edit            运营改文档用
  - kb_feedback_stats          运营看数据用
  - kb_popular                 运营看数据用
  - kb_list_categories         有 kb_search 就够了
  - billing_currency_convert   云簿只有人民币客户
```

量一下砍完省了多少:

```python
# agent-zero-lab/part03/measure_prune.py  砍完 10 个以后,工具定义还剩多少 token
from common.llm import LLMClient
from part03.catalog import SCHEMAS
from part03.prune import KEPT

llm = LLMClient()
msgs = [{"role": "user", "content": "user007@example.com 说 10 月被扣了两次款,帮我核实一下。"}]
full = llm.chat(msgs, max_tokens=1, tools=list(SCHEMAS.values())).prompt_tokens
kept = llm.chat(msgs, max_tokens=1, tools=[SCHEMAS[n] for n in KEPT]).prompt_tokens
print(f"60 个: {full} | 砍到 {len(KEPT)} 个: {kept} | 少了 {full - kept} ({(full - kept) / full:.0%})")
print(llm.ledger)
```

<div class="line-notes">

- `full = llm.chat(msgs, max_tokens=1, tools=list(SCHEMAS.values())).prompt_tokens` 链式写法:调用完直接取 `.prompt_tokens`。`SCHEMAS.values()` 是全部 60 个 schema。
- `kept = llm.chat(msgs, max_tokens=1, tools=[SCHEMAS[n] for n in KEPT]).prompt_tokens` 只挂留下的 50 个。
- `print(f"60 个: {full} | 砍到 {len(KEPT)} 个: {kept} | 少了 {full - kept} ({(full - kept) / full:.0%})")` `:.0%` 把小数格式化成百分数,0.137 显示成 14%。

</div>

```text
60 个: 4485 | 砍到 50 个: 3869 | 少了 616 (14%)
2 次调用 | 输入 8354 / 输出 2 tokens | 约 ¥0.0049
```

少了 14%。不算多,但它是**零风险**的:砍掉的工具客服 Agent 本来就不该用,连带着把权限也收紧了。这一步任何时候都该先做。

## 便宜办法二:合并相近的

`subscription_cancel`、`subscription_pause`、`subscription_toggle_autorenew` 三个工具都是在改「订阅怎么续费」,可以合成一个带 `action` 参数的 `subscription_set_renewal`。这就是 [Day 182](/blog/agent-zero/day-182-tool-design-2/) 原则四说的「能枚举就枚举」:`action` 用 `Literal` 限定成四个值,模型填不出第五种。

合并能省多少?我本以为能省一大半,实测(练习 2)三个旧工具 445 个 token,合并后 400 个,只省了 45 个。原因是合并后的描述要把四种动作都讲清楚,参数说明变长了,省下的主要是那两份「重复的外壳」(名字、`type`、`required` 这些)。

所以合并的价值主要不在省 token,而在**减少相似选项**:模型不用再在三个长得很像的名字之间犹豫。合并也有代价:一个工具干的事多了,权限就不好细分。比如你想让客服能暂停订阅、但取消订阅必须人工确认,合并成一个工具后就得在 `action` 上再做判断。我的经验是,只合并「同一个对象、同一种风险级别」的操作。

## 便宜办法三:先分类,再只挂这一类的工具

前两个办法都是一次性的改造,改完工具还是有 50 个。第三个办法是在运行时缩小范围:**先花一次很便宜的模型调用,判断这个请求属于哪个领域,再只把这个领域的工具挂给 Agent。**

这种「先分类再分流」的做法叫路由(routing),[Day 198](/blog/agent-zero/day-198-routing/) 讲工作流模式时会专门讲。今天只用它最简单的样子:一次 JSON mode 的调用,输出领域名。

我们的工具名都是「领域_动作」,`invoice_list` 的前缀 `invoice` 就是它的领域,所以按前缀分组一行代码就够了。[Day 182](/blog/agent-zero/day-182-tool-design-2/) 坚持命名空间的好处在这里兑现了。

```python
# agent-zero-lab/part03/route_then_tools.py  便宜办法三:先花一次小调用判断领域,再只挂这个领域的工具
import json
import sys

from common.llm import LLMClient
from part03.agent_loop import run_agent
from part03.catalog import Catalog
from part03.prune import KEPT

DOMAINS = {
    "customer": "客户资料:查找、改联系方式、合并、注销",
    "subscription": "订阅:套餐、席位、取消、暂停、自动续费",
    "invoice": "发票:列表、PDF、抬头、作废、重发、标记已付",
    "refund": "退款:提交申请、查进度、撤回、年付退款计算",
    "ticket": "工单:新建、查看、回复、转派、关闭、搜历史",
    "kb": "帮助中心:搜文章、读全文",
    "account": "账号安全:重置密码、两步验证、登录记录、解锁、成员",
    "report": "报表:导出状态、重新导出、席位使用率、导入错误码",
    "notify": "通知:邮件、短信、预约提醒、退订、通知历史",
    "billing": "计费:优惠券、余额、换绑卡、重新扣款、税率",
}
LIST = "\n".join(f"{k}: {v}" for k, v in DOMAINS.items())
ROUTER_ONE = "把客服请求归到下面的一个领域,只输出 JSON:{\"domains\": [\"领域名\"]}。\n" + LIST
ROUTER_MULTI = ("把客服请求归到下面的领域。处理这个请求可能要用到几个领域就列几个,最多 3 个,"
                "只输出 JSON:{\"domains\": [\"领域名\", ...]}。\n" + LIST)
SYSTEM = "你是云簿 CloudLedger 的客服助手,先用工具核实事实再回答。金额字段单位是分,回答时换算成元。"


def route(llm: LLMClient, text: str, prompt: str) -> list[str]:
    r = llm.chat([{"role": "system", "content": prompt}, {"role": "user", "content": text}],
                 response_format={"type": "json_object"}, max_tokens=40)
    return json.loads(r.content)["domains"]


if __name__ == "__main__":
    multi = "--multi" in sys.argv
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    task = args[0] if args else "user007@example.com 说 10 月被扣了两次款,帮我核实一下。"
    router = LLMClient()
    domains = route(router, task, ROUTER_MULTI if multi else ROUTER_ONE)
    names = ["customer_find"] + [n for n in KEPT if n.split("_")[0] in domains and n != "customer_find"]
    print(f"路由 -> {domains} | 挂 {len(names)} 个工具 | 路由花费 {router.ledger}")
    answer, llm = run_agent(Catalog(names), SYSTEM, task, max_steps=8)
    print("== 回答\n" + answer[:300])
    print("Agent:", llm.ledger)
```

<div class="line-notes">

- `DOMAINS = {` 十个领域,key 是工具名前缀,value 是给路由模型看的一句话说明。说明里列的是「这个领域能干什么」,而不是工具名,因为用户的话和动作描述更接近。
- `"billing": "计费:优惠券、余额、换绑卡、重新扣款、税率",` 注意「重新扣款」在 billing,而「查重复扣款」靠的 `invoice_list` 在 invoice。下面的实跑就栽在这里。
- `LIST = "\n".join(f"{k}: {v}" for k, v in DOMAINS.items())` 把十个领域拼成十行文本。`"\n".join(...)` 相当于 JS 的 `arr.join("\n")`,只是 Python 把分隔符写在前面。
- `ROUTER_ONE = "把客服请求归到下面的一个领域,只输出 JSON:{\"domains\": [\"领域名\"]}。\n" + LIST` 第一版:只许选一个领域。字符串里的 `\"` 是转义的双引号。输出格式固定成 `domains` 列表,这样两版提示词可以共用一个解析函数。
- `ROUTER_MULTI = ("把客服请求归到下面的领域。处理这个请求可能要用到几个领域就列几个,最多 3 个,"` 第二版:允许多选,最多 3 个。外面的圆括号让两行字符串自动拼成一个,相当于 JS 里用 `+` 连两行。
- `r = llm.chat([{"role": "system", "content": prompt}, {"role": "user", "content": text}],` 路由是一次独立的调用,不挂任何工具,所以只有两三百个 token。
- `response_format={"type": "json_object"}, max_tokens=40)` [Day 148](/blog/agent-zero/day-148-structured-2/) 的 JSON mode,保证输出能被 `json.loads` 解析。`max_tokens=40` 防止它啰嗦。
- `return json.loads(r.content)["domains"]` 返回领域名列表,比如 `['billing']`。
- `args = [a for a in sys.argv[1:] if not a.startswith("--")]` 命令行里不以 `--` 开头的参数当作任务文本,这样可以在命令行换别的问题试(练习 3)。
- `domains = route(router, task, ROUTER_MULTI if multi else ROUTER_ONE)` 路由用单独一个 `LLMClient`,账本分开记,能看清路由本身花了多少。
- `names = ["customer_find"] + [n for n in KEPT if n.split("_")[0] in domains and n != "customer_find"]` 两部分拼起来:`customer_find` 几乎每张工单都要用,不管路由到哪都常驻;再加上被选中领域的工具。`n.split("_")[0]` 取第一个下划线前面的部分,`"invoice_list"` 得到 `"invoice"`。用的是砍过的 `KEPT`,所以办法一和办法三叠加了。
- `answer, llm = run_agent(Catalog(names), SYSTEM, task, max_steps=8)` 后面和第三步完全一样,只是挂的工具少了。

</div>

先跑只选一个领域的版本:

```bash
uv run python -m part03.route_then_tools
```

```text
路由 -> ['billing'] | 挂 6 个工具 | 路由花费 1 次调用 | 输入 256 / 输出 9 tokens | 约 ¥0.0006
[step 1] 输入 677 tok | 输出 50 tok
    调用 customer_find({"query": "user007@example.com"}) -> 返回 81 字符
[step 2] 输入 771 tok | 输出 43 tok
    调用 billing_credit_balance({"customer_id": "C007"}) -> 返回 58 字符
[step 3] 输入 850 tok | 输出 263 tok
== 回答
我查到了客户信息:刘静(半岛咖啡),客户 ID 为 C007,邮箱 user007@example.com。

不过需要跟你说明:我这边能用的工具只有客户查询、优惠券、余额与抵扣额度查询、更换支付方式、重试扣款和税率查询,**没有查询历史扣款记录或发票流水的接口**,所以没法直接核实"10月被扣了两次款"这件事。……
Agent: 3 次调用 | 输入 2298 / 输出 356 tokens | 约 ¥0.0042
```

便宜是真便宜,路由加 Agent 一共不到半分钱。**但答案错了。**「被扣了两次款」里有「扣款」两个字,路由模型就把它归到了 billing(计费:……重新扣款……)。可查重复扣款要靠的 `invoice_list` 在 invoice 组,没被挂上。

最该看的是 Agent 的反应。它没有报错,没有乱编,而是非常诚实、非常合理地告诉你:「我没有查询发票流水的接口」。如果你只看这一条回答,你会以为后台真的没有这个功能。**工具没挂上,在模型眼里就等于不存在。** 这是路由、明天的工具检索,以及一切「按需挂工具」方案共同的失败方式,而且它是静默的:没有异常,没有 400,日志里一切正常。

我第一次跑到这里的时候,下意识地去改路由的提示词,想把「扣款」的说明写得更清楚。后来想明白了,问题不在说明写得不好,而在「只许选一个」本身:一个客服请求经常跨领域,核实重复扣款要查客户、查发票,确认后还要提退款,三个领域。

改成多选版,同一个问题再跑:

```bash
uv run python -m part03.route_then_tools --multi
```

```text
路由 -> ['billing', 'invoice'] | 挂 12 个工具 | 路由花费 1 次调用 | 输入 274 / 输出 12 tokens | 约 ¥0.0006
[step 1] 输入 1093 tok | 输出 48 tok
    调用 customer_find({"query": "user007@example.com"}) -> 返回 81 字符
[step 2] 输入 1185 tok | 输出 39 tok
    调用 invoice_list({"customer_id": "C007"}) -> 返回 282 字符
[step 3] 输入 1357 tok | 输出 268 tok
== 回答
已核实,确实存在重复扣款的情况。
……
两张发票金额完全相同(均为 2,392.00 元),开票日期也是同一天 2026-10-08,基本可以确认是同一次订阅被重复开了票并重复扣款,合计多收了 **2,392.00 元**。
……
Agent: 3 次调用 | 输入 3635 / 输出 355 tokens | 约 ¥0.0056
```

这次路由选了 billing 和 invoice 两个领域,挂上 12 个工具,`invoice_list` 在里面,答对了。总输入 3,635 加路由的 274,不到全挂 60 个(19,132)的五分之一,也没有乱调无关工具。

<figure>
<svg viewBox="0 0 640 230" role="img" aria-label="先路由再挂工具的流程:路由调用输出领域列表,按前缀从50个工具里挑出对应组,再交给Agent循环">
  <rect x="0" y="0" width="640" height="230" fill="var(--paper-raised)" rx="6"/>
  <rect x="20" y="40" width="130" height="50" fill="var(--paper)" stroke="var(--rule)" rx="4"/>
  <text x="85" y="62" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">用户请求</text>
  <text x="85" y="79" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">被扣了两次款</text>
  <line x1="150" y1="65" x2="180" y2="65" stroke="var(--rule)"/>
  <rect x="180" y="40" width="140" height="50" fill="var(--mem-wash)" stroke="var(--mem)" rx="4"/>
  <text x="250" y="62" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">路由调用</text>
  <text x="250" y="79" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">约 270 token</text>
  <line x1="320" y1="65" x2="350" y2="65" stroke="var(--rule)"/>
  <rect x="350" y="40" width="270" height="50" fill="var(--compute-wash)" stroke="var(--compute)" rx="4"/>
  <text x="485" y="62" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">按前缀挑工具</text>
  <text x="485" y="79" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">customer_find + billing_* + invoice_*</text>
  <line x1="485" y1="90" x2="485" y2="120" stroke="var(--rule)"/>
  <rect x="300" y="120" width="320" height="50" fill="var(--mem-wash)" stroke="var(--mem)" rx="4"/>
  <text x="460" y="142" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">run_agent,只挂 12 个工具</text>
  <text x="460" y="159" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">每步约 1,100 token,而不是 4,500</text>
  <rect x="20" y="120" width="250" height="50" fill="var(--paper)" stroke="var(--rule)" rx="4"/>
  <text x="145" y="142" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">只选一个领域时</text>
  <text x="145" y="159" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">billing 里没有 invoice_list</text>
  <text x="320" y="205" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">没挂上的工具,在模型眼里就等于不存在:它会说「我没有这个能力」</text>
</svg>
<figcaption>路由把一个 50 选 N 的问题,变成先做一道 10 选 1 到 3 的选择题。选择题答错了,后面整个 Agent 都看不到那个工具。</figcaption>
</figure>

多选不是万能药。领域选多了,省得就少;请求里的说法和领域说明差得远,还是会选错。练习 3 换了个问题「C023 想把年付取消掉,能退多少钱?」,单选版只选了 refund,Agent 没办法先查订阅;多选版选了 subscription 和 refund,才查到了订阅信息。

## 什么时候这些办法就不够了

把三种办法排一下:

| 办法 | 一次性改造还是运行时 | 省多少(今天实测) | 主要风险 |
| --- | --- | --- | --- |
| 砍掉用不上的 | 一次性 | 60 → 50 个,少 14% | 几乎没有,还顺便收紧了权限 |
| 合并相近的 | 一次性 | 3 → 1 个,只少 45 token | 一个工具权限太粗 |
| 先分类再挂 | 运行时,多一次小调用 | 19,132 → 约 3,900 | 分错领域,工具静默消失 |

我的顺序是:**先砍,再合并,再看要不要路由。** 前两步做完,工具如果只剩二三十个、而且领域边界清楚(客服、财务、运维各是各的应用),做到路由就够了,甚至不用路由,直接全挂。

但有两种情况,路由会吃力。一是工具很多、领域很多,比如接了十几个 MCP server、几百个工具,一个领域说明表就写不下了。二是一个请求经常横跨好几个领域,路由要么选不全,要么全选上(那就等于没路由)。

这时候需要更细的粒度:**不按领域挑,按单个工具挑**。让模型自己说「我现在需要一个能干 X 的工具」,我们从全部工具里检索出最像的几个,当场挂上。这就是明天要做的工具检索。Anthropic 和 OpenAI 都在 API 里内置了这个能力,Claude Code 接 MCP 工具时默认也是这么做的,明天会一起看。

## 动手练习

### 练习 1:固定开销和每个工具的边际开销

改写 `measure_tools.py`,同一句「你好」分别挂前 1、10、30、60 个工具,打印每次工具部分的 token,并用第一个点和最后一个点算出「每多一个工具多多少 token」和「固定开销」。看看 1 到 60 是不是一条直线。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part03/measure_linear.py  练习 1:挂 1、10、30、60 个,看是不是一条直线
from common.llm import LLMClient
from part03.catalog import SCHEMAS

names = list(SCHEMAS)
llm = LLMClient()
msgs = [{"role": "user", "content": "你好"}]
base = llm.chat(msgs, max_tokens=1).prompt_tokens
points = []
for n in (1, 10, 30, 60):
    t = llm.chat(msgs, max_tokens=1, tools=[SCHEMAS[x] for x in names[:n]]).prompt_tokens - base
    points.append((n, t))
    print(f"挂 {n:2} 个 -> 工具部分 {t} token")
(n1, t1), (n2, t2) = points[0], points[-1]
slope = (t2 - t1) / (n2 - n1)
print(f"每多一个工具约 {slope:.1f} token,固定开销约 {t1 - slope:.0f} token")
print(llm.ledger)
```

<div class="line-notes">

- `names = list(SCHEMAS)` 60 个名字,顺序和 `SPECS` 一样,所以「前 10 个」就是客户领域 6 个加订阅领域前 4 个。
- `base = llm.chat(msgs, max_tokens=1).prompt_tokens` 不挂工具的基准。「你好」两个字加上消息格式,实测是 5。
- `for n in (1, 10, 30, 60):` 四个点。`(1, 10, 30, 60)` 是元组,遍历时和列表一样用。
- `t = llm.chat(msgs, max_tokens=1, tools=[SCHEMAS[x] for x in names[:n]]).prompt_tokens - base` `names[:n]` 取前 n 个,切片和 JS 的 `slice(0, n)` 一样。
- `(n1, t1), (n2, t2) = points[0], points[-1]` 一次解构两个二元组,`points[-1]` 是最后一个元素,相当于 JS 的 `points.at(-1)`。
- `slope = (t2 - t1) / (n2 - n1)` 斜率:每多一个工具多多少 token。这里是 (4460 − 291) / 59。
- `print(f"每多一个工具约 {slope:.1f} token,固定开销约 {t1 - slope:.0f} token")` 挂 1 个时的 291 减掉一个工具自己的份,剩下的就是固定开销。

</div>

```bash
uv run python -m part03.measure_linear
```

```text
挂  1 个 -> 工具部分 291 token
挂 10 个 -> 工具部分 989 token
挂 30 个 -> 工具部分 2429 token
挂 60 个 -> 工具部分 4460 token
每多一个工具约 70.7 token,固定开销约 220 token
5 次调用 | 输入 8194 / 输出 5 tokens | 约 ¥0.0021
```

用 220 + 70.7 × n 验算中间两个点:n = 10 时是 927,实测 989;n = 30 时是 2,341,实测 2,429。基本是直线,中间偏高一点,因为前 30 个工具里客户、订阅、发票领域的描述和参数比后面的长一些。结论:**固定开销只付一次,之后成本跟工具数量成正比**,每个工具的份额取决于它的描述和参数写了多长。

</details>

### 练习 2:合并三个续费工具

用 `ToolRegistry` 和 `@merged.tool` 写一个 `subscription_set_renewal`,`action` 参数用 `Literal` 限定成 `cancel`、`pause`、`autorenew_on`、`autorenew_off`,再量一下三个旧工具和它各占多少 token。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part03/merge_tools.py  练习 2:三个续费相关工具合成一个带 action 参数的工具
from typing import Annotated, Literal

from common.llm import LLMClient
from part03.agent_loop import ToolRegistry
from part03.catalog import SCHEMAS

merged = ToolRegistry()


@merged.tool
def subscription_set_renewal(
    customer_id: Annotated[str, "客户 ID"],
    action: Annotated[Literal["cancel", "pause", "autorenew_on", "autorenew_off"],
                      "cancel 当期结束后不再续费;pause 暂停最多 3 个月不扣费;autorenew_on/off 开关自动续费"],
    months: Annotated[int, "只在 pause 时用,暂停几个月,1 到 3"] = 1,
) -> dict[str, str]:
    """修改订阅的续费方式:取消、暂停、开关自动续费。客户说「不想续了」「先停几个月」「别自动扣了」时用。"""
    return {"ok": "演示桩"}


OLD = ["subscription_cancel", "subscription_pause", "subscription_toggle_autorenew"]
llm = LLMClient()
msgs = [{"role": "user", "content": "你好"}]
base = llm.chat(msgs, max_tokens=1).prompt_tokens
three = llm.chat(msgs, max_tokens=1, tools=[SCHEMAS[n] for n in OLD]).prompt_tokens - base
one = llm.chat(msgs, max_tokens=1, tools=merged.schemas).prompt_tokens - base
print(f"三个旧工具 {three} token | 合并后一个 {one} token")
print(llm.ledger)
```

<div class="line-notes">

- `merged = ToolRegistry()` 用回 Day 168 的装饰器写法,`Annotated` 和 `Literal` 会被 [Day 169](/blog/agent-zero/day-169-tool-registry-2/) 的注册表自动转成 `description` 和 `enum`。
- `action: Annotated[Literal["cancel", "pause", "autorenew_on", "autorenew_off"],` 四种动作写成枚举。原来 `subscription_toggle_autorenew` 的 `on` 参数是「true 打开 false 关闭」的字符串,模型可能填 `"是"`、`"open"`,现在不可能了。
- `months: Annotated[int, "只在 pause 时用,暂停几个月,1 到 3"] = 1,` 只有一种动作用得到的参数,只能在说明里写清楚。这就是合并的代价之一:参数之间有了「只在某种情况下有意义」的关系。
- `"""修改订阅的续费方式:取消、暂停、开关自动续费。客户说「不想续了」「先停几个月」「别自动扣了」时用。"""` 描述里写上用户的说法,明天做检索时这类句子很有用。
- `three = llm.chat(msgs, max_tokens=1, tools=[SCHEMAS[n] for n in OLD]).prompt_tokens - base` 三个旧工具一起挂。注意这里包含了一份固定开销,下一行也包含一份,所以相减时固定开销抵消了。

</div>

```bash
uv run python -m part03.merge_tools
```

```text
三个旧工具 445 token | 合并后一个 400 token
3 次调用 | 输入 860 / 输出 3 tokens | 约 ¥0.0017
```

只省了 45 个 token,一成。合并后的描述和参数说明要把四种动作都讲清楚,比三个旧工具加起来短不了多少。合并的收益主要是选项少了、参数不会填错,而不是省钱。

</details>

### 练习 3:路由的另一个盲区

用 `route_then_tools.py` 跑「C023 想把年付取消掉,能退多少钱?」,分别不带和带 `--multi`。看路由选了什么领域,Agent 能不能查到订阅信息。

<details><summary>参考答案</summary>

命令(问题用引号包起来,作为一个参数传进去):

```bash
uv run python -m part03.route_then_tools "C023 想把年付取消掉,能退多少钱?"
uv run python -m part03.route_then_tools --multi "C023 想把年付取消掉,能退多少钱?"
```

单选版:

```text
路由 -> ['refund'] | 挂 5 个工具 | 路由花费 1 次调用 | 输入 248 / 输出 9 tokens | 约 ¥0.0006
[step 1] 输入 635 tok | 输出 84 tok
    调用 customer_find({"query": "C023"}) -> 返回 81 字符
    调用 refund_calc_annual({"customer_id": "C023"}) -> 返回 54 字符
[step 2] 输入 796 tok | 输出 206 tok
== 回答
您好,我查到了客户信息:
- **客户**:王磊(C023,青禾设计,user023@example.com)
不过关于退款金额,我这边需要说明一下:**年付中途取消的退款测算工具目前返回的是演示数据,并没有真正执行计算**……
Agent: 2 次调用 | 输入 1431 / 输出 290 tokens | 约 ¥0.0037
```

多选版:

```text
路由 -> ['subscription', 'refund'] | 挂 11 个工具 | 路由花费 1 次调用 | 输入 266 / 输出 13 tokens | 约 ¥0.0006
[step 1] 输入 1113 tok | 输出 87 tok
    调用 subscription_get({"customer_id": "C023"}) -> 返回 107 字符
    调用 refund_calc_annual({"customer_id": "C023"}) -> 返回 54 字符
[step 2] 输入 1288 tok | 输出 257 tok
== 回答
我先核实了一下 C023 的情况:
- **套餐**:企业版,20 个席位,年付,状态正常
- **本期结束日**:2027-03-31
不过很抱歉,**退款金额我这边没能算出来**——计算年付中途取消退款的接口这次返回的是一个演示桩……
Agent: 2 次调用 | 输入 2401 / 输出 344 tokens | 约 ¥0.0050
```

`refund_calc_annual` 是演示桩,两版都算不出金额,这是预期的。区别在单选版只选了 refund,订阅相关的工具一个没挂,Agent 连套餐、到期日都查不到;多选版把 subscription 也选上了,第一步就并行查了订阅。「取消年付」字面上属于订阅,「能退多少」字面上属于退款,一个请求同时踩两个领域,只许单选就必然丢一个。

</details>

### 练习 4:算一笔账(不用写代码)

假设云簿每天 1 万张工单,每张平均 4 步。比较「全挂 60 个」和「先砍到 50 个再多选路由,平均挂 12 个」两种方案每天在**工具定义**上的输入 token,并按 `deepseek-flash` 高峰价算出「全没命中缓存」时的花费。路由调用本身每次约 270 个输入 token,也要算上。

<details><summary>参考答案</summary>

用练习 1 的直线:工具部分 ≈ 220 + 71 × n。

```text
全挂 60 个:  (220 + 71 × 60) × 4 步 × 10,000 = 4,480 × 40,000 ≈ 1.79 亿 token
路由后 12 个:(220 + 71 × 12) × 4 步 × 10,000 = 1,072 × 40,000 ≈ 0.43 亿 token
路由调用:    270 × 10,000 = 0.027 亿 token
合计:        约 0.46 亿 token

全没命中缓存时:
全挂 60 个:  1.79 亿 × 2 元/百万 ≈ 358 元/天
路由方案:    0.46 亿 × 2 元/百万 ≈ 92 元/天
```

每天省 260 元左右,一个月七八千。这是最坏情况的估算,实际有缓存命中会少得多;但工具列表变化越频繁,缓存越难命中,路由方案的省钱幅度在真实环境里反而可能更接近这个数。另外别忘了这笔账只算了钱,没算分错领域导致的错答,那部分要靠评测来量(明天会做)。

</details>

**验收标准**:练习 1 打印出四个点和斜率,能说出「固定开销」和「边际开销」各是什么;练习 2 有三个旧工具和合并后的 token 对比;练习 3 能指出单选路由在哪一步丢了工具;练习 4 写出算式和每天的钱数。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 工具定义 / tool schema | 随请求发给模型的工具说明书:名字、描述、参数的 JSON Schema。[Day 157](/blog/agent-zero/day-157-tool-schema/) 首次出现。每一步都要重发 |
| 固定开销 | 只要挂了工具就要付的那部分 token,和挂几个无关。今天实测约 220 个 |
| 边际开销 | 每多挂一个工具多出来的 token。今天的工具平均约 71 个,描述越长越多 |
| 演示桩(stub) | 只返回固定内容、不做真事的假实现,和前端的 mock 接口一个意思 |
| 前缀缓存 | 厂商对「和之前请求开头完全一样的那段」按便宜很多的价格收费。[Day 124](/blog/agent-zero/day-124-cost/) 首次出现。工具定义在最前面,所以容易命中;工具列表一变就失效 |
| 路由(routing) | 先用一次便宜的分类调用判断请求属于哪一类,再按类别决定后面怎么处理。今天用它决定挂哪组工具,[Day 198](/blog/agent-zero/day-198-routing/) 细讲 |
| 领域 / 命名空间前缀 | 工具名里下划线前面那段,比如 `invoice_list` 的 `invoice`。今天用它给工具分组 |
| 最小权限 | 一个程序只拿它完成任务必需的权限。客服 Agent 不该有审批退款的工具。第七部分细讲 |

## 常见误区

**以为工具定义只在第一次请求时发。** 模型没有记忆([Day 129](/blog/agent-zero/day-129-messages/)),每一步都是一次全新的请求,工具定义每一步都要重发。今天四步的任务,60 个工具的说明书被发了四遍,共约 1.8 万个 token。

**拿 `json.dumps` 的字符数当 token 数。** 60 个工具 15,571 个字符,DeepSeek 数出来是 4,460 个 token,大约 3.5 个字符一个 token,但中英文混排、JSON 标点多少都会让这个比例变。要准,就用 `max_tokens=1` 让服务端数。

**看到账单上的钱不多,就觉得工具多也无所谓。** 前缀缓存让工具定义的钱便宜了五十倍,但省不掉上下文,也省不掉选择的难度。今天全挂 60 个时模型多调了 5 个跟任务无关的工具,就是选项太多的代价。

**路由只许选一个类别。** 客服请求经常跨领域。今天「被扣了两次款」被单选路由分到 billing,`invoice_list` 没挂上,Agent 直接说「我没有查发票的接口」。路由至少允许多选,并且要在评测里专门检查「该用的工具有没有被挂上」。

**看到 Agent 说「我没有这个功能」就相信。** 在按需挂工具的系统里,这句话很可能只是「这次没挂上」。它不会报错,日志一切正常。上线前一定要准备几条「明确需要某个工具」的测试题,看它有没有被调用。

**以为合并工具能大幅省 token。** 实测三合一只省了一成。合并的好处是少了相似选项、参数不易填错,省钱是次要的;代价是权限变粗。

## 学习资料

### 文档与文章

- [Claude 文档 · Tool search tool](https://platform.claude.com/docs/en/agents-and-tools/tool-use/tool-search-tool):开头两段讲工具多了的两个问题(上下文膨胀、选择准确率),「When to use tool search」一节给了什么时候值得上的几条线(10 个以上工具、定义超过 10k token 等),今天读这两部分,其余明天读。2026 年 10 月查,英文。
- [Anthropic · Introducing advanced tool use on the Claude Developer Platform](https://www.anthropic.com/engineering/advanced-tool-use):2025 年 11 月 24 日,讲五个 MCP server 58 个工具约 55k token 的例子,以及他们的内部评测里工具变多后选择准确率的变化,英文。
- [arXiv · RAG-MCP: Mitigating Prompt Bloat in LLM Tool Selection via Retrieval-Augmented Generation](https://arxiv.org/abs/2505.03275):2025 年 5 月的论文,在大量 MCP 工具里选一个,全部塞给模型时选对率 13.62%,先检索再给是 43.13%,prompt token 少一半以上。实验设置比较极端,数字不用记,看摘要和第一张图理解方向就行,英文。
- [DeepSeek 模型与价格](https://api-docs.deepseek.com/zh-cn/quick_start/pricing):核对缓存命中和未命中的价格,今天的算账都基于它,中文。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1rP8M6qESJ&autoplay=0&high_quality=1" title="工具越多，上下文越少？mcptoon 把 MCP 按需加载" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>锋芒AI · 工具越多,上下文越少?mcptoon 把 MCP 按需加载 · 1 分多钟的短介绍,讲的正是今天的问题和明天的解法方向。视频里「少用 97% token」是项目方自己的口径,当作二手数字听。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/7QUj_vXkivg" title="How Anthropic Fixed MCP Context Bloat Issue" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>KodeKloud · How Anthropic Fixed MCP Context Bloat Issue · 讲 MCP 工具定义怎么把上下文撑满,以及 Anthropic 的应对。前半段对应今天,后半段是明天的预习。英文。</figcaption>
</figure>

### 书籍

- Chip Huyen《AI Engineering》(O'Reilly, 2025):第 6 章讲 Agent 的部分有一节讨论工具清单(tool inventory)多了以后的取舍,第 9 章讲推理成本优化,可以对照今天的算账,英文。

### 开源项目与代码

- [modelcontextprotocol/servers](https://github.com/modelcontextprotocol/servers):MCP 官方的 server 合集。随便点开一个看它暴露了多少个工具、每个描述写了多长,对「一个 server 就是一大包工具」会有直观感受。

## 自测

1. 同一句话不挂工具是 25 个 prompt token,挂 1 个工具变成 316,挂 2 个是 389。为什么第一个工具「贵」那么多?

<details><summary>答案</summary>

挂了工具之后,服务端会把工具列表包进一段固定格式的说明里再交给模型,这段包装是只要挂了工具就要付的固定开销,今天算出来约 220 个 token。第一个工具的 291 里包含了这份固定开销加它自己约 71 个;第二个工具只多付自己那一份,所以只多 73。

</details>

2. 全挂 60 个工具的四步任务输入 19,132 个 token,只挂 3 个是 1,943 个,差近十倍,可花费只差三倍多(¥0.0157 对 ¥0.0046)。钱的差距为什么小?缓存省掉了哪些代价、没省掉哪些?

<details><summary>答案</summary>

工具定义放在每次请求的最前面,而且每一步都不变,从第二步开始大多命中了前缀缓存,按 0.04 元而不是 2 元每百万收费,反推约 1.4 万个 token 命中。缓存省掉的是钱;省不掉的是上下文占用(4,460 个 token 照样在模型面前)和选择难度(全挂时模型多调了 5 个无关工具)。另外工具列表一变,缓存就失效。

</details>

3. 单选路由把「被扣了两次款」分到 billing 后,Agent 回答「我没有查询发票流水的接口」。这个回答本身有错吗?问题出在哪?怎么在上线前发现这类问题?

<details><summary>答案</summary>

回答本身是诚实的:在它看到的 6 个工具里确实没有查发票的。问题出在路由只许选一个领域,而查重复扣款要用 invoice 组的 `invoice_list`。没挂上的工具在模型眼里就等于不存在,这种失败没有报错,很难从日志里发现。上线前要准备「明确需要某个工具」的测试题,检查该工具最后有没有被调用,而不是只看回答像不像样。

</details>

4. 「先砍、再合并、再路由」这三步,为什么砍要放在最前面?

<details><summary>答案</summary>

砍掉的是这个 Agent 本来就不该用的工具,零风险,还顺便收紧了权限(比如客服不该有 `refund_approve`)。合并和路由都有代价:合并让权限变粗,路由可能分错领域。先做零风险的,剩下的工具少了,后两步也更好做。

</details>

5. 面试题:你的 Agent 接了 5 个 MCP server,一共 150 个工具,用户反馈「又慢又贵,有时还说没有某个功能」。你会怎么排查和优化?

<details><summary>答案</summary>

先量:用 `max_tokens=1` 量出工具定义占多少 token、占上下文窗口的比例,统计一个典型任务平均几步,算出工具定义每天的总 token 和花费。再看轨迹:有没有调用和任务无关的工具(选项太多的信号)、「没有某个功能」出现时那个工具是不是根本没挂上。优化按风险从低到高:砍掉这个应用用不上的工具(也是收权限),合并同对象同风险的操作,然后按领域路由(允许多选)或者按单个工具做检索(明天讲),厂商支持的话直接用原生的 Tool Search。每一步改完都要用一批带「应调用工具」标注的测试题回归,确认没把该用的工具弄丢。

</details>

## 明天预告

明天是 **Day 185 · 工具多了怎么办(二):自己实现工具检索和评测**。今天的路由是按「领域」挑工具,粒度太粗,一个请求跨几个领域就容易丢。明天换成按「单个工具」挑:开局只给模型一个 `search_tools`,它说要什么,我们从 60 个工具里检索出最像的几个当场挂上。会用两种检索方式(按关键词和按意思)各做一个,用 30 句客服原话测一测谁选得准,再看一次真实轨迹里检索漏掉一个工具时,模型会怎么「合理地」放弃。
