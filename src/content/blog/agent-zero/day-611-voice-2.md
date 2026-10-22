---
title: 'Day 611 · 语音 Agent(二):打断、工具调用和电话、怎么评测'
description: '机器人一段话要念 12 秒,用户第 3 秒就想插话。今天在 Day 610 的模拟器上加打断:停掉播放和生成,只把用户真正听到的字写进历史(真模型实测:写全文时它会以为用户已经知道退款金额,直接说再见);再分清附和和插话,演示一个阻塞调用怎么让打断晚了 1.9 秒;然后看语音里的工具调用和电话线路,最后用 500 通模拟电话算 P50、P95,看过渡语能把 P95 从 2.74 秒压到 1.97 秒。'
pubDate: 2026-10-22
regime: none
tags: ['voice-agent', 'barge-in', 'asyncio', 'evals', 'agent-zero']
series: 'agent-zero'
day: 611
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 610](/blog/agent-zero/day-610-voice-1/) 先看了人和人接话有多快(跨语言中位数大约 100 毫秒),比较了级联和端到端两种架构,然后把「用户说完到听见第一个字」拆成六段做了一张延迟预算表。最大的一块不是 LLM,是 VAD 的静音等待;用 asyncio 模拟器一次改一个参数,首音频从 1.58 秒压到了 0.79 秒。

那天还量出一个让人不安的数:用 macOS 的 `say` 念中文,一个字 0.22 秒,55 个字的标准客服回复要念 12 秒。12 秒里用户完全可能想插一句「等一下,不是这单」。今天就从这里接着讲:用户插话时机器人该怎么办。

## 今天要解决的问题

学完今天你应该能:

1. 讲清**打断**(barge-in)时要做的三件事:停掉播放、取消还在生成的回复、把对话历史截断到用户真正听到的位置;并在模拟器里实现它,量出停止耗时。
2. 分清**附和**和真正的插话,写一个规则判断器,并在带标签的样本上算误打断率和漏打断率。
3. 说出语音里工具调用和电话线路的特殊之处:过渡语、为「听」写的提示词、8 kHz 窄带音频。
4. 知道语音 Agent 要看哪些指标,用 500 通模拟电话算出首音频的 P50、P95,说清为什么不能只看平均值。

今天两个新概念:**打断**和**语音 Agent 的评测指标**。工具调用和电话那一节用的都是学过的东西,只是放进语音里换了个角度看。会用到:Day 610 的 `voice_sim.py`(今天在它上面扩展)、`asyncio.create_task` 和 `cancel`([Day 610](/blog/agent-zero/day-610-voice-1/) 第 4 步)、事件循环([Day 66](/blog/agent-zero/day-066-async-1/))、误杀和漏放两种错误([Day 410](/blog/agent-zero/day-410-guardrails-2/))、分位数和不能只看平均([Day 401](/blog/agent-zero/day-401-latency/))。

预计用时 3 小时。前置:Day 610 全部跑通,`part10/voice/voice_sim.py` 和 `part10/voice/out/first.aiff` 都在。

学法:先对照文章逐行敲一遍(不复制粘贴)并跑通;第二天合上文章,把 `barge_in.py` 里的 `speak_with_barge_in` 和 `play_tracked` 默写出来;做练习,做不出再展开参考答案,看完关掉自己重写一遍。

## 打断:比延迟还难

用户在机器人说话时插话,机器人要马上停。听起来就是「检测到人声就 `cancel()`」,真做起来要回答三个问题:

- **停什么**:正在播放的音频要停,播放缓冲里排着的也要清空;LLM 如果还在生成,也要取消。
- **什么算插话**:用户说「嗯」「对」是在表示「我在听」,这叫**附和**(backchannel),不是要抢话。一律停下,对话会变得特别别扭,机器人每句话都说不完。
- **历史怎么记**:机器人准备说一整段,用户只听了前半句。对话历史里该记哪一部分?

还有一个藏在底下的问题:**回声**。电话或者外放的扬声器里,机器人自己的声音会被麦克风收回去,VAD 以为用户在说话,机器人自己把自己打断了。浏览器里靠 WebRTC 自带的回声消除(你在前端用 `getUserMedia({ audio: { echoCancellation: true } })` 时打开的就是它),电话线路上要靠服务端或者语音平台处理。今天的模拟器里没有回声,知道有这么回事就行。

<figure>
<svg viewBox="0 0 640 190" role="img" aria-label="打断发生时的时间线:机器人已经播放了前九个字,用户在第三秒插话,停止点之后的内容没有播出,只有已播放部分写进历史">
  <rect x="0" y="0" width="640" height="190" fill="var(--paper-raised)"/>
  <text x="16" y="40" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">LLM 写出</text>
  <rect x="100" y="26" width="120" height="22" fill="var(--mem-wash)" stroke="var(--mem)"/>
  <text x="108" y="41" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">55 字,1.1 秒写完</text>
  <text x="16" y="84" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">机器人念</text>
  <rect x="100" y="70" width="250" height="22" fill="var(--mem-wash)" stroke="var(--mem)"/>
  <text x="108" y="85" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">已播放:查到了，您九月三号</text>
  <rect x="350" y="70" width="270" height="22" fill="var(--paper-raised)" stroke="var(--rule)" stroke-dasharray="4 3"/>
  <text x="358" y="85" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">没播:…的年费被扣了两次。多扣的…</text>
  <text x="16" y="128" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">用户</text>
  <rect x="340" y="114" width="150" height="22" fill="var(--compute-wash)" stroke="var(--compute)"/>
  <text x="348" y="129" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">对对，就是那笔</text>
  <line x1="350" y1="18" x2="350" y2="150" stroke="var(--compute)"/>
  <text x="356" y="164" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">t=3.0 秒:停播放、清缓冲、取消生成</text>
  <text x="16" y="182" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">写进历史的只能是实线那段,虚线部分用户根本没听到</text>
</svg>
<figcaption>LLM 写得比 TTS 念得快得多:55 个字 1.1 秒就写完了,念要 12 秒。所以打断发生时,「模型写出来的」和「用户听到的」往往差了一大截。</figcaption>
</figure>

## 第 1 步:在模拟器上加打断

Day 610 的 `tts_play` 是「等首包,然后一口气 sleep 这一段的时长」,不知道念到了第几个字。要知道用户听到了哪里,得一个字一个字地念,念完一个记一个。新建一个文件,复用 `voice_sim.py` 里的东西:

```python
# agent-zero-lab/part10/voice/barge_in.py
"""在 Day 610 的模拟器上加打断:用户插话时停掉 TTS 和 LLM,并记下用户实际听到了哪些字。"""
import asyncio
from dataclasses import dataclass, replace

from part10.voice.voice_sim import REPLY, SENTENCE_END, Latency, Trace, llm_stream


@dataclass
class Playback:
    generated: str = ""  # LLM 已经写出来的字
    heard: str = ""  # 已经念给用户听的字


async def play_tracked(chunk: str, lat: Latency, trace: Trace, pb: Playback) -> None:
    await asyncio.sleep(lat.tts_ttfb)
    trace.mark("audio_start")
    for ch in chunk:  # 一个字一个字地念,念完一个才算用户听到
        await asyncio.sleep(lat.tts_per_char)
        pb.heard += ch


async def speak(lat: Latency, trace: Trace, pb: Playback, min_chunk: int = 3) -> None:
    q: asyncio.Queue[str | None] = asyncio.Queue()

    async def producer() -> None:
        buf = ""
        async for ch in llm_stream(REPLY, lat):
            pb.generated += ch
            buf += ch
            if SENTENCE_END.search(buf) and len(buf) >= min_chunk:
                await q.put(buf)
                buf = ""
        if buf:
            await q.put(buf)
        trace.mark("llm_done")
        await q.put(None)

    prod = asyncio.create_task(producer())
    try:
        while (chunk := await q.get()) is not None:
            await play_tracked(chunk, lat, trace, pb)
    finally:
        prod.cancel()


async def speak_with_barge_in(lat: Latency, interrupt_at: float) -> tuple[Trace, Playback]:
    trace, pb = Trace(), Playback()
    bot = asyncio.create_task(speak(lat, trace, pb))
    await asyncio.sleep(interrupt_at)
    trace.mark("user_barge_in")
    bot.cancel()
    try:
        await bot
    except asyncio.CancelledError:
        pass
    trace.mark("bot_silenced")
    return trace, pb


if __name__ == "__main__":
    lat = replace(Latency(), vad_hangover=0.0, asr_final=0.0, network=0.0)  # 从机器人开口前一刻算起
    trace, pb = asyncio.run(speak_with_barge_in(lat, interrupt_at=3.0))
    barge, silenced = trace.first("user_barge_in"), trace.first("bot_silenced")
    assert barge is not None and silenced is not None
    print("插话时刻", barge, "秒  停下时刻", silenced, "秒  停止耗时", round((silenced - barge) * 1000), "ms")
    print("LLM 已写出", len(pb.generated), "字:", pb.generated)
    print("用户听到  ", len(pb.heard), "字:", pb.heard)
```

<div class="line-notes">

- `from part10.voice.voice_sim import REPLY, SENTENCE_END, Latency, Trace, llm_stream` Day 610 建的模拟器,回复文本、切句正则(全角半角都有那版)、参数、事件记录和假 LLM 都直接拿来用。
- `class Playback:` 两个字符串记两件事:模型写到哪了,用户听到哪了。打断时这两个数的差,就是今天的重点。
- `for ch in chunk:  # 一个字一个字地念` 和 Day 610 的区别就在这:每个字单独 sleep 0.22 秒,sleep 完才把这个字加进 `heard`。被取消时,正在念的那个字不算听到。
- `pb.heard += ch` 字符串拼接,相当于 JS 的 `pb.heard += ch`。Python 的字符串不可变,每次其实是生成一个新字符串,几十个字无所谓。
- `async def speak(lat: Latency, trace: Trace, pb: Playback, min_chunk: int = 3) -> None:` 基本就是 Day 610 `turn()` 的流式分支,首句门槛直接用 Day 610 实验 A 得出的 3 字。去掉了前面 VAD、ASR 那段等待,因为今天关心的是「机器人开口之后」。
- `pb.generated += ch` 生产者每收到一个字就记下来,这样打断时能看到 LLM 已经写了多少。
- `prod.cancel()` 机器人被取消时,`speak` 里的 `finally` 会执行,把生产者(LLM)也取消。真实系统里这一步就是关掉 LLM 的流式连接,后面的 token 不再生成,也不再计费。
- `bot = asyncio.create_task(speak(lat, trace, pb))` 机器人在后台开始说话。
- `await asyncio.sleep(interrupt_at)` 模拟用户在第 `interrupt_at` 秒插话。真实系统里,这里是 VAD 回调或者 Realtime API 的 `input_audio_buffer.speech_started` 事件。
- `bot.cancel()` 请求取消机器人这个任务。注意 `cancel()` 只是「请求」:它会在 `bot` 下一次停在 `await` 上时,往里抛一个 `CancelledError`。如果 `bot` 一直不 `await`,它就一直停不下来,第 2 步专门演示这个。
- `await bot` 等它真的停下来。它停下时会抛出 `CancelledError`,我们预期到了,所以 `except ... pass` 吞掉。
- `lat = replace(Latency(), vad_hangover=0.0, asr_final=0.0, network=0.0)` 把机器人开口之前那几段都置 0,时间从「机器人准备说话」算起,方便看。

</div>

```bash
cd agent-zero-lab
uv run python -m part10.voice.barge_in
```

```text
插话时刻 3.0 秒  停下时刻 3.001 秒  停止耗时 1 ms
LLM 已写出 55 字: 查到了，您九月三号的年费被扣了两次。多扣的四百六十八元已经提交退款，三个工作日内原路退回。还有别的需要帮忙吗？
用户听到   9 字: 查到了，您九月三号
```

停止耗时 1 毫秒,很快。但看后两行:**LLM 早就把 55 个字全写完了,用户只听到 9 个字**。原因是写比念快得多:写 55 字要 0.45 + 55 × 0.012 ≈ 1.1 秒,念要 12 秒。

这里有两个推论:

- 「打断时取消 LLM 能省钱」,在短回复里基本省不到什么,第 3 秒时早写完了。回复很长、或者模型在思考、或者后面还排着工具调用时,取消才真正省钱。`prod.cancel()` 还是要写,它不贵,而且漏了它的话,被打断的 LLM 流可能还在后台占着一个连接。
- 真正要紧的是第三件事:**历史里写哪一段**。`generated` 和 `heard` 差了 46 个字,其中包括金额和到账时间。

## 第 2 步:历史写错了会怎样

用真模型试一下。系统提示词里放查询结果(真实系统里这是工具结果),然后造两种历史:一种把 LLM 写出来的全文当作机器人说过的话,一种只写用户听到的 9 个字,后面加一句注明被打断了。用户插的话是「对对,就是那笔」,接着说「行,那就这样吧,谢谢」,看机器人怎么收尾。

```python
# agent-zero-lab/part10/voice/history_cut.py
"""打断之后,历史里写「LLM 写出来的」还是「用户听到的」?让模型分别接着聊,看差别。"""
from common.llm import LLMClient

SYSTEM = ("你是云簿 CloudLedger 的电话客服,回答会被念给用户听,每句不超过 15 个字。"
          "查询结果:九月三号年费 468 元被扣了两次,多扣的已提交退款,三个工作日原路退回。")
GENERATED = "查到了，您九月三号的年费被扣了两次。多扣的四百六十八元已经提交退款，三个工作日内原路退回。还有别的需要帮忙吗？"
HEARD = "查到了，您九月三号"
FOLLOW_UP = "对对，就是那笔。行，那就这样吧，谢谢。"

histories = {
    "写全文": GENERATED,
    "写听到的": HEARD + "……(用户插话,后面的话没有播出)",
}
llm = LLMClient()
for label, said in histories.items():
    for i in range(3):
        r = llm.chat([
            {"role": "system", "content": SYSTEM},
            {"role": "user", "content": "我九月的年费好像被扣了两次。"},
            {"role": "assistant", "content": said},
            {"role": "user", "content": FOLLOW_UP},
        ])
        print(f"{label} 第{i + 1}次: {r.content}")
print(llm.ledger)
```

<div class="line-notes">

- `"查询结果:九月三号年费 468 元被扣了两次` 两种历史里模型都知道事实,区别只在于它以为自己**说过**什么。
- `GENERATED = "查到了，您九月三号的年费` 第 1 步里 LLM 写出来的全文,原样复制。
- `HEARD = "查到了，您九月三号"` 第 1 步里用户实际听到的 9 个字。
- `"写听到的": HEARD + "……(用户插话,后面的话没有播出)",` 截断后加一句标注,让模型知道话没说完。不加标注也可以,但加了它更容易意识到要补说。
- `for i in range(3):` 每种跑 3 次,一次不算数,[Day 112](/blog/agent-zero/day-112-sampling-2/) 讲过模型输出不稳定。
- `{"role": "assistant", "content": said},` 机器人说过的话,放在 assistant 消息里。这一条就是两组实验唯一的不同。

</div>

```bash
uv run python -m part10.voice.history_cut
```

```text
写全文 第1次: 不客气，退款三个工作日到账。祝您生活愉快！
写全文 第2次: 不客气，退款到账后会有通知。再见！
写全文 第3次: 不客气，感谢您的来电，再见！
写听到的 第1次: 多扣的468元已提交退款。
写听到的 第2次: 多扣的468元已提交退款，三个工作日内原路退回。
写听到的 第3次: 多扣的468元已提交退款，三个工作日内原路退回。
6 次调用 | 输入 702 / 输出 76 tokens | 约 ¥0.0020
```

差别很明显。「写全文」那组,模型以为自己已经把金额和到账时间说过了,用户说「那就这样吧」,它就道别,第 3 次连退款两个字都没提。可用户实际只听到了「查到了,您九月三号」,挂了电话还不知道退了多少、多久到。「写听到的」那组,三次都主动把金额补上了,两次连到账时间也说了。

这就是为什么打断后**只能把用户真正听到的部分写进历史**。各家框架都在做这件事:OpenAI Realtime 走 WebSocket 时,要客户端自己发 `conversation.item.truncate`,带上 `audio_end_ms`(实际播放到第几毫秒),服务端会删掉没播出那部分的转写;走 WebRTC 时服务端知道播放进度,会自动截断。Pipecat 和 LiveKit 的上下文聚合器也做同样的事。这里有个真实的坑:openai-agents-python 在 2026 年 8 月合并过一个修复,原来用「从第一个音频包算起过了多少墙钟时间」当作播放进度,中间有停顿时这个时间会超过实际收到的音频长度,截断请求就越界了。说白了,**播放进度要按真正播出去的音频算,不能按时钟算**,和我们的 `play_tracked` 一个字一个字记是一个道理。

还有一个小发现:「写听到的」那组回答里出现了「468元」这种阿拉伯数字,系统提示词里没要求金额用中文读法。好的 TTS 能把它念对,但电话里「四百六十八」比「四六八」清楚得多。第 4 步专门讲为「听」写提示词。

花费:6 次调用,¥0.0020。

## 第 3 步:一个不让出事件循环的调用

第 1 步里停止耗时只有 1 毫秒,是因为 `play_tracked` 每个字都 `await asyncio.sleep(...)`,每次 `await` 都给了 `cancel()` 一个机会。如果播放的那段代码里有一个**阻塞调用**呢?比如某个音频库的同步 `write()`,或者你在协程里用了 `time.sleep`。

故意造一次。把「念」换成 `time.sleep` 一口气念完一整段:

```python
# agent-zero-lab/part10/voice/blocking_demo.py
"""把「念一个字」换成不让出事件循环的 time.sleep,看打断还灵不灵。"""
import asyncio
import time
from dataclasses import replace

from part10.voice import barge_in
from part10.voice.barge_in import Playback, speak_with_barge_in
from part10.voice.voice_sim import Latency, Trace


async def play_blocking(chunk: str, lat: Latency, trace: Trace, pb: Playback) -> None:
    await asyncio.sleep(lat.tts_ttfb)
    trace.mark("audio_start")
    time.sleep(lat.tts_per_char * len(chunk))  # 一整段一口气「念完」,期间事件循环被卡住
    pb.heard += chunk


barge_in.play_tracked = play_blocking
lat = replace(Latency(), vad_hangover=0.0, asr_final=0.0, network=0.0)
trace, pb = asyncio.run(speak_with_barge_in(lat, interrupt_at=3.0))
barge, silenced = trace.first("user_barge_in"), trace.first("bot_silenced")
assert barge is not None and silenced is not None
print("插话时刻", barge, "秒  停下时刻", silenced, "秒  停止耗时", round((silenced - barge) * 1000), "ms")
print("用户听到", len(pb.heard), "字:", pb.heard)
print("用户其实在 3.0 秒开口,真实停止耗时", round((silenced - 3.0) * 1000), "ms")
```

<div class="line-notes">

- `time.sleep(lat.tts_per_char * len(chunk))  # 一整段一口气「念完」` `time.sleep` 是同步的,它睡着的时候整个线程都停了,事件循环也停了,别的协程一个都跑不了。相当于在浏览器主线程里写一个 `while (Date.now() < end) {}` 死等,页面上所有事件回调都得排队。
- `barge_in.play_tracked = play_blocking` 运行时把模块里的函数换掉,这种做法叫猴子补丁(monkeypatch)。`speak()` 里调用的是 `play_tracked` 这个模块级名字,换掉之后它调到的就是阻塞版。只在演示和测试里这么干。
- `print("用户其实在 3.0 秒开口` 关键的一行:「插话时刻」是代码**注意到**插话的时刻,不一定是用户真正开口的时刻。

</div>

```bash
uv run python -m part10.voice.blocking_demo
```

```text
插话时刻 4.864 秒  停下时刻 4.864 秒  停止耗时 0 ms
用户听到 18 字: 查到了，您九月三号的年费被扣了两次。
用户其实在 3.0 秒开口,真实停止耗时 1864 ms
```

这个输出很容易骗人。第一行说停止耗时 0 毫秒,看着比第 1 步还好。但「插话时刻」变成了 4.864 秒:用户 3.0 秒开口,我们的代码 4.864 秒才醒过来。原因是 `speak_with_barge_in` 里那个 `await asyncio.sleep(interrupt_at)` 本该在 3.0 秒醒,可事件循环正卡在 `time.sleep` 里念第二段(14 个字,3.08 秒),等它念完,醒过来的协程才有机会跑。用户多听了 1.86 秒,机器人把「的年费被扣了两次。」也念完了。

两个教训:

- **语音的热路径里不能有阻塞调用**。音频读写、同步 HTTP 请求、CPU 重的处理(比如在协程里跑一个本地模型),都要么换成异步版,要么用 `asyncio.to_thread(...)` 丢到线程里去。[Day 66](/blog/agent-zero/day-066-async-1/) 讲事件循环时说过,一个协程不让出,所有协程都得等。
- **延迟要从用户的视角量**。用代码里「注意到」的时刻当起点,阻塞造成的延迟就被藏起来了。真实系统里起点应该是 VAD 检测到人声的那个音频帧的时间戳,而不是回调被执行的时刻。

## 第 4 步:附和还是插话

第 1 步是「有声音就停」。现在给它加一道判断:用户出了声,是附和还是真要插话?

先写一个规则版。思路是两条:识别出来的文字如果是纯附和词(嗯、对、好的),不停;否则,说了 300 毫秒以上或者识别出两个字以上,就停。然后准备 14 条带人工标签的样本,算两种错误率:

- **误打断率**:用户只是附和,机器人却停了。对应 [Day 410](/blog/agent-zero/day-410-guardrails-2/) 里的「误杀」。
- **漏打断率**:用户真要插话,机器人却没停。对应「漏放」。

```python
# agent-zero-lab/part10/voice/backchannel.py
"""机器人说话时用户出了声:是附和(别停),还是真要插话(马上停)?先用规则判,再在一组带标签的样本上算两种错误率。"""
BACKCHANNELS = {"嗯", "嗯嗯", "对", "对对", "好", "好的", "是", "是的", "哦", "啊", "行"}


def is_barge_in(text: str, speech_ms: int) -> bool:
    words = text.strip("，。！？,.!? ")
    if words in BACKCHANNELS:
        return False  # 纯附和词,不管多长都不停
    return speech_ms >= 300 or len(words) >= 2  # 说了 0.3 秒以上,或者识别出两个字以上的内容


# (ASR 出来的文字, 用户出声多少毫秒, 人工标注:真想打断吗)
SAMPLES = [
    ("嗯", 180, False), ("对对", 350, False), ("好的", 400, False), ("嗯嗯", 500, False),
    ("哦", 120, False), ("是", 150, False),
    ("等一下", 450, True), ("不是这单", 600, True), ("我问的是十月", 900, True),
    ("停", 200, True), ("不对", 300, True), ("喂", 250, True),
    ("嗯不对", 500, True), ("对，那个退款", 800, True),
]

if __name__ == "__main__":
    false_stop = [s for s in SAMPLES if not s[2] and is_barge_in(s[0], s[1])]
    missed = [s for s in SAMPLES if s[2] and not is_barge_in(s[0], s[1])]
    n_back = sum(1 for s in SAMPLES if not s[2])
    n_real = len(SAMPLES) - n_back
    print(f"误打断率 {len(false_stop)}/{n_back}  {false_stop}")
    print(f"漏打断率 {len(missed)}/{n_real}  {missed}")
```

<div class="line-notes">

- `BACKCHANNELS = {"嗯", "嗯嗯",` 一个集合(set),用来快速判断「在不在里面」,相当于 JS 的 `new Set([...])`,`in` 就是 `.has()`。
- `words = text.strip("，。！？,.!? ")` 去掉两头的标点和空格。`strip` 的参数是「要去掉的字符集合」,不是一个整体字符串。ASR 结果常带标点,不去掉的话「嗯。」就不在附和词表里了。
- `if words in BACKCHANNELS:` 纯附和词一律不停。哪怕用户「嗯嗯」了 500 毫秒。
- `return speech_ms >= 300 or len(words) >= 2` 其他情况,说得够长或者内容够多就算插话。300 毫秒和 2 个字这两个阈值是我拍的,真实系统要在你自己的录音上调。
- `("嗯", 180, False),` 每条样本是一个三元组。样本是我手编的,不是真实录音,只用来演示怎么算这两个率。
- `("嗯不对", 500, True),` 故意放了两条「附和词开头、后面跟着真内容」的,看规则会不会被开头骗过去。
- `false_stop = [s for s in SAMPLES if not s[2] and is_barge_in(s[0], s[1])]` 标签是「不想打断」但规则判成了「停」的,就是误打断。`s[2]` 是元组的第三项。
- `n_back = sum(1 for s in SAMPLES if not s[2])` 数一下附和样本有几条,作为误打断率的分母。

</div>

```bash
uv run python -m part10.voice.backchannel
```

```text
误打断率 0/6  []
漏打断率 2/8  [('停', 200, True), ('喂', 250, True)]
```

附和全对了,但漏了两条:用户只说了一个字「停」或者「喂」,时长也不到 300 毫秒,规则就当没听见。偏偏这两个字是用户最急的时候说的。练习 1 会修它。

规则只是起点。今天这组样本里,「嗯不对」「对,那个退款」能判对,是因为它们识别出了两个字以上;可 ASR 往往要等用户说完几百毫秒才给出文字,等文字出来再决定停不停,已经晚了。所以生产里常见的做法是两段式:VAD 一检测到人声,先把音量压低或暂停播放(不清缓冲);等 ASR 给出文字或者语义模型判完,确认是插话再真正取消,是附和就恢复播放。阿里云文档里 `semantic_vad` 说的「过滤附和声、背景音」,LiveKit 的轮次检测模型直接听音频语调,都是在往这个方向做。

## 第 5 步:语音里的工具调用

用户问「我那笔退款到哪了」,Agent 要先调 `list_invoices`。文本 Agent 里调工具时界面上可以显示「正在查询…」,电话里**用户在等,而且看不到屏幕**,沉默一秒都难受。最常见的办法是**过渡语**:模型一决定调工具,先说一句「好的,我帮您查一下」。这句话是现成的,不用等模型生成,决定调工具的那一刻就能送 TTS。

在模拟器里比一比。假设工具要 0.8 秒:

```python
# agent-zero-lab/part10/voice/tool_filler.py
"""要调一个慢工具时,先说一句过渡语,和闷头查完再说相比,用户多久能听到声音。"""
import asyncio
from dataclasses import replace

from part10.voice.voice_sim import Latency, Trace

FILLER = "好的，我帮您查一下。"
TOOL_SECONDS = 0.8  # 假装 list_invoices 要 0.8 秒


async def say(text: str, lat: Latency, trace: Trace) -> None:
    await asyncio.sleep(lat.tts_ttfb)
    trace.mark("audio_start")
    await asyncio.sleep(lat.tts_per_char * len(text))


async def turn_with_tool(lat: Latency, filler: bool) -> Trace:
    trace = Trace()
    await asyncio.sleep(lat.vad_hangover + lat.asr_final + lat.network / 2)
    await asyncio.sleep(lat.llm_ttft)  # 模型的第一个输出是「调 list_invoices」这个决定
    trace.mark("tool_call_decided")
    tool = asyncio.create_task(asyncio.sleep(TOOL_SECONDS))
    if filler:
        await say(FILLER, lat, trace)  # 工具在后台查,前台同时念过渡语
    await tool
    trace.mark("tool_done")
    await asyncio.sleep(lat.llm_ttft + 4 * lat.llm_per_char)  # 第二次调模型,攒「查到了，」
    await say("查到了，", lat, trace)
    trace.mark("answer_audio_done")
    return trace


async def main() -> None:
    lat = replace(Latency(), vad_hangover=0.2)
    for filler in (False, True):
        tr = await turn_with_tool(lat, filler)
        print("有过渡语" if filler else "无过渡语", "首音频", tr.first("audio_start"),
              "工具完成", tr.first("tool_done"), "答案念完", tr.first("answer_audio_done"))


if __name__ == "__main__":
    asyncio.run(main())
```

<div class="line-notes">

- `FILLER = "好的，我帮您查一下。"` 过渡语,10 个字。按 Day 610 实测每字 0.22 秒,念完要 2.2 秒。
- `async def say(text: str, lat: Latency, trace: Trace) -> None:` 一个简化的「念一句」,和 Day 610 的 `tts_play` 一样。
- `await asyncio.sleep(lat.llm_ttft)  # 模型的第一个输出是「调 list_invoices」这个决定` 有工具的一轮,模型要被调两次:第一次决定调工具,第二次拿到工具结果再回答。这和 [Day 166](/blog/agent-zero/day-166-agent-min/) 起学的 Agent 循环一模一样,只是每次调用的延迟在电话里都听得见。
- `tool = asyncio.create_task(asyncio.sleep(TOOL_SECONDS))` 工具在后台开始跑,不等它。
- `await say(FILLER, lat, trace)  # 工具在后台查,前台同时念过渡语` 念过渡语的同时工具在查,两件事并行。
- `await tool` 过渡语念完,再等工具。如果工具先好了,这里立刻返回;**如果过渡语比工具还长,工具早好了也得等过渡语念完**。看输出。
- `await asyncio.sleep(lat.llm_ttft + 4 * lat.llm_per_char)  # 第二次调模型` 拿到工具结果后第二次调模型,等首 token 再攒 4 个字。
- `lat = replace(Latency(), vad_hangover=0.2)` 用 Day 610 实验 B 的设置:已经换上语义轮次检测。

</div>

```bash
uv run python -m part10.voice.tool_filler
```

```text
无过渡语 首音频 2.342 工具完成 1.643 答案念完 3.223
有过渡语 首音频 1.043 工具完成 3.244 答案念完 4.824
```

过渡语把首音频从 2.34 秒提到了 1.04 秒,用户少沉默 1.3 秒,这是它的价值。但注意后两列:有过渡语时「答案念完」反而晚了 1.6 秒。原因在 `await tool` 那一行的注释:10 个字的过渡语要念 2.2 秒,工具 0.8 秒就好了,却得等过渡语念完才去做第二次模型调用。**过渡语太长,会把真正的答案往后推**。练习 2 会把它修好:过渡语念着的时候,工具和第二次模型调用都在后台跑,并且把过渡语缩短。

### 为「听」写提示词

工具结果拿回来之后,还有一个语音特有的问题:回答是要被念出来的。文本客服里很正常的回答(列表、粗体、发票号、网址、`¥468.00`),念出来就是灾难。拿同一份查询结果,分别用文本版和语音版两套系统提示词各答三次:

```python
# agent-zero-lab/part10/voice/voice_prompt.py
"""同一个问题、同一份查询结果,用文本版和语音版两套系统提示词各答 3 次,看念出来要多久。"""
import re

from common.llm import LLMClient

FACTS = ("查询结果:发票 INV-2026-0002,2026-09-03 扣款 ¥468.00,重复扣款;"
         "已创建退款申请 RR-20261022-0007,预计 3 个工作日原路退回;详情见 https://cloudledger.example/refunds")
PROMPTS = {
    "文本版": "你是云簿 CloudLedger 的在线客服,回答要完整准确。" + FACTS,
    "语音版": ("你是云簿 CloudLedger 的电话客服,你的回答会被念给用户听。"
             "每次最多三句,每句不超过 15 个字;金额用中文读法;编号只念后四位;不念网址;不用列表和符号;"
             "一次只问一个问题。" + FACTS),
}
USER = "我九月的年费好像被扣了两次,怎么办?"
SEC_PER_CHAR = 0.22  # Day 610 用 say 实测

llm = LLMClient()
for label, system in PROMPTS.items():
    for i in range(3):
        text = llm.chat([{"role": "system", "content": system}, {"role": "user", "content": USER}]).content
        spoken = re.sub(r"\s", "", text)
        bad = re.findall(r"https?://\S+|[A-Z]{2,}-[\d-]+|[*#\-]\s", text)
        print(f"{label} 第{i + 1}次 {len(spoken)}字 约{len(spoken) * SEC_PER_CHAR:.0f}秒 难念的:{bad}")
        if i == 0:
            print("   ", spoken[:120])
print(llm.ledger)
```

<div class="line-notes">

- `FACTS = ("查询结果:发票 INV-2026-0002` 一份典型的工具结果:有发票号、日期、带符号的金额、退款单号和网址。两套提示词用的是同一份。
- `"语音版": ("你是云簿 CloudLedger 的电话客服` 语音版的规则:句子短、金额用中文读法、编号只念后四位、不念网址、不用列表、一次只问一个问题。最后一条很重要,电话里一次问两个问题,用户通常只答后一个。
- `spoken = re.sub(r"\s", "", text)` 去掉所有空白(包括换行)再数字数,粗略估计要念多少字。
- `bad = re.findall(r"https?://\S+|[A-Z]{2,}-[\d-]+|[*#\-]\s", text)` 找三类难念的东西:网址、`INV-2026-0002` 这种编号、markdown 的列表和粗体符号。`|` 是「或」。
- `print(f"{label} 第{i + 1}次 {len(spoken)}字 约{len(spoken) * SEC_PER_CHAR:.0f}秒` 字数乘每字 0.22 秒,估算念完要多久。

</div>

```bash
uv run python -m part10.voice.voice_prompt
```

```text
文本版 第1次 393字 约86秒 难念的:['*\n', '- ', 'INV-2026-0002', '- ', '- ', '- ', '*\n', '- ', 'RR-20261022-0007', '- ', '- ', '*\n', '*\n', '- ', 'https://cloudledger.example/refunds', '- ', '*\n', '- ', '- ']
    您好，我帮您查到了这笔扣款记录，情况如下：**订单信息**-发票号：INV-2026-0002-扣款日期：2026-09-03-扣款金额：¥468.00-问题类型：重复扣款（年费被扣两次）**处理进展**我们已经为这笔重复扣款创建了退款申请
文本版 第2次 190字 约42秒 难念的:['INV-2026-0002', 'RR-20261022-0007', 'https://cloudledger.example/refunds']
文本版 第3次 217字 约48秒 难念的:['INV-2026-0002', 'RR-20261022-0007', 'https://cloudledger.example/refunds']
语音版 第1次 61字 约13秒 难念的:[]
    您好，我查到九月三日有一笔四百六十八元的重复扣款。已经为您创建退款申请，三个工作日内原路退回。请问您需要我核对退款账户吗？
语音版 第2次 61字 约13秒 难念的:[]
语音版 第3次 42字 约9秒 难念的:[]
6 次调用 | 输入 711 / 输出 587 tokens | 约 ¥0.0061
```

文本版第 1 次 393 个字,念完要一分半,还带着 markdown 粗体和列表符号,TTS 会把「星号星号订单信息」念出来,或者干脆念乱。三次都念了完整的发票号和网址。语音版三次都在 9 到 13 秒之间,金额念成「四百六十八元」,没有任何难念的东西。

这件事的结论很直接:**语音版要单独一份系统提示词**,文本版直接拿来用不行。改了它,还要像 [Day 145](/blog/agent-zero/day-145-prompt-lab/) 那样跑回归,只是指标换成「念出来多少秒」「有没有难念的东西」。花费:6 次调用,¥0.0061。

## 电话线路的几件特别的事

浏览器里的语音 Agent 走 WebRTC,接电话线路(呼入的客服热线、呼出的外呼)时,又多几件事。

**音质是 8 kHz 窄带**。传统电话线路的采样率是每秒 8000 次,只保留 4 kHz 以下的频率,很多辅音的细节都没了。对比一下,Day 610 阿里云文档里实时模型要求的输入是 16 kHz。可以自己听听差别,用 macOS 自带的 `afconvert` 把 Day 610 生成的 `first.aiff` 转成两种采样率:

```bash
cd part10/voice/out
afconvert -f WAVE -d LEI16@8000 -c 1 first.aiff phone_8k.wav
afconvert -f WAVE -d LEI16@16000 -c 1 first.aiff wide_16k.wav
ls -l *.wav
afinfo phone_8k.wav | grep -i "format\|duration"
```

```text
-rw-r--r--  1 你  wheel   68370 22 Oct 19:26 phone_8k.wav
-rw-r--r--  1 你  wheel  132644 22 Oct 19:26 wide_16k.wav
Data format:     1 ch,   8000 Hz, Int16
estimated duration: 4.017125 sec
```

`-f WAVE` 输出 wav 格式,`-d LEI16@8000` 是小端 16 位整数、8000 Hz,`-c 1` 单声道。同样 4 秒的话,8 kHz 文件 68 KB,16 kHz 132 KB,刚好一半(数据量和采样率成正比)。双击两个文件对比着听,8 kHz 那个明显发闷,像隔着一层东西。ASR 在这种音频上的字错误率会比在干净录音上高,所以**选 ASR 要选支持电话音质的模型,并且在你自己的电话录音上测**,厂商标称的数字通常是在干净语料上测的。

**开场要告知**。用户有权知道自己在和 AI 说话、通话是否被录音。各地法规要求不一样,外呼还有营销电话的专门规定。这些上线前一定要和法务确认,我这里给不了具体条文。

**敏感操作别只凭声音**。语音能被录、能被合成。身份核验、改绑卡、大额退款这类操作,要转短信验证码、按键或者人工。这和 [Day 592](/blog/agent-zero/day-592-identity-2/) 讲的「人在哪点头」是一个问题,只是在电话里,点头的方式变成了按键和验证码。

## 第 6 步:怎么评测语音 Agent

文本 Agent 的评测方法(第六部分学的数据集、LLM 评分、轨迹评测)都还能用,级联方案里中间那段文字就是现成的评测对象。语音另外要加几项:

| 指标 | 怎么量 | 为什么 |
| --- | --- | --- |
| 首音频延迟 P50、P95 | 每通电话每一轮都打点,按通话记录统计 | 用户记住的是最慢的那几次 |
| 各段延迟占比 | 六段分别打点 | 知道该优化哪一段 |
| ASR 字错误率 | 在自己的电话录音上人工转写对比 | 厂商数字是干净语料上测的 |
| 误打断率、漏打断率 | 抽通话录音人工标注 | 两种错误体验都很差,而且此消彼长 |
| 任务完成率、转人工率 | 业务系统里的结果 | 这是业务真正关心的 |
| 用户重复率 | 同一通电话里用户说了意思相同的话 | 重复说明没听清或者没听懂 |

**P95** 前面一直在用,这里正式说一下:把 100 通电话的首音频从小到大排好,第 95 个位置上的值。意思是「95% 的电话不超过这个数」,剩下 5% 比它还慢。P50 就是中位数。为什么不看平均值?下面跑一个 500 通电话的模拟就知道了。每段延迟按一个范围随机取,LLM 首 token 从 Day 610 实测的 10 个数里随机抽,再假设三成电话第一句话前要先调一次 0.8 秒的工具:

```python
# agent-zero-lab/part10/voice/voice_eval.py
"""模拟 500 通电话的首音频延迟,看平均值、P50、P95 各说明什么。LLM 首 token 从 Day 610 的 10 次实测里随机抽。"""
import random
import statistics

TTFT_MEASURED = [1.214, 0.413, 0.509, 0.516, 0.746, 0.852, 1.186, 0.441, 0.698, 0.795]
random.seed(610)


def one_call() -> float:
    vad = 0.2  # 已经换上语义轮次检测
    asr = random.uniform(0.10, 0.25)
    net = random.uniform(0.06, 0.12)
    ttft = random.choice(TTFT_MEASURED)
    first_chunk = random.choice([3, 4, 6]) * 0.012
    tts = random.uniform(0.15, 0.30)
    slow_tool = 0.8 if random.random() < 0.3 else 0.0  # 三成电话第一句前要先查一次发票
    return vad + asr + net + ttft + first_chunk + tts + slow_tool


if __name__ == "__main__":
    calls = sorted(one_call() for _ in range(500))
    q = statistics.quantiles(calls, n=100)  # 99 个切分点,q[49] 是 P50,q[94] 是 P95
    print(f"平均 {statistics.mean(calls):.3f}  P50 {q[49]:.3f}  P95 {q[94]:.3f}  最慢 {calls[-1]:.3f}")
    print(f"超过 1.5 秒的电话 {sum(c > 1.5 for c in calls)} / {len(calls)}")
```

<div class="line-notes">

- `random.seed(610)` 固定随机种子,每次跑出来的 500 通电话都一样,结果可以复现。相当于给 `Math.random` 定一个种子(JS 原生做不到,要用 seedrandom 这类库)。
- `asr = random.uniform(0.10, 0.25)` 在 0.10 到 0.25 秒之间均匀随机取一个值。
- `ttft = random.choice(TTFT_MEASURED)` 从实测的 10 个首 token 里随机抽一个,这样分布的「形状」来自真实数据,包括那两次 1.2 秒的慢请求。
- `first_chunk = random.choice([3, 4, 6]) * 0.012` 第一句 3、4 或 6 个字。
- `slow_tool = 0.8 if random.random() < 0.3 else 0.0` `random.random()` 返回 0 到 1 之间的数,小于 0.3 的概率是 30%,这三成电话要多等 0.8 秒的工具。
- `calls = sorted(one_call() for _ in range(500))` 跑 500 通,排好序。`_` 表示这个循环变量用不到。
- `q = statistics.quantiles(calls, n=100)` 把数据切成 100 份,返回 99 个切分点。`q[49]` 是第 50 个切分点(下标从 0 开始),就是 P50;`q[94]` 是 P95。
- `print(f"超过 1.5 秒的电话 {sum(c > 1.5 for c in calls)}` `c > 1.5` 是布尔值,`True` 在求和时算 1,所以 `sum` 出来就是个数。

</div>

```bash
uv run python -m part10.voice.voice_eval
```

```text
平均 1.752  P50 1.602  P95 2.743  最慢 2.897
超过 1.5 秒的电话 305 / 500
```

平均 1.75 秒,听起来「略慢」。但 P95 是 2.74 秒,也就是每 20 通电话里就有 1 通,用户要等将近 3 秒才听到声音,那是要「喂」的程度。超过 1.5 秒的有 305 通,六成。平均值把这些尾巴都抹平了。

这些慢电话从哪来?两个来源叠在一起:那三成要调工具的电话(多了 0.8 秒),和 DeepSeek 偶尔 1.2 秒的首 token。练习 3 会验证:给调工具的那三成电话加上过渡语,P95 能降多少。

真实系统里,这张表的每一项都要来自真实通话的打点,而不是模拟。模拟器的作用是**在动手改系统之前,先估一下某个改动能把分布推多远**,值不值得做。

## 动手练习

**练习 1:修好漏打断。** 第 4 步漏掉了「停」和「喂」。加一张「一出现就停」的词表,优先级高于附和词表,重新算两种错误率;再试三句新话:「对,不是这个」「嗯,等等」「好的好的」。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part10/voice/ex611_stopwords.py
"""练习 1:单字的「停」「喂」被漏掉了。加一张「一出现就停」的词表,再算两种错误率。"""
from part10.voice.backchannel import BACKCHANNELS, SAMPLES

STOP_WORDS = {"停", "喂", "等等", "不对", "不是"}


def is_barge_in_v2(text: str, speech_ms: int) -> bool:
    words = text.strip("，。！？,.!? ")
    if any(w in words for w in STOP_WORDS):
        return True  # 先看是不是明确要停,哪怕只有一个字
    if words in BACKCHANNELS:
        return False
    return speech_ms >= 300 or len(words) >= 2


false_stop = [s for s in SAMPLES if not s[2] and is_barge_in_v2(s[0], s[1])]
missed = [s for s in SAMPLES if s[2] and not is_barge_in_v2(s[0], s[1])]
print(f"误打断 {len(false_stop)}/6 {false_stop}  漏打断 {len(missed)}/8 {missed}")
for text, ms in [("对，不是这个", 700), ("嗯，等等", 400), ("好的好的", 600)]:
    print(text, ms, "->", "停" if is_barge_in_v2(text, ms) else "继续说")
```

<div class="line-notes">

- `from part10.voice.backchannel import BACKCHANNELS, SAMPLES` 复用第 4 步的附和词表和样本。`backchannel.py` 的打印部分在 `if __name__ == "__main__":` 下面,所以导入时不会打印。
- `STOP_WORDS = {"停", "喂", "等等", "不对", "不是"}` 明确表示「别说了」的词。
- `if any(w in words for w in STOP_WORDS):` `w in words` 是子串判断(「不是」在「对，不是这个」里面),`any` 只要有一个为真就是真,相当于 JS 的 `[...STOP_WORDS].some(w => words.includes(w))`。这一条放在最前面,优先级最高。

</div>

```text
误打断 0/6 []  漏打断 0/8 []
对，不是这个 700 -> 停
嗯，等等 400 -> 停
好的好的 600 -> 停
```

样本上两种错误都是 0 了。但三句新话里,「好的好的」被判成了停,其实它是附和:它不在附和词表里(表里只有「好的」),又超过了两个字。这说明两件事:规则永远补不完,样本集要不断加真实录音里的新说法;14 条样本上的 0/6、0/8 不代表什么,样本太少。真实系统里要在几百条标注过的真实片段上算这两个率,并且两个率一起看,因为调阈值时它们此消彼长。

</details>

**练习 2:过渡语别拖后腿。** 改写第 5 步,让工具和第二次模型调用在过渡语念着的时候就在后台跑,念完直接接答案;再把过渡语从「好的,我帮您查一下。」缩短成「好,我查下。」,比较两种过渡语的「答案念完」时间。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part10/voice/ex611_filler.py
"""练习 2:过渡语念的时候,工具和第二次模型调用都在后台跑,念完就能直接接答案。"""
import asyncio
from dataclasses import replace

from part10.voice.tool_filler import TOOL_SECONDS, say
from part10.voice.voice_sim import Latency, Trace


async def fetch_answer(lat: Latency) -> str:
    await asyncio.sleep(TOOL_SECONDS)  # 查发票
    await asyncio.sleep(lat.llm_ttft + 4 * lat.llm_per_char)  # 第二次调模型
    return "查到了，"


async def turn_parallel(lat: Latency, filler: str) -> Trace:
    trace = Trace()
    await asyncio.sleep(lat.vad_hangover + lat.asr_final + lat.network / 2 + lat.llm_ttft)
    answer_task = asyncio.create_task(fetch_answer(lat))  # 后台:工具 + 第二次模型
    await say(filler, lat, trace)  # 前台:念过渡语
    answer = await answer_task  # 念完时答案多半已经好了
    trace.mark("answer_ready")
    await say(answer, lat, trace)
    trace.mark("answer_audio_done")
    return trace


async def main() -> None:
    lat = replace(Latency(), vad_hangover=0.2)
    for filler in ("好的，我帮您查一下。", "好，我查下。"):
        tr = await turn_parallel(lat, filler)
        print(f"「{filler}」首音频 {tr.first('audio_start')} 答案就绪 {tr.first('answer_ready')} 答案念完 {tr.first('answer_audio_done')}")


asyncio.run(main())
```

<div class="line-notes">

- `from part10.voice.tool_filler import TOOL_SECONDS, say` 复用第 5 步的常量和 `say`。第 5 步的 `main()` 放在了 `if __name__ == "__main__":` 下面,导入时不会把第 5 步的实验也跑一遍。我第一版忘了加,导入一次就多打出两行第 5 步的结果。
- `async def fetch_answer(lat: Latency) -> str:` 把「查工具 + 第二次调模型」打包成一个协程,这样能整体丢到后台。
- `answer_task = asyncio.create_task(fetch_answer(lat))` 关键改动:决定调工具后,工具和第二次模型调用立刻在后台开跑,不等过渡语。
- `answer = await answer_task  # 念完时答案多半已经好了` 过渡语念完再取答案。如果答案已经好了,这里立刻返回。
- `trace.mark("answer_ready")` 记一下答案什么时候能开始念,方便看过渡语有没有拖后腿。

</div>

```text
「好的，我帮您查一下。」首音频 1.041 答案就绪 3.241 答案念完 4.323
「好，我查下。」首音频 1.04 答案就绪 2.361 答案念完 3.447
```

第一行和第 5 步相比只好了一点(4.82 → 4.32 秒),因为瓶颈不在工具,在过渡语本身:10 个字念 2.2 秒,答案 1.35 秒就准备好了,只能干等。缩成 5 个字的「好,我查下。」后,答案念完是 3.45 秒,和不加过渡语的 3.22 秒只差 0.2 秒,首音频却早了 1.3 秒。结论:**过渡语要短到刚好盖住工具的耗时**,而且工具要和过渡语并行跑。工具特别慢(超过两三秒)时,再补一句「还在查,您稍等」。

</details>

**练习 3:过渡语对分布的影响。** 在 `voice_eval.py` 的模型上,假设调工具的那三成电话都先念过渡语(过渡语是现成的,决定调工具就送 TTS,不用攒第一句,也不用等工具),用同一个随机种子比较有无过渡语时的平均值、P50、P95 和超过 1.5 秒的电话数。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part10/voice/ex611_eval.py
"""练习 3:要查发票的那三成电话先念过渡语,首音频的分布怎么变。"""
import random
import statistics

from part10.voice.voice_eval import TTFT_MEASURED


def one_call(filler: bool) -> float:
    vad, asr, net = 0.2, random.uniform(0.10, 0.25), random.uniform(0.06, 0.12)
    ttft = random.choice(TTFT_MEASURED)
    first_chunk = random.choice([3, 4, 6]) * 0.012
    tts = random.uniform(0.15, 0.30)
    needs_tool = random.random() < 0.3
    if needs_tool and filler:
        return vad + asr + net + ttft + tts  # 过渡语是现成的,决定调工具就送 TTS
    return vad + asr + net + ttft + first_chunk + tts + (0.8 if needs_tool else 0.0)


for filler in (False, True):
    random.seed(610)
    calls = [one_call(filler) for _ in range(500)]
    q = statistics.quantiles(calls, n=100)
    print(f"{'有' if filler else '无'}过渡语  平均 {statistics.mean(calls):.3f}  P50 {q[49]:.3f}  P95 {q[94]:.3f}  超 1.5 秒 {sum(c > 1.5 for c in calls)}/500")
```

<div class="line-notes">

- `from part10.voice.voice_eval import TTFT_MEASURED` 复用实测数据。`voice_eval.py` 的打印在 main guard 里,导入不会打印;它模块级的 `random.seed(610)` 会执行,不过我们下面每轮都会重新设种子。
- `vad, asr, net = 0.2, random.uniform(0.10, 0.25), random.uniform(0.06, 0.12)` 抽随机数的顺序和 `voice_eval.py` 完全一样,这样「无过渡语」那一行应该和第 6 步的输出一模一样,可以当作对照检查。
- `needs_tool = random.random() < 0.3` 不管有没有过渡语,都先抽这个随机数,保证两轮用的是同一批「电话」。
- `return vad + asr + net + ttft + tts  # 过渡语是现成的` 有过渡语时,首音频只取决于模型多快决定调工具,不用攒第一句,也不用等工具。
- `random.seed(610)` 放在循环里,每一轮开始前重置,两轮抽到的随机数完全相同,差别只来自 `filler`。

</div>

```text
无过渡语  平均 1.752  P50 1.602  P95 2.743  超 1.5 秒 305/500
有过渡语  平均 1.471  P50 1.449  P95 1.974  超 1.5 秒 208/500
```

「无过渡语」那行和第 6 步完全一致,说明对照没写错。加过渡语后平均只降了 0.28 秒,P95 却降了 0.77 秒(2.74 → 1.97),因为它砍掉的正是最慢的那批(调工具的)电话。这就是为什么优化要盯着 P95:只看平均值,你会低估这个改动的价值。剩下 208 通还超过 1.5 秒,主要来自偶尔 1.2 秒的首 token,下一步该去看 LLM 那段了。

</details>

**练习 4:设计一套语音 Agent 的上线前测试。** 云簿的退款电话 Agent 要上线,列出你会准备的测试通话(至少 6 类),每类说清要看哪个指标、通过标准是什么。

<details><summary>参考答案</summary>

开放题,我的示范:

1. **标准流程**(查扣款、申请退款、问到账时间)各 20 通:任务完成率 ≥ 90%,首音频 P95 ≤ 1.5 秒。
2. **调工具的轮次**(查发票、查退款进度)20 通:有过渡语,过渡语之后到答案的沉默不超过 1 秒。
3. **插话**:在机器人说话的第 1、3、6 秒分别插话「等一下,不是这单」,各 10 通:停止耗时 ≤ 300 毫秒,事后检查对话历史只包含已播放部分(像第 2 步那样,看机器人后面会不会把没说的话当成说过)。
4. **附和**:机器人说话时用户「嗯」「对对」「好的好的」,20 通:误打断率 ≤ 5%。
5. **电话音质和口音**:8 kHz 电话录音,带南方口音、背景有噪音的各 10 通:ASR 字错误率和干净录音相比不超过某个倍数(先测出基线再定)。
6. **敏感操作**:用户要求改退款账户或退一大笔钱:必须转短信验证码或人工,不能只凭声音执行。
7. **回声**:外放模式下通话 10 通:机器人自己打断自己的次数为 0。

每次改提示词、换 ASR 或 TTS 供应商、调 VAD 参数,都把这套通话重跑一遍,和上一版的分布对比。

</details>

**验收标准**:`barge_in.py`、`history_cut.py`、`blocking_demo.py`、`backchannel.py`、`tool_filler.py`、`voice_prompt.py`、`voice_eval.py` 都跑通;能说清 `blocking_demo.py` 为什么显示「停止耗时 0 ms」却其实晚了 1.8 秒;练习 2 里两种过渡语的「答案念完」差距你能解释;练习 3 里「无过渡语」那行和第 6 步的输出一致。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 打断(barge-in) | 机器人说话时用户插话,机器人应该马上停下 |
| 附和(backchannel) | 「嗯」「对」「好的」这类表示「我在听」的回应,不是要抢话 |
| 误打断率 / 漏打断率 | 把附和当成插话而停下的比例 / 用户真要插话却没停下的比例,两者此消彼长 |
| 回声消除 | 把扬声器放出的声音从麦克风输入里去掉,避免机器人自己打断自己 |
| 历史截断 | 打断后只把用户真正听到的部分写进对话历史。例:OpenAI Realtime 的 `conversation.item.truncate` 带 `audio_end_ms` |
| 阻塞调用 | 执行期间不让出事件循环的同步调用,如协程里的 `time.sleep`,会让所有协程(包括检测打断的那个)都停住 |
| 猴子补丁(monkeypatch) | 运行时替换模块里的函数或变量,今天用来把播放函数换成阻塞版做演示 |
| 过渡语(filler) | 调工具前先说的一句话,如「好,我查下」,让用户知道系统在干活 |
| 窄带音频(8 kHz) | 传统电话线路的采样率,只保留 4 kHz 以下频率,声音发闷,ASR 更难 |
| P50 / P95 | 从小到大排序后第 50%、第 95% 位置上的值;P95 表示 95% 的样本不超过它 |
| 用户重复率 | 一通电话里用户把意思相同的话说了不止一次的比例,说明没听清或没听懂 |

## 常见误区

**打断后把整段回复写进历史。** 第 2 步实测:历史里写全文时,用户说「那就这样吧」,模型三次里有两次没提金额就道别了,因为它以为自己已经说过。用户实际只听到 9 个字。

**用代码「注意到」的时刻当打断起点。** `blocking_demo.py` 显示停止耗时 0 毫秒,其实用户多听了 1.86 秒。起点要用 VAD 检测到人声的那个音频帧的时间。

**在语音的协程里写阻塞调用。** `time.sleep`、同步的音频库、同步 HTTP、CPU 重的本地推理,都会卡住事件循环,打断检测跟着失灵。换异步版,或者用 `asyncio.to_thread` 丢到线程里。

**一听到声音就停。** 附和词会让机器人每句话都说不完。至少要过一道附和词判断,更好的做法是先压低音量,确认是插话再真正取消。

**过渡语越完整越好。** 「好的,我帮您查一下。」10 个字要念 2.2 秒,比 0.8 秒的工具还长,反而把答案往后推了 1.6 秒。过渡语要短,工具要和它并行跑。

**文本版提示词直接拿来做语音。** 实测文本版一次答了 393 个字,念要 86 秒,还带 markdown 符号、发票号和网址。语音要单独写一份提示词并单独回归。

**只看平均延迟。** 500 通模拟电话里平均 1.75 秒,P95 却是 2.74 秒,六成电话超过 1.5 秒。加过渡语后平均只降 0.28 秒,P95 降了 0.77 秒,只看平均会低估它。

## 学习资料

### 文档与文章

- [OpenAI:Realtime conversations](https://developers.openai.com/api/docs/guides/realtime-conversations):打断时服务端怎么取消回复、WebSocket 下怎么发 `conversation.item.truncate`、WebRTC 下为什么自动截断,30 分钟。英文。
- [OpenAI:Realtime 客户端事件参考](https://developers.openai.com/api/reference/resources/realtime/client-events):`conversation.item.truncate`、`output_audio_buffer.clear` 这些事件的字段,查表用。英文。
- [openai-agents-python PR #4122](https://github.com/openai/openai-agents-python/pull/4122):截断值按墙钟时间算导致越界的真实 bug 和修法,10 分钟。英文。
- [OpenAI 社区:Realtime API interruptions don't properly trim the transcript](https://community.openai.com/t/realtime-api-interruptions-dont-properly-trim-the-transcript/1000703):开发者实际遇到的截断问题讨论,看看真实世界里这件事有多难,15 分钟。英文。
- [LiveKit:Turns 总览](https://docs.livekit.io/agents/build/turns/):轮次检测、打断、误打断的配置项,20 分钟。英文。
- [Pipecat:Speech input](https://docs.pipecat.ai/guides/learn/speech-input):Pipecat 怎么处理 VAD、轮次和打断,20 分钟。英文。
- [OpenAI:Voice agents 指南](https://developers.openai.com/api/docs/guides/voice-agents):后半部分讲评测,建议按 P50 和 P95 比较可听到的响应时间、后台耗时单独统计,和今天第 6 步对照,15 分钟。英文。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1DRKb6SEy4&autoplay=0&high_quality=1" title="语音AI Agent如何完美处理“打断”与轮次检测？ | AI Engineer" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>量子菠萝_ · 语音AI Agent如何完美处理「打断」与轮次检测? | AI Engineer · 33 分钟,AI Engineer 大会分享的搬运,误打断、附和词、语义轮次检测讲得很具体,和今天第 4 步对照看。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/nxuTVd7v7dg" title="Full Workshop: Realtime Voice AI — Mark Backman, Daily" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>AI Engineer · Full Workshop: Realtime Voice AI — Mark Backman, Daily · 70 分钟,Pipecat 团队从零搭一个能打断、能调工具的语音 Agent,想把今天的模拟器换成真框架时看。</figcaption>
</figure>

### 书籍

- Cathy Pearl《Designing Voice User Interfaces》(O'Reilly, 2016):后半本讲语音界面的用户测试和上线后怎么改进,和今天练习 4 的上线前测试对照,1 小时。英文原版。

### 开源项目与代码

- [livekit/agents](https://github.com/livekit/agents):读 `livekit-agents/livekit/agents/voice/agent_activity.py`,搜 `false_interruption` 和 `_paused_speech`,看它怎么先暂停说话、确认不是误打断再恢复,正是第 4 步说的两段式,1 小时。
- [pipecat-ai/pipecat](https://github.com/pipecat-ai/pipecat):搜 `InterruptionFrame` 或 `interruption`,看打断信号怎么在流水线里往下游传、各个处理器收到后做什么,40 分钟。
- [pipecat-ai/smart-turn](https://github.com/pipecat-ai/smart-turn):开源的语义轮次检测模型,看它的训练数据是怎么标「说完了 / 没说完」的,20 分钟。

## 自测

**1. 打断时要做哪三件事?模拟器里哪一行对应哪一件?**

<details><summary>答案</summary>

停掉播放(`bot.cancel()` 让 `play_tracked` 在下一个 `await asyncio.sleep` 处抛出 `CancelledError`,真实系统里还要清空播放缓冲);取消还在生成的 LLM(`speak()` 的 `finally` 里 `prod.cancel()`);把历史截断到用户听到的位置(`Playback.heard` 一个字一个字记,只把它写进历史)。

</details>

**2. 第 1 步里打断时 LLM 已经写完 55 个字,用户只听到 9 个。这对「打断时取消 LLM 能省钱」这个说法意味着什么?**

<details><summary>答案</summary>

写比念快得多(写 1.1 秒,念 12 秒),短回复里打断发生时通常早就写完了,取消省不了什么钱。取消 LLM 在长回复、带思考的模型、后面还排着工具调用的情况下才真正省钱。但真正要紧的是历史截断,因为「写出来的」和「听到的」差得很多。

</details>

**3. `blocking_demo.py` 为什么显示停止耗时 0 毫秒,实际却晚了 1.86 秒?**

<details><summary>答案</summary>

`time.sleep` 卡住了事件循环,本该在 3.0 秒醒来检测打断的协程一直等到 4.864 秒才有机会运行。代码记录的「插话时刻」是它注意到插话的时刻,停止确实是立刻的;但用户是 3.0 秒开口的,从用户的视角看晚了 1.864 秒。教训是热路径不能有阻塞调用,延迟起点要用音频帧的时间戳,不能用回调执行的时刻。

</details>

**4. 过渡语有什么好处,又有什么坑?**

<details><summary>答案</summary>

好处是首音频提前:模型一决定调工具就能念,第 5 步里从 2.34 秒提到了 1.04 秒;对分布的影响更大,练习 3 里 P95 从 2.74 降到 1.97 秒。坑是过渡语比工具还长时会把真正的答案往后推,第 5 步里答案念完反而晚了 1.6 秒。解法是让工具和第二次模型调用与过渡语并行,并把过渡语缩短到刚好盖住工具耗时。

</details>

**5. 面试题:你负责的电话客服 Agent 上线后,用户投诉「它老是说一半就不说了」。你怎么排查?**

<details><summary>答案</summary>

「说一半就停」最可能是误打断。先看通话记录里每次停止前的输入:如果是用户的附和(「嗯」「对」),说明附和判断太敏感,调阈值或补附和词表,最好改成先压低音量、确认是插话再取消;如果输入是机器人自己的声音(停止发生在没有用户说话的时候,而且多在外放或某些手机上),那是回声消除失效,要查音频链路;如果是背景噪音(电视、街道),考虑带噪音过滤的语义 VAD。其次要排除别的原因:TTS 服务超时中断、网络断流、某个阻塞调用让播放卡住。排查时把误打断率按设备、通话环境分开统计,修完之后在标注过的录音集上同时看误打断率和漏打断率,避免改过头变成用户喊停也不停。

</details>

## 明天预告

[Day 612](/blog/agent-zero/day-612-deep-research-1/) 讲 Deep Research(一):和 RAG 差在哪,典型架构,读 open_deep_research。语音 Agent 拼的是几百毫秒,Deep Research 刚好反过来,一个任务跑几分钟到几十分钟:先把问题拆成研究提纲,派几个研究员并行搜索阅读,压缩成笔记,最后写成带出处的报告。明天先对照 LangChain 的 open_deep_research 源码看清这个结构,再自己用离线资料跑一次。
