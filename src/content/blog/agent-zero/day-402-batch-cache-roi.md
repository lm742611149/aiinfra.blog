---
title: 'Day 402 · 批处理、语义缓存和 Agent 经济学'
description: '不赶时间的活可以走批处理和错峰,重复的问题能不能不调模型直接答。今天读三家的 Batch API 文档,写一个带断点续跑的本地批处理器,用 bge-m3 实测语义缓存的相似度阈值为什么在客服场景划不出安全的线,再把成本和延迟的数字拼进一张 ROI 表,算出盈亏平衡点和哪个变量最敏感。'
pubDate: 2026-10-27
regime: none
tags: ['batch', 'semantic-cache', 'roi', 'agent-zero']
series: 'agent-zero'
day: 402
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 401](/blog/agent-zero/day-401-latency/) 压的是「一张工单要等多久」:给每一步掐表,找到关键路径,并行、合并、流式,把串行 2.28 秒的流水线压到 1.34 秒,首字从 1.95 秒压到 1.03 秒。那是在线场景,用户盯着屏幕。今天换到另外两种情形:一种是没人在等,几万张历史工单要打标签、一批评测题要跑完,这时候可以换个更便宜的方式;另一种是同样的问题反复来,能不能干脆不调模型。最后把 Day 396 到 Day 401 这六天里所有的成本和延迟数字拼起来,回答老板真正会问的那一句:上了这个 Agent,公司到底省了钱还是多花了钱。

## 今天要解决的问题

今天结束时你应该能:

1. 说清楚批处理 API 适合什么、不适合什么,按官方文档报出 Anthropic、OpenAI、硅基流动三家的折扣、时限和规模上限;在没有批处理接口的厂商(DeepSeek)上,用一个带断点续跑的本地批处理器加错峰价达到相近的效果。
2. 用 embedding 实测语义缓存的相似度阈值:同一个意思的问法和「长得像但答案不同」的问法,相似度是重叠的,没有一个阈值能把它们分开;并写出把风险压下去的三道闸门(范围、版本、过期)。
3. 实现零风险的精确缓存,量出它的命中率和耗时。
4. 写一个 ROI 脚本,算出一个 Agent 项目的盈亏平衡月工单量,并用敏感性分析说出哪个变量最重要。

预计用时 3 小时。前置:[Day 396](/blog/agent-zero/day-396-cost-1/) 的 `pricing.py`(峰谷价格)、[Day 401](/blog/agent-zero/day-401-latency/) 的 `ticket_spans.py`(今天复用它的工单和分类函数)、[Day 217](/blog/agent-zero/day-217-embed-service/) 的 `common/embed.py` 和 [Day 215](/blog/agent-zero/day-215-cosine/) 的余弦相似度、[Day 400](/blog/agent-zero/day-400-advisor/) 实测的每张工单花费。

学法:先对照逐行敲一遍(不复制粘贴)并跑通;第二天合上文章默写核心部分;做练习,做不出再展开参考答案,看完关掉重写一遍。

今天的内容比较多,有三个新东西(批处理、语义缓存、ROI),我在汇报里建议拆成两天。读的时候可以分两次:前两部分是「换个方式省钱」,第三部分是「这笔账到底怎么算」。

## 第一部分:批处理,把不急的活挪开

### 批处理接口是什么

在线调用是你发一个请求、等一个响应。批处理反过来:你把一大批请求打包成一个文件交上去,服务商在后台慢慢跑,什么时候跑完不保证(通常几小时内,最晚 24 小时),你过一会儿回来取结果文件。服务商用「你不着急」换你「价格打对折」,因为它可以把你的活塞进自己机器的空档里。

三家的官方文档(2026 年 10 月 27 日读到的)这样写:

| | Anthropic Message Batches | OpenAI Batch API | 硅基流动 Batch |
| --- | --- | --- | --- |
| 折扣 | 50% | 50% | 50% |
| 完成时限 | 多数 1 小时内,最晚 24 小时,超时作废 | 24 小时,目前只有这一个选项 | 预期 24 小时内,`completion_window` 可设 24h 到 336h |
| 单批上限 | 10 万个请求或 256 MB,先到先停 | 5 万个请求,输入文件 200 MB | 5000 行,文件 1 GB |
| 结果保留 | 创建后 29 天 | (文档没写,我没查到) | 30 天 |
| 能用的接口 | Messages | responses、chat/completions、embeddings 等多个 | 只有 chat/completions,只有 DeepSeek V3、V3.1-Terminus、R1 三个模型 |
| 缓存能叠加吗 | 能,建议用 1 小时缓存,因为批处理可能超过 5 分钟 | | |

出处:[Anthropic 批处理文档](https://platform.claude.com/docs/en/build-with-claude/batch-processing)、[OpenAI Batch 指南](https://developers.openai.com/api/docs/guides/batch)、[硅基流动批量推理文档](https://docs.siliconflow.cn/cn/userguide/guides/batch)。三家的细节还会变,表里是我读到的时点。这一节里的官方接口**我都没有成功实跑**:Anthropic 和 OpenAI 我没有 key;硅基流动我有 key,但提交时被拒绝了,下面马上演示这个报错。

### 适合和不适合

适合的是「不需要立刻要结果、可以拆成一条条独立请求」的活:给几万张历史工单批量打标签、把评测集整个跑一遍(第六部分讲评测会大量用到)、生成合成测试数据、给旧文档批量做 embedding。

不适合的是在线对话,也不适合需要多轮工具调用的 Agent:Agent 每一轮都依赖上一轮的结果,每一轮都要排一次队,延迟乘以轮数,可能一个任务等几天。我的建议是把评测集放在批处理上跑,每次评测省一半钱,而且批处理不受在线限速影响,不会因为 429 把整批打断。

### 一个真实的报错

硅基流动的批处理接口是 OpenAI 兼容的:先上传一个 `.jsonl` 文件(`purpose="batch"`),每一行是一个完整的请求,必须带唯一的 `custom_id`;再用文件 id 创建批任务。我先写了提交脚本:

```python
# agent-zero-lab/part07/batch_submit.py
import json
import os
from pathlib import Path

from dotenv import load_dotenv
from openai import OpenAI

from part07.ticket_spans import TICKETS

load_dotenv()
client = OpenAI(base_url=os.environ["EMB_BASE_URL"], api_key=os.environ["EMB_API_KEY"])  # 硅基流动
MODEL = "deepseek-ai/DeepSeek-V3"  # 文档里目前支持批量推理的三个模型之一

IN_FILE = Path("batch/classify_in.jsonl")


def main() -> None:
    IN_FILE.parent.mkdir(exist_ok=True)
    with IN_FILE.open("w", encoding="utf-8") as f:
        for i in range(20):
            text = TICKETS[i % len(TICKETS)]
            body = {
                "model": MODEL,
                "messages": [{"role": "user", "content": f"把工单分成 billing/tech/other 之一,只回一个词:{text}"}],
                "max_tokens": 5,
            }
            f.write(json.dumps({"custom_id": f"ticket-{i:02d}", "method": "POST", "url": "/v1/chat/completions", "body": body}, ensure_ascii=False) + "\n")

    uploaded = client.files.create(file=IN_FILE.open("rb"), purpose="batch")
    batch = client.batches.create(
        input_file_id=uploaded.id,
        endpoint="/v1/chat/completions",
        completion_window="24h",
        extra_body={"replace": {"model": MODEL}},
    )
    Path("batch/batch_id.txt").write_text(batch.id)
    print("file", uploaded.id, "batch", batch.id, "status", batch.status)


if __name__ == "__main__":
    main()
```

<div class="line-notes">

- `from openai import OpenAI` 这个脚本只提交一次,不需要异步,用同步客户端。
- `client = OpenAI(base_url=os.environ["EMB_BASE_URL"],` 硅基流动,用的是 `.env` 里 `EMB_*` 那一组(同一个账号)。
- `MODEL = "deepseek-ai/DeepSeek-V3"` 文档写明只有 DeepSeek-V3、V3.1-Terminus 和 R1 三个模型支持批量推理,所以选 V3。
- `IN_FILE = Path("batch/classify_in.jsonl")` 输入文件放在 `batch/` 目录。
- `def main() -> None:` 把提交过程放进函数,方便 `if __name__ == "__main__":` 保护。
- `IN_FILE.parent.mkdir(exist_ok=True)` 先保证 `batch/` 目录存在。
- `with IN_FILE.open("w", encoding="utf-8") as f:` 写入模式打开,一行一个请求。
- `for i in range(20):` 20 个请求。
- `text = TICKETS[i % len(TICKETS)]` 沿用 Day 401 的六张工单,轮着用。
- `"max_tokens": 5,` 分类只回一个词。
- `f.write(json.dumps({"custom_id": f"ticket-{i:02d}", "method": "POST", "url": "/v1/chat/completions", "body": body}, ensure_ascii=False) + "\n")` 官方文件格式:`custom_id` 唯一,`method` 和 `url` 说明这是哪个接口,`body` 就是平时 `chat.completions.create` 的参数。第 0 条是 `ticket-00`。
- `uploaded = client.files.create(file=IN_FILE.open("rb"), purpose="batch")` 上传文件,`purpose="batch"`。注意要用二进制模式 `"rb"` 打开。
- `batch = client.batches.create(` 创建批任务。
- `completion_window="24h",` 允许的完成时限,文档说可以从 24h 到 336h(14 天),时限越长服务商越好安排。
- `extra_body={"replace": {"model": MODEL}},` 硅基流动的扩展:用这个字段覆盖文件里每行的 `model`,避免文件和任务里的模型不一致。
- `Path("batch/batch_id.txt").write_text(batch.id)` 把批任务 id 存下来,之后要凭它查状态、取结果。
- `print("file", uploaded.id,` 打印文件 id、批任务 id 和状态。

</div>

```bash
cd agent-zero-lab
uv run python -m part07.batch_submit
```

```text
Traceback (most recent call last):
  File ".../part07/batch_submit.py", line 31, in main
    uploaded = client.files.create(file=IN_FILE.open("rb"), purpose="batch")
...
openai.APIStatusError: Error code: 402 - Sorry, your account balance is insufficient
```

在上传文件这一步就被拒绝了:`402`,账户余额不足。我的硅基流动账户余额不够,文件接口不让用(同一个 key 调 Qwen3-14B 聊天是正常的)。这个 402 说明:**批处理和普通聊天的计费门槛可能不一样,别想当然地认为聊天能用,批处理就能用。** 官方的批处理接口我就这样没跑成,下面用本地批处理器顶上,它的输入输出格式照着官方的文件格式做,这样以后换成官方接口,只改一处。

### 在没有批处理接口的厂商上:本地批处理器

DeepSeek 官方没有批处理接口(我用 key 请求 `/v1/batches` 得到 404),它给的是另一个形式的优惠:非高峰时段价格减半([Day 396](/blog/agent-zero/day-396-cost-1/) 的 `PRICES` 里就是 `idle` 那一列)。想达到「便宜地批量处理」,自己写一个本地批处理器就行,功能是三件事:读一个和官方格式一样的 `.jsonl`、限制并发地跑完、每完成一条就追加写进输出文件,崩了重跑时跳过已经完成的(这就是 [Day 393](/blog/agent-zero/day-393-resume/) 断点续跑的思路)。

```python
# agent-zero-lab/part07/batch_local.py
import asyncio
import json
import os
import sys
from pathlib import Path

from dotenv import load_dotenv
from openai import AsyncOpenAI

from part07.pricing import call_cost

load_dotenv()
client = AsyncOpenAI(base_url=os.environ["LLM_BASE_URL"], api_key=os.environ["LLM_API_KEY"], timeout=60, max_retries=2)
EXTRA = json.loads(os.environ.get("LLM_EXTRA_BODY", "{}"))


def read_jsonl(path: Path) -> list[dict]:
    if not path.exists():
        return []
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


async def run_batch(in_file: Path, out_file: Path, err_file: Path, model: str, workers: int = 4, limit: int | None = None) -> None:
    done = {row["custom_id"] for row in read_jsonl(out_file)}  # 输出文件里已经有的,不再重跑
    todo = [req for req in read_jsonl(in_file) if req["custom_id"] not in done]
    if limit is not None:
        todo = todo[:limit]
    print(f"输入 {len(done) + len(todo)} 条,已完成 {len(done)} 条,这次跑 {len(todo)} 条")
    sem = asyncio.Semaphore(workers)

    async def one(req: dict) -> None:
        async with sem:
            try:
                r = await client.chat.completions.create(**{**req["body"], "model": model}, extra_body=EXTRA)
                row = {
                    "custom_id": req["custom_id"],
                    "response": {
                        "status_code": 200,
                        "body": {
                            "choices": [{"message": {"content": r.choices[0].message.content}}],
                            "usage": {
                                "prompt_tokens": r.usage.prompt_tokens if r.usage else 0,
                                "completion_tokens": r.usage.completion_tokens if r.usage else 0,
                            },
                        },
                    },
                }
                target = out_file
            except Exception as exc:  # noqa: BLE001
                row = {"custom_id": req["custom_id"], "error": {"code": type(exc).__name__, "message": str(exc)[:100]}}
                target = err_file
            with target.open("a", encoding="utf-8") as f:  # 一条一条追加,中途崩了已完成的不丢
                f.write(json.dumps(row, ensure_ascii=False) + "\n")

    await asyncio.gather(*(one(req) for req in todo))


def summary(out_file: Path, model: str) -> None:
    rows = read_jsonl(out_file)
    p = sum(r["response"]["body"]["usage"]["prompt_tokens"] for r in rows)
    c = sum(r["response"]["body"]["usage"]["completion_tokens"] for r in rows)
    peak = call_cost(model, p, 0, c, "peak")
    idle = call_cost(model, p, 0, c, "idle")
    print(f"输出文件 {len(rows)} 条,输入 {p} token,输出 {c} token;峰时价 {peak * 100:.4f} 分,空闲价 {idle * 100:.4f} 分")


if __name__ == "__main__":
    model = "deepseek-flash"
    limit = int(sys.argv[1]) if len(sys.argv) > 1 else None
    asyncio.run(run_batch(Path("batch/classify_in.jsonl"), Path("batch/classify_out.jsonl"), Path("batch/classify_err.jsonl"), model, limit=limit))
    summary(Path("batch/classify_out.jsonl"), model)
```

<div class="line-notes">

- `client = AsyncOpenAI(` DeepSeek 官方的异步客户端。`timeout=60, max_retries=2`:单个请求最多等 60 秒,失败最多重试 2 次。
- `def read_jsonl(path: Path) -> list[dict]:` 把一个 `.jsonl` 文件读成字典列表,输入输出文件都用它读。
- `if not path.exists():` 文件还不存在(第一次跑,输出文件还没建)就返回空列表,不报错。
- `async def run_batch(` 批处理主函数:输入文件、输出文件、错误文件、模型、并发数、这次最多跑几条。
- `done = {row["custom_id"] for row in read_jsonl(out_file)}  # 输出文件里已经有的,不再重跑` 集合推导式,把输出文件里已完成的 `custom_id` 收成一个集合,查找 O(1)。这就是断点续跑的关键。
- `todo = [req for req in read_jsonl(in_file) if req["custom_id"] not in done]` 输入里还没完成的才要跑。
- `if limit is not None:` `limit` 是为了演示「中途停下」:只跑前 N 条。
- `print(f"输入 {len(done) + len(todo)} 条` 先报告:输入一共多少条、已完成几条、这次跑几条。
- `sem = asyncio.Semaphore(workers)` 限制同时发几个请求,默认 4。
- `async def one(req: dict) -> None:` 处理一条。
- `r = await client.chat.completions.create(**{**req["body"], "model": model}, extra_body=EXTRA)` `{**req["body"], "model": model}` 把输入行里的 `body` 复制一份并把 `model` 覆盖成我们指定的(官方文件里的模型名是硅基流动的,DeepSeek 官方要换成 `deepseek-flash`),`**` 再把字典展开成关键字参数。
- `"custom_id": req["custom_id"],` 输出行带上同一个 `custom_id`。官方批处理的输出**不保证和输入同样的顺序**,必须靠它对应回去。
- `"status_code": 200,` 仿照官方输出行的结构:一层 `response`,里面 `status_code` 和 `body`。
- `"prompt_tokens": r.usage.prompt_tokens if r.usage else 0,` 只留我们要用的用量字段,给后面算钱。
- `target = out_file` 成功的写进输出文件。
- `except Exception as exc:  # noqa: BLE001` 任何一条失败都不能让整批垮掉,捕获后记错误。
- `row = {"custom_id": req["custom_id"], "error": {"code": type(exc).__name__, "message": str(exc)[:100]}}` 错误行也带 `custom_id`。
- `target = err_file` 失败的写进另一个文件,**不进输出文件**,所以下次重跑时它还会被当作「未完成」重试。
- `with target.open("a", encoding="utf-8") as f:  # 一条一条追加,中途崩了已完成的不丢` 追加写。这里没加锁,因为 `asyncio` 是单线程,`with` 块里没有 `await`,不会被别的协程打断。
- `await asyncio.gather(*(one(req) for req in todo))` 把所有待办一起丢给 `gather`,实际并发被信号量卡在 `workers`。
- `def summary(out_file: Path, model: str) -> None:` 汇总用量和花费。
- `p = sum(r["response"]["body"]["usage"]["prompt_tokens"] for r in rows)` 输入 token 总数。
- `peak = call_cost(model, p, 0, c, "peak")` 同样的 token 数,按峰时价算一遍。缓存命中数传 0,分类提示词很短,没有缓存。
- `idle = call_cost(model, p, 0, c, "idle")` 再按空闲价算一遍。
- `print(f"输出文件 {len(rows)} 条` 打印条数、token 数、两种价格下的花费(分)。
- `if __name__ == "__main__":` 命令行入口。
- `limit = int(sys.argv[1]) if len(sys.argv) > 1 else None` 带一个数字就只跑前几条,不带就全跑。
- `asyncio.run(run_batch(` 输入文件复用上面提交脚本生成的 `batch/classify_in.jsonl`。
- `summary(Path("batch/classify_out.jsonl"), model)` 结束后汇总。

</div>

先只跑 8 条(模拟中途断掉),再不带参数跑一遍,看它是不是只补剩下的:

```bash
uv run python -m part07.batch_local 8
uv run python -m part07.batch_local
head -2 batch/classify_out.jsonl
```

```text
输入 8 条,已完成 0 条,这次跑 8 条
输出文件 8 条,输入 266 token,输出 14 token;峰时价 0.0644 分,空闲价 0.0322 分
输入 20 条,已完成 8 条,这次跑 12 条
输出文件 20 条,输入 648 token,输出 36 token;峰时价 0.1584 分,空闲价 0.0792 分
{"custom_id": "ticket-03", "response": {"status_code": 200, "body": {"choices": [{"message": {"content": "billing"}}], "usage": {"prompt_tokens": 34, "completion_tokens": 2}}}}
{"custom_id": "ticket-01", "response": {"status_code": 200, "body": {"choices": [{"message": {"content": "tech"}}], "usage": {"prompt_tokens": 30, "completion_tokens": 1}}}}
```

第二遍只补了剩下的 12 条,输出文件到 20 条齐,没有重复调用。注意 `head -2` 看到的第一行是 `ticket-03`、第二行是 `ticket-01`,**输出的顺序不是输入的顺序**,因为 4 个请求同时跑,谁先回来谁先写。官方批处理也是这样,所以输出行必须带 `custom_id`,下游按它对号入座,不能依赖行号。

再看钱。20 张分类工单一共 648 个输入 token、36 个输出 token,在峰时要花 0.1584 分,空闲时只要 0.0792 分,正好是一半。放大到真实的量级:给 100 万张历史工单打标签,按这个比例,每张 0.0079 分,峰时共约 79 元,空闲约 40 元。这笔账有两个读法。一是错峰半价确实是真的,批量任务排到 DeepSeek 的非高峰(北京时间 12 点到 14 点、18 点以后、周末)跑,同样的活半价。二是这个钱数本身很小:分类的提示词只有三十几个 token,批处理省下的 40 元,对一个有几万张工单的客服系统来说是零头。批处理真正值钱的场景是**输入很长**的离线任务,比如给每张工单附上几千 token 的客户历史再让模型总结,那时候一半的折扣就是真金白银。今天的 ROI 脚本会再回到这一点。

做批处理有三个容易踩的坑,都是本地批处理器里已经处理了的:

- **输出顺序不保证**,必须用 `custom_id` 对应。
- **单条失败不能让整批作废**,错误记到单独的文件,只重试没成功的。
- **要能续跑**。大批量任务中途一定会碰到限速、网络抖动、你自己手滑 Ctrl-C,没有断点续跑,重来就是重付一遍钱。

## 第二部分:语义缓存,以及它为什么危险

### 缓存的三种强度

[Day 397](/blog/agent-zero/day-397-prompt-caching/) 讲的 prompt caching 是厂商帮你省**输入**的钱:你还是要调模型,只是前缀便宜了。今天讲的缓存更激进,**直接不调模型**:

- **精确缓存**:输入一字不差才命中,命中就直接返回上次的结果。零风险。
- **语义缓存**:把问题转成向量,新问题和某个旧问题「足够像」就返回旧答案。省得最多,风险最大。
- 中间还有「规范化后精确匹配」,比如去掉多余空白、统一大小写,下面的精确缓存就这么做。

语义缓存听起来很美:客服场景里「怎么导出年度账单」有一百种问法,为什么每种都要调一次模型?我的态度是**非常谨慎**,而且今天用实验说明谨慎的理由。

### 实验一:相似度能不能分开「同义」和「易混」

用 [Day 217](/blog/agent-zero/day-217-embed-service/) 的 embedding(`BAAI/bge-m3`,硅基流动)。如果你的 `common/embed.py` 和 Day 217 的接口一致(`embed`、`embed_one`、`cosine`、模块级的 `usage`),下面这份可以不用重写,我把我跑的版本放在这里,方便对照:

```python
# agent-zero-lab/common/embed.py(Day 217 建的那份,这里是我为了能跑而写的等价版本)
import math
import os

from dotenv import load_dotenv
from openai import OpenAI

load_dotenv()
_client = OpenAI(base_url=os.environ["EMB_BASE_URL"], api_key=os.environ["EMB_API_KEY"], timeout=60)
MODEL = os.environ.get("EMB_MODEL", "BAAI/bge-m3")
BATCH = int(os.environ.get("EMB_BATCH", "10"))
usage = {"calls": 0, "tokens": 0}


def embed(texts: list[str]) -> list[list[float]]:
    out: list[list[float]] = []
    for i in range(0, len(texts), BATCH):
        resp = _client.embeddings.create(model=MODEL, input=texts[i : i + BATCH])
        usage["calls"] += 1
        usage["tokens"] += resp.usage.total_tokens if resp.usage else 0
        out.extend(d.embedding for d in resp.data)
    return out


def embed_one(text: str) -> list[float]:
    return embed([text])[0]


def cosine(a: list[float], b: list[float]) -> float:
    dot = sum(x * y for x, y in zip(a, b))
    return dot / (math.sqrt(sum(x * x for x in a)) * math.sqrt(sum(y * y for y in b)))
```

<div class="line-notes">

- `_client = OpenAI(base_url=os.environ["EMB_BASE_URL"], api_key=os.environ["EMB_API_KEY"], timeout=60)` 同步客户端,embedding 调用不需要异步。
- `MODEL = os.environ.get("EMB_MODEL", "BAAI/bge-m3")` 模型名从环境变量读,默认 bge-m3。
- `BATCH = int(os.environ.get("EMB_BATCH", "10"))` 一次最多发几条文本,硅基流动的 bge-m3 有批量上限(`.env` 里写的是 10)。
- `usage = {"calls": 0, "tokens": 0}` 模块级的用量计数器,所有脚本共用。
- `def embed(texts: list[str]) -> list[list[float]]:` 一批文本变成一批向量。
- `for i in range(0, len(texts), BATCH):` 每 `BATCH` 条切一段,`range(0, n, 10)` 步长是 10。
- `resp = _client.embeddings.create(model=MODEL, input=texts[i : i + BATCH])` 一次请求发一段。
- `usage["tokens"] += resp.usage.total_tokens if resp.usage else 0` 累加用量。
- `out.extend(d.embedding for d in resp.data)` 把每条文本对应的向量追加进结果。
- `def embed_one(text: str) -> list[float]:` 单条的便捷版。
- `def cosine(a: list[float], b: list[float]) -> float:` 余弦相似度,[Day 215](/blog/agent-zero/day-215-cosine/) 手算过。
- `dot = sum(x * y for x, y in zip(a, b))` 点积。
- `return dot / (math.sqrt(sum(x * x for x in a)) * math.sqrt(sum(y * y for y in b)))` 点积除以两个向量长度的乘积。

</div>

然后设计两组问句。第一组是**同一个意思**的不同问法(五对),答案一样,缓存命中是对的;第二组是**长得很像但答案不同**的(六对),命中就是答错。第二组全是客服场景里真实存在的:年付能不能退款和月付能不能退款,规则里答案相反。

```python
# agent-zero-lab/part07/semcache_pairs.py
from common.embed import cosine, embed, usage

# (问法 A, 问法 B)。第一组是同一个意思,答案一样,缓存命中是对的
SAME = [
    ("怎么导出年度账单", "年度账单在哪里导出"),
    ("发票抬头能改吗", "开错抬头了可以修改吗"),
    ("退款多久到账", "申请退款后几天能收到钱"),
    ("怎么取消自动续费", "我想关闭自动续订"),
    ("忘记密码怎么办", "登录密码怎么找回"),
]
# 第二组长得很像,可答案不一样,命中就是答错
DIFF = [
    ("我的发票金额不对", "我的发票日期不对"),
    ("年付可以退款吗", "月付可以退款吗"),
    ("企业版能退款吗", "基础版能退款吗"),
    ("我要开具发票", "我要作废发票"),
    ("怎么升级到企业版", "怎么降级到基础版"),
    ("导出 PDF 发票时页面转圈", "导出 Excel 账单时页面转圈"),
]


def sims(pairs: list[tuple[str, str]]) -> list[float]:
    vecs = embed([t for pair in pairs for t in pair])
    return [cosine(vecs[2 * i], vecs[2 * i + 1]) for i in range(len(pairs))]


def main() -> None:
    same, diff = sims(SAME), sims(DIFF)
    print("同一个意思(应该命中):")
    for (a, b), s in zip(SAME, same):
        print(f"  {s:.3f}  {a}  |  {b}")
    print("长得像但答案不同(不该命中):")
    for (a, b), s in zip(DIFF, diff):
        print(f"  {s:.3f}  {a}  |  {b}")
    print(f"同义最低 {min(same):.3f},易混最高 {max(diff):.3f}")
    for th in (0.80, 0.85, 0.90):
        hit_same = sum(s >= th for s in same)
        hit_diff = sum(s >= th for s in diff)
        print(f"阈值 {th:.2f}:同义命中 {hit_same}/{len(same)},误命中 {hit_diff}/{len(diff)}")
    print("embedding 用量:", usage)


if __name__ == "__main__":
    main()
```

<div class="line-notes">

- `from common.embed import cosine, embed, usage` 用上面的 embedding 模块。
- `SAME = [` 同义的五对,比如「退款多久到账」和「申请退款后几天能收到钱」。
- `DIFF = [` 易混的六对。「我的发票金额不对」和「我的发票日期不对」只差一个词,但处理方式完全不同(一个查金额,一个查日期)。
- `def sims(pairs: list[tuple[str, str]]) -> list[float]:` 算每一对的相似度。
- `vecs = embed([t for pair in pairs for t in pair])` 把所有对的两句话展平成一个列表一次性发给 embedding(两层 `for` 从左到右读),向量按顺序排:第 0、1 个是第一对,依此类推。
- `return [cosine(vecs[2 * i], vecs[2 * i + 1]) for i in range(len(pairs))]` 第 i 对的两个向量下标是 `2*i` 和 `2*i+1`。
- `same, diff = sims(SAME), sims(DIFF)` 两组各算一次。
- `for (a, b), s in zip(SAME, same):` 把每一对问句和它的相似度配起来打印。`zip` 把两个列表按位置配对。
- `print(f"同义最低 {min(same):.3f},易混最高 {max(diff):.3f}")` 关键对比:同义里最低的和易混里最高的,谁比谁高。
- `for th in (0.80, 0.85, 0.90):` 试三个阈值。
- `hit_same = sum(s >= th for s in same)` 同义问法有几对达到阈值(会命中,是对的)。
- `print("embedding 用量:", usage)` 这个实验一共花了几次请求、多少 token。

</div>

```bash
uv run python -m part07.semcache_pairs
```

```text
同一个意思(应该命中):
  0.953  怎么导出年度账单  |  年度账单在哪里导出
  0.829  发票抬头能改吗  |  开错抬头了可以修改吗
  0.950  退款多久到账  |  申请退款后几天能收到钱
  0.932  怎么取消自动续费  |  我想关闭自动续订
  0.891  忘记密码怎么办  |  登录密码怎么找回
长得像但答案不同(不该命中):
  0.885  我的发票金额不对  |  我的发票日期不对
  0.910  年付可以退款吗  |  月付可以退款吗
  0.866  企业版能退款吗  |  基础版能退款吗
  0.812  我要开具发票  |  我要作废发票
  0.750  怎么升级到企业版  |  怎么降级到基础版
  0.901  导出 PDF 发票时页面转圈  |  导出 Excel 账单时页面转圈
同义最低 0.829,易混最高 0.910
阈值 0.80:同义命中 5/5,误命中 5/6
阈值 0.85:同义命中 4/5,误命中 4/6
阈值 0.90:同义命中 3/5,误命中 2/6
embedding 用量: {'calls': 3, 'tokens': 199}
```

这张输出是今天最重要的一个实验结果。**同义问法里最低的是 0.829,易混问法里最高的是 0.910,两组分数重叠了。** 没有任何一个阈值能把它们分开:阈值 0.80,同义全中,但 6 对易混里有 5 对也命中了;提到 0.85,同义丢一对,易混仍然命中 4 对;提到 0.90,易混还有 2 对命中(「年付可以退款吗」对「月付可以退款吗」是 0.910),同义却已经只剩 3 对。再往上提,命中率会掉得更惨,缓存就没有意义了。

原因不难懂。embedding 衡量的是「话题上的接近」,「年付」和「月付」在话题上几乎一样,它们的区别恰恰是业务里最要紧的那一个词。这和 [Day 219](/blog/agent-zero/day-219-embed-limits/) 讲的 embedding 对否定句、数字不敏感是同一类短板。你换更好的 embedding 模型、换更大的样本,分数分布会有所不同,但「相似不等于等价」这件事不会变。(我只测了 11 对问句,够说明问题,不够给你一个通用的阈值,千万别把 0.9 抄走。)

### 缓存还有三个比阈值更要命的问题

就算阈值设得再准,客服场景里语义缓存还有三个结构性问题。拿一个最小的实现来看,我把三道闸门写进了 `get` 里:

```python
# agent-zero-lab/part07/semcache.py
import time
from dataclasses import dataclass

from common.embed import cosine, embed_one


@dataclass
class Entry:
    question: str
    vec: list[float]
    answer: str
    scope: str  # 谁的缓存:公共知识写 "public",带客户数据的写客户号
    kb_version: str
    created: float


class SemanticCache:
    def __init__(self, threshold: float = 0.90, ttl: float = 3600.0) -> None:
        self.threshold = threshold
        self.ttl = ttl
        self.entries: list[Entry] = []

    def put(self, question: str, answer: str, scope: str, kb_version: str) -> None:
        self.entries.append(Entry(question, embed_one(question), answer, scope, kb_version, time.time()))

    def get(self, question: str, scope: str, kb_version: str) -> tuple[str, float, str] | None:
        """返回 (答案, 相似度, 命中的那条旧问题);没命中返回 None。"""
        vec = embed_one(question)
        best: tuple[str, float, str] | None = None
        for e in self.entries:
            if e.scope != scope or e.kb_version != kb_version or time.time() - e.created > self.ttl:
                continue  # 范围不对、知识库换版本了、过期了:一律当没有
            s = cosine(vec, e.vec)
            if s >= self.threshold and (best is None or s > best[1]):
                best = (e.answer, s, e.question)
        return best
```

<div class="line-notes">

- `@dataclass` 一条缓存记录用数据类。
- `class Entry:` 缓存里的一条:问题、问题的向量、答案、范围、知识库版本、创建时间。
- `scope: str  # 谁的缓存:公共知识写 "public",带客户数据的写客户号` 第一道闸门:**范围**。「我的发票金额是多少」的答案属于某个客户,不能给别的客户看。
- `kb_version: str` 第二道闸门:**知识库版本**。知识库更新后,旧答案不会自动失效,所以每条缓存记下它是基于哪一版知识库生成的。
- `class SemanticCache:` 缓存本体。
- `def __init__(self, threshold: float = 0.90, ttl: float = 3600.0) -> None:` 阈值默认 0.90,过期时间默认 3600 秒。`ttl` 是第三道闸门:**过期**。
- `def put(` 写入一条。
- `self.entries.append(Entry(` 对问题做一次 embedding 存起来,同时记下范围、版本和当前时间。`time.time()` 返回秒数,相当于 JS 的 `Date.now() / 1000`。
- `def get(` 查询,带上当前的范围和版本。
- `vec = embed_one(question)` 把新问题转成向量,**每次查询都要调一次 embedding**,所以语义缓存不是零成本的:要付一次 embedding 的钱,还要多等一次网络往返(我测了 8 次 `embed_one`,中位数 0.10 秒,第一次建连接 0.22 秒)。
- `best: tuple[str, float, str] | None = None` 记录目前最像的那一条。
- `for e in self.entries:` 逐条比较(条目多了要换成向量数据库,第四部分讲)。
- `if e.scope != scope or e.kb_version != kb_version or time.time() - e.created > self.ttl:` 三个条件任一成立,这一条当作不存在:范围不对、版本不对、已过期。注意是**先过滤再比相似度**,不是比完再过滤。
- `s = cosine(vec, e.vec)` 算相似度。
- `if s >= self.threshold and (best is None or s > best[1]):` 达到阈值,且比目前最好的更像,就更新。
- `return best` 没命中返回 `None`,调用方去调模型。

</div>

用它跑一个小演示(不调大模型,答案是我手写的,只演示命中逻辑):

```python
# agent-zero-lab/part07/semcache_demo.py
from part07.semcache import SemanticCache

cache = SemanticCache(threshold=0.90)
cache.put("怎么导出年度账单", "在「账单中心 → 导出」选年度,点下载。", "public", "kb-v1")
cache.put("年付可以退款吗", "年付仅专业版和企业版可退,14 天内全额。", "public", "kb-v1")
cache.put("我的发票金额是多少", "您的发票 INV-0123 金额为 2392.00 元。", "C001", "kb-v1")

TESTS = [
    ("年度账单在哪里导出", "public", "kb-v1", "同义问法"),
    ("月付可以退款吗", "public", "kb-v1", "易混:答案应该不同"),
    ("我的发票金额是多少", "C002", "kb-v1", "另一个客户问同一句"),
    ("我的发票金额是多少", "C001", "kb-v1", "本人再问"),
    ("年度账单在哪里导出", "public", "kb-v2", "知识库升级后"),
]
for question, scope, ver, note in TESTS:
    hit = cache.get(question, scope, ver)
    print(f"{note:<16} {scope:<6} {ver} →", f"命中 {hit[1]:.3f} 「{hit[2]}」→ {hit[0]}" if hit else "没命中,去调模型")

leaky = SemanticCache(threshold=0.90)
leaky.put("我的发票金额是多少", "您的发票 INV-0123 金额为 2392.00 元。", "C001", "kb-v1")
leaky.entries[0].scope = "public"  # 故意把客户数据的缓存放进公共范围
leak = leaky.get("我的发票金额是多少", "public", "kb-v1")
print("没带范围会怎样:C002 问「我的发票金额是多少」,拿到", leak[0] if leak else None)
```

<div class="line-notes">

- `cache = SemanticCache(threshold=0.90)` 阈值 0.90,是上面实验里「同义命中 3/5、易混误命中 2/6」那个点。
- `cache.put("怎么导出年度账单"` 放一条公共知识:写 `public` 范围、`kb-v1` 版本。
- `cache.put("我的发票金额是多少"` 放一条客户数据的缓存:范围是客户 `C001`。
- `TESTS = [` 五个测试:同义问法、易混问法、另一个客户问同一句、本人再问、知识库升级后。
- `for question, scope, ver, note in TESTS:` 一个一个查。
- `hit = cache.get(question, scope, ver)` 带上查询者的范围和当前知识库版本。
- `print(f"{note:<16}` 打印说明、范围、版本、是否命中。`{note:<16}` 左对齐占 16 格。
- `leaky = SemanticCache(threshold=0.90)` 再造一个缓存,演示**没有范围隔离**会怎样。
- `leaky.entries[0].scope = "public"` 故意把客户 C001 的发票答案放到公共范围里,模拟「缓存键里忘了带客户号」。
- `leak = leaky.get(` 另一个客户以公共范围来问。
- `print("没带范围会怎样` 打印它拿到了什么。

</div>

```bash
uv run python -m part07.semcache_demo
```

```text
同义问法             public kb-v1 → 命中 0.953 「怎么导出年度账单」→ 在「账单中心 → 导出」选年度,点下载。
易混:答案应该不同        public kb-v1 → 命中 0.911 「年付可以退款吗」→ 年付仅专业版和企业版可退,14 天内全额。
另一个客户问同一句        C002   kb-v1 → 没命中,去调模型
本人再问             C001   kb-v1 → 命中 1.000 「我的发票金额是多少」→ 您的发票 INV-0123 金额为 2392.00 元。
知识库升级后           public kb-v2 → 没命中,去调模型
没带范围会怎样:C002 问「我的发票金额是多少」,拿到 您的发票 INV-0123 金额为 2392.00 元。
```

逐行看:

- **第 1 行**同义问法命中,这是我们想要的。
- **第 2 行是事故**:客户问「月付可以退款吗」,缓存拿「年付可以退款吗」(相似度 0.911,过了 0.90)的答案回答了,说「年付仅专业版和企业版可退,14 天内全额」。而按我们的规则,月付一律不退。**用户被误导了,而且缓存系统自己完全不知道。** 这种错没有报错、没有异常,只会变成一个投诉。
- **第 3、4 行**是范围闸门起作用:客户 C002 问同一句话,没命中去调模型(模型会用 C002 自己的数据回答),C001 自己再问才命中。
- **第 5 行**是版本闸门:知识库升级到 v2,旧答案一律作废。
- **最后一行**是没有范围隔离的后果:C002 看到了 C001 的发票金额 2392.00 元。这是**数据泄露**,在受监管的行业会是事故报告。

所以我的立场是:**客服 Agent 里,只对「不涉及客户数据的纯知识问答」考虑语义缓存**(比如怎么导出年度账单);相似度阈值设得很高;缓存带范围、带知识库版本、带较短的过期时间;并且知识库一更新就整体清空。涉及客户数据、涉及金额、涉及规则分支的问题(退款、发票),别用。而且就算这么保守,也要像上面第 2 行那样,拿一批「易混问法」专门测一遍误命中率,把它写进上线检查清单。

### 零风险的那种:精确缓存

比语义缓存安全得多的是精确缓存:输入一字不差才命中。[Day 394](/blog/agent-zero/day-394-ticket-worker/) 里的分类节点就适合,同样的工单文字,分类结果可以复用。唯一做的「模糊」是把多余的空白和大小写规范掉:

```python
# agent-zero-lab/part07/exact_cache.py
import asyncio
import time

from part07.ticket_spans import TICKETS, classify

_cache: dict[str, str] = {}
stats = {"hit": 0, "miss": 0}


def normalize(text: str) -> str:
    return " ".join(text.split()).lower()  # 去掉多余空白、统一大小写;只做这点,不做任何「差不多」的合并


async def classify_cached(text: str) -> str:
    key = normalize(text)
    if key in _cache:
        stats["hit"] += 1
        return _cache[key]
    stats["miss"] += 1
    _cache[key] = await classify(text)
    return _cache[key]


async def main() -> None:
    stream = [TICKETS[i % len(TICKETS)] + ("  " if i % 3 == 0 else "") for i in range(24)]  # 24 张,只有 6 种文字,有的多了空格
    t0 = time.perf_counter()
    for text in stream:
        await classify_cached(text)
    print(f"24 张工单:命中 {stats['hit']},调模型 {stats['miss']},总耗时 {time.perf_counter() - t0:.2f}s")
    t0 = time.perf_counter()
    await classify_cached(TICKETS[0])
    print(f"命中一次的耗时:{(time.perf_counter() - t0) * 1e6:.0f} 微秒")


if __name__ == "__main__":
    asyncio.run(main())
```

<div class="line-notes">

- `_cache: dict[str, str] = {}` 模块级字典当缓存:键是规范化后的工单文字,值是分类结果。下划线开头表示「模块内部用」。
- `stats = {"hit": 0, "miss": 0}` 命中和未命中的计数。
- `def normalize(text: str) -> str:` 规范化。
- `return " ".join(text.split()).lower()` `text.split()` 不带参数时按任意空白切开并丢掉空串,再用单个空格拼回去,等于把多个空格和首尾空白都压成一个;`.lower()` 统一大小写。只做这点,**不做任何「差不多」的合并**。
- `async def classify_cached(text: str) -> str:` 带缓存的分类。
- `key = normalize(text)` 先规范化,再当键。
- `if key in _cache:` 命中。
- `stats["hit"] += 1` 命中计数加 1,直接返回缓存的结果。
- `stats["miss"] += 1` 没命中,计数加 1。
- `_cache[key] = await classify(text)` 调 Day 401 的 `classify`(真调模型),结果存进缓存。
- `stream = [TICKETS[i % len(TICKETS)] + ("  " if i % 3 == 0 else "") for i in range(24)]` 造一个 24 张工单的流,只有 6 种文字,每 3 张里有一张末尾多两个空格,模拟真实里偶尔的格式差异。注意这个流是我故意造的高重复率,真实系统的重复率取决于你的业务。
- `await classify_cached(TICKETS[0])` 再单独测一次命中的耗时。
- `print(f"命中一次的耗时` `* 1e6` 把秒换成微秒。

</div>

```bash
uv run python -m part07.exact_cache
```

```text
24 张工单:命中 18,调模型 6,总耗时 3.71s
命中一次的耗时:3 微秒
```

24 张只调了 6 次模型,命中 18 次(那些多了空格的也被规范化后命中了)。一次命中只花 3 微秒,对比一次模型调用的 0.6 秒,快了 20 万倍。这个例子的命中率是我用重复的流造出来的,所以别拿它当真实数据,它要说明的是机制:**确定的输入就可以确定地复用**,又快又不会错。分类、改写、抽取这类「同一输入应该同一输出」的节点,都可以这么加缓存,缓存键里要带上提示词的版本,提示词改了就别复用旧结果。

起草回复这类依赖客户数据、依赖当天状态的节点,不要缓存。

## 第三部分:Agent 经济学,这张账到底怎么算

前面六天(Day 396 到 Day 401)我们把一张工单的成本压到几分钱、把延迟压到一两秒。但老板问的从来不是这个。他问的是:上了 Agent 以后,客服这块总共省了多少,还是反而多花了。成本和延迟相关的要求在 JD 里很常见(旧课 Day 38 引用站长整理的 JD 调研:国内样本 28%、海外 39% 提到),而能把这笔账算清楚的人比会写 Agent 的人少得多。

### 先算基线:人工处理一张工单多少钱

下面所有数字除了「每张工单的模型费用」,**全是假设**,你要换成自己公司或目标公司的真实数字。模型费用那一项是 Day 400 实测的:退款工单,`deepseek-flash` 单干每张 0.3776 分,也就是 0.003776 元。

人工的账:一个坐席综合成本(工资、社保公积金、场地设备、管理分摊)每月 9000 元,每月有效工时 22 天 × 8 小时 × 80% ≈ 141 小时,每小时 63.8 元;一张工单人工从头处理要 8 分钟,所以人工每张 8.51 元。

Agent 不是全自动的。真实上线以后,工单分两类:Agent 起草、坐席花两分钟复核后发出去的,和 Agent 处理不了、转给人工从头做的。所以 Agent 路径的**变动成本**每张是:

```text
(1 − 转人工比例) × (模型费用 + 复核成本)
+ 转人工比例 × (模型费用 + 人工全流程成本)
+ 错误率 × 每次错误的损失
```

再加上每月的**固定成本**:服务器、可观测、工程师维护的时间分摊,再加上开发这个系统的一次性投入摊到每个月。把它写成脚本:

```python
# agent-zero-lab/part07/roi.py
from dataclasses import dataclass, replace


@dataclass(frozen=True)
class Assumptions:
    # 下面除了 token_cost,全是假设,换成你公司或目标公司的真实数字
    agent_monthly_cost: float = 9000.0  # 一个坐席的综合月成本(工资、社保、场地、管理分摊),元
    work_hours: float = 141.0  # 每月有效工时:22 天 × 8 小时 × 80%
    human_minutes: float = 8.0  # 人工从头处理一张工单要几分钟
    review_minutes: float = 2.0  # 坐席复核一张 Agent 草稿要几分钟
    escalate_rate: float = 0.30  # 转人工比例
    token_cost: float = 0.003776  # 每张工单的模型费用,元。Day 400 实测:flash 单干每张 0.3776 分
    fixed_monthly: float = 25000.0  # 每月固定成本:服务器、可观测、维护工程师的时间分摊
    error_rate: float = 0.02  # Agent 答错并造成损失的比例
    error_loss: float = 50.0  # 每次错误的平均损失,元
    build_cost: float = 160000.0  # 开发的一次性投入:4 个人月
    amortize_months: int = 24  # 一次性投入摊到几个月


def hourly(a: Assumptions) -> float:
    return a.agent_monthly_cost / a.work_hours


def human_per_ticket(a: Assumptions) -> float:
    return hourly(a) * a.human_minutes / 60


def agent_variable(a: Assumptions) -> float:
    review = hourly(a) * a.review_minutes / 60
    h = human_per_ticket(a)
    return (1 - a.escalate_rate) * (a.token_cost + review) + a.escalate_rate * (a.token_cost + h) + a.error_rate * a.error_loss


def fixed_per_month(a: Assumptions) -> float:
    return a.fixed_monthly + a.build_cost / a.amortize_months


def agent_per_ticket(a: Assumptions, n: int) -> float:
    return agent_variable(a) + fixed_per_month(a) / n


def break_even(a: Assumptions) -> float:
    saving = human_per_ticket(a) - agent_variable(a)
    return fixed_per_month(a) / saving if saving > 0 else float("inf")


def main() -> None:
    a = Assumptions()
    print(f"每小时 {hourly(a):.1f} 元;人工每张 {human_per_ticket(a):.2f} 元;Agent 变动成本每张 {agent_variable(a):.2f} 元(其中模型费用 {a.token_cost:.4f} 元)")
    print(f"每月固定 {fixed_per_month(a):.0f} 元(含开发摊销);盈亏平衡 {break_even(a):.0f} 张/月")
    print("月工单量 | Agent 每张 | 人工每张 | 每月省")
    for n in (3000, 10000, 30000, 100000):
        print(f"{n:>8} | {agent_per_ticket(a, n):>9.2f} | {human_per_ticket(a):>8.2f} | {(human_per_ticket(a) - agent_per_ticket(a, n)) * n:>9.0f}")

    print("\n敏感性(月 3 万张,每月省多少元):")
    base = (human_per_ticket(a) - agent_per_ticket(a, 30000)) * 30000
    print(f"  基线 {base:.0f}")
    cases = {
        "token 费用 ×10": replace(a, token_cost=a.token_cost * 10),
        "token 费用 ×100": replace(a, token_cost=a.token_cost * 100),
        "转人工 30% → 15%": replace(a, escalate_rate=0.15),
        "转人工 30% → 50%": replace(a, escalate_rate=0.50),
        "复核 2 分 → 6 分": replace(a, review_minutes=6.0),
        "错误率 2% → 5%": replace(a, error_rate=0.05),
    }
    for name, b in cases.items():
        v = (human_per_ticket(b) - agent_per_ticket(b, 30000)) * 30000
        print(f"  {name:<16} {v:>9.0f}  ({v - base:+.0f})")


if __name__ == "__main__":
    main()
```

<div class="line-notes">

- `from dataclasses import dataclass, replace` `replace` 用来「复制一份数据类、只改其中几个字段」,做敏感性分析很方便。
- `@dataclass(frozen=True)` `frozen=True` 让对象创建后不能修改,所有「改」都得通过 `replace` 造一个新的。这样做敏感性分析时不会不小心污染基线。
- `class Assumptions:` 所有假设放在一个类里,一眼能看出哪些数是假设。
- `agent_monthly_cost: float = 9000.0` 一个坐席的综合月成本,假设。
- `token_cost: float = 0.003776` 每张工单的模型费用,元。**这是整份假设里唯一的实测数**,来自 Day 400。
- `fixed_monthly: float = 25000.0` 每月固定成本,假设。
- `build_cost: float = 160000.0  # 开发的一次性投入:4 个人月` 假设:两个工程师做两个月,每人月 4 万元。
- `def hourly(a: Assumptions) -> float:` 坐席每小时成本:9000 ÷ 141 = 63.8 元。
- `def human_per_ticket(a: Assumptions) -> float:` 人工每张:63.8 × 8 分钟 ÷ 60 = 8.51 元。
- `def agent_variable(a: Assumptions) -> float:` Agent 路径的变动成本。
- `review = hourly(a) * a.review_minutes / 60` 复核一张的成本:63.8 × 2 ÷ 60 = 2.13 元。
- `return (1 - a.escalate_rate) * (a.token_cost + review) + a.escalate_rate * (a.token_cost + h) + a.error_rate * a.error_loss` 代入数字:0.7 × (0.0038 + 2.13) + 0.3 × (0.0038 + 8.51) + 0.02 × 50 = 1.49 + 2.55 + 1.00 = 5.05 元。
- `def fixed_per_month(a: Assumptions) -> float:` 每月固定成本:25000 + 160000 ÷ 24 = 31,667 元。
- `def agent_per_ticket(a: Assumptions, n: int) -> float:` 月工单量为 `n` 时,Agent 每张的总成本:变动成本加上固定成本平摊到每张。
- `def break_even(a: Assumptions) -> float:` 盈亏平衡点:固定成本 ÷ 每张省下的变动成本。
- `saving = human_per_ticket(a) - agent_variable(a)` 每张省下的变动成本:8.51 − 5.05 = 3.46 元。
- `return fixed_per_month(a) / saving if saving > 0 else float("inf")` 31,667 ÷ 3.46 ≈ 9,141 张/月。如果变动成本已经比人工还高(`saving <= 0`),再大的量也回不了本,返回无穷大。
- `def main() -> None:` 打印基线、不同月工单量下的对比和敏感性。
- `a = Assumptions()` 基线假设。
- `for n in (3000, 10000, 30000, 100000):` 四个月工单量。
- `cases = {` 敏感性的各个情景,每个改一个变量,其余不动。
- `"token 费用 ×10": replace(a, token_cost=a.token_cost * 10),` 模型费用涨到 10 倍,每张 0.038 元。
- `for name, b in cases.items():` 逐个情景算「每月省多少」并和基线比较。

</div>

```bash
uv run python -m part07.roi
```

```text
每小时 63.8 元;人工每张 8.51 元;Agent 变动成本每张 5.05 元(其中模型费用 0.0038 元)
每月固定 31667 元(含开发摊销);盈亏平衡 9141 张/月
月工单量 | Agent 每张 | 人工每张 | 每月省
    3000 |     15.60 |     8.51 |    -21274
   10000 |      8.21 |     8.51 |      2976
   30000 |      6.10 |     8.51 |     72263
  100000 |      5.36 |     8.51 |    314764

敏感性(月 3 万张,每月省多少元):
  基线 72263
  token 费用 ×10         71243  (-1020)
  token 费用 ×100        61048  (-11215)
  转人工 30% → 15%       100986  (+28723)
  转人工 30% → 50%        33965  (-38298)
  复核 2 分 → 6 分        -17099  (-89362)
  错误率 2% → 5%          27263  (-45000)
```

<figure>
<svg viewBox="0 0 640 260" role="img" aria-label="敏感性分析的横向条形图,以月 3 万张的基线每月省 72263 元为参照:token 费用涨到 10 倍少省 1020 元,涨到 100 倍少省 11215 元,转人工比例从 30% 降到 15% 多省 28723 元,升到 50% 少省 38298 元,复核时间从 2 分钟到 6 分钟少省 89362 元,错误率从 2% 到 5% 少省 45000 元">
<text x="20" y="22" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">每月省的钱相对基线(72,263 元)变了多少</text>
<line x1="330" y1="34" x2="330" y2="236" stroke="var(--rule)"/>
<text x="20" y="58" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">token ×10</text>
<rect x="326" y="46" width="4" height="16" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="338" y="58" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">-1,020</text>
<text x="20" y="88" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">token ×100</text>
<rect x="318" y="76" width="12" height="16" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="338" y="88" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">-11,215</text>
<text x="20" y="118" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">转人工 → 15%</text>
<rect x="330" y="106" width="30" height="16" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="368" y="118" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">+28,723</text>
<text x="20" y="148" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">转人工 → 50%</text>
<rect x="290" y="136" width="40" height="16" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="206" y="148" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">-38,298</text>
<text x="20" y="178" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">错误率 → 5%</text>
<rect x="283" y="166" width="47" height="16" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="200" y="178" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">-45,000</text>
<text x="20" y="208" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">复核 → 6 分钟</text>
<rect x="236" y="196" width="94" height="16" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="150" y="208" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">-89,362</text>
<text x="20" y="252" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">琥珀色:token 费用;蓝色:人工和质量相关的变量。条的长度按元数缩放</text>
</svg>
<figcaption>敏感性分析:把模型费用涨到 100 倍,每月只少省 1.1 万;复核时间从 2 分钟变 6 分钟,每月少省近 9 万,基线的 72,263 元整个变成亏损。</figcaption>
</figure>

### 这张表该怎么读

**月工单量决定生死。** 盈亏平衡在每月约 9,100 张。3,000 张时 Agent 每张 15.60 元,比人工 8.51 元贵近一倍,每月亏 2 万多;3 万张时每月省 7.2 万元;10 万张时省 31 万元。固定成本(服务器、维护、开发摊销)是个常数,量越大分摊越薄。这和旧课 Day 38 的结论一致,只是这次的假设里加进了开发投入,所以平衡点比当时(约 5,600 张)更靠后了。

**模型费用几乎不影响结论。** 这是整张表最反直觉的一行。把每张的模型费用涨到 10 倍(0.038 元),每月只少省 1,020 元,涨到 100 倍(0.38 元,比今天 Day 400 里最贵的 pro 配置还贵 30 多倍),也才少省 1.1 万元。`roi_token.py` 里的第一个练习会算出来:要涨到 639 倍,每张约 2.41 元,Agent 才不再比人工便宜。

所以我们从 Day 396 到 Day 400 花的工夫(缓存、路由、顾问),按这个假设算:把 flash 换成 pro 每月只多花 241 元,占省下 7.2 万的 0.3%;全部错峰半价每月只省 57 元。**如果你的场景像这样(单次调用短、人工很贵),优化模型费用是个很小的项目。** 它们的价值在别的地方:工单量到几百万的时候,或者每张工单要调几十次长上下文的时候,模型费用才会进入决定性变量的范围(后面练习里有一个这样的例子)。

**真正敏感的是人工和质量相关的变量:**

- **复核时长**:坐席对 Agent 的草稿不放心,每张都要自己重新查一遍系统,复核从 2 分钟变 6 分钟,每月省的钱从 7.2 万变成亏 1.7 万。这就是为什么审批界面要展示结构化的证据(查了哪张发票、引用了哪篇文章),让坐席 30 秒能判断对错,它不是体验问题,是 9 万元一个月的经济问题。
- **转人工比例**:30% 降到 15%,每月多省 2.9 万;升到 50%,少省 3.8 万。这就是为什么评测和迭代(第六部分)直接关系到钱。
- **错误率和每次错误的损失**:2% 的错误率、每次平均损失 50 元,每张工单是 1 元的隐性成本,占变动成本的五分之一。错误率到 5%,每月少省 4.5 万。评测集里「严重错误」那一类,最好能估一个单次损失金额,这样质量指标就能直接换算成钱。Day 400 里「错误退款申请」那个指标的意义就在这里:提交错一张退款单的损失,可能比省下的几千张模型费用还多。

### 什么时候不该上 Agent

把公式反过来读,不该上(或者至少不该全面上)的情形大概有四种:

- **量太小**。每月几百到几千张,固定成本摊不下来,不如给坐席配一个好用的知识库搜索。
- **工单不标准**。每张都是独特的复杂问题(大客户合同纠纷、跨系统数据问题),转人工比例高,复核也长,变动成本接近甚至超过人工。
- **错误的代价极高**。涉及资金、法律、医疗的决定,一次错误的损失能抵掉几千张工单省的钱。这类场景 Agent 可以做辅助(检索资料、整理信息),不该替人下决定。
- **人工本来就便宜又快**。如果 80% 的工单是「重置密码」这种一分钟能处理的,一个规则机器人或自助页面就够了,用不上大模型。

面试里被问到「你怎么评估这个 Agent 值不值得做」,能把这个公式、哪几个变量最敏感、以及这几条边界讲出来,比讲任何技术细节都更能说明你理解业务。而且要补一句诚实话:**这些数字大部分是假设,上线以后要用真实的转人工比例、复核时长和错误率回来换掉它们,再算一遍。**

## 零件和今天的文件对照

| 零件 | 文件 | 回答什么问题 |
| --- | --- | --- |
| 官方批处理接口(没跑通) | `batch_submit.py` | 官方文件格式、提交流程、402 的报错 |
| 本地批处理器 | `batch_local.py` | 断点续跑、`custom_id`、错峰价 |
| embedding 模块 | `common/embed.py` | 文本变向量、余弦相似度 |
| 相似度实验 | `semcache_pairs.py` | 同义和易混的分数是否重叠 |
| 语义缓存 | `semcache.py`、`semcache_demo.py` | 范围、版本、过期三道闸门,以及误命中的事故 |
| 精确缓存 | `exact_cache.py` | 零风险的复用 |
| ROI | `roi.py` | 盈亏平衡点、敏感性分析 |

## 动手练习

### 练习 1:批处理排到什么时候跑

`pricing.py` 里有 `period_at(时刻)`,告诉你一个时刻是峰时还是空闲。写 `offpeak.py`:`next_idle(now)` 返回从现在起第一个空闲时刻(现在已经空闲就返回现在),再用它回答「周二 10:30 提交的批处理任务,从几点开始半价,要等多久」。不用调 API。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part07/offpeak.py
from datetime import datetime, timedelta

from part07.pricing import BEIJING, period_at


def next_idle(now: datetime) -> datetime:
    """从 now 起,第一个进入空闲时段的时刻(按分钟找);现在已经是空闲就返回 now 自己。"""
    t = now
    while period_at(t) != "idle":
        t = t.replace(second=0, microsecond=0) + timedelta(minutes=1)
    return t


if __name__ == "__main__":
    for label, when in [
        ("周二 10:30", datetime(2026, 10, 27, 10, 30, tzinfo=BEIJING)),
        ("周二 15:20", datetime(2026, 10, 27, 15, 20, tzinfo=BEIJING)),
        ("周二 20:00", datetime(2026, 10, 27, 20, 0, tzinfo=BEIJING)),
        ("周六 10:30", datetime(2026, 10, 31, 10, 30, tzinfo=BEIJING)),
    ]:
        t = next_idle(when)
        wait = (t - when).total_seconds() / 60
        print(f"{label} 提交 → 从 {t:%m-%d %H:%M} 开始半价,要等 {wait:.0f} 分钟")
```

<div class="line-notes">

- `from part07.pricing import BEIJING, period_at` 复用 Day 396 的北京时区和峰谷判断函数,不重写一遍规则。
- `def next_idle(now: datetime) -> datetime:` 输入一个带时区的时刻,输出同样带时区的时刻。
- `t = now` 从现在开始找。
- `while period_at(t) != "idle":` 只要还是峰时就继续。
- `t = t.replace(second=0, microsecond=0) + timedelta(minutes=1)` 每次往后推一分钟,并且把秒归零,这样找到的是「整分钟」,比如 12:00 而不是 12:00:37。`replace` 是 `datetime` 对象的方法,返回一个改了几个字段的新对象,不会改原来的。
- `datetime(2026, 10, 27, 10, 30, tzinfo=BEIJING)` 构造一个带北京时区的时刻。2026-10-27 是周二。
- `wait = (t - when).total_seconds() / 60` 两个 `datetime` 相减得到 `timedelta`,`.total_seconds()` 换成秒,再除以 60 得分钟。
- `print(f"{label} 提交 → 从 {t:%m-%d %H:%M} 开始半价` `{t:%m-%d %H:%M}` 是日期时间的格式化,`%m` 月、`%d` 日、`%H` 时、`%M` 分。

</div>

```text
周二 10:30 提交 → 从 10-27 12:00 开始半价,要等 90 分钟
周二 15:20 提交 → 从 10-27 18:00 开始半价,要等 160 分钟
周二 20:00 提交 → 从 10-27 20:00 开始半价,要等 0 分钟
周六 10:30 提交 → 从 10-31 10:30 开始半价,要等 0 分钟
```

规则是 Day 396 抄的:工作日北京时间 9 点到 12 点、14 点到 18 点是峰时,所以周二 10:30 要等到 12:00,15:20 要等到 18:00,晚上和周末直接就是半价。(这里没处理法定节假日,Day 396 的练习 3 补过。)真实排程时不用自己循环等,用 cron 或任务队列的定时功能,在空闲时段开始时入队。

</details>

### 练习 2:把阈值扫一遍

把 `semcache_pairs.py` 输出的 11 个分数抄进脚本,从 0.70 到 0.95 每隔 0.05 算一个阈值下的「同义命中率」和「易混误命中率」。你能找到一个阈值,让误命中率为 0 且同义命中率还可以接受吗?

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part07/threshold_sweep.py
# 抄自 semcache_pairs 的输出
SAME = [0.953, 0.829, 0.950, 0.932, 0.891]
DIFF = [0.885, 0.910, 0.866, 0.812, 0.750, 0.901]

print("阈值  同义命中  易混误命中")
for i in range(70, 100, 5):
    th = i / 100
    ok = sum(s >= th for s in SAME) / len(SAME)
    bad = sum(s >= th for s in DIFF) / len(DIFF)
    print(f"{th:.2f}  {ok:>6.0%}  {bad:>8.0%}")
```

<div class="line-notes">

- `SAME = [0.953, 0.829, 0.950, 0.932, 0.891]` 同义五对的相似度,抄自上面的输出。
- `DIFF = [0.885, 0.910, 0.866, 0.812, 0.750, 0.901]` 易混六对。
- `for i in range(70, 100, 5):` 用整数 70、75、……、95 循环,再除以 100,避免浮点数 `range` 的累积误差。
- `th = i / 100` 阈值。
- `ok = sum(s >= th for s in SAME) / len(SAME)` 生成器里是一串 `True`/`False`,`sum` 把 `True` 当 1 加起来,除以总数得到比例。
- `print(f"{th:.2f}  {ok:>6.0%}  {bad:>8.0%}")` `:.0%` 把小数格式化成百分数,不留小数。

</div>

```text
阈值  同义命中  易混误命中
0.70    100%      100%
0.75    100%      100%
0.80    100%       83%
0.85     80%       67%
0.90     60%       33%
0.95     40%        0%
```

在这 11 对里,0.95 的误命中率是 0,但同义命中率只剩 40%,也就是缓存只能帮你省 40% 本来就能省的调用。而且 6 对易混问法远远不够证明 0.95 就是安全的:换一批问句,可能就有一对的相似度是 0.96。真实系统要想用,得拿几百几千对真实的易混问法测,看误命中率能不能压到你能接受的水平,通常的结论是在客服场景里这个水平压不下去,所以才要加范围、版本、过期,并且只缓存纯知识问答。

</details>

### 练习 3:模型费用涨到多少,Agent 才不划算

用 `roi.py`,月 3 万张时:(a) 每张模型费用涨到多少元,Agent 才不再比人工便宜?(b) 把 flash 换成 pro(每张 0.011825 元)每月多花多少?(c) 全部工单错峰半价每月省多少?

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part07/roi_token.py
from dataclasses import replace

from part07.roi import Assumptions, agent_per_ticket, human_per_ticket

a = Assumptions()
N = 30000
gap = human_per_ticket(a) - agent_per_ticket(a, N)
print(f"月 {N} 张时,Agent 每张比人工便宜 {gap:.3f} 元")

# 每张的模型费用涨到多少元,Agent 才不再比人工便宜?token_cost 在公式里系数是 1,所以直接加
t_break = a.token_cost + gap
print(f"模型费用涨到每张 {t_break:.2f} 元({t_break / a.token_cost:.0f} 倍)才持平")

pro = replace(a, token_cost=0.011825)  # Day 400:pro 单干每张 1.1825 分
saving = (agent_per_ticket(a, N) - agent_per_ticket(pro, N)) * N
print(f"把 flash 换成 pro,每月多花 {-saving:.0f} 元,占每月省下 72263 元的 {-saving / 72263:.1%}")
half = replace(a, token_cost=a.token_cost / 2)
print(f"全部错峰半价,每月省 {(agent_per_ticket(a, N) - agent_per_ticket(half, N)) * N:.0f} 元")
```

<div class="line-notes">

- `from dataclasses import replace` 复制数据类并只改几个字段。
- `from part07.roi import Assumptions, agent_per_ticket, human_per_ticket` 复用 `roi.py` 里的函数。
- `gap = human_per_ticket(a) - agent_per_ticket(a, N)` 每张 Agent 比人工便宜多少:8.51 − 6.10 = 2.41 元。
- `t_break = a.token_cost + gap` 变动成本公式里 `token_cost` 的系数是 `(1 - e) + e = 1`,所以模型费用每涨 1 元,Agent 每张就贵 1 元。涨到「便宜的那 2.41 元」被吃光,就是持平点:0.0038 + 2.409 = 2.41 元。
- `pro = replace(a, token_cost=0.011825)` Day 400 实测 pro 单干每张 1.1825 分,换算成元是 0.011825。
- `saving = (agent_per_ticket(a, N) - agent_per_ticket(pro, N)) * N` 用 pro 以后每张贵了,所以这个差是负数。
- `half = replace(a, token_cost=a.token_cost / 2)` 错峰半价等于模型费用减半。

</div>

```text
月 30000 张时,Agent 每张比人工便宜 2.409 元
模型费用涨到每张 2.41 元(639 倍)才持平
把 flash 换成 pro,每月多花 241 元,占每月省下 72263 元的 0.3%
全部错峰半价,每月省 57 元
```

(a) 每张 2.41 元,是今天 flash 费用的 639 倍。(b) 换 pro 每月多花 241 元,是节省额的 0.3%,不影响决策。(c) 全部错峰也只省 57 元。在这组假设下,Day 396 到 Day 400 优化的那些钱,放进整个 ROI 里是「小数点后面的事」。把它反过来用:如果你的 Agent 每张要调 50 次长上下文、模型费用到了每张几块钱,那么这些优化就是主战场了。所以做优化前先算一遍 ROI,知道自己站在哪一边。

</details>

### 练习 4:哪些节点可以缓存

工单流水线有五个节点:分类、查订阅(工具)、起草回复、退款金额计算、「总结这位客户过去半年的工单」。哪些适合精确缓存、哪些适合语义缓存、哪些都不适合,说出理由。这是开放题,没有实跑。

<details><summary>参考答案</summary>

- **分类**:精确缓存,同一段工单文字应该得到同一个类别。缓存键带上提示词版本,提示词改了就换键。
- **查订阅**(工具调用):不适合缓存模型,但可以按客户号做带短过期时间的数据缓存,这是普通的应用缓存,要注意订阅状态一变就要失效。
- **起草回复**:都不适合。回复依赖客户数据和当天状态,语义缓存会把别的客户的内容或过期的承诺带出来(今天第 2 行和最后一行的事故)。
- **退款金额计算**:不要用模型算,用代码算(Day 145 的结论),代码本身就是确定的,不需要缓存;模型只负责解释。
- **总结客户过去半年的工单**:这是批处理的好对象,每天夜里错峰批量生成,结果存起来第二天直接用,不是缓存,是「预先计算」。输入很长,批处理的折扣在这里最值钱。

一个规律:越确定、越不依赖客户数据的节点越适合缓存;越依赖客户数据、越涉及金额和承诺的节点越不能缓存,甚至不该让模型自由发挥。

</details>

**验收标准**:能说出三家批处理 API 的折扣和时限,并解释为什么 Agent 不适合批处理;能跑出本地批处理器的断点续跑(先跑 8 条再补 12 条);能用 `semcache_pairs.py` 的输出解释为什么阈值划不出安全的线,并说出缓存要加的三道闸门;能运行 `roi.py`,说出盈亏平衡点和三个最敏感的变量,并解释为什么模型费用几乎不影响结论。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 批处理 API | 把一大批请求打包成文件交给服务商后台慢慢跑,最晚 24 小时内取结果,价格通常是同步接口的一半 |
| `custom_id` | 批处理里每条请求的唯一编号,输出不保证顺序,靠它把结果对回请求 |
| 错峰 | 把不急的任务排到服务商的非高峰时段,DeepSeek 非高峰价格减半 |
| 断点续跑 | 任务中途中断后,重跑时跳过已经完成的部分 |
| 精确缓存 | 输入一字不差才命中,命中就复用上次的结果,零风险 |
| 语义缓存 | 用向量相似度判断「差不多的问题」,命中就返回旧答案,省得多但可能答错 |
| 相似度阈值 | 语义缓存里「多像才算命中」的分数线,没有通用的安全值 |
| 缓存失效(范围、版本、过期) | 缓存要在三种情况下作废:换了客户(范围)、知识库更新(版本)、放得太久(过期) |
| ROI | 投入产出比。这里指:Agent 每月省的钱减去它的固定成本,与开发投入对比 |
| 盈亏平衡点 | 固定成本等于每月省下的变动成本时的月工单量,低于它上 Agent 是亏的 |
| 敏感性分析 | 一次只改一个变量,看结论变多少,找出最要紧的变量 |
| 转人工比例 | Agent 处理不了、转给人工从头做的工单占比 |

## 常见误区

**以为聊天能用,批处理就能用。** 我的硅基流动账户调 Qwen3-14B 聊天一切正常,上传批处理文件却是 `402 account balance is insufficient`。批处理的门槛可能和聊天不一样,先用一个小文件试一下。

**依赖批处理输出的顺序。** 官方批处理和我们的本地批处理器,输出行的顺序都不等于输入。要用 `custom_id` 对号入座。

**批处理没有断点续跑。** 大批量任务中途一定会碰到限速或抖动,不能续跑就是重付一遍钱。

**用 Agent 的多轮工具调用去跑批处理。** 每一轮都要等一次批处理完成,总时间是轮数乘以排队时间,可能几天。批处理适合一次一条的独立请求。

**把某个阈值抄过来用。** 相似度分数的分布取决于 embedding 模型和你的问句。我的 11 对问句里 0.95 的误命中率是 0,不代表它在你的系统里也是 0。

**语义缓存的 key 里没有客户号。** C002 问「我的发票金额是多少」,拿到了 C001 的 2392.00 元。带客户数据的问题,缓存必须按客户隔离,或者干脆不缓存。

**知识库更新了缓存不清。** 旧答案不会自己失效。缓存条目要带知识库版本,版本变了就整体作废。

**拿未验证的假设做 ROI 决策。** 今天 ROI 表里除了模型费用,全是我假设的数字。上线以后要拿真实的转人工比例、复核时长、错误率回来重算。

**优化模型费用之前不算 ROI。** 在人工很贵、单次调用很短的场景里,模型费用涨 100 倍也只少省 1.1 万,而复核时长从 2 分钟到 6 分钟就是 9 万。先找最敏感的变量。

## 学习资料

### 文档与文章

- [Anthropic · Batch processing](https://platform.claude.com/docs/en/build-with-claude/batch-processing):Message Batches API,50% 折扣、10 万个请求或 256 MB 的上限、结果保留 29 天、和 prompt caching 叠加的建议。英文,20 分钟。
- [OpenAI · Batch API](https://developers.openai.com/api/docs/guides/batch):文件格式、24 小时时限、5 万个请求和 200 MB 的上限、支持的接口列表。英文,10 分钟。
- [硅基流动 · 批量推理](https://docs.siliconflow.cn/cn/userguide/guides/batch):中文文档,上传、创建、查询、取消、取结果的完整流程和支持的模型。10 分钟。
- [DeepSeek API 文档 · 模型与价格](https://api-docs.deepseek.com/quick_start/pricing):非高峰时段价格减半的规则,`pricing.py` 的出处。
- [Anthropic · Prompt caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching):和今天的缓存区分开读,这里的缓存是厂商侧省输入的钱,仍然要调模型。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1qYEtzuEhm&autoplay=0&high_quality=1" title="高效语义缓存系统:原理、实现与优化" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>天天悅看 · 高效语义缓存系统:原理、实现与优化 · 约 16 分钟。讲语义缓存的原理和实现,看的时候对照第二部分的三道闸门,想想它有没有讲范围和版本。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1dTnd6qE5h&autoplay=0&high_quality=1" title="免费的开源大模型,正在变成企业最贵的账单 | 一笔 TCO 总账算给你看" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>聚客Ai联盟 · 免费的开源大模型,正在变成企业最贵的账单 · 约 5 分钟。一笔 TCO(总拥有成本)总账,和第三部分的思路一样:除了 token,别的成本项往往更大。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/kcH7-rz7kbM" title="Semantic Cache for LLMs: Close Is Not the Same as Equal" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Vasily At Scale · Semantic Cache for LLMs: Close Is Not the Same as Equal · 英文。标题就是今天实验的结论:相似不等于等价。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/47EbxyDT320" title="Claude's Batch API is half price, and most batches finish in under an hour" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Help It Help You · Claude's Batch API is half price, and most batches finish in under an hour · 英文。把 Anthropic 批处理的使用方式演示一遍,补上我没能实跑的那一块。</figcaption>
</figure>

### 书籍

- 《AI Engineering: Building Applications with Foundation Models》,Chip Huyen,O'Reilly,2025。讲推理优化、缓存(包括 exact 和 semantic cache)和成本的章节,和今天前两部分对着看。英文原版,我没查到正式出版的中译本。

### 开源项目与代码

- [zilliztech/GPTCache](https://github.com/zilliztech/GPTCache):最知名的开源语义缓存库,README 里能看到它的相似度阈值和缓存淘汰策略的配置项;读它的时候带着今天的问题:它怎么处理范围和知识库版本?
- [openai/openai-python](https://github.com/openai/openai-python):今天本地批处理器按官方文件格式做,SDK 里 `client.batches` 和 `client.files` 的类型定义在这里。

## 自测

1. 三家批处理 API 的折扣是多少?为什么需要多轮工具调用的 Agent 不适合用它?

<details><summary>答案</summary>

都是 50%(Anthropic、OpenAI、硅基流动)。Agent 每一轮都依赖上一轮的结果,每一轮都要在批处理里排一次队、等一次完成,总延迟是轮数乘以排队时间,可能好几天,而且不能随时改变策略。批处理适合一条请求一次完成的独立任务,比如批量打标签、跑评测集。

</details>

2. 批处理的输出为什么必须带 `custom_id`?

<details><summary>答案</summary>

批处理并发处理,谁先完成谁先写,输出的顺序不保证和输入一致。靠 `custom_id` 才能把每条结果对回对应的请求。我们的本地批处理器里,`head -2` 看到第一行是 `ticket-03`、第二行是 `ticket-01`,就是这个现象。

</details>

3. 「年付可以退款吗」和「月付可以退款吗」的相似度是 0.910,为什么这是语义缓存的致命问题?

<details><summary>答案</summary>

相似度 0.910 超过 0.90 的常见阈值,缓存会拿年付的答案回答月付的问题,而规则里月付一律不退。embedding 衡量话题上的接近,「年付」和「月付」话题几乎一样,但它们的区别恰恰是业务上最要紧的。这种错没有报错、没有异常,只会变成客户投诉。而且同义问法里最低的相似度(0.829)比易混问法里最高的(0.910)还低,没有任何阈值能把两组分开。

</details>

4. 语义缓存要加哪三道闸门?

<details><summary>答案</summary>

范围:带客户数据的答案只能给本人,缓存键里要有客户号(今天没带范围,C002 拿到了 C001 的发票金额)。知识库版本:知识库更新后旧答案作废,缓存条目记下它基于哪一版。过期:设较短的 TTL,放久了的缓存不再用。再加上一条:只对不涉及客户数据的纯知识问答用。

</details>

5. 在今天的 ROI 假设里,模型费用涨到 100 倍,每月少省多少?为什么影响这么小?最敏感的变量是什么?

<details><summary>答案</summary>

月 3 万张时只少省约 1.1 万元(从 72,263 降到 61,048)。因为每张工单的模型费用才 0.0038 元,而人工每张 8.51 元,Agent 路径里最大的成本是复核和转人工的人工时间,不是 token。最敏感的变量是人工和质量相关的:复核时长从 2 分到 6 分,每月少省 8.9 万,直接转为亏损;其次是错误率和转人工比例。

</details>

6. (面试题)老板问:「这个客服 Agent 值得做吗?」你怎么用数字回答?

<details><summary>答案</summary>

参考答法:先算基线,人工每张工单的成本(坐席月成本除以有效工时乘以处理时长)。再算 Agent 路径:变动成本是「不转人工的部分(模型费用加复核)加转人工的部分(模型费用加人工全流程)再加错误的期望损失」,固定成本是服务器、维护和开发摊销。得出盈亏平衡的月工单量,和公司真实的工单量对比,量不够就不做。然后做敏感性分析,指出最要紧的是转人工比例、复核时长和错误率,而不是 token 费用,所以评测、证据展示和质量迭代比压模型费用更值钱。最后要说明哪些数字是假设,上线后用真实数据回来重算。我自己做过一个练习:月 3 万张时 Agent 每月省约 7 万元,盈亏平衡在每月 9 千张左右;复核从 2 分钟变 6 分钟就会变成亏损。同时讲清楚什么时候不该做:量太小、工单太非标、错误代价极高、人工本来就便宜。

</details>

## 明天预告

Day 403 · 安全(一):注入的本质,直接和间接注入。成本和延迟这条线到今天告一段落,接下来换到另一个会让 Agent 出大事的地方。今天语义缓存里那个「C002 看到了 C001 的发票金额」的演示已经是一次数据泄露,而 Agent 读到的内容里藏着指令、让它去做别的事,是一类更隐蔽的攻击。明天从「指令和数据混在同一条通道里」这件事讲起。
