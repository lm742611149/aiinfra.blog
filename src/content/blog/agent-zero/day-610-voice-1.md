---
title: 'Day 610 · 语音 Agent(一):人说话的节奏,级联还是端到端,延迟花在哪'
description: '语音 Agent 难在时间:用户说完话一秒多听不到回应,就以为电话断了。今天先看人和人接话有多快,再比较级联(ASR、LLM、TTS 三段)和端到端实时模型两种架构,然后把「说完到听见第一个字」拆成六段做一张延迟预算表,实测 DeepSeek 的首 token 和 macOS 自带 say 的合成耗时,最后用 asyncio 模拟流水线,一次改一个参数把首音频从 1.58 秒压到 0.79 秒。'
pubDate: 2026-10-22
regime: none
tags: ['voice-agent', 'latency', 'asyncio', 'streaming', 'agent-zero']
series: 'agent-zero'
day: 610
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 609](/blog/agent-zero/day-609-webmcp/) 讲了 WebMCP:网站在页面里用 `document.modelContext.registerTool` 把「查发票」「申请退款」这些函数连同说明书一起递给浏览器里的 Agent,Agent 不用再从截图里猜按钮。再往前,[Day 606](/blog/agent-zero/day-606-computer-use-1/) 和 [Day 607](/blog/agent-zero/day-607-computer-use-2/) 的浏览器 Agent 一步要几秒,慢一点用户也就多等一会儿,反正屏幕上有个转圈。

今天换一种完全没有屏幕的界面:电话。云簿想让客户打电话进来就能查扣款、问退款,接电话的是一个 Agent。你会发现文本 Agent 里不太要紧的一件事,在这里变成了头号问题:**时间**。文本对话慢两秒没人在意,电话里沉默两秒,对方就开始「喂?喂?」。

## 今天要解决的问题

学完今天你应该能:

1. 说出人和人对话时接话大概有多快,以及用户对语音机器人的沉默能忍多久,知道这些数字哪些是研究、哪些是经验值。
2. 讲清语音 Agent 的两种架构:**级联**(VAD、ASR、LLM、TTS 串起来)和**端到端实时模型**(语音进、语音出),各自的好处和代价,以及 2026 年 10 月国内外各有哪些可用的方案。
3. 把「用户说完到听见第一个字」拆成六段,做一张**延迟预算表**,并用实测数据(DeepSeek 首 token、本机 TTS)去校准它。
4. 用 asyncio 模拟一条级联流水线,一次改一个参数,量出每个优化各省了多少毫秒。

今天只有两个新概念:**级联和端到端两种架构**,以及**延迟预算**。其余用到的都是学过的东西:async 和 `asyncio.run`([Day 67](/blog/agent-zero/day-067-async-2/))、流式输出和首 token 延迟([Day 133](/blog/agent-zero/day-133-sse-principle/)、[Day 134](/blog/agent-zero/day-134-streaming-code/))、`LLMClient.stream()`([Day 136](/blog/agent-zero/day-136-llm-client-2/))、延迟分段计时([Day 401](/blog/agent-zero/day-401-latency/))、生产者和消费者([Day 387](/blog/agent-zero/day-387-queue-basics/))。

预计用时 2.5 小时。前置:上面列的几天;今天不需要麦克风,也不用装任何语音 SDK,所有「语音」都是模拟或者用 macOS 自带的 `say` 命令。

学法:先对照文章逐行敲一遍(不复制粘贴)并跑通;第二天合上文章,把 `voice_sim.py` 里 `turn()` 的流式那一支(producer 加 consumer)默写出来;做练习,做不出再展开参考答案,看完关掉自己重写一遍。

## 人说话的节奏是多少毫秒

先建立一个参照。会话分析领域有一篇被引用得很多的研究:Stivers 等人 2009 年发在 PNAS 上的《Universals and cultural variation in turn-taking in conversation》,录了十种语言的真实对话,量一方说完到另一方接话的间隔。摘要里的结论是,各语言都避免抢话、也避免长时间沉默,不同语言的平均间隔离总体平均值不超过 250 毫秒。Language Log 上一篇转述这篇论文的文章(二手来源,我没拿到论文全文)给了更具体的数字:每种语言间隔分布的众数都在 0 到 200 毫秒之间,中位数从日语的 0 毫秒左右到丹麦语的 300 毫秒左右,跨语言的中位数大约 100 毫秒。

100 毫秒是什么概念?人光是听懂一句话再组织语言,就远远不止 100 毫秒。所以接话这么快,只能说明一件事:**人在对方还没说完的时候,就已经在猜他要说什么、在准备回答了**。

机器目前做不到这个速度。那用户能忍多久?这个没有像上面那样的标准答案,我能给你的是做电话客服机器人的人普遍用的经验值:一秒以内觉得挺自然,一秒到一秒半能接受,超过两秒开始怀疑对面没听见,超过三秒就会有人「喂?」。很多团队把**首音频延迟**(用户说完到听见机器人第一个音频包,英文常写 time to first audio)的目标定在 1 秒左右,P95(100 通电话里最慢的那 5 通的门槛)不超过 1.5 秒。再强调一次,这是行业经验,不是研究结论,你的业务最好拿自己的挂断率和「用户重复同一句话」的比例来定。

<figure>
<svg viewBox="0 0 640 210" role="img" aria-label="人和人接话的间隔约 100 毫秒,语音机器人的目标是 1000 毫秒,默认配置的级联流水线约 1500 毫秒">
  <rect x="0" y="0" width="640" height="210" fill="var(--paper-raised)"/>
  <line x1="120" y1="30" x2="120" y2="170" stroke="var(--rule)"/>
  <text x="120" y="190" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">0</text>
  <line x1="360" y1="30" x2="360" y2="170" stroke="var(--rule)" stroke-dasharray="4 3"/>
  <text x="360" y="190" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">1000 ms</text>
  <line x1="600" y1="30" x2="600" y2="170" stroke="var(--rule)" stroke-dasharray="4 3"/>
  <text x="600" y="190" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">2000 ms</text>
  <text x="16" y="56" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">人和人</text>
  <rect x="120" y="42" width="24" height="22" fill="var(--compute-wash)" stroke="var(--compute)"/>
  <text x="152" y="58" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">中位数约 100 ms(二手)</text>
  <text x="16" y="100" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">目标</text>
  <rect x="120" y="86" width="240" height="22" fill="var(--mem-wash)" stroke="var(--mem)"/>
  <text x="128" y="102" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">首音频约 1 秒(经验值)</text>
  <text x="16" y="144" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">默认配置</text>
  <rect x="120" y="130" width="378" height="22" fill="var(--paper-raised)" stroke="var(--ink-soft)"/>
  <text x="128" y="146" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">今天的模拟器基线 1.58 秒</text>
</svg>
<figcaption>横轴从 0 到 2 秒。人和人接话几乎不留空,机器先追的是 1 秒这个及格线。今天的任务就是看最下面那根条为什么那么长,以及能从哪里砍。</figcaption>
</figure>

## 级联还是端到端

一个能打电话的 Agent,要做四件事:听出用户在不在说话、把话变成意思、想好怎么回、把回答变成声音。怎么分工,有两条路。

先认识四个缩写,今天反复用到:

- **VAD**(Voice Activity Detection,语音活动检测):判断一小段音频里有没有人在说话。它不懂内容,只看声音像不像人声。最常用的是一个叫 Silero VAD 的小模型。类比前端:像 `input` 事件加防抖,用户停手多久才算「输入完了」。
- **ASR**(Automatic Speech Recognition,语音识别,也叫 STT,speech-to-text):把音频变成文字。流式 ASR 会边听边吐「中间结果」,说完后再给一个「最终结果」。
- **TTS**(Text-to-Speech,语音合成):把文字变成音频。好的 TTS 服务也是流式的,收到第一句就开始吐音频包。
- **LLM**:你已经很熟了,这里负责决定回什么,需要时调工具。

<figure>
<svg viewBox="0 0 640 240" role="img" aria-label="级联语音流水线和端到端实时模型的对比">
  <rect x="0" y="0" width="640" height="240" fill="var(--paper-raised)"/>
  <text x="16" y="34" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">级联</text>
  <rect x="70" y="16" width="72" height="30" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
  <text x="106" y="36" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">VAD</text>
  <rect x="158" y="16" width="72" height="30" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
  <text x="194" y="36" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">ASR</text>
  <rect x="246" y="16" width="110" height="30" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
  <text x="301" y="36" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">LLM + 工具</text>
  <rect x="372" y="16" width="72" height="30" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
  <text x="408" y="36" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">TTS</text>
  <line x1="142" y1="31" x2="158" y2="31" stroke="var(--rule)"/>
  <line x1="230" y1="31" x2="246" y2="31" stroke="var(--rule)"/>
  <line x1="356" y1="31" x2="372" y2="31" stroke="var(--rule)"/>
  <text x="200" y="66" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">音频 → 文字</text>
  <text x="408" y="66" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">文字 → 音频</text>
  <text x="462" y="28" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">每段可单独换</text>
  <text x="462" y="44" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">中间有文字可审计</text>
  <text x="16" y="124" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">端到端</text>
  <rect x="70" y="106" width="72" height="30" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
  <text x="106" y="126" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">VAD</text>
  <rect x="158" y="106" width="286" height="30" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
  <text x="301" y="126" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">语音进、语音出的实时模型(可调工具)</text>
  <line x1="142" y1="121" x2="158" y2="121" stroke="var(--rule)"/>
  <text x="462" y="118" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">少两次转换,语气自然</text>
  <text x="462" y="134" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">中间过程看得少</text>
  <line x1="16" y1="168" x2="624" y2="168" stroke="var(--rule)"/>
  <text x="16" y="192" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">两种都绕不开:轮次检测、打断、回声消除、网络传输(WebRTC / 电话线路)</text>
  <text x="16" y="214" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">差别只在中间:三个模型串起来,还是一个模型包圆</text>
</svg>
<figcaption>蓝色是模型做判断的地方,琥珀色是处理音频的组件。级联的每个箭头处都是一段文字,你能记日志、能跑评测;端到端把这些都收进了一个模型里。</figcaption>
</figure>

**级联方案**就是图上面那条:VAD 判断用户说完了,ASR 转成文字,LLM 生成回复(可以调工具),TTS 合成语音。好处是每段都能挑最合适的供应商,中文识别用国内厂商,LLM 用你在第六部分评测好的那个,TTS 挑音色最好的;中间全是文字,可以记日志、做回归评测、做合规审计,和你前面六百天学的东西完全接得上。代价也明显:延迟要加三段;语气全靠 TTS 硬合成;用户说话时的情绪、迟疑、语调,在 ASR 那一步变成文字时就丢了。

**端到端实时模型**(speech-to-speech)是下面那条:一个模型直接听音频、直接出音频,也能调工具。少了两次「音频和文字互转」,延迟更低,语气、停顿也更像人。代价是你对中间发生了什么看得更少,出了错不好查,也不好像文本 Agent 那样逐句跑评测。

2026 年 10 月我查到的情况(这块变得非常快,用之前一定回官方页面核对):

- **OpenAI Realtime API**:[官方入门页](https://developers.openai.com/api/docs/guides/realtime)的示例模型是 `gpt-realtime-2.1`,浏览器走 WebRTC、服务端走 WebSocket;浏览器端要用你的后端调 `POST /v1/realtime/client_secrets` 签发的临时密钥,正式 API key 不能放进前端代码。这一点你做前端一定熟,和不把支付密钥写进 React 组件是一个道理。
- **OpenAI GPT-Live-1**:[模型页](https://developers.openai.com/api/docs/models/gpt-live-1)写的是 `gpt-live-1`,能同时听和说(全双工),按语音时长计费,每分钟 0.05 美元按秒计,推理和工具调用交给你配置的后端模型另算。它的发布文章(9 月 10 日)里有两个数字:轮次切换延迟 0.798 秒,对比 `gpt-realtime-2.1` 的 1.41 秒。这是 OpenAI 自己的数字,我只在二手报道里看到,官网文章对命令行返回 403,没法核对原文。
- **OpenAI 的 [Voice agents 指南](https://developers.openai.com/api/docs/guides/voice-agents)**把架构分成三类:GPT-Live、Realtime(语音到语音)、链式流水线(chained,也就是级联)。它说级联的好处是「能检查或改写中间文字,每个组件可以单独替换」,可以先存转写、先过策略检查、答案批准了再合成语音。
- **阿里云百炼**:[实时多模态文档](https://help.aliyun.com/zh/model-studio/realtime)列了 `qwen3.8-omni-flash-realtime`、`qwen3.5-omni-plus-realtime` 等型号,走 WebSocket,输入要求 16 kHz、16 位、单声道 PCM,输出 24 kHz;轮次检测有 `server_vad`、`semantic_vad`(能过滤附和声和背景音)和手动三种。
- **火山引擎**:[实时对话式 AI](https://www.volcengine.com/product/veRTC/ConversationalAI)把 RTC 传输、ASR、大模型、TTS 打包成一套,本质上是厂商帮你搭好的级联。
- **开源框架**:[Pipecat](https://github.com/pipecat-ai/pipecat)(PyPI 上 2026 年 10 月 19 日发的 1.13.0)和 [LiveKit Agents](https://github.com/livekit/agents)(10 月 15 日的 1.8.8)两个都能搭级联,也都能接端到端模型。

那到底选哪个?我的看法是看业务要不要「事后能查」:

- 客服、预约、催收这类**流程固定、要审计、要跑评测**的业务,用级联。中间那段文字是你的命根子,出了问题能查,改了提示词能回归。云簿的退款电话就属于这一类。
- 陪聊、口语练习这类**体验优先**的场景,端到端明显更舒服。
- 还有一种越来越常见的折中:前台用实时模型负责「说话」,复杂的业务判断通过工具调用交给后台的文本 Agent。GPT-Live 的设计就是这个思路,官方文档也专门提醒,用户打断说话**不会**自动取消后台正在跑的任务,这件事得你自己管。明天讲打断时会再碰到它。

说白了,这和 [Day 399](/blog/agent-zero/day-399-model-routing/) 模型路由时的取舍是一类问题:没有绝对的好坏,看你更怕「慢」还是更怕「出了事说不清」。今天后面的实验都在级联上做,因为每一段都能单独量、单独换,最适合拿来学延迟。

## 准备

今天的文件放在 `agent-zero-lab/part10/voice/` 下。只用到 Day 136 的 `common/llm.py` 和标准库,不用装新包。

```bash
cd agent-zero-lab
mkdir -p part10/voice
touch part10/voice/__init__.py
```

`part10/__init__.py` 是 [Day 604](/blog/agent-zero/day-604-coding-agents-1/) 建 `part10/` 时就有的;如果你的没有,也 `touch` 一个。所有脚本都在 `agent-zero-lab` 根目录用 `uv run python -m part10.voice.xxx` 跑,这样 `from common.llm import LLMClient` 才找得到 `common` 包。

我实跑的环境:Python 3.12.13,openai 3.36.1,`.env` 里还是 `LLM_MODEL=deepseek-flash`,关了思考(`LLM_EXTRA_BODY={"thinking": {"type": "disabled"}}`),macOS 14 自带的 `say` 和中文音色 Tingting。

## 第 1 步:先做一张延迟预算表

**延迟预算**是借了「花钱做预算」的说法:总共只能花 1 秒左右,先把这 1 秒分给每个环节,每段都有个额度,哪段超了一眼看得出来。前端也有类似的东西,性能预算(performance budget)规定首屏 JS 不超过多少 KB,超了 CI 就报警。

从用户**停止说话**那一刻开始算(不是从用户开始说话算,因为用户说多长时间不归你管),级联方案要经过六段:

1. **VAD 判定说完**:VAD 看到静音后,要等一段时间(hangover,也叫 endpointing delay)才敢说「用户说完了」,否则用户在句中换口气就被当成说完。
2. **ASR 最终结果**:流式 ASR 一直在出中间结果,说完后还要一点时间给最终结果。
3. **网络往返**:用户到你的服务器,你的服务器到各个模型厂商。
4. **LLM 首 token**:就是 [Day 133](/blog/agent-zero/day-133-sse-principle/) 量过的 TTFT。
5. **攒够第一句**:TTS 不能一个字一个字地念(语调会乱),要攒出一个能念的短句才送过去。
6. **TTS 首包**:TTS 收到文本到吐出第一个音频包。

先不管精确值,用各家文档的标称量级和社区常见的实测填一个初版。这些数只是量级,今天后面会拿实测去校准其中两项。

```python
# agent-zero-lab/part10/voice/budget.py
"""级联语音 Agent 的首音频延迟预算:从用户停止说话那一刻算起,每一段花多少毫秒。"""
BUDGET_MS = {
    "VAD 判定说完": 500,
    "ASR 最终结果": 150,
    "网络往返": 80,
    "LLM 首 token": 450,
    "攒够第一句": 100,
    "TTS 首包": 200,
}

total = sum(BUDGET_MS.values())
for name, ms in BUDGET_MS.items():
    bar = "#" * (ms // 25)
    print(f"{ms:>5} ms  {ms / total:>4.0%}  {bar:<20}  {name}")
print(f"{total:>5} ms  合计")
```

<div class="line-notes">

- `BUDGET_MS = {` 一个字典,键是环节名,值是毫秒。Python 3.7 起字典保持插入顺序,所以打印出来就是流水线的顺序,和 JS 里普通对象的字符串键按插入顺序遍历一样。
- `"VAD 判定说完": 500,` 500 毫秒的静音等待。LiveKit 文档写的是:不开语义轮次检测时,默认在用户说完后等 0.5 到 3.0 秒;它用的 Silero VAD 的 `min_silence_duration` 默认 0.55 秒。所以 500 一点都不夸张。
- `"LLM 首 token": 450,` 先按文档量级填,第 2 步实测会发现 DeepSeek 在我这里的中位数是 0.72 秒。
- `total = sum(BUDGET_MS.values())` `.values()` 拿到所有毫秒数,`sum` 求和,得 1480。相当于 JS 的 `Object.values(b).reduce((a, x) => a + x, 0)`。
- `bar = "#" * (ms // 25)` 字符串乘整数就是重复,`//` 是整除。500 // 25 = 20 个 `#`,画一个简易条形图。JS 里写 `"#".repeat(Math.floor(ms / 25))`。
- `print(f"{ms:>5} ms  {ms / total:>4.0%}  {bar:<20}  {name}")` 格式说明符:`>5` 右对齐占 5 格,`.0%` 把 0.3378 显示成 `34%`,`<20` 左对齐占 20 格。把中文名放在最后,是因为中文一个字占两个显示宽度,放前面会把后面的列挤歪,我第一版就是这么歪的。

</div>

```bash
uv run python -m part10.voice.budget
```

```text
  500 ms   34%  ####################  VAD 判定说完
  150 ms   10%  ######                ASR 最终结果
   80 ms    5%  ###                   网络往返
  450 ms   30%  ##################    LLM 首 token
  100 ms    7%  ####                  攒够第一句
  200 ms   14%  ########              TTS 首包
 1480 ms  合计
```

1.48 秒,已经超了 1 秒的目标。注意最长的那根条:不是 LLM,是 **VAD 的静音等待**,占了三分之一。很多人第一反应是「换个更快的模型」,但这张表告诉你,先动 VAD 收益更大。这就是做预算表的意义:[Day 401](/blog/agent-zero/day-401-latency/) 说过「先量,再优化」,语音里尤其如此。

## 第 2 步:实测 LLM 那两段

表里的「LLM 首 token」和「攒够第一句」是可以真量的。用 Day 136 的 `LLMClient.stream()`:它逐段 yield 文本,结束后把首 token 时间放在 `llm.last.ttft` 里。我们再自己记一下「第一次出现句末标点」的时刻,就是「攒够第一句」的结束点。

系统提示词特意写成电话版:每句不超过 15 个字,不念链接。语音的提示词和文本版不一样,明天会细讲,今天先让它短一点。

```python
# agent-zero-lab/part10/voice/measure_llm.py
"""实测级联里 LLM 那两段:首 token(ttft)和「攒够第一句」各要多久。跑 5 次看波动。"""
import re
import time

from common.llm import LLMClient

SYSTEM = "你是云簿 CloudLedger 的电话客服。回答会被念给用户听:每句不超过 15 个字,不念链接,不用列表。"
USER = "我九月的年费好像被扣了两次,怎么办?"
SENTENCE_END = re.compile(r"[,。?!,.?!]$")

llm = LLMClient()
for i in range(5):
    start = time.perf_counter()
    buf, first_sentence = "", None
    for piece in llm.stream([{"role": "system", "content": SYSTEM}, {"role": "user", "content": USER}]):
        buf += piece
        if first_sentence is None and SENTENCE_END.search(buf):
            first_sentence = (time.perf_counter() - start, buf)
    r = llm.last
    fs_t, fs_text = first_sentence or (r.latency, buf)
    print(f"第{i + 1}次 ttft={r.ttft:.3f}s 第一句={fs_t:.3f}s「{fs_text}」 整段={r.latency:.3f}s {len(r.content)}字")
print(llm.ledger)
```

<div class="line-notes">

- `SENTENCE_END = re.compile(r"[,。?!,.?!]$")` 想匹配「以句末标点结尾」。`[...]` 是字符集合,`$` 是结尾。**这一行有 bug**,先跑一次看现象。
- `llm = LLMClient()` Day 136 的封装,读 `.env` 里的 `LLM_BASE_URL / LLM_API_KEY / LLM_MODEL`。
- `start = time.perf_counter()` 高精度计时器,单位秒,相当于浏览器里的 `performance.now()`(那个是毫秒)。
- `buf, first_sentence = "", None` 一行给两个变量赋值。`buf` 攒到目前为止的全部文字,`first_sentence` 第一次遇到句末标点时记下(时刻, 文字)。
- `for piece in llm.stream(` `stream()` 是一个生成器,每来一段增量文本就 yield 一次。对照 JS 是 `for await (const piece of stream)`,只不过 `LLMClient.stream()` 是同步版本。
- `if first_sentence is None and SENTENCE_END.search(buf):` 还没记过,并且当前 `buf` 以标点结尾,就记一次。`search` 在字符串任意位置找匹配,配合 `$` 等于「看结尾」。
- `r = llm.last` 流结束后 `LLMClient` 把这次调用的 `ChatResult` 放在 `last` 上,里面有 `ttft`、`latency`、`content`。
- `fs_t, fs_text = first_sentence or (r.latency, buf)` 如果整段都没遇到标点(`first_sentence` 还是 `None`),就把整段当作第一句。`or` 在左边为假时取右边,和 JS 的 `||` 一样。
- `print(llm.ledger)` 5 次调用的 token 和花费合计,`Ledger.__str__` 会打印成一行。

</div>

```bash
uv run python -m part10.voice.measure_llm
```

```text
第1次 ttft=1.214s 第一句=1.327s「别担心，我先帮您核实扣款记录。」 整段=1.333s 15字
第2次 ttft=0.413s 第一句=0.518s「我先帮您查这笔扣款。」 整段=0.534s 10字
第3次 ttft=0.509s 第一句=0.605s「我帮您核实扣费记录。」 整段=0.695s 18字
第4次 ttft=0.516s 第一句=0.623s「我先帮您查一下扣费记录。」 整段=0.662s 18字
第5次 ttft=0.746s 第一句=0.858s「请提供您的账号或会员号。」 整段=0.859s 12字
5 次调用 | 输入 250 / 输出 54 tokens | 约 ¥0.0009
```

看第 1 次的「第一句」:「别担心，我先帮您核实扣款记录。」,逗号没有被当成断句点,一直攒到句号。原因是模型输出的是**全角**逗号「，」,而我在编辑器里敲正则时用的是半角 `,`。正则里那个 `?` 和 `!` 也是半角的,模型却会输出全角「？」「！」。这个坑在 [Day 179](/blog/agent-zero/day-179-self-consistency/) 解析答案时碰过一次(全角冒号),在语音里它直接变成了延迟:第一句平白多攒了好几个字。

修法是把全角和半角都写进去:

```python
SENTENCE_END = re.compile(r"[，。？！,.?!]$")
```

<div class="line-notes">

- `SENTENCE_END = re.compile(r"[，。？！,.?!]$")` 前四个是全角(逗号、句号、问号、叹号),后四个是半角。中文模型的输出几乎都是全角,半角留着兜底英文。

</div>

改完再跑一次:

```text
第1次 ttft=0.852s 第一句=0.946s「先别着急，」 整段=0.965s 12字
第2次 ttft=1.186s 第一句=1.209s「好的，」 整段=1.229s 14字
第3次 ttft=0.441s 第一句=0.567s「请您先别着急，」 整段=0.587s 13字
第4次 ttft=0.698s 第一句=0.824s「很抱歉给您带来困扰。」 整段=0.843s 21字
第5次 ttft=0.795s 第一句=0.876s「我帮您查一下扣费记录。」 整段=0.901s 11字
5 次调用 | 输入 250 / 输出 55 tokens | 约 ¥0.0009
```

现在第一句只有「好的，」「先别着急，」这么短。从这 10 次里能读出三件事:

- **首 token 波动很大**:最快 0.413 秒,最慢 1.214 秒,差了三倍。10 个数排好序,中间两个是 0.698 和 0.746,中位数 0.722 秒,比预算表里的 450 毫秒多了将近 300 毫秒。这是我在北京的家庭宽带直连 DeepSeek 的数字,你的会不一样,所以才要自己量。
- **攒第一句很便宜**:首 token 之后到第一个标点,只有 0.02 到 0.13 秒。前提是第一句够短。
- **整段也很快**:回答只有十几个字,整段生成完也就比首 token 多一百多毫秒。可别因此觉得「那不流式也行」,第 4 步会看到,回答一长,非流式就完全不行了。

花费:两轮共 10 次调用,输入 500、输出 109 tokens,账本显示两次各约 ¥0.0009,合计约 ¥0.0018。按 `.env` 里 `LLM_PRICE=0.04,2,8`(元每百万 token,缓存命中/未命中/输出)算,未命中输入 250 × 2 / 1e6 + 输出 55 × 8 / 1e6 ≈ 0.0005 + 0.00044 ≈ ¥0.0009,对得上。

## 第 3 步:实测 TTS 那一段

TTS 我手头没有付费的云服务,但 macOS 自带一个离线 TTS:`say` 命令。它和云端流式 TTS 差别很大(不流式、每次都要起一个进程),但用来建立两个直觉刚好:**合成要多久**,和**念出来有多长**。

先在终端试一下,确认有中文音色:

```bash
say -v '?' | grep zh_CN
```

```text
Tingting            zh_CN    # 你好，我叫 婷婷。我是中文普通话语音。
```

然后写脚本,分别合成「第一句」和「整段」,各跑三轮:

```python
# agent-zero-lab/part10/voice/measure_tts.py
"""用 macOS 自带的 say 当一个本地 TTS:比较「合成一句」和「合成整段」各要多久,以及念出来有多长。"""
import re
import subprocess
import time
from pathlib import Path

OUT = Path(__file__).parent / "out"
OUT.mkdir(exist_ok=True)
REPLY = "查到了，您九月三号的年费被扣了两次。多扣的四百六十八元已经提交退款，三个工作日内原路退回。还有别的需要帮忙吗？"


def synth(text: str, name: str) -> tuple[float, float]:
    """合成 text,返回(合成耗时秒, 音频时长秒)。"""
    path = OUT / f"{name}.aiff"
    start = time.perf_counter()
    subprocess.run(["say", "-v", "Tingting", "-o", str(path), text], check=True)
    cost = time.perf_counter() - start
    info = subprocess.run(["afinfo", str(path)], capture_output=True, text=True, check=True).stdout
    m = re.search(r"estimated duration: ([\d.]+)", info)
    assert m is not None, info
    return cost, float(m.group(1))


first = REPLY.split("。")[0] + "。"
for round_no in range(1, 4):
    for name, text in [("first", first), ("full", REPLY)]:
        cost, dur = synth(text, name)
        print(f"第{round_no}轮 {name:<5} {len(text):>3} 字  合成 {cost:.3f}s  音频 {dur:.2f}s  每字 {dur / len(text):.3f}s")
```

<div class="line-notes">

- `OUT = Path(__file__).parent / "out"` 音频文件存到脚本旁边的 `out/` 目录。`Path / "out"` 是路径拼接,相当于 Node 的 `path.join(__dirname, "out")`。
- `OUT.mkdir(exist_ok=True)` 目录已存在不报错,相当于 `fs.mkdirSync(dir, { recursive: true })`。
- `REPLY = "查到了，您九月三号` 一段 55 个字的标准客服回复,今天的模拟器也用这一段。注意数字写成了「四百六十八元」而不是「468 元」,为「听」写的回复要这样,明天细讲。
- `subprocess.run(["say", "-v", "Tingting", "-o", str(path), text], check=True)` 在 Python 里执行一条命令,参数用列表传,不经过 shell,所以文本里有空格和标点也没事。`-o` 把声音写进文件而不是从扬声器放出来。`check=True` 命令失败就抛异常。相当于 Node 的 `execFileSync("say", [...])`。
- `info = subprocess.run(["afinfo", str(path)], capture_output=True, text=True, check=True).stdout` `afinfo` 是 macOS 自带的音频信息工具,`capture_output=True` 把它的输出收进来而不是打到屏幕上,`text=True` 收成字符串。
- `m = re.search(r"estimated duration: ([\d.]+)", info)` 从 `afinfo` 的输出里找「estimated duration: 4.02...」那一段。找不到时 `re.search` 返回 `None`。
- `assert m is not None, info` 先断言找到了,找不到就把 `afinfo` 原文打出来方便排查。少了这一行,类型检查器会在下一行的 `.group` 上画红线:「"group" is not a known attribute of "None"」,因为它知道 `m` 可能是 `None`。
- `return cost, float(m.group(1))` `group(1)` 是第一个括号捕获的内容,字符串 `"4.02..."`,转成浮点数。
- `first = REPLY.split("。")[0] + "。"` 按句号切开取第一段,再补回句号,得到「查到了，您九月三号的年费被扣了两次。」18 个字。

</div>

```bash
uv run python -m part10.voice.measure_tts
```

```text
第1轮 first  18 字  合成 1.554s  音频 4.02s  每字 0.223s
第1轮 full   55 字  合成 1.961s  音频 12.17s  每字 0.221s
第2轮 first  18 字  合成 1.457s  音频 4.02s  每字 0.223s
第2轮 full   55 字  合成 1.806s  音频 12.17s  每字 0.221s
第3轮 first  18 字  合成 1.725s  音频 4.02s  每字 0.223s
第3轮 full   55 字  合成 1.915s  音频 12.17s  每字 0.221s
```

两个发现,都和直觉有点出入:

**合成耗时几乎不随长度涨**:18 个字要 1.5 秒左右,55 个字也才 1.8 到 1.9 秒。说明大头是固定开销,`say` 每次都要起一个新进程、加载音色。这就是为什么生产里 TTS 都是**常驻的流式服务**:连接和模型一直热着,首包才能做到一两百毫秒。`say` 的 1.5 秒不能直接填进预算表,它测的是「冷启动」,不是「首包」。

**念出来比你想的慢得多**:每个字 0.22 秒左右,一秒四五个字。55 个字的回复要念 12 秒。这个数对后面很重要:模拟器里的 `tts_per_char` 我就填 0.22。我第一次写模拟器时凭感觉填的是 0.06(一秒十六七个字),那是快进的语速,真人听起来像机关枪。

`out/` 里有两个 `.aiff` 文件,双击就能听,听完你对「12 秒有多长」会有体感:用户想插一句话,要等 12 秒才轮到他。这个问题明天专门讲。

## 第 4 步:用 asyncio 搭一条模拟流水线

预算表是把每段加起来,但真实流水线里有些段是**重叠**的:LLM 还在写第二句的时候,TTS 已经在念第一句了。要看重叠的效果,就得让它们真的并行跑。我们用 asyncio 搭一个模拟器,每个环节就是一个 `await asyncio.sleep(该环节的耗时)`,不调任何真实服务。

两种跑法对比:

- **非流式**:等 LLM 把整段写完,再整段交给 TTS。
- **流式**:LLM 一边出字,攒够一个短句就放进队列;TTS 从队列里一句一句取出来念。这是 [Day 387](/blog/agent-zero/day-387-queue-basics/) 讲过的生产者-消费者:LLM 是生产者,TTS 是消费者,中间隔一个队列。

这里用到两个 asyncio 的东西,之前没细讲,先解释:

- `asyncio.Queue`:协程之间传东西的队列。`await q.put(x)` 放进去,`await q.get()` 取出来,队列空时 `get` 会等。前端没有完全对应的内置对象,可以想成一个「能 await 取值的数组」,或者 RxJS 里的 Subject。
- `asyncio.create_task(coro)`:让一个协程在后台开跑,不等它。对照 JS,是「调用 async 函数但先不 await 它返回的 Promise」。返回的 task 可以 `.cancel()`。

```python
# agent-zero-lab/part10/voice/voice_sim.py
"""用 asyncio 模拟一条级联语音流水线:VAD 判定说完 -> ASR 最终文本 -> LLM 流式出字 -> TTS 出音频。
所有耗时都是可调参数,不调任何真实服务,用来回答「首个音频包被谁卡住了」。"""
import asyncio
import re
import time
from collections.abc import AsyncIterator
from dataclasses import dataclass, field

SENTENCE_END = re.compile(r"[，。？！,.?!]$")
REPLY = "查到了，您九月三号的年费被扣了两次。多扣的四百六十八元已经提交退款，三个工作日内原路退回。还有别的需要帮忙吗？"


@dataclass
class Latency:  # 单位:秒
    vad_hangover: float = 0.50  # 静音多久才认为用户说完了
    asr_final: float = 0.15  # 说完后 ASR 给出最终文本
    network: float = 0.08  # 往返网络
    llm_ttft: float = 0.45  # LLM 首 token
    llm_per_char: float = 0.012  # 之后每个字
    tts_ttfb: float = 0.20  # TTS 收到文本到吐出第一个音频包
    tts_per_char: float = 0.22  # 念一个字要多久(Day 610 用 say 实测)


@dataclass
class Trace:
    t0: float = field(default_factory=time.perf_counter)
    events: list[tuple[float, str]] = field(default_factory=list)

    def mark(self, name: str) -> None:
        self.events.append((round(time.perf_counter() - self.t0, 3), name))

    def first(self, name: str) -> float | None:
        return next((t for t, n in self.events if n == name), None)


async def llm_stream(text: str, lat: Latency) -> AsyncIterator[str]:
    await asyncio.sleep(lat.llm_ttft)
    for ch in text:
        yield ch
        await asyncio.sleep(lat.llm_per_char)


async def tts_play(chunk: str, lat: Latency, trace: Trace) -> None:
    await asyncio.sleep(lat.tts_ttfb)
    trace.mark("audio_start")
    await asyncio.sleep(lat.tts_per_char * len(chunk))  # 播放这一段
    trace.mark("audio_chunk_done")


async def turn(lat: Latency, streaming: bool, min_chunk: int = 6) -> Trace:
    """用户在 t=0 停止说话,返回这一轮的事件时间线。"""
    trace = Trace()
    await asyncio.sleep(lat.vad_hangover + lat.asr_final + lat.network / 2)
    trace.mark("transcript_ready")
    if not streaming:
        text = "".join([c async for c in llm_stream(REPLY, lat)])
        trace.mark("llm_done")
        await tts_play(text, lat, trace)
        return trace
    q: asyncio.Queue[str | None] = asyncio.Queue()

    async def producer() -> None:
        buf = ""
        async for ch in llm_stream(REPLY, lat):
            buf += ch
            if SENTENCE_END.search(buf) and len(buf) >= min_chunk:
                await q.put(buf)
                buf = ""
        if buf:
            await q.put(buf)
        trace.mark("llm_done")
        await q.put(None)

    async def consumer() -> None:
        while (chunk := await q.get()) is not None:
            await tts_play(chunk, lat, trace)

    prod = asyncio.create_task(producer())
    try:
        await consumer()
    finally:
        prod.cancel()
    return trace
```

<div class="line-notes">

- `from collections.abc import AsyncIterator` 给异步生成器标类型用。`AsyncIterator[str]` 表示「可以 `async for` 遍历、每次给一个 str」,对照 TS 的 `AsyncIterable<string>`。
- `from dataclasses import dataclass, field` [Day 50](/blog/agent-zero/day-050-dataclass/) 学过的 dataclass。
- `SENTENCE_END = re.compile(r"[，。？！,.?!]$")` 第 2 步修好的版本,全角半角都有。
- `class Latency:  # 单位:秒` 七个可调参数,默认值就是第 1 步预算表的数字,只有 `tts_per_char` 用了第 3 步实测的 0.22。
- `vad_hangover: float = 0.50` 静音等待。第 5 步把它改成 0.2,模拟换上语义轮次检测之后的效果。
- `t0: float = field(default_factory=time.perf_counter)` 每个 Trace 创建时记下起点时间。`default_factory` 要传一个函数,创建实例时调用它,这里传的是 `time.perf_counter` 本身(没加括号)。
- `events: list[tuple[float, str]] = field(default_factory=list)` 事件列表,每项是(相对时间, 事件名)。可变默认值必须用 `default_factory=list`,直接写 `= []` dataclass 会报错,Day 50 讲过。
- `self.events.append((round(time.perf_counter() - self.t0, 3), name))` 记一个事件:距起点多少秒(保留 3 位,也就是毫秒)。
- `return next((t for t, n in self.events if n == name), None)` 找第一个叫 `name` 的事件的时间,找不到返回 `None`。`next(生成器, 默认值)` 相当于 JS 的 `events.find(([t, n]) => n === name)?.[0] ?? null`。
- `async def llm_stream(text: str, lat: Latency) -> AsyncIterator[str]:` 一个**异步生成器**:函数体里既有 `await` 又有 `yield`。调用方用 `async for` 遍历它。这就是 JS 的 `async function*`。
- `await asyncio.sleep(lat.llm_ttft)` 先等首 token 时间,默认 0.45 秒。
- `yield ch` 一个字一个字往外给,每给一个再等 `llm_per_char`(0.012 秒)。55 个字写完要 0.45 + 55 × 0.012 = 1.11 秒。
- `trace.mark("audio_start")` TTS 等完首包时间,记一个「开始出声」。整轮里第一个 `audio_start` 就是**首音频**。
- `await asyncio.sleep(lat.tts_per_char * len(chunk))  # 播放这一段` 模拟念这一段的时长。18 个字要等 18 × 0.22 = 3.96 秒。
- `await asyncio.sleep(lat.vad_hangover + lat.asr_final + lat.network / 2)` 用户在 t=0 停止说话,VAD、ASR 和单程网络串着走完,才拿到文字。网络只算一半,另一半算在回程(这里简化,没单独模拟)。所以这一段是 0.5 + 0.15 + 0.04 = 0.69 秒,比预算表少了 40 毫秒。
- `text = "".join([c async for c in llm_stream(REPLY, lat)])` **非流式**:用异步列表推导把整段都收齐再拼起来,等于 JS 里先 `for await` 收进数组再 `join("")`。整段收完才往下走。
- `await tts_play(text, lat, trace)` 整段交给 TTS,首音频 = 0.69 + 1.11 + 0.2 ≈ 2.0 秒。
- `q: asyncio.Queue[str | None] = asyncio.Queue()` 流式分支从这里开始。队列里放字符串(一句话),最后放一个 `None` 表示「写完了」,这种结束标记有个名字叫哨兵值(sentinel)。
- `async for ch in llm_stream(REPLY, lat):` 生产者一个字一个字地收。
- `if SENTENCE_END.search(buf) and len(buf) >= min_chunk:` 以标点结尾**并且**至少 `min_chunk` 个字才送出去。门槛是为了不送「好，」这种太碎的片段,碎了 TTS 的语调会断。默认 6 字,第 5 步会改成 3 字。
- `await q.put(None)` 全部写完,放哨兵,告诉消费者可以收工了。
- `while (chunk := await q.get()) is not None:` 消费者不停地取,取到 `None` 就退出循环。`:=` 是海象运算符,一边赋值一边判断,相当于 JS 的 `while ((chunk = await q.get()) !== null)`。
- `prod = asyncio.create_task(producer())` 让生产者在后台跑,不等它;紧接着当前协程去跑消费者。两边就并行起来了。
- `prod.cancel()` 放在 `finally` 里:不管消费者是正常结束还是被取消,都把生产者也停掉。正常结束时生产者早已跑完,`cancel` 什么也不做;被打断时(明天的内容),它能让 LLM 不再继续生成,省钱。

</div>

再写一个对比脚本:

```python
# agent-zero-lab/part10/voice/experiment.py
"""同一组参数,非流式和流式各跑一次,比较首个音频包出现的时间。"""
import asyncio

from part10.voice.voice_sim import Latency, turn

lat = Latency()
for streaming in (False, True):
    tr = asyncio.run(turn(lat, streaming=streaming))
    label = "流式  " if streaming else "非流式"
    print(label, "首音频", tr.first("audio_start"), "秒  LLM 写完", tr.first("llm_done"), "秒")
```

<div class="line-notes">

- `from part10.voice.voice_sim import Latency, turn` 用包路径导入,所以要在根目录 `-m` 运行。
- `tr = asyncio.run(turn(lat, streaming=streaming))` [Day 67](/blog/agent-zero/day-067-async-2/) 学的入口:开一个事件循环,跑完这个协程再关掉。每次 `asyncio.run` 都是一次独立的「通话」。
- `label = "流式  " if streaming else "非流式"` 三元表达式,相当于 JS 的 `streaming ? "流式  " : "非流式"`。「流式」后面补两个空格是为了和「非流式」对齐。

</div>

```bash
uv run python -m part10.voice.experiment
```

```text
非流式 首音频 2.063 秒  LLM 写完 1.862 秒
流式   首音频 1.557 秒  LLM 写完 1.845 秒
```

这个脚本每次要跑 20 多秒,因为它真的在「念」:流式那轮要把 55 个字一句一句念完,12 秒多。耐心等一下。

两行一对比就看出流式的价值:LLM 写完的时间差不多(1.85 秒左右),但流式在 LLM 还没写完时就开口了,首音频早了 0.5 秒。

我们来手算一下流式的 1.557 秒,对一对模拟器的逻辑:

- 0.69 秒拿到文字(VAD 0.5 + ASR 0.15 + 单程网络 0.04);
- LLM 首 token 0.45 秒;
- 攒第一句:「查到了，」只有 4 个字,不够 6 字的门槛,于是一直攒到「两次。」,共 18 个字,18 × 0.012 = 0.216 秒;
- TTS 首包 0.2 秒。

加起来 0.69 + 0.45 + 0.216 + 0.2 = 1.556 秒,和实跑的 1.557 秒只差 1 毫秒,那是 asyncio 调度本身的开销。这就是模拟器的好处:每一毫秒都说得清来自哪里。也顺便看到了预算表的一个盲点:表里「攒够第一句」填的 100 毫秒,实际因为门槛规则花了 216 毫秒。

## 第 5 步:一次改一个参数

现在做实验。原则是**一次只改一处**,每一行都在上一行的基础上再改一个参数,这样省下的时间能清楚地归到某一项优化上。这和 [Day 145](/blog/agent-zero/day-145-prompt-lab/) 做提示词实验是同一个方法。

```python
# agent-zero-lab/part10/voice/tune.py
"""一次只改一个参数,看首音频怎么变。每一行都在上一行的基础上再改一处。"""
import asyncio
from dataclasses import replace

from part10.voice.voice_sim import Latency, turn

steps = [
    ("基线:默认参数,首句至少 6 字", Latency(), 6),
    ("A 首句门槛 6 字 -> 3 字", Latency(), 3),
    ("B 再把静音等待 0.5 -> 0.2 秒", replace(Latency(), vad_hangover=0.2), 3),
    ("C 再把 LLM 首 token 0.45 -> 0.25 秒", replace(Latency(), vad_hangover=0.2, llm_ttft=0.25), 3),
    ("D 再把 TTS 首包 0.2 -> 0.1 秒", replace(Latency(), vad_hangover=0.2, llm_ttft=0.25, tts_ttfb=0.1), 3),
]
prev = None
for label, lat, min_chunk in steps:
    t = asyncio.run(turn(lat, streaming=True, min_chunk=min_chunk)).first("audio_start")
    assert t is not None
    delta = "" if prev is None else f"  省 {prev - t:.3f}"
    print(f"{t:.3f} 秒{delta}  {label}")
    prev = t
```

<div class="line-notes">

- `from dataclasses import replace` `replace(对象, 字段=新值)` 复制一份 dataclass 并改掉指定字段,原对象不变。相当于 JS 的 `{...lat, vad_hangover: 0.2}`。
- `steps = [` 五组实验,每组是(说明, 参数, 首句门槛)这样一个元组。
- `("A 首句门槛 6 字 -> 3 字", Latency(), 3),` 第一个优化:首句门槛降到 3 字,「查到了，」就能直接送出去。
- `("B 再把静音等待 0.5 -> 0.2 秒", replace(Latency(), vad_hangover=0.2), 3),` 模拟换上语义轮次检测:模型听懂这句话说完了,就不用傻等 0.5 秒静音。LiveKit 文档里开了它的音频轮次检测后,默认最短等待从 0.5 秒降到 0.3 秒,我这里用 0.2 秒是偏乐观的设定。
- `("C 再把 LLM 首 token 0.45 -> 0.25 秒"` 换更快的模型或者把服务器放到离模型厂商更近的地方。
- `prev = None` 记上一行的结果,用来算「这一步省了多少」。
- `assert t is not None` `first()` 的返回类型是 `float | None`,这里断言一下,类型检查器就知道下面 `prev - t` 里的 `t` 是数字,不会画红线。
- `delta = "" if prev is None else f"  省 {prev - t:.3f}"` 第一行没有「上一行」,不显示省了多少。

</div>

```bash
uv run python -m part10.voice.tune
```

```text
1.576 秒  基线:默认参数,首句至少 6 字
1.390 秒  省 0.186  A 首句门槛 6 字 -> 3 字
1.143 秒  省 0.247  B 再把静音等待 0.5 -> 0.2 秒
0.879 秒  省 0.264  C 再把 LLM 首 token 0.45 -> 0.25 秒
0.786 秒  省 0.093  D 再把 TTS 首包 0.2 -> 0.1 秒
```

几个值得多想一下的地方:

**基线这次是 1.576,上一步是 1.557**,同样的参数差了 19 毫秒。asyncio 的 sleep 不是精确定时,每个字一次 `sleep`,几十个字的调度误差会累积。所以「省 0.247」(理论上 B 应该省 0.3)这种数,看量级就好,别抠到个位毫秒。真实系统的抖动比这大得多,所以生产里看的是几百通电话的分布,不是一次的数字。

**A 几乎是免费的**:只改了一个切句门槛,省了 0.19 秒,不花钱、不换供应商。代价是第一句很短,语调可能不太连贯,这个要真人听了才知道。

**B 是这张表里最值得做的**,而且和直觉相反:大家都盯着模型,但静音等待才是最大的那块。语义轮次检测就是来解决它的。用户说「我想查一下……」后面停顿,纯静音判断会以为他说完了;他说「好的」之后,其实不用等那么久。LiveKit 的 turn-detector 和 Pipecat 的 smart-turn 都是用一个小模型,结合说话内容(LiveKit 的新版本直接听音频里的语调)判断这句话是否说完。阿里云文档里的 `semantic_vad` 也是同一个思路。

**C 要花钱或者牺牲质量**:换小模型可能答得更差,而且第 2 步实测 DeepSeek 首 token 中位数是 0.72 秒,不是 0.45,真实情况更难。所以我排优化顺序是:先 A、B 这种免费的,再考虑「工具调用期间先说一句」这种体验上的补救(明天讲),最后才换模型。

到 D 已经 0.79 秒,进了 1 秒以内。但别忘了,这是在一个没有网络抖动、没有工具调用、每段都恰好等于设定值的理想世界里。真实电话里,用户问「我那笔退款到哪了」,Agent 要先调 `list_invoices`,一个工具调用就可能把这 0.79 秒吃掉。

## 动手练习

**练习 1:用实测的首 token 重算。** 把 `llm_ttft` 换成第 2 步实测的 10 个数的中位数和最大值,其他用 B 那一行的设置(静音 0.2 秒,首句门槛 3 字),看首音频离 1 秒目标还差多少。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part10/voice/ex610_real_ttft.py
"""练习 1:把 LLM 首 token 换成 measure_llm.py 实测的中位数,看离 1 秒目标还差多少。"""
import asyncio
import statistics
from dataclasses import replace

from part10.voice.voice_sim import Latency, turn

measured = [1.214, 0.413, 0.509, 0.516, 0.746, 0.852, 1.186, 0.441, 0.698, 0.795]
p50 = statistics.median(measured)
worst = max(measured)
for label, ttft in [("文档量级", 0.45), ("实测中位数", p50), ("实测最慢", worst)]:
    lat = replace(Latency(), llm_ttft=ttft, vad_hangover=0.2)
    t = asyncio.run(turn(lat, streaming=True, min_chunk=3)).first("audio_start")
    print(f"{label:<6} ttft={ttft:.3f}  首音频={t:.3f} 秒")
```

<div class="line-notes">

- `measured = [1.214, 0.413,` 第 2 步两轮共 10 次的 ttft,原样抄过来。
- `p50 = statistics.median(measured)` 标准库的中位数。10 个数排序后中间两个是 0.698 和 0.746,取平均 0.722。
- `worst = max(measured)` 最慢的一次 1.214 秒。只有 10 个样本,算 P95 没意义,所以看最大值。
- `lat = replace(Latency(), llm_ttft=ttft, vad_hangover=0.2)` 每次在默认参数上改两处:首 token 和静音等待。

</div>

```text
文档量级   ttft=0.450  首音频=1.083 秒
实测中位数  ttft=0.722  首音频=1.353 秒
实测最慢   ttft=1.214  首音频=1.843 秒
```

用文档量级时 1.08 秒,勉强及格;换成我实测的中位数就是 1.35 秒,最慢那次 1.84 秒,用户已经要开始「喂」了。结论:**预算表必须用你自己的实测数填**,厂商标称值和社区数字只能起步用。这也说明首 token 的波动(尾部)和中位数一样重要,下一步要按 P95 来定预算。

</details>

**练习 2:回复越长,两种跑法差多少?** 把回复分别重复 1、2、4 遍(55、110、220 字),比较非流式和流式的首音频。提示:只看首音频的话,可以把 `tts_per_char` 调到很小,不然 220 字要真等 48 秒。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part10/voice/ex610_long.py
"""练习 2:回复变长时,非流式和流式的首音频各怎么变。"""
import asyncio
from dataclasses import replace

from part10.voice import voice_sim
from part10.voice.voice_sim import Latency, turn

lat = replace(Latency(), tts_per_char=0.001)  # 只看首音频,播放快进,不然 220 字要真等 48 秒
base = voice_sim.REPLY
for times in (1, 2, 4):
    voice_sim.REPLY = base * times
    naive = asyncio.run(turn(lat, streaming=False)).first("audio_start")
    stream = asyncio.run(turn(lat, streaming=True)).first("audio_start")
    print(f"回复 {len(voice_sim.REPLY):>3} 字  非流式 {naive:.3f} 秒  流式 {stream:.3f} 秒")
voice_sim.REPLY = base
```

<div class="line-notes">

- `from part10.voice import voice_sim` 导入整个模块对象,才能改它的模块级变量 `REPLY`。如果写 `from ... import REPLY`,你改的只是本文件里的一个同名变量,`turn()` 里用的还是原来那个。
- `lat = replace(Latency(), tts_per_char=0.001)  # 只看首音频` 播放速度不影响首音频,只影响整轮跑多久。我第一次没加这行,脚本跑了三分钟还没完。
- `voice_sim.REPLY = base * times` 字符串乘整数就是重复。`turn()` 每次运行时去模块里读 `REPLY`,所以能读到新值。
- `voice_sim.REPLY = base` 改完还原。改模块全局变量是为了练习方便的做法,正式代码里应该把回复作为参数传给 `turn()`。

</div>

```text
回复  55 字  非流式 2.046 秒  流式 1.562 秒
回复 110 字  非流式 2.784 秒  流式 1.561 秒
回复 220 字  非流式 4.157 秒  流式 1.594 秒
```

非流式的首音频随回复长度线性增长(每多 55 字多 0.66 秒左右,正好是 55 × 0.012),流式几乎不变,只和第一句有多长有关。所以语音里流式不是「锦上添花」,是必须的。

</details>

**练习 3:第一段要攒几个字?** 不跑 asyncio,写一个纯函数 `first_chunk(text, min_chunk)`,按 `voice_sim.py` 生产者同样的规则,返回第一段会送给 TTS 的文字。对三条常见开头各试门槛 3 和 6,并按每字 0.012 秒算出攒这一段要多等多少毫秒。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part10/voice/ex610_first_chunk.py
"""练习 3:不跑 asyncio,直接算「第一段要攒几个字才送 TTS」。"""
from part10.voice.voice_sim import SENTENCE_END


def first_chunk(text: str, min_chunk: int) -> str:
    buf = ""
    for ch in text:
        buf += ch
        if SENTENCE_END.search(buf) and len(buf) >= min_chunk:
            return buf
    return buf


for reply in ["查到了，您九月三号的年费被扣了两次。", "好的，我帮您查一下。", "您好！请问有什么可以帮您？"]:
    for n in (3, 6):
        chunk = first_chunk(reply, n)
        print(f"门槛 {n} 字 -> 第一段「{chunk}」{len(chunk)} 字,多等 {len(chunk) * 0.012 * 1000:.0f} ms")
```

<div class="line-notes">

- `from part10.voice.voice_sim import SENTENCE_END` 直接复用模拟器里的正则,保证规则一致。
- `if SENTENCE_END.search(buf) and len(buf) >= min_chunk:` 和生产者里的判断一模一样,只是不 `await q.put`,直接返回。
- `return buf` 整段都没满足条件(比如没有标点),就把整段当第一段。
- `len(chunk) * 0.012 * 1000:.0f` 字数乘每字 0.012 秒再换成毫秒,`.0f` 不要小数。

</div>

```text
门槛 3 字 -> 第一段「查到了，」4 字,多等 48 ms
门槛 6 字 -> 第一段「查到了，您九月三号的年费被扣了两次。」18 字,多等 216 ms
门槛 3 字 -> 第一段「好的，」3 字,多等 36 ms
门槛 6 字 -> 第一段「好的，我帮您查一下。」10 字,多等 120 ms
门槛 3 字 -> 第一段「您好！」3 字,多等 36 ms
门槛 6 字 -> 第一段「您好！请问有什么可以帮您？」13 字,多等 156 ms
```

客服回复的开头大多是「好的，」「您好！」「查到了，」这种两三个字加标点。门槛 6 字等于强迫它攒到第二个标点,多等 100 到 200 毫秒。把逻辑抽成纯函数还有个好处:能写单元测试,不用每次跑十几秒的模拟。

</details>

**练习 4:三个场景各选哪种架构?** ①云簿的退款电话客服;②一个陪老人聊天解闷的 App;③银行的信用卡激活外呼(要核身份)。每个写一两句理由。

<details><summary>参考答案</summary>

这是开放题,我的示范答案:

① 退款客服选级联。退款要查发票、要按规则算金额、要留审计记录,中间那段文字能存档、能做回归评测,出了「它答应给我退 500 块」这种纠纷时有据可查。延迟靠今天的 A、B 两招压。

② 陪聊选端到端。没有严格的业务规则,用户在意的是语气自然、能被插话、能听出情绪,这些恰好是级联在 ASR 那一步丢掉的东西。

③ 银行外呼我还是选级联,或者「端到端说话 + 后台文本 Agent 做核身和业务」的折中。核身份不能凭语音直接放行,要转短信验证码或按键;每一步都要留文字记录给合规审计。如果用折中方案,要特别注意 GPT-Live 文档里那句话:打断说话不会自动取消后台任务,你得自己处理。

</details>

**验收标准**:`budget.py`、`measure_llm.py`(修好全角标点之后)、`measure_tts.py`、`experiment.py`、`tune.py` 都跑通;你自己的 `tune.py` 输出里,B 那一行省下的时间在 0.2 到 0.3 秒之间;能用自己的话说清「为什么最大的一块是 VAD 等待」,以及第 4 步流式首音频 1.557 秒的每一段来自哪里。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| VAD(语音活动检测) | 判断一段音频里有没有人在说话,不懂内容。例:Silero VAD 默认静音 0.55 秒才算一段话结束 |
| ASR / STT(语音识别) | 把音频变成文字;流式 ASR 边听边出中间结果,说完再给最终结果 |
| TTS(语音合成) | 把文字变成音频;生产里用常驻的流式服务,收到第一句就出音频包 |
| 级联方案(cascade / chained) | VAD、ASR、LLM、TTS 串起来的语音 Agent 架构,中间是文字 |
| 端到端实时模型(speech-to-speech) | 直接听音频、出音频的模型,中间不经过文字。例:`gpt-realtime-2.1`、Qwen-Omni Realtime |
| 全双工(full duplex) | 能同时听和说,像打电话;半双工是轮流说,像对讲机。例:GPT-Live-1 |
| 首音频延迟(time to first audio) | 用户停止说话到听见机器人第一个音频包的时间,语音 Agent 最重要的延迟指标 |
| 延迟预算 | 把总的可接受延迟(比如 1 秒)分给每个环节的额度表,哪段超了一眼看出 |
| 静音等待(hangover / endpointing delay) | VAD 看到静音后再等多久才判定用户说完了 |
| 语义轮次检测 | 结合说话内容或语调判断这句话是否说完,而不是只看静音多久 |
| 临时密钥(ephemeral key / client secret) | 后端签发给浏览器的短期凭证,浏览器拿它连实时 API,正式 key 不出后端 |
| 异步生成器 | 既有 `await` 又有 `yield` 的函数,用 `async for` 遍历,相当于 JS 的 `async function*` |
| `asyncio.Queue` | 协程之间传数据的队列,`await put` 放、`await get` 取,空了 `get` 会等 |
| 哨兵值(sentinel) | 放进队列表示「结束了」的特殊值,今天用的是 `None` |

## 常见误区

**以为延迟主要在 LLM。** 今天的预算表里,VAD 的静音等待占 34%,比 LLM 首 token 还多。先量,再优化。上来就换小模型,牺牲了回答质量,省下的可能还没调一个 VAD 参数多。

**切句正则只写了半角标点。** 中文模型输出的是全角「，？！」,半角 `,?!` 匹配不到,第一句会多攒好几个字。今天第 2 步实测里第一句因此从「好的，」变成了「别担心，我先帮您核实扣款记录。」。正则里全角半角都写上。

**整段回复生成完再送 TTS。** 练习 2 里回复 220 字时,非流式首音频 4.16 秒,流式 1.59 秒。流式衔接是最便宜的优化,语音里是必选项。

**拿冷启动当首包。** `say` 每次合成要 1.5 秒,那是起进程、加载音色的开销,不是 TTS 服务的首包。拿这种数字填预算表会严重高估;反过来,如果你的 TTS 服务真是每次请求都冷启动,那它就不适合做语音 Agent。

**凭感觉填语速。** 中文 TTS 实测一秒四五个字(每字 0.22 秒),55 字的回复要念 12 秒。按一秒十几个字估,会严重低估「用户要等多久才能插话」,明天的打断就是从这里开始的。

**只看一次的延迟。** 同一组参数跑两次就差了 19 毫秒,DeepSeek 首 token 10 次里最快最慢差三倍。看分布(中位数、P95),别拿一次的结果下结论。

## 学习资料

### 文档与文章

- [OpenAI:Realtime API 入门](https://developers.openai.com/api/docs/guides/realtime):端到端模型怎么连、临时密钥怎么签发,20 分钟。英文。
- [OpenAI:Voice agents 指南](https://developers.openai.com/api/docs/guides/voice-agents):GPT-Live、Realtime、级联三种架构的官方对比,重点看级联那段讲「中间文字能检查」的好处,20 分钟。英文。
- [OpenAI:GPT-Live-1 模型页](https://developers.openai.com/api/docs/models/gpt-live-1):全双工模型的输入输出和计费方式,5 分钟。英文。
- [阿里云百炼:实时多模态](https://help.aliyun.com/zh/model-studio/realtime):国内端到端实时模型的接入文档,看型号、音频格式和三种 VAD 模式,20 分钟。
- [火山引擎:实时对话式 AI](https://www.volcengine.com/product/veRTC/ConversationalAI):国内厂商打包好的级联方案长什么样,10 分钟。
- [LiveKit:Turn detector](https://docs.livekit.io/agents/build/turns/turn-detector/):今天 B 实验的原型,看开和不开语义轮次检测时默认等待时间分别是多少,15 分钟。英文。
- [Pipecat 文档](https://docs.pipecat.ai/):看 Fundamentals 部分对帧(frame)和流水线的介绍,和今天的模拟器对照,30 分钟。英文。
- [Language Log:Speaker-change offsets](https://languagelog.ldc.upenn.edu/nll/?p=7997):对 Stivers 等人 2009 年论文的转述,今天「人和人接话约 100 毫秒」的数字出自这里,10 分钟。英文。论文原文在 PNAS(doi 10.1073/pnas.0903616106),出版社页面对命令行返回 403,需浏览器打开。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1WtjB6xEto&autoplay=0&high_quality=1" title="22-现代语音智能体：Pipecat和LiveKit" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>Wayne_CFD · 22-现代语音智能体:Pipecat和LiveKit · 10 分钟,两个开源级联框架的整体印象,看它们的流水线和今天的模拟器怎么一一对应。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/jnedfk5PL2A" title="Reduce the Latency of your Voice Agent" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>LiveKit · Reduce the Latency of your Voice Agent · 13 分钟,官方讲延迟优化的几个手段,留意他们怎么量每一段,和今天的预算表一项项对照。</figcaption>
</figure>

### 书籍

- Cathy Pearl《Designing Voice User Interfaces》(O'Reilly, 2016):前两章讲语音交互的基本原则,写于大模型之前,但「用户在等、看不到屏幕」带来的设计约束一条没变,1.5 小时。英文原版。

### 开源项目与代码

- [pipecat-ai/pipecat](https://github.com/pipecat-ai/pipecat):先看 README 里的架构图,了解帧在流水线里怎么流动,30 分钟。
- [livekit/agents](https://github.com/livekit/agents):看 `examples/` 里最简单的语音 Agent 示例,数一数它把 VAD、STT、LLM、TTS 各换成了哪家,20 分钟。
- [pipecat-ai/smart-turn](https://github.com/pipecat-ai/smart-turn):开源的语义轮次检测模型,README 里有它要解决的问题和效果说明,15 分钟。

## 自测

**1. 预算表里最大的一块是什么?为什么很多人第一反应是错的?**

<details><summary>答案</summary>

是 VAD 的静音等待(500 毫秒,占 34%)。很多人第一反应是 LLM 慢,因为文本 Agent 里延迟几乎全在模型上。但语音里,系统要先「确定用户说完了」才能开始干活,而纯靠静音判断,为了不把句中停顿当成说完,只能保守地多等。换成语义轮次检测把等待从 0.5 秒降到 0.2 秒,今天的实验里省了约 0.25 秒,比把 LLM 首 token 从 0.45 降到 0.25 省得还多一点,而且不牺牲回答质量。

</details>

**2. 模拟器里流式首音频是 1.557 秒,按 `budget()` 的思路估是多少?差在哪?**

<details><summary>答案</summary>

按预算表 1.48 秒(其中「攒够第一句」100 毫秒、网络 80 毫秒)。模拟器里网络只算了单程 40 毫秒,少了 40;但「攒够第一句」因为 6 字门槛,「查到了，」4 个字不够,一直攒到「两次。」共 18 字,花了 216 毫秒,多了 116。两项一抵,1.48 - 0.04 + 0.116 ≈ 1.556。预算表的盲点是它把「攒第一句」当成固定值,实际上它取决于切句规则和回复的开头。

</details>

**3. 第 3 步里 `say` 合成 18 个字和 55 个字分别要 1.5 秒和 1.9 秒,这说明了什么?能直接填进预算表的「TTS 首包」吗?**

<details><summary>答案</summary>

说明耗时大头是固定开销(每次起进程、加载音色),和文字长度关系不大。不能填进「TTS 首包」:首包指的是一个已经热着的流式 TTS 服务收到文本到吐出第一个音频包的时间,通常一两百毫秒。`say` 测的是冷启动。它的真正用处是另一个数:念一个字 0.22 秒,由此知道 55 字回复要念 12 秒。

</details>

**4. 级联和端到端各有什么好处?云簿的退款电话你选哪个?**

<details><summary>答案</summary>

级联每段可以单独换供应商、单独评测,中间是文字,能存档、能审计、能做回归;代价是多了两次音频文字互转,延迟高一些,语气靠 TTS 合成,用户的情绪语调在 ASR 那步丢了。端到端延迟低、语气自然、能听出情绪,代价是中间过程看得少,不好查、不好评测。退款电话涉及钱和规则,要能事后核查,我选级联,延迟用切句门槛和语义轮次检测去压。

</details>

**5. 面试题:产品经理说「语音机器人反应太慢,把模型换成最小最快的那个」。你怎么回应?**

<details><summary>答案</summary>

我会先说「先量再换」。把一通电话的首音频拆成 VAD 等待、ASR、网络、LLM 首 token、攒第一句、TTS 首包六段,每段打点,拿几百通真实通话看各段的中位数和 P95,看谁占比最大。我做过的模拟里,默认配置下最大的一块是 VAD 静音等待(约三分之一),其次才是 LLM。优化顺序是先做免费的:降低首句切句门槛、换语义轮次检测、LLM 和 TTS 流式衔接;再做体验补救,比如调工具时先说一句「我帮您查一下」;最后才考虑换模型,而且换之前要在评测集上确认小模型的回答质量可以接受。每一步改完都对比前后的分布,而不是只看平均值。

</details>

## 明天预告

[Day 611](/blog/agent-zero/day-611-voice-2/) 讲语音 Agent(二):打断、工具调用和电话、怎么评测。今天量出来一个让人不安的数:55 个字的回复要念 12 秒。用户在第 3 秒就想插话「不是这单」,机器人得立刻停下,还得记住用户到底听到了哪里。明天在今天的 `voice_sim.py` 上加打断,再看工具调用和电话线路带来的新麻烦,以及语音 Agent 该看哪些指标。
