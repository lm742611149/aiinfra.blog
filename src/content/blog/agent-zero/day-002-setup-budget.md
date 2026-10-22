---
title: 'Day 2 · 准备工作:要装的软件、要注册的 API、整门课花多少钱'
description: '整门课要装的软件和要注册的账号列成一张表,每样写清哪一天才需要;今天只做三件不用终端的小事。然后学 token 和单价,用 JS 一步步算出整门课的大模型 API 大概花三百到六百元。'
pubDate: 2026-10-22
regime: none
tags: ['setup', 'cost', 'agent-zero']
series: 'agent-zero'
day: 2
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 1](/blog/agent-zero/day-001-salary-honest/) 算的是这个岗位能挣多少:把 `35-65K·16薪` 这种挂牌薪资按「区间中点 × 薪数」折成年包,用中位数而不是平均数看行情,国内 557 条的中位数是 48 万。我们还诚实地说了学完能做到什么、做不到什么。今天反过来,算这门课要你花多少:要装什么、注册什么、调大模型要花多少钱。算钱的方法和昨天很像,也是先定口径,再写几行 JS 算出来。

## 今天要解决的问题

1. 知道整门课要装哪些软件、注册哪些账号,每样东西是干什么的、**哪一天才需要**,今天不该装的不装。
2. 做完今天的三件小事:确认电脑够用、有一个 GitHub 账号、(可选)注册 DeepSeek 开放平台。
3. 弄懂 **token** 和「每百万 token 多少元」这种计价方式,能手算和用 JS 算出一次大模型调用花多少钱。
4. 用一个 JS 小脚本算出整门课的 API 预算,并且知道预算里每个数是怎么假设出来的。

预计用时:1.5 到 2 小时。看清单和做三件小事 40 分钟,学 token 和写预算脚本 1 小时。

前置:[Day 0](/blog/agent-zero/day-000-overview/)(会在 Console 里跑代码)、[Day 1](/blog/agent-zero/day-001-salary-honest/)(数组的 `map`、`reduce`,`toFixed`)。

学法提示:先对照文章逐行敲一遍代码(不复制粘贴)并跑通;第二天合上文章,把 `callCost` 函数和按部分汇总的那个循环默写出来;然后做动手练习,做不出再展开参考答案,看完关掉自己重写一遍。

## 你的电脑够不够

这门课不训练模型,也不在本机跑大模型,所以**不需要显卡**,对电脑的要求和写前端差不多。我写这门课用的是一台 2019 款 13 寸 Intel MacBook Pro,课里所有要实跑的代码都在它上面跑过。

大致的底线是:近五六年内的 Mac、Windows 或 Linux 电脑,内存 8GB 以上(16GB 更舒服,后面同时开编辑器、浏览器、数据库会吃内存),硬盘剩 20GB 以上。

课里的命令按 macOS 写。用 Windows 的同学,终端部分建议装 WSL,它是微软官方提供的、在 Windows 里跑一个 Linux 的功能,装好以后课里的命令基本可以原样用,装法看[微软的 WSL 文档](https://learn.microsoft.com/zh-cn/windows/wsl/install)。Linux 用户直接用就行。

## 整门课要装的东西

先说原则:**用到哪天再装哪天**。很多教程第一天就让你装七八样东西,装完一半用不上,过两个月版本都变了,而且装的时候遇到问题你也不知道它是干什么的,不知道怎么查。所以下面这张表只是让你心里有数,今天一样都不用装。

| 软件 / 账号 | 干什么用 | 前端里的类比 | 哪天装 | 花钱吗 |
| --- | --- | --- | --- | --- |
| 终端(macOS 自带「终端」App) | 敲命令的窗口 | 你跑 `npm run dev` 的那个窗口 | Day 3 开始学,不用装 | 免费 |
| Python 解释器 | 运行 Python 代码 | Node.js | Day 8 前后,那天讲装法 | 免费 |
| 编辑器(Zed 或 VS Code)+ Python 插件 | 写代码、看红线报错 | 你现在写前端用的那个 | Day 9 | 免费 |
| uv | 管 Python 项目和依赖 | npm / pnpm | Day 10 | 免费 |
| git | 版本管理 | 你已经在用的 git | Day 56 系统学 | 免费 |
| GitHub 账号 | 放代码、给面试官看作品 | 同一个 GitHub | 今天注册(没有的话) | 免费 |
| SQLite | 最简单的数据库,一个文件就是一个库 | 浏览器里的 IndexedDB 有点像 | Day 85,macOS 自带 | 免费 |
| Docker 或 OrbStack | 把程序和它的环境打包运行 | 没有直接对应 | Day 100 | 个人免费 |
| DeepSeek 开放平台 | 调大模型的 API | 你调过的任何第三方 API | Day 120 充值(今天可先注册) | 按量付费 |
| 阿里云百炼 | 第二家模型厂商,演示切换 | 同上 | Day 123,可选 | 按量付费 |
| embedding 服务(硅基流动等) | 把文字变成向量,做检索 | 没有直接对应 | Day 217 | 有免费档 |
| Postgres.app | 正式的数据库 | 没有直接对应 | Day 228 | 免费 |
| Langfuse | 记录 Agent 每一步在干什么 | 类似前端的监控平台 | Day 365 | 云版有免费档 |
| 云服务器 | 把项目部署到公网 | 你部署前端用的那台机器 | Day 420 | 按月付费 |
| Claude Code / Cursor 等 | 用 AI 写代码 | 你可能已经在用 | 可选 | 订阅,不计入预算 |

几个说明。

**Python 和 uv 为什么分两天**:Day 8 先让你跑起第一行 Python,感受它和 Node 有什么不一样;Day 10 再上 uv,它相当于 npm,管一个项目要装哪些包。先知道「语言」再知道「包管理器」,和你当初学 Node 的顺序一样。

**终端为什么不用装**:macOS 自带「终端」App,你平时跑 `npm install` 的地方就是它(或者编辑器里内嵌的那个)。Day 3 到 Day 7 会从最基本的 `pwd`、`ls`、`cd` 开始系统学,你可能会发现很多每天在敲的命令其实没真正懂。

**为什么 Day 120 才碰 API**:你现在当然可以去调 DeepSeek,但你还不会 Python,也不懂 HTTP 请求在服务端是怎么被处理的,调通了也只是复制粘贴。等第一部分的地基打完,那一天会从注册、充值、第一次调用、每个报错怎么查一步步讲。

**Docker 在旧 Intel Mac 上**:Docker Desktop 对机器有要求,装不上或者太卡的,Day 100 会给替代方案,比如 OrbStack 或者直接用云服务器。我的 Intel MacBook 就没有装 Docker,这门课里要 Docker 的部分我会写明哪些实跑了、哪些没有。

<figure>
<svg viewBox="0 0 640 210" role="img" aria-label="软件安装时间线:从 Day 3 终端到 Day 420 云服务器,每样东西在用到那天才装">
<rect x="0" y="0" width="640" height="210" fill="var(--paper-raised)" rx="6"/>
<g font-family="var(--font-mono)" font-size="11">
<line x1="30" y1="100" x2="620" y2="100" stroke="var(--rule)" stroke-width="2"/>
<circle cx="40" cy="100" r="5" fill="var(--ink)"/><text x="40" y="84" text-anchor="middle" fill="var(--ink)">Day 2</text><text x="40" y="124" text-anchor="middle" fill="var(--ink-soft)">GitHub</text>
<circle cx="80" cy="100" r="5" fill="var(--rule)"/><text x="80" y="60" text-anchor="middle" fill="var(--ink)">Day 3</text><text x="80" y="72" text-anchor="middle" fill="var(--ink-soft)">终端</text>
<circle cx="120" cy="100" r="5" fill="var(--rule)"/><text x="125" y="124" text-anchor="middle" fill="var(--ink)">Day 8–10</text><text x="125" y="138" text-anchor="middle" fill="var(--ink-soft)">Python 编辑器 uv</text>
<circle cx="190" cy="100" r="5" fill="var(--rule)"/><text x="190" y="60" text-anchor="middle" fill="var(--ink)">Day 56</text><text x="190" y="72" text-anchor="middle" fill="var(--ink-soft)">git</text>
<circle cx="245" cy="100" r="5" fill="var(--rule)"/><text x="245" y="160" text-anchor="middle" fill="var(--ink)">Day 85/100</text><text x="245" y="174" text-anchor="middle" fill="var(--ink-soft)">SQLite Docker</text>
<circle cx="300" cy="100" r="6" fill="var(--mem)"/><text x="300" y="60" text-anchor="middle" fill="var(--ink)">Day 120</text><text x="300" y="72" text-anchor="middle" fill="var(--mem)">DeepSeek 充值</text>
<circle cx="380" cy="100" r="5" fill="var(--rule)"/><text x="380" y="124" text-anchor="middle" fill="var(--ink)">Day 217/228</text><text x="380" y="138" text-anchor="middle" fill="var(--ink-soft)">embedding Postgres</text>
<circle cx="470" cy="100" r="5" fill="var(--rule)"/><text x="470" y="60" text-anchor="middle" fill="var(--ink)">Day 365</text><text x="470" y="72" text-anchor="middle" fill="var(--ink-soft)">Langfuse</text>
<circle cx="570" cy="100" r="6" fill="var(--compute)"/><text x="570" y="124" text-anchor="middle" fill="var(--ink)">Day 420</text><text x="570" y="138" text-anchor="middle" fill="var(--compute)">云服务器</text>
<text x="320" y="200" text-anchor="middle" fill="var(--ink-faint)">横轴不按比例   蓝 = 开始花 API 钱   琥珀 = 开始按月付服务器</text>
</g>
</svg>
<figcaption>整门课的安装时间线。真正开始花钱的只有两个点:Day 120 给模型 API 充值,Day 420 租云服务器。</figcaption>
</figure>

## 今天做的三件小事

这三件都不用终端,十几分钟能做完。

**第一件,看一眼电脑配置。** Mac 点左上角苹果图标 →「关于本机」,记下芯片(Intel 还是 Apple 芯片)、内存、macOS 版本;再到「系统设置 → 通用 → 储存空间」看剩多少硬盘。Windows 在「设置 → 系统 → 系统信息」。把这几个数记在你的学习笔记里,以后装软件时要选对版本,比如 uv、Postgres.app 的下载页都分 Intel 和 Apple 芯片。

**第二件,准备一个 GitHub 账号。** 你大概率已经有了。如果你的 GitHub 账号是公司邮箱注册的,或者里面全是公司代码,建议注册一个**个人账号**,这门课的作品最后要放在上面给面试官看,别和公司的东西混在一起,换工作时也不会丢。注册在 [github.com](https://github.com) 右上角 Sign up,步骤看 [GitHub 官方的中文说明](https://docs.github.com/zh/get-started/start-your-journey/creating-an-account-on-github)。

**第三件(可选),注册 DeepSeek 开放平台。** 打开 [platform.deepseek.com](https://platform.deepseek.com),用手机号登录就行。注意它和聊天用的 chat.deepseek.com 不是一个地方(账号是通用的)。今天**只注册,不充值,不建 API key**,这些 Day 120 会一步步做。先注册的好处是到那天少一个卡点,而且你可以先进去看看「用量信息」「充值」这几个页面长什么样。

另外建议你今天建一个学习笔记,随便用什么工具都行,备忘录、Notion、一个 Markdown 文件都可以。每天记三样东西:今天跑出来的关键输出、踩的坑和真实报错、默写时没写出来的那几行。每 6 天的复习日要用到它。

## token:大模型按什么收钱

现在讲今天的第一个新概念。大模型 API 不按「调用次数」收费,也不按「字数」收费,而是按 **token** 收费。

token 是模型处理文字的最小单位,大致就是「一小块文字」。英文里一个常见单词通常是一个 token,长单词会被切成几块;中文里一个汉字大约是零点几个 token。模型读你的问题时,先把文字切成一串 token;写回答时,也是一个 token 一个 token 地往外写。所以你发过去的文字(**输入 token**)和它写回来的文字(**输出 token**)都要算钱,而且价格不一样,输出贵得多。

DeepSeek 官方文档给的换算是:**1 个中文字符 ≈ 0.6 个 token,1 个英文字符 ≈ 0.3 个 token**,实际以接口返回的用量为准。这个「大约」我实际测了一下。下面这段代码你今天**不用跑**,它要 API key,Day 120 之后才轮到你;我先跑了把数据给你看。我准备了一张 573 个字符的客服工单(就是 Day 0 那个「被扣了两次 299 元」的工单,加上三篇帮助中心文章),发给 DeepSeek,看它报回来多少 token。

```js
// agent-zero-lab/part01/count_tokens.mjs
import fs from 'node:fs';

const ticket = fs.readFileSync('part01/ticket.txt', 'utf8');
const cjk = ticket.match(/[一-鿿]/g).length;
console.log('总字符', ticket.length, '其中汉字', cjk);

const resp = await fetch(process.env.LLM_BASE_URL + '/chat/completions', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    Authorization: 'Bearer ' + process.env.LLM_API_KEY,
  },
  body: JSON.stringify({
    model: process.env.LLM_MODEL,
    messages: [{ role: 'user', content: ticket }],
    thinking: { type: 'disabled' },
  }),
});
const data = await resp.json();
console.log(data.choices[0].message.content);
console.log(data.usage);
```

<div class="line-notes">

- `// agent-zero-lab/part01/count_tokens.mjs` 这段我用 Node 24 跑,命令是 `node --env-file=.env part01/count_tokens.mjs`。这段没有让你跑,原因是要 DeepSeek 的 API key,你 Day 120 才会有。`.mjs` 后缀让 Node 把它当 ES module,才能在最外层直接写 `await`。
- `import fs from 'node:fs';` Node 自带的文件模块,用来读工单文本。浏览器里没有它,所以这段只能在 Node 里跑。
- `const ticket = fs.readFileSync('part01/ticket.txt', 'utf8');` 读出整张工单,一共 573 个字符。
- `const cjk = ticket.match(/[一-鿿]/g).length;` 用正则数汉字。`[一-鿿]` 是常用汉字所在的 Unicode 范围,`g` 是「找出全部」,`match` 返回所有匹配到的字组成的数组,取长度就是个数:445 个。
- `console.log('总字符', ticket.length` 打印 `总字符 573 其中汉字 445`。剩下 128 个是数字、标点、空格、换行和「CloudLedger」这种英文。
- `const resp = await fetch(process.env.LLM_BASE_URL + '/chat/completions', {` 你最熟的 `fetch`,发一个 POST 请求。地址拼出来是 `https://api.deepseek.com/chat/completions`。`process.env` 是 Node 里读环境变量的地方,`--env-file=.env` 会先把 `.env` 文件里的配置读进去,key 就不用写在代码里。
- `Authorization: 'Bearer ' + process.env.LLM_API_KEY,` 鉴权头,和你前端调需要登录的接口时带 token 是一个写法。这里的 token 是「登录凭证」的意思,和今天讲的计费 token 是两回事,只是同名。
- `model: process.env.LLM_MODEL,` 模型名,我 `.env` 里写的是 `deepseek-flash`。
- `messages: [{ role: 'user', content: ticket }],` 要发给模型的对话,只有一条用户消息,内容是整张工单。这个结构 Day 120 之后会细讲。
- `thinking: { type: 'disabled' },` 关掉 DeepSeek 的「思考模式」。开着的话模型会先写一大段内部推理再回答,那段推理也按输出 token 收钱。
- `console.log(data.choices[0].message.content);` 模型写的回复。它把工单分成了「计费」类,并且起草了退款和月付改年付的回复。
- `console.log(data.usage);` 这次的用量:`prompt_tokens: 364`(输入),`completion_tokens: 125`(输出),其中 `prompt_cache_hit_tokens: 128` 是命中缓存的输入,`prompt_cache_miss_tokens: 236` 是没命中的。

</div>

我在 2026-10-22 跑的输出:

```text
总字符 573 其中汉字 445
类别：计费。

您好，非常抱歉给您带来困扰，您反馈的10月3日和10月5日两笔299元扣款，很可能是同一结算周期内因银行返回超时系统重试导致的重复扣款，我们已记录客户编号C023并转交核实，确认后会在3到5个工作日内原路退回多扣金额。关于月付改年付，当前计费周期剩余天数对应金额可按天折算抵扣年付费用（年付享八五折），但已结束的计费周期不退款、不抵扣。感谢您的耐心等待。
{
  prompt_tokens: 364,
  completion_tokens: 125,
  total_tokens: 489,
  prompt_tokens_details: { cached_tokens: 128 },
  prompt_cache_hit_tokens: 128,
  prompt_cache_miss_tokens: 236
}
```

573 个字符变成了 364 个输入 token。按官方的口径估算:445 个汉字 × 0.6 ≈ 267,其余 128 个字符 × 0.3 ≈ 38,合计约 305,实际是 364,比估算多两成。因为发给模型的除了你的文字,还有一点它自己的格式开销,标点和数字的切法也和英文字母不一样。所以 0.6 只能用来**粗估**,做预算时宁可往高了算。

还有一个细节:我同样的内容之前已经发过一次,所以这次有 128 个输入 token「命中缓存」。缓存命中的部分便宜得多,第二部分会专门讲。今天做预算一律**按没命中算**,这是最贵的情况。

## 单价:每百万 token 多少元

第二个新概念是单价。大模型的价格都写成「**元 / 百万 token**」,意思是每处理一百万个 token 收多少钱。我 2026-10-22 在 [DeepSeek 官方价格页](https://api-docs.deepseek.com/zh-cn/quick_start/pricing)上查到的是这样(单位:元 / 百万 token):

| 模型 | 输入(命中缓存) | 输入(未命中) | 输出 |
| --- | --- | --- | --- |
| `deepseek-flash`(这门课默认用) | 高峰 0.04 / 空闲 0.02 | 高峰 2 / 空闲 1 | 高峰 8 / 空闲 4 |
| `deepseek-v4-pro`(更强也更贵) | 高峰 0.30 / 空闲 0.15 | 高峰 9 / 空闲 4.5 | 高峰 27 / 空闲 13.5 |

**高峰时段**是北京时间工作日(不含法定节假日)9:00–12:00 和 14:00–18:00,其余时间都是空闲时段,价格是高峰的一半。也就是说晚上、午休、周末学习,天然就打五折。我上面那次调用是周四 12:15 跑的,刚好在午休,按空闲价算。

一次调用的钱就是:

<figure>
<svg viewBox="0 0 640 170" role="img" aria-label="一次调用的花费等于输入 token 乘输入单价加输出 token 乘输出单价,再除以一百万">
<rect x="0" y="0" width="640" height="170" fill="var(--paper-raised)" rx="6"/>
<g font-family="var(--font-mono)">
<rect x="20" y="40" width="130" height="50" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="85" y="62" text-anchor="middle" font-size="12" fill="var(--ink)">输入 token</text>
<text x="85" y="80" text-anchor="middle" font-size="11" fill="var(--ink-soft)">364</text>
<text x="165" y="70" text-anchor="middle" font-size="14" fill="var(--ink)">×</text>
<rect x="180" y="40" width="100" height="50" rx="6" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="230" y="62" text-anchor="middle" font-size="12" fill="var(--ink)">输入单价</text>
<text x="230" y="80" text-anchor="middle" font-size="11" fill="var(--ink-soft)">2</text>
<text x="300" y="70" text-anchor="middle" font-size="14" fill="var(--ink)">+</text>
<rect x="320" y="40" width="130" height="50" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="385" y="62" text-anchor="middle" font-size="12" fill="var(--ink)">输出 token</text>
<text x="385" y="80" text-anchor="middle" font-size="11" fill="var(--ink-soft)">125</text>
<text x="465" y="70" text-anchor="middle" font-size="14" fill="var(--ink)">×</text>
<rect x="480" y="40" width="100" height="50" rx="6" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="530" y="62" text-anchor="middle" font-size="12" fill="var(--ink)">输出单价</text>
<text x="530" y="80" text-anchor="middle" font-size="11" fill="var(--ink-soft)">8</text>
<line x1="20" y1="110" x2="580" y2="110" stroke="var(--ink-soft)"/>
<text x="300" y="132" text-anchor="middle" font-size="13" fill="var(--ink)">1,000,000</text>
<text x="300" y="158" text-anchor="middle" font-size="11" fill="var(--ink-faint)">= 0.001728 元(高峰价,假设全部未命中缓存)</text>
</g>
</svg>
<figcaption>一次调用的花费公式。单价是「每百万 token」,所以最后一定要除以一百万,漏了这一步结果会大一百万倍。</figcaption>
</figure>

## 动手:一步步算出整门课的预算

回到 Console(`about:blank` 页面里 `Cmd + Option + J`)。

第一步,只算一次调用,用我上面实测的 364 和 125。

```js
// agent-zero-lab/part01/budget1.js
const inputTokens = 364;
const outputTokens = 125;
const inputPrice = 2;  // 元 / 百万 token(高峰,未命中缓存)
const outputPrice = 8; // 元 / 百万 token(高峰)
const cost = inputTokens * inputPrice / 1_000_000 + outputTokens * outputPrice / 1_000_000;
console.log(cost);
console.log(cost.toFixed(6) + ' 元');
```

<div class="line-notes">

- `const inputTokens = 364;` 实测的输入 token 数。
- `const outputTokens = 125;` 实测的输出 token 数。
- `const inputPrice = 2;` 按最贵的情况:高峰价、全部没命中缓存,每百万输入 token 2 元。
- `const outputPrice = 8;` 高峰价,每百万输出 token 8 元。输出是输入的 4 倍贵。
- `const cost = inputTokens * inputPrice / 1_000_000` `1_000_000` 就是一百万,数字里的下划线只是为了好读,JS 会忽略它,和写 `1000000` 一样。输入部分 364 × 2 ÷ 1,000,000 = 0.000728,输出部分 125 × 8 ÷ 1,000,000 = 0.001,加起来 0.001728。
- `console.log(cost);` 打印 `0.001728`。
- `console.log(cost.toFixed(6) + ' 元');` `toFixed(6)` 保留 6 位小数并转成字符串,打印 `0.001728 元`。不到两厘钱。

</div>

```text
0.001728
0.001728 元
```

如果按我实际那次的空闲价、并且算上缓存命中,是 128 × 0.02 + 236 × 1 + 125 × 4 = 738.56,再除以一百万,约 0.00074 元,不到高峰全价的一半。

### 先故意踩一个坑

单价是「每百万 token」,这个「百万」最容易忘。把公式里的 `/ 1_000_000` 去掉,直接拿 token 数乘单价:

```js
// agent-zero-lab/part01/budget_wrong.js
const inputTokens = 364;
const outputTokens = 125;
const cost = inputTokens * 2 + outputTokens * 8;
console.log(cost + ' 元');
```

<div class="line-notes">

- `const cost = inputTokens * 2 + outputTokens * 8;` 364 × 2 + 125 × 8 = 728 + 1000 = 1728。少了除以一百万。
- `console.log(cost + ' 元');` 打印 `1728 元`。一次调用一千七百多块,明显不对。

</div>

```text
1728 元
```

这个错误这么离谱,你可能觉得自己不会犯。但它常常藏在更隐蔽的地方:有的厂商价格页写「每千 token」,有的写「每百万 token」,有的用美元,有的用人民币。换一家厂商时只改了单价没改单位,算出来差一千倍,而且数字看起来还挺「合理」。**每次抄单价,把单位一起抄下来**。

第二步,写成函数,算一天。假设你学到第三部分(写 Agent 循环)时,一天调 60 次,每次输入 3,000 token、输出 400 token。为什么输入这么大:Agent 每一轮都要把之前的对话、工具返回的结果全部重新发给模型,输入会越滚越长,这个第三部分会亲眼看到。

```js
// agent-zero-lab/part01/budget2.js
function callCost(inTok, outTok, peak) {
  const inPrice = peak ? 2 : 1;
  const outPrice = peak ? 8 : 4;
  return inTok * inPrice / 1_000_000 + outTok * outPrice / 1_000_000;
}
const calls = 60;
const perCall = callCost(3000, 400, true);
console.log('一次:', perCall.toFixed(4), '元');
console.log('一天:', (perCall * calls).toFixed(2), '元');
console.log('一天(空闲时段):', (callCost(3000, 400, false) * calls).toFixed(2), '元');
```

<div class="line-notes">

- `function callCost(inTok, outTok, peak) {` 三个参数:输入 token、输出 token、是不是高峰。
- `const inPrice = peak ? 2 : 1;` 三元表达式,高峰 2 元,空闲 1 元。
- `const outPrice = peak ? 8 : 4;` 输出同理。
- `return inTok * inPrice / 1_000_000` 和第一步一样的公式。
- `const calls = 60;` 一天调 60 次。这是我的假设:一天跑十几遍练习代码,每遍 Agent 循环四五轮,每轮一次调用。
- `const perCall = callCost(3000, 400, true);` 3000 × 2 ÷ 1,000,000 + 400 × 8 ÷ 1,000,000 = 0.006 + 0.0032 = 0.0092。
- `console.log('一次:', perCall.toFixed(4), '元');` 打印 `一次: 0.0092 元`。
- `console.log('一天:', (perCall * calls).toFixed(2), '元');` 0.0092 × 60 = 0.552,保留两位打印 `0.55`。
- `console.log('一天(空闲时段):'` 空闲价正好一半,0.276,打印 `0.28`。

</div>

```text
一次: 0.0092 元
一天: 0.55 元
一天(空闲时段): 0.28 元
```

一天五毛多。第三步,把整门课按部分列出来。要花 API 钱的是第二部分到第十一部分(第一部分和第九部分求职基本不调模型,第十二部分是复习)。每部分我按它要干的活,假设了每天调用次数和每次的 token 数:第二部分刚学调用,问题短;第六部分评测要把几十道题反复跑很多遍,调用量最大;毕业项目和作品要反复调试整套流程,也偏高。

```js
// agent-zero-lab/part01/budget3.js
function callCost(inTok, outTok, peak) {
  const inPrice = peak ? 2 : 1;
  const outPrice = peak ? 8 : 4;
  return inTok * inPrice / 1_000_000 + outTok * outPrice / 1_000_000;
}
const parts = [
  { name: '第二部分 大模型与 API', days: 50, calls: 30, inTok: 1000, outTok: 300 },
  { name: '第三部分 工具调用与循环', days: 56, calls: 60, inTok: 3000, outTok: 400 },
  { name: '第四部分 RAG 与上下文', days: 59, calls: 60, inTok: 4000, outTok: 400 },
  { name: '第五部分 MCP 与多 Agent', days: 70, calls: 80, inTok: 4000, outTok: 500 },
  { name: '第六部分 评测与可观测', days: 37, calls: 300, inTok: 3000, outTok: 500 },
  { name: '第七部分 生产化与安全', days: 57, calls: 60, inTok: 3000, outTok: 400 },
  { name: '第八部分 毕业项目', days: 63, calls: 150, inTok: 4000, outTok: 500 },
  { name: '第十部分 进阶', days: 131, calls: 80, inTok: 4000, outTok: 500 },
  { name: '第十一部分 两个作品', days: 53, calls: 150, inTok: 4000, outTok: 500 },
];
let total = 0;
const rows = [];
for (const p of parts) {
  const cost = callCost(p.inTok, p.outTok, true) * p.calls * p.days;
  total += cost;
  rows.push({ 部分: p.name, 天数: p.days, 每天调用: p.calls, 花费元: Number(cost.toFixed(1)) });
}
console.table(rows);
console.log('合计(全按高峰价):', total.toFixed(0), '元');
console.log('合计(全按空闲价):', (total / 2).toFixed(0), '元');
```

<div class="line-notes">

- `function callCost(inTok, outTok, peak) {` 和第二步同一个函数。
- `const parts = [` 每部分一个对象。`days` 是大纲里这部分的天数(包括复习日,复习日其实调得少,所以这里偏高估)。
- `{ name: '第二部分 大模型与 API', days: 50, calls: 30, inTok: 1000, outTok: 300 },` 刚开始学调用,问题短,一天 30 次。一次 0.0044 元,× 30 × 50 = 6.6 元。
- `{ name: '第六部分 评测与可观测', days: 37, calls: 300, inTok: 3000, outTok: 500 },` 评测:一套几十道题,改一次提示词就全跑一遍,一天 300 次。一次 0.01 元,× 300 × 37 = 111 元,是单天最贵的一段。
- `{ name: '第十部分 进阶', days: 131, calls: 80, inTok: 4000, outTok: 500 },` 进阶篇天数最多,131 天,虽然每天调用不算多,总额反而最高:0.012 × 80 × 131 = 125.76。
- `let total = 0;` 累加器,用 `let` 因为后面要改它。
- `const rows = [];` 收集每一行结果,最后用表格打印。
- `const cost = callCost(p.inTok, p.outTok, true) * p.calls * p.days;` 一次的钱 × 每天次数 × 天数,一律按高峰价。
- `total += cost;` 加到总数里。
- `rows.push({ 部分: p.name,` 对象的键可以直接写中文,打印成表格时就是中文表头。`Number(cost.toFixed(1))` 先保留一位小数(得到字符串),再转回数字,表格里就不会带引号。
- `console.table(rows);` 你在前端调试时可能用过,把对象数组打印成表格。Chrome 里是一个可以点表头排序的表格,Node 里是用字符画的框。
- `console.log('合计(全按高峰价):', total.toFixed(0), '元');` 九行加起来约 621.4,保留整数打印 `621`。
- `console.log('合计(全按空闲价):'` 空闲价是一半,`311`。

</div>

我用 Node 跑出来的:

```text
┌─────────┬───────────────────────────┬──────┬──────────┬────────┐
│ (index) │ 部分                      │ 天数 │ 每天调用 │ 花费元 │
├─────────┼───────────────────────────┼──────┼──────────┼────────┤
│ 0       │ '第二部分 大模型与 API'   │ 50   │ 30       │ 6.6    │
│ 1       │ '第三部分 工具调用与循环' │ 56   │ 60       │ 30.9   │
│ 2       │ '第四部分 RAG 与上下文'   │ 59   │ 60       │ 39.6   │
│ 3       │ '第五部分 MCP 与多 Agent' │ 70   │ 80       │ 67.2   │
│ 4       │ '第六部分 评测与可观测'   │ 37   │ 300      │ 111    │
│ 5       │ '第七部分 生产化与安全'   │ 57   │ 60       │ 31.5   │
│ 6       │ '第八部分 毕业项目'       │ 63   │ 150      │ 113.4  │
│ 7       │ '第十部分 进阶'           │ 131  │ 80       │ 125.8  │
│ 8       │ '第十一部分 两个作品'     │ 53   │ 150      │ 95.4   │
└─────────┴───────────────────────────┴──────┴──────────┴────────┘
合计(全按高峰价): 621 元
合计(全按空闲价): 311 元
```

**整门课的模型 API 费用,按偏高的假设算是 300 到 600 元**,分摊在两年多里。这个数有几处偏高、几处偏低,你要知道:

偏高的地方:复习日也算了调用;全部按没命中缓存算,实际上 Agent 反复发同样的开头,缓存命中率不低,命中部分只要几十分之一的价钱;晚上和周末学习走空闲价。

偏低的地方:如果你开着思考模式,模型会多写一大段推理,输出 token 可能翻几倍;如果你在某些练习里换成 `deepseek-v4-pro` 这类更贵的模型,一次的钱是 flash 的 4 倍左右(练习 2 你会算);还有就是代码写出 bug 导致死循环,一个循环跑几百轮,一晚上烧掉几块钱是真实会发生的事,第三部分会教怎么给循环设上限。

我的建议是 Day 120 先充 10 到 20 元,够用好几个月,用完再充。DeepSeek 开放平台的「用量信息」页能按天看到花了多少,每周看一眼。

## 除了 API,还有哪些钱

| 项目 | 什么时候 | 大概多少 | 说明 |
| --- | --- | --- | --- |
| 模型 API | Day 120 起 | 300–600 元(整门课) | 上面算的,我 2026-10-22 查的官方价格 |
| embedding | Day 217 起 | 接近 0 | 旧课 2026-10-12 查过硅基流动的标准版 bge-m3 标的是免费,用到那天再查一次 |
| Langfuse | Day 365 起 | 0 | 我 2026-10-22 查的官网:云版免费档每月 5 万个计量单位、数据保留 30 天、2 个用户;也可以自己部署,免费 |
| 云服务器 | Day 420 起 | 每月几十元 | 旧课 2026-10 查到的二手汇总:海外 VPS 每月 5–10 美元,国内轻量云新用户活动价一年几十到一百多元。到那天再按官网实价选 |
| 租 GPU | 进阶篇,可选 | 一次实验几块钱 | 旧课查到国内按量租卡平台一张 4090 约每小时 2 元(二手报价),用完立刻释放 |
| Coding Agent 订阅 | 可选 | 不计入 | 课里不依赖任何付费的 AI 写代码工具 |

这样算下来,整门课的硬性花费是**模型 API 几百元,加上部署阶段几个月的服务器费**,一共大约一千元以内。最贵的其实不是钱,是时间:711 课,每课 1.5 到 3 小时。

## 动手练习

### 练习 1:只在晚上和周末学,评测部分调得更多

假设你只在晚上和周末学习(全部空闲价),但评测部分你很认真,每天跑 500 次而不是 300 次。只看第六部分,花费从多少变成多少?

<details><summary>参考答案</summary>

```js
// agent-zero-lab/part01/ex2_1.js
function callCost(inTok, outTok, peak) {
  const inPrice = peak ? 2 : 1;
  const outPrice = peak ? 8 : 4;
  return inTok * inPrice / 1_000_000 + outTok * outPrice / 1_000_000;
}
const evalDays = 37;
const before = callCost(3000, 500, true) * 300 * evalDays;
const after = callCost(3000, 500, false) * 500 * evalDays;
console.log('原来:', before.toFixed(1), '元');
console.log('改后:', after.toFixed(1), '元');
```

<div class="line-notes">

- `function callCost(inTok, outTok, peak) {` 和正文同一个函数。
- `const evalDays = 37;` 第六部分的天数。
- `const before = callCost(3000, 500, true) * 300 * evalDays;` 正文的假设:高峰价,一次 3000 × 2 ÷ 1,000,000 + 500 × 8 ÷ 1,000,000 = 0.01 元,× 300 × 37 = 111。
- `const after = callCost(3000, 500, false) * 500 * evalDays;` 空闲价一次 0.005 元,× 500 × 37 = 92.5。
- `console.log('原来:'` 打印 `原来: 111.0 元`。
- `console.log('改后:'` 打印 `改后: 92.5 元`。

</div>

```text
原来: 111.0 元
改后: 92.5 元
```

调用量多了三分之二,花费反而少了 18.5 元,因为空闲价是一半。结论:同样的学习量,挑时间就能省一半;想多跑评测,放到晚上跑。

</details>

### 练习 2:换成更贵的模型

用价格表里 `deepseek-v4-pro` 的高峰价(输入 9、输出 27),算一次「输入 3,000、输出 400」的调用和一天 60 次的花费,和 `deepseek-flash` 比一比。

<details><summary>参考答案</summary>

```js
// agent-zero-lab/part01/ex2_2.js
const models = {
  'deepseek-flash': { in: 2, out: 8 },
  'deepseek-v4-pro': { in: 9, out: 27 },
};
for (const [name, price] of Object.entries(models)) {
  const one = 3000 * price.in / 1_000_000 + 400 * price.out / 1_000_000;
  console.log(name, '一次', one.toFixed(4), '元,一天 60 次', (one * 60).toFixed(2), '元');
}
```

<div class="line-notes">

- `const models = {` 用一个对象存两个模型的单价,键是模型名。键里有减号,所以要加引号。
- `'deepseek-flash': { in: 2, out: 8 },` 高峰、未命中缓存的价格。
- `'deepseek-v4-pro': { in: 9, out: 27 },` 同样口径,贵得多。
- `for (const [name, price] of Object.entries(models)) {` `Object.entries` 把对象变成 `[键, 值]` 数组的列表,再用解构一次取出模型名和单价。
- `const one = 3000 * price.in / 1_000_000` flash 是 0.006 + 0.0032 = 0.0092;pro 是 0.027 + 0.0108 = 0.0378。
- `console.log(name, '一次'` 一天 60 次:flash 0.552,pro 2.268。

</div>

```text
deepseek-flash 一次 0.0092 元,一天 60 次 0.55 元
deepseek-v4-pro 一次 0.0378 元,一天 60 次 2.27 元
```

pro 是 flash 的 4 倍多。日常练习用 flash,只在需要对比效果时才换 pro。如果整门课都用 pro,上面 621 元的预算会变成两千五百元左右。

</details>

### 练习 3:用 0.6 粗估一次调用

你要把一篇 3,000 字的中文帮助中心文章交给模型,让它写 500 token 左右的摘要。按 1 个汉字 ≈ 0.6 token 粗估,高峰价一次多少钱?10 块钱够调多少次?

<details><summary>参考答案</summary>

```js
// agent-zero-lab/part01/ex2_3.js
const chineseChars = 3000;
const tokensPerChar = 0.6;
const inTok = chineseChars * tokensPerChar;
const outTok = 500;
const cost = inTok * 2 / 1_000_000 + outTok * 8 / 1_000_000;
console.log('输入约', inTok, 'token');
console.log('一次约', cost.toFixed(4), '元');
console.log('10 块钱能调', Math.floor(10 / cost), '次');
```

<div class="line-notes">

- `const chineseChars = 3000;` 文章字数。
- `const tokensPerChar = 0.6;` DeepSeek 官方给的中文换算比例。
- `const inTok = chineseChars * tokensPerChar;` 3000 × 0.6 = 1800 token。正文实测过,真实值可能比这多两成。
- `const outTok = 500;` 摘要长度。
- `const cost = inTok * 2 / 1_000_000 + outTok * 8 / 1_000_000;` 1800 × 2 ÷ 1,000,000 = 0.0036,500 × 8 ÷ 1,000,000 = 0.004,合计 0.0076。
- `console.log('一次约', cost.toFixed(4), '元');` 打印 `0.0076`。
- `console.log('10 块钱能调', Math.floor(10 / cost), '次');` 10 ÷ 0.0076 ≈ 1315.8,向下取整 1315 次。

</div>

```text
输入约 1800 token
一次约 0.0076 元
10 块钱能调 1315 次
```

按正文实测「比估算多两成」修正一下,输入约 2,160 token,一次约 0.0083 元,10 块钱也还能调一千两百次左右。

</details>

### 练习 4:填你自己的软件表

把正文那张软件表抄到你的学习笔记里,加一列「我现在的状态」,对每一行写「已有 / 没有 / 不确定」。今天只填,不装。

<details><summary>参考答案</summary>

一个示范(按一个用 Apple 芯片 Mac、做了几年前端的读者写):

| 软件 / 账号 | 哪天装 | 我现在的状态 |
| --- | --- | --- |
| 终端 | Day 3 | 已有,平时跑 npm 用 |
| Python | Day 8 前后 | 不确定,好像系统里有个 python3 |
| 编辑器 | Day 9 | 已有 VS Code,没装 Python 插件 |
| uv | Day 10 | 没有 |
| git | Day 56 | 已有,只会 commit 和 push |
| GitHub 账号 | 今天 | 有,但是公司邮箱注册的,今天新注册了一个个人号 |
| Docker | Day 100 | 没有 |
| DeepSeek 开放平台 | Day 120 | 今天注册了,没充值 |

「不确定」那几项不要今天去查怎么装,到那一天文章会讲怎么确认、怎么装。

验收标准:能不看文章说出 `callCost` 的公式,并且知道为什么要除以一百万;`budget3.js` 在 Console 里跑出和文中一样的表格和合计;练习 1 到 3 自己写出来并跑通;学习笔记里有电脑配置和这张软件状态表;有一个个人 GitHub 账号。

</details>

## 名词解释

| 名词 | 意思 |
| --- | --- |
| token | 大模型处理文字的最小单位,也是计费单位。DeepSeek 的口径是 1 个汉字约 0.6 个 token,实测会略多 |
| 输入 token / 输出 token | 你发给模型的部分和它写回来的部分,分开计价,输出贵得多(flash 是 4 倍) |
| 单价(元 / 百万 token) | 每处理一百万个 token 收多少钱。算一次调用的钱要除以一百万 |
| 缓存命中 | 这次发的开头和之前发过的一样,这部分输入按很低的价格算。今天做预算一律按没命中算 |
| 高峰 / 空闲时段 | DeepSeek 按北京时间分两档价,工作日 9–12 点、14–18 点是高峰,其余时间是空闲,价格减半 |
| 开放平台 | 厂商给开发者用的网站(platform.deepseek.com),在这里充值、建 key、看用量。和聊天网页不是一个地方 |
| 思考模式 | 模型先写一段内部推理再回答,推理部分也按输出 token 收钱 |
| WSL | Windows 自带的「在 Windows 里跑 Linux」功能,用 Windows 学这门课时用它跑命令 |

## 常见误区

**第一天把所有软件都装上。** 装完一半用不上,遇到问题也不知道它是干什么的。用到哪天装哪天,那一天的文章会讲清楚为什么装、怎么确认装对了。

**忘了除以一百万。** 正文演示过,少了这一步一次调用算出来 1728 元。更隐蔽的版本是换厂商时单价单位不一样(每千 token、每百万 token、美元、人民币),抄单价时把单位一起抄。

**拿 0.6 当准确值。** 我实测 573 个字符的工单,按官方口径估约 305 token,实际 364,多了两成。做预算往高了估,真实用量看接口返回的 `usage`。

**只算输入不算输出。** 输出单价是输入的 4 倍。让模型「详细解释」「写一篇长文」时,输出 token 才是大头。

**以为开放平台和聊天网页是一回事。** chat.deepseek.com 是聊天用的网页,免费;调 API 要去 platform.deepseek.com,余额单独充值,按 token 扣钱。网页聊得再多,也和 API 余额没有关系。

**在公司的 GitHub 账号上放个人作品。** 换工作时可能就没权限了,面试官看到一堆公司代码也说不清哪些是你写的。今天就分开。

## 学习资料

### 文档与文章

- [DeepSeek 模型 & 价格](https://api-docs.deepseek.com/zh-cn/quick_start/pricing):中文,今天的价格表出处。价格会变,Day 120 充值前再看一次。5 分钟。
- [DeepSeek Token 用量计算](https://api-docs.deepseek.com/zh-cn/quick_start/token_usage):中文,0.6 和 0.3 这两个换算比例的出处,很短。
- [MDN console.table()](https://developer.mozilla.org/zh-CN/docs/Web/API/console/table_static):中文,`budget3.js` 最后那张表格是怎么打印出来的。
- [MDN Number.prototype.toFixed()](https://developer.mozilla.org/zh-CN/docs/Web/JavaScript/Reference/Global_Objects/Number/toFixed):中文,注意它返回的是**字符串**,这就是正文里要 `Number(...)` 转回来的原因。
- [uv 官方文档](https://docs.astral.sh/uv/):英文,今天不用看,Day 10 之前扫一眼首页那几行介绍,知道它是什么。
- [Langfuse 价格页](https://langfuse.com/pricing):英文,免费档的出处,Day 365 用。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV13WGHz8EEz&autoplay=0&high_quality=1" title="从pip到uv:一口气梳理现代Python项目管理全流程!" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>隔壁的程序员老王 · 从pip到uv:一口气梳理现代Python项目管理全流程! · 16 分钟。今天只看前 5 分钟,知道 Python 世界的「npm」为什么从 pip 换成了 uv,有个印象就行,Day 10 再完整看一遍。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1y69TYTEMQ&autoplay=0&high_quality=1" title="手把手教你:充值DeepSeek API,Python调用DeepSeek API" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>大熊课堂 · 手把手教你:充值DeepSeek API,Python调用DeepSeek API · 8 分钟。2025 年 2 月的视频,只看前半段开放平台的注册和充值页面长什么样;里面的价格和模型名已经过时,以今天的价格表为准。后半段的 Python 代码 Day 120 再看。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/qh98qOND6MI" title="This Tool Replaces pip, Poetry, pyenv, and More (It's Fast)" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>ArjanCodes · This Tool Replaces pip, Poetry, pyenv, and More (It's Fast) · 英文,可开自动字幕。一个讲 Python 工程实践很有名的频道,讲 uv 一个工具替代了哪些老工具。和上面老王那个二选一看,Day 10 之前看完。</figcaption>
</figure>

### 书籍

- Eric Matthes《Python Crash Course》第 3 版,No Starch Press,2023;中文版《Python 编程:从入门到实践(第 3 版)》,人民邮电出版社。全世界用得最多的 Python 入门书之一,今天不用读。Day 8 开始学 Python 时可以拿它当这门课的补充,遇到某个语法点想多看几个例子就翻对应章节。[英文版出版社页面](https://nostarch.com/python-crash-course-3rd-edition)。

### 开源项目与代码

- [ehmatthes/pcc_3e](https://github.com/ehmatthes/pcc_3e):上面那本书的官方配套代码仓库,每章的示例代码都在里面。今天点进去看看一个 Python 项目的目录长什么样,和你熟悉的前端仓库比一比,5 分钟。

## 自测

1. 一次调用输入 2,000 token、输出 600 token,用 `deepseek-flash` 高峰价、未命中缓存,花多少钱?写出算式。

<details><summary>答案</summary>

2000 × 2 ÷ 1,000,000 + 600 × 8 ÷ 1,000,000 = 0.004 + 0.0048 = 0.0088 元。

</details>

2. 为什么这门课不让你今天把 Python、uv、Docker 都装上?

<details><summary>答案</summary>

用到哪天装哪天。现在装了用不上,过几个月版本会变;而且装的时候遇到问题,你还不知道它是干什么的,不知道怎么查。到那一天文章会讲为什么装、怎么确认装对了。

</details>

3. 我实测一张 573 字符的工单是 364 个输入 token,按官方 0.6 / 0.3 的口径估算只有约 305。这说明什么?做预算应该怎么办?

<details><summary>答案</summary>

说明换算比例只能粗估,实际会因为格式开销、标点数字的切法而偏多,这次多了两成。做预算往高了估,真实用量以接口返回的 `usage` 为准。

</details>

4. `budget3.js` 算出来的 621 元,哪些假设让它偏高,哪些情况会让实际花费超过它?

<details><summary>答案</summary>

偏高:复习日也算了调用、全部按没命中缓存算、全部按高峰价算。会超过的情况:开着思考模式(输出 token 翻几倍)、换成 `deepseek-v4-pro` 这类贵模型(约 4 倍)、代码 bug 造成死循环一直调模型。

</details>

5. platform.deepseek.com 和 chat.deepseek.com 有什么区别?

<details><summary>答案</summary>

chat 是给人聊天用的网页;platform 是开放平台,给开发者充值、建 API key、看用量的地方。调 API 的钱要在开放平台单独充,账号是通用的。

</details>

## 明天预告

Day 3 · 终端(一):打开终端,pwd、ls、cd 和路径。今天的软件表里,第一个要用的就是终端,而且后面几乎每一天都要在里面敲命令:装 uv、跑 Python、用 git。明天从打开终端开始,讲清楚「我现在在哪个目录」「这个目录里有什么」「怎么去另一个目录」,以及绝对路径和相对路径的区别。今天 `count_tokens.mjs` 里那个 `'part01/ticket.txt'` 就是一个相对路径,明天你会知道它是相对于哪里。
