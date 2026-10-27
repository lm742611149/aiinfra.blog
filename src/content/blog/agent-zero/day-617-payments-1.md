---
title: 'Day 617 · Agent 支付(一):三层拆解,x402'
description: 'Agent 要自己花钱,先得回答三个不同的问题:谁授权、买什么、钱怎么走。今天先把现有的支付协议放进「授权、结账、结算」三层,再用本地假结算服务加官方 x402 SDK 把 HTTP 402 的一次完整往返跑出来:看 402 响应长什么样、客户端怎么签名、服务端怎么放行,以及重放和篡改为什么被挡住。全程一次性测试密钥,不连任何链,不碰真钱。'
pubDate: 2026-10-27
regime: none
tags: ['payments', 'x402', 'http', 'python', 'agent-zero']
series: 'agent-zero'
day: 617
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 616](/blog/agent-zero/day-616-a2a-2/) 用官方 SDK 把对账 Agent 做成了真的 A2A 服务,读了名片、任务、消息这些对象,加了 Bearer 鉴权,还演示了「身份对、数据错」的 confused deputy 问题。那个对账 Agent 查出了一笔重复扣款,但它从头到尾没碰过钱:退款是别的系统的事,它只负责说「该退」。

接下来的问题是:Agent 要自己花钱的时候怎么办?比如它要调一个按次收费的企业信用查询接口,一次两分钱;或者替客户把套餐升级,用客户绑的卡付款。这一课和下一课就讲这件事。今天先搭地图、跑通最简单的一条路(x402),明天讲授权。

## 今天要解决的问题

学完今天你应该能:

1. 用「授权、结账、结算」三层把 AP2、ACP、UCP、x402 这些协议放到正确的位置,说清哪些是竞争关系、哪些可以叠着用。
2. 读懂 x402 v2 的一次完整往返:402 响应里的 `PAYMENT-REQUIRED`、客户端带的 `PAYMENT-SIGNATURE`、结算回执 `PAYMENT-RESPONSE`,以及 facilitator 是干什么的。
3. 在本地用官方 `x402` SDK 跑通一次付款(402 → 签名 → 结算 → 200),并亲眼看到重放、改金额、改收款人被挡住。

今天两个新概念:**Agent 付钱的三层拆解**和 **x402(让 HTTP 402 真的用起来)**。

预计用时 3 小时。前置:[Day 616](/blog/agent-zero/day-616-a2a-2/)(A2A 和任务状态)、[Day 60](/blog/agent-zero/day-060-http-2/)(HTTP 状态码)、[Day 84](/blog/agent-zero/day-084-auth-2/)(签名是怎么回事)。

**安全红线,先说在前面。** 今天所有脚本都是本地的:收费接口是我们自己写的,「结算」是一个本地假服务,它会真的验签名,但不连任何区块链,交易号是假的。钱包是每次运行现生成的一次性测试密钥,私钥只在内存里,不打印、不保存,**不要往里打钱,也不要拿它们做任何别的事**。文中出现的网络名 `eip155:84532` 只是 Base Sepolia 测试网的编号,这里没有任何网络被连接。官方还提供一个公开的测试网结算服务,需要有测试币的钱包,我没有实跑,凡是涉及它的地方我都会写「没实跑」。

版本说明:下面的版本号和日期是我 2026 年 10 月 27 日当天查的。Python SDK `x402` 在 PyPI 上最新是 2.25.0,代码仓库是 `x402-foundation/x402`。协议规范目前是 v2。

学法:先对照文章逐行敲一遍(不复制粘贴)并跑通;第二天合上文章,把 `look_402.py` 里解码 `payment-required` 的那几行和 `replay_demo.py` 的 `forge` 函数默写出来;做练习,做不出再展开参考答案,看完关掉自己重写一遍。

## 先把「Agent 付钱」拆成三层

把一次网购拆开看,其实有三件不同的事。

第一件是**授权**:用户允许 Agent 花多少、花在哪、多久有效。出了事要能说清「这是我让它买的」还是「它自己乱买的」。第二件是**结账**:买什么、多少钱、含不含税、购物车怎么确认、订单怎么跟踪,这是商家的事。第三件是**结算**:钱从哪里出、怎么到商家账上,可以走银行卡网络,也可以走稳定币。

以前这三件事是人在网页上一口气做完的,人自己就是授权的证明。Agent 介入以后,中间多了一个不是用户本人的角色,每一层都要重新回答「凭什么信它」。现在冒出来的协议,基本上是各自挑了一两层来回答。

<figure>
<svg viewBox="0 0 640 300" role="img" aria-label="Agent 支付的三层:授权层有 AP2、Verifiable Intent、ACP 的 allowance;结账层有 ACP 和 UCP;结算层有银行卡网络、Stripe 共享令牌、x402 和 MPP">
  <rect x="0" y="0" width="640" height="300" fill="var(--paper-raised)"/>
  <text x="20" y="28" font-family="var(--font-mono)" font-size="12" fill="var(--ink-soft)">用户 → Agent → 商家 → 钱</text>
  <rect x="20" y="44" width="600" height="70" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
  <text x="36" y="68" font-family="var(--font-mono)" font-size="13" fill="var(--ink)">授权层:谁允许 Agent 花钱,花多少</text>
  <text x="36" y="92" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">AP2 的 mandate · Verifiable Intent · ACP 的 allowance(明天讲)</text>
  <rect x="20" y="124" width="600" height="70" rx="6" fill="var(--paper-raised)" stroke="var(--rule)"/>
  <text x="36" y="148" font-family="var(--font-mono)" font-size="13" fill="var(--ink)">结账层:买什么、多少钱、订单</text>
  <text x="36" y="172" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">ACP(OpenAI + Stripe 等) · UCP(Google + Shopify 等)(明天讲)</text>
  <rect x="20" y="204" width="600" height="70" rx="6" fill="var(--compute-wash)" stroke="var(--compute)"/>
  <text x="36" y="228" font-family="var(--font-mono)" font-size="13" fill="var(--ink)">结算层:钱怎么到账(今天主讲)</text>
  <text x="36" y="252" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">x402(HTTP 402) · 银行卡网络 · Stripe 共享令牌 · MPP</text>
  <text x="20" y="292" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">AP2 官网有走 x402 结算的示例;UCP 的付款扩展直接建在 AP2 上</text>
</svg>
<figcaption>Agent 付钱的三层。ACP、UCP 讲商家那一侧怎么卖,AP2 讲用户那一侧怎么授权,x402 和卡网络讲钱怎么走。一次真实的购买可以同时用到三层里的三个协议。</figcaption>
</figure>

这张图最有用的地方是帮你识别「假竞争」。经常看到文章把 AP2 和 x402 拿来比谁会赢,其实 AP2 官网列的示例里就有「用 x402 结算」的版本,两者是上下层的关系。真正正面竞争的是同一层里的:结账层的 ACP 和 UCP,结算层的 x402 和 MPP,以及卡组织各自的 Agent 令牌方案。

再排一个雷:Day 614 讲过的 ACP 是 **Agent Client Protocol**(编辑器和 Coding Agent 之间的协议)。明天要讲的 ACP 是 **Agentic Commerce Protocol**(OpenAI、Stripe 等维护的结账协议)。两个毫无关系,只是缩写撞了。面试里说 ACP 最好先报全名。

## x402:让 HTTP 402 终于派上用场

[Day 60](/blog/agent-zero/day-060-http-2/) 学状态码时你见过 401(没登录)、403(没权限)、404(没找到)。其实 HTTP 规范里还有一个从 1990 年代就留着没人用的状态码:**402 Payment Required**,现行的 RFC 9110 里写的是「保留给将来使用」。x402 就是把它用起来:你请求一个要付费的接口,服务端回 402,告诉你价格和收款方式;你签一笔付款,带着它重新请求;服务端核实、结算,然后给你内容。整个过程不需要注册账号、不需要 API key、不需要月底对账。这对 Agent 很重要:它可能一天调几百个不同的接口,每个都去注册账号不现实。

x402 最早由 Coinbase、Cloudflare、Stripe 一起开发。Linux 基金会在 2026 年 4 月 2 日的纽约 MCP Dev Summit 上宣布成立 x402 Foundation,由 Coinbase 把协议贡献出来,新闻稿里写的是「在 Linux 基金会治理下协议保持厂商中立」,列出表示支持的有 AWS、Google、Microsoft、Mastercard、Visa、Shopify、Stripe、Circle、Cloudflare 等二十多家。(后来有一篇报道说 7 月 14 日基金会正式开始运营、已有 40 个成员,我只找到这一个来源,没法交叉验证。)代码仓库随之搬到了 `github.com/x402-foundation/x402`,规范在仓库的 `specs/` 目录里:`schemes/` 下有 `exact`、`upto`、`batch-settlement`、`auth-capture` 几类,`transports-v2/` 下有 `http.md`、`mcp.md` 和 `a2a.md` 三种传输。最后这个值得停一下:x402 规范里有一份「在 A2A 上怎么收费」的写法,用的就是 Day 616 学的 `input-required` 状态,Agent 说「要付款」时任务停在 input-required,等调用方付了钱再继续。我只读了这份文档,没有实跑;它里面的例子还是 0.3 时代的写法(带 `kind`、小写状态名),用到 1.0 服务上要自己对照 Day 616 的变更表翻译。

### 先要认识几个词

付款这件事里有几个词,后面反复出现,先用大白话讲一遍。

**钱包**就是一对密钥:私钥自己留着,公钥算出来的短字符串叫**地址**,别人往这个地址付款。**签名**是用私钥对一段数据盖章,任何人拿公钥都能验证「这个章确实是这把私钥盖的」,但没法伪造。**稳定币**是和美元 1:1 挂钩的链上货币,USDC 是其中一种,小数位是 6 位,所以 `20000` 个最小单位等于 0.02 美元。**链**就是记账的公共数据库,「结算」就是把一笔转账写进去。

x402 里最常用的付款方式叫 `exact`(固定金额),底下用的是 **EIP-3009**:持有人离线签一张「授权某人从我账上划走 X 个 USDC」的支票,**签名本身不花钱、也不上链**;谁拿着这张支票去链上合约兑现,合约才会验签、划走钱、记下这张支票的编号(`nonce`)防止再兑一次。支票上有有效期(`validBefore`),过期作废。你可以把它想成纸质支票:签了字不等于钱已经走了,兑现那一刻才算。

还有一个角色叫 **facilitator**(结算代理):它替收费方跟链打交道,提供三个接口:`POST /verify` 只检查不扣钱,`POST /settle` 真的兑现,`GET /supported` 列出它支持哪些链和付款方式。收费方因此不用自己跑区块链节点。

### 一次往返长什么样

<figure>
<svg viewBox="0 0 640 330" role="img" aria-label="x402 v2 一次付费请求的时序:客户端请求,收费接口回 402 加 PAYMENT-REQUIRED,客户端签名后重发带 PAYMENT-SIGNATURE,收费接口向 facilitator 校验并结算,成功后返回内容和 PAYMENT-RESPONSE">
  <rect x="0" y="0" width="640" height="330" fill="var(--paper-raised)"/>
  <rect x="30" y="16" width="130" height="34" rx="5" fill="var(--mem-wash)" stroke="var(--mem)"/>
  <text x="95" y="38" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">Agent(客户端)</text>
  <rect x="255" y="16" width="130" height="34" rx="5" fill="var(--compute-wash)" stroke="var(--compute)"/>
  <text x="320" y="38" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">收费接口</text>
  <rect x="480" y="16" width="130" height="34" rx="5" fill="var(--compute-wash)" stroke="var(--compute)"/>
  <text x="545" y="38" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">facilitator</text>
  <line x1="95" y1="50" x2="95" y2="320" stroke="var(--rule)"/>
  <line x1="320" y1="50" x2="320" y2="320" stroke="var(--rule)"/>
  <line x1="545" y1="50" x2="545" y2="320" stroke="var(--rule)"/>
  <line x1="95" y1="80" x2="320" y2="80" stroke="var(--ink-soft)"/>
  <text x="105" y="74" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">① GET /api/credit-report/acme</text>
  <line x1="320" y1="116" x2="95" y2="116" stroke="var(--ink-soft)"/>
  <text x="105" y="110" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">② 402 + PAYMENT-REQUIRED</text>
  <text x="105" y="140" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">③ 钱包判断该不该付,然后签名</text>
  <line x1="95" y1="170" x2="320" y2="170" stroke="var(--ink-soft)"/>
  <text x="105" y="164" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">④ 重发 + PAYMENT-SIGNATURE</text>
  <line x1="320" y1="200" x2="545" y2="200" stroke="var(--ink-soft)"/>
  <text x="330" y="194" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">⑤ POST /verify、/settle</text>
  <line x1="545" y1="236" x2="320" y2="236" stroke="var(--ink-soft)"/>
  <text x="330" y="230" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">⑥ 结算结果(交易号)</text>
  <line x1="320" y1="276" x2="95" y2="276" stroke="var(--ink-soft)"/>
  <text x="105" y="270" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">⑦ 200 + 内容 + PAYMENT-RESPONSE</text>
  <text x="330" y="306" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">先结算成功,再放内容</text>
</svg>
<figcaption>x402 的一次付费请求。Agent 第一次请求被 402 挡回来,402 里写明了要价;钱包签名后重发;收费接口把签名交给 facilitator 核实并结算,成功后才返回内容和回执。</figcaption>
</figure>

协议 v2 里有三个 HTTP 头要认识:

- `PAYMENT-REQUIRED`:服务端随 402 返回,内容是 base64 编码的 JSON。里面的 `accepts` 数组列出它接受的付款方式,每一项有 `scheme`(怎么收)、`network`(哪条链)、`amount`(金额,最小单位)、`asset`(什么币)、`payTo`(收款地址)、`maxTimeoutSeconds`(签名多久有效)。
- `PAYMENT-SIGNATURE`:客户端重发时带上,也是 base64 的 JSON。`accepted` 原样抄一份自己选中的那一项,`payload` 里是签名和授权内容(付款人、收款人、金额、有效期、一次性的 `nonce`)。
- `PAYMENT-RESPONSE`:服务端成功时随 200 返回的结算回执,有 `success`、`payer`、`transaction`、`network`、`amount`。

`network` 用 CAIP-2 格式(`链类型:链编号`):`eip155:8453` 是 Base 主网,`eip155:84532` 是 Base Sepolia 测试网。

**有一个坑要提醒。** B 站和 YouTube 上搜到的 x402 教程,很多是 2025 年录的 v1,请求头叫 `X-PAYMENT`、响应头叫 `X-PAYMENT-RESPONSE`,网络名写 `base-sepolia`。v2 把头改成了上面三个,网络改成 CAIP-2。照旧视频抄代码去对接新版 SDK,会一直拿到 402,还看不出哪里错。

## 第 0 步:装包,起假结算服务和收费接口

在 `~/agent-zero-lab` 里装 x402 SDK 和它需要的几个部件:

```bash
cd ~/agent-zero-lab
uv add "x402[httpx,fastapi,evm]" httpx
mkdir -p part10/pay && touch part10/pay/__init__.py
```

方括号里是可选部件:`httpx` 是客户端、`fastapi` 是服务端中间件、`evm` 是以太坊系链的付款实现。FastAPI 是 Python 里最流行的 Web 框架之一,今天只用到它最基本的一点:`@app.get("/路径")` 把一个函数挂成接口,相当于 Express 的 `app.get`。

先写假的 facilitator。注意它**会真的验证签名**:用以太坊的 EIP-712(一种「把结构化数据按固定规则编码后再签名」的标准)重新算一遍,从签名里恢复出签名人地址,和付款人对不对得上。只是它不连链,`settle` 只是在内存里记一笔账、返回一个假交易号。

```python
# agent-zero-lab/part10/pay/mock_facilitator.py
"""本地假 facilitator:真的验 EIP-712 签名,但不连任何链。settle 只是记一笔账、返回假交易号。"""
import threading
import time

import uvicorn
from eth_account import Account
from eth_account.messages import encode_typed_data
from fastapi import FastAPI

PORT = 9112
app = FastAPI()
used_nonces: set[str] = set()  # 链上合约会记住用过的 nonce,这里用集合模拟
settle_lock = threading.Lock()  # 检查 nonce 和记下 nonce 必须是不可分割的一步
ledger: list[dict] = []  # 假账本,演示完能看到「结了几笔」

TYPES = {
    "EIP712Domain": [
        {"name": "name", "type": "string"}, {"name": "version", "type": "string"},
        {"name": "chainId", "type": "uint256"}, {"name": "verifyingContract", "type": "address"},
    ],
    "TransferWithAuthorization": [
        {"name": "from", "type": "address"}, {"name": "to", "type": "address"},
        {"name": "value", "type": "uint256"}, {"name": "validAfter", "type": "uint256"},
        {"name": "validBefore", "type": "uint256"}, {"name": "nonce", "type": "bytes32"},
    ],
}


def check(payload: dict, req: dict) -> tuple[bool, str, str]:
    """返回 (是否有效, 原因, 付款人)。"""
    auth = payload["payload"]["authorization"]
    payer = auth["from"]
    if payload["accepted"]["payTo"].lower() != req["payTo"].lower() or auth["to"].lower() != req["payTo"].lower():
        return False, "recipient_mismatch", payer
    if int(auth["value"]) != int(req["amount"]):
        return False, "amount_mismatch", payer
    if payload["accepted"]["network"] != req["network"] or payload["accepted"]["asset"].lower() != req["asset"].lower():
        return False, "network_or_asset_mismatch", payer
    if int(auth["validBefore"]) < time.time():
        return False, "authorization_expired", payer
    if auth["nonce"] in used_nonces:
        return False, "nonce_already_used", payer
    message = {
        "from": auth["from"], "to": auth["to"], "value": int(auth["value"]),
        "validAfter": int(auth["validAfter"]), "validBefore": int(auth["validBefore"]),
        "nonce": bytes.fromhex(auth["nonce"].removeprefix("0x")),
    }
    domain = {
        "name": req["extra"]["name"], "version": req["extra"]["version"],
        "chainId": int(req["network"].split(":")[1]), "verifyingContract": req["asset"],
    }
    signable = encode_typed_data(full_message={
        "types": TYPES, "primaryType": "TransferWithAuthorization", "domain": domain, "message": message,
    })
    signer = Account.recover_message(signable, signature=payload["payload"]["signature"])
    if signer.lower() != auth["from"].lower():
        return False, "invalid_signature", payer
    return True, "", payer


@app.get("/supported")
def supported() -> dict:
    return {"kinds": [{"x402Version": 2, "scheme": "exact", "network": "eip155:84532"}], "extensions": [], "signers": {}}


@app.post("/verify")
def verify(body: dict) -> dict:
    ok, reason, payer = check(body["paymentPayload"], body["paymentRequirements"])
    print(f"[facilitator] verify -> {'ok' if ok else reason}", flush=True)
    return {"isValid": ok, "invalidReason": reason or None, "payer": payer}


@app.post("/settle")
def settle(body: dict) -> dict:
    payload, req = body["paymentPayload"], body["paymentRequirements"]
    with settle_lock:
        ok, reason, payer = check(payload, req)
        if not ok:
            print(f"[facilitator] settle 拒绝 -> {reason}", flush=True)
            return {"success": False, "errorReason": reason, "payer": payer, "transaction": "", "network": req["network"]}
        nonce = payload["payload"]["authorization"]["nonce"]
        used_nonces.add(nonce)
        tx = "0xmock" + nonce[2:14]
        ledger.append({"payer": payer, "to": req["payTo"], "amount": req["amount"], "tx": tx})
    print(f"[facilitator] settle 成功 {req['amount']} 最小单位 -> {tx}(假的,没上链)", flush=True)
    return {"success": True, "payer": payer, "transaction": tx, "network": req["network"], "amount": req["amount"]}


@app.get("/_ledger")
def get_ledger() -> list[dict]:
    return ledger


if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=PORT, log_level="warning")
```

<div class="line-notes">

- `used_nonces: set[str] = set()` 用过的支票编号。真实的链上合约会永久记住它们,这里用一个集合模拟。`set` 相当于 JS 的 `Set`。
- `settle_lock = threading.Lock()` 一把锁。先留着,为什么需要它,练习 3 会用一个真实的 bug 讲。
- `ledger: list[dict] = []` 假账本,每结算成功一笔就追加一条,演示完能数出「结了几笔」。
- `TYPES = {` EIP-712 要求先声明数据结构:`EIP712Domain` 是「这个签名属于哪个合约」,`TransferWithAuthorization` 是支票上写的六个字段(付款人、收款人、金额、起止时间、编号)。
- `def check(payload: dict, req: dict) -> tuple[bool, str, str]:` 校验函数,返回「是否有效、原因、付款人」。`verify` 和 `settle` 共用它。
- `auth = payload["payload"]["authorization"]` 支票内容在 `payload.payload.authorization` 里(外层 `payload` 是整个付款对象,里层才是 x402 的 payload,名字重复了,这是协议的写法)。
- `if payload["accepted"]["payTo"].lower() != req["payTo"].lower() or auth["to"].lower() != req["payTo"].lower():` 收款人必须和服务端要价里的一致,且客户端自己抄的 `accepted` 也不能改。地址大小写不敏感,所以先 `lower()`。
- `if int(auth["value"]) != int(req["amount"]):` `exact` 要求金额**正好相等**。链上的数字都是字符串,先转 `int` 再比。
- `if int(auth["validBefore"]) < time.time():` 过期的支票作废。代入我跑的一次,`validBefore` 是 `1793066741`,比当前时间晚几分钟。
- `if auth["nonce"] in used_nonces:` 支票编号用过了就不行,这是防重放的核心。
- `message = {` 把支票字段整理成 EIP-712 要的格式,`nonce` 要转成 32 字节。
- `domain = {` 域信息:合约名、版本、链编号、合约地址。这些从服务端要价的 `extra` 和 `asset` 里来,所以服务端改了要价,签名就对不上。
- `signable = encode_typed_data(full_message={` 把结构、域、内容拼成「待签名的字节」。
- `signer = Account.recover_message(` 从签名反推签名人的地址。这步是整件事的密码学核心:不需要知道私钥,只靠数学就能判断章是谁盖的。
- `if signer.lower() != auth["from"].lower():` 反推出来的地址必须等于支票上写的付款人,否则就是别人冒名。
- `@app.get("/supported")` 第一个接口:告诉收费方「我支持哪种付款方式」。收费方启动时会来问一次。
- `@app.post("/verify")` 第二个:只检查,不记账。
- `@app.post("/settle")` 第三个:真正兑现。
- `with settle_lock:` 进入锁。同一时刻只有一个请求能往下走。
- `used_nonces.add(nonce)` 记下这张支票已经用了。
- `tx = "0xmock" + nonce[2:14]` 造一个假交易号。故意以 `0xmock` 开头,谁看了都知道是假的。
- `ledger.append(` 记一笔账。
- `uvicorn.run(` 在 9112 端口启动。

</div>

再写收费接口,用官方 SDK 的 FastAPI 中间件收费:

```python
# agent-zero-lab/part10/pay/paid_api.py
"""一个按次收费的企业信用查询接口,用官方 x402 SDK 的 FastAPI 中间件收费,结算交给本地假 facilitator。"""
import uvicorn
from fastapi import FastAPI
from x402 import x402ResourceServer
from x402.http import FacilitatorConfig, HTTPFacilitatorClient, PaymentOption
from x402.http.middleware.fastapi import payment_middleware
from x402.http.types import RouteConfig
from x402.mechanisms.evm.exact import ExactEvmServerScheme

PORT = 9111
NETWORK = "eip155:84532"  # Base Sepolia 测试网的编号。这里只是个名字,没有任何链被连接
PAY_TO = "0x000000000000000000000000000000000000dEaD"  # 收款地址:公开的黑洞地址,演示用,没人拥有它

facilitator = HTTPFacilitatorClient(FacilitatorConfig(url="http://127.0.0.1:9112"))
server = x402ResourceServer(facilitator)
server.register("eip155:*", ExactEvmServerScheme())  # pyright: ignore[reportArgumentType]

routes = {
    "GET /api/credit-report/*": RouteConfig(
        accepts=[PaymentOption(scheme="exact", network=NETWORK, pay_to=PAY_TO, price="$0.02")],
        description="企业信用查询,每次 $0.02",
    ),
    "GET /api/premium-report/*": RouteConfig(
        accepts=[PaymentOption(scheme="exact", network=NETWORK, pay_to=PAY_TO, price="$5")],
        description="深度尽调报告,每次 $5",
    ),
}

app = FastAPI()
app.middleware("http")(payment_middleware(routes, server))


@app.get("/api/credit-report/{company}")
def credit_report(company: str) -> dict:
    return {"company": company, "exists": True, "risk": "low", "registered": "2019-03-01"}


@app.get("/api/premium-report/{company}")
def premium_report(company: str) -> dict:
    return {"company": company, "pages": 38, "summary": "(演示数据)"}


@app.get("/api/free/ping")
def ping() -> dict:
    return {"pong": True}


if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=PORT, log_level="warning")
```

<div class="line-notes">

- `PORT = 9111` 收费接口的端口。
- `NETWORK = "eip155:84532"` 声明收哪条链的钱。这是 Base Sepolia 测试网的编号,这里只是个名字,没有任何网络被连接。
- `PAY_TO = "0x000000000000000000000000000000000000dEaD"` 收款地址:一个公开的「黑洞地址」,往里转的钱谁也取不出来。演示用,保证绝不会和任何真实账户重合。
- `facilitator = HTTPFacilitatorClient(` 告诉 SDK 结算代理在哪:我们本地的 9112。真实使用时这里是官方或第三方的 facilitator 地址。
- `server = x402ResourceServer(facilitator)` 收费服务器对象,所有收费逻辑的总管。
- `server.register("eip155:*"` 注册「以太坊系的所有链」用 `exact` 方式收。末尾的 `pyright: ignore` 注释是因为 SDK 的类型声明和它自己的实现对不上,类型检查器会报红线,不影响运行。
- `routes = {` 哪些路径要收费、收多少。键是「方法 + 路径模式」。
- `"GET /api/credit-report/*": RouteConfig(` 企业信用查询,`*` 匹配后面的公司名。
- `accepts=[PaymentOption(scheme="exact"` 接受哪些付款方式:`exact` 方式、测试网、收款地址是上面那个。同一行的 `price="$0.02"` 价格写美元,SDK 会按 USDC 的 6 位小数换算成 `20000`。
- `"GET /api/premium-report/*": RouteConfig(` 第二个收费路径,5 美元的深度报告,第 4 步用它测试单笔上限。
- `app.middleware("http")(payment_middleware(routes, server))` 把收费逻辑挂成中间件:每个请求先过它,路径没在 `routes` 里的直接放行,在的话检查有没有付款头。
- `@app.get("/api/credit-report/{company}")` 真正的接口,只有中间件放行才会执行到这里。
- `@app.get("/api/free/ping")` 一个不收费的路径,对照用。

</div>

开三个窗口。**窗口 A**,先起假结算(收费接口启动时会去问它支持什么,所以它要先起来):

```bash
uv run python -m part10.pay.mock_facilitator
```

**窗口 B**,起收费接口:

```bash
uv run python -m part10.pay.paid_api
```

**窗口 C** 用来跑下面所有客户端脚本。用 `curl` 先验证两个路径:

```bash
curl -s -o /dev/null -w "%{http_code}\n" localhost:9111/api/free/ping
curl -s -o /dev/null -w "%{http_code}\n" localhost:9111/api/credit-report/acme
```

前一个应该是 `200`,后一个是 `402`。

## 第 1 步:看一眼真实的 402

不用 SDK,只用 `httpx` 和标准库,看 402 响应里到底有什么:

```python
# agent-zero-lab/part10/pay/look_402.py
"""不用 x402 SDK,只用 httpx 和标准库:看 402 响应到底长什么样。"""
import base64
import json

import httpx

r = httpx.get("http://127.0.0.1:9111/api/credit-report/acme")
print("状态码:", r.status_code)
print("响应体:", r.text)
print("响应头里有 payment-required:", "payment-required" in r.headers)

required = json.loads(base64.b64decode(r.headers["payment-required"]))
print(json.dumps(required, ensure_ascii=False, indent=2))

accept = required["accepts"][0]
dollars = int(accept["amount"]) / 10**6  # USDC 小数位是 6
print(f"要价:{accept['amount']} 最小单位 = {dollars} 美元,付给 {accept['payTo']},网络 {accept['network']}")
```

<div class="line-notes">

- `r = httpx.get("http://127.0.0.1:9111/api/credit-report/acme")` 不带任何付款信息的请求,等着被 402。
- `print("响应体:", r.text)` 响应体是 `{}`,几乎是空的。**要价不在响应体里,在响应头里。**
- `"payment-required" in r.headers` 头名字不区分大小写,`httpx` 统一给你小写。
- `required = json.loads(base64.b64decode(r.headers["payment-required"]))` 头的内容是 base64 编码的 JSON:先 `b64decode` 还原成字节,再 `json.loads` 解析成字典。前端等价于 `JSON.parse(atob(...))`。
- `accept = required["accepts"][0]` 可接受的付款方式数组,我们只配了一项。
- `dollars = int(accept["amount"]) / 10**6` USDC 有 6 位小数。`20000 / 1000000 = 0.02`,所以是两分钱。`10**6` 是 Python 的幂运算,等于 JS 的 `10 ** 6`。

</div>

**窗口 C** 跑:

```bash
uv run python -m part10.pay.look_402
```

```text
状态码: 402
响应体: {}
响应头里有 payment-required: True
{
  "x402Version": 2,
  "error": "Payment required",
  "resource": {
    "url": "http://127.0.0.1:9111/api/credit-report/acme",
    "description": "企业信用查询,每次 $0.02",
    "mimeType": ""
  },
  "accepts": [
    {
      "scheme": "exact",
      "network": "eip155:84532",
      "asset": "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
      "amount": "20000",
      "payTo": "0x000000000000000000000000000000000000dEaD",
      "maxTimeoutSeconds": 300,
      "extra": {
        "name": "USDC",
        "version": "2"
      }
    }
  ]
}
要价:20000 最小单位 = 0.02 美元,付给 0x000000000000000000000000000000000000dEaD,网络 eip155:84532
```

逐项读一下。`resource.url` 是这个要价是给哪个地址的,后面练习 2 会用它防「拿别的地址的要价来骗签名」。`accepts[0]` 里,`scheme: exact` 是固定金额,`network` 是测试网,`asset` 是 USDC 在这条测试网上的合约地址,`amount: "20000"` 是两分钱,`payTo` 是我们设的黑洞地址,`maxTimeoutSeconds: 300` 是签名 5 分钟内有效,`extra` 里的 `name` 和 `version` 是签 EIP-712 时要用的合约信息。注意 `amount` 是**字符串**:链上的数字常常大到超过 JS 的安全整数范围(`2**53`),协议统一用字符串传,前端的同学要小心别直接 `Number()`。

## 第 2 步:官方客户端自动付款

现在让官方的 httpx 客户端遇到 402 自动付款:

```python
# agent-zero-lab/part10/pay/pay_client.py
"""用官方 x402 SDK 的 httpx 客户端自动付款。钱包是这次运行现生成的测试密钥,不要往里打钱。"""
import asyncio
import base64
import json

from eth_account import Account
from x402 import x402Client
from x402.http.clients import x402HttpxClient
from x402.mechanisms.evm.exact import ExactEvmScheme

BASE = "http://127.0.0.1:9111"


async def main() -> None:
    wallet = Account.create()  # 一次性测试钱包,私钥只在内存里,不打印、不保存
    print("测试钱包地址:", wallet.address)

    client = x402Client()
    client.register("eip155:*", ExactEvmScheme(signer=wallet))

    async with x402HttpxClient(client) as http:
        r = await http.get(f"{BASE}/api/credit-report/acme")
        print("状态码:", r.status_code)
        print("内容:", r.json())
        receipt = json.loads(base64.b64decode(r.headers["payment-response"]))
        print("回执:", receipt)


asyncio.run(main())
```

<div class="line-notes">

- `wallet = Account.create()` 现场生成一个钱包(一对密钥)。**一次性测试钱包,私钥只在内存里,不打印、不保存。**每次运行地址都不一样。
- `print("测试钱包地址:", wallet.address)` 只打印地址(公开的),绝不打印私钥。
- `client = x402Client()` x402 的客户端对象:记住「遇到哪种链用哪个签名器」。
- `client.register("eip155:*", ExactEvmScheme(signer=wallet))` 注册:遇到以太坊系的链、`exact` 方式,就用这个钱包签名。
- `async with x402HttpxClient(client) as http:` 一个特殊的 httpx 客户端:正常发请求,收到 402 就自动签名、带上 `PAYMENT-SIGNATURE` 头重发,整个过程对调用者透明。
- `r = await http.get(f"{BASE}/api/credit-report/acme")` 调用者眼里只有一次 `get`,底下其实是两次请求(一次 402,一次带签名)。
- `receipt = json.loads(base64.b64decode(r.headers["payment-response"]))` 结算回执,头里同样是 base64 的 JSON。

</div>

**窗口 C** 跑:

```bash
uv run python -m part10.pay.pay_client
```

```text
测试钱包地址: 0xcc72816CB6aE6c757EEC4f15b6D603128B4E037c
状态码: 200
内容: {'company': 'acme', 'exists': True, 'risk': 'low', 'registered': '2019-03-01'}
回执: {'success': True, 'payer': '0xcc72816CB6aE6c757EEC4f15b6D603128B4E037c', 'transaction': '0xmock540a55e1159d', 'network': 'eip155:84532', 'amount': '20000'}
```

一次调用,拿到了内容和回执。回执里 `transaction` 是以 `0xmock` 开头的假交易号(真实结算会是链上的交易哈希),`amount` 是 `20000`,`payer` 是刚才生成的测试钱包地址。回到**窗口 A**(假结算)的终端,你会看到它打印了:

```text
[facilitator] verify -> ok
[facilitator] settle 成功 20000 最小单位 -> 0xmock...(假的,没上链)
```

先验再结,和第 0 步的时序图一致。

## 第 3 步:偷下付款头,重放、改金额、改收款人

付款头在网络上走,中间的人(代理、日志、被攻破的服务)都有可能看到它。如果有人把头偷下来,能做什么?下面自己扮演攻击者试一试。为了能拿到头,这个脚本不用自动付款的客户端,而是手动走协议的每一步:

```python
# agent-zero-lab/part10/pay/replay_demo.py
"""付一次钱,把 PAYMENT-SIGNATURE 偷下来,看重放、改金额、改收款人分别会怎样。"""
import asyncio
import base64
import json

import httpx
from eth_account import Account
from x402 import x402Client
from x402.http import decode_payment_required_header, encode_payment_signature_header
from x402.mechanisms.evm.exact import ExactEvmScheme

URL = "http://127.0.0.1:9111/api/credit-report/acme"
stolen: dict[str, str] = {}


def forge(mutate) -> str:
    payload = json.loads(base64.b64decode(stolen["sig"]))
    mutate(payload)
    return base64.b64encode(json.dumps(payload).encode()).decode()


def retry(label: str, header: str) -> None:
    r = httpx.get(URL, headers={"PAYMENT-SIGNATURE": header})
    why = json.loads(base64.b64decode(r.headers["payment-required"])).get("error") if "payment-required" in r.headers else ""
    print(f"{label}: {r.status_code} {why}")


async def main() -> None:
    client = x402Client()
    client.register("eip155:*", ExactEvmScheme(signer=Account.create()))
    first = httpx.get(URL)  # 先吃一个 402,拿到要价
    required = decode_payment_required_header(first.headers["payment-required"])
    payment = await client.create_payment_payload(required)  # 钱包签名
    stolen["sig"] = encode_payment_signature_header(payment)  # 这就是线上传的那个头
    r = httpx.get(URL, headers={"PAYMENT-SIGNATURE": stolen["sig"]})
    print("正常付款:", r.status_code)
    payload = json.loads(base64.b64decode(stolen["sig"]))
    print("签名头里的授权:", json.dumps(payload["payload"]["authorization"], indent=1)[:260], "...")

    retry("1. 原样重放同一个头", stolen["sig"])

    def cheaper(p: dict) -> None:
        p["payload"]["authorization"]["value"] = "1"
        p["accepted"]["amount"] = "1"
    retry("2. 把金额改成 1", forge(cheaper))

    def other_payee(p: dict) -> None:
        p["payload"]["authorization"]["to"] = "0x1111111111111111111111111111111111111111"
        p["accepted"]["payTo"] = "0x1111111111111111111111111111111111111111"
    retry("3. 把收款人改成别人", forge(other_payee))

    retry("4. 随便编个头", base64.b64encode(b'{"x402Version":2}').decode())


asyncio.run(main())
```

<div class="line-notes">

- `stolen: dict[str, str] = {}` 用来存「偷到的头」。
- `def forge(mutate) -> str:` 伪造函数:把偷到的头解码、让传入的函数改一改、再编码回去。
- `payload = json.loads(base64.b64decode(stolen["sig"]))` 头的格式和 `PAYMENT-REQUIRED` 一样,都是 base64 的 JSON,所以能解开、能改。**base64 是编码,不是加密**,任何人都能还原。
- `mutate(payload)` 调用传入的修改动作。
- `def retry(label: str, header: str) -> None:` 带着(可能被改过的)头重新请求,打印状态码和服务端给的原因。
- `first = httpx.get(URL)  # 先吃一个 402,拿到要价` 第一次请求,不带头。
- `required = decode_payment_required_header(` SDK 提供的解码函数,把头变成对象。和 `look_402.py` 里手写的 `b64decode` 是一回事。
- `payment = await client.create_payment_payload(required)  # 钱包签名` 钱包按要价签一张支票。这一步在自动付款客户端里是藏起来的。
- `stolen["sig"] = encode_payment_signature_header(payment)` 编码成线上传的那个头。**假设这是攻击者从网络上偷到的。**
- `r = httpx.get(URL, headers={"PAYMENT-SIGNATURE": stolen["sig"]})` 先正常用一次,拿到 200。
- `retry("1. 原样重放同一个头", stolen["sig"])` 攻击 1:原封不动再发一次。
- `p["payload"]["authorization"]["value"] = "1"` 攻击 2:把支票金额改成 1 个最小单位(0.000001 美元),`accepted.amount` 也改成 1 好蒙混过关。
- `p["payload"]["authorization"]["to"] = "0x1111111111111111111111111111111111111111"` 攻击 3:把收款人改成别的地址,试图把钱引到自己的账户。
- `retry("4. 随便编个头"` 攻击 4:编一个格式正确但没有签名的头。

</div>

**窗口 C** 跑:

```bash
uv run python -m part10.pay.replay_demo
```

```text
正常付款: 200
签名头里的授权: {
 "from": "0x0d28fe290Dd1457a8eAdA21Be33037b2134F1235",
 "to": "0x000000000000000000000000000000000000dEaD",
 "value": "20000",
 "validAfter": "0",
 "validBefore": "1793067821",
 "nonce": "0xdd354e50a28772239b3c36ee51b08f76379dd1bf5b144f2e78377384346b6729"
} ...
1. 原样重放同一个头: 402 nonce_already_used
2. 把金额改成 1: 402 No matching payment requirements
3. 把收款人改成别人: 402 No matching payment requirements
4. 随便编个头: 402 Payment required
```

四种攻击全部返回 402,但拒绝的原因不一样,值得分开看。

**重放**(第 1 条)得到的是 `nonce_already_used`:这是假结算服务查到支票编号已经用过。真实的链上合约也是这么拦的,编号用过一次就永久作废。**改金额、改收款人**(第 2、3 条)得到的是 `No matching payment requirements`:这是收费接口的 SDK 在自己这一层就拦下了,因为客户端抄在 `accepted` 里的要价,和服务端当时开出的要价对不上,根本没走到结算。就算绕过这一层,签名也是对着原来的金额和收款人签的,改了任何一个字段,`Account.recover_message` 恢复出来的就是另一个地址,会得到 `invalid_signature`。**乱编**(第 4 条)是格式有了但没有有效内容,当作没付款。

这里的重点是:**签名绑定的是「这张支票的全部字段」**,所以改一个字就废。但它不绑定「这张支票是用来买哪个页面的」:被签名覆盖的字段里没有资源地址。也就是说,同一张支票如果还没被兑现,理论上可以拿去买**别的、同价的**东西,是否安全取决于服务端把这件事想得多周全。这类问题就是下面那篇论文在讲的。

### 第 4 步:SDK 自带的单笔上限

官方客户端有一道你可能没注意的保险:默认单笔上限 1 美元,超过它客户端自己就不签名。

```python
# agent-zero-lab/part10/pay/spend_cap_demo.py
"""SDK 客户端自带的单笔上限:默认 $1,超了它自己不签名。"""
import asyncio

from eth_account import Account
from x402 import x402Client
from x402.http.clients import x402HttpxClient
from x402.mechanisms.evm.exact import ExactEvmScheme

BASE = "http://127.0.0.1:9111"


async def try_get(label: str, client: x402Client, path: str) -> None:
    async with x402HttpxClient(client) as http:
        try:
            r = await http.get(BASE + path)
            print(f"{label}: {r.status_code}")
        except Exception as e:  # 演示用,看看到底抛的是什么
            print(f"{label}: {type(e).__name__}: {e}")


async def main() -> None:
    wallet = Account.create()
    default = x402Client()
    default.register("eip155:*", ExactEvmScheme(signer=wallet))
    await try_get("默认上限,查 $5 的报告", default, "/api/premium-report/acme")

    loose = x402Client()
    loose.register("eip155:*", ExactEvmScheme(signer=wallet))
    loose.set_spend_controls({"max_amount_per_payment": "$10"})
    await try_get("上限改成 $10,查 $5 的报告", loose, "/api/premium-report/acme")


asyncio.run(main())
```

<div class="line-notes">

- `async def try_get(label: str, client: x402Client, path: str) -> None:` 封装「用这个客户端查一个路径,打印结果或异常」。
- `except Exception as e:  # 演示用,看看到底抛的是什么` 演示脚本里宽泛地捕获异常,是为了把异常类型和原文打出来给你看。生产代码里别这样吞异常。
- `default = x402Client()` 第一个客户端什么都不设,用默认的上限。
- `await try_get("默认上限,查 $5 的报告", default, "/api/premium-report/acme")` 查那个 5 美元的接口。
- `loose.set_spend_controls({"max_amount_per_payment": "$10"})` 第二个客户端把单笔上限放宽到 10 美元,再查同一个接口。

</div>

**窗口 C** 跑:

```bash
uv run python -m part10.pay.spend_cap_demo
```

```text
默认上限,查 $5 的报告: PaymentError: Failed to handle payment: All payment requirements were rejected by spend_controls.max_amount_per_payment ($1, including USDC). Raise max_amount_per_payment, set it to False to disable, set allowed_assets[].max_amount_per_payment for a per-asset atomic cap, or set spend_controls: False to disable all spend controls.
上限改成 $10,查 $5 的报告: 200
```

默认情况下 5 美元的要价被客户端自己拒绝了,错误信息写得很清楚:被 `spend_controls.max_amount_per_payment`($1)拦下,并告诉你怎么放宽。放宽到 10 美元之后就付成功了(200)。这条规则在 SDK 源码里叫 `DEFAULT_MAX_AMOUNT_PER_PAYMENT`,值是 `"$1"`。

别把它当成「已经有授权框了」。它只看**单笔金额**,不看你一天花了多少、收款人是不是你认识的、买的东西是不是用户想要的。明天讲授权时,我们会写一个真正的授权框,并把它接到 SDK 的钩子上。

## 它挡不住什么

x402 的设计把「付款」和「调接口」合成了一个动作,这是它对 Agent 友好的地方,但合成动作也带来新的攻击面。2026 年 5 月 12 日有一篇 arXiv 论文《Five Attacks on x402 Agentic Payment Protocol》(编号 2605.11781)讨论了这件事。我只读了摘要和一篇二手综述,没有读全文。摘要里说得明白:x402 把同步的 HTTP 授权和异步的区块链结算拼在一起,引入了普通 Web 和普通链上支付都没有的跨层攻击面;作者给出五种具体攻击,涉及授权、绑定、重放保护和 Web 层处理,在本地链、Base Sepolia 和线上接口上复现了,还审计了三个开源 SDK,结论是五种攻击都「practical」,会造成「没付钱却拿到服务」或者「付了钱却没拿到服务」两种结果。综述里提到的两个例子我觉得好懂:一是服务端在付款还没最终确认时就放出内容,之后链上回滚,等于白送(revert-grant);二是有人抢先把你的付款头提交上链,你被扣了钱,服务端的正规结算反而失败,你拿不到内容(settlement preemption)。其余三种我没有读到细节,不在这里转述。

对照我们今天做的:第 3 步的重放和篡改是论文里「绑定」和「重放保护」那一类的最简版本;结算先于放行(假结算返回成功才放内容)是对付 revert-grant 的做法,但真实链上还要等足够的确认数,我们的假结算没有这个问题;抢跑那一类需要真的链,本地没法复现,我没实跑。

再说一个和国内有关的现实。x402 的结算走稳定币:收款方要有链上地址,付款方的钱包里要有 USDC 这类资产。2026 年 2 月 6 日人民银行等八部门发布了《关于进一步防范和处置虚拟货币等相关风险的通知》(银发〔2026〕42 号,[csrc.gov.cn 上有转载全文](https://www.csrc.gov.cn/c100028/c7614318/content.shtml)),延续了 2021 年的思路,境内的虚拟货币兑换等业务属于非法金融活动。所以国内团队可以学 x402 的设计,但别把「主网稳定币结算」当成可上线的方案,具体能做什么要问法务。我没有把通知逐条核对,以全文为准。

## 动手练习

**练习 1:手写一个 402 接口。** 不用 `x402` 的服务端 SDK,只用 Starlette 和 `httpx`:自己返回 402 和 `PAYMENT-REQUIRED` 头;收到 `PAYMENT-SIGNATURE` 后自己调假结算的 `/settle`,**成功了才放内容**,失败了再回 402。然后用官方的客户端去付你写的这个接口,验证两边能互通。(前置:窗口 A 的假结算还开着。)

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part10/pay/ex617_hand402.py
"""练习 1:不用 x402 的服务端 SDK,自己手写一个 402 接口(只用 Starlette + httpx),用官方客户端去付款。"""
import asyncio
import base64
import json

import httpx
import uvicorn
from eth_account import Account
from starlette.applications import Starlette
from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.routing import Route
from x402 import x402Client
from x402.http.clients import x402HttpxClient
from x402.mechanisms.evm.exact import ExactEvmScheme

PORT = 9113
FACILITATOR = "http://127.0.0.1:9112"
ACCEPT = {
    "scheme": "exact", "network": "eip155:84532",
    "asset": "0x036CbD53842c5426634e7929541eC2318f3dCF7e", "amount": "20000",
    "payTo": "0x000000000000000000000000000000000000dEaD", "maxTimeoutSeconds": 300,
    "extra": {"name": "USDC", "version": "2"},
}


def b64(obj: dict) -> str:
    return base64.b64encode(json.dumps(obj).encode()).decode()


def need_payment(request: Request, error: str) -> JSONResponse:
    required = {"x402Version": 2, "error": error, "resource": {"url": str(request.url), "description": "手写 402", "mimeType": ""}, "accepts": [ACCEPT]}
    return JSONResponse({}, status_code=402, headers={"PAYMENT-REQUIRED": b64(required)})


async def report(request: Request) -> JSONResponse:
    header = request.headers.get("payment-signature")
    if header is None:
        return need_payment(request, "Payment required")
    payload = json.loads(base64.b64decode(header))
    body = {"x402Version": 2, "paymentPayload": payload, "paymentRequirements": ACCEPT}
    async with httpx.AsyncClient() as http:
        settled = (await http.post(f"{FACILITATOR}/settle", json=body)).json()  # 先结算……
    if not settled["success"]:
        return need_payment(request, settled["errorReason"])
    return JSONResponse(  # ……成功了才放内容
        {"company": request.path_params["company"], "risk": "low"},
        headers={"PAYMENT-RESPONSE": b64(settled)},
    )


app = Starlette(routes=[Route("/api/credit-report/{company}", report)])


async def main() -> None:
    server = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=PORT, log_level="warning"))
    task = asyncio.create_task(server.serve())
    await asyncio.sleep(1)
    client = x402Client()
    client.register("eip155:*", ExactEvmScheme(signer=Account.create()))
    async with x402HttpxClient(client) as http:
        r = await http.get(f"http://127.0.0.1:{PORT}/api/credit-report/acme")
    print("官方客户端 -> 手写服务端:", r.status_code, r.json())
    print("回执:", json.loads(base64.b64decode(r.headers["payment-response"]))["transaction"])
    server.should_exit = True
    await task


asyncio.run(main())
```

<div class="line-notes">

- `PORT = 9113` 手写服务用另一个端口,和 SDK 版的 9111 并存。
- `ACCEPT = {` 要价写成一个固定的字典,字段和第 1 步看到的一模一样:`scheme`、`network`、`asset`、`amount`、`payTo`、`maxTimeoutSeconds`、`extra`。
- `def b64(obj: dict) -> str:` 把字典转成 base64 字符串。`json.dumps(obj).encode()` 先变成字节,`b64encode` 编码,最后 `.decode()` 变回字符串才能放进 HTTP 头。
- `def need_payment(request: Request, error: str) -> JSONResponse:` 统一生成 402 响应的函数。
- `required = {"x402Version": 2, "error": error,` `error` 字段写原因:第一次是「Payment required」,支付失败时写结算返回的原因。
- `headers={"PAYMENT-REQUIRED": b64(required)})` 要价放头里,响应体留空 `{}`。
- `header = request.headers.get("payment-signature")` 请求里有没有付款头。
- `if header is None:` 没有,直接 402 并附上要价。
- `payload = json.loads(base64.b64decode(header))` 有的话,还原成字典。
- `body = {"x402Version": 2, "paymentPayload": payload, "paymentRequirements": ACCEPT}` 按 facilitator 的接口格式打包:客户端的付款内容和**服务端自己保存的要价**一起发过去。注意要价用的是服务端的 `ACCEPT`,不是客户端抄回来的那份,这样客户端改不了价格。
- `settled = (await http.post(f"{FACILITATOR}/settle", json=body)).json()  # 先结算……` 先结算。这里省掉了单独的 `/verify` 调用,因为 `/settle` 内部也会验证。
- `if not settled["success"]:` 结算失败,返回 402 并把原因写进新的要价里。
- `return JSONResponse(  # ……成功了才放内容` 只有走到这里才返回内容,并把结算回执放进 `PAYMENT-RESPONSE` 头。
- `server = uvicorn.Server(uvicorn.Config(app,` 在同一个脚本里启动服务,不用另开窗口。
- `task = asyncio.create_task(server.serve())` 把服务放到后台任务里跑,主流程继续往下走。
- `await asyncio.sleep(1)` 等服务起来。
- `async with x402HttpxClient(client) as http:` 用官方客户端访问我们手写的接口,验证协议互通。
- `server.should_exit = True` 用完通知服务退出,`await task` 等它收干净。

</div>

```text
官方客户端 -> 手写服务端: 200 {'company': 'acme', 'risk': 'low'}
回执: 0xmockf09bd0386730
```

(`uv run python -m part10.pay.ex617_hand402` 的真实输出,交易号每次不同。)两边互通说明 x402 的接口就是这几个头加 JSON,没有什么魔法。手写这一遍也让你看清了 SDK 中间件到底替你做了什么:判断路径要不要收费、生成要价、解析付款头、调结算、成功才放行。

</details>

**练习 2:签名之前,先验要价。** 服务端发来的 402 要价是不可信的:它可能把收款人换了、把金额写大、让你付主网的真钱、或者拿别的地址的要价来骗你签名。写 `check_requirements(required, expected_payee, max_usd, url) -> (bool, str)`:协议版本必须是 2,`resource.url` 必须等于你请求的地址,只接受白名单里的网络和币种,收款人必须等于预期的,金额不能超过上限。用七种情况测试。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part10/pay/ex617_check402.py
"""练习 2:收到 402 以后、签名之前,客户端自己先验一遍要价。服务端发来的东西不可信。"""
from typing import Any

USDC_DECIMALS = 6
ALLOWED_NETWORKS = {"eip155:84532"}  # 只认测试网
ALLOWED_ASSETS = {"0x036cbd53842c5426634e7929541ec2318f3dcf7e"}  # 全小写比较


def check_requirements(required: dict[str, Any], expected_payee: str, max_usd: float, url: str) -> tuple[bool, str]:
    if required.get("x402Version") != 2:
        return False, f"不认识的协议版本 {required.get('x402Version')!r}"
    resource_url = required.get("resource", {}).get("url", "")
    if resource_url != url:
        return False, f"要价是给 {resource_url} 的,我请求的是 {url}"
    for accept in required.get("accepts", []):
        if accept.get("scheme") != "exact" or accept.get("network") not in ALLOWED_NETWORKS:
            continue
        if accept.get("asset", "").lower() not in ALLOWED_ASSETS:
            continue
        if accept.get("payTo", "").lower() != expected_payee.lower():
            return False, f"收款人 {accept.get('payTo')} 不是预期的 {expected_payee}"
        usd = int(accept["amount"]) / 10**USDC_DECIMALS
        if usd > max_usd:
            return False, f"要价 ${usd} 超过上限 ${max_usd}"
        return True, f"可以付 ${usd}"
    return False, "没有一个我愿意付的选项(网络或币种不在白名单)"


PAYEE = "0x000000000000000000000000000000000000dEaD"
URL = "http://127.0.0.1:9111/api/credit-report/acme"
GOOD_ACCEPT = {"scheme": "exact", "network": "eip155:84532", "asset": "0x036CbD53842c5426634e7929541eC2318f3dCF7e", "amount": "20000", "payTo": PAYEE}


def make(**changes: Any) -> dict[str, Any]:
    accept = {**GOOD_ACCEPT, **{k: v for k, v in changes.items() if k in GOOD_ACCEPT}}
    return {"x402Version": 2, "resource": {"url": changes.get("url", URL)}, "accepts": [accept]}


cases = {
    "正常": make(),
    "换了收款人": make(payTo="0x2222222222222222222222222222222222222222"),
    "金额 $5": make(amount="5000000"),
    "金额写成 200 万个最小单位": make(amount="2000000"),
    "主网": make(network="eip155:8453"),
    "别的币": make(asset="0x0000000000000000000000000000000000000001"),
    "要价是给别的 URL 的": make(url="http://127.0.0.1:9111/api/credit-report/other"),
}
for name, req in cases.items():
    ok, why = check_requirements(req, PAYEE, max_usd=0.05, url=URL)
    print(f"{'放行' if ok else '拒绝'} | {name}: {why}")
```

<div class="line-notes">

- `ALLOWED_NETWORKS = {"eip155:84532"}  # 只认测试网` 网络白名单。这里只放测试网,真钱的主网一律不付。
- `ALLOWED_ASSETS = {"0x036cbd53842c5426634e7929541ec2318f3dcf7e"}  # 全小写比较` 币种白名单,地址统一小写再比,因为地址大小写不敏感。
- `if required.get("x402Version") != 2:` 先看版本。不认识的版本一律不处理,v1 的旧格式字段名不一样,按 v2 解析会出错。
- `resource_url = required.get("resource", {}).get("url", "")` 链式 `.get` 加默认值,对方缺字段也不会抛 `KeyError`。
- `if resource_url != url:` 要价是给哪个地址的,必须是我请求的那个。防的是「中间人拿一个便宜地址的要价来换掉贵地址的要价」。
- `for accept in required.get("accepts", []):` 遍历对方列出的所有选项,**挑一个我愿意付的**,不是盲目取第一个。
- `if accept.get("scheme") != "exact" or accept.get("network") not in ALLOWED_NETWORKS:` 方式和网络不在名单就 `continue` 看下一个选项。
- `return False, f"收款人 {accept.get('payTo')} 不是预期的 {expected_payee}"` 名单内的选项里收款人不对,直接拒绝,不再看别的。收款人不对说明有人动了手脚,不该「换一个选项再试」。
- `usd = int(accept["amount"]) / 10**USDC_DECIMALS` 金额换算成美元再和上限比。
- `"金额写成 200 万个最小单位": make(amount="2000000")` 这个例子故意用来检验单位:2000000 个最小单位是 2 美元,不是 200 万美元,也不是 0.002 美元。

</div>

```text
放行 | 正常: 可以付 $0.02
拒绝 | 换了收款人: 收款人 0x2222222222222222222222222222222222222222 不是预期的 0x000000000000000000000000000000000000dEaD
拒绝 | 金额 $5: 要价 $5.0 超过上限 $0.05
拒绝 | 金额写成 200 万个最小单位: 要价 $2.0 超过上限 $0.05
拒绝 | 主网: 没有一个我愿意付的选项(网络或币种不在白名单)
拒绝 | 别的币: 没有一个我愿意付的选项(网络或币种不在白名单)
拒绝 | 要价是给别的 URL 的: 要价是给 http://127.0.0.1:9111/api/credit-report/other 的,我请求的是 http://127.0.0.1:9111/api/credit-report/acme
```

(`uv run python -m part10.pay.ex617_check402` 的真实输出。)这个函数是纯数据检查,没有网络。它和 SDK 自带的 `$1` 上限是两层:SDK 的只管金额,这个还管收款人、网络、币种和资源地址。明天的授权框会把它再往前推一步。

</details>

**练习 3:同一个付款头,同时发 5 个请求。** 先预测:会有几个请求拿到内容?账本里会记几笔?然后跑一遍。如果结果不是你预期的,想想为什么。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part10/pay/ex617_race.py
"""练习 3:同一个付款头,同时发 5 个请求,会有几个拿到内容?"""
import asyncio

import httpx
from eth_account import Account
from x402 import x402Client
from x402.http import decode_payment_required_header, encode_payment_signature_header
from x402.mechanisms.evm.exact import ExactEvmScheme

URL = "http://127.0.0.1:9111/api/credit-report/acme"


async def main() -> None:
    client = x402Client()
    client.register("eip155:*", ExactEvmScheme(signer=Account.create()))
    async with httpx.AsyncClient() as http:
        first = await http.get(URL)
        payment = await client.create_payment_payload(decode_payment_required_header(first.headers["payment-required"]))
        header = encode_payment_signature_header(payment)
        results = await asyncio.gather(*[http.get(URL, headers={"PAYMENT-SIGNATURE": header}) for _ in range(5)])
    print("状态码:", sorted(r.status_code for r in results))
    ledger = httpx.get("http://127.0.0.1:9112/_ledger").json()
    print("账本里这个付款人的记录条数:", sum(1 for row in ledger if row["payer"] == payment.payload["authorization"]["from"]))


asyncio.run(main())
```

<div class="line-notes">

- `header = encode_payment_signature_header(payment)` 同一张支票编码成一个头。
- `results = await asyncio.gather(*[http.get(URL, headers={"PAYMENT-SIGNATURE": header}) for _ in range(5)])` 五个请求**同时**发出去,都带这同一个头。`gather` 相当于 `Promise.all`,`*[...]` 是把列表展开成多个参数,相当于 JS 的 `...`。
- `print("状态码:", sorted(r.status_code for r in results))` 排序后看一眼分布。
- `ledger = httpx.get("http://127.0.0.1:9112/_ledger").json()` 去假结算那边查账本。
- `sum(1 for row in ledger if row["payer"] == payment.payload["authorization"]["from"])` 数这个付款人在账本里有几条记录。

</div>

正确答案是:**只有 1 个拿到 200,账本里只有 1 笔,其余 4 个是 402。** 我这一版的真实输出是:

```text
状态码: [200, 402, 402, 402, 402]
账本里这个付款人的记录条数: 1
```

但这是**加了锁之后**的结果。我第一版的假结算没有 `settle_lock`,`settle` 里是「先检查编号用过没有,再把编号记下来」两步,中间没有锁。五个请求同时到达时,可能几个都在第一步看到「没用过」,然后都走到第二步。我当时连跑两次,真实的输出是:

```text
状态码: [200, 200, 402, 402, 402]
账本里这个付款人的记录条数: 2

状态码: [200, 200, 200, 402, 402]
账本里这个付款人的记录条数: 3
```

一张只该兑现一次的支票,被兑现了两次、三次,账本上记了三笔。这是经典的**检查后使用**(check-then-act)竞态:检查和修改不是一个不可分割的动作。真实的链上合约用交易的原子性保证这一点,同一个编号只可能被一笔交易成功使用;但**你自己写的服务端**(收费接口、facilitator、任何记账代码)只要有「先查后改」,就得自己保证原子性,锁、数据库的唯一约束、`INSERT ... ON CONFLICT` 都行。

修复就是 `mock_facilitator.py` 里现在的样子:把「检查 + 记录」放进同一个 `with settle_lock:` 里。前端的同学可以类比:JS 单线程所以很少碰到,但两个浏览器标签页同时点「领取优惠券」,后端没有加唯一约束,一样会领到两张。

</details>

**验收标准:** 窗口 A、B 起得来;`look_402.py` 能解码出 `amount: "20000"`;`pay_client.py` 返回 200 和 `0xmock` 开头的交易号;`replay_demo.py` 四条全是 402;三道练习的输出和参考答案一致,练习 3 能说清「先查后改」为什么会重复兑现。做完记得在三个窗口按 Ctrl+C 把服务关掉。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 授权 / 结账 / 结算 | Agent 付钱的三层:谁允许它花钱 / 买什么多少钱 / 钱怎么到账 |
| HTTP 402 | Payment Required,HTTP 里一个长期没人用的状态码,x402 用它表示「先付钱再给你内容」 |
| x402 | 基于 HTTP 402 的付款协议,2026 年 4 月起归 Linux 基金会下的 x402 Foundation 治理,目前规范 v2 |
| facilitator | 结算代理,替收费方验证和结算付款,提供 `/verify`、`/settle`、`/supported` |
| `PAYMENT-REQUIRED` | 402 响应里的头,base64 的 JSON,写要价 |
| `PAYMENT-SIGNATURE` | 客户端重发请求时带的头,base64 的 JSON,装签名和授权 |
| `PAYMENT-RESPONSE` | 成功响应里的头,结算回执 |
| base64 | 把字节编码成可见字符的方式,不是加密,任何人都能还原 |
| 钱包 / 私钥 / 地址 | 钱包是一对密钥;私钥自己留着用来签名;地址由公钥算出,别人往这里付款 |
| 签名 | 用私钥对数据盖的章,别人用公钥能验证但无法伪造 |
| USDC | 和美元 1:1 挂钩的稳定币,6 位小数,`20000` 个最小单位 = 0.02 美元 |
| EIP-3009 | 以太坊上「持有人离线签一张授权支票,别人去链上兑现」的标准,x402 的 `exact` 用它 |
| EIP-712 | 把结构化数据按固定规则编码再签名的标准 |
| nonce | 一次性编号,每张支票一个,用过就作废,防重放 |
| CAIP-2 | 链的命名格式,如 `eip155:84532`,`:` 前是链类型、后是链编号 |
| Base Sepolia | Base 链的测试网,上面的币没有价值,专门给开发者测试 |
| scheme(`exact` / `upto`) | 收费方式:`exact` 固定金额,`upto` 授权一个上限、按实际用量结算 |
| confused deputy / 竞态 | 竞态(race condition)是多个请求同时进来,「先查后改」被穿插,导致同一张支票被兑现多次 |

## 常见误区

**把 AP2 和 x402 当成竞争对手。** 它们在不同的层:AP2 管授权,x402 管结算,AP2 官网的示例里就有用 x402 结算的。真正竞争的是同层的,比如 x402 和 MPP。

**照 2025 年的 x402 教程写代码。** v1 的头叫 `X-PAYMENT`,v2 叫 `PAYMENT-SIGNATURE`,网络名也从 `base-sepolia` 变成了 `eip155:84532`。搜到教程先看日期,对不上就一直拿到 402。

**以为 base64 是加密。** 付款头只是 base64 编码,任何人在网络上看到都能解开。它的安全性来自里面的**签名**和一次性 `nonce`,不是编码。

**金额用浮点数算。** 链上金额是字符串形式的大整数,`amount: "20000"` 要用 `int()` 转,再除 `10**6` 换算美元;直接 `Number()` 或 `float()` 遇到大金额会丢精度。

**以为 SDK 自带的 `$1` 上限就是授权框。** 它只看单笔金额,不管收款人、总额、买的是什么。真正的授权框明天写。

**服务端「先查后改」不加锁。** 练习 3 里我第一版的假结算就这样,五个并发请求兑现了三次。凡是「用一次就作废」的东西(编号、优惠券、验证码),查和用必须原子。

**校验失败时「换一个选项再试」。** 练习 2 里名单内的选项收款人不对,我选择直接拒绝而不是继续找下一个,因为要价被动过手脚,整份要价都不该信。

**把测试网当真钱的演练场。** 今天连测试网都没连,全是本地假结算。真要上测试网,也只用专门生成的测试钱包和水龙头发的测试币,不要用你装过真钱的钱包。

## 学习资料

### 文档与文章

- [x402 规范仓库的 specs 目录](https://github.com/x402-foundation/x402/tree/main/specs):先读 `x402-specification-v2.md`,再看 `transports-v2/http.md`(三个头的写法)和 `transports-v2/a2a.md`(在 A2A 上怎么收费)。英文,各 20 分钟。
- [x402 官网](https://www.x402.org):概览和生态。英文,10 分钟。
- [Linux 基金会:x402 Foundation 成立公告](https://www.linuxfoundation.org/press/linux-foundation-is-launching-the-x402-foundation-and-welcoming-the-contribution-of-the-x402-protocol):2026-04-02,治理和支持者名单,10 分钟。英文。
- [arXiv:Five Attacks on x402 Agentic Payment Protocol](https://arxiv.org/abs/2605.11781):摘要 5 分钟,全文如果想读,重点看五种攻击的表格。英文。
- [x402 Python SDK 的 README](https://github.com/x402-foundation/x402/tree/main/python/x402):客户端、服务端、facilitator 三种角色的代码入口,20 分钟。英文。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1MVqPBDEsa&autoplay=0&high_quality=1" title="x402 是什么:把付费写进 HTTP" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>失控的PM · x402 是什么:把付费写进 HTTP · 4 分钟,2026 年 1 月的入门短片,先建立整体印象。细节(头的名字等)以今天的文章和规范为准。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/ahPggBHckR4" title="What is x402? The Open Payment Protocol Explained" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>_done · What is x402? The Open Payment Protocol Explained · 英文入门讲解。我没有核对它录制的时间,如果里面用的是 `X-PAYMENT` 头,说明讲的是 v1,对照今天的 v2 头名看。</figcaption>
</figure>

### 书籍

今天这组不需要。这类协议变化太快,书写不出来,一手资料是规范、SDK 仓库和论文。

### 开源项目与代码

- [x402-foundation/x402](https://github.com/x402-foundation/x402):协议主仓库,多语言 SDK 都在里面。看 `specs/schemes/exact/scheme_exact_evm.md`,对着今天的假结算看真实合约怎么验,25 分钟。
- [x402 的 PyPI 页面](https://pypi.org/project/x402/):确认版本号和可选部件(`httpx`、`fastapi`、`evm` 等)。
- [Starlette 文档](https://starlette.dev):手写 402 接口时用到的框架,看「Requests」和「Responses」两节,15 分钟。英文。

## 自测

**1. 把「Agent 付钱」拆成哪三层?每层问的是什么问题?**

<details><summary>答案</summary>

授权(谁允许 Agent 花钱、花多少、凭什么说是用户让它买的)、结账(买什么、多少钱、含不含税、订单怎么跟踪,商家的事)、结算(钱从哪里出、怎么到商家账上)。以前人在网页上一口气做完,人本身就是授权证明;Agent 介入后每一层都要重新回答「凭什么信它」。

</details>

**2. x402 一次付款的往返里,三个 HTTP 头各是谁发的、装什么?**

<details><summary>答案</summary>

`PAYMENT-REQUIRED`:服务端随 402 响应发,base64 的 JSON,里面 `accepts` 列出要价(scheme、network、amount、asset、payTo、maxTimeoutSeconds)。`PAYMENT-SIGNATURE`:客户端重发请求时带,base64 的 JSON,装自己选中的要价副本和签名授权(付款人、收款人、金额、有效期、nonce)。`PAYMENT-RESPONSE`:服务端成功时随 200 返回,结算回执(success、payer、transaction、network、amount)。

</details>

**3. 有人偷到了你的 `PAYMENT-SIGNATURE` 头,他能不能(a)再买一次同样的东西?(b)把收款人改成自己?为什么?**

<details><summary>答案</summary>

(a) 不能:支票上有一次性的 nonce,第一次兑现后这个编号作废,重放会得到 `nonce_already_used`。(b) 不能:签名是对着包括收款人、金额、有效期、nonce 在内的全部字段签的,改任何字段恢复出来的签名人就不是付款人了,会得到 `invalid_signature`;而且服务端比对要价时,客户端抄回来的 `accepted` 和服务端开出的不一致就直接拒了。前提是服务端的「查编号 + 记编号」是原子的,否则并发时可能被兑现多次。

</details>

**4. facilitator 是干什么的?为什么收费方不自己直接结算?**

<details><summary>答案</summary>

facilitator 替收费方校验签名(`/verify`)、把支票拿到链上兑现(`/settle`)、说明自己支持哪些链和付款方式(`/supported`)。收费方自己结算的话要跑区块链节点、管 gas 费、处理各种链上异常,代价大;交给 facilitator 后收费方只需要调它的 HTTP 接口。代价是多了一个需要信任的第三方,所以练习里服务端要用自己保存的要价去调结算,不能信客户端抄回来的。

</details>

**5. SDK 客户端默认单笔上限 $1,为什么说它不等于「授权框」?**

<details><summary>答案</summary>

它只看单笔金额。没有总预算(一天几百次 0.9 美元的付款它都放行)、没有收款人名单、不检查买的东西是不是用户想要的、没有过期时间、也没有「超过某个金额回去问用户」的流程。授权框要把这些都管起来,而且规则必须是确定性的代码,不能交给模型判断。

</details>

**6. 面试题:x402 为什么适合 Agent,又不适合所有场景?**

<details><summary>答案</summary>

适合:付款和调接口合成一个动作,不需要注册账号、绑卡、申请 API key,对「一天调几百个不同接口」的 Agent 很友好;按次计费,适合数据接口、MCP server 这类小额调用。不适合的地方:结算走稳定币,收款方要有链上地址、付款方钱包要有 USDC,在中国境内受 2026 年 2 月通知(银发〔2026〕42 号)影响基本走不通;同步 HTTP 加异步链上结算有跨层攻击面(未确认就放行、重放、抢跑等,见 arXiv 2605.11781),服务端要等结算确认再放内容;而且它只解决「钱怎么走」,不解决「这笔钱是不是用户想花的」,后者要靠授权层。

</details>

## 明天预告

[Day 618](/blog/agent-zero/day-618-payments-2/) 接着讲 Agent 支付(二):AP2、ACP、UCP,以及「签名都对但决定不是用户的」。今天你看到了:一个被提示词注入带偏的 Agent,完全可以签出一张格式完美的 x402 付款,协议层挡不住。明天就从这里开始:AP2 的 mandate(授权凭证)怎么让用户事先划好范围,ACP 和 UCP 在商家那一侧怎么卖,然后写一个不依赖模型判断的钱包授权框,接到今天的 x402 客户端上,再用真实的模型演示「商品描述里一句假话,把 Agent 从便宜货带到贵货」。
