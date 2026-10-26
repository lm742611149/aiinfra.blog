---
title: 'Day 133 · 流式输出(一):SSE 原理和首 token 延迟'
description: '非流式调用要等 1.85 秒才看到第一个字,流式 0.48 秒就开始出字,总时长差不多,体感完全不同。今天先用 curl -N 看 DeepSeek 的原始事件流:Content-Type 是 text/event-stream,每块一行 data:、空行分隔、最后一个 data: [DONE],usage 挂在最后一块上;再用 Python 的 http.server 写一个 9 块的假流式服务器,用时间戳证明 -N 的作用和「流式只是一个一直不关的 HTTP 响应」;然后用 httpx 逐行读真实的流,量出首 token 延迟,开思考模式时 reasoning_content 先于 content 出现,首个正文块从 0.9 秒推迟到 1.76 秒;最后看中途断开会怎样。'
pubDate: 2026-10-23
regime: none
tags: ['api', 'streaming', 'sse', 'http', 'python', 'agent-zero']
series: 'agent-zero'
day: 133
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 132](/blog/agent-zero/day-132-week19-review/) 把第 19 周的六天接成了一个圈:system 加历史拼成 messages,过并发闸门发出去,失败先分类再决定重不重试,成功拿 usage 记账,回答追加进历史,下一轮再走一遍。小项目 `week19_lab.py` 把这些零件装进一个 `Session`,假服务器上看它重试 429、拒绝 401,真 DeepSeek 上聊到预算用完自动停。

小项目的每一轮都要等 0.8 到 1.5 秒,那是短回答。让模型写 200 字,要等近 2 秒;写 1000 字,要等十几秒,用户面前一直是空白。这一周讲的全是「怎么把请求发好」,接下来两天讲「怎么把回答早一点送到用户眼前」。今天先看原理。

## 今天要解决的问题

学完今天,你应该能做到:

1. 说出 SSE(Server-Sent Events)的报文长什么样:`Content-Type: text/event-stream`、`data:` 开头的行、空行分隔、`data: [DONE]` 结束;并知道每一块 JSON 里 `delta`、`finish_reason`、`usage` 各在什么位置。
2. 用 `curl -N` 看一次真实的流,解释 `-N` 是干什么的,以及为什么 `curl -w` 报的「首字节」不是首个 token。
3. 用 Python 标准库写一个最小的 SSE 服务器,用时间戳证明:流式不是什么新协议,就是一个一直不关闭的 HTTP 响应,服务器写一点、刷一点。
4. 用 httpx 逐行读真实的流,量出首 token 延迟(TTFT),说出开思考模式时它为什么变长,以及非流式和流式的总时长为什么差不多。

今天的两个新概念:**SSE 事件流格式**和**首 token 延迟**。用 openai SDK 的 `stream=True` 读流、把增量拼成完整回答,是明天 [Day 134](/blog/agent-zero/day-134-streaming-code/) 的事;今天只用 curl 和 httpx,看到协议本身。

预计用时:2.5 小时左右。实跑花费:所有流式实验都是一两百 token 的短问答,十几次调用约 0.02 元,假服务器不花钱,算式在文末。前置:[Day 59](/blog/agent-zero/day-059-http-1/)–[Day 61](/blog/agent-zero/day-061-http-3/) 的 HTTP 请求、状态码和 `Content-Type`,[Day 77](/blog/agent-zero/day-077-server-1/)–[Day 78](/blog/agent-zero/day-078-server-2/) 的 `http.server`,[Day 121](/blog/agent-zero/day-121-api-request/) 用 httpx 手写 POST,[Day 122](/blog/agent-zero/day-122-api-response/) 的 `finish_reason` 和 `usage`,[Day 126](/blog/agent-zero/day-126-error-codes/) 的 `fake_llm.py`(今天的假服务器是它的简化版)。

学法提示:先对照文章把每个脚本逐行敲一遍(不要复制粘贴)并跑通;明天合上文章,默写 SSE 报文的四条规则和 `sse_raw.py` 里解析 `data:` 那几行;然后做动手练习,做不出来再展开参考答案,看完关掉,自己重写一遍。

## 不流式的时候,用户在等什么

先看一次普通的、不流式的调用到底什么时候才有东西回来。在 `agent-zero-lab` 根目录,先把 `.env` 里的变量读进当前终端:

```bash
cd ~/agent-zero-lab
set -a; source .env; set +a
```

`set -a` 让后面 `source` 读到的变量自动 `export`,`set +a` 关掉这个开关。Day 123 说过 `.env` 里的 JSON 要用单引号包着,就是为了这一步能 `source`。然后发一个最普通的请求,让 curl 顺便报两个时间:

```bash
curl -s https://api.deepseek.com/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $LLM_API_KEY" \
  -d '{"model":"deepseek-flash","thinking":{"type":"disabled"},"max_tokens":120,
       "messages":[{"role":"user","content":"用两句话解释什么是 token。"}]}' \
  -w "\n[首字节 %{time_starttransfer} 秒, 总计 %{time_total} 秒]\n"
```

```text
{"id":"fedc36da-b755-4b6a-ac84-fbc734cae5dc","object":"chat.completion","created":1792744017,"model":"deepseek-flash","choices":[{"index":0,"message":{"role":"assistant","content":"Token 是模型处理文本的最小单位，可以是单词、词的一部分或标点符号。模型把输入文本切分成 token 后再进行计算，输出时也以 token 为单位逐个生成。"},"logprobs":null,"finish_reason":"stop"}],"usage":{"prompt_tokens":11,"completion_tokens":40,"total_tokens":51,"prompt_tokens_details":{"cached_tokens":0},"prompt_cache_hit_tokens":0,"prompt_cache_miss_tokens":11},"system_fingerprint":"e72d3c7f663d3e1383b00b3884cb4501"}
[首字节 0.031649 秒, 总计 0.716231 秒]
```

`-w` 是 curl 的「写出统计」,`%{time_starttransfer}` 是收到第一个字节的时刻,`%{time_total}` 是全部收完。这里有个坑:首字节 0.03 秒,但回答明明是 0.7 秒才出来的。0.03 秒收到的是**响应头**,不是回答。DeepSeek 走 HTTP/2,服务器一收到请求就把 `200` 和头发回来了,正文要等模型算完才有。所以 **curl 的「首字节」量的是头,不是首个 token**。要看正文什么时候到,得给每一行打时间戳。写一个 8 行的小工具 `part02/stamp.py`:

```python
# agent-zero-lab/part02/stamp.py
import sys
import time

start = time.monotonic()
for line in sys.stdin:
    text = line.rstrip("\n")
    print(f"[{time.monotonic() - start:6.3f} 秒] {text[:80]!r}", flush=True)
```

<div class="line-notes">

- `start = time.monotonic()` 脚本启动的时刻。
- `for line in sys.stdin:` 从标准输入一行一行读。前面用管道接 curl,curl 吐一行它就读到一行。[Day 5](/blog/agent-zero/day-005-terminal-3/) 的管道。
- `text = line.rstrip("\n")` 去掉行尾换行。
- `print(f"[{time.monotonic() - start:6.3f} 秒] {text[:80]!r}", flush=True)` 打印这一行到达的时刻和前 80 个字符。`!r` 让空行显示成 `''`,一眼能看到;`flush=True` 让它立刻显示,不攒在缓冲区里。这个参数今天会反复出现。

</div>

再发一次同样的非流式请求,管道接给它:

```bash
curl -sN https://api.deepseek.com/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $LLM_API_KEY" \
  -d '{"model":"deepseek-flash","thinking":{"type":"disabled"},"max_tokens":200,
       "messages":[{"role":"user","content":"用三句话介绍一下杭州。"}]}' \
  | uv run python -m part02.stamp
```

```text
[ 1.152 秒] '{"id":"02241f32-3fa8-47c7-8d2d-90175e268e4f","object":"chat.completion","created'
```

只有一行,1.152 秒才到。这 1.15 秒里模型在一个 token 一个 token 地生成,生成完了打包成一个 JSON 一次性发回来。用户看到的就是 1.15 秒空白,然后整段出现。回答越长,空白越久。

## 加一个字段:`"stream": true`

同样的请求,加 `"stream": true`,再把 curl 的 `-N` 带上:

```bash
curl -sN https://api.deepseek.com/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $LLM_API_KEY" \
  -d '{"model":"deepseek-flash","stream":true,"thinking":{"type":"disabled"},"max_tokens":120,
       "messages":[{"role":"user","content":"用两句话解释什么是 token。"}]}'
```

输出是一串这样的行(中间省略了一部分,完整的一共 12 行 `data:`):

```text
data: {"id":"9af6ce1b-d253-439f-83ac-fd4fe24dca45","object":"chat.completion.chunk","created":1792744018,"model":"deepseek-flash","system_fingerprint":"e72d3c7f663d3e1383b00b3884cb4501","choices":[{"index":0,"delta":{"role":"assistant","content":""},"logprobs":null,"finish_reason":null}]}

data: {"id":"9af6ce1b-d253-439f-83ac-fd4fe24dca45","object":"chat.completion.chunk","created":1792744018,"model":"deepseek-flash","system_fingerprint":"e72d3c7f663d3e1383b00b3884cb4501","choices":[{"index":0,"delta":{"content":"Token"},"logprobs":null,"finish_reason":null}]}

data: {"id":"9af6ce1b-d253-439f-83ac-fd4fe24dca45","object":"chat.completion.chunk","created":1792744018,"model":"deepseek-flash","system_fingerprint":"e72d3c7f663d3e1383b00b3884cb4501","choices":[{"index":0,"delta":{"content":" "},"logprobs":null,"finish_reason":null}]}

data: {"id":"9af6ce1b-d253-439f-83ac-fd4fe24dca45","object":"chat.completion.chunk","created":1792744018,"model":"deepseek-flash","system_fingerprint":"e72d3c7f663d3e1383b00b3884cb4501","choices":[{"index":0,"delta":{"content":"是"},"logprobs":null,"finish_reason":null}]}

data: {"id":"9af6ce1b-d253-439f-83ac-fd4fe24dca45","object":"chat.completion.chunk","created":1792744018,"model":"deepseek-flash","system_fingerprint":"e72d3c7f663d3e1383b00b3884cb4501","choices":[{"index":0,"delta":{"content":"模型"},"logprobs":null,"finish_reason":null}]}
```

你在终端里看的时候,这些行是一行一行蹦出来的,不是一起出现的。对照非流式那份 JSON,变化有五处:

1. **`object` 从 `chat.completion` 变成 `chat.completion.chunk`**:块。一个回答被切成了很多块。
2. **`message` 变成了 `delta`**:增量。每块只带这一块新生成的内容,`"content":"Token"`、`"content":" "`、`"content":"是"`,一两个 token 一块。第一块的 `delta` 里有 `"role":"assistant"` 和空的 `content`,是「开始了」的信号。
3. **`finish_reason` 一路是 `null`**,只有最后一块才是 `"stop"`。Day 122 说的「每次都要看 `finish_reason`」,在流式里是「看最后一块的」。
4. **每一行以 `data: ` 开头,行与行之间隔一个空行。**这是 SSE 的格式,下一节讲。
5. **最后两块长这样**(每次运行的 id 和用词不同):

```text
data: {"id":"9af6ce1b-…","object":"chat.completion.chunk","created":1792744018,"model":"deepseek-flash","system_fingerprint":"e72d3c7f663d3e1383b00b3884cb4501","choices":[{"index":0,"delta":{"content":""},"logprobs":null,"finish_reason":"stop"}],"usage":{"prompt_tokens":11,"completion_tokens":40,"total_tokens":51,"prompt_tokens_details":{"cached_tokens":0},"prompt_cache_hit_tokens":0,"prompt_cache_miss_tokens":11}}

data: [DONE]
```

倒数第二块:`delta` 的 `content` 是空的,`finish_reason` 是 `stop`,**而且带着 `usage`**,整个请求的 token 统计都在这一块上。DeepSeek 文档写得很明确:「`data: [DONE]` 之前的最后一个块都会在其 `usage` 字段中给出整个请求的 token 使用统计信息」,并且「不会单独下发一个只含 usage 的块」。OpenAI 官方不一样,要传 `stream_options: {"include_usage": true}`,而且 usage 在一个 `choices` 为空的单独块里。明天写 Python 读流时要同时兼容这两种。最后一行 `data: [DONE]` 不是 JSON,是一个约定好的结束标记。

再看响应头。`-v` 让 curl 把头打出来,`-o /dev/null` 扔掉正文,只留 `< ` 开头的行:

```bash
curl -s -N -v -o /dev/null https://api.deepseek.com/chat/completions \
  -H "Content-Type: application/json" -H "Authorization: Bearer $LLM_API_KEY" \
  -d '{"model":"deepseek-flash","stream":true,"thinking":{"type":"disabled"},"max_tokens":60,
       "messages":[{"role":"user","content":"说三个水果"}]}' 2>&1 | grep '^< '
```

```text
< HTTP/2 200 
< server: openresty
< content-type: text/event-stream; charset=utf-8
< vary: accept-encoding
< vary: origin, access-control-request-method, access-control-request-headers
< access-control-allow-credentials: true
< x-ds-trace-id: 15500de5376bd55fdf46b0f37600f4e3
< strict-transport-security: max-age=31536000; includeSubDomains; preload
< x-content-type-options: nosniff
< cache-control: no-cache
< date: Fri, 23 Oct 2026 08:28:31 GMT
```

和非流式比,`content-type` 从 `application/json` 变成了 `text/event-stream; charset=utf-8`,多了一个 `cache-control: no-cache`。没有 `content-length`:服务器自己也不知道回答会有多长,它一边生成一边发,发完才关。

**`-N` 是什么。**curl 的 `--no-buffer`。curl 默认把收到的数据先攒在缓冲区里,攒够一批再写出来,对下载文件没影响,对流式就要命:你看到的不是「一块一块到」,而是「攒一堆一起到」,有时直到结束才一次吐完。`-N` 让它收到多少就写多少。下一节在自己的服务器上能清楚地看到这个区别。

## SSE 到底是什么:自己写一个服务器

SSE 是 Server-Sent Events,「服务器推送的事件」。它不是一个新协议,是 HTML 标准里规定的一种**HTTP 响应正文的文本格式**,加上浏览器里一个叫 `EventSource` 的接口(你做前端可能用过)。规则只有这么几条:

<figure>
<svg viewBox="0 0 640 250" role="img" aria-label="SSE 报文的结构:响应头 Content-Type 是 text/event-stream;正文由若干事件组成,每个事件是若干行 字段名冒号值,用一个空行结束;大模型接口只用 data 字段,最后一个事件是 data: [DONE]">
<rect x="0" y="0" width="640" height="250" fill="var(--paper-raised)" rx="6"/>
<g font-family="var(--font-mono)" font-size="12">
<rect x="20" y="20" width="600" height="40" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="30" y="37" fill="var(--ink)">HTTP/1.1 200 OK</text>
<text x="30" y="53" fill="var(--ink)">Content-Type: text/event-stream</text>
<text x="330" y="45" fill="var(--ink-soft)">← 响应头:告诉客户端「下面是事件流」</text>
<rect x="20" y="74" width="600" height="46" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="30" y="92" fill="var(--ink)">data: {"delta":{"content":"杭州"}}</text>
<text x="30" y="110" fill="var(--ink-faint)">(空行)</text>
<text x="330" y="92" fill="var(--ink-soft)">← 一个事件:若干行「字段: 值」</text>
<text x="330" y="110" fill="var(--ink-soft)">← 空行表示这个事件结束</text>
<rect x="20" y="130" width="600" height="46" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="30" y="148" fill="var(--ink)">data: {"delta":{"content":"是"}}</text>
<text x="30" y="166" fill="var(--ink-faint)">(空行)</text>
<text x="330" y="148" fill="var(--ink-soft)">← 下一个事件,什么时候生成什么时候发</text>
<rect x="20" y="186" width="600" height="46" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="30" y="204" fill="var(--ink)">data: [DONE]</text>
<text x="30" y="222" fill="var(--ink-faint)">(空行,然后服务器关闭连接)</text>
<text x="330" y="204" fill="var(--ink-soft)">← 约定的结束标记(不是 SSE 标准,是厂商约定)</text>
<text x="330" y="222" fill="var(--ink-soft)">其他字段:event: / id: / retry: / 以 : 开头的注释行</text>
</g>
</svg>
<figcaption>一个 SSE 响应就是普通的 HTTP 响应,头里声明 text/event-stream,正文是一个接一个的事件;每个事件是几行「字段: 值」,空行收尾。大模型接口基本只用 data 字段,一块 JSON 一个事件。</figcaption>
</figure>

- 响应头 `Content-Type: text/event-stream`。
- 正文是文本,按行分。每行是 `字段名: 值`,字段名有四个:`data`、`event`、`id`、`retry`。冒号后面的一个空格是可选的,会被去掉。
- **一个空行表示一个事件结束**。一个事件可以有多行 `data:`,解析时用换行拼起来。
- 以 `:` 开头的行是注释,忽略;服务器常用它发心跳,保持连接不被掐断。

大模型接口只用了 `data` 一个字段,每块 JSON 一个事件,`[DONE]` 是 OpenAI 定的、各家照抄的结束约定。

最能把这件事看透的办法,是自己写一个服务器。用 Day 78 学的 `http.server`,不用任何第三方库。新建 `part02/sse_server.py`:

```python
# agent-zero-lab/part02/sse_server.py
import json
import time
from http.server import BaseHTTPRequestHandler, HTTPServer

PIECES = ["云簿", "是", "一款", "面向", "中小企业", "的", "记账", "软件", "。"]


class Handler(BaseHTTPRequestHandler):
    def do_GET(self) -> None:
        if self.path != "/stream":
            self.send_response(404)
            self.end_headers()
            return
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream; charset=utf-8")
        self.send_header("Cache-Control", "no-cache")
        self.end_headers()
        for i, piece in enumerate(PIECES):
            event = {"index": i, "delta": piece}
            self.wfile.write(f"data: {json.dumps(event, ensure_ascii=False)}\n\n".encode("utf-8"))
            self.wfile.flush()
            time.sleep(0.4)
        self.wfile.write(b"data: [DONE]\n\n")
        self.wfile.flush()

    def log_message(self, format: str, *args: object) -> None:
        print("收到请求:", self.path, flush=True)


if __name__ == "__main__":
    print("假的流式服务器在 http://127.0.0.1:8766/stream ,Ctrl+C 停止")
    HTTPServer(("127.0.0.1", 8766), Handler).serve_forever()
```

<div class="line-notes">

- `from http.server import BaseHTTPRequestHandler, HTTPServer` Day 78 的两个类:一个处理请求,一个监听端口。Day 126 的 `fake_llm.py` 用的是能同时处理多个连接的 `ThreadingHTTPServer`,今天一次只有一个客户端,普通的够用。
- `PIECES = ["云簿", "是", "一款",` 假装模型生成的 9 块。真模型一块一两个 token,这里按词切,看得清楚。
- `def do_GET(self) -> None:` 收到 GET 请求时被调用。真 API 是 POST,这里为了用浏览器也能打开,用 GET。
- `if self.path != "/stream":` 只认 `/stream` 这一个路径,别的回 404。
- `self.send_response(200)` 状态行。
- `self.send_header("Content-Type", "text/event-stream; charset=utf-8")` **关键的一行**:告诉客户端这是事件流。
- `self.send_header("Cache-Control", "no-cache")` 别让中间的代理缓存它。和 DeepSeek 的响应头一样。
- `self.end_headers()` 头结束,一个空行。注意没有 `Content-Length`:我们也不知道总长度。
- `for i, piece in enumerate(PIECES):` 一块一块发。
- `event = {"index": i, "delta": piece}` 模仿真 API 的 `delta`。
- `self.wfile.write(f"data: {json.dumps(event, ensure_ascii=False)}\n\n".encode("utf-8"))` 写一个事件:`data: ` 加 JSON,再加**两个换行**,第二个换行就是那个空行。`wfile` 是写给客户端的文件对象,要字节,所以 `encode`。
- `self.wfile.flush()` **今天第二关键的一行**:把缓冲区里的字节真的发出去。不 `flush`,Python 会攒着,9 块可能一起到。
- `time.sleep(0.4)` 假装模型每 0.4 秒生成一块。真模型的间隔是几毫秒到几百毫秒。
- `self.wfile.write(b"data: [DONE]\n\n")` 结束标记。
- `def log_message(self, format: str, *args: object) -> None:` 覆盖默认的访问日志,只打印路径。
- `HTTPServer(("127.0.0.1", 8766), Handler).serve_forever()` 监听本机 8766 端口,一直跑。Day 126 的假服务器用 0 让系统随机挑端口,今天要在另一个终端里用 curl 访问,所以写死。

</div>

开一个终端跑服务器:

```bash
uv run python -m part02.sse_server
```

```text
假的流式服务器在 http://127.0.0.1:8766/stream ,Ctrl+C 停止
```

再开一个终端,先用 `curl -N` 看一眼:

```bash
curl -sN http://127.0.0.1:8766/stream -w "\n[首字节 %{time_starttransfer} 秒, 总计 %{time_total} 秒]\n"
```

```text
data: {"index": 0, "delta": "云簿"}

data: {"index": 1, "delta": "是"}

data: {"index": 2, "delta": "一款"}

data: {"index": 3, "delta": "面向"}

data: {"index": 4, "delta": "中小企业"}

data: {"index": 5, "delta": "的"}

data: {"index": 6, "delta": "记账"}

data: {"index": 7, "delta": "软件"}

data: {"index": 8, "delta": "。"}

data: [DONE]


[首字节 0.008696 秒, 总计 3.629159 秒]
```

每 0.4 秒蹦一行,3.6 秒结束。和 DeepSeek 的输出是同一个形状:`data:` 开头、空行分隔、`[DONE]` 收尾。现在用 `stamp.py` 做今天最说明问题的对比,带 `-N` 和不带:

```bash
curl -sN http://127.0.0.1:8766/stream | uv run python -m part02.stamp
curl -s  http://127.0.0.1:8766/stream | uv run python -m part02.stamp
```

```text
[ 0.000 秒] 'data: {"index": 0, "delta": "云簿"}'
[ 0.000 秒] ''
[ 0.364 秒] 'data: {"index": 1, "delta": "是"}'
[ 0.364 秒] ''
[ 0.766 秒] 'data: {"index": 2, "delta": "一款"}'
[ 0.766 秒] ''
[ 1.170 秒] 'data: {"index": 3, "delta": "面向"}'
[ 1.170 秒] ''
[ 1.574 秒] 'data: {"index": 4, "delta": "中小企业"}'
[ 1.574 秒] ''
[ 1.978 秒] 'data: {"index": 5, "delta": "的"}'
[ 1.978 秒] ''
[ 2.378 秒] 'data: {"index": 6, "delta": "记账"}'
[ 2.379 秒] ''
[ 2.779 秒] 'data: {"index": 7, "delta": "软件"}'
[ 2.779 秒] ''
[ 3.179 秒] 'data: {"index": 8, "delta": "。"}'
[ 3.179 秒] ''
[ 3.582 秒] 'data: [DONE]'
[ 3.582 秒] ''
```

```text
[ 3.593 秒] 'data: {"index": 0, "delta": "云簿"}'
[ 3.593 秒] ''
[ 3.593 秒] 'data: {"index": 1, "delta": "是"}'
[ 3.593 秒] ''
[ 3.593 秒] 'data: {"index": 2, "delta": "一款"}'
[ 3.593 秒] ''
[ 3.593 秒] 'data: {"index": 3, "delta": "面向"}'
[ 3.593 秒] ''
[ 3.593 秒] 'data: {"index": 4, "delta": "中小企业"}'
[ 3.593 秒] ''
[ 3.593 秒] 'data: {"index": 5, "delta": "的"}'
[ 3.593 秒] ''
[ 3.593 秒] 'data: {"index": 6, "delta": "记账"}'
[ 3.593 秒] ''
[ 3.593 秒] 'data: {"index": 7, "delta": "软件"}'
[ 3.593 秒] ''
[ 3.593 秒] 'data: {"index": 8, "delta": "。"}'
[ 3.593 秒] ''
[ 3.593 秒] 'data: [DONE]'
[ 3.593 秒] ''
```

第一份每 0.4 秒一行;第二份所有行都在 3.593 秒,也就是服务器关掉连接的那一刻一起到。**服务器两次发的一模一样,区别只在 curl 这一端有没有缓冲。**这就是 `-N` 的全部意义,也是今天要记住的一件事:流式链路上任何一环缓冲了,用户就看不到流。服务器端的 `flush()`、curl 的 `-N`、Python `print` 的 `flush=True`、前端框架里的某个中间件,哪一环攒着,体验就没了。

顺便看一眼发出去的原始字节,确认「事件之间是两个换行」不是我说说而已:

```bash
curl -sN http://127.0.0.1:8766/stream | head -c 120 | od -c | head -5
```

```text
0000000    d   a   t   a   :       {   "   i   n   d   e   x   "   :    
0000020    0   ,       "   d   e   l   t   a   "   :       "  云  **  **
0000040   簿  **  **   "   }  \n  \n   d   a   t   a   :       {   "   i
0000060    n   d   e   x   "   :       1   ,       "   d   e   l   t   a
0000100    "   :       "  是  **  **   "   }  \n  \n   d   a   t   a   :
```

`od -c` 把字节按字符打出来:`}` 后面是 `\n \n`,然后下一个 `data:`。汉字占三个字节,`od` 显示成一个字加两个 `**`。响应头也看一下:

```bash
curl -sN -D - -o /dev/null http://127.0.0.1:8766/stream
```

```text
HTTP/1.0 200 OK
Server: BaseHTTP/0.6 Python/3.12.13
Date: Fri, 23 Oct 2026 08:28:25 GMT
Content-Type: text/event-stream; charset=utf-8
Cache-Control: no-cache
```

`-D -` 把响应头写到标准输出。`HTTP/1.0`、没有 `Content-Length`:服务器发完就关连接,客户端靠连接关闭知道结束。DeepSeek 用 HTTP/2,原理一样,只是底下的传输方式不同。看到这里你应该能说出:**SSE 的服务端,就是一个回 `text/event-stream`、写一行刷一行、最后关连接的普通 HTTP 处理函数。**看完可以在服务器的终端按 Ctrl+C 停掉它。

## 用 Python 逐行读真实的流,量首 token 延迟

curl 看形状够了,要量时间、拼内容,得用代码。今天不用 openai SDK 的 `stream=True`(明天),用 Day 121 手写 POST 时用过的 httpx,逐行读响应,自己认 `data:`。这样你看到的和 SDK 内部做的是同一件事。新建 `part02/sse_raw.py`:

```python
# agent-zero-lab/part02/sse_raw.py
import json
import os
import sys
import time
from pathlib import Path

import httpx
from dotenv import load_dotenv

load_dotenv(os.environ.get("ENV_FILE", ".env"), override=True)
URL = os.environ["LLM_BASE_URL"].rstrip("/") + "/chat/completions"
HEADERS = {"Authorization": f"Bearer {os.environ['LLM_API_KEY']}", "Content-Type": "application/json"}
THINKING = "--thinking" in sys.argv
VENDOR = os.environ.get("ENV_FILE", ".env").removeprefix(".env").lstrip(".") or "deepseek"
BODY = {
    "model": os.environ["LLM_MODEL"],
    "messages": [{"role": "user", "content": "用三句话介绍一下杭州。"}],
    "max_tokens": 400,
    "stream": True,
    "thinking": {"type": "enabled" if THINKING else "disabled"},
}


def main() -> None:
    chunks: list[dict[str, object]] = []
    text = ""
    reasoning = ""
    first_reasoning = first_content = None
    start = time.monotonic()
    with httpx.stream("POST", URL, headers=HEADERS, json=BODY, timeout=60) as resp:
        print(f"状态 {resp.status_code}, Content-Type: {resp.headers.get('content-type')}, 头到达 {time.monotonic() - start:.2f} 秒")
        for line in resp.iter_lines():
            if not line.startswith("data: "):
                continue
            payload = line[len("data: "):]
            now = time.monotonic() - start
            if payload == "[DONE]":
                print(f"[{now:5.2f} 秒] [DONE]")
                break
            chunk = json.loads(payload)
            delta = chunk["choices"][0]["delta"]
            piece_r = delta.get("reasoning_content") or ""
            piece = delta.get("content") or ""
            if piece_r and first_reasoning is None:
                first_reasoning = now
            if piece and first_content is None:
                first_content = now
            reasoning += piece_r
            text += piece
            chunks.append({"t": round(now, 3), "reasoning": piece_r, "content": piece,
                           "finish_reason": chunk["choices"][0]["finish_reason"], "usage": chunk.get("usage")})
            if len(chunks) <= 5 or chunk["choices"][0]["finish_reason"]:
                print(f"[{now:5.2f} 秒] delta={delta} finish_reason={chunk['choices'][0]['finish_reason']}")
    total = time.monotonic() - start
    print(f"共 {len(chunks)} 块; 首个推理块 {first_reasoning}; 首个正文块 {first_content} 秒; 总计 {total:.2f} 秒")
    if reasoning:
        print(f"推理 {len(reasoning)} 字, 开头: {reasoning[:60]!r}")
    print(f"正文 {len(text)} 字: {text}")
    print("最后一块的 usage:", chunks[-1]["usage"])
    out = Path(f"data/stream_{VENDOR}_{'thinking' if THINKING else 'plain'}.json")
    out.parent.mkdir(exist_ok=True)
    out.write_text(json.dumps(chunks, ensure_ascii=False, indent=1), encoding="utf-8")


if __name__ == "__main__":
    main()
```

<div class="line-notes">

- `import httpx` Day 121 手写请求用的库,`uv add httpx` 那天已经装过。
- `URL = os.environ["LLM_BASE_URL"].rstrip("/") + "/chat/completions"` DeepSeek 的地址不带 `/v1`,硅基流动带,所以先去掉末尾斜杠再拼,两家都对。
- `HEADERS = {"Authorization": f"Bearer {os.environ['LLM_API_KEY']}",` Day 121 讲过的两个头。
- `THINKING = "--thinking" in sys.argv` 命令行带 `--thinking` 就开思考模式。
- `VENDOR = os.environ.get("ENV_FILE", ".env").removeprefix(".env").lstrip(".") or "deepseek"` 从配置文件名里取厂商名,用来给输出文件起名:`.env` 变成 `deepseek`,`.env.sf` 变成 `sf`。`removeprefix` 是 Python 3.9 起的字符串方法。
- `BODY = {` 请求体,和非流式只差 `"stream": True` 和 `thinking`。
- `"max_tokens": 400,` 思考模式下推理也算在这个上限里(Day 122),给足。
- `chunks: list[dict[str, object]] = []` 每一块的时间和内容记下来,存成文件,练习 3 要分析。
- `first_reasoning = first_content = None` 两个「首次出现」的时刻,链式赋值。
- `with httpx.stream("POST", URL, headers=HEADERS, json=BODY, timeout=60) as resp:` **和 `httpx.post` 的区别**:`stream` 不把整个响应读完再返回,而是拿到头就返回,正文你自己一点一点读。`with` 保证读完或者出错时连接会关掉。
- `print(f"状态 {resp.status_code}, Content-Type: {resp.headers.get('content-type')}, 头到达 {time.monotonic() - start:.2f} 秒")` 这时正文还没到,只有头。实跑 0.19 秒。
- `for line in resp.iter_lines():` 逐行读正文,收到一行给一行,这就是「流」。
- `if not line.startswith("data: "):` 空行、注释行都跳过。今天只认 `data:`,练习 4 写一个完整的解析器。
- `payload = line[len("data: "):]` 去掉前缀,剩下 JSON 或者 `[DONE]`。
- `if payload == "[DONE]":` 结束标记,跳出循环。
- `chunk = json.loads(payload)` 一块。
- `delta = chunk["choices"][0]["delta"]` 这一块的增量。
- `piece_r = delta.get("reasoning_content") or ""` 思考模式下的推理增量,没有就空字符串。`or ""` 兜住 `None`。
- `piece = delta.get("content") or ""` 正文增量。
- `if piece_r and first_reasoning is None:` 第一次出现非空推理,记时刻。
- `if piece and first_content is None:` 第一次出现非空正文,记时刻。**这才是首 token 延迟**:用户看到第一个字的时刻。
- `reasoning += piece_r`、`text += piece` 拼起来。明天 SDK 版本做的也是这两行。
- `chunks.append({"t": round(now, 3),` 记录。
- `if len(chunks) <= 5 or chunk["choices"][0]["finish_reason"]:` 只打印前 5 块和最后一块,不然一百多行。
- `print(f"共 {len(chunks)} 块; 首个推理块 {first_reasoning}; 首个正文块 {first_content} 秒; 总计 {total:.2f} 秒")` 汇总。
- `print("最后一块的 usage:", chunks[-1]["usage"])` 验证 usage 挂在最后一块上。
- `out = Path(f"data/stream_{VENDOR}_{'thinking' if THINKING else 'plain'}.json")` 按厂商和模式起名,练习 1 换厂商跑不会覆盖这一份。

</div>

```bash
uv run python -m part02.sse_raw
```

```text
状态 200, Content-Type: text/event-stream; charset=utf-8, 头到达 0.19 秒
[ 0.20 秒] delta={'role': 'assistant', 'content': ''} finish_reason=None
[ 0.90 秒] delta={'content': '杭州'} finish_reason=None
[ 1.00 秒] delta={'content': '是中国'} finish_reason=None
[ 1.01 秒] delta={'content': '浙江省'} finish_reason=None
[ 1.03 秒] delta={'content': '的'} finish_reason=None
[ 1.57 秒] delta={'content': ''} finish_reason=stop
[ 1.57 秒] [DONE]
共 65 块; 首个推理块 None; 首个正文块 0.8952849310007878 秒; 总计 1.57 秒
正文 116 字: 杭州是中国浙江省的省会，以西湖美景闻名于世，素有“人间天堂”的美誉。这里历史悠久，是吴越文化和南宋文化的发祥地之一，拥有众多名胜古迹。同时，杭州也是中国数字经济的重要中心，阿里巴巴等科技企业总部坐落于此，展现了古典与现代的完美融合。
最后一块的 usage: {'prompt_tokens': 10, 'completion_tokens': 63, 'total_tokens': 73, 'prompt_tokens_details': {'cached_tokens': 0}, 'prompt_cache_hit_tokens': 0, 'prompt_cache_miss_tokens': 10}
```

时间线:0.19 秒头到了,0.20 秒第一块(空的 `role` 块)到了,**0.90 秒第一个字「杭州」到了**,之后 0.65 秒里出了 63 个 token,1.57 秒结束。65 块:1 个 role 块,63 个有字的块,1 个结束块。usage 在最后一块,`completion_tokens` 63,和「有字的块」的数量一样,说明这次每块正好一个 token。

这 0.90 秒就是**首 token 延迟,TTFT(Time To First Token)**:从发出请求到第一个字出现。对话类产品最看重它。它包括网络往返、排队、读完输入(预填充)、生成第一个 token。非流式调用的用户要等到 1.57 秒才看到东西,流式的用户 0.90 秒就开始读了,而且后面是以每秒近一百个 token 的速度往外冒,比人读得快。

## 思考模式下,首 token 是哪个 token

DeepSeek 默认开着思考模式(Day 121、122 讲过,我们一直用 `extra_body` 关着)。开着时,模型先「想」再「写」,想的内容在 `reasoning_content` 里。看它在流里怎么出现:

```bash
uv run python -m part02.sse_raw --thinking
```

```text
状态 200, Content-Type: text/event-stream; charset=utf-8, 头到达 0.16 秒
[ 0.17 秒] delta={'role': 'assistant', 'content': None, 'reasoning_content': ''} finish_reason=None
[ 0.69 秒] delta={'content': None, 'reasoning_content': '我们需要'} finish_reason=None
[ 0.75 秒] delta={'content': None, 'reasoning_content': '回答'} finish_reason=None
[ 0.75 秒] delta={'content': None, 'reasoning_content': '中文'} finish_reason=None
[ 0.75 秒] delta={'content': None, 'reasoning_content': '，'} finish_reason=None
[ 2.08 秒] delta={'content': '', 'reasoning_content': None} finish_reason=stop
[ 2.08 秒] [DONE]
共 182 块; 首个推理块 0.6862336449994473; 首个正文块 1.7599942849992658 秒; 总计 2.09 秒
推理 200 字, 开头: '我们需要回答中文，三句话介绍杭州。需要简洁准确。三句话，每句可涵盖地理位置/身份、历史文化自然、现代发展。注意“三句话”'
正文 107 字: 杭州是浙江省省会、长三角重要中心城市，位于钱塘江畔，素有“人间天堂”美誉。这里有西湖、京杭大运河等文化遗产，历史底蕴深厚，也是江南文化的重要代表。如今的杭州数字经济、电子商务和创新创业活跃，传统韵味与现代活力交融。
最后一块的 usage: {'prompt_tokens': 10, 'completion_tokens': 181, 'total_tokens': 217, 'prompt_tokens_details': {'cached_tokens': 0}, 'completion_tokens_details': {'reasoning_tokens': 122}, 'prompt_cache_hit_tokens': 0, 'prompt_cache_miss_tokens': 10}
```

三个变化。一,`delta` 里多了 `reasoning_content`,它**先于** `content` 出现:0.69 秒第一块推理「我们需要」,一直到 1.76 秒才有第一块正文。二,首个正文块从 0.90 秒推迟到 1.76 秒,因为模型先写了 122 个推理 token(`reasoning_tokens`)。三,块数从 65 涨到 182,输出 token 从 63 涨到 181,钱也是三倍。

这决定了一个产品细节:开思考模式时,如果你只把 `content` 显示给用户,他要盯着空白看 1.8 秒,比非流式还难受;把 `reasoning_content` 也流式显示出来(折叠成「思考中…」那种),用户 0.7 秒就看到有东西在动。这就是各家聊天产品都把思考过程显示出来的原因之一。

## 量一量:流式到底快在哪

一次测量说明不了问题,写 `part02/ttft_bench.py`,同一个问题非流式和流式各跑 3 次,取中位数:

```python
# agent-zero-lab/part02/ttft_bench.py
import json
import os
import statistics
import time

import httpx
from dotenv import load_dotenv

load_dotenv(os.environ.get("ENV_FILE", ".env"), override=True)
URL = os.environ["LLM_BASE_URL"].rstrip("/") + "/chat/completions"
HEADERS = {"Authorization": f"Bearer {os.environ['LLM_API_KEY']}", "Content-Type": "application/json"}
ROUNDS = 3
QUESTION = "用 200 字介绍一下西湖。"


def body(stream: bool) -> dict[str, object]:
    return {"model": os.environ["LLM_MODEL"], "messages": [{"role": "user", "content": QUESTION}],
            "max_tokens": 300, "stream": stream, "thinking": {"type": "disabled"}}


def non_stream() -> tuple[float, float, int]:
    start = time.monotonic()
    resp = httpx.post(URL, headers=HEADERS, json=body(False), timeout=60)
    total = time.monotonic() - start
    data = resp.json()
    return total, total, data["usage"]["completion_tokens"]


def stream() -> tuple[float, float, int]:
    start = time.monotonic()
    first = None
    tokens = 0
    with httpx.stream("POST", URL, headers=HEADERS, json=body(True), timeout=60) as resp:
        for line in resp.iter_lines():
            if not line.startswith("data: ") or line == "data: [DONE]":
                continue
            chunk = json.loads(line[6:])
            if chunk["choices"][0]["delta"].get("content") and first is None:
                first = time.monotonic() - start
            if chunk.get("usage"):
                tokens = chunk["usage"]["completion_tokens"]
    assert first is not None
    return first, time.monotonic() - start, tokens


for label, fn in (("非流式", non_stream), ("流式", stream)):
    firsts, totals, counts = [], [], []
    for _ in range(ROUNDS):
        f, t, n = fn()
        firsts.append(f)
        totals.append(t)
        counts.append(n)
    print(f"{label}: 首个 token {statistics.median(firsts):.2f} 秒, 全部 {statistics.median(totals):.2f} 秒, "
          f"输出 {statistics.median(counts):.0f} 个 token, 约 {statistics.median(counts) / statistics.median(totals):.0f} token/秒"
          f"  (3 次的首 token: {[round(x, 2) for x in firsts]})")
```

<div class="line-notes">

- `QUESTION = "用 200 字介绍一下西湖。"` 要一个一百多 token 的回答,差距才看得出来。
- `def body(stream: bool) -> dict[str, object]:` 两种请求体只差 `stream` 一个字段。
- `def non_stream() -> tuple[float, float, int]:` 返回(首个 token 时刻,总时长,输出 token 数)。非流式的「首个 token」就是总时长,用户只能在最后一起看到。
- `resp = httpx.post(URL, headers=HEADERS, json=body(False), timeout=60)` Day 121 的手写 POST。
- `def stream() -> tuple[float, float, int]:` 流式版本,逻辑和 `sse_raw.py` 一样,只记两个时刻。
- `chunk = json.loads(line[6:])` `"data: "` 正好 6 个字符。
- `if chunk["choices"][0]["delta"].get("content") and first is None:` 第一块非空正文,记时刻。空字符串在 `if` 里是假,所以开头那个 role 块不算。
- `if chunk.get("usage"):` 最后一块带 usage,从里面取输出 token 数。
- `for label, fn in (("非流式", non_stream), ("流式", stream)):` 把函数放进元组里轮流调用,Day 130 的 `priority.py` 也这么干过。
- `print(f"{label}: 首个 token {statistics.median(firsts):.2f} 秒,` 中位数,Day 128 的习惯。

</div>

```bash
uv run python -m part02.ttft_bench
```

```text
非流式: 首个 token 1.85 秒, 全部 1.85 秒, 输出 132 个 token, 约 71 token/秒  (3 次的首 token: [1.7, 1.85, 1.95])
流式: 首个 token 0.48 秒, 全部 1.41 秒, 输出 117 个 token, 约 83 token/秒  (3 次的首 token: [0.48, 0.28, 0.64])
```

非流式:1.85 秒前什么都没有。流式:0.48 秒第一个字,1.41 秒全部出完。两种方式的总时长在同一个量级(这次流式反而短一点,是因为它这几次的回答短了十几个 token,不是流式本身更快),生成速度都是每秒七八十个 token。**流式不会让模型算得更快,它改变的是用户等第一个字的时间**:1.85 秒变 0.48 秒。

<figure>
<svg viewBox="0 0 640 210" role="img" aria-label="非流式和流式调用的时间线对比:非流式 1.85 秒前全是空白然后整段出现;流式 0.48 秒出第一个字,之后每隔几毫秒到几百毫秒出一块,1.41 秒出完">
<rect x="0" y="0" width="640" height="210" fill="var(--paper-raised)" rx="6"/>
<g font-family="var(--font-mono)" font-size="12">
<text x="20" y="30" fill="var(--ink)">非流式</text>
<rect x="100" y="16" width="430" height="22" fill="none" stroke="var(--rule)" stroke-dasharray="4 3"/>
<text x="315" y="32" text-anchor="middle" fill="var(--ink-faint)">用户看到空白 1.85 秒</text>
<rect x="530" y="16" width="90" height="22" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="575" y="32" text-anchor="middle" fill="var(--ink)">整段出现</text>
<text x="20" y="90" fill="var(--ink)">流式</text>
<rect x="100" y="76" width="112" height="22" fill="none" stroke="var(--rule)" stroke-dasharray="4 3"/>
<g fill="var(--mem-wash)" stroke="var(--mem)">
<rect x="212" y="76" width="22" height="22"/><rect x="236" y="76" width="22" height="22"/><rect x="260" y="76" width="22" height="22"/>
<rect x="284" y="76" width="22" height="22"/><rect x="308" y="76" width="22" height="22"/><rect x="332" y="76" width="22" height="22"/>
<rect x="356" y="76" width="22" height="22"/><rect x="380" y="76" width="22" height="22"/><rect x="404" y="76" width="22" height="22"/>
<rect x="428" y="76" width="22" height="22"/><rect x="452" y="76" width="22" height="22"/><rect x="476" y="76" width="22" height="22"/>
</g>
<line x1="212" y1="104" x2="212" y2="124" stroke="var(--compute)"/>
<text x="218" y="122" fill="var(--compute)">TTFT 0.48 秒:第一个字出现</text>
<line x1="498" y1="104" x2="498" y2="124" stroke="var(--ink-soft)"/>
<text x="440" y="140" fill="var(--ink-soft)">1.41 秒出完</text>
<text x="20" y="172" fill="var(--ink-soft)">两条线的总时长差不多,生成速度都是每秒七八十个 token;</text>
<text x="20" y="192" fill="var(--ink-soft)">流式只是让用户在第一块到达时就开始读。开思考模式时 TTFT 会变长,要先想完。</text>
</g>
</svg>
<figcaption>同一个问题的两条时间线(实测中位数)。流式没有缩短总时长,它把「空白等待」从 1.85 秒缩到了 0.48 秒,剩下的时间用户在阅读而不是在等。</figcaption>
</figure>

## 中途断开会怎样

流式还有一个非流式没有的情况:客户端可以中途走掉(用户点了「停止生成」,或者关了页面)。用 curl 的 `--max-time` 模拟,1.2 秒后强行断开:

```bash
curl -sN --max-time 1.2 https://api.deepseek.com/chat/completions \
  -H "Content-Type: application/json" -H "Authorization: Bearer $LLM_API_KEY" \
  -d '{"model":"deepseek-flash","stream":true,"thinking":{"type":"disabled"},"max_tokens":300,
       "messages":[{"role":"user","content":"用 200 字介绍一下西湖。"}]}' | grep -c '^data:'
echo "curl 退出码 $?"
```

```text
60
curl 退出码 28
```

1.2 秒里收到了 60 块,然后 curl 以退出码 28(超时)退出,没有 `[DONE]`,也没有带 usage 的最后一块。两个后果:一,**你拿不到 usage**,这次调用花了多少 token 只能自己估(数收到的块,或者用 tokenizer 数拼出来的文字);二,服务器那边会不会继续生成到 300 个 token 再收钱,各家不一样,文档一般不写。我没有办法在账单里单独核对这一次请求计了多少费,这里只能说:**中途断开不等于不花钱,写代码时要把「断开时记一笔估算」考虑进去**,明天的 `stream()` 里会留这个口子。

### 零件 → 明天的大代码对照

今天没有拼大代码,零件是给明天 `chat_stream.py` 和 Day 135 起的 `LLMClient.stream()` 准备的:

| 今天看到的 | 明天在哪里用 |
| --- | --- |
| `data:` 开头、空行分隔、`[DONE]` 结束 | SDK 的 `stream=True` 在内部做这件事,明天你会看到它返回的就是一个一块一块的迭代器 |
| `delta.content` 要自己拼 | `text += piece`,明天 `chat_stream.py` 的核心 |
| `reasoning_content` 先于 `content` | 明天分开显示「思考」和「正文」 |
| usage 在最后一块(DeepSeek)/单独一块(OpenAI) | 明天兼容两种,算钱 |
| 首个正文块的时刻 = TTFT | Day 135 `ChatResult.ttft` 字段 |
| 断开拿不到 usage | 明天的 `finally` 分支 |
| 链路上任何一环缓冲就不流 | `print(piece, end="", flush=True)` |

## 动手练习

**练习 1:换一家看流。** 用 `ENV_FILE=.env.sf` 跑 `sse_raw.py`,比较硅基流动和 DeepSeek 的流:响应头、第一块、最后一块、usage 的位置、首个正文块的时刻。

<details><summary>参考答案</summary>

```bash
ENV_FILE=.env.sf uv run python -m part02.sse_raw
```

```text
状态 200, Content-Type: text/event-stream, 头到达 0.76 秒
[ 0.76 秒] delta={'content': '', 'role': 'assistant'} finish_reason=None
[ 0.77 秒] delta={'content': '杭州'} finish_reason=None
[ 1.04 秒] delta={'content': '，'} finish_reason=None
[ 1.04 秒] delta={'content': '一座'} finish_reason=None
[ 1.65 秒] delta={'content': '被'} finish_reason=None
[ 4.99 秒] delta={'content': None} finish_reason=stop
[ 4.99 秒] [DONE]
共 77 块; 首个推理块 None; 首个正文块 0.7651344340010837 秒; 总计 5.00 秒
正文 112 字: 杭州，一座被诗意浸润的江南古城，以西湖的潋滟水光与千年文脉交织出“人间天堂”的底色。这里是数字经济与创新活力的热土，阿里巴巴等科技巨头让古老城市焕发“智慧”新颜。而龙井茶香与钱塘潮声，则为它保留了最东方的生活美学与自然韵律。
最后一块的 usage: {'prompt_tokens': 10, 'completion_tokens': 77, 'total_tokens': 87, 'completion_tokens_details': {'reasoning_tokens': 0}, 'prompt_tokens_details': {'cached_tokens': 0}, 'prompt_cache_hit_tokens': 0, 'prompt_cache_miss_tokens': 10}
```

同样是「OpenAI 兼容」的流,细节不一样:

- `Content-Type` 是 `text/event-stream`,没有 `; charset=utf-8`。读的时候要自己按 UTF-8 解码,httpx 默认就是,但别的库未必。
- **头到达 0.76 秒**,而 DeepSeek 是 0.19 秒;头一到,第一个字几乎同时到(0.77 秒)。像是硅基流动把响应头攒到第一个 token 生成出来才一起发。所以在它这里 curl 的「首字节」反而接近 TTFT,这是碰巧,不要依赖。
- 最后一块 `delta` 是 `{'content': None}`,DeepSeek 是 `{'content': ''}`。`or ""` 那一行兜住了两种。
- usage 同样挂在最后一块,也有 DeepSeek 风格的 `prompt_cache_hit_tokens`,这家是照着 DeepSeek 兼容的。
- 总时长 5 秒,DeepSeek 1.57 秒;我前一次跑它用了 20 秒。生成速度 15 到 50 token/秒,比 DeepSeek 的七八十慢得多,而且晃。

结论和 Day 123、128 一样:兼容的是格式,不是行为;读流的代码要对「字段可能是 `None`、可能缺」有防备。

</details>

**练习 2:给假服务器加上 `event:`、`id:`、`retry:`,再用 EventSource 读。** 复制 `sse_server.py` 为 `sse_server2.py`:每个事件带 `event: delta` 和递增的 `id:`,开头发一行 `retry: 3000`,结束改成 `event: done`;根路径 `/` 返回一个用 `EventSource` 读流的网页。用 `curl -N` 看格式,再用练习 4 的解析器或者浏览器验证能拼出整句话。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part02/sse_server2.py
import json
import time
from http.server import BaseHTTPRequestHandler, HTTPServer

PIECES = ["云簿", "是", "一款", "面向", "中小企业", "的", "记账", "软件", "。"]
PAGE = """<!doctype html><meta charset="utf-8"><title>SSE 演示</title>
<p id="out"></p><p id="log"></p>
<script>
const out = document.getElementById("out"), log = document.getElementById("log");
const es = new EventSource("/stream");
es.addEventListener("delta", (e) => { out.textContent += JSON.parse(e.data).delta; });
es.addEventListener("done", (e) => { log.textContent = "done, 最后的 id=" + e.lastEventId; es.close(); });
</script>"""


class Handler(BaseHTTPRequestHandler):
    def do_GET(self) -> None:
        if self.path == "/":
            data = PAGE.encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)
            return
        if self.path != "/stream":
            self.send_response(404)
            self.end_headers()
            return
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream; charset=utf-8")
        self.send_header("Cache-Control", "no-cache")
        self.end_headers()
        self.wfile.write(b"retry: 3000\n\n")
        for i, piece in enumerate(PIECES):
            body = json.dumps({"delta": piece}, ensure_ascii=False)
            self.wfile.write(f"event: delta\nid: {i}\ndata: {body}\n\n".encode("utf-8"))
            self.wfile.flush()
            time.sleep(0.3)
        self.wfile.write(f"event: done\nid: {len(PIECES)}\ndata: {{}}\n\n".encode("utf-8"))
        self.wfile.flush()

    def log_message(self, format: str, *args: object) -> None:
        pass


if __name__ == "__main__":
    print("打开 http://127.0.0.1:8767/ 看浏览器里的效果, Ctrl+C 停止")
    HTTPServer(("127.0.0.1", 8767), Handler).serve_forever()
```

<div class="line-notes">

- `PAGE = """<!doctype html>` 一个最小的网页。你做前端,这几行不用解释,只看 SSE 相关的:`new EventSource("/stream")` 发起连接,`addEventListener("delta", ...)` 只收 `event: delta` 的事件,`e.data` 是 `data:` 行的内容,`e.lastEventId` 是最近一个 `id:`。
- `if self.path == "/":` 根路径回网页,网页和流同源,不用管跨域。
- `self.send_header("Content-Length", str(len(data)))` 网页是定长的,给 `Content-Length`;流没有。
- `self.wfile.write(b"retry: 3000\n\n")` 告诉浏览器:断线后 3 秒重连。只对 `EventSource` 有意义,curl 不理会。
- `self.wfile.write(f"event: delta\nid: {i}\ndata: {body}\n\n".encode("utf-8"))` 一个事件三行:事件名、编号、数据,再一个空行结束。
- `self.wfile.write(f"event: done\nid: {len(PIECES)}\ndata: {{}}\n\n".encode("utf-8"))` 结束事件,`data` 是一个空 JSON 对象;f-string 里 `{{}}` 是转义后的 `{}`。
- `HTTPServer(("127.0.0.1", 8767), Handler)` 换个端口,和 `sse_server.py` 不冲突。

</div>

```bash
uv run python -m part02.sse_server2 &
curl -sN http://127.0.0.1:8767/stream | head -12
```

```text
retry: 3000

event: delta
id: 0
data: {"delta": "云簿"}

event: delta
id: 1
data: {"delta": "是"}

event: delta
id: 2
```

一个事件三行加一个空行。用练习 4 的解析器读它(先做练习 4,或者先看下面的输出):

```bash
curl -sN http://127.0.0.1:8767/stream | uv run python -c '
import sys
from part02.sse_parse import parse_sse
for e in parse_sse(sys.stdin):
    print(e.event, e.id, e.retry, e.data)'
```

```text
delta 0 None {"delta": "云簿"}
delta 1 None {"delta": "是"}
delta 2 None {"delta": "一款"}
delta 3 None {"delta": "面向"}
delta 4 None {"delta": "中小企业"}
delta 5 None {"delta": "的"}
delta 6 None {"delta": "记账"}
delta 7 None {"delta": "软件"}
delta 8 None {"delta": "。"}
done 9 None {}
```

`retry` 那一列是 `None`,因为按规范 `retry:` 只设置重连间隔,不属于任何一个事件,解析器把它吞掉了。浏览器那一步我没有在浏览器里实跑,用 Node 24 的 `EventSource`(要加 `--experimental-eventsource` 标志)代替验证了一次:

```bash
node --experimental-eventsource -e '
const es = new EventSource("http://127.0.0.1:8767/stream"); let out = "";
es.addEventListener("delta", (e) => { out += JSON.parse(e.data).delta; });
es.addEventListener("done", (e) => { console.log("拼出来:", out, "| lastEventId =", e.lastEventId); es.close(); });'
```

```text
(node:5990) [UNDICI-ES] Warning: EventSource is experimental, expect them to change at any time.
拼出来: 云簿是一款面向中小企业的记账软件。 | lastEventId = 9
```

9 块拼成一句话,最后的 id 是 9。你在浏览器里打开 `http://127.0.0.1:8767/` 应该看到同样的句子一个词一个词出现。看完别忘了把后台的服务器停掉(`kill %1` 或者在任务列表里找到它)。

</details>

**练习 3:每一块有多大。** 写 `part02/chunk_stats.py`,读 `data/stream_deepseek_plain.json`、`data/stream_deepseek_thinking.json` 和练习 1 的 `data/stream_sf_plain.json`,统计每块的字数(最少、最多、中位数、分布)和块与块之间的时间间隔。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part02/chunk_stats.py
import json
import statistics
from pathlib import Path

for name in ("stream_deepseek_plain", "stream_deepseek_thinking", "stream_sf_plain"):
    path = Path(f"data/{name}.json")
    if not path.exists():
        continue
    chunks = json.loads(path.read_text(encoding="utf-8"))
    pieces = [c["content"] or c["reasoning"] for c in chunks if (c["content"] or c["reasoning"])]
    sizes = [len(p) for p in pieces]
    gaps = [b["t"] - a["t"] for a, b in zip(chunks, chunks[1:])]
    print(f"{name}: {len(chunks)} 块, 有字的 {len(pieces)} 块")
    print(f"  每块字数: 最少 {min(sizes)} 最多 {max(sizes)} 中位数 {statistics.median(sizes)} 平均 {statistics.mean(sizes):.2f}")
    print(f"  块间隔: 中位数 {statistics.median(gaps) * 1000:.0f} 毫秒, 最大 {max(gaps) * 1000:.0f} 毫秒")
    sizes_count = {n: sizes.count(n) for n in sorted(set(sizes))}
    print(f"  字数分布: {sizes_count}")
    print(f"  最长的一块: {max(pieces, key=len)!r}")
```

<div class="line-notes">

- `if not path.exists():` 没跑过练习 1 就没有 `sf` 那份,跳过。
- `pieces = [c["content"] or c["reasoning"] for c in chunks if (c["content"] or c["reasoning"])]` 每块的文字,正文或推理;空块(开头的 role 块、结尾块)不算。
- `gaps = [b["t"] - a["t"] for a, b in zip(chunks, chunks[1:])]` 相邻两块的时间差,`zip(列表, 列表[1:])` 是取相邻对的常用写法。
- `sizes_count = {n: sizes.count(n) for n in sorted(set(sizes))}` 字典推导式:每种字数出现几次。
- `print(f"  最长的一块: {max(pieces, key=len)!r}")` `max` 按长度找。

</div>

```bash
uv run python -m part02.chunk_stats
```

```text
stream_deepseek_plain: 65 块, 有字的 63 块
  每块字数: 最少 1 最多 4 中位数 2 平均 1.84
  块间隔: 中位数 7 毫秒, 最大 693 毫秒
  字数分布: {1: 23, 2: 30, 3: 7, 4: 3}
  最长的一块: '历史悠久'
stream_deepseek_thinking: 182 块, 有字的 180 块
  每块字数: 最少 1 最多 4 中位数 1.0 平均 1.71
  块间隔: 中位数 0 毫秒, 最大 515 毫秒
  字数分布: {1: 91, 2: 65, 3: 10, 4: 13}
  最长的一块: '我们需要'
```

第三份(硅基流动,`stream_sf_plain.json`)我这篇没有贴输出:整理文章时那份数据文件没有留下来,也没有为它重跑。你做完练习 1 后自己跑一遍,和上面两份对着看。

每块 1 到 4 个汉字,中位数 1 到 2 个,和 [Day 107](/blog/agent-zero/day-107-tokens-1/) 讲的「一个 token 一两个汉字」对上了:**流的粒度就是 token 的粒度**。块间隔中位数 0 到 7 毫秒,最大的一次间隔(693 毫秒)就是首个正文块前的那段等待。所以「打字机效果」不是前端做的动画,是模型真的在一个 token 一个 token 地出。前端如果想让它看起来更匀,反而要自己加缓冲(攒几个字一起显示),那就是用体验换一点延迟。

</details>

**练习 4:按规范写一个 SSE 解析器。** 今天的 `sse_raw.py` 只认 `data: ` 开头、一行一个事件。写 `part02/sse_parse.py` 的 `parse_sse(lines)`,按 HTML 标准处理:多行 `data:` 用换行拼接;`event:`、`id:`、`retry:` 字段;以 `:` 开头的注释行;冒号后面可选的一个空格;`\r\n` 换行;最后一个事件没有尾随空行。写 7 个测试。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part02/sse_parse.py
from collections.abc import Iterable, Iterator
from dataclasses import dataclass


@dataclass
class Event:
    data: str
    event: str = "message"
    id: str | None = None
    retry: int | None = None


def parse_sse(lines: Iterable[str]) -> Iterator[Event]:
    data_lines: list[str] = []
    name = "message"
    last_id: str | None = None
    retry: int | None = None
    for raw in lines:
        line = raw.rstrip("\r\n")
        if line == "":
            if data_lines:
                yield Event("\n".join(data_lines), name, last_id, retry)
            data_lines, name, retry = [], "message", None
            continue
        if line.startswith(":"):
            continue
        key, sep, value = line.partition(":")
        if sep and value.startswith(" "):
            value = value[1:]
        if key == "data":
            data_lines.append(value)
        elif key == "event":
            name = value
        elif key == "id":
            last_id = value
        elif key == "retry" and value.isdigit():
            retry = int(value)
    if data_lines:
        yield Event("\n".join(data_lines), name, last_id, retry)
```

<div class="line-notes">

- `class Event:` 一个事件:数据、事件名(默认 `message`,规范的默认值)、最近的 id、重连间隔。
- `def parse_sse(lines: Iterable[str]) -> Iterator[Event]:` 收「一行一行的东西」(文件、`sys.stdin`、`resp.iter_lines()` 都行),产出事件。用 `yield` 的生成器,[Day 99](/blog/agent-zero/day-099-generators/) 学的,这样一边收一边吐,不用等全部读完。
- `line = raw.rstrip("\r\n")` 去掉 `\n` 或 `\r\n`。
- `if line == "":` 空行,一个事件结束。
- `if data_lines:` 有 `data` 才算一个事件;只有 `retry:` 没有 `data` 的不产出(规范如此)。
- `yield Event("\n".join(data_lines), name, last_id, retry)` 多行 `data` 用 `\n` 拼。
- `data_lines, name, retry = [], "message", None` 重置。注意 `last_id` **不重置**:规范规定 id 会延续到后面的事件,直到下一个 `id:` 行。
- `if line.startswith(":"):` 注释行,跳过。服务器拿它当心跳。
- `key, sep, value = line.partition(":")` 按第一个冒号切成三段,Day 128 的 `fake_llm.py` 也用过 `partition`。
- `if sep and value.startswith(" "):` 冒号后面的第一个空格是可选的,有就去掉一个,只去一个。
- `elif key == "retry" and value.isdigit():` 规范说 `retry` 必须全是数字,否则忽略。
- `if data_lines:` 循环结束后还有没发出去的(最后一个事件没有尾随空行),补发。

</div>

```python
# agent-zero-lab/tests/test_sse_parse.py
from part02.sse_parse import parse_sse


def events(text: str) -> list:
    return list(parse_sse(text.splitlines(keepends=True)))


def test_two_plain_events() -> None:
    got = events("data: a\n\ndata: b\n\n")
    assert [e.data for e in got] == ["a", "b"]
    assert got[0].event == "message"


def test_multi_line_data_is_joined_with_newline() -> None:
    got = events("data: 第一行\ndata: 第二行\n\n")
    assert got[0].data == "第一行\n第二行"


def test_comment_lines_are_ignored() -> None:
    got = events(": 这是心跳\n\ndata: x\n\n")
    assert [e.data for e in got] == ["x"]


def test_event_name_id_and_retry() -> None:
    got = events("event: delta\nid: 7\nretry: 3000\ndata: {}\n\n")
    assert (got[0].event, got[0].id, got[0].retry) == ("delta", "7", 3000)


def test_crlf_and_missing_space_after_colon() -> None:
    got = events("data:no-space\r\n\r\n")
    assert got[0].data == "no-space"


def test_last_event_without_trailing_blank_line() -> None:
    got = events("data: tail")
    assert got[0].data == "tail"


def test_done_marker_is_just_data() -> None:
    got = events("data: [DONE]\n\n")
    assert got[0].data == "[DONE]"
```

<div class="line-notes">

- `def events(text: str) -> list:` 把一段文本按行切(保留行尾)喂给解析器,收成列表。
- `def test_multi_line_data_is_joined_with_newline() -> None:` 规范里最容易漏的一条:两行 `data:` 是一个事件。
- `def test_comment_lines_are_ignored() -> None:` 注释行后面跟空行,不该产出空事件。
- `def test_crlf_and_missing_space_after_colon() -> None:` Windows 风格换行和「冒号后没空格」。
- `def test_last_event_without_trailing_blank_line() -> None:` 没有尾随空行也要发出最后一个。
- `def test_done_marker_is_just_data() -> None:` `[DONE]` 对解析器来说只是普通数据,认不认它是上层的事。

</div>

```bash
uv run pytest tests/test_sse_parse.py -q
```

```text
.......                                                                  [100%]
7 passed in 0.02s
```

有了它,`sse_raw.py` 里那几行 `startswith("data: ")` 可以换成 `for e in parse_sse(resp.iter_lines())`。明天用 SDK 之后你不需要自己解析了,但 SDK 内部(`openai/_streaming.py` 里的 `SSEDecoder`)做的就是这几十行。

</details>

**练习 5:面试题。** 「为什么大模型接口的流式输出用 SSE,而不用 WebSocket 或者轮询?」用今天看到的东西答,写在 `part02/why_sse.md` 里,两百字以内。

<details><summary>参考答案</summary>

示范:

> 大模型的流式输出是「客户端发一个请求,服务端在一段时间里持续往回送一段一段的文本」,方向是单向的,量是有限的,送完就结束。SSE 正好是这个形状:它就是一个普通的 HTTP 响应,头里写 `text/event-stream`,正文一行 `data:` 一个事件、空行分隔,服务器写一块刷一块,最后关连接。好处是什么都不用多做:走 HTTP、过代理和网关、鉴权头照用、`curl -N` 就能看、浏览器有 `EventSource`、断线有 `retry`/`id` 可以续。WebSocket 是双向长连接,要握手升级协议、要自己定消息格式、很多网关和负载均衡要单独配,而大模型这个场景用不着「客户端随时往回发」这一半。轮询则要反复发请求,每次都重新算或者服务端要存中间结果,延迟和开销都更差。所以几乎所有厂商都选了 SSE;真正需要双向的场景(语音对话、实时打断)才上 WebSocket。

</details>

**验收标准:** `curl -N` 对 DeepSeek 能看到 `data:` 开头的块、最后一块带 `usage`、然后 `data: [DONE]`;`sse_server.py` 用 `stamp.py` 对比,带 `-N` 每 0.4 秒一行、不带 `-N` 全部在最后一起到;`sse_raw.py` 打印的首个正文块在 0.5–1.5 秒之间,`--thinking` 时推理块先于正文块出现;`ttft_bench.py` 流式的首 token 明显早于非流式;`pytest tests/test_sse_parse.py` 7 个全过;练习 1 能指出两家至少三处不同。

今天的花费:每次流式请求输入十几个 token、输出一两百个,约 0.001 到 0.002 元(思考模式那次 181 个输出,0.0015 元);`sse_raw.py` 跑了 5 次、`ttft_bench.py` 6 次调用、curl 实验 6 次、练习 1 两次,合计约 20 次,约 0.02 元。假服务器不花钱。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 流式输出(streaming) | 模型每生成一小块就立刻发给客户端,不等全部生成完。请求体里 `"stream": true` |
| SSE(Server-Sent Events) | HTML 标准规定的一种 HTTP 响应格式:`Content-Type: text/event-stream`,正文是一个个「字段: 值」行组成的事件,空行分隔。服务器单向推送 |
| 事件(event) | SSE 里的一个单位,由若干行组成、以空行结束;大模型接口里一个事件就是一块 JSON |
| `data:` / `event:` / `id:` / `retry:` | SSE 的四个字段:数据、事件名、事件编号、断线重连间隔(毫秒)。大模型接口基本只用 `data:` |
| `data: [DONE]` | OpenAI 定的、各家照抄的结束标记,不是 SSE 标准的一部分 |
| 块(chunk) | 流里的一块,`object` 是 `chat.completion.chunk` |
| 增量(delta) | 块里只带新生成的那一点内容,要自己拼。非流式的 `message` 在流式里变成 `delta` |
| 首 token 延迟(TTFT) | 从发出请求到第一个正文 token 到达的时间。实测非思考 0.5–0.9 秒,思考模式 1.76 秒 |
| 生成速度 | 每秒输出多少 token,实测 DeepSeek 七八十,硅基流动十几到五十 |
| `reasoning_content` | 思考模式下块里的推理增量,先于 `content` 出现,算在输出 token 里 |
| 预填充(prefill) | 模型读完输入的那一步,TTFT 的一部分,输入越长越久(Day 131 提过) |
| `curl -N` | `--no-buffer`,收到多少写多少;不加会攒一批再写,流式看不到流 |
| `curl -w` | 请求结束后按模板打印统计,`%{time_starttransfer}` 是收到第一个字节(头)的时刻,不是首个 token |
| `flush()` | 把缓冲区里的字节真的写出去。服务器的 `wfile.flush()`、`print(..., flush=True)` 都是 |
| `httpx.stream` | 拿到响应头就返回,正文用 `iter_lines()` 逐行读;`httpx.post` 要读完整个正文才返回 |
| `EventSource` | 浏览器里读 SSE 的接口,自动按事件分发、断线自动重连 |

## 常见误区

**用 `curl -w` 的首字节当首 token 延迟。** DeepSeek 非流式请求 0.03 秒就收到了响应头,正文 0.7 秒才到。HTTP/2 的头和正文分开发,首字节是头。要量 TTFT,得看第一个非空 `content` 块的时刻。

**curl 不加 `-N`。** 假服务器实测:不加时 9 块全部在 3.593 秒一起到,和非流式没区别。流式链路上任何一环缓冲都会把流憋成一整块。

**服务端写了不 `flush`。** Python 的 `wfile` 会攒着,9 块可能一起发出去。写一块刷一块。

**以为流式让模型变快。** 实测非流式 1.85 秒、流式 1.41 秒全部出完,在同一个量级,差的那点是回答长度不同。流式改的是用户看到第一个字的时间(1.85 → 0.48 秒),不是总时长。

**开了思考模式只显示 `content`。** 首个正文块 1.76 秒才到,用户盯着空白比非流式还久。把 `reasoning_content` 也流出来(折叠显示),0.7 秒就有动静。

**在 `[DONE]` 之前找 usage 找错地方。** DeepSeek 把 usage 挂在最后一个内容块上;OpenAI 要传 `stream_options.include_usage`,并且放在一个 `choices` 为空的单独块里。两种都要认。

**以为每块一个字。** 实测每块 1 到 4 个汉字,中位数 1 到 2,是 token 的粒度,不是字的粒度。

**中途断开以为不花钱。** 断开后拿不到 usage,但模型已经生成的部分是真的生成了。各家怎么计费文档一般不写,代码里要给断开留一笔估算。

**假设所有厂商的块长得一样。** 硅基流动的 `Content-Type` 没有 charset,最后一块 `content` 是 `None` 而不是 `''`,头到达的时刻和首个字几乎同时。读流的代码要对缺字段、`None` 有防备。

## 学习资料

### 文档与文章

- [DeepSeek · 对话补全接口](https://api-docs.deepseek.com/zh-cn/api/create-chat-completion):搜 `stream`、`stream_options`、`include_usage`,文档写明了 usage 附在 `[DONE]` 之前的最后一块上、不会单独下发;`reasoning_content` 的说明也在这页。
- [MDN · 使用服务器发送事件](https://developer.mozilla.org/zh-CN/docs/Web/API/Server-sent_events/Using_server-sent_events):中文。前半讲浏览器 `EventSource`,后半「事件流格式」一节就是今天的四条规则和 `data:`、`event:`、`id:`、`retry:` 四个字段,练习 4 的依据。
- [HTML 标准 · Server-sent events](https://html.spec.whatwg.org/multipage/server-sent-events.html):英文规范原文,「Parsing an event stream」一节是练习 4 解析器的权威来源,十几行就讲完了。
- [High Performance Browser Networking · Server-Sent Events](https://hpbn.co/server-sent-events-sse/):英文,免费在线。讲 SSE 的设计取舍、和 WebSocket 的对比,练习 5 的背景。
- [OpenAI · Streaming API responses](https://developers.openai.com/api/docs/guides/streaming-responses):OpenAI 的流式说明,它新一代 Responses API 把事件分了类型(`response.output_text.delta` 这种),比 Chat Completions 的「一种块」更细,看一眼知道有这回事。
- [curl 手册](https://curl.se/docs/manpage.html):搜 `--no-buffer` 和 `--write-out`,确认今天两个参数的官方解释。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV12uHk6XE2a&autoplay=0&high_quality=1" title="AI 串流为什么用 SSE 而不是 WebSocket" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>CodingStartup起码课 · AI 串流为什么用 SSE 而不是 WebSocket｜Server-Sent Events 教学｜真实封包拆解 · 9 分钟,2026 年 10 月。抓包拆 SSE 报文,正好对上今天 `curl -N` 那一节和练习 5,今天必看。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1b7jB6AEai&autoplay=0&high_quality=1" title="使用 Rust 开发 AI Agent - 02（下）格式化输出、流式输出" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>软件工艺师 · 使用 Rust 开发 AI Agent - 02(下)格式化输出、流式输出 · 21 分钟,2026 年 6 月。语言是 Rust,不用跟着写,看「别再只会 HTTP 了,SSE 才是 AI 流式输出的答案」那一段,听他怎么解释 delta 和拼接;换一种语言看同一个协议,反而更容易看清协议本身。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/4HlNv1qpZFY" title="Server-Sent Events Crash Course" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Hussein Nasser · Server-Sent Events Crash Course · 英文。他是讲后端网络协议的老手,这一集从 HTTP 讲到 SSE 的实现,对应今天「自己写一个服务器」那一节。我只核对了标题和能打开,没逐段看过。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/WS352jTTkPU" title="WebSockets vs Polling vs Server Sent Events" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Piyush Garg · WebSockets vs Polling vs Server Sent Events · 英文。三种方式的对比,练习 5 的素材。同样只核对了标题和能打开。</figcaption>
</figure>

### 书籍

- 《Web 性能权威指南》(Ilya Grigorik 著,李松峰 译,人民邮电出版社,2013 年 9 月;原书 High Performance Browser Networking):第四部分「浏览器 API」里有一章专门讲 SSE,和上面那个免费的英文在线版是同一本。做前端的读这一本不吃亏,顺便把 HTTP/2 那几章也看了,今天 DeepSeek 的头为什么先到,答案在那里。
- 《图解 HTTP》(上野宣 著,于均良 译,人民邮电出版社,2014 年 4 月):薄,全是图。今天用到的 `Content-Type`、分块传输、连接关闭这些概念,它讲得最直白。0 基础补课用。

### 开源项目与代码

- [openai/openai-python](https://github.com/openai/openai-python):打开 `src/openai/_streaming.py`,找 `SSEDecoder` 类,它的 `decode` 方法做的就是练习 4 那几十行:认 `data:`、`event:`、`id:`、`retry:`,空行出一个事件。明天 `stream=True` 返回的迭代器,底下就是它。

## 自测

1. 一个 SSE 响应和一个普通 JSON 响应,在响应头和正文上各有什么不同?

<details><summary>答案</summary>

头:`Content-Type` 从 `application/json` 变成 `text/event-stream`,多一个 `Cache-Control: no-cache`,没有 `Content-Length`(长度未知)。正文:不是一个 JSON,而是一行行 `data: {…}`,每个事件以空行结束,服务器写一块刷一块,最后 `data: [DONE]` 然后关连接。

</details>

2. 流式的每一块里,`delta`、`finish_reason`、`usage` 分别在什么位置、什么时候非空?

<details><summary>答案</summary>

每块都有 `choices[0].delta`,只带这一块的增量(第一块是空 content 加 `role`);`finish_reason` 一路 `null`,只有最后一个内容块是 `stop`(或 `length`);DeepSeek 的 `usage` 挂在那个最后的内容块上,`[DONE]` 之前,不单独下发;OpenAI 要传 `stream_options.include_usage`,usage 在一个 `choices` 为空的单独块里。

</details>

3. `curl -w` 报的 `time_starttransfer` 为什么不能当首 token 延迟?怎么量才对?

<details><summary>答案</summary>

它是收到第一个字节的时刻,HTTP/2 下服务器会先把响应头发回来(DeepSeek 非流式实测 0.03 秒),正文要等生成完。正确的量法是开流,记录第一个非空 `content` 块到达的时刻(`sse_raw.py` 的 `first_content`),实测 0.5–0.9 秒。

</details>

4. 自己写的假服务器,`curl -N` 和不加 `-N` 看到的区别是什么?说明了什么?

<details><summary>答案</summary>

加 `-N` 每 0.4 秒一行;不加时所有行在 3.593 秒(连接关闭时)一起到。服务器两次发的完全一样,差别只在客户端缓冲。说明流式链路上任何一环(服务端不 `flush`、curl 缓冲、`print` 不 `flush`、中间件攒包)都会把流憋成一整块。

</details>

5. 开思考模式后,流里先出现什么?对产品有什么影响?

<details><summary>答案</summary>

先出 `reasoning_content` 的块(实测 0.69 秒),正文 `content` 要等推理写完(1.76 秒),块数和输出 token 约三倍。如果只显示 `content`,用户等的空白比非流式还久;把推理过程也流式显示(折叠),0.7 秒就有反馈。

</details>

6. 面试题:「你们的聊天接口做了流式,首 token 延迟怎么量、怎么优化?」

<details><summary>答案</summary>

量:在服务端记录从收到用户请求到第一个非空正文块发出的时刻,前端记录到第一个字渲染的时刻,看中位数和 95 分位,不看平均;思考模式下分开记首个推理块和首个正文块。优化分几层:一,简单问题关掉思考模式(首正文块 1.76 秒变 0.9 秒);二,输入越长预填充越久,控制历史长度(Day 131 的裁剪)、把稳定的 system 放前面命中缓存;三,链路上每一环都不能缓冲:服务端每块 flush、网关关掉响应缓冲、前端逐块渲染;四,思考模式下把推理内容也流出来让用户看到动静;五,厂商和时段本身有差异(硅基流动头到达 0.76 秒、DeepSeek 0.19 秒),选厂商时把 TTFT 作为一项实测指标。最后一句:流式不缩短总时长,它优化的是体感,总时长要靠输出长度和模型本身。

</details>

## 明天预告

[Day 134](/blog/agent-zero/day-134-streaming-code/) · 流式输出(二):Python 里读流。今天用 curl 和 httpx 看清了流的形状:`data:` 一块一块来,`delta` 要自己拼,usage 在最后一块。明天换成 openai SDK 的 `stream=True`,看它返回的迭代器怎么把今天的解析都做掉,写 `part02/chat_stream.py`:把增量拼成完整回答、`print(piece, end="", flush=True)` 做出打字机效果、把思考和正文分开显示、兼容两家 usage 的位置、断开时也能记一笔账,再接到 Day 129 的多轮对话上。
