---
title: 'Day 151 · Agent 支付:AP2、ACP、x402 与 UCP'
description: 'Agent 替人花钱,要回答三个问题:谁允许它花、它买的是什么、钱怎么到账。今天按授权、结账、结算三层把 AP2、ACP、UCP、x402、MPP 和国内的银联 APOP、支付宝 AI 付放进一张图,读 x402 v2 的报文,再手写一个带「花钱授权框」的 Agent 钱包和一个按次收费的 API,把重放、篡改金额、付错资源三种攻击挡在门外。'
pubDate: 2026-10-22
regime: none
tags: ['payments', 'x402', 'ap2', 'acp', 'ucp', 'agentic-commerce', 'agent-60']
series: 'agent-60'
day: 151
lang: 'zh'
---

## 今天要解决的问题

**建议在 [Day 93 · Agent 互联](/blog/agent-60/day-93-agent-protocols/)之后读。** 专题篇可以跳着读,这一篇用到的前置只有 Day 93 讲的 A2A 和 Agent Card、Day 84 的 OAuth 和权限、Day 25 的人工审批,其余都会现讲。

到 Day 93 为止,SupportPilot 能查账、能退款申请、能请别的 Agent 帮忙,但它从来没有自己掏过钱。现在设想两个场景。第一个,一家企业客户对一张发票有争议,说「你们给我开票的这家子公司根本不存在」,客服 Agent 想调一个第三方的企业信用查询接口核实一下,这个接口按次收费,一次两分钱。第二个,客户在对话里说「帮我把套餐升到专业版,用我绑的那张卡付」,Agent 要真的去完成一次付款。

这两件事放在 2024 年,你会写一个 API key 调第三方接口、月底对账单;第二件事干脆不让 Agent 做,给客户一个付款链接。2025 年下半年开始,一批协议冒了出来,想让 Agent 自己完成付款:Google 的 AP2、OpenAI 和 Stripe 的 ACP、Coinbase 起头的 x402、Google 和 Shopify 的 UCP、Stripe 和 Tempo 的 MPP,国内有银联的 APOP 和支付宝的 AI 付。名字一大堆,而且 2026 年上半年变化很大:x402 交给了 Linux 基金会,AP2 捐给了 FIDO 联盟,ChatGPT 里的 Instant Checkout 收缩了。面试里被问到「Agent 支付」,能把它们各管哪一段讲清楚的人不多。

学完今天你应该能:

1. 用「授权、结账、结算」三层把这些协议放到正确的位置,说清楚哪些是竞争关系、哪些可以叠着用。
2. 读懂 x402 v2 的一次完整往返:402 响应里的 `PAYMENT-REQUIRED`、客户端带的 `PAYMENT-SIGNATURE`、结算回执 `PAYMENT-RESPONSE`,以及 facilitator 干什么。
3. 说清 AP2 的 mandate(授权凭证)要证明什么,「用户在场」和「用户不在场」两种付款有什么区别。
4. 手写一个 Agent 钱包:用户事先签一个「花钱授权框」,框内 Agent 自己付,超额要回去问人,框外直接拒绝;再写一个按次收费的接口,挡住重放、篡改金额和付错资源。
5. 知道这块现在最大的风险在哪里:签名都对,但 Agent 的决定已经被网页上的一段话带偏了。

预计用时 4 小时,其中动手 2 小时。全部代码不连链、不花钱,用一个假的 facilitator 模拟结算。

## 先把「Agent 付钱」拆成三层

把一次网购拆开看,其实有三件不同的事。第一件是**授权**:用户允许 Agent 花多少、花在哪、多久有效,出了事凭什么说「这是我让它买的」。第二件是**结账**:买什么、多少钱、含不含税、购物车怎么确认、订单怎么跟踪,这是商家的事。第三件是**结算**:钱从哪里出、怎么到商家账上,可以走银行卡网络,也可以走稳定币。

以前这三件事都是人在网页上一口气做完的,人自己就是授权的证明。Agent 介入以后,三件事中间多了一个不是用户本人的角色,每一层都要重新回答「凭什么信它」。现在的协议基本上就是各自挑了一两层来回答。

<figure>
<svg viewBox="0 0 640 300" role="img" aria-label="Agent 支付的三层:授权、结账、结算,以及各协议所在的层">
  <rect x="0" y="0" width="640" height="300" fill="var(--paper-raised)"/>
  <text x="20" y="28" font-family="var(--font-mono)" font-size="12" fill="var(--ink-soft)">用户 → Agent → 商家 → 钱</text>
  <rect x="20" y="44" width="600" height="70" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
  <text x="36" y="68" font-family="var(--font-mono)" font-size="13" fill="var(--ink)">授权层:谁允许 Agent 花钱,花多少</text>
  <text x="36" y="92" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">AP2 mandate · Verifiable Intent · 卡组织 Agent 令牌 · 银联 APOP 意图管理</text>
  <rect x="20" y="124" width="600" height="70" rx="6" fill="var(--paper-raised)" stroke="var(--rule)"/>
  <text x="36" y="148" font-family="var(--font-mono)" font-size="13" fill="var(--ink)">结账层:买什么、多少钱、订单</text>
  <text x="36" y="172" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">ACP(OpenAI + Stripe) · UCP(Google + Shopify 等)</text>
  <rect x="20" y="204" width="600" height="70" rx="6" fill="var(--compute-wash)" stroke="var(--compute)"/>
  <text x="36" y="228" font-family="var(--font-mono)" font-size="13" fill="var(--ink)">结算层:钱怎么到账</text>
  <text x="36" y="252" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">银行卡网络 · Stripe SPT · x402(稳定币,HTTP 402) · MPP</text>
  <text x="20" y="292" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">UCP 的支付部分建在 AP2 上;AP2 有走 x402 结算的示例</text>
</svg>
<figcaption>三层各管一段。UCP、ACP 讲的是商家那一侧怎么卖,AP2 讲用户那一侧怎么授权,x402、MPP 和卡网络讲钱怎么走。一次真实的购买可以同时用到三层里的三个协议。</figcaption>
</figure>

这张图最有用的地方是帮你识别「假竞争」。经常看到文章把 AP2 和 x402 拿来比谁会赢,其实 AP2 的官方示例里就有走 x402 结算的版本,两者是上下层的关系。真正正面竞争的是同一层里的:结账层的 ACP 和 UCP,结算层的 x402 和 MPP,以及卡组织各自的 Agent 令牌方案。

还有一个名字要先排雷。Day 93 讲过的 ACP 是 **Agent Client Protocol**,管编辑器和 Coding Agent 之间的连接。今天说的 ACP 是 **Agentic Commerce Protocol**,OpenAI 和 Stripe 做的结账协议。两个毫无关系,面试时说 ACP 最好先说全名。

## x402:让 HTTP 402 终于派上用场

HTTP 规范里有一个状态码从 1990 年代就留着没人用:402 Payment Required。现行的 RFC 9110 写的还是「保留给将来使用」。x402 就是把它用起来:你请求一个要付费的接口,服务端回 402,告诉你价格和收款方式;你签一笔付款,带着它重新请求;服务端核实、结算,然后给你内容。整个过程不需要注册账号、不需要 API key、不需要月底对账,所以特别适合 Agent:它可能一天调几百个不同的接口,每个都去注册账号不现实。

x402 最早由 Coinbase 牵头,和 Cloudflare、Stripe 一起开发。2026 年 4 月 2 日,Linux 基金会宣布成立 x402 Foundation 接管这个协议,地点是在纽约的 MCP Dev Summit;Coinbase 的文档说创始成员约 40 家,包括 AWS、American Express、Cloudflare、Google、Mastercard、Shopify、Stripe、Visa。代码仓库随之搬到了 `github.com/x402-foundation/x402`,原来 `coinbase/x402` 那个仓库现在只是开发用的分叉。PyPI 上的 Python SDK 叫 `x402`,我 2026 年 10 月 22 日查到的最新版是 2.25.0。

### 一次往返长什么样

现在的协议版本是 v2。一次付费请求有三个 HTTP 头要认识:

<figure>
<svg viewBox="0 0 640 330" role="img" aria-label="x402 v2 一次付费请求的时序">
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
  <text x="105" y="140" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">③ 钱包按授权框判断,签名</text>
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
<figcaption>Agent 第一次请求被 402 挡回来,402 里写明了要价;钱包签名后重发;收费接口把签名交给 facilitator 核实并结算,成功后才返回内容和回执。facilitator 是替收费方跟链打交道的服务,收费方自己不用跑节点。</figcaption>
</figure>

- `PAYMENT-REQUIRED`:服务端随 402 返回,内容是 base64 编码的 JSON,里面 `accepts` 列出它接受的付款方式,每一种写明 `scheme`(怎么收)、`network`(哪条链)、`amount`(金额,用最小单位)、`asset`(什么币)、`payTo`(收款地址)、`maxTimeoutSeconds`(签名多久有效)。
- `PAYMENT-SIGNATURE`:客户端重发时带上,也是 base64 的 JSON,里面 `accepted` 原样抄一份自己选中的那种付款方式,`payload` 里是签名和授权内容(付款人、收款人、金额、有效期、一次性的 nonce)。
- `PAYMENT-RESPONSE`:服务端成功时随 200 返回的结算回执,有 `success`、`payer`、`transaction`(链上交易号)、`network`、`amount`。

`network` 用的是 CAIP-2 格式,`eip155:8453` 是 Base 主网,`eip155:84532` 是 Base Sepolia 测试网。`scheme` 目前规范里有三种:`exact` 是固定金额;`upto` 是授权一个上限,服务端按实际用量结算,比如按生成的 token 收费;`batch-settlement` 把很多笔小额先记在链下凭证里,攒一批再上链。facilitator 提供三个接口:`POST /verify` 只检查不扣钱,`POST /settle` 真的结算,`GET /supported` 列出它支持哪些链和 scheme。

**有一个坑要提醒**:你在 B 站和 YouTube 上搜到的 x402 教程,很多是 2025 年下半年录的,用的是 v1,请求头叫 `X-PAYMENT`,响应头叫 `X-PAYMENT-RESPONSE`,网络名写 `base-sepolia`。v2 把头改成了上面三个,网络改成了 CAIP-2。照着旧视频抄代码对接新版 SDK,会一直拿到 402,还看不出哪里错。

### 为什么它适合 Agent,又不适合所有场景

x402 的好处是「付钱」和「调接口」合成了一个动作,Agent 不需要人先去注册、绑卡、拿 key。对按次计费的数据接口、MCP server、爬虫友好的内容站来说,这比给每个 Agent 开账号省事得多。Cloudflare 是协议的发起方之一,它自己也在推「网站向 AI 爬虫按次收费」这件事,两者的思路是一样的。

它的限制也很明显。结算走稳定币,收款方要有链上地址,付款方钱包里要有 USDC 这类资产。在海外这件事已经比较顺,在国内基本走不通:2026 年 2 月 6 日人民银行等八部门发布的《关于进一步防范和处置虚拟货币等相关风险的通知》(银发〔2026〕42 号)延续了 2021 年 237 号文的思路,虚拟货币相关业务在境内属于非法金融活动。所以国内团队可以学 x402 的设计,但别把「主网稳定币结算」当成可上线的方案,具体能做什么要问法务。

## AP2:证明「这是用户让买的」

x402 解决的是「钱怎么付」,它不关心这笔钱是不是用户真的想花。一个被提示词注入带偏的 Agent,完全可以签出一笔格式完美的 x402 付款。AP2(Agent Payments Protocol)补的就是这一块。

AP2 是 Google 在 2025 年 9 月发布的,2026 年 4 月 28 日 Google 宣布把它捐给 FIDO 联盟(做 Passkey 标准的那个组织),同一天在 GitHub 发布了 v0.2。FIDO 随后成立了两个工作组,一个管 Agent 怎么认证用户,一个管支付。截至我查到的 10 月,FIDO 还没有出正式规范,所以 AP2 仍然应该当成「在制定中」。

AP2 的核心概念是 **mandate**,可以理解成一张用户签过名的「授权条」。它是一种可验证的数字凭证(VDC),带密码学签名,改一个字就验不过。现在的官网文档把 mandate 分成两种,每种又分「开放」和「封闭」:

| mandate | 开放(open) | 封闭(closed) | 交给谁 |
| --- | --- | --- | --- |
| Checkout Mandate | 用户的目标和约束,购物车还没定,比如「演唱会开票时帮我抢两张,每张不超过 800」 | 某一次已经定好的结账:具体商品、数量、价格 | 商家 |
| Payment Mandate | 付款的限制:预算、允许用哪张卡 | 和某次结账绑定的具体金额 | 发卡方、卡网络、收单方 |

如果你看的是 2025 年的文章,会看到 Intent Mandate、Cart Mandate、Payment Mandate 三个名字,那是 v0.1 的叫法。大意对得上:Intent 对应现在的开放型,Cart 对应封闭的 Checkout Mandate。

AP2 把付款分成两种场景。**用户在场**(Human Present)时,Agent 把购物车拿给用户看,用户当场签封闭的 mandate,和你在网页上点「确认付款」差不多,只是签名换成了可验证凭证。**用户不在场**(Human Not Present)是 v0.2 新加的,用户事先签一个开放的 mandate,规定好条件,Agent 等条件满足时自己下单,典型例子就是抢限量票。后一种才是 Agent 支付真正新的地方,也是风险最集中的地方。

和 AP2 一起捐给 FIDO 的还有一个叫 Verifiable Intent 的标准,是 Google 和 Mastercard 合作做的,用来留一份防篡改的「用户授权了 Agent 做什么」的记录。AP2 本身被设计成 A2A 的扩展,也可以通过 MCP 用,这和 Day 93 讲的 A2A 能接上:一个购物 Agent 通过 A2A 找到商家的 Agent,mandate 作为消息里的凭证传过去。

你会发现 AP2 的思路和我们 Day 84、Day 40 讲的权限设计是一回事:**最小授权、有边界、能追溯**。区别是以前的边界写在你自己的服务器配置里,只有你自己信;mandate 是签了名、能拿给第三方验的,商家和银行也能信。

## ACP 和 UCP:商家那一侧怎么卖

### ACP 的一年

ACP 由 OpenAI 和 Stripe 共同维护,2025 年 9 月 29 日随 ChatGPT 的 Instant Checkout 一起发布,Apache 2.0 许可。它定义了两组接口:结账接口(创建、更新、完成一次 checkout)和委托付款接口(把一个受限的付款凭证交给商家)。Stripe 对后者的实现叫 Shared Payment Token(SPT,`spt_` 开头),这个令牌可以设置使用限制,比如只能用一次、限额多少,商家拿着它创建 PaymentIntent 扣款,自始至终看不到卡号。

协议本身还标着 beta。GitHub 上的规范目录里有好几个按日期命名的版本,我 10 月查到标为最新稳定版的是 2026-04-17,这一版加了购物车、商品 feed、订单、认证和 MCP 兼容。

产品那一侧就没那么顺了。2026 年 3 月,多家行业媒体援引 CNBC 的报道说,OpenAI 不再主推 ChatGPT 里的 Instant Checkout,改成和零售商合作在 ChatGPT 里做各自的 App,很多购买跳回商家自己的网站完成。报道里有两个数字传得很广:购物按钮转化率不到 1%、Shopify 上只有十来家商家真正接通了,这两个数字我只在二手报道里看到,没找到 OpenAI 或 Shopify 的一手说法。ACP 协议本身还在继续,只是定位从「在聊天框里直接买」变成了「把 Agent 和商家接起来」的基础设施。

这件事值得当成案例记住。协议做得再好,最后决定能不能落地的是商家愿不愿意接、用户愿不愿意在聊天框里付钱。你在面试里讲 Agent 支付,能说出这一段,比背协议字段更显得你懂行。

### UCP

UCP(Universal Commerce Protocol)是 Google 在 2026 年 1 月 11 日美国零售联合会年会上发布的,和 Shopify 共同开发,Etsy、Wayfair、Target、Walmart 参与,Stripe、PayPal、Visa、Mastercard、Adyen 等表态支持。现在的官网把共同开发方列得更长,包括 Amazon、Microsoft、Meta、Salesforce,以及酒店、外卖行业的一批公司。

UCP 覆盖的范围比 ACP 宽:商品目录、购物车、结账、账号关联(用 OAuth 2.0,让 Agent 代表用户登录商家账号而不拿密码)、订单和售后。传输方式有 REST 和 JSON-RPC,同时内置对 A2A 和 MCP 的支持。付款部分直接建在 AP2 上,用 mandate 证明用户同意。

ACP 和 UCP 是同一层的竞争者。目前的格局大致是:想在 ChatGPT 里卖东西的看 ACP,想在 Google 搜索 AI 模式和 Gemini 里卖东西的看 UCP。对大部分 Agent 工程师来说,你更可能站在「做购物 Agent」或者「帮商家接入」的一侧,两边都要能读。

## 其他玩家:MPP、卡组织和国内

**MPP**(Machine Payments Protocol)是 Stripe 和 Tempo 合写的,2026 年 3 月 18 日随 Tempo 主网一起发布,和 x402 在同一层。按 Decrypt 和 Fortune 的报道,它设计成不绑定单一支付通道,Visa 把它扩展到了银行卡,Stripe 加了卡和钱包,还有一个叫 sessions 的功能支持 Agent 持续付费。我没有找到它的独立采用数据。

**卡组织**各有自己的方案:Mastercard 的 Agent Pay 用「Agent 令牌」,把一张卡的令牌绑定到某个 Agent、某个商户范围和一套消费限制上;Visa 有 Trusted Agent Protocol,定义 Agent 怎么向商家证明自己的身份。这两家的细节我只在二手文章里看到,写在这里是让你知道它们存在,用之前去读官方文档。

**国内**走的是另一条路,不碰稳定币,建在现有的银行卡和支付机构体系上:

- 中国银联在 2026 年 4 月初发布了《智能体支付开放协议框架》(APOP)。按新华网 4 月 3 日的报道,框架有四项能力:智能体身份管理、意图管理、用户身份管理、支付授权管理,其中意图管理负责把用户的付款需求变成有边界的结构化指令,首批 19 家境内外机构参与。你会发现「意图管理」和 AP2 的开放型 mandate 是同一个思路。
- 支付宝在 2026 年 5 月 26 日披露 AI 智能体支付累计 3 亿笔,同时发布 Token Pay 和 AI 钱包,和更早的 AI 付、AI 收组成一套产品,还和二十多家伙伴升级了它称为 ACT 2.0 的智能体商业信任协议。这些来自移动支付网等行业媒体的报道。钛媒体的报道里提到,3 亿笔里约九成来自千问,这个比例很重要,说明目前的量主要还是阿里自家生态内的。

国内的这些方案目前都没有公开完整的技术规范,接入要走合作伙伴流程。对工程师来说,现阶段能做的是理解它们的设计,在自己的系统里把「授权框」和「审计」做好,等能接入时换一个结算后端就行。下面的动手练习就是按这个思路设计的。

## 签名都对,决定却不是用户的

讲完协议,讲风险。2026 年有两篇论文值得读,它们说明了一件事:**支付协议能保证签名和金额对得上,保证不了 Agent 的判断没被带偏**。

第一篇是 2026 年 5 月 12 日挂上 arXiv 的《Five Attacks on x402 Agentic Payment Protocol》。作者列了五种攻击:服务端在结算还没最终确认时就放出内容,之后链上回滚,等于白送;旁观者看到付款头抢先上链,用户被扣了钱,正规结算反而失败;同一笔付款通过重试、并发或换一种编码被用了好几次;代理或缓存改了付款头,或者把付费内容缓存下来给了没付钱的人;攻击者在服务发现目录里刷假条目,把 Agent 引到恶意的收费接口。对应的建议是:规范编码加有效期检查、只允许付款人指定的 facilitator 结算、付款 ID 和资源绑定且只能用一次、结算确认后再放内容、付费响应禁止缓存、发现目录防刷。

第二篇是 9 月 10 日的《Signing the Transaction but Not the Decision: Whisper Attacks and a Binding Defense for AP2》。它说的「耳语攻击」只用商品描述里的普通文字,就能让购物 Agent 拼出一个能通过 AP2 所有校验、但和用户要的东西对不上的购物车,比如一句假的「这款缺货,同系列升级款有货」就让 Agent 换了个更贵的。作者提的防御是把用户签的意图当作一张「能力许可」,每一次取凭证都绑定到发起请求的会话,每一行购物车都绑定到用户看过的那个商品页,超出授权的花费拿出来让用户确认。

这和 Day 39 讲的间接提示词注入是一回事,只是后果从「泄露数据」变成了「花掉真钱」。我的结论是:**Agent 侧必须有一个不依赖模型判断的花钱规则层**。模型可以决定「要不要买这个」,但能不能付、付多少、付给谁,要由一段确定的代码按用户签的授权框来卡。这也是下面练习的主角。

## 动手练习

我们给 SupportPilot 加一个能力:处理企业客户的开票争议时,调一个按次收费的「企业信用报告」接口。收费方用 x402 v2 的报文格式,结算用一个假的 facilitator 代替链(HMAC 代替链上签名,字典代替余额),所以不需要钱包、不需要测试币,也不碰任何跟稳定币有关的东西。

准备工作,在 `agent-60-lab` 根目录:

```bash
cd ~/Documents/agent-60-lab
uv add fastapi
mkdir -p topics/agent_payments
touch topics/__init__.py topics/agent_payments/__init__.py
```

目录名用下划线 `agent_payments`,因为后面要用 `python -m topics.agent_payments.xxx` 跑,带连字符的目录不能当包导入。`httpx` 和 `pytest`、`anyio` 练习仓里已经有了。

### 第 1 步:报文

```python
# agent-60-lab/topics/agent_payments/protocol.py
import base64
import json
from typing import Any

X402_VERSION = 2
NETWORK = "eip155:84532"  # Base Sepolia 测试网的 CAIP-2 写法,这里只当标签用
USDC = "0xUSDC-TEST"  # 假的资产地址,真实测试网要换成 USDC 合约地址


def b64_json(obj: dict[str, Any]) -> str:
    return base64.b64encode(json.dumps(obj, ensure_ascii=False).encode()).decode()


def from_b64_json(s: str) -> dict[str, Any]:
    return json.loads(base64.b64decode(s))


def payment_required(url: str, description: str, amount: str, pay_to: str) -> dict[str, Any]:
    return {
        "x402Version": X402_VERSION,
        "error": "payment required",
        "resource": {"url": url, "description": description, "mimeType": "application/json"},
        "accepts": [
            {
                "scheme": "exact",
                "network": NETWORK,
                "amount": amount,  # 最小单位,USDC 6 位小数,"20000" = 0.02
                "asset": USDC,
                "payTo": pay_to,
                "maxTimeoutSeconds": 60,
                "extra": {"name": "USDC", "version": "2"},
            }
        ],
    }
```

<div class="line-notes">

- `X402_VERSION = 2` 协议版本号,v2 和 v1 的头名字不一样,对接时先看这个数。
- `NETWORK = "eip155:84532"` CAIP-2 格式:`eip155` 是以太坊系的命名空间,`84532` 是 Base Sepolia 的链 ID。我们的假 facilitator 不连链,只把它当一个字符串原样传来传去。
- `USDC = "0xUSDC-TEST"` 真实场景这里是 USDC 合约地址。故意写成一个一眼假的值,免得有人以为可以直接拿去用。
- `def b64_json(` 把字典转成 JSON 再 base64。HTTP 头里不能放任意字符,`ensure_ascii=False` 让「acme 的企业信用报告」这种中文保持原样进 JSON,再由 base64 变成纯 ASCII。实测 402 响应里这个头有 524 个字符,开头是 `eyJ4NDAyVmVyc2lvbiI6IDIs`,解码就是 `{"x402Version": 2,`。
- `def from_b64_json(` 反过来:base64 解码成字节,`json.loads` 直接吃字节。
- `def payment_required(` 构造 402 里要返回的那个对象,字段名和 v2 规范一致。
- `"resource": {"url": url` 把被收费的资源 URL 写进去。后面客户端的付款里会原样带回来,服务端拿它检查「这笔钱是不是给这个资源付的」。
- `"accepts": [` 是个列表,服务端可以同时接受好几种付款方式(不同的链、不同的币),客户端挑一种。我们只放一种。
- `"scheme": "exact",` 固定金额。如果是按 token 计费的接口,会用 `upto`。
- `"amount": amount,` 用字符串存最小单位。USDC 有 6 位小数,`"20000"` 就是 0.02 USDC。用字符串是为了跨语言不丢精度,这一点和 Day 46 账单金额用整数分是一个道理。
- `"maxTimeoutSeconds": 60,` 客户端签出的付款 60 秒内有效,过期作废,防止被截下来很久以后再用。
- `"extra": {"name": "USDC"` 留给不同 scheme 放额外参数。真实的 EVM 签名要用到代币合约的名字和版本。

</div>

### 第 2 步:假的 facilitator

```python
# agent-60-lab/topics/agent_payments/facilitator.py
import hashlib
import hmac
import json
import time
from typing import Any


class FakeFacilitator:
    """代替链上结算的假 facilitator:HMAC 代替 EIP-3009 签名,dict 代替链上余额。"""

    def __init__(self) -> None:
        self.balances: dict[str, int] = {}
        self.secrets: dict[str, bytes] = {}
        self.used_nonces: set[str] = set()

    def open_wallet(self, address: str, secret: bytes, balance: int) -> None:
        self.secrets[address] = secret
        self.balances[address] = balance

    @staticmethod
    def sign(secret: bytes, auth: dict[str, Any]) -> str:
        msg = json.dumps(auth, sort_keys=True).encode()
        return hmac.new(secret, msg, hashlib.sha256).hexdigest()

    def verify(self, payload: dict[str, Any], req: dict[str, Any]) -> tuple[bool, str]:
        auth = payload["payload"]["authorization"]
        secret = self.secrets.get(auth["from"])
        if secret is None:
            return False, "unknown_payer"
        good = self.sign(secret, auth)
        if not hmac.compare_digest(good, payload["payload"]["signature"]):
            return False, "invalid_signature"
        if payload["accepted"] != req:
            return False, "requirements_mismatch"
        if auth["to"] != req["payTo"] or auth["value"] != req["amount"]:
            return False, "amount_or_recipient_mismatch"
        now = int(time.time())
        if not int(auth["validAfter"]) <= now < int(auth["validBefore"]):
            return False, "expired"
        if auth["nonce"] in self.used_nonces:
            return False, "nonce_already_used"
        if self.balances[auth["from"]] < int(auth["value"]):
            return False, "insufficient_funds"
        return True, ""

    def settle(self, payload: dict[str, Any], req: dict[str, Any]) -> dict[str, Any]:
        ok, reason = self.verify(payload, req)
        auth = payload["payload"]["authorization"]
        if not ok:
            return {"success": False, "errorReason": reason, "payer": auth["from"],
                    "transaction": "", "network": req["network"], "amount": req["amount"]}
        self.used_nonces.add(auth["nonce"])
        self.balances[auth["from"]] -= int(auth["value"])
        self.balances[auth["to"]] = self.balances.get(auth["to"], 0) + int(auth["value"])
        tx = "0x" + hashlib.sha256(auth["nonce"].encode()).hexdigest()[:16]
        return {"success": True, "payer": auth["from"], "transaction": tx,
                "network": req["network"], "amount": req["amount"]}
```

<div class="line-notes">

- `"""代替链上结算的假 facilitator` 真实的 `exact` scheme 在 EVM 链上用 EIP-3009 的 `transferWithAuthorization`:付款人离线签一份「允许从我这转 X 给 Y」,facilitator 拿去上链。我们用 HMAC 模拟「只有持有密钥的人能签」,用字典模拟余额,协议流程保持一样。
- `self.used_nonces: set[str]` 链上合约会记住用过的 nonce,同一个 nonce 第二次上链会失败。这是重放防护的最后一道,但不能只靠它,原因在第 3 步。
- `def open_wallet(` 测试用的开户:给一个地址配密钥和余额。演示里 Agent 开了 `1_000_000`,也就是 1 USDC。
- `msg = json.dumps(auth, sort_keys=True)` 签名前把字段排序,保证同一份内容不管字典顺序如何都得到同一个字节串。论文里的 M1「规范编码」说的就是这件事,编码不唯一,就会出现「换一种写法再用一次」的重放。
- `secret = self.secrets.get(auth["from"])` 按付款人地址找密钥,找不到就是不认识的付款人。
- `hmac.compare_digest(` 比较签名要用常量时间比较,普通的 `==` 遇到第一个不同字符就返回,理论上能被计时攻击猜出签名。
- `if payload["accepted"] != req:` 客户端声称自己接受的付款条件,必须和服务端这次给出的完全一致。测试里有一个用例故意把金额改成 `"1"` 再签名,签名本身是对的,就是在这一行被拦下,报 `requirements_mismatch`。
- `auth["to"] != req["payTo"]` 签名里写的收款人和金额也要对得上,防止条件抄对了、签名里却写了别的数。
- `if not int(auth["validAfter"]) <= now < int(auth["validBefore"]):` 有效期检查。钱包签的是「现在往前 5 秒到往后 60 秒」。
- `if self.balances[auth["from"]] < int(auth["value"]):` 余额不够。真实链上这一步由合约做。
- `def settle(` 先完整验证一遍再扣钱。真实的 facilitator 里,`/verify` 和 `/settle` 是两个接口,收费方可以先 verify 再 settle,也可以直接 settle。
- `self.used_nonces.add(auth["nonce"])` 扣钱之前先记下 nonce。
- `tx = "0x" + hashlib.sha256(` 生成一个假交易号。因为 nonce 每次随机,所以每次跑出来的交易号都不一样,我两次实测分别是 `0xe96159db6d14eb75` 和 `0xad6e87d9d5728896`。

</div>

### 第 3 步:收费接口

```python
# agent-60-lab/topics/agent_payments/paywall.py
import threading

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from topics.agent_payments.facilitator import FakeFacilitator
from topics.agent_payments.protocol import b64_json, from_b64_json, payment_required

MERCHANT = "0xCreditBureau"
PRICE = "20000"  # 0.02 USDC 一次

facilitator = FakeFacilitator()
app = FastAPI()
_claimed: set[str] = set()
_lock = threading.Lock()


@app.get("/api/credit-report/{company}")
async def credit_report(company: str, request: Request) -> JSONResponse:
    url = str(request.url)
    required = payment_required(url, f"{company} 的企业信用报告", PRICE, MERCHANT)
    header = request.headers.get("PAYMENT-SIGNATURE")
    if header is None:
        return JSONResponse({"error": "payment required"}, status_code=402,
                            headers={"PAYMENT-REQUIRED": b64_json(required)})

    payload = from_b64_json(header)
    if payload["resource"]["url"] != url:
        return JSONResponse({"error": "payment is for another resource"}, status_code=402)
    nonce = payload["payload"]["authorization"]["nonce"]
    with _lock:  # 先占住 nonce 再结算,同一笔付款并发重放只有一个能过
        if nonce in _claimed:
            return JSONResponse({"error": "payment already used"}, status_code=402)
        _claimed.add(nonce)

    result = facilitator.settle(payload, required["accepts"][0])
    if not result["success"]:
        with _lock:
            _claimed.discard(nonce)
        return JSONResponse({"error": result["errorReason"]}, status_code=402)

    body = {"company": company, "score": 82, "overdue_invoices": 1}
    return JSONResponse(body, headers={"PAYMENT-RESPONSE": b64_json(result),
                                       "Cache-Control": "no-store"})
```

<div class="line-notes">

- `MERCHANT = "0xCreditBureau"` 收款方地址,假的。
- `PRICE = "20000"` 一次 0.02 USDC。
- `_claimed: set[str] = set()` 收费方自己记一份「哪些付款已经被认领过」。facilitator 那边也有 nonce 记录,为什么还要自己记?论文里的攻击 II 说的就是:如果收费方在结算还没返回时就并发处理同一笔付款的多个请求,或者先放内容再异步结算,链上虽然只扣一次,内容却给出去好几次。所以收费方要在**结算之前**原子地占住这笔付款。
- `_lock = threading.Lock()` 占位操作要加锁。这里用线程锁够演示,多实例部署时要换成 Redis 的 `SET NX` 或数据库唯一约束,和 Day 37 讲的幂等键一个道理。
- `url = str(request.url)` 本次请求的完整 URL,演示里是 `http://paywall.invalid/api/credit-report/acme`。
- `required = payment_required(` 每次都按同样的参数重新生成要价,所以客户端带回来的 `accepted` 能和它逐字段比对。
- `if header is None:` 没带付款头,回 402 和要价。
- `if payload["resource"]["url"] != url:` 付款里写的资源必须是当前请求的资源,对应论文里的 M3「资源绑定」。测试里拿给 `acme` 签的付款去请求 `other`,在这里被拒。
- `with _lock:` 检查和占位放在同一把锁里,保证两个并发请求不会同时通过 `if nonce in _claimed`。
- `result = facilitator.settle(` 结算。演示里第一次返回 `{'success': True, 'payer': '0xSupportPilot', 'transaction': '0x…', 'network': 'eip155:84532', 'amount': '20000'}`。
- `_claimed.discard(nonce)` 结算失败要把占位释放,不然一笔因为余额不足失败的付款,充值后就再也用不了了。
- `body = {"company": company, "score": 82` 演示用的报告内容,数字是写死的。
- `headers={"PAYMENT-RESPONSE": b64_json(result)` 结算回执放在响应头里,客户端可以记账、对账。
- `"Cache-Control": "no-store"` 付费内容禁止任何缓存保存,对应论文 M5。否则一个共享缓存可能把付过钱的响应发给下一个没付钱的人。

</div>

### 第 4 步:带授权框的 Agent 钱包

这是今天最重要的一段。`Mandate` 是用户事先签好的开放型授权,对应 AP2 的开放 Payment Mandate 或者银联 APOP 的「意图管理」。钱包每次付钱前先过一遍 `decide`,这段代码完全不依赖模型。

```python
# agent-60-lab/topics/agent_payments/wallet.py
import secrets
import time
from dataclasses import dataclass, field
from typing import Any
from urllib.parse import urlparse

from topics.agent_payments.facilitator import FakeFacilitator


@dataclass
class Mandate:
    """用户事先签好的「开放授权」:Agent 在这个框里可以自己付钱。"""
    max_per_payment: int  # 单笔上限,最小单位
    daily_budget: int
    allowed_hosts: set[str]
    allowed_pay_to: set[str]
    confirm_above: int  # 超过这个数要回去问人


@dataclass
class AgentWallet:
    address: str
    secret: bytes
    mandate: Mandate
    spent_today: int = 0
    log: list[dict[str, Any]] = field(default_factory=list)

    def decide(self, url: str, req: dict[str, Any]) -> tuple[str, str]:
        amount = int(req["amount"])
        host = urlparse(url).hostname or ""
        if host not in self.mandate.allowed_hosts:
            return "deny", f"host {host} 不在授权名单"
        if req["payTo"] not in self.mandate.allowed_pay_to:
            return "deny", f"收款方 {req['payTo']} 不在授权名单"
        if amount > self.mandate.max_per_payment:
            return "deny", f"单笔 {amount} 超过上限 {self.mandate.max_per_payment}"
        if self.spent_today + amount > self.mandate.daily_budget:
            return "deny", "今天的预算用完了"
        if amount > self.mandate.confirm_above:
            return "ask_user", f"单笔 {amount} 超过免确认额度"
        return "pay", "在授权范围内"

    def pay(self, url: str, resource: dict[str, Any], req: dict[str, Any]) -> dict[str, Any]:
        now = int(time.time())
        auth = {"from": self.address, "to": req["payTo"], "value": req["amount"],
                "validAfter": str(now - 5), "validBefore": str(now + req["maxTimeoutSeconds"]),
                "nonce": "0x" + secrets.token_hex(16)}
        self.spent_today += int(req["amount"])
        self.log.append({"url": url, "amount": req["amount"], "nonce": auth["nonce"]})
        return {"x402Version": 2, "resource": resource, "accepted": req,
                "payload": {"signature": FakeFacilitator.sign(self.secret, auth),
                            "authorization": auth}}
```

<div class="line-notes">

- `class Mandate:` 授权框的五个参数,都是用户签的时候定下来的,Agent 改不了。真实系统里它应该是一份签了名的凭证,存在 Agent 拿不到写权限的地方。
- `max_per_payment: int` 单笔上限。演示里是 `50_000`,也就是 0.05 USDC。
- `daily_budget: int` 每天总预算,演示里 `100_000`,0.1 USDC。
- `allowed_hosts: set[str]` 只允许给这些域名付钱。这一条专门防「被引到恶意收费接口」(论文的攻击 IV),哪怕模型被网页上的一段话说服了,域名不在名单里就付不出去。
- `allowed_pay_to: set[str]` 收款地址也要白名单。只看域名不够,一个被攻破的正规网站可以把收款地址换成攻击者的。
- `confirm_above: int` 免确认额度。超过它不是拒绝,而是回去问人,对应 AP2 里「用户在场」的那种付款。演示里设 `30_000`。
- `spent_today: int = 0` 今天已经花了多少。这里放在内存里,真实系统要持久化,而且要按用户的时区算「今天」。
- `def decide(` 返回一个动作和一句理由。动作只有三种:`pay`、`ask_user`、`deny`。理由要写给人看,后面会进审计日志。
- `host = urlparse(url).hostname or ""` 从 URL 里取主机名,演示里是 `paywall.invalid`。`or ""` 是为了 `hostname` 可能是 `None` 时类型对得上。
- `if host not in self.mandate.allowed_hosts:` 测试里用 `http://evil.invalid/api` 去问,返回 `deny`。
- `if amount > self.mandate.max_per_payment:` 测试里把单笔上限设成 `30_000`,0.04 的要价被拒。
- `if self.spent_today + amount > self.mandate.daily_budget:` 测试里先把 `spent_today` 设成 `80_000`,再来一笔 `40_000`,加起来超过 `100_000`,返回 `("deny", "今天的预算用完了")`。
- `if amount > self.mandate.confirm_above:` 0.04 超过 0.03 的免确认额度,返回 `ask_user`。顺序很重要:先查所有硬上限,再看要不要问人,不然会出现「问了用户、用户点了同意、结果超预算」这种体验。
- `return "pay", "在授权范围内"` 演示里第一笔 0.02 走到这里。
- `def pay(` 签一笔付款。只有 `decide` 返回 `pay`(或者用户确认了 `ask_user`)才应该调用它。
- `"validAfter": str(now - 5)` 往前留 5 秒,容忍客户端和服务端的时钟差。
- `"nonce": "0x" + secrets.token_hex(16)` 32 个十六进制字符的随机数,每笔付款独一份。`secrets` 是密码学安全的随机数,别用 `random`。
- `self.spent_today += int(req["amount"])` 签名的同时就记账。这里有一个故意留下的问题:付款失败时这笔钱也被算进了今天的花费,练习 1 让你修。
- `self.log.append(` 钱包自己的流水,和服务端回执对账用。
- `"accepted": req,` 原样抄回服务端给的条件,服务端会逐字段比对。
- `FakeFacilitator.sign(self.secret, auth)` 用和 facilitator 一样的方法签名。真实世界里这一步是钱包私钥做 EIP-712 签名,私钥绝不能出现在模型的上下文里。

</div>

### 第 5 步:让 Agent 去买

```python
# agent-60-lab/topics/agent_payments/agent_buy.py
import asyncio

import httpx

from topics.agent_payments.paywall import MERCHANT, app, facilitator
from topics.agent_payments.protocol import b64_json, from_b64_json
from topics.agent_payments.wallet import AgentWallet, Mandate

AGENT = "0xSupportPilot"
SECRET = b"demo-only-secret"


async def fetch_paid(client: httpx.AsyncClient, wallet: AgentWallet, url: str) -> httpx.Response:
    r = await client.get(url)
    if r.status_code != 402:
        return r
    required = from_b64_json(r.headers["PAYMENT-REQUIRED"])
    req = required["accepts"][0]
    verdict, why = wallet.decide(url, req)
    print(f"402 要价 {int(req['amount']) / 1e6} USDC → {verdict}({why})")
    if verdict != "pay":
        return r
    payment = wallet.pay(url, required["resource"], req)
    return await client.get(url, headers={"PAYMENT-SIGNATURE": b64_json(payment)})


async def main() -> None:
    facilitator.open_wallet(AGENT, SECRET, balance=1_000_000)  # 1 USDC
    mandate = Mandate(max_per_payment=50_000, daily_budget=100_000,
                      allowed_hosts={"paywall.invalid"}, allowed_pay_to={MERCHANT},
                      confirm_above=30_000)
    wallet = AgentWallet(AGENT, SECRET, mandate)
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://paywall.invalid") as client:
        url = "http://paywall.invalid/api/credit-report/acme"
        r = await fetch_paid(client, wallet, url)
        print(r.status_code, r.json())
        print("结算回执:", from_b64_json(r.headers["PAYMENT-RESPONSE"]))

        required = from_b64_json((await client.get(url)).headers["PAYMENT-REQUIRED"])
        replay = b64_json(wallet.pay(url, required["resource"], required["accepts"][0]))
        first = await client.get(url, headers={"PAYMENT-SIGNATURE": replay})
        again = await client.get(url, headers={"PAYMENT-SIGNATURE": replay})
        print("同一笔付款用两次:", first.status_code, again.status_code, again.json())
    print("Agent 余额:", facilitator.balances[AGENT], "商户余额:", facilitator.balances[MERCHANT])


if __name__ == "__main__":
    asyncio.run(main())
```

<div class="line-notes">

- `SECRET = b"demo-only-secret"` 演示密钥,写死在代码里只是为了能跑。真实钱包的私钥放在密钥管理服务或硬件里,Agent 进程只能请求「签这一笔」,拿不到私钥本身。
- `async def fetch_paid(` 这是给 Agent 用的工具函数:请求、遇到 402 就按授权框判断、能付就付了重发。你可以把它注册成 Day 8 那种工具,模型只需要说「去拿 acme 的信用报告」。
- `if r.status_code != 402:` 不收费的接口直接返回,同一个工具对免费和收费接口都能用。
- `required = from_b64_json(r.headers["PAYMENT-REQUIRED"])` 解出要价。实测内容就是第 1 步那个结构,`amount` 是 `"20000"`。
- `verdict, why = wallet.decide(url, req)` 判断权在代码手里,不在模型手里。
- `print(f"402 要价` 实测这一行打印 `402 要价 0.02 USDC → pay(在授权范围内)`。
- `if verdict != "pay":` `ask_user` 和 `deny` 都先原样返回 402。接到 Day 25 的 `interrupt` 里让人确认,是练习 3。
- `facilitator.open_wallet(AGENT, SECRET, balance=1_000_000)` 给 Agent 开户,1 USDC。
- `mandate = Mandate(` 用户签的授权框:单笔 0.05、每天 0.1、只认 `paywall.invalid` 和 `0xCreditBureau`、超过 0.03 要问人。
- `transport = httpx.ASGITransport(app=app)` 不起真的服务器,httpx 直接把请求交给 FastAPI 应用处理,所以 `base_url` 里的 `paywall.invalid` 不需要解析。`.invalid` 是 RFC 2606 保留的顶级域名,保证永远不会指向一台真机器,演示和测试里用它,万一代码误发了真请求也不会打到别人的服务器上。
- `print(r.status_code, r.json())` 实测打印 `200 {'company': 'acme', 'score': 82, 'overdue_invoices': 1}`。
- `print("结算回执:"` 实测打印 `结算回执: {'success': True, 'payer': '0xSupportPilot', 'transaction': '0xe96159db6d14eb75', 'network': 'eip155:84532', 'amount': '20000'}`,交易号每次不同。
- `replay = b64_json(wallet.pay(` 再签一笔合法的付款,然后故意用两次,模拟付款头被截获重放。
- `print("同一笔付款用两次:"` 实测打印 `同一笔付款用两次: 200 402 {'error': 'payment already used'}`。第一次成功,第二次在 `_claimed` 那一步被拦。
- `print("Agent 余额:"` 实测打印 `Agent 余额: 960000 商户余额: 40000`。一共成功付了两笔,每笔 0.02,重放那次没扣钱。

</div>

在根目录运行:

```bash
uv run python -m topics.agent_payments.agent_buy
```

输出大致长这样(交易号每次不同):

```text
402 要价 0.02 USDC → pay(在授权范围内)
200 {'company': 'acme', 'score': 82, 'overdue_invoices': 1}
结算回执: {'success': True, 'payer': '0xSupportPilot', 'transaction': '0xe96159db6d14eb75', 'network': 'eip155:84532', 'amount': '20000'}
同一笔付款用两次: 200 402 {'error': 'payment already used'}
Agent 余额: 960000 商户余额: 40000
```

### 第 6 步:攻击用例写成测试

```python
# agent-60-lab/topics/agent_payments/test_payments.py
import copy

import httpx
import pytest

from topics.agent_payments.paywall import MERCHANT, app, facilitator
from topics.agent_payments.protocol import b64_json, from_b64_json
from topics.agent_payments.wallet import AgentWallet, Mandate

URL = "http://paywall.invalid/api/credit-report/acme"
pytestmark = pytest.mark.anyio


@pytest.fixture
def anyio_backend() -> str:
    return "asyncio"


def make_wallet(**over: int) -> AgentWallet:
    limits = {"max_per_payment": 50_000, "daily_budget": 100_000, "confirm_above": 30_000}
    limits.update(over)
    facilitator.open_wallet("0xT", b"k", balance=1_000_000)
    mandate = Mandate(allowed_hosts={"paywall.invalid"}, allowed_pay_to={MERCHANT}, **limits)
    return AgentWallet("0xT", b"k", mandate)


def client() -> httpx.AsyncClient:
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://paywall.invalid")


async def test_pay_then_replay_is_rejected() -> None:
    w = make_wallet()
    async with client() as c:
        required = from_b64_json((await c.get(URL)).headers["PAYMENT-REQUIRED"])
        sig = b64_json(w.pay(URL, required["resource"], required["accepts"][0]))
        assert (await c.get(URL, headers={"PAYMENT-SIGNATURE": sig})).status_code == 200
        assert (await c.get(URL, headers={"PAYMENT-SIGNATURE": sig})).status_code == 402


async def test_tampered_amount_is_rejected() -> None:
    w = make_wallet()
    async with client() as c:
        required = from_b64_json((await c.get(URL)).headers["PAYMENT-REQUIRED"])
        cheap = copy.deepcopy(required["accepts"][0])
        cheap["amount"] = "1"  # Agent 自作主张只付 0.000001
        r = await c.get(URL, headers={"PAYMENT-SIGNATURE": b64_json(w.pay(URL, required["resource"], cheap))})
        assert r.status_code == 402
        assert r.json()["error"] == "requirements_mismatch"


async def test_payment_for_other_resource_is_rejected() -> None:
    w = make_wallet()
    async with client() as c:
        required = from_b64_json((await c.get(URL)).headers["PAYMENT-REQUIRED"])
        sig = b64_json(w.pay(URL, required["resource"], required["accepts"][0]))
        r = await c.get("http://paywall.invalid/api/credit-report/other", headers={"PAYMENT-SIGNATURE": sig})
        assert r.status_code == 402


def test_mandate_limits() -> None:
    req = {"amount": "40000", "payTo": MERCHANT, "maxTimeoutSeconds": 60}
    assert make_wallet().decide(URL, req)[0] == "ask_user"
    assert make_wallet(max_per_payment=30_000).decide(URL, req)[0] == "deny"
    assert make_wallet().decide("http://evil.invalid/api", req)[0] == "deny"
    w = make_wallet(confirm_above=100_000)
    w.spent_today = 80_000
    assert w.decide(URL, req) == ("deny", "今天的预算用完了")
```

<div class="line-notes">

- `pytestmark = pytest.mark.anyio` 让这个文件里的 `async def test_` 都由 anyio 插件来跑,练习仓 dev 依赖里已经有 `anyio`。
- `def anyio_backend()` anyio 默认会用 asyncio 和 trio 各跑一遍,这里只用 asyncio,不然会因为没装 trio 报错。
- `def make_wallet(**over: int)` 造一个默认授权框的钱包,`over` 用来覆盖某个上限,比如 `make_wallet(max_per_payment=30_000)`。
- `mandate = Mandate(allowed_hosts=` 把集合参数和整数参数分开传,`**limits` 展开成三个整数关键字参数,类型检查器能看懂。
- `async def test_pay_then_replay_is_rejected()` 同一个签名用两次,第一次 200,第二次 402。
- `cheap["amount"] = "1"` 篡改攻击:签名是钱包用自己的密钥正常签的,只是签的条件和服务端要的不一样。facilitator 在 `payload["accepted"] != req` 那一行拦下,`error` 是 `requirements_mismatch`。
- `async def test_payment_for_other_resource_is_rejected()` 拿给 `acme` 的付款去要 `other` 的报告,在 `resource.url` 比对那一步被拒。
- `def test_mandate_limits()` 授权框的四个分支:超免确认额度要问人、超单笔上限拒、域名不对拒、超日预算拒。

</div>

```bash
uv run pytest -q topics/agent_payments
```

我实测是 `4 passed`。用 basedpyright(standard 档)检查这几个文件,0 个错误。

**练习**

1. **修记账 bug。** 现在 `pay()` 一签名就把钱算进 `spent_today`,如果结算失败(比如余额不足),这笔钱白算了。改成「拿到 200 和 `PAYMENT-RESPONSE` 里 `success: true` 才记账」,并加一个测试:余额只有 0.01 时去买 0.02 的报告,买不到,`spent_today` 仍然是 0。
2. **加 `upto` scheme。** 让收费接口按返回内容的字数收费:402 里给上限 `amount`,结算时只扣实际用量。想清楚钱包的授权框应该按上限算还是按实际算。
3. **接人工确认。** 把 `ask_user` 接到 Day 25 的 LangGraph `interrupt` 上:超过免确认额度时暂停,把「要价、收款方、理由」给人看,人批了才调用 `pay()`。
4. **(选做,需要海外环境)读真的 SDK。** 读 `x402-foundation/x402` 仓库里 Python SDK 的示例,对照我们的 `FakeFacilitator` 列出哪些地方要换:签名方式、facilitator 地址、测试网 USDC。只读不跑也行,国内环境注意前面说的合规限制。

**验收标准**:`agent_buy` 的输出和上面一致(交易号除外);4 个测试全绿;练习 1 新增的测试能证明失败的付款不占预算;能口头说清楚为什么收费方要自己记 `_claimed`,而不是只依赖 facilitator 的 nonce 检查。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| HTTP 402 | Payment Required 状态码,RFC 9110 里一直写着「保留给将来使用」,x402 用它表示「要付费」 |
| x402 | 基于 HTTP 402 的按次付费协议,现由 Linux 基金会下的 x402 Foundation 管理,当前协议版本 v2 |
| facilitator | 替收费方验证和结算付款的服务,提供 `/verify`、`/settle`、`/supported` 三个接口 |
| scheme | x402 的收费方式:`exact` 固定金额、`upto` 设上限按量结算、`batch-settlement` 攒批结算 |
| CAIP-2 | 链的命名格式「命名空间:链 ID」,比如 `eip155:8453` 是 Base 主网 |
| AP2 | Agent Payments Protocol,Google 发起、2026 年 4 月捐给 FIDO 联盟,用签名凭证证明用户授权了这次付款 |
| mandate | AP2 里用户签名的授权凭证,分 Checkout 和 Payment 两类,各有开放和封闭两种 |
| Human Present / Not Present | 付款时用户在场当场确认 / 用户事先授权、Agent 之后自己执行 |
| ACP(Agentic Commerce Protocol) | OpenAI 和 Stripe 的结账协议,注意和 Agent Client Protocol 同名 |
| SPT | Stripe 的 Shared Payment Token,可限额、限次的委托付款令牌,商家拿它扣款但看不到卡号 |
| UCP | Universal Commerce Protocol,Google 和 Shopify 等的商务协议,覆盖目录到售后,付款建在 AP2 上 |
| MPP | Machine Payments Protocol,Stripe 和 Tempo 的机器支付协议,和 x402 同层 |
| APOP | 中国银联的《智能体支付开放协议框架》,含智能体身份、意图、用户身份、支付授权四项能力 |
| 耳语攻击(whisper attack) | 用商品描述里的普通文字带偏购物 Agent,让它生成通过所有协议校验但违背用户意图的购物车 |

## 常见误区

**以为 AP2 和 x402 是二选一。** 一个管授权,一个管结算,AP2 官方就有走 x402 结算的示例。同层竞争的是 ACP 和 UCP、x402 和 MPP。

**以为签名验过了,付款就是用户想要的。** 签名只证明「这个钱包签了这些字」。Agent 被一段商品描述带偏后签出的付款,签名同样完美。用户意图要靠授权框和逐项绑定来守。

**把花钱的判断交给模型。** 模型可以决定要不要买,能不能付、付多少、付给谁必须是确定的代码按用户签的边界来卡,而且这段代码和私钥都不能出现在模型能改的地方。

**收费方先放内容、再异步结算。** 这样体验最快,但重放和链上回滚都会让你白送内容。至少要先原子地占住付款 ID,结算确认后再放。

**照着 2025 年的 x402 视频写代码。** v1 的头是 `X-PAYMENT`,v2 改成了 `PAYMENT-SIGNATURE`,网络名也从 `base-sepolia` 改成了 `eip155:84532`。

**以为 ACP 已经成了标准。** ChatGPT 里的 Instant Checkout 2026 年 3 月就收缩了。协议还在,但这一层远没有定局,面试时说「目前在洗牌」比押宝某一个更准确。

**在国内项目里规划稳定币结算。** 境内的监管口径对虚拟货币相关业务非常严格,国内能落地的是银联、支付宝这类建在现有支付体系上的方案,先问法务。

## 学习资料

### 文档与文章

- [x402 v2 规范](https://github.com/x402-foundation/x402/blob/main/specs/x402-specification-v2.md):`PaymentRequired`、`PaymentPayload`、`SettlementResponse` 三个对象和 facilitator 接口的权威定义,对照今天的代码读,40 分钟。
- [x402 仓库](https://github.com/x402-foundation/x402):README 里有三个 HTTP 头的名字、各语言 SDK 和 scheme 列表,`specs/schemes/` 下是每种 scheme 的细节。30 分钟。
- [Linux 基金会 · x402 Foundation 成立公告](https://www.linuxfoundation.org/press/linux-foundation-is-launching-the-x402-foundation-and-welcoming-the-contribution-of-the-x402-protocol):治理变化和成员名单,10 分钟。
- [AP2 官网](https://ap2-protocol.org/):mandate 的分类、用户在场与不在场两种流程、和 A2A、MCP、UCP 的关系。30 分钟。
- [Google · 把 AP2 捐给 FIDO 联盟](https://blog.google/products-and-platforms/platforms/google-pay/agent-payments-protocol-fido-alliance/):v0.2 和 Human Not Present 的来历,10 分钟。
- [AP2 GitHub 仓库](https://github.com/google-agentic-commerce/AP2):示例代码,看 Human Not Present 和 x402 两个示例。按需。
- [ACP 规范仓库](https://github.com/agentic-commerce-protocol/agentic-commerce-protocol):结账接口和委托付款接口的 OpenAPI 定义,按日期分版本。30 分钟。
- [Stripe · Shared Payment Tokens](https://docs.stripe.com/agentic-commerce/concepts/shared-payment-tokens):委托付款令牌的用法和限额,20 分钟。
- [Stripe · Instant Checkout 与 ACP 发布](https://stripe.com/newsroom/news/stripe-openai-instant-checkout):2025 年 9 月的发布稿,10 分钟。
- [Retail Insight Network · OpenAI 把 ChatGPT 购物转向零售商 App](https://www.retail-insight-network.com/newsletters/openai-shifts-chatgpt-shopping-plans-to-retailer-run-apps-report):2026 年 3 月的转向,二手报道,10 分钟。
- [UCP 官网](https://ucp.dev/):能力清单、传输方式、和 AP2 的关系。20 分钟。
- [Google · UCP 发布](https://blog.google/products/ads-commerce/agentic-commerce-ai-tools-protocol-retailers-platforms/):2026 年 1 月的发布稿,10 分钟。
- [Decrypt · Tempo 主网与 MPP](https://decrypt.co/361573/stripe-backed-tempo-network-launches-ai-agent-payments):MPP 的发布报道,10 分钟。
- [新华网 · 银联发布智能体支付开放协议框架](https://www.news.cn/money/20260403/ae7239da365a4e2b89d8db9d7df96795/c.html):APOP 的四项能力,10 分钟。
- [移动支付网 · 支付宝 3 亿笔 AI 付、AI 钱包和 Token Pay](https://m.mpaypass.com.cn/news/202605/26144313.html)和[钛媒体 · 支付的下一场战争在 Agent 里打响](https://www.tmtpost.com/8005970.html):国内进展和「九成来自千问」的数据,20 分钟。
- [新华网 · 八部门发布虚拟货币风险通知](https://www.news.cn/fortune/20260206/b569f51297ce4d6c980c4954922cd7c2/c.html):国内为什么不能照搬稳定币结算,10 分钟。
- [Five Attacks on x402 Agentic Payment Protocol](https://arxiv.org/abs/2605.11781):五种攻击和六条缓解措施,今天练习的防御就是照它做的。1 小时。
- [Whisper Attacks and a Binding Defense for AP2](https://arxiv.org/abs/2609.11757):签名对、决定错的三种攻击和 A-VIP 防御,1 小时。
- [RFC 9110 · 402 Payment Required](https://www.rfc-editor.org/rfc/rfc9110#name-402-payment-required):一句话的「保留」原文,2 分钟。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1mSWmzoEUr&autoplay=0&high_quality=1" title="X402 协议：互联网原生支付新方式" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>登链社区 · X402 协议:互联网原生支付新方式 · 12 分钟。2025 年 10 月录的,讲的是 v1,头名字是 X-PAYMENT。看它讲 402 往返和 facilitator 的部分,头名字和网络名以今天的 v2 为准。</figcaption>
</figure>

- [崔棉大师 · X402 协议实战演示,N8N 工作流集成](https://www.bilibili.com/video/BV1Njs9zBE6t):22 分钟,用 n8n 搭一个付费调用流程,能直观看到钱包、测试币、facilitator 各是什么。同样是 v1。

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/joabA1rwtNc" title="Coinbase’s Erik Reppel on Design Principles of x402" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Questflow · Coinbase 的 Erik Reppel 讲 x402 的设计原则 · x402 作者之一讲为什么要用 HTTP 402、为什么不做账号体系。看他讲设计取舍的部分。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/yLTp3ic2j5c" title="Intro to Google Agent Payments Protocol (AP2)" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Holt Skinner · Intro to Google Agent Payments Protocol (AP2) · AP2 入门讲解,mandate 的名字是 v0.1 的 Intent/Cart/Payment,对照今天的表格看。</figcaption>
</figure>

- [Sam Witteveen · Google's New Universal Commerce Protocol](https://www.youtube.com/watch?v=yDKpF6CjBUo):UCP 发布后的解读,重点看它和 ACP 的对比。
- [Jarrod Watts · x402 Explained, Build a Payment-gated API](https://www.youtube.com/watch?v=Dg5IplJ1mng):动手写一个收费 API,注意版本。

### 书籍

- Carol Coye Benson、Scott Loftesness、Russ Jones《Payments Systems in the U.S.》第 3 版(Glenbrook Partners,2017):讲银行卡、ACH、电汇这些「老支付」是怎么分工、谁担风险的。读卡支付那一章,你会发现 Agent 令牌、发卡方验证这些新词都是在老框架上加了一个角色。只有英文版。

### 开源项目与代码

- [x402-foundation/x402](https://github.com/x402-foundation/x402):官方 SDK,Python 包名 `x402`,TypeScript 在 `@x402/` 下。看 `examples/` 里收费服务端的写法。
- [google-agentic-commerce/AP2](https://github.com/google-agentic-commerce/AP2):AP2 的示例,包括卡和 x402 两种结算。
- [agentic-commerce-protocol](https://github.com/agentic-commerce-protocol/agentic-commerce-protocol):ACP 的 OpenAPI 和 JSON Schema。

## 自测

**1. 用三层模型说明 AP2、ACP、x402 各管什么,哪两个是直接竞争关系。**

<details><summary>答案</summary>

AP2 管授权层,用签名的 mandate 证明用户允许这次付款;ACP 管结账层,定义商家这一侧的结账和委托付款接口;x402 管结算层,用 HTTP 402 加稳定币完成钱的转移。直接竞争的是同层的:结账层的 ACP 和 UCP,结算层的 x402 和 MPP。AP2 和 x402 可以叠用,AP2 官方就有 x402 结算的示例。

</details>

**2. x402 v2 一次付费请求里有哪三个 HTTP 头?分别由谁发、装的是什么?**

<details><summary>答案</summary>

`PAYMENT-REQUIRED` 由服务端随 402 返回,base64 编码的 JSON,`accepts` 里列出收费方式(scheme、network、amount、asset、payTo、maxTimeoutSeconds)。`PAYMENT-SIGNATURE` 由客户端重发时带上,包含原样抄回的 `accepted` 和签名、授权内容。`PAYMENT-RESPONSE` 由服务端在成功时随 200 返回,是结算回执,有 success、payer、transaction、network、amount。v1 的头名字是 `X-PAYMENT` 和 `X-PAYMENT-RESPONSE`。

</details>

**3. facilitator 已经会拒绝用过的 nonce 了,为什么收费接口还要自己记一份「已认领的付款」?**

<details><summary>答案</summary>

facilitator 的 nonce 检查只保证链上只扣一次钱,不保证收费方只放一次内容。如果收费方在结算返回前并发处理了同一笔付款的多个请求,或者先放内容再异步结算,内容就会被给出去多次。所以收费方要在结算之前用加锁或数据库唯一约束原子地占住付款 ID,结算失败再释放。多实例部署时这个占位必须放在共享存储里。

</details>

**4. AP2 里「用户在场」和「用户不在场」的付款有什么区别?为什么后者风险更大?**

<details><summary>答案</summary>

用户在场时,Agent 把定好的购物车给用户看,用户当场签一个封闭的 mandate,确认的是具体商品和金额。用户不在场时,用户事先签一个开放的 mandate,只写目标和约束(比如预算、时间、品类),Agent 之后自己挑商品、自己下单。后者风险更大,因为签名的时候购物车还不存在,Agent 后面的每一步判断都可能被网页内容带偏,而且出错时没有人当场把关。这正是耳语攻击针对的场景。

</details>

**5. 面试题:你要给一个企业采购 Agent 设计付款能力,它每天会调几十个按次收费的数据接口,偶尔要买几千块的软件许可。你会怎么设计?**

<details><summary>答案</summary>

按金额和风险分层。小额高频的数据接口走按次付费(海外可以用 x402 一类,国内按合作的支付机构方案),用户或管理员事先签一个授权框:单笔上限、日预算、收款方和域名白名单、免确认额度,由一段不依赖模型的代码执行判断,私钥放在密钥服务里,Agent 只能请求签名。几千块的许可证走「用户在场」的流程:Agent 准备好报价和购物车,通过 Day 25 那种人工审批让负责人确认,确认的是具体商品和金额,再用卡或企业账户付款。两类都要有完整审计:谁授权、Agent 为什么买、付了什么、回执是什么,而且要对账。还要防注入:商品描述、网页内容只能影响「推荐」,不能绕过授权框。评测上,把重放、篡改金额、诱导换贵货、恶意收费接口这些攻击写进测试集。

</details>

**6. 为什么说国内团队可以学 x402 的设计,但不能照搬它的结算方式?国内对应的方案有哪些?**

<details><summary>答案</summary>

x402 的结算走稳定币,而按 2026 年 2 月八部门的通知,虚拟货币相关业务在境内属于非法金融活动,所以主网稳定币结算不是国内可上线的方案。它的设计思路(按次付费、付款和资源绑定、一次性、先结算后放内容)可以照学。国内对应的方案建在现有支付体系上:银联的 APOP(智能体身份、意图、用户身份、支付授权四项能力),支付宝的 AI 付、AI 钱包和 ACT 协议。它们大多没有公开完整规范,需要走合作伙伴接入。

</details>

## 明天预告

Day 152 讲国内智能体合规:《智能体规范应用与创新发展实施意见》、7 月 15 日起施行的《人工智能拟人化互动服务管理暂行办法》、GB/Z 185 智能体互联系列国家标准和 AI 内容标识。今天写的「授权框」明天会换一个角度再出现一次:实施意见要求厘清「仅限用户本人决策、需由用户授权决策、智能体自主决策」的边界,我们会把 SupportPilot 的每个工具分进这三类,写成一个能审计的决策策略。专题篇可以跳着读,不想看合规也可以直接挑别的专题。
