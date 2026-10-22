---
title: 'Day 468 · 第 67 周复习:毕业项目(Day 462–467)'
description: '这一周 SupportPilot 的后端走完了最后一段:图和路由、不花钱的端到端测试、三种记忆、HTTP 接口。今天画出这六天的地图,默写 _events 和 maybe_compress,再写一个只走 HTTP 的测试把一张工单从建单、审批一路聊到压缩。拼的时候冒出两个各天单看都没问题的坑:第二轮停在审批时 done 报的是上一轮的 resolved;一次追问出错后工单被卡死,再问就 409。'
pubDate: 2026-10-22
regime: none
tags: ['review', 'langgraph', 'fastapi', 'pytest', 'supportpilot', 'agent-zero']
series: 'agent-zero'
day: 468
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 467](/blog/agent-zero/day-467-ui-api/) 先修了一个只在服务端出现的 bug:所有请求共用一个 `LLMClient`,差值法记的成本互相串,改成每个请求 `deps.fresh()` 一本新账本,又顺着找到 `profile_for` 那个 `partial` 抓住了启动时的旧客户端。然后用 FastAPI 自带的 SSE 写了六个接口、七种事件,真模型和 curl 把一张退款工单从建单走到审批完成,TestClient 加假模型写了 3 个不花钱的接口测试。

这一周正好六天。Day 462–463 把九个节点连成图并测通,Day 464–466 加了三种记忆,Day 467 把整个工作流包成 HTTP 服务。从 Day 469 开始写前端,前端只认接口和事件,后端这一层有什么含糊的地方,到了浏览器里都会变成「界面显示不对」,很难再往回查。所以今天把后端再过一遍。

## 今天要解决的问题

复习日不学新东西,目标是确认这一周的东西真的长在你手上了。今天结束时你应该能:

1. 不看文章,说出一张工单从 `POST /tickets` 到最后一条 `done` 经过了哪些节点、哪几种记忆在什么时候读写、成本是怎么一笔笔记到这张工单头上的。
2. 默写 `_events` 和 `maybe_compress` 两段核心代码,用现成的测试证明写对了。
3. 跑通本周小项目 `tests/test_week67.py`:只通过 HTTP 接口,让一张退款工单跑到审批、审批、再追问三次触发压缩,断言事件顺序、切点、对话条数和精确到 0.00001 元的成本。
4. 复现并修好两个「拼起来才出现」的坑:第二轮停在审批时 `done` 里的 outcome 还是上一轮的 resolved;追问出错后工单卡在半路,客户再问一句收到 409「还在等待审批」。

预计用时 3.5 小时(大头在默写和练习)。前置:[Day 462](/blog/agent-zero/day-462-flow-graph/) 到 [Day 467](/blog/agent-zero/day-467-ui-api/) 全部。

学法:先对照文章逐行敲一遍(不复制粘贴)并跑通;第二天合上文章,把 `_events` 和 `maybe_compress` 默写出来;做练习,做不出再展开参考答案,看完关掉自己重写一遍。

## 本周知识地图

<figure>
<svg viewBox="0 0 640 360" role="img" aria-label="本周知识地图:上排是工作流线,Day 462 图和路由、Day 463 假零件测试;中排是记忆线,Day 464 对话、Day 465 压缩、Day 466 画像;下排是 Day 467 的接口层;三条线都汇到一张工单的状态和 checkpoint 上">
  <rect x="0" y="0" width="640" height="360" fill="var(--paper-raised)"/>
  <g font-family="var(--font-mono)" font-size="11">
    <text x="20" y="24" fill="var(--ink)">工作流:节点怎么连、怎么测</text>
    <rect x="20" y="36" width="190" height="66" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
    <text x="32" y="56" fill="var(--ink)">462 图和路由</text>
    <text x="32" y="74" fill="var(--ink-soft)">路由函数只读状态</text>
    <text x="32" y="91" fill="var(--ink-soft)">第三个参数必须写</text>
    <rect x="240" y="36" width="190" height="66" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
    <text x="252" y="56" fill="var(--ink)">463 假零件和端到端</text>
    <text x="252" y="74" fill="var(--ink-soft)">FakeLLM 按提示词认人</text>
    <text x="252" y="91" fill="var(--ink-soft)">10 张真工单 0.17 元</text>
    <line x1="210" y1="69" x2="240" y2="69" stroke="var(--ink-soft)"/>
    <text x="20" y="136" fill="var(--ink)">记忆:一张工单里、跨工单</text>
    <rect x="20" y="148" width="190" height="66" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
    <text x="32" y="168" fill="var(--ink)">464 对话 turns</text>
    <text x="32" y="186" fill="var(--ink-soft)">reducer 追加 · 每轮重置</text>
    <text x="32" y="203" fill="var(--ink-soft)">PostgresSaver</text>
    <rect x="230" y="148" width="190" height="66" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
    <text x="242" y="168" fill="var(--ink)">465 压缩</text>
    <text x="242" y="186" fill="var(--ink-soft)">summary + summarized_upto</text>
    <text x="242" y="203" fill="var(--ink-soft)">切点退到客户消息</text>
    <rect x="440" y="148" width="180" height="66" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
    <text x="452" y="168" fill="var(--ink)">466 客户画像</text>
    <text x="452" y="186" fill="var(--ink-soft)">排除当前工单</text>
    <text x="452" y="203" fill="var(--ink-soft)">forget_customer</text>
    <line x1="210" y1="181" x2="230" y2="181" stroke="var(--ink-soft)"/>
    <line x1="420" y1="181" x2="440" y2="181" stroke="var(--ink-soft)"/>
    <text x="20" y="248" fill="var(--ink)">接口:把工作流交给浏览器</text>
    <rect x="20" y="260" width="400" height="66" rx="6" fill="var(--compute-wash)" stroke="var(--compute)"/>
    <text x="32" y="280" fill="var(--ink)">467 六个接口 · 七种事件</text>
    <text x="32" y="298" fill="var(--ink-soft)">fresh() 每请求一本账 · 404/409 放进依赖</text>
    <text x="32" y="315" fill="var(--ink-soft)">一个流以 done 或 error 结束,只有一个</text>
    <rect x="460" y="250" width="160" height="86" rx="6" fill="var(--paper)" stroke="var(--ink-soft)" stroke-dasharray="4 3"/>
    <text x="472" y="272" fill="var(--ink)">今天拼起来</text>
    <text x="472" y="291" fill="var(--ink-soft)">outcome 没重置</text>
    <text x="472" y="309" fill="var(--ink-soft)">出错后被 409 卡死</text>
    <text x="472" y="327" fill="var(--ink-soft)">turns 不再一问一答</text>
    <line x1="420" y1="293" x2="460" y2="293" stroke="var(--ink-soft)" stroke-dasharray="3 2"/>
    <line x1="530" y1="214" x2="530" y2="250" stroke="var(--ink-soft)" stroke-dasharray="3 2"/>
    <line x1="335" y1="102" x2="335" y2="148" stroke="var(--ink-faint)" stroke-dasharray="3 2"/>
    <text x="342" y="130" fill="var(--ink-faint)">每天的改动都靠 463 的假零件验</text>
  </g>
</svg>
<figcaption>三条线最后都落在同一个地方:一张工单的状态(SupportState)和它在 Postgres 里的 checkpoint。右下角是今天把六天拼在一起时才发现的三件事。</figcaption>
</figure>

这张图想说的一件事是:**这一周所有东西都落在同一份状态上**。Day 462 的路由函数读它,Day 463 的测试断言它,Day 464 往里追加 turns,Day 465 加了 summary 和 summarized_upto,Day 466 加了 profile,Day 467 的 `_summary` 从它里面挑字段给前端。每多一个字段,就要回答同一组问题:它是跨轮保留的还是每轮重置的?谁写、谁读?前端看到它会怎么理解?

Day 464 画过一张「跨轮保留 / 每轮重置」的表,Day 465 往左边一列加了两个字段。今天会看到,这张表在 Day 467 之后又漏了两行,漏的后果要到有了前端才看得见。

回头看,这周的代码从 Day 462 到 Day 467 一直在长,但有一样东西没变:每加一样功能,都先在 Day 463 的假零件上跑通,再花几分钱让真模型跑一次。今天的小项目也照这个规矩来,全程假模型,一分钱不花。

## 本周每天一句话

[Day 462 · 图、路由,为什么不用预置 agent](/blog/agent-zero/day-462-flow-graph/):三个路由函数是只读状态、不调模型的普通函数,先手写状态字典把每条分支调出来;`add_conditional_edges` 的第三个参数一定要写,不写时名字拼错只打一行警告、图悄悄结束;预置的 `create_agent` 适合工具少、流程靠模型自己决定的场景,我们的 act 要加步数上限和审批前置,所以自己写。

[Day 463 · 不花钱的单测和端到端 10 张工单](/blog/agent-zero/day-463-flow-e2e/):`FakeLLM` 按系统提示认出是谁在调它,剧本写死、进对象前先复制;11 个测试覆盖政策问答、退款停在审批再恢复、转人工作废申请、质检两次不过;真模型跑 10 张演示工单合计 0.17 元,不完美的地方先记进问题清单,等 Day 476 有了评测集再改。

[Day 464 · 工单内的对话状态](/blog/agent-zero/day-464-memory-session/):`turns` 挂 `operator.add` 才是追加;每轮开头在 `load_customer` 一处把「本轮」字段重置;checkpoint 换成 PostgresSaver,进程重启后用工单号接着聊;重新造数后工单号从头编,新工单接上了旧对话,所以造数前先清快照。

[Day 465 · 对话太长时压缩](/blog/agent-zero/day-465-memory-compact/):`estimate_tokens` 粗估、用真接口校准;`maybe_compress` 只在超预算时把早期部分并进滚动摘要,原文一条不删,用 `summarized_upto` 记切点;切点要退到客户消息,忘了返回 `summarized_upto` 时 803 个 token 比不压的 727 还多。

[Day 466 · 跨工单的客户画像和新问题](/blog/agent-zero/day-466-memory-profile/):画像存在 `biz.customer_profiles`,只在已解决的历史工单数变了时重写;数数和取历史都要排除当前工单;没给客户档案时模型两次都写成「非 VIP」;客户要求删除时 `forget_customer` 删快照和画像。

[Day 467 · 并发成本 bug、接口设计和 SSE 事件协议](/blog/agent-zero/day-467-ui-api/):共用账本时两张一样的工单算出 0.00388 和 0.00668,`fresh()` 修好后都是 0.00352;六个接口、七种事件,能提前判断的错误放进依赖返回 404/409,推流中的错误推 error;恢复时 LangGraph 先给被打断的节点报一个 None 更新,要跳过。

哪一句你读着觉得「好像是这样,但说不清为什么」,先回那一天把对应小节重看一遍再往下走。

## 准备环境

今天的代码都在毕业项目仓库 `supportpilot/` 里,不建新目录,只新增几个测试文件和 `scratch/d468/` 下的两个小脚本。用到的文件:

| 文件 | 哪天建的 | 今天用它做什么 |
| --- | --- | --- |
| `src/supportpilot/api/app.py` | Day 467 | 默写一 `_events`;今天改两处 |
| `src/supportpilot/memory/compress.py` | Day 465 | 默写二 `maybe_compress` |
| `src/supportpilot/agent/nodes.py` | Day 460,464–467 改过 | 今天给 `load_customer` 的重置列表加两项 |
| `tests/fakes.py` | Day 463,465–467 改过 | 假模型、假工具 |
| `tests/test_api.py` | Day 467 | 小项目复用它的 `client` fixture 和 `parse_sse` |
| `tests/test_graph_smoke.py`、`tests/test_memory.py` | Day 463、464 | 复用李娜退款和吴刚银行同步两套剧本 |

先确认起点是绿的。在 supportpilot 根目录:

```bash
cd supportpilot
mkdir -p scratch/d468
uv run pytest -q
```

实测 `56 passed`(Day 467 正文 53 个,加练习 1、2、3 的 3 个)。如果你没做 Day 467 的练习,这里是 53,也没关系,但要确认 `_events` 里已经有练习 3 加的那两行 `elif update is None: continue`,今天默写的标准答案以它为准。

今天全程用假模型,真模型**花费是 0**。用到连库的测试(打了 `@pytest.mark.db` 的),要 Postgres 开着、`.env` 里的 `DATABASE_URL` 指向你的开发库。我实跑时的版本:Python 3.12.13、pytest 9.1.1、fastapi 0.159.1、langgraph 1.2.16(2026 年 10 月装的)。

## 默写一:`_events`

`_events` 是接口层的心脏,明天写前端读流,读的就是它推出来的东西。合上 Day 467,在一个新文件里写出来。提示:它要做五件事,开两种流模式;custom 的直接按 `type` 推;updates 里 `__interrupt__` 推 interrupt、None 跳过、其余推 node;任何异常写日志、推一条固定的 error、不再推 done;正常结束推 done。

写完对照下面的标准答案,这是 `api/app.py` 里的原文(加了 Day 467 练习 3 的两行):

```python
# supportpilot/src/supportpilot/api/app.py(节选:_events)
def _events(graph, payload: Any, ticket_id: str) -> Iterator[ServerSentEvent]:
    """把 LangGraph 的流翻译成前端认识的七种事件。同步生成器,FastAPI 会放进线程池里跑。"""
    try:
        for mode, chunk in graph.stream(payload, _cfg(ticket_id), stream_mode=["updates", "custom"]):
            if mode == "custom":
                yield _sse(chunk["type"], chunk)
                continue
            for node, update in chunk.items():
                if node == "__interrupt__":
                    yield _sse("interrupt", update[0].value)
                elif update is None:  # 练习 3:恢复时 LangGraph 先给被打断的节点报一个空更新,它还没跑完
                    continue
                else:
                    yield _sse("node", {"node": node})
    except Exception:
        log.exception("ticket %s failed", ticket_id)  # 细节写服务端日志,不推给浏览器
        yield _sse("error", {"message": "处理出错了,已经记录,请稍后重试"})
        return
    yield _sse("done", _summary(graph, ticket_id))
```

<div class="line-notes">

- `def _events(graph, payload: Any, ticket_id: str) -> Iterator[ServerSentEvent]:` 三个流式接口共用它,区别只在 payload:`/run` 是 `{"ticket": ...}`,追问是 `{"turns": [一条客户消息]}`,审批是 `Command(resume=...)`。
- `for mode, chunk in graph.stream(payload, _cfg(ticket_id), stream_mode=["updates", "custom"]):` 同时开两种模式,每个元素是 `(模式名, 数据)`。thread_id 就是工单号,同一张工单的几次请求靠它接上。
- `if mode == "custom":` custom 是节点里 `_emit()` 主动推的字典,`type` 是 step、tool、token 三选一。Day 467 那张退款工单实测推了 4 个 step、4 个 tool、54 个 token。
- `yield _sse(chunk["type"], chunk)` 事件名直接用 `type`。
- `for node, update in chunk.items():` updates 是 `{节点名: 这个节点的返回值}`。
- `if node == "__interrupt__":` 停在 approval 的 `interrupt()` 时出现的特殊键。
- `yield _sse("interrupt", update[0].value)` `update` 是 Interrupt 对象的元组,`.value` 是 approval 节点交给 `interrupt()` 的字典,里面有 request、draft、needs_finance_review。
- `elif update is None:` 审批恢复时第一条 updates 是 `{'approval': None}`,节点其实还没跑完。不跳过的话,审批失败时前端会先看到一条「approval 完成」再看到 error。
- `yield _sse("node", {"node": node})` 只推节点名。整份更新里有草稿、工具结果、客户档案,太大,也有不该给客户看的。
- `except Exception:` 不接住的话生成器直接中断,浏览器只看到连接断了。
- `log.exception("ticket %s failed", ticket_id)` 堆栈写服务端日志。Day 467 实测那次异常信息里有退款申请编号。
- `return` 出错就不再推 done。**一个流以 done 或 error 结束,只有一个**,前端靠这条判断这次请求结束了。
- `yield _sse("done", _summary(graph, ticket_id))` 正常跑完、或者停在了 interrupt,都推 done。

</div>

检查的办法:把你默写的版本替换进 `api/app.py`(先 `cp src/supportpilot/api/app.py scratch/d468/app_backup.py` 备份),然后跑 Day 467 的两个接口测试文件:

```bash
uv run pytest tests/test_api.py tests/test_api_more.py -q
```

全对是 `5 passed`(正文 3 个加练习 1、3 各 1 个)。我自己默写时漏掉的是 except 里那个 `return`,测试是这么报的(真实输出,节选):

```text
E       AssertionError: assert ('done', {'ti...': None, ...}) == ('error', {'m...,已经记录,请稍后重试'})
E       AssertionError: assert ['error', 'done'] == ['error']
E         Left contains one more item: 'done'
2 failed, 3 passed in 4.08s
```

第一条是 `test_failure_becomes_error_event`:最后一个事件变成了 done,而且 done 里的 outcome 是 None,前端会以为跑完了、没有结局。第二条是 Day 467 练习 3 的测试,事件序列多了一个 done。少一个 `return`,「只有一个收尾事件」这条约定就破了。

## 默写二:`maybe_compress`

第二段挑 `maybe_compress`,因为它有一个很容易写错又很难被发现的地方,下面会看到。合上 Day 465,写出它。提示:只看还没被摘要的那部分;没超预算或者条数不够就原样返回、不调模型;切点先按「保留最后 keep_last 条」算,再往前退到客户消息;退到 0 就不压;压的时候把已有摘要带上,返回新摘要和新的 upto。

标准答案是 `memory/compress.py` 里的原文:

```python
# supportpilot/src/supportpilot/memory/compress.py(节选:maybe_compress)
def maybe_compress(llm: LLMClient, turns: list[dict], summary: str, upto: int,
                   budget: int = 1200, keep_last: int = 4) -> tuple[str, int]:
    """「摘要 + 还没被摘要的轮次」超过 budget 时,把除最后 keep_last 条以外的部分并进摘要。
    返回新的 (summary, upto):turns[:upto] 已经被摘要覆盖。没超预算就原样返回,不调模型。"""
    pending = turns[upto:]
    if estimate_tokens(summary + render_turns(pending)) <= budget or len(pending) <= keep_last:
        return summary, upto
    cut = len(pending) - keep_last
    while cut > 0 and pending[cut]["role"] != "customer":   # 保留的部分从客户消息开始,别把一问一答拆开
        cut -= 1
    if cut == 0:
        return summary, upto
    to_fold = pending[:cut]
    text = (f"已有摘要:\n{summary}\n\n" if summary else "") + "新增对话:\n" + render_turns(to_fold)
    res = llm.chat([{"role": "system", "content": SUMMARY_PROMPT}, {"role": "user", "content": text}],
                   temperature=0)
    return res.content.strip(), upto + len(to_fold)
```

<div class="line-notes">

- `pending = turns[upto:]` 只看还没被摘要覆盖的部分。切片相当于 JS 的 `turns.slice(upto)`。
- `if estimate_tokens(summary + render_turns(pending)) <= budget or len(pending) <= keep_last:` 两个条件任一成立就不压。第二个条件防的是「剩下的本来就不到 keep_last 条,压了也没东西可压」。
- `return summary, upto` 原样返回,一分钱不花。Day 465 的 `test_no_call_when_under_budget` 断言的就是这里调用次数为 0。
- `cut = len(pending) - keep_last` 先按条数算切点。注意 `cut` 是 **pending 里的下标**,不是 turns 里的。
- `while cut > 0 and pending[cut]["role"] != "customer":` 往前退,直到保留部分的第一条是客户消息。这一行下面专门讲。
- `if cut == 0:` 退到头了还没找到客户消息,说明没法切,这一轮不压。
- `text = (f"已有摘要:\n{summary}\n\n" if summary else "") + "新增对话:\n" + render_turns(to_fold)` 滚动摘要:旧摘要和新增的对话一起交给模型重写。
- `temperature=0)` 摘要要稳,别每次措辞都变。
- `return res.content.strip(), upto + len(to_fold)` 新的切点是「旧切点 + 这次折进去的条数」,因为 `to_fold` 的下标是相对 pending 的。

</div>

检查:

```bash
uv run pytest tests/test_compress.py tests/test_compress_more.py -q
```

全对是 `8 passed`(Day 465 正文 7 个加练习 1 个)。我试了两种最常见的写错法,结果很有意思。

把最后一行写成 `return res.content.strip(), len(to_fold)`,忘了加旧的 upto:

```text
E       assert 10 == 16
FAILED tests/test_compress.py::test_rolling_summary_includes_old_one - assert...
1 failed, 7 passed in 1.92s
```

这个错测试能抓住,第二次压缩时切点从 16 倒退回 10。

把 while 那一行写成 `turns[cut]["role"]`,下标用错了数组:`8 passed`,**全部通过**。等下面的小项目写好,我把它也加进来一起跑,还是 `9 passed`。

为什么?SupportPilot 的 turns 一直是一问一答交替的,客户、客服、客户、客服。切点永远停在客户消息上,所以 upto 永远是偶数。偶数加任何数,`turns[cut]` 和 `pending[cut]`(也就是 `turns[upto + cut]`)的奇偶相同,角色也就相同。这个下标错误被「对话永远交替」这个巧合盖住了。

那 turns 会不会不交替?今天的小项目跑完,你会看到一种情况:会。练习 2 专门写一个测试把它抓出来。

## 本周小项目:一张工单走完这一周

前面每天的测试都只测那一天的东西:Day 463 测图、Day 465 测压缩、Day 467 测接口。今天写一个测试,**只通过 HTTP 接口**,让一张工单把这一周所有的东西都走一遍。它是前端的视角:浏览器看不到节点函数、看不到状态,只能发请求、收事件。

在 `tests/` 下新建 `test_week67.py`:

```python
# supportpilot/tests/test_week67.py
"""第 67 周小项目:一张退款工单,只走 HTTP,把这一周的东西全部过一遍。假模型,不花钱。
图和路由(462)→ 停在审批再恢复(463)→ 多轮对话(464)→ 聊长了压缩(465)→ 画像(466)→ 接口和成本(467)。"""

import pytest
from fakes import FakeLLM, FakeTools, make_deps
from test_api import client, parse_sse  # noqa: F401  client 是 fixture,导入进来本文件才能用
from test_graph_smoke import ACT, DRAFT, LINA, REFUND_TRIAGE

from supportpilot.api import app as api
from supportpilot.config import Settings
from supportpilot.memory.profile import PROFILE_PROMPT

ASK = [{"role": "system", "content": PROFILE_PROMPT}, {"role": "user", "content": "{}"}]
BODY = {"customer_email": "lina@example.com", "subject": "api-test", "body": "上周买的专业版年付,用不上,请帮我退款。"}
FIRST_RUN = ["load_customer", "prepare_context", "classify", "retrieve", "act", "draft", "check"]


@pytest.mark.db
def test_one_ticket_whole_week(client):
    deps = make_deps(FakeLLM(REFUND_TRIAGE, ACT, DRAFT), FakeTools(customer=LINA))
    deps.settings = Settings(context_budget=150)                     # 预算调小,几轮就会触发压缩
    deps.profile_for = lambda llm, cid, tid: llm.chat(ASK).content   # 画像用调用时传进来的模型
    api.R["deps"] = deps
    tid = client.post("/tickets", json=BODY).json()["ticket_id"]

    ev = parse_sse(client.post(f"/tickets/{tid}/run").text)
    nodes = [d["node"] for e, d in ev if e == "node"]
    assert nodes == FIRST_RUN                                         # 路由:退款要查账,走 act
    assert [e for e, _ in ev][-2:] == ["interrupt", "done"]
    first = ev[-1][1]
    assert first["outcome"] == "waiting_approval" and first["cost_cny"] == 0.00852

    assert client.post(f"/tickets/{tid}/messages", json={"content": "多久到账?"}).status_code == 409
    ev = parse_sse(client.post(f"/approvals/{tid}", json={"approved": True, "approver": "amy"}).text)
    assert ev[-1][1]["outcome"] == "resolved" and ev[-1][1]["cost_cny"] == first["cost_cny"]

    uptos = []
    for q in ["多久能到账?", "到账会有短信吗?", "发票要重开吗?"]:
        ev = parse_sse(client.post(f"/tickets/{tid}/messages", json={"content": q}).text)
        uptos.append(next(d["summarized_upto"] for e, d in ev if e == "step" and d["node"] == "prepare_context"))
        assert ev[-1][0] == "done"
    last = ev[-1][1]
    print("summarized_upto 每轮:", uptos, "turns:", last["turns"], "cost:", last["cost_cny"])
    assert uptos == [0, 0, 2]                                         # 第三次追问才压,压掉最早的一问一答
    assert last["turns"] == 8                                         # 4 问 4 答,原文一条没删
    assert last["cost_cny"] == 0.02608                                # 0.00852 + 3 × 0.00552 + 摘要 0.001
    assert deps.spent() == 0                                          # 每个请求都 fresh,基础账本一笔没记
```

<div class="line-notes">

- `from test_api import client, parse_sse  # noqa: F401` 复用 Day 467 的 fixture:它往 `api.R` 里塞真数据库连接(建工单要写 biz.tickets)、内存存档和假 deps,收尾删掉主题是 api-test 的工单。
- `from test_graph_smoke import ACT, DRAFT, LINA, REFUND_TRIAGE` Day 463 李娜退款那套剧本:分诊判退款且要查账,act 依次调三个工具。
- `ASK = [{"role": "system", "content": PROFILE_PROMPT}` 一个假的画像请求。FakeLLM 看到 PROFILE_PROMPT 就记一笔 300 输入、50 输出的账,按 `.env` 的单价是 0.001 元。
- `FIRST_RUN = ["load_customer", "prepare_context", "classify", "retrieve", "act", "draft", "check"]` 第一次跑应该经过的 7 个节点,approval 停住了所以不在里面。这就是 Day 462 三个路由函数的结论写成了一个列表。
- `deps.settings = Settings(context_budget=150)` 把压缩预算从默认的 1200 调到 150。`Settings` 是 pydantic-settings 的类(Day 442),构造时传的参数优先于 `.env`。不调小的话,要聊十几轮才会触发压缩。
- `deps.profile_for = lambda llm, cid, tid: llm.chat(ASK).content` 用 Day 467 改过的签名:模型是调用时传进来的。真的 `get_or_build_profile` 只在历史工单数变了时才花钱,这个假版本每轮都调一次,所以每轮都会记 0.001,算成本时要算上。
- `api.R["deps"] = deps` 换掉资源袋里的 deps。`get_graph` 每个请求会从它 `fresh()` 一份。
- `tid = client.post("/tickets", json=BODY).json()["ticket_id"]` 实测拿到的是 T000154:开发库里已经有 153 张(Day 467 跑真模型时建了 T000153)。
- `nodes = [d["node"] for e, d in ev if e == "node"]` 只挑 node 事件,拿出节点名。这是 Python 的列表推导式([Day 23](/blog/agent-zero/day-023-comprehensions/)),相当于 JS 的 `ev.filter(([e]) => e === "node").map(([, d]) => d.node)`。
- `assert [e for e, _ in ev][-2:] == ["interrupt", "done"]` 最后两个事件。`[-2:]` 是「倒数两个」,相当于 JS 的 `.slice(-2)`。
- `assert first["outcome"] == "waiting_approval" and first["cost_cny"] == 0.00852` 成本是精确算出来的:画像 0.001 + 分诊 0.00036 + act 四次 chat(三次调工具,剧本用完后第四次给结论)0.004 + 起草 0.0028 + 质检 0.00036 = 0.00852。
- `json={"content": "多久到账?"}).status_code == 409` 停在审批时追问,依赖 `idle_thread` 返回 409。
- `assert ev[-1][1]["outcome"] == "resolved" and ev[-1][1]["cost_cny"] == first["cost_cny"]` 审批这一次只跑 approval 和 finalize,都不调模型,成本不变。
- `uptos.append(next(d["summarized_upto"] for e, d in ev if e == "step" and d["node"] == "prepare_context"))` `next(生成器)` 取第一个满足条件的元素,相当于 JS 的 `.find()`。从 prepare_context 推的 step 事件里拿到这一轮的切点。
- `assert uptos == [0, 0, 2]` 实测值。前两次追问没超预算;第三次追问时 turns 有 7 条,保留最后 4 条算出切点 3,那是一条客服回复,往前退一条到 2,也就是把最早的一问一答折进摘要。
- `assert last["turns"] == 8` 工单正文 + 第一次回复,再加三问三答,共 8 条。压缩只动给模型看的部分,原文一条不少。
- `assert last["cost_cny"] == 0.02608` 每次追问:画像 0.001 + 分诊 0.00036 + act 一次 chat 0.001(剧本已经用完,直接给结论)+ 起草 0.0028 + 质检 0.00036 = 0.00552;第三次多一次摘要 0.001。0.00852 + 3 × 0.00552 + 0.001 = 0.02608。
- `assert deps.spent() == 0` 所有花费都记在每个请求 fresh 出来的副本上,资源袋里那份基础 deps 的账本一笔没记。

</div>

```bash
uv run pytest tests/test_week67.py -q -s
```

`-s` 让测试里的 `print` 打出来。真实输出:

```text
summarized_upto 每轮: [0, 0, 2] turns: 8 cost: 0.02608
1 passed in 3.19s
```

一个测试,三秒,一分钱不花,覆盖了六天的东西。这个测试最值钱的是成本那一行。两个浮点数用 `==` 比较一般有风险(Day 467 练习 2 讲过),这里能直接比,是因为每笔都是整数 token 乘同样的单价,累加的顺序也固定。哪天有人改了某个节点多调了一次模型,或者画像的钱又记丢了,这一行马上会红。

| 零件 | 哪天的 | 小项目里哪一段 |
| --- | --- | --- |
| 三个路由函数 | 462 | `FIRST_RUN` 那一行断言 |
| FakeLLM、FakeTools、剧本 | 463 | `make_deps(FakeLLM(REFUND_TRIAGE, ACT, DRAFT), ...)` |
| interrupt 和恢复 | 463 | 409、审批两段 |
| turns 追加 | 464 | `last["turns"] == 8` |
| `maybe_compress`、prepare_context | 465 | `Settings(context_budget=150)`、`uptos` |
| `profile_for` 新签名 | 466、467 | `deps.profile_for = lambda llm, ...` |
| `fresh()`、六个接口、七种事件 | 467 | 所有 `client.post`、`deps.spent() == 0` |

### 拼起来才冒出来的两个坑

小项目绿了,我又想:前端明天要按 `done` 里的 outcome 决定界面状态,停在审批就锁住输入框、显示「等客服处理」。那**第二轮**停在审批呢?小项目里审批发生在第一轮,没测到这种情况。写个小脚本试一下:第一轮问政策、正常解决;第二轮说「那帮我退吧」,走到审批。

```python
# supportpilot/scratch/d468/stale_outcome.py
"""第一轮问政策、正常解决;第二轮要退款、停在审批。看第二轮 done 里的 outcome 和 reply。假模型,不花钱。"""

import sys

sys.path[:0] = ["src", "tests"]

from fakes import FakeLLM, FakeTools, make_deps
from fastapi.testclient import TestClient
from langgraph.checkpoint.memory import InMemorySaver
from test_api import parse_sse
from test_graph_smoke import ACT, DRAFT, LINA, REFUND_TRIAGE

from supportpilot.api import app as api
from supportpilot.db import connect

POLICY = {**REFUND_TRIAGE, "needs_account_data": False}     # 第一轮:只问政策,不查账
conn = connect()
api.R.update(conn=conn, saver=InMemorySaver(), deps=make_deps(FakeLLM(POLICY, [], DRAFT), FakeTools(customer=LINA)))
client = TestClient(api.app)
tid = client.post("/tickets", json={"customer_email": "lina@example.com", "subject": "api-test",
                                    "body": "年付能退吗?"}).json()["ticket_id"]
done = parse_sse(client.post(f"/tickets/{tid}/run").text)[-1][1]
print("第一轮:", done["outcome"], done["waiting_on"], str(done["reply"])[:20])

api.R["deps"] = make_deps(FakeLLM(REFUND_TRIAGE, ACT, DRAFT), FakeTools(customer=LINA))
ev = parse_sse(client.post(f"/tickets/{tid}/messages", json={"content": "那帮我退吧"}).text)
done = ev[-1][1]
print("第二轮事件:", [e for e, _ in ev][-3:])
print("第二轮:", done["outcome"], done["waiting_on"], str(done["reply"])[:20])
conn.execute("DELETE FROM biz.tickets WHERE subject = 'api-test'")
conn.close()
```

<div class="line-notes">

- `sys.path[:0] = ["src", "tests"]` 把两个目录插到搜索路径最前面,和 `tests/conftest.py` 做的事一样。脚本不经过 pytest,conftest 不会自动加载,所以自己加。
- `POLICY = {**REFUND_TRIAGE, "needs_account_data": False}` 复制一份分诊结果,只改「不用查账」。路由走 retrieve → draft,不进 act,也就不会建退款申请。
- `api.R.update(conn=conn, saver=InMemorySaver(),` 和 test_api.py 的 fixture 一样往资源袋里塞零件。
- `client = TestClient(api.app)` 不用 `with`,不触发 lifespan,塞的假零件不会被换掉(Day 467)。
- `print("第一轮:", done["outcome"], done["waiting_on"], str(done["reply"])[:20])` 回复只打印前 20 个字。用 `str()` 包一下,reply 是 None 时也能切片。
- `api.R["deps"] = make_deps(FakeLLM(REFUND_TRIAGE, ACT, DRAFT), FakeTools(customer=LINA))` 第二轮换成要查账的退款剧本,act 会建申请,check 之后路由到 approval。
- `conn.execute("DELETE FROM biz.tickets WHERE subject = 'api-test'")` 只删自己建的工单。Day 467 吃过测试乱删开发数据的亏。

</div>

```bash
uv run python scratch/d468/stale_outcome.py
```

真实输出:

```text
第一轮: resolved [] 您好,您的年付订阅在 14 天内,符合全
第二轮事件: ['node', 'interrupt', 'done']
第二轮: resolved ['approval'] 您好,您的年付订阅在 14 天内,符合全
```

第二轮明明停在了审批(有 interrupt,`waiting_on` 是 `['approval']`),done 里的 outcome 却是 **resolved**,reply 是第一轮的回复。前端按 outcome 判断,会显示「已完成」,把第一轮的回复当成这一轮的最终答复,输入框也不会锁。

原因在两天的交界处。Day 464 在 `load_customer` 里列了一张「每轮重置」的清单,outcome 和 reply 不在里面:那时候只有终端脚本,每轮都打印 `out["reply"]`,第二轮停在审批时根本不看它。Day 467 的 `_summary` 写的是 `v.get("outcome") or ("waiting_approval" if snap.next else None)`,意思是「没有 outcome 才去推断」,可第二轮的状态里留着第一轮的 resolved,推断那半句根本走不到。两天各自看都对,拼在一起就错了。

第二个坑是顺着 error 事件想到的。Day 467 用 `Broken` 测过第一轮出错推 error,那追问时出错呢?出错以后客户再问一遍,能接着聊吗?

```python
# supportpilot/scratch/d468/error_turns.py
"""追问那一次出错了,客户说的那句话还在不在 turns 里?假模型,不花钱。在 supportpilot 根目录跑。"""

import sys

sys.path[:0] = ["src", "tests"]

from fakes import FakeLLM, FakeTools, make_deps
from fastapi.testclient import TestClient
from langgraph.checkpoint.memory import InMemorySaver
from test_api import parse_sse
from test_memory import DRAFT, TRIAGE

from supportpilot.api import app as api
from supportpilot.db import connect


class Broken(FakeLLM):
    def structured(self, *a, **kw):
        raise RuntimeError("模型接口 502")


conn = connect()
ok = make_deps(FakeLLM(TRIAGE, [], DRAFT), FakeTools(customer={"id": "C0010"}))
api.R.update(conn=conn, saver=InMemorySaver(), deps=ok)
client = TestClient(api.app)
tid = client.post("/tickets", json={"customer_email": "wugang@example.com", "subject": "api-test",
                                    "body": "银行流水又不同步了"}).json()["ticket_id"]
print("第一轮:", parse_sse(client.post(f"/tickets/{tid}/run").text)[-1][0])

api.R["deps"] = make_deps(Broken(TRIAGE, [], DRAFT), FakeTools(customer={"id": "C0010"}))
print("追问出错:", [e for e, _ in parse_sse(client.post(f"/tickets/{tid}/messages", json={"content": "还是不行"}).text)])
snap = api.get_graph().get_state(api._cfg(tid))
print("turns 角色:", [t["role"] for t in snap.values["turns"]], "next:", snap.next)
print("GET:", {k: v for k, v in client.get(f"/tickets/{tid}").json().items() if k in ("outcome", "waiting_on")})

api.R["deps"] = ok
r = client.post(f"/tickets/{tid}/messages", json={"content": "还是不行"})
print("再问一遍:", r.status_code, parse_sse(r.text)[-1][0] if r.status_code == 200 else r.json())
snap = api.get_graph().get_state(api._cfg(tid))
print("turns 角色:", [t["role"] for t in snap.values["turns"]])
conn.execute("DELETE FROM biz.tickets WHERE subject = 'api-test'")
conn.close()
```

<div class="line-notes">

- `class Broken(FakeLLM):` 和 Day 467 test_api.py 里那个一样,分诊一调模型就抛异常,模拟模型接口挂了。
- `ok = make_deps(FakeLLM(TRIAGE, [], DRAFT), FakeTools(customer={"id": "C0010"}))` 吴刚(C0010)银行同步那套剧本(Day 464),不查账、不退款,路由最短。
- `api.R["deps"] = make_deps(Broken(TRIAGE, [], DRAFT)` 第二轮换成坏掉的模型。
- `snap = api.get_graph().get_state(api._cfg(tid))` 不走接口,直接看 checkpoint 里存了什么。`get_graph()` 是 Day 467 的依赖函数,直接调用也行。
- `print("turns 角色:", [t["role"] for t in snap.values["turns"]], "next:", snap.next)` 看两样东西:客户那句话进没进 turns;图停在了哪个节点前面。
- `print("GET:", {k: v for k, v in client.get(` 字典推导式,只挑两个字段,相当于 JS 的 `Object.fromEntries(Object.entries(o).filter(...))`。
- `api.R["deps"] = ok` 模型恢复了,客户再问一遍同样的话。
- `print("再问一遍:", r.status_code, parse_sse(r.text)[-1][0] if r.status_code == 200 else r.json())` 200 就打印最后一个事件名,不是 200 就打印错误 JSON。

</div>

```bash
uv run python scratch/d468/error_turns.py 2>/dev/null
```

`2>/dev/null` 把 `log.exception` 打到标准错误的那一大段堆栈藏起来。真实输出:

```text
第一轮: done
追问出错: ['step', 'node', 'step', 'node', 'error']
turns 角色: ['customer', 'agent', 'customer'] next: ('classify',)
GET: {'outcome': 'resolved', 'waiting_on': ['classify']}
再问一遍: 409 {'detail': '工单还在等待审批,审批完成后才能继续对话'}
turns 角色: ['customer', 'agent', 'customer']
```

一行一行看。出错时 load_customer 和 prepare_context 跑完了(两对 step + node),classify 抛异常,推了 error,符合约定。checkpoint 里客户那句「还是不行」**已经存进去了**:LangGraph 开跑时先把输入写进状态并存一份快照,然后才执行节点。图停在 classify 前面,`next` 是 `('classify',)`。

问题出在后两行。GET 返回的 outcome 是上一轮的 resolved,第一个坑又出现了一次。客户再问一遍,收到 409「还在等待审批」,可这张工单根本没有退款。Day 467 的 `idle_thread` 写的是 `if snap.next:`,当时想的是「next 不为空就是停在审批」,没想到出错也会让 next 不为空。这张工单从此卡死:不在审批,批不了;next 不为空,聊不了。

修法三处,每处一两行。`agent/nodes.py` 的 `load_customer` 里,重置列表加两项:

```python
# supportpilot/src/supportpilot/agent/nodes.py(load_customer 里 update 字典的最后两行)
                        "followup": "", "review": {}, "findings": "", "hits": [], "handoff_reason": "",
                        "outcome": "", "reply": ""}   # Day 468:结局和回复也是「本轮」的,不清会被 done 当成这一轮的
```

<div class="line-notes">

- `"outcome": "", "reply": ""}` 每轮开头清空。用空字符串而不是 None,是因为 `SupportState` 里这两个字段标的是 `str`。空字符串在 Python 里是假值,`_summary` 里的 `or` 会接着往后推断。

</div>

`api/app.py` 两处:

```python
# supportpilot/src/supportpilot/api/app.py(idle_thread 和 _summary 各改一处)
    if "approval" in snap.next:  # Day 468:只有停在审批才拦。别的 next 说明上一次跑到一半出错了,允许客户接着说
        raise HTTPException(409, "工单还在等待审批,审批完成后才能继续对话")

    waiting = "waiting_approval" if "approval" in snap.next else None   # Day 468:只有停在审批才算等审批
    return {"ticket_id": ticket_id, "outcome": v.get("outcome") or waiting,
            "category": v.get("triage", {}).get("category"), "reply": v.get("reply") or None,
```

<div class="line-notes">

- `if "approval" in snap.next:` 原来是 `if snap.next:`。`in` 判断元组里有没有这个元素,相当于 JS 的 `next.includes("approval")`。
- `waiting = "waiting_approval" if "approval" in snap.next else None` 出错卡在半路时 outcome 给 None,前端看 `waiting_on` 知道它停在哪。
- `"reply": v.get("reply") or None,` 重置成空字符串以后,没定稿时返回 None 而不是 `""`,和 Day 467 约定的「reply 是 null 表示还没定稿」保持一致。

</div>

为什么出错以后再发一条消息就能接着跑?`graph.stream` 收到的是新的输入(`{"turns": [...]}`),不是 `None` 或 `Command`,LangGraph 会从 START 重新开始一轮,而不是从卡住的 classify 接着跑。恢复卡住的那一轮另有办法,Day 471 讲停止和断线时再说。

改完再跑两个脚本:

```text
第一轮: resolved [] 您好,您的年付订阅在 14 天内,符合全
第二轮事件: ['node', 'interrupt', 'done']
第二轮: waiting_approval ['approval'] None
```

```text
第一轮: done
追问出错: ['step', 'node', 'step', 'node', 'error']
turns 角色: ['customer', 'agent', 'customer'] next: ('classify',)
GET: {'outcome': None, 'waiting_on': ['classify']}
再问一遍: 200 done
turns 角色: ['customer', 'agent', 'customer', 'customer', 'agent']
```

两个坑都修好了。再看最后一行:客户、客服、客户、**客户**、客服。出错那次的「还是不行」留在了 turns 里,重问一次又加了一条,对话**不再一问一答交替**。默写二留下的那个问题有了答案:turns 会不交替,而且是很正常的用法造成的。`maybe_compress` 里那行下标要是写错成 `turns[cut]`,在这张工单上就会把一问一答拆开,练习 2 会把它钉成测试。

最后跑一遍全部测试:

```bash
uv run pytest -q
```

实测 `57 passed`,56 个加小项目 1 个,改了三处之后以前的测试一个没坏。动手练习做完是 61 个。

## 本周错题与坑清单

下面这些是本周最容易出错的地方,每一条都在本机复现过,括号里是哪一天。

**路由名字拼错,图悄悄结束(462)。** 不写 `add_conditional_edges` 的第三个参数时,`finalise` 拼错只打一行 `wrote to unknown channel branch:to:finalise, ignoring it.`,不报错。写了就是 `KeyError`。

**把工厂函数本身传进去(462)。** `make_after_check` 少了一对括号,报 `KeyError: <function ...>`。看到「键是一个函数」就去找括号。

**剧本被上一个测试吃掉了(463)。** 可变列表直接交给假对象,上一个测试 `pop` 空了,下一个测试拿到空剧本。单独跑过、一起跑挂。进对象前先 `list(...)` 复制。

**不给 checkpointer,停下来了但恢复不了(463)。** 第一次 invoke 照样返回 `__interrupt__`,恢复时才报 `RuntimeError: Cannot use Command(resume=...) without checkpointer`。

**turns 不挂 reducer(464)。** 第二轮传进来一条,把整个记录覆盖成一条。

**每轮不重置临时字段(464,今天又补了两个)。** 漏了 review,第二轮草稿在改上一轮的错;漏了 followup,客户说谢谢又收到一遍「已审核通过」;今天发现漏了 outcome 和 reply,第二轮停在审批时 done 报 resolved。重置清单以今天的版本为准:revisions、refund_request、approval、followup、review、findings、hits、handoff_reason、outcome、reply 每轮重置;turns、summary、summarized_upto、cost_cny、ticket 跨轮保留;customer 和 profile 每轮重新读。

**重新造数后工单号复用(464)。** 新工单接上同号旧工单的 6 条对话。造数前先 `python -m supportpilot.memory.checkpoint` 清快照。

**切点把一问一答拆开(465)。** 17 条保留 4 条,切点落在客服回复上,摘要把「能手动导入吗」写成待回复。退到客户消息。

**忘了返回 summarized_upto(465)。** 摘要加全部原文 803 个 token,比不压的 727 还多。

**下标用错数组,测试全绿(今天)。** `turns[cut]` 和 `pending[cut]` 在一问一答交替时角色总是相同,只有 turns 不交替时才暴露。今天证明了它会不交替:追问出错后客户重问一遍。

**画像把当前工单算进历史(466)。** 第一轮 finalize 把它标成 resolved,第二轮画像就重建,来回重写。

**没给客户档案,模型写成「非 VIP」(466)。** 提示词要什么,输入里就要给什么。

**共用账本,成本互相串(467)。** 两张一样的工单 0.00388 和 0.00668,合计比真实多一倍。顺序跑的时候差值法是对的,所以今天小项目里「第一轮成本 0.00852」那一行在没有 `fresh()` 时也会通过,只有 `deps.spent() == 0` 能抓住(练习 3)。

**在流式接口的函数体里抛 404(467)。** 客户端收到 200 加空 body。能提前判断的放进依赖。

**`next` 不为空就当成等审批(467,今天修)。** 出错也会让 next 不为空,工单被 409 卡死。

**测试和开发服务共用一个库(467)。** test_tools.py 的 fixture 删光了 `biz.refund_requests`,正在等审批的那条没了,审批时收到 error。测试只删自己造的数据。

## 动手练习

### 练习 1:把今天的两个坑钉成测试

新建 `tests/test_week67_more.py`,写两个连库测试:①第一轮政策问答 resolved,第二轮退款停在审批,断言 done 里 outcome 是 waiting_approval、reply 是 None;②第一轮正常,第二轮追问出错推 error,断言 GET 的 outcome 是 None;模型恢复后再追问,断言是 200 且以 resolved 结束。先把今天的三处修改撤回去,确认两个测试都是红的,再改回来变绿。

<details><summary>参考答案</summary>

```python
# supportpilot/tests/test_week67_more.py
"""第 67 周复习练习 1、2:把今天找到的两个坑钉成测试。假模型,不花钱。"""

import pytest
from fakes import FakeLLM, FakeTools, make_deps
from test_api import client, parse_sse  # noqa: F401
from test_graph_smoke import ACT, DRAFT, LINA, REFUND_TRIAGE

from supportpilot.api import app as api

BODY = {"customer_email": "lina@example.com", "subject": "api-test", "body": "年付能退吗?"}
POLICY = {**REFUND_TRIAGE, "needs_account_data": False}


class Broken(FakeLLM):
    def structured(self, *a, **kw):
        raise RuntimeError("模型接口 502")


@pytest.mark.db
def test_second_round_waiting_is_not_reported_as_resolved(client):
    api.R["deps"] = make_deps(FakeLLM(POLICY, [], DRAFT), FakeTools(customer=LINA))
    tid = client.post("/tickets", json=BODY).json()["ticket_id"]
    assert parse_sse(client.post(f"/tickets/{tid}/run").text)[-1][1]["outcome"] == "resolved"

    api.R["deps"] = make_deps(FakeLLM(REFUND_TRIAGE, ACT, DRAFT), FakeTools(customer=LINA))
    done = parse_sse(client.post(f"/tickets/{tid}/messages", json={"content": "那帮我退吧"}).text)[-1][1]
    assert done["outcome"] == "waiting_approval" and done["reply"] is None


@pytest.mark.db
def test_failed_follow_up_can_be_retried(client):
    ok = make_deps(FakeLLM(POLICY, [], DRAFT), FakeTools(customer=LINA))
    api.R["deps"] = ok
    tid = client.post("/tickets", json=BODY).json()["ticket_id"]
    client.post(f"/tickets/{tid}/run")

    api.R["deps"] = make_deps(Broken(POLICY, [], DRAFT), FakeTools(customer=LINA))
    assert parse_sse(client.post(f"/tickets/{tid}/messages", json={"content": "还在吗"}).text)[-1][0] == "error"
    assert client.get(f"/tickets/{tid}").json()["outcome"] is None      # 不是 waiting_approval,也不是上一轮的 resolved

    api.R["deps"] = ok
    r = client.post(f"/tickets/{tid}/messages", json={"content": "还在吗"})
    assert r.status_code == 200 and parse_sse(r.text)[-1][1]["outcome"] == "resolved"
```

<div class="line-notes">

- `from test_api import client, parse_sse  # noqa: F401` 和小项目一样复用 fixture。
- `POLICY = {**REFUND_TRIAGE, "needs_account_data": False}` 第一轮不查账,直接 retrieve → draft → check → finalize。
- `assert parse_sse(client.post(f"/tickets/{tid}/run").text)[-1][1]["outcome"] == "resolved"` 先确认第一轮确实是 resolved,第二轮的断言才有意义。
- `assert done["outcome"] == "waiting_approval" and done["reply"] is None` 第一个坑。判断 None 用 `is`。
- `json={"content": "还在吗"}).text)[-1][0] == "error"` 追问出错,最后一个事件是 error。
- `assert client.get(f"/tickets/{tid}").json()["outcome"] is None` 卡在半路时 outcome 是 None,不冒充任何结局。
- `assert r.status_code == 200 and parse_sse(r.text)[-1][1]["outcome"] == "resolved"` 第二个坑:修之前这里是 409。

</div>

撤回三处修改(可以从备份拷回 Day 467 版的 nodes.py 和 app.py),跑:

```bash
uv run pytest tests/test_week67_more.py -q
```

真实输出(节选):

```text
E       AssertionError: assert ('resolved' == 'waiting_approval'
E       AssertionError: assert 'resolved' is None
FAILED tests/test_week67_more.py::test_failed_follow_up_can_be_retried - Asse...
2 failed in 3.46s
```

第二个测试在 GET 那一行就红了,还没走到 409。改回来以后 `2 passed`。

</details>

### 练习 2:turns 不交替时,切点还对吗

照着默写二后面的分析,写一个只测 `maybe_compress` 的测试:12 条对话,第 2、3 条都是客户(模拟追问出错后重问),已有摘要覆盖了前 5 条(upto=5),预算 300、保留 4 条。先自己算出正确的 upto,写进断言;再把 while 那一行改成 `turns[cut]`,看测试能不能抓住。

<details><summary>参考答案</summary>

先手算。角色是 c a c c a c a c a c a c(c 是客户,a 是客服),下标 0 到 11。pending 是 `turns[5:]`,7 条,角色 c a c a c a c。`cut = 7 - 4 = 3`,`pending[3]` 是 a(也就是 turns[8]),往前退一条,`pending[2]` 是 c,停。新 upto 是 5 + 2 = 7,`turns[7]` 是客户。

写错的版本:`turns[3]` 是 c(重问的那条),不退,cut 停在 3,upto 变成 8,`turns[8]` 是客服回复,保留部分从一条回复开始,一问一答被拆开了。

```python
# supportpilot/tests/test_compress_review.py
"""第 67 周复习练习:客户连发两条(上一次请求出错没有回复)时,切点还是要落在客户消息上。"""

from typing import cast

from fakes import FakeLLM
from test_memory import DRAFT, TRIAGE

from supportpilot.llm import LLMClient
from supportpilot.memory.compress import maybe_compress

ROLES = "cacc" + "acacacac"          # 第 2、3 条都是客户:第一次追问出错了,客户又问了一遍
TURNS = [{"role": "customer" if r == "c" else "agent", "content": f"第{i}条:" + "银行流水同步失败" * 10}
         for i, r in enumerate(ROLES)]


def test_cut_lands_on_customer_when_roles_do_not_alternate():
    llm = FakeLLM(TRIAGE, [], DRAFT)
    _, upto = maybe_compress(cast(LLMClient, llm), TURNS, "- 旧摘要", 5, budget=300, keep_last=4)
    assert TURNS[upto]["role"] == "customer"
    assert upto == 7
```

<div class="line-notes">

- `ROLES = "cacc" + "acacacac"` 用一个字符串写角色序列,一眼看得出哪里不交替。拆成两段只是为了标出前 4 条。
- `TURNS = [{"role": "customer" if r == "c" else "agent", "content": f"第{i}条:" + "银行流水同步失败" * 10}` 每条 84 个字符,和 Day 465 测试里的 LONG 一样长,保证超过 300 的预算。`enumerate` 同时给出下标和元素,相当于 JS 的 `[...s].map((r, i) => ...)`。
- `_, upto = maybe_compress(cast(LLMClient, llm), TURNS, "- 旧摘要", 5, budget=300, keep_last=4)` `cast` 告诉类型检查器把假模型当 LLMClient 看(Day 463)。摘要内容不关心,用 `_` 接住。
- `assert TURNS[upto]["role"] == "customer"` 真正要守的规矩。
- `assert upto == 7` 手算出来的值。

</div>

```bash
uv run pytest tests/test_compress_review.py -q
```

正确版本 `1 passed`。把 while 那行改成 `turns[cut]` 再跑,真实输出:

```text
E       AssertionError: assert 'agent' == 'customer'
1 failed in 3.95s
```

Day 465 的 8 个测试抓不住的错,这个测试一下就抓住了。测试数据只有「正常」的样子,就只能证明代码在正常的样子下是对的。

</details>

### 练习 3:去掉 fresh,看哪一行红

把 `api/app.py` 的 `get_graph` 里 `R["deps"].fresh()` 改成 `R["deps"]`,跑小项目。先猜:十条 assert 里哪几条会失败?

<details><summary>参考答案</summary>

```bash
uv run pytest tests/test_week67.py -q
```

真实输出(节选):

```text
E       assert 0.02608 == 0
E        +  where 0.02608 = spent()
1 failed in 4.58s
```

只有最后一行 `deps.spent() == 0` 失败,两个精确成本的断言都过了。原因是 TestClient 一个请求接一个请求地发,没有并发:共用账本时,「开始读一次、结束读一次」的差值依然正好是自己这个节点花的钱。Day 467 的 race.py 要开两个线程、还要给假模型加 0.2 秒延时,才能让两张工单的时间段重叠。

所以这一行不是多余的。它不依赖并发也能抓住「没有每请求一本账」,还能抓住 Day 467 说的那类漏洞:某个闭包抓住了基础客户端,钱记到了共用账本上。改回 `fresh()` 再跑,`1 passed`。

</details>

### 练习 4:先算,再跑

在小项目的基础上多追问一次「那我关掉自动续费?」,不跑代码,先算出 `uptos` 列表、最后的 turns 条数和 cost_cny,写进断言,再跑。

<details><summary>参考答案</summary>

手算。第四次追问时,prepare_context 看到的 turns 有 9 条(8 条加这次的客户消息),角色 c a c a c a c a c,已有摘要覆盖前 2 条。pending 是 `turns[2:]`,7 条,`cut = 7 - 4 = 3`,`pending[3]` 是 turns[5],客服回复,退到 `pending[2]`,客户。新 upto = 2 + 2 = 4。turns 最后是 10 条。成本多一次追问 0.00552 和一次摘要 0.001:0.02608 + 0.00652 = 0.0326。

复制一份小项目改成 `tests/test_week67_ex.py`,改四处:问题列表多一句,断言改成 `[0, 0, 2, 4]`、`10`、`0.0326`,函数名改成 `test_four_follow_ups`(两个文件里同名的测试函数 pytest 也能分开跑,改名只是为了看报告时分得清)。

```python
# supportpilot/tests/test_week67_ex.py(和 test_week67.py 不同的几行)
def test_four_follow_ups(client):
    for q in ["多久能到账?", "到账会有短信吗?", "发票要重开吗?", "那我关掉自动续费?"]:
    assert uptos == [0, 0, 2, 4]
    assert last["turns"] == 10
    assert last["cost_cny"] == 0.0326
```

<div class="line-notes">

- `def test_four_follow_ups(client):` 上面还是那行 `@pytest.mark.db`,函数体其余部分和小项目一样。
- `for q in ["多久能到账?", "到账会有短信吗?", "发票要重开吗?", "那我关掉自动续费?"]:` 多一次追问。
- `assert uptos == [0, 0, 2, 4]` 第四次又压了一次,切点从 2 推到 4。滚动摘要:新摘要是「旧摘要 + turns[2:4]」重写出来的。
- `assert last["cost_cny"] == 0.0326` 0.02608 + 0.00552 + 0.001。

</div>

```bash
uv run pytest tests/test_week67_ex.py -q -s
```

真实输出:

```text
summarized_upto 每轮: [0, 0, 2, 4] turns: 10 cost: 0.0326
1 passed in 3.81s
```

和手算一致。能先算对再跑,说明压缩的切点规则和成本是怎么一笔笔记上去的,你都清楚了。

</details>

验收标准:`uv run pytest -q` 全部通过,四道练习做完是 61 个;不看文章能写出 `_events` 和 `maybe_compress`,并说出 `pending[cut]` 为什么不能写成 `turns[cut]`;能说出 Day 464 的重置清单今天多了哪两项、为什么;今天真模型花费 0 元。

## 名词解释

今天没有新概念,下面几个词是今天用得多、前面讲得少的。

| 名词 | 意思 |
| --- | --- |
| 集成测试 | 把几个模块连在一起测,看它们拼起来对不对。例:今天的小项目只走 HTTP,一次测到图、记忆和接口。和它相对的单元测试只测一个函数,比如 Day 465 只测 `maybe_compress`。 |
| 回归测试 | 修好一个 bug 后写的测试,防止它以后再回来。例:练习 1 的两个测试。 |
| 测试盲区 | 代码写错了测试也全绿的地方,通常因为测试数据只覆盖了「正常」的样子。例:`turns[cut]` 在对话交替时测不出来。 |
| 边界条件 | 输入落在规则边上的情况。例:客户连发两条、切点退到 0、预算刚好等于粗估值。 |
| 状态生命周期 | 一个状态字段什么时候写、跨不跨轮保留、什么时候被清掉。例:outcome 是本轮的,turns 是跨轮的。 |
| 卡住的线程(thread) | LangGraph 里一个 thread_id 停在某个节点前、既不是等审批也没跑完的状态,`next` 不为空。例:追问出错后 `next` 是 `('classify',)`。 |

## 常见误区

**每天的测试都绿了,就以为整体是对的。** 今天两个坑,出问题的代码各自都有测试,而且都是绿的。Day 464 的测试只测重置了它列出的字段,Day 467 的测试只在第一轮停审批。至少要有一个从用户视角走完全程的测试。

**用 `next` 不为空判断「在等审批」。** next 只说明图停在某个节点前面,停的原因可能是 interrupt,也可能是出错。要判断等审批,就看 approval 在不在 next 里。

**加了新字段不问它的生命周期。** outcome 和 reply 从 Day 460 就有,一直没进重置清单,因为在终端里每轮都会被覆盖或者没人看。有了接口,前端每轮都看,问题才露出来。每加一个状态字段,就去那张「跨轮保留 / 每轮重置」的表里给它找个位置。

**测试数据只造「正常」的样子。** 一问一答交替的对话、每轮都成功的请求,是开发时最常见的,也最容易让下标错、状态漏清这类 bug 藏住。造几条故意不正常的:连发两条、中途出错、第二轮才审批。

**成本断言用「大于 0」。** `assert cost > 0` 什么都抓不住。用假模型时每笔 token 都是写死的,算得出精确值,就断言精确值。

**以为出错以后客户那句话丢了。** 实测没丢:LangGraph 开跑时先把输入存进 checkpoint。所以重问一次,turns 里会有两条一样的客户消息,前端和压缩都要能处理。

**默写只对着文章看一遍。** 默写完一定要替换进项目跑测试。我漏掉的那个 `return`,自己对着看了两遍都没发现,测试一跑就红。

## 学习资料

### 文档与文章

- [LangGraph · Persistence](https://docs.langchain.com/oss/python/langgraph/persistence):checkpoint、thread、`get_state` 返回的快照里 `values` 和 `next` 是什么,今天两个坑都和 `next` 有关。看「Checkpoints」和「Get state」两节。
- [LangGraph · Memory](https://docs.langchain.com/oss/python/langgraph/memory):官方对短期记忆(thread 内)和长期记忆(跨 thread)的划分,对照我们的 turns/摘要和客户画像。
- [LangGraph · Add memory](https://docs.langchain.com/oss/python/langgraph/add-memory):里面「管理短期记忆」讲了裁剪和摘要两种做法,和 Day 465 对照。
- [LangGraph · Interrupts](https://docs.langchain.com/oss/python/langgraph/interrupts):interrupt 和 `Command(resume=...)`,复习恢复时节点从头重跑那条规矩。
- [FastAPI · Server-Sent Events](https://fastapi.tiangolo.com/tutorial/server-sent-events/):Day 467 用到的 EventSourceResponse,明天写前端前再看一眼事件格式。
- [Anthropic · Effective context engineering for AI agents](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents):英文,讲长任务里怎么做压缩和记忆,和这周三种记忆的思路一致,20 分钟。
- [Martin Fowler · The Practical Test Pyramid](https://martinfowler.com/articles/practical-test-pyramid.html):英文长文,单元测试、集成测试、端到端测试各占多少、各测什么,今天小项目就是金字塔中间那一层。
- [pytest · fixtures](https://docs.pytest.org/en/stable/how-to/fixtures.html):小项目跨文件复用了 client fixture,想挪进 conftest.py 看这里。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1uE75zEE2V&autoplay=0&high_quality=1" title="告别健忘AI！LangGraph+ReAct Agen长期记忆Long-Term和短期记忆Short-Term Memory集成全流程详解(小白友好)" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>南哥AGI研习社 · 告别健忘AI!LangGraph+ReAct Agent 长期记忆和短期记忆集成全流程详解 · 32 分钟,2025 年。用 LangGraph 自带的 checkpointer 和 store 做两种记忆,和我们自己写的 turns/画像对照着看:哪些它帮你做了,哪些(每轮重置、排除当前工单)还得自己想。</figcaption>
</figure>

- 强哥学编程《最新 Langchain1.0 入门【17】langgraph 状态管理器 checkpointer 详细解析》:BV1g61fBFEKY,32 分钟,Day 464 嵌过,想复习 checkpoint 存了什么可以再看。

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/vtugjs2chdA" title="Context Engineering Our Way to Long-Horizon Agents: LangChain’s Harrison Chase" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Sequoia Capital · Context Engineering Our Way to Long-Horizon Agents: LangChain's Harrison Chase · LangChain 创始人讲长任务 Agent 的上下文怎么管:什么时候压缩、什么放进长期记忆。英文,开字幕看,适合复习完这周的三种记忆后听一遍,看看他的分法和我们的有什么不同。</figcaption>
</figure>

### 书籍

- Chip Huyen《AI Engineering》(O'Reilly, 2025):第 6 章讲 RAG 和 Agent,Agent 那一节作者改编成了一篇博客 [Agents](https://huyenchip.com/2025/01/07/agents.html),可以先读博客再决定要不要买书。书里讲上下文和记忆管理的部分,适合复习完这周三种记忆后对照着看。

### 开源项目与代码

- [langchain-ai/langgraph](https://github.com/langchain-ai/langgraph):想看 `get_state` 的 `next` 是怎么算出来的、出错时为什么停在那个节点前面,读 `libs/langgraph/langgraph/pregel/` 下的代码。
- [langgraph checkpoint-postgres](https://github.com/langchain-ai/langgraph/tree/main/libs/checkpoint-postgres):我们用的 PostgresSaver,`setup()` 建了哪几张表,Day 466 删快照时用过。

## 自测

1. 一张工单从 `POST /tickets/{id}/run` 开始、退款需要审批,浏览器依次收到哪些 node 事件?最后两个事件是什么?

<details><summary>答案</summary>

load_customer、prepare_context、classify、retrieve、act、draft、check 七个 node(质检一遍过的话),中间夹着 step、tool、token。最后两个是 interrupt 和 done,done 里 outcome 是 waiting_approval。approval 节点停在 interrupt,不会推它的 node。

</details>

2. 为什么 `maybe_compress` 里写成 `turns[cut]` 时 Day 465 的测试全部通过?什么情况下会出错?

<details><summary>答案</summary>

`cut` 是 pending 里的下标,对应的是 `turns[upto + cut]`。对话一问一答交替时,切点总落在客户消息上,upto 总是偶数,`turns[cut]` 和 `turns[upto + cut]` 奇偶相同、角色相同,结果碰巧一样。客户连发两条时(比如追问出错后重问),交替被打破,写错的版本会把切点停在客服回复前面,一问一答被拆开。练习 2 的测试能抓住。

</details>

3. 第二轮停在审批时,为什么 Day 467 版的 done 报 outcome 是 resolved?今天改了哪里?

<details><summary>答案</summary>

outcome 和 reply 不在 `load_customer` 的每轮重置清单里,第二轮状态里还留着第一轮 finalize 写的 resolved 和回复。`_summary` 的写法是「有 outcome 就用,没有才推断」,所以推断那半句走不到。今天把两个字段加进重置清单(每轮清成空字符串),`_summary` 里 reply 改成 `or None`。

</details>

4. 追问出错后,`snap.next` 是什么?Day 467 版的 `idle_thread` 为什么会把这张工单卡死?

<details><summary>答案</summary>

是 `('classify',)`,图停在出错的那个节点前面。Day 467 写的是 `if snap.next: raise 409`,把「next 不为空」都当成等审批,客户再发什么都是 409「还在等待审批」,而 approval 也不在 next 里,审批接口同样 409。今天改成只有 `"approval" in snap.next` 才拦,其余情况允许客户发新消息,LangGraph 从 START 开始新的一轮。

</details>

5. 面试题:你的 Agent 后端有单元测试,为什么还要写一个只走 HTTP 的测试?它帮你发现过什么?

<details><summary>答案</summary>

示范回答:单元测试证明每个模块在它自己设想的输入下是对的,但模块之间的约定没人测。我的 SupportPilot 每个节点、压缩函数、接口都有测试,可写了一个从建单、审批到追问三次的 HTTP 测试以后,马上发现两个问题:一个是对话记忆的「每轮重置」清单漏了 outcome,第二轮停在审批时接口报的还是上一轮的 resolved,前端会显示成已完成;另一个是接口用 `next` 不为空判断等审批,结果追问出错后工单被 409 卡死。这两个问题涉及的代码各自都有测试,而且都是绿的。这个测试用假模型,三秒跑完,成本断言精确到 0.00001 元,节点多调一次模型或者钱记错了地方都会红。我还刻意造了不正常的数据,比如客户连发两条,因此找出了压缩函数里一个被「对话总是一问一答」掩盖住的下标错误。

</details>

6. 小项目里,为什么去掉 `fresh()` 以后两个精确成本的断言还能通过?

<details><summary>答案</summary>

TestClient 是一个请求接一个请求发的,没有并发。共用账本时,每个节点「开始读一次、结束读一次」中间没有别人记账,差值还是对的。共用账本的问题要两个请求同时跑才会出现,所以小项目靠最后一行 `deps.spent() == 0` 抓它:不管有没有并发,只要钱记到了基础账本上,这一行就红。

</details>

## 明天预告

明天是 [Day 469](/blog/agent-zero/day-469-ui-stream/),界面(二):事件类型和读流,一次运行就是一个 reducer。后端到今天为止约定好了:七种事件、一个流只以 done 或 error 结束、outcome 只在真的停在审批时才是 waiting_approval、reply 没定稿时是 null。明天在浏览器这一侧把这些写成 TypeScript 类型,用 fetch 读 POST 的事件流(浏览器自带的 EventSource 只能发 GET),再写一个 reducer 把几十个事件折叠成界面状态。今天修的两处,明天的 reducer 都会直接用上。
