---
title: 'Day 91 · 语音 Agent:实时对话的延迟预算'
description: '语音 Agent 的难点不在听懂和会说,在时间。今天把「用户说完到听见回应」这一秒多拆成六段,比较级联方案和端到端实时模型,讲清楚轮次检测和打断为什么是最难的部分,再用 asyncio 搭一条可调参数的模拟流水线,亲手把首个音频包的延迟从两秒压到一秒出头。'
pubDate: 2026-10-12
regime: none
tags: ['voice-agent', 'realtime', 'latency', 'turn-detection', 'pipecat', 'livekit', 'asyncio', 'agent-60']
series: 'agent-60'
day: 91
lang: 'zh'
---

## 今天要解决的问题

把 SupportPilot 接上电话,听起来只是在前面加个语音识别、后面加个语音合成。真做起来你会发现,用户最在意的根本不是回答对不对,而是「它怎么半天不说话」和「我一开口它还在那叨叨」。文本 Agent 慢两秒没人在意,语音 Agent 慢两秒,用户就以为电话断了。

所以今天的主角是时间。学完你应该能:

1. 把「用户说完话到听见第一个字」这段延迟拆成具体的几段,知道每段大概多少毫秒、能怎么压。
2. 说清级联方案(ASR、LLM、TTS 三段)和端到端实时模型的取舍,知道 2026 年国内外各有哪些可用的方案。
3. 解释轮次检测(什么时候算用户说完了)和打断(用户插话时怎么停)为什么难,以及 Pipecat、LiveKit 是怎么处理的。
4. 用一条 asyncio 模拟流水线做实验,量化每个参数对首个音频包延迟的影响,并实现一个能在几十毫秒内停下来的打断逻辑。

预计用时 4 小时。前置:Day 4(流式输出)、Day 37(异步与取消)、Day 38(成本与延迟)。

## 人说话的节奏是多少毫秒

先建立一个参照。会话分析领域有一篇常被引用的研究(Stivers 等人 2009 年发在 PNAS 上,比较了十种语言的轮流说话),结论是人和人对话时,一方说完到另一方接话,间隔通常在 200 毫秒上下,不同语言之间差别不大。也就是说,人在对方还没说完时就已经在准备回答了。

机器做不到 200 毫秒,但用户的容忍度大致是这样:一秒以内觉得挺自然,一秒到一秒半能接受,超过两秒就开始怀疑是不是没听见,超过三秒有人会「喂?」。行业里做电话客服的语音 Agent,一般把首个音频包的目标定在一秒左右,P95 不超过一秒半。这些是我和同行交流时的经验值,不是标准,你的业务最好自己测用户的挂断率和重复率。

## 级联还是端到端

两种架构:

<figure>
<svg viewBox="0 0 640 230" role="img" aria-label="级联语音流水线和端到端实时模型的对比">
  <rect x="0" y="0" width="640" height="230" fill="var(--paper-raised)"/>
  <text x="20" y="30" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">级联</text>
  <rect x="70" y="14" width="80" height="30" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
  <text x="110" y="34" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">VAD</text>
  <rect x="170" y="14" width="80" height="30" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
  <text x="210" y="34" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">ASR</text>
  <rect x="270" y="14" width="110" height="30" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
  <text x="325" y="34" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">LLM + 工具</text>
  <rect x="400" y="14" width="80" height="30" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
  <text x="440" y="34" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">TTS</text>
  <line x1="150" y1="29" x2="170" y2="29" stroke="var(--rule)"/>
  <line x1="250" y1="29" x2="270" y2="29" stroke="var(--rule)"/>
  <line x1="380" y1="29" x2="400" y2="29" stroke="var(--rule)"/>
  <text x="500" y="25" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">每段可换供应商</text>
  <text x="500" y="41" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">中间有文本可审计</text>
  <text x="20" y="110" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">端到端</text>
  <rect x="70" y="94" width="80" height="30" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
  <text x="110" y="114" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">VAD</text>
  <rect x="170" y="94" width="310" height="30" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
  <text x="325" y="114" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">语音进、语音出的实时模型(可调工具)</text>
  <line x1="150" y1="109" x2="170" y2="109" stroke="var(--rule)"/>
  <text x="500" y="105" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">延迟低、语气自然</text>
  <text x="500" y="121" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">可控性和可观测差</text>
  <line x1="20" y1="160" x2="620" y2="160" stroke="var(--rule)"/>
  <text x="20" y="186" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">两种都需要:轮次检测、打断处理、回声消除、网络传输(WebRTC / 电话线路)</text>
  <text x="20" y="208" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">差别在中间那一段:三个模型串起来,还是一个模型包圆</text>
</svg>
<figcaption>级联的每一段都能单独换、单独评测;端到端少了中间的文本转换,延迟和语气更好,但你对中间发生了什么看得更少。</figcaption>
</figure>

**级联方案**:VAD(语音活动检测)判断用户在不在说话,ASR 转成文本,LLM 生成回复(可以调工具),TTS 合成语音。好处是每段都能换成最适合的供应商,中文识别可以用国内厂商,LLM 用你已经评测好的那个,TTS 挑音色最好的;中间全是文本,可以记日志、跑评测、做审计,和你前面 88 天学的东西完全接得上。坏处是延迟要加三段,语气靠 TTS 硬合成,用户的情绪、停顿这些信息在 ASR 那一步就丢了。

**端到端实时模型**:一个模型直接听音频、直接出音频,也能调工具。OpenAI 的 Realtime API 已经 GA,官方文档的入门示例用的模型是 `gpt-realtime-2.1`,浏览器里走 WebRTC,服务端走 WebSocket,前端连接用服务端签发的临时密钥(ephemeral key),别把正式 API key 放到浏览器里。国内阿里云百炼有 Qwen-Omni 实时系列模型(帮助中心页面列了 qwen3.5-omni-realtime 等型号),火山引擎有「实时对话式 AI」产品,把 RTC 传输、ASR、大模型、TTS 打包成一套,通过 StartVoiceChat 之类的接口启动会话。型号和价格变化快,用之前以官方页面为准。

怎么选?我的经验是:

- 客服、预约、催收这类**流程固定、要审计、要跑评测**的业务,用级联。中间的文本是你的命根子,出了问题能查,改了提示词能回归。
- 陪聊、口语练习、需要情绪和语气的场景,端到端体验明显更好。
- 很多团队的折中做法是端到端模型负责「说」,复杂的业务判断通过工具调用交给后台的文本 Agent。OpenAI 文档里也提到了这种「前台实时对话、后台委派」的模式。

## 一秒多的延迟花在哪

拿级联方案来拆,从用户停止说话那一刻算起:

| 环节 | 典型值 | 说明 |
| --- | --- | --- |
| VAD 判定说完 | 300–800 ms | 静音多久才算说完,太短会把用户的停顿当成说完 |
| ASR 最终结果 | 100–300 ms | 流式 ASR 一直在出中间结果,这里是等最终结果 |
| 网络 | 50–150 ms | 用户到服务器、服务器到各个模型供应商 |
| LLM 首 token | 200–800 ms | 和模型大小、提示词长度、是否命中缓存有关 |
| 攒够第一句 | 50–200 ms | 要攒出一个能念的短句才送 TTS |
| TTS 首包 | 100–300 ms | 收到文本到吐出第一段音频 |

这些区间来自各家文档的标称值和社区里的实测分享,只能当量级参考。把中间值加起来大概一秒半。最大的一块往往不是 LLM,而是**第一行的 VAD 判定**:很多默认配置要等 0.5 到 0.8 秒静音才认为用户说完了。

所以压延迟的顺序通常是:

1. **轮次检测换成语义模型**。单纯靠静音时长判断太笨,用户说「我想查一下……」后面停顿一下,静音判断会以为他说完了;而他说「好的」之后,其实不用等那么久。LiveKit 的 turn-detector 插件和 Pipecat 的 smart-turn 都是用一个小模型结合说话内容判断这句话是不是说完了,说完了就可以把静音等待缩短。
2. **LLM 和 TTS 流式衔接**,攒够一个短句就送 TTS,不等整段回复。第一句尽量短。
3. **离用户近**,服务器和模型供应商选同一个区域。
4. **工具调用期间先说点什么**。查订单要 800 毫秒,与其沉默,不如先说「好的,我帮您查一下」。这句话可以在决定调工具的那一刻就送 TTS。
5. 最后才是换更小更快的 LLM。

## 打断:比延迟还难

用户在机器人说话时插话,机器人要立刻停下。听起来简单,真做起来有三个坑。

**一是回声。** 电话或扬声器里机器人自己的声音会被麦克风收回去,VAD 以为用户在说话,机器人自己把自己打断了。浏览器端靠 WebRTC 自带的回声消除,电话线路上要靠服务端处理。

**二是误打断。** 用户在机器人说话时说「嗯」「对」,这是附和(backchannel),不是要打断。一律停下的话,对话会变得特别别扭。常见做法是插话超过一定时长、或者识别出的内容不是附和词才算打断。

**三是历史要截断。** 机器人准备说一整段,用户只听了前半句就打断了。如果你把整段回复都写进对话历史,模型会以为用户已经听到了后半句(比如「三个工作日到账」),之后的对话就会出错。正确做法是记下实际播放到了哪里,只把用户真正听到的部分写进历史。OpenAI Realtime API 里有专门的截断操作处理这件事,Pipecat 和 LiveKit 的消息聚合器也在做同样的事。

<figure>
<svg viewBox="0 0 640 170" role="img" aria-label="打断发生时的时间线">
  <rect x="0" y="0" width="640" height="170" fill="var(--paper-raised)"/>
  <text x="20" y="36" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">机器人</text>
  <rect x="90" y="22" width="300" height="22" fill="var(--mem-wash)" stroke="var(--mem)"/>
  <text x="100" y="37" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">已播放:查到了,您九月三号…</text>
  <rect x="390" y="22" width="220" height="22" fill="var(--paper-raised)" stroke="var(--rule)" stroke-dasharray="4 3"/>
  <text x="400" y="37" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">没播:…三个工作日到账</text>
  <text x="20" y="86" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">用户</text>
  <rect x="370" y="72" width="160" height="22" fill="var(--compute-wash)" stroke="var(--compute)"/>
  <text x="380" y="87" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">等一下,不是这单</text>
  <line x1="390" y1="14" x2="390" y2="110" stroke="var(--compute)"/>
  <text x="396" y="124" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">停止点:取消 LLM、清空播放缓冲</text>
  <text x="20" y="152" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">写进历史的只能是「已播放」那部分,虚线部分要丢掉</text>
</svg>
<figcaption>打断时要做三件事:停掉正在播放的音频,取消还在生成的 LLM 请求(省钱),把历史截断到用户实际听到的位置。</figcaption>
</figure>

如果你想看真实实现,Pipecat 和 LiveKit Agents 都开源:

- Pipecat:`src/pipecat/audio/vad/silero.py` 是 VAD,`src/pipecat/audio/turn/smart_turn/base_smart_turn.py` 是语义轮次检测,`src/pipecat/processors/aggregators/llm_response_universal.py` 处理对话上下文的聚合,`src/pipecat/pipeline/task.py` 是流水线任务的运行入口。
- LiveKit Agents:`livekit-agents/livekit/agents/voice/agent_activity.py` 是一轮对话的调度核心,打断和轮次逻辑主要在这里和 `audio_recognition.py`;语义轮次检测在 `livekit-plugins/livekit-plugins-turn-detector/livekit/plugins/turn_detector/multilingual.py`,多语言模型支持中文。

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1DRKb6SEy4&autoplay=0&high_quality=1" title="语音AI Agent如何完美处理“打断”与轮次检测？ | AI Engineer" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>量子菠萝_ · 语音AI Agent如何完美处理「打断」与轮次检测? | AI Engineer · 33 分钟,AI Engineer 大会的分享,把误打断、附和词、语义轮次检测讲得很具体。</figcaption>
</figure>

## 语音场景里的工具调用和电话

工具调用在语音里要多想一步:**用户在等,而且看不到屏幕**。所以:

- 慢工具(查订单、查物流)调用前先说一句过渡语,超过两三秒还没结果,再补一句「还在查,稍等」。
- 回复要为「听」而写:不念长串数字和链接,金额说「四百六十八元」,订单号念后四位;一次只问一个问题。这些要写进语音版的系统提示词,文本版的提示词直接拿来用效果很差。
- 需要用户提供信息时,优先让对方说而不是按键;身份核验这类敏感操作,可以转到按键或短信验证码。

接电话线路时还有一些语音特有的事:电话音频通常是 8 kHz 窄带,ASR 要选支持电话音质的模型;开头要告知用户正在和 AI 对话、通话可能被录音(各地对此有不同的法规要求,上线前要和法务确认);外呼还要遵守当地关于营销电话的规定。

## 怎么评测语音 Agent

文本 Agent 的评测方法都能用,另外加几项语音专属指标:

- **首音频延迟**的 P50 和 P95,按通话记录统计,不要只看平均值。
- **ASR 字错误率**,在你自己业务的录音上测,厂商标称的数字通常是在干净语料上测的。
- **误打断率和漏打断率**:机器人被附和词打断的比例,用户想插话却没停下来的比例。
- **任务完成率**和**转人工率**,这是业务真正关心的。

线上还可以看用户重复同一句话的比例,重复说明没听清或者机器人没听懂。

## 动手练习

**目标**:用 asyncio 搭一条参数可调的模拟流水线,做三组实验,量化每个参数对首音频延迟的影响;实现打断并测出停止耗时。

**第 1 步:建目录。**

```bash
mkdir -p agentops/voice && cd agentops/voice
uv init --python 3.12 && uv add --dev pytest
```

**第 2 步:写模拟器。** 每个环节都是一个可调的延迟参数。重点看 `turn()` 里流式那一支:LLM 和 TTS 用队列并行,LLM 一边出字,攒够一个短句就交给 TTS。

```python
# agentops/voice/voice_sim.py
"""用 asyncio 模拟一条级联语音流水线:VAD 判断说完 -> ASR 出最终文本 -> LLM 流式出字 -> TTS 出音频。
所有耗时都是可调参数,不调任何真实服务。用来回答两个问题:
1) 首个音频包(time to first audio)到底被谁卡住了;
2) 用户插话时,怎么在几百毫秒内把正在说的话停下来。"""
from __future__ import annotations

import asyncio
import re
import time
from dataclasses import dataclass, field


@dataclass
class Latency:            # 单位:秒
    vad_hangover: float = 0.50     # 静音多久才认为用户说完了
    asr_final: float = 0.15        # 说完后 ASR 给出最终文本
    llm_ttft: float = 0.45         # LLM 首 token
    llm_per_char: float = 0.012    # 之后每个字
    tts_ttfb: float = 0.20         # TTS 收到文本到吐出第一个音频包
    tts_per_char: float = 0.06     # 音频时长,大约一秒十几个字
    network: float = 0.08          # 往返网络


REPLY = "查到了,您九月三号的年费被扣了两次。多扣的四百六十八元已经提交退款,三个工作日内原路退回。还有别的需要帮忙吗?"


@dataclass
class Trace:
    t0: float = field(default_factory=time.perf_counter)
    events: list[tuple[float, str]] = field(default_factory=list)

    def mark(self, name: str) -> None:
        self.events.append((round(time.perf_counter() - self.t0, 3), name))

    def first(self, name: str) -> float | None:
        return next((t for t, n in self.events if n == name), None)


async def llm_stream(text: str, lat: Latency):
    await asyncio.sleep(lat.llm_ttft)
    for ch in text:
        yield ch
        await asyncio.sleep(lat.llm_per_char)


async def tts_play(chunk: str, lat: Latency, trace: Trace) -> None:
    await asyncio.sleep(lat.tts_ttfb)
    trace.mark("audio_start")
    await asyncio.sleep(lat.tts_per_char * len(chunk))   # 播放这一段
    trace.mark("audio_chunk_done")


async def turn(lat: Latency, streaming: bool) -> Trace:
    """用户在 t=0 停止说话,返回这一轮的事件时间线。"""
    trace = Trace()
    await asyncio.sleep(lat.vad_hangover + lat.asr_final + lat.network / 2)
    trace.mark("transcript_ready")
    if not streaming:
        text = "".join([c async for c in llm_stream(REPLY, lat)])
        trace.mark("llm_done")
        await tts_play(text, lat, trace)
        return trace
    # LLM 和 TTS 并行:LLM 一边出字,攒够一个短句就放进队列;TTS 从队列里取句子依次播放
    q: asyncio.Queue[str | None] = asyncio.Queue()

    async def producer() -> None:
        buf = ""
        async for ch in llm_stream(REPLY, lat):
            buf += ch
            if re.search(r"[,。?!,.?!]$", buf) and len(buf) >= 6:
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
        prod.cancel()      # 被打断时,上游的 LLM 生成也一起停掉,省 token
    return trace


async def speak_with_barge_in(lat: Latency, interrupt_at: float) -> Trace:
    """机器人在说话,用户在 interrupt_at 秒时插话。要停掉 LLM 和 TTS,并记下停下来的时刻。"""
    trace = Trace()
    bot = asyncio.create_task(turn(lat, streaming=True))
    await asyncio.sleep(interrupt_at)
    trace.mark("user_barge_in")
    bot.cancel()                      # 生产里还要:清空播放缓冲、告诉 LLM 哪些话用户真的听到了
    try:
        await bot
    except asyncio.CancelledError:
        pass
    trace.mark("bot_silenced")
    return trace


def budget(lat: Latency) -> dict[str, float]:
    """首音频延迟的理论构成(不含 LLM 等整句的情况)。"""
    parts = {
        "VAD 判定说完": lat.vad_hangover,
        "ASR 最终结果": lat.asr_final,
        "网络往返": lat.network,
        "LLM 首 token": lat.llm_ttft,
        "攒第一句(约 8 字)": 8 * lat.llm_per_char,
        "TTS 首包": lat.tts_ttfb,
    }
    parts["合计"] = round(sum(parts.values()), 3)
    return parts
```

**第 3 步:写测试。** 用一组很小的延迟参数让测试跑得快。

```python
# agentops/voice/test_voice.py
import asyncio
from voice_sim import Latency, turn, speak_with_barge_in, budget

FAST = Latency(vad_hangover=0.05, asr_final=0.02, llm_ttft=0.05, llm_per_char=0.002,
               tts_ttfb=0.03, tts_per_char=0.004, network=0.01)


def test_streaming_beats_naive():
    naive = asyncio.run(turn(FAST, streaming=False))
    stream = asyncio.run(turn(FAST, streaming=True))
    assert stream.first("audio_start") < naive.first("audio_start")


def test_barge_in_stops_quickly():
    t = asyncio.run(speak_with_barge_in(FAST, interrupt_at=0.3))
    gap = t.first("bot_silenced") - t.first("user_barge_in")
    assert gap < 0.05


def test_budget_sum():
    b = budget(Latency())
    assert abs(b["合计"] - (0.5 + 0.15 + 0.08 + 0.45 + 0.096 + 0.2)) < 1e-6
```

```bash
uv run pytest -q
```

输出大致长这样:`3 passed`。

**第 4 步:做实验。** 用默认参数各跑一次非流式和流式,记录首个音频包的时间:

```python
# agentops/voice/experiment.py
import asyncio
from voice_sim import Latency, turn, budget

lat = Latency()
for streaming in (False, True):
    tr = asyncio.run(turn(lat, streaming=streaming))
    print("流式" if streaming else "非流式", "首音频", tr.first("audio_start"), "秒")
print(budget(lat))
```

按默认参数,非流式的首音频大约在 2.0 秒左右,流式大约 1.55 秒(asyncio 的调度会有几毫秒误差)。流式比你按 `budget()` 估出来的 1.48 秒慢一点,原因在第一句太长:「查到了,」只有 4 个字,不满 6 个字的门槛,于是一直攒到「两次。」才送出去,多等了十几个字。

然后改参数,填表:

| 实验 | 改了什么 | 首音频(秒) |
| --- | --- | --- |
| 基线 | 默认,流式 | |
| A | 首句门槛从 6 字改成 3 字 | |
| B | 在 A 的基础上,vad_hangover 从 0.5 改成 0.2(模拟语义轮次检测) | |
| C | 在 B 的基础上,llm_ttft 从 0.45 改成 0.25 | |
| D | 在 C 的基础上,TTS 首包从 0.2 改成 0.1 | |

我自己跑时,A 大约 1.38 秒,B 大约 1.08 秒。C 和 D 你自己跑。

**第 5 步:测打断。** 调用 `speak_with_barge_in(Latency(), interrupt_at=2.0)`,打印 `bot_silenced` 和 `user_barge_in` 的差,应该在几毫秒级。然后在 `tts_play` 里模拟一个不响应取消的播放(比如用 `time.sleep` 代替 `asyncio.sleep`),再测一次,观察停止耗时变成多少,想想生产里哪些操作可能不响应取消。

**第 6 步(选做):接真实框架。** 照着 Pipecat 或 LiveKit Agents 的官方快速入门,用你选的 ASR、LLM、TTS 跑通一个能对话的语音 Agent,用手机计时测 10 次首音频延迟,和模拟器的估算对比。

**验收标准**:3 个测试通过;实验表填完,并写一段话说明哪个参数对首音频影响最大;第 5 步说清楚阻塞式操作为什么会让打断失效。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| VAD(语音活动检测) | 判断一段音频里有没有人在说话 |
| ASR / TTS | 语音识别 / 语音合成 |
| 级联方案 | VAD、ASR、LLM、TTS 串起来的语音 Agent 架构 |
| 端到端实时模型(speech-to-speech) | 直接输入音频、输出音频的模型,中间不经过文本 |
| 首音频延迟(time to first audio) | 用户说完到听到机器人第一个音频包的时间 |
| 轮次检测(turn detection) | 判断用户这句话是不是说完了、该机器人接话了 |
| 语义轮次检测 | 结合说话内容(不只是静音时长)判断是否说完 |
| 打断(barge-in) | 机器人说话时用户插话,机器人应该停下来 |
| 附和词(backchannel) | 「嗯」「对」「好」这类表示在听、不是要抢话的回应 |
| 回声消除 | 把扬声器放出的声音从麦克风输入里去掉,避免机器人自己打断自己 |
| 临时密钥(ephemeral key) | 服务端签发给浏览器的短期凭证,避免暴露正式 API key |

## 常见误区

**以为延迟主要在 LLM。** 很多时候最大的一块是静音等待。先量,再优化,别一上来就换小模型牺牲质量。

**整段回复生成完再送 TTS。** 首音频直接加上整段生成时间。流式衔接是最便宜的优化。

**打断后把整段回复写进历史。** 模型会以为用户听到了没播出来的部分,后面的对话就错了。

**用文本版的提示词直接做语音。** 长句、列表、链接、精确数字在电话里都是灾难。要单独写一份为「听」设计的提示词。

**只看平均延迟。** 用户记住的是最慢的那几次。看 P95,并且按通话场景分开统计。

## 学习资料

### 文档与文章

- [OpenAI Realtime API 入门](https://developers.openai.com/api/docs/guides/realtime):语音到语音 Agent 的连接方式、临时密钥、从 beta 迁移到 GA 的要点,30 分钟。
- [OpenAI Voice agents 指南](https://developers.openai.com/api/docs/guides/voice-agents):官方对级联和端到端两种架构的比较,20 分钟。
- [Pipecat 文档](https://docs.pipecat.ai/):帧(frame)和流水线的概念,看 Fundamentals 部分,40 分钟。
- [LiveKit Agents 文档](https://docs.livekit.io/agents/)和[轮次检测说明](https://docs.livekit.io/agents/build/turns/turn-detector/):语义轮次检测的原理和配置,30 分钟。
- [阿里云百炼 Qwen-Omni 实时模型](https://help.aliyun.com/zh/model-studio/realtime):国内端到端实时模型的接入文档,看支持的型号和音频格式,20 分钟。
- [火山引擎 实时对话式 AI](https://www.volcengine.com/product/veRTC/ConversationalAI):RTC 加大模型的打包方案,了解国内一体化方案长什么样,15 分钟。
- Stivers 等,Universals and cultural variation in turn-taking in conversation(PNAS, 2009):人类轮流说话间隔的经典研究,按标题搜索,出版社页面对爬虫返回 403,需浏览器打开。

### B 站视频

- 量子菠萝_《语音AI Agent如何完美处理「打断」与轮次检测? | AI Engineer》:已嵌入正文。
- Wayne_CFD《22-现代语音智能体:Pipecat和LiveKit》:10 分钟,两个开源框架的对比,适合先建立整体印象。

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1WtjB6xEto&autoplay=0&high_quality=1" title="22-现代语音智能体：Pipecat和LiveKit" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>Wayne_CFD · 22-现代语音智能体:Pipecat和LiveKit · 10 分钟,看两者在架构上的差别。</figcaption>
</figure>

### 其他经典视频

- LiveKit《Reduce the Latency of your Voice Agent》:13 分钟,官方讲延迟优化的几个手段,和今天的延迟表一一对应。

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/jnedfk5PL2A" title="Reduce the Latency of your Voice Agent" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>LiveKit · Reduce the Latency of your Voice Agent · 13 分钟,留意他们怎么量每一段的延迟。</figcaption>
</figure>

- AI Engineer《Full Workshop: Realtime Voice AI — Mark Backman, Daily》:70 分钟,Pipecat 团队的完整工作坊,从零搭一个语音 Agent,想动手接真实框架时看。

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/nxuTVd7v7dg" title="Full Workshop: Realtime Voice AI — Mark Backman, Daily" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>AI Engineer · Full Workshop: Realtime Voice AI — Mark Backman, Daily · 70 分钟,配合第 6 步选做练习。</figcaption>
</figure>

### 书籍

- Cathy Pearl《Designing Voice User Interfaces》(O'Reilly, 2016):第 2 章「Basic Voice User Interface Design Principles」,讲确认策略、错误处理、延迟和新老用户,虽然写于大模型之前,语音交互的原则一条没过时,1.5 小时。英文原版。

### 开源项目与代码

- [pipecat-ai/pipecat](https://github.com/pipecat-ai/pipecat):读 `src/pipecat/audio/turn/smart_turn/base_smart_turn.py` 和 `src/pipecat/processors/aggregators/llm_response_universal.py`。
- [livekit/agents](https://github.com/livekit/agents):读 `livekit-agents/livekit/agents/voice/agent_activity.py` 里处理打断的部分。
- [pipecat-ai/smart-turn](https://github.com/pipecat-ai/smart-turn):开源的语义轮次检测模型,README 里有训练数据和效果说明。

## 自测

**1. 首音频延迟里,通常最大的一块是什么?怎么压?**

<details><summary>答案</summary>

很多时候是 VAD 判定用户说完的静音等待,默认配置常在 0.5 到 0.8 秒。压法是换成语义轮次检测,结合说话内容判断是否说完,说完了就缩短静音等待;没说完(比如「我想查一下……」)就多等一会儿。

</details>

**2. 级联方案和端到端实时模型,客服场景你选哪个?为什么?**

<details><summary>答案</summary>

流程固定、要审计、要跑评测的客服场景我倾向级联。中间有文本,能记日志、做回归评测、做合规审计,各段可以换成最适合中文和电话音质的供应商。端到端延迟和语气更好,但可控性和可观测性差,适合陪聊、口语练习这类体验优先的场景。也可以折中:前台用实时模型说话,业务判断通过工具交给后台的文本 Agent。

</details>

**3. 用户打断后,为什么不能把机器人准备说的整段话写进对话历史?**

<details><summary>答案</summary>

用户只听到了被打断之前的部分。整段写进去,模型会以为用户已经知道了后半段内容(比如到账时间),后续回答会出现「刚才说过了」这类错误。应该记录实际播放到的位置,只把这部分写进历史。

</details>

**4. 你的模拟器里,为什么流式方案实测比 budget() 估算的慢?怎么改?**

<details><summary>答案</summary>

budget() 假设第一句约 8 个字就送 TTS,但实际的切句逻辑要求至少 6 个字且以标点结尾。「查到了,」只有 4 个字不够门槛,要一直攒到下一个标点,多等了十几个字的生成时间。把首句门槛降低(比如 3 个字),或者第一句单独用更宽松的规则,首音频就能接近估算值。

</details>

**5. 资深面试题:设计一个电话客服语音 Agent,目标是首音频 P95 小于 1.5 秒,并且能查订单、发起退款。你怎么设计,怎么验证达标?**

<details><summary>答案</summary>

架构选级联,方便审计和评测:电话线路接入后做回声消除和 VAD,语义轮次检测缩短静音等待;ASR 用支持 8 kHz 电话音质、在自己录音上测过字错误率的模型;LLM 用评测选出的模型,提示词单独为语音写,流式输出,首句尽量短;TTS 选首包快的。查订单是只读工具,调用前先播过渡语;发起退款是写操作,需要通过短信验证码或转人工确认,不能凭语音直接执行。打断处理包括附和词过滤、取消 LLM 请求、截断历史。

验证:每一段都打点,按通话记录统计首音频的 P50、P95 和各段占比;上线前用录好的测试通话做压测(不同网络、不同口音、插话场景),看 P95 和误打断率;上线后灰度,看转人工率、用户重复率、挂断率。哪一段占比最大就优先优化哪一段,并且每次改动都对比前后的分布,而不是只看平均值。

</details>

## 明天预告

Day 92 讲 Deep Research Agent:长链路检索、规划和写作。语音 Agent 拼的是几百毫秒,Deep Research 拼的是几十分钟的长任务:先把问题拆成研究提纲,派好几个子 Agent 并行搜索和阅读,压缩成笔记,最后写成带引用的报告。我们会对照 LangChain 的 open_deep_research 和 GPT Researcher 的源码,讲清楚质量怎么评、成本怎么控,自己实现一个引用核验器。
