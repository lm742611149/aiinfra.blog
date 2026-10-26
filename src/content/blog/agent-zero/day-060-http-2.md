---
title: 'Day 60 · HTTP(二):状态码和 header'
description: '昨天只看了请求,服务器回的永远是随手写的 200。今天换到响应那一头:状态行里的三位数字分五类、各代表谁的责任,301 为什么要配 Location、401 为什么要配 WWW-Authenticate,401 和 403 差在哪。自己写一个会回各种状态码的小服务器,用 curl 亲手制造 404、401、500,再看 Python 的 urlopen 遇到 4xx 会怎么炸,最后去真实网站上对一遍。'
pubDate: 2026-10-23
regime: none
tags: ['http', 'agent-zero']
series: 'agent-zero'
day: 60
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 59](/blog/agent-zero/day-059-http-1/) 把一次请求拆开看了:URL 的六段,请求行、请求头、空行、body 四部分,GET 把条件放在查询串里、POST 把要交的东西放在 body 里。你还写了一个二十几行的 `echo_server.py`,它把收到的请求原样打印出来,不管是 curl 还是 Python 发的。

但那个服务器有一个毛病:不管你发什么,它都回 `200`。真实世界里服务器会说很多种话:「找不到」「你没登录」「搬家了」「我这边坏了」。这些话不是靠 body 里的文字传达的,而是靠**响应第一行里的三位数字**。你在 Network 面板里看到的红色的行,就是这些数字在报警。今天专门讲响应,两件事:状态码,还有昨天只是打了个照面的 header。

## 今天要解决的问题

学完今天,你应该能:

1. 指着一段 `curl -i` 的输出,说出**状态行、响应头、空行、body** 各是哪几行;把任意一个状态码归进 **2xx / 3xx / 4xx / 5xx** 四类,并说出「这是谁的责任」。
2. 说清 `200`、`201`、`204`、`301`、`401`、`403`、`404`、`500` 各在什么时候出现,知道 `301` 必须配 `Location`、`401` 应该配 `WWW-Authenticate`,以及 `401` 和 `403` 的区别。
3. 写一个按路径回不同状态码的小服务器,用 curl 亲手制造一次 `404`、一次 `401`、一次 `500`;用 `-w`、`-f`、`-L` 三个开关让 curl 只报状态码、遇错退出、跟着跳转走。
4. 知道 header 是「名字: 值」、名字不分大小写、客户端和服务器各有一套常用的;在 Python 里用 `HTTPError` 接住 4xx/5xx,读出状态码和响应头。

预计用时:2.5 小时。前置:[Day 59](/blog/agent-zero/day-059-http-1/)(今天的服务器是在它的 `echo_server.py` 基础上改的,`curl -v`、`-H` 这些开关也要会)、[Day 36](/blog/agent-zero/day-036-exceptions-2/) 的 `try/except`(今天服务器要靠它接住崩溃)、[Day 42](/blog/agent-zero/day-042-classes-2/) 的继承。

学法:先对照文章逐行敲一遍(不要复制粘贴)并跑通;第二天合上文章,把「状态码分类表」和「按路径回不同状态码的服务器」默写出来;再做动手练习,做不出来再展开参考答案,看完关掉自己重写一遍。

今天不调大模型 API,花费 0 元。请求发给自己电脑上的小服务器(`127.0.0.1:8765`),最后一节去三个公开网站看几眼真实的状态码,都是只读的。代码放在 `agent-zero-lab/part01/`,在仓库根目录用 `uv run python part01/xxx.py` 运行。环境和昨天一样:curl `8.1.2`,Python `3.12.13`,家目录写成 `/Users/你`。我的终端设了代理,所以访问外网的命令带 `--noproxy '*'`,你不用写。**没实跑的**:浏览器 DevTools 的界面描述,其余全部真跑。

## 从你熟悉的地方讲起:Network 面板里红色的那一行

打开 Network 面板,有一列叫 Status(状态)。绝大多数行是 `200`,偶尔有 `304`,出问题的时候会冒出红色的 `404`、`500`,或者你调接口时最常见的 `401`。你多半已经有一套经验:`404` 是地址写错了,`500` 是后端挂了,`401` 是 token 过期了。这套经验是对的,今天要做的是把它变成系统的知识:这三位数字是怎么分类的,每一类意味着**谁该去修**,以及服务器怎么把它写进响应里。

先看一个完整的响应。昨天用的 `curl -v` 把请求和响应都打印出来,今天只关心响应,换 `-i`(include,把响应头也包含进输出):

```bash
curl -i --noproxy '*' http://example.com/nope
```

<div class="line-notes">

- `curl -i --noproxy '*' http://example.com/nope` `-i` 让 curl 在正文前面把状态行和响应头也打印出来;不加 `-i` 只有正文。`/nope` 是我随便写的一个不存在的路径,故意要一个 404。`--noproxy '*'` 是我绕自己的代理用的,你不用写。

</div>

实测输出(响应头我只留了前三条,后面还有 `Server: cloudflare` 等六七条;正文是一段 HTML,我截掉了尾巴):

```text
HTTP/1.1 404 Not Found
Date: Fri, 23 Oct 2026 08:20:09 GMT
Content-Type: text/html; charset=utf-8
Transfer-Encoding: chunked

<!doctype html><html lang=en><head><meta charset=utf-8>...<title>Example Domain</title>...
```

<div class="line-notes">

- `HTTP/1.1 404 Not Found` 第一行是**状态行**,三段:协议版本 `HTTP/1.1`、**状态码** `404`、**原因短语** `Not Found`。状态码是给程序看的,原因短语是给人看的,程序只认数字。
- `Date: Fri, 23 Oct 2026 08:20:09 GMT` 从这里开始是**响应头**,格式和请求头一样,每行「名字: 值」。`Date` 是服务器的时钟,注意是 GMT。
- `Content-Type: text/html; charset=utf-8` 告诉你 body 是 HTML、UTF-8 编码。浏览器就是靠这一行决定「把 body 当网页渲染」还是「当文件下载」。
- `Transfer-Encoding: chunked` body 是分块传的,没有 `Content-Length`。今天不展开,知道「长度可以不预先声明」就行。
- `<!doctype html><html lang=en>` 空行之后是 body。注意:**404 也有 body**,example.com 回了一个完整的页面。状态码和 body 是两回事,后面会反复看到。

</div>

<figure>
<svg viewBox="0 0 640 250" role="img" aria-label="一次 HTTP 响应的文字结构:第一行状态行(协议版本、状态码、原因短语),接着若干行响应头(名字: 值),然后一个空行,再后面是 body。和请求的结构一一对应,只有第一行不同">
<rect x="0" y="0" width="640" height="250" fill="var(--paper-raised)" rx="6"/>
<g font-family="var(--font-mono)" font-size="12">
<rect x="16" y="20" width="360" height="30" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="28" y="40" fill="var(--ink)">HTTP/1.0 404 Not Found</text>
<rect x="16" y="50" width="360" height="78" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="28" y="70" fill="var(--ink)">Server: BaseHTTP/0.6 Python/3.12.13</text>
<text x="28" y="90" fill="var(--ink)">Content-Type: text/plain; charset=utf-8</text>
<text x="28" y="110" fill="var(--ink)">Content-Length: 26</text>
<rect x="16" y="128" width="360" height="22" fill="var(--paper-raised)" stroke="var(--rule)" stroke-dasharray="4 3"/>
<text x="28" y="144" fill="var(--ink-faint)" font-size="11">(空行)</text>
<rect x="16" y="150" width="360" height="40" fill="var(--paper-raised)" stroke="var(--rule)" stroke-dasharray="4 3"/>
<text x="28" y="174" fill="var(--ink)">没有 /nope 这个页面</text>
<text x="396" y="40" fill="var(--ink)" font-size="12">状态行</text>
<text x="396" y="56" fill="var(--ink-soft)" font-size="11">版本  状态码  原因短语</text>
<text x="396" y="92" fill="var(--ink)" font-size="12">响应头</text>
<text x="396" y="108" fill="var(--ink-soft)" font-size="11">每行「名字: 值」</text>
<text x="396" y="144" fill="var(--ink)" font-size="12">空行</text>
<text x="396" y="160" fill="var(--ink-soft)" font-size="11">「头结束了」</text>
<text x="396" y="182" fill="var(--ink)" font-size="12">body</text>
<text x="396" y="198" fill="var(--ink-soft)" font-size="11">404 也可以有 body</text>
<text x="16" y="230" fill="var(--ink-faint)" font-size="11">和昨天的请求结构逐行对应:请求行 ↔ 状态行,请求头 ↔ 响应头,其余一样</text>
</g>
</svg>
<figcaption>响应和请求长得几乎一样,只有第一行不同:请求行说「我要什么」,状态行说「结果如何」。</figcaption>
</figure>

和昨天那张请求结构图对比,你会发现两者几乎是镜像的。HTTP 就是这么朴素:两边都是「一行摘要、若干行头、一个空行、可选的 body」。

## 第一步:三位数字分五类

**状态码**(status code)是一个三位数,第一位决定类别,后两位是细分。类别只有五种:

| 第一位 | 类别 | 意思 | 谁的责任 |
| --- | --- | --- | --- |
| `1xx` | 信息 | 「收到,继续」。很少见,你基本碰不到 | 无 |
| `2xx` | 成功 | 请求被正确处理了 | 无 |
| `3xx` | 跳转 | 「东西不在这,去别处找」或「你那份还是新的,不用重传」 | 客户端照着跳 |
| `4xx` | 客户端的错 | 地址不对、没登录、没权限、body 格式错 | **你**(发请求的一方)去改 |
| `5xx` | 服务器的错 | 服务器自己崩了、后面的数据库挂了、过载 | **服务器那边**去修 |

最后一列最有用。排查问题时第一眼看第一位数字:`4` 开头先查自己的请求,`5` 开头先去找后端(或者看后端日志)。这个习惯以后调大模型 API 会每天用到:`401` 是 key 错了,`429` 是你发太快了,`500`、`502`、`503` 是厂商那边的问题,不用改代码,等一会儿重试。

<figure>
<svg viewBox="0 0 640 260" role="img" aria-label="状态码五类示意:2xx 成功、3xx 跳转、4xx 客户端的错、5xx 服务器的错,各列出常见码;4xx 标在客户端一侧,5xx 标在服务器一侧">
<rect x="0" y="0" width="640" height="260" fill="var(--paper-raised)" rx="6"/>
<g font-family="var(--font-mono)" font-size="12">
<rect x="16" y="20" width="140" height="100" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="86" y="44" text-anchor="middle" fill="var(--ink)">客户端</text>
<text x="86" y="66" text-anchor="middle" fill="var(--ink-soft)" font-size="11">浏览器 / curl</text>
<text x="86" y="84" text-anchor="middle" fill="var(--ink-soft)" font-size="11">Python 脚本</text>
<rect x="484" y="20" width="140" height="100" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="554" y="44" text-anchor="middle" fill="var(--ink)">服务器</text>
<text x="554" y="66" text-anchor="middle" fill="var(--ink-soft)" font-size="11">status_server.py</text>
<text x="554" y="84" text-anchor="middle" fill="var(--ink-soft)" font-size="11">或任何后端</text>
<line x1="156" y1="50" x2="484" y2="50" stroke="var(--ink-soft)"/>
<text x="320" y="44" text-anchor="middle" fill="var(--ink)" font-size="11">GET /secret</text>
<line x1="484" y1="96" x2="156" y2="96" stroke="var(--ink-soft)"/>
<text x="320" y="90" text-anchor="middle" fill="var(--ink)" font-size="11">401 Unauthorized + WWW-Authenticate</text>
<text x="16" y="150" fill="var(--ink)">2xx 成功</text>
<text x="16" y="168" fill="var(--ink-soft)" font-size="11">200 OK · 201 Created · 204 No Content</text>
<text x="330" y="150" fill="var(--ink)">3xx 跳转</text>
<text x="330" y="168" fill="var(--ink-soft)" font-size="11">301 永久搬家 · 302 临时 · 304 没变</text>
<text x="16" y="200" fill="var(--ink)">4xx 你的错(改请求)</text>
<text x="16" y="218" fill="var(--ink-soft)" font-size="11">400 · 401 · 403 · 404 · 415 · 429</text>
<text x="330" y="200" fill="var(--ink)">5xx 它的错(等/找后端)</text>
<text x="330" y="218" fill="var(--ink-soft)" font-size="11">500 · 502 · 503 · 504</text>
<text x="16" y="246" fill="var(--ink-faint)" font-size="11">第一位数字先告诉你该找谁,后两位再告诉你具体怎么了</text>
</g>
</svg>
<figcaption>看状态码先看第一位:4 开头回头检查自己的请求,5 开头去找服务器那边。</figcaption>
</figure>

每一类里你必须认识的几个,今天都会亲手造出来:

| 状态码 | 原因短语 | 什么时候出现 | 常配的响应头 |
| --- | --- | --- | --- |
| `200` | OK | 成功,body 里是你要的东西 | |
| `201` | Created | 成功**创建**了一个新东西(POST 之后常见,明天会用) | |
| `204` | No Content | 成功,但没有 body(删除之后常回这个) | |
| `301` | Moved Permanently | 永久搬家,以后直接去新地址 | `Location: 新地址` |
| `302` | Found | 临时跳转,下次还来老地址 | `Location` |
| `304` | Not Modified | 你缓存的那份还是新的,不用重传 | |
| `400` | Bad Request | 请求格式不对(明天会用:JSON 写坏了) | |
| `401` | Unauthorized | **没登录**或凭证无效 | `WWW-Authenticate: 用哪种方式登录` |
| `403` | Forbidden | **登录了,但没权限** | |
| `404` | Not Found | 路径对应的资源不存在 | |
| `415` | Unsupported Media Type | body 的类型服务器不认(明天会用) | |
| `429` | Too Many Requests | 发太快了,被限流 | `Retry-After: 几秒后再来` |
| `500` | Internal Server Error | 服务器代码崩了 | |
| `502` / `503` / `504` | Bad Gateway / Service Unavailable / Gateway Timeout | 服务器前面的网关连不上、服务器过载或维护、后端超时 | `503` 有时带 `Retry-After` |

`401` 和 `403` 是最容易混的一对,记法:`401` 的原因短语写的是 Unauthorized,但它真正的意思是「**未认证**」(你是谁我还不知道);`403` 才是「**未授权**」(我知道你是谁,但你不能看这个)。换一个 token 可能解决 `401`,但解决不了 `403`。

## 第二步:写一个会说各种状态码的服务器

昨天的 `echo_server.py` 里有一行 `self.send_response(200)`,状态码就是在这里写的。改成别的数字,状态行就变了。今天写一个新文件 `agent-zero-lab/part01/status_server.py`,按路径回不同的状态码,顺便把「配套的响应头」也带上:

```python
# agent-zero-lab/part01/status_server.py
from http.server import BaseHTTPRequestHandler, HTTPServer

HOST = "127.0.0.1"
PORT = 8765
TOKEN = "cl-demo-token"


class StatusHandler(BaseHTTPRequestHandler):
    def _send(self, code: int, text: str, **extra: str) -> None:
        data = text.encode()
        self.send_response(code)
        self.send_header("Content-Type", "text/plain; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        for name, value in extra.items():
            self.send_header(name.replace("_", "-"), value)
        self.end_headers()
        self.wfile.write(data)

    def _route(self) -> None:
        auth = self.headers.get("Authorization", "")
        if self.path == "/":
            self._send(200, "云簿首页\n")
        elif self.path == "/old-docs":
            self._send(301, "文档搬家了\n", Location="/docs")
        elif self.path == "/docs":
            self._send(200, "这里是新文档\n")
        elif self.path == "/secret":
            if auth == f"Bearer {TOKEN}":
                self._send(200, "机密:下季度涨价 10%\n")
            else:
                self._send(401, "先登录\n", WWW_Authenticate="Bearer")
        elif self.path == "/admin":
            if auth == f"Bearer {TOKEN}":
                self._send(403, "你登录了,但这页只有管理员能看\n")
            else:
                self._send(401, "先登录\n", WWW_Authenticate="Bearer")
        elif self.path == "/boom":
            total = 100 / 0
            self._send(200, f"{total}\n")
        else:
            self._send(404, f"没有 {self.path} 这个页面\n")

    def do_GET(self) -> None:
        try:
            self._route()
        except Exception as e:
            print(f"处理 {self.path} 时出错: {e!r}", flush=True)
            self._send(500, "服务器内部出错,已记录\n")

    def log_message(self, format: str, *args: object) -> None:
        pass


if __name__ == "__main__":
    print(f"监听 http://{HOST}:{PORT},Ctrl+C 退出", flush=True)
    HTTPServer((HOST, PORT), StatusHandler).serve_forever()
```

<div class="line-notes">

- `from http.server import BaseHTTPRequestHandler, HTTPServer` 和昨天一样的两个零件。
- `TOKEN = "cl-demo-token"` 一个假的登录凭证,只给今天演示用。真实系统里 token 是登录后发给你的一长串随机字符,绝不会写死在代码里(Day 53 讲过放 `.env`)。
- `class StatusHandler(BaseHTTPRequestHandler):` 还是继承官方的半成品。
- `def _send(self, code: int, text: str, **extra: str) -> None:` 把昨天的 `_reply` 升级:状态码 `code` 变成参数,不再写死 200;`**extra` 收任意个「名字=值」的关键字参数,用来附加响应头(`**` 收参数的写法 Day 59 练习 5 用过一次)。
- `data = text.encode()` 字符串转 UTF-8 字节,下面要用它的字节数。
- `self.send_response(code)` **写状态行**。传 `404` 它就写 `HTTP/1.0 404 Not Found`,原因短语库里自带,不用你写。它还会自动加 `Server` 和 `Date` 两个响应头。
- `self.send_header("Content-Type", "text/plain; charset=utf-8")` 第一个响应头:body 是纯文本。
- `self.send_header("Content-Length", str(len(data)))` 第二个:body 有多少字节。`"云簿首页\n"` 是 4 个汉字 12 字节加换行 1 字节,所以首页的 `Content-Length` 是 13。
- `for name, value in extra.items():` 遍历附加的头。
- `self.send_header(name.replace("_", "-"), value)` Python 的关键字参数名里不能有 `-`,所以调用时写 `WWW_Authenticate`,这里把下划线换回横线,变成 `WWW-Authenticate`。
- `self.end_headers()` 写空行,头结束。
- `self.wfile.write(data)` 写 body。
- `def _route(self) -> None:` 「路由」:按路径决定回什么。单独拆成一个方法,是为了下面 `do_GET` 能用 `try` 把它整个包起来。
- `auth = self.headers.get("Authorization", "")` 取请求头 `Authorization` 的值,没有就是空字符串。`Authorization` 是客户端放凭证的标准位置,格式通常是 `Bearer 一串token`(bearer 是「持有者」,意思是「谁拿着这串字谁就有权」)。
- `if self.path == "/":` 根路径,回 200。
- `self._send(301, "文档搬家了\n", Location="/docs")` 301 永久跳转,**必须配 `Location` 头**告诉客户端新地址在哪,否则客户端不知道往哪跳。body 可有可无,浏览器不会显示它。
- `elif self.path == "/docs":` 搬家后的新地址。
- `elif self.path == "/secret":` 一个要登录才能看的页面。
- `if auth == f"Bearer {TOKEN}":` 凭证对上了,回 200 和内容。代入:请求头 `Authorization: Bearer cl-demo-token` 时 `auth` 是 `Bearer cl-demo-token`,和 `f"Bearer {TOKEN}"` 相等。
- `self._send(401, "先登录\n", WWW_Authenticate="Bearer")` 否则 401,并带上 `WWW-Authenticate: Bearer`,意思是「用 Bearer token 的方式来登录」。这是规范要求 401 带的头。
- `elif self.path == "/admin":` 管理员页面,用来演示 403。
- `self._send(403, "你登录了,但这页只有管理员能看\n")` 凭证对的,但权限不够:403。注意分支顺序,没凭证照样先回 401。
- `elif self.path == "/boom":` 故意写一个会崩的路径。
- `total = 100 / 0` 除以零,Python 会抛 `ZeroDivisionError`。模拟「后端代码有 bug」。
- `self._send(200, f"{total}\n")` 这一行永远执行不到,但要有它,否则检查器会说 `total` 没用。
- `self._send(404, f"没有 {self.path} 这个页面\n")` 其余所有路径:404。
- `def do_GET(self) -> None:` 收到 GET 就来这里。
- `try:` 把整个路由包起来。
- `except Exception as e:` 任何没预料到的异常都接住(Day 36 讲过 `Exception` 是几乎所有错误的父类)。
- `print(f"处理 {self.path} 时出错: {e!r}", flush=True)` 在服务器这边记一笔,`!r` 是用 `repr` 打印,能看到异常的类型名。
- `self._send(500, "服务器内部出错,已记录\n")` 给客户端回 500,**不把异常细节发出去**(细节里可能有路径、代码、数据,只留在服务器日志)。
- `def log_message(self, format: str, *args: object) -> None:` 和昨天一样关掉默认日志。
- `HTTPServer((HOST, PORT), StatusHandler).serve_forever()` 开始监听。

</div>

终端 1 启动它(端口和昨天一样是 8765,所以昨天的 `echo_server.py` 要先关掉):

```bash
cd ~/agent-zero-lab
uv run python part01/status_server.py
```

```text
监听 http://127.0.0.1:8765,Ctrl+C 退出
```

终端 2 挨个试。先是最普通的两个:

```bash
curl -i http://127.0.0.1:8765/
curl -i http://127.0.0.1:8765/nope
```

实测输出:

```text
HTTP/1.0 200 OK
Server: BaseHTTP/0.6 Python/3.12.13
Date: Fri, 23 Oct 2026 08:19:05 GMT
Content-Type: text/plain; charset=utf-8
Content-Length: 13

云簿首页
```

```text
HTTP/1.0 404 Not Found
Server: BaseHTTP/0.6 Python/3.12.13
Date: Fri, 23 Oct 2026 08:19:05 GMT
Content-Type: text/plain; charset=utf-8
Content-Length: 26

没有 /nope 这个页面
```

两点。`Server` 和 `Date` 我们没写,是 `send_response` 自动加的(`BaseHTTP/0.6 Python/3.12.13` 就是它自报家门;真实网站通常把这个头删掉或改成假的,免得暴露技术栈)。第二,`Content-Length: 26` 怎么来的:`没有` 两个字 6 字节、空格 1、`/nope` 5、空格 1、`这个页面` 四个字 12、换行 1,合计 6 + 1 + 5 + 1 + 12 + 1 = 26。我第一次心算把空格漏了,数成 24;文中这些数字一律以服务器回的为准,自己算只是校验。

### 301:搬家要留新地址

```bash
curl -i http://127.0.0.1:8765/old-docs
curl -L http://127.0.0.1:8765/old-docs
```

<div class="line-notes">

- `curl -i http://127.0.0.1:8765/old-docs` 不带 `-L`,看服务器原始的回答。
- `curl -L http://127.0.0.1:8765/old-docs` `-L` 是 location:**跟着 `Location` 头跳过去**,拿新地址的内容。curl 默认不跟,浏览器默认跟。

</div>

实测输出:

```text
HTTP/1.0 301 Moved Permanently
Server: BaseHTTP/0.6 Python/3.12.13
Date: Fri, 23 Oct 2026 08:19:05 GMT
Content-Type: text/plain; charset=utf-8
Content-Length: 16
Location: /docs

文档搬家了
```

```text
这里是新文档
```

第一条:状态行说 301,`Location: /docs` 说去哪。body 是「文档搬家了」,浏览器根本不会显示它,因为浏览器看到 3xx 就直接按 `Location` 再发一次请求。第二条加了 `-L`,curl 做了同样的事,所以你看到的是 `/docs` 的内容。用 `-v` 看一遍它中间干了什么(只留关键行):

```text
> GET /old-docs HTTP/1.1
< HTTP/1.0 301 Moved Permanently
< Location: /docs
* Issue another request to this URL: 'http://127.0.0.1:8765/docs'
> GET /docs HTTP/1.0
< HTTP/1.0 200 OK
```

两次请求,中间那行 `*` 是 curl 自己说「再发一个」。这解释了一个前端常见的疑惑:为什么 Network 面板里一个 `fetch` 有时显示两行请求,一行 301 一行 200。就是这个。

### 401 和 403:没登录,和登录了没权限

```bash
curl -i http://127.0.0.1:8765/secret
curl -i -H "Authorization: Bearer cl-demo-token" http://127.0.0.1:8765/secret
curl -i -H "Authorization: Bearer cl-demo-token" http://127.0.0.1:8765/admin
```

<div class="line-notes">

- `curl -i http://127.0.0.1:8765/secret` 不带凭证。
- `curl -i -H "Authorization: Bearer cl-demo-token" http://127.0.0.1:8765/secret` 用昨天的 `-H` 加一个请求头 `Authorization`,值是 `Bearer ` 加 token。中间有一个空格。
- `curl -i -H "Authorization: Bearer cl-demo-token" http://127.0.0.1:8765/admin` 同样的凭证去管理员页。

</div>

实测输出:

```text
HTTP/1.0 401 Unauthorized
Server: BaseHTTP/0.6 Python/3.12.13
Date: Fri, 23 Oct 2026 08:19:05 GMT
Content-Type: text/plain; charset=utf-8
Content-Length: 10
WWW-Authenticate: Bearer

先登录
```

```text
HTTP/1.0 200 OK
Server: BaseHTTP/0.6 Python/3.12.13
Date: Fri, 23 Oct 2026 08:19:05 GMT
Content-Type: text/plain; charset=utf-8
Content-Length: 27

机密:下季度涨价 10%
```

```text
HTTP/1.0 403 Forbidden
Server: BaseHTTP/0.6 Python/3.12.13
Date: Fri, 23 Oct 2026 08:19:06 GMT
Content-Type: text/plain; charset=utf-8
Content-Length: 44

你登录了,但这页只有管理员能看
```

第一条 401 带着 `WWW-Authenticate: Bearer`:「你得用 Bearer token 登录」。第二条带上正确的 token 就 200 了。第三条用同一个 token 去 `/admin`,403:服务器认识你,但不让你看。你换十个 token 也还是 403,**这是 401 和 403 最实际的区别**:401 换凭证能解决,403 得找管理员要权限。

顺便验证一下 token 错了会怎样:`curl -i -H "Authorization: Bearer wrong" http://127.0.0.1:8765/secret` 的第一行是 `HTTP/1.0 401 Unauthorized`。凭证有但不对,也是 401,不是 403。

请求头那一边用 `-v` 看一眼,确认 `Authorization` 真的发出去了:

```text
> GET /secret HTTP/1.1
> Host: 127.0.0.1:8765
> User-Agent: curl/8.1.2
> Accept: */*
> Authorization: Bearer cl-demo-token
> 
< HTTP/1.0 200 OK
```

你以后调任何大模型 API,`Authorization: Bearer sk-...` 就是这一行。key 错了回 401,余额没了有的厂商回 402,这些都是今天这张表上的东西。

### 500:服务器自己崩了

```bash
curl -i http://127.0.0.1:8765/boom
```

实测输出:

```text
HTTP/1.0 500 Internal Server Error
Server: BaseHTTP/0.6 Python/3.12.13
Date: Fri, 23 Oct 2026 08:19:53 GMT
Content-Type: text/plain; charset=utf-8
Content-Length: 32

服务器内部出错,已记录
```

终端 1 同时多了一行:

```text
处理 /boom 时出错: ZeroDivisionError('division by zero')
```

客户端只知道「服务器坏了」,细节留在服务器日志里。这是 `do_GET` 里那个 `try/except` 的功劳。**如果没有它会怎样?** 我把 `do_GET` 改成直接调 `self._route()`、不包 `try`,再发一次同样的请求:

```text
curl: (52) Empty reply from server
```

curl 退出码 52:「服务器什么都没回」。因为异常冲出了 `do_GET`,`http.server` 把连接直接关了,一个字节都没写。服务器那边则打出了几十行的 Traceback,最后一行是 `ZeroDivisionError: division by zero`。对比一下:有 `try` 的时候客户端收到一个干净的 500,可以据此重试或者报错;没有的时候客户端只看到「空响应」,根本分不清是网络断了还是服务器崩了。**后端代码的最外层一定要有一道兜底,把崩溃翻译成 500。** 后面学 FastAPI 时框架会替你做这件事,但你得知道它在做什么。

## 第三步:让 curl 更好用的三个开关

前面每次都 `-i` 看整段,排查的时候常常只想要那个数字。三个开关:

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:8765/nope
curl -sS -f http://127.0.0.1:8765/nope
echo "exit=$?"
curl -s -f http://127.0.0.1:8765/
echo "exit=$?"
```

<div class="line-notes">

- `curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:8765/nope` `-o /dev/null` 丢掉 body,`-w` 是 write-out:按你给的模板打印一行,`%{http_code}` 会被替换成状态码。这条组合你以后写 shell 脚本检查服务有没有活着会天天用。
- `curl -sS -f http://127.0.0.1:8765/nope` `-f` 是 fail:**遇到 4xx/5xx 就当失败**,不打印 body,退出码变成 22。`-sS` 是静默但保留错误信息。
- `echo "exit=$?"` 看上一条命令的退出码(Day 5 讲过 `$?`)。
- `curl -s -f http://127.0.0.1:8765/` 对比:200 的时候 `-f` 什么都不做。

</div>

实测输出:

```text
404
curl: (22) The requested URL returned error: 404
exit=22
云簿首页
exit=0
```

不加 `-f` 的时候,curl 拿到 404 照样退出码 0,因为对 curl 来说「请求发出去并收到了回答」就算成功。这坑过很多人:脚本里 `curl ... && echo 成功`,结果服务器回 500 也打印「成功」。要让状态码影响退出码,必须加 `-f`。

第三个开关 `-L` 刚才用过。把今天用到的几个和昨天的放一起:

| 开关 | 做什么 |
| --- | --- |
| `-i` | 输出里包含状态行和响应头 |
| `-I` | 发 HEAD 请求,只要响应头(我们的服务器没写 `do_HEAD`,会回 501,练习 1 会补) |
| `-v` | 请求和响应全打印(`>` 发出,`<` 收到,`*` curl 自己的话) |
| `-L` | 跟着 3xx 的 `Location` 跳 |
| `-f` | 4xx/5xx 时退出码 22 |
| `-w "%{http_code}"` | 按模板打印状态码等信息 |
| `-o /dev/null` | 丢掉 body |
| `-H "名字: 值"` | 加请求头 |

## 第四步:header 的规矩

昨天和今天你已经见过十来个 header 了。把规矩说清楚:

**格式**是「名字: 值」,冒号后面一个空格,一行一个。**名字不区分大小写**:`Content-Type`、`content-type`、`CONTENT-TYPE` 是同一个头。HTTP/1.1 里习惯写成首字母大写加横线,HTTP/2 则规定一律小写(等会儿去 GitHub 看真实响应时你会看到全小写的头)。验证一下,服务器还开着:

```bash
curl -s -o /dev/null -w "%{http_code}\n" -H "AUTHORIZATION: Bearer cl-demo-token" http://127.0.0.1:8765/secret
curl -s -o /dev/null -w "%{http_code}\n" -H "authorization: bearer cl-demo-token" http://127.0.0.1:8765/secret
```

<div class="line-notes">

- `curl -s -o /dev/null -w "%{http_code}\n" -H "AUTHORIZATION: Bearer cl-demo-token" http://127.0.0.1:8765/secret` 头的**名字**全大写。
- `curl -s -o /dev/null -w "%{http_code}\n" -H "authorization: bearer cl-demo-token" http://127.0.0.1:8765/secret` 名字全小写,而且把**值**里的 `Bearer` 也改成了小写。

</div>

实测输出:

```text
200
401
```

第一条 200:名字大小写无所谓,服务器里 `self.headers.get("Authorization")` 照样取到了。第二条 401:**值是区分大小写的**,我们的服务器比较的是 `auth == "Bearer cl-demo-token"`,`bearer` 对不上。规范里 `Bearer` 这个词本身不分大小写,但 token 那一串一定分,而且大多数服务器实现(包括我们这个)整体精确比较,所以**照文档的写法原样写**最省事。

**值的形状**没有统一规定,每个头自己定:`Content-Length` 是整数,`Content-Type` 是「类型; 参数」,`Date` 是固定格式的英文日期,`Authorization` 是「方式 凭证」。自定义头习惯以 `X-` 开头(`X-Debug`、`X-Request-Id`),规范已经不推荐这个前缀了,但大家还在用。

请求头和响应头是两套词汇,各自常用的:

| 请求头(客户端发) | 意思 | 你会在哪遇到 |
| --- | --- | --- |
| `Host` | 要哪个网站 | 每个请求都有 |
| `User-Agent` | 我是谁(浏览器 / curl / Python-urllib) | 爬虫被拒时 |
| `Accept` | 我想要什么类型的响应(`*/*`、`application/json`) | 明天 |
| `Accept-Encoding` | 我能解压什么(`gzip`) | 昨天 Python 发的 `identity` |
| `Authorization` | 凭证,`Bearer token` 或 `Basic 账号密码` | 今天;以后每个 API |
| `Content-Type` | body 是什么格式 | 明天的主角 |
| `Content-Length` | body 多少字节 | 昨天 |
| `Cookie` | 浏览器带的会话标识 | 网页登录态 |

| 响应头(服务器回) | 意思 | 你会在哪遇到 |
| --- | --- | --- |
| `Content-Type` | body 是什么格式 | 每个响应 |
| `Content-Length` | body 多少字节 | 每个响应 |
| `Location` | 跳转去哪 | 3xx;`201` 也常用它说「新东西在这」 |
| `WWW-Authenticate` | 用什么方式登录 | 401 |
| `Set-Cookie` | 让浏览器存一个 cookie | 登录成功之后 |
| `Cache-Control` | 能缓存多久 | 静态资源 |
| `Retry-After` | 几秒后再来 | 429、503 |
| `Date` / `Server` | 服务器时间 / 服务器软件 | 每个响应 |
| `X-RateLimit-*` | 限流额度还剩多少 | GitHub、大模型 API |

不用背。你需要的是看到一个头名字能猜出它大概在说什么,具体含义当场查 MDN(学习资料里有链接)。

## 第五步:Python 里怎么看状态码

curl 看完了,回到以后真正要写的东西:Python 脚本调接口,拿到 404、401 的时候会发生什么?先故意踩一次。服务器开着,随便跑一行:

```bash
uv run python -c 'from urllib.request import urlopen
with urlopen("http://127.0.0.1:8765/nope") as r: print(r.status)'
```

实测输出(Traceback 只留最后几行):

```text
  File "/Users/你/.local/share/uv/python/cpython-3.12.13-macos-x86_64-none/lib/python3.12/urllib/request.py", line 639, in http_error_default
    raise HTTPError(req.full_url, code, msg, hdrs, fp)
urllib.error.HTTPError: HTTP Error 404: Not Found
```

和 curl 不一样:**`urlopen` 把 4xx 和 5xx 当成异常抛出来**,根本走不到 `print`。异常类型是 `urllib.error.HTTPError`,它里面带着状态码、原因短语、响应头,甚至 body。所以 Python 里看状态码的标准写法是 `try` 一下。新建 `agent-zero-lab/part01/check_status.py`:

```python
# agent-zero-lab/part01/check_status.py
from urllib.error import HTTPError
from urllib.request import Request, urlopen

BASE = "http://127.0.0.1:8765"


def check(path: str, token: str | None = None) -> None:
    headers = {"Authorization": f"Bearer {token}"} if token else {}
    req = Request(f"{BASE}{path}", headers=headers)
    try:
        with urlopen(req) as resp:
            print(f"{path:10} -> {resp.status} 最终地址 {resp.url}")
            print("   body:", resp.read().decode().strip())
    except HTTPError as e:
        print(f"{path:10} -> {e.code} {e.reason}")
        print("   WWW-Authenticate:", e.headers.get("WWW-Authenticate"))
        print("   body:", e.read().decode().strip())


check("/")
check("/old-docs")
check("/nope")
check("/secret")
check("/secret", token="cl-demo-token")
check("/admin", token="cl-demo-token")
check("/boom")
```

<div class="line-notes">

- `from urllib.error import HTTPError` 刚才 Traceback 里那个异常类,从 `urllib.error` 导入。
- `from urllib.request import Request, urlopen` 昨天用过的两个。
- `def check(path: str, token: str | None = None) -> None:` 请求一个路径,可选地带 token。`str | None` 是 Day 46 的写法:要么字符串要么没有。
- `headers = {"Authorization": f"Bearer {token}"} if token else {}` 有 token 就造一个带 `Authorization` 的字典,没有就空字典。代入 `token="cl-demo-token"` 得 `{"Authorization": "Bearer cl-demo-token"}`。
- `req = Request(f"{BASE}{path}", headers=headers)` 用 `Request` 构造请求,`headers=` 把字典里的每一对变成一行请求头。等价于 curl 的 `-H`。
- `try:` 下面可能炸。
- `with urlopen(req) as resp:` 发出去。2xx 和 3xx 走这里(3xx 会被自动跟随,见下一条)。
- `print(f"{path:10} -> {resp.status} 最终地址 {resp.url}")` `:10` 是左对齐占 10 个字符。`resp.url` 是**最终**的地址:`urlopen` 默认跟着 301 跳,所以请求 `/old-docs` 时这里是 `.../docs`。
- `print("   body:", resp.read().decode().strip())` 读 body。
- `except HTTPError as e:` 4xx/5xx 到这里。
- `print(f"{path:10} -> {e.code} {e.reason}")` `e.code` 是状态码整数,`e.reason` 是原因短语。
- `print("   WWW-Authenticate:", e.headers.get("WWW-Authenticate"))` `e.headers` 是响应头,用法和请求头一样,`.get` 取不到就是 `None`。
- `print("   body:", e.read().decode().strip())` 出错响应的 body 也能读,很多 API 会把错误原因写在这里(明天会看到 JSON 形式的)。
- `check("/")` 七次调用,把今天的路径走一遍。

</div>

运行:

```bash
uv run python part01/check_status.py
```

实测输出:

```text
/          -> 200 最终地址 http://127.0.0.1:8765/
   body: 云簿首页
/old-docs  -> 200 最终地址 http://127.0.0.1:8765/docs
   body: 这里是新文档
/nope      -> 404 Not Found
   WWW-Authenticate: None
   body: 没有 /nope 这个页面
/secret    -> 401 Unauthorized
   WWW-Authenticate: Bearer
   body: 先登录
/secret    -> 200 最终地址 http://127.0.0.1:8765/secret
   body: 机密:下季度涨价 10%
/admin     -> 403 Forbidden
   WWW-Authenticate: None
   body: 你登录了,但这页只有管理员能看
/boom      -> 500 Internal Server Error
   WWW-Authenticate: None
   body: 服务器内部出错,已记录
```

对照 curl 那几段:每个状态码都对上了。两处值得看:`/old-docs` 在 Python 里直接变成 200,最终地址是 `/docs`,说明 `urlopen` 自动跟了跳转,和 `curl -L` 一样;`/secret` 的 401 那一行,`WWW-Authenticate` 真的从 `e.headers` 里取到了 `Bearer`。

关于「header 名字不分大小写」,在 Python 这边也成立:`resp.headers["content-TYPE"]` 能取到 `text/plain; charset=utf-8`,我实测过。

后面几天会换成更好用的 `httpx`,它的规矩不一样:4xx/5xx 默认**不**抛异常,要你自己 `raise_for_status()`。两种设计各有道理,到 Day 65 再比较。今天记住一点:**状态码在不同的库里可能是异常,也可能是返回值的一个字段,调库之前先看它怎么处理 4xx。**

## 第六步:去真实世界对一遍

自己的服务器怎么写都行,看看别人的。三个公开地址,各代表一类:

```bash
curl -I --noproxy '*' http://github.com
curl -i --http1.1 https://api.github.com/user
```

<div class="line-notes">

- `curl -I --noproxy '*' http://github.com` `-I` 发 HEAD,只要响应头。注意是 `http` 不是 `https`。
- `curl -i --http1.1 https://api.github.com/user` GitHub 的 API,`/user` 是「当前登录用户的资料」,我们没带凭证。`--http1.1` 是为了让头名字按 HTTP/1.1 的习惯大写显示,不加的话走 HTTP/2,头全是小写。

</div>

实测输出(第二条的响应头我删掉了十几条安全相关的,只留和今天有关的):

```text
HTTP/1.1 301 Moved Permanently
Content-Length: 0
Location: https://github.com/
```

```text
HTTP/1.1 401 Unauthorized
Content-Type: application/json; charset=utf-8
X-RateLimit-Limit: 60
X-RateLimit-Remaining: 56
X-RateLimit-Used: 4
X-RateLimit-Resource: core
X-RateLimit-Reset: 1792747080
Content-Length: 120

{
  "message": "Requires authentication",
  "documentation_url": "https://docs.github.com/rest",
  "status": "401"
}
```

第一条:用 `http` 访问 GitHub,它回 301 让你去 `https://github.com/`,`Content-Length: 0` 没有 body。几乎所有正经网站都这么做,这就是为什么你在地址栏敲 `http://` 最后总是变成 `https://`。

第二条信息量大。401 和我们的服务器一样,但 body 是 **JSON**,里面用人话说了原因(明天讲 JSON)。还有四个 `X-RateLimit-*` 头:没登录的客户端每小时限 60 次,我已经用了 4 次,还剩 56,`Reset` 是额度重置的时间戳(`1792747080` 换算是 2026-10-23 09:18 UTC)。大模型 API 的限流头是一样的思路,名字略有不同。这些头不在任何标准里,是 GitHub 自己定的,**所以读 API 文档时要专门找「它有哪些自定义响应头」**。

还有一个你今天最开始就见过的:`curl -i http://example.com/nope` 回 404,body 却是一个完整的 HTML 页面(example.com 对任何路径都回同一个页面)。状态码说「没找到」,body 说「这是示例域名」,两者各说各的,程序该信状态码。

## 零件对照表

| 零件 | 做什么 | 在哪里用到 |
| --- | --- | --- |
| `send_response(code)` | 写状态行,原因短语自动补 | `status_server.py` 的 `_send` |
| `send_header(名, 值)` | 写一个响应头 | `_send`;`Location`、`WWW-Authenticate` |
| `self.headers.get("Authorization", "")` | 读请求头,名字不分大小写 | `_route` |
| `try/except Exception` 包住路由 | 把崩溃翻译成 500 | `do_GET` |
| `curl -i` / `-I` | 看响应头 / 只要响应头 | 全篇 |
| `curl -L` | 跟着 `Location` 跳 | 301 |
| `curl -f` | 4xx/5xx 退出码 22 | 第三步、练习 3 |
| `curl -w "%{http_code}"` | 只打印状态码 | 第三步、练习 3 |
| `urlopen` 抛 `HTTPError` | Python 里 4xx/5xx 是异常 | `check_status.py` |
| `e.code` / `e.reason` / `e.headers` / `e.read()` | 从异常里读状态码、短语、头、body | `check_status.py` |
| `resp.url` | 跟随跳转后的最终地址 | `check_status.py` |
| `http.HTTPStatus` | 状态码到原因短语的对照表 | 练习 2 |

## 动手练习

### 练习 1:加一个 204,再补上 HEAD

在不改 `status_server.py` 的前提下(用 Day 42 的继承),写 `part01/ex60_server.py`:新增 `/health` 路径回 `204 No Content`(没有 body),并实现 `do_HEAD`,让 `curl -I` 不再回 501。用 curl 和 Python 各验证一次,回答:204 的响应里有没有 `Content-Type`?Python 里 `resp.read()` 得到什么?

<details>
<summary>参考答案</summary>

```python
# agent-zero-lab/part01/ex60_server.py
from http.server import HTTPServer

from status_server import HOST, PORT, StatusHandler


class HealthHandler(StatusHandler):
    def _route(self) -> None:
        if self.path == "/health":
            self.send_response(204)
            self.end_headers()
        else:
            super()._route()

    def do_HEAD(self) -> None:
        self.do_GET()


if __name__ == "__main__":
    print(f"监听 http://{HOST}:{PORT},多了 /health 和 HEAD", flush=True)
    HTTPServer((HOST, PORT), HealthHandler).serve_forever()
```

<div class="line-notes">

- `from status_server import HOST, PORT, StatusHandler` 直接导入今天的服务器。`status_server.py` 里的启动代码在 `if __name__ == "__main__"` 下面,所以 import 它不会启动服务器(Day 32 讲过的 main guard 在这里派上用场)。脚本从仓库根目录 `uv run python part01/ex60_server.py` 运行时,Python 会把 `part01/` 加进模块搜索路径,所以能直接 `import status_server`。
- `class HealthHandler(StatusHandler):` 继承今天的处理器,只改要改的。
- `def _route(self) -> None:` 覆盖路由方法。
- `if self.path == "/health":` 新路径。
- `self.send_response(204)` 204 的意思是「成功,但我没什么可给你的」。
- `self.end_headers()` **不写 `Content-Type`,也不写 body**。204 规定不能有 body。
- `super()._route()` 其他路径交回给父类原来的路由(Day 42 的 `super()`)。
- `def do_HEAD(self) -> None:` HEAD 的处理。
- `self.do_GET()` 偷懒的做法:按 GET 处理一遍。`http.server` 在 HEAD 请求时会把 `wfile.write` 的 body 照样发出去,严格说不合规范(HEAD 不该有 body),curl 用 `-I` 时读完头就不再读了,所以演示够用;正经的做法是只发头不写 body,留给以后 FastAPI 替你做。

</div>

运行 `uv run python part01/ex60_server.py`(先关掉 `status_server.py`),再:

```bash
curl -i http://127.0.0.1:8765/health
curl -I http://127.0.0.1:8765/
curl -I http://127.0.0.1:8765/nope
uv run python -c 'from urllib.request import urlopen
with urlopen("http://127.0.0.1:8765/health") as r: print(r.status, r.reason, repr(r.read()), r.headers.get("Content-Type"))'
```

实测输出:

```text
HTTP/1.0 204 No Content
Server: BaseHTTP/0.6 Python/3.12.13
Date: Fri, 23 Oct 2026 08:29:34 GMT

```

```text
HTTP/1.0 200 OK
Server: BaseHTTP/0.6 Python/3.12.13
Date: Fri, 23 Oct 2026 08:29:34 GMT
Content-Type: text/plain; charset=utf-8
Content-Length: 13

```

```text
HTTP/1.0 404 Not Found
```

```text
204 No Content b'' None
```

204 的响应只有状态行和自动加的两个头,没有 `Content-Type`(我们没写),空行后面什么都没有。Python 里 `resp.read()` 是空字节串 `b''`,`Content-Type` 是 `None`。`-I` 现在能正常拿到 200 和 404 的头了,`Content-Length: 13` 说明 GET 这个地址会有 13 字节的 body,但 HEAD 不传它。

</details>

### 练习 2:用 HTTPStatus 给状态码配中文

写 `part01/ex60_codes.py`:对一组路径发请求,每行打印「路径、状态码、原因短语、类别(成功 / 跳转 / 客户端的错 / 服务器的错)」。原因短语不要自己写,用标准库 `http.HTTPStatus` 查;类别用整除 `//` 算。跑在练习 1 的服务器上。

<details>
<summary>参考答案</summary>

```python
# agent-zero-lab/part01/ex60_codes.py
from http import HTTPStatus
from urllib.error import HTTPError
from urllib.request import urlopen

BASE = "http://127.0.0.1:8765"
KIND = {2: "成功", 3: "跳转", 4: "客户端的错", 5: "服务器的错"}


def status_of(path: str) -> int:
    try:
        with urlopen(f"{BASE}{path}") as resp:
            return resp.status
    except HTTPError as e:
        return e.code


for path in ["/", "/docs", "/health", "/secret", "/admin", "/nope", "/boom"]:
    code = status_of(path)
    phrase = HTTPStatus(code).phrase
    print(f"{path:8} {code} {phrase:22} {KIND[code // 100]}")
```

<div class="line-notes">

- `from http import HTTPStatus` 标准库里的状态码表,是一个枚举:`HTTPStatus(404)` 得到 `HTTPStatus.NOT_FOUND`,它的 `.phrase` 是 `"Not Found"`。`send_response` 写原因短语时查的就是这张表。
- `KIND = {2: "成功", 3: "跳转", 4: "客户端的错", 5: "服务器的错"}` 第一位数字到类别的字典。
- `def status_of(path: str) -> int:` 不管成功失败,只要状态码。
- `return resp.status` 2xx/3xx 从这里返回(3xx 被跟随后其实是 2xx)。
- `return e.code` 4xx/5xx 从异常里拿。
- `for path in ["/", "/docs", "/health", "/secret", "/admin", "/nope", "/boom"]:` 七个路径。
- `phrase = HTTPStatus(code).phrase` 查短语。
- `print(f"{path:8} {code} {phrase:22} {KIND[code // 100]}")` `code // 100` 是整除(Day 12):`404 // 100` 得 `4`,查字典得「客户端的错」。`:22` 是让短语占 22 格对齐。

</div>

运行 `uv run python part01/ex60_codes.py`,实测输出:

```text
/        200 OK                     成功
/docs    200 OK                     成功
/health  204 No Content             成功
/secret  401 Unauthorized           客户端的错
/admin   401 Unauthorized           客户端的错
/nope    404 Not Found              客户端的错
/boom    500 Internal Server Error  服务器的错
```

`/admin` 是 401 不是 403,因为这个脚本没带 token;`/old-docs` 我没放进列表,放了的话会显示 200,因为 `urlopen` 跟着跳了。

</details>

### 练习 3:只用 curl 做一张状态报告

用 `curl -w` 一行打印「状态码、跳转目标、耗时」,对 `/old-docs`、`/nope`、`/` 各来一次;再对 `/old-docs` 加 `-L`,打印最终地址和跳了几次。查 `man curl` 或 `curl --manual | grep -A2 redirect_url` 找变量名。

<details>
<summary>参考答案</summary>

```bash
curl -s -o /dev/null -w "%{http_code} %{redirect_url} %{time_total}s /old-docs\n" http://127.0.0.1:8765/old-docs
curl -s -o /dev/null -w "%{http_code} %{redirect_url} %{time_total}s /nope\n" http://127.0.0.1:8765/nope
curl -s -o /dev/null -w "%{http_code} %{redirect_url} %{time_total}s /\n" http://127.0.0.1:8765/
curl -s -o /dev/null -L -w "%{http_code} %{url_effective} %{num_redirects}\n" http://127.0.0.1:8765/old-docs
```

<div class="line-notes">

- `curl -s -o /dev/null -w "%{http_code} %{redirect_url} %{time_total}s /old-docs\n" http://127.0.0.1:8765/old-docs` 模板里三个变量:状态码、`redirect_url`(如果响应是 3xx,这里是 `Location` 拼成的完整地址,否则为空)、总耗时(秒);最后手写上路径方便对照。
- `curl -s -o /dev/null -w "%{http_code} %{redirect_url} %{time_total}s /nope\n" http://127.0.0.1:8765/nope` 同样的模板换个路径。
- `curl -s -o /dev/null -w "%{http_code} %{redirect_url} %{time_total}s /\n" http://127.0.0.1:8765/` 根路径。
- `curl -s -o /dev/null -L -w "%{http_code} %{url_effective} %{num_redirects}\n" http://127.0.0.1:8765/old-docs` 加 `-L` 之后:`url_effective` 是最终真正取到内容的地址,`num_redirects` 是跳了几次。

</div>

实测输出:

```text
301 http://127.0.0.1:8765/docs 0.006410s /old-docs
404  0.005608s /nope
200  0.005244s /
200 http://127.0.0.1:8765/docs 1
```

不加 `-L` 时 `/old-docs` 是 301,`redirect_url` 已经替你把 `Location: /docs` 拼成了完整地址;加 `-L` 后状态码变 200、跳了 1 次。本机请求 5 到 6 毫秒,以后调外网 API 这个数字会是几百毫秒到几秒,`time_total` 是最简单的测速办法。

</details>

### 练习 4:401 和 403 的分诊

同事报告「接口回 403」。不看代码,只用 curl,你怎么判断是「token 过期」还是「账号没权限」?在我们的服务器上把两种情况都演示出来,写出命令和你的判断依据。

<details>
<summary>参考答案</summary>

先不带凭证、再带正确凭证、最后带一个错的凭证,看三次状态码:

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:8765/admin
curl -s -o /dev/null -w "%{http_code}\n" -H "Authorization: Bearer cl-demo-token" http://127.0.0.1:8765/admin
curl -s -o /dev/null -w "%{http_code}\n" -H "Authorization: Bearer expired" http://127.0.0.1:8765/admin
```

<div class="line-notes">

- `curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:8765/admin` 不带凭证:应该 401。如果这里就回 403,说明服务器分不清「没登录」和「没权限」,那是服务器的实现问题。
- `curl -s -o /dev/null -w "%{http_code}\n" -H "Authorization: Bearer cl-demo-token" http://127.0.0.1:8765/admin` 带正确凭证:回 403 说明凭证**是有效的**,问题在权限。
- `curl -s -o /dev/null -w "%{http_code}\n" -H "Authorization: Bearer expired" http://127.0.0.1:8765/admin` 带错的凭证:回 401 说明无效凭证会被识别为 401,反过来证明上一条的 403 不是凭证问题。

</div>

实测输出:

```text
401
403
401
```

判断依据:同一个地址,凭证无效回 401、凭证有效回 403,那同事看到的 403 就是「账号没权限」,换 token 没用,要找管理员开权限。如果同事的 token 发过来一试是 401,那就是过期了。关键是**用一个已知有效的凭证做对照**,而不是盯着一个 403 猜。

</details>

### 练习 5:读一个真实 API 的响应头

对 `https://api.github.com/user` 连续发三次请求(用 `-i`,不带凭证),观察 `X-RateLimit-Remaining` 怎么变;再回答:这个 401 的 body 是什么格式?`documentation_url` 在告诉你什么?

<details>
<summary>参考答案</summary>

```bash
curl -s -i --http1.1 https://api.github.com/user | grep -i "^x-ratelimit-remaining"
curl -s -i --http1.1 https://api.github.com/user | grep -i "^x-ratelimit-remaining"
curl -s -i --http1.1 https://api.github.com/user | grep -i "^x-ratelimit-remaining"
curl -s https://api.github.com/user
```

<div class="line-notes">

- `curl -s -i --http1.1 https://api.github.com/user | grep -i "^x-ratelimit-remaining"` 发一次,把输出交给 `grep` 只留限流剩余那一行。`-i` 不分大小写(走 HTTP/2 时头是小写的),`^` 是「行首」,不然会连带匹配到另一个头里列出的这个名字。同样的命令敲三遍。
- `curl -s https://api.github.com/user` 不要头,只看 body。

</div>

实测输出(你的数字会不同,看趋势):

```text
X-RateLimit-Remaining: 55
X-RateLimit-Remaining: 54
X-RateLimit-Remaining: 53
```

```text
{
  "message": "Requires authentication",
  "documentation_url": "https://docs.github.com/rest",
  "status": "401"
}
```

每发一次减 1,从同一个出口 IP 出去的请求共享这 60 次,用完会收到 403 或 429(GitHub 文档写的是两种都可能,很多 API 只用 429,又一个「读文档」的理由)。body 是 JSON,`{...}` 里是键值对,`message` 是人读的原因,`documentation_url` 是「去这里看怎么登录」。明天就讲这种 body。

</details>

验收标准:`status_server.py` 跑起来后,文中七个路径的状态码你都能用 curl 复现;`check_status.py` 输出和文中一致;练习 1 到 5 的输出和参考答案一致;合上文章能画出五类状态码的表、说出 301/401/403/404/500 各在什么时候出现、401 和 403 怎么区分。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 状态行 | 响应的第一行:协议版本、状态码、原因短语 |
| 状态码(status code) | 三位数,第一位分类:2 成功、3 跳转、4 客户端错、5 服务器错 |
| 原因短语(reason phrase) | 状态码后面给人看的英文,如 `Not Found`,程序不依赖它 |
| 响应头(response header) | 状态行之后每行一条的「名字: 值」,描述这次响应 |
| `200` / `201` / `204` | 成功 / 创建成功 / 成功但无 body |
| `301` / `302` | 永久 / 临时跳转,都配 `Location` |
| `401` / `403` | 没登录(或凭证无效)/ 登录了但没权限 |
| `404` | 资源不存在 |
| `429` | 请求太频繁,被限流 |
| `500` / `502` / `503` / `504` | 服务器崩了 / 网关连不上后端 / 过载或维护 / 后端超时 |
| `Location` | 跳转目标地址 |
| `WWW-Authenticate` | 401 响应里说明「用哪种方式登录」 |
| `Authorization` | 请求头,放凭证,常见格式 `Bearer token` |
| Bearer token | 「持有者凭证」:谁拿着这串字谁就有权,所以不能泄露 |
| `Retry-After` | 429/503 响应里说「几秒后再来」 |
| `X-RateLimit-*` | 限流额度头(非标准,各家自定) |
| `curl -i` / `-I` / `-L` / `-f` / `-w` | 含响应头 / 只要头 / 跟随跳转 / 4xx5xx 当失败 / 按模板输出 |
| `HTTPError` | Python `urllib` 在 4xx/5xx 时抛的异常,带 `code`、`reason`、`headers` |
| `HTTPStatus` | 标准库 `http` 模块里的状态码枚举 |
| 退出码 22 / 52 | curl:`-f` 下遇到 4xx/5xx / 服务器空响应 |

## 常见误区

**以为 curl 收到 404 就会报错。** 不加 `-f` 时 curl 的退出码是 0,脚本里 `curl ... && echo ok` 会在 500 的时候也打印 ok。要让状态码影响退出码必须加 `-f`。

**把 401 和 403 当一回事。** 401 是「我不知道你是谁」,换凭证能解决;403 是「我知道你是谁,但你不能」,换凭证没用。先用一个确定有效的凭证做对照。

**只看状态码不看 body,或者只看 body 不看状态码。** 404 可以有完整的 HTML body(example.com),401 可以有 JSON body 说明原因(GitHub)。程序以状态码为准,排查时读 body 找线索。

**3xx 不带 `Location`。** 301/302 没有 `Location`,客户端不知道去哪,浏览器会显示空白页。写服务器时跳转和 `Location` 必须成对。

**服务器崩了没有兜底,客户端收到「空响应」。** 异常冲出处理函数时 `http.server` 直接关连接,curl 报 `(52) Empty reply from server`,客户端分不清是网络问题还是代码问题。最外层永远要有 `try/except` 把崩溃翻译成 500。

**把异常细节直接写进 500 的 body。** Traceback 里有文件路径、变量值,可能有数据,只能留在服务器日志。给客户端的只说「出错了」加一个可以查日志的 ID。

**以为 header 的值也不分大小写。** 名字不分,值分。`authorization: bearer xxx` 在我们的服务器上是 401,`Authorization: Bearer xxx` 才是 200。照文档原样写。

**忘了 `urlopen` 会把 4xx/5xx 抛成异常。** 不 `try` 的话脚本直接崩在 `urlopen` 那一行,打印状态码的代码根本不会执行。`httpx` 的默认行为相反,换库时要重新确认。

## 学习资料

### 文档与文章

- [MDN · HTTP 响应状态码](https://developer.mozilla.org/zh-CN/docs/Web/HTTP/Status):中文,每个状态码一页,今天那张表的完整版。遇到不认识的码就来这里。
- [MDN · HTTP 标头](https://developer.mozilla.org/zh-CN/docs/Web/HTTP/Headers):所有标准 header 的索引,按请求头 / 响应头分类。
- [MDN · HTTP 身份验证](https://developer.mozilla.org/zh-CN/docs/Web/HTTP/Authentication):`401`、`WWW-Authenticate`、`Authorization` 三者怎么配合,有时序图。
- [MDN · 401 Unauthorized](https://developer.mozilla.org/zh-CN/docs/Web/HTTP/Status/401) 和 [403 Forbidden](https://developer.mozilla.org/zh-CN/docs/Web/HTTP/Status/403):两页对照着读。
- [MDN · HTTP 重定向](https://developer.mozilla.org/zh-CN/docs/Web/HTTP/Redirections):301 / 302 / 307 / 308 的区别,`Location` 的用法。
- [MDN · 429 Too Many Requests](https://developer.mozilla.org/zh-CN/docs/Web/HTTP/Status/429) 和 [Retry-After](https://developer.mozilla.org/zh-CN/docs/Web/HTTP/Headers/Retry-After):以后调大模型 API 被限流时要看的两页。
- [GitHub Docs · REST API 的速率限制](https://docs.github.com/zh/rest/using-the-rest-api/rate-limits-for-the-rest-api):今天最后一节那几个 `X-RateLimit-*` 头的官方说明,中文。
- [Python 文档 · urllib.error](https://docs.python.org/zh-cn/3/library/urllib.error.html):`HTTPError` 有哪些属性。
- [Python 文档 · http](https://docs.python.org/zh-cn/3/library/http.html):`HTTPStatus` 枚举的完整列表。
- [curl 手册页](https://curl.se/docs/manpage.html):搜 `-w` 或 `--write-out`,能看到 `%{http_code}`、`%{redirect_url}` 等所有变量。
- [RFC 9110 · HTTP Semantics,第 15 节 Status Codes](https://www.rfc-editor.org/rfc/rfc9110#name-status-codes):正式定义,英文。争议时的最终出处。
- [http.cat](https://http.cat/):每个状态码配一张猫图,记不住的时候看一眼。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1SE421K7F9&autoplay=0&high_quality=1" title="【中配】HTTP状态码五分钟详解 - ByteByteGo" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>黑纹白斑马(搬运 ByteByteGo)· 【中配】HTTP状态码五分钟详解 · 约 5 分钟,2024 年。五大类的动画讲解,先看它建立画面。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV14CVr6wEmb&autoplay=0&high_quality=1" title="3分钟彻底搞懂HTTP状态码" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>小哲讲八股 · 3分钟彻底搞懂HTTP状态码 · 约 3 分钟,2026 年。面试角度的速记,看它怎么把 301/302、401/403 讲成一句话。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1YL4y1s7Rz&autoplay=0&high_quality=1" title="08.常见的请求头与响应头" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>liuboxue5580 · 08.常见的请求头与响应头 · 约 22 分钟,2022 年。逐个讲常用 header,对应今天第四步的两张表,可以 1.5 倍速看。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/wJa5CTIFj7U" title="Learn HTTP Status Codes In 10 Minutes" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Web Dev Simplified · Learn HTTP Status Codes In 10 Minutes · 英文,可开字幕。前端 UP 主讲的,例子都是 fetch。我只核对了标题,没有逐分钟看过。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/ajfBQJ2xp1M" title="HTTP Headers Explained: How APIs Handle Data, Auth & Caching" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Topictrick · HTTP Headers Explained: How APIs Handle Data, Auth &amp; Caching · 英文。从 API 的角度讲 header,`Authorization` 和缓存相关的头讲得多。我只核对了标题。</figcaption>
</figure>

### 书籍

- 《图解 HTTP》,上野宣 著,于均良 译,人民邮电出版社。第 4 章「返回结果的 HTTP 状态码」和第 6 章「HTTP 首部」正好是今天的内容,图多,一小时能翻完。
- 《HTTP 权威指南》(HTTP: The Definitive Guide),David Gourley、Brian Totty 等著,陈涓、赵振平 译,人民邮电出版社。第 3 章有完整的状态码和首部表,当字典用。

### 开源项目与代码

- [python/cpython · Lib/http/__init__.py](https://github.com/python/cpython/blob/main/Lib/http/__init__.py):`HTTPStatus` 枚举的源码,每个状态码一行,后面带着规范出处。练习 2 用的就是它。
- [curl/curl · docs/cmdline-opts](https://github.com/curl/curl/tree/master/docs/cmdline-opts):curl 每个命令行选项一个 markdown 文件,比 man 好读。找 `fail.md`、`location.md`、`write-out.md`。

## 自测

1. 不看表,把 `201`、`302`、`403`、`415`、`429`、`502` 各归一类,并说出各是谁的责任。

<details><summary>答案</summary>

`201` 2xx 成功(创建成功),无责任;`302` 3xx 跳转,客户端照 `Location` 再请求;`403` 4xx 客户端的错(没权限);`415` 4xx 客户端的错(body 类型不对);`429` 4xx 客户端的错(发太快);`502` 5xx 服务器那边的错(网关连不上后端)。

</details>

2. 一个响应的文字由哪几部分组成?它和请求的结构有什么不同?

<details><summary>答案</summary>

状态行(协议版本、状态码、原因短语)、若干行响应头、一个空行、可选的 body。和请求的区别只在第一行:请求是「方法 路径 版本」,响应是「版本 状态码 原因短语」,其余结构一样。

</details>

3. 你的脚本调一个接口拿到 401。列出你会依次检查的三件事。

<details><summary>答案</summary>

一、有没有带 `Authorization` 头(用 `curl -v` 看 `>` 开头的行里有没有它);二、格式对不对,`Bearer` 后面有一个空格、token 没有多余的引号或换行、大小写和文档一致;三、token 本身是否有效或过期(用一个确定有效的 token 做对照,有效的通了就是过期)。还可以看 401 响应的 `WWW-Authenticate` 头和 body,服务器常会写明用哪种认证方式。

</details>

4. `curl http://x/api && echo 成功` 在接口回 500 时会不会打印「成功」?为什么?怎么改?

<details><summary>答案</summary>

会。curl 只要收到了响应就退出码 0,不管状态码。加 `-f`:`curl -f http://x/api && echo 成功`,4xx/5xx 时退出码变 22,`&&` 后面不执行。

</details>

5. 服务器处理请求时抛了没接住的异常,客户端会看到什么?正确的做法是什么?

<details><summary>答案</summary>

`http.server` 会直接关掉连接,客户端收到空响应(curl 报 `(52) Empty reply from server`),分不清是网络问题还是服务器问题。正确做法是在处理函数最外层 `try/except Exception`,把异常记进服务器日志,给客户端回一个 500 和不含细节的说明。

</details>

6. (面试题)前端同事说「这个接口在 Postman 里是 200,我的页面里是 302 然后变成了 200,但拿到的是登录页的 HTML」。你怎么解释,怎么查?

<details><summary>答案</summary>

302 加上最终拿到登录页,说明服务器认为这次请求没登录,把它跳转到了登录页面,浏览器自动跟随跳转所以最后是 200。Postman 里 200 是因为那边带了有效的凭证(`Authorization` 头或 `Cookie`)。查法:在 Network 面板对比两次请求的请求头,看页面发出的请求有没有带 `Cookie` 或 `Authorization`;用 `curl -v`(不加 `-L`)重放页面的请求,直接看第一个响应的 302 和它的 `Location`,就能确认是跳到了登录页。

</details>

## 明天预告

明天是 [Day 61 · HTTP(三):请求体、JSON 和 Content-Type](/blog/agent-zero/day-061-http-3/)。今天你已经两次碰到 JSON:GitHub 的 401 用它说明原因,我们的服务器回的还是纯文本。明天把 body 这一段彻底讲清楚:同样一份数据,表单格式和 JSON 格式各长什么样,`Content-Type` 怎么告诉服务器「按哪种方式读」,忘了写它会发生什么(今天的 400 和 415 就是为那一刻准备的),以及用 Python 的 `json` 模块把字典变成 body、再把响应的 body 变回字典。
