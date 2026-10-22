---
title: 'Day 84 · 鉴权(二):JWT 是什么,签名怎么验'
description: 'session 要在服务端存一张表,JWT 把「你是谁、几点过期」直接写进令牌再签个名。今天先用 base64url 和 HMAC 手工拼出一个 JWT,证明它和 pyjwt 生成的一字不差;再用 pyjwt 做签发、校验、过期,看清三个常见坑;最后在 FastAPI 里用它做登录,亲眼看到它的代价:退出以后旧令牌照样能用。'
pubDate: 2026-10-23
regime: none
tags: ['auth', 'jwt', 'fastapi', 'python', 'agent-zero']
series: 'agent-zero'
day: 84
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 83](/blog/agent-zero/day-083-week12-review/) 复习了第 12 周:画出一次请求在服务端经过的每一站(端口、进程、中间件、路由、鉴权依赖、参数校验、资源依赖、处理函数、异常处理器),从零写了退款申请服务 `part01/refunds_api.py`,并且实测了「鉴权必须排在最前面」和 `list(...)` 只是浅复制这两件事。

现在回到 [Day 82](/blog/agent-zero/day-082-auth-1/) 留下的话题。session 方案里,cookie 只装一个随机编号,「编号对应 alice」存在服务端的 `SESSIONS` 表里,每个请求都要查一次表。服务器只有一台、表在内存里的时候这不算什么;可一旦重启,表没了,所有人都得重新登录;服务器变成三台,三台得共用一张表。今天看另一种思路:**不存表,把信息直接写进令牌里,再签个名防伪**。这就是 JWT。

## 今天要解决的问题

学完今天,你应该能做到:

1. 拿到一个 JWT,说出它三段各是什么,不用任何库就能把前两段解码出来,并解释「base64url 编码不是加密」。
2. 说清楚签名是怎么算、怎么验的:服务端用只有自己知道的密钥对前两段做 HMAC-SHA256,改动任何一个字符签名都对不上;能手工拼出一个和 pyjwt 一字不差的 JWT。
3. 用 pyjwt 签发和校验带过期时间的令牌,认出三个坑:`decode` 不写 `algorithms`、`alg: none` 的令牌、关掉签名校验。
4. 在 FastAPI 里用 `Authorization: Bearer` 做 JWT 登录,并说出它和 session 的取舍,尤其是「退出登录后旧令牌还有效」这一条。

今天两个新概念:**JWT 的三段结构**(连带它用的 base64url 编码)和**签名校验**(HMAC)。

预计用时:3 小时。花费 ¥0,不调模型。

前置:[Day 82](/blog/agent-zero/day-082-auth-1/) 的 401/403、`Authorization: Bearer`、`secrets.compare_digest`、`session_demo.py`;[Day 16](/blog/agent-zero/day-016-strings-2/) 的 `.encode()` 和 bytes;[Day 39](/blog/agent-zero/day-039-json/) 的 `json.dumps`/`json.loads`;[Day 81](/blog/agent-zero/day-081-fastapi-3/) 的 `Depends`;[Day 74](/blog/agent-zero/day-074-pytest-4/) 的 monkeypatch。

学法:先对照文章逐行敲一遍(不复制粘贴)并跑通;第二天合上文章,把 `jwt_by_hand.py` 的 `make_token` 和 `check_token`、`jwt_api.py` 的 `current_claims` 默写出来;做练习,做不出再展开参考答案,看完关掉自己重写一遍。

## 先打个比方

公司前台给访客发临时工牌,有两种做法。

第一种:工牌上只印一个编号「0927」,前台的本子上记着「0927 → 张三,访问财务部,今天 18 点前有效」。保安每次看到工牌都要打电话问前台:0927 是谁?这就是 session,本子就是 `SESSIONS` 表。好处是前台随时可以在本子上划掉 0927,工牌立刻作废。

第二种:工牌上直接写「张三,财务部,今天 18 点前有效」,再盖一个公司的钢印。保安不用问前台,看一眼内容、摸一下钢印是真的,就放行。这就是 JWT。钢印就是签名,只有前台有那个章。保安省了电话,但有个问题:张三提前走了,工牌在他口袋里,上面写着 18 点前有效,钢印也是真的,前台想作废也没办法,除非给每个保安发一张「作废名单」,可那又回到了查本子。

这个比方里有今天的全部要点:**内容是明文写的**(谁都能读,只是不能改);**钢印证明没被改过**;**作废很难**。下面一样一样用代码验证。

## 第 1 步:base64url,把字节变成能放进 URL 的文本

先看一个 JWT 长什么样。这是今天第 3 步会生成的一个:

```text
eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJhbGljZSIsInJvbGUiOiJzdXBwb3J0In0.t_Y7M-UHbnVkJuguzenRxLgrSGTYEn4reD7t-lAkyHg
```

两个点把它分成三段:**header**(头部)、**payload**(载荷,就是要传递的内容)、**signature**(签名)。前两段是 JSON 经过 **base64url** 编码得到的,第三段是签名的字节经过同样的编码。

base64 你在前端可能用过:浏览器里的 `btoa('hello')` 得到 `aGVsbG8=`,`atob` 反过来。它把任意字节换成 64 个「安全」字符(大小写字母、数字、`+`、`/`)组成的文本,末尾用 `=` 补齐长度。**它是编码,不是加密**,没有任何密钥,谁都能解回来。base64url 是它的一个变种,专门为了放进 URL 和 HTTP 头:把 `+` 换成 `-`、`/` 换成 `_`(这两个字符在 URL 里有特殊意思),JWT 里还把末尾的 `=` 去掉。

新建 `part01/b64_demo.py`:

```python
# agent-zero-lab/part01/b64_demo.py
import base64
import json

header = {"alg": "HS256", "typ": "JWT"}
raw = json.dumps(header, separators=(",", ":")).encode()
print("原始字节:", raw)
print("标准 base64:", base64.b64encode(raw))

odd = bytes([251, 255])
print("251 255 →", base64.b64encode(odd), base64.urlsafe_b64encode(odd))

payload = json.dumps({"sub": "alice", "role": "support"}, separators=(",", ":")).encode()
padded = base64.urlsafe_b64encode(payload)
print("payload:", padded)
text = padded.rstrip(b"=").decode()
print("去掉 = :", text)
back = base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))
print("解码回来:", json.loads(back))
```

<div class="line-notes">

- `import base64` 标准库,不用装。
- `header = {"alg": "HS256", "typ": "JWT"}` JWT 的头部固定长这样:`alg` 是签名算法,`HS256` 表示 HMAC-SHA256(第 2 步讲);`typ` 说明这是个 JWT。
- `raw = json.dumps(header, separators=(",", ":")).encode()` `separators=(",", ":")` 让 `json.dumps` 不加空格,默认会输出 `{"alg": "HS256", ...}`(冒号后有空格),这里得到紧凑的 `{"alg":"HS256","typ":"JWT"}`。空格多一个,编码结果就不一样,签名也就不一样。`.encode()` 变成 bytes,base64 只处理字节。
- `print("标准 base64:", base64.b64encode(raw))` 返回值也是 bytes,打印出来带 `b'...'`。
- `odd = bytes([251, 255])` 造两个特别的字节,它们编码后正好会出现 `+` 和 `/`,用来对比两种 base64 的区别。`bytes([...])` 用一个整数列表(每个 0–255)造字节串。
- `print("251 255 →", base64.b64encode(odd), base64.urlsafe_b64encode(odd))` 同样的字节,标准版和 url 版各编一次。
- `payload = json.dumps({"sub": "alice", "role": "support"}, separators=(",", ":")).encode()` 载荷:`sub` 是 subject(主体),也就是「这张令牌说的是谁」;`role` 是我们自己加的字段,客服角色。
- `text = padded.rstrip(b"=").decode()` `rstrip` 去掉右边所有的 `=`(Day 16 的字符串方法,bytes 上也能用),`.decode()` 变回 str。这就是 JWT 里真正出现的样子。
- `back = base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))` 解码时 Python 要求长度是 4 的倍数,得把 `=` 补回来。`-len(text) % 4` 算「还差几个凑到 4 的倍数」:长度 43 时,`-43 % 4` 是 1,补一个 `=`;长度 36 时是 0,不补。Python 的 `%` 对负数返回非负结果(Day 12),这个写法就是利用这一点。
- `print("解码回来:", json.loads(back))` `json.loads` 能直接吃 bytes。

</div>

`uv run python -m part01.b64_demo` 实跑输出:

```text
原始字节: b'{"alg":"HS256","typ":"JWT"}'
标准 base64: b'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9'
251 255 → b'+/8=' b'-_8='
payload: b'eyJzdWIiOiJhbGljZSIsInJvbGUiOiJzdXBwb3J0In0='
去掉 = : eyJzdWIiOiJhbGljZSIsInJvbGUiOiJzdXBwb3J0In0
解码回来: {'sub': 'alice', 'role': 'support'}
```

第二行就是上面那个 JWT 的第一段,一字不差;第五行就是第二段。也就是说,**任何人拿到你的 JWT,把前两段丢进 base64 解码,就能看到里面写了什么**。浏览器 Console 里 `atob('eyJzdWIiOiJhbGljZSIsInJvbGUiOiJzdXBwb3J0In0')` 也能得到 `{"sub":"alice","role":"support"}`。所以 JWT 里绝不能放密码、身份证号这类东西。

第三行是两种 base64 的区别:标准版出现了 `+` 和 `/`,url 版换成了 `-` 和 `_`。`=` 结尾那个就是补齐用的。

故意不补 `=` 直接解码,看看报什么:

```bash
uv run python -c "import base64; base64.urlsafe_b64decode('eyJzdWIiOiJhbGljZSIsInJvbGUiOiJzdXBwb3J0In0')"
```

实跑输出的最后一行:

```text
binascii.Error: Incorrect padding
```

`Incorrect padding` 就是「长度不是 4 的倍数,缺 `=`」。手工解 JWT 时十有八九会撞上它一次。

## 第 2 步:HMAC,只有持有密钥的人才算得出来的签名

光编码防不住篡改:alice 把第二段解出来,把 `"support"` 改成 `"admin"`,再编码回去,一个「管理员令牌」就造好了。所以需要第三段签名。

先认识**哈希**(hash):把任意长的数据算成一个固定长度的「指纹」,输入改一个字节,指纹就面目全非,而且没法从指纹倒推出输入。SHA-256 是最常用的一种,指纹 32 字节(写成十六进制是 64 个字符)。下载软件时网页上给的 SHA256 校验值,就是这个。

但光有哈希不够:哈希是公开算法,alice 改完内容,自己重新算一个 SHA-256 附上就行了。**HMAC** 是「带密钥的哈希」:计算时把一个密钥掺进去,不知道密钥就算不出正确的结果。服务端签发时用密钥算一次,收到令牌时再用同一个密钥算一次,两次对得上,就说明内容没被改过、而且确实是自己签的。

新建 `part01/hmac_demo.py`:

```python
# agent-zero-lab/part01/hmac_demo.py
import hashlib
import hmac

SECRET = b"only-the-server-knows-this-0123456789"

msg = b'{"sub":"alice","role":"support"}'
fake = b'{"sub":"alice","role":"admin"}'

print("sha256(msg)  :", hashlib.sha256(msg).hexdigest())
print("sha256(fake) :", hashlib.sha256(fake).hexdigest())
print("hmac(msg)    :", hmac.new(SECRET, msg, hashlib.sha256).hexdigest())
print("hmac(msg)再算:", hmac.new(SECRET, msg, hashlib.sha256).hexdigest())
print("hmac(fake)   :", hmac.new(SECRET, fake, hashlib.sha256).hexdigest())
print("猜的密钥     :", hmac.new(b"guess", msg, hashlib.sha256).hexdigest())
print("签名字节数   :", len(hmac.new(SECRET, msg, hashlib.sha256).digest()))
```

<div class="line-notes">

- `import hashlib` 标准库,各种哈希算法。
- `import hmac` 标准库,HMAC。
- `SECRET = b"only-the-server-knows-this-0123456789"` 演示用的密钥,37 个字节。真实项目里它从环境变量读,不写进代码(Day 53),第 6 步会这么做。
- `fake = b'{"sub":"alice","role":"admin"}'` alice 篡改后的内容。
- `print("sha256(msg)  :", hashlib.sha256(msg).hexdigest())` 普通哈希,`hexdigest()` 以十六进制字符串返回。
- `print("hmac(msg)    :", hmac.new(SECRET, msg, hashlib.sha256).hexdigest())` `hmac.new(密钥, 数据, 哈希算法)`。三个参数缺一个都算不出这个值。
- `print("hmac(msg)再算:", hmac.new(SECRET, msg, hashlib.sha256).hexdigest())` 同样的输入再算一次,确认结果是固定的,服务端才能「再算一次来比对」。
- `print("猜的密钥     :", hmac.new(b"guess", msg, hashlib.sha256).hexdigest())` 内容没改,只是密钥不对。
- `print("签名字节数   :", len(hmac.new(SECRET, msg, hashlib.sha256).digest()))` `.digest()` 返回原始字节,JWT 里放的就是这个,再做 base64url。

</div>

`uv run python -m part01.hmac_demo` 实跑输出:

```text
sha256(msg)  : 1cae7790b9fa741e50dea3a2761ed27091ad9acff1880ef7a3897b16c88773a0
sha256(fake) : 940ae200e9f8e479fe4ffa7a303b5f9ffe23669e8594a69e654adc64dd52171d
hmac(msg)    : 0309af4f0d769fa44890b64669b80229b72269adf832ae6f05bf3986fdd1cf46
hmac(msg)再算: 0309af4f0d769fa44890b64669b80229b72269adf832ae6f05bf3986fdd1cf46
hmac(fake)   : 41c7388f3d6ada8848852dcb19894fc1447f4b2de0cdf560a1c49dead3114999
猜的密钥     : 1d233b44423e1fe75496acbfcf30d27824de9a92bcda88976a270ceded1465d4
签名字节数   : 32
```

看几组对比。`msg` 和 `fake` 只差几个字母,两个 SHA-256 完全不像。HMAC 同样的输入算两次结果相同,这是能验证的前提。内容不变、密钥换成 `guess`,结果也完全不同:**不知道密钥,就算不出能对上的签名**。alice 能改 payload,但她没有 `SECRET`,签不出新的签名;用旧签名配新内容,服务端一算就对不上。

<figure>
<svg viewBox="0 0 640 300" role="img" aria-label="JWT 的三段结构和签名校验:header 和 payload 用 base64url 编码后用点连起来,服务端用密钥做 HMAC 得到签名;校验时重新算一次和第三段比对">
<rect x="0" y="0" width="640" height="300" fill="var(--paper-raised)" rx="6"/>
<g font-family="var(--font-mono)" font-size="12">
<rect x="20" y="20" width="180" height="56" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="110" y="42" fill="var(--ink)" text-anchor="middle">header</text>
<text x="110" y="62" fill="var(--ink-soft)" text-anchor="middle" font-size="11">{"alg":"HS256",...}</text>
<rect x="230" y="20" width="180" height="56" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="320" y="42" fill="var(--ink)" text-anchor="middle">payload</text>
<text x="320" y="62" fill="var(--ink-soft)" text-anchor="middle" font-size="11">{"sub":"alice",...}</text>
<rect x="440" y="20" width="180" height="56" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="530" y="42" fill="var(--ink)" text-anchor="middle">signature</text>
<text x="530" y="62" fill="var(--ink-soft)" text-anchor="middle" font-size="11">32 字节</text>
<text x="110" y="100" fill="var(--ink-soft)" text-anchor="middle" font-size="11">base64url</text>
<text x="320" y="100" fill="var(--ink-soft)" text-anchor="middle" font-size="11">base64url</text>
<text x="530" y="100" fill="var(--ink-soft)" text-anchor="middle" font-size="11">base64url</text>
<rect x="20" y="112" width="600" height="34" rx="4" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="320" y="134" fill="var(--ink)" text-anchor="middle">eyJhbGci...J9 . eyJzdWIi...In0 . t_Y7M-UH...yHg</text>
<rect x="20" y="180" width="390" height="48" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="215" y="200" fill="var(--ink)" text-anchor="middle">签名输入 = 第一段 + "." + 第二段</text>
<text x="215" y="218" fill="var(--ink-soft)" text-anchor="middle" font-size="11">谁都能看,base64 不是加密</text>
<rect x="440" y="180" width="180" height="48" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="530" y="200" fill="var(--ink)" text-anchor="middle">HMAC-SHA256</text>
<text x="530" y="218" fill="var(--ink-soft)" text-anchor="middle" font-size="11">只有服务端有密钥</text>
<line x1="410" y1="204" x2="440" y2="204" stroke="var(--rule)" stroke-width="2"/>
<line x1="530" y1="180" x2="530" y2="76" stroke="var(--mem)" stroke-dasharray="4 3"/>
<text x="20" y="260" fill="var(--ink)">校验:拆开 → 用自己的密钥对前两段重算 HMAC → 和第三段比</text>
<text x="20" y="282" fill="var(--ink-soft)" font-size="11">对上了才相信 payload;再检查 exp 有没有过期</text>
</g>
</svg>
<figcaption>琥珀色是谁都能读的部分,蓝色是只有持有密钥的服务端能算出来的部分。签名保护的是「前两段一个字都没改过」,不保护「别人看不到」。</figcaption>
</figure>

## 第 3 步:手工拼一个 JWT

有了前两步,JWT 就是把它们组装起来。新建 `part01/jwt_by_hand.py`:

```python
# agent-zero-lab/part01/jwt_by_hand.py
import base64
import hashlib
import hmac
import json
from typing import Any

SECRET = b"only-the-server-knows-this-0123456789"


def b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def b64url_decode(text: str) -> bytes:
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


def to_part(obj: dict[str, Any]) -> str:
    return b64url(json.dumps(obj, separators=(",", ":")).encode())


def make_token(payload: dict[str, Any]) -> str:
    signing_input = to_part({"alg": "HS256", "typ": "JWT"}) + "." + to_part(payload)
    sig = hmac.new(SECRET, signing_input.encode(), hashlib.sha256).digest()
    return signing_input + "." + b64url(sig)


def check_token(token: str) -> dict[str, Any]:
    header_part, payload_part, sig_part = token.split(".")
    signing_input = header_part + "." + payload_part
    expected = hmac.new(SECRET, signing_input.encode(), hashlib.sha256).digest()
    if not hmac.compare_digest(b64url_decode(sig_part), expected):
        raise ValueError("签名对不上,令牌被改过或者不是我们签的")
    return json.loads(b64url_decode(payload_part))


if __name__ == "__main__":
    token = make_token({"sub": "alice", "role": "support"})
    print(token)
    print("校验通过:", check_token(token))

    header_part, _, sig_part = token.split(".")
    forged = header_part + "." + to_part({"sub": "alice", "role": "admin"}) + "." + sig_part
    try:
        check_token(forged)
    except ValueError as e:
        print("改成 admin:", e)
```

<div class="line-notes">

- `def b64url(data: bytes) -> str:` 第 1 步那两行的封装:编码、去 `=`、转成 str。
- `def b64url_decode(text: str) -> bytes:` 反过来:补 `=`、解码。
- `def to_part(obj: dict[str, Any]) -> str:` 字典 → 紧凑 JSON → bytes → base64url。header 和 payload 都走这一条。
- `signing_input = to_part({"alg": "HS256", "typ": "JWT"}) + "." + to_part(payload)` **签名输入**是「第一段.第二段」这个字符串,点也算在里面。规范(RFC 7519,引用的 RFC 7515)就是这么定义的。
- `sig = hmac.new(SECRET, signing_input.encode(), hashlib.sha256).digest()` 对签名输入做 HMAC-SHA256,拿原始的 32 字节。
- `return signing_input + "." + b64url(sig)` 第三段接上,完成。
- `header_part, payload_part, sig_part = token.split(".")` 按点切三段,解包成三个变量(Day 22)。不是正好三段时这里会抛 `ValueError`,练习 1 会处理。
- `expected = hmac.new(SECRET, signing_input.encode(), hashlib.sha256).digest()` 校验 = 用同一个密钥对收到的前两段**重算一次**。
- `if not hmac.compare_digest(b64url_decode(sig_part), expected):` 和 Day 82 一样用恒定耗时比较。`hmac.compare_digest` 和 `secrets.compare_digest` 是同一个函数,`secrets` 那个就是从 `hmac` 导过去的。
- `return json.loads(b64url_decode(payload_part))` **先验签名,再相信内容**。顺序反过来就等于没验。
- `header_part, _, sig_part = token.split(".")` 模拟 alice:保留原来的头和签名,中间那段换掉。`_` 表示原来的 payload 不要了。
- `forged = header_part + "." + to_part({"sub": "alice", "role": "admin"}) + "." + sig_part` 伪造的令牌。

</div>

`uv run python -m part01.jwt_by_hand` 实跑输出:

```text
eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJhbGljZSIsInJvbGUiOiJzdXBwb3J0In0.t_Y7M-UHbnVkJuguzenRxLgrSGTYEn4reD7t-lAkyHg
校验通过: {'sub': 'alice', 'role': 'support'}
改成 admin: 签名对不上,令牌被改过或者不是我们签的
```

这就是一个货真价实的 JWT。不信的话用标准库来验。装 pyjwt(2026 年 10 月 22 日我装到的是 `pyjwt==2.15.1`):

```bash
uv add pyjwt
```

<div class="line-notes">

- `uv add pyjwt` 包名叫 `pyjwt`,代码里 `import jwt`。**别装成 `uv add jwt`**:PyPI 上真有一个叫 `jwt` 的包(GehirnInc 的 python-jwt,1.4.0),是另一个库,API 完全不同,`jwt.encode` 会报找不到。安装名和导入名不一致的包并不少见,装之前先看一眼 PyPI 页面上的项目说明。

</div>

然后一行命令,用 pyjwt 去验我们手工拼的令牌,再让 pyjwt 自己签一个,比一比:

```bash
uv run python -c "
import jwt
from part01.jwt_by_hand import SECRET, make_token
t = make_token({'sub': 'alice', 'role': 'support'})
print(jwt.decode(t, SECRET, algorithms=['HS256']))
print(jwt.encode({'sub': 'alice', 'role': 'support'}, SECRET, algorithm='HS256') == t)
"
```

<div class="line-notes">

- `print(jwt.decode(t, SECRET, algorithms=['HS256']))` pyjwt 校验我们手工拼的令牌。`algorithms` 这个参数第 5 步专门讲。
- `print(jwt.encode({'sub': 'alice', 'role': 'support'}, SECRET, algorithm='HS256') == t)` pyjwt 签一个同样内容的,和我们的逐字符比较。

</div>

实跑输出:

```text
{'sub': 'alice', 'role': 'support'}
True
```

pyjwt 认我们的令牌,而且它自己生成的和我们手拼的**完全相同**。所以 JWT 一点也不神秘:两段 base64url 编码的 JSON,加一段 HMAC。后面用库,只是省得每次自己写这几十行,并且库替你处理了过期时间、算法白名单这些容易写漏的检查。

## 第 4 步:pyjwt 的签发、校验和过期

真实的令牌一定要有过期时间,不然一个令牌泄露了就永远能用。JWT 规范里预先定义了几个字段名,叫**注册声明**(registered claims),payload 里的每个字段统称**声明**(claim):

| 声明 | 全称 | 意思 |
| --- | --- | --- |
| `sub` | subject | 这张令牌说的是谁 |
| `exp` | expiration time | 过期时刻,Unix 时间戳(秒) |
| `iat` | issued at | 签发时刻 |
| `jti` | JWT ID | 令牌自己的唯一编号(练习 3 用) |

pyjwt 校验时会自动检查 `exp`,过期了就抛异常,你不用自己比时间。新建 `part01/jwt_basics.py`:

```python
# agent-zero-lab/part01/jwt_basics.py
import time

import jwt

SECRET = "only-the-server-knows-this-0123456789"

now = int(time.time())
token = jwt.encode({"sub": "alice", "role": "support", "iat": now, "exp": now + 2}, SECRET, algorithm="HS256")
print("令牌:", token)
print("马上校验:", jwt.decode(token, SECRET, algorithms=["HS256"]))
print("不验签名偷看:", jwt.decode(token, options={"verify_signature": False}))

for label, key in [("换个密钥", "guess"), ("正确密钥", SECRET)]:
    try:
        jwt.decode(token, key, algorithms=["HS256"])
        print(label, "→ 通过")
    except jwt.InvalidTokenError as e:
        print(label, "→", type(e).__name__, e)

time.sleep(3)
try:
    jwt.decode(token, SECRET, algorithms=["HS256"])
except jwt.ExpiredSignatureError as e:
    print("3 秒后:", type(e).__name__, e)
```

<div class="line-notes">

- `SECRET = "only-the-server-knows-this-0123456789"` pyjwt 的密钥可以是 str,它会自己转 bytes。
- `now = int(time.time())` 当前 Unix 时间戳取整(≈JS 的 `Math.floor(Date.now() / 1000)`)。规范要求 `exp`、`iat` 是秒数,不是毫秒。前端同学最容易在这里用 `Date.now()` 传毫秒,结果令牌「一千年后才过期」。
- `token = jwt.encode({"sub": "alice", "role": "support", "iat": now, "exp": now + 2}, SECRET, algorithm="HS256")` 签发。为了马上看到过期,只给 2 秒。`jwt.encode` 返回 str。
- `print("马上校验:", jwt.decode(token, SECRET, algorithms=["HS256"]))` `decode` 做三件事:验签名、验 `exp`、返回 payload 字典。名字叫 decode,其实是「验证并解码」。
- `print("不验签名偷看:", jwt.decode(token, options={"verify_signature": False}))` 关掉签名校验,只解码。用来调试时看内容可以,**绝不能拿它的结果做鉴权**,第 5 步实测为什么。
- `for label, key in [("换个密钥", "guess"), ("正确密钥", SECRET)]:` 用两个密钥各验一次。
- `except jwt.InvalidTokenError as e:` pyjwt 所有「令牌不合格」的异常都继承自 `InvalidTokenError`,接住它就接住了签名错、过期、格式坏等各种情况。
- `print(label, "→", type(e).__name__, e)` `type(e).__name__` 打出具体是哪个异常类。
- `time.sleep(3)` 等 3 秒,令牌只有 2 秒有效期。
- `except jwt.ExpiredSignatureError as e:` 过期有自己的异常类,它也是 `InvalidTokenError` 的子类。单独接它,是为了能给用户不同的提示(「请重新登录」和「令牌无效」)。

</div>

`uv run python -m part01.jwt_basics` 实跑输出(警告里 `.venv` 那一长串路径我缩成了 `...`):

```text
.../jwt/api_jwt.py:370: InsecureKeyLengthWarning: The HMAC key is 5 bytes long, which is below the minimum recommended length of 32 bytes for SHA256. See RFC 7518 Section 3.2.
  decoded = self.decode_complete(
令牌: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJhbGljZSIsInJvbGUiOiJzdXBwb3J0IiwiaWF0IjoxNzkyNjg0MTczLCJleHAiOjE3OTI2ODQxNzV9.v8yRDCPFkssB3EklWjI6K8T556BoieSGFJRpj8Bi82Y
马上校验: {'sub': 'alice', 'role': 'support', 'iat': 1792684173, 'exp': 1792684175}
不验签名偷看: {'sub': 'alice', 'role': 'support', 'iat': 1792684173, 'exp': 1792684175}
换个密钥 → InvalidSignatureError Signature verification failed
正确密钥 → 通过
3 秒后: ExpiredSignatureError Signature has expired
```

最上面那条警告是 pyjwt 在说:你用来校验的密钥 `guess` 只有 5 个字节,SHA-256 推荐至少 32 字节。它出现在最前面,是因为警告打在 stderr 上,和 stdout 的输出被终端交错显示了(Day 75 讲过两条输出流)。这条警告是好事,说明 pyjwt 在帮你把关,第 6 步我们会让服务端在密钥太短时直接拒绝工作。

`iat` 是 1792684173,`exp` 正好多 2。换密钥是 `InvalidSignatureError`,3 秒后是 `ExpiredSignatureError`。这两种异常第 6 步会分别变成两句不同的 401 提示。

## 第 5 步:三个坑

三个坑:`decode` 不写 `algorithms`、`alg: none` 的令牌、关掉签名校验。放在一个脚本里看。新建 `part01/jwt_pitfalls.py`:

```python
# agent-zero-lab/part01/jwt_pitfalls.py
import jwt

SECRET = "only-the-server-knows-this-0123456789"
good = jwt.encode({"sub": "alice", "role": "support"}, SECRET, algorithm="HS256")
unsigned = jwt.encode({"sub": "alice", "role": "admin"}, None, algorithm="none")
print("不签名的令牌:", unsigned)

try:
    jwt.decode(good, SECRET)
except jwt.InvalidTokenError as e:
    print("忘了写 algorithms →", type(e).__name__, e)

try:
    jwt.decode(unsigned, SECRET, algorithms=["HS256"])
except jwt.InvalidTokenError as e:
    print("alg=none 冒充 admin →", type(e).__name__, e)

print("关掉签名校验 →", jwt.decode(unsigned, options={"verify_signature": False}))
```

<div class="line-notes">

- `unsigned = jwt.encode({"sub": "alice", "role": "admin"}, None, algorithm="none")` JWT 规范里有一个算法叫 `none`,意思是「不签名」,第三段是空的。攻击者自己就能造这种令牌,不需要任何密钥。
- `jwt.decode(good, SECRET)` 正常令牌,但没写 `algorithms`。
- `jwt.decode(unsigned, SECRET, algorithms=["HS256"])` 拿不签名的 admin 令牌,去一个只接受 HS256 的服务端。
- `print("关掉签名校验 →", jwt.decode(unsigned, options={"verify_signature": False}))` 有人为了「调通」,在服务端关掉了签名校验。

</div>

`uv run python -m part01.jwt_pitfalls` 实跑输出:

```text
不签名的令牌: eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0.eyJzdWIiOiJhbGljZSIsInJvbGUiOiJhZG1pbiJ9.
忘了写 algorithms → DecodeError It is required that you pass in a value for the "algorithms" argument when calling decode().
alg=none 冒充 admin → InvalidAlgorithmError The specified alg value is not allowed
关掉签名校验 → {'sub': 'alice', 'role': 'admin'}
```

注意第一行末尾那个点后面什么都没有:不签名的令牌,第三段是空的。

**坑一**,pyjwt 2 以后强制你写 `algorithms`,不写直接报错。为什么这么较真?令牌的 header 里写着 `alg`,那是**令牌自己声称**的算法,而令牌是攻击者能随便改的东西。如果服务端照着令牌说的算法去验,攻击者把 `alg` 改成 `none`,服务端就「按 none 的规矩」不验签名了。历史上真有不少 JWT 库栽在这里。所以算法必须由**服务端**用白名单指定:我只认 HS256,别的一律不认。

**坑二**,有了白名单,`alg: none` 的令牌就被 `InvalidAlgorithmError` 挡掉了。

**坑三**最隐蔽:代码不报错,但 `role` 是 `admin` 的伪造令牌被原样接受了。`verify_signature: False` 在调试脚本里偷看内容可以用,一旦出现在服务端的鉴权代码里,等于没有鉴权。我见过的写法是「本地调试时先关掉,上线前再打开」,然后忘了打开。

## 第 6 步:在 FastAPI 里用 JWT 登录

把这些用到一个服务上,和 Day 82 的 `session_demo.py` 做对比。新建 `part01/jwt_api.py`:

```python
# agent-zero-lab/part01/jwt_api.py
import os
import secrets
import time
from typing import Annotated, Any

import jwt
from fastapi import Depends, FastAPI, Header, HTTPException
from pydantic import BaseModel

app = FastAPI(title="CloudLedger 客服工作台(JWT 演示)")

USERS = {"alice": {"password": "wonderland-2026", "role": "support"}}
TOKEN_TTL = 900
BEARER = {"WWW-Authenticate": "Bearer"}


class LoginIn(BaseModel):
    username: str
    password: str


def jwt_secret() -> str:
    value = os.environ.get("JWT_SECRET", "")
    if len(value) < 32:
        raise HTTPException(status_code=500, detail="服务端没有配置足够长的 JWT_SECRET")
    return value


@app.post("/login")
def login(body: LoginIn):
    user = USERS.get(body.username)
    if user is None or not secrets.compare_digest(body.password.encode(), user["password"].encode()):
        raise HTTPException(status_code=401, detail="用户名或密码不对")
    now = int(time.time())
    claims = {"sub": body.username, "role": user["role"], "iat": now, "exp": now + TOKEN_TTL}
    token = jwt.encode(claims, jwt_secret(), algorithm="HS256")
    return {"access_token": token, "token_type": "bearer", "expires_in": TOKEN_TTL}


def current_claims(authorization: Annotated[str | None, Header()] = None) -> dict[str, Any]:
    scheme, _, token = (authorization or "").partition(" ")
    if scheme.lower() != "bearer" or not token:
        raise HTTPException(status_code=401, detail="缺少 Bearer 令牌", headers=BEARER)
    try:
        return jwt.decode(token, jwt_secret(), algorithms=["HS256"])
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="令牌已过期,请重新登录", headers=BEARER)
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="令牌无效", headers=BEARER)


ClaimsDep = Annotated[dict[str, Any], Depends(current_claims)]


@app.get("/me")
def me(claims: ClaimsDep):
    return {"user": claims["sub"], "role": claims["role"], "seconds_left": claims["exp"] - int(time.time())}


@app.post("/logout")
def logout(claims: ClaimsDep):
    return {"ok": True, "user": claims["sub"]}
```

<div class="line-notes">

- `import jwt` pyjwt。
- `USERS = {"alice": {"password": "wonderland-2026", "role": "support"}}` 和 Day 82 一样的演示用户,多了角色。密码明文存着只是为了演示,真实系统存的是密码的慢哈希。
- `TOKEN_TTL = 900` 令牌有效期 15 分钟。JWT 很难作废(下面实测),所以有效期要**短**。真实系统常见的做法是 access token 几分钟到一小时,另配一个能在服务端作废的长期 refresh token 用来换新的 access token,那是 OAuth 部分的内容。
- `BEARER = {"WWW-Authenticate": "Bearer"}` 401 要带的头。这次用标准方案名 `Bearer`,不是 Day 82 自己声明的 `ApiKey`。
- `def jwt_secret() -> str:` 和 Day 82 的 `if not expected` 是同一个思路:fail closed。不光检查有没有,还检查够不够长。
- `if len(value) < 32:` 32 字节是第 4 步那条警告里说的推荐下限(RFC 7518 第 3.2 节)。生成方法:`uv run python -c "import secrets; print(secrets.token_urlsafe(32))"`,得到 43 个字符。
- `raise HTTPException(status_code=500, detail="服务端没有配置足够长的 JWT_SECRET")` 服务端配置问题,5 开头。
- `user = USERS.get(body.username)` 和 Day 82 一样:用户不存在和密码错回同一句话。
- `now = int(time.time())` 秒,取整。
- `claims = {"sub": body.username, "role": user["role"], "iat": now, "exp": now + TOKEN_TTL}` 要写进令牌的内容。**这里没有任何「存到服务端」的动作**,对比 Day 82 的 `SESSIONS[sid] = {...}`。
- `token = jwt.encode(claims, jwt_secret(), algorithm="HS256")` 签名。
- `return {"access_token": token, "token_type": "bearer", "expires_in": TOKEN_TTL}` 这三个字段名是 OAuth 2.0 规定的令牌响应格式,很多客户端和 SDK 都认这个形状,照着写就行。令牌放在**响应体**里交给客户端,不是 Set-Cookie。
- `def current_claims(authorization: Annotated[str | None, Header()] = None) -> dict[str, Any]:` 从 `Authorization` 头里取令牌的依赖。和 Day 82 练习 2 一样的拆法。
- `scheme, _, token = (authorization or "").partition(" ")` 没带头时 `authorization` 是 `None`,`None or ""` 得到空串,`partition` 不会报错。
- `if scheme.lower() != "bearer" or not token:` 方案名不区分大小写,令牌不能是空的。
- `return jwt.decode(token, jwt_secret(), algorithms=["HS256"])` 一行做完验签名、验过期。**没有查任何表**。
- `except jwt.ExpiredSignatureError:` 过期单独一句提示,前端可以据此跳回登录页。必须写在 `InvalidTokenError` **前面**:它是子类,写在后面的话会先被父类那一句接走,永远轮不到它。
- `except jwt.InvalidTokenError:` 其他所有问题:签名不对、格式坏了、算法不在白名单里。给外面的话统一是「令牌无效」,不细说是哪种,不给攻击者提示。
- `ClaimsDep = Annotated[dict[str, Any], Depends(current_claims)]` 和 Day 81 的 `TicketDep` 同样的写法。
- `return {"user": claims["sub"], "role": claims["role"], "seconds_left": claims["exp"] - int(time.time())}` 身份信息全部来自令牌本身。顺便算一下还剩几秒。
- `def logout(claims: ClaimsDep):` 退出接口。仔细看,它**什么都没删**,因为服务端本来就什么都没存。这就是下面要实测的问题。

</div>

basedpyright 检查 0 错误。先生成一个密钥,再启动:

```bash
uv run python -c "import secrets; print(secrets.token_urlsafe(32))"
JWT_SECRET=mBbdz7bnZ1UFwYNffavQVxu4YltZBbE98u1qXsXAKY8 uv run uvicorn part01.jwt_api:app --port 8000
```

<div class="line-notes">

- `uv run python -c "import secrets; print(secrets.token_urlsafe(32))"` 32 字节随机数,我这次得到 `mBbdz7bnZ1UFwYNffavQVxu4YltZBbE98u1qXsXAKY8`。你的一定不一样,下面的命令换成你自己的。
- `uv run uvicorn part01.jwt_api:app --port 8000` 密钥只对这一条命令生效。

</div>

另一个窗口,走一遍登录:

```bash
B=http://127.0.0.1:8000
curl -sS $B/me -i | grep -E '^HTTP|www-auth|detail'
curl -sS -X POST $B/login -H "Content-Type: application/json" -d '{"username":"alice","password":"wonderland-2026"}'; echo
TOKEN=$(curl -sS -X POST $B/login -H "Content-Type: application/json" -d '{"username":"alice","password":"wonderland-2026"}' | uv run python -c "import json,sys; print(json.load(sys.stdin)['access_token'])")
echo "TOKEN=$TOKEN"
curl -sS $B/me -H "Authorization: Bearer $TOKEN" -w "  [%{http_code}]\n"
```

<div class="line-notes">

- `curl -sS $B/me -i | grep -E '^HTTP|www-auth|detail'` 不带令牌访问,只留状态行、`www-authenticate` 头和 body。
- `-d '{"username":"alice","password":"wonderland-2026"}'; echo` 登录看一眼响应长什么样。`echo` 补一个换行,因为响应体末尾没有换行。
- `TOKEN=$(curl -sS -X POST $B/login` 再登录一次,用一小段 Python 从 JSON 里取出 `access_token` 存进 shell 变量。`json.load(sys.stdin)` 从管道读 JSON。
- `curl -sS $B/me -H "Authorization: Bearer $TOKEN"` 带上令牌。注意 Bearer 和令牌之间有一个空格。

</div>

实跑输出:

```text
HTTP/1.1 401 Unauthorized
www-authenticate: Bearer
{"detail":"缺少 Bearer 令牌"}
{"access_token":"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJhbGljZSIsInJvbGUiOiJzdXBwb3J0IiwiaWF0IjoxNzkyNjg0MjMzLCJleHAiOjE3OTI2ODUxMzN9.HGFVunDRYNNtbDrW5ZISU8t0aCn22td6wBw08sCllXE","token_type":"bearer","expires_in":900}
TOKEN=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJhbGljZSIsInJvbGUiOiJzdXBwb3J0IiwiaWF0IjoxNzkyNjg0MjMzLCJleHAiOjE3OTI2ODUxMzN9.HGFVunDRYNNtbDrW5ZISU8t0aCn22td6wBw08sCllXE
{"user":"alice","role":"support","seconds_left":900}  [200]
```

两次登录拿到的令牌一模一样:同一秒内签发,内容相同(`iat` 都是 1792684233),签名当然也相同。这也说明 JWT 是「算出来的」,不是「随机生成再存起来的」。

现在试伪造。把 payload 换成 admin、并且把过期时间改到很远的将来,签名还用原来的:

```bash
FAKE_P=$(uv run python -c "import base64;print(base64.urlsafe_b64encode(b'{\"sub\":\"alice\",\"role\":\"admin\",\"exp\":9999999999}').rstrip(b'=').decode())")
FORGED=$(echo $TOKEN | cut -d. -f1).$FAKE_P.$(echo $TOKEN | cut -d. -f3)
curl -sS $B/me -H "Authorization: Bearer $FORGED" -w "  [%{http_code}]\n"
curl -sS $B/me -H "Authorization: Bearer abc.def.ghi" -w "  [%{http_code}]\n"
```

<div class="line-notes">

- `FAKE_P=$(uv run python -c` 自己编码一个 admin 的 payload。里面的 `\"` 是因为外面已经用了双引号。
- `FORGED=$(echo $TOKEN | cut -d. -f1).$FAKE_P.$(echo $TOKEN | cut -d. -f3)` `cut -d. -f1` 以点为分隔符取第 1 段,`-f3` 取第 3 段。拼成「原头.假载荷.原签名」。
- `curl -sS $B/me -H "Authorization: Bearer abc.def.ghi"` 一个格式像、内容是乱写的令牌。

</div>

实跑输出:

```text
{"detail":"令牌无效"}  [401]
{"detail":"令牌无效"}  [401]
```

都被挡住了,而且对外是同一句话。

### 代价一:退出了,令牌还能用

```bash
curl -sS -X POST $B/logout -H "Authorization: Bearer $TOKEN" -w "  [%{http_code}]\n"
curl -sS $B/me -H "Authorization: Bearer $TOKEN" -w "  [%{http_code}]\n"
```

实跑输出:

```text
{"ok":true,"user":"alice"}  [200]
{"user":"alice","role":"support","seconds_left":900}  [200]
```

退出成功了,可同一个令牌紧接着访问 `/me` 照样 200。对比 Day 82:session 方案退出时删掉服务端记录,复制走的旧 cookie 立刻失效。JWT 的服务端没有记录可删,令牌只要签名对、没过期,就是有效的。前端说的「退出」,一般是把本地存的令牌扔掉;但如果令牌已经被人复制走了,他手里那份还能用到 `exp` 那一刻。这就是为什么 `TOKEN_TTL` 要短。

### 代价和好处:重启服务

Ctrl+C 停掉服务,用**同一个**密钥重新启动,再用旧令牌访问;然后换一个新密钥启动,再访问一次:

```bash
curl -sS $B/me -H "Authorization: Bearer $TOKEN" -w "  [%{http_code}]\n"
```

两次的实跑输出依次是:

```text
{"user":"alice","role":"support","seconds_left":886}  [200]
{"detail":"令牌无效"}  [401]
```

同一个密钥重启后,令牌依然有效,`seconds_left` 少了十几秒,是我停服务、重启花掉的时间。Day 82 的 session 演示重启之后所有人都得重新登录,JWT 不会,因为服务端本来就不靠内存里的表认人。三台服务器只要配同一个密钥,任何一台都能验任何一个令牌。

换了密钥,所有旧令牌一起失效。这是 JWT 唯一的「全体作废」手段:一旦怀疑密钥泄露,换密钥,所有人重新登录。

最后,不配密钥启动(`uv run uvicorn part01.jwt_api:app --port 8000`),登录:

```text
{"detail":"服务端没有配置足够长的 JWT_SECRET"}  [500]
```

fail closed。如果这里没有检查,`jwt.encode` 会用空字符串当密钥照样签发,任何知道「密钥是空的」的人都能伪造令牌。

## 第 7 步:JWT 和 session 怎么选

<figure>
<svg viewBox="0 0 640 250" role="img" aria-label="session 和 JWT 校验方式对比:session 每次请求拿编号查服务端的表;JWT 每次请求用密钥重算签名,不查表">
<rect x="0" y="0" width="640" height="250" fill="var(--paper-raised)" rx="6"/>
<g font-family="var(--font-mono)" font-size="12">
<text x="20" y="28" fill="var(--ink)">session(Day 82)</text>
<rect x="20" y="40" width="170" height="44" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="105" y="60" fill="var(--ink)" text-anchor="middle">Cookie: sid=09Gz…</text>
<text x="105" y="76" fill="var(--ink-soft)" text-anchor="middle" font-size="11">随机编号,无含义</text>
<rect x="240" y="40" width="160" height="44" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="320" y="60" fill="var(--ink)" text-anchor="middle">查 SESSIONS 表</text>
<text x="320" y="76" fill="var(--ink-soft)" text-anchor="middle" font-size="11">每个请求一次</text>
<rect x="450" y="40" width="170" height="44" rx="4" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="535" y="60" fill="var(--ink)" text-anchor="middle">删记录 = 立刻作废</text>
<text x="535" y="76" fill="var(--ink-soft)" text-anchor="middle" font-size="11">重启/多台要共享表</text>
<line x1="190" y1="62" x2="240" y2="62" stroke="var(--rule)" stroke-width="2"/>
<line x1="400" y1="62" x2="450" y2="62" stroke="var(--rule)" stroke-width="2"/>
<text x="20" y="138" fill="var(--ink)">JWT(今天)</text>
<rect x="20" y="150" width="170" height="44" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="105" y="170" fill="var(--ink)" text-anchor="middle">Bearer eyJ….eyJ….sig</text>
<text x="105" y="186" fill="var(--ink-soft)" text-anchor="middle" font-size="11">内容明文 + 签名</text>
<rect x="240" y="150" width="160" height="44" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="320" y="170" fill="var(--ink)" text-anchor="middle">用密钥重算 HMAC</text>
<text x="320" y="186" fill="var(--ink-soft)" text-anchor="middle" font-size="11">不查表,看 exp</text>
<rect x="450" y="150" width="170" height="44" rx="4" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="535" y="170" fill="var(--ink)" text-anchor="middle">到 exp 才失效</text>
<text x="535" y="186" fill="var(--ink-soft)" text-anchor="middle" font-size="11">重启/多台都不怕</text>
<line x1="190" y1="172" x2="240" y2="172" stroke="var(--rule)" stroke-width="2"/>
<line x1="400" y1="172" x2="450" y2="172" stroke="var(--rule)" stroke-width="2"/>
<text x="20" y="232" fill="var(--ink-soft)" font-size="11">一句话:session 把状态放服务端,好作废;JWT 把状态放令牌里,好扩展,难作废。</text>
</g>
</svg>
<figcaption>两种方案的差别在中间那一格:session 每次都要回到服务端的表里确认,JWT 只要密钥在手就能自己验。右边一格是各自付出的代价。</figcaption>
</figure>

| | session + cookie | JWT |
| --- | --- | --- |
| 令牌里有什么 | 一个随机编号 | 用户、角色、过期时间(明文)+ 签名 |
| 服务端存什么 | session 表 | 只存一个密钥 |
| 每次请求做什么 | 拿编号查表 | 重算签名、看 `exp` |
| 退出/踢人 | 删记录,立刻生效 | 做不到,只能等过期,或者另加一张「作废名单」(练习 3) |
| 改权限 | 改表,下一个请求就生效 | 旧令牌里写的还是旧角色,要等它过期 |
| 多台服务器 | 要共享 session 表(Redis 等) | 配同一个密钥就行 |
| 别的服务能不能验 | 要能访问那张表 | 拿到密钥(或公钥)就能验 |

我的看法:一个只给自己网页用的后台,用 session 加 HttpOnly cookie 更简单,也更好管。JWT 的长处在「签发的一方和验证的一方不是同一个服务」的时候:登录服务签发,工单服务、退款服务各自验证,不用都去查同一张表。后面讲 OAuth 和 MCP 网关时,你会看到大量 JWT,原因就在这里;那时候用的通常不是 HS256 这种双方共享同一个密钥的算法,而是 RS256、ES256 这类**非对称**算法:签发方用私钥签,验证方只拿公钥验,验证方即使被攻破,也签不出新令牌。今天只用 HS256,先把「签名怎么验」这件事弄明白。

还有一个前端会问的问题:令牌拿到以后存哪?存 `localStorage` 最方便,但页面一旦被注入恶意脚本(XSS),脚本能直接读走它;Day 82 讲的 HttpOnly cookie 就是为了防这个。所以也有人把 JWT 放进 HttpOnly cookie 里,享受 cookie 的保护,同时保留「服务端不查表」的好处,代价是又要面对 cookie 的跨站请求问题。没有一种存法是完美的,这个取舍到做 SupportPilot 工作台时再细说。

## 动手练习

**练习 1:不用库看令牌内容。** 写 `part01/jwt_peek.py`,从命令行参数拿一个 JWT,打印出 header 和 payload 两个字典,不验签名,只用 `base64` 和 `json`。不是三段时给出清楚的报错。用第 6 步拿到的 `$TOKEN` 试一下,并把 `exp` 换算成北京时间。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part01/jwt_peek.py
import base64
import json
import sys


def peek(token: str) -> tuple[dict, dict]:
    parts = token.split(".")
    if len(parts) != 3:
        raise ValueError(f"应该是 3 段,实际是 {len(parts)} 段")
    decoded = []
    for part in parts[:2]:
        raw = base64.urlsafe_b64decode(part + "=" * (-len(part) % 4))
        decoded.append(json.loads(raw))
    return decoded[0], decoded[1]


if __name__ == "__main__":
    header, payload = peek(sys.argv[1])
    print("header :", header)
    print("payload:", payload)
```

<div class="line-notes">

- `import sys` 要用 `sys.argv` 读命令行参数(Day 44)。
- `def peek(token: str) -> tuple[dict, dict]:` 返回两个字典组成的元组。
- `parts = token.split(".")` 先切开,不急着解包,方便检查段数。
- `if len(parts) != 3:` 不是三段就说清楚是几段,比 `ValueError: not enough values to unpack` 好懂。
- `for part in parts[:2]:` 只处理前两段,第三段是签名的字节,不是 JSON。
- `raw = base64.urlsafe_b64decode(part + "=" * (-len(part) % 4))` 补齐再解码。
- `header, payload = peek(sys.argv[1])` `sys.argv[1]` 是命令后面的第一个参数。

</div>

```bash
uv run python -m part01.jwt_peek "$TOKEN"
uv run python -m part01.jwt_peek abc.def
date -r 1792685133
```

<div class="line-notes">

- `uv run python -m part01.jwt_peek "$TOKEN"` 变量加引号是好习惯,万一值里有空格不会被拆开。
- `date -r 1792685133` macOS 上把 Unix 时间戳换成本地时间(Linux 上写 `date -d @1792685133`)。

</div>

实跑输出(第二条只留了最后一行):

```text
header : {'alg': 'HS256', 'typ': 'JWT'}
payload: {'sub': 'alice', 'role': 'support', 'iat': 1792684233, 'exp': 1792685133}
ValueError: 应该是 3 段,实际是 2 段
Fri 23 Oct 2026 00:05:33 CST
```

`exp - iat` 正好 900 秒。这个脚本没有密钥也能读出全部内容,再一次说明 payload 是公开的。网上的 jwt.io 做的也是这件事,但**别把真实环境的令牌贴到任何网站上**,那等于把能登录的凭证交给了别人;自己写个 peek 就够了。

</details>

**练习 2:401 之外,加一个 403。** 加一个用户 `bob`(密码 `builder-2026`,角色 `admin`)和一个接口 `GET /admin/refunds`,只有 admin 能看,support 角色访问回 403。要求把「检查角色」写成一个依赖 `require_admin`,它本身依赖 `current_claims`。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part01/jwt_api.py(改过的 USERS,新增 require_admin 和 all_refunds)
USERS = {
    "alice": {"password": "wonderland-2026", "role": "support"},
    "bob": {"password": "builder-2026", "role": "admin"},
}


def require_admin(claims: ClaimsDep) -> dict[str, Any]:
    if claims["role"] != "admin":
        raise HTTPException(status_code=403, detail=f"角色 {claims['role']} 不能查看全部退款")
    return claims


@app.get("/admin/refunds")
def all_refunds(claims: Annotated[dict[str, Any], Depends(require_admin)]):
    return {"viewer": claims["sub"], "items": [{"id": 1, "amount_cents": 9900, "status": "pending"}]}
```

<div class="line-notes">

- `def require_admin(claims: ClaimsDep) -> dict[str, Any]:` 依赖的参数里又是一个依赖,这叫**子依赖**。FastAPI 先跑 `current_claims`(认人,不对就 401),再跑 `require_admin`(看权限,不够就 403)。顺序天然就是「先认证,再授权」。
- `if claims["role"] != "admin":` 角色是从令牌里读的。这里能放心用,是因为签名保证了它没被改过。
- `raise HTTPException(status_code=403,` 认出你是谁了,但你不能做这件事:403(Day 82 的那张表)。
- `def all_refunds(claims: Annotated[dict[str, Any], Depends(require_admin)]):` 接口直接依赖 `require_admin`,拿到的还是 claims。

</div>

用 TestClient 验证(脚本 `scratch/ex84.py`,`JWT_SECRET` 设成 40 个 `x`),实跑输出:

```text
alice 403 {'detail': '角色 support 不能查看全部退款'}
bob   200 {'viewer': 'bob', 'items': [{'id': 1, 'amount_cents': 9900, 'status': 'pending'}]}
没令牌 401 {'detail': '缺少 Bearer 令牌'}
```

三种情况三个状态码:不认识 401,认识但不够格 403,够格 200。basedpyright 0 错误。这里有个 JWT 特有的问题值得想一想:假如现在把 alice 升成 admin,她手里那个写着 `support` 的令牌在过期前还是 support;反过来,把 bob 降级,他旧令牌里的 `admin` 也还能用 15 分钟。权限变更不能立刻生效,也是选 JWT 要接受的代价。

</details>

**练习 3:让退出真正生效。** 给每个令牌加一个唯一编号 `jti`(用 `uuid.uuid4().hex`),服务端维护一个集合 `REVOKED`;`/logout` 把当前令牌的 `jti` 加进去,`current_claims` 发现 `jti` 在集合里就回 401「令牌已注销」。做完想一想:这还算「服务端不存状态」吗?

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part01/jwt_api.py(改过的部分)
import uuid

REVOKED: set[str] = set()


@app.post("/login")
def login(body: LoginIn):
    user = USERS.get(body.username)
    if user is None or not secrets.compare_digest(body.password.encode(), user["password"].encode()):
        raise HTTPException(status_code=401, detail="用户名或密码不对")
    now = int(time.time())
    claims = {"sub": body.username, "role": user["role"], "iat": now, "exp": now + TOKEN_TTL, "jti": uuid.uuid4().hex}
    token = jwt.encode(claims, jwt_secret(), algorithm="HS256")
    return {"access_token": token, "token_type": "bearer", "expires_in": TOKEN_TTL}


def current_claims(authorization: Annotated[str | None, Header()] = None) -> dict[str, Any]:
    scheme, _, token = (authorization or "").partition(" ")
    if scheme.lower() != "bearer" or not token:
        raise HTTPException(status_code=401, detail="缺少 Bearer 令牌", headers=BEARER)
    try:
        claims = jwt.decode(token, jwt_secret(), algorithms=["HS256"])
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="令牌已过期,请重新登录", headers=BEARER)
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="令牌无效", headers=BEARER)
    if claims.get("jti") in REVOKED:
        raise HTTPException(status_code=401, detail="令牌已注销", headers=BEARER)
    return claims


@app.post("/logout")
def logout(claims: ClaimsDep):
    REVOKED.add(claims["jti"])
    return {"ok": True, "user": claims["sub"], "revoked": len(REVOKED)}
```

<div class="line-notes">

- `import uuid` 加在文件开头的 import 里,Day 81 中间件生成请求编号时用过。
- `REVOKED: set[str] = set()` 作废名单,用集合(Day 25),查「在不在里面」很快。放在 `USERS` 下面。
- `"jti": uuid.uuid4().hex}` 每个令牌一个随机编号。有了它,同一秒签发的两个令牌也不再一模一样了。
- `claims = jwt.decode(token, jwt_secret(), algorithms=["HS256"])` 不再直接 return,先存下来,后面还要查名单。
- `if claims.get("jti") in REVOKED:` 签名对、没过期,还要不在作废名单里。用 `.get` 是因为改代码之前签发的旧令牌没有 `jti`,`claims["jti"]` 会抛 `KeyError` 变成 500。
- `REVOKED.add(claims["jti"])` 退出时把编号加入名单。

</div>

TestClient 验证,接着练习 2 的脚本跑:

```text
logout: {'ok': True, 'user': 'alice', 'revoked': 1}
注销后 /me: 401 {'detail': '令牌已注销'}
```

退出生效了。但回答那个问题:**这已经不是「不存状态」了**。`REVOKED` 就是一张表,每个请求都要查;它在内存里,重启就丢,作废过的令牌又能用了;多台服务器还得共享它。你绕了一圈,又回到了 session 的问题上,只是表从「谁登录着」变成了「谁被踢了」。好在这张表可以只存到令牌过期为止(过期的令牌本来就无效),通常比 session 表小得多。真实系统里常见的折中就是这样:短有效期 + 一张只记「提前作废」的名单,放在 Redis 之类的共享存储里。

</details>

**练习 4:给 `jwt_api.py` 写测试。** 新建 `tests/test_jwt_api.py`,至少覆盖:登录后 `/me` 是 200;令牌过期是 401 且提示「令牌已过期」(提示:用 monkeypatch 把 `TOKEN_TTL` 改成负数);别的密钥签的令牌是 401 且带 `WWW-Authenticate: Bearer`;`JWT_SECRET` 太短时登录是 500。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/tests/test_jwt_api.py
import jwt
import pytest
from fastapi.testclient import TestClient

from part01 import jwt_api
from part01.jwt_api import app

client = TestClient(app)
SECRET = "test-secret-" + "x" * 30
ALICE = {"username": "alice", "password": "wonderland-2026"}


@pytest.fixture(autouse=True)
def setup(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("JWT_SECRET", SECRET)


def bearer(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def test_login_then_me():
    token = client.post("/login", json=ALICE).json()["access_token"]
    resp = client.get("/me", headers=bearer(token))
    assert resp.status_code == 200
    assert resp.json()["user"] == "alice"


def test_expired_token(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(jwt_api, "TOKEN_TTL", -10)
    token = client.post("/login", json=ALICE).json()["access_token"]
    resp = client.get("/me", headers=bearer(token))
    assert resp.status_code == 401
    assert resp.json()["detail"] == "令牌已过期,请重新登录"


def test_other_secret_rejected():
    token = jwt.encode({"sub": "alice", "role": "admin", "exp": 9999999999}, "y" * 40, algorithm="HS256")
    resp = client.get("/me", headers=bearer(token))
    assert resp.status_code == 401
    assert resp.headers["WWW-Authenticate"] == "Bearer"


def test_short_secret_fails_closed(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("JWT_SECRET", "short")
    assert client.post("/login", json=ALICE).status_code == 500
```

<div class="line-notes">

- `SECRET = "test-secret-" + "x" * 30` 测试专用的假密钥,42 个字符,够长。字符串乘整数就是重复几遍。
- `def bearer(token: str) -> dict[str, str]:` 小工具函数,拼请求头,四个测试里少写几遍。
- `monkeypatch.setattr(jwt_api, "TOKEN_TTL", -10)` 有效期改成负数,签发出来的令牌 `exp` 在 10 秒前,一出生就过期了,不用 `sleep`。`login` 每次调用时才读 `TOKEN_TTL`,所以改模块上的变量马上生效(和 Day 82 练习 4 改 `SESSION_TTL` 同一个道理)。
- `token = jwt.encode({"sub": "alice", "role": "admin", "exp": 9999999999}, "y" * 40, algorithm="HS256")` 攻击者自己有一个够长的密钥,签了一个 admin 令牌。格式完全合规,只是密钥不是服务端那个。
- `assert resp.headers["WWW-Authenticate"] == "Bearer"` 钉住 401 必须带的头。
- `monkeypatch.setenv("JWT_SECRET", "short")` 覆盖掉 autouse fixture 设的值,模拟配错了。

</div>

`uv run pytest tests/test_jwt_api.py -q` 实跑输出:

```text
....                                                                     [100%]
4 passed in 1.04s
```

做完练习 2、3 之后再跑一次,同样 `4 passed`。basedpyright 0 错误。

</details>

**验收标准:** `jwt_by_hand.py` 拼出的令牌能被 `jwt.decode` 接受,且和 `jwt.encode` 的结果相等;`jwt_api.py` 用 curl 走完「不带令牌 401 → 登录拿令牌 → /me 200 → 伪造 401 → 退出后旧令牌仍 200」,不配密钥登录是 500;`uv run pytest -q` 全绿;能不看文章说出三段各是什么、签名为什么能防篡改却不能防偷看、`algorithms` 为什么必须写、JWT 为什么难作废。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| JWT | JSON Web Token,`header.payload.signature` 三段、用点连接的令牌,内容明文、签名防篡改 |
| header | JWT 第一段,说明签名算法,如 `{"alg":"HS256","typ":"JWT"}` |
| payload | JWT 第二段,要传递的内容,由一个个声明组成 |
| signature | JWT 第三段,对前两段的签名 |
| 声明(claim) | payload 里的一个字段,如 `sub`、`exp`、`role` |
| `sub` / `exp` / `iat` / `jti` | 注册声明:主体 / 过期时刻 / 签发时刻 / 令牌编号,时间都是 Unix 秒 |
| base64 | 把任意字节编码成 64 种字符的文本,≈浏览器的 `btoa`/`atob`;是编码不是加密 |
| base64url | base64 的 URL 安全变种:`+`→`-`、`/`→`_`,JWT 里去掉末尾 `=` |
| padding | base64 末尾补齐用的 `=`,缺了 Python 解码报 `Incorrect padding` |
| 哈希(hash) | 把任意数据算成固定长度的指纹,改一个字节指纹全变,不能倒推,如 SHA-256 |
| HMAC | 带密钥的哈希,不知道密钥就算不出,用来做签名 |
| HS256 | HMAC + SHA-256,签发和验证用同一个密钥(对称) |
| RS256 / ES256 | 非对称签名算法,私钥签、公钥验,后面 OAuth 部分会用 |
| `alg: none` | 不签名的 JWT,服务端必须用 `algorithms` 白名单拒绝它 |
| `algorithms` 白名单 | `jwt.decode(..., algorithms=["HS256"])`,由服务端决定接受哪些算法 |
| access token | 访问令牌,带在请求里证明身份;有效期应短 |
| `InvalidTokenError` | pyjwt 所有令牌错误的父类;子类有 `ExpiredSignatureError`、`InvalidSignatureError` 等 |
| 作废名单(denylist) | 记录提前作废的令牌 `jti`,让 JWT 能「退出」,代价是又有了服务端状态 |
| 子依赖 | 依赖函数的参数里又依赖另一个依赖,如 `require_admin` 依赖 `current_claims` |

## 常见误区

**以为 JWT 是加密的。** 实测 `atob` 或 `base64.urlsafe_b64decode` 就能读出 payload。签名只保证没被改过,不保证别人看不到。不往里放密码、手机号、内部 ID 之类的敏感信息。

**`decode` 不写 `algorithms`,或者照着令牌 header 里的 `alg` 去验。** pyjwt 2 不写直接报 `DecodeError`;别的库或者自己手写时,信了令牌自己声明的算法,就可能被 `alg: none` 绕过。算法由服务端白名单定。

**服务端用 `verify_signature: False`。** 不报错,伪造的 admin 令牌原样通过。只在调试脚本里偷看内容时用。

**`except InvalidTokenError` 写在 `ExpiredSignatureError` 前面。** 父类先接住,过期的提示永远出不来,用户只看到「令牌无效」,不知道该重新登录。子类异常写在前面。

**`exp` 用毫秒。** 前端顺手写 `Date.now() + 15 * 60 * 1000`,得到的令牌几万年后才过期。JWT 的时间都是秒。

**密钥太短或者写死在代码里。** pyjwt 对少于 32 字节的 HMAC 密钥会给 `InsecureKeyLengthWarning`。用 `secrets.token_urlsafe(32)` 生成,从环境变量读,太短就拒绝启动工作。

**以为「退出」就作废了令牌。** 实测 `/logout` 之后旧令牌照样 200。要么接受「等到过期」,把有效期设短;要么加作废名单,接受它带来的服务端状态。

**装成了 `jwt` 包。** PyPI 上的 `jwt` 是另一个库,要装的是 `pyjwt`,导入名才是 `jwt`。

**把生产环境的令牌贴到在线解码网站。** 令牌就是凭证,贴出去等于交出登录态。用自己写的 `jwt_peek.py`。

**解码时忘了补 `=`。** `binascii.Error: Incorrect padding`。补 `"=" * (-len(s) % 4)`。

## 学习资料

### 文档与文章

- [jwt.io · Introduction to JSON Web Tokens(英文)](https://jwt.io/introduction):JWT 最常被引用的一篇入门,三段结构、什么时候用都讲了。
- [RFC 7519 · JSON Web Token](https://datatracker.ietf.org/doc/html/rfc7519):规范原文。第 4.1 节是 `sub`、`exp`、`iat`、`jti` 这些注册声明的定义,遇到「这个字段到底该怎么填」时查。
- [RFC 8725 · JWT Best Current Practices(英文)](https://datatracker.ietf.org/doc/html/rfc8725):JWT 的安全最佳实践,`alg: none`、算法混淆、密钥长度这些坑的来龙去脉都在这里。今天第 5 步的三个坑是其中最基础的。
- [RFC 4648 第 5 节 · base64url](https://datatracker.ietf.org/doc/html/rfc4648#section-5):base64url 的定义,一页纸。
- [PyJWT 文档 · Usage Examples(英文)](https://pyjwt.readthedocs.io/en/stable/usage.html):`exp`、`iat`、`leeway`(允许几秒时钟误差)、`audience` 等用法的例子。
- [OWASP · JSON Web Token Cheat Sheet(英文)](https://cheatsheetseries.owasp.org/cheatsheets/JSON_Web_Token_Cheat_Sheet.html):原本以 Java 为例写的安全清单,讲到了令牌存哪、怎么作废、怎么防侧信道,和语言无关。
- [Python 文档 · hmac](https://docs.python.org/zh-cn/3.12/library/hmac.html)、[Python 文档 · base64](https://docs.python.org/zh-cn/3.12/library/base64.html):今天手工拼令牌用到的两个标准库模块。
- [MDN · Base64](https://developer.mozilla.org/zh-CN/docs/Glossary/Base64)、[MDN · btoa](https://developer.mozilla.org/zh-CN/docs/Web/API/Window/btoa):前端这边的 base64,和 Python 的对照着看。
- [FastAPI 中文文档 · 使用密码和 JWT Bearer 令牌的 OAuth2](https://fastapi.tiangolo.com/zh/tutorial/security/oauth2-jwt/):FastAPI 官方的 JWT 登录示例,用了 `OAuth2PasswordBearer` 和密码哈希,比今天的手写版完整。今天的 `current_claims` 和它的 `get_current_user` 是同一个形状。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1T7BoYGE6A&autoplay=0&high_quality=1" title="17. 理解JWT以及在FastAPI中使用JWT" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>玩代码的预测师 · 17. 理解 JWT 以及在 FastAPI 中使用 JWT · 约 29 分钟。和今天的技术栈完全一致,前半段讲三段结构,后半段在 FastAPI 里做登录,可以和第 6 步对照。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1cK4y197EM&autoplay=0&high_quality=1" title="【极简入门】15分钟学会JWT的使用" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>Java大联盟 · 【极简入门】15 分钟学会 JWT 的使用 · 约 16 分钟,播放 15 万多。代码是 Java 写的,看前面讲原理的部分就够了:token 怎么生成、签名怎么防篡改,和第 2、3 步讲的是同一件事。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/7Q17ubqLfaM" title="What Is JWT and Why Should You Use JWT" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Web Dev Simplified · What Is JWT and Why Should You Use JWT · 英文。前端工程师视角讲 JWT,画了 session 和 JWT 两种流程的对比图,配合第 7 步看。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/UBUNrFtufWo" title="Session vs Token Authentication in 100 Seconds" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Fireship · Session vs Token Authentication in 100 Seconds · 英文,不到两分钟。Day 82 推荐过,今天学完再看一遍,应该每一句都能对上代码。</figcaption>
</figure>

### 书籍

- Neil Madden,《API Security in Action》,Manning,2020(英文)。Day 82 推荐过。第 6 章讲自包含令牌和 JWT,包括为什么不能信 header 里的 `alg`、HMAC 和公钥签名怎么选、令牌怎么作废,比今天讲得深,例子是 Java。

### 开源项目与代码

- [jpadilla/pyjwt](https://github.com/jpadilla/pyjwt):今天用的库。`jwt/api_jws.py` 里能找到签名输入是怎么拼的(和我们的 `signing_input` 一样),`jwt/api_jwt.py` 里能找到 `exp` 的检查,大约几十行,对照着读一读,会发现我们手写的版本少的就是这些检查。
- [fastapi/full-stack-fastapi-template](https://github.com/fastapi/full-stack-fastapi-template):`backend/app/core/security.py` 是签发令牌,`backend/app/api/deps.py` 是校验令牌的依赖,和今天的 `login` + `current_claims` 一一对应。

## 自测

1. 一个 JWT 是 `aaa.bbb.ccc`。哪两段谁都能读?哪一段只有服务端能算出来?服务端怎么验?

<details><summary>答案</summary>

`aaa`(header)和 `bbb`(payload)是 base64url 编码的 JSON,任何人都能解码读出来。`ccc` 是用服务端密钥对 `aaa.bbb` 做 HMAC-SHA256 再编码的结果,没有密钥算不出来。服务端验证时用自己的密钥对收到的 `aaa.bbb` 重算一次,和 `ccc` 比对,对上了再检查 `exp`,都通过才相信 payload。

</details>

2. alice 把自己令牌的 payload 改成 `"role":"admin"`,签名保留原样发给服务端。会发生什么?如果她连签名一起重算呢?

<details><summary>答案</summary>

前一种:服务端重算的签名和她带来的对不上,`InvalidSignatureError`,401。后一种:她没有服务端的密钥,只能用自己猜的密钥算,服务端用真密钥重算还是对不上,同样 401。唯一能骗过服务端的办法是拿到密钥,所以密钥要够长、要保密、泄露了要立刻换。

</details>

3. 为什么 `jwt.decode` 必须写 `algorithms=["HS256"]`,而不能「看令牌 header 里写的是什么算法就用什么算法」?

<details><summary>答案</summary>

header 是令牌的一部分,攻击者能随便改。如果服务端照着它选算法,攻击者把 `alg` 改成 `none`,就可能让服务端跳过签名校验,用一个不签名的令牌冒充任何人。算法必须由服务端白名单决定,今天实测 `alg: none` 的令牌被 `InvalidAlgorithmError` 挡掉。

</details>

4. 用 JWT 做登录,用户点了「退出」,有人之前复制了他的令牌,还能用吗?有哪些办法?

<details><summary>答案</summary>

能,直到 `exp` 为止(今天实测退出后旧令牌仍然 200)。办法:有效期设短(几分钟到十几分钟),配合可以在服务端作废的 refresh token 续期;需要立刻作废时,维护一个 `jti` 作废名单,每次校验时查(练习 3),代价是又有了服务端状态;怀疑密钥泄露时换密钥,所有令牌一起失效。

</details>

5. 面试题:你们有一个登录服务和三个业务服务(工单、退款、Agent 网关),都要认用户。你会用 session 还是 JWT?用 JWT 的话有什么要注意的?

<details><summary>答案</summary>

这个场景 JWT 更合适:签发方和验证方不是同一个服务,用 JWT 的话业务服务拿到令牌自己就能验,不用每个请求都去查登录服务或共享一张 session 表。要注意:用非对称算法(RS256/ES256),登录服务持有私钥签发,业务服务只拿公钥验证,一个业务服务被攻破也签不出令牌;`decode` 时固定算法白名单,校验 `exp`,最好也校验 `aud`(这个令牌是发给哪个服务的),避免发给 A 服务的令牌被拿去 B 服务用;access token 有效期短,配 refresh token;payload 不放敏感信息;需要即时踢人的场景加 `jti` 作废名单放在共享存储里;角色变更要等旧令牌过期才生效,这一点要和产品说清楚。浏览器端如果是自己的网页,令牌放 HttpOnly cookie 比 localStorage 更能防 XSS。

</details>

## 明天预告

Day 85 · SQL(一):SQLite、建表和 SELECT。这两周的工单、退款申请、session 表、作废名单,全都放在 Python 的列表和字典里,进程一重启就没了,Day 80 和 Day 83 都撞上过。明天开始用数据库存数据:先用 macOS 自带的 `sqlite3` 命令行建一张 CloudLedger 的 `customers` 表,装进 10 个客户,然后学 SQL 里用得最多的一句话 `SELECT`,用 `WHERE` 筛选、`ORDER BY` 排序。不写 Python,先把 SQL 本身弄熟。
