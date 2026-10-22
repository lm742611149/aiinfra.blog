---
title: 'Day 149 · Agent 的身份与代理授权:On-Behalf-Of、工作负载身份与新草案'
description: 'Agent 替用户调接口时,到底是谁在授权?用 RFC 8693 令牌交换和 act 声明表达「谁通过谁」,用 SPIFFE 式的工作负载身份让 Agent 自己有身份,用受众、scope、authorization_details 和几分钟的有效期把令牌收窄到只够干一件事;再看 MCP 的企业托管授权、ID-JAG,以及 IETF 里 AIMS、AAuth 这些还在写的草案。最后在本机跑一遍完整的代理授权流程。'
pubDate: 2026-10-22
regime: none
tags: ['oauth', 'agent-identity', 'token-exchange', 'spiffe', 'authorization', 'mcp', 'agent-60']
series: 'agent-60'
day: 149
lang: 'zh'
---

## 今天要解决的问题

这是专题篇的一课,**建议在 [Day 84 · MCP 网关与鉴权](/blog/agent-60/day-84-mcp-gateway-auth/) 之后读**。Day 84 讲了远程 MCP server 的 OAuth 流程、为什么禁止令牌透传,还在网关的授权函数里留了一个 `on_behalf_of` 的口子,当时只说了一句「网关用自己的身份调下游,同时把代表谁传过去」。今天把这个口子展开讲透。

场景还是 CloudLedger。星河餐饮的刘伟(客户 C001)在自助客服里说「上个月重复扣了我 98 块,帮我退一下」。SupportPilot 的退款 Agent 要去调账单服务的 `request_refund`。账单服务收到这个请求时,需要回答四个问题:

1. 调我的这个程序是谁?是我们自己部署的退款 Agent,还是一个拿到了某张令牌的陌生脚本?
2. 它代表谁?刘伟本人,还是某个客服坐席,还是没有人(后台任务)?
3. 这一次它被允许做什么?只能给这张发票申请这个金额,还是能动刘伟名下所有的发票?
4. 如果金额大,谁点过头?在哪里点的?

很多团队上线第一个 Agent 时,这四个问题一个都答不上来:Agent 用一个共享的服务账号,权限是「账单服务全部」;或者干脆把用户登录拿到的令牌原样转给下游。今天结束时你应该能:

1. 说清 Agent 场景下三方的关系(用户、Agent、资源),以及代理(delegation)和冒充(impersonation)的区别。
2. 用 RFC 8693 令牌交换签发一张带 `act` 声明的令牌,讲清楚每个字段在防什么。
3. 给 Agent 设计一个工作负载身份,让它向授权服务器证明「我是退款 Agent」时不需要任何写在配置里的长期密钥。
4. 用受众、scope、`authorization_details` 和几分钟的有效期,把令牌收窄到只够干这一件事;知道大额操作怎么让用户在另一个设备上确认。
5. 知道 2026 年 10 月这块的标准地图:哪些已经是 RFC,哪些在工作组里,哪些只是个人草案。

预计用时 4 到 5 小时。前置:Day 40(权限与人工确认)、Day 84(MCP 授权流程)。会用 Python 读写 JWT 即可,不需要搭真实的 IdP。

## 四种常见的错误做法

先看一下现在线上最常见的四种写法,每一种都踩在上面某个问题上。

**共享服务账号。** 给 Agent 配一个 `svc-supportpilot` 账号,权限开到「账单服务读写」。账单服务只能看到「svc-supportpilot 调了 request_refund」,不知道背后是哪个客户。哪天 Agent 被 prompt injection 骗去给别人的发票提退款,账单服务没有任何依据拦它,因为这个账号本来就能动所有发票。审计时也追不到人。

**透传用户令牌。** 刘伟登录客服页面时拿到一张令牌,Agent 把它原样带去调账单服务。这就是 Day 84 讲的令牌透传。账单服务如果校验受众,这张令牌受众是 SupportPilot,应该被拒;如果不校验,任何拿到这张令牌的程序都能直接调账单服务,Agent 这一层的管控形同虚设。下游也分不清「刘伟自己调的」和「Agent 替刘伟调的」。

**长期 API key 写在环境变量里。** 这是 Day 23 我们自己写过的东西,本地开发没问题。放到生产上,key 不过期、不绑定调用者、泄露了也不知道,轮换要手工改配置重启。IETF 新草案 AIMS 里直接写了一句「Static API keys are an antipattern for agent identity」。

**让模型看见凭证。** 把 token 拼进 system prompt,或者让模型自己决定在请求头里填什么。模型的上下文会被记日志、会被注入攻击读出来(Day 39),凭证进了上下文就等于进了日志。同一份草案的要求是「The Large Language Model MUST NOT have access to an agent's credentials」。凭证只能活在 harness 的代码里,模型只说「我要调 request_refund,参数是这些」。

这四种写法的共同问题,是把「Agent 是谁」和「Agent 代表谁」揉成了一个身份。正确的做法是两个身份都要有,而且都要出现在下游收到的那张令牌里。

## Agent 自己是谁:工作负载身份

先解决第一个问题。Agent 是一个跑在你们集群里的程序,和一个微服务没有本质区别。微服务之间怎么证明身份,Agent 就怎么证明。

云原生领域这几年的答案是**工作负载身份**(workload identity):不给程序发密码,而是由平台在程序启动时,根据它「是谁部署的、跑在哪个命名空间、用哪个服务账号」给它签一份短期凭证,过期前自动轮换。最有代表性的是 CNCF 的 **SPIFFE** 标准和它的实现 SPIRE。一个 SPIFFE ID 长这样:

```text
spiffe://cloudledger.example/agent/supportpilot-refund
```

前面是信任域(trust domain,一般是公司或环境),后面是路径,由你自己约定命名规则。平台给这个身份签发的凭证叫 SVID,有两种形态:X.509 证书(用来做 mTLS)和 JWT(用来放在请求里)。两种都是短期的,常见的有效期是一小时以内。

为什么这比 API key 好?关键是**凭证从来不落在配置里**。退款 Agent 的 Pod 启动后,通过本地的 workload API 拿到自己的 SVID,内存里用,过期前续。没有一个文件里写着能被人拷走的长期密钥,也就不存在「离职员工手里还有一份 key」的问题。授权服务器认的是 SPIFFE ID,ID 背后是平台的部署记录,谁能用这个身份,由谁能在那个命名空间部署来决定。

IETF 有一个专门做这件事的工作组叫 **WIMSE**(Workload Identity in Multi-System Environments),它的架构文档 draft-ietf-wimse-arch 在 2026 年 7 月出了第 08 版。今年 9 月 15 日,一份专门讲 Agent 身份的文档被这个工作组采纳,改名 **draft-ietf-wimse-aims-00**(AI Identity Management System,前身是个人草案 draft-klrc-aiagent-auth,作者来自 Defakto、AWS、Zscaler、Ping Identity、OpenAI 和 Okta)。它的基本立场是:**Agent 就是一种工作负载**,不需要发明新协议,用 WIMSE 的身份加上 OAuth 的委托就够了。几条硬性要求值得记下来:

- 每个 Agent 必须有且只有一个 WIMSE 标识符,可以用 SPIFFE ID。
- 凭证必须和标识符有密码学绑定,应当是短期的,必须带过期时间。
- 向授权服务器认证时用工作负载凭证,不用长期的 client secret。
- 模型不能接触凭证;工具不应该把收到的令牌再转发出去。

这份文档的状态是 Informational,意思是「最佳实践汇编」,不是要大家实现的新协议。所以它可以放心拿来当设计评审的检查清单。

## 代表谁:令牌交换与 act 声明

第二个问题是「代表谁」。OAuth 2.0 从一开始就是为「代表用户」设计的:用户授权,客户端拿到令牌去调资源。但普通的授权码流程里,令牌只有一个主角 `sub`(用户),客户端是谁只体现在 `client_id` 里,而且没有「这个客户端又转手交给了谁」的表达方式。

Agent 场景需要的是一条链:刘伟 → SupportPilot 前端 → 退款 Agent → 账单服务。2020 年发布的 **RFC 8693 OAuth 2.0 Token Exchange** 正好覆盖这件事。它定义了一个新的授权类型 `urn:ietf:params:oauth:grant-type:token-exchange`,请求里放两张令牌:

- `subject_token`:代表「为谁办事」,这里是刘伟登录后拿到的令牌。
- `actor_token`:代表「谁在办事」,这里是退款 Agent 用自己的工作负载身份签的一张短令牌。

授权服务器两张都验过,再查自己的策略(这个 Agent 能不能代表用户拿这个下游的令牌),通过后签一张新令牌。新令牌的 `sub` 还是刘伟,但多了一个 `act`(actor)声明:

```json
{
  "sub": "C001",
  "aud": "https://billing.cloudledger.example",
  "scope": "refunds:request",
  "act": { "sub": "spiffe://cloudledger.example/agent/supportpilot-refund" }
}
```

账单服务读到这张令牌,就同时知道了「为谁」和「谁在办」。`act` 还可以嵌套:如果退款 Agent 又把活派给了一个子 Agent,子 Agent 再做一次交换,新令牌里就是 `act: {sub: 子Agent, act: {sub: 退款Agent}}`,一层层记下来。RFC 8693 规定最外层是当前的执行者,内层只是历史,做授权判断时只看最外层,内层用来审计。

这里要分清两个概念,面试很喜欢问:

- **代理(delegation)**:新令牌里能看出「A 代表 B」,`sub` 是 B,`act` 是 A。下游可以按「B 的权限 ∩ A 被允许的范围」来判断。Agent 场景应该用这种。
- **冒充(impersonation)**:新令牌里只有 B,看不出 A 的存在。下游以为是 B 本人在操作。有些老系统只认这种,但对 Agent 来说它把最重要的信息丢掉了:出事后你分不清是用户自己点的,还是 Agent 被骗了去点的。

RFC 8693 还定义了一个 `may_act` 声明,放在用户的令牌里,意思是「这张令牌允许被谁拿去交换」。比如刘伟的令牌里写上 `may_act: {sub: 退款Agent}`,别的 Agent 拿着这张令牌去交换就会被拒。它把「用户授权了哪个 Agent」写进了令牌本身。

<figure>
<svg viewBox="0 0 640 330" role="img" aria-label="代理授权的令牌流:用户登录拿到令牌,退款 Agent 用用户令牌加自己的工作负载凭证向授权服务器做令牌交换,拿到受众是账单服务、带 act 声明、只够退一张发票的短令牌,账单服务校验后写审计">
  <rect x="0" y="0" width="640" height="330" fill="var(--paper-raised)"/>
  <g font-family="var(--font-mono)" font-size="11">
    <rect x="16" y="20" width="120" height="44" rx="4" fill="var(--paper-raised)" stroke="var(--ink-faint)"/>
    <text x="76" y="38" text-anchor="middle" fill="var(--ink)">刘伟 C001</text>
    <text x="76" y="54" text-anchor="middle" fill="var(--ink-soft)">在客服页登录</text>
    <rect x="16" y="140" width="120" height="58" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
    <text x="76" y="160" text-anchor="middle" fill="var(--ink)">退款 Agent</text>
    <text x="76" y="176" text-anchor="middle" fill="var(--ink-soft)">SPIFFE ID</text>
    <text x="76" y="190" text-anchor="middle" fill="var(--ink-soft)">短期 SVID</text>
    <rect x="260" y="20" width="140" height="44" rx="4" fill="var(--paper-raised)" stroke="var(--ink-faint)"/>
    <text x="330" y="38" text-anchor="middle" fill="var(--ink)">授权服务器</text>
    <text x="330" y="54" text-anchor="middle" fill="var(--ink-soft)">RFC 8693 交换</text>
    <rect x="490" y="140" width="134" height="58" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
    <text x="557" y="160" text-anchor="middle" fill="var(--ink)">账单服务</text>
    <text x="557" y="176" text-anchor="middle" fill="var(--ink-soft)">只认 aud=自己</text>
    <text x="557" y="190" text-anchor="middle" fill="var(--ink-soft)">写审计</text>
  </g>
  <g font-family="var(--font-mono)" font-size="11" fill="var(--ink)">
    <line x1="76" y1="64" x2="76" y2="140" stroke="var(--ink-faint)"/>
    <text x="84" y="100">① 用户令牌</text>
    <text x="84" y="116" fill="var(--ink-soft)">aud=supportpilot</text>
    <line x1="136" y1="150" x2="270" y2="64" stroke="var(--mem)" stroke-width="1.4"/>
    <text x="150" y="120">② subject_token</text>
    <text x="150" y="134">+ actor_token</text>
    <line x1="350" y1="64" x2="500" y2="140" stroke="var(--ink-faint)" stroke-dasharray="4 3"/>
    <text x="420" y="92">③ 新令牌 5 分钟</text>
    <line x1="136" y1="176" x2="490" y2="176" stroke="var(--compute)" stroke-width="1.4"/>
    <text x="250" y="170">④ Bearer 新令牌调 request_refund</text>
  </g>
  <rect x="150" y="214" width="340" height="104" rx="4" fill="var(--paper-raised)" stroke="var(--rule)"/>
  <g font-family="var(--font-mono)" font-size="11">
    <text x="162" y="234" fill="var(--ink)">sub: C001          为谁办事</text>
    <text x="162" y="252" fill="var(--mem)">act.sub: …/supportpilot-refund   谁在办</text>
    <text x="162" y="270" fill="var(--ink)">aud: billing       只能给账单服务用</text>
    <text x="162" y="288" fill="var(--ink)">scope: refunds:request</text>
    <text x="162" y="306" fill="var(--compute)">authorization_details: INV-0001 ≤ 9800 分</text>
  </g>
</svg>
<figcaption>一次代理授权的令牌流。下游收到的令牌同时写着「为谁」和「谁在办」,受众、scope 和 authorization_details 把它收窄到只够给一张发票提一笔退款。今天的练习就是把这四步在本机跑一遍。</figcaption>
</figure>

## 只够干这一件事:把令牌收窄

有了「谁」和「代表谁」,第三个问题是范围。Agent 的令牌要遵守的原则和 Day 40 的工具权限一样:最小权限,而且要比给人的权限更小,因为 Agent 会被骗。

收窄有五个旋钮,从粗到细:

**受众(aud)。** 令牌只给一个下游用。RFC 8707 的 `resource` 参数让客户端在申请时指明下游,授权服务器把它写进 `aud`,下游必须校验。这一条挡住了令牌被挪用:账单服务的令牌拿去调 CRM 会被拒。

**scope。** 粗粒度的动作类别,比如 `invoices:read`、`refunds:request`。授权服务器签发时取三者的交集:Agent 申请的、策略允许这个 Agent 拿的、用户本人有的。三者缺一不可,尤其别漏了最后一个:用户自己没有的权限,Agent 代表他也不能有。

**authorization_details。** scope 说的是「能申请退款」,但说不出「只能给 INV-2026-0001 申请,最多 98 块」。RFC 9396(Rich Authorization Requests,RAR)定义了一个 JSON 数组字段 `authorization_details`,每一项有个 `type`,其余字段由你们自己定义。支付行业早就在用它表达「转账给某人、某个金额」,Agent 场景用它表达「这一次允许的具体动作」非常合适。下游拿到令牌后逐项核对,超出范围就拒绝。

**有效期。** Agent 的令牌应该以分钟计。用户的登录令牌可能是一小时,Agent 为一次任务交换出来的令牌五分钟足够。任务没做完就再交换一次,每次交换授权服务器都会重新查策略,用户中途撤销了授权,下一次交换就拿不到了。

**绑定持有者。** 前面四条都还是 bearer 令牌:谁拿到谁能用。想让令牌被偷了也没用,要做持有证明(proof of possession),比如 RFC 9449 的 DPoP,或者 mTLS 绑定证书。令牌里记着一个公钥指纹,调用时必须用对应私钥签名。AIMS 草案也提到,应用层的签名方案要考虑重放风险,配合短有效期和受众限制一起用。

微服务很多的系统里还有一个问题:账单服务内部还要调发票服务、支付服务,难道把这张令牌一路往下传?OAuth 工作组的 **Transaction Tokens** 草案(draft-ietf-oauth-transaction-tokens,10 月时是第 11 版,状态是工作组已达成共识、等待提交)专门解决这个:入口处把外部令牌换成一张只在本次调用链里有效、绑定这笔事务的内部令牌,内部服务之间传它,不再传原始的访问令牌。

## 人在哪里点头

第四个问题是确认。Day 25 和 Day 46 已经有了一个确认环节:退款申请写进 `refund_requests` 表是 `pending_approval` 状态,要主管在审批界面点了才执行。今天要加的是另一种确认,两者很容易混:

- **授权同意**:刘伟本人同意「让这个 Agent 替我申请这笔退款」。这是身份和授权层的事,决定 Agent 能不能拿到令牌。
- **业务审批**:CloudLedger 的主管同意「这笔退款可以退」。这是业务流程的事,决定钱最后退不退。

小额的退款,用户在聊天框里说「帮我退」就可以视为同意,授权服务器直接签发。大额的(练习里设成 500 元),授权服务器不应该相信「Agent 说用户同意了」,而是要自己去找用户确认。

OpenID 有一个现成的规范叫 **CIBA**(Client-Initiated Backchannel Authentication):客户端发起请求后,授权服务器通过另一条通道(手机推送、短信、App 内通知)去问用户,客户端拿着一个 `auth_req_id` 轮询,用户没点之前一直返回 `authorization_pending`,点了之后才拿到令牌。它原本是给呼叫中心、POS 机这类「操作的人和被代表的人不在同一个设备上」的场景设计的,和 Agent 的情况一模一样。

AIMS 草案在「人在回路」一节里提到了 CIBA,同时说它并不完全适合「任务执行到一半才需要确认」的场景,这块还是缺口。但它说得很明确的一条是:**Agent 不能把本地界面上的确认当作充分的授权**(MUST NOT treat local UI confirmation alone as sufficient authorization)。原因很直白:聊天界面是 Agent 自己渲染的,被注入攻击控制的 Agent 可以伪造一个「用户已确认」。确认必须发生在授权服务器能信任的通道上。

## 企业里的一键接入:MCP 的企业托管授权

上面讲的是你自己的服务之间怎么做。还有一类常见情况:公司员工在 Claude、VS Code 或者自研的 Agent 里接 Atlassian、Linear、Figma 这些第三方的 MCP server。按 Day 84 的标准流程,每接一个 server 都要弹一次 OAuth 同意页,员工点烦了,安全团队也没法统一管「谁能接哪个」。

2026 年 6 月 18 日,MCP 官方博客宣布 **Enterprise-Managed Authorization**(扩展标识 `io.modelcontextprotocol/enterprise-managed-authorization`)进入 stable。做法是:管理员在公司 IdP 里配置「哪些组的人可以用哪个 MCP server」,员工用 SSO 登录客户端时,客户端从 IdP 拿到一张特殊的断言 **ID-JAG**(Identity Assertion JWT Authorization Grant),再拿它去 MCP server 的授权服务器换访问令牌,中间不弹逐个 server 的同意页。Okta 是第一个支持的 IdP(它的产品名叫 Cross App Access,XAA);客户端侧 Anthropic 在 Claude、Claude Code、Cowork 里实现了,VS Code 是预览;server 侧有 Asana、Atlassian、Canva、Figma、Granola、Linear、Supabase。

ID-JAG 本身在 IETF OAuth 工作组里推进,文档是 draft-ietf-oauth-identity-assertion-authz-grant,10 月时是第 04 版,还是工作组草案。它底层用的就是今天讲的 RFC 8693 令牌交换。

对 Agent 工程师来说,这件事的意义是:**企业客户买你的 Agent 产品时,会问你支不支持他们的 IdP 统一管控**。如果你在做 MCP server,支持这个扩展意味着企业管理员能一键给全公司开通;如果你在做 Agent 客户端,支持它意味着能进企业的采购清单。

## 还在写的标准:2026 年 10 月的地图

这一块变化非常快,下面这张表是我 2026 年 10 月 22 日在 IETF datatracker 上逐个查的。表里「RFC」是正式标准,「工作组草案」表示已被某个工作组采纳、大概率会成为标准但细节还会改,「个人草案」表示只是作者自己提交的提案。

| 文档 | 管什么 | 状态(2026-10 查) |
| --- | --- | --- |
| RFC 8693 Token Exchange | 令牌交换、act / may_act 声明 | RFC(2020) |
| RFC 8707 Resource Indicators | resource 参数、受众 | RFC(2020) |
| RFC 9396 Rich Authorization Requests | authorization_details | RFC(2023) |
| RFC 9449 DPoP | 令牌绑定持有者私钥 | RFC(2023) |
| draft-ietf-oauth-identity-chaining | 跨信任域的身份和授权串联 | 第 17 版,已进 RFC Editor 队列 |
| draft-ietf-oauth-transaction-tokens | 调用链内部的事务令牌 | 第 11 版,工作组共识,等待提交 |
| draft-ietf-oauth-identity-assertion-authz-grant | ID-JAG,MCP 企业托管授权的底层 | 第 04 版,工作组草案 |
| draft-ietf-wimse-arch | 工作负载身份架构 | 第 08 版,工作组草案 |
| draft-ietf-wimse-aims | Agent 身份与授权的最佳实践 | 第 00 版(2026-09-15),工作组草案,前身 draft-klrc-aiagent-auth |
| draft-hardt-oauth-aauth-protocol | AAuth,基于请求签名的 Agent 授权协议 | 第 11 版(2026-09-25),个人草案 |
| draft-oauth-ai-agents-on-behalf-of-user | 给授权请求加 requested_actor / actor_token 参数 | 第 02 版,已过期 |

几个读法上的提醒。

**AIMS 和 AAuth 是两种思路。** AIMS 的态度是「现有标准够用了,告诉大家怎么组合」;AAuth(作者 Dick Hardt,OAuth 2.0 的编辑之一)认为 bearer 令牌这一套对 Agent 不够好,提出每个 Agent 有自己的密钥、每个请求都用 HTTP 消息签名(RFC 9421),没有任何凭证是 bearer 令牌,也不需要预先注册,另外引入了代表用户的「person server」等角色。AAuth 迭代很快(从 4 月到 9 月改了好几版,文档名也换过一次),但目前没有被工作组采纳。我的建议是:生产系统按 AIMS 的组合方式做,AAuth 当作理解「下一代可能长什么样」的读物。

**「On-Behalf-Of」这个词有好几个含义。** 微软 Entra 有一个叫 OBO 的流程,本质上就是令牌交换的一个厂商变体;上表最后那份个人草案也叫 on-behalf-of,但已经过期没人更新。面试时说「我们用 RFC 8693 做代理,令牌里带 act 声明」,比说「我们用 OBO」清楚得多。

**草案的版本号会让你的文章很快过时。** 我写这篇时 AIMS 是 -00,你读到的时候可能已经 -02 了。看草案时先上 datatracker 看最新版本和状态,别照着网上的二手解读写代码。

## 审计:一条记录要能回答「谁通过谁」

Day 84 的哈希链审计日志记录了「谁、调了哪个工具、允许还是拒绝」。有了代理授权以后,每条记录至少要多两列:`user`(令牌的 `sub`)和 `agent`(令牌的 `act.sub`,嵌套的话记整条链)。

这两列能回答很多以前答不了的问题。比如「过去一周刘伟名下的所有退款申请,哪些是他本人在网页上点的,哪些是 Agent 提的」,只要筛 `agent` 是否为空;「这个 Agent 版本上线后,被拒绝的退款请求是不是突然变多了」,按 `agent` 分组看 `deny` 的比例。后面这个还是一个很好的安全告警信号:Agent 被注入攻击时,第一个表现往往是它开始尝试越权,在审计里就是一串 `outside authorization_details` 的拒绝。

被拒绝的请求也必须记,而且要记清楚原因。上线后你会发现,拒绝记录比通过记录更有价值。

## 动手练习

今天在本机跑一遍完整的代理授权:一个授权服务器、一个有工作负载身份的退款 Agent、一个账单服务。不连真实的 IdP,签名用本地生成的 EC 密钥,重点是把每个字段的作用跑出来看。代码放在 `agent-60-lab/topics/agent-identity/`。

**第 1 步:建目录、装依赖。**

```bash
mkdir -p agent-60-lab/topics/agent-identity && cd agent-60-lab/topics/agent-identity
uv init --python 3.12 --no-package
uv add pyjwt cryptography
```

我实跑时装到的是 pyjwt 2.15.1、cryptography 50.0.2。`cryptography` 是 PyJWT 做 ES256 签名需要的。

**第 2 步:写授权服务器、工作负载身份和账单服务。**

```python
# agent-60-lab/topics/agent-identity/authz.py
"""一个能在本机跑的「代理授权」模拟:授权服务器、Agent 的工作负载身份、令牌交换、账单服务的校验。
不连真实 IdP,签名用本地生成的 EC 密钥,目的是把每个字段的作用跑一遍。"""
from __future__ import annotations

import time
import uuid
from dataclasses import dataclass, field

import jwt
from cryptography.hazmat.primitives.asymmetric import ec

AS_ISSUER = "https://auth.cloudledger.example"
AGENT_ID = "spiffe://cloudledger.example/agent/supportpilot-refund"
TOKEN_EXCHANGE = "urn:ietf:params:oauth:grant-type:token-exchange"


def new_key() -> ec.EllipticCurvePrivateKey:
    return ec.generate_private_key(ec.SECP256R1())


class AuthError(Exception):
    pass


@dataclass
class Workload:
    """Agent 的工作负载身份:一个 SPIFFE ID 加一把只有它自己有的私钥。"""
    spiffe_id: str
    key: ec.EllipticCurvePrivateKey = field(default_factory=new_key)

    def actor_token(self, audience: str, ttl: int = 60) -> str:
        now = int(time.time())
        claims = {"iss": self.spiffe_id, "sub": self.spiffe_id, "aud": audience,
                  "iat": now, "exp": now + ttl, "jti": uuid.uuid4().hex}
        return jwt.encode(claims, self.key, algorithm="ES256")


class AuthServer:
    def __init__(self) -> None:
        self.key = new_key()
        self.trusted_workloads: dict[str, ec.EllipticCurvePublicKey] = {}
        # 授权策略:哪个 Agent 可以代表用户拿到哪个下游的哪些 scope
        self.delegation_policy = {
            (AGENT_ID, "https://billing.cloudledger.example"): {"invoices:read", "refunds:request"},
        }
        self.pending: dict[str, dict] = {}

    def trust(self, w: Workload) -> None:
        self.trusted_workloads[w.spiffe_id] = w.key.public_key()

    def _sign(self, claims: dict) -> str:
        return jwt.encode(claims, self.key, algorithm="ES256")

    def login(self, user: str, ttl: int = 3600) -> str:
        """用户在 SupportPilot 前端登录后拿到的令牌,受众是 SupportPilot 自己。"""
        now = int(time.time())
        return self._sign({"iss": AS_ISSUER, "sub": user, "aud": "https://supportpilot.cloudledger.example",
                           "scope": "invoices:read refunds:request profile", "iat": now, "exp": now + ttl})

    def token_exchange(self, subject_token: str, actor_token: str, audience: str,
                       scope: str, authorization_details: list[dict] | None = None,
                       ttl: int = 300, approval_threshold_cents: int = 50_000) -> dict:
        """RFC 8693 令牌交换:用户令牌 + Agent 的身份 → 一张只给某个下游、只够干这件事的新令牌。"""
        user = jwt.decode(subject_token, self.key.public_key(), algorithms=["ES256"],
                          audience="https://supportpilot.cloudledger.example", issuer=AS_ISSUER)
        actor_sub = jwt.decode(actor_token, options={"verify_signature": False})["sub"]
        if actor_sub not in self.trusted_workloads:
            raise AuthError(f"unknown workload {actor_sub}")
        actor = jwt.decode(actor_token, self.trusted_workloads[actor_sub], algorithms=["ES256"],
                           audience=AS_ISSUER)
        allowed = self.delegation_policy.get((actor["sub"], audience), set())
        asked = set(scope.split())
        user_scopes = set(user["scope"].split())
        granted = asked & allowed & user_scopes
        if granted != asked:
            raise AuthError(f"scope not grantable: {sorted(asked - granted)}")
        for d in authorization_details or []:
            if d.get("type") == "refund" and d["max_amount_cents"] > approval_threshold_cents:
                req_id = uuid.uuid4().hex[:8]
                self.pending[req_id] = {"user": user, "actor": actor, "audience": audience,
                                        "scope": scope, "details": authorization_details, "ttl": ttl,
                                        "approved": False}
                return {"error": "authorization_pending", "auth_req_id": req_id}
        return self._issue(user, actor, audience, scope, authorization_details, ttl)

    def approve(self, auth_req_id: str, approver: str) -> None:
        """用户在手机上点了「同意」(CIBA 式的后台确认),这里直接模拟那一下。"""
        req = self.pending[auth_req_id]
        if approver != req["user"]["sub"]:
            raise AuthError("only the user can approve")
        req["approved"] = True

    def poll(self, auth_req_id: str) -> dict:
        req = self.pending[auth_req_id]
        if not req["approved"]:
            return {"error": "authorization_pending", "auth_req_id": auth_req_id}
        del self.pending[auth_req_id]
        return self._issue(req["user"], req["actor"], req["audience"], req["scope"],
                           req["details"], req["ttl"])

    def _issue(self, user: dict, actor: dict, audience: str, scope: str,
               details: list[dict] | None, ttl: int) -> dict:
        now = int(time.time())
        claims = {"iss": AS_ISSUER, "sub": user["sub"], "aud": audience, "scope": scope,
                  "act": {"sub": actor["sub"]}, "client_id": actor["sub"],
                  "iat": now, "exp": now + ttl, "jti": uuid.uuid4().hex}
        if details:
            claims["authorization_details"] = details
        return {"access_token": self._sign(claims),
                "issued_token_type": "urn:ietf:params:oauth:token-type:access_token",
                "token_type": "Bearer", "expires_in": ttl, "scope": scope}


class BillingServer:
    """账单服务:只认受众是自己的令牌,按 scope 和 authorization_details 判断这一次调用。"""
    AUDIENCE = "https://billing.cloudledger.example"

    def __init__(self, as_public_key: ec.EllipticCurvePublicKey) -> None:
        self.as_public_key = as_public_key
        self.audit: list[dict] = []

    def request_refund(self, token: str, invoice_id: str, amount_cents: int) -> str:
        try:
            c = jwt.decode(token, self.as_public_key, algorithms=["ES256"],
                           audience=self.AUDIENCE, issuer=AS_ISSUER)
        except jwt.PyJWTError as e:
            self._log(None, None, invoice_id, "deny", type(e).__name__)
            raise AuthError(type(e).__name__) from e
        who, via = c["sub"], c.get("act", {}).get("sub")
        if "refunds:request" not in c["scope"].split():
            self._log(who, via, invoice_id, "deny", "missing scope refunds:request")
            raise AuthError("insufficient_scope")
        ok = any(d.get("type") == "refund" and d.get("invoice_id") == invoice_id
                 and amount_cents <= d.get("max_amount_cents", 0)
                 for d in c.get("authorization_details", []))
        if not ok:
            self._log(who, via, invoice_id, "deny", "outside authorization_details")
            raise AuthError("insufficient_authorization_details")
        self._log(who, via, invoice_id, "allow", f"{amount_cents} cents")
        return "pending_approval"

    def _log(self, who: str | None, via: str | None, invoice_id: str, decision: str, why: str) -> None:
        self.audit.append({"user": who, "agent": via, "invoice": invoice_id,
                           "decision": decision, "why": why})
```

<div class="line-notes">

- `AGENT_ID = "spiffe://` 退款 Agent 的工作负载身份。真实环境里这个字符串不是写死在代码里的,而是 SPIRE 这类平台根据 Pod 的命名空间和服务账号签发给它的;这里写死是为了在一台机器上跑通。
- `TOKEN_EXCHANGE = ` RFC 8693 定义的授权类型。真实的令牌交换是一个发往授权服务器 `/token` 端点的 HTTP 请求,`grant_type` 填这个值;这里我们直接调 Python 方法,常量留着给你对照规范用。
- `def new_key()` 生成一把 P-256 椭圆曲线私钥,对应 JWT 的 ES256 算法。授权服务器一把、Agent 一把,两边各管各的私钥,对方只拿到公钥。
- `class Workload:` 只有两样东西:身份字符串和私钥。**私钥只在这个对象里,不会出现在任何 prompt 或日志里**,模型永远看不到它。
- `def actor_token(` Agent 用自己的私钥签一张很短的令牌(默认 60 秒),证明「我是 AGENT_ID」。这对应 RFC 8693 里的 `actor_token`。`aud` 设成授权服务器,意思是这张令牌只能拿去给授权服务器看,拿去调账单服务无效。
- `"jti": uuid.uuid4().hex` 每张令牌一个唯一编号。真实系统会记下已经用过的 jti 防重放,练习 3 里你会加上这个检查。
- `self.trusted_workloads` 授权服务器认识的工作负载:SPIFFE ID → 公钥。真实环境里这一步是去 SPIRE 的信任包(trust bundle)里取公钥,不需要逐个登记。
- `self.delegation_policy = {` 授权服务器上最关键的一张表:**哪个 Agent 可以代表用户拿哪个下游的哪些 scope**。这里只有一条,退款 Agent 只能拿账单服务的 `invoices:read` 和 `refunds:request`。CRM 不在表里,所以 demo 的第 4 个场景会被拒。
- `self.pending: dict[str, dict] = {}` 等用户确认的大额请求,键是 `auth_req_id`。
- `def login(` 模拟用户登录。注意令牌的 `aud` 是 SupportPilot 前端自己,不是账单服务:用户登录拿到的令牌本来就不应该能直接调下游。scope 里有三项,其中 `profile` 是 Agent 申请不到也不需要的。
- `def token_exchange(` 整个文件的核心。参数名和 RFC 8693 的请求参数一一对应:`subject_token`、`actor_token`、`audience`、`scope`,外加 RFC 9396 的 `authorization_details`。`ttl=300` 是新令牌五分钟有效,`approval_threshold_cents=50_000` 是 500 元以上要用户另外确认。
- `user = jwt.decode(subject_token,` 先验用户令牌:签名必须是授权服务器自己签的,`aud` 必须是 SupportPilot,`iss` 必须对。任何一条不对 PyJWT 都会抛异常。
- `actor_sub = jwt.decode(actor_token, options={"verify_signature": False})["sub"]` 先**不验签**地读出 actor 自称是谁,用来查该用哪把公钥。这一行读出来的值不能直接信,只用来查表;下面两行才是真正的校验。
- `if actor_sub not in self.trusted_workloads:` 不认识的工作负载直接拒。一个陌生脚本自己生成一把钥匙、自称是退款 Agent,在这里就过不去。
- `actor = jwt.decode(actor_token, self.trusted_workloads[actor_sub]` 用登记的公钥真正验签,并检查 `aud` 是授权服务器。过了这一行,才能确定「调用者确实是退款 Agent」。
- `allowed = self.delegation_policy.get(` 查策略表。demo 场景 1 里 key 是 `(AGENT_ID, "https://billing.cloudledger.example")`,查到 `{"invoices:read", "refunds:request"}`;场景 4 的 audience 是 CRM,查不到,`allowed` 是空集合。
- `granted = asked & allowed & user_scopes` **三者取交集**:Agent 要的、策略允许的、用户本人有的。场景 1:`{"refunds:request"} & {"invoices:read","refunds:request"} & {"invoices:read","refunds:request","profile"}` = `{"refunds:request"}`,和申请的一样,通过。
- `if granted != asked:` 只要有一项拿不到就整体拒绝,而不是悄悄少给。悄悄少给会让 Agent 拿着一张不够用的令牌去调下游再失败,排查时很难看出原因。场景 4 打印的 `scope not grantable: ['refunds:request']` 就是这里抛的。
- `if d.get("type") == "refund" and d["max_amount_cents"] > approval_threshold_cents:` 大额判断。场景 6 申请 60000 分(600 元),超过 50000,不签令牌,改成登记一个待确认请求。
- `return {"error": "authorization_pending", "auth_req_id": req_id}` 返回值的形状模仿 CIBA:客户端拿着 `auth_req_id` 去轮询。实跑时打印的是 `{'error': 'authorization_pending', 'auth_req_id': '3ac3df14'}`,id 每次随机。
- `def approve(` 模拟用户在手机上点了同意。注意它校验了 `approver` 必须是令牌的主人:**只有刘伟本人能同意替刘伟办的事**,Agent 自己调这个方法填别人的名字会被拒。真实系统里这一步发生在授权服务器自己的 App 或推送通道里,Agent 根本碰不到。
- `def poll(` 客户端轮询。用户没点之前一直返回 pending;点了之后签发令牌,并把待确认记录删掉,同一个 `auth_req_id` 不能用两次。
- `def _issue(` 真正签发新令牌。`sub` 是用户,`act` 是 Agent,`aud` 是下游,`exp` 是五分钟后。`client_id` 也填 Agent 的 ID,这是 AIMS 草案建议的写法:访问令牌里 `client_id` 是 Agent,`sub` 是用户。
- `claims["authorization_details"] = details` 把「这一次允许干什么」原样写进令牌,下游据此逐项核对。
- `"issued_token_type": "urn:ietf:params:oauth:token-type:access_token"` RFC 8693 响应里必须带的字段,告诉客户端换出来的是什么类型的令牌。
- `class BillingServer:` 下游资源服务器。它只知道授权服务器的公钥,不认识 Agent 的公钥,也不需要认识:Agent 的身份已经由授权服务器验过并写进了 `act`。
- `c = jwt.decode(token, self.as_public_key, algorithms=["ES256"],` 校验签名、`aud` 必须是账单服务、`iss` 必须是授权服务器、`exp` 没过期。场景 5 把用户的登录令牌直接拿来调,`aud` 是 SupportPilot,PyJWT 抛 `InvalidAudienceError`。
- `except jwt.PyJWTError as e:` 令牌本身不合格的情况也要记审计,这时还不知道是谁,`user` 和 `agent` 都记 `None`。实跑审计第 4 行就是这条。
- `who, via = c["sub"], c.get("act", {}).get("sub")` 把「为谁」和「谁在办」分别取出来,后面每条审计都记这两个字段。
- `if "refunds:request" not in c["scope"].split():` 粗粒度检查:令牌有没有这类动作的权限。
- `ok = any(d.get("type") == "refund" and d.get("invoice_id") == invoice_id` 细粒度检查:令牌里有没有一项正好允许「这张发票、不超过这个金额」。场景 2 换成 INV-2026-0002、场景 3 金额 19800 超过 9800,都在这里被拒,原因是 `outside authorization_details`。
- `return "pending_approval"` 通过了也只是创建申请,和 Day 23、Day 46 一样,钱要等主管审批才退。授权层的同意和业务层的审批是两道独立的门。
- `def _log(` 审计记录里 `user` 和 `agent` 两列是今天新加的。生产上这里写进 Day 84 那个带哈希链的审计日志。

</div>

**第 3 步:跑六个场景。**

```python
# agent-60-lab/topics/agent-identity/demo.py
import json

import jwt

from authz import AGENT_ID, AS_ISSUER, AuthError, AuthServer, BillingServer, Workload

BILLING = "https://billing.cloudledger.example"
CRM = "https://crm.cloudledger.example"

auth = AuthServer()
agent = Workload(AGENT_ID)
auth.trust(agent)
billing = BillingServer(auth.key.public_key())

user_token = auth.login("C001")          # 星河餐饮的刘伟登录了客服工作台


def exchange(max_cents: int, invoice: str = "INV-2026-0001", audience: str = BILLING) -> dict:
    return auth.token_exchange(
        subject_token=user_token,
        actor_token=agent.actor_token(audience=AS_ISSUER),
        audience=audience,
        scope="refunds:request",
        authorization_details=[{"type": "refund", "invoice_id": invoice, "max_amount_cents": max_cents}],
    )


def attempt(label: str, fn) -> None:
    try:
        print(f"{label}: {fn()}")
    except AuthError as e:
        print(f"{label}: DENY {e}")


# 1. 正常:Agent 代表 C001 给 INV-2026-0001 提一笔 98 元的退款申请
t1 = exchange(9800)["access_token"]
print(json.dumps(jwt.decode(t1, options={"verify_signature": False}), ensure_ascii=False, indent=2))
attempt("1 正常申请", lambda: billing.request_refund(t1, "INV-2026-0001", 9800))

# 2. 同一张令牌拿去退另一张发票
attempt("2 换发票", lambda: billing.request_refund(t1, "INV-2026-0002", 9800))

# 3. 金额超过令牌里写的上限
attempt("3 超金额", lambda: billing.request_refund(t1, "INV-2026-0001", 19800))

# 4. 想要 CRM 的令牌:授权策略里没有这条委托
attempt("4 要 CRM 令牌", lambda: exchange(9800, audience=CRM))

# 5. 用户自己的登录令牌直接打账单服务(令牌透传)
attempt("5 透传用户令牌", lambda: billing.request_refund(user_token, "INV-2026-0001", 9800))

# 6. 大额:超过 500 元,授权服务器要求用户在手机上确认
r = exchange(60000)
print("6 大额第一次:", r)
print("6 用户还没点:", auth.poll(r["auth_req_id"]))
auth.approve(r["auth_req_id"], approver="C001")
t6 = auth.poll(r["auth_req_id"])["access_token"]
attempt("6 确认后申请", lambda: billing.request_refund(t6, "INV-2026-0001", 60000))

print("\n审计:")
for row in billing.audit:
    print(row)
```

<div class="line-notes">

- `from authz import` 和 `authz.py` 放在同一个目录,在这个目录下 `uv run python demo.py` 运行即可。
- `auth.trust(agent)` 把 Agent 的公钥登记进授权服务器。真实环境里对应「平台给这个 Pod 签发了 SVID,授权服务器信任这个平台」。
- `billing = BillingServer(auth.key.public_key())` 账单服务只拿到授权服务器的公钥,真实环境里是从授权服务器的 JWKS 地址下载的。
- `user_token = auth.login("C001")` C001 是 seed 数据里的刘伟(星河餐饮),他名下有 INV-2026-0001 到 0005 五张 98 元的发票。
- `def exchange(` 每次需要调下游时都重新交换一张令牌。`actor_token` 每次现签,60 秒有效,拿去给授权服务器看完就作废。
- `t1 = exchange(9800)["access_token"]` 场景 1,申请「INV-2026-0001,最多 9800 分」。下一行把新令牌不验签地解开打印出来,实跑得到的内容是:`sub` 为 `C001`、`aud` 为 `https://billing.cloudledger.example`、`scope` 为 `refunds:request`、`act.sub` 和 `client_id` 都是退款 Agent 的 SPIFFE ID、`exp - iat` 正好 300 秒、`authorization_details` 是 `[{"type": "refund", "invoice_id": "INV-2026-0001", "max_amount_cents": 9800}]`。
- `attempt("1 正常申请"` 实跑输出 `1 正常申请: pending_approval`。
- `attempt("2 换发票"` 同一张令牌,发票换成 0002。实跑输出 `2 换发票: DENY insufficient_authorization_details`。这一条就是 prompt injection 的典型后果:Agent 被骗去动别的发票,令牌本身不允许。
- `attempt("3 超金额"` 金额 19800 超过上限 9800,实跑同样是 `DENY insufficient_authorization_details`。
- `attempt("4 要 CRM 令牌"` 交换阶段就被授权服务器拒了,实跑输出 `4 要 CRM 令牌: DENY scope not grantable: ['refunds:request']`。注意这一次账单服务根本没被调用,所以审计里没有这条,它应该记在授权服务器自己的日志里。
- `attempt("5 透传用户令牌"` 实跑输出 `5 透传用户令牌: DENY InvalidAudienceError`。如果账单服务偷懒不校验 `aud`,这一行就会通过,这就是 Day 84 说的令牌透传漏洞。
- `r = exchange(60000)` 600 元,超过 500 元的门槛。实跑打印 `6 大额第一次: {'error': 'authorization_pending', 'auth_req_id': '3ac3df14'}`,下一行轮询还是 pending。
- `auth.approve(r["auth_req_id"], approver="C001")` 刘伟在手机上点了同意,再轮询就拿到令牌,最后申请成功,输出 `6 确认后申请: pending_approval`。
- `for row in billing.audit:` 实跑一共 5 条:两条 allow(9800 分和 60000 分)、两条 `outside authorization_details` 的 deny,这四条的 `user` 都是 `C001`、`agent` 都是退款 Agent 的 SPIFFE ID;还有一条 `user` 和 `agent` 都是 `None`、原因是 `InvalidAudienceError` 的 deny,来自场景 5。

</div>

运行:

```bash
uv run python demo.py
```

输出大致长这样(时间戳、jti 和 `auth_req_id` 每次不同):

```text
{
  "iss": "https://auth.cloudledger.example",
  "sub": "C001",
  "aud": "https://billing.cloudledger.example",
  "scope": "refunds:request",
  "act": {
    "sub": "spiffe://cloudledger.example/agent/supportpilot-refund"
  },
  "client_id": "spiffe://cloudledger.example/agent/supportpilot-refund",
  ...
  "authorization_details": [
    {"type": "refund", "invoice_id": "INV-2026-0001", "max_amount_cents": 9800}
  ]
}
1 正常申请: pending_approval
2 换发票: DENY insufficient_authorization_details
3 超金额: DENY insufficient_authorization_details
4 要 CRM 令牌: DENY scope not grantable: ['refunds:request']
5 透传用户令牌: DENY InvalidAudienceError
6 大额第一次: {'error': 'authorization_pending', 'auth_req_id': '3ac3df14'}
6 用户还没点: {'error': 'authorization_pending', 'auth_req_id': '3ac3df14'}
6 确认后申请: pending_approval
```

**第 4 步:自己加三个场景。** 每个都先想好预期结果,再写代码验证。

1. **过期。** 把 `token_exchange` 的 `ttl` 改成 1,换出令牌后 `time.sleep(2)` 再调账单服务。预期:`DENY ExpiredSignatureError`,审计里 `user` 为 `None`。
2. **陌生工作负载。** 新建一个 `Workload("spiffe://cloudledger.example/agent/supportpilot-refund")`,不调用 `auth.trust`,用它的 actor_token 去交换。预期:`unknown workload` 不会出现(因为 ID 字符串相同,查得到公钥),而是验签失败抛 `InvalidSignatureError`。想想为什么这比按 ID 字符串判断更安全。
3. **防重放。** 给 `AuthServer` 加一个 `used_jti: set[str]`,同一张 actor_token 第二次拿来交换时拒绝。写一个测试:同一张 actor_token 连续交换两次,第二次失败。

**第 5 步:给 SupportPilot 画一张授权设计图。** 不用写代码,在 `docs/authz-design.md` 里回答下面这些问题,并画一张时序图(可以用 Mermaid):

- SupportPilot 里有几个 Agent(分类、检索、退款……),每个的 SPIFFE ID 怎么命名?
- 每个 Agent 可以代表用户拿哪些下游的哪些 scope?写成和 `delegation_policy` 一样的表。
- 后台批处理的 Agent(比如每天夜里扫描异常扣费的)没有用户,它的令牌 `sub` 填什么?它应该被允许调写操作吗?(提示:回看 Day 84「写操作必须有人类身份」。)
- 客服坐席在工作台上让 Agent 帮客户退款时,`sub` 是客户还是坐席?两种选择各自会让审计和权限出现什么问题?
- 大额确认走什么通道?如果客户没装你们的 App,怎么办?

**验收标准:**

- demo 的 6 个场景输出和上面一致(随机字段除外),审计有 5 条。
- 新增的 3 个场景都按预期失败,有对应的测试用 `uv run pytest` 跑通。
- 设计文档回答了上面 5 个问题,时序图里能看出用户令牌、actor 令牌、交换出的令牌分别在哪一段出现。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 工作负载身份(workload identity) | 由平台根据部署信息签发给程序的短期身份凭证,代替写在配置里的长期密钥 |
| SPIFFE / SPIRE | CNCF 的工作负载身份标准和它的参考实现;身份写成 `spiffe://信任域/路径` |
| SVID | SPIFFE Verifiable Identity Document,SPIFFE 身份的凭证,有 X.509 和 JWT 两种形态 |
| WIMSE | IETF 的 Workload Identity in Multi-System Environments 工作组,定义跨系统的工作负载身份 |
| AIMS | draft-ietf-wimse-aims,讲 Agent 身份与授权怎么用现有标准组合,2026-09 被 WIMSE 工作组采纳 |
| 令牌交换(Token Exchange) | RFC 8693,用一张或两张令牌换一张新令牌,用于代理、收窄、跨服务 |
| subject_token / actor_token | 令牌交换的两个输入,分别代表「为谁办事」和「谁在办事」 |
| act 声明 | 令牌里记录当前执行者的声明,可以嵌套表示多层代理 |
| may_act 声明 | 放在原始令牌里,限定这张令牌可以被谁拿去交换 |
| 代理 vs 冒充 | 代理的令牌里能看出 A 代表 B;冒充的令牌里只有 B,A 消失了 |
| 受众(aud) | 令牌只能给哪个资源服务器用,资源服务器必须校验 |
| authorization_details | RFC 9396 定义的细粒度授权字段,用 JSON 表达「这一次具体允许什么」 |
| DPoP | RFC 9449,把令牌绑定到客户端的私钥,调用时要签名证明持有 |
| CIBA | OpenID 的后台认证规范,授权服务器通过另一个设备找用户确认,客户端轮询结果 |
| Transaction Tokens | OAuth 工作组草案,调用链入口把外部令牌换成只在本次事务内有效的内部令牌 |
| ID-JAG | Identity Assertion JWT Authorization Grant,企业 IdP 签发、用来换第三方访问令牌的断言 |
| Enterprise-Managed Authorization | MCP 的官方扩展,员工 SSO 后由公司 IdP 统一决定能接哪些 MCP server,2026-06 stable |
| AAuth | Dick Hardt 的个人草案,每个请求用 HTTP 消息签名,不用 bearer 令牌 |

## 常见误区

**「Agent 用一个服务账号就行,反正我们在工具层做了权限判断。」** 工具层判断依赖 Agent 告诉你「这是替谁办的」,而 Agent 是会被注入攻击控制的那一方。身份和授权要在 Agent 之外、由授权服务器签发的令牌里表达,下游按令牌判断,才不受 Agent 说了什么的影响。

**「用户令牌转给下游最省事,用户本来就有这个权限。」** 这是令牌透传。下游看不出 Agent 的存在,用户令牌的受众也不是下游。正确的做法是交换出一张受众是下游、带 `act` 的新令牌。

**「scope 写细一点就不需要 authorization_details 了。」** scope 是一个静态的字符串集合,表达不了「这张发票、这个金额」这种每次都不一样的约束。把发票号编进 scope(`refund:INV-2026-0001`)会让 scope 数量爆炸,授权服务器也没法做金额比较。

**「在聊天框里弹个确认按钮,用户点了就算授权。」** 聊天界面是 Agent 渲染的,被控制的 Agent 可以伪造「已确认」。高风险操作的确认要走授权服务器能信任的通道,AIMS 草案对此用的是 MUST NOT。

**「令牌有效期设长一点,省得 Agent 跑长任务时中途失效。」** 长任务应该在需要时重新交换,而不是一开始就拿一张长期令牌。每次交换都是一次重新检查策略和撤销状态的机会。

**「IETF 有 Agent 授权标准了,我们照着实现。」** 2026 年 10 月,专门针对 Agent 的文档要么是 Informational 的最佳实践(AIMS),要么还是个人草案(AAuth)。真正能放心实现的是底下那几份 RFC。看到「某某标准」先去 datatracker 查状态。

## 学习资料

### 文档与文章

- [RFC 8693 OAuth 2.0 Token Exchange](https://www.rfc-editor.org/rfc/rfc8693):重点读第 2 节请求参数和第 4.1 节 `act` 声明,第 4.4 节 `may_act`,30 分钟。
- [RFC 9396 Rich Authorization Requests](https://www.rfc-editor.org/rfc/rfc9396):读第 2 节 `authorization_details` 的结构和例子,20 分钟。
- [RFC 8707 Resource Indicators](https://www.rfc-editor.org/rfc/rfc8707):很短,读一遍就知道 `resource` 参数和受众的关系。
- [RFC 9449 DPoP](https://www.rfc-editor.org/rfc/rfc9449):先读第 1 节动机和第 4 节 DPoP proof 的格式,想做持有证明时再细读。
- [RFC 9700 OAuth 2.0 Security Best Current Practice](https://www.rfc-editor.org/rfc/rfc9700):受众限制、令牌重放这些建议的出处,当作参考手册。
- [draft-ietf-wimse-aims-00](https://www.ietf.org/archive/id/draft-ietf-wimse-aims-00.html):今天最值得通读的一份,第 6–11 节就是一份 Agent 身份设计评审清单,1 小时。最新版本先看 [datatracker 页面](https://datatracker.ietf.org/doc/draft-ietf-wimse-aims/)。
- [draft-hardt-oauth-aauth-protocol](https://datatracker.ietf.org/doc/draft-hardt-oauth-aauth-protocol/) 和作者的 [AAuth 说明仓库](https://github.com/dickhardt/AAuth):了解「不用 bearer 令牌」的另一条路,先看仓库 README,半小时。
- [draft-ietf-oauth-transaction-tokens](https://datatracker.ietf.org/doc/draft-ietf-oauth-transaction-tokens/):微服务内部怎么传授权上下文。
- [draft-ietf-oauth-identity-chaining](https://datatracker.ietf.org/doc/draft-ietf-oauth-identity-chaining/):跨信任域串联,快成 RFC 了。
- [OpenID CIBA Core 1.0](https://openid.net/specs/openid-client-initiated-backchannel-authentication-core-1_0.html):读第 7 节认证请求和第 10 节轮询模式。
- [MCP 博客:Enterprise-Managed Authorization](https://blog.modelcontextprotocol.io/posts/enterprise-managed-auth/) 和 [扩展规范](https://modelcontextprotocol.io/extensions/auth/enterprise-managed-authorization):企业 IdP 统一管控 MCP 接入的做法,20 分钟。
- [draft-ietf-oauth-identity-assertion-authz-grant](https://datatracker.ietf.org/doc/draft-ietf-oauth-identity-assertion-authz-grant/):ID-JAG 的规范原文。
- [MCP 规范 2026-07-28:Authorization](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization) 和 [Security Best Practices](https://modelcontextprotocol.io/specification/2026-07-28/basic/security_best_practices):和 Day 84 对照读,看 MCP 规范里关于令牌透传和受众的要求。
- [SPIFFE 概览](https://spiffe.io/docs/latest/spiffe-about/overview/):SPIFFE ID、SVID、workload API 三个概念,20 分钟。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV195Yfz9Ebw&autoplay=0&high_quality=1" title="OAuth 2.0核心流程、攻击原理和保护机制" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>技术蛋老师 · OAuth 2.0核心流程、攻击原理和保护机制 · 14 分钟。如果你对授权码流程、令牌泄露的攻击方式还不熟,先看这个打底,今天讲的令牌交换都建立在它上面。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1udtJ6yE6S&autoplay=0&high_quality=1" title="极简 AI 安全课：SPIFFE 框架入门" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>赛博老宋 · 极简 AI 安全课:SPIFFE 框架入门 · 7 分钟。从「非人类身份」的角度讲 SPIFFE 和 SPIRE 是什么,适合在读「Agent 自己是谁」那一节之前或之后看。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/EmhRyw6xeT0" title="One Login to Rule Them All: Cross-App Access for MCP — Garrett Galow, WorkOS" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>AI Engineer · One Login to Rule Them All: Cross-App Access for MCP(Garrett Galow, WorkOS)。讲 ID-JAG 和 Cross App Access 怎么让企业员工免逐个同意地接入 MCP server,对应「企业里的一键接入」一节。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/blmAkayzE8M" title="How to Secure Agents using OAuth — Jared Hanson (Keycard, Passport.js)" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>AI Engineer · How to Secure Agents using OAuth(Jared Hanson,Passport.js 作者)。从实现者角度讲 Agent 场景下 OAuth 哪里够用、哪里不够,录得比较早,标准状态以今天的表格为准。</figcaption>
</figure>

### 书籍

- Justin Richer、Antonio Sanso《OAuth 2 in Action》(Manning, 2017):OAuth 讲得最透的一本书,读第 2 章(OAuth 舞蹈)、第 7–10 章(各角色的常见漏洞)、第 11 章(JWT 与令牌内省)。书出得早,没有 Token Exchange 的专章,但今天所有概念的地基都在里面。
- Sudhakar Wilson、Ajay Hingnikar《Solving Identity Management in Modern Applications》第 2 版(Apress, 2023):讲 OAuth 2、OpenID Connect、SAML 在现代应用里怎么配合,企业 IdP 那部分对理解 ID-JAG 有帮助。
- SPIFFE 社区《Solving the Bottom Turtle》([免费在线](https://spiffe.io/book/)):讲为什么要做工作负载身份、SPIFFE 怎么落地,读前三章就够。

### 开源项目与代码

- [spiffe/spire](https://github.com/spiffe/spire):SPIFFE 的参考实现,想在 Kubernetes 上真的给 Agent 发身份就从它的 quickstart 开始。
- [jpadilla/pyjwt](https://github.com/jpadilla/pyjwt):今天练习用的库,看文档里 `decode` 的 `audience`、`issuer`、`leeway` 参数。
- [dickhardt/AAuth](https://github.com/dickhardt/AAuth):AAuth 的说明和演示,里面有和 Keycloak 一起跑的 A2A 多 Agent 演示链接。

## 自测

1. 账单服务收到一张令牌,`sub` 是 C001,没有 `act` 声明。它能推断出什么,推断不出什么?

<details><summary>答案</summary>

能推断出授权服务器认为这次操作是替 C001 做的,受众和 scope 校验过了就能按 C001 的权限执行。推断不出调用者是不是一个 Agent、是哪个 Agent:这张令牌可能是 C001 自己在网页上操作拿到的,也可能是某个 Agent 用冒充方式换来的。出了问题无法区分「用户自己点的」和「Agent 被骗了点的」,审计里也只能记到 C001。

</details>

2. 令牌交换时为什么要对三样东西取交集,而不是只看 Agent 申请了什么?

<details><summary>答案</summary>

三样东西分别是 Agent 申请的、策略允许这个 Agent 拿的、用户本人有的。只看申请会让 Agent 想要什么就给什么;只看策略会让 Agent 拿到用户自己都没有的权限(比如一个普通客户通过 Agent 拿到了管理员才有的 scope);只看用户权限会让任何 Agent 都能代表用户做任何事。三者交集才符合「Agent 的权限不能超过它被允许的,也不能超过它代表的人」。

</details>

3. 退款 Agent 每次调账单服务前都重新做一次令牌交换,有人说这样浪费,不如一开始换一张一小时有效、scope 宽一点的令牌缓存起来。你怎么回应?

<details><summary>答案</summary>

每次交换都是授权服务器重新检查策略、用户授权是否被撤销、金额是否需要确认的机会;一张一小时的宽令牌意味着这一小时内 Agent 被注入攻击控制后能做的事上限很高,而且没法逐次约束到具体发票和金额。交换的成本是一次本地网络请求加一次签名,在 Agent 一次 LLM 调用动辄几秒的延迟面前可以忽略。可以做的优化是在同一个任务、同一组 authorization_details 内复用令牌直到快过期,而不是放宽范围。

</details>

4. 「授权同意」和「业务审批」都是让人点头,为什么要分成两道门?能不能合成一个?

<details><summary>答案</summary>

点头的人不同、回答的问题不同。授权同意由被代表的用户本人做,回答「我允许这个 Agent 替我申请」,发生在身份层,决定 Agent 能不能拿到令牌;业务审批由公司的主管做,回答「这笔退款符合规则可以退」,发生在业务流程里,决定钱最后退不退。合成一个会出现两种问题:要么让主管替用户同意(用户没授权,Agent 也能替他发起),要么让用户的同意直接放款(绕过了公司的风控)。

</details>

5. **资深面试题**:你们的 Agent 产品要卖给一家用 Okta 的大企业,对方安全团队提了三个要求:员工不能逐个点 OAuth 同意;任何 Agent 调用内部系统都要能追溯到具体员工和具体 Agent;Agent 不能持有长期密钥。你怎么设计?

<details><summary>答案</summary>

第一条用 MCP 的 Enterprise-Managed Authorization:员工通过 Okta SSO 登录我们的客户端,客户端拿到 ID-JAG,再去各 MCP server 的授权服务器换访问令牌,对方管理员在 Okta 里按组配置谁能用哪个 server,员工不再逐个同意。第二条让下游令牌同时带用户和 Agent:`sub` 是员工,`act` 或 `client_id` 是我们 Agent 的标识,需要跨服务时用 RFC 8693 令牌交换收窄受众和范围,多层 Agent 用嵌套 act 记录链路;审计日志记 user 和 agent 两列,并对接对方的 SIEM。第三条给每个 Agent 实例发工作负载身份(SPIFFE/SPIRE 或云厂商的托管身份),短期凭证自动轮换,向授权服务器认证时用工作负载凭证而不是 client secret,模型上下文里永远不出现凭证。再补两点:高风险操作走 CIBA 式的带外确认,不信任 Agent 界面上的确认;标准还在演进,ID-JAG 是工作组草案、AIMS 是 Informational,方案里要说明我们跟踪的版本和升级计划。

</details>

6. AIMS 和 AAuth 的出发点有什么不同?如果现在要上线,你选哪条?

<details><summary>答案</summary>

AIMS 认为现有标准够用,把 Agent 当作一种工作负载,用 WIMSE 的身份加 OAuth 的委托、令牌交换、事务令牌组合起来,并给出一份最佳实践清单,本身不定义新协议。AAuth 认为 bearer 令牌对 Agent 不够安全,提出每个 Agent 有自己的密钥、每个请求用 HTTP 消息签名、不需要预注册的新协议。2026 年 10 月 AIMS 已被 WIMSE 工作组采纳,底层依赖的 RFC 都很成熟,上线选 AIMS 的组合方式;想要持有证明可以在 OAuth 体系内加 DPoP 或 mTLS。AAuth 还是个人草案,适合跟踪和做原型,不适合押在生产系统上。

</details>

## 明天预告

Day 150 讲 **WebMCP**:今天解决的是 Agent 在后端调接口时的身份问题,明天换到浏览器里。Day 90 的浏览器 Agent 靠截图和点按钮操作网页,又慢又容易被网页里的文字劫持;WebMCP 让网站自己在页面里注册工具,浏览器里的 Agent 直接调用,还能沿用用户已经登录的会话。我们会给 CloudLedger 的账单页注册几个工具,看清楚它和后端 MCP 的分工。专题篇可以跳着读,不必按顺序。
