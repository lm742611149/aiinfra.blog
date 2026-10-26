---
title: 'Day 61 · HTTP(三):请求体、JSON 和 Content-Type'
description: '请求的最后一段:body。同样一份工单,表单格式和 JSON 格式各长什么样,Content-Type 这个头怎么告诉服务器「按哪种方式读」,忘了写它会得到什么(一个莫名其妙的 400)。写一个只收 JSON 的工单服务器,用 curl 的 -d、--json 和 @文件三种方式 POST 一段 JSON,故意发坏的 JSON 看 400、发错类型看 415,再用 Python 的 json 模块把字典变成 body、把响应变回字典。'
pubDate: 2026-10-23
regime: none
tags: ['http', 'agent-zero']
series: 'agent-zero'
day: 61
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 60](/blog/agent-zero/day-060-http-2/) 看的是响应:状态行里三位数字分五类,4 开头查自己、5 开头找服务器;301 配 `Location`,401 配 `WWW-Authenticate`;header 名字不分大小写、值分。你写的 `status_server.py` 已经会按路径回 200、301、401、403、404、500 了。

三天里有一段一直在绕着走:**body**。[Day 59](/blog/agent-zero/day-059-http-1/) 第五步 POST 了一个 `name=云簿&plan=team`,服务器只数了它有 21 字节,没真的「读懂」它;昨天 GitHub 回的 401 里有一段 `{"message": "Requires authentication", ...}`,我说「明天讲」。今天就是明天。学完这一课,一次 HTTP 请求的每一段你都亲手拆过了,后面不管是调大模型 API 还是自己写 FastAPI 服务,发出去和收回来的都是今天这种东西。

## 今天要解决的问题

学完今天,你应该能:

1. 说出 body 常见的三种格式(**表单**、**JSON**、**multipart**)各长什么样,知道前两种同一份数据怎么写,以及大模型 API、前端 `fetch` 为什么几乎只用 JSON。
2. 解释 **`Content-Type`** 这个请求头的作用:它决定服务器**按哪种方式解析 body**;能说出忘了写它、写错它分别会得到什么(我们的服务器回 400 和 415)。
3. 用 curl 的 `-d` 加 `-H`、`--json`、`@文件` 三种方式 POST 一段 JSON,读懂 `201 Created` 和带 JSON body 的 400;用 `python -m json.tool` 把响应排版。
4. 在 Python 里用 `json.dumps` 把字典变成 body、设置 `Content-Type`、用 `json.loads` 把响应变回字典,并从 `HTTPError` 里读出 JSON 格式的错误原因。

预计用时:2.5 小时。前置:[Day 39](/blog/agent-zero/day-039-json/) 的 `json.dumps` / `json.loads` / `ensure_ascii`(今天把它们用在网络上)、[Day 59](/blog/agent-zero/day-059-http-1/) 的 `echo_server.py` 和 `-d`、[Day 60](/blog/agent-zero/day-060-http-2/) 的状态码和 `HTTPError`。

学法:先对照文章逐行敲一遍(不要复制粘贴)并跑通;第二天合上文章,把「只收 JSON 的工单服务器」和「用 urllib POST JSON 的函数」默写出来;再做动手练习,做不出来再展开参考答案,看完关掉自己重写一遍。

今天不调大模型 API,花费 0 元。所有请求发给自己电脑上的服务器。代码放在 `agent-zero-lab/part01/`,在仓库根目录用 `uv run python part01/xxx.py` 运行。环境同前两天:curl `8.1.2`(`--json` 这个开关是 curl 7.82 加的,2022 年 3 月,太老的 curl 没有),Python `3.12.13`,家目录写成 `/Users/你`。最后一个小实验用了 Node `24.22.0`,只是为了对比 JS 的 `JSON.parse`,没有 Node 的话看输出就行。**没实跑的**:浏览器里 `fetch` 的那段 JS(放在文中做对照,没在页面里运行),其余全部真跑。

## 从你熟悉的地方讲起:fetch 里的那三行

你写过无数次这样的代码:

```js
fetch("/api/tickets", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ title: "退款没到账", amount: 89.5 }),
});
```

三行,对应今天的三个主角:`method: "POST"` 是方法(Day 59 讲过),`body: JSON.stringify(...)` 是**请求体**,`headers: { "Content-Type": ... }` 是**告诉对方 body 是什么格式**。你大概也踩过这个坑:忘了写 `Content-Type`,后端收到的是空对象,或者报一个看不懂的 400。今天要做的,就是站在服务器那一边,看这三行各自在网线上变成了什么、少一行会怎样。

## 第一步:body 有几种写法

body 就是空行后面那一段字节,HTTP 本身**不规定**它的格式。规定格式的是两边的约定,而约定是通过 `Content-Type` 头传达的。常见的三种:

| 格式 | `Content-Type` 的值 | 长什么样 | 谁在用 |
| --- | --- | --- | --- |
| 表单 | `application/x-www-form-urlencoded` | `title=退款没到账&amount=89.5`(和查询串一样的写法) | 传统 HTML `<form>` 提交;curl `-d` 的默认值 |
| JSON | `application/json` | `{"title": "退款没到账", "amount": 89.5}` | 几乎所有现代 API、前端 `fetch`、大模型 API |
| multipart | `multipart/form-data; boundary=...` | 多段,每段有自己的小头,中间用 boundary 隔开 | 上传文件 |

同一份工单,表单写法和 JSON 写法:

```text
title=退款没到账&amount=89.5
```

```text
{"title": "退款没到账", "amount": 89.5}
```

表单格式只有「键=值」的扁平结构,值全是字符串,`89.5` 到了服务器那边是 `"89.5"`,要不要转成数字服务器自己猜。JSON 有类型(数字、字符串、布尔、`null`)、能嵌套(列表、对象),`89.5` 就是数字,`"tags": ["bug", "前端"]` 就是列表。这就是 API 都用 JSON 的原因:**数据的形状能原样送达**。multipart 今天只认识一下,最后看一眼它的真容。

<figure>
<svg viewBox="0 0 640 270" role="img" aria-label="Content-Type 决定服务器怎么读 body:同一段字节,头写 application/x-www-form-urlencoded 时走 parse_qs 拆成键值;头写 application/json 时走 json.loads 变成字典;头写别的时回 415">
<rect x="0" y="0" width="640" height="270" fill="var(--paper-raised)" rx="6"/>
<g font-family="var(--font-mono)" font-size="12">
<rect x="16" y="20" width="230" height="110" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="131" y="42" text-anchor="middle" fill="var(--ink)">请求</text>
<text x="28" y="66" fill="var(--ink-soft)" font-size="11">POST /tickets HTTP/1.1</text>
<text x="28" y="84" fill="var(--ink)" font-size="11">Content-Type: ???</text>
<text x="28" y="102" fill="var(--ink-soft)" font-size="11">Content-Length: 41</text>
<text x="28" y="122" fill="var(--ink-soft)" font-size="11">(空行) + 41 个字节</text>
<rect x="394" y="20" width="230" height="40" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="509" y="45" text-anchor="middle" fill="var(--ink)" font-size="11">application/json → json.loads</text>
<rect x="394" y="76" width="230" height="40" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="509" y="101" text-anchor="middle" fill="var(--ink)" font-size="11">x-www-form-urlencoded → parse_qs</text>
<rect x="394" y="132" width="230" height="40" rx="4" fill="var(--paper-raised)" stroke="var(--rule)" stroke-dasharray="4 3"/>
<text x="509" y="157" text-anchor="middle" fill="var(--ink-soft)" font-size="11">其他 → 415 Unsupported Media Type</text>
<line x1="246" y1="84" x2="394" y2="40" stroke="var(--ink-soft)"/>
<line x1="246" y1="84" x2="394" y2="96" stroke="var(--ink-soft)"/>
<line x1="246" y1="84" x2="394" y2="152" stroke="var(--ink-soft)" stroke-dasharray="4 3"/>
<text x="16" y="208" fill="var(--ink)">同一段字节,读法由 Content-Type 决定</text>
<text x="16" y="230" fill="var(--ink-soft)" font-size="11">头写错 → 按错的方式读 → 得到空字典或乱码,服务器回 400</text>
<text x="16" y="250" fill="var(--ink-soft)" font-size="11">头不认识 → 服务器拒绝读,回 415</text>
</g>
</svg>
<figcaption>服务器收到的只是一串字节,先看 Content-Type 再决定用哪把钥匙去开。</figcaption>
</figure>

## 第二步:一个只收 JSON(和表单)的工单服务器

把 Day 59 的 `echo_server.py` 和昨天的 `status_server.py` 合起来,做一个真的「读懂」body 的服务器。新建 `agent-zero-lab/part01/json_server.py`:

```python
# agent-zero-lab/part01/json_server.py
import json
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import parse_qs

HOST = "127.0.0.1"
PORT = 8765

tickets: list[dict[str, object]] = []


class JsonHandler(BaseHTTPRequestHandler):
    def _send_json(self, code: int, payload: object) -> None:
        data = json.dumps(payload, ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _read_body(self) -> bytes:
        length = int(self.headers.get("Content-Length", "0"))
        return self.rfile.read(length)

    def do_GET(self) -> None:
        if self.path == "/tickets":
            self._send_json(200, tickets)
        else:
            self._send_json(404, {"error": f"没有 {self.path}"})

    def do_POST(self) -> None:
        if self.path != "/tickets":
            self._send_json(404, {"error": f"没有 {self.path}"})
            return
        ctype = self.headers.get("Content-Type", "")
        raw = self._read_body()
        print(f"Content-Type: {ctype!r}, body: {raw!r}", flush=True)
        if ctype.startswith("application/json"):
            try:
                data = json.loads(raw)
            except json.JSONDecodeError as e:
                self._send_json(400, {"error": f"body 不是合法的 JSON: {e}"})
                return
        elif ctype.startswith("application/x-www-form-urlencoded"):
            form = parse_qs(raw.decode())
            data = {k: v[0] for k, v in form.items()}
        else:
            self._send_json(415, {"error": f"不认识的 Content-Type: {ctype!r}"})
            return
        if not isinstance(data, dict) or "title" not in data:
            self._send_json(400, {"error": "缺少 title 字段", "received": data})
            return
        ticket = {"id": len(tickets) + 1, **data}
        tickets.append(ticket)
        self._send_json(201, ticket)

    def log_message(self, format: str, *args: object) -> None:
        pass


if __name__ == "__main__":
    print(f"监听 http://{HOST}:{PORT},Ctrl+C 退出", flush=True)
    HTTPServer((HOST, PORT), JsonHandler).serve_forever()
```

<div class="line-notes">

- `import json` Day 39 的 `json` 模块,今天它的工作从「读写文件」变成「读写网络」。
- `from urllib.parse import parse_qs` Day 59 拆查询串用的函数,表单 body 和查询串是同一种写法,所以拆法也一样。
- `tickets: list[dict[str, object]] = []` 存工单的列表,放在模块里,服务器开着期间一直在,关掉就没了(明天复习日会把它存进文件)。类型标注说「列表里每一项是键为字符串、值随便的字典」。
- `class JsonHandler(BaseHTTPRequestHandler):` 老样子。
- `def _send_json(self, code: int, payload: object) -> None:` 回一个 JSON 响应。`payload` 是任何能变成 JSON 的东西:字典、列表。
- `data = json.dumps(payload, ensure_ascii=False).encode()` 两步:`json.dumps` 把 Python 对象变成 JSON **字符串**,`ensure_ascii=False` 让中文保持中文而不是 `退`(Day 39 讲过);`.encode()` 再把字符串变成 UTF-8 **字节**。网线上只能传字节。
- `self.send_header("Content-Type", "application/json; charset=utf-8")` **响应**也有 `Content-Type`,告诉客户端「我回的是 JSON」。昨天回的是 `text/plain`,今天换了。
- `self.send_header("Content-Length", str(len(data)))` 字节数。
- `def _read_body(self) -> bytes:` 和 Day 59 一样按 `Content-Length` 读 body,返回字节。
- `length = int(self.headers.get("Content-Length", "0"))` 没有这个头就当 0 字节。
- `def do_GET(self) -> None:` GET `/tickets` 回整个列表。
- `self._send_json(200, tickets)` 列表直接丢给 `json.dumps`,出来是 `[{...}, {...}]`。
- `self._send_json(404, {"error": f"没有 {self.path}"})` 404 也回 JSON。**错误也用 JSON 说**,这样客户端用同一套办法读成功和失败的响应。
- `def do_POST(self) -> None:` 今天的重点。
- `ctype = self.headers.get("Content-Type", "")` 取请求头 `Content-Type`,没有就是空字符串。
- `raw = self._read_body()` 先把 body 的字节读出来,这时还不知道它是什么格式。
- `print(f"Content-Type: {ctype!r}, body: {raw!r}", flush=True)` 在服务器这边打印一下收到的原始头和字节,等会儿你会看到 `raw` 是 `b'{"title":"\xe9\x80\x80...'` 这种样子,因为它是字节。
- `if ctype.startswith("application/json"):` **按头选钥匙**。用 `startswith` 而不是 `==`,因为客户端可能写 `application/json; charset=utf-8`,带着参数。
- `data = json.loads(raw)` JSON 这把钥匙:`json.loads` 可以直接吃字节(它自己按 UTF-8 解码),得到字典或列表。
- `except json.JSONDecodeError as e:` body 不是合法的 JSON 时 `json.loads` 抛这个异常(Day 39 的 `bad.json` 就是它),我们把它翻译成 400。
- `self._send_json(400, {"error": f"body 不是合法的 JSON: {e}"})` 400 Bad Request:请求格式不对,是客户端的错。把 `json` 模块的报错原文附上,客户端一看就知道第几个字符错了。
- `elif ctype.startswith("application/x-www-form-urlencoded"):` 表单这把钥匙。
- `form = parse_qs(raw.decode())` 先把字节解码成字符串,再用 `parse_qs` 拆成 `{'title': ['...'], 'amount': ['89.5']}`,值是列表(Day 59 讲过原因)。
- `data = {k: v[0] for k, v in form.items()}` 字典推导(Day 23)把每个列表取第一项,变成 `{'title': '...', 'amount': '89.5'}`。注意 `'89.5'` 是字符串。
- `else:` 两把钥匙都不对。
- `self._send_json(415, {"error": f"不认识的 Content-Type: {ctype!r}"})` 415 Unsupported Media Type,昨天表上的那个。
- `if not isinstance(data, dict) or "title" not in data:` 读出来了,再检查形状:必须是字典,且有 `title`。JSON 的顶层也可以是列表或数字,`json.loads("[1, 2, 3]")` 完全合法,所以要查 `isinstance`。
- `self._send_json(400, {"error": "缺少 title 字段", "received": data})` 还是 400,把服务器「以为自己收到的东西」一起回去,排查时特别有用。
- `ticket = {"id": len(tickets) + 1, **data}` 造一个新字典:编号是「现有数量加一」,后面 `**data` 把客户端发的字段展开进来(`**` 在字典字面量里的意思是「把那个字典的键值对铺进来」,Day 52 用过)。
- `tickets.append(ticket)` 存起来。
- `self._send_json(201, ticket)` **201 Created**:创建成功。body 回新建的工单,带上服务器分配的 `id`,客户端以后用这个 id 来找它。
- `HTTPServer((HOST, PORT), JsonHandler).serve_forever()` 启动。

</div>

终端 1(关掉昨天的服务器,它也占着 8765):

```bash
cd ~/agent-zero-lab
uv run python part01/json_server.py
```

## 第三步:忘了写 Content-Type 会怎样

先踩坑。终端 2,照 Day 59 的习惯用 `-d` 发一段 JSON:

```bash
curl -i -d '{"title":"退款没到账","amount":89.5}' http://127.0.0.1:8765/tickets
```

<div class="line-notes">

- `curl -i -d '{"title":"退款没到账","amount":89.5}' http://127.0.0.1:8765/tickets` body 用**单引号**括起来,因为 JSON 里面全是双引号,单引号里的双引号在 shell 里不用转义。`-d` 自动把方法变成 POST。

</div>

实测输出:

```text
HTTP/1.0 400 Bad Request
Server: BaseHTTP/0.6 Python/3.12.13
Date: Fri, 23 Oct 2026 08:25:18 GMT
Content-Type: application/json; charset=utf-8
Content-Length: 48

{"error": "缺少 title 字段", "received": {}}
```

400,「缺少 title 字段」,而且服务器说它收到的是**空字典** `{}`。可我们明明发了 `title`。看终端 1 打印的那一行:

```text
Content-Type: 'application/x-www-form-urlencoded', body: b'{"title":"\xe9\x80\x80\xe6\xac\xbe\xe6\xb2\xa1\xe5\x88\xb0\xe8\xb4\xa6","amount":89.5}'
```

body 是对的(`\xe9\x80\x80` 就是「退」的三个字节),但 `Content-Type` 是 `application/x-www-form-urlencoded`:Day 59 说过,**`-d` 默认按表单格式发**,curl 自动补了这个头。服务器照头办事,用 `parse_qs` 去拆一段 JSON 文本,里面没有一个 `=`,拆出来自然是空字典。它没有撒谎,它只是按你说的方式读了。

**这就是前端最常见的那个「后端收到空对象」的 bug。** 不是数据没发出去,是 `Content-Type` 没对上。修法:把头写对。

```bash
curl -i -H "Content-Type: application/json" -d '{"title":"退款没到账","amount":89.5}' http://127.0.0.1:8765/tickets
```

<div class="line-notes">

- `curl -i -H "Content-Type: application/json" -d '{"title":"退款没到账","amount":89.5}' http://127.0.0.1:8765/tickets` 用 `-H` 显式指定 `Content-Type`,它会覆盖 `-d` 默认补的那个。

</div>

实测输出:

```text
HTTP/1.0 201 Created
Server: BaseHTTP/0.6 Python/3.12.13
Date: Fri, 23 Oct 2026 08:25:18 GMT
Content-Type: application/json; charset=utf-8
Content-Length: 53

{"id": 1, "title": "退款没到账", "amount": 89.5}
```

`201 Created`,body 是新建的工单,多了一个服务器分配的 `"id": 1`,`amount` 还是数字 `89.5`(没有引号)。终端 1 那一行现在是 `Content-Type: 'application/json'`,body 字节和刚才一模一样。**同样的字节,换一个头,结果从 400 变成 201。**

## 第四步:curl 的 --json

每次都写 `-H "Content-Type: application/json"` 太啰嗦,curl 7.82 起有一个专门的开关:

```bash
curl -i --json '{"title":"发票抬头写错","amount":0}' http://127.0.0.1:8765/tickets
```

<div class="line-notes">

- `curl -i --json '{"title":"发票抬头写错","amount":0}' http://127.0.0.1:8765/tickets` `--json` 等于 `-d` 加两个头:`Content-Type: application/json` 和 `Accept: application/json`,并且方法是 POST。

</div>

实测输出:

```text
HTTP/1.0 201 Created
Server: BaseHTTP/0.6 Python/3.12.13
Date: Fri, 23 Oct 2026 08:25:18 GMT
Content-Type: application/json; charset=utf-8
Content-Length: 53

{"id": 2, "title": "发票抬头写错", "amount": 0}
```

同一条命令加 `-v` 再发一遍(它会再登记一张,id 变成 3),看 `>` 开头的行:

```text
> POST /tickets HTTP/1.1
> Host: 127.0.0.1:8765
> User-Agent: curl/8.1.2
> Content-Type: application/json
> Accept: application/json
> Content-Length: 41
> 
```

`--json` 补的两个头都在。`Accept: application/json` 是昨天表里的那个请求头:「我希望你回 JSON」。我们的服务器不看它,永远回 JSON;正经的 API 会看,同一个地址按 `Accept` 决定回 JSON 还是 HTML。`Content-Length: 41` 是这段 JSON 的字节数:`{"title":"发票抬头写错","amount":0}` 共 23 个字符,其中 6 个汉字各多占 2 字节,23 + 12 = 35?数一下字符:`{"title":"` 10 个,`发票抬头写错` 6 个,`","amount":0}` 13 个,合计 29 个字符,汉字多 12 字节,29 + 12 = 41。对了。

从现在起,文中 POST JSON 一律用 `--json`。

## 第五步:故意发坏的 JSON

400 真正常见的来源是 JSON 本身写错了。两个高频错误:单引号,和尾部多一个逗号(JS 对象字面量允许,JSON 不允许)。

```bash
curl -i --json "{'title': '单引号'}" http://127.0.0.1:8765/tickets
curl --json '{"title": "尾逗号",}' http://127.0.0.1:8765/tickets
curl --json '{"amount": 5}' http://127.0.0.1:8765/tickets
curl --json '[1, 2, 3]' http://127.0.0.1:8765/tickets
```

<div class="line-notes">

- `curl -i --json "{'title': '单引号'}" http://127.0.0.1:8765/tickets` body 用了单引号,所以外面换成双引号括。JSON 规范只认双引号。
- `curl --json '{"title": "尾逗号",}' http://127.0.0.1:8765/tickets` 最后一个键值对后面多了个逗号。
- `curl --json '{"amount": 5}' http://127.0.0.1:8765/tickets` JSON 合法,但缺 `title`。
- `curl --json '[1, 2, 3]' http://127.0.0.1:8765/tickets` JSON 合法,但顶层是列表不是对象。

</div>

实测输出:

```text
HTTP/1.0 400 Bad Request
Server: BaseHTTP/0.6 Python/3.12.13
Date: Fri, 23 Oct 2026 08:25:18 GMT
Content-Type: application/json; charset=utf-8
Content-Length: 115

{"error": "body 不是合法的 JSON: Expecting property name enclosed in double quotes: line 1 column 2 (char 1)"}
```

```text
{"error": "body 不是合法的 JSON: Expecting property name enclosed in double quotes: line 1 column 17 (char 16)"}
```

```text
{"error": "缺少 title 字段", "received": {"amount": 5}}
```

```text
{"error": "缺少 title 字段", "received": [1, 2, 3]}
```

四个都是 400,但原因不同。前两个是 `json.loads` 抛出来的 `JSONDecodeError`,报错原文很具体:「期望一个用双引号括起来的属性名,第 1 行第 2 列」。第一条第 2 列正是那个单引号;第二条第 17 列是 `}`,因为尾逗号之后 JSON 期望下一个属性名,等来的却是右花括号。后两个 JSON 本身没问题,是**形状**不对,服务器把它收到的东西原样回给你,`received` 一看就明白。

写 API 的时候,400 的 body 里把「哪里错了」说清楚,能省下客户端一半的排查时间。你以后调大模型 API 收到的 400 也都长这样,会告诉你 `messages[0].role` 不合法之类的。

## 第六步:表单和不认识的类型

两把钥匙里的另一把,和一把都不是的:

```bash
curl -i -d "title=表单来的&amount=10" http://127.0.0.1:8765/tickets
curl -i -H "Content-Type: text/plain" -d "hello" http://127.0.0.1:8765/tickets
```

<div class="line-notes">

- `curl -i -d "title=表单来的&amount=10" http://127.0.0.1:8765/tickets` 真的表单格式,`-d` 默认的头这次对了。
- `curl -i -H "Content-Type: text/plain" -d "hello" http://127.0.0.1:8765/tickets` 头说是纯文本,服务器没有这把钥匙。

</div>

实测输出:

```text
HTTP/1.0 201 Created
Server: BaseHTTP/0.6 Python/3.12.13
Date: Fri, 23 Oct 2026 08:25:18 GMT
Content-Type: application/json; charset=utf-8
Content-Length: 50

{"id": 4, "title": "表单来的", "amount": "10"}
```

```text
HTTP/1.0 415 Unsupported Media Type
Server: BaseHTTP/0.6 Python/3.12.13
Date: Fri, 23 Oct 2026 08:25:18 GMT
Content-Type: application/json; charset=utf-8
Content-Length: 52

{"error": "不认识的 Content-Type: 'text/plain'"}
```

表单那条成功了,但注意 `"amount": "10"`,**带引号**,是字符串。表单格式没有类型,服务器只能收到文本。前面 JSON 发的 `"amount": 89.5` 是数字。这就是为什么 API 用 JSON:你发什么类型,对方收到什么类型。

第二条 415:服务器不认识这个 `Content-Type`,直接拒绝,连 body 都不去读。昨天表里 415 的位置就是留给今天的。

## 第七步:把列表取回来

现在服务器里有四张工单(id 1 到 4;如果你跟着我用 `-v` 多发了一次就是四张,否则是三张)。GET 回来看看:

```bash
curl http://127.0.0.1:8765/tickets
curl -s http://127.0.0.1:8765/tickets | uv run python -m json.tool --no-ensure-ascii
```

<div class="line-notes">

- `curl http://127.0.0.1:8765/tickets` 普通 GET,body 是一整行 JSON。
- `curl -s http://127.0.0.1:8765/tickets | uv run python -m json.tool --no-ensure-ascii` 把 curl 的输出用管道交给 Python 自带的 `json.tool`,它负责缩进排版;`--no-ensure-ascii` 让中文正常显示。相当于浏览器 Network 面板里 Preview 页签做的事。

</div>

实测输出:

```text
[{"id": 1, "title": "退款没到账", "amount": 89.5}, {"id": 2, "title": "发票抬头写错", "amount": 0}, {"id": 3, "title": "发票抬头写错", "amount": 0}, {"id": 4, "title": "表单来的", "amount": "10"}]
```

```text
[
    {
        "id": 1,
        "title": "退款没到账",
        "amount": 89.5
    },
    {
        "id": 2,
        "title": "发票抬头写错",
        "amount": 0
    },
    {
        "id": 3,
        "title": "发票抬头写错",
        "amount": 0
    },
    {
        "id": 4,
        "title": "表单来的",
        "amount": "10"
    }
]
```

排版后一眼能看到:三张 JSON 来的工单 `amount` 是数字,表单来的那张是字符串 `"10"`。`curl -i` 看这条响应的头,`Content-Type: application/json; charset=utf-8`、`Content-Length: 217`,响应侧的 `Content-Type` 在告诉客户端「拿 JSON 的方式读我」。

## 第八步:Python 发 JSON、收 JSON

回到你以后真正写的东西。新建 `agent-zero-lab/part01/send_json.py`,把「POST 一个字典、拿回一个字典」包成函数:

```python
# agent-zero-lab/part01/send_json.py
import json
from urllib.error import HTTPError
from urllib.request import Request, urlopen

BASE = "http://127.0.0.1:8765"


def post_json(path: str, payload: object) -> tuple[int, object]:
    body = json.dumps(payload, ensure_ascii=False).encode()
    req = Request(
        f"{BASE}{path}",
        data=body,
        method="POST",
        headers={"Content-Type": "application/json; charset=utf-8"},
    )
    try:
        with urlopen(req) as resp:
            return resp.status, json.loads(resp.read())
    except HTTPError as e:
        return e.code, json.loads(e.read())


def get_json(path: str) -> tuple[int, object]:
    with urlopen(f"{BASE}{path}") as resp:
        return resp.status, json.loads(resp.read())


if __name__ == "__main__":
    print(post_json("/tickets", {"title": "登录后白屏", "amount": 0, "tags": ["bug", "前端"]}))
    print(post_json("/tickets", {"amount": 12}))
    code, data = get_json("/tickets")
    print(code, type(data).__name__, len(data) if isinstance(data, list) else data)
    if isinstance(data, list):
        for t in data:
            print("  ", t["id"], t["title"], type(t["amount"]).__name__)
```

<div class="line-notes">

- `import json` 客户端这边同样靠它。
- `from urllib.error import HTTPError` 昨天学的:4xx/5xx 是异常。
- `def post_json(path: str, payload: object) -> tuple[int, object]:` 输入路径和要发的 Python 对象,返回「状态码、解析后的响应」两项的元组(Day 22)。
- `body = json.dumps(payload, ensure_ascii=False).encode()` 和服务器 `_send_json` 里完全对称的两步:对象 → JSON 字符串 → UTF-8 字节。这就是 `JSON.stringify` 加上「变成字节」。
- `req = Request(` 构造请求。
- `data=body,` body 字节。
- `method="POST",` 方法。
- `headers={"Content-Type": "application/json; charset=utf-8"},` **就是 fetch 里那一行**。不写的话 `urllib` 会和 curl 一样默认补 `application/x-www-form-urlencoded`,Day 59 第六步的输出里你已经见过它补的样子,后果就是第三步的那个 400。
- `with urlopen(req) as resp:` 发出去,2xx 走这里。
- `return resp.status, json.loads(resp.read())` `resp.read()` 是响应 body 的字节,`json.loads` 直接吃字节变成字典。这是 `await resp.json()`。
- `except HTTPError as e:` 4xx/5xx。
- `return e.code, json.loads(e.read())` 错误响应的 body 也是 JSON(服务器设计成这样了),同样解析,把 `error` 和 `received` 带回来。
- `def get_json(path: str) -> tuple[int, object]:` GET 版本,不带 body,所以不用 `Request`,直接把地址给 `urlopen`。
- `print(post_json("/tickets", {"title": "登录后白屏", "amount": 0, "tags": ["bug", "前端"]}))` 发一张带列表字段的工单,看嵌套结构能不能原样到达。
- `print(post_json("/tickets", {"amount": 12}))` 发一张缺 `title` 的,看 400 的 body 能不能读出来。
- `code, data = get_json("/tickets")` 取回列表,元组解包(Day 22)。
- `print(code, type(data).__name__, len(data) if isinstance(data, list) else data)` 打印状态码、类型名、条数。
- `if isinstance(data, list):` 检查器要求先确认是列表才能遍历,也是对的:万一服务器回了别的东西呢。
- `print("  ", t["id"], t["title"], type(t["amount"]).__name__)` 每张工单打印 `amount` 的类型,验证前面说的「JSON 保留类型,表单不保留」。

</div>

运行(服务器还开着,里面已经有 4 张):

```bash
uv run python part01/send_json.py
```

实测输出:

```text
(201, {'id': 5, 'title': '登录后白屏', 'amount': 0, 'tags': ['bug', '前端']})
(400, {'error': '缺少 title 字段', 'received': {'amount': 12}})
200 list 5
   1 退款没到账 float
   2 发票抬头写错 int
   3 发票抬头写错 int
   4 表单来的 str
   5 登录后白屏 int
```

第一行:201,`tags` 列表原样回来了,中文没有变成 `\u` 转义(因为两边都 `ensure_ascii=False`)。第二行:400 没有让脚本崩,错误原因从 `HTTPError` 的 body 里读了出来。最后五行:`amount` 的类型,JSON 来的是 `float` 或 `int`(Python 的 `json` 按有没有小数点区分),表单来的是 `str`。

终端 1 对应的两行:

```text
Content-Type: 'application/json; charset=utf-8', body: b'{"title": "\xe7\x99\xbb\xe5\xbd\x95\xe5\x90\x8e\xe7\x99\xbd\xe5\xb1\x8f", "amount": 0, "tags": ["bug", "\xe5\x89\x8d\xe7\xab\xaf"]}'
Content-Type: 'application/json; charset=utf-8', body: b'{"amount": 12}'
```

注意 `Content-Type` 的值带着 `; charset=utf-8`,这就是服务器里用 `startswith` 而不是 `==` 的原因。还有 body 里 `"bug"` 和 `"amount"` 这种英文原样可读,中文全是 `\xe7\x99\xbb` 这样的字节,`ensure_ascii=False` 管的是「不要写成 `登` 这种 JSON 转义」,到了字节这一层中文本来就是三个字节一个字。

把三种客户端放一起看,它们发出去的东西是一回事:

| | 浏览器 `fetch` | curl | Python `urllib` |
| --- | --- | --- | --- |
| 方法 | `method: "POST"` | `--json` 自动 / `-X POST` | `method="POST"` |
| 头 | `headers: {"Content-Type": "application/json"}` | `--json` 自动 / `-H` | `headers={"Content-Type": ...}` |
| body | `JSON.stringify(obj)` | 直接写字符串 | `json.dumps(obj).encode()` |
| 读响应 | `await resp.json()` | 肉眼 / `json.tool` | `json.loads(resp.read())` |
| 4xx | `resp.ok` 为 false,不抛 | 退出码 0(`-f` 才 22) | 抛 `HTTPError` |

## 第九步:从文件发,以及 multipart 长什么样

两个小补充。body 长了不想写在命令行里,放进文件,用 `@`:

```bash
printf '{"title": "从文件来的工单", "amount": 199.0}\n' > part01/data/ticket.json
curl --json @part01/data/ticket.json http://127.0.0.1:8765/tickets
```

<div class="line-notes">

- `printf '{"title": "从文件来的工单", "amount": 199.0}\n' > part01/data/ticket.json` 写一个 JSON 文件(Day 5 的重定向 `>`)。
- `curl --json @part01/data/ticket.json http://127.0.0.1:8765/tickets` `@` 开头表示「从这个文件读 body」。`-d @文件` 也一样。

</div>

实测输出:

```text
{"id": 6, "title": "从文件来的工单", "amount": 199.0}
```

然后看一眼 multipart。把 `json_server.py` 关掉,启动 Day 59 的 `echo_server.py`(它会原样打印 body),用 `-F` 发一个字段加一个文件:

```bash
printf 'hello\n' > /tmp/note.txt
curl -F "title=带附件" -F "file=@/tmp/note.txt" http://127.0.0.1:8765/upload
```

<div class="line-notes">

- `printf 'hello\n' > /tmp/note.txt` 造一个 6 字节的小文件当附件。
- `curl -F "title=带附件" -F "file=@/tmp/note.txt" http://127.0.0.1:8765/upload` `-F` 是 form:按 multipart 格式发,每个 `-F` 是一段;`@` 在这里表示「这一段的内容是文件」。

</div>

`echo_server.py` 那边打印的(body 我换了行方便看):

```text
请求行: POST /upload HTTP/1.1
--- header ---
Host: 127.0.0.1:8765
User-Agent: curl/8.1.2
Accept: */*
Content-Length: 295
Content-Type: multipart/form-data; boundary=------------------------0dc5885e40e9f7ff
--- body ---
'--------------------------0dc5885e40e9f7ff\r\nContent-Disposition: form-data; name="title"\r\n\r\n带附件\r\n
--------------------------0dc5885e40e9f7ff\r\nContent-Disposition: form-data; name="file"; filename="note.txt"\r\nContent-Type: text/plain\r\n\r\nhello\n\r\n
--------------------------0dc5885e40e9f7ff--\r\n'
```

`Content-Type` 里多了一个 `boundary=` 参数,是一串随机字符;body 被它切成两段,每段自己带小头(`Content-Disposition` 说字段名和文件名,文件那段还有自己的 `Content-Type`),最后一段结尾多两个横线。这种格式就是为「一次请求里既有文字又有文件」设计的。今天认识就行,解析它的代码不用写,以后 FastAPI 一行 `UploadFile` 搞定。关掉 `echo_server.py`。

## 零件对照表

| 零件 | 做什么 | 在哪里用到 |
| --- | --- | --- |
| `Content-Type` 请求头 | 告诉服务器按哪种格式读 body | 全篇 |
| `Content-Type` 响应头 | 告诉客户端按哪种格式读响应 | `_send_json` |
| `application/json` / `application/x-www-form-urlencoded` / `multipart/form-data` | 三种 body 格式的名字 | 第一步、第九步 |
| `json.dumps(obj, ensure_ascii=False).encode()` | 对象 → JSON 字符串 → 字节 | 服务器 `_send_json`、客户端 `post_json` |
| `json.loads(bytes)` | 字节 → 对象(自带 UTF-8 解码) | 服务器 `do_POST`、客户端两个函数 |
| `json.JSONDecodeError` | body 不是合法 JSON | `do_POST` → 400 |
| `ctype.startswith("application/json")` | 带参数的 `Content-Type` 也能匹配 | `do_POST` |
| `parse_qs(raw.decode())` | 拆表单 body | `do_POST` |
| `isinstance(data, dict)` | 检查 JSON 顶层形状 | `do_POST`、`send_json.py` |
| `201` / `400` / `415` | 创建成功 / 请求格式错 / body 类型不认 | `do_POST` |
| `curl -d` + `-H "Content-Type: application/json"` | 手动指定格式 | 第三步 |
| `curl --json` | 自动加 `Content-Type` 和 `Accept` | 第四步起 |
| `curl -d @文件` / `--json @文件` | body 从文件读 | 第九步 |
| `curl -F` | multipart | 第九步 |
| `python -m json.tool --no-ensure-ascii` | 把一行 JSON 排版 | 第七步 |
| `Request(url, data=, method=, headers=)` | Python 构造带 body 的请求 | `post_json` |
| `e.read()` | 从 `HTTPError` 读错误响应的 body | `post_json` |

## 动手练习

### 练习 1:算清 JSON body 的字节数

写 `part01/ex61_roundtrip.py`:对工单 `{"title": "退款没到账", "amount": 89.5, "tags": ["账单", "P1"]}` 分别用 `ensure_ascii=True` 和 `False` 做 `json.dumps`,打印两种结果、各自的字符数和字节数;再把 `False` 那份 `.encode()` 后用 `json.loads` 解回来,验证和原来相等、`amount` 和 `tags` 的类型没变。最后打印 `json.dumps({"x": float("inf"), "y": float("nan")})`,看 Python 会输出什么。

<details>
<summary>参考答案</summary>

```python
# agent-zero-lab/part01/ex61_roundtrip.py
import json

ticket = {"title": "退款没到账", "amount": 89.5, "tags": ["账单", "P1"]}

escaped = json.dumps(ticket)
raw = json.dumps(ticket, ensure_ascii=False)
print("ensure_ascii=True :", escaped)
print("ensure_ascii=False:", raw)
print("字符数 :", len(escaped), len(raw))
print("字节数 :", len(escaped.encode()), len(raw.encode()))

back = json.loads(raw.encode())
print("解回来一样吗:", back == ticket, type(back["amount"]).__name__, type(back["tags"]).__name__)
print("Python 独有的值:", json.dumps({"x": float("inf"), "y": float("nan")}))
```

<div class="line-notes">

- `escaped = json.dumps(ticket)` 默认 `ensure_ascii=True`,中文变成 `退` 这种转义,结果全是 ASCII 字符。
- `raw = json.dumps(ticket, ensure_ascii=False)` 中文保持中文。
- `print("字符数 :", len(escaped), len(raw))` `len` 数的是字符。
- `print("字节数 :", len(escaped.encode()), len(raw.encode()))` `.encode()` 之后 `len` 数的是字节。转义版全是 ASCII,字符数等于字节数;原样版每个汉字 3 字节。
- `back = json.loads(raw.encode())` 字节直接给 `json.loads`。
- `print("解回来一样吗:", back == ticket, type(back["amount"]).__name__, type(back["tags"]).__name__)` 字典相等比较(Day 24),外加两个字段的类型名。
- `print("Python 独有的值:", json.dumps({"x": float("inf"), "y": float("nan")}))` 无穷大和「不是数」。

</div>

运行 `uv run python part01/ex61_roundtrip.py`,实测输出:

```text
ensure_ascii=True : {"title": "退款没到账", "amount": 89.5, "tags": ["账单", "P1"]}
ensure_ascii=False: {"title": "退款没到账", "amount": 89.5, "tags": ["账单", "P1"]}
字符数 : 91 56
字节数 : 91 70
解回来一样吗: True float list
Python 独有的值: {"x": Infinity, "y": NaN}
```

转义版 91 个字符就是 91 字节;原样版 56 个字符里有 7 个汉字,56 + 7 × 2 = 70 字节。两种写法解回来都是同一个字典,所以发给服务器哪种都行,原样版更短也更好读。最后一行是个坑:`Infinity` 和 `NaN` **不是** JSON 标准里的东西,Python 的 `json` 默认会写出来、也能读回去,但别的语言不认。我用 Node 试了 `JSON.parse('{"amount": Infinity}')`,报 `Unexpected token 'I', "{"amount": Infinity}" is not valid JSON`。要和前端交换数据,无穷大和 NaN 得先换成 `null` 或字符串。

</details>

### 练习 2:批量导入,统计状态码

写 `part01/data/batch.json`,里面是一个列表,混进两条坏的(一条缺 `title`、一条根本不是对象);写 `part01/ex61_batch.py`,导入 `send_json.py` 里的 `post_json`,逐条 POST,打印每条的状态码和响应,最后统计各状态码的条数。

<details>
<summary>参考答案</summary>

```json
[
  {"title": "退款没到账", "amount": 89.5},
  {"amount": 12},
  {"title": "发票抬头写错", "amount": 0},
  "不是对象的一行"
]
```

```python
# agent-zero-lab/part01/ex61_batch.py
import json
from pathlib import Path

from send_json import post_json

rows = json.loads(Path("part01/data/batch.json").read_text(encoding="utf-8"))
counts: dict[int, int] = {}
for row in rows:
    code, data = post_json("/tickets", row)
    counts[code] = counts.get(code, 0) + 1
    print(code, data)
print("统计:", counts)
```

<div class="line-notes">

- `from send_json import post_json` 从同目录的 `send_json.py` 导入函数。它的演示代码在 `if __name__ == "__main__"` 下面,导入时不会执行。从仓库根目录运行时 `part01/` 会被加进模块搜索路径,所以直接写模块名。
- `rows = json.loads(Path("part01/data/batch.json").read_text(encoding="utf-8"))` 读文件(Day 37 的 `Path`)再解析,路径相对于仓库根目录。
- `counts: dict[int, int] = {}` 状态码 → 条数。
- `code, data = post_json("/tickets", row)` 每一行发一次。
- `counts[code] = counts.get(code, 0) + 1` Day 24 的计数套路。

</div>

重启 `json_server.py`(让列表清空),运行 `uv run python part01/ex61_batch.py`,实测输出:

```text
201 {'id': 1, 'title': '退款没到账', 'amount': 89.5}
400 {'error': '缺少 title 字段', 'received': {'amount': 12}}
201 {'id': 2, 'title': '发票抬头写错', 'amount': 0}
400 {'error': '缺少 title 字段', 'received': '不是对象的一行'}
统计: {201: 2, 400: 2}
```

第四条的 `received` 是一个字符串,服务器里 `isinstance(data, dict)` 把它拦下了。坏数据没有让脚本中断,也没有混进服务器,因为服务器在门口检查、客户端把 4xx 当成正常返回值处理。

</details>

### 练习 3:只看 -v,判断 body 发对了没

不看服务器的响应,只用 `curl -v` 的 `>` 行,判断下面两条命令各会得到 201 还是 400,说明依据,然后发出去验证。

```bash
curl -v -d '{"title":"A"}' http://127.0.0.1:8765/tickets
curl -v --json '{"title":"B"}' http://127.0.0.1:8765/tickets
```

<details>
<summary>参考答案</summary>

第一条的 `>` 行里会有 `Content-Type: application/x-www-form-urlencoded`(`-d` 默认补的),服务器会用 `parse_qs` 去拆 `{"title":"A"}`,拆出空字典,**400**。第二条的 `>` 行里是 `Content-Type: application/json`,**201**。实测第一条的关键行:

```text
> POST /tickets HTTP/1.1
> Content-Length: 13
> Content-Type: application/x-www-form-urlencoded
< HTTP/1.0 400 Bad Request
```

第二条:

```text
> POST /tickets HTTP/1.1
> Content-Type: application/json
> Accept: application/json
> Content-Length: 13
< HTTP/1.0 201 Created
```

依据只有一个:`Content-Type` 那一行。body 的字节一模一样(都是 13 字节),头不同,结果不同。以后「后端说收到空对象」,第一件事就是 `-v` 看这一行。

</details>

### 练习 4:让服务器回 ensure_ascii=True 的 JSON,看客户端受不受影响

把 `json_server.py` 的 `_send_json` 里 `ensure_ascii=False` 临时改成 `True`,重启,用 curl 和 `send_json.py` 各取一次 `/tickets`,观察两边看到的中文;然后改回去。

<details>
<summary>参考答案</summary>

改完重启、发一张工单后,curl 看到的是:

```text
[{"id": 1, "title": "退款没到账", "amount": 89.5}]
```

`send_json.py` 的输出里 `title` 还是 `退款没到账`。原因:`退` 是 JSON 规定的转义写法,任何 JSON 解析器(`json.loads`、`JSON.parse`)都会把它还原成「退」。所以**对程序来说两种写法等价**,只有人肉眼看 curl 输出时转义版不好读,而且字节数更多(练习 1 算过,91 对 70)。`--no-ensure-ascii` 给 `json.tool` 也是同样的道理。改回 `False`。

</details>

### 练习 5:PUT 和 DELETE 会怎样

对 `json_server.py` 发一个 `PUT /tickets/1` 和一个 `DELETE /tickets/1`,看状态码,解释原因。不用改服务器。

<details>
<summary>参考答案</summary>

```bash
curl -s -o /dev/null -w "%{http_code}\n" -X PUT --json '{"title":"x"}' http://127.0.0.1:8765/tickets/1
curl -s -o /dev/null -w "%{http_code}\n" -X DELETE http://127.0.0.1:8765/tickets/1
```

实测输出:

```text
501
501
```

两个都是 `501 Not Implemented`,和 Day 59 发 HEAD 时一样:我们只写了 `do_GET` 和 `do_POST`,`http.server` 找不到 `do_PUT`、`do_DELETE`,就回 501。注意不是 404(路径不存在)也不是 405(路径存在但不支持这个方法),`http.server` 一律回 501。明天的小项目会补上 `DELETE`,并让它回 204。

</details>

验收标准:`json_server.py` 跑起来后,文中 400、201、415 三种结果你都能用 curl 复现,并能指着终端 1 的打印说出每次的 `Content-Type` 是什么;`send_json.py` 输出和文中一致;练习 1 到 5 的输出和参考答案一致;合上文章能写出 fetch、curl、urllib 三种客户端 POST JSON 的对照表。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 请求体(body) | 请求头之后空行后面的那段字节,格式由 `Content-Type` 说明 |
| `Content-Type` | 请求和响应都有的头,说 body 是什么格式;服务器据此决定怎么解析 |
| MIME 类型 | `Content-Type` 值的正式名称,形如 `大类/小类`,如 `application/json`、`text/plain` |
| `application/json` | body 是 JSON 文本 |
| `application/x-www-form-urlencoded` | body 是 `键=值&键=值`,和查询串一样的写法;`-d` 的默认值 |
| `multipart/form-data` | body 分多段、用 `boundary` 隔开,用于上传文件 |
| `charset=utf-8` | `Content-Type` 的参数,说文本用什么编码 |
| `Accept` | 请求头,客户端希望收到什么格式的响应 |
| `201 Created` | 创建成功,body 通常是新建的那条记录 |
| `400 Bad Request` | 请求格式不对:JSON 写坏了、缺字段、形状不对 |
| `415 Unsupported Media Type` | 服务器不认识请求的 `Content-Type` |
| `501 Not Implemented` | 服务器没实现这个方法 |
| `json.dumps` / `json.loads` | 对象 → JSON 字符串 / JSON(字符串或字节)→ 对象 |
| `ensure_ascii` | `dumps` 的参数,`False` 让中文保持中文,`True` 变成 `\uXXXX` |
| `JSONDecodeError` | `json.loads` 遇到不合法 JSON 时抛的异常 |
| `curl --json` | 发 JSON 的快捷开关,自动加 `Content-Type` 和 `Accept` |
| `curl -F` | 按 multipart 发,`@文件` 表示附件 |
| `python -m json.tool` | 标准库自带的 JSON 排版工具 |
| boundary | multipart 里分隔各段的随机字符串 |

## 常见误区

**用 `-d` 发 JSON 却不写 `Content-Type`。** curl 默认补 `application/x-www-form-urlencoded`,服务器按表单拆,拆出空字典,回一个让人摸不着头脑的 400。用 `--json`,或者 `-H "Content-Type: application/json"`。Python `urllib` 不写头时也会补表单类型,`fetch` 不写时是 `text/plain`,都会出问题。

**以为 JSON 和 JS 对象字面量是一回事。** JSON 只认双引号、不允许尾逗号、不允许注释、没有 `undefined`、`Infinity`、`NaN`。`{'a': 1}` 和 `{"a": 1,}` 都是 400。

**服务器用 `==` 比较 `Content-Type`。** 客户端常发 `application/json; charset=utf-8`,`==` 对不上就误判成 415。用 `startswith`,或者只取分号前的部分。

**`json.loads` 之后不检查形状。** `[1, 2, 3]`、`"一个字符串"`、`42` 都是合法 JSON,直接 `data["title"]` 会炸。先 `isinstance(data, dict)`,再查字段。后面学 pydantic 和 FastAPI 时这一步会由框架做,但你要知道它在做。

**表单格式里的数字当成数字用。** 表单没有类型,`amount=10` 到服务器是字符串 `"10"`,比大小、做加法都会出错。需要类型就用 JSON,或者服务器自己转换。

**`Content-Length` 按字符数算。** 和 Day 59 一样的坑,中文 JSON 尤其容易错:`{"title":"发票抬头写错","amount":0}` 是 29 个字符、41 字节。让库算,别手算。

**把 Python 的 `Infinity` / `NaN` 发给前端。** Python 的 `json` 默认会把 `float("inf")` 写成 `Infinity`,`JSON.parse` 会报 `is not valid JSON`。发之前换成 `null`,或者 `json.dumps(..., allow_nan=False)` 让它直接报错。

**错误响应用纯文本、成功响应用 JSON。** 客户端得写两套解析。统一回 JSON,错误放在 `{"error": ...}` 里,状态码照样用 4xx/5xx。

## 学习资料

### 文档与文章

- [MDN · Content-Type](https://developer.mozilla.org/zh-CN/docs/Web/HTTP/Headers/Content-Type):这个头的语法、常见值,中文。
- [MDN · MIME 类型](https://developer.mozilla.org/zh-CN/docs/Web/HTTP/MIME_types):`application/json`、`text/plain`、`multipart/form-data` 这些名字的来历和完整列表。
- [MDN · 使用 JSON](https://developer.mozilla.org/zh-CN/docs/Learn_web_development/Core/Scripting/JSON):从 JS 角度讲 JSON,`JSON.parse` / `JSON.stringify`,前端读者最快找回感觉。
- [MDN · POST 方法](https://developer.mozilla.org/zh-CN/docs/Web/HTTP/Methods/POST):POST 的 body 和三种 `Content-Type` 的对照。
- [MDN · 415 Unsupported Media Type](https://developer.mozilla.org/zh-CN/docs/Web/HTTP/Status/415) 和 [201 Created](https://developer.mozilla.org/zh-CN/docs/Web/HTTP/Status/201):今天新认识的两个码。
- [json.org 中文](https://www.json.org/json-zh.html):JSON 的完整语法就一页,铁路图画得很清楚。看完你就知道为什么单引号和尾逗号不行。
- [Python 文档 · json](https://docs.python.org/zh-cn/3/library/json.html):`dumps` 的 `ensure_ascii`、`allow_nan`、`indent`,`loads` 能接受字节,`json.tool` 的用法都在这一页。
- [Python 文档 · urllib.request](https://docs.python.org/zh-cn/3/library/urllib.request.html):`Request` 的 `data`、`headers`、`method` 参数。
- [curl 文档 · --json](https://github.com/curl/curl/blob/master/docs/cmdline-opts/json.md):这个开关的官方说明,写明了它等于哪三个选项。
- [MDN · 使用 Fetch](https://developer.mozilla.org/zh-CN/docs/Web/API/Fetch_API/Using_Fetch):对照着看 `fetch` 怎么发 JSON、怎么处理非 2xx。
- [RFC 8259 · The JSON Data Interchange Format](https://www.rfc-editor.org/rfc/rfc8259):JSON 的正式规范,英文,很短。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1MK4y1o7ca&autoplay=0&high_quality=1" title="01-关于post请求里面的三种数据请求格式" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>野马软件设计培训 · 01-关于post请求里面的三种数据请求格式 · 约 27 分钟,2021 年。表单、JSON、multipart 三种格式逐个对比,正好是今天第一步的展开。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1o4BNY5Enf&autoplay=0&high_quality=1" title="CURL入门教程 - 4种HTTP请求方法完全掌握 | REST API测试实战" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>阿汤爱分享 · CURL入门教程 - 4种HTTP请求方法完全掌握 · 约 6 分钟,2024 年。用 curl 发 JSON 的 POST / PUT / DELETE,看它怎么写 -H 和 -d。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1QMt3e5EFM&autoplay=0&high_quality=1" title="HTTP 发送接收JSON数据" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>丁老师的技术随笔 · HTTP 发送接收JSON数据 · 约 46 分钟,2024 年。讲得慢而细,适合今天内容没完全消化时第二天回看;挑讲 Content-Type 和解析的部分。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/4rmBOxn0PdI" title="JSON in Python - Visually Explained" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Visually Explained · JSON in Python - Visually Explained · 英文,可开字幕。`dumps` / `loads` 和 Python 类型的对应关系,动画讲的。我只核对了标题,没有逐分钟看过。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/cj3h3Fb10QY" title="What is JSON? (Explained in 5 minutes)" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Hostinger Academy · What is JSON? (Explained in 5 minutes) · 英文。JSON 语法五分钟速览,适合从没正式看过 JSON 规则的人。我只核对了标题。</figcaption>
</figure>

### 书籍

- 《图解 HTTP》,上野宣 著,于均良 译,人民邮电出版社。第 3 章「HTTP 报文内的 HTTP 信息」讲报文主体和编码,和今天对应。
- 《HTTP 权威指南》(HTTP: The Definitive Guide),David Gourley、Brian Totty 等著,陈涓、赵振平 译,人民邮电出版社。第 15 章「实体和编码」有 `Content-Type`、MIME 类型和 multipart 的完整讲解。

### 开源项目与代码

- [python/cpython · Lib/json/__init__.py](https://github.com/python/cpython/blob/main/Lib/json/__init__.py):`dumps` 和 `loads` 的源码,文档字符串里把每个参数都解释了一遍;`loads` 开头几行能看到它怎么处理传进来的字节。
- [postmanlabs/httpbin](https://github.com/postmanlabs/httpbin):一个专门用来测试 HTTP 客户端的服务([httpbin.org](https://httpbin.org/) 是它的公开实例),`/post` 会把你发的 body 按表单、JSON 分别解析后回给你。今天的 `json_server.py` 是它的迷你版。

## 自测

1. 同一份数据 `title=退款, amount=89.5`,写出表单格式和 JSON 格式的 body,各自的 `Content-Type` 是什么?到了服务器,`amount` 在两种格式下分别是什么类型?

<details><summary>答案</summary>

表单:`title=退款&amount=89.5`,`Content-Type: application/x-www-form-urlencoded`,`amount` 是字符串 `"89.5"`。JSON:`{"title": "退款", "amount": 89.5}`,`Content-Type: application/json`,`amount` 是数字 `89.5`。

</details>

2. 用 `curl -d '{"a": 1}'` 发给一个只收 JSON 的接口,为什么会失败?失败时服务器可能回哪两种状态码,取决于什么?

<details><summary>答案</summary>

`-d` 默认补 `Content-Type: application/x-www-form-urlencoded`,服务器按表单解析 JSON 文本。如果服务器像我们的一样「认表单」,会拆出空字典,回 400(缺字段);如果服务器只认 JSON、不认表单,会回 415(不支持的类型)。两种都是客户端的错,修法都是加 `-H "Content-Type: application/json"` 或用 `--json`。

</details>

3. `{'title': 'x'}`、`{"title": "x",}`、`[{"title": "x"}]` 三段 body 发给今天的服务器,各会得到什么?

<details><summary>答案</summary>

前两个 400,原因是 `JSONDecodeError`(单引号 / 尾逗号都不是合法 JSON),错误信息里带 `Expecting property name enclosed in double quotes`。第三个 JSON 合法,但顶层是列表,`isinstance(data, dict)` 不通过,400,`received` 是 `[{"title": "x"}]`。

</details>

4. 在 Python 里把字典 POST 成 JSON 要做哪三件事?各对应 `fetch` 里的什么?

<details><summary>答案</summary>

`json.dumps(obj, ensure_ascii=False).encode()` 把对象变成字节(对应 `body: JSON.stringify(obj)`);`headers={"Content-Type": "application/json"}`(对应 `headers` 那一行);`method="POST"`(对应 `method: "POST"`)。读响应时 `json.loads(resp.read())` 对应 `await resp.json()`。

</details>

5. 服务器判断 `Content-Type` 时为什么用 `startswith("application/json")` 而不是 `== "application/json"`?

<details><summary>答案</summary>

客户端常常带参数:`application/json; charset=utf-8`。用 `==` 会把这种合法的头误判成不认识,回 415。`startswith` 或者只取分号前的部分都行。

</details>

6. (面试题)前端同事说「我 `fetch` 发了 JSON,后端打印 `request.body` 是空的,但用 Postman 就有」。你让他先查哪一行?为什么 Postman 能成功?

<details><summary>答案</summary>

先查 Network 面板里那个请求的 Request Headers 有没有 `Content-Type: application/json`。`fetch` 传字符串 body 而不写 `headers` 时,浏览器默认发 `text/plain`,后端的 JSON 解析器不认这个类型,就把 body 当成空的或者直接跳过。Postman 在选 raw / JSON 时会自动带上 `Content-Type: application/json`,所以能成功。修法是在 `fetch` 的 `headers` 里加上这一行;更进一步可以在后端对不认识的类型回 415 而不是静默给空对象,这样下次一眼就能看出问题。

</details>

## 明天预告

明天是 [Day 62 · 第 9 周复习:编程地基(Day 56–61)](/blog/agent-zero/day-062-week09-review/)。这一周是两条线:三天 git(提交、分支合并冲突、远程和 PR),三天 HTTP(请求、响应、body)。复习日把它们拼在一起:先默写这周的核心代码,然后做一个小项目,一个把工单存进文件、回正确状态码的收件箱服务器加一个命令行客户端,并且整个过程在分支上开发、制造并解决一次冲突、合并、推到远程,也就是把这六天学的东西一次性用完。
