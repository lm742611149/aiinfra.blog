---
title: 'Day 368 · 自动优化提示词(一):手调的天花板,DSPy、GEPA、ACE 是什么'
description: '手调 prompt 的那套「看错例、猜规则、加一句、再跑一遍」,调到第三四版就开始打地鼠。今天准备一份 60 条的工单分类数据,规则只写在标注理由里;写好两个起点 prompt 和评测函数,实测手调三版:加一句「钱优先」修好 2 条、带坏 6 条。再认识三个名字:DSPy 是框架,GEPA 是读文字反馈改写 prompt 的优化器,ACE 是只往手册里加条目的思路。'
pubDate: 2026-10-23
regime: none
tags: ['prompt-optimization', 'eval', 'dspy', 'agent-zero']
series: 'agent-zero'
day: 368
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 367](/blog/agent-zero/day-367-tracing-views/) 在一批 trace 上算了五个视图:最慢的、最贵的、各项评测的失败率、客户点踩的、单张成本的分布,顺着视图点进 C023 的三张工单,发现该改的是评测而不是 Agent。后半天数了一下客户的手机号在 trace 里被存了几遍,用 `mask` 在数据离开进程前把它换掉。

到这里,评测和可观测这一块的「量」已经齐了:有测试集、有判题器和 LLM 评分器、有 trace 和分数。量出问题以后要改,改得最多的就是 prompt。前面几个月我们一直是手改,今天先把手改的天花板摸出来,再认识三个想把「改 prompt」交给程序的名字。

## 今天要解决的问题

学完今天你应该能:

1. 说清楚手调 prompt 到后期为什么会「修一条坏两条」,并用自己的数据实测一次。
2. 准备一份能给优化器用的数据:带标签、带标注理由,按固定规则分成训练集、验证集、测试集,知道每一份是干什么的。
3. 写出 `opt_task.py`:两个起点 prompt、一个分类函数、一个评测函数,能在 20 条上量出准确率和错例,并知道一条工单就是 5 个百分点的噪声。
4. 用自己的话讲清楚 DSPy、GEPA、ACE 各是什么,三者是什么关系。

今天两个新概念:**自动 prompt 优化**这件事本身(它需要哪三样东西),以及 **DSPy、GEPA、ACE** 这三个名字。明天才动手跑优化器,今天把数据和尺子准备好。

预计用时 2.5 小时。实跑花费:`opt_task.py` 跑了 4 遍(约 0.066 元),`hand_tune.py` 跑了 2 遍(约 0.118 元),练习三道约 0.078 元,合计约 0.26 元,算式在各段末尾。前置:[Day 136](/blog/agent-zero/day-136-llm-client-2/) 的 `common/llm.py` 里的 `LLMClient`;[Day 148](/blog/agent-zero/day-148-structured-2/) 的 JSON mode;[Day 354](/blog/agent-zero/day-354-testset-size/) 讲的开发集和留出集;[Day 358](/blog/agent-zero/day-358-llm-judge-3/) 用过的线程池和 train/dev/test 三份拆法。

学法:先对照文章逐行敲一遍(不复制粘贴)并跑通;明天合上文章,把 `load()` 的分法和 `evaluate()` 默写出来;做练习时先自己写,做不出再展开参考答案,看完关掉重写一遍。

## 第一步:60 条工单,规则藏在标签里

想看清手调和自动优化各有多大本事,先要有一份「起点 prompt 答不全对」的数据。这里用虚构公司云簿 CloudLedger 的 60 条客服工单,分六类:

| 类别 | 意思 |
| --- | --- |
| refund | 要把钱退回来 |
| billing | 扣款、价格、付费方式 |
| invoice | 发票本身(抬头、类型、开票) |
| bug | 产品功能出错 |
| account | 登录、权限、账号 |
| other | 其他 |

难的地方是一半工单故意挑了边界情况。标注员心里有一套「客服分诊规范」:重复扣款不管客户说没说要退都算 refund;付款没成功算 billing,哪怕页面弹出英文错误码;发票上的金额和实际扣款对不上算 billing,因为本质是钱算得对不对;发票 PDF 打不开算 bug;注销账号时要退余额算 refund,只问注销后数据还在不在算 account。

这套规范**不写进起点 prompt**,只散落在每条工单的 `why` 字段里。`why` 是标注员写的一句理由,比如「重复扣款一律算 refund,哪怕客户没明说要退」。真实公司里也是这样,业务规则在老客服的脑子里、在历史工单的备注里,很少有人提前整理成文档。明天的优化器要做的,就是从错例和这些理由里把规则「读」出来。

数据格式是 JSONL([Day 348](/blog/agent-zero/day-348-testcase-structure/) 存用例用过),一行一个 JSON 对象。在 `agent-zero-lab` 根目录(比如 `/Users/你/agent-zero-lab`)新建 `part06/opt_tickets.jsonl`,内容如下。很长,这一个文件可以复制,不用逐字敲:

```jsonl
{"id":"t01","ticket":"这个月账单显示扣了两次 299,我只开了一个专业版。","label":"refund","why":"重复扣款一律算 refund,哪怕客户没明说要退"}
{"id":"t02","ticket":"信用卡续费没扣成功,页面提示 card_declined,怎么办?","label":"billing","why":"扣款失败属于 billing,不是 bug,即使页面出现英文错误码"}
{"id":"t03","ticket":"想问一下企业版一年多少钱,能开月付吗?","label":"billing","why":"价格和付费方式咨询属于 billing"}
{"id":"t04","ticket":"发票抬头写错了,公司名少了个「有限」,能重开吗?","label":"invoice","why":"抬头、税号、发票类型、重开都是 invoice"}
{"id":"t05","ticket":"导出 Excel 的时候一直转圈,最后报 E2001。","label":"bug","why":"导入导出等功能异常是 bug"}
{"id":"t06","ticket":"登录时提示 E1043 验证码已失效,重发了三次都不行。","label":"account","why":"登录、验证码相关问题算 account,即使带错误码"}
{"id":"t07","ticket":"年付专业版用了四个月不想用了,剩下的钱能退吗?","label":"refund","why":"年付中途取消问退钱是 refund"}
{"id":"t08","ticket":"怎么关闭自动续费?下个月不想再扣了。","label":"billing","why":"只问取消续费、不涉及把已付的钱退回,算 billing"}
{"id":"t09","ticket":"你们有没有代理合作?我们想在华南区代理 CloudLedger。","label":"other","why":"商务合作、代理属于 other"}
{"id":"t10","ticket":"子账号看不到报表菜单,是不是权限没给?","label":"account","why":"成员、子账号权限是 account"}
{"id":"t11","ticket":"发票上的金额是 399,可我实际被扣了 299,到底扣了多少?","label":"billing","why":"发票金额和扣款不一致,本质是钱算得对不对,算 billing 不算 invoice"}
{"id":"t12","ticket":"发票 PDF 下载下来打不开,显示文件已损坏。","label":"bug","why":"发票文件下载、显示异常属于功能问题,算 bug"}
{"id":"t13","ticket":"我要注销账号,账户里还有 120 块余额怎么退给我?","label":"refund","why":"涉及把钱退回给客户时 refund 优先于 account"}
{"id":"t14","ticket":"希望报表能加一个按项目筛选的功能。","label":"other","why":"功能建议算 other"}
{"id":"t15","ticket":"升级到企业版是马上按差价扣钱还是下个周期?","label":"billing","why":"升级计费规则是 billing"}
{"id":"t16","ticket":"上周取消了订阅,结果今天又扣了 99,请处理。","label":"refund","why":"取消后仍被扣款,要求处理多扣的钱,算 refund"}
{"id":"t17","ticket":"手机号换了,收不到验证码,怎么改绑定手机?","label":"account","why":"换绑手机、收不到验证码是 account"}
{"id":"t18","ticket":"想开增值税专用发票,需要提供什么资料?","label":"invoice","why":"发票类型和开票资料是 invoice"}
{"id":"t19","ticket":"银行卡余额不足导致续费失败,现在充值了能重新扣吗?","label":"billing","why":"扣款失败后重新扣款是 billing"}
{"id":"t20","ticket":"凭证列表页面打开很慢,要等 30 秒。","label":"bug","why":"性能和页面异常属于 bug"}
{"id":"t21","ticket":"同一张发票被扣了两笔钱,麻烦核实一下。","label":"refund","why":"重复扣款算 refund,出现「发票」二字也不改变"}
{"id":"t22","ticket":"支付宝付款时页面报错 PAY_TIMEOUT,钱没扣,订单也没成功。","label":"billing","why":"付款没成功属于 billing,不是 bug"}
{"id":"t23","ticket":"税号填错了,发票已经开出来了,怎么作废重开?","label":"invoice","why":"税号错误、作废重开是 invoice"}
{"id":"t24","ticket":"导入银行流水时提示「第 3 列格式错误」,可我的表格是按模板做的。","label":"bug","why":"导入功能异常算 bug"}
{"id":"t25","ticket":"管理员离职了,我们怎么把管理员权限转给别人?","label":"account","why":"管理员转移是 account"}
{"id":"t26","ticket":"基础版年付,能不能中途取消然后退剩下几个月的钱?","label":"refund","why":"问能不能退剩余的钱就是 refund,能不能退由政策决定,分类不管"}
{"id":"t27","ticket":"你们和金蝶比有什么优势?","label":"other","why":"产品对比、售前咨询非价格类算 other"}
{"id":"t28","ticket":"续费价格怎么比去年贵了 100?","label":"billing","why":"价格变化疑问是 billing"}
{"id":"t29","ticket":"开了发票但是邮箱一直没收到。","label":"invoice","why":"发票寄送、邮件没收到是 invoice"}
{"id":"t30","ticket":"点「生成凭证」按钮没有任何反应。","label":"bug","why":"按钮无响应是 bug"}
{"id":"t31","ticket":"登录后一直跳回登录页,清缓存也没用,报错码 E1101。","label":"account","why":"登录失败相关算 account,即使带错误码"}
{"id":"t32","ticket":"试用期结束自动扣了我 2392,我根本没打算买,退给我。","label":"refund","why":"要求退已扣的钱是 refund"}
{"id":"t33","ticket":"订阅页面显示下次扣款日期是 11 月 31 日,这个日期不存在吧?","label":"bug","why":"页面显示错误的日期属于 bug,不是 billing"}
{"id":"t34","ticket":"能不能把三张发票合并成一张开?","label":"invoice","why":"合并开票是 invoice"}
{"id":"t35","ticket":"公司要采购,需要你们盖章的报价单。","label":"billing","why":"报价单属于价格类,算 billing"}
{"id":"t36","ticket":"账号被锁了,提示密码错误次数过多。","label":"account","why":"账号锁定是 account"}
{"id":"t37","ticket":"我们换了公司名称,以后的发票抬头怎么改?","label":"invoice","why":"修改发票抬头是 invoice"}
{"id":"t38","ticket":"降级到基础版之后,多付的差价会退回来吗?","label":"refund","why":"问差价退不退回是 refund"}
{"id":"t39","ticket":"报表里的合计金额和明细加起来对不上,差了 0.01。","label":"bug","why":"计算显示错误是 bug,不是 billing(不是我们扣客户的钱)"}
{"id":"t40","ticket":"想邀请你们来我们公司做个培训。","label":"other","why":"培训邀约算 other"}
{"id":"t41","ticket":"微信支付扣了钱,但是订阅状态还是未付款。","label":"billing","why":"付款成功但状态没更新属于 billing"}
{"id":"t42","ticket":"开发票时提示「开票金额超过可开额度」,为什么?","label":"invoice","why":"开票额度问题是 invoice"}
{"id":"t43","ticket":"手机 App 闪退,打开就退出。","label":"bug","why":"闪退是 bug"}
{"id":"t44","ticket":"之前多扣的那 99 说好退,一周了还没到账。","label":"refund","why":"退款进度查询是 refund"}
{"id":"t45","ticket":"我是会计,想用一个账号管理三家公司,怎么弄?","label":"account","why":"多公司账号管理是 account"}
{"id":"t46","ticket":"月付可以改成年付吗?年付有优惠吗?","label":"billing","why":"付费周期和优惠是 billing"}
{"id":"t47","ticket":"你们的数据存在哪里?有等保认证吗?","label":"other","why":"安全合规咨询算 other"}
{"id":"t48","ticket":"发票开成了普票,我们要的是专票,能换吗?","label":"invoice","why":"发票类型更换是 invoice"}
{"id":"t49","ticket":"扣款短信说扣了 299,可是账单里显示 0,这笔钱去哪了?","label":"billing","why":"扣款记录对不上属于 billing,没有要求退款"}
{"id":"t50","ticket":"打开发票列表页面直接白屏。","label":"bug","why":"页面白屏是 bug,出现「发票」不改变"}
{"id":"t51","ticket":"企业版年付用了两个月,公司倒闭了,能退吗?","label":"refund","why":"年付中途取消问退钱是 refund"}
{"id":"t52","ticket":"怎么设置让财务只能看不能改?","label":"account","why":"成员权限设置是 account"}
{"id":"t53","ticket":"注销账号后数据还能找回吗?","label":"account","why":"只问注销和数据,不涉及退钱,是 account"}
{"id":"t54","ticket":"续费时优惠券用不了,提示「不适用于当前套餐」。","label":"billing","why":"优惠券和扣费相关是 billing,不是 bug"}
{"id":"t55","ticket":"上个月的发票能补开吗?当时忘了开。","label":"invoice","why":"补开发票是 invoice"}
{"id":"t56","ticket":"批量删除凭证后,回收站里找不到了。","label":"bug","why":"功能结果异常是 bug"}
{"id":"t57","ticket":"同事说你们有教育优惠,学校能用吗?","label":"billing","why":"优惠和价格咨询是 billing"}
{"id":"t58","ticket":"重复开了两张一样的发票,作废一张就行。","label":"invoice","why":"重复开票(不是重复扣款)是 invoice"}
{"id":"t59","ticket":"我的账号被别人登录了,改了密码,怎么办?","label":"account","why":"账号安全、被盗是 account"}
{"id":"t60","ticket":"被扣了两次年费,一共 4784,只要一份。","label":"refund","why":"重复扣款是 refund"}
```

数一下各类有几条:billing 14、refund 11、invoice 10、bug 10、account 10、other 5。other 只有 5 条,后面会看到它是最容易被答错的类之一。

### 为什么要切成三份

60 条按编号除以 3 的余数切成三份,每份 20 条:

- **训练集**(train,编号除 3 余 1:t01、t04、t07……):给优化器看错例。人手调时,你盯着看的那批错例就是训练集。
- **验证集**(val,余 2:t02、t05……):给优化器挑版本。改出一个新版本,在这上面量一下,比原来好才采用。
- **测试集**(test,余 0:t03、t06……):到最后只量一次,优化过程中谁都不许看。

[Day 354](/blog/agent-zero/day-354-testset-size/) 讲开发集和留出集时说过:你对着哪批数据改,哪批数据上的分数就会虚高。这里多了一份验证集,原因是优化器不止「对着训练集改」,还要「拿验证集挑」,挑也是一种拟合,挑多了验证集的分数也会虚高。只有测试集从头到尾没参与任何决定,它的分数才说明问题。

用编号取余而不随机打乱,是为了每次运行分法都一样,不同版本的分数才能对比。[Day 358](/blog/agent-zero/day-358-llm-judge-3/) 用 md5 分份也是同一个目的。

## 第二步:起点 prompt 和评测函数

下面这个文件是三天(今天、明天、Day 371)共用的任务定义。明天的反思循环和 GEPA 都从这里 import。

```python
# agent-zero-lab/part06/opt_task.py
"""Day 368:工单分类任务的数据、两个起点 prompt、评测函数。Day 369 的反思循环和 GEPA 都 import 它。
用法: uv run python -m part06.opt_task [bare]"""
from __future__ import annotations

import json
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any

from common.llm import LLMClient

DATA = Path(__file__).with_name("opt_tickets.jsonl")
LABELS = ["refund", "billing", "invoice", "bug", "account", "other"]

# 起点一:认真写过的类别定义
BASE_PROMPT = """把客服工单分到一个类别。
refund=要求退款/重复扣款/取消后退钱;billing=扣款失败、欠费、价格、升级计费;
invoice=开票、发票抬头、发票类型;bug=报错、功能异常;account=登录、验证码、权限、注销;other=其他"""

# 起点二:只有类别名,一个定义都没有
BARE_PROMPT = "把客服工单分到一个类别:refund、billing、invoice、bug、account、other。"

OUTPUT_RULE = '只输出 JSON:{"category": "<类别>"}'


def load(split: str) -> list[dict[str, Any]]:
    rows = [json.loads(line) for line in DATA.read_text(encoding="utf-8").splitlines() if line]
    k = {"train": 1, "val": 2, "test": 0}[split]
    return [r for r in rows if int(r["id"][1:]) % 3 == k]


def classify(client: LLMClient, prompt: str, ticket: str) -> str:
    r = client.chat(
        [{"role": "system", "content": f"{prompt}\n\n{OUTPUT_RULE}"},
         {"role": "user", "content": ticket}],
        temperature=0,
        response_format={"type": "json_object"},
    )
    try:
        cat = json.loads(r.content).get("category", "")
    except json.JSONDecodeError:
        return "<bad-json>"
    return cat if cat in LABELS else f"<{cat}>"


def evaluate(client: LLMClient, prompt: str, rows: list[dict[str, Any]]) -> tuple[float, list[dict[str, Any]]]:
    with ThreadPoolExecutor(max_workers=8) as pool:
        preds = list(pool.map(lambda r: classify(client, prompt, r["ticket"]), rows))
    errors = [{**r, "pred": p} for r, p in zip(rows, preds) if p != r["label"]]
    return 1 - len(errors) / len(rows), errors


if __name__ == "__main__":
    client = LLMClient()
    prompt = BARE_PROMPT if "bare" in sys.argv[1:] else BASE_PROMPT
    for split in ["train", "val", "test"]:
        acc, errors = evaluate(client, prompt, load(split))
        print(f"{split}: {acc:.0%}  错 {len(errors)} 条", [f"{e['id']} {e['label']}→{e['pred']}" for e in errors])
    print(client.ledger)
```

<div class="line-notes">

- `from concurrent.futures import ThreadPoolExecutor` 线程池,[Day 358](/blog/agent-zero/day-358-llm-judge-3/) 用过。20 条工单互不依赖,8 个一起发。时间都花在等网络上,线程就够用。
- `from common.llm import LLMClient` [Day 136](/blog/agent-zero/day-136-llm-client-2/) 写的客户端,读 `.env` 里的 `LLM_BASE_URL`、`LLM_MODEL`、`LLM_PRICE`、`LLM_EXTRA_BODY`,每次调用自动记账。实测用的是 DeepSeek `deepseek-flash`,`LLM_EXTRA_BODY` 是 `{"thinking": {"type": "disabled"}}`,关掉思考模式,分类任务用不着它。
- `DATA = Path(__file__).with_name("opt_tickets.jsonl")` `__file__` 是这个脚本自己的路径,`with_name` 把文件名换掉,得到同目录下的数据文件。不管你在哪个目录运行都找得到。相当于 Node 里的 `path.join(__dirname, "opt_tickets.jsonl")`。
- `BASE_PROMPT = """把客服工单分到一个类别。` 起点一:六个类别各有一句定义,写得还算认真。注意它和第一步那套分诊规范不完全一样,比如没说「注销时退余额算 refund」,也没说「付款超时不是 bug」。
- `BARE_PROMPT = "把客服工单分到一个类别:refund、billing、invoice、bug、account、other。"` 起点二:只有类别名。拿它当起点,明天能看出优化器到底从错例里学到了多少。
- `OUTPUT_RULE = '只输出 JSON:{"category": "<类别>"}'` 输出格式单独放一个变量。明天的优化器只改上面的判定规则,不碰格式,免得把格式也改坏。DeepSeek 的 JSON mode 要求 prompt 里出现 json 字样,这一句正好满足。
- `rows = [json.loads(line) for line in DATA.read_text(encoding="utf-8").splitlines() if line]` 读整个文件、按行切开、跳过空行、每行解析成字典。一行列表推导式,相当于 JS 的 `text.split("\n").filter(Boolean).map(JSON.parse)`。
- `k = {"train": 1, "val": 2, "test": 0}[split]` 先建一个字典再马上取值,三份各自对应一个余数。传错名字(比如 `"dev"`)会直接 `KeyError`,比悄悄返回空列表好。
- `return [r for r in rows if int(r["id"][1:]) % 3 == k]` `r["id"][1:]` 把 `"t13"` 切成 `"13"`,`int` 转成数字,13 % 3 = 1,所以 t13 在训练集。`%` 是取余,和 JS 一样。实测三份各 20 条。
- `[{"role": "system", "content": f"{prompt}\n\n{OUTPUT_RULE}"},` system 消息是「判定规则 + 空一行 + 输出格式」。今天和明天改的都是前半截。
- `temperature=0,` 分类用 0,尽量让同一个 prompt 每次答得一样。[Day 112](/blog/agent-zero/day-112-sampling-2/) 实测过 DeepSeek 在 0 下也不保证完全一样,下面马上会再见到。
- `response_format={"type": "json_object"},` [Day 148](/blog/agent-zero/day-148-structured-2/) 的 JSON mode:保证输出是合法 JSON,但不保证 `category` 的值是六类之一,所以下面还要检查。
- `except json.JSONDecodeError:` 万一不是合法 JSON,返回一个尖括号包着的标记,算答错,不让整个评测崩掉。
- `return cat if cat in LABELS else f"<{cat}>"` 答了六类以外的词(比如 `payment`),原样包上尖括号返回。算错,但在错例列表里一眼能看出它答了什么。
- `preds = list(pool.map(lambda r: classify(client, prompt, r["ticket"]), rows))` `pool.map` 把每条工单交给线程池并发分类,返回结果的顺序和 `rows` 一样。`lambda` 是 Python 的匿名函数,相当于 JS 的箭头函数 `r => classify(...)`。
- `errors = [{**r, "pred": p} for r, p in zip(rows, preds) if p != r["label"]]` `zip` 把两个列表按位置配对;`{**r, "pred": p}` 是「复制字典 r 再加一个键」,和 JS 的 `{...r, pred: p}` 一样。错例保留原始字段(包括 `why`),明天反思循环要用。
- `return 1 - len(errors) / len(rows), errors` 返回两个值(元组):准确率和错例列表。20 条错 2 条,就是 1 - 2/20 = 0.9。
- `prompt = BARE_PROMPT if "bare" in sys.argv[1:] else BASE_PROMPT` 命令行带 `bare` 就用起点二。`sys.argv[1:]` 是去掉脚本名后的参数列表。
- `print(f"{split}: {acc:.0%}  错 {len(errors)} 条", [f"{e['id']} {e['label']}→{e['pred']}" for e in errors])` `:.0%` 把 0.9 格式化成 `90%`。错例写成「编号 正确→模型答」,比如 `t13 refund→account`。

</div>

在 `agent-zero-lab` 根目录跑三遍 BASE,再跑一遍 BARE:

```bash
uv run python -m part06.opt_task
uv run python -m part06.opt_task
uv run python -m part06.opt_task
uv run python -m part06.opt_task bare
```

实测输出:

```text
train: 90%  错 2 条 ['t13 refund→account', 't22 billing→bug']
val: 85%  错 3 条 ['t11 billing→invoice', 't35 billing→other', 't38 refund→billing']
test: 90%  错 2 条 ['t12 bug→invoice', 't57 billing→other']
60 次调用 | 输入 7426 / 输出 378 tokens | 约 ¥0.0179
---
train: 90%  错 2 条 ['t13 refund→account', 't22 billing→bug']
val: 80%  错 4 条 ['t11 billing→invoice', 't14 other→bug', 't35 billing→other', 't38 refund→billing']
test: 90%  错 2 条 ['t12 bug→invoice', 't57 billing→other']
60 次调用 | 输入 7426 / 输出 379 tokens | 约 ¥0.0179
---
train: 90%  错 2 条 ['t13 refund→account', 't22 billing→bug']
val: 80%  错 4 条 ['t11 billing→invoice', 't14 other→bug', 't35 billing→other', 't38 refund→billing']
test: 90%  错 2 条 ['t12 bug→invoice', 't57 billing→other']
60 次调用 | 输入 7426 / 输出 378 tokens | 约 ¥0.0179
---
train: 75%  错 5 条 ['t01 refund→billing', 't13 refund→account', 't16 refund→billing', 't22 billing→bug', 't31 account→bug']
val: 85%  错 3 条 ['t14 other→bug', 't35 billing→other', 't38 refund→billing']
test: 80%  错 4 条 ['t12 bug→invoice', 't21 refund→invoice', 't57 billing→other', 't60 refund→billing']
60 次调用 | 输入 4426 / 输出 380 tokens | 约 ¥0.0119
```

(`---` 是我为了看清楚手动加的分隔,你的终端里没有。)

先看 BASE 的三遍。训练集和测试集三遍一模一样,验证集第一遍 85%、后两遍 80%,差别全在 t14「希望报表能加一个按项目筛选的功能」:有时答 other,有时答 bug。temperature 是 0,同一个 prompt,答案还是会变。

这件事请记牢:**20 条的验证集上,一条工单就是 5 个百分点。** 明天优化器报「验证集从 85% 涨到 90%」,你要先想到这可能只是 t14 换了个答案。按 [Day 353](/blog/agent-zero/day-353-stats-intuition/) 的区间直觉,20 条上量出 90%,95% 置信区间大约是 70% 到 97%(Wilson 区间,我按公式算的),宽得能开车过去。

再看 BARE。只给类别名,测试集 80%,错的 4 条里 t21「同一张发票被扣了两笔钱」被答成 invoice,t60「被扣了两次年费」被答成 billing,都是重复扣款,标注规范说算 refund。训练集里也是,t01、t16 这类「扣了钱」的工单全被归到了 billing。这就是明天优化器要从错例里学回来的东西。

花费:BASE 一遍 60 次调用,输入 7426、输出 378 token。`LLM_PRICE=0.04,2,8` 的意思是每百万 token 缓存命中 0.04 元、未命中 2 元、输出 8 元(2026 年 10 月 deepseek-flash 价格,和 Day 367 一样),全按未命中算是 7426 × 2 / 100 万 + 378 × 8 / 100 万 ≈ 0.0179 元,和账本打印的一致。四遍合计 0.0179 × 3 + 0.0119 ≈ 0.066 元。

## 第三步:手调三版,看它怎么打地鼠

现在你是那个手调 prompt 的人。BASE 在全部 60 条上错 7 条左右,你盯着错例看:t13「注销账号还有 120 块余额怎么退」答成了 account,t38「降级后多付的差价会退回来吗」答成了 billing。都和钱有关,都该是 refund。于是你加一句「凡是涉及钱的问题,一律优先算 refund」。

这一步我们把它写成脚本,每一版只比上一版多一句,在全部 60 条上跑,看修好了谁、又带坏了谁。

```python
# agent-zero-lab/part06/hand_tune.py
"""Day 368:模拟手调 prompt。每版只加一句规则,在全部 60 条上跑,看修好了谁、又带坏了谁。
用法: uv run python -m part06.hand_tune"""
from __future__ import annotations

import json
from concurrent.futures import ThreadPoolExecutor

from common.llm import LLMClient
from part06.opt_task import BASE_PROMPT, DATA, classify

VERSIONS = {
    "v0": BASE_PROMPT,
    "v1": BASE_PROMPT + "\n凡是涉及钱的问题(扣款、金额、余额),一律优先算 refund。",
    "v2": BASE_PROMPT + "\n客户要求把钱退回来时算 refund,哪怕同时提到注销、发票;只是问钱的去向或金额对不对,算 billing。",
}

if __name__ == "__main__":
    client = LLMClient()
    rows = [json.loads(line) for line in DATA.read_text(encoding="utf-8").splitlines() if line]
    prev: dict[str, str] = {}
    for name, prompt in VERSIONS.items():
        with ThreadPoolExecutor(max_workers=8) as pool:
            preds = dict(zip([r["id"] for r in rows], pool.map(lambda r: classify(client, prompt, r["ticket"]), rows)))
        gold = {r["id"]: r["label"] for r in rows}
        right = sum(preds[i] == gold[i] for i in gold)
        fixed = [i for i in gold if prev and prev[i] != gold[i] and preds[i] == gold[i]]
        broke = [f"{i} {gold[i]}→{preds[i]}" for i in gold if prev and prev[i] == gold[i] and preds[i] != gold[i]]
        print(f"{name}: {right}/60  修好 {fixed}  带坏 {broke}")
        print(f"    还错的: {[f'{i} {gold[i]}→{preds[i]}' for i in gold if preds[i] != gold[i]]}")
        prev = preds
    print(client.ledger)
```

<div class="line-notes">

- `from part06.opt_task import BASE_PROMPT, DATA, classify` 直接复用第二步的分类函数,保证三版的调用方式完全一样,差别只在 prompt。
- `VERSIONS = {` 字典在 Python 3.7 以后保持插入顺序,所以循环时一定是 v0、v1、v2 的顺序,和 JS 对象的字符串键顺序一个意思。
- `"v1": BASE_PROMPT + "\n凡是涉及钱的问题(扣款、金额、余额),一律优先算 refund。",` 看了 t13、t38 两个错例,第一反应写出来的规则。很多人第一版都会这么写。
- `"v2": BASE_PROMPT + "\n客户要求把钱退回来时算 refund,哪怕同时提到注销、发票;只是问钱的去向或金额对不对,算 billing。",` 看到 v1 带坏了一片以后改的第二版,把「退钱」和「问钱」分开。注意 v2 是在 v1 的 60 条结果上改出来的,它已经看过全部数据。
- `prev: dict[str, str] = {}` 上一版每条工单的答案,用来算「修好」和「带坏」。第一版时它是空的。
- `preds = dict(zip([r["id"] for r in rows], pool.map(lambda r: classify(client, prompt, r["ticket"]), rows)))` 编号和答案配对,变成 `{"t01": "refund", ...}`。`dict(zip(键列表, 值列表))` 相当于 JS 的 `Object.fromEntries(ids.map((id, i) => [id, preds[i]]))`。
- `right = sum(preds[i] == gold[i] for i in gold)` 布尔值在 Python 里能直接加,True 算 1。这一行数的是答对几条。
- `fixed = [i for i in gold if prev and prev[i] != gold[i] and preds[i] == gold[i]]` 上一版错、这一版对。`prev and ...` 让第一版时直接得到空列表,不会去取空字典的键。
- `broke = [f"{i} {gold[i]}→{preds[i]}" for i in gold if prev and prev[i] == gold[i] and preds[i] != gold[i]]` 上一版对、这一版错,也就是被新规则带坏的。
- `prev = preds` 这一版变成下一版的「上一版」。

</div>

```bash
uv run python -m part06.hand_tune
```

我跑了两遍,结果完全一样,这是其中一遍:

```text
v0: 53/60  修好 []  带坏 []
    还错的: ['t11 billing→invoice', 't12 bug→invoice', 't13 refund→account', 't22 billing→bug', 't35 billing→other', 't38 refund→billing', 't57 billing→other']
v1: 49/60  修好 ['t13', 't38']  带坏 ['t08 billing→refund', 't14 other→bug', 't19 billing→refund', 't39 bug→refund', 't41 billing→refund', 't49 billing→refund']
    还错的: ['t08 billing→refund', 't11 billing→refund', 't12 bug→invoice', 't14 other→bug', 't19 billing→refund', 't22 billing→bug', 't35 billing→other', 't39 bug→refund', 't41 billing→refund', 't49 billing→refund', 't57 billing→other']
v2: 54/60  修好 ['t08', 't11', 't12', 't19', 't39', 't41', 't49']  带坏 ['t31 account→bug', 't38 refund→billing']
    还错的: ['t14 other→bug', 't22 billing→bug', 't31 account→bug', 't35 billing→other', 't38 refund→billing', 't57 billing→other']
180 次调用 | 输入 24918 / 输出 1144 tokens | 约 ¥0.0590
```

<figure>
<svg viewBox="0 0 640 230" role="img" aria-label="手调三版的结果:v0 对 53 条;v1 加了钱优先的规则,修好 2 条带坏 6 条,只对 49 条;v2 把退钱和问钱分开,对 54 条,但又带坏了 t31 和 t38">
<rect x="0" y="0" width="640" height="230" fill="var(--paper-raised)"/>
<g font-family="var(--font-mono)" font-size="12">
<text x="20" y="28" fill="var(--ink)">60 条里答对几条</text>
<line x1="80" y1="190" x2="620" y2="190" stroke="var(--rule)"/>
<rect x="110" y="58" width="90" height="132" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="140" y="50" fill="var(--ink)">53</text>
<text x="135" y="208" fill="var(--ink)">v0</text>
<text x="104" y="224" fill="var(--ink-faint)" font-size="11">BASE 原样</text>
<rect x="290" y="78" width="90" height="112" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="320" y="70" fill="var(--ink)">49</text>
<text x="315" y="208" fill="var(--ink)">v1</text>
<text x="270" y="224" fill="var(--ink-faint)" font-size="11">+「钱优先 refund」</text>
<rect x="470" y="53" width="90" height="137" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="500" y="45" fill="var(--ink)">54</text>
<text x="495" y="208" fill="var(--ink)">v2</text>
<text x="452" y="224" fill="var(--ink-faint)" font-size="11">+「退钱」和「问钱」分开</text>
<text x="205" y="110" fill="var(--ink-soft)" font-size="11">修好 2</text>
<text x="205" y="126" fill="var(--ink-soft)" font-size="11">带坏 6</text>
<text x="385" y="110" fill="var(--ink-soft)" font-size="11">修好 7</text>
<text x="385" y="126" fill="var(--ink-soft)" font-size="11">带坏 2</text>
</g>
</svg>
<figcaption>手调三版的实测。v1 那句规则写得太宽,把「问钱去哪了」「付款失败」也拉进了 refund;v2 收窄以后比 v0 多对一条,但又冒出两条新错。</figcaption>
</figure>

一行行读这个结果。

v1 那句「涉及钱一律 refund」修好了 t13 和 t38,同时带坏了 6 条。t08「怎么关闭自动续费」、t19「余额不足续费失败,充值了能重新扣吗」、t41「微信扣了钱但订阅状态还是未付款」、t49「扣款短信说扣了 299,账单里显示 0」,客户都提到了钱,但没有一个是要退钱。t39「报表合计和明细差了 0.01」更离谱,那是报表算错了,是 bug,也被拉进了 refund。还有 t14,它本来就时对时错,这一遍正好错了,算到「带坏」里有点冤。

v2 把规则收窄:「要求把钱退回来」才算 refund,「问钱的去向或金额对不对」算 billing。这一版修好了 7 条,60 条里对 54 条,比 v0 多一条。看起来是进步。可它又带坏了 t31「登录后一直跳回登录页,报错码 E1101」,答成了 bug,而这条和钱毫无关系,我加的那句话只是让模型对整段定义的理解变了一点。t38「降级后多付的差价会退回来吗」又错回 billing,v2 里「问金额对不对」那半句把它带走了。

这就是手调到后期的样子:**剩下的错误往往是规则之间打架。** 为了修一条加一句,这一句又在别处起作用;再加一句例外,例外又有例外。人在这时候会累,会凭印象判断「好像好了」,很少有人每改一次都把整份数据重跑一遍、把每一条的变化列出来。今天我们靠脚本列出来了,所以看得清楚。

还有一个更隐蔽的问题。v2 是我看完 v1 在全部 60 条上的结果以后写的,它已经「见过」所有数据。它说自己 54/60,这个数是不可信的,因为没有一份没被看过的数据替它作证。练习 3 会按规矩来一遍:只看训练集写规则,定稿后测试集只跑一次。

花费:三版共 180 次调用,输入 24918、输出 1144 token,24918 × 2 / 100 万 + 1144 × 8 / 100 万 ≈ 0.059 元,跑了两遍约 0.118 元。

## 第四步:自动 prompt 优化要三样东西

既然手调的过程是「跑评测 → 看错例 → 猜规则 → 改一句 → 再跑」,而这个过程里的每一步你现在都有现成的零件,那能不能让程序替你转这个圈?

这就是**自动 prompt 优化**(automatic prompt optimization,有人简称 APO):让程序拿着评测分数,自己生成新版本的 prompt,按分数挑选。它需要三样东西:

1. **一份带标签的数据**,切成训练、验证、测试三份。今天的 `opt_tickets.jsonl`。
2. **一把尺子**,也就是能给一个 prompt 打分的函数。今天的 `evaluate()`。分类任务用准确率就够;回复类任务可以用 [Day 357](/blog/agent-zero/day-357-llm-judge-2/) 的 LLM 评分器。
3. **一个会改 prompt 的模型**,叫**反思模型**(reflection model):把当前 prompt 和错例交给它,让它分析为什么错、写出新版本。它和执行分类的那个模型可以是同一个,也可以更强。

<figure>
<svg viewBox="0 0 640 250" role="img" aria-label="自动 prompt 优化的循环:当前 prompt 交给执行模型跑训练集,评分函数给出分数和文字反馈,反思模型读错例写出候选 prompt,在验证集上验收,更好就采用,否则丢弃;最终只在测试集上量一次">
<rect x="0" y="0" width="640" height="250" fill="var(--paper-raised)"/>
<g font-family="var(--font-mono)" font-size="12">
<rect x="20" y="30" width="130" height="50" rx="6" fill="none" stroke="var(--ink-soft)"/>
<text x="40" y="52" fill="var(--ink)">当前 prompt</text>
<text x="40" y="70" fill="var(--ink-faint)" font-size="11">v0、v1、v2…</text>
<rect x="190" y="30" width="130" height="50" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="205" y="52" fill="var(--ink)">执行模型</text>
<text x="205" y="70" fill="var(--ink-faint)" font-size="11">跑训练集</text>
<rect x="360" y="30" width="130" height="50" rx="6" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="375" y="52" fill="var(--ink)">评分函数</text>
<text x="375" y="70" fill="var(--ink-faint)" font-size="11">分数 + 反馈文字</text>
<rect x="360" y="130" width="130" height="50" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="375" y="152" fill="var(--ink)">反思模型</text>
<text x="375" y="170" fill="var(--ink-faint)" font-size="11">读错例写新版</text>
<rect x="190" y="130" width="130" height="50" rx="6" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="205" y="152" fill="var(--ink)">验证集验收</text>
<text x="205" y="170" fill="var(--ink-faint)" font-size="11">更好才采用</text>
<rect x="20" y="130" width="130" height="50" rx="6" fill="none" stroke="var(--rule)"/>
<text x="35" y="152" fill="var(--ink)">测试集</text>
<text x="35" y="170" fill="var(--ink-faint)" font-size="11">最后只量一次</text>
<line x1="150" y1="55" x2="188" y2="55" stroke="var(--ink-soft)"/>
<line x1="320" y1="55" x2="358" y2="55" stroke="var(--ink-soft)"/>
<line x1="425" y1="80" x2="425" y2="128" stroke="var(--ink-soft)"/>
<line x1="360" y1="155" x2="322" y2="155" stroke="var(--ink-soft)"/>
<line x1="255" y1="130" x2="100" y2="82" stroke="var(--ink-soft)" stroke-dasharray="4 3"/>
<text x="120" y="112" fill="var(--ink-faint)" font-size="11">采用 → 成为新的当前版</text>
<line x1="190" y1="170" x2="152" y2="170" stroke="var(--rule)" stroke-dasharray="2 3"/>
<text x="20" y="220" fill="var(--ink-soft)" font-size="11">右上角那一格最关键:反馈写得越具体(「应为 billing,因为付款没成功不算 bug」),</text>
<text x="20" y="238" fill="var(--ink-soft)" font-size="11">反思模型改得越准。只给 0/1 分数,它只能猜。</text>
</g>
</svg>
<figcaption>明天要跑的三种做法都是这个圈,区别只在「反思模型怎么改」和「怎么挑出最终版本」。测试集全程不参与挑选。</figcaption>
</figure>

三样东西里,大家最容易轻视的是评分函数返回的**文字反馈**。如果评分函数只说「这条错了,0 分」,反思模型只能看着工单原文和错误答案自己猜原因;如果它还附上「应为 billing,标注理由:付款没成功属于 billing,不是 bug」,反思模型就有了方向。这也是为什么第一步要在每条数据里放一个 `why` 字段。练习做完你会发现,`why` 写成「应为 billing」这种废话,和不写差不多。

先把期望放对。自动优化省的是你转圈的体力,它不知道哪条规则在业务上真的成立,只知道哪个版本在它看得到的数据上分数高。第三步那句「涉及钱一律 refund」,在只看 t13、t38 两条错例的人眼里是对的,在优化器眼里也是对的。测试集太小、反馈写得含糊,换什么优化器都救不了。

## 第五步:三个名字

2026 年说起自动优化 prompt,最常听到三个名字。今天只认识它们,明天动手跑前两个,Day 371 跑第三个。

### DSPy:把 prompt 当成程序的一部分

**DSPy** 是斯坦福 NLP 组开源的 Python 框架。它的立场写在 2023 年那篇论文标题里:把调用语言模型的代码当成「声明式的程序」,prompt 由框架生成和优化,而不是你手写一大段字符串。

拿前端打比方。你写 React 时声明「这个组件接收哪些 props、渲染出什么」,DOM 怎么更新交给 React。DSPy 里你声明「这一步输入哪些字段、输出哪些字段、类型是什么」,这个声明叫 **Signature**;再选一个调用方式,叫 **Module**,最简单的是 `Predict`(直接出答案),还有先想再答的 `ChainOfThought`、会调工具的 `ReAct`。真正发给模型的那段 prompt 由 DSPy 拼。

拼出来的 prompt 不一定最好,所以 DSPy 还带了一批**优化器**(以前叫 teleprompter),拿你的数据和评分函数去调这个程序:有的自动挑 few-shot 示例(`BootstrapFewShot`),有的同时搜指令和示例(`MIPROv2`),有的干脆去微调模型(`BootstrapFinetune`)。2026 年 10 月查到 PyPI 上的最新版是 3.4.1(10 月 12 日发布)。

### GEPA:读文字反馈,改写 prompt

**GEPA** 是 DSPy 里的一个优化器,也有不依赖 DSPy 的独立 Python 包 `gepa`(10 月查到 0.1.4,DSPy 3.4.1 把它列成了依赖)。名字是 Genetic-Pareto 的缩写,论文标题很直白:《Reflective Prompt Evolution Can Outperform Reinforcement Learning》,反思式的 prompt 演化能胜过强化学习。

它有两个想法。第一个是**反思**:不只看分数,还把执行过程和评分函数写的文字反馈交给反思模型,让它用自然语言分析错在哪,再写出新版 prompt。这和上面那张图的循环一模一样。第二个是**Pareto 前沿**:不只保留总分最高的那一个版本,而是保留「在某些样本上做得最好」的所有版本,下一轮从里面挑一个接着改。这个词明天配图细讲,今天知道它是为了「别把所有努力押在一个版本上」就够了。

论文的 arXiv 页面写着已被 ICLR 2026 接收为口头报告(Oral),摘要里报的数字是:在它测的任务上平均比 GRPO(一种强化学习方法,[Day 579](/blog/agent-zero/day-579-rl-1/) 会讲)高 6%、最多高 20%,用的 rollout(完整跑一次程序)少到 1/35;比 DSPy 自己的 MIPROv2 高 10% 以上。这些是论文作者在他们的任务上量的,数据量比我们的 60 条大得多,明天你会看到在小数据上远没有这么好看。

### ACE:不重写,只往手册里加条目

**ACE**(Agentic Context Engineering)也是 ICLR 2026 的论文。它点出了「反复整段重写 prompt」的两个毛病,论文的原话翻过来是:

- **简短偏好**(brevity bias):模型改写时喜欢写得短而漂亮,把有用的领域细节删掉。
- **上下文坍缩**(context collapse):一轮轮重写下来,早先积累的具体经验被一点点抹平。

ACE 的做法是把上下文当成一本「作战手册」(论文叫 playbook),分**生成、反思、整理**三个角色:生成者干活,反思者从结果里总结经验,整理者把经验写成带编号的条目加进手册,或者修改某一条,而不是从头重写。论文摘要报的是在 AppWorld 这个 Agent 基准上提升 10.6%,金融任务上提升 8.6%。

ACE 不限于分类 prompt,它更适合「经验会不断积累」的场景,比如 Agent 的规则库和长期记忆。Day 371 会写一个最小版,和明天的整段重写放在一起比。

### 三者是什么关系

一句话:DSPy 是框架,GEPA 是一种优化算法(住在 DSPy 里,也能单独用),ACE 是一种维护上下文的思路。

| | 改什么 | 怎么挑版本 | 适合 | 在哪天跑 |
| --- | --- | --- | --- | --- |
| 自己写的反思循环 | 整段重写 | 验证集分数不降就采用 | 理解原理、小任务 | Day 369 |
| GEPA(在 DSPy 里) | 整段重写,多个候选并存 | Pareto 前沿 + 验证集总分 | 有稳定评测集的分类、抽取、问答、多步程序 | Day 369 |
| ACE | 增量加减条目 | 每条规则帮了几次、害了几次 | 经验不断积累的 Agent、规则手册 | Day 371 |

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1DZhcznEeg&autoplay=0&high_quality=1" title="让大模型自动写Prompt：DSPy框架深度解读" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>牛不知道 · 让大模型自动写Prompt:DSPy框架深度解读 · 31 分钟,中文。把 Signature、Module、优化器三个词放在一起讲,看完再回来读第五步的 DSPy 那一节会顺很多。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/9auqBNC3AMU" title="Agentic Context Engineering: Self-Improving AI Playbooks" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Vivek Haldar · Agentic Context Engineering: Self-Improving AI Playbooks · 英文,讲 ACE 论文。重点听 brevity bias 和 context collapse 的例子,以及生成、反思、整理三个角色怎么分工。</figcaption>
</figure>

### 小结

手调 prompt 前几轮很有效,到后期剩下的是规则打架,加一句修两条、坏六条;而且边看边改的人用的就是全部数据,分数不可信。自动优化把「跑评测、读错例、改写、挑选」交给程序,它要三样东西:切好三份的带标签数据、能给出分数和文字反馈的评分函数、会改 prompt 的反思模型。DSPy 是框架,GEPA 是读反馈改写 prompt 的优化器,ACE 是只增量改条目的思路。今天的 `opt_task.py` 就是明天的尺子。

## 动手练习

### 练习 1:量一下噪声

不改任何东西,用 BASE 把验证集连跑 5 遍,记下每一遍的分数和错的编号,找出「时对时错」的工单。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part06/ex368_noise.py
"""练习 1:同一个 prompt 把验证集跑 5 遍,看哪几条时对时错。
用法: uv run python -m part06.ex368_noise"""
from __future__ import annotations

from collections import Counter

from common.llm import LLMClient
from part06.opt_task import BASE_PROMPT, evaluate, load

if __name__ == "__main__":
    client = LLMClient()
    val = load("val")
    wrong: Counter[str] = Counter()
    for i in range(1, 6):
        acc, errors = evaluate(client, BASE_PROMPT, val)
        wrong.update(e["id"] for e in errors)
        print(f"第 {i} 遍 val {acc:.0%}", sorted(e["id"] for e in errors))
    text = {r["id"]: r["ticket"] for r in val}
    print("\n时对时错的:")
    for tid, n in sorted(wrong.items()):
        if n < 5:
            print(f"  {tid} 错 {n}/5  {text[tid]}")
    print(client.ledger)
```

<div class="line-notes">

- `from collections import Counter` 计数用的字典,[Day 361](/blog/agent-zero/day-361-trajectory-2/) 写匹配模式时用过。
- `wrong: Counter[str] = Counter()` 键是工单编号,值是这条错了几遍。
- `wrong.update(e["id"] for e in errors)` `update` 把传进来的每个编号计数加 1。这一遍错的是 t11、t35、t38,三个计数各 +1。
- `text = {r["id"]: r["ticket"] for r in val}` 编号到原文的字典,最后打印时用。
- `if n < 5:` 5 遍都错的是「稳定地错」,不是噪声;错了 1 到 4 遍的才是时对时错。

</div>

```bash
uv run python -m part06.ex368_noise
```

实测输出:

```text
第 1 遍 val 85% ['t11', 't35', 't38']
第 2 遍 val 85% ['t11', 't35', 't38']
第 3 遍 val 85% ['t11', 't35', 't38']
第 4 遍 val 85% ['t11', 't35', 't38']
第 5 遍 val 85% ['t11', 't35', 't38']

时对时错的:
100 次调用 | 输入 12325 / 输出 630 tokens | 约 ¥0.0297
```

这一次 5 遍完全一样,一条时对时错的都没有。而第二步那三遍里 t14 错了两遍、对了一遍。两次实验放在一起才是真相:噪声不是每次都出现,它在某些时候、某几条上出现,而且就出在 t14 这种本身模棱两可的工单上(「希望报表加个筛选功能」,算功能建议 other,还是报表功能有缺陷 bug,人读也会犹豫)。所以「我跑了 5 遍都一样」不能证明没有噪声,只能说明这 5 遍运气稳定。比较两个 prompt 时,差距在一两条以内的,都当作没差别。

</details>

### 练习 2:BARE 错成了什么

用 BARE 在全部 60 条上跑一遍,按「正确类别 → 模型答的类别」计数,看哪种错最多。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part06/ex368_confusion.py
"""练习 2:BARE 起点在全部 60 条上错成了什么,按「正确 → 模型答」计数。
用法: uv run python -m part06.ex368_confusion"""
from __future__ import annotations

from collections import Counter

from common.llm import LLMClient
from part06.opt_task import BARE_PROMPT, evaluate, load

if __name__ == "__main__":
    client = LLMClient()
    rows = load("train") + load("val") + load("test")
    acc, errors = evaluate(client, BARE_PROMPT, rows)
    print(f"全部 {len(rows)} 条:{acc:.0%},错 {len(errors)} 条")
    pairs = Counter(f"{e['label']} → {e['pred']}" for e in errors)
    for pair, n in pairs.most_common():
        ids = [e["id"] for e in errors if f"{e['label']} → {e['pred']}" == pair]
        print(f"  {pair:<20} {n} 条  {ids}")
    print(client.ledger)
```

<div class="line-notes">

- `rows = load("train") + load("val") + load("test")` 列表用 `+` 拼起来,相当于 JS 的 `[...a, ...b, ...c]`。这是练习,看全部数据没关系;真要改 prompt 时不能这么看。
- `pairs = Counter(f"{e['label']} → {e['pred']}" for e in errors)` 每条错例变成一个「正确 → 模型答」的字符串再计数。这就是混淆矩阵里所有不在对角线上的格子。
- `for pair, n in pairs.most_common():` `most_common()` 按次数从多到少返回。
- `print(f"  {pair:<20} {n} 条  {ids}")` `:<20` 左对齐占 20 格,让后面的数字对齐。

</div>

```bash
uv run python -m part06.ex368_confusion
```

实测输出:

```text
全部 60 条:80%,错 12 条
  refund → billing     4 条  ['t01', 't16', 't38', 't60']
  billing → other      2 条  ['t35', 't57']
  refund → account     1 条  ['t13']
  billing → bug        1 条  ['t22']
  account → bug        1 条  ['t31']
  other → bug          1 条  ['t14']
  bug → invoice        1 条  ['t12']
  refund → invoice     1 条  ['t21']
60 次调用 | 输入 4426 / 输出 380 tokens | 约 ¥0.0119
```

最多的是 refund → billing,4 条全是「被扣了钱」的工单:扣了两次、取消后又扣、多付的差价、扣了两次年费。BARE 没有任何定义,模型看到「扣」就想到 billing。这正是标注规范的第一条「重复扣款一律算 refund」。明天优化器能不能学回这一条,就是看它的第一个指标。第二多的是 billing → other,t35「盖章报价单」和 t57「教育优惠」,模型觉得这是售前咨询;标注规范把价格类都算 billing,这个规定不太直观,模型猜不到很正常。

</details>

### 练习 3:守纪律地手调一版

按规矩手调一次:只看 BASE 在**训练集**上的错例写规则,在训练集和验证集上和 BASE 比,定稿后测试集只跑一次。

<details><summary>参考答案</summary>

BASE 在训练集上错的是 t13(注销退余额 → account)和 t22(PAY_TIMEOUT → bug),它们的理由分别是「涉及把钱退回给客户时 refund 优先于 account」和「付款没成功属于 billing,不是 bug」。照着这两条写两句规则,写得通用,不抄工单原文:

```python
# agent-zero-lab/part06/ex368_v3.py
"""练习 3:守纪律地手调一版。只看训练集的错例写规则,在训练集和验证集上比,定稿后测试集只跑一次。
用法: uv run python -m part06.ex368_v3"""
from __future__ import annotations

from common.llm import LLMClient
from part06.opt_task import BASE_PROMPT, evaluate, load

V3 = BASE_PROMPT + """
补充规则:
1. 客户要求把已付的钱退回(包括注销时退余额),算 refund,优先于 account。
2. 付款没成功(超时、被拒、余额不足),算 billing,哪怕页面出现英文错误码。"""

if __name__ == "__main__":
    client = LLMClient()
    for name, prompt in [("BASE", BASE_PROMPT), ("v3", V3)]:
        for split in ["train", "val"]:
            acc, errors = evaluate(client, prompt, load(split))
            print(f"{name} {split}: {acc:.0%}", [f"{e['id']} {e['label']}→{e['pred']}" for e in errors])
    acc, errors = evaluate(client, V3, load("test"))
    print(f"\n定稿 v3,测试集只跑这一次: {acc:.0%}", [f"{e['id']} {e['label']}→{e['pred']}" for e in errors])
    print(client.ledger)
```

<div class="line-notes">

- `1. 客户要求把已付的钱退回(包括注销时退余额),算 refund,优先于 account。` 从 t13 的理由来,写成通用规则。注意「已付的钱退回」比第三步 v1 的「涉及钱」窄得多。
- `2. 付款没成功(超时、被拒、余额不足),算 billing,哪怕页面出现英文错误码。` 从 t22 的理由来。
- `for name, prompt in [("BASE", BASE_PROMPT), ("v3", V3)]:` 两个版本在同样的两份数据上比,测试集不在这个循环里。
- `acc, errors = evaluate(client, V3, load("test"))` 定稿以后才碰测试集,而且只跑这一次。如果这里的分数不好看,也不能回去改 V3 再跑,否则测试集就变成了第二个验证集。

</div>

```bash
uv run python -m part06.ex368_v3
```

实测输出:

```text
BASE train: 90% ['t13 refund→account', 't22 billing→bug']
BASE val: 80% ['t11 billing→invoice', 't14 other→bug', 't35 billing→other', 't38 refund→billing']
v3 train: 95% ['t31 account→bug']
v3 val: 85% ['t11 billing→invoice', 't14 other→bug', 't35 billing→other']

定稿 v3,测试集只跑这一次: 95% ['t57 billing→other']
100 次调用 | 输入 15548 / 输出 633 tokens | 约 ¥0.0362
```

训练集修好了 t13、t22,又冒出 t31(登录跳转 E1101 → bug),和第三步 v2 一样的新错,看来只要在定义后面多加几句话,t31 就容易被带偏。验证集 80% 到 85%,多对的是 t38。测试集 95%,比第二步 BASE 的 90% 多对一条(t12 这次答对了)。

能下的结论很有限:两份数据上各多对一条,都在 5 个百分点的噪声以内。我不会说 v3 比 BASE 好,只会说「没有变差,规则也说得通」。这就是守纪律的代价:你得到的数字比第三步那个 54/60 难看,但它是真的。

</details>

### 练习 4(开放题):该用哪个

下面三个场景,你会先用自写反思循环、GEPA 还是 ACE 的思路?各写一两句理由。

1. 一个抽发票字段的 prompt,有 300 条标注好的样本,每条都能自动判对错。
2. 一个客服 Agent,每天都有客服纠正它的处理方式,希望它把这些经验一条条记下来,越用越熟。
3. 你刚接手一个分类 prompt,想先搞明白「自动优化」到底在干什么,数据只有 40 条。

<details><summary>参考答案</summary>

这道题没有唯一答案,下面是我的选择和理由。

1. **GEPA。** 300 条、能自动判分、任务边界清楚,正是它擅长的。评分函数里要写具体的反馈,比如「发票号码少了一位,应为 12 位」。数据切成训练、验证、测试,测试集不少于 100 条。
2. **ACE 的思路。** 经验是一条条来的,而且会越积越多,整段重写会把早先的经验抹掉(上下文坍缩)。增量加条目、给每条记帮了几次害了几次,才留得住。Day 371 会写一个最小版。
3. **自写反思循环。** 60 行就能写完,每一步你都看得见,数据少也能跑。40 条切三份每份才十几条,先别对分数抱期望,目的是理解原理;等明白了它在干什么,再去扩数据、上框架。

</details>

### 验收标准

- `opt_task.py` 能在 `agent-zero-lab` 根目录用 `uv run python -m part06.opt_task` 跑通,输出格式和文中一致,分数允许有一两条出入。
- 能不看文章说出训练集、验证集、测试集各自是干什么的,以及为什么验证集的分数也会虚高。
- 能对着 `hand_tune.py` 的输出讲清楚 v1 为什么带坏了 6 条,v2 的 54/60 为什么不可信。
- 能用一句话分别说出 DSPy、GEPA、ACE 是什么,以及它们三个的关系。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 自动 prompt 优化(APO) | 让程序替你迭代 prompt:跑评测、读错例、生成新版本、按分数挑选 |
| 标注理由 `why` | 标注员写的一句判断依据,如「付款没成功属于 billing,不是 bug」,优化器靠它知道往哪改 |
| 训练集 / 验证集 / 测试集 | 给优化器看错例的 / 给优化器挑版本的 / 最后只量一次、全程不参与决定的 |
| 文字反馈 | 评分函数在分数之外返回的解释,告诉反思模型为什么错 |
| 反思模型 | 读 prompt、错例和反馈,写出新版 prompt 的模型 |
| DSPy | 斯坦福开源的 Python 框架,用 Signature 和 Module 声明调用逻辑,prompt 由框架生成,并带一批优化器 |
| Signature | DSPy 里一步调用的输入输出契约:有哪些字段、什么类型、指令是什么 |
| Module | DSPy 里的调用方式,如 `Predict`(直接答)、`ChainOfThought`(先想再答) |
| 优化器 / teleprompter | DSPy 里调整程序的算法,如 BootstrapFewShot、MIPROv2、GEPA |
| GEPA | Genetic-Pareto,用自然语言反思改写 prompt,并保留多个候选的优化器 |
| Pareto 前沿 | 在每个样本上都不被别的候选全面超过的那一组候选,明天细讲 |
| rollout | 把要优化的程序完整跑一次,算一次花费 |
| ACE | Agentic Context Engineering,把上下文当成手册,由生成、反思、整理三个角色增量维护 |
| 简短偏好 brevity bias | 模型改写时倾向写短,丢掉有用的细节 |
| 上下文坍缩 context collapse | 反复整段重写后,早先积累的细节被逐渐抹掉 |

## 常见误区

**看全部数据改 prompt,然后报全部数据上的分数。** 第三步的 v2 就是这样,54/60 看着比 v0 好,可它是看着这 60 条写出来的,没有任何一份数据能替它作证。改之前先切出测试集,改的时候不看它。

**验证集涨了 5 个点就算进步。** 20 条上一条工单就是 5 个点,而 t14 这种工单在 temperature=0 下也会时对时错。差距在一两条以内的,当作没差别。

**规则写得越宽越省事。** 「涉及钱一律 refund」一句话修好 2 条,带坏 6 条。规则要写清楚它管什么、不管什么,最好同时写出反例。

**以为 temperature=0 就每次一样。** 第二步三遍里 t14 换了答案,练习 1 的五遍又完全一样。DeepSeek 不承诺 0 温度下完全可复现([Day 112](/blog/agent-zero/day-112-sampling-2/) 讲过),比较版本时要么多跑几遍,要么接受噪声。

**标注理由写成「应为 billing」。** 这句话等于没写,它只重复了标签。理由要写判断依据:「付款没成功属于 billing,不是 bug,即使页面出现英文错误码」。明天你会看到反思模型几乎是照着这些理由在写规则。

**把 DSPy 和 GEPA 当成两个竞争的东西。** GEPA 是 DSPy 里的一个优化器,也能单独用。DSPy 本身是框架,不优化也能用来写调用模型的程序。

## 学习资料

### 文档与文章

- [DSPy 官网](https://dspy.ai):英文。先看首页的 Signature 和 Module 小例子,再看 Optimizers 那一页对各优化器的一句话介绍,30 分钟。
- [DSPy · Signatures](https://dspy.ai/learn/programming/signatures/):英文,Signature 的写法和字段类型,明天第一个脚本照它写,15 分钟。
- [DSPy · Optimizers 总览](https://dspy.ai/learn/optimization/optimizers/):英文,每种优化器调的是什么(指令、示例、权重),20 分钟。
- [GEPA 论文(arXiv 2507.19457)](https://arxiv.org/abs/2507.19457):英文。今天只读摘要和引言,知道它的两个想法;算法部分明天再读。
- [ACE 论文(arXiv 2510.04618)](https://arxiv.org/abs/2510.04618):英文。读引言里 brevity bias 和 context collapse 的例子,以及三个角色的分工图,30 分钟。
- [DSPy 论文(arXiv 2310.03714)](https://arxiv.org/abs/2310.03714):英文。想理解「把 prompt 当程序编译」这个立场,读前两节就够。
- [Hamel Husain · Your AI Product Needs Evals](https://hamel.dev/blog/posts/evals/):英文。为什么先有评测再谈优化,和今天第四步的「三样东西」是一个意思,20 分钟。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV16ATuzoE8o&autoplay=0&high_quality=1" title="吴恩达《DSPy：构建与优化智能代理应用|DSPy: Build and Optimize Agentic Apps》中英字幕" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>GPT中英字幕课程资源 · 吴恩达《DSPy:构建与优化智能代理应用》中英字幕 · DeepLearning.AI 和 DSPy 团队合作的短课,约 50 分钟。今天看讲 Signature、Module 的前几节,优化器那几节留到明天。</figcaption>
</figure>

- 正文里嵌的「牛不知道 · 让大模型自动写Prompt:DSPy框架深度解读」也在这一组。

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/-cKUW6n8hBU" title="DSPy: The End of Prompt Engineering - Kevin Madura, AlixPartners" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>AI Engineer · DSPy: The End of Prompt Engineering(Kevin Madura,AlixPartners)· 英文,一个在咨询公司里真用 DSPy 的人讲为什么不再手写 prompt。标题很夸张,听的时候对照今天第四步那句「自动优化不替你决定规则对不对」。</figcaption>
</figure>

- 正文里嵌的 Vivek Haldar《Agentic Context Engineering: Self-Improving AI Playbooks》也在这一组。

### 书籍

- Chip Huyen《AI Engineering》(O'Reilly,2025):第 5 章 Prompt Engineering 讲手调 prompt 的方法和局限,第 3、4 章讲评测,英文。
- John Berryman、Albert Ziegler《Prompt Engineering for LLMs》(O'Reilly,2024):手写 prompt 的系统方法,适合当「优化器给出的规则合不合理」的判断参照,英文。

### 开源项目与代码

- [stanfordnlp/dspy](https://github.com/stanfordnlp/dspy):DSPy 源码。今天先看 README 里的例子。
- [gepa-ai/gepa](https://github.com/gepa-ai/gepa):不依赖 DSPy 的 GEPA,README 里有接自定义系统的例子。
- [ace-agent/ace](https://github.com/ace-agent/ace):ACE 的官方实现,Day 371 会对照它。

## 自测

1. 自动优化 prompt 至少需要哪三样东西?

<details><summary>答案</summary>

一份带标签的数据,切成训练、验证、测试三份;一个能给 prompt 打分的评分函数,最好在分数之外给出文字反馈;一个能读错例并写出新版本的反思模型。

</details>

2. 为什么要切三份,而不是 [Day 354](/blog/agent-zero/day-354-testset-size/) 的开发集和留出集两份?

<details><summary>答案</summary>

优化器做两件事:对着训练集的错例改,拿验证集挑版本。挑版本也是一种拟合,挑得越多,验证集分数越虚高。所以还要一份从头到尾不参与任何决定的测试集,最后只量一次,它的分数才可信。

</details>

3. `hand_tune.py` 里 v1 只加了一句话,为什么带坏了 6 条?

<details><summary>答案</summary>

「凡是涉及钱的问题一律优先算 refund」写得太宽。它是从 t13、t38 两条「要退钱」的错例里总结的,但很多工单提到钱却不是要退钱:问怎么关自动续费(t08)、付款失败(t19)、扣了钱状态没更新(t41)、扣款记录对不上(t49),甚至报表合计算错(t39)。规则在它见过的两条上是对的,在没见过的反例上是错的。

</details>

4. 用一句话分别说出 DSPy、GEPA、ACE 是什么。

<details><summary>答案</summary>

DSPy:把调用模型写成「声明输入输出 + 选调用方式」的程序、prompt 由框架生成的 Python 框架。GEPA:DSPy 里的一个优化器,读评分函数的文字反馈改写 prompt,并保留多个各有所长的候选。ACE:把上下文当手册、只增量加减条目的思路,用来避开整段重写带来的简短偏好和上下文坍缩。

</details>

5. ACE 论文说的「简短偏好」和「上下文坍缩」分别是什么?

<details><summary>答案</summary>

简短偏好:模型改写 prompt 时倾向写得短而漂亮,把有用的领域细节删掉。上下文坍缩:一轮轮整段重写下来,早先积累的具体经验被逐渐抹平。两者都来自「每次从头重写」,ACE 的对策是只增量改条目。

</details>

6. (面试题)面试官问:「你们的 prompt 是怎么迭代的?会不会越改越乱?」你怎么答?

<details><summary>答案</summary>

要点:①先有尺子:带标签和判断理由的数据,切成训练、验证、测试,测试集只在定稿后量一次;②每改一版都在同一份数据上重跑,列出这一版修好了哪些、带坏了哪些,而不是只看总分;③规则写清楚管什么、不管什么,宽规则(比如「涉及钱一律退款」)会把一片没见过的工单带偏,举一个自己踩过的例子;④小数据上一条样本就是好几个百分点,差距在噪声内的当作没差别;⑤手调到规则打架时,可以把「读错例、改写、挑选」交给 GEPA 这类优化器,但它的产出要人审,过测试集门禁才上线。

</details>

## 明天预告

Day 369 · 自动优化提示词(二):自己写反思循环,用 DSPy 跑 GEPA。今天准备好了数据、两个起点和尺子,也摸到了手调的天花板。明天先用 60 行代码自己写一个「读错例 → 反思 → 改写 → 验证集验收」的循环,再用 DSPy 的 GEPA 跑同一个任务,看两种自动优化在这 60 条工单上各把分数提了多少、在哪里把规则写宽了、花了多少钱。
