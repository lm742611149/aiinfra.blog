---
title: 'Day 78 · 后端是什么(二):一次请求在服务端走过的路'
description: '不用框架,只用标准库 http.server 亲手写一个工单服务:请求进来先看路径决定交给哪个函数(路由),函数算出结果(处理函数),再拼成状态码、响应头、响应体发回去(响应)。顺带踩三个坑:忘了 encode、Content-Length 按字符算、处理函数里抛异常。'
pubDate: 2026-10-22
regime: none
tags: ['backend', 'http', 'python', 'agent-zero']
series: 'agent-zero'
day: 78
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 77](/blog/agent-zero/day-077-server-1/) 弄清了三样东西:进程是一个正在跑的程序,有自己的 PID,用 Ctrl+C 或 `kill` 停掉;端口是进程的门牌号,一个端口只能有一个进程监听,被占了会报 `Address already in use`,用 `lsof -nP -iTCP:8000 -sTCP:LISTEN` 查是谁;localhost 指本机,开发时服务绑 127.0.0.1,别绑 0.0.0.0。最后用 `python -m http.server` 起了第一个后端。

可那个服务器只会把目录里的文件原样发出去,里面没有一行是我们写的。你调过的那些接口,比如 `GET /api/tickets?status=open` 返回一段 JSON,背后是有代码在跑的:看你要什么,查数据,算结果,拼响应。今天就自己写这段代码,看一次请求进了服务端以后到底经过了哪些地方。

## 今天要解决的问题

学完今天,你应该能做到:

1. 用标准库的 `BaseHTTPRequestHandler` 写一个服务器,说出 `send_response`、`send_header`、`end_headers`、`wfile.write` 各自对应 HTTP 响应的哪一部分。
2. 从请求里拿到方法、路径、查询参数和请求头,写一张路由表把不同路径交给不同的**处理函数**,路径不存在回 404。
3. 认出三个服务端才有的坑:往 `wfile` 写字符串而不是字节;`Content-Length` 按字符数算导致响应被截断;处理函数里抛异常时客户端收到的是什么。

今天的两个新概念:**路由**(根据方法和路径决定交给谁)和**处理函数**(真正干活、产出响应的那个函数)。响应的格式 Day 60–61 已经学过,今天是第一次站在发送的那一边。

预计用时:2.5 小时。花费 ¥0。

前置:[Day 77](/blog/agent-zero/day-077-server-1/) 的进程和端口、[Day 59](/blog/agent-zero/day-059-http-1/) 到 [Day 61](/blog/agent-zero/day-061-http-3/) 的 HTTP 请求、状态码、header 和 JSON、[Day 16](/blog/agent-zero/day-016-strings-2/) 的 UTF-8 编码、[Day 24](/blog/agent-zero/day-024-dicts/) 的字典、[Day 39](/blog/agent-zero/day-039-json/) 的 `json.dumps`、[Day 42](/blog/agent-zero/day-042-classes-2/) 的继承、[Day 73](/blog/agent-zero/day-073-pytest-3/) 的 parametrize。

学法:先对照文章逐行敲一遍(不复制粘贴)并跑通;第二天合上文章,把最后的 `part01/mini_server.py` 里 `route` 函数和 `Handler.reply` 方法默写出来;做练习,做不出再展开参考答案,看完关掉自己重写一遍。

## 先看全貌:请求在服务端走过的路

从浏览器这边看,一次请求就是 DevTools Network 面板里的一行:发出去,等一会儿,回来一个状态码和一段内容。服务端那边发生的事情,按顺序是这样的:

<figure>
<svg viewBox="0 0 640 250" role="img" aria-label="一次请求在服务端的路径:接收连接、解析请求、路由、处理函数、拼响应、发回">
<rect x="0" y="0" width="640" height="250" fill="var(--paper-raised)" rx="6"/>
<g font-family="var(--font-mono)" font-size="12">
<rect x="16" y="30" width="96" height="56" fill="var(--mem-wash)" stroke="var(--mem)" rx="4"/>
<text x="26" y="54" fill="var(--ink)">curl/浏览器</text>
<text x="26" y="72" fill="var(--ink-soft)" font-size="11">GET /tickets/1002</text>
<rect x="140" y="30" width="110" height="56" fill="var(--paper-raised)" stroke="var(--rule)" rx="4"/>
<text x="150" y="54" fill="var(--ink)">① 接收连接</text>
<text x="150" y="72" fill="var(--ink-soft)" font-size="11">HTTPServer:8000</text>
<rect x="270" y="30" width="110" height="56" fill="var(--paper-raised)" stroke="var(--rule)" rx="4"/>
<text x="280" y="54" fill="var(--ink)">② 解析请求</text>
<text x="280" y="72" fill="var(--ink-soft)" font-size="11">command/path</text>
<rect x="400" y="30" width="100" height="56" fill="var(--compute-wash)" stroke="var(--compute)" rx="4"/>
<text x="410" y="54" fill="var(--ink)">③ 路由</text>
<text x="410" y="72" fill="var(--ink-soft)" font-size="11">route()</text>
<rect x="520" y="30" width="104" height="56" fill="var(--compute-wash)" stroke="var(--compute)" rx="4"/>
<text x="530" y="54" fill="var(--ink)">④ 处理函数</text>
<text x="530" y="72" fill="var(--ink-soft)" font-size="11">get_ticket()</text>
<rect x="400" y="150" width="224" height="72" fill="var(--paper-raised)" stroke="var(--rule)" rx="4"/>
<text x="410" y="172" fill="var(--ink)">⑤ 拼响应 reply()</text>
<text x="410" y="192" fill="var(--ink-soft)" font-size="11">状态行 send_response(200)</text>
<text x="410" y="210" fill="var(--ink-soft)" font-size="11">头 send_header / 体 wfile</text>
<rect x="16" y="158" width="250" height="56" fill="var(--mem-wash)" stroke="var(--mem)" rx="4"/>
<text x="26" y="182" fill="var(--ink)">⑥ 客户端收到</text>
<text x="26" y="200" fill="var(--ink-soft)" font-size="11">200 + {"id": 1002, ...}</text>
<line x1="112" y1="58" x2="140" y2="58" stroke="var(--rule)" stroke-width="2"/>
<line x1="250" y1="58" x2="270" y2="58" stroke="var(--rule)" stroke-width="2"/>
<line x1="380" y1="58" x2="400" y2="58" stroke="var(--rule)" stroke-width="2"/>
<line x1="500" y1="58" x2="520" y2="58" stroke="var(--rule)" stroke-width="2"/>
<line x1="572" y1="86" x2="572" y2="150" stroke="var(--rule)" stroke-width="2"/>
<line x1="400" y1="186" x2="266" y2="186" stroke="var(--rule)" stroke-width="2"/>
<text x="140" y="120" fill="var(--ink-faint)" font-size="11">①② 由标准库做;③④⑤ 是今天自己写的部分</text>
</g>
</svg>
<figcaption>一次请求在服务端的路。①② 是 http.server 已经替我们做好的:接住连接、把请求文本拆成方法、路径和请求头。③④⑤ 是今天要写的:看路径决定交给谁,让那个函数算结果,再把结果拼成 HTTP 响应。</figcaption>
</figure>

前端的 Express 你可能见过:`app.get('/tickets/:id', (req, res) => res.json(...))`。这一行里,`app.get('/tickets/:id', ...)` 是路由,箭头函数是处理函数,`res.json(...)` 是拼响应。今天就是把这一行背后的东西拆开,用大约 60 行 Python 自己写出来。后天的 FastAPI 和 Express 一样,把这些都包好了,到时候你会知道它包掉的是什么。

## 第 1 步:最小的服务器,自己拼一个响应

新建 `part01/hello_server.py`:

```python
# agent-zero-lab/part01/hello_server.py
from http.server import BaseHTTPRequestHandler, HTTPServer


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        body = "你好,这是我写的第一个后端\n".encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "text/plain; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


server = HTTPServer(("127.0.0.1", 8000), Handler)
print("监听 http://127.0.0.1:8000 ,Ctrl+C 停止")
server.serve_forever()
```

<div class="line-notes">

- `from http.server import BaseHTTPRequestHandler, HTTPServer` 昨天 `python -m http.server` 运行的就是这个模块。今天不用它的命令行,而是导入里面的两个类自己组装。
- `class Handler(BaseHTTPRequestHandler):` Day 42 学的继承。`BaseHTTPRequestHandler` 已经会做图里的 ①②:读请求、拆出方法和路径;我们继承它,只补上「拿到请求以后怎么回」。
- `def do_GET(self):` 规矩是:请求方法是 GET,它就调用名叫 `do_GET` 的方法;POST 就找 `do_POST`。名字是写死的,`do_` 加大写的方法名。
- `body = "你好,这是我写的第一个后端\n".encode("utf-8")` 先把要发的内容准备好。网络上传的是**字节**不是字符串,`.encode("utf-8")` 把字符串变成字节(Day 16 讲过),得到的是 `bytes` 类型。实测这段是 38 个字节。
- `self.send_response(200)` 写响应的第一行,状态行 `HTTP/1.0 200 OK`。它还会顺手加上 `Server` 和 `Date` 两个头。
- `self.send_header("Content-Type", "text/plain; charset=utf-8")` 写一个响应头:内容是纯文本,编码 UTF-8。浏览器靠它决定怎么显示。
- `self.send_header("Content-Length", str(len(body)))` 告诉对方响应体有多少**字节**。`len(body)` 对 bytes 求长度,得到字节数 38。header 的值必须是字符串,所以套一层 `str()`。
- `self.end_headers()` 头写完了。它会写一个空行,HTTP 规定头和体之间用一个空行隔开,Day 59 的 `curl -v` 里那个只有 `<` 的空行就是它。
- `self.wfile.write(body)` 写响应体。`wfile` 是「通往客户端的那根管子」,w 是 write,往里写字节就会发到对方那边。
- `server = HTTPServer(("127.0.0.1", 8000), Handler)` 建一个服务器:绑 127.0.0.1(Day 77 说的安全做法)的 8000 端口。注意传的是 `Handler` 这个类本身,不是 `Handler()`。每来一个请求,HTTPServer 自己 new 一个 Handler 对象来处理它。
- `server.serve_forever()` 开始监听,一直循环:等请求、处理、再等。这一行永远不会返回,所以终端被占住,和 `npm run dev` 一样。

</div>

第一个窗口,在仓库根目录 `/Users/你/agent-zero-lab` 运行:

```bash
uv run python -m part01.hello_server
```

实跑输出:

```text
监听 http://127.0.0.1:8000 ,Ctrl+C 停止
```

第二个窗口:

```bash
curl -v "http://127.0.0.1:8000/anything?x=1"
```

实跑输出(去掉了 `*` 开头的连接信息):

```text
> GET /anything?x=1 HTTP/1.1
> Host: 127.0.0.1:8000
> User-Agent: curl/8.1.2
> Accept: */*
>
< HTTP/1.0 200 OK
< Server: BaseHTTP/0.6 Python/3.12.13
< Date: Thu, 22 Oct 2026 05:25:09 GMT
< Content-Type: text/plain; charset=utf-8
< Content-Length: 38
<
你好,这是我写的第一个后端
```

拿响应的每一行对一下代码:`HTTP/1.0 200 OK` 和 `Server`、`Date` 来自 `send_response(200)`;`Content-Type` 和 `Content-Length: 38` 来自两次 `send_header`;那个空的 `<` 来自 `end_headers()`;最后一行来自 `wfile.write(body)`。**你在 DevTools 里看到的每一个响应,都是服务端代码这样一行一行写出来的。**

第一个窗口多了一行访问日志 `127.0.0.1 - - [22/Oct/2026 13:25:09] "GET /anything?x=1 HTTP/1.1" 200 -`,这一行是 `BaseHTTPRequestHandler` 自动打的,和昨天 http.server 的一样。

还有一个现象:不管请求什么路径,`/anything` 也好 `/` 也好,回的都是同一句话。因为 `do_GET` 根本没看路径。这就是第 3 步要加的路由。

### URL 里有 ? 时要加引号

上面 curl 的地址我加了双引号。第一次我没加,直接写 `curl -v http://127.0.0.1:8000/anything?x=1`,实跑报错:

```text
zsh: no matches found: http://127.0.0.1:8000/anything?x=1
```

请求根本没发出去。zsh(macOS 默认的 shell)把 `?` 当成通配符,像 Day 4 学的 `*` 一样,去找「名字匹配这个模式的文件」,找不到就报错。**带 `?` 或 `&` 的 URL 一律用双引号包起来。**

### POST 会怎样

我们只写了 `do_GET`。发一个 POST 试试:

```bash
curl -X POST http://127.0.0.1:8000/
```

实跑输出是一个 HTML 错误页,关键几行:

```text
        <p>Error code: 501</p>
        <p>Message: Unsupported method ('POST').</p>
```

服务器日志是 `code 501, message Unsupported method ('POST')`。找不到 `do_POST`,`BaseHTTPRequestHandler` 就自动回 501(服务器不支持这个功能)。这是标准库的默认行为,第 6 步我们会自己决定方法不对时回什么。

### Content-Length 按字节算,不按字符

上一行 `Content-Length` 我写的是 `len(body)`,body 是编码后的字节。新手很容易写成 `len(text)`,对字符串求长度。我故意写错试了一次:建一个 `part01/len_bug.py`,和 `hello_server.py` 只差一处,`Content-Length` 用了 `str(len(text))`,`text` 是编码前的字符串,同时在服务器窗口里打印两种长度。实跑服务器窗口的输出:

```text
字符数: 14 字节数: 38
```

curl 收到的内容:

```text
你好,这是�
```

只剩前几个字,最后还有一个乱码。原因:服务器声明「我发 14 个字节」,curl 读满 14 个字节就认为结束了,剩下的 24 个字节直接丢掉。14 个字节在 UTF-8 里刚好切在一个中文字的中间(每个中文字 3 个字节,逗号 1 个),最后半个字解码不出来,就成了 `�`。纯英文时字符数等于字节数,这个 bug 根本看不出来,一遇到中文就露馅。所以**先 encode,再对 bytes 求长度**。试完删掉 `len_bug.py`。

停服务器:回第一个窗口按 Ctrl+C。这次你会看到一段以 `KeyboardInterrupt` 结尾的 traceback,因为我们自己调的 `serve_forever()` 没有像 `python -m http.server` 那样接住这个异常。Day 77 说过,这是正常的停止方式。

## 第 2 步:服务器眼里的请求长什么样

`BaseHTTPRequestHandler` 帮我们把请求拆好了,放在 `self` 的几个属性上。新建 `part01/echo_server.py`,把它们打印出来,再把方法和路径当成 JSON 回给客户端:

```python
# agent-zero-lab/part01/echo_server.py
import json
from http.server import BaseHTTPRequestHandler, HTTPServer


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        print("方法:", self.command)
        print("路径:", self.path)
        print("请求头:", dict(self.headers))
        print("对方地址:", self.client_address)
        data = {"you_sent": {"method": self.command, "path": self.path}}
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


HTTPServer(("127.0.0.1", 8000), Handler).serve_forever()
```

<div class="line-notes">

- `print("方法:", self.command)` 请求方法,`"GET"`。名字叫 command 有点怪,是这个类的历史叫法。
- `print("路径:", self.path)` 请求行里的路径,**包括 `?` 后面的查询字符串**,实跑是 `/tickets?status=open&limit=2`。
- `print("请求头:", dict(self.headers))` `self.headers` 是一个类似字典的对象,`dict(...)` 转成普通字典方便打印。
- `print("对方地址:", self.client_address)` 客户端的 IP 和端口,是一个元组(Day 22)。
- `data = {"you_sent": {"method": self.command, "path": self.path}}` 要回给客户端的数据,一个普通的字典。
- `body = json.dumps(data, ensure_ascii=False).encode("utf-8")` Day 39 的 `json.dumps` 把字典变成 JSON 字符串,`ensure_ascii=False` 让中文保持原样而不是变成 `你` 这种转义;再 encode 成字节。
- `self.send_header("Content-Type", "application/json; charset=utf-8")` 这次声明内容是 JSON。前端的 `fetch(...).then(r => r.json())` 不看这个头也能解析,但很多客户端库和 DevTools 的预览面板会看它。
- `HTTPServer(("127.0.0.1", 8000), Handler).serve_forever()` 和第 1 步一样,只是两行合成了一行。

</div>

先 Ctrl+C 停掉上一个服务器(不然 8000 端口被占,Day 77 的 `Address already in use`),再运行 `uv run python -m part01.echo_server`。第二个窗口带一个自定义请求头去请求:

```bash
curl "http://127.0.0.1:8000/tickets?status=open&limit=2" -H "Authorization: Bearer test-123"
```

<div class="line-notes">

- `-H "Authorization: Bearer test-123"` `-H` 加一个请求头,Day 63 调 DeepSeek 余额接口时用过这种鉴权头。这里的 `test-123` 是随便编的。

</div>

curl 收到的实跑输出:

```text
{"you_sent": {"method": "GET", "path": "/tickets?status=open&limit=2"}}
```

服务器窗口的实跑输出:

```text
方法: GET
路径: /tickets?status=open&limit=2
请求头: {'Host': '127.0.0.1:8000', 'User-Agent': 'curl/8.1.2', 'Accept': '*/*', 'Authorization': 'Bearer test-123'}
对方地址: ('127.0.0.1', 62569)
127.0.0.1 - - [22/Oct/2026 13:25:35] "GET /tickets?status=open&limit=2 HTTP/1.1" 200 -
```

几件事:

- 你在 curl 里写的 `-H` 原样出现在服务器的请求头里。Day 82 学鉴权时,服务器就是从这里读 `Authorization` 去验证的。
- `self.path` 是**一整串**,路径和查询参数粘在一起,要自己拆,下一步做。
- 对方地址是 `('127.0.0.1', 62569)`。客户端也有端口!curl 这边也占了一个端口(62569)用来收响应,只不过是操作系统临时随便分配的,用完就还,所以叫临时端口。Day 77 说「端口是进程的门牌号」,收信的一方当然也要有门牌号。

这里顺便说一个服务端的安全习惯:我把整个请求头打印出来,是为了今天看清楚。真实服务里**别把请求头整个写进日志**,`Authorization` 里是用户的密钥,Day 75 的常见误区里说过,日志文件往往权限很松。

## 第 3 步:把路径和查询参数拆开

`self.path` 是 `/tickets?status=open&limit=2` 这样一整串。标准库 `urllib.parse` 里有两个现成的函数:`urlsplit` 把 URL 拆成几段,`parse_qs` 把查询字符串拆成字典。先单独试一下,新建 `part01/url_parts.py`:

```python
# agent-zero-lab/part01/url_parts.py
from urllib.parse import parse_qs, urlsplit

raw = "/tickets?status=open&limit=2&tag=发票&tag=退款"
parts = urlsplit(raw)
print("path  =", parts.path)
print("query =", parts.query)
query = parse_qs(parts.query)
print("parse_qs ->", query)
print("status =", query.get("status", [None])[0])
print("missing =", query.get("customer", [None])[0])
print("limit 的类型:", type(query["limit"][0]))
```

<div class="line-notes">

- `from urllib.parse import parse_qs, urlsplit` 标准库,不用安装。相当于前端的 `new URL(...)` 和 `URLSearchParams`。
- `raw = "/tickets?status=open&limit=2&tag=发票&tag=退款"` 故意让 `tag` 出现两次,看看会怎样。
- `parts = urlsplit(raw)` 拆成 scheme、netloc(域名)、path、query、fragment 五段。这里没有域名,前两段是空字符串。
- `print("path  =", parts.path)` 路径部分 `/tickets`,路由就看它。
- `query = parse_qs(parts.query)` 把 `status=open&limit=2...` 拆成字典,**每个值都是列表**,因为同一个名字可以出现多次。
- `print("status =", query.get("status", [None])[0])` 取一个参数的惯用写法:`.get` 拿不到时给默认值 `[None]`,再取第一个。Day 24 学过 `.get` 的默认值。
- `print("missing =", query.get("customer", [None])[0])` 没传的参数,拿到 `None`。
- `print("limit 的类型:", type(query["limit"][0]))` 看看 `"2"` 是什么类型。

</div>

```bash
uv run python -m part01.url_parts
```

实跑输出:

```text
path  = /tickets
query = status=open&limit=2&tag=发票&tag=退款
parse_qs -> {'status': ['open'], 'limit': ['2'], 'tag': ['发票', '退款']}
status = open
missing = None
limit 的类型: <class 'str'>
```

两点要记住。第一,`parse_qs` 的值都是列表,`tag` 出现两次就是两个元素,`URLSearchParams.getAll('tag')` 也是这个意思。第二,`limit` 是字符串 `'2'`,不是数字 2。**URL 里的一切都是字符串**,想当数字用得自己转,转之前还得检查是不是数字。后天你会看到 FastAPI 最省事的地方之一就是替你做这个转换和检查。

(这里的 `发票` 我是直接写在 Python 字符串里的。真正从浏览器发来的 URL,中文会被编码成 `%E5%8F%91%E7%A5%A8` 这样,`parse_qs` 会自动解码回中文,我用 `parse_qs('tag=%E5%8F%91%E7%A5%A8')` 实测得到 `{'tag': ['发票']}`。)

## 第 4 步:路由,第一版用 if/elif

现在让 `do_GET` 看路径。新建 `part01/route_v1.py`:

```python
# agent-zero-lab/part01/route_v1.py
import json
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import urlsplit


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        path = urlsplit(self.path).path
        if path == "/":
            status, data = 200, {"service": "cloudledger-tickets"}
        elif path == "/tickets":
            status, data = 200, {"count": 2, "items": ["T-1001", "T-1002"]}
        else:
            status, data = 404, {"error": f"没有这个路径: {path}"}
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


HTTPServer(("127.0.0.1", 8000), Handler).serve_forever()
```

<div class="line-notes">

- `path = urlsplit(self.path).path` 只要路径部分,查询参数不参与路由。
- `if path == "/":` 路由就是这么朴素:拿路径和一个个字符串比。
- `status, data = 200, {"service": "cloudledger-tickets"}` Day 22 的元组解包,一行同时给两个变量赋值。
- `status, data = 200, {"count": 2, "items": ["T-1001", "T-1002"]}` 先写死两条假数据,第 6 步换成真的。
- `status, data = 404, {"error": f"没有这个路径: {path}"}` 都不匹配就 404,并且告诉对方哪个路径不存在。返回 JSON 格式的错误,前端处理起来比一个 HTML 错误页方便得多。
- `self.send_response(status)` 状态码不再写死,用上面算出来的。

</div>

停掉上一个服务器,运行 `uv run python -m part01.route_v1`,第二个窗口用一个小循环请求五个地址:

```bash
for p in / /tickets "/tickets?status=open" /tickets/ /invoices; do
  echo "== $p"
  curl -s -w "  [%{http_code}]\n" "http://127.0.0.1:8000$p"
done
```

<div class="line-notes">

- `for p in / /tickets "/tickets?status=open" /tickets/ /invoices; do` shell 里的 for 循环,`p` 依次取后面的每个值,带 `?` 的那个加了引号。
- `curl -s -w "  [%{http_code}]\n" "http://127.0.0.1:8000$p"` `-w` 在响应内容后面再打印状态码,一行就能同时看到内容和状态码。`$p` 是取变量 p 的值。

</div>

实跑输出:

```text
== /
{"service": "cloudledger-tickets"}  [200]
== /tickets
{"count": 2, "items": ["T-1001", "T-1002"]}  [200]
== /tickets?status=open
{"count": 2, "items": ["T-1001", "T-1002"]}  [200]
== /tickets/
{"error": "没有这个路径: /tickets/"}  [404]
== /invoices
{"error": "没有这个路径: /invoices"}  [404]
```

路由起作用了。注意两个细节:`/tickets?status=open` 走的是 `/tickets` 这条路由,但 `status=open` 没起作用,因为我们还没去读它;`/tickets/`(末尾多一个斜杠)是 404,对计算机来说 `/tickets` 和 `/tickets/` 是两个不同的字符串。很多框架会帮你把这两种情况统一起来,我们手写的就得自己决定,这里先不管。

if/elif 的问题也很明显:每加一个接口就多一个 `elif`,而且每个分支里的逻辑都挤在 `do_GET` 一个函数里。再有十个接口,这个函数就没法看了。第 6 步换成路由表。

## 第 5 步:处理函数出错时,客户端看到什么

后端代码难免出错。在动手重构之前,先看清楚出错时会发生什么。新建一个专门出错的 `part01/bad_server.py`(演示完删掉):

```python
# agent-zero-lab/part01/bad_server.py(演示完删掉)
from http.server import BaseHTTPRequestHandler, HTTPServer

TICKETS = {"1001": "发票抬头开错了"}


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == "/str":
            self.send_response(200)
            self.end_headers()
            self.wfile.write("忘了 encode")
        elif self.path == "/crash":
            title = TICKETS["9999"]
            self.send_response(200)
            self.end_headers()
            self.wfile.write(title.encode("utf-8"))
        else:
            self.send_response(200)
            self.end_headers()
            self.wfile.write("ok\n".encode("utf-8"))


HTTPServer(("127.0.0.1", 8000), Handler).serve_forever()
```

<div class="line-notes">

- `self.wfile.write("忘了 encode")` 坑一:往 wfile 里写字符串,忘了变成字节。basedpyright 在编辑器里会给这一行画红线,但 Python 运行时不会提前检查。
- `title = TICKETS["9999"]` 坑二:处理函数里抛异常。字典里没有这个键,抛 `KeyError`,这时候还一个字节都没发。
- `self.wfile.write("ok\n".encode("utf-8"))` 正常的分支,用来确认出错以后服务器还活着。

</div>

运行它,第二个窗口依次请求三个路径:

```bash
for p in /str /crash /; do
  echo "== $p"
  curl -sS -w "  [%{http_code}]\n" "http://127.0.0.1:8000$p"
done
```

实跑输出:

```text
== /str
  [200]
== /crash
curl: (52) Empty reply from server
  [000]
== /
ok
  [200]
```

服务器窗口的实跑输出(traceback 中间标准库的那几层我删了):

```text
127.0.0.1 - - [22/Oct/2026 13:26:33] "GET /str HTTP/1.1" 200 -
----------------------------------------
Exception occurred during processing of request from ('127.0.0.1', 63110)
Traceback (most recent call last):
  ...
  File "/Users/你/agent-zero-lab/part01/bad_server.py", line 12, in do_GET
    self.wfile.write("忘了 encode")
  File ".../python3.12/socketserver.py", line 845, in write
    self._sock.sendall(b)
TypeError: a bytes-like object is required, not 'str'
----------------------------------------
----------------------------------------
Exception occurred during processing of request from ('127.0.0.1', 63111)
Traceback (most recent call last):
  ...
  File "/Users/你/agent-zero-lab/part01/bad_server.py", line 14, in do_GET
    title = TICKETS["9999"]
            ~~~~~~~^^^^^^^^
KeyError: '9999'
----------------------------------------
127.0.0.1 - - [22/Oct/2026 13:26:33] "GET / HTTP/1.1" 200 -
```

三个结论,都很重要:

**一、`/str` 返回了 200,但是没有内容。** 因为出错的那一行在 `send_response(200)` 和 `end_headers()` 之后,状态行和头已经发出去了,覆水难收。服务器日志里也记的是 200。前端看到的是「请求成功了,可数据是空的」,这种 bug 最难查。教训:**状态码一旦发出就改不了,所以要先把结果全部算好,最后再一口气发送。**第 6 步的结构就是按这个原则设计的。

**二、`/crash` 客户端收到 `Empty reply from server`。** 异常发生在发送任何东西之前,服务器什么都没回就把连接关了。在浏览器里你会看到这个请求失败,DevTools 里没有状态码。服务端应该做的是接住异常、回一个 500 并附上错误说明,这是 Day 81 的内容,今天先知道现象。

**三、服务器没死。** 第三个请求 `/` 照样是 200。`HTTPServer` 会接住处理单个请求时的异常,打印 traceback,然后接着服务下一个请求。这是所有后端框架的共同设计:一个请求出错,不能连累其他人。所以排查后端问题时,一定要去看**服务器那边的日志**,客户端只能看到「空响应」或者「500」,真正的原因只在服务端的 traceback 里。

看完删掉 `part01/bad_server.py`。

## 第 6 步:路由表、处理函数和统一的响应

把前面几步合起来,写一个像样的工单服务。三个改进:

- 每个接口写成一个独立的**处理函数**,只管算出 `(状态码, 数据)`,不碰 `self.wfile`。
- 用一个字典当**路由表**,路径 → 处理函数,取代一长串 `elif`。
- 「把 `(状态码, 数据)` 变成 HTTP 响应」只写一次,放在 `reply` 方法里。按第 5 步的教训,先算完再发。

还要支持 `/tickets/1002` 这种「路径里带工单号」的写法,这在 REST 风格的接口里很常见(Day 63 讲过),叫**路径参数**。

新建 `part01/mini_server.py`:

```python
# agent-zero-lab/part01/mini_server.py
import json
from http.server import BaseHTTPRequestHandler, HTTPServer
from typing import Any
from urllib.parse import parse_qs, urlsplit

TICKETS: list[dict[str, Any]] = [
    {"id": 1001, "title": "发票抬头开错了", "status": "open"},
    {"id": 1002, "title": "同一个月被扣了两次款", "status": "open"},
    {"id": 1003, "title": "想从基础版升级到专业版", "status": "closed"},
]

Query = dict[str, list[str]]
Reply = tuple[int, dict[str, Any]]


def index(query: Query) -> Reply:
    return 200, {"service": "cloudledger-tickets", "routes": ["/tickets", "/tickets/{id}"]}


def list_tickets(query: Query) -> Reply:
    status = query.get("status", [None])[0]
    items = [t for t in TICKETS if status is None or t["status"] == status]
    return 200, {"count": len(items), "items": items}


def get_ticket(raw_id: str) -> Reply:
    if not raw_id.isdigit():
        return 400, {"error": f"工单号必须是数字: {raw_id}"}
    for t in TICKETS:
        if t["id"] == int(raw_id):
            return 200, t
    return 404, {"error": f"没有这张工单: {raw_id}"}


ROUTES = {"/": index, "/tickets": list_tickets}


def route(method: str, raw_path: str) -> Reply:
    parts = urlsplit(raw_path)
    if method != "GET":
        return 405, {"error": f"不支持的方法: {method}"}
    handler = ROUTES.get(parts.path)
    if handler is not None:
        return handler(parse_qs(parts.query))
    if parts.path.startswith("/tickets/"):
        return get_ticket(parts.path.removeprefix("/tickets/"))
    return 404, {"error": f"没有这个路径: {parts.path}"}


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        self.reply(*route("GET", self.path))

    def do_POST(self):
        self.reply(*route("POST", self.path))

    def reply(self, status: int, data: dict[str, Any]) -> None:
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


if __name__ == "__main__":
    server = HTTPServer(("127.0.0.1", 8000), Handler)
    print("监听 http://127.0.0.1:8000 ,Ctrl+C 停止")
    server.serve_forever()
```

<div class="line-notes">

- `TICKETS: list[dict[str, Any]] = [` 三张假工单,放在内存里,每次重启服务都是这三张。存进数据库要等 Day 85 学 SQL 以后。`Any` 是 Day 46 学的「什么类型都行」,因为字典里的值有数字也有字符串。
- `Query = dict[str, list[str]]` 给一个类型起别名。`parse_qs` 返回的就是这个形状,写成 `Query` 以后,下面每个函数签名都短一截。相当于 TS 的 `type Query = Record<string, string[]>`。
- `Reply = tuple[int, dict[str, Any]]` 每个处理函数都返回「状态码 + 数据」这样一个元组,也起个名字。
- `def index(query: Query) -> Reply:` 第一个处理函数。它用不到查询参数,但为了和别的处理函数长得一样(都能被路由表统一调用),还是收一个 `query`。
- `status = query.get("status", [None])[0]` 第 3 步的惯用写法,没传就是 `None`。
- `items = [t for t in TICKETS if status is None or t["status"] == status]` Day 23 的列表推导式:没传 status 就全要,传了就只要状态相同的。实跑 `?status=closed` 得到 1 张。
- `def get_ticket(raw_id: str) -> Reply:` 路径参数从 URL 里截出来,是字符串,所以参数叫 `raw_id`,提醒自己它还没被检查过。
- `if not raw_id.isdigit():` 先检查是不是纯数字。`"abc".isdigit()` 是 `False`。不检查的话,下面 `int("abc")` 会抛 `ValueError`,就变成第 5 步的 Empty reply 了。
- `return 400, {"error": f"工单号必须是数字: {raw_id}"}` 400 Bad Request,意思是「你的请求本身有问题」。Day 60 讲过 4xx 是客户端的错。
- `if t["id"] == int(raw_id):` 检查过了,可以放心转成整数再比。
- `return 404, {"error": f"没有这张工单: {raw_id}"}` 格式对,但找不到,404。400 和 404 的区别:前者是「你问得不对」,后者是「问得对,但没有」。
- `ROUTES = {"/": index, "/tickets": list_tickets}` 路由表。值是**函数本身**,注意后面没有括号,不是调用它。Python 里函数和 JS 一样可以当值存在字典里,相当于 `const ROUTES = { "/": index, "/tickets": listTickets }`。
- `def route(method: str, raw_path: str) -> Reply:` 路由函数,全文最关键的一个。它只吃两个字符串,吐出 `(状态码, 数据)`,不碰网络,所以练习 1 能直接用 pytest 测它。
- `if method != "GET":` 现在只支持 GET,别的方法回 405 Method Not Allowed。比标准库默认的 501 更准确:501 是「服务器不认识这个方法」,405 是「认识,但这个地址不接受」。
- `handler = ROUTES.get(parts.path)` 查表。查到就是一个函数,查不到是 `None`。
- `return handler(parse_qs(parts.query))` 调用查到的那个函数,把查询参数交给它。
- `if parts.path.startswith("/tickets/"):` 路由表只能精确匹配,`/tickets/1002`、`/tickets/1003` 不可能都写进表里,所以带参数的路径单独用前缀判断。真正的框架会支持 `/tickets/{id}` 这种模板写法,后天就能见到。
- `return get_ticket(parts.path.removeprefix("/tickets/"))` `removeprefix` 去掉前缀,剩下的 `"1002"` 就是路径参数。
- `self.reply(*route("GET", self.path))` `route` 返回一个两元素的元组,`*` 把它拆开当成两个参数传给 `reply`,等价于 `status, data = route(...)` 再 `self.reply(status, data)`。Day 30 学 `*args` 时见过这个星号。
- `def do_POST(self):` 加上它,POST 请求就会走我们自己的 `route`,得到 405,而不是标准库的 501。
- `def reply(self, status: int, data: dict[str, Any]) -> None:` 唯一一个往网络上写东西的地方。先把 body 完整算出来(第 5 步的教训),再按顺序发状态行、头、体。
- `if __name__ == "__main__":` Day 32 学的。被 `-m` 直接运行时才启动服务器;被 pytest 导入时不启动,否则测试一 import 就卡死在 `serve_forever()` 上。

</div>

停掉之前的服务器,运行:

```bash
uv run python -m part01.mini_server
```

第二个窗口把各种情况都请求一遍:

```bash
for p in / /tickets "/tickets?status=closed" /tickets/1002 /tickets/9999 /tickets/abc /invoices; do
  echo "== GET $p"
  curl -sS -w "  [%{http_code}]\n" "http://127.0.0.1:8000$p"
done
echo "== POST /tickets"
curl -sS -X POST -w "  [%{http_code}]\n" http://127.0.0.1:8000/tickets
```

实跑输出:

```text
== GET /
{"service": "cloudledger-tickets", "routes": ["/tickets", "/tickets/{id}"]}  [200]
== GET /tickets
{"count": 3, "items": [{"id": 1001, "title": "发票抬头开错了", "status": "open"}, {"id": 1002, "title": "同一个月被扣了两次款", "status": "open"}, {"id": 1003, "title": "想从基础版升级到专业版", "status": "closed"}]}  [200]
== GET /tickets?status=closed
{"count": 1, "items": [{"id": 1003, "title": "想从基础版升级到专业版", "status": "closed"}]}  [200]
== GET /tickets/1002
{"id": 1002, "title": "同一个月被扣了两次款", "status": "open"}  [200]
== GET /tickets/9999
{"error": "没有这张工单: 9999"}  [404]
== GET /tickets/abc
{"error": "工单号必须是数字: abc"}  [400]
== GET /invoices
{"error": "没有这个路径: /invoices"}  [404]
== POST /tickets
{"error": "不支持的方法: POST"}  [405]
```

每种情况都有一个准确的状态码和一段能看懂的 JSON。顺带试了一下 `curl -X PUT`,它还是标准库默认的 501 HTML 页,因为我们没写 `do_PUT`,这个缺口留着,后天 FastAPI 会自动补上。

服务器窗口的访问日志:

```text
监听 http://127.0.0.1:8000 ,Ctrl+C 停止
127.0.0.1 - - [22/Oct/2026 13:26:52] "GET / HTTP/1.1" 200 -
127.0.0.1 - - [22/Oct/2026 13:26:52] "GET /tickets HTTP/1.1" 200 -
127.0.0.1 - - [22/Oct/2026 13:26:52] "GET /tickets?status=closed HTTP/1.1" 200 -
127.0.0.1 - - [22/Oct/2026 13:26:52] "GET /tickets/1002 HTTP/1.1" 200 -
127.0.0.1 - - [22/Oct/2026 13:26:52] "GET /tickets/9999 HTTP/1.1" 404 -
127.0.0.1 - - [22/Oct/2026 13:26:52] "GET /tickets/abc HTTP/1.1" 400 -
127.0.0.1 - - [22/Oct/2026 13:26:52] "GET /invoices HTTP/1.1" 404 -
127.0.0.1 - - [22/Oct/2026 13:26:52] "POST /tickets HTTP/1.1" 405 -
```

我用 basedpyright(standard 档)检查了 `part01/` 下今天所有文件,结果 `0 errors, 0 warnings, 0 notes`。

### 为什么要把 route 单独拿出来

看 `mini_server.py` 的结构:处理函数和 `route` 只做「字符串进、元组出」的计算,`Handler` 只做「读请求、写响应」的网络活。这样拆有两个好处。

一是好测。`route("GET", "/tickets/abc")` 直接返回 `(400, {...})`,不用起服务器、不用发请求,练习 1 用 Day 73 的 parametrize 一张表就能测完所有分支。这和 Day 74 用假客户端测天气工具是一个思路:把「和外界打交道」的部分挤到最薄,中间的逻辑就能离线测。

二是换框架时逻辑不用动。后天换成 FastAPI,`get_ticket` 里「检查、查找、找不到怎么办」的逻辑几乎原样搬过去,扔掉的只是 `Handler` 这一层。

## 零件和成品的对照

| 成品 `mini_server.py` 里的这一段 | 来自 | 做什么 |
| --- | --- | --- |
| `class Handler(BaseHTTPRequestHandler)` + `serve_forever()` | 第 1 步 | 接住连接,解析请求,按方法分发到 `do_GET`/`do_POST` |
| `reply` 里的 `send_response` / `send_header` / `end_headers` / `wfile.write` | 第 1 步 | 依次写状态行、头、空行、体 |
| `Content-Length` 用 `len(body)` | 第 1 步 | 按字节算,不然中文会被截断 |
| `json.dumps(..., ensure_ascii=False).encode("utf-8")` | 第 2 步 | 数据变 JSON 再变字节 |
| `urlsplit` + `parse_qs` | 第 3 步 | 拆出路径和查询参数 |
| `ROUTES` 字典 + `route` 函数 | 第 4、6 步 | 路由:方法和路径决定交给谁,都不匹配回 404/405 |
| `index` / `list_tickets` / `get_ticket` | 第 6 步 | 处理函数:只算结果,返回 `(状态码, 数据)` |
| `isdigit()` 检查后再 `int()`;先算完 body 再发送 | 第 5 步 | 不让异常变成 Empty reply 或「200 却没内容」 |

## 动手练习

**练习 1:给 route 写测试。** 新建 `tests/test_mini_server.py`,用 parametrize 写一张表,覆盖 `route` 的七种情况(首页、列表、单张、工单不存在、工单号不是数字、路径不存在、方法不对),只断言状态码;再单独写一个测试,断言 `?status=open` 返回 2 张,id 是 1001 和 1002。不许起服务器。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/tests/test_mini_server.py
import pytest

from part01.mini_server import route


@pytest.mark.parametrize(
    ("method", "path", "status"),
    [
        pytest.param("GET", "/", 200, id="index"),
        pytest.param("GET", "/tickets", 200, id="list"),
        pytest.param("GET", "/tickets/1001", 200, id="one-ticket"),
        pytest.param("GET", "/tickets/9999", 404, id="no-such-ticket"),
        pytest.param("GET", "/tickets/abc", 400, id="bad-id"),
        pytest.param("GET", "/invoices", 404, id="no-such-path"),
        pytest.param("POST", "/tickets", 405, id="bad-method"),
    ],
)
def test_route_status(method: str, path: str, status: int):
    assert route(method, path)[0] == status


def test_filter_by_status():
    status, data = route("GET", "/tickets?status=open")
    assert status == 200
    assert data["count"] == 2
    assert {t["id"] for t in data["items"]} == {1001, 1002}
```

<div class="line-notes">

- `from part01.mini_server import route` 只导入 `route`。因为 `mini_server.py` 的启动代码在 `if __name__ == "__main__":` 里面,导入时不会起服务器。
- `("method", "path", "status"),` Day 73 的 parametrize,三列。
- `pytest.param("GET", "/", 200, id="index"),` 每行起个英文 id。我一开始写的是中文 id,`pytest -v` 里显示成了 `首页` 这种转义,不好读,就换成了英文。
- `assert route(method, path)[0] == status` `route` 返回元组,`[0]` 是状态码。
- `status, data = route("GET", "/tickets?status=open")` 带查询参数的完整路径直接传进去,和真实请求里 `self.path` 的样子一样。
- `assert {t["id"] for t in data["items"]} == {1001, 1002}` Day 25 的集合推导式,不关心顺序,只关心是哪几张。

</div>

```bash
uv run pytest tests/test_mini_server.py -v
```

实跑输出(每行末尾的百分比我删了):

```text
tests/test_mini_server.py::test_route_status[index] PASSED
tests/test_mini_server.py::test_route_status[list] PASSED
tests/test_mini_server.py::test_route_status[one-ticket] PASSED
tests/test_mini_server.py::test_route_status[no-such-ticket] PASSED
tests/test_mini_server.py::test_route_status[bad-id] PASSED
tests/test_mini_server.py::test_route_status[no-such-path] PASSED
tests/test_mini_server.py::test_route_status[bad-method] PASSED
tests/test_mini_server.py::test_filter_by_status PASSED
============================== 8 passed in 0.25s ===============================
```

8 个用例 0.25 秒跑完,一个网络请求都没发。

</details>

**练习 2:加一个健康检查接口。** 线上服务通常有一个 `GET /health`,让部署平台定时来问「你还活着吗」。给 `mini_server.py` 加上它,返回 `{"ok": true, "tickets": 工单总数}`。要求只加一个处理函数、改一行路由表,`route` 函数一个字都不动。

<details><summary>参考答案</summary>

在 `ROUTES = ...` 那一行上面加一个函数,再改 `ROUTES`:

```python
# agent-zero-lab/part01/mini_server.py(新增的函数和改过的路由表)
def health(query: Query) -> Reply:
    return 200, {"ok": True, "tickets": len(TICKETS)}


ROUTES = {"/": index, "/tickets": list_tickets, "/health": health}
```

<div class="line-notes">

- `def health(query: Query) -> Reply:` 和其他处理函数签名一样,所以能被 `route` 用同一种方式调用。
- `return 200, {"ok": True, "tickets": len(TICKETS)}` Python 的 `True` 经过 `json.dumps` 会变成 JSON 的 `true`。
- `ROUTES = {"/": index, "/tickets": list_tickets, "/health": health}` 只改这一行,登记新路径。

</div>

重启服务器后:

```bash
curl -sS -w "  [%{http_code}]\n" http://127.0.0.1:8000/health
curl -sS -w "  [%{http_code}]\n" "http://127.0.0.1:8000/health?verbose=1"
```

实跑输出:

```text
{"ok": true, "tickets": 3}  [200]
{"ok": true, "tickets": 3}  [200]
```

第二条带了一个没人认识的查询参数 `verbose=1`,也正常返回,多余的查询参数会被忽略,这是绝大多数服务器的默认行为。加完再跑一次 `uv run pytest -q`,原来的测试全过。路由表的好处在这里体现出来了:加一个接口,改的地方很集中,不会碰到别的接口的代码。

</details>

**练习 3(观察题):URL 里直接写中文。** 服务器开着,运行 `curl -s "http://127.0.0.1:8000/tickets?status=开"`。看返回结果和服务器日志里那一行,解释发生了什么,再说说正确的写法。

<details><summary>参考答案</summary>

实跑 curl 的输出:

```text
{"count": 0, "items": []}
```

服务器日志:

```text
127.0.0.1 - - [22/Oct/2026 13:32:41] "GET /tickets?status=å¼\x80 HTTP/1.1" 200 -
```

`开` 变成了 `å¼\x80` 这样的乱码。curl 把中文按 UTF-8 的原始字节直接塞进了请求行(`开` 是三个字节),没有做 URL 编码;而 HTTP 规定请求行里只能是 ASCII 字符,`http.server` 读请求行时按 latin-1 把每个字节当成一个字符,三个字节就成了三个怪字符。`status` 的值是这三个怪字符,和任何工单的状态都对不上,于是返回 0 张,还是 200,看起来像「没有符合条件的工单」,其实是请求本身坏了。

正确写法是让 curl 做 URL 编码:

```bash
curl -s -G --data-urlencode "status=开" http://127.0.0.1:8000/tickets
```

<div class="line-notes">

- `curl -s -G --data-urlencode "status=开"` `-G` 把后面 `--data-urlencode` 的内容拼到 URL 的 `?` 后面,发 GET 请求;`--data-urlencode` 把值按 URL 规则编码,`开` 会变成 `%E5%BC%80`,`parse_qs` 再解码回中文。

</div>

浏览器的地址栏和前端的 `fetch`、`URLSearchParams` 会自动编码,所以前端很少碰到这个问题;命令行和自己拼 URL 的后端代码里就要小心。后天你会看到 FastAPI 背后的 uvicorn 对这种请求更严格,直接拒收。

</details>

**练习 4:路由表也管方法。** 现在 `route` 里写死了「不是 GET 就 405」。改成路由表的键是 `(方法, 路径)` 元组,比如 `("GET", "/tickets")`,这样以后加 POST 接口只要往表里加一行。路径对、方法不对仍然回 405;路径不存在回 404。用练习 1 的测试验证改完行为不变。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part01/mini_server.py(改过的路由表和 route)
ROUTES = {
    ("GET", "/"): index,
    ("GET", "/tickets"): list_tickets,
}


def route(method: str, raw_path: str) -> Reply:
    parts = urlsplit(raw_path)
    handler = ROUTES.get((method, parts.path))
    if handler is not None:
        return handler(parse_qs(parts.query))
    if any(path == parts.path for _, path in ROUTES):
        return 405, {"error": f"不支持的方法: {method}"}
    if parts.path.startswith("/tickets/"):
        if method != "GET":
            return 405, {"error": f"不支持的方法: {method}"}
        return get_ticket(parts.path.removeprefix("/tickets/"))
    return 404, {"error": f"没有这个路径: {parts.path}"}
```

<div class="line-notes">

- `("GET", "/"): index,` 元组可以当字典的键(Day 22 说过元组不可变,所以能当键;列表不行)。
- `handler = ROUTES.get((method, parts.path))` 用「方法 + 路径」一起查。注意两层括号:外层是函数调用,内层是元组。
- `if any(path == parts.path for _, path in ROUTES):` 没查到时,看看是不是「路径存在、只是方法不对」。遍历字典得到的是键,也就是一个个 `(方法, 路径)` 元组,解包时方法用不到,写成 `_`。`any(...)` 只要有一个为真就是真。
- `if method != "GET":` 带路径参数的那条路由不在表里,单独判断方法。
- `return 404, {"error": f"没有这个路径: {parts.path}"}` 路径完全没有,404。

</div>

改完跑练习 1 的测试,我这里 `8 passed`,行为没变。你会发现带路径参数的那条路由还是要单独写 if,表里放不进去。要让 `("GET", "/tickets/{id}")` 也能写进表里,就得自己实现「模板匹配」,这已经是在写一个框架了。这正是后天要换 FastAPI 的理由。做完这题,把 `mini_server.py` 恢复成第 6 步的版本(或者保留新版也行,测试都能过),明天以后不再改它。

</details>

**验收标准:** `uv run python -m part01.mini_server` 起来以后,第 6 步那 8 条请求的状态码依次是 200、200、200、200、404、400、404、405;`uv run pytest -q` 全绿;能不看文章说出一个响应由哪四个调用依次写出,以及 `Content-Length` 为什么要对 bytes 求长度。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 路由(routing) | 根据请求的方法和路径,决定交给哪个函数处理。`ROUTES` 字典和 `route` 函数就是路由 |
| 处理函数(handler) | 真正干活的函数,拿到请求里的参数,算出要回的状态码和数据。Express 里 `app.get` 的第二个参数 |
| 路由表 | 「路径 → 处理函数」的对照表,加接口时往里加一行 |
| 路径参数 | 放在路径里的变量,比如 `/tickets/1002` 里的 `1002` |
| 查询参数 | `?` 后面的 `key=value`,比如 `status=open`,用 `parse_qs` 拆 |
| `BaseHTTPRequestHandler` | 标准库里处理单个 HTTP 请求的基类,按方法调用 `do_GET`、`do_POST` |
| `HTTPServer` | 标准库里的服务器类,绑定地址和端口,`serve_forever()` 一直接请求 |
| `send_response` / `send_header` / `end_headers` / `wfile.write` | 依次写状态行、一个响应头、头结束的空行、响应体 |
| `wfile` | 通往客户端的输出流,只能写 bytes |
| bytes | 字节序列,网络上传输的就是它;字符串要 `.encode("utf-8")` 才能变成 bytes |
| `Content-Length` | 响应体的字节数,写错了客户端会截断或一直等 |
| `urlsplit` / `parse_qs` | 标准库里拆 URL 和拆查询字符串的函数,后者每个值都是列表 |
| 临时端口 | 客户端发请求时操作系统临时分配的端口,比如 `client_address` 里的 62569 |
| 400 / 404 / 405 / 501 | 请求格式不对 / 资源不存在 / 这个地址不接受这个方法 / 服务器根本不支持这个方法 |
| Empty reply from server | curl 的报错:连上了,但服务器什么都没回就关了连接,通常是服务端处理时抛了异常 |
| 类型别名 | `Query = dict[str, list[str]]`,给一个类型起短名字,≈ TS 的 `type` |

## 常见误区

**往 `wfile` 里写字符串。** 报 `TypeError: a bytes-like object is required, not 'str'`,而且如果这时状态行已经发出去了,客户端收到的是 200 加空内容。先 `.encode("utf-8")`。

**`Content-Length` 写成字符数。** 纯英文时看不出问题,一有中文就被截断,最后一个字变成 `�`。第 1 步实测 14 个字符、38 个字节。对 encode 之后的 bytes 求 `len`。

**边算边发。** 先 `send_response(200)`,然后再去查数据,查的时候出错了,状态码已经改不回来了。先把状态码和 body 全部算好,最后一口气发。第 6 步的 `reply` 就是这个结构。

**只看客户端,不看服务器日志。** 客户端只看到 `Empty reply from server` 或者一个 500,真正的原因(哪个文件哪一行抛了什么异常)只在服务器窗口的 traceback 里。排查后端问题第一件事是看服务端日志。

**以为查询参数是数字。** `parse_qs` 拿到的都是字符串,`"2"` 不是 `2`,而且可能是 `"abc"`。转换之前先检查,不然 `int("abc")` 的 `ValueError` 就会变成客户端的 Empty reply。

**URL 里的 `?` 没加引号。** zsh 报 `no matches found`,请求根本没发出去。带 `?` 和 `&` 的 URL 一律加双引号。

**在命令行里直接写中文查询参数。** curl 不会自动编码,服务器收到的是乱码,还会返回 200 让你以为没问题。用 `-G --data-urlencode`。

**把整个请求头打进日志。** 里面有 `Authorization`,也就是用户的密钥。第 2 步为了教学打印了,真实服务里只记需要的几个字段。

## 学习资料

### 文档与文章

- [Python 文档 · http.server](https://docs.python.org/zh-cn/3/library/http.server.html):中文。看 `BaseHTTPRequestHandler` 一节,`command`、`path`、`headers`、`rfile`、`wfile` 这些属性和 `send_response`、`send_header`、`end_headers` 方法都在里面,今天用到的全在这一节。
- [Python 文档 · urllib.parse](https://docs.python.org/zh-cn/3/library/urllib.parse.html):中文。`urlsplit` 和 `parse_qs` 的完整说明,包括 `keep_blank_values` 参数(不加的话 `?empty=` 这种空值会被丢掉)。
- [MDN · HTTP 概述](https://developer.mozilla.org/zh-CN/docs/Web/HTTP/Guides/Overview):中文。「HTTP 流」一节讲客户端和服务器一来一回的步骤,和今天开头那张图是一回事。
- [MDN · HTTP 消息](https://developer.mozilla.org/zh-CN/docs/Web/HTTP/Guides/Messages):中文。请求和响应的结构图:起始行、头、空行、体。对照第 1 步的四个调用读。
- [Express · Routing(英文)](https://expressjs.com/en/guide/routing.html):如果你写过一点 Node,看看 Express 的路由写法,今天的 `ROUTES` 和 `route` 就是它的极简版,`/tickets/:id` 这种路径参数是怎么写的也在这页。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1s44y117vK&autoplay=0&high_quality=1" title="在浏览器输入URL回车之后发生了什么?" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>技术蛋老师 · 在浏览器输入URL回车之后发生了什么? · 6 分钟。动画讲从 DNS、TCP 连接到服务器处理、返回响应的全过程。今天写的代码是其中「服务器处理请求、返回响应」那一小段,看完能知道它在整条链路里的位置。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1UV411h7Mv&autoplay=0&high_quality=1" title="一节课彻底搞懂前端后端的关系,到底什么是接口?概念与实战" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>耕耕技术宅 · 一节课彻底搞懂前端后端的关系,到底什么是接口?概念与实战 · 30 分钟。从前端的角度讲「接口」到底是什么、后端拿到请求做了什么,和今天「前端只看到一行请求,后端是一串函数」的视角一致。看前 15 分钟的概念部分就够。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/RnRyM2tOlvk" title="Python HTTP Servers || Built-in http.server, Flask & FastAPI" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Socratica · Python HTTP Servers || Built-in http.server, Flask & FastAPI · 英文。先用标准库 http.server 写服务器,再换成 Flask 和 FastAPI,正好是今天和后天的顺序。今天看 http.server 那一段,后天再看 FastAPI 那段。</figcaption>
</figure>

### 书籍

- 上野宣,《图解 HTTP》,于均良译,人民邮电出版社,2014。第 3 章「HTTP 报文内的 HTTP 信息」和第 4 章「返回结果的 HTTP 状态码」,前者对应今天拼响应的四个调用,后者能帮你分清 400、404、405、501。

### 开源项目与代码

- [python/cpython 的 Lib/http/server.py](https://github.com/python/cpython/blob/main/Lib/http/server.py):搜 `def handle_one_request`,能看到它怎么读请求行、拼出 `do_` 加方法名去找方法、找不到就 `send_error(501, ...)`,今天第 1 步 POST 回 501 就是这里来的。再搜 `def send_response`,看它怎么顺手加上 `Server` 和 `Date` 两个头。

## 自测

1. 一个 HTTP 响应由哪几部分组成?在 `BaseHTTPRequestHandler` 里分别用哪个调用写出?

<details><summary>答案</summary>

状态行、响应头、空行、响应体。分别对应 `send_response(状态码)`(它还会自动加 Server 和 Date 头)、`send_header(名字, 值)`(每个头调一次)、`end_headers()`、`wfile.write(字节)`。

</details>

2. `self.path` 的值是 `/tickets?status=open&limit=2`,怎么拿到路径和 `limit`?`limit` 是什么类型?

<details><summary>答案</summary>

`parts = urlsplit(self.path)`,`parts.path` 是 `/tickets`;`parse_qs(parts.query)` 得到 `{'status': ['open'], 'limit': ['2']}`,`limit` 用 `query["limit"][0]` 取,是字符串 `"2"`,要当数字用得先检查再 `int()`。

</details>

3. 处理函数在 `send_response(200)` 之后抛了异常,客户端看到什么?如果在发送任何东西之前抛,又看到什么?服务器会停吗?

<details><summary>答案</summary>

前一种:状态码已经是 200,客户端收到 200 但内容是空的或不完整;后一种:客户端收到 `Empty reply from server`,没有状态码。两种情况服务器都不会停,`HTTPServer` 会打印 traceback 然后继续处理下一个请求。

</details>

4. 为什么把 `route` 写成「字符串进、元组出」的普通函数,而不是直接写在 `do_GET` 里?

<details><summary>答案</summary>

一是能离线测试:不用起服务器、不用发请求,直接调 `route("GET", "/tickets/abc")` 断言返回值;二是业务逻辑和网络读写分开,换框架时处理函数基本能原样搬过去,只换掉读写请求那一层。

</details>

5. 面试题:前端同事反馈「你这个接口有时候返回 200 但数据是空的」,但你本地测是好的。结合今天的内容,你会从哪些方向查?

<details><summary>答案</summary>

先看服务端日志,找那个时间点有没有 traceback:很可能是处理过程中先发出了状态行和头,之后在生成 body 时出错(比如某些数据里有特殊值导致序列化失败、某个字段为空导致异常),于是状态码已经是 200 但 body 没写完。再看 `Content-Length` 是否按字节计算,中文数据会让按字符算的长度偏小,导致客户端截断。修法是先完整算出 body 再发送,异常时统一回 500 和错误信息,并为出问题的数据补一个测试用例。

</details>

## 明天预告

Day 79 · FastAPI(一):路由、路径参数和查询参数。今天花了 60 行才做出一个只支持 GET、路径参数要手动截字符串、类型要自己检查的小服务,练习 4 还发现路由表放不下 `/tickets/{id}` 这种模板。明天换成 FastAPI,同样的三个接口,路由用一行 `@app.get("/tickets/{ticket_id}")` 登记,工单号写成 `ticket_id: int` 它就自动转换和校验,不对就回 422。你会清楚地看到它替你接管了今天的哪几步。
